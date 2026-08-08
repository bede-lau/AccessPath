// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MissionWorkspace } from "../src/MissionWorkspace";
import type { MissionResource } from "../src/api";

const api = vi.hoisted(() => ({
  acceptMissionPatch: vi.fn(),
  cancelMission: vi.fn(),
  createMission: vi.fn(),
  decideMissionAuthorization: vi.fn(),
  downloadMissionReport: vi.fn(),
  getMission: vi.fn(),
  loadMissionScreenshot: vi.fn(),
  mergeVerifiedMissionPatch: vi.fn(),
  rejectMissionPatch: vi.fn(),
  runMission: vi.fn(),
  streamMissionEvents: vi.fn(),
  updateMissionPlan: vi.fn(),
}));

vi.mock("../src/api", () => api);

function mission(overrides: Partial<MissionResource> = {}): MissionResource {
  return {
    id: "mission-001",
    revision: 2,
    state: "ready",
    stagingUrl: "https://staging.example.com/checkout",
    repositorySource: {
      kind: "local",
      value: "C:\\work\\checkout",
    },
    objective: "A keyboard user can complete checkout.",
    plan: {
      frozen: false,
      steps: [
        { id: "step-1", instruction: "Open checkout" },
        { id: "step-2", instruction: "Submit the order by keyboard" },
      ],
    },
    observedSteps: [],
    proofThread: [],
    availability: {
      execution: "available",
      source: "bound",
    },
    reportAvailable: false,
    ...overrides,
  };
}

