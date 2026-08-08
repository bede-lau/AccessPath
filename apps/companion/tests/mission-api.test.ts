import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { QoderAuthenticationError } from "@accesspath/qoder-runner";

import { createServer, stop } from "../src/server";

const launchToken = "mission-api-token";
const directories: string[] = [];
let server: FastifyInstance | undefined;

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

function headers(extra: Record<string, string> = {}) {
  return {
    host: "127.0.0.1:4801",
    authorization: `Bearer ${launchToken}`,
    ...extra,
  };
}

afterEach(async () => {
  if (server !== undefined) {
    await stop(server);
    server = undefined;
  }
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("mission API revision and idempotency contract", () => {
  it("requires idempotency keys and expected revisions on mission transitions", async () => {
    const artifactRoot = await temporaryDirectory("mission-api-artifacts-");
    const repositoryRoot = await temporaryDirectory("mission-api-repo-");
    server = createServer({
      launchToken,
      artifactRoot,
      editableRepositoryRoot: repositoryRoot,
      missionSourceAcquirer: {
        acquire: async (source) => ({
          source,
          repositoryPath: repositoryRoot,
          snapshot: {
            schemaVersion: "1.0.0",
            id: "source-api",
            source,
            acquiredAt: "2026-07-30T09:00:00.000Z",
            repositoryDisplayName: "api",
            sourceCommit: "a".repeat(40),
            snapshotCommit: "a".repeat(40),
            treeHash: "b".repeat(40),
            contentManifestHash: "c".repeat(64),
            dirty: false,
            fileCount: 0,
            payloadBytes: 0,
          },
        }),
      },
      missionPlanner: async () => ({
        qoderSessionId: "00000000-0000-4000-8000-000000000001",
        rawOutput: "{}",
        userMessageId: "00000000-0000-4000-8000-000000000002",
        task: {
          schemaVersion: "1.0.0",
          id: "task-api-mission",
          title: "API mission",
          goal: "Check the staging page.",
          startUrl: "https://staging.example.test/",
          targetPolicy: "public",
          success: {},
          forbiddenActions: [],
          expectedSteps: [
            {
              id: "check-page",
              intent: "Check the page",
              action: { kind: "press", key: "Tab" },
              checkpoint: true,
            },
          ],
          fixtureValues: {},
          viewport: { width: 1280, height: 800 },
          timeoutMs: 10_000,
        },
      }),
      missionCommandSandbox: {
        preflight: async () => ({
          mode: "report-only",
          cliAvailable: false,
          daemonAvailable: false,
          image: "not-configured",
          reason: "Docker unavailable.",
        }),
        execute: async () => {
          throw new Error("not used");
        },
      },
      missionDeploymentResolver: async () => ({
        state: "unverified",
        deploymentUrl: "https://staging.example.test/",
        reason: "No trusted deployment metadata was available.",
      }),
      missionReconnaissance: async () => ({ title: "API mission" }),
    });

    const missingKey = await server.inject({
      method: "POST",
      url: "/api/missions",
      headers: headers({ "content-type": "application/json" }),
      payload: {
        stagingUrl: "https://staging.example.test/",
        source: { kind: "local", repositoryPath: repositoryRoot },
        objective: "Check the staging page.",
      },
    });
    expect(missingKey.statusCode).toBe(400);

    const missingCreateRevision = await server.inject({
      method: "POST",
      url: "/api/missions",
      headers: headers({
        "content-type": "application/json",
        "idempotency-key": "create-without-revision",
      }),
      payload: {
        stagingUrl: "https://staging.example.test/",
        source: { kind: "local", repositoryPath: repositoryRoot },
        objective: "Check the staging page.",
      },
    });
    expect(missingCreateRevision.statusCode).toBe(400);

    const created = await server.inject({
      method: "POST",
      url: "/api/missions",
      headers: headers({
        "content-type": "application/json",
        "idempotency-key": "create-api-mission",
        "expected-mission-revision": "0",
      }),
      payload: {
        stagingUrl: "https://staging.example.test/",
        source: { kind: "local", repositoryPath: repositoryRoot },
        objective: "Check the staging page.",
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.body).not.toContain(repositoryRoot);
    expect(created.json().mission).toMatchObject({
      revision: 1,
      state: "ready",
      title: "API mission",
      plan: { frozen: false },
      proofThread: expect.any(Array),
      availability: {
        execution: "sandbox-unavailable",
        source: "bound",
      },
    });
    const missionId = created.json().mission.id as string;

    const missingRevision = await server.inject({
      method: "PATCH",
      url: `/api/missions/${missionId}/plan`,
      headers: headers({
        "content-type": "application/json",
        "idempotency-key": "patch-api-mission",
      }),
      payload: {
        steps: [{ id: "check-page", instruction: "Inspect the page" }],
      },
    });
    expect(missingRevision.statusCode).toBe(400);

    const patched = await server.inject({
      method: "PATCH",
      url: `/api/missions/${missionId}/plan`,
      headers: headers({
        "content-type": "application/json",
        "idempotency-key": "patch-api-mission",
        "expected-mission-revision": "1",
      }),
      payload: {
        steps: [{ id: "check-page", instruction: "Inspect the page" }],
      },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().mission).toMatchObject({
      revision: 2,
      plan: {
        steps: [{ id: "check-page", instruction: "Inspect the page" }],
      },
    });

    const duplicate = await server.inject({
      method: "PATCH",
      url: `/api/missions/${missionId}/plan`,
      headers: headers({
        "content-type": "application/json",
        "idempotency-key": "patch-api-mission",
        "expected-mission-revision": "1",
      }),
      payload: {
        steps: [{ id: "check-page", instruction: "Ignored duplicate" }],
      },
    });
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json().mission.revision).toBe(2);
    expect(duplicate.json().mission.plan.steps[0].instruction).toBe(
      "Inspect the page",
    );

    const stale = await server.inject({
      method: "POST",
      url: `/api/missions/${missionId}/run`,
      headers: headers({
        "idempotency-key": "run-api-mission",
        "expected-mission-revision": "1",
      }),
      payload: {},
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.details.currentRevision).toBe(2);

    const cancelled = await server.inject({
      method: "POST",
      url: `/api/missions/${missionId}/cancel`,
      headers: headers({
        "idempotency-key": "cancel-api-mission",
        "expected-mission-revision": "2",
      }),
      payload: {},
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().mission).toMatchObject({
      state: "cancelled",
      reportAvailable: true,
      proofThread: [
        { stage: "observed", status: "blocked" },
        { stage: "scoped-repair", status: "blocked" },
        { stage: "verified", status: "blocked" },
        { stage: "merged", status: "blocked" },
      ],
    });
  });
});

describe("mission API Qoder authentication errors", () => {
  it("returns an actionable auth response for the Qoder CLI login error", async () => {
    const artifactRoot = await temporaryDirectory("mission-auth-artifacts-");
    const repositoryRoot = await temporaryDirectory("mission-auth-repo-");
    server = createServer({
      launchToken,
      artifactRoot,
      editableRepositoryRoot: repositoryRoot,
      missionSourceAcquirer: {
        acquire: async (source) => ({
          source,
          repositoryPath: repositoryRoot,
          snapshot: {
            schemaVersion: "1.0.0",
            id: "source-auth",
            source,
            acquiredAt: "2026-07-30T09:00:00.000Z",
            repositoryDisplayName: "auth",
            sourceCommit: "a".repeat(40),
            snapshotCommit: "a".repeat(40),
            treeHash: "b".repeat(40),
            contentManifestHash: "c".repeat(64),
            dirty: false,
            fileCount: 0,
            payloadBytes: 0,
          },
        }),
      },
      missionPlanner: async () => {
        throw new QoderAuthenticationError();
      },
      missionCommandSandbox: {
        preflight: async () => ({
          mode: "report-only",
          cliAvailable: false,
          daemonAvailable: false,
          image: "not-configured",
          reason: "Docker unavailable.",
        }),
        execute: async () => {
          throw new Error("not used");
        },
      },
      missionReconnaissance: async () => ({ title: "Auth mission" }),
    });

    const response = await server.inject({
      method: "POST",
      url: "/api/missions",
      headers: headers({
        "content-type": "application/json",
        "idempotency-key": "create-auth-mission",
        "expected-mission-revision": "0",
      }),
      payload: {
        stagingUrl: "https://staging.example.test/",
        source: { kind: "local", repositoryPath: repositoryRoot },
        objective: "Check the staging page.",
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: {
        code: "QODER_AUTH_REQUIRED",
        message:
          "Sign in to Qoder with qodercli login, then generate the mission plan again.",
      },
    });
    expect(response.body).not.toContain(repositoryRoot);
  });

  it("does not mask unrelated authentication text as a Qoder login error", async () => {
    const artifactRoot = await temporaryDirectory(
      "mission-auth-negative-artifacts-",
    );
    const repositoryRoot = await temporaryDirectory(
      "mission-auth-negative-repo-",
    );
    server = createServer({
      launchToken,
      artifactRoot,
      editableRepositoryRoot: repositoryRoot,
      missionSourceAcquirer: {
        acquire: async (source) => ({
          source,
          repositoryPath: repositoryRoot,
          snapshot: {
            schemaVersion: "1.0.0",
            id: "source-auth-negative",
            source,
            acquiredAt: "2026-07-30T09:00:00.000Z",
            repositoryDisplayName: "auth-negative",
            sourceCommit: "a".repeat(40),
            snapshotCommit: "a".repeat(40),
            treeHash: "b".repeat(40),
            contentManifestHash: "c".repeat(64),
            dirty: false,
            fileCount: 0,
            payloadBytes: 0,
          },
        }),
      },
      missionPlanner: async () => {
        throw new Error("Deployment authentication metadata is inconsistent.");
      },
      missionCommandSandbox: {
        preflight: async () => ({
          mode: "report-only",
          cliAvailable: false,
          daemonAvailable: false,
          image: "not-configured",
          reason: "Docker unavailable.",
        }),
        execute: async () => {
          throw new Error("not used");
        },
      },
      missionReconnaissance: async () => ({ title: "Auth mission" }),
    });

    const response = await server.inject({
      method: "POST",
      url: "/api/missions",
      headers: headers({
        "content-type": "application/json",
        "idempotency-key": "create-auth-negative-mission",
        "expected-mission-revision": "0",
      }),
      payload: {
        stagingUrl: "https://staging.example.test/",
        source: { kind: "local", repositoryPath: repositoryRoot },
        objective: "Check the staging page.",
      },
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({
      error: {
        code: "INTERNAL",
        message:
          "The selected agent provider could not generate a complete mission plan. Generate the plan again.",
      },
    });
  });
});
