import { createHash } from "node:crypto";
import { createRequire } from "node:module";

import type {
  AccessPathEvent,
  ArtifactRef,
  AuditBundle,
  Finding,
  TaskContract,
  TaskStepResult,
} from "@accesspath/contracts";
import { TaskContractSchema } from "@accesspath/contracts";
import { chromium as defaultChromium, type Browser, type Page } from "playwright";

import { normalizeFindings } from "./findings";
import { redactSummary } from "./redaction";
import { describeAction, evaluateSuccess, executeInstruction } from "./task";
import {
  TargetPolicyError,
  validateResponseSize,
  validateTarget,
} from "./target-policy";
import type {
  ArtifactCapture,
  AuditEngineOptions,
  AuditFailureDiagnostic,
  AuditRunResult,
  AxeResult,
  BrowserObservation,
} from "./types";

const require = createRequire(import.meta.url);

function defaultIds() {
  let sequence = 0;
  return {
    next(prefix: string) {
      sequence += 1;
      return `${prefix}-${sequence.toString().padStart(6, "0")}`;
    },
  };
}

function sha256(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function defaultAxeRunner(page: Page): Promise<AxeResult> {
  let source: string;
  try {
    source = (require("axe-core") as { source: string }).source;
  } catch {
    throw new Error(
      "axe-core is required at runtime. Install the pinned audit-engine dependencies.",
    );
  }
  await page.addScriptTag({ content: source });
  return page.evaluate(async () => {
    const axe = (globalThis as unknown as {
      axe: { run(): Promise<AxeResult> };
    }).axe;
    return axe.run();
  });
}

async function checksForStep(
  page: Page,
  stepId: string,
): Promise<Record<string, boolean | string | number | null>> {
  if (stepId === "eligibility-choice") {
    const hook = page.locator("[data-barrier-id='AP-001']");
    return {
      ap001RoleCount: await page.getByRole("radio").count(),
      ap001KeyboardSemantics: await hook.evaluate((element) => {
        const options = [...element.querySelectorAll("[data-eligibility-value]")];
        return options.every(
          (option) =>
            option.getAttribute("role") === "radio" &&
            option.hasAttribute("tabindex"),
        );
      }),
    };
  }
  if (stepId === "profile-phone") {
    return {
      ap002Autocomplete: await page
        .locator("[data-barrier-id='AP-002']")
        .getAttribute("autocomplete"),
    };
  }
  if (stepId === "assistance-rent") {
    return {
      ap003NamedGroup:
        (await page.locator("fieldset:has([data-barrier-id='AP-003']) legend").count()) >
          0 ||
        (await page
          .locator("[data-barrier-id='AP-003'][role='group'][aria-label], [data-barrier-id='AP-003'][role='group'][aria-labelledby]")
          .count()) > 0,
    };
  }
  if (stepId === "review-invalid") {
    const summary = page.locator("[data-barrier-id='AP-004']");
    return {
      ap004SummaryVisible: await summary.isVisible(),
      ap004HasLink: (await summary.getByRole("link").count()) > 0,
      ap004FocusStayedOnSubmit: await page.evaluate(
        () =>
          document.activeElement?.textContent?.trim() ===
          "Submit test application",
      ),
    };
  }
  if (stepId === "submission-confirmation") {
    const confirmation = page.locator("[data-barrier-id='AP-005']");
    return {
      ap005Visible: await confirmation.isVisible(),
      ap005LiveSemantics:
        (await confirmation.getAttribute("role")) === "status" ||
        (await confirmation.getAttribute("aria-live")) !== null,
    };
  }
  return {};
}

function axeFindings(
  result: AxeResult,
  stepId: string,
  evidenceId: string,
): Finding[] {
  return result.violations.flatMap((violation, violationIndex) =>
    violation.nodes.map((node, nodeIndex) => ({
      id: `AXE-${sha256(`${stepId}:${violation.id}:${node.target.join(",")}`).slice(0, 12)}`,
      title: violation.help ?? violation.id,
      affectedAction: `Complete task step ${stepId}`,
      source: "axe" as const,
      evidenceLabel: "deterministic-check" as const,
      severity:
        violation.impact === "critical"
          ? ("critical" as const)
          : violation.impact === "serious"
            ? ("serious" as const)
            : violation.impact === "moderate"
              ? ("moderate" as const)
              : ("minor" as const),
      modality: ["other" as const],
      state: "open" as const,
      stepId,
      selector: node.target[0],
      wcagRefs: (violation.tags ?? []).filter((tag) => tag.startsWith("wcag")),
      ruleId: violation.id,
      observation:
        node.failureSummary ?? violation.description ?? "axe reported a violation.",
      reproduction: [`Run axe at task step ${stepId}.`],
      evidenceIds: [evidenceId],
      manualReview: [],
      _sort: `${violationIndex}:${nodeIndex}`,
    })),
  )
    .sort((left, right) => left._sort.localeCompare(right._sort))
    .map(({ _sort: _ignored, ...finding }) => finding);
}

export async function runAudit(
  task: TaskContract,
  options: AuditEngineOptions = {},
): Promise<AuditRunResult> {
  TaskContractSchema.parse(task);
  const clock = options.clock ?? { now: () => new Date() };
  const ids = options.idFactory ?? defaultIds();
  const auditSessionId = options.auditSessionId ?? ids.next("audit");
  const runId = ids.next("run");
  const bundleId = ids.next("bundle");
  const startedAt = clock.now();
  let eventSequence = 0;
  let browser: Browser | undefined;
  let page: Page | undefined;
  let timedOut = false;
  let navigationPolicyError: TargetPolicyError | undefined;
  let responsePolicyError: TargetPolicyError | undefined;
  let browserVersion = "unavailable";
  let axeVersion = "unavailable";
  let outcome: AuditBundle["outcome"];
  let diagnostic: AuditFailureDiagnostic | undefined;
  let targetOrigin = task.startUrl;
  const steps: TaskStepResult[] = [];
  const artifacts: ArtifactRef[] = [];
  const observations: BrowserObservation[] = [];
  const collectedAxeFindings: Finding[] = [];
  const limitations = [
    "Automated checks and one deterministic task path do not establish universal accessibility or legal compliance.",
    "Screen-reader behavior and human usability still require manual review.",
  ];
  const consoleMessages: string[] = [];
  const failedRequests: string[] = [];
  const fixtureSecrets = Object.values(task.fixtureValues);
  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    void browser?.close();
  }, task.timeoutMs);
  const cancelBrowser = () => {
    void browser?.close();
  };
  options.signal?.addEventListener("abort", cancelBrowser, { once: true });

  const emit = async (
    type: AccessPathEvent["type"],
    payload: Record<string, unknown>,
  ) => {
    eventSequence += 1;
    await options.onEvent?.({
      schemaVersion: "1.0.0",
      eventId: ids.next("event"),
      sessionId: auditSessionId,
      sequence: eventSequence,
      timestamp: clock.now().toISOString(),
      type,
      payload,
    });
  };

  const capture = async (
    input: Omit<ArtifactCapture, "id">,
  ): Promise<ArtifactRef> => {
    const captureInput = { ...input, id: ids.next("artifact") };
    const ref = options.captureArtifact
      ? await options.captureArtifact(captureInput)
      : {
          id: captureInput.id,
          kind: captureInput.kind,
          mimeType: captureInput.mimeType,
          sha256: sha256(captureInput.data),
          relativePath: `artifacts/${sha256(captureInput.data)}.${captureInput.extension}`,
          sensitivity: captureInput.sensitivity,
          description: captureInput.description,
        };
    artifacts.push(ref);
    await emit("artifact.created", { artifact: ref });
    return ref;
  };

  const throwIfAborted = () => {
    if (options.signal?.aborted) {
      throw new DOMException("Audit cancelled.", "AbortError");
    }
    if (clock.now().getTime() - startedAt.getTime() > task.timeoutMs) {
      throw new DOMException("Audit timed out.", "TimeoutError");
    }
  };

  try {
    const initialTarget = await validateTarget(
      task.startUrl,
      task.targetPolicy,
      options.dnsResolver,
    );
    targetOrigin = initialTarget.url.origin;
    await emit("session.created", {
      auditSessionId,
      taskId: task.id,
    });
    await emit("phase.changed", { state: "running", runId });

    browser = await (options.chromium ?? defaultChromium).launch({
      headless: true,
    });
    throwIfAborted();
    browserVersion = browser.version();
    const context = await browser.newContext({
      acceptDownloads: false,
      serviceWorkers: "block",
      permissions: [],
      viewport: {
        width: task.viewport.width,
        height: task.viewport.height,
      },
      deviceScaleFactor: task.viewport.deviceScaleFactor,
    });
    context.setDefaultTimeout(options.navigationTimeoutMs ?? 10_000);
    context.setDefaultNavigationTimeout(options.navigationTimeoutMs ?? 15_000);

    let navigationCount = 0;
    await context.route("**/*", async (route) => {
      const request = route.request();
      try {
        if (request.isNavigationRequest()) {
          navigationCount += 1;
          if (navigationCount > (options.maxRedirects ?? 10) + 1) {
            throw new TargetPolicyError(
              "TARGET_POLICY_DENIED",
              "Navigation redirect limit exceeded.",
            );
          }
        }
        await validateTarget(request.url(), task.targetPolicy, options.dnsResolver);
        await route.continue();
      } catch (error) {
        navigationPolicyError =
          error instanceof TargetPolicyError
            ? error
            : new TargetPolicyError(
                "TARGET_POLICY_DENIED",
                "Navigation target failed policy validation.",
              );
        await route.abort("blockedbyclient");
      }
    });

    page = await context.newPage();
    page.on("console", (message) => {
      if (consoleMessages.length < 50) {
        consoleMessages.push(
          redactSummary(`${message.type()}: ${message.text()}`, fixtureSecrets),
        );
      }
    });
    page.on("requestfailed", (request) => {
      if (failedRequests.length < 50) {
        failedRequests.push(
          redactSummary(
            `${request.method()} ${request.url()} ${request.failure()?.errorText ?? "failed"}`,
            fixtureSecrets,
          ),
        );
      }
    });
    page.on("response", (response) => {
      try {
        validateResponseSize(
          response.headers(),
          options.maxResponseBytes ?? 10 * 1024 * 1024,
        );
      } catch (error) {
        responsePolicyError =
          error instanceof TargetPolicyError
            ? error
            : new TargetPolicyError(
                "TARGET_POLICY_DENIED",
                "Response size failed policy validation.",
              );
        void page?.close().catch(() => undefined);
      }
    });
    page.on("download", (download) => {
      void download.cancel();
    });
    page.on("popup", (popup) => {
      void validateTarget(popup.url(), task.targetPolicy, options.dnsResolver)
        .then(() => popup.close())
        .catch(() => popup.close());
    });

    try {
      await page.goto(task.startUrl, { waitUntil: "domcontentloaded" });
    } catch (error) {
      if (navigationPolicyError || responsePolicyError) {
        throw navigationPolicyError ?? responsePolicyError;
      }
      throw error;
    }

    for (const [index, instruction] of task.expectedSteps.entries()) {
      throwIfAborted();
      const stepStarted = clock.now().toISOString();
      const evidence: ArtifactRef[] = [];
      let state: TaskStepResult["state"] = "passed";
      let observedOutcome = "";
      let assisted = false;

      await emit("audit.step.started", {
        instructionId: instruction.id,
        sequence: index,
      });

      try {
        observedOutcome = await executeInstruction(
          page,
          instruction,
          task.fixtureValues,
        );
      } catch (error) {
        if (
          instruction.id === "eligibility-choice" &&
          options.testAssist?.ap001 !== false &&
          (await page.locator("[data-barrier-id='AP-001']").count()) === 1
        ) {
          state = "blocked";
          assisted = true;
          await page
            .locator("[data-barrier-id='AP-001']")
            .getByText(instruction.action.kind === "click" ? instruction.action.name : "")
            .click();
          observedOutcome =
            "Unassisted reviewed radio action failed. A bounded pointer-only test assist selected the fixture option so downstream barriers could be observed.";
          limitations.push(
            "AP-001 required a recorded pointer-only test assist. The unassisted task path remained blocked and was not classified as successful.",
          );
          await emit("audit.step.blocked", {
            instructionId: instruction.id,
            reason: error instanceof Error ? error.message : String(error),
            testAssist: "pointer-click-fixture-option",
          });
        } else {
          throw error;
        }
      }

      if (instruction.checkpoint || state === "blocked") {
        const axe = await (options.axeRunner ?? defaultAxeRunner)(page);
        axeVersion = axe.testEngine?.version ?? axeVersion;
        const screenshot = await capture({
          kind: "screenshot",
          mimeType: "image/png",
          extension: "png",
          sensitivity: "project",
          description: `Screenshot after ${instruction.id}.`,
          data: await page.screenshot({ fullPage: true }),
        });
        evidence.push(screenshot);

        const focus = await page.evaluate(() => {
          const element = document.activeElement;
          if (!(element instanceof HTMLElement)) {
            return undefined;
          }
          const role = element.getAttribute("role") ?? element.tagName.toLowerCase();
          const name =
            element.getAttribute("aria-label") ??
            element.textContent?.trim().replace(/\s+/g, " ").slice(0, 160) ??
            "";
          return `${role}${name ? ` "${name}"` : ""}`;
        });
        const checks = await checksForStep(page, instruction.id);
        const checkpoint = await capture({
          kind: "accessibility-snapshot",
          mimeType: "application/json",
          extension: "json",
          sensitivity: "redacted",
          description: `Focus, action outcome, and deterministic checks after ${instruction.id}.`,
          data: Buffer.from(
            stableJson({
              stepId: instruction.id,
              url: page.url(),
              title: await page.title(),
              focus,
              actionOutcome: observedOutcome,
              assisted,
              checks,
            }),
          ),
        });
        evidence.push(checkpoint);
        const axeArtifact = await capture({
          kind: "axe-result",
          mimeType: "application/json",
          extension: "json",
          sensitivity: "redacted",
          description: `axe results after ${instruction.id}.`,
          data: Buffer.from(stableJson(axe)),
        });
        evidence.push(axeArtifact);
        const consoleArtifact = await capture({
          kind: "console-summary",
          mimeType: "application/json",
          extension: "json",
          sensitivity: "redacted",
          description: `Redacted console summary through ${instruction.id}.`,
          data: Buffer.from(stableJson(consoleMessages)),
        });
        evidence.push(consoleArtifact);
        const networkArtifact = await capture({
          kind: "network-summary",
          mimeType: "application/json",
          extension: "json",
          sensitivity: "redacted",
          description: `Redacted failed-request summary through ${instruction.id}.`,
          data: Buffer.from(stableJson(failedRequests)),
        });
        evidence.push(networkArtifact);

        observations.push({
          stepId: instruction.id,
          url: page.url(),
          assisted,
          focus,
          actionOutcome: observedOutcome,
          axe,
          consoleMessages: [...consoleMessages],
          failedRequests: [...failedRequests],
          checks,
          evidenceIds: evidence.map((item) => item.id),
        });
        collectedAxeFindings.push(
          ...axeFindings(axe, instruction.id, axeArtifact.id),
        );
      }

      const result: TaskStepResult = {
        id: ids.next("step"),
        instructionId: instruction.id,
        sequence: index,
        state,
        intent: instruction.intent,
        attemptedAction: describeAction(instruction.action),
        observedOutcome,
        url: page.url(),
        title: await page.title(),
        focusedElement: observations.at(-1)?.focus,
        startedAt: stepStarted,
        completedAt: clock.now().toISOString(),
        evidence,
      };
      steps.push(result);
      await emit("audit.step.completed", { step: result });
    }

    const success = await evaluateSuccess(page, task.success);
    const hadBlockedStep = steps.some((step) => step.state === "blocked");
    outcome = success.passed && !hadBlockedStep ? "passed" : "blocked";
    if (!success.passed || hadBlockedStep) {
      diagnostic = {
        code: "TASK_BLOCKED",
        message: hadBlockedStep
          ? "The unassisted task path was blocked; downstream observations used a recorded test assist."
          : success.failures.join(" "),
        stepId: steps.find((step) => step.state === "blocked")?.instructionId,
      };
    }
    await context.close();
  } catch (error) {
    const effectiveError = responsePolicyError ?? error;
    if (options.signal?.aborted) {
      diagnostic = { code: "CANCELLED", message: "Audit cancelled." };
      outcome = "cancelled";
    } else if (timedOut) {
      diagnostic = { code: "TIMEOUT", message: "Audit timed out." };
      outcome = "failed";
    } else if (effectiveError instanceof TargetPolicyError) {
      diagnostic = {
        code: effectiveError.code,
        message: effectiveError.message,
      };
      outcome = "failed";
    } else if (
      effectiveError instanceof DOMException &&
      effectiveError.name === "AbortError"
    ) {
      diagnostic = { code: "CANCELLED", message: effectiveError.message };
      outcome = "cancelled";
    } else if (
      effectiveError instanceof DOMException &&
      effectiveError.name === "TimeoutError"
    ) {
      diagnostic = { code: "TIMEOUT", message: effectiveError.message };
      outcome = "failed";
    } else {
      diagnostic = {
        code: page ? "TASK_BLOCKED" : "NAVIGATION_FAILED",
        message: redactSummary(
          effectiveError instanceof Error
            ? effectiveError.message
            : String(effectiveError),
          fixtureSecrets,
        ),
        stepId: task.expectedSteps[steps.length]?.id,
      };
      outcome = page ? "blocked" : "failed";
    }
  } finally {
    clearTimeout(timeoutHandle);
    options.signal?.removeEventListener("abort", cancelBrowser);
    await browser?.close().catch(() => undefined);
  }

  const findings = normalizeFindings({
    task,
    steps,
    observations,
    axeFindings: collectedAxeFindings,
  });
  for (const finding of findings) {
    await emit("finding.created", { finding });
  }
  const partialBundle = {
    schemaVersion: "1.0.0" as const,
    id: bundleId,
    auditSessionId,
    runId,
    createdAt: clock.now().toISOString(),
    environment: {
      browser: "chromium",
      browserVersion,
      axeVersion,
      viewport: {
        width: task.viewport.width,
        height: task.viewport.height,
      },
      targetOrigin,
    },
    task,
    outcome,
    steps,
    findings,
    artifacts,
    limitations,
  };
  const bundle: AuditBundle = {
    ...partialBundle,
    integrity: {
      algorithm: "sha256",
      manifestHash: sha256(stableJson(partialBundle)),
    },
  };
  await emit(
    outcome === "cancelled"
      ? "session.cancelled"
      : outcome === "failed"
        ? "session.failed"
        : "session.completed",
    { outcome, bundleId, diagnostic },
  );
  return { bundle, diagnostic };
}
