import { execFile } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, "../..");
const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function runReset(
  artifactRoot: string,
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(
    process.execPath,
    ["--import", "tsx", "scripts/demo-reset.ts"],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        ACCESSPATH_ARTIFACT_ROOT: artifactRoot,
      },
      timeout: 30_000,
      windowsHide: true,
    },
  );
}

describe("demo:reset boundaries", () => {
  it("removes only AccessPath-owned mission artifacts", async () => {
    const artifactRoot = await temporaryDirectory("accesspath-reset-artifacts-");
    const sourceRoot = await temporaryDirectory("accesspath-reset-source-");
    const sourceFile = join(sourceRoot, "application.ts");
    await writeFile(sourceFile, "export const preserved = true;\n");
    await writeFile(
      join(artifactRoot, ".accesspath-demo-owned.json"),
      `${JSON.stringify({ schemaVersion: "1.0.0", owner: "accesspath-demo" })}\n`,
    );
    const sourceCacheRoot = `${artifactRoot}-sources`;
    await mkdir(join(sourceCacheRoot, "source-1"), { recursive: true });
    await writeFile(
      join(sourceCacheRoot, ".accesspath-source-cache-owner.json"),
      `${JSON.stringify({
        schemaVersion: "1.0.0",
        owner: "accesspath-source-cache",
      })}\n`,
    );
    await writeFile(join(sourceCacheRoot, "source-1", "snapshot.txt"), "owned");
    for (const directory of [
      "audits",
      "missions",
      "repairs",
      "sandboxes",
      "sources",
      "worktrees",
    ]) {
      await mkdir(join(artifactRoot, directory), { recursive: true });
      await writeFile(join(artifactRoot, directory, "owned.txt"), directory);
    }

    await expect(runReset(artifactRoot)).resolves.toMatchObject({
      stdout: expect.stringContaining("cleared AccessPath-owned"),
    });

    for (const directory of [
      "audits",
      "missions",
      "repairs",
      "sandboxes",
      "sources",
      "worktrees",
    ]) {
      await expect(access(join(artifactRoot, directory))).rejects.toThrow();
    }
    await expect(readFile(sourceFile, "utf8")).resolves.toBe(
      "export const preserved = true;\n",
    );
    await expect(access(sourceCacheRoot)).rejects.toThrow();
    await expect(
      readFile(join(artifactRoot, ".accesspath-demo-owned.json"), "utf8"),
    ).resolves.toContain('"owner":"accesspath-demo"');
  });

  it("refuses an unmarked non-empty directory", async () => {
    const artifactRoot = await temporaryDirectory("accesspath-reset-unowned-");
    const unownedFile = join(artifactRoot, "keep.txt");
    await writeFile(unownedFile, "keep\n");

    await expect(runReset(artifactRoot)).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "refused an unmarked non-empty artifact root",
      ),
    });
    await expect(readFile(unownedFile, "utf8")).resolves.toBe("keep\n");
  });
});
