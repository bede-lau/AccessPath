import type { AddressInfo } from "node:net";
import { AuditBundleSchema, type TaskContract } from "@accesspath/contracts";
import {
  fixtureTaskContract,
  start,
  stop,
} from "../../../apps/demo-aid-app/src/index";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAudit } from "../src/index";

describe("P03 emergency-aid fixture integration", () => {
  let server: Awaited<ReturnType<typeof start>>;
  let startUrl = "";

  beforeAll(async () => {
    server = await start(0);
    const address = server.address() as AddressInfo;
    startUrl = `http://127.0.0.1:${address.port}/`;
  });

  afterAll(async () => {
    await stop(server);
  });

  it("records AP-001 as blocked, uses test assist, and observes AP-002 through AP-005", async () => {
    const task = JSON.parse(
      JSON.stringify({ ...fixtureTaskContract, startUrl }),
    ) as TaskContract;
    const result = await runAudit(task, {
      dnsResolver: async () => [{ address: "127.0.0.1", family: 4 }],
    });

    expect(result.bundle.outcome).toBe("blocked");
    expect(result.bundle.findings.map((finding) => finding.id)).toEqual([
      "AP-001",
      "AP-002",
      "AP-003",
      "AP-004",
      "AP-005",
    ]);
    expect(
      result.bundle.steps.find(
        (step) => step.instructionId === "eligibility-choice",
      ),
    ).toMatchObject({
      state: "blocked",
      observedOutcome: expect.stringContaining("test assist"),
    });
    expect(result.bundle.limitations).toContain(
      "AP-001 required a recorded pointer-only test assist. The unassisted task path remained blocked and was not classified as successful.",
    );
    expect(result.bundle.artifacts.some((item) => item.kind === "screenshot")).toBe(
      true,
    );
    expect(result.bundle.artifacts.some((item) => item.kind === "axe-result")).toBe(
      true,
    );
    expect(result.bundle.environment.axeVersion).toBe("4.12.1");
    expect(() => AuditBundleSchema.parse(result.bundle)).not.toThrow();
  }, 60_000);
});
