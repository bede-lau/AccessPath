import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { basename, relative } from "node:path";

import {
  AccessPathEventSchema,
  AuditSessionSchema,
  SCHEMA_VERSION,
  TaskContractSchema,
  type AccessPathEvent,
  type AuditBundle,
  type AuditSession,
  type AuditState,
  type TaskContract,
} from "@accesspath/contracts";
import {
  NdjsonEventStore,
  atomicWriteFile,
  createAuditDirectoryLayout,
  fileExists,
  loadAuditBundle,
  resolveSafeRelativePath,
  validateArtifactRoot,
  type AuditDirectoryLayout,
} from "@accesspath/evidence";

import {
  runPersistedAudit,
  type PersistedAuditOptions,
  type PersistedAuditResult,
} from "./audit-pipeline";

export type AuditRunner = (
  task: TaskContract,
  options: PersistedAuditOptions,
) => Promise<PersistedAuditResult>;

export interface AuditServiceConfig {
  artifactRoot: string;
  editableRepositoryRoot: string;
  runner?: AuditRunner;
}

type CommandName = "start" | "pause" | "resume" | "cancel";

type ActiveRun = {
  controller: AbortController;
  pauseRequested: boolean;
  resumeWaiters: Set<() => void>;
  done: Promise<void>;
  resolveDone: () => void;
};

type CommandReceipts = Record<string, { command: CommandName; createdAt: string }>;

function timestamp(): string {
  return new Date().toISOString();
}

function stateForOutcome(outcome: AuditBundle["outcome"]): AuditState {
  switch (outcome) {
    case "passed":
      return "completed";
    case "blocked":
      return "blocked";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
  }
}

function defaultTask(startUrl: string, targetPolicy: TaskContract["targetPolicy"]): TaskContract {
  const url = new URL(startUrl);
  return TaskContractSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    id: `task-url-${randomUUID()}`,
    title: `Audit ${url.origin}`,
    goal: "Inspect the supplied URL and record an accessibility evidence baseline.",
    startUrl,
    targetPolicy,
    success: {},
    forbiddenActions: [
      "Do not submit forms, make purchases, upload files, or enter real personal information.",
    ],
    expectedSteps: [
      {
        id: "url-baseline",
        intent: "Confirm the target page loaded",
        action: { kind: "press", key: "Tab" },
        checkpoint: true,
      },
    ],
    fixtureValues: {},
    viewport: { width: 1280, height: 800 },
    timeoutMs: 45_000,
  });
}

