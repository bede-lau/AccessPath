import {
  AccessPathEventSchema,
  ApprovalDecisionSchema,
  ApprovalRequestSchema,
  AuditBundleSchema,
  AuditSessionSchema,
  ErrorResponseSchema,
  RepairManifestSchema,
  RepairSessionSchema,
  RewindPreviewSchema,
  TaskContractSchema,
  TestResultSchema,
  type AccessPathEvent,
  type ApprovalDecision,
  type ApprovalRequest,
  type AuditBundle,
  type AuditSession,
  type RepairManifest,
  type RepairSession,
  type RewindPreview,
  type TaskContract,
  type TestResult,
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
  baseIntegrity: { unchanged: boolean };
};

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

async function repairRequest(
  repairId: string,
  action: "prepare" | "diagnose" | "start" | "pause" | "resume" | "cancel" | "verify",
): Promise<RepairSession> {
  const response = await request(
    `/api/repairs/${encodeURIComponent(repairId)}/${action}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    },
  );
  return unwrapRepair(await response.json());
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
    baseIntegrity: { unchanged: baseIntegrity.unchanged },
  };
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
  format: "markdown" | "json",
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

export const streamAuditEvents = streamSessionEvents;
