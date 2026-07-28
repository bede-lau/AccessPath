import { z } from "zod";
import {
  ArtifactRefSchema,
  EvidenceLabelSchema,
  HttpUrlSchema,
  IdentifierSchema,
  NonNegativeIntegerSchema,
  SeveritySchema,
  Sha256Schema,
  UtcTimestampSchema,
} from "./primitives";
import { TaskContractSchema } from "./task";
import { SchemaVersionSchema } from "./version";

// API_CONTRACTS.md L93-101: AuditState (8 values).
export const AuditStateSchema = z.enum([
  "draft",
  "ready",
  "running",
  "paused",
  "completed",
  "blocked",
  "failed",
  "cancelled",
]);

// API_CONTRACTS.md L103-110: StepState (7 values).
export const StepStateSchema = z.enum([
  "queued",
  "running",
  "passed",
  "observation",
  "blocked",
  "skipped",
  "failed",
]);

// API_CONTRACTS.md L112-120: AuditSession.
export const AuditSessionSchema = z.object({
  schemaVersion: SchemaVersionSchema,
  id: IdentifierSchema,
  state: AuditStateSchema,
  task: TaskContractSchema,
  createdAt: UtcTimestampSchema,
  updatedAt: UtcTimestampSchema,
  activeRunId: IdentifierSchema.optional(),
});

// API_CONTRACTS.md L122-136: TaskStepResult.
export const TaskStepResultSchema = z.object({
  id: IdentifierSchema,
  instructionId: IdentifierSchema,
  sequence: NonNegativeIntegerSchema,
  state: StepStateSchema,
  intent: z.string(),
  attemptedAction: z.string(),
  observedOutcome: z.string(),
  url: HttpUrlSchema,
  title: z.string(),
  focusedElement: z.string().optional(),
  startedAt: UtcTimestampSchema,
  completedAt: UtcTimestampSchema.optional(),
  evidence: z.array(ArtifactRefSchema),
});

// API_CONTRACTS.md L138-159: Finding (source 4, modality 6, state 6).
export const FindingSchema = z.object({
  id: IdentifierSchema,
  title: z.string(),
  affectedAction: z.string(),
  source: z.enum(["axe", "task-runner", "console", "manual"]),
  evidenceLabel: EvidenceLabelSchema,
  severity: SeveritySchema,
  modality: z.array(
    z.enum(["keyboard", "screen-reader", "visual", "cognitive", "motor", "other"]),
  ),
  state: z.enum(["open", "selected", "resolved", "remaining", "regressed", "unverified"]),
  stepId: IdentifierSchema,
  selector: z.string().optional(),
  wcagRefs: z.array(z.string()),
  ruleId: z.string().optional(),
  observation: z.string(),
  deterministicChecks: z.array(z.string()).optional(),
  diagnosis: z.string().optional(),
  reproduction: z.array(z.string()),
  remediationGuidance: z.string().optional(),
  evidenceIds: z.array(IdentifierSchema),
  manualReview: z.array(z.string()),
});

// API_CONTRACTS.md L161-184: AuditBundle (outcome 4, integrity sha256).
export const AuditBundleSchema = z.object({
  schemaVersion: SchemaVersionSchema,
  id: IdentifierSchema,
  auditSessionId: IdentifierSchema,
  runId: IdentifierSchema,
  createdAt: UtcTimestampSchema,
  environment: z.object({
    browser: z.string(),
    browserVersion: z.string(),
    axeVersion: z.string(),
    viewport: z.object({ width: z.number(), height: z.number() }),
    targetOrigin: HttpUrlSchema,
  }),
  task: TaskContractSchema,
  outcome: z.enum(["passed", "blocked", "failed", "cancelled"]),
  steps: z.array(TaskStepResultSchema),
  findings: z.array(FindingSchema),
  artifacts: z.array(ArtifactRefSchema),
  limitations: z.array(z.string()),
  integrity: z.object({
    algorithm: z.literal("sha256"),
    manifestHash: Sha256Schema,
  }),
});

export type AuditState = z.infer<typeof AuditStateSchema>;
export type StepState = z.infer<typeof StepStateSchema>;
export type AuditSession = z.infer<typeof AuditSessionSchema>;
export type TaskStepResult = z.infer<typeof TaskStepResultSchema>;
export type Finding = z.infer<typeof FindingSchema>;
export type AuditBundle = z.infer<typeof AuditBundleSchema>;
