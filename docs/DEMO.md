# Demo Runbook

## Demo objective

In under four minutes, prove:

1. AccessPath audits a running web task without source-code access.
2. It shows the barrier as a failed human action with evidence.
3. A user can attach a local repository only when repair is requested.
4. Qoder performs the repair behind the custom AccessPath UI.
5. The user sees live activity, permissions, Git diff, and tests.
6. The same task is replayed and the result is scoped honestly.

## Locked scenario

Product under test: fictional emergency financial assistance application.

Critical task:

> A keyboard user checks eligibility, creates an applicant profile, enters
> assistance details, reviews the information, and submits a test application.

Selected barrier:

> AP-001: Keyboard users cannot choose an eligibility option.

Repair:

> Replace or repair the click-only custom option with native or complete
> keyboard-operable semantics, preserve visual behavior, and add a regression
> test.

## Preflight

Complete 30 minutes before judging:

```powershell
npm run demo:reset
npm run demo:verify
npm run dev
```

Confirm:

- console, companion, and fixture health checks pass
- Qoder authentication is valid
- browser and terminal zoom are readable on the display
- base repository is clean
- fallback report, diff, tests, and video are present
- notifications are disabled
- no tokens or personal paths are visible

Keep the AccessPath console on the audit setup screen.

## Target timing

| Time | Beat |
|---:|---|
| 0:00-0:25 | Problem and URL-only audit |
| 0:25-1:10 | Run task and expose Barrier Map |
| 1:10-1:35 | Explain evidence and remaining uncertainty |
| 1:35-2:40 | Attach repo and run Qoder repair |
| 2:40-3:25 | Review diff, tests, and replay |
| 3:25-3:50 | Evidence report, rewind preview, close |

## Live flow

### 1. Frame the problem

Say:

> Accessibility scanners return violations. AccessPath answers a more useful
> question: can someone complete the essential task?

Show the audit form already populated with the fixture URL and task. Point out
that no repository is attached.

### 2. Run the URL audit

Click `Run audit`.

As the step rail advances, say:

> The evidence comes from Playwright, axe-core, focus state, and the observed
> action. Qoder is not inventing browser facts.

The run should reach AP-001, record the keyboard failure, use the visible
test-assist fallback, and continue collecting downstream evidence.

### 3. Open the Barrier Map

Select AP-001.

Show:

- affected action
- attempted key operation
- observed result
- screenshot annotation
- relevant deterministic rule
- reproduction
- evidence label

Switch briefly to the linear view to prove the graph is not the only
representation.

Say:

> The barrier is attached to the user action, not buried under a rule ID.

### 4. Start local repair

Click `Repair in local workspace`.

Show:

- repository identity
- base commit
- generated worktree branch
- allowed path scope
- configured tests

Approve the read-only diagnosis. When the plan appears, point to its affected
files and non-goals, then click `Approve plan`.

Say:

> The AccessPath UI is the product surface. Qoder's Agent SDK is the repair
> engine, running only in this isolated local worktree.

### 5. Show Qoder activity

Let the timeline advance through Diagnose, Edit, and Verify.

Show one permission request or policy decision. Keep the raw log collapsed
unless a judge asks.

Open the diff:

- minimal component change
- regression test
- no unrelated files

Show Git status and the base-checkout integrity indicator.

### 6. Verify

Show passing targeted tests, then the replay comparison.

Expected:

- AP-001: resolved
- AP-002 through AP-005: remaining or manual review required
- task: completes under the configured keyboard path
- base checkout: unchanged

Say:

> AccessPath does not claim the whole site is compliant. It proves this
> observed barrier was repaired under the recorded conditions and keeps the
> remaining work visible.

### 7. Close with evidence

Open the evidence report summary and show:

- before and after
- changed files
- test result
- tested conditions
- residual findings
- Qoder provenance

Open `Rewind preview`, show the affected files and side-effect warning, then
cancel the dialog so the verified state remains.

Final line:

> AccessPath turns accessibility from a scanner backlog into an observable,
> Qoder-powered engineering loop.

## Qoder proof points for judges

Visible during the live demo:

- Qoder Agent SDK session status
- streamed agent and tool events
- permission broker
- Qoder session/checkpoint provenance
- live repair performed through AccessPath

Include in supporting material:

- screenshot of reviewed Qoder Spec
- screenshot or recording of Experts Mode task canvas
- screenshot of Goal completion card
- Qoder-generated changed-files review
- repository history showing Qoder build phases

## Fallback ladder

### Level 1: Live SDK delayed

Use a prewarmed live repair session paused before approval. Continue from plan
approval.

### Level 2: Qoder network unavailable

Switch to the recorded deterministic SDK event fixture. Label it clearly:
`Recorded live Qoder session replay`. Show the persisted session ID, diff, and
test artifacts from the real run.

### Level 3: Browser audit fails

Load the seeded audit bundle through `Demo fallback`. State that it is the
captured output of the same deterministic fixture and continue the repair.

### Level 4: Entire live environment fails

Play the under-four-minute demo video, then answer questions using the exported
HTML report, architecture diagram, and source repository.

Never imply a replay is live.

## Rehearsal checklist

- three uninterrupted live runs
- one no-network fallback run
- one keyboard-only run
- one fresh-clone setup run
- no personal notifications or paths
- no secret values
- narration under four minutes
- every click target visible at presentation resolution
- no scrolling through source to explain the core value

## Judge questions

### Is this just axe-core?

No. axe-core is one evidence source. The product models a reviewed critical
task, captures the exact failed action, groups evidence into a Barrier Map,
connects it to a local source repair, and replays the same path.

### Why does Qoder need the repository?

The audit does not. Source access is requested only for repair. Qoder then
runs locally in an isolated worktree so it can make and test a real patch.

### Why a custom UI instead of Qoder IDE?

The audience needs an accessibility workflow: affected actions, evidence,
approval, diff, replay, and residual risk. The official Qoder Agent SDK lets
AccessPath use Qoder's agent capabilities while presenting that domain-specific
workflow.

### Does a passing run prove WCAG compliance?

No. It proves only the documented task and configured checks passed. The report
preserves untested conditions and manual review.

### What prevents dangerous edits?

The repair uses a generated worktree, canonical path checks, tool and command
policy, explicit approval, Git-derived diffs, tests, and rewind preview. It
does not push, merge, or deploy.
