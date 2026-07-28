import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { copyFile, mkdir, rm } from "node:fs/promises";
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
import {
  fixtureTaskContract,
} from "../apps/demo-aid-app/src/fixture-data";
import {
  p07MockEdits,
  p07MockWrites,
} from "./p07-repair-fixture";

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
await mkdir(join(repositoryRoot, "apps", "demo-aid-app", "public"), {
  recursive: true,
});
await mkdir(join(repositoryRoot, "apps", "demo-aid-app", "scripts"), {
  recursive: true,
});
await mkdir(join(repositoryRoot, "apps", "demo-aid-app", "tests"), {
  recursive: true,
});
for (const filename of ["index.html", "app.js", "styles.css"]) {
  await copyFile(
    resolve("apps", "demo-aid-app", "public", filename),
    join(repositoryRoot, "apps", "demo-aid-app", "public", filename),
  );
}
await copyFile(
  resolve("apps", "demo-aid-app", "scripts", "start-preview.mjs"),
  join(
    repositoryRoot,
    "apps",
    "demo-aid-app",
    "scripts",
    "start-preview.mjs",
  ),
);
await copyFile(
  resolve("apps", "demo-aid-app", "tests", "fixture-data.test.ts"),
  join(
    repositoryRoot,
    "apps",
    "demo-aid-app",
    "tests",
    "fixture-data.test.ts",
  ),
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
      "Replace the pointer-only AP-001 choices with native radios and add one focused regression test.",
    edits: p07MockEdits,
    writes: p07MockWrites,
    repairSummary:
      "Applied the approved AP-001 native-radio repair and regression test.",
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
    args: ["apps/demo-aid-app/scripts/start-preview.mjs"],
    cwdRelative: ".",
    timeoutMs: 120_000,
    category: "start",
  },
  testCommands: [
    {
      id: "verify-ap-001",
      label: "Verify AP-001",
      executable: process.execPath,
      args: ["apps/demo-aid-app/tests/ap001-repair.mjs"],
      cwdRelative: ".",
      timeoutMs: 5_000,
      category: "test",
    },
  ],
  previewUrl: `http://127.0.0.1:${fixturePort}/`,
  allowedPathGlobs: ["apps/demo-aid-app/**"],
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
  allowedPathGlobs: ["apps/demo-aid-app/**"],
  verification: {
    taskContract: {
      ...fixtureTaskContract,
      startUrl: `http://127.0.0.1:${fixturePort}/`,
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
          `<script>window.__ACCESSPATH_E2E_REPAIR_ID__=${JSON.stringify(repairId)};window.__ACCESSPATH_E2E_REPOSITORY_PATH__=${JSON.stringify(join(repositoryRoot, "apps", "demo-aid-app"))};</script></head>`,
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
