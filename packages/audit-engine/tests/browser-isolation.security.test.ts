import type { TaskContract } from "@accesspath/contracts";
import { describe, expect, it } from "vitest";
import { runAudit } from "../src/index";

const task: TaskContract = {
  schemaVersion: "1.0.0",
  id: "task-browser-isolation",
  title: "Browser isolation",
  goal: "Verify a restricted fresh context",
  startUrl: "https://example.test/",
  targetPolicy: "public",
  success: { visibleText: "Done" },
  forbiddenActions: [],
  expectedSteps: [
    {
      id: "done",
      intent: "Observe completion",
      action: { kind: "assert", text: "Done" },
      checkpoint: false,
    },
  ],
  fixtureValues: {},
  viewport: { width: 800, height: 600 },
  timeoutMs: 5000,
};

describe("security: browser isolation", () => {
  it("launches a fresh browser/context per run with restricted capabilities", async () => {
    const contextOptions: Array<Record<string, unknown>> = [];
    let launches = 0;
    let browserCloses = 0;
    let contextCloses = 0;

    const page = {
      on: () => page,
      goto: async () => undefined,
      url: () => task.startUrl,
      title: async () => "Fixture",
      getByText: () => ({
        first: () => ({ isVisible: async () => true }),
      }),
      locator: () => ({
        first: () => ({ isVisible: async () => true }),
      }),
      keyboard: { press: async () => undefined },
    };
    const chromium = {
      launch: async () => {
        launches += 1;
        return {
          version: () => "test",
          newContext: async (options: Record<string, unknown>) => {
            contextOptions.push(options);
            return {
              setDefaultTimeout: () => undefined,
              setDefaultNavigationTimeout: () => undefined,
              route: async () => undefined,
              newPage: async () => page,
              close: async () => {
                contextCloses += 1;
              },
            };
          },
          close: async () => {
            browserCloses += 1;
          },
        };
      },
    };

    const options = {
      chromium: chromium as never,
      dnsResolver: async () => [{ address: "93.184.216.34", family: 4 as const }],
    };
    await runAudit(task, options);
    await runAudit(task, options);

    expect(launches).toBe(2);
    expect(contextCloses).toBe(2);
    expect(browserCloses).toBe(2);
    expect(contextOptions).toEqual([
      expect.objectContaining({
        acceptDownloads: false,
        serviceWorkers: "block",
        permissions: [],
      }),
      expect.objectContaining({
        acceptDownloads: false,
        serviceWorkers: "block",
        permissions: [],
      }),
    ]);
  });
});
