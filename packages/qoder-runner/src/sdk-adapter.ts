import { join } from "node:path";

import {
  accessTokenFromEnv,
  getSessionMessages,
  qodercliAuth,
  query,
  type AuthOptions,
  type ModelPolicyContext,
  type SessionMessage,
} from "@qoder-ai/qoder-agent-sdk";

import type {
  QoderAdapter,
  QoderAdapterRecoveryOptions,
  QoderAdapterStartOptions,
  QoderAgentMode,
  QoderAuthStrategy,
  QoderTurnRecovery,
} from "./types";
import { QoderAuthenticationError } from "./errors";

const PAT_ENVIRONMENT_VARIABLE = "QODER_PERSONAL_ACCESS_TOKEN";

export function resolveQoderAuth(
  strategy: QoderAuthStrategy = "auto",
  environment: NodeJS.ProcessEnv = process.env,
): AuthOptions {
  if (strategy === "pat") {
    if (!environment[PAT_ENVIRONMENT_VARIABLE]?.trim()) {
      throw new QoderAuthenticationError(
        `${PAT_ENVIRONMENT_VARIABLE} is required for PAT authentication.`,
      );
    }
    return accessTokenFromEnv(PAT_ENVIRONMENT_VARIABLE);
  }
  if (strategy === "qodercli") {
    return qodercliAuth();
  }
  return environment[PAT_ENVIRONMENT_VARIABLE]?.trim()
    ? accessTokenFromEnv(PAT_ENVIRONMENT_VARIABLE)
    : qodercliAuth();
}

export function qoderChildEnvironment(
  artifactRoot?: string,
  environment: NodeJS.ProcessEnv = process.env,
): Record<string, string | undefined> {
  const allowed = [
    "APPDATA",
    "HOME",
    "HOMEDRIVE",
    "HOMEPATH",
    "LANG",
    "LOCALAPPDATA",
    "PATH",
    "PATHEXT",
    "QODER_CLI_HOME",
    "QODER_CONFIG_DIR",
    PAT_ENVIRONMENT_VARIABLE,
    "SYSTEMROOT",
    "SystemRoot",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "WINDIR",
  ] as const;
  const result: Record<string, string | undefined> = {};
  for (const name of allowed) {
    if (environment[name] !== undefined) {
      result[name] = environment[name];
    }
  }
  if (artifactRoot !== undefined) {
    result.ACCESSPATH_QODER_TEMP = join(artifactRoot, "qoder-temp");
    result.ACCESSPATH_QWEN_TEMP = join(artifactRoot, "qwen-temp");
  }
  return result;
}

function bridgeAbortSignal(
  source: AbortSignal | undefined,
): AbortController {
  const controller = new AbortController();
  if (source?.aborted) {
    controller.abort(source.reason);
  } else {
    source?.addEventListener(
      "abort",
      () => controller.abort(source.reason),
      { once: true },
    );
  }
  return controller;
}

function availableModel(
  context: ModelPolicyContext,
  requested: string,
): string {
  const enabled = context.availableModels.filter(
    (model) => model.isEnabled !== false,
  );
  const exact = enabled.find(
    (model) =>
      model.value === requested || model.modelId === requested,
  )?.value;
  if (exact !== undefined) {
    return exact;
  }
  if (requested !== "performance") {
    const cheapest = [...enabled]
      .filter(
        (model) =>
          model.priceFactor !== undefined &&
          !/\blite\b/i.test(`${model.value} ${model.modelId ?? ""}`),
      )
      .sort(
        (left, right) =>
          left.priceFactor! - right.priceFactor!,
      )[0]?.value;
    if (cheapest !== undefined) {
      return cheapest;
    }
  }
  return (
    enabled.find((model) => model.isDefault)?.value ??
    enabled[0]?.value ??
    requested
  );
}

const ALL_QODER_TOOLS = [
  "Agent",
  "AskUserQuestion",
  "Bash",
  "Edit",
  "Glob",
  "Grep",
  "ImageGen",
  "ImageSearch",
  "NotebookEdit",
  "Read",
  "Skill",
  "TodoWrite",
  "WebFetch",
  "WebSearch",
  "Write",
] as const;

