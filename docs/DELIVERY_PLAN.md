# Delivery Plan

## Delivery window

- Start: Tuesday, July 28, 2026
- Organizer deadline: Wednesday, August 5, 2026, 11:30 PM GMT+8
- Internal submission deadline: Wednesday, August 5, 2026, 9:00 PM GMT+8
- Feature freeze: Monday, August 3, 2026, 8:00 PM GMT+8

The event page currently prints the year as 2025, but the event is named 2026,
the surrounding schedule is in 2026, and August 5, 2026 is a Wednesday.
Treat August 5, 2026 as the operative deadline and confirm inside the
registered-participant channel before final submission.

## Priority order

1. Deterministic audit evidence
2. Barrier Map and accessible linear view
3. Isolated Git worktree
4. Qoder SDK stream and controlled repair
5. Git diff and verification replay
6. Evidence export
7. Product accessibility and demo reliability
8. Submission reach and presentation

Do not trade items 1-6 for breadth, authentication, dashboards, or multiple
demo paths.

## Daily plan

### July 28: Freeze contracts and prove SDK access

- Finalize all handoff documents.
- Create the new AccessPath repository.
- Run the Qoder repository census.
- Generate and review the master Spec.
- Pin Node, package manager, browser, axe, and Qoder SDK versions.
- Prove one minimal Qoder SDK streaming request.

Exit:

- architecture and scope agree
- Qoder authentication works
- clean install strategy is known

### July 29: Foundation and fixture

- Scaffold npm workspaces.
- Implement shared schemas.
- Build the emergency-aid fixture.
- Seed AP-001 through AP-005.
- Add fixture reset and smoke tests.

Exit:

- Gate A passes
- fixture barriers are deterministic

### July 30: Audit vertical slice

- Implement target policy.
- Implement reviewed task contract runner.
- Capture screenshots, axe results, focus, and action outcomes.
- Normalize findings.
- Persist bundle and events.

Exit:

- Gate B passes
- AP-001 through AP-005 appear with stable IDs

### July 31: Console and Barrier Map

- Build audit setup and live audit.
- Build Barrier Map and synchronized linear view.
- Build finding evidence drawer/page.
- Add reconnection and failure states.

Exit:

- Gate C passes
- audit is understandable without raw rule output

### August 1: Repair isolation

- Validate repository.
- Create worktree and branch.
- Add diff and status service.
- Add process supervisor and configured commands.
- Build repair workspace shell.

Exit:

- Gate D passes
- base checkout remains unchanged

### August 2: Qoder repair and verification

- Integrate Qoder Agent SDK.
- Convert streaming messages to events.
- Enforce approvals and path/command policy.
- Add interruption and rewind preview.
- Run tests and preview from worktree.
- Replay task and compare findings.

Exit:

- Gate E passes
- one live Qoder repair works

### August 3: Full integration and feature freeze

- Complete audit-to-repair-to-report flow.
- Implement HTML, Markdown, and JSON export.
- Fix release-blocking integration failures.
- Freeze features at 8:00 PM GMT+8.

Exit:

- Gate F passes twice
- no stretch work remains on the critical branch

### August 4: Hardening and media

- Run security matrix.
- Complete keyboard, reflow, forced-colors, and screen-reader checks.
- Test fresh-machine setup.
- Record polished demo video and fallback clip.
- Draft social copy, diagrams, screenshots, and submission answers.

Exit:

- Gate G technical assets complete
- three uninterrupted rehearsals

### August 5: Submission only

- Morning: final release validation and secret scan.
- Noon: tag the release candidate; no architecture changes.
- 3:00 PM: publish or schedule social post.
- 6:00 PM: final live rehearsal.
- 9:00 PM: submit form.
- 9:00-11:30 PM: contingency for upload or organizer clarification only.

## Dependency graph

```text
Contracts
  -> Fixture
  -> Audit engine
  -> Evidence bundle
  -> Audit console
  -> Git worktree
  -> Qoder SDK host
  -> Diff and tests
  -> Preview replay
  -> Evidence report
  -> Demo and submission
```

Work may proceed in parallel only after the shared contract it depends on is
merged and verified.

## MVP and stretch

| MVP | Stretch after Gate F |
|---|---|
| One local product runtime | Hosted public audit adapter |
| One emergency-aid path | Multiple saved task templates |
| Chromium | Additional browsers |
| Reviewed deterministic steps | Natural-language browser planning |
| One repository and worktree | Concurrent repair sessions |
| One selected repair | Batch repair |
| Markdown, HTML, JSON export | Shareable hosted reports |
| Mock fallback plus live Qoder | Custom Qoder specialist agents |
| Patch review | Draft pull request |

## Risk register

| Risk | Trigger | Mitigation |
|---|---|---|
| Qoder SDK auth/version mismatch | Minimal request fails July 28 | Pin version, validate PAT and local auth, retain mock adapter |
| Audit evidence varies | Seeded IDs differ across runs | Pin Chromium and axe; avoid timing-sensitive UI |
| Agent makes broad refactor | Diff exceeds selected scope | One finding, path globs, plan approval, turn limit, rewind |
| Worktree harms source repo | Base status changes | Real-Git tests, canonical paths, clean-base gate |
| Preview fails to start | No URL within timeout | Configured command, health polling, full process cleanup |
| URL becomes unsafe | Redirect or DNS changes | Target policy before and during navigation |
| Demo internet fails | SDK or remote assets unavailable | Local fixture, cached dependencies, pre-recorded SDK fallback |
| Credits run low | Experts tasks consume budget | Experts for cross-stack phases; Agent for bounded work |
| Accessibility tool overclaims | Copy implies compliance | Claim restrictions and manual-review section |
| Submission reach is weak | Social post delayed | Publish early August 5; prepare assets August 4 |

## Change control

After feature freeze, changes are allowed only for:

- release-blocking correctness
- security or secret leakage
- broken setup
- inaccessible judging path
- demo timing or reliability
- submission content

Every late code change requires the affected targeted test plus `demo:verify`.

## Stop conditions

Stop adding features when Gate F passes. Stop changing the release candidate
when Gate G passes and the submission assets point to the tagged commit.
