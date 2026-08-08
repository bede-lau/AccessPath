# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

AccessPath serves frontend engineers, QA and release managers, accessibility
leads, and product reviewers who need to evaluate an important web journey,
understand where it fails, and review a bounded source repair. The primary
operating context is a local development or review session where browser
evidence, agent activity, commands, and source changes remain inspectable.

## Product Purpose

AccessPath runs one plain-English critical-journey mission against a staging
site and its source, records direct browser evidence at each step, surfaces
issues around affected human actions, and performs one authorized repair in an
isolated workspace. Accessibility is the flagship specialist. Success means the
user can follow one continuous Proof Thread from observation to scoped repair
to verification, inspect the exact source change, and export durable evidence
without overstating what was tested.

## Positioning

AccessPath is an autonomous critical-journey QA workspace rather than a
page-level scanner or test-case dashboard. Its defining mechanism connects a
plain-English objective to a frozen browser plan, Playwright and accessibility
evidence, Qoder diagnosis and repair, sandbox verification, and final patch
acceptance.

## Operating Context

- The Mission Workspace requires a staging URL, a local checkout or public
  HTTPS Git URL, and a plain-English objective.
- The browser plane supports Playwright Chromium against public HTTPS or
  explicitly allowed localhost targets.
- Source is captured into an immutable app-owned snapshot before execution.
- Repair and verification run against disposable source copies outside the
  editable checkout.
- Users remain on one mission route from plan compilation through observation,
  repair, verification, rewind, patch acceptance, and report export.
- The judging flow must be understandable to both technical and non-technical
  reviewers without requiring knowledge of WCAG rule identifiers.

## Capabilities and Constraints

- Keep deterministic application-specific scenarios only as regression tests;
  production issue titles and flows must remain source-agnostic.
- Treat Playwright, accessibility, console, and network artifacts as observed
  evidence. Agent output may compile, diagnose, or propose, but it may not
  fabricate observations.
- Keep observation, inference, proposal, verification, manual review, and
  residual risk visibly separate.
- Freeze the task hash, source snapshot, viewport, inputs, and success
  conditions when a mission starts.
- Require an exact or reproduced deployment binding before source mutation.
- Enforce target, source-capture, path, command, authorization, sandbox,
  secret-redaction, process-cleanup, and base-checkout integrity policies.
- Run authorized commands in the digest-pinned AccessPath Playwright image with
  no runtime network. The host provides immutable mission context and the
  required audit-bundle output path through fixed sandbox environment values.
- Treat a replay command as evidence-producing only when it persists a valid
  AccessPath audit bundle at `ACCESSPATH_AUDIT_BUNDLE_PATH`; command exit status
  alone never establishes reproduction or repair.
- Keep Qoder tools bounded to planning with no tools, read-only diagnosis, and
  explicitly authorized Edit or Write operations during repair. Host code owns
  browser actions, command execution, evidence, and verification.
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
- Audit, repair, verification, checkpoint, report, and Qoder session primitives
  are present in the repository and are linked as child records of a mission.
- Frontend behavior is covered by component, accessibility, mobile, and
  end-to-end tests under `apps/console/tests/`.
- The repository contains no customer testimonials, production usage metrics,
  legal-compliance proof, or external benchmark claims; future work must not
  fabricate them.

## Product Principles

1. Lead with the mission objective, affected action, and consequence.
2. Make every authority and provenance boundary explicit and reviewable.
3. Prefer direct evidence over confidence language or scanner volume.
4. Preserve context across observation, repair, verification, failure, and
   rewind.
5. Keep the primary workflow autonomous, interruptible, keyboard usable, and
   understandable in a linear reading order.

## Accessibility & Inclusion

AccessPath targets WCAG 2.2 AA. Every primary workflow requires logical
landmarks and headings, complete keyboard operation, visible focus, semantic
status text, restrained live regions, a linear equivalent for graph content,
reflow at 320 CSS pixels, reduced-motion support, forced-colors support, and
touch targets of at least 44 by 44 CSS pixels on touch layouts.
