import type { Page } from "playwright";
import type { TaskContract, TaskInstruction } from "@accesspath/contracts";

export function describeAction(action: TaskInstruction["action"]): string {
  switch (action.kind) {
    case "click":
      return `click ${action.role} "${action.name}"`;
    case "fill":
      return `fill "${action.label}" from ${action.valueRef}`;
    case "select":
      return `select "${action.option}" in "${action.label}"`;
    case "press":
      return `press ${action.key}`;
    case "assert":
      return `assert text "${action.text}"`;
  }
}

export async function executeInstruction(
  page: Page,
  instruction: TaskInstruction,
  fixtureValues: Record<string, string>,
): Promise<string> {
  const action = instruction.action;
  switch (action.kind) {
    case "click": {
      const locator = page.getByRole(action.role as never, {
        name: action.name,
        exact: false,
      });
      if ((await locator.count()) !== 1) {
        throw new Error(
          `Expected one ${action.role} named "${action.name}", found ${await locator.count()}.`,
        );
      }
      if (instruction.id === "eligibility-choice") {
        await locator.focus();
        await page.keyboard.press("Space");
        const selected = await locator.evaluate((element) => {
          if (element instanceof HTMLInputElement) {
            return element.checked;
          }
          return element.getAttribute("aria-checked") === "true";
        });
        if (!selected) {
          throw new Error(
            `The ${action.role} named "${action.name}" did not become selected with Space.`,
          );
        }
        return `Selected ${action.role} "${action.name}" with the keyboard.`;
      }
      await locator.click();
      return `Activated ${action.role} "${action.name}".`;
    }
    case "fill": {
      const value = fixtureValues[action.valueRef];
      if (value === undefined) {
        throw new Error(`Fixture value "${action.valueRef}" is not defined.`);
      }
      const locator = page.getByLabel(action.label, { exact: true });
      if ((await locator.count()) !== 1) {
        throw new Error(`Expected one field labelled "${action.label}".`);
      }
      await locator.fill(value);
      return `Filled "${action.label}" with a fixture value.`;
    }
    case "select": {
      const locator = page.getByLabel(action.label, { exact: true });
      if ((await locator.count()) !== 1) {
        throw new Error(`Expected one select labelled "${action.label}".`);
      }
      await locator.selectOption({ label: action.option });
      return `Selected "${action.option}" in "${action.label}".`;
    }
    case "press":
      await page.keyboard.press(action.key);
      return `Pressed ${action.key}.`;
    case "assert":
      if (!(await page.getByText(action.text, { exact: false }).first().isVisible())) {
        throw new Error(`Expected visible text "${action.text}".`);
      }
      return `Observed text "${action.text}".`;
  }
}

export async function evaluateSuccess(
  page: Page,
  success: TaskContract["success"],
): Promise<{ passed: boolean; failures: string[] }> {
  const failures: string[] = [];
  if (success.urlMatches) {
    let matches: boolean;
    try {
      matches = new RegExp(success.urlMatches).test(page.url());
    } catch {
      matches = page.url().includes(success.urlMatches);
    }
    if (!matches) {
      failures.push(`URL did not match "${success.urlMatches}".`);
    }
  }
  if (
    success.visibleText &&
    !(await page
      .getByText(success.visibleText, { exact: false })
      .first()
      .isVisible())
  ) {
    failures.push(`Visible text "${success.visibleText}" was not found.`);
  }
  if (
    success.selector &&
    !(await page.locator(success.selector).first().isVisible())
  ) {
    failures.push(`Selector "${success.selector}" was not found.`);
  }
  return { passed: failures.length === 0, failures };
}
