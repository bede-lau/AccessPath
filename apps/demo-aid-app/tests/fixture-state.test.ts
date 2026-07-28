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
  fictionalDataConfirmed: true,
} as const;

describe("InMemoryFixtureStore", () => {
  it("creates deterministic references and returns defensive snapshots", () => {
    const store = new InMemoryFixtureStore("fixture-test");
    const first = store.submit(parseTestSubmission(validSubmission));
    const second = store.submit(parseTestSubmission(validSubmission));

    expect(first.reference).toBe("TEST-0001");
    expect(second.reference).toBe("TEST-0002");
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
      nextReference: "TEST-0001",
    });
  });
});

describe("parseTestSubmission", () => {
  it("requires fictional confirmation and at least one assistance type", () => {
    expect(() =>
      parseTestSubmission({
        ...validSubmission,
        fictionalDataConfirmed: false,
      }),
    ).toThrow(/fictional/i);
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
