export const FIXTURE_ID = "emergency-aid-baseline-v1" as const;

export const BARRIER_IDS = [
  "AP-001",
  "AP-002",
  "AP-003",
  "AP-004",
  "AP-005",
] as const;

export const fixtureTaskContract = {
  schemaVersion: "1.0.0",
  id: "task-emergency-aid-application",
  title: "Apply for fictional emergency assistance",
  goal:
    "Check eligibility, create an applicant profile, enter assistance details, review the application, and submit a test application.",
  startUrl: "http://127.0.0.1:4173/",
  targetPolicy: "local-explicit",
  success: {
    visibleText: "Test application submitted",
    selector: "[data-testid='submission-confirmation']",
  },
  forbiddenActions: [
    "Do not enter real personal information.",
    "Do not submit information to a real agency.",
    "Do not make payments or upload identity documents.",
  ],
  expectedSteps: [
    {
      id: "eligibility-choice",
      intent: "Choose that the household needs help with essential costs",
      action: {
        kind: "click",
        role: "radio",
        name: "Yes, my household needs help",
      },
      checkpoint: true,
    },
    {
      id: "eligibility-continue",
      intent: "Continue to the applicant profile",
      action: { kind: "click", role: "button", name: "Continue" },
      checkpoint: false,
    },
    {
      id: "profile-name",
      intent: "Enter the fictional applicant name",
      action: { kind: "fill", label: "Full name", valueRef: "fullName" },
      checkpoint: false,
    },
    {
      id: "profile-phone",
      intent: "Enter the fictional phone number",
      action: { kind: "fill", label: "Phone number", valueRef: "phone" },
      checkpoint: true,
    },
    {
      id: "profile-continue",
      intent: "Continue to assistance details",
      action: { kind: "click", role: "button", name: "Continue" },
      checkpoint: false,
    },
    {
      id: "assistance-rent",
      intent: "Choose rent or temporary housing assistance",
      action: {
        kind: "click",
        role: "checkbox",
        name: "Rent or temporary housing",
      },
      checkpoint: true,
    },
    {
      id: "assistance-continue",
      intent: "Continue to review",
      action: { kind: "click", role: "button", name: "Review application" },
      checkpoint: false,
    },
    {
      id: "review-invalid",
      intent: "Attempt submission before accepting the test-data statement",
      action: {
        kind: "click",
        role: "button",
        name: "Submit test application",
      },
      checkpoint: true,
    },
    {
      id: "review-attestation",
      intent: "Confirm that all information is fictional",
      action: {
        kind: "click",
        role: "checkbox",
        name: "I confirm this application contains fictional test information only",
      },
      checkpoint: false,
    },
    {
      id: "review-submit",
      intent: "Submit the fictional test application",
      action: {
        kind: "click",
        role: "button",
        name: "Submit test application",
      },
      checkpoint: true,
    },
    {
      id: "submission-confirmation",
      intent: "Confirm that the test application was submitted",
      action: { kind: "assert", text: "Test application submitted" },
      checkpoint: true,
    },
  ],
  fixtureValues: {
    fullName: "Jordan Example",
    phone: "202-555-0148",
  },
  viewport: {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
  },
  timeoutMs: 60000,
} as const;

export const expectedFindingManifest = {
  schemaVersion: "1.0.0",
  fixtureId: FIXTURE_ID,
  taskContractId: fixtureTaskContract.id,
  findings: [
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
      hook: "[data-barrier-id='AP-001']",
      selector: "[data-barrier-id='AP-001']",
      wcagRefs: ["2.1.1", "4.1.2"],
      observation:
        "The custom eligibility options respond to pointer clicks but expose no keyboard-operable control.",
      diagnosis:
        "The custom options are non-interactive div elements with pointer click handlers only.",
      reproduction: [
        "Load the fixture and move focus through the eligibility step using Tab.",
        "Attempt to select either eligibility option using Space or Enter.",
      ],
      remediationGuidance:
        "Use native radio inputs or add complete radio semantics and keyboard behavior.",
      evidenceIds: [],
      manualReview: [
        "Confirm the repaired option can be selected with standard keyboard commands.",
      ],
      expectedChecks: ["No radio role", "No tabindex", "No keyboard handler"],
      selectedDemoRepair: true,
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
      hook: "[data-barrier-id='AP-002']",
      selector: "[data-barrier-id='AP-002']",
      wcagRefs: ["1.3.5"],
      observation:
        "The phone input has a useful label and input type but no autocomplete attribute.",
      diagnosis: "The telephone input omits autocomplete=\"tel\".",
      reproduction: ["Inspect the Phone number input on the applicant profile step."],
      remediationGuidance:
        "Add the appropriate telephone autocomplete token without changing the field label.",
      evidenceIds: [],
      manualReview: [],
      expectedChecks: ["autocomplete attribute absent"],
      selectedDemoRepair: false,
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
      hook: "[data-barrier-id='AP-003']",
      selector: "[data-barrier-id='AP-003']",
      wcagRefs: ["1.3.1", "3.3.2"],
      observation:
        "Each checkbox has a label, but the related controls are not contained in a labeled group.",
      diagnosis:
        "The related checkboxes are presented in an unlabeled div instead of a fieldset and legend.",
      reproduction: [
        "Navigate to assistance details with a screen reader.",
        "Move between the assistance checkboxes and listen for group context.",
      ],
      remediationGuidance:
        "Wrap the related choices in a fieldset with a concise legend.",
      evidenceIds: [],
      manualReview: [
        "Confirm the group name is announced when entering the checkbox set.",
      ],
      expectedChecks: ["No fieldset and legend", "No role=group with accessible name"],
      selectedDemoRepair: false,
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
      hook: "[data-barrier-id='AP-004']",
      selector: "[data-barrier-id='AP-004']",
      wcagRefs: ["2.4.3", "3.3.1", "3.3.3"],
      observation:
        "The error summary is displayed without moving focus and contains no link to the invalid field.",
      diagnosis:
        "The submit handler reveals static summary text but leaves focus on the submit button.",
      reproduction: [
        "Leave the fictional-data confirmation unchecked.",
        "Activate Submit test application.",
      ],
      remediationGuidance:
        "Focus the summary and link its error item to the invalid confirmation control.",
      evidenceIds: [],
      manualReview: [
        "Confirm focus order remains logical after following the summary link.",
      ],
      expectedChecks: ["Focus remains on submit button", "Summary has no field link"],
      selectedDemoRepair: false,
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
      hook: "[data-barrier-id='AP-005']",
      selector: "[data-barrier-id='AP-005']",
      wcagRefs: ["4.1.3"],
      observation:
        "The confirmation appears visually but is not exposed through a status or live region.",
      diagnosis:
        "The newly revealed confirmation section has no status role or live-region semantics.",
      reproduction: [
        "Complete the fictional application with a screen reader.",
        "Submit and wait without manually navigating to the confirmation.",
      ],
      remediationGuidance:
        "Expose the confirmation through an appropriate status or live region.",
      evidenceIds: [],
      manualReview: [
        "Confirm the completed submission is announced without moving focus.",
      ],
      expectedChecks: ["No role=status", "No aria-live"],
      selectedDemoRepair: false,
    },
  ],
} as const;
