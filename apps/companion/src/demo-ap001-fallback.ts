import type { RepairManifest } from "@accesspath/contracts";
import {
  DeterministicMockQoderAdapter,
  matchesAllowedPath,
  type DeterministicMockEdit,
} from "@accesspath/qoder-runner";

const DEMO_AP001_PATH_SUFFIXES = [
  "public/index.html",
  "public/app.js",
  "tests/fixture-data.test.ts",
  "tests/e2e/fixture.spec.ts",
] as const;

const inaccessibleEligibilityOptions = `              <div
                class="eligibility-option"
                data-testid="eligibility-yes"
                data-eligibility-value="yes"
              >
                <span class="eligibility-option__marker" aria-hidden="true"></span>
                <span>
                  <strong>Yes, my household needs help</strong>
                  <small>Continue to the application.</small>
                </span>
              </div>
              <div
                class="eligibility-option"
                data-testid="eligibility-not-sure"
                data-eligibility-value="not-sure"
              >
                <span class="eligibility-option__marker" aria-hidden="true"></span>
                <span>
                  <strong>I am not sure</strong>
                  <small>You can still continue and review available support.</small>
                </span>
              </div>`;

const accessibleEligibilityOptions = `              <label
                class="eligibility-option"
                data-testid="eligibility-yes"
                data-eligibility-value="yes"
              >
                <input type="radio" name="eligibility" value="yes" />
                <span>
                  <strong>Yes, my household needs help</strong>
                  <small>Continue to the application.</small>
                </span>
              </label>
              <label
                class="eligibility-option"
                data-testid="eligibility-not-sure"
                data-eligibility-value="not-sure"
              >
                <input type="radio" name="eligibility" value="not-sure" />
                <span>
                  <strong>I am not sure</strong>
                  <small>You can still continue and review available support.</small>
                </span>
              </label>`;

const pointerOnlyEligibilityHandler = `  for (const option of eligibilityOptions) {
    // AP-001 is intentional: pointer click only, with no role, tabindex, or key handler.
    option.addEventListener("click", () => {
      application.eligibility = option.dataset.eligibilityValue;
      for (const candidate of eligibilityOptions) {
        candidate.dataset.selected = String(candidate === option);
      }
      eligibilityNext.disabled = false;
    });
  }`;

const keyboardEligibilityHandler = `  const eligibilityInputs = [
    ...document.querySelectorAll("input[name='eligibility']"),
  ];

  function selectEligibility(value) {
    application.eligibility = value;
    for (const candidate of eligibilityOptions) {
      candidate.dataset.selected = String(
        candidate.dataset.eligibilityValue === value,
      );
    }
    eligibilityNext.disabled = false;
  }

  for (const input of eligibilityInputs) {
    input.addEventListener("change", () => {
      if (input.checked) {
        selectEligibility(input.value);
      }
    });
  }`;

const pointerOnlyFixtureTest = `  it("keeps AP-001 as an isolated pointer-only custom choice", () => {
    const container = html.match(
      /<div\\s+class="eligibility-options"[\\s\\S]*?data-barrier-id="AP-001"[\\s\\S]*?>/,
    )?.[0];
    expect(container).toBeDefined();
    expect(container).not.toMatch(/\\brole=/);
    expect(container).not.toMatch(/\\btabindex=/);
    expect(html).toContain('data-testid="eligibility-yes"');
    expect(html).not.toContain('type="radio"');
  });`;

const keyboardFixtureTest = `  it("keeps AP-001 as native keyboard-operable radio choices", () => {
    const container = html.match(
      /<div\\s+class="eligibility-options"[\\s\\S]*?data-barrier-id="AP-001"[\\s\\S]*?>/,
    )?.[0];
    expect(container).toBeDefined();
    expect(html).toContain('data-testid="eligibility-yes"');
    expect(html.match(/<input type="radio" name="eligibility"/g)).toHaveLength(2);
    expect(html).not.toContain("eligibility-option__marker");
  });`;

const pointerOnlyE2eTest = `test("AP-001 blocks keyboard selection while the assisted path remains testable", async ({
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
  await page.keyboard.press("Enter");`;

const keyboardE2eTest = `test("AP-001 supports keyboard selection while the assisted path remains testable", async ({
  page,
}) => {
  const option = page.getByRole("radio", {
    name: "Yes, my household needs help",
  });
  const continueButton = page.getByRole("button", { name: "Continue" });

  await expect(option).toBeVisible();
  await option.focus();
  await page.keyboard.press("Space");
  await expect(option).toBeChecked();
  await expect(continueButton).toBeEnabled();
  await continueButton.focus();
  await page.keyboard.press("Enter");`;

export const DEMO_AP001_DIAGNOSIS = `## AP-001 Repair Plan

### What is affected
The eligibility question in the emergency assistance application cannot be completed using only a keyboard.

### What is causing the issue
The two answers are click-only elements instead of standard radio buttons, so keyboard users cannot focus or select them.

### Planned code changes
1. Update \`apps/demo-aid-app/public/index.html\` to use two native radio buttons for the eligibility choices.
2. Update \`apps/demo-aid-app/public/app.js\` so the Continue button responds when a radio choice changes.
3. Update \`apps/demo-aid-app/tests/fixture-data.test.ts\` and \`apps/demo-aid-app/tests/e2e/fixture.spec.ts\` to check the keyboard-accessible behavior.

### How it will be checked
1. Run the existing application checks.
2. Use Tab and Space to choose an eligibility option and continue through the form.`;

function pathsWithPrefix(prefix: string): string[] {
  return DEMO_AP001_PATH_SUFFIXES.map((path) => `${prefix}${path}`);
}

export function demoAp001FallbackPaths(
  manifest: RepairManifest,
): string[] | undefined {
  if (manifest.findingIds.length !== 1 || manifest.findingIds[0] !== "AP-001") {
    return undefined;
  }
  return ["apps/demo-aid-app/", ""]
    .map(pathsWithPrefix)
    .find((paths) =>
      paths.every((path) =>
        matchesAllowedPath(path, manifest.allowedPathGlobs),
      ),
    );
}

export function isDemoAp001FallbackEligible(manifest: RepairManifest): boolean {
  return demoAp001FallbackPaths(manifest) !== undefined;
}

export function canCompleteDemoAp001VerificationFallback(
  manifest: RepairManifest,
  changedFiles: readonly string[],
): boolean {
  const fallbackPaths = demoAp001FallbackPaths(manifest);
  return (
    fallbackPaths !== undefined &&
    changedFiles.length > 0 &&
    changedFiles.every((path) => fallbackPaths.includes(path))
  );
}

export function createDemoAp001FallbackAdapter(
  paths = pathsWithPrefix("apps/demo-aid-app/"),
): DeterministicMockQoderAdapter {
  const edits: DeterministicMockEdit[] = [
    {
      filePath: paths[0]!,
      oldText: inaccessibleEligibilityOptions,
      newText: accessibleEligibilityOptions,
    },
    {
      filePath: paths[1]!,
      oldText: pointerOnlyEligibilityHandler,
      newText: keyboardEligibilityHandler,
    },
    {
      filePath: paths[2]!,
      oldText: pointerOnlyFixtureTest,
      newText: keyboardFixtureTest,
    },
    {
      filePath: paths[3]!,
      oldText: pointerOnlyE2eTest,
      newText: keyboardE2eTest,
    },
  ];
  return new DeterministicMockQoderAdapter({
    diagnosis: DEMO_AP001_DIAGNOSIS,
    edits,
    repairSummary:
      "Applied the approved AP-001 keyboard repair and updated its regression checks.",
  });
}
