import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  GitWorkspaceError,
  PACKAGE_NAME,
  captureBaseIntegrity,
  resolveRepositoryTopLevel,
  validateRepository,
  validateRepositoryConfig,
} from "../src/index";
import {
  cleanupTemporaryDirectories,
  createRepository,
  runGit,
  temporaryDirectory,
} from "./helpers";

afterEach(cleanupTemporaryDirectories);

describe("repository validation", () => {
  it("exports the package identity", () => {
    expect(PACKAGE_NAME).toBe("@accesspath/git-workspace");
  });

  it("resolves the actual Git top-level from nested directories and files", async () => {
    const fixture = await createRepository();
    const nested = join(fixture.repository, "src");
    const file = join(nested, "app.ts");

    await expect(resolveRepositoryTopLevel(nested)).resolves.toBe(
      fixture.repository,
    );
    await expect(resolveRepositoryTopLevel(file)).resolves.toBe(
      fixture.repository,
    );
    await expect(validateRepositoryConfig(fixture.config)).resolves.toMatchObject({
      repositoryRoot: fixture.repository,
      baseBranch: "main",
      baseCommit: fixture.baseCommit,
      clean: true,
    });
  });

  it("rejects non-repositories, dirty bases, and stale config identities", async () => {
    const outside = await temporaryDirectory("accesspath-not-git-");
    await expect(validateRepository(outside)).rejects.toMatchObject({
      code: "REPOSITORY_INVALID",
    });

    const fixture = await createRepository();
    await writeFile(join(fixture.repository, "untracked.txt"), "dirty\n");
    await expect(validateRepository(fixture.repository)).rejects.toMatchObject({
      code: "REPOSITORY_DIRTY",
    });

    const cleanFixture = await createRepository();
    await expect(
      validateRepositoryConfig({
        ...cleanFixture.config,
        baseBranch: "stale",
      }),
    ).rejects.toBeInstanceOf(GitWorkspaceError);
    await expect(
      validateRepositoryConfig({
        ...cleanFixture.config,
        baseCommit: "f".repeat(40),
      }),
    ).rejects.toMatchObject({ code: "REPOSITORY_INVALID" });

    const detachedFixture = await createRepository();
    await runGit(detachedFixture.repository, "checkout", "--detach");
    await expect(
      validateRepository(detachedFixture.repository),
    ).rejects.toMatchObject({ code: "REPOSITORY_INVALID" });
  });

  it("captures the authoritative base branch, commit, tree, and status", async () => {
    const fixture = await createRepository();
    await expect(captureBaseIntegrity(fixture.repository)).resolves.toMatchObject({
      branch: "main",
      commit: fixture.baseCommit,
      status: "",
    });
  });
});
