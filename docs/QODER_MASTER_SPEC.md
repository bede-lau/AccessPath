# AccessPath Master Implementation Spec (Phase 2 / P01) — Revision 2

Spec-only deliverable per QODER_EXECUTION.md Phase 2 and PROMPTS.md P01. Review and annotate; do NOT click Build for this master Spec. Subsequent smaller Specs (P02–P07) build it incrementally. Preserve the reviewed Spec as `docs/QODER_MASTER_SPEC.md` if export is available.

## Amendment List (Revision 2)

1. **Qoder auth timing**: before P06, validate only that a PAT (`QODER_PERSONAL_ACCESS_TOKEN`) or supported local authentication is available; the pinned SDK install and first live streaming smoke test execute during P06 (§0, §9 P06 row, §13.3).
2. **Dependency boundaries**: console imports shared contracts and client utilities only; companion orchestrates packages; applications never import another application's implementation; console never imports Fastify or companion server code (§3).
3. **Worktree location**: `ACCESSPATH_ARTIFACT_ROOT` defined as an absolute, canonical, application-owned runtime directory; repair worktrees are never nested inside the editable base checkout; cleanup requires an ownership marker plus resolved-path validation (§3, §6, §11).
4. **Event persistence**: durable semantic events and completed agent messages persist; `agent.message.delta` and other high-frequency display deltas may remain transient; SSE reconnection reconstructs authoritative state without relying on token deltas (§5, §13.5).
5. **Task authorship**: deterministic seeded emergency-aid TaskContract template loaded; user may review and edit URL, intent, success condition, and steps; no unrestricted LLM-generated browser planning (§2, §7, §13.8).
6. **Demo repository**: attachment may begin from `apps/demo-aid-app`; the actual Git top-level directory is resolved and recorded; the worktree is created from that repository; AP-001 repair scope restricted to `apps/demo-aid-app/**` and its tests (§7, §9 P07).
7. **Public root README**: minimal version created during P02; P11 polishes it for submission (§0, §9 P02/P11, §13.4).
8. **Command-denial wording**: "disk formatting or system-volume formatting" replaces generic "formatting"; approved project code-formatting commands remain allowed (§6).

All other requirements, exclusions, phases, test gates, security boundaries, and demo conditions are preserved unchanged.

## 0. Governing Rules and Applied P00 Resolutions

**Document precedence on conflict** (PROMPTS.md universal header): DECISIONS.md > PRD.md > ARCHITECTURE.md > SECURITY.md > API_CONTRACTS.md > DESIGN.md > TEST_PLAN.md > operational docs.

**P00 census resolutions (authoritative overrides):**
- Kebab-case `RepairState` identifiers in API_CONTRACTS.md are the canonical persisted and API values: `configuring`, `preparing`, `diagnosing`, `awaiting-plan-approval`, `editing`, `paused`, `verifying`, `awaiting-patch-approval`, `approved`, `completed`, `rejected`, `failed`, `cancelled`. Human-facing UI labels may use ordinary sentence formatting (e.g. "Await plan approval").
- Node.js 20+ is the standard runtime (overrides SETUP.md "18 or newer"). P02 must create explicit version config: `.nvmrc`, `package.json` `engines.node: ">=20"`, and enforce via `npm config engine-strict` or CI check.
- **Qoder authentication timing (amended)**: before P06, validate only that a PAT or supported local Qoder authentication is *available* (presence/readability check, no SDK call). The pinned `@qoder-ai/qoder-agent-sdk` is installed and the first live streaming smoke test is executed **during P06**. Nothing blocks this specification phase.
- Public root `README.md` is an implementation/submission deliverable separate from `docs/README.md` (handoff doc). **A minimal public root README.md is created during P02; P11 polishes it for submission.**

## 1. MVP Definition and Explicit Exclusions

**Product**: Task-path accessibility auditor (URL-only, Playwright + axe-core) plus local Qoder-powered source repair companion, delivered as a local-first TypeScript modular monolith (D-019).

**MVP includes** (PRD scope): one emergency-aid fixture app; one critical path (Check eligibility → Create applicant profile → Enter assistance details → Review → Submit test application, D-015); five seeded barriers AP-001–AP-005; public/local-explicit URL audit; Barrier Map + equivalent linear view (D-013); local Git repository attachment; Qoder Agent SDK repair session (D-003) in an isolated worktree (D-008); SSE activity stream (D-009); live Git diff; bounded test execution; approval broker and rewind; HTML/Markdown/JSON evidence export; one-command demo reset.

