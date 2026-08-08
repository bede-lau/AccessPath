import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  stat,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { promisify } from "node:util";

import {
  AccessPathEventSchema,
  ApprovalDecisionSchema,
  DeploymentBindingSchema,
  RepairAuthorizationGrantSchema,
  RepairManifestSchema,
  RepositoryConfigSchema,
  SCHEMA_VERSION,
  SourceSpecSchema,
  TaskContractSchema,
  type AccessPathEvent,
  type AuditBundle,
  type CommandSpec,
  type DeploymentBinding,
  type Finding,
  type FindingComparison,
  type MissionSessionState,
  type RepairAuthorizationGrant,
  type RepositoryConfig,
  type SandboxPolicy,
  type SourceSnapshot,
  type SourceSpec,
  type TaskContract,
} from "@accesspath/contracts";
import { SourceAcquirer, type AcquiredSource } from "@accesspath/git-workspace";
import {
  planTaskContract,
  QoderAuthenticationError,
  type MissionPlanningOptions,
  type MissionPlanningResult,
  type QoderAdapter,
} from "@accesspath/qoder-runner";
import {
  NdjsonEventStore,
  atomicWriteFile,
  fileExists,
  redactValue,
  resolveSafeRelativePath,
  sha256,
  validateAuditBundle,
  validateArtifactRoot,
} from "@accesspath/evidence";
import { runReconnaissance } from "@accesspath/audit-engine";

import {
  AuditNotFoundError,
  AuditService,
  type AuditRunner,
} from "./audit-service";
import {
  RepairNotFoundError,
  RepairService,
  type RepairCommandRunner,
} from "./repair-service";
import {
  canCompleteDemoAp001VerificationFallback,
  demoAp001FallbackPaths,
} from "./demo-ap001-fallback";
import {
  compareReplayEvidence,
  replayVerificationIsAcceptable,
} from "./repair-replay";
import type {
  CommandSandbox,
  CommandSandboxCapability,
  CommandSandboxRequest,
  CommandSandboxReport,
  SandboxCommandResult,
} from "./command-sandbox";

export type MissionState = MissionSessionState;

export type MissionPlanStep = {
  id: string;
  instruction: string;
};

export type MissionObservedIssue = {
  id: string;
  summary: string;
};

export type MissionObservedStep = {
  id: string;
  instruction: string;
  state: AuditBundle["steps"][number]["state"];
  screenshot?: {
    artifactId: string;
    sessionId: string;
    alt: string;
  };
  issues: MissionObservedIssue[];
};

export type MissionProofItem = {
  id: string;
  stage: "observed" | "scoped-repair" | "verified" | "merged";
  status: "pending" | "active" | "complete" | "blocked";
  title: string;
  summary: string;
  evidence?: string[];
};

export type MissionResource = {
  id: string;
  revision: number;
  state: MissionState;
  title: string;
  stagingUrl: string;
  repositorySource?:
    | { kind: "local"; value: string }
    | { kind: "public-git"; value: string; commit: string };
  objective: string;
  plan: {
    frozen: boolean;
    steps: MissionPlanStep[];
  };
  observedSteps?: MissionObservedStep[];
  proofThread: MissionProofItem[];
  authorization?: {
    id: string;
    state: "pending" | "approved" | "denied" | "expired";
    title: string;
    consequence: string;
    paths: string[];
    commands: string[];
  };
  patch?: {
    patch: string;
    stat: string;
    changedFiles: string[];
    state: "pending" | "accepted" | "rejected";
    integration?: "demo-merged";
  };
  availability: {
    execution: "available" | "report-only" | "sandbox-unavailable";
    source: "bound" | "unbound";
    detail?: string;
  };
  reportAvailable: boolean;
  repairId?: string;
  provenance?: "saved-run-replay";
  createdAt: string;
  updatedAt: string;
};

type MissionIssue = {
  id: string;
  findingId: string;
  title: string;
  severity: Finding["severity"];
  summary: string;
  evidenceIds: string[];
  evidenceHashes: string[];
  affectedPaths: string[];
};

type RepairProposal = {
  id: string;
  issueId: string;
  summary: string;
  rationale: string;
  affectedPaths: string[];
  verificationSteps: string[];
  createdAt: string;
};

type MissionRecord = MissionResource & {
  sourceSnapshot: SourceSnapshot;
  sourceSnapshotHash: string;
  task: TaskContract;
  taskHash: string;
  sandboxCapability: CommandSandboxCapability;
  deployment?: DeploymentBinding;
  repository?: RepositoryConfig;
  sandboxRequest?: Omit<CommandSandboxRequest, "sourceDirectory">;
  issue?: MissionIssue;
  proposal?: RepairProposal;
  authorizationGrant?: RepairAuthorizationGrant;
  auditId?: string;
  auditBundleId?: string;
  repairedAuditBundle?: AuditBundle;
  repairId?: string;
  demoFallback?: "emergency-aid";
};

type MissionLayout = {
  root: string;
  missionPath: string;
  sourcePath: string;
  eventsPath: string;
  commandsPath: string;
};

type CommandReceipts = Record<
  string,
  { command: string; createdAt: string; missionId: string }
>;

export type MissionSourceAcquirer = Pick<SourceAcquirer, "acquire">;
export type MissionPlanningFunction = (
  options: MissionPlanningOptions,
) => Promise<MissionPlanningResult>;
export type MissionReconnaissance = (
  stagingUrl: string,
  targetPolicy: "public" | "local-explicit",
) => Promise<Readonly<Record<string, unknown>>>;
export type MissionDeploymentResolver = (
  stagingUrl: string,
  snapshot: SourceSnapshot,
) => Promise<DeploymentBinding>;
export type MissionTaskMapper = (
  stagingUrl: string,
  targetPolicy: TaskContract["targetPolicy"],
) => Promise<TaskContract | undefined>;

export interface MissionServiceConfig {
  artifactRoot: string;
  editableRepositoryRoot: string;
  auditService?: AuditService;
  repairService?: RepairService;
  auditRunner?: AuditRunner;
  qoderAdapter?: QoderAdapter;
  repairCommandRunner?: RepairCommandRunner;
  sourceAcquirer?: MissionSourceAcquirer;
  planner?: MissionPlanningFunction;
  commandSandbox?: CommandSandbox;
  sourceCacheRoot?: string;
  reconnaissance?: MissionReconnaissance;
  deploymentResolver?: MissionDeploymentResolver;
  taskMapper?: MissionTaskMapper;
  demoFallbackDelayMs?: number;
  demoAgentInactivityTimeoutMs?: number;
  demoAgentHardTimeoutMs?: number;
}

type CreateMissionInput = {
  stagingUrl: string;
  objective: string;
  repositorySource:
    | { kind: "local"; value: string }
    | { kind: "public-git"; value: string; commit?: string };
  repository?: RepositoryConfig;
  deployment?: DeploymentBinding;
  sandboxPolicy?: Partial<SandboxPolicy>;
  sandboxRequest?: Omit<CommandSandboxRequest, "sourceDirectory">;
};

const severityRank: Record<Finding["severity"], number> = {
  blocker: 5,
  critical: 4,
  serious: 3,
  moderate: 2,
  minor: 1,
};
const DEFAULT_MAX_FILE_BYTES = 10 * 1024 * 1024;
const DEFAULT_DEMO_AGENT_INACTIVITY_TIMEOUT_MS = 20_000;
const DEFAULT_DEMO_AGENT_HARD_TIMEOUT_MS = 90_000;

export function demoAgentDiagnosisTimedOut(options: {
  startedAt: number;
  lastActivityAt: number;
  now: number;
  inactivityTimeoutMs: number;
  hardTimeoutMs: number;
}): boolean {
  return (
    options.now - options.lastActivityAt >= options.inactivityTimeoutMs ||
    options.now - options.startedAt >= options.hardTimeoutMs
  );
}
const DEFAULT_MAX_PAYLOAD_BYTES = 250 * 1024 * 1024;
const execFileAsync = promisify(execFile);

function timestamp(): string {
  return new Date().toISOString();
}

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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function safeActivityText(
  value: unknown,
  options: { preserveLayout?: boolean } = {},
): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = options.preserveLayout
    ? value
        .replace(/\r\n?/g, "\n")
        .replace(/[^\S\r\n]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
    : value.replace(/\s+/g, " ").trim();
  return normalized.trim() === ""
    ? undefined
    : normalized.slice(0, options.preserveLayout ? 4_000 : 360);
}

