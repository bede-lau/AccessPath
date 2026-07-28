import fs from "node:fs";
import http from "node:http";
import { fileURLToPath } from "node:url";
import {
  BARRIER_IDS,
  expectedFindingManifest,
  FIXTURE_ID,
  fixtureTaskContract,
} from "./fixture-data";
import {
  InMemoryFixtureStore,
  parseTestSubmission,
} from "./fixture-state";

const PUBLIC_FILES = {
  "/": {
    contentType: "text/html; charset=utf-8",
    body: fs.readFileSync(
      fileURLToPath(new URL("../public/index.html", import.meta.url)),
    ),
  },
  "/app.js": {
    contentType: "text/javascript; charset=utf-8",
    body: fs.readFileSync(
      fileURLToPath(new URL("../public/app.js", import.meta.url)),
    ),
  },
  "/styles.css": {
    contentType: "text/css; charset=utf-8",
    body: fs.readFileSync(
      fileURLToPath(new URL("../public/styles.css", import.meta.url)),
    ),
  },
} as const;

const MAX_REQUEST_BYTES = 16 * 1024;

function writeJson(
  response: http.ServerResponse,
  statusCode: number,
  value: unknown,
): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}

async function readJson(request: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > MAX_REQUEST_BYTES) {
      throw new Error("Request body is too large.");
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    throw new Error("A JSON request body is required.");
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function createDemoServer(
  store = new InMemoryFixtureStore(FIXTURE_ID),
): http.Server {
  return http.createServer(async (request, response) => {
    const method = request.method ?? "GET";
    const pathname = new URL(request.url ?? "/", "http://fixture.local").pathname;

    if (method === "GET" && pathname in PUBLIC_FILES) {
      const file = PUBLIC_FILES[pathname as keyof typeof PUBLIC_FILES];
      response.writeHead(200, {
        "content-type": file.contentType,
        "cache-control": "no-store",
      });
      response.end(file.body);
      return;
    }

    if (method === "GET" && pathname === "/health") {
      writeJson(response, 200, {
        status: "ok",
        fixtureId: FIXTURE_ID,
        barrierIds: BARRIER_IDS,
        submissionCount: store.snapshot().submissions.length,
      });
      return;
    }

    if (method === "GET" && pathname === "/fixture/task-contract.json") {
      writeJson(response, 200, fixtureTaskContract);
      return;
    }

    if (method === "GET" && pathname === "/fixture/expected-findings.json") {
      writeJson(response, 200, expectedFindingManifest);
      return;
    }

    if (method === "GET" && pathname === "/__fixture/state") {
      writeJson(response, 200, store.snapshot());
      return;
    }

    if (method === "POST" && pathname === "/__fixture/reset") {
      writeJson(response, 200, {
        status: "reset",
        state: store.reset(),
      });
      return;
    }

    if (method === "POST" && pathname === "/api/test-submissions") {
      try {
        const submission = store.submit(parseTestSubmission(await readJson(request)));
        writeJson(response, 201, {
          status: "submitted",
          reference: submission.reference,
          message:
            "This fictional test application was stored in memory only and was not sent to an agency.",
        });
      } catch (error) {
        writeJson(response, 400, {
          error: "invalid_test_submission",
          message: error instanceof Error ? error.message : "Invalid request.",
        });
      }
      return;
    }

    writeJson(response, 404, { error: "not_found" });
  });
}

function parsePort(value: string | undefined): number {
  const port = Number(value ?? 4173);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("DEMO_AID_APP_PORT must be an integer from 0 to 65535.");
  }
  return port;
}

export function start(
  port = parsePort(process.env.DEMO_AID_APP_PORT),
  host = "127.0.0.1",
): Promise<http.Server> {
  const server = createDemoServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

export function stop(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
