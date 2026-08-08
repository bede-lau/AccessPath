// Development orchestrator: runs companion, demo-aid-app fixture, and console
// concurrently with prefixed output. Ctrl+C (SIGINT/SIGTERM) or any child
// failing tears the whole tree down.
//
// Child processes use direct Node entry points and a minimal environment.

import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// DEV-ONLY PORT WIRING:
// - The companion prefers 4801, the fixture prefers 4173, and the console
//   prefers 5173.
// - When a preferred default is occupied, the next free loopback port is used.
// - Explicit ACCESSPATH_DEV_* overrides fail closed when unavailable.
// - The selected companion port is injected into the Vite /api proxy.
// This is a development-only convenience; the product security/runtime default
// remains ACCESSPATH_PORT=0 (OS-selected port). Do NOT promote this fixed port
// to a runtime default.
function parsePort(value, label) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${label} must be an integer from 1 to 65535.`);
  }
  return port;
}

function isPortAvailable(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", (error) => {
      if (error.code === "EADDRINUSE" || error.code === "EACCES") {
        resolve(false);
        return;
      }
      reject(error);
    });
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      server.close((error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }
        resolve(true);
      });
    });
  });
}

async function resolveDevelopmentPort(environmentKey, defaultPort) {
  const configured = process.env[environmentKey];
  if (configured !== undefined) {
    const port = parsePort(configured, environmentKey);
    if (!(await isPortAvailable(port))) {
      throw new Error(
        `${environmentKey}=${port} is unavailable on 127.0.0.1.`,
      );
    }
    return port;
  }

  for (let port = defaultPort; port < defaultPort + 20; port += 1) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(
    `No free loopback port was found from ${defaultPort} through ${defaultPort + 19}.`,
  );
}

let DEV_COMPANION_PORT;
let DEV_DEMO_AID_APP_PORT;
let DEV_CONSOLE_PORT;
try {
  [DEV_COMPANION_PORT, DEV_DEMO_AID_APP_PORT, DEV_CONSOLE_PORT] =
    await Promise.all([
      resolveDevelopmentPort("ACCESSPATH_DEV_COMPANION_PORT", 4801),
      resolveDevelopmentPort("ACCESSPATH_DEV_DEMO_AID_APP_PORT", 4173),
      resolveDevelopmentPort("ACCESSPATH_DEV_CONSOLE_PORT", 5173),
    ]);
  if (
    new Set([
      DEV_COMPANION_PORT,
      DEV_DEMO_AID_APP_PORT,
      DEV_CONSOLE_PORT,
    ]).size !== 3
  ) {
    throw new Error("The development services must use different ports.");
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[dev] ${message}\n`);
  process.exit(1);
}

const DEV_LAUNCH_TOKEN = randomBytes(32).toString("base64url");
const DEV_SANDBOX_IMAGE =
  process.env.ACCESSPATH_SANDBOX_IMAGE ??
  (() => {
    const inspected = spawnSync(
      "docker",
      [
        "image",
        "inspect",
        "accesspath-sandbox:local",
        "--format",
        "{{.Id}}",
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
        windowsHide: true,
      },
    );
    const imageId = inspected.stdout?.trim();
    return inspected.status === 0 && /^sha256:[a-f0-9]{64}$/i.test(imageId)
      ? imageId
      : undefined;
  })();

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
const NPM_DEV_ARGS = ["run", "dev:worker"];
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
      ACCESSPATH_DEV_CONSOLE_PORT: DEV_CONSOLE_PORT,
      ACCESSPATH_LAUNCH_TOKEN: DEV_LAUNCH_TOKEN,
      DEMO_AID_APP_PORT: DEV_DEMO_AID_APP_PORT,
      ...(DEV_SANDBOX_IMAGE === undefined
        ? {}
        : { ACCESSPATH_SANDBOX_IMAGE: DEV_SANDBOX_IMAGE }),
    },
    forwardEnv: [
      "ACCESSPATH_ARTIFACT_ROOT",
      "ACCESSPATH_HOST",
      "ACCESSPATH_SANDBOX_IMAGE",
      "AGENT_PROVIDER",
      "QODER_PERSONAL_ACCESS_TOKEN",
      "OPENAI_API_KEY",
      "OPENAI_BASE_URL",
      "OPENAI_MODEL",
      "QWEN_API_KEY",
      "QWEN_BASE_URL",
      "QWEN_MODEL",
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
      ACCESSPATH_DEV_CONSOLE_PORT: DEV_CONSOLE_PORT,
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
    `(port ${DEV_DEMO_AID_APP_PORT}), console (port ${DEV_CONSOLE_PORT})` +
    (DEV_SANDBOX_IMAGE === undefined
      ? "\n"
      : `, sandbox ${DEV_SANDBOX_IMAGE.slice(0, 19)}...\n`),
);
