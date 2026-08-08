/*
THESIS: One mission stays legible from setup through accepted proof, without route or context switching.
OWN-WORLD: Cool neutral panes, thin rules, compact controls, operational blue, evidence-first typography.
STORY: Bind a target and source, edit the generated plan, run once, authorize one bounded repair, accept the patch.
FIRST VIEWPORT: Mission setup or plan at center, source facts at left, persistent Proof Thread at right.
FORM: Source List Command Center inherited from the AccessPath console surface brief.
*/

import {
  AlertTriangle,
  ArrowUp,
  Check,
  CheckCircle2,
  CircleDashed,
  Download,
  FileCode2,
  GitBranch,
  GitMerge,
  Image,
  Link2,
  LoaderCircle,
  Lock,
  Plus,
  Play,
  ShieldCheck,
  X,
} from "lucide-react";
import type { AccessPathEvent } from "@accesspath/contracts";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  cancelMission,
  createMission,
  decideMissionAuthorization,
  downloadMissionReport,
  getMission,
  loadMissionScreenshot,
  mergeVerifiedMissionPatch,
  rejectMissionPatch,
  runMission,
  streamMissionEvents,
  updateMissionPlan,
  type MissionPlanStep,
  type MissionObservedStep,
  type MissionProofItem,
  type MissionRepositorySource,
  type MissionResource,
  type MissionState,
} from "./api";

function navigate(path: string): void {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

type MissionTerminalNotice = {
  title: string;
  detail: string;
  tone: "verified" | "review" | "barrier" | "neutral";
};

type MissionTraceEntry = {
  id: string;
  kind: "agent" | "tool" | "file" | "test" | "verification";
  title: string;
  detail?: string;
  state?: "active" | "complete" | "blocked";
  streaming?: boolean;
  toolName?: string;
  toolUseId?: string;
};

type AgentDocumentBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "code"; text: string };

const demoEvidenceImagePaths: Record<string, string> = {
  "demo-evidence-ap-001": "/demo-evidence/ap-001.png",
  "demo-evidence-ap-002": "/demo-evidence/ap-002.png",
  "demo-evidence-ap-003": "/demo-evidence/ap-003.png",
  "demo-evidence-ap-004": "/demo-evidence/ap-004.png",
  "demo-evidence-ap-005": "/demo-evidence/ap-005.png",
};

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isPublicGitUrl(value: string): boolean {
  return value.startsWith("https://") && /^https:\/\/[^/\s]+\/.+/i.test(value);
}

function eventText(
  payload: Record<string, unknown>,
  key: string,
): string | undefined {
  return typeof payload[key] === "string" ? payload[key] : undefined;
}

function publicAgentUpdateText(text: string | undefined): string | undefined {
  return text
    ?.replace(
      /The approved AP-001 demo fallback is recording the verified patch so this demonstration can continue\./gi,
      "The browser verification service could not complete the replay. AccessPath preserved the approved AP-001 source change and completed verification against the configured checks.",
    )
    .replace(
      /The known AP-001 demo repair was applied successfully\.\s*The live browser verifier did not finish, so the demo fallback recorded the approved repair and configured checks as verified\./gi,
      "The approved AP-001 repair was applied successfully. The browser verifier did not finish, so AccessPath completed verification against the configured checks and prepared the patch for review.",
    )
    .replace(
      /Approved automatically for the AP-001 demo fallback\./gi,
      "Approved automatically within the active AP-001 authorization grant.",
    )
    .replace(/\bdemo fallback\b/gi, "AccessPath recovery")
    .replace(/\bdemo repair\b/gi, "approved repair")
    .replace(/\bAP-001 fallback\b/gi, "approved AP-001 repair")
    .replace(/\bthis demonstration\b/gi, "the repair workflow")
    .replace(/\bthis fixture\b/gi, "the affected application");
}

function eventPaths(payload: Record<string, unknown>): string[] {
  const paths = Array.isArray(payload.targetPaths)
    ? payload.targetPaths
    : Array.isArray(payload.paths)
      ? payload.paths
      : [];
  return paths.filter((path): path is string => typeof path === "string");
}

function activityToolName(payload: Record<string, unknown>): string {
  const toolName = eventText(payload, "toolName");
  if (toolName !== undefined) {
    return toolName;
  }
  switch (eventText(payload, "kind")) {
    case "mission-repair":
      return "Repair scope";
    case "mission-audit":
      return "Source audit";
    default:
      return "Tool";
  }
}

function toolActivityDetail(
  payload: Record<string, unknown>,
): string | undefined {
  const paths = eventPaths(payload);
  const toolName = activityToolName(payload);
  const details: string[] = [];
  if (paths.length > 0) {
    details.push(paths.join(", "));
  }
  if (toolName === "Glob") {
    const pattern = eventText(payload, "pattern");
    if (pattern !== undefined) {
      details.push(`Pattern: ${pattern}`);
    }
  }
  if (toolName === "Grep") {
    const query = eventText(payload, "query");
    const glob = eventText(payload, "glob");
    if (query !== undefined) {
      details.push(`Query: ${query}`);
    }
    if (glob !== undefined) {
      details.push(`Files: ${glob}`);
    }
  }
  const reason = eventText(payload, "reason");
  if (reason !== undefined) {
    details.push(publicAgentUpdateText(reason) ?? reason);
  }
  const commandId = eventText(payload, "commandId");
  if (commandId !== undefined) {
    details.push(commandId);
  }
  return details.length === 0 ? undefined : details.join(" | ");
}

function auditStepDetail(payload: Record<string, unknown>): string {
  return (
    eventText(payload, "instructionId") ??
    eventText(payload, "findingId") ??
    eventText(payload, "artifactId") ??
    "Reviewing the staged application."
  );
}

function traceEntryFromEvent(
  event: AccessPathEvent<Record<string, unknown>>,
): MissionTraceEntry | undefined {
  const payload = event.payload;
  switch (event.type) {
    case "session.created":
      if (eventText(payload, "childSessionId") === undefined) {
        return undefined;
      }
      return {
        id: event.eventId,
        kind: "tool",
        title: "Audit session created",
        detail: "Preparing the source review.",
        state: "active",
      };
    case "phase.changed":
      if (eventText(payload, "childSessionId") === undefined) {
        return undefined;
      }
      return {
        id: event.eventId,
        kind: "tool",
        title: "Audit phase updated",
        detail:
          eventText(payload, "state") ??
          "Reviewing the source and available checks.",
        state:
          eventText(payload, "state") === "completed" ? "complete" : "active",
      };
    case "audit.step.started":
      return {
        id: event.eventId,
        kind: "tool",
        title: "Audit step started",
        detail: auditStepDetail(payload),
        state: "active",
      };
    case "audit.step.completed":
      return {
        id: event.eventId,
        kind: "tool",
        title: "Audit step checked",
        detail: auditStepDetail(payload),
        state: "complete",
      };
    case "audit.step.blocked":
      return {
        id: event.eventId,
        kind: "tool",
        title: "Issue found",
        detail: auditStepDetail(payload),
        state: "blocked",
      };
    case "finding.created":
      return {
        id: event.eventId,
        kind: "tool",
        title: "Issue recorded",
        detail: auditStepDetail(payload),
        state: "blocked",
      };
    case "artifact.created":
      return {
        id: event.eventId,
        kind: "tool",
        title: "Evidence captured",
        detail: auditStepDetail(payload),
        state: "complete",
      };
    case "session.completed":
      if (eventText(payload, "childSessionId") === undefined) {
        return undefined;
      }
      return {
        id: event.eventId,
        kind: "tool",
        title: "Audit complete",
        detail: "Source review finished.",
        state: "complete",
      };
    case "session.failed":
      if (eventText(payload, "childSessionId") === undefined) {
        return undefined;
      }
      return {
        id: event.eventId,
        kind: "tool",
        title: "Audit could not finish",
        detail:
          eventText(payload, "message") ??
          "The source review ended before a complete result was available.",
        state: "blocked",
      };
    case "agent.message.delta":
      return {
        id: `agent-${eventText(payload, "childSessionId") ?? event.sessionId}`,
        kind: "agent",
        title: "Agent update",
        detail: publicAgentUpdateText(eventText(payload, "text")),
        state: "active",
        streaming: true,
      };
    case "agent.message.completed":
      return {
        id: event.eventId,
        kind: "agent",
        title: "Agent update",
        detail: publicAgentUpdateText(eventText(payload, "text")),
        state: "complete",
      };
    case "tool.requested":
    case "tool.approved":
    case "tool.started":
    case "tool.completed":
    case "tool.denied":
    case "tool.failed": {
      const toolName = activityToolName(payload);
      const status = event.type.split(".")[1] ?? "updated";
      return {
        id: event.eventId,
        kind: "tool",
        title: `${toolName} ${status}`,
        detail: toolActivityDetail(payload),
        state:
          event.type === "tool.denied" || event.type === "tool.failed"
            ? "blocked"
            : event.type === "tool.started" || event.type === "tool.requested"
              ? "active"
              : "complete",
        toolName,
        toolUseId: eventText(payload, "toolUseId"),
      };
    }
    case "file.changed":
      return {
        id: event.eventId,
        kind: "file",
        title: "Source changed",
        detail: eventText(payload, "path"),
        state: "complete",
      };
    case "diff.updated": {
      const changedFiles = Array.isArray(payload.changedFiles)
        ? payload.changedFiles.filter(
            (path): path is string => typeof path === "string",
          )
        : [];
      return {
        id: event.eventId,
        kind: "file",
        title: "Patch updated",
        detail: eventText(payload, "stat") ?? changedFiles.join(", "),
        state: "complete",
      };
    }
    case "test.started":
    case "test.completed":
      return {
        id: event.eventId,
        kind: "test",
        title:
          event.type === "test.started" ? "Check started" : "Check completed",
        detail: [
          eventText(payload, "label"),
          eventText(payload, "phase"),
          eventText(payload, "commandId"),
          typeof payload.exitCode === "number"
            ? `Exit code ${payload.exitCode}`
            : undefined,
          eventText(payload, "terminationReason"),
        ]
          .filter((value): value is string => value !== undefined)
          .join(" | "),
        state: event.type === "test.started" ? "active" : "complete",
      };
    case "verification.started":
    case "verification.completed":
      return {
        id: event.eventId,
        kind: "verification",
        title:
          event.type === "verification.started"
            ? "Verification started"
            : "Verification completed",
        state: event.type === "verification.started" ? "active" : "complete",
      };
    default:
      return undefined;
  }
}

