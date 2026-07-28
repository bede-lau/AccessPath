import {
  lstat,
  mkdtemp,
  mkdir,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  atomicWriteFile,
  createAuditDirectoryLayout,
  resolveSafeRelativePath,
  validateArtifactRoot,
  validateRelativePath,
} from "../src/index";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix: string) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

describe("artifact root and safe path security", () => {
  it("requires an absolute artifact root outside the editable repository", async () => {
    const repository = await temporaryDirectory("accesspath-repo-security-");
    await expect(validateArtifactRoot("relative-artifacts", repository)).rejects.toThrow(
      /absolute/,
    );
    await expect(
      validateArtifactRoot(join(repository, ".accesspath"), repository),
    ).rejects.toThrow(/disjoint/);
    const encompassingRoot = dirname(repository);
    await expect(
      validateArtifactRoot(encompassingRoot, repository),
    ).rejects.toThrow(/disjoint/);
  });

  it("accepts and canonicalizes an external application-owned root", async () => {
    const repository = await temporaryDirectory("accesspath-repo-security-");
    const artifacts = await temporaryDirectory("accesspath-root-security-");
    const root = await validateArtifactRoot(artifacts, repository);
    expect(root).toBe(await (await import("node:fs/promises")).realpath(artifacts));
  });

  it.each([
    "../escape",
    "audits/../../escape",
    "/absolute/path",
    "\\\\server\\share",
    "C:\\Users\\person\\escape",
    "audits//double",
    ".",
  ])("rejects unsafe relative path %s", (path) => {
    expect(() => validateRelativePath(path)).toThrow(/Unsafe/);
  });

  it("resolves valid paths beneath the root", async () => {
    const root = await temporaryDirectory("accesspath-root-security-");
    expect(resolveSafeRelativePath(root, "audits/audit-1/bundle.json")).toBe(
      resolve(root, "audits", "audit-1", "bundle.json"),
    );
  });

  it("rejects a symlink or junction segment before writing", async () => {
    const root = await temporaryDirectory("accesspath-root-security-");
    const outside = await temporaryDirectory("accesspath-outside-security-");
    await mkdir(join(root, "audits"), { recursive: true });
    const linked = join(root, "audits", "linked");
    try {
      await symlink(outside, linked, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") {
        return;
      }
      throw error;
    }

    expect((await lstat(linked)).isSymbolicLink()).toBe(true);
    await expect(
      atomicWriteFile(root, "audits/linked/stolen.txt", "must not escape"),
    ).rejects.toThrow(/Symlinked/);
  });

  it("creates the required audit layout and leaves no temporary write file", async () => {
    const root = await temporaryDirectory("accesspath-root-security-");
    const layout = await createAuditDirectoryLayout(root, "audit-layout");
    await atomicWriteFile(root, "audits/audit-layout/bundle.json", "{}\n");
    expect(dirname(layout.bundlePath)).toBe(layout.auditDir);
    expect((await lstat(layout.bundlePath)).isFile()).toBe(true);
    const entries = await (await import("node:fs/promises")).readdir(layout.auditDir);
    expect(entries.some((entry) => entry.endsWith(".tmp"))).toBe(false);
  });
});
