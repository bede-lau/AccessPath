import { z } from "zod";

import {
  HttpUrlSchema,
  IdentifierSchema,
  NonNegativeIntegerSchema,
  PositiveIntegerSchema,
  RelativePathSchema,
  SeveritySchema,
  Sha256Schema,
  UtcTimestampSchema,
} from "./primitives";
import { CommandSpecSchema } from "./repair";
import { TaskContractSchema } from "./task";
import { SchemaVersionSchema } from "./version";

const GitCommitSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i);
const BoundedTextSchema = z.string().trim().min(1).max(4_000);
const HttpsUrlSchema = HttpUrlSchema.refine(
  (value) => {
    const parsed = new URL(value);
    return (
      parsed.protocol === "https:" &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.search === "" &&
      parsed.hash === ""
    );
  },
  {
    message:
      "Expected an HTTPS URL without embedded credentials, query, or fragment.",
  },
);

export const ExecutionModeSchema = z.enum([
  "assessment",
  "repair",
  "verify",
]);

export const LocalSourceSpecSchema = z.object({
  kind: z.literal("local"),
  repositoryPath: z.string().trim().min(1),
});

export const PublicSourceSpecSchema = z.object({
  kind: z.literal("public"),
  repositoryUrl: HttpsUrlSchema,
  commit: GitCommitSchema,
});

export const SourceSpecSchema = z.discriminatedUnion("kind", [
  LocalSourceSpecSchema,
  PublicSourceSpecSchema,
]);

export const SourceSnapshotSchema = z.object({
  schemaVersion: SchemaVersionSchema,
  id: IdentifierSchema,
  source: SourceSpecSchema,
  acquiredAt: UtcTimestampSchema,
  repositoryDisplayName: z.string().trim().min(1).max(300),
  sourceCommit: GitCommitSchema,
  snapshotCommit: GitCommitSchema,
  treeHash: GitCommitSchema,
  contentManifestHash: Sha256Schema,
  dirty: z.boolean(),
  fileCount: NonNegativeIntegerSchema,
  payloadBytes: NonNegativeIntegerSchema,
});

export const DeploymentBindingSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("exact"),
    deploymentUrl: HttpUrlSchema,
    sourceCommit: GitCommitSchema,
  }),
  z.object({
    state: z.literal("reproduced"),
    deploymentUrl: HttpUrlSchema,
    sourceCommit: GitCommitSchema,
    reproductionUrl: HttpUrlSchema,
    notes: BoundedTextSchema.optional(),
  }),
  z.object({
    state: z.literal("unverified"),
    deploymentUrl: HttpUrlSchema,
    reason: BoundedTextSchema,
  }),
]);

export const ExecutableStepPlanSchema = z.object({
  id: IdentifierSchema,
  title: z.string().trim().min(1).max(300),
  task: TaskContractSchema,
  dependsOn: z.array(IdentifierSchema).max(64),
  mode: ExecutionModeSchema,
});

export const MissionDraftSchema = z.object({
  schemaVersion: SchemaVersionSchema,
  id: IdentifierSchema,
  title: z.string().trim().min(1).max(300),
  objective: BoundedTextSchema,
  stagingUrl: HttpUrlSchema,
  source: SourceSpecSchema,
  deployment: DeploymentBindingSchema.optional(),
  executionMode: ExecutionModeSchema,
  steps: z.array(ExecutableStepPlanSchema).min(1).max(64),
  constraints: z.array(BoundedTextSchema).max(64),
});

export const MissionIssueSchema = z.object({
  id: IdentifierSchema,
  title: z.string().trim().min(1).max(300),
  severity: SeveritySchema,
  source: z.enum([
    "task",
    "assertion",
    "accessibility",
    "console",
    "network",
  ]),
  summary: BoundedTextSchema,
  stepId: IdentifierSchema.optional(),
  affectedPaths: z.array(RelativePathSchema).max(64),
  evidenceIds: z.array(IdentifierSchema).max(64),
  state: z.enum(["open", "accepted", "repaired", "dismissed", "unverified"]),
});

export const RepairProposalSchema = z.object({
  id: IdentifierSchema,
  missionId: IdentifierSchema,
  issueIds: z.array(IdentifierSchema).min(1).max(64),
  summary: BoundedTextSchema,
  rationale: BoundedTextSchema,
  affectedPaths: z.array(RelativePathSchema).min(1).max(64),
  verificationSteps: z.array(BoundedTextSchema).min(1).max(32),
  createdAt: UtcTimestampSchema,
});

export const SandboxPolicySchema = z.object({
  readPathGlobs: z.array(RelativePathSchema).max(128),
  writePathGlobs: z.array(RelativePathSchema).max(128),
  network: z.enum(["deny", "https-public"]),
  maxFileBytes: PositiveIntegerSchema,
  maxPayloadBytes: PositiveIntegerSchema,
});

