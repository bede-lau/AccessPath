import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  opendir,
  readFile,
  readlink,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createReadStream } from "node:fs";
import { BlockList, isIP } from "node:net";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import {
  SourceSnapshotSchema,
  SourceSpecSchema,
  type SourceSpec,
} from "@accesspath/contracts";

import {
  SourceAcquisitionError,
  type AcquiredSource,
  type SourceAcquirerOptions,
} from "./types";

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_ADDED_FILE_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_PAYLOAD_BYTES = 250 * 1024 * 1024;
const DEFAULT_MAX_PUBLIC_REPOSITORY_BYTES = 500 * 1024 * 1024;
const MAX_COMMAND_OUTPUT_BYTES = 8 * 1024 * 1024;
const SNAPSHOT_BRANCH = "accesspath-snapshot";
const NON_PUBLIC_IPV4_ADDRESSES = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  NON_PUBLIC_IPV4_ADDRESSES.addSubnet(network, prefix, "ipv4");
}
const PUBLIC_IPV6_ADDRESSES = new BlockList();
PUBLIC_IPV6_ADDRESSES.addSubnet("2000::", 3, "ipv6");
const NON_PUBLIC_IPV6_ADDRESSES = new BlockList();
for (const [network, prefix] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const) {
  NON_PUBLIC_IPV6_ADDRESSES.addSubnet(network, prefix, "ipv6");
}
export const SOURCE_CACHE_OWNERSHIP_MARKER =
  ".accesspath-source-cache-owner.json";

type ManifestEntry = {
  path: string;
  kind: "file" | "symlink";
  size: number;
  sha256: string;
  executable: boolean;
};

type Manifest = {
  entries: ManifestEntry[];
  hash: string;
  payloadBytes: number;
};

type GitResult = {
  stdout: string;
  stderr: string;
};

type ValidatedPublicRepository = {
  repositoryUrl: URL;
  curlResolve: string[];
};

function acquisitionError(
  code: ConstructorParameters<typeof SourceAcquisitionError>[0],
  message: string,
  cause?: unknown,
): SourceAcquisitionError {
  return new SourceAcquisitionError(code, message, { cause });
}

function isWithin(parent: string, candidate: string): boolean {
  const pathFromParent = relative(parent, candidate);
  return (
    pathFromParent === "" ||
    (!pathFromParent.startsWith(`..${sep}`) &&
      pathFromParent !== ".." &&
      !isAbsolute(pathFromParent))
  );
}

function normalizedGitPath(path: string): string {
  return path.replaceAll("\\", "/");
}

function normalizedHostname(url: URL): string {
  return url.hostname.startsWith("[") && url.hostname.endsWith("]")
    ? url.hostname.slice(1, -1)
    : url.hostname;
}

function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    return !NON_PUBLIC_IPV4_ADDRESSES.check(address, "ipv4");
  }
  if (family === 6) {
    return (
      PUBLIC_IPV6_ADDRESSES.check(address, "ipv6") &&
      !NON_PUBLIC_IPV6_ADDRESSES.check(address, "ipv6")
    );
  }
  return false;
}

