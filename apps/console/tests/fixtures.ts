import type {
  AuditBundle,
  AuditSession,
  Finding,
  TaskStepResult,
} from "@accesspath/contracts";

import { createReviewedAuditTask } from "../src/reviewed-task";

export const reviewedTask = createReviewedAuditTask(
  "http://127.0.0.1:4173/",
  "local-explicit",
);

const findingInputs = [
  {
    id: "AP-001",
    stepId: "eligibility-choice",
    title: "Eligibility option cannot be chosen with a keyboard",
    affectedAction: "Choose an eligibility option with a keyboard",
    severity: "blocker",
    source: "task-runner",
    evidenceLabel: "observed",
  },
  {
    id: "AP-002",
    stepId: "profile-phone",
    title: "Phone purpose is not identified",
    affectedAction: "Enter a phone number with its expected purpose",
    severity: "serious",
    source: "axe",
    evidenceLabel: "deterministic-check",
  },
  {
    id: "AP-003",
    stepId: "assistance-rent",
    title: "Assistance choices have no group name",
    affectedAction: "Understand the assistance choice group",
    severity: "serious",
    source: "axe",
    evidenceLabel: "deterministic-check",
  },
  {
    id: "AP-004",
    stepId: "review-invalid",
    title: "Review error does not identify the field",
    affectedAction: "Recover from the review validation error",
    severity: "critical",
    source: "task-runner",
    evidenceLabel: "observed",
  },
  {
    id: "AP-005",
    stepId: "submission-confirmation",
    title: "Submission confirmation is not announced",
    affectedAction: "Hear the submission confirmation",
    severity: "serious",
    source: "task-runner",
    evidenceLabel: "observed",
  },
] as const;

export const findings: Finding[] = findingInputs.map((input) => ({
  ...input,
  modality: ["keyboard", "screen-reader"],
  state: input.id === "AP-001" ? "selected" : "open",
  selector: `[data-barrier-id='${input.id}']`,
  wcagRefs: ["1.3.1", "4.1.2"],
  observation: `${input.id} was reproduced on the reviewed task path.`,
  diagnosis: `${input.id} requires a bounded source-level repair.`,
  reproduction: [
    "Open the emergency aid fixture.",
    `Run the reviewed action for ${input.id}.`,
  ],
  remediationGuidance: `Repair ${input.id} without changing unrelated behavior.`,
  evidenceIds: [],
  manualReview: ["Confirm the result with assistive technology."],
}));

export const stepResults: TaskStepResult[] = reviewedTask.expectedSteps.map(
  (instruction, index) => ({
    id: `result-${index + 1}`,
    instructionId: instruction.id,
    sequence: index + 1,
    state: instruction.id === "eligibility-choice" ? "blocked" : "observation",
    intent: instruction.intent,
    attemptedAction: instruction.intent,
    observedOutcome:
      instruction.id === "eligibility-choice"
        ? "Keyboard activation did not select the option."
        : "The assisted path captured deterministic evidence.",
    url: reviewedTask.startUrl,
    title: "Emergency assistance demo",
    focusedElement: "body",
    startedAt: "2026-07-28T09:00:00.000Z",
    completedAt: "2026-07-28T09:00:01.000Z",
    evidence: [],
  }),
);

export const runningSession: AuditSession = {
  schemaVersion: "1.0.0",
  id: "audit-p05",
  state: "running",
  task: reviewedTask,
  createdAt: "2026-07-28T09:00:00.000Z",
  updatedAt: "2026-07-28T09:00:01.000Z",
  activeRunId: "run-p05",
};

export const blockedSession: AuditSession = {
  ...runningSession,
  state: "blocked",
  updatedAt: "2026-07-28T09:01:00.000Z",
};

export const auditBundle: AuditBundle = {
  schemaVersion: "1.0.0",
  id: "bundle-p05",
  auditSessionId: runningSession.id,
  runId: "run-p05",
  createdAt: "2026-07-28T09:01:00.000Z",
  environment: {
    browser: "chromium",
    browserVersion: "126.0.0.0",
    axeVersion: "4.12.1",
    viewport: { width: 1280, height: 800 },
    targetOrigin: "http://127.0.0.1:4173",
  },
  task: reviewedTask,
  outcome: "blocked",
  steps: stepResults,
  findings,
  artifacts: [],
  limitations: ["Screen-reader behavior requires manual review."],
  integrity: {
    algorithm: "sha256",
    manifestHash: "a".repeat(64),
  },
};
