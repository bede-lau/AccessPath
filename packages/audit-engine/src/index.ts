// @accesspath/audit-engine — deterministic accessibility audit orchestration.
// Stub only; implementation lands in P04.

import type { AuditSession, TaskContract } from "@accesspath/contracts";

export const PACKAGE_NAME = "@accesspath/audit-engine" as const;

export function runAudit(contract: TaskContract): Promise<AuditSession> {
  void contract;
  throw new Error("Not implemented until P04");
}
