import type { AuditBundle, Finding } from "@accesspath/contracts";

export type BarrierMapMode = "journey" | "impact" | "repair" | "compare";

export type BarrierPresentationItem = {
  stepId: string;
  label: string;
  state: "clear" | "barrier" | "selected-repair" | "unverified";
  stateLabel: string;
  findings: Finding[];
};

const SEVERITY_ORDER: Record<Finding["severity"], number> = {
  blocker: 0,
  critical: 1,
  serious: 2,
  moderate: 3,
  minor: 4,
};

export function buildBarrierPresentation(
  bundle: AuditBundle,
  mode: BarrierMapMode,
): BarrierPresentationItem[] {
  const findingsByStep = new Map<string, Finding[]>();
  for (const finding of bundle.findings) {
    const current = findingsByStep.get(finding.stepId) ?? [];
    current.push(finding);
    findingsByStep.set(finding.stepId, current);
  }
  const result = bundle.task.expectedSteps.map((instruction) => {
    const findings = [...(findingsByStep.get(instruction.id) ?? [])].sort(
      (left, right) =>
        SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity] ||
        left.id.localeCompare(right.id),
    );
    const selectedRepair = findings.some((finding) => finding.id === "AP-001");
    return {
      stepId: instruction.id,
      label: instruction.intent,
      state:
        mode === "repair" && selectedRepair
          ? ("selected-repair" as const)
          : mode === "compare"
            ? ("unverified" as const)
            : findings.length > 0
              ? ("barrier" as const)
              : ("clear" as const),
      stateLabel:
        mode === "repair" && selectedRepair
          ? "Selected repair"
          : mode === "compare"
            ? `${findings.length} before · after unverified`
            : findings.length > 0
              ? `${findings.length} observed ${findings.length === 1 ? "barrier" : "barriers"}`
              : "No finding attached",
      findings,
    };
  });
  if (mode === "impact") {
    return result.sort((left, right) => {
      const leftSeverity = left.findings[0]?.severity;
      const rightSeverity = right.findings[0]?.severity;
      return (
        (leftSeverity === undefined ? 99 : SEVERITY_ORDER[leftSeverity]) -
          (rightSeverity === undefined ? 99 : SEVERITY_ORDER[rightSeverity]) ||
        bundle.task.expectedSteps.findIndex((step) => step.id === left.stepId) -
          bundle.task.expectedSteps.findIndex((step) => step.id === right.stepId)
      );
    });
  }
  return result;
}

export function presentationFindingIds(
  presentation: readonly BarrierPresentationItem[],
): string[] {
  return presentation.flatMap((item) => item.findings.map((finding) => finding.id));
}
