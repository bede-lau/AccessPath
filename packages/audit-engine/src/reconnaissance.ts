import {
  chromium as defaultChromium,
  type Browser,
  type Page,
} from "playwright";

import {
  TargetPolicyError,
  validateResponseSize,
  validateTarget,
} from "./target-policy";
import type {
  ReconnaissanceOptions,
  ReconnaissanceResult,
} from "./types";

const MAX_CONSOLE_MESSAGES = 20;
const MAX_FAILED_REQUESTS = 20;

type PageInventory = Omit<
  ReconnaissanceResult,
  | "startUrl"
  | "finalUrl"
  | "targetPolicy"
  | "consoleMessages"
  | "failedRequests"
>;

function bounded(value: string | null | undefined, max = 160): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

async function collectPageInventory(page: Page): Promise<PageInventory> {
  return page.evaluate(() => {
    const text = (value: string | null | undefined, max = 160) =>
      (value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
    const visible = (element: Element) => {
      if (!(element instanceof HTMLElement)) {
        return true;
      }
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    const referencedText = (element: Element, attribute: string) =>
      text(
        (element.getAttribute(attribute) ?? "")
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" "),
      );
    const accessibleName = (element: Element) => {
      const direct = text(element.getAttribute("aria-label"));
      if (direct) return direct;
      const referenced = referencedText(element, "aria-labelledby");
      if (referenced) return referenced;
      if (element instanceof HTMLInputElement && element.id) {
        const explicit = text(
          document.querySelector(`label[for="${CSS.escape(element.id)}"]`)
            ?.textContent,
        );
        if (explicit) return explicit;
      }
      const wrapping = text(element.closest("label")?.textContent);
      if (wrapping) return wrapping;
      if (
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement
      ) {
        const placeholder = text(element.placeholder);
        if (placeholder) return placeholder;
      }
      if (element instanceof HTMLImageElement) {
        return text(element.alt);
      }
      return text(element.textContent);
    };
    const implicitRole = (element: Element) => {
      const explicit = text(element.getAttribute("role"), 40);
      if (explicit) return explicit;
      const tag = element.tagName.toLowerCase();
      if (tag === "button") return "button";
      if (tag === "a" && element.hasAttribute("href")) return "link";
      if (tag === "select") return "combobox";
      if (tag === "textarea") return "textbox";
      if (tag === "nav") return "navigation";
      if (tag === "main") return "main";
      if (tag === "header") return "banner";
      if (tag === "footer") return "contentinfo";
      if (tag === "aside") return "complementary";
      if (tag === "form") return "form";
      if (element instanceof HTMLInputElement) {
        if (element.type === "checkbox") return "checkbox";
        if (element.type === "radio") return "radio";
        if (["button", "submit", "reset"].includes(element.type)) {
          return "button";
        }
        return "textbox";
      }
      return undefined;
    };

    const headings = [
      ...document.querySelectorAll("h1,h2,h3,h4,h5,h6,[role='heading']"),
    ]
      .filter(visible)
      .slice(0, 24)
      .map((element) => ({
        level:
          Number(element.getAttribute("aria-level")) ||
          Number(element.tagName.slice(1)) ||
          0,
        text: text(element.textContent),
      }))
      .filter((heading) => heading.text);

    const landmarks = [
      ...document.querySelectorAll(
        "main,nav,header,footer,aside,form,[role='main'],[role='navigation'],[role='banner'],[role='contentinfo'],[role='complementary'],[role='form'],[role='search']",
      ),
    ]
      .filter(visible)
      .slice(0, 24)
      .map((element) => ({
        role: implicitRole(element) ?? "region",
        name: accessibleName(element) || undefined,
      }));

    const interactive = [
      ...document.querySelectorAll(
        "button,input,select,textarea,a[href],[role],[contenteditable='true']",
      ),
    ].filter(visible);
    const controls = interactive.slice(0, 80).map((element) => ({
      tag: element.tagName.toLowerCase(),
      role: implicitRole(element),
      name: accessibleName(element) || undefined,
      label:
        text(element.getAttribute("aria-label")) ||
        referencedText(element, "aria-labelledby") ||
        undefined,
      type:
        element instanceof HTMLInputElement
          ? text(element.type, 40)
          : undefined,
      required:
        element.hasAttribute("required") ||
        element.getAttribute("aria-required") === "true",
      disabled:
        element.hasAttribute("disabled") ||
        element.getAttribute("aria-disabled") === "true",
    }));

    const links = [...document.querySelectorAll("a[href]")]
      .filter(visible)
      .slice(0, 40)
      .map((element) => ({
        name: accessibleName(element),
        href: text((element as HTMLAnchorElement).href, 500),
      }))
      .filter((link) => link.name || link.href);

    const completionPattern =
      /\b(submit|complete|finish|confirm|done|success|continue|save)\b/i;
    const completionCandidates = controls
      .filter((control) =>
        completionPattern.test(
          [control.name, control.label, control.type].filter(Boolean).join(" "),
        ),
      )
      .map((control) => control.name ?? control.label ?? control.type ?? "")
      .filter(Boolean)
      .slice(0, 12);

    return {
      title: text(document.title),
      lang: text(document.documentElement.lang, 40) || undefined,
      headings,
      landmarks,
      controls,
      links,
      formCount: document.querySelectorAll("form").length,
      unnamedInteractiveCount: controls.filter(
        (control) =>
          ["button", "link", "textbox", "checkbox", "radio", "combobox"].includes(
            control.role ?? "",
          ) && !control.name,
      ).length,
      completionCandidates,
    };
  });
}

export async function runReconnaissance(
  startUrl: string,
  targetPolicy: "public" | "local-explicit",
  options: ReconnaissanceOptions = {},
): Promise<ReconnaissanceResult> {
  await validateTarget(startUrl, targetPolicy, options.dnsResolver);
  if (options.signal?.aborted) {
    throw new DOMException("Reconnaissance cancelled.", "AbortError");
  }

  let browser: Browser | undefined;
  let page: Page | undefined;
  let navigationPolicyError: TargetPolicyError | undefined;
  let responsePolicyError: TargetPolicyError | undefined;
  const consoleMessages: string[] = [];
  const failedRequests: string[] = [];
  const closeOnAbort = () => {
    void browser?.close();
  };
  options.signal?.addEventListener("abort", closeOnAbort, { once: true });

  try {
    browser = await (options.chromium ?? defaultChromium).launch({
      headless: true,
    });
    const context = await browser.newContext({
      acceptDownloads: false,
      serviceWorkers: "block",
      permissions: [],
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
    });
    context.setDefaultTimeout(options.navigationTimeoutMs ?? 10_000);
    context.setDefaultNavigationTimeout(options.navigationTimeoutMs ?? 15_000);

    let navigationCount = 0;
    await context.route("**/*", async (route) => {
      try {
        const request = route.request();
        if (request.isNavigationRequest()) {
          navigationCount += 1;
          if (navigationCount > (options.maxRedirects ?? 10) + 1) {
            throw new TargetPolicyError(
              "TARGET_POLICY_DENIED",
              "Navigation redirect limit exceeded.",
            );
          }
        }
        await validateTarget(
          request.url(),
          targetPolicy,
          options.dnsResolver,
        );
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
      if (consoleMessages.length < MAX_CONSOLE_MESSAGES) {
        consoleMessages.push(
          bounded(`${message.type()}: ${message.text()}`, 500),
        );
      }
    });
    page.on("requestfailed", (request) => {
      if (failedRequests.length < MAX_FAILED_REQUESTS) {
        failedRequests.push(
          bounded(
            `${request.method()} ${request.url()} ${request.failure()?.errorText ?? "failed"}`,
            700,
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
      void popup.close();
    });

    try {
      await page.goto(startUrl, { waitUntil: "domcontentloaded" });
    } catch (error) {
      if (navigationPolicyError || responsePolicyError) {
        throw navigationPolicyError ?? responsePolicyError;
      }
      throw error;
    }
    if (options.signal?.aborted) {
      throw new DOMException("Reconnaissance cancelled.", "AbortError");
    }
    if (responsePolicyError) {
      throw responsePolicyError;
    }

    const inventory = await collectPageInventory(page);
    return {
      startUrl,
      finalUrl: page.url(),
      targetPolicy,
      ...inventory,
      consoleMessages,
      failedRequests,
    };
  } finally {
    options.signal?.removeEventListener("abort", closeOnAbort);
    await browser?.close().catch(() => undefined);
  }
}
