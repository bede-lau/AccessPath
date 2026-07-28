import type http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  BARRIER_IDS,
  expectedFindingManifest,
  FIXTURE_ID,
  fixtureTaskContract,
} from "../src/fixture-data";
import { start, stop } from "../src/server";

describe("demo-aid-app server", () => {
  let server: http.Server | undefined;

  afterEach(async () => {
    if (server) {
      await stop(server);
      server = undefined;
    }
  });

  function baseUrl(instance: http.Server): string {
    const { port } = instance.address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  }

  it("serves the complete fictional emergency-aid application", async () => {
    server = await start(0);
    const response = await fetch(`${baseUrl(server)}/`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
    const html = await response.text();
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('id="application"');
    expect(html).toContain("Check eligibility");
    expect(html).toContain("Create applicant profile");
    expect(html).toContain("Enter assistance details");
    expect(html).toContain("Review your test application");
    expect(html).toContain("Test application submitted");
    expect(html).toContain("Demonstration only.");
  });

  it("serves JavaScript and CSS assets with stable content types", async () => {
    server = await start(0);
    const [script, styles] = await Promise.all([
      fetch(`${baseUrl(server)}/app.js`),
      fetch(`${baseUrl(server)}/styles.css`),
    ]);

    expect(script.status).toBe(200);
    expect(script.headers.get("content-type")).toBe(
      "text/javascript; charset=utf-8",
    );
    expect(await script.text()).toContain("AP-001 is intentional");

    expect(styles.status).toBe(200);
    expect(styles.headers.get("content-type")).toBe("text/css; charset=utf-8");
    expect(await styles.text()).toContain("@media (forced-colors: active)");
  });

  it("returns deterministic fixture metadata from health", async () => {
    server = await start(0);
    const response = await fetch(`${baseUrl(server)}/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      fixtureId: FIXTURE_ID,
      barrierIds: BARRIER_IDS,
      submissionCount: 0,
    });
  });

  it("exposes the seeded task contract and expected finding manifest", async () => {
    server = await start(0);
    const [taskResponse, findingsResponse] = await Promise.all([
      fetch(`${baseUrl(server)}/fixture/task-contract.json`),
      fetch(`${baseUrl(server)}/fixture/expected-findings.json`),
    ]);

    expect(taskResponse.status).toBe(200);
    expect(await taskResponse.json()).toEqual(fixtureTaskContract);
    expect(findingsResponse.status).toBe(200);
    expect(await findingsResponse.json()).toEqual(expectedFindingManifest);
  });

  it("stores fictional submissions in memory and resets deterministically", async () => {
    server = await start(0);
    const url = baseUrl(server);
    const submission = {
      eligibility: "yes",
      fullName: "Jordan Example",
      phone: "202-555-0148",
      assistanceTypes: ["housing"],
      fictionalDataConfirmed: true,
    };

    const firstResponse = await fetch(`${url}/api/test-submissions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(submission),
    });
    const secondResponse = await fetch(`${url}/api/test-submissions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(submission),
    });

    expect(firstResponse.status).toBe(201);
    expect(await firstResponse.json()).toMatchObject({ reference: "TEST-0001" });
    expect(await secondResponse.json()).toMatchObject({ reference: "TEST-0002" });

    const populatedState = await fetch(`${url}/__fixture/state`).then((response) =>
      response.json(),
    );
    expect(populatedState.submissions).toHaveLength(2);
    expect(populatedState.nextReference).toBe("TEST-0003");

    const resetResponse = await fetch(`${url}/__fixture/reset`, {
      method: "POST",
    });
    expect(resetResponse.status).toBe(200);
    expect(await resetResponse.json()).toMatchObject({
      status: "reset",
      state: {
        fixtureId: FIXTURE_ID,
        submissions: [],
        nextReference: "TEST-0001",
      },
    });
  });

  it("rejects malformed or non-fictional submission input", async () => {
    server = await start(0);
    const response = await fetch(`${baseUrl(server)}/api/test-submissions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        eligibility: "yes",
        fullName: "Jordan Example",
        phone: "202-555-0148",
        assistanceTypes: ["housing"],
        fictionalDataConfirmed: false,
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "invalid_test_submission",
    });
  });

  it("returns 404 for unknown routes and stops cleanly", async () => {
    server = await start(0);
    const response = await fetch(`${baseUrl(server)}/nope`);
    expect(response.status).toBe(404);

    await stop(server);
    server = undefined;
  });
});
