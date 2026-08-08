import { createInterface } from "node:readline";

import type {
  PermissionResult,
  SDKUserMessage,
} from "@qoder-ai/qoder-agent-sdk";

import { DirectQwenCodeAdapter } from "./qwen-adapter";
import type {
  QoderAdapterSession,
  QoderAdapterStartOptions,
} from "./types";

type WorkerStart = {
  options: Omit<QoderAdapterStartOptions, "auth" | "canUseTool" | "prompt" | "signal">;
  prompt: SDKUserMessage[];
  type: "start";
};

type WorkerRequest =
  | WorkerStart
  | { decision: PermissionResult; requestId: string; type: "authorization" }
  | { type: "close" }
  | { type: "interrupt" }
  | {
      dryRun: boolean;
      requestId: string;
      type: "rewind";
      userMessageId: string;
    };

let session: QoderAdapterSession | undefined;
let rewindSession: QoderAdapterSession | undefined;
const approvals = new Map<
  string,
  {
    reject: (error: Error) => void;
    resolve: (value: PermissionResult) => void;
  }
>();

function send(value: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function authorization(
  toolName: string,
  input: Record<string, unknown>,
  toolUseID: string,
): Promise<PermissionResult> {
  return new Promise<PermissionResult>((resolve, reject) => {
    approvals.set(toolUseID, { reject, resolve });
    send({
      input,
      requestId: toolUseID,
      toolName,
      type: "authorize",
    });
  });
}

async function run(start: WorkerStart): Promise<void> {
  const prompt = async function* (): AsyncIterable<SDKUserMessage> {
    yield* start.prompt;
  };
  const adapter = new DirectQwenCodeAdapter({
    environment: process.env,
    recoveryRoot: process.env.ACCESSPATH_QWEN_RECOVERY_ROOT,
  });
  session = adapter.start({
    ...start.options,
    auth: {} as never,
    canUseTool: async (toolName, input, options) =>
      authorization(toolName, input, options.toolUseID),
    prompt: prompt(),
    signal: undefined,
  });
  try {
    for await (const message of session) {
      send({ message, type: "message" });
    }
    send({ type: "closed" });
  } catch (error) {
    send({
      message: error instanceof Error ? error.message : "Qwen worker failed.",
      type: "error",
    });
  } finally {
    rewindSession = session;
    await session.close().catch(() => undefined);
    session = undefined;
  }
}

const reader = createInterface({
  input: process.stdin,
  crlfDelay: Number.POSITIVE_INFINITY,
});

reader.on("line", (line) => {
  let request: WorkerRequest;
  try {
    request = JSON.parse(line) as WorkerRequest;
  } catch {
    send({ message: "Invalid Qwen worker request.", type: "error" });
    return;
  }
  if (request.type === "start") {
    void run(request);
    return;
  }
  if (request.type === "authorization") {
    const pending = approvals.get(request.requestId);
    if (pending !== undefined) {
      approvals.delete(request.requestId);
      pending.resolve(request.decision);
    }
    return;
  }
  if (request.type === "interrupt") {
    void session?.interrupt();
    return;
  }
  if (request.type === "close") {
    void (session?.close() ?? rewindSession?.close() ?? Promise.resolve()).finally(
      () => process.exit(0),
    );
    return;
  }
  void (session ?? rewindSession)
    ?.rewindFiles(request.userMessageId, { dryRun: request.dryRun })
    .then((value) => send({ requestId: request.requestId, type: "rewind-result", value }))
    .catch((error) =>
      send({
        message: error instanceof Error ? error.message : "Qwen rewind failed.",
        type: "error",
      }),
    );
});
