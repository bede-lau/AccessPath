/* global clearInterval, process, setInterval */

import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const [mode, value] = process.argv.slice(2);

if (mode === "inspect") {
  process.stdout.write(
    JSON.stringify({
      argv: process.argv.slice(3),
      cwd: process.cwd(),
      env: process.env,
    }),
  );
} else if (mode === "exit") {
  process.stderr.write("fixture failure");
  process.exit(Number(value));
} else if (mode === "flood") {
  const chunk = "x".repeat(4096);
  const timer = setInterval(() => {
    process.stdout.write(chunk);
  }, 1);
  process.once("SIGTERM", () => {
    clearInterval(timer);
    process.exit(0);
  });
} else if (mode === "sleep") {
  setInterval(() => {}, 1000);
} else if (mode === "tree") {
  const markerPath = value;
  const grandchild = spawn(
    process.execPath,
    [fileURLToPath(import.meta.url), "grandchild", markerPath],
    {
      detached: false,
      stdio: "ignore",
      windowsHide: true,
    },
  );
  await writeFile(
    markerPath,
    JSON.stringify({ parentPid: process.pid, grandchildPid: grandchild.pid }),
  );
  setInterval(() => {}, 1000);
} else if (mode === "grandchild") {
  setInterval(() => {}, 1000);
} else {
  throw new Error(`Unknown fixture mode: ${mode}`);
}
