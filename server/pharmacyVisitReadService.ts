import type { Pharmacy, PharmacyVisit } from "../src/types";
import { validateMarketSettings, type MarketBusinessSettings } from "../src/lib/marketSettings";
import { getFirebaseAdminServices } from "./firebaseAdmin";
import {
  createFirestoreOperationalScopeRepository,
  resolveOperationalScopeForActor,
  type OperationalScopeRepository,
} from "./operationalScopeRepository";
import type { EffectiveOperationalScope } from "./operationalScopeService";
import { OrganizationalHierarchyError } from "./organizationalHierarchyService";
import {
  createFirestorePharmacyReadRepository,
  filterPharmaciesWithinOperationalScope,
  type PharmacyReadRepository,
} from "./pharmacyReadService";

const DAY_MS = 86_400_000;
const DEFAULT_WINDOW_DAYS = 90;
const MAX_WINDOW_DAYS = 90;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

export interface PharmacyVisitReadControls { fromDate: string; toDate: string; pageSize: number; cursor?: string }
export interface PharmacyVisitReadRepository { queryBySubjectUids(subjectUids: string[], fromDate: string, toDate: string): Promise<PharmacyVisit[]> }
export interface PharmacyVisitMarketIdentity { marketId: string; countryId: string }
export type RenderablePharmacyVisit = PharmacyVisit & { resolvedMarketIdentity?: PharmacyVisitMarketIdentity };
export interface ScopedPharmacyVisitReadResult { authorized: boolean; code?: string; visits: RenderablePharmacyVisit[]; marketSettings?: MarketBusinessSettings[]; nextCursor?: string }
export interface PharmacyVisitMarketReadRepository {
  getAreasByIds(areaIds: string[]): Promise<Array<{ id: string; countryId?: string; active?: boolean; status?: string }>>;
  getActiveMarkets(): Promise<MarketBusinessSettings[]>;
}

const APPROVED_HISTORY_ROLES = new Set([
  "Sales Representative", "Sales Supervisor", "Area Sales Manager", "Sales Manager",
  "Sales & Marketing Manager", "Country Manager", "General Manager", "Super Admin",
]);
const EXPECTED_SCOPE_DENIAL_CODES = new Set([
  "UNAUTHENTICATED", "ACTOR_UID_MISMATCH", "ACTOR_NOT_FOUND", "ACTOR_INACTIVE",
  "HIERARCHY_PERMISSION_DENIED", "SUBORDINATE_ENUMERATION_DENIED",
]);
const SENSITIVE_FIELDS = [
  "order", "orders", "orderLines", "payment", "payments", "paymentEntry", "receipt", "receiptUrl",
  "receiptImage", "cheque", "chequeInformation", "balance", "balancePreview", "stock", "samples",
  "sampleRequests", "delivery", "inventory",
];

const canonicalIds = (values: unknown): string[] => Array.isArray(values)
  ? Array.from(new Set(values.filter((value): value is string => typeof value === "string" && value.trim() !== "").map((value) => value.trim()))).sort()
  : [];
const isoDate = (value: Date): string => value.toISOString().slice(0, 10);
const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";

export function resolvePharmacyVisitMarketIdentity(
  visit: PharmacyVisit,
  pharmacy: Pharmacy | undefined,
  area: { id: string; countryId?: string } | undefined,
  markets: readonly MarketBusinessSettings[],
): PharmacyVisitMarketIdentity | null {
  const activeMarkets = markets.filter((market) => market.active && validateMarketSettings(market).length === 0);
  const pharmacyCountryId = text(pharmacy?.countryId);
  const areaCountryId = text(area?.countryId);
  if (pharmacyCountryId && areaCountryId && pharmacyCountryId !== areaCountryId) return null;
  const canonicalCountryId = pharmacyCountryId || areaCountryId;
  if (canonicalCountryId) {
    const matches = activeMarkets.filter((market) => market.countryId === canonicalCountryId);
    return matches.length === 1 ? { marketId: matches[0].marketId, countryId: matches[0].countryId } : null;
  }

  const persistedMarketId = text((visit as PharmacyVisit & { marketId?: unknown }).marketId);
  const persistedCountryId = text((visit as PharmacyVisit & { countryId?: unknown }).countryId);
  const matches = activeMarkets.filter((market) =>
    (!persistedMarketId || market.marketId === persistedMarketId)
    && (!persistedCountryId || market.countryId === persistedCountryId),
  );
  return (persistedMarketId || persistedCountryId) && matches.length === 1
    ? { marketId: matches[0].marketId, countryId: matches[0].countryId }
    : null;
}

