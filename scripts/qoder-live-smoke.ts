import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  RepairManifestSchema,
  RepositoryConfigSchema,
} from "@accesspath/contracts";
import {
  assertBaseIntegrity,
  cleanupWorkspace,
  getDiff,
  prepareWorkspace,
} from "@accesspath/git-workspace";
import {
  createAgentAdapter,
  redactRunnerText,
  resolveAgentProvider,
  resolveOpenAiConfiguration,
  resolveQwenConfiguration,
  planTaskContract,
  startRepairSession,
  type RepairSessionHandle,
  type RunnerEvent,
} from "@accesspath/qoder-runner";

import { qoderAuthAvailability } from "../apps/companion/src/qoder-auth";

const execute = promisify(execFile);
const smokeRoot = join(homedir(), ".accesspath", "agent-live-smoke");
const repositoryRoot = join(smokeRoot, "repository");
const artifactRoot = join(smokeRoot, "artifacts");
const repairId = "repair-agent-live-smoke";
let workspace:
  | Awaited<ReturnType<typeof prepareWorkspace>>
  | undefined;
const handles: RepairSessionHandle[] = [];

async function git(args: string[]): Promise<string> {
  const result = await execute("git", args, { cwd: repositoryRoot });
  return result.stdout.trim();
}

async function withTimeout<Value>(
  promise: Promise<Value>,
  handle: RepairSessionHandle,
  milliseconds = 180_000,
): Promise<Value> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          void handle.interrupt();
          reject(new Error("The live agent smoke turn timed out."));
        }, milliseconds);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

async function cleanup(): Promise<void> {
  for (const handle of handles.splice(0).reverse()) {
    await handle.interrupt().catch(() => undefined);
    await handle.close().catch(() => undefined);
    await handle.closed.catch(() => undefined);
  }
  if (workspace !== undefined) {
    await cleanupWorkspace(workspace, { force: true }).catch(() => undefined);
    workspace = undefined;
  }
  await rm(smokeRoot, { recursive: true, force: true });
}

