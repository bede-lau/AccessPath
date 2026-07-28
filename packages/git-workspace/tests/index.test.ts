import { describe, expect, it } from "vitest";

import { PACKAGE_NAME, prepareWorkspace } from "../src/index";
import type { RepositoryConfig } from "@accesspath/contracts";

describe("@accesspath/git-workspace", () => {
  it("exports the correct package name", () => {
    expect(PACKAGE_NAME).toBe("@accesspath/git-workspace");
  });

  it("prepareWorkspace throws until P06", () => {
    expect(() => prepareWorkspace({} as RepositoryConfig)).toThrowError(
      /Not implemented until P0[46]/,
    );
  });
});
