import type { User as FirebaseUser } from "firebase/auth";
import type { CanonicalVisitMarketingRequest } from "./visitMarketingRequestPolicy";

async function call<T>(user: FirebaseUser | null, path: string, body: Record<string, unknown>): Promise<T> {
  const token = await user?.getIdToken();
  if (!token) throw new Error("AUTHENTICATED_MARKETING_REQUEST_ACTOR_REQUIRED");
  const response = await fetch(path, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => ({ code: "INVALID_MARKETING_REQUEST_RESPONSE" }));
  if (!response.ok) throw new Error(result.code || "MARKETING_REQUEST_OPERATION_FAILED");
  return result as T;
}

export const queryVisitMarketingRequests = (user: FirebaseUser | null) => call<{ requests: CanonicalVisitMarketingRequest[] }>(user, "/api/visit-marketing-requests/scoped-query", {});
export const createVisitMarketingRequest = (user: FirebaseUser | null, visitId: string, request: Record<string, unknown>) => call<{ request: CanonicalVisitMarketingRequest }>(user, "/api/visit-marketing-requests/create", { visitId, request });
export const transitionVisitMarketingRequest = (user: FirebaseUser | null, action: "supervisor-approve" | "supervisor-reject" | "final-approve" | "final-reject" | "execute" | "cancel", requestId: string, reason?: string, comment?: string) => call<{ request: CanonicalVisitMarketingRequest }>(user, `/api/visit-marketing-requests/${action}`, { requestId, reason, comment });
