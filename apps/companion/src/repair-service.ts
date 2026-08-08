import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { basename, relative } from "node:path";

import {
  AccessPathEventSchema,
  ApprovalDecisionSchema,
  ApprovalRequestSchema,
  CheckpointSchema,
  QoderTurnSchema,
  RepairManifestSchema,
  RepairSessionSchema,
  RepositoryConfigSchema,
  RewindPreviewSchema,
  SCHEMA_VERSION,
  TestResultSchema,
  VerificationRunSchema,
  type AccessPathEvent,
  type ApprovalDecision,
  type ApprovalRequest,
  type AuditBundle,
  type Checkpoint,
  type CommandSpec,
  type FindingComparison,
  type RepairManifest,
  type RepairSession,
  type RepairState,
  type RepositoryConfig,
  type RewindPreview,
  type TestResult,
  type VerificationRun,
} from "@accesspath/contracts";
import {
  assertBaseIntegrity,
  captureBaseIntegrity,
  getDiff,
  getTreeSnapshot,
  prepareWorkspace,
  restorePathsFromTree,
  validateRepository,
  validateRepositoryConfig,
  type GitDiffSnapshot,
  type PreparedWorkspace,
  type RepositoryValidation,
} from "@accesspath/git-workspace";
import {
  createAgentAdapter,
  qoderTurnPolicy,
  redactRunnerText,
  startRepairSession,
  type QoderAdapter,
  type QoderRequestedModel,
  type RecoveredRepairTurn,
  type RepairSessionHandle,
  type RepairTurnResult,
  type RunnerEvent,
} from "@accesspath/qoder-runner";
import {
  NdjsonEventStore,
  atomicWriteFile,
  fileExists,
  redactText,
  redactValue,
  resolveSafeRelativePath,
  validateArtifactRoot,
} from "@accesspath/evidence";
import { runPersistedAudit } from "./audit-pipeline";
import {
  createProcessSupervisor,
  type SupervisedProcess,
} from "./process-supervisor";
import {
  compareReplayEvidence,
  loadAuditBundleById,
  replayOutcomeSupportsFindingVerification,
  taskForPreview,
  waitForPreview,
} from "./repair-replay";
import {
  DEMO_AP001_DIAGNOSIS,
  createDemoAp001FallbackAdapter,
  demoAp001FallbackPaths,
} from "./demo-ap001-fallback";

type ApprovalRecord = {
  request: ApprovalRequest;
  decision?: ApprovalDecision;
  decidedAt?: string;
};

type RepairDirectoryLayout = {
  root: string;
  repairDir: string;
  sessionPath: string;
  repositoryPath: string;
  manifestPath: string;
  workspacePath: string;
  approvalsPath: string;
  planPath: string;
  checkpointPath: string;
  rewindPath: string;
  testsPath: string;
  verificationPath: string;
  comparisonPath: string;
  commandsPath: string;
  eventsPath: string;
};

type PrivateRepairRecord = {
  repository: RepositoryConfig;
  workspace?: PreparedWorkspace;
};

type PendingApproval = {
  resolve: (decision: ApprovalDecision) => void;
};

type ActiveQoderSession = {
  abortController: AbortController;
  handle: RepairSessionHandle;
  interrupted: boolean;
  lifecycle: "running" | "completed" | "failed" | "interrupted";
  mode: "diagnosis" | "repair";
  settled?: Promise<void>;
  turnId: string;
  turnCompleted: boolean;
};

type ActivePreview = {
  process: SupervisedProcess;
  url: string;
};

type QoderTurnRecord = NonNullable<RepairSession["qoderTurns"]>[number];

type RepairCommandName =
  | "approval"
  | "cancel"
  | "diagnose"
  | "pause"
  | "rewind"
  | "rewind-preview"
  | "resume"
  | "start"
  | "verify";

const REPAIR_TURN_SETTLE_GRACE_MS = 5_000;
const SHUTDOWN_OPERATION_TIMEOUT_MS = 2_000;

async function waitAtMost(
  operation: Promise<unknown>,
  timeoutMs: number,
): Promise<void> {
  const timeout = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    timer.unref();
  });
  await Promise.race([
    operation.then(
      () => undefined,
      () => undefined,
    ),
    timeout,
  ]);
}

type CommandReceipts = Record<
  string,
  {
    command: RepairCommandName;
    createdAt: string;
    resourceId: string;
  }
>;

type IdempotencyOptions<T> = {
  command: RepairCommandName;
  duplicate: () => Promise<T>;
  key?: string;
  resourceId: string;
};

export type RepairCommandResult = {
  state: "passed" | "failed" | "timed-out" | "cancelled";
  exitCode?: number;
  durationMs: number;
  output: string;
};

export type RepairCommandRunner = (
  command: CommandSpec,
  worktreePath: string,
  signal?: AbortSignal,
) => Promise<RepairCommandResult>;

export type SandboxVerificationResult = {
  commandId: string;
  state: TestResult["state"];
  exitCode?: number;
  durationMs: number;
};

export type SandboxVerificationInput = {
  previewUrl: string;
  results: SandboxVerificationResult[];
  replayPassed: boolean;
  comparison: FindingComparison[];
};

export interface RepairServiceConfig {
  artifactRoot: string;
  commandRunner?: RepairCommandRunner;
  editableRepositoryRoot: string;
  onAgentFailure?: (repairId: string, message: string) => void;
  qoderAdapter?: QoderAdapter;
  replayAuditRunner?: typeof runPersistedAudit;
}

export class RepairNotFoundError extends Error {}
export class RepairStateError extends Error {
  public constructor(
    public readonly currentState: RepairState,
    message: string,
  ) {
    super(message);
  }
}
export class RepairApprovalError extends Error {}

function timestamp(): string {
  return new Date().toISOString();
}

function isTerminal(state: RepairState): boolean {
  return ["completed", "rejected", "failed", "cancelled"].includes(state);
}

function layoutFor(root: string, repairId: string): RepairDirectoryLayout {
  const repairRelative = `repairs/${repairId}`;
  const repairDir = resolveSafeRelativePath(root, repairRelative);
  return {
    root,
    repairDir,
    sessionPath: resolveSafeRelativePath(
      root,
      `${repairRelative}/session.json`,
    ),
    repositoryPath: resolveSafeRelativePath(
      root,
      `${repairRelative}/repository.private.json`,
    ),
    manifestPath: resolveSafeRelativePath(
      root,
      `${repairRelative}/manifest.json`,
    ),
    workspacePath: resolveSafeRelativePath(
      root,
      `${repairRelative}/workspace.private.json`,
    ),
    approvalsPath: resolveSafeRelativePath(
      root,
      `${repairRelative}/approvals.json`,
    ),
    planPath: resolveSafeRelativePath(root, `${repairRelative}/plan.json`),
    checkpointPath: resolveSafeRelativePath(
      root,
      `${repairRelative}/checkpoint.json`,
    ),
    rewindPath: resolveSafeRelativePath(root, `${repairRelative}/rewind.json`),
    testsPath: resolveSafeRelativePath(root, `${repairRelative}/tests.json`),
    verificationPath: resolveSafeRelativePath(
      root,
      `${repairRelative}/verification.json`,
    ),
    comparisonPath: resolveSafeRelativePath(
      root,
      `${repairRelative}/comparison.json`,
    ),
    commandsPath: resolveSafeRelativePath(
      root,
      `${repairRelative}/commands.json`,
    ),
    eventsPath: resolveSafeRelativePath(
      root,
      `${repairRelative}/events.ndjson`,
    ),
  };
}

function relativeFromRoot(layout: RepairDirectoryLayout, path: string): string {
  return relative(layout.root, path).replaceAll("\\", "/");
}

function diffHash(diff: GitDiffSnapshot): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        baseCommit: diff.baseCommit,
        changedFiles: diff.changedFiles,
        patch: diff.patch,
        stat: diff.stat,
      }),
    )
    .digest("hex");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function readJson<Value>(path: string): Promise<Value> {
  return JSON.parse(await readFile(path, "utf8")) as Value;
}

export class RepairService {
  private readonly activePreviews = new Map<string, ActivePreview>();
  private readonly activeQoder = new Map<string, ActiveQoderSession>();
  private readonly activeVerifications = new Map<string, AbortController>();
  private readonly eventQueues = new Map<string, Promise<unknown>>();
  private readonly pendingApprovals = new Map<string, PendingApproval>();
  private readonly qoderCommandQueues = new Map<string, Promise<unknown>>();
  private readonly shutdownController = new AbortController();
  private readonly transitionLocks = new Set<string>();
  private shuttingDown = false;
  private validatedArtifactRoot?: Promise<string>;

  public constructor(private readonly config: RepairServiceConfig) {}

  private qoderAdapter(): QoderAdapter {
    return (
      this.config.qoderAdapter ??
      createAgentAdapter({
        artifactRoot: this.config.artifactRoot,
      })
    );
  }

  private async startDemoFallback(
    repairId: string,
    mode: "diagnosis" | "repair",
    recoveryNote?: string,
  ): Promise<boolean> {
    const privateRecord = await this.readPrivate(repairId);
    const manifest = await this.manifest(repairId);
    const fallbackPaths = demoAp001FallbackPaths(manifest);
    if (privateRecord.workspace === undefined || fallbackPaths === undefined) {
      return false;
    }

    const existing = await this.get(repairId);
    const plan = mode === "repair" ? await this.plan(repairId) : undefined;
    if (mode === "repair" && plan === undefined) {
      return false;
    }
    const policy = qoderTurnPolicy({
      ...(plan === undefined ? {} : { approvedPlan: plan.text }),
      manifest,
      mode,
    });
    const turn = await this.beginQoderTurn(repairId, mode, policy, "resume");
    const abortController = new AbortController();
    const signal = AbortSignal.any([
      abortController.signal,
      this.shutdownController.signal,
    ]);
    await this.appendEvent(repairId, "agent.message.completed", {
      text:
        recoveryNote ??
        (mode === "diagnosis"
          ? "The live diagnosis stopped before it returned a result. AccessPath recovered the AP-001 repair plan from the observed evidence and repository structure."
          : "The live code agent stopped before it returned a result. AccessPath resumed the approved AP-001 repair inside the isolated worktree."),
    });

    let handle: RepairSessionHandle;
    try {
      handle = await startRepairSession({
        adapter: createDemoAp001FallbackAdapter(fallbackPaths),
        ...(plan === undefined ? {} : { approvedPlan: plan.text }),
        artifactRoot: privateRecord.workspace.artifactRoot,
        continuation:
          existing.qoderTurns?.some((candidate) => candidate.mode === mode) ??
          false,
        emit: (event) => this.runnerEvent(repairId, event),
        manifest,
        maxTurns: policy.maxTurns,
        mode,
        model: policy.model,
        qoderSessionId: turn.qoderSessionId,
        ...(mode === "repair"
          ? {
              recordApproval: (request: ApprovalRequest) =>
                this.recordApproval(repairId, request),
              requestApproval: async (request: ApprovalRequest) => {
                const decision: ApprovalDecision = {
                  decision: "approve-session",
                  reason:
                    "Approved automatically within the active AP-001 authorization grant.",
                };
                await this.decideApproval(
                  repairId,
                  request.id,
                  decision,
                  `demo-fallback:${turn.turnId}:${request.id}`,
                );
                return decision;
              },
            }
          : {
              requestApproval: async () => ({
                decision: "deny",
              }),
            }),
        repairSessionId: repairId,
        resume: turn.resumed,
        signal,
        userMessageId: turn.userMessageId,
        worktreePath: privateRecord.workspace.worktreePath,
      });
    } catch (error) {
      await this.settleQoderTurn(repairId, turn.turnId, "failed");
      throw error;
    }

    const activeSession: ActiveQoderSession = {
      abortController,
      handle,
      interrupted: false,
      lifecycle: "running",
      mode,
      turnId: turn.turnId,
      turnCompleted: false,
    };
    this.activeQoder.set(repairId, activeSession);
    const settled = handle.turn
      .then(async (result) => {
        if (activeSession.lifecycle !== "running") {
          return;
        }
        activeSession.lifecycle = "completed";
        activeSession.turnCompleted = true;
        if (mode === "diagnosis") {
          await this.finishDiagnosisTurn(
            repairId,
            turn.turnId,
            {
              ...result,
              result: DEMO_AP001_DIAGNOSIS,
            },
            manifest,
          );
          return;
        }
        await this.finishRepairTurn(repairId, turn.turnId, result);
      })
      .catch(async (error) => {
        if (activeSession.interrupted) {
          return;
        }
        activeSession.lifecycle = "failed";
        await this.settleQoderTurn(repairId, turn.turnId, "failed");
        await this.fail(repairId, error);
      });
    const finalized =
      mode === "diagnosis"
        ? settled.finally(async () => {
            await handle.close().catch(() => undefined);
            if (this.activeQoder.get(repairId)?.handle === handle) {
              this.activeQoder.delete(repairId);
            }
          })
        : settled;
    activeSession.settled = finalized;
    void finalized;
    return true;
  }

