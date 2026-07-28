# Test Plan and Release Gates

## Test strategy

AccessPath is verified as a trajectory, not as a collection of rendered pages.
The release claim is:

> From a clean reset, AccessPath can observe a seeded task-path barrier, create
> a local Qoder repair in an isolated worktree, show the exact diff and tests,
> replay the same task, and export scoped evidence without changing the base
> checkout or leaking secrets.

Tests must preserve the distinction between:

- browser observation
- deterministic automated checks
- source diagnosis
- proposed change
- verified result
- remaining manual review

## Deterministic demo fixture

Application: fictional emergency financial assistance service.

Critical path:

```text
Check eligibility
  -> Create applicant profile
  -> Enter assistance details
  -> Review
  -> Submit test application
```

Use fictional data only. The submit action writes to in-memory fixture state
and displays a clearly labeled test confirmation.

### Seeded barriers

| ID | Affected action | Seed | Expected classification |
|---|---|---|---|
| AP-001 | Choose an eligibility option with a keyboard | Click-only custom option lacks keyboard semantics | Blocker, keyboard, selected demo repair |
| AP-002 | Enter a phone number efficiently | Missing appropriate autocomplete metadata | Moderate, cognitive/motor |
| AP-003 | Understand assistance type choices | Related controls lack a useful group label | Serious, screen-reader/cognitive |
| AP-004 | Recover from invalid review data | Error summary is not linked to fields and focus is not moved | Serious, keyboard/screen-reader |
| AP-005 | Know the test application was submitted | Confirmation is not announced as a status | Serious, screen-reader |

The runner may use a clearly recorded test-assist fallback after AP-001 so it
can inspect downstream steps. The report must show that the fallback was used
and must not call the unassisted path successful.

The primary repair changes AP-001 only. The after-run should show AP-001 as
resolved and AP-002 through AP-005 as remaining or manual-review-required.
This demonstrates calibrated scope instead of pretending one patch solved the
entire product.

## Test layers

### Contract tests

Package: `packages/contracts`

- valid fixtures parse
- invalid enums and missing required fields fail
- unknown major schema versions fail
- additive unknown fields are tolerated
- persisted and API forms round-trip
- exported contracts omit private path fields

### Audit engine unit tests

Package: `packages/audit-engine`

- target policy validation
- redirect validation
- task action resolution by role and name
- success predicate evaluation
- timeout and cancellation
- axe result normalization
- finding grouping by affected action
- redaction of console and network summaries
- partial bundle creation after failure

### Evidence unit tests

Package: `packages/evidence`

- stable finding IDs
- evidence labels remain distinct
- Barrier Map and linear data have equivalent content
- before/after classification
- integrity manifest hashing
- Markdown and HTML reports include limitations
- report generation from persisted artifacts only

### Git workspace unit and integration tests

Package: `packages/git-workspace`

- reject non-repository
- reject dirty base for MVP
- create branch and worktree
- canonicalize paths
- reject traversal, symlink, and junction escape
- detect changed files and produce diff
- preserve base branch and status
- safely remove only application-owned worktrees
- handle worktree name collision

Use temporary real Git repositories, not mocks, for lifecycle tests.

### Qoder runner tests

Package: `packages/qoder-runner`

Mock adapter:

- convert SDK messages to event envelopes
- persist session ID
- request approval for mutation
- deny out-of-scope paths
- deny unconfigured commands
- redact sensitive values
- interrupt a running turn
- create checkpoint metadata
- preview rewind before applying it

Live smoke test, excluded from normal CI:

- authenticate with a real Qoder account
- issue one read-only repository question
- stream a completed message
- perform one approved fixture edit in a disposable repository
- verify file checkpoint and interruption behavior

### Companion API tests

Application: `apps/companion`

- launch-token authentication
- origin and host checks
- audit and repair state transitions
- invalid-state conflict
- idempotency
- SSE ordering and reconnect
- duplicate event tolerance
- process timeout and full-tree termination
- artifact lookup authorization
- no absolute paths in public responses

### Console component tests

Application: `apps/console`

