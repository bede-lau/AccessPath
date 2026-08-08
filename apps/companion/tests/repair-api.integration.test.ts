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
  AuditBundleSchema,
  RepositoryConfigSchema,
  RepairManifestSchema,
  type ApprovalRequest,
  type QoderTurn,
  type TaskContract,
} from "@accesspath/contracts";
import {
  createAuditDirectoryLayout,
  persistAuditBundle,
  regenerateReportsFromPersistedEvidence,
} from "@accesspath/evidence";
import { DeterministicMockQoderAdapter } from "@accesspath/qoder-runner";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { createServer, stop } from "../src/server";

const execFileAsync = promisify(execFile);
const INTEGRATION_TEST_TIMEOUT = 60_000;
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
  await writeFile(
    join(repositoryRoot, "preview.mjs"),
    [
      "import http from 'node:http';",
      "const port = Number(process.env.PORT);",
      "http.createServer((_request, response) => {",
      "  response.writeHead(200, {'content-type': 'text/html'});",
      "  response.end('<p>Selected</p>');",
      "}).listen(port, '127.0.0.1');",
      "",
    ].join("\n"),
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
      executable: process.execPath,
      args: ["preview.mjs"],
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

async function seedSourceAudit(
  artifactRoot: string,
  task: TaskContract,
): Promise<void> {
  const layout = await createAuditDirectoryLayout(
    artifactRoot,
    "audit-source-ap-001",
  );
  await persistAuditBundle(
    layout,
    AuditBundleSchema.omit({ integrity: true }).parse({
      schemaVersion: "1.0.0",
      id: "audit-bundle-001",
      auditSessionId: "audit-source-ap-001",
      runId: "run-source-ap-001",
      createdAt: "2026-07-28T00:00:00.000Z",
      environment: {
        browser: "chromium",
        browserVersion: "1",
        axeVersion: "1",
        viewport: task.viewport,
        targetOrigin: task.startUrl,
      },
      task,
      outcome: "blocked",
      steps: [
        {
          id: "step-before-ap-001",
          instructionId: "choose",
          sequence: 1,
          state: "blocked",
          intent: "Choose eligibility",
          attemptedAction: "Press Space",
          observedOutcome: "The control did not activate.",
          url: task.startUrl,
          title: "Eligibility",
          startedAt: "2026-07-28T00:00:00.000Z",
          completedAt: "2026-07-28T00:00:01.000Z",
          evidence: [],
        },
      ],
      findings: [
        {
          id: "AP-001",
          title: "Eligibility is not keyboard operable",
          affectedAction: "Choose eligibility",
          source: "task-runner",
          evidenceLabel: "observed",
          severity: "blocker",
          modality: ["keyboard"],
          state: "open",
          stepId: "choose",
          wcagRefs: ["2.1.1"],
          observation: "Space did not activate the choice.",
          reproduction: ["Press Space on the choice."],
          evidenceIds: [],
          manualReview: [],
        },
      ],
      artifacts: [],
      limitations: [],
    }),
  );
  await regenerateReportsFromPersistedEvidence(layout);
}

function createReplayAuditRunner() {
  return async (
    task: TaskContract,
    options: {
      artifactRoot: string;
      auditSessionId?: string;
      eventWriter?: (
        event: import("@accesspath/contracts").AccessPathEvent<
          Record<string, unknown>
        >,
      ) => Promise<unknown>;
    },
  ) => {
    const auditSessionId = options.auditSessionId ?? "audit-after-repair";
    const layout = await createAuditDirectoryLayout(
      options.artifactRoot,
      auditSessionId,
    );
    const bundle = await persistAuditBundle(
      layout,
      AuditBundleSchema.omit({ integrity: true }).parse({
        schemaVersion: "1.0.0",
        id: `bundle-${auditSessionId}`,
        auditSessionId,
        runId: `run-${auditSessionId}`,
        createdAt: "2026-07-28T00:00:02.000Z",
        environment: {
          browser: "chromium",
          browserVersion: "1",
          axeVersion: "1",
          viewport: task.viewport,
          targetOrigin: task.startUrl,
        },
        task,
        outcome: "passed",
        steps: [
          {
            id: "step-after-ap-001",
            instructionId: "choose",
            sequence: 1,
            state: "passed",
            intent: "Choose eligibility",
            attemptedAction: "Press Space",
            observedOutcome: "Selected",
            url: task.startUrl,
            title: "Eligibility",
            startedAt: "2026-07-28T00:00:02.000Z",
            completedAt: "2026-07-28T00:00:03.000Z",
            evidence: [],
          },
        ],
        findings: [],
        artifacts: [],
        limitations: [],
      }),
    );
    await options.eventWriter?.({
      schemaVersion: "1.0.0",
      eventId: `event-${auditSessionId}`,
      sessionId: auditSessionId,
      sequence: 1,
      timestamp: "2026-07-28T00:00:03.000Z",
      type: "audit.step.completed",
      payload: { step: bundle.steps[0] },
    });
    return {
      auditSessionId,
      bundle,
      reports: await regenerateReportsFromPersistedEvidence(layout),
    };
  };
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

afterEach(
  async () => {
    if (server !== undefined) {
      await stop(server);
      server = undefined;
    }
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  },
  30_000,
);

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
    await seedSourceAudit(artifactRoot, manifest.verification.taskContract);
    const qoderAdapter = new DeterministicMockQoderAdapter({
      completionDelayMs: 250,
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
    });
    server = createServer({
      launchToken,
      artifactRoot,
      editableRepositoryRoot: repositoryRoot,
      qoderAdapter,
      auditRunner: createReplayAuditRunner(),
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
      headers: headers({ "idempotency-key": "diagnose-repair" }),
    });
    expect(diagnosed.statusCode).toBe(202);
    const duplicateDiagnosis = await server.inject({
      method: "POST",
      url: `/api/repairs/${repairId}/diagnose`,
      headers: headers({ "idempotency-key": "diagnose-repair" }),
    });
    expect(duplicateDiagnosis.statusCode).toBe(202);
    expect(qoderAdapter.starts).toHaveLength(1);
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
    const qoderResource = await repairResource(repairId);
    expect(qoderAdapter.starts).toHaveLength(2);
    expect(qoderAdapter.starts[1]).toMatchObject({
      maxTurns: 8,
      model: "efficient",
      resume: true,
      sessionId: qoderAdapter.starts[0]?.sessionId,
    });
    expect(qoderResource.repair.qoderTurns).toEqual([
      expect.objectContaining({
        mode: "diagnosis",
        status: "completed",
        numTurns: 1,
        inputTokens: 12,
        outputTokens: 8,
      }),
      expect.objectContaining({
        mode: "repair",
        status: "completed",
        resumed: true,
        requestedModel: "efficient",
        maxTurns: 8,
      }),
    ]);
    const completedPause = await server.inject({
      method: "POST",
      url: `/api/repairs/${repairId}/pause`,
      headers: headers({ "idempotency-key": "pause-completed-turn" }),
    });
    expect(completedPause.statusCode).toBe(200);
    expect(completedPause.json().repair.state).toBe("editing");
    expect(qoderAdapter.starts).toHaveLength(2);

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
  }, INTEGRATION_TEST_TIMEOUT);

  it("resumes an interrupted paid turn without replacing its checkpoint or transcript", async () => {
    const { baseCommit, repositoryRoot } = await createRepository();
    const artifactRoot = await temporaryDirectory(
      "accesspath-resume-artifacts-",
    );
    const { manifest, repository } = repairInputs(
      repositoryRoot,
      baseCommit,
    );
    await seedSourceAudit(artifactRoot, manifest.verification.taskContract);
    const qoderAdapter = new DeterministicMockQoderAdapter({
      completionDelayMs: 100,
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
    });
    server = createServer({
      launchToken,
      artifactRoot,
      editableRepositoryRoot: repositoryRoot,
      qoderAdapter,
      auditRunner: createReplayAuditRunner(),
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
      headers: headers({ "idempotency-key": "diagnose-once" }),
    });
    await waitForState(repairId, "awaiting-plan-approval");
    await approvePending(repairId, "plan");
    await waitForState(repairId, "editing");

    const started = await server.inject({
      method: "POST",
      url: `/api/repairs/${repairId}/start`,
      headers: headers({ "idempotency-key": "start-once" }),
    });
    const checkpointId = started.json().repair.latestCheckpointId as string;
    const paused = await server.inject({
      method: "POST",
      url: `/api/repairs/${repairId}/pause`,
      headers: headers({ "idempotency-key": "pause-once" }),
    });
    expect(paused.statusCode).toBe(200);
    expect(paused.json().repair.state).toBe("paused");
    const duplicatePause = await server.inject({
      method: "POST",
      url: `/api/repairs/${repairId}/pause`,
      headers: headers({ "idempotency-key": "pause-once" }),
    });
    expect(duplicatePause.statusCode).toBe(200);

    const resumed = await server.inject({
      method: "POST",
      url: `/api/repairs/${repairId}/resume`,
      headers: headers({ "idempotency-key": "resume-once" }),
    });
    expect(resumed.statusCode).toBe(202);
    expect(resumed.json().repair.latestCheckpointId).toBe(checkpointId);
    const duplicateResume = await server.inject({
      method: "POST",
      url: `/api/repairs/${repairId}/resume`,
      headers: headers({ "idempotency-key": "resume-once" }),
    });
    expect(duplicateResume.statusCode).toBe(202);

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

    const resource = await repairResource(repairId);
    expect(resource.repair.latestCheckpointId).toBe(checkpointId);
    expect(qoderAdapter.starts).toHaveLength(3);
    expect(qoderAdapter.starts[2]).toMatchObject({
      resume: true,
      sessionId: qoderAdapter.starts[0]?.sessionId,
    });
    expect(
      resource.repair.qoderTurns?.map(
        (turn: QoderTurn) => turn.status,
      ),
    ).toEqual(["completed", "interrupted", "completed"]);
  }, INTEGRATION_TEST_TIMEOUT);

  it("resumes the same paid command key when no completed transcript exists", async () => {
    const { baseCommit, repositoryRoot } = await createRepository();
    const artifactRoot = await temporaryDirectory(
      "accesspath-restart-artifacts-",
    );
    const { manifest, repository } = repairInputs(
      repositoryRoot,
      baseCommit,
    );
    await seedSourceAudit(artifactRoot, manifest.verification.taskContract);
    const qoderAdapter = new DeterministicMockQoderAdapter({
      diagnosis: "Change the source and add one regression test.",
      streamDelayMs: 250,
      edits: [
        {
          filePath: "src/feature.ts",
          oldText: "old source",
          newText: "new source",
        },
      ],
    });
    const serverConfig = {
      launchToken,
      artifactRoot,
      editableRepositoryRoot: repositoryRoot,
      qoderAdapter,
      auditRunner: createReplayAuditRunner(),
    };
    server = createServer(serverConfig);

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
      headers: headers({ "idempotency-key": "diagnose-before-restart" }),
    });
    await waitForState(repairId, "awaiting-plan-approval");
    await approvePending(repairId, "plan");
    await waitForState(repairId, "editing");

    await server.inject({
      method: "POST",
      url: `/api/repairs/${repairId}/start`,
      headers: headers({ "idempotency-key": "same-paid-command" }),
    });
    expect(qoderAdapter.starts).toHaveLength(2);
    await stop(server);
    server = undefined;

    server = createServer(serverConfig);
    const recovered = await Promise.all([
      server.inject({
        method: "POST",
        url: `/api/repairs/${repairId}/start`,
        headers: headers({ "idempotency-key": "same-paid-command" }),
      }),
      server.inject({
        method: "POST",
        url: `/api/repairs/${repairId}/start`,
        headers: headers({ "idempotency-key": "same-paid-command" }),
      }),
    ]);
    expect(recovered.map((response) => response.statusCode)).toEqual([
      202,
      202,
    ]);
    expect(qoderAdapter.starts).toHaveLength(3);
    expect(qoderAdapter.starts[2]).toMatchObject({
      resume: true,
      sessionId: qoderAdapter.starts[0]?.sessionId,
    });
    const recoveredResource = await repairResource(repairId);
    expect(
      recoveredResource.repair.qoderTurns.map(
        (turn: QoderTurn) => turn.status,
      ),
    ).toEqual(["completed", "interrupted", "running"]);

    await server.inject({
      method: "POST",
      url: `/api/repairs/${repairId}/pause`,
      headers: headers({ "idempotency-key": "pause-recovered-turn" }),
    });
  }, INTEGRATION_TEST_TIMEOUT);

  it("interrupts a pending approval turn without blocking server restart", async () => {
    const { baseCommit, repositoryRoot } = await createRepository();
    const artifactRoot = await temporaryDirectory(
      "accesspath-approval-shutdown-artifacts-",
    );
    const { manifest, repository } = repairInputs(
      repositoryRoot,
      baseCommit,
    );
    await seedSourceAudit(artifactRoot, manifest.verification.taskContract);
    const qoderAdapter = new DeterministicMockQoderAdapter({
      diagnosis: "Change the source with one approved edit.",
      edits: [
        {
          filePath: "src/feature.ts",
          oldText: "old source",
          newText: "new source",
        },
      ],
    });
    const serverConfig = {
      launchToken,
      artifactRoot,
      editableRepositoryRoot: repositoryRoot,
      qoderAdapter,
      auditRunner: createReplayAuditRunner(),
    };
    server = createServer(serverConfig);

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
      headers: headers({ "idempotency-key": "diagnose-before-shutdown" }),
    });
    await waitForState(repairId, "awaiting-plan-approval");
    await approvePending(repairId, "plan");
    await waitForState(repairId, "editing");
    await server.inject({
      method: "POST",
      url: `/api/repairs/${repairId}/start`,
      headers: headers({ "idempotency-key": "start-before-shutdown" }),
    });

    let pendingApprovalId: string | undefined;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const resource = await repairResource(repairId);
      pendingApprovalId = resource.approvals.find(
        (record: { request: ApprovalRequest }) =>
          record.request.kind === "tool" &&
          record.request.state === "pending",
      )?.request.id;
      if (pendingApprovalId !== undefined) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(pendingApprovalId).toBeDefined();

    await Promise.race([
      stop(server),
      new Promise<never>((_resolve, reject) =>
        setTimeout(
          () => reject(new Error("Companion shutdown did not complete.")),
          2_000,
        ),
      ),
    ]);
    server = undefined;

    const persistedApprovals = JSON.parse(
      await readFile(
        join(artifactRoot, "repairs", repairId, "approvals.json"),
        "utf8",
      ),
    ) as Array<{ request: ApprovalRequest }>;
    expect(
      persistedApprovals.find(
        (record) => record.request.id === pendingApprovalId,
      )?.request.state,
    ).toBe("expired");

    server = createServer(serverConfig);
    const restarted = await repairResource(repairId);
    expect(restarted.repair.qoderTurns.at(-1)).toMatchObject({
      mode: "repair",
      status: "interrupted",
    });
    expect(restarted.repair.activeQoderTurnId).toBeUndefined();
  }, INTEGRATION_TEST_TIMEOUT);

  it("does not spend another turn when the persisted transcript already completed", async () => {
    const { baseCommit, repositoryRoot } = await createRepository();
    const artifactRoot = await temporaryDirectory(
      "accesspath-completed-transcript-artifacts-",
    );
    const { manifest, repository } = repairInputs(
      repositoryRoot,
      baseCommit,
    );
    await seedSourceAudit(artifactRoot, manifest.verification.taskContract);
    const qoderAdapter = new DeterministicMockQoderAdapter({
      diagnosis: "Change the source and add one regression test.",
      repairSummary: "The approved repair is complete.",
      streamDelayMs: 1_000,
    });
    const serverConfig = {
      launchToken,
      artifactRoot,
      editableRepositoryRoot: repositoryRoot,
      qoderAdapter,
      auditRunner: createReplayAuditRunner(),
    };
    server = createServer(serverConfig);

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
      headers: headers({ "idempotency-key": "diagnose-completed-transcript" }),
    });
    await waitForState(repairId, "awaiting-plan-approval");
    await approvePending(repairId, "plan");
    await waitForState(repairId, "editing");

    const started = await server.inject({
      method: "POST",
      url: `/api/repairs/${repairId}/start`,
      headers: headers({ "idempotency-key": "completed-paid-command" }),
    });
    expect(started.statusCode).toBe(202);
    const runningTurn = started.json().repair.qoderTurns.at(-1) as QoderTurn;
    expect(qoderAdapter.starts).toHaveLength(2);
    await stop(server);
    server = undefined;

    server = createServer(serverConfig);
    qoderAdapter.forgetPersistedTurn(
      runningTurn.qoderSessionId,
      runningTurn.userMessageId,
    );
    const missing = await server.inject({
      method: "POST",
      url: `/api/repairs/${repairId}/start`,
      headers: headers({ "idempotency-key": "completed-paid-command" }),
    });
    expect(missing.statusCode).toBe(409);
    expect(qoderAdapter.starts).toHaveLength(2);

    qoderAdapter.recordCompletedTurn({
      completedMessages: ["The approved repair is complete."],
      qoderSessionId: runningTurn.qoderSessionId,
      result: "The approved repair is complete.",
      resultSubtype: "success",
      stopReason: "end_turn",
      userMessageId: runningTurn.userMessageId,
    });
    const recovered = await server.inject({
      method: "POST",
      url: `/api/repairs/${repairId}/start`,
      headers: headers({ "idempotency-key": "completed-paid-command" }),
    });
    expect(recovered.statusCode).toBe(202);
    expect(qoderAdapter.starts).toHaveLength(2);
    expect(
      recovered.json().repair.qoderTurns.map(
        (turn: QoderTurn) => turn.status,
      ),
    ).toEqual(["completed", "completed"]);

    const newer = await server.inject({
      method: "POST",
      url: `/api/repairs/${repairId}/start`,
      headers: headers({ "idempotency-key": "newer-paid-command" }),
    });
    expect(newer.statusCode).toBe(202);
    expect(qoderAdapter.starts).toHaveLength(3);
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const resource = await repairResource(repairId);
      if (resource.repair.qoderTurns.at(-1)?.status === "completed") {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(
      (await repairResource(repairId)).repair.qoderTurns.at(-1)?.status,
    ).toBe("completed");
    await stop(server);
    server = undefined;
    await rm(
      join(
        artifactRoot,
        "repairs",
        repairId,
        "commands.json",
      ),
      { force: true },
    );
    server = createServer(serverConfig);

    const stale = await server.inject({
      method: "POST",
      url: `/api/repairs/${repairId}/start`,
      headers: headers({ "idempotency-key": "completed-paid-command" }),
    });
    expect(stale.statusCode).toBe(202);
    expect(qoderAdapter.starts).toHaveLength(3);
  }, INTEGRATION_TEST_TIMEOUT);

  it("aborts an in-flight verification when the repair is cancelled", async () => {
    const { baseCommit, repositoryRoot } = await createRepository();
    const artifactRoot = await temporaryDirectory(
      "accesspath-cancel-artifacts-",
    );
    const { manifest, repository } = repairInputs(
      repositoryRoot,
      baseCommit,
    );
    await seedSourceAudit(artifactRoot, manifest.verification.taskContract);
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
      auditRunner: createReplayAuditRunner(),
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
  }, INTEGRATION_TEST_TIMEOUT);
});