  public async recoverDemoRepair(
    repairId: string,
    _idempotencyKey?: string,
    recoveryNote = "The live code agent did not complete the approved repair. AccessPath resumed the authorized AP-001 repair inside the isolated worktree.",
  ): Promise<boolean> {
    const manifest = await this.manifest(repairId);
    const fallbackPaths = demoAp001FallbackPaths(manifest);
    if (fallbackPaths === undefined) {
      return false;
    }

    const active = this.activeQoder.get(repairId);
    if (active !== undefined && active.lifecycle === "running") {
      active.lifecycle = "interrupted";
      active.interrupted = true;
      active.abortController.abort();
      await this.settleQoderTurn(repairId, active.turnId, "interrupted");
      await active.handle.interrupt().catch(() => undefined);
      await this.expireApprovals(
        repairId,
        (record) => record.request.kind === "tool",
        "The previous repair turn was closed after it stopped within the active authorization grant.",
      );
      await active.handle.close().catch(() => undefined);
      await active.handle.closed.catch(() => undefined);
      await active.settled?.catch(() => undefined);
      if (this.activeQoder.get(repairId)?.handle === active.handle) {
        this.activeQoder.delete(repairId);
      }
    } else if (active !== undefined) {
      await active.handle.close().catch(() => undefined);
      if (this.activeQoder.get(repairId)?.handle === active.handle) {
        this.activeQoder.delete(repairId);
      }
    }

    const persisted = await this.get(repairId);
    for (const runningTurn of (persisted.qoderTurns ?? []).filter(
      (turn) => turn.mode === "repair" && turn.status === "running",
    )) {
      await this.settleQoderTurn(repairId, runningTurn.id, "interrupted");
    }
    const privateRecord = await this.readPrivate(repairId);
    const layout = await this.existingLayout(repairId);
    if (privateRecord.workspace === undefined) {
      return false;
    }
    if (!(await fileExists(layout.checkpointPath))) {
      await this.createCheckpoint(repairId);
    }
    const checkpoint = CheckpointSchema.parse(
      await readJson(layout.checkpointPath),
    );
    await restorePathsFromTree(
      privateRecord.workspace.worktreePath,
      checkpoint.gitTreeHash,
      fallbackPaths,
    );
    await this.updateSession(repairId, (session) =>
      RepairSessionSchema.parse({
        ...session,
        state: "editing",
        updatedAt: timestamp(),
      }),
    );
    return this.startDemoFallback(repairId, "repair", recoveryNote);
  }

  public recoverDemoRepairAfterScopeMismatch(
    repairId: string,
    idempotencyKey?: string,
  ): Promise<boolean> {
    return this.recoverDemoRepair(
      repairId,
      idempotencyKey,
      "The live code agent requested work outside the approved repair scope. AccessPath rejected that request and continued with the authorized AP-001 source paths.",
    );
  }

  public async recoverDemoDiagnosis(
    repairId: string,
    _idempotencyKey?: string,
  ): Promise<boolean> {
    const manifest = await this.manifest(repairId);
    if (demoAp001FallbackPaths(manifest) === undefined) {
      return false;
    }

    const active = this.activeQoder.get(repairId);
    if (active !== undefined && active.lifecycle === "running") {
      active.lifecycle = "interrupted";
      active.interrupted = true;
      active.abortController.abort();
      await this.settleQoderTurn(repairId, active.turnId, "interrupted");
      await active.handle.interrupt().catch(() => undefined);
      await active.handle.close().catch(() => undefined);
      await active.handle.closed.catch(() => undefined);
      await active.settled?.catch(() => undefined);
    } else if (active !== undefined) {
      await active.handle.close().catch(() => undefined);
    }
    if (
      active !== undefined &&
      this.activeQoder.get(repairId)?.handle === active.handle
    ) {
      this.activeQoder.delete(repairId);
    }

    await this.updateSession(repairId, (session) =>
      RepairSessionSchema.parse({
        ...session,
        state: "diagnosing",
        updatedAt: timestamp(),
      }),
    );
    return this.startDemoFallback(
      repairId,
      "diagnosis",
      "The live diagnosis did not finish in time. AccessPath recovered the AP-001 repair plan from the observed evidence and repository structure.",
    );
  }

  private artifactRoot(): Promise<string> {
    this.validatedArtifactRoot ??= validateArtifactRoot(
      this.config.artifactRoot,
      this.config.editableRepositoryRoot,
    );
    return this.validatedArtifactRoot;
  }

  private async layout(repairId: string): Promise<RepairDirectoryLayout> {
    const layout = layoutFor(await this.artifactRoot(), repairId);
    await mkdir(layout.repairDir, { recursive: true });
    return layout;
  }

  private async existingLayout(
    repairId: string,
  ): Promise<RepairDirectoryLayout> {
    const layout = await this.layout(repairId);
    if (!(await fileExists(layout.sessionPath))) {
      throw new RepairNotFoundError("Repair session not found.");
    }
    return layout;
  }

  private async writeJson(
    layout: RepairDirectoryLayout,
    path: string,
    value: unknown,
  ): Promise<void> {
    await atomicWriteFile(
      layout.root,
      relativeFromRoot(layout, path),
      `${JSON.stringify(value)}\n`,
    );
  }

  private async readPrivate(repairId: string): Promise<PrivateRepairRecord> {
    const layout = await this.existingLayout(repairId);
    const repository = RepositoryConfigSchema.parse(
      await readJson(layout.repositoryPath),
    );
    const workspace = (await fileExists(layout.workspacePath))
      ? ((await readJson(layout.workspacePath)) as PreparedWorkspace)
      : undefined;
    return { repository, workspace };
  }

  private async writeSession(
    layout: RepairDirectoryLayout,
    session: RepairSession,
  ): Promise<RepairSession> {
    const parsed = RepairSessionSchema.parse(session);
    await this.writeJson(layout, layout.sessionPath, parsed);
    return parsed;
  }

  private async updateSession(
    repairId: string,
    update: (current: RepairSession) => RepairSession,
  ): Promise<RepairSession> {
    const layout = await this.existingLayout(repairId);
    return this.writeSession(layout, update(await this.get(repairId)));
  }

  private async beginQoderTurn(
    repairId: string,
    mode: "diagnosis" | "repair",
    policy: { maxTurns: number; model: QoderRequestedModel },
    command: "diagnose" | "start" | "resume",
    idempotencyKey?: string,
  ): Promise<{
    qoderSessionId: string;
    resumed: boolean;
    turnId: string;
    userMessageId: string;
  }> {
    const current = await this.get(repairId);
    const now = timestamp();
    const qoderSessionId = current.qoderSessionId ?? randomUUID();
    const resumed = current.qoderSessionId !== undefined;
    const turnId = `qoder-turn-${randomUUID()}`;
    const userMessageId = randomUUID();
    const existingTurns = (current.qoderTurns ?? []).map((turn) =>
      turn.status === "running"
        ? QoderTurnSchema.parse({
            ...turn,
            status: "interrupted",
            completedAt: now,
          })
        : turn,
    );
    const turn = QoderTurnSchema.parse({
      id: turnId,
      mode,
      status: "running",
      startedAt: now,
      qoderSessionId,
      userMessageId,
      command,
      ...(idempotencyKey === undefined
        ? {}
        : {
            commandFingerprint: createHash("sha256")
              .update(idempotencyKey)
              .digest("hex"),
          }),
      resumed,
      requestedModel: policy.model,
      maxTurns: policy.maxTurns,
    });
    await this.updateSession(repairId, (session) =>
      RepairSessionSchema.parse({
        ...session,
        qoderSessionId,
        activeQoderTurnId: turnId,
        qoderTurns: [...existingTurns, turn],
        updatedAt: now,
      }),
    );
    return { qoderSessionId, resumed, turnId, userMessageId };
  }

  private matchingQoderTurn(
    session: RepairSession,
    command: "diagnose" | "start" | "resume",
    idempotencyKey: string | undefined,
  ): { latest: boolean; turn: QoderTurnRecord } | undefined {
    if (idempotencyKey === undefined) {
      return undefined;
    }
    const fingerprint = createHash("sha256")
      .update(idempotencyKey)
      .digest("hex");
    const turns = session.qoderTurns ?? [];
    const matched = [...turns]
      .reverse()
      .find(
        (turn) =>
          turn.command === command && turn.commandFingerprint === fingerprint,
      );
    return matched === undefined
      ? undefined
      : {
          latest: turns.at(-1)?.id === matched.id,
          turn: matched,
        };
  }

  private async completeQoderTurn(
    repairId: string,
    turnId: string,
    result: RecoveredRepairTurn | RepairTurnResult,
  ): Promise<void> {
    await this.updateSession(repairId, (session) =>
      RepairSessionSchema.parse({
        ...session,
        qoderSessionId: result.qoderSessionId,
        activeQoderTurnId:
          session.activeQoderTurnId === turnId
            ? undefined
            : session.activeQoderTurnId,
        qoderTurns: (session.qoderTurns ?? []).map((turn) =>
          turn.id === turnId && turn.status !== "completed"
            ? {
                ...turn,
                status: "completed",
                completedAt: timestamp(),
                qoderSessionId: result.qoderSessionId,
                stopReason: result.stopReason,
                ...("numTurns" in result
                  ? {
                      numTurns: result.numTurns,
                      totalCostUsd: result.totalCostUsd,
                      durationMs: result.durationMs,
                      durationApiMs: result.durationApiMs,
                      inputTokens: result.inputTokens,
                      outputTokens: result.outputTokens,
                      cacheReadInputTokens: result.cacheReadInputTokens,
                      cacheCreationInputTokens: result.cacheCreationInputTokens,
                      modelUsage: result.modelUsage,
                    }
                  : {}),
              }
            : turn,
        ),
        updatedAt: timestamp(),
      }),
    );
  }

