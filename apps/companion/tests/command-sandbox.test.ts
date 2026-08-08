import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CommandSpec } from "@accesspath/contracts";
import { afterEach, describe, expect, it } from "vitest";

import {
  DockerCommandSandbox,
  type DockerInvocationResult,
  type DockerRunOptions,
  type DockerRunner,
} from "../src/command-sandbox";

const IMAGE = `example.test/accesspath@sha256:${"a".repeat(64)}`;
const temporaryDirectories: string[] = [];

function result(
  overrides: Partial<DockerInvocationResult> = {},
): DockerInvocationResult {
  return {
    exitCode: 0,
    stdout: "",
    stderr: "",
    startedAt: "2026-07-30T00:00:00.000Z",
    completedAt: "2026-07-30T00:00:00.001Z",
    durationMs: 1,
    terminationReason: "completed",
    outputTruncated: false,
    ...overrides,
  };
}

class FakeDockerRunner implements DockerRunner {
  public readonly calls: Array<{
    args: readonly string[];
    options: DockerRunOptions;
  }> = [];

  public constructor(
    private readonly respond: (
      args: readonly string[],
      options: DockerRunOptions,
    ) => DockerInvocationResult | Promise<DockerInvocationResult> = (args) => {
      if (args[0] === "create") {
        return result({ stdout: "container-123\n" });
      }
      if (args[0] === "exec" && args.includes("npm")) {
        return result({ stdout: `${args.at(-1)}\n` });
      }
      return result();
    },
  ) {}

  public async run(
    args: readonly string[],
    options: DockerRunOptions,
  ): Promise<DockerInvocationResult> {
    this.calls.push({ args: [...args], options });
    return this.respond(args, options);
  }
}

async function directory(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(path);
  return path;
}

function command(
  id: string,
  args: string[],
  overrides: Partial<CommandSpec> = {},
): CommandSpec {
  return {
    id,
    label: id,
    executable: "npm",
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
      rm(path, { recursive: true, force: true }),
    ),
  );
});

