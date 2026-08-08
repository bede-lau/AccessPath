import {
  AccessPathEventSchema,
  ApprovalDecisionSchema,
  ApprovalRequestSchema,
  AuditBundleSchema,
  AuditSessionSchema,
  ErrorResponseSchema,
  MissionSessionStateSchema,
  RepairManifestSchema,
  RepairSessionSchema,
  RepositoryConfigSchema,
  RewindPreviewSchema,
  TaskContractSchema,
  TestResultSchema,
  VerificationRunSchema,
  type AccessPathEvent,
  type ApprovalDecision,
  type ApprovalRequest,
  type AuditBundle,
  type AuditSession,
  type MissionSessionState,
  type RepairManifest,
  type RepairSession,
  type RepositoryConfig,
  type RewindPreview,
  type TaskContract,
  type TestResult,
  type VerificationRun,
} from "@accesspath/contracts";

const LAUNCH_TOKEN =
  import.meta.env.VITE_ACCESSPATH_LAUNCH_TOKEN ?? "accesspath-local-development";

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export type PublicConfig = {
  schemaVersion: "1.0.0";
  supportsAudit: true;
  supportsRepair: true;
  targetPolicies: Array<"public" | "local-explicit">;
  reportFormats: Array<"html" | "markdown" | "json">;
  demoAidAppPort: number;
};

export type ApprovalRecord = {
  request: ApprovalRequest;
  decision?: ApprovalDecision;
  decidedAt?: string;
};

export type RepairPlan = {
  text: string;
  qoderSessionId: string;
};

export type RepairDiff = {
  baseCommit: string;
  patch: string;
  stat: string;
  changedFiles: string[];
};

export type RepairResource = {
  repair: RepairSession;
  manifest: RepairManifest;
  plan?: RepairPlan;
  approvals: ApprovalRecord[];
  tests: TestResult[];
  verification?: VerificationRun;
  baseIntegrity: { unchanged: boolean };
};

export type RepositoryValidation = {
  repositoryDisplayName: string;
  baseBranch: string;
  baseCommit: string;
  clean: true;
};

export type MissionRepositorySource =
  | { kind: "local"; value: string }
  | { kind: "public-git"; value: string; commit?: string };

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
  state:
    | "queued"
    | "running"
    | "passed"
    | "observation"
    | "blocked"
    | "skipped"
    | "failed";
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

export type MissionAuthorization = {
  id: string;
  state: "pending" | "approved" | "denied" | "expired";
  title: string;
  consequence: string;
  paths: string[];
  commands: string[];
};

export type MissionPatch = {
  patch: string;
  stat: string;
  changedFiles: string[];
  state: "pending" | "accepted" | "rejected";
  integration?: "demo-merged";
};

export type MissionAvailability = {
  execution: "available" | "report-only" | "sandbox-unavailable";
  source: "bound" | "unbound";
  detail?: string;
};

export type MissionState = MissionSessionState;

export type MissionResource = {
  id: string;
  revision: number;
  state: MissionState;
  stagingUrl: string;
  repositorySource?: MissionRepositorySource;
  objective: string;
  plan: {
    frozen: boolean;
    steps: MissionPlanStep[];
  };
  observedSteps: MissionObservedStep[];
  proofThread: MissionProofItem[];
  authorization?: MissionAuthorization;
  patch?: MissionPatch;
  availability: MissionAvailability;
  reportAvailable: boolean;
  provenance?: "saved-run-replay";
  createdAt?: string;
  updatedAt?: string;
};

export type CreateMissionInput = {
  stagingUrl: string;
  repositorySource: MissionRepositorySource;
  objective: string;
};

