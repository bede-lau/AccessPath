import {
  spawn,
  type ChildProcess,
} from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  basename,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import {
  CommandSpecSchema,
  type CommandSpec,
} from "@accesspath/contracts";

const DEFAULT_CPU_LIMIT = 1;
const DEFAULT_MEMORY_BYTES = 512 * 1024 * 1024;
const DEFAULT_PIDS_LIMIT = 512;
const DEFAULT_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_MAX_TIMEOUT_MS = 15 * 60 * 1000;
const CONTROL_TIMEOUT_MS = 30_000;
const PREVIEW_READY_TIMEOUT_MS = 30_000;
const PREVIEW_READY_INTERVAL_MS = 200;
const CONTAINER_WORKSPACE = "/workspace";
const CONTAINER_ARTIFACTS = "/artifacts";
const EMPTY_HOME = "/tmp/accesspath-empty-home";

const CREDENTIAL_NAMES = new Set([
  ".aws",
  ".azure",
  ".docker",
  ".git",
  ".gitconfig",
  ".gnupg",
  ".kube",
  ".netrc",
  ".npmrc",
  ".pypirc",
  ".ssh",
  "_netrc",
  "credentials",
]);

const CREDENTIAL_FILE_PATTERN =
  /^(?:\.env(?:\..+)?|.*\.(?:key|pem|p12|pfx)|id_(?:dsa|ecdsa|ed25519|rsa))$/i;

export type SandboxCapabilityMode = "execute" | "report-only";

export interface CommandSandboxCapability {
  mode: SandboxCapabilityMode;
  cliAvailable: boolean;
  daemonAvailable: boolean;
  image: string;
  reason?: string;
}

export type SandboxTerminationReason =
  | "completed"
  | "cancelled"
  | "timeout"
  | "output-limit"
  | "spawn-failed";

export interface DockerInvocationResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  terminationReason: SandboxTerminationReason;
  outputTruncated: boolean;
}

export interface DockerRunOptions {
  signal?: AbortSignal;
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface DockerRunner {
  run(args: readonly string[], options: DockerRunOptions): Promise<DockerInvocationResult>;
}

export interface SandboxCommandResult extends DockerInvocationResult {
  command: CommandSpec;
  phase: "command" | "preview" | "replay";
}

export interface CommandSandboxRequest {
  sourceDirectory: string;
  command: CommandSpec;
  previewCommand?: CommandSpec;
  previewUrl?: string;
  replayCommand?: CommandSpec;
  evidenceContext?: Readonly<Record<string, unknown>>;
  artifactDirectory?: string;
  signal?: AbortSignal;
}

export interface CommandSandboxReport {
  capability: CommandSandboxCapability;
  status: "completed" | "report-only";
  containerId?: string;
  artifactDirectory?: string;
  results: SandboxCommandResult[];
}

export interface CommandSandbox {
  preflight(): Promise<CommandSandboxCapability>;
  execute(request: CommandSandboxRequest): Promise<CommandSandboxReport>;
}

export interface DockerCommandSandboxOptions {
  dockerRunner?: DockerRunner;
  image: string;
  cpuLimit?: number;
  memoryBytes?: number;
  pidsLimit?: number;
  maxOutputBytes?: number;
  maxTimeoutMs?: number;
  artifactRoot?: string;
}

function completedInvocation(
  started: number,
  overrides: Partial<DockerInvocationResult>,
): DockerInvocationResult {
  const completed = Date.now();
  return {
    exitCode: 0,
    stdout: "",
    stderr: "",
    startedAt: new Date(started).toISOString(),
    completedAt: new Date(completed).toISOString(),
    durationMs: completed - started,
    terminationReason: "completed",
    outputTruncated: false,
    ...overrides,
  };
}

async function terminateChild(child: ChildProcess): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null) {
    return;
  }
  if (process.platform === "win32") {
    await new Promise<void>((resolveTermination) => {
      const killer = spawn(
        resolve(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe"),
        ["/PID", String(child.pid), "/T", "/F"],
        { stdio: "ignore", windowsHide: true },
      );
      killer.once("close", () => resolveTermination());
      killer.once("error", () => resolveTermination());
    });
    return;
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      throw error;
    }
  }
}

export class SpawnDockerRunner implements DockerRunner {
  public constructor(private readonly executable = "docker") {}

