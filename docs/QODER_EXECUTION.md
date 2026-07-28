# Exact Qoder Execution Sequence

## Why this sequence

Use Qoder in three deliberate ways:

1. **Spec-driven** for new product surfaces and contracts.
2. **Experts Mode** for work that crosses UI, API, browser, Git, SDK, and tests.
3. **Goal mode** only after the end state is measurable and the architecture is
   stable.

Agent Mode is more efficient for one bounded package or review. Experts Mode
is appropriate for medium-to-large cross-stack work. Spec creates a reviewed
blueprint; Goal autonomously iterates toward a verifiable result.

Do not start with Goal on. That would give a broad autonomous objective before
the repository, security boundary, and fixture behavior are established.

Official references:

- `https://docs.qoder.com/user-guide/quest/spec-driven`
- `https://docs.qoder.com/user-guide/quest/experts-mode`
- `https://docs.qoder.com/user-guide/quest/goal-driven`

## Before the first Quest

1. Complete Part 1 of `SETUP.md`.
2. Open the new AccessPath repository as the Qoder workspace root.
3. Wait for indexing.
4. Confirm the handoff files are under `docs/`.
5. Keep the base branch clean.
6. Open `PROMPTS.md` beside Qoder.

Create a **new Quest for every numbered phase** below. This keeps each Spec,
changed-file set, and review boundary inspectable.

## Toggle vocabulary

- **Mode: Agent** means select Agent Mode in Quest.
- **Mode: Experts** means select Experts Mode in Quest.
- **Spec: On** means click `+` in the input box and enable Spec before sending.
- **Goal: On** means enable Goal before sending, or enable Goal on a reviewed
  Spec card before clicking Build where explicitly stated.
- **Build later** means review and annotate the generated Spec first. Do not
  click Build until the acceptance criteria and exclusions are correct.

## Universal operating procedure

For each implementation Quest:

1. Select the listed mode.
2. Set Spec and Goal exactly as listed.
3. Paste the matching prompt from `PROMPTS.md`.
4. Manually answer clarifying questions when they affect scope, security,
   architecture, or user behavior.
5. For Spec tasks, review requirements, design, tasks, exclusions, tests, and
   rollback behavior.
6. Annotate omissions directly on the Spec.
7. Click Build only after the Spec matches the handoff.
8. Monitor the task list and correct scope drift immediately.
9. Review changed files and test output.
10. Run the phase exit commands yourself in Qoder's terminal.
11. Commit the verified phase. Do not push until the release plan calls for it.

## Sequence summary

| Phase | Quest mode | Spec | Goal | Prompt |
|---:|---|---|---|---|
| 0 | Outside Quest | Off | Off | Workspace bootstrap in `SETUP.md` |
| 1 | Agent | Off | Off | P00 Repository census |
| 2 | Experts | On | Off | P01 Master implementation Spec |
| 3 | Experts | On | Off | P02 Foundation and contracts |
| 4 | Agent | On | Off | P03 Emergency-aid fixture |
| 5 | Agent | On | Off | P04 Audit engine |
| 6 | Experts | On | Off | P05 Audit console and Barrier Map |
| 7 | Experts | On | Off | P06 Local repair plane |
| 8 | Experts | On | On at Build | P07 Integrated vertical slice |
| 9 | Experts | Off | Off | P08 Read-only security and architecture review |
| 10 | Agent | On | Off | P09 Release-blocking fixes |
| 11 | Agent | Off | On | P10 Test and security closure |
| 12 | Agent | Off | Off | P11 Demo polish |
| 13 | Agent | Off | On | P12 Final release closure |

## Phase 1: Repository census

**Documents:** all handoff documents
**Mode:** Agent
**Spec:** Off
**Goal:** Off
**Prompt:** P00

Expected output:

- repository map
- detected environment
- proposed commands
- missing prerequisites
- contradictions
- implementation risks

No file edits.

Proceed only when Qoder has correctly identified that the current repository
contains documentation but no application implementation.

## Phase 2: Master implementation Spec

**Documents:**

- `README.md`
- `PRD.md`
- `DECISIONS.md`
- `ARCHITECTURE.md`
- `DESIGN.md`
- `API_CONTRACTS.md`
- `SECURITY.md`
- `TEST_PLAN.md`
- `DELIVERY_PLAN.md`

**Mode:** Experts
**Spec:** On
**Goal:** Off
**Prompt:** P01

Important:

- Generate the Spec.
- Review and annotate it.
- Do **not** click Build for the full master Spec.
- Download or preserve the reviewed Spec as
  `docs/QODER_MASTER_SPEC.md` if Qoder provides export.

The master Spec is an execution map; subsequent smaller Specs build it in
reviewable phases.

## Phase 3: Foundation and contracts

**Documents:** decisions, architecture, API contracts, security, test plan
**Mode:** Experts
**Spec:** On
**Goal:** Off
**Prompt:** P02

Review the Spec, then click Build.

Exit:

```powershell
npm install
npm run lint
npm run typecheck
npm run test
```

At this phase, `test` may contain only contract and scaffold tests, but it must
be real and passing.

## Phase 4: Emergency-aid fixture

**Documents:** PRD, design, test plan, demo
**Mode:** Agent
**Spec:** On
**Goal:** Off
**Prompt:** P03

This is bounded to `apps/demo-aid-app`, fixture contracts, and its tests.

Exit:

