import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CommandSpec } from "@accesspath/contracts";
import type {
  RepairSessionHandle,
  RepairTurnResult,
} from "@accesspath/qoder-runner";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SupervisedProcess } from "../src/process-supervisor";
import { RepairService } from "../src/repair-service";

const directories: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("RepairService shutdown deadlines", () => {
  it("does not wait forever for preview or Qoder cleanup promises", async () => {
    const artifactRoot = await temporaryDirectory(
      "repair-shutdown-artifacts-",
    );
    const repositoryRoot = await temporaryDirectory(
      "repair-shutdown-repository-",
    );
    const service = new RepairService({
      artifactRoot,
      editableRepositoryRoot: repositoryRoot,
    });
    const never = new Promise<never>(() => undefined);
    const command: CommandSpec = {
      id: "preview",
      label: "Preview",
      executable: "npm",
      args: ["run", "preview"],
      cwdRelative: ".",
      timeoutMs: 60_000,
      category: "start",
    };
    const cancel = vi.fn(() => never);
    const preview: SupervisedProcess = {
      command,
      pid: 1234,
      result: never,
      cancel,
    };
    const interrupt = vi.fn(() => never);
    const close = vi.fn(() => never);
    const handle: RepairSessionHandle = {
      closed: never,
      turn: never as Promise<RepairTurnResult>,
      userMessageId: "00000000-0000-4000-8000-000000000001",
      close,
      interrupt,
      rewindFiles: vi.fn(() => never),
    };
    const internals = service as unknown as {
      activePreviews: Map<
        string,
        { process: SupervisedProcess; url: string }
      >;
      activeQoder: Map<
        string,
        {
          abortController: AbortController;
          handle: RepairSessionHandle;
          interrupted: boolean;
          lifecycle: "running" | "completed" | "interrupted";
          mode: "diagnosis" | "repair";
          turnId: string;
          turnCompleted: boolean;
        }
      >;
    };
    internals.activePreviews.set("repair-preview", {
      process: preview,
      url: "http://127.0.0.1:4173",
    });
    internals.activeQoder.set("repair-qoder", {
      abortController: new AbortController(),
      handle,
      interrupted: false,
      lifecycle: "running",
      mode: "repair",
      turnId: "turn-1",
      turnCompleted: false,
    });

    await expect(
      Promise.race([
        service.shutdown(),
        new Promise<never>((_resolve, reject) =>
          setTimeout(
            () => reject(new Error("Shutdown exceeded its deadline.")),
            3_000,
          ),
        ),
      ]),
    ).resolves.toBeUndefined();
    expect(cancel).toHaveBeenCalledOnce();
    expect(interrupt).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(internals.activePreviews.size).toBe(0);
    expect(internals.activeQoder.size).toBe(0);
  }, 5_000);
});
