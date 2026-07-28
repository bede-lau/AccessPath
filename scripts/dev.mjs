// Development orchestrator: runs companion, demo-aid-app fixture, and console
// concurrently with prefixed output. Ctrl+C (SIGINT/SIGTERM) or any child
// failing tears the whole tree down.
//
// Child processes use direct Node entry points and a minimal environment.

import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// DEV-ONLY PORT WIRING:
// - ACCESSPATH_PORT=4801 is injected into the companion child so it listens on
//   a knowable port during local development.
// - ACCESSPATH_DEV_PROXY_PORT=4801 is injected into the console child so the
//   Vite /api proxy targets that same companion port.
// - DEMO_AID_APP_PORT=4173 is injected into the demo-aid-app fixture child.
// This is a development-only convenience; the product security/runtime default
// remains ACCESSPATH_PORT=0 (OS-selected port). Do NOT promote this fixed port
// to a runtime default.
const DEV_COMPANION_PORT =
  process.env.ACCESSPATH_DEV_COMPANION_PORT ?? "4801";
const DEV_DEMO_AID_APP_PORT =
  process.env.ACCESSPATH_DEV_DEMO_AID_APP_PORT ?? "4173";
const DEV_LAUNCH_TOKEN = randomBytes(32).toString("base64url");

// Fixed constant commands only — one consistent npm-based approach for all
// three children. Each child runs its own workspace "dev" script from the
// workspace cwd.
function resolveNpmCli() {
  const candidates = [
    process.env.npm_execpath,
    path.join(
      path.dirname(process.execPath),
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js",
    ),
  ].filter(Boolean);
  const npmCli = candidates.find((candidate) => fs.existsSync(candidate));
  if (npmCli === undefined) {
    throw new Error("Unable to locate npm-cli.js for the development runner.");
  }
  return npmCli;
}

const NPM_CLI = resolveNpmCli();
const NPM_DEV_ARGS = ["run", "dev"];
const BASE_ENV_KEYS = [
  "APPDATA",
  "ComSpec",
  "HOME",
  "LOCALAPPDATA",
  "NODE_ENV",
  "NODE_OPTIONS",
  "Path",
  "PATH",
  "PATHEXT",
  "SystemRoot",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "WINDIR",
];

function pickEnvironment(keys) {
  const result = {};
  for (const key of keys) {
    if (process.env[key] !== undefined) {
      result[key] = process.env[key];
    }
  }
  return result;
}

const CHILDREN_SPECS = [
  {
    name: "companion",
    cwd: path.join(repoRoot, "apps", "companion"),
    env: {
      ACCESSPATH_PORT: DEV_COMPANION_PORT,
      ACCESSPATH_LAUNCH_TOKEN: DEV_LAUNCH_TOKEN,
      DEMO_AID_APP_PORT: DEV_DEMO_AID_APP_PORT,
    },
    forwardEnv: [
      "ACCESSPATH_ARTIFACT_ROOT",
      "ACCESSPATH_HOST",
      "QODER_PERSONAL_ACCESS_TOKEN",
    ],
  },
  {
    name: "demo-aid-app",
    cwd: path.join(repoRoot, "apps", "demo-aid-app"),
    env: { DEMO_AID_APP_PORT: DEV_DEMO_AID_APP_PORT },
    forwardEnv: [],
  },
  {
    name: "console",
    cwd: path.join(repoRoot, "apps", "console"),
    env: {
      ACCESSPATH_DEV_PROXY_PORT: DEV_COMPANION_PORT,
      VITE_ACCESSPATH_LAUNCH_TOKEN: DEV_LAUNCH_TOKEN,
    },
    forwardEnv: [],
  },
];

/** Pipes a child stream to ours, prefixing every complete line. */
function prefixStream(stream, target, prefix) {
  let pending = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) {
      target.write(`${prefix} ${line}\n`);
    }
  });
  stream.on("end", () => {
    if (pending !== "") {
      target.write(`${prefix} ${pending}\n`);
    }
  });
}

const children = [];
let shuttingDown = false;
let exitCode = 0;

function killAll() {
  for (const { name, child } of children) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    if (process.platform === "win32") {
      // Kill the whole process tree; npm shims spawn nested processes on
      // Windows. Fixed executable and fixed args; the PID is a number produced
      // by our own spawn call, not external input. No shell involved.
      spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
        stdio: "ignore",
      });
    } else {
      child.kill("SIGTERM");
    }
    process.stderr.write(`[dev] stopped ${name}\n`);
  }
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  exitCode = code;
  killAll();
}

for (const spec of CHILDREN_SPECS) {
  const child = spawn(process.execPath, [NPM_CLI, ...NPM_DEV_ARGS], {
    cwd: spec.cwd,
    env: {
      ...pickEnvironment([...BASE_ENV_KEYS, ...spec.forwardEnv]),
      ...spec.env,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  prefixStream(child.stdout, process.stdout, `[${spec.name}]`);
  prefixStream(child.stderr, process.stderr, `[${spec.name}]`);

  child.on("error", (error) => {
    process.stderr.write(`[dev] failed to start ${spec.name}: ${error.message}\n`);
    shutdown(1);
  });

  child.on("exit", (code, signal) => {
    const detail = signal !== null ? `signal ${signal}` : `code ${code}`;
    process.stderr.write(`[dev] ${spec.name} exited (${detail})\n`);
    if (shuttingDown) {
      maybeExit();
      return;
    }
    // First non-zero exit wins; a clean child exit also stops the others so
    // the orchestrator never lingers half-alive.
    shutdown(typeof code === "number" && code !== 0 ? code : 0);
    maybeExit();
  });

  children.push({ name: spec.name, child });
}

function maybeExit() {
  const allDone = children.every(
    ({ child }) => child.exitCode !== null || child.signalCode !== null,
  );
  if (shuttingDown && allDone) {
    process.exit(exitCode);
  }
}

// Clean Ctrl+C is a normal way to leave dev mode → exit 0.
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

process.stdout.write(
  `[dev] starting companion (port ${DEV_COMPANION_PORT}), demo-aid-app ` +
    `(port ${DEV_DEMO_AID_APP_PORT}), console (Vite dev server)\n`,
);
