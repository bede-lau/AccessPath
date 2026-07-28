import {
  lstat,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  resolve,
} from "node:path";

import {
  RepositoryConfigSchema,
  type RepositoryConfig,
} from "@accesspath/contracts";

import { git } from "./git";
import {
  assertNoSymlinkSegments,
  canonicalDirectory,
  ensureCanonicalDirectory,
  isWithin,
  resolveContainedPath,
} from "./paths";
import {
  GitWorkspaceError,
  WorkspacePathError,
  type BaseIntegritySnapshot,
  type CleanupWorkspaceOptions,
  type GitDiffSnapshot,
  type GitFileStatus,
  type GitStatusSnapshot,
  type GitTreeEntry,
  type GitTreeSnapshot,
  type PreparedWorkspace,
  type PrepareWorkspaceOptions,
  type RepositoryValidation,
} from "./types";

export const PACKAGE_NAME = "@accesspath/git-workspace" as const;
export const OWNERSHIP_MARKER = ".accesspath-worktree-owner.json";
const OWNER = "@accesspath/git-workspace";

export { GitCommandError } from "./git";
export {
  GitWorkspaceError,
  WorkspacePathError,
  type BaseIntegritySnapshot,
  type CleanupWorkspaceOptions,
  type GitDiffSnapshot,
  type GitFileStatus,
  type GitStatusSnapshot,
  type GitTreeEntry,
  type GitTreeSnapshot,
  type PreparedWorkspace,
  type PrepareWorkspaceOptions,
  type RepositoryValidation,
} from "./types";

function repositoryError(message: string): GitWorkspaceError {
  return new GitWorkspaceError("REPOSITORY_INVALID", message);
}

async function inputDirectory(inputPath: string): Promise<string> {
  if (!isAbsolute(inputPath)) {
    throw repositoryError("Repository path must be absolute.");
  }
  try {
    const details = await stat(inputPath);
    return details.isDirectory() ? inputPath : dirname(inputPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw repositoryError("Repository path does not exist.");
    }
    throw error;
  }
}

export async function resolveRepositoryTopLevel(
  repositoryPath: string,
): Promise<string> {
  const directory = await inputDirectory(repositoryPath);
  const result = await git(
    directory,
    ["rev-parse", "--path-format=absolute", "--show-toplevel"],
    { allowFailure: true },
  );
  if (result.exitCode !== 0 || result.stdout.trim() === "") {
    throw repositoryError("Path is not inside a Git working tree.");
  }
  const root = await canonicalDirectory(result.stdout.trim());
  const bare = await git(root, ["rev-parse", "--is-bare-repository"]);
  if (bare.stdout.trim() !== "false") {
    throw repositoryError("Bare Git repositories are not supported.");
  }
  return root;
}

async function currentBranch(repositoryRoot: string): Promise<string> {
  const branch = await git(
    repositoryRoot,
    ["symbolic-ref", "--quiet", "--short", "HEAD"],
    { allowFailure: true },
  );
  if (branch.exitCode !== 0 || branch.stdout.trim() === "") {
    throw repositoryError("Repository must be on a named branch.");
  }
  return branch.stdout.trim();
}

async function headCommit(repositoryRoot: string): Promise<string> {
  const result = await git(
    repositoryRoot,
    ["rev-parse", "--verify", "HEAD^{commit}"],
    { allowFailure: true },
  );
  if (result.exitCode !== 0) {
    throw repositoryError("Repository has no valid HEAD commit.");
  }
  return result.stdout.trim();
}

function parseStatus(content: string): GitFileStatus[] {
  const records = content.split("\0");
  const files: GitFileStatus[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record === "") {
      continue;
    }
    const indexStatus = record[0] ?? " ";
    const worktreeStatus = record[1] ?? " ";
    const path = record.slice(3);
    if (path === OWNERSHIP_MARKER) {
      continue;
    }
    const renamed = indexStatus === "R" || worktreeStatus === "R";
    const originalPath = renamed ? records[index + 1] : undefined;
    if (renamed) {
      index += 1;
    }
    files.push({
      path,
      indexStatus,
      worktreeStatus,
      ...(originalPath === undefined ? {} : { originalPath }),
    });
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

export async function getStatus(
  repositoryPath: string,
): Promise<GitStatusSnapshot> {
  const repositoryRoot = await resolveRepositoryTopLevel(repositoryPath);
  const [branch, head, statusResult] = await Promise.all([
    currentBranch(repositoryRoot),
    headCommit(repositoryRoot),
    git(repositoryRoot, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
    ]),
  ]);
  const files = parseStatus(statusResult.stdout);
  return { branch, head, clean: files.length === 0, files };
}