export function qoderRuntimeProfile(mode: QoderAgentMode): {
  disallowedTools: string[];
  enableFileCheckpointing: boolean;
  persistSession: boolean;
  tools: string[];
} {
  const readTools = ["Read", "Glob", "Grep"];
  const tools =
    mode === "planning"
      ? []
      : mode === "repair"
        ? [...readTools, "Edit", "Write"]
        : readTools;
  return {
    disallowedTools:
      mode === "planning"
        ? [...ALL_QODER_TOOLS]
        : ALL_QODER_TOOLS.filter((tool) => !tools.includes(tool)),
    enableFileCheckpointing: mode !== "planning",
    persistSession: mode !== "planning",
    tools,
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function isHumanPrompt(message: SessionMessage): boolean {
  if (message.type !== "user") {
    return false;
  }
  const content = record(message.message)?.content;
  return (
    typeof content === "string" ||
    (Array.isArray(content) &&
      content.some((block) => record(block)?.type === "text"))
  );
}

export function inspectPersistedMessages(
  messages: SessionMessage[],
  userMessageId: string,
): QoderTurnRecovery {
  const userIndex = messages.findIndex(
    (message) =>
      message.type === "user" && message.uuid === userMessageId,
  );
  if (userIndex < 0) {
    return { status: "missing" };
  }
  const following = messages.slice(userIndex + 1);
  const nextPromptIndex = following.findIndex(isHumanPrompt);
  const turnMessages =
    nextPromptIndex < 0
      ? following
      : following.slice(0, nextPromptIndex);
  const assistant = turnMessages
    .filter((message) => message.type === "assistant")
    .at(-1);
  const message = record(assistant?.message);
  if (message?.stop_reason !== "end_turn") {
    return {
      status: nextPromptIndex < 0 ? "incomplete" : "superseded",
    };
  }
  const content = message.content;
  if (!Array.isArray(content)) {
    return {
      status: nextPromptIndex < 0 ? "incomplete" : "superseded",
    };
  }
  const text = content
    .map((block) => record(block))
    .filter(
      (block): block is Record<string, unknown> =>
        block?.type === "text" && typeof block.text === "string",
    )
    .map((block) => block.text as string)
    .join("\n")
    .trim();
  return text
    ? {
        status: "completed",
        turn: {
          completedMessages: [text],
          qoderSessionId:
            assistant?.session_id ?? messages[userIndex]!.session_id,
          result: text,
          resultSubtype: "success",
          stopReason: "end_turn",
          userMessageId,
        },
      }
    : {
        status: nextPromptIndex < 0 ? "incomplete" : "superseded",
      };
}

export class OfficialQoderAdapter implements QoderAdapter {
  public async inspectPersistedTurn(
    options: QoderAdapterRecoveryOptions,
  ): Promise<QoderTurnRecovery> {
    const messages = await getSessionMessages(options.sessionId, {
      dir: options.cwd,
    });
    return inspectPersistedMessages(messages, options.userMessageId);
  }

  public start(options: QoderAdapterStartOptions) {
    const abortController = bridgeAbortSignal(options.signal);
    const profile = qoderRuntimeProfile(options.mode);

    return query({
      prompt: options.prompt,
      options: {
        abortController,
        auth: options.auth,
        canUseTool: options.canUseTool,
        cwd: options.cwd,
        disallowedTools: profile.disallowedTools,
        enableFileCheckpointing: profile.enableFileCheckpointing,
        env: options.env,
        includePartialMessages: true,
        maxTurns: options.maxTurns,
        permissionMode: "default",
        persistSession: profile.persistSession,
        resolveModel: (context) => {
          const requested =
            context.purpose === "compression" ||
            context.purpose === "utility"
              ? "lite"
              : options.model;
          const model = availableModel(context, requested);
          const modelInfo = context.availableModels.find(
            (candidate) => candidate.value === model,
          );
          const preferredEffort =
            options.mode === "repair" ? "medium" : "low";
          return {
            model,
            ...(modelInfo?.efforts?.includes(preferredEffort)
              ? { parameters: { reasoningEffort: preferredEffort } }
              : {}),
          };
        },
        resolveModelTimeoutMs: 1_000,
        ...(options.mode === "planning"
          ? {}
          : options.resume
          ? { resume: options.sessionId }
          : { sessionId: options.sessionId }),
        strictMcpConfig: true,
        tools: profile.tools,
      },
    });
  }
}
