import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";

import type {
  PermissionResult,
  SDKMessage,
  SDKUserMessage,
} from "@qoder-ai/qoder-agent-sdk";

import { resolveWorktreePath } from "./policy";
import type {
  QoderAdapter,
  QoderAdapterSession,
  QoderAdapterStartOptions,
} from "./types";

export interface DeterministicMockEdit {
  filePath: string;
  newText: string;
  oldText: string;
}

export interface DeterministicMockWrite {
  content: string;
  filePath: string;
}

export interface DeterministicMockQoderOptions {
  completionDelayMs?: number;
  diagnosis?: string;
  edits?: DeterministicMockEdit[];
  repairSummary?: string;
  streamDelayMs?: number;
  writes?: DeterministicMockWrite[];
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

type ResolvedFile = {
  absolutePath: string;
  relativePath: string;
};

function userText(message: SDKUserMessage): string {
  const content = message.message.content;
  if (typeof content === "string") {
    return content;
  }
  return content
    .filter(
      (block): block is { type: "text"; text: string } =>
        block.type === "text" && typeof block.text === "string",
    )
    .map((block) => block.text)
    .join("\n");
}

function assistantMessage(
  sessionId: string,
  content: unknown[],
): SDKMessage {
  return {
    type: "assistant",
    message: {
      id: `mock-${randomUUID()}`,
      type: "message",
      role: "assistant",
      model: "accesspath-deterministic-mock",
      content,
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
      },
    },
    parent_tool_use_id: null,
    uuid: randomUUID(),
    session_id: sessionId,
  } as SDKMessage;
}

function resultMessage(
  sessionId: string,
  result: string,
  permissionDenials: unknown[] = [],
): SDKMessage {
  return {
    type: "result",
    subtype: "success",
    duration_ms: 1,
    duration_api_ms: 0,
    is_error: false,
    num_turns: 1,
    result,
    stop_reason: "end_turn",
    total_cost_usd: 0,
    usage: {},
    modelUsage: {},
    permission_denials: permissionDenials,
    uuid: randomUUID(),
    session_id: sessionId,
  } as SDKMessage;
}

function toolResultMessage(
  sessionId: string,
  toolUseId: string,
  toolName: "Edit" | "Write",
  result: PermissionResult,
): SDKMessage {
  return {
    type: "user",
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: toolUseId,
          content:
            result.behavior === "allow"
              ? `${toolName} completed.`
              : result.message,
          is_error: result.behavior === "deny",
        },
      ],
    },
    parent_tool_use_id: toolUseId,
    tool_use_result: {
      tool_use_id: toolUseId,
      success: result.behavior === "allow",
    },
    uuid: randomUUID(),
    session_id: sessionId,
  } as SDKMessage;
}

