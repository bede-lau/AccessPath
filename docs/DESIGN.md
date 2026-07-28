# Design

## Source of truth

This is the canonical product, visual, and interaction contract for AccessPath.
Implementation choices must preserve `PRD.md`, `DECISIONS.md`, accessibility,
security, and the evidence hierarchy in `RESEARCH_BASIS.md`.

## Brand

**Name:** AccessPath

**Product promise:** Show where an essential web task becomes inaccessible,
then make the repair observable, reviewable, and verifiable.

**Aesthetic:** Forensic field console. The product should feel calm, exact,
accountable, and built for repeated engineering work. It is an operational
tool, not a marketing dashboard.

Avoid glossy AI spectacle, oversized headlines, decorative gradients, floating
cards, excessive rounding, and animated agent avatars.

## Design goals

- Lead with affected human actions, not scanner jargon.
- Make direct evidence distinguishable from inference.
- Keep the entire audit-to-repair trajectory understandable.
- Make Qoder's runtime role visible without exposing hidden reasoning.
- Require deliberate approval at meaningful authority boundaries.
- Provide a complete keyboard and linear alternative to every graph view.
- Preserve useful partial state when runs fail.

## Personas

### Accessibility lead

Scans paths by impact, opens precise evidence, assigns manual review, and
exports a defensible record.

### Frontend engineer

Moves from finding to source context, reviews the proposed plan and diff, runs
tests, approves or rewinds, and understands residual risk.

### QA or release manager

Checks task status, regressions, approvals, and release evidence without
reading every source change.

### Product viewer

Understands which user action is blocked and why it matters from the linear
report, without needing WCAG expertise.

## Product model

```text
Project
  -> Audit
  -> Task path
  -> Path step
  -> Finding
  -> Repair session
  -> Evidence bundle
  -> Approval
```

Observed evidence, inferred diagnosis, proposed repair, and verified result
must appear as separate fields or stages.

## Information architecture

Primary navigation:

- Projects
- Audits
- Barrier Map
- Repairs
- Evidence

Utility navigation:

- Local connection
- Settings
- Help

Recommended routes:

```text
/projects
/projects/:projectId/audits
/projects/:projectId/audits/new
/audits/:auditId/live
/audits/:auditId/barrier-map
/audits/:auditId/findings/:findingId
/audits/:auditId/findings/:findingId/repair
/audits/:auditId/evidence
/repairs
/repairs/:repairId
/settings/integrations
```

The MVP may use one seeded project, but routes and state must not hardcode one
audit ID.

## Core workflows

### Audit setup

Use one unframed workspace with a right-side readiness ledger.

Sections:

1. Target URL and target policy
2. Critical task and success condition
3. Reviewable path steps
4. Viewport and evidence checkpoints
5. Run policy
6. Readiness review and Run command

The readiness ledger shows validation, local companion status, expected
duration, capture types, and blockers.

### Live audit

Desktop layout has three stable regions:

- Left: task path rail with step status
- Center: evidence stage with current application screenshot and annotations
- Right: findings queue ordered by task impact

The center stage is not a decorative card. It is the primary work surface.
Selecting a step updates the screenshot, observed action, focus state,
automated checks, and linked findings.

### Barrier Map

The Barrier Map is a left-to-right human-action graph.

- Nodes are meaningful user states or actions.
- Edges are attempted transitions.
- Barriers attach to the action or transition that failed.
- Selecting an item opens evidence without losing map position.

Modes:

- Journey
- Impact
- Repair
- Compare

Every graph has a synchronized linear representation using an ordered list,
headings, status text, and links to the same evidence.

### Repair workspace

Top context strip:

- affected action
- audit environment
- base commit
- worktree branch
- repair state

Desktop columns:

- Left: evidence and repair brief
- Center: source diff or selected file
- Right: verification ledger and agent timeline

The diff is the visual authority for source changes. Agent events explain how
the state was reached.

### Evidence report

Report hierarchy:

1. Identity and tested conditions
2. Task-path outcome
3. Barrier summary
4. Per-finding evidence and reproduction
5. Repair and verification comparison
6. Manual review and residual risk
7. Integrity and provenance

## Interaction principles

### Approval is a state transition

Approval controls must state the action and consequence:

- Approve plan
- Permit edit in listed files
- Permit test command
- Approve patch
- Rewind files to checkpoint

Do not use vague `Continue` actions for authority changes.

### Timeline phases

Display:

```text
Observe
Diagnose
Plan
Await approval
Edit
Verify
Await patch approval
Applied or Reverted
```

An event row can show timestamp, action, target, result, and expandable raw
output. Do not display chain-of-thought, token counts, or fabricated
explanations of hidden reasoning.

### Rewind

Rewind opens a preview showing affected files, insertion/deletion totals,
verification results that will become stale, and the limitation that command
side effects are not reversed. Completion creates a new timeline event; it
does not delete history.

