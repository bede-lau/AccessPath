import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createSdkMcpServer,
  query as qwenQuery,
  tool,
  type Query,
  type SDKMessage as QwenSdkMessage,
  type SDKUserMessage as QwenSdkUserMessage,
} from "@qwen-code/sdk";
import type {
  RewindFilesResult,
  SDKMessage,
} from "@qoder-ai/qoder-agent-sdk";
import { z } from "zod";

import { QwenAuthenticationError } from "./errors";
import { matchesAllowedPath, resolveWorktreePath } from "./policy";
import type {
  QoderAdapter,
  QoderAdapterRecoveryOptions,
  QoderAdapterSession,
  QoderAdapterStartOptions,
  QoderAgentMode,
  QoderTurnRecovery,
  RecoveredRepairTurn,
} from "./types";

const DEFAULT_QWEN_BASE_URL =
  "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
const DEFAULT_QWEN_MODEL = "qwen3.7-max-preview";
const MAX_FILE_READ_BYTES = 256_000;
const MAX_SEARCH_FILE_BYTES = 512_000;
const MAX_SEARCH_RESULTS = 100;
const MAX_TREE_ENTRIES = 2_000;
const MAX_WORKER_STDERR_LENGTH = 4_000;
const MIN_QWEN_REPAIR_SESSION_TURNS = 14;
const OPENAI_COMPLETION_TOKEN_LIMIT = 4_096;

const BLOCKED_QWEN_CORE_TOOLS = [
  "Agent",
  "Bash",
  "WebFetch",
  "WebSearch",
  "run_shell_command",
  "list_directory",
  "read_file",
  "glob",
  "grep",
  "search_file_content",
  "tool_search",
  "edit",
  "replace",
  "write_file",
  "send_message",
  "task_stop",
  "skill",
] as const;

