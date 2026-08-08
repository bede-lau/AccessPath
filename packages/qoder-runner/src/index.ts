export const PACKAGE_NAME = "@accesspath/qoder-runner" as const;

export {
  isQoderAuthenticationMessage,
  normalizeQoderError,
  QoderAuthenticationError,
  OpenAiAuthenticationError,
  QwenAuthenticationError,
} from "./errors";
export {
  OpenAiCodeAdapter,
  openAiToolDefinitions,
  resolveOpenAiConfiguration,
  type OpenAiCodeAdapterOptions,
  type OpenAiConfiguration,
} from "./openai-adapter";
export {
  DeterministicMockQoderAdapter,
  type DeterministicMockEdit,
  type DeterministicMockQoderOptions,
  type DeterministicMockWrite,
} from "./mock-adapter";
export {
  createToolPolicy,
  matchesAllowedPath,
  matchesAllowedSearchRoot,
  resolveWorktreePath,
  type ToolPolicyOptions,
} from "./policy";
export {
  diagnosisContinuationPrompt,
  diagnosisPrompt,
  planningPrompt,
  repairContinuationPrompt,
  repairPrompt,
} from "./prompts";
export {
  inspectPersistedMessages,
  OfficialQoderAdapter,
  qoderChildEnvironment,
  qoderRuntimeProfile,
  resolveQoderAuth,
} from "./sdk-adapter";
export {
  createAgentAdapter,
  resolveAgentProvider,
  type AgentAdapterOptions,
  type AgentProvider,
} from "./provider";
export {
  QwenCodeAdapter,
  qwenRuntimeProfile,
  qwenRuntimeSettings,
  resolveQwenConfiguration,
  type QwenCodeAdapterOptions,
  type QwenConfiguration,
} from "./qwen-adapter";
export {
  compileTaskContract,
  parsePlannedTaskContract,
  planTaskContract,
  qoderTurnPolicy,
  redactRunnerText,
  startRepairSession,
} from "./runner";
export type {
  PersistedRunnerEvent,
  MissionPlanningOptions,
  MissionPlanningResult,
  QoderAdapter,
  QoderAdapterRecoveryOptions,
  QoderAdapterSession,
  QoderAdapterStartOptions,
  QoderAuthStrategy,
  QoderModelUsageSnapshot,
  QoderRequestedModel,
  QoderAgentMode,
  QoderQuery,
  QoderSdkMessage,
  QoderTurnRecovery,
  RepairAgentMode,
  RecoveredRepairTurn,
  RepairSessionHandle,
  RepairSessionOptions,
  RepairTurnResult,
  RunnerEvent,
} from "./types";
