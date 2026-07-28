import type { RepositoryConfig } from "@accesspath/contracts";

export type GitWorkspaceErrorCode =
  | "REPOSITORY_INVALID"
  | "REPOSITORY_DIRTY"
  | "CONFLICT"
  | "PATH_ESCAPE"
  | "BASE_CHANGED"
  | "NOT_OWNED";

export class GitWorkspaceError extends Error {
  public constructor(
    public readonly code: GitWorkspaceErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export class WorkspacePathError extends GitWorkspaceError {
  public constructor(message: string) {
    super("PATH_ESCAPE", message);
  }
}

export type GitFileStatus = {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
  originalPath?: string;
};

export type GitStatusSnapshot = {
  branch: string;
  head: string;
  clean: boolean;
  files: GitFileStatus[];
};

export type GitDiffSnapshot = {
  baseCommit: string;
  patch: string;
  stat: string;
  changedFiles: string[];
};

export type GitTreeEntry = {
  mode: string;
  type: string;
  objectId: string;
  size?: number;
  path: string;
};

export type GitTreeSnapshot = {
  ref: string;
  commit: string;
  treeId: string;
  entries: GitTreeEntry[];
};

export type RepositoryValidation = {
  repositoryRoot: string;
  repositoryDisplayName: string;
  baseBranch: string;
  baseCommit: string;
  clean: true;
};

export type BaseIntegritySnapshot = {
  branch: string;
  commit: string;
  treeId: string;
  status: string;
};

export type PreparedWorkspace = {
  id: string;
  repositoryRoot: string;
  repositoryDisplayName: string;
  worktreePath: string;
  branch: string;
  baseBranch: string;
  baseCommit: string;
  artifactRoot: string;
  ownershipMarkerPath: string;
  config: RepositoryConfig;
  baseIntegrity: BaseIntegritySnapshot;
};

export type PrepareWorkspaceOptions = {
  artifactRoot: string;
  repairId: string;
};

export type CleanupWorkspaceOptions = {
  force?: boolean;
};
