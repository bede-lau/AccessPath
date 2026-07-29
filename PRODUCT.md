# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

AccessPath serves accessibility leads, frontend engineers, QA or release
managers, and product reviewers who need to evaluate an important web task,
understand where it becomes inaccessible, and review a bounded local repair.
The primary operating context is a local development or review session where
evidence and source changes must remain inspectable.

## Product Purpose

AccessPath audits one critical browser journey, records direct accessibility
evidence at each step, groups barriers around affected human actions, and
supports an isolated repair and replay workflow. Success means the user can
understand the tested path, distinguish observation from inference, review the
exact source change, verify the same task again, and export durable evidence
without overstating automated coverage.

## Positioning

AccessPath is a task-path accessibility workbench rather than a page-level
violation dashboard. Its defining mechanism connects Playwright and axe
observations to a human-action Barrier Map, then carries that same evidence
through a locally isolated Qoder repair, explicit approvals, verification, and
rewind.

## Operating Context

- One seeded emergency-aid application provides the deterministic demo path.
- The audit console runs locally and accepts public HTTPS or explicitly allowed
  localhost targets.
- The repair plane attaches a local Git repository and creates generated
  worktrees outside the editable base checkout.
- Users move through audit setup, live evidence, Barrier Map, repair review,
  verification, rewind, and HTML, Markdown, or JSON export.
- The judging flow must be understandable to both technical and non-technical
  reviewers without requiring knowledge of WCAG rule identifiers.

## Capabilities and Constraints

- Preserve the intentionally present AP-001 through AP-005 fixture findings.
- Repair only AP-001 in the demonstrated isolated worktree; AP-002 through
  AP-005 remain visible after replay.
- Treat Playwright and axe artifacts as observed evidence. Agent output may
  diagnose or propose, but it may not fabricate audit observations.
- Keep observation, inference, proposal, verification, manual review, and
  residual risk visibly separate.
- Enforce target, path, command, approval, secret-redaction, process-cleanup,
  and base-checkout integrity policies.
- Never push, merge, deploy, modify Git remotes, or imply legal compliance.
- Preserve partial evidence after failure or reconnect.
- Use React, Vite, plain CSS, Lucide icons, semantic HTML, and the existing API
  contracts.

## Brand Commitments

- Product name: AccessPath.
- Voice: calm, direct, exact, evidence-led, and honest about uncertainty.
- The interface is an operational accessibility tool, not a marketing
  dashboard or an animated AI spectacle.
- The requested replacement direction is minimal, clean, and Apple-inspired in
  clarity and interaction quality without copying Apple branding or product
  chrome.
- Real captured screenshots, source diffs, test results, and durable events are
  the product's visual proof.

## Evidence on Hand

- Canonical product and behavior documents live under `docs/`.
- The complete P03-P07 fixture, audit, repair, verification, and export
  implementation is present in the repository.
- Frontend behavior is covered by component, accessibility, mobile, and
  end-to-end tests under `apps/console/tests/`.
- The repository contains no customer testimonials, production usage metrics,
  legal-compliance proof, or external benchmark claims; future work must not
  fabricate them.

## Product Principles

1. Lead with the human action and its consequence.
2. Make every authority boundary explicit and reviewable.
3. Prefer direct evidence over confidence language or scanner volume.
4. Preserve context across audit, repair, verification, failure, and rewind.
5. Make the complete workflow usable by keyboard and understandable in a
   linear reading order.

## Accessibility & Inclusion

AccessPath targets WCAG 2.2 AA. Every primary workflow requires logical
landmarks and headings, complete keyboard operation, visible focus, semantic
status text, restrained live regions, a linear equivalent for graph content,
reflow at 320 CSS pixels, reduced-motion support, forced-colors support, and
touch targets of at least 44 by 44 CSS pixels on touch layouts.
