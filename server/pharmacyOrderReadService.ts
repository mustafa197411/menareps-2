import type { OrderRecord, Pharmacy } from "../src/types";
import { getFirebaseAdminServices } from "./firebaseAdmin";
import { createFirestoreOperationalScopeRepository, resolveOperationalScopeForActor, type OperationalScopeRepository } from "./operationalScopeRepository";
import type { EffectiveOperationalScope } from "./operationalScopeService";
import { OrganizationalHierarchyError } from "./organizationalHierarchyService";
import { createFirestorePharmacyReadRepository, filterPharmaciesWithinOperationalScope, type PharmacyReadRepository } from "./pharmacyReadService";

const DAY_MS = 86_400_000;
const DEFAULT_WINDOW_DAYS = 90;
const MAX_WINDOW_DAYS = 90;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

export interface PharmacyOrderReadRequest { pharmacyId?: string; fromDate: string; toDate: string; pageSize: number; cursor?: string }
export interface PharmacyOrderSummaryItem { id: string; name: string; quantity: number }
export interface PharmacyOrderSummary { id: string; pharmacyId: string; displayNumber: string; orderDate: string; status: string; items: PharmacyOrderSummaryItem[]; total: number }
export interface ScopedPharmacyOrderReadResult { authorized: boolean; code?: string; orders: PharmacyOrderSummary[]; nextCursor?: string; excludedLegacyOrderIds?: string[] }
export interface PharmacyOrderReadRepository { queryByCanonicalSubjectUids(subjectUids: string[]): Promise<OrderRecord[]> }

const APPROVED_SUMMARY_ROLES = new Set([
  "Sales Representative", "Sales Supervisor", "Area Sales Manager", "Sales Manager",
  "Sales & Marketing Manager", "Country Manager", "General Manager", "Super Admin",
]);
const EXPECTED_SCOPE_DENIAL_CODES = new Set([
  "UNAUTHENTICATED", "ACTOR_UID_MISMATCH", "ACTOR_NOT_FOUND", "ACTOR_INACTIVE",
  "HIERARCHY_PERMISSION_DENIED", "SUBORDINATE_ENUMERATION_DENIED",
]);
const canonicalIds = (values: unknown): string[] => Array.isArray(values)
  ? Array.from(new Set(values.filter((value): value is string => typeof value === "string" && value.trim() !== "").map((value) => value.trim()))).sort()
  : [];
const isoDate = (value: Date): string => value.toISOString().slice(0, 10);

export function parsePharmacyOrderReadRequest(body: unknown, now = new Date()): PharmacyOrderReadRequest | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some((key) => !["pharmacyId", "fromDate", "toDate", "pageSize", "cursor"].includes(key))) return null;
  const pharmacyId = input.pharmacyId;
  const toDate = input.toDate === undefined ? isoDate(now) : input.toDate;
  const defaultFrom = new Date(new Date(`${toDate}T00:00:00.000Z`).getTime() - (DEFAULT_WINDOW_DAYS - 1) * DAY_MS);
  const fromDate = input.fromDate === undefined ? isoDate(defaultFrom) : input.fromDate;
  const pageSize = input.pageSize === undefined ? DEFAULT_PAGE_SIZE : input.pageSize;
  const cursor = input.cursor;
  if (pharmacyId !== undefined && (typeof pharmacyId !== "string" || pharmacyId.trim() === "" || pharmacyId.length > 256)) return null;
  if (typeof fromDate !== "string" || typeof toDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) return null;
  if (!Number.isInteger(pageSize) || Number(pageSize) < 1 || Number(pageSize) > MAX_PAGE_SIZE) return null;
  if (cursor !== undefined && (typeof cursor !== "string" || cursor.length > 2048)) return null;
  const fromMs = Date.parse(`${fromDate}T00:00:00.000Z`);
  const toMs = Date.parse(`${toDate}T00:00:00.000Z`);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs > toMs || (toMs - fromMs) / DAY_MS >= MAX_WINDOW_DAYS) return null;
  return { fromDate, toDate, pageSize: Number(pageSize), ...(typeof pharmacyId === "string" ? { pharmacyId: pharmacyId.trim() } : {}), ...(typeof cursor === "string" && cursor ? { cursor } : {}) };
}

