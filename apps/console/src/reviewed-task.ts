import {
  TaskContractSchema,
  type TaskContract,
} from "@accesspath/contracts";

export function createReviewedAuditTask(
  startUrl: string,
  targetPolicy: "public" | "local-explicit",
): TaskContract {
  return TaskContractSchema.parse({
    schemaVersion: "1.0.0",
    id: "task-emergency-aid-application",
    title: "Apply for fictional emergency assistance",
    goal:
      "Check eligibility, create an applicant profile, enter assistance details, review the application, and submit a test application.",
    startUrl,
    targetPolicy,
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
    timeoutMs: 60_000,
  });
}
