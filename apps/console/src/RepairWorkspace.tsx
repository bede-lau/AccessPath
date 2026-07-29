import type {
  AccessPathEvent,
  ApprovalRequest,
  RepairSession,
  RepairState,
  RewindPreview,
} from "@accesspath/contracts";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CirclePause,
  CircleStop,
  FileCode2,
  FileJson,
  FileText,
  GitCompareArrows,
  History,
  LoaderCircle,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  TestTube2,
  TriangleAlert,
  WifiOff,
  X,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  ApiError,
  applyRepairRewind,
  cancelRepair,
  decideRepairApproval,
  diagnoseRepair,
  downloadRepairReport,
  getRepair,
  getRepairDiff,
  pauseRepair,
  prepareRepair,
  previewRepairRewind,
  resumeRepair,
  startRepair,
  streamSessionEvents,
  verifyRepair,
  type ApprovalRecord,
  type RepairDiff,
  type RepairResource,
} from "./api";

type RepairConnection =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

const TERMINAL_REPAIR_STATES = new Set<RepairState>([
  "completed",
  "rejected",
  "failed",
  "cancelled",
]);

function repairStateLabel(state: RepairState): string {
  return state
    .split("-")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function eventLabel(event: AccessPathEvent<Record<string, unknown>>): string {
  const labels: Record<string, string> = {
    "agent.message.completed": "Agent update",
    "checkpoint.created": "Checkpoint created",
    "diff.updated": "Diff updated",
    "file.changed": "File changed",
    "phase.changed": "Phase changed",
    "rewind.completed": "Files rewound",
    "rewind.previewed": "Rewind previewed",
    "session.cancelled": "Repair cancelled",
    "session.completed": "Repair completed",
    "session.failed": "Repair failed",
    "session.paused": "Repair paused",
    "session.resumed": "Repair resumed",
    "test.completed": "Verification command completed",
    "test.started": "Verification command started",
    "tool.approved": "Permission approved",
    "tool.completed": "Tool completed",
    "tool.denied": "Permission denied",
    "tool.requested": "Permission requested",
    "tool.started": "Tool started",
    "verification.completed": "Verification completed",
    "verification.started": "Verification started",
  };
  return labels[event.type] ?? event.type.replaceAll(".", " ");
}

function eventDetail(event: AccessPathEvent<Record<string, unknown>>): string {
  if (typeof event.payload.text === "string") {
    return event.payload.text;
  }
  if (Array.isArray(event.payload.targetPaths)) {
    return event.payload.targetPaths.filter((path) => typeof path === "string").join(", ");
  }
  if (typeof event.payload.path === "string") {
    return event.payload.path;
  }
  if (typeof event.payload.label === "string") {
    return event.payload.label;
  }
  if (typeof event.payload.state === "string") {
    return repairStateLabel(event.payload.state as RepairState);
  }
  if (typeof event.payload.reason === "string") {
    return event.payload.reason;
  }
  return "";
}

function StatusPill({
  state,
  children,
}: {
  state: string;
  children: ReactNode;
}) {
  return (
    <span className="repair-status-pill" data-status={state}>
      {state === "completed" ||
      state === "passed" ||
      state === "resolved" ||
      state === "unchanged" ? (
        <Check aria-hidden="true" />
      ) : state === "failed" ||
        state === "rejected" ||
        state === "remaining" ||
        state === "regressed" ||
        state === "changed" ? (
        <AlertTriangle aria-hidden="true" />
      ) : state === "paused" ? (
        <CirclePause aria-hidden="true" />
      ) : (
        <LoaderCircle
          className={state === "running" ? "spin" : undefined}
          aria-hidden="true"
        />
      )}
      {children}
    </span>
  );
}

function diffSections(diff: RepairDiff | undefined): Array<{
  path: string;
  content: string;
}> {
  if (diff === undefined || diff.patch.trim() === "") {
    return [];
  }
  return diff.patch
    .split(/(?=^diff --git )/m)
    .filter(Boolean)
    .map((content, index) => {
      const match = content.match(/^diff --git a\/.+ b\/(.+)$/m);
      return {
        path: match?.[1] ?? diff.changedFiles[index] ?? `changed-file-${index + 1}`,
        content,
      };
    });
}

function ApprovalPanel({
  record,
  busy,
  rewindPreview,
  onDecision,
}: {
  record: ApprovalRecord;
  busy: boolean;
  rewindPreview?: RewindPreview;
  onDecision: (request: ApprovalRequest, approved: boolean) => Promise<void>;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    headingRef.current?.focus();
    return () => previousFocus.current?.focus();
  }, [record.request.id]);

  return (
    <section
      className="approval-panel"
      role="dialog"
      aria-labelledby="approval-heading"
      aria-describedby="approval-consequence"
    >
      <header>
        <div>
          <p className="eyebrow">Explicit approval required</p>
          <h2 id="approval-heading" ref={headingRef} tabIndex={-1}>
            {record.request.title}
          </h2>
        </div>
        <StatusPill state={record.request.risk}>{record.request.risk}</StatusPill>
      </header>
      <p id="approval-consequence">{record.request.consequence}</p>
      {record.request.targetPaths.length > 0 && (
        <div className="approval-scope">
          <strong>Exact scope</strong>
          <ul>
            {record.request.targetPaths.map((path) => <li key={path}>{path}</li>)}
          </ul>
        </div>
      )}
      {record.request.command !== undefined && (
        <div className="approval-command">
          <strong>Configured command</strong>
          <code>
            {record.request.command.executable}{" "}
            {record.request.command.args.join(" ")}
          </code>
        </div>
      )}
      {rewindPreview !== undefined && record.request.kind === "rewind" && (
        <dl className="rewind-facts">
          <div>
            <dt>Files restored</dt>
            <dd>{rewindPreview.affectedFiles.length}</dd>
          </div>
          <div>
            <dt>Stale checks</dt>
            <dd>{rewindPreview.staleVerificationIds.length}</dd>
          </div>
        </dl>
      )}
      <div className="approval-actions">
        <button
          type="button"
          className="primary-inline-command"
          disabled={busy}
          onClick={() => void onDecision(record.request, true)}
        >
          <Check aria-hidden="true" />
          {record.request.kind === "rewind" ? "Approve and rewind" : "Approve once"}
        </button>
        <button
          type="button"
          className="deny-command"
          disabled={busy}
          onClick={() => void onDecision(record.request, false)}
        >
          <X aria-hidden="true" />
          Deny
        </button>
      </div>
    </section>
  );
}

