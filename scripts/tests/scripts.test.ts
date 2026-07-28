// Root script wiring and legacy placeholder behavior.
//
// Deliberately does NOT run test:e2e/test:security/test:a11y/demo:verify via
// npm — it invokes scripts/not-implemented.mjs directly with process.execPath
// (fixed executable, fixed args, no shell).
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const notImplementedScript = path.join(
  repoRoot,
  "scripts",
  "not-implemented.mjs",
);

const EXPECTED_SCRIPTS = [
  "dev",
  "lint",
  "typecheck",
  "test",
  "test:e2e",
  "test:security",
  "test:a11y",
  "test:qoder:live",
  "demo:reset",
  "demo:verify",
];

describe("root package.json scripts", () => {
  it("declares the Gate A scripts plus the explicit live Qoder gate", () => {
    const manifest = JSON.parse(
      readFileSync(path.join(repoRoot, "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };
    const names = Object.keys(manifest.scripts ?? {});
    expect(names.sort()).toEqual([...EXPECTED_SCRIPTS].sort());
    expect(manifest.scripts?.["demo:reset"]).toContain("demo-reset.ts");
    expect(manifest.scripts?.["demo:verify"]).toContain("demo-verify.ts");
  });
});

describe("scripts/not-implemented.mjs", () => {
  it("keeps legacy placeholder invocations explicitly nonzero", () => {
    const result = spawnSync(
      process.execPath,
      [notImplementedScript, "legacy-gate"],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(
      "legacy-gate: no implementation is wired to this placeholder",
    );
  });

  it("exits 2 with usage when no script name is given", () => {
    const result = spawnSync(process.execPath, [notImplementedScript], {
      encoding: "utf8",
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("usage:");
  });

});

describe("process launch policy", () => {
  it("does not use an interpolating shell in repository scripts", () => {
    for (const relativePath of [
      "scripts/dev.mjs",
      "scripts/lint.mjs",
      "scripts/typecheck.mjs",
    ]) {
      const source = readFileSync(path.join(repoRoot, relativePath), "utf8");
      expect(source).not.toMatch(/^\s*shell\s*:\s*true/m);
    }
  });
});
