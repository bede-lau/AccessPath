import { describe, expect, it } from "vitest";

import {
  DeterministicMockQoderAdapter,
  normalizeQoderError,
  parsePlannedTaskContract,
  planningPrompt,
  planTaskContract,
  QoderAuthenticationError,
  qoderRuntimeProfile,
  resolveQoderAuth,
  type RunnerEvent,
} from "../src/index";

const reconnaissance = {
  startUrl: "https://example.test/apply",
  targetPolicy: "public",
  pageTitle: "Example application",
  controls: [
    { role: "textbox", label: "Full name" },
    { role: "button", name: "Submit application" },
  ],
  completion: {
    visibleText: "Application submitted",
  },
};

const plannedTask = {
  schemaVersion: "1.0.0" as const,
  id: "task-example-application",
  title: "Submit the example application",
  goal: "Enter fictional applicant details and submit the application.",
  startUrl: "https://example.test/apply",
  targetPolicy: "public" as const,
  success: { visibleText: "Application submitted" },
  forbiddenActions: ["Do not enter real personal information."],
  expectedSteps: [
    {
      id: "enter-name",
      intent: "Enter the fictional applicant name",
      action: {
        kind: "fill" as const,
        label: "Full name",
        valueRef: "fullName",
      },
      checkpoint: false,
    },
    {
      id: "submit-application",
      intent: "Submit the application",
      action: {
        kind: "click" as const,
        role: "button",
        name: "Submit application",
      },
      checkpoint: true,
    },
  ],
  fixtureValues: { fullName: "Jordan Example" },
  viewport: { width: 1280, height: 800 },
  timeoutMs: 60_000,
};

describe("Qoder mission planning", () => {
  it("builds a bounded tool-free prompt from host reconnaissance", () => {
    const prompt = planningPrompt(
      reconnaissance,
      "Submit an application with fictional details.",
    );

    expect(prompt).toContain('"startUrl":"https://example.test/apply"');
    expect(prompt).toContain("Return JSON only");
    expect(prompt).toContain("no browser, repository, filesystem, shell, web");
    expect(prompt).toContain("untrusted observations");
  });

  it("uses an ephemeral planning profile with no cwd, tools, or recovery", async () => {
    const adapter = new DeterministicMockQoderAdapter({
      planningTask: plannedTask,
    });
    const events: RunnerEvent[] = [];

    const result = await planTaskContract({
      adapter,
      emit: (event) => {
        events.push(event);
      },
      objective: "Submit an application with fictional details.",
      reconnaissance,
    });

    expect(result.task).toEqual(plannedTask);
    expect(adapter.starts).toHaveLength(1);
    expect(adapter.starts[0]).toMatchObject({
      maxTurns: 2,
      mode: "planning",
      model: "efficient",
      resume: false,
    });
    expect(adapter.starts[0]).not.toHaveProperty("cwd");
    await expect(
      adapter.starts[0]!.canUseTool(
        "Bash",
        { command: "pwd" },
        {
          signal: new AbortController().signal,
          toolUseID: "planning-tool",
        },
      ),
    ).resolves.toMatchObject({
      behavior: "deny",
      message: expect.stringContaining("not available"),
    });
    await expect(
      adapter.inspectPersistedTurn({
        cwd: "unused",
        sessionId: result.qoderSessionId,
        userMessageId: result.userMessageId,
      }),
    ).resolves.toEqual({ status: "missing" });
    expect(events).toContainEqual({
      type: "agent.message.completed",
      payload: { text: JSON.stringify(plannedTask) },
    });
  });

  it("hard-disables planning tools, checkpoints, and persistence", () => {
    const profile = qoderRuntimeProfile("planning");

    expect(profile).toMatchObject({
      enableFileCheckpointing: false,
      persistSession: false,
      tools: [],
    });
    expect(profile.disallowedTools).toEqual(
      expect.arrayContaining([
        "Agent",
        "Bash",
        "Edit",
        "Glob",
        "Grep",
        "Read",
        "WebFetch",
        "WebSearch",
        "Write",
      ]),
    );
  });

  it("accepts a complete plan wrapped in one JSON markdown fence", () => {
    expect(
      parsePlannedTaskContract(`\`\`\`json
${JSON.stringify(plannedTask)}
\`\`\``),
    ).toEqual(plannedTask);
  });

  it("applies fixed execution defaults omitted by the planner", () => {
    const { timeoutMs: _timeoutMs, viewport: _viewport, ...incompleteTask } =
      plannedTask;

    expect(
      parsePlannedTaskContract(JSON.stringify(incompleteTask)),
    ).toMatchObject({
      ...plannedTask,
      viewport: {
        width: 1280,
        height: 800,
        deviceScaleFactor: 1,
      },
      timeoutMs: 60_000,
    });
  });

  it("rejects planning output with prose outside the JSON payload", () => {
    expect(() =>
      parsePlannedTaskContract(`Here is the plan:
\`\`\`json
${JSON.stringify(plannedTask)}
\`\`\``),
    ).toThrow(/invalid JSON/i);
  });

  it("returns useful TaskContract validation errors", async () => {
    const adapter = new DeterministicMockQoderAdapter({
      planningOutput: JSON.stringify({
        ...plannedTask,
        expectedSteps: [],
        startUrl: "not-a-url",
      }),
    });

    await expect(
      planTaskContract({
        adapter,
        objective: "Submit the application.",
        reconnaissance,
      }),
    ).rejects.toThrow(
      /invalid TaskContract: (startUrl|expectedSteps).*(startUrl|expectedSteps)/i,
    );
  });

  it("rejects non-object reconnaissance before starting Qoder", async () => {
    const adapter = new DeterministicMockQoderAdapter();

    await expect(
      planTaskContract({
        adapter,
        objective: "Inspect the page.",
        reconnaissance: ["not", "a", "summary"] as never,
      }),
    ).rejects.toThrow(/structured JSON object/);
    expect(adapter.starts).toHaveLength(0);
  });

  it("uses a typed auth error without classifying unrelated messages", () => {
    expect(() => resolveQoderAuth("pat", {})).toThrow(
      QoderAuthenticationError,
    );
    expect(
      normalizeQoderError(
        new Error('No qodercli login found. Run "qodercli login" first.'),
      ),
    ).toBeInstanceOf(QoderAuthenticationError);
    expect(
      normalizeQoderError(
        new Error("Deployment authentication metadata is inconsistent."),
      ),
    ).not.toBeInstanceOf(QoderAuthenticationError);
  });
});
