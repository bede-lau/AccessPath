import { execFile } from "node:child_process";
import {
  appendFile,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  RepositoryConfigSchema,
  RepairManifestSchema,
  type ApprovalRequest,
} from "@accesspath/contracts";
import { DeterministicMockQoderAdapter } from "@accesspath/qoder-runner";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { createServer, stop } from "../src/server";

const execFileAsync = promisify(execFile);
const launchToken = "repair-api-test-token";
const temporaryDirectories: string[] = [];
let server: FastifyInstance | undefined;

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    windowsHide: true,
  });
  return result.stdout.trim();
}

async function createRepository(): Promise<{
  baseCommit: string;
  repositoryRoot: string;
}> {
  const repositoryRoot = await temporaryDirectory("accesspath-repair-repo-");
  await mkdir(join(repositoryRoot, "src"), { recursive: true });
  await mkdir(join(repositoryRoot, "tests"), { recursive: true });
  await writeFile(join(repositoryRoot, "src", "feature.ts"), "old source\n");
  await writeFile(
    join(repositoryRoot, "tests", "feature.test.ts"),
    "old test\n",
  );
  await writeFile(
    join(repositoryRoot, "tests", "verify.mjs"),
    "console.log('repair verification passed');\n",
  );
  await git(repositoryRoot, ["init", "-b", "main"]);
  await git(repositoryRoot, ["config", "user.name", "AccessPath Test"]);
  await git(repositoryRoot, [
    "config",
    "user.email",
    "accesspath@example.test",
  ]);
  await git(repositoryRoot, ["add", "."]);
  await git(repositoryRoot, ["commit", "-m", "fixture"]);
  return {
    baseCommit: await git(repositoryRoot, ["rev-parse", "HEAD"]),
    repositoryRoot,
  };
}

function repairInputs(repositoryRoot: string, baseCommit: string) {
  const repository = RepositoryConfigSchema.parse({
    repositoryPath: repositoryRoot,
    baseBranch: "main",
    baseCommit,
    startCommand: {
      id: "preview",
      label: "Preview",
      executable: "node",
      args: ["-e", "setInterval(() => {}, 1000)"],
      cwdRelative: ".",
      timeoutMs: 10_000,
      category: "start",
    },
    testCommands: [
      {
        id: "verify-repair",
        label: "Verify repair",
        executable: process.execPath,
        args: ["tests/verify.mjs"],
        cwdRelative: ".",
        timeoutMs: 5_000,
        category: "test",
      },
    ],
    previewUrl: "http://127.0.0.1:4174/",
    allowedPathGlobs: ["src/**", "tests/**"],
  });
  const manifest = RepairManifestSchema.parse({
    schemaVersion: "1.0.0",
    id: "manifest-ap-001",
    auditBundleId: "audit-bundle-001",
    findingIds: ["AP-001"],
    affectedActions: ["Choose eligibility"],
    observations: ["Keyboard activation is unavailable."],
    evidenceRefs: [
      {
        id: "artifact-ap-001",
        kind: "axe-result",
        mimeType: "application/json",
        sha256: "a".repeat(64),
        relativePath: "artifacts/ap-001.json",
        sensitivity: "project",
        description: "Validated browser evidence.",
      },
    ],
    constraints: ["Keep unrelated behavior unchanged."],
    nonGoals: ["Do not claim universal accessibility."],
    allowedPathGlobs: ["src/**", "tests/**"],
    verification: {
      taskContract: {
        schemaVersion: "1.0.0",
        id: "task-ap-001",
        title: "Eligibility",
        goal: "Choose eligibility with the keyboard.",
        startUrl: "http://127.0.0.1:4174/",
        targetPolicy: "local-explicit",
        success: { visibleText: "Selected" },
        forbiddenActions: [],
        expectedSteps: [
          {
            id: "choose",
            intent: "Choose eligibility",
            action: { kind: "press", key: "Space" },
            checkpoint: true,
          },
        ],
        fixtureValues: {},
        viewport: { width: 1280, height: 800 },
        timeoutMs: 10_000,
      },
      commands: [
        {
          id: "verify-repair",
          label: "Verify repair",
          executable: process.execPath,
          args: ["tests/verify.mjs"],
          cwdRelative: ".",
          timeoutMs: 5_000,
          category: "test",
        },
      ],
    },
  });
  return { manifest, repository };
}

