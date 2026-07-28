// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../src/App";

describe("App shell", () => {
  afterEach(() => {
    cleanup();
  });
  it("renders without error", () => {
    expect(() => render(<App />)).not.toThrow();
  });

  it("has a single h1 with the product title", () => {
    render(<App />);
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]?.textContent).toBe("AccessPath Console");
  });

  it("exposes a main landmark", () => {
    render(<App />);
    expect(screen.getByRole("main")).toBeDefined();
  });

  it("has a skip link targeting #main-content", () => {
    render(<App />);
    const skipLink = screen.getByRole("link", {
      name: "Skip to main content",
    });
    expect(skipLink.getAttribute("href")).toBe("#main-content");
  });
});
