import type { Finding } from "@accesspath/contracts";
import type { BrowserObservation, FindingInput } from "./types";

const fixtureDefinitions: Array<
  Omit<Finding, "evidenceIds"> & {
    matches: (observation: BrowserObservation) => boolean;
  }
> = [
  {
    id: "AP-001",
    title: "Keyboard users cannot choose an eligibility option",
    affectedAction: "Choose an eligibility option",
    source: "task-runner",
    evidenceLabel: "observed",
    severity: "blocker",
    modality: ["keyboard"],
    state: "open",
    stepId: "eligibility-choice",
    selector: "[data-barrier-id='AP-001']",
    wcagRefs: ["2.1.1", "4.1.2"],
    observation:
      "The choices worked with a mouse, but the keyboard could not reach or select either option.",
    deterministicChecks: [
      "No keyboard-operable radio control with an accessible name was available.",
      "The custom choices did not provide the standard keyboard behavior of radio buttons.",
      "AccessPath used a recorded mouse assist to check later steps; the keyboard path remained blocked.",
    ],
    diagnosis:
      "The choices are non-interactive elements with click handlers, so the browser does not treat them as radio buttons.",
    reproduction: [
      "Open the eligibility step.",
      "Press Tab to move through the page, then try Space or Enter on either choice.",
    ],
    remediationGuidance:
      "Replace the custom choices with native radio buttons. If custom controls are required, add the full radio-button name, role, focus, and keyboard behavior.",
    manualReview: [
      "Use only the keyboard to confirm that each option can receive focus and be selected with the standard radio-button keys.",
    ],
    matches: (item) =>
      item.stepId === "eligibility-choice" &&
      item.assisted &&
      (item.checks.ap001RoleCount === 0 ||
        item.checks.ap001KeyboardSemantics === false),
  },
  {
    id: "AP-002",
    title: "The phone field cannot use saved phone details",
    affectedAction: "Enter a phone number",
    source: "task-runner",
    evidenceLabel: "deterministic-check",
    severity: "moderate",
    modality: ["cognitive", "motor"],
    state: "open",
    stepId: "profile-phone",
    selector: "[data-barrier-id='AP-002']",
    wcagRefs: ["1.3.5"],
    observation:
      "The phone field has a clear label, but it does not tell the browser that saved phone details can be used.",
    deterministicChecks: [
      "The Phone number field had no autocomplete value.",
    ],
    diagnosis: "The input is missing autocomplete=\"tel\".",
    reproduction: ["Open applicant details and inspect the Phone number field."],
    remediationGuidance:
      "Add autocomplete=\"tel\" to the Phone number field so browsers and assistive tools can identify its purpose.",
    manualReview: [],
    matches: (item) =>
      item.stepId === "profile-phone" && item.checks.ap002Autocomplete === null,
  },
  {
    id: "AP-003",
    title: "Screen reader users may not hear what the assistance choices are for",
    affectedAction: "Choose a type of assistance",
    source: "task-runner",
    evidenceLabel: "deterministic-check",
    severity: "serious",
    modality: ["screen-reader", "cognitive"],
    state: "open",
    stepId: "assistance-rent",
    selector: "[data-barrier-id='AP-003']",
    wcagRefs: ["1.3.1", "3.3.2"],
    observation:
      "Each checkbox has a name, but the choices are not announced as one related group.",
    deterministicChecks: [
      "The assistance choices were not inside a fieldset with a legend.",
      "No named group connected the choices.",
    ],
    diagnosis:
      "The checkboxes are inside a plain container with no group name.",
    reproduction: [
      "Open the assistance details with a screen reader.",
      "Move into the checkboxes and listen for a name that explains the group.",
    ],
    remediationGuidance:
      "Put the related checkboxes in a fieldset and use a short legend that explains what the choices are for.",
    manualReview: [
      "Confirm a screen reader announces the group name when focus enters the checkbox set.",
    ],
    matches: (item) =>
      item.stepId === "assistance-rent" && item.checks.ap003NamedGroup === false,
  },
  {
    id: "AP-004",
    title: "The error message does not help users reach the problem",
    affectedAction: "Fix an incomplete application",
    source: "task-runner",
    evidenceLabel: "observed",
    severity: "serious",
    modality: ["keyboard", "screen-reader"],
    state: "open",
    stepId: "review-invalid",
    selector: "[data-barrier-id='AP-004']",
    wcagRefs: ["2.4.3", "3.3.1", "3.3.3"],
    observation:
      "After submission failed, focus stayed on the Submit button and the error summary did not link to the unchecked confirmation.",
    deterministicChecks: [
      "The error summary became visible.",
      "The summary contained no link to the invalid field.",
      "Focus remained on the submit button.",
    ],
    diagnosis:
      "The submit handler reveals static summary text without moving focus or linking to the invalid field.",
    reproduction: [
      "Leave the application confirmation unchecked.",
      "Activate Submit application.",
    ],
    remediationGuidance:
      "Move focus to the error summary and link its message to the confirmation that needs attention.",
    manualReview: [
      "Submit the incomplete form with a keyboard and confirm the error summary is announced and leads to the unchecked confirmation.",
    ],
    matches: (item) =>
      item.stepId === "review-invalid" &&
      item.checks.ap004SummaryVisible === true &&
      item.checks.ap004HasLink === false &&
      item.checks.ap004FocusStayedOnSubmit === true,
  },
  {
    id: "AP-005",
    title: "Screen reader users may miss the submission confirmation",
    affectedAction: "Confirm the application was submitted",
    source: "task-runner",
    evidenceLabel: "manual-review-required",
    severity: "serious",
    modality: ["screen-reader"],
    state: "open",
    stepId: "submission-confirmation",
    selector: "[data-barrier-id='AP-005']",
    wcagRefs: ["4.1.3"],
    observation:
      "The confirmation appeared on screen, but a screen reader was not automatically told that it appeared.",
    deterministicChecks: [
      "The submission confirmation was visible.",
      "The confirmation had neither role=status nor aria-live.",
    ],
    diagnosis:
      "The newly revealed confirmation has no status role or live-region setting.",
    reproduction: [
      "Submit the application.",
      "Wait for the confirmation without moving focus.",
    ],
    remediationGuidance:
      "Mark the confirmation as an appropriate status or live region so assistive technology announces it.",
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
