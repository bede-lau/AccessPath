import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  SOURCE_CACHE_OWNERSHIP_MARKER,
  cleanupWorkspace,
  type PreparedWorkspace,
} from "@accesspath/git-workspace";
import {
  fileExists,
  resolveSafeRelativePath,
  validateArtifactRoot,
} from "@accesspath/evidence";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const requestedRoot =
  process.env.ACCESSPATH_ARTIFACT_ROOT ??
  path.join(homedir(), ".accesspath", "demo");
const artifactRoot = await validateArtifactRoot(requestedRoot, repoRoot);
const markerPath = resolveSafeRelativePath(
  artifactRoot,
  ".accesspath-demo-owned.json",
);
const ownedDirectories = [
  "audits",
  "missions",
  "repairs",
  "sandboxes",
  "sources",
  "worktrees",
] as const;

if (!(await fileExists(markerPath))) {
  const entries = await readdir(artifactRoot);
  if (entries.length > 0) {
    throw new Error(
      "demo:reset refused an unmarked non-empty artifact root.",
    );
  }
}

const repairsRoot = resolveSafeRelativePath(artifactRoot, "repairs");
if (await fileExists(repairsRoot)) {
  for (const entry of await readdir(repairsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const workspacePath = resolveSafeRelativePath(
      artifactRoot,
      `repairs/${entry.name}/workspace.private.json`,
    );
    if (!(await fileExists(workspacePath))) {
      continue;
    }
    const workspace = JSON.parse(
      await readFile(workspacePath, "utf8"),
    ) as PreparedWorkspace;
    await cleanupWorkspace(workspace, { force: true }).catch((error) => {
      const code = (error as NodeJS.ErrnoException).code;
      if (
        code !== "ENOENT" &&
        (!(error instanceof Error) ||
          !/does not exist|not registered|not found/i.test(error.message))
      ) {
        throw error;
      }
    });
  }
}

for (const directory of ownedDirectories) {
  await rm(resolveSafeRelativePath(artifactRoot, directory), {
    recursive: true,
    force: true,
  });
}
const sourceCacheRoot = path.resolve(
  path.dirname(artifactRoot),
  `${path.basename(artifactRoot)}-sources`,
);
const sourceCacheMarker = path.join(
  sourceCacheRoot,
  SOURCE_CACHE_OWNERSHIP_MARKER,
);
if (await fileExists(sourceCacheMarker)) {
  const sourceCacheOwnership = JSON.parse(
    await readFile(sourceCacheMarker, "utf8"),
  ) as { owner?: unknown; schemaVersion?: unknown };
  if (
    sourceCacheOwnership.owner !== "accesspath-source-cache" ||
    sourceCacheOwnership.schemaVersion !== "1.0.0"
  ) {
    throw new Error(
      "demo:reset refused a source cache with an invalid ownership marker.",
    );
  }
  await rm(sourceCacheRoot, { recursive: true, force: true });
}
await writeFile(
  markerPath,
  `${JSON.stringify({
    schemaVersion: "1.0.0",
    owner: "accesspath-demo",
  })}\n`,
  "utf8",
);

console.log("demo:reset: cleared AccessPath-owned demo evidence and worktrees");
