import {
  access,
  readFile,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  OWNERSHIP_MARKER,
  assertBaseIntegrity,
  cleanupWorkspace,
  getDiff,
  getStatus,
  getTreeSnapshot,
  prepareWorkspace,
  resolveWorkspacePath,
} from "../src/index";
import {
  cleanupTemporaryDirectories,
  createRepository,
  runGit,
} from "./helpers";

afterEach(cleanupTemporaryDirectories);

describe("real Git worktree lifecycle", () => {
  it("creates an isolated branch/worktree and reports status, diff, and tree snapshots", async () => {
    const fixture = await createRepository();
    const workspace = await prepareWorkspace(fixture.config, {
      artifactRoot: fixture.artifactRoot,
      repairId: "repair-001",
    });

    expect(workspace.branch).toBe("accesspath/repair-001");
    expect(workspace.baseCommit).toBe(fixture.baseCommit);
    expect(await runGit(workspace.worktreePath, "branch", "--show-current")).toBe(
      workspace.branch,
    );
    expect(await readFile(workspace.ownershipMarkerPath, "utf8")).toContain(
      `"owner":"@accesspath/git-workspace"`,
    );
    await expect(getStatus(workspace.worktreePath)).resolves.toMatchObject({
      branch: workspace.branch,
      head: fixture.baseCommit,
      clean: true,
      files: [],
    });

    await writeFile(
      join(workspace.worktreePath, "src", "app.ts"),
      "export const message = \"after\";\n",
    );
    await writeFile(join(workspace.worktreePath, "src", "new.ts"), "export {};\n");

    const status = await getStatus(workspace.worktreePath);
    expect(status.clean).toBe(false);
    expect(status.files.map((file) => file.path)).toEqual([
      "src/app.ts",
      "src/new.ts",
    ]);

    const diff = await getDiff(workspace);
    expect(diff.changedFiles).toEqual(["src/app.ts", "src/new.ts"]);
    expect(diff.patch).toContain('-export const message = "before";');
    expect(diff.patch).toContain('+export const message = "after";');
    expect(diff.patch).toContain("new file mode");
    expect(diff.patch).toContain("+export {};");
    expect(diff.stat).toContain("src/app.ts");
    expect(diff.stat).toContain("src/new.ts");

    const snapshot = await getTreeSnapshot(workspace.worktreePath);
    expect(snapshot.commit).toBe(fixture.baseCommit);
    expect(snapshot.entries.map((entry) => entry.path)).toContain("src/app.ts");
    expect(snapshot.entries.map((entry) => entry.path)).not.toContain("src/new.ts");

    await expect(
      resolveWorkspacePath(workspace, "src/new-file.ts"),
    ).resolves.toBe(join(workspace.worktreePath, "src", "new-file.ts"));
    await expect(assertBaseIntegrity(workspace)).resolves.toBeUndefined();
    expect(await runGit(fixture.repository, "status", "--porcelain")).toBe("");
    expect(await runGit(fixture.repository, "rev-parse", "HEAD")).toBe(
      fixture.baseCommit,
    );

    await expect(cleanupWorkspace(workspace)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await cleanupWorkspace(workspace, { force: true });
    await expect(access(workspace.worktreePath)).rejects.toThrow();
    await expect(
      runGit(
        fixture.repository,
        "rev-parse",
        "--verify",
        `refs/heads/${workspace.branch}`,
      ),
    ).rejects.toThrow();
    expect(await runGit(fixture.repository, "status", "--porcelain")).toBe("");
    expect(await runGit(fixture.repository, "rev-parse", "HEAD")).toBe(
      fixture.baseCommit,
    );
  }, 20_000);

  it("rejects active collisions and releases owned paths and refs on cleanup", async () => {
    const fixture = await createRepository();
    const workspace = await prepareWorkspace(fixture.config, {
      artifactRoot: fixture.artifactRoot,
      repairId: "repair-collision",
    });
    await expect(
      prepareWorkspace(fixture.config, {
        artifactRoot: fixture.artifactRoot,
        repairId: "repair-collision",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await cleanupWorkspace(workspace, { force: true });

    const replacement = await prepareWorkspace(fixture.config, {
      artifactRoot: fixture.artifactRoot,
      repairId: "repair-collision",
    });
    expect(replacement.branch).toBe(workspace.branch);
    await cleanupWorkspace(replacement);
  });

  it("cleans an unchanged owned worktree without a filesystem fallback", async () => {
    const fixture = await createRepository();
    const workspace = await prepareWorkspace(fixture.config, {
      artifactRoot: fixture.artifactRoot,
      repairId: "repair-clean-removal",
    });

    await cleanupWorkspace(workspace);
    await expect(access(workspace.worktreePath)).rejects.toThrow();
    await expect(
      runGit(
        fixture.repository,
        "rev-parse",
        "--verify",
        `refs/heads/${workspace.branch}`,
      ),
    ).rejects.toThrow();
    expect(await runGit(fixture.repository, "status", "--porcelain")).toBe("");
  });

  it("detects base checkout changes after workspace creation", async () => {
    const fixture = await createRepository();
    const workspace = await prepareWorkspace(fixture.config, {
      artifactRoot: fixture.artifactRoot,
      repairId: "repair-base-integrity",
    });
    const baseFile = join(fixture.repository, "README.md");
    const original = await readFile(baseFile, "utf8");
    await writeFile(baseFile, `${original}changed\n`);

    await expect(assertBaseIntegrity(workspace)).rejects.toMatchObject({
      code: "BASE_CHANGED",
    });
    await expect(
      cleanupWorkspace(workspace, { force: true }),
    ).rejects.toMatchObject({ code: "BASE_CHANGED" });

    await writeFile(baseFile, original);
    await cleanupWorkspace(workspace, { force: true });
  });

  it("requires an intact ownership marker before cleanup", async () => {
    const fixture = await createRepository();
    const workspace = await prepareWorkspace(fixture.config, {
      artifactRoot: fixture.artifactRoot,
      repairId: "repair-marker",
    });
    await writeFile(
      join(workspace.worktreePath, OWNERSHIP_MARKER),
      JSON.stringify({ owner: "someone-else" }),
    );
    await expect(
      cleanupWorkspace(workspace, { force: true }),
    ).rejects.toMatchObject({ code: "NOT_OWNED" });
    await expect(access(workspace.worktreePath)).resolves.toBeUndefined();
  });
});
