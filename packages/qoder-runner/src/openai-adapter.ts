import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, relative } from "node:path";

import type {
  RewindFilesResult,
  SDKMessage,
  SDKUserMessage,
} from "@qoder-ai/qoder-agent-sdk";

import { OpenAiAuthenticationError } from "./errors";
import { matchesAllowedPath, resolveWorktreePath } from "./policy";
import type {
  QoderAdapter,
  QoderAdapterSession,
  QoderAdapterStartOptions,
  QoderAgentMode,
} from "./types";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OPENAI_MODEL = "gpt-5-mini";
const MAX_FILE_READ_BYTES = 256_000;
const MAX_SEARCH_FILE_BYTES = 512_000;
const MAX_SEARCH_RESULTS = 100;
const MAX_TREE_ENTRIES = 2_000;

type ToolName =
  | "accesspath_read"
  | "accesspath_glob"
  | "accesspath_grep"
  | "accesspath_edit"
  | "accesspath_write";

type PolicyToolName = "Edit" | "Glob" | "Grep" | "Read" | "Write";

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

interface OpenAiFunctionCall {
  arguments: string;
  callId: string;
  name: ToolName;
}

interface OpenAiOutputItem {
  arguments?: unknown;
  call_id?: unknown;
  content?: Array<{ text?: unknown; type?: unknown }>;
  name?: unknown;
  type?: unknown;
}

interface OpenAiResponse {
  id?: string;
  output?: OpenAiOutputItem[];
  output_text?: unknown;
}

export interface OpenAiConfiguration {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface OpenAiCodeAdapterOptions {
  environment?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
}

export function resolveOpenAiConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): OpenAiConfiguration {
  const apiKey = environment.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new OpenAiAuthenticationError(
      "OPENAI_API_KEY is required when AGENT_PROVIDER=openai.",
    );
  }
  return {
    apiKey,
    baseUrl:
      environment.OPENAI_BASE_URL?.trim() || DEFAULT_OPENAI_BASE_URL,
    model: environment.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL,
  };
}

function textFromUserMessage(message: SDKUserMessage): string {
  const content = message.message.content;
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    throw new Error("The OpenAI adapter requires a text user message.");
  }
  const text = content
    .filter(
      (block): block is { text: string; type: "text" } =>
        block.type === "text" && typeof block.text === "string",
    )
    .map((block) => block.text)
    .join("\n");
  if (!text.trim()) {
    throw new Error("The OpenAI adapter received an empty user message.");
  }
  return text;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function requiredString(
  input: Record<string, unknown>,
  name: string,
): string | undefined {
  const value = input[name];
  return typeof value === "string" && value.trim() ? value : undefined;
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
      const absolutePath = `${directory}\\${entry.name}`;
      if (entry.isDirectory()) {
        await walk(absolutePath);
      } else if (entry.isFile()) {
        await visit(
          absolutePath,
          relative(root, absolutePath).replaceAll("\\", "/"),
        );
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
    throw new Error(
      `The selected file exceeds the ${maximumBytes}-byte read limit.`,
    );
  }
  return content.toString("utf8");
}

function toolDefinitions(mode: QoderAgentMode): Array<Record<string, unknown>> {
  const read = [
    {
      type: "function",
      name: "accesspath_read",
      description:
        "Read one approved source file. file_path is relative to the worktree.",
      strict: true,
      parameters: {
        type: "object",
        properties: { file_path: { type: "string" } },
        required: ["file_path"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "accesspath_glob",
      description:
        "List files below an approved directory. path and pattern are relative to the worktree.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          pattern: { type: "string" },
        },
        required: ["path", "pattern"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "accesspath_grep",
      description:
        "Find literal text in approved source files. query is literal text, not a regular expression.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          query: { type: "string" },
          glob: { type: ["string", "null"] },
        },
        required: ["path", "query", "glob"],
        additionalProperties: false,
      },
    },
  ];
  if (mode !== "repair") {
    return mode === "diagnosis" ? read : [];
  }
  return [
    ...read,
    {
      type: "function",
      name: "accesspath_edit",
      description:
        "Replace one exact, unique source string in an approved file.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          file_path: { type: "string" },
          old_string: { type: "string" },
          new_string: { type: "string" },
        },
        required: ["file_path", "old_string", "new_string"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "accesspath_write",
      description:
        "Write an approved source file. This is restricted to the approved repair scope.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          file_path: { type: "string" },
          content: { type: "string" },
        },
        required: ["file_path", "content"],
        additionalProperties: false,
      },
    },
  ];
}