function timedLookup(
  hostname: string,
  timeoutMs: number,
): Promise<LookupAddress[]> {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      reject(
        acquisitionError(
          "SOURCE_TIMEOUT",
          "Source acquisition exceeded its time limit.",
        ),
      );
    }, timeoutMs);
    lookup(hostname, { all: true, verbatim: true }).then(
      (addresses) => {
        clearTimeout(timer);
        resolvePromise(addresses);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function validatePublicRepository(
  repositoryUrl: string,
  deadline: number,
): Promise<ValidatedPublicRepository> {
  const parsedUrl = new URL(repositoryUrl);
  if (
    parsedUrl.protocol !== "https:" ||
    parsedUrl.username !== "" ||
    parsedUrl.password !== ""
  ) {
    throw acquisitionError(
      "SOURCE_INVALID",
      "Public source URL must use HTTPS without embedded credentials.",
    );
  }

  const hostname = normalizedHostname(parsedUrl);
  const literalFamily = isIP(hostname);
  let addresses: string[];
  if (literalFamily !== 0) {
    addresses = [hostname];
  } else {
    try {
      addresses = [
        ...new Set(
          (
            await timedLookup(hostname, remainingTime(deadline))
          ).map((result) => result.address),
        ),
      ];
    } catch (error) {
      if (error instanceof SourceAcquisitionError) {
        throw error;
      }
      throw acquisitionError(
        "SOURCE_INVALID",
        "Public source hostname could not be resolved.",
        error,
      );
    }
  }

  if (
    addresses.length === 0 ||
    addresses.some((address) => !isPublicAddress(address))
  ) {
    throw acquisitionError(
      "SOURCE_INVALID",
      "Public source must resolve only to public IP addresses.",
    );
  }

  const port = parsedUrl.port || "443";
  return {
    repositoryUrl: parsedUrl,
    curlResolve:
      literalFamily === 0
        ? [
            `${hostname}:${port}:${addresses
              .map((address) => (isIP(address) === 6 ? `[${address}]` : address))
              .join(",")}`,
          ]
        : [],
  };
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolvePromise);
  });
  return hash.digest("hex");
}

function hashManifest(entries: ManifestEntry[]): string {
  const hash = createHash("sha256");
  for (const entry of entries) {
    hash.update(
      `${entry.path}\0${entry.kind}\0${entry.size}\0${entry.sha256}\0${
        entry.executable ? "1" : "0"
      }\0`,
    );
  }
  return hash.digest("hex");
}

function gitEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_CONFIG_COUNT: "0",
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_ASKPASS: "",
    SSH_ASKPASS: "",
    GIT_LFS_SKIP_SMUDGE: "1",
  };
  for (const name of Object.keys(environment)) {
    const normalizedName = name.toLowerCase();
    if (
      [
        "all_proxy",
        "git_config_parameters",
        "http_proxy",
        "https_proxy",
        "no_proxy",
      ].includes(normalizedName) ||
      /^git_config_(?:key|value)_\d+$/.test(normalizedName)
    ) {
      delete environment[name];
    }
  }
  return environment;
}

