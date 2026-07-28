# Design

## Source of truth

- Status: Active
- Last refreshed: 2026-07-28
- Primary product surfaces: Audit setup, live audit, Barrier Map, finding detail,
  evidence export, repair workspace
- Evidence reviewed: `docs/DESIGN.md`, `docs/PRD.md`,
  `docs/API_CONTRACTS.md`, `docs/TEST_PLAN.md`,
  `docs/QODER_MASTER_SPEC.md`, and the existing console source
- Canonical contract: `docs/DESIGN.md` remains authoritative under the reviewed
  document-precedence rules. This root file is the implementation index
  required by the repository design workflow.

## Brand

- Personality: Calm, exact, accountable forensic field console
- Trust signals: Evidence labels, explicit limitations, visible state,
  provenance, approvals, and base-checkout integrity
- Avoid: Marketing composition, AI spectacle, decorative gradients, floating
  page cards, excessive rounding, graph-only information

## Product goals

- Goals: Make a critical task barrier observable, reviewable, repairable, and
  verifiable without overstating automated coverage
- Non-goals: Authentication, hosted infrastructure, batch repair, automatic
  push/merge/deploy, or legal-compliance claims
- Success signals: AP-001 through AP-005 are inspectable by affected action,
  map and linear views agree, evidence exports regenerate, and the judging flow
  is keyboard operable

## Personas and jobs

- Primary personas: Accessibility lead, frontend engineer, QA or release
  manager, product viewer
- User jobs: Run a URL-only task audit, inspect direct evidence, understand
  uncertainty, review a bounded repair, replay the same task, and export proof
- Key contexts of use: Local development, hackathon judging, release review,
  accessibility triage

## Information architecture

- Primary navigation: Projects, Audits, Barrier Map, Repairs, Evidence
- Core routes/screens: Audit setup, live audit, Barrier Map, finding detail,
  evidence export, repair workspace
- Content hierarchy: Affected action, observed evidence, deterministic checks,
  inferred diagnosis, proposed repair, verified result, manual review

## Design principles

- Lead with affected human actions rather than scanner jargon.
- Separate observation, inference, proposal, verification, and uncertainty.
- Preserve useful partial state and state what remains unchanged after errors.
- Give every graphical representation a synchronized semantic alternative.
- Tradeoffs: Prefer a small custom task map over a graph dependency for the MVP;
  prefer dense operational layouts over decorative presentation.

## Visual language

- Color: Canonical canvas, surface, ink, cyan, coral, gold, moss, rule, and
  focus tokens from `docs/DESIGN.md`
- Typography: Instrument Sans and Azeret Mono with system fallbacks; letter
  spacing remains `0`
- Spacing/layout rhythm: 8px rhythm, dense stable panes, full-width work areas
- Shape/radius/elevation: Maximum 6px radius, 1px dividers, restrained shadow
  only where necessary for evidence annotations
- Motion: 140-180ms state changes, no continuous decoration, reduced-motion
  support
- Imagery/iconography: Real captured screenshots and Lucide icons

## Components

- Existing components to reuse: Contracts, persisted evidence bundle, audit
  event stream, report generators
- New/changed components: App rail, audit setup, readiness ledger, path rail,
  evidence stage, findings queue, Barrier Map, linear path, finding detail,
  export controls
- Variants and states: Loading, empty, ready, running, paused, partial, blocked,
  failed, cancelled, completed, disconnected, reconnecting, stale
- Token/component ownership: `apps/console/src/styles.css` owns the MVP UI tokens
  and component styling

## Accessibility

- Target standard: WCAG 2.2 AA
- Keyboard/focus behavior: Full operation, 3px visible focus, semantic controls,
  dialog focus restoration when dialogs arrive in P06
- Contrast/readability: State is never color-only; text and icons accompany
  color and borders
- Screen-reader semantics: Landmarks, heading order, restrained live regions,
  ordered linear path, named controls
- Reduced motion and sensory considerations: Reduced-motion and forced-colors
  media queries, no decorative animation

## Responsive behavior

- Supported breakpoints/devices: Wide desktop, desktop, tablet, mobile down to
  320 CSS pixels
- Layout adaptations: Three panes collapse to two, then stacked; Barrier Map
  defaults to linear on tablet and mobile; navigation becomes a bottom rail
- Touch/hover differences: Mobile commands and navigation provide at least
  44px targets; no workflow depends on hover

## Interaction states

- Loading: Stable placeholders with current action named
- Empty: State explains what is needed next
- Error: State names the failure, preserved evidence, and available next action
- Success: Terminal state and evidence availability are explicit
- Disabled: Disabled commands remain labeled and explain blockers nearby
- Offline/slow network: Reconnecting, disconnected, and stale-evidence states
  remain distinct from audit state

## Content voice

- Tone: Calm, direct, scoped, evidence-led
- Terminology: Observed, deterministic check, inferred, proposed, verified,
  manual review required
- Microcopy rules: Lead with the affected action; never claim fully accessible
  or compliant from automated checks

## Implementation constraints

- Framework/styling system: React, Vite, plain CSS, Lucide
- Design-token constraints: Follow `docs/DESIGN.md`; maximum 6px general radius
- Performance constraints: Initial interaction under two seconds; event
  visibility under one second; deterministic audit under 60 seconds
- Compatibility constraints: Chromium MVP, keyboard, reduced motion,
  forced colors, 320px reflow
- Test/screenshot expectations: Component tests, Playwright flow, axe on primary
  routes, desktop/mobile screenshots, and no unexplained overflow

## Open questions

- [ ] Desktop packaging approach after the hackathon / post-MVP / no P03-P07 impact
