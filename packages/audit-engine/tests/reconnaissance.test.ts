import { describe, expect, it } from "vitest";

import { runReconnaissance } from "../src/index";

function fakeChromium() {
  const handlers = new Map<string, (value: never) => void>();
  const page = {
    on: (name: string, handler: (value: never) => void) => {
      handlers.set(name, handler);
      return page;
    },
    goto: async () => {
      handlers.get("console")?.({
        type: () => "warning",
        text: () => "One warning",
      } as never);
    },
    evaluate: async () => ({
      title: "Account settings",
      lang: "en",
      headings: [{ level: 1, text: "Account settings" }],
      landmarks: [{ role: "main", name: "Settings" }],
      controls: [
        {
          tag: "button",
          role: "button",
          name: "Save changes",
          required: false,
          disabled: false,
        },
      ],
      links: [{ name: "Help", href: "https://example.test/help" }],
      formCount: 1,
      unnamedInteractiveCount: 0,
      completionCandidates: ["Save changes"],
    }),
    url: () => "https://example.test/settings",
    close: async () => undefined,
  };
  return {
    launch: async () => ({
      newContext: async () => ({
        setDefaultTimeout: () => undefined,
        setDefaultNavigationTimeout: () => undefined,
        route: async () => undefined,
        newPage: async () => page,
      }),
      close: async () => undefined,
    }),
  };
}

describe("browser reconnaissance", () => {
  it("returns bounded structured page context for mission planning", async () => {
    const result = await runReconnaissance(
      "https://example.test/settings",
      "public",
      {
        dnsResolver: async () => [{ address: "93.184.216.34", family: 4 }],
        chromium: fakeChromium() as never,
      },
    );

    expect(result).toMatchObject({
      startUrl: "https://example.test/settings",
      finalUrl: "https://example.test/settings",
      title: "Account settings",
      formCount: 1,
      unnamedInteractiveCount: 0,
      completionCandidates: ["Save changes"],
      consoleMessages: ["warning: One warning"],
    });
    expect(result.controls[0]).toMatchObject({
      role: "button",
      name: "Save changes",
    });
  });

  it("enforces the same public target restrictions as an audit", async () => {
    await expect(
      runReconnaissance("http://example.test", "public", {
        dnsResolver: async () => [{ address: "93.184.216.34", family: 4 }],
        chromium: fakeChromium() as never,
      }),
    ).rejects.toThrow("Public targets must use HTTPS");
  });
});
