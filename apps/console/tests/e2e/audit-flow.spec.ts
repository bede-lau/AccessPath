import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type BrowserContext,
  type Page,
} from "@playwright/test";

const barrierIds = ["AP-001", "AP-002", "AP-003", "AP-004", "AP-005"];

async function expectNoSeriousOrCriticalViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const violations = results.violations.filter(({ impact }) =>
    impact === "serious" || impact === "critical",
  );
  expect(violations).toEqual([]);
}

test.describe.serial("P05 URL-only audit", () => {
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext({
      acceptDownloads: true,
      viewport: { width: 1280, height: 800 },
    });
    page = await context.newPage();
    await page.goto("/projects/demo/audits/new");
  });

  test.afterAll(async () => {
    await context.close();
  });

  test("setup surface has no serious or critical axe violations @a11y", async () => {
    await page.getByRole("button", { name: "Projects" }).click();
    await expect(page).toHaveURL("/projects");
    await expect(
      page.getByRole("heading", { name: "Emergency aid demo" }),
    ).toBeVisible();
    await expect(
      page.getByText(/It does not invent a browser journey from the URL/),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Projects" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await page.getByRole("button", { name: "Open audit setup" }).click();

    await expect(page.getByRole("heading", { name: "Review the critical path" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Audits" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    const description = page.getByText(
      "Run one deterministic keyboard journey and preserve the evidence for every completed or blocked step.",
      { exact: true },
    );
    const descriptionLayout = await description.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const box = element as HTMLElement;
      return {
        lines: range.getClientRects().length,
        clipped: box.scrollWidth > box.clientWidth,
      };
    });
    expect(descriptionLayout).toEqual({ lines: 1, clipped: false });
    await expectNoSeriousOrCriticalViolations(page);
  });

  test("incomplete target URL stays on the setup surface", async () => {
    const target = page.getByLabel("Target URL");
    const originalUrl = await target.inputValue();

    await target.fill("");
    await expect(
      page.getByRole("heading", { name: "Review the critical path" }),
    ).toBeVisible();
    const run = page.getByRole("button", { name: "Run reviewed audit" });
    await expect(run).toBeEnabled();
    await run.click();
    await expect(
      page.getByText("Enter a complete HTTP or HTTPS URL."),
    ).toBeVisible();

    await target.fill(originalUrl);
  });

  test("keyboard starts one URL-only fixture audit and reaches AP-001 through AP-005 @a11y", async () => {
    await expect(page.getByText("Companion ready", { exact: true })).toBeVisible();
    const run = page.getByRole("button", { name: "Run reviewed audit" });
    await expect(run).toBeEnabled();
    await run.focus();
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/audits\/[^/]+\/live$/);
    await expect(page.getByRole("heading", { name: "Live audit workspace" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Open Barrier Map" }),
    ).toBeVisible({ timeout: 75_000 });

    for (const id of barrierIds) {
      await expect(page.getByText(id, { exact: true })).toBeVisible();
    }
  });

  test("live audit surface has no serious or critical axe violations @a11y", async () => {
    await expectNoSeriousOrCriticalViolations(page);
  });

  test("Barrier Map and linear view expose the same five finding IDs by keyboard @a11y", async () => {
    const openMap = page.getByRole("button", { name: "Open Barrier Map" });
    await openMap.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Barrier Map" })).toBeVisible();

    await page.getByRole("button", {
      name: /Choose that the household needs help with essential costs/,
    }).click();
    await expect(
      page.getByRole("heading", {
        name: "Choose an eligibility option with a keyboard",
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Close finding detail" }).click();
    await expect(
      page.getByRole("heading", { name: "Select a barrier" }),
    ).toBeVisible();

    const linear = page.getByRole("button", { name: "Linear" });
    await linear.focus();
    await page.keyboard.press("Enter");
    await expect(linear).toHaveAttribute("aria-pressed", "true");
    const linearIds = await page
      .locator(".linear-path li li button > span:first-child")
      .allTextContents();
    expect(linearIds).toEqual(
      expect.arrayContaining(barrierIds),
    );
    for (const id of barrierIds) {
      await expect(page.getByText(id, { exact: true })).toBeVisible();
    }
  });

  test("Barrier Map surface has no serious or critical axe violations @a11y", async () => {
    await expectNoSeriousOrCriticalViolations(page);
  });

  for (const format of ["Markdown", "HTML", "JSON"] as const) {
    test(`exports ${format} evidence`, async () => {
      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: format }).click();
      const download = await downloadPromise;
      expect(await download.failure()).toBeNull();
      expect(download.suggestedFilename()).toMatch(
        new RegExp(`^accesspath-audit-.+\\.${format === "Markdown" ? "md" : format.toLowerCase()}$`),
      );
    });
  }
});
