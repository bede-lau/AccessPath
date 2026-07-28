# Product Requirements Document

## Document status

- Product: AccessPath
- Status: Implementation-ready draft
- Target: Alibaba Cloud x Qoder Hackathon
- Submission deadline: August 5, 2026, 11:30 PM GMT+8
- Product type: Software-only web audit and local repair system

## Executive summary

Most accessibility tools scan pages and return rule violations. They do not
answer the operational question that matters most:

> Can a person complete the important task?

AccessPath audits a real browser journey, records where the task becomes
blocked, groups evidence around affected human actions, and produces a Barrier
Map. When the user owns the source code, they can attach a local Git repository
and start a Qoder-powered repair through the AccessPath interface. Qoder reads
the evidence, proposes a minimal patch, runs verification, and exposes every
tool action, code change, test result, approval, and rewind point.

The product does not promise automatic compliance. It is an evidence,
remediation, and verification workflow that leaves explicit space for human
accessibility review.

## Problem

### Existing workflow

1. A scanner reports dozens or hundreds of isolated violations.
2. Engineers struggle to map violations to user impact and source components.
3. Teams manually reproduce the issue.
4. Repairs are implemented without preserving the original evidence.
5. Passing automated checks are mistaken for complete accessibility.
6. Release managers lack a concise record of what changed and what remains.

### Consequences

- Critical task blockers are hidden among low-impact warnings.
- Accessibility work is treated as a late compliance exercise.
- Engineers spend time reproducing instead of repairing.
- Fixes are difficult to review and regress easily.
- Automated results overstate certainty.

## Product vision

AccessPath makes accessibility an observable engineering workflow:

```text
Task intent
  -> browser journey
  -> observed barrier
  -> evidence-backed diagnosis
  -> scoped local repair
  -> task replay
  -> reviewable evidence
```

## Primary users

### Accessibility lead

Needs to identify blocked journeys, inspect evidence, distinguish automated
coverage from human judgment, and export a release-ready audit record.

### Frontend engineer

Needs a minimal and explainable patch tied to a reproducible barrier, with
controlled file access, live diff review, tests, and rewind.

### QA or release manager

Needs to determine whether critical paths pass, which reviews remain pending,
and whether the patch is safe to release.

### Product owner or designer

Needs to understand affected user actions and residual risk without reading
raw accessibility rules or source code.

## Core jobs to be done

- When I have a deployed web flow, show me where an important user task fails.
- When a barrier is detected, explain the affected action before the rule ID.
- When I own the code, produce a minimal local repair without uploading the
  repository to AccessPath.
- When Qoder changes code, let me see what it is doing in real time.
- Before I accept a repair, rerun the same task and relevant regression tests.
- When automated coverage is insufficient, tell me what still requires human
  review.
- When I need evidence, export a readable before-and-after report.

## Product surfaces

### Audit Console

Accepts:

- Public HTTPS URL
- Staging or preview URL
- Localhost URL when the local companion is active
- Optional test credentials or authenticated session profile
- Critical task description
- Reviewable journey steps
- Test matrix and capture policy

Produces:

- Live task execution
- Step status
- Screenshots
- DOM and accessibility-tree evidence
- axe-core results
- Console and navigation diagnostics
- Barrier Map
- Structured audit artifact

### Barrier Map

Represents user actions as nodes and attempted transitions as edges. A barrier
is attached to the failed action or transition rather than presented as an
unrelated scanner warning.

Required modes:

- Journey
- Impact
- Repair
- Before-and-after comparison
- Linear accessible alternative

### Local Repair Companion

Runs on the developer machine and:

- Attaches an existing Git repository
- Creates an isolated worktree and branch
- Uses the Qoder Agent SDK with explicit tool scopes
- Streams agent, tool, task, diff, and test events
- Supports approval, rejection, pause, retry, and rewind
- Prevents automatic push, merge, or deployment

### Evidence Report

Contains:

