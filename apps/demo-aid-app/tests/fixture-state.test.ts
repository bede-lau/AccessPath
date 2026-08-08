import { describe, expect, it } from "vitest";
import {
  InMemoryFixtureStore,
  parseTestSubmission,
} from "../src/fixture-state";

const validSubmission = {
  eligibility: "yes",
  fullName: " Jordan Example ",
  phone: " 202-555-0148 ",
  assistanceTypes: ["housing"],
  applicationAccuracyConfirmed: true,
} as const;

describe("InMemoryFixtureStore", () => {
  it("creates deterministic references and returns defensive snapshots", () => {
    const store = new InMemoryFixtureStore("fixture-test");
    const first = store.submit(parseTestSubmission(validSubmission));
    const second = store.submit(parseTestSubmission(validSubmission));

    expect(first.reference).toBe("APP-0001");
    expect(second.reference).toBe("APP-0002");
    expect(first.fullName).toBe("Jordan Example");
    expect(first.phone).toBe("202-555-0148");

    const snapshot = store.snapshot();
    snapshot.submissions[0]?.assistanceTypes.push("mutated");
    expect(store.snapshot().submissions[0]?.assistanceTypes).toEqual(["housing"]);
  });

  it("reset restores the exact empty baseline", () => {
    const store = new InMemoryFixtureStore("fixture-test");
    store.submit(parseTestSubmission(validSubmission));

    expect(store.reset()).toEqual({
      fixtureId: "fixture-test",
      submissions: [],
      nextReference: "APP-0001",
    });
  });
});

describe("parseTestSubmission", () => {
  it("requires application confirmation and at least one assistance type", () => {
    expect(() =>
      parseTestSubmission({
        ...validSubmission,
        applicationAccuracyConfirmed: false,
      }),
    ).toThrow(/confirmation/i);
    expect(() =>
      parseTestSubmission({ ...validSubmission, assistanceTypes: [] }),
    ).toThrow(/assistance type/i);
  });

  it("rejects unsupported eligibility values and blank contact fields", () => {
    expect(() =>
      parseTestSubmission({ ...validSubmission, eligibility: "no" }),
    ).toThrow(/eligibility/i);
    expect(() =>
      parseTestSubmission({ ...validSubmission, fullName: " " }),
    ).toThrow(/full name/i);
    expect(() =>
      parseTestSubmission({ ...validSubmission, phone: "" }),
    ).toThrow(/phone/i);
  });
});
