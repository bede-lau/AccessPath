// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type {
  ApprovalRequest,
  RepairManifest,
  RepairSession,
} from "@accesspath/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RepairWorkspace } from "../src/RepairWorkspace";
import { reviewedTask } from "./fixtures";

const api = vi.hoisted(() => ({
  getRepair: vi.fn(),
  getRepairDiff: vi.fn(),
  prepareRepair: vi.fn(),
  diagnoseRepair: vi.fn(),
  startRepair: vi.fn(),
  pauseRepair: vi.fn(),
  resumeRepair: vi.fn(),
  cancelRepair: vi.fn(),
  verifyRepair: vi.fn(),
  decideRepairApproval: vi.fn(),
  previewRepairRewind: vi.fn(),
  applyRepairRewind: vi.fn(),
  downloadRepairReport: vi.fn(),
  streamSessionEvents: vi.fn(),
}));

vi.mock("../src/api", () => ({
  ApiError: class ApiError extends Error {
    constructor(
      public readonly status: number,
      message: string,
    ) {
      super(message);
    }
  },
  ...api,
}));

const repair: RepairSession = {
  schemaVersion: "1.0.0",
  id: "repair-p06",
  state: "editing",
  auditBundleId: "bundle-p05",
  manifestId: "manifest-ap-001",
  createdAt: "2026-07-28T10:00:00.000Z",
  updatedAt: "2026-07-28T10:01:00.000Z",
  repository: {
    repositoryDisplayName: "accesspath-disposable",
    baseBranch: "main",
    baseCommit: "a".repeat(40),
    startCommand: {
      id: "preview",
      label: "Preview",
      executable: "npm",
      args: ["run", "dev"],
      cwdRelative: ".",
      timeoutMs: 10_000,
      category: "start",
    },
    testCommands: [
      {
        id: "verify-ap-001",
        label: "Verify AP-001",
        executable: "npm",
        args: ["test"],
        cwdRelative: ".",
        timeoutMs: 10_000,
        category: "test",
      },
    ],
    previewUrl: "http://127.0.0.1:4174/",
    allowedPathGlobs: ["src/**", "tests/**"],
  },
  branch: "accesspath/repair-p06",
  worktreeId: "repair-p06",
  qoderSessionId: "qoder-p06",
  latestCheckpointId: "checkpoint-p06",
};

const manifest: RepairManifest = {
  schemaVersion: "1.0.0",
  id: "manifest-ap-001",
  auditBundleId: "bundle-p05",
  findingIds: ["AP-001"],
  affectedActions: ["Choose eligibility with a keyboard"],
  observations: ["Space did not activate the custom eligibility option."],
  evidenceRefs: [],
  constraints: ["Keep AP-002 through AP-005 intentionally present."],
  nonGoals: ["Do not modify the base checkout."],
  allowedPathGlobs: ["src/**", "tests/**"],
  verification: {
    taskContract: reviewedTask,
    commands: repair.repository.testCommands,
  },
};

const diff = {
  baseCommit: repair.repository.baseCommit,
  changedFiles: ["src/eligibility.ts", "tests/eligibility.test.ts"],
  stat: " 2 files changed, 8 insertions(+), 2 deletions(-)",
  patch: [
    "diff --git a/src/eligibility.ts b/src/eligibility.ts",
    "--- a/src/eligibility.ts",
    "+++ b/src/eligibility.ts",
    "@@ -1 +1 @@",
    "-const role = 'none';",
    "+const role = 'radio';",
    "diff --git a/tests/eligibility.test.ts b/tests/eligibility.test.ts",
    "--- a/tests/eligibility.test.ts",
    "+++ b/tests/eligibility.test.ts",
    "@@ -1 +1 @@",
    "-expect(false);",
    "+expect(true);",
    "",
  ].join("\n"),
};

function approval(kind: ApprovalRequest["kind"]): ApprovalRequest {
  return {
    id: `approval-${kind}`,
    repairSessionId: repair.id,
    kind,
    title:
      kind === "rewind"
        ? "Rewind repair files"
        : "Edit src/eligibility.ts",
    consequence:
      kind === "rewind"
        ? "Restores checkpointed files only."
        : "Allows one edit to src/eligibility.ts.",
    risk: kind === "rewind" ? "destructive" : "write",
    targetPaths: ["src/eligibility.ts"],
    createdAt: "2026-07-28T10:02:00.000Z",
    state: "pending",
  };
}

