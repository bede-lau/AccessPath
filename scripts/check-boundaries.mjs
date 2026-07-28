// Validates internal @accesspath/* dependency edges between workspaces.
// Pure Node: reads package.json files only — no spawning, no network, no writes.
//
// Allowed matrix (docs/ARCHITECTURE.md):
//   packages/contracts            → no internal deps; ONLY zod in "dependencies"
//   packages/<engine>             → @accesspath/contracts only
//   apps/companion                → contracts + the four engine packages
//   apps/console                  → contracts ONLY; must NOT declare fastify
//   apps/demo-aid-app             → no internal deps
//   No app may depend on another app anywhere.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const INTERNAL_PREFIX = "@accesspath/";
const ENGINE_PACKAGES = [
  "@accesspath/audit-engine",
  "@accesspath/evidence",
  "@accesspath/git-workspace",
  "@accesspath/qoder-runner",
];
const APP_PACKAGES = [
  "@accesspath/companion",
  "@accesspath/console",
  "@accesspath/demo-aid-app",
];

// name → { internalAllowed, forbiddenExternal, onlyDependencies }
const RULES = {
  "@accesspath/contracts": {
    internalAllowed: [],
    // Isomorphic schema package: zod is the ONLY allowed runtime dependency.
    onlyDependenciesAllowed: ["zod"],
  },
  "@accesspath/audit-engine": { internalAllowed: ["@accesspath/contracts"] },
  "@accesspath/evidence": { internalAllowed: ["@accesspath/contracts"] },
  "@accesspath/git-workspace": { internalAllowed: ["@accesspath/contracts"] },
  "@accesspath/qoder-runner": { internalAllowed: ["@accesspath/contracts"] },
  "@accesspath/companion": {
    internalAllowed: ["@accesspath/contracts", ...ENGINE_PACKAGES],
  },
  "@accesspath/console": {
    internalAllowed: ["@accesspath/contracts"],
    forbiddenExternal: ["fastify"],
  },
  "@accesspath/demo-aid-app": { internalAllowed: [] },
};

const DEP_SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

function listWorkspaceManifests() {
  const manifests = [];
  for (const group of ["apps", "packages"]) {
    const groupDir = path.join(repoRoot, group);
    if (!fs.existsSync(groupDir)) continue;
    for (const entry of fs.readdirSync(groupDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(groupDir, entry.name, "package.json");
      if (fs.existsSync(manifestPath)) {
        manifests.push({
          relDir: `${group}/${entry.name}`,
          manifest: JSON.parse(fs.readFileSync(manifestPath, "utf8")),
        });
      }
    }
  }
  return manifests;
}

const violations = [];

for (const { relDir, manifest } of listWorkspaceManifests()) {
  const name = manifest.name ?? relDir;
  const rules = RULES[name];
  if (rules === undefined) {
    violations.push(
      `${relDir}: workspace "${name}" is not in the allowed dependency matrix ` +
        "(update scripts/check-boundaries.mjs deliberately if this is intentional).",
    );
    continue;
  }

  for (const section of DEP_SECTIONS) {
    const deps = manifest[section];
    if (deps === undefined) continue;
    for (const dep of Object.keys(deps)) {
      if (dep.startsWith(INTERNAL_PREFIX)) {
        if (APP_PACKAGES.includes(name) && APP_PACKAGES.includes(dep)) {
          violations.push(
            `${relDir} (${section}): app "${name}" must not depend on app "${dep}".`,
          );
          continue;
        }
        if (!rules.internalAllowed.includes(dep)) {
          violations.push(
            `${relDir} (${section}): "${name}" must not depend on internal package "${dep}". ` +
              `Allowed internal deps: ${rules.internalAllowed.length > 0 ? rules.internalAllowed.join(", ") : "(none)"}.`,
          );
        }
      } else if (rules.forbiddenExternal?.includes(dep)) {
        violations.push(
          `${relDir} (${section}): "${name}" must not depend on "${dep}".`,
        );
      }
    }
  }

  if (rules.onlyDependenciesAllowed !== undefined) {
    for (const dep of Object.keys(manifest.dependencies ?? {})) {
      if (!rules.onlyDependenciesAllowed.includes(dep)) {
        violations.push(
          `${relDir} (dependencies): "${name}" allows only ` +
            `[${rules.onlyDependenciesAllowed.join(", ")}] in "dependencies", found "${dep}".`,
        );
      }
    }
  }
}

if (violations.length > 0) {
  console.error("check-boundaries: FAILED — dependency boundary violations:");
  for (const violation of violations) {
    console.error(`  - ${violation}`);
  }
  process.exit(1);
}

console.log("check-boundaries: OK — all workspace dependency edges respect the allowed matrix.");