**Explicitly excluded** (PRD + DECISIONS): general-purpose autonomous browsing; native mobile apps; production session-replay collection; continuous monitoring; org accounts/billing; multi-user editing; browser extensions; runtime accessibility overlays (D-011); automated legal-compliance claims (D-012); automatic PR merge/deploy/push (D-008); real payment/healthcare/government submissions; database/ORM/migrations (D-007); hosted public audit backend (deferred adapter, D-019); embedded IDE UI (D-004); unrestricted LLM-generated browser planning (task authorship is template-seeded and user-reviewed, see §2); second task path before the vertical slice is verified (D-015).

## 2. User Journeys and UI Routes

**Journeys**: (a) URL-only audit → Barrier Map review → evidence export (no repo, no Qoder auth); (b) audit → attach repo → Qoder repair of AP-001 → verification replay → export; (c) rewind preview/apply; (d) demo reset.

**Task authorship (amended)**: audit setup loads a deterministic seeded emergency-aid TaskContract template. The user reviews and may edit the start URL, task intent, success condition, and expected steps before locking the contract for execution. Unrestricted LLM-generated browser planning is not implemented in the MVP.

**Routes** (DESIGN.md): audit setup; `/audits/:auditId/live` (path rail, evidence stage, findings queue); `/audits/:auditId/barrier-map` (Journey | Impact | Repair | Compare modes + synchronized linear alternative); `/repairs/:repairId` (context strip; evidence/brief left; diff/file center; verification ledger + agent timeline right); evidence export; settings. All states designed: loading, empty, paused, blocked, failed, partial, completed, disconnected, stale-evidence.

## 3. Architecture: Local-First Modular Monolith

**Topology**: React console → Fastify companion API (127.0.0.1, random port, bearer launch token) → audit orchestrator (isolated Playwright Chromium + axe-core) and repair orchestrator (Git worktree manager, Qoder SDK host, test/preview manager) → file artifact store (D-007) rooted at `ACCESSPATH_ARTIFACT_ROOT`.

**Two logical planes** (D-001): Audit plane is repository-independent and holds no Qoder credentials. Repair plane attaches a repo only on explicit user request; all mutations occur in generated worktrees under the artifact root.

**Dependency boundaries (amended, enforced by lint rule/tsconfig references):**
- `apps/console` may import `packages/contracts` and shared client-side utilities ONLY. It must never import Fastify, `apps/companion` server code, or any other application's implementation.
- `apps/companion` orchestrates the packages (`contracts`, `audit-engine`, `evidence`, `git-workspace`, `qoder-runner`).
- Applications never import another application's implementation (`console` ↛ `companion` ↛ `demo-aid-app`, in any direction). Cross-app interaction happens exclusively through the REST/SSE API contracts.
- Package dependency direction remains: `contracts` ← engine packages ← `companion`; `console` ← `contracts` (+ client utilities).

**Package/app responsibilities:**
- `packages/contracts`: versioned Zod schemas (`schemaVersion: "1.0.0"`), derived TS types, state enums (kebab-case canonical), event envelope, error codes, artifact manifests. Additive fields tolerated within a major version; unknown major versions rejected; every boundary parses.
- `packages/audit-engine`: target policy validation, Playwright context lifecycle (fresh per run), TaskContract execution (role/name-based actions, success predicates), bounded recorded test-assist fallback, checkpoint evidence (screenshot, focus, action outcome, axe, console summary, failed requests), finding normalization grouped by affected human action (D-006), AuditBundle persistence, cancellation/timeout/partial bundles. No Git or Qoder knowledge.
- `packages/evidence`: observations → human-action findings, Barrier Map data + linear equivalence, before/after FindingComparison, SHA-256 integrity manifests, Markdown/HTML/JSON reports regenerable solely from persisted contracts + artifacts.
- `packages/git-workspace`: repo validation (including resolving the actual Git top-level directory from any path inside it), clean-base requirement, branch/worktree lifecycle under the artifact root, canonical-path + symlink/junction escape rejection, status/diff/snapshots, ownership-verified worktree removal. Git output is authoritative over SDK checkpoints.
- `packages/qoder-runner`: SDK auth and session lifecycle (`@qoder-ai/qoder-agent-sdk`, pinned and installed in P06), streamed message → AccessPathEvent conversion, tool policy broker, approval requests, file checkpointing, session-ID persistence, interruption, rewind preview/apply. Mock adapter for CI; separately invoked live smoke test.
- `apps/companion` (Fastify): REST routes, SSE with Last-Event-ID replay, state-machine enforcement with idempotency keys and one active transition lock per session, process supervision (timeout + full-tree kill), redaction, artifact authorization, orchestration.
- `apps/console` (React + Vite): all UI surfaces, WCAG 2.2 AA, keyboard-only operation, Lucide icons, no chain-of-thought display (D-004).
- `apps/demo-aid-app`: fictional emergency financial assistance fixture with seeded AP-001–AP-005, deterministic reset, in-memory submission only.

