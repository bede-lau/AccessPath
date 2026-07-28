import {
  ArtifactRefSchema,
  IdentifierSchema,
  RelativePathSchema,
  type ArtifactRef,
} from "@accesspath/contracts";
import { randomUUID } from "node:crypto";
import {
  createWriteStream,
  promises as fs,
  type PathLike,
} from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { finished } from "node:stream/promises";

import { sha256 } from "./canonical";
import { redactText } from "./redaction";

export type AuditDirectoryLayout = {
  root: string;
  auditDir: string;
  artifactsDir: string;
  sessionPath: string;
  eventsPath: string;
  bundlePath: string;
  markdownReportPath: string;
  htmlReportPath: string;
  jsonReportPath: string;
};

function isWithin(parent: string, candidate: string): boolean {
  const pathFromParent = relative(parent, candidate);
  return (
    pathFromParent === "" ||
    (!pathFromParent.startsWith(`..${sep}`) &&
      pathFromParent !== ".." &&
      !isAbsolute(pathFromParent))
  );
}

async function canonicalExistingPath(path: string): Promise<string> {
  return fs.realpath(resolve(path));
}

export async function validateArtifactRoot(
  artifactRoot: string,
  editableRepositoryRoot: string,
): Promise<string> {
  if (!isAbsolute(artifactRoot)) {
    throw new Error("Artifact root must be an absolute path.");
  }
  const repositoryRoot = await canonicalExistingPath(editableRepositoryRoot);
  await fs.mkdir(artifactRoot, { recursive: true });
  const canonicalRoot = await canonicalExistingPath(artifactRoot);
  if (
    isWithin(repositoryRoot, canonicalRoot) ||
    isWithin(canonicalRoot, repositoryRoot)
  ) {
    throw new Error(
      "Artifact root and editable repository must be disjoint directories.",
    );
  }
  return canonicalRoot;
}

export function validateRelativePath(relativePath: string): string {
  const parsed = RelativePathSchema.safeParse(relativePath);
  if (
    !parsed.success ||
    relativePath === "." ||
    relativePath.includes("//") ||
    relativePath.includes("\\\\")
  ) {
    throw new Error("Unsafe relative path.");
  }
  return relativePath.replaceAll("\\", "/");
}

export function resolveSafeRelativePath(root: string, relativePath: string): string {
  const normalized = validateRelativePath(relativePath);
  const resolvedRoot = resolve(root);
  const candidate = resolve(resolvedRoot, ...normalized.split("/"));
  if (!isWithin(resolvedRoot, candidate)) {
    throw new Error("Relative path escapes the artifact root.");
  }
  return candidate;
}

async function assertNoSymlinkSegments(root: string, targetDirectory: string) {
  const rootPath = resolve(root);
  const relativeDirectory = relative(rootPath, resolve(targetDirectory));
  if (!isWithin(rootPath, resolve(targetDirectory))) {
    throw new Error("Target directory escapes the artifact root.");
  }

  let current = rootPath;
  for (const segment of relativeDirectory.split(sep).filter(Boolean)) {
    current = join(current, segment);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) {
        throw new Error("Symlinked artifact directories are not allowed.");
      }
      if (!stat.isDirectory()) {
        throw new Error("Artifact path segment is not a directory.");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      await fs.mkdir(current);
    }
  }
}

export async function createAuditDirectoryLayout(
  artifactRoot: string,
  auditId: string,
): Promise<AuditDirectoryLayout> {
  IdentifierSchema.parse(auditId);
  const auditRelative = `audits/${auditId}`;
  const auditDir = resolveSafeRelativePath(artifactRoot, auditRelative);
  const artifactsDir = resolveSafeRelativePath(
    artifactRoot,
    `${auditRelative}/artifacts`,
  );
  await assertNoSymlinkSegments(artifactRoot, artifactsDir);
  return {
    root: resolve(artifactRoot),
    auditDir,
    artifactsDir,
    sessionPath: join(auditDir, "session.json"),
    eventsPath: join(auditDir, "events.ndjson"),
    bundlePath: join(auditDir, "bundle.json"),
    markdownReportPath: join(auditDir, "report.md"),
    htmlReportPath: join(auditDir, "report.html"),
    jsonReportPath: join(auditDir, "report.json"),
  };
}

