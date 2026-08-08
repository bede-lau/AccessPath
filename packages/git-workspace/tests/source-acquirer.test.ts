import { createHash } from "node:crypto";
import {
  access,
  lstat,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { lookupMock } = vi.hoisted(() => ({
  lookupMock: vi.fn(),
}));

vi.mock("node:dns/promises", () => ({
  lookup: lookupMock,
}));

import {
  SourceAcquirer,
  SourceAcquisitionError,
  cleanupWorkspace,
  prepareWorkspace,
} from "../src/index";
import {
  cleanupTemporaryDirectories,
  createRepository,
  runGit,
  temporaryDirectory,
} from "./helpers";

afterEach(cleanupTemporaryDirectories);
beforeEach(() => {
  lookupMock.mockReset();
});

type GitInvocation = {
  executable: string;
  args: string[];
  options: {
    env?: NodeJS.ProcessEnv;
  };
};

async function capturePublicFetchInvocation(
  repositoryUrl: string,
): Promise<GitInvocation[]> {
  const invocations: GitInvocation[] = [];
  const execFileMock = vi.fn(
    (
      executable: string,
      args: string[],
      options: GitInvocation["options"],
      callback: (
        error: (Error & { stderr?: string }) | null,
        stdout: string,
        stderr: string,
      ) => void,
    ) => {
      invocations.push({ executable, args: [...args], options });
      if (args.includes("fetch")) {
        const error = Object.assign(new Error("fetch stopped by test runner"), {
          stderr: "fetch stopped by test runner",
        });
        callback(error, "", error.stderr);
        return;
      }
      callback(null, "", "");
    },
  );

  vi.resetModules();
  vi.doMock("node:child_process", () => ({
    execFile: execFileMock,
  }));
  try {
    const { SourceAcquirer: IsolatedSourceAcquirer } = await import(
      "../src/source-acquirer"
    );
    const cacheRoot = await temporaryDirectory("accesspath-source-cache-");
    const acquirer = new IsolatedSourceAcquirer({ cacheRoot });

    await expect(
      acquirer.acquire({
        kind: "public",
        repositoryUrl,
        commit: "a".repeat(40),
      }),
    ).rejects.toMatchObject({ code: "SOURCE_FETCH_FAILED" });
  } finally {
    vi.doUnmock("node:child_process");
    vi.resetModules();
  }

  return invocations;
}

async function gitMetadataFingerprint(repository: string): Promise<string> {
  const gitDirectory = await runGit(repository, "rev-parse", "--git-dir");
  const absoluteGitDirectory = join(repository, gitDirectory);
  const hash = createHash("sha256");

  async function visit(directory: string, prefix = ""): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (["logs", "index.lock"].includes(entry.name)) {
        continue;
      }
      const path = join(directory, entry.name);
      const relativePath = `${prefix}${entry.name}`;
      if (entry.isDirectory()) {
        await visit(path, `${relativePath}/`);
      } else if (entry.isFile()) {
        hash.update(relativePath);
        hash.update(await readFile(path));
      }
    }
  }

  await visit(absoluteGitDirectory);
  return hash.digest("hex");
}