**Artifact store and worktree location (amended)**: define `ACCESSPATH_ARTIFACT_ROOT` as an absolute, canonical, application-owned runtime directory (resolved and canonicalized at companion startup; validated via env config in P02). Layout: `<ACCESSPATH_ARTIFACT_ROOT>/audits/<id>/{session.json, events.ndjson, bundle.json, artifacts/<sha256>.<ext>, report.md, report.html}`; `<root>/repairs/<id>/{session.json, events.ndjson, manifest.json, approvals.json, tests.json, comparison.json}`; `<root>/worktrees/<repair-id>/`; `<root>/config.json`. **Generated repair worktrees must never be nested inside the editable base checkout.** Every generated worktree contains an application ownership marker file; cleanup requires both the ownership marker AND resolved-path validation that the target lies under `<root>/worktrees/` before removal. Content-addressed artifacts (SHA-256), append-only NDJSON events, relative paths only in exports.

## 4. State Machines (Canonical)

**Audit** (`AuditState`): `draft → ready → running ⇄ paused → completed | blocked | failed | cancelled`; `blocked → ready` on task revision. Step states: `queued → running → passed | observation | blocked | skipped | failed`. Every terminal run persists a bundle (partial evidence + failure diagnostic on non-completion). Failed steps never erase prior evidence.

**Repair** (`RepairState`, kebab-case canonical): `configuring → preparing → diagnosing → awaiting-plan-approval → editing ⇄ paused → verifying → awaiting-patch-approval → approved → completed`; `rejected` from approval states; `failed` from preparing/diagnosing/editing/verifying; `cancelled` from any pre-terminal state. Invariants: worktree created in `preparing`; `diagnosing` is strictly read-only; checkpoint exists before first edit; every mutation preceded by an approval event; verification replays the ORIGINAL TaskContract against the worktree preview URL. Rewind (in editing/approved): preview first (affected files, stale verification IDs, non-file side-effect warning) → explicit confirmation → apply + timeline event. Transitions enforced at mutation; invalid commands fail with `INVALID_STATE`/`409 CONFLICT` without side effects.

## 5. Data and SSE Contracts

Implement exactly as API_CONTRACTS.md: shared primitives (`EvidenceLabel` with `observed | deterministic-check | inferred | proposed | verified | manual-review-required | unsupported`; `Severity`; `ArtifactRef` with sha256 + sensitivity `public|project|redacted`); `TaskContract`/`TaskInstruction`; audit entities (`AuditSession`, `TaskStepResult`, `Finding` with `affectedAction`, `AuditBundle` with integrity manifest); repair entities (`RepositoryConfig`, `CommandSpec` as executable + args array, `RepairManifest` with constraints/nonGoals/allowedPathGlobs, `RepairSession`); approval contracts (`ApprovalRequest`, `ApprovalDecision` approve-once/approve-session/deny, `Checkpoint`, `RewindPreview`); verification (`TestResult`, `FindingComparison` beforeState always `"open"`, afterState `resolved|remaining|regressed|unverified`, `VerificationRun`).

**REST surface**: system (`/api/health`, `/api/config/public`, `/api/auth/qoder/validate`); audits (create/get/patch/start/pause/resume/cancel/bundle/report?format=html|markdown|json); repositories/repairs (validate/create/get/prepare/diagnose/start/pause/resume/cancel/diff/verify/report); approvals + rewind; `GET /api/sessions/:sessionId/events` (SSE) and `GET /api/artifacts/:artifactId`.

**Events and persistence (amended)**: 30 event types per API_CONTRACTS.md within `AccessPathEvent<T>` envelope (monotonic pre-allocated sequence, IDs allocated before append). Persistence policy:
- **Durable**: all semantic events (phase/state changes, step results, findings, artifacts, tool lifecycle, approvals, file/diff, test start/complete, checkpoints, rewind, verification, session lifecycle) and **completed agent messages** (`agent.message.completed`) are appended to NDJSON.
- **Transient**: `agent.message.delta` and other high-frequency display deltas may remain UI-only and are NOT required in the durable log.
- **Reconnect**: SSE reconnection via `Last-Event-ID` replays persisted durable events after the given sequence and MUST reconstruct authoritative session state without relying on token deltas; consumers deduplicate by eventId. High-volume test output is chunked and linked to a final artifact.

