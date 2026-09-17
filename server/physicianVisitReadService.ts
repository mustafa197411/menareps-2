import type { Physician, PhysicianVisit } from "../src/types";
import { getFirebaseAdminServices } from "./firebaseAdmin";
import {
  createFirestoreOperationalScopeRepository,
  resolveOperationalScopeForActor,
  type OperationalScopeRepository,
} from "./operationalScopeRepository";
import type { EffectiveOperationalScope } from "./operationalScopeService";
import { OrganizationalHierarchyError } from "./organizationalHierarchyService";
import {
  createFirestorePhysicianReadRepository,
  filterPhysiciansWithinOperationalScope,
  type PhysicianReadRepository,
} from "./physicianReadService";

const DAY_MS = 86_400_000;
const DEFAULT_WINDOW_DAYS = 90;
const MAX_WINDOW_DAYS = 90;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

export interface PhysicianVisitReadControls {
  fromDate: string;
  toDate: string;
  pageSize: number;
  cursor?: string;
}

export interface PhysicianVisitReadRepository {
  queryBySubjectUids(subjectUids: string[], fromDate: string, toDate: string): Promise<PhysicianVisit[]>;
}

export interface ScopedPhysicianVisitReadResult {
  authorized: boolean;
  code?: string;
  visits: PhysicianVisit[];
  nextCursor?: string;
}

const APPROVED_HISTORY_ROLES = new Set([
  "Medical Representative",
  "Medical Supervisor",
  "Medical Manager",
  "Country Manager",
  "General Manager",
  "Super Admin",
  "Admin",
]);

const EXPECTED_SCOPE_DENIAL_CODES = new Set([
  "UNAUTHENTICATED",
  "ACTOR_UID_MISMATCH",
  "ACTOR_NOT_FOUND",
  "ACTOR_INACTIVE",
  "HIERARCHY_PERMISSION_DENIED",
  "SUBORDINATE_ENUMERATION_DENIED",
]);

const canonicalIds = (values: unknown): string[] => Array.isArray(values)
  ? Array.from(new Set(values.filter((value): value is string => typeof value === "string" && value.trim() !== "").map((value) => value.trim()))).sort()
  : [];

const isoDate = (value: Date): string => value.toISOString().slice(0, 10);

