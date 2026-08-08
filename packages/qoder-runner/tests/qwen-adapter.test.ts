import { describe, expect, it } from "vitest";

import {
  DirectQwenCodeAdapter,
  qwenSessionTurnLimit,
} from "../src/qwen-adapter";

describe("DirectQwenCodeAdapter", () => {
  it("keeps a compact diagnosis cap and leaves recovery room for repairs", () => {
    expect(qwenSessionTurnLimit({ maxTurns: 6, mode: "diagnosis" })).toBe(6);
    expect(qwenSessionTurnLimit({ maxTurns: 8, mode: "repair" })).toBe(14);
    expect(qwenSessionTurnLimit({ maxTurns: 18, mode: "repair" })).toBe(18);
  });

  it("keeps the input stream open until Qwen returns a terminal result", async () => {
    let inputEndedBeforeResult = false;
    const adapter = new DirectQwenCodeAdapter({
      environment: {
        OPENAI_API_KEY: "test-openai-key",
      },
      query: ((config: {
        prompt: AsyncIterable<unknown>;
      }) => {
        const messages = async function* () {
          const input = config.prompt[Symbol.asyncIterator]();
          await input.next();
          const pendingInput = input.next();
          let inputEnded = false;
          void pendingInput.then((message) => {
            inputEnded = message.done === true;
          });
          await Promise.resolve();
          inputEndedBeforeResult = inputEnded;
          yield {
            duration_api_ms: 0,
            duration_ms: 0,
            modelUsage: {},
            num_turns: 1,
            result: "done",
            session_id: "qwen-session",
            subtype: "success",
            type: "result",
            usage: {
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
              input_tokens: 0,
              output_tokens: 0,
            },
          };
          await pendingInput;
        };
        const source = messages();
        return Object.assign(source, {
          close: async () => undefined,
          interrupt: async () => undefined,
        });
      }) as never,
    });
    const session = adapter.start({
      auth: {} as never,
      canUseTool: async () => ({
        behavior: "deny",
        message: "Not used in this test.",
      }),
      cwd: process.cwd(),
      env: {},
      maxTurns: 8,
      mode: "repair",
      model: "efficient",
      prompt: (async function* () {
        yield {
          message: { content: "Repair the issue.", role: "user" },
          parent_tool_use_id: null,
          session_id: "qwen-session",
          type: "user",
          uuid: "user-message",
        };
      })(),
      resume: false,
      sessionId: "qwen-session",
    });

    const result = await session[Symbol.asyncIterator]().next();

    expect(result.value.type).toBe("result");
    expect(inputEndedBeforeResult).toBe(false);
    await session.close();
  });
});
