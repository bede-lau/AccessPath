# API and Data Contracts

## Contract rules

- Define schemas in `packages/contracts` with Zod.
- Derive TypeScript types from schemas.
- Parse every persisted file, API input, and SDK event at the boundary.
- Use UUIDs or sortable unique IDs; never derive identity from display text.
- Store timestamps as ISO 8601 UTC strings.
- Persist relative artifact paths; never export absolute local paths.
- Current schema version: `1.0.0`.
- Additive fields are allowed within a major version.
- Readers must ignore unknown fields and reject unknown major versions.

## Shared primitives

```ts
type EvidenceLabel =
  | "observed"
  | "deterministic-check"
  | "inferred"
  | "proposed"
  | "verified"
  | "manual-review-required"
  | "unsupported";

type Severity = "blocker" | "critical" | "serious" | "moderate" | "minor";

type ArtifactRef = {
  id: string;
  kind:
    | "screenshot"
    | "accessibility-snapshot"
    | "axe-result"
    | "console-summary"
    | "network-summary"
    | "test-output"
    | "diff"
    | "report";
  mimeType: string;
  sha256: string;
  relativePath: string;
  sensitivity: "public" | "project" | "redacted";
  description: string;
};
```

## Task contract

```ts
type TaskContract = {
  schemaVersion: "1.0.0";
  id: string;
  title: string;
  goal: string;
  startUrl: string;
  targetPolicy: "public" | "local-explicit";
  success: {
    urlMatches?: string;
    visibleText?: string;
    selector?: string;
  };
  forbiddenActions: string[];
  expectedSteps: TaskInstruction[];
  fixtureValues: Record<string, string>;
  viewport: {
    width: number;
    height: number;
    deviceScaleFactor?: number;
  };
  timeoutMs: number;
};

type TaskInstruction = {
  id: string;
  intent: string;
  action:
    | { kind: "click"; role: string; name: string }
    | { kind: "fill"; label: string; valueRef: string }
    | { kind: "select"; label: string; option: string }
    | { kind: "press"; key: string }
    | { kind: "assert"; text: string };
  checkpoint: boolean;
};
```

Fixture values are resolved in memory. Raw secret values must not be written to
events, screenshots where avoidable, or exported bundles.

## Audit entities

```ts
type AuditState =
  | "draft"
  | "ready"
  | "running"
  | "paused"
  | "completed"
  | "blocked"
  | "failed"
  | "cancelled";

type StepState =
  | "queued"
  | "running"
  | "passed"
  | "observation"
  | "blocked"
  | "skipped"
  | "failed";

type AuditSession = {
  schemaVersion: "1.0.0";
  id: string;
  state: AuditState;
  task: TaskContract;
  createdAt: string;
  updatedAt: string;
  activeRunId?: string;
};

type TaskStepResult = {
  id: string;
  instructionId: string;
  sequence: number;
  state: StepState;
  intent: string;
  attemptedAction: string;
  observedOutcome: string;
  url: string;
  title: string;
  focusedElement?: string;
  startedAt: string;
  completedAt?: string;
  evidence: ArtifactRef[];
};

type Finding = {
  id: string;
  title: string;
  affectedAction: string;
  source: "axe" | "task-runner" | "console" | "manual";
  evidenceLabel: EvidenceLabel;
  severity: Severity;
  modality: Array<
    "keyboard" | "screen-reader" | "visual" | "cognitive" | "motor" | "other"
  >;
  state: "open" | "selected" | "resolved" | "remaining" | "regressed" | "unverified";
  stepId: string;
  selector?: string;
  wcagRefs: string[];
  ruleId?: string;
  observation: string;
  diagnosis?: string;
  reproduction: string[];
  remediationGuidance?: string;
  evidenceIds: string[];
  manualReview: string[];
};

type AuditBundle = {
  schemaVersion: "1.0.0";
  id: string;
  auditSessionId: string;
  runId: string;
  createdAt: string;
  environment: {
    browser: string;
    browserVersion: string;
    axeVersion: string;
    viewport: { width: number; height: number };
    targetOrigin: string;
  };
  task: TaskContract;
  outcome: "passed" | "blocked" | "failed" | "cancelled";
  steps: TaskStepResult[];
  findings: Finding[];
  artifacts: ArtifactRef[];
  limitations: string[];
  integrity: {
    algorithm: "sha256";
    manifestHash: string;
  };
};
```

