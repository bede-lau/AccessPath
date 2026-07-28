import {
  access,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createAuditDirectoryLayout,
  createPartialAuditBundle,
  finalizeAuditBundle,
  loadAuditBundle,
  persistArtifact,
  persistAuditBundle,
  regenerateReportsFromPersistedEvidence,
  sha256,
  validateArtifactRoot,
  validateAuditBundle,
} from "../src/index";
import { bundle, finding } from "./fixtures";

const temporaryDirectories: string[] = [];

async function roots() {
  const repository = await mkdtemp(join(tmpdir(), "accesspath-repo-"));
  const artifacts = await mkdtemp(join(tmpdir(), "accesspath-artifacts-"));
  temporaryDirectories.push(repository, artifacts);
  return { repository, artifacts };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

describe("artifact and bundle persistence", () => {
  it("persists content-addressed artifacts and validates the integrity manifest", async () => {
    const { repository, artifacts } = await roots();
    const root = await validateArtifactRoot(artifacts, repository);
    const layout = await createAuditDirectoryLayout(root, "audit-1");
    const content = "redacted console summary";
    const artifact = await persistArtifact(layout, {
      kind: "console-summary",
      mimeType: "text/plain",
      sensitivity: "redacted",
      description: "Console summary",
      content,
    });
    expect(artifact.sha256).toBe(sha256(content));
    expect(artifact.relativePath).toBe(`artifacts/${artifact.sha256}.txt`);

    const persisted = await persistAuditBundle(
      layout,
      bundle({
        findings: [
          finding({
            id: "finding-1",
            evidenceIds: [artifact.id],
          }),
        ],
        artifacts: [artifact],
      }),
    );
    expect(await loadAuditBundle(layout)).toEqual(persisted);
    expect(persisted.integrity.manifestHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects tampered bundle content and missing evidence references", async () => {
    const valid = finalizeAuditBundle(bundle());
    await expect(
      validateAuditBundle({
        ...valid,
        outcome: "failed",
      }),
    ).rejects.toThrow(/manifest hash/);

    const missing = finalizeAuditBundle(
      bundle({
        findings: [finding({ evidenceIds: ["artifact-missing"] })],
      }),
    );
    await expect(validateAuditBundle(missing)).rejects.toThrow(
      /missing artifact/,
    );
  });

  it("does not write a bundle until referenced artifacts validate", async () => {
    const { repository, artifacts } = await roots();
    const root = await validateArtifactRoot(artifacts, repository);
    const layout = await createAuditDirectoryLayout(root, "audit-prevalidate");
    const missingArtifact = {
      id: "artifact-missing",
      kind: "screenshot" as const,
      mimeType: "image/png",
      sha256: "f".repeat(64),
      relativePath: `artifacts/${"f".repeat(64)}.png`,
      sensitivity: "project" as const,
      description: "Missing screenshot",
    };

    await expect(
      persistAuditBundle(
        layout,
        bundle({
          artifacts: [missingArtifact],
        }),
      ),
    ).rejects.toThrow(/ENOENT|no such file/i);
    await expect(access(layout.bundlePath)).rejects.toThrow();
  });

  it("allows repeated content-addressed paths when metadata matches", async () => {
    const shared = {
      kind: "console-summary" as const,
      mimeType: "application/json",
      sha256: "a".repeat(64),
      relativePath: `artifacts/${"a".repeat(64)}.json`,
      sensitivity: "redacted" as const,
      description: "Empty console summary",
    };
    const finalized = finalizeAuditBundle(
      bundle({
        artifacts: [
          { ...shared, id: "artifact-1" },
          { ...shared, id: "artifact-2" },
        ],
      }),
    );
    await expect(validateAuditBundle(finalized)).resolves.toEqual(finalized);
  });

  it("detects artifact bytes changed after bundle persistence", async () => {
    const { repository, artifacts } = await roots();
    const root = await validateArtifactRoot(artifacts, repository);
    const layout = await createAuditDirectoryLayout(root, "audit-tamper");
    const artifact = await persistArtifact(layout, {
      kind: "console-summary",
      mimeType: "text/plain",
      sensitivity: "redacted",
      description: "Console summary",
      content: "original",
    });
    await persistAuditBundle(
      layout,
      bundle({
        id: "bundle-tamper",
        auditSessionId: "audit-tamper",
        artifacts: [artifact],
      }),
    );
    await writeFile(join(layout.auditDir, artifact.relativePath), "tampered");
    await expect(loadAuditBundle(layout)).rejects.toThrow(
      /Artifact integrity check failed/,
    );
  });

  it.each(["blocked", "failed", "cancelled"] as const)(
    "preserves a partial %s bundle with a diagnostic",
    (outcome) => {
      const partial = createPartialAuditBundle({
        ...bundle(),
        outcome,
        diagnostic: "The browser process ended before the next checkpoint.",
      });
      expect(partial.outcome).toBe(outcome);
      expect(partial.limitations.join(" ")).toContain("partial evidence");
      expect(partial.limitations.join(" ")).toContain("browser process ended");
    },
  );

  it("regenerates Markdown, standalone HTML, and JSON from persisted evidence", async () => {
    const { repository, artifacts } = await roots();
    const root = await validateArtifactRoot(artifacts, repository);
    const layout = await createAuditDirectoryLayout(root, "audit-report");
    const artifact = await persistArtifact(layout, {
      kind: "screenshot",
      mimeType: "image/png",
      sensitivity: "project",
      description: "Checkpoint screenshot",
      content: new Uint8Array([137, 80, 78, 71]),
    });
    await persistAuditBundle(
      layout,
      bundle({
        id: "bundle-report",
        auditSessionId: "audit-report",
        findings: [
          finding({
            id: "finding-report",
            evidenceLabel: "manual-review-required",
            evidenceIds: [artifact.id],
          }),
        ],
        artifacts: [artifact],
      }),
    );

    const reports = await regenerateReportsFromPersistedEvidence(layout);
    expect(reports.markdown).toContain("## Limitations and residual risk");
    expect(reports.markdown).toContain("manual-review-required");
    expect(reports.html).toContain("<!doctype html>");
    expect(reports.html).not.toMatch(/<script|https?:\/\/[^<]*\.js/i);
    expect(JSON.parse(reports.json).id).toBe("bundle-report");
    expect(await readFile(layout.markdownReportPath, "utf8")).toBe(
      reports.markdown,
    );
    expect(await readFile(layout.htmlReportPath, "utf8")).toBe(reports.html);
    expect(await readFile(layout.jsonReportPath, "utf8")).toBe(reports.json);

    const regenerated = await regenerateReportsFromPersistedEvidence(layout);
    expect(regenerated).toEqual(reports);
  });
});