async function taskFromCreateInput(input: unknown): Promise<TaskContract> {
  const direct = TaskContractSchema.safeParse(input);
  if (direct.success) {
    return direct.data;
  }
  if (typeof input === "object" && input !== null && "task" in input) {
    return TaskContractSchema.parse((input as { task: unknown }).task);
  }
  if (
    typeof input !== "object" ||
    input === null ||
    typeof (input as { startUrl?: unknown }).startUrl !== "string"
  ) {
    throw new Error("A task contract or startUrl is required.");
  }

  const startUrl = (input as { startUrl: string }).startUrl;
  const targetPolicy =
    (input as { targetPolicy?: unknown }).targetPolicy === "local-explicit"
      ? "local-explicit"
      : "public";

  const target = new URL(startUrl);
  const isLoopback =
    target.hostname === "127.0.0.1" ||
    target.hostname === "localhost" ||
    target.hostname === "[::1]";
  if (targetPolicy === "local-explicit" && isLoopback) {
    const fixtureUrl = new URL("/fixture/task-contract.json", startUrl);
    try {
      const response = await fetch(fixtureUrl, {
        headers: { accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) {
        const content = await response.arrayBuffer();
        if (content.byteLength > 64 * 1024) {
          throw new Error("Fixture task contract is too large.");
        }
        const fixtureTask = TaskContractSchema.parse(
          JSON.parse(Buffer.from(content).toString("utf8")),
        );
        return TaskContractSchema.parse({ ...fixtureTask, startUrl });
      }
    } catch {
      // Non-fixture local targets use the conservative URL baseline below.
    }
  }

  return defaultTask(startUrl, targetPolicy);
}

export class AuditNotFoundError extends Error {}
export class AuditStateError extends Error {
  public constructor(
    public readonly currentState: AuditState,
    message: string,
  ) {
    super(message);
  }
}

export class AuditService {
  private readonly activeRuns = new Map<string, ActiveRun>();
  private readonly transitionLocks = new Set<string>();
  private readonly eventQueues = new Map<string, Promise<unknown>>();
  private readonly sessionQueues = new Map<string, Promise<unknown>>();
  private validatedArtifactRoot?: Promise<string>;

  public constructor(private readonly config: AuditServiceConfig) {}

  private artifactRoot(): Promise<string> {
    this.validatedArtifactRoot ??= validateArtifactRoot(
      this.config.artifactRoot,
      this.config.editableRepositoryRoot,
    );
    return this.validatedArtifactRoot;
  }

  private async layout(auditId: string): Promise<AuditDirectoryLayout> {
    const root = await this.artifactRoot();
    return createAuditDirectoryLayout(root, auditId);
  }

  private async existingLayout(auditId: string): Promise<AuditDirectoryLayout> {
    const layout = await this.layout(auditId);
    if (!(await fileExists(layout.sessionPath))) {
      throw new AuditNotFoundError("Audit session not found.");
    }
    return layout;
  }

  private enqueueSession<T>(
    auditId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.sessionQueues.get(auditId) ?? Promise.resolve();
    const current = previous.then(operation, operation);
    this.sessionQueues.set(auditId, current);
    void current.then(
      () => {
        if (this.sessionQueues.get(auditId) === current) {
          this.sessionQueues.delete(auditId);
        }
      },
      () => {
        if (this.sessionQueues.get(auditId) === current) {
          this.sessionQueues.delete(auditId);
        }
      },
    );
    return current;
  }

  private async writeSessionFile(
    layout: AuditDirectoryLayout,
    session: AuditSession,
  ): Promise<AuditSession> {
    const parsed = AuditSessionSchema.parse(session);
    await atomicWriteFile(
      layout.root,
      relative(layout.root, layout.sessionPath).replaceAll("\\", "/"),
      `${JSON.stringify(parsed)}\n`,
    );
    return parsed;
  }

  private writeSession(
    layout: AuditDirectoryLayout,
    session: AuditSession,
  ): Promise<AuditSession> {
    return this.enqueueSession(session.id, () =>
      this.writeSessionFile(layout, session),
    );
  }

  private async updateSession(
    auditId: string,
    update: (current: AuditSession) => AuditSession,
  ): Promise<AuditSession> {
    return this.enqueueSession(auditId, async () => {
      const layout = await this.existingLayout(auditId);
      const current = await this.readSessionFrom(layout);
      return this.writeSessionFile(layout, update(current));
    });
  }

  private async readSessionFrom(layout: AuditDirectoryLayout): Promise<AuditSession> {
    return AuditSessionSchema.parse(
      JSON.parse(await readFile(layout.sessionPath, "utf8")),
    );
  }

  public async get(auditId: string): Promise<AuditSession> {
    return this.readSessionFrom(await this.existingLayout(auditId));
  }

  public async mapTarget(input: unknown): Promise<TaskContract> {
    return taskFromCreateInput(input);
  }

  public async create(input: unknown): Promise<AuditSession> {
    const task = await taskFromCreateInput(input);
    const auditId = `audit-${randomUUID()}`;
    const layout = await this.layout(auditId);
    const now = timestamp();
    const session = await this.writeSession(
      layout,
      AuditSessionSchema.parse({
        schemaVersion: SCHEMA_VERSION,
        id: auditId,
        state: "ready",
        task,
        createdAt: now,
        updatedAt: now,
      }),
    );
    await this.appendEvent(auditId, "session.created", { state: "ready" });
    return session;
  }

  public async update(auditId: string, input: unknown): Promise<AuditSession> {
    const current = await this.get(auditId);
    if (current.state !== "ready" && current.state !== "blocked") {
      throw new AuditStateError(
        current.state,
        `Cannot update an audit in state ${current.state}.`,
      );
    }
    const task = await taskFromCreateInput(input);
    return this.updateSession(auditId, (session) =>
      AuditSessionSchema.parse({
        ...session,
        task,
        state: "ready",
        activeRunId: undefined,
        updatedAt: timestamp(),
      }),
    );
  }

  private enqueueEvent<T>(auditId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.eventQueues.get(auditId) ?? Promise.resolve();
    const current = previous.then(operation, operation);
    this.eventQueues.set(auditId, current);
    void current.then(
      () => {
        if (this.eventQueues.get(auditId) === current) {
          this.eventQueues.delete(auditId);
        }
      },
      () => {
        if (this.eventQueues.get(auditId) === current) {
          this.eventQueues.delete(auditId);
        }
      },
    );
    return current;
  }

  public appendEvent(
    auditId: string,
    type: AccessPathEvent["type"],
    payload: Record<string, unknown>,
    correlationId?: string,
    eventId = `event-${randomUUID()}`,
  ): Promise<AccessPathEvent<Record<string, unknown>>> {
    return this.enqueueEvent(auditId, async () => {
      const layout = await this.existingLayout(auditId);
      const store = new NdjsonEventStore(layout.eventsPath);
      const replay = await store.readAll();
      const event = AccessPathEventSchema.parse({
        schemaVersion: SCHEMA_VERSION,
        eventId,
        sessionId: auditId,
        sequence: (replay.events.at(-1)?.sequence ?? 0) + 1,
        timestamp: timestamp(),
        correlationId,
        type,
        payload,
      }) as AccessPathEvent<Record<string, unknown>>;
      await store.append(event);
      return event;
    });
  }

  private async appendEngineEvent(
    auditId: string,
    event: AccessPathEvent<Record<string, unknown>>,
  ): Promise<AccessPathEvent<Record<string, unknown>> | undefined> {
    if (event.type === "session.created") {
      return undefined;
    }
    if (
      event.type === "session.completed" ||
      event.type === "session.failed" ||
      event.type === "session.cancelled"
    ) {
      const outcome = event.payload.outcome;
      const state =
        event.type === "session.failed"
          ? "failed"
          : event.type === "session.cancelled"
            ? "cancelled"
            : outcome === "passed"
              ? "completed"
              : outcome === "blocked"
                ? "blocked"
                : "failed";
      await this.updateSession(auditId, (current) =>
        AuditSessionSchema.parse({
          ...current,
          state,
          updatedAt: event.timestamp,
        }),
      );
    }
    if (event.type === "phase.changed" && typeof event.payload.runId === "string") {
      await this.updateSession(auditId, (current) =>
        AuditSessionSchema.parse({
          ...current,
          activeRunId: event.payload.runId,
          updatedAt: event.timestamp,
        }),
      );
    }
    return this.appendEvent(
      auditId,
      event.type,
      event.payload,
      event.correlationId,
      event.eventId,
    );
  }

  private async receipts(layout: AuditDirectoryLayout): Promise<CommandReceipts> {
    const path = resolveSafeRelativePath(
      layout.root,
      `${relative(layout.root, layout.auditDir).replaceAll("\\", "/")}/commands.json`,
    );
    try {
      return JSON.parse(await readFile(path, "utf8")) as CommandReceipts;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return {};
      }
      throw error;
    }
  }

  private async recordReceipt(
    layout: AuditDirectoryLayout,
    command: CommandName,
    idempotencyKey: string | undefined,
  ): Promise<void> {
    if (idempotencyKey === undefined) {
      return;
    }
    const receipts = await this.receipts(layout);
    receipts[`${command}:${idempotencyKey}`] = { command, createdAt: timestamp() };
    await atomicWriteFile(
      layout.root,
      `${relative(layout.root, layout.auditDir).replaceAll("\\", "/")}/commands.json`,
      `${JSON.stringify(receipts)}\n`,
    );
  }

  private async isDuplicate(
    layout: AuditDirectoryLayout,
    command: CommandName,
    idempotencyKey: string | undefined,
  ): Promise<boolean> {
    if (idempotencyKey === undefined) {
      return false;
    }
    const receipts = await this.receipts(layout);
    return receipts[`${command}:${idempotencyKey}`] !== undefined;
  }

  private async transition(
    auditId: string,
    command: CommandName,
    idempotencyKey: string | undefined,
    allowed: readonly AuditState[],
    idempotentStates: readonly AuditState[],
    nextState: AuditState,
    effect: (session: AuditSession) => Promise<void>,
  ): Promise<AuditSession> {
    if (this.transitionLocks.has(auditId)) {
      throw new AuditStateError((await this.get(auditId)).state, "Another transition is active.");
    }
    this.transitionLocks.add(auditId);
    try {
      const layout = await this.existingLayout(auditId);
      const session = await this.readSessionFrom(layout);
      if (await this.isDuplicate(layout, command, idempotencyKey)) {
        return session;
      }
      if (idempotentStates.includes(session.state)) {
        await this.recordReceipt(layout, command, idempotencyKey);
        return session;
      }
      if (!allowed.includes(session.state)) {
        throw new AuditStateError(
          session.state,
          `Cannot ${command} an audit in state ${session.state}.`,
        );
      }
      const updated = await this.writeSession(
        layout,
        AuditSessionSchema.parse({
          ...session,
          state: nextState,
          updatedAt: timestamp(),
        }),
      );
      await this.recordReceipt(layout, command, idempotencyKey);
      await effect(updated);
      return this.get(auditId);
    } finally {
      this.transitionLocks.delete(auditId);
    }
  }

  private launch(auditId: string, task: TaskContract): void {
    const controller = new AbortController();
    let resolveDone: () => void = () => {};
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    const active: ActiveRun = {
      controller,
      pauseRequested: false,
      resumeWaiters: new Set(),
      done,
      resolveDone,
    };
    this.activeRuns.set(auditId, active);
    const runner = this.config.runner ?? runPersistedAudit;
    void runner(task, {
      artifactRoot: this.config.artifactRoot,
      editableRepositoryRoot: this.config.editableRepositoryRoot,
      auditSessionId: auditId,
      signal: controller.signal,
      manageSession: false,
      eventWriter: (event) => this.appendEngineEvent(auditId, event),
      engine: {
        beforeStep: async () => {
          while (active.pauseRequested && !controller.signal.aborted) {
            await new Promise<void>((resolve) => {
              active.resumeWaiters.add(resolve);
            });
          }
        },
        idFactory: {
          next: (prefix) => `${prefix}-${randomUUID()}`,
        },
      },
    })
      .then(async (result) => {
        if (active.pauseRequested && result.bundle.outcome === "cancelled") {
          return;
        }
        await this.updateSession(auditId, (session) =>
          AuditSessionSchema.parse({
            ...session,
            state: stateForOutcome(result.bundle.outcome),
            activeRunId: result.bundle.runId,
            updatedAt: timestamp(),
          }),
        );
      })
      .catch(async () => {
        const current = await this.get(auditId).catch(() => undefined);
        if (current === undefined || active.pauseRequested) {
          return;
        }
        await this.updateSession(auditId, (session) =>
          AuditSessionSchema.parse({
            ...session,
            state: "failed",
            updatedAt: timestamp(),
          }),
        );
        await this.appendEvent(auditId, "session.failed", {
          code: "INTERNAL",
          message: "The audit run failed.",
        });
      })
      .finally(() => {
        for (const resolve of active.resumeWaiters) {
          resolve();
        }
        active.resumeWaiters.clear();
        if (this.activeRuns.get(auditId) === active) {
          this.activeRuns.delete(auditId);
        }
        active.resolveDone();
      });
  }

  public start(
    auditId: string,
    idempotencyKey?: string,
  ): Promise<AuditSession> {
    return this.transition(
      auditId,
      "start",
      idempotencyKey,
      ["ready"],
      ["running"],
      "running",
      async (session) => {
        this.launch(auditId, session.task);
      },
    );
  }

  public pause(
    auditId: string,
    idempotencyKey?: string,
  ): Promise<AuditSession> {
    return this.transition(
      auditId,
      "pause",
      idempotencyKey,
      ["running"],
      ["paused"],
      "paused",
      async () => {
        const active = this.activeRuns.get(auditId);
        if (active !== undefined) {
          active.pauseRequested = true;
        }
        await this.appendEvent(auditId, "session.paused", {});
      },
    );
  }

  public resume(
    auditId: string,
    idempotencyKey?: string,
  ): Promise<AuditSession> {
    return this.transition(
      auditId,
      "resume",
      idempotencyKey,
      ["paused"],
      ["running"],
      "running",
      async (session) => {
        await this.appendEvent(auditId, "session.resumed", {});
        const active = this.activeRuns.get(auditId);
        if (active === undefined) {
          this.launch(auditId, session.task);
          return;
        }
        active.pauseRequested = false;
        for (const resolve of active.resumeWaiters) {
          resolve();
        }
        active.resumeWaiters.clear();
      },
    );
  }

  public async recover(auditId: string): Promise<AuditSession> {
    const session = await this.get(auditId);
    if (this.activeRuns.has(auditId)) {
      return session;
    }
    if (session.state === "ready") {
      return this.start(auditId, `recover:${auditId}:start`);
    }
    if (session.state === "paused") {
      return this.resume(auditId, `recover:${auditId}:resume`);
    }
    if (session.state === "running") {
      this.launch(auditId, session.task);
    }
    return this.get(auditId);
  }

  public cancel(
    auditId: string,
    idempotencyKey?: string,
  ): Promise<AuditSession> {
    return this.transition(
      auditId,
      "cancel",
      idempotencyKey,
      ["running", "paused"],
      ["cancelled"],
      "cancelled",
      async () => {
        const active = this.activeRuns.get(auditId);
        if (active !== undefined) {
          active.pauseRequested = false;
          for (const resolve of active.resumeWaiters) {
            resolve();
          }
          active.resumeWaiters.clear();
          active.controller.abort();
          await active.done;
        } else {
          await this.appendEvent(auditId, "session.cancelled", {});
        }
      },
    );
  }

  public async bundle(auditId: string): Promise<AuditBundle> {
    const layout = await this.existingLayout(auditId);
    if (!(await fileExists(layout.bundlePath))) {
      throw new AuditStateError((await this.readSessionFrom(layout)).state, "No audit bundle is available yet.");
    }
    return loadAuditBundle(layout);
  }

  public async report(
    auditId: string,
    format: "html" | "markdown" | "json",
  ): Promise<{ content: string; contentType: string; filename: string }> {
    const layout = await this.existingLayout(auditId);
    const details = {
      html: {
        path: layout.htmlReportPath,
        contentType: "text/html; charset=utf-8",
        filename: "report.html",
      },
      markdown: {
        path: layout.markdownReportPath,
        contentType: "text/markdown; charset=utf-8",
        filename: "report.md",
      },
      json: {
        path: layout.jsonReportPath,
        contentType: "application/json; charset=utf-8",
        filename: "report.json",
      },
    }[format];
    if (!(await fileExists(details.path))) {
      throw new AuditStateError((await this.readSessionFrom(layout)).state, "No audit report is available yet.");
    }
    return {
      content: await readFile(details.path, "utf8"),
      contentType: details.contentType,
      filename: details.filename,
    };
  }

  public async replay(
    auditId: string,
    cursor?: string,
  ): Promise<AccessPathEvent[]> {
    const layout = await this.existingLayout(auditId);
    const all = await new NdjsonEventStore(layout.eventsPath).readAll();
    if (cursor === undefined || cursor === "") {
      return all.events;
    }
    const numeric = Number(cursor);
    const afterSequence = Number.isInteger(numeric)
      ? numeric
      : (all.events.find((event) => event.eventId === cursor)?.sequence ?? -1);
    return all.events.filter((event) => event.sequence > afterSequence);
  }

  private async artifactFromSession(
    sessionId: string,
    artifactId: string,
  ): Promise<{ content: Buffer; contentType: string; filename: string } | undefined> {
    const layout = await this.existingLayout(sessionId);
    if (!(await fileExists(layout.bundlePath))) {
      return undefined;
    }
    const bundle = await loadAuditBundle(layout);
    const artifact = bundle.artifacts.find((item) => item.id === artifactId);
    if (artifact === undefined) {
      return undefined;
    }
    const path = resolveSafeRelativePath(
      layout.auditDir,
      artifact.relativePath,
    );
    return {
      content: await readFile(path),
      contentType: artifact.mimeType,
      filename: basename(artifact.relativePath),
    };
  }

  public async artifact(
    artifactId: string,
    sessionId?: string,
  ): Promise<{ content: Buffer; contentType: string; filename: string }> {
    if (sessionId !== undefined) {
      const match = await this.artifactFromSession(sessionId, artifactId);
      if (match !== undefined) {
        return match;
      }
      throw new AuditNotFoundError("Artifact not found for this audit session.");
    }

    const root = await this.artifactRoot();
    const auditsDirectory = resolveSafeRelativePath(root, "audits");
    let auditIds: string[];
    try {
      auditIds = (await readdir(auditsDirectory, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new AuditNotFoundError("Artifact not found.");
      }
      throw error;
    }

    const matches = (
      await Promise.all(
        auditIds.map((auditId) =>
          this.artifactFromSession(auditId, artifactId).catch(() => undefined),
        ),
      )
    ).filter(
      (
        match,
      ): match is { content: Buffer; contentType: string; filename: string } =>
        match !== undefined,
    );
    if (matches.length !== 1) {
      throw new AuditNotFoundError("Artifact not found.");
    }
    return matches[0];
  }
}
