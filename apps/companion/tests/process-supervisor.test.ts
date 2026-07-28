import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { CommandSpec } from "@accesspath/contracts";
import { afterEach, describe, expect, it } from "vitest";

import {
  createProcessSupervisor,
  type ProcessSupervisor,
} from "../src/process-supervisor";

const fixtureSource = fileURLToPath(
  new URL("./fixtures/process-tree.mjs", import.meta.url),
);
const temporaryDirectories: string[] = [];

async function worktree(): Promise<{
  root: string;
  fixture: string;
  subdirectory: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "accesspath-supervisor-"));
  temporaryDirectories.push(root);
  const fixture = join(root, basename(fixtureSource));
  const subdirectory = join(root, "project");
  await mkdir(subdirectory);
  await copyFile(fixtureSource, fixture);
  return { root, fixture, subdirectory };
}

function command(
  fixture: string,
  mode: string,
  value?: string,
  overrides: Partial<CommandSpec> = {},
): CommandSpec {
  return {
    id: `cmd-${mode}`,
    label: `Run ${mode}`,
    executable: process.execPath,
    args: [fixture, mode, ...(value === undefined ? [] : [value])],
    cwdRelative: ".",
    timeoutMs: 5_000,
    category: "test",
    ...overrides,
  };
}

async function supervisor(
  root: string,
  commands: CommandSpec[],
  options: {
    maxOutputBytes?: number;
    environment?: Record<string, string>;
    allowedEnvironmentKeys?: string[];
    killGraceMs?: number;
  } = {},
): Promise<ProcessSupervisor> {
  return createProcessSupervisor({
    worktreePath: root,
    commands,
    ...options,
  });
}

async function processIsAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function waitForFile(path: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await readFile(path);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error("Fixture marker was not created.");
}

async function waitForExit(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!(await processIsAlive(pid))) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Process ${pid} remained alive.`);
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      }),
    ),
  );
});

describe("process supervisor execution", () => {
  it("spawns the exact executable and arguments with canonical cwd and minimal env", async () => {
    const paths = await worktree();
    const spec = command(paths.fixture, "inspect", "literal argument", {
      cwdRelative: "project",
    });
    const runner = await supervisor(paths.root, [spec], {
      environment: { ACCESSPATH_TEST_PORT: "4812" },
      allowedEnvironmentKeys: ["ACCESSPATH_TEST_PORT"],
    });
    const chunks: string[] = [];

    const result = await runner.run(spec, {
      onOutput: ({ text }) => chunks.push(text),
    });

    expect(result).toMatchObject({
      commandId: spec.id,
      exitCode: 0,
      terminationReason: "completed",
      outputTruncated: false,
    });
    const observed = JSON.parse(result.stdout);
    expect(observed.argv).toEqual(["literal argument"]);
    expect(observed.cwd).toBe(paths.subdirectory);
    expect(observed.env.ACCESSPATH_TEST_PORT).toBe("4812");
    expect(observed.env.QODER_PERSONAL_ACCESS_TOKEN).toBeUndefined();
    expect(observed.env.NODE_OPTIONS).toBeUndefined();
    expect(chunks.join("")).toBe(result.stdout);
  });

  it("returns non-zero exits without shell interpretation", async () => {
    const paths = await worktree();
    const spec = command(paths.fixture, "exit", "7");
    const runner = await supervisor(paths.root, [spec]);

    await expect(runner.run(spec)).resolves.toMatchObject({
      exitCode: 7,
      terminationReason: "completed",
      stderr: "fixture failure",
    });
  });

  it("bounds combined output and terminates an overflowing process", async () => {
    const paths = await worktree();
    const spec = command(paths.fixture, "flood");
    const runner = await supervisor(paths.root, [spec], {
      maxOutputBytes: 8 * 1024,
      killGraceMs: 25,
    });

    const result = await runner.run(spec);
    expect(result.terminationReason).toBe("output-limit");
    expect(result.outputTruncated).toBe(true);
    expect(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr)).toBe(
      8 * 1024,
    );
    await waitForExit(result.pid);
  });

  it("terminates timed-out processes", async () => {
    const paths = await worktree();
    const spec = command(paths.fixture, "sleep", undefined, {
      timeoutMs: 150,
    });
    const runner = await supervisor(paths.root, [spec], { killGraceMs: 25 });

    const result = await runner.run(spec);
    expect(result.terminationReason).toBe("timeout");
    await waitForExit(result.pid);
  });

  it("cancels the full owned parent and grandchild tree", async () => {
    const paths = await worktree();
    const marker = join(paths.root, "tree.json");
    const spec = command(paths.fixture, "tree", marker, {
      timeoutMs: 10_000,
    });
    const runner = await supervisor(paths.root, [spec], { killGraceMs: 50 });
    const handle = await runner.start(spec);
    await waitForFile(marker);
    const tree = JSON.parse(await readFile(marker, "utf8")) as {
      parentPid: number;
      grandchildPid: number;
    };
    expect(tree.parentPid).toBe(handle.pid);
    expect(await processIsAlive(tree.grandchildPid)).toBe(true);

    await handle.cancel();
    const result = await handle.result;
    expect(result.terminationReason).toBe("cancelled");
    await waitForExit(tree.parentPid);
    await waitForExit(tree.grandchildPid);
  }, 20_000);
});