function parseProofThread(input: unknown): MissionProofItem[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input.flatMap((value) => {
    if (typeof value !== "object" || value === null) {
      return [];
    }
    const item = value as Record<string, unknown>;
    if (
      typeof item.id !== "string" ||
      (item.stage !== "observed" &&
        item.stage !== "scoped-repair" &&
        item.stage !== "verified" &&
        item.stage !== "merged") ||
      (item.status !== "pending" &&
        item.status !== "active" &&
        item.status !== "complete" &&
        item.status !== "blocked") ||
      typeof item.title !== "string" ||
      typeof item.summary !== "string"
    ) {
      return [];
    }
    const evidence = Array.isArray(item.evidence)
      ? item.evidence.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : undefined;
    return [
      {
        id: item.id,
        stage: item.stage,
        status: item.status,
        title: item.title,
        summary: item.summary,
        ...(evidence === undefined ? {} : { evidence }),
      },
    ];
  });
}

function parseObservedSteps(input: unknown): MissionObservedStep[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input.flatMap((value) => {
    if (typeof value !== "object" || value === null) {
      return [];
    }
    const step = value as Record<string, unknown>;
    if (
      typeof step.id !== "string" ||
      typeof step.instruction !== "string" ||
      (step.state !== "queued" &&
        step.state !== "running" &&
        step.state !== "passed" &&
        step.state !== "observation" &&
        step.state !== "blocked" &&
        step.state !== "skipped" &&
        step.state !== "failed") ||
      !Array.isArray(step.issues)
    ) {
      return [];
    }
    const issues = step.issues.flatMap((issue) => {
      if (typeof issue !== "object" || issue === null) {
        return [];
      }
      const candidate = issue as Record<string, unknown>;
      return typeof candidate.id === "string" &&
        typeof candidate.summary === "string"
        ? [{ id: candidate.id, summary: candidate.summary }]
        : [];
    });
    if (issues.length === 0) {
      return [];
    }
    const rawScreenshot =
      typeof step.screenshot === "object" && step.screenshot !== null
        ? (step.screenshot as Record<string, unknown>)
        : undefined;
    const screenshot =
      rawScreenshot !== undefined &&
      typeof rawScreenshot.artifactId === "string" &&
      typeof rawScreenshot.sessionId === "string" &&
      typeof rawScreenshot.alt === "string"
        ? {
            artifactId: rawScreenshot.artifactId,
            sessionId: rawScreenshot.sessionId,
            alt: rawScreenshot.alt,
          }
        : undefined;
    return [
      {
        id: step.id,
        instruction: step.instruction,
        state: step.state,
        ...(screenshot === undefined ? {} : { screenshot }),
        issues,
      },
    ];
  });
}

