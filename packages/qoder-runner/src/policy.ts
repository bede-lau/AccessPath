import { randomUUID } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import {
  ApprovalRequestSchema,
  type ApprovalDecision,
  type ApprovalRequest,
  type RepairManifest,
} from "@accesspath/contracts";
import type {
  CanUseTool,
  PermissionResult,
} from "@qoder-ai/qoder-agent-sdk";

import type { RepairAgentMode, RunnerEvent } from "./types";

function portable(path: string): string {
  return path.replaceAll("\\", "/");
}

function isWithin(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return (
    fromRoot === "" ||
    (fromRoot !== ".." &&
      !fromRoot.startsWith(`..${sep}`) &&
      !isAbsolute(fromRoot))
  );
}

function globExpression(pattern: string): RegExp {
  const escaped = portable(pattern)
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("**", "\u0000")
    .replaceAll("*", "[^/]*")
    .replaceAll("\u0000", ".*");
  return new RegExp(`^${escaped}$`);
}

export function matchesAllowedPath(
  relativePath: string,
  allowedGlobs: readonly string[],
): boolean {
  const normalized = portable(relativePath);
  return allowedGlobs.some((pattern) =>
    globExpression(pattern).test(normalized),
  );
}

async function assertNoLinkedSegments(
  canonicalRoot: string,
  candidate: string,
): Promise<void> {
  const fromRoot = relative(canonicalRoot, candidate);
  let current = canonicalRoot;
  for (const segment of fromRoot.split(/[\\/]/).filter(Boolean)) {
    current = resolve(current, segment);
    try {
      const details = await lstat(current);
      if (details.isSymbolicLink()) {
        throw new Error("Symlinked or junction paths are not permitted.");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      throw error;
    }
  }
}

export async function resolveWorktreePath(
  worktreePath: string,
  requestedPath: string,
): Promise<{ absolutePath: string; relativePath: string }> {
  const canonicalRoot = await realpath(worktreePath);
  const candidate = isAbsolute(requestedPath)
    ? resolve(requestedPath)
    : resolve(canonicalRoot, requestedPath);
  if (!isWithin(canonicalRoot, candidate)) {
    throw new Error("The requested path escapes the repair worktree.");
  }
  await assertNoLinkedSegments(canonicalRoot, candidate);
  return {
    absolutePath: candidate,
    relativePath: portable(relative(canonicalRoot, candidate)),
  };
}

function requestedPath(
  toolName: string,
  input: Record<string, unknown>,
): string | undefined {
  if (toolName === "Read" || toolName === "Edit" || toolName === "Write") {
    return typeof input.file_path === "string" ? input.file_path : undefined;
  }
  if (toolName === "Glob" || toolName === "Grep") {
    return typeof input.path === "string" ? input.path : ".";
  }
  return undefined;
}

function denial(message: string): PermissionResult {
  return {
    behavior: "deny",
    message,
  };
}

export interface ToolPolicyOptions {
  emit: (event: RunnerEvent) => Promise<void>;
  manifest: RepairManifest;
  mode: RepairAgentMode;
  recordApproval?: (request: ApprovalRequest) => Promise<void>;
  repairSessionId: string;
  requestApproval: (
    request: ApprovalRequest,
  ) => Promise<ApprovalDecision>;
  worktreePath: string;
}

export function createToolPolicy(options: ToolPolicyOptions): CanUseTool {
  return async (toolName, input, toolOptions) => {
    const path = requestedPath(toolName, input);
    let targetPath: string | undefined;
    if (path !== undefined) {
      try {
        targetPath = (
          await resolveWorktreePath(options.worktreePath, path)
        ).relativePath;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Path validation failed.";
        await options.emit({
          type: "tool.denied",
          payload: { toolName, reason: message },
        });
        return denial(message);
      }
    }

    if (toolName === "Read" || toolName === "Glob" || toolName === "Grep") {
      await options.emit({
        type: "tool.approved",
        payload: {
          toolName,
          risk: "read",
          targetPaths: targetPath === undefined ? [] : [targetPath],
        },
      });
      return { behavior: "allow" };
    }

    if (toolName !== "Edit" && toolName !== "Write") {
      const message = `${toolName} is not available in the AccessPath repair policy.`;
      await options.emit({
        type: "tool.denied",
        payload: { toolName, reason: message },
      });
      return denial(message);
    }

    if (options.mode !== "repair") {
      const message = "Diagnosis is read-only.";
      await options.emit({
        type: "tool.denied",
        payload: { toolName, reason: message },
      });
      return denial(message);
    }

    if (
      targetPath === undefined ||
      !matchesAllowedPath(targetPath, options.manifest.allowedPathGlobs)
    ) {
      const message = "The requested edit is outside the approved source scope.";
      await options.emit({
        type: "tool.denied",
        payload: {
          toolName,
          reason: message,
          targetPaths: targetPath === undefined ? [] : [targetPath],
        },
      });
      return denial(message);
    }

    const request = ApprovalRequestSchema.parse({
      id: `approval-${randomUUID()}`,
      repairSessionId: options.repairSessionId,
      kind: "tool",
      title: `${toolName} ${targetPath}`,
      consequence: `Allows one Qoder ${toolName.toLowerCase()} operation on ${targetPath}.`,
      risk: "write",
      targetPaths: [targetPath],
      createdAt: new Date().toISOString(),
      state: "pending",
    });
    await options.recordApproval?.(request);
    await options.emit({
      type: "tool.requested",
      payload: {
        approvalId: request.id,
        toolName,
        targetPaths: request.targetPaths,
        toolUseId: toolOptions.toolUseID,
      },
    });
    const decision = await options.requestApproval(request);
    if (decision.decision === "deny") {
      await options.emit({
        type: "tool.denied",
        payload: {
          approvalId: request.id,
          toolName,
          reason: decision.reason ?? "The edit was denied.",
          targetPaths: request.targetPaths,
        },
      });
      return denial(decision.reason ?? "The edit was denied.");
    }
    await options.emit({
      type: "tool.approved",
      payload: {
        approvalId: request.id,
        decision: decision.decision,
        toolName,
        targetPaths: request.targetPaths,
      },
    });
    await options.emit({
      type: "tool.started",
      payload: {
        approvalId: request.id,
        toolName,
        targetPaths: request.targetPaths,
        toolUseId: toolOptions.toolUseID,
      },
    });
    return {
      behavior: "allow",
      toolUseID: toolOptions.toolUseID,
    };
  };
}