Error codes exactly as enumerated (`INVALID_TARGET`, `PATH_ESCAPE`, `COMMAND_DENIED`, etc.); errors never contain tokens, cookies, raw form values, or absolute paths.

## 6. Security Boundaries and Controls

**Trust boundary matrix** (ARCHITECTURE.md): console owns presentation/decisions, never shell/Git/Qoder token/filesystem; companion owns state machines/policy/sequencing, never unbounded agent autonomy; browser worker owns navigation/screenshots/axe, never repository or Qoder credentials; Qoder host owns SDK session + approved tools, never base checkout or unrelated paths; git-workspace owns worktrees/diffs, never diagnosis; artifact store owns evidence + hashes, never raw secrets.

**Local companion**: bind 127.0.0.1 only; random port; per-launch high-entropy bearer token delivered via URL fragment; Origin/Host validation; narrow CORS allowlist; `Cache-Control: no-store` on sensitive responses.

**Target URL policy**: Public mode — HTTPS only, resolve DNS before navigation, reject loopback/private/link-local/multicast/unspecified/cloud-metadata ranges (IPv4+IPv6), revalidate every redirect and DNS result, reject embedded credentials, deny `file:`/`data:`/`javascript:`/custom protocols, bounded redirects/response size/navigation time. Local-explicit mode — requires deliberate user selection; permits `http://localhost`/loopback/explicit private hosts; nothing uploaded.

**Browser isolation**: fresh Chromium context per run; no downloads/extensions/permission grants; popup and disallowed-protocol blocking; storage cleared after run; stop on real payment, CAPTCHA, MFA, destructive actions.

**Prompt-injection boundary**: repair prompts built only from validated RepairManifest (normalized findings, approved reproduction, artifact refs, constraints, non-goals) — never raw page text as instructions; quoted content marked as evidence; agent output can never widen permissions; host policy overrides prompt requests. Use runtime prompts A/B/C from PROMPTS.md generated from the validated manifest.

**Qoder permission tiers** (D-016): pre-authorized — read/list/search inside worktree, read approved evidence, read Git status/diff. Brokered — edits matching approved path globs, exact configured commands (start/test/lint/typecheck/build). Explicit approval — new commands, package install, network, dependency changes, files outside globs, destructive category. Always denied — worktree escape, permission bypass, Git push/remote mutation/merge/deploy, credential-store access, browser cookies, OS settings.

**Command policy (amended wording)**: executable + args array only (no shell strings); allowlist by category; cwd under worktree; timeout + environment allowlist; no output redirection to arbitrary paths; full owned-process-tree termination on timeout/cancel; reject tokens/executables for filesystem deletion outside known directories, **disk formatting or system-volume formatting**, system shutdown, credential access, remote shells/tunnels, Git remote mutation, package publishing, process injection. **Approved project code-formatting commands (e.g. configured lint/format scripts) remain allowed** under the brokered command tiers.

**Path safety (amended)**: canonicalize every requested/reported path; reject `..`, symlink and Windows-junction escapes; base checkout never editable; worktrees live only under `<ACCESSPATH_ARTIFACT_ROOT>/worktrees/` and are never nested inside the editable base checkout; removal requires the application ownership marker AND resolved-path validation that the target is under the artifact root's worktree directory.

**Secrets/redaction**: Qoder credentials from `QODER_PERSONAL_ACCESS_TOKEN` or supported local auth, never persisted; minimal env passed to child processes; redact authorization headers, cookies, query tokens, passwords, form values, secret patterns, and absolute paths from logs, events, and exports before user visibility; fixture uses fictional data only; release secret scan over source, artifact root, reports, demo media.

**Approval integrity**: record request ID, kind, exact paths/command, consequence, risk, decision, timestamp, session scope; approvals never reusable for different commands, widened paths, or later sessions.

## 7. Emergency-Aid Fixture (AP-001–AP-005)

Fictional emergency financial assistance form (D-014); path per D-015; fictional values, in-memory submission, clearly labeled test confirmation. **The fixture ships a deterministic seeded TaskContract template that the audit setup loads for user review/editing (§2).** Seeded barriers with stable, isolated, documented test hooks:

| ID | Affected action | Seed | Severity/modality | Role |
|---|---|---|---|---|
| AP-001 | Choose eligibility option with keyboard | Click-only custom option lacks keyboard semantics | Blocker, keyboard | Selected demo repair |
| AP-002 | Enter phone number efficiently | Missing autocomplete metadata | Moderate, cognitive/motor | Remaining |
| AP-003 | Understand assistance-type choices | Controls lack useful group label | Serious, screen-reader/cognitive | Remaining |
| AP-004 | Recover from invalid review data | Error summary not linked, focus not moved | Serious, keyboard/screen-reader | Remaining |
| AP-005 | Know test application was submitted | Confirmation not announced as status | Serious, screen-reader | Remaining |

