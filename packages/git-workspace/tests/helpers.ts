import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type { RepositoryConfig } from "@accesspath/contracts";

const execFileAsync = promisify(execFile);
export const temporaryDirectories: string[] = [];

export async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

export async function cleanupTemporaryDirectories(): Promise<void> {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) =>
        rm(directory, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 100,
        }),
      ),
  );
}

export async function runGit(
  cwd: string,
  ...args: string[]
): Promise<string> {
  const result = await execFileAsync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    windowsHide: true,
  });
  return result.stdout.trim();
}

export async function createRepository(): Promise<{
  repository: string;
  artifactRoot: string;
  baseCommit: string;
  config: RepositoryConfig;
}> {
  const repository = await temporaryDirectory("accesspath-git-base-");
  const artifactRoot = await temporaryDirectory("accesspath-git-artifacts-");
  await runGit(repository, "init", "-b", "main");
  await runGit(repository, "config", "user.name", "AccessPath Tests");
  await runGit(repository, "config", "user.email", "accesspath@example.test");
  await mkdir(join(repository, "src"));
  await writeFile(
    join(repository, "src", "app.ts"),
    "export const message = \"before\";\n",
  );
  await writeFile(join(repository, "README.md"), "# Fixture\n");
  await runGit(repository, "add", ".");
  await runGit(repository, "commit", "-m", "fixture baseline");
  const baseCommit = await runGit(repository, "rev-parse", "HEAD");
  return {
    repository,
    artifactRoot,
    baseCommit,
    config: {
      repositoryPath: repository,
      baseBranch: "main",
      baseCommit,
      startCommand: {
        id: "cmd-start",
        label: "Start",
        executable: "npm",
        args: ["run", "dev"],
        cwdRelative: ".",
        timeoutMs: 30_000,
        category: "start",
      },
      testCommands: [
        {
          id: "cmd-test",
          label: "Test",
          executable: "npm",
          args: ["test"],
          cwdRelative: ".",
          timeoutMs: 30_000,
          category: "test",
        },
      ],
      previewUrl: "http://127.0.0.1:4173",
      allowedPathGlobs: ["src/**"],
    },
  };
}