export function createFirestorePharmacyVisitMarketReadRepository(): PharmacyVisitMarketReadRepository {
  return {
    async getAreasByIds(areaIds) {
      const { db } = getFirebaseAdminServices();
      const snapshots = await Promise.all(canonicalIds(areaIds).map((areaId) => db.collection("areas").doc(areaId).get()));
      return snapshots.filter((snapshot) => snapshot.exists && snapshot.data()?.active !== false && snapshot.data()?.status !== "Inactive")
        .map((snapshot) => ({ id: snapshot.id, countryId: text(snapshot.data()?.countryId) }));
    },
    async getActiveMarkets() {
      const { db } = getFirebaseAdminServices();
      const snapshot = await db.collection("marketSettings").where("active", "==", true).get();
      return snapshot.docs.map((document) => ({ marketId: document.id, ...document.data() } as MarketBusinessSettings));
    },
  };
}

export function parsePharmacyVisitReadControls(body: unknown, now = new Date()): PharmacyVisitReadControls | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some((key) => !["fromDate", "toDate", "pageSize", "cursor"].includes(key))) return null;
  const toDate = input.toDate === undefined ? isoDate(now) : input.toDate;
  const defaultFrom = new Date(new Date(`${toDate}T00:00:00.000Z`).getTime() - (DEFAULT_WINDOW_DAYS - 1) * DAY_MS);
  const fromDate = input.fromDate === undefined ? isoDate(defaultFrom) : input.fromDate;
  const pageSize = input.pageSize === undefined ? DEFAULT_PAGE_SIZE : input.pageSize;
  const cursor = input.cursor;
  if (typeof fromDate !== "string" || typeof toDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) return null;
  if (!Number.isInteger(pageSize) || Number(pageSize) < 1 || Number(pageSize) > MAX_PAGE_SIZE) return null;
  if (cursor !== undefined && (typeof cursor !== "string" || cursor.length > 2048)) return null;
  const validatedCursor = typeof cursor === "string" ? cursor : undefined;
  const fromMs = Date.parse(`${fromDate}T00:00:00.000Z`);
  const toMs = Date.parse(`${toDate}T00:00:00.000Z`);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs > toMs || (toMs - fromMs) / DAY_MS >= MAX_WINDOW_DAYS) return null;
  return { fromDate, toDate, pageSize: Number(pageSize), ...(validatedCursor ? { cursor: validatedCursor } : {}) };
}

interface CursorPayload { actorUid: string; fromDate: string; toDate: string; visitDate: string; id: string }
const encodeCursor = (payload: CursorPayload): string => Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
const decodeCursor = (cursor: string | undefined, actorUid: string, controls: PharmacyVisitReadControls): CursorPayload | null => {
  if (!cursor) return null;
  try {
    const payload = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as CursorPayload;
    if (payload.actorUid !== actorUid || payload.fromDate !== controls.fromDate || payload.toDate !== controls.toDate || typeof payload.visitDate !== "string" || typeof payload.id !== "string") return null;
    return payload;
  } catch { return null; }
};

export function redactPharmacyVisitCommercialFields(visit: PharmacyVisit): PharmacyVisit {
  const redacted = { ...visit } as PharmacyVisit & Record<string, unknown>;
  for (const field of SENSITIVE_FIELDS) delete redacted[field];
  redacted.items = [];
  redacted.totalAmount = 0;
  redacted.discountApplied = 0;
  redacted.netAmount = 0;
  redacted.paymentCollected = undefined;
  redacted.outstandingBalanceAfter = undefined;
  redacted.stockAudit = [];
  redacted.stockRequests = [];
  redacted.intelNotes = "";
  return redacted;
}