export interface QwenConfiguration {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface QwenCodeAdapterOptions {
  environment?: NodeJS.ProcessEnv;
  query?: typeof qwenQuery;
  recoveryRoot?: string;
}

export function qwenRuntimeSettings(
  configuration: Pick<QwenConfiguration, "baseUrl" | "model">,
): Record<string, unknown> {
  try {
    const usesOpenAiGptFive =
      new URL(configuration.baseUrl).hostname === "api.openai.com" &&
      configuration.model.toLowerCase().startsWith("gpt-5");
    if (usesOpenAiGptFive) {
      return {
        modelProviders: {
          openai: [
            {
              baseUrl: configuration.baseUrl,
              envKey: "OPENAI_API_KEY",
              generationConfig: {
                samplingParams: {
                  max_completion_tokens: OPENAI_COMPLETION_TOKEN_LIMIT,
                },
              },
              id: configuration.model,
            },
          ],
        },
      };
    }
  } catch {
    // Keep the SDK defaults when a custom endpoint is not a valid URL.
  }
  return {};
}

function prepareQwenRuntime(
  configuration: QwenConfiguration,
  runtimeRoot: string | undefined,
): string {
  const home = runtimeRoot ?? join(tmpdir(), "accesspath-qwen");
  mkdirSync(join(home, "runtime"), { recursive: true });
  // This directory is owned by AccessPath, so a stale provider profile cannot
  // leak between runs when the selected model changes.
  writeFileSync(
    join(home, "settings.json"),
    `${JSON.stringify(qwenRuntimeSettings(configuration))}\n`,
    "utf8",
  );
  return home;
}

export function qwenSessionTurnLimit(
  options: Pick<QoderAdapterStartOptions, "maxTurns" | "mode">,
): number {
  // A Qwen repair continues after diagnosis in a new SDK process. A failed
  // exact edit is recoverable, but the generic repair cap left no room to
  // read the target again, retry it, and finish the regression test.
  return options.mode === "repair"
    ? Math.max(options.maxTurns, MIN_QWEN_REPAIR_SESSION_TURNS)
    : options.maxTurns;
}

type RewindEntry =
  | {
      action: "restore";
      absolutePath: string;
      content: string;
      relativePath: string;
    }
  | {
      action: "delete";
      absolutePath: string;
      relativePath: string;
    };

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function textContent(message: QwenSdkMessage): string[] {
  if (message.type !== "assistant") {
    return [];
  }
  return message.message.content
    .filter(
      (block): block is { type: "text"; text: string } =>
        block.type === "text" && typeof block.text === "string",
    )
    .map((block) => block.text);
}

function qwenRecoveryPath(
  recoveryRoot: string,
  sessionId: string,
  userMessageId: string,
): string {
  const segment = (value: string) => value.replace(/[^A-Za-z0-9-]/g, "");
  return join(recoveryRoot, "qwen-turns", segment(sessionId), `${segment(userMessageId)}.json`);
}

function asQoderMessage(message: QwenSdkMessage): SDKMessage {
  if (message.type !== "result") {
    return message as unknown as SDKMessage;
  }
  const usage = {
    ...message.usage,
    cache_creation_input_tokens: numberValue(
      message.usage.cache_creation_input_tokens,
    ),
    cache_read_input_tokens: numberValue(
      message.usage.cache_read_input_tokens,
    ),
    input_tokens: numberValue(message.usage.input_tokens),
    output_tokens: numberValue(message.usage.output_tokens),
  };
  const modelUsage = Object.fromEntries(
    Object.entries(message.modelUsage ?? {}).map(([model, value]) => [
      model,
      {
        ...value,
        costUSD: 0,
        maxOutputTokens: 0,
      },
    ]),
  );
  if (message.subtype === "success") {
    return {
      ...message,
      errors: [],
      modelUsage,
      stop_reason: null,
      total_cost_usd: 0,
      usage,
    } as unknown as SDKMessage;
  }
  return {
    ...message,
    errors: [message.error?.message ?? "Qwen Code execution failed."],
    modelUsage,
    stop_reason: null,
    total_cost_usd: 0,
    usage,
  } as unknown as SDKMessage;
}

function qwenChildEnvironment(
  configuration: QwenConfiguration,
  runtimeRoot: string | undefined,
): Record<string, string> {
  const home = prepareQwenRuntime(configuration, runtimeRoot);
  return {
    OPENAI_API_KEY: configuration.apiKey,
    OPENAI_BASE_URL: configuration.baseUrl,
    OPENAI_MODEL: configuration.model,
    QWEN_CODE_ENABLE_AGENT_TEAM: "0",
    QWEN_HOME: home,
    QWEN_RUNTIME_DIR: join(home, "runtime"),
  };
}

function toolResult(text: string, isError = false) {
  return {
    content: [{ type: "text" as const, text }],
    ...(isError ? { isError: true } : {}),
  };
}

async function collectFiles(
  root: string,
  visit: (absolutePath: string, relativePath: string) => Promise<void>,
): Promise<void> {
  let visited = 0;
  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue;
      }
      visited += 1;
      if (visited > MAX_TREE_ENTRIES) {
        throw new Error("The approved search exceeded its entry limit.");
      }
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
      } else if (entry.isFile()) {
        await visit(absolutePath, relative(root, absolutePath).replaceAll("\\", "/"));
      }
    }
  };
  await walk(root);
}

async function readTextAtMost(
  absolutePath: string,
  maximumBytes: number,
): Promise<string> {
  const content = await readFile(absolutePath);
  if (content.byteLength > maximumBytes) {
    throw new Error(`The selected file exceeds the ${maximumBytes}-byte read limit.`);
  }
  return content.toString("utf8");
}

class QwenToolset {
  private readonly rewindEntries = new Map<string, RewindEntry[]>();
  private userMessageId?: string;

  public constructor(private readonly options: QoderAdapterStartOptions) {}

  private async authorize(
    toolName: "Read" | "Glob" | "Grep" | "Edit" | "Write",
    input: Record<string, unknown>,
  ): Promise<{ allowed: boolean; toolUseId: string; reason?: string }> {
    const toolUseId = `qwen-tool-${randomUUID()}`;
    const decision = await this.options.canUseTool(toolName, input, {
      signal: this.options.signal ?? new AbortController().signal,
      toolUseID: toolUseId,
    });
    return decision.behavior === "allow"
      ? { allowed: true, toolUseId }
      : { allowed: false, toolUseId, reason: decision.message };
  }

  private entries(userMessageId: string): RewindEntry[] {
    const existing = this.rewindEntries.get(userMessageId);
    if (existing !== undefined) {
      return existing;
    }
    const created: RewindEntry[] = [];
    this.rewindEntries.set(userMessageId, created);
    return created;
  }

