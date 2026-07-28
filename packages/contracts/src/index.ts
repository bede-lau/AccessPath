// @accesspath/contracts — versioned Zod schemas for AccessPath.
// Source of truth: docs/API_CONTRACTS.md (schema version 1.0.0).

export {
  SCHEMA_VERSION,
  SchemaVersionSchema,
  parseVersioned,
  type SchemaVersion,
} from "./version";

export {
  IdentifierSchema,
  UtcTimestampSchema,
  Sha256Schema,
  RelativePathSchema,
  HttpUrlSchema,
  PositiveIntegerSchema,
  NonNegativeIntegerSchema,
  EvidenceLabelSchema,
  SeveritySchema,
  ArtifactRefSchema,
  type EvidenceLabel,
  type Severity,
  type ArtifactRef,
} from "./primitives";

export {
  TaskInstructionSchema,
  TaskContractSchema,
  type TaskInstruction,
  type TaskContract,
} from "./task";

export {
  AuditStateSchema,
  StepStateSchema,
  AuditSessionSchema,
  TaskStepResultSchema,
  FindingSchema,
  AuditBundleSchema,
  type AuditState,
  type StepState,
  type AuditSession,
  type TaskStepResult,
  type Finding,
  type AuditBundle,
} from "./audit";

export {
  RepairStateSchema,
  CommandSpecSchema,
  RepositoryConfigSchema,
  RepairManifestSchema,
  RepairSessionSchema,
  type RepairState,
  type CommandSpec,
  type RepositoryConfig,
  type RepairManifest,
  type RepairSession,
} from "./repair";

export {
  ToolRiskSchema,
  ApprovalRequestSchema,
  ApprovalDecisionSchema,
  CheckpointSchema,
  RewindPreviewSchema,
  type ToolRisk,
  type ApprovalRequest,
  type ApprovalDecision,
  type Checkpoint,
  type RewindPreview,
} from "./approval";

export {
  TestResultSchema,
  FindingComparisonSchema,
  VerificationRunSchema,
  type TestResult,
  type FindingComparison,
  type VerificationRun,
} from "./verification";

export {
  EventTypeSchema,
  accessPathEventSchema,
  AccessPathEventSchema,
  type EventType,
  type AccessPathEvent,
} from "./events";

export {
  ErrorCodeSchema,
  ErrorResponseSchema,
  type ErrorCode,
  type ErrorResponse,
} from "./errors";