function parseMissionResource(input: unknown): MissionResource {
  const candidate =
    typeof input === "object" &&
    input !== null &&
    "mission" in input
      ? (input as { mission: unknown }).mission
      : input;
  if (typeof candidate !== "object" || candidate === null) {
    throw new ApiError(502, "The companion returned an invalid mission.");
  }
  const mission = candidate as Record<string, unknown>;
  const plan =
    typeof mission.plan === "object" && mission.plan !== null
      ? (mission.plan as Record<string, unknown>)
      : undefined;
  const state = MissionSessionStateSchema.safeParse(mission.state);
  if (
    typeof mission.id !== "string" ||
    !state.success ||
    !Number.isInteger(mission.revision) ||
    typeof mission.stagingUrl !== "string" ||
    typeof mission.objective !== "string"
  ) {
    throw new ApiError(502, "The companion returned an invalid mission.");
  }
  const rawSteps =
    Array.isArray(plan?.steps)
      ? plan.steps
      : Array.isArray(mission.steps)
        ? mission.steps
        : [];
  const steps = rawSteps.flatMap((value, index) => {
    if (typeof value !== "object" || value === null) {
      return [];
    }
    const step = value as Record<string, unknown>;
    const instruction =
      typeof step.instruction === "string"
        ? step.instruction
        : typeof step.title === "string"
          ? step.title
          : typeof step.intent === "string"
            ? step.intent
            : undefined;
    if (instruction === undefined || instruction.trim() === "") {
      return [];
    }
    return [
      {
        id: typeof step.id === "string" ? step.id : `step-${index + 1}`,
        instruction,
      },
    ];
  });
  const explicitSource =
    typeof mission.repositorySource === "object" &&
    mission.repositorySource !== null
      ? (mission.repositorySource as Record<string, unknown>)
      : undefined;
  let repositorySource: MissionRepositorySource | undefined;
  if (
    explicitSource?.kind === "local" &&
    typeof explicitSource.value === "string"
  ) {
    repositorySource = { kind: "local", value: explicitSource.value };
  } else if (
    explicitSource?.kind === "public-git" &&
    typeof explicitSource.value === "string"
  ) {
    repositorySource = {
      kind: "public-git",
      value: explicitSource.value,
      ...(typeof explicitSource.commit === "string"
        ? { commit: explicitSource.commit }
        : {}),
    };
  }
  const hasAuthorization = Object.prototype.hasOwnProperty.call(
    mission,
    "authorization",
  );
  if (
    hasAuthorization &&
    (typeof mission.authorization !== "object" ||
      mission.authorization === null)
  ) {
    throw new ApiError(
      502,
      "The companion returned an invalid mission authorization.",
    );
  }
  const rawAuthorization = hasAuthorization
    ? (mission.authorization as Record<string, unknown>)
    : undefined;
  let authorization: MissionAuthorization | undefined;
  if (rawAuthorization !== undefined) {
    const paths = rawAuthorization.paths;
    const commandInputs = rawAuthorization.commands;
    if (
      typeof rawAuthorization.id !== "string" ||
      (rawAuthorization.state !== "pending" &&
        rawAuthorization.state !== "approved" &&
        rawAuthorization.state !== "denied" &&
        rawAuthorization.state !== "expired") ||
      typeof rawAuthorization.title !== "string" ||
      typeof rawAuthorization.consequence !== "string" ||
      !Array.isArray(paths) ||
      !paths.every((path) => typeof path === "string") ||
      !Array.isArray(commandInputs) ||
      !commandInputs.every((command) => typeof command === "string")
    ) {
      throw new ApiError(
        502,
        "The companion returned an invalid mission authorization.",
      );
    }
    authorization = {
      id: rawAuthorization.id,
      state: rawAuthorization.state,
      title: rawAuthorization.title,
      consequence: rawAuthorization.consequence,
      paths: paths as string[],
      commands: commandInputs as string[],
    };
  }
  const explicitAvailability =
    typeof mission.availability === "object" &&
    mission.availability !== null
      ? (mission.availability as Record<string, unknown>)
      : undefined;
  if (
    explicitAvailability === undefined ||
    (explicitAvailability.execution !== "available" &&
      explicitAvailability.execution !== "report-only" &&
      explicitAvailability.execution !== "sandbox-unavailable") ||
    (explicitAvailability.source !== "bound" &&
      explicitAvailability.source !== "unbound") ||
    (explicitAvailability.detail !== undefined &&
      typeof explicitAvailability.detail !== "string")
  ) {
    throw new ApiError(
      502,
      "The companion returned invalid mission availability.",
    );
  }
  const availability: MissionAvailability = {
    execution: explicitAvailability.execution,
    source: explicitAvailability.source,
    ...(typeof explicitAvailability.detail === "string"
      ? { detail: explicitAvailability.detail }
      : {}),
  };
  const proofThread = parseProofThread(mission.proofThread);
  const observedSteps = parseObservedSteps(mission.observedSteps);
  const hasPatch = Object.prototype.hasOwnProperty.call(mission, "patch");
  if (
    hasPatch &&
    (typeof mission.patch !== "object" || mission.patch === null)
  ) {
    throw new ApiError(502, "The companion returned an invalid mission patch.");
  }
  const rawPatch = hasPatch
    ? (mission.patch as Record<string, unknown>)
    : undefined;
  let patch: MissionPatch | undefined;
  if (rawPatch !== undefined) {
    if (
      typeof rawPatch.patch !== "string" ||
      typeof rawPatch.stat !== "string" ||
      !Array.isArray(rawPatch.changedFiles) ||
      !rawPatch.changedFiles.every((path) => typeof path === "string") ||
      (rawPatch.state !== "pending" &&
        rawPatch.state !== "accepted" &&
        rawPatch.state !== "rejected") ||
      (rawPatch.integration !== undefined &&
        rawPatch.integration !== "demo-merged")
    ) {
      throw new ApiError(502, "The companion returned an invalid mission patch.");
    }
    patch = {
      patch: rawPatch.patch,
      stat: rawPatch.stat,
      changedFiles: rawPatch.changedFiles as string[],
      state: rawPatch.state,
      ...(rawPatch.integration === "demo-merged"
        ? { integration: "demo-merged" as const }
        : {}),
    };
  }
  return {
    id: mission.id,
    revision: mission.revision as number,
    state: state.data,
    stagingUrl: mission.stagingUrl,
    ...(repositorySource === undefined ? {} : { repositorySource }),
    objective: mission.objective,
    plan: {
      frozen:
        typeof plan?.frozen === "boolean"
          ? plan.frozen
          : typeof plan?.frozenAt === "string",
      steps,
    },
    observedSteps,
    proofThread,
    ...(authorization === undefined ? {} : { authorization }),
    ...(patch === undefined ? {} : { patch }),
    availability,
    reportAvailable:
      typeof mission.reportAvailable === "boolean"
        ? mission.reportAvailable
        : ["completed", "report-only", "attention"].includes(state.data),
    ...(mission.provenance === "saved-run-replay"
      ? { provenance: "saved-run-replay" as const }
      : {}),
    ...(typeof mission.createdAt === "string"
      ? { createdAt: mission.createdAt }
      : {}),
    ...(typeof mission.updatedAt === "string"
      ? { updatedAt: mission.updatedAt }
      : {}),
  };
}

