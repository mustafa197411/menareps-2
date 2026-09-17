/**
 * Client service to interface with our server-side Gemini API Proxy
 */

import { auth } from "../lib/firebase";
import { resolveAiPresentation } from "../lib/aiResponse";

async function fetchWithRetry(url: string, options: RequestInit, retries = 2, delay = 1000): Promise<Response> {
  try {
    const res = await fetch(url, options);
    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }
    return res;
  } catch (err) {
    if (retries > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
      return fetchWithRetry(url, options, retries - 1, delay * 1.5);
    }
    throw err;
  }
}

const activeRequests = new Map<string, Promise<string>>();

export async function fetchAiInsight(
  action: "dashboard" | "quality_score" | "planning" | "anomaly" | "nba",
  payload: any,
  user?: any
): Promise<string> {
  const requestKey = `${action}:${JSON.stringify(payload)}`;
  
  if (activeRequests.has(requestKey)) {
    console.info(`[AI Service] Reusing concurrent in-flight request for action: ${action}`);
    return activeRequests.get(requestKey)!;
  }

  const promise = (async () => {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      // Safely obtain current Firebase user and retrieve the JWT ID Token
      const currentUser = auth.currentUser;
      if (currentUser) {
        const token = await currentUser.getIdToken();
        headers["Authorization"] = `Bearer ${token}`;
      }

      const response = await fetchWithRetry("/api/ai", {
        method: "POST",
        headers,
        body: JSON.stringify({ action, payload }),
      });

      const data = await response.json();
      if (response.status === 401) {
        throw new Error("Unauthorized: Invalid session. Please log in again.");
      }
      if (response.status === 403) {
        throw new Error(`Forbidden: ${data.error || "Access Denied"}`);
      }
      return resolveAiPresentation(data);
    } catch (error) {
      console.warn("AI Insight retrieval failed:", error);
      throw error;
    } finally {
      // Clean up from the active requests map once finished
      activeRequests.delete(requestKey);
    }
  })();

  activeRequests.set(requestKey, promise);
  return promise;
}
