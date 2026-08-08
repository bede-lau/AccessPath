import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  OpenAiCodeAdapter,
  openAiToolDefinitions,
  resolveOpenAiConfiguration,
} from "../src/openai-adapter";

const temporaryRoots: string[] = [];

function sse(events: unknown[]): Response {
  const body = events
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join("");
  return new Response(body, {
    headers: { "content-type": "text/event-stream" },
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

describe("OpenAiCodeAdapter", () => {
  it("uses strict AccessPath tool schemas and streams text around bounded reads", async () => {
    const root = await mkdtemp(join(tmpdir(), "accesspath-openai-adapter-"));
    temporaryRoots.push(root);
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "message.txt"), "before\n", "utf8");

    const requestBodies: Array<Record<string, unknown>> = [];
    const responses = [
      sse([
        {
          type: "response.output_text.delta",
          delta: "I will inspect the approved file.",
        },
        {
          type: "response.function_call_arguments.done",
          name: "accesspath_read",
          call_id: "call-read",
          arguments: JSON.stringify({ file_path: "src/message.txt" }),
        },
        {
          type: "response.completed",
          response: {
            id: "response-read",
            output: [
              {
                type: "function_call",
                name: "accesspath_read",
                call_id: "call-read",
                arguments: JSON.stringify({ file_path: "src/message.txt" }),
              },
            ],
          },
        },
      ]),
      sse([
        {
          type: "response.output_text.delta",
          delta: "The file contains the expected fixture.",
        },
        {
          type: "response.completed",
          response: {
            id: "response-final",
            output: [
              {
                type: "message",
                content: [
                  {
                    type: "output_text",
                    text: "The file contains the expected fixture.",
                  },
                ],
              },
            ],
          },
        },
      ]),
    ];
    const adapter = new OpenAiCodeAdapter({
      environment: {
        OPENAI_API_KEY: "test-openai-key",
        OPENAI_BASE_URL: "https://api.openai.test/v1",
        OPENAI_MODEL: "gpt-5-mini",
      },
      fetch: (async (_url, init) => {
        requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return responses.shift()!;
      }) as typeof fetch,
    });
    const session = adapter.start({
      auth: {} as never,
      canUseTool: async () => ({ behavior: "allow" }),
      cwd: root,
      env: {},
      maxTurns: 3,
      mode: "diagnosis",
      model: "efficient",
      prompt: (async function* () {
        yield {
          message: {
            content: [{ type: "text", text: "Inspect the fixture." }],
            role: "user",
          },
          parent_tool_use_id: null,
          session_id: "session-openai",
          type: "user",
          uuid: "user-openai",
        };
      })(),
      resume: false,
      sessionId: "session-openai",
    });

    const messages = [];
    for await (const message of session) {
      messages.push(message);
    }

    expect(messages.some((message) => message.type === "stream_event")).toBe(
      true,
    );
    expect(
      messages.some(
        (message) =>
          message.type === "user" &&
          (message as { tool_use_result?: { tool_use_id?: string } })
            .tool_use_result?.tool_use_id === "call-read",
      ),
    ).toBe(true);
    expect(
      messages.some(
        (message) =>
          message.type === "assistant" &&
          JSON.stringify(message).includes(
            "The file contains the expected fixture.",
          ),
      ),
    ).toBe(true);
    expect(messages.at(-1)).toMatchObject({
      result:
        "I will inspect the approved file.\n\nThe file contains the expected fixture.",
      subtype: "success",
      type: "result",
    });

    const firstTools = requestBodies[0].tools as Array<Record<string, unknown>>;
    expect(firstTools.map((tool) => tool.name)).toEqual([
      "accesspath_read",
      "accesspath_glob",
      "accesspath_grep",
    ]);
    for (const tool of firstTools) {
      expect(tool.strict).toBe(true);
      expect(tool.parameters).toMatchObject({
        additionalProperties: false,
        type: "object",
      });
    }
    expect(JSON.stringify(firstTools)).not.toContain("send_message");
    expect(requestBodies[1]).toMatchObject({
      previous_response_id: "response-read",
      input: [
        {
          type: "function_call_output",
          call_id: "call-read",
          output: "before\n",
        },
      ],
    });
    await session.close();
  });

  it("validates the direct OpenAI configuration without legacy Qwen variables", () => {
    expect(
      resolveOpenAiConfiguration({
        OPENAI_API_KEY: "test-openai-key",
        OPENAI_BASE_URL: "https://api.openai.test/v1",
        OPENAI_MODEL: "gpt-5-mini",
        QWEN_API_KEY: "test-qwen-key",
      }),
    ).toEqual({
      apiKey: "test-openai-key",
      baseUrl: "https://api.openai.test/v1",
      model: "gpt-5-mini",
    });
    expect(() => resolveOpenAiConfiguration({ OPENAI_API_KEY: " " })).toThrow(
      "OPENAI_API_KEY",
    );
  });

  it("keeps direct OpenAI tools limited to the current agent mode", () => {
    expect(openAiToolDefinitions("planning")).toEqual([]);
    expect(openAiToolDefinitions("diagnosis")).toHaveLength(3);
    expect(openAiToolDefinitions("repair")).toHaveLength(5);
  });
});