function resource(pending?: ApprovalRequest) {
  return {
    repair,
    manifest,
    plan: {
      text: "Use the native radio pattern and add a keyboard regression test.",
      qoderSessionId: "qoder-p06",
    },
    approvals: pending === undefined ? [] : [{ request: pending }],
    tests: [
      {
        commandId: "verify-ap-001",
        state: "passed" as const,
        exitCode: 0,
        durationMs: 84,
        outputArtifactId: "test-output-verify-ap-001",
      },
    ],
    baseIntegrity: { unchanged: true },
  };
}

describe("P06 repair workspace", () => {
  beforeEach(() => {
    api.getRepair.mockResolvedValue(resource());
    api.getRepairDiff.mockResolvedValue(diff);
    api.streamSessionEvents.mockImplementation(
      () => new Promise<void>(() => undefined),
    );
    api.decideRepairApproval.mockResolvedValue({
      request: { ...approval("tool"), state: "approved" },
      decision: { decision: "approve-once" },
      decidedAt: "2026-07-28T10:03:00.000Z",
    });
    api.previewRepairRewind.mockResolvedValue({
      approval: approval("rewind"),
      preview: {
        checkpointId: "checkpoint-p06",
        affectedFiles: ["src/eligibility.ts"],
        insertionsRemoved: 4,
        deletionsRestored: 1,
        staleVerificationIds: ["verification-verify-ap-001"],
        nonFileSideEffectWarning:
          "Rewind restores checkpointed files only; command side effects are not reversed.",
      },
    });
    api.applyRepairRewind.mockResolvedValue({
      ...diff,
      patch: "",
      stat: "",
      changedFiles: [],
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders evidence, semantic diff, verification, timeline, and base integrity without private paths", async () => {
    const { container } = render(
      <RepairWorkspace repairId={repair.id} onRepairChange={vi.fn()} />,
    );

    await screen.findByRole("heading", { name: "Repair workspace" });
    expect(screen.getByText("AP-001")).toBeDefined();
    expect(screen.getByText("src/eligibility.ts")).toBeDefined();
    expect(screen.getByText("passed")).toBeDefined();
    expect(screen.getByText("Base unchanged")).toBeDefined();
    expect(container.textContent).not.toContain("C:\\Users\\");
    expect(container.textContent).not.toContain(".accesspath");
  });

  it("moves focus to an exact-scope approval and approves only once", async () => {
    api.getRepair.mockResolvedValue(resource(approval("tool")));
    render(<RepairWorkspace repairId={repair.id} onRepairChange={vi.fn()} />);

    const heading = await screen.findByRole("heading", {
      name: "Edit src/eligibility.ts",
    });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(screen.getByText("Allows one edit to src/eligibility.ts.")).toBeDefined();
    expect(screen.getAllByText("src/eligibility.ts").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Approve once" }));
    await waitFor(() =>
      expect(api.decideRepairApproval).toHaveBeenCalledWith(
        repair.id,
        "approval-tool",
        { decision: "approve-once" },
      ),
    );
  });

  it("previews rewind consequences before approval and applies the approved rewind", async () => {
    let current = resource();
    api.getRepair.mockImplementation(async () => current);
    render(<RepairWorkspace repairId={repair.id} onRepairChange={vi.fn()} />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Preview rewind" }),
    );
    await waitFor(() => expect(api.previewRepairRewind).toHaveBeenCalled());
    current = resource(approval("rewind"));
    api.getRepair.mockResolvedValue(current);
    api.previewRepairRewind.mockResolvedValueOnce({
      approval: approval("rewind"),
      preview: {
        checkpointId: "checkpoint-p06",
        affectedFiles: ["src/eligibility.ts"],
        insertionsRemoved: 4,
        deletionsRestored: 1,
        staleVerificationIds: ["verification-verify-ap-001"],
        nonFileSideEffectWarning:
          "Rewind restores checkpointed files only; command side effects are not reversed.",
      },
    });
    await api.getRepair();

    cleanup();
    render(<RepairWorkspace repairId={repair.id} onRepairChange={vi.fn()} />);
    const button = await screen.findByRole("button", {
      name: "Approve and rewind",
    });
    fireEvent.click(button);

    await waitFor(() =>
      expect(api.applyRepairRewind).toHaveBeenCalledWith(
        repair.id,
        "approval-rewind",
      ),
    );
  });
});
