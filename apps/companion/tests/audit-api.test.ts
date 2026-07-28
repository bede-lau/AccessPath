import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ErrorResponseSchema, type TaskContract } from "@accesspath/contracts";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import type { PersistedAuditResult } from "../src/audit-pipeline";
import { createServer, stop } from "../src/server";

const launchToken = "audit-api-test-token";
const temporaryDirectories: string[] = [];
let server: FastifyInstance | undefined;

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function headers(
  overrides: Record<string, string> = {},
): Record<string, string> {
  return {
    host: "127.0.0.1:4801",
    authorization: `Bearer ${launchToken}`,
    ...overrides,
  };
}

const task: TaskContract = {
  schemaVersion: "1.0.0",
  id: "task-api-lifecycle",
  title: "Lifecycle test",
  goal: "Exercise audit API state transitions.",
  startUrl: "https://example.test/",
  targetPolicy: "public",
  success: {},
  forbiddenActions: [],
  expectedSteps: [
    {
      id: "focus-page",
      intent: "Move focus",
      action: { kind: "press", key: "Tab" },
      checkpoint: true,
    },
  ],
  fixtureValues: {},
  viewport: { width: 1280, height: 800 },
  timeoutMs: 10_000,
};

function cancelledResult(auditSessionId: string): PersistedAuditResult {
  return {
    auditSessionId,
    bundle: {
      auditSessionId,
      runId: "run-test",
      outcome: "cancelled",
    },
    reports: { html: "", markdown: "", json: "" },
  } as PersistedAuditResult;
}

afterEach(async () => {
  if (server !== undefined) {
    await stop(server);
    server = undefined;
  }
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("companion audit API lifecycle", () => {
  it("uses wrapped audit resources, nonblocking start, and idempotent commands", async () => {
    const artifactRoot = await temporaryDirectory("accesspath-api-artifacts-");
    const repositoryRoot = await temporaryDirectory("accesspath-api-repo-");
    let launches = 0;
    let aborts = 0;
    const runner = (
      _task: TaskContract,
      options: { auditSessionId?: string; signal?: AbortSignal },
    ) => {
      launches += 1;
      return (
      new Promise<PersistedAuditResult>((resolve) => {
        options.signal?.addEventListener(
          "abort",
          () => {
            aborts += 1;
            resolve(cancelledResult(options.auditSessionId!));
          },
          { once: true },
        );
      })
      );
    };
    server = createServer({
      launchToken,
      artifactRoot,
      editableRepositoryRoot: repositoryRoot,
      auditRunner: runner,
    });

    const config = await server.inject({
      method: "GET",
      url: "/api/config/public",
      headers: headers(),
    });
    expect(config.statusCode).toBe(200);
    expect(config.json()).toMatchObject({
      schemaVersion: "1.0.0",
      supportsAudit: true,
      targetPolicies: ["public", "local-explicit"],
    });

    const created = await server.inject({
      method: "POST",
      url: "/api/audits",
      headers: headers(),
      payload: task,
    });
    expect(created.statusCode).toBe(201);
    const auditId = created.json().audit.id as string;
    expect(created.json().audit.state).toBe("ready");

    const patched = await server.inject({
      method: "PATCH",
      url: `/api/audits/${auditId}`,
      headers: headers(),
      payload: { task: { ...task, title: "Updated lifecycle test" } },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().audit.task.title).toBe("Updated lifecycle test");

    const started = await server.inject({
      method: "POST",
      url: `/api/audits/${auditId}/start`,
      headers: headers({ "idempotency-key": "start-1" }),
    });
    expect(started.statusCode).toBe(202);
    expect(started.json().audit.state).toBe("running");

    const duplicateStart = await server.inject({
      method: "POST",
      url: `/api/audits/${auditId}/start`,
      headers: headers({ "idempotency-key": "start-1" }),
    });
    expect(duplicateStart.statusCode).toBe(202);
    expect(duplicateStart.json().audit.state).toBe("running");

    const paused = await server.inject({
      method: "POST",
      url: `/api/audits/${auditId}/pause`,
      headers: headers({ "idempotency-key": "pause-1" }),
    });
    expect(paused.json().audit.state).toBe("paused");
    expect(aborts).toBe(0);

    const duplicatePause = await server.inject({
      method: "POST",
      url: `/api/audits/${auditId}/pause`,
      headers: headers({ "idempotency-key": "pause-1" }),
    });
    expect(duplicatePause.json().audit.state).toBe("paused");

    const resumed = await server.inject({
      method: "POST",
      url: `/api/audits/${auditId}/resume`,
      headers: headers({ "idempotency-key": "resume-1" }),
    });
    expect(resumed.json().audit.state).toBe("running");
    expect(launches).toBe(1);

    const cancelled = await server.inject({
      method: "POST",
      url: `/api/audits/${auditId}/cancel`,
      headers: headers({ "idempotency-key": "cancel-1" }),
    });
    expect(cancelled.json().audit.state).toBe("cancelled");
    expect(aborts).toBe(1);

    const duplicateCancel = await server.inject({
      method: "POST",
      url: `/api/audits/${auditId}/cancel`,
      headers: headers({ "idempotency-key": "cancel-1" }),
    });
    expect(duplicateCancel.json().audit.state).toBe("cancelled");

    const invalidResume = await server.inject({
      method: "POST",
      url: `/api/audits/${auditId}/resume`,
      headers: headers(),
    });
    expect(invalidResume.statusCode).toBe(409);
    const error = ErrorResponseSchema.parse(invalidResume.json());
    expect(error.error).toMatchObject({
      code: "INVALID_STATE",
      details: { currentState: "cancelled" },
    });
    expect(error.error.correlationId).toBeTruthy();
  });

  it("returns correlation-bearing error envelopes for auth and missing resources", async () => {
    server = createServer({ launchToken });
    const unauthorized = await server.inject({
      method: "GET",
      url: "/api/config/public",
      headers: { host: "127.0.0.1:4801" },
    });
    expect(unauthorized.statusCode).toBe(401);
    expect(ErrorResponseSchema.parse(unauthorized.json()).error.correlationId).toBeTruthy();

    const missing = await server.inject({
      method: "GET",
      url: "/api/audits/audit-missing",
      headers: headers(),
    });
    expect(missing.statusCode).toBe(404);
    expect(ErrorResponseSchema.parse(missing.json()).error.code).toBe("NOT_FOUND");
    expect(missing.body).not.toMatch(/[A-Za-z]:\\/);
    expect(missing.body).not.toMatch(/\/(?:home|Users)\//);
  });
});
