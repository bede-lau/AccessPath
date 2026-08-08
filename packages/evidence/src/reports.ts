import type { AuditBundle, Finding } from "@accesspath/contracts";
import { relative } from "node:path";

import { canonicalJson } from "./canonical";
import { loadAuditBundle } from "./bundle";
import { redactText, redactValue } from "./redaction";
import {
  atomicWriteFile,
  type AuditDirectoryLayout,
} from "./storage";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function evidenceLabelCopy(label: Finding["evidenceLabel"]): string {
  switch (label) {
    case "observed":
      return "Seen during the task";
    case "deterministic-check":
      return "Found by an automated check";
    case "inferred":
      return "Possible cause";
    case "proposed":
      return "Suggested change";
    case "verified":
      return "Fix checked";
    case "manual-review-required":
      return "Needs a person to confirm";
    case "unsupported":
      return "Not enough evidence";
  }
}

function severityCopy(severity: Finding["severity"]): string {
  switch (severity) {
    case "blocker":
      return "Stops the task";
    case "critical":
      return "Can stop the task";
    case "serious":
      return "Major obstacle";
    case "moderate":
      return "Makes the task harder";
    case "minor":
      return "Smaller obstacle";
  }
}

function severityImpactCopy(severity: Finding["severity"]): string {
  switch (severity) {
    case "blocker":
      return "This problem stopped the task from being completed without assistance.";
    case "critical":
      return "This problem can stop the task or cause a serious error.";
    case "serious":
      return "This problem creates a major obstacle and may prevent completion.";
    case "moderate":
      return "This problem makes the task harder or less efficient.";
    case "minor":
      return "This problem creates a smaller obstacle that still needs attention.";
  }
}

function modalityCopy(modality: Finding["modality"][number]): string {
  switch (modality) {
    case "keyboard":
      return "Keyboard users";
    case "screen-reader":
      return "Screen reader users";
    case "visual":
      return "People with low vision";
    case "cognitive":
      return "People who benefit from clear, predictable forms";
    case "motor":
      return "People who use assisted input or saved details";
    case "other":
      return "Some users";
  }
}

function joinHumanList(items: string[]): string {
  if (items.length <= 1) {
    return items[0] ?? "Some users";
  }
  if (items.length === 2) {
    return `${items[0]} and ${items[1]}`;
  }
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

function affectedPeopleCopy(finding: Finding): string {
  return joinHumanList([...new Set(finding.modality.map(modalityCopy))]);
}

function findingMarkdown(finding: Finding): string {
  const lines = [
    `### ${finding.title}`,
    "",
    `**During:** ${finding.affectedAction}`,
    "",
    `**Why it matters:** ${affectedPeopleCopy(finding)}. ${severityImpactCopy(finding.severity)}`,
    "",
    `**What happened:** ${finding.observation}`,
  ];
  if (finding.remediationGuidance !== undefined) {
    lines.push("", `**What to do next:** ${finding.remediationGuidance}`);
  }
  lines.push("", "**How to check the fix:**");
  if (finding.manualReview.length === 0) {
    lines.push("- No separate human check was recorded for this problem.");
  } else {
    lines.push(...finding.manualReview.map((item) => `- ${item}`));
  }
  lines.push(
    "",
    "#### Technical details",
    "",
    `- Finding ID: \`${finding.id}\``,
    `- Stored priority: ${severityCopy(finding.severity)} (\`${finding.severity}\`)`,
    `- Evidence type: ${evidenceLabelCopy(finding.evidenceLabel)} (\`${finding.evidenceLabel}\`)`,
    `- Source: \`${finding.source}\``,
    `- State: \`${finding.state}\``,
    `- WCAG references: ${finding.wcagRefs.length > 0 ? finding.wcagRefs.join(", ") : "None recorded"}`,
    `- Page element: ${finding.selector === undefined ? "None recorded" : `\`${finding.selector}\``}`,
    `- Evidence artifacts: ${finding.evidenceIds.length > 0 ? finding.evidenceIds.map((id) => `\`${id}\``).join(", ") : "None"}`,
  );
  if (
    finding.deterministicChecks !== undefined &&
    finding.deterministicChecks.length > 0
  ) {
    lines.push(
      "",
      "**Repeatable checks:**",
      ...finding.deterministicChecks.map((check) => `- ${check}`),
    );
  }
  if (finding.reproduction.length > 0) {
    lines.push(
      "",
      "**How to reproduce:**",
      ...finding.reproduction.map((step, index) => `${index + 1}. ${step}`),
    );
  }
  if (finding.diagnosis !== undefined) {
    lines.push(
      "",
      `**Likely cause, not yet confirmed:** ${finding.diagnosis}`,
    );
  }
  return lines.join("\n");
}

export function renderMarkdownReport(input: AuditBundle): string {
  const bundle = redactValue(input);
  const limitations =
    bundle.limitations.length === 0
      ? "- No additional limitations were recorded."
      : bundle.limitations.map((item) => `- ${item}`).join("\n");
  const findings =
    bundle.findings.length === 0
      ? "No findings were recorded."
      : bundle.findings.map(findingMarkdown).join("\n\n");
  const artifacts =
    bundle.artifacts.length === 0
      ? "- None"
      : bundle.artifacts
          .map(
            (artifact) =>
              `- \`${artifact.id}\` (${artifact.kind}, ${artifact.sensitivity}, sha256 \`${artifact.sha256}\`)`,
          )
          .join("\n");

  return redactText(`# AccessPath accessibility audit

## Summary

**Task:** ${bundle.task.title}

${bundle.task.goal}

- Result: ${bundle.outcome}
- Problems found: ${bundle.findings.length}
- Task steps checked: ${bundle.steps.length}

## Problems found

${findings}

## Limitations and checks still needed

${limitations}

Technical evidence labels remain attached to each problem so the plain-language
summary does not change what was recorded. A likely cause or suggested fix is
not a verified result. A scan is not a site-wide accessibility compliance claim.

## Technical audit details

- Bundle ID: \`${bundle.id}\`
- Audit session: \`${bundle.auditSessionId}\`
- Run: \`${bundle.runId}\`
- Created: ${bundle.createdAt}
- Browser: ${bundle.environment.browser} ${bundle.environment.browserVersion}
- Automated checks: axe ${bundle.environment.axeVersion}
- Viewport: ${bundle.environment.viewport.width} x ${bundle.environment.viewport.height}
- Target origin: ${bundle.environment.targetOrigin}

## Integrity and provenance

- Manifest algorithm: ${bundle.integrity.algorithm}
- Manifest hash: \`${bundle.integrity.manifestHash}\`

### Artifact references

${artifacts}
`);
}

