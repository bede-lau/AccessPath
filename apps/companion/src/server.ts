import { randomBytes, timingSafeEqual } from "node:crypto";
import Fastify, {
  LogController,
  type FastifyInstance,
  type FastifyRequest,
} from "fastify";
import { SCHEMA_VERSION } from "@accesspath/contracts";

const LOOPBACK_HOST = "127.0.0.1";
const DEFAULT_ALLOWED_ORIGINS = [
  "http://127.0.0.1:5173",
  "http://localhost:5173",
] as const;
const serverTokens = new WeakMap<FastifyInstance, string>();

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
  serverTokens.set(server, launchToken);

  server.addHook("onRequest", async (request, reply) => {
    if (!isAllowedHost(request.headers.host)) {
      return reply.code(403).send({
        error: {
          code: "TARGET_POLICY_DENIED",
          message: "The request host is not an approved loopback host.",
        },
      });
    }

    const origin = request.headers.origin;
    if (origin !== undefined && !allowedOrigins.has(origin)) {
      return reply.code(403).send({
        error: {
          code: "TARGET_POLICY_DENIED",
          message: "The request origin is not approved for this launch.",
        },
      });
    }

    if (!tokenMatches(request, launchToken)) {
      return reply.code(401).send({
        error: {
          code: "QODER_PERMISSION_DENIED",
          message: "A valid local launch token is required.",
        },
      });
    }
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