async function runGit(
  cwd: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<GitResult> {
  try {
    const result = await execFileAsync(
      "git",
      [
        "-c",
        "core.quotepath=false",
        "-c",
        "credential.helper=",
        "-c",
        "protocol.allow=never",
        "-c",
        "protocol.file.allow=always",
        "-c",
        "protocol.https.allow=always",
        "-C",
        cwd,
        ...args,
      ],
      {
        encoding: "utf8",
        env: gitEnvironment(),
        maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
        timeout: timeoutMs,
        windowsHide: true,
      },
    );
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & {
      stderr?: string;
      killed?: boolean;
      signal?: string;
    };
    if (failure.code === "ETIMEDOUT" || failure.killed === true) {
      throw acquisitionError(
        "SOURCE_TIMEOUT",
        "Source acquisition exceeded its time limit.",
        error,
      );
    }
    throw acquisitionError(
      "SOURCE_FETCH_FAILED",
      failure.stderr?.trim() || "Git source acquisition failed.",
      error,
    );
  }
}

async function gitOutput(
  cwd: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<string> {
  return (await runGit(cwd, args, timeoutMs)).stdout.trim();
}

async function resolveLocalRepositoryTopLevel(
  repositoryPath: string,
  timeoutMs: number,
): Promise<string> {
  if (!isAbsolute(repositoryPath)) {
    throw acquisitionError(
      "SOURCE_INVALID",
      "Local source path must be absolute.",
    );
  }
  let directory = repositoryPath;
  try {
    const details = await stat(repositoryPath);
    if (!details.isDirectory()) {
      directory = dirname(repositoryPath);
    }
  } catch (error) {
    throw acquisitionError(
      "SOURCE_INVALID",
      "Local source path does not exist.",
      error,
    );
  }
  const root = await gitOutput(
    directory,
    ["rev-parse", "--path-format=absolute", "--show-toplevel"],
    timeoutMs,
  );
  const canonicalRoot = await realpath(root);
  if (
    (await gitOutput(
      canonicalRoot,
      ["rev-parse", "--is-bare-repository"],
      timeoutMs,
    )) !== "false"
  ) {
    throw acquisitionError(
      "SOURCE_INVALID",
      "Bare Git repositories are not supported as local sources.",
    );
  }
  return canonicalRoot;
}

async function gitPathSet(
  repositoryRoot: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<Set<string>> {
  const output = (await runGit(repositoryRoot, args, timeoutMs)).stdout;
  return new Set(
    output
      .split("\0")
      .filter(Boolean)
      .map(normalizedGitPath),
  );
}

async function listedWorkingTreePaths(
  repositoryRoot: string,
  timeoutMs: number,
): Promise<string[]> {
  const paths = await gitPathSet(
    repositoryRoot,
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    timeoutMs,
  );
  return [...paths].sort((left, right) => left.localeCompare(right));
}

async function addedWorkingTreePaths(
  repositoryRoot: string,
  timeoutMs: number,
): Promise<Set<string>> {
  const [trackedAdded, untracked] = await Promise.all([
    gitPathSet(
      repositoryRoot,
      ["diff", "--name-only", "--diff-filter=A", "-z", "HEAD", "--"],
      timeoutMs,
    ),
    gitPathSet(
      repositoryRoot,
      ["ls-files", "-z", "--others", "--exclude-standard"],
      timeoutMs,
    ),
  ]);
  return new Set([...trackedAdded, ...untracked]);
}

async function manifestForPaths(
  repositoryRoot: string,
  paths: readonly string[],
  addedPaths: ReadonlySet<string>,
  maxAddedFileBytes: number,
  maxPayloadBytes: number,
): Promise<Manifest> {
  const canonicalRoot = await realpath(repositoryRoot);
  const entries: ManifestEntry[] = [];
  let payloadBytes = 0;

  for (const gitPath of paths) {
    const candidate = resolve(canonicalRoot, ...gitPath.split("/"));
    if (!isWithin(canonicalRoot, candidate)) {
      throw acquisitionError(
        "SOURCE_INVALID",
        `Git returned a path outside the repository: ${gitPath}`,
      );
    }
    let segmentPath = canonicalRoot;
    for (const segment of gitPath.split("/")) {
      segmentPath = join(segmentPath, segment);
      let segmentDetails;
      try {
        segmentDetails = await lstat(segmentPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          break;
        }
        throw error;
      }
      if (segmentDetails.isSymbolicLink()) {
        const target = await realpath(segmentPath).catch((error: unknown) => {
          throw acquisitionError(
            "SOURCE_SYMLINK_ESCAPE",
            `Source symlink is broken or inaccessible: ${gitPath}`,
            error,
          );
        });
        if (!isWithin(canonicalRoot, target)) {
          throw acquisitionError(
            "SOURCE_SYMLINK_ESCAPE",
            `Source symlink escapes the repository: ${gitPath}`,
          );
        }
      }
    }

    let details;
    try {
      details = await lstat(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }
      throw error;
    }

    if (details.isSymbolicLink()) {
      const target = await realpath(candidate).catch((error: unknown) => {
        throw acquisitionError(
          "SOURCE_SYMLINK_ESCAPE",
          `Source symlink is broken or inaccessible: ${gitPath}`,
          error,
        );
      });
      if (!isWithin(canonicalRoot, target)) {
        throw acquisitionError(
          "SOURCE_SYMLINK_ESCAPE",
          `Source symlink escapes the repository: ${gitPath}`,
        );
      }
      const linkTarget = await readlink(candidate);
      if (isAbsolute(linkTarget)) {
        throw acquisitionError(
          "SOURCE_UNSUPPORTED",
          `Absolute source symlinks cannot be reproduced safely: ${gitPath}`,
        );
      }
      const bytes = Buffer.from(linkTarget);
      payloadBytes += bytes.byteLength;
      entries.push({
        path: gitPath,
        kind: "symlink",
        size: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        executable: false,
      });
    } else if (details.isFile()) {
      if (addedPaths.has(gitPath) && details.size > maxAddedFileBytes) {
        throw acquisitionError(
          "SOURCE_TOO_LARGE",
          `Added source file exceeds the per-file limit: ${gitPath}`,
        );
      }
      payloadBytes += details.size;
      entries.push({
        path: gitPath,
        kind: "file",
        size: details.size,
        sha256: await hashFile(candidate),
        executable: (details.mode & 0o111) !== 0,
      });
    } else {
      throw acquisitionError(
        "SOURCE_UNSUPPORTED",
        `Source entry is not a regular file or symlink: ${gitPath}`,
      );
    }

    if (payloadBytes > maxPayloadBytes) {
      throw acquisitionError(
        "SOURCE_TOO_LARGE",
        "Source payload exceeds the configured size limit.",
      );
    }
  }

  return {
    entries,
    hash: hashManifest(entries),
    payloadBytes,
  };
}

async function workingTreeManifest(
  repositoryRoot: string,
  timeoutMs: number,
  maxAddedFileBytes: number,
  maxPayloadBytes: number,
): Promise<Manifest> {
  const [paths, addedPaths] = await Promise.all([
    listedWorkingTreePaths(repositoryRoot, timeoutMs),
    addedWorkingTreePaths(repositoryRoot, timeoutMs),
  ]);
  return manifestForPaths(
    repositoryRoot,
    paths,
    addedPaths,
    maxAddedFileBytes,
    maxPayloadBytes,
  );
}

async function copyManifest(
  sourceRoot: string,
  destinationRoot: string,
  manifest: Manifest,
): Promise<void> {
  for (const entry of manifest.entries) {
    const sourcePath = resolve(sourceRoot, ...entry.path.split("/"));
    const destinationPath = resolve(destinationRoot, ...entry.path.split("/"));
    await mkdir(dirname(destinationPath), { recursive: true });
    if (entry.kind === "symlink") {
      await symlink(await readlink(sourcePath), destinationPath);
    } else {
      await copyFile(sourcePath, destinationPath);
      if (entry.executable) {
        const details = await stat(destinationPath);
        await chmod(destinationPath, details.mode | 0o111);
      }
    }
  }
}

async function directoryBytes(root: string): Promise<number> {
  let total = 0;
  const directory = await opendir(root);
  for await (const entry of directory) {
    const path = join(root, entry.name);
    const details = await lstat(path);
    if (details.isSymbolicLink()) {
      total += Buffer.byteLength(await readlink(path));
    } else if (details.isDirectory()) {
      total += await directoryBytes(path);
    } else if (details.isFile()) {
      total += details.size;
    }
  }
  return total;
}

async function assertNoGitlinks(
  repositoryRoot: string,
  timeoutMs: number,
): Promise<void> {
  const tree = (await runGit(
    repositoryRoot,
    ["ls-tree", "-r", "-z", "HEAD"],
    timeoutMs,
  )).stdout;
  if (
    tree
      .split("\0")
      .filter(Boolean)
      .some((entry) => entry.startsWith("160000 "))
  ) {
    throw acquisitionError(
      "SOURCE_UNSUPPORTED",
      "Repositories containing Git submodules are not supported.",
    );
  }
}

function snapshotId(manifestHash: string): string {
  return `source-${manifestHash.slice(0, 24)}`;
}

function remainingTime(deadline: number): number {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    throw acquisitionError(
      "SOURCE_TIMEOUT",
      "Source acquisition exceeded its time limit.",
    );
  }
  return remaining;
}

async function ensureOwnedCacheRoot(cacheRoot: string): Promise<string> {
  await mkdir(cacheRoot, { recursive: true });
  const markerPath = join(cacheRoot, SOURCE_CACHE_OWNERSHIP_MARKER);
  try {
    const marker = JSON.parse(await readFile(markerPath, "utf8")) as {
      owner?: unknown;
      schemaVersion?: unknown;
    };
    if (
      marker.owner !== "accesspath-source-cache" ||
      marker.schemaVersion !== "1.0.0"
    ) {
      throw acquisitionError(
        "SOURCE_INVALID",
        "Source cache ownership marker is invalid.",
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      if (error instanceof SourceAcquisitionError) {
        throw error;
      }
      throw acquisitionError(
        "SOURCE_INVALID",
        "Source cache ownership marker is invalid.",
        error,
      );
    }
    const entries: string[] = [];
    const directory = await opendir(cacheRoot);
    for await (const entry of directory) {
      entries.push(entry.name);
    }
    if (entries.length > 0) {
      throw acquisitionError(
        "SOURCE_INVALID",
        "Source cache root is non-empty and is not marked as AccessPath-owned.",
      );
    }
    await writeFile(
      markerPath,
      `${JSON.stringify({
        schemaVersion: "1.0.0",
        owner: "accesspath-source-cache",
      })}\n`,
      "utf8",
    );
  }
  return realpath(cacheRoot);
}

export class SourceAcquirer {
  readonly #cacheRoot: string;
  readonly #timeoutMs: number;
  readonly #maxAddedFileBytes: number;
  readonly #maxPayloadBytes: number;
  readonly #maxPublicRepositoryBytes: number;
  readonly #now: () => Date;
  readonly #beforeConsistencyCheck: () => void | Promise<void>;

  public constructor(options: SourceAcquirerOptions) {
    if (!isAbsolute(options.cacheRoot)) {
      throw acquisitionError(
        "SOURCE_INVALID",
        "Source cache root must be an absolute path.",
      );
    }
    for (const [name, value] of [
      ["timeoutMs", options.timeoutMs ?? DEFAULT_TIMEOUT_MS],
      [
        "maxAddedFileBytes",
        options.maxAddedFileBytes ?? DEFAULT_MAX_ADDED_FILE_BYTES,
      ],
      ["maxPayloadBytes", options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES],
      [
        "maxPublicRepositoryBytes",
        options.maxPublicRepositoryBytes ?? DEFAULT_MAX_PUBLIC_REPOSITORY_BYTES,
      ],
    ] as const) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw acquisitionError(
          "SOURCE_INVALID",
          `${name} must be a positive safe integer.`,
        );
      }
    }
    this.#cacheRoot = resolve(options.cacheRoot);
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#maxAddedFileBytes =
      options.maxAddedFileBytes ?? DEFAULT_MAX_ADDED_FILE_BYTES;
    this.#maxPayloadBytes =
      options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES;
    this.#maxPublicRepositoryBytes =
      options.maxPublicRepositoryBytes ?? DEFAULT_MAX_PUBLIC_REPOSITORY_BYTES;
    this.#now = options.now ?? (() => new Date());
    this.#beforeConsistencyCheck =
      options.beforeConsistencyCheck ?? (() => undefined);
  }

  public async acquire(input: SourceSpec): Promise<AcquiredSource> {
    const parsedSource = SourceSpecSchema.safeParse(input);
    if (!parsedSource.success) {
      throw acquisitionError(
        "SOURCE_INVALID",
        "Source specification is invalid.",
        parsedSource.error,
      );
    }
    const source = parsedSource.data;
    const deadline = Date.now() + this.#timeoutMs;
    const publicRepository =
      source.kind === "public"
        ? await validatePublicRepository(source.repositoryUrl, deadline)
        : undefined;
    const cacheRoot = await ensureOwnedCacheRoot(this.#cacheRoot);
    const destination = await mkdtemp(join(cacheRoot, "source-"));

    try {
      return source.kind === "local"
        ? await this.#acquireLocal(source, destination, cacheRoot, deadline)
        : await this.#acquirePublic(
            source,
            destination,
            deadline,
            publicRepository!,
          );
    } catch (error) {
      await rm(destination, { recursive: true, force: true });
      if (error instanceof SourceAcquisitionError) {
        throw error;
      }
      throw acquisitionError(
        "SOURCE_FETCH_FAILED",
        "Source acquisition failed.",
        error,
      );
    }
  }

  async #acquireLocal(
    source: Extract<SourceSpec, { kind: "local" }>,
    destination: string,
    cacheRoot: string,
    deadline: number,
  ): Promise<AcquiredSource> {
    const repositoryRoot = await resolveLocalRepositoryTopLevel(
      source.repositoryPath,
      remainingTime(deadline),
    ).catch((error: unknown) => {
      if (
        error instanceof SourceAcquisitionError &&
        error.code === "SOURCE_TIMEOUT"
      ) {
        throw error;
      }
      throw acquisitionError(
        "SOURCE_INVALID",
        "Local source must be inside a non-bare Git working tree.",
        error,
      );
    });
    if (
      isWithin(repositoryRoot, cacheRoot) ||
      isWithin(cacheRoot, repositoryRoot)
    ) {
      throw acquisitionError(
        "SOURCE_INVALID",
        "Source repository and application cache must be disjoint.",
      );
    }

    const statusBefore = (
      await runGit(
        repositoryRoot,
        ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
        remainingTime(deadline),
      )
    ).stdout;
    const sourceCommit = await gitOutput(
      repositoryRoot,
      ["rev-parse", "--verify", "HEAD^{commit}"],
      remainingTime(deadline),
    );
    await assertNoGitlinks(repositoryRoot, remainingTime(deadline));
    const before = await workingTreeManifest(
      repositoryRoot,
      remainingTime(deadline),
      this.#maxAddedFileBytes,
      this.#maxPayloadBytes,
    );
    const dirty = statusBefore !== "";

    if (dirty) {
      await runGit(
        destination,
        ["init", "--initial-branch", SNAPSHOT_BRANCH],
        remainingTime(deadline),
      );
      await copyManifest(repositoryRoot, destination, before);
      await runGit(
        destination,
        ["config", "user.name", "AccessPath Source Acquirer"],
        remainingTime(deadline),
      );
      await runGit(
        destination,
        ["config", "user.email", "source-acquirer@accesspath.invalid"],
        remainingTime(deadline),
      );
      await runGit(destination, ["add", "--all"], remainingTime(deadline));
      await runGit(
        destination,
        ["commit", "--no-gpg-sign", "-m", "Capture source snapshot"],
        remainingTime(deadline),
      );
    } else {
      await rm(destination, { recursive: true, force: true });
      await runGit(
        cacheRoot,
        [
          "clone",
          "--no-hardlinks",
          "--no-checkout",
          "--no-tags",
          "--",
          repositoryRoot,
          destination,
        ],
        remainingTime(deadline),
      );
      await runGit(
        destination,
        ["checkout", "--detach", sourceCommit, "--"],
        remainingTime(deadline),
      );
    }

    await this.#beforeConsistencyCheck();
    const [statusAfter, after] = await Promise.all([
      runGit(
        repositoryRoot,
        ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
        remainingTime(deadline),
      ).then((result) => result.stdout),
      workingTreeManifest(
        repositoryRoot,
        remainingTime(deadline),
        this.#maxAddedFileBytes,
        this.#maxPayloadBytes,
      ),
    ]);
    const sourceCommitAfter = await gitOutput(
      repositoryRoot,
      ["rev-parse", "--verify", "HEAD^{commit}"],
      remainingTime(deadline),
    );
    if (
      statusAfter !== statusBefore ||
      after.hash !== before.hash ||
      sourceCommitAfter !== sourceCommit
    ) {
      throw acquisitionError(
        "SOURCE_CHANGED",
        "Local source changed while its snapshot was being acquired.",
      );
    }

    const snapshotManifest = await workingTreeManifest(
      destination,
      remainingTime(deadline),
      this.#maxAddedFileBytes,
      this.#maxPayloadBytes,
    );
    if (snapshotManifest.hash !== before.hash) {
      throw acquisitionError(
        "SOURCE_CHANGED",
        "Acquired source does not match the validated local content manifest.",
      );
    }
    return this.#result(
      source,
      destination,
      sourceCommit,
      dirty,
      snapshotManifest,
      deadline,
      basename(repositoryRoot),
    );
  }

  async #acquirePublic(
    source: Extract<SourceSpec, { kind: "public" }>,
    destination: string,
    deadline: number,
    repository: ValidatedPublicRepository,
  ): Promise<AcquiredSource> {
    await runGit(
      destination,
      ["init", "--initial-branch", SNAPSHOT_BRANCH],
      remainingTime(deadline),
    );
    await runGit(
      destination,
      [
        "-c",
        "http.followRedirects=false",
        "-c",
        "http.proxy=",
        "-c",
        "http.curloptResolve=",
        ...repository.curlResolve.flatMap((entry) => [
          "-c",
          `http.curloptResolve=${entry}`,
        ]),
        "-c",
        "protocol.file.allow=never",
        "fetch",
        "--depth=1",
        "--no-tags",
        "--no-recurse-submodules",
        "--filter=blob:limit=10m",
        "--",
        source.repositoryUrl,
        source.commit,
      ],
      remainingTime(deadline),
    );
    if (
      (await directoryBytes(destination)) > this.#maxPublicRepositoryBytes
    ) {
      throw acquisitionError(
        "SOURCE_TOO_LARGE",
        "Fetched public repository exceeds the configured size limit.",
      );
    }
    const fetchedCommit = await gitOutput(
      destination,
      ["rev-parse", "--verify", "FETCH_HEAD^{commit}"],
      remainingTime(deadline),
    );
    if (fetchedCommit.toLowerCase() !== source.commit.toLowerCase()) {
      throw acquisitionError(
        "SOURCE_FETCH_FAILED",
        "Fetched public source did not resolve to the pinned commit.",
      );
    }
    await runGit(
      destination,
      ["checkout", "--detach", fetchedCommit, "--"],
      remainingTime(deadline),
    );
    if (
      (await directoryBytes(destination)) > this.#maxPublicRepositoryBytes
    ) {
      throw acquisitionError(
        "SOURCE_TOO_LARGE",
        "Checked out public repository exceeds the configured size limit.",
      );
    }
    await assertNoGitlinks(destination, remainingTime(deadline));
    const manifest = await workingTreeManifest(
      destination,
      remainingTime(deadline),
      this.#maxAddedFileBytes,
      this.#maxPayloadBytes,
    );
    return this.#result(
      source,
      destination,
      fetchedCommit,
      false,
      manifest,
      deadline,
      basename(repository.repositoryUrl.pathname).replace(/\.git$/i, ""),
    );
  }

  async #result(
    source: SourceSpec,
    repositoryPath: string,
    sourceCommit: string,
    dirty: boolean,
    manifest: Manifest,
    deadline: number,
    repositoryDisplayName: string,
  ): Promise<AcquiredSource> {
    const [snapshotCommit, treeHash] = await Promise.all([
      gitOutput(
        repositoryPath,
        ["rev-parse", "--verify", "HEAD^{commit}"],
        remainingTime(deadline),
      ),
      gitOutput(
        repositoryPath,
        ["rev-parse", "--verify", "HEAD^{tree}"],
        remainingTime(deadline),
      ),
    ]);
    const snapshot = SourceSnapshotSchema.parse({
      schemaVersion: "1.0.0",
      id: snapshotId(manifest.hash),
      source,
      acquiredAt: this.#now().toISOString(),
      repositoryDisplayName,
      sourceCommit,
      snapshotCommit,
      treeHash,
      contentManifestHash: manifest.hash,
      dirty,
      fileCount: manifest.entries.length,
      payloadBytes: manifest.payloadBytes,
    });
    return { source, repositoryPath, snapshot };
  }
}

export async function acquireSource(
  source: SourceSpec,
  options: SourceAcquirerOptions,
): Promise<AcquiredSource> {
  return new SourceAcquirer(options).acquire(source);
}
