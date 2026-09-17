import type { User as FirebaseUser } from "firebase/auth";

export interface PharmacyOrderReadRequest { pharmacyId?: string; fromDate?: string; toDate?: string; pageSize?: number; cursor?: string }
export interface PharmacyOrderSummaryItem { id: string; name: string; quantity: number }
export interface PharmacyOrderSummary { id: string; pharmacyId: string; displayNumber: string; orderDate: string; status: string; items: PharmacyOrderSummaryItem[]; total: number }
export interface ScopedPharmacyOrderReadResponse { authorized: boolean; code?: string; orders: PharmacyOrderSummary[]; nextCursor?: string; excludedLegacyOrderIds?: string[] }
export type PharmacyOrderReadStatus = "UNINITIALIZED" | "LOADING" | "READY" | "DENIED" | "ERROR";
export interface PharmacyOrderReadState { status: PharmacyOrderReadStatus; actorUid: string | null; pharmacyId: string | null; orders: PharmacyOrderSummary[]; nextCursor?: string }
export const EMPTY_PHARMACY_ORDER_READ_STATE: PharmacyOrderReadState = { status: "UNINITIALIZED", actorUid: null, pharmacyId: null, orders: [] };

const isSummary = (value: unknown): value is PharmacyOrderSummary => {
  if (!value || typeof value !== "object") return false;
  const order = value as Record<string, unknown>;
  return typeof order.id === "string" && typeof order.pharmacyId === "string" && typeof order.displayNumber === "string"
    && typeof order.orderDate === "string" && typeof order.status === "string" && typeof order.total === "number"
    && Array.isArray(order.items) && order.items.every((item) => Boolean(item) && typeof item === "object" && typeof (item as Record<string, unknown>).id === "string" && typeof (item as Record<string, unknown>).name === "string" && typeof (item as Record<string, unknown>).quantity === "number");
};
export function isScopedPharmacyOrderReadResponse(value: unknown): value is ScopedPharmacyOrderReadResponse {
  if (!value || typeof value !== "object") return false;
  const response = value as Record<string, unknown>;
  return typeof response.authorized === "boolean" && Array.isArray(response.orders) && response.orders.every(isSummary)
    && (response.nextCursor === undefined || typeof response.nextCursor === "string")
    && (response.excludedLegacyOrderIds === undefined || (Array.isArray(response.excludedLegacyOrderIds) && response.excludedLegacyOrderIds.every((id) => typeof id === "string")));
}

export async function fetchScopedPharmacyOrders(user: Pick<FirebaseUser, "getIdToken">, request: PharmacyOrderReadRequest, fetchImplementation: typeof fetch = fetch): Promise<ScopedPharmacyOrderReadResponse> {
  const token = await user.getIdToken();
  const response = await fetchImplementation("/api/pharmacy-orders/scoped-query", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(request) });
  const payload: unknown = await response.json();
  if (!isScopedPharmacyOrderReadResponse(payload)) throw new Error("Malformed scoped-pharmacy-order response");
  return payload;
}

export interface PharmacyOrderReadController { getState(): PharmacyOrderReadState; load(actorUid: string, pharmacyId: string, user: Pick<FirebaseUser, "getIdToken">): Promise<void>; clear(): void }
export function createPharmacyOrderReadController(loader: (user: Pick<FirebaseUser, "getIdToken">, request: PharmacyOrderReadRequest) => Promise<ScopedPharmacyOrderReadResponse> = fetchScopedPharmacyOrders): PharmacyOrderReadController {
  let state = EMPTY_PHARMACY_ORDER_READ_STATE;
  let generation = 0;
  return {
    getState: () => state,
    async load(actorUid, pharmacyId, user) {
      const current = ++generation;
      state = { status: "LOADING", actorUid, pharmacyId, orders: [] };
      try {
        const result = await loader(user, { pharmacyId });
        if (current !== generation) return;
        if (!result.authorized) { state = { status: "DENIED", actorUid, pharmacyId, orders: [] }; return; }
        const byId = new Map(result.orders.map((order) => [order.id, order]));
        state = { status: "READY", actorUid, pharmacyId, orders: Array.from(byId.values()).sort((a, b) => b.orderDate.localeCompare(a.orderDate) || a.id.localeCompare(b.id)), nextCursor: result.nextCursor };
      } catch { if (current === generation) state = { status: "ERROR", actorUid, pharmacyId, orders: [] }; }
    },
    clear() { generation += 1; state = EMPTY_PHARMACY_ORDER_READ_STATE; },
  };
}