## Repair entities

```ts
type RepairState =
  | "configuring"
  | "preparing"
  | "diagnosing"
  | "awaiting-plan-approval"
  | "editing"
  | "paused"
  | "verifying"
  | "awaiting-patch-approval"
  | "approved"
  | "completed"
  | "rejected"
  | "failed"
  | "cancelled";

type RepositoryConfig = {
  repositoryPath: string;
  baseBranch: string;
  baseCommit: string;
  startCommand: CommandSpec;
  testCommands: CommandSpec[];
  previewUrl: string;
  allowedPathGlobs: string[];
};

type CommandSpec = {
  id: string;
  label: string;
  executable: string;
  args: string[];
  cwdRelative: string;
  timeoutMs: number;
  category: "start" | "test" | "lint" | "typecheck" | "build";
};

type RepairManifest = {
  schemaVersion: "1.0.0";
  id: string;
  auditBundleId: string;
  findingIds: string[];
  affectedActions: string[];
  observations: string[];
  evidenceRefs: ArtifactRef[];
  constraints: string[];
  nonGoals: string[];
  allowedPathGlobs: string[];
  verification: {
    taskContract: TaskContract;
    commands: CommandSpec[];
  };
};

type RepairSession = {
  schemaVersion: "1.0.0";
  id: string;
  state: RepairState;
  auditBundleId: string;
  manifestId: string;
  createdAt: string;
  updatedAt: string;
  repository: Omit<RepositoryConfig, "repositoryPath"> & {
    repositoryDisplayName: string;
  };
  branch: string;
  worktreeId: string;
  qoderSessionId?: string;
  latestCheckpointId?: string;
};
```

Absolute repository and worktree paths may be stored in a local private
session file but must be stripped from API responses and exports.

## Approval and checkpoint contracts

```ts
type ToolRisk = "read" | "write" | "command" | "network" | "destructive";

type ApprovalRequest = {
  id: string;
  repairSessionId: string;
  kind: "plan" | "tool" | "patch" | "rewind";
  title: string;
  consequence: string;
  risk: ToolRisk;
  targetPaths: string[];
  command?: CommandSpec;
  createdAt: string;
  state: "pending" | "approved" | "denied" | "expired";
};

type ApprovalDecision = {
  decision: "approve-once" | "approve-session" | "deny";
  reason?: string;
};

type Checkpoint = {
  id: string;
  repairSessionId: string;
  qoderMessageId?: string;
  createdAt: string;
  files: string[];
  insertions: number;
  deletions: number;
  gitTreeHash: string;
};

type RewindPreview = {
  checkpointId: string;
  affectedFiles: string[];
  insertionsRemoved: number;
  deletionsRestored: number;
  staleVerificationIds: string[];
  nonFileSideEffectWarning: string;
};
```

## Verification contract

```ts
type TestResult = {
  commandId: string;
  state: "passed" | "failed" | "timed-out" | "cancelled";
  exitCode?: number;
  durationMs: number;
  outputArtifactId: string;
};

type FindingComparison = {
  findingId: string;
  beforeState: "open";
  afterState: "resolved" | "remaining" | "regressed" | "unverified";
  explanation: string;
  evidenceIds: string[];
};

type VerificationRun = {
  id: string;
  repairSessionId: string;
  startedAt: string;
  completedAt?: string;
  previewUrl: string;
  tests: TestResult[];
  auditBundleId?: string;
  comparison: FindingComparison[];
};
```

