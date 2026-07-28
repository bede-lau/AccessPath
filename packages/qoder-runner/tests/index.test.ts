import { describe, expect, it } from "vitest";

import { PACKAGE_NAME, startRepairSession } from "../src/index";
import type { RepairManifest } from "@accesspath/contracts";

describe("@accesspath/qoder-runner", () => {
  it("exports the correct package name", () => {
    expect(PACKAGE_NAME).toBe("@accesspath/qoder-runner");
  });

  it("startRepairSession throws until P06", () => {
    expect(() => startRepairSession({} as RepairManifest)).toThrowError(
      /Not implemented until P0[46]/,
    );
  });
});
