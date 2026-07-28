import { z } from "zod";

export const IdentifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

export const UtcTimestampSchema = z.string().datetime({ offset: false });
export const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i);

function isSafeRelativePath(value: string): boolean {
  if (
    value.length === 0 ||
    value.includes("\0") ||
    value.startsWith("/") ||
    value.startsWith("\\") ||
    /^[A-Za-z]:[\\/]/.test(value)
  ) {
    return false;
  }
  if (value === ".") {
    return true;
  }
  return value
    .split(/[\\/]+/)
    .every((segment) => segment !== ".." && segment !== "");
}

export const RelativePathSchema = z.string().refine(isSafeRelativePath, {
  message: "Expected a relative path without traversal segments.",
});

export const HttpUrlSchema = z
  .string()
  .url()
  .refine((value) => /^https?:\/\//i.test(value), {
    message: "Expected an HTTP or HTTPS URL.",
  });

export const PositiveIntegerSchema = z.number().int().positive();
export const NonNegativeIntegerSchema = z.number().int().nonnegative();

// API_CONTRACTS.md L18-25: EvidenceLabel (7 values).
export const EvidenceLabelSchema = z.enum([
  "observed",
  "deterministic-check",
  "inferred",
  "proposed",
  "verified",
  "manual-review-required",
  "unsupported",
]);

// API_CONTRACTS.md L27: Severity (5 values).
export const SeveritySchema = z.enum([
  "blocker",
  "critical",
  "serious",
  "moderate",
  "minor",
]);

// API_CONTRACTS.md L29-45: ArtifactRef (8 kind values, 3 sensitivity values).
export const ArtifactRefSchema = z.object({
  id: IdentifierSchema,
  kind: z.enum([
    "screenshot",
    "accessibility-snapshot",
    "axe-result",
    "console-summary",
    "network-summary",
    "test-output",
    "diff",
    "report",
  ]),
  mimeType: z.string(),
  sha256: Sha256Schema,
  relativePath: RelativePathSchema,
  sensitivity: z.enum(["public", "project", "redacted"]),
  description: z.string(),
});

export type EvidenceLabel = z.infer<typeof EvidenceLabelSchema>;
export type Severity = z.infer<typeof SeveritySchema>;
export type ArtifactRef = z.infer<typeof ArtifactRefSchema>;
