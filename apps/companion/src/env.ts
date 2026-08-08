import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface CompanionConfig {
  host: string;
  port: number;
  consolePort: number;
  artifactRoot: string;
  demoAidAppPort: number;
  demoAgentInactivityTimeoutMs: number;
  demoAgentHardTimeoutMs: number;
  nodeEnv: string;
  launchToken?: string;
}

const REQUIRED_HOST = "127.0.0.1";
const DEFAULT_REPOSITORY_ROOT = path.resolve(
  fileURLToPath(new URL("../../..", import.meta.url)),
);

function canonicalizePath(input: string): string {
  const resolved = path.resolve(input);
  const missingSegments: string[] = [];
  let existingAncestor = resolved;

  while (!fs.existsSync(existingAncestor)) {
    const parent = path.dirname(existingAncestor);
    if (parent === existingAncestor) {
      break;
    }
    missingSegments.unshift(path.basename(existingAncestor));
    existingAncestor = parent;
  }

  const canonicalAncestor = fs.existsSync(existingAncestor)
    ? fs.realpathSync.native(existingAncestor)
    : existingAncestor;
  return path.join(canonicalAncestor, ...missingSegments);
}

function isWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

function parsePort(
  raw: string | undefined,
  name: string,
  fallback: number,
): number {
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(
      `${name} must be an integer between 0 and 65535, got "${raw}".`,
    );
  }
  return port;
}

function parseNonNegativeInteger(
  raw: string | undefined,
  name: string,
  fallback: number,
): number {
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer, got "${raw}".`);
  }
  return value;
}

/**
 * Loads and validates companion configuration from environment variables.
 *
 * Never reads QODER_PERSONAL_ACCESS_TOKEN and never logs secret values.
 * Port 0 (the default) means the OS selects an available port at listen time.
 */
export function loadEnv(
  env: NodeJS.ProcessEnv = process.env,
  repositoryRoot = DEFAULT_REPOSITORY_ROOT,
): CompanionConfig {
  const host = env.ACCESSPATH_HOST ?? REQUIRED_HOST;
  if (host !== REQUIRED_HOST) {
    throw new Error(
      `ACCESSPATH_HOST must be ${REQUIRED_HOST}: the companion binds to the ` +
        "IPv4 loopback interface only.",
    );
  }

  const port = parsePort(env.ACCESSPATH_PORT, "ACCESSPATH_PORT", 0);
  const consolePort = parsePort(
    env.ACCESSPATH_DEV_CONSOLE_PORT,
    "ACCESSPATH_DEV_CONSOLE_PORT",
    5173,
  );
  if (consolePort === 0) {
    throw new Error("ACCESSPATH_DEV_CONSOLE_PORT must not be 0.");
  }
  const demoAidAppPort = parsePort(
    env.DEMO_AID_APP_PORT,
    "DEMO_AID_APP_PORT",
    4173,
  );
  const demoAgentInactivityTimeoutMs = parseNonNegativeInteger(
    env.ACCESSPATH_DEMO_AGENT_INACTIVITY_TIMEOUT_MS,
    "ACCESSPATH_DEMO_AGENT_INACTIVITY_TIMEOUT_MS",
    20_000,
  );
  const demoAgentHardTimeoutMs = parseNonNegativeInteger(
    env.ACCESSPATH_DEMO_AGENT_HARD_TIMEOUT_MS,
    "ACCESSPATH_DEMO_AGENT_HARD_TIMEOUT_MS",
    90_000,
  );
  if (demoAgentHardTimeoutMs < demoAgentInactivityTimeoutMs) {
    throw new Error(
      "ACCESSPATH_DEMO_AGENT_HARD_TIMEOUT_MS must be greater than or equal to ACCESSPATH_DEMO_AGENT_INACTIVITY_TIMEOUT_MS.",
    );
  }

  let artifactRoot: string;
  if (env.ACCESSPATH_ARTIFACT_ROOT !== undefined) {
    if (!path.isAbsolute(env.ACCESSPATH_ARTIFACT_ROOT)) {
      throw new Error("ACCESSPATH_ARTIFACT_ROOT must be an absolute path.");
    }
    artifactRoot = canonicalizePath(env.ACCESSPATH_ARTIFACT_ROOT);
  } else {
    // Directory creation is deferred to later phases.
    artifactRoot = canonicalizePath(path.join(os.homedir(), ".accesspath"));
  }

  const canonicalRepositoryRoot = canonicalizePath(repositoryRoot);
  if (isWithin(canonicalRepositoryRoot, artifactRoot)) {
    throw new Error(
      "ACCESSPATH_ARTIFACT_ROOT must remain outside the editable repository.",
    );
  }

  return {
    host,
    port,
    consolePort,
    artifactRoot,
    demoAidAppPort,
    demoAgentInactivityTimeoutMs,
    demoAgentHardTimeoutMs,
    nodeEnv: env.NODE_ENV ?? "development",
    launchToken: env.ACCESSPATH_LAUNCH_TOKEN,
  };
}
