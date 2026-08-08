// Root Vitest 4 config: one project per workspace plus a "scripts" project,
// so `vitest run` from the root discovers every test suite and nothing else.
import { defineConfig } from "vitest/config";
import { resolve } from "path";

// Force consistent root path with lowercase drive letter on Windows
// to prevent Node.js ESM module duplication from casing differences.
const ROOT = resolve(".").replace(/^[A-Z]:/, (m) => m.toLowerCase());
const TEST_TIMEOUT = 60_000;
const HOOK_TIMEOUT = 30_000;

/** Node-environment project rooted at a workspace directory. */
function nodeProject(name: string, root: string) {
  return {
    test: {
      name,
      root,
      environment: "node" as const,
      include: ["tests/**/*.test.ts"],
      hookTimeout: HOOK_TIMEOUT,
      testTimeout: TEST_TIMEOUT,
    },
  };
}

export default defineConfig({
  root: ROOT,
  test: {
    hookTimeout: HOOK_TIMEOUT,
    maxWorkers: 4,
    projects: [
      nodeProject("contracts", "./packages/contracts"),
      nodeProject("audit-engine", "./packages/audit-engine"),
      nodeProject("evidence", "./packages/evidence"),
      nodeProject("git-workspace", "./packages/git-workspace"),
      nodeProject("qoder-runner", "./packages/qoder-runner"),
      nodeProject("companion", "./apps/companion"),
      nodeProject("demo-aid-app", "./apps/demo-aid-app"),
      {
        test: {
          name: "console",
          root: "./apps/console",
          environment: "jsdom",
          include: ["tests/**/*.test.{ts,tsx}"],
          hookTimeout: HOOK_TIMEOUT,
          testTimeout: TEST_TIMEOUT,
        },
      },
      {
        test: {
          name: "scripts",
          root: ".",
          environment: "node",
          include: ["scripts/tests/**/*.test.ts"],
          hookTimeout: HOOK_TIMEOUT,
          testTimeout: TEST_TIMEOUT,
        },
      },
    ],
  },
});
