import {
  mkdtemp,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  fixtureTaskContract,
  start,
  stop,
} from "../../demo-aid-app/src/index";
import {
  loadAuditBundle,
  NdjsonEventStore,
} from "@accesspath/evidence";
import { afterEach, describe, expect, it } from "vitest";

import { runPersistedAudit } from "../src/audit-pipeline";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("persisted audit pipeline", () => {
  it("runs the real fixture, persists ordered evidence, and exports all formats", async () => {
    const fixture = await start(0);
    try {
      const address = fixture.address() as AddressInfo;
      const artifactRoot = await temporaryDirectory(
        "accesspath-p04-artifacts-",
      );
      const repositoryRoot = await temporaryDirectory(
        "accesspath-p04-repository-",
      );
      const task = JSON.parse(
        JSON.stringify({
          ...fixtureTaskContract,
          startUrl: `http://127.0.0.1:${address.port}/`,
        }),
      );

      const result = await runPersistedAudit(task, {
        artifactRoot,
        editableRepositoryRoot: repositoryRoot,
        auditSessionId: "audit-p04-fixture",
      });

      expect(result.bundle.outcome).toBe("blocked");
      expect(result.bundle.findings.map((finding) => finding.id)).toEqual([
        "AP-001",
        "AP-002",
        "AP-003",
        "AP-004",
        "AP-005",
      ]);
      expect(result.bundle.environment.axeVersion).toBe("4.12.1");
      expect(result.reports.markdown).toContain("AP-001");
      expect(result.reports.html).toContain("<!doctype html>");
      expect(JSON.parse(result.reports.json).findings).toHaveLength(5);

      const auditDir = join(
        artifactRoot,
        "audits",
        result.auditSessionId,
      );
      const layout = {
        root: artifactRoot,
        auditDir,
        artifactsDir: join(auditDir, "artifacts"),
        sessionPath: join(auditDir, "session.json"),
        eventsPath: join(auditDir, "events.ndjson"),
        bundlePath: join(auditDir, "bundle.json"),
        markdownReportPath: join(auditDir, "report.md"),
        htmlReportPath: join(auditDir, "report.html"),
        jsonReportPath: join(auditDir, "report.json"),
      };
      expect(await loadAuditBundle(layout)).toEqual(result.bundle);
      expect((await readdir(layout.artifactsDir)).length).toBeGreaterThan(0);

      const session = JSON.parse(await readFile(layout.sessionPath, "utf8"));
      expect(session).toMatchObject({
        id: result.auditSessionId,
        state: "blocked",
        activeRunId: result.bundle.runId,
      });

      const replay = await new NdjsonEventStore(layout.eventsPath).readAll();
      expect(replay.events[0]?.type).toBe("session.created");
      expect(replay.events.at(-1)?.type).toBe("session.completed");
      expect(replay.events.map((event) => event.sequence)).toEqual(
        replay.events.map((_, index) => index + 1),
      );

      const exported = Object.values(result.reports).join("\n");
      expect(exported).not.toMatch(/[A-Za-z]:\\/);
      expect(exported).not.toContain(tmpdir());
    } finally {
      await stop(fixture);
    }
  }, 60_000);
});
