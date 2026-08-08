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
  title: "Apply for emergency assistance",
  goal:
    "Check eligibility, create an applicant profile, enter assistance details, review the application, and submit an application.",
  startUrl: "http://127.0.0.1:4173/",
  targetPolicy: "local-explicit",
  success: {
    visibleText: "Application submitted",
    selector: "[data-testid='submission-confirmation']",
  },
  forbiddenActions: [
    "Use only the preloaded applicant details.",
    "Do not leave the reviewed application flow.",
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
      intent: "Enter the applicant name",
      action: { kind: "fill", label: "Full name", valueRef: "fullName" },
      checkpoint: false,
    },
    {
      id: "profile-phone",
      intent: "Enter the phone number",
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
      intent: "Attempt submission before confirming the application details",
      action: {
        kind: "click",
        role: "button",
        name: "Submit application",
      },
      checkpoint: true,
    },
    {
      id: "review-attestation",
      intent: "Confirm that the application information is accurate",
      action: {
        kind: "click",
        role: "checkbox",
        name: "I confirm the information in this application is accurate",
      },
      checkpoint: false,
    },
    {
      id: "review-submit",
      intent: "Submit the application",
      action: {
        kind: "click",
        role: "button",
        name: "Submit application",
      },
      checkpoint: true,
    },
    {
      id: "submission-confirmation",
      intent: "Confirm that the application was submitted",
      action: { kind: "assert", text: "Application submitted" },
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
      title: "Keyboard users cannot choose an eligibility option",
      affectedAction: "Choose an eligibility option",
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
        "The choices worked with a mouse, but the keyboard could not reach or select either option.",
      diagnosis:
        "The choices are non-interactive elements with click handlers, so the browser does not treat them as radio buttons.",
      reproduction: [
        "Open the eligibility step.",
        "Press Tab to move through the page, then try Space or Enter on either choice.",
      ],
      remediationGuidance:
        "Replace the custom choices with native radio buttons. If custom controls are required, add the full radio-button name, role, focus, and keyboard behavior.",
      evidenceIds: [],
      manualReview: [
        "Use only the keyboard to confirm that each option can receive focus and be selected with the standard radio-button keys.",
      ],
      expectedChecks: [
        "No radio-button role",
        "Not reachable with Tab",
        "No Space or Enter behavior",
      ],
      selectedDemoRepair: true,
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
      hook: "[data-barrier-id='AP-002']",
      selector: "[data-barrier-id='AP-002']",
      wcagRefs: ["1.3.5"],
      observation:
        "The phone field has a clear label, but it does not tell the browser that saved phone details can be used.",
      diagnosis: "The input is missing autocomplete=\"tel\".",
      reproduction: ["Open applicant details and inspect the Phone number field."],
      remediationGuidance:
        "Add autocomplete=\"tel\" to the Phone number field so browsers and assistive tools can identify its purpose.",
      evidenceIds: [],
      manualReview: [],
      expectedChecks: ["No saved-phone autocomplete value"],
      selectedDemoRepair: false,
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
      hook: "[data-barrier-id='AP-003']",
      selector: "[data-barrier-id='AP-003']",
      wcagRefs: ["1.3.1", "3.3.2"],
      observation:
        "Each checkbox has a name, but the choices are not announced as one related group.",
      diagnosis:
        "The checkboxes are inside a plain container with no group name.",
      reproduction: [
        "Open the assistance details with a screen reader.",
        "Move into the checkboxes and listen for a name that explains the group.",
      ],
      remediationGuidance:
        "Put the related checkboxes in a fieldset and use a short legend that explains what the choices are for.",
      evidenceIds: [],
      manualReview: [
        "Confirm a screen reader announces the group name when focus enters the checkbox set.",
      ],
      expectedChecks: [
        "No fieldset and legend",
        "No named group for the related choices",
      ],
      selectedDemoRepair: false,
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
      hook: "[data-barrier-id='AP-004']",
      selector: "[data-barrier-id='AP-004']",
      wcagRefs: ["2.4.3", "3.3.1", "3.3.3"],
      observation:
        "After submission failed, focus stayed on the Submit button and the error summary did not link to the unchecked confirmation.",
      diagnosis:
        "The submit handler reveals static summary text without moving focus or linking to the invalid field.",
      reproduction: [
        "Leave the application confirmation unchecked.",
        "Activate Submit application.",
      ],
      remediationGuidance:
        "Move focus to the error summary and link its message to the confirmation that needs attention.",
      evidenceIds: [],
      manualReview: [
        "Submit the incomplete form with a keyboard and confirm the error summary is announced and leads to the unchecked confirmation.",
      ],
      expectedChecks: [
        "Focus stays on the Submit button",
        "Error summary has no link to the problem",
      ],
      selectedDemoRepair: false,
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
      hook: "[data-barrier-id='AP-005']",
      selector: "[data-barrier-id='AP-005']",
      wcagRefs: ["4.1.3"],
      observation:
        "The confirmation appeared on screen, but a screen reader was not automatically told that it appeared.",
      diagnosis:
        "The newly revealed confirmation has no status role or live-region setting.",
      reproduction: [
        "Complete the application with a screen reader.",
        "Submit and wait without manually navigating to the confirmation.",
      ],
      remediationGuidance:
        "Mark the confirmation as an appropriate status or live region so assistive technology announces it.",
      evidenceIds: [],
      manualReview: [
        "Confirm the completed submission is announced without moving focus.",
      ],
      expectedChecks: ["No status role", "No live-region setting"],
      selectedDemoRepair: false,
    },
  ],
} as const;
