import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  RepairManifestSchema,
  type RepairManifest,
} from "@accesspath/contracts";

export function repairManifest(
  allowedPathGlobs = ["src/**", "tests/**"],
): RepairManifest {
  return RepairManifestSchema.parse({
    schemaVersion: "1.0.0",
    id: "manifest-ap-001",
    auditBundleId: "audit-bundle-001",
    findingIds: ["AP-001"],
    affectedActions: ["Choose eligibility"],
    observations: ["Pointer interaction works, but keyboard input does not."],
    evidenceRefs: [
      {
        id: "artifact-ap-001",
        kind: "axe-result",
        mimeType: "application/json",
        sha256: "a".repeat(64),
        relativePath: "artifacts/ap-001.json",
        sensitivity: "project",
        description: "Validated AP-001 browser evidence.",
      },
    ],
    constraints: ["Preserve the remaining seeded barriers."],
    nonGoals: ["Do not claim universal accessibility."],
    allowedPathGlobs,
    verification: {
      taskContract: {
        schemaVersion: "1.0.0",
        id: "task-emergency-aid",
        title: "Emergency aid",
        goal: "Submit a test application.",
        startUrl: "http://127.0.0.1:4174/",
        targetPolicy: "local-explicit",
        success: { visibleText: "Application submitted" },
        forbiddenActions: ["Submit real personal data"],
        expectedSteps: [
          {
            id: "step-eligibility",
            intent: "Choose eligibility",
            action: { kind: "press", key: "Space" },
            checkpoint: true,
          },
        ],
        fixtureValues: {},
        viewport: { width: 1280, height: 800 },
        timeoutMs: 30_000,
      },
      commands: [],
    },
  });
}

export async function temporaryWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "accesspath-qoder-runner-"));
  const artifactRoot = join(root, "artifacts");
  const worktreePath = join(root, "worktree");
  await mkdir(join(worktreePath, "src"), { recursive: true });
  await mkdir(join(worktreePath, "tests"), { recursive: true });
  await mkdir(artifactRoot, { recursive: true });
  await writeFile(join(worktreePath, "src", "feature.ts"), "old source\n");
  await writeFile(join(worktreePath, "tests", "feature.test.ts"), "old test\n");
  return {
    artifactRoot,
    root,
    worktreePath,
    async cleanup() {
      await rm(root, { force: true, recursive: true });
    },
  };
}