## Visual language

### Typography

- UI: Instrument Sans
- Code and identifiers: Azeret Mono
- Fallbacks: system sans and system monospace
- Letter spacing: `0`

Use compact headings in work surfaces. Reserve large display text for the
project name in an empty or onboarding state, not every page.

### Palette

| Token | Value | Use |
|---|---|---|
| Canvas | `#F5F2EA` | App background |
| Surface | `#FFFCF6` | Tools and repeated item backgrounds |
| Ink | `#17231D` | Primary text and navigation |
| Muted | `#58625C` | Secondary text |
| Rail | `#17231D` | Main navigation |
| Signal cyan | `#007F82` | Active process and selected states |
| Barrier coral | `#B94332` | Blocking findings and destructive outcomes |
| Review gold | `#9A6800` | Pending review and uncertainty |
| Verified moss | `#547128` | Verified outcomes |
| Rule | `#D7D2C5` | Dividers and boundaries |
| Focus | `#005FCC` | Keyboard focus ring |

Color never carries state alone. Pair it with icons, text, patterns, or border
styles. Verify text and component contrast against WCAG 2.2 AA.

### Geometry

- 8px spacing rhythm
- Maximum general radius: 6px
- 1px dividers for dense work areas
- 3px visible focus outline
- Stable icon button sizes
- Cards only for repeated findings, modal dialogs, and discrete report items
- No cards nested inside cards

### Motion

- 140-180ms state transitions
- No continuous decorative movement
- Progress animation stops in paused or failed states
- Respect `prefers-reduced-motion`

## Component inventory

- App rail
- Project switcher
- Breadcrumbs
- Target policy segmented control
- Task path stepper
- Readiness ledger
- Evidence stage
- Annotation pin
- Keyboard transcript
- Finding row
- Severity, modality, confidence, and evidence labels
- Barrier graph node and edge
- Linear path item
- Diff file navigator
- Diff hunk
- Scope list
- Test ledger
- Agent event row
- Approval gate
- Checkpoint list
- Rewind preview dialog
- Evidence report
- Command palette
- Toast and persistent status region

Use Lucide icons where applicable. Icon-only controls require accessible names
and tooltips.

## State design

Every main surface must implement:

- loading
- empty
- ready
- running
- paused
- partial
- blocked
- failed
- cancelled
- completed

Cross-cutting states:

- local companion disconnected
- Qoder authentication required
- permission required
- stale evidence
- event stream reconnecting
- file conflict
- preview unavailable
- verification timeout
- no automated repair recommended
- operation outside approved scope
- offline

Errors state what happened, what remains preserved, and the next available
action.

## Accessibility

Target WCAG 2.2 AA.

Required:

- logical landmarks and heading order
- skip link to primary work area
- full keyboard operation
- visible 3px focus
- no focus traps outside modal behavior
- focus restored to the invoking control after dialogs
- graph information available as a linear list
- semantic diff structure with file and hunk headings
- restrained ARIA live regions for phase changes, permission requests, and
  terminal results
- zoom and reflow at 320 CSS pixels
- forced-colors support
- reduced-motion support
- 44 by 44 CSS pixel touch targets on touch layouts
- form errors connected to fields with useful correction text

Do not announce high-frequency token or log events through live regions.

## Responsive behavior

| Width | Layout |
|---|---|
| 1440px and above | Full rail and three-pane workspaces |
| 1024-1439px | Collapsible rail and resizable two/three-pane layout |
| 768-1023px | Tabbed evidence/findings/timeline; linear Barrier Map default |
| Below 768px | Stacked flow, full-screen diff, persistent bottom actions |

Fixed-format elements must use stable dimensions or responsive constraints so
status text, icons, and dynamic output do not shift the layout.

## Content voice

- Lead with the affected action: `Keyboard users cannot reach Review`.
- State evidence source: `Observed`, `Automated check`, `Inferred`,
  `Verified`, or `Manual review required`.
- Use direct verbs: Run, Pause, Resume, Propose, Apply, Reject, Approve,
  Rewind, Export.
- Avoid `accessibility fixed`, `fully compliant`, or confidence theater.
- Explain uncertainty and scope in calm, concrete language.
- Error copy includes preservation: `The preview timed out. Your worktree and
  captured evidence are unchanged.`

## Constraints

- No runtime overlay.
- No hidden IDE dependency in the user workflow.
- No automatic push, merge, or deploy.
- No decorative marketing page as the primary screen.
- No inaccessible graph-only presentation.
- No repository selection before a URL-only audit is useful.

## Open questions

These may be decided during implementation without changing product scope:

- Whether the graph uses React Flow or a lightweight custom layout
- Whether the Markdown and HTML reports share one template pipeline
- Whether the console is packaged with a desktop shell after the hackathon

Choose the smallest implementation that meets the interaction and
accessibility contract.