export async function validateRepository(
  repositoryPath: string,
): Promise<RepositoryValidation> {
  const repositoryRoot = await resolveRepositoryTopLevel(repositoryPath);
  const status = await getStatus(repositoryRoot);
  if (!status.clean) {
    throw new GitWorkspaceError(
      "REPOSITORY_DIRTY",
      "Repository base worktree must be clean.",
    );
  }
  return {
    repositoryRoot,
    repositoryDisplayName: basename(repositoryRoot),
    baseBranch: status.branch,
    baseCommit: status.head,
    clean: true,
  };
}

export async function validateRepositoryConfig(
  input: RepositoryConfig,
): Promise<RepositoryValidation> {
  const config = RepositoryConfigSchema.parse(input);
  const validation = await validateRepository(config.repositoryPath);
  if (validation.baseBranch !== config.baseBranch) {
    throw repositoryError(
      `Configured base branch ${config.baseBranch} does not match the repository branch.`,
    );
  }
  if (validation.baseCommit.toLowerCase() !== config.baseCommit.toLowerCase()) {
    throw repositoryError(
      "Configured base commit does not match the repository HEAD.",
    );
  }
  return validation;
}

async function treeId(repositoryRoot: string, ref = "HEAD"): Promise<string> {
  const result = await git(repositoryRoot, [
    "rev-parse",
    "--verify",
    `${ref}^{tree}`,
  ]);
  return result.stdout.trim();
}

export async function captureBaseIntegrity(
  repositoryPath: string,
): Promise<BaseIntegritySnapshot> {
  const repositoryRoot = await resolveRepositoryTopLevel(repositoryPath);
  const [branch, commit, tree, status] = await Promise.all([
    currentBranch(repositoryRoot),
    headCommit(repositoryRoot),
    treeId(repositoryRoot),
    git(repositoryRoot, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
    ]),
  ]);
  return {
    branch,
    commit,
    treeId: tree,
    status: status.stdout,
  };
}

