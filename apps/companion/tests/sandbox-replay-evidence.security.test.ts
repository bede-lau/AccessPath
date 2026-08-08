import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AuditBundle, ArtifactRef } from "@accesspath/contracts";
import {
  canonicalJson,
  finalizeAuditBundle,
} from "@accesspath/evidence";
import { afterEach, describe, expect, it } from "vitest";

import type { CommandSandboxReport } from "../src/command-sandbox";
import { loadSandboxAuditBundle } from "../src/mission-service";

const directories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "sandbox-evidence-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function bundle(
  createdAt = "2026-07-30T10:00:01.000Z",
  artifacts: ArtifactRef[] = [],
): AuditBundle {
  return finalizeAuditBundle({
    schemaVersion: "1.0.0",
    id: "sandbox-bundle",
    auditSessionId: "sandbox-audit",
    runId: "sandbox-run",
    createdAt,
    environment: {
      browser: "chromium",
      browserVersion: "1",
      axeVersion: "1",
      viewport: { width: 1280, height: 800 },
      targetOrigin: "http://127.0.0.1:4173",
    },
    task: {
      schemaVersion: "1.0.0",
      id: "sandbox-task",
      title: "Check checkout",
      goal: "Complete checkout.",
      startUrl: "http://127.0.0.1:4173",
      targetPolicy: "local-explicit",
      success: { visibleText: "Order confirmed" },
      forbiddenActions: [],
      expectedSteps: [
        {
          id: "submit",
          intent: "Submit checkout",
          action: { kind: "press", key: "Enter" },
          checkpoint: true,
        },
      ],
      fixtureValues: {},
      viewport: { width: 1280, height: 800 },
      timeoutMs: 30_000,
    },
    outcome: "passed",
    steps: [],
    findings: [],
    artifacts,
    limitations: [],
  });
}

function report(artifactDirectory: string): CommandSandboxReport {
  return {
    capability: {
      mode: "execute",
      cliAvailable: true,
      daemonAvailable: true,
      image: `example.test/accesspath@sha256:${"a".repeat(64)}`,
    },
    status: "completed",
    artifactDirectory,
    results: [
      {
        command: {
          id: "replay",
          label: "Replay mission",
          executable: "npm",
          args: ["run", "accesspath:replay"],
          cwdRelative: ".",
          timeoutMs: 60_000,
          category: "test",
        },
        phase: "replay",
        exitCode: 0,
        stdout: "",
        stderr: "",
        startedAt: "2026-07-30T10:00:00.000Z",
        completedAt: "2026-07-30T10:00:02.000Z",
        durationMs: 2_000,
        terminationReason: "completed",
        outputTruncated: false,
      },
    ],
  };
}

async function writeBundle(
  directory: string,
  value: AuditBundle,
): Promise<void> {
  await writeFile(
    join(directory, "accesspath-audit-bundle.json"),
    `${canonicalJson(value)}\n`,
    "utf8",
  );
}

describe("sandbox replay evidence", () => {
  it("accepts only the exact root bundle with valid integrity", async () => {
    const directory = await temporaryDirectory();
    await writeBundle(directory, bundle());

    await expect(loadSandboxAuditBundle(report(directory))).resolves.toMatchObject({
      id: "sandbox-bundle",
      integrity: { algorithm: "sha256" },
    });
  });

  it("rejects a valid bundle placed under a nested path", async () => {
    const directory = await temporaryDirectory();
    const nested = join(directory, "audits", "stale");
    await mkdir(nested, { recursive: true });
    await writeBundle(nested, bundle());

    await expect(loadSandboxAuditBundle(report(directory))).resolves.toBeUndefined();
  });

  it("rejects a forged manifest", async () => {
    const directory = await temporaryDirectory();
    await writeBundle(directory, {
      ...bundle(),
      integrity: { algorithm: "sha256", manifestHash: "0".repeat(64) },
    });

    await expect(loadSandboxAuditBundle(report(directory))).resolves.toBeUndefined();
  });

  it("rejects missing referenced artifact files", async () => {
    const directory = await temporaryDirectory();
    await writeBundle(
      directory,
      bundle("2026-07-30T10:00:01.000Z", [
        {
          id: "artifact-missing",
          kind: "screenshot",
          mimeType: "image/png",
          sha256: "b".repeat(64),
          relativePath: "artifacts/missing.png",
          sensitivity: "project",
          description: "Missing screenshot",
        },
      ]),
    );

    await expect(loadSandboxAuditBundle(report(directory))).resolves.toBeUndefined();
  });

  it("rejects a stale bundle outside the replay window", async () => {
    const directory = await temporaryDirectory();
    await writeBundle(directory, bundle("2026-07-30T09:00:00.000Z"));

    await expect(loadSandboxAuditBundle(report(directory))).resolves.toBeUndefined();
  });
});