After AP-001 blocks the unassisted path, a clearly recorded test-assist fallback inspects downstream steps; reports must state fallback use and never call the unassisted path successful.

**Demo repository handling (amended)**: repository attachment may begin from `apps/demo-aid-app`. The git-workspace resolves and records the **actual Git top-level directory** (via `git rev-parse --show-toplevel` semantics) as the repository root, and the repair worktree is created from that repository. The AP-001 repair scope is restricted via `allowedPathGlobs` to `apps/demo-aid-app/**` and its tests. After-run shows AP-001 `resolved`, AP-002–AP-005 `remaining` or `manual-review-required`. `npm run demo:reset` restores the inaccessible baseline and clears generated audits/worktrees/evidence, touching nothing outside fixture + generated artifact directories.

## 8. Requirements Traceability (FR → Component → Test → Gate)

| Req | Owner components | Verifying tests | Gate |
|---|---|---|---|
| FR-1 Create audit | console setup form (seeded template review/edit), companion `POST /api/audits`, audit-engine policy | audit-engine policy units; console form/label tests; E2E step 2 | B, C, F |
| FR-2 Execute task path | audit-engine runner, companion state machine | action resolution, success predicates, timeout/cancel, partial bundle | B, F |
| FR-3 Collect evidence | audit-engine checkpoints | axe normalization, screenshot/focus persistence, automated-vs-manual labels | B |
| FR-4 Barrier Map | evidence transform, console map + linear | graph↔linear equivalence, severity ordering, keyboard nav | C, F |
| FR-5 Attach repository | git-workspace (top-level resolution), companion validate route | reject non-repo/dirty base, top-level resolution, base branch/commit display | D |
| FR-6 Start Qoder repair | qoder-runner, companion orchestration | mock adapter session/manifest tests, worktree-only mutation | D, E |
| FR-7 Live repair activity | companion SSE, console timeline | SSE ordering/reconnect state reconstruction/duplicate tolerance, redaction | E |
| FR-8 Approvals | qoder-runner broker, console dialogs | approval-before-mutation, out-of-scope denial, command denial | E |
| FR-9 Verify repair | audit-engine replay, evidence comparison | replay with original TaskContract, comparison classification | F |
| FR-10 Rewind | git-workspace + qoder-runner preview | preview accuracy, stale-verification marking, base unchanged | E |
| FR-11 Export evidence | evidence reports | regeneration from persisted artifacts, no secrets/absolute paths | B, F |
| FR-12 Reset demo | demo-aid-app + scripts | deterministic reset, artifact-scope safety | A, F |

**NFR budgets** (PRD): console first interaction <2s; SSE event visible <1s; diff refresh <1s; audit <60s; E2E mock flow <90s; demo <4min. Accessibility: WCAG 2.2 AA, full keyboard, visible focus, semantic landmarks, no graph-only info, 320px reflow, forced-colors, reduced motion → Gate C + a11y layer. Reliability: Last-Event-ID reconnect with authoritative state reconstruction, append-only durable artifacts, sessions always reach terminal or paused state. Explainability: EvidenceLabel separation persisted end-to-end — direct browser evidence (`observed`/`deterministic-check`) vs agent inference (`inferred`) vs `proposed` repair vs `verified` result vs `manual-review-required` are distinct fields at every layer (finding detail, reports, demo narration). All 19 decisions D-001–D-019 are fixed constraints; D-018 is the product-level definition of done.

## 9. Implementation Phases in Dependency Order (P02–P12)

Each phase = one new Quest with mode/toggles per QODER_EXECUTION.md; prepend the universal header; run exit commands manually; commit per phase, no push until release plan.