function assertRepairId(repairId: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(repairId)) {
    throw new GitWorkspaceError("CONFLICT", "Repair ID is invalid.");
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function assertDisjointRoots(
  repositoryRoot: string,
  artifactRoot: string,
): Promise<void> {
  if (
    isWithin(repositoryRoot, artifactRoot) ||
    isWithin(artifactRoot, repositoryRoot)
  ) {
    throw new WorkspacePathError(
      "Artifact root and repository root must be disjoint.",
    );
  }
}

function markerContent(workspace: PreparedWorkspace): string {
  return `${JSON.stringify({
    schemaVersion: "1.0.0",
    owner: OWNER,
    worktreeId: workspace.id,
    repositoryRoot: workspace.repositoryRoot,
    worktreePath: workspace.worktreePath,
    branch: workspace.branch,
    baseCommit: workspace.baseCommit,
    artifactRoot: workspace.artifactRoot,
  })}\n`;
}

export async function prepareWorkspace(
  input: RepositoryConfig,
  options: PrepareWorkspaceOptions,
): Promise<PreparedWorkspace> {
  const config = RepositoryConfigSchema.parse(input);
  assertRepairId(options.repairId);
  const validation = await validateRepositoryConfig(config);
  const artifactRoot = await ensureCanonicalDirectory(options.artifactRoot);
  await assertDisjointRoots(validation.repositoryRoot, artifactRoot);

  const worktreesRoot = await ensureCanonicalDirectory(
    join(artifactRoot, "worktrees"),
  );
  await assertNoSymlinkSegments(artifactRoot, worktreesRoot);
  const worktreePath = resolve(worktreesRoot, options.repairId);
  if (!isWithin(worktreesRoot, worktreePath)) {
    throw new WorkspacePathError("Worktree path escapes the artifact root.");
  }
  if (await pathExists(worktreePath)) {
    throw new GitWorkspaceError(
      "CONFLICT",
      "A worktree already exists for this repair ID.",
    );
  }

  const branch = `accesspath/${options.repairId}`;
  const branchCheck = await git(
    validation.repositoryRoot,
    ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
    { allowFailure: true },
  );
  if (branchCheck.exitCode === 0) {
    throw new GitWorkspaceError(
      "CONFLICT",
      "A branch already exists for this repair ID.",
    );
  }

  const baseIntegrity = await captureBaseIntegrity(validation.repositoryRoot);
  await git(validation.repositoryRoot, [
    "worktree",
    "add",
    "-b",
    branch,
    worktreePath,
    validation.baseCommit,
  ]);

  try {
    const canonicalWorktree = await realpath(worktreePath);
    const details = await lstat(worktreePath);
    if (
      details.isSymbolicLink() ||
      !isWithin(worktreesRoot, canonicalWorktree) ||
      dirname(canonicalWorktree) !== worktreesRoot
    ) {
      throw new WorkspacePathError(
        "Created worktree is not a direct child of the owned worktree root.",
      );
    }
    const workspace: PreparedWorkspace = {
      id: options.repairId,
      repositoryRoot: validation.repositoryRoot,
      repositoryDisplayName: validation.repositoryDisplayName,
      worktreePath: canonicalWorktree,
      branch,
      baseBranch: validation.baseBranch,
      baseCommit: validation.baseCommit,
      artifactRoot,
      ownershipMarkerPath: join(canonicalWorktree, OWNERSHIP_MARKER),
      config: { ...config, repositoryPath: validation.repositoryRoot },
      baseIntegrity,
    };
    await writeFile(workspace.ownershipMarkerPath, markerContent(workspace), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await assertBaseIntegrity(workspace);
    return workspace;
  } catch (error) {
    await git(
      validation.repositoryRoot,
      ["worktree", "remove", "--force", "--", worktreePath],
      { allowFailure: true },
    );
    throw error;
  }
}

export async function resolveWorkspacePath(
  workspace: PreparedWorkspace,
  requestedPath: string,
): Promise<string> {
  return resolveContainedPath(workspace.worktreePath, requestedPath);
}

export async function getDiff(
  workspace: PreparedWorkspace,
): Promise<GitDiffSnapshot> {
  const status = await getStatus(workspace.worktreePath);
  const [trackedPatch, trackedStat] = await Promise.all([
    git(workspace.worktreePath, [
      "diff",
      "--binary",
      "--no-ext-diff",
      workspace.baseCommit,
      "--",
    ]),
    git(workspace.worktreePath, [
      "diff",
      "--stat",
      "--no-ext-diff",
      workspace.baseCommit,
      "--",
    ]),
  ]);
  const untracked = status.files.filter(
    (file) => file.indexStatus === "?" && file.worktreeStatus === "?",
  );
  const untrackedDiffs = await Promise.all(
    untracked.map(async (file) => {
      const [patch, stat] = await Promise.all([
        git(
          workspace.worktreePath,
          ["diff", "--binary", "--no-index", "--", "/dev/null", file.path],
          { allowFailure: true },
        ),
        git(
          workspace.worktreePath,
          ["diff", "--stat", "--no-index", "--", "/dev/null", file.path],
          { allowFailure: true },
        ),
      ]);
      if (![0, 1].includes(patch.exitCode) || ![0, 1].includes(stat.exitCode)) {
        throw repositoryError(`Git could not diff untracked file ${file.path}.`);
      }
      return { patch: patch.stdout, stat: stat.stdout };
    }),
  );
  return {
    baseCommit: workspace.baseCommit,
    patch: [trackedPatch.stdout, ...untrackedDiffs.map((item) => item.patch)]
      .filter(Boolean)
      .join(""),
    stat: [trackedStat.stdout, ...untrackedDiffs.map((item) => item.stat)]
      .filter(Boolean)
      .join(""),
    changedFiles: status.files.map((file) => file.path),
  };
}

export async function getTreeSnapshot(
  repositoryPath: string,
  ref = "HEAD",
): Promise<GitTreeSnapshot> {
  const repositoryRoot = await resolveRepositoryTopLevel(repositoryPath);
  const [commitResult, treeResult, entriesResult] = await Promise.all([
    git(repositoryRoot, ["rev-parse", "--verify", `${ref}^{commit}`]),
    git(repositoryRoot, ["rev-parse", "--verify", `${ref}^{tree}`]),
    git(repositoryRoot, ["ls-tree", "-r", "-l", "-z", ref]),
  ]);
  const entries: GitTreeEntry[] = entriesResult.stdout
    .split("\0")
    .filter(Boolean)
    .map((record) => {
      const match =
        /^(?<mode>\d+) (?<type>\S+) (?<objectId>[a-f0-9]+)\s+(?<size>-|\d+)\t(?<path>.*)$/s.exec(
          record,
        );
      if (match?.groups === undefined) {
        throw repositoryError("Git returned an invalid tree entry.");
      }
      return {
        mode: match.groups.mode,
        type: match.groups.type,
        objectId: match.groups.objectId,
        ...(match.groups.size === "-"
          ? {}
          : { size: Number(match.groups.size) }),
        path: match.groups.path,
      };
    });
  return {
    ref,
    commit: commitResult.stdout.trim(),
    treeId: treeResult.stdout.trim(),
    entries,
  };
}

export async function assertBaseIntegrity(
  workspace: PreparedWorkspace,
): Promise<void> {
  const current = await captureBaseIntegrity(workspace.repositoryRoot);
  const expected = workspace.baseIntegrity;
  if (
    current.branch !== expected.branch ||
    current.commit !== expected.commit ||
    current.treeId !== expected.treeId ||
    current.status !== expected.status
  ) {
    throw new GitWorkspaceError(
      "BASE_CHANGED",
      "The base checkout changed after the repair workspace was created.",
    );
  }
}

async function readAndValidateMarker(
  workspace: PreparedWorkspace,
): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(workspace.ownershipMarkerPath, "utf8"));
  } catch {
    throw new GitWorkspaceError(
      "NOT_OWNED",
      "Worktree ownership marker is missing or invalid.",
    );
  }
  const expected = JSON.parse(markerContent(workspace)) as unknown;
  if (JSON.stringify(parsed) !== JSON.stringify(expected)) {
    throw new GitWorkspaceError(
      "NOT_OWNED",
      "Worktree ownership marker does not match this workspace.",
    );
  }
}

