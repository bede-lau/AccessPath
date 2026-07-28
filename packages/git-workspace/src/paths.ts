import {
  lstat,
  mkdir,
  realpath,
  stat,
} from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

import { WorkspacePathError } from "./types";

export function isWithin(parent: string, candidate: string): boolean {
  const pathFromParent = relative(parent, candidate);
  return (
    pathFromParent === "" ||
    (!pathFromParent.startsWith(`..${sep}`) &&
      pathFromParent !== ".." &&
      !isAbsolute(pathFromParent))
  );
}

export async function canonicalDirectory(path: string): Promise<string> {
  if (!isAbsolute(path)) {
    throw new WorkspacePathError("Expected an absolute directory path.");
  }
  const details = await stat(path);
  if (!details.isDirectory()) {
    throw new WorkspacePathError("Expected a directory path.");
  }
  return realpath(resolve(path));
}

export async function ensureCanonicalDirectory(path: string): Promise<string> {
  if (!isAbsolute(path)) {
    throw new WorkspacePathError("Expected an absolute directory path.");
  }
  await mkdir(path, { recursive: true });
  return canonicalDirectory(path);
}

export async function nearestExistingAncestor(path: string): Promise<string> {
  let candidate = resolve(path);
  while (true) {
    try {
      await lstat(candidate);
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      const parent = dirname(candidate);
      if (parent === candidate) {
        throw new WorkspacePathError("No existing path ancestor was found.");
      }
      candidate = parent;
    }
  }
}

export async function assertNoSymlinkSegments(
  root: string,
  candidate: string,
): Promise<void> {
  const canonicalRoot = await canonicalDirectory(root);
  const absoluteCandidate = resolve(candidate);
  if (!isWithin(canonicalRoot, absoluteCandidate)) {
    throw new WorkspacePathError("Path escapes the workspace root.");
  }

  const segments = relative(canonicalRoot, absoluteCandidate)
    .split(sep)
    .filter(Boolean);
  let current = canonicalRoot;
  for (const segment of segments) {
    current = resolve(current, segment);
    try {
      const details = await lstat(current);
      if (details.isSymbolicLink()) {
        throw new WorkspacePathError(
          "Symbolic links and junctions are not allowed in workspace paths.",
        );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      throw error;
    }
  }
}

export async function resolveContainedPath(
  root: string,
  requestedPath: string,
): Promise<string> {
  if (
    requestedPath.length === 0 ||
    requestedPath.includes("\0") ||
    isAbsolute(requestedPath) ||
    requestedPath.split(/[\\/]+/).includes("..")
  ) {
    throw new WorkspacePathError("Expected a non-empty relative path.");
  }

  const canonicalRoot = await canonicalDirectory(root);
  const candidate = resolve(canonicalRoot, requestedPath);
  if (!isWithin(canonicalRoot, candidate)) {
    throw new WorkspacePathError("Path escapes the workspace root.");
  }
  await assertNoSymlinkSegments(canonicalRoot, candidate);

  const ancestor = await nearestExistingAncestor(candidate);
  const canonicalAncestor = await realpath(ancestor);
  if (!isWithin(canonicalRoot, canonicalAncestor)) {
    throw new WorkspacePathError("Resolved path escapes the workspace root.");
  }
  return candidate;
}
