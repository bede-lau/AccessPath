import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const appEntry = path.join(
  repoRoot,
  "apps",
  "demo-aid-app",
  "src",
  "index.ts",
);
const healthEntry = path.join(
  repoRoot,
  "apps",
  "demo-aid-app",
  "scripts",
  "health.ts",
);
const resetEntry = path.join(
  repoRoot,
  "apps",
  "demo-aid-app",
  "scripts",
  "reset.ts",
);

async function reservePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("Could not reserve a fixture port.");
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return address.port;
}

function fixtureEnv(port: number): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    DEMO_AID_APP_PORT: String(port),
  };
}

async function waitForHealth(port: number): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // The process may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Fixture process did not become healthy.");
}

function runScript(entry: string, port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", entry], {
      cwd: repoRoot,
      env: fixtureEnv(port),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`Command exited ${code}: ${stderr || stdout}`));
      }
    });
  });
}

describe("demo fixture process commands", () => {
  let fixtureProcess: ChildProcess | undefined;

  afterEach(async () => {
    if (
      fixtureProcess === undefined ||
      fixtureProcess.exitCode !== null ||
      fixtureProcess.signalCode !== null
    ) {
      return;
    }
    fixtureProcess.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      fixtureProcess?.once("exit", () => resolve());
    });
    fixtureProcess = undefined;
  });

  it("starts, reports health, resets, and terminates cleanly", async () => {
    const port = await reservePort();
    fixtureProcess = spawn(process.execPath, ["--import", "tsx", appEntry], {
      cwd: repoRoot,
      env: fixtureEnv(port),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    await waitForHealth(port);

    await expect(runScript(healthEntry, port)).resolves.toMatch(
      /is ready with 5 seeded barriers/,
    );

    await fetch(`http://127.0.0.1:${port}/api/test-submissions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        eligibility: "yes",
        fullName: "Jordan Example",
        phone: "202-555-0148",
        assistanceTypes: ["housing"],
        fictionalDataConfirmed: true,
      }),
    });

    await expect(runScript(resetEntry, port)).resolves.toMatch(
      /0 in-memory submissions remain/,
    );
    const state = await fetch(`http://127.0.0.1:${port}/__fixture/state`).then(
      (response) => response.json(),
    );
    expect(state).toMatchObject({
      submissions: [],
      nextReference: "TEST-0001",
    });

    fixtureProcess.kill("SIGTERM");
    const exit = await new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve) => {
      fixtureProcess?.once("exit", (code, signal) => resolve({ code, signal }));
    });
    expect(
      exit.code === 0 || (exit.code === null && exit.signal === "SIGTERM"),
    ).toBe(true);
    fixtureProcess = undefined;

    await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow();
  });
});
