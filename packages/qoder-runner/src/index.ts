export const PACKAGE_NAME = "@accesspath/qoder-runner" as const;

export {
  DeterministicMockQoderAdapter,
  type DeterministicMockEdit,
  type DeterministicMockQoderOptions,
  type DeterministicMockWrite,
} from "./mock-adapter";
export {
  createToolPolicy,
  matchesAllowedPath,
  resolveWorktreePath,
  type ToolPolicyOptions,
} from "./policy";
export { diagnosisPrompt, repairPrompt } from "./prompts";
export {
  OfficialQoderAdapter,
  qoderChildEnvironment,
  resolveQoderAuth,
} from "./sdk-adapter";
export { redactRunnerText, startRepairSession } from "./runner";
export type {
  PersistedRunnerEvent,
  QoderAdapter,
  QoderAdapterSession,
  QoderAdapterStartOptions,
  QoderAuthStrategy,
  QoderQuery,
  QoderSdkMessage,
  RepairAgentMode,
  RepairSessionHandle,
  RepairSessionOptions,
  RepairTurnResult,
  RunnerEvent,
} from "./types";
