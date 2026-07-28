import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import {
  start as startFixture,
  stop as stopFixture,
} from "../../demo-aid-app/src/index";
import { createServer, stop } from "../src/server";

const launchToken = "audit-integration-test-token";
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

async function waitForTerminal(auditId: string): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const response = await server!.inject({
      method: "GET",
      url: `/api/audits/${auditId}`,
      headers: headers(),
    });
    const audit = response.json().audit as Record<string, unknown>;
    if (["completed", "blocked", "failed", "cancelled"].includes(String(audit.state))) {
      return audit;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Audit did not reach a terminal state.");
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

describe("companion persisted audit API", () => {
  it("runs a URL-only local fixture and serves replay, reports, and authorized artifacts", async () => {
    const fixture = await startFixture(0);
    try {
      const address = fixture.address() as AddressInfo;
      const startUrl = `http://127.0.0.1:${address.port}/`;
      const artifactRoot = await temporaryDirectory(
        "accesspath-api-real-artifacts-",
      );
      const repositoryRoot = await temporaryDirectory(
        "accesspath-api-real-repo-",
      );
      server = createServer({
        launchToken,
        artifactRoot,
        editableRepositoryRoot: repositoryRoot,
      });

      const created = await server.inject({
        method: "POST",
        url: "/api/audits",
        headers: headers(),
        payload: { startUrl, targetPolicy: "local-explicit" },
      });
      expect(created.statusCode).toBe(201);
      expect(created.json().audit.task).toMatchObject({
        id: "task-emergency-aid-application",
        startUrl,
        targetPolicy: "local-explicit",
      });
      const auditId = created.json().audit.id as string;

      const started = await server.inject({
        method: "POST",
        url: `/api/audits/${auditId}/start`,
        headers: headers({ "idempotency-key": "real-start" }),
      });
      expect(started.statusCode).toBe(202);
      expect(started.json().audit.state).toBe("running");

      const terminal = await waitForTerminal(auditId);
      expect(terminal.state).toBe("blocked");

      const bundleResponse = await server.inject({
        method: "GET",
        url: `/api/audits/${auditId}/bundle`,
        headers: headers(),
      });
      expect(bundleResponse.statusCode).toBe(200);
      const bundle = bundleResponse.json();
      expect(bundle.auditSessionId).toBe(auditId);
      expect(bundle.findings).toHaveLength(5);

      for (const [format, contentType] of [
        ["html", "text/html"],
        ["markdown", "text/markdown"],
        ["json", "application/json"],
      ] as const) {
        const report = await server.inject({
          method: "GET",
          url: `/api/audits/${auditId}/report?format=${format}`,
          headers: headers(),
        });
        expect(report.statusCode).toBe(200);
        expect(report.headers["content-type"]).toContain(contentType);
        expect(report.body).toContain("AP-001");
        expect(report.body).not.toContain(artifactRoot);
        expect(report.body).not.toContain(repositoryRoot);
      }

      const fullReplay = await server.inject({
        method: "GET",
        url: `/api/sessions/${auditId}/events`,
        headers: headers(),
      });
      expect(fullReplay.statusCode).toBe(200);
      expect(fullReplay.headers["content-type"]).toContain("text/event-stream");
      const eventIds = [...fullReplay.body.matchAll(/^id: (.+)$/gm)].map(
        (match) => match[1],
      );
      expect(eventIds.length).toBeGreaterThan(3);

      const replayAfter = await server.inject({
        method: "GET",
        url: `/api/sessions/${auditId}/events`,
        headers: headers({ "last-event-id": eventIds[1]! }),
      });
      expect(replayAfter.body).not.toContain(`id: ${eventIds[0]}`);
      expect(replayAfter.body).not.toContain(`id: ${eventIds[1]}`);
      expect(replayAfter.body).toContain(`id: ${eventIds[2]}`);

      const artifact = bundle.artifacts[0];
      const downloaded = await server.inject({
        method: "GET",
        url: `/api/artifacts/${encodeURIComponent(artifact.id)}`,
        headers: headers(),
      });
      expect(downloaded.statusCode).toBe(200);
      expect(downloaded.headers["content-type"]).toContain(artifact.mimeType);

      const otherAudit = await server.inject({
        method: "POST",
        url: "/api/audits",
        headers: headers(),
        payload: { startUrl, targetPolicy: "local-explicit" },
      });
      const unauthorizedLookup = await server.inject({
        method: "GET",
        url: `/api/artifacts/${encodeURIComponent(artifact.id)}?sessionId=${otherAudit.json().audit.id}`,
        headers: headers(),
      });
      expect(unauthorizedLookup.statusCode).toBe(404);
      expect(unauthorizedLookup.body).not.toContain(artifact.relativePath);
      expect(unauthorizedLookup.body).not.toContain(artifactRoot);
    } finally {
      await stopFixture(fixture);
    }
  }, 60_000);
});