  public async run(
    args: readonly string[],
    options: DockerRunOptions,
  ): Promise<DockerInvocationResult> {
    const started = Date.now();
    if (options.signal?.aborted) {
      return completedInvocation(started, {
        exitCode: null,
        terminationReason: "cancelled",
      });
    }

    let child: ChildProcess;
    try {
      child = spawn(this.executable, [...args], {
        detached: process.platform !== "win32",
        env: {},
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      return completedInvocation(started, {
        exitCode: null,
        stderr: (error as Error).message,
        terminationReason: "spawn-failed",
      });
    }

    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let outputTruncated = false;
    let terminationReason: SandboxTerminationReason = "completed";
    let termination: Promise<void> | undefined;

    const stop = (reason: Exclude<SandboxTerminationReason, "completed" | "spawn-failed">) => {
      if (termination === undefined) {
        terminationReason = reason;
        termination = terminateChild(child);
      }
      return termination;
    };
    const append = (stream: "stdout" | "stderr", chunk: Buffer) => {
      const remaining = Math.max(0, options.maxOutputBytes - outputBytes);
      const accepted = chunk.subarray(0, remaining);
      outputBytes += accepted.byteLength;
      if (stream === "stdout") {
        stdout += accepted.toString("utf8");
      } else {
        stderr += accepted.toString("utf8");
      }
      if (accepted.byteLength < chunk.byteLength) {
        outputTruncated = true;
        void stop("output-limit");
      }
    };

    child.stdout?.on("data", (chunk: Buffer) => append("stdout", chunk));
    child.stderr?.on("data", (chunk: Buffer) => append("stderr", chunk));
    const timeout = setTimeout(() => void stop("timeout"), options.timeoutMs);
    timeout.unref();
    const onAbort = () => void stop("cancelled");
    options.signal?.addEventListener("abort", onAbort, { once: true });

    return new Promise((resolveResult) => {
      child.once("error", (error) => {
        clearTimeout(timeout);
        options.signal?.removeEventListener("abort", onAbort);
        resolveResult(
          completedInvocation(started, {
            exitCode: null,
            stdout,
            stderr: `${stderr}${error.message}`,
            terminationReason: "spawn-failed",
            outputTruncated,
          }),
        );
      });
      child.once("close", (exitCode) => {
        void (async () => {
          clearTimeout(timeout);
          options.signal?.removeEventListener("abort", onAbort);
          await termination;
          resolveResult(
            completedInvocation(started, {
              exitCode,
              stdout,
              stderr,
              terminationReason,
              outputTruncated,
            }),
          );
        })();
      });
    });
  }
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function positiveNumber(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }
  return value;
}

function assertPinnedImage(image: string): void {
  if (
    !/(?:^sha256:[a-f0-9]{64}$|@sha256:[a-f0-9]{64}$)/i.test(image)
  ) {
    throw new Error("Docker sandbox image must be pinned by sha256 digest.");
  }
}

function isWithin(parent: string, candidate: string): boolean {
  const fromParent = relative(parent, candidate);
  return (
    fromParent === "" ||
    (fromParent !== ".." &&
      !fromParent.startsWith(`..${sep}`) &&
      !isAbsolute(fromParent))
  );
}

function validateCommand(input: CommandSpec, maxTimeoutMs: number): CommandSpec {
  if (
    typeof input?.cwdRelative === "string" &&
    (isAbsolute(input.cwdRelative) ||
      input.cwdRelative.split(/[\\/]+/).includes(".."))
  ) {
    throw new Error("Command working directory must stay within the copied source.");
  }
  const parsed = CommandSpecSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error("Command does not satisfy CommandSpec.");
  }
  if (
    isAbsolute(parsed.data.cwdRelative) ||
    parsed.data.cwdRelative.split(/[\\/]+/).includes("..")
  ) {
    throw new Error("Command working directory must stay within the copied source.");
  }
  if (parsed.data.timeoutMs > maxTimeoutMs) {
    throw new Error("Command timeout exceeds the Docker sandbox limit.");
  }
  return Object.freeze({
    ...parsed.data,
    args: Object.freeze([...parsed.data.args]) as unknown as string[],
  });
}

function shouldCopySource(source: string): boolean {
  const name = basename(source);
  return !CREDENTIAL_NAMES.has(name.toLowerCase()) &&
    !CREDENTIAL_FILE_PATTERN.test(name);
}

function containerCwd(command: CommandSpec): string {
  if (command.cwdRelative === ".") {
    return CONTAINER_WORKSPACE;
  }
  return `${CONTAINER_WORKSPACE}/${command.cwdRelative.replaceAll("\\", "/")}`;
}

function reportOnlyReason(
  cli: DockerInvocationResult,
  daemon?: DockerInvocationResult,
): string {
  if (cli.terminationReason === "spawn-failed") {
    return "Docker CLI is unavailable.";
  }
  if (cli.exitCode !== 0) {
    return `Docker CLI preflight failed: ${cli.stderr.trim() || "unknown error"}`;
  }
  return `Docker daemon is unavailable: ${daemon?.stderr.trim() || "unknown error"}`;
}

export class DockerCommandSandbox implements CommandSandbox {
  private readonly runner: DockerRunner;
  private readonly image: string;
  private readonly cpuLimit: number;
  private readonly memoryBytes: number;
  private readonly pidsLimit: number;
  private readonly maxOutputBytes: number;
  private readonly maxTimeoutMs: number;
  private readonly artifactRoot: string;

