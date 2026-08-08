import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  createToolPolicy,
  matchesAllowedPath,
  matchesAllowedSearchRoot,
  resolveWorktreePath,
} from "../src/index";
import { repairManifest, temporaryWorkspace } from "./helpers";

describe("Qoder tool policy", () => {
  it("matches only paths inside approved globs", () => {
    expect(matchesAllowedPath("src/feature.ts", ["src/**"])).toBe(true);
    expect(matchesAllowedPath("src/nested/feature.ts", ["src/**"])).toBe(true);
    expect(matchesAllowedPath("package.json", ["src/**"])).toBe(false);
  });

  it("allows searches only for explicitly recursive directory scopes", () => {
    expect(matchesAllowedSearchRoot("src", ["src/**"])).toBe(true);
    expect(matchesAllowedSearchRoot("src", ["src/**/allowed.ts"])).toBe(false);
    expect(matchesAllowedSearchRoot("", ["*.ts"])).toBe(false);
  });

  it("rejects traversal and absolute paths outside the worktree", async () => {
    const workspace = await temporaryWorkspace();
    try {
      await expect(
        resolveWorktreePath(workspace.worktreePath, "../outside.txt"),
      ).rejects.toThrow(/escapes/i);
      await expect(
        resolveWorktreePath(
          workspace.worktreePath,
          join(workspace.root, "outside.txt"),
        ),
      ).rejects.toThrow(/escapes/i);
    } finally {
      await workspace.cleanup();
    }
  });

  it("pre-authorizes reads but keeps diagnosis edits read-only", async () => {
    const workspace = await temporaryWorkspace();
    try {
      const emit = vi.fn();
      const requestApproval = vi.fn();
      const policy = createToolPolicy({
        emit,
        manifest: repairManifest(),
        mode: "diagnosis",
        repairSessionId: "repair-001",
        requestApproval,
        worktreePath: workspace.worktreePath,
      });
      await expect(
        policy(
          "Read",
          { file_path: "src/feature.ts" },
          {
            signal: new AbortController().signal,
            toolUseID: "read-001",
          },
        ),
      ).resolves.toEqual({ behavior: "allow" });
      expect(emit).toHaveBeenNthCalledWith(1, {
        type: "tool.approved",
        payload: {
          toolName: "Read",
          risk: "read",
          targetPaths: ["src/feature.ts"],
          toolUseId: "read-001",
        },
      });
      expect(emit).toHaveBeenNthCalledWith(2, {
        type: "tool.started",
        payload: {
          toolName: "Read",
          risk: "read",
          targetPaths: ["src/feature.ts"],
          toolUseId: "read-001",
        },
      });
      await expect(
        policy(
          "Read",
          { file_path: "package.json" },
          {
            signal: new AbortController().signal,
            toolUseID: "read-002",
          },
        ),
      ).resolves.toMatchObject({ behavior: "deny" });
      const fileScopedPolicy = createToolPolicy({
        emit,
        manifest: repairManifest(["src/feature.ts"]),
        mode: "diagnosis",
        repairSessionId: "repair-001",
        requestApproval,
        worktreePath: workspace.worktreePath,
      });
      await expect(
        fileScopedPolicy(
          "Glob",
          { path: "src", pattern: "**/*.ts" },
          {
            signal: new AbortController().signal,
            toolUseID: "glob-file-scope",
          },
        ),
      ).resolves.toMatchObject({ behavior: "deny" });
      await expect(
        policy(
          "Grep",
          { path: "." },
          {
            signal: new AbortController().signal,
            toolUseID: "grep-001",
          },
        ),
      ).resolves.toMatchObject({ behavior: "deny" });
      await expect(
        policy(
          "Edit",
          { file_path: "src/feature.ts" },
          {
            signal: new AbortController().signal,
            toolUseID: "edit-001",
          },
        ),
      ).resolves.toMatchObject({ behavior: "deny" });
      expect(requestApproval).not.toHaveBeenCalled();
    } finally {
      await workspace.cleanup();
    }
  });

  it("brokers an in-scope edit and denies widening the path", async () => {
    const workspace = await temporaryWorkspace();
    try {
      const requestApproval = vi.fn(async () => ({
        decision: "approve-once" as const,
      }));
      const policy = createToolPolicy({
        emit: async () => undefined,
        manifest: repairManifest(),
        mode: "repair",
        repairSessionId: "repair-001",
        requestApproval,
        worktreePath: workspace.worktreePath,
      });
      await expect(
        policy(
          "Edit",
          { file_path: "src/feature.ts" },
          {
            signal: new AbortController().signal,
            toolUseID: "edit-001",
          },
        ),
      ).resolves.toMatchObject({
        behavior: "allow",
        toolUseID: "edit-001",
      });
      await expect(
        policy(
          "Edit",
          { file_path: "package.json" },
          {
            signal: new AbortController().signal,
            toolUseID: "edit-002",
          },
        ),
      ).resolves.toMatchObject({ behavior: "deny" });
      expect(requestApproval).toHaveBeenCalledTimes(1);
    } finally {
      await workspace.cleanup();
    }
  });

  it("always denies shell, network, and unknown tools", async () => {
    const workspace = await temporaryWorkspace();
    try {
      const policy = createToolPolicy({
        emit: async () => undefined,
        manifest: repairManifest(),
        mode: "repair",
        repairSessionId: "repair-001",
        requestApproval: async () => ({ decision: "approve-session" }),
        worktreePath: workspace.worktreePath,
      });
      for (const toolName of ["Bash", "WebFetch", "Agent"]) {
        await expect(
          policy(
            toolName,
            {},
            {
              signal: new AbortController().signal,
              toolUseID: `tool-${toolName}`,
            },
          ),
        ).resolves.toMatchObject({ behavior: "deny" });
      }
    } finally {
      await workspace.cleanup();
    }
  });

  it("reuses approve-session for repeated writes to the same file", async () => {
    const workspace = await temporaryWorkspace();
    try {
      const requestApproval = vi.fn(async () => ({
        decision: "approve-session" as const,
      }));
      const policy = createToolPolicy({
        emit: async () => undefined,
        manifest: repairManifest(),
        mode: "repair",
        repairSessionId: "repair-001",
        requestApproval,
        worktreePath: workspace.worktreePath,
      });
      for (const toolUseID of ["edit-001", "edit-002"]) {
        await expect(
          policy(
            "Edit",
            { file_path: "src/feature.ts" },
            {
              signal: new AbortController().signal,
              toolUseID,
            },
          ),
        ).resolves.toMatchObject({ behavior: "allow", toolUseID });
      }
      expect(requestApproval).toHaveBeenCalledTimes(1);
    } finally {
      await workspace.cleanup();
    }
  });
});