describe("SourceAcquirer local snapshots", () => {
  it("clones a clean local repository at its exact commit", async () => {
    const fixture = await createRepository();
    const acquirer = new SourceAcquirer({
      cacheRoot: fixture.artifactRoot,
      now: () => new Date("2026-07-30T10:00:00.000Z"),
    });

    const acquired = await acquirer.acquire({
      kind: "local",
      repositoryPath: join(fixture.repository, "src"),
    });

    expect(acquired.snapshot).toMatchObject({
      sourceCommit: fixture.baseCommit,
      snapshotCommit: fixture.baseCommit,
      dirty: false,
      repositoryDisplayName: expect.stringContaining("accesspath-git-base-"),
      fileCount: 2,
      acquiredAt: "2026-07-30T10:00:00.000Z",
    });
    expect(await readFile(join(acquired.repositoryPath, "src", "app.ts"), "utf8"))
      .toBe('export const message = "before";\n');
    expect(await runGit(acquired.repositoryPath, "status", "--porcelain")).toBe(
      "",
    );
    expect(await runGit(acquired.repositoryPath, "rev-parse", "HEAD")).toBe(
      fixture.baseCommit,
    );
  });

  it("captures tracked current bytes and nonignored untracked files without mutating source Git metadata", async () => {
    const fixture = await createRepository();
    await writeFile(
      join(fixture.repository, ".gitignore"),
      "ignored.txt\n",
    );
    await runGit(fixture.repository, "add", ".gitignore");
    await runGit(fixture.repository, "commit", "-m", "add ignore rules");
    const sourceCommit = await runGit(fixture.repository, "rev-parse", "HEAD");
    await writeFile(
      join(fixture.repository, "src", "app.ts"),
      'export const message = "dirty";\n',
    );
    await writeFile(join(fixture.repository, "src", "new.ts"), "export {};\n");
    await writeFile(join(fixture.repository, "ignored.txt"), "private\n");

    const statusBefore = await runGit(
      fixture.repository,
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
    );
    const metadataBefore = await gitMetadataFingerprint(fixture.repository);
    const acquirer = new SourceAcquirer({ cacheRoot: fixture.artifactRoot });
    const acquired = await acquirer.acquire({
      kind: "local",
      repositoryPath: fixture.repository,
    });

    expect(acquired.snapshot.dirty).toBe(true);
    expect(acquired.snapshot.sourceCommit).toBe(sourceCommit);
    expect(acquired.snapshot.snapshotCommit).not.toBe(sourceCommit);
    expect(await readFile(join(acquired.repositoryPath, "src", "app.ts"), "utf8"))
      .toBe('export const message = "dirty";\n');
    expect(await readFile(join(acquired.repositoryPath, "src", "new.ts"), "utf8"))
      .toBe("export {};\n");
    await expect(
      access(join(acquired.repositoryPath, "ignored.txt")),
    ).rejects.toThrow();
    expect(
      await runGit(
        fixture.repository,
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
      ),
    ).toBe(statusBefore);
    expect(await runGit(fixture.repository, "rev-parse", "HEAD")).toBe(
      sourceCommit,
    );
    expect(await gitMetadataFingerprint(fixture.repository)).toBe(
      metadataBefore,
    );

    await rm(fixture.repository, { recursive: true, force: true });
    await expect(
      runGit(acquired.repositoryPath, "fsck", "--full", "--no-dangling"),
    ).resolves.toBe("");
    await expect(
      access(join(acquired.repositoryPath, ".git", "objects", "info", "alternates")),
    ).rejects.toThrow();

    const workspaceArtifactRoot = await temporaryDirectory(
      "accesspath-acquired-workspace-",
    );
    const workspace = await prepareWorkspace(
      {
        repositoryPath: acquired.repositoryPath,
        baseBranch: "accesspath-snapshot",
        baseCommit: acquired.snapshot.snapshotCommit,
        startCommand: {
          id: "command-start",
          label: "Start",
          executable: "npm",
          args: ["run", "dev"],
          cwdRelative: ".",
          timeoutMs: 30_000,
          category: "start",
        },
        testCommands: [],
        previewUrl: "http://127.0.0.1:4173",
        allowedPathGlobs: ["src/**"],
      },
      {
        artifactRoot: workspaceArtifactRoot,
        repairId: "acquired-dirty",
      },
    );
    expect(
      (
        await readFile(join(workspace.worktreePath, "src", "app.ts"), "utf8")
      ).replaceAll("\r\n", "\n"),
    ).toBe('export const message = "dirty";\n');
    await cleanupWorkspace(workspace);
  });

  it("aborts deterministically when the local checkout changes before the post-copy manifest", async () => {
    const fixture = await createRepository();
    const sourceFile = join(fixture.repository, "src", "app.ts");
    const acquirer = new SourceAcquirer({
      cacheRoot: fixture.artifactRoot,
      beforeConsistencyCheck: async () => {
        await writeFile(
          sourceFile,
          'export const message = "changed concurrently";\n',
        );
      },
    });

    await expect(
      acquirer.acquire({
        kind: "local",
        repositoryPath: fixture.repository,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_CHANGED" });
    expect(await readdir(fixture.artifactRoot)).toEqual([
      ".accesspath-source-cache-owner.json",
    ]);
  });

  it("rejects an oversized added file and removes the incomplete cache entry", async () => {
    const fixture = await createRepository();
    await writeFile(join(fixture.repository, "large.bin"), Buffer.alloc(33));
    const acquirer = new SourceAcquirer({
      cacheRoot: fixture.artifactRoot,
      maxAddedFileBytes: 32,
    });

    await expect(
      acquirer.acquire({
        kind: "local",
        repositoryPath: fixture.repository,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_TOO_LARGE" });
    expect(await readdir(fixture.artifactRoot)).toEqual([
      ".accesspath-source-cache-owner.json",
    ]);
  });

  it("rejects symlinks that resolve outside the source repository", async (context) => {
    const fixture = await createRepository();
    const external = await temporaryDirectory("accesspath-source-external-");
    await writeFile(join(external, "secret.txt"), "secret\n");
    const linkPath = join(fixture.repository, "escape.txt");
    try {
      await symlink(join(external, "secret.txt"), linkPath);
      expect((await lstat(linkPath)).isSymbolicLink()).toBe(true);
    } catch (fileSymlinkError) {
      try {
        await symlink(external, linkPath, "junction");
        expect((await lstat(linkPath)).isSymbolicLink()).toBe(true);
      } catch (junctionError) {
        context.skip(
          `Symlink creation is unavailable: ${String(fileSymlinkError)}; ${String(
            junctionError,
          )}`,
        );
        return;
      }
    }

    const acquirer = new SourceAcquirer({ cacheRoot: fixture.artifactRoot });
    await expect(
      acquirer.acquire({
        kind: "local",
        repositoryPath: fixture.repository,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_SYMLINK_ESCAPE" });
  });

  it("rejects non-HTTPS and credential-bearing public source URLs", async () => {
    const cacheRoot = await temporaryDirectory("accesspath-source-cache-");
    const acquirer = new SourceAcquirer({ cacheRoot });

    for (const repositoryUrl of [
      "http://example.test/project.git",
      "https://token@example.test/project.git",
      "https://example.test/project.git?token=secret",
    ]) {
      await expect(
        acquirer.acquire({
          kind: "public",
          repositoryUrl,
          commit: "a".repeat(40),
        }),
      ).rejects.toMatchObject({ code: "SOURCE_INVALID" });
    }
    expect(await readdir(cacheRoot)).toEqual([]);
  });

  it.each([
    "https://0.0.0.0/project.git",
    "https://127.0.0.1/project.git",
    "https://10.20.30.40/project.git",
    "https://169.254.169.254/project.git",
    "https://192.168.1.10/project.git",
    "https://224.0.0.1/project.git",
    "https://240.0.0.1/project.git",
    "https://[::]/project.git",
    "https://[::1]/project.git",
    "https://[2001:db8::1]/project.git",
    "https://[fc00::1]/project.git",
    "https://[fe80::1]/project.git",
    "https://[ff00::1]/project.git",
  ])("rejects non-public literal source address %s", async (repositoryUrl) => {
    const cacheRoot = await temporaryDirectory("accesspath-source-cache-");
    const acquirer = new SourceAcquirer({ cacheRoot });

    await expect(
      acquirer.acquire({
        kind: "public",
        repositoryUrl,
        commit: "a".repeat(40),
      }),
    ).rejects.toMatchObject({ code: "SOURCE_INVALID" });
    expect(lookupMock).not.toHaveBeenCalled();
    expect(await readdir(cacheRoot)).toEqual([]);
  });

  it("rejects a hostname that resolves to a private address without invoking Git", async () => {
    lookupMock.mockResolvedValueOnce([
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.8", family: 4 },
    ]);
    const cacheRoot = await temporaryDirectory("accesspath-source-cache-");
    const acquirer = new SourceAcquirer({ cacheRoot });

    await expect(
      acquirer.acquire({
        kind: "public",
        repositoryUrl: "https://repository.example.test/project.git",
        commit: "a".repeat(40),
      }),
    ).rejects.toMatchObject({ code: "SOURCE_INVALID" });
    expect(lookupMock).toHaveBeenCalledWith("repository.example.test", {
      all: true,
      verbatim: true,
    });
    expect(await readdir(cacheRoot)).toEqual([]);
  });

  it("passes pinned DNS resolution and hardened HTTP settings to Git fetch", async () => {
    lookupMock.mockResolvedValueOnce([
      { address: "93.184.216.34", family: 4 },
      {
        address: "2606:2800:220:1:248:1893:25c8:1946",
        family: 6,
      },
    ]);
    const environmentNames = [
      "ALL_PROXY",
      "HTTP_PROXY",
      "HTTPS_PROXY",
      "NO_PROXY",
      "GIT_CONFIG_PARAMETERS",
      "GIT_CONFIG_KEY_7",
      "GIT_CONFIG_VALUE_7",
    ] as const;
    const originalEnvironment = new Map(
      environmentNames.map((name) => [name, process.env[name]]),
    );
    for (const name of environmentNames) {
      process.env[name] = `untrusted-${name.toLowerCase()}`;
    }

    let invocations: GitInvocation[];
    try {
      invocations = await capturePublicFetchInvocation(
        "https://repository.example.test:8443/project.git",
      );
    } finally {
      for (const [name, value] of originalEnvironment) {
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      }
    }

    const fetchInvocation = invocations.find(({ args }) =>
      args.includes("fetch"),
    );
    expect(fetchInvocation).toBeDefined();
    const configValues = fetchInvocation!.args.flatMap((argument, index, args) =>
      argument === "-c" && args[index + 1] !== undefined
        ? [args[index + 1]!]
        : [],
    );
    expect(configValues).toContain("http.followRedirects=false");
    expect(configValues).toContain("http.proxy=");
    expect(configValues).toContain("http.curloptResolve=");
    expect(configValues).toContain(
      "http.curloptResolve=repository.example.test:8443:93.184.216.34,[2606:2800:220:1:248:1893:25c8:1946]",
    );
    expect(fetchInvocation!.args).toEqual(
      expect.arrayContaining([
        "--no-recurse-submodules",
        "--",
        "https://repository.example.test:8443/project.git",
        "a".repeat(40),
      ]),
    );
    expect(fetchInvocation!.executable).toBe("git");

    const gitEnvironment = fetchInvocation!.options.env;
    expect(gitEnvironment).toMatchObject({
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_COUNT: "0",
      GIT_TERMINAL_PROMPT: "0",
      GIT_ASKPASS: "",
      SSH_ASKPASS: "",
    });
    const normalizedEnvironmentNames = Object.keys(gitEnvironment ?? {}).map(
      (name) => name.toLowerCase(),
    );
    expect(normalizedEnvironmentNames).not.toEqual(
      expect.arrayContaining([
        "all_proxy",
        "http_proxy",
        "https_proxy",
        "no_proxy",
        "git_config_parameters",
        "git_config_key_7",
        "git_config_value_7",
      ]),
    );
  });

  it("pins the validated DNS answer so a later private rebinding answer is unused", async () => {
    lookupMock
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);

    const invocations = await capturePublicFetchInvocation(
      "https://repository.example.test/project.git",
    );

    expect(lookupMock).toHaveBeenCalledTimes(1);
    const fetchInvocation = invocations.find(({ args }) =>
      args.includes("fetch"),
    );
    expect(fetchInvocation).toBeDefined();
    expect(fetchInvocation!.args).toContain(
      "http.curloptResolve=repository.example.test:443:93.184.216.34",
    );
    expect(fetchInvocation!.args.join("\n")).not.toContain("127.0.0.1");
  });

  it("rejects invalid acquisition bounds explicitly", async () => {
    const cacheRoot = await temporaryDirectory("accesspath-source-cache-");
    expect(
      () => new SourceAcquirer({ cacheRoot, maxPayloadBytes: 0 }),
    ).toThrowError(
      expect.objectContaining({ code: "SOURCE_INVALID" }),
    );
  });

  it("refuses a non-empty cache root without an AccessPath ownership marker", async () => {
    const cacheRoot = await temporaryDirectory("accesspath-source-cache-");
    await writeFile(join(cacheRoot, "keep.txt"), "not owned\n");
    const fixture = await createRepository();
    const acquirer = new SourceAcquirer({ cacheRoot });

    await expect(
      acquirer.acquire({
        kind: "local",
        repositoryPath: fixture.repository,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_INVALID" });
    await expect(readFile(join(cacheRoot, "keep.txt"), "utf8")).resolves.toBe(
      "not owned\n",
    );
  });

  it("exposes stable explicit acquisition error codes", () => {
    const error = new SourceAcquisitionError(
      "SOURCE_CHANGED",
      "Source changed.",
    );
    expect(error).toMatchObject({
      code: "SOURCE_CHANGED",
      message: "Source changed.",
    });
  });
});