  public setUserMessageId(value: string): void {
    this.userMessageId = value;
  }

  private activeUserMessageId(): string {
    if (this.userMessageId === undefined) {
      throw new Error("Qwen code tools started before the user turn was identified.");
    }
    return this.userMessageId;
  }

  private requireWorktree(): string {
    if (this.options.cwd === undefined) {
      throw new Error("Qwen code tools require an approved repair worktree.");
    }
    return this.options.cwd;
  }

  public server() {
    const read = tool(
      "accesspath_read",
      "Read one approved source file. Use file_path relative to the worktree.",
      { file_path: z.string().min(1) },
      async ({ file_path }) => {
        try {
          const approved = await this.authorize("Read", { file_path });
          if (!approved.allowed) {
            return toolResult(approved.reason ?? "Read was denied.", true);
          }
          const target = await resolveWorktreePath(this.requireWorktree(), file_path);
          const content = await readTextAtMost(target.absolutePath, MAX_FILE_READ_BYTES);
          return toolResult(content);
        } catch (error) {
          return toolResult(
            error instanceof Error ? error.message : "Read failed.",
            true,
          );
        }
      },
    );
    const glob = tool(
      "accesspath_glob",
      "List files below an approved directory. path is relative to the worktree; pattern is a relative glob.",
      {
        path: z.string().min(1).default("."),
        pattern: z.string().min(1),
      },
      async ({ path, pattern }) => {
        try {
          const approved = await this.authorize("Glob", { path, pattern });
          if (!approved.allowed) {
            return toolResult(approved.reason ?? "Glob was denied.", true);
          }
          const root = await resolveWorktreePath(this.requireWorktree(), path);
          const files: string[] = [];
          await collectFiles(root.absolutePath, async (absolutePath) => {
            const worktreePath = relative(this.requireWorktree(), absolutePath)
              .replaceAll("\\", "/");
            if (matchesAllowedPath(worktreePath, [pattern])) {
              files.push(worktreePath);
            }
          });
          files.sort();
          return toolResult(files.slice(0, MAX_SEARCH_RESULTS).join("\n"));
        } catch (error) {
          return toolResult(
            error instanceof Error ? error.message : "Glob failed.",
            true,
          );
        }
      },
    );
    const grep = tool(
      "accesspath_grep",
      "Find literal text in approved source files. query is treated as literal text, not a regular expression.",
      {
        path: z.string().min(1).default("."),
        query: z.string().min(1).max(512),
        glob: z.string().min(1).optional(),
      },
      async ({ path, query, glob: pattern }) => {
        try {
          const approved = await this.authorize("Grep", {
            path,
            query,
            ...(pattern === undefined ? {} : { glob: pattern }),
          });
          if (!approved.allowed) {
            return toolResult(approved.reason ?? "Search was denied.", true);
          }
          const root = await resolveWorktreePath(this.requireWorktree(), path);
          const matches: string[] = [];
          await collectFiles(root.absolutePath, async (absolutePath) => {
            if (matches.length >= MAX_SEARCH_RESULTS) {
              return;
            }
            const worktreePath = relative(this.requireWorktree(), absolutePath)
              .replaceAll("\\", "/");
            if (
              pattern !== undefined &&
              !matchesAllowedPath(worktreePath, [pattern])
            ) {
              return;
            }
            let content: string;
            try {
              content = await readTextAtMost(absolutePath, MAX_SEARCH_FILE_BYTES);
            } catch {
              return;
            }
            for (const [index, line] of content.split(/\r?\n/).entries()) {
              if (line.includes(query)) {
                matches.push(`${worktreePath}:${index + 1}:${line}`);
                if (matches.length >= MAX_SEARCH_RESULTS) {
                  return;
                }
              }
            }
          });
          return toolResult(matches.join("\n"));
        } catch (error) {
          return toolResult(
            error instanceof Error ? error.message : "Search failed.",
            true,
          );
        }
      },
    );
    const edit = tool(
      "accesspath_edit",
      "Replace one exact, unique source string in an approved file.",
      {
        file_path: z.string().min(1),
        old_string: z.string().min(1),
        new_string: z.string(),
      },
      async ({ file_path, old_string, new_string }) => {
        try {
          const approved = await this.authorize("Edit", {
            file_path,
            old_string,
            new_string,
          });
          if (!approved.allowed) {
            return toolResult(approved.reason ?? "Edit was denied.", true);
          }
          const target = await resolveWorktreePath(this.requireWorktree(), file_path);
          const original = await readTextAtMost(target.absolutePath, MAX_FILE_READ_BYTES);
          const occurrences = original.split(old_string).length - 1;
          if (occurrences !== 1) {
            return toolResult(
              occurrences === 0
                ? "The exact old_string was not found."
                : "The exact old_string is ambiguous; narrow the edit first.",
              true,
            );
          }
          this.entries(this.activeUserMessageId()).push({
            action: "restore",
            ...target,
            content: original,
          });
          await writeFile(
            target.absolutePath,
            original.replace(old_string, new_string),
            "utf8",
          );
          return toolResult(`Updated ${target.relativePath}.`);
        } catch (error) {
          return toolResult(
            error instanceof Error ? error.message : "Edit failed.",
            true,
          );
        }
      },
    );
    const write = tool(
      "accesspath_write",
      "Write an approved source file. This tool is restricted to the approved repair scope.",
      {
        file_path: z.string().min(1),
        content: z.string(),
      },
      async ({ file_path, content }) => {
        try {
          const approved = await this.authorize("Write", {
            file_path,
            content,
          });
          if (!approved.allowed) {
            return toolResult(approved.reason ?? "Write was denied.", true);
          }
          const target = await resolveWorktreePath(this.requireWorktree(), file_path);
          let original: string | undefined;
          try {
            original = await readTextAtMost(target.absolutePath, MAX_FILE_READ_BYTES);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
              throw error;
            }
          }
          this.entries(this.activeUserMessageId()).push(
            original === undefined
              ? { action: "delete", ...target }
              : { action: "restore", ...target, content: original },
          );
          await mkdir(dirname(target.absolutePath), { recursive: true });
          await writeFile(target.absolutePath, content, "utf8");
          return toolResult(`Wrote ${target.relativePath}.`);
        } catch (error) {
          return toolResult(
            error instanceof Error ? error.message : "Write failed.",
            true,
          );
        }
      },
    );
    return createSdkMcpServer({
      name: "accesspath",
      version: "1.0.0",
      tools:
        this.options.mode === "planning"
          ? []
          : this.options.mode === "diagnosis"
            ? [read, glob, grep]
            : [read, glob, grep, edit, write],
    });
  }

  public async rewind(
    userMessageId: string,
    dryRun = false,
  ): Promise<RewindFilesResult> {
    const entries = this.rewindEntries.get(userMessageId) ?? [];
    const filesChanged = entries.map((entry) => entry.relativePath);
    if (!dryRun) {
      for (const entry of entries.slice().reverse()) {
        if (entry.action === "restore") {
          await writeFile(entry.absolutePath, entry.content, "utf8");
        } else {
          await rm(entry.absolutePath, { force: true });
        }
      }
      this.rewindEntries.delete(userMessageId);
    }
    return {
      canRewind: filesChanged.length > 0,
      filesChanged,
      insertions: filesChanged.length,
      deletions: filesChanged.length,
    } as RewindFilesResult;
  }
}

