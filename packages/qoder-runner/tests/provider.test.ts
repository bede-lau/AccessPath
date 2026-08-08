import { describe, expect, it } from "vitest";

import {
  createAgentAdapter,
  OpenAiCodeAdapter,
  QwenCodeAdapter,
  qwenRuntimeProfile,
  qwenRuntimeSettings,
  redactRunnerText,
  resolveAgentProvider,
  resolveQwenConfiguration,
} from "../src/index";

describe("agent provider selection", () => {
  it("defaults to Qoder and validates explicit provider names", () => {
    expect(resolveAgentProvider({})).toBe("qoder");
    expect(resolveAgentProvider({ AGENT_PROVIDER: "openai" })).toBe("openai");
    expect(resolveAgentProvider({ AGENT_PROVIDER: "qwen" })).toBe("qwen");
    expect(resolveAgentProvider({ AGENT_PROVIDER: "mock" })).toBe("mock");
    expect(() =>
      resolveAgentProvider({ AGENT_PROVIDER: "unknown-provider" }),
    ).toThrow("AGENT_PROVIDER must be openai, qoder, qwen, or mock");
  });

  it("creates the selected direct adapter", () => {
    expect(
      createAgentAdapter({
        environment: {
          AGENT_PROVIDER: "openai",
          OPENAI_API_KEY: "test-openai-key",
        },
      }),
    ).toBeInstanceOf(OpenAiCodeAdapter);
    const adapter = createAgentAdapter({
      artifactRoot: "C:\\artifacts",
      environment: {
        AGENT_PROVIDER: "qwen",
        QWEN_API_KEY: "test-qwen-key",
      },
    });
    expect(adapter).toBeInstanceOf(QwenCodeAdapter);
    expect(() =>
      createAgentAdapter({
        environment: { AGENT_PROVIDER: "mock", NODE_ENV: "production" },
      }),
    ).toThrow("ACCESSPATH_ENABLE_MOCK_PROVIDER");
  });

  it("uses OpenAI configuration ahead of legacy Qwen variables", () => {
    expect(
      resolveQwenConfiguration({
        OPENAI_API_KEY: "test-openai-key",
        OPENAI_BASE_URL: "https://api.openai.test/v1",
        OPENAI_MODEL: "gpt-5-mini",
        QWEN_API_KEY: "test-qwen-key",
        QWEN_BASE_URL: "https://legacy.example.test/v1",
        QWEN_MODEL: "legacy-model",
      }),
    ).toEqual({
      apiKey: "test-openai-key",
      baseUrl: "https://api.openai.test/v1",
      model: "gpt-5-mini",
    });
    expect(() => resolveQwenConfiguration({ OPENAI_API_KEY: "  " })).toThrow(
      "OPENAI_API_KEY or QWEN_API_KEY",
    );
  });

  it("keeps native Qwen tools blocked and exposes only the required host tool names", () => {
    expect(qwenRuntimeProfile("planning")).toMatchObject({
      coreTools: ["read_file"],
      toolNames: [],
    });
    expect(qwenRuntimeProfile("diagnosis").toolNames).toEqual([
      "accesspath_read",
      "accesspath_glob",
      "accesspath_grep",
    ]);
    expect(qwenRuntimeProfile("repair")).toMatchObject({
      coreTools: ["read_file"],
      toolNames: expect.arrayContaining([
        "accesspath_edit",
        "accesspath_write",
      ]),
    });
    expect(qwenRuntimeProfile("repair").excludeTools).toContain(
      "run_shell_command",
    );
    expect(qwenRuntimeProfile("repair").excludeTools).toContain(
      "tool_search",
    );
    expect(qwenRuntimeProfile("repair").excludeTools).toContain(
      "send_message",
    );
    expect(qwenRuntimeProfile("repair").excludeTools).toContain("task_stop");
  });

  it("uses the OpenAI GPT-5 completion token parameter when required", () => {
    expect(
      qwenRuntimeSettings({
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-5-mini",
      }),
    ).toEqual({
      modelProviders: {
        openai: [
          {
            baseUrl: "https://api.openai.com/v1",
            envKey: "OPENAI_API_KEY",
            generationConfig: {
              samplingParams: { max_completion_tokens: 4096 },
            },
            id: "gpt-5-mini",
          },
        ],
      },
    });
    expect(
      qwenRuntimeSettings({
        baseUrl: "https://dashscope.example.test/compatible-mode/v1",
        model: "qwen3.7-max",
      }),
    ).toEqual({});
  });

  it("redacts OpenAI API keys from runner output", () => {
    const output = redactRunnerText("OpenAI response: test-openai-key", {
      environment: { OPENAI_API_KEY: "test-openai-key" },
    });
    expect(output).not.toContain("test-openai-key");
    expect(output).toContain("[redacted]");
  });
});
