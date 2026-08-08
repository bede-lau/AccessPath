import os from "node:os";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  createServer,
  getLaunchToken,
  start,
  stop,
} from "../src/server";

describe("GET /api/health", () => {
  let server: FastifyInstance | undefined;
  const launchToken = "test-launch-token";
  const temporaryDirectories: string[] = [];

  async function temporaryDirectory(prefix: string): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), prefix));
    temporaryDirectories.push(directory);
    return directory;
  }

  function authorizedHeaders(
    overrides: Record<string, string> = {},
  ): Record<string, string> {
    return {
      host: "127.0.0.1:4801",
      authorization: `Bearer ${launchToken}`,
      ...overrides,
    };
  }

  afterEach(async () => {
    if (server) {
      await stop(server);
      server = undefined;
    }
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it("returns 200 with status, schemaVersion and an ISO timestamp", async () => {
    server = createServer({ launchToken });
    const response = await server.inject({
      method: "GET",
      url: "/api/health",
      headers: authorizedHeaders(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe("ok");
    expect(body.schemaVersion).toBe("1.0.0");
    expect(typeof body.timestamp).toBe("string");
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
  });

  it("sets cache-control: no-store", async () => {
    server = createServer({ launchToken });
    const response = await server.inject({
      method: "GET",
      url: "/api/health",
      headers: authorizedHeaders(),
    });

    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("leaks no absolute paths in the body", async () => {
    server = createServer({ launchToken });
    const response = await server.inject({
      method: "GET",
      url: "/api/health",
      headers: authorizedHeaders(),
    });

    // No Windows drive letters, no POSIX home dirs, no homedir of this machine.
    expect(response.body).not.toMatch(/[A-Za-z]:\\/);
    expect(response.body).not.toMatch(/\/(home|Users)\//);
    expect(response.body).not.toContain(os.homedir());
  });

  it("start() with port 0 binds an OS-selected loopback port and stops cleanly", async () => {
    server = await start({ host: "127.0.0.1", port: 0, launchToken });

    const addresses = server.addresses();
    expect(addresses.length).toBeGreaterThan(0);
    expect(addresses[0].address).toBe("127.0.0.1");
    expect(addresses[0].port).toBeGreaterThan(0);

    await stop(server);
    server = undefined;
  });

  it("rejects missing tokens, wrong origins, and wrong hosts", async () => {
    server = createServer({ launchToken });

    const missingToken = await server.inject({
      method: "GET",
      url: "/api/health",
      headers: { host: "127.0.0.1:4801" },
    });
    expect(missingToken.statusCode).toBe(401);

    const wrongOrigin = await server.inject({
      method: "GET",
      url: "/api/health",
      headers: authorizedHeaders({ origin: "https://attacker.example" }),
    });
    expect(wrongOrigin.statusCode).toBe(403);

    const wrongHost = await server.inject({
      method: "GET",
      url: "/api/health",
      headers: authorizedHeaders({ host: "192.168.1.20:4801" }),
    });
    expect(wrongHost.statusCode).toBe(403);
  });

  it("generates a launch token and refuses non-loopback binds", async () => {
    server = createServer();
    expect(getLaunchToken(server)).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    await stop(server);
    server = undefined;

    await expect(start({ host: "0.0.0.0", port: 0 })).rejects.toThrow(
      /127\.0\.0\.1/,
    );
  });

  it("fails readiness when persisted mission recovery cannot be read", async () => {
    const artifactRoot = await temporaryDirectory(
      "health-recovery-artifacts-",
    );
    const repositoryRoot = await temporaryDirectory(
      "health-recovery-repository-",
    );
    await mkdir(join(artifactRoot, "missions", "broken-mission"), {
      recursive: true,
    });
    await writeFile(
      join(
        artifactRoot,
        "missions",
        "broken-mission",
        "mission.json",
      ),
      "{not-json}\n",
    );
    server = createServer({
      launchToken,
      artifactRoot,
      editableRepositoryRoot: repositoryRoot,
    });
    await expect(server.ready()).rejects.toThrow(
      "Mission recovery failed for broken-mission.",
    );
  });
});
