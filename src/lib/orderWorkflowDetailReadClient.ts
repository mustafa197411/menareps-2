import { isActorMarketContext } from "./operationalScopeClient";
import type { User as FirebaseUser } from "firebase/auth";

export interface OrderOperationsReviewItem { productId: string; name: string; quantity: number; unitPrice: number; lineTotal: number }
export interface OrderOperationsReviewHistory { action: string; fromStatus: string; toStatus: string; actorUid: string; actorName: string; createdAt: string; comments?: string }
export interface AuthoritativeOrderOperationsDetail {
  kind: "AUTHORITATIVE_ORDER_OPERATIONS_DETAIL";
  orderId: string; displayNumber: string; version: string; currentStatus: "FINANCE_APPROVED" | "PENDING_OPERATIONS_REVIEW"; stage: string;
  pharmacyId: string; pharmacyName: string; areaId: string; countryId: string; creatorUid: string; representativeName: string; orderDate: string;
  items: OrderOperationsReviewItem[]; total: number;
  financePrerequisite: { approved: true; approvedAt: string; approvedByUid: string; approvedByName: string };
  history: OrderOperationsReviewHistory[];
}
export type OrderWorkflowDetailReadResponse = { authorized: true; detail: AuthoritativeOrderOperationsDetail } | { authorized: false; code: string; detail: null };
export type OrderWorkflowDetailReadStatus = "UNINITIALIZED" | "LOADING" | "READY" | "DENIED" | "ERROR";
export interface OrderWorkflowDetailReadState { status: OrderWorkflowDetailReadStatus; actorUid: string | null; orderId: string | null; detail: AuthoritativeOrderOperationsDetail | null; code?: string }
export const EMPTY_ORDER_WORKFLOW_DETAIL_STATE: OrderWorkflowDetailReadState = { status: "UNINITIALIZED", actorUid: null, orderId: null, detail: null };

const stringField = (value: unknown): value is string => typeof value === "string";
function isDetail(value: unknown): value is AuthoritativeOrderOperationsDetail {
  if (!value || typeof value !== "object") return false;
  const detail = value as Record<string, any>;
  return (detail.marketContext === undefined || isActorMarketContext(detail.marketContext))
    && (detail.marketId === undefined || typeof detail.marketId === "string")
    && (detail.currencyCode === undefined || typeof detail.currencyCode === "string")
    && detail.kind === "AUTHORITATIVE_ORDER_OPERATIONS_DETAIL"
    && ["orderId", "displayNumber", "version", "stage", "pharmacyId", "pharmacyName", "areaId", "countryId", "creatorUid", "representativeName", "orderDate"].every((key) => stringField(detail[key]))
    && ["FINANCE_APPROVED", "PENDING_OPERATIONS_REVIEW"].includes(detail.currentStatus)
    && typeof detail.total === "number" && Number.isFinite(detail.total)
    && Array.isArray(detail.items) && detail.items.every((item: any) => item && stringField(item.productId) && stringField(item.name) && [item.quantity, item.unitPrice, item.lineTotal].every((field) => typeof field === "number" && Number.isFinite(field)))
    && Array.isArray(detail.history) && detail.history.every((entry: any) => entry && [entry.action, entry.fromStatus, entry.toStatus, entry.actorUid, entry.actorName, entry.createdAt].every(stringField) && (entry.comments === undefined || stringField(entry.comments)))
    && detail.financePrerequisite?.approved === true
    && [detail.financePrerequisite.approvedAt, detail.financePrerequisite.approvedByUid, detail.financePrerequisite.approvedByName].every(stringField);
}
export function isOrderWorkflowDetailReadResponse(value: unknown): value is OrderWorkflowDetailReadResponse {
  if (!value || typeof value !== "object") return false;
  const response = value as Record<string, unknown>;
  return response.authorized === true ? isDetail(response.detail) : response.authorized === false && typeof response.code === "string" && response.detail === null;
}

export async function fetchOrderWorkflowDetail(
  user: Pick<FirebaseUser, "getIdToken">,
  orderId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<OrderWorkflowDetailReadResponse> {
  const token = await user.getIdToken();
  const response = await fetchImplementation("/api/orders/workflow/detail", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ orderId }),
  });
  const payload: unknown = await response.json();
  if (!isOrderWorkflowDetailReadResponse(payload)) throw new Error("Malformed order-workflow-detail response");
  return payload;
}

export interface OrderWorkflowDetailReadController {
  getState(): OrderWorkflowDetailReadState;
  load(actorUid: string, orderId: string, user: Pick<FirebaseUser, "getIdToken">): Promise<void>;
  clear(): void;
}
export function createOrderWorkflowDetailReadController(
  loader: (user: Pick<FirebaseUser, "getIdToken">, orderId: string) => Promise<OrderWorkflowDetailReadResponse> = fetchOrderWorkflowDetail,
): OrderWorkflowDetailReadController {
  let state = EMPTY_ORDER_WORKFLOW_DETAIL_STATE;
  let generation = 0;
  return {
    getState: () => state,
    async load(actorUid, orderId, user) {
      const current = ++generation;
      state = { status: "LOADING", actorUid, orderId, detail: null };
      try {
        const result = await loader(user, orderId);
        if (current !== generation) return;
        if (result.authorized === true) {
          state = { status: "READY", actorUid, orderId, detail: result.detail };
        } else {
          state = { status: "DENIED", actorUid, orderId, detail: null, code: result.code };
        }
      } catch {
        if (current === generation) state = { status: "ERROR", actorUid, orderId, detail: null };
      }
    },
    clear() { generation += 1; state = EMPTY_ORDER_WORKFLOW_DETAIL_STATE; },
  };
}
