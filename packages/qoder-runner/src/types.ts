import type {
  AccessPathEvent,
  ApprovalDecision,
  ApprovalRequest,
  EventType,
  RepairManifest,
} from "@accesspath/contracts";
import type {
  AuthOptions,
  CanUseTool,
  Query,
  RewindFilesResult,
  SDKMessage,
  SDKUserMessage,
} from "@qoder-ai/qoder-agent-sdk";

export type RepairAgentMode = "diagnosis" | "repair";
export type QoderAuthStrategy = "auto" | "pat" | "qodercli";

export interface RunnerEvent {
  type: EventType;
  payload: Record<string, unknown>;
  ephemeral?: boolean;
}

export interface QoderAdapterStartOptions {
  auth: AuthOptions;
  canUseTool: CanUseTool;
  cwd: string;
  env: Record<string, string | undefined>;
  mode: RepairAgentMode;
  prompt: AsyncIterable<SDKUserMessage>;
  sessionId: string;
  signal?: AbortSignal;
}

export interface QoderAdapterSession extends AsyncIterable<SDKMessage> {
  close(): Promise<void>;
  interrupt(): Promise<unknown>;
  rewindFiles(
    userMessageId: string,
    options?: { dryRun?: boolean },
  ): Promise<RewindFilesResult>;
}

export interface QoderAdapter {
  start(options: QoderAdapterStartOptions): QoderAdapterSession;
}

export interface RepairSessionOptions {
  adapter?: QoderAdapter;
  approvedPlan?: string;
  artifactRoot: string;
  authStrategy?: QoderAuthStrategy;
  emit?: (event: RunnerEvent) => Promise<void> | void;
  manifest: RepairManifest;
  mode: RepairAgentMode;
  qoderSessionId?: string;
  recordApproval?: (request: ApprovalRequest) => Promise<void>;
  repairSessionId: string;
  requestApproval: (
    request: ApprovalRequest,
  ) => Promise<ApprovalDecision>;
  signal?: AbortSignal;
  worktreePath: string;
}

export interface RepairTurnResult {
  completedMessages: string[];
  qoderSessionId: string;
  result: string;
  resultSubtype: string;
  userMessageId: string;
}

export interface RepairSessionHandle {
  readonly closed: Promise<void>;
  readonly turn: Promise<RepairTurnResult>;
  close(): Promise<void>;
  interrupt(): Promise<void>;
  rewindFiles(options?: {
    dryRun?: boolean;
  }): Promise<RewindFilesResult>;
}

export type QoderQuery = Query;
export type QoderSdkMessage = SDKMessage;
export type PersistedRunnerEvent = AccessPathEvent<Record<string, unknown>>;
