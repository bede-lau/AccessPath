// ESLint 10 flat config for the AccessPath monorepo.
//
// Kept intentionally minimal: @eslint/js recommended + typescript-eslint
// recommended (NOT the type-checked variant, so lint stays fast and
// independent of tsconfig project resolution) plus no-restricted-imports
// boundary overrides that mirror scripts/check-boundaries.mjs at the
// import-statement level. No formatting rules.

import js from "@eslint/js";
import tseslint from "typescript-eslint";

const NODE_BUILTIN_RESTRICTIONS = [
  "node:*",
  "fs",
  "os",
  "path",
  "child_process",
  "http",
  "https",
  "net",
];

const ENGINE_PACKAGE_PATTERNS = [
  "@accesspath/audit-engine*",
  "@accesspath/evidence*",
  "@accesspath/git-workspace*",
  "@accesspath/qoder-runner*",
];

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "**/.vite/**",
      ".agents/**",
      ".codex/**",
      "package-lock.json",
    ],
  },

  // Base JS recommended for everything we lint (ts, tsx, mjs).
  {
    ...js.configs.recommended,
    files: ["**/*.{ts,tsx,mjs}"],
  },

  // typescript-eslint recommended (non-type-checked) for TS/TSX only.
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ["**/*.{ts,tsx}"],
  })),

  // Allow underscore-prefixed variables to be unused (common pattern in tests
  // where a variable is destructured just to prove a type compiles).
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },

  // scripts/**/*.mjs: plain Node ESM, js recommended only (no TS parser).
  // Declare the ambient Node globals these scripts use so no-undef stays on.
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        process: "readonly",
        console: "readonly",
        URL: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
      },
    },
  },

  // ---- boundary overrides (mirror scripts/check-boundaries.mjs) ----

  // apps/console: imports @accesspath/contracts + browser code only.
  {
    files: ["apps/console/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "fastify",
                "fastify/*",
                "@accesspath/companion*",
                ...ENGINE_PACKAGE_PATTERNS,
                "@accesspath/demo-aid-app*",
              ],
              message:
                "apps/console may import @accesspath/contracts and browser code only " +
                "(no fastify, no companion, no engine packages, no demo fixture).",
            },
            {
              group: NODE_BUILTIN_RESTRICTIONS,
              message:
                "apps/console is browser-only; Node built-ins are not available.",
            },
          ],
        },
      ],
    },
  },

  // EXCEPTION: vite.config.ts runs in Node — keep the boundary group but
  // drop the node:* / built-in restriction.
  {
    files: ["apps/console/vite.config.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "fastify",
                "fastify/*",
                "@accesspath/companion*",
                ...ENGINE_PACKAGE_PATTERNS,
                "@accesspath/demo-aid-app*",
              ],
              message:
                "apps/console/vite.config.ts may use Node, but the console " +
                "boundary (no fastify/companion/engines/demo fixture) still applies.",
            },
          ],
        },
      ],
    },
  },

  // apps/companion: backend — no frontend deps, no console, no demo fixture.
  {
    files: ["apps/companion/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@accesspath/console*",
                "@accesspath/demo-aid-app*",
                "react",
                "react-dom",
                "vite",
              ],
              message:
                "apps/companion must not import the console, the demo fixture, " +
                "or frontend tooling (react/react-dom/vite).",
            },
          ],
        },
      ],
    },
  },

  // apps/demo-aid-app: standalone fixture — no internal deps at all.
  {
    files: ["apps/demo-aid-app/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@accesspath/*"],
              message:
                "apps/demo-aid-app is a standalone fixture with no internal deps.",
            },
          ],
        },
      ],
    },
  },

  // The fixture's replay CLI is deliberately the only bridge into the audit
  // packages. It creates a source-side bundle for integration testing; all
  // other demo app code stays standalone.
  {
    files: [
      "apps/demo-aid-app/scripts/accesspath-replay.ts",
      "apps/demo-aid-app/tests/accesspath-replay.test.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@accesspath/*",
                "!@accesspath/audit-engine",
                "!@accesspath/contracts",
                "!@accesspath/evidence",
              ],
              message:
                "The demo replay integration may import only audit-engine, " +
                "contracts, and evidence.",
            },
          ],
        },
      ],
    },
  },

  // packages/contracts: isomorphic — zod only, no Node built-ins, no internals.
  {
    files: ["packages/contracts/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@accesspath/*",
                ...NODE_BUILTIN_RESTRICTIONS,
                "fastify",
                "react",
              ],
              message:
                "packages/contracts is isomorphic: zod is the only allowed " +
                "runtime dependency (no Node built-ins, no internals, no fastify/react).",
            },
          ],
        },
      ],
    },
  },

  // Engine packages: may import @accesspath/contracts only — no apps, no
  // sibling engines.
  {
    files: [
      "packages/audit-engine/**/*.{ts,tsx}",
      "packages/evidence/**/*.{ts,tsx}",
      "packages/git-workspace/**/*.{ts,tsx}",
      "packages/qoder-runner/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@accesspath/*", "!@accesspath/contracts"],
              message:
                "Engine packages may import only @accesspath/contracts " +
                "(no apps, no sibling engines).",
            },
          ],
        },
      ],
    },
  },
];
