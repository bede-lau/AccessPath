import { describe, expect, it } from "vitest";
import {
  ApprovalDecisionSchema,
  ApprovalRequestSchema,
  CheckpointSchema,
  FindingComparisonSchema,
  RewindPreviewSchema,
  TestResultSchema,
  ToolRiskSchema,
  VerificationRunSchema,
} from "../src/index";
import {
  approvalDecisionFixture,
  approvalRequestFixture,
  checkpointFixture,
  findingComparisonFixture,
  rewindPreviewFixture,
  testResultFixture,
  verificationRunFixture,
} from "./fixtures";

describe("approval and checkpoint contracts", () => {
  it("parses valid fixtures for every approval entity", () => {
    expect(ApprovalRequestSchema.parse(approvalRequestFixture)).toEqual(
      approvalRequestFixture,
    );
    expect(ApprovalDecisionSchema.parse(approvalDecisionFixture)).toEqual(
      approvalDecisionFixture,
    );
    expect(CheckpointSchema.parse(checkpointFixture)).toEqual(checkpointFixture);
    expect(RewindPreviewSchema.parse(rewindPreviewFixture)).toEqual(
      rewindPreviewFixture,
    );
  });

  it("ToolRisk matches API_CONTRACTS.md L266 exactly", () => {
    expect([...ToolRiskSchema.options].sort()).toEqual(
      ["read", "write", "command", "network", "destructive"].sort(),
    );
  });

  it("rejects invalid approval enum values", () => {
    expect(() =>
      ApprovalRequestSchema.parse({ ...approvalRequestFixture, kind: "merge" }),
    ).toThrow();
    expect(() =>
      ApprovalRequestSchema.parse({ ...approvalRequestFixture, risk: "unknown" }),
    ).toThrow();
    expect(() =>
      ApprovalRequestSchema.parse({ ...approvalRequestFixture, state: "revoked" }),
    ).toThrow();
    expect(() =>
      ApprovalDecisionSchema.parse({ decision: "approve-always" }),
    ).toThrow();
  });

  it("rejects approval entities missing required fields", () => {
    const { consequence: _consequence, ...requestMissing } = approvalRequestFixture;
    expect(() => ApprovalRequestSchema.parse(requestMissing)).toThrow();

    const { gitTreeHash: _hash, ...checkpointMissing } = checkpointFixture;
    expect(() => CheckpointSchema.parse(checkpointMissing)).toThrow();

    const { nonFileSideEffectWarning: _warning, ...previewMissing } =
      rewindPreviewFixture;
    expect(() => RewindPreviewSchema.parse(previewMissing)).toThrow();
  });

  it("strips additive unknown fields from ApprovalRequest", () => {
    const parsed = ApprovalRequestSchema.parse({
      ...approvalRequestFixture,
      expiresAt: "2026-07-28T11:00:00.000Z",
    });
    expect(parsed).toEqual(approvalRequestFixture);
    expect(parsed).not.toHaveProperty("expiresAt");
  });
});

describe("verification contract", () => {
  it("parses valid fixtures for every verification entity", () => {
    expect(TestResultSchema.parse(testResultFixture)).toEqual(testResultFixture);
    expect(FindingComparisonSchema.parse(findingComparisonFixture)).toEqual(
      findingComparisonFixture,
    );
    expect(VerificationRunSchema.parse(verificationRunFixture)).toEqual(
      verificationRunFixture,
    );
  });

  it("round-trips VerificationRun (parse output re-parses to itself)", () => {
    const parsed = VerificationRunSchema.parse(verificationRunFixture);
    expect(VerificationRunSchema.parse(parsed)).toEqual(parsed);
  });

  it("rejects an invalid TestResult state", () => {
    expect(() =>
      TestResultSchema.parse({ ...testResultFixture, state: "flaky" }),
    ).toThrow();
  });

  it("FindingComparison.beforeState only accepts the literal 'open'", () => {
    expect(() =>
      FindingComparisonSchema.parse({
        ...findingComparisonFixture,
        beforeState: "selected",
      }),
    ).toThrow();
  });

  it("rejects an invalid FindingComparison afterState", () => {
    expect(() =>
      FindingComparisonSchema.parse({
        ...findingComparisonFixture,
        afterState: "open",
      }),
    ).toThrow();
  });

  it("rejects verification entities missing required fields", () => {
    const { outputArtifactId: _output, ...testMissing } = testResultFixture;
    expect(() => TestResultSchema.parse(testMissing)).toThrow();

    const { comparison: _comparison, ...runMissing } = verificationRunFixture;
    expect(() => VerificationRunSchema.parse(runMissing)).toThrow();
  });
});