## REST API

All responses use JSON except artifact downloads and SSE.

### System

```text
GET /api/health
GET /api/config/public
POST /api/auth/qoder/validate
```

### Audits

```text
POST /api/audits
GET  /api/audits/:auditId
PATCH /api/audits/:auditId
POST /api/audits/:auditId/start
POST /api/audits/:auditId/pause
POST /api/audits/:auditId/resume
POST /api/audits/:auditId/cancel
GET  /api/audits/:auditId/bundle
GET  /api/audits/:auditId/report?format=html|markdown|json
```

### Repositories and repairs

```text
POST /api/repositories/validate
POST /api/repairs
GET  /api/repairs/:repairId
POST /api/repairs/:repairId/prepare
POST /api/repairs/:repairId/diagnose
POST /api/repairs/:repairId/start
POST /api/repairs/:repairId/pause
POST /api/repairs/:repairId/resume
POST /api/repairs/:repairId/cancel
GET  /api/repairs/:repairId/diff
POST /api/repairs/:repairId/verify
GET  /api/repairs/:repairId/report?format=html|markdown|json
```

### Approval and rewind

```text
POST /api/approvals/:approvalId/decision
POST /api/checkpoints/:checkpointId/rewind-preview
POST /api/checkpoints/:checkpointId/rewind
```

### Events and artifacts

```text
GET /api/sessions/:sessionId/events
GET /api/artifacts/:artifactId
```

`GET /events` uses `text/event-stream`. Accept the `Last-Event-ID` header and
an optional `after` query parameter for debugging.

## Event envelope

```ts
type AccessPathEvent<T = unknown> = {
  schemaVersion: "1.0.0";
  eventId: string;
  sessionId: string;
  sequence: number;
  timestamp: string;
  correlationId?: string;
  type: EventType;
  payload: T;
};
```

Event types:

```text
session.created
phase.changed
audit.step.started
audit.step.completed
audit.step.blocked
finding.created
artifact.created
agent.message.delta
agent.message.completed
tool.requested
tool.approved
tool.denied
tool.started
tool.completed
tool.failed
file.changed
diff.updated
test.started
test.output
test.completed
checkpoint.created
rewind.previewed
rewind.completed
verification.started
verification.completed
session.paused
session.resumed
session.completed
session.failed
session.cancelled
```

`agent.message.delta` may be ephemeral in the UI, but the completed message
must be persisted. High-volume test output may be chunked and linked to a final
artifact.

## Error response

```ts
type ErrorResponse = {
  error: {
    code:
      | "INVALID_INPUT"
      | "INVALID_TARGET"
      | "TARGET_POLICY_DENIED"
      | "REPOSITORY_INVALID"
      | "REPOSITORY_DIRTY"
      | "PATH_ESCAPE"
      | "QODER_AUTH_REQUIRED"
      | "QODER_PERMISSION_DENIED"
      | "COMMAND_DENIED"
      | "CONFLICT"
      | "TIMEOUT"
      | "NOT_FOUND"
      | "INVALID_STATE"
      | "INTERNAL";
    message: string;
    nextAction?: string;
    correlationId: string;
    details?: Record<string, unknown>;
  };
};
```

Errors must not contain tokens, cookies, raw form values, or full absolute
paths.

## Idempotency and concurrency

- Start, cancel, approval, verify, and rewind commands accept
  `Idempotency-Key`.
- A session has one active state-transition lock.
- Duplicate decisions return the current resource.
- A stale client receives `409 CONFLICT` with the current state.
- Event IDs and sequences are allocated before append.

## Contract acceptance criteria

- Every example fixture parses with the shared schemas.
- Unknown major versions are rejected with a useful error.
- Event sequences are monotonic and replayable.
- No API response leaks local absolute paths.
- State-invalid commands fail without side effects.
- Exported reports can be regenerated entirely from persisted contracts and
  artifacts.
