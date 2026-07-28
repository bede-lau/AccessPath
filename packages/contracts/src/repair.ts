import { z } from "zod";
import {
  ArtifactRefSchema,
  HttpUrlSchema,
  IdentifierSchema,
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

// API_CONTRACTS.md L225-240: RepairManifest.
export const RepairManifestSchema = z.object({
  schemaVersion: SchemaVersionSchema,
  id: IdentifierSchema,
  auditBundleId: IdentifierSchema,
  findingIds: z.array(IdentifierSchema),
  affectedActions: z.array(z.string()),
  observations: z.array(z.string()),
  evidenceRefs: z.array(ArtifactRefSchema),
  constraints: z.array(z.string()),
  nonGoals: z.array(z.string()),
  allowedPathGlobs: z.array(RelativePathSchema),
  verification: z.object({
    taskContract: TaskContractSchema,
    commands: z.array(CommandSpecSchema),
  }),
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
  qoderSessionId: IdentifierSchema.optional(),
  latestCheckpointId: IdentifierSchema.optional(),
});

export type RepairState = z.infer<typeof RepairStateSchema>;
export type CommandSpec = z.infer<typeof CommandSpecSchema>;
export type RepositoryConfig = z.infer<typeof RepositoryConfigSchema>;
export type RepairManifest = z.infer<typeof RepairManifestSchema>;
export type RepairSession = z.infer<typeof RepairSessionSchema>;
