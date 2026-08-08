import type {
  EvidenceLabel,
  Finding,
  FindingComparison,
  Severity,
} from "@accesspath/contracts";

import { hashCanonical } from "./canonical";

const SEVERITY_ORDER: Record<Severity, number> = {
  blocker: 0,
  critical: 1,
  serious: 2,
  moderate: 3,
  minor: 4,
};

export type FindingIdentityInput = Pick<
  Finding,
  "source" | "stepId" | "selector" | "ruleId" | "wcagRefs"
> & {
  stableKey?: string;
};

export type BarrierMapFinding = {
  findingId: string;
  title: string;
  severity: Severity;
  evidenceLabel: EvidenceLabel;
  evidenceIds: string[];
};

export type BarrierMapGroup = {
  id: string;
  affectedAction: string;
  stepIds: string[];
  findingIds: string[];
  findings: BarrierMapFinding[];
};

export type LinearFindingGroup = BarrierMapGroup;

function normalizedIdentity(input: FindingIdentityInput) {
  const stableKey = input.stableKey?.trim() || undefined;
  const selector = input.selector?.trim() || undefined;
  const ruleId = input.ruleId?.trim() || undefined;
  const wcagRefs = [...new Set(input.wcagRefs.map((value) => value.trim()))].sort();
  if (
    stableKey === undefined &&
    selector === undefined &&
    ruleId === undefined &&
    wcagRefs.length === 0
  ) {
    throw new Error(
      "Stable finding identity requires a stableKey, selector, ruleId, or WCAG reference.",
    );
  }
  return {
    source: input.source,
    stepId: input.stepId,
    stableKey,
    selector,
    ruleId,
    wcagRefs,
  };
}

export function createStableFindingId(input: FindingIdentityInput): string {
  return `finding:${hashCanonical(normalizedIdentity(input)).slice(0, 32)}`;
}

export function withStableFindingId(
  finding: Omit<Finding, "id"> & { id?: string },
): Finding {
  return { ...finding, id: createStableFindingId(finding) };
}

function compareFindings(left: Finding, right: Finding): number {
  return (
    SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity] ||
    left.title.localeCompare(right.title) ||
    left.id.localeCompare(right.id)
  );
}

function groupId(affectedAction: string): string {
  return `action:${hashCanonical(affectedAction.trim()).slice(0, 24)}`;
}

export function buildBarrierMap(findings: readonly Finding[]): BarrierMapGroup[] {
  const groups = new Map<string, Finding[]>();
  for (const finding of findings) {
    const current = groups.get(finding.affectedAction) ?? [];
    current.push(finding);
    groups.set(finding.affectedAction, current);
  }

  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([affectedAction, entries]) => {
      const sorted = [...entries].sort(compareFindings);
      return {
        id: groupId(affectedAction),
        affectedAction,
        stepIds: [...new Set(sorted.map((finding) => finding.stepId))].sort(),
        findingIds: sorted.map((finding) => finding.id),
        findings: sorted.map((finding) => ({
          findingId: finding.id,
          title: finding.title,
          severity: finding.severity,
          evidenceLabel: finding.evidenceLabel,
          evidenceIds: [...finding.evidenceIds],
        })),
      };
    });
}

export function buildLinearFindingGroups(
  findings: readonly Finding[],
): LinearFindingGroup[] {
  return buildBarrierMap(findings);
}

export function assertEquivalentFindingViews(
  barrierMap: readonly BarrierMapGroup[],
  linear: readonly LinearFindingGroup[],
): void {
  if (hashCanonical(barrierMap) !== hashCanonical(linear)) {
    throw new Error("Structured and linear finding data are not equivalent.");
  }
}

export type ComparisonInput = {
  before: Finding;
  after?: Finding;
  evidenceIds?: string[];
  explanation?: string;
};

export function compareFinding(input: ComparisonInput): FindingComparison {
  const afterState =
    input.after === undefined
      ? "unverified"
      : input.after.state === "resolved"
        ? "resolved"
        : input.after.state === "regressed"
          ? "regressed"
          : input.after.state === "unverified"
            ? "unverified"
            : "remaining";

  const explanation =
    input.explanation ??
    (afterState === "resolved"
      ? "The persisted after evidence classifies the finding as resolved."
      : afterState === "regressed"
        ? "The persisted after evidence records a regression."
        : afterState === "unverified"
          ? "No conclusive persisted after evidence is available."
          : "The finding remains present in the persisted after evidence.");

  return {
    findingId: input.before.id,
    beforeState: "open",
    afterState,
    explanation,
    evidenceIds: input.evidenceIds ?? input.after?.evidenceIds ?? [],
  };
}

export function compareFindingSets(
  before: readonly Finding[],
  after: readonly Finding[],
): FindingComparison[] {
  const afterById = new Map(after.map((finding) => [finding.id, finding]));
  return before
    .map((finding) =>
      compareFinding({ before: finding, after: afterById.get(finding.id) }),
    )
    .sort((left, right) => left.findingId.localeCompare(right.findingId));
}
