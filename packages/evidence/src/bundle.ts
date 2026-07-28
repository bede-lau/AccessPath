import {
  AuditBundleSchema,
  type AuditBundle,
  type ArtifactRef,
} from "@accesspath/contracts";
import { promises as fs } from "node:fs";
import { relative } from "node:path";

import { canonicalJson, hashCanonical } from "./canonical";
import { redactValue } from "./redaction";
import {
  atomicWriteFile,
  type AuditDirectoryLayout,
  verifyArtifact,
} from "./storage";

function bundleManifestInput(bundle: Omit<AuditBundle, "integrity">) {
  return {
    bundle,
    artifacts: [...bundle.artifacts]
      .map((artifact) => ({
        id: artifact.id,
        kind: artifact.kind,
        mimeType: artifact.mimeType,
        relativePath: artifact.relativePath,
        sensitivity: artifact.sensitivity,
        sha256: artifact.sha256,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
}

export function createIntegrityManifestHash(
  bundle: Omit<AuditBundle, "integrity">,
): string {
  return hashCanonical(bundleManifestInput(bundle));
}

export function finalizeAuditBundle(
  input: Omit<AuditBundle, "integrity">,
): AuditBundle {
  const redacted = redactValue(input);
  return AuditBundleSchema.parse({
    ...redacted,
    integrity: {
      algorithm: "sha256",
      manifestHash: createIntegrityManifestHash(redacted),
    },
  });
}

export type PartialBundleInput = Omit<
  AuditBundle,
  "outcome" | "limitations" | "integrity"
> & {
  outcome: "blocked" | "failed" | "cancelled";
  limitations?: string[];
  diagnostic: string;
};

export function createPartialAuditBundle(input: PartialBundleInput): AuditBundle {
  return finalizeAuditBundle({
    ...input,
    limitations: [
      ...(input.limitations ?? []),
      `${input.outcome} run: ${input.diagnostic}`,
      "This bundle contains partial evidence captured before the terminal outcome.",
    ],
  });
}

function assertUniqueArtifacts(artifacts: readonly ArtifactRef[]) {
  const ids = new Set<string>();
  const paths = new Map<string, ArtifactRef>();
  for (const artifact of artifacts) {
    if (ids.has(artifact.id)) {
      throw new Error(`Duplicate artifact ID: ${artifact.id}.`);
    }
    const existingPath = paths.get(artifact.relativePath);
    if (
      existingPath !== undefined &&
      (existingPath.sha256 !== artifact.sha256 ||
        existingPath.mimeType !== artifact.mimeType)
    ) {
      throw new Error(
        `Conflicting artifact metadata for path: ${artifact.relativePath}.`,
      );
    }
    ids.add(artifact.id);
    paths.set(artifact.relativePath, artifact);
  }
}

export async function validateAuditBundle(
  input: unknown,
  layout?: AuditDirectoryLayout,
): Promise<AuditBundle> {
  const bundle = AuditBundleSchema.parse(input);
  const { integrity: _integrity, ...withoutIntegrity } = bundle;
  const expectedHash = createIntegrityManifestHash(withoutIntegrity);
  if (bundle.integrity.manifestHash !== expectedHash) {
    throw new Error("Audit bundle integrity manifest hash does not match.");
  }
  assertUniqueArtifacts(bundle.artifacts);

  const artifactsById = new Map(
    bundle.artifacts.map((artifact) => [artifact.id, artifact]),
  );
  for (const finding of bundle.findings) {
    for (const evidenceId of finding.evidenceIds) {
      if (!artifactsById.has(evidenceId)) {
        throw new Error(
          `Finding ${finding.id} references missing artifact ${evidenceId}.`,
        );
      }
    }
  }
  for (const step of bundle.steps) {
    for (const artifact of step.evidence) {
      const persistedArtifact = artifactsById.get(artifact.id);
      if (persistedArtifact === undefined) {
        throw new Error(
          `Step ${step.id} references missing artifact ${artifact.id}.`,
        );
      }
      if (hashCanonical(persistedArtifact) !== hashCanonical(artifact)) {
        throw new Error(
          `Step ${step.id} contains inconsistent metadata for artifact ${artifact.id}.`,
        );
      }
    }
  }

  if (layout !== undefined) {
    await Promise.all(
      bundle.artifacts.map((artifact) => verifyArtifact(layout, artifact)),
    );
  }
  return bundle;
}

export async function persistAuditBundle(
  layout: AuditDirectoryLayout,
  input: Omit<AuditBundle, "integrity"> | AuditBundle,
): Promise<AuditBundle> {
  let withoutIntegrity: Omit<AuditBundle, "integrity">;
  if ("integrity" in input) {
    const validated = await validateAuditBundle(input);
    const { integrity: _integrity, ...content } = validated;
    withoutIntegrity = content;
  } else {
    withoutIntegrity = input;
  }
  const bundle = finalizeAuditBundle(withoutIntegrity);
  await validateAuditBundle(bundle, layout);
  const bundleRelative = relative(layout.root, layout.bundlePath).replaceAll(
    "\\",
    "/",
  );
  await atomicWriteFile(
    layout.root,
    bundleRelative,
    `${canonicalJson(bundle)}\n`,
  );
  return bundle;
}

export async function loadAuditBundle(
  layout: AuditDirectoryLayout,
): Promise<AuditBundle> {
  const content = await fs.readFile(layout.bundlePath, "utf8");
  return validateAuditBundle(JSON.parse(content), layout);
}
