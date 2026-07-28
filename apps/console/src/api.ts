import {
  AccessPathEventSchema,
  AuditBundleSchema,
  AuditSessionSchema,
  ErrorResponseSchema,
  TaskContractSchema,
  type AccessPathEvent,
  type AuditBundle,
  type AuditSession,
  type TaskContract,
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
  targetPolicies: Array<"public" | "local-explicit">;
  reportFormats: Array<"html" | "markdown" | "json">;
  demoAidAppPort: number;
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

export async function streamAuditEvents(
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
