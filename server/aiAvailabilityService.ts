export interface AiUnavailableResponse {
  httpStatus: 200 | 503;
  body: {
    available: false;
    code: "AI_NOT_CONFIGURED" | "AI_RATE_LIMITED";
    error: string;
    text: string;
  };
}

export function resolveAiUnavailableResponse(
  configured: boolean,
  rateLimited: boolean,
): AiUnavailableResponse | null {
  if (!configured) {
    return {
      // Missing optional configuration is a capability state, not a failed CRM resource.
      httpStatus: 200,
      body: {
        available: false,
        code: "AI_NOT_CONFIGURED",
        error: "AI service is not configured.",
        text: "AI service is not configured.",
      },
    };
  }

  if (rateLimited) {
    return {
      httpStatus: 503,
      body: {
        available: false,
        code: "AI_RATE_LIMITED",
        error: "AI service is temporarily unavailable.",
        text: "AI service is temporarily unavailable.",
      },
    };
  }

  return null;
}
