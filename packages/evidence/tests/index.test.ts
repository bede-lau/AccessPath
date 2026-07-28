import { describe, expect, it } from "vitest";

import { PACKAGE_NAME, createArtifactRef } from "../src/index";
import type { ArtifactRef } from "@accesspath/contracts";

describe("@accesspath/evidence", () => {
  it("exports the correct package name", () => {
    expect(PACKAGE_NAME).toBe("@accesspath/evidence");
  });

  it("createArtifactRef throws until P04", () => {
    expect(() =>
      createArtifactRef({} as Omit<ArtifactRef, "id" | "sha256">),
    ).toThrowError(/Not implemented until P0[46]/);
  });
});
