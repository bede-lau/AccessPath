// @accesspath/evidence — artifact capture, hashing, and evidence labeling.
// Stub only; implementation lands in P04.

import type { ArtifactRef } from "@accesspath/contracts";

export const PACKAGE_NAME = "@accesspath/evidence" as const;

export function createArtifactRef(
  input: Omit<ArtifactRef, "id" | "sha256">,
): ArtifactRef {
  void input;
  throw new Error("Not implemented until P04");
}