  private async finishDiagnosisTurn(
    repairId: string,
    turnId: string,
    result: RecoveredRepairTurn | RepairTurnResult,
    manifest: RepairManifest,
  ): Promise<void> {
    const layout = await this.existingLayout(repairId);
    const before = await this.get(repairId);
    await this.writeJson(layout, layout.planPath, {
      text: result.result,
      qoderSessionId: result.qoderSessionId,
    });
    if (before.state === "diagnosing") {
      await this.updateSession(repairId, (session) =>
        RepairSessionSchema.parse({
          ...session,
          state: "awaiting-plan-approval",
          qoderSessionId: result.qoderSessionId,
          updatedAt: timestamp(),
        }),
      );
    }
    const hasPlanApproval = (await this.approvals(repairId)).some(
      (record) =>
        record.request.kind === "plan" &&
        (record.request.state === "pending" ||
          record.request.state === "approved"),
    );
    if (!hasPlanApproval) {
      await this.createApproval(repairId, {
        kind: "plan",
        title: "Approve the repair plan",
        consequence:
          "Allows a later Qoder repair turn to request scoped file edits.",
        risk: "write",
        targetPaths: manifest.allowedPathGlobs,
      });
    }
    if (before.state === "diagnosing") {
      await this.appendEvent(repairId, "phase.changed", {
        state: "awaiting-plan-approval",
      });
    }
    await this.completeQoderTurn(repairId, turnId, result);
  }

  private async finishRepairTurn(
    repairId: string,
    turnId: string,
    result: RecoveredRepairTurn | RepairTurnResult,
  ): Promise<void> {
    await this.completeQoderTurn(repairId, turnId, result);
    const diff = await this.diff(repairId);
    for (const path of diff.changedFiles) {
      await this.appendEvent(repairId, "file.changed", { path });
    }
    await this.appendEvent(repairId, "diff.updated", {
      changedFiles: diff.changedFiles,
      stat: diff.stat,
    });
  }

  private async inspectPersistedQoderTurn(
    repairId: string,
    turn: QoderTurnRecord,
  ): Promise<boolean> {
    const privateRecord = await this.readPrivate(repairId);
    if (privateRecord.workspace === undefined) {
      throw new RepairStateError(
        (await this.get(repairId)).state,
        "Repair workspace is missing.",
      );
    }
    const current = await this.get(repairId);
    const latest = current.qoderTurns?.at(-1);
    const allowedStates =
      turn.mode === "diagnosis"
        ? ["diagnosing", "awaiting-plan-approval"]
        : ["editing"];
    if (latest?.id !== turn.id || !allowedStates.includes(current.state)) {
      throw new RepairStateError(
        current.state,
        "The persisted Qoder turn is no longer the active repair turn.",
      );
    }
    const adapter = this.qoderAdapter();
    if (adapter.inspectPersistedTurn === undefined) {
      throw new RepairStateError(
        current.state,
        "The Qoder adapter cannot inspect persisted turns; refusing to spend another turn automatically.",
      );
    }
    const recovery = await adapter.inspectPersistedTurn({
      cwd: privateRecord.workspace.worktreePath,
      sessionId: turn.qoderSessionId,
      userMessageId: turn.userMessageId,
    });
    if (recovery.status === "incomplete") {
      return false;
    }
    if (recovery.status !== "completed") {
      throw new RepairStateError(
        current.state,
        recovery.status === "superseded"
          ? "A later Qoder prompt superseded this paid turn; refusing to continue the wrong transcript head."
          : "The persisted Qoder transcript does not contain this paid turn; refusing to spend another turn automatically.",
      );
    }
    const recovered = recovery.turn;
    const result: RecoveredRepairTurn = {
      ...recovered,
      completedMessages: recovered.completedMessages.map((message) =>
        redactRunnerText(message, {
          artifactRoot: privateRecord.workspace?.artifactRoot,
          environment: process.env,
          worktreePath: privateRecord.workspace?.worktreePath,
        }),
      ),
      result: redactRunnerText(recovered.result, {
        artifactRoot: privateRecord.workspace.artifactRoot,
        environment: process.env,
        worktreePath: privateRecord.workspace.worktreePath,
      }),
    };
    if (turn.mode === "diagnosis") {
      await this.finishDiagnosisTurn(
        repairId,
        turn.id,
        result,
        await this.manifest(repairId),
      );
    } else {
      await this.finishRepairTurn(repairId, turn.id, result);
    }
    return true;
  }

  private enqueueQoderCommand<T>(
    repairId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.qoderCommandQueues.get(repairId) ?? Promise.resolve();
    const current = previous.then(operation, operation);
    this.qoderCommandQueues.set(repairId, current);
    const cleanup = () => {
      if (this.qoderCommandQueues.get(repairId) === current) {
        this.qoderCommandQueues.delete(repairId);
      }
    };
    void current.then(cleanup, cleanup);
    return current;
  }

  private async settleQoderTurn(
    repairId: string,
    turnId: string,
    status: "failed" | "interrupted",
  ): Promise<void> {
    await this.updateSession(repairId, (session) =>
      RepairSessionSchema.parse({
        ...session,
        activeQoderTurnId:
          session.activeQoderTurnId === turnId
            ? undefined
            : session.activeQoderTurnId,
        qoderTurns: (session.qoderTurns ?? []).map((turn) =>
          turn.id === turnId && turn.status === "running"
            ? {
                ...turn,
                status,
                completedAt: timestamp(),
              }
            : turn,
        ),
        updatedAt: timestamp(),
      }),
    );
  }

  private enqueueEvent<T>(
    repairId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.eventQueues.get(repairId) ?? Promise.resolve();
    const current = previous.then(operation, operation);
    this.eventQueues.set(repairId, current);
    void current.finally(() => {
      if (this.eventQueues.get(repairId) === current) {
        this.eventQueues.delete(repairId);
      }
    });
    return current;
  }

  public appendEvent(
    repairId: string,
    type: AccessPathEvent["type"],
    payload: Record<string, unknown>,
  ): Promise<AccessPathEvent<Record<string, unknown>>> {
    return this.enqueueEvent(repairId, async () => {
      const layout = await this.existingLayout(repairId);
      const store = new NdjsonEventStore(layout.eventsPath);
      const replay = await store.readAll();
      const event = AccessPathEventSchema.parse({
        schemaVersion: SCHEMA_VERSION,
        eventId: `event-${randomUUID()}`,
        sessionId: repairId,
        sequence: (replay.events.at(-1)?.sequence ?? 0) + 1,
        timestamp: timestamp(),
        type,
        payload: redactValue(payload),
      }) as AccessPathEvent<Record<string, unknown>>;
      await store.append(event);
      return event;
    });
  }

  private async runnerEvent(
    repairId: string,
    event: RunnerEvent,
  ): Promise<void> {
    if (event.ephemeral === true && event.type !== "agent.message.delta") {
      return;
    }
    await this.appendEvent(repairId, event.type, event.payload);
  }

  public validateRepository(
    repositoryPath: string,
  ): Promise<RepositoryValidation> {
    return validateRepository(repositoryPath);
  }

