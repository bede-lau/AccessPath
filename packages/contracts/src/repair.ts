import { z } from "zod";
import {
  ArtifactRefSchema,
  HttpUrlSchema,
  IdentifierSchema,
  NonNegativeIntegerSchema,
  PositiveIntegerSchema,
  RelativePathSchema,
  UtcTimestampSchema,
} from "./primitives";
import { TaskContractSchema } from "./task";
import { SchemaVersionSchema } from "./version";

// API_CONTRACTS.md L190-203: RepairState (13 kebab-case values).
export const RepairStateSchema = z.enum([
  "configuring",
  "preparing",
  "diagnosing",
  "awaiting-plan-approval",
  "editing",
  "paused",
  "verifying",
  "awaiting-patch-approval",
  "approved",
  "completed",
  "rejected",
  "failed",
  "cancelled",
]);

// API_CONTRACTS.md L215-223: CommandSpec (executable + args array, category 5 values).
export const CommandSpecSchema = z.object({
  id: IdentifierSchema,
  label: z.string().min(1),
  executable: z.string().min(1),
  args: z.array(z.string()),
  cwdRelative: RelativePathSchema,
  timeoutMs: PositiveIntegerSchema,
  category: z.enum(["start", "test", "lint", "typecheck", "build"]),
});

// API_CONTRACTS.md L205-213: RepositoryConfig.
export const RepositoryConfigSchema = z.object({
  repositoryPath: z.string().min(1),
  baseBranch: z.string().min(1),
  baseCommit: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i),
  startCommand: CommandSpecSchema,
  testCommands: z.array(CommandSpecSchema),
  previewUrl: HttpUrlSchema,
  allowedPathGlobs: z.array(RelativePathSchema),
});

const BoundedTextSchema = z.string().trim().min(1).max(2_000);
const BoundedLabelSchema = z.string().trim().min(1).max(300);
const QoderUuidSchema = z.string().uuid();

export const FindingRepairContextSchema = z.object({
  id: IdentifierSchema,
  title: BoundedLabelSchema,
  selector: z.string().trim().min(1).max(1_000).optional(),
  ruleId: z.string().trim().min(1).max(200).optional(),
  diagnosis: BoundedTextSchema.optional(),
  reproduction: z.array(BoundedTextSchema).max(8),
  remediationGuidance: BoundedTextSchema.optional(),
});

// API_CONTRACTS.md L225-240: RepairManifest.
export const RepairManifestSchema = z.object({
  schemaVersion: SchemaVersionSchema,
  id: IdentifierSchema,
  auditBundleId: IdentifierSchema,
  findingIds: z.array(IdentifierSchema).max(8),
  affectedActions: z.array(BoundedTextSchema).max(8),
  observations: z.array(BoundedTextSchema).max(8),
  evidenceRefs: z.array(ArtifactRefSchema).max(16),
  constraints: z.array(BoundedTextSchema).max(16),
  nonGoals: z.array(BoundedTextSchema).max(16),
  allowedPathGlobs: z.array(RelativePathSchema).max(24),
  readPathGlobs: z.array(RelativePathSchema).max(24).optional(),
  findingContext: z.array(FindingRepairContextSchema).max(8).optional(),
  verification: z.object({
    taskContract: TaskContractSchema,
    commands: z.array(CommandSpecSchema).max(16),
  }),
});

export const QoderModelUsageSchema = z.object({
  model: z.string().trim().min(1).max(200),
  inputTokens: NonNegativeIntegerSchema,
  outputTokens: NonNegativeIntegerSchema,
  cacheReadInputTokens: NonNegativeIntegerSchema,
  cacheCreationInputTokens: NonNegativeIntegerSchema,
  webSearchRequests: NonNegativeIntegerSchema,
  costUsd: z.number().nonnegative(),
  contextWindow: NonNegativeIntegerSchema,
  maxOutputTokens: NonNegativeIntegerSchema,
});

export const QoderTurnSchema = z.object({
  id: IdentifierSchema,
  mode: z.enum(["diagnosis", "repair"]),
  status: z.enum(["running", "completed", "interrupted", "failed"]),
  startedAt: UtcTimestampSchema,
  completedAt: UtcTimestampSchema.optional(),
  qoderSessionId: QoderUuidSchema,
  userMessageId: QoderUuidSchema,
  command: z.enum(["diagnose", "start", "resume"]).optional(),
  commandFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  resumed: z.boolean(),
  requestedModel: z.enum(["efficient", "performance"]),
  maxTurns: PositiveIntegerSchema,
  numTurns: NonNegativeIntegerSchema.optional(),
  totalCostUsd: z.number().nonnegative().optional(),
  durationMs: NonNegativeIntegerSchema.optional(),
  durationApiMs: NonNegativeIntegerSchema.optional(),
  inputTokens: NonNegativeIntegerSchema.optional(),
  outputTokens: NonNegativeIntegerSchema.optional(),
  cacheReadInputTokens: NonNegativeIntegerSchema.optional(),
  cacheCreationInputTokens: NonNegativeIntegerSchema.optional(),
  stopReason: z.string().max(200).nullable().optional(),
  modelUsage: z.array(QoderModelUsageSchema).max(16).optional(),
});

// API_CONTRACTS.md L242-257: RepairSession. The repository field is
// Omit<RepositoryConfig, "repositoryPath"> & { repositoryDisplayName } (L250-252),
// so absolute paths never leave the local private session file (L260-261).
export const RepairSessionSchema = z.object({
  schemaVersion: SchemaVersionSchema,
  id: IdentifierSchema,
  state: RepairStateSchema,
  auditBundleId: IdentifierSchema,
  manifestId: IdentifierSchema,
  createdAt: UtcTimestampSchema,
  updatedAt: UtcTimestampSchema,
  repository: RepositoryConfigSchema.omit({ repositoryPath: true }).extend({
    repositoryDisplayName: z.string().min(1),
  }),
  branch: z.string().min(1),
  worktreeId: IdentifierSchema,
  qoderSessionId: QoderUuidSchema.optional(),
  latestCheckpointId: IdentifierSchema.optional(),
  activeQoderTurnId: IdentifierSchema.optional(),
  qoderTurns: z.array(QoderTurnSchema).max(100).optional(),
});

export type RepairState = z.infer<typeof RepairStateSchema>;
export type CommandSpec = z.infer<typeof CommandSpecSchema>;
export type RepositoryConfig = z.infer<typeof RepositoryConfigSchema>;
export type FindingRepairContext = z.infer<
  typeof FindingRepairContextSchema
>;
export type RepairManifest = z.infer<typeof RepairManifestSchema>;
export type QoderModelUsage = z.infer<typeof QoderModelUsageSchema>;
export type QoderTurn = z.infer<typeof QoderTurnSchema>;
export type RepairSession = z.infer<typeof RepairSessionSchema>;
