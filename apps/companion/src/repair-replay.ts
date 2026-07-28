import { readdir } from "node:fs/promises";

import {
  FindingComparisonSchema,
  TaskContractSchema,
  type AuditBundle,
  type FindingComparison,
  type TaskContract,
} from "@accesspath/contracts";
import {
  createAuditDirectoryLayout,
  fileExists,
  loadAuditBundle,
  resolveSafeRelativePath,
} from "@accesspath/evidence";

const PREVIEW_POLL_INTERVAL_MS = 100;
const PREVIEW_READY_TIMEOUT_MS = 15_000;

function isLoopback(hostname: string): boolean {
  return (
    hostname === "127.0.0.1" ||
    hostname === "localhost" ||
    hostname === "[::1]"
  );
}

export function taskForPreview(
  task: TaskContract,
  previewUrl: string,
): TaskContract {
  const target = new URL(previewUrl);
  if (!isLoopback(target.hostname)) {
    throw new Error("Repair previews must use an explicit loopback URL.");
  }
  return TaskContractSchema.parse({
    ...task,
    startUrl: target.href,
    targetPolicy: "local-explicit",
  });
}

export async function loadAuditBundleById(
  artifactRoot: string,
  bundleId: string,
): Promise<AuditBundle> {
  const auditsRoot = resolveSafeRelativePath(artifactRoot, "audits");
  if (!(await fileExists(auditsRoot))) {
    throw new Error("The source audit bundle is unavailable.");
  }
  const entries = await readdir(auditsRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const layout = await createAuditDirectoryLayout(artifactRoot, entry.name);
    if (!(await fileExists(layout.bundlePath))) {
      continue;
    }
    const bundle = await loadAuditBundle(layout);
    if (bundle.id === bundleId) {
      return bundle;
    }
  }
  throw new Error("The source audit bundle is unavailable.");
}

export function compareReplayEvidence(
  before: AuditBundle,
  after: AuditBundle,
  selectedFindingIds: readonly string[],
): FindingComparison[] {
  const selected = new Set(selectedFindingIds);
  const afterById = new Map(
    after.findings.map((finding) => [finding.id, finding]),
  );
  const stepsByInstruction = new Map(
    after.steps.map((step) => [step.instructionId, step]),
  );

  return before.findings
    .map((finding) => {
      const reproduced = afterById.get(finding.id);
      if (reproduced !== undefined) {
        return FindingComparisonSchema.parse({
          findingId: finding.id,
          beforeState: "open",
          afterState:
            reproduced.state === "regressed" ? "regressed" : "remaining",
          explanation:
            "The browser replay reproduced this finding in the persisted after evidence.",
          evidenceIds: reproduced.evidenceIds,
        });
      }

      const replayStep = stepsByInstruction.get(finding.stepId);
      const resolved =
        selected.has(finding.id) &&
        after.outcome === "passed" &&
        replayStep?.state === "passed";
      return FindingComparisonSchema.parse({
        findingId: finding.id,
        beforeState: "open",
        afterState: resolved ? "resolved" : "unverified",
        explanation: resolved
          ? "The original task action passed without test assist and the browser replay did not reproduce this finding."
          : "The persisted after evidence did not conclusively verify this finding.",
        evidenceIds: replayStep?.evidence.map((artifact) => artifact.id) ?? [],
      });
    })
    .sort((left, right) => left.findingId.localeCompare(right.findingId));
}

export async function waitForPreview(
  previewUrl: string,
  signal?: AbortSignal,
): Promise<void> {
  const target = new URL(previewUrl);
  if (!isLoopback(target.hostname)) {
    throw new Error("Repair previews must use an explicit loopback URL.");
  }
  const deadline = Date.now() + PREVIEW_READY_TIMEOUT_MS;
  let lastError: unknown;
  while (Date.now() < deadline) {
    if (signal?.aborted) {
      throw new DOMException("Preview startup was cancelled.", "AbortError");
    }
    try {
      const response = await fetch(target, {
        redirect: "error",
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) {
        return;
      }
      lastError = new Error(`Preview returned HTTP ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) =>
      setTimeout(resolve, PREVIEW_POLL_INTERVAL_MS),
    );
  }
  const detail =
    lastError instanceof Error ? ` ${lastError.message}` : "";
  throw new Error(`Repair preview did not become ready.${detail}`);
}