async function main(): Promise<void> {
  const fullSmoke = process.env.ACCESSPATH_AGENT_FULL_SMOKE === "1";
  const providerArgument = process.argv.indexOf("--provider");
  const requestedProvider =
    providerArgument >= 0 ? process.argv[providerArgument + 1] : undefined;
  const environment = {
    ...process.env,
    ...(requestedProvider === undefined
      ? {}
      : { AGENT_PROVIDER: requestedProvider }),
  };
  const provider = resolveAgentProvider(environment);
  if (provider === "mock") {
    throw new Error("The live smoke requires openai, qoder, or qwen, not mock.");
  }
  const authentication =
    provider === "qoder"
      ? await qoderAuthAvailability()
      : provider === "openai"
        ? (() => {
          const openai = resolveOpenAiConfiguration(environment);
          return {
            available: true,
            model: openai.model,
            sdkVersion: "responses-api",
            strategy: "api-key" as const,
          };
          })()
        : (() => {
            const qwen = resolveQwenConfiguration(environment);
            return {
              available: true,
              model: qwen.model,
              sdkVersion: "0.1.8",
              strategy: "api-key" as const,
            };
          })();
  if (!authentication.available || authentication.strategy === undefined) {
    console.error(
      "Qoder live smoke skipped: configure QODER_PERSONAL_ACCESS_TOKEN or sign in with qodercli.",
    );
    process.exitCode = 2;
    return;
  }

  await cleanup();
  await mkdir(join(repositoryRoot, "src"), { recursive: true });
  await mkdir(artifactRoot, { recursive: true });
  await writeFile(join(repositoryRoot, "src", "message.txt"), "before\n", "utf8");
  await execute("git", ["init", "-b", "main"], { cwd: repositoryRoot });
  await execute("git", ["config", "user.name", "AccessPath Live Smoke"], {
    cwd: repositoryRoot,
  });
  await execute(
    "git",
    ["config", "user.email", "accesspath-live-smoke@example.invalid"],
    { cwd: repositoryRoot },
  );
  await execute("git", ["add", "."], { cwd: repositoryRoot });
  await execute("git", ["commit", "-m", "Create agent live smoke fixture"], {
    cwd: repositoryRoot,
  });
  const baseCommit = await git(["rev-parse", "HEAD"]);

  const repository = RepositoryConfigSchema.parse({
    repositoryPath: repositoryRoot,
    baseBranch: "main",
    baseCommit,
    startCommand: {
      id: "preview",
      label: "Preview",
      executable: process.execPath,
      args: ["--version"],
      cwdRelative: ".",
      timeoutMs: 5_000,
      category: "start",
    },
    testCommands: [],
    previewUrl: "http://127.0.0.1:4174/",
    allowedPathGlobs: ["src/**"],
  });
  const manifest = RepairManifestSchema.parse({
    schemaVersion: "1.0.0",
    id: "manifest-agent-live-smoke",
    auditBundleId: "bundle-agent-live-smoke",
    findingIds: ["AP-LIVE-001"],
    affectedActions: ["Change the disposable message fixture"],
    observations: [
      "src/message.txt contains the exact text before and must contain the exact text after.",
    ],
    evidenceRefs: [],
    constraints: [
      "Edit only src/message.txt.",
      "Replace before with after and make no other file changes.",
    ],
    nonGoals: ["Do not run commands or access the network."],
    allowedPathGlobs: ["src/message.txt"],
    readPathGlobs: ["src/message.txt"],
    verification: {
      taskContract: {
        schemaVersion: "1.0.0",
        id: "task-agent-live-smoke",
        title: "Agent live smoke",
        goal: "Exercise one bounded disposable edit.",
        startUrl: "http://127.0.0.1:4174/",
        targetPolicy: "local-explicit",
        success: { visibleText: "after" },
        forbiddenActions: [],
        expectedSteps: [
          {
            id: "inspect-message",
            intent: "Inspect the disposable message",
            action: { kind: "press", key: "Enter" },
            checkpoint: true,
          },
        ],
        fixtureValues: {},
        viewport: { width: 1280, height: 800 },
        timeoutMs: 10_000,
      },
      commands: [],
    },
  });
  workspace = await prepareWorkspace(repository, {
    artifactRoot,
    repairId,
  });
  const events: RunnerEvent[] = [];
  const emit = (event: RunnerEvent) => {
    events.push(event);
    if (
      process.env.ACCESSPATH_AGENT_SMOKE_DEBUG === "1" &&
      event.type !== "agent.message.delta"
    ) {
      console.log(
        `[agent-smoke:${event.type}] ${JSON.stringify(event.payload)}`,
      );
    }
  };

  let approvedPlan =
    'Replace the exact text "before" in src/message.txt with "after".';
  let qoderSessionId: string | undefined;
  const adapter = createAgentAdapter({ artifactRoot, environment });
  if (fullSmoke) {
    const planning = await planTaskContract({
      adapter,
      emit,
      objective:
        "Confirm that the disposable local fixture can be reviewed before its approved source repair.",
      reconnaissance: {
        availableActions: [{ key: "Enter", kind: "press" }],
        expectedVisibleText: ["before"],
        startUrl: "http://127.0.0.1:4174/",
        targetPolicy: "local-explicit",
      },
    });
    if (
      planning.task.expectedSteps.length === 0 ||
      planning.task.startUrl !== "http://127.0.0.1:4174/"
    ) {
      throw new Error(
        "The live mission planner did not return a usable disposable task contract.",
      );
    }
    const diagnosis = await startRepairSession({
      adapter,
      artifactRoot,
      emit,
      manifest,
      mode: "diagnosis",
      repairSessionId: repairId,
      requestApproval: async () => ({ decision: "deny" }),
      worktreePath: workspace.worktreePath,
    });
    handles.push(diagnosis);
    const diagnosisResult = await withTimeout(diagnosis.turn, diagnosis);
    if (
      !events.some(
        (event) =>
          event.type === "agent.message.completed" &&
          typeof event.payload.text === "string",
      )
    ) {
      throw new Error(
        "The live diagnosis produced no user-facing streamed message.",
      );
    }
    approvedPlan = `${diagnosisResult.result}

${approvedPlan}`;
    qoderSessionId = diagnosisResult.qoderSessionId;
    await diagnosis.close();
    await diagnosis.closed;
    handles.splice(handles.indexOf(diagnosis), 1);
  }

  const repair = await startRepairSession({
    adapter,
    approvedPlan,
    artifactRoot,
    emit,
    manifest,
    mode: "repair",
    qoderSessionId,
    repairSessionId: repairId,
    resume: qoderSessionId !== undefined,
    requestApproval: async (request) =>
      request.kind === "tool" &&
      request.targetPaths.length === 1 &&
      request.targetPaths[0] === "src/message.txt"
        ? { decision: "approve-once" }
        : { decision: "deny", reason: "Outside the live smoke scope." },
    worktreePath: workspace.worktreePath,
  });
  handles.push(repair);
  await withTimeout(repair.turn, repair);
  const changed = await getDiff(workspace);
  if (
    changed.changedFiles.join(",") !== "src/message.txt" ||
    !changed.patch.includes("+after")
  ) {
    throw new Error("The live edit did not match the approved disposable diff.");
  }
  if ((await readFile(join(repositoryRoot, "src", "message.txt"), "utf8")) !== "before\n") {
    throw new Error("The base checkout changed during the live repair.");
  }

  const preview = await repair.rewindFiles({ dryRun: true });
  if (!preview.canRewind || !preview.filesChanged?.includes("src/message.txt")) {
    throw new Error("The live rewind preview did not include the approved edit.");
  }
  await repair.rewindFiles();
  if ((await getDiff(workspace)).changedFiles.length !== 0) {
    throw new Error("The live rewind did not restore the worktree.");
  }
  await assertBaseIntegrity(workspace);

  const serializedEvents = JSON.stringify(events);
  const token =
    provider === "qwen" || provider === "openai"
      ? process.env.OPENAI_API_KEY ?? process.env.QWEN_API_KEY
      : process.env.QODER_PERSONAL_ACCESS_TOKEN;
  if (token?.trim() && serializedEvents.includes(token)) {
    throw new Error("The agent credential appeared in live smoke events.");
  }
  if (
    serializedEvents.includes(repositoryRoot) ||
    serializedEvents.includes(artifactRoot)
  ) {
    throw new Error("An absolute disposable path appeared in live smoke events.");
  }

  await repair.close();
  await repair.closed;
  handles.splice(handles.indexOf(repair), 1);
  await cleanupWorkspace(workspace);
  workspace = undefined;
  await rm(smokeRoot, { recursive: true, force: true });
  console.log(
    `Agent live smoke passed with ${provider} SDK ${authentication.sdkVersion} using ${authentication.strategy} authentication (${fullSmoke ? "planning + diagnosis + repair" : "single repair turn"}).`,
  );
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    `Agent live smoke failed: ${redactRunnerText(message, {
      artifactRoot,
      environment: process.env,
      worktreePath: workspace?.worktreePath,
    })}`,
  );
  await cleanup();
  process.exitCode = 1;
});
