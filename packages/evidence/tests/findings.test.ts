import { describe, expect, it } from "vitest";

import {
  assertEquivalentFindingViews,
  buildBarrierMap,
  buildLinearFindingGroups,
  compareFinding,
  compareFindingSets,
  createStableFindingId,
  withStableFindingId,
} from "../src/index";
import { finding } from "./fixtures";

describe("finding transformations", () => {
  it("creates deterministic IDs independent of array ordering", () => {
    const first = finding({
      id: "ignored",
      wcagRefs: ["4.1.2", "2.1.1", "2.1.1"],
    });
    const second = finding({
      id: "also-ignored",
      wcagRefs: ["2.1.1", "4.1.2"],
    });

    expect(createStableFindingId(first)).toBe(createStableFindingId(second));
    expect(createStableFindingId(first)).toMatch(/^finding:[a-f0-9]{32}$/);
    expect(withStableFindingId(first).id).toBe(createStableFindingId(first));
  });

  it("keeps identity stable when display wording changes", () => {
    expect(createStableFindingId(finding())).toBe(
      createStableFindingId(
        finding({
          title: "Reworded finding title",
          affectedAction: "Reworded affected action",
          observation: "The option has a differently worded observed failure.",
        }),
      ),
    );
  });

  it("changes identity when a stable source anchor changes", () => {
    expect(createStableFindingId(finding())).not.toBe(
      createStableFindingId(finding({ ruleId: "different-rule" })),
    );
  });

  it("requires a stable source anchor for deterministic identity", () => {
    expect(() =>
      createStableFindingId({
        source: "manual",
        stepId: "step-1",
        wcagRefs: [],
      }),
    ).toThrow(/stableKey/);
    expect(
      createStableFindingId({
        source: "manual",
        stepId: "step-1",
        wcagRefs: [],
        stableKey: "manual-review-focus",
      }),
    ).toMatch(/^finding:[a-f0-9]{32}$/);
  });

  it("preserves distinct evidence labels in equivalent map and linear data", () => {
    const findings = [
      finding({
        id: "finding-observed",
        evidenceLabel: "observed",
        evidenceIds: ["artifact-observed"],
      }),
      finding({
        id: "finding-inferred",
        title: "The control may lack native semantics",
        evidenceLabel: "inferred",
        evidenceIds: ["artifact-inferred"],
        severity: "serious",
      }),
      finding({
        id: "finding-manual",
        title: "Focus visibility needs manual review",
        affectedAction: "Review the application",
        evidenceLabel: "manual-review-required",
        severity: "moderate",
        stepId: "step-2",
      }),
    ];

    const map = buildBarrierMap(findings);
    const linear = buildLinearFindingGroups(findings);

    assertEquivalentFindingViews(map, linear);
    expect(linear).toEqual(map);
    expect(map[0]?.findings.map((entry) => entry.evidenceLabel)).toEqual([
      "observed",
      "inferred",
    ]);
    expect(map.flatMap((group) => group.findingIds)).toEqual([
      "finding-observed",
      "finding-inferred",
      "finding-manual",
    ]);
  });

  it("detects non-equivalent graph and linear representations", () => {
    const map = buildBarrierMap([finding()]);
    const linear = buildLinearFindingGroups([
      finding({ id: "finding-other", title: "Different" }),
    ]);
    expect(() => assertEquivalentFindingViews(map, linear)).toThrow(
      /not equivalent/,
    );
  });
});

describe("before and after comparison", () => {
  it.each([
    ["resolved", "resolved"],
    ["remaining", "remaining"],
    ["regressed", "regressed"],
    ["unverified", "unverified"],
  ] as const)("maps after state %s to %s", (state, expected) => {
    expect(
      compareFinding({
        before: finding(),
        after: finding({ state, evidenceIds: ["artifact-after"] }),
      }),
    ).toMatchObject({
      findingId: "finding:fixture",
      beforeState: "open",
      afterState: expected,
      evidenceIds: ["artifact-after"],
    });
  });

  it("marks absent after evidence unverified and sorts comparisons", () => {
    const comparisons = compareFindingSets(
      [finding({ id: "finding-b" }), finding({ id: "finding-a" })],
      [finding({ id: "finding-b", state: "resolved" })],
    );
    expect(comparisons.map((entry) => [entry.findingId, entry.afterState])).toEqual([
      ["finding-a", "unverified"],
      ["finding-b", "resolved"],
    ]);
  });
});