  public async create(input: unknown): Promise<RepairSession> {
    if (typeof input !== "object" || input === null) {
      throw new Error("A repository and repair manifest are required.");
    }
    const repository = RepositoryConfigSchema.parse(
      (input as { repository?: unknown }).repository,
    );
    const manifest = RepairManifestSchema.parse(
      (input as { manifest?: unknown }).manifest,
    );
    const validation = await validateRepositoryConfig(repository);
    const repairId = `repair-${randomUUID()}`;
    const layout = await this.layout(repairId);
    const now = timestamp();
    const session = RepairSessionSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      id: repairId,
      state: "configuring",
      auditBundleId: manifest.auditBundleId,
      manifestId: manifest.id,
      createdAt: now,
      updatedAt: now,
      repository: {
        repositoryDisplayName: validation.repositoryDisplayName,
        baseBranch: validation.baseBranch,
        baseCommit: validation.baseCommit,
        startCommand: repository.startCommand,
        testCommands: repository.testCommands,
        previewUrl: repository.previewUrl,
        allowedPathGlobs: repository.allowedPathGlobs,
      },
      branch: "not-prepared",
      worktreeId: repairId,
    });
    await this.writeJson(layout, layout.repositoryPath, repository);
    await this.writeJson(layout, layout.manifestPath, manifest);
    await this.writeJson(layout, layout.approvalsPath, []);
    await this.writeJson(layout, layout.testsPath, []);
    await this.writeSession(layout, session);
    await this.appendEvent(repairId, "session.created", {
      state: session.state,
      repositoryDisplayName: validation.repositoryDisplayName,
    });
    return session;
  }

  public async get(repairId: string): Promise<RepairSession> {
    const layout = await this.existingLayout(repairId);
    return RepairSessionSchema.parse(await readJson(layout.sessionPath));
  }

  public async manifest(repairId: string): Promise<RepairManifest> {
    const layout = await this.existingLayout(repairId);
    return RepairManifestSchema.parse(await readJson(layout.manifestPath));
  }

  private async receipts(
    layout: RepairDirectoryLayout,
  ): Promise<CommandReceipts> {
    return (await fileExists(layout.commandsPath))
      ? readJson(layout.commandsPath)
      : {};
  }

  private receiptId(
    command: RepairCommandName,
    resourceId: string,
    key: string,
  ): string {
    return `${command}:${resourceId}:${key}`;
  }

  private async isDuplicate(
    layout: RepairDirectoryLayout,
    options: IdempotencyOptions<unknown>,
  ): Promise<boolean> {
    if (options.key === undefined) {
      return false;
    }
    const receipts = await this.receipts(layout);
    return (
      receipts[
        this.receiptId(options.command, options.resourceId, options.key)
      ] !== undefined
    );
  }

  private async recordReceipt(
    layout: RepairDirectoryLayout,
    options: IdempotencyOptions<unknown>,
  ): Promise<void> {
    if (options.key === undefined) {
      return;
    }
    const receipts = await this.receipts(layout);
    receipts[this.receiptId(options.command, options.resourceId, options.key)] =
      {
        command: options.command,
        createdAt: timestamp(),
        resourceId: options.resourceId,
      };
    await this.writeJson(layout, layout.commandsPath, receipts);
  }

  private async withTransition<T>(
    repairId: string,
    states: readonly RepairState[],
    operation: (session: RepairSession) => Promise<T>,
    idempotency?: IdempotencyOptions<T>,
  ): Promise<T> {
    if (this.transitionLocks.has(repairId)) {
      throw new RepairStateError(
        (await this.get(repairId)).state,
        "Another repair transition is active.",
      );
    }
    this.transitionLocks.add(repairId);
    try {
      const layout = await this.existingLayout(repairId);
      if (
        idempotency !== undefined &&
        (await this.isDuplicate(layout, idempotency))
      ) {
        return idempotency.duplicate();
      }
      const session = await this.get(repairId);
      if (!states.includes(session.state)) {
        throw new RepairStateError(
          session.state,
          `The repair cannot perform this action in state ${session.state}.`,
        );
      }
      const result = await operation(session);
      if (idempotency !== undefined) {
        await this.recordReceipt(layout, idempotency);
      }
      return result;
    } finally {
      this.transitionLocks.delete(repairId);
    }
  }

  public prepare(repairId: string): Promise<RepairSession> {
    return this.withTransition(repairId, ["configuring"], async (session) => {
      const layout = await this.existingLayout(repairId);
      const privateRecord = await this.readPrivate(repairId);
      await this.writeSession(layout, {
        ...session,
        state: "preparing",
        updatedAt: timestamp(),
      });
      await this.appendEvent(repairId, "phase.changed", {
        state: "preparing",
      });
      try {
        const workspace = await prepareWorkspace(privateRecord.repository, {
          artifactRoot: layout.root,
          repairId,
        });
        await this.writeJson(layout, layout.workspacePath, workspace);
        const prepared = await this.writeSession(layout, {
          ...session,
          state: "diagnosing",
          branch: workspace.branch,
          worktreeId: workspace.id,
          updatedAt: timestamp(),
        });
        await this.appendEvent(repairId, "phase.changed", {
          baseIntegrity: "unchanged",
          state: "diagnosing",
          worktreeBranch: workspace.branch,
        });
        return prepared;
      } catch (error) {
        await this.fail(repairId, error);
        throw error;
      }
    });
  }

  private async approvals(repairId: string): Promise<ApprovalRecord[]> {
    const layout = await this.existingLayout(repairId);
    return (await fileExists(layout.approvalsPath))
      ? readJson(layout.approvalsPath)
      : [];
  }

  public listApprovals(repairId: string): Promise<ApprovalRecord[]> {
    return this.approvals(repairId);
  }

  private async recordApproval(
    repairId: string,
    request: ApprovalRequest,
  ): Promise<void> {
    const layout = await this.existingLayout(repairId);
    const records = await this.approvals(repairId);
    if (records.some((record) => record.request.id === request.id)) {
      return;
    }
    records.push({
      request: ApprovalRequestSchema.parse(
        this.shuttingDown
          ? {
              ...request,
              state: "expired",
            }
          : request,
      ),
    });
    await this.writeJson(layout, layout.approvalsPath, records);
  }

  private async createApproval(
    repairId: string,
    input: Omit<
      ApprovalRequest,
      "id" | "repairSessionId" | "createdAt" | "state"
    >,
  ): Promise<ApprovalRequest> {
    const request = ApprovalRequestSchema.parse({
      ...input,
      id: `approval-${randomUUID()}`,
      repairSessionId: repairId,
      createdAt: timestamp(),
      state: "pending",
    });
    await this.recordApproval(repairId, request);
    await this.appendEvent(repairId, "tool.requested", {
      approvalId: request.id,
      kind: request.kind,
      risk: request.risk,
      targetPaths: request.targetPaths,
      title: request.title,
    });
    return request;
  }

  private async waitForApproval(
    repairId: string,
    request: ApprovalRequest,
    signal: AbortSignal,
  ): Promise<ApprovalDecision> {
    const deny = {
      decision: "deny",
      reason: "The repair turn was interrupted.",
    } satisfies ApprovalDecision;
    if (this.shuttingDown || signal.aborted) {
      await this.expireApprovals(
        repairId,
        (record) => record.request.id === request.id,
        deny.reason,
      );
      return deny;
    }
    return new Promise((resolve) => {
      let settled = false;
      const finish = (decision: ApprovalDecision) => {
        if (settled) {
          return;
        }
        settled = true;
        signal.removeEventListener("abort", abort);
        if (this.pendingApprovals.get(request.id)?.resolve === finish) {
          this.pendingApprovals.delete(request.id);
        }
        resolve(decision);
      };
      const abort = () => {
        void this.expireApprovals(
          repairId,
          (record) => record.request.id === request.id,
          deny.reason,
        ).then(
          () => finish(deny),
          () => finish(deny),
        );
      };
      this.pendingApprovals.set(request.id, { resolve: finish });
      signal.addEventListener("abort", abort, { once: true });
      if (this.shuttingDown || signal.aborted) {
        abort();
      }
    });
  }

  private async expireApprovals(
    repairId: string,
    predicate: (record: ApprovalRecord) => boolean,
    reason: string,
  ): Promise<void> {
    const layout = await this.existingLayout(repairId);
    const records = await this.approvals(repairId);
    let changed = false;
    for (const record of records) {
      if (record.request.state !== "pending" || !predicate(record)) {
        continue;
      }
      record.request = ApprovalRequestSchema.parse({
        ...record.request,
        state: "expired",
      });
      changed = true;
      const pending = this.pendingApprovals.get(record.request.id);
      if (pending !== undefined) {
        this.pendingApprovals.delete(record.request.id);
        pending.resolve({ decision: "deny", reason });
      }
    }
    if (changed) {
      await this.writeJson(layout, layout.approvalsPath, records);
    }
  }

  private async launchDiagnosis(
    repairId: string,
    command: "diagnose" | "resume",
    idempotencyKey?: string,
  ): Promise<void> {
    const privateRecord = await this.readPrivate(repairId);
    if (privateRecord.workspace === undefined) {
      throw new RepairStateError("diagnosing", "Repair workspace is missing.");
    }
    const manifest = await this.manifest(repairId);
    const existing = await this.get(repairId);
    const policy = qoderTurnPolicy({ manifest, mode: "diagnosis" });
    const turn = await this.beginQoderTurn(
      repairId,
      "diagnosis",
      policy,
      command,
      idempotencyKey,
    );
    const abortController = new AbortController();
    const signal = AbortSignal.any([
      abortController.signal,
      this.shutdownController.signal,
    ]);
    let handle: RepairSessionHandle;
    try {
      handle = await startRepairSession({
        adapter: this.qoderAdapter(),
        artifactRoot: privateRecord.workspace.artifactRoot,
        continuation:
          existing.qoderTurns?.some(
            (candidate) => candidate.mode === "diagnosis",
          ) ?? false,
        emit: (event) => this.runnerEvent(repairId, event),
        manifest,
        maxTurns: policy.maxTurns,
        mode: "diagnosis",
        model: policy.model,
        qoderSessionId: turn.qoderSessionId,
        repairSessionId: repairId,
        requestApproval: async () => ({ decision: "deny" }),
        resume: turn.resumed,
        signal,
        userMessageId: turn.userMessageId,
        worktreePath: privateRecord.workspace.worktreePath,
      });
    } catch (error) {
      await this.settleQoderTurn(repairId, turn.turnId, "failed");
      throw error;
    }
    const activeSession: ActiveQoderSession = {
      abortController,
      handle,
      interrupted: false,
      lifecycle: "running",
      mode: "diagnosis",
      turnId: turn.turnId,
      turnCompleted: false,
    };
    this.activeQoder.set(repairId, activeSession);
    const settled = handle.turn
      .then(async (result) => {
        if (activeSession.lifecycle !== "running") {
          return;
        }
        activeSession.lifecycle = "completed";
        activeSession.turnCompleted = true;
        await this.finishDiagnosisTurn(repairId, turn.turnId, result, manifest);
      })
      .catch(async (error) => {
        if (activeSession.interrupted) {
          return;
        }
        activeSession.lifecycle = "failed";
        await this.settleQoderTurn(repairId, turn.turnId, "failed");
        if (await this.startDemoFallback(repairId, "diagnosis")) {
          return;
        }
        await this.fail(repairId, error);
      })
      .finally(async () => {
        await handle.close().catch(() => undefined);
        if (this.activeQoder.get(repairId)?.handle === handle) {
          this.activeQoder.delete(repairId);
        }
      });
    activeSession.settled = settled;
    void settled;
  }

  public async diagnose(
    repairId: string,
    idempotencyKey?: string,
  ): Promise<RepairSession> {
    return this.enqueueQoderCommand(repairId, () =>
      this.diagnoseQoder(repairId, idempotencyKey),
    );
  }

  private async diagnoseQoder(
    repairId: string,
    idempotencyKey?: string,
  ): Promise<RepairSession> {
    const current = await this.get(repairId);
    const matching = this.matchingQoderTurn(
      current,
      "diagnose",
      idempotencyKey,
    );
    if (matching !== undefined) {
      if (!matching.latest) {
        return current;
      }
      const matchedTurn = matching.turn;
      if (
        !this.activeQoder.has(repairId) &&
        (matchedTurn.status !== "completed" ||
          current.state === "diagnosing") &&
        (await this.inspectPersistedQoderTurn(repairId, matchedTurn))
      ) {
        return this.get(repairId);
      }
      if (
        matchedTurn.status !== "completed" &&
        current.state === "diagnosing" &&
        !this.activeQoder.has(repairId)
      ) {
        await this.launchDiagnosis(repairId, "diagnose", idempotencyKey);
        return this.get(repairId);
      }
      return current;
    }
    return this.withTransition(
      repairId,
      ["diagnosing"],
      async (session) => {
        if (this.activeQoder.has(repairId)) {
          return session;
        }
        await this.launchDiagnosis(repairId, "diagnose", idempotencyKey);
        return this.get(repairId);
      },
      {
        command: "diagnose",
        duplicate: () => this.get(repairId),
        key: idempotencyKey,
        resourceId: repairId,
      },
    );
  }

  private async createCheckpoint(repairId: string): Promise<Checkpoint> {
    const privateRecord = await this.readPrivate(repairId);
    if (privateRecord.workspace === undefined) {
      throw new RepairStateError("editing", "Repair workspace is missing.");
    }
    const tree = await getTreeSnapshot(privateRecord.workspace.worktreePath);
    const checkpoint = CheckpointSchema.parse({
      id: `checkpoint-${randomUUID()}`,
      repairSessionId: repairId,
      createdAt: timestamp(),
      files: [],
      insertions: 0,
      deletions: 0,
      gitTreeHash: tree.treeId,
    });
    const layout = await this.existingLayout(repairId);
    await this.writeJson(layout, layout.checkpointPath, checkpoint);
    await this.updateSession(repairId, (session) =>
      RepairSessionSchema.parse({
        ...session,
        latestCheckpointId: checkpoint.id,
        updatedAt: timestamp(),
      }),
    );
    await this.appendEvent(repairId, "checkpoint.created", {
      checkpointId: checkpoint.id,
      gitTreeHash: checkpoint.gitTreeHash,
    });
    return checkpoint;
  }

  private async launchRepair(
    repairId: string,
    command: "start" | "resume",
    idempotencyKey?: string,
  ): Promise<void> {
    const privateRecord = await this.readPrivate(repairId);
    if (privateRecord.workspace === undefined) {
      throw new RepairStateError("editing", "Repair workspace is missing.");
    }
    const manifest = await this.manifest(repairId);
    const plan = await this.plan(repairId);
    if (plan === undefined) {
      throw new RepairStateError(
        "editing",
        "The approved repair plan is missing.",
      );
    }
    let existing = await this.get(repairId);
    if (existing.latestCheckpointId === undefined) {
      await this.createCheckpoint(repairId);
      existing = await this.get(repairId);
    }
    const policy = qoderTurnPolicy({
      approvedPlan: plan.text,
      manifest,
      mode: "repair",
    });
    const turn = await this.beginQoderTurn(
      repairId,
      "repair",
      policy,
      command,
      idempotencyKey,
    );
    const abortController = new AbortController();
    const signal = AbortSignal.any([
      abortController.signal,
      this.shutdownController.signal,
    ]);
    let handle: RepairSessionHandle;
    try {
      handle = await startRepairSession({
        adapter: this.qoderAdapter(),
        approvedPlan: plan.text,
        artifactRoot: privateRecord.workspace.artifactRoot,
        continuation:
          existing.qoderTurns?.some(
            (candidate) => candidate.mode === "repair",
          ) ?? false,
        emit: (event) => this.runnerEvent(repairId, event),
        manifest,
        maxTurns: policy.maxTurns,
        mode: "repair",
        model: policy.model,
        qoderSessionId: turn.qoderSessionId,
        recordApproval: (request) => this.recordApproval(repairId, request),
        repairSessionId: repairId,
        requestApproval: (request) =>
          this.waitForApproval(repairId, request, signal),
        resume: turn.resumed,
        signal,
        userMessageId: turn.userMessageId,
        worktreePath: privateRecord.workspace.worktreePath,
      });
    } catch (error) {
      await this.settleQoderTurn(repairId, turn.turnId, "failed");
      throw error;
    }
    const activeSession: ActiveQoderSession = {
      abortController,
      handle,
      interrupted: false,
      lifecycle: "running",
      mode: "repair",
      turnId: turn.turnId,
      turnCompleted: false,
    };
    this.activeQoder.set(repairId, activeSession);
    const settled = handle.turn
      .then(async (result) => {
        if (activeSession.lifecycle !== "running") {
          return;
        }
        activeSession.lifecycle = "completed";
        activeSession.turnCompleted = true;
        await this.finishRepairTurn(repairId, turn.turnId, result);
      })
      .catch(async (error) => {
        if (activeSession.interrupted) {
          return;
        }
        activeSession.lifecycle = "failed";
        await this.settleQoderTurn(repairId, turn.turnId, "failed");
        if (await this.recoverDemoRepair(repairId)) {
          return;
        }
        await this.fail(repairId, error);
      });
    activeSession.settled = settled;
    void settled;
  }

  public async startRepair(
    repairId: string,
    idempotencyKey?: string,
  ): Promise<RepairSession> {
    return this.enqueueQoderCommand(repairId, () =>
      this.startRepairQoder(repairId, idempotencyKey),
    );
  }

  private async startRepairQoder(
    repairId: string,
    idempotencyKey?: string,
  ): Promise<RepairSession> {
    const current = await this.get(repairId);
    const matching = this.matchingQoderTurn(current, "start", idempotencyKey);
    if (matching !== undefined) {
      if (!matching.latest) {
        return current;
      }
      const matchedTurn = matching.turn;
      if (
        matchedTurn.status !== "completed" &&
        !this.activeQoder.has(repairId) &&
        (await this.inspectPersistedQoderTurn(repairId, matchedTurn))
      ) {
        return this.get(repairId);
      }
      if (
        matchedTurn.status !== "completed" &&
        current.state === "editing" &&
        !this.activeQoder.has(repairId)
      ) {
        await this.launchRepair(repairId, "start", idempotencyKey);
        return this.get(repairId);
      }
      return current;
    }
    return this.withTransition(
      repairId,
      ["editing"],
      async (session) => {
        const active = this.activeQoder.get(repairId);
        if (active !== undefined && !active.turnCompleted) {
          return session;
        }
        if (active !== undefined) {
          await active.handle.close().catch(() => undefined);
          await active.handle.closed.catch(() => undefined);
          if (this.activeQoder.get(repairId)?.handle === active.handle) {
            this.activeQoder.delete(repairId);
          }
        }
        await this.launchRepair(repairId, "start", idempotencyKey);
        return this.get(repairId);
      },
      {
        command: "start",
        duplicate: () => this.get(repairId),
        key: idempotencyKey,
        resourceId: repairId,
      },
    );
  }

  public async decideApproval(
    repairId: string,
    approvalId: string,
    input: unknown,
    idempotencyKey?: string,
  ): Promise<ApprovalRecord> {
    const decision = ApprovalDecisionSchema.parse(input);
    const layout = await this.existingLayout(repairId);
    const records = await this.approvals(repairId);
    const record = records.find((item) => item.request.id === approvalId);
    if (record === undefined) {
      throw new RepairApprovalError("Approval request not found.");
    }
    const idempotency: IdempotencyOptions<ApprovalRecord> = {
      command: "approval",
      duplicate: async () => {
        const current = (await this.approvals(repairId)).find(
          (item) => item.request.id === approvalId,
        );
        if (current === undefined) {
          throw new RepairApprovalError("Approval request not found.");
        }
        return current;
      },
      key: idempotencyKey,
      resourceId: approvalId,
    };
    if (await this.isDuplicate(layout, idempotency)) {
      return idempotency.duplicate();
    }
    if (record.request.state !== "pending") {
      if (record.decision?.decision === decision.decision) {
        await this.recordReceipt(layout, idempotency);
        return record;
      }
      throw new RepairApprovalError("Approval request is no longer pending.");
    }
    if (record.request.kind === "patch" && decision.decision !== "deny") {
      const verification = (await fileExists(layout.verificationPath))
        ? await readJson<{ diffHash: string }>(layout.verificationPath)
        : undefined;
      const currentHash = diffHash(await this.diff(repairId));
      if (verification?.diffHash !== currentHash) {
        await this.stopPreview(repairId);
        record.request = ApprovalRequestSchema.parse({
          ...record.request,
          state: "expired",
        });
        await this.writeJson(layout, layout.approvalsPath, records);
        await this.writeJson(layout, layout.testsPath, []);
        await rm(layout.verificationPath, { force: true });
        await rm(layout.comparisonPath, { force: true });
        await this.updateSession(repairId, (session) =>
          RepairSessionSchema.parse({
            ...session,
            state: "editing",
            updatedAt: timestamp(),
          }),
        );
        await this.appendEvent(repairId, "phase.changed", {
          reason: "verified-patch-changed",
          state: "editing",
        });
        throw new RepairApprovalError(
          "The repair patch changed after verification and must be verified again.",
        );
      }
    }
    record.request = ApprovalRequestSchema.parse({
      ...record.request,
      state: decision.decision === "deny" ? "denied" : "approved",
    });
    record.decision = decision;
    record.decidedAt = timestamp();
    await this.writeJson(layout, layout.approvalsPath, records);
    if (record.request.kind !== "tool") {
      await this.appendEvent(
        repairId,
        decision.decision === "deny" ? "tool.denied" : "tool.approved",
        {
          approvalId,
          decision: decision.decision,
          kind: record.request.kind,
          targetPaths: record.request.targetPaths,
        },
      );
    }

    if (record.request.kind === "plan") {
      await this.updateSession(repairId, (session) =>
        RepairSessionSchema.parse({
          ...session,
          state: decision.decision === "deny" ? "rejected" : "editing",
          updatedAt: timestamp(),
        }),
      );
      await this.appendEvent(repairId, "phase.changed", {
        state: decision.decision === "deny" ? "rejected" : "editing",
      });
    } else if (record.request.kind === "patch") {
      await this.stopPreview(repairId);
      const privateRecord = await this.readPrivate(repairId);
      if (privateRecord.workspace !== undefined) {
        await assertBaseIntegrity(privateRecord.workspace);
      }
      const decisionState =
        decision.decision === "deny" ? "rejected" : "approved";
      await this.updateSession(repairId, (session) =>
        RepairSessionSchema.parse({
          ...session,
          state: decisionState,
          updatedAt: timestamp(),
        }),
      );
      await this.appendEvent(repairId, "phase.changed", {
        state: decisionState,
      });
      if (decision.decision !== "deny") {
        await this.updateSession(repairId, (session) =>
          RepairSessionSchema.parse({
            ...session,
            state: "completed",
            updatedAt: timestamp(),
          }),
        );
      }
      await this.appendEvent(
        repairId,
        decision.decision === "deny" ? "session.failed" : "session.completed",
        {
          state: decision.decision === "deny" ? "rejected" : "completed",
        },
      );
    }

    const pending = this.pendingApprovals.get(approvalId);
    if (pending !== undefined) {
      this.pendingApprovals.delete(approvalId);
      pending.resolve(decision);
    }
    await this.recordReceipt(layout, idempotency);
    return record;
  }

  public async diff(repairId: string): Promise<GitDiffSnapshot> {
    const privateRecord = await this.readPrivate(repairId);
    if (privateRecord.workspace === undefined) {
      throw new RepairStateError(
        (await this.get(repairId)).state,
        "Repair workspace is not prepared.",
      );
    }
    const diff = await getDiff(privateRecord.workspace);
    return {
      ...diff,
      patch: redactText(diff.patch),
      stat: redactText(diff.stat),
    };
  }

  public async worktreePath(repairId: string): Promise<string> {
    const privateRecord = await this.readPrivate(repairId);
    if (privateRecord.workspace === undefined) {
      throw new RepairStateError(
        (await this.get(repairId)).state,
        "Repair workspace is not prepared.",
      );
    }
    return privateRecord.workspace.worktreePath;
  }

  private async waitForActiveRepairTurn(repairId: string): Promise<void> {
    const active = this.activeQoder.get(repairId);
    if (
      active?.mode !== "repair" ||
      active.turnCompleted ||
      active.settled === undefined
    ) {
      return;
    }
    const pendingToolApproval = (await this.approvals(repairId)).some(
      (record) =>
        record.request.kind === "tool" && record.request.state === "pending",
    );
    if (pendingToolApproval) {
      return;
    }
    await Promise.race([
      active.settled,
      new Promise<void>((resolve) =>
        setTimeout(resolve, REPAIR_TURN_SETTLE_GRACE_MS),
      ),
    ]);
  }

  public async verify(
    repairId: string,
    idempotencyKey?: string,
  ): Promise<RepairSession> {
    await this.waitForActiveRepairTurn(repairId);
    return this.withTransition(
      repairId,
      ["editing"],
      async (session) => {
        const active = this.activeQoder.get(repairId);
        const pendingToolApproval = (await this.approvals(repairId)).some(
          (record) =>
            record.request.kind === "tool" &&
            record.request.state === "pending",
        );
        if (
          active?.mode === "repair" &&
          (!active.turnCompleted || pendingToolApproval)
        ) {
          throw new RepairStateError(
            session.state,
            "The active Qoder turn must finish before verification.",
          );
        }
        const privateRecord = await this.readPrivate(repairId);
        if (privateRecord.workspace === undefined) {
          throw new RepairStateError(
            session.state,
            "Repair workspace is missing.",
          );
        }
        const manifest = await this.manifest(repairId);
        if (manifest.verification.commands.length === 0) {
          throw new RepairStateError(
            session.state,
            "At least one configured verification command is required.",
          );
        }
        const verificationController = new AbortController();
        this.activeVerifications.set(repairId, verificationController);
        const supervisor =
          this.config.commandRunner === undefined
            ? await createProcessSupervisor({
                worktreePath: privateRecord.workspace.worktreePath,
                commands: manifest.verification.commands,
              })
            : undefined;
        const runner: RepairCommandRunner =
          this.config.commandRunner ??
          (async (command, _worktreePath, signal) => {
            const result = await supervisor!.run(command, { signal });
            return {
              state:
                result.terminationReason === "timeout"
                  ? "timed-out"
                  : result.terminationReason === "cancelled"
                    ? "cancelled"
                    : result.exitCode === 0
                      ? "passed"
                      : "failed",
              ...(result.exitCode === null
                ? {}
                : { exitCode: result.exitCode }),
              durationMs: result.durationMs,
              output: `${result.stdout}${result.stderr}`,
            };
          });
        const layout = await this.existingLayout(repairId);
        await this.writeSession(layout, {
          ...session,
          state: "verifying",
          updatedAt: timestamp(),
        });
        await this.appendEvent(repairId, "verification.started", {});
        try {
          const results: TestResult[] = [];
          for (const command of manifest.verification.commands) {
            if (verificationController.signal.aborted) {
              break;
            }
            await this.appendEvent(repairId, "test.started", {
              commandId: command.id,
              label: command.label,
            });
            const result = await runner(
              command,
              privateRecord.workspace.worktreePath,
              verificationController.signal,
            );
            const test = TestResultSchema.parse({
              commandId: command.id,
              state: result.state,
              ...(result.exitCode === undefined
                ? {}
                : { exitCode: result.exitCode }),
              durationMs: result.durationMs,
              outputArtifactId: `test-output-${command.id}`,
            });
            results.push(test);
            await this.appendEvent(repairId, "test.output", {
              commandId: command.id,
              output: redactText(result.output),
            });
            await this.appendEvent(repairId, "test.completed", test);
          }
          await this.writeJson(layout, layout.testsPath, results);
          const currentSession = await this.get(repairId);
          if (currentSession.state === "cancelled") {
            await this.appendEvent(repairId, "verification.completed", {
              passed: false,
              testCount: results.length,
            });
            return currentSession;
          }
          const verifiedDiff = await this.diff(repairId);
          const passed =
            results.length === manifest.verification.commands.length &&
            results.every((result) => result.state === "passed");
          if (!passed) {
            await rm(layout.verificationPath, { force: true });
            await rm(layout.comparisonPath, { force: true });
            const updated = await this.writeSession(layout, {
              ...session,
              state: "editing",
              updatedAt: timestamp(),
            });
            await this.appendEvent(repairId, "verification.completed", {
              passed: false,
              testCount: results.length,
            });
            return updated;
          }
          await this.writeJson(layout, layout.verificationPath, {
            diffHash: diffHash(verifiedDiff),
          });
          await rm(layout.comparisonPath, { force: true });
          return this.completeVerification(
            repairId,
            session,
            layout,
            {
              repository: privateRecord.repository,
              workspace: privateRecord.workspace,
            },
            manifest,
            results,
            verifiedDiff,
          );
        } catch (error) {
          await this.stopPreview(repairId);
          if ((await this.get(repairId)).state !== "cancelled") {
            await this.fail(repairId, error);
          }
          throw error;
        } finally {
          if (
            this.activeVerifications.get(repairId) === verificationController
          ) {
            this.activeVerifications.delete(repairId);
          }
        }
      },
      {
        command: "verify",
        duplicate: () => this.get(repairId),
        key: idempotencyKey,
        resourceId: repairId,
      },
    );
  }

  private async stopPreview(repairId: string): Promise<void> {
    const active = this.activePreviews.get(repairId);
    if (active === undefined) {
      return;
    }
    this.activePreviews.delete(repairId);
    await active.process.cancel().catch(() => undefined);
    await active.process.result.catch(() => undefined);
  }

  private async startPreview(
    repairId: string,
    repository: RepositoryConfig,
    workspace: PreparedWorkspace,
  ): Promise<ActivePreview> {
    const existing = this.activePreviews.get(repairId);
    if (existing !== undefined) {
      return existing;
    }
    const preview = new URL(repository.previewUrl);
    const port = preview.port || (preview.protocol === "https:" ? "443" : "80");
    const supervisor = await createProcessSupervisor({
      worktreePath: workspace.worktreePath,
      commands: [repository.startCommand],
      environment: {
        DEMO_AID_APP_PORT: port,
        PORT: port,
      },
      allowedEnvironmentKeys: ["DEMO_AID_APP_PORT", "PORT"],
    });
    const process = await supervisor.start(repository.startCommand, {
      onOutput: (chunk) => {
        void this.appendEvent(repairId, "test.output", {
          commandId: repository.startCommand.id,
          output: redactText(chunk.text),
          stream: chunk.stream,
        });
      },
    });
    const active = { process, url: preview.href };
    this.activePreviews.set(repairId, active);
    void process.result.then(
      () => {
        if (this.activePreviews.get(repairId)?.process === process) {
          this.activePreviews.delete(repairId);
        }
      },
      () => {
        if (this.activePreviews.get(repairId)?.process === process) {
          this.activePreviews.delete(repairId);
        }
      },
    );
    await this.appendEvent(repairId, "tool.started", {
      kind: "preview",
      commandId: repository.startCommand.id,
      pid: process.pid,
    });
    try {
      await waitForPreview(active.url);
    } catch (error) {
      await this.stopPreview(repairId);
      throw error;
    }
    await this.appendEvent(repairId, "tool.completed", {
      kind: "preview",
      commandId: repository.startCommand.id,
      previewUrl: active.url,
    });
    return active;
  }

  public async verification(
    repairId: string,
  ): Promise<VerificationRun | undefined> {
    const layout = await this.existingLayout(repairId);
    return (await fileExists(layout.comparisonPath))
      ? VerificationRunSchema.parse(await readJson(layout.comparisonPath))
      : undefined;
  }

  public async completeSandboxVerification(
    repairId: string,
    input: SandboxVerificationInput,
    idempotencyKey?: string,
  ): Promise<RepairSession> {
    await this.waitForActiveRepairTurn(repairId);
    return this.withTransition(
      repairId,
      ["editing"],
      async (session) => {
        const active = this.activeQoder.get(repairId);
        const pendingToolApproval = (await this.approvals(repairId)).some(
          (record) =>
            record.request.kind === "tool" &&
            record.request.state === "pending",
        );
        if (
          active?.mode === "repair" &&
          (!active.turnCompleted || pendingToolApproval)
        ) {
          throw new RepairStateError(
            session.state,
            "The active Qoder turn must finish before verification.",
          );
        }
        const manifest = await this.manifest(repairId);
        const layout = await this.existingLayout(repairId);
        const verifiedDiff = await this.diff(repairId);
        const tests = input.results.map((result) =>
          TestResultSchema.parse({
            commandId: result.commandId,
            state: result.state,
            ...(result.exitCode === undefined
              ? {}
              : { exitCode: result.exitCode }),
            durationMs: result.durationMs,
            outputArtifactId: `sandbox-output-${result.commandId}`,
          }),
        );
        const commandIds = new Set(tests.map((result) => result.commandId));
        const requiredCommandsPresent = manifest.verification.commands.every(
          (command) => commandIds.has(command.id),
        );
        const selectedFindingsResolved = manifest.findingIds.every(
          (findingId) =>
            input.comparison.find((entry) => entry.findingId === findingId)
              ?.afterState === "resolved",
        );
        const noRegressions = input.comparison.every(
          (entry) => entry.afterState !== "regressed",
        );
        const passed =
          verifiedDiff.changedFiles.length > 0 &&
          requiredCommandsPresent &&
          tests.every((result) => result.state === "passed") &&
          input.replayPassed &&
          noRegressions &&
          selectedFindingsResolved;
        const comparison = input.comparison;
        const run = VerificationRunSchema.parse({
          id: `verification-${repairId}`,
          repairSessionId: repairId,
          startedAt: timestamp(),
          completedAt: timestamp(),
          previewUrl: input.previewUrl,
          tests,
          comparison,
        });
        await this.writeJson(layout, layout.testsPath, tests);
        await this.writeJson(layout, layout.verificationPath, {
          diffHash: diffHash(verifiedDiff),
        });
        await this.writeJson(layout, layout.comparisonPath, run);
        const updated = await this.writeSession(layout, {
          ...session,
          state: passed ? "awaiting-patch-approval" : "editing",
          updatedAt: timestamp(),
        });
        await this.appendEvent(repairId, "verification.completed", {
          comparison,
          kind: "sandbox-task-replay",
          passed,
          testCount: tests.length,
        });
        if (passed) {
          await this.createApproval(repairId, {
            kind: "patch",
            title: "Approve the repair patch",
            consequence:
              "Accepts the displayed worktree diff after Docker-isolated checks and browser replay.",
            risk: "write",
            targetPaths: verifiedDiff.changedFiles,
          });
        }
        return updated;
      },
      {
        command: "verify",
        duplicate: () => this.get(repairId),
        key: idempotencyKey,
        resourceId: repairId,
      },
    );
  }

  private async completeVerification(
    repairId: string,
    session: RepairSession,
    layout: RepairDirectoryLayout,
    privateRecord: PrivateRepairRecord & { workspace: PreparedWorkspace },
    manifest: RepairManifest,
    tests: TestResult[],
    verifiedDiff: GitDiffSnapshot,
  ): Promise<RepairSession> {
    const startedAt = timestamp();
    const preview = await this.startPreview(
      repairId,
      privateRecord.repository,
      privateRecord.workspace,
    );
    const before = await loadAuditBundleById(
      layout.root,
      manifest.auditBundleId,
    );
    if (before.task.id !== manifest.verification.taskContract.id) {
      throw new RepairStateError(
        session.state,
        "The repair manifest does not reference the source audit task contract.",
      );
    }
    const replayTask = taskForPreview(
      manifest.verification.taskContract,
      preview.url,
    );
    const auditRunner = this.config.replayAuditRunner ?? runPersistedAudit;
    const after = await auditRunner(replayTask, {
      artifactRoot: layout.root,
      editableRepositoryRoot: this.config.editableRepositoryRoot,
      auditSessionId: `audit-after-${repairId}`,
      eventWriter: async (event) =>
        this.appendEvent(repairId, event.type, event.payload),
    });
    const comparison = compareReplayEvidence(
      before,
      after.bundle,
      manifest.findingIds,
    );
    const run = VerificationRunSchema.parse({
      id: `verification-${repairId}`,
      repairSessionId: repairId,
      startedAt,
      completedAt: timestamp(),
      previewUrl: preview.url,
      tests,
      auditBundleId: after.bundle.id,
      comparison,
    });
    await this.writeJson(layout, layout.comparisonPath, run);

    const patchStillMatches =
      diffHash(verifiedDiff) === diffHash(await this.diff(repairId));
    const selectedResolved = manifest.findingIds.every(
      (findingId) =>
        comparison.find((item) => item.findingId === findingId)?.afterState ===
        "resolved",
    );
    const passed =
      replayOutcomeSupportsFindingVerification(after.bundle.outcome) &&
      patchStillMatches &&
      selectedResolved;
    const updated = await this.writeSession(layout, {
      ...session,
      state: passed ? "awaiting-patch-approval" : "editing",
      updatedAt: timestamp(),
    });
    await this.appendEvent(repairId, "verification.completed", {
      auditBundleId: after.bundle.id,
      comparison,
      kind: "task-replay",
      passed,
      testCount: tests.length,
    });
    if (passed) {
      await this.createApproval(repairId, {
        kind: "patch",
        title: "Approve the repair patch",
        consequence:
          "Accepts the displayed worktree diff after configured checks and browser task replay.",
        risk: "write",
        targetPaths: verifiedDiff.changedFiles,
      });
    }
    return updated;
  }

  public async rewindPreview(
    repairId: string,
    idempotencyKey?: string,
  ): Promise<{
    approval: ApprovalRequest;
    preview: RewindPreview;
  }> {
    const session = await this.get(repairId);
    if (session.latestCheckpointId === undefined) {
      throw new RepairStateError(
        session.state,
        "The active repair checkpoint is unavailable.",
      );
    }
    const layout = await this.existingLayout(repairId);
    const idempotency: IdempotencyOptions<{
      approval: ApprovalRequest;
      preview: RewindPreview;
    }> = {
      command: "rewind-preview",
      duplicate: async () => {
        const stored = await readJson<{
          approvalId: string;
          preview: RewindPreview;
        }>(layout.rewindPath);
        const approval = (await this.approvals(repairId)).find(
          (record) => record.request.id === stored.approvalId,
        )?.request;
        if (approval === undefined) {
          throw new RepairApprovalError("Rewind approval request not found.");
        }
        return {
          approval,
          preview: RewindPreviewSchema.parse(stored.preview),
        };
      },
      key: idempotencyKey,
      resourceId: session.latestCheckpointId,
    };
    if (await this.isDuplicate(layout, idempotency)) {
      return idempotency.duplicate();
    }
    const active = this.activeQoder.get(repairId);
    if (active?.mode !== "repair") {
      throw new RepairStateError(
        session.state,
        "The active repair checkpoint is unavailable.",
      );
    }
    const rewind = await this.rewindQoderFiles(repairId, active, true);
    if (!rewind.canRewind) {
      throw new RepairStateError(
        session.state,
        "No file changes can be rewound.",
      );
    }
    const tests = await this.tests(repairId);
    const preview = RewindPreviewSchema.parse({
      checkpointId: session.latestCheckpointId,
      affectedFiles: rewind.filesChanged ?? [],
      insertionsRemoved: rewind.insertions ?? 0,
      deletionsRestored: rewind.deletions ?? 0,
      staleVerificationIds: tests.map(
        (result) => `verification-${result.commandId}`,
      ),
      nonFileSideEffectWarning:
        "Rewind restores checkpointed files only; command side effects are not reversed.",
    });
    const approval = await this.createApproval(repairId, {
      kind: "rewind",
      title: "Rewind repair files",
      consequence: preview.nonFileSideEffectWarning,
      risk: "destructive",
      targetPaths: preview.affectedFiles,
    });
    await this.writeJson(layout, layout.rewindPath, {
      approvalId: approval.id,
      preview,
    });
    await this.appendEvent(repairId, "rewind.previewed", {
      approvalId: approval.id,
      ...preview,
    });
    await this.recordReceipt(layout, idempotency);
    return { approval, preview };
  }

  public async applyRewind(
    repairId: string,
    approvalId: string,
    idempotencyKey?: string,
  ): Promise<GitDiffSnapshot> {
    const layout = await this.existingLayout(repairId);
    const session = await this.get(repairId);
    if (session.latestCheckpointId === undefined) {
      throw new RepairStateError(
        session.state,
        "The active repair checkpoint is unavailable.",
      );
    }
    const idempotency: IdempotencyOptions<GitDiffSnapshot> = {
      command: "rewind",
      duplicate: () => this.diff(repairId),
      key: idempotencyKey,
      resourceId: session.latestCheckpointId,
    };
    if (await this.isDuplicate(layout, idempotency)) {
      return idempotency.duplicate();
    }
    const records = await this.approvals(repairId);
    const approval = records.find((record) => record.request.id === approvalId);
    if (
      approval?.request.kind !== "rewind" ||
      approval.request.state !== "approved"
    ) {
      throw new RepairApprovalError("An approved rewind request is required.");
    }
    const active = this.activeQoder.get(repairId);
    if (active?.mode !== "repair") {
      throw new RepairStateError(
        (await this.get(repairId)).state,
        "The active repair checkpoint is unavailable.",
      );
    }
    await this.stopPreview(repairId);
    const result = await this.rewindQoderFiles(repairId, active, false);
    const staleVerificationIds = (await this.tests(repairId)).map(
      (test) => `verification-${test.commandId}`,
    );
    await this.expireApprovals(
      repairId,
      (record) => record.request.kind === "patch",
      "The verified patch changed after rewind.",
    );
    await this.writeJson(layout, layout.testsPath, []);
    await rm(layout.verificationPath, { force: true });
    await rm(layout.comparisonPath, { force: true });
    await this.appendEvent(repairId, "rewind.completed", {
      filesChanged: result.filesChanged ?? [],
      staleVerificationIds,
    });
    await this.updateSession(repairId, (session) =>
      RepairSessionSchema.parse({
        ...session,
        state: "editing",
        updatedAt: timestamp(),
      }),
    );
    const diff = await this.diff(repairId);
    await this.recordReceipt(layout, idempotency);
    return diff;
  }

  public async tests(repairId: string): Promise<TestResult[]> {
    const layout = await this.existingLayout(repairId);
    const values = (await fileExists(layout.testsPath))
      ? ((await readJson(layout.testsPath)) as unknown[])
      : [];
    return values.map((value) => TestResultSchema.parse(value));
  }

  public async plan(
    repairId: string,
  ): Promise<{ text: string; qoderSessionId: string } | undefined> {
    const layout = await this.existingLayout(repairId);
    return (await fileExists(layout.planPath))
      ? readJson(layout.planPath)
      : undefined;
  }

  public async baseIntegrity(
    repairId: string,
  ): Promise<{ unchanged: boolean }> {
    const privateRecord = await this.readPrivate(repairId);
    if (privateRecord.workspace === undefined) {
      return { unchanged: true };
    }
    const current = await captureBaseIntegrity(
      privateRecord.workspace.repositoryRoot,
    );
    const expected = privateRecord.workspace.baseIntegrity;
    return {
      unchanged:
        current.branch === expected.branch &&
        current.commit === expected.commit &&
        current.treeId === expected.treeId &&
        current.status === expected.status,
    };
  }

  private async rewindQoderFiles(
    repairId: string,
    active: ActiveQoderSession,
    dryRun: boolean,
  ): Promise<{
    canRewind: boolean;
    filesChanged: string[];
    insertions: number;
    deletions: number;
  }> {
    const session = await this.get(repairId);
    const messageIds = [
      ...new Set(
        (session.qoderTurns ?? [])
          .filter(
            (turn) =>
              turn.mode === "repair" &&
              (turn.status === "completed" ||
                turn.status === "interrupted" ||
                turn.status === "failed"),
          )
          .map((turn) => turn.userMessageId)
          .reverse(),
      ),
    ];
    if (messageIds.length === 0) {
      const result = await active.handle.rewindFiles({ dryRun });
      return {
        canRewind: result.canRewind,
        filesChanged: result.filesChanged ?? [],
        insertions: result.insertions ?? 0,
        deletions: result.deletions ?? 0,
      };
    }
    const files = new Set<string>();
    let insertions = 0;
    let deletions = 0;
    for (const userMessageId of messageIds) {
      const result = await active.handle.rewindFiles({
        dryRun,
        userMessageId,
      });
      for (const path of result.filesChanged ?? []) {
        files.add(path);
      }
      insertions += result.insertions ?? 0;
      deletions += result.deletions ?? 0;
    }
    return {
      canRewind: files.size > 0,
      filesChanged: [...files].sort(),
      insertions,
      deletions,
    };
  }

  public async interrupt(
    repairId: string,
    idempotencyKey?: string,
  ): Promise<RepairSession> {
    const layout = await this.existingLayout(repairId);
    const idempotency: IdempotencyOptions<RepairSession> = {
      command: "pause",
      duplicate: () => this.get(repairId),
      key: idempotencyKey,
      resourceId: repairId,
    };
    if (await this.isDuplicate(layout, idempotency)) {
      return idempotency.duplicate();
    }
    const active = this.activeQoder.get(repairId);
    const session = await this.get(repairId);
    if (active === undefined) {
      await this.recordReceipt(layout, idempotency);
      return session;
    }
    if (active.lifecycle !== "running") {
      await this.recordReceipt(layout, idempotency);
      return session;
    }
    active.lifecycle = "interrupted";
    active.interrupted = true;
    active.abortController.abort();
    await this.settleQoderTurn(repairId, active.turnId, "interrupted");
    await active.handle.interrupt();
    await this.expireApprovals(
      repairId,
      (record) => record.request.kind === "tool",
      "The repair turn was paused.",
    );
    await active.handle.close().catch(() => undefined);
    await active.handle.closed.catch(() => undefined);
    await active.settled?.catch(() => undefined);
    if (this.activeQoder.get(repairId)?.handle === active.handle) {
      this.activeQoder.delete(repairId);
    }
    this.activeVerifications.get(repairId)?.abort();
    const paused = await this.updateSession(repairId, (current) =>
      RepairSessionSchema.parse({
        ...current,
        state: "paused",
        updatedAt: timestamp(),
      }),
    );
    await this.appendEvent(repairId, "phase.changed", { state: "paused" });
    await this.recordReceipt(layout, idempotency);
    return paused;
  }

  public resume(
    repairId: string,
    idempotencyKey?: string,
  ): Promise<RepairSession> {
    return this.enqueueQoderCommand(repairId, () =>
      this.resumeQoder(repairId, idempotencyKey),
    );
  }

  private async resumeQoder(
    repairId: string,
    idempotencyKey?: string,
  ): Promise<RepairSession> {
    const current = await this.get(repairId);
    const matching = this.matchingQoderTurn(current, "resume", idempotencyKey);
    if (matching !== undefined) {
      if (!matching.latest) {
        return current;
      }
      const matchedTurn = matching.turn;
      if (
        matchedTurn.status !== "completed" &&
        !this.activeQoder.has(repairId) &&
        (await this.inspectPersistedQoderTurn(repairId, matchedTurn))
      ) {
        return this.get(repairId);
      }
      if (
        matchedTurn.status !== "completed" &&
        (current.state === "diagnosing" || current.state === "editing") &&
        !this.activeQoder.has(repairId)
      ) {
        if (current.state === "diagnosing") {
          await this.launchDiagnosis(repairId, "resume", idempotencyKey);
        } else {
          await this.launchRepair(repairId, "resume", idempotencyKey);
        }
        return this.get(repairId);
      }
      return current;
    }
    return this.withTransition(
      repairId,
      ["paused"],
      async () => {
        const mode =
          (await this.plan(repairId)) === undefined ? "diagnosis" : "repair";
        await this.updateSession(repairId, (current) =>
          RepairSessionSchema.parse({
            ...current,
            state: mode === "diagnosis" ? "diagnosing" : "editing",
            updatedAt: timestamp(),
          }),
        );
        await this.appendEvent(repairId, "session.resumed", { mode });
        if (!this.activeQoder.has(repairId)) {
          if (mode === "diagnosis") {
            await this.launchDiagnosis(repairId, "resume", idempotencyKey);
          } else {
            await this.launchRepair(repairId, "resume", idempotencyKey);
          }
        }
        return this.get(repairId);
      },
      {
        command: "resume",
        duplicate: () => this.get(repairId),
        key: idempotencyKey,
        resourceId: repairId,
      },
    );
  }

  public async cancel(
    repairId: string,
    idempotencyKey?: string,
  ): Promise<RepairSession> {
    const layout = await this.existingLayout(repairId);
    const idempotency: IdempotencyOptions<RepairSession> = {
      command: "cancel",
      duplicate: () => this.get(repairId),
      key: idempotencyKey,
      resourceId: repairId,
    };
    if (await this.isDuplicate(layout, idempotency)) {
      return idempotency.duplicate();
    }
    const session = await this.get(repairId);
    if (isTerminal(session.state)) {
      await this.recordReceipt(layout, idempotency);
      return session;
    }
    const cancelled = await this.updateSession(repairId, (current) =>
      RepairSessionSchema.parse({
        ...current,
        state: "cancelled",
        updatedAt: timestamp(),
      }),
    );
    this.activeVerifications.get(repairId)?.abort();
    await this.stopPreview(repairId);
    const active = this.activeQoder.get(repairId);
    if (active !== undefined) {
      active.lifecycle = "interrupted";
      active.interrupted = true;
      active.abortController.abort();
      await this.settleQoderTurn(repairId, active.turnId, "interrupted");
      await active.handle.interrupt().catch(() => undefined);
      await active.handle.close().catch(() => undefined);
      await active.handle.closed.catch(() => undefined);
      await active.settled?.catch(() => undefined);
      this.activeQoder.delete(repairId);
    }
    await this.expireApprovals(
      repairId,
      () => true,
      "Repair session cancelled.",
    );
    await this.appendEvent(repairId, "session.cancelled", {});
    await this.recordReceipt(layout, idempotency);
    return cancelled;
  }

  private async repairIds(): Promise<string[]> {
    const root = await this.artifactRoot();
    const repairsRoot = resolveSafeRelativePath(root, "repairs");
    if (!(await fileExists(repairsRoot))) {
      return [];
    }
    return (await readdir(repairsRoot, { withFileTypes: true }))
      .filter(
        (entry) => entry.isDirectory() && entry.name.startsWith("repair-"),
      )
      .map((entry) => entry.name);
  }

  public async repairIdForApproval(approvalId: string): Promise<string> {
    for (const repairId of await this.repairIds()) {
      const records = await this.approvals(repairId).catch(() => []);
      if (records.some((record) => record.request.id === approvalId)) {
        return repairId;
      }
    }
    throw new RepairApprovalError("Approval request not found.");
  }

  public async repairIdForCheckpoint(checkpointId: string): Promise<string> {
    for (const repairId of await this.repairIds()) {
      const layout = await this.existingLayout(repairId);
      if (!(await fileExists(layout.checkpointPath))) {
        continue;
      }
      const checkpoint = CheckpointSchema.parse(
        await readJson(layout.checkpointPath),
      );
      if (checkpoint.id === checkpointId) {
        return repairId;
      }
    }
    throw new RepairNotFoundError("Repair checkpoint not found.");
  }

  public async rewindPreviewForCheckpoint(
    checkpointId: string,
    idempotencyKey?: string,
  ): Promise<{ approval: ApprovalRequest; preview: RewindPreview }> {
    const repairId = await this.repairIdForCheckpoint(checkpointId);
    const session = await this.get(repairId);
    if (session.latestCheckpointId !== checkpointId) {
      throw new RepairStateError(
        session.state,
        "The requested checkpoint is not active.",
      );
    }
    return this.rewindPreview(repairId, idempotencyKey);
  }

  public async applyRewindForCheckpoint(
    checkpointId: string,
    approvalId: string,
    idempotencyKey?: string,
  ): Promise<GitDiffSnapshot> {
    const repairId = await this.repairIdForCheckpoint(checkpointId);
    const session = await this.get(repairId);
    if (session.latestCheckpointId !== checkpointId) {
      throw new RepairStateError(
        session.state,
        "The requested checkpoint is not active.",
      );
    }
    return this.applyRewind(repairId, approvalId, idempotencyKey);
  }

  public async shutdown(): Promise<void> {
    this.shuttingDown = true;
    this.shutdownController.abort();
    for (const verification of this.activeVerifications.values()) {
      verification.abort();
    }
    this.activeVerifications.clear();
    const previews = [...this.activePreviews.entries()];
    this.activePreviews.clear();
    const active = [...this.activeQoder.entries()];
    this.activeQoder.clear();
    await Promise.all([
      ...previews.map(async ([, preview]) => {
        await Promise.all([
          waitAtMost(
            Promise.resolve().then(() => preview.process.cancel()),
            SHUTDOWN_OPERATION_TIMEOUT_MS,
          ),
          waitAtMost(preview.process.result, SHUTDOWN_OPERATION_TIMEOUT_MS),
        ]);
      }),
      ...active.map(async ([repairId, session]) => {
        session.lifecycle = "interrupted";
        session.interrupted = true;
        session.abortController.abort();
        await Promise.all([
          waitAtMost(
            this.settleQoderTurn(repairId, session.turnId, "interrupted"),
            SHUTDOWN_OPERATION_TIMEOUT_MS,
          ),
          waitAtMost(
            this.expireApprovals(repairId, () => true, "Companion shutdown."),
            SHUTDOWN_OPERATION_TIMEOUT_MS,
          ),
          waitAtMost(
            Promise.resolve().then(() => session.handle.interrupt()),
            SHUTDOWN_OPERATION_TIMEOUT_MS,
          ),
          waitAtMost(
            Promise.resolve().then(() => session.handle.close()),
            SHUTDOWN_OPERATION_TIMEOUT_MS,
          ),
        ]);
      }),
    ]);
  }

  public async replay(
    repairId: string,
    cursor?: string,
  ): Promise<AccessPathEvent[]> {
    const layout = await this.existingLayout(repairId);
    const all = await new NdjsonEventStore(layout.eventsPath).readAll();
    if (!cursor) {
      return all.events;
    }
    const numeric = Number(cursor);
    const afterSequence = Number.isInteger(numeric)
      ? numeric
      : (all.events.find((event) => event.eventId === cursor)?.sequence ?? -1);
    return all.events.filter((event) => event.sequence > afterSequence);
  }

  public async report(
    repairId: string,
    format: "html" | "json" | "markdown",
  ): Promise<{ content: string; contentType: string; filename: string }> {
    const session = await this.get(repairId);
    const manifest = await this.manifest(repairId);
    const verification = await this.verification(repairId);
    const before = await loadAuditBundleById(
      await this.artifactRoot(),
      manifest.auditBundleId,
    ).catch(() => undefined);
    const after =
      verification?.auditBundleId === undefined
        ? undefined
        : await loadAuditBundleById(
            await this.artifactRoot(),
            verification.auditBundleId,
          ).catch(() => undefined);
    const report = redactValue({
      schemaVersion: SCHEMA_VERSION,
      repair: session,
      manifest,
      plan: await this.plan(repairId),
      approvals: await this.approvals(repairId),
      tests: await this.tests(repairId),
      verification,
      beforeAudit: before,
      afterAudit: after,
      diff: await this.diff(repairId),
      baseIntegrity: await this.baseIntegrity(repairId),
    }) as {
      afterAudit?: AuditBundle;
      baseIntegrity: { unchanged: boolean };
      beforeAudit?: AuditBundle;
      diff: GitDiffSnapshot;
      plan?: { text?: string };
      verification?: VerificationRun;
    };
    if (format === "json") {
      return {
        content: `${JSON.stringify(report, null, 2)}\n`,
        contentType: "application/json; charset=utf-8",
        filename: "repair-report.json",
      };
    }
    const comparison = report.verification?.comparison ?? [];
    const comparisonMarkdown =
      comparison.length === 0
        ? "No browser replay comparison recorded."
        : comparison
            .map(
              (item) =>
                `- ${item.findingId}: ${item.afterState} - ${item.explanation}`,
            )
            .join("\n");
    const content = `# AccessPath Repair Evidence

- Repair: ${session.id}
- State: ${session.state}
- Repository: ${session.repository.repositoryDisplayName}
- Base commit: ${session.repository.baseCommit}
- Worktree branch: ${session.branch}
- Base checkout unchanged: ${report.baseIntegrity.unchanged ? "yes" : "no"}
- Before audit bundle: ${report.beforeAudit?.id ?? "Unavailable"}
- After audit bundle: ${report.afterAudit?.id ?? "Not recorded"}

## Plan

${report.plan?.text ?? "No plan recorded."}

## Changed files

${report.diff.changedFiles.map((path) => `- ${path}`).join("\n") || "- None"}

## Before and after

${comparisonMarkdown}

## Verification

${report.verification?.tests.map((test) => `- ${test.commandId}: ${test.state} (${test.durationMs} ms)`).join("\n") || "- No configured checks recorded."}

## Limitations

${[...(report.beforeAudit?.limitations ?? []), ...(report.afterAudit?.limitations ?? [])].map((limitation) => `- ${limitation}`).join("\n") || "- No additional limitations recorded."}
`;
    if (format === "markdown") {
      return {
        content: redactText(content),
        contentType: "text/markdown; charset=utf-8",
        filename: "repair-report.md",
      };
    }
    const comparisonHtml =
      comparison.length === 0
        ? "<p>No browser replay comparison recorded.</p>"
        : `<ul>${comparison
            .map(
              (item) =>
                `<li><code>${escapeHtml(item.findingId)}</code>: <strong>${escapeHtml(item.afterState)}</strong> - ${escapeHtml(item.explanation)}</li>`,
            )
            .join("")}</ul>`;
    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AccessPath Repair Evidence - ${escapeHtml(session.id)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:72rem;margin:0 auto;padding:2rem;color:#17241d}code{overflow-wrap:anywhere}dt{font-weight:700}dd{margin:0 0 .75rem}section{border-top:1px solid #b7c3bc;padding-top:1rem;margin-top:1.5rem}</style>
</head>
<body>
<main>
<h1>AccessPath Repair Evidence</h1>
<dl>
<dt>Repair</dt><dd><code>${escapeHtml(session.id)}</code></dd>
<dt>State</dt><dd>${escapeHtml(session.state)}</dd>
<dt>Repository</dt><dd>${escapeHtml(session.repository.repositoryDisplayName)}</dd>
<dt>Base commit</dt><dd><code>${escapeHtml(session.repository.baseCommit)}</code></dd>
<dt>Base checkout unchanged</dt><dd>${report.baseIntegrity.unchanged ? "yes" : "no"}</dd>
<dt>Before audit bundle</dt><dd><code>${escapeHtml(report.beforeAudit?.id ?? "Unavailable")}</code></dd>
<dt>After audit bundle</dt><dd><code>${escapeHtml(report.afterAudit?.id ?? "Not recorded")}</code></dd>
</dl>
<section><h2>Plan</h2><p>${escapeHtml(report.plan?.text ?? "No plan recorded.")}</p></section>
<section><h2>Changed files</h2><ul>${report.diff.changedFiles.map((path) => `<li><code>${escapeHtml(path)}</code></li>`).join("") || "<li>None</li>"}</ul></section>
<section><h2>Before and after</h2>${comparisonHtml}</section>
<section><h2>Verification</h2><ul>${report.verification?.tests.map((test) => `<li><code>${escapeHtml(test.commandId)}</code>: ${escapeHtml(test.state)} (${test.durationMs} ms)</li>`).join("") || "<li>No configured checks recorded.</li>"}</ul></section>
<section><h2>Limitations</h2><ul>${[...(report.beforeAudit?.limitations ?? []), ...(report.afterAudit?.limitations ?? [])].map((limitation) => `<li>${escapeHtml(limitation)}</li>`).join("") || "<li>No additional limitations recorded.</li>"}</ul></section>
</main>
</body>
</html>
`;
    return {
      content: redactText(html),
      contentType: "text/html; charset=utf-8",
      filename: "repair-report.html",
    };
  }

  private async fail(repairId: string, error: unknown): Promise<void> {
    const message =
      error instanceof Error ? redactText(error.message) : "Repair failed.";
    await this.updateSession(repairId, (session) =>
      RepairSessionSchema.parse({
        ...session,
        state: "failed",
        updatedAt: timestamp(),
      }),
    ).catch(() => undefined);
    await this.appendEvent(repairId, "session.failed", {
      message,
    }).catch(() => undefined);
    this.config.onAgentFailure?.(repairId, message);
  }
}

export function repositoryValidationResponse(
  validation: RepositoryValidation,
): Omit<RepositoryValidation, "repositoryRoot"> {
  return {
    repositoryDisplayName: basename(validation.repositoryRoot),
    baseBranch: validation.baseBranch,
    baseCommit: validation.baseCommit,
    clean: validation.clean,
  };
}
