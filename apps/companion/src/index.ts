import { pathToFileURL } from "node:url";
import { loadEnv } from "./env";
import { start, stop } from "./server";

export {
  createServer,
  getLaunchToken,
  start,
  stop,
  type ServerConfig,
  type StartConfig,
} from "./server";
export { loadEnv, type CompanionConfig } from "./env";

async function main(): Promise<void> {
  const config = loadEnv();
  const server = await start({ host: config.host, port: config.port });

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    await stop(server);
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// Only run when executed directly (tsx watch src/index.ts), not when imported by tests.
if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