class OpenAiToolset {
  private readonly rewindEntries = new Map<string, RewindEntry[]>();
  private userMessageId?: string;

  public constructor(private readonly options: QoderAdapterStartOptions) {}

  public setUserMessageId(value: string): void {
    this.userMessageId = value;
  }

  public definitions(): Array<Record<string, unknown>> {
    return toolDefinitions(this.options.mode);
  }

  private async authorize(
    toolName: PolicyToolName,
    input: Record<string, unknown>,
    toolUseId: string,
  ): Promise<{ allowed: boolean; reason?: string }> {
    const decision = await this.options.canUseTool(toolName, input, {
      signal: this.options.signal ?? new AbortController().signal,
      toolUseID: toolUseId,
    });
    return decision.behavior === "allow"
      ? { allowed: true }
      : { allowed: false, reason: decision.message };
  }

  private entries(): RewindEntry[] {
    if (this.userMessageId === undefined) {
      throw new Error(
        "OpenAI code tools started before the user turn was identified.",
      );
    }
    const existing = this.rewindEntries.get(this.userMessageId);
    if (existing !== undefined) {
      return existing;
    }
    const created: RewindEntry[] = [];
    this.rewindEntries.set(this.userMessageId, created);
    return created;
  }

  private requireWorktree(): string {
    if (this.options.cwd === undefined) {
      throw new Error("OpenAI code tools require an approved repair worktree.");
    }
    return this.options.cwd;
  }

  public async execute(
    name: ToolName,
    rawInput: unknown,
    toolUseId: string,
  ): Promise<string> {
    const input = asRecord(rawInput);
    if (input === undefined) {
      return "Tool input must be a JSON object.";
    }
    try {
      switch (name) {
        case "accesspath_read":
          return await this.read(input, toolUseId);
        case "accesspath_glob":
          return await this.glob(input, toolUseId);
        case "accesspath_grep":
          return await this.grep(input, toolUseId);
        case "accesspath_edit":
          return await this.edit(input, toolUseId);
        case "accesspath_write":
          return await this.write(input, toolUseId);
      }
    } catch (error) {
      return error instanceof Error ? error.message : "The tool failed.";
    }
  }

  private async read(
    input: Record<string, unknown>,
    toolUseId: string,
  ): Promise<string> {
    const filePath = requiredString(input, "file_path");
    if (filePath === undefined) {
      return "file_path must be a non-empty string.";
    }
    const approved = await this.authorize(
      "Read",
      { file_path: filePath },
      toolUseId,
    );
    if (!approved.allowed) {
      return approved.reason ?? "Read was denied.";
    }
    const target = await resolveWorktreePath(this.requireWorktree(), filePath);
    return readTextAtMost(target.absolutePath, MAX_FILE_READ_BYTES);
  }

