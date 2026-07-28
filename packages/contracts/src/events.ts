import { z } from "zod";
import {
  IdentifierSchema,
  NonNegativeIntegerSchema,
  UtcTimestampSchema,
} from "./primitives";
import { SchemaVersionSchema } from "./version";

// API_CONTRACTS.md L414-447: EventType (exactly 30 values, copied verbatim).
export const EventTypeSchema = z.enum([
  "session.created",
  "phase.changed",
  "audit.step.started",
  "audit.step.completed",
  "audit.step.blocked",
  "finding.created",
  "artifact.created",
  "agent.message.delta",
  "agent.message.completed",
  "tool.requested",
  "tool.approved",
  "tool.denied",
  "tool.started",
  "tool.completed",
  "tool.failed",
  "file.changed",
  "diff.updated",
  "test.started",
  "test.output",
  "test.completed",
  "checkpoint.created",
  "rewind.previewed",
  "rewind.completed",
  "verification.started",
  "verification.completed",
  "session.paused",
  "session.resumed",
  "session.completed",
  "session.failed",
  "session.cancelled",
]);

// API_CONTRACTS.md L402-411: AccessPathEvent<T> envelope, generic over payload.
export function accessPathEventSchema<Payload extends z.ZodType>(
  payloadSchema: Payload,
) {
  return z.object({
    schemaVersion: SchemaVersionSchema,
    eventId: IdentifierSchema,
    sessionId: IdentifierSchema,
    sequence: NonNegativeIntegerSchema,
    timestamp: UtcTimestampSchema,
    correlationId: IdentifierSchema.optional(),
    type: EventTypeSchema,
    payload: payloadSchema,
  });
}

// Default envelope with unknown payload (AccessPathEvent<unknown>, L402).
export const AccessPathEventSchema = accessPathEventSchema(z.unknown());

export type EventType = z.infer<typeof EventTypeSchema>;
export type AccessPathEvent<T = unknown> = Omit<
  z.infer<typeof AccessPathEventSchema>,
  "payload"
> & { payload: T };
