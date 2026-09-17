import { describe, expect, it } from "vitest";
import { resolveAiUnavailableResponse } from "./aiAvailabilityService";

describe("AI availability contract", () => {
  it("returns an explicit non-failing capability state when AI is not configured", () => {
    expect(resolveAiUnavailableResponse(false, false)).toEqual({
      httpStatus: 200,
      body: {
        available: false,
        code: "AI_NOT_CONFIGURED",
        error: "AI service is not configured.",
        text: "AI service is not configured.",
      },
    });
  });

  it("allows configured AI generation to continue", () => {
    expect(resolveAiUnavailableResponse(true, false)).toBeNull();
  });

  it("keeps genuine temporary AI rate limiting as HTTP 503", () => {
    expect(resolveAiUnavailableResponse(true, true)?.httpStatus).toBe(503);
  });
});
