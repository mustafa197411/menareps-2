import type { User as FirebaseUser } from "firebase/auth";
import type { PharmacyVisit } from "../types";
import { validateMarketSettings, type MarketBusinessSettings } from "./marketSettings";

export interface PharmacyVisitReadRequest { fromDate?: string; toDate?: string; pageSize?: number; cursor?: string }
export type RenderablePharmacyVisit = PharmacyVisit & { resolvedMarketIdentity?: { marketId: string; countryId: string } };
export interface ScopedPharmacyVisitReadResponse { authorized: boolean; code?: string; visits: RenderablePharmacyVisit[]; marketSettings?: MarketBusinessSettings[]; nextCursor?: string }
export type PharmacyVisitReadStatus = "UNINITIALIZED" | "LOADING" | "READY" | "DENIED" | "ERROR";
export interface PharmacyVisitReadState { status: PharmacyVisitReadStatus; actorUid: string | null; visits: RenderablePharmacyVisit[]; marketSettings?: MarketBusinessSettings[]; nextCursor?: string }
export const EMPTY_PHARMACY_VISIT_READ_STATE: PharmacyVisitReadState = { status: "UNINITIALIZED", actorUid: null, visits: [] };

const isVisit = (value: unknown): value is PharmacyVisit => {
  if (!value || typeof value !== "object") return false;
  const visit = value as Record<string, unknown>;
  return typeof visit.id === "string" && typeof visit.repId === "string" && typeof visit.pharmacyId === "string"
    && typeof visit.visitDate === "string" && Array.isArray(visit.items) && Array.isArray(visit.stockAudit);
};

export function isScopedPharmacyVisitReadResponse(value: unknown): value is ScopedPharmacyVisitReadResponse {
  if (!value || typeof value !== "object") return false;
  const response = value as Record<string, unknown>;
  return typeof response.authorized === "boolean" && Array.isArray(response.visits) && response.visits.every(isVisit)
    && (response.marketSettings === undefined || (Array.isArray(response.marketSettings) && response.marketSettings.every((market) => Boolean(market) && typeof market === "object" && (market as MarketBusinessSettings).active === true && validateMarketSettings(market as MarketBusinessSettings).length === 0)))
    && (response.nextCursor === undefined || typeof response.nextCursor === "string");
}

export async function fetchScopedPharmacyVisits(
  user: Pick<FirebaseUser, "getIdToken">,
  request: PharmacyVisitReadRequest = {},
  fetchImplementation: typeof fetch = fetch,
): Promise<ScopedPharmacyVisitReadResponse> {
  const token = await user.getIdToken();
  const response = await fetchImplementation("/api/pharmacy-visits/scoped-query", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  const payload: unknown = await response.json();
  if (!isScopedPharmacyVisitReadResponse(payload)) throw new Error("Malformed scoped-pharmacy-visit response");
  return payload;
}

export interface PharmacyVisitReadController {
  getState(): PharmacyVisitReadState;
  subscribe(listener: (state: PharmacyVisitReadState) => void): () => void;
  load(actorUid: string, user: Pick<FirebaseUser, "getIdToken">, request?: PharmacyVisitReadRequest): Promise<void>;
  clear(): void;
}

export function createPharmacyVisitReadController(
  loader: (user: Pick<FirebaseUser, "getIdToken">, request?: PharmacyVisitReadRequest) => Promise<ScopedPharmacyVisitReadResponse> = fetchScopedPharmacyVisits,
): PharmacyVisitReadController {
  let state = EMPTY_PHARMACY_VISIT_READ_STATE;
  let generation = 0;
  const listeners = new Set<(state: PharmacyVisitReadState) => void>();
  const publish = (next: PharmacyVisitReadState) => { state = next; listeners.forEach((listener) => listener(state)); };
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
        publish({ status: "READY", actorUid, visits: Array.from(byId.values()).sort((a, b) => b.visitDate.localeCompare(a.visitDate) || a.id.localeCompare(b.id)), marketSettings: result.marketSettings || [], nextCursor: result.nextCursor });
      } catch {
        if (requestGeneration === generation) publish({ status: "ERROR", actorUid, visits: [] });
      }
    },
    clear() { generation += 1; publish(EMPTY_PHARMACY_VISIT_READ_STATE); },
  };
}