describe("DockerCommandSandbox", () => {
  it("returns an explicit report-only capability when Docker is unavailable", async () => {
    const runner = new FakeDockerRunner(() =>
      result({
        exitCode: null,
        stderr: "spawn docker ENOENT",
        terminationReason: "spawn-failed",
      }),
    );
    const sandbox = new DockerCommandSandbox({ dockerRunner: runner, image: IMAGE });

    await expect(
      sandbox.execute({
        sourceDirectory: await directory("accesspath-sandbox-source-"),
        command: command("test", ["test"]),
      }),
    ).resolves.toMatchObject({
      status: "report-only",
      capability: {
        mode: "report-only",
        cliAvailable: false,
        daemonAvailable: false,
        reason: "Docker CLI is unavailable.",
      },
      results: [],
    });
  });

  it("distinguishes an unavailable daemon from an unavailable CLI", async () => {
    const runner = new FakeDockerRunner((args) =>
      args[0] === "info"
        ? result({ exitCode: 1, stderr: "daemon offline" })
        : result({ stdout: "27.0.0\n" }),
    );
    const sandbox = new DockerCommandSandbox({ dockerRunner: runner, image: IMAGE });

    await expect(sandbox.preflight()).resolves.toMatchObject({
      mode: "report-only",
      cliAvailable: true,
      daemonAvailable: false,
      reason: "Docker daemon is unavailable: daemon offline",
    });
  });

  it("does not pull a missing sandbox image during mission preflight", async () => {
    const runner = new FakeDockerRunner((args) =>
      args[0] === "image"
        ? result({ exitCode: 1, stderr: "No such image" })
        : result({ stdout: "29.0.0\n" }),
    );
    const sandbox = new DockerCommandSandbox({ dockerRunner: runner, image: IMAGE });

    await expect(sandbox.preflight()).resolves.toMatchObject({
      mode: "report-only",
      cliAvailable: true,
      daemonAvailable: true,
      reason: expect.stringContaining("will not pull an image"),
    });
    expect(
      runner.calls.some(({ args }) => args[0] === "pull"),
    ).toBe(false);
  });

  it("copies sanitized source and runs command, preview, and replay exactly in one constrained container", async () => {
    const source = await directory("accesspath-sandbox-source-");
    const artifacts = await directory("accesspath-sandbox-artifacts-");
    await mkdir(join(source, "src"));
    await writeFile(join(source, "src", "index.ts"), "export {};\n");
    await writeFile(join(source, ".env"), "TOKEN=secret\n");
    let stagedSource: string | undefined;
    const runner = new FakeDockerRunner(async (args) => {
      if (args[0] === "create") {
        return result({ stdout: "container-123\n" });
      }
      if (args[0] === "cp" && String(args[1]).includes("sandbox-source")) {
        stagedSource = String(args[1]).slice(0, -2);
        await expect(readFile(join(stagedSource, "src", "index.ts"), "utf8"))
          .resolves.toBe("export {};\n");
        await expect(readFile(join(stagedSource, ".env"), "utf8"))
          .rejects.toMatchObject({ code: "ENOENT" });
      }
      return result();
    });
    const sandbox = new DockerCommandSandbox({
      dockerRunner: runner,
      image: IMAGE,
      cpuLimit: 1.5,
      memoryBytes: 256 * 1024 * 1024,
      pidsLimit: 32,
      maxOutputBytes: 4096,
    });
    const main = command("test", ["test", "--", "literal argument"], {
      cwdRelative: "src",
    });
    const preview = command("preview", ["run", "preview"], {
      category: "start",
    });
    const replay = command("replay", ["run", "replay"]);

    const report = await sandbox.execute({
      sourceDirectory: source,
      command: main,
      previewCommand: preview,
      previewUrl: "http://127.0.0.1:4173/",
      replayCommand: replay,
      evidenceContext: {
        schemaVersion: "1.0.0",
        missionId: "mission-sandbox-contract",
      },
      artifactDirectory: artifacts,
    });

    expect(report).toMatchObject({
      status: "completed",
      containerId: "container-123",
      artifactDirectory: artifacts,
      results: [
        { phase: "command", command: main },
        { phase: "preview", command: preview },
        { phase: "replay", command: replay },
      ],
    });
    const create = runner.calls.find(({ args }) => args[0] === "create")?.args;
    expect(create).toEqual([
      "create",
      "--network",
      "none",
      "--cpus",
      "1.5",
      "--memory",
      String(256 * 1024 * 1024),
      "--pids-limit",
      "32",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--env",
      "HOME=/tmp/accesspath-empty-home",
      "--workdir",
      "/workspace",
      "--entrypoint",
      "sleep",
      IMAGE,
      "infinity",
    ]);
    const executions = runner.calls.filter(
      ({ args }) => args[0] === "exec" && args.includes("npm"),
    );
    expect(executions.map(({ args }) => args)).toEqual([
      [
        "exec",
        "--workdir",
        "/workspace/src",
        "container-123",
        "/usr/bin/env",
        "-i",
        "HOME=/tmp/accesspath-empty-home",
        "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        "PLAYWRIGHT_BROWSERS_PATH=/ms-playwright",
        "ACCESSPATH_ARTIFACT_DIRECTORY=/artifacts",
        "ACCESSPATH_AUDIT_BUNDLE_PATH=/artifacts/accesspath-audit-bundle.json",
        "ACCESSPATH_MISSION_CONTEXT=/artifacts/accesspath-mission-context.json",
        "npm",
        "test",
        "--",
        "literal argument",
      ],
      [
        "exec",
        "--detach",
        "--workdir",
        "/workspace",
        "container-123",
        "/usr/bin/env",
        "-i",
        "HOME=/tmp/accesspath-empty-home",
        "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        "PLAYWRIGHT_BROWSERS_PATH=/ms-playwright",
        "ACCESSPATH_ARTIFACT_DIRECTORY=/artifacts",
        "ACCESSPATH_AUDIT_BUNDLE_PATH=/artifacts/accesspath-audit-bundle.json",
        "ACCESSPATH_MISSION_CONTEXT=/artifacts/accesspath-mission-context.json",
        "npm",
        "run",
        "preview",
      ],
      [
        "exec",
        "--workdir",
        "/workspace",
        "container-123",
        "/usr/bin/env",
        "-i",
        "HOME=/tmp/accesspath-empty-home",
        "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        "PLAYWRIGHT_BROWSERS_PATH=/ms-playwright",
        "ACCESSPATH_ARTIFACT_DIRECTORY=/artifacts",
        "ACCESSPATH_AUDIT_BUNDLE_PATH=/artifacts/accesspath-audit-bundle.json",
        "ACCESSPATH_MISSION_CONTEXT=/artifacts/accesspath-mission-context.json",
        "npm",
        "run",
        "replay",
      ],
    ]);
    expect(executions.map(({ options }) => options.maxOutputBytes)).toEqual([
      4096,
      4096,
      4096,
    ]);
    expect(
      runner.calls.some(
        ({ args }) =>
          args[0] === "exec" &&
          args.includes("node") &&
          args.includes("http://127.0.0.1:4173/"),
      ),
    ).toBe(true);
    expect(stagedSource).toBeDefined();
    await expect(
      readFile(join(artifacts, "accesspath-mission-context.json"), "utf8"),
    ).resolves.toContain('"missionId": "mission-sandbox-contract"');
    expect(
      runner.calls.some(
        ({ args }) =>
          args[0] === "cp" &&
          args.at(-1) ===
            "container-123:/artifacts/accesspath-mission-context.json",
      ),
    ).toBe(true);
    expect(runner.calls.at(-1)?.args).toEqual([
      "rm",
      "--force",
      "container-123",
    ]);
    expect(JSON.parse(await readFile(join(artifacts, "command-results.json"), "utf8")))
      .toHaveLength(3);
  });

  it.each([
    ["timeout", "timeout"],
    ["cancel", "cancelled"],
    ["output", "output-limit"],
  ] as const)("force-removes the container after %s", async (_name, reason) => {
    const source = await directory("accesspath-sandbox-source-");
    const runner = new FakeDockerRunner((args) => {
      if (args[0] === "create") {
        return result({ stdout: "container-timeout\n" });
      }
      if (args[0] === "exec" && args.includes("npm")) {
        return result({
          exitCode: null,
          terminationReason: reason,
          outputTruncated: reason === "output-limit",
        });
      }
      return result();
    });
    const sandbox = new DockerCommandSandbox({ dockerRunner: runner, image: IMAGE });

    const report = await sandbox.execute({
      sourceDirectory: source,
      command: command("test", ["test"]),
    });

    expect(report.results).toHaveLength(1);
    expect(report.results[0]?.terminationReason).toBe(reason);
    expect(runner.calls.at(-1)?.args).toEqual([
      "rm",
      "--force",
      "container-timeout",
    ]);
  });

  it("requires a digest-pinned image and bounded command working directory", async () => {
    expect(
      () => new DockerCommandSandbox({ image: "node:latest" }),
    ).toThrow("pinned by sha256 digest");
    expect(
      () =>
        new DockerCommandSandbox({
          dockerRunner: new FakeDockerRunner(),
          image: `sha256:${"b".repeat(64)}`,
        }),
    ).not.toThrow();

    const source = await directory("accesspath-sandbox-source-");
    const sandbox = new DockerCommandSandbox({
      dockerRunner: new FakeDockerRunner(),
      image: IMAGE,
    });
    await expect(
      sandbox.execute({
        sourceDirectory: source,
        command: command("escape", ["test"], { cwdRelative: "../outside" }),
      }),
    ).rejects.toThrow("working directory");
  });
});
