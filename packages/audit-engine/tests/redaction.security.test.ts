import { describe, expect, it } from "vitest";
import { redactSummary } from "../src/index";

describe("security: summary redaction", () => {
  it("redacts credentials, query secrets, and fixture values", () => {
    const result = redactSummary(
      "Authorization: Bearer abc token=secret&password=hunter2 Jordan Example",
      ["Jordan Example"],
    );
    expect(result).not.toMatch(/abc|secret|hunter2|Jordan Example/);
    expect(result).toContain("[REDACTED]");
  });

  it("bounds untrusted console and request summaries", () => {
    expect(redactSummary("x".repeat(2000))).toHaveLength(1000);
  });
});