function headers(
  additional: Record<string, string> = {},
): Record<string, string> {
  return {
    host: "127.0.0.1:4801",
    authorization: `Bearer ${launchToken}`,
    ...additional,
  };
}

async function repairResource(repairId: string) {
  const response = await server!.inject({
    method: "GET",
    url: `/api/repairs/${repairId}`,
    headers: headers(),
  });
  expect(response.statusCode).toBe(200);
  return response.json();
}

async function waitForState(
  repairId: string,
  expected: string,
): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const resource = await repairResource(repairId);
    if (resource.repair.state === expected) {
      return resource;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Repair did not reach ${expected}.`);
}

async function approvePending(
  repairId: string,
  kind: ApprovalRequest["kind"],
): Promise<string> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const resource = await repairResource(repairId);
    const pending = resource.approvals.find(
      (record: { request: ApprovalRequest }) =>
        record.request.kind === kind &&
        record.request.state === "pending",
    ) as { request: ApprovalRequest } | undefined;
    if (pending !== undefined) {
      const response = await server!.inject({
        method: "POST",
        url: `/api/approvals/${pending.request.id}/decision`,
        headers: headers({
          "idempotency-key": `approve-${pending.request.id}`,
        }),
        payload: { decision: "approve-once" },
      });
      expect(response.statusCode).toBe(200);
      return pending.request.id;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`No pending ${kind} approval appeared.`);
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

describe("companion repair API", () => {
  it("isolates approved edits, streams durable events, and rewinds without changing the base", async () => {
    const { baseCommit, repositoryRoot } = await createRepository();
    const artifactRoot = await temporaryDirectory(
      "accesspath-repair-artifacts-",
    );
    const { manifest, repository } = repairInputs(
      repositoryRoot,
      baseCommit,
    );
    server = createServer({
      launchToken,
      artifactRoot,
      editableRepositoryRoot: repositoryRoot,
      qoderAdapter: new DeterministicMockQoderAdapter({
        diagnosis: "Change the source and add one regression test.",
        edits: [
          {
            filePath: "src/feature.ts",
            oldText: "old source",
            newText: "new source",
          },
          {
            filePath: "tests/feature.test.ts",
            oldText: "old test",
            newText: "new test",
          },
        ],
      }),
    });

    const validation = await server.inject({
      method: "POST",
      url: "/api/repositories/validate",
      headers: headers(),
      payload: { repositoryPath: join(repositoryRoot, "src") },
    });
    expect(validation.statusCode).toBe(200);
    expect(validation.json().repository).toMatchObject({
      repositoryDisplayName: expect.any(String),
      baseBranch: "main",
      baseCommit,
      clean: true,
    });
    expect(validation.body).not.toContain(repositoryRoot);

    const created = await server.inject({
      method: "POST",
      url: "/api/repairs",
      headers: headers(),
      payload: { repository, manifest },
    });
    expect(created.statusCode).toBe(201);
    const repairId = created.json().repair.id as string;
    expect(created.body).not.toContain(repositoryRoot);

    const prepared = await server.inject({
      method: "POST",
      url: `/api/repairs/${repairId}/prepare`,
      headers: headers(),
    });
    expect(prepared.statusCode).toBe(202);
    expect(prepared.json().repair).toMatchObject({
      state: "diagnosing",
      branch: `accesspath/${repairId}`,
    });

    const diagnosed = await server.inject({
      method: "POST",
      url: `/api/repairs/${repairId}/diagnose`,
      headers: headers(),
    });
    expect(diagnosed.statusCode).toBe(202);
    await waitForState(repairId, "awaiting-plan-approval");
    await approvePending(repairId, "plan");
    await waitForState(repairId, "editing");

    const started = await server.inject({
      method: "POST",
      url: `/api/repairs/${repairId}/start`,
      headers: headers({ "idempotency-key": "start-repair" }),
    });
    expect(started.statusCode).toBe(202);
    const duplicateStart = await server.inject({
      method: "POST",
      url: `/api/repairs/${repairId}/start`,
      headers: headers({ "idempotency-key": "start-repair" }),
    });
    expect(duplicateStart.statusCode).toBe(202);
    expect(duplicateStart.json().repair.id).toBe(repairId);

    const prematureVerification = await server.inject({
      method: "POST",
      url: `/api/repairs/${repairId}/verify`,
      headers: headers(),
    });
    expect(prematureVerification.statusCode).toBe(409);
    expect(prematureVerification.json().error.message).toContain(
      "must finish before verification",
    );

    await approvePending(repairId, "tool");
    await approvePending(repairId, "tool");
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const diffResponse = await server.inject({
        method: "GET",
        url: `/api/repairs/${repairId}/diff`,
        headers: headers(),
      });
      if (diffResponse.json().diff.changedFiles.length === 2) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    const diffResponse = await server.inject({
      method: "GET",
      url: `/api/repairs/${repairId}/diff`,
      headers: headers(),
    });
    expect(diffResponse.json().diff.changedFiles).toEqual([
      "src/feature.ts",
      "tests/feature.test.ts",
    ]);
    expect(diffResponse.body).toContain("new source");
    expect(diffResponse.body).not.toContain(repositoryRoot);
    expect(await readFile(join(repositoryRoot, "src", "feature.ts"), "utf8"))
      .toBe("old source\n");

    const verified = await server.inject({
      method: "POST",
      url: `/api/repairs/${repairId}/verify`,
      headers: headers({ "idempotency-key": "verify-repair-1" }),
    });
    expect(verified.statusCode).toBe(202);
    expect(verified.json().repair.state).toBe("awaiting-patch-approval");
    const duplicateVerification = await server.inject({
      method: "POST",
      url: `/api/repairs/${repairId}/verify`,
      headers: headers({ "idempotency-key": "verify-repair-1" }),
    });
    expect(duplicateVerification.statusCode).toBe(202);
    expect(duplicateVerification.json().repair.state).toBe(
      "awaiting-patch-approval",
    );
    const verifiedResource = await repairResource(repairId);
    expect(verifiedResource.tests).toEqual([
      expect.objectContaining({
        commandId: "verify-repair",
        state: "passed",
        exitCode: 0,
      }),
    ]);
    const workspace = JSON.parse(
      await readFile(
        join(
          artifactRoot,
          "repairs",
          repairId,
          "workspace.private.json",
        ),
        "utf8",
      ),
    ) as { worktreePath: string };
    await appendFile(
      join(workspace.worktreePath, "src", "feature.ts"),
      "post-verification mutation\n",
    );
    const patchApproval = verifiedResource.approvals.find(
      (record: { request: ApprovalRequest }) =>
        record.request.kind === "patch" &&
        record.request.state === "pending",
    ) as { request: ApprovalRequest };
    const stalePatchDecision = await server.inject({
      method: "POST",
      url: `/api/approvals/${patchApproval.request.id}/decision`,
      headers: headers({ "idempotency-key": "stale-patch-decision" }),
      payload: { decision: "approve-once" },
    });
    expect(stalePatchDecision.statusCode).toBe(409);
    expect(stalePatchDecision.json().error.message).toContain(
      "must be verified again",
    );
    const invalidatedResource = await repairResource(repairId);
    expect(invalidatedResource.repair.state).toBe("editing");
    expect(invalidatedResource.tests).toEqual([]);
    expect(
      invalidatedResource.approvals.find(
        (record: { request: ApprovalRequest }) =>
          record.request.id === patchApproval.request.id,
      ).request.state,
    ).toBe("expired");

    const reverified = await server.inject({
      method: "POST",
      url: `/api/repairs/${repairId}/verify`,
      headers: headers({ "idempotency-key": "verify-repair-2" }),
    });
    expect(reverified.statusCode).toBe(202);
    expect(reverified.json().repair.state).toBe("awaiting-patch-approval");
    const checkpointId = reverified.json().repair.latestCheckpointId as string;

    const preview = await server.inject({
      method: "POST",
      url: `/api/checkpoints/${checkpointId}/rewind-preview`,
      headers: headers({ "idempotency-key": "rewind-preview" }),
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().preview.affectedFiles).toEqual([
      "src/feature.ts",
      "tests/feature.test.ts",
    ]);
    expect(preview.json().preview.staleVerificationIds).toEqual([
      "verification-verify-repair",
    ]);
    const rewindApprovalId = preview.json().approval.id as string;
    const duplicatePreview = await server.inject({
      method: "POST",
      url: `/api/checkpoints/${checkpointId}/rewind-preview`,
      headers: headers({ "idempotency-key": "rewind-preview" }),
    });
    expect(duplicatePreview.json().approval.id).toBe(rewindApprovalId);
    const rewindApproval = await server.inject({
      method: "POST",
      url: `/api/approvals/${rewindApprovalId}/decision`,
      headers: headers({ "idempotency-key": "approve-rewind" }),
      payload: { decision: "approve-once" },
    });
    expect(rewindApproval.statusCode).toBe(200);
    const duplicateRewindApproval = await server.inject({
      method: "POST",
      url: `/api/approvals/${rewindApprovalId}/decision`,
      headers: headers({ "idempotency-key": "approve-rewind" }),
      payload: { decision: "deny" },
    });
    expect(duplicateRewindApproval.statusCode).toBe(200);
    expect(duplicateRewindApproval.json().approval.decision.decision).toBe(
      "approve-once",
    );
    const rewind = await server.inject({
      method: "POST",
      url: `/api/checkpoints/${checkpointId}/rewind`,
      headers: headers({ "idempotency-key": "apply-rewind" }),
      payload: { approvalId: rewindApprovalId },
    });
    expect(rewind.statusCode).toBe(200);
    expect(rewind.json().diff.changedFiles).toEqual([]);
    const duplicateRewind = await server.inject({
      method: "POST",
      url: `/api/checkpoints/${checkpointId}/rewind`,
      headers: headers({ "idempotency-key": "apply-rewind" }),
      payload: { approvalId: rewindApprovalId },
    });
    expect(duplicateRewind.statusCode).toBe(200);
    expect(duplicateRewind.json().diff.changedFiles).toEqual([]);
    const rewoundResource = await repairResource(repairId);
    expect(rewoundResource.tests).toEqual([]);
    expect(
      rewoundResource.approvals.find(
        (record: { request: { kind: string } }) =>
          record.request.kind === "patch",
      )?.request.state,
    ).toBe("expired");

    const cancelled = await server.inject({
      method: "POST",
      url: `/api/repairs/${repairId}/cancel`,
      headers: headers({ "idempotency-key": "cancel-repair" }),
    });
    expect(cancelled.json().repair.state).toBe("cancelled");
    const duplicateCancel = await server.inject({
      method: "POST",
      url: `/api/repairs/${repairId}/cancel`,
      headers: headers({ "idempotency-key": "cancel-repair" }),
    });
    expect(duplicateCancel.json().repair.state).toBe("cancelled");

    const events = await server.inject({
      method: "GET",
      url: `/api/sessions/${repairId}/events`,
      headers: headers(),
    });
    expect(events.statusCode).toBe(200);
    const requestedIndex = events.body.indexOf("event: tool.requested");
    const approvedIndex = events.body.indexOf("event: tool.approved");
    const startedIndex = events.body.indexOf("event: tool.started");
    expect(requestedIndex).toBeGreaterThan(-1);
    expect(approvedIndex).toBeGreaterThan(requestedIndex);
    expect(startedIndex).toBeGreaterThan(approvedIndex);
    expect(events.body).not.toContain(repositoryRoot);
    expect(events.body).not.toContain(artifactRoot);

    expect(await git(repositoryRoot, ["rev-parse", "HEAD"])).toBe(baseCommit);
    expect(await git(repositoryRoot, ["status", "--porcelain"])).toBe("");
    expect(await readFile(join(repositoryRoot, "src", "feature.ts"), "utf8"))
      .toBe("old source\n");
  }, 30_000);

  it("aborts an in-flight verification when the repair is cancelled", async () => {
    const { baseCommit, repositoryRoot } = await createRepository();
    const artifactRoot = await temporaryDirectory(
      "accesspath-cancel-artifacts-",
    );
    const { manifest, repository } = repairInputs(
      repositoryRoot,
      baseCommit,
    );
    let verificationStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      verificationStarted = resolve;
    });
    let observedAbort = false;
    server = createServer({
      launchToken,
      artifactRoot,
      editableRepositoryRoot: repositoryRoot,
      qoderAdapter: new DeterministicMockQoderAdapter({
        diagnosis: "Change the source and add one regression test.",
        edits: [
          {
            filePath: "src/feature.ts",
            oldText: "old source",
            newText: "new source",
          },
          {
            filePath: "tests/feature.test.ts",
            oldText: "old test",
            newText: "new test",
          },
        ],
      }),
      repairCommandRunner: async (_command, _worktreePath, signal) =>
        new Promise((resolve) => {
          verificationStarted();
          const cancelled = () => {
            observedAbort = true;
            resolve({
              state: "cancelled",
              durationMs: 1,
              output: "verification cancelled",
            });
          };
          if (signal?.aborted) {
            cancelled();
          } else {
            signal?.addEventListener("abort", cancelled, { once: true });
          }
        }),
    });

    const created = await server.inject({
      method: "POST",
      url: "/api/repairs",
      headers: headers(),
      payload: { repository, manifest },
    });
    const repairId = created.json().repair.id as string;
    await server.inject({
      method: "POST",
      url: `/api/repairs/${repairId}/prepare`,
      headers: headers(),
    });
    await server.inject({
      method: "POST",
      url: `/api/repairs/${repairId}/diagnose`,
      headers: headers(),
    });
    await waitForState(repairId, "awaiting-plan-approval");
    await approvePending(repairId, "plan");
    await server.inject({
      method: "POST",
      url: `/api/repairs/${repairId}/start`,
      headers: headers(),
    });
    await approvePending(repairId, "tool");
    await approvePending(repairId, "tool");
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const diff = await server.inject({
        method: "GET",
        url: `/api/repairs/${repairId}/diff`,
        headers: headers(),
      });
      if (diff.json().diff.changedFiles.length === 2) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const eventsPath = join(
      artifactRoot,
      "repairs",
      repairId,
      "events.ndjson",
    );
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const events = await readFile(eventsPath, "utf8");
      if (events.includes('"type":"diff.updated"')) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    const verification = server.inject({
      method: "POST",
      url: `/api/repairs/${repairId}/verify`,
      headers: headers({ "idempotency-key": "cancelled-verification" }),
    });
    void verification.catch(() => undefined);
    await started;
    await waitForState(repairId, "verifying");
    const cancelled = await server.inject({
      method: "POST",
      url: `/api/repairs/${repairId}/cancel`,
      headers: headers({ "idempotency-key": "cancel-during-verification" }),
    });
    const verificationResponse = await verification;

    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().repair.state).toBe("cancelled");
    expect(verificationResponse.statusCode).toBe(202);
    expect(verificationResponse.json().repair.state).toBe("cancelled");
    expect(observedAbort).toBe(true);
    expect((await repairResource(repairId)).tests).toEqual([
      expect.objectContaining({
        commandId: "verify-repair",
        state: "cancelled",
      }),
    ]);
    expect(await git(repositoryRoot, ["rev-parse", "HEAD"])).toBe(baseCommit);
    expect(await git(repositoryRoot, ["status", "--porcelain"])).toBe("");
  }, 30_000);
});
