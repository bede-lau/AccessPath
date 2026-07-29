---
name: AccessPath
description: A quiet command center for evidence-backed accessibility audits and bounded local repair.
colors:
  canvas: "#F5F5F7"
  surface: "#FFFFFF"
  surface-subtle: "#FBFBFD"
  ink: "#1D1D1F"
  ink-secondary: "#6E6E73"
  ink-tertiary: "#86868B"
  rule: "#D2D2D7"
  rule-strong: "#A1A1A6"
  accent: "#0066CC"
  accent-hover: "#0071E3"
  accent-soft: "#EAF3FF"
  verified: "#1F7A45"
  verified-soft: "#EAF7EF"
  review: "#946200"
  review-soft: "#FFF6DE"
  barrier: "#B42318"
  barrier-soft: "#FFF0EE"
  code-canvas: "#111318"
  code-ink: "#F5F7FA"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "32px"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "0"
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "24px"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "0"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "17px"
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: "0"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0"
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "0"
  code:
    fontFamily: "\"SFMono-Regular\", Consolas, \"Liberation Mono\", monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "0"
rounded:
  sm: "5px"
  md: "8px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "32px"
  section: "48px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "10px 16px"
    height: "40px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "10px 14px"
    height: "40px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "10px 12px"
    height: "44px"
  status-mark:
    backgroundColor: "{colors.surface-subtle}"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.sm}"
    padding: "5px 8px"
---

# Design System: AccessPath

## Overview

**Creative North Star: "The Quiet Command Center"**

AccessPath should feel like a precise local instrument used by a reviewer at a
laptop in a bright workroom: clear at a glance, calm during long sessions, and
unmistakable when authority or risk changes. The visual system takes
Apple-inspired discipline from hierarchy, spacing, typography, and interaction
quality without copying Apple branding, glossy product chrome, or ornamental
glass.

Evidence is the visual authority. Screenshots, affected actions, source diffs,
verification, and approval consequences receive scale and space; navigation and
status recede until needed. The old beige canvas, dark rail, repeated boxed
badges, circular number motifs, and equal-weight pane styling are explicit
anti-references for this replacement.

**Key Characteristics:**

- Cool neutral surfaces with one operational blue accent
- A single contextual command header per route
- Source-list, work-surface, and inspector compositions
- Strong whitespace and separators instead of nested cards
- Stable loading scaffolds and restrained phase transitions
- Explicit authority gates with exact scope and consequence

## Colors

The palette is restrained and neutral, with blue reserved for selection and
primary action while green, amber, and red communicate verified, pending, and
blocked states alongside text and icons.

### Primary

- **Operational Blue:** Primary commands, current selection, links, and focus
  association. It should occupy a small portion of each screen.

### Secondary

- **Verified Green:** Confirmed checks and unchanged base integrity.
- **Review Amber:** Pending authority, uncertainty, and manual review.
- **Barrier Red:** Blocking evidence, destructive outcomes, and denial.

### Neutral

- **Cool Canvas:** The application background behind work surfaces.
- **True Surface:** Primary workspaces, inputs, sheets, and reports.
- **Graphite Ink:** Main reading text and durable identifiers.
- **Secondary Ink:** Explanatory copy and inactive metadata.
- **System Rule:** Dividers, input boundaries, and pane separation.

### Named Rules

**The One Accent Rule.** Blue identifies interaction and selection; it does not
decorate neutral content.

**The State Is More Than Color Rule.** Every state includes text and a shape,
icon, or border treatment that remains meaningful without custom color.

## Typography

**Display Font:** Native system UI sans with Segoe UI fallback
**Body Font:** Native system UI sans with Segoe UI fallback
**Label/Mono Font:** SF Mono where available, then Consolas and system monospace

**Character:** Familiar, highly legible, and quiet. Type hierarchy comes from
size, weight, and space rather than uppercase labels or tracked microcopy.

### Hierarchy

- **Display** (700, 32px, 1.15): Empty states and rare route-level moments.
- **Headline** (650, 24px, 1.2): Main route title.
- **Title** (650, 17px, 1.3): Pane and section headings.
- **Body** (400, 15px, 1.5): Operational copy, descriptions, and evidence.
- **Label** (600, 13px, 1.35): Field labels, metadata, and compact controls.
- **Code** (400, 12px, 1.55): Source diffs, commands, identifiers, and paths.

### Named Rules

**The Sentence Case Rule.** Labels and headings use sentence case. Uppercase is
reserved for literal identifiers such as AP-001.

**The Evidence Width Rule.** Long prose stays near 70 characters; evidence and
code use the available workspace width.

## Layout

