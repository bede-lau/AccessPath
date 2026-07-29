# AccessPath

AccessPath is a task-path accessibility auditor with a local Qoder-powered
source repair companion.

## Prerequisites

- Node.js 20.19+ (see `.nvmrc`)
- npm
- Git
- Playwright Chromium

## Quick Start

```powershell
npm install
npx playwright install chromium
$env:ACCESSPATH_ARTIFACT_ROOT = "$HOME\.accesspath\demo"
npm run demo:reset
npm run dev
```

Open the console URL printed by `npm run dev`, normally
`http://127.0.0.1:5173`. The emergency-aid fixture and local companion start
with it.

## Verification

```powershell
npm run lint
npm run typecheck
npm run test
npm run test:security
npm run test:a11y
npm run test:e2e
npm run demo:reset
npm run demo:verify
```

## Current Status

**P07 MVP complete.** The local demo covers URL audit, Barrier Map, isolated
repair, replay, evidence exports, and rewind preview.

- The full automated demo uses the deterministic mock Qoder adapter and does
  not consume live Qoder credits.
- `npm run test:qoder:live` is the optional real-SDK smoke test. It requires
  `QODER_PERSONAL_ACCESS_TOKEN` or a local `qodercli` session and exits nonzero
  when neither is available.
- Generated evidence and worktrees stay under the absolute
  `ACCESSPATH_ARTIFACT_ROOT`, outside the editable repository.

## Documentation

See `docs/SETUP.md` for setup and `docs/DEMO.md` for the exact presentation
flow.