function RepairCommandBar({
  resource,
  diff,
  busy,
  onAction,
  onRewind,
}: {
  resource: RepairResource;
  diff?: RepairDiff;
  busy: boolean;
  onAction: (
    action: (repairId: string) => Promise<RepairSession>,
  ) => Promise<void>;
  onRewind: () => Promise<void>;
}) {
  const { repair } = resource;
  const pendingApprovals = resource.approvals.filter(
    (record) => record.request.state === "pending",
  );
  const hasPendingApproval = pendingApprovals.length > 0;
  const canReplacePatchWithRewind = pendingApprovals.every(
    (record) => record.request.kind === "patch",
  );
  const hasDiff = (diff?.changedFiles.length ?? 0) > 0;
  return (
    <div className="repair-commandbar">
      <div>
        <button
          type="button"
          className="back-button"
          onClick={() => window.history.back()}
        >
          <ArrowLeft aria-hidden="true" />
          Barrier Map
        </button>
        <p className="route-breadcrumb">
          Isolated local repair / {repair.repository.repositoryDisplayName}
        </p>
        <h1>Repair workspace</h1>
      </div>
      <div className="command-actions">
        {repair.state === "configuring" && (
          <button type="button" disabled={busy} onClick={() => void onAction(prepareRepair)}>
            <GitCompareArrows aria-hidden="true" />
            Prepare worktree
          </button>
        )}
        {repair.state === "diagnosing" && (
          <button type="button" disabled={busy} onClick={() => void onAction(diagnoseRepair)}>
            <Play aria-hidden="true" />
            Run diagnosis
          </button>
        )}
        {repair.state === "editing" &&
          !hasDiff &&
          !hasPendingApproval && (
          <button type="button" disabled={busy} onClick={() => void onAction(startRepair)}>
            <Play aria-hidden="true" />
            Start repair
          </button>
        )}
        {repair.state === "editing" &&
          hasDiff &&
          !hasPendingApproval && (
          <button type="button" disabled={busy} onClick={() => void onAction(startRepair)}>
            <Play aria-hidden="true" />
            Continue repair
          </button>
        )}
        {repair.state === "editing" &&
          hasDiff &&
          !hasPendingApproval && (
          <button type="button" disabled={busy} onClick={() => void onAction(verifyRepair)}>
            <TestTube2 aria-hidden="true" />
            Verify patch
          </button>
        )}
        {repair.state === "editing" && repair.qoderSessionId !== undefined && (
          <button type="button" disabled={busy} onClick={() => void onAction(pauseRepair)}>
            <CirclePause aria-hidden="true" />
            Pause
          </button>
        )}
        {repair.state === "paused" && (
          <button type="button" disabled={busy} onClick={() => void onAction(resumeRepair)}>
            <Play aria-hidden="true" />
            Resume
          </button>
        )}
        {hasDiff &&
          repair.latestCheckpointId !== undefined &&
          repair.state !== "completed" &&
          (!hasPendingApproval || canReplacePatchWithRewind) && (
            <button type="button" disabled={busy} onClick={() => void onRewind()}>
              <RotateCcw aria-hidden="true" />
              Preview rewind
            </button>
          )}
        {!TERMINAL_REPAIR_STATES.has(repair.state) && (
          <button
            type="button"
            className="danger-command"
            disabled={busy}
            onClick={() => void onAction(cancelRepair)}
          >
            <CircleStop aria-hidden="true" />
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

export function RepairWorkspace({
  repairId,
  onRepairChange,
}: {
  repairId: string;
  onRepairChange: (repair: RepairSession | undefined) => void;
}) {
  const [resource, setResource] = useState<RepairResource>();
  const [diff, setDiff] = useState<RepairDiff>();
  const [events, setEvents] = useState<
    AccessPathEvent<Record<string, unknown>>[]
  >([]);
  const [connection, setConnection] = useState<RepairConnection>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rewindPreview, setRewindPreview] = useState<RewindPreview>();
  const [selectedPath, setSelectedPath] = useState<string>();
  const [mobilePane, setMobilePane] = useState<
    "evidence" | "diff" | "verification"
  >("diff");
  const lastEventId = useRef<string | undefined>(undefined);
  const refreshSequence = useRef(0);

  const refresh = useCallback(async () => {
    const sequence = refreshSequence.current + 1;
    refreshSequence.current = sequence;
    const nextResource = await getRepair(repairId);
    let nextDiff: RepairDiff | undefined;
    if (nextResource.repair.state !== "configuring") {
      try {
        nextDiff = await getRepairDiff(repairId);
      } catch (nextError) {
        if (!(nextError instanceof ApiError) || nextError.status !== 409) {
          throw nextError;
        }
      }
    }
    if (sequence !== refreshSequence.current) {
      return nextResource;
    }
    setResource(nextResource);
    onRepairChange(nextResource.repair);
    if (nextDiff !== undefined) {
      setDiff(nextDiff);
      setSelectedPath((current) =>
        current !== undefined && nextDiff.changedFiles.includes(current)
          ? current
          : nextDiff.changedFiles[0],
      );
    }
    return nextResource;
  }, [onRepairChange, repairId]);

  useEffect(() => {
    let active = true;
    setConnection("connecting");
    void refresh()
      .then(() => {
        if (active) {
          setConnection("connected");
          setError(null);
        }
      })
      .catch((nextError) => {
        if (active) {
          setConnection("disconnected");
          setError(
            nextError instanceof Error
              ? nextError.message
              : "The repair session could not be loaded.",
          );
        }
      });
    return () => {
      active = false;
      onRepairChange(undefined);
    };
  }, [onRepairChange, refresh]);

  useEffect(() => {
    if (resource === undefined) {
      return;
    }
    const controller = new AbortController();
    let reconnectTimer: number | undefined;
    const connect = async () => {
      setConnection((current) =>
        current === "connected" ? "reconnecting" : "connecting",
      );
      try {
        await streamSessionEvents(
          repairId,
          lastEventId.current,
          (event) => {
            lastEventId.current = event.eventId;
            setConnection("connected");
            setError(null);
            setEvents((current) =>
              current.some((item) => item.eventId === event.eventId)
                ? current
                : [...current, event],
            );
            if (event.type !== "agent.message.delta") {
              void refresh().catch((nextError) =>
                setError(nextError instanceof Error ? nextError.message : "Refresh failed."),
              );
            }
          },
          controller.signal,
        );
        const latest = await refresh();
        setError(null);
        if (!TERMINAL_REPAIR_STATES.has(latest.repair.state)) {
          throw new ApiError(502, "The repair event stream closed unexpectedly.");
        }
      } catch (nextError) {
        if (controller.signal.aborted) {
          return;
        }
        setConnection("disconnected");
        setError(
          nextError instanceof Error
            ? nextError.message
            : "The repair event stream disconnected.",
        );
        reconnectTimer = window.setTimeout(() => void connect(), 1000);
      }
    };
    void connect();
    return () => {
      controller.abort();
      if (reconnectTimer !== undefined) {
        window.clearTimeout(reconnectTimer);
      }
    };
  }, [refresh, repairId, resource?.repair.state]);

  const runAction = async (
    action: (id: string) => Promise<RepairSession>,
  ) => {
    setBusy(true);
    setError(null);
    try {
      const repair = await action(repairId);
      onRepairChange(repair);
      await refresh();
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "The repair action failed.",
      );
    } finally {
      setBusy(false);
    }
  };

  const decide = async (request: ApprovalRequest, approved: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await decideRepairApproval(repairId, request.id, {
        decision: approved ? "approve-once" : "deny",
        ...(approved ? {} : { reason: "Denied in the repair workspace." }),
      });
      if (approved && request.kind === "rewind") {
        setDiff(await applyRepairRewind(repairId, request.id));
        setRewindPreview(undefined);
      }
      await refresh();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "The approval decision failed.",
      );
    } finally {
      setBusy(false);
    }
  };

  const previewRewind = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await previewRepairRewind(repairId);
      setRewindPreview(result.preview);
      await refresh();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "The rewind preview failed.",
      );
    } finally {
      setBusy(false);
    }
  };

  const sections = useMemo(() => diffSections(diff), [diff]);
  const selectedSection =
    sections.find((section) => section.path === selectedPath) ?? sections[0];
  const pendingApproval =
    resource?.approvals.find(
      (record) =>
        record.request.state === "pending" &&
        record.request.kind === "rewind",
    ) ??
    resource?.approvals.find(
      (record) => record.request.state === "pending",
    );
  const durableEvents = events.filter(
    (event) => event.type !== "agent.message.delta",
  );

  if (resource === undefined) {
    return (
      <main
        id="main-content"
        className={`empty-route ${error === null ? "route-loading" : ""}`}
        tabIndex={-1}
      >
        {error === null ? (
          <div className="loading-mark" aria-hidden="true">
            <img src="/accesspath-mark.png" alt="" />
          </div>
        ) : (
          <TriangleAlert aria-hidden="true" />
        )}
        <h1>{error === null ? "Loading repair workspace" : "Repair unavailable"}</h1>
        <p>{error ?? "Reading the durable local repair session."}</p>
        {error === null && (
          <div className="loading-scaffold" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        )}
      </main>
    );
  }

  return (
    <main id="main-content" className="repair-page" tabIndex={-1}>
      <RepairCommandBar
        resource={resource}
        diff={diff}
        busy={busy}
        onAction={runAction}
        onRewind={previewRewind}
      />
      <div className="repair-context-strip" aria-label="Repair context">
        <div>
          <span>Affected action</span>
          <strong>{resource.manifest.affectedActions[0] ?? "Selected barrier"}</strong>
        </div>
        <div>
          <span>Evidence bundle</span>
          <strong>{resource.manifest.auditBundleId}</strong>
        </div>
        <div>
          <span>Base commit</span>
          <strong>{resource.repair.repository.baseCommit.slice(0, 12)}</strong>
        </div>
        <div>
          <span>Worktree branch</span>
          <strong>{resource.repair.branch}</strong>
        </div>
        <StatusPill
          state={resource.baseIntegrity.unchanged ? "unchanged" : "changed"}
        >
          Base {resource.baseIntegrity.unchanged ? "unchanged" : "changed"}
        </StatusPill>
      </div>

      {connection !== "connected" &&
        !TERMINAL_REPAIR_STATES.has(resource.repair.state) && (
        <div className="repair-connection" role="status" aria-live="polite">
          {connection === "disconnected" ? (
            <WifiOff aria-hidden="true" />
          ) : (
            <RefreshCw className="spin" aria-hidden="true" />
          )}
          {connection === "disconnected"
            ? "Live repair updates are disconnected. Durable evidence remains visible."
            : "Reconnecting to durable repair events."}
        </div>
        )}
      {error !== null && (
        <div className="global-alert" role="alert">
          <TriangleAlert aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}
      {TERMINAL_REPAIR_STATES.has(resource.repair.state) && (
        <div
          className="terminal-notice"
          role="status"
          data-status={resource.repair.state}
        >
          {resource.repair.state === "completed" ? (
            <Check aria-hidden="true" />
          ) : (
            <TriangleAlert aria-hidden="true" />
          )}
          <div>
            <strong>{repairStateLabel(resource.repair.state)} repair</strong>
            <p>
              {resource.repair.state === "completed"
                ? "Verification evidence and exports are preserved. The isolated worktree remains separate from the unchanged base checkout."
                : "Durable events, approvals, and any verified diff remain available for review. The base checkout was not edited."}
            </p>
          </div>
        </div>
      )}
      {pendingApproval !== undefined && (
        <ApprovalPanel
          record={pendingApproval}
          busy={busy}
          rewindPreview={rewindPreview}
          onDecision={decide}
        />
      )}

      <div className="mobile-pane-switcher" aria-label="Repair workspace view">
        {(["evidence", "diff", "verification"] as const).map((pane) => (
          <button
            type="button"
            key={pane}
            aria-pressed={mobilePane === pane}
            onClick={() => setMobilePane(pane)}
          >
            {pane === "evidence"
              ? "Evidence"
              : pane === "diff"
                ? "Diff"
                : "Verification"}
          </button>
        ))}
      </div>
      <div className="repair-workspace">
        <section
          className="repair-evidence-pane"
          aria-labelledby="repair-brief-heading"
          data-mobile-visible={mobilePane === "evidence"}
        >
          <header>
            <p className="eyebrow">Bounded evidence brief</p>
            <h2 id="repair-brief-heading">
              {resource.manifest.findingIds.join(", ")}
            </h2>
          </header>
          <div className="repair-pane-body">
            <h3>Observed barrier</h3>
            <ul>
              {resource.manifest.observations.map((observation) => (
                <li key={observation}>{observation}</li>
              ))}
            </ul>
            <h3>Constraints</h3>
            <ul>
              {resource.manifest.constraints.map((constraint) => (
                <li key={constraint}>{constraint}</li>
              ))}
            </ul>
            <h3>Non-goals</h3>
            <ul>
              {resource.manifest.nonGoals.map((nonGoal) => (
                <li key={nonGoal}>{nonGoal}</li>
              ))}
            </ul>
            <h3>Approved source scope</h3>
            <ul className="path-list">
              {resource.manifest.allowedPathGlobs.map((path) => (
                <li key={path}><code>{path}</code></li>
              ))}
            </ul>
            <h3>Read-only diagnosis</h3>
            <p>{resource.plan?.text ?? "Diagnosis has not completed yet."}</p>
          </div>
        </section>

        <section
          className="repair-diff-pane"
          aria-labelledby="repair-diff-heading"
          data-mobile-visible={mobilePane === "diff"}
        >
          <header>
            <div>
              <p className="eyebrow">Git-authoritative worktree diff</p>
              <h2 id="repair-diff-heading">
                {diff?.changedFiles.length ?? 0} changed files
              </h2>
            </div>
            <StatusPill state={(diff?.changedFiles.length ?? 0) > 0 ? "changed" : "unchanged"}>
              {(diff?.changedFiles.length ?? 0) > 0 ? "Patch present" : "No patch"}
            </StatusPill>
          </header>
          {sections.length === 0 ? (
            <div className="repair-empty-pane">
              <FileCode2 aria-hidden="true" />
              <strong>No approved file changes yet</strong>
              <span>The semantic diff appears after an explicitly approved edit.</span>
            </div>
          ) : (
            <div className="semantic-diff">
              <nav aria-label="Changed files">
                {sections.map((section) => (
                  <button
                    key={section.path}
                    type="button"
                    aria-current={selectedSection?.path === section.path ? "page" : undefined}
                    onClick={() => setSelectedPath(section.path)}
                  >
                    <FileCode2 aria-hidden="true" />
                    {section.path}
                  </button>
                ))}
              </nav>
              <div className="diff-stat">{diff?.stat}</div>
              <pre aria-label={`Diff for ${selectedSection?.path ?? "selected file"}`}>
                {(selectedSection?.content ?? "").split("\n").map((line, index) => (
                  <span
                    key={`${index}-${line}`}
                    data-line={
                      line.startsWith("+") && !line.startsWith("+++")
                        ? "addition"
                        : line.startsWith("-") && !line.startsWith("---")
                          ? "deletion"
                          : line.startsWith("@@")
                            ? "hunk"
                            : "context"
                    }
                  >
                    {line || " "}
                  </span>
                ))}
              </pre>
            </div>
          )}
        </section>

        <aside
          className="repair-ledger-pane"
          aria-labelledby="verification-ledger-heading"
          data-mobile-visible={mobilePane === "verification"}
        >
          <section>
            <header>
              <p className="eyebrow">Verification ledger</p>
              <h2 id="verification-ledger-heading">Configured checks</h2>
            </header>
            {resource.tests.length === 0 ? (
              <div className="repair-ledger-empty">
                <TestTube2 aria-hidden="true" />
                <span>No verification run recorded.</span>
              </div>
            ) : (
              <ul className="verification-list">
                {resource.tests.map((test) => (
                  <li key={test.commandId}>
                    <StatusPill state={test.state}>{test.state}</StatusPill>
                    <strong>{test.commandId}</strong>
                    <span>{test.durationMs} ms</span>
                  </li>
                ))}
              </ul>
            )}
            {resource.verification !== undefined && (
              <div className="repair-comparison" aria-labelledby="repair-comparison-heading">
                <h3 id="repair-comparison-heading">Before and after</h3>
                <ul className="verification-list">
                  {resource.verification.comparison.map((item) => (
                    <li key={item.findingId}>
                      <StatusPill state={item.afterState}>
                        {item.afterState}
                      </StatusPill>
                      <strong>{item.findingId}</strong>
                      <span>{item.explanation}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
          <section className="repair-timeline">
            <header>
              <p className="eyebrow">Agent and tool timeline</p>
              <h2>Durable events</h2>
            </header>
            {durableEvents.length === 0 ? (
              <div className="repair-ledger-empty">
                <History aria-hidden="true" />
                <span>Waiting for the next repair event.</span>
              </div>
            ) : (
              <ol tabIndex={0} aria-label="Durable repair event timeline">
                {durableEvents.map((event) => (
                  <li key={event.eventId}>
                    <span className="timeline-sequence">{event.sequence}</span>
                    <div>
                      <strong>{eventLabel(event)}</strong>
                      {eventDetail(event) !== "" && <p>{eventDetail(event)}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
          {(TERMINAL_REPAIR_STATES.has(resource.repair.state) ||
            resource.verification !== undefined) && (
            <section className="repair-report-actions">
              <header>
                <p className="eyebrow">Repair evidence</p>
                <h2>Export durable report</h2>
              </header>
              <button type="button" onClick={() => void downloadRepairReport(repairId, "markdown")}>
                <FileText aria-hidden="true" />
                Markdown
              </button>
              <button type="button" onClick={() => void downloadRepairReport(repairId, "html")}>
                <FileCode2 aria-hidden="true" />
                HTML
              </button>
              <button type="button" onClick={() => void downloadRepairReport(repairId, "json")}>
                <FileJson aria-hidden="true" />
                JSON
              </button>
            </section>
          )}
          {!resource.baseIntegrity.unchanged && (
            <div className="base-integrity-alert" role="alert">
              <ShieldCheck aria-hidden="true" />
              <span>The base checkout changed. Stop and inspect before continuing.</span>
            </div>
          )}
        </aside>
      </div>
      <div className="visually-hidden" aria-live="polite" aria-atomic="true">
        Repair {repairStateLabel(resource.repair.state)}.
      </div>
    </main>
  );
}
