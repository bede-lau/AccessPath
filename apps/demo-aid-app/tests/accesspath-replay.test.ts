import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

import { validateAuditBundle } from "@accesspath/evidence";
import { afterEach, describe, expect, it } from "vitest";

import { runSourceReplay } from "../scripts/accesspath-replay";
import { fixtureTaskContract } from "../src/fixture-data";
import { start, stop } from "../src/server";

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

describe("accesspath source replay", () => {
  it.each([
    "source-reproduction",
    "repaired-preview-verification",
  ] as const)(
    "writes an integrity-checked audit bundle for the %s phase",
    async (phase) => {
    const server = await start(0);
    try {
      const { port } = server.address() as AddressInfo;
      const artifactDirectory = await temporaryDirectory(
        "accesspath-source-replay-",
      );
      const contextPath = join(artifactDirectory, "mission-context.json");
      const bundlePath = join(
        artifactDirectory,
        "accesspath-audit-bundle.json",
      );
      const task = {
        ...fixtureTaskContract,
        startUrl: `http://127.0.0.1:${port}/`,
      };
      await writeFile(
        contextPath,
        `${JSON.stringify({ phase, task })}\n`,
        "utf8",
      );

      const replay = await runSourceReplay({ contextPath, bundlePath });
      const bundle = await validateAuditBundle(
        JSON.parse(await readFile(bundlePath, "utf8")),
      );

      expect(bundle).toEqual(replay);
      expect(bundle.outcome).toBe("blocked");
      expect(bundle.findings.map((finding) => finding.id)).toContain("AP-001");
      expect(bundle.artifacts.length).toBeGreaterThan(0);
      for (const artifact of bundle.artifacts) {
        const contents = await readFile(
          join(artifactDirectory, artifact.relativePath),
        );
        expect(createHash("sha256").update(contents).digest("hex")).toBe(
          artifact.sha256,
        );
      }
      } finally {
        await stop(server);
      }
    },
    60_000,
  );
});