- audit form labels and error association
- keyboard path stepper
- graph/list equivalence
- finding selection
- permission request focus
- semantic diff navigation
- status text independent of color
- reconnect and stale-evidence states
- rewind warning and focus restoration
- live-region restraint

### End-to-end tests

Use Playwright to operate AccessPath itself.

Required flows:

1. Reset and start the demo fixture.
2. Create a local-target audit.
3. Run the path and identify AP-001 through AP-005.
4. Open AP-001 in Barrier Map and linear view.
5. Attach a disposable fixture repository.
6. Create a repair worktree.
7. Run the mock Qoder repair and stream events.
8. Review diff and test output.
9. Verify the after-run classification.
10. Preview rewind without applying it.
11. Export Markdown, HTML, and JSON evidence.

The live Qoder E2E is a manual release test because it requires credentials and
credits. The deterministic mock path remains available for CI and fallback.

## AccessPath accessibility tests

Automated:

- axe-core on every primary route
- no critical or serious automated violations
- semantic headings and landmarks
- form names and descriptions
- no duplicate IDs

Manual:

- full judging flow with keyboard only
- 200% zoom and 320 CSS pixel reflow
- Windows forced-colors mode
- reduced motion
- screen-reader smoke test for navigation, audit status, finding details,
  permission dialog, diff headings, and final report
- graph and linear representations contain equivalent findings and links

Record the screen reader, browser, operating system, and date.

## Security tests

Run every case listed in `SECURITY.md`, with emphasis on:

- public-mode private address and redirect denial
- localhost allowed only in explicit local mode
- cross-origin local API requests rejected
- base checkout unchanged
- Qoder write outside worktree denied
- non-allowlisted command denied
- secret redaction across logs, events, reports, and video assets

## Performance budgets

- console first interaction: under 2 seconds on demo machine
- SSE event visible: under 1 second from append
- Git diff refresh: under 1 second after file event
- deterministic audit: under 60 seconds
- mock repair and verification: under 90 seconds
- full live demo: under 4 minutes

Performance failures are release blockers only when they threaten the judging
flow.

## Required scripts

```json
{
  "scripts": {
    "dev": "start all required local applications",
    "lint": "lint all workspaces",
    "typecheck": "typecheck all workspaces",
    "test": "run unit and integration tests",
    "test:e2e": "run deterministic end-to-end tests",
    "test:security": "run target, path, API, redaction, and command policy tests",
    "test:a11y": "run automated accessibility checks against AccessPath",
    "demo:reset": "safely restore fixture and generated demo artifacts",
    "demo:verify": "run the deterministic judging path and validate outputs"
  }
}
```

## Release gates

### Gate A: Foundation

- clean install
- fixture starts
- lint, typecheck, and contract tests pass
- all expected scripts exist

### Gate B: Audit

- fixture barriers match AP-001 through AP-005
- screenshots and step evidence exist
- partial failures remain inspectable
- report states automated coverage limitations

### Gate C: Console

- Barrier Map and linear view are equivalent
- keyboard-only audit review succeeds
- no critical or serious axe issues in primary routes

### Gate D: Repair isolation

- dirty repository is rejected
- generated worktree is isolated
- base commit and status are unchanged
- out-of-scope edits and commands are denied

### Gate E: Qoder integration

- live or recorded SDK session shows streaming
- approval occurs before the first mutation
- Git diff matches worktree contents
- interruption and rewind preview work
- secrets are redacted

### Gate F: End-to-end

- audit to AP-001 repair to replay completes
- AP-001 becomes resolved
- remaining findings remain explicit
- configured tests pass
- evidence exports regenerate from persisted artifacts

### Gate G: Submission

- three uninterrupted live rehearsals
- deterministic fallback rehearsal
- fresh-machine setup rehearsal
- demo video and social post ready
- submission form completed before the internal deadline

## Definition of done

Run from a clean clone:

```powershell
npm install
npx playwright install chromium
npm run lint
npm run typecheck
npm run test
npm run test:security
npm run test:a11y
npm run test:e2e
npm run demo:reset
npm run demo:verify
```

All commands must pass twice consecutively before release. Any skipped live
Qoder test is recorded with the date and reason, then proven in a manual
rehearsal before submission.