  private async glob(
    input: Record<string, unknown>,
    toolUseId: string,
  ): Promise<string> {
    const path = requiredString(input, "path");
    const pattern = requiredString(input, "pattern");
    if (path === undefined || pattern === undefined) {
      return "path and pattern must be non-empty strings.";
    }
    const approved = await this.authorize("Glob", { path, pattern }, toolUseId);
    if (!approved.allowed) {
      return approved.reason ?? "Glob was denied.";
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
    return files.sort().slice(0, MAX_SEARCH_RESULTS).join("\n");
  }

  private async grep(
    input: Record<string, unknown>,
    toolUseId: string,
  ): Promise<string> {
    const path = requiredString(input, "path");
    const query = requiredString(input, "query");
    const pattern = typeof input.glob === "string" ? input.glob : undefined;
    if (path === undefined || query === undefined) {
      return "path and query must be non-empty strings.";
    }
    const approved = await this.authorize(
      "Grep",
      {
        path,
        query,
        ...(pattern === undefined ? {} : { glob: pattern }),
      },
      toolUseId,
    );
    if (!approved.allowed) {
      return approved.reason ?? "Search was denied.";
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
    return matches.join("\n");
  }

  private async edit(
    input: Record<string, unknown>,
    toolUseId: string,
  ): Promise<string> {
    const filePath = requiredString(input, "file_path");
    const oldString = requiredString(input, "old_string");
    const newString = typeof input.new_string === "string"
      ? input.new_string
      : undefined;
    if (
      filePath === undefined ||
      oldString === undefined ||
      newString === undefined
    ) {
      return "file_path and old_string must be non-empty strings; new_string must be a string.";
    }
    const approved = await this.authorize(
      "Edit",
      {
        file_path: filePath,
        old_string: oldString,
        new_string: newString,
      },
      toolUseId,
    );
    if (!approved.allowed) {
      return approved.reason ?? "Edit was denied.";
    }
    const target = await resolveWorktreePath(this.requireWorktree(), filePath);
    const original = await readTextAtMost(
      target.absolutePath,
      MAX_FILE_READ_BYTES,
    );
    const occurrences = original.split(oldString).length - 1;
    if (occurrences !== 1) {
      return occurrences === 0
        ? "The exact old_string was not found."
        : "The exact old_string is ambiguous; narrow the edit first.";
    }
    this.entries().push({
      action: "restore",
      ...target,
      content: original,
    });
    await writeFile(
      target.absolutePath,
      original.replace(oldString, newString),
      "utf8",
    );
    return `Updated ${target.relativePath}.`;
  }

  private async write(
    input: Record<string, unknown>,
    toolUseId: string,
  ): Promise<string> {
    const filePath = requiredString(input, "file_path");
    const content = typeof input.content === "string" ? input.content : undefined;
    if (filePath === undefined || content === undefined) {
      return "file_path must be a non-empty string and content must be a string.";
    }
    const approved = await this.authorize(
      "Write",
      {
        file_path: filePath,
        content,
      },
      toolUseId,
    );
    if (!approved.allowed) {
      return approved.reason ?? "Write was denied.";
    }
    const target = await resolveWorktreePath(this.requireWorktree(), filePath);
    let original: string | undefined;
    try {
      original = await readTextAtMost(target.absolutePath, MAX_FILE_READ_BYTES);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
    this.entries().push(
      original === undefined
        ? { action: "delete", ...target }
        : { action: "restore", ...target, content: original },
    );
    await mkdir(dirname(target.absolutePath), { recursive: true });
    await writeFile(target.absolutePath, content, "utf8");
    return `Wrote ${target.relativePath}.`;
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

function streamEvent(text: string, sessionId: string): SDKMessage {
  return {
    event: {
      delta: { text, type: "text_delta" },
      index: 0,
      type: "content_block_delta",
    },
    parent_tool_use_id: null,
    session_id: sessionId,
    type: "stream_event",
    uuid: randomUUID(),
  } as unknown as SDKMessage;
}

function assistantMessage(text: string, sessionId: string): SDKMessage {
  return {
    message: {
      content: [{ text, type: "text" }],
      role: "assistant",
    },
    parent_tool_use_id: null,
    session_id: sessionId,
    type: "assistant",
    uuid: randomUUID(),
  } as unknown as SDKMessage;
}

function toolResultMessage(toolUseId: string, sessionId: string): SDKMessage {
  return {
    parent_tool_use_id: null,
    session_id: sessionId,
    tool_use_result: { tool_use_id: toolUseId },
    type: "user",
    uuid: randomUUID(),
  } as unknown as SDKMessage;
}

function resultMessage(
  result: string,
  sessionId: string,
  numTurns: number,
): SDKMessage {
  return {
    duration_api_ms: 0,
    duration_ms: 0,
    modelUsage: {},
    num_turns: numTurns,
    result,
    session_id: sessionId,
    stop_reason: null,
    subtype: "success",
    total_cost_usd: 0,
    type: "result",
    usage: {
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      input_tokens: 0,
      output_tokens: 0,
    },
  } as unknown as SDKMessage;
}

function errorResult(
  error: unknown,
  sessionId: string,
  numTurns: number,
): SDKMessage {
  return {
    errors: [error instanceof Error ? error.message : String(error)],
    subtype: "error",
    type: "result",
    session_id: sessionId,
    num_turns: numTurns,
  } as unknown as SDKMessage;
}

async function* sseEvents(response: Response): AsyncGenerator<unknown> {
  if (response.body === null) {
    throw new Error("The OpenAI response did not include a streaming body.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventData: string[] = [];
  const emit = function* (): Generator<unknown> {
    if (eventData.length === 0) {
      return;
    }
    const data = eventData.join("\n");
    eventData = [];
    if (data === "[DONE]") {
      return;
    }
    try {
      yield JSON.parse(data) as unknown;
    } catch {
      throw new Error("The OpenAI stream returned invalid JSON.");
    }
  };

  while (true) {
    const next = await reader.read();
    buffer += decoder.decode(next.value, { stream: !next.done });
    const lines = buffer.split(/\r?\n/);
    buffer = next.done ? "" : (lines.pop() ?? "");
    for (const line of lines) {
      if (line === "") {
        yield* emit();
      } else if (line.startsWith("data:")) {
        eventData.push(line.slice(5).trimStart());
      }
    }
    if (next.done) {
      yield* emit();
      return;
    }
  }
}

function eventRecord(value: unknown): Record<string, unknown> | undefined {
  return asRecord(value);
}

function functionCallFromOutput(
  value: OpenAiOutputItem,
): OpenAiFunctionCall | undefined {
  if (
    value.type !== "function_call" ||
    typeof value.call_id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.arguments !== "string"
  ) {
    return undefined;
  }
  if (!value.name.startsWith("accesspath_")) {
    return undefined;
  }
  return {
    arguments: value.arguments,
    callId: value.call_id,
    name: value.name as ToolName,
  };
}

function finalText(response: OpenAiResponse | undefined): string {
  if (typeof response?.output_text === "string") {
    return response.output_text;
  }
  return response?.output
    ?.flatMap((item) =>
      item.type === "message"
        ? (item.content ?? [])
            .filter(
              (content): content is { text: string; type: "output_text" } =>
                content.type === "output_text" &&
                typeof content.text === "string",
            )
            .map((content) => content.text)
        : [],
    )
    .join("\n") ?? "";
}

class OpenAiSession implements QoderAdapterSession {
  private readonly controller = new AbortController();
  private readonly toolset: OpenAiToolset;
  private started = false;
  private userMessageId?: string;

  public constructor(
    private readonly configuration: OpenAiConfiguration,
    private readonly executeFetch: typeof fetch,
    private readonly options: QoderAdapterStartOptions,
  ) {
    this.toolset = new OpenAiToolset(options);
    if (options.signal?.aborted) {
      this.controller.abort(options.signal.reason);
    } else {
      options.signal?.addEventListener(
        "abort",
        () => this.controller.abort(options.signal?.reason),
        { once: true },
      );
    }
  }

  private async initialPrompt(): Promise<string> {
    const iterator = this.options.prompt[Symbol.asyncIterator]();
    const first = await iterator.next();
    if (first.done) {
      throw new Error("The OpenAI adapter requires an initial user message.");
    }
    this.userMessageId = first.value.uuid ?? randomUUID();
    this.toolset.setUserMessageId(this.userMessageId);
    return textFromUserMessage(first.value);
  }

  private async request(
    input: unknown[],
    previousResponseId: string | undefined,
  ): Promise<Response> {
    const url = `${this.configuration.baseUrl.replace(/\/+$/, "")}/responses`;
    const response = await this.executeFetch(url, {
      method: "POST",
      headers: {
        Accept: "text/event-stream",
        Authorization: `Bearer ${this.configuration.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input,
        model: this.configuration.model,
        parallel_tool_calls: false,
        stream: true,
        tools: this.toolset.definitions(),
        ...(previousResponseId === undefined
          ? {
              instructions:
                "You are an AccessPath code agent. Use only the host-provided AccessPath tools. Do not use commands, browsers, external services, or unapproved files. Keep changes minimal and follow the task exactly.",
            }
          : { previous_response_id: previousResponseId }),
      }),
      signal: this.controller.signal,
    });
    if (response.ok) {
      return response;
    }
    const detail = (await response.text()).slice(0, 2_000);
    if (response.status === 401) {
      throw new OpenAiAuthenticationError(
        `OpenAI rejected the configured API key (HTTP 401). ${detail}`,
      );
    }
    throw new Error(
      `OpenAI Responses API request failed (HTTP ${response.status}). ${detail}`,
    );
  }

  public async *[Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    if (this.started) {
      throw new Error("The OpenAI adapter session can only be consumed once.");
    }
    this.started = true;
    let turns = 0;
    let previousResponseId: string | undefined;
    let input: unknown[] = [
      {
        role: "user",
        content: [{ type: "input_text", text: await this.initialPrompt() }],
      },
    ];
    const completed: string[] = [];

    try {
      while (turns < this.options.maxTurns) {
        turns += 1;
        const response = await this.request(input, previousResponseId);
        let completedResponse: OpenAiResponse | undefined;
        const calls = new Map<string, OpenAiFunctionCall>();
        let text = "";

        for await (const item of sseEvents(response)) {
          const event = eventRecord(item);
          if (event?.type === "response.output_text.delta") {
            const delta = event.delta;
            if (typeof delta === "string") {
              text += delta;
              yield streamEvent(delta, this.options.sessionId);
            }
            continue;
          }
          if (event?.type === "response.function_call_arguments.done") {
            const name = event.name;
            const callId = event.call_id;
            const args = event.arguments;
            if (
              typeof name === "string" &&
              typeof callId === "string" &&
              typeof args === "string" &&
              name.startsWith("accesspath_")
            ) {
              calls.set(callId, {
                arguments: args,
                callId,
                name: name as ToolName,
              });
            }
            continue;
          }
          if (event?.type === "response.output_item.done") {
            const call = functionCallFromOutput(
              event.item as OpenAiOutputItem,
            );
            if (call !== undefined) {
              calls.set(call.callId, call);
            }
            continue;
          }
          if (event?.type === "response.completed") {
            completedResponse = event.response as OpenAiResponse;
            for (const call of completedResponse.output ?? []) {
              const parsed = functionCallFromOutput(call);
              if (parsed !== undefined) {
                calls.set(parsed.callId, parsed);
              }
            }
            continue;
          }
          if (event?.type === "error") {
            const nested = event.error as { message?: unknown } | undefined;
            throw new Error(
              typeof nested?.message === "string"
                ? nested.message
                : "OpenAI Responses API returned a stream error.",
            );
          }
        }

        const responseText = text || finalText(completedResponse);
        if (responseText.trim()) {
          completed.push(responseText);
          yield assistantMessage(responseText, this.options.sessionId);
        }
        if (calls.size === 0) {
          yield resultMessage(
            completed.join("\n\n").trim(),
            this.options.sessionId,
            turns,
          );
          return;
        }

        previousResponseId = completedResponse?.id;
        if (previousResponseId === undefined) {
          throw new Error(
            "OpenAI Responses API returned tool calls without a response id.",
          );
        }
        const toolOutputs: unknown[] = [];
        for (const call of calls.values()) {
          let output: string;
          try {
            output = await this.toolset.execute(
              call.name,
              JSON.parse(call.arguments) as unknown,
              call.callId,
            );
          } catch {
            output = "Tool input was not valid JSON.";
          }
          toolOutputs.push({
            type: "function_call_output",
            call_id: call.callId,
            output,
          });
          yield toolResultMessage(call.callId, this.options.sessionId);
        }
        input = toolOutputs;
      }
      throw new Error(
        `The OpenAI agent reached the ${this.options.maxTurns}-turn limit before completing the task.`,
      );
    } catch (error) {
      yield errorResult(error, this.options.sessionId, turns);
    }
  }

  public async close(): Promise<void> {
    this.controller.abort();
  }

  public async interrupt(): Promise<unknown> {
    this.controller.abort();
    return undefined;
  }

  public async rewindFiles(
    userMessageId: string,
    options: { dryRun?: boolean } = {},
  ): Promise<RewindFilesResult> {
    return this.toolset.rewind(userMessageId, options.dryRun);
  }
}

export class OpenAiCodeAdapter implements QoderAdapter {
  private readonly environment: NodeJS.ProcessEnv;
  private readonly executeFetch: typeof fetch;

  public constructor(options: OpenAiCodeAdapterOptions = {}) {
    this.environment = options.environment ?? process.env;
    this.executeFetch = options.fetch ?? fetch;
  }

  public start(options: QoderAdapterStartOptions): QoderAdapterSession {
    return new OpenAiSession(
      resolveOpenAiConfiguration(this.environment),
      this.executeFetch,
      options,
    );
  }
}

export { toolDefinitions as openAiToolDefinitions };
