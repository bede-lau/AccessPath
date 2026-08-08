import { randomUUID } from "node:crypto";
import { mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";

import type {
  SDKMessage,
  SDKUserMessage,
} from "@qoder-ai/qoder-agent-sdk";
import {
  TaskContractSchema,
  type TaskContract,
} from "@accesspath/contracts";

import { createToolPolicy } from "./policy";
import {
  diagnosisContinuationPrompt,
  diagnosisPrompt,
  planningPrompt,
  repairContinuationPrompt,
  repairPrompt,
} from "./prompts";
import { normalizeQoderError } from "./errors";
import {
  qoderChildEnvironment,
  resolveQoderAuth,
} from "./sdk-adapter";
import { createAgentAdapter } from "./provider";
import type {
  MissionPlanningOptions,
  MissionPlanningResult,
  RepairSessionHandle,
  RepairSessionOptions,
  RepairTurnResult,
  RunnerEvent,
} from "./types";

const MAX_PLANNING_OUTPUT_LENGTH = 256_000;

export function qoderTurnPolicy(options: Pick<
  RepairSessionOptions,
  "approvedPlan" | "manifest" | "maxTurns" | "mode" | "model"
>): {
  maxTurns: number;
  model: "efficient" | "performance";
} {
  const complexRepair =
    options.mode === "repair" &&
    (options.manifest.findingIds.length > 1 ||
      options.manifest.allowedPathGlobs.length > 4 ||
      (options.approvedPlan?.length ?? 0) > 3_000);
  return {
    maxTurns:
      options.maxTurns ??
      // Keep one response turn available after the bounded diagnosis reads so
      // the agent can return the repair note instead of stopping at the cap.
      (options.mode === "diagnosis" ? 6 : complexRepair ? 10 : 8),
    model:
      options.model ??
      (complexRepair ? "performance" : "efficient"),
  };
}

class AsyncMessageQueue implements AsyncIterable<SDKUserMessage> {
  private ended = false;
  private readonly queued: SDKUserMessage[] = [];
  private readonly waiting: Array<
    (result: IteratorResult<SDKUserMessage>) => void
  > = [];

  public push(message: SDKUserMessage): void {
    if (this.ended) {
      throw new Error("The Qoder input stream is closed.");
    }
    const waiter = this.waiting.shift();
    if (waiter) {
      waiter({ done: false, value: message });
    } else {
      this.queued.push(message);
    }
  }

  public close(): void {
    if (this.ended) {
      return;
    }
    this.ended = true;
    for (const waiter of this.waiting.splice(0)) {
      waiter({ done: true, value: undefined });
    }
  }

  public [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: async () => {
        const message = this.queued.shift();
        if (message) {
          return { done: false, value: message };
        }
        if (this.ended) {
          return { done: true, value: undefined };
        }
        return new Promise<IteratorResult<SDKUserMessage>>((resolve) => {
          this.waiting.push(resolve);
        });
      },
    };
  }
}

function deferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function replaceAllCaseInsensitive(
  value: string,
  secret: string | undefined,
  replacement: string,
): string {
  if (!secret) {
    return value;
  }
  return value.replace(
    new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"),
    replacement,
  );
}

