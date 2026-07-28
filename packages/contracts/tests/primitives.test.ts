import { describe, expect, it } from "vitest";
import {
  ArtifactRefSchema,
  EvidenceLabelSchema,
  HttpUrlSchema,
  RelativePathSchema,
  Sha256Schema,
  SeveritySchema,
  UtcTimestampSchema,
} from "../src/index";
import { artifactRefFixture } from "./fixtures";

describe("primitives", () => {
  it("parses a valid ArtifactRef fixture", () => {
    expect(ArtifactRefSchema.parse(artifactRefFixture)).toEqual(artifactRefFixture);
  });

  it("round-trips ArtifactRef (parse output re-parses to itself)", () => {
    const parsed = ArtifactRefSchema.parse(artifactRefFixture);
    expect(ArtifactRefSchema.parse(parsed)).toEqual(parsed);
  });

  it("strips additive unknown fields from ArtifactRef", () => {
    const parsed = ArtifactRefSchema.parse({
      ...artifactRefFixture,
      futureField: "tolerated but stripped",
    });
    expect(parsed).toEqual(artifactRefFixture);
    expect(parsed).not.toHaveProperty("futureField");
  });

  it("rejects an invalid ArtifactRef kind", () => {
    expect(() =>
      ArtifactRefSchema.parse({ ...artifactRefFixture, kind: "video" }),
    ).toThrow();
  });

  it("rejects an invalid ArtifactRef sensitivity", () => {
    expect(() =>
      ArtifactRefSchema.parse({ ...artifactRefFixture, sensitivity: "secret" }),
    ).toThrow();
  });

  it("rejects traversal, absolute paths, and malformed integrity values", () => {
    for (const relativePath of [
      "../../secret.png",
      "artifacts/../secret.png",
      "C:\\Users\\person\\secret.png",
      "/home/person/secret.png",
    ]) {
      expect(() =>
        ArtifactRefSchema.parse({ ...artifactRefFixture, relativePath }),
      ).toThrow();
    }
    expect(() =>
      ArtifactRefSchema.parse({ ...artifactRefFixture, sha256: "not-a-hash" }),
    ).toThrow();
  });

  it("validates shared URL and timestamp primitives", () => {
    expect(HttpUrlSchema.parse("http://127.0.0.1:4173")).toBe(
      "http://127.0.0.1:4173",
    );
    expect(() => HttpUrlSchema.parse("file:///tmp/demo.html")).toThrow();
    expect(UtcTimestampSchema.parse("2026-07-28T09:00:00.000Z")).toBe(
      "2026-07-28T09:00:00.000Z",
    );
    expect(() => UtcTimestampSchema.parse("not-a-date")).toThrow();
    expect(RelativePathSchema.parse("artifacts/report.html")).toBe(
      "artifacts/report.html",
    );
    expect(Sha256Schema.parse("a".repeat(64))).toBe("a".repeat(64));
  });

  it("rejects an ArtifactRef missing a required field", () => {
    const { sha256: _sha256, ...missing } = artifactRefFixture;
    expect(() => ArtifactRefSchema.parse(missing)).toThrow();
  });

  it("EvidenceLabel matches API_CONTRACTS.md L18-25 exactly", () => {
    expect([...EvidenceLabelSchema.options].sort()).toEqual(
      [
        "observed",
        "deterministic-check",
        "inferred",
        "proposed",
        "verified",
        "manual-review-required",
        "unsupported",
      ].sort(),
    );
  });

  it("Severity matches API_CONTRACTS.md L27 exactly", () => {
    expect([...SeveritySchema.options].sort()).toEqual(
      ["blocker", "critical", "serious", "moderate", "minor"].sort(),
    );
  });

  it("rejects an invalid EvidenceLabel and Severity", () => {
    expect(() => EvidenceLabelSchema.parse("guessed")).toThrow();
    expect(() => SeveritySchema.parse("trivial")).toThrow();
  });
});