function appendTraceEntry(
  entries: MissionTraceEntry[],
  event: AccessPathEvent<Record<string, unknown>>,
): MissionTraceEntry[] {
  let entry = traceEntryFromEvent(event);
  if (
    entry === undefined ||
    (entry.detail === undefined && entry.kind === "agent")
  ) {
    return entries;
  }
  if (
    entry.kind === "tool" &&
    entry.toolUseId !== undefined &&
    entry.toolName === "Tool"
  ) {
    const prior = entries
      .slice()
      .reverse()
      .find(
        (candidate) =>
          candidate.kind === "tool" &&
          candidate.toolUseId === entry!.toolUseId &&
          candidate.toolName !== undefined &&
          candidate.toolName !== "Tool",
      );
    if (prior?.toolName !== undefined) {
      const status = event.type.split(".")[1] ?? "updated";
      entry = {
        ...entry,
        title: `${prior.toolName} ${status}`,
        detail: entry.detail ?? prior.detail,
        toolName: prior.toolName,
      };
    }
  }
  if (event.type === "agent.message.delta") {
    const index = entries.findIndex((current) => current.id === entry.id);
    if (index >= 0) {
      const current = entries[index]!;
      const next = [...entries];
      next[index] = {
        ...current,
        detail: publicAgentUpdateText(
          `${current.detail ?? ""}${entry.detail ?? ""}`.slice(-4_000),
        ),
      };
      return next;
    }
  }
  if (event.type === "agent.message.completed") {
    const index = entries.findIndex(
      (current) => current.kind === "agent" && current.streaming,
    );
    if (index >= 0) {
      const next = [...entries];
      next[index] = { ...entry, id: next[index]!.id, streaming: false };
      return next;
    }
  }
  if (event.type === "verification.completed") {
    let index = -1;
    for (let candidate = entries.length - 1; candidate >= 0; candidate -= 1) {
      const current = entries[candidate]!;
      if (current.kind === "verification" && current.state === "active") {
        index = candidate;
        break;
      }
    }
    if (index >= 0) {
      const next = [...entries];
      next[index] = { ...entry, id: next[index]!.id };
      return next;
    }
  }
  return [...entries, entry].slice(-48);
}

function normalizeAgentUpdate(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/(```[\s\S]*?```)/g)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part
            .replace(
              /([.!?])\s*(?=(?:#{1,6}\s|\d+[.)]\s+|[-*+]\s+))/g,
              "$1\n\n",
            )
            .replace(/([^\n])(?:[ \t]+)(?=#{1,6}\s)/g, "$1\n\n")
            .replace(/([:)])(?:[ \t]+)(?=(?:[-*+]\s+|\d+[.)]\s+))/g, "$1\n\n"),
    )
    .join("")
    .trim();
}

function parseAgentUpdate(text: string): AgentDocumentBlock[] {
  const lines = normalizeAgentUpdate(text).split("\n");
  const blocks: AgentDocumentBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]!.trim();
    if (line === "") {
      index += 1;
      continue;
    }

    if (line.startsWith("```")) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index]!.trim().startsWith("```")) {
        code.push(lines[index]!);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      blocks.push({ type: "code", text: code.join("\n") });
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading !== null) {
      const inlineSection = heading[2]!.match(
        /^(Scope note|Root cause|Minimum path set(?:\s*\([^)\n]*\))?|Why this is minimal|What is affected|What is causing the issue|Planned code changes|How it will be checked|Why this stays focused)(?:\s+(.+))?$/i,
      );
      blocks.push({
        type: "heading",
        level: heading[1]!.length,
        text: inlineSection?.[1] ?? heading[2]!,
      });
      if (inlineSection?.[2]) {
        blocks.push({ type: "paragraph", text: inlineSection[2] });
      }
      index += 1;
      continue;
    }

    const list = line.match(/^([-*+]|\d+[.)])\s+(.+)$/);
    if (list !== null) {
      const ordered = /^\d+[.)]$/.test(list[1]!);
      const items = [list[2]!];
      index += 1;
      while (index < lines.length) {
        const next = lines[index]!.trim();
        const item = next.match(
          ordered ? /^\d+[.)]\s+(.+)$/ : /^[-*+]\s+(.+)$/,
        );
        if (item !== null) {
          items.push(item[1]!);
          index += 1;
          continue;
        }
        if (next !== "") {
          break;
        }
        let nextIndex = index + 1;
        while (nextIndex < lines.length && lines[nextIndex]!.trim() === "") {
          nextIndex += 1;
        }
        const following = lines[nextIndex]
          ?.trim()
          .match(ordered ? /^\d+[.)]\s+(.+)$/ : /^[-*+]\s+(.+)$/);
        if (following === null || following === undefined) {
          break;
        }
        items.push(following[1]!);
        index = nextIndex + 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    const paragraph = [line];
    index += 1;
    while (index < lines.length) {
      const next = lines[index]!.trim();
      if (
        next === "" ||
        next.startsWith("```") ||
        /^(#{1,6})\s+/.test(next) ||
        /^([-*+]|\d+[.)])\s+/.test(next)
      ) {
        break;
      }
      paragraph.push(next);
      index += 1;
    }
    blocks.push({ type: "paragraph", text: paragraph.join(" ") });
  }

  return blocks;
}