export function redactRunnerText(
  value: string,
  options: {
    artifactRoot?: string;
    environment?: NodeJS.ProcessEnv;
    worktreePath?: string;
  } = {},
): string {
  let redacted = value;
  redacted = replaceAllCaseInsensitive(
    redacted,
    options.worktreePath,
    "[worktree]",
  );
  redacted = replaceAllCaseInsensitive(
    redacted,
    options.artifactRoot,
    "[artifact-root]",
  );
  redacted = replaceAllCaseInsensitive(
    redacted,
    options.environment?.QODER_PERSONAL_ACCESS_TOKEN,
    "[redacted]",
  );
  redacted = replaceAllCaseInsensitive(
    redacted,
    options.environment?.QWEN_API_KEY,
    "[redacted]",
  );
  redacted = replaceAllCaseInsensitive(
    redacted,
    options.environment?.OPENAI_API_KEY,
    "[redacted]",
  );
  return redacted
    .replace(
      /\b(authorization\s*:\s*bearer|bearer)\s+[^\s,;]+/gi,
      "$1 [redacted]",
    )
    .replace(
      /\b(password|passwd|token|secret|cookie|set-cookie)\s*[:=]\s*[^\s,;]+/gi,
      "$1=[redacted]",
    )
    .replace(
      /([?&](?:access_token|api_key|password|token)=)[^&#\s]+/gi,
      "$1[redacted]",
    )
    .replace(
      /\b[A-Za-z]:\\Users\\[^\\\s]+\\[^\r\n"'<>]*/g,
      "[absolute-path]",
    )
    .replace(
      /\/(?:Users|home)\/[^/\s]+\/[^\r\n"'<>]*/g,
      "[absolute-path]",
    );
}

function textBlocks(message: SDKMessage): string[] {
  if (message.type !== "assistant") {
    return [];
  }
  const content = message.message.content;
  if (!Array.isArray(content)) {
    return [];
  }
  return content
    .filter(
      (block): block is { type: "text"; text: string } =>
        block.type === "text" && typeof block.text === "string",
    )
    .map((block) => block.text);
}

function streamDelta(message: SDKMessage): string | undefined {
  if (message.type !== "stream_event") {
    return undefined;
  }
  const event = message.event as {
    delta?: { text?: unknown; type?: unknown };
    type?: unknown;
  };
  return event.type === "content_block_delta" &&
    event.delta?.type === "text_delta" &&
    typeof event.delta.text === "string"
    ? event.delta.text
    : undefined;
}

function toolResultId(message: SDKMessage): string | undefined {
  if (message.type !== "user") {
    return undefined;
  }
  const result = message.tool_use_result as
    | { tool_use_id?: unknown }
    | undefined;
  return typeof result?.tool_use_id === "string"
    ? result.tool_use_id
    : undefined;
}

function planningValidationError(
  issues: readonly { message: string; path: PropertyKey[] }[],
): string {
  return issues
    .slice(0, 8)
    .map((issue) => {
      const path = issue.path.length > 0
        ? issue.path.map(String).join(".")
        : "<root>";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

function unwrapSingleJsonFence(output: string): string {
  const fenced = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i.exec(output);
  return fenced?.[1].trim() ?? output;
}

function applyPlanningDefaults(candidate: unknown): unknown {
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    Array.isArray(candidate)
  ) {
    return candidate;
  }
  const task = candidate as Record<string, unknown>;
  return {
    ...task,
    ...(task.viewport === undefined
      ? {
          viewport: {
            width: 1280,
            height: 800,
            deviceScaleFactor: 1,
          },
        }
      : {}),
    ...(task.timeoutMs === undefined ? { timeoutMs: 60_000 } : {}),
  };
}

export function parsePlannedTaskContract(output: string): TaskContract {
  const normalized = output.trim();
  if (!normalized) {
    throw new Error("Qoder mission planning returned an empty response.");
  }
  if (normalized.length > MAX_PLANNING_OUTPUT_LENGTH) {
    throw new Error(
      `Qoder mission planning output exceeds ${MAX_PLANNING_OUTPUT_LENGTH} characters.`,
    );
  }

  let candidate: unknown;
  try {
    candidate = JSON.parse(unwrapSingleJsonFence(normalized));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Qoder mission planning returned invalid JSON: ${detail}. Expected one JSON object, optionally wrapped in a single JSON markdown fence.`,
      { cause: error },
    );
  }

  const parsed = TaskContractSchema.safeParse(applyPlanningDefaults(candidate));
  if (!parsed.success) {
    throw new Error(
      `Qoder mission planning returned an invalid TaskContract: ${planningValidationError(parsed.error.issues)}`,
      { cause: parsed.error },
    );
  }
  return parsed.data;
}

function denyPlanningTool(
  toolName: string,
): Promise<{ behavior: "deny"; message: string }> {
  return Promise.resolve({
    behavior: "deny",
    message: `${toolName} is not available during AccessPath mission planning.`,
  });
}

export async function planTaskContract(
  options: MissionPlanningOptions,
): Promise<MissionPlanningResult> {
  const prompt = planningPrompt(options.reconnaissance, options.objective);
  const queue = new AsyncMessageQueue();
  const qoderSessionId = randomUUID();
  const userMessageId = randomUUID();
  queue.push({
    type: "user",
    message: {
      role: "user",
      content: [{ type: "text", text: prompt }],
    },
    parent_tool_use_id: null,
    uuid: userMessageId,
    session_id: qoderSessionId,
  });
  queue.close();

  const adapter = options.adapter ?? createAgentAdapter();
  const session = adapter.start({
    auth: resolveQoderAuth(options.authStrategy),
    canUseTool: denyPlanningTool,
    env: qoderChildEnvironment(),
    maxTurns: options.maxTurns ?? 2,
    mode: "planning",
    model: options.model ?? "efficient",
    prompt: queue,
    resume: false,
    sessionId: qoderSessionId,
    signal: options.signal,
  });

  try {
    for await (const message of session) {
      const delta = streamDelta(message);
      if (delta !== undefined) {
        await options.emit?.({
          type: "agent.message.delta",
          ephemeral: true,
          payload: { text: delta },
        });
      }
      for (const text of textBlocks(message)) {
        await options.emit?.({
          type: "agent.message.completed",
          payload: { text },
        });
      }
      if (message.type !== "result") {
        continue;
      }
      if (message.subtype !== "success") {
        throw normalizeQoderError(
          new Error(
            message.errors.join("\n") ||
              `Qoder mission planning failed with ${message.subtype}.`,
          ),
        );
      }
      const rawOutput = message.result.trim();
      return {
        qoderSessionId: message.session_id,
        rawOutput,
        task: parsePlannedTaskContract(rawOutput),
        userMessageId,
      };
    }
    throw new Error(
      "The Qoder mission planning session ended before producing a result.",
    );
  } catch (error) {
    throw normalizeQoderError(error);
  } finally {
    await session.close();
  }
}

export const compileTaskContract = planTaskContract;

export async function startRepairSession(
  options: RepairSessionOptions,
): Promise<RepairSessionHandle> {
  const worktreePath = await realpath(options.worktreePath);
  const artifactRoot = await realpath(options.artifactRoot);
  await mkdir(join(artifactRoot, "qoder-temp"), { recursive: true });

  const emit = async (event: RunnerEvent) => {
    const sanitized = JSON.parse(
      redactRunnerText(JSON.stringify(event), {
        artifactRoot,
        environment: process.env,
        worktreePath,
      }),
    ) as RunnerEvent;
    await options.emit?.(sanitized);
  };
  const queue = new AsyncMessageQueue();
  const qoderSessionId = options.qoderSessionId ?? randomUUID();
  const userMessageId = options.userMessageId ?? randomUUID();
  if (options.mode === "repair" && !options.approvedPlan?.trim()) {
    throw new Error("A repair turn requires the exact approved diagnosis plan.");
  }
  const prompt = options.continuation
    ? options.mode === "diagnosis"
      ? diagnosisContinuationPrompt()
      : repairContinuationPrompt()
    : options.mode === "diagnosis"
      ? diagnosisPrompt(options.manifest)
      : repairPrompt(options.manifest, options.approvedPlan!);
  const turnPolicy = qoderTurnPolicy(options);
  queue.push({
    type: "user",
    message: {
      role: "user",
      content: [{ type: "text", text: prompt }],
    },
    parent_tool_use_id: null,
    uuid: userMessageId,
    session_id: qoderSessionId,
  });

  const policy = createToolPolicy({
    emit,
    manifest: options.manifest,
    mode: options.mode,
    recordApproval: options.recordApproval,
    repairSessionId: options.repairSessionId,
    requestApproval: options.requestApproval,
    worktreePath,
  });
  const adapter = options.adapter ?? createAgentAdapter({
    artifactRoot,
  });
  const session = adapter.start({
    auth: resolveQoderAuth(options.authStrategy),
    canUseTool: policy,
    cwd: worktreePath,
    env: qoderChildEnvironment(artifactRoot),
    maxTurns: turnPolicy.maxTurns,
    mode: options.mode,
    model: turnPolicy.model,
    prompt: queue,
    resume: options.resume ?? false,
    sessionId: qoderSessionId,
    signal: options.signal,
  });

  const turn = deferred<RepairTurnResult>();
  const closed = deferred<void>();
  const completedMessages: string[] = [];
  let turnSettled = false;
  void turn.promise.catch(() => undefined);
  void (async () => {
    try {
      for await (const message of session) {
        const delta = streamDelta(message);
        if (delta !== undefined) {
          await emit({
            type: "agent.message.delta",
            ephemeral: true,
            payload: { text: delta },
          });
        }
        for (const text of textBlocks(message)) {
          const sanitized = redactRunnerText(text, {
            artifactRoot,
            environment: process.env,
            worktreePath,
          });
          completedMessages.push(sanitized);
          await emit({
            type: "agent.message.completed",
            payload: { text: sanitized },
          });
        }
        const completedToolUseId = toolResultId(message);
        if (completedToolUseId !== undefined) {
          await emit({
            type: "tool.completed",
            payload: { toolUseId: completedToolUseId },
          });
        }
        if (
          message.type === "system" &&
          message.subtype === "permission_denied"
        ) {
          await emit({
            type: "tool.denied",
            payload: {
              reason: message.message,
              toolName: message.tool_name,
              toolUseId: message.tool_use_id,
            },
          });
        }
        if (message.type === "result" && !turnSettled) {
          turnSettled = true;
          if (message.subtype === "success") {
            turn.resolve({
              cacheCreationInputTokens:
                message.usage.cache_creation_input_tokens,
              cacheReadInputTokens: message.usage.cache_read_input_tokens,
              completedMessages,
              durationApiMs: message.duration_api_ms,
              durationMs: message.duration_ms,
              inputTokens: message.usage.input_tokens,
              modelUsage: Object.entries(message.modelUsage).map(
                ([model, usage]) => ({
                  model,
                  inputTokens: usage.inputTokens,
                  outputTokens: usage.outputTokens,
                  cacheReadInputTokens: usage.cacheReadInputTokens,
                  cacheCreationInputTokens:
                    usage.cacheCreationInputTokens,
                  webSearchRequests: usage.webSearchRequests,
                  costUsd: usage.costUSD,
                  contextWindow: usage.contextWindow,
                  maxOutputTokens: usage.maxOutputTokens,
                }),
              ),
              numTurns: message.num_turns,
              outputTokens: message.usage.output_tokens,
              qoderSessionId: message.session_id,
              result: redactRunnerText(message.result, {
                artifactRoot,
                environment: process.env,
                worktreePath,
              }),
              resultSubtype: message.subtype,
              stopReason: message.stop_reason ?? null,
              totalCostUsd: message.total_cost_usd,
              userMessageId,
            });
          } else {
            const failureReason =
              message.errors.join("\n") ||
              message.terminal_reason?.trim() ||
              `Qoder turn failed with ${message.subtype}.`;
            turn.reject(
              normalizeQoderError(
                new Error(
                  redactRunnerText(failureReason, {
                    artifactRoot,
                    environment: process.env,
                    worktreePath,
                  }),
                ),
              ),
            );
          }
        }
      }
      if (!turnSettled) {
        turn.reject(
          new Error("The code agent session ended before producing a result."),
        );
      }
      closed.resolve();
    } catch (error) {
      if (!turnSettled) {
        turn.reject(normalizeQoderError(error));
      }
      closed.resolve();
    }
  })();

  return {
    closed: closed.promise,
    turn: turn.promise,
    userMessageId,
    async close() {
      queue.close();
      await session.close();
    },
    async interrupt() {
      await session.interrupt();
      await emit({
        type: "session.paused",
        payload: { reason: "Qoder turn interrupted." },
      });
    },
    async rewindFiles(rewindOptions) {
      return session.rewindFiles(
        rewindOptions?.userMessageId ?? userMessageId,
        { dryRun: rewindOptions?.dryRun },
      );
    },
  };
}
