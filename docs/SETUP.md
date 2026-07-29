# Manual Setup

## What You Need

- Git 2.40 or newer
- Node.js 20.19 or newer, matching `.nvmrc`
- npm
- Playwright Chromium

Verify the local tools:

```powershell
git --version
node --version
npm --version
```

## Install

From the AccessPath repository root:

```powershell
npm install
npx playwright install chromium
```

Keep all generated evidence and repair worktrees outside the repository:

```powershell
$env:ACCESSPATH_ARTIFACT_ROOT = "$HOME\.accesspath\demo"
```

The variable is optional because AccessPath defaults to the same external
home-directory location. When set, it must be an absolute path outside the
editable repository.

## Start The Product

Reset only AccessPath-owned demo artifacts, then start all three application
shells:

```powershell
npm run demo:reset
npm run dev
```

`npm run dev` starts:

- the React console, normally `http://127.0.0.1:5173`
- the emergency-aid fixture, normally `http://127.0.0.1:4173`
- the local companion, normally `http://127.0.0.1:4801`

Use the exact URLs printed in the terminal if a configured port is already in
use. Keep the companion bound to loopback; do not expose it to the LAN.

## Full Interactive Demo

With `npm run dev` running:

1. Open the console URL.
2. Confirm `Companion ready`.
3. Keep `Local explicit` selected.
4. Review the seeded URL, task, success condition, and path.
5. Click `Run reviewed audit`.
6. Wait for `Open Barrier Map`, then open it.
7. Confirm AP-001 through AP-005 are present.
8. Select the first action containing AP-001.
9. Select the `repair` mode.
10. Enter the absolute path ending in `apps\demo-aid-app`.
11. Click `Attach and create repair`.
12. Click `Prepare worktree`.
13. Click `Run diagnosis`.
14. Review `Approve the repair plan`, then click `Approve once`.
15. Click `Start repair`.
16. Approve the two bounded file edits with `Approve once`.
17. Click `Verify patch`.
18. Confirm AP-001 is `resolved`.
19. Confirm AP-002 through AP-005 remain visible as `remaining`.
20. Download the HTML, Markdown, and JSON reports.
21. Click `Preview rewind` and inspect the affected files and warning.

The repair changes only the generated worktree under
`ACCESSPATH_ARTIFACT_ROOT\worktrees`. The base checkout must remain unchanged.

## Automated Verification

Run the complete local test matrix:

```powershell
npm run lint
npm run typecheck
npm run test
npm run test:security
npm run test:a11y
npm run test:e2e
```

The release proof is:

```powershell
npm run demo:reset
npm run demo:verify
npm run demo:reset
npm run demo:verify
```

`demo:verify` uses the deterministic mock Qoder adapter. It exercises the full
audit-to-repair-to-replay flow without credentials or live Qoder credits.

## Optional Live Qoder SDK Smoke

The real SDK smoke is separate from the complete demo. Use one supported
authentication method:

1. An existing local `qodercli` login/session.
2. A Qoder personal access token in `QODER_PERSONAL_ACCESS_TOKEN`.

For a temporary PowerShell session:

```powershell
$env:QODER_PERSONAL_ACCESS_TOKEN = "<token>"
npm run test:qoder:live
```

Run this at most once during a verification pass. The command exits nonzero
with a clear message when neither authentication method is available. That
external limitation does not block the mock-backed product demo.

Never place the token in a Vite variable, committed file, screenshot, report,
or demo recording.

## Troubleshooting

### The Latest Command Appears Frozen

`npm run dev` is a long-running process. Once it prints the console, fixture,
and companion URLs, leave that terminal open and use the product in the
browser. Stop it with `Ctrl+C` after the demo.

`npm run test:e2e` can be quiet while Chromium runs the full vertical slice.
Wait for its final Playwright summary. If it exceeds the configured timeout,
it exits nonzero rather than reporting success.

### Playwright Cannot Find Chromium

```powershell
npx playwright install chromium
```

### Port Already In Use

Stop the previous `npm run dev` process with `Ctrl+C`, or use the alternate
URLs printed by the new process. Do not run two demo stacks against the same
artifact root.

### Repository Is Dirty

The repair plane and `demo:verify` intentionally require a clean base checkout.
Commit the intended local changes or use a clean disposable clone. AccessPath
must never alter a dirty base checkout.

### Qoder Authentication Required

This only affects `npm run test:qoder:live`. Reauthenticate with `qodercli` or
set a temporary `QODER_PERSONAL_ACCESS_TOKEN`. Continue using the mock-backed
full demo when live credentials or credits are unavailable.

### Event Stream Reconnecting

The console reconnects with `Last-Event-ID` and replays durable events. If the
state does not recover, preserve the run for diagnosis and restart with
`npm run demo:reset`.

### Preview Timed Out

Check the configured start command, expected preview URL, and process output.
The finding remains unverified; do not mark it resolved from test output alone.

## Fresh-Machine Checklist

- clone the repository
- use Node matching `.nvmrc`
- `npm install`
- `npx playwright install chromium`
- set an external artifact root
- run the complete test matrix
- run `demo:reset` and `demo:verify` twice
- complete one keyboard-only interactive demo
- confirm the base checkout remains clean
- confirm no secrets or personal absolute paths appear in exported artifacts