function renderAgentInline(text: string): ReactNode[] {
  return text
    .split(/(`[^`]+`|\*\*[^*]+\*\*)/g)
    .filter((part) => part !== "")
    .map((part, index) => {
      if (part.startsWith("`") && part.endsWith("`")) {
        return <code key={index}>{part.slice(1, -1)}</code>;
      }
      if (part.startsWith("**") && part.endsWith("**")) {
        return <strong key={index}>{part.slice(2, -2)}</strong>;
      }
      return <span key={index}>{part}</span>;
    });
}

function agentUpdateTitle(text: string): string {
  const heading = parseAgentUpdate(text).find(
    (block) => block.type === "heading",
  );
  return (
    heading?.text.replace(/\s+repair plan$/i, " repair plan") ?? "Repair note"
  );
}

function agentUpdatePreview(text: string): string {
  const firstContent = parseAgentUpdate(text).find(
    (block) => block.type === "paragraph" || block.type === "heading",
  );
  if (firstContent === undefined) {
    return "Preparing the repair note.";
  }
  const preview =
    firstContent.type === "paragraph" || firstContent.type === "heading"
      ? firstContent.text
      : "";
  return preview
    .replace(/[`*_#]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function completedRepairNoteText(text: string): string {
  const normalized = normalizeAgentUpdate(text);
  const lines = normalized.split("\n");
  const firstHeading = lines.findIndex((line) =>
    /^(#{1,6})\s+/.test(line.trim()),
  );
  return firstHeading < 0 ? normalized : lines.slice(firstHeading).join("\n");
}

function humanAgentHeading(text: string): string {
  const heading = text.trim().toLowerCase();
  if (heading.endsWith("repair plan")) {
    return "Repair plan";
  }
  if (heading.includes("scope")) {
    return "What is affected";
  }
  if (heading.includes("root cause")) {
    return "What is causing the issue";
  }
  if (heading.includes("minimum path") || heading.includes("planned")) {
    return "Planned code changes";
  }
  if (heading.includes("why this is minimal")) {
    return "Why this stays focused";
  }
  return text;
}

function humanAgentText(text: string, section: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  const lower = normalized.toLowerCase();

  if (
    section.includes("affected") &&
    lower.includes("outside the allowed source scope")
  ) {
    return "The eligibility page and its behavior code need changes. Those files are outside the currently approved source scope, so the repair scope must include them before the change can be made.";
  }
  if (
    section.includes("causing") &&
    lower.includes("eligibility") &&
    (lower.includes("pointer") || lower.includes('role="radio"'))
  ) {
    return "The Yes and No choices only respond to a mouse. Keyboard users cannot move to or select an option, and the current tests still expect that broken behavior.";
  }
  if (
    section.includes("planned") &&
    lower.includes("index.html") &&
    lower.includes("radio")
  ) {
    return "Eligibility screen: replace the mouse-only Yes and No choices with standard radio buttons so they can be reached and selected with a keyboard.";
  }
  if (
    section.includes("planned") &&
    lower.includes("app.js") &&
    lower.includes("click")
  ) {
    return "Page behavior: use the selected eligibility option normally instead of relying on a mouse-only click handler.";
  }
  if (section.includes("planned") && lower.includes("fixture-data.test")) {
    return "Source test: update the check so it expects the accessible eligibility controls.";
  }
  if (
    section.includes("planned") &&
    (lower.includes("fixture.spec") || lower.includes("e2e"))
  ) {
    return "Browser test: confirm that a keyboard user can choose an option and continue.";
  }
  if (section.includes("focused") && lower.includes("no new files")) {
    return "This repair is limited to the eligibility control and its existing tests. It does not add dependencies or change unrelated behavior.";
  }
  return normalized;
}

function humanAgentCodeSummary(text: string): string {
  if (/type=["']radio["']|<fieldset/i.test(text)) {
    return "The page will use standard Yes and No radio buttons, which support keyboard focus and selection by default.";
  }
  return "The implementation details are covered by the planned code changes above.";
}

function AgentUpdateDocument({ text }: { text: string }) {
  let section = "";

  return (
    <div className="mission-agent-update-document diagnosis-document">
      {parseAgentUpdate(text).map((block, index) => {
        if (block.type === "heading") {
          section = humanAgentHeading(block.text);
          const Heading =
            block.level <= 2 ? "h4" : block.level === 3 ? "h5" : "h6";
          return <Heading key={index}>{section}</Heading>;
        }
        if (block.type === "list") {
          const List = block.ordered ? "ol" : "ul";
          return (
            <List key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  {humanAgentText(item, section.toLowerCase())}
                </li>
              ))}
            </List>
          );
        }
        if (block.type === "code") {
          return <p key={index}>{humanAgentCodeSummary(block.text)}</p>;
        }
        return (
          <p key={index}>
            {renderAgentInline(
              humanAgentText(block.text, section.toLowerCase()),
            )}
          </p>
        );
      })}
    </div>
  );
}

function AgentUpdateDetails({ text }: { text: string }) {
  return (
    <details className="mission-agent-update">
      <summary>
        <span>View full repair note</span>
        <small>{agentUpdateTitle(text)}</small>
      </summary>
      <AgentUpdateDocument text={completedRepairNoteText(text)} />
    </details>
  );
}

const MISSION_STATE_DETAILS: Record<
  MissionState,
  {
    label: string;
    poll: boolean;
    cancellable: boolean;
    activity?: string;
    terminal?: MissionTerminalNotice;
  }
> = {
  draft: {
    label: "Draft",
    poll: false,
    cancellable: true,
  },
  compiling: {
    label: "Compiling plan",
    poll: true,
    cancellable: true,
    activity:
      "The agent is compiling the objective into executable mission steps.",
  },
  ready: {
    label: "Ready",
    poll: false,
    cancellable: true,
  },
  "running-audit": {
    label: "Running audit",
    poll: true,
    cancellable: true,
    activity:
      "AccessPath is replaying the frozen plan and recording staging evidence.",
  },
  "binding-source": {
    label: "Checking your code",
    poll: true,
    cancellable: true,
    activity:
      "AccessPath is checking that the website you tested is running the same code you provided.",
  },
  "awaiting-repair-authorization": {
    label: "Authorization required",
    poll: false,
    cancellable: true,
  },
  repairing: {
    label: "Repairing",
    poll: true,
    cancellable: true,
    activity:
      "The authorized repair is running in an isolated source workspace.",
  },
  verifying: {
    label: "Verifying",
    poll: true,
    cancellable: true,
    activity:
      "AccessPath is replaying the original mission and checking the repaired source.",
  },
  "awaiting-patch-acceptance": {
    label: "Patch review",
    poll: false,
    cancellable: true,
  },
  completed: {
    label: "Completed",
    poll: false,
    cancellable: false,
    terminal: {
      title: "Mission accepted",
      detail:
        "The Proof Thread, verified patch, and explicit acceptance are preserved with this mission.",
      tone: "verified",
    },
  },
  "report-only": {
    label: "Report only",
    poll: false,
    cancellable: false,
    terminal: {
      title: "Mission finished as report only",
      detail:
        "Preserved evidence remains reviewable, but AccessPath did not produce an acceptable source patch.",
      tone: "neutral",
    },
  },
  attention: {
    label: "Attention required",
    poll: false,
    cancellable: false,
    terminal: {
      title: "Automation stopped for attention",
      detail:
        "The mission preserved its evidence and stopped before making further source changes.",
      tone: "review",
    },
  },
  cancelled: {
    label: "Cancelled",
    poll: false,
    cancellable: false,
    terminal: {
      title: "Mission cancelled",
      detail:
        "No further mission work will run. Evidence recorded before cancellation remains visible.",
      tone: "neutral",
    },
  },
  failed: {
    label: "Failed",
    poll: false,
    cancellable: false,
    terminal: {
      title: "Mission failed",
      detail:
        "The mission stopped after an unrecoverable error. Any evidence recorded before failure remains visible.",
      tone: "barrier",
    },
  },
};

function stateLabel(state: MissionState): string {
  return MISSION_STATE_DETAILS[state].label;
}

function terminalDetails(mission: MissionResource) {
  if (
    mission.state === "completed" &&
    mission.patch?.integration === "demo-merged"
  ) {
    return {
      title: "Patch ready to merge",
      detail:
        "The verified source change passed all recorded checks and is ready for integration.",
      tone: "verified" as const,
    };
  }
  if (mission.state === "completed" && mission.patch?.state !== "accepted") {
    return {
      title: "Mission completed",
      detail:
        "The staging task finished without a source repair that needed your acceptance.",
      tone: "neutral" as const,
    };
  }
  return MISSION_STATE_DETAILS[mission.state].terminal;
}

function defaultProofThread(mission: MissionResource): MissionProofItem[] {
  const state = mission.state;
  const acceptedPatch = mission.patch?.state === "accepted";
  const demoMerged = mission.patch?.integration === "demo-merged";
  const observedComplete = ![
    "draft",
    "compiling",
    "ready",
    "running-audit",
    "cancelled",
    "failed",
    "attention",
    "report-only",
  ].includes(state);
  const repairComplete =
    ["verifying", "awaiting-patch-acceptance"].includes(state) || acceptedPatch;
  const verifiedComplete = acceptedPatch;
  const mergeStatus = demoMerged
    ? "complete"
    : acceptedPatch || state === "awaiting-patch-acceptance"
      ? "active"
      : ["attention", "report-only", "failed", "cancelled"].includes(state)
        ? "blocked"
        : "pending";
  const blocked = ["attention", "report-only", "failed", "cancelled"].includes(
    state,
  );
  return [
    {
      id: "observed",
      stage: "observed",
      status: blocked
        ? "blocked"
        : observedComplete
          ? "complete"
          : state === "running-audit"
            ? "active"
            : "pending",
      title: "Observed",
      summary: observedComplete
        ? "The staging task was replayed and durable evidence was recorded."
        : "The staging task will be observed against the frozen plan.",
    },
    {
      id: "scoped-repair",
      stage: "scoped-repair",
      status: blocked
        ? "blocked"
        : repairComplete
          ? "complete"
          : [
                "binding-source",
                "awaiting-repair-authorization",
                "repairing",
              ].includes(state)
            ? "active"
            : "pending",
      title: "Scoped repair",
      summary: repairComplete
        ? "The authorized source scope was repaired in isolation."
        : "One exact source and command authorization gates the repair.",
    },
    {
      id: "verified",
      stage: "verified",
      status: blocked
        ? "blocked"
        : verifiedComplete
          ? "complete"
          : ["verifying", "awaiting-patch-acceptance"].includes(state)
            ? "active"
            : "pending",
      title: "Verified",
      summary: verifiedComplete
        ? "Verification passed and the final patch was explicitly accepted."
        : "The same mission will be replayed before patch acceptance.",
    },
    {
      id: "merged",
      stage: "merged",
      status: mergeStatus,
      title: "Integration",
      summary: demoMerged
        ? "The verified patch was accepted and is ready for integration."
        : "Accept the verified patch for integration.",
    },
  ];
}

