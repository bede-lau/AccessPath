export {};

const rawPort = process.env.DEMO_AID_APP_PORT ?? "4173";
const port = Number(rawPort);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(
    `demo-aid-app reset: DEMO_AID_APP_PORT must be an integer from 1 to 65535, got "${rawPort}".`,
  );
  process.exit(1);
}

try {
  const response = await fetch(`http://127.0.0.1:${port}/__fixture/reset`, {
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`fixture returned HTTP ${response.status}`);
  }
  const result = (await response.json()) as {
    state: {
      fixtureId: string;
      submissions: unknown[];
    };
  };
  console.log(
    `demo-aid-app reset: ${result.state.fixtureId} restored; ` +
      `${result.state.submissions.length} in-memory submissions remain`,
  );
} catch (error) {
  console.error(
    "demo-aid-app reset: fixture is not reachable on " +
      `http://127.0.0.1:${port} (${error instanceof Error ? error.message : "unknown error"})`,
  );
  process.exit(1);
}
