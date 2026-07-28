import { join } from "node:path";

import {
  accessTokenFromEnv,
  qodercliAuth,
  query,
  type AuthOptions,
} from "@qoder-ai/qoder-agent-sdk";

import type {
  QoderAdapter,
  QoderAdapterStartOptions,
  QoderAuthStrategy,
} from "./types";

const PAT_ENVIRONMENT_VARIABLE = "QODER_PERSONAL_ACCESS_TOKEN";

export function resolveQoderAuth(
  strategy: QoderAuthStrategy = "auto",
  environment: NodeJS.ProcessEnv = process.env,
): AuthOptions {
  if (strategy === "pat") {
    if (!environment[PAT_ENVIRONMENT_VARIABLE]?.trim()) {
      throw new Error(
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
  artifactRoot: string,
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
  result.ACCESSPATH_QODER_TEMP = join(artifactRoot, "qoder-temp");
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

export class OfficialQoderAdapter implements QoderAdapter {
  public start(options: QoderAdapterStartOptions) {
    const abortController = bridgeAbortSignal(options.signal);
    const readTools = ["Read", "Glob", "Grep"];
    const tools =
      options.mode === "repair"
        ? [...readTools, "Edit", "Write"]
        : readTools;

    return query({
      prompt: options.prompt,
      options: {
        abortController,
        auth: options.auth,
        canUseTool: options.canUseTool,
        cwd: options.cwd,
        disallowedTools: [
          "Agent",
          "AskUserQuestion",
          "Bash",
          "ImageGen",
          "ImageSearch",
          "NotebookEdit",
          "Skill",
          "TodoWrite",
          "WebFetch",
          "WebSearch",
        ],
        enableFileCheckpointing: true,
        env: options.env,
        includePartialMessages: true,
        maxTurns: options.mode === "diagnosis" ? 8 : 12,
        permissionMode: "default",
        persistSession: false,
        sessionId: options.sessionId,
        tools,
      },
    });
  }
}
