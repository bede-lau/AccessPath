import { z } from "zod";
import {
  IdentifierSchema,
  NonNegativeIntegerSchema,
  RelativePathSchema,
  UtcTimestampSchema,
} from "./primitives";
import { CommandSpecSchema } from "./repair";

// API_CONTRACTS.md L266: ToolRisk (5 values).
export const ToolRiskSchema = z.enum(["read", "write", "command", "network", "destructive"]);

// API_CONTRACTS.md L268-279: ApprovalRequest (kind 4, state 4).
export const ApprovalRequestSchema = z.object({
  id: IdentifierSchema,
  repairSessionId: IdentifierSchema,
  kind: z.enum(["plan", "tool", "patch", "rewind"]),
  title: z.string(),
  consequence: z.string(),
  risk: ToolRiskSchema,
  targetPaths: z.array(RelativePathSchema),
  command: CommandSpecSchema.optional(),
  createdAt: UtcTimestampSchema,
  state: z.enum(["pending", "approved", "denied", "expired"]),
});

// API_CONTRACTS.md L281-284: ApprovalDecision (3 decisions).
export const ApprovalDecisionSchema = z.object({
  decision: z.enum(["approve-once", "approve-session", "deny"]),
  reason: z.string().optional(),
});

// API_CONTRACTS.md L286-295: Checkpoint.
export const CheckpointSchema = z.object({
  id: IdentifierSchema,
  repairSessionId: IdentifierSchema,
  qoderMessageId: IdentifierSchema.optional(),
  createdAt: UtcTimestampSchema,
  files: z.array(RelativePathSchema),
  insertions: NonNegativeIntegerSchema,
  deletions: NonNegativeIntegerSchema,
  gitTreeHash: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i),
});

// API_CONTRACTS.md L297-304: RewindPreview.
export const RewindPreviewSchema = z.object({
  checkpointId: IdentifierSchema,
  affectedFiles: z.array(RelativePathSchema),
  insertionsRemoved: NonNegativeIntegerSchema,
  deletionsRestored: NonNegativeIntegerSchema,
  staleVerificationIds: z.array(IdentifierSchema),
  nonFileSideEffectWarning: z.string(),
});

export type ToolRisk = z.infer<typeof ToolRiskSchema>;
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;
export type Checkpoint = z.infer<typeof CheckpointSchema>;
export type RewindPreview = z.infer<typeof RewindPreviewSchema>;
