import { expect, test } from "@playwright/test";

const barrierIds = ["AP-001", "AP-002", "AP-003", "AP-004", "AP-005"];

test.beforeEach(async ({ page, request }) => {
  await request.post("/__fixture/reset");
  await page.goto("/");
});

test("publishes exactly the five intentional barrier hooks", async ({ page }) => {
  const hooks = page.locator("[data-barrier-id]");
  await expect(hooks).toHaveCount(5);
  const observed = await hooks.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-barrier-id")),
  );
  expect(observed).toEqual(barrierIds);
});

test("AP-001 blocks keyboard selection while the assisted path remains testable", async ({
  page,
}) => {
  const option = page.getByTestId("eligibility-yes");
  const continueButton = page.getByRole("button", { name: "Continue" });

  await expect(page.getByRole("radio")).toHaveCount(0);
  await expect(option).not.toHaveAttribute("tabindex");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Space");
  await expect(continueButton).toBeDisabled();

  await option.click();
  await expect(continueButton).toBeEnabled();
  await continueButton.focus();
  await page.keyboard.press("Enter");

  await page.getByLabel("Full name").fill("Jordan Example");
  const phone = page.getByLabel("Phone number");
  await expect(phone).not.toHaveAttribute("autocomplete");
  await phone.fill("202-555-0148");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("group")).toHaveCount(0);
  await page
    .getByRole("checkbox", { name: "Rent or temporary housing" })
    .check();
  await page.getByRole("button", { name: "Review application" }).click();

  const submit = page.getByRole("button", {
    name: "Submit test application",
  });
  await submit.click();
  await expect(page.getByTestId("review-error-summary")).toBeVisible();
  await expect(
    page.getByTestId("review-error-summary").getByRole("link"),
  ).toHaveCount(0);
  await expect(submit).toBeFocused();

  await page
    .getByRole("checkbox", {
      name: "I confirm this application contains fictional test information only",
    })
    .check();
  await submit.click();
  await expect(page.getByTestId("submission-confirmation")).toBeVisible();
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(page.getByTestId("submission-confirmation")).not.toHaveAttribute(
    "aria-live",
  );
});

test("layout stays within the viewport", async ({ page }) => {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
});