export const RepairAuthorizationGrantSchema = z
  .object({
    id: IdentifierSchema,
    missionId: IdentifierSchema,
    proposalId: IdentifierSchema,
    issuedAt: UtcTimestampSchema,
    expiresAt: UtcTimestampSchema.optional(),
    sourceSnapshotId: IdentifierSchema,
    sourceSnapshotHash: Sha256Schema,
    taskHash: Sha256Schema,
    evidenceHashes: z.array(Sha256Schema).max(128),
    approvedIssueIds: z.array(IdentifierSchema).min(1).max(64),
    approvedPaths: z.array(RelativePathSchema).min(1).max(128),
    approvedCommands: z.array(CommandSpecSchema).max(64),
    sandboxPolicy: SandboxPolicySchema,
    state: z.enum([
      "active",
      "consumed",
      "revoked",
      "expired",
      "invalidated",
    ]),
    invalidatedAt: UtcTimestampSchema.optional(),
    invalidationReason: BoundedTextSchema.optional(),
  })
  .superRefine((grant, context) => {
    const hasInvalidatedAt = grant.invalidatedAt !== undefined;
    const hasInvalidationReason = grant.invalidationReason !== undefined;
    if (
      grant.state === "invalidated" &&
      (!hasInvalidatedAt || !hasInvalidationReason)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Invalidated authorization grants require a timestamp and reason.",
        path: ["state"],
      });
    }
    if (
      grant.state !== "invalidated" &&
      (hasInvalidatedAt || hasInvalidationReason)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Invalidation metadata is only valid for invalidated authorization grants.",
        path: ["invalidatedAt"],
      });
    }
  });

export const MissionSessionStateSchema = z.enum([
  "draft",
  "compiling",
  "ready",
  "running-audit",
  "awaiting-repair-authorization",
  "binding-source",
  "repairing",
  "verifying",
  "awaiting-patch-acceptance",
  "attention",
  "report-only",
  "completed",
  "failed",
  "cancelled",
]);

export const MissionSessionSchema = z.object({
  schemaVersion: SchemaVersionSchema,
  id: IdentifierSchema,
  revision: PositiveIntegerSchema,
  state: MissionSessionStateSchema,
  draft: MissionDraftSchema,
  createdAt: UtcTimestampSchema,
  updatedAt: UtcTimestampSchema,
  sourceSnapshotId: IdentifierSchema.optional(),
  activeStepId: IdentifierSchema.optional(),
  activeProposalId: IdentifierSchema.optional(),
  activeAuthorizationGrantId: IdentifierSchema.optional(),
  snapshotIds: z.array(IdentifierSchema).max(1_000),
  issueIds: z.array(IdentifierSchema).max(1_000),
  proposalIds: z.array(IdentifierSchema).max(1_000),
  authorizationGrantIds: z.array(IdentifierSchema).max(1_000),
});

export const MissionSnapshotSchema = z.object({
  schemaVersion: SchemaVersionSchema,
  id: IdentifierSchema,
  missionSessionId: IdentifierSchema,
  revision: PositiveIntegerSchema,
  capturedAt: UtcTimestampSchema,
  state: MissionSessionStateSchema,
  source: SourceSnapshotSchema,
  deployment: DeploymentBindingSchema.optional(),
  issueIds: z.array(IdentifierSchema).max(1_000),
  proposalIds: z.array(IdentifierSchema).max(1_000),
  authorizationGrantIds: z.array(IdentifierSchema).max(1_000),
});

export type ExecutionMode = z.infer<typeof ExecutionModeSchema>;
export type LocalSourceSpec = z.infer<typeof LocalSourceSpecSchema>;
export type PublicSourceSpec = z.infer<typeof PublicSourceSpecSchema>;
export type SourceSpec = z.infer<typeof SourceSpecSchema>;
export type SourceSnapshot = z.infer<typeof SourceSnapshotSchema>;
export type DeploymentBinding = z.infer<typeof DeploymentBindingSchema>;
export type ExecutableStepPlan = z.infer<typeof ExecutableStepPlanSchema>;
export type MissionDraft = z.infer<typeof MissionDraftSchema>;
export type MissionIssue = z.infer<typeof MissionIssueSchema>;
export type RepairProposal = z.infer<typeof RepairProposalSchema>;
export type SandboxPolicy = z.infer<typeof SandboxPolicySchema>;
export type RepairAuthorizationGrant = z.infer<
  typeof RepairAuthorizationGrantSchema
>;
export type MissionSessionState = z.infer<typeof MissionSessionStateSchema>;
export type MissionSession = z.infer<typeof MissionSessionSchema>;
export type MissionSnapshot = z.infer<typeof MissionSnapshotSchema>;
