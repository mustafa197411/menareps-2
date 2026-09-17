import type { Physician } from "../src/types";
import { getFirebaseAdminServices } from "./firebaseAdmin";
import {
  createFirestoreOperationalScopeRepository,
  resolveOperationalScopeForActor,
  type OperationalScopeRepository,
} from "./operationalScopeRepository";
import type { EffectiveOperationalScope } from "./operationalScopeService";
import { OrganizationalHierarchyError } from "./organizationalHierarchyService";

export interface PhysicianReadRepository {
  queryByAreaIds(areaIds: string[]): Promise<Physician[]>;
  queryPlannerVisitsByRep?(repId: string): Promise<Array<{ physicianId?: string; date?: string; status?: string; planStatus?: string }>>;
}

export interface ScopedPhysicianReadResult {
  authorized: boolean;
  code?: string;
  physicians: Physician[];
}

export function isValidScopedPhysicianReadRequest(body: unknown): boolean {
  return Boolean(body)
    && typeof body === "object"
    && !Array.isArray(body)
    && Object.keys(body as Record<string, unknown>).length === 0;
}

const canonicalIds = (values: unknown): string[] => Array.isArray(values)
  ? Array.from(new Set(values.filter((value): value is string => typeof value === "string" && value.trim() !== "").map((value) => value.trim()))).sort()
  : [];

const EXPECTED_SCOPE_DENIAL_CODES = new Set([
  "UNAUTHENTICATED",
  "ACTOR_UID_MISMATCH",
  "ACTOR_NOT_FOUND",
  "ACTOR_INACTIVE",
  "HIERARCHY_PERMISSION_DENIED",
  "SUBORDINATE_ENUMERATION_DENIED",
]);

function physicianProductGroupIds(physician: Physician): string[] {
  return canonicalIds([
    physician.primaryPromotionGroupId,
    ...(physician.targetPromotionGroupIds || []),
  ]);
}

function isActivePhysician(physician: Physician): boolean {
  const record = physician as Physician & { isDeleted?: boolean; active?: boolean; status?: string };
  return record.isDeleted !== true
    && record.active !== false
    && record.status !== "Inactive"
    && record.status !== "Archived";
}

export function filterPhysiciansWithinOperationalScope(
  physicians: Physician[],
  scope: EffectiveOperationalScope,
): Physician[] {
  if (!scope.authorized || scope.queryPlan.denyAll) return [];

  const allowedAreas = new Set(canonicalIds(scope.areaIds));
  const allowedProductGroups = new Set(canonicalIds(scope.productGroupIds));

  if (allowedAreas.size === 0 || allowedProductGroups.size === 0) {
    return [];
  }

  const byId = new Map<string, Physician>();
  for (const physician of physicians) {
    const id = typeof physician.id === "string" ? physician.id.trim() : "";
    const areaId = typeof physician.areaId === "string" ? physician.areaId.trim() : "";
    if (!id || !areaId || !allowedAreas.has(areaId) || !isActivePhysician(physician)) continue;

    const groupMatch = physicianProductGroupIds(physician).some((id) => allowedProductGroups.has(id));
    // Canonical product assignments carry their product-group identity. A
    // physician is eligible through a promotion-group overlap; legacy explicit
    // alignedProductIds may additionally prove overlap but never replace it.
    if (!groupMatch) continue;

    byId.set(id, physician);
  }
  return Array.from(byId.values()).sort((left, right) => left.id.localeCompare(right.id));
}

export function createFirestorePhysicianReadRepository(): PhysicianReadRepository {
  return {
    async queryByAreaIds(areaIds) {
      const canonicalAreaIds = canonicalIds(areaIds);
      if (canonicalAreaIds.length === 0 || canonicalAreaIds.length > 30) {
        throw new Error("Physician area query must contain between 1 and 30 canonical IDs");
      }
      const { db } = getFirebaseAdminServices();
      const snapshot = await db.collection("physicians")
        .where("areaId", "in", canonicalAreaIds)
        .get();
      return snapshot.docs.map((document) => ({ id: document.id, ...document.data() } as Physician));
    },
    async queryPlannerVisitsByRep(repId) {
      const { db } = getFirebaseAdminServices();
      const snapshot = await db.collection("medicalPlannerVisits").where("repId", "==", repId).get();
      return snapshot.docs.map(document => document.data());
    },
  };
}

export async function resolveScopedPhysicianRead(
  authenticatedActorUid: string,
  dependencies: {
    operationalScopeRepository?: OperationalScopeRepository;
    physicianReadRepository?: PhysicianReadRepository;
    today?: () => string;
  } = {},
): Promise<ScopedPhysicianReadResult> {
  let scope: EffectiveOperationalScope;
  try {
    scope = await resolveOperationalScopeForActor(
      authenticatedActorUid,
      {},
      dependencies.operationalScopeRepository || createFirestoreOperationalScopeRepository(),
    );
  } catch (error) {
    if (error instanceof OrganizationalHierarchyError && EXPECTED_SCOPE_DENIAL_CODES.has(error.code)) {
      return { authorized: false, code: error.code, physicians: [] };
    }
    throw error;
  }

  if (!scope.authorized || scope.queryPlan.denyAll) {
    return { authorized: false, code: scope.code || "OPERATIONAL_SCOPE_DENIED", physicians: [] };
  }

  const chunks = scope.queryPlan.areaIdChunks;
  if (chunks.length === 0 || chunks.some((chunk) => chunk.length === 0 || chunk.length > 30)) {
    return { authorized: false, code: "INVALID_AREA_QUERY_PLAN", physicians: [] };
  }

  const physicianRepository = dependencies.physicianReadRepository || createFirestorePhysicianReadRepository();
  const [boundedResults, plannerVisits] = await Promise.all([
    Promise.all(chunks.map((chunk) => physicianRepository.queryByAreaIds(chunk))),
    physicianRepository.queryPlannerVisitsByRep?.(authenticatedActorUid) || Promise.resolve([]),
  ]);
  const today = dependencies.today?.() || new Date().toISOString().slice(0, 10);
  const plannedToday = new Set(plannerVisits.filter(visit => visit.date === today && (visit.planStatus === "SAVED" || visit.status === "SAVED")).map(visit => visit.physicianId));
  return {
    authorized: true,
    physicians: filterPhysiciansWithinOperationalScope(boundedResults.flat(), scope).map(physician => plannedToday.has(physician.id) ? { ...physician, plannedVisitDate: today } : { ...physician, plannedVisitDate: undefined }),
  };
}
