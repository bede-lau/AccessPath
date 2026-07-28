// @accesspath/git-workspace — isolated repair-branch workspace management.
// Stub only; implementation lands in P06.

import type { RepositoryConfig } from "@accesspath/contracts";

export const PACKAGE_NAME = "@accesspath/git-workspace" as const;

export function prepareWorkspace(config: RepositoryConfig): Promise<never> {
  void config;
  throw new Error("Not implemented until P06");
}
