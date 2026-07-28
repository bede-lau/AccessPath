import { randomUUID } from "node:crypto";
import { mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";

import type {
  SDKMessage,
  SDKUserMessage,
} from "@qoder-ai/qoder-agent-sdk";

import { createToolPolicy } from "./policy";
import { diagnosisPrompt, repairPrompt } from "./prompts";
import {
  OfficialQoderAdapter,
  qoderChildEnvironment,
  resolveQoderAuth,
} from "./sdk-adapter";
import type {
  RepairSessionHandle,
  RepairSessionOptions,
  RepairTurnResult,
  RunnerEvent,
} from "./types";

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
  const userMessageId = randomUUID();
  if (options.mode === "repair" && !options.approvedPlan?.trim()) {
    throw new Error("A repair turn requires the exact approved diagnosis plan.");
  }
  const prompt =
    options.mode === "diagnosis"
      ? diagnosisPrompt(options.manifest)
      : repairPrompt(options.manifest, options.approvedPlan!);
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
  const adapter = options.adapter ?? new OfficialQoderAdapter();
  const session = adapter.start({
    auth: resolveQoderAuth(options.authStrategy),
    canUseTool: policy,
    cwd: worktreePath,
    env: qoderChildEnvironment(artifactRoot),
    mode: options.mode,
    prompt: queue,
    sessionId: qoderSessionId,
    signal: options.signal,
  });

  const turn = deferred<RepairTurnResult>();
  const closed = deferred<void>();
  const completedMessages: string[] = [];
  let turnSettled = false;
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
              completedMessages,
              qoderSessionId: message.session_id,
              result: redactRunnerText(message.result, {
                artifactRoot,
                environment: process.env,
                worktreePath,
              }),
              resultSubtype: message.subtype,
              userMessageId,
            });
          } else {
            turn.reject(
              new Error(
                redactRunnerText(message.errors.join("\n"), {
                  artifactRoot,
                  environment: process.env,
                  worktreePath,
                }) || `Qoder turn failed with ${message.subtype}.`,
              ),
            );
          }
        }
      }
      if (!turnSettled) {
        turn.reject(
          new Error("The Qoder session ended before producing a result."),
        );
      }
      closed.resolve();
    } catch (error) {
      if (!turnSettled) {
        turn.reject(error);
      }
      closed.reject(error);
    }
  })();

  return {
    closed: closed.promise,
    turn: turn.promise,
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
      return session.rewindFiles(userMessageId, rewindOptions);
    },
  };
}