function missionMutationHeaders(expectedRevision: number): HeadersInit {
  return {
    "content-type": "application/json",
    "idempotency-key": crypto.randomUUID(),
    "expected-mission-revision": String(expectedRevision),
  };
}

async function missionMutation(
  missionId: string,
  path: string,
  expectedRevision: number,
  method: "POST" | "PATCH",
  body: Record<string, unknown> = {},
): Promise<MissionResource> {
  const response = await request(
    `/api/missions/${encodeURIComponent(missionId)}/${path}`,
    {
      method,
      headers: missionMutationHeaders(expectedRevision),
      body: JSON.stringify(body),
    },
  );
  return parseMissionResource(await response.json());
}

export async function createMission(
  input: CreateMissionInput,
): Promise<MissionResource> {
  const response = await request("/api/missions", {
    method: "POST",
    headers: missionMutationHeaders(0),
    body: JSON.stringify(input),
  });
  return parseMissionResource(await response.json());
}

export async function compileMission(
  missionId: string,
  expectedRevision: number,
  input: Pick<CreateMissionInput, "objective">,
): Promise<MissionResource> {
  return missionMutation(missionId, "compile", expectedRevision, "POST", input);
}

export async function getMission(
  missionId: string,
): Promise<MissionResource> {
  const response = await request(
    `/api/missions/${encodeURIComponent(missionId)}`,
  );
  return parseMissionResource(await response.json());
}

export async function updateMissionPlan(
  missionId: string,
  expectedRevision: number,
  steps: MissionPlanStep[],
): Promise<MissionResource> {
  if (
    steps.length === 0 ||
    steps.some(
      (step) =>
        typeof step.id !== "string" ||
        typeof step.instruction !== "string" ||
        step.instruction.trim() === "",
    )
  ) {
    throw new ApiError(400, "The mission plan requires at least one complete step.");
  }
  return missionMutation(
    missionId,
    "plan",
    expectedRevision,
    "PATCH",
    { steps },
  );
}