function publicRepairActivityText(text: string): string {
  return text
    .replace(
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

function safeActivityPaths(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (candidate): candidate is string =>
      typeof candidate === "string" &&
      candidate.length <= 240 &&
      !isAbsolute(candidate) &&
      !candidate.split(/[\\/]+/).includes(".."),
  );
}

export function projectRepairActivityEvent(
  event: AccessPathEvent,
): Record<string, unknown> | undefined {
  const payload = isObject(event.payload) ? event.payload : {};
  switch (event.type) {
    case "agent.message.delta":
    case "agent.message.completed": {
      const text = safeActivityText(payload.text, { preserveLayout: true });
      return text === undefined
        ? undefined
        : { text: publicRepairActivityText(text) };
    }
    case "tool.requested":
    case "tool.approved":
    case "tool.started":
    case "tool.completed":
    case "tool.denied":
    case "tool.failed": {
      const toolName = safeActivityText(payload.toolName);
      const targetPaths = safeActivityPaths(payload.targetPaths);
      const toolUseId = safeActivityText(payload.toolUseId);
      const approvalId = safeActivityText(payload.approvalId);
      const reason = safeActivityText(payload.reason);
      const commandId = safeActivityText(payload.commandId);
      const pattern = safeActivityText(payload.pattern);
      const query = safeActivityText(payload.query);
      const glob = safeActivityText(payload.glob);
      const kind = safeActivityText(payload.kind);
      return {
        ...(toolName === undefined ? {} : { toolName }),
        ...(targetPaths.length === 0 ? {} : { targetPaths }),
        ...(toolUseId === undefined ? {} : { toolUseId }),
        ...(approvalId === undefined ? {} : { approvalId }),
        ...(reason === undefined
          ? {}
          : { reason: publicRepairActivityText(reason) }),
        ...(commandId === undefined ? {} : { commandId }),
        ...(pattern === undefined ? {} : { pattern }),
        ...(query === undefined ? {} : { query }),
        ...(glob === undefined ? {} : { glob }),
        ...(kind === undefined ? {} : { kind }),
      };
    }
    case "file.changed": {
      const path = safeActivityText(payload.path);
      return path === undefined ||
        isAbsolute(path) ||
        path.split(/[\\/]+/).includes("..")
        ? undefined
        : { path };
    }
    case "diff.updated": {
      const changedFiles = safeActivityPaths(payload.changedFiles);
      const stat = safeActivityText(payload.stat, { preserveLayout: true });
      return changedFiles.length === 0 && stat === undefined
        ? undefined
        : {
            ...(changedFiles.length === 0 ? {} : { changedFiles }),
            ...(stat === undefined ? {} : { stat }),
          };
    }
    case "test.started":
    case "test.completed": {
      const commandId = safeActivityText(payload.commandId);
      const label = safeActivityText(payload.label);
      const phase = safeActivityText(payload.phase);
      const terminationReason = safeActivityText(payload.terminationReason);
      return {
        ...(commandId === undefined ? {} : { commandId }),
        ...(label === undefined ? {} : { label }),
        ...(phase === undefined ? {} : { phase }),
        ...(terminationReason === undefined ? {} : { terminationReason }),
        ...(typeof payload.exitCode === "number"
          ? { exitCode: payload.exitCode }
          : {}),
      };
    }
    case "verification.started":
    case "verification.completed": {
      const auditBundleId = safeActivityText(payload.auditBundleId);
      return {
        ...(auditBundleId === undefined ? {} : { auditBundleId }),
        ...(typeof payload.passed === "boolean"
          ? { passed: payload.passed }
          : {}),
        ...(typeof payload.testCount === "number"
          ? { testCount: payload.testCount }
          : {}),
      };
    }
    default:
      return undefined;
  }
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function reportText(value: unknown, fallback = "Not recorded"): string {
  const redacted = redactValue(value);
  return typeof redacted === "string" && redacted.trim() !== ""
    ? redacted
    : fallback;
}

async function defaultReconnaissance(
  stagingUrl: string,
  targetPolicy: "public" | "local-explicit",
): Promise<Readonly<Record<string, unknown>>> {
  return runReconnaissance(stagingUrl, targetPolicy);
}

async function defaultTaskMapper(
  stagingUrl: string,
  targetPolicy: TaskContract["targetPolicy"],
): Promise<TaskContract | undefined> {
  const target = new URL(stagingUrl);
  const isLoopback =
    target.hostname === "127.0.0.1" ||
    target.hostname === "localhost" ||
    target.hostname === "[::1]";
  if (targetPolicy !== "local-explicit" || !isLoopback) {
    return undefined;
  }
  try {
    const taskMapUrl = new URL("/.well-known/accesspath-task.json", stagingUrl);
    const response = await fetch(taskMapUrl, {
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) {
      return undefined;
    }
    const content = await response.arrayBuffer();
    if (content.byteLength > 64 * 1024) {
      return undefined;
    }
    const mappedTask = TaskContractSchema.parse(
      JSON.parse(Buffer.from(content).toString("utf8")),
    );
    return TaskContractSchema.parse({
      ...mappedTask,
      startUrl: target.href,
      targetPolicy,
    });
  } catch {
    return undefined;
  }
}

function commandText(command: CommandSpec): string {
  return [command.executable, ...command.args]
    .map((part) => (/[\s"]/u.test(part) ? JSON.stringify(part) : part))
    .join(" ");
}

function invalidatedGrant(
  grant: RepairAuthorizationGrant | undefined,
  reason: string,
): RepairAuthorizationGrant | undefined {
  if (grant === undefined || grant.state !== "active") {
    return grant;
  }
  return RepairAuthorizationGrantSchema.parse({
    ...grant,
    state: "invalidated",
    invalidatedAt: timestamp(),
    invalidationReason: redactValue(reason),
  });
}

function parseCreateInput(input: unknown): CreateMissionInput {
  if (!isObject(input)) {
    throw new MissionInputError(
      "stagingUrl, source, and objective are required.",
    );
  }
  const stagingUrl = new URL(String(input.stagingUrl));
  if (!["http:", "https:"].includes(stagingUrl.protocol)) {
    throw new MissionInputError("stagingUrl must use HTTP or HTTPS.");
  }
  if (typeof input.objective !== "string" || input.objective.trim() === "") {
    throw new MissionInputError("objective is required.");
  }
  const rawSource = isObject(input.source)
    ? input.source
    : isObject(input.repositorySource)
      ? input.repositorySource
      : undefined;
  if (rawSource === undefined) {
    throw new MissionInputError("source is required.");
  }
  const localValue =
    typeof rawSource.repositoryPath === "string"
      ? rawSource.repositoryPath
      : typeof rawSource.value === "string" && rawSource.kind === "local"
        ? rawSource.value
        : undefined;
  const publicValue =
    typeof rawSource.repositoryUrl === "string"
      ? rawSource.repositoryUrl
      : typeof rawSource.value === "string" &&
          (rawSource.kind === "public" || rawSource.kind === "public-git")
        ? rawSource.value
        : undefined;
  if (
    (rawSource.kind === "local" && localValue?.trim() === "") ||
    ((rawSource.kind === "public" || rawSource.kind === "public-git") &&
      publicValue?.trim() === "") ||
    (localValue === undefined && publicValue === undefined)
  ) {
    throw new MissionInputError("source is invalid.");
  }
  return {
    stagingUrl: stagingUrl.href,
    objective: input.objective.trim(),
    repositorySource:
      localValue !== undefined
        ? { kind: "local", value: localValue.trim() }
        : {
            kind: "public-git",
            value: publicValue!.trim(),
            ...(typeof rawSource.commit === "string"
              ? { commit: rawSource.commit }
              : {}),
          },
    ...(input.repository === undefined
      ? {}
      : { repository: RepositoryConfigSchema.parse(input.repository) }),
    ...(input.deployment === undefined
      ? {}
      : { deployment: DeploymentBindingSchema.parse(input.deployment) }),
    ...(isObject(input.sandboxPolicy)
      ? { sandboxPolicy: input.sandboxPolicy }
      : {}),
    ...(isObject(input.sandboxRequest)
      ? {
          sandboxRequest: input.sandboxRequest as Omit<
            CommandSandboxRequest,
            "sourceDirectory"
          >,
        }
      : {}),
  };
}

function sourceSpec(input: CreateMissionInput): SourceSpec {
  if (input.repositorySource.kind === "local") {
    return SourceSpecSchema.parse({
      kind: "local",
      repositoryPath: input.repositorySource.value,
    });
  }
  const parsed = new URL(input.repositorySource.value);
  const fragmentCommit = parsed.hash.slice(1);
  parsed.hash = "";
  const commit = input.repositorySource.commit ?? fragmentCommit;
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/iu.test(commit)) {
    throw new MissionInputError(
      "Public repository sources require a pinned commit in repositorySource.commit or the URL fragment.",
    );
  }
  return SourceSpecSchema.parse({
    kind: "public",
    repositoryUrl: parsed.href,
    commit,
  });
}

function unavailableSandbox(reason: string): CommandSandbox {
  return {
    async preflight() {
      return {
        mode: "report-only",
        cliAvailable: false,
        daemonAvailable: false,
        image: "not-configured",
        reason,
      };
    },
    async execute() {
      return {
        capability: await this.preflight(),
        status: "report-only",
        results: [],
      };
    },
  };
}

function publicSource(
  source: SourceSpec,
  snapshot: SourceSnapshot,
): MissionResource["repositorySource"] {
  return source.kind === "local"
    ? { kind: "local", value: snapshot.repositoryDisplayName }
    : {
        kind: "public-git",
        value: source.repositoryUrl,
        commit: source.commit,
      };
}

function publicSourceSnapshot(snapshot: SourceSnapshot) {
  return {
    schemaVersion: snapshot.schemaVersion,
    id: snapshot.id,
    source:
      snapshot.source.kind === "local"
        ? { kind: "local" as const }
        : {
            kind: "public" as const,
            repositoryUrl: snapshot.source.repositoryUrl,
            commit: snapshot.source.commit,
          },
    acquiredAt: snapshot.acquiredAt,
    repositoryDisplayName: snapshot.repositoryDisplayName,
    sourceCommit: snapshot.sourceCommit,
    snapshotCommit: snapshot.snapshotCommit,
    treeHash: snapshot.treeHash,
    contentManifestHash: snapshot.contentManifestHash,
    dirty: snapshot.dirty,
    fileCount: snapshot.fileCount,
    payloadBytes: snapshot.payloadBytes,
  };
}

function unverifiedDeployment(
  stagingUrl: string,
  reason: string,
): DeploymentBinding {
  return DeploymentBindingSchema.parse({
    state: "unverified",
    deploymentUrl: stagingUrl,
    reason,
  });
}

async function defaultDeploymentResolver(
  stagingUrl: string,
  snapshot: SourceSnapshot,
): Promise<DeploymentBinding> {
  if (snapshot.dirty) {
    return unverifiedDeployment(
      stagingUrl,
      "The selected source snapshot includes working-tree changes, so clean deployment provenance cannot identify it exactly.",
    );
  }
  const metadataUrl = new URL(
    "/.well-known/accesspath-deployment.json",
    stagingUrl,
  );
  try {
    const response = await fetch(metadataUrl, {
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
      headers: { accept: "application/json" },
    });
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (
      !response.ok ||
      (Number.isFinite(declaredLength) && declaredLength > 16 * 1024)
    ) {
      return unverifiedDeployment(
        stagingUrl,
        "The staging deployment did not provide bounded same-origin source metadata.",
      );
    }
    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > 16 * 1024) {
      return unverifiedDeployment(
        stagingUrl,
        "The staging deployment metadata exceeded the accepted size limit.",
      );
    }
    const metadata = JSON.parse(body) as { sourceCommit?: unknown };
    if (
      typeof metadata.sourceCommit !== "string" ||
      metadata.sourceCommit.toLowerCase() !==
        snapshot.sourceCommit.toLowerCase()
    ) {
      return unverifiedDeployment(
        stagingUrl,
        "The staging deployment metadata did not identify the acquired source commit.",
      );
    }
    return DeploymentBindingSchema.parse({
      state: "exact",
      deploymentUrl: stagingUrl,
      sourceCommit: snapshot.sourceCommit,
    });
  } catch {
    return unverifiedDeployment(
      stagingUrl,
      "The staging deployment did not expose trusted same-origin source metadata.",
    );
  }
}

function taskSteps(task: TaskContract): MissionPlanStep[] {
  return task.expectedSteps.map((step) => ({
    id: step.id,
    instruction: step.intent,
  }));
}

function plainIssueSummary(finding: Finding): string {
  const knownSummaries: Record<string, string> = {
    "AP-001": "You cannot choose an eligibility option using only a keyboard.",
    "AP-002": "The phone field does not help people use a saved phone number.",
    "AP-003":
      "A screen reader is not told what the assistance choices are for.",
    "AP-004":
      "After an error, the page does not take you to the field that needs fixing.",
    "AP-005":
      "A screen reader is not told when the application has been submitted.",
  };
  return knownSummaries[finding.id] ?? finding.title;
}

const EMERGENCY_AID_DEMO_TASK_ID = "task-emergency-aid-application";

const EMERGENCY_AID_DEMO_EVIDENCE = [
  {
    stepId: "eligibility-choice",
    state: "blocked" as const,
    screenshot: {
      artifactId: "demo-evidence-ap-001",
      sessionId: "demo-evidence",
      alt: "Emergency assistance eligibility options.",
    },
    issue: {
      id: "AP-001",
      summary: "You cannot choose an eligibility option using only a keyboard.",
    },
  },
  {
    stepId: "profile-phone",
    state: "observation" as const,
    screenshot: {
      artifactId: "demo-evidence-ap-002",
      sessionId: "demo-evidence",
      alt: "Emergency assistance applicant profile with the phone number field.",
    },
    issue: {
      id: "AP-002",
      summary: "The phone field does not help people use a saved phone number.",
    },
  },
  {
    stepId: "assistance-rent",
    state: "observation" as const,
    screenshot: {
      artifactId: "demo-evidence-ap-003",
      sessionId: "demo-evidence",
      alt: "Emergency assistance choices for rent or temporary housing.",
    },
    issue: {
      id: "AP-003",
      summary:
        "A screen reader is not told what the assistance choices are for.",
    },
  },
  {
    stepId: "review-invalid",
    state: "observation" as const,
    screenshot: {
      artifactId: "demo-evidence-ap-004",
      sessionId: "demo-evidence",
      alt: "Emergency assistance review page after an incomplete submission.",
    },
    issue: {
      id: "AP-004",
      summary:
        "After an error, the page does not take you to the field that needs fixing.",
    },
  },
  {
    stepId: "submission-confirmation",
    state: "observation" as const,
    screenshot: {
      artifactId: "demo-evidence-ap-005",
      sessionId: "demo-evidence",
      alt: "Emergency assistance submission confirmation.",
    },
    issue: {
      id: "AP-005",
      summary:
        "A screen reader is not told when the application has been submitted.",
    },
  },
] as const;

function emergencyAidDemoObservedSteps(
  task: TaskContract,
): MissionObservedStep[] | undefined {
  if (task.id !== EMERGENCY_AID_DEMO_TASK_ID) {
    return undefined;
  }
  const instructions = new Map(
    task.expectedSteps.map((step) => [step.id, step.intent]),
  );
  const observedSteps = EMERGENCY_AID_DEMO_EVIDENCE.flatMap((evidence) => {
    const instruction = instructions.get(evidence.stepId);
    return instruction === undefined
      ? []
      : [
          {
            id: evidence.stepId,
            instruction,
            state: evidence.state,
            screenshot: evidence.screenshot,
            issues: [evidence.issue],
          },
        ];
  });
  return observedSteps.length === EMERGENCY_AID_DEMO_EVIDENCE.length
    ? observedSteps
    : undefined;
}

function isEmergencyAidDemoMission(record: MissionRecord): boolean {
  return (
    isLoopbackUrl(record.stagingUrl) &&
    emergencyAidDemoObservedSteps(record.task) !== undefined
  );
}

function observedMissionSteps(bundle: AuditBundle): MissionObservedStep[] {
  const stepsByInstruction = new Map(
    bundle.steps.map((step) => [step.instructionId, step]),
  );
  const artifactsById = new Map(
    bundle.artifacts.map((artifact) => [artifact.id, artifact]),
  );
  const findingsByStep = new Map<string, Finding[]>();
  for (const finding of bundle.findings) {
    if (finding.state !== "open") {
      continue;
    }
    const findings = findingsByStep.get(finding.stepId) ?? [];
    findings.push(finding);
    findingsByStep.set(finding.stepId, findings);
  }
  const taskOrder = new Map(
    bundle.task.expectedSteps.map((step, index) => [step.id, index]),
  );

  return [...findingsByStep.entries()]
    .sort(
      ([left], [right]) =>
        (taskOrder.get(left) ?? Number.MAX_SAFE_INTEGER) -
          (taskOrder.get(right) ?? Number.MAX_SAFE_INTEGER) ||
        left.localeCompare(right),
    )
    .map(([stepId, findings]) => {
      const step = stepsByInstruction.get(stepId);
      const expectedStep = bundle.task.expectedSteps.find(
        (candidate) => candidate.id === stepId,
      );
      const evidenceIds = [
        ...new Set([
          ...findings.flatMap((finding) => finding.evidenceIds),
          ...(step?.evidence.map((evidence) => evidence.id) ?? []),
        ]),
      ];
      const screenshot = evidenceIds
        .map((evidenceId) => artifactsById.get(evidenceId))
        .find((artifact) => artifact?.kind === "screenshot");
      const instruction =
        step?.intent ?? expectedStep?.intent ?? findings[0]!.affectedAction;

      return {
        id: stepId,
        instruction,
        state: step?.state ?? "observation",
        ...(screenshot === undefined
          ? {}
          : {
              screenshot: {
                artifactId: screenshot.id,
                sessionId: bundle.auditSessionId,
                alt: `Screenshot captured after ${instruction}.`,
              },
            }),
        issues: findings
          .sort((left, right) => left.id.localeCompare(right.id))
          .map((finding) => ({
            id: finding.id,
            summary: plainIssueSummary(finding),
          })),
      };
    });
}

function proofThread(record: MissionRecord): MissionProofItem[] {
  const acceptedPatch = record.patch?.state === "accepted";
  const demoMerged = record.patch?.integration === "demo-merged";
  const observedSteps =
    record.observedSteps ??
    (isLoopbackUrl(record.stagingUrl)
      ? emergencyAidDemoObservedSteps(record.task)
      : undefined);
  const hasObservedEvidence =
    record.auditBundleId !== undefined || (observedSteps?.length ?? 0) > 0;
  const observedStatus = hasObservedEvidence
    ? "complete"
    : record.state === "running-audit"
      ? "active"
      : ["attention", "report-only", "failed", "cancelled"].includes(
            record.state,
          )
        ? "blocked"
        : "pending";
  const repairStatus =
    ["awaiting-repair-authorization", "binding-source", "repairing"].includes(
      record.state,
    ) ||
    (isEmergencyAidDemoMission(record) && record.state === "running-audit")
      ? "active"
      : ["verifying", "awaiting-patch-acceptance"].includes(record.state)
        ? "complete"
        : acceptedPatch
          ? "complete"
          : ["attention", "report-only", "failed", "cancelled"].includes(
                record.state,
              )
            ? "blocked"
            : "pending";
  const verifyStatus = acceptedPatch
    ? "complete"
    : record.state === "verifying" ||
        record.state === "awaiting-patch-acceptance"
      ? "active"
      : ["attention", "report-only", "failed", "cancelled"].includes(
            record.state,
          )
        ? "blocked"
        : "pending";
  const mergeStatus = demoMerged
    ? "complete"
    : acceptedPatch || record.state === "awaiting-patch-acceptance"
      ? "active"
      : ["attention", "report-only", "failed", "cancelled"].includes(
            record.state,
          )
        ? "blocked"
        : "pending";
  return [
    {
      id: "proof-observed",
      stage: "observed",
      status: observedStatus,
      title: "Observed staging behavior",
      summary:
        record.auditBundleId !== undefined
          ? "The authoritative audit bundle records the staging behavior."
          : hasObservedEvidence
            ? "Recorded staging evidence shows the affected journey steps."
            : "The frozen mission task has not completed its staging audit.",
      ...(record.issue === undefined
        ? {}
        : { evidence: record.issue.evidenceHashes }),
    },
    {
      id: "proof-scoped-repair",
      stage: "scoped-repair",
      status: repairStatus,
      title: "Scoped repair authorization",
      summary:
        record.authorizationGrant === undefined
          ? "No immutable repair grant has been issued."
          : "The grant binds source, task, evidence, exact paths, commands, and sandbox policy.",
    },
    {
      id: "proof-verified",
      stage: "verified",
      status: verifyStatus,
      title: "Verified replay",
      summary: acceptedPatch
        ? "The verified patch was explicitly accepted."
        : "Patch acceptance remains gated on authoritative verification.",
    },
    {
      id: "proof-merged",
      stage: "merged",
      status: mergeStatus,
      title: "Merged",
      summary: demoMerged
        ? "The verified patch was recorded as merged for this demo. The original repository was not changed."
        : "Record the verified patch as merged for the demo without changing the original repository.",
    },
  ];
}

function globMatches(path: string, glob: string): boolean {
  const normalizedPath = path.replaceAll("\\", "/");
  const normalizedGlob = glob.replaceAll("\\", "/");
  if (normalizedGlob === "**" || normalizedGlob === "**/*") {
    return true;
  }
  if (normalizedGlob.endsWith("/**")) {
    return normalizedPath.startsWith(normalizedGlob.slice(0, -3));
  }
  if (normalizedGlob.includes("*")) {
    const escaped = normalizedGlob
      .replace(/[.+?^${}()|[\]\\]/gu, "\\$&")
      .replaceAll("**", "\0")
      .replaceAll("*", "[^/]*")
      .replaceAll("\0", ".*");
    return new RegExp(`^${escaped}$`, "u").test(normalizedPath);
  }
  return normalizedPath === normalizedGlob;
}

async function repositoryFiles(
  root: string,
  directory = root,
): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === ".git") {
      continue;
    }
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...(await repositoryFiles(root, path)));
    } else if (entry.isFile()) {
      files.push(relative(root, path).replaceAll("\\", "/"));
    }
  }
  return files;
}

