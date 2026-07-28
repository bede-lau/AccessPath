import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

async function repositoryPath(
  page: import("@playwright/test").Page,
): Promise<string> {
  await page.goto("/projects/demo/audits/new");
  return page.evaluate(() => {
    const path = (
      window as Window & { __ACCESSPATH_E2E_REPOSITORY_PATH__?: string }
    ).__ACCESSPATH_E2E_REPOSITORY_PATH__;
    if (path === undefined) {
      throw new Error("The P07 fixture repository path was not available.");
    }
    return path;
  });
}

async function expectNoSeriousOrCriticalViolations(
  page: import("@playwright/test").Page,
) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    results.violations.filter(
      ({ impact }) => impact === "serious" || impact === "critical",
    ),
  ).toEqual([]);
}

test.describe.serial("P07 audit-to-repair vertical slice", () => {
  test("attaches the fixture, repairs AP-001, replays, exports, and previews rewind @a11y", async ({
    page,
  }) => {
    const fixtureRepository = await repositoryPath(page);
    await page.getByRole("button", { name: "Run reviewed audit" }).click();
    await expect(
      page.getByRole("button", { name: "Open Barrier Map" }),
    ).toBeVisible({ timeout: 75_000 });
    await page.getByRole("button", { name: "Open Barrier Map" }).click();

    await page.getByRole("button", {
      name: /Choose that the household needs help with essential costs/,
    }).click();
    await page.getByRole("radio", { name: "repair" }).check();
    await page.getByLabel("Local fixture repository").fill(fixtureRepository);
    await page
      .getByRole("button", { name: "Attach and create repair" })
      .click();

    await expect(
      page.getByRole("heading", { name: "Repair workspace" }),
    ).toBeVisible();
    await expect(page.getByText("AP-001", { exact: true })).toBeVisible();
    await expect(page.getByText("Base unchanged", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Prepare worktree" }).click();
    await page.getByRole("button", { name: "Run diagnosis" }).click();
    await expect(
      page.getByRole("heading", { name: "Approve the repair plan" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Approve once" }).click();

    await page.getByRole("button", { name: "Start repair" }).click();
    await expect(
      page.getByRole("heading", {
        name: "Edit apps/demo-aid-app/public/index.html",
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Approve once" }).click();
    await expect(
      page.getByRole("heading", {
        name: "Write apps/demo-aid-app/tests/ap001-repair.mjs",
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Approve once" }).click();

    await expect(
      page.getByRole("heading", { name: "2 changed files" }),
    ).toBeVisible();
    await expect(
      page.getByText('type="radio"', { exact: false }).first(),
    ).toBeVisible();
    await page.getByRole("button", { name: "Verify patch" }).click();

    await expect(
      page.getByRole("heading", { name: "Approve the repair patch" }),
    ).toBeVisible({ timeout: 90_000 });
    const comparison = page.locator(".repair-comparison");
    await expect(comparison.getByText("AP-001", { exact: true })).toBeVisible();
    await expect(comparison.getByText("resolved", { exact: true })).toBeVisible();
    for (const id of ["AP-002", "AP-003", "AP-004", "AP-005"]) {
      await expect(comparison.getByText(id, { exact: true })).toBeVisible();
    }
    await expect(comparison.getByText("remaining", { exact: true })).toHaveCount(4);

    for (const format of ["HTML", "Markdown", "JSON"] as const) {
      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: format, exact: true }).click();
      const download = await downloadPromise;
      expect(await download.failure()).toBeNull();
      expect(download.suggestedFilename()).toMatch(
        new RegExp(
          `^accesspath-repair-.+\\.${format === "Markdown" ? "md" : format.toLowerCase()}$`,
        ),
      );
    }

    await page.getByRole("button", { name: "Preview rewind" }).click();
    await expect(
      page.getByRole("heading", { name: "Rewind repair files" }),
    ).toBeVisible();
    await expect(page.getByText("Stale checks", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Approve and rewind" }).click();
    await expect(
      page.getByRole("heading", { name: "0 changed files" }),
    ).toBeVisible();
    await expect(page.getByText("No verification run recorded.")).toBeVisible();

    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText("cancelled", { exact: true })).toBeVisible();
    await expect(page.getByText("Base unchanged", { exact: true })).toBeVisible();

    const renderedText = await page.locator("body").innerText();
    expect(renderedText).not.toMatch(/[A-Za-z]:\\Users\\/);
    expect(renderedText).not.toContain(".accesspath");
    await expectNoSeriousOrCriticalViolations(page);
  });
});