export const runMission = (missionId: string, expectedRevision: number) =>
  missionMutation(missionId, "run", expectedRevision, "POST");

export async function decideMissionAuthorization(
  missionId: string,
  expectedRevision: number,
  decision: "approve-once" | "deny",
): Promise<MissionResource> {
  return missionMutation(
    missionId,
    "repair-authorization",
    expectedRevision,
    "POST",
    {
      decision,
      ...(decision === "deny"
        ? { reason: "Repair authorization was denied in Mission Workspace." }
        : {}),
    },
  );
}

export const acceptMissionPatch = (
  missionId: string,
  expectedRevision: number,
) =>
  missionMutation(
    missionId,
    "patch-acceptance",
    expectedRevision,
    "POST",
    { decision: "approve-once" },
  );

export const mergeVerifiedMissionPatch = (
  missionId: string,
  expectedRevision: number,
) =>
  missionMutation(
    missionId,
    "merge-verified-patch",
    expectedRevision,
    "POST",
  );

export const rejectMissionPatch = (
  missionId: string,
  expectedRevision: number,
) =>
  missionMutation(
    missionId,
    "patch-acceptance",
    expectedRevision,
    "POST",
    {
      decision: "deny",
      reason: "The verified patch was rejected in Mission Workspace.",
    },
  );

export const cancelMission = (missionId: string, expectedRevision: number) =>
  missionMutation(missionId, "cancel", expectedRevision, "POST");

export async function downloadMissionReport(
  missionId: string,
  format: "html" | "markdown" | "json",
): Promise<void> {
  const response = await request(
    `/api/missions/${encodeURIComponent(missionId)}/report?format=${format}`,
  );
  const objectUrl = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = `accesspath-mission-${missionId}.${extension(format)}`;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
}

export async function loadMissionScreenshot(
  artifactId: string,
  sessionId: string,
): Promise<string> {
  const response = await request(
    `/api/artifacts/${encodeURIComponent(artifactId)}?sessionId=${encodeURIComponent(sessionId)}`,
  );
  const image = await response.blob();
  if (!image.type.startsWith("image/")) {
    throw new ApiError(502, "The mission evidence is not an image.");
  }
  return URL.createObjectURL(image);
}

export async function streamMissionEvents(
  missionId: string,
  lastEventId: string | undefined,
  onEvent: (event: AccessPathEvent<Record<string, unknown>>) => void,
  signal: AbortSignal,
): Promise<void> {
  const response = await request(
    `/api/missions/${encodeURIComponent(missionId)}/events`,
    {
      headers:
        lastEventId === undefined
          ? { accept: "text/event-stream" }
          : {
              accept: "text/event-stream",
              "last-event-id": lastEventId,
            },
      signal,
    },
  );
  await readEventStream(response, onEvent, signal);
}

function headers(extra: HeadersInit = {}): Headers {
  const result = new Headers(extra);
  result.set("authorization", `Bearer ${LAUNCH_TOKEN}`);
  return result;
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(path, {
    ...init,
    headers: headers(init.headers),
  });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const parsed = ErrorResponseSchema.parse(await response.json());
      message = parsed.error.message;
    } catch {
      // Preserve the HTTP status when an upstream proxy returns non-contract text.
    }
    throw new ApiError(response.status, message);
  }
  return response;
}

function unwrapAudit(input: unknown): AuditSession {
  if (
    typeof input === "object" &&
    input !== null &&
    "audit" in input
  ) {
    return AuditSessionSchema.parse(input.audit);
  }
  return AuditSessionSchema.parse(input);
}

async function auditRequest(
  path: string,
  init: RequestInit = {},
): Promise<AuditSession> {
  const response = await request(path, init);
  return unwrapAudit(await response.json());
}

export async function createAudit(task: TaskContract): Promise<AuditSession> {
  const parsed = TaskContractSchema.parse(task);
  return auditRequest("/api/audits", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ task: parsed }),
  });
}

