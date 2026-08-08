/* global Buffer, URL, process */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const publicRoot = path.join(appRoot, "public");
const files = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
]);
const barrierIds = ["AP-001", "AP-002", "AP-003", "AP-004", "AP-005"];
let submissionCount = 0;

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}

async function readJson(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += value.byteLength;
    if (bytes > 16 * 1024) {
      throw new Error("Request body is too large.");
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = http.createServer(async (request, response) => {
  const method = request.method ?? "GET";
  const pathname = new URL(request.url ?? "/", "http://preview.local").pathname;
  const publicFile = files.get(pathname);

  if (method === "GET" && publicFile !== undefined) {
    const [filename, contentType] = publicFile;
    response.writeHead(200, {
      "content-type": contentType,
      "cache-control": "no-store",
    });
    fs.createReadStream(path.join(publicRoot, filename)).pipe(response);
    return;
  }

  if (method === "GET" && pathname === "/health") {
    sendJson(response, 200, {
      status: "ok",
      fixtureId: "emergency-aid-baseline-v1",
      barrierIds,
      submissionCount,
    });
    return;
  }

  if (method === "POST" && pathname === "/__fixture/reset") {
    submissionCount = 0;
    sendJson(response, 200, { status: "reset" });
    return;
  }

  if (method === "POST" && pathname === "/api/test-submissions") {
    try {
      const body = await readJson(request);
      if (
        typeof body !== "object" ||
        body === null ||
        body.applicationAccuracyConfirmed !== true
      ) {
        throw new Error("Application confirmation is required.");
      }
      submissionCount += 1;
      sendJson(response, 201, {
        status: "submitted",
        reference: `APP-${String(submissionCount).padStart(4, "0")}`,
      });
    } catch (error) {
      sendJson(response, 400, {
        error: "invalid_test_submission",
        message: error instanceof Error ? error.message : "Invalid request.",
      });
    }
    return;
  }

  sendJson(response, 404, { error: "not_found" });
});

const port = Number(process.env.DEMO_AID_APP_PORT ?? process.env.PORT ?? 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("Preview port must be an integer from 1 to 65535.");
}

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`AccessPath repair preview listening on ${port}\n`);
});
