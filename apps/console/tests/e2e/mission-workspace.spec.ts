import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function expectNoSeriousOrCriticalViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    results.violations.filter(({ impact }) =>
      impact === "serious" || impact === "critical",
    ),
  ).toEqual([]);
}

test("Mission Workspace is the first and only product workflow @a11y", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Define new mission" }),
  ).toBeVisible();
  await expect(page.getByText("Mission Workspace")).toBeVisible();
  await expect(page.getByLabel("Staging URL")).toBeVisible();
  await expect(page.getByLabel("Local repository path")).toBeVisible();
  await expect(page.getByLabel("Objective")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Proof Thread" }),
  ).toHaveCount(0);
  await expect(
    page.getByText(
      "The agent turns the outcome into an editable browser plan before observation or source work begins.",
    ),
  ).toHaveCount(0);
  await expect(
    page.getByText(/fictional|fake|demonstration|seeded|Barrier Map/i),
  ).toHaveCount(0);

  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
  await expectNoSeriousOrCriticalViolations(page);
});

test("legacy paths resolve to Mission Workspace", async ({ page }) => {
  for (const path of [
    "/projects",
    "/projects/audits/new",
    "/audits/audit-001/barrier-map",
    "/repairs/repair-001",
  ]) {
    await page.goto(path);
    await expect(
      page.getByRole("heading", { name: "Define new mission" }),
    ).toBeVisible();
  }
});

test("Mission Workspace reflows without horizontal overflow at 320px @a11y", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/missions/new");

  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  await expect(page.getByRole("button", { name: "Generate mission plan" })).toBeVisible();
  await expectNoSeriousOrCriticalViolations(page);
});

test("report-only mission exposes long populated Proof Thread states at 320px @a11y", async ({
  page,
}) => {
  const longToken = "checkout-confirmation-accessibility-evidence-".repeat(8);
  await page.route("**/api/missions/mission-report-only**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/events")) {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: "",
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        mission: {
          id: "mission-report-only",
          revision: 9,
          state: "report-only",
          stagingUrl: `https://staging.example.com/${longToken}`,
          repositorySource: {
            kind: "public-git",
            value: `https://github.com/accesspath/${longToken}.git`,
            commit: "a".repeat(40),
          },
          objective: `A keyboard user can complete ${longToken}`,
          plan: {
            frozen: true,
            steps: [
              {
                id: "step-1",
                instruction: `Open ${longToken} and submit the journey using only the keyboard.`,
              },
            ],
          },
          proofThread: [
            {
              id: "proof-observed",
              stage: "observed",
              status: "complete",
              title: "Observed staging behavior",
              summary: "The staging failure was recorded with direct evidence.",
              evidence: [`screenshot-${longToken}.png`],
            },
            {
              id: "proof-repair",
              stage: "scoped-repair",
              status: "blocked",
              title: "Scoped repair",
              summary: "Source repair stopped before authorization completed.",
              evidence: [`src/components/${longToken}.tsx`],
            },
            {
              id: "proof-verified",
              stage: "verified",
              status: "blocked",
              title: "Verified",
              summary: "No repaired preview was available for verification.",
            },
          ],
          availability: {
            execution: "report-only",
            source: "bound",
            detail: "The preserved mission can be reviewed and exported.",
          },
          reportAvailable: true,
        },
      }),
    });
  });

  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/missions/mission-report-only");

  await expect(
    page.getByRole("heading", { name: "Mission finished as report only" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Export report" }),
  ).toBeVisible();

  const observedStage = page.getByRole("button", {
    name: /Observed staging behavior/i,
  });
  await observedStage.focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("button", { name: /^Scoped repair/i }),
  ).toHaveAttribute("aria-current", "step");
  await expect(
    page.getByRole("link", {
      name: `https://staging.example.com/${longToken}`,
    }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Scoped repair workspace" })
      .getByText("Report-only mission"),
  ).toBeVisible();

  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    detailInsideStageItem:
      document.querySelector(
        ".proof-thread-list .proof-thread-item .proof-thread-detail",
      ) !== null,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  expect(dimensions.detailInsideStageItem).toBe(false);
  await expectNoSeriousOrCriticalViolations(page);
});
