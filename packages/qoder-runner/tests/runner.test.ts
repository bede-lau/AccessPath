import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DeterministicMockQoderAdapter,
  PACKAGE_NAME,
  diagnosisPrompt,
  qoderChildEnvironment,
  redactRunnerText,
  repairPrompt,
  resolveQoderAuth,
  startRepairSession,
  type QoderAdapter,
  type RunnerEvent,
} from "../src/index";
import { repairManifest, temporaryWorkspace } from "./helpers";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) {
    await cleanup();
  }
});

describe("@accesspath/qoder-runner", () => {
  it("exports the official package surface", () => {
    expect(PACKAGE_NAME).toBe("@accesspath/qoder-runner");
  });

  it("builds bounded prompts from the validated manifest", () => {
    const manifest = repairManifest();
    expect(diagnosisPrompt(manifest)).toContain("strictly read-only");
    expect(diagnosisPrompt(manifest)).toContain("untrusted evidence");
    expect(repairPrompt(manifest, "Edit the eligibility control.")).toContain(
      "Do not install",
    );
  });

  it("selects PAT or local qodercli auth without exposing the token", () => {
    expect(
      resolveQoderAuth("auto", {
        QODER_PERSONAL_ACCESS_TOKEN: "test-token",
      }),
    ).toEqual({
      type: "accessToken",
      accessToken: { envVar: "QODER_PERSONAL_ACCESS_TOKEN" },
    });
    expect(resolveQoderAuth("auto", {})).toEqual({ type: "qodercli" });
    expect(() => resolveQoderAuth("pat", {})).toThrow(
      /QODER_PERSONAL_ACCESS_TOKEN/,
    );
  });

  it("passes a minimal child environment", () => {
    const environment = qoderChildEnvironment("C:\\artifacts", {
      PATH: "bin",
      SYSTEMROOT: "C:\\Windows",
      UNRELATED_SECRET: "must-not-pass",
    });
    expect(environment).toMatchObject({
      PATH: "bin",
      SYSTEMROOT: "C:\\Windows",
    });
    expect(environment).not.toHaveProperty("UNRELATED_SECRET");
  });

  it("redacts tokens, credentials, and personal absolute paths", () => {
    const text = redactRunnerText(
      "Authorization: Bearer alpha password=hunter2 C:\\Users\\alex\\repo\\file.ts",
    );
    expect(text).not.toContain("alpha");
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("alex");
    expect(text).toContain("[absolute-path]");
  });

  it("streams completed diagnosis without exposing hidden reasoning", async () => {
    const workspace = await temporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const events: RunnerEvent[] = [];
    const handle = await startRepairSession({
      adapter: new DeterministicMockQoderAdapter({
        diagnosis: "Update source and add a focused regression test.",
      }),
      approvedPlan: "Update source and add a focused regression test.",
      artifactRoot: workspace.artifactRoot,
      emit: (event) => {
        events.push(event);
      },
      manifest: repairManifest(),
      mode: "diagnosis",
      repairSessionId: "repair-001",
      requestApproval: async () => ({ decision: "deny" }),
      worktreePath: workspace.worktreePath,
    });

    const result = await handle.turn;
    expect(result.result).toContain("focused regression test");
    expect(events).toContainEqual({
      type: "agent.message.completed",
      payload: {
        text: "Update source and add a focused regression test.",
      },
    });
    expect(JSON.stringify(events)).not.toContain("Hidden reasoning");
    await handle.close();
  });

  it("applies approved multi-file edits and supports rewind preview/apply", async () => {
    const workspace = await temporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const requestApproval = vi.fn(async () => ({
      decision: "approve-once" as const,
    }));
    const handle = await startRepairSession({
      adapter: new DeterministicMockQoderAdapter({
        edits: [
          {
            filePath: "src/feature.ts",
            oldText: "old source",
            newText: "new source",
          },
          {
            filePath: "tests/feature.test.ts",
            oldText: "old test",
            newText: "new test",
          },
        ],
      }),
      approvedPlan: "Apply the approved source and regression-test edits.",
      artifactRoot: workspace.artifactRoot,
      manifest: repairManifest(),
      mode: "repair",
      repairSessionId: "repair-001",
      requestApproval,
      worktreePath: workspace.worktreePath,
    });

    await expect(handle.turn).resolves.toMatchObject({
      resultSubtype: "success",
    });
    expect(
      await readFile(join(workspace.worktreePath, "src", "feature.ts"), "utf8"),
    ).toContain("new source");
    expect(
      await readFile(
        join(workspace.worktreePath, "tests", "feature.test.ts"),
        "utf8",
      ),
    ).toContain("new test");
    expect(requestApproval).toHaveBeenCalledTimes(2);

    await expect(handle.rewindFiles({ dryRun: true })).resolves.toMatchObject({
      canRewind: true,
      filesChanged: ["src/feature.ts", "tests/feature.test.ts"],
    });
    expect(
      await readFile(join(workspace.worktreePath, "src", "feature.ts"), "utf8"),
    ).toContain("new source");
    await expect(handle.rewindFiles()).resolves.toMatchObject({
      canRewind: true,
    });
    expect(
      await readFile(join(workspace.worktreePath, "src", "feature.ts"), "utf8"),
    ).toContain("old source");
    await handle.close();
  });

  it("creates an approved file with Write and deletes it on rewind", async () => {
    const workspace = await temporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const events: RunnerEvent[] = [];
    const createdPath = join(
      workspace.worktreePath,
      "tests",
      "created.test.ts",
    );
    const handle = await startRepairSession({
      adapter: new DeterministicMockQoderAdapter({
        edits: [
          {
            filePath: "src/feature.ts",
            oldText: "old source",
            newText: "new source",
          },
        ],
        writes: [
          {
            filePath: "tests/created.test.ts",
            content: "new regression test\n",
          },
        ],
      }),
      approvedPlan: "Edit the source and create a regression test.",
      artifactRoot: workspace.artifactRoot,
      emit: (event) => {
        events.push(event);
      },
      manifest: repairManifest(),
      mode: "repair",
      repairSessionId: "repair-001",
      requestApproval: async () => ({ decision: "approve-once" }),
      worktreePath: workspace.worktreePath,
    });

    await expect(handle.turn).resolves.toMatchObject({
      resultSubtype: "success",
    });
    await expect(readFile(createdPath, "utf8")).resolves.toBe(
      "new regression test\n",
    );
    expect(events).toContainEqual({
      type: "tool.started",
      payload: expect.objectContaining({
        toolName: "Write",
        targetPaths: ["tests/created.test.ts"],
      }),
    });

    await expect(handle.rewindFiles({ dryRun: true })).resolves.toMatchObject({
      canRewind: true,
      filesChanged: ["src/feature.ts", "tests/created.test.ts"],
    });
    await expect(access(createdPath)).resolves.toBeUndefined();

    await expect(handle.rewindFiles()).resolves.toMatchObject({
      canRewind: true,
    });
    await expect(
      readFile(join(workspace.worktreePath, "src", "feature.ts"), "utf8"),
    ).resolves.toBe("old source\n");
    await expect(access(createdPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await handle.close();
  });

  it("leaves files unchanged when an edit approval is denied", async () => {
    const workspace = await temporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const handle = await startRepairSession({
      adapter: new DeterministicMockQoderAdapter({
        edits: [
          {
            filePath: "src/feature.ts",
            oldText: "old source",
            newText: "new source",
          },
        ],
      }),
      approvedPlan: "Attempt the approved out-of-scope edit.",
      artifactRoot: workspace.artifactRoot,
      manifest: repairManifest(),
      mode: "repair",
      repairSessionId: "repair-001",
      requestApproval: async () => ({
        decision: "deny",
        reason: "Not approved.",
      }),
      worktreePath: workspace.worktreePath,
    });

    await handle.turn;
    expect(
      await readFile(join(workspace.worktreePath, "src", "feature.ts"), "utf8"),
    ).toBe("old source\n");
    await handle.close();
  });

  it("does not create a file when Write approval is denied", async () => {
    const workspace = await temporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const createdPath = join(workspace.worktreePath, "tests", "denied.test.ts");
    const handle = await startRepairSession({
      adapter: new DeterministicMockQoderAdapter({
        writes: [
          {
            filePath: "tests/denied.test.ts",
            content: "must not be written\n",
          },
        ],
      }),
      approvedPlan: "Attempt to create a regression test.",
      artifactRoot: workspace.artifactRoot,
      manifest: repairManifest(),
      mode: "repair",
      repairSessionId: "repair-001",
      requestApproval: async () => ({
        decision: "deny",
        reason: "Not approved.",
      }),
      worktreePath: workspace.worktreePath,
    });

    await expect(handle.turn).resolves.toMatchObject({
      resultSubtype: "success",
    });
    await expect(access(createdPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(handle.rewindFiles({ dryRun: true })).resolves.toMatchObject({
      canRewind: false,
      filesChanged: [],
    });
    await handle.close();
  });

  it("interrupts an active mock turn and reaches a closed state", async () => {
    const workspace = await temporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const events: RunnerEvent[] = [];
    const handle = await startRepairSession({
      adapter: new DeterministicMockQoderAdapter({ streamDelayMs: 50 }),
      approvedPlan: "Apply the approved repair.",
      artifactRoot: workspace.artifactRoot,
      emit: (event) => {
        events.push(event);
      },
      manifest: repairManifest(),
      mode: "diagnosis",
      repairSessionId: "repair-001",
      requestApproval: async () => ({ decision: "deny" }),
      worktreePath: workspace.worktreePath,
    });

    await handle.interrupt();
    await expect(handle.turn).rejects.toThrow(/before producing a result/);
    await expect(handle.closed).resolves.toBeUndefined();
    expect(events.at(-1)?.type).toBe("session.paused");
    await handle.close();
  });

  it("rejects non-success SDK results without reporting a completed turn", async () => {
    const workspace = await temporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const adapter: QoderAdapter = {
      start(options) {
        return {
          async *[Symbol.asyncIterator]() {
            yield {
              type: "result",
              subtype: "error_during_execution",
              duration_ms: 1,
              duration_api_ms: 0,
              is_error: true,
              num_turns: 1,
              stop_reason: "error",
              total_cost_usd: 0,
              usage: {},
              modelUsage: {},
              permission_denials: [],
              errors: ["bounded SDK failure"],
              uuid: "00000000-0000-4000-8000-000000000001",
              session_id: options.sessionId,
            } as never;
          },
          async close() {},
          async interrupt() {},
          async rewindFiles() {
            return { canRewind: false };
          },
        };
      },
    };
    const handle = await startRepairSession({
      adapter,
      approvedPlan: "Apply the approved repair.",
      artifactRoot: workspace.artifactRoot,
      manifest: repairManifest(),
      mode: "repair",
      repairSessionId: "repair-001",
      requestApproval: async () => ({ decision: "deny" }),
      worktreePath: workspace.worktreePath,
    });

    await expect(handle.turn).rejects.toThrow("bounded SDK failure");
    await expect(handle.closed).resolves.toBeUndefined();
    await handle.close();
  });
});
