export {};

const rawPort = process.env.DEMO_AID_APP_PORT ?? "4173";
const port = Number(rawPort);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(
    `demo-aid-app health: DEMO_AID_APP_PORT must be an integer from 1 to 65535, got "${rawPort}".`,
  );
  process.exit(1);
}

try {
  const response = await fetch(`http://127.0.0.1:${port}/health`);
  if (!response.ok) {
    throw new Error(`fixture returned HTTP ${response.status}`);
  }
  const health = (await response.json()) as {
    status: string;
    fixtureId: string;
    barrierIds: string[];
  };
  if (
    health.status !== "ok" ||
    health.barrierIds.join(",") !== "AP-001,AP-002,AP-003,AP-004,AP-005"
  ) {
    throw new Error("fixture returned an unexpected health payload");
  }
  console.log(
    `demo-aid-app health: ${health.fixtureId} is ready with ${health.barrierIds.length} seeded barriers`,
  );
} catch (error) {
  console.error(
    "demo-aid-app health: fixture is not reachable on " +
      `http://127.0.0.1:${port} (${error instanceof Error ? error.message : "unknown error"})`,
  );
  process.exit(1);
}