export function renderHtmlReport(input: AuditBundle): string {
  const markdown = renderMarkdownReport(input);
  const bundle = redactValue(input);
  const findings = bundle.findings
    .map(
      (finding) => `<article>
<h3>${escapeHtml(finding.title)}</h3>
<p><strong>During:</strong> ${escapeHtml(finding.affectedAction)}</p>
<p><strong>Why it matters:</strong> ${escapeHtml(`${affectedPeopleCopy(finding)}. ${severityImpactCopy(finding.severity)}`)}</p>
<p><strong>What happened:</strong> ${escapeHtml(finding.observation)}</p>
${finding.remediationGuidance === undefined ? "" : `<p><strong>What to do next:</strong> ${escapeHtml(finding.remediationGuidance)}</p>`}
<p><strong>How to check the fix:</strong></p>
${finding.manualReview.length === 0 ? "<p>No separate human check was recorded for this problem.</p>" : `<ul>${finding.manualReview.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`}
<details>
<summary>Technical details</summary>
<dl>
<dt>Finding ID</dt><dd><code>${escapeHtml(finding.id)}</code></dd>
<dt>Stored priority</dt><dd>${escapeHtml(severityCopy(finding.severity))} (<code>${escapeHtml(finding.severity)}</code>)</dd>
<dt>Evidence type</dt><dd>${escapeHtml(evidenceLabelCopy(finding.evidenceLabel))} (<code>${escapeHtml(finding.evidenceLabel)}</code>)</dd>
<dt>Source</dt><dd><code>${escapeHtml(finding.source)}</code></dd>
<dt>State</dt><dd>${escapeHtml(finding.state)}</dd>
<dt>WCAG references</dt><dd>${finding.wcagRefs.length === 0 ? "None recorded" : escapeHtml(finding.wcagRefs.join(", "))}</dd>
<dt>Page element</dt><dd>${finding.selector === undefined ? "None recorded" : `<code>${escapeHtml(finding.selector)}</code>`}</dd>
</dl>
${finding.deterministicChecks === undefined || finding.deterministicChecks.length === 0 ? "<p>No repeatable automated check was recorded.</p>" : `<p><strong>Repeatable checks:</strong></p><ul>${finding.deterministicChecks.map((check) => `<li>${escapeHtml(check)}</li>`).join("")}</ul>`}
${finding.reproduction.length === 0 ? "" : `<p><strong>How to reproduce:</strong></p><ol>${finding.reproduction.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol>`}
${finding.diagnosis === undefined ? "" : `<p><strong>Likely cause, not yet confirmed:</strong> ${escapeHtml(finding.diagnosis)}</p>`}
<p><strong>Evidence artifacts:</strong> ${finding.evidenceIds.length === 0 ? "None" : finding.evidenceIds.map((id) => `<code>${escapeHtml(id)}</code>`).join(", ")}</p>
</details>
</article>`,
    )
    .join("\n");
  const limitations = bundle.limitations
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");
  const artifacts = bundle.artifacts
    .map(
      (artifact) =>
        `<li><code>${escapeHtml(artifact.id)}</code> (${escapeHtml(artifact.kind)}, ${escapeHtml(artifact.sensitivity)}, sha256 <code>${escapeHtml(artifact.sha256)}</code>)</li>`,
    )
    .join("");

  return redactText(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AccessPath accessibility audit - ${escapeHtml(bundle.id)}</title>
<style>
body{font-family:system-ui,sans-serif;line-height:1.5;max-width:72rem;margin:0 auto;padding:2rem;color:#17231d;background:#fff}
code{overflow-wrap:anywhere}article{border-top:1px solid #d7d2c5;padding-block:1.25rem}article>p{max-width:70ch}summary{font-weight:700;cursor:pointer;padding-block:.5rem}details{margin-top:1rem;padding:.75rem 1rem;background:#f7f7f5;border-left:4px solid #d7d2c5}dt{font-weight:700}dd{margin:0 0 .5rem}
@media(max-width:40rem){body{padding:1rem}}@media print{body{max-width:none}}
</style>
</head>
<body>
<main>
<h1>AccessPath accessibility audit</h1>
<section aria-labelledby="summary"><h2 id="summary">Summary</h2>
<h3>${escapeHtml(bundle.task.title)}</h3>
<p>${escapeHtml(bundle.task.goal)}</p>
<dl>
<dt>Result</dt><dd>${escapeHtml(bundle.outcome)}</dd>
<dt>Problems found</dt><dd>${bundle.findings.length}</dd>
<dt>Task steps checked</dt><dd>${bundle.steps.length}</dd>
</dl></section>
<section aria-labelledby="problems"><h2 id="problems">Problems found</h2>${findings || "<p>No problems were recorded.</p>"}</section>
<section aria-labelledby="limitations"><h2 id="limitations">Limitations and checks still needed</h2><ul>${limitations || "<li>No additional limitations were recorded.</li>"}</ul>
<p>Technical evidence labels remain attached to each problem so the plain-language summary does not change what was recorded. A likely cause or suggested fix is not a verified result. A scan is not a site-wide accessibility compliance claim.</p></section>
<section aria-labelledby="identity"><h2 id="identity">Technical audit details</h2>
<dl>
<dt>Bundle ID</dt><dd><code>${escapeHtml(bundle.id)}</code></dd>
<dt>Audit session</dt><dd><code>${escapeHtml(bundle.auditSessionId)}</code></dd>
<dt>Run</dt><dd><code>${escapeHtml(bundle.runId)}</code></dd>
<dt>Created</dt><dd>${escapeHtml(bundle.createdAt)}</dd>
<dt>Browser</dt><dd>${escapeHtml(`${bundle.environment.browser} ${bundle.environment.browserVersion}`)}</dd>
<dt>Automated checks</dt><dd>${escapeHtml(`axe ${bundle.environment.axeVersion}`)}</dd>
<dt>Viewport</dt><dd>${bundle.environment.viewport.width} x ${bundle.environment.viewport.height}</dd>
<dt>Target origin</dt><dd>${escapeHtml(bundle.environment.targetOrigin)}</dd>
</dl></section>
<section aria-labelledby="integrity"><h2 id="integrity">Integrity and provenance</h2><p>Manifest algorithm: ${bundle.integrity.algorithm}</p><p>Manifest hash: <code>${bundle.integrity.manifestHash}</code></p><h3>Artifact references</h3><ul>${artifacts || "<li>None</li>"}</ul></section>
</main>
<!-- Plain-text source checksum input is deliberately omitted; report is regenerated from bundle.json and content-addressed artifacts. -->
<!-- Markdown character count: ${markdown.length} -->
</body>
</html>
`);
}

export function renderJsonReport(input: AuditBundle): string {
  return `${canonicalJson(redactValue(input))}\n`;
}

export type PersistedReports = {
  markdown: string;
  html: string;
  json: string;
};

export async function regenerateReportsFromPersistedEvidence(
  layout: AuditDirectoryLayout,
): Promise<PersistedReports> {
  const bundle = await loadAuditBundle(layout);
  const reports = {
    markdown: renderMarkdownReport(bundle),
    html: renderHtmlReport(bundle),
    json: renderJsonReport(bundle),
  };
  await Promise.all([
    atomicWriteFile(
      layout.root,
      relative(layout.root, layout.markdownReportPath).replaceAll("\\", "/"),
      reports.markdown,
    ),
    atomicWriteFile(
      layout.root,
      relative(layout.root, layout.htmlReportPath).replaceAll("\\", "/"),
      reports.html,
    ),
    atomicWriteFile(
      layout.root,
      relative(layout.root, layout.jsonReportPath).replaceAll("\\", "/"),
      reports.json,
    ),
  ]);
  return reports;
}
