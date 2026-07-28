import { randomBytes, timingSafeEqual } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, {
  LogController,
  type FastifyInstance,
  type FastifyRequest,
} from "fastify";
import {
  ErrorResponseSchema,
  SCHEMA_VERSION,
  type ErrorCode,
} from "@accesspath/contracts";
import { GitWorkspaceError } from "@accesspath/git-workspace";
import type { QoderAdapter } from "@accesspath/qoder-runner";

import {
  AuditNotFoundError,
  AuditService,
  AuditStateError,
  type AuditRunner,
} from "./audit-service";
import { qoderAuthAvailability } from "./qoder-auth";
import { ProcessSupervisorError } from "./process-supervisor";
import {
  RepairApprovalError,
  RepairNotFoundError,
  RepairService,
  RepairStateError,
  repositoryValidationResponse,
  type RepairCommandRunner,
} from "./repair-service";

const LOOPBACK_HOST = "127.0.0.1";
const DEFAULT_ALLOWED_ORIGINS = [
  "http://127.0.0.1:5173",
  "http://localhost:5173",
] as const;
const serverTokens = new WeakMap<FastifyInstance, string>();
const DEFAULT_REPOSITORY_ROOT = path.resolve(
  fileURLToPath(new URL("../../..", import.meta.url)),
);

function isAllowedHost(host: string | undefined): boolean {
  return (
    host !== undefined &&
    /^(?:127\.0\.0\.1|localhost)(?::\d{1,5})?$/i.test(host)
  );
}

function tokenMatches(request: FastifyRequest, expected: string): boolean {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) {
    return false;
  }
  const providedBuffer = Buffer.from(
    authorization.slice("Bearer ".length),
  );
  const expectedBuffer = Buffer.from(expected);
  return (
    providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer)
  );
}

export interface ServerConfig {
  launchToken?: string;
  allowedOrigins?: readonly string[];
  artifactRoot?: string;
  editableRepositoryRoot?: string;
  demoAidAppPort?: number;
  auditRunner?: AuditRunner;
  qoderAdapter?: QoderAdapter;
  repairCommandRunner?: RepairCommandRunner;
}