class QwenSession implements QoderAdapterSession {
  private userMessageId?: string;
  private readonly completedMessages: string[] = [];
  private inputReleased = false;

  public constructor(
    private readonly source: Query,
    private readonly recoveryRoot: string | undefined,
    private readonly sessionId: string,
    private readonly toolset: QwenToolset,
    private readonly releaseInput: () => void,
  ) {}

  private finishInput(): void {
    if (this.inputReleased) {
      return;
    }
    this.inputReleased = true;
    this.releaseInput();
  }

  private async persist(result: RecoveredRepairTurn): Promise<void> {
    if (this.recoveryRoot === undefined) {
      return;
    }
    const path = qwenRecoveryPath(
      this.recoveryRoot,
      result.qoderSessionId,
      result.userMessageId,
    );
    await mkdir(dirname(path), { recursive: true });
    const temporaryPath = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(result)}\n`, "utf8");
    await rename(temporaryPath, path);
  }

  public async *[Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    for await (const message of this.source) {
      this.completedMessages.push(...textContent(message));
      if (
        message.type === "result" &&
        message.subtype === "success" &&
        this.userMessageId !== undefined
      ) {
        await this.persist({
          completedMessages: this.completedMessages,
          qoderSessionId: message.session_id,
          result: message.result,
          resultSubtype: "success",
          stopReason: null,
          userMessageId: this.userMessageId,
        });
      }
      if (message.type === "result") {
        this.finishInput();
      }
      yield asQoderMessage(message);
    }
  }

  public async close(): Promise<void> {
    this.finishInput();
    await this.source.close();
  }

  public async interrupt(): Promise<unknown> {
    return this.source.interrupt();
  }

  public async rewindFiles(
    userMessageId: string,
    options: { dryRun?: boolean } = {},
  ): Promise<RewindFilesResult> {
    return this.toolset.rewind(userMessageId, options.dryRun);
  }

  public setUserMessageId(value: string): void {
    this.userMessageId = value;
  }
}

export function resolveQwenConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): QwenConfiguration {
  const apiKey =
    environment.OPENAI_API_KEY?.trim() || environment.QWEN_API_KEY?.trim();
  if (!apiKey) {
    throw new QwenAuthenticationError(
      "OPENAI_API_KEY or QWEN_API_KEY is required when AGENT_PROVIDER=qwen.",
    );
  }
  return {
    apiKey,
    baseUrl:
      environment.OPENAI_BASE_URL?.trim() ||
      environment.QWEN_BASE_URL?.trim() ||
      DEFAULT_QWEN_BASE_URL,
    model:
      environment.OPENAI_MODEL?.trim() ||
      environment.QWEN_MODEL?.trim() ||
      DEFAULT_QWEN_MODEL,
  };
}

export function qwenRuntimeProfile(mode: QoderAgentMode): {
  coreTools: string[];
  excludeTools: string[];
  toolNames: string[];
} {
  const readTools = [
    "accesspath_read",
    "accesspath_glob",
    "accesspath_grep",
  ];
  return {
    // The Qwen SDK omits --core-tools for an empty array. Registering one
    // blocked core tool keeps the CLI's core-tool allowlist active while MCP
    // remains the only usable tool surface.
    coreTools: ["read_file"],
    excludeTools: [...BLOCKED_QWEN_CORE_TOOLS],
    toolNames:
      mode === "planning"
        ? []
        : mode === "diagnosis"
          ? readTools
          : [...readTools, "accesspath_edit", "accesspath_write"],
  };
}

export class DirectQwenCodeAdapter implements QoderAdapter {
  private readonly environment: NodeJS.ProcessEnv;
  private readonly execute: typeof qwenQuery;
  private readonly recoveryRoot?: string;

  public constructor(options: QwenCodeAdapterOptions = {}) {
    this.environment = options.environment ?? process.env;
    this.execute = options.query ?? qwenQuery;
    this.recoveryRoot = options.recoveryRoot;
  }

  public async inspectPersistedTurn(
    options: QoderAdapterRecoveryOptions,
  ): Promise<QoderTurnRecovery> {
    if (this.recoveryRoot === undefined) {
      return { status: "missing" };
    }
    try {
      const turn = JSON.parse(
        await readFile(
          qwenRecoveryPath(
            this.recoveryRoot,
            options.sessionId,
            options.userMessageId,
          ),
          "utf8",
        ),
      ) as unknown;
      if (
        typeof turn !== "object" ||
        turn === null ||
        (turn as { userMessageId?: unknown }).userMessageId !==
          options.userMessageId
      ) {
        return { status: "missing" };
      }
      return {
        status: "completed",
        turn: turn as RecoveredRepairTurn,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { status: "missing" };
      }
      throw error;
    }
  }

  public start(options: QoderAdapterStartOptions): QoderAdapterSession {
    const configuration = resolveQwenConfiguration(this.environment);
    const profile = qwenRuntimeProfile(options.mode);
    const runtimeRoot =
      options.env.ACCESSPATH_QWEN_TEMP ??
      options.env.ACCESSPATH_QODER_TEMP ??
      (this.recoveryRoot === undefined
        ? undefined
        : join(this.recoveryRoot, "runtime"));
    const toolset = new QwenToolset(options);
    let releaseInput!: () => void;
    const inputFinished = new Promise<void>((resolve) => {
      releaseInput = resolve;
    });
    const prompt = async function* (): AsyncIterable<QwenSdkUserMessage> {
      for await (const message of options.prompt) {
        if (message.uuid !== undefined) {
          session.setUserMessageId(message.uuid);
          toolset.setUserMessageId(message.uuid);
        }
        yield message as unknown as QwenSdkUserMessage;
      }
      // Qwen's embedded MCP server sends tool responses over the same SDK
      // input channel. Keep that channel open until the agent ends the turn.
      await inputFinished;
    };
    const query = this.execute({
      prompt: prompt(),
      options: {
        authType: "openai",
        coreTools: profile.coreTools,
        cwd: options.cwd,
        env: qwenChildEnvironment(configuration, runtimeRoot),
        excludeTools: profile.excludeTools,
        includePartialMessages: true,
        maxSessionTurns: qwenSessionTurnLimit(options),
        mcpServers:
          options.mode === "planning"
            ? {}
            : { accesspath: toolset.server() },
        model: configuration.model,
        permissionMode: "default",
        stderr:
          process.env.ACCESSPATH_QWEN_WORKER === "1"
            ? (message) => process.stderr.write(message)
            : () => undefined,
        systemPrompt:
          "You are an AccessPath code agent. Use only the host-provided AccessPath MCP tools. Do not use commands, browsers, external MCP servers, subagents, or unapproved files. Keep changes minimal and follow the user's task exactly.",
        ...(options.resume
          ? { resume: options.sessionId }
          : { sessionId: options.sessionId }),
      },
    });
    const session = new QwenSession(
      query,
      this.recoveryRoot,
      options.sessionId,
      toolset,
      releaseInput,
    );
    return session;
  }
}

type WorkerMessage =
  | { type: "closed" }
  | { message: SDKMessage; type: "message" }
  | { requestId: string; type: "rewind-result"; value: RewindFilesResult }
  | {
      input: Record<string, unknown>;
      requestId: string;
      toolName: "Edit" | "Glob" | "Grep" | "Read" | "Write";
      type: "authorize";
    }
  | { message: string; type: "error" };

class AsyncWorkerQueue<Value> implements AsyncIterable<Value> {
  private done = false;
  private failure?: Error;
  private readonly values: Value[] = [];
  private readonly waiting: Array<
    (result: IteratorResult<Value>) => void
  > = [];

  public push(value: Value): void {
    const next = this.waiting.shift();
    if (next !== undefined) {
      next({ done: false, value });
    } else if (!this.done) {
      this.values.push(value);
    }
  }

  public close(): void {
    if (this.done) {
      return;
    }
    this.done = true;
    for (const resolve of this.waiting.splice(0)) {
      resolve({ done: true, value: undefined });
    }
  }

  public fail(error: Error): void {
    if (this.done) {
      return;
    }
    this.failure = error;
    this.close();
  }

  public [Symbol.asyncIterator](): AsyncIterator<Value> {
    return {
      next: async () => {
        const value = this.values.shift();
        if (value !== undefined) {
          return { done: false, value };
        }
        if (this.failure !== undefined) {
          throw this.failure;
        }
        if (this.done) {
          return { done: true, value: undefined };
        }
        return new Promise<IteratorResult<Value>>((resolve) => {
          this.waiting.push(resolve);
        });
      },
    };
  }
}

function qwenWorkerEnvironment(
  configuration: QwenConfiguration,
  runtimeRoot: string | undefined,
  recoveryRoot: string | undefined,
): NodeJS.ProcessEnv {
  const home = prepareQwenRuntime(configuration, runtimeRoot);
  const allowedSystem = [
    "ComSpec",
    "PATH",
    "Path",
    "PATHEXT",
    "SystemRoot",
    "SYSTEMROOT",
    "WINDIR",
  ] as const;
  const environment: NodeJS.ProcessEnv = {};
  for (const name of allowedSystem) {
    if (process.env[name] !== undefined) {
      environment[name] = process.env[name];
    }
  }
  return {
    ...environment,
    ACCESSPATH_QWEN_WORKER: "1",
    ...(recoveryRoot === undefined
      ? {}
      : { ACCESSPATH_QWEN_RECOVERY_ROOT: recoveryRoot }),
    APPDATA: home,
    HOME: home,
    LOCALAPPDATA: home,
    OPENAI_API_KEY: configuration.apiKey,
    OPENAI_BASE_URL: configuration.baseUrl,
    OPENAI_MODEL: configuration.model,
    QWEN_API_KEY: configuration.apiKey,
    QWEN_BASE_URL: configuration.baseUrl,
    QWEN_CODE_ENABLE_AGENT_TEAM: "0",
    QWEN_HOME: home,
    QWEN_MODEL: configuration.model,
    QWEN_RUNTIME_DIR: join(home, "runtime"),
    TEMP: join(home, "tmp"),
    TMP: join(home, "tmp"),
    USERPROFILE: home,
  };
}

class WorkerQwenSession implements QoderAdapterSession {
  private readonly queue = new AsyncWorkerQueue<SDKMessage>();
  private readonly rewindRequests = new Map<
    string,
    {
      reject: (error: Error) => void;
      resolve: (value: RewindFilesResult) => void;
    }
  >();
  private inputStarted = false;
  private output = "";
  private stderr = "";
  private closed = false;
  private approvedDiagnosisReads = 0;
  private receivedTerminalResult = false;

  public constructor(
    private readonly child: ReturnType<typeof spawn>,
    private readonly options: QoderAdapterStartOptions,
  ) {
    if (
      child.stdin === null ||
      child.stdout === null ||
      child.stderr === null
    ) {
      throw new Error("The Qwen worker did not expose standard streams.");
    }
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      this.output += chunk;
      const lines = this.output.split(/\r?\n/);
      this.output = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim() !== "") {
          this.receive(line);
        }
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-MAX_WORKER_STDERR_LENGTH);
    });
    child.once("error", (error) => this.fail(error));
    child.once("exit", (code) => {
      if (!this.closed) {
        if (this.receivedTerminalResult) {
          this.closed = true;
          this.queue.close();
          return;
        }
        this.finishWithoutTerminalResult(
          `The Qwen worker stopped with code ${code ?? "unknown"} before producing a terminal result.`,
        );
      }
    });
  }

  private send(value: Record<string, unknown>): void {
    if (this.child.stdin?.destroyed !== false) {
      throw new Error("The Qwen worker is unavailable.");
    }
    this.child.stdin.write(`${JSON.stringify(value)}\n`);
  }

  private fail(error: Error): void {
    this.closed = true;
    this.queue.fail(error);
    for (const request of this.rewindRequests.values()) {
      request.reject(error);
    }
    this.rewindRequests.clear();
  }

  private finishWithoutTerminalResult(summary: string): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    const detail = this.stderr.trim();
    this.queue.push({
      errors: [
        detail
          ? `${summary} Worker output: ${detail}`
          : summary,
      ],
      subtype: "error",
      type: "result",
    } as unknown as SDKMessage);
    this.queue.close();
    for (const request of this.rewindRequests.values()) {
      request.reject(new Error(summary));
    }
    this.rewindRequests.clear();
  }

  private receive(line: string): void {
    let message: WorkerMessage;
    try {
      message = JSON.parse(line) as WorkerMessage;
    } catch {
      this.fail(new Error("The Qwen worker emitted an invalid protocol message."));
      return;
    }
    if (message.type === "message") {
      this.queue.push(message.message);
      // Qwen keeps the SDK worker alive for follow-up control requests. The
      // AccessPath runner needs a terminal result to end a single repair turn
      // before it asks the same worker for a rewind preview.
      if (message.message.type === "result") {
        this.receivedTerminalResult = true;
        this.queue.close();
      }
      return;
    }
    if (message.type === "authorize") {
      void this.authorize(message);
      return;
    }
    if (message.type === "rewind-result") {
      const request = this.rewindRequests.get(message.requestId);
      if (request !== undefined) {
        this.rewindRequests.delete(message.requestId);
        request.resolve(message.value);
      }
      return;
    }
    if (message.type === "error") {
      this.fail(new Error(message.message));
      return;
    }
    if (!this.receivedTerminalResult) {
      this.finishWithoutTerminalResult(
        "The Qwen worker ended without a terminal result.",
      );
      return;
    }
    this.closed = true;
    this.queue.close();
  }

  private async authorize(
    request: Extract<WorkerMessage, { type: "authorize" }>,
  ): Promise<void> {
    try {
      let decision = await this.options.canUseTool(
        request.toolName,
        request.input,
        {
          signal: this.options.signal ?? new AbortController().signal,
          toolUseID: request.requestId,
        },
      );
      if (
        this.options.mode === "diagnosis" &&
        decision.behavior !== "deny" &&
        this.approvedDiagnosisReads >= 2
      ) {
        decision = {
          behavior: "deny",
          message:
            "The diagnosis inspection limit has been reached. Use the validated findings and completed reads to return the repair note now.",
        };
      } else if (
        this.options.mode === "diagnosis" &&
        decision.behavior !== "deny"
      ) {
        this.approvedDiagnosisReads += 1;
      }
      this.send({
        decision,
        requestId: request.requestId,
        type: "authorization",
      });
    } catch (error) {
      this.send({
        decision: {
          behavior: "deny",
          message: error instanceof Error ? error.message : "Tool authorization failed.",
        },
        requestId: request.requestId,
        type: "authorization",
      });
    }
  }

  private async startInput(): Promise<void> {
    if (this.inputStarted) {
      return;
    }
    this.inputStarted = true;
    const iterator = this.options.prompt[Symbol.asyncIterator]();
    const first = await iterator.next();
    if (first.done) {
      throw new Error("The Qwen worker requires an initial user message.");
    }
    this.send({
      options: {
        cwd: this.options.cwd,
        env: this.options.env,
        maxTurns: this.options.maxTurns,
        mode: this.options.mode,
        model: this.options.model,
        resume: this.options.resume,
        sessionId: this.options.sessionId,
      },
      prompt: [first.value],
      type: "start",
    });
  }

  public async *[Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    await this.startInput();
    yield* this.queue;
  }

  public async close(): Promise<void> {
    if (!this.closed) {
      this.closed = true;
      try {
        this.send({ type: "close" });
      } catch {
        // The process already exited.
      }
    }
    this.queue.close();
    if (!this.child.killed) {
      this.child.kill();
    }
  }

  public async interrupt(): Promise<unknown> {
    return this.send({ type: "interrupt" });
  }

  public async rewindFiles(
    userMessageId: string,
    options: { dryRun?: boolean } = {},
  ): Promise<RewindFilesResult> {
    const requestId = `qwen-rewind-${randomUUID()}`;
    const result = new Promise<RewindFilesResult>((resolve, reject) => {
      this.rewindRequests.set(requestId, { reject, resolve });
    });
    this.send({
      dryRun: options.dryRun === true,
      requestId,
      type: "rewind",
      userMessageId,
    });
    return result;
  }
}

export class QwenCodeAdapter implements QoderAdapter {
  private readonly environment: NodeJS.ProcessEnv;
  private readonly recoveryRoot?: string;

  public constructor(options: QwenCodeAdapterOptions = {}) {
    this.environment = options.environment ?? process.env;
    this.recoveryRoot = options.recoveryRoot;
  }

  public async inspectPersistedTurn(
    options: QoderAdapterRecoveryOptions,
  ): Promise<QoderTurnRecovery> {
    return new DirectQwenCodeAdapter({
      environment: this.environment,
      recoveryRoot: this.recoveryRoot,
    }).inspectPersistedTurn(options);
  }

  public start(options: QoderAdapterStartOptions): QoderAdapterSession {
    const configuration = resolveQwenConfiguration(this.environment);
    const runtimeRoot =
      options.env.ACCESSPATH_QWEN_TEMP ??
      options.env.ACCESSPATH_QODER_TEMP ??
      (this.recoveryRoot === undefined
        ? undefined
        : join(this.recoveryRoot, "runtime"));
    const workerPath = fileURLToPath(new URL("./qwen-worker.ts", import.meta.url));
    const child = spawn(
      process.execPath,
      ["--import", "tsx", workerPath],
      {
        cwd: process.cwd(),
        env: qwenWorkerEnvironment(
          configuration,
          runtimeRoot,
          this.recoveryRoot,
        ),
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    return new WorkerQwenSession(child, options);
  }
}
