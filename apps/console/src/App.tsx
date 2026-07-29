/*
THESIS: AccessPath is a quiet command center where evidence, not chrome, owns the screen.
OWN-WORLD: Cool neutral surfaces, graphite type, operational blue, thin rules, compact controls.
STORY: Define a task, observe the barrier, approve bounded repair, verify, and export.
FIRST VIEWPORT: Compact rail, contextual command header, source list, work surface, inspector.
FORM: Approved Option A, Source List Command Center, adapted across every console route.
*/

import type {
  AccessPathEvent,
  ArtifactRef,
  AuditBundle,
  AuditSession,
  AuditState,
  Finding,
  RepairManifest,
  RepairSession,
  RepositoryConfig,
  TaskContract,
  TaskStepResult,
} from "@accesspath/contracts";
import {
  Activity,
  AlertTriangle,
  Archive,
  ArrowLeft,
  BarChart3,
  Check,
  ChevronRight,
  CirclePause,
  CircleStop,
  ClipboardCheck,
  FileJson,
  FileText,
  Focus,
  Gauge,
  LayoutList,
  Link2,
  LoaderCircle,
  Map as MapIcon,
  Monitor,
  Network,
  PanelLeftClose,
  Play,
  Radio,
  RefreshCw,
  Search,
  ShieldCheck,
  TriangleAlert,
  WifiOff,
  X,
} from "lucide-react";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  ApiError,
  cancelAudit,
  createAudit,
  createRepair,
  downloadReport,
  fetchArtifactUrl,
  getAudit,
  getAuditBundle,
  getPublicConfig,
  pauseAudit,
  resumeAudit,
  startAudit,
  streamAuditEvents,
  validateRepository,
} from "./api";
import {
  type BarrierMapMode,
  buildBarrierPresentation,
} from "./barrier-model";
import { createReviewedAuditTask } from "./reviewed-task";
import { RepairWorkspace } from "./RepairWorkspace";

type View = "setup" | "live" | "barrier-map" | "repair";
type ConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

const TERMINAL_STATES = new Set<AuditState>([
  "completed",
  "blocked",
  "failed",
  "cancelled",
]);

function statusCopy(state: AuditState): string {
  switch (state) {
    case "draft":
      return "Draft";
    case "ready":
      return "Ready";
    case "running":
      return "Running";
    case "paused":
      return "Paused";
    case "completed":
      return "Completed";
    case "blocked":
      return "Blocked";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
  }
}