export async function mapAuditTarget(
  startUrl: string,
  targetPolicy: "public" | "local-explicit",
): Promise<TaskContract> {
  const response = await request("/api/audits/map-target", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ startUrl, targetPolicy }),
  });
  const input = (await response.json()) as { task?: unknown };
  return TaskContractSchema.parse(input.task);
}

export async function getPublicConfig(): Promise<PublicConfig> {
  const response = await request("/api/config/public");
  const input = (await response.json()) as Partial<PublicConfig>;
  if (
    input.schemaVersion !== "1.0.0" ||
    input.supportsAudit !== true ||
    input.supportsRepair !== true ||
    !Array.isArray(input.targetPolicies) ||
    !Array.isArray(input.reportFormats) ||
    !Number.isInteger(input.demoAidAppPort)
  ) {
    throw new ApiError(502, "The companion returned an invalid public configuration.");
  }
  return input as PublicConfig;
}

export async function getAudit(auditId: string): Promise<AuditSession> {
  return auditRequest(`/api/audits/${encodeURIComponent(auditId)}`);
}

async function transitionAudit(
  auditId: string,
  action: "start" | "pause" | "resume" | "cancel",
): Promise<AuditSession> {
  return auditRequest(
    `/api/audits/${encodeURIComponent(auditId)}/${action}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": `${action}-${auditId}-${globalThis.crypto.randomUUID()}`,
      },
      body: "{}",
    },
  );
}

export const startAudit = (auditId: string) => transitionAudit(auditId, "start");
export const pauseAudit = (auditId: string) => transitionAudit(auditId, "pause");
export const resumeAudit = (auditId: string) => transitionAudit(auditId, "resume");
export const cancelAudit = (auditId: string) => transitionAudit(auditId, "cancel");

function parseApprovalRecord(input: unknown): ApprovalRecord {
  if (typeof input !== "object" || input === null || !("request" in input)) {
    throw new ApiError(502, "The companion returned an invalid approval record.");
  }
  const record = input as {
    request: unknown;
    decision?: unknown;
    decidedAt?: unknown;
  };
  return {
    request: ApprovalRequestSchema.parse(record.request),
    ...(record.decision === undefined
      ? {}
      : { decision: ApprovalDecisionSchema.parse(record.decision) }),
    ...(typeof record.decidedAt === "string"
      ? { decidedAt: record.decidedAt }
      : {}),
  };
}

function parseRepairDiff(input: unknown): RepairDiff {
  if (typeof input !== "object" || input === null) {
    throw new ApiError(502, "The companion returned an invalid repair diff.");
  }
  const diff = input as Partial<RepairDiff>;
  if (
    typeof diff.baseCommit !== "string" ||
    typeof diff.patch !== "string" ||
    typeof diff.stat !== "string" ||
    !Array.isArray(diff.changedFiles) ||
    !diff.changedFiles.every((path) => typeof path === "string")
  ) {
    throw new ApiError(502, "The companion returned an invalid repair diff.");
  }
  return diff as RepairDiff;
}

function unwrapRepair(input: unknown): RepairSession {
  if (typeof input === "object" && input !== null && "repair" in input) {
    return RepairSessionSchema.parse(input.repair);
  }
  return RepairSessionSchema.parse(input);
}

const inFlightRepairKeys = new Map<string, string>();

async function repairRequest(
  repairId: string,
  action:
    | "prepare"
    | "diagnose"
    | "start"
    | "pause"
    | "resume"
    | "cancel"
    | "verify",
): Promise<RepairSession> {
  const operation = `${repairId}:${action}`;
  const idempotencyKey =
    inFlightRepairKeys.get(operation) ?? crypto.randomUUID();
  inFlightRepairKeys.set(operation, idempotencyKey);
  let completed = false;
  try {
    const response = await request(
      `/api/repairs/${encodeURIComponent(repairId)}/${action}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
        },
        body: "{}",
      },
    );
    const repair = unwrapRepair(await response.json());
    completed = true;
    return repair;
  } finally {
    if (
      completed &&
      inFlightRepairKeys.get(operation) === idempotencyKey
    ) {
      inFlightRepairKeys.delete(operation);
    }
  }
}

