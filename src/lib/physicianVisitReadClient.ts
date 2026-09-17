import type { User as FirebaseUser } from "firebase/auth";
import type { PhysicianVisit } from "../types";

export interface PhysicianVisitReadRequest { fromDate?: string; toDate?: string; pageSize?: number; cursor?: string }
export interface ScopedPhysicianVisitReadResponse { authorized: boolean; code?: string; visits: PhysicianVisit[]; nextCursor?: string }
export type PhysicianVisitReadStatus = "UNINITIALIZED" | "LOADING" | "READY" | "DENIED" | "ERROR";
export interface PhysicianVisitReadState { status: PhysicianVisitReadStatus; actorUid: string | null; visits: PhysicianVisit[]; nextCursor?: string; errorCode?: string; errorMessage?: string }
export const EMPTY_PHYSICIAN_VISIT_READ_STATE: PhysicianVisitReadState = { status: "UNINITIALIZED", actorUid: null, visits: [] };

const isVisit = (value: unknown): value is PhysicianVisit => {
  if (!value || typeof value !== "object") return false;
  const visit = value as Record<string, unknown>;
  return typeof visit.id === "string" && typeof visit.repId === "string" && typeof visit.physicianId === "string"
    && typeof visit.visitDate === "string" && Array.isArray(visit.detailing) && Array.isArray(visit.samples);
};

export function isScopedPhysicianVisitReadResponse(value: unknown): value is ScopedPhysicianVisitReadResponse {
  if (!value || typeof value !== "object") return false;
  const response = value as Record<string, unknown>;
  return typeof response.authorized === "boolean" && Array.isArray(response.visits) && response.visits.every(isVisit)
    && (response.nextCursor === undefined || typeof response.nextCursor === "string");
}

export async function fetchScopedPhysicianVisits(
  user: Pick<FirebaseUser, "getIdToken">,
  request: PhysicianVisitReadRequest = {},
  fetchImplementation: typeof fetch = fetch,
): Promise<ScopedPhysicianVisitReadResponse> {
  const token = await user.getIdToken();
  const response = await fetchImplementation("/api/physician-visits/scoped-query", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  const payload: unknown = await response.json();
  if (!isScopedPhysicianVisitReadResponse(payload)) throw new Error("Malformed scoped-physician-visit response");
  if (!response.ok) {
    const error = new Error("Unable to load physician visit records") as Error & { code?: string };
    error.code = payload.code || `HTTP_${response.status}`;
    throw error;
  }
  return payload;
}

export interface PhysicianVisitReadController {
  getState(): PhysicianVisitReadState;
  subscribe(listener: (state: PhysicianVisitReadState) => void): () => void;
  load(actorUid: string, user: Pick<FirebaseUser, "getIdToken">, request?: PhysicianVisitReadRequest): Promise<void>;
  clear(): void;
}

export async function refreshScopedPhysicianVisitHistory(
  controller: PhysicianVisitReadController,
  actorUid: string,
  user: Pick<FirebaseUser, "getIdToken">,
): Promise<PhysicianVisit[]> {
  await controller.load(actorUid, user);
  const state = controller.getState();
  return state.status === "READY" && state.actorUid === actorUid ? state.visits : [];
}

export function createPhysicianVisitReadController(
  loader: (user: Pick<FirebaseUser, "getIdToken">, request?: PhysicianVisitReadRequest) => Promise<ScopedPhysicianVisitReadResponse> = fetchScopedPhysicianVisits,
): PhysicianVisitReadController {
  let state = EMPTY_PHYSICIAN_VISIT_READ_STATE;
  let generation = 0;
  const listeners = new Set<(state: PhysicianVisitReadState) => void>();
  const publish = (next: PhysicianVisitReadState) => { state = next; listeners.forEach((listener) => listener(state)); };
  return {
    getState: () => state,
    subscribe(listener) { listeners.add(listener); listener(state); return () => listeners.delete(listener); },
    async load(actorUid, user, request = {}) {
      const requestGeneration = ++generation;
      publish({ status: "LOADING", actorUid, visits: [] });
      try {
        const result = await loader(user, request);
        if (requestGeneration !== generation) return;
        if (!result.authorized) { publish({ status: "DENIED", actorUid, visits: [] }); return; }
        const byId = new Map(result.visits.map((visit) => [visit.id, visit]));
        publish({ status: "READY", actorUid, visits: Array.from(byId.values()).sort((a, b) => b.visitDate.localeCompare(a.visitDate) || a.id.localeCompare(b.id)), nextCursor: result.nextCursor });
      } catch (error) {
        if (requestGeneration === generation) publish({
          status: "ERROR",
          actorUid,
          visits: [],
          errorCode: typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : "PHYSICIAN_VISIT_READ_FAILED",
          errorMessage: error instanceof Error ? error.message : "Unable to load physician visit records",
        });
      }
    },
    clear() { generation += 1; publish(EMPTY_PHYSICIAN_VISIT_READ_STATE); },
  };
}
