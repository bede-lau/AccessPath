// Shared valid fixtures for every contract entity, mirroring docs/API_CONTRACTS.md.
import type {
  AccessPathEvent,
  ApprovalDecision,
  ApprovalRequest,
  ArtifactRef,
  AuditBundle,
  AuditSession,
  Checkpoint,
  CommandSpec,
  ErrorResponse,
  Finding,
  FindingComparison,
  RepairManifest,
  RepairSession,
  RepositoryConfig,
  RewindPreview,
  TaskContract,
  TaskInstruction,
  TaskStepResult,
  TestResult,
  VerificationRun,
} from "../src/index";

export const artifactRefFixture: ArtifactRef = {
  id: "art-0001",
  kind: "screenshot",
  mimeType: "image/png",
  sha256: "a".repeat(64),
  relativePath: "artifacts/step-01/after.png",
  sensitivity: "project",
  description: "Screenshot after submitting the signup form",
};

export const taskInstructionFixtures: TaskInstruction[] = [
  {
    id: "ins-click",
    intent: "Open the signup form",
    action: { kind: "click", role: "button", name: "Sign up" },
    checkpoint: false,
  },
  {
    id: "ins-fill",
    intent: "Enter the email address",
    action: { kind: "fill", label: "Email", valueRef: "email" },
    checkpoint: false,
  },
  {
    id: "ins-select",
    intent: "Choose a country",
    action: { kind: "select", label: "Country", option: "Germany" },
    checkpoint: false,
  },
  {
    id: "ins-press",
    intent: "Submit with the keyboard",
    action: { kind: "press", key: "Enter" },
    checkpoint: true,
  },
  {
    id: "ins-assert",
    intent: "Confirm the success message",
    action: { kind: "assert", text: "Welcome aboard" },
    checkpoint: false,
  },
];

export const taskContractFixture: TaskContract = {
  schemaVersion: "1.0.0",
  id: "task-0001",
  title: "Sign up with keyboard only",
  goal: "Complete the signup flow using only the keyboard",
  startUrl: "http://localhost:5173/signup",
  targetPolicy: "local-explicit",
  success: {
    urlMatches: "/welcome",
    visibleText: "Welcome aboard",
    selector: "[data-testid='welcome-banner']",
  },
  forbiddenActions: ["Do not submit real payment details"],
  expectedSteps: taskInstructionFixtures,
  fixtureValues: { email: "demo@example.test" },
  viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
  timeoutMs: 120000,
};

export const auditSessionFixture: AuditSession = {
  schemaVersion: "1.0.0",
  id: "audit-0001",
  state: "running",
  task: taskContractFixture,
  createdAt: "2026-07-28T09:00:00.000Z",
  updatedAt: "2026-07-28T09:05:00.000Z",
  activeRunId: "run-0001",
};

export const taskStepResultFixture: TaskStepResult = {
  id: "step-0001",
  instructionId: "ins-click",
  sequence: 1,
  state: "passed",
  intent: "Open the signup form",
  attemptedAction: "Clicked button 'Sign up'",
  observedOutcome: "Signup form became visible and received focus",
  url: "http://localhost:5173/signup",
  title: "Sign up — Demo App",
  focusedElement: "input[name='email']",
  startedAt: "2026-07-28T09:01:00.000Z",
  completedAt: "2026-07-28T09:01:02.000Z",
  evidence: [artifactRefFixture],
};

export const findingFixture: Finding = {
  id: "finding-0001",
  title: "Email field is missing an accessible label",
  affectedAction: "Enter the email address",
  source: "axe",
  evidenceLabel: "deterministic-check",
  severity: "serious",
  modality: ["screen-reader", "keyboard"],
  state: "open",
  stepId: "step-0001",
  selector: "input[name='email']",
  wcagRefs: ["1.3.1", "4.1.2"],
  ruleId: "label",
  observation: "The email input has no programmatically associated label",
  diagnosis: "The <label> element lacks a for attribute",
  reproduction: ["Navigate to /signup", "Tab to the email input"],
  remediationGuidance: "Associate the label with the input via for/id",
  evidenceIds: ["art-0001"],
  manualReview: ["Confirm announcement with a screen reader"],
};

export const auditBundleFixture: AuditBundle = {
  schemaVersion: "1.0.0",
  id: "bundle-0001",
  auditSessionId: "audit-0001",
  runId: "run-0001",
  createdAt: "2026-07-28T09:10:00.000Z",
  environment: {
    browser: "chromium",
    browserVersion: "126.0.0.0",
    axeVersion: "4.10.0",
    viewport: { width: 1280, height: 720 },
    targetOrigin: "http://localhost:5173",
  },
  task: taskContractFixture,
  outcome: "blocked",
  steps: [taskStepResultFixture],
  findings: [findingFixture],
  artifacts: [artifactRefFixture],
  limitations: ["Screen reader behavior was not verified with real AT"],
  integrity: { algorithm: "sha256", manifestHash: "b".repeat(64) },
};

