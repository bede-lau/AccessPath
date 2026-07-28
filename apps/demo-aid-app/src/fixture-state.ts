export interface TestSubmissionInput {
  eligibility: "yes" | "not-sure";
  fullName: string;
  phone: string;
  assistanceTypes: string[];
  fictionalDataConfirmed: true;
}

export interface StoredTestSubmission extends TestSubmissionInput {
  reference: string;
}

export interface FixtureState {
  fixtureId: string;
  submissions: StoredTestSubmission[];
  nextReference: string;
}

export class InMemoryFixtureStore {
  readonly #fixtureId: string;
  #submissions: StoredTestSubmission[] = [];

  constructor(fixtureId: string) {
    this.#fixtureId = fixtureId;
  }

  reset(): FixtureState {
    this.#submissions = [];
    return this.snapshot();
  }

  submit(input: TestSubmissionInput): StoredTestSubmission {
    const reference = `TEST-${String(this.#submissions.length + 1).padStart(4, "0")}`;
    const submission = {
      ...input,
      assistanceTypes: [...input.assistanceTypes],
      reference,
    };
    this.#submissions.push(submission);
    return {
      ...submission,
      assistanceTypes: [...submission.assistanceTypes],
    };
  }

  snapshot(): FixtureState {
    return {
      fixtureId: this.#fixtureId,
      submissions: this.#submissions.map((submission) => ({
        ...submission,
        assistanceTypes: [...submission.assistanceTypes],
      })),
      nextReference: `TEST-${String(this.#submissions.length + 1).padStart(4, "0")}`,
    };
  }
}

export function parseTestSubmission(value: unknown): TestSubmissionInput {
  if (typeof value !== "object" || value === null) {
    throw new Error("Submission must be a JSON object.");
  }

  const input = value as Record<string, unknown>;
  if (input.eligibility !== "yes" && input.eligibility !== "not-sure") {
    throw new Error("Eligibility must use a supported fictional fixture value.");
  }
  if (typeof input.fullName !== "string" || input.fullName.trim() === "") {
    throw new Error("Full name is required.");
  }
  if (typeof input.phone !== "string" || input.phone.trim() === "") {
    throw new Error("Phone number is required.");
  }
  if (
    !Array.isArray(input.assistanceTypes) ||
    input.assistanceTypes.length === 0 ||
    input.assistanceTypes.some((item) => typeof item !== "string")
  ) {
    throw new Error("At least one assistance type is required.");
  }
  if (input.fictionalDataConfirmed !== true) {
    throw new Error("Fictional test-data confirmation is required.");
  }

  return {
    eligibility: input.eligibility,
    fullName: input.fullName.trim(),
    phone: input.phone.trim(),
    assistanceTypes: [...input.assistanceTypes],
    fictionalDataConfirmed: true,
  };
}
