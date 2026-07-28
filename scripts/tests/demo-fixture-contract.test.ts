import {
  expectedFindingManifest,
  fixtureTaskContract,
} from "../../apps/demo-aid-app/src/fixture-data";
import {
  FindingSchema,
  TaskContractSchema,
} from "../../packages/contracts/src/index";
import { describe, expect, it } from "vitest";

describe("demo fixture contract compatibility", () => {
  it("parses the seeded task with the shared TaskContract schema", () => {
    expect(TaskContractSchema.parse(fixtureTaskContract)).toEqual(
      fixtureTaskContract,
    );
  });

  it("parses every expected finding with the shared Finding schema", () => {
    for (const finding of expectedFindingManifest.findings) {
      const parsed = FindingSchema.parse(finding);
      expect(parsed.id).toBe(finding.id);
      expect(parsed.selector).toBe(finding.hook);
    }
  });
});