  public constructor(options: DockerCommandSandboxOptions) {
    this.runner = options.dockerRunner ?? new SpawnDockerRunner();
    this.image = options.image;
    assertPinnedImage(this.image);
    this.cpuLimit = positiveNumber(options.cpuLimit ?? DEFAULT_CPU_LIMIT, "cpuLimit");
    this.memoryBytes = positiveInteger(
      options.memoryBytes ?? DEFAULT_MEMORY_BYTES,
      "memoryBytes",
    );
    this.pidsLimit = positiveInteger(
      options.pidsLimit ?? DEFAULT_PIDS_LIMIT,
      "pidsLimit",
    );
    this.maxOutputBytes = positiveInteger(
      options.maxOutputBytes ?? DEFAULT_OUTPUT_BYTES,
      "maxOutputBytes",
    );
    this.maxTimeoutMs = positiveInteger(
      options.maxTimeoutMs ?? DEFAULT_MAX_TIMEOUT_MS,
      "maxTimeoutMs",
    );
    this.artifactRoot = resolve(
      options.artifactRoot ?? join(tmpdir(), "accesspath-command-sandbox"),
    );
  }

  private runDocker(
    args: readonly string[],
    timeoutMs = CONTROL_TIMEOUT_MS,
    signal?: AbortSignal,
  ): Promise<DockerInvocationResult> {
    return this.runner.run(args, {
      maxOutputBytes: this.maxOutputBytes,
      signal,
      timeoutMs,
    });
  }

  public async preflight(): Promise<CommandSandboxCapability> {
    let cli: DockerInvocationResult;
    try {
      cli = await this.runDocker(["version", "--format", "{{.Client.Version}}"]);
    } catch (error) {
      return {
        mode: "report-only",
        cliAvailable: false,
        daemonAvailable: false,
        image: this.image,
        reason: `Docker CLI is unavailable: ${(error as Error).message}`,
      };
    }
    if (cli.exitCode !== 0 || cli.terminationReason !== "completed") {
      return {
        mode: "report-only",
        cliAvailable: false,
        daemonAvailable: false,
        image: this.image,
        reason: reportOnlyReason(cli),
      };
    }

    let daemon: DockerInvocationResult;
    try {
      daemon = await this.runDocker(["info", "--format", "{{.ServerVersion}}"]);
    } catch (error) {
      return {
        mode: "report-only",
        cliAvailable: true,
        daemonAvailable: false,
        image: this.image,
        reason: `Docker daemon is unavailable: ${(error as Error).message}`,
      };
    }
    if (daemon.exitCode !== 0 || daemon.terminationReason !== "completed") {
      return {
        mode: "report-only",
        cliAvailable: true,
        daemonAvailable: false,
        image: this.image,
        reason: reportOnlyReason(cli, daemon),
      };
    }
    const image = await this.runDocker(["image", "inspect", this.image]);
    if (image.exitCode !== 0 || image.terminationReason !== "completed") {
      return {
        mode: "report-only",
        cliAvailable: true,
        daemonAvailable: true,
        image: this.image,
        reason:
          "The digest-pinned sandbox image is not available locally. " +
          "AccessPath will not pull an image during a mission.",
      };
    }
    return {
      mode: "execute",
      cliAvailable: true,
      daemonAvailable: true,
      image: this.image,
    };
  }

