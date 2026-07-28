// Lint gate: ESLint (flat config) over the whole repo, then the dependency
// boundary checker. Exits non-zero if either fails; both always run so a
// single invocation reports everything.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Invoke the installed ESLint entry point directly.
const ESLINT_CLI = path.join(
  repoRoot,
  "node_modules",
  "eslint",
  "bin",
  "eslint.js",
);

const eslintResult = spawnSync(process.execPath, [ESLINT_CLI, "."], {
  cwd: repoRoot,
  stdio: "inherit",
  windowsHide: true,
});
const eslintFailed = eslintResult.status !== 0;
if (eslintFailed) {
  console.error(`lint: eslint failed (exit ${eslintResult.status ?? "unknown"})`);
} else {
  console.log("lint: eslint passed");
}

// Boundary checker is plain Node — no shell needed. Fixed script path.
const boundariesResult = spawnSync(
  process.execPath,
  [path.join(repoRoot, "scripts", "check-boundaries.mjs")],
  { cwd: repoRoot, stdio: "inherit" },
);
const boundariesFailed = boundariesResult.status !== 0;
if (boundariesFailed) {
  console.error(
    `lint: check-boundaries failed (exit ${boundariesResult.status ?? "unknown"})`,
  );
}

process.exit(eslintFailed || boundariesFailed ? 1 : 0);
