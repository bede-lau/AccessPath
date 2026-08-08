import { join } from "node:path";

import { DeterministicMockQoderAdapter } from "./mock-adapter";
import { OpenAiCodeAdapter } from "./openai-adapter";
import { QwenCodeAdapter } from "./qwen-adapter";
import { OfficialQoderAdapter } from "./sdk-adapter";
import type { QoderAdapter } from "./types";

export type AgentProvider = "mock" | "openai" | "qoder" | "qwen";

export interface AgentAdapterOptions {
  artifactRoot?: string;
  environment?: NodeJS.ProcessEnv;
}

export function resolveAgentProvider(
  environment: NodeJS.ProcessEnv = process.env,
): AgentProvider {
  const configured = environment.AGENT_PROVIDER?.trim().toLowerCase();
  if (configured === undefined || configured === "") {
    return "qoder";
  }
  if (
    configured === "qoder" ||
    configured === "qwen" ||
    configured === "openai" ||
    configured === "mock"
  ) {
    return configured;
  }
  throw new Error(
    "AGENT_PROVIDER must be openai, qoder, qwen, or mock.",
  );
}

export function createAgentAdapter(
  options: AgentAdapterOptions = {},
): QoderAdapter {
  const environment = options.environment ?? process.env;
  switch (resolveAgentProvider(environment)) {
    case "openai":
      return new OpenAiCodeAdapter({ environment });
    case "qwen":
      return new QwenCodeAdapter({
        environment,
        ...(options.artifactRoot === undefined
          ? {}
          : {
              recoveryRoot: join(
                options.artifactRoot,
                "agent-provider-recovery",
              ),
            }),
      });
    case "mock":
      if (
        environment.NODE_ENV !== "test" &&
        environment.ACCESSPATH_ENABLE_MOCK_PROVIDER !== "1"
      ) {
        throw new Error(
          "AGENT_PROVIDER=mock is restricted to tests unless ACCESSPATH_ENABLE_MOCK_PROVIDER=1 is set.",
        );
      }
      return new DeterministicMockQoderAdapter();
    case "qoder":
      return new OfficialQoderAdapter();
  }
}
