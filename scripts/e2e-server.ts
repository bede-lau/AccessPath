import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import {
  start as startCompanion,
  stop as stopCompanion,
} from "../apps/companion/src/index";
import {
  start as startFixture,
  stop as stopFixture,
} from "../apps/demo-aid-app/src/index";
import { createServer as createViteServer } from "vite";

const companionPort = 4801;
const fixturePort = 4174;
const consolePort = 5173;
const launchToken = randomBytes(32).toString("base64url");

process.env.ACCESSPATH_DEV_PROXY_PORT = String(companionPort);
process.env.VITE_ACCESSPATH_LAUNCH_TOKEN = launchToken;

const fixture = await startFixture(fixturePort);
const companion = await startCompanion({
  host: "127.0.0.1",
  port: companionPort,
  launchToken,
  artifactRoot:
    process.env.ACCESSPATH_ARTIFACT_ROOT ?? join(homedir(), ".accesspath"),
  editableRepositoryRoot: resolve("."),
  demoAidAppPort: fixturePort,
});
const consoleServer = await createViteServer({
  configFile: resolve("apps/console/vite.config.ts"),
  root: resolve("apps/console"),
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
  process.exit(0);
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

await new Promise<void>(() => undefined);
