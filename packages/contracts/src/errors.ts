import { z } from "zod";

// API_CONTRACTS.md L459-472: error code (exactly 14 values).
export const ErrorCodeSchema = z.enum([
  "INVALID_INPUT",
  "INVALID_TARGET",
  "TARGET_POLICY_DENIED",
  "REPOSITORY_INVALID",
  "REPOSITORY_DIRTY",
  "PATH_ESCAPE",
  "QODER_AUTH_REQUIRED",
  "QODER_PERMISSION_DENIED",
  "COMMAND_DENIED",
  "CONFLICT",
  "TIMEOUT",
  "NOT_FOUND",
  "INVALID_STATE",
  "INTERNAL",
]);

// API_CONTRACTS.md L456-478: ErrorResponse.
export const ErrorResponseSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    nextAction: z.string().optional(),
    correlationId: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
