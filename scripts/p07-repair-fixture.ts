import type {
  DeterministicMockEdit,
  DeterministicMockWrite,
} from "@accesspath/qoder-runner";

const inaccessibleEligibilityOptions = `              <div
                class="eligibility-option"
                data-testid="eligibility-yes"
                data-eligibility-value="yes"
              >
                <span class="eligibility-option__marker" aria-hidden="true"></span>
                <span>
                  <strong>Yes, my household needs help</strong>
                  <small>Continue to the fictional application.</small>
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
                  <small>You can still continue for this demonstration.</small>
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
                  <small>Continue to the fictional application.</small>
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
                  <small>You can still continue for this demonstration.</small>
                </span>
              </label>`;

export const p07MockEdits: DeterministicMockEdit[] = [
  {
    filePath: "apps/demo-aid-app/public/index.html",
    oldText: inaccessibleEligibilityOptions,
    newText: accessibleEligibilityOptions,
  },
];

export const p07MockWrites: DeterministicMockWrite[] = [
  {
    filePath: "apps/demo-aid-app/tests/ap001-repair.mjs",
    content: `import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(appRoot, "public", "index.html"), "utf8");
const radios = html.match(/<input\\s+type="radio"\\s+name="eligibility"/g) ?? [];

if (radios.length !== 2) {
  console.error("AP-001 repair must expose exactly two native eligibility radios.");
  process.exit(1);
}
if (!html.includes("<label") || html.includes("eligibility-option__marker")) {
  console.error("AP-001 repair must use native labeled controls without the pointer-only marker.");
  process.exit(1);
}

console.log("AP-001 native radio repair verified");
`,
  },
];
