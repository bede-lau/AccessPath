import { describe, expect, it } from "vitest";

import { PACKAGE_NAME, runAudit } from "../src/index";
import type { TaskContract } from "@accesspath/contracts";

describe("@accesspath/audit-engine", () => {
  it("exports the correct package name", () => {
    expect(PACKAGE_NAME).toBe("@accesspath/audit-engine");
  });

  it("runAudit throws until P04", () => {
    expect(() => runAudit({} as TaskContract)).toThrowError(
      /Not implemented until P0[46]/,
    );
  });
});
