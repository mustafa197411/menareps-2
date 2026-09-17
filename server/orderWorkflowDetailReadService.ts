import { readActorMarketContext } from "./operationalScopeRepository";
import { isActorMarketContext, type ActorMarketContext } from "../src/lib/operationalScopeClient";
import { resolveFinancialIdentity } from "../src/lib/financialIdentity";
import { getFirebaseAdminServices } from "./firebaseAdmin";
import {
  createFirestoreWorkflowQueueScopeRepository,
  type WorkflowQueueScopeRepository,
} from "./workflowQueueScopeRepository";
import { resolveWorkflowQueueScope, type WorkflowQueueStatus } from "./workflowQueueScopeService";

export type OrderWorkflowDetailReadCode =
  | "WORKFLOW_SCOPE_DENIED"
  | "ORDER_NOT_FOUND"
  | "ORDER_STATUS_NOT_AUTHORIZED"
  | "ORDER_GEOGRAPHY_DENIED"
  | "ORDER_GEOGRAPHY_UNRESOLVED"
  | "CREATOR_IDENTITY_UNRESOLVED"
  | "ORDER_VERSION_UNRESOLVED";

export interface OrderOperationsReviewItem {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface OrderOperationsReviewHistory {
  action: string;
  fromStatus: string;
  toStatus: string;
  actorUid: string;
  actorName: string;
  createdAt: string;
  comments?: string;
}

export interface AuthoritativeOrderOperationsDetail {
  kind: "AUTHORITATIVE_ORDER_OPERATIONS_DETAIL";
  orderId: string;
  displayNumber: string;
  version: string;
  currentStatus: WorkflowQueueStatus;
  stage: string;
  pharmacyId: string;
  pharmacyName: string;
  areaId: string;
  countryId: string;
  marketId?: string;
  currencyCode?: string;
  marketContext?: ActorMarketContext;
  creatorUid: string;
  representativeName: string;
  orderDate: string;
  items: OrderOperationsReviewItem[];
  total: number;
  financePrerequisite: {
    approved: true;
    approvedAt: string;
    approvedByUid: string;
    approvedByName: string;
  };
  history: OrderOperationsReviewHistory[];
}

export type OrderWorkflowDetailReadResult =
  | { authorized: true; detail: AuthoritativeOrderOperationsDetail }
  | { authorized: false; code: OrderWorkflowDetailReadCode | string; detail: null };

export interface CurrentOrderDetailDocument {
  id: string;
  version: string;
  data: Record<string, any>;
}

export interface OrderWorkflowDetailReadRepository {
  readMarketContext?(identity: Record<string, unknown>): Promise<ActorMarketContext>;
  getOrder(orderId: string): Promise<CurrentOrderDetailDocument | null>;
  getPharmacy(pharmacyId: string): Promise<Record<string, any> | null>;
  getRepresentative?(userUid: string): Promise<Record<string, any> | null>;
}

export interface OrderWorkflowDetailReadDependencies {
  workflowScopeRepository: WorkflowQueueScopeRepository;
  detailRepository: OrderWorkflowDetailReadRepository;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function versionOf(snapshot: any): string {
  const timestamp = snapshot.updateTime;
  return timestamp ? `${timestamp.seconds}:${timestamp.nanoseconds}` : "";
}

export function createFirestoreOrderWorkflowDetailReadRepository(): OrderWorkflowDetailReadRepository {
  const db = getFirebaseAdminServices().db;
  return {
    readMarketContext: identity => readActorMarketContext(identity, db),
    async getOrder(orderId) {
      const snapshot = await db.collection("orders").doc(orderId).get();
      return snapshot.exists ? { id: snapshot.id, version: versionOf(snapshot), data: { ...snapshot.data(), id: snapshot.id } } : null;
    },
    async getPharmacy(pharmacyId) {
      const snapshot = await db.collection("pharmacies").doc(pharmacyId).get();
      return snapshot.exists ? { ...snapshot.data(), id: snapshot.id } : null;
    },
    async getRepresentative(userUid) {
      const snapshot = await db.collection("users").doc(userUid).get();
      return snapshot.exists ? { ...snapshot.data(), id: snapshot.id } : null;
    },
  };
}

export function parseOrderWorkflowDetailReadRequest(input: unknown): { orderId: string } | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const body = input as Record<string, unknown>;
  if (Object.keys(body).length !== 1 || typeof body.orderId !== "string") return null;
  const orderId = text(body.orderId);
  return orderId && orderId.length <= 256 ? { orderId } : null;
}

function canonicalArea(record: Record<string, any>): string {
  return text(record.areaId) || text(record.territoryId);
}

function creatorUid(order: Record<string, any>): string {
  return text(order.createdByUid) || text(order.salesRepUid);
}

function reviewItems(order: Record<string, any>): OrderOperationsReviewItem[] {
  if (!Array.isArray(order.items)) return [];
  return order.items.flatMap((item: any) => {
    const productId = text(item?.productId) || text(item?.id);
    const name = text(item?.productName) || text(item?.name);
    const quantity = Number(item?.quantity);
    const unitPrice = Number(item?.unitPrice ?? item?.price);
    const lineTotal = Number(item?.lineTotal ?? item?.total ?? quantity * unitPrice);
    return productId && name && Number.isFinite(quantity) && quantity >= 0
      && Number.isFinite(unitPrice) && unitPrice >= 0 && Number.isFinite(lineTotal) && lineTotal >= 0
      ? [{ productId, name, quantity, unitPrice, lineTotal }]
      : [];
  });
}

const REVIEW_HISTORY_ACTIONS = new Set([
  "APPROVE_FINANCE", "FINANCE_APPROVE",
  "OPERATIONS_APPROVE", "OPERATIONS_REJECT", "OPERATIONS_RETURN_TO_FINANCE", "OPERATIONS_RETURN_TO_REP",
]);

function reviewHistory(order: Record<string, any>): OrderOperationsReviewHistory[] {
  if (!Array.isArray(order.history)) return [];
  return order.history.flatMap((entry: any) => {
    const action = text(entry?.action);
    if (!REVIEW_HISTORY_ACTIONS.has(action)) return [];
    const operationEntry = action.startsWith("OPERATIONS_");
    return [{
      action,
      fromStatus: text(entry?.fromStatus),
      toStatus: text(entry?.toStatus),
      actorUid: text(entry?.actorUid),
      actorName: text(entry?.actorName),
      createdAt: text(entry?.createdAt),
      ...(operationEntry && text(entry?.comments) ? { comments: text(entry.comments) } : {}),
    }];
  });
}

/** Transport validation only: market authority remains the existing market reader. */
export async function readOrderDisplayContext(
  order: Record<string, any>,
  readMarketContext?: OrderWorkflowDetailReadRepository["readMarketContext"],
): Promise<ActorMarketContext> {
  let marketContext: ActorMarketContext = { status: "UNRESOLVED" };
  try {
    const context = await readMarketContext?.({
      ...(order.marketId !== undefined ? { marketId: order.marketId } : {}), countryId: order.countryId,
    });
    if (isActorMarketContext(context) && context.status === "RESOLVED"
      && resolveFinancialIdentity([order], [context.market])
      && (!order.countryId || order.countryId === context.market.countryId)
      && [order.currencyCode, order.currency].filter(value => value !== undefined).every(value => value === context.market.currencyCode)
      && Boolean(order.currencyCode || order.currency)) marketContext = context;
  } catch { /* Unavailable display context never changes Order authorization. */ }
  return marketContext;
}

export async function resolveOrderWorkflowDetailRead(
  authenticatedActorUid: string,
  orderId: string,
  dependencies?: Partial<OrderWorkflowDetailReadDependencies>,
): Promise<OrderWorkflowDetailReadResult> {
  const deps: OrderWorkflowDetailReadDependencies = {
    workflowScopeRepository: dependencies?.workflowScopeRepository || createFirestoreWorkflowQueueScopeRepository(),
    detailRepository: dependencies?.detailRepository || createFirestoreOrderWorkflowDetailReadRepository(),
  };
  const scope = await resolveWorkflowQueueScope(authenticatedActorUid, { resource: "orders" }, deps.workflowScopeRepository);
  if (!scope.authorized || scope.queryPlan.denyAll || scope.resource !== "orders") {
    return { authorized: false, code: scope.code || "WORKFLOW_SCOPE_DENIED", detail: null };
  }
  const current = await deps.detailRepository.getOrder(orderId);
  if (!current) return { authorized: false, code: "ORDER_NOT_FOUND", detail: null };
  if (!current.version) return { authorized: false, code: "ORDER_VERSION_UNRESOLVED", detail: null };
  const order = current.data;
  const currentStatus = text(order.status) as WorkflowQueueStatus;
  if (!scope.allowedStatuses.includes(currentStatus)) {
    return { authorized: false, code: "ORDER_STATUS_NOT_AUTHORIZED", detail: null };
  }
  let areaId = canonicalArea(order);
  if (!areaId) {
    const pharmacyId = text(order.pharmacyId);
    if (!pharmacyId) return { authorized: false, code: "ORDER_GEOGRAPHY_UNRESOLVED", detail: null };
    const pharmacy = await deps.detailRepository.getPharmacy(pharmacyId);
    if (!pharmacy) return { authorized: false, code: "ORDER_GEOGRAPHY_UNRESOLVED", detail: null };
    areaId = canonicalArea(pharmacy);
    if (!areaId) return { authorized: false, code: "ORDER_GEOGRAPHY_UNRESOLVED", detail: null };
  }
  if (!scope.areaIds.includes(areaId)) return { authorized: false, code: "ORDER_GEOGRAPHY_DENIED", detail: null };
  const canonicalCreatorUid = creatorUid(order);
  if (!canonicalCreatorUid) return { authorized: false, code: "CREATOR_IDENTITY_UNRESOLVED", detail: null };
  const marketContext = await readOrderDisplayContext(order, deps.detailRepository.readMarketContext);
  const total = Number(order.total ?? order.netTotal);
  const financeApprovedAt = text(order.financeApprovedAt) || text(order.financeReviewedAt);
  let representativeName = text(order.createdByName) || text(order.salesRep);
  if ((!representativeName || representativeName === canonicalCreatorUid) && deps.detailRepository.getRepresentative) {
    const representative = await deps.detailRepository.getRepresentative(canonicalCreatorUid);
    representativeName = text(representative?.name) || text(representative?.fullName) || text(representative?.displayName);
  }

  return {
    authorized: true,
    detail: {
      kind: "AUTHORITATIVE_ORDER_OPERATIONS_DETAIL",
      orderId: current.id,
      displayNumber: text(order.displayNumber) || current.id,
      version: current.version,
      currentStatus,
      stage: text(order.stage) || "OPERATIONS_REVIEW",
      pharmacyId: text(order.pharmacyId),
      pharmacyName: text(order.pharmacyName),
      areaId,
      countryId: text(order.countryId),
      marketId: text(order.marketId),
      currencyCode: text(order.currencyCode || order.currency),
      marketContext,
      creatorUid: canonicalCreatorUid,
      representativeName: representativeName || "Representative",
      orderDate: text(order.orderDate) || text(order.date) || text(order.createdAt),
      items: reviewItems(order),
      total: Number.isFinite(total) && total >= 0 ? total : 0,
      financePrerequisite: {
        approved: true,
        approvedAt: financeApprovedAt,
        approvedByUid: text(order.financeApprovedByUid) || text(order.financeReviewedByUid),
        approvedByName: text(order.financeApprovedByName) || text(order.financeApprovedBy),
      },
      history: reviewHistory(order),
    },
  };
}
