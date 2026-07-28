# Hackathon Submission and Judging Plan

## Event facts

- Event: Alibaba Cloud x Qoder Hackathon Singapore 2026
- Submission deadline: Wednesday, August 5, 2026, 11:30 PM GMT+8
- Internal target: Wednesday, August 5, 2026, 9:00 PM GMT+8
- Team size: up to four people; solo entries allowed
- Build expectation: Qoder is the primary build environment

The Luma page currently prints `2025` in the deadline line. The event title and
surrounding schedule are for 2026, and August 5, 2026 is Wednesday. Confirm the
deadline in the participant channel, then submit against the earlier internal
target.

Official event page:

`https://luma.com/92h6pyl1`

## Required public submission flow

1. Finalize the working project.
2. Publish a project post on LinkedIn or X.
3. Tag the official Alibaba Cloud and Qoder accounts.
4. Include a short write-up and/or demo video.
5. Complete the organizer submission form linked from Luma.

The public page does not expose every field in the organizer form. Open it
early and record any registered-participant-only requirements before final
submission day.

## Judging criteria

| Criterion | Weight | AccessPath proof |
|---|---:|---|
| Use of Qoder | 30% | Spec-driven plan, Quest execution, Experts collaboration, Goal closure, and embedded Agent SDK repair |
| Innovation and Creativity | 25% | Task-path Barrier Map and closed-loop evidence-to-repair workflow |
| Impact | 20% | Essential service scenario, accessible explanation, and intentional social distribution |
| Technical Execution | 15% | Deterministic browser audit, event contracts, worktree isolation, permissions, diff, tests, replay, and complete video |
| Presentation and UGC | 10% | Under-four-minute story, tagged social post, clear visuals, and honest scope |

## What "Use of Qoder" must prove

It is not enough to have Qoder installed or open during the demo.

The submission should show:

1. **Qoder as primary build tool**
   - reviewed Spec
   - Quest tasks mapped to build phases
   - Experts Mode used for cross-stack work
   - Goal used for measurable stabilization
   - changed-files review and Qoder task history

2. **Qoder inside the product**
   - official Agent SDK
   - streamed user-facing events
   - scoped tools and permission broker
   - session persistence
   - checkpoint and rewind
   - verified source edit in a local worktree

3. **Workflow reusability**
   - versioned repair manifest
   - repeatable task contract
   - configured tests
   - stable evidence bundle
   - prompt and permission policy that can work on another repository

## Submission assets

### Required

- public source repository
- concise project README
- working setup instructions
- demo video
- social post on LinkedIn or X
- correct Alibaba Cloud and Qoder tags
- organizer form response

### Strongly recommended

- architecture diagram
- screenshot of Barrier Map
- before/after evidence report
- screenshot of Qoder Spec
- screenshot of Experts Mode canvas
- screenshot of Goal completion
- short GIF of live repair timeline and diff
- limitations and security section
- hosted public project page or video landing page, if time allows

Do not make hosted AccessPath infrastructure a prerequisite for judging.

## Repository README outline

1. One-sentence product claim
2. 30-second demo GIF or video
3. Why the problem matters
4. How AccessPath works
5. How Qoder was used
6. Architecture
7. Quick start
8. Demo fixture
9. Security and privacy
10. Evidence and limitations
11. Team

## Recommended social post

### Opening

> A page can pass many automated checks and still block the task that matters.
> We built AccessPath with Qoder to audit a real user journey, locate the
> blocked action, repair it locally, and replay the same path with evidence.

### Body points

- audits public, staging, preview, or local URLs without requiring source
- groups findings around human actions in a Barrier Map
- uses the Qoder Agent SDK behind a custom repair console
- isolates changes in a Git worktree
- streams permissions, diffs, tests, and verification
- reports remaining manual review instead of claiming automatic compliance

### Closing

> Built primarily with Qoder Spec, Quest, Experts, and Goal workflows, with
> Qoder embedded into the product at runtime.

Add the real repository, video, product link, official account tags, team
members, and hackathon hashtag supplied by the organizers.

## Demo video structure

- 0:00-0:15: blocked essential task
- 0:15-0:45: URL audit and Barrier Map
- 0:45-1:10: evidence and affected action
- 1:10-2:00: local Qoder repair
- 2:00-2:35: diff and tests
- 2:35-3:00: replay, evidence report, and limitations

Include captions. Keep text readable on mobile and avoid background music that
competes with narration.

## Impact and reach plan

Impact is explicitly tied to post reach and engagement, so distribution is a
deliverable.

- Prepare the post and media on August 4.
- Publish early enough on August 5 for engagement before judging.
- Use one strong video rather than many weak clips.
- Ask teammates, accessibility practitioners, developer-tool builders, and
  local hackathon contacts for substantive feedback.
- Respond to comments with the demo link and technical details.
- Cross-post once with adapted copy rather than duplicating identical text.
- Do not use artificial engagement.

## Submission form answer bank

### Project name

AccessPath

### One-line description

AccessPath audits whether a person can complete an essential web task, then
uses Qoder locally to propose, verify, review, and rewind an evidence-backed
source repair.

### Problem

Accessibility scanners produce isolated rule violations, leaving teams to
reconstruct user impact, reproduce the failure, find the source, and prove the
repair. Critical task blockers are lost in the backlog.

### Solution

AccessPath runs a reviewed browser journey, builds a Barrier Map around failed
human actions, and exports traceable evidence. When the user owns the code, a
local companion creates an isolated Git worktree and uses the Qoder Agent SDK
to diagnose, edit, test, replay, and present a reviewable patch.

### Qoder usage

AccessPath was built through Qoder's Spec-driven Quest workflow, Experts Mode
for cross-stack implementation, and Goal mode for measurable release closure.
The product also embeds the official Qoder Agent SDK for streamed, permissioned
local repair, session control, checkpoints, and rewind.

### Innovation

The primary unit is not a rule violation or source file. It is the human action
that became blocked. AccessPath connects that action to evidence, a minimal
repair, replay, and residual uncertainty.

### Impact

The workflow helps teams prioritize essential journeys, reduces reproduction
time, makes repair evidence understandable across engineering and
accessibility roles, and lowers audit friction by accepting a URL before any
repository access.

### Technical execution

TypeScript monorepo, React, Fastify, Playwright, axe-core, versioned Zod
contracts, SSE event replay, file-based evidence, Git worktree isolation,
Qoder SDK permissions and streaming, test orchestration, and before/after task
verification.

### Limitations

The MVP covers one reviewed web task in Chromium and does not claim legal or
universal accessibility compliance. Manual assistive-technology review remains
required.

## Final checklist

- release commit and tag created
- public repository readable
- setup tested from fresh clone
- live demo passes three times
- fallback video and artifacts open offline
- captions checked
- official accounts tagged correctly
- all links public
- no tokens, cookies, private URLs, or personal paths
- social post published
- submission form confirmation saved
- submission completed by 9:00 PM GMT+8
