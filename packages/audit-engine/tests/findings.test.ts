import { describe, expect, it } from "vitest";
import { normalizeFindings } from "../src/index";
import type { BrowserObservation } from "../src/types";

describe("finding normalization", () => {
  it("groups duplicate axe findings by affected human action", () => {
    const base = {
      id: "AXE-b",
      title: "Rule",
      affectedAction: "Complete task step example",
      source: "axe" as const,
      evidenceLabel: "deterministic-check" as const,
      severity: "serious" as const,
      modality: ["other" as const],
      state: "open" as const,
      stepId: "example",
      wcagRefs: [],
      observation: "Observed",
      reproduction: ["Run axe"],
      evidenceIds: ["evidence-b"],
      manualReview: [],
    };
    const findings = normalizeFindings({
      task: {} as never,
      steps: [],
      observations: [],
      axeFindings: [
        base,
        { ...base, id: "AXE-a", evidenceIds: ["evidence-a"] },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.id).toBe("AXE-a");
    expect(findings[0]?.evidenceIds).toEqual(["evidence-a"]);
  });

  it("emits AP-001 through AP-005 deterministically from browser checks", () => {
    const observations: BrowserObservation[] = [
      {
        stepId: "eligibility-choice",
        assisted: true,
        checks: { ap001RoleCount: 0, ap001KeyboardSemantics: false },
        url: "http://127.0.0.1/",
        actionOutcome: "observed",
        axe: { violations: [] },
        consoleMessages: [],
        failedRequests: [],
        evidenceIds: ["evidence-0"],
      },
      {
        stepId: "profile-phone",
        assisted: false,
        checks: { ap002Autocomplete: null },
        url: "http://127.0.0.1/",
        actionOutcome: "observed",
        axe: { violations: [] },
        consoleMessages: [],
        failedRequests: [],
        evidenceIds: ["evidence-1"],
      },
      {
        stepId: "assistance-rent",
        assisted: false,
        checks: { ap003NamedGroup: false },
        url: "http://127.0.0.1/",
        actionOutcome: "observed",
        axe: { violations: [] },
        consoleMessages: [],
        failedRequests: [],
        evidenceIds: ["evidence-2"],
      },
      {
        stepId: "review-invalid",
        assisted: false,
        checks: {
          ap004SummaryVisible: true,
          ap004HasLink: false,
          ap004FocusStayedOnSubmit: true,
        },
        url: "http://127.0.0.1/",
        actionOutcome: "observed",
        axe: { violations: [] },
        consoleMessages: [],
        failedRequests: [],
        evidenceIds: ["evidence-3"],
      },
      {
        stepId: "submission-confirmation",
        assisted: false,
        checks: { ap005Visible: true, ap005LiveSemantics: false },
        url: "http://127.0.0.1/",
        actionOutcome: "observed",
        axe: { violations: [] },
        consoleMessages: [],
        failedRequests: [],
        evidenceIds: ["evidence-4"],
      },
    ];
    expect(
      normalizeFindings({
        task: {} as never,
        steps: [],
        observations,
        axeFindings: [],
      }).map((finding) => finding.id),
    ).toEqual(["AP-001", "AP-002", "AP-003", "AP-004", "AP-005"]);
  });
});
