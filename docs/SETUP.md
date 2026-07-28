# Manual Setup

## Part 1: Create the Qoder workspace

The current handoff directory is documentation, not the application
repository. Create a fresh Git repository and place these files under `docs`.

PowerShell example:

```powershell
$Source = "C:\Users\bedel\OneDrive\Desktop\research_papers_brain\accesspath-qoder-handoff"
$Target = "C:\Users\bedel\OneDrive\Desktop\accesspath"

New-Item -ItemType Directory -Force $Target | Out-Null
New-Item -ItemType Directory -Force "$Target\docs" | Out-Null
Copy-Item "$Source\*" "$Target\docs" -Recurse -Force

Set-Location $Target
git init
git add docs
git commit `
  -m "Establish the implementation contract before code changes" `
  -m "Constraint: The Qoder workspace begins from a documentation-only handoff." `
  -m "Confidence: high" `
  -m "Scope-risk: narrow" `
  -m "Directive: Preserve the documented source-of-truth order while building." `
  -m "Tested: Documentation links and consistency checks" `
  -m "Not-tested: Application implementation does not exist yet"
```

Open `C:\Users\bedel\OneDrive\Desktop\accesspath` as the workspace root in
Qoder IDE. Wait for repository indexing to finish before the first Quest.

## Part 2: Prerequisites

Install:

- Qoder Desktop or another supported Qoder interface
- Git
- Node.js 20 LTS or newer
- npm included with Node
- Chromium through Playwright after dependencies exist

Verify:

```powershell
git --version
node --version
npm --version
```

Expected baseline:

```text
Node.js >= 20
Git >= 2.40
```

The Qoder Agent SDK supports Node.js 18 or newer, but AccessPath standardizes
on Node 20.

## Part 3: Qoder authentication

Use one supported method:

1. Existing `qodercli` login/session on the machine.
2. A Qoder personal access token in
   `QODER_PERSONAL_ACCESS_TOKEN`.

For a temporary PowerShell session:

```powershell
$env:QODER_PERSONAL_ACCESS_TOKEN = "<token>"
```

For local development, place non-secret configuration in `.env.local` and
keep the token outside committed files. Add all `.env*` variants except an
example file to `.gitignore`.

Never paste the token into Qoder prompts, screenshots, reports, or demo video.

Official references:

- `https://docs.qoder.com/en/cli/sdk/quick-start`
- `https://docs.qoder.com/en/cli/sdk/authentication`
- `https://docs.qoder.com/en/cli/sdk/permissions`

## Part 4: Expected environment files

Qoder should create:

```text
.env.example
.gitignore
.nvmrc
package.json
tsconfig.base.json
```

Suggested `.env.example`:

```dotenv
ACCESSPATH_HOST=127.0.0.1
ACCESSPATH_PORT=0
ACCESSPATH_ARTIFACT_ROOT=.accesspath
ACCESSPATH_LOG_LEVEL=info
QODER_PERSONAL_ACCESS_TOKEN=
DEMO_AID_APP_PORT=4174
```

The real token must never be required in client-side Vite variables.

## Part 5: Install and run the completed repository

After the scaffold phase:

```powershell
npm install
npx playwright install chromium
npm run dev
```

`npm run dev` should:

- start the emergency-aid fixture
- start the local companion on `127.0.0.1`
- start or serve the React console
- print the AccessPath URL
- perform health checks
- shut down all owned processes on exit

Open the printed AccessPath URL. Do not expose the companion to the LAN.

## Part 6: First smoke test

```powershell
npm run demo:reset
npm run lint
npm run typecheck
npm run test
npm run test:e2e
```

In the console:

1. Confirm `Local companion connected`.
2. Create an audit using the seeded emergency-aid fixture URL.
3. Select `Local or private target`.
4. Load the seeded task path.
5. Run the audit.
6. Confirm AP-001 through AP-005 appear.

## Part 7: Live Qoder SDK smoke test

Use a disposable test repository.

1. Validate Qoder authentication.
2. Start a read-only diagnosis.
3. Confirm streamed user-facing messages appear.
4. Confirm reads stay inside the disposable worktree.
5. Approve one small file edit.
6. Confirm Git diff matches the edit.
7. Interrupt a second turn.
8. Preview and apply file rewind.
9. Search logs and artifacts for the token.

Expose this as:

```powershell
npm run test:qoder:live
```

The command must skip with a clear message when no token or local Qoder
authentication is available. It must not silently pass.

## Part 8: Demo configuration

The repository should include a committed fixture configuration similar to:

```json
{
  "projectName": "Emergency Aid Demo",
  "targetPolicy": "local-explicit",
  "fixtureUrl": "http://127.0.0.1:4174",
  "taskContract": "fixtures/emergency-aid/task.json",
  "repositoryPath": "apps/demo-aid-app",
  "startCommandId": "demo-aid-app",
  "testCommandIds": ["demo-unit", "demo-e2e"]
}
```

Runtime absolute paths are resolved locally and excluded from export.

## Part 9: Reset and cleanup

`npm run demo:reset` must:

- stop owned fixture, preview, test, and SDK processes
- remove only demo-generated `.accesspath` audits and repairs
- remove only verified application-owned worktrees
- restore the committed seeded fixture state using a non-destructive fixture
  mechanism
- preserve unrelated files and user changes

The command must print every path it intends to remove and fail closed if a
resolved path leaves the repository.

## Part 10: Troubleshooting

### Qoder authentication required

- Check that the token exists only in the current environment.
- Run the minimal SDK smoke test.
- Reauthenticate using the supported Qoder CLI flow.
- Do not add bypass permissions.

### Playwright cannot find Chromium

```powershell
npx playwright install chromium
```

Confirm the package and browser versions are pinned by the lockfile.

### Port already in use

The companion should choose a random port. The fixture and preview managers
should either select another port or explain which configured process owns the
conflict.

### Repository is dirty

The MVP intentionally refuses repair. Commit, stash, or use a disposable clone
outside AccessPath, then validate again. AccessPath must never alter the dirty
base checkout.

### Event stream reconnecting

Refresh once. The console should reconnect using `Last-Event-ID` and replay
stored events. If it cannot, inspect the session `events.ndjson` and preserve
the run for diagnosis.

### Preview timed out

Check the configured start command, expected preview URL, and process output.
The finding remains `unverified`; do not mark it resolved from test output
alone.

## Fresh-machine checklist

- clone repository
- configure Qoder authentication
- `npm install`
- install Chromium
- run all validation commands
- run `demo:reset`
- complete the demo flow
- confirm base checkout remains clean
- confirm no secrets in `.accesspath`
