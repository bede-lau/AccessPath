// @accesspath/qoder-runner — Qoder CLI repair session orchestration.
// Stub only; implementation lands in P06.

import type { RepairManifest } from "@accesspath/contracts";

export const PACKAGE_NAME = "@accesspath/qoder-runner" as const;

export function startRepairSession(manifest: RepairManifest): Promise<never> {
  void manifest;
  throw new Error("Not implemented until P06");
}