| Prompt | Quest mode/toggles | Scope | Exit / gate |
|---|---|---|---|
| P02 Foundation & contracts | Experts, Spec On, Goal Off | npm workspaces; **Node 20 baseline with `.nvmrc` + `engines` (P00 resolution)**; strict TS; app/package shells **with enforced dependency boundaries (§3)**; versioned Zod schemas; root scripts (`dev,lint,typecheck,test,test:e2e,test:security,test:a11y,demo:reset,demo:verify`); env validation incl. `ACCESSPATH_ARTIFACT_ROOT` + `.env.example`; `.gitignore` (secrets, artifact root, worktrees); Vitest baseline; health endpoint; minimal accessible console shell; **minimal public root README.md**. No browser audit/Git/SDK/database. | Gate A: clean install, lint, typecheck, contract + smoke tests pass |
| P03 Fixture | Agent, Spec On, Goal Off | demo-aid-app with exactly AP-001–AP-005 + stable hooks, **seeded fixture TaskContract template**, expected finding manifest, unit + Playwright tests, deterministic reset, start/health commands. Commit inaccessible baseline; do not repair. | Barriers deterministic; reset works |
| P04 Audit engine | Agent, Spec On, Goal Off | target policies, TaskContract execution, test-assist fallback, checkpoint evidence, finding normalization, AuditBundle persistence, append-only durable events, cancellation/timeout/partial bundles, audit-only reports. No Git/Qoder deps. | Gate B: fixture yields AP-001–005 deterministically; failure-path tests pass |
| P05 Console & Barrier Map | Experts, Spec On, Goal Off | app rail, audit setup with **template review/edit of URL, intent, success condition, steps** + readiness ledger, live workspace, Barrier Map 4 modes + linear equivalence, finding detail (observation/checks/reproduction/inference/guidance/manual review), SSE reconnect with state reconstruction, all UI states, audit export. | Gate C: URL-only flow complete, keyboard-only works, no critical/serious axe issues |
| P06 Local repair plane | Experts, Spec On, Goal Off. **Prereq (amended): PAT or supported local Qoder authentication verified as available (presence check only)** | **install and pin `@qoder-ai/qoder-agent-sdk`; execute the first live streaming smoke test in this phase**; repo validation incl. Git top-level resolution + clean base; branch/worktree under artifact root (never inside base checkout) with ownership marker; path protections; repair manifest; SDK host + working dir; read-only diagnosis; plan/tool/patch/rewind approvals; SSE conversion (durable semantic events, transient deltas); checkpointing/interrupt/rewind preview; host-enforced policies; Git diff authority; process supervision; repair workspace UI; base-integrity indicator. | Gate D + E core: mock tests pass; one live smoke edit streams/diffs/interrupts/rewinds; base unchanged; out-of-scope denied |
| P07 Integrated vertical slice | Experts, Spec On, Goal Off → review Spec → Goal On at Build (first Goal use) | 13-step end state: reset → audit → AP-001–005 captured → Barrier Map → **attach repo starting from apps/demo-aid-app, resolve+record Git top-level, create worktree from that repository** → diagnosis + plan approval → AP-001 minimal repair **scoped to `apps/demo-aid-app/**` and its tests** + regression test → streamed events → preview + replay original TaskContract → AP-001 resolved, others visible → HTML/MD/JSON export → rewind preview. No stretch features. | Gate F: `demo:reset` + `demo:verify` pass twice from clean base; no secrets/absolute paths in report |
| P08 Security review | Experts, Spec Off, Goal Off | read-only findings-first review: injection paths, localhost exposure, target policy, path escape, base mutation, permission widening, command injection, leakage, event ordering, rewind side effects, overclaiming, inaccessible workflows. Classify: blocker / post-freeze / accepted / false positive. | Severity-ordered report, no edits |
| P09 Release-blocking fixes | Agent, Spec On, Goal Off | narrow Spec from accepted blockers only: root cause, minimum change, regression test, contract/doc update, verification command. No refactors. | Blockers fixed; demo still passes |
| P10 Test & security closure | Agent, Spec Off, Goal On (bounded turn budget) | reach measurable state: all mandatory commands pass; `demo:verify` twice; base clean after repair; no secrets anywhere; all child processes terminate. | All commands proven with fresh output |
| P11 Demo polish | Agent, Spec Off, Goal Off | microcopy, states, focus/announcements, responsive overflow, seeded data, startup reliability, timing, screenshots/captions. **Polishes the existing public root README for submission.** Forbidden: architecture/schema/dependency/feature changes. | 3 uninterrupted <4min runs; 1 keyboard-only; 1 offline fallback |
| P12 Final release closure | Agent, Spec Off, Goal On | all TEST_PLAN commands pass twice; live repair rehearsed + fallback artifact exists; fresh-clone setup verified; repo clean; worktrees accounted for; media secret-free; public README explains build+runtime Qoder use; screenshots (Spec/Experts/Goal/agent activity/diff/tests/evidence); release commit/tag; SUBMISSION checklist. | Gate G / submission ready |