- Audit identity
- Environment, branch, and commit
- Task-path status
- Findings grouped by human action
- Before and after evidence
- Source files changed
- Verification results
- Manual review still required
- Reviewer and approval history
- Residual risk and excluded coverage

## Functional requirements

### FR-1: Create an audit

The user can create an audit using a URL, task intent, and success condition.

Acceptance:

- URL is validated according to the selected public or local-explicit target
  policy.
- Task intent and success condition are required.
- The user can review and edit the generated journey plan before execution.

### FR-2: Execute a task path

The system executes an ordered browser journey with Playwright.

Acceptance:

- Every step has queued, running, passed, observation, blocked, skipped, or
  failed state.
- Evidence is associated with a specific step.
- A failed step does not erase evidence from earlier steps.
- The user can pause or stop a run.

### FR-3: Collect accessibility evidence

The audit captures automated and behavioral evidence.

Acceptance:

- axe-core runs at configured checkpoints.
- Keyboard operation can be replayed.
- Narrow viewport and zoom/reflow conditions can be selected.
- Screenshots and locator evidence are persisted.
- Automated and manual-review requirements remain distinguishable.

### FR-4: Build a Barrier Map

The system groups findings by affected action and task impact.

Acceptance:

- Critical path blockers appear before lower-impact issues.
- Severity is not communicated by color alone.
- Selecting a barrier opens evidence and reproduction details.
- The same information is available in an accessible linear representation.

### FR-5: Attach a local repository

The user can select a repository for repair.

Acceptance:

- Repository must be a valid Git worktree.
- The user selects the repository root and local start/test commands.
- The base branch and current commit are displayed.
- Uncommitted changes are detected before creating the repair worktree.
- The source repository is not uploaded.

### FR-6: Start a Qoder repair

The repair engine sends the barrier artifact and scoped repair brief to Qoder.

Acceptance:

- Qoder runs through the official Agent SDK.
- The session uses explicit working directory, tools, permissions, and agent
  roles.
- The initial prompt includes affected action, evidence, constraints, allowed
  files, non-goals, and tests.
- Source changes occur only in the isolated repair worktree.

### FR-7: Show live repair activity

The custom UI presents the Qoder-backed repair process.

Acceptance:

- Agent and tool events stream without reloading.
- File changes appear as Git diffs.
- Commands and test results are visible.
- Sensitive tokens and credential values are redacted.
- Generic chain-of-thought or hidden reasoning is never displayed.

### FR-8: Approve or reject tools and patches

The user controls sensitive operations.

Acceptance:

- Read-only actions can be pre-authorized.
- File edits and bounded test commands can use an explicit session policy.
- Out-of-scope paths, package installation, network access, Git push, and
  destructive commands require rejection or explicit approval.
- Patch hunks can be reviewed before final acceptance.

### FR-9: Verify the repair

The system reruns the failed task path and configured regression tests.

Acceptance:

- The original failed step passes or is explicitly marked unresolved.
- Previously passing task steps remain passing.
- Relevant project tests run.
- Results are tied to the repair commit or snapshot.
- Pending human review remains visible.

### FR-10: Rewind

The user can restore the worktree to a prior checkpoint.

Acceptance:

- A checkpoint exists before the first edit.
- Rewind lists affected files and invalidated test results.
- Rewind preserves evidence and adds a timeline event.
- Rewind never modifies the user base branch.

### FR-11: Export evidence

The user can export an accessible HTML or Markdown evidence bundle.

Acceptance:

- Export contains selectable text and semantic structure.
- Screenshots have descriptions.
- Before-and-after states are clearly labeled.
- Residual risk and excluded coverage are included.

### FR-12: Reset the demo

The fixture can return to a deterministic baseline.

Acceptance:

- One command restores the intentionally inaccessible code.
- Generated audits, worktrees, and evidence can be cleared safely.
- Reset never touches files outside the demo fixture and generated artifact
  directories.