async function delay(milliseconds: number): Promise<void> {
  if (milliseconds <= 0) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

class MockSession implements QoderAdapterSession {
  private closed = false;
  private interrupted = false;
  private rewindEntries: RewindEntry[] = [];

  public constructor(
    private readonly startOptions: QoderAdapterStartOptions,
    private readonly mockOptions: DeterministicMockQoderOptions,
  ) {}

  public async *[Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    const iterator = this.startOptions.prompt[Symbol.asyncIterator]();
    const next = await iterator.next();
    if (next.done) {
      return;
    }
    const sessionId = this.startOptions.sessionId;
    yield {
      type: "system",
      subtype: "init",
      apiKeySource: "none",
      qodercli_version: "mock",
      cwd: this.startOptions.cwd,
      tools:
        this.startOptions.mode === "diagnosis"
          ? ["Read", "Glob", "Grep"]
          : ["Read", "Glob", "Grep", "Edit", "Write"],
      mcp_servers: [],
      model: "accesspath-deterministic-mock",
      permissionMode: "default",
      slash_commands: [],
      output_style: "text",
      skills: [],
      plugins: [],
      uuid: randomUUID(),
      session_id: sessionId,
    } as SDKMessage;

    await delay(this.mockOptions.streamDelayMs ?? 0);
    if (this.interrupted || this.closed) {
      return;
    }

    if (this.startOptions.mode === "diagnosis") {
      const diagnosis =
        this.mockOptions.diagnosis ??
        "Repair the selected barrier with the minimum source and regression-test changes.";
      yield assistantMessage(sessionId, [
        { type: "text", text: diagnosis },
        {
          type: "thinking",
          thinking: `Hidden reasoning for ${userText(next.value)}`,
        },
      ]);
      yield resultMessage(sessionId, diagnosis);
      return;
    }

    const permissionDenials: unknown[] = [];
    for (const edit of this.mockOptions.edits ?? []) {
      if (this.interrupted || this.closed) {
        return;
      }
      const target = await resolveWorktreePath(
        this.startOptions.cwd,
        edit.filePath,
      );
      const original = await readFile(target.absolutePath, "utf8");
      const anchor = original.includes(edit.oldText)
        ? edit.oldText
        : original.includes(edit.oldText.replaceAll("\n", "\r\n"))
          ? edit.oldText.replaceAll("\n", "\r\n")
          : undefined;
      if (anchor === undefined) {
        throw new Error(
          `Mock edit anchor was not found in ${target.relativePath}.`,
        );
      }
      const replacement = anchor.includes("\r\n")
        ? edit.newText.replaceAll("\n", "\r\n")
        : edit.newText;
      const toolUseId = `tool-${randomUUID()}`;
      yield assistantMessage(sessionId, [
        {
          type: "tool_use",
          id: toolUseId,
          name: "Edit",
          input: {
            file_path: edit.filePath,
            old_string: edit.oldText,
            new_string: edit.newText,
          },
        },
      ]);
      const permission = await this.startOptions.canUseTool(
        "Edit",
        {
          file_path: edit.filePath,
          old_string: edit.oldText,
          new_string: edit.newText,
        },
        {
          signal: this.startOptions.signal ?? new AbortController().signal,
          toolUseID: toolUseId,
        },
      );
      if (permission.behavior === "allow") {
        this.rewindEntries.push({
          action: "restore",
          ...target,
          content: original,
        });
        await writeFile(
          target.absolutePath,
          original.replace(anchor, replacement),
          "utf8",
        );
      } else {
        permissionDenials.push({
          tool_name: "Edit",
          tool_use_id: toolUseId,
          tool_input: { file_path: edit.filePath },
          message: permission.message,
        });
      }
      yield toolResultMessage(sessionId, toolUseId, "Edit", permission);
    }

    for (const write of this.mockOptions.writes ?? []) {
      if (this.interrupted || this.closed) {
        return;
      }
      const target: ResolvedFile = await resolveWorktreePath(
        this.startOptions.cwd,
        write.filePath,
      );
      const toolUseId = `tool-${randomUUID()}`;
      const input = {
        file_path: write.filePath,
        content: write.content,
      };
      yield assistantMessage(sessionId, [
        {
          type: "tool_use",
          id: toolUseId,
          name: "Write",
          input,
        },
      ]);
      const permission = await this.startOptions.canUseTool("Write", input, {
        signal: this.startOptions.signal ?? new AbortController().signal,
        toolUseID: toolUseId,
      });
      if (permission.behavior === "allow") {
        await writeFile(target.absolutePath, write.content, {
          encoding: "utf8",
          flag: "wx",
        });
        this.rewindEntries.push({
          action: "delete",
          ...target,
        });
      } else {
        permissionDenials.push({
          tool_name: "Write",
          tool_use_id: toolUseId,
          tool_input: { file_path: write.filePath },
          message: permission.message,
        });
      }
      yield toolResultMessage(sessionId, toolUseId, "Write", permission);
    }

    const summary =
      this.mockOptions.repairSummary ??
      "Applied the approved repair and regression-test changes.";
    await delay(this.mockOptions.completionDelayMs ?? 0);
    if (this.interrupted || this.closed) {
      return;
    }
    yield assistantMessage(sessionId, [{ type: "text", text: summary }]);
    yield resultMessage(sessionId, summary, permissionDenials);
  }

  public async close(): Promise<void> {
    this.closed = true;
  }

  public async interrupt(): Promise<void> {
    this.interrupted = true;
  }

  public async rewindFiles(
    _userMessageId: string,
    options: { dryRun?: boolean } = {},
  ) {
    const filesChanged = this.rewindEntries.map((file) => file.relativePath);
    if (options.dryRun !== true) {
      for (const file of this.rewindEntries.slice().reverse()) {
        if (file.action === "restore") {
          await writeFile(file.absolutePath, file.content, "utf8");
        } else {
          await rm(file.absolutePath, { force: true });
        }
      }
      this.rewindEntries = [];
    }
    return {
      canRewind: filesChanged.length > 0,
      filesChanged,
      insertions: filesChanged.length,
      deletions: filesChanged.length,
    };
  }
}

export class DeterministicMockQoderAdapter implements QoderAdapter {
  public constructor(
    private readonly options: DeterministicMockQoderOptions = {},
  ) {}

  public start(options: QoderAdapterStartOptions): QoderAdapterSession {
    return new MockSession(options, this.options);
  }
}