function isWellFormedVisit(visit: PharmacyVisit): boolean {
  return typeof visit.id === "string" && visit.id.trim() !== ""
    && typeof visit.repId === "string" && visit.repId.trim() !== ""
    && typeof visit.pharmacyId === "string" && visit.pharmacyId.trim() !== ""
    && typeof visit.visitDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(visit.visitDate);
}

export function filterPharmacyVisitsWithinOperationalScope(
  visits: PharmacyVisit[], scope: EffectiveOperationalScope, boundedLegacyPharmacyIds: Set<string>,
): PharmacyVisit[] {
  if (!scope.authorized || scope.queryPlan.denyAll || !APPROVED_HISTORY_ROLES.has(scope.role)) return [];
  const subjects = new Set(canonicalIds(scope.subjectUids));
  const areas = new Set(canonicalIds(scope.areaIds));
  if (subjects.size === 0 || areas.size === 0) return [];
  const byId = new Map<string, PharmacyVisit>();
  for (const visit of visits) {
    if (!isWellFormedVisit(visit) || !subjects.has(visit.repId.trim())) continue;
    const areaId = typeof (visit as PharmacyVisit & { areaId?: unknown }).areaId === "string" ? String((visit as PharmacyVisit & { areaId?: string }).areaId).trim() : "";
    if (areaId ? !areas.has(areaId) : !boundedLegacyPharmacyIds.has(visit.pharmacyId.trim())) continue;
    byId.set(visit.id.trim(), redactPharmacyVisitCommercialFields(visit));
  }
  return Array.from(byId.values()).sort((left, right) => right.visitDate.localeCompare(left.visitDate) || left.id.localeCompare(right.id));
}

export function createFirestorePharmacyVisitReadRepository(): PharmacyVisitReadRepository {
  return {
    async queryBySubjectUids(subjectUids, fromDate, toDate) {
      const subjects = canonicalIds(subjectUids);
      if (subjects.length === 0 || subjects.length > 30) throw new Error("Pharmacy visit subject query must contain 1-30 canonical UIDs");
      const { db } = getFirebaseAdminServices();
      const snapshot = await db.collection("pharmacyVisits")
        .where("repId", "in", subjects)
        .where("visitDate", ">=", fromDate)
        .where("visitDate", "<=", toDate)
        .get();
      return snapshot.docs.map((document) => ({ id: document.id, ...document.data() } as PharmacyVisit));
    },
  };
}

