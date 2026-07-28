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

function findingMarkdown(finding: Finding): string {
  const lines = [
    `### ${finding.title}`,
    "",
    `- Finding ID: \`${finding.id}\``,
    `- Affected action: ${finding.affectedAction}`,
    `- Severity: ${finding.severity}`,
    `- Evidence label: ${finding.evidenceLabel}`,
    `- State: ${finding.state}`,
    `- Evidence artifacts: ${finding.evidenceIds.length > 0 ? finding.evidenceIds.map((id) => `\`${id}\``).join(", ") : "None"}`,
    "",
    `**Observation:** ${finding.observation}`,
  ];
  if (finding.diagnosis !== undefined) {
    lines.push("", `**Inferred diagnosis:** ${finding.diagnosis}`);
  }
  if (finding.reproduction.length > 0) {
    lines.push(
      "",
      "**Reproduction:**",
      ...finding.reproduction.map((step, index) => `${index + 1}. ${step}`),
    );
  }
  if (finding.manualReview.length > 0) {
    lines.push(
      "",
      "**Manual review:**",
      ...finding.manualReview.map((item) => `- ${item}`),
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

  return redactText(`# AccessPath Audit Evidence

## Identity and tested conditions

- Bundle ID: \`${bundle.id}\`
- Audit session: \`${bundle.auditSessionId}\`
- Run: \`${bundle.runId}\`
- Created: ${bundle.createdAt}
- Outcome: ${bundle.outcome}
- Browser: ${bundle.environment.browser} ${bundle.environment.browserVersion}
- Automated checks: axe ${bundle.environment.axeVersion}
- Viewport: ${bundle.environment.viewport.width} x ${bundle.environment.viewport.height}
- Target origin: ${bundle.environment.targetOrigin}

## Task-path outcome

**${bundle.task.title}**

${bundle.task.goal}

Recorded steps: ${bundle.steps.length}

## Barrier summary

${findings}

## Limitations and residual risk

${limitations}

Evidence labels are preserved as persisted. Observed and deterministic evidence
must not be read as inferred diagnosis, proposed repair, verified result, or
manual review.

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
<dl>
<dt>Finding ID</dt><dd><code>${escapeHtml(finding.id)}</code></dd>
<dt>Affected action</dt><dd>${escapeHtml(finding.affectedAction)}</dd>
<dt>Severity</dt><dd>${escapeHtml(finding.severity)}</dd>
<dt>Evidence label</dt><dd>${escapeHtml(finding.evidenceLabel)}</dd>
<dt>State</dt><dd>${escapeHtml(finding.state)}</dd>
</dl>
<p><strong>Observation:</strong> ${escapeHtml(finding.observation)}</p>
${finding.diagnosis === undefined ? "" : `<p><strong>Inferred diagnosis:</strong> ${escapeHtml(finding.diagnosis)}</p>`}
<p><strong>Evidence artifacts:</strong> ${finding.evidenceIds.length === 0 ? "None" : finding.evidenceIds.map((id) => `<code>${escapeHtml(id)}</code>`).join(", ")}</p>
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
<title>AccessPath Audit Evidence - ${escapeHtml(bundle.id)}</title>
<style>
body{font-family:system-ui,sans-serif;line-height:1.5;max-width:72rem;margin:0 auto;padding:2rem;color:#17231d;background:#fff}
code{overflow-wrap:anywhere}article{border-top:1px solid #d7d2c5;padding-block:1rem}dt{font-weight:700}dd{margin:0 0 .5rem}
@media(max-width:40rem){body{padding:1rem}}@media print{body{max-width:none}}
</style>
</head>
<body>
<main>
<h1>AccessPath Audit Evidence</h1>
<section aria-labelledby="identity"><h2 id="identity">Identity and tested conditions</h2>
<dl>
<dt>Bundle ID</dt><dd><code>${escapeHtml(bundle.id)}</code></dd>
<dt>Audit session</dt><dd><code>${escapeHtml(bundle.auditSessionId)}</code></dd>
<dt>Run</dt><dd><code>${escapeHtml(bundle.runId)}</code></dd>
<dt>Created</dt><dd>${escapeHtml(bundle.createdAt)}</dd>
<dt>Outcome</dt><dd>${escapeHtml(bundle.outcome)}</dd>
<dt>Browser</dt><dd>${escapeHtml(`${bundle.environment.browser} ${bundle.environment.browserVersion}`)}</dd>
<dt>Automated checks</dt><dd>${escapeHtml(`axe ${bundle.environment.axeVersion}`)}</dd>
<dt>Viewport</dt><dd>${bundle.environment.viewport.width} x ${bundle.environment.viewport.height}</dd>
<dt>Target origin</dt><dd>${escapeHtml(bundle.environment.targetOrigin)}</dd>
</dl></section>
<section aria-labelledby="task"><h2 id="task">Task-path outcome</h2><h3>${escapeHtml(bundle.task.title)}</h3><p>${escapeHtml(bundle.task.goal)}</p><p>Recorded steps: ${bundle.steps.length}</p></section>
<section aria-labelledby="barriers"><h2 id="barriers">Barrier summary</h2>${findings || "<p>No findings were recorded.</p>"}</section>
<section aria-labelledby="limitations"><h2 id="limitations">Limitations and residual risk</h2><ul>${limitations || "<li>No additional limitations were recorded.</li>"}</ul>
<p>Evidence labels are preserved as persisted. Observed and deterministic evidence must not be read as inferred diagnosis, proposed repair, verified result, or manual review.</p></section>
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
