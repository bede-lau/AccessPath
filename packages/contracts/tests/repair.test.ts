import { describe, expect, it } from "vitest";
import {
  CommandSpecSchema,
  RepairManifestSchema,
  RepairSessionSchema,
  RepairStateSchema,
  RepositoryConfigSchema,
} from "../src/index";
import {
  commandSpecFixture,
  repairManifestFixture,
  repairSessionFixture,
  repositoryConfigFixture,
} from "./fixtures";

describe("repair entities", () => {
  it("parses valid fixtures for every repair entity", () => {
    expect(CommandSpecSchema.parse(commandSpecFixture)).toEqual(commandSpecFixture);
    expect(RepositoryConfigSchema.parse(repositoryConfigFixture)).toEqual(
      repositoryConfigFixture,
    );
    expect(RepairManifestSchema.parse(repairManifestFixture)).toEqual(
      repairManifestFixture,
    );
    expect(RepairSessionSchema.parse(repairSessionFixture)).toEqual(
      repairSessionFixture,
    );
  });

  it("round-trips RepairSession (parse output re-parses to itself)", () => {
    const parsed = RepairSessionSchema.parse(repairSessionFixture);
    expect(RepairSessionSchema.parse(parsed)).toEqual(parsed);
  });

  it("strips additive unknown fields from RepairManifest", () => {
    const parsed = RepairManifestSchema.parse({
      ...repairManifestFixture,
      priority: "high",
    });
    expect(parsed).toEqual(repairManifestFixture);
    expect(parsed).not.toHaveProperty("priority");
  });

  it("RepairState matches API_CONTRACTS.md L190-203 exactly (13 kebab-case values)", () => {
    expect([...RepairStateSchema.options].sort()).toEqual(
      [
        "configuring",
        "preparing",
        "diagnosing",
        "awaiting-plan-approval",
        "editing",
        "paused",
        "verifying",
        "awaiting-patch-approval",
        "approved",
        "completed",
        "rejected",
        "failed",
        "cancelled",
      ].sort(),
    );
  });

  it("rejects non-kebab-case or unknown repair states", () => {
    expect(() => RepairStateSchema.parse("awaitingPlanApproval")).toThrow();
    expect(() =>
      RepairSessionSchema.parse({ ...repairSessionFixture, state: "merging" }),
    ).toThrow();
  });

  it("rejects an invalid CommandSpec category", () => {
    expect(() =>
      CommandSpecSchema.parse({ ...commandSpecFixture, category: "format" }),
    ).toThrow();
  });

  it("rejects a CommandSpec where args is not a string array", () => {
    expect(() =>
      CommandSpecSchema.parse({ ...commandSpecFixture, args: "run test" }),
    ).toThrow();
  });

  it("rejects unsafe command paths, invalid URLs, hashes, and timeouts", () => {
    expect(() =>
      CommandSpecSchema.parse({
        ...commandSpecFixture,
        cwdRelative: "../../outside",
      }),
    ).toThrow();
    expect(() =>
      CommandSpecSchema.parse({ ...commandSpecFixture, timeoutMs: -1 }),
    ).toThrow();
    expect(() =>
      RepositoryConfigSchema.parse({
        ...repositoryConfigFixture,
        previewUrl: "not-a-url",
      }),
    ).toThrow();
    expect(() =>
      RepositoryConfigSchema.parse({
        ...repositoryConfigFixture,
        baseCommit: "not-a-git-object",
      }),
    ).toThrow();
    expect(() =>
      RepairManifestSchema.parse({
        ...repairManifestFixture,
        allowedPathGlobs: ["../**"],
      }),
    ).toThrow();
  });

  it("RepairSession.repository requires repositoryDisplayName and strips repositoryPath", () => {
    // L250-252: Omit<RepositoryConfig, "repositoryPath"> & { repositoryDisplayName }.
    const { repositoryDisplayName: _name, ...withoutDisplayName } =
      repairSessionFixture.repository;
    expect(() =>
      RepairSessionSchema.parse({
        ...repairSessionFixture,
        repository: withoutDisplayName,
      }),
    ).toThrow();

    // repositoryPath is an unknown key on the session repository and is stripped.
    const parsed = RepairSessionSchema.parse({
      ...repairSessionFixture,
      repository: {
        ...repairSessionFixture.repository,
        repositoryPath: "C:/dev/demo-app",
      },
    });
    expect(parsed.repository).not.toHaveProperty("repositoryPath");
    expect(parsed).toEqual(repairSessionFixture);
  });

  it("rejects repair entities missing required fields", () => {
    const { startCommand: _start, ...repoMissing } = repositoryConfigFixture;
    expect(() => RepositoryConfigSchema.parse(repoMissing)).toThrow();

    const { verification: _verification, ...manifestMissing } = repairManifestFixture;
    expect(() => RepairManifestSchema.parse(manifestMissing)).toThrow();

    const { worktreeId: _worktreeId, ...sessionMissing } = repairSessionFixture;
    expect(() => RepairSessionSchema.parse(sessionMissing)).toThrow();
  });
});
