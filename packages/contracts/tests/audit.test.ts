import { describe, expect, it } from "vitest";
import {
  AuditBundleSchema,
  AuditSessionSchema,
  AuditStateSchema,
  FindingSchema,
  StepStateSchema,
  TaskStepResultSchema,
} from "../src/index";
import {
  auditBundleFixture,
  auditSessionFixture,
  findingFixture,
  taskStepResultFixture,
} from "./fixtures";

describe("audit entities", () => {
  it("parses valid fixtures for every audit entity", () => {
    expect(AuditSessionSchema.parse(auditSessionFixture)).toEqual(auditSessionFixture);
    expect(TaskStepResultSchema.parse(taskStepResultFixture)).toEqual(
      taskStepResultFixture,
    );
    expect(FindingSchema.parse(findingFixture)).toEqual(findingFixture);
    expect(AuditBundleSchema.parse(auditBundleFixture)).toEqual(auditBundleFixture);
  });

  it("round-trips AuditBundle (parse output re-parses to itself)", () => {
    const parsed = AuditBundleSchema.parse(auditBundleFixture);
    expect(AuditBundleSchema.parse(parsed)).toEqual(parsed);
  });

  it("strips additive unknown fields from AuditSession", () => {
    const parsed = AuditSessionSchema.parse({
      ...auditSessionFixture,
      newTelemetry: {},
    });
    expect(parsed).toEqual(auditSessionFixture);
    expect(parsed).not.toHaveProperty("newTelemetry");
  });

  it("AuditState matches API_CONTRACTS.md L93-101 exactly", () => {
    expect([...AuditStateSchema.options].sort()).toEqual(
      [
        "draft",
        "ready",
        "running",
        "paused",
        "completed",
        "blocked",
        "failed",
        "cancelled",
      ].sort(),
    );
  });

  it("StepState matches API_CONTRACTS.md L103-110 exactly", () => {
    expect([...StepStateSchema.options].sort()).toEqual(
      ["queued", "running", "passed", "observation", "blocked", "skipped", "failed"].sort(),
    );
  });

  it("rejects invalid audit enum values", () => {
    expect(() =>
      AuditSessionSchema.parse({ ...auditSessionFixture, state: "archived" }),
    ).toThrow();
    expect(() =>
      TaskStepResultSchema.parse({ ...taskStepResultFixture, state: "pending" }),
    ).toThrow();
    expect(() =>
      FindingSchema.parse({ ...findingFixture, source: "lighthouse" }),
    ).toThrow();
    expect(() =>
      FindingSchema.parse({ ...findingFixture, modality: ["auditory"] }),
    ).toThrow();
    expect(() =>
      FindingSchema.parse({ ...findingFixture, state: "closed" }),
    ).toThrow();
    expect(() =>
      AuditBundleSchema.parse({ ...auditBundleFixture, outcome: "partial" }),
    ).toThrow();
    expect(() =>
      AuditBundleSchema.parse({
        ...auditBundleFixture,
        integrity: { algorithm: "md5", manifestHash: "x" },
      }),
    ).toThrow();
  });

  it("rejects audit entities missing required fields", () => {
    const { task: _task, ...sessionMissing } = auditSessionFixture;
    expect(() => AuditSessionSchema.parse(sessionMissing)).toThrow();

    const { evidence: _evidence, ...stepMissing } = taskStepResultFixture;
    expect(() => TaskStepResultSchema.parse(stepMissing)).toThrow();

    const { manualReview: _manualReview, ...findingMissing } = findingFixture;
    expect(() => FindingSchema.parse(findingMissing)).toThrow();

    const { integrity: _integrity, ...bundleMissing } = auditBundleFixture;
    expect(() => AuditBundleSchema.parse(bundleMissing)).toThrow();
  });
});