interface CursorPayload { actorUid: string; pharmacyId: string; fromDate: string; toDate: string; orderDate: string; id: string }
const encodeCursor = (payload: CursorPayload): string => Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
const decodeCursor = (cursor: string | undefined, actorUid: string, request: PharmacyOrderReadRequest): CursorPayload | null => {
  if (!cursor) return null;
  try {
    const payload = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as CursorPayload;
    if (payload.actorUid !== actorUid || payload.pharmacyId !== (request.pharmacyId || "") || payload.fromDate !== request.fromDate || payload.toDate !== request.toDate || typeof payload.orderDate !== "string" || typeof payload.id !== "string") return null;
    return payload;
  } catch { return null; }
};

const orderDate = (order: OrderRecord): string | null => {
  const raw = order.createdAt || order.submittedAt || order.date;
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
};

export function projectPharmacyOrderSummary(order: OrderRecord, date: string): PharmacyOrderSummary {
  return {
    id: order.id.trim(),
    pharmacyId: order.pharmacyId.trim(),
    displayNumber: typeof order.displayNumber === "string" && order.displayNumber.trim() ? order.displayNumber.trim() : order.id.trim(),
    orderDate: date,
    status: typeof order.status === "string" ? order.status : "Unknown",
    items: Array.isArray(order.items) ? order.items.filter((item) => item && typeof item.id === "string" && typeof item.name === "string" && Number.isFinite(item.quantity)).map((item) => ({ id: item.id, name: item.name, quantity: item.quantity })) : [],
    total: Number.isFinite(order.total) ? order.total : 0,
  };
}

export function filterPharmacyOrdersWithinOperationalScope(
  orders: OrderRecord[], scope: EffectiveOperationalScope, boundedPharmacyIds: Set<string>, request: PharmacyOrderReadRequest,
): { summaries: PharmacyOrderSummary[]; excludedLegacyOrderIds: string[] } {
  if (!scope.authorized || scope.queryPlan.denyAll || !APPROVED_SUMMARY_ROLES.has(scope.role)) return { summaries: [], excludedLegacyOrderIds: [] };
  const subjects = new Set(canonicalIds(scope.subjectUids));
  const areas = new Set(canonicalIds(scope.areaIds));
  const byId = new Map<string, PharmacyOrderSummary>();
  const excludedLegacyOrderIds: string[] = [];
  for (const order of orders) {
    const id = typeof order.id === "string" ? order.id.trim() : "";
    const pharmacyId = typeof order.pharmacyId === "string" ? order.pharmacyId.trim() : "";
    const canonicalActors = canonicalIds([order.createdByUid, order.salesRepUid]);
    const date = orderDate(order);
    if (!id || !pharmacyId || !date || canonicalActors.length === 0) { if (id) excludedLegacyOrderIds.push(id); continue; }
    if (!canonicalActors.some((uid) => subjects.has(uid)) || !boundedPharmacyIds.has(pharmacyId)) continue;
    if (request.pharmacyId && pharmacyId !== request.pharmacyId) continue;
    const areaId = typeof order.areaId === "string" ? order.areaId.trim() : "";
    if (areaId && !areas.has(areaId)) continue;
    if (date < request.fromDate || date > request.toDate) continue;
    byId.set(id, projectPharmacyOrderSummary(order, date));
  }
  return { summaries: Array.from(byId.values()).sort((a, b) => b.orderDate.localeCompare(a.orderDate) || a.id.localeCompare(b.id)), excludedLegacyOrderIds: canonicalIds(excludedLegacyOrderIds) };
}

