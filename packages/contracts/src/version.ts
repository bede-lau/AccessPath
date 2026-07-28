import { z } from "zod";

// API_CONTRACTS.md L11: Current schema version: `1.0.0`.
export const SCHEMA_VERSION = "1.0.0" as const;

export const SchemaVersionSchema = z.literal("1.0.0");

const SUPPORTED_MAJOR_VERSION = SCHEMA_VERSION.split(".")[0];

/**
 * Parses versioned persisted data with major-version gating.
 *
 * API_CONTRACTS.md L13: readers must ignore unknown fields and reject unknown
 * major versions. API_CONTRACTS.md L496: unknown major versions are rejected
 * with a useful error.
 */
export function parseVersioned<Schema extends z.ZodType>(
  schema: Schema,
  data: unknown,
): z.output<Schema> {
  if (typeof data !== "object" || data === null) {
    throw new Error(
      "Cannot read schemaVersion: expected an object with a schemaVersion field.",
    );
  }
  const version = (data as { schemaVersion?: unknown }).schemaVersion;
  if (typeof version !== "string") {
    throw new Error(
      "Cannot read schemaVersion: expected a string schemaVersion field.",
    );
  }
  const major = version.split(".")[0];
  if (major !== SUPPORTED_MAJOR_VERSION) {
    throw new Error(
      `Unknown major schema version "${version}": this reader supports major version ` +
        `${SUPPORTED_MAJOR_VERSION} (current schema version ${SCHEMA_VERSION}).`,
    );
  }
  // Compatible additive versions are read into the current writer shape.
  return schema.parse({ ...data, schemaVersion: SCHEMA_VERSION });
}

export type SchemaVersion = z.infer<typeof SchemaVersionSchema>;
