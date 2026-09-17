import { readActorMarketContext } from "./operationalScopeRepository";
import { readOrderDisplayContext } from "./orderWorkflowDetailReadService";
import type { ActorMarketContext } from "../src/lib/operationalScopeClient";
import { Buffer } from "node:buffer";
import { getFirebaseAdminServices } from "./firebaseAdmin";
import { createFirestoreWorkflowQueueScopeRepository, type WorkflowQueueScopeRepository } from "./workflowQueueScopeRepository";
import { resolveWorkflowQueueScope, type WorkflowQueueStatus } from "./workflowQueueScopeService";

export interface OrderWorkflowQueueControls { fromDate: string; toDate: string; statuses?: WorkflowQueueStatus[]; pageSize: number; cursor?: string }
export interface OrderWorkflowQueueSummary {
  marketId?: string; countryId?: string; currencyCode?: string; marketContext?: ActorMarketContext;
  kind: "ORDER_WORKFLOW_QUEUE_SUMMARY"; orderId: string; displayNumber: string; pharmacyId: string; pharmacyName: string;
  representativeName: string; orderDate: string; currentStatus: WorkflowQueueStatus; stage: string; itemCount: number; total: number; version: string;
}
export interface OrderWorkflowQueueReadResult { authorized: boolean; code?: string; orders: OrderWorkflowQueueSummary[]; nextCursor?: string; excludedLegacyOrderIds?: string[] }
export interface QueueOrderDocument { id: string; version: string; data: Record<string, any> }
export interface OrderWorkflowQueueReadRepository {
  readMarketContext?(identity: Record<string, unknown>): Promise<ActorMarketContext>;
  queryByArea(areaId: string, statuses: WorkflowQueueStatus[], fromDate: string, toDate: string, limit: number): Promise<QueueOrderDocument[]>;
  listActivePharmacyIdsByArea(areaId: string): Promise<string[]>;
  queryByPharmacy(pharmacyId: string, statuses: WorkflowQueueStatus[], fromDate: string, toDate: string, limit: number): Promise<QueueOrderDocument[]>;
  getRepresentativeNames?(userUids: string[]): Promise<Map<string, string>>;
}
export interface OrderWorkflowQueueReadDependencies { workflowScopeRepository: WorkflowQueueScopeRepository; queueRepository: OrderWorkflowQueueReadRepository }

const DAY = 86_400_000;
const MAX_RANGE = 90 * DAY;
const MAX_PAGE = 50;
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const creatorUid = (order: Record<string, any>) => text(order.createdByUid) || text(order.salesRepUid);
const versionOf = (snapshot: any) => snapshot.updateTime ? `${snapshot.updateTime.seconds}:${snapshot.updateTime.nanoseconds}` : "";

export function parseOrderWorkflowQueueControls(input: unknown, now = new Date()): OrderWorkflowQueueControls | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const body = input as Record<string, unknown>;
  const allowed = new Set(["fromDate", "toDate", "statuses", "pageSize", "cursor"]);
  if (Object.keys(body).some((key) => !allowed.has(key))) return null;
  const toDate = text(body.toDate) || now.toISOString();
  const fromDate = text(body.fromDate) || new Date(Date.parse(toDate) - MAX_RANGE).toISOString();
  const from = Date.parse(fromDate); const to = Date.parse(toDate);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to || to - from > MAX_RANGE) return null;
  const pageSize = body.pageSize === undefined ? 25 : Number(body.pageSize);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE) return null;
  let statuses: WorkflowQueueStatus[] | undefined;
  if (body.statuses !== undefined) {
    if (!Array.isArray(body.statuses) || body.statuses.length === 0 || body.statuses.some((value) => !["FINANCE_APPROVED", "PENDING_OPERATIONS_REVIEW"].includes(text(value)))) return null;
    statuses = Array.from(new Set(body.statuses.map(text) as WorkflowQueueStatus[])).sort();
  }
  if (body.cursor !== undefined && (typeof body.cursor !== "string" || body.cursor.length > 2048)) return null;
  return { fromDate: new Date(from).toISOString(), toDate: new Date(to).toISOString(), pageSize, ...(statuses ? { statuses } : {}), ...(body.cursor ? { cursor: body.cursor as string } : {}) };
}

