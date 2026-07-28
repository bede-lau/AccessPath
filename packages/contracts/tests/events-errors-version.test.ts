import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AccessPathEventSchema,
  AuditSessionSchema,
  ErrorCodeSchema,
  ErrorResponseSchema,
  EventTypeSchema,
  SCHEMA_VERSION,
  accessPathEventSchema,
  parseVersioned,
} from "../src/index";
import {
  accessPathEventFixture,
  auditSessionFixture,
  errorResponseFixture,
} from "./fixtures";

// API_CONTRACTS.md L417-446, copied verbatim.
const DOCUMENTED_EVENT_TYPES = [
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
] as const;

// API_CONTRACTS.md L459-472.
const DOCUMENTED_ERROR_CODES = [
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
] as const;

describe("event envelope", () => {
  it("parses a valid AccessPathEvent fixture", () => {
    expect(AccessPathEventSchema.parse(accessPathEventFixture)).toEqual(
      accessPathEventFixture,
    );
  });

  it("EventType has EXACTLY the 30 documented values", () => {
    expect(EventTypeSchema.options).toHaveLength(30);
    expect([...EventTypeSchema.options].sort()).toEqual(
      [...DOCUMENTED_EVENT_TYPES].sort(),
    );
  });

  it("accepts every documented event type in the envelope", () => {
    for (const type of DOCUMENTED_EVENT_TYPES) {
      expect(
        AccessPathEventSchema.parse({ ...accessPathEventFixture, type }).type,
      ).toBe(type);
    }
  });

  it("rejects an undocumented event type", () => {
    expect(() =>
      AccessPathEventSchema.parse({
        ...accessPathEventFixture,
        type: "session.archived",
      }),
    ).toThrow();
  });

  it("rejects an envelope missing a required field", () => {
    const { sequence: _sequence, ...missing } = accessPathEventFixture;
    expect(() => AccessPathEventSchema.parse(missing)).toThrow();
  });

  it("supports typed payloads via the accessPathEventSchema factory", () => {
    const testStartedEvent = accessPathEventSchema(
      z.object({ commandId: z.string() }),
    );
    const parsed = testStartedEvent.parse(accessPathEventFixture);
    expect(parsed.payload.commandId).toBe("cmd-test");
    expect(() =>
      testStartedEvent.parse({ ...accessPathEventFixture, payload: {} }),
    ).toThrow();
  });

  it("strips additive unknown fields from the envelope", () => {
    const parsed = AccessPathEventSchema.parse({
      ...accessPathEventFixture,
      traceId: "trace-1",
    });
    expect(parsed).toEqual(accessPathEventFixture);
    expect(parsed).not.toHaveProperty("traceId");
  });
});

describe("error response", () => {
  it("parses a valid ErrorResponse fixture", () => {
    expect(ErrorResponseSchema.parse(errorResponseFixture)).toEqual(
      errorResponseFixture,
    );
  });

  it("accepts EXACTLY the 14 documented error codes and rejects others", () => {
    expect(ErrorCodeSchema.options).toHaveLength(14);
    expect([...ErrorCodeSchema.options].sort()).toEqual(
      [...DOCUMENTED_ERROR_CODES].sort(),
    );
    for (const code of DOCUMENTED_ERROR_CODES) {
      const parsed = ErrorResponseSchema.parse({
        error: { ...errorResponseFixture.error, code },
      });
      expect(parsed.error.code).toBe(code);
    }
    expect(() =>
      ErrorResponseSchema.parse({
        error: { ...errorResponseFixture.error, code: "RATE_LIMITED" },
      }),
    ).toThrow();
  });

  it("rejects an ErrorResponse missing correlationId", () => {
    const { correlationId: _correlationId, ...missing } = errorResponseFixture.error;
    expect(() => ErrorResponseSchema.parse({ error: missing })).toThrow();
  });
});

describe("parseVersioned", () => {
  it("accepts schemaVersion 1.0.0", () => {
    expect(SCHEMA_VERSION).toBe("1.0.0");
    expect(parseVersioned(AuditSessionSchema, auditSessionFixture)).toEqual(
      auditSessionFixture,
    );
  });

  it("rejects an unknown major version with a clear error", () => {
    expect(() =>
      parseVersioned(AuditSessionSchema, {
        ...auditSessionFixture,
        schemaVersion: "2.0.0",
      }),
    ).toThrow(/unknown major schema version "2\.0\.0"/i);
  });

  it("rejects data without a string schemaVersion", () => {
    expect(() => parseVersioned(AuditSessionSchema, null)).toThrow(/schemaVersion/);
    expect(() => parseVersioned(AuditSessionSchema, { id: "x" })).toThrow(
      /schemaVersion/,
    );
  });

  it("still ignores additive unknown fields within the supported major version", () => {
    const parsed = parseVersioned(AuditSessionSchema, {
      ...auditSessionFixture,
      addedInMinorVersion: "ok",
    });
    expect(parsed).toEqual(auditSessionFixture);
    expect(parsed).not.toHaveProperty("addedInMinorVersion");
  });

  it("accepts a compatible additive minor version and normalizes it", () => {
    const parsed = parseVersioned(AuditSessionSchema, {
      ...auditSessionFixture,
      schemaVersion: "1.1.0",
      addedInMinorVersion: "ok",
    });
    expect(parsed).toEqual(auditSessionFixture);
  });
});
