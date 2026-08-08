import { describe, expect, it } from "vitest";

import {
  DeploymentBindingSchema,
  ExecutionModeSchema,
  MissionDraftSchema,
  MissionIssueSchema,
  MissionSessionSchema,
  MissionSessionStateSchema,
  MissionSnapshotSchema,
  RepairAuthorizationGrantSchema,
  SourceSpecSchema,
} from "../src/index";
import { taskContractFixture } from "./fixtures";

const localSource = {
  kind: "local" as const,
  repositoryPath: "C:\\work\\project",
};

const sourceSnapshot = {
  schemaVersion: "1.0.0" as const,
  id: "source-1",
  source: localSource,
  acquiredAt: "2026-07-30T10:00:00.000Z",
  repositoryDisplayName: "project",
  sourceCommit: "a".repeat(40),
  snapshotCommit: "b".repeat(40),
  treeHash: "c".repeat(40),
  contentManifestHash: "d".repeat(64),
  dirty: true,
  fileCount: 2,
  payloadBytes: 128,
};

const draft = {
  schemaVersion: "1.0.0" as const,
  id: "mission-1",
  title: "Repair the application flow",
  objective: "Identify and repair the observed accessibility barrier.",
  stagingUrl: "https://staging.example.test/application",
  source: localSource,
  executionMode: "repair" as const,
  steps: [
    {
      id: "plan-1",
      title: "Reproduce the task",
      task: taskContractFixture,
      dependsOn: [],
      mode: "assessment" as const,
    },
  ],
  constraints: ["Do not mutate the source checkout."],
};

