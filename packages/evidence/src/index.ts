export const PACKAGE_NAME = "@accesspath/evidence" as const;

export {
  canonicalJson,
  hashCanonical,
  sha256,
} from "./canonical";
export {
  assertEquivalentFindingViews,
  buildBarrierMap,
  buildLinearFindingGroups,
  compareFinding,
  compareFindingSets,
  createStableFindingId,
  withStableFindingId,
  type BarrierMapFinding,
  type BarrierMapGroup,
  type ComparisonInput,
  type FindingIdentityInput,
  type LinearFindingGroup,
} from "./findings";
export {
  containsSensitiveData,
  redactText,
  redactValue,
} from "./redaction";
export {
  artifactExtension,
  atomicWriteFile,
  createArtifactRef,
  createAuditDirectoryLayout,
  fileExists,
  persistArtifact,
  resolveSafeRelativePath,
  validateArtifactRoot,
  validateRelativePath,
  verifyArtifact,
  type ArtifactInput,
  type AuditDirectoryLayout,
} from "./storage";
export {
  appendNdjsonEvent,
  NdjsonEventStore,
  readNdjsonEvents,
} from "./events";
export {
  createIntegrityManifestHash,
  createPartialAuditBundle,
  finalizeAuditBundle,
  loadAuditBundle,
  persistAuditBundle,
  validateAuditBundle,
  type PartialBundleInput,
} from "./bundle";
export {
  regenerateReportsFromPersistedEvidence,
  renderHtmlReport,
  renderJsonReport,
  renderMarkdownReport,
  type PersistedReports,
} from "./reports";
