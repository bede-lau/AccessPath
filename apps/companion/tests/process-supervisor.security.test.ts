import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CommandSpec } from "@accesspath/contracts";
import { afterEach, describe, expect, it } from "vitest";

import {
  createProcessSupervisor,
  validateConfiguredCommand,
} from "../src/process-supervisor";

const temporaryDirectories: string[] = [];

async function directory(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(path);
  return path;
}

function spec(
  executable: string,
  args: string[] = [],
  overrides: Partial<CommandSpec> = {},
): CommandSpec {
  return {
    id: "cmd-security",
    label: "Security fixture",
    executable,
    args,
    cwdRelative: ".",
    timeoutMs: 5_000,
    category: "test",
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      }),
    ),
  );
});

describe("process supervisor command policy", () => {
  it.each([
    ["shell executable", spec("cmd", ["/c", "echo ok"])],
    ["shell command string", spec("npm test")],
    ["shell metacharacter", spec("npm", ["run", "test && whoami"])],
    ["git push", spec("git", ["push", "origin", "main"])],
    ["git push behind options", spec("git", ["-C", ".", "push", "origin", "main"])],
    ["git remote mutation", spec("git", ["remote", "add", "x", "https://example.test"])],
    ["deployment", spec("vercel", ["deploy"])],
    ["package publishing", spec("npm", ["publish"])],
    ["credential access", spec("cmdkey", ["/list"])],
    ["system shutdown", spec("shutdown", ["-s"])],
    ["disk formatting", spec("format", ["C:"])],
    ["remote shell", spec("ssh", ["example.test"])],
    ["process control", spec("taskkill", ["/PID", "1"])],
    ["filesystem deletion", spec("rm", ["-rf", "."])],
    ["inline Node evaluation", spec(process.execPath, ["-e", "process.exit(0)"])],
  ])("rejects %s", async (_name, command) => {
    const root = await directory("accesspath-supervisor-policy-");
    await expect(validateConfiguredCommand(root, command)).rejects.toMatchObject({
      code: "COMMAND_DENIED",
    });
  });

  it("allows configured project formatting commands", async () => {
    const root = await directory("accesspath-supervisor-format-");
    await expect(
      validateConfiguredCommand(root, spec("prettier", ["--check", "."])),
    ).resolves.toMatchObject({ executable: "prettier" });
  });

  it("rejects unconfigured command mismatches and unsafe environment variables", async () => {
    const root = await directory("accesspath-supervisor-mismatch-");
    const configured = spec(process.execPath, ["--version"]);
    const runner = await createProcessSupervisor({
      worktreePath: root,
      commands: [configured],
    });

    await expect(
      runner.run({ ...configured, args: ["--help"] }),
    ).rejects.toMatchObject({ code: "COMMAND_MISMATCH" });
    await expect(
      createProcessSupervisor({
        worktreePath: root,
        commands: [configured],
        environment: { QODER_PERSONAL_ACCESS_TOKEN: "secret" },
        allowedEnvironmentKeys: ["QODER_PERSONAL_ACCESS_TOKEN"],
      }),
    ).rejects.toMatchObject({ code: "COMMAND_DENIED" });
  });

  it("rejects cwd traversal, argument path escape, and symlink or junction cwd", async () => {
    const root = await directory("accesspath-supervisor-path-");
    const outside = await directory("accesspath-supervisor-outside-");
    await mkdir(join(root, "project"));
    await symlink(
      outside,
      join(root, "escape"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await symlink(
      outside,
      join(root, "project", "escape"),
      process.platform === "win32" ? "junction" : "dir",
    );

    await expect(
      validateConfiguredCommand(
        root,
        spec(process.execPath, ["--version"], { cwdRelative: "../outside" }),
      ),
    ).rejects.toMatchObject({ code: "PATH_ESCAPE" });
    await expect(
      validateConfiguredCommand(root, spec(process.execPath, [outside])),
    ).rejects.toMatchObject({ code: "PATH_ESCAPE" });
    await expect(
      validateConfiguredCommand(
        root,
        spec(process.execPath, ["--version"], { cwdRelative: "escape" }),
      ),
    ).rejects.toMatchObject({ code: "PATH_ESCAPE" });
    await expect(
      validateConfiguredCommand(
        root,
        spec(process.execPath, ["escape/file.mjs"], {
          cwdRelative: "project",
        }),
      ),
    ).rejects.toMatchObject({ code: "PATH_ESCAPE" });
  });
});
