// Typecheck gate: runs `tsc --noEmit -p <workspace>` for every workspace that
// has a tsconfig.json, sequentially and fail-fast, with a per-workspace
// pass/fail summary.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Fixed constant command; the only variable argument is the validated
// workspace-relative path appended per run.
const TSC_CLI = path.join(
  repoRoot,
  "node_modules",
  "typescript",
  "bin",
  "tsc",
);
const TSC_BASE_ARGS = ["--noEmit", "-p"];

// Enumerated workspace dirs must look like "apps/name" or "packages/name"
// with a conservative character set — anything else is refused.
const WORKSPACE_PATH_PATTERN = /^(apps|packages)\/[A-Za-z0-9._-]+$/;

function discoverWorkspaces() {
  const rootManifest = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
  );
  const globs = rootManifest.workspaces ?? [];
  const workspaces = [];
  for (const glob of globs) {
    // Only the fixed "<dir>/*" glob shape used by this repo is supported.
    if (!/^[A-Za-z0-9._-]+\/\*$/.test(glob)) {
      console.error(`typecheck: unsupported workspace glob "${glob}"`);
      process.exit(1);
    }
    const groupDir = path.join(repoRoot, glob.slice(0, -2));
    if (!fs.existsSync(groupDir)) continue;
    for (const entry of fs.readdirSync(groupDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const relPath = `${glob.slice(0, -2)}/${entry.name}`;
      if (fs.existsSync(path.join(repoRoot, relPath, "tsconfig.json"))) {
        workspaces.push(relPath);
      }
    }
  }
  return workspaces.sort();
}

const workspaces = discoverWorkspaces();
if (workspaces.length === 0) {
  console.error("typecheck: no workspaces with a tsconfig.json found");
  process.exit(1);
}

const summary = [];
let failed = false;

for (const workspace of workspaces) {
  if (!WORKSPACE_PATH_PATTERN.test(workspace)) {
    console.error(`typecheck: refusing unexpected workspace path "${workspace}"`);
    process.exit(1);
  }
  console.log(`typecheck: ${workspace} ...`);
  const result = spawnSync(
    process.execPath,
    [TSC_CLI, ...TSC_BASE_ARGS, workspace],
    {
      cwd: repoRoot,
      stdio: "inherit",
      windowsHide: true,
    },
  );
  const passed = result.status === 0;
  summary.push({ workspace, passed });
  if (!passed) {
    failed = true;
    break; // fail-fast: later workspaces are not run
  }
}

console.log("\ntypecheck summary:");
for (const { workspace, passed } of summary) {
  console.log(`  ${passed ? "PASS" : "FAIL"}  ${workspace}`);
}
const notRun = workspaces.slice(summary.length);
for (const workspace of notRun) {
  console.log(`  SKIP  ${workspace} (not run: fail-fast)`);
}

process.exit(failed ? 1 : 0);
