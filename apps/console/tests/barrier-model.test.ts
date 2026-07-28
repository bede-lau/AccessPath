import { describe, expect, it } from "vitest";

import {
  buildBarrierPresentation,
  presentationFindingIds,
  type BarrierMapMode,
} from "../src/barrier-model";
import { auditBundle } from "./fixtures";

describe("Barrier Map shared presentation model", () => {
  it("keeps graph and linear representations on the same ordered model", () => {
    const presentation = buildBarrierPresentation(auditBundle, "journey");

    expect(presentation.map((item) => item.stepId)).toEqual(
      auditBundle.task.expectedSteps.map((step) => step.id),
    );
    expect(presentationFindingIds(presentation)).toEqual(
      auditBundle.findings.map((finding) => finding.id),
    );
  });

  it("preserves every finding across all map modes", () => {
    const expectedIds = auditBundle.findings
      .map((finding) => finding.id)
      .sort();
    const modes: BarrierMapMode[] = [
      "journey",
      "impact",
      "repair",
      "compare",
    ];

    for (const mode of modes) {
      expect(
        presentationFindingIds(buildBarrierPresentation(auditBundle, mode)).sort(),
      ).toEqual(expectedIds);
    }
  });

  it("orders impact mode by highest attached severity", () => {
    const presentation = buildBarrierPresentation(auditBundle, "impact");

    expect(presentationFindingIds(presentation).slice(0, 2)).toEqual([
      "AP-001",
      "AP-004",
    ]);
  });

  it("labels selected repair and unverified comparison states in text", () => {
    const repair = buildBarrierPresentation(auditBundle, "repair");
    const compare = buildBarrierPresentation(auditBundle, "compare");

    expect(
      repair.find((item) => item.findings.some(({ id }) => id === "AP-001"))
        ?.stateLabel,
    ).toBe("Selected repair");
    expect(compare.every((item) => item.stateLabel.includes("after unverified"))).toBe(
      true,
    );
  });
});
