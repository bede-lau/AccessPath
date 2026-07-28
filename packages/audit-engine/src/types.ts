import type {
  AccessPathEvent,
  ArtifactRef,
  AuditBundle,
  Finding,
  TaskContract,
  TaskStepResult,
} from "@accesspath/contracts";
import type { BrowserType, Page } from "playwright";

export const PACKAGE_NAME = "@accesspath/audit-engine" as const;

export type DnsResolver = (
  hostname: string,
) => Promise<Array<{ address: string; family: 4 | 6 }>>;

export type TargetValidation = {
  url: URL;
  addresses: string[];
};

export type ArtifactCapture = {
  id: string;
  kind: ArtifactRef["kind"];
  mimeType: string;
  extension: string;
  sensitivity: ArtifactRef["sensitivity"];
  description: string;
  data: Uint8Array;
};

export type ArtifactCaptureCallback = (
  capture: ArtifactCapture,
) => Promise<ArtifactRef> | ArtifactRef;

export type AuditEngineEvent = AccessPathEvent<Record<string, unknown>>;

export type AxeResult = {
  testEngine?: { version?: string };
  violations: Array<{
    id: string;
    impact?: string | null;
    description?: string;
    help?: string;
    helpUrl?: string;
    tags?: string[];
    nodes: Array<{
      impact?: string | null;
      target: string[];
      html?: string;
      failureSummary?: string;
    }>;
  }>;
};

export type AxeRunner = (page: Page) => Promise<AxeResult>;

export type Clock = {
  now(): Date;
};

export type IdFactory = {
  next(prefix: string): string;
};

export type AuditFailureDiagnostic = {
  code:
    | "INVALID_TARGET"
    | "TARGET_POLICY_DENIED"
    | "TIMEOUT"
    | "CANCELLED"
    | "NAVIGATION_FAILED"
    | "TASK_BLOCKED"
    | "INTERNAL";
  message: string;
  stepId?: string;
};

export type AuditRunResult = {
  bundle: AuditBundle;
  diagnostic?: AuditFailureDiagnostic;
};

export type AuditEngineOptions = {
  auditSessionId?: string;
  signal?: AbortSignal;
  dnsResolver?: DnsResolver;
  chromium?: BrowserType;
  axeRunner?: AxeRunner;
  captureArtifact?: ArtifactCaptureCallback;
  onEvent?: (event: AuditEngineEvent) => Promise<void> | void;
  clock?: Clock;
  idFactory?: IdFactory;
  maxRedirects?: number;
  maxResponseBytes?: number;
  navigationTimeoutMs?: number;
  testAssist?: {
    ap001?: boolean;
  };
};

export type BrowserObservation = {
  stepId: string;
  url: string;
  assisted: boolean;
  focus?: string;
  actionOutcome: string;
  axe: AxeResult;
  consoleMessages: string[];
  failedRequests: string[];
  checks: Record<string, boolean | string | number | null>;
  evidenceIds: string[];
};

export type FindingInput = {
  task: TaskContract;
  steps: TaskStepResult[];
  observations: BrowserObservation[];
  axeFindings: Finding[];
};
