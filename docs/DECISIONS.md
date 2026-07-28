# Architecture Decisions and Non-Goals

This file records decisions Qoder must treat as fixed unless the user explicitly
changes them.

## D-001: Audit target and repair target are separate

**Decision:** The audit plane accepts a running web URL. The repair plane
attaches a source repository only after the user requests remediation.

**Reason:** Runtime behavior cannot be inferred reliably from source code alone,
and URL-only audits reduce onboarding friction.

## D-002: Repair is local-first

**Decision:** The MVP uses a local companion and Qoder Agent SDK. Source code
stays on the developer machine.

**Rejected:** Uploading an entire repository to an AccessPath-hosted service.

**Reason:** Local execution reduces security concerns, avoids building OAuth and
cloud workspaces, and provides the strongest hackathon path.

## D-003: Use the official Qoder Agent SDK

**Decision:** The TypeScript package `@qoder-ai/qoder-agent-sdk` powers repair.

**Rejected:** Scraping or automating the Qoder IDE UI.

**Reason:** The SDK provides a supported embedding, streaming, tools,
permissions, sessions, subagents, skills, and checkpoints.

## D-004: Custom UI, not embedded IDE

**Decision:** Users operate through the AccessPath console. Qoder is an
observable agent engine behind the companion API.

The UI shows:

- Session phase
- Agent and tool events
- Target files
- Git diff
- Commands and test results
- Permission requests
- Checkpoints
- Verification status

Do not display hidden chain-of-thought.

## D-005: Deterministic-first audit

**Decision:** Playwright and axe-core produce primary evidence. Qoder can
classify, group, diagnose, and plan, but must not invent observation evidence.

**Rejected:** A free-form LLM browser agent as the only auditor.

**Reason:** The judging demo requires deterministic and reproducible behavior.

## D-006: Human-action findings

**Decision:** Findings are titled by affected user action before rule IDs.

Example:

```text
Keyboard users cannot reach "Use saved card"
```

Not:

```text
Focus order violation
```

## D-007: File artifacts instead of a database

**Decision:** Persist MVP state under `.accesspath/` as JSON, NDJSON, screenshots,
and Markdown or HTML reports.

**Rejected:** Database, ORM, migrations, accounts, and organization tenancy.

**Reason:** File artifacts are inspectable, portable, and sufficient for the
hackathon.

## D-008: Git worktree isolation

**Decision:** Every repair runs in a dedicated Git worktree and branch.

**Rules:**

- Never edit the base worktree.
- Never auto-push.
- Never auto-merge.
- Never discard pre-existing user changes.
- Rewind operates only inside the generated repair worktree.

## D-009: SSE for live events

**Decision:** Use Server-Sent Events from the local Fastify server to the React
console.

**Rejected:** WebSocket unless a concrete bidirectional requirement emerges.

**Reason:** Audit and repair updates are primarily server-to-client. Approval
actions can use ordinary HTTP requests.

## D-010: TypeScript monorepo

**Decision:** Use npm workspaces with React, Vite, Fastify, and shared TypeScript
packages.

**Reason:** One language across UI, companion, audit engine, contracts, and
Qoder SDK integration reduces implementation risk.

## D-011: No runtime accessibility overlay

**Decision:** AccessPath repairs source or produces a reviewable patch.

**Rejected:** Injecting a client-side overlay and claiming the underlying site
is fixed.

**Reason:** Overlays are fragile, can interfere with assistive technology, and
do not resolve source-level defects.

## D-012: Accessibility claims remain scoped

**Decision:** A passing run proves only the stated path and configured test
conditions.

Every final report must include:

- Tested path
- Browser and viewport
- Automated checks
- Keyboard checks
- Pending human review
- Excluded coverage
- Residual risk

## D-013: The defining UI is the Barrier Map

**Decision:** The Barrier Map is the primary differentiated product surface.

It must also have a complete linear accessible alternative.

## D-014: The fixture is an emergency-aid application

**Decision:** The demo application is a fictional emergency financial
assistance form.

**Reason:** The user impact is immediately understandable without introducing
real personal data or external system dependencies.

## D-015: One complete path before generalization

**Decision:** Build and polish one path:

```text
Check eligibility
  -> Create applicant profile
  -> Enter assistance details
  -> Review
  -> Submit test application
```

Do not add a second general-purpose audit flow until this vertical slice is
verified.

## D-016: Controlled Qoder permissions

**Decision:** Read, search, and bounded file operations can be permitted within
the repair worktree. Network access, out-of-scope paths, package installation,
Git push, destructive commands, and deployment require explicit rejection or
approval.

Do not use a bypass or unrestricted permission mode in the product.

## D-017: Qoder is used during build and runtime

**Decision:** The submission must demonstrate:

1. Qoder Spec, Quest, Experts, and Goal used to build AccessPath.
2. Qoder Agent SDK powering the local repair workflow.

Runtime SDK usage does not replace the requirement to build the project
primarily in Qoder.

## D-018: Definition of done

AccessPath is done only when:

- `npm run demo:reset` succeeds.
- The clean demo audit detects the seeded blocker.
- A repair can be initiated from the custom UI.
- Qoder produces a reviewable minimal patch.
- The same journey passes after repair.
- Evidence export completes.
- Lint, typecheck, unit, integration, and end-to-end tests pass.

## D-019: Local-first modular monolith

**Decision:** The hackathon MVP runs the console, companion API, browser audit,
artifact store, Git integration, and Qoder SDK host on the developer machine.
The audit and repair planes are logical security and data boundaries inside one
local product.

**Rejected for MVP:** A separately deployed public audit backend.

**Reason:** One runtime supports public, staging, preview, and localhost targets
without adding cloud job infrastructure, report synchronization, or a second
security perimeter. The contracts must still permit a future public-audit
adapter that accepts public HTTPS destinations only.
