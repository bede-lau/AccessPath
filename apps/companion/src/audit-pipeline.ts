import { randomUUID } from "node:crypto";
import { relative } from "node:path";

import {
  runAudit,
  type AuditEngineOptions,
  type AuditFailureDiagnostic,
} from "@accesspath/audit-engine";
import {
  AuditSessionSchema,
  TaskContractSchema,
  type AccessPathEvent,
  type AuditBundle,
  type AuditSession,
  type TaskContract,
} from "@accesspath/contracts";
import {
  NdjsonEventStore,
  atomicWriteFile,
  createAuditDirectoryLayout,
  persistArtifact,
  persistAuditBundle,
  regenerateReportsFromPersistedEvidence,
  validateArtifactRoot,
  type PersistedReports,
} from "@accesspath/evidence";

type EngineOptions = Omit<
  AuditEngineOptions,
  "auditSessionId" | "captureArtifact" | "onEvent"
>;

export interface PersistedAuditOptions {
  artifactRoot: string;
  editableRepositoryRoot: string;
  auditSessionId?: string;
  signal?: AbortSignal;
  engine?: EngineOptions;
}

export interface PersistedAuditResult {
  auditSessionId: string;
  bundle: AuditBundle;
  diagnostic?: AuditFailureDiagnostic;
  reports: PersistedReports;
}

function terminalState(outcome: AuditBundle["outcome"]): AuditSession["state"] {
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

export async function runPersistedAudit(
  inputTask: TaskContract,
  options: PersistedAuditOptions,
): Promise<PersistedAuditResult> {
  const task = TaskContractSchema.parse(inputTask);
  const artifactRoot = await validateArtifactRoot(
    options.artifactRoot,
    options.editableRepositoryRoot,
  );
  const auditSessionId =
    options.auditSessionId ?? `audit-${randomUUID()}`;
  const layout = await createAuditDirectoryLayout(
    artifactRoot,
    auditSessionId,
  );
  const events = new NdjsonEventStore(layout.eventsPath);
  const createdAt = new Date().toISOString();
  let session = AuditSessionSchema.parse({
    schemaVersion: "1.0.0",
    id: auditSessionId,
    state: "running",
    task,
    createdAt,
    updatedAt: createdAt,
  });
  let deferredTerminal:
    | AccessPathEvent<Record<string, unknown>>
    | undefined;

  const persistSession = async (): Promise<void> => {
    await atomicWriteFile(
      layout.root,
      relative(layout.root, layout.sessionPath).replaceAll("\\", "/"),
      `${JSON.stringify(session)}\n`,
    );
  };

  await persistSession();

  const result = await runAudit(task, {
    ...options.engine,
    signal: options.signal ?? options.engine?.signal,
    auditSessionId,
    captureArtifact: async (capture) =>
      persistArtifact(layout, {
        id: capture.id,
        kind: capture.kind,
        mimeType: capture.mimeType,
        extension: capture.extension,
        sensitivity: capture.sensitivity,
        description: capture.description,
        content: capture.data,
      }),
    onEvent: async (event) => {
      if (event.type === "phase.changed") {
        const runId =
          typeof event.payload.runId === "string"
            ? event.payload.runId
            : undefined;
        session = AuditSessionSchema.parse({
          ...session,
          activeRunId: runId ?? session.activeRunId,
          updatedAt: event.timestamp,
        });
        await persistSession();
      }
      if (
        event.type === "session.completed" ||
        event.type === "session.failed" ||
        event.type === "session.cancelled"
      ) {
        deferredTerminal = event;
        return;
      }
      await events.append(event);
    },
  });

  const { integrity: _engineIntegrity, ...withoutIntegrity } = result.bundle;
  const bundle = await persistAuditBundle(layout, withoutIntegrity);
  const reports = await regenerateReportsFromPersistedEvidence(layout);

  session = AuditSessionSchema.parse({
    ...session,
    state: terminalState(bundle.outcome),
    updatedAt:
      deferredTerminal?.timestamp ?? new Date().toISOString(),
  });
  await persistSession();
  if (deferredTerminal !== undefined) {
    await events.append(deferredTerminal);
  }

  return {
    auditSessionId,
    bundle,
    diagnostic: result.diagnostic,
    reports,
  };
}
