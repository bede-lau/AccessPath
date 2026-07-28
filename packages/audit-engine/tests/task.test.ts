import { describe, expect, it, vi } from "vitest";
import { evaluateSuccess, executeInstruction } from "../src/index";

describe("task helpers", () => {
  it("evaluates every configured success predicate", async () => {
    const page = {
      url: () => "https://example.test/complete",
      getByText: vi.fn(() => ({
        first: () => ({ isVisible: vi.fn(async () => true) }),
      })),
      locator: vi.fn(() => ({
        first: () => ({ isVisible: vi.fn(async () => true) }),
      })),
    };
    await expect(
      evaluateSuccess(page as never, {
        urlMatches: "/complete$",
        visibleText: "Done",
        selector: "#confirmation",
      }),
    ).resolves.toEqual({ passed: true, failures: [] });
  });

  it("reports all failed success predicates", async () => {
    const page = {
      url: () => "https://example.test/start",
      getByText: vi.fn(() => ({
        first: () => ({ isVisible: vi.fn(async () => false) }),
      })),
      locator: vi.fn(() => ({
        first: () => ({ isVisible: vi.fn(async () => false) }),
      })),
    };
    const result = await evaluateSuccess(page as never, {
      urlMatches: "/complete$",
      visibleText: "Done",
      selector: "#confirmation",
    });
    expect(result.passed).toBe(false);
    expect(result.failures).toHaveLength(3);
  });

  it("uses Space and verifies selection for the keyboard eligibility step", async () => {
    let checked = false;
    const locator = {
      count: vi.fn(async () => 1),
      focus: vi.fn(async () => undefined),
      evaluate: vi.fn(async () => checked),
    };
    const page = {
      getByRole: vi.fn(() => locator),
      keyboard: {
        press: vi.fn(async () => {
          checked = true;
        }),
      },
    };

    await expect(
      executeInstruction(
        page as never,
        {
          id: "eligibility-choice",
          intent: "Choose eligibility with a keyboard",
          action: {
            kind: "click",
            role: "radio",
            name: "Yes, my household needs help",
          },
          checkpoint: true,
        },
        {},
      ),
    ).resolves.toMatch(/with the keyboard/);
    expect(locator.focus).toHaveBeenCalledOnce();
    expect(page.keyboard.press).toHaveBeenCalledWith("Space");
  });
});