async function assertRegisteredWorktree(
  workspace: PreparedWorkspace,
): Promise<void> {
  const registered = await registeredWorktrees(workspace.repositoryRoot);
  if (!registered.includes(workspace.worktreePath)) {
    throw new GitWorkspaceError(
      "NOT_OWNED",
      "Worktree is not registered with the expected repository.",
    );
  }
}

async function registeredWorktrees(repositoryRoot: string): Promise<string[]> {
  const result = await git(repositoryRoot, [
    "worktree",
    "list",
    "--porcelain",
    "-z",
  ]);
  const registered = result.stdout
    .split("\0")
    .filter((record) => record.startsWith("worktree "))
    .map((record) => record.slice("worktree ".length));
  const canonicalRegistered = await Promise.all(
    registered.map((path) => realpath(path).catch(() => "")),
  );
  return canonicalRegistered.filter(Boolean);
}

export async function cleanupWorkspace(
  workspace: PreparedWorkspace,
  options: CleanupWorkspaceOptions = {},
): Promise<void> {
  const artifactRoot = await canonicalDirectory(workspace.artifactRoot);
  const worktreesRoot = await canonicalDirectory(
    join(artifactRoot, "worktrees"),
  );
  const canonicalWorktree = await canonicalDirectory(workspace.worktreePath);
  if (
    !isWithin(worktreesRoot, canonicalWorktree) ||
    dirname(canonicalWorktree) !== worktreesRoot
  ) {
    throw new WorkspacePathError(
      "Cleanup target is outside the owned worktree root.",
    );
  }
  await assertNoSymlinkSegments(worktreesRoot, canonicalWorktree);
  await readAndValidateMarker({
    ...workspace,
    artifactRoot,
    worktreePath: canonicalWorktree,
    ownershipMarkerPath: join(canonicalWorktree, OWNERSHIP_MARKER),
  });
  await assertRegisteredWorktree(workspace);

  const status = await getStatus(canonicalWorktree);
  if (!status.clean && options.force !== true) {
    throw new GitWorkspaceError(
      "CONFLICT",
      "Worktree has changes; force must be explicit for cleanup.",
    );
  }
  await assertBaseIntegrity(workspace);
  await git(workspace.repositoryRoot, [
    "worktree",
    "remove",
    "--force",
    "--",
    canonicalWorktree,
  ]);
  await git(workspace.repositoryRoot, ["worktree", "prune"]);
  if (await pathExists(canonicalWorktree)) {
    const remainingPath = await realpath(canonicalWorktree);
    const remainingDetails = await lstat(canonicalWorktree);
    const registered = await registeredWorktrees(workspace.repositoryRoot);
    if (
      remainingDetails.isSymbolicLink() ||
      remainingPath !== canonicalWorktree ||
      !isWithin(worktreesRoot, remainingPath) ||
      dirname(remainingPath) !== worktreesRoot ||
      registered.includes(remainingPath)
    ) {
      throw new GitWorkspaceError(
        "CONFLICT",
        "Git left a worktree path that failed cleanup validation.",
      );
    }
    await rm(remainingPath, { recursive: true, force: true });
  }
  await assertBaseIntegrity(workspace);
}
