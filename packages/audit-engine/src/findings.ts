import type { Finding } from "@accesspath/contracts";
import type { BrowserObservation, FindingInput } from "./types";

const fixtureDefinitions: Array<
  Omit<Finding, "evidenceIds"> & {
    matches: (observation: BrowserObservation) => boolean;
  }
> = [
  {
    id: "AP-001",
    title: "Eligibility choice cannot be selected with a keyboard",
    affectedAction: "Choose an eligibility option with a keyboard",
    source: "task-runner",
    evidenceLabel: "observed",
    severity: "blocker",
    modality: ["keyboard"],
    state: "open",
    stepId: "eligibility-choice",
    selector: "[data-barrier-id='AP-001']",
    wcagRefs: ["2.1.1", "4.1.2"],
    observation:
      "The reviewed radio action has no role/name target and the custom options expose no keyboard semantics.",
    deterministicChecks: [
      "No keyboard-operable radio role and accessible name were available.",
      "The custom choice exposed no complete radio keyboard semantics.",
      "A recorded pointer-only test assist was required to continue.",
    ],
    diagnosis:
      "The custom options are non-interactive elements with pointer handlers only.",
    reproduction: [
      "Load the eligibility step.",
      "Attempt the reviewed radio action using keyboard-operable semantics.",
    ],
    remediationGuidance:
      "Use native radio inputs or implement complete radio semantics and keyboard behavior.",
    manualReview: [
      "Confirm the repaired choice supports standard radio keyboard interaction.",
    ],
    matches: (item) =>
      item.stepId === "eligibility-choice" &&
      item.assisted &&
      (item.checks.ap001RoleCount === 0 ||
        item.checks.ap001KeyboardSemantics === false),
  },
  {
    id: "AP-002",
    title: "Phone field omits telephone autocomplete metadata",
    affectedAction: "Enter a phone number efficiently",
    source: "task-runner",
    evidenceLabel: "deterministic-check",
    severity: "moderate",
    modality: ["cognitive", "motor"],
    state: "open",
    stepId: "profile-phone",
    selector: "[data-barrier-id='AP-002']",
    wcagRefs: ["1.3.5"],
    observation:
      "The telephone input has no autocomplete attribute in the observed browser DOM.",
    deterministicChecks: [
      "The Phone number input returned no autocomplete attribute.",
    ],
    diagnosis: "The telephone input omits autocomplete=\"tel\".",
    reproduction: ["Inspect the Phone number input on the applicant profile step."],
    remediationGuidance: "Add autocomplete=\"tel\" to the telephone input.",
    manualReview: [],
    matches: (item) =>
      item.stepId === "profile-phone" && item.checks.ap002Autocomplete === null,
  },
  {
    id: "AP-003",
    title: "Assistance choices lack a programmatic group label",
    affectedAction: "Understand assistance type choices",
    source: "task-runner",
    evidenceLabel: "deterministic-check",
    severity: "serious",
    modality: ["screen-reader", "cognitive"],
    state: "open",
    stepId: "assistance-rent",
    selector: "[data-barrier-id='AP-003']",
    wcagRefs: ["1.3.1", "3.3.2"],
    observation:
      "The related checkboxes are not contained in a fieldset or named group.",
    deterministicChecks: [
      "No fieldset and legend contained the assistance choices.",
      "No named role=group contained the assistance choices.",
    ],
    diagnosis:
      "The related checkboxes are presented in an unlabeled container.",
    reproduction: ["Navigate between the assistance choices and inspect group context."],
    remediationGuidance:
      "Wrap the related choices in a fieldset with a concise legend.",
    manualReview: [
      "Confirm a screen reader announces the group name when entering the choices.",
    ],
    matches: (item) =>
      item.stepId === "assistance-rent" && item.checks.ap003NamedGroup === false,
  },
  {
    id: "AP-004",
    title: "Review error summary does not support efficient recovery",
    affectedAction: "Recover from invalid review data",
    source: "task-runner",
    evidenceLabel: "observed",
    severity: "serious",
    modality: ["keyboard", "screen-reader"],
    state: "open",
    stepId: "review-invalid",
    selector: "[data-barrier-id='AP-004']",
    wcagRefs: ["2.4.3", "3.3.1", "3.3.3"],
    observation:
      "The error summary became visible without focus moving to it and without a field link.",
    deterministicChecks: [
      "The error summary became visible.",
      "The summary contained no link to the invalid field.",
      "Focus remained on the submit button.",
    ],
    diagnosis:
      "The submit handler reveals static summary text without focus management or field links.",
    reproduction: [
      "Leave the fictional-data confirmation unchecked.",
      "Activate Submit test application.",
    ],
    remediationGuidance:
      "Focus the summary and link its error item to the invalid confirmation control.",
    manualReview: ["Confirm focus order remains logical after error recovery."],
    matches: (item) =>
      item.stepId === "review-invalid" &&
      item.checks.ap004SummaryVisible === true &&
      item.checks.ap004HasLink === false &&
      item.checks.ap004FocusStayedOnSubmit === true,
  },
  {
    id: "AP-005",
    title: "Submission confirmation is not announced as a status",
    affectedAction: "Know the test application was submitted",
    source: "task-runner",
    evidenceLabel: "manual-review-required",
    severity: "serious",
    modality: ["screen-reader"],
    state: "open",
    stepId: "submission-confirmation",
    selector: "[data-barrier-id='AP-005']",
    wcagRefs: ["4.1.3"],
    observation:
      "The visible submission confirmation has neither status semantics nor a live region.",
    deterministicChecks: [
      "The submission confirmation was visible.",
      "The confirmation had neither role=status nor aria-live.",
    ],
    diagnosis:
      "The newly revealed confirmation has no status or live-region semantics.",
    reproduction: [
      "Submit the fictional application.",
      "Wait for the confirmation without moving focus.",
    ],
    remediationGuidance:
      "Expose the confirmation through an appropriate status or live region.",
    manualReview: [
      "Confirm the completed submission is announced without moving focus.",
    ],
    matches: (item) =>
      item.stepId === "submission-confirmation" &&
      item.checks.ap005Visible === true &&
      item.checks.ap005LiveSemantics === false,
  },
];

function fixtureFindings(observations: BrowserObservation[]): Finding[] {
  return fixtureDefinitions.flatMap(({ matches, ...finding }) => {
    const matching = observations.find(matches);
    return matching
      ? [{ ...finding, evidenceIds: [...matching.evidenceIds] }]
      : [];
  });
}

export function normalizeFindings(input: FindingInput): Finding[] {
  const grouped = new Map<string, Finding>();
  for (const finding of [
    ...fixtureFindings(input.observations),
    ...input.axeFindings,
  ]) {
    const key = finding.affectedAction;
    const current = grouped.get(key);
    if (!current || finding.id.localeCompare(current.id) < 0) {
      grouped.set(key, finding);
    } else {
      current.evidenceIds = [
        ...new Set([...current.evidenceIds, ...finding.evidenceIds]),
      ];
    }
  }
  return [...grouped.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
}
