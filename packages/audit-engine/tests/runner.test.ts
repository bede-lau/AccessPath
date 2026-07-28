import type { TaskContract } from "@accesspath/contracts";
import { describe, expect, it } from "vitest";
import { runAudit } from "../src/index";

const task: TaskContract = {
  schemaVersion: "1.0.0",
  id: "task-test",
  title: "Test task",
  goal: "Exercise failure handling",
  startUrl: "https://example.test/",
  targetPolicy: "public",
  success: {},
  forbiddenActions: [],
  expectedSteps: [
    {
      id: "only-step",
      intent: "Assert content",
      action: { kind: "assert", text: "Done" },
      checkpoint: true,
    },
  ],
  fixtureValues: {},
  viewport: { width: 800, height: 600 },
  timeoutMs: 1000,
};

describe("audit runner failure bundles", () => {
  it("returns a partial failed bundle when Chromium launch fails", async () => {
    const result = await runAudit(task, {
      dnsResolver: async () => [{ address: "93.184.216.34", family: 4 }],
      chromium: {
        launch: async () => {
          throw new Error("browser unavailable");
        },
      } as never,
    });
    expect(result.bundle.outcome).toBe("failed");
    expect(result.bundle.steps).toEqual([]);
    expect(result.diagnostic).toMatchObject({
      code: "NAVIGATION_FAILED",
      message: "browser unavailable",
    });
    expect(result.bundle.integrity.manifestHash).toMatch(/^[a-f0-9]{64}$/);
  });

  function hangingChromium() {
    let rejectNavigation: ((error: Error) => void) | undefined;
    const page = {
      on: () => page,
      goto: () =>
        new Promise<void>((_resolve, reject) => {
          rejectNavigation = reject;
        }),
    };
    return {
      launch: async () => ({
        version: () => "test",
        newContext: async () => ({
          setDefaultTimeout: () => undefined,
          setDefaultNavigationTimeout: () => undefined,
          route: async () => undefined,
          newPage: async () => page,
          close: async () => undefined,
        }),
        close: async () => {
          rejectNavigation?.(new Error("Browser closed."));
        },
      }),
    };
  }

  it("cancels an active navigation and returns a partial bundle", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10);
    const result = await runAudit(task, {
      signal: controller.signal,
      dnsResolver: async () => [{ address: "93.184.216.34", family: 4 }],
      chromium: hangingChromium() as never,
    });
    expect(result.bundle.outcome).toBe("cancelled");
    expect(result.diagnostic?.code).toBe("CANCELLED");
  });

  it("times out an active navigation and returns a partial bundle", async () => {
    const result = await runAudit(
      { ...task, timeoutMs: 10 },
      {
        dnsResolver: async () => [{ address: "93.184.216.34", family: 4 }],
        chromium: hangingChromium() as never,
      },
    );
    expect(result.bundle.outcome).toBe("failed");
    expect(result.diagnostic?.code).toBe("TIMEOUT");
  });
});
