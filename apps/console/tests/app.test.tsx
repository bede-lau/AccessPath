// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { AccessPathEvent, TaskContract } from "@accesspath/contracts";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { App } from "../src/App";
import {
  auditBundle,
  blockedSession,
  findings,
  runningSession,
} from "./fixtures";

const api = vi.hoisted(() => ({
  getPublicConfig: vi.fn(),
  createAudit: vi.fn(),
  startAudit: vi.fn(),
  pauseAudit: vi.fn(),
  resumeAudit: vi.fn(),
  cancelAudit: vi.fn(),
  getAudit: vi.fn(),
  getAuditBundle: vi.fn(),
  downloadReport: vi.fn(),
  fetchArtifactUrl: vi.fn(),
  streamAuditEvents: vi.fn(),
}));

vi.mock("../src/api", () => ({
  ApiError: class ApiError extends Error {
    constructor(
      public readonly status: number,
      message: string,
    ) {
      super(message);
    }
  },
  ...api,
}));

function completionEvent(): AccessPathEvent<Record<string, unknown>> {
  return {
    schemaVersion: "1.0.0",
    eventId: "event-completed",
    sessionId: runningSession.id,
    sequence: 99,
    timestamp: "2026-07-28T09:01:00.000Z",
    type: "session.completed",
    payload: { outcome: "blocked" },
  };
}

async function startAuditFromSetup(): Promise<void> {
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Run reviewed audit" }),
    ).not.toHaveProperty("disabled", true),
  );
  fireEvent.click(screen.getByRole("button", { name: "Run reviewed audit" }));
  await screen.findByRole("heading", { name: "Live audit workspace" });
}

async function finishAuditAndOpenMap(): Promise<void> {
  api.streamAuditEvents.mockImplementationOnce(
    async (
      _sessionId: string,
      _lastEventId: string | undefined,
      onEvent: (event: AccessPathEvent<Record<string, unknown>>) => void,
    ) => {
      onEvent(completionEvent());
    },
  );
  await startAuditFromSetup();
  fireEvent.click(
    await screen.findByRole("button", { name: "Open Barrier Map" }),
  );
  await screen.findByRole("heading", { name: "Barrier Map" });
}

describe("P05 console surfaces", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/projects/demo/audits/new");
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    api.getPublicConfig.mockResolvedValue({
      schemaVersion: "1.0.0",
      supportsAudit: true,
      targetPolicies: ["public", "local-explicit"],
      reportFormats: ["html", "markdown", "json"],
      demoAidAppPort: 4173,
    });
    api.createAudit.mockResolvedValue({ ...runningSession, state: "ready" });
    api.startAudit.mockResolvedValue(runningSession);
    api.pauseAudit.mockResolvedValue({ ...runningSession, state: "paused" });
    api.resumeAudit.mockResolvedValue(runningSession);
    api.cancelAudit.mockResolvedValue({ ...runningSession, state: "cancelled" });
    api.getAudit.mockResolvedValue(blockedSession);
    api.getAuditBundle.mockResolvedValue(auditBundle);
    api.downloadReport.mockResolvedValue(undefined);
    api.fetchArtifactUrl.mockRejectedValue(new Error("No artifact requested"));
    api.streamAuditEvents.mockImplementation(
      () => new Promise<void>(() => undefined),
    );
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("associates an invalid target URL with its correction text", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("radio", { name: "Public HTTPS" }));
    fireEvent.change(screen.getByLabelText("Target URL"), {
      target: { value: "http://example.test/" },
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Run reviewed audit" }),
      ).not.toHaveProperty("disabled", true),
    );
    fireEvent.click(screen.getByRole("button", { name: "Run reviewed audit" }));

    const target = screen.getByLabelText("Target URL");
    const error = await screen.findByText("Public targets must use HTTPS.");
    expect(target.getAttribute("aria-invalid")).toBe("true");
    expect(target.getAttribute("aria-describedby")).toBe(error.id);
    expect(api.createAudit).not.toHaveBeenCalled();
  });

  it("submits edited task intent, success text, and reviewed step labels", async () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText("Task intent"), {
      target: { value: "Complete the fictional application by keyboard." },
    });
    fireEvent.change(screen.getByLabelText("Visible success text"), {
      target: { value: "Application test complete" },
    });
    fireEvent.change(screen.getByLabelText("Step 1"), {
      target: { value: "Choose assistance eligibility by keyboard" },
    });

    await startAuditFromSetup();

    const submitted = api.createAudit.mock.calls[0]?.[0] as TaskContract;
    expect(submitted.goal).toBe(
      "Complete the fictional application by keyboard.",
    );
    expect(submitted.success.visibleText).toBe("Application test complete");
    expect(submitted.expectedSteps[0]?.intent).toBe(
      "Choose assistance eligibility by keyboard",
    );
  });

  it("uses native keyboard-focusable controls for setup and reviewed steps", () => {
    render(<App />);
    expect(screen.getByRole("radio", { name: "Local explicit" }).tagName).toBe(
      "INPUT",
    );
    expect(
      screen.getByRole("button", { name: "Run reviewed audit" }).tagName,
    ).toBe("BUTTON");
    expect(screen.getByLabelText("Step 1").tagName).toBe("INPUT");
  });

  it("renders audit and step state as text independent of status color", async () => {
    render(<App />);
    await startAuditFromSetup();

    expect(screen.getByText("Running", { selector: ".status-badge" })).toBeDefined();
    expect(screen.getAllByText("queued").length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("Queued").length).toBeGreaterThan(0);
  });

  it("shows persistent stale-evidence copy when the event stream disconnects", async () => {
    api.streamAuditEvents.mockRejectedValueOnce(new Error("stream offline"));
    render(<App />);
    await startAuditFromSetup();

    expect(
      await screen.findByText(
        "Evidence may be stale while the event stream reconnects.",
      ),
    ).toBeDefined();
    expect(screen.getByRole("alert").textContent).toContain("stream offline");
  });

  it("keeps live announcements limited to connection and audit phase changes", async () => {
    api.streamAuditEvents.mockRejectedValueOnce(new Error("stream offline"));
    const { container } = render(<App />);
    await startAuditFromSetup();
    await screen.findByText(
      "Evidence may be stale while the event stream reconnects.",
    );

    const liveRegions = Array.from(
      container.querySelectorAll<HTMLElement>("[aria-live]"),
    );
    expect(liveRegions).toHaveLength(2);
    expect(liveRegions.map((region) => region.textContent)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Evidence may be stale"),
        "Audit Running.",
      ]),
    );
    expect(
      liveRegions.some((region) => region.textContent?.includes("queued")),
    ).toBe(false);
  });

  it("opens and closes the selected finding from the graph", async () => {
    render(<App />);
    await finishAuditAndOpenMap();

    fireEvent.click(
      screen.getByRole("button", {
        name: /Choose that the household needs help with essential costs/,
      }),
    );
    expect(
      await screen.findByRole("heading", {
        name: findings[0]?.affectedAction,
      }),
    ).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Close finding detail" }));
    expect(
      screen.getByRole("heading", { name: "Select a barrier" }),
    ).toBeDefined();
  });

  it("selects the same finding from the linear representation", async () => {
    render(<App />);
    await finishAuditAndOpenMap();
    fireEvent.click(screen.getByRole("button", { name: "Linear" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: /AP-002Phone purpose is not identifiedserious/,
      }),
    );

    await waitFor(() =>
      expect(
        screen.getByRole("heading", {
          name: findings[1]?.affectedAction,
        }),
      ).toBeDefined(),
    );
  });
});
