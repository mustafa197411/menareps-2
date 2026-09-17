export interface AiApiResponse {
  available?: boolean;
  code?: string;
  error?: string;
  text?: string;
}

export function resolveAiPresentation(response: AiApiResponse): string {
  if (response.available === false) {
    return response.text || response.error || "AI service is temporarily unavailable.";
  }
  return response.text || "No insights could be computed at this moment.";
}
