import { z } from "zod";
import {
  HttpUrlSchema,
  IdentifierSchema,
  NonNegativeIntegerSchema,
  UtcTimestampSchema,
} from "./primitives";

// API_CONTRACTS.md L310-316: TestResult (state 4).
export const TestResultSchema = z.object({
  commandId: IdentifierSchema,
  state: z.enum(["passed", "failed", "timed-out", "cancelled"]),
  exitCode: z.number().optional(),
  durationMs: NonNegativeIntegerSchema,
  outputArtifactId: IdentifierSchema,
});

// API_CONTRACTS.md L318-324: FindingComparison (beforeState literal "open", afterState 4).
export const FindingComparisonSchema = z.object({
  findingId: IdentifierSchema,
  beforeState: z.literal("open"),
  afterState: z.enum(["resolved", "remaining", "regressed", "unverified"]),
  explanation: z.string(),
  evidenceIds: z.array(IdentifierSchema),
});

// API_CONTRACTS.md L326-335: VerificationRun.
export const VerificationRunSchema = z.object({
  id: IdentifierSchema,
  repairSessionId: IdentifierSchema,
  startedAt: UtcTimestampSchema,
  completedAt: UtcTimestampSchema.optional(),
  previewUrl: HttpUrlSchema,
  tests: z.array(TestResultSchema),
  auditBundleId: IdentifierSchema.optional(),
  comparison: z.array(FindingComparisonSchema),
});

export type TestResult = z.infer<typeof TestResultSchema>;
export type FindingComparison = z.infer<typeof FindingComparisonSchema>;
export type VerificationRun = z.infer<typeof VerificationRunSchema>;
