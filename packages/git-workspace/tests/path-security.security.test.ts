import {
  mkdir,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  cleanupWorkspace,
  prepareWorkspace,
  resolveWorkspacePath,
} from "../src/index";
import {
  cleanupTemporaryDirectories,
  createRepository,
  temporaryDirectory,
} from "./helpers";

afterEach(cleanupTemporaryDirectories);

describe("workspace path security", () => {
  it("rejects traversal, absolute paths, and symlink or junction escapes", async () => {
    const fixture = await createRepository();
    const workspace = await prepareWorkspace(fixture.config, {
      artifactRoot: fixture.artifactRoot,
      repairId: "repair-path-security",
    });
    const outside = await temporaryDirectory("accesspath-path-outside-");
    await writeFile(join(outside, "secret.txt"), "secret\n");
    const link = join(workspace.worktreePath, "escape");
    await symlink(
      outside,
      link,
      process.platform === "win32" ? "junction" : "dir",
    );

    await expect(
      resolveWorkspacePath(workspace, "../outside.txt"),
    ).rejects.toMatchObject({ code: "PATH_ESCAPE" });
    await expect(
      resolveWorkspacePath(workspace, "src/../README.md"),
    ).rejects.toMatchObject({ code: "PATH_ESCAPE" });
    await expect(
      resolveWorkspacePath(workspace, outside),
    ).rejects.toMatchObject({ code: "PATH_ESCAPE" });
    await expect(
      resolveWorkspacePath(workspace, "escape/secret.txt"),
    ).rejects.toMatchObject({ code: "PATH_ESCAPE" });

    await cleanupWorkspace(workspace, { force: true });
  }, 20_000);

  it("rejects artifact roots nested in the base checkout", async () => {
    const fixture = await createRepository();
    const nestedArtifactRoot = join(fixture.repository, "generated");
    await mkdir(nestedArtifactRoot);
    await expect(
      prepareWorkspace(fixture.config, {
        artifactRoot: nestedArtifactRoot,
        repairId: "repair-nested-root",
      }),
    ).rejects.toMatchObject({ code: "PATH_ESCAPE" });
  });
});
