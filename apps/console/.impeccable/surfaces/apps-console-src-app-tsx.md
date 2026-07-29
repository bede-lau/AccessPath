---
version: 1
slug: "apps-console-src-app-tsx"
primary_target: "apps/console/src/App.tsx"
related_targets: ["apps/console/src/RepairWorkspace.tsx","apps/console/src/styles.css"]
---

Scope: Replace the visual system across the AccessPath console routes in
`apps/console/src/App.tsx` and `apps/console/src/RepairWorkspace.tsx`.

Mode: Operate.

Audience and job: Accessibility reviewers, frontend engineers, and release
owners must run one critical-path audit, understand browser evidence, approve a
bounded repair, inspect the diff and tests, replay the same task, and export a
defensible record.

Primary action: Move confidently from reviewed audit setup through observed
barrier, local repair, verification, and evidence export.

Proof and content: Real fixture screenshots, AP-001 through AP-005, affected
actions, deterministic checks, source diff, approval scope, verification
comparison, base-checkout integrity, and durable reports.

Constraints: Preserve existing API contracts, test-visible control names,
keyboard semantics, linear Barrier Map equivalence, reduced motion,
forced-colors support, 320px reflow, and all security boundaries.

Chosen direction: Option A, Source List Command Center. Use a compact navigation
rail, one contextual command header per route, a quiet neutral system palette,
dominant evidence and diff work surfaces, and restrained inspector panes.

Memorable moment: Selecting a task step changes the dominant evidence stage
while its affected actions remain aligned in a stable inspector, making the
human consequence and source evidence understandable in one glance.

Unresolved decisions: None blocking implementation. Mobile changes the source
list and inspector into route-local tabs while preserving document order.
