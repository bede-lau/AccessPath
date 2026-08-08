import { mkdir, readFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { pathToFileURL } from "node:url";

import { runAudit, type ArtifactCapture } from "@accesspath/audit-engine";
import {
  TaskContractSchema,
  type ArtifactRef,
  type AuditBundle,
  type TaskContract,
} from "@accesspath/contracts";
import {
  atomicWriteFile,
  createArtifactRef,
  finalizeAuditBundle,
} from "@accesspath/evidence";

type MissionContext = {
  phase: "source-reproduction" | "repaired-preview-verification";
  task: TaskContract;
};

export type SourceReplayOptions = {
  contextPath: string;
  bundlePath: string;
};

function parseMissionContext(input: unknown): MissionContext {
  if (
    typeof input !== "object" ||
    input === null ||
    ![
      "source-reproduction",
      "repaired-preview-verification",
    ].includes((input as { phase?: unknown }).phase as string)
  ) {
    throw new Error(
      "ACCESSPATH_MISSION_CONTEXT must contain a supported replay task.",
    );
  }
  return {
    phase: (input as MissionContext).phase,
    task: TaskContractSchema.parse((input as { task?: unknown }).task),
  };
}

async function persistCapture(
  artifactRoot: string,
  capture: ArtifactCapture,
): Promise<ArtifactRef> {
  const artifact = createArtifactRef({
    id: capture.id,
    kind: capture.kind,
    mimeType: capture.mimeType,
    extension: capture.extension,
    sensitivity: capture.sensitivity,
    description: capture.description,
    content: capture.data,
  });
  await atomicWriteFile(
    artifactRoot,
    artifact.relativePath,
    capture.data,
  );
  return artifact;
}

export async function runSourceReplay(
  options: SourceReplayOptions,
): Promise<AuditBundle> {
  const artifactRoot = dirname(options.bundlePath);
  await mkdir(artifactRoot, { recursive: true });
  const context = parseMissionContext(
    JSON.parse(await readFile(options.contextPath, "utf8")),
  );
  const result = await runAudit(context.task, {
    captureArtifact: (capture) => persistCapture(artifactRoot, capture),
  });
  const { integrity: _integrity, ...withoutIntegrity } = result.bundle;
  const bundle = finalizeAuditBundle(withoutIntegrity);
  const bundleName = basename(options.bundlePath);
  if (bundleName === "" || bundleName === "." || bundleName === "..") {
    throw new Error("ACCESSPATH_AUDIT_BUNDLE_PATH must name a file.");
  }
  await atomicWriteFile(
    artifactRoot,
    bundleName,
    `${JSON.stringify(bundle)}\n`,
  );
  if (result.bundle.outcome === "failed" && result.diagnostic !== undefined) {
    process.stderr.write(
      `AccessPath source replay ${result.diagnostic.code}: ${result.diagnostic.message}\n`,
    );
  }
  return bundle;
}

async function main(): Promise<void> {
  const contextPath = process.env.ACCESSPATH_MISSION_CONTEXT;
  const bundlePath = process.env.ACCESSPATH_AUDIT_BUNDLE_PATH;
  if (contextPath === undefined || bundlePath === undefined) {
    throw new Error(
      "ACCESSPATH_MISSION_CONTEXT and ACCESSPATH_AUDIT_BUNDLE_PATH are required.",
    );
  }
  const bundle = await runSourceReplay({ contextPath, bundlePath });
  process.stdout.write(
    `AccessPath source replay recorded ${bundle.findings.length} findings.\n`,
  );
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