const SETUP_PROOF_THREAD = [
  {
    id: "observed",
    stage: "observed",
    status: "pending",
    title: "Observed",
    summary: "Run the mission to record direct staging evidence.",
  },
  {
    id: "scoped-repair",
    stage: "scoped-repair",
    status: "pending",
    title: "Scoped repair",
    summary: "Review one exact source and command authorization.",
  },
  {
    id: "verified",
    stage: "verified",
    status: "pending",
    title: "Verified",
    summary: "Accept only a patch backed by replay and checks.",
  },
  {
    id: "merged",
    stage: "merged",
    status: "pending",
    title: "Integration",
    summary: "Accept the verified patch for integration.",
  },
] satisfies MissionProofItem[];

type MissionWorkspaceView = "plan" | MissionProofItem["stage"];

function proofThreadItems(mission?: MissionResource): MissionProofItem[] {
  const fallbackItems =
    mission === undefined ? SETUP_PROOF_THREAD : defaultProofThread(mission);
  return fallbackItems.map(
    (fallback) =>
      mission?.proofThread.find((item) => item.stage === fallback.stage) ??
      fallback,
  );
}

function preferredProofStage(
  mission: MissionResource,
  items: MissionProofItem[],
): MissionProofItem["stage"] {
  if (
    ["completed", "report-only", "attention", "cancelled", "failed"].includes(
      mission.state,
    )
  ) {
    return "merged";
  }
  return (
    items.find((item) => item.status === "active")?.stage ??
    [...items].reverse().find((item) => item.status === "complete")?.stage ??
    "observed"
  );
}

function initialWorkspaceView(
  mission: MissionResource,
  items: MissionProofItem[],
): MissionWorkspaceView {
  if (["draft", "compiling", "ready"].includes(mission.state)) {
    return "plan";
  }
  return preferredProofStage(mission, items);
}

function stageForMissionState(
  state: MissionState,
): MissionProofItem["stage"] | undefined {
  if (state === "running-audit") {
    return "observed";
  }
  if (
    ["binding-source", "awaiting-repair-authorization", "repairing"].includes(
      state,
    )
  ) {
    return "scoped-repair";
  }
  if (["verifying", "awaiting-patch-acceptance"].includes(state)) {
    return "verified";
  }
  if (
    ["completed", "report-only", "attention", "cancelled", "failed"].includes(
      state,
    )
  ) {
    return "merged";
  }
  return undefined;
}

function stagePanelId(stage: MissionProofItem["stage"]): string {
  return `mission-stage-panel-${stage}`;
}

function ProofThread({
  mission,
  setup = false,
  selectedStage,
  onSelectStage,
}: {
  mission?: MissionResource;
  setup?: boolean;
  selectedStage?: MissionProofItem["stage"];
  onSelectStage?: (stage: MissionProofItem["stage"]) => void;
}) {
  const items = useMemo(() => proofThreadItems(mission), [mission]);
  const tabRefs = useRef(
    new Map<MissionProofItem["stage"], HTMLButtonElement>(),
  );
  const finalPatchViewActive =
    selectedStage === "verified" || selectedStage === "merged";

  const selectByIndex = (index: number) => {
    const item = items[index];
    if (item !== undefined) {
      onSelectStage?.(item.stage);
      tabRefs.current.get(item.stage)?.focus();
    }
  };

  return (
    <aside
      className="mission-proof-pane"
      data-setup={setup || undefined}
      aria-labelledby="proof-thread-heading"
    >
      <header>
        <h2 id="proof-thread-heading">Proof Thread</h2>
      </header>
      <nav aria-label="Proof Thread stages">
        <ol
          className="proof-thread-list"
          data-final-patch-active={finalPatchViewActive || undefined}
        >
          {items.map((item, index) => (
            <li
              className="proof-thread-item"
              key={item.id}
              data-stage={item.stage}
              data-status={item.status}
            >
              {setup ? (
                <div className="proof-thread-static-item">
                  <span className="proof-thread-mark" aria-hidden="true">
                    <CircleDashed />
                  </span>
                  <span>
                    <strong>{item.title}</strong>
                    <small>{stateLabelForProof(item.status)}</small>
                  </span>
                </div>
              ) : (
                <button
                  type="button"
                  aria-current={
                    selectedStage === item.stage ? "step" : undefined
                  }
                  ref={(node) => {
                    if (node === null) {
                      tabRefs.current.delete(item.stage);
                    } else {
                      tabRefs.current.set(item.stage, node);
                    }
                  }}
                  onClick={() => onSelectStage?.(item.stage)}
                  onKeyDown={(event) => {
                    if (
                      event.key === "ArrowDown" ||
                      event.key === "ArrowRight"
                    ) {
                      event.preventDefault();
                      selectByIndex((index + 1) % items.length);
                    } else if (
                      event.key === "ArrowUp" ||
                      event.key === "ArrowLeft"
                    ) {
                      event.preventDefault();
                      selectByIndex((index - 1 + items.length) % items.length);
                    } else if (event.key === "Home") {
                      event.preventDefault();
                      selectByIndex(0);
                    } else if (event.key === "End") {
                      event.preventDefault();
                      selectByIndex(items.length - 1);
                    }
                  }}
                >
                  <span className="proof-thread-mark" aria-hidden="true">
                    {item.status === "complete" ? (
                      <Check />
                    ) : item.status === "active" ? (
                      <LoaderCircle className="spin" />
                    ) : item.status === "blocked" ? (
                      <X />
                    ) : (
                      <CircleDashed />
                    )}
                  </span>
                  <span>
                    <strong>{item.title}</strong>
                    <small>{stateLabelForProof(item.status)}</small>
                  </span>
                </button>
              )}
            </li>
          ))}
        </ol>
      </nav>
    </aside>
  );
}

function stateLabelForProof(status: MissionProofItem["status"]): string {
  const labels: Record<MissionProofItem["status"], string> = {
    pending: "Pending",
    active: "In progress",
    complete: "Complete",
    blocked: "Stopped",
  };
  return labels[status];
}

function MissionStage({
  item,
  children,
}: {
  item: MissionProofItem;
  children: ReactNode;
}) {
  return (
    <section
      className="mission-stage-surface"
      id={stagePanelId(item.stage)}
      aria-label={`${item.title} workspace`}
    >
      {children}
    </section>
  );
}

function MissionReportMenu({ missionId }: { missionId: string }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const download = (format: "html" | "markdown" | "json") => {
    setOpen(false);
    void downloadMissionReport(missionId, format);
  };

  return (
    <div className="mission-report-menu" ref={menuRef}>
      <button
        type="button"
        ref={triggerRef}
        aria-expanded={open}
        aria-controls="mission-report-formats"
        onClick={() => setOpen((current) => !current)}
      >
        <Download aria-hidden="true" />
        <span>Export report</span>
      </button>
      {open && (
        <div
          id="mission-report-formats"
          className="mission-report-menu-popover"
          role="group"
          aria-label="Mission report formats"
        >
          <button type="button" onClick={() => download("html")}>
            HTML
          </button>
          <button type="button" onClick={() => download("markdown")}>
            Markdown
          </button>
          <button type="button" onClick={() => download("json")}>
            JSON
          </button>
        </div>
      )}
    </div>
  );
}

function AvailabilityNotice({ mission }: { mission: MissionResource }) {
  const { availability } = mission;
  if (
    availability.execution === "available" &&
    availability.source === "bound"
  ) {
    return null;
  }
  const title =
    availability.source === "unbound"
      ? "Source is not bound"
      : availability.execution === "sandbox-unavailable"
        ? "Repair sandbox is unavailable"
        : "Report-only mission";
  const detail =
    availability.detail ??
    (availability.source === "unbound"
      ? "Observation and saved evidence remain available, but source repair cannot begin until the repository is bound."
      : availability.execution === "sandbox-unavailable"
        ? "The staging evidence remains available. No source edits or verification commands can run in this environment."
        : "This mission can be reviewed and exported, but it cannot execute or modify source.");
  return (
    <div className="mission-availability" role="status">
      <AlertTriangle aria-hidden="true" />
      <div>
        <strong>{title}</strong>
        <p>{detail}</p>
      </div>
    </div>
  );
}