## Non-functional requirements

### Accessibility

- AccessPath targets WCAG 2.2 AA.
- Full keyboard operation.
- Visible focus.
- Semantic landmarks and headings.
- No graph-only information.
- Reduced-motion support.
- Reflow at 320 CSS pixels.
- Forced-colors compatibility for essential states.

### Security

- Public-target mode blocks private, loopback, link-local, and metadata
  addresses after resolution and redirects.
- Local-target mode allows localhost only after an explicit user choice and
  never forwards the URL or captured evidence to a hosted service.
- Qoder credentials remain server-side or local.
- Repository paths are canonicalized.
- Symlink and path traversal are blocked.
- No automatic push, merge, deployment, or package publication.

### Performance

- Initial UI interaction within two seconds on the demo machine.
- Audit event latency below one second after event creation.
- Diff refresh within one second of a detected file change.
- The deterministic demo audit completes within 60 seconds.

### Reliability

- Event streams can reconnect using the last event ID.
- Run artifacts are append-only where practical.
- Partial audit results remain inspectable after failure.
- A Qoder session failure does not corrupt the source repository.

### Explainability

Every finding separates:

- Observed evidence
- Inferred diagnosis
- Proposed repair
- Verified result
- Remaining uncertainty

## MVP scope

### Included

- One demo application
- One critical application flow
- Five seeded accessibility or task-path barriers
- One public/staging/local URL audit
- Playwright browser execution
- axe-core integration
- Barrier Map and linear list
- Local Git repository attachment
- Qoder SDK repair session
- SSE activity stream
- Live Git diff
- Bounded test execution
- Approval and rewind
- Evidence export

### Excluded

- General-purpose autonomous browsing across arbitrary applications
- Native mobile applications
- Production session replay collection
- Continuous monitoring
- Organization accounts and billing
- Multi-user collaborative editing
- Browser extensions
- Runtime accessibility overlays
- Automated legal-compliance claims
- Automatic PR merge or deployment
- Real payment, healthcare, or government form submission

## Success metrics

### Demo success

- The audit identifies all seeded release-blocking barriers.
- At least one barrier is repaired through the AccessPath UI using Qoder.
- The original task replay passes after repair.
- The diff and test evidence are visible.
- The user can rewind and rerun.
- A complete evidence report is exported.

### Product-quality indicators

- Barrier precision on the fixture: 100%.
- No source change outside the approved worktree.
- No secret values in UI events or exported reports.
- Zero critical axe-core violations in AccessPath itself.
- Complete keyboard navigation for the judging flow.

## Judging narrative

### Use of Qoder

- The project is built in Qoder using Spec, Quest, Experts, and Goal workflows.
- The runtime repair plane embeds the official Qoder Agent SDK.
- Qoder subagents, permissions, streaming, skills, and checkpoints are
  demonstrated through a custom product interface.

### Innovation

- Task-path accessibility rather than isolated page scanning.
- Human-action Barrier Map.
- Qoder-backed closed-loop repair and verification.
- Explicit separation of evidence and uncertainty.

### Impact

- Essential web journeys are a clear and relatable problem.
- The before-and-after evidence card is understandable and shareable.
- URL-only audit lowers the barrier to participation.

### Technical execution

- Browser automation, accessibility analysis, event streaming, Git isolation,
  agent orchestration, code repair, and regression verification form one
  complete workflow.

### Presentation

- A visible blocked task becomes a visible verified repair.
- The live Qoder timeline and diff make the build technology undeniable.

## Product claim restrictions

Never say:

- Fully accessible
- WCAG compliant because all automated checks passed
- AI replaces disabled users or accessibility experts
- One repair guarantees compliance

Preferred language:

- The tested task path passed the configured automated and keyboard checks.
- Manual screen-reader review remains required.
- AccessPath reduced the observed barrier in this environment.
- This report covers the stated path, browser, viewport, and test conditions.
