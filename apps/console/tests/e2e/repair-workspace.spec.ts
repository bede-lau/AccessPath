import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

async function seededRepairId(
  page: import("@playwright/test").Page,
): Promise<string> {
  await page.goto("/projects/demo/audits/new");
  return page.evaluate(() => {
    const repairId = (
      window as Window & { __ACCESSPATH_E2E_REPAIR_ID__?: string }
    ).__ACCESSPATH_E2E_REPAIR_ID__;
    if (repairId === undefined) {
      throw new Error("The seeded P06 repair ID was not available.");
    }
    return repairId;
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

test.describe.serial("P06 isolated repair workspace", () => {
  test("drives approval, interrupt, verification, rewind, and cleanup through the real companion @a11y", async ({
    page,
  }) => {
    const repairId = await seededRepairId(page);
    await page.goto(`/repairs/${repairId}`);

    await expect(
      page.getByRole("heading", { name: "Repair workspace" }),
    ).toBeVisible();
    await expect(page.getByText("AP-001", { exact: true })).toBeVisible();
    await expect(page.getByText("Base unchanged", { exact: true })).toBeVisible();
    await expectNoSeriousOrCriticalViolations(page);

    await page.getByRole("button", { name: "Prepare worktree" }).click();
    await page.getByRole("button", { name: "Run diagnosis" }).click();
    await expect(
      page.getByRole("heading", { name: "Approve the repair plan" }),
    ).toBeVisible();
    const approvePlan = page.getByRole("button", { name: "Approve once" });
    await approvePlan.focus();
    await page.keyboard.press("Enter");

    await page.getByRole("button", { name: "Start repair" }).click();
    await expect(
      page.getByRole("heading", { name: "Edit src/eligibility.mjs" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Pause" }).click();
    await expect(page.getByText("Paused", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Resume" }).click();
    await expect(
      page.getByRole("heading", { name: "Edit src/eligibility.mjs" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Approve once" }).click();

    await expect(
      page.getByRole("heading", { name: "1 changed files" }),
    ).toBeVisible();
    await expect(page.getByText("return true;", { exact: false })).toBeVisible();
    await expect(page.getByText("Base unchanged", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Verify patch" }).click();
    await expect(page.getByText("passed", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Approve the repair patch" }),
    ).toBeVisible();

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

    const requested = page.getByText("Permission requested", { exact: true });
    const approved = page.getByText("Permission approved", { exact: true });
    const started = page.getByText("Tool started", { exact: true });
    await expect(requested.first()).toBeVisible();
    await expect(approved.first()).toBeVisible();
    await expect(started.first()).toBeVisible();

    const renderedText = await page.locator("body").innerText();
    expect(renderedText).not.toMatch(/[A-Za-z]:\\Users\\/);
    expect(renderedText).not.toContain(".accesspath");
    await expectNoSeriousOrCriticalViolations(page);

    for (const format of ["Markdown", "JSON"] as const) {
      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: format }).click();
      const download = await downloadPromise;
      expect(await download.failure()).toBeNull();
      expect(download.suggestedFilename()).toMatch(
        new RegExp(
          `^accesspath-repair-${repairId}\\.${format === "Markdown" ? "md" : "json"}$`,
        ),
      );
    }
  });
});