**Dependencies**: P02 → P03 → P04 → P05; P02+P05 → P06 → P07; P07 → P08 → P09 → P10 → P11 → P12. Feature freeze after P07/Gate F; post-freeze changes limited to release-blocking correctness, security, setup, inaccessible paths, demo timing, submission content — each with targeted test + `demo:verify`. If fewer than 3 build days remain, use the shortened emergency sequence with the Master Build Prompt (still Spec-reviewed before Goal).

## 10. Test Matrix and Release Gates

**Ten layers** (TEST_PLAN.md): contracts (parse/reject/round-trip/private-field omission); audit-engine units (policy, redirects, action resolution, predicates, timeout/cancel, axe normalization, grouping, redaction, partial bundles); evidence units (stable IDs, label distinction, graph↔linear equivalence, comparison, integrity hashing, report regeneration); git-workspace with REAL Git repos (reject non-repo/dirty, top-level resolution, worktree lifecycle under artifact root, canonicalization, escape rejection, base preservation, ownership-marker + resolved-path removal validation, name collisions); qoder-runner mock adapter (+ separately invoked live smoke, excluded from CI); companion API (auth, origin/host, transitions, idempotency, SSE ordering/reconnect state reconstruction/duplicates, process cleanup, artifact authorization, no absolute paths); console components (labels, keyboard stepper, template edit flow, equivalence, focus management, diff navigation, color-independent status, reconnect/stale states, live-region restraint); Playwright E2E (11-step deterministic flow with mock SDK); accessibility (axe on all primary routes + manual keyboard/zoom/reflow/forced-colors/reduced-motion/screen-reader smoke with recorded SR/browser/OS/date); security (SECURITY.md matrix: private-IP/redirect denial, local-explicit gating, cross-origin rejection, base immutability, worktree escape denial, command denial, redaction sweep).

**Gates**: A foundation → B audit → C console → D repair isolation → E Qoder integration → F end-to-end → G submission (3 live rehearsals + fallback + keyboard-only + fresh-clone).

**Definition of Done** (TEST_PLAN + D-018): from a clean clone, twice consecutively: `npm install`, `npx playwright install chromium`, `npm run lint`, `typecheck`, `test`, `test:security`, `test:a11y`, `test:e2e`, `demo:reset`, `demo:verify`.

## 11. Failure Behavior and Rollback

- Audit failure/timeout/cancel → terminal state + partial AuditBundle with failure diagnostic; prior step evidence preserved; full browser process-tree cleanup.
- Repair failure → `failed` terminal state; worktree preserved for inspection; base checkout untouched by construction (worktrees never nested in the base checkout); events persisted through failure.
- SSE disconnect → console reconnects with Last-Event-ID; server replays durable events; authoritative state reconstructed without token deltas; UI shows persistent connection state and stale-evidence marking.
- Qoder outage/auth failure → session fails cleanly without repo corruption; demo fallback ladder engages (see §12); `QODER_AUTH_REQUIRED` surfaced with next action.
- Rollback = rewind: dry-run preview (affected files, invalidated verification results, non-file side-effect warning) → explicit confirmation → apply → timeline event. Never improvised via destructive Git commands. Worktree removal only after ownership-marker check + resolved-path validation; base branch/status verified unchanged pre/post.
- Invalid state transitions rejected side-effect-free (`409 CONFLICT` with current state); duplicate commands idempotent.

## 12. Demo and Submission Evidence

**Locked scenario** (DEMO.md): under 4 minutes — 0:00–0:25 problem + URL-only audit; 0:25–1:10 run task, expose Barrier Map; 1:10–1:35 AP-001 evidence + uncertainty (show evidence labels); 1:35–2:40 attach repo, worktree identity, approve diagnosis + plan; 2:40–3:25 minimal diff + regression test + passing tests + replay comparison; 3:25–3:50 export, rewind preview, close.

**Qoder proof points live**: SDK session status, streamed agent/tool events, permission broker, session/checkpoint provenance, live repair through the AccessPath UI. **Supporting material**: master Spec screenshots, annotations before Build, Experts canvas, phase task lists, changed-files reviews, Goal completion, runtime timeline + permission request, final diff/tests/replay/evidence — evidencing the 30% Qoder-usage judging criterion.

**Fallback ladder** (labels mandatory; never imply a replay is live): 1) prewarmed live session paused before approval; 2) recorded Qoder session replay, clearly labeled; 3) seeded audit bundle via demo fallback; 4) under-4-minute video + exported HTML report.

**Submission** (SUBMISSION.md): public repo, public root README (Qoder build+runtime story; created P02, polished P11), working fresh-clone setup, demo video, social post with Alibaba Cloud + Qoder tags, organizer form; recommended architecture diagram, Barrier Map screenshot, before/after report, Spec/Experts/Goal screenshots, repair timeline GIF, limitations/security section.