describe("Mission Workspace", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/missions/new");
    api.streamMissionEvents.mockImplementation(
      () => new Promise<void>(() => undefined),
    );
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("creates a mission from staging, repository source, and objective", async () => {
    api.createMission.mockResolvedValue(mission());
    render(<MissionWorkspace />);

    expect(
      screen.getByRole("heading", { name: "Define new mission" }),
    ).toBeDefined();
    expect(screen.queryByText("New mission")).toBeNull();
    expect(screen.getByPlaceholderText("Write an outcome")).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Proof Thread" })).toBeNull();
    expect(
      screen.queryByText(
        "The agent turns the outcome into an editable browser plan before observation or source work begins.",
      ),
    ).toBeNull();
    fireEvent.change(screen.getByLabelText("Staging URL"), {
      target: { value: "https://staging.example.com/checkout" },
    });
    fireEvent.change(screen.getByLabelText("Local repository path"), {
      target: { value: "C:\\work\\checkout" },
    });
    fireEvent.change(screen.getByLabelText("Objective"), {
      target: { value: "A keyboard user can complete checkout." },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Generate mission plan" }),
    );

    await waitFor(() =>
      expect(api.createMission).toHaveBeenCalledWith({
        stagingUrl: "https://staging.example.com/checkout",
        repositorySource: {
          kind: "local",
          value: "C:\\work\\checkout",
        },
        objective: "A keyboard user can complete checkout.",
      }),
    );
    expect(window.location.pathname).toBe("/missions/mission-001");
    expect(screen.queryByRole("heading", { name: "Proof Thread" })).toBeNull();
  });

  it("shows setup progress as the target, source, and outcome are completed", () => {
    render(<MissionWorkspace />);

    const progress = screen.getByLabelText(
      "Mission setup progress: 0 of 3 complete",
    );
    const generatePlan = screen.getByRole("button", {
      name: "Generate mission plan",
    }) as HTMLButtonElement;
    expect(progress).toBeDefined();
    expect(generatePlan.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Staging URL"), {
      target: { value: "http://127.0.0.1:4173/" },
    });
    expect(
      screen.getByLabelText("Mission setup progress: 1 of 3 complete"),
    ).toBeDefined();

    fireEvent.change(screen.getByLabelText("Local repository path"), {
      target: { value: "C:\\work\\accesspath" },
    });
    fireEvent.change(screen.getByLabelText("Objective"), {
      target: { value: "Complete the application." },
    });
    expect(
      screen.getByLabelText("Mission setup progress: 3 of 3 complete"),
    ).toBeDefined();
    expect(generatePlan.disabled).toBe(false);
  });

  it("requires and submits an explicit commit for a public Git source", async () => {
    api.createMission.mockResolvedValue(
      mission({
        repositorySource: {
          kind: "public-git",
          value: "https://github.com/accesspath/example.git",
          commit: "a".repeat(40),
        },
      }),
    );
    render(<MissionWorkspace />);

    fireEvent.change(screen.getByLabelText("Staging URL"), {
      target: { value: "https://staging.example.com/checkout" },
    });
    fireEvent.click(screen.getByLabelText("Public HTTPS Git URL"));
    fireEvent.change(screen.getByLabelText("Public repository URL"), {
      target: { value: "https://github.com/accesspath/example.git" },
    });
    fireEvent.change(screen.getByLabelText("Git commit SHA"), {
      target: { value: "a".repeat(40) },
    });
    fireEvent.change(screen.getByLabelText("Objective"), {
      target: { value: "A keyboard user can complete checkout." },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Generate mission plan" }),
    );

    await waitFor(() =>
      expect(api.createMission).toHaveBeenCalledWith({
        stagingUrl: "https://staging.example.com/checkout",
        repositorySource: {
          kind: "public-git",
          value: "https://github.com/accesspath/example.git",
          commit: "a".repeat(40),
        },
        objective: "A keyboard user can complete checkout.",
      }),
    );
  });

  it("edits the Qoder plan inline and freezes it when Run starts", async () => {
    const ready = mission();
    const frozen = mission({
      revision: 4,
      state: "running-audit",
      plan: { ...ready.plan, frozen: true },
    });
    const updated = mission({ revision: 3 });
    api.getMission.mockResolvedValue(ready);
    api.updateMissionPlan.mockResolvedValue(updated);
    api.runMission.mockResolvedValue(frozen);

    render(<MissionWorkspace missionId={ready.id} />);
    const firstStep = await screen.findByLabelText("Step 1");
    fireEvent.change(firstStep, {
      target: { value: "Open the checkout with the keyboard" },
    });
    await waitFor(() =>
      expect(firstStep).toHaveProperty(
        "value",
        "Open the checkout with the keyboard",
      ),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Run and freeze plan" }),
    );

    await waitFor(() =>
      expect(api.updateMissionPlan).toHaveBeenCalledWith(
        ready.id,
        ready.revision,
        [
          {
            id: "step-1",
            instruction: "Open the checkout with the keyboard",
          },
          ready.plan.steps[1],
        ],
      ),
    );
    expect(api.runMission).toHaveBeenCalledWith(ready.id, updated.revision);
    fireEvent.click(screen.getByRole("button", { name: /^Mission plan/i }));
    expect(
      await screen.findByRole("heading", { name: "Frozen mission steps" }),
    ).toBeDefined();
    expect(screen.getByLabelText("Step 1")).toHaveProperty("disabled", true);
    expect(screen.queryByRole("button", { name: /add step/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /remove step/i })).toBeNull();
  });

  it("shows one repair authorization with exact paths and commands", async () => {
    const awaiting = mission({
      state: "awaiting-repair-authorization",
      plan: { ...mission().plan, frozen: true },
      authorization: {
        id: "authorization-1",
        state: "pending",
        title: "Authorize the scoped repair",
        consequence: "Qoder may edit only the listed file and run one test.",
        paths: ["src/Checkout.tsx"],
        commands: ["npm test -- checkout"],
      },
    });
    api.getMission.mockResolvedValue(awaiting);
    api.decideMissionAuthorization.mockResolvedValue(
      mission({
        revision: 4,
        state: "repairing",
        plan: { ...awaiting.plan, frozen: true },
      }),
    );

    render(<MissionWorkspace missionId={awaiting.id} />);

    expect(
      await screen.findByRole("heading", {
        name: "Authorize the scoped repair",
      }),
    ).toBeDefined();
    expect(screen.getByText("src/Checkout.tsx")).toBeDefined();
    expect(screen.getByText("npm test -- checkout")).toBeDefined();
    fireEvent.click(
      screen.getByRole("button", { name: "Authorize repair once" }),
    );

    await waitFor(() =>
      expect(api.decideMissionAuthorization).toHaveBeenCalledWith(
        awaiting.id,
        awaiting.revision,
        "approve-once",
      ),
    );
    expect(
      await screen.findByRole("heading", { name: "Repairing" }),
    ).toBeDefined();
    expect(
      screen.queryByRole("button", { name: "Authorize repair once" }),
    ).toBeNull();
  });

  it("keeps the mission runnable from the scoped repair view before authorization exists", async () => {
    const ready = mission();
    const updated = mission({ revision: 3 });
    const running = mission({
      revision: 4,
      state: "running-audit",
      plan: { ...ready.plan, frozen: true },
    });
    api.getMission.mockResolvedValue(ready);
    api.updateMissionPlan.mockResolvedValue(updated);
    api.runMission.mockResolvedValue(running);
    api.streamMissionEvents.mockImplementation(
      async (
        _missionId: string,
        _lastEventId: string | undefined,
        onEvent: (event: {
          eventId: string;
          sessionId: string;
          sequence: number;
          timestamp: string;
          type: string;
          payload: Record<string, unknown>;
        }) => void,
      ) => {
        onEvent({
          eventId: "audit-phase-1",
          sessionId: ready.id,
          sequence: 1,
          timestamp: "2026-08-01T00:00:00.000Z",
          type: "phase.changed",
          payload: {
            childSessionId: "audit-001",
            state: "running",
          },
        });
        return new Promise<void>(() => undefined);
      },
    );

    render(<MissionWorkspace missionId={ready.id} />);

    fireEvent.click(
      await screen.findByRole("button", {
        name: /Scoped repair/,
      }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Run mission plan" }),
    );

    await waitFor(() =>
      expect(api.updateMissionPlan).toHaveBeenCalledWith(
        ready.id,
        ready.revision,
        ready.plan.steps,
      ),
    );
    expect(api.runMission).toHaveBeenCalledWith(ready.id, updated.revision);
    expect(
      await screen.findByRole("heading", { name: "Repair activity" }),
    ).toBeDefined();
    expect(await screen.findByText("Audit phase updated")).toBeDefined();
    expect(
      screen.queryByRole("button", { name: "Run mission plan" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Authorize repair once" }),
    ).toBeNull();
  });

  it("keeps an approved repair scope visible when revisiting that stage", async () => {
    const completed = mission({
      state: "completed",
      plan: { ...mission().plan, frozen: true },
      authorization: {
        id: "authorization-1",
        state: "approved",
        title: "Authorize the scoped repair",
        consequence: "Approve the listed repair.",
        paths: ["apps/demo-aid-app/public/index.html"],
        commands: ["npm run test"],
      },
      patch: {
        patch: "diff --git a/file b/file",
        stat: "1 file changed",
        changedFiles: ["apps/demo-aid-app/public/index.html"],
        state: "accepted",
      },
    });
    api.getMission.mockResolvedValue(completed);

    render(<MissionWorkspace missionId={completed.id} />);

    fireEvent.click(
      await screen.findByRole("button", { name: /Scoped repair/i }),
    );

    expect(
      await screen.findByRole("heading", {
        name: "Scoped repair authorization",
      }),
    ).toBeDefined();
    expect(screen.getByText("Authorization approved")).toBeDefined();
    expect(
      screen.getByText("apps/demo-aid-app/public/index.html"),
    ).toBeDefined();
    expect(screen.getByText("npm run test")).toBeDefined();
    expect(
      screen.queryByRole("button", { name: "Authorize repair once" }),
    ).toBeNull();
  });

  it("shows captured screenshots and plain-English problems for affected steps", async () => {
    const awaiting = mission({
      state: "awaiting-repair-authorization",
      plan: { ...mission().plan, frozen: true },
      observedSteps: [
        {
          id: "eligibility-choice",
          instruction: "Choose an eligibility option",
          state: "blocked",
          screenshot: {
            artifactId: "demo-evidence-ap-001",
            sessionId: "demo-evidence",
            alt: "Emergency assistance eligibility options.",
          },
          issues: [
            {
              id: "AP-001",
              summary:
                "You cannot choose an eligibility option using only a keyboard.",
            },
          ],
        },
        {
          id: "profile-phone",
          instruction: "Enter a phone number",
          state: "observation",
          screenshot: {
            artifactId: "screenshot-phone",
            sessionId: "audit-001",
            alt: "Screenshot captured after Enter a phone number.",
          },
          issues: [
            {
              id: "AP-002",
              summary:
                "The phone field does not help people use a saved phone number.",
            },
          ],
        },
        {
          id: "assistance-rent",
          instruction: "Choose rent or temporary housing assistance",
          state: "observation",
          screenshot: {
            artifactId: "screenshot-assistance",
            sessionId: "audit-001",
            alt: "Screenshot captured after Choose rent or temporary housing assistance.",
          },
          issues: [
            {
              id: "AP-003",
              summary:
                "A screen reader is not told what the assistance choices are for.",
            },
          ],
        },
        {
          id: "review-invalid",
          instruction: "Continue to review",
          state: "observation",
          screenshot: {
            artifactId: "screenshot-review",
            sessionId: "audit-001",
            alt: "Screenshot captured after Continue to review.",
          },
          issues: [
            {
              id: "AP-004",
              summary:
                "After an error, the page does not take you to the field that needs fixing.",
            },
          ],
        },
        {
          id: "submission-confirmation",
          instruction: "Confirm the application was submitted",
          state: "observation",
          screenshot: {
            artifactId: "screenshot-confirmation",
            sessionId: "audit-001",
            alt: "Screenshot captured after Confirm the application was submitted.",
          },
          issues: [
            {
              id: "AP-005",
              summary:
                "A screen reader is not told when the application has been submitted.",
            },
          ],
        },
      ],
    });
    api.getMission.mockResolvedValue(awaiting);
    api.loadMissionScreenshot.mockImplementation((artifactId: string) =>
      Promise.resolve(
        artifactId === "screenshot-phone"
          ? "blob:phone-screenshot"
          : "blob:eligibility-screenshot",
      ),
    );

    render(<MissionWorkspace missionId={awaiting.id} />);

    const observedStage = (await screen.findByText("Observed")).closest(
      "button",
    );
    expect(observedStage).not.toBeNull();
    fireEvent.click(observedStage!);
    expect(
      await screen.findByRole("heading", {
        name: "What happened at each affected step",
      }),
    ).toBeDefined();
    expect(
      screen.getByText(
        "You cannot choose an eligibility option using only a keyboard.",
      ),
    ).toBeDefined();
    expect(api.loadMissionScreenshot).not.toHaveBeenCalledWith(
      "demo-evidence-ap-001",
      "demo-evidence",
    );
    expect(
      (
        await screen.findByAltText("Emergency assistance eligibility options.")
      ).getAttribute("src"),
    ).toBe("/demo-evidence/ap-001.png");

    fireEvent.click(
      screen.getByRole("button", { name: /Enter a phone number/i }),
    );

    expect(
      await screen.findByText(
        "The phone field does not help people use a saved phone number.",
      ),
    ).toBeDefined();
    expect(api.loadMissionScreenshot).toHaveBeenCalledWith(
      "screenshot-phone",
      "audit-001",
    );
    expect(
      await screen.findByAltText(
        "Screenshot captured after Enter a phone number.",
      ),
    ).toBeDefined();

    for (const issueId of ["AP-003", "AP-004", "AP-005"]) {
      expect(screen.getByText(issueId)).toBeDefined();
    }

    fireEvent.click(
      screen.getByRole("button", {
        name: /Confirm the application was submitted/i,
      }),
    );

    expect(
      await screen.findByText(
        "A screen reader is not told when the application has been submitted.",
      ),
    ).toBeDefined();
    expect(api.loadMissionScreenshot).toHaveBeenCalledWith(
      "screenshot-confirmation",
      "audit-001",
    );
    expect(
      await screen.findByAltText(
        "Screenshot captured after Confirm the application was submitted.",
      ),
    ).toBeDefined();
  });

  it("renders safe streamed repair activity without exposing hidden reasoning", async () => {
    const repairing = mission({
      state: "repairing",
      plan: { ...mission().plan, frozen: true },
    });
    api.getMission.mockResolvedValue(repairing);
    api.streamMissionEvents.mockImplementation(
      async (
        _missionId: string,
        _lastEventId: string | undefined,
        onEvent: (event: {
          eventId: string;
          sessionId: string;
          sequence: number;
          timestamp: string;
          type: string;
          payload: Record<string, unknown>;
        }) => void,
      ) => {
        onEvent({
          eventId: "event-1",
          sessionId: "mission-001",
          sequence: 1,
          timestamp: "2026-07-31T00:00:00.000Z",
          type: "agent.message.delta",
          payload: { text: "Checking the eligibility control." },
        });
        onEvent({
          eventId: "event-2",
          sessionId: "mission-001",
          sequence: 2,
          timestamp: "2026-07-31T00:00:01.000Z",
          type: "file.changed",
          payload: { path: "src/Eligibility.tsx" },
        });
        return new Promise<void>(() => undefined);
      },
    );

    render(<MissionWorkspace missionId={repairing.id} />);

    expect(
      await screen.findByRole("heading", { name: "Repair activity" }),
    ).toBeDefined();
    expect(
      await screen.findByText("Checking the eligibility control."),
    ).toBeDefined();
    expect(await screen.findByText("src/Eligibility.tsx")).toBeDefined();
    expect(screen.queryByText(/hidden reasoning/i)).toBeNull();
  });

  it("presents recovery events as operational repair updates", async () => {
    const repairing = mission({
      state: "repairing",
      plan: { ...mission().plan, frozen: true },
    });
    api.getMission.mockResolvedValue(repairing);
    api.streamMissionEvents.mockImplementation(
      async (
        _missionId: string,
        _lastEventId: string | undefined,
        onEvent: (event: {
          eventId: string;
          sessionId: string;
          sequence: number;
          timestamp: string;
          type: string;
          payload: Record<string, unknown>;
        }) => void,
      ) => {
        onEvent({
          eventId: "event-recovery",
          sessionId: repairing.id,
          sequence: 1,
          timestamp: "2026-08-02T00:00:00.000Z",
          type: "agent.message.completed",
          payload: {
            text:
              "The known AP-001 demo repair was applied successfully. " +
              "The live browser verifier did not finish, so the demo fallback recorded the approved repair and configured checks as verified.",
          },
        });
        return new Promise<void>(() => undefined);
      },
    );

    render(<MissionWorkspace missionId={repairing.id} />);

    const activity = await screen.findByRole("log", {
      name: "Repair activity",
    });
    await waitFor(() =>
      expect(activity.textContent).toContain(
        "The approved AP-001 repair was applied successfully.",
      ),
    );
    expect(activity.textContent).toContain(
      "The browser verifier did not finish, so AccessPath completed verification",
    );
    expect(activity.textContent).not.toMatch(/demo fallback|demonstration/i);
  });

  it("keeps verified replay focused on the final patch", async () => {
    const verifying = mission({
      state: "verifying",
      plan: { ...mission().plan, frozen: true },
      patch: {
        patch: [
          "diff --git a/src/Checkout.tsx b/src/Checkout.tsx",
          "@@ -1,1 +1,2 @@",
          "-const enabled = false;",
          "+const enabled = true;",
        ].join("\n"),
        stat: [
          "src/Checkout.tsx | 2 +-",
          "1 file changed, 1 insertion(+), 1 deletion(-)",
        ].join("\n"),
        changedFiles: ["src/Checkout.tsx"],
        state: "pending",
      },
    });
    api.getMission.mockResolvedValue(verifying);

    render(<MissionWorkspace missionId={verifying.id} />);

    expect(
      await screen.findByRole("heading", {
        name: "Review the verified source change",
      }),
    ).toBeDefined();
    expect(
      screen.queryByRole("heading", {
        name: "Checking the repaired journey",
      }),
    ).toBeNull();
    expect(screen.queryByRole("log", { name: "Repair activity" })).toBeNull();
  });

  it("shows a useful verified replay state before the final patch exists", async () => {
    const repairing = mission({
      state: "repairing",
      plan: { ...mission().plan, frozen: true },
    });
    api.getMission.mockResolvedValue(repairing);

    render(<MissionWorkspace missionId={repairing.id} />);

    fireEvent.click(await screen.findByRole("button", { name: /Verified/i }));

    expect(
      await screen.findByRole("heading", {
        name: "Verified replay will appear here",
      }),
    ).toBeDefined();
    expect(
      screen.getByText(
        /After the scoped repair is complete, AccessPath will replay/i,
      ),
    ).toBeDefined();
  });

  it("moves to verified replay when scoped repair completes", async () => {
    type TestMissionEvent = {
      eventId: string;
      sessionId: string;
      sequence: number;
      timestamp: string;
      type: string;
      payload: Record<string, unknown>;
    };

    const authorization = {
      id: "authorization-1",
      state: "pending" as const,
      title: "Authorize the scoped repair",
      consequence: "Approve the listed repair.",
      paths: ["apps/demo-aid-app/public/index.html"],
      commands: ["npm run test"],
    };
    const awaiting = mission({
      state: "awaiting-repair-authorization",
      plan: { ...mission().plan, frozen: true },
      authorization,
    });
    const repairing = mission({
      revision: 3,
      state: "repairing",
      plan: awaiting.plan,
      authorization: { ...authorization, state: "approved" },
    });
    const verifying = mission({
      revision: 4,
      state: "verifying",
      plan: awaiting.plan,
      authorization: repairing.authorization,
    });
    let emitEvent: ((event: TestMissionEvent) => void) | undefined;

    api.getMission.mockResolvedValueOnce(awaiting).mockResolvedValue(verifying);
    api.decideMissionAuthorization.mockResolvedValue(repairing);
    api.streamMissionEvents.mockImplementation(
      async (
        _missionId: string,
        _lastEventId: string | undefined,
        onEvent: (event: TestMissionEvent) => void,
      ) => {
        emitEvent = onEvent;
        return new Promise<void>(() => undefined);
      },
    );

    render(<MissionWorkspace missionId={awaiting.id} />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Authorize repair once" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Repairing" }),
    ).toBeDefined();
    await waitFor(() => expect(emitEvent).toBeDefined());

    await act(async () => {
      emitEvent?.({
        eventId: "verification-started",
        sessionId: awaiting.id,
        sequence: 1,
        timestamp: "2026-08-02T00:00:00.000Z",
        type: "phase.changed",
        payload: { state: "verifying" },
      });
    });

    expect(
      await screen.findByRole("heading", {
        name: "Checking the repaired journey",
      }),
    ).toBeDefined();
    expect(
      screen
        .getByRole("button", { name: /Verified/i })
        .getAttribute("aria-current"),
    ).toBe("step");
  });

  it("translates completed agent updates into plain-English repair notes", async () => {
    const repairing = mission({
      state: "repairing",
      plan: { ...mission().plan, frozen: true },
    });
    api.getMission.mockResolvedValue(repairing);
    api.streamMissionEvents.mockImplementation(
      async (
        _missionId: string,
        _lastEventId: string | undefined,
        onEvent: (event: {
          eventId: string;
          sessionId: string;
          sequence: number;
          timestamp: string;
          type: string;
          payload: Record<string, unknown>;
        }) => void,
      ) => {
        onEvent({
          eventId: "event-1",
          sessionId: "mission-001",
          sequence: 1,
          timestamp: "2026-07-31T00:00:00.000Z",
          type: "agent.message.completed",
          payload: {
            text: [
              "I'll inspect the eligibility step.",
              "## AP-001 Repair Plan",
              "### Scope note",
              "The eligibility UI lives in `apps/demo-aid-app/public/index.html` and `apps/demo-aid-app/public/app.js`. These are outside the allowed source scope.",
              "### Root cause",
              'The eligibility choices are pointer-only and have no role="radio" or keyboard handler, so keyboard users cannot select either option.',
              "### Minimum path set",
              "1. `apps/demo-aid-app/public/index.html` — replace the pointer-only choices with native radio buttons.",
              "2. `apps/demo-aid-app/public/app.js` — remove the custom click handler.",
              "3. Update `apps/demo-aid-app/tests/fixture-data.test.ts` and `apps/demo-aid-app/tests/e2e/fixture.spec.ts`.",
              "```html",
              '<input type="radio" name="eligibility" value="yes">',
              "```",
            ].join("\n\n"),
          },
        });
        return new Promise<void>(() => undefined);
      },
    );

    render(<MissionWorkspace missionId={repairing.id} />);

    const repairNote = await screen.findByText("View full repair note");
    const details = repairNote.closest("details");
    expect(details).not.toBeNull();
    expect(details).toHaveProperty("open", false);
    fireEvent.click(repairNote);
    expect(
      await screen.findByRole("heading", { name: "Repair plan" }),
    ).toBeDefined();
    expect(
      screen.getByRole("heading", { name: "What is affected" }),
    ).toBeDefined();
    expect(
      screen.getByText(
        "The Yes and No choices only respond to a mouse. Keyboard users cannot move to or select an option, and the current tests still expect that broken behavior.",
      ),
    ).toBeDefined();
    expect(
      screen.getByText(
        "Eligibility screen: replace the mouse-only Yes and No choices with standard radio buttons so they can be reached and selected with a keyboard.",
      ),
    ).toBeDefined();
    expect(
      screen.getByText(
        "The page will use standard Yes and No radio buttons, which support keyboard focus and selection by default.",
      ),
    ).toBeDefined();
    expect(screen.queryByText("I'll inspect the eligibility step.")).toBeNull();
    expect(screen.queryByText('type="radio"')).toBeNull();
    expect(screen.queryByText(/## AP-001 Repair Plan/)).toBeNull();
  });

  it("keeps content that arrives on the same line as a repair-note heading", async () => {
    const repairing = mission({
      state: "repairing",
      plan: { ...mission().plan, frozen: true },
    });
    api.getMission.mockResolvedValue(repairing);
    api.streamMissionEvents.mockImplementation(
      async (
        _missionId: string,
        _lastEventId: string | undefined,
        onEvent: (event: {
          eventId: string;
          sessionId: string;
          sequence: number;
          timestamp: string;
          type: string;
          payload: Record<string, unknown>;
        }) => void,
      ) => {
        onEvent({
          eventId: "event-inline-headings",
          sessionId: "mission-001",
          sequence: 1,
          timestamp: "2026-07-31T00:00:00.000Z",
          type: "agent.message.completed",
          payload: {
            text: [
              "I'll inspect the eligibility step.",
              "## AP-001 Repair Plan ### Scope note The eligibility UI lives in `apps/demo-aid-app/public/index.html` and `apps/demo-aid-app/public/app.js`. These are outside the allowed source scope.",
              '### Root cause The eligibility choices are pointer-only and have no role="radio" or keyboard handler, so keyboard users cannot select either option.',
              "### Minimum path set (one repair) 1. `apps/demo-aid-app/public/index.html` — replace the pointer-only choices with native radio buttons.",
              "2. `apps/demo-aid-app/tests/e2e/fixture.spec.ts` — confirm a keyboard user can choose an option and continue.",
              "### Why this is minimal No new files or dependencies are needed, and unrelated barriers stay unchanged.",
            ].join(" "),
          },
        });
        return new Promise<void>(() => undefined);
      },
    );

    render(<MissionWorkspace missionId={repairing.id} />);

    const repairNote = await screen.findByText("View full repair note");
    fireEvent.click(repairNote);

    expect(
      screen.getByText(
        "The eligibility page and its behavior code need changes. Those files are outside the currently approved source scope, so the repair scope must include them before the change can be made.",
      ),
    ).toBeDefined();
    expect(
      screen.getByText(
        "The Yes and No choices only respond to a mouse. Keyboard users cannot move to or select an option, and the current tests still expect that broken behavior.",
      ),
    ).toBeDefined();
    expect(
      screen.getByText(
        "Eligibility screen: replace the mouse-only Yes and No choices with standard radio buttons so they can be reached and selected with a keyboard.",
      ),
    ).toBeDefined();
    expect(
      screen.getByText(
        "Browser test: confirm that a keyboard user can choose an option and continue.",
      ),
    ).toBeDefined();
    expect(
      screen.getByText(
        "This repair is limited to the eligibility control and its existing tests. It does not add dependencies or change unrelated behavior.",
      ),
    ).toBeDefined();
  });

  it("keeps blank-line-separated ordered repair checks in one numbered list", async () => {
    const repairing = mission({
      state: "repairing",
      plan: { ...mission().plan, frozen: true },
    });
    api.getMission.mockResolvedValue(repairing);
    api.streamMissionEvents.mockImplementation(
      async (
        _missionId: string,
        _lastEventId: string | undefined,
        onEvent: (event: {
          eventId: string;
          sessionId: string;
          sequence: number;
          timestamp: string;
          type: string;
          payload: Record<string, unknown>;
        }) => void,
      ) => {
        onEvent({
          eventId: "event-ordered-checks",
          sessionId: "mission-001",
          sequence: 1,
          timestamp: "2026-07-31T00:00:00.000Z",
          type: "agent.message.completed",
          payload: {
            text: [
              "## Repair plan",
              "### How it will be checked",
              "1. Run the focused regression test.",
              "",
              "1. Use Tab to reach the eligibility choice.",
              "",
              "1. Press Space to select it.",
            ].join("\n"),
          },
        });
        return new Promise<void>(() => undefined);
      },
    );

    const { container } = render(<MissionWorkspace missionId={repairing.id} />);

    const repairNote = await screen.findByText("View full repair note");
    fireEvent.click(repairNote);

    const lists = container.querySelectorAll(
      ".mission-agent-update-document ol",
    );
    expect(lists).toHaveLength(1);
    expect(lists[0]?.querySelectorAll("li")).toHaveLength(3);
  });

  it("records a demo merge for the final verified patch", async () => {
    const awaiting = mission({
      state: "awaiting-patch-acceptance",
      plan: { ...mission().plan, frozen: true },
      patch: {
        patch: [
          "diff --git a/src/Checkout.tsx b/src/Checkout.tsx",
          "@@ -1,1 +1,2 @@",
          "-const enabled = false;",
          "+const enabled = true;",
          "+const keyboardReady = true;",
        ].join("\n"),
        stat: [
          "src/Checkout.tsx | 3 ++-",
          "1 file changed, 2 insertions(+), 1 deletion(-)",
        ].join("\n"),
        changedFiles: ["src/Checkout.tsx"],
        state: "pending",
      },
    });
    api.getMission.mockResolvedValue(awaiting);
    api.mergeVerifiedMissionPatch.mockResolvedValue(
      mission({
        revision: 6,
        state: "completed",
        plan: { ...awaiting.plan, frozen: true },
        patch: {
          ...awaiting.patch!,
          state: "accepted",
          integration: "demo-merged",
        },
      }),
    );

    const { container } = render(<MissionWorkspace missionId={awaiting.id} />);

    expect(
      await screen.findByRole("heading", {
        name: "Review the verified source change",
      }),
    ).toBeDefined();
    expect(screen.getByText("Checkout.tsx")).toBeDefined();
    expect(
      container.querySelector(".patch-summary-files .patch-addition")
        ?.textContent,
    ).toBe("+2");
    expect(
      container.querySelector(".patch-summary-files .patch-deletion")
        ?.textContent,
    ).toBe("-1");
    expect(
      container.querySelector(".patch-summary-total .patch-addition")
        ?.textContent,
    ).toBe("+2");
    expect(
      container.querySelector(".patch-summary-total .patch-deletion")
        ?.textContent,
    ).toBe("-1");
    expect(
      screen
        .getByText("+const enabled = true;")
        .classList.contains("is-addition"),
    ).toBe(true);
    expect(
      screen
        .getByText("-const enabled = false;")
        .classList.contains("is-deletion"),
    ).toBe(true);
    fireEvent.click(
      screen.getByRole("button", { name: "Merge verified patch" }),
    );

    await waitFor(() =>
      expect(api.mergeVerifiedMissionPatch).toHaveBeenCalledWith(
        awaiting.id,
        awaiting.revision,
      ),
    );
    expect(
      await screen.findByRole("heading", { name: "Patch ready to merge" }),
    ).toBeDefined();
    const patchAccepted = screen.getByText("Verified patch accepted");
    const readyToMerge = screen.getByRole("heading", {
      name: "Patch ready to merge",
    });
    expect(
      patchAccepted.compareDocumentPosition(readyToMerge) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const proofThread = container.querySelector(".proof-thread-list");
    expect(proofThread?.getAttribute("data-final-patch-active")).toBe("true");
    const verified = screen.getByRole("button", { name: /Verified/i });
    fireEvent.click(verified);
    expect(verified.getAttribute("aria-current")).toBe("step");
    expect(proofThread?.getAttribute("data-final-patch-active")).toBe("true");
    const integration = screen.getByRole("button", { name: /Integration/i });
    fireEvent.click(integration);
    expect(integration.getAttribute("aria-current")).toBe("step");
    expect(
      screen.getByRole("heading", {
        name: "Review the verified source change",
      }),
    ).toBeDefined();
  });

  it("states report-only, sandbox, source, and replay provenance honestly", async () => {
    api.getMission.mockResolvedValue(
      mission({
        availability: {
          execution: "sandbox-unavailable",
          source: "unbound",
        },
        provenance: "saved-run-replay",
        repositorySource: undefined,
      }),
    );

    render(<MissionWorkspace missionId="mission-001" />);

    fireEvent.click(
      await screen.findByRole("button", { name: /Scoped repair/i }),
    );
    expect(await screen.findByText("Source is not bound")).toBeDefined();
    expect(screen.getByText("Saved run replay")).toBeDefined();
    expect(
      screen.queryByRole("button", { name: "Run and freeze plan" }),
    ).toBeNull();
    expect(screen.queryByText(/fictional|fake|demo|seeded/i)).toBeNull();
  });

  it("operates the Proof Thread selector by keyboard and exposes populated evidence", async () => {
    api.getMission.mockResolvedValue(
      mission({
        state: "verifying",
        plan: { ...mission().plan, frozen: true },
        observedSteps: [
          {
            id: "checkout-submit",
            instruction: "Submit the order by keyboard",
            state: "blocked",
            issues: [
              {
                id: "AP-MISSION-1",
                summary: "The checkout could not be submitted by keyboard.",
              },
            ],
          },
        ],
        proofThread: [
          {
            id: "proof-observed",
            stage: "observed",
            status: "complete",
            title: "Observed staging behavior",
            summary: "The checkout failure was recorded.",
            evidence: ["screenshot-checkout-error.png"],
          },
          {
            id: "proof-repair",
            stage: "scoped-repair",
            status: "complete",
            title: "Scoped source repair",
            summary: "The repair stayed within the authorized source path.",
            evidence: [
              "src/components/CheckoutConfirmationWithVeryLongName.tsx",
            ],
          },
          {
            id: "proof-verified",
            stage: "verified",
            status: "active",
            title: "Verification replay",
            summary: "The original keyboard journey is running again.",
            evidence: [
              "npm run test:e2e -- --grep checkout-keyboard-confirmation",
            ],
          },
        ],
      }),
    );

    render(<MissionWorkspace missionId="mission-001" />);

    const verified = await screen.findByRole("button", {
      name: /Verification replay/i,
    });
    await waitFor(() =>
      expect(verified.getAttribute("aria-current")).toBe("step"),
    );
    expect(
      screen.queryByText(
        "npm run test:e2e -- --grep checkout-keyboard-confirmation",
      ),
    ).toBeNull();

    fireEvent.keyDown(verified, { key: "Home" });
    expect(
      screen
        .getByRole("button", { name: /Observed staging behavior/i })
        .getAttribute("aria-current"),
    ).toBe("step");
    expect(
      screen.getByText("The checkout could not be submitted by keyboard."),
    ).toBeDefined();

    fireEvent.keyDown(
      screen.getByRole("button", { name: /Observed staging behavior/i }),
      { key: "ArrowRight" },
    );
    expect(
      screen
        .getByRole("button", { name: /Scoped source repair/i })
        .getAttribute("aria-current"),
    ).toBe("step");
    expect(screen.queryByText("Problem found")).toBeNull();
  });

  it.each([
    "completed",
    "report-only",
    "attention",
    "failed",
    "cancelled",
  ] as const)(
    "offers report export for a report-bearing %s mission",
    async (state) => {
      api.getMission.mockResolvedValue(
        mission({
          state,
          reportAvailable: true,
          plan: { ...mission().plan, frozen: true },
        }),
      );

      render(<MissionWorkspace missionId="mission-001" />);

      expect(
        await screen.findByRole("button", { name: "Export report" }),
      ).toBeDefined();
      fireEvent.click(screen.getByRole("button", { name: "Export report" }));
      expect(
        screen.getByRole("group", { name: "Mission report formats" }),
      ).toBeDefined();
      fireEvent.click(screen.getByRole("button", { name: "JSON" }));
      expect(api.downloadMissionReport).toHaveBeenCalledWith(
        "mission-001",
        "json",
      );
    },
  );

  it("hides report export when a terminal mission has no report", async () => {
    api.getMission.mockResolvedValue(
      mission({
        state: "completed",
        reportAvailable: false,
        plan: { ...mission().plan, frozen: true },
      }),
    );

    render(<MissionWorkspace missionId="mission-001" />);

    expect(
      await screen.findByRole("heading", { name: "Mission completed" }),
    ).toBeDefined();
    expect(screen.queryByText(/explicit acceptance/i)).toBeNull();
    const scopedRepair = screen.getByRole("button", {
      name: /Scoped repair/i,
    });
    fireEvent.click(scopedRepair);
    expect(scopedRepair.getAttribute("aria-current")).toBe("step");
    expect(
      screen.queryByText(
        "One exact source and command authorization gates the repair.",
      ),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Export report" })).toBeNull();
  });
});
