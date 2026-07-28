import { describe, expect, it } from "vitest";
import { TaskContractSchema, TaskInstructionSchema } from "../src/index";
import { taskContractFixture, taskInstructionFixtures } from "./fixtures";

describe("task contract", () => {
  it("parses a valid TaskContract fixture", () => {
    expect(TaskContractSchema.parse(taskContractFixture)).toEqual(
      taskContractFixture,
    );
  });

  it("round-trips TaskContract (parse output re-parses to itself)", () => {
    const parsed = TaskContractSchema.parse(taskContractFixture);
    expect(TaskContractSchema.parse(parsed)).toEqual(parsed);
  });

  it("strips additive unknown fields from TaskContract", () => {
    const parsed = TaskContractSchema.parse({
      ...taskContractFixture,
      experimental: true,
    });
    expect(parsed).toEqual(taskContractFixture);
    expect(parsed).not.toHaveProperty("experimental");
  });

  it("rejects an invalid targetPolicy", () => {
    expect(() =>
      TaskContractSchema.parse({ ...taskContractFixture, targetPolicy: "any" }),
    ).toThrow();
  });

  it("rejects a TaskContract missing a required field", () => {
    const { timeoutMs: _timeoutMs, ...missing } = taskContractFixture;
    expect(() => TaskContractSchema.parse(missing)).toThrow();
  });

  it("rejects invalid URLs, viewports, and timeouts", () => {
    expect(() =>
      TaskContractSchema.parse({ ...taskContractFixture, startUrl: "not-a-url" }),
    ).toThrow();
    expect(() =>
      TaskContractSchema.parse({
        ...taskContractFixture,
        viewport: { width: 0, height: 720 },
      }),
    ).toThrow();
    expect(() =>
      TaskContractSchema.parse({ ...taskContractFixture, timeoutMs: -1 }),
    ).toThrow();
  });

  it("parses every action kind of the discriminated union", () => {
    for (const instruction of taskInstructionFixtures) {
      expect(TaskInstructionSchema.parse(instruction)).toEqual(instruction);
    }
    const kinds = taskInstructionFixtures.map((i) => i.action.kind).sort();
    expect(kinds).toEqual(["assert", "click", "fill", "press", "select"]);
  });

  it("rejects an unknown action kind", () => {
    expect(() =>
      TaskInstructionSchema.parse({
        id: "ins-bad",
        intent: "Hover over the menu",
        action: { kind: "hover", role: "menuitem", name: "Products" },
        checkpoint: false,
      }),
    ).toThrow();
  });

  it("rejects an action missing its discriminant-specific field", () => {
    expect(() =>
      TaskInstructionSchema.parse({
        id: "ins-bad",
        intent: "Enter the email address",
        action: { kind: "fill", label: "Email" },
        checkpoint: false,
      }),
    ).toThrow();
  });
});