  private async runCommand(
    containerId: string,
    command: CommandSpec,
    phase: SandboxCommandResult["phase"],
    signal?: AbortSignal,
    detached = false,
  ): Promise<SandboxCommandResult> {
    const result = await this.runDocker(
      [
        "exec",
        ...(detached ? ["--detach"] : []),
        "--workdir",
        containerCwd(command),
        containerId,
        "/usr/bin/env",
        "-i",
        `HOME=${EMPTY_HOME}`,
        "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        "PLAYWRIGHT_BROWSERS_PATH=/ms-playwright",
        `ACCESSPATH_ARTIFACT_DIRECTORY=${CONTAINER_ARTIFACTS}`,
        `ACCESSPATH_AUDIT_BUNDLE_PATH=${CONTAINER_ARTIFACTS}/accesspath-audit-bundle.json`,
        `ACCESSPATH_MISSION_CONTEXT=${CONTAINER_ARTIFACTS}/accesspath-mission-context.json`,
        command.executable,
        ...command.args,
      ],
      command.timeoutMs,
      signal,
    );
    return { ...result, command, phase };
  }

  private async waitForPreview(
    containerId: string,
    previewUrl: string,
    signal?: AbortSignal,
  ): Promise<DockerInvocationResult> {
    const started = Date.now();
    const target = new URL(previewUrl);
    if (
      target.hostname !== "127.0.0.1" &&
      target.hostname !== "localhost" &&
      target.hostname !== "::1" &&
      target.hostname !== "[::1]"
    ) {
      throw new Error("Sandbox previews must use a loopback URL.");
    }
    let latest = completedInvocation(started, { exitCode: 1 });
    const deadline = started + PREVIEW_READY_TIMEOUT_MS;
    while (Date.now() < deadline && !signal?.aborted) {
      latest = await this.runDocker(
        [
          "exec",
          containerId,
          "/usr/bin/env",
          "-i",
          `HOME=${EMPTY_HOME}`,
          "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
          "node",
          "-e",
          [
            "fetch(process.argv[1], { redirect: 'manual', signal: AbortSignal.timeout(1000) })",
            ".then((response) => process.exit(response.ok ? 0 : 1))",
            ".catch(() => process.exit(1));",
          ].join(""),
          target.href,
        ],
        Math.min(2_000, Math.max(1, deadline - Date.now())),
        signal,
      );
      if (latest.exitCode === 0 && latest.terminationReason === "completed") {
        return latest;
      }
      await new Promise((resolveDelay) =>
        setTimeout(resolveDelay, PREVIEW_READY_INTERVAL_MS),
      );
    }
    if (signal?.aborted) {
      return completedInvocation(started, {
        exitCode: null,
        terminationReason: "cancelled",
      });
    }
    return completedInvocation(started, {
      exitCode: 1,
      stderr:
        `${latest.stderr}\n` +
        `Preview did not become ready at ${target.href} within ${PREVIEW_READY_TIMEOUT_MS}ms.`,
    });
  }