export async function atomicWriteFile(
  root: string,
  relativePath: string,
  data: string | Uint8Array,
): Promise<string> {
  const target = resolveSafeRelativePath(root, relativePath);
  await assertNoSymlinkSegments(root, dirname(target));
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  const stream = createWriteStream(temporary, {
    flags: "wx",
    mode: 0o600,
  });
  try {
    stream.end(data);
    await finished(stream);
    for (let attempt = 0; ; attempt += 1) {
      try {
        await fs.rename(temporary, target);
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (
          attempt >= 5 ||
          (code !== "EACCES" && code !== "EBUSY" && code !== "EPERM")
        ) {
          throw error;
        }
        await new Promise((resolveDelay) =>
          setTimeout(resolveDelay, 10 * 2 ** attempt),
        );
      }
    }
    return target;
  } catch (error) {
    stream.destroy();
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

function extensionFor(mimeType: string): string {
  const extensions: Record<string, string> = {
    "application/json": "json",
    "application/ndjson": "ndjson",
    "image/jpeg": "jpg",
    "image/png": "png",
    "text/html": "html",
    "text/markdown": "md",
    "text/plain": "txt",
  };
  return extensions[mimeType.toLowerCase()] ?? "bin";
}

export type ArtifactInput = Omit<
  ArtifactRef,
  "id" | "sha256" | "relativePath"
> & {
  id?: string;
  extension?: string;
};

function sanitizedArtifactContent(
  content: string | Uint8Array,
): string | Uint8Array {
  return typeof content === "string" ? redactText(content) : content;
}

export function createArtifactRef(
  input: ArtifactInput & { content: string | Uint8Array; relativePath?: string },
): ArtifactRef {
  const digest = sha256(sanitizedArtifactContent(input.content));
  const extension = (input.extension ?? extensionFor(input.mimeType))
    .replace(/^\./, "")
    .toLowerCase();
  if (!/^[a-z0-9]+$/.test(extension)) {
    throw new Error("Artifact extension must be alphanumeric.");
  }
  const ref = {
    id: input.id ?? `artifact:${digest.slice(0, 32)}`,
    kind: input.kind,
    mimeType: input.mimeType,
    sha256: digest,
    relativePath:
      input.relativePath ?? `artifacts/${digest}.${extension}`,
    sensitivity: input.sensitivity,
    description: input.description,
  };
  return ArtifactRefSchema.parse(ref);
}

export async function persistArtifact(
  layout: AuditDirectoryLayout,
  input: ArtifactInput & { content: string | Uint8Array },
): Promise<ArtifactRef> {
  const content = sanitizedArtifactContent(input.content);
  const ref = createArtifactRef({ ...input, content });
  const auditRelative = relative(layout.root, layout.auditDir).replaceAll("\\", "/");
  const storageRelativePath = `${auditRelative}/${ref.relativePath}`;
  const target = resolveSafeRelativePath(layout.root, storageRelativePath);
  try {
    const existing = await fs.readFile(target);
    if (sha256(existing) !== ref.sha256) {
      throw new Error("Existing content-addressed artifact failed integrity validation.");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
    await atomicWriteFile(layout.root, storageRelativePath, content);
  }
  return ref;
}

export async function verifyArtifact(
  layout: AuditDirectoryLayout,
  artifact: ArtifactRef,
): Promise<void> {
  ArtifactRefSchema.parse(artifact);
  const auditRelative = relative(layout.root, layout.auditDir).replaceAll("\\", "/");
  const path = resolveSafeRelativePath(
    layout.root,
    `${auditRelative}/${artifact.relativePath}`,
  );
  const content = await fs.readFile(path);
  if (sha256(content) !== artifact.sha256) {
    throw new Error(`Artifact integrity check failed for ${artifact.id}.`);
  }
}

export async function fileExists(path: PathLike): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

export function artifactExtension(artifact: ArtifactRef): string {
  return extname(artifact.relativePath).slice(1);
}