interface Cursor { actorUid: string; fromDate: string; toDate: string; statuses: WorkflowQueueStatus[]; lastDate: string; lastId: string }
const encodeCursor = (cursor: Cursor) => Buffer.from(JSON.stringify(cursor)).toString("base64url");
function decodeCursor(value: string | undefined): Cursor | null {
  if (!value) return null;
  try { const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")); return parsed && typeof parsed === "object" ? parsed : null; } catch { return null; }
}

export function createFirestoreOrderWorkflowQueueReadRepository(): OrderWorkflowQueueReadRepository {
  const db = getFirebaseAdminServices().db;
  return {
    readMarketContext: identity => readActorMarketContext(identity, db),
    async queryByArea(areaId, statuses, fromDate, toDate, limit) {
      const snapshot = await db.collection("orders").where("areaId", "==", areaId).where("status", "in", statuses)
        .where("createdAt", ">=", fromDate).where("createdAt", "<=", toDate).limit(limit).get();
      return snapshot.docs.map((document: any) => ({ id: document.id, version: versionOf(document), data: { ...document.data(), id: document.id } }));
    },
    async listActivePharmacyIdsByArea(areaId) {
      const snapshot = await db.collection("pharmacies").where("areaId", "==", areaId).where("active", "==", true).get();
      return snapshot.docs.filter((document: any) => document.data()?.isDeleted !== true).map((document: any) => document.id).sort();
    },
    async queryByPharmacy(pharmacyId, statuses, fromDate, toDate, limit) {
      const snapshot = await db.collection("orders").where("pharmacyId", "==", pharmacyId).where("status", "in", statuses)
        .where("createdAt", ">=", fromDate).where("createdAt", "<=", toDate).limit(limit).get();
      return snapshot.docs.map((document: any) => ({ id: document.id, version: versionOf(document), data: { ...document.data(), id: document.id } }));
    },
    async getRepresentativeNames(userUids) {
      const uniqueUids = Array.from(new Set(userUids.filter(Boolean))).sort();
      if (uniqueUids.length === 0) return new Map();
      const snapshots = await db.getAll(...uniqueUids.map((uid) => db.collection("users").doc(uid)));
      return new Map(snapshots.flatMap((snapshot: any) => {
        if (!snapshot.exists) return [];
        const user = snapshot.data() || {};
        const name = text(user.name) || text(user.fullName) || text(user.displayName);
        return name ? [[snapshot.id, name] as const] : [];
      }));
    },
  };
}

function summary(document: QueueOrderDocument): OrderWorkflowQueueSummary | null {
  const order = document.data; const status = text(order.status) as WorkflowQueueStatus; const orderDate = text(order.createdAt);
  if (!document.version || !orderDate || !["FINANCE_APPROVED", "PENDING_OPERATIONS_REVIEW"].includes(status)) return null;
  return { kind: "ORDER_WORKFLOW_QUEUE_SUMMARY", orderId: document.id, displayNumber: text(order.displayNumber) || document.id,
    marketId: text(order.marketId), countryId: text(order.countryId), currencyCode: text(order.currencyCode || order.currency),
    pharmacyId: text(order.pharmacyId), pharmacyName: text(order.pharmacyName), representativeName: text(order.createdByName) || text(order.salesRep),
    orderDate, currentStatus: status, stage: text(order.stage) || "OPERATIONS_REVIEW", itemCount: Array.isArray(order.items) ? order.items.length : 0,
    total: Number.isFinite(Number(order.total ?? order.netTotal)) ? Number(order.total ?? order.netTotal) : 0, version: document.version };
}

export async function resolveOrderWorkflowQueueRead(authenticatedActorUid: string, controls: OrderWorkflowQueueControls, dependencies?: Partial<OrderWorkflowQueueReadDependencies>): Promise<OrderWorkflowQueueReadResult> {
  const deps = { workflowScopeRepository: dependencies?.workflowScopeRepository || createFirestoreWorkflowQueueScopeRepository(), queueRepository: dependencies?.queueRepository || createFirestoreOrderWorkflowQueueReadRepository() };
  const scope = await resolveWorkflowQueueScope(authenticatedActorUid, { resource: "orders", statuses: controls.statuses }, deps.workflowScopeRepository);
  if (!scope.authorized || scope.queryPlan.denyAll || scope.resource !== "orders") return { authorized: false, code: scope.code || "WORKFLOW_SCOPE_DENIED", orders: [] };
  const cursor = decodeCursor(controls.cursor);
  if (controls.cursor && (!cursor || cursor.actorUid !== authenticatedActorUid || cursor.fromDate !== controls.fromDate || cursor.toDate !== controls.toDate || JSON.stringify(cursor.statuses) !== JSON.stringify(scope.allowedStatuses))) return { authorized: false, code: "INVALID_CURSOR", orders: [] };
  const queryConstraints = { areaIds: scope.areaIds, statuses: scope.allowedStatuses, fromDate: controls.fromDate, toDate: controls.toDate, pageSize: controls.pageSize };
  let documents: QueueOrderDocument[];
  try {
    const pharmacyIds = Array.from(new Set((await Promise.all(scope.areaIds.map((areaId) => deps.queueRepository.listActivePharmacyIdsByArea(areaId)))).flat())).sort();
    documents = (await Promise.all([
      ...scope.areaIds.map((areaId) => deps.queueRepository.queryByArea(areaId, scope.allowedStatuses, controls.fromDate, controls.toDate, controls.pageSize + 1)),
      ...pharmacyIds.map((pharmacyId) => deps.queueRepository.queryByPharmacy(pharmacyId, scope.allowedStatuses, controls.fromDate, controls.toDate, controls.pageSize + 1)),
    ])).flat();
    console.log("[WP76_OOO_QUEUE_QUERY_JSON]", JSON.stringify({ actorUid: authenticatedActorUid, actorRole: scope.role, operational: true,
      nationalScope: scope.configuredBoundary.kind === "COUNTRY", expectedStatuses: scope.allowedStatuses, queryConstraints,
      querySucceeded: true, firebaseCode: null, documentsReturned: documents.length, returnedOrderIds: Array.from(new Set(documents.map((document) => document.id))).sort() }));
  } catch (error: any) {
    console.log("[WP76_OOO_QUEUE_QUERY_JSON]", JSON.stringify({ actorUid: authenticatedActorUid, actorRole: scope.role, operational: true,
      nationalScope: scope.configuredBoundary.kind === "COUNTRY", expectedStatuses: scope.allowedStatuses, queryConstraints,
      querySucceeded: false, firebaseCode: text(error?.code) || "UNKNOWN", documentsReturned: 0, returnedOrderIds: [] }));
    throw error;
  }
  const byId = new Map(documents.map((document) => [document.id, document]));
  const representativeUids = Array.from(byId.values()).map((document) => creatorUid(document.data)).filter(Boolean);
  const representativeNames = deps.queueRepository.getRepresentativeNames
    ? await deps.queueRepository.getRepresentativeNames(representativeUids)
    : new Map<string, string>();
  let orders = Array.from(byId.values()).flatMap((document) => {
    const value = summary(document); const data = document.data; const persistedStatus = text(data.status); const persistedStage = text(data.stage);
    if (value) {
      const uid = creatorUid(data);
      if (!value.representativeName || value.representativeName === uid) value.representativeName = representativeNames.get(uid) || "Representative";
    }
    const statusEligible = scope.allowedStatuses.includes(persistedStatus as WorkflowQueueStatus);
    const stageEligible = !persistedStage || persistedStage === "OPERATIONS_REVIEW";
    const geographyEligible = scope.areaIds.includes(text(data.areaId)) || Boolean(value && text(data.pharmacyId));
    const exclusionReason = value ? null : !statusEligible ? "STATUS_NOT_AUTHORIZED" : !stageEligible ? "STAGE_NOT_AUTHORIZED" : !geographyEligible ? "GEOGRAPHY_UNRESOLVED" : "MALFORMED_QUEUE_RECORD";
    console.log("[WP76_OOO_ORDER_FILTER_JSON]", JSON.stringify({ orderId: document.id, displayNumber: text(data.displayNumber) || document.id,
      persistedStatus, persistedStage, actorRole: scope.role, statusEligible, stageEligible, geographyEligible, hierarchyEligible: true,
      securityEligible: Boolean(value), finalVisible: Boolean(value), exclusionReason }));
    console.log("[WP76_OOO_QUEUE_CERTIFICATION_JSON]", JSON.stringify({ orderId: document.id, persistedStatus,
      expectedInOperationsQueue: statusEligible, queryReturnedOrder: true, visibleInOperationsQueue: Boolean(value),
      rootCause: !text(data.areaId) && value ? "MISSING_ORDER_GEOGRAPHY_RESOLVED_VIA_BOUNDED_PHARMACY" : exclusionReason,
      repairApplied: !text(data.areaId) && Boolean(value), certified: Boolean(value) }));
    return value ? [value] : [];
  })
    .filter((item) => !cursor || item.orderDate < cursor.lastDate || (item.orderDate === cursor.lastDate && item.orderId > cursor.lastId))
    .sort((a, b) => b.orderDate.localeCompare(a.orderDate) || a.orderId.localeCompare(b.orderId));
  const hasMore = orders.length > controls.pageSize; orders = orders.slice(0, controls.pageSize);
  // Only the returned page receives bounded market reads. Cache record acquisition,
  // but validate every Order's own persisted currency/country against the result.
  const contexts = new Map<string, Promise<ActorMarketContext>>();
  const readContext = deps.queueRepository.readMarketContext;
  const cachedRead = readContext ? (identity: Record<string, unknown>) => {
    const key = JSON.stringify(identity);
    if (!contexts.has(key)) contexts.set(key, readContext(identity));
    return contexts.get(key)!;
  } : undefined;
  for (const row of orders) {
    row.marketContext = await readOrderDisplayContext(byId.get(row.orderId)!.data, cachedRead);
  }
  const last = orders.at(-1);
  return { authorized: true, orders, excludedLegacyOrderIds: [], ...(hasMore && last ? { nextCursor: encodeCursor({ actorUid: authenticatedActorUid, fromDate: controls.fromDate, toDate: controls.toDate, statuses: scope.allowedStatuses, lastDate: last.orderDate, lastId: last.orderId }) } : {}) };
}
