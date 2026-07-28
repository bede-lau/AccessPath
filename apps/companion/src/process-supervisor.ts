import {
  execFile,
  spawn,
  type ChildProcess,
} from "node:child_process";
import {
  lstat,
  realpath,
  stat,
} from "node:fs/promises";
import {
  basename,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { promisify } from "node:util";

import {
  CommandSpecSchema,
  type CommandSpec,
} from "@accesspath/contracts";

const execFileAsync = promisify(execFile);
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_MAX_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_KILL_GRACE_MS = 250;
const ABSOLUTE_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const ABSOLUTE_MAX_TIMEOUT_MS = 60 * 60 * 1000;
const ABSOLUTE_MAX_KILL_GRACE_MS = 10_000;
const MAX_ARGUMENTS = 64;
const MAX_ARGUMENT_BYTES = 32 * 1024;
const MAX_ENVIRONMENT_VALUE_BYTES = 16 * 1024;

const HOST_ENVIRONMENT_KEYS =
  process.platform === "win32"
    ? [
        "PATH",
        "SystemRoot",
        "WINDIR",
        "PATHEXT",
        "TEMP",
        "TMP",
        "USERPROFILE",
      ]
    : ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL"];

const SHELL_EXECUTABLES = new Set([
  "bash",
  "busybox",
  "cmd",
  "cscript",
  "dash",
  "fish",
  "ksh",
  "powershell",
  "pwsh",
  "sh",
  "wscript",
  "zsh",
]);

const DELETION_EXECUTABLES = new Set([
  "del",
  "erase",
  "rd",
  "rmdir",
  "rm",
]);

const DISK_EXECUTABLES = new Set([
  "dd",
  "diskpart",
  "diskutil",
  "fdisk",
  "format",
  "mkfs",
  "parted",
]);

const SHUTDOWN_EXECUTABLES = new Set([
  "halt",
  "init",
  "poweroff",
  "reboot",
  "shutdown",
]);

const CREDENTIAL_EXECUTABLES = new Set([
  "cmdkey",
  "env",
  "keychain",
  "pass",
  "printenv",
  "secret-tool",
  "security",
  "setx",
  "vault",
]);

const REMOTE_EXECUTABLES = new Set([
  "nc",
  "ncat",
  "plink",
  "scp",
  "sftp",
  "socat",
  "ssh",
]);

const PROCESS_CONTROL_EXECUTABLES = new Set([
  "gdb",
  "inject",
  "kill",
  "killall",
  "lldb",
  "pkill",
  "strace",
  "taskkill",
]);

export type ProcessSupervisorErrorCode =
  | "COMMAND_DENIED"
  | "COMMAND_MISMATCH"
  | "PATH_ESCAPE"
  | "SPAWN_FAILED";

export class ProcessSupervisorError extends Error {
  public constructor(
    public readonly code: ProcessSupervisorErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export type ProcessTerminationReason =
  | "completed"
  | "cancelled"
  | "timeout"
  | "output-limit";

export interface ProcessOutputChunk {
  stream: "stdout" | "stderr";
  text: string;
}

export interface ProcessResult {
  commandId: string;
  pid: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  terminationReason: ProcessTerminationReason;
  outputTruncated: boolean;
}

export interface SupervisedProcess {
  readonly command: CommandSpec;
  readonly pid: number;
  readonly result: Promise<ProcessResult>;
  cancel(): Promise<void>;
}

export interface ProcessSupervisorRunOptions {
  signal?: AbortSignal;
  onOutput?: (chunk: ProcessOutputChunk) => void;
}

export interface ProcessSupervisorOptions {
  worktreePath: string;
  commands: readonly CommandSpec[];
  environment?: Readonly<Record<string, string | undefined>>;
  allowedEnvironmentKeys?: readonly string[];
  maxOutputBytes?: number;
  maxTimeoutMs?: number;
  killGraceMs?: number;
}

export interface ProcessSupervisor {
  readonly worktreePath: string;
  readonly configuredCommands: readonly CommandSpec[];
  start(
    command: CommandSpec,
    options?: ProcessSupervisorRunOptions,
  ): Promise<SupervisedProcess>;
  run(
    command: CommandSpec,
    options?: ProcessSupervisorRunOptions,
  ): Promise<ProcessResult>;
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

function executableName(executable: string): string {
  return basename(executable)
    .replace(/\.(?:cmd|com|exe|bat)$/i, "")
    .toLowerCase();
}

function commandDenied(message: string): ProcessSupervisorError {
  return new ProcessSupervisorError("COMMAND_DENIED", message);
}

function parseCommand(input: CommandSpec): CommandSpec {
  if (
    typeof input?.cwdRelative === "string" &&
    (isAbsolute(input.cwdRelative) ||
      input.cwdRelative.split(/[\\/]+/).includes(".."))
  ) {
    throw new ProcessSupervisorError(
      "PATH_ESCAPE",
      "Command working directory escapes the worktree.",
    );
  }
  const parsed = CommandSpecSchema.safeParse(input);
  if (!parsed.success) {
    throw commandDenied("Command does not satisfy the configured command contract.");
  }
  return parsed.data;
}

function hasShellSyntax(value: string): boolean {
  return /[;&|<>`\r\n]|\$\(/.test(value);
}

function assertCommandShape(command: CommandSpec, maxTimeoutMs: number): void {
  if (
    (!isAbsolute(command.executable) && /\s/.test(command.executable)) ||
    hasShellSyntax(command.executable)
  ) {
    throw commandDenied(
      "Executable must be a direct program path or name, not a shell command.",
    );
  }
  if (
    command.args.length > MAX_ARGUMENTS ||
    command.args.reduce((total, value) => total + Buffer.byteLength(value), 0) >
      MAX_ARGUMENT_BYTES
  ) {
    throw commandDenied("Command arguments exceed the configured safety limit.");
  }
  if (
    command.args.some(
      (argument) =>
        argument.length === 0 ? false : hasShellSyntax(argument),
    )
  ) {
    throw commandDenied("Shell metacharacters are not permitted in command arguments.");
  }
  if (command.timeoutMs > maxTimeoutMs) {
    throw commandDenied("Command timeout exceeds the supervisor limit.");
  }
}

function includesToken(tokens: readonly string[], pattern: RegExp): boolean {
  return tokens.some((token) => pattern.test(token));
}

function assertCommandPolicy(command: CommandSpec): void {
  const executable = executableName(command.executable);
  const tokens = command.args.map((argument) => argument.toLowerCase());
  const first = tokens.find((token) => !token.startsWith("-"));

  if (SHELL_EXECUTABLES.has(executable)) {
    throw commandDenied("Shell interpreters are not permitted.");
  }
  if (DELETION_EXECUTABLES.has(executable)) {
    throw commandDenied("Direct filesystem deletion commands are not permitted.");
  }
  if (
    DISK_EXECUTABLES.has(executable) ||
    [...DISK_EXECUTABLES].some((name) => executable.startsWith(`${name}.`))
  ) {
    throw commandDenied("Disk or system-volume formatting commands are not permitted.");
  }
  if (
    SHUTDOWN_EXECUTABLES.has(executable) ||
    (executable === "systemctl" &&
      includesToken(tokens, /^(?:halt|poweroff|reboot)$/))
  ) {
    throw commandDenied("System shutdown commands are not permitted.");
  }
  if (
    CREDENTIAL_EXECUTABLES.has(executable) ||
    includesToken(tokens, /(?:credential|keychain|password|secret-store)/)
  ) {
    throw commandDenied("Credential-store access is not permitted.");
  }
  if (REMOTE_EXECUTABLES.has(executable)) {
    throw commandDenied("Remote shells and tunnels are not permitted.");
  }
  if (PROCESS_CONTROL_EXECUTABLES.has(executable)) {
    throw commandDenied("Process control or injection commands are not permitted.");
  }
  if (
    (["node", "python", "python3", "ruby", "perl"].includes(executable) &&
      includesToken(tokens, /^(?:-c|-e|--eval|--print)$/)) ||
    (executable === "deno" && includesToken(tokens, /^eval$/))
  ) {
    throw commandDenied("Inline interpreter evaluation is not permitted.");
  }

  if (executable === "git") {
    if (
      includesToken(
        tokens,
        new RegExp(
          `^(?:${[
            "clone",
            "fetch",
            "merge",
            "pull",
            "push",
            "rebase",
            "remote",
            "send-pack",
          ].join("|")})$`,
        ),
      )
    ) {
      throw commandDenied("Git remote mutation and history mutation are not permitted.");
    }
    if (
      first !== undefined &&
      [
        "clone",
        "fetch",
        "merge",
        "pull",
        "push",
        "rebase",
        "remote",
        "send-pack",
      ].includes(first)
    ) {
      throw commandDenied("Git remote mutation and history mutation are not permitted.");
    }
    if (
      first === "config" &&
      includesToken(tokens, /^(?:remote\.|credential\.)/)
    ) {
      throw commandDenied("Git remote and credential configuration is not permitted.");
    }
  }

  const packageManager = ["npm", "npx", "pnpm", "yarn", "bun"].includes(
    executable,
  );
  if (
    (packageManager &&
      includesToken(tokens, /^(?:adduser|login|owner|publish|token|unpublish)$/)) ||
    (executable === "cargo" && first === "publish") ||
    (executable === "twine" && first === "upload") ||
    (executable === "dotnet" &&
      tokens.includes("nuget") &&
      tokens.includes("push"))
  ) {
    throw commandDenied("Package publishing is not permitted.");
  }

  if (
    ["deploy", "firebase", "flyctl", "heroku", "netlify", "vercel"].includes(
      executable,
    ) ||
    includesToken(tokens, /^(?:deploy|release)$/) ||
    (executable === "kubectl" &&
      includesToken(tokens, /^(?:apply|create|delete|patch|replace)$/))
  ) {
    throw commandDenied("Deployment commands are not permitted.");
  }
}

async function assertNoLinkedSegments(
  canonicalRoot: string,
  candidate: string,
): Promise<void> {
  const fromRoot = relative(canonicalRoot, candidate);
  let current = canonicalRoot;
  for (const segment of fromRoot.split(/[\\/]/).filter(Boolean)) {
    current = resolve(current, segment);
    try {
      const details = await lstat(current);
      if (details.isSymbolicLink()) {
        throw new ProcessSupervisorError(
          "PATH_ESCAPE",
          "Symlinked or junction working directories are not permitted.",
        );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      throw error;
    }
  }
}

async function resolveWorkingDirectory(
  canonicalWorktree: string,
  cwdRelative: string,
): Promise<string> {
  if (
    isAbsolute(cwdRelative) ||
    cwdRelative.split(/[\\/]+/).includes("..")
  ) {
    throw new ProcessSupervisorError(
      "PATH_ESCAPE",
      "Command working directory escapes the worktree.",
    );
  }
  const candidate = resolve(canonicalWorktree, cwdRelative);
  if (!isWithin(canonicalWorktree, candidate)) {
    throw new ProcessSupervisorError(
      "PATH_ESCAPE",
      "Command working directory escapes the worktree.",
    );
  }
  await assertNoLinkedSegments(canonicalWorktree, candidate);
  const canonicalCandidate = await realpath(candidate).catch(() => {
    throw new ProcessSupervisorError(
      "PATH_ESCAPE",
      "Command working directory does not exist.",
    );
  });
  const details = await stat(canonicalCandidate);
  if (!details.isDirectory() || !isWithin(canonicalWorktree, canonicalCandidate)) {
    throw new ProcessSupervisorError(
      "PATH_ESCAPE",
      "Command working directory is outside the worktree.",
    );
  }
  return canonicalCandidate;
}

function argumentPathValue(argument: string): string | undefined {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(argument)) {
    return undefined;
  }
  const equals = argument.indexOf("=");
  const value =
    argument.startsWith("-") && equals >= 0
      ? argument.slice(equals + 1)
      : argument;
  if (
    value.startsWith("file:") ||
    isAbsolute(value) ||
    value.split(/[\\/]+/).includes("..") ||
    value.includes("/") ||
    value.includes("\\")
  ) {
    return value;
  }
  return undefined;
}

async function assertArgumentPaths(
  canonicalWorktree: string,
  canonicalCwd: string,
  command: CommandSpec,
): Promise<void> {
  for (const argument of command.args) {
    const value = argumentPathValue(argument);
    if (value === undefined) {
      continue;
    }
    if (value.startsWith("file:") || value.split(/[\\/]+/).includes("..")) {
      throw new ProcessSupervisorError(
        "PATH_ESCAPE",
        "Command argument contains an unsafe filesystem path.",
      );
    }
    const candidate = isAbsolute(value)
      ? resolve(value)
      : resolve(canonicalCwd, value);
    if (!isWithin(canonicalWorktree, candidate)) {
      throw new ProcessSupervisorError(
        "PATH_ESCAPE",
        "Command argument references a path outside the worktree.",
      );
    }
    await assertNoLinkedSegments(canonicalWorktree, candidate);
  }
}

function environmentValue(key: string): string | undefined {
  const entry = Object.entries(process.env).find(
    ([name]) => name.toLowerCase() === key.toLowerCase(),
  );
  return entry?.[1];
}

function createEnvironment(
  configured: Readonly<Record<string, string | undefined>>,
  allowedKeys: readonly string[],
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of HOST_ENVIRONMENT_KEYS) {
    const value = environmentValue(key);
    if (value !== undefined) {
      environment[key] = value;
    }
  }

  const allowed = new Set(allowedKeys);
  for (const [key, value] of Object.entries(configured)) {
    if (!allowed.has(key)) {
      throw commandDenied(`Environment variable ${key} is not allowlisted.`);
    }
    if (
      /(?:AUTH|COOKIE|CREDENTIAL|KEY|PASSWORD|SECRET|TOKEN)/i.test(key) ||
      /^(?:BASH_ENV|ENV|GIT_CONFIG|GIT_SSH|LD_PRELOAD|NODE_OPTIONS|PROMPT_COMMAND|SSH_)/i.test(
        key,
      )
    ) {
      throw commandDenied(`Environment variable ${key} is not permitted.`);
    }
    if (
      value !== undefined &&
      Buffer.byteLength(value) > MAX_ENVIRONMENT_VALUE_BYTES
    ) {
      throw commandDenied(`Environment variable ${key} exceeds the size limit.`);
    }
    if (value !== undefined) {
      environment[key] = value;
    }
  }
  return environment;
}

function commandEquals(left: CommandSpec, right: CommandSpec): boolean {
  return (
    left.id === right.id &&
    left.label === right.label &&
    left.executable === right.executable &&
    left.cwdRelative === right.cwdRelative &&
    left.timeoutMs === right.timeoutMs &&
    left.category === right.category &&
    left.args.length === right.args.length &&
    left.args.every((argument, index) => argument === right.args[index])
  );
}

function freezeCommand(command: CommandSpec): CommandSpec {
  return Object.freeze({
    ...command,
    args: Object.freeze([...command.args]) as unknown as string[],
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function terminatePosixTree(
  pid: number,
  graceMs: number,
): Promise<void> {
  try {
    process.kill(-pid, "SIGTERM");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      throw error;
    }
  }
  await delay(graceMs);
  try {
    process.kill(-pid, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      throw error;
    }
  }
}

async function terminateWindowsTree(pid: number): Promise<void> {
  try {
    await execFileAsync(
      resolve(environmentValue("SystemRoot") ?? "C:\\Windows", "System32", "taskkill.exe"),
      ["/PID", String(pid), "/T", "/F"],
      {
        encoding: "utf8",
        timeout: 10_000,
        windowsHide: true,
      },
    );
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { stderr?: string };
    if (
      !/not found|no running instance|cannot find/i.test(failure.stderr ?? failure.message)
    ) {
      throw error;
    }
  }
}

async function terminateOwnedTree(
  pid: number,
  graceMs: number,
): Promise<void> {
  if (process.platform === "win32") {
    await terminateWindowsTree(pid);
  } else {
    await terminatePosixTree(pid, graceMs);
  }
}

async function waitForSpawn(
  child: ChildProcess,
): Promise<void> {
  await new Promise<void>((resolveSpawn, reject) => {
    const onSpawn = () => {
      child.off("error", onError);
      resolveSpawn();
    };
    const onError = (error: Error) => {
      child.off("spawn", onSpawn);
      reject(
        new ProcessSupervisorError(
          "SPAWN_FAILED",
          `Configured executable could not be started: ${error.message}`,
        ),
      );
    };
    child.once("spawn", onSpawn);
    child.once("error", onError);
  });
}

class ProcessSupervisorImpl implements ProcessSupervisor {
  public readonly configuredCommands: readonly CommandSpec[];
  private readonly commandsById = new Map<string, CommandSpec>();
  private readonly environment: NodeJS.ProcessEnv;
  private readonly maxOutputBytes: number;
  private readonly maxTimeoutMs: number;
  private readonly killGraceMs: number;

  public constructor(
    public readonly worktreePath: string,
    commands: readonly CommandSpec[],
    options: ProcessSupervisorOptions,
  ) {
    this.configuredCommands = Object.freeze(
      commands.map((command) => freezeCommand(command)),
    );
    this.maxOutputBytes =
      options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    this.maxTimeoutMs = options.maxTimeoutMs ?? DEFAULT_MAX_TIMEOUT_MS;
    this.killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
    this.environment = createEnvironment(
      options.environment ?? {},
      options.allowedEnvironmentKeys ?? [],
    );
    if (
      !Number.isInteger(this.maxOutputBytes) ||
      this.maxOutputBytes <= 0 ||
      this.maxOutputBytes > ABSOLUTE_MAX_OUTPUT_BYTES ||
      !Number.isInteger(this.maxTimeoutMs) ||
      this.maxTimeoutMs <= 0 ||
      this.maxTimeoutMs > ABSOLUTE_MAX_TIMEOUT_MS ||
      !Number.isInteger(this.killGraceMs) ||
      this.killGraceMs < 0 ||
      this.killGraceMs > ABSOLUTE_MAX_KILL_GRACE_MS
    ) {
      throw commandDenied("Supervisor limits must be positive bounded integers.");
    }
    for (const command of this.configuredCommands) {
      if (this.commandsById.has(command.id)) {
        throw commandDenied(`Duplicate configured command ID: ${command.id}.`);
      }
      this.commandsById.set(command.id, command);
    }
  }

  private configured(command: CommandSpec): CommandSpec {
    const requested = parseCommand(command);
    const configured = this.commandsById.get(requested.id);
    if (configured === undefined || !commandEquals(configured, requested)) {
      throw new ProcessSupervisorError(
        "COMMAND_MISMATCH",
        "Requested command does not exactly match its configured CommandSpec.",
      );
    }
    return configured;
  }

  public async start(
    input: CommandSpec,
    options: ProcessSupervisorRunOptions = {},
  ): Promise<SupervisedProcess> {
    const command = this.configured(input);
    if (options.signal?.aborted) {
      throw commandDenied("Command was cancelled before it started.");
    }
    const cwd = await resolveWorkingDirectory(
      this.worktreePath,
      command.cwdRelative,
    );
    await assertArgumentPaths(this.worktreePath, cwd, command);

    const started = Date.now();
    const startedAt = new Date(started).toISOString();
    const child = spawn(command.executable, [...command.args], {
      cwd,
      env: this.environment,
      shell: false,
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    await waitForSpawn(child);
    if (child.pid === undefined) {
      throw new ProcessSupervisorError(
        "SPAWN_FAILED",
        "Configured executable started without a process ID.",
      );
    }

    const pid = child.pid;
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let outputTruncated = false;
    let terminationReason: ProcessTerminationReason = "completed";
    let terminationPromise: Promise<void> | undefined;

    const terminate = (reason: Exclude<ProcessTerminationReason, "completed">) => {
      if (terminationPromise !== undefined) {
        return terminationPromise;
      }
      terminationReason = reason;
      terminationPromise = terminateOwnedTree(pid, this.killGraceMs);
      return terminationPromise;
    };

    const append = (stream: "stdout" | "stderr", chunk: Buffer) => {
      const remaining = Math.max(0, this.maxOutputBytes - outputBytes);
      const accepted = chunk.subarray(0, remaining);
      const text = accepted.toString("utf8");
      outputBytes += accepted.byteLength;
      if (stream === "stdout") {
        stdout += text;
      } else {
        stderr += text;
      }
      if (text !== "") {
        options.onOutput?.({ stream, text });
      }
      if (accepted.byteLength < chunk.byteLength) {
        outputTruncated = true;
        void terminate("output-limit");
      }
    };

    child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk));

    const timeout = setTimeout(() => {
      void terminate("timeout");
    }, command.timeoutMs);
    timeout.unref();
    const onAbort = () => {
      void terminate("cancelled");
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) {
      void terminate("cancelled");
    }

    const result = new Promise<ProcessResult>((resolveResult, rejectResult) => {
      child.once("error", (error) => {
        rejectResult(
          new ProcessSupervisorError(
            "SPAWN_FAILED",
            `Configured executable failed: ${error.message}`,
          ),
        );
      });
      child.once("close", (exitCode, signal) => {
        void (async () => {
          clearTimeout(timeout);
          options.signal?.removeEventListener("abort", onAbort);
          if (terminationPromise !== undefined) {
            await terminationPromise;
          }
          const completed = Date.now();
          resolveResult({
            commandId: command.id,
            pid,
            exitCode,
            signal,
            stdout,
            stderr,
            startedAt,
            completedAt: new Date(completed).toISOString(),
            durationMs: completed - started,
            terminationReason,
            outputTruncated,
          });
        })().catch(rejectResult);
      });
    });

    return {
      command,
      pid,
      result,
      cancel: async () => {
        await terminate("cancelled");
      },
    };
  }

  public async run(
    command: CommandSpec,
    options?: ProcessSupervisorRunOptions,
  ): Promise<ProcessResult> {
    return (await this.start(command, options)).result;
  }
}

export async function validateConfiguredCommand(
  worktreePath: string,
  input: CommandSpec,
  options: {
    maxTimeoutMs?: number;
  } = {},
): Promise<CommandSpec> {
  const command = parseCommand(input);
  const maxTimeoutMs = options.maxTimeoutMs ?? DEFAULT_MAX_TIMEOUT_MS;
  assertCommandShape(command, maxTimeoutMs);
  assertCommandPolicy(command);
  const canonicalWorktree = await realpath(worktreePath);
  const details = await stat(canonicalWorktree);
  if (!details.isDirectory()) {
    throw new ProcessSupervisorError(
      "PATH_ESCAPE",
      "Repair worktree must be a directory.",
    );
  }
  const canonicalCwd = await resolveWorkingDirectory(
    canonicalWorktree,
    command.cwdRelative,
  );
  await assertArgumentPaths(canonicalWorktree, canonicalCwd, command);
  return command;
}

export async function createProcessSupervisor(
  options: ProcessSupervisorOptions,
): Promise<ProcessSupervisor> {
  const canonicalWorktree = await realpath(options.worktreePath).catch(() => {
    throw new ProcessSupervisorError(
      "PATH_ESCAPE",
      "Repair worktree does not exist.",
    );
  });
  const details = await stat(canonicalWorktree);
  if (!details.isDirectory()) {
    throw new ProcessSupervisorError(
      "PATH_ESCAPE",
      "Repair worktree must be a directory.",
    );
  }
  const maxTimeoutMs = options.maxTimeoutMs ?? DEFAULT_MAX_TIMEOUT_MS;
  const commands: CommandSpec[] = [];
  for (const input of options.commands) {
    commands.push(
      await validateConfiguredCommand(canonicalWorktree, input, {
        maxTimeoutMs,
      }),
    );
  }
  return new ProcessSupervisorImpl(canonicalWorktree, commands, options);
}
