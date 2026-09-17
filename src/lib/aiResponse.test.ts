import { describe, expect, it } from "vitest";
import { resolveAiPresentation } from "./aiResponse";

describe("AI graceful degradation", () => {
  it("shows the explicit configuration state without fabricating insight", () => {
    expect(resolveAiPresentation({ available: false, code: "AI_NOT_CONFIGURED", error: "AI service is not configured." }))
      .toBe("AI service is not configured.");
  });

  it("preserves configured AI output", () => {
    expect(resolveAiPresentation({ text: "Authorized scoped insight" })).toBe("Authorized scoped insight");
  });
});