export async function resolveScopedPharmacyVisitRead(
  authenticatedActorUid: string,
  controls: PharmacyVisitReadControls,
  dependencies: {
    operationalScopeRepository?: OperationalScopeRepository;
    pharmacyVisitReadRepository?: PharmacyVisitReadRepository;
    legacyPharmacyReadRepository?: PharmacyReadRepository;
    marketReadRepository?: PharmacyVisitMarketReadRepository;
  } = {},
): Promise<ScopedPharmacyVisitReadResult> {
  let scope: EffectiveOperationalScope;
  try {
    scope = await resolveOperationalScopeForActor(authenticatedActorUid, {}, dependencies.operationalScopeRepository || createFirestoreOperationalScopeRepository());
  } catch (error) {
    if (error instanceof OrganizationalHierarchyError && EXPECTED_SCOPE_DENIAL_CODES.has(error.code)) return { authorized: false, code: error.code, visits: [] };
    throw error;
  }
  if (!scope.authorized || scope.queryPlan.denyAll) return { authorized: false, code: scope.code || "OPERATIONAL_SCOPE_DENIED", visits: [] };
  if (!APPROVED_HISTORY_ROLES.has(scope.role)) return { authorized: false, code: "PHARMACY_VISIT_HISTORY_ROLE_DENIED", visits: [] };
  if (scope.queryPlan.subjectUidChunks.length === 0 || scope.queryPlan.areaIdChunks.length === 0) return { authorized: false, code: "INVALID_VISIT_QUERY_PLAN", visits: [] };
  const cursor = decodeCursor(controls.cursor, authenticatedActorUid, controls);
  if (controls.cursor && !cursor) return { authorized: false, code: "INVALID_VISIT_CURSOR", visits: [] };
  if (scope.queryPlan.subjectUidChunks.some((chunk) => chunk.length === 0 || chunk.length > 30)) return { authorized: false, code: "INVALID_VISIT_QUERY_PLAN", visits: [] };

  const repository = dependencies.pharmacyVisitReadRepository || createFirestorePharmacyVisitReadRepository();
  const queried = (await Promise.all(scope.queryPlan.subjectUidChunks.map((chunk) => repository.queryBySubjectUids(chunk, controls.fromDate, controls.toDate)))).flat();
  const legacyIds = canonicalIds(queried.filter((visit) => !(visit as PharmacyVisit & { areaId?: unknown }).areaId).map((visit) => visit.pharmacyId));
  let boundedLegacyPharmacyIds = new Set<string>();
  const pharmacyRepository = dependencies.legacyPharmacyReadRepository || createFirestorePharmacyReadRepository();
  const pharmacies = (await Promise.all(scope.queryPlan.areaIdChunks.map((chunk) => pharmacyRepository.queryByAreaIds(chunk)))).flat();
  const authorizedPharmacies = filterPharmaciesWithinOperationalScope(pharmacies, scope);
  if (legacyIds.length > 0) {
    const requested = new Set(legacyIds);
    boundedLegacyPharmacyIds = new Set(authorizedPharmacies.map((pharmacy: Pharmacy) => pharmacy.id).filter((id) => requested.has(id)));
  }
  let authorized = filterPharmacyVisitsWithinOperationalScope(queried, scope, boundedLegacyPharmacyIds);
  if (cursor) authorized = authorized.filter((visit) => visit.visitDate < cursor.visitDate || (visit.visitDate === cursor.visitDate && visit.id > cursor.id));
  const page = authorized.slice(0, controls.pageSize);
  const marketRepository = dependencies.marketReadRepository || createFirestorePharmacyVisitMarketReadRepository();
  const pagePharmacyIds = new Set(page.map((visit) => visit.pharmacyId));
  const pagePharmacies = authorizedPharmacies.filter((pharmacy) => pagePharmacyIds.has(pharmacy.id));
  const areaIds = canonicalIds([
    ...page.map((visit) => (visit as PharmacyVisit & { areaId?: string }).areaId),
    ...pagePharmacies.map((pharmacy) => pharmacy.areaId),
  ]);
  const [areas, markets] = await Promise.all([marketRepository.getAreasByIds(areaIds), marketRepository.getActiveMarkets()]);
  const areaById = new Map(areas.map((area) => [area.id, area]));
  const pharmacyById = new Map(pagePharmacies.map((pharmacy) => [pharmacy.id, {
    ...pharmacy,
    countryId: text(pharmacy.countryId) || text(areaById.get(text(pharmacy.areaId))?.countryId),
  }]));
  const renderable = page.map((visit): RenderablePharmacyVisit => {
    const identity = resolvePharmacyVisitMarketIdentity(visit, pharmacyById.get(visit.pharmacyId), areaById.get(text((visit as PharmacyVisit & { areaId?: string }).areaId)), markets);
    return identity ? { ...visit, resolvedMarketIdentity: identity } : visit;
  });
  const last = page.at(-1);
  return {
    authorized: true,
    visits: renderable,
    marketSettings: markets.filter((market) => renderable.some((visit) => visit.resolvedMarketIdentity?.marketId === market.marketId)),
    ...(authorized.length > page.length && last ? { nextCursor: encodeCursor({ actorUid: authenticatedActorUid, fromDate: controls.fromDate, toDate: controls.toDate, visitDate: last.visitDate, id: last.id }) } : {}),
  };
}
