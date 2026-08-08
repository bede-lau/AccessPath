// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MissionSessionStateSchema } from "@accesspath/contracts";

import {
  ApiError,
  acceptMissionPatch,
  cancelMission,
  compileMission,
  createMission,
  decideMissionAuthorization,
  getMission,
  mergeVerifiedMissionPatch,
  runMission,
  updateMissionPlan,
} from "../src/api";

const canonicalMission = {
  schemaVersion: "1.0.0",
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
    steps: [{ id: "step-1", instruction: "Open checkout" }],
  },
  proofThread: [],
  availability: { execution: "available", source: "bound" },
  createdAt: "2026-07-30T10:00:00.000Z",
  updatedAt: "2026-07-30T10:00:00.000Z",
};

function missionResponse() {
  return new Response(JSON.stringify({ mission: canonicalMission }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("mission API contract", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockImplementation(() => Promise.resolve(missionResponse()));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("uses canonical mission mutation endpoints with revision headers", async () => {
    const input = {
      stagingUrl: "https://staging.example.com/checkout",
      repositorySource: {
        kind: "local" as const,
        value: "C:\\work\\checkout",
      },
      objective: "A keyboard user can complete checkout.",
    };

    await createMission(input);
    await compileMission("mission-001", 1, {
      objective: input.objective,
    });
    await updateMissionPlan("mission-001", 2, [
      { id: "step-1", instruction: "Open checkout with the keyboard" },
    ]);
    await runMission("mission-001", 3);
    await decideMissionAuthorization("mission-001", 4, "approve-once");
    await acceptMissionPatch("mission-001", 5);
    await mergeVerifiedMissionPatch("mission-001", 6);
    await cancelMission("mission-001", 7);

    const calls = fetchMock.mock.calls as Array<[string, RequestInit]>;
    expect(calls.map(([path, init]) => [path, init.method])).toEqual([
      ["/api/missions", "POST"],
      ["/api/missions/mission-001/compile", "POST"],
      ["/api/missions/mission-001/plan", "PATCH"],
      ["/api/missions/mission-001/run", "POST"],
      ["/api/missions/mission-001/repair-authorization", "POST"],
      ["/api/missions/mission-001/patch-acceptance", "POST"],
      ["/api/missions/mission-001/merge-verified-patch", "POST"],
      ["/api/missions/mission-001/cancel", "POST"],
    ]);

    calls.forEach(([, init], index) => {
      const headers = new Headers(init.headers);
      expect(headers.get("idempotency-key")).toBeTruthy();
      expect(headers.get("expected-mission-revision")).toBe(
        String(index),
      );
    });
    expect(JSON.parse(calls[0]![1].body as string)).toEqual(input);
  });

  it("includes the pinned commit when creating a public Git mission", async () => {
    const input = {
      stagingUrl: "https://staging.example.com/checkout",
      repositorySource: {
        kind: "public-git" as const,
        value: "https://github.com/accesspath/example.git",
        commit: "a".repeat(40),
      },
      objective: "A keyboard user can complete checkout.",
    };

    await createMission(input);

    expect(
      JSON.parse(fetchMock.mock.calls[0]![1].body as string),
    ).toEqual(input);
  });

  it("parses every shared mission state and rejects unknown runtime states", async () => {
    for (const state of MissionSessionStateSchema.options) {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ mission: { ...canonicalMission, state } }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      );
      await expect(getMission("mission-001")).resolves.toMatchObject({ state });
    }

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          mission: { ...canonicalMission, state: "unknown-runtime-state" },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    await expect(getMission("mission-001")).rejects.toBeInstanceOf(ApiError);
  });

  it("parses one screenshot and plain-English issue for every observed step", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          mission: {
            ...canonicalMission,
            observedSteps: [
              {
                id: "eligibility-choice",
                instruction: "Choose an eligibility option",
                state: "blocked",
                screenshot: {
                  artifactId: "screenshot-eligibility",
                  sessionId: "audit-001",
                  alt: "Screenshot captured after Choose an eligibility option.",
                },
                issues: [
                  {
                    id: "AP-001",
                    summary:
                      "You cannot choose an eligibility option using only a keyboard.",
                  },
                ],
              },
            ],
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    await expect(getMission("mission-001")).resolves.toMatchObject({
      observedSteps: [
        {
          id: "eligibility-choice",
          screenshot: {
            artifactId: "screenshot-eligibility",
            sessionId: "audit-001",
          },
          issues: [
            {
              id: "AP-001",
              summary:
                "You cannot choose an eligibility option using only a keyboard.",
            },
          ],
        },
      ],
    });
  });

  it.each([
    [
      "availability",
      {
        ...canonicalMission,
        availability: { execution: "unexpected", source: "bound" },
      },
    ],
    [
      "authorization",
      {
        ...canonicalMission,
        authorization: {
          id: "authorization-1",
          state: "mystery",
          title: "Authorize repair",
          consequence: "One repair attempt.",
          paths: ["src/app.ts"],
          commands: ["npm test"],
        },
      },
    ],
    ["authorization primitive", { ...canonicalMission, authorization: "bad" }],
    ["authorization null", { ...canonicalMission, authorization: null }],
    [
      "patch",
      {
        ...canonicalMission,
        patch: {
          patch: "diff",
          stat: "1 file changed",
          changedFiles: ["src/app.ts"],
          state: "mystery",
        },
      },
    ],
    ["patch primitive", { ...canonicalMission, patch: "bad" }],
    ["patch null", { ...canonicalMission, patch: null }],
  ])("fails closed for malformed mission %s data", async (_field, mission) => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ mission }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(getMission("mission-001")).rejects.toMatchObject({
      name: "ApiError",
      status: 502,
    });
  });
});
