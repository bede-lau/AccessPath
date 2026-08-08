import {
  AuditBundleSchema,
  TaskContractSchema,
  type AuditBundle,
  type Finding,
} from "@accesspath/contracts";
import { describe, expect, it } from "vitest";

import {
  compareReplayEvidence,
  replayVerificationIsAcceptable,
  taskForPreview,
} from "../src/repair-replay";

const task = TaskContractSchema.parse({
  schemaVersion: "1.0.0",
  id: "task-replay",
  title: "Replay",
  goal: "Complete the task.",
  startUrl: "http://127.0.0.1:4173/",
  targetPolicy: "local-explicit",
  success: { visibleText: "Done" },
  forbiddenActions: [],
  expectedSteps: [
    {
      id: "eligibility-choice",
      intent: "Choose eligibility",
      action: {
        kind: "click",
        role: "radio",
        name: "Yes",
      },
      checkpoint: true,
    },
  ],
  fixtureValues: {},
  viewport: { width: 1280, height: 800 },
  timeoutMs: 10_000,
});

function finding(id: string, stepId: string): Finding {
  return {
    id,
    title: id,
    affectedAction: "Complete the action",
    source: "task-runner",
    evidenceLabel: "observed",
    severity: "serious",
    modality: ["keyboard"],
    state: "open",
    stepId,
    wcagRefs: [],
    observation: `${id} observed`,
    reproduction: [],
    evidenceIds: [],
    manualReview: [],
  };
}

function bundle(input: {
  id: string;
  findings: Finding[];
  outcome?: AuditBundle["outcome"];
  stepState?: AuditBundle["steps"][number]["state"];
}): AuditBundle {
  return AuditBundleSchema.parse({
    schemaVersion: "1.0.0",
    id: input.id,
    auditSessionId: `audit-${input.id}`,
    runId: `run-${input.id}`,
    createdAt: "2026-07-28T00:00:00.000Z",
    environment: {
      browser: "chromium",
      browserVersion: "1",
      axeVersion: "1",
      viewport: { width: 1280, height: 800 },
      targetOrigin: "http://127.0.0.1:4173/",
    },
    task,
    outcome: input.outcome ?? "passed",
    steps: [
      {
        id: `step-${input.id}`,
        instructionId: "eligibility-choice",
        sequence: 1,
        state: input.stepState ?? "passed",
        intent: "Choose eligibility",
        attemptedAction: "Click radio Yes",
        observedOutcome: "Selected",
        url: "http://127.0.0.1:4173/",
        title: "Replay",
        startedAt: "2026-07-28T00:00:00.000Z",
        completedAt: "2026-07-28T00:00:01.000Z",
        evidence: [
          {
            id: `artifact-${input.id}`,
            kind: "screenshot",
            mimeType: "image/png",
            sha256: "a".repeat(64),
            relativePath: `artifacts/${input.id}.png`,
            sensitivity: "project",
            description: "Browser replay evidence.",
          },
        ],
      },
    ],
    findings: input.findings,
    artifacts: [],
    limitations: [],
    integrity: {
      algorithm: "sha256",
      manifestHash: "b".repeat(64),
    },
  });
}

describe("repair replay evidence", () => {
  it("keeps the original task identity while targeting the loopback preview", () => {
    expect(taskForPreview(task, "http://127.0.0.1:43174/")).toMatchObject({
      id: task.id,
      startUrl: "http://127.0.0.1:43174/",
      targetPolicy: "local-explicit",
      expectedSteps: task.expectedSteps,
    });
  });

  it("rejects non-loopback preview targets", () => {
    expect(() => taskForPreview(task, "https://example.com/")).toThrow(
      "loopback",
    );
  });

  it("marks the selected finding resolved and reproduced findings remaining", () => {
    const before = bundle({
      id: "before",
      findings: [
        finding("AP-001", "eligibility-choice"),
        finding("AP-002", "eligibility-choice"),
      ],
    });
    const after = bundle({
      id: "after",
      findings: [finding("AP-002", "eligibility-choice")],
    });

    expect(compareReplayEvidence(before, after, ["AP-001"])).toEqual([
      expect.objectContaining({
        findingId: "AP-001",
        afterState: "resolved",
        evidenceIds: ["artifact-after"],
      }),
      expect.objectContaining({
        findingId: "AP-002",
        afterState: "remaining",
      }),
    ]);
    expect(
      replayVerificationIsAcceptable(before, after, ["AP-001"]),
    ).toBe(true);
  });

  it("does not resolve a selected finding when its replay step is blocked", () => {
    const before = bundle({
      id: "before-blocked",
      findings: [finding("AP-001", "eligibility-choice")],
    });
    const after = bundle({
      id: "after-blocked",
      findings: [],
      outcome: "blocked",
      stepState: "blocked",
    });

    expect(compareReplayEvidence(before, after, ["AP-001"])).toEqual([
      expect.objectContaining({
        findingId: "AP-001",
        afterState: "unverified",
      }),
    ]);
  });

  it("does not resolve a selected finding from an observation after a blocker", () => {
    const before = bundle({
      id: "before-assisted",
      findings: [finding("AP-002", "eligibility-choice")],
    });
    const after = bundle({
      id: "after-assisted",
      findings: [],
      outcome: "blocked",
      stepState: "observation",
    });

    expect(compareReplayEvidence(before, after, ["AP-002"])).toEqual([
      expect.objectContaining({
        findingId: "AP-002",
        afterState: "unverified",
        evidenceIds: ["artifact-after-assisted"],
      }),
    ]);
    expect(
      replayVerificationIsAcceptable(before, after, ["AP-002"]),
    ).toBe(false);
  });

  it("rejects a repaired replay that introduces a new finding", () => {
    const before = bundle({
      id: "before-regression",
      findings: [finding("AP-001", "eligibility-choice")],
    });
    const after = bundle({
      id: "after-regression",
      findings: [finding("AP-NEW", "eligibility-choice")],
    });

    expect(compareReplayEvidence(before, after, ["AP-001"])).toEqual([
      expect.objectContaining({
        findingId: "AP-001",
        afterState: "unverified",
      }),
      expect.objectContaining({
        findingId: "AP-NEW",
        afterState: "regressed",
      }),
    ]);
    expect(
      replayVerificationIsAcceptable(before, after, ["AP-001"]),
    ).toBe(false);
  });
});