## 13. Resolved Conflicts and Ambiguities

1. Node 18 vs 20 → Node 20+ (P00 override; explicit config in P02).
2. RepairState casing → kebab-case canonical; sentence-case UI labels only (different layers, no conflict).
3. Qoder auth timing → **availability of PAT or supported local auth validated before P06 (presence check only); SDK install and first live streaming smoke test execute during P06**; nothing blocks P01.
4. Public README vs docs/README.md → separate artifacts; **minimal public root README created in P02, polished in P11**.
5. Event persistence → **durable semantic events + completed agent messages persisted to NDJSON; `agent.message.delta` and high-frequency display deltas transient; reconnect reconstructs authoritative state from durable events only**; consumers idempotent by eventId.
6. "AP-001 resolved" meaning → task replay passes the keyboard eligibility step under tested conditions; labeled `verified`, never "compliant" (D-012); human review still noted.
7. Mock vs live SDK → mock adapter for all CI/E2E; live smoke separately invoked (first run in P06); demo prefers live with labeled fallback.
8. Task authorship → **deterministic seeded emergency-aid TaskContract template; user reviews and edits URL, intent, success condition, and steps; no unrestricted LLM-generated browser planning**.
9. Fixture repo vs monorepo → **attachment may begin from `apps/demo-aid-app`; actual Git top-level resolved and recorded; worktree created from that repository; repair scope restricted to `apps/demo-aid-app/**` + tests via allowedPathGlobs**.
10. Browser scope → Chromium only for MVP.
11. Command-denial scope → denial targets **disk formatting or system-volume formatting**, not project code-formatting; approved configured formatting/lint commands remain brokered-allowed.

## 14. Rejected Alternatives

- **Hosted/cloud audit backend or repo upload** — rejected (D-002, D-019): local-first eliminates a second security perimeter; contracts still permit a future public-audit adapter.
- **Database persistence** — rejected (D-007): file artifacts are inspectable, portable, sufficient.
- **WebSocket streaming** — rejected (D-009): traffic is server-to-client; SSE + HTTP approvals is simpler and reconnectable.
- **Qoder IDE automation/embedding** — rejected (D-003, D-004): official Agent SDK behind a custom console is the supported path.
- **Free-form LLM browser auditor / unrestricted LLM task planning** — rejected (D-005 + amendment 5): deterministic Playwright/axe evidence and a seeded, user-reviewed TaskContract are required for reproducible judging; Qoder diagnoses, never invents observations or journeys.
- **Worktrees nested inside the base checkout (`<repo>/.accesspath/worktrees`)** — rejected (amendment 3): nesting generated mutable workspaces inside the editable base checkout weakens the isolation boundary and complicates ownership validation; the artifact root is an independent application-owned directory.
- **Persisting every token delta to the durable event log** — rejected (amendment 4): unbounded low-value writes; durable semantic events + completed messages fully reconstruct state.
- **Runtime accessibility overlay** — rejected (D-011): source-level repair only.
- **Unrestricted/bypass Qoder permission mode** — rejected (D-016): tiered broker is a core proof point.
- **SDK install + live smoke before P06** — rejected (amendment 1): installing and exercising the SDK before the repair plane exists adds setup risk with no phase value; presence-of-credentials check is sufficient gating.
- **Performance-first plan variant with invented per-test latency budgets** — rejected during synthesis: only documented budgets (<2s/<1s/<1s/<60s/<90s/<4min) are binding; fabricated micro-targets would create false gate criteria.
- **Building directly from this master Spec (single mega-build)** — rejected: QODER_EXECUTION.md mandates review-only for P01; phased smaller Specs keep every change set reviewable. The Master Build Prompt remains an emergency-only path.

## 15. Assumptions

- Repository is currently documentation-only (`docs/` with 15 files); P00 census completed with the stated resolutions.
- Execution environment: Windows, cmd.exe; PowerShell exit-command blocks from QODER_EXECUTION.md run equivalently.
- Hackathon window per DELIVERY_PLAN.md (Jul 28–Aug 5): P02–P03 by Jul 29, P04 Jul 30, P05 Jul 31, P06 Aug 1, P07 Aug 2–3 (freeze), P08–P10 Aug 3, P11 Aug 4, P12 Aug 5.
- `ACCESSPATH_ARTIFACT_ROOT` defaults to an application-owned directory outside any attached base checkout; exact default resolved in P02 env validation.
- No file modifications, package installs, or Build actions occur until this Spec is reviewed and approved.