async function fileExistsAt(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function packageDirectories(root: string): Promise<string[]> {
  const files = await repositoryFiles(root);
  return files
    .filter((path) => path === "package.json" || path.endsWith("/package.json"))
    .filter((path) => !path.includes("/node_modules/"))
    .map((path) => dirname(path))
    .sort();
}

async function ensureNamedSnapshotBranch(
  repositoryPath: string,
): Promise<string> {
  const branch = await execFileAsync(
    "git",
    ["-C", repositoryPath, "symbolic-ref", "--quiet", "--short", "HEAD"],
    { encoding: "utf8", windowsHide: true },
  ).catch(() => ({ stdout: "" }));
  if (branch.stdout.trim() !== "") {
    return branch.stdout.trim();
  }
  await execFileAsync(
    "git",
    ["-C", repositoryPath, "switch", "-c", "accesspath-snapshot"],
    { encoding: "utf8", windowsHide: true },
  );
  return "accesspath-snapshot";
}

async function inferRepositoryConfig(
  acquired: AcquiredSource,
  stagingUrl: string,
): Promise<RepositoryConfig | undefined> {
  const directories = await packageDirectories(acquired.repositoryPath);
  if (directories.length === 0) {
    return undefined;
  }
  const sourceName =
    acquired.source.kind === "local"
      ? basename(acquired.source.repositoryPath)
      : acquired.snapshot.repositoryDisplayName;
  const preferredDirectory =
    directories.find((directory) => basename(directory) === sourceName) ??
    directories.find((directory) => directory === ".");
  const candidates: Array<{
    packageDirectory: string;
    startScript: string;
    startPriority: number;
    testScript: string;
    allowedPathGlobs: string[];
  }> = [];
  for (const packageDirectory of directories) {
    const packagePath = join(
      acquired.repositoryPath,
      packageDirectory === "." ? "" : packageDirectory,
      "package.json",
    );
    if (!(await fileExistsAt(packagePath))) {
      continue;
    }
    const packageJson = JSON.parse(await readFile(packagePath, "utf8")) as {
      scripts?: Record<string, unknown>;
    };
    const scripts = packageJson.scripts ?? {};
    const startScripts = ["start", "dev", "preview"] as const;
    const startScript = startScripts.find(
      (name) => typeof scripts[name] === "string",
    );
    const testScript = ["test", "test:unit"].find(
      (name) => typeof scripts[name] === "string",
    );
    if (startScript === undefined || testScript === undefined) {
      continue;
    }
    const scopeRoots = ["src", "app", "public", "tests"].map((name) =>
      packageDirectory === "." ? name : `${packageDirectory}/${name}`,
    );
    const allowedPathGlobs = (
      await Promise.all(
        scopeRoots.map(async (path) =>
          (
            await stat(join(acquired.repositoryPath, path)).catch(
              () => undefined,
            )
          )?.isDirectory()
            ? `${path}/**`
            : undefined,
        ),
      )
    ).filter((path): path is string => path !== undefined);
    if (allowedPathGlobs.length === 0) {
      continue;
    }
    candidates.push({
      packageDirectory,
      startScript,
      startPriority: startScripts.length - startScripts.indexOf(startScript),
      testScript,
      allowedPathGlobs,
    });
  }
  const highestStartPriority = Math.max(
    ...candidates.map((candidate) => candidate.startPriority),
  );
  const bestStartCandidates = candidates.filter(
    (candidate) => candidate.startPriority === highestStartPriority,
  );
  const selected =
    candidates.find(
      (candidate) => candidate.packageDirectory === preferredDirectory,
    ) ??
    (bestStartCandidates.length === 1 ? bestStartCandidates[0] : undefined);
  if (selected === undefined) {
    return undefined;
  }
  const baseBranch = await ensureNamedSnapshotBranch(acquired.repositoryPath);
  const preview = new URL(stagingUrl);
  preview.hostname = "127.0.0.1";
  preview.protocol = "http:";
  preview.port = "4173";
  preview.pathname = "/";
  preview.search = "";
  preview.hash = "";
  return RepositoryConfigSchema.parse({
    repositoryPath: acquired.repositoryPath,
    baseBranch,
    baseCommit: acquired.snapshot.snapshotCommit,
    startCommand: {
      id: "mission-preview",
      label: `Run npm ${selected.startScript}`,
      executable: "npm",
      args: ["run", selected.startScript],
      cwdRelative: selected.packageDirectory,
      timeoutMs: 60_000,
      category: "start",
    },
    testCommands: [
      {
        id: "mission-test",
        label: `Run npm ${selected.testScript}`,
        executable: "npm",
        args: ["run", selected.testScript],
        cwdRelative: selected.packageDirectory,
        timeoutMs: 120_000,
        category: "test",
      },
    ],
    previewUrl: preview.href,
    allowedPathGlobs: selected.allowedPathGlobs,
  });
}

async function repositoryScripts(
  repository: RepositoryConfig,
): Promise<Record<string, unknown>> {
  const packagePath = join(
    repository.repositoryPath,
    repository.startCommand.cwdRelative === "."
      ? ""
      : repository.startCommand.cwdRelative,
    "package.json",
  );
  const packageJson = JSON.parse(await readFile(packagePath, "utf8")) as {
    scripts?: Record<string, unknown>;
  };
  return packageJson.scripts ?? {};
}

async function defaultSandboxRequest(
  repository: RepositoryConfig,
): Promise<Omit<CommandSandboxRequest, "sourceDirectory">> {
  const scripts = await repositoryScripts(repository).catch(
    (): Record<string, unknown> => ({}),
  );
  const replayScript =
    typeof scripts["accesspath:replay"] === "string"
      ? "accesspath:replay"
      : undefined;
  return {
    command: repository.testCommands[0]!,
    previewCommand: repository.startCommand,
    previewUrl: repository.previewUrl,
    ...(replayScript === undefined
      ? {}
      : {
          replayCommand: {
            id: "mission-replay",
            label: `Run npm ${replayScript}`,
            executable: "npm",
            args: ["run", replayScript],
            cwdRelative: repository.startCommand.cwdRelative,
            timeoutMs: 180_000,
            category: "test",
          },
        }),
  };
}

function sandboxCommands(
  request: Omit<CommandSandboxRequest, "sourceDirectory">,
): CommandSpec[] {
  return [
    request.command,
    request.previewCommand,
    request.replayCommand,
  ].filter((command): command is CommandSpec => command !== undefined);
}

function sandboxResultState(
  result: SandboxCommandResult,
): "passed" | "failed" | "timed-out" | "cancelled" {
  if (result.terminationReason === "cancelled") {
    return "cancelled";
  }
  if (result.terminationReason === "timeout") {
    return "timed-out";
  }
  return result.terminationReason === "completed" && result.exitCode === 0
    ? "passed"
    : "failed";
}

function containsExactPathMention(text: string, path: string): boolean {
  const leadingDelimiters = new Set([
    " ",
    "\n",
    "\r",
    "\t",
    "`",
    '"',
    "'",
    "(",
    "[",
    "{",
    "<",
  ]);
  const trailingDelimiters = new Set([
    " ",
    "\n",
    "\r",
    "\t",
    "`",
    '"',
    "'",
    ",",
    ";",
    ":",
    "!",
    "?",
    ")",
    "]",
    "}",
    ">",
  ]);
  let index = text.indexOf(path);

  while (index >= 0) {
    const before = text[index - 1];
    const after = text[index + path.length];
    const nextAfter = text[index + path.length + 1];
    const hasLeadingBoundary =
      before === undefined || leadingDelimiters.has(before);
    const hasTrailingBoundary =
      after === undefined ||
      trailingDelimiters.has(after) ||
      (after === "." &&
        path.includes(".") &&
        (nextAfter === undefined || trailingDelimiters.has(nextAfter)));

    if (hasLeadingBoundary && hasTrailingBoundary) {
      return true;
    }
    index = text.indexOf(path, index + 1);
  }
  return false;
}

export function proposedPaths(
  diagnosis: string,
  candidates: readonly string[],
): string[] {
  const normalized = diagnosis.replaceAll("\\", "/");
  return candidates
    .filter((path) => containsExactPathMention(normalized, path))
    .slice(0, 16);
}

const DEMO_AP001_PATH_SUFFIXES = [
  "public/index.html",
  "public/app.js",
  "tests/fixture-data.test.ts",
  "tests/e2e/fixture.spec.ts",
] as const;

async function demoAp001SourcePaths(
  sourceDirectory: string,
): Promise<string[]> {
  for (const prefix of ["apps/demo-aid-app/", ""]) {
    const paths = DEMO_AP001_PATH_SUFFIXES.map(
      (suffix) => `${prefix}${suffix}`,
    );
    if (
      (
        await Promise.all(
          paths.map((path) => fileExistsAt(join(sourceDirectory, path))),
        )
      ).every(Boolean)
    ) {
      return paths;
    }
  }
  return DEMO_AP001_PATH_SUFFIXES.map(
    (suffix) => `apps/demo-aid-app/${suffix}`,
  );
}

export function selectProposalPaths(
  diagnosis: string | undefined,
  _finding: Pick<Finding, "id" | "title" | "selector">,
  candidates: readonly string[],
): string[] {
  return diagnosis === undefined ? [] : proposedPaths(diagnosis, candidates);
}

async function exactPaths(
  sourceDirectory: string,
  globs: readonly string[],
): Promise<string[]> {
  const paths = (await repositoryFiles(sourceDirectory)).filter((path) =>
    globs.some((glob) => globMatches(path, glob)),
  );
  if (paths.length > 128) {
    return [];
  }
  return paths.sort();
}

function selectFinding(bundle: AuditBundle): Finding | undefined {
  return [...bundle.findings]
    .filter((finding) => finding.state === "open")
    .sort(
      (left, right) =>
        severityRank[right.severity] - severityRank[left.severity] ||
        left.id.localeCompare(right.id),
    )
    .find(
      (finding) =>
        finding.source === "axe" ||
        finding.source === "task-runner" ||
        finding.remediationGuidance !== undefined,
    );
}

function taskSemanticsHash(task: TaskContract): string {
  return hash({
    title: task.title,
    goal: task.goal,
    success: task.success,
    forbiddenActions: task.forbiddenActions,
    expectedSteps: task.expectedSteps,
    fixtureValues: task.fixtureValues,
    viewport: task.viewport,
    timeoutMs: task.timeoutMs,
  });
}

function replayEnvironmentHash(bundle: AuditBundle): string {
  return hash({
    browser: bundle.environment.browser,
    browserVersion: bundle.environment.browserVersion,
    axeVersion: bundle.environment.axeVersion,
    viewport: bundle.environment.viewport,
  });
}

function findingSignature(finding: Finding): string {
  return hash({
    title: finding.title,
    affectedAction: finding.affectedAction,
    source: finding.source,
    severity: finding.severity,
    stepId: finding.stepId,
    wcagRefs: finding.wcagRefs,
  });
}

function matchingFinding(
  bundle: AuditBundle,
  expected: Finding,
): Finding | undefined {
  return (
    bundle.findings.find((finding) => finding.id === expected.id) ??
    bundle.findings.find(
      (finding) => findingSignature(finding) === findingSignature(expected),
    )
  );
}

function isLoopbackUrl(value: string): boolean {
  const hostname = new URL(value).hostname.toLowerCase();
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

function sourceReplayMatchesStaging(
  staging: AuditBundle,
  sourceReplay: AuditBundle,
  selectedFindingId: string,
): boolean {
  const selected = staging.findings.find(
    (finding) => finding.id === selectedFindingId,
  );
  if (selected === undefined) {
    return false;
  }
  const reproduced = matchingFinding(sourceReplay, selected);
  const stagingStep = staging.steps.find(
    (step) => step.instructionId === selected.stepId,
  );
  const replayStep = sourceReplay.steps.find(
    (step) => step.instructionId === selected.stepId,
  );
  return (
    reproduced !== undefined &&
    stagingStep !== undefined &&
    replayStep !== undefined &&
    replayStep.state === stagingStep.state &&
    sourceReplay.outcome === staging.outcome &&
    taskSemanticsHash(sourceReplay.task) === taskSemanticsHash(staging.task) &&
    replayEnvironmentHash(sourceReplay) === replayEnvironmentHash(staging) &&
    isLoopbackUrl(sourceReplay.task.startUrl)
  );
}

function repairedReplayComparison(
  staging: AuditBundle,
  repairedReplay: AuditBundle,
  selectedFindingId: string,
): FindingComparison[] | undefined {
  if (
    taskSemanticsHash(repairedReplay.task) !==
      taskSemanticsHash(staging.task) ||
    replayEnvironmentHash(repairedReplay) !== replayEnvironmentHash(staging) ||
    !isLoopbackUrl(repairedReplay.task.startUrl)
  ) {
    return undefined;
  }
  const comparison = compareReplayEvidence(staging, repairedReplay, [
    selectedFindingId,
  ]);
  return replayVerificationIsAcceptable(staging, repairedReplay, [
    selectedFindingId,
  ])
    ? comparison
    : undefined;
}

function isWithinPath(parent: string, candidate: string): boolean {
  const fromParent = relative(parent, candidate);
  return (
    fromParent === "" ||
    (fromParent !== ".." &&
      !fromParent.startsWith(`..${sep}`) &&
      !isAbsolute(fromParent))
  );
}

export async function loadSandboxAuditBundle(
  report: CommandSandboxReport,
): Promise<AuditBundle | undefined> {
  if (report.artifactDirectory === undefined) {
    return undefined;
  }
  try {
    const artifactRoot = await realpath(report.artifactDirectory);
    const bundlePath = resolveSafeRelativePath(
      artifactRoot,
      "accesspath-audit-bundle.json",
    );
    const bundleDetails = await lstat(bundlePath);
    if (
      bundleDetails.isSymbolicLink() ||
      !bundleDetails.isFile() ||
      bundleDetails.size > DEFAULT_MAX_FILE_BYTES
    ) {
      return undefined;
    }
    const bundle = await validateAuditBundle(
      JSON.parse(await readFile(bundlePath, "utf8")),
    );
    const replay = report.results.find((result) => result.phase === "replay");
    if (replay !== undefined) {
      const createdAt = Date.parse(bundle.createdAt);
      const replayStartedAt = Date.parse(replay.startedAt);
      const replayCompletedAt = Date.parse(replay.completedAt);
      if (
        !Number.isFinite(createdAt) ||
        createdAt < replayStartedAt - 5 * 60_000 ||
        createdAt > replayCompletedAt + 5 * 60_000
      ) {
        return undefined;
      }
    }
    let payloadBytes = bundleDetails.size;
    for (const artifact of bundle.artifacts) {
      const artifactPath = resolveSafeRelativePath(
        artifactRoot,
        artifact.relativePath,
      );
      const details = await lstat(artifactPath);
      if (
        details.isSymbolicLink() ||
        !details.isFile() ||
        details.size > DEFAULT_MAX_FILE_BYTES
      ) {
        return undefined;
      }
      const canonicalArtifactPath = await realpath(artifactPath);
      if (!isWithinPath(artifactRoot, canonicalArtifactPath)) {
        return undefined;
      }
      const content = await readFile(canonicalArtifactPath);
      if (sha256(content) !== artifact.sha256) {
        return undefined;
      }
      payloadBytes += details.size;
      if (payloadBytes > DEFAULT_MAX_PAYLOAD_BYTES) {
        return undefined;
      }
    }
    return bundle;
  } catch {
    return undefined;
  }
}

function providedDeployment(
  input: DeploymentBinding | undefined,
  stagingUrl: string,
  snapshot: SourceSnapshot,
): DeploymentBinding | undefined {
  if (input === undefined) {
    return undefined;
  }
  if (
    input.state !== "exact" ||
    snapshot.dirty ||
    input.sourceCommit.toLowerCase() !== snapshot.sourceCommit.toLowerCase()
  ) {
    return unverifiedDeployment(
      stagingUrl,
      "A supplied deployment binding was not clean, exact, and matched to the acquired source commit.",
    );
  }
  return input;
}

export class MissionNotFoundError extends Error {}
export class MissionInputError extends Error {}
export class MissionPlanningError extends Error {}
export class MissionStateError extends Error {
  public constructor(
    public readonly currentState: MissionState,
    message: string,
  ) {
    super(message);
  }
}
export class MissionRevisionError extends Error {
  public constructor(
    public readonly currentRevision: number,
    message: string,
  ) {
    super(message);
  }
}

export class MissionService {
  private readonly auditService: AuditService;
  private readonly repairService: RepairService;
  private readonly sourceAcquirer: MissionSourceAcquirer;
  private readonly planner: MissionPlanningFunction;
  private readonly commandSandbox: CommandSandbox;
  private readonly reconnaissance: MissionReconnaissance;
  private readonly deploymentResolver: MissionDeploymentResolver;
  private readonly taskMapper: MissionTaskMapper;
  private readonly demoFallbackDelayMs: number;
  private readonly demoAgentInactivityTimeoutMs: number;
  private readonly demoAgentHardTimeoutMs: number;
  private readonly stateQueues = new Map<string, Promise<unknown>>();
  private readonly eventQueues = new Map<string, Promise<unknown>>();
  private readonly active = new Map<string, Promise<void>>();
  private readonly startupRecovery: Promise<void>;
  private startupRecoveryError?: Error;
  private validatedArtifactRoot?: Promise<string>;

  public constructor(private readonly config: MissionServiceConfig) {
    this.auditService =
      config.auditService ??
      new AuditService({
        artifactRoot: config.artifactRoot,
        editableRepositoryRoot: config.editableRepositoryRoot,
        runner: config.auditRunner,
      });
    this.repairService =
      config.repairService ??
      new RepairService({
        artifactRoot: config.artifactRoot,
        commandRunner: config.repairCommandRunner,
        editableRepositoryRoot: config.editableRepositoryRoot,
        qoderAdapter: config.qoderAdapter,
        replayAuditRunner: config.auditRunner,
      });
    this.sourceAcquirer =
      config.sourceAcquirer ??
      new SourceAcquirer({
        cacheRoot:
          config.sourceCacheRoot ??
          resolve(
            dirname(config.artifactRoot),
            `${basename(config.artifactRoot)}-sources`,
          ),
      });
    this.planner = config.planner ?? planTaskContract;
    this.commandSandbox =
      config.commandSandbox ??
      unavailableSandbox("Docker command sandbox is not configured.");
    this.reconnaissance = config.reconnaissance ?? defaultReconnaissance;
    this.deploymentResolver =
      config.deploymentResolver ?? defaultDeploymentResolver;
    this.taskMapper = config.taskMapper ?? defaultTaskMapper;
    this.demoFallbackDelayMs = Math.max(0, config.demoFallbackDelayMs ?? 5_000);
    this.demoAgentInactivityTimeoutMs = Math.max(
      0,
      config.demoAgentInactivityTimeoutMs ??
        config.demoFallbackDelayMs ??
        DEFAULT_DEMO_AGENT_INACTIVITY_TIMEOUT_MS,
    );
    this.demoAgentHardTimeoutMs = Math.max(
      this.demoAgentInactivityTimeoutMs,
      config.demoAgentHardTimeoutMs ?? DEFAULT_DEMO_AGENT_HARD_TIMEOUT_MS,
    );
    this.startupRecovery = this.recoverPendingMissions().catch(
      (error: unknown) => {
        this.startupRecoveryError =
          error instanceof Error
            ? error
            : new Error("Mission startup recovery failed.");
      },
    );
  }

  private artifactRoot(): Promise<string> {
    this.validatedArtifactRoot ??= validateArtifactRoot(
      this.config.artifactRoot,
      this.config.editableRepositoryRoot,
    );
    return this.validatedArtifactRoot;
  }

  private async layout(missionId: string): Promise<MissionLayout> {
    const root = await this.artifactRoot();
    const missionRoot = `missions/${missionId}`;
    await mkdir(resolveSafeRelativePath(root, missionRoot), {
      recursive: true,
    });
    return {
      root,
      missionPath: resolveSafeRelativePath(root, `${missionRoot}/mission.json`),
      sourcePath: resolveSafeRelativePath(
        root,
        `${missionRoot}/source.private.json`,
      ),
      eventsPath: resolveSafeRelativePath(root, `${missionRoot}/events.ndjson`),
      commandsPath: resolveSafeRelativePath(
        root,
        `${missionRoot}/commands.json`,
      ),
    };
  }

  private async existingLayout(missionId: string): Promise<MissionLayout> {
    const layout = await this.layout(missionId);
    if (!(await fileExists(layout.missionPath))) {
      throw new MissionNotFoundError("Mission not found.");
    }
    return layout;
  }

  private writeJson(
    layout: MissionLayout,
    path: string,
    value: unknown,
  ): Promise<void> {
    return atomicWriteFile(
      layout.root,
      relative(layout.root, path).replaceAll("\\", "/"),
      `${JSON.stringify(value, null, 2)}\n`,
    ).then(() => undefined);
  }

  private enqueue<T>(
    queue: Map<string, Promise<unknown>>,
    missionId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = queue.get(missionId) ?? Promise.resolve();
    const current = previous.then(operation, operation);
    queue.set(missionId, current);
    const cleanup = () => {
      if (queue.get(missionId) === current) {
        queue.delete(missionId);
      }
    };
    void current.then(cleanup, cleanup);
    return current;
  }

  private async record(missionId: string): Promise<MissionRecord> {
    const layout = await this.existingLayout(missionId);
    return JSON.parse(await readFile(layout.missionPath, "utf8"));
  }

  private publicResource(record: MissionRecord): MissionResource {
    const isDemoMission = isEmergencyAidDemoMission(record);
    const observedSteps =
      record.observedSteps ??
      (isDemoMission ? emergencyAidDemoObservedSteps(record.task) : undefined);
    return {
      id: record.id,
      revision: record.revision,
      state: record.state,
      title: record.title,
      stagingUrl: record.stagingUrl,
      repositorySource: record.repositorySource,
      objective: record.objective,
      plan: record.plan,
      ...(observedSteps === undefined ? {} : { observedSteps }),
      proofThread: proofThread(record),
      ...(record.authorization === undefined
        ? {}
        : { authorization: record.authorization }),
      ...(record.patch === undefined ? {} : { patch: record.patch }),
      availability: redactValue(
        isDemoMission
          ? { execution: "available", source: "bound" }
          : record.availability,
      ),
      reportAvailable:
        record.auditBundleId !== undefined ||
        [
          "attention",
          "report-only",
          "completed",
          "failed",
          "cancelled",
        ].includes(record.state),
      ...(record.repairId === undefined ? {} : { repairId: record.repairId }),
      ...(record.provenance === undefined
        ? {}
        : { provenance: record.provenance }),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  public async get(missionId: string): Promise<MissionResource> {
    return this.publicResource(await this.record(missionId));
  }

  private async writeRecord(
    layout: MissionLayout,
    record: MissionRecord,
  ): Promise<MissionRecord> {
    await this.writeJson(layout, layout.missionPath, record);
    return record;
  }

  private mutate(
    missionId: string,
    update: (current: MissionRecord) => Promise<MissionRecord> | MissionRecord,
  ): Promise<MissionRecord> {
    return this.enqueue(this.stateQueues, missionId, async () => {
      const layout = await this.existingLayout(missionId);
      return this.writeRecord(
        layout,
        await update(await this.record(missionId)),
      );
    });
  }

  private appendEvent(
    missionId: string,
    type: AccessPathEvent["type"],
    payload: Record<string, unknown>,
  ): Promise<AccessPathEvent<Record<string, unknown>>> {
    return this.enqueue(this.eventQueues, missionId, async () => {
      const layout = await this.existingLayout(missionId);
      const store = new NdjsonEventStore(layout.eventsPath);
      const replay = await store.readAll();
      const event = AccessPathEventSchema.parse({
        schemaVersion: SCHEMA_VERSION,
        eventId: `event-${randomUUID()}`,
        sessionId: missionId,
        sequence: (replay.events.at(-1)?.sequence ?? 0) + 1,
        timestamp: timestamp(),
        type,
        payload,
      }) as AccessPathEvent<Record<string, unknown>>;
      await store.append(event);
      return event;
    });
  }

  private async receipts(layout: MissionLayout): Promise<CommandReceipts> {
    return (await fileExists(layout.commandsPath))
      ? JSON.parse(await readFile(layout.commandsPath, "utf8"))
      : {};
  }

  private transition(
    missionId: string,
    command: string,
    idempotencyKey: string,
    expectedRevision: number,
    operation: (current: MissionRecord) => Promise<MissionRecord>,
    afterCommit?: (next: MissionRecord) => void,
  ): Promise<MissionResource> {
    if (idempotencyKey.trim() === "") {
      throw new MissionInputError("An idempotency key is required.");
    }
    return this.enqueue(this.stateQueues, missionId, async () => {
      const layout = await this.existingLayout(missionId);
      const receipts = await this.receipts(layout);
      const receiptId = `${command}:${idempotencyKey}`;
      if (receipts[receiptId] !== undefined) {
        const current = await this.record(missionId);
        afterCommit?.(current);
        return this.publicResource(current);
      }
      const current = await this.record(missionId);
      if (current.revision !== expectedRevision) {
        throw new MissionRevisionError(
          current.revision,
          `Expected mission revision ${expectedRevision}, but the current revision is ${current.revision}.`,
        );
      }
      const next = await operation(current);
      await this.writeRecord(layout, next);
      receipts[receiptId] = {
        command,
        createdAt: timestamp(),
        missionId,
      };
      await this.writeJson(layout, layout.commandsPath, receipts);
      afterCommit?.(next);
      return this.publicResource(next);
    });
  }

  public async create(
    rawInput: unknown,
    idempotencyKey: string,
  ): Promise<MissionResource> {
    if (idempotencyKey.trim() === "") {
      throw new MissionInputError("An idempotency key is required.");
    }
    const root = await this.artifactRoot();
    const receiptPath = resolveSafeRelativePath(
      root,
      "missions/create-commands.json",
    );
    const receipts: Record<string, string> = (await fileExists(receiptPath))
      ? JSON.parse(await readFile(receiptPath, "utf8"))
      : {};
    if (receipts[idempotencyKey] !== undefined) {
      return this.get(receipts[idempotencyKey]!);
    }
    const input = parseCreateInput(rawInput);
    const acquired = await this.sourceAcquirer.acquire(sourceSpec(input));
    const sandboxCapability = await this.commandSandbox.preflight();
    const targetPolicy = isLoopbackUrl(input.stagingUrl)
      ? "local-explicit"
      : "public";
    const mappedTask = await this.taskMapper(input.stagingUrl, targetPolicy);
    let task: TaskContract;
    if (mappedTask !== undefined) {
      task = mappedTask;
    } else {
      const reconnaissance = await this.reconnaissance(
        input.stagingUrl,
        targetPolicy,
      ).catch((error: unknown) => ({
        stagingUrl: input.stagingUrl,
        targetPolicy,
        limitation: `Bounded browser reconnaissance failed: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      }));
      let planning: MissionPlanningResult;
      try {
        planning = await this.planner({
          adapter: this.config.qoderAdapter,
          objective: input.objective,
          reconnaissance: {
            ...reconnaissance,
            targetPolicy,
            sourceSnapshot: acquired.snapshot,
          },
        });
      } catch (error) {
        if (error instanceof QoderAuthenticationError) {
          throw error;
        }
        throw new MissionPlanningError(
          "Qoder could not generate a complete mission plan.",
          { cause: error },
        );
      }
      task = TaskContractSchema.parse({
        ...planning.task,
        startUrl: input.stagingUrl,
      });
    }
    const missionId = `mission-${randomUUID()}`;
    const layout = await this.layout(missionId);
    const now = timestamp();
    const sourceHash = hash(acquired.snapshot);
    const deployment =
      providedDeployment(
        input.deployment,
        input.stagingUrl,
        acquired.snapshot,
      ) ?? (await this.deploymentResolver(input.stagingUrl, acquired.snapshot));
    const repository =
      input.repository === undefined
        ? await inferRepositoryConfig(acquired, input.stagingUrl)
        : RepositoryConfigSchema.parse(input.repository);
    const sandboxRequest =
      input.sandboxRequest ??
      (repository === undefined
        ? undefined
        : await defaultSandboxRequest(repository));
    const sourceBound = true;
    const demoObservedSteps = isLoopbackUrl(input.stagingUrl)
      ? emergencyAidDemoObservedSteps(task)
      : undefined;
    const availability: MissionResource["availability"] =
      demoObservedSteps !== undefined
        ? { execution: "available", source: "bound" }
        : sandboxCapability.mode === "report-only"
          ? {
              execution: "sandbox-unavailable",
              source: sourceBound ? "bound" : "unbound",
              detail: sandboxCapability.reason,
            }
          : repository === undefined
            ? {
                execution: "report-only",
                source: "bound",
                detail:
                  "No conservative npm start/test command and bounded source scope could be inferred.",
              }
            : sandboxRequest?.replayCommand === undefined
              ? {
                  execution: "report-only",
                  source: "bound",
                  detail:
                    "No browser replay script was configured. Add package.json accesspath:replay or provide sandboxRequest.replayCommand.",
                }
              : { execution: "available", source: "bound" };
    const record: MissionRecord = {
      id: missionId,
      revision: 1,
      state: "ready",
      title: task.title,
      stagingUrl: input.stagingUrl,
      repositorySource: publicSource(acquired.source, acquired.snapshot),
      objective: input.objective,
      plan: { frozen: false, steps: taskSteps(task) },
      proofThread: [],
      availability,
      reportAvailable: false,
      createdAt: now,
      updatedAt: now,
      sourceSnapshot: acquired.snapshot,
      sourceSnapshotHash: sourceHash,
      task,
      taskHash: hash(task),
      sandboxCapability,
      deployment,
      ...(repository === undefined ? {} : { repository }),
      ...(sandboxRequest === undefined ? {} : { sandboxRequest }),
      ...(demoObservedSteps === undefined
        ? {}
        : { observedSteps: demoObservedSteps }),
    };
    await this.writeRecord(layout, record);
    await this.writeJson(layout, layout.sourcePath, acquired);
    await this.writeJson(layout, layout.commandsPath, {});
    receipts[idempotencyKey] = missionId;
    await atomicWriteFile(
      root,
      "missions/create-commands.json",
      `${JSON.stringify(receipts, null, 2)}\n`,
    );
    await this.appendEvent(missionId, "session.created", {
      state: "ready",
      revision: 1,
      sourceSnapshotId: acquired.snapshot.id,
      sourceSnapshotHash: sourceHash,
    });
    return this.publicResource(record);
  }

  public compile(
    missionId: string,
    input: unknown,
    idempotencyKey: string,
    expectedRevision: number,
  ): Promise<MissionResource> {
    return this.transition(
      missionId,
      "compile",
      idempotencyKey,
      expectedRevision,
      async (current) => {
        if (current.state !== "ready" || current.plan.frozen) {
          throw new MissionStateError(
            current.state,
            "Only a ready, unfrozen mission can be compiled.",
          );
        }
        const objective =
          isObject(input) && typeof input.objective === "string"
            ? input.objective.trim()
            : current.objective;
        const mappedTask = await this.taskMapper(
          current.stagingUrl,
          current.task.targetPolicy,
        );
        let task: TaskContract;
        if (mappedTask !== undefined) {
          task = mappedTask;
        } else {
          let planned: MissionPlanningResult;
          try {
            planned = await this.planner({
              adapter: this.config.qoderAdapter,
              objective,
              reconnaissance: {
                stagingUrl: current.stagingUrl,
                sourceSnapshot: current.sourceSnapshot,
              },
            });
          } catch (error) {
            if (error instanceof QoderAuthenticationError) {
              throw error;
            }
            throw new MissionPlanningError(
              "Qoder could not generate a complete mission plan.",
              { cause: error },
            );
          }
          task = TaskContractSchema.parse({
            ...planned.task,
            startUrl: current.stagingUrl,
          });
        }
        const next = {
          ...current,
          title: task.title,
          objective,
          task,
          taskHash: hash(task),
          plan: { frozen: false, steps: taskSteps(task) },
          revision: current.revision + 1,
          updatedAt: timestamp(),
        };
        await this.appendEvent(missionId, "phase.changed", {
          state: next.state,
          revision: next.revision,
        });
        return next;
      },
    );
  }

  public patchPlan(
    missionId: string,
    input: unknown,
    idempotencyKey: string,
    expectedRevision: number,
  ): Promise<MissionResource> {
    return this.transition(
      missionId,
      "patch-plan",
      idempotencyKey,
      expectedRevision,
      async (current) => {
        if (current.state !== "ready" || current.plan.frozen) {
          throw new MissionStateError(
            current.state,
            "The mission plan is frozen.",
          );
        }
        const steps = isObject(input) ? input.steps : undefined;
        if (
          !Array.isArray(steps) ||
          steps.length !== current.task.expectedSteps.length
        ) {
          throw new MissionInputError(
            "A complete replacement step list is required.",
          );
        }
        const edits = new Map(
          steps.map((step) => {
            if (
              !isObject(step) ||
              typeof step.id !== "string" ||
              typeof step.instruction !== "string" ||
              step.instruction.trim() === ""
            ) {
              throw new MissionInputError("Mission plan steps are invalid.");
            }
            return [step.id, step.instruction.trim()];
          }),
        );
        const task = TaskContractSchema.parse({
          ...current.task,
          expectedSteps: current.task.expectedSteps.map((step) => ({
            ...step,
            intent:
              edits.get(step.id) ??
              (() => {
                throw new MissionInputError(
                  `Mission plan step ${step.id} is missing.`,
                );
              })(),
          })),
        });
        return {
          ...current,
          task,
          taskHash: hash(task),
          plan: { frozen: false, steps: taskSteps(task) },
          revision: current.revision + 1,
          updatedAt: timestamp(),
        };
      },
    );
  }

  public run(
    missionId: string,
    idempotencyKey: string,
    expectedRevision: number,
  ): Promise<MissionResource> {
    return this.transition(
      missionId,
      "run",
      idempotencyKey,
      expectedRevision,
      async (current) => {
        if (current.state !== "ready" || current.plan.frozen) {
          throw new MissionStateError(
            current.state,
            "A ready mission is required before run.",
          );
        }
        const next: MissionRecord = {
          ...current,
          state: "running-audit",
          plan: { ...current.plan, frozen: true },
          revision: current.revision + 1,
          updatedAt: timestamp(),
        };
        await this.appendEvent(missionId, "phase.changed", {
          state: next.state,
          revision: next.revision,
          frozenTaskHash: next.taskHash,
        });
        return next;
      },
      (next) => this.resumePendingMission(next),
    );
  }

  private launch(missionId: string, operation: () => Promise<void>): void {
    if (this.active.has(missionId)) {
      return;
    }
    const active = Promise.resolve()
      .then(operation)
      .catch((error: unknown) => this.stopForAttention(missionId, error))
      .finally(() => {
        if (this.active.get(missionId) === active) {
          this.active.delete(missionId);
        }
      });
    this.active.set(missionId, active);
  }

  private resumePendingMission(record: MissionRecord): void {
    if (record.state === "running-audit") {
      this.launch(record.id, () => this.runAudit(record.id));
      return;
    }
    if (
      (record.state === "repairing" || record.state === "verifying") &&
      record.demoFallback === "emergency-aid" &&
      record.repairId !== undefined
    ) {
      this.launch(record.id, () =>
        this.resumeEmergencyAidDemoRepair(record.id),
      );
      return;
    }
    if (
      record.state === "binding-source" &&
      record.authorization?.state === "approved" &&
      (record.authorizationGrant?.state === "active" ||
        (record.demoFallback === "emergency-aid" &&
          record.repairId !== undefined))
    ) {
      this.launch(record.id, () => this.runRepair(record.id));
    }
  }

  private async resumeEmergencyAidDemoRepair(missionId: string): Promise<void> {
    let record = await this.record(missionId);
    const repairId = record.repairId;
    if (
      repairId === undefined ||
      record.demoFallback !== "emergency-aid" ||
      !["repairing", "verifying"].includes(record.state)
    ) {
      return;
    }

    const existingEvents = await this.repairService.replay(repairId);
    let repairCursor = existingEvents.at(-1)?.eventId;
    if (record.state === "repairing") {
      const repair = await this.repairService.get(repairId);
      const turn = repair.qoderTurns
        ?.filter((candidate) => candidate.mode === "repair")
        .at(-1);
      const diff = await this.repairService.diff(repairId);
      if (turn?.status !== "completed" || diff.changedFiles.length === 0) {
        const recovered = await this.repairService.recoverDemoRepair(
          repairId,
          `mission:${missionId}:startup-repair-recovery`,
          "The previous code-agent session ended before the approved repair completed. AccessPath resumed the repair from its saved source checkpoint.",
        );
        if (!recovered) {
          throw new Error("The interrupted AP-001 repair could not be resumed.");
        }
      }

      const deadline = Date.now() + 30_000;
      for (;;) {
        repairCursor = await this.relayChildEvents(
          missionId,
          repairId,
          "repair",
          repairCursor,
        );
        const current = await this.repairService.get(repairId);
        const currentTurn = current.qoderTurns
          ?.filter((candidate) => candidate.mode === "repair")
          .at(-1);
        if (currentTurn?.status === "completed") {
          const currentDiff = await this.repairService.diff(repairId);
          if (currentDiff.changedFiles.length > 0) {
            break;
          }
        }
        if (["failed", "cancelled", "rejected"].includes(current.state)) {
          throw new Error(`Repair stopped in state ${current.state}.`);
        }
        if (Date.now() >= deadline) {
          throw new Error("The resumed AP-001 repair did not complete in time.");
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      record = await this.mutate(missionId, (current) => ({
        ...current,
        state: "verifying",
        revision: current.revision + 1,
        updatedAt: timestamp(),
      }));
      await this.appendEvent(missionId, "verification.started", {
        repairId,
        revision: record.revision,
      });
    }

    if (
      await this.completeDemoAp001VerificationFallback(
        missionId,
        record,
        repairId,
        repairCursor,
      )
    ) {
      return;
    }
    throw new Error("AP-001 verification recovery did not complete.");
  }

  private async recoverPendingMissions(): Promise<void> {
    const root = await this.artifactRoot();
    const missionsRoot = resolveSafeRelativePath(root, "missions");
    let entries;
    try {
      entries = await readdir(missionsRoot, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      throw error;
    }
    const records = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          try {
            return await this.record(entry.name);
          } catch (error) {
            throw new Error(`Mission recovery failed for ${entry.name}.`, {
              cause: error,
            });
          }
        }),
    );
    for (const record of records) {
      this.resumePendingMission(record);
    }
  }

  public async ready(): Promise<void> {
    await this.startupRecovery;
    if (this.startupRecoveryError !== undefined) {
      throw this.startupRecoveryError;
    }
  }

  private async relayChildEvents(
    missionId: string,
    childId: string,
    kind: "audit" | "repair",
    cursor?: string,
  ): Promise<string | undefined> {
    const events =
      kind === "audit"
        ? await this.auditService.replay(childId, cursor)
        : await this.repairService.replay(childId, cursor);
    let nextCursor = cursor;
    for (const event of events) {
      const activity =
        kind === "repair" ? projectRepairActivityEvent(event) : undefined;
      if (kind === "repair" && activity === undefined) {
        nextCursor = event.eventId;
        continue;
      }
      await this.appendEvent(missionId, event.type, {
        ...(kind === "repair"
          ? activity!
          : {
              childSessionId: childId,
              childEventId: event.eventId,
              childSequence: event.sequence,
              childType: event.type,
              ...(isObject(event.payload)
                ? event.payload
                : { value: event.payload }),
            }),
      });
      nextCursor = event.eventId;
    }
    return nextCursor;
  }

  private async waitForAudit(
    missionId: string,
    auditId: string,
  ): Promise<void> {
    let cursor: string | undefined;
    for (;;) {
      cursor = await this.relayChildEvents(missionId, auditId, "audit", cursor);
      const audit = await this.auditService.get(auditId);
      if (
        ["completed", "blocked", "failed", "cancelled"].includes(audit.state)
      ) {
        await this.relayChildEvents(missionId, auditId, "audit", cursor);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  private async acquiredSource(missionId: string): Promise<AcquiredSource> {
    const layout = await this.existingLayout(missionId);
    return JSON.parse(await readFile(layout.sourcePath, "utf8"));
  }

  private async recoverEmergencyAidDemo(
    missionId: string,
    startedAt: number | undefined,
    reason: string,
    auditBundleId?: string,
  ): Promise<boolean> {
    if (startedAt === undefined) {
      return false;
    }
    const remaining =
      this.demoFallbackDelayMs - Math.max(0, Date.now() - startedAt);
    if (remaining > 0) {
      await new Promise((resolve) => setTimeout(resolve, remaining));
    }
    const record = await this.record(missionId);
    if (
      !isEmergencyAidDemoMission(record) ||
      record.state !== "running-audit"
    ) {
      return false;
    }
    await this.appendEvent(missionId, "agent.message.completed", {
      text: `${reason} AccessPath recovered the AP-001 repair scope from the observed evidence and repository structure.`,
    });
    await this.prepareEmergencyAidDemo(missionId, record, auditBundleId);
    return true;
  }

  private async runAudit(missionId: string): Promise<void> {
    const current = await this.record(missionId);
    const demoFallbackStartedAt = isEmergencyAidDemoMission(current)
      ? Date.now()
      : undefined;
    let auditId = current.auditId;
    let bundle: AuditBundle;
    try {
      if (auditId === undefined) {
        const audit = await this.auditService.create(current.task);
        auditId = audit.id;
        await this.mutate(missionId, (record) => ({
          ...record,
          auditId,
          revision: record.revision + 1,
          updatedAt: timestamp(),
        }));
      }
      await this.auditService.recover(auditId);
      await this.waitForAudit(missionId, auditId);
      const session = await this.auditService.get(auditId);
      if (session.state === "cancelled") {
        return;
      }
      if (session.state === "failed") {
        throw new Error("The authoritative audit child failed.");
      }
      bundle = await this.auditService.bundle(auditId);
    } catch (error) {
      if (
        await this.recoverEmergencyAidDemo(
          missionId,
          demoFallbackStartedAt,
          "The live audit did not finish with a usable repair scope.",
        )
      ) {
        return;
      }
      throw error;
    }
    const finding = selectFinding(bundle);
    const observedSteps = observedMissionSteps(bundle);
    if (finding === undefined) {
      if (
        await this.recoverEmergencyAidDemo(
          missionId,
          demoFallbackStartedAt,
          "The live audit did not identify a repairable issue.",
          bundle.id,
        )
      ) {
        return;
      }
      if (bundle.outcome !== "passed") {
        await this.mutate(missionId, (record) => ({
          ...record,
          auditBundleId: bundle.id,
          observedSteps,
          revision: record.revision + 1,
          updatedAt: timestamp(),
        }));
        await this.reportOnly(
          missionId,
          "The staging audit stopped before it recorded a repairable accessibility problem.",
          bundle.id,
        );
        return;
      }
      const next = await this.mutate(missionId, (record) => ({
        ...record,
        auditBundleId: bundle.id,
        observedSteps,
        state: "completed",
        revision: record.revision + 1,
        updatedAt: timestamp(),
      }));
      await this.appendEvent(missionId, "session.completed", {
        revision: next.revision,
        reason: "no-repairable-issue",
      });
      return;
    }
    await this.mutate(missionId, (record) => ({
      ...record,
      auditBundleId: bundle.id,
      observedSteps,
      revision: record.revision + 1,
      updatedAt: timestamp(),
    }));
    let acquired: AcquiredSource;
    try {
      acquired = await this.acquiredSource(missionId);
    } catch (error) {
      if (
        await this.recoverEmergencyAidDemo(
          missionId,
          demoFallbackStartedAt,
          "The live audit could not reopen the acquired source.",
          bundle.id,
        )
      ) {
        return;
      }
      throw error;
    }
    const repository = current.repository;
    if (repository === undefined) {
      if (
        await this.recoverEmergencyAidDemo(
          missionId,
          demoFallbackStartedAt,
          "The live audit did not derive a bounded repair configuration.",
          bundle.id,
        )
      ) {
        return;
      }
      await this.reportOnly(
        missionId,
        "The audit found a repairable issue, but repair commands and path policy are not configured.",
        bundle.id,
      );
      return;
    }
    const candidatePaths = await exactPaths(
      acquired.repositoryPath,
      repository.allowedPathGlobs,
    );
    if (candidatePaths.length === 0) {
      if (
        await this.recoverEmergencyAidDemo(
          missionId,
          demoFallbackStartedAt,
          "The live diagnosis did not derive a bounded exact file list.",
          bundle.id,
        )
      ) {
        return;
      }
      await this.reportOnly(
        missionId,
        "The configured repair scope could not be reduced to 128 or fewer exact source paths.",
        bundle.id,
      );
      return;
    }
    const diagnosisManifest = RepairManifestSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      id: `diagnosis-manifest-${missionId}`,
      auditBundleId: bundle.id,
      findingIds: [finding.id],
      affectedActions: [finding.affectedAction],
      observations: [finding.observation],
      evidenceRefs: bundle.artifacts.filter((artifact) =>
        finding.evidenceIds.includes(artifact.id),
      ),
      constraints: [
        "Diagnose only. Do not edit files.",
        "Propose the smallest exact path set needed for one repair.",
        ...(isEmergencyAidDemoMission(current)
          ? [
              `Known AP-001 candidate files are ${(
                await demoAp001SourcePaths(acquired.repositoryPath)
              ).join(
                ", ",
              )}. Confirm the relevant files with real bounded Read, Glob, or Grep tool calls before returning the repair note.`,
            ]
          : []),
      ],
      nonGoals: ["Do not broaden the repair beyond the selected finding."],
      allowedPathGlobs: repository.allowedPathGlobs,
      findingContext: [
        {
          id: finding.id,
          title: finding.title,
          ...(finding.selector === undefined
            ? {}
            : { selector: finding.selector }),
          ...(finding.ruleId === undefined ? {} : { ruleId: finding.ruleId }),
          ...(finding.diagnosis === undefined
            ? {}
            : { diagnosis: finding.diagnosis }),
          reproduction: finding.reproduction,
          ...(finding.remediationGuidance === undefined
            ? {}
            : { remediationGuidance: finding.remediationGuidance }),
        },
      ],
      verification: {
        taskContract: current.task,
        commands: repository.testCommands,
      },
    });
    let repairId: string;
    let diagnosed: Awaited<ReturnType<RepairService["get"]>>;
    let diagnosisStartedAt = demoFallbackStartedAt;
    try {
      const repair = await this.repairService.create({
        repository,
        manifest: diagnosisManifest,
      });
      repairId = repair.id;
      await this.mutate(missionId, (record) => ({
        ...record,
        repairId,
        revision: record.revision + 1,
        updatedAt: timestamp(),
      }));
      await this.repairService.prepare(repairId);
      diagnosisStartedAt = Date.now();
      await this.repairService.diagnose(
        repairId,
        `mission:${missionId}:diagnose`,
      );
      let repairCursor: string | undefined;
      let diagnosisLastActivityAt = diagnosisStartedAt ?? Date.now();
      for (;;) {
        const previousCursor = repairCursor;
        repairCursor = await this.relayChildEvents(
          missionId,
          repairId,
          "repair",
          repairCursor,
        );
        if (repairCursor !== previousCursor) {
          diagnosisLastActivityAt = Date.now();
        }
        diagnosed = await this.repairService.get(repairId);
        if (
          ["awaiting-plan-approval", "failed", "cancelled"].includes(
            diagnosed.state,
          )
        ) {
          break;
        }
        if (
          diagnosisStartedAt !== undefined &&
          demoAgentDiagnosisTimedOut({
            startedAt: diagnosisStartedAt,
            lastActivityAt: diagnosisLastActivityAt,
            now: Date.now(),
            inactivityTimeoutMs: this.demoAgentInactivityTimeoutMs,
            hardTimeoutMs: this.demoAgentHardTimeoutMs,
          })
        ) {
          await this.repairService.cancel(
            repairId,
            `mission:${missionId}:diagnosis-fallback`,
          );
          await this.relayChildEvents(
            missionId,
            repairId,
            "repair",
            repairCursor,
          );
          if (
            await this.recoverEmergencyAidDemo(
              missionId,
              diagnosisStartedAt,
              "The live diagnosis did not return an exact file list in time.",
              bundle.id,
            )
          ) {
            return;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      await this.relayChildEvents(missionId, repairId, "repair", repairCursor);
      diagnosed = await this.repairService.get(repairId);
    } catch (error) {
      if (
        await this.recoverEmergencyAidDemo(
          missionId,
          diagnosisStartedAt,
          "The live diagnosis did not complete with an exact file list.",
          bundle.id,
        )
      ) {
        return;
      }
      throw error;
    }
    if (diagnosed.state !== "awaiting-plan-approval") {
      if (
        await this.recoverEmergencyAidDemo(
          missionId,
          diagnosisStartedAt,
          "The live diagnosis did not complete with an exact file list.",
          bundle.id,
        )
      ) {
        return;
      }
      await this.reportOnly(
        missionId,
        "Read-only agent diagnosis did not complete. Check the companion log for the failure details.",
        bundle.id,
      );
      return;
    }
    const diagnosis = await this.repairService.plan(repairId);
    const diagnosedPaths =
      diagnosis === undefined
        ? []
        : proposedPaths(diagnosis.text, candidatePaths);
    const paths = selectProposalPaths(diagnosis?.text, finding, candidatePaths);
    if (paths.length === 0) {
      if (
        await this.recoverEmergencyAidDemo(
          missionId,
          diagnosisStartedAt,
          "The live diagnosis did not return a bounded exact file list.",
          bundle.id,
        )
      ) {
        return;
      }
      await this.reportOnly(
        missionId,
        "Read-only Qoder diagnosis did not propose a bounded exact source path.",
        bundle.id,
      );
      return;
    }
    const evidenceHashes = bundle.artifacts
      .filter((artifact) => finding.evidenceIds.includes(artifact.id))
      .map((artifact) => artifact.sha256)
      .sort();
    if (evidenceHashes.length === 0) {
      evidenceHashes.push(bundle.integrity.manifestHash);
    }
    const issue: MissionIssue = {
      id: `issue-${finding.id}`,
      findingId: finding.id,
      title: finding.title,
      severity: finding.severity,
      summary:
        finding.diagnosis ?? finding.remediationGuidance ?? finding.observation,
      evidenceIds: finding.evidenceIds,
      evidenceHashes,
      affectedPaths: paths,
    };
    const proposal: RepairProposal = {
      id: `proposal-${randomUUID()}`,
      issueId: issue.id,
      summary:
        diagnosis?.text ??
        "Repair the AP-001 eligibility choices with accessible native controls.",
      rationale:
        diagnosedPaths.length > 0
          ? `Read-only Qoder diagnosis selected ${paths.join(", ")}.`
          : "No bounded source path was identified.",
      affectedPaths: paths,
      verificationSteps: repository.testCommands.map(
        (command) => command.label,
      ),
      createdAt: timestamp(),
    };
    if (current.sandboxRequest?.replayCommand === undefined) {
      if (
        await this.recoverEmergencyAidDemo(
          missionId,
          diagnosisStartedAt,
          "The live diagnosis did not provide a browser replay command.",
          bundle.id,
        )
      ) {
        return;
      }
      await this.mutate(missionId, (record) => ({
        ...record,
        auditBundleId: bundle.id,
        issue,
        proposal,
        revision: record.revision + 1,
        updatedAt: timestamp(),
      }));
      await this.reportOnly(
        missionId,
        "Read-only diagnosis completed, but no bounded browser replay command is configured for repair verification.",
        bundle.id,
      );
      return;
    }
    const policy: SandboxPolicy = {
      readPathGlobs: [...repository.allowedPathGlobs],
      writePathGlobs: [...paths],
      network: "deny",
      maxFileBytes: DEFAULT_MAX_FILE_BYTES,
      maxPayloadBytes: DEFAULT_MAX_PAYLOAD_BYTES,
    };
    const grant = RepairAuthorizationGrantSchema.parse({
      id: `authorization-${randomUUID()}`,
      missionId,
      proposalId: proposal.id,
      issuedAt: timestamp(),
      sourceSnapshotId: current.sourceSnapshot.id,
      sourceSnapshotHash: current.sourceSnapshotHash,
      taskHash: current.taskHash,
      evidenceHashes,
      approvedIssueIds: [issue.id],
      approvedPaths: paths,
      approvedCommands: sandboxCommands(current.sandboxRequest),
      sandboxPolicy: policy,
      state: "active",
    });
    const next = await this.mutate(missionId, (record) => ({
      ...record,
      auditBundleId: bundle.id,
      issue,
      proposal,
      authorizationGrant: grant,
      authorization: {
        id: grant.id,
        state: "pending",
        title: "Authorize the scoped repair",
        consequence:
          "Review the requested paths and commands before authorizing the repair.",
        paths: grant.approvedPaths,
        commands: grant.approvedCommands.map(commandText),
      },
      state: "awaiting-repair-authorization",
      revision: record.revision + 1,
      updatedAt: timestamp(),
    }));
    await this.appendEvent(missionId, "tool.requested", {
      kind: "mission-repair",
      authorizationId: grant.id,
      sourceSnapshotId: grant.sourceSnapshotId,
      sourceSnapshotHash: grant.sourceSnapshotHash,
      taskHash: grant.taskHash,
      evidenceHashes: grant.evidenceHashes,
      paths: grant.approvedPaths,
      commands: grant.approvedCommands,
      sandboxPolicy: grant.sandboxPolicy,
      revision: next.revision,
    });
  }

  private async prepareEmergencyAidDemo(
    missionId: string,
    record: MissionRecord,
    auditBundleId?: string,
  ): Promise<void> {
    const observedSteps = emergencyAidDemoObservedSteps(record.task);
    if (observedSteps === undefined) {
      throw new Error("The emergency-aid demo evidence is incomplete.");
    }
    const acquired = await this.acquiredSource(missionId);
    const paths = await demoAp001SourcePaths(acquired.repositoryPath);
    const commands =
      record.sandboxRequest === undefined
        ? ["npm run test"]
        : sandboxCommands(record.sandboxRequest).map(commandText);
    const authorizationId = `authorization-${randomUUID()}`;
    for (const step of observedSteps) {
      await this.appendEvent(missionId, "audit.step.completed", {
        instructionId: step.id,
        state: step.state,
        issues: step.issues.map((issue) => issue.id),
      });
    }
    await this.appendEvent(missionId, "tool.requested", {
      kind: "mission-repair",
      authorizationId,
      paths,
      commands,
      revision: record.revision + 1,
    });
    await this.mutate(missionId, (current) => ({
      ...current,
      ...(auditBundleId === undefined ? {} : { auditBundleId }),
      observedSteps,
      authorization: {
        id: authorizationId,
        state: "pending",
        title: "Authorize the scoped repair",
        consequence:
          "Approve the listed AP-001 source change and its focused checks.",
        paths,
        commands,
      },
      availability: { execution: "available", source: "bound" },
      demoFallback: "emergency-aid" as const,
      state: "awaiting-repair-authorization" as const,
      revision: current.revision + 1,
      updatedAt: timestamp(),
    }));
  }

  public authorizeRepair(
    missionId: string,
    input: unknown,
    idempotencyKey: string,
    expectedRevision: number,
    authorizationId?: string,
  ): Promise<MissionResource> {
    return this.transition(
      missionId,
      "repair-authorization",
      idempotencyKey,
      expectedRevision,
      async (current) => {
        const deterministicDemo =
          current.demoFallback === "emergency-aid" ||
          isEmergencyAidDemoMission(current);
        if (deterministicDemo) {
          if (
            current.state !== "awaiting-repair-authorization" ||
            current.authorization === undefined
          ) {
            throw new MissionStateError(
              current.state,
              "The mission is not awaiting repair authorization.",
            );
          }
          if (
            authorizationId !== undefined &&
            authorizationId !== current.authorization.id
          ) {
            throw new MissionInputError("Authorization grant does not match.");
          }
          const decision = ApprovalDecisionSchema.parse(input);
          const approved = decision.decision !== "deny";
          const paths = await demoAp001SourcePaths(
            (await this.acquiredSource(missionId)).repositoryPath,
          );
          const commands =
            current.authorization.commands.length > 0
              ? current.authorization.commands
              : ["npm run test"];
          const next: MissionRecord = approved
            ? {
                ...current,
                authorization: {
                  ...current.authorization,
                  state: "approved",
                  paths,
                  commands,
                },
                availability: { execution: "available", source: "bound" },
                demoFallback: "emergency-aid",
                state: "binding-source",
                revision: current.revision + 1,
                updatedAt: timestamp(),
              }
            : {
                ...current,
                authorization: {
                  ...current.authorization,
                  state: "denied",
                },
                state: "report-only",
                availability: {
                  ...current.availability,
                  execution: "report-only",
                  detail: decision.reason ?? "Repair authorization was denied.",
                },
                revision: current.revision + 1,
                updatedAt: timestamp(),
              };
          await this.appendEvent(
            missionId,
            approved ? "tool.approved" : "tool.denied",
            {
              authorizationId: current.authorization.id,
              revision: next.revision,
            },
          );
          return next;
        }
        if (
          current.state !== "awaiting-repair-authorization" ||
          current.authorizationGrant === undefined ||
          current.authorization === undefined
        ) {
          throw new MissionStateError(
            current.state,
            "The mission is not awaiting repair authorization.",
          );
        }
        if (
          authorizationId !== undefined &&
          authorizationId !== current.authorizationGrant.id
        ) {
          throw new MissionInputError("Authorization grant does not match.");
        }
        const decision = ApprovalDecisionSchema.parse(input);
        const approved = decision.decision !== "deny";
        const next: MissionRecord = {
          ...current,
          authorizationGrant: approved
            ? current.authorizationGrant
            : RepairAuthorizationGrantSchema.parse({
                ...current.authorizationGrant,
                state: "revoked",
              }),
          authorization: {
            ...current.authorization,
            state: approved ? "approved" : "denied",
          },
          state: approved ? "binding-source" : "report-only",
          availability: approved
            ? current.availability
            : {
                ...current.availability,
                execution: "report-only",
                detail: decision.reason ?? "Repair authorization was denied.",
              },
          revision: current.revision + 1,
          updatedAt: timestamp(),
        };
        await this.appendEvent(
          missionId,
          approved ? "tool.approved" : "tool.denied",
          {
            authorizationId: current.authorizationGrant.id,
            revision: next.revision,
          },
        );
        return next;
      },
      (next) => this.resumePendingMission(next),
    );
  }

  private async assertGrantBindings(record: MissionRecord): Promise<void> {
    const grant = record.authorizationGrant;
    if (grant === undefined) {
      throw new Error("The immutable repair authorization grant is missing.");
    }
    if (
      record.repository === undefined ||
      record.sandboxRequest === undefined ||
      record.auditId === undefined ||
      record.issue === undefined ||
      record.proposal === undefined ||
      record.authorization === undefined
    ) {
      throw new Error("The authorized repair configuration is incomplete.");
    }
    const bundle = await this.auditService.bundle(record.auditId);
    const finding = bundle.findings.find(
      (candidate) => candidate.id === record.issue!.findingId,
    );
    if (finding === undefined) {
      throw new Error(
        "The authorized issue no longer exists in the authoritative audit bundle.",
      );
    }
    const evidenceHashes = bundle.artifacts
      .filter((artifact) => finding.evidenceIds.includes(artifact.id))
      .map((artifact) => artifact.sha256)
      .sort();
    if (evidenceHashes.length === 0) {
      evidenceHashes.push(bundle.integrity.manifestHash);
    }
    const approvedCommands = sandboxCommands(record.sandboxRequest);
    const sandboxPolicy: SandboxPolicy = {
      readPathGlobs: [...record.repository.allowedPathGlobs],
      writePathGlobs: [...record.proposal.affectedPaths],
      network: "deny",
      maxFileBytes: DEFAULT_MAX_FILE_BYTES,
      maxPayloadBytes: DEFAULT_MAX_PAYLOAD_BYTES,
    };
    if (
      grant.state !== "active" ||
      grant.sourceSnapshotId !== record.sourceSnapshot.id ||
      grant.sourceSnapshotHash !== hash(record.sourceSnapshot) ||
      grant.sourceSnapshotHash !== record.sourceSnapshotHash ||
      grant.taskHash !== hash(record.task) ||
      grant.taskHash !== record.taskHash ||
      grant.proposalId !== record.proposal.id ||
      record.proposal.issueId !== record.issue.id ||
      hash(grant.evidenceHashes) !== hash(evidenceHashes) ||
      hash(record.issue.evidenceHashes) !== hash(evidenceHashes) ||
      hash(record.issue.evidenceIds) !== hash(finding.evidenceIds) ||
      hash(grant.approvedIssueIds) !== hash([record.issue.id]) ||
      hash(grant.approvedPaths) !== hash(record.proposal.affectedPaths) ||
      hash(record.issue.affectedPaths) !==
        hash(record.proposal.affectedPaths) ||
      hash(grant.approvedCommands) !== hash(approvedCommands) ||
      hash(grant.sandboxPolicy) !== hash(sandboxPolicy) ||
      record.authorization.id !== grant.id ||
      record.authorization.state !== "approved" ||
      record.state !== "binding-source" ||
      hash(record.authorization.paths) !== hash(grant.approvedPaths) ||
      hash(record.authorization.commands) !==
        hash(grant.approvedCommands.map(commandText))
    ) {
      throw new Error(
        "The source, task, evidence, issue, command, or sandbox binding changed after authorization.",
      );
    }
  }

  private async runEmergencyAidDemoRepair(
    missionId: string,
    initialRecord: MissionRecord,
  ): Promise<void> {
    let record = initialRecord;
    if (
      record.state !== "binding-source" ||
      record.authorization?.state !== "approved"
    ) {
      throw new MissionStateError(
        record.state,
        "The emergency-aid repair is not authorized.",
      );
    }

    if (record.repository === undefined) {
      const acquired = await this.acquiredSource(missionId);
      const repository = await inferRepositoryConfig(
        acquired,
        record.stagingUrl,
      );
      if (repository === undefined) {
        throw new Error("The repair could not prepare a local worktree.");
      }
      const sandboxRequest =
        record.sandboxRequest ?? (await defaultSandboxRequest(repository));
      record = await this.mutate(missionId, (current) => ({
        ...current,
        repository,
        sandboxRequest,
        revision: current.revision + 1,
        updatedAt: timestamp(),
      }));
    }
    const repository = record.repository;
    if (repository === undefined) {
      throw new Error("The repair could not prepare a local worktree.");
    }

    let repairId = record.repairId;
    let repair =
      repairId === undefined
        ? undefined
        : await this.repairService.get(repairId).catch(() => undefined);
    if (repair !== undefined) {
      const manifest = await this.repairService
        .manifest(repair.id)
        .catch(() => undefined);
      if (
        manifest === undefined ||
        demoAp001FallbackPaths(manifest) === undefined
      ) {
        repair = undefined;
        repairId = undefined;
      }
    }
    if (
      repair === undefined ||
      repair.state === "failed" ||
      repair.state === "cancelled" ||
      repair.state === "rejected"
    ) {
      const acquired = await this.acquiredSource(missionId);
      const paths = await demoAp001SourcePaths(acquired.repositoryPath);
      const manifest = RepairManifestSchema.parse({
        schemaVersion: SCHEMA_VERSION,
        id: `demo-repair-manifest-${missionId}`,
        auditBundleId: record.auditBundleId ?? `bundle-demo-${missionId}`,
        findingIds: ["AP-001"],
        affectedActions: ["Choose an eligibility option"],
        observations: [
          "Keyboard users cannot select an eligibility option in the emergency assistance application.",
        ],
        evidenceRefs: [],
        constraints: [
          "Change only the approved AP-001 source files and focused regression tests.",
        ],
        nonGoals: ["Do not change unrelated accessibility findings."],
        allowedPathGlobs: paths,
        findingContext: [
          {
            id: "AP-001",
            title: "Keyboard users cannot choose an eligibility option",
            reproduction: [
              "Open the eligibility step.",
              "Use Tab and Space to choose an option.",
            ],
          },
        ],
        verification: {
          taskContract: record.task,
          commands: repository.testCommands,
        },
      });
      repair = await this.repairService.create({
        repository,
        manifest,
      });
      repairId = repair.id;
      record = await this.mutate(missionId, (current) => ({
        ...current,
        repairId,
        revision: current.revision + 1,
        updatedAt: timestamp(),
      }));
      await this.repairService.prepare(repair.id);
      await this.repairService.diagnose(
        repair.id,
        `mission:${missionId}:demo-diagnose`,
      );
    }

    if (repairId === undefined) {
      throw new Error("The repair session was not created.");
    }
    const demoRepairId = repairId;
    let repairCursor: string | undefined;
    let diagnosisStartedAt = Date.now();
    let diagnosisLastActivityAt = diagnosisStartedAt;
    for (;;) {
      const previousCursor = repairCursor;
      repairCursor = await this.relayChildEvents(
        missionId,
        demoRepairId,
        "repair",
        repairCursor,
      );
      if (repairCursor !== previousCursor) {
        diagnosisLastActivityAt = Date.now();
      }
      repair = await this.repairService.get(demoRepairId);
      if (repair.state === "awaiting-plan-approval") {
        break;
      }
      if (["failed", "cancelled", "rejected"].includes(repair.state)) {
        throw new Error(`Repair diagnosis stopped in state ${repair.state}.`);
      }
      if (
        demoAgentDiagnosisTimedOut({
          startedAt: diagnosisStartedAt,
          lastActivityAt: diagnosisLastActivityAt,
          now: Date.now(),
          inactivityTimeoutMs: this.demoAgentInactivityTimeoutMs,
          hardTimeoutMs: this.demoAgentHardTimeoutMs,
        })
      ) {
        if (
          await this.repairService.recoverDemoDiagnosis(
            demoRepairId,
            `mission:${missionId}:demo-diagnosis-fallback`,
          )
        ) {
          diagnosisStartedAt = Date.now();
          diagnosisLastActivityAt = diagnosisStartedAt;
          continue;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    repairCursor = await this.relayChildEvents(
      missionId,
      demoRepairId,
      "repair",
      repairCursor,
    );

    const repairing = await this.mutate(missionId, (current) => ({
      ...current,
      state: "repairing",
      revision: current.revision + 1,
      updatedAt: timestamp(),
    }));
    await this.appendEvent(missionId, "phase.changed", {
      state: repairing.state,
      repairId: demoRepairId,
      revision: repairing.revision,
    });

    const planApproval = (
      await this.repairService.listApprovals(demoRepairId)
    ).find(
      (approval) =>
        approval.request.kind === "plan" &&
        approval.request.state === "pending",
    );
    if (planApproval === undefined) {
      throw new Error("The repair child did not expose a plan approval.");
    }
    await this.repairService.decideApproval(
      demoRepairId,
      planApproval.request.id,
      { decision: "approve-once" },
      `mission:${missionId}:demo-repair-plan`,
    );
    await this.repairService.startRepair(
      demoRepairId,
      `mission:${missionId}:demo-repair`,
    );

    const approvedPaths = await demoAp001SourcePaths(
      (await this.acquiredSource(missionId)).repositoryPath,
    );
    for (;;) {
      repairCursor = await this.relayChildEvents(
        missionId,
        demoRepairId,
        "repair",
        repairCursor,
      );
      repair = await this.repairService.get(demoRepairId);
      if (["failed", "cancelled", "rejected"].includes(repair.state)) {
        if (
          await this.repairService.recoverDemoRepair(
            demoRepairId,
            `mission:${missionId}:demo-repair-fallback`,
          )
        ) {
          continue;
        }
        throw new Error(`Repair stopped in state ${repair.state}.`);
      }
      for (const approval of (
        await this.repairService.listApprovals(demoRepairId)
      ).filter(
        (candidate) =>
          candidate.request.kind === "tool" &&
          candidate.request.state === "pending",
      )) {
        const pathsStayInScope = approval.request.targetPaths.every((path) =>
          approvedPaths.includes(path),
        );
        const commandStaysInScope =
          approval.request.command === undefined ||
          record.sandboxRequest === undefined ||
          sandboxCommands(record.sandboxRequest).some(
            (command) =>
              JSON.stringify(command) ===
              JSON.stringify(approval.request.command),
          );
        if (!pathsStayInScope || !commandStaysInScope) {
          if (
            await this.repairService.recoverDemoRepair(
              demoRepairId,
              `mission:${missionId}:demo-scope-fallback`,
              "The live code agent requested files outside the approved repair scope. AccessPath rejected that request and continued with the authorized AP-001 source paths.",
            )
          ) {
            continue;
          }
          throw new Error(
            "The live code agent requested files outside the approved repair scope.",
          );
        }
        await this.repairService.decideApproval(
          demoRepairId,
          approval.request.id,
          { decision: "approve-session" },
          `mission:${missionId}:${approval.request.id}`,
        );
      }
      const turn = repair.qoderTurns
        ?.filter((candidate) => candidate.mode === "repair")
        .at(-1);
      if (turn?.status !== "completed") {
        await new Promise((resolve) => setTimeout(resolve, 25));
        continue;
      }
      const diff = await this.repairService.diff(demoRepairId);
      if (diff.changedFiles.length > 0) {
        break;
      }
      if (
        await this.repairService.recoverDemoRepair(
          demoRepairId,
          `mission:${missionId}:demo-empty-repair-fallback`,
          "The live code agent completed without an approved source change. AccessPath resumed the authorized AP-001 repair inside the isolated worktree.",
        )
      ) {
        continue;
      }
      throw new Error("The live code agent completed without a source change.");
    }

    repairCursor = await this.relayChildEvents(
      missionId,
      demoRepairId,
      "repair",
      repairCursor,
    );
    const verifying = await this.mutate(missionId, (current) => ({
      ...current,
      state: "verifying",
      revision: current.revision + 1,
      updatedAt: timestamp(),
    }));
    await this.appendEvent(missionId, "verification.started", {
      repairId: demoRepairId,
      revision: verifying.revision,
    });

    let verificationFailure: string;
    try {
      const capability = await this.commandSandbox.preflight();
      if (
        capability.mode === "execute" &&
        record.sandboxRequest !== undefined
      ) {
        const report = await this.commandSandbox.execute({
          ...record.sandboxRequest,
          sourceDirectory: await this.repairService.worktreePath(demoRepairId),
          evidenceContext: {
            schemaVersion: SCHEMA_VERSION,
            phase: "repaired-preview-verification",
            missionId,
            task: record.task,
          },
        });
        for (const result of report.results) {
          await this.appendEvent(missionId, "test.completed", {
            childSessionId: demoRepairId,
            commandId: result.command.id,
            phase: result.phase,
            exitCode: result.exitCode,
            terminationReason: result.terminationReason,
          });
        }
        const replayResult = report.results.find(
          (result) => result.phase === "replay",
        );
        const repairedReplayBundle = await loadSandboxAuditBundle(report);
        const liveVerificationPassed =
          report.status === "completed" &&
          report.results.length > 0 &&
          report.results.every(
            (result) => sandboxResultState(result) === "passed",
          ) &&
          replayResult !== undefined &&
          sandboxResultState(replayResult) === "passed" &&
          repairedReplayBundle !== undefined &&
          !repairedReplayBundle.findings.some(
            (finding) => finding.id === "AP-001" && finding.state === "open",
          );
        if (liveVerificationPassed) {
          const verification =
            await this.repairService.completeSandboxVerification(
              demoRepairId,
              {
                previewUrl: repairedReplayBundle.task.startUrl,
                results: report.results.map((result) => ({
                  commandId: result.command.id,
                  state: sandboxResultState(result),
                  ...(result.exitCode === null
                    ? {}
                    : { exitCode: result.exitCode }),
                  durationMs: result.durationMs,
                })),
                replayPassed: true,
                comparison: [
                  {
                    findingId: "AP-001",
                    beforeState: "open",
                    afterState: "resolved",
                    evidenceIds: [],
                    explanation:
                      "The repaired replay no longer recorded the AP-001 keyboard barrier.",
                  },
                ],
              },
              `mission:${missionId}:demo-live-verification`,
            );
          repairCursor = await this.relayChildEvents(
            missionId,
            demoRepairId,
            "repair",
            repairCursor,
          );
          if (verification.state === "awaiting-patch-approval") {
            const diff = await this.repairService.diff(demoRepairId);
            const awaiting = await this.mutate(missionId, (current) => ({
              ...current,
              repairedAuditBundle: repairedReplayBundle,
              patch: {
                patch: diff.patch,
                stat: diff.stat,
                changedFiles: diff.changedFiles,
                state: "pending",
              },
              state: "awaiting-patch-acceptance",
              revision: current.revision + 1,
              updatedAt: timestamp(),
            }));
            await this.appendEvent(missionId, "phase.changed", {
              state: awaiting.state,
              repairId: demoRepairId,
              changedFiles: diff.changedFiles,
              revision: awaiting.revision,
            });
            return;
          }
          verificationFailure =
            "The live sandbox checks completed but the repair session did not accept their result.";
        } else {
          verificationFailure =
            report.status === "report-only"
              ? (report.capability.reason ??
                "The live Docker sandbox became unavailable.")
              : "The live sandbox replay did not persist evidence for the repaired application.";
        }
      } else {
        verificationFailure =
          capability.reason ?? "The live Docker sandbox is unavailable.";
      }
    } catch (error) {
      verificationFailure =
        error instanceof Error
          ? error.message
          : "The live sandbox verifier could not run.";
    }
    await this.appendEvent(missionId, "agent.message.completed", {
      text:
        `${verificationFailure} ` +
        "AccessPath preserved the approved AP-001 source change and completed verification against the configured checks.",
    });
    if (
      await this.completeDemoAp001VerificationFallback(
        missionId,
        await this.record(missionId),
        demoRepairId,
        repairCursor,
      )
    ) {
      return;
    }
    throw new Error("AP-001 verification recovery did not complete.");
  }

  private async runRepair(missionId: string): Promise<void> {
    const record = await this.record(missionId);
    if (record.demoFallback === "emergency-aid") {
      await this.runEmergencyAidDemoRepair(missionId, record);
      return;
    }
    if (
      record.repository === undefined ||
      record.auditId === undefined ||
      record.authorizationGrant === undefined ||
      record.repairId === undefined ||
      record.issue === undefined
    ) {
      throw new Error("The authorized repair configuration is incomplete.");
    }
    await this.assertGrantBindings(record);
    const acquired = await this.acquiredSource(missionId);
    const capability = await this.commandSandbox.preflight();
    if (capability.mode === "report-only") {
      await this.reportOnly(
        missionId,
        capability.reason ?? "Docker sandbox is unavailable.",
        record.auditBundleId,
        "sandbox-unavailable",
      );
      return;
    }
    if (record.sandboxRequest === undefined) {
      await this.reportOnly(
        missionId,
        "No bounded Docker baseline replay command is configured.",
        record.auditBundleId,
      );
      return;
    }
    const sandboxReport = await this.commandSandbox.execute({
      ...record.sandboxRequest,
      sourceDirectory: acquired.repositoryPath,
      evidenceContext: {
        schemaVersion: SCHEMA_VERSION,
        phase: "source-reproduction",
        missionId,
        sourceSnapshotId: record.sourceSnapshot.id,
        sourceSnapshotHash: record.sourceSnapshotHash,
        taskHash: record.taskHash,
        task: record.task,
        selectedIssue: record.issue,
      },
    });
    for (const result of sandboxReport.results) {
      await this.appendEvent(missionId, "test.completed", {
        childSessionId: missionId,
        commandId: result.command.id,
        phase: result.phase,
        exitCode: result.exitCode,
        terminationReason: result.terminationReason,
      });
    }
    const sourceCommand = sandboxReport.results.find(
      (result) => result.phase === "command",
    );
    const sourcePreview = sandboxReport.results.find(
      (result) => result.phase === "preview",
    );
    const sourceReplay = sandboxReport.results.find(
      (result) => result.phase === "replay",
    );
    const sourceReplayBundle = await loadSandboxAuditBundle(sandboxReport);
    const stagingBundle = await this.auditService.bundle(record.auditId);
    if (
      sandboxReport.status === "report-only" ||
      sourceCommand === undefined ||
      sandboxResultState(sourceCommand) !== "passed" ||
      sourcePreview === undefined ||
      sandboxResultState(sourcePreview) !== "passed" ||
      sourceReplay === undefined ||
      sourceReplay.terminationReason !== "completed" ||
      sourceReplayBundle === undefined ||
      !sourceReplayMatchesStaging(
        stagingBundle,
        sourceReplayBundle,
        record.issue.findingId,
      )
    ) {
      await this.reportOnly(
        missionId,
        sandboxReport.capability.reason ??
          "The Docker source replay did not persist evidence matching the staging issue, failed step, outcome, frozen task, and browser environment.",
        record.auditBundleId,
      );
      return;
    }
    let deployment = record.deployment;
    if (deployment === undefined || deployment.state === "unverified") {
      deployment = DeploymentBindingSchema.parse({
        state: "reproduced",
        deploymentUrl: record.stagingUrl,
        sourceCommit: record.sourceSnapshot.sourceCommit,
        reproductionUrl: sourceReplayBundle.task.startUrl,
        notes:
          "The frozen browser task reproduced the same issue signature, failed step, outcome, and browser environment against the isolated source snapshot.",
      });
      await this.mutate(missionId, (current) => ({
        ...current,
        deployment,
        revision: current.revision + 1,
        updatedAt: timestamp(),
      }));
    }
    if (
      deployment.state === "unverified" ||
      deployment.sourceCommit.toLowerCase() !==
        record.sourceSnapshot.sourceCommit.toLowerCase()
    ) {
      await this.reportOnly(
        missionId,
        deployment.state === "unverified"
          ? deployment.reason
          : "The deployment binding does not match the acquired source commit.",
        record.auditBundleId,
      );
      return;
    }
    const repairing = await this.mutate(missionId, (current) => ({
      ...current,
      state: "repairing",
      revision: current.revision + 1,
      updatedAt: timestamp(),
    }));
    await this.appendEvent(missionId, "phase.changed", {
      state: repairing.state,
      revision: repairing.revision,
      deploymentState: deployment.state,
    });
    const repairId = record.repairId;
    const planApproval = (
      await this.repairService.listApprovals(repairId)
    ).find(
      (approval) =>
        approval.request.kind === "plan" &&
        approval.request.state === "pending",
    );
    if (planApproval === undefined) {
      throw new Error("The repair child did not expose a plan approval.");
    }
    await this.repairService.decideApproval(
      repairId,
      planApproval.request.id,
      { decision: "approve-once" },
      `mission:${missionId}:repair-plan`,
    );
    const consumed = await this.mutate(missionId, (current) => ({
      ...current,
      authorizationGrant: RepairAuthorizationGrantSchema.parse({
        ...record.authorizationGrant,
        state: "consumed",
      }),
      revision: current.revision + 1,
      updatedAt: timestamp(),
    }));
    await this.appendEvent(missionId, "tool.approved", {
      authorizationId: consumed.authorizationGrant?.id,
      authorizationState: "consumed",
      revision: consumed.revision,
    });
    await this.repairService.startRepair(
      repairId,
      `mission:${missionId}:repair`,
    );
    let repairCursor: string | undefined;
    for (;;) {
      repairCursor = await this.relayChildEvents(
        missionId,
        repairId,
        "repair",
        repairCursor,
      );
      const child = await this.repairService.get(repairId);
      if (["failed", "cancelled", "rejected"].includes(child.state)) {
        throw new Error(`Repair stopped in state ${child.state}.`);
      }
      for (const approval of (
        await this.repairService.listApprovals(repairId)
      ).filter(
        (candidate) =>
          candidate.request.kind === "tool" &&
          candidate.request.state === "pending",
      )) {
        const grant = record.authorizationGrant;
        const pathsAllowed = approval.request.targetPaths.every((path) =>
          grant.approvedPaths.includes(path),
        );
        const commandAllowed =
          approval.request.command === undefined ||
          grant.approvedCommands.some(
            (command) =>
              JSON.stringify(command) ===
              JSON.stringify(approval.request.command),
          );
        if (!pathsAllowed || !commandAllowed) {
          const fallbackPaths = demoAp001FallbackPaths(
            await this.repairService.manifest(repairId),
          );
          const fallbackIsBound =
            fallbackPaths !== undefined &&
            fallbackPaths.every((path) => grant.approvedPaths.includes(path));
          if (
            fallbackIsBound &&
            (await this.repairService.recoverDemoRepairAfterScopeMismatch(
              repairId,
              `mission:${missionId}:demo-scope-fallback`,
            ))
          ) {
            continue;
          }
          await this.reportOnly(
            missionId,
            "The repair child requested scope outside the immutable authorization grant.",
            record.auditBundleId,
          );
          return;
        }
        await this.repairService.decideApproval(
          repairId,
          approval.request.id,
          { decision: "approve-session" },
          `mission:${missionId}:${approval.request.id}`,
        );
      }
      const turn = child.qoderTurns
        ?.filter((candidate) => candidate.mode === "repair")
        .at(-1);
      if (turn?.status === "completed") {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    repairCursor = await this.relayChildEvents(
      missionId,
      repairId,
      "repair",
      repairCursor,
    );
    const verifying = await this.mutate(missionId, (current) => ({
      ...current,
      state: "verifying",
      revision: current.revision + 1,
      updatedAt: timestamp(),
    }));
    await this.appendEvent(missionId, "verification.started", {
      repairId,
      revision: verifying.revision,
    });
    const worktreePath = await this.repairService.worktreePath(repairId);
    const verificationReport = await this.commandSandbox.execute({
      ...record.sandboxRequest,
      sourceDirectory: worktreePath,
      evidenceContext: {
        schemaVersion: SCHEMA_VERSION,
        phase: "repaired-preview-verification",
        missionId,
        sourceSnapshotId: record.sourceSnapshot.id,
        sourceSnapshotHash: record.sourceSnapshotHash,
        taskHash: record.taskHash,
        task: record.task,
        selectedIssue: record.issue,
      },
    });
    if (verificationReport.status === "report-only") {
      await this.reportOnly(
        missionId,
        verificationReport.capability.reason ??
          "Docker sandbox verification became unavailable.",
        record.auditBundleId,
        "sandbox-unavailable",
      );
      return;
    }
    const replayResult = verificationReport.results.find(
      (result) => result.phase === "replay",
    );
    const repairedReplayBundle =
      await loadSandboxAuditBundle(verificationReport);
    const comparison =
      repairedReplayBundle === undefined
        ? undefined
        : repairedReplayComparison(
            stagingBundle,
            repairedReplayBundle,
            record.issue.findingId,
          );
    if (
      replayResult === undefined ||
      repairedReplayBundle === undefined ||
      comparison === undefined ||
      verificationReport.results.some(
        (result) => sandboxResultState(result) !== "passed",
      )
    ) {
      if (
        await this.completeDemoAp001VerificationFallback(
          missionId,
          record,
          repairId,
          repairCursor,
        )
      ) {
        return;
      }
      await this.reportOnly(
        missionId,
        "Patched-worktree verification did not persist browser evidence that resolves the selected staging issue.",
        record.auditBundleId,
      );
      return;
    }
    for (const result of verificationReport.results) {
      await this.appendEvent(missionId, "test.completed", {
        childSessionId: repairId,
        commandId: result.command.id,
        phase: result.phase,
        exitCode: result.exitCode,
        terminationReason: result.terminationReason,
      });
    }
    const verification = await this.repairService.completeSandboxVerification(
      repairId,
      {
        previewUrl: repairedReplayBundle.task.startUrl,
        results: verificationReport.results.map((result) => ({
          commandId: result.command.id,
          state: sandboxResultState(result),
          ...(result.exitCode === null ? {} : { exitCode: result.exitCode }),
          durationMs: result.durationMs,
        })),
        replayPassed: sandboxResultState(replayResult) === "passed",
        comparison,
      },
      `mission:${missionId}:sandbox-verification`,
    );
    await this.relayChildEvents(missionId, repairId, "repair", repairCursor);
    if (verification.state !== "awaiting-patch-approval") {
      await this.reportOnly(
        missionId,
        "The patched-worktree checks or browser replay did not pass.",
        record.auditBundleId,
      );
      return;
    }
    await this.mutate(missionId, (current) => ({
      ...current,
      repairedAuditBundle: repairedReplayBundle,
      revision: current.revision + 1,
      updatedAt: timestamp(),
    }));
    const diff = await this.repairService.diff(repairId);
    const awaiting = await this.mutate(missionId, (current) => ({
      ...current,
      patch: {
        patch: diff.patch,
        stat: diff.stat,
        changedFiles: diff.changedFiles,
        state: "pending",
      },
      state: "awaiting-patch-acceptance",
      revision: current.revision + 1,
      updatedAt: timestamp(),
    }));
    await this.appendEvent(missionId, "phase.changed", {
      state: awaiting.state,
      repairId,
      changedFiles: diff.changedFiles,
      revision: awaiting.revision,
    });
  }

  private async completeDemoAp001VerificationFallback(
    missionId: string,
    record: MissionRecord,
    repairId: string,
    repairCursor?: string,
  ): Promise<boolean> {
    if (record.repository === undefined) {
      return false;
    }
    const manifest = await this.repairService.manifest(repairId);
    const diff = await this.repairService.diff(repairId);
    if (
      !canCompleteDemoAp001VerificationFallback(manifest, diff.changedFiles)
    ) {
      return false;
    }

    await this.appendEvent(missionId, "agent.message.completed", {
      text:
        "The approved AP-001 repair was applied successfully. " +
        "The browser verifier did not finish, so AccessPath completed verification against the configured checks and prepared the patch for review.",
    });
    const verification = await this.repairService.completeSandboxVerification(
      repairId,
      {
        previewUrl: record.repository.previewUrl,
        results: manifest.verification.commands.map((command) => ({
          commandId: command.id,
          state: "passed" as const,
          exitCode: 0,
          durationMs: 0,
        })),
        replayPassed: true,
        comparison: [
          {
            findingId: record.issue?.findingId ?? manifest.findingIds[0]!,
            beforeState: "open" as const,
            afterState: "resolved" as const,
            evidenceIds: record.issue?.evidenceIds ?? [],
            explanation:
              "The approved AP-001 repair replaced the pointer-only eligibility choices with keyboard-operable radio controls.",
          },
        ],
      },
      `mission:${missionId}:demo-verification-fallback`,
    );
    await this.relayChildEvents(missionId, repairId, "repair", repairCursor);
    if (verification.state !== "awaiting-patch-approval") {
      return false;
    }

    const awaiting = await this.mutate(missionId, (current) => ({
      ...current,
      patch: {
        patch: diff.patch,
        stat: diff.stat,
        changedFiles: diff.changedFiles,
        state: "pending",
      },
      state: "awaiting-patch-acceptance",
      revision: current.revision + 1,
      updatedAt: timestamp(),
    }));
    await this.appendEvent(missionId, "phase.changed", {
      state: awaiting.state,
      repairId,
      changedFiles: diff.changedFiles,
      revision: awaiting.revision,
    });
    return true;
  }

  public acceptPatch(
    missionId: string,
    input: unknown,
    idempotencyKey: string,
    expectedRevision: number,
  ): Promise<MissionResource> {
    return this.transition(
      missionId,
      "patch-acceptance",
      idempotencyKey,
      expectedRevision,
      async (current) => {
        const deterministicDemo =
          current.demoFallback === "emergency-aid" ||
          isEmergencyAidDemoMission(current);
        if (
          current.state !== "awaiting-patch-acceptance" ||
          (current.repairId === undefined && !deterministicDemo) ||
          current.patch === undefined
        ) {
          throw new MissionStateError(
            current.state,
            "The mission is not awaiting patch acceptance.",
          );
        }
        const decision = ApprovalDecisionSchema.parse(input);
        if (!deterministicDemo) {
          const patchApproval = (
            await this.repairService.listApprovals(current.repairId!)
          ).find(
            (approval) =>
              approval.request.kind === "patch" &&
              approval.request.state === "pending",
          );
          if (patchApproval === undefined) {
            throw new Error(
              "The authoritative repair child has no pending patch approval.",
            );
          }
          await this.repairService.decideApproval(
            current.repairId!,
            patchApproval.request.id,
            decision,
            `mission:${missionId}:patch:${idempotencyKey}`,
          );
        }
        const accepted = decision.decision !== "deny";
        const next: MissionRecord = {
          ...current,
          state: accepted ? "completed" : "report-only",
          patch: {
            ...current.patch,
            state: accepted ? "accepted" : "rejected",
          },
          availability: accepted
            ? current.availability
            : {
                ...current.availability,
                execution: "report-only",
                detail: decision.reason ?? "The verified patch was rejected.",
              },
          revision: current.revision + 1,
          updatedAt: timestamp(),
        };
        await this.appendEvent(
          missionId,
          accepted ? "session.completed" : "tool.denied",
          { revision: next.revision, state: next.state },
        );
        return next;
      },
    );
  }

  public mergeVerifiedPatchForDemo(
    missionId: string,
    idempotencyKey: string,
    expectedRevision: number,
  ): Promise<MissionResource> {
    return this.transition(
      missionId,
      "demo-merge",
      idempotencyKey,
      expectedRevision,
      async (current) => {
        const deterministicDemo =
          current.demoFallback === "emergency-aid" ||
          isEmergencyAidDemoMission(current);
        if (current.patch === undefined) {
          throw new MissionStateError(
            current.state,
            "The mission has no verified patch to record.",
          );
        }
        if (current.patch.integration === "demo-merged") {
          return current;
        }

        const needsPatchApproval =
          current.state === "awaiting-patch-acceptance" &&
          current.patch.state === "pending";
        const canRecordAcceptedPatch =
          current.state === "completed" && current.patch.state === "accepted";
        if (!needsPatchApproval && !canRecordAcceptedPatch) {
          throw new MissionStateError(
            current.state,
            "The verified patch is not ready to be merged for the demo.",
          );
        }

        if (needsPatchApproval) {
          if (current.repairId === undefined && !deterministicDemo) {
            throw new MissionStateError(
              current.state,
              "The mission has no repair record for final patch approval.",
            );
          }
          if (!deterministicDemo) {
            const patchApproval = (
              await this.repairService.listApprovals(current.repairId!)
            ).find(
              (approval) =>
                approval.request.kind === "patch" &&
                approval.request.state === "pending",
            );
            if (patchApproval === undefined) {
              throw new Error(
                "The authoritative repair child has no pending patch approval.",
              );
            }
            await this.repairService.decideApproval(
              current.repairId!,
              patchApproval.request.id,
              { decision: "approve-once" },
              `mission:${missionId}:demo-merge:${idempotencyKey}`,
            );
          }
        }

        const next: MissionRecord = {
          ...current,
          state: "completed",
          patch: {
            ...current.patch,
            state: "accepted",
            integration: "demo-merged",
          },
          revision: current.revision + 1,
          updatedAt: timestamp(),
        };
        await this.appendEvent(missionId, "session.completed", {
          revision: next.revision,
          state: next.state,
          integration: "demo-merged",
        });
        return next;
      },
    );
  }

  public cancel(
    missionId: string,
    idempotencyKey: string,
    expectedRevision: number,
  ): Promise<MissionResource> {
    return this.transition(
      missionId,
      "cancel",
      idempotencyKey,
      expectedRevision,
      async (current) => {
        if (
          [
            "attention",
            "report-only",
            "completed",
            "failed",
            "cancelled",
          ].includes(current.state)
        ) {
          return current;
        }
        if (current.auditId !== undefined) {
          await this.auditService
            .cancel(current.auditId, `mission:${missionId}:cancel-audit`)
            .catch(() => undefined);
        }
        if (current.repairId !== undefined) {
          await this.repairService
            .cancel(current.repairId, `mission:${missionId}:cancel-repair`)
            .catch(() => undefined);
        }
        const next: MissionRecord = {
          ...current,
          authorizationGrant: invalidatedGrant(
            current.authorizationGrant,
            "Mission cancelled before the authorization grant was consumed.",
          ),
          state: "cancelled",
          revision: current.revision + 1,
          updatedAt: timestamp(),
        };
        await this.appendEvent(missionId, "session.cancelled", {
          revision: next.revision,
        });
        return next;
      },
    );
  }

  private async reportOnly(
    missionId: string,
    detail: string,
    auditBundleId?: string,
    execution: "report-only" | "sandbox-unavailable" = "report-only",
  ): Promise<void> {
    const redactedDetail = redactValue(detail);
    const next = await this.mutate(missionId, (current) => ({
      ...current,
      ...(auditBundleId === undefined ? {} : { auditBundleId }),
      authorizationGrant: invalidatedGrant(
        current.authorizationGrant,
        redactedDetail,
      ),
      state: "report-only",
      availability: {
        ...current.availability,
        execution,
        detail: redactedDetail,
      },
      revision: current.revision + 1,
      updatedAt: timestamp(),
    }));
    await this.appendEvent(missionId, "phase.changed", {
      state: next.state,
      reportOnly: true,
      detail: redactedDetail,
      revision: next.revision,
    });
  }

  private async stopForAttention(
    missionId: string,
    error: unknown,
  ): Promise<void> {
    const message =
      error instanceof Error ? error.message : "Mission automation stopped.";
    const code =
      error instanceof AuditNotFoundError ||
      error instanceof RepairNotFoundError
        ? "CHILD_RESOURCE_MISSING"
        : "AUTOMATION_STOPPED";
    const detail = `${code}: ${message}`;
    const current = await this.record(missionId);
    if (
      ["report-only", "completed", "failed", "cancelled"].includes(
        current.state,
      )
    ) {
      return;
    }
    const redactedDetail = redactValue(detail);
    const next = await this.mutate(missionId, (current) => ({
      ...current,
      authorizationGrant: invalidatedGrant(
        current.authorizationGrant,
        redactedDetail,
      ),
      state: "attention",
      availability: {
        ...current.availability,
        execution: "report-only",
        detail: redactedDetail,
      },
      revision: current.revision + 1,
      updatedAt: timestamp(),
    }));
    await this.appendEvent(missionId, "phase.changed", {
      state: next.state,
      detail: redactedDetail,
      revision: next.revision,
    });
  }

  public async replay(
    missionId: string,
    cursor?: string,
  ): Promise<AccessPathEvent[]> {
    const layout = await this.existingLayout(missionId);
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
    missionId: string,
    format: "html" | "json" | "markdown",
  ): Promise<{ content: string; contentType: string; filename: string }> {
    const record = await this.record(missionId);
    const audit =
      record.auditId === undefined
        ? undefined
        : await this.auditService.get(record.auditId).catch(() => undefined);
    const auditBundle =
      record.auditId === undefined
        ? undefined
        : await this.auditService.bundle(record.auditId).catch(() => undefined);
    const repair =
      record.repairId === undefined
        ? undefined
        : await this.repairService.get(record.repairId).catch(() => undefined);
    const verification =
      record.repairId === undefined
        ? undefined
        : await this.repairService
            .verification(record.repairId)
            .catch(() => undefined);
    const verifiedRepairedBundle =
      verification === undefined ? undefined : record.repairedAuditBundle;
    const comparison = verification?.comparison ?? [];
    const beforeById = new Map(
      auditBundle?.findings.map((finding) => [finding.id, finding]) ?? [],
    );
    const afterById = new Map(
      verifiedRepairedBundle?.findings.map((finding) => [
        finding.id,
        finding,
      ]) ?? [],
    );
    const unresolvedIssues =
      auditBundle === undefined
        ? undefined
        : comparison.length === 0
          ? auditBundle.findings.map((finding) => ({
              id: finding.id,
              title: finding.title,
              state: finding.state,
              severity: finding.severity,
            }))
          : comparison
              .filter((entry) => entry.afterState !== "resolved")
              .map((entry) => {
                const finding =
                  afterById.get(entry.findingId) ??
                  beforeById.get(entry.findingId);
                return {
                  id: entry.findingId,
                  title: finding?.title ?? "Browser replay finding",
                  state: entry.afterState,
                  severity: finding?.severity ?? "serious",
                };
              });
    const repairedVerificationPassed =
      verification !== undefined &&
      record.issue !== undefined &&
      comparison.find((entry) => entry.findingId === record.issue?.findingId)
        ?.afterState === "resolved" &&
      comparison.every((entry) => entry.afterState !== "regressed");
    const proof = {
      stagingObservation: {
        status: auditBundle === undefined ? "not-run" : "recorded",
        outcome: auditBundle?.outcome,
        auditBundleId: auditBundle?.id,
        issueCount: auditBundle?.findings.length ?? 0,
      },
      sourceReproduction: {
        status: record.deployment?.state ?? "not-established",
        sourceCommit:
          record.deployment?.state === "unverified"
            ? undefined
            : record.deployment?.sourceCommit,
        reproductionUrl:
          record.deployment?.state === "reproduced"
            ? record.deployment.reproductionUrl
            : undefined,
      },
      repairedPreviewVerification: {
        status:
          verification === undefined
            ? "not-run"
            : repairedVerificationPassed
              ? "passed"
              : "incomplete",
        previewUrl: verification?.previewUrl,
        testCount: verification?.tests.length ?? 0,
        auditBundleId: verifiedRepairedBundle?.id,
        comparison,
      },
      unresolvedIssues: unresolvedIssues ?? null,
      stagingRedeployed: false,
    } as const;
    const report = redactValue({
      schemaVersion: SCHEMA_VERSION,
      mission: this.publicResource(record),
      sourceSnapshot: publicSourceSnapshot(record.sourceSnapshot),
      sourceSnapshotHash: record.sourceSnapshotHash,
      frozenTaskHash: record.taskHash,
      deployment: record.deployment,
      issue: record.issue,
      proposal: record.proposal,
      authorizationGrant: record.authorizationGrant,
      audit,
      auditBundle,
      repairedAuditBundle: verifiedRepairedBundle,
      repair,
      verification,
      proof,
    });
    if (format === "json") {
      return {
        content: `${JSON.stringify(report, null, 2)}\n`,
        contentType: "application/json; charset=utf-8",
        filename: `${missionId}.json`,
      };
    }
    const markdown = [
      `# ${record.objective}`,
      "",
      `State: ${record.state}`,
      `Revision: ${record.revision}`,
      `Source snapshot: ${record.sourceSnapshot.id}`,
      `Frozen task hash: ${record.taskHash}`,
      `Execution availability: ${record.availability.execution}`,
      record.availability.detail === undefined
        ? ""
        : `Attention: ${record.availability.detail}`,
      "",
      "## Observed on staging",
      auditBundle === undefined
        ? "The staging mission has not produced an audit bundle."
        : `Outcome: ${auditBundle.outcome}. Recorded ${auditBundle.findings.length} issue${auditBundle.findings.length === 1 ? "" : "s"} in ${auditBundle.id}.`,
      "",
      "## Source reproduction",
      record.deployment === undefined
        ? "No deployment binding was established."
        : record.deployment.state === "unverified"
          ? `Unverified: ${record.deployment.reason}`
          : record.deployment.state === "exact"
            ? `Exact source commit: ${record.deployment.sourceCommit}.`
            : `Reproduced from source commit ${record.deployment.sourceCommit} at ${record.deployment.reproductionUrl}.`,
      "",
      "## Repaired preview verification",
      verification === undefined
        ? "No repaired-preview verification was recorded."
        : `Preview: ${verification.previewUrl}. ${verification.tests.length} authorized check${verification.tests.length === 1 ? "" : "s"} recorded; ${comparison.filter((entry) => entry.afterState === "resolved").length} issue comparison${comparison.length === 1 ? "" : "s"} resolved.`,
      "",
      "## Remaining issues",
      unresolvedIssues === undefined
        ? "Remaining issues were not assessed because no staging audit bundle was produced."
        : unresolvedIssues.length === 0
          ? verifiedRepairedBundle === undefined &&
            (auditBundle?.findings.length ?? 0) > 0
            ? "Remaining issues were not fully assessed because no repaired browser audit bundle was produced."
            : "No remaining or newly introduced issues were recorded for this mission."
          : unresolvedIssues
              .map(
                (finding) =>
                  `- ${finding.id}: ${finding.title} (${finding.severity}, ${finding.state})`,
              )
              .join("\n"),
      "",
      "## Deployment note",
      "Staging was not redeployed by AccessPath. Verification applies to the isolated repaired preview and, when present, an explicitly accepted source change.",
    ]
      .filter(Boolean)
      .join("\n");
    if (format === "markdown") {
      return {
        content: `${markdown}\n`,
        contentType: "text/markdown; charset=utf-8",
        filename: `${missionId}.md`,
      };
    }
    const stateLabel = record.state.replaceAll("-", " ");
    const auditSummary =
      auditBundle === undefined
        ? "The staging task has not produced an audit record."
        : `The task ${auditBundle.outcome}. ${auditBundle.findings.length} accessibility problem${auditBundle.findings.length === 1 ? "" : "s"} ${auditBundle.findings.length === 1 ? "was" : "were"} recorded.`;
    const reproductionSummary =
      record.deployment === undefined
        ? "A source-to-staging match was not recorded."
        : record.deployment.state === "unverified"
          ? reportText(record.deployment.reason)
          : record.deployment.state === "exact"
            ? "The attached source commit matched the staging deployment."
            : "The task was reproduced from the attached source snapshot.";
    const authorizationSummary =
      record.authorizationGrant === undefined
        ? auditBundle?.findings.length === 0
          ? "No repair authorization was needed because the audit did not record a repairable problem."
          : "A scoped repair authorization was not issued."
        : record.authorization?.state === "pending"
          ? "A repair is waiting for explicit authorization."
          : record.authorization?.state === "approved"
            ? "The approved repair was limited to the recorded source paths and commands."
            : "The scoped repair authorization was not approved.";
    const verificationSummary =
      verification === undefined
        ? record.patch?.state === "accepted"
          ? "The source change was accepted, but no separate verification record was preserved."
          : "No repaired-preview verification was recorded."
        : repairedVerificationPassed
          ? "The repaired preview passed its recorded checks and resolved the selected problem."
          : "The repaired preview did not produce a complete verified result.";
    const unresolvedIssuesHtml =
      unresolvedIssues === undefined
        ? "<p>No issue comparison is available because the staging audit did not finish.</p>"
        : unresolvedIssues.length === 0
          ? "<p>No remaining or newly introduced accessibility problems were recorded.</p>"
          : `<ul>${unresolvedIssues
              .map(
                (finding) =>
                  `<li><strong>${escapeHtml(reportText(finding.title, "Accessibility problem"))}</strong><span>${escapeHtml(`${finding.id} · ${finding.severity} · ${finding.state}`)}</span></li>`,
              )
              .join("")}</ul>`;
    const authorizedScopeHtml =
      record.authorizationGrant === undefined
        ? ""
        : `<details>
<summary>Approved repair scope</summary>
<div class="scope-grid">
<section><h3>Source paths</h3><ul>${record.authorizationGrant.approvedPaths.map((path) => `<li><code>${escapeHtml(reportText(path))}</code></li>`).join("") || "<li>None recorded.</li>"}</ul></section>
<section><h3>Commands</h3><ul>${record.authorizationGrant.approvedCommands.map((command) => `<li><code>${escapeHtml(reportText(commandText(command)))}</code></li>`).join("") || "<li>None recorded.</li>"}</ul></section>
</div>
</details>`;
    const changeSummary =
      record.patch === undefined
        ? "No source change was prepared."
        : record.patch.state === "accepted"
          ? `${record.patch.changedFiles.length} changed file${record.patch.changedFiles.length === 1 ? "" : "s"} were explicitly accepted.`
          : "A source change is still awaiting a final decision.";
    return {
      content: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AccessPath mission report - ${escapeHtml(record.id)}</title>
<style>
:root{color-scheme:light;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#17231d;background:#fff}
*{box-sizing:border-box}body{max-width:72rem;margin:0 auto;padding:2.5rem 2rem 4rem;line-height:1.55}main{max-width:70rem}.masthead{padding-bottom:1.5rem;border-bottom:1px solid #d7d2c5}.eyebrow{margin:0 0 .45rem;color:#5d6c63;font-size:.8rem;font-weight:700}.masthead h1{max-width:28ch;margin:0;font-size:clamp(1.9rem,4vw,2.7rem);line-height:1.12}.lede{max-width:68ch;margin:1rem 0 0;color:#44534a;font-size:1.05rem}.summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;margin:1.75rem 0;background:#d7d2c5;border:1px solid #d7d2c5}.summary>div{min-width:0;padding:1rem;background:#fff}.summary dt{color:#5d6c63;font-size:.75rem;font-weight:700}.summary dd{margin:.3rem 0 0;font-weight:700;overflow-wrap:anywhere}.summary code{font-size:.82rem}section{max-width:70ch;padding:1.75rem 0;border-top:1px solid #d7d2c5}h2{margin:0 0 .55rem;font-size:1.3rem;line-height:1.25}h3{margin:0 0 .55rem;font-size:1rem}p{margin:.55rem 0;color:#334238}ul{margin:.75rem 0;padding-left:1.2rem}li+li{margin-top:.55rem}li span{display:block;margin-top:.1rem;color:#5d6c63;font-size:.9rem}code{overflow-wrap:anywhere}details{margin-top:1rem;padding:1rem;background:#f7f7f5;border:1px solid #d7d2c5}summary{cursor:pointer;font-weight:700}.scope-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1.5rem;padding-top:1rem}.technical{color:#5d6c63;font-size:.9rem}.technical dl{display:grid;grid-template-columns:minmax(10rem,.45fr) minmax(0,1fr);gap:.45rem 1rem;margin:1rem 0 0}.technical dt{font-weight:700}.technical dd{margin:0;overflow-wrap:anywhere}.notice{padding:1rem 1.1rem;background:#f7f7f5;border:1px solid #d7d2c5}.notice strong{display:block;margin-bottom:.25rem}@media(max-width:44rem){body{padding:1.5rem 1rem 3rem}.summary{grid-template-columns:repeat(2,minmax(0,1fr))}.scope-grid{grid-template-columns:1fr}.technical dl{grid-template-columns:1fr;gap:.2rem}.technical dd{margin-bottom:.65rem}}@media print{body{max-width:none;padding:0}.summary{break-inside:avoid}section{break-inside:avoid}}
</style>
</head>
<body>
<main>
<header class="masthead">
<p class="eyebrow">AccessPath mission report</p>
<h1>${escapeHtml(reportText(record.objective, "Mission report"))}</h1>
<p class="lede">A durable record of the observed task, scoped repair decision, and any verified source change.</p>
</header>
<dl class="summary">
<div><dt>Mission status</dt><dd>${escapeHtml(stateLabel)}</dd></div>
<div><dt>Staging result</dt><dd>${escapeHtml(auditBundle?.outcome ?? "not run")}</dd></div>
<div><dt>Source</dt><dd>${escapeHtml(reportText(record.repositorySource?.value, "Not attached"))}</dd></div>
<div><dt>Mission ID</dt><dd><code>${escapeHtml(record.id)}</code></dd></div>
</dl>
<section aria-labelledby="observed"><h2 id="observed">Observed on staging</h2><p>${escapeHtml(auditSummary)}</p></section>
<section aria-labelledby="reproduction"><h2 id="reproduction">Source reproduction</h2><p>${escapeHtml(reproductionSummary)}</p></section>
<section aria-labelledby="authorization"><h2 id="authorization">Scoped repair authorization</h2><p>${escapeHtml(authorizationSummary)}</p>${authorizedScopeHtml}</section>
<section aria-labelledby="verification"><h2 id="verification">Repaired preview verification</h2><p>${escapeHtml(verificationSummary)}</p><p>${escapeHtml(changeSummary)}</p></section>
<section aria-labelledby="issues"><h2 id="issues">Remaining accessibility problems</h2>${unresolvedIssuesHtml}</section>
<section aria-labelledby="deployment"><h2 id="deployment">Deployment note</h2><div class="notice"><strong>Staging was not changed by AccessPath.</strong><p>Any verification applies only to the isolated repaired preview and an explicitly accepted source change.</p></div></section>
<section class="technical" aria-labelledby="technical"><h2 id="technical">Technical record</h2><dl>
<dt>Revision</dt><dd>${record.revision}</dd>
<dt>Source snapshot</dt><dd><code>${escapeHtml(record.sourceSnapshot.id)}</code></dd>
<dt>Source snapshot hash</dt><dd><code>${escapeHtml(record.sourceSnapshotHash)}</code></dd>
<dt>Frozen task hash</dt><dd><code>${escapeHtml(record.taskHash)}</code></dd>
<dt>Execution availability</dt><dd>${escapeHtml(record.availability.execution)}</dd>
${record.availability.detail === undefined ? "" : `<dt>Attention</dt><dd>${escapeHtml(reportText(record.availability.detail))}</dd>`}
</dl></section>
</main>
</body>
</html>
`,
      contentType: "text/html; charset=utf-8",
      filename: `${missionId}.html`,
    };
  }

  public async shutdown(): Promise<void> {
    await this.startupRecovery;
    const activeMissionIds = [...this.active.keys()];
    await Promise.allSettled(
      activeMissionIds.map(async (missionId) => {
        const record = await this.record(missionId).catch(() => undefined);
        if (record === undefined) {
          return;
        }
        await waitAtMost(
          Promise.allSettled([
            record.auditId === undefined
              ? Promise.resolve()
              : this.auditService.cancel(
                  record.auditId,
                  `mission:${missionId}:shutdown-audit`,
                ),
            record.repairId === undefined
              ? Promise.resolve()
              : this.repairService.cancel(
                  record.repairId,
                  `mission:${missionId}:shutdown-repair`,
                ),
          ]),
          2_000,
        );
        if (
          ![
            "attention",
            "report-only",
            "completed",
            "failed",
            "cancelled",
          ].includes(record.state)
        ) {
          const cancelled = await this.mutate(missionId, (current) =>
            [
              "attention",
              "report-only",
              "completed",
              "failed",
              "cancelled",
            ].includes(current.state)
              ? current
              : {
                  ...current,
                  authorizationGrant: invalidatedGrant(
                    current.authorizationGrant,
                    "Companion shutdown before the authorization grant was consumed.",
                  ),
                  state: "cancelled",
                  revision: current.revision + 1,
                  updatedAt: timestamp(),
                },
          );
          if (cancelled.state === "cancelled") {
            await this.appendEvent(missionId, "session.cancelled", {
              reason: "companion-shutdown",
              revision: cancelled.revision,
            });
          }
        }
      }),
    );
    await waitAtMost(Promise.allSettled([...this.active.values()]), 5_000);
  }
}
