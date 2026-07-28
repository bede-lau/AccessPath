# AccessPath Qoder Handoff

This directory is the complete implementation handoff for **AccessPath**, a
task-path accessibility auditor with a local repair companion powered by the
Qoder Agent SDK.

The handoff is designed to be copied into a new Git repository and opened as
the workspace root in Qoder IDE.

## Product in one sentence

AccessPath audits whether a person can complete an important web task, shows
the exact barriers in the journey, and uses Qoder locally to propose, verify,
review, and rewind source-code repairs.

For the hackathon, AccessPath is a local-first modular monolith. The local
companion can audit public, staging, preview, and explicitly approved localhost
URLs. A hosted public-audit adapter is a post-MVP extension, not a release
dependency.

## Canonical documents

Read these documents in this order:

1. [PRD.md](PRD.md) - product requirements, users, scope, and success criteria
2. [DECISIONS.md](DECISIONS.md) - fixed architectural decisions and non-goals
3. [ARCHITECTURE.md](ARCHITECTURE.md) - system boundaries, runtime flow, and repository structure
4. [DESIGN.md](DESIGN.md) - canonical UI and interaction contract
5. [API_CONTRACTS.md](API_CONTRACTS.md) - API, event, and persisted artifact schemas
6. [SECURITY.md](SECURITY.md) - threat model, permissions, privacy, and safety controls
7. [TEST_PLAN.md](TEST_PLAN.md) - required validation and release gates
8. [DELIVERY_PLAN.md](DELIVERY_PLAN.md) - build phases, priority, and risk controls
9. [SETUP.md](SETUP.md) - manual environment and runtime setup
10. [DEMO.md](DEMO.md) - deterministic judging demo and fallback plan
11. [SUBMISSION.md](SUBMISSION.md) - hackathon evidence and judging alignment
12. [QODER_EXECUTION.md](QODER_EXECUTION.md) - exact Qoder mode, Spec, and Goal sequence
13. [PROMPTS.md](PROMPTS.md) - copy-paste prompts for each implementation phase
14. [RESEARCH_BASIS.md](RESEARCH_BASIS.md) - repository-derived rationale and epistemic limits

## Source-of-truth hierarchy

When documents appear to conflict, use this order:

1. `DECISIONS.md`
2. `PRD.md`
3. `ARCHITECTURE.md`
4. `SECURITY.md`
5. `API_CONTRACTS.md`
6. `DESIGN.md`
7. `TEST_PLAN.md`
8. Remaining operational documents

Do not silently resolve a conflict. Update the lower-priority document and
record the decision in `DECISIONS.md`.

## MVP definition

The hackathon MVP must demonstrate one complete vertical slice:

1. Enter a deployed or local web application URL.
2. Define or load one critical task path.
3. Run a deterministic browser audit.
4. View a Barrier Map with evidence.
5. Attach a local Git repository.
6. Start a Qoder-powered repair from the AccessPath UI.
7. Stream agent activity, file changes, and test results.
8. Review and approve a minimal patch.
9. Rerun the same task path.
10. Export a before-and-after evidence report.

## Recommended implementation stack

- TypeScript
- Node.js 20 or newer
- npm workspaces
- React and Vite
- Fastify
- Playwright
- axe-core through `@axe-core/playwright`
- Qoder Agent SDK for TypeScript
- Zod
- Server-Sent Events for audit and repair event streams
- Git CLI for worktrees, diffs, and snapshots
- Monaco diff viewer
- Vitest

Avoid introducing a database for the MVP. Persist run artifacts as structured
files under `.accesspath/`.

## Expected repository shape

```text
accesspath/
  apps/
    console/                 # React operational UI
    companion/               # Local Fastify API and SSE server
    demo-aid-app/            # Intentionally inaccessible fixture
  packages/
    contracts/               # Zod schemas and shared types
    audit-engine/            # Playwright and axe audit runner
    qoder-runner/            # Qoder Agent SDK adapter
    git-workspace/           # Worktree, diff, snapshot, and rewind logic
    evidence/                # Barrier grouping and report generation
  docs/                      # Copy of this handoff
  .accesspath/               # Generated runtime artifacts; ignored by Git
  package.json
  tsconfig.base.json
  README.md
```

## Implementation principles

- Build the task-path vertical slice before generalizing.
- Prefer deterministic evidence to free-form agent claims.
- Never claim that automated checks prove universal accessibility.
- Separate observed evidence, inferred diagnosis, proposed repair, and verified result.
- Keep source code local during repair.
- Use the least-privileged Qoder tool and repository scope.
- Do not auto-push, auto-merge, or deploy.
- Every repair must be reviewable and reversible.
- AccessPath itself must meet WCAG 2.2 AA.

## Required final commands

The completed repository should support:

```powershell
npm install
npx playwright install chromium
npm run dev
npm run lint
npm run typecheck
npm run test
npm run test:e2e
npm run demo:reset
```

## Completion rule

Do not consider the build complete because the dashboard renders. Completion
requires the end-to-end demo path in `DEMO.md` to pass from a clean reset with
fresh evidence artifacts.
