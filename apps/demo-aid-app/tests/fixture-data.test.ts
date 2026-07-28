import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BARRIER_IDS,
  expectedFindingManifest,
  fixtureTaskContract,
} from "../src/fixture-data";

const html = fs.readFileSync(
  fileURLToPath(new URL("../public/index.html", import.meta.url)),
  "utf8",
);

describe("emergency-aid fixture baseline", () => {
  it("declares exactly AP-001 through AP-005 in stable order", () => {
    expect(BARRIER_IDS).toEqual([
      "AP-001",
      "AP-002",
      "AP-003",
      "AP-004",
      "AP-005",
    ]);
    expect(expectedFindingManifest.findings.map((finding) => finding.id)).toEqual(
      BARRIER_IDS,
    );
  });

  it("contains each documented barrier hook exactly once in the page", () => {
    const hooks = [...html.matchAll(/data-barrier-id="(AP-\d{3})"/g)].map(
      (match) => match[1],
    );
    expect(hooks).toEqual(BARRIER_IDS);
  });

  it("keeps AP-001 as an isolated pointer-only custom choice", () => {
    const container = html.match(
      /<div\s+class="eligibility-options"[\s\S]*?data-barrier-id="AP-001"[\s\S]*?>/,
    )?.[0];
    expect(container).toBeDefined();
    expect(container).not.toMatch(/\brole=/);
    expect(container).not.toMatch(/\btabindex=/);
    expect(html).toContain('data-testid="eligibility-yes"');
    expect(html).not.toContain('type="radio"');
  });

  it("keeps AP-002 limited to missing phone autocomplete metadata", () => {
    const barrierIndex = html.indexOf('data-barrier-id="AP-002"');
    const inputStart = html.lastIndexOf("<input", barrierIndex);
    const inputEnd = html.indexOf("/>", barrierIndex);
    const phoneInput = html.slice(inputStart, inputEnd + 2);
    expect(barrierIndex).toBeGreaterThan(-1);
    expect(phoneInput).toBeDefined();
    expect(phoneInput).toContain('type="tel"');
    expect(phoneInput).toContain('aria-describedby="phone-hint"');
    expect(phoneInput).not.toMatch(/\bautocomplete=/);
  });

  it("keeps AP-003 as labeled controls without a labeled group", () => {
    const assistanceContainer = html.match(
      /<div\s+class="check-list"[\s\S]*?data-barrier-id="AP-003"[\s\S]*?>/,
    )?.[0];
    expect(assistanceContainer).toBeDefined();
    expect(assistanceContainer).not.toMatch(/\brole="group"/);
    expect(html).not.toContain("<fieldset");
    expect(html).not.toContain("<legend");
    expect(html.match(/name="assistanceType"/g)).toHaveLength(3);
  });

  it("keeps AP-004 summary unlinked and AP-005 confirmation non-live", () => {
    const errorSummary = html.match(
      /<div\s+class="error-summary"[\s\S]*?data-barrier-id="AP-004"[\s\S]*?<\/div>/,
    )?.[0];
    expect(errorSummary).toBeDefined();
    expect(errorSummary).not.toContain("<a ");
    expect(errorSummary).not.toMatch(/\btabindex=/);

    const confirmationStart = html.match(
      /<section[\s\S]*?data-barrier-id="AP-005"[\s\S]*?>/,
    )?.[0];
    expect(confirmationStart).toBeDefined();
    expect(confirmationStart).not.toMatch(/\brole="status"/);
    expect(confirmationStart).not.toMatch(/\baria-live=/);
  });

  it("ships a deterministic local-explicit task contract for the full path", () => {
    expect(fixtureTaskContract.schemaVersion).toBe("1.0.0");
    expect(fixtureTaskContract.targetPolicy).toBe("local-explicit");
    expect(fixtureTaskContract.startUrl).toBe("http://127.0.0.1:4173/");
    expect(fixtureTaskContract.success).toEqual({
      visibleText: "Test application submitted",
      selector: "[data-testid='submission-confirmation']",
    });
    expect(fixtureTaskContract.fixtureValues).toEqual({
      fullName: "Jordan Example",
      phone: "202-555-0148",
    });
    expect(fixtureTaskContract.expectedSteps.map((step) => step.id)).toEqual([
      "eligibility-choice",
      "eligibility-continue",
      "profile-name",
      "profile-phone",
      "profile-continue",
      "assistance-rent",
      "assistance-continue",
      "review-invalid",
      "review-attestation",
      "review-submit",
      "submission-confirmation",
    ]);
  });
});