export function createServer(config: ServerConfig = {}): FastifyInstance {
  const launchToken = config.launchToken ?? randomBytes(32).toString("base64url");
  const allowedOrigins = new Set(
    config.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS,
  );
  const server = Fastify({
    logger: { level: "info" },
    logController: new LogController({ disableRequestLogging: true }),
  });
  const auditService = new AuditService({
    artifactRoot: config.artifactRoot ?? path.join(os.homedir(), ".accesspath"),
    editableRepositoryRoot:
      config.editableRepositoryRoot ?? DEFAULT_REPOSITORY_ROOT,
    runner: config.auditRunner,
  });
  const repairService = new RepairService({
    artifactRoot: config.artifactRoot ?? path.join(os.homedir(), ".accesspath"),
    commandRunner: config.repairCommandRunner,
    editableRepositoryRoot:
      config.editableRepositoryRoot ?? DEFAULT_REPOSITORY_ROOT,
    qoderAdapter: config.qoderAdapter,
  });
  serverTokens.set(server, launchToken);

  server.addHook("onClose", async () => {
    await repairService.shutdown();
  });

  const errorResponse = (
    code: ErrorCode,
    message: string,
    correlationId: string,
    details?: Record<string, unknown>,
  ) =>
    ErrorResponseSchema.parse({
      error: {
        code,
        message,
        correlationId,
        ...(details === undefined ? {} : { details }),
      },
    });

  server.addHook("onRequest", async (request, reply) => {
    const correlationId = request.id;
    reply.header("x-correlation-id", correlationId);
    if (!isAllowedHost(request.headers.host)) {
      return reply
        .code(403)
        .send(
          errorResponse(
            "TARGET_POLICY_DENIED",
            "The request host is not an approved loopback host.",
            correlationId,
          ),
        );
    }

    const origin = request.headers.origin;
    if (origin !== undefined && !allowedOrigins.has(origin)) {
      return reply
        .code(403)
        .send(
          errorResponse(
            "TARGET_POLICY_DENIED",
            "The request origin is not approved for this launch.",
            correlationId,
          ),
        );
    }

    if (!tokenMatches(request, launchToken)) {
      return reply
        .code(401)
        .send(
          errorResponse(
            "QODER_PERMISSION_DENIED",
            "A valid local launch token is required.",
            correlationId,
          ),
        );
    }
  });

  server.setNotFoundHandler((request, reply) =>
    reply
      .code(404)
      .send(
        errorResponse(
          "NOT_FOUND",
          "The requested API resource was not found.",
          request.id,
        ),
      ),
  );

  server.setErrorHandler((error: Error, request, reply) => {
    if (reply.sent) {
      return;
    }
    if (error instanceof AuditNotFoundError) {
      return reply
        .code(404)
        .send(errorResponse("NOT_FOUND", error.message, request.id));
    }
    if (
      error instanceof AuditStateError ||
      error instanceof RepairStateError
    ) {
      return reply
        .code(409)
        .send(
          errorResponse("INVALID_STATE", error.message, request.id, {
            currentState: error.currentState,
          }),
        );
    }
    if (error instanceof RepairNotFoundError) {
      return reply
        .code(404)
        .send(errorResponse("NOT_FOUND", error.message, request.id));
    }
    if (error instanceof RepairApprovalError) {
      return reply
        .code(409)
        .send(errorResponse("CONFLICT", error.message, request.id));
    }
    if (error instanceof GitWorkspaceError) {
      const code: ErrorCode =
        error.code === "REPOSITORY_DIRTY"
          ? "REPOSITORY_DIRTY"
          : error.code === "PATH_ESCAPE"
            ? "PATH_ESCAPE"
            : error.code === "CONFLICT"
              ? "CONFLICT"
              : "REPOSITORY_INVALID";
      return reply
        .code(code === "REPOSITORY_DIRTY" || code === "CONFLICT" ? 409 : 400)
        .send(
          errorResponse(
            code,
            code === "REPOSITORY_DIRTY"
              ? "The repository base checkout must be clean."
              : code === "PATH_ESCAPE"
                ? "The requested path is outside the repair workspace."
                : "The repository cannot be used for this repair.",
            request.id,
          ),
        );
    }
    if (error instanceof ProcessSupervisorError) {
      const code: ErrorCode =
        error.code === "PATH_ESCAPE" ? "PATH_ESCAPE" : "COMMAND_DENIED";
      return reply
        .code(400)
        .send(
          errorResponse(
            code,
            code === "PATH_ESCAPE"
              ? "The command working directory escapes the repair workspace."
              : "The command is not allowed by the repair policy.",
            request.id,
          ),
        );
    }
    if (
      error.message.includes("QODER_PERSONAL_ACCESS_TOKEN") ||
      error.message.includes("auth_not_configured") ||
      error.message.includes("authentication")
    ) {
      return reply
        .code(409)
        .send(
          errorResponse(
            "QODER_AUTH_REQUIRED",
            "Qoder authentication is required for the live adapter.",
            request.id,
          ),
        );
    }
    if (
      error.name === "ZodError" ||
      error instanceof SyntaxError ||
      error.message.includes("required")
    ) {
      return reply
        .code(400)
        .send(
          errorResponse(
            "INVALID_INPUT",
            "The request body or parameters are invalid.",
            request.id,
          ),
        );
    }
    request.log.error({ err: error }, "companion request failed");
    return reply
      .code(500)
      .send(
        errorResponse(
          "INTERNAL",
          "The companion could not complete the request.",
          request.id,
        ),
      );
  });

  server.get("/api/health", async (_request, reply) => {
    reply.header("cache-control", "no-store");
    // No filesystem paths and no secrets in this response.
    return {
      status: "ok",
      schemaVersion: SCHEMA_VERSION,
      timestamp: new Date().toISOString(),
    };
  });

  server.get("/api/config/public", async (_request, reply) => {
    reply.header("cache-control", "no-store");
    return {
      schemaVersion: SCHEMA_VERSION,
      supportsAudit: true,
      supportsRepair: true,
      targetPolicies: ["public", "local-explicit"],
      reportFormats: ["html", "markdown", "json"],
      demoAidAppPort: config.demoAidAppPort ?? 4173,
    };
  });

  server.post("/api/auth/qoder/validate", async (_request, reply) => {
    reply.header("cache-control", "no-store");
    const authentication = await qoderAuthAvailability();
    return {
      schemaVersion: SCHEMA_VERSION,
      ...authentication,
      nextAction: authentication.available
        ? "Qoder authentication is available."
        : "Set QODER_PERSONAL_ACCESS_TOKEN or sign in with qodercli.",
    };
  });

  server.post("/api/repositories/validate", async (request, reply) => {
    const body = request.body as { repositoryPath?: unknown };
    if (typeof body?.repositoryPath !== "string") {
      return reply
        .code(400)
        .send(
          errorResponse(
            "INVALID_INPUT",
            "repositoryPath is required.",
            request.id,
          ),
        );
    }
    return {
      repository: repositoryValidationResponse(
        await repairService.validateRepository(body.repositoryPath),
      ),
    };
  });

  server.post("/api/audits", async (request, reply) => {
    const audit = await auditService.create(request.body);
    return reply.code(201).send({ audit });
  });

  server.get<{ Params: { auditId: string } }>(
    "/api/audits/:auditId",
    async (request) => ({ audit: await auditService.get(request.params.auditId) }),
  );

  server.patch<{ Params: { auditId: string } }>(
    "/api/audits/:auditId",
    async (request) => ({
      audit: await auditService.update(request.params.auditId, request.body),
    }),
  );

  const idempotencyKey = (request: FastifyRequest): string | undefined => {
    const value = request.headers["idempotency-key"];
    if (Array.isArray(value)) {
      return value[0];
    }
    return value;
  };

  server.post<{ Params: { auditId: string } }>(
    "/api/audits/:auditId/start",
    async (request, reply) =>
      reply.code(202).send({
        audit: await auditService.start(
          request.params.auditId,
          idempotencyKey(request),
        ),
      }),
  );

  server.post<{ Params: { auditId: string } }>(
    "/api/audits/:auditId/pause",
    async (request) => ({
      audit: await auditService.pause(
        request.params.auditId,
        idempotencyKey(request),
      ),
    }),
  );

  server.post<{ Params: { auditId: string } }>(
    "/api/audits/:auditId/resume",
    async (request) => ({
      audit: await auditService.resume(
        request.params.auditId,
        idempotencyKey(request),
      ),
    }),
  );

  server.post<{ Params: { auditId: string } }>(
    "/api/audits/:auditId/cancel",
    async (request) => ({
      audit: await auditService.cancel(
        request.params.auditId,
        idempotencyKey(request),
      ),
    }),
  );

  server.get<{ Params: { auditId: string } }>(
    "/api/audits/:auditId/bundle",
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      return auditService.bundle(request.params.auditId);
    },
  );

  server.get<{
    Params: { auditId: string };
    Querystring: { format?: string };
  }>("/api/audits/:auditId/report", async (request, reply) => {
    const format = request.query.format;
    if (format !== "html" && format !== "markdown" && format !== "json") {
      return reply
        .code(400)
        .send(
          errorResponse(
            "INVALID_INPUT",
            "format must be html, markdown, or json.",
            request.id,
          ),
        );
    }
    const report = await auditService.report(
      request.params.auditId,
      format,
    );
    reply.header("cache-control", "no-store");
    reply.header("content-type", report.contentType);
    reply.header(
      "content-disposition",
      `attachment; filename="${report.filename}"`,
    );
    return reply.send(report.content);
  });

  server.post("/api/repairs", async (request, reply) =>
    reply.code(201).send({
      repair: await repairService.create(request.body),
    }),
  );

  server.get<{ Params: { repairId: string } }>(
    "/api/repairs/:repairId",
    async (request) => ({
      repair: await repairService.get(request.params.repairId),
      manifest: await repairService.manifest(request.params.repairId),
      plan: await repairService.plan(request.params.repairId),
      approvals: await repairService.listApprovals(request.params.repairId),
      tests: await repairService.tests(request.params.repairId),
      baseIntegrity: await repairService.baseIntegrity(
        request.params.repairId,
      ),
    }),
  );

  server.post<{ Params: { repairId: string } }>(
    "/api/repairs/:repairId/prepare",
    async (request, reply) =>
      reply.code(202).send({
        repair: await repairService.prepare(request.params.repairId),
      }),
  );

  server.post<{ Params: { repairId: string } }>(
    "/api/repairs/:repairId/diagnose",
    async (request, reply) =>
      reply.code(202).send({
        repair: await repairService.diagnose(request.params.repairId),
      }),
  );

  server.post<{ Params: { repairId: string } }>(
    "/api/repairs/:repairId/start",
    async (request, reply) =>
      reply.code(202).send({
        repair: await repairService.startRepair(
          request.params.repairId,
          idempotencyKey(request),
        ),
      }),
  );

  server.post<{ Params: { repairId: string } }>(
    "/api/repairs/:repairId/pause",
    async (request) => ({
      repair: await repairService.interrupt(request.params.repairId),
    }),
  );

  server.post<{ Params: { repairId: string } }>(
    "/api/repairs/:repairId/resume",
    async (request, reply) =>
      reply.code(202).send({
        repair: await repairService.resume(request.params.repairId),
      }),
  );

  server.post<{ Params: { repairId: string } }>(
    "/api/repairs/:repairId/cancel",
    async (request) => ({
      repair: await repairService.cancel(
        request.params.repairId,
        idempotencyKey(request),
      ),
    }),
  );

  server.get<{ Params: { repairId: string } }>(
    "/api/repairs/:repairId/diff",
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      return {
        diff: await repairService.diff(request.params.repairId),
      };
    },
  );

  server.post<{ Params: { repairId: string } }>(
    "/api/repairs/:repairId/verify",
    async (request, reply) =>
      reply.code(202).send({
        repair: await repairService.verify(
          request.params.repairId,
          idempotencyKey(request),
        ),
      }),
  );

  server.get<{ Params: { repairId: string } }>(
    "/api/repairs/:repairId/approvals",
    async (request) => ({
      approvals: await repairService.listApprovals(request.params.repairId),
    }),
  );

  server.post<{
    Params: { repairId: string; approvalId: string };
  }>(
    "/api/repairs/:repairId/approvals/:approvalId",
    async (request) => ({
      approval: await repairService.decideApproval(
        request.params.repairId,
        request.params.approvalId,
        request.body,
        idempotencyKey(request),
      ),
    }),
  );

  server.post<{ Params: { repairId: string } }>(
    "/api/repairs/:repairId/rewind/preview",
    async (request) =>
      repairService.rewindPreview(
        request.params.repairId,
        idempotencyKey(request),
      ),
  );

  server.post<{ Params: { repairId: string } }>(
    "/api/repairs/:repairId/rewind",
    async (request, reply) => {
      const body = request.body as { approvalId?: unknown };
      if (typeof body?.approvalId !== "string") {
        return reply
          .code(400)
          .send(
            errorResponse(
              "INVALID_INPUT",
              "approvalId is required.",
              request.id,
            ),
          );
      }
      return {
        diff: await repairService.applyRewind(
          request.params.repairId,
          body.approvalId,
          idempotencyKey(request),
        ),
      };
    },
  );

  server.post<{ Params: { approvalId: string } }>(
    "/api/approvals/:approvalId/decision",
    async (request) => {
      const repairId = await repairService.repairIdForApproval(
        request.params.approvalId,
      );
      return {
        approval: await repairService.decideApproval(
          repairId,
          request.params.approvalId,
          request.body,
          idempotencyKey(request),
        ),
      };
    },
  );

  server.post<{ Params: { checkpointId: string } }>(
    "/api/checkpoints/:checkpointId/rewind-preview",
    async (request) =>
      repairService.rewindPreviewForCheckpoint(
        request.params.checkpointId,
        idempotencyKey(request),
      ),
  );

  server.post<{ Params: { checkpointId: string } }>(
    "/api/checkpoints/:checkpointId/rewind",
    async (request, reply) => {
      const body = request.body as { approvalId?: unknown };
      if (typeof body?.approvalId !== "string") {
        return reply
          .code(400)
          .send(
            errorResponse(
              "INVALID_INPUT",
              "approvalId is required.",
              request.id,
            ),
          );
      }
      return {
        diff: await repairService.applyRewindForCheckpoint(
          request.params.checkpointId,
          body.approvalId,
          idempotencyKey(request),
        ),
      };
    },
  );

  server.get<{
    Params: { repairId: string };
    Querystring: { format?: string };
  }>("/api/repairs/:repairId/report", async (request, reply) => {
    const format = request.query.format;
    if (format !== "markdown" && format !== "json") {
      return reply
        .code(400)
        .send(
          errorResponse(
            "INVALID_INPUT",
            "format must be markdown or json.",
            request.id,
          ),
        );
    }
    const report = await repairService.report(
      request.params.repairId,
      format,
    );
    reply.header("cache-control", "no-store");
    reply.header("content-type", report.contentType);
    reply.header(
      "content-disposition",
      `attachment; filename="${report.filename}"`,
    );
    return reply.send(report.content);
  });

  server.get<{
    Params: { sessionId: string };
    Querystring: { after?: string };
  }>("/api/sessions/:sessionId/events", async (request, reply) => {
    let sessionType: "audit" | "repair";
    try {
      await auditService.get(request.params.sessionId);
      sessionType = "audit";
    } catch (error) {
      if (!(error instanceof AuditNotFoundError)) {
        throw error;
      }
      await repairService.get(request.params.sessionId);
      sessionType = "repair";
    }
    const cursor =
      request.headers["last-event-id"] ?? request.query.after;
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      "x-correlation-id": request.id,
    });

    let lastCursor = typeof cursor === "string" ? cursor : undefined;
    let closed = false;
    request.raw.once("close", () => {
      closed = true;
    });
    while (!closed) {
      const events =
        sessionType === "audit"
          ? await auditService.replay(request.params.sessionId, lastCursor)
          : await repairService.replay(request.params.sessionId, lastCursor);
      for (const event of events) {
        reply.raw.write(
          `id: ${event.eventId}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
        );
        lastCursor = event.eventId;
      }
      const state =
        sessionType === "audit"
          ? (await auditService.get(request.params.sessionId)).state
          : (await repairService.get(request.params.sessionId)).state;
      if (
        [
          "completed",
          "blocked",
          "failed",
          "cancelled",
          "rejected",
        ].includes(state)
      ) {
        reply.raw.end();
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  });

  server.get<{
    Params: { artifactId: string };
    Querystring: { sessionId?: string };
  }>("/api/artifacts/:artifactId", async (request, reply) => {
    const artifact = await auditService.artifact(
      request.params.artifactId,
      request.query.sessionId,
    );
    reply.header("cache-control", "no-store");
    reply.header("content-type", artifact.contentType);
    reply.header(
      "content-disposition",
      `inline; filename="${artifact.filename}"`,
    );
    return reply.send(artifact.content);
  });

  return server;
}

export function getLaunchToken(server: FastifyInstance): string {
  const token = serverTokens.get(server);
  if (token === undefined) {
    throw new Error("The server was not created by AccessPath.");
  }
  return token;
}

export interface StartConfig extends ServerConfig {
  host?: string;
  port?: number;
}

export async function start(config: StartConfig = {}): Promise<FastifyInstance> {
  const host = config.host ?? LOOPBACK_HOST;
  if (host !== LOOPBACK_HOST) {
    throw new Error(`The companion may bind only to ${LOOPBACK_HOST}.`);
  }
  const server = createServer(config);
  await server.listen({
    host,
    // Port 0 lets the OS select an available port (runtime default).
    port: config.port ?? 0,
  });
  for (const address of server.addresses()) {
    server.log.info(
      { address: address.address, port: address.port },
      "companion listening",
    );
  }
  return server;
}

export async function stop(server: FastifyInstance): Promise<void> {
  await server.close();
}