export async function getRepair(repairId: string): Promise<RepairResource> {
  const response = await request(`/api/repairs/${encodeURIComponent(repairId)}`);
  const input = (await response.json()) as Record<string, unknown>;
  const planInput = input.plan;
  let plan: RepairPlan | undefined;
  if (planInput !== undefined && planInput !== null) {
    if (
      typeof planInput !== "object" ||
      typeof (planInput as RepairPlan).text !== "string" ||
      typeof (planInput as RepairPlan).qoderSessionId !== "string"
    ) {
      throw new ApiError(502, "The companion returned an invalid repair plan.");
    }
    plan = planInput as RepairPlan;
  }
  if (!Array.isArray(input.approvals) || !Array.isArray(input.tests)) {
    throw new ApiError(502, "The companion returned an invalid repair resource.");
  }
  const baseIntegrity = input.baseIntegrity as
    | { unchanged?: unknown }
    | undefined;
  if (typeof baseIntegrity?.unchanged !== "boolean") {
    throw new ApiError(502, "The companion returned invalid base integrity.");
  }
  return {
    repair: RepairSessionSchema.parse(input.repair),
    manifest: RepairManifestSchema.parse(input.manifest),
    ...(plan === undefined ? {} : { plan }),
    approvals: input.approvals.map(parseApprovalRecord),
    tests: input.tests.map((test) => TestResultSchema.parse(test)),
    ...(input.verification === undefined || input.verification === null
      ? {}
      : { verification: VerificationRunSchema.parse(input.verification) }),
    baseIntegrity: { unchanged: baseIntegrity.unchanged },
  };
}

export async function validateRepository(
  repositoryPath: string,
): Promise<RepositoryValidation> {
  const response = await request("/api/repositories/validate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ repositoryPath }),
  });
  const input = (await response.json()) as {
    repository?: Partial<RepositoryValidation>;
  };
  const repository = input.repository;
  if (
    typeof repository?.repositoryDisplayName !== "string" ||
    typeof repository.baseBranch !== "string" ||
    typeof repository.baseCommit !== "string" ||
    repository.clean !== true
  ) {
    throw new ApiError(502, "The companion returned invalid repository metadata.");
  }
  return repository as RepositoryValidation;
}

export async function createRepair(
  repository: RepositoryConfig,
  manifest: RepairManifest,
): Promise<RepairSession> {
  const response = await request("/api/repairs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      repository: RepositoryConfigSchema.parse(repository),
      manifest: RepairManifestSchema.parse(manifest),
    }),
  });
  return unwrapRepair(await response.json());
}

export const prepareRepair = (repairId: string) =>
  repairRequest(repairId, "prepare");
export const diagnoseRepair = (repairId: string) =>
  repairRequest(repairId, "diagnose");
export const startRepair = (repairId: string) =>
  repairRequest(repairId, "start");
export const pauseRepair = (repairId: string) =>
  repairRequest(repairId, "pause");
export const resumeRepair = (repairId: string) =>
  repairRequest(repairId, "resume");
export const cancelRepair = (repairId: string) =>
  repairRequest(repairId, "cancel");
export const verifyRepair = (repairId: string) =>
  repairRequest(repairId, "verify");

export async function getRepairDiff(repairId: string): Promise<RepairDiff> {
  const response = await request(
    `/api/repairs/${encodeURIComponent(repairId)}/diff`,
  );
  const input = (await response.json()) as { diff?: unknown };
  return parseRepairDiff(input.diff);
}

