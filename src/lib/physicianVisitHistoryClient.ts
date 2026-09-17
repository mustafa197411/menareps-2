import type { User as FirebaseUser } from "firebase/auth";
import type { PhysicianVisit } from "../types";

export type PhysicianHistoryScopeMode = "SELF" | "TEAM" | "ORGANIZATION";

export interface ScopedPhysicianVisitSummary {
  physicianId: string;
  scopeMode: PhysicianHistoryScopeMode;
  subjectUids: string[];
  lastVisit: PhysicianVisit | null;
  totalCompletedVisits: number;
  currentMonthCompletedVisits: number;
  visits?: PhysicianVisit[];
}

interface ScopedPhysicianVisitHistoryResponse {
  authorized: boolean;
  code?: string;
  scopeMode?: PhysicianHistoryScopeMode;
  summaries: ScopedPhysicianVisitSummary[];
}

const REQUEST_CHUNK_SIZE = 100;

function isSummary(value: unknown): value is ScopedPhysicianVisitSummary {
  if (!value || typeof value !== "object") return false;
  const summary = value as Record<string, unknown>;
  return typeof summary.physicianId === "string"
    && ["SELF", "TEAM", "ORGANIZATION"].includes(String(summary.scopeMode))
    && Array.isArray(summary.subjectUids)
    && Number.isInteger(summary.totalCompletedVisits)
    && Number.isInteger(summary.currentMonthCompletedVisits)
    && (summary.lastVisit === null || typeof summary.lastVisit === "object")
    && (summary.visits === undefined || Array.isArray(summary.visits));
}

function isResponse(value: unknown): value is ScopedPhysicianVisitHistoryResponse {
  if (!value || typeof value !== "object") return false;
  const response = value as Record<string, unknown>;
  return typeof response.authorized === "boolean"
    && Array.isArray(response.summaries)
    && response.summaries.every(isSummary);
}

async function requestHistory(
  user: Pick<FirebaseUser, "getIdToken">,
  physicianIds: string[],
  includeHistory: boolean,
  subjectUid?: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<ScopedPhysicianVisitHistoryResponse> {
  const token = await user.getIdToken();
  const response = await fetchImplementation("/api/physician-visits/physician-history", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ physicianIds, includeHistory, ...(subjectUid ? { subjectUid } : {}) }),
  });
  const payload: unknown = await response.json();
  if (!isResponse(payload)) throw new Error("Malformed scoped physician-history response");
  if (!response.ok || !payload.authorized) {
    const error = new Error("Physician visit history is outside the authenticated operational scope") as Error & { code?: string };
    error.code = payload.code || `HTTP_${response.status}`;
    throw error;
  }
  return payload;
}

export async function fetchScopedPhysicianVisitSummaries(
  user: Pick<FirebaseUser, "getIdToken">,
  physicianIds: string[],
  fetchImplementation: typeof fetch = fetch,
): Promise<Map<string, ScopedPhysicianVisitSummary>> {
  const ids = [...new Set(physicianIds.map((id) => id.trim()).filter(Boolean))].sort();
  const summaries = new Map<string, ScopedPhysicianVisitSummary>();
  for (let index = 0; index < ids.length; index += REQUEST_CHUNK_SIZE) {
    const response = await requestHistory(user, ids.slice(index, index + REQUEST_CHUNK_SIZE), false, undefined, fetchImplementation);
    response.summaries.forEach((summary) => summaries.set(summary.physicianId, summary));
  }
  return summaries;
}

export async function fetchScopedPhysicianVisitHistory(
  user: Pick<FirebaseUser, "getIdToken">,
  physicianId: string,
  subjectUid?: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<ScopedPhysicianVisitSummary> {
  const response = await requestHistory(user, [physicianId], true, subjectUid, fetchImplementation);
  const summary = response.summaries[0];
  if (!summary || summary.physicianId !== physicianId) throw new Error("Scoped physician history was not returned");
  return summary;
}