export function createFirestorePharmacyOrderReadRepository(): PharmacyOrderReadRepository {
  return {
    async queryByCanonicalSubjectUids(subjectUids) {
      const subjects = canonicalIds(subjectUids);
      if (subjects.length === 0 || subjects.length > 30) throw new Error("Order subject query must contain 1-30 canonical UIDs");
      const { db } = getFirebaseAdminServices();
      const [created, sales] = await Promise.all([
        db.collection("orders").where("createdByUid", "in", subjects).get(),
        db.collection("orders").where("salesRepUid", "in", subjects).get(),
      ]);
      return [...created.docs, ...sales.docs].map((document) => ({ id: document.id, ...document.data() } as OrderRecord));
    },
  };
}

export async function resolveScopedPharmacyOrderRead(
  authenticatedActorUid: string,
  request: PharmacyOrderReadRequest,
  dependencies: { operationalScopeRepository?: OperationalScopeRepository; orderReadRepository?: PharmacyOrderReadRepository; pharmacyReadRepository?: PharmacyReadRepository } = {},
): Promise<ScopedPharmacyOrderReadResult> {
  let scope: EffectiveOperationalScope;
  try { scope = await resolveOperationalScopeForActor(authenticatedActorUid, {}, dependencies.operationalScopeRepository || createFirestoreOperationalScopeRepository()); }
  catch (error) { if (error instanceof OrganizationalHierarchyError && EXPECTED_SCOPE_DENIAL_CODES.has(error.code)) return { authorized: false, code: error.code, orders: [] }; throw error; }
  if (!scope.authorized || scope.queryPlan.denyAll) return { authorized: false, code: scope.code || "OPERATIONAL_SCOPE_DENIED", orders: [] };
  if (!APPROVED_SUMMARY_ROLES.has(scope.role)) return { authorized: false, code: "PHARMACY_ORDER_SUMMARY_ROLE_DENIED", orders: [] };
  if (!scope.queryPlan.subjectUidChunks.length || !scope.queryPlan.areaIdChunks.length || scope.queryPlan.subjectUidChunks.some((chunk) => !chunk.length || chunk.length > 30)) return { authorized: false, code: "INVALID_ORDER_QUERY_PLAN", orders: [] };
  const cursor = decodeCursor(request.cursor, authenticatedActorUid, request);
  if (request.cursor && !cursor) return { authorized: false, code: "INVALID_ORDER_CURSOR", orders: [] };

  const pharmacyRepository = dependencies.pharmacyReadRepository || createFirestorePharmacyReadRepository();
  const pharmacies = (await Promise.all(scope.queryPlan.areaIdChunks.map((chunk) => pharmacyRepository.queryByAreaIds(chunk)))).flat();
  const boundedPharmacies = filterPharmaciesWithinOperationalScope(pharmacies, scope);
  const boundedPharmacyIds = new Set(boundedPharmacies.map((pharmacy: Pharmacy) => pharmacy.id));
  if (request.pharmacyId && !boundedPharmacyIds.has(request.pharmacyId)) return { authorized: false, code: "PHARMACY_OUTSIDE_OPERATIONAL_SCOPE", orders: [] };

  const repository = dependencies.orderReadRepository || createFirestorePharmacyOrderReadRepository();
  const queried = (await Promise.all(scope.queryPlan.subjectUidChunks.map((chunk) => repository.queryByCanonicalSubjectUids(chunk)))).flat();
  let { summaries, excludedLegacyOrderIds } = filterPharmacyOrdersWithinOperationalScope(queried, scope, boundedPharmacyIds, request);
  if (cursor) summaries = summaries.filter((order) => order.orderDate < cursor.orderDate || (order.orderDate === cursor.orderDate && order.id > cursor.id));
  const page = summaries.slice(0, request.pageSize);
  const last = page.at(-1);
  return { authorized: true, orders: page, excludedLegacyOrderIds, ...(summaries.length > page.length && last ? { nextCursor: encodeCursor({ actorUid: authenticatedActorUid, pharmacyId: request.pharmacyId || "", fromDate: request.fromDate, toDate: request.toDate, orderDate: last.orderDate, id: last.id }) } : {}) };
}