export const commandSpecFixture: CommandSpec = {
  id: "cmd-test",
  label: "Run unit tests",
  executable: "npm",
  args: ["run", "test"],
  cwdRelative: ".",
  timeoutMs: 300000,
  category: "test",
};

export const startCommandFixture: CommandSpec = {
  id: "cmd-start",
  label: "Start dev server",
  executable: "npm",
  args: ["run", "dev"],
  cwdRelative: ".",
  timeoutMs: 60000,
  category: "start",
};

export const repositoryConfigFixture: RepositoryConfig = {
  repositoryPath: "C:/dev/demo-app",
  baseBranch: "main",
  baseCommit: "c".repeat(40),
  startCommand: startCommandFixture,
  testCommands: [commandSpecFixture],
  previewUrl: "http://localhost:5173",
  allowedPathGlobs: ["src/**", "public/**"],
};

export const repairManifestFixture: RepairManifest = {
  schemaVersion: "1.0.0",
  id: "manifest-0001",
  auditBundleId: "bundle-0001",
  findingIds: ["finding-0001"],
  affectedActions: ["Enter the email address"],
  observations: ["The email input has no programmatically associated label"],
  evidenceRefs: [artifactRefFixture],
  constraints: ["Do not change visual design"],
  nonGoals: ["Refactoring unrelated components"],
  allowedPathGlobs: ["src/**"],
  verification: {
    taskContract: taskContractFixture,
    commands: [commandSpecFixture],
  },
};

export const repairSessionFixture: RepairSession = {
  schemaVersion: "1.0.0",
  id: "repair-0001",
  state: "awaiting-plan-approval",
  auditBundleId: "bundle-0001",
  manifestId: "manifest-0001",
  createdAt: "2026-07-28T10:00:00.000Z",
  updatedAt: "2026-07-28T10:05:00.000Z",
  repository: {
    repositoryDisplayName: "demo-app",
    baseBranch: "main",
    baseCommit: "c".repeat(40),
    startCommand: startCommandFixture,
    testCommands: [commandSpecFixture],
    previewUrl: "http://localhost:5173",
    allowedPathGlobs: ["src/**", "public/**"],
  },
  branch: "accesspath/repair-0001",
  worktreeId: "wt-0001",
  qoderSessionId: "qoder-0001",
  latestCheckpointId: "chk-0001",
};

export const approvalRequestFixture: ApprovalRequest = {
  id: "approval-0001",
  repairSessionId: "repair-0001",
  kind: "tool",
  title: "Run unit tests",
  consequence: "Executes the project test command in the worktree",
  risk: "command",
  targetPaths: ["src/components/SignupForm.tsx"],
  command: commandSpecFixture,
  createdAt: "2026-07-28T10:10:00.000Z",
  state: "pending",
};

export const approvalDecisionFixture: ApprovalDecision = {
  decision: "approve-once",
  reason: "Test command matches the configured allowlist",
};

export const checkpointFixture: Checkpoint = {
  id: "chk-0001",
  repairSessionId: "repair-0001",
  qoderMessageId: "msg-0001",
  createdAt: "2026-07-28T10:15:00.000Z",
  files: ["src/components/SignupForm.tsx"],
  insertions: 4,
  deletions: 1,
  gitTreeHash: "d".repeat(40),
};

export const rewindPreviewFixture: RewindPreview = {
  checkpointId: "chk-0001",
  affectedFiles: ["src/components/SignupForm.tsx"],
  insertionsRemoved: 4,
  deletionsRestored: 1,
  staleVerificationIds: ["verify-0001"],
  nonFileSideEffectWarning:
    "Commands executed after this checkpoint are not undone by rewinding files",
};

export const testResultFixture: TestResult = {
  commandId: "cmd-test",
  state: "passed",
  exitCode: 0,
  durationMs: 5321,
  outputArtifactId: "art-0002",
};

export const findingComparisonFixture: FindingComparison = {
  findingId: "finding-0001",
  beforeState: "open",
  afterState: "resolved",
  explanation: "The label is now associated and axe no longer reports the rule",
  evidenceIds: ["art-0003"],
};

export const verificationRunFixture: VerificationRun = {
  id: "verify-0001",
  repairSessionId: "repair-0001",
  startedAt: "2026-07-28T10:20:00.000Z",
  completedAt: "2026-07-28T10:25:00.000Z",
  previewUrl: "http://localhost:5173",
  tests: [testResultFixture],
  auditBundleId: "bundle-0002",
  comparison: [findingComparisonFixture],
};

export const accessPathEventFixture: AccessPathEvent = {
  schemaVersion: "1.0.0",
  eventId: "evt-0001",
  sessionId: "repair-0001",
  sequence: 42,
  timestamp: "2026-07-28T10:20:01.000Z",
  correlationId: "corr-0001",
  type: "test.started",
  payload: { commandId: "cmd-test" },
};

export const errorResponseFixture: ErrorResponse = {
  error: {
    code: "CONFLICT",
    message: "The session state changed; reload to get the current state",
    nextAction: "Refresh the session and retry the command",
    correlationId: "corr-0002",
    details: { currentState: "verifying" },
  },
};