describe("mission contracts", () => {
  it("defines the supported execution modes", () => {
    expect(ExecutionModeSchema.options).toEqual([
      "assessment",
      "repair",
      "verify",
    ]);
  });

  it("shares the complete runtime mission state machine", () => {
    expect(MissionSessionStateSchema.options).toEqual([
      "draft",
      "compiling",
      "ready",
      "running-audit",
      "awaiting-repair-authorization",
      "binding-source",
      "repairing",
      "verifying",
      "awaiting-patch-acceptance",
      "attention",
      "report-only",
      "completed",
      "failed",
      "cancelled",
    ]);
  });

  it("accepts local and credential-free pinned public sources", () => {
    expect(SourceSpecSchema.parse(localSource)).toEqual(localSource);
    expect(
      SourceSpecSchema.parse({
        kind: "public",
        repositoryUrl: "https://example.test/project.git",
        commit: "a".repeat(40),
      }),
    ).toBeTruthy();
    expect(() =>
      SourceSpecSchema.parse({
        kind: "public",
        repositoryUrl: "https://token@example.test/project.git",
        commit: "a".repeat(40),
      }),
    ).toThrow();
    expect(() =>
      SourceSpecSchema.parse({
        kind: "public",
        repositoryUrl: "http://example.test/project.git",
        commit: "a".repeat(40),
      }),
    ).toThrow();
    expect(() =>
      SourceSpecSchema.parse({
        kind: "public",
        repositoryUrl: "https://example.test/project.git?token=secret",
        commit: "a".repeat(40),
      }),
    ).toThrow();
  });

  it("nests an existing TaskContract in an executable step plan", () => {
    expect(MissionDraftSchema.parse(draft)).toEqual(draft);
    expect(() =>
      MissionDraftSchema.parse({
        ...draft,
        steps: [{ ...draft.steps[0], task: { id: "incomplete" } }],
      }),
    ).toThrow();
  });

  it("models exact, reproduced, and unverified deployments", () => {
    for (const binding of [
      {
        state: "exact",
        deploymentUrl: "https://example.test",
        sourceCommit: "a".repeat(40),
      },
      {
        state: "reproduced",
        deploymentUrl: "https://example.test",
        sourceCommit: "a".repeat(40),
        reproductionUrl: "http://127.0.0.1:4173",
      },
      {
        state: "unverified",
        deploymentUrl: "https://example.test",
        reason: "No deployment provenance was available.",
      },
    ]) {
      expect(DeploymentBindingSchema.parse(binding)).toEqual(binding);
    }
  });

  it("distinguishes task, assertion, accessibility, console, and network issues", () => {
    for (const source of [
      "task",
      "assertion",
      "accessibility",
      "console",
      "network",
    ]) {
      expect(
        MissionIssueSchema.parse({
          id: `issue-${source}`,
          title: `${source} issue`,
          severity: "serious",
          source,
          summary: "The mission observed a bounded issue.",
          affectedPaths: [],
          evidenceIds: [],
          state: "open",
        }).source,
      ).toBe(source);
    }
    expect(() =>
      MissionIssueSchema.parse({
        id: "issue-unknown",
        title: "Unknown issue",
        severity: "minor",
        source: "agent",
        summary: "Unknown sources are not accepted.",
        affectedPaths: [],
        evidenceIds: [],
        state: "open",
      }),
    ).toThrow();
  });

  it("parses authorization grants and session lifecycle snapshots", () => {
    const grant = {
      id: "grant-1",
      missionId: draft.id,
      proposalId: "proposal-1",
      issuedAt: "2026-07-30T10:05:00.000Z",
      sourceSnapshotId: sourceSnapshot.id,
      sourceSnapshotHash: "e".repeat(64),
      taskHash: "f".repeat(64),
      evidenceHashes: ["1".repeat(64)],
      approvedIssueIds: ["issue-1"],
      approvedPaths: ["src/app.ts"],
      approvedCommands: [
        {
          id: "command-test",
          label: "Test",
          executable: "npm",
          args: ["test"],
          cwdRelative: ".",
          timeoutMs: 30_000,
          category: "test",
        },
      ],
      sandboxPolicy: {
        readPathGlobs: ["src/**"],
        writePathGlobs: ["src/**"],
        network: "deny",
        maxFileBytes: 10 * 1024 * 1024,
        maxPayloadBytes: 250 * 1024 * 1024,
      },
      state: "active",
    } as const;
    expect(RepairAuthorizationGrantSchema.parse(grant)).toEqual(grant);

    const session = {
      schemaVersion: "1.0.0",
      id: "session-1",
      revision: 1,
      state: "ready",
      draft,
      createdAt: "2026-07-30T10:00:00.000Z",
      updatedAt: "2026-07-30T10:05:00.000Z",
      sourceSnapshotId: sourceSnapshot.id,
      snapshotIds: ["snapshot-1"],
      issueIds: ["issue-1"],
      proposalIds: ["proposal-1"],
      authorizationGrantIds: ["grant-1"],
    };
    expect(MissionSessionSchema.parse(session)).toEqual(session);
    expect(
      MissionSnapshotSchema.parse({
        schemaVersion: "1.0.0",
        id: "snapshot-1",
        missionSessionId: session.id,
        revision: 1,
        capturedAt: "2026-07-30T10:05:00.000Z",
        state: "ready",
        source: sourceSnapshot,
        issueIds: ["issue-1"],
        proposalIds: ["proposal-1"],
        authorizationGrantIds: ["grant-1"],
      }),
    ).toBeTruthy();
  });

  it("rejects incomplete hash bindings and inconsistent invalidation metadata", () => {
    const baseGrant = {
      id: "grant-1",
      missionId: draft.id,
      proposalId: "proposal-1",
      issuedAt: "2026-07-30T10:05:00.000Z",
      sourceSnapshotId: sourceSnapshot.id,
      sourceSnapshotHash: "e".repeat(64),
      taskHash: "f".repeat(64),
      evidenceHashes: ["1".repeat(64)],
      approvedIssueIds: ["issue-1"],
      approvedPaths: ["src/app.ts"],
      approvedCommands: [
        {
          id: "command-test",
          label: "Test",
          executable: "npm",
          args: ["test"],
          cwdRelative: ".",
          timeoutMs: 30_000,
          category: "test",
        },
      ],
      sandboxPolicy: {
        readPathGlobs: ["src/**"],
        writePathGlobs: ["src/**"],
        network: "deny",
        maxFileBytes: 10 * 1024 * 1024,
        maxPayloadBytes: 250 * 1024 * 1024,
      },
      state: "active",
    };
    const { taskHash: _taskHash, ...missingTaskHash } = baseGrant;
    expect(() =>
      RepairAuthorizationGrantSchema.parse(missingTaskHash),
    ).toThrow();
    expect(() =>
      RepairAuthorizationGrantSchema.parse({
        ...baseGrant,
        sourceSnapshotHash: "not-a-hash",
      }),
    ).toThrow();
    expect(() =>
      RepairAuthorizationGrantSchema.parse({
        ...baseGrant,
        approvedCommands: [{ id: "incomplete-command" }],
      }),
    ).toThrow();
    expect(() =>
      RepairAuthorizationGrantSchema.parse({
        ...baseGrant,
        state: "invalidated",
        invalidatedAt: "2026-07-30T10:06:00.000Z",
      }),
    ).toThrow();
    expect(
      RepairAuthorizationGrantSchema.parse({
        ...baseGrant,
        state: "invalidated",
        invalidatedAt: "2026-07-30T10:06:00.000Z",
        invalidationReason: "The task contract hash changed.",
      }).state,
    ).toBe("invalidated");
  });
});
