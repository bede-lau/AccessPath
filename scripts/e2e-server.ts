import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import {
  start as startCompanion,
  stop as stopCompanion,
} from "../apps/companion/src/index";
import {
  start as startFixture,
  stop as stopFixture,
} from "../apps/demo-aid-app/src/index";
import {
  RepairManifestSchema,
  RepositoryConfigSchema,
} from "../packages/contracts/src/index";
import { DeterministicMockQoderAdapter } from "../packages/qoder-runner/src/index";
import { createServer as createViteServer } from "vite";

const companionPort = 4801;
const fixturePort = 4174;
const consolePort = 5173;
const launchToken = randomBytes(32).toString("base64url");
const execute = promisify(execFile);
const e2eRoot = join(homedir(), ".accesspath", "e2e-runtime");
const repositoryRoot = join(homedir(), ".accesspath", "e2e-repository");

process.env.ACCESSPATH_DEV_PROXY_PORT = String(companionPort);
process.env.VITE_ACCESSPATH_LAUNCH_TOKEN = launchToken;

await rm(e2eRoot, { recursive: true, force: true });
await rm(repositoryRoot, { recursive: true, force: true });
await mkdir(join(repositoryRoot, "src"), { recursive: true });
await mkdir(join(repositoryRoot, "tests"), { recursive: true });
await writeFile(
  join(repositoryRoot, "src", "eligibility.mjs"),
  [
    "export function activateEligibilityWithKeyboard() {",
    "  return false;",
    "}",
    "",
  ].join("\n"),
  "utf8",
);
await writeFile(
  join(repositoryRoot, "tests", "verify.mjs"),
  [
    "import { activateEligibilityWithKeyboard } from '../src/eligibility.mjs';",
    "",
    "if (activateEligibilityWithKeyboard() !== true) {",
    "  console.error('AP-001 remains unresolved');",
    "  process.exit(1);",
    "}",
    "",
    "console.log('AP-001 keyboard activation verified');",
    "",
  ].join("\n"),
  "utf8",
);
await execute("git", ["init", "-b", "main"], { cwd: repositoryRoot });
await execute("git", ["config", "user.name", "AccessPath E2E"], {
  cwd: repositoryRoot,
});
await execute("git", ["config", "user.email", "accesspath-e2e@example.invalid"], {
  cwd: repositoryRoot,
});
await execute("git", ["add", "."], { cwd: repositoryRoot });
await execute("git", ["commit", "-m", "Create inaccessible P06 fixture"], {
  cwd: repositoryRoot,
});
const { stdout: baseCommitOutput } = await execute(
  "git",
  ["rev-parse", "HEAD"],
  { cwd: repositoryRoot },
);
const baseCommit = baseCommitOutput.trim();

const fixture = await startFixture(fixturePort);
const companion = await startCompanion({
  host: "127.0.0.1",
  port: companionPort,
  launchToken,
  artifactRoot: e2eRoot,
  editableRepositoryRoot: resolve("."),
  demoAidAppPort: fixturePort,
  qoderAdapter: new DeterministicMockQoderAdapter({
    diagnosis:
      "Use the native keyboard activation path and preserve all unrelated behavior.",
    edits: [
      {
        filePath: "src/eligibility.mjs",
        oldText: "return false;",
        newText: "return true;",
      },
    ],
    repairSummary: "Applied the approved AP-001 keyboard repair.",
  }),
});

const repository = RepositoryConfigSchema.parse({
  repositoryPath: repositoryRoot,
  baseBranch: "main",
  baseCommit,
  startCommand: {
    id: "preview",
    label: "Preview",
    executable: process.execPath,
    args: ["src/eligibility.mjs"],
    cwdRelative: ".",
    timeoutMs: 5_000,
    category: "start",
  },
  testCommands: [
    {
      id: "verify-ap-001",
      label: "Verify AP-001",
      executable: process.execPath,
      args: ["tests/verify.mjs"],
      cwdRelative: ".",
      timeoutMs: 5_000,
      category: "test",
    },
  ],
  previewUrl: `http://127.0.0.1:${fixturePort}/`,
  allowedPathGlobs: ["src/**", "tests/**"],
});
const manifest = RepairManifestSchema.parse({
  schemaVersion: "1.0.0",
  id: "manifest-e2e-ap-001",
  auditBundleId: "bundle-e2e-ap-001",
  findingIds: ["AP-001"],
  affectedActions: ["Choose an eligibility option with a keyboard"],
  observations: ["Space did not activate the eligibility choice."],
  evidenceRefs: [],
  constraints: [
    "Change only the isolated worktree.",
    "Keep AP-002 through AP-005 intentionally present in the base fixture.",
  ],
  nonGoals: ["Do not change unrelated task behavior."],
  allowedPathGlobs: ["src/**", "tests/**"],
  verification: {
    taskContract: {
      schemaVersion: "1.0.0",
      id: "task-e2e-ap-001",
      title: "Emergency aid eligibility",
      goal: "Choose eligibility with a keyboard.",
      startUrl: `http://127.0.0.1:${fixturePort}/`,
      targetPolicy: "local-explicit",
      success: { visibleText: "Selected" },
      forbiddenActions: [],
      expectedSteps: [
        {
          id: "eligibility-choice",
          intent: "Choose an eligibility option with a keyboard",
          action: { kind: "press", key: "Space" },
          checkpoint: true,
        },
      ],
      fixtureValues: {},
      viewport: { width: 1280, height: 800 },
      timeoutMs: 10_000,
    },
    commands: repository.testCommands,
  },
});
const createdRepair = await companion.inject({
  method: "POST",
  url: "/api/repairs",
  headers: {
    authorization: `Bearer ${launchToken}`,
    origin: "http://127.0.0.1:5173",
  },
  payload: { repository, manifest },
});
if (createdRepair.statusCode !== 201) {
  throw new Error(`Unable to seed P06 repair: ${createdRepair.body}`);
}
const repairId = (createdRepair.json() as { repair: { id: string } }).repair.id;

const consoleServer = await createViteServer({
  configFile: resolve("apps/console/vite.config.ts"),
  root: resolve("apps/console"),
  plugins: [
    {
      name: "accesspath-e2e-repair-id",
      transformIndexHtml(html) {
        return html.replace(
          "</head>",
          `<script>window.__ACCESSPATH_E2E_REPAIR_ID__=${JSON.stringify(repairId)};</script></head>`,
        );
      },
    },
  ],
  server: {
    host: "127.0.0.1",
    port: consolePort,
    strictPort: true,
  },
});

await consoleServer.listen();

let closing = false;
const shutdown = async (): Promise<void> => {
  if (closing) {
    return;
  }

  closing = true;
  await Promise.allSettled([
    consoleServer.close(),
    stopCompanion(companion),
    stopFixture(fixture),
  ]);
  await rm(e2eRoot, { recursive: true, force: true });
  await rm(repositoryRoot, { recursive: true, force: true });
  process.exit(0);
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

await new Promise<void>(() => undefined);