function navigate(path: string): void {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function inferView(pathname: string): View {
  if (/^\/repairs\/[^/]+/.test(pathname)) {
    return "repair";
  }
  if (pathname.includes("/barrier-map")) {
    return "barrier-map";
  }
  if (pathname.includes("/live")) {
    return "live";
  }
  return "setup";
}

function auditIdFromPath(pathname: string): string | undefined {
  return pathname.match(/^\/audits\/([^/]+)\//)?.[1];
}

function repairIdFromPath(pathname: string): string | undefined {
  return pathname.match(/^\/repairs\/([^/]+)/)?.[1];
}

function IconButton({
  label,
  children,
  onClick,
  disabled,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      className="icon-button"
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function StatusBadge({
  state,
  label,
}: {
  state: string;
  label?: string;
}) {
  const icon =
    state === "completed" || state === "passed"
      ? <Check aria-hidden="true" />
      : state === "running"
        ? <LoaderCircle className="spin" aria-hidden="true" />
        : state === "failed" || state === "blocked"
          ? <AlertTriangle aria-hidden="true" />
          : state === "paused"
            ? <CirclePause aria-hidden="true" />
            : <Radio aria-hidden="true" />;
  return (
    <span className="status-badge" data-status={state}>
      {icon}
      {label ?? state}
    </span>
  );
}

function AppRail({
  view,
  auditId,
  repairId,
  connection,
}: {
  view: View;
  auditId?: string;
  repairId?: string;
  connection: ConnectionState;
}) {
  const items = [
    { label: "Projects", icon: Archive, enabled: true, view: "setup" as View },
    { label: "Audits", icon: Activity, enabled: true, view: "live" as View },
    {
      label: "Barrier Map",
      icon: MapIcon,
      enabled: auditId !== undefined,
      view: "barrier-map" as View,
    },
    {
      label: "Repairs",
      icon: ClipboardCheck,
      enabled: repairId !== undefined,
      view: "repair" as View,
    },
  ];
  return (
    <aside className="app-rail" aria-label="Application">
      <div className="brand-mark" aria-label="AccessPath">
        <img src="/accesspath-mark.png" alt="" aria-hidden="true" />
        <strong>AccessPath</strong>
      </div>
      <nav aria-label="Primary">
        {items.map((item) => {
          const Icon = item.icon;
          const active = item.view === view;
          return (
            <button
              type="button"
              key={item.label}
              disabled={!item.enabled}
              aria-current={active ? "page" : undefined}
              onClick={() => {
                if (item.view === "setup") {
                  navigate("/projects/demo/audits/new");
                } else if (auditId !== undefined && item.view === "live") {
                  navigate(`/audits/${auditId}/live`);
                } else if (
                  auditId !== undefined &&
                  item.view === "barrier-map"
                ) {
                  navigate(`/audits/${auditId}/barrier-map`);
                } else if (repairId !== undefined && item.view === "repair") {
                  navigate(`/repairs/${repairId}`);
                }
              }}
            >
              <Icon aria-hidden="true" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
      <div className="rail-status" data-connection={connection}>
        {connection === "disconnected" ? (
          <WifiOff aria-hidden="true" />
        ) : (
          <ShieldCheck aria-hidden="true" />
        )}
        <span>
          {connection === "connected"
            ? "Local ready"
            : connection === "reconnecting"
              ? "Reconnecting"
              : connection === "connecting"
                ? "Connecting"
                : connection === "disconnected"
                  ? "Disconnected"
                  : "Local companion"}
        </span>
      </div>
    </aside>
  );
}

function AuditSetup({
  busy,
  error,
  connection,
  demoAidAppPort,
  onRun,
}: {
  busy: boolean;
  error: string | null;
  connection: ConnectionState;
  demoAidAppPort?: number;
  onRun: (task: TaskContract) => Promise<void>;
}) {
  const [url, setUrl] = useState(
    `http://127.0.0.1:${demoAidAppPort ?? 4173}/`,
  );
  const [urlEdited, setUrlEdited] = useState(false);
  const effectiveUrl = urlEdited
    ? url
    : `http://127.0.0.1:${demoAidAppPort ?? 4173}/`;
  const [policy, setPolicy] = useState<"public" | "local-explicit">(
    "local-explicit",
  );
  const baseTask = useMemo(
    () => createReviewedAuditTask(effectiveUrl, policy),
    [effectiveUrl, policy],
  );
  const [goal, setGoal] = useState(baseTask.goal);
  const [successText, setSuccessText] = useState(
    baseTask.success.visibleText ?? "",
  );
  const [stepIntents, setStepIntents] = useState(
    baseTask.expectedSteps.map((step) => step.intent),
  );
  const [urlError, setUrlError] = useState<string | null>(null);
  const readinessBlocked =
    goal.trim() === "" ||
    successText.trim() === "" ||
    stepIntents.some((intent) => intent.trim() === "");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let parsed: URL;
    try {
      parsed = new URL(effectiveUrl);
    } catch {
      setUrlError("Enter a complete HTTP or HTTPS URL.");
      return;
    }
    if (policy === "public" && parsed.protocol !== "https:") {
      setUrlError("Public targets must use HTTPS.");
      return;
    }
    setUrlError(null);
    await onRun({
      ...createReviewedAuditTask(parsed.toString(), policy),
      goal: goal.trim(),
      success: {
        ...baseTask.success,
        visibleText: successText.trim(),
      },
      expectedSteps: baseTask.expectedSteps.map((step, index) => ({
        ...step,
        intent: stepIntents[index]?.trim() ?? "",
      })),
    });
  }

  return (
    <main id="main-content" className="setup-page" tabIndex={-1}>
      <div className="page-heading">
        <div>
          <p className="route-breadcrumb">Emergency aid demo / New audit</p>
          <h1>Review the critical path</h1>
          <p>
            Run one deterministic keyboard journey and preserve the evidence
            for every completed or blocked step.
          </p>
        </div>
        <StatusBadge
          state={connection === "connected" ? "ready" : "failed"}
          label={
            connection === "connected"
              ? "Companion ready"
              : connection === "connecting"
                ? "Checking companion"
                : "Companion disconnected"
          }
        />
      </div>

      <form className="setup-layout" onSubmit={submit} noValidate>
        <div className="setup-workspace">
          <section aria-labelledby="target-heading">
            <div className="section-number" aria-hidden="true">01</div>
            <div>
              <h2 id="target-heading">Target and policy</h2>
              <label htmlFor="target-url">Target URL</label>
              <input
                id="target-url"
                type="url"
                value={effectiveUrl}
                aria-invalid={urlError !== null}
                aria-describedby={urlError === null ? "target-help" : "target-error"}
                onChange={(event) => {
                  setUrlEdited(true);
                  setUrl(event.target.value);
                }}
              />
              <p id="target-help" className="field-help">
                Local URLs stay on this machine and require an explicit local
                policy.
              </p>
              {urlError !== null && (
                <p id="target-error" className="field-error">
                  <TriangleAlert aria-hidden="true" />
                  {urlError}
                </p>
              )}
              <fieldset className="segmented-field">
                <legend>Target policy</legend>
                <label>
                  <input
                    type="radio"
                    name="target-policy"
                    checked={policy === "local-explicit"}
                    onChange={() => setPolicy("local-explicit")}
                  />
                  <Monitor aria-hidden="true" />
                  Local explicit
                </label>
                <label>
                  <input
                    type="radio"
                    name="target-policy"
                    checked={policy === "public"}
                    onChange={() => setPolicy("public")}
                  />
                  <Network aria-hidden="true" />
                  Public HTTPS
                </label>
              </fieldset>
            </div>
          </section>

          <section aria-labelledby="task-heading">
            <div className="section-number" aria-hidden="true">02</div>
            <div>
              <h2 id="task-heading">Critical task</h2>
              <label htmlFor="task-goal">Task intent</label>
              <textarea
                id="task-goal"
                value={goal}
                onChange={(event) => setGoal(event.target.value)}
                aria-describedby="task-goal-help"
              />
              <p id="task-goal-help" className="field-help">
                Describe the outcome a person must be able to complete.
              </p>
              <dl className="compact-definition">
                <div>
                  <dt>Success condition</dt>
                  <dd>
                    <label htmlFor="success-text" className="visually-hidden">
                      Visible success text
                    </label>
                    <input
                      id="success-text"
                      type="text"
                      value={successText}
                      onChange={(event) => setSuccessText(event.target.value)}
                    />
                  </dd>
                </div>
                <div>
                  <dt>Fixture values</dt>
                  <dd>Fictional data held in memory only.</dd>
                </div>
              </dl>
            </div>
          </section>

          <section aria-labelledby="steps-heading">
            <div className="section-number" aria-hidden="true">03</div>
            <div>
              <h2 id="steps-heading">Reviewed path</h2>
              <ol className="reviewed-steps">
                {baseTask.expectedSteps.map((step, index) => (
                  <li key={step.id}>
                    <span>{index + 1}</span>
                    <div>
                      <label htmlFor={`step-intent-${step.id}`}>
                        Step {index + 1}
                      </label>
                      <input
                        id={`step-intent-${step.id}`}
                        type="text"
                        value={stepIntents[index] ?? ""}
                        onChange={(event) => {
                          const value = event.target.value;
                          setStepIntents((current) =>
                            current.map((intent, currentIndex) =>
                              currentIndex === index ? value : intent,
                            ),
                          );
                        }}
                      />
                      <small>
                        {step.checkpoint
                          ? "Evidence checkpoint configured"
                          : "Transition step"}
                      </small>
                    </div>
                    <Check aria-label="Ready" />
                  </li>
                ))}
              </ol>
            </div>
          </section>
        </div>

        <aside className="readiness-ledger" aria-labelledby="readiness-heading">
          <h2 id="readiness-heading">Readiness ledger</h2>
          <ul>
            <li>
              <ShieldCheck aria-hidden="true" />
              <span><strong>Policy</strong> Private targets checked at every request</span>
            </li>
            <li>
              <Focus aria-hidden="true" />
              <span><strong>Capture</strong> Focus, action, screenshot, axe, console, network</span>
            </li>
            <li>
              <Gauge aria-hidden="true" />
              <span><strong>Budget</strong> 60 second deterministic run</span>
            </li>
            <li>
              <PanelLeftClose aria-hidden="true" />
              <span><strong>Fallback</strong> AP-001 assist is recorded, never passed</span>
            </li>
          </ul>
          {error !== null && (
            <div className="persistent-error" role="alert">
              <TriangleAlert aria-hidden="true" />
              <div>
                <strong>Audit could not start</strong>
                <p>{error} Preserved setup values are unchanged.</p>
              </div>
            </div>
          )}
          <button
            className="primary-command"
            type="submit"
            disabled={busy || readinessBlocked || connection !== "connected"}
          >
            {busy ? (
              <LoaderCircle className="spin" aria-hidden="true" />
            ) : (
              <Play aria-hidden="true" />
            )}
            {busy ? "Creating audit" : "Run reviewed audit"}
          </button>
          {readinessBlocked && (
            <p className="ledger-blocker">
              Complete the task intent, success text, and every reviewed step
              before running.
            </p>
          )}
          <p className="ledger-note">
            This run observes one configured path. Manual screen-reader review
            remains required.
          </p>
        </aside>
      </form>
    </main>
  );
}

function ConnectionNotice({
  connection,
  stale,
}: {
  connection: ConnectionState;
  stale: boolean;
}) {
  if (connection === "connected" && !stale) {
    return null;
  }
  return (
    <div
      className="connection-notice"
      role="status"
      aria-live="polite"
      data-state={connection}
    >
      {connection === "reconnecting" || connection === "connecting" ? (
        <RefreshCw className="spin" aria-hidden="true" />
      ) : (
        <WifiOff aria-hidden="true" />
      )}
      <span>
        {stale
          ? "Evidence may be stale while the event stream reconnects."
          : connection === "disconnected"
            ? "Live updates disconnected. Persisted evidence remains available."
            : "Connecting to persisted audit events."}
      </span>
    </div>
  );
}

function deriveLiveSteps(
  session: AuditSession,
  events: AccessPathEvent<Record<string, unknown>>[],
  bundle?: AuditBundle,
): Array<{
  id: string;
  intent: string;
  state: string;
  result?: TaskStepResult;
}> {
  const results = new Map<string, TaskStepResult>();
  const running = new Set<string>();
  for (const event of events) {
    if (
      event.type === "audit.step.started" &&
      typeof event.payload.instructionId === "string"
    ) {
      running.add(event.payload.instructionId);
    }
    if (event.type === "audit.step.completed") {
      const step = event.payload.step as TaskStepResult | undefined;
      if (step?.instructionId !== undefined) {
        results.set(step.instructionId, step);
        running.delete(step.instructionId);
      }
    }
  }
  for (const result of bundle?.steps ?? []) {
    results.set(result.instructionId, result);
  }
  return session.task.expectedSteps.map((instruction) => ({
    id: instruction.id,
    intent: instruction.intent,
    state:
      results.get(instruction.id)?.state ??
      (running.has(instruction.id) ? "running" : "queued"),
    result: results.get(instruction.id),
  }));
}

function useArtifactUrl(
  artifact: ArtifactRef | undefined,
  sessionId: string,
): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (artifact === undefined) {
      setUrl(undefined);
      return;
    }
    let active = true;
    let objectUrl: string | undefined;
    void fetchArtifactUrl(artifact.id, sessionId)
      .then((nextUrl) => {
        if (active) {
          objectUrl = nextUrl;
          setUrl(nextUrl);
        } else {
          URL.revokeObjectURL(nextUrl);
        }
      })
      .catch(() => setUrl(undefined));
    return () => {
      active = false;
      if (objectUrl !== undefined) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [artifact, sessionId]);
  return url;
}

function EvidenceStage({
  step,
  findings,
  sessionId,
  mobileVisible,
}: {
  step?: TaskStepResult;
  findings: Finding[];
  sessionId: string;
  mobileVisible: boolean;
}) {
  const screenshot = step?.evidence.find((item) => item.kind === "screenshot");
  const imageUrl = useArtifactUrl(screenshot, sessionId);
  return (
    <section
      className="evidence-stage"
      aria-labelledby="evidence-heading"
      data-mobile-visible={mobileVisible}
      tabIndex={0}
    >
      <header>
        <div>
          <p className="eyebrow">Selected evidence</p>
          <h2 id="evidence-heading">{step?.intent ?? "Waiting for first checkpoint"}</h2>
        </div>
        {step !== undefined && <StatusBadge state={step.state} />}
      </header>
      <div className="screenshot-frame">
        {imageUrl !== undefined && screenshot !== undefined ? (
          <img src={imageUrl} alt={screenshot.description} />
        ) : (
          <div className="stage-placeholder">
            <Search aria-hidden="true" />
            <strong>
              {step === undefined ? "Observing the reviewed task" : "Screenshot loading"}
            </strong>
            <span>Persisted evidence appears here at each checkpoint.</span>
            <div className="stage-skeleton" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}
        {findings.map((finding, index) => (
          <span
            key={finding.id}
            className="annotation-pin"
            style={{
              left: `${Math.min(82, 18 + index * 13)}%`,
              top: `${Math.min(76, 20 + index * 11)}%`,
            }}
            aria-label={`${finding.id}: ${finding.title}`}
          >
            {finding.id.replace("AP-", "")}
          </span>
        ))}
      </div>
      <dl className="evidence-facts">
        <div>
          <dt>Observed action</dt>
          <dd>{step?.attemptedAction ?? "No action completed yet"}</dd>
        </div>
        <div>
          <dt>Outcome</dt>
          <dd>{step?.observedOutcome ?? "The event stream is still active."}</dd>
        </div>
        <div>
          <dt>Focus</dt>
          <dd>{step?.focusedElement ?? "No focus snapshot yet"}</dd>
        </div>
      </dl>
    </section>
  );
}

function FindingsQueue({
  findings,
  selectedId,
  onSelect,
  mobileVisible,
}: {
  findings: Finding[];
  selectedId?: string;
  onSelect: (finding: Finding) => void;
  mobileVisible: boolean;
}) {
  return (
    <aside
      className="findings-queue"
      aria-labelledby="findings-heading"
      data-mobile-visible={mobileVisible}
    >
      <header>
        <div>
          <p className="eyebrow">Audit evidence</p>
          <h2 id="findings-heading">Affected actions</h2>
        </div>
        <span className="count-label">{findings.length}</span>
      </header>
      {findings.length === 0 ? (
        <div className="empty-state">
          <Activity aria-hidden="true" />
          <p>Findings appear as browser evidence is normalized.</p>
        </div>
      ) : (
        <ol>
          {findings.map((finding) => (
            <li key={finding.id}>
              <button
                type="button"
                aria-pressed={selectedId === finding.id}
                onClick={() => onSelect(finding)}
              >
                <span className="finding-id">{finding.id}</span>
                <strong>{finding.affectedAction}</strong>
                <span className="finding-meta">
                  <span data-severity={finding.severity}>
                    {finding.severity}
                  </span>
                  <span>{finding.evidenceLabel}</span>
                </span>
                <ChevronRight aria-hidden="true" />
              </button>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}

function LiveWorkspace({
  session,
  bundle,
  events,
  connection,
  busy,
  onPause,
  onResume,
  onCancel,
  onOpenMap,
}: {
  session: AuditSession;
  bundle?: AuditBundle;
  events: AccessPathEvent<Record<string, unknown>>[];
  connection: ConnectionState;
  busy: boolean;
  onPause: () => Promise<void>;
  onResume: () => Promise<void>;
  onCancel: () => Promise<void>;
  onOpenMap: (finding?: Finding) => void;
}) {
  const steps = useMemo(
    () => deriveLiveSteps(session, events, bundle),
    [session, events, bundle],
  );
  const eventFindings = events
    .filter((event) => event.type === "finding.created")
    .map((event) => event.payload.finding as Finding)
    .filter((finding): finding is Finding => finding?.id !== undefined);
  const findings = bundle?.findings ?? eventFindings;
  const [selectedStepId, setSelectedStepId] = useState(
    steps.find((step) => step.state !== "queued")?.id ?? steps[0]?.id,
  );
  const [mobilePane, setMobilePane] = useState<
    "path" | "evidence" | "findings"
  >("evidence");
  const selectedStep =
    steps.find((step) => step.id === selectedStepId)?.result ??
    [...steps].reverse().find((step) => step.result !== undefined)?.result;
  const selectedFindings = findings.filter(
    (finding) => finding.stepId === selectedStep?.instructionId,
  );
  const stale =
    (connection === "disconnected" || connection === "reconnecting") &&
    !TERMINAL_STATES.has(session.state);

  return (
    <main id="main-content" className="live-page" tabIndex={-1}>
      <div className="live-commandbar">
        <div>
          <button
            type="button"
            className="back-button"
            onClick={() => navigate("/projects/demo/audits/new")}
          >
            <ArrowLeft aria-hidden="true" />
            Audits
          </button>
          <p className="route-breadcrumb">
            Emergency aid demo / {session.id}
          </p>
          <h1>Live audit workspace</h1>
        </div>
        <div className="command-actions">
          <StatusBadge
            state={session.state}
            label={statusCopy(session.state)}
          />
          <span className="connection-indicator" data-connection={connection}>
            {connection === "disconnected" ? (
              <WifiOff aria-hidden="true" />
            ) : (
              <Network aria-hidden="true" />
            )}
            {connection === "connected" ? "Companion connected" : connection}
          </span>
          {session.state === "running" && (
            <button type="button" onClick={() => void onPause()} disabled={busy}>
              <CirclePause aria-hidden="true" />
              Pause
            </button>
          )}
          {session.state === "paused" && (
            <button type="button" onClick={() => void onResume()} disabled={busy}>
              <Play aria-hidden="true" />
              Resume
            </button>
          )}
          {!TERMINAL_STATES.has(session.state) && (
            <button
              type="button"
              className="danger-command"
              onClick={() => void onCancel()}
              disabled={busy}
            >
              <CircleStop aria-hidden="true" />
              Cancel
            </button>
          )}
          {bundle !== undefined && (
            <button
              type="button"
              className="primary-inline-command"
              onClick={() => onOpenMap()}
            >
              <MapIcon aria-hidden="true" />
              Open Barrier Map
            </button>
          )}
        </div>
      </div>
      <ConnectionNotice connection={connection} stale={stale} />
      {(session.state === "blocked" ||
        session.state === "failed" ||
        session.state === "cancelled") && (
        <div
          className="terminal-notice"
          role="status"
          data-status={session.state}
        >
          <AlertTriangle aria-hidden="true" />
          <div>
            <strong>{statusCopy(session.state)} audit</strong>
            <p>
              {session.state === "blocked"
                ? "The reviewed path preserved its blocked action and downstream evidence. Open the Barrier Map to inspect and repair it."
                : "Captured steps and artifacts remain available. Start a new audit when the target is ready."}
            </p>
          </div>
        </div>
      )}
      <div className="mobile-pane-switcher" aria-label="Audit workspace view">
        {(["path", "evidence", "findings"] as const).map((pane) => (
          <button
            type="button"
            key={pane}
            aria-pressed={mobilePane === pane}
            onClick={() => setMobilePane(pane)}
          >
            {pane === "path"
              ? "Task path"
              : pane === "evidence"
                ? "Evidence"
                : `Findings ${findings.length}`}
          </button>
        ))}
      </div>
      <div className="live-workspace">
        <nav
          className="path-rail"
          aria-label="Reviewed task path"
          data-mobile-visible={mobilePane === "path"}
        >
          <div className="pane-heading">
            <p className="eyebrow">Chronological actions</p>
            <h2>Task path</h2>
          </div>
          <ol>
            {steps.map((step, index) => (
              <li key={step.id}>
                <button
                  type="button"
                  aria-current={selectedStepId === step.id ? "step" : undefined}
                  onClick={() => {
                    setSelectedStepId(step.id);
                    setMobilePane("evidence");
                  }}
                >
                  <span className="path-index">{index + 1}</span>
                  <span>
                    <strong>{step.intent}</strong>
                    <small>{step.state}</small>
                  </span>
                  {step.state === "passed" ? (
                    <Check aria-label="Passed" />
                  ) : step.state === "blocked" ? (
                    <AlertTriangle aria-label="Blocked" />
                  ) : step.state === "running" ? (
                    <LoaderCircle className="spin" aria-label="Running" />
                  ) : (
                    <span className="queued-dot" aria-label="Queued" />
                  )}
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <EvidenceStage
          step={selectedStep}
          findings={selectedFindings}
          sessionId={session.id}
          mobileVisible={mobilePane === "evidence"}
        />
        <FindingsQueue
          findings={findings}
          onSelect={(finding) => onOpenMap(finding)}
          mobileVisible={mobilePane === "findings"}
        />
      </div>
    </main>
  );
}

function FindingDetail({
  finding,
  onClose,
}: {
  finding: Finding;
  onClose: () => void;
}) {
  return (
    <aside className="finding-detail" aria-labelledby="finding-detail-heading">
      <header>
        <div>
          <span className="finding-id">{finding.id}</span>
          <h2 id="finding-detail-heading">{finding.affectedAction}</h2>
        </div>
        <IconButton label="Close finding detail" onClick={onClose}>
          <X aria-hidden="true" />
        </IconButton>
      </header>
      <div className="detail-section">
        <h3>Observed</h3>
        <p>{finding.observation}</p>
        <p className="source-label">
          {finding.evidenceLabel} / {finding.source}
        </p>
      </div>
      <div className="detail-section">
        <h3>Deterministic checks</h3>
        {finding.deterministicChecks === undefined ||
        finding.deterministicChecks.length === 0 ? (
          <p>No structured deterministic check was recorded.</p>
        ) : (
          <ul>
            {finding.deterministicChecks.map((check) => (
              <li key={check}>{check}</li>
            ))}
          </ul>
        )}
        <dl>
          <div><dt>Severity</dt><dd>{finding.severity}</dd></div>
          <div><dt>Modalities</dt><dd>{finding.modality.join(", ")}</dd></div>
          <div><dt>WCAG references</dt><dd>{finding.wcagRefs.join(", ") || "None"}</dd></div>
        </dl>
      </div>
      <div className="detail-section">
        <h3>Reproduction</h3>
        <ol>
          {finding.reproduction.map((step) => <li key={step}>{step}</li>)}
        </ol>
      </div>
      {finding.diagnosis !== undefined && (
        <div className="detail-section inference">
          <h3>Inferred diagnosis</h3>
          <p>{finding.diagnosis}</p>
        </div>
      )}
      {finding.remediationGuidance !== undefined && (
        <div className="detail-section">
          <h3>Guidance</h3>
          <p>{finding.remediationGuidance}</p>
        </div>
      )}
      <div className="detail-section">
        <h3>Manual review</h3>
        {finding.manualReview.length === 0 ? (
          <p>No additional manual check was attached to this finding.</p>
        ) : (
          <ul>
            {finding.manualReview.map((item) => <li key={item}>{item}</li>)}
          </ul>
        )}
      </div>
    </aside>
  );
}

function BarrierMapView({
  bundle,
  initialFindingId,
  onBack,
  onCreateRepair,
}: {
  bundle: AuditBundle;
  initialFindingId?: string;
  onBack: () => void;
  onCreateRepair: (
    repositoryPath: string,
    finding: Finding,
  ) => Promise<void>;
}) {
  const [mode, setMode] = useState<BarrierMapMode>("journey");
  const [selectedFindingId, setSelectedFindingId] = useState(initialFindingId);
  const [representation, setRepresentation] = useState<"map" | "linear">(() =>
    window.matchMedia("(max-width: 1023px)").matches ? "linear" : "map",
  );
  const [repositoryPath, setRepositoryPath] = useState("");
  const [repairBusy, setRepairBusy] = useState(false);
  const [repairError, setRepairError] = useState<string>();
  const presentation = useMemo(
    () => buildBarrierPresentation(bundle, mode),
    [bundle, mode],
  );
  const selectedFinding = bundle.findings.find(
    (finding) => finding.id === selectedFindingId,
  );

  return (
    <main id="main-content" className="barrier-page" tabIndex={-1}>
      <div className="barrier-header">
        <div>
          <button type="button" className="back-button" onClick={onBack}>
            <ArrowLeft aria-hidden="true" />
            Live audit
          </button>
          <p className="route-breadcrumb">
            Emergency aid demo / Audit evidence
          </p>
          <h1>Barrier Map</h1>
          <p>
            Human actions, attempted transitions, and the evidence attached to
            each observed barrier.
          </p>
        </div>
        <div className="export-menu" aria-label="Evidence exports">
          <button type="button" onClick={() => void downloadReport(bundle.auditSessionId, "markdown")}>
            <FileText aria-hidden="true" />
            Markdown
          </button>
          <button type="button" onClick={() => void downloadReport(bundle.auditSessionId, "html")}>
            <Link2 aria-hidden="true" />
            HTML
          </button>
          <button type="button" onClick={() => void downloadReport(bundle.auditSessionId, "json")}>
            <FileJson aria-hidden="true" />
            JSON
          </button>
        </div>
      </div>

      <div className="map-toolbar">
        <fieldset className="segmented-field compact">
          <legend>Barrier Map mode</legend>
          {(["journey", "impact", "repair", "compare"] as const).map((item) => (
            <label key={item}>
              <input
                type="radio"
                name="map-mode"
                checked={mode === item}
                onChange={() => setMode(item)}
              />
              {item}
            </label>
          ))}
        </fieldset>
        <div className="view-switcher" aria-label="Representation">
          <button
            type="button"
            aria-pressed={representation === "map"}
            onClick={() => setRepresentation("map")}
          >
            <BarChart3 aria-hidden="true" />
            Map
          </button>
          <button
            type="button"
            aria-pressed={representation === "linear"}
            onClick={() => setRepresentation("linear")}
          >
            <LayoutList aria-hidden="true" />
            Linear
          </button>
        </div>
      </div>

      {mode === "repair" && (
        <div className="mode-notice" role="status">
          <ClipboardCheck aria-hidden="true" />
          <span>Select AP-001, attach the local fixture repository, and prepare an isolated repair.</span>
        </div>
      )}
      {mode === "repair" && selectedFinding?.id === "AP-001" && (
        <form
          className="repository-attach"
          onSubmit={(event) => {
            event.preventDefault();
            setRepairBusy(true);
            setRepairError(undefined);
            void onCreateRepair(repositoryPath, selectedFinding)
              .catch((nextError) =>
                setRepairError(
                  nextError instanceof Error
                    ? nextError.message
                    : "The repository could not be attached.",
                ),
              )
              .finally(() => setRepairBusy(false));
          }}
        >
          <div>
            <label htmlFor="repair-repository-path">Local fixture repository</label>
            <input
              id="repair-repository-path"
              type="text"
              value={repositoryPath}
              onChange={(event) => setRepositoryPath(event.target.value)}
              placeholder="Path ending in apps/demo-aid-app"
              required
            />
            <p>AccessPath resolves the real Git root and keeps all edits in an external worktree.</p>
          </div>
          <button type="submit" disabled={repairBusy}>
            {repairBusy ? (
              <LoaderCircle className="spin" aria-hidden="true" />
            ) : (
              <ClipboardCheck aria-hidden="true" />
            )}
            Attach and create repair
          </button>
          {repairError !== undefined && (
            <p className="field-error" role="alert">{repairError}</p>
          )}
        </form>
      )}
      {mode === "compare" && (
        <div className="mode-notice" role="status">
          <RefreshCw aria-hidden="true" />
          <span>Before evidence is available. After evidence appears only after verified replay.</span>
        </div>
      )}

      <div className="map-layout">
        <section className="map-stage" aria-labelledby="map-heading">
          <h2 id="map-heading" className="visually-hidden">
            {representation === "map" ? "Barrier journey map" : "Linear task path"}
          </h2>
          {representation === "map" ? (
            <ol className="barrier-graph" data-mode={mode}>
              {presentation.map((item, index) => (
                <li key={item.stepId}>
                  <button
                    type="button"
                    className="graph-node"
                    data-state={item.state}
                    onClick={() => {
                      if (item.findings[0] !== undefined) {
                        setSelectedFindingId(item.findings[0].id);
                      }
                    }}
                  >
                    <span className="node-index">{index + 1}</span>
                    <strong>{item.label}</strong>
                    <span>{item.stateLabel}</span>
                    {item.findings.length > 0 && (
                      <span className="barrier-count">
                        {item.findings.length} {item.findings.length === 1 ? "barrier" : "barriers"}
                      </span>
                    )}
                  </button>
                  {index < presentation.length - 1 && (
                    <ChevronRight className="graph-edge" aria-hidden="true" />
                  )}
                </li>
              ))}
            </ol>
          ) : (
            <ol className="linear-path">
              {presentation.map((item, index) => (
                <li key={item.stepId}>
                  <div className="linear-step-heading">
                    <span>{index + 1}</span>
                    <div>
                      <h3>{item.label}</h3>
                      <p>{item.stateLabel}</p>
                    </div>
                  </div>
                  {item.findings.length === 0 ? (
                    <p className="no-finding">No finding attached to this action.</p>
                  ) : (
                    <ul>
                      {item.findings.map((finding) => (
                        <li key={finding.id}>
                          <button type="button" onClick={() => setSelectedFindingId(finding.id)}>
                            <span>{finding.id}</span>
                            <strong>{finding.title}</strong>
                            <span>{finding.severity}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>
        {selectedFinding !== undefined ? (
          <FindingDetail
            finding={selectedFinding}
            onClose={() => setSelectedFindingId(undefined)}
          />
        ) : (
          <aside className="finding-detail empty-state" aria-label="Finding detail">
            <MapIcon aria-hidden="true" />
            <h2>Select a barrier</h2>
            <p>Open an affected action to inspect observed evidence, inference, guidance, and manual review.</p>
          </aside>
        )}
      </div>
    </main>
  );
}

export function App() {
  const [view, setView] = useState<View>(() => inferView(window.location.pathname));
  const [session, setSession] = useState<AuditSession>();
  const [, setRepairSession] = useState<RepairSession>();
  const [bundle, setBundle] = useState<AuditBundle>();
  const [events, setEvents] = useState<AccessPathEvent<Record<string, unknown>>[]>([]);
  const [connection, setConnection] = useState<ConnectionState>("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialFindingId, setInitialFindingId] = useState<string>();
  const [demoAidAppPort, setDemoAidAppPort] = useState<number>();
  const lastEventId = useRef<string | undefined>(undefined);

  useEffect(() => {
    setConnection("connecting");
    void getPublicConfig()
      .then((config) => {
        setDemoAidAppPort(config.demoAidAppPort);
        setConnection("connected");
        setError(null);
      })
      .catch((nextError) => {
        setConnection("disconnected");
        setError(
          nextError instanceof Error
            ? nextError.message
            : "The local companion is unavailable.",
        );
      });
  }, []);

  useEffect(() => {
    const onPopState = () => setView(inferView(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const refreshBundle = useCallback(async (auditId: string) => {
    try {
      const nextBundle = await getAuditBundle(auditId);
      setBundle(nextBundle);
    } catch (nextError) {
      if (!(nextError instanceof ApiError) || nextError.status !== 404) {
        throw nextError;
      }
    }
  }, []);

  useEffect(() => {
    const routeAuditId = auditIdFromPath(window.location.pathname);
    if (routeAuditId === undefined || session?.id === routeAuditId) {
      return;
    }
    let active = true;
    setBusy(true);
    void getAudit(routeAuditId)
      .then(async (nextSession) => {
        if (!active) {
          return;
        }
        setSession(nextSession);
        if (
          inferView(window.location.pathname) === "barrier-map" ||
          TERMINAL_STATES.has(nextSession.state)
        ) {
          await refreshBundle(routeAuditId);
        }
      })
      .catch((nextError) => {
        if (active) {
          setError(
            nextError instanceof Error
              ? nextError.message
              : "The persisted audit could not be loaded.",
          );
        }
      })
      .finally(() => {
        if (active) {
          setBusy(false);
        }
      });
    return () => {
      active = false;
    };
  }, [view, session?.id, refreshBundle]);

  useEffect(() => {
    if (session === undefined || TERMINAL_STATES.has(session.state)) {
      return;
    }
    const controller = new AbortController();
    let reconnectTimer: number | undefined;
    const connect = async () => {
      setConnection((current) =>
        current === "connected" ? "reconnecting" : "connecting",
      );
      try {
        await streamAuditEvents(
          session.id,
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
            if (
              event.type === "session.completed" ||
              event.type === "session.failed" ||
              event.type === "session.cancelled"
            ) {
              void getAudit(session.id).then(setSession);
              void refreshBundle(session.id);
            }
          },
          controller.signal,
        );
        const latest = await getAudit(session.id);
        setSession(latest);
        setError(null);
        if (TERMINAL_STATES.has(latest.state)) {
          await refreshBundle(session.id);
        } else {
          throw new ApiError(502, "The event stream closed before the audit finished.");
        }
      } catch (nextError) {
        if (controller.signal.aborted) {
          return;
        }
        setConnection("disconnected");
        setError(
          nextError instanceof Error
            ? nextError.message
            : "The event stream disconnected.",
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
  }, [session?.id, session?.state, refreshBundle]);

  const run = async (task: TaskContract) => {
    setBusy(true);
    setError(null);
    setBundle(undefined);
    setEvents([]);
    lastEventId.current = undefined;
    try {
      const created = await createAudit(task);
      setSession(created);
      const started = await startAudit(created.id);
      setSession(started);
      navigate(`/audits/${created.id}/live`);
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Audit creation failed.",
      );
    } finally {
      setBusy(false);
    }
  };

  const transition = async (
    action: (id: string) => Promise<AuditSession>,
  ) => {
    if (session === undefined) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setSession(await action(session.id));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Audit action failed.");
    } finally {
      setBusy(false);
    }
  };

  const openMap = (finding?: Finding) => {
    if (session === undefined) {
      return;
    }
    setInitialFindingId(finding?.id);
    navigate(`/audits/${session.id}/barrier-map`);
  };

  const createRepairFromFinding = async (
    repositoryPath: string,
    finding: Finding,
  ) => {
    if (bundle === undefined || demoAidAppPort === undefined) {
      throw new Error("The persisted audit and local fixture configuration are required.");
    }
    if (finding.id !== "AP-001") {
      throw new Error("The MVP repair path is intentionally limited to AP-001.");
    }
    const validation = await validateRepository(repositoryPath);
    const previewPort =
      demoAidAppPort >= 65_535 ? 4_175 : demoAidAppPort + 1;
    const startCommand: RepositoryConfig["startCommand"] = {
      id: "preview-emergency-aid",
      label: "Start repaired emergency-aid preview",
      executable: "node",
      args: ["apps/demo-aid-app/scripts/start-preview.mjs"],
      cwdRelative: ".",
      timeoutMs: 120_000,
      category: "start",
    };
    const testCommand: RepositoryConfig["testCommands"][number] = {
      id: "verify-ap-001",
      label: "Verify AP-001 native radio repair",
      executable: "node",
      args: ["apps/demo-aid-app/tests/ap001-repair.mjs"],
      cwdRelative: ".",
      timeoutMs: 30_000,
      category: "test",
    };
    const repository: RepositoryConfig = {
      repositoryPath,
      baseBranch: validation.baseBranch,
      baseCommit: validation.baseCommit,
      startCommand,
      testCommands: [testCommand],
      previewUrl: `http://127.0.0.1:${previewPort}/`,
      allowedPathGlobs: ["apps/demo-aid-app/**"],
    };
    const evidenceRefs = bundle.artifacts.filter((artifact) =>
      finding.evidenceIds.includes(artifact.id),
    );
    const manifest: RepairManifest = {
      schemaVersion: "1.0.0",
      id: `manifest-${crypto.randomUUID()}`,
      auditBundleId: bundle.id,
      findingIds: [finding.id],
      affectedActions: [finding.affectedAction],
      observations: [finding.observation],
      evidenceRefs,
      constraints: [
        "Change only apps/demo-aid-app/** inside the isolated worktree.",
        "Keep AP-002 through AP-005 intentionally present.",
        "Use browser replay evidence to verify the selected task action.",
      ],
      nonGoals: [
        "Do not repair unrelated findings.",
        "Do not change the base checkout, Git remotes, or hosted infrastructure.",
      ],
      allowedPathGlobs: ["apps/demo-aid-app/**"],
      verification: {
        taskContract: bundle.task,
        commands: [testCommand],
      },
    };
    const repair = await createRepair(repository, manifest);
    setRepairSession(repair);
    navigate(`/repairs/${repair.id}`);
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <AppRail
        view={view}
        auditId={session?.id}
        repairId={repairIdFromPath(window.location.pathname)}
        connection={connection}
      />
      <div className="app-body">
        {error !== null && view !== "setup" && (
          <div className="global-alert" role="alert">
            <TriangleAlert aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}
        <div className="route-transition" key={view}>
          {view === "setup" && (
            <AuditSetup
              busy={busy}
              error={error}
              connection={connection}
              demoAidAppPort={demoAidAppPort}
              onRun={run}
            />
          )}
          {view === "live" && session !== undefined && (
            <LiveWorkspace
              session={session}
              bundle={bundle}
              events={events}
              connection={connection}
              busy={busy}
              onPause={() => transition(pauseAudit)}
              onResume={() => transition(resumeAudit)}
              onCancel={() => transition(cancelAudit)}
              onOpenMap={openMap}
            />
          )}
          {view === "live" && session === undefined && (
            <main
              id="main-content"
              className="empty-route route-loading"
              tabIndex={-1}
            >
              <div className="loading-mark" aria-hidden="true">
                <img src="/accesspath-mark.png" alt="" />
              </div>
              <h1>Loading audit</h1>
              <p>Reading the durable audit session and captured evidence.</p>
              <div className="loading-scaffold" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
            </main>
          )}
          {view === "barrier-map" && bundle !== undefined && (
            <BarrierMapView
              bundle={bundle}
              initialFindingId={initialFindingId}
              onBack={() => session !== undefined && navigate(`/audits/${session.id}/live`)}
              onCreateRepair={createRepairFromFinding}
            />
          )}
          {view === "barrier-map" && bundle === undefined && (
            <main id="main-content" className="empty-route" tabIndex={-1}>
              <MapIcon aria-hidden="true" />
              <h1>No persisted Barrier Map yet</h1>
              <p>Complete or partially complete an audit before opening this view.</p>
              <button type="button" onClick={() => navigate("/projects/demo/audits/new")}>
                <ArrowLeft aria-hidden="true" />
                Return to audit setup
              </button>
            </main>
          )}
          {view === "repair" &&
            repairIdFromPath(window.location.pathname) !== undefined && (
              <RepairWorkspace
                repairId={repairIdFromPath(window.location.pathname)!}
                onRepairChange={setRepairSession}
              />
            )}
        </div>
      </div>
      <div className="visually-hidden" aria-live="polite" aria-atomic="true">
        {view === "repair" || session === undefined
          ? ""
          : `Audit ${statusCopy(session.state)}.`}
      </div>
    </div>
  );
}
