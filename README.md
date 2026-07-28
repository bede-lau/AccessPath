# AccessPath

AccessPath is a task-path accessibility auditor with a local Qoder-powered source repair companion — a hackathon project.

## Prerequisites

- Node.js 20.19+ (see [.nvmrc](.nvmrc))
- npm (workspaces are used; `engine-strict` is enabled)

## Quick start

```bash
npm install
npm run dev
```

## Verification

```bash
npm run lint
npm run typecheck
npm run test
```

## Current status

**P02 foundation** — audit/repair features land in P03–P07.

- `test:e2e`, `test:security`, `test:a11y`, and `demo:verify` intentionally
  print a not-implemented message and exit with status 2 until their phase.
- `demo:reset` is a safe no-op in P02.

## Documentation

See [docs/README.md](docs/README.md) for full documentation.
