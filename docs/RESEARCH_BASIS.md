# Research Basis and Epistemic Guardrails

AccessPath is grounded in two local research vaults. This document explains
which ideas are being transferred into the product and which claims remain
unsupported.

## Relevant repository evidence

### Traceable inclusive product requirements

The research paper:

```text
wiki/papers/doi-10.1017-dsj.2026.10065.md
```

argues for structured, modular, and traceable integration of user-group
requirements throughout context analysis, requirement elicitation, design,
evaluation, and long-term validation.

Product transfer:

- Every barrier maps from user context to requirement, evidence, source change,
  and verification result.
- Inclusion is a workflow checkpoint, not an after-the-fact label.
- Reports preserve traceability and unresolved limitations.

### Neurodivergent interaction and attention

The research paper:

```text
wiki/papers/doi-10.1017-dsj.2026.10059.md
```

examines eye-tracking differences during design tasks among participants with
and without ADHD.

Product transfer:

- Avoid treating accessibility as screen-reader support only.
- Include cognitive load, instruction clarity, stable layout, and error
  recovery as product concerns.
- Do not infer a disability from a single behavioral signal.

### Evidence-grounded conversational explanation

The HuntGPT paper:

```text
wiki/papers/doi-10.3390-telecom7030073.md
```

combines conventional anomaly detection, structured explanatory evidence, and
an LLM-facing analyst workflow.

Product transfer:

- Deterministic scanner and browser evidence remain authoritative.
- Qoder interprets and operationalizes evidence rather than replacing it.
- Every explanation links back to the observed artifact.

### Trajectory anomaly localization

The second brain paper:

```text
wiki/papers/TrajAD Trajectory Anomaly Detection for Trustworthy LLM Agents.md
```

frames process reliability as detection plus localization of the exact failed
step.

Product transfer:

- Audit and repair are modeled as ordered trajectories.
- A failed task is localized to the exact browser or repair step.
- Recovery targets the failed step rather than restarting without diagnosis.

### Architecture-aware evaluation

The second brain paper:

```text
wiki/papers/Toward Architecture-Aware Evaluation Metrics for LLM Agents.md
```

argues that evaluation should map failures to the architectural component that
produced them.

Product transfer:

- Audit-engine tests evaluate browser execution and evidence capture.
- Qoder-runner tests evaluate permissions, streaming, and repair behavior.
- Git-workspace tests evaluate isolation, diff, and rewind.
- UI tests evaluate accessible presentation and approval controls.

### Agent overconfidence and calibration

The second brain papers:

```text
wiki/papers/Agentic Uncertainty Reveals Agentic Overconfidence.md
wiki/papers/Agentic Confidence Calibration.md
```

warn that agent self-confidence is not a reliable proxy for correctness.

Product transfer:

- Qoder confidence never closes a finding.
- Verification depends on replay and tests.
- Adversarial review is preferred to self-reported certainty.

### Evidence and provenance pipeline

The current repository governance:

```text
wiki/clock.md
scripts/wiki_lint.py
scripts/download_papers.py
```

uses stable identifiers, structured schemas, provenance metadata, validation,
deduplication, and conflict handling.

Product transfer:

- Every run, step, finding, repair, and evidence artifact has a stable ID.
- Artifacts preserve source URL, timestamp, environment, commit, and tool
  provenance.
- Contradictory evidence is recorded rather than silently overwritten.

## Evidence hierarchy

AccessPath uses this hierarchy:

1. Direct browser observation and captured state
2. Deterministic automated check
3. Reproducible task replay
4. Source-code diagnosis
5. Agent inference
6. Agent confidence

Higher-numbered evidence must not override contradictory lower-numbered
evidence without explicit human review.

## Required labels

Every finding and repair statement must be labeled as one of:

- `observed`
- `deterministic-check`
- `inferred`
- `proposed`
- `verified`
- `manual-review-required`
- `unsupported`

## Epistemic restrictions

AccessPath cannot prove:

- Universal accessibility
- Legal compliance
- Usability for every disability or assistive technology
- Real human preference from synthetic personas
- Production safety from one local test run

AccessPath can demonstrate:

- The stated task path was exercised under documented conditions.
- A specific barrier was observed and reproduced.
- A source change was made in a bounded workspace.
- The same test conditions passed or failed after the change.
- Named automated and project tests produced recorded results.
- Remaining manual review and excluded coverage are explicit.
