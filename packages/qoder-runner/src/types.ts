import type {
  AccessPathEvent,
  ApprovalDecision,
  ApprovalRequest,
  EventType,
  RepairManifest,
  TaskContract,
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
export type QoderAgentMode = "planning" | RepairAgentMode;
export type QoderAuthStrategy = "auto" | "pat" | "qodercli";
export type QoderRequestedModel = "efficient" | "performance";

export interface RunnerEvent {
  type: EventType;
  payload: Record<string, unknown>;
  ephemeral?: boolean;
}

export interface QoderAdapterStartOptions {
  auth: AuthOptions;
  canUseTool: CanUseTool;
  cwd?: string;
  env: Record<string, string | undefined>;
  maxTurns: number;
  mode: QoderAgentMode;
  model: QoderRequestedModel;
  prompt: AsyncIterable<SDKUserMessage>;
  resume: boolean;
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

export interface QoderAdapterRecoveryOptions {
  cwd: string;
  sessionId: string;
  userMessageId: string;
}

export interface RecoveredRepairTurn {
  completedMessages: string[];
  qoderSessionId: string;
  result: string;
  resultSubtype: "success";
  stopReason: string | null;
  userMessageId: string;
}

export type QoderTurnRecovery =
  | {
      status: "completed";
      turn: RecoveredRepairTurn;
    }
  | {
      status: "incomplete" | "missing" | "superseded";
    };

export interface QoderAdapter {
  inspectPersistedTurn?(
    options: QoderAdapterRecoveryOptions,
  ): Promise<QoderTurnRecovery>;
  start(options: QoderAdapterStartOptions): QoderAdapterSession;
}

export interface RepairSessionOptions {
  adapter?: QoderAdapter;
  approvedPlan?: string;
  artifactRoot: string;
  authStrategy?: QoderAuthStrategy;
  emit?: (event: RunnerEvent) => Promise<void> | void;
  manifest: RepairManifest;
  maxTurns?: number;
  mode: RepairAgentMode;
  model?: QoderRequestedModel;
  continuation?: boolean;
  qoderSessionId?: string;
  recordApproval?: (request: ApprovalRequest) => Promise<void>;
  repairSessionId: string;
  resume?: boolean;
  requestApproval: (
    request: ApprovalRequest,
  ) => Promise<ApprovalDecision>;
  signal?: AbortSignal;
  userMessageId?: string;
  worktreePath: string;
}

export interface MissionPlanningOptions {
  adapter?: QoderAdapter;
  authStrategy?: QoderAuthStrategy;
  emit?: (event: RunnerEvent) => Promise<void> | void;
  maxTurns?: number;
  model?: QoderRequestedModel;
  objective: string;
  reconnaissance: Readonly<Record<string, unknown>>;
  signal?: AbortSignal;
}

export interface MissionPlanningResult {
  qoderSessionId: string;
  rawOutput: string;
  task: TaskContract;
  userMessageId: string;
}

export interface QoderModelUsageSnapshot {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  webSearchRequests: number;
  costUsd: number;
  contextWindow: number;
  maxOutputTokens: number;
}

export interface RepairTurnResult {
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  completedMessages: string[];
  durationApiMs: number;
  durationMs: number;
  inputTokens: number;
  modelUsage: QoderModelUsageSnapshot[];
  numTurns: number;
  outputTokens: number;
  qoderSessionId: string;
  result: string;
  resultSubtype: string;
  stopReason: string | null;
  totalCostUsd: number;
  userMessageId: string;
}

export interface RepairSessionHandle {
  readonly closed: Promise<void>;
  readonly turn: Promise<RepairTurnResult>;
  readonly userMessageId: string;
  close(): Promise<void>;
  interrupt(): Promise<void>;
  rewindFiles(options?: {
    dryRun?: boolean;
    userMessageId?: string;
  }): Promise<RewindFilesResult>;
}

export type QoderQuery = Query;
export type QoderSdkMessage = SDKMessage;
export type PersistedRunnerEvent = AccessPathEvent<Record<string, unknown>>;
