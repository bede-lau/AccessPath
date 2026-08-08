// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { App } from "../src/App";

describe("mission routing", () => {
  afterEach(() => {
    cleanup();
    window.history.replaceState({}, "", "/");
  });

  it.each([
    "/",
    "/missions/new",
    "/projects",
    "/projects/audits/new",
    "/audits/audit-001/live",
    "/audits/audit-001/barrier-map",
    "/repairs/repair-001",
    "/barrier-map",
  ])("routes %s to Mission Workspace setup", (path) => {
    window.history.replaceState({}, "", path);
    render(<App />);

    expect(
      screen.getByRole("heading", {
        name: "Define new mission",
      }),
    ).toBeDefined();
    expect(screen.getByText("Mission Workspace")).toBeDefined();
    expect(screen.queryByText("Barrier Map")).toBeNull();
    expect(screen.queryByText("Projects")).toBeNull();
    expect(screen.queryByText("Audits")).toBeNull();
    expect(screen.queryByText("Repairs")).toBeNull();
    expect(screen.queryByText(/demo|fictional|fake|seeded/i)).toBeNull();
  });
});
