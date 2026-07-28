import type {
  AccessPathEvent,
  AuditBundle,
  ArtifactRef,
  Finding,
} from "@accesspath/contracts";

export function finding(
  overrides: Partial<Finding> = {},
): Finding {
  return {
    id: "finding:fixture",
    title: "Keyboard users cannot choose eligibility",
    affectedAction: "Choose an eligibility option",
    source: "task-runner",
    evidenceLabel: "observed",
    severity: "blocker",
    modality: ["keyboard"],
    state: "open",
    stepId: "step-1",
    selector: "[data-option]",
    wcagRefs: ["2.1.1"],
    ruleId: "keyboard-path",
    observation: "The option does not respond to keyboard input.",
    diagnosis: "The custom control lacks keyboard semantics.",
    reproduction: ["Focus the option", "Press Space"],
    remediationGuidance: "Use a native radio control.",
    evidenceIds: [],
    manualReview: ["Confirm the focus indicator remains visible."],
    ...overrides,
  };
}

export function artifact(overrides: Partial<ArtifactRef> = {}): ArtifactRef {
  return {
    id: "artifact:fixture",
    kind: "console-summary",
    mimeType: "text/plain",
    sha256: "0".repeat(64),
    relativePath: `artifacts/${"0".repeat(64)}.txt`,
    sensitivity: "redacted",
    description: "Fixture artifact",
    ...overrides,
  };
}

export function bundle(
  overrides: Partial<Omit<AuditBundle, "integrity">> = {},
): Omit<AuditBundle, "integrity"> {
  return {
    schemaVersion: "1.0.0",
    id: "bundle-1",
    auditSessionId: "audit-1",
    runId: "run-1",
    createdAt: "2026-07-28T12:00:00.000Z",
    environment: {
      browser: "Chromium",
      browserVersion: "1",
      axeVersion: "4.10.0",
      viewport: { width: 1280, height: 720 },
      targetOrigin: "https://fixture.example",
    },
    task: {
      schemaVersion: "1.0.0",
      id: "task-1",
      title: "Check eligibility",
      goal: "Complete the eligibility task.",
      startUrl: "https://fixture.example/start",
      targetPolicy: "public",
      success: { visibleText: "Eligible" },
      forbiddenActions: ["Submit a real application"],
      expectedSteps: [
        {
          id: "instruction-1",
          intent: "Choose an option",
          action: { kind: "click", role: "radio", name: "Yes" },
          checkpoint: true,
        },
      ],
      fixtureValues: { applicantName: "Fictional Person" },
      viewport: { width: 1280, height: 720 },
      timeoutMs: 30_000,
    },
    outcome: "passed",
    steps: [],
    findings: [],
    artifacts: [],
    limitations: ["Automated checks do not replace manual review."],
    ...overrides,
  };
}

export function event(
  sequence: number,
  overrides: Partial<AccessPathEvent> = {},
): AccessPathEvent {
  return {
    schemaVersion: "1.0.0",
    eventId: `event-${sequence}`,
    sessionId: "audit-1",
    sequence,
    timestamp: "2026-07-28T12:00:00.000Z",
    type: "phase.changed",
    payload: { phase: sequence },
    ...overrides,
  };
}