export async function decideRepairApproval(
  repairId: string,
  approvalId: string,
  decision: ApprovalDecision,
): Promise<ApprovalRecord> {
  const parsed = ApprovalDecisionSchema.parse(decision);
  const response = await request(
    `/api/repairs/${encodeURIComponent(repairId)}/approvals/${encodeURIComponent(approvalId)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(parsed),
    },
  );
  const input = (await response.json()) as { approval?: unknown };
  return parseApprovalRecord(input.approval);
}

export async function previewRepairRewind(
  repairId: string,
): Promise<{ approval: ApprovalRequest; preview: RewindPreview }> {
  const response = await request(
    `/api/repairs/${encodeURIComponent(repairId)}/rewind/preview`,
    { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
  );
  const input = (await response.json()) as {
    approval?: unknown;
    preview?: unknown;
  };
  return {
    approval: ApprovalRequestSchema.parse(input.approval),
    preview: RewindPreviewSchema.parse(input.preview),
  };
}

export async function applyRepairRewind(
  repairId: string,
  approvalId: string,
): Promise<RepairDiff> {
  const response = await request(
    `/api/repairs/${encodeURIComponent(repairId)}/rewind`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approvalId }),
    },
  );
  const input = (await response.json()) as { diff?: unknown };
  return parseRepairDiff(input.diff);
}

export async function getAuditBundle(auditId: string): Promise<AuditBundle> {
  const response = await request(
    `/api/audits/${encodeURIComponent(auditId)}/bundle`,
  );
  return AuditBundleSchema.parse(await response.json());
}

export async function fetchArtifactUrl(
  artifactId: string,
  sessionId: string,
): Promise<string> {
  const response = await request(
    `/api/artifacts/${encodeURIComponent(artifactId)}?sessionId=${encodeURIComponent(sessionId)}`,
  );
  return URL.createObjectURL(await response.blob());
}

function extension(format: "html" | "markdown" | "json"): string {
  return format === "markdown" ? "md" : format;
}

export async function downloadReport(
  auditId: string,
  format: "html" | "markdown" | "json",
): Promise<void> {
  const response = await request(
    `/api/audits/${encodeURIComponent(auditId)}/report?format=${format}`,
  );
  const objectUrl = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = `accesspath-${auditId}.${extension(format)}`;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
}

export async function downloadRepairReport(
  repairId: string,
  format: "html" | "markdown" | "json",
): Promise<void> {
  const response = await request(
    `/api/repairs/${encodeURIComponent(repairId)}/report?format=${format}`,
  );
  const objectUrl = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = `accesspath-repair-${repairId}.${extension(format)}`;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
}

function parseEventBlock(block: string): AccessPathEvent<Record<string, unknown>> | undefined {
  let data = "";
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("data:")) {
      data += line.slice(5).trimStart();
    }
  }
  if (data === "") {
    return undefined;
  }
  return AccessPathEventSchema.parse(JSON.parse(data)) as AccessPathEvent<
    Record<string, unknown>
  >;
}

async function readEventStream(
  response: Response,
  onEvent: (event: AccessPathEvent<Record<string, unknown>>) => void,
  signal: AbortSignal,
): Promise<void> {
  if (response.body === null) {
    throw new ApiError(502, "The event stream returned no response body.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  while (!signal.aborted) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    pending += decoder.decode(value, { stream: true });
    const blocks = pending.split(/\r?\n\r?\n/);
    pending = blocks.pop() ?? "";
    for (const block of blocks) {
      const event = parseEventBlock(block);
      if (event !== undefined) {
        onEvent(event);
      }
    }
  }
}

export async function streamSessionEvents(
  sessionId: string,
  lastEventId: string | undefined,
  onEvent: (event: AccessPathEvent<Record<string, unknown>>) => void,
  signal: AbortSignal,
): Promise<void> {
  const response = await request(
    `/api/sessions/${encodeURIComponent(sessionId)}/events`,
    {
      headers:
        lastEventId === undefined
          ? { accept: "text/event-stream" }
          : {
              accept: "text/event-stream",
              "last-event-id": lastEventId,
            },
      signal,
    },
  );
  await readEventStream(response, onEvent, signal);
}

export const streamAuditEvents = streamSessionEvents;
