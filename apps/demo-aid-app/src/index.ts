import { pathToFileURL } from "node:url";
import type { AddressInfo } from "node:net";
import { start, stop } from "./server";

export { createDemoServer, start, stop } from "./server";
export {
  BARRIER_IDS,
  expectedFindingManifest,
  FIXTURE_ID,
  fixtureTaskContract,
} from "./fixture-data";
export {
  InMemoryFixtureStore,
  parseTestSubmission,
  type FixtureState,
  type StoredTestSubmission,
  type TestSubmissionInput,
} from "./fixture-state";

async function main(): Promise<void> {
  const server = await start();
  const { address, port } = server.address() as AddressInfo;
  console.log(`demo-aid-app listening on http://${address}:${port}/`);

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
