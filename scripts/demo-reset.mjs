// demo:reset — SAFE NO-OP in P02.
//
// This script inspects the AccessPath artifact root and reports what a future
// reset would remove, but it deletes NOTHING in P02. Full reset behavior lands
// in P03/P07. It never touches the repository or anything outside the artifact
// root, and it spawns no shells or child processes.
//
// Artifact root resolution mirrors the companion env (apps/companion/src/env.ts):
// ACCESSPATH_ARTIFACT_ROOT if set (must be absolute), else ~/.accesspath.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Subdirectories owned by AccessPath under the artifact root. Only these are
// ever considered; nothing else under the root is AccessPath's to touch.
const OWNED_SUBDIRS = ["audits", "repairs", "worktrees"];
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function canonicalize(input) {
  const resolved = path.resolve(input);
  const missingSegments = [];
  let existingAncestor = resolved;
  while (!fs.existsSync(existingAncestor)) {
    const parent = path.dirname(existingAncestor);
    if (parent === existingAncestor) break;
    missingSegments.unshift(path.basename(existingAncestor));
    existingAncestor = parent;
  }
  const canonicalAncestor = fs.existsSync(existingAncestor)
    ? fs.realpathSync.native(existingAncestor)
    : existingAncestor;
  return path.join(canonicalAncestor, ...missingSegments);
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

let artifactRoot;
if (process.env.ACCESSPATH_ARTIFACT_ROOT !== undefined) {
  if (!path.isAbsolute(process.env.ACCESSPATH_ARTIFACT_ROOT)) {
    console.error(
      "demo:reset: ACCESSPATH_ARTIFACT_ROOT must be an absolute path.",
    );
    process.exit(1);
  }
  artifactRoot = canonicalize(process.env.ACCESSPATH_ARTIFACT_ROOT);
} else {
  artifactRoot = canonicalize(path.join(os.homedir(), ".accesspath"));
}

if (isWithin(canonicalize(repoRoot), artifactRoot)) {
  console.error(
    "demo:reset: ACCESSPATH_ARTIFACT_ROOT must remain outside the repository.",
  );
  process.exit(1);
}
const artifactRootDisplay =
  artifactRoot === canonicalize(path.join(os.homedir(), ".accesspath"))
    ? "~/.accesspath"
    : `<external:${path.basename(artifactRoot)}>`;

const found = [];
for (const subdir of OWNED_SUBDIRS) {
  const dirPath = path.join(artifactRoot, subdir);
  let entries;
  try {
    entries = fs.readdirSync(dirPath);
  } catch {
    continue; // absent → nothing owned here
  }
  found.push({ subdir, entries });
}

// Owned subdirs that exist but are empty still count as "nothing to remove".
const hasContent = found.some(({ entries }) => entries.length > 0);

if (!hasContent) {
  console.log(
    `demo:reset (P02): nothing owned by AccessPath to remove under ${artifactRootDisplay}`,
  );
  console.log(
    "demo:reset (P02): note — this is a safe no-op; it does NOT claim a " +
      "complete demo reset or verification (full reset lands in P03/P07).",
  );
  process.exit(0);
}

console.log(
  `demo:reset (P02): found AccessPath-owned content under ${artifactRootDisplay}:`,
);
for (const { subdir, entries } of found) {
  if (entries.length === 0) {
    console.log(`  ${subdir}/ (empty)`);
    continue;
  }
  console.log(`  ${subdir}/`);
  for (const entry of entries) {
    console.log(`    ${entry}`);
  }
}
console.log(
  "demo:reset (P02): NOTHING was deleted — P02 does not delete; the full " +
    "reset lands in P03/P07.",
);
console.log(
  "demo:reset (P02): note — this does NOT claim a complete demo reset or " +
    "verification.",
);
process.exit(0);