export function parsePhysicianVisitReadControls(body: unknown, now = new Date()): PhysicianVisitReadControls | null {
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
const decodeCursor = (cursor: string | undefined, actorUid: string, controls: PhysicianVisitReadControls): CursorPayload | null => {
  if (!cursor) return null;
  try {
    const payload = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as CursorPayload;
    if (payload.actorUid !== actorUid || payload.fromDate !== controls.fromDate || payload.toDate !== controls.toDate || typeof payload.visitDate !== "string" || typeof payload.id !== "string") return null;
    return payload;
  } catch { return null; }
};

function visitProductIds(visit: PhysicianVisit): string[] {
  return canonicalIds([
    ...(visit.detailing || []).map((item) => item.productId),
    ...(visit.samples || []).map((item) => item.productId),
    ...(visit.samplesDistributed || []).map((item) => item.productId),
    ...((visit.productsDetailed || []).map((item) => item?.productId || item?.id)),
  ]);
}

function redactProducts(visit: PhysicianVisit, scope: EffectiveOperationalScope): PhysicianVisit {
  const allowedProducts = new Set(canonicalIds(scope.productIds));
  const allowedGroups = new Set(canonicalIds(scope.productGroupIds));
  const detailing = (visit.detailing || []).filter((item) => allowedProducts.has(item.productId));
  const samples = (visit.samples || []).filter((item) => allowedProducts.has(item.productId));
  const samplesDistributed = (visit.samplesDistributed || []).filter((item) => allowedProducts.has(item.productId));
  const productsDetailed = (visit.productsDetailed || []).filter((item) => allowedProducts.has(item?.productId || item?.id));
  const targetPromotionGroups = canonicalIds(visit.targetPromotionGroups).filter((id) => allowedGroups.has(id));
  const primaryPromotionGroup = visit.primaryPromotionGroup && allowedGroups.has(visit.primaryPromotionGroup) ? visit.primaryPromotionGroup : undefined;
  const hadProductData = visitProductIds(visit).length > 0;
  const hasAuthorizedProduct = detailing.length + samples.length + samplesDistributed.length + productsDetailed.length > 0;
  return {
    ...visit,
    detailing,
    samples,
    samplesDistributed,
    productsDetailed,
    targetPromotionGroups,
    primaryPromotionGroup,
    ...((hadProductData && !hasAuthorizedProduct) ? {
      prescriptionIntent: 0,
      generalNotes: "",
      additionalNotes: "",
      overallVisitNotes: "",
      marketingRequest: undefined,
      marketingRequests: [],
      sampleRequests: [],
      additionalSampleRequests: [],
    } : {}),
  };
}

function isWellFormedVisit(visit: PhysicianVisit): boolean {
  return typeof visit.id === "string" && visit.id.trim() !== ""
    && typeof visit.repId === "string" && visit.repId.trim() !== ""
    && typeof visit.physicianId === "string" && visit.physicianId.trim() !== ""
    && typeof visit.visitDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(visit.visitDate);
}

export function filterPhysicianVisitsWithinOperationalScope(
  visits: PhysicianVisit[],
  scope: EffectiveOperationalScope,
  boundedLegacyPhysicianIds: Set<string>,
): PhysicianVisit[] {
  if (!scope.authorized || scope.queryPlan.denyAll || !APPROVED_HISTORY_ROLES.has(scope.role)) return [];
  const subjects = new Set(canonicalIds(scope.subjectUids));
  const areas = new Set(canonicalIds(scope.areaIds));
  if (subjects.size === 0 || areas.size === 0) return [];
  const byId = new Map<string, PhysicianVisit>();
  for (const visit of visits) {
    if (!isWellFormedVisit(visit) || !subjects.has(visit.repId.trim())) continue;
    const areaId = typeof visit.areaId === "string" ? visit.areaId.trim() : "";
    if (areaId ? !areas.has(areaId) : !boundedLegacyPhysicianIds.has(visit.physicianId.trim())) continue;
    byId.set(visit.id.trim(), redactProducts(visit, scope));
  }
  return Array.from(byId.values()).sort((left, right) => right.visitDate.localeCompare(left.visitDate) || left.id.localeCompare(right.id));
}

export function createFirestorePhysicianVisitReadRepository(): PhysicianVisitReadRepository {
  return {
    async queryBySubjectUids(subjectUids, fromDate, toDate) {
      const subjects = canonicalIds(subjectUids);
      if (subjects.length === 0 || subjects.length > 30) throw new Error("Physician visit subject query must contain 1-30 canonical UIDs");
      const { db } = getFirebaseAdminServices();
      const snapshot = await db.collection("physicianVisits")
        .where("repId", "in", subjects)
        .where("visitDate", ">=", fromDate)
        .where("visitDate", "<=", toDate)
        .get();
      const visits = snapshot.docs.map((document) => ({ id: document.id, ...document.data() } as PhysicianVisit));
      const requestIds = canonicalIds(visits.flatMap(visit => visit.marketingRequestIds || []));
      if (!requestIds.length) return visits;
      const requestDocuments = await db.getAll(...requestIds.map(id => db.collection("visitMarketingRequests").doc(id)));
      const requestsById = new Map(requestDocuments.filter(doc => doc.exists).map(doc => [doc.id, { id: doc.id, ...doc.data() }]));
      return visits.map(visit => {
        const canonicalRequests = (visit.marketingRequestIds || []).map(id => requestsById.get(id)).filter(Boolean);
        return canonicalRequests.length ? { ...visit, marketingRequests: canonicalRequests } : visit;
      });
    },
  };
}

export async function resolveScopedPhysicianVisitRead(
  authenticatedActorUid: string,
  controls: PhysicianVisitReadControls,
  dependencies: {
    operationalScopeRepository?: OperationalScopeRepository;
    physicianVisitReadRepository?: PhysicianVisitReadRepository;
    legacyPhysicianReadRepository?: PhysicianReadRepository;
  } = {},
): Promise<ScopedPhysicianVisitReadResult> {
  let scope: EffectiveOperationalScope;
  try {
    scope = await resolveOperationalScopeForActor(authenticatedActorUid, {}, dependencies.operationalScopeRepository || createFirestoreOperationalScopeRepository());
  } catch (error) {
    if (error instanceof OrganizationalHierarchyError && EXPECTED_SCOPE_DENIAL_CODES.has(error.code)) return { authorized: false, code: error.code, visits: [] };
    throw error;
  }
  if (!scope.authorized || scope.queryPlan.denyAll) return { authorized: false, code: scope.code || "OPERATIONAL_SCOPE_DENIED", visits: [] };
  if (!APPROVED_HISTORY_ROLES.has(scope.role)) return { authorized: false, code: "PHYSICIAN_VISIT_HISTORY_ROLE_DENIED", visits: [] };
  if (scope.queryPlan.subjectUidChunks.length === 0 || scope.queryPlan.areaIdChunks.length === 0) return { authorized: false, code: "INVALID_VISIT_QUERY_PLAN", visits: [] };
  const cursor = decodeCursor(controls.cursor, authenticatedActorUid, controls);
  if (controls.cursor && !cursor) return { authorized: false, code: "INVALID_VISIT_CURSOR", visits: [] };

  const repository = dependencies.physicianVisitReadRepository || createFirestorePhysicianVisitReadRepository();
  const chunks = scope.queryPlan.subjectUidChunks;
  if (chunks.some((chunk) => chunk.length === 0 || chunk.length > 30)) return { authorized: false, code: "INVALID_VISIT_QUERY_PLAN", visits: [] };
  const queried = (await Promise.all(chunks.map((chunk) => repository.queryBySubjectUids(chunk, controls.fromDate, controls.toDate)))).flat();
  const legacyIds = canonicalIds(queried.filter((visit) => !visit.areaId).map((visit) => visit.physicianId));
  let boundedLegacyPhysicianIds = new Set<string>();
  if (legacyIds.length > 0) {
    const physicianRepository = dependencies.legacyPhysicianReadRepository || createFirestorePhysicianReadRepository();
    const physicians = (await Promise.all(scope.queryPlan.areaIdChunks.map((chunk) => physicianRepository.queryByAreaIds(chunk)))).flat();
    const authorizedPhysicians = filterPhysiciansWithinOperationalScope(physicians, scope);
    const requested = new Set(legacyIds);
    boundedLegacyPhysicianIds = new Set(authorizedPhysicians.map((physician: Physician) => physician.id).filter((id) => requested.has(id)));
  }
  let authorized = filterPhysicianVisitsWithinOperationalScope(queried, scope, boundedLegacyPhysicianIds);
  if (cursor) authorized = authorized.filter((visit) => visit.visitDate < cursor.visitDate || (visit.visitDate === cursor.visitDate && visit.id > cursor.id));
  const page = authorized.slice(0, controls.pageSize);
  const last = page.at(-1);
  return {
    authorized: true,
    visits: page,
    ...(authorized.length > page.length && last ? { nextCursor: encodeCursor({ actorUid: authenticatedActorUid, fromDate: controls.fromDate, toDate: controls.toDate, visitDate: last.visitDate, id: last.id }) } : {}),
  };
}