- AP-001 through AP-005 are deterministic
- fixture supports reset
- no real submission or personal data
- fixture has its own passing tests around intended non-barrier behavior

Commit the intentionally inaccessible baseline. Do not "fix" the seeded
barriers during fixture construction.

## Phase 5: Audit engine

**Documents:** architecture, API contracts, security, test plan, research basis
**Mode:** Agent
**Spec:** On
**Goal:** Off
**Prompt:** P04

Bounded primarily to:

- `packages/audit-engine`
- `packages/evidence`
- relevant `packages/contracts`
- tests

Exit:

- known fixture findings are stable
- failure produces a partial bundle
- public/local target policies pass tests
- no Qoder or Git dependency exists in the audit engine

## Phase 6: Audit console and Barrier Map

**Documents:** PRD, design, API contracts, test plan
**Mode:** Experts
**Spec:** On
**Goal:** Off
**Prompt:** P05

Experts Mode is appropriate because this phase spans React, Fastify routes,
SSE, evidence transforms, accessibility, and E2E validation.

Exit:

- audit setup to report works
- graph and linear views are equivalent
- keyboard judging flow works
- primary routes have no critical or serious axe issues

## Phase 7: Local repair plane

**Documents:** decisions, architecture, API contracts, security, test plan,
setup
**Mode:** Experts
**Spec:** On
**Goal:** Off
**Prompt:** P06

This phase includes:

- repository validation
- isolated worktree
- Qoder Agent SDK host
- permission broker
- SSE events
- Git diff
- configured commands
- interruption
- checkpoint and rewind preview

Exit:

- mock adapter tests pass
- one live SDK smoke test succeeds
- base checkout remains unchanged
- out-of-scope access is denied

## Phase 8: Integrated vertical slice

**Documents:** all canonical and operational documents
**Mode:** Experts
**Spec:** On
**Goal:** Off while generating and reviewing the Spec
**Prompt:** P07

Procedure:

1. Generate the integration Spec.
2. Review it carefully.
3. Confirm it adds no stretch features.
4. On the approved Spec card, turn **Goal On**.
5. Click Build.

This is the first Goal use. At this point the contracts and packages exist, and
the Goal has a precise end state: one complete audit-to-repair-to-replay flow.

Exit:

```powershell
npm run demo:reset
npm run demo:verify
```

Do not accept Goal completion based only on Qoder's self-report. Read the
commands, results, diff, and generated evidence.

## Phase 9: Read-only security and architecture review

**Documents:** decisions, architecture, API contracts, security, test plan
**Mode:** Experts
**Spec:** Off
**Goal:** Off
**Prompt:** P08

Require a findings-first report with file references and severity. No edits.

Classify each finding:

- release blocker
- post-freeze fix
- accepted limitation
- false positive

## Phase 10: Release-blocking fixes

**Documents:** P08 review output plus affected canonical documents
**Mode:** Agent
**Spec:** On
**Goal:** Off
**Prompt:** P09

Generate a narrow fix Spec from only accepted release blockers. Review, then
Build.

Exit:

- each accepted finding has a targeted regression test
- no unrelated refactor
- demo path still passes

## Phase 11: Test and security closure

**Documents:** security and test plan
**Mode:** Agent
**Spec:** Off
**Goal:** On
**Prompt:** P10

Goal is appropriate because the end state is measurable and iterative.

Keep the Goal turn budget bounded. Pause if it proposes architectural changes
or stretch features.

Exit:

- mandatory commands pass twice consecutively
- secret scan passes
- base checkout remains unchanged after demo repair
- all owned processes terminate cleanly

## Phase 12: Demo polish

**Documents:** design, demo, submission
**Mode:** Agent
**Spec:** Off
**Goal:** Off
**Prompt:** P11

This is a bounded polish pass. No architecture, schema, dependency, or feature
changes.

Exit:

- three uninterrupted rehearsals
- under four minutes
- keyboard-only rehearsal
- fallback ladder works

## Phase 13: Final release closure

**Documents:** PRD, test plan, demo, submission
**Mode:** Agent
**Spec:** Off
**Goal:** On
**Prompt:** P12

Use this only after feature freeze. The Goal may fix release-blocking failures
but may not add features.

Exit:

- release commands pass twice
- demo and fallback artifacts exist
- repository is clean
- release commit/tag candidate identified
- submission checklist has no technical blocker

## Shortened emergency sequence

If fewer than three build days remain:

1. P00: Agent, Spec Off, Goal Off.
2. P01: Experts, Spec On, Goal Off; review master Spec.
3. Use `MASTER BUILD PROMPT`: Experts, Spec On, Goal On only after reviewing
   the generated Spec.
4. P08: Experts, Spec Off, Goal Off.
5. P09: Agent, Spec On, Goal Off.
6. P11: Agent, Spec Off, Goal Off.
7. P12: Agent, Spec Off, Goal On.

Cut stretch features before cutting test evidence, isolation, the Qoder runtime
integration, or the demo path.

## What to capture for submission

Save screenshots or short clips of:

- master Spec requirements/design/tasks/acceptance
- annotations or revisions before Build
- Experts Mode team canvas
- phase task lists
- changed-files review
- Goal progress and completion
- the AccessPath runtime Qoder timeline and permission request
- final diff, tests, replay, and evidence report

These artifacts make primary Qoder usage visible against the 30% judging
criterion.