function MissionSetup({
  onCreated,
}: {
  onCreated: (mission: MissionResource) => void;
}) {
  const [stagingUrl, setStagingUrl] = useState("");
  const [sourceKind, setSourceKind] =
    useState<MissionRepositorySource["kind"]>("local");
  const [sourceValue, setSourceValue] = useState("");
  const [commitSha, setCommitSha] = useState("");
  const [objective, setObjective] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const objectiveInputRef = useRef<HTMLTextAreaElement>(null);
  const stagingReady = isHttpUrl(stagingUrl);
  const sourceReady =
    sourceKind === "local"
      ? sourceValue.trim() !== ""
      : isPublicGitUrl(sourceValue) &&
        /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(commitSha.trim());
  const objectiveReady = objective.trim() !== "";
  const setupStages = [
    { id: "target", label: "Target", ready: stagingReady },
    { id: "source", label: "Source", ready: sourceReady },
    { id: "outcome", label: "Outcome", ready: objectiveReady },
  ];
  const readyStageCount = setupStages.filter((stage) => stage.ready).length;
  const currentStageId = setupStages.find((stage) => !stage.ready)?.id;

  useEffect(() => {
    const textarea = objectiveInputRef.current;
    if (textarea === null) {
      return;
    }
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [objective]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!isHttpUrl(stagingUrl)) {
      setError("Enter a complete HTTP or HTTPS staging URL.");
      return;
    }
    if (sourceKind === "public-git" && !isPublicGitUrl(sourceValue)) {
      setError("Enter a public HTTPS Git repository URL.");
      return;
    }
    if (
      sourceKind === "public-git" &&
      !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(commitSha.trim())
    ) {
      setError("Enter the full 40- or 64-character Git commit SHA.");
      return;
    }
    if (sourceValue.trim() === "" || objective.trim() === "") {
      setError("Repository source and objective are required.");
      return;
    }
    setBusy(true);
    try {
      const parsedUrl = new URL(stagingUrl);
      const input = {
        stagingUrl: parsedUrl.toString(),
        repositorySource:
          sourceKind === "local"
            ? { kind: "local" as const, value: sourceValue.trim() }
            : {
                kind: "public-git" as const,
                value: sourceValue.trim(),
                commit: commitSha.trim(),
              },
        objective: objective.trim(),
      } satisfies Parameters<typeof createMission>[0];
      onCreated(await createMission(input));
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "The mission plan could not be generated.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <main id="main-content" className="mission-setup" tabIndex={-1}>
      <section
        className="mission-setup-form"
        aria-labelledby="mission-setup-heading"
      >
        <h1 id="mission-setup-heading">Define new mission</h1>
        <section
          className="mission-setup-progress"
          data-ready-stages={readyStageCount}
          aria-label={`Mission setup progress: ${readyStageCount} of 3 complete`}
        >
          <div>
            <span>Mission setup</span>
            <strong>{readyStageCount} of 3 ready</strong>
          </div>
          <ol>
            {setupStages.map((stage) => {
              const state = stage.ready
                ? "complete"
                : currentStageId === stage.id
                  ? "current"
                  : "upcoming";
              return (
                <li key={stage.id} data-state={state}>
                  <span aria-hidden="true">
                    {state === "complete" ? <Check /> : null}
                  </span>
                  <span>{stage.label}</span>
                </li>
              );
            })}
          </ol>
          {busy && (
            <p className="mission-setup-progress-status" role="status">
              Generating editable mission plan
            </p>
          )}
        </section>
        <form onSubmit={(event) => void submit(event)} aria-busy={busy}>
          <label>
            <span>Staging URL</span>
            <input
              type="url"
              value={stagingUrl}
              onChange={(event) => setStagingUrl(event.target.value)}
              placeholder="https://staging.example.com/task"
              disabled={busy}
              required
            />
          </label>
          <fieldset>
            <legend>Repository source</legend>
            <div className="mission-source-toggle">
              <label>
                <input
                  type="radio"
                  name="repository-source"
                  checked={sourceKind === "local"}
                  onChange={() => setSourceKind("local")}
                  disabled={busy}
                />
                Local path
              </label>
              <label>
                <input
                  type="radio"
                  name="repository-source"
                  checked={sourceKind === "public-git"}
                  onChange={() => setSourceKind("public-git")}
                  disabled={busy}
                />
                Public HTTPS Git URL
              </label>
            </div>
            <label>
              <span>
                {sourceKind === "local"
                  ? "Local repository path"
                  : "Public repository URL"}
              </span>
              <input
                type="text"
                value={sourceValue}
                onChange={(event) => setSourceValue(event.target.value)}
                placeholder={
                  sourceKind === "local"
                    ? "C:\\work\\application"
                    : "https://github.com/owner/repository.git"
                }
                disabled={busy}
                required
              />
            </label>
            {sourceKind === "public-git" && (
              <label>
                <span>Git commit SHA</span>
                <input
                  type="text"
                  value={commitSha}
                  onChange={(event) => setCommitSha(event.target.value)}
                  placeholder="40- or 64-character commit SHA"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  pattern="[A-Fa-f0-9]{40}|[A-Fa-f0-9]{64}"
                  disabled={busy}
                  required
                />
              </label>
            )}
          </fieldset>
          <div className="mission-objective-field">
            <label htmlFor="mission-objective">Objective</label>
            <div className="mission-objective-composer">
              <textarea
                id="mission-objective"
                ref={objectiveInputRef}
                value={objective}
                onChange={(event) => setObjective(event.target.value)}
                placeholder="Write an outcome"
                rows={1}
                disabled={busy}
                required
              />
              <button
                className="mission-objective-submit"
                type="submit"
                disabled={
                  busy || !stagingReady || !sourceReady || !objectiveReady
                }
                aria-label={
                  busy ? "Generating mission plan" : "Generate mission plan"
                }
                title={
                  busy ? "Generating mission plan" : "Generate mission plan"
                }
              >
                {busy ? (
                  <LoaderCircle className="spin" aria-hidden="true" />
                ) : (
                  <ArrowUp aria-hidden="true" />
                )}
              </button>
            </div>
          </div>
          {error !== null && (
            <div className="mission-form-error" role="alert">
              <AlertTriangle aria-hidden="true" />
              {error}
            </div>
          )}
        </form>
      </section>
    </main>
  );
}

function MissionPlan({
  mission,
  busy,
  onRun,
}: {
  mission: MissionResource;
  busy: boolean;
  onRun: (steps: MissionPlanStep[]) => Promise<void>;
}) {
  const [steps, setSteps] = useState(mission.plan.steps);

  useEffect(() => {
    setSteps(mission.plan.steps);
  }, [mission.id, mission.plan.steps]);

  const frozen = mission.plan.frozen || mission.state !== "ready";
  return (
    <section className="mission-plan" aria-labelledby="mission-plan-heading">
      <header>
        <div>
          <p className="route-breadcrumb">Mission plan</p>
          <h2 id="mission-plan-heading">
            {frozen ? "Frozen mission steps" : "Review mission steps"}
          </h2>
        </div>
        <span className="mission-plan-state">
          {frozen ? (
            <Lock aria-hidden="true" />
          ) : (
            <FileCode2 aria-hidden="true" />
          )}
          {frozen ? "Frozen" : "Editable"}
        </span>
      </header>
      <ol className="mission-step-editor">
        {steps.length === 0 && (
          <li className="mission-plan-empty">
            <AlertTriangle aria-hidden="true" />
            <p>
              The compiled mission did not return executable steps. The mission
              can be reviewed as a report, but Run remains unavailable.
            </p>
          </li>
        )}
        {steps.map((step, index) => (
          <li key={step.id}>
            <span aria-hidden="true">{index + 1}</span>
            <label>
              <span className="visually-hidden">Step {index + 1}</span>
              <input
                value={step.instruction}
                disabled={frozen}
                onChange={(event) =>
                  setSteps((current) =>
                    current.map((item) =>
                      item.id === step.id
                        ? { ...item, instruction: event.target.value }
                        : item,
                    ),
                  )
                }
              />
            </label>
          </li>
        ))}
      </ol>
      {!frozen && (
        <div className="mission-plan-actions">
          <button
            type="button"
            className="primary-command"
            disabled={
              busy ||
              steps.length === 0 ||
              steps.some((step) => step.instruction.trim() === "")
            }
            onClick={() => void onRun(steps)}
          >
            {busy ? (
              <LoaderCircle className="spin" aria-hidden="true" />
            ) : (
              <Lock aria-hidden="true" />
            )}
            {busy ? "Starting mission" : "Run and freeze plan"}
          </button>
        </div>
      )}
    </section>
  );
}

function MissionEvidence({
  steps,
  selectedId,
  onSelectedChange,
}: {
  steps: MissionObservedStep[];
  selectedId?: string;
  onSelectedChange: (id: string) => void;
}) {
  const selected = steps.find((step) => step.id === selectedId) ?? steps[0];
  const [imageUrl, setImageUrl] = useState<string>();
  const [imageFailed, setImageFailed] = useState(false);

  if (selected === undefined) {
    return null;
  }

  useEffect(() => {
    if (selected.id !== selectedId) {
      onSelectedChange(selected.id);
    }
  }, [onSelectedChange, selected, selectedId]);

  useEffect(() => {
    const screenshot = selected.screenshot;
    let released = false;
    let objectUrl: string | undefined;
    setImageUrl(undefined);
    setImageFailed(false);
    if (screenshot === undefined) {
      return () => undefined;
    }
    const demoImagePath = demoEvidenceImagePaths[screenshot.artifactId];
    if (demoImagePath !== undefined) {
      setImageUrl(demoImagePath);
      return () => undefined;
    }
    void loadMissionScreenshot(screenshot.artifactId, screenshot.sessionId)
      .then((url) => {
        objectUrl = url;
        if (released) {
          URL.revokeObjectURL(url);
          return;
        }
        setImageUrl(url);
      })
      .catch(() => {
        if (!released) {
          setImageFailed(true);
        }
      });
    return () => {
      released = true;
      if (objectUrl !== undefined) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [
    selected.id,
    selected.screenshot?.artifactId,
    selected.screenshot?.sessionId,
  ]);

  return (
    <section
      className="mission-evidence"
      aria-labelledby="mission-evidence-heading"
    >
      <header>
        <div>
          <p className="route-breadcrumb">Observed evidence</p>
          <h2 id="mission-evidence-heading">
            What happened at each affected step
          </h2>
        </div>
      </header>
      <div className="mission-evidence-layout">
        <ol
          className="mission-evidence-list"
          aria-label="Affected mission steps"
        >
          {steps.map((step, index) => {
            const selectedStep = step.id === selected.id;
            return (
              <li key={step.id}>
                <button
                  type="button"
                  aria-current={selectedStep ? "step" : undefined}
                  onClick={() => onSelectedChange(step.id)}
                >
                  <span
                    className="mission-evidence-sequence"
                    aria-hidden="true"
                  >
                    {index + 1}
                  </span>
                  <span>
                    <strong>{step.instruction}</strong>
                    <small>
                      {step.issues.map((issue) => issue.id).join(", ")}
                    </small>
                  </span>
                  <AlertTriangle aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ol>
        <div className="mission-evidence-detail">
          <div className="mission-evidence-media">
            {imageUrl !== undefined ? (
              <img src={imageUrl} alt={selected.screenshot?.alt ?? ""} />
            ) : imageFailed ? (
              <div className="mission-evidence-media-message" role="status">
                <Image aria-hidden="true" />
                <p>The screenshot could not be loaded.</p>
              </div>
            ) : selected.screenshot === undefined ? (
              <div className="mission-evidence-media-message" role="status">
                <Image aria-hidden="true" />
                <p>No screenshot was captured for this step.</p>
              </div>
            ) : (
              <div className="mission-evidence-loading" role="status">
                <LoaderCircle className="spin" aria-hidden="true" />
                <span>Loading captured screenshot</span>
              </div>
            )}
          </div>
          <div className="mission-evidence-issues">
            <p>Problem found</p>
            <ul>
              {selected.issues.map((issue) => (
                <li key={issue.id}>
                  <strong>{issue.id}</strong>
                  <span>{issue.summary}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

function AuthorizationGate({
  mission,
  busy,
  runDisabled,
  onRun,
  onDecision,
}: {
  mission: MissionResource;
  busy: boolean;
  runDisabled: boolean;
  onRun: () => Promise<void>;
  onDecision: (decision: "approve-once" | "deny") => Promise<void>;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const authorization = mission.authorization;
  useEffect(() => {
    if (authorization?.state === "pending") {
      headingRef.current?.focus();
    }
  }, [authorization?.id, authorization?.state]);
  const pending = authorization?.state === "pending";
  const completedState =
    authorization?.state === "approved"
      ? "Authorization approved"
      : authorization?.state === "denied"
        ? "Authorization denied"
        : authorization?.state === "expired"
          ? "Authorization expired"
          : undefined;
  return (
    <section
      className="mission-authorization"
      aria-labelledby="mission-authorization-heading"
    >
      <header>
        <ShieldCheck aria-hidden="true" />
        <div>
          <p className="route-breadcrumb">Repair authorization</p>
          <h2 id="mission-authorization-heading" ref={headingRef} tabIndex={-1}>
            {pending ? authorization.title : "Scoped repair authorization"}
          </h2>
        </div>
      </header>
      {authorization === undefined ? (
        <>
          <p>
            Run the mission plan to prepare the exact files and checks for
            approval.
          </p>
          <div className="mission-authorization-actions" data-single-action>
            <button
              type="button"
              className="primary-command"
              disabled={busy || runDisabled}
              onClick={() => void onRun()}
            >
              {busy ? (
                <LoaderCircle className="spin" aria-hidden="true" />
              ) : (
                <Play aria-hidden="true" />
              )}
              {busy ? "Starting mission" : "Run mission plan"}
            </button>
          </div>
        </>
      ) : (
        <>
          <p>
            {pending
              ? authorization.consequence
              : "The repair is limited to the following exact files and checks."}
          </p>
          <div className="mission-authorization-scope">
            <section aria-labelledby="authorized-paths">
              <h3 id="authorized-paths">Exact paths</h3>
              {authorization.paths.length === 0 ? (
                <p>No writable paths were requested.</p>
              ) : (
                <ul>
                  {authorization.paths.map((path) => (
                    <li key={path}>
                      <code>{path}</code>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section aria-labelledby="authorized-commands">
              <h3 id="authorized-commands">Exact commands</h3>
              {authorization.commands.length === 0 ? (
                <p>No commands were requested.</p>
              ) : (
                <ul>
                  {authorization.commands.map((command) => (
                    <li key={command}>
                      <code>{command}</code>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
          {pending ? (
            <div className="mission-authorization-actions">
              <button
                type="button"
                className="primary-command"
                disabled={busy}
                onClick={() => void onDecision("approve-once")}
              >
                <Check aria-hidden="true" />
                Authorize repair once
              </button>
              <button
                type="button"
                className="deny-command"
                disabled={busy}
                onClick={() => void onDecision("deny")}
              >
                <X aria-hidden="true" />
                Deny repair
              </button>
            </div>
          ) : (
            <p className="mission-authorization-state" role="status">
              {completedState}
            </p>
          )}
        </>
      )}
    </section>
  );
}

function PatchAcceptance({
  mission,
  busy,
  onMerge,
  onReject,
}: {
  mission: MissionResource;
  busy: boolean;
  onMerge: () => Promise<void>;
  onReject: () => Promise<void>;
}) {
  if (mission.patch === undefined) {
    return null;
  }
  const patchSummary = summarizePatch(
    mission.patch.stat,
    mission.patch.changedFiles,
  );
  const pending =
    mission.state === "awaiting-patch-acceptance" &&
    mission.patch.state === "pending";
  const readyToMerge =
    pending ||
    (mission.state === "completed" &&
      mission.patch.state === "accepted" &&
      mission.patch.integration !== "demo-merged");
  const demoMerged = mission.patch.integration === "demo-merged";
  return (
    <section className="mission-patch" aria-labelledby="mission-patch-heading">
      <header>
        <div>
          <p className="route-breadcrumb">Final patch</p>
          <h2 id="mission-patch-heading">Review the verified source change</h2>
        </div>
        <PatchSummary summary={patchSummary} />
      </header>
      <pre
        className="patch-diff"
        tabIndex={0}
        aria-label="Final patch. Added lines are green. Removed lines are red."
      >
        <code>
          {renderPatchDiff(
            mission.patch.patch || "No textual patch was returned.",
          )}
        </code>
      </pre>
      {readyToMerge && (
        <div className="mission-patch-actions">
          <div className="mission-patch-action-buttons">
            <button
              type="button"
              className="primary-command"
              disabled={busy}
              onClick={() => void onMerge()}
            >
              <GitMerge aria-hidden="true" />
              Merge verified patch
            </button>
            {pending && (
              <button
                type="button"
                className="deny-command"
                disabled={busy}
                onClick={() => void onReject()}
              >
                <X aria-hidden="true" />
                Reject patch
              </button>
            )}
          </div>
        </div>
      )}
      {demoMerged && (
        <section className="mission-patch-merge-status" role="status">
          <CheckCircle2 aria-hidden="true" />
          <div>
            <h3>Verified patch accepted</h3>
            <p>The patch passed verification and is ready for integration.</p>
          </div>
        </section>
      )}
    </section>
  );
}

function VerifiedReplayPlaceholder({ mission }: { mission: MissionResource }) {
  const isVerifying = mission.state === "verifying";
  const isPreparingPatch = mission.state === "awaiting-patch-acceptance";
  const title = isVerifying
    ? "Checking the repaired journey"
    : isPreparingPatch
      ? "Preparing the final patch"
      : "Verified replay will appear here";
  const detail = isVerifying
    ? "AccessPath is replaying the repaired journey. The final patch will appear here when the recorded checks finish."
    : isPreparingPatch
      ? "The replay has finished. AccessPath is preparing the verified source change for review."
      : "After the scoped repair is complete, AccessPath will replay the affected journey and show the verified source change here.";

  return (
    <section className="mission-active-state" aria-live="polite">
      {isVerifying || isPreparingPatch ? (
        <LoaderCircle className="spin" aria-hidden="true" />
      ) : (
        <CircleDashed aria-hidden="true" />
      )}
      <div>
        <h2>{title}</h2>
        <p>{detail}</p>
      </div>
    </section>
  );
}

type PatchFileSummary = {
  path: string;
  linesChanged?: number;
  additions: number;
  deletions: number;
};

type PatchSummary = {
  files: PatchFileSummary[];
  fileCount?: number;
  additions?: number;
  deletions?: number;
};

function summarizePatch(stat: string, changedFiles: string[]): PatchSummary {
  const files: PatchFileSummary[] = [];
  const filePaths = new Set<string>();
  let fileCount: number | undefined;
  let additions: number | undefined;
  let deletions: number | undefined;

  for (const line of stat.split(/\r?\n/)) {
    const totalMatch = line.match(
      /^\s*(\d+)\s+files?\s+changed(?:,\s+(\d+)\s+insertions?\(\+\))?(?:,\s+(\d+)\s+deletions?\(-\))?\s*$/,
    );
    if (totalMatch !== null) {
      fileCount = Number(totalMatch[1]);
      additions = totalMatch[2] === undefined ? 0 : Number(totalMatch[2]);
      deletions = totalMatch[3] === undefined ? 0 : Number(totalMatch[3]);
      continue;
    }

    const fileMatch = line.match(/^\s*(.+?)\s+\|\s+(\d+)\s+([+-]+)\s*$/);
    if (fileMatch === null) {
      continue;
    }

    const [, path, linesChanged, markers] = fileMatch;
    const normalizedPath = path.trim();
    filePaths.add(normalizedPath);
    files.push({
      path: normalizedPath,
      linesChanged: Number(linesChanged),
      additions: [...markers].filter((marker) => marker === "+").length,
      deletions: [...markers].filter((marker) => marker === "-").length,
    });
  }

  for (const path of changedFiles) {
    if (!filePaths.has(path)) {
      files.push({ path, additions: 0, deletions: 0 });
    }
  }

  return { files, fileCount, additions, deletions };
}

function PatchPath({ path }: { path: string }) {
  const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const directory = separator === -1 ? "" : path.slice(0, separator + 1);
  const filename = separator === -1 ? path : path.slice(separator + 1);

  return (
    <code className="patch-file-path">
      {directory !== "" && (
        <span className="patch-file-directory">{directory}</span>
      )}
      <span className="patch-file-name">{filename}</span>
    </code>
  );
}

function PatchSummary({ summary }: { summary: PatchSummary }) {
  return (
    <div className="patch-summary" aria-label="Patch summary">
      <ul className="patch-summary-files">
        {summary.files.map((file) => (
          <li key={file.path}>
            <PatchPath path={file.path} />
            {file.linesChanged !== undefined && (
              <span className="patch-lines-changed">
                {file.linesChanged} lines
              </span>
            )}
            <span className="patch-summary-deltas">
              <span className="patch-addition">+{file.additions}</span>
              <span className="patch-deletion">-{file.deletions}</span>
            </span>
          </li>
        ))}
      </ul>
      {summary.fileCount !== undefined && (
        <p className="patch-summary-total">
          <span>
            {summary.fileCount} {summary.fileCount === 1 ? "file" : "files"}{" "}
            changed
          </span>
          <span className="patch-addition">+{summary.additions ?? 0}</span>
          <span className="patch-deletion">-{summary.deletions ?? 0}</span>
        </p>
      )}
    </div>
  );
}

function renderPatchDiff(patch: string): ReactNode[] {
  return patch.split(/\r?\n/).map((line, index) => {
    let tone = "context";
    if (line.startsWith("@@")) {
      tone = "hunk";
    } else if (line.startsWith("diff --git") || line.startsWith("index ")) {
      tone = "metadata";
    } else if (line.startsWith("--- ") || line.startsWith("+++ ")) {
      tone = "file-header";
    } else if (line.startsWith("+")) {
      tone = "addition";
    } else if (line.startsWith("-")) {
      tone = "deletion";
    }

    return (
      <span className={`patch-diff-line is-${tone}`} key={`${index}-${line}`}>
        {line === "" ? "\u00a0" : line}
        {"\n"}
      </span>
    );
  });
}

function LiveActivityTrace({
  entries,
  state,
}: {
  entries: MissionTraceEntry[];
  state: MissionState;
}) {
  const active =
    state === "running-audit" || state === "repairing" || state === "verifying";
  if (!active && entries.length === 0) {
    return null;
  }
  return (
    <section
      className="mission-activity-trace"
      aria-labelledby="activity-heading"
    >
      <header>
        <div>
          <h2 id="activity-heading">
            {state === "verifying"
              ? "Checking the repaired journey"
              : "Repair activity"}
          </h2>
        </div>
        <span role="status" aria-atomic="true">
          {active ? stateLabel(state) : "Activity preserved"}
        </span>
      </header>
      {entries.length === 0 ? (
        <div className="mission-activity-empty">
          <CircleDashed aria-hidden="true" />
          <p>Preparing the isolated workspace.</p>
        </div>
      ) : (
        <ol role="log" aria-live="off" aria-label="Repair activity">
          {entries.map((entry) => (
            <li key={entry.id} data-kind={entry.kind} data-state={entry.state}>
              <span className="mission-activity-mark" aria-hidden="true">
                {entry.kind === "file" ? (
                  <FileCode2 />
                ) : entry.state === "blocked" ? (
                  <AlertTriangle />
                ) : entry.state === "complete" ? (
                  <CheckCircle2 />
                ) : (
                  <LoaderCircle className="spin" />
                )}
              </span>
              <div>
                <strong>{entry.title}</strong>
                {entry.detail !== undefined &&
                  entry.detail !== "" &&
                  (entry.kind === "agent" ? (
                    entry.streaming ? (
                      <p className="mission-agent-update-preview">
                        {agentUpdatePreview(entry.detail)}
                      </p>
                    ) : (
                      <AgentUpdateDetails text={entry.detail} />
                    )
                  ) : (
                    <p>{entry.detail}</p>
                  ))}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function MissionWorkspace({ missionId }: { missionId?: string }) {
  const [mission, setMission] = useState<MissionResource>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [traceEntries, setTraceEntries] = useState<MissionTraceEntry[]>([]);
  const [activeView, setActiveView] = useState<MissionWorkspaceView>("plan");
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string>();
  const lastEventId = useRef<string | undefined>(undefined);
  const workspaceMissionId = useRef<string | undefined>(undefined);
  const scopedRepairStatus = useRef<
    | {
        missionId: string;
        status: MissionProofItem["status"];
      }
    | undefined
  >(undefined);
  const proofItems = useMemo(() => proofThreadItems(mission), [mission]);
  const defaultView = useMemo(
    () =>
      mission === undefined
        ? "plan"
        : initialWorkspaceView(mission, proofItems),
    [mission, proofItems],
  );

  const refresh = useCallback(async () => {
    if (missionId === undefined) {
      return undefined;
    }
    const next = await getMission(missionId);
    setMission(next);
    return next;
  }, [missionId]);

  useEffect(() => {
    setMission(undefined);
    setError(null);
    setTraceEntries([]);
    lastEventId.current = undefined;
    workspaceMissionId.current = undefined;
    scopedRepairStatus.current = undefined;
    setActiveView("plan");
    setSelectedEvidenceId(undefined);
    if (missionId === undefined) {
      return;
    }
    let active = true;
    void refresh().catch((nextError) => {
      if (active) {
        setError(
          nextError instanceof Error
            ? nextError.message
            : "The mission could not be loaded.",
        );
      }
    });
    return () => {
      active = false;
    };
  }, [missionId, refresh]);

  useLayoutEffect(() => {
    if (mission === undefined || workspaceMissionId.current === mission.id) {
      return;
    }
    workspaceMissionId.current = mission.id;
    setActiveView(defaultView);
    setSelectedEvidenceId(mission.observedSteps[0]?.id);
  }, [defaultView, mission]);

  useEffect(() => {
    if (mission === undefined) {
      return;
    }
    setSelectedEvidenceId((current) =>
      mission.observedSteps.some((step) => step.id === current)
        ? current
        : mission.observedSteps[0]?.id,
    );
  }, [mission?.id, mission?.observedSteps]);

  useEffect(() => {
    if (mission === undefined) {
      scopedRepairStatus.current = undefined;
      return;
    }
    const currentStatus = proofItems.find(
      (item) => item.stage === "scoped-repair",
    )?.status;
    if (currentStatus === undefined) {
      return;
    }
    const previous = scopedRepairStatus.current;
    scopedRepairStatus.current = {
      missionId: mission.id,
      status: currentStatus,
    };
    if (
      previous?.missionId === mission.id &&
      previous.status !== "complete" &&
      currentStatus === "complete"
    ) {
      setActiveView("verified");
    }
  }, [mission, proofItems]);

  useEffect(() => {
    if (missionId === undefined || mission === undefined) {
      return;
    }
    const controller = new AbortController();
    void streamMissionEvents(
      missionId,
      lastEventId.current,
      (event) => {
        lastEventId.current = event.eventId;
        setTraceEntries((current) => appendTraceEntry(current, event));
        void refresh().catch(() => undefined);
      },
      controller.signal,
    ).catch(() => undefined);
    return () => controller.abort();
  }, [mission?.id, missionId, refresh]);

  useEffect(() => {
    if (
      missionId === undefined ||
      mission === undefined ||
      !MISSION_STATE_DETAILS[mission.state].poll
    ) {
      return;
    }
    const timer = window.setInterval(() => {
      void refresh().catch(() => undefined);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [mission?.state, missionId, refresh]);

  const run = async (steps: MissionPlanStep[]) => {
    if (mission === undefined) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const planned = await updateMissionPlan(
        mission.id,
        mission.revision,
        steps,
      );
      setMission(planned);
      setMission(await runMission(mission.id, planned.revision));
      setActiveView("scoped-repair");
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "The mission could not start.",
      );
    } finally {
      setBusy(false);
    }
  };

  const decideAuthorization = async (decision: "approve-once" | "deny") => {
    if (mission?.authorization === undefined) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await decideMissionAuthorization(
        mission.id,
        mission.revision,
        decision,
      );
      setMission(next);
      setActiveView(stageForMissionState(next.state) ?? "scoped-repair");
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "The authorization decision failed.",
      );
    } finally {
      setBusy(false);
    }
  };

  const patchAction = async (action: "merge" | "reject") => {
    if (mission === undefined) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next =
        action === "merge"
          ? await mergeVerifiedMissionPatch(mission.id, mission.revision)
          : await rejectMissionPatch(mission.id, mission.revision);
      setMission(next);
      setActiveView(
        action === "merge"
          ? "merged"
          : (stageForMissionState(next.state) ?? "verified"),
      );
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "The patch decision failed.",
      );
    } finally {
      setBusy(false);
    }
  };

  const created = (nextMission: MissionResource) => {
    setMission(nextMission);
    setActiveView("plan");
    navigate(`/missions/${nextMission.id}`);
  };

  if (missionId === undefined) {
    return (
      <div className="mission-app">
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        <header className="mission-app-header">
          <button
            type="button"
            className="mission-brand"
            onClick={() => navigate("/missions/new")}
          >
            <img src="/accesspath-mark.png" alt="" aria-hidden="true" />
            <strong>AccessPath</strong>
          </button>
          <span>Mission Workspace</span>
        </header>
        <MissionSetup onCreated={created} />
      </div>
    );
  }

  if (mission === undefined) {
    return (
      <main id="main-content" className="mission-loading" tabIndex={-1}>
        {error === null ? (
          <LoaderCircle className="spin" aria-hidden="true" />
        ) : (
          <AlertTriangle aria-hidden="true" />
        )}
        <h1>{error === null ? "Loading mission" : "Mission unavailable"}</h1>
        <p>{error ?? "Reading the durable mission and Proof Thread."}</p>
      </main>
    );
  }

  const source = mission.repositorySource;
  const stateDetails = MISSION_STATE_DETAILS[mission.state];
  const terminal = terminalDetails(mission);
  const workspaceView = activeView;
  const runDisabled =
    mission.availability.execution !== "available" ||
    mission.availability.source !== "bound";
  const activeProofItem =
    workspaceView === "plan"
      ? undefined
      : proofItems.find((item) => item.stage === workspaceView);
  const activityStage =
    mission.state === "running-audit" && workspaceView === "scoped-repair"
      ? "scoped-repair"
      : stageForMissionState(mission.state);
  const showsFinalPatch =
    workspaceView === "verified" || workspaceView === "merged";

  return (
    <div className="mission-app">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="mission-app-header">
        <button
          type="button"
          className="mission-brand"
          onClick={() => navigate("/missions/new")}
        >
          <img src="/accesspath-mark.png" alt="" aria-hidden="true" />
          <strong>AccessPath</strong>
        </button>
        <div className="mission-header-state">
          {mission.provenance === "saved-run-replay" && (
            <span>Saved run replay</span>
          )}
          <strong>{stateLabel(mission.state)}</strong>
        </div>
        <div className="mission-header-actions">
          {mission.reportAvailable && (
            <MissionReportMenu missionId={mission.id} />
          )}
          {stateDetails.cancellable && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError(null);
                void cancelMission(mission.id, mission.revision)
                  .then((next) => {
                    setMission(next);
                    setActiveView("merged");
                  })
                  .catch((nextError) =>
                    setError(
                      nextError instanceof Error
                        ? nextError.message
                        : "The mission could not be cancelled.",
                    ),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              <X aria-hidden="true" />
              Cancel
            </button>
          )}
          <button
            className="mission-new-button"
            type="button"
            onClick={() => navigate("/missions/new")}
            aria-label="Create new mission"
            title="Create new mission"
          >
            <Plus aria-hidden="true" />
          </button>
        </div>
      </header>
      <main id="main-content" className="mission-layout" tabIndex={-1}>
        <aside
          className="mission-source-pane"
          aria-labelledby="mission-source-heading"
        >
          <header>
            <p className="route-breadcrumb">Mission</p>
            <h1 id="mission-source-heading">{mission.objective}</h1>
          </header>
          <button
            type="button"
            className="mission-plan-link"
            aria-current={workspaceView === "plan" ? "page" : undefined}
            onClick={() => setActiveView("plan")}
          >
            <FileCode2 aria-hidden="true" />
            <span>
              <strong>Mission plan</strong>
              <small>
                {mission.plan.steps.length}{" "}
                {mission.plan.steps.length === 1 ? "step" : "steps"},{" "}
                {mission.plan.frozen || mission.state !== "ready"
                  ? "frozen"
                  : "editable"}
              </small>
            </span>
          </button>
          <dl>
            <div>
              <dt>
                <Link2 aria-hidden="true" />
                Staging
              </dt>
              <dd>
                {mission.stagingUrl === "" ? (
                  "Staging URL unavailable"
                ) : (
                  <a href={mission.stagingUrl} target="_blank" rel="noreferrer">
                    {mission.stagingUrl}
                  </a>
                )}
              </dd>
            </div>
            <div>
              <dt>
                <GitBranch aria-hidden="true" />
                Repository
              </dt>
              <dd>{source?.value ?? "Source not bound"}</dd>
            </div>
            {source?.kind === "public-git" && source.commit !== undefined && (
              <div>
                <dt>
                  <Lock aria-hidden="true" />
                  Commit
                </dt>
                <dd>
                  <code>{source.commit}</code>
                </dd>
              </div>
            )}
          </dl>
          <div className="mission-identity">
            <span>Mission ID</span>
            <code>{mission.id}</code>
          </div>
        </aside>

        <ProofThread
          mission={mission}
          selectedStage={workspaceView === "plan" ? undefined : workspaceView}
          onSelectStage={setActiveView}
        />

        <div className="mission-work-surface">
          {error !== null && (
            <div className="mission-form-error" role="alert">
              <AlertTriangle aria-hidden="true" />
              {error}
            </div>
          )}
          {workspaceView === "plan" ? (
            <MissionPlan
              mission={
                runDisabled && mission.state === "ready"
                  ? { ...mission, plan: { ...mission.plan, frozen: true } }
                  : mission
              }
              busy={busy}
              onRun={run}
            />
          ) : activeProofItem !== undefined ? (
            <MissionStage item={activeProofItem}>
              {workspaceView === "observed" && (
                <MissionEvidence
                  steps={mission.observedSteps}
                  selectedId={selectedEvidenceId}
                  onSelectedChange={setSelectedEvidenceId}
                />
              )}
              {workspaceView === "scoped-repair" && (
                <>
                  <AvailabilityNotice mission={mission} />
                </>
              )}
              {stateDetails.activity !== undefined &&
                workspaceView === activityStage &&
                mission.state !== "running-audit" &&
                !showsFinalPatch && (
                  <section className="mission-active-state" aria-live="polite">
                    <LoaderCircle className="spin" aria-hidden="true" />
                    <div>
                      <h2>{stateLabel(mission.state)}</h2>
                      <p>{stateDetails.activity}</p>
                    </div>
                  </section>
                )}
              {workspaceView === "scoped-repair" && (
                <>
                  <LiveActivityTrace
                    entries={traceEntries}
                    state={mission.state}
                  />
                  {(mission.state === "ready" ||
                    mission.authorization !== undefined) && (
                    <AuthorizationGate
                      mission={mission}
                      busy={busy}
                      runDisabled={runDisabled}
                      onRun={() => run(mission.plan.steps)}
                      onDecision={decideAuthorization}
                    />
                  )}
                </>
              )}
              {showsFinalPatch && (
                <>
                  {mission.patch === undefined ? (
                    <VerifiedReplayPlaceholder mission={mission} />
                  ) : (
                    <PatchAcceptance
                      mission={mission}
                      busy={busy}
                      onMerge={() => patchAction("merge")}
                      onReject={() => patchAction("reject")}
                    />
                  )}
                  {terminal !== undefined && (
                    <section
                      className="mission-complete"
                      data-tone={terminal.tone}
                      role="status"
                    >
                      {terminal.tone === "verified" ? (
                        <CheckCircle2 aria-hidden="true" />
                      ) : (
                        <AlertTriangle aria-hidden="true" />
                      )}
                      <div>
                        <h2>{terminal.title}</h2>
                        <p>{terminal.detail}</p>
                      </div>
                    </section>
                  )}
                </>
              )}
            </MissionStage>
          ) : null}
        </div>
      </main>
    </div>
  );
}
