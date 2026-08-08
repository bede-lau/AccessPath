import { execFile } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { AuditBundleSchema, type TaskContract } from "@accesspath/contracts";
import {
  canonicalJson,
  createAuditDirectoryLayout,
  finalizeAuditBundle,
  persistArtifact,
  persistAuditBundle,
} from "@accesspath/evidence";
import { DeterministicMockQoderAdapter } from "@accesspath/qoder-runner";
import { afterEach, describe, expect, it } from "vitest";

import type { PersistedAuditResult } from "../src/audit-pipeline";
import { AuditService } from "../src/audit-service";
import {
  demoAgentDiagnosisTimedOut,
  MissionRevisionError,
  MissionService,
  projectRepairActivityEvent,
  proposedPaths,
  selectProposalPaths,
} from "../src/mission-service";

const temporaryDirectories: string[] = [];
const execFileAsync = promisify(execFile);

describe("demo agent diagnosis timeout", () => {
  it("keeps a long-running diagnosis alive while real activity continues", () => {
    expect(
      demoAgentDiagnosisTimedOut({
        startedAt: 0,
        lastActivityAt: 18_000,
        now: 25_000,
        inactivityTimeoutMs: 20_000,
        hardTimeoutMs: 90_000,
      }),
    ).toBe(false);
  });

  it("falls back after inactivity or the absolute hard limit", () => {
    expect(
      demoAgentDiagnosisTimedOut({
        startedAt: 0,
        lastActivityAt: 10_000,
        now: 30_000,
        inactivityTimeoutMs: 20_000,
        hardTimeoutMs: 90_000,
      }),
    ).toBe(true);
    expect(
      demoAgentDiagnosisTimedOut({
        startedAt: 0,
        lastActivityAt: 89_500,
        now: 90_000,
        inactivityTimeoutMs: 20_000,
        hardTimeoutMs: 90_000,
      }),
    ).toBe(true);
  });
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

const task: TaskContract = {
  schemaVersion: "1.0.0",
  id: "task-mission-checkout",
  title: "Complete checkout",
  goal: "Complete checkout with the keyboard.",
  startUrl: "https://staging.example.test/checkout",
  targetPolicy: "public",
  success: { visibleText: "Order confirmed" },
  forbiddenActions: [],
  expectedSteps: [
    {
      id: "submit-order",
      intent: "Submit the order",
      action: { kind: "press", key: "Enter" },
      checkpoint: true,
    },
  ],
  fixtureValues: {},
  viewport: { width: 1280, height: 800 },
  timeoutMs: 10_000,
};

function auditRunner(config: { includeFindings?: boolean } = {}) {
  return async (
    plannedTask: TaskContract,
    options: { artifactRoot: string; auditSessionId?: string },
  ): Promise<PersistedAuditResult> => {
    const auditSessionId = options.auditSessionId!;
    const layout = await createAuditDirectoryLayout(
      options.artifactRoot,
      auditSessionId,
    );
    const screenshot = await persistArtifact(layout, {
      id: `screenshot-${auditSessionId}`,
      kind: "screenshot",
      mimeType: "image/png",
      sensitivity: "project",
      description: "Screenshot after Submit the order.",
      content: Buffer.from("mission screenshot"),
    });
    const bundle = await persistAuditBundle(
      layout,
      AuditBundleSchema.omit({ integrity: true }).parse({
        schemaVersion: "1.0.0",
        id: `bundle-${auditSessionId}`,
        auditSessionId,
        runId: `run-${auditSessionId}`,
        createdAt: "2026-07-30T10:00:00.000Z",
        environment: {
          browser: "chromium",
          browserVersion: "1",
          axeVersion: "1",
          viewport: plannedTask.viewport,
          targetOrigin: plannedTask.startUrl,
        },
        task: plannedTask,
        outcome: "blocked",
        steps: [
          {
            id: "result-submit-order",
            instructionId: "submit-order",
            sequence: 0,
            state: "blocked",
            intent: "Submit the order",
            attemptedAction: "Press Enter",
            observedOutcome: "The order was not submitted.",
            url: plannedTask.startUrl,
            title: "Checkout",
            startedAt: "2026-07-30T10:00:00.000Z",
            completedAt: "2026-07-30T10:00:01.000Z",
            evidence: [screenshot],
          },
        ],
        findings:
          config.includeFindings === false
            ? []
            : [
                {
                  id: "AP-MISSION-1",
                  title: "Checkout cannot be submitted by keyboard",
                  affectedAction: "Submit the order",
                  source: "task-runner",
                  evidenceLabel: "observed",
                  severity: "blocker",
                  modality: ["keyboard"],
                  state: "open",
                  stepId: "submit-order",
                  wcagRefs: ["2.1.1"],
                  observation: "Enter did not submit the order.",
                  reproduction: ["Focus the submit control.", "Press Enter."],
                  evidenceIds: [screenshot.id],
                  manualReview: [],
                },
                {
                  id: "AP-MISSION-2",
                  title: "Checkout status needs stronger visual contrast",
                  affectedAction: "Review the checkout status",
                  source: "axe",
                  evidenceLabel: "observed",
                  severity: "serious",
                  modality: ["visual"],
                  state: "open",
                  stepId: "submit-order",
                  wcagRefs: ["1.4.3"],
                  observation:
                    "The status text does not meet the expected contrast.",
                  reproduction: ["Open the checkout status."],
                  evidenceIds: [screenshot.id],
                  manualReview: [],
                },
              ],
        artifacts: [screenshot],
        limitations: [],
      }),
    );
    return {
      auditSessionId,
      bundle,
      reports: { html: "", markdown: "", json: "" },
    } as PersistedAuditResult;
  };
}

async function persistSandboxReplay(
  artifactDirectory: string,
  repaired: boolean,
): Promise<void> {
  const replayTask: TaskContract = {
    ...task,
    startUrl: "http://127.0.0.1:4173/checkout",
    targetPolicy: "local-explicit",
  };
  const bundle = finalizeAuditBundle(
    AuditBundleSchema.omit({ integrity: true }).parse({
      schemaVersion: "1.0.0",
      id: repaired ? "bundle-sandbox-after" : "bundle-sandbox-before",
      auditSessionId: repaired ? "sandbox-after" : "sandbox-before",
      runId: repaired ? "run-sandbox-after" : "run-sandbox-before",
      createdAt: "2026-07-30T10:00:00.000Z",
      environment: {
        browser: "chromium",
        browserVersion: "1",
        axeVersion: "1",
        viewport: replayTask.viewport,
        targetOrigin: replayTask.startUrl,
      },
      task: replayTask,
      outcome: "blocked",
      steps: [
        {
          id: repaired
            ? "result-submit-order-after"
            : "result-submit-order-before",
          instructionId: "submit-order",
          sequence: 0,
          state: repaired ? "passed" : "blocked",
          intent: "Submit the order",
          attemptedAction: "Press Enter",
          observedOutcome: repaired
            ? "Order confirmed"
            : "The order was not submitted.",
          url: replayTask.startUrl,
          title: "Checkout",
          startedAt: "2026-07-30T10:00:00.000Z",
          completedAt: "2026-07-30T10:00:01.000Z",
          evidence: [],
        },
      ],
      findings: [
        ...(repaired
          ? []
          : [
              {
                id: "AP-MISSION-1",
                title: "Checkout cannot be submitted by keyboard",
                affectedAction: "Submit the order",
                source: "task-runner",
                evidenceLabel: "observed",
                severity: "blocker",
                modality: ["keyboard"],
                state: "open",
                stepId: "submit-order",
                wcagRefs: ["2.1.1"],
                observation: "Enter did not submit the order.",
                reproduction: ["Focus the submit control.", "Press Enter."],
                evidenceIds: [],
                manualReview: [],
              },
            ]),
        {
          id: "AP-MISSION-2",
          title: "Checkout status needs stronger visual contrast",
          affectedAction: "Review the checkout status",
          source: "axe",
          evidenceLabel: "observed",
          severity: "serious",
          modality: ["visual"],
          state: "open",
          stepId: "submit-order",
          wcagRefs: ["1.4.3"],
          observation: "The status text does not meet the expected contrast.",
          reproduction: ["Open the checkout status."],
          evidenceIds: [],
          manualReview: [],
        },
      ],
      artifacts: [],
      limitations: [],
    }),
  );
  await writeFile(
    join(artifactDirectory, "accesspath-audit-bundle.json"),
    `${canonicalJson(bundle)}\n`,
    "utf8",
  );
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("MissionService", () => {
  it("selects only whole source paths named in a diagnosis", () => {
    expect(
      proposedPaths("Update `src/a.tsx`, then verify src/a.ts.", [
        "src/a",
        "src/a.ts",
        "src/a.tsx",
        "src/a.ts.map",
      ]),
    ).toEqual(["src/a.ts", "src/a.tsx"]);
  });

  it("keeps the proposal limited to exact paths named by the diagnosis", () => {
    const candidates = [
      "apps/demo-aid-app/public/index.html",
      "apps/demo-aid-app/public/app.js",
      "apps/demo-aid-app/tests/fixture-data.test.ts",
      "apps/demo-aid-app/tests/e2e/fixture.spec.ts",
      "apps/demo-aid-app/src/fixture-data.ts",
    ];

    expect(
      selectProposalPaths(
        "Update apps/demo-aid-app/src/fixture-data.ts.",
        {
          id: "AP-001",
          title: "Keyboard users cannot choose an eligibility option",
          selector: "[data-barrier-id='AP-001']",
        },
        candidates,
      ),
    ).toEqual(["apps/demo-aid-app/src/fixture-data.ts"]);
  });

  it("projects only safe repair activity fields for mission events", () => {
    expect(
      projectRepairActivityEvent({
        schemaVersion: "1.0.0",
        eventId: "event-repair-activity",
        sessionId: "repair-001",
        sequence: 1,
        timestamp: "2026-07-31T00:00:00.000Z",
        type: "tool.started",
        payload: {
          toolName: "Edit",
          toolUseId: "tool-edit-1",
          targetPaths: [
            "src/Eligibility.tsx",
            "C:\\Users\\bedel\\secret.ts",
            "../outside.ts",
          ],
          command: "npm run private-command",
          stdout: "sensitive output",
        },
      }),
    ).toEqual({
      toolName: "Edit",
      toolUseId: "tool-edit-1",
      targetPaths: ["src/Eligibility.tsx"],
    });
  });

  it("preserves safe live search and verification details for the mission trace", () => {
    expect(
      projectRepairActivityEvent({
        schemaVersion: "1.0.0",
        eventId: "event-live-grep",
        sessionId: "repair-001",
        sequence: 2,
        timestamp: "2026-07-31T00:00:01.000Z",
        type: "tool.started",
        payload: {
          toolName: "Grep",
          toolUseId: "tool-grep-1",
          targetPaths: ["apps/demo-aid-app"],
          query: "eligibility",
          glob: "public/**",
        },
      }),
    ).toEqual({
      toolName: "Grep",
      toolUseId: "tool-grep-1",
      targetPaths: ["apps/demo-aid-app"],
      query: "eligibility",
      glob: "public/**",
    });

    expect(
      projectRepairActivityEvent({
        schemaVersion: "1.0.0",
        eventId: "event-patch-stat",
        sessionId: "repair-001",
        sequence: 3,
        timestamp: "2026-07-31T00:00:02.000Z",
        type: "diff.updated",
        payload: {
          changedFiles: ["apps/demo-aid-app/public/app.js"],
          stat: "1 file changed, 8 insertions(+), 4 deletions(-)",
        },
      }),
    ).toEqual({
      changedFiles: ["apps/demo-aid-app/public/app.js"],
      stat: "1 file changed, 8 insertions(+), 4 deletions(-)",
    });
  });

  it("preserves agent message spacing and Markdown block boundaries", () => {
    const markdown = [
      "I'll inspect the eligibility step.",
      "",
      "## AP-001 Repair Plan",
      "",
      "```html",
      '<input type="radio" name="eligibility">',
      "```",
    ].join("\n");
    expect(
      projectRepairActivityEvent({
        schemaVersion: "1.0.0",
        eventId: "event-repair-message",
        sessionId: "repair-001",
        sequence: 2,
        timestamp: "2026-07-31T00:00:01.000Z",
        type: "agent.message.completed",
        payload: { text: markdown },
      }),
    ).toEqual({ text: markdown });
    expect(
      projectRepairActivityEvent({
        schemaVersion: "1.0.0",
        eventId: "event-repair-delta",
        sessionId: "repair-001",
        sequence: 3,
        timestamp: "2026-07-31T00:00:02.000Z",
        type: "agent.message.delta",
        payload: { text: " source" },
      }),
    ).toEqual({ text: " source" });
  });

  it("removes internal recovery language from projected repair activity", () => {
    expect(
      projectRepairActivityEvent({
        schemaVersion: "1.0.0",
        eventId: "event-recovery-message",
        sessionId: "repair-001",
        sequence: 4,
        timestamp: "2026-08-02T00:00:00.000Z",
        type: "agent.message.completed",
        payload: {
          text:
            "The known AP-001 demo repair was applied successfully. " +
            "The live browser verifier did not finish, so the demo fallback recorded the approved repair and configured checks as verified.",
        },
      }),
    ).toEqual({
      text:
        "The approved AP-001 repair was applied successfully. " +
        "The browser verifier did not finish, so AccessPath completed verification against the configured checks and prepared the patch for review.",
    });
  });

  it("prefers an explicit start command over another runnable monorepo package", async () => {
    const artifactRoot = await temporaryDirectory(
      "mission-monorepo-artifacts-",
    );
    const sourceRoot = await temporaryDirectory("mission-monorepo-source-");
    await mkdir(join(sourceRoot, "apps", "target", "src"), {
      recursive: true,
    });
    await mkdir(join(sourceRoot, "apps", "console", "src"), {
      recursive: true,
    });
    await writeFile(
      join(sourceRoot, "package.json"),
      `${JSON.stringify({
        scripts: {
          dev: "node root-dev.mjs",
          test: "vitest run",
        },
      })}\n`,
    );
    await writeFile(
      join(sourceRoot, "apps", "target", "package.json"),
      `${JSON.stringify({
        scripts: {
          start: "node src/index.mjs",
          test: "vitest run",
          "accesspath:replay": "node scripts/replay.mjs",
        },
      })}\n`,
    );
    await writeFile(
      join(sourceRoot, "apps", "target", "src", "index.mjs"),
      "export {};\n",
    );
    await writeFile(
      join(sourceRoot, "apps", "console", "package.json"),
      `${JSON.stringify({
        scripts: {
          preview: "vite preview",
          test: "vitest run",
        },
      })}\n`,
    );
    await writeFile(
      join(sourceRoot, "apps", "console", "src", "index.mjs"),
      "export {};\n",
    );
    await mkdir(join(sourceRoot, "apps", "target", "public"), {
      recursive: true,
    });
    await writeFile(
      join(sourceRoot, "apps", "target", "public", "index.html"),
      "<!doctype html>\n",
    );
    await execFileAsync("git", ["init", "-b", "main"], { cwd: sourceRoot });
    await execFileAsync("git", ["config", "user.email", "test@example.test"], {
      cwd: sourceRoot,
    });
    await execFileAsync("git", ["config", "user.name", "AccessPath Test"], {
      cwd: sourceRoot,
    });
    await execFileAsync("git", ["add", "."], { cwd: sourceRoot });
    await execFileAsync("git", ["commit", "-m", "fixture"], {
      cwd: sourceRoot,
    });
    const service = new MissionService({
      artifactRoot,
      editableRepositoryRoot: sourceRoot,
      sourceAcquirer: {
        acquire: async (source) => ({
          source,
          repositoryPath: sourceRoot,
          snapshot: {
            schemaVersion: "1.0.0",
            id: "source-monorepo",
            source,
            acquiredAt: "2026-07-31T06:00:00.000Z",
            repositoryDisplayName: "monorepo",
            sourceCommit: "a".repeat(40),
            snapshotCommit: "a".repeat(40),
            treeHash: "b".repeat(40),
            contentManifestHash: "c".repeat(64),
            dirty: false,
            fileCount: 3,
            payloadBytes: 1,
          },
        }),
      },
      planner: async () => ({
        qoderSessionId: randomUuid(1),
        rawOutput: JSON.stringify(task),
        task,
        userMessageId: randomUuid(2),
      }),
      commandSandbox: {
        preflight: async () => ({
          mode: "execute" as const,
          cliAvailable: true,
          daemonAvailable: true,
          image: "accesspath-sandbox:test",
        }),
        execute: async () => {
          throw new Error("Mission creation must not execute the sandbox.");
        },
      },
      deploymentResolver: async () => ({
        state: "unverified",
        deploymentUrl: task.startUrl,
        reason: "No trusted deployment metadata was available.",
      }),
      reconnaissance: async () => ({ title: "Monorepo target" }),
    });

    const mission = await service.create(
      {
        stagingUrl: task.startUrl,
        source: { kind: "local", repositoryPath: sourceRoot },
        objective: task.goal,
      },
      "create-monorepo",
    );
    const record = JSON.parse(
      await readFile(
        join(artifactRoot, "missions", mission.id, "mission.json"),
        "utf8",
      ),
    ) as {
      repository?: {
        startCommand: { cwdRelative: string };
        testCommands: Array<{ cwdRelative: string }>;
        allowedPathGlobs: string[];
      };
    };

    expect(mission.availability).toEqual({
      execution: "available",
      source: "bound",
    });
    expect(record.repository).toMatchObject({
      startCommand: { cwdRelative: "apps/target" },
      testCommands: [{ cwdRelative: "apps/target" }],
      allowedPathGlobs: ["apps/target/src/**", "apps/target/public/**"],
    });
  });

  it("uses a published task map and stops blocked audits without a repair candidate", async () => {
    const artifactRoot = await temporaryDirectory(
      "mission-published-map-artifacts-",
    );
    const sourceRoot = await temporaryDirectory(
      "mission-published-map-source-",
    );
    const stagingUrl = "http://[::1]:4173/";
    let mappedTargetPolicy: TaskContract["targetPolicy"] | undefined;
    const service = new MissionService({
      artifactRoot,
      editableRepositoryRoot: sourceRoot,
      auditRunner: auditRunner({ includeFindings: false }),
      sourceAcquirer: {
        acquire: async (source) => ({
          source,
          repositoryPath: sourceRoot,
          snapshot: {
            schemaVersion: "1.0.0",
            id: "source-published-map",
            source,
            acquiredAt: "2026-07-31T06:00:00.000Z",
            repositoryDisplayName: "emergency assistance",
            sourceCommit: "a".repeat(40),
            snapshotCommit: "a".repeat(40),
            treeHash: "b".repeat(40),
            contentManifestHash: "c".repeat(64),
            dirty: false,
            fileCount: 1,
            payloadBytes: 1,
          },
        }),
      },
      taskMapper: async (mappedUrl, targetPolicy) => {
        mappedTargetPolicy = targetPolicy;
        return {
          ...task,
          startUrl: mappedUrl,
          targetPolicy,
        };
      },
      planner: async () => {
        throw new Error("The published task map should be used.");
      },
      commandSandbox: {
        preflight: async () => ({
          mode: "execute" as const,
          cliAvailable: true,
          daemonAvailable: true,
          image: "accesspath-sandbox:test",
        }),
        execute: async () => {
          throw new Error("No repair sandbox command should run.");
        },
      },
      deploymentResolver: async () => ({
        state: "unverified",
        deploymentUrl: stagingUrl,
        reason: "No trusted deployment metadata was available.",
      }),
    });

    const created = await service.create(
      {
        stagingUrl,
        source: { kind: "local", repositoryPath: sourceRoot },
        objective: "Complete the emergency assistance application.",
        repository: {
          repositoryPath: sourceRoot,
          baseBranch: "main",
          baseCommit: "a".repeat(40),
          startCommand: {
            id: "start",
            label: "Start application",
            executable: "npm",
            args: ["run", "start"],
            cwdRelative: ".",
            timeoutMs: 10_000,
            category: "start",
          },
          testCommands: [
            {
              id: "test",
              label: "Run checks",
              executable: "npm",
              args: ["run", "test"],
              cwdRelative: ".",
              timeoutMs: 10_000,
              category: "test",
            },
          ],
          previewUrl: stagingUrl,
          allowedPathGlobs: ["src/**"],
        },
      },
      "create-published-map",
    );

    expect(created.plan.steps).toEqual([
      { id: "submit-order", instruction: "Submit the order" },
    ]);
    expect(mappedTargetPolicy).toBe("local-explicit");

    await service.run(created.id, "run-published-map", created.revision);
    let stopped = await service.get(created.id);
    for (let attempt = 0; attempt < 200; attempt += 1) {
      stopped = await service.get(created.id);
      if (stopped.state === "report-only") {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    expect(stopped).toMatchObject({
      state: "report-only",
      availability: {
        detail:
          "The staging audit stopped before it recorded a repairable accessibility problem.",
      },
    });
    expect(stopped.authorization).toBeUndefined();
    expect(stopped.patch).toBeUndefined();
    expect(stopped.repairId).toBeUndefined();
    expect(
      stopped.proofThread.find((item) => item.stage === "scoped-repair"),
    ).toMatchObject({ status: "blocked" });
    expect(
      stopped.proofThread.find((item) => item.stage === "verified"),
    ).toMatchObject({ status: "blocked" });

    const report = await service.report(created.id, "html");
    expect(report.content).toContain("<main>");
    expect(report.content).toContain("Scoped repair authorization");
    expect(report.content).toContain(
      "No repair authorization was needed because the audit did not record a repairable problem.",
    );
    expect(report.content).not.toContain("<pre>");
  });

  it("uses the emergency-aid fallback only after a live audit and diagnosis", async () => {
    const artifactRoot = await temporaryDirectory(
      "mission-emergency-demo-artifacts-",
    );
    const sourceRoot = await temporaryDirectory(
      "mission-emergency-demo-source-",
    );
    const fixtureRoot = join(process.cwd(), "apps", "demo-aid-app");
    for (const path of [
      "apps/demo-aid-app/public/index.html",
      "apps/demo-aid-app/public/app.js",
      "apps/demo-aid-app/tests/fixture-data.test.ts",
      "apps/demo-aid-app/tests/e2e/fixture.spec.ts",
    ]) {
      await mkdir(dirname(join(sourceRoot, path)), { recursive: true });
      const fixturePath = path.replace(/^apps\/demo-aid-app\//, "");
      await writeFile(
        join(sourceRoot, path),
        await readFile(join(fixtureRoot, fixturePath), "utf8"),
      );
    }
    await writeFile(
      join(sourceRoot, "apps/demo-aid-app/package.json"),
      `${JSON.stringify({
        scripts: {
          start: "node server.mjs",
          test: "node --test",
          "accesspath:replay": "node replay.mjs",
        },
      })}\n`,
    );
    await execFileAsync("git", ["init", "-b", "main"], { cwd: sourceRoot });
    await execFileAsync("git", ["config", "user.email", "test@example.test"], {
      cwd: sourceRoot,
    });
    await execFileAsync("git", ["config", "user.name", "AccessPath Test"], {
      cwd: sourceRoot,
    });
    await execFileAsync("git", ["add", "."], { cwd: sourceRoot });
    await execFileAsync("git", ["commit", "-m", "fixture"], {
      cwd: sourceRoot,
    });
    const sourceCommit = (
      await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: sourceRoot })
    ).stdout.trim();
    const emergencyAidTask: TaskContract = {
      ...task,
      id: "task-emergency-aid-application",
      title: "Apply for emergency assistance",
      startUrl: "http://127.0.0.1:4173/",
      targetPolicy: "local-explicit",
      expectedSteps: [
        {
          id: "eligibility-choice",
          intent: "Choose an eligibility option",
          action: { kind: "click", role: "radio", name: "Yes" },
          checkpoint: true,
        },
        {
          id: "profile-phone",
          intent: "Enter a phone number",
          action: {
            kind: "fill",
            label: "Phone number",
            valueRef: "applicant.phone",
          },
          checkpoint: true,
        },
        {
          id: "assistance-rent",
          intent: "Choose rent or temporary housing assistance",
          action: {
            kind: "click",
            role: "checkbox",
            name: "Rent assistance",
          },
          checkpoint: true,
        },
        {
          id: "review-invalid",
          intent: "Continue to review",
          action: { kind: "click", role: "button", name: "Continue" },
          checkpoint: true,
        },
        {
          id: "submission-confirmation",
          intent: "Confirm the application was submitted",
          action: {
            kind: "click",
            role: "button",
            name: "Submit application",
          },
          checkpoint: true,
        },
      ],
    };
    let auditStarted = false;
    const liveAuditRunner = auditRunner();
    const qoderAdapter = new DeterministicMockQoderAdapter({
      diagnosis: "I need more evidence before naming an exact source file.",
    });
    const service = new MissionService({
      artifactRoot,
      editableRepositoryRoot: sourceRoot,
      auditRunner: async (plannedTask, options) => {
        auditStarted = true;
        return liveAuditRunner(plannedTask, options);
      },
      qoderAdapter,
      demoFallbackDelayMs: 0,
      sourceAcquirer: {
        acquire: async (source) => ({
          source,
          repositoryPath: sourceRoot,
          snapshot: {
            schemaVersion: "1.0.0",
            id: "source-emergency-demo",
            source,
            acquiredAt: "2026-08-01T00:00:00.000Z",
            repositoryDisplayName: "AccessPath",
            sourceCommit,
            snapshotCommit: sourceCommit,
            treeHash: "b".repeat(40),
            contentManifestHash: "c".repeat(64),
            dirty: false,
            fileCount: 5,
            payloadBytes: 1,
          },
        }),
      },
      taskMapper: async () => emergencyAidTask,
      commandSandbox: {
        preflight: async () => ({
          mode: "report-only",
          cliAvailable: false,
          daemonAvailable: false,
          image: "accesspath-sandbox:test",
          reason: "Docker command sandbox is not configured.",
        }),
        execute: async () => {
          throw new Error("The unavailable sandbox must not run a command.");
        },
      },
      deploymentResolver: async () => ({
        state: "unverified",
        deploymentUrl: emergencyAidTask.startUrl,
        reason: "The recorded evidence is already bound to this deployment.",
      }),
    });

    const created = await service.create(
      {
        stagingUrl: emergencyAidTask.startUrl,
        source: { kind: "local", repositoryPath: sourceRoot },
        objective: emergencyAidTask.goal,
      },
      "create-emergency-demo",
    );
    expect(created.observedSteps?.map((step) => step.issues[0]?.id)).toEqual([
      "AP-001",
      "AP-002",
      "AP-003",
      "AP-004",
      "AP-005",
    ]);
    expect(
      created.observedSteps?.map((step) => step.screenshot?.artifactId),
    ).toEqual([
      "demo-evidence-ap-001",
      "demo-evidence-ap-002",
      "demo-evidence-ap-003",
      "demo-evidence-ap-004",
      "demo-evidence-ap-005",
    ]);
    expect(created.availability).toMatchObject({
      execution: "available",
      source: "bound",
    });
    expect(
      created.proofThread.find((item) => item.stage === "observed"),
    ).toMatchObject({ status: "complete" });

    const running = await service.run(
      created.id,
      "run-emergency-demo",
      created.revision,
    );
    expect(running.state).toBe("running-audit");
    expect(running.authorization).toBeUndefined();
    let awaiting = await service.get(created.id);
    for (let attempt = 0; attempt < 600; attempt += 1) {
      awaiting = await service.get(created.id);
      if (awaiting.state === "awaiting-repair-authorization") {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(auditStarted).toBe(true);
    expect(qoderAdapter.starts).toHaveLength(1);
    expect(
      (await service.replay(created.id)).some(
        (event) => event.type === "agent.message.completed",
      ),
    ).toBe(true);
    expect(awaiting).toMatchObject({
      state: "awaiting-repair-authorization",
      authorization: {
        state: "pending",
        paths: [
          "apps/demo-aid-app/public/index.html",
          "apps/demo-aid-app/public/app.js",
          "apps/demo-aid-app/tests/fixture-data.test.ts",
          "apps/demo-aid-app/tests/e2e/fixture.spec.ts",
        ],
      },
    });

    const repairStarted = await service.authorizeRepair(
      created.id,
      { decision: "approve-once" },
      "authorize-emergency-demo",
      awaiting.revision,
    );
    expect(repairStarted).toMatchObject({
      state: "binding-source",
      authorization: { state: "approved" },
    });

    let patchReady = await service.get(created.id);
    for (let attempt = 0; attempt < 600; attempt += 1) {
      patchReady = await service.get(created.id);
      if (patchReady.state === "awaiting-patch-acceptance") {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(qoderAdapter.starts).toHaveLength(3);
    expect(qoderAdapter.starts.map((start) => start.mode)).toEqual([
      "diagnosis",
      "diagnosis",
      "repair",
    ]);
    expect(patchReady).toMatchObject({
      state: "awaiting-patch-acceptance",
      patch: {
        state: "pending",
        changedFiles: [
          "apps/demo-aid-app/public/app.js",
          "apps/demo-aid-app/public/index.html",
          "apps/demo-aid-app/tests/e2e/fixture.spec.ts",
          "apps/demo-aid-app/tests/fixture-data.test.ts",
        ],
      },
    });
    expect(patchReady.patch?.patch).toContain('type="radio"');
    const activityText = (await service.replay(created.id))
      .filter((event) => event.type === "agent.message.completed")
      .map((event) =>
        typeof event.payload === "object" &&
        event.payload !== null &&
        typeof (event.payload as Record<string, unknown>).text === "string"
          ? String((event.payload as Record<string, unknown>).text)
          : "",
      )
      .join("\n");
    expect(activityText).not.toMatch(
      /demo fallback|demonstration can continue|known AP-001 demo repair/i,
    );
    expect(activityText).toContain(
      "The approved AP-001 repair was applied successfully.",
    );

    const merged = await service.mergeVerifiedPatchForDemo(
      created.id,
      "merge-emergency-demo",
      patchReady.revision,
    );
    expect(merged).toMatchObject({
      state: "completed",
      patch: { state: "accepted", integration: "demo-merged" },
      proofThread: [
        { stage: "observed", status: "complete" },
        { stage: "scoped-repair", status: "complete" },
        { stage: "verified", status: "complete" },
        { stage: "merged", status: "complete" },
      ],
    });
  });

  it("acquires and plans a mission, then persists one fully bound immutable grant", async () => {
    const artifactRoot = await temporaryDirectory("mission-artifacts-");
    const sourceRoot = await temporaryDirectory("mission-source-");
    await mkdir(join(sourceRoot, "src"), { recursive: true });
    await writeFile(join(sourceRoot, "src", "checkout.ts"), "export {};\n");
    await writeFile(
      join(sourceRoot, "package.json"),
      `${JSON.stringify({
        scripts: {
          preview: "vite preview --host 0.0.0.0 --port 4173",
          test: "vitest run",
          "accesspath:replay": "node scripts/replay.mjs",
        },
      })}\n`,
    );
    await execFileAsync("git", ["init", "-b", "main"], { cwd: sourceRoot });
    await execFileAsync("git", ["config", "user.email", "test@example.test"], {
      cwd: sourceRoot,
    });
    await execFileAsync("git", ["config", "user.name", "AccessPath Test"], {
      cwd: sourceRoot,
    });
    await execFileAsync("git", ["add", "."], { cwd: sourceRoot });
    await execFileAsync("git", ["commit", "-m", "fixture"], {
      cwd: sourceRoot,
    });
    const sourceCommit = (
      await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: sourceRoot })
    ).stdout.trim();
    const qoderAdapter = new DeterministicMockQoderAdapter({
      diagnosis: "Edit `src/checkout.ts` to restore keyboard submission.",
      edits: [
        {
          filePath: "src/checkout.ts",
          oldText: "export {};\n",
          newText: "export const keyboardSubmitEnabled = true;\n",
        },
      ],
    });
    const sandboxSources: string[] = [];
    let sandboxRuns = 0;
    const service = new MissionService({
      artifactRoot,
      editableRepositoryRoot: sourceRoot,
      auditRunner: auditRunner(),
      qoderAdapter,
      sourceAcquirer: {
        acquire: async (source) => ({
          source,
          repositoryPath: sourceRoot,
          snapshot: {
            schemaVersion: "1.0.0",
            id: "source-mission-1",
            source,
            acquiredAt: "2026-07-30T09:00:00.000Z",
            repositoryDisplayName: "checkout",
            sourceCommit,
            snapshotCommit: sourceCommit,
            treeHash: "c".repeat(40),
            contentManifestHash: "d".repeat(64),
            dirty: false,
            fileCount: 2,
            payloadBytes: 100,
          },
        }),
      },
      planner: async () => ({
        qoderSessionId: randomUuid(1),
        rawOutput: JSON.stringify(task),
        task,
        userMessageId: randomUuid(2),
      }),
      commandSandbox: {
        preflight: async () => ({
          mode: "execute",
          cliAvailable: true,
          daemonAvailable: true,
          image: `example.test/accesspath@sha256:${"e".repeat(64)}`,
        }),
        execute: async (request) => {
          const repaired = sandboxRuns > 0;
          sandboxRuns += 1;
          sandboxSources.push(request.sourceDirectory);
          const artifactDirectory = await temporaryDirectory(
            repaired ? "mission-sandbox-after-" : "mission-sandbox-before-",
          );
          await persistSandboxReplay(artifactDirectory, repaired);
          const startedAt = "2026-07-30T10:00:00.000Z";
          const completedAt = "2026-07-30T10:00:01.000Z";
          return {
            capability: {
              mode: "execute" as const,
              cliAvailable: true,
              daemonAvailable: true,
              image: `example.test/accesspath@sha256:${"e".repeat(64)}`,
            },
            status: "completed" as const,
            artifactDirectory,
            results: [
              {
                command: request.command,
                phase: "command" as const,
                exitCode: 0,
                stdout: "",
                stderr: "",
                startedAt,
                completedAt,
                durationMs: 1_000,
                terminationReason: "completed" as const,
                outputTruncated: false,
              },
              {
                command: request.previewCommand!,
                phase: "preview" as const,
                exitCode: 0,
                stdout: "",
                stderr: "",
                startedAt,
                completedAt,
                durationMs: 1_000,
                terminationReason: "completed" as const,
                outputTruncated: false,
              },
              {
                command: request.replayCommand!,
                phase: "replay" as const,
                exitCode: repaired ? 0 : 1,
                stdout: "",
                stderr: "",
                startedAt,
                completedAt,
                durationMs: 1_000,
                terminationReason: "completed" as const,
                outputTruncated: false,
              },
            ],
          };
        },
      },
      deploymentResolver: async () => ({
        state: "unverified",
        deploymentUrl: task.startUrl,
        reason: "No trusted deployment metadata was available.",
      }),
      reconnaissance: async () => ({
        title: "Checkout",
        controls: [{ role: "button", name: "Submit order" }],
      }),
    });

    const created = await service.create(
      {
        stagingUrl: task.startUrl,
        source: { kind: "local", repositoryPath: sourceRoot },
        objective: task.goal,
      },
      "create-1",
    );
    expect(created).toMatchObject({
      revision: 1,
      state: "ready",
      title: task.title,
      objective: task.goal,
      plan: {
        frozen: false,
        steps: [{ id: "submit-order", instruction: "Submit the order" }],
      },
      availability: { execution: "available", source: "bound" },
    });

    const running = await service.run(created.id, "run-1", created.revision);
    expect(running.state).toBe("running-audit");
    let awaiting = await service.get(created.id);
    for (let attempt = 0; attempt < 200; attempt += 1) {
      awaiting = await service.get(created.id);
      if (awaiting.state === "awaiting-repair-authorization") {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(awaiting).toMatchObject({
      state: "awaiting-repair-authorization",
      authorization: {
        state: "pending",
        paths: ["src/checkout.ts"],
        commands: [
          "npm run test",
          "npm run preview",
          "npm run accesspath:replay",
        ],
      },
    });
    expect(awaiting.observedSteps).toEqual([
      {
        id: "submit-order",
        instruction: "Submit the order",
        state: "blocked",
        screenshot: {
          artifactId: expect.stringMatching(/^screenshot-/),
          sessionId: expect.stringMatching(/^audit-/),
          alt: "Screenshot captured after Submit the order.",
        },
        issues: [
          {
            id: "AP-MISSION-1",
            summary: "Checkout cannot be submitted by keyboard",
          },
          {
            id: "AP-MISSION-2",
            summary: "Checkout status needs stronger visual contrast",
          },
        ],
      },
    ]);

    const persisted = JSON.parse(
      await readFile(
        join(artifactRoot, "missions", created.id, "mission.json"),
        "utf8",
      ),
    );
    expect(persisted.authorizationGrant).toMatchObject({
      sourceSnapshotId: "source-mission-1",
      sourceSnapshotHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      taskHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      evidenceHashes: [expect.stringMatching(/^[a-f0-9]{64}$/)],
      approvedPaths: ["src/checkout.ts"],
      approvedCommands: [
        expect.objectContaining({
          executable: "npm",
          args: ["run", "test"],
          category: "test",
        }),
        expect.objectContaining({
          executable: "npm",
          args: ["run", "preview"],
          category: "start",
        }),
        expect.objectContaining({
          executable: "npm",
          args: ["run", "accesspath:replay"],
          category: "test",
        }),
      ],
      sandboxPolicy: {
        readPathGlobs: ["src/**"],
        writePathGlobs: ["src/checkout.ts"],
        network: "deny",
      },
    });
    const internals = service as unknown as {
      assertGrantBindings(record: unknown): Promise<void>;
      record(missionId: string): Promise<Record<string, unknown>>;
    };
    const authoritativeRecord = await internals.record(created.id);
    const approvedRecord = structuredClone(authoritativeRecord) as {
      authorization: { state: string };
      state: string;
    };
    approvedRecord.authorization.state = "approved";
    approvedRecord.state = "binding-source";
    await expect(
      internals.assertGrantBindings(approvedRecord),
    ).resolves.toBeUndefined();
    for (const state of ["pending", "denied", "expired"]) {
      const wrongAuthorizationState = structuredClone(approvedRecord);
      wrongAuthorizationState.authorization.state = state;
      await expect(
        internals.assertGrantBindings(wrongAuthorizationState),
      ).rejects.toThrow(/binding changed after authorization/i);
    }
    const changedEvidence = structuredClone(approvedRecord) as unknown as {
      authorizationGrant: { evidenceHashes: string[] };
    };
    changedEvidence.authorizationGrant.evidenceHashes = ["0".repeat(64)];
    await expect(
      internals.assertGrantBindings(changedEvidence),
    ).rejects.toThrow(/binding changed after authorization/i);
    const changedCommands = structuredClone(approvedRecord) as unknown as {
      authorizationGrant: {
        approvedCommands: Array<{ args: string[] }>;
      };
    };
    changedCommands.authorizationGrant.approvedCommands[0]!.args = [
      "run",
      "different-test",
    ];
    await expect(
      internals.assertGrantBindings(changedCommands),
    ).rejects.toThrow(/binding changed after authorization/i);
    await expect(
      service.patchPlan(
        created.id,
        { steps: created.plan.steps },
        "stale-plan",
        1,
      ),
    ).rejects.toBeInstanceOf(MissionRevisionError);

    const authorized = await service.authorizeRepair(
      created.id,
      { decision: "approve-once" },
      "authorize-1",
      awaiting.revision,
    );
    expect(authorized.state).toBe("binding-source");
    let patchReady = await service.get(created.id);
    for (let attempt = 0; attempt < 300; attempt += 1) {
      patchReady = await service.get(created.id);
      if (patchReady.state === "awaiting-patch-acceptance") {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(patchReady).toMatchObject({
      state: "awaiting-patch-acceptance",
      patch: {
        state: "pending",
        changedFiles: ["src/checkout.ts"],
      },
    });
    expect(patchReady.patch?.patch).toContain("keyboardSubmitEnabled");
    expect(sandboxSources).toHaveLength(2);
    expect(sandboxSources[0]).toBe(sourceRoot);
    expect(sandboxSources[1]).not.toBe(sourceRoot);
    const consumedRecord = JSON.parse(
      await readFile(
        join(artifactRoot, "missions", created.id, "mission.json"),
        "utf8",
      ),
    );
    expect(consumedRecord.authorizationGrant.state).toBe("consumed");

    const markdownReport = await service.report(created.id, "markdown");
    expect(markdownReport.content).toContain("## Observed on staging");
    expect(markdownReport.content).toContain("## Source reproduction");
    expect(markdownReport.content).toContain(
      "## Repaired preview verification",
    );
    expect(markdownReport.content).toContain("## Remaining issues");
    expect(markdownReport.content).toContain(
      "Staging was not redeployed by AccessPath.",
    );
    const jsonReport = JSON.parse(
      (await service.report(created.id, "json")).content,
    );
    expect(jsonReport.proof).toMatchObject({
      stagingObservation: {
        status: "recorded",
        outcome: "blocked",
        issueCount: 2,
      },
      sourceReproduction: { status: "reproduced" },
      repairedPreviewVerification: { status: "passed", testCount: 3 },
      unresolvedIssues: [
        {
          id: "AP-MISSION-2",
          state: "remaining",
        },
      ],
      stagingRedeployed: false,
    });

    const merged = await service.mergeVerifiedPatchForDemo(
      created.id,
      "merge-demo-1",
      patchReady.revision,
    );
    expect(merged).toMatchObject({
      state: "completed",
      patch: {
        state: "accepted",
        integration: "demo-merged",
      },
      proofThread: [
        { stage: "observed", status: "complete" },
        { stage: "scoped-repair", status: "complete" },
        { stage: "verified", status: "complete" },
        { stage: "merged", status: "complete" },
      ],
    });
    expect(await readFile(join(sourceRoot, "src", "checkout.ts"), "utf8")).toBe(
      "export {};\n",
    );
  });

  it("recovers one approved binding-source mission exactly once after restart", async () => {
    const artifactRoot = await temporaryDirectory(
      "mission-recovery-artifacts-",
    );
    const sourceRoot = await temporaryDirectory("mission-recovery-source-");
    await mkdir(join(sourceRoot, "src"), { recursive: true });
    await writeFile(join(sourceRoot, "src", "checkout.ts"), "export {};\n");
    await writeFile(
      join(sourceRoot, "package.json"),
      `${JSON.stringify({
        scripts: {
          preview: "vite preview --host 0.0.0.0 --port 4173",
          test: "vitest run",
          "accesspath:replay": "node scripts/replay.mjs",
        },
      })}\n`,
    );
    await execFileAsync("git", ["init", "-b", "main"], { cwd: sourceRoot });
    await execFileAsync("git", ["config", "user.email", "test@example.test"], {
      cwd: sourceRoot,
    });
    await execFileAsync("git", ["config", "user.name", "AccessPath Test"], {
      cwd: sourceRoot,
    });
    await execFileAsync("git", ["add", "."], { cwd: sourceRoot });
    await execFileAsync("git", ["commit", "-m", "fixture"], {
      cwd: sourceRoot,
    });
    const sourceCommit = (
      await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: sourceRoot })
    ).stdout.trim();
    let executeCalls = 0;
    let releaseExecution: (() => void) | undefined;
    let markExecutionStarted: (() => void) | undefined;
    const executionStarted = new Promise<void>((resolve) => {
      markExecutionStarted = resolve;
    });
    const executionRelease = new Promise<void>((resolve) => {
      releaseExecution = resolve;
    });
    const serviceConfig = {
      artifactRoot,
      editableRepositoryRoot: sourceRoot,
      auditRunner: auditRunner(),
      qoderAdapter: new DeterministicMockQoderAdapter({
        diagnosis: "Edit `src/checkout.ts` to restore keyboard submission.",
        edits: [
          {
            filePath: "src/checkout.ts",
            oldText: "export {};\n",
            newText: "export const keyboardSubmitEnabled = true;\n",
          },
        ],
      }),
      sourceAcquirer: {
        acquire: async (source: { kind: "local"; repositoryPath: string }) => ({
          source,
          repositoryPath: sourceRoot,
          snapshot: {
            schemaVersion: "1.0.0" as const,
            id: "source-recovery",
            source,
            acquiredAt: "2026-07-30T09:00:00.000Z",
            repositoryDisplayName: "checkout",
            sourceCommit,
            snapshotCommit: sourceCommit,
            treeHash: "c".repeat(40),
            contentManifestHash: "d".repeat(64),
            dirty: false,
            fileCount: 2,
            payloadBytes: 100,
          },
        }),
      },
      planner: async () => ({
        qoderSessionId: randomUuid(7),
        rawOutput: JSON.stringify(task),
        task,
        userMessageId: randomUuid(8),
      }),
      commandSandbox: {
        preflight: async () => ({
          mode: "execute" as const,
          cliAvailable: true,
          daemonAvailable: true,
          image: `example.test/accesspath@sha256:${"e".repeat(64)}`,
        }),
        execute: async () => {
          executeCalls += 1;
          markExecutionStarted?.();
          await executionRelease;
          return {
            capability: {
              mode: "execute" as const,
              cliAvailable: true,
              daemonAvailable: true,
              image: `example.test/accesspath@sha256:${"e".repeat(64)}`,
            },
            status: "completed" as const,
            artifactDirectory: await temporaryDirectory(
              "mission-recovery-sandbox-",
            ),
            results: [],
          };
        },
      },
      deploymentResolver: async () => ({
        state: "unverified" as const,
        deploymentUrl: task.startUrl,
        reason: "No trusted deployment metadata was available.",
      }),
      reconnaissance: async () => ({
        title: "Checkout",
        controls: [{ role: "button", name: "Submit order" }],
      }),
    };
    const firstService = new MissionService(serviceConfig);
    const created = await firstService.create(
      {
        stagingUrl: task.startUrl,
        source: { kind: "local", repositoryPath: sourceRoot },
        objective: task.goal,
      },
      "create-recovery",
    );
    await firstService.run(created.id, "run-recovery", created.revision);
    let awaiting = await firstService.get(created.id);
    for (let attempt = 0; attempt < 200; attempt += 1) {
      awaiting = await firstService.get(created.id);
      if (awaiting.state === "awaiting-repair-authorization") {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(awaiting.state).toBe("awaiting-repair-authorization");

    const missionPath = join(
      artifactRoot,
      "missions",
      created.id,
      "mission.json",
    );
    const persisted = JSON.parse(await readFile(missionPath, "utf8")) as {
      authorization: { state: string };
      state: string;
      revision: number;
      updatedAt: string;
    };
    persisted.authorization.state = "approved";
    persisted.state = "binding-source";
    persisted.revision = awaiting.revision + 1;
    persisted.updatedAt = "2026-07-30T10:30:00.000Z";
    await writeFile(missionPath, `${JSON.stringify(persisted, null, 2)}\n`);
    await writeFile(
      join(artifactRoot, "missions", created.id, "commands.json"),
      `${JSON.stringify(
        {
          "repair-authorization:authorize-recovery": {
            command: "repair-authorization",
            createdAt: "2026-07-30T10:30:00.000Z",
            missionId: created.id,
          },
        },
        null,
        2,
      )}\n`,
    );

    const recoveredService = new MissionService(serviceConfig);
    await executionStarted;
    const retried = await recoveredService.authorizeRepair(
      created.id,
      { decision: "approve-once" },
      "authorize-recovery",
      awaiting.revision,
    );
    expect(retried.state).toBe("binding-source");
    releaseExecution?.();
    let stopped = await recoveredService.get(created.id);
    for (let attempt = 0; attempt < 200; attempt += 1) {
      stopped = await recoveredService.get(created.id);
      if (stopped.state === "report-only") {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(stopped.state).toBe("report-only");
    expect(executeCalls).toBe(1);
  });

  it("recovers a persisted running audit under the same child id", async () => {
    const artifactRoot = await temporaryDirectory(
      "mission-audit-recovery-artifacts-",
    );
    const sourceRoot = await temporaryDirectory(
      "mission-audit-recovery-source-",
    );
    await mkdir(join(sourceRoot, "src"), { recursive: true });
    await writeFile(join(sourceRoot, "src", "checkout.ts"), "export {};\n");
    await execFileAsync("git", ["init", "-b", "main"], { cwd: sourceRoot });
    await execFileAsync("git", ["config", "user.email", "test@example.test"], {
      cwd: sourceRoot,
    });
    await execFileAsync("git", ["config", "user.name", "AccessPath Test"], {
      cwd: sourceRoot,
    });
    await execFileAsync("git", ["add", "."], { cwd: sourceRoot });
    await execFileAsync("git", ["commit", "-m", "fixture"], {
      cwd: sourceRoot,
    });
    const sourceCommit = (
      await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: sourceRoot })
    ).stdout.trim();
    const sourceAcquirer = {
      acquire: async (source: { kind: "local"; repositoryPath: string }) => ({
        source,
        repositoryPath: sourceRoot,
        snapshot: {
          schemaVersion: "1.0.0" as const,
          id: "source-audit-recovery",
          source,
          acquiredAt: "2026-07-30T09:00:00.000Z",
          repositoryDisplayName: "checkout",
          sourceCommit,
          snapshotCommit: sourceCommit,
          treeHash: "c".repeat(40),
          contentManifestHash: "d".repeat(64),
          dirty: false,
          fileCount: 1,
          payloadBytes: 16,
        },
      }),
    };
    const planner = async () => ({
      qoderSessionId: randomUuid(9),
      rawOutput: JSON.stringify(task),
      task,
      userMessageId: randomUuid(10),
    });
    const firstService = new MissionService({
      artifactRoot,
      editableRepositoryRoot: sourceRoot,
      sourceAcquirer,
      planner,
      reconnaissance: async () => ({ title: "Checkout" }),
    });
    const mission = await firstService.create(
      {
        stagingUrl: task.startUrl,
        source: { kind: "local", repositoryPath: sourceRoot },
        objective: task.goal,
      },
      "create-audit-recovery",
    );
    const childAuditService = new AuditService({
      artifactRoot,
      editableRepositoryRoot: sourceRoot,
      runner: auditRunner(),
    });
    const child = await childAuditService.create(task);
    const childSessionPath = join(
      artifactRoot,
      "audits",
      child.id,
      "session.json",
    );
    const childSession = JSON.parse(
      await readFile(childSessionPath, "utf8"),
    ) as {
      state: string;
      updatedAt: string;
    };
    childSession.state = "running";
    childSession.updatedAt = "2026-07-30T10:30:00.000Z";
    await writeFile(
      childSessionPath,
      `${JSON.stringify(childSession, null, 2)}\n`,
    );
    const missionPath = join(
      artifactRoot,
      "missions",
      mission.id,
      "mission.json",
    );
    const persistedMission = JSON.parse(
      await readFile(missionPath, "utf8"),
    ) as {
      auditId?: string;
      plan: { frozen: boolean };
      state: string;
      revision: number;
      updatedAt: string;
    };
    persistedMission.auditId = child.id;
    persistedMission.plan.frozen = true;
    persistedMission.state = "running-audit";
    persistedMission.revision += 1;
    persistedMission.updatedAt = "2026-07-30T10:30:00.000Z";
    await writeFile(
      missionPath,
      `${JSON.stringify(persistedMission, null, 2)}\n`,
    );

    const recoveredAuditIds: string[] = [];
    const persistedRunner = auditRunner();
    const recoveredService = new MissionService({
      artifactRoot,
      editableRepositoryRoot: sourceRoot,
      auditService: new AuditService({
        artifactRoot,
        editableRepositoryRoot: sourceRoot,
        runner: async (plannedTask, options) => {
          recoveredAuditIds.push(options.auditSessionId!);
          return persistedRunner(plannedTask, options);
        },
      }),
      sourceAcquirer,
      planner,
      reconnaissance: async () => ({ title: "Checkout" }),
    });
    await recoveredService.ready();
    let stopped = await recoveredService.get(mission.id);
    for (let attempt = 0; attempt < 200; attempt += 1) {
      stopped = await recoveredService.get(mission.id);
      if (stopped.state === "report-only") {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(stopped.state).toBe("report-only");
    expect(recoveredAuditIds).toEqual([child.id]);
    expect(
      (
        await readdir(join(artifactRoot, "audits"), {
          withFileTypes: true,
        })
      )
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name),
    ).toEqual([child.id]);
  });

  it("surfaces malformed mission state through startup readiness", async () => {
    const artifactRoot = await temporaryDirectory(
      "mission-recovery-error-artifacts-",
    );
    const sourceRoot = await temporaryDirectory(
      "mission-recovery-error-source-",
    );
    await mkdir(join(artifactRoot, "missions", "broken-mission"), {
      recursive: true,
    });
    await writeFile(
      join(artifactRoot, "missions", "broken-mission", "mission.json"),
      "{not-json}\n",
    );
    const service = new MissionService({
      artifactRoot,
      editableRepositoryRoot: sourceRoot,
    });
    await expect(service.ready()).rejects.toThrow(
      "Mission recovery failed for broken-mission.",
    );
  });

  it("reports sandbox unavailability without claiming execution support", async () => {
    const artifactRoot = await temporaryDirectory("mission-report-artifacts-");
    const repositoryRoot = await temporaryDirectory("mission-report-repo-");
    const sourceRoot = await temporaryDirectory("mission-report-source-");
    const service = new MissionService({
      artifactRoot,
      editableRepositoryRoot: repositoryRoot,
      sourceAcquirer: {
        acquire: async (source) => ({
          source,
          repositoryPath: sourceRoot,
          snapshot: {
            schemaVersion: "1.0.0",
            id: "source-report-only",
            source,
            acquiredAt: "2026-07-30T09:00:00.000Z",
            repositoryDisplayName: "report-only",
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
      planner: async () => ({
        qoderSessionId: randomUuid(3),
        rawOutput: JSON.stringify(task),
        task,
        userMessageId: randomUuid(4),
      }),
      commandSandbox: {
        preflight: async () => ({
          mode: "report-only",
          cliAvailable: false,
          daemonAvailable: false,
          image: "not-configured",
          reason:
            "Docker CLI is unavailable at C:\\Users\\private\\docker.exe and /home/private/docker.",
        }),
        execute: async () => ({
          capability: await Promise.resolve({
            mode: "report-only" as const,
            cliAvailable: false,
            daemonAvailable: false,
            image: "not-configured",
          }),
          status: "report-only",
          results: [],
        }),
      },
      deploymentResolver: async () => ({
        state: "unverified",
        deploymentUrl: task.startUrl,
        reason: "No trusted deployment metadata was available.",
      }),
      reconnaissance: async () => ({ title: "Report only" }),
    });
    const mission = await service.create(
      {
        stagingUrl: task.startUrl,
        source: { kind: "local", repositoryPath: repositoryRoot },
        objective: task.goal,
      },
      "create-report-only",
    );
    expect(mission.availability).toEqual({
      execution: "sandbox-unavailable",
      source: "bound",
      detail: "Docker CLI is unavailable at [LOCAL_PATH]",
    });
    expect(JSON.stringify(mission)).not.toContain(repositoryRoot);
    expect((await service.report(mission.id, "markdown")).content).toContain(
      "Remaining issues were not assessed because no staging audit bundle was produced.",
    );
    expect((await service.report(mission.id, "json")).content).not.toContain(
      repositoryRoot,
    );
  });

  it("requires an explicit evidence-producing replay command", async () => {
    const artifactRoot = await temporaryDirectory(
      "mission-no-replay-artifacts-",
    );
    const sourceRoot = await temporaryDirectory("mission-no-replay-source-");
    await mkdir(join(sourceRoot, "src"), { recursive: true });
    await writeFile(join(sourceRoot, "src", "checkout.ts"), "export {};\n");
    await writeFile(
      join(sourceRoot, "package.json"),
      `${JSON.stringify({
        scripts: {
          preview: "vite preview --host 0.0.0.0 --port 4173",
          test: "vitest run",
          "test:e2e": "playwright test",
        },
      })}\n`,
    );
    await execFileAsync("git", ["init", "-b", "main"], { cwd: sourceRoot });
    await execFileAsync("git", ["config", "user.email", "test@example.test"], {
      cwd: sourceRoot,
    });
    await execFileAsync("git", ["config", "user.name", "AccessPath Test"], {
      cwd: sourceRoot,
    });
    await execFileAsync("git", ["add", "."], { cwd: sourceRoot });
    await execFileAsync("git", ["commit", "-m", "fixture"], {
      cwd: sourceRoot,
    });
    const sourceCommit = (
      await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: sourceRoot })
    ).stdout.trim();
    const service = new MissionService({
      artifactRoot,
      editableRepositoryRoot: sourceRoot,
      auditRunner: auditRunner(),
      qoderAdapter: new DeterministicMockQoderAdapter({
        diagnosis: "Edit `src/checkout.ts` to restore keyboard submission.",
        edits: [
          {
            filePath: "src/checkout.ts",
            oldText: "export {};\n",
            newText: "export const keyboardSubmitEnabled = true;\n",
          },
        ],
      }),
      sourceAcquirer: {
        acquire: async (source) => ({
          source,
          repositoryPath: sourceRoot,
          snapshot: {
            schemaVersion: "1.0.0",
            id: "source-no-replay",
            source,
            acquiredAt: "2026-07-30T09:00:00.000Z",
            repositoryDisplayName: "checkout",
            sourceCommit,
            snapshotCommit: sourceCommit,
            treeHash: "c".repeat(40),
            contentManifestHash: "d".repeat(64),
            dirty: false,
            fileCount: 2,
            payloadBytes: 100,
          },
        }),
      },
      planner: async () => ({
        qoderSessionId: randomUuid(5),
        rawOutput: JSON.stringify(task),
        task,
        userMessageId: randomUuid(6),
      }),
      commandSandbox: {
        preflight: async () => ({
          mode: "execute",
          cliAvailable: true,
          daemonAvailable: true,
          image: `example.test/accesspath@sha256:${"e".repeat(64)}`,
        }),
        execute: async (request) => {
          const artifactDirectory = await temporaryDirectory(
            "mission-no-replay-output-",
          );
          const startedAt = "2026-07-30T10:00:00.000Z";
          const completedAt = "2026-07-30T10:00:01.000Z";
          return {
            capability: {
              mode: "execute" as const,
              cliAvailable: true,
              daemonAvailable: true,
              image: `example.test/accesspath@sha256:${"e".repeat(64)}`,
            },
            status: "completed" as const,
            artifactDirectory,
            results: [
              {
                command: request.command,
                phase: "command" as const,
                exitCode: 0,
                stdout: "",
                stderr: "",
                startedAt,
                completedAt,
                durationMs: 1_000,
                terminationReason: "completed" as const,
                outputTruncated: false,
              },
              {
                command: request.previewCommand!,
                phase: "preview" as const,
                exitCode: 0,
                stdout: "",
                stderr: "",
                startedAt,
                completedAt,
                durationMs: 1_000,
                terminationReason: "completed" as const,
                outputTruncated: false,
              },
              {
                command: request.replayCommand!,
                phase: "replay" as const,
                exitCode: 0,
                stdout: "",
                stderr: "",
                startedAt,
                completedAt,
                durationMs: 1_000,
                terminationReason: "completed" as const,
                outputTruncated: false,
              },
            ],
          };
        },
      },
      deploymentResolver: async () => ({
        state: "unverified",
        deploymentUrl: task.startUrl,
        reason: "No trusted deployment metadata was available.",
      }),
      reconnaissance: async () => ({
        title: "Checkout",
        controls: [{ role: "button", name: "Submit order" }],
      }),
    });

    const created = await service.create(
      {
        stagingUrl: task.startUrl,
        source: { kind: "local", repositoryPath: sourceRoot },
        objective: task.goal,
      },
      "create-no-replay",
    );
    await service.run(created.id, "run-no-replay", created.revision);
    let stopped = await service.get(created.id);
    for (let attempt = 0; attempt < 600; attempt += 1) {
      stopped = await service.get(created.id);
      if (stopped.state === "report-only") {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(stopped.state).toBe("report-only");
    expect(stopped.patch).toBeUndefined();
    expect(stopped.availability.detail).toContain(
      "no bounded browser replay command is configured",
    );
    const report = JSON.parse(
      (await service.report(created.id, "json")).content,
    ) as {
      proof: { unresolvedIssues: unknown[] };
      repairedAuditBundle?: unknown;
    };
    expect(report.repairedAuditBundle).toBeUndefined();
    expect(report.proof.unresolvedIssues.length).toBeGreaterThan(0);
    expect(
      (await service.report(created.id, "markdown")).content,
    ).not.toContain(
      "No remaining or newly introduced issues were recorded for this mission.",
    );
  });
});

function randomUuid(suffix: number): string {
  return `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
}
