import { expect, test } from "@playwright/test";

test("setup reflows to 320 CSS pixels without horizontal page overflow", async ({
  page,
}) => {
  await page.goto("/projects/demo/audits/new");
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));

  expect(dimensions.clientWidth).toBe(320);
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
});

test("mobile setup controls remain reachable and operable by keyboard", async ({
  page,
}) => {
  await page.goto("/projects/demo/audits/new");
  const target = page.getByLabel("Target URL");
  await target.focus();
  await expect(target).toBeFocused();

  await page.keyboard.press("Tab");
  await page.keyboard.press("Space");
  await expect(page.getByRole("radio", { name: "Local explicit" })).toBeChecked();

  const run = page.getByRole("button", { name: "Run reviewed audit" });
  await run.focus();
  await expect(run).toBeFocused();
});