  public async execute(
    request: CommandSandboxRequest,
  ): Promise<CommandSandboxReport> {
    const capability = await this.preflight();
    if (capability.mode === "report-only") {
      return { capability, status: "report-only", results: [] };
    }

    const command = validateCommand(request.command, this.maxTimeoutMs);
    const preview = request.previewCommand === undefined
      ? undefined
      : validateCommand(request.previewCommand, this.maxTimeoutMs);
    const replay = request.replayCommand === undefined
      ? undefined
      : validateCommand(request.replayCommand, this.maxTimeoutMs);
    const sourceDirectory = await realpath(request.sourceDirectory);
    const artifactDirectory = resolve(
      request.artifactDirectory ??
        join(this.artifactRoot, `run-${Date.now()}-${crypto.randomUUID()}`),
    );
    if (
      isWithin(sourceDirectory, artifactDirectory) ||
      isWithin(artifactDirectory, sourceDirectory)
    ) {
      throw new Error("Artifact directory must be separate from the source directory.");
    }

    const stagingDirectory = await mkdtemp(
      join(tmpdir(), "accesspath-sandbox-source-"),
    );
    let containerId: string | undefined;
    let containerRemoved = false;
    const results: SandboxCommandResult[] = [];
    await mkdir(artifactDirectory, { recursive: true });
    const contextPath = join(
      artifactDirectory,
      "accesspath-mission-context.json",
    );
    if (request.evidenceContext !== undefined) {
      await writeFile(
        contextPath,
        `${JSON.stringify(request.evidenceContext, null, 2)}\n`,
        "utf8",
      );
    }

    try {
      await cp(sourceDirectory, stagingDirectory, {
        recursive: true,
        filter: shouldCopySource,
      });
      const create = await this.runDocker([
        "create",
        "--network",
        "none",
        "--cpus",
        String(this.cpuLimit),
        "--memory",
        String(this.memoryBytes),
        "--pids-limit",
        String(this.pidsLimit),
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--env",
        `HOME=${EMPTY_HOME}`,
        "--workdir",
        CONTAINER_WORKSPACE,
        "--entrypoint",
        "sleep",
        this.image,
        "infinity",
      ]);
      if (create.exitCode !== 0 || create.terminationReason !== "completed") {
        throw new Error(`Docker container creation failed: ${create.stderr.trim()}`);
      }
      containerId = create.stdout.trim();
      if (containerId === "") {
        throw new Error("Docker container creation returned no container ID.");
      }

      const copied = await this.runDocker([
        "cp",
        `${stagingDirectory}${sep}.`,
        `${containerId}:${CONTAINER_WORKSPACE}`,
      ]);
      if (copied.exitCode !== 0 || copied.terminationReason !== "completed") {
        throw new Error(`Docker source copy failed: ${copied.stderr.trim()}`);
      }
      const started = await this.runDocker(["start", containerId]);
      if (started.exitCode !== 0 || started.terminationReason !== "completed") {
        throw new Error(`Docker container start failed: ${started.stderr.trim()}`);
      }
      const prepared = await this.runDocker([
        "exec",
        containerId,
        "mkdir",
        "-p",
        EMPTY_HOME,
        CONTAINER_ARTIFACTS,
      ]);
      if (prepared.exitCode !== 0 || prepared.terminationReason !== "completed") {
        throw new Error(`Docker sandbox preparation failed: ${prepared.stderr.trim()}`);
      }
      if (request.evidenceContext !== undefined) {
        const copiedContext = await this.runDocker([
          "cp",
          contextPath,
          `${containerId}:${CONTAINER_ARTIFACTS}/accesspath-mission-context.json`,
        ]);
        if (
          copiedContext.exitCode !== 0 ||
          copiedContext.terminationReason !== "completed"
        ) {
          throw new Error(
            `Docker mission context copy failed: ${copiedContext.stderr.trim()}`,
          );
        }
      }

      for (const [phase, spec] of [
        ["command", command],
        ["preview", preview],
        ["replay", replay],
      ] as const) {
        if (spec === undefined) {
          continue;
        }
        let result = await this.runCommand(
          containerId,
          spec,
          phase,
          request.signal,
          phase === "preview" && replay !== undefined,
        );
        if (
          phase === "preview" &&
          replay !== undefined &&
          request.previewUrl !== undefined &&
          result.exitCode === 0 &&
          result.terminationReason === "completed"
        ) {
          const readiness = await this.waitForPreview(
            containerId,
            request.previewUrl,
            request.signal,
          );
          if (
            readiness.exitCode !== 0 ||
            readiness.terminationReason !== "completed"
          ) {
            result = {
              ...result,
              exitCode: readiness.exitCode,
              stderr: `${result.stderr}${readiness.stderr}`,
              completedAt: readiness.completedAt,
              durationMs:
                Date.parse(readiness.completedAt) - Date.parse(result.startedAt),
              terminationReason: readiness.terminationReason,
            };
          }
        }
        results.push(result);
        if (
          result.exitCode !== 0 ||
          result.terminationReason !== "completed"
        ) {
          if (
            result.terminationReason === "timeout" ||
            result.terminationReason === "cancelled" ||
            result.terminationReason === "output-limit"
          ) {
            await this.runDocker(["rm", "--force", containerId]);
            containerRemoved = true;
          }
          break;
        }
      }

      if (!containerRemoved) {
        const copiedArtifacts = await this.runDocker([
          "cp",
          `${containerId}:${CONTAINER_ARTIFACTS}/.`,
          artifactDirectory,
        ]);
        if (
          copiedArtifacts.exitCode !== 0 &&
          copiedArtifacts.terminationReason === "completed"
        ) {
          await writeFile(
            join(artifactDirectory, "artifact-copy-error.txt"),
            copiedArtifacts.stderr,
            "utf8",
          );
        }
      }
      await writeFile(
        join(artifactDirectory, "command-results.json"),
        `${JSON.stringify(results, null, 2)}\n`,
        "utf8",
      );

      return {
        capability,
        status: "completed",
        containerId,
        artifactDirectory,
        results,
      };
    } finally {
      if (containerId !== undefined && !containerRemoved) {
        await this.runDocker(["rm", "--force", containerId]).catch(() => undefined);
      }
      await rm(stagingDirectory, { recursive: true, force: true });
    }
  }
}