Desktop uses a compact navigation rail, a 56px contextual header, and a
full-height work area. Audit setup pairs one unframed form column with a sticky
320px run ledger. Live audit uses a compact path source list, a dominant
evidence stage, and a findings inspector. Barrier Map uses a wide journey
canvas with a persistent evidence inspector. Repair uses a dominant diff
workspace between a collapsible evidence brief and a verification inspector.

At medium widths, the rail collapses and inspectors become switchable panes.
Below 768px, navigation moves to the bottom, command actions sit in a stable
action dock, Barrier Map defaults to its linear representation, and repair
opens on the diff with Evidence and Verification tabs. All screens reflow to
320 CSS pixels without horizontal page overflow.

Spacing follows a 4/8/12/16/24/32/48px rhythm. Major regions use whitespace and
one divider, not floating section cards. Fixed-format panes, screenshot stages,
toolbars, and icon buttons use stable constraints so loading and status text do
not shift layout.

## Elevation & Depth

The system is flat by default. Depth comes from tonal surface changes and
separators. Shadows are limited to dialogs, drawers above content, and
annotation pins that must remain legible over screenshots.

### Named Rules

**The Flat Workbench Rule.** Primary work surfaces never float inside decorative
cards.

**The Overlay Earns Elevation Rule.** Only content that temporarily sits above
the workflow receives a shadow.

## Shapes

Controls use gently rounded corners at 5px or 8px. General cards never exceed
8px. Full-height panes meet edge to edge and are separated by 1px rules.
Circular geometry is reserved for annotation pins, progress position, and
native radio controls; it is not a default container for sequence numbers or
icons.

## Components

### Buttons

- **Shape:** Gently rounded rectangle (8px) with stable 40px desktop height and
  44px touch height.
- **Primary:** Operational blue with white text, used once per decision group.
- **Hover / Focus:** Slight tonal change; a 3px external focus ring remains
  visible and does not move layout.
- **Secondary:** White or transparent with a system-rule border.
- **Destructive:** Barrier red is reserved for cancel, deny, and destructive
  rewind consequences.

### Segmented Controls

- **Style:** One compact shared container with a selected tonal fill.
- **State:** Native radio semantics remain available to keyboard and assistive
  technology.

### Cards / Containers

- **Corner Style:** 8px only for repeated findings, dialogs, and discrete report
  items.
- **Background:** True Surface or Surface Subtle.
- **Shadow Strategy:** None at rest.
- **Border:** One system-rule boundary when separation is otherwise ambiguous.
- **Internal Padding:** 16px or 24px.

### Inputs / Fields

- **Style:** White fill, system-rule border, 8px corners, 44px minimum height.
- **Focus:** Operational blue border plus a non-overlapping focus outline.
- **Error / Disabled:** Error text remains connected to the field; disabled
  state retains readable labels and a nearby explanation.

### Navigation

The desktop rail uses icon and text labels with a subtle selected background
and a blue leading indicator. The contextual header contains breadcrumb,
current object, durable state, companion freshness, and route-valid commands.
Mobile uses a five-item bottom navigation with labels and stable touch targets.

### Status Mark

Status is a compact icon-and-text treatment, not a collection of decorative
pills. Companion connection, event freshness, and audit or repair state remain
separate signals.

### Authority Gate

Plan, tool, patch, and rewind approval use a dedicated authority region with
the exact action, consequence, scope, risk, and available decision. Approval
focus moves to the gate heading and returns to the invoking control when the
decision resolves.

### Loading Scaffold

Route loading renders the destination's stable structure using neutral
skeleton blocks. Spinners are limited to small commands already in progress.
Evidence loading preserves screenshot aspect ratio; diff loading preserves file
navigation and line gutters.

## Do's and Don'ts

### Do:

- **Do** make screenshots, affected actions, diffs, and verification the largest
  visual elements.
- **Do** use one contextual header and one primary action per decision group.
- **Do** preserve selected step, finding, and file context across navigation.
- **Do** write error states as what happened, what remains preserved, and the
  next safe action.
- **Do** use 160-220ms motion to explain pane and route state changes.
- **Do** replace movement with immediate state changes under reduced motion.

### Don't:

- **Don't** recreate Apple trademarks, proprietary icons, product silhouettes,
  or promotional glass effects.
- **Don't** use the former beige, dark-rail, cyan/coral visual world.
- **Don't** nest cards, float page sections, or give every status a bordered
  pill.
- **Don't** animate high-frequency event rows or use decorative continuous
  motion.
- **Don't** hide map information from the synchronized linear representation.
- **Don't** use vague authority actions such as Continue.
