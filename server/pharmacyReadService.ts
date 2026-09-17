import type { Pharmacy, Role, User } from "../src/types";
import { canAccessView } from "../src/lib/userPolicyEngine";
import { getFirebaseAdminServices } from "./firebaseAdmin";
import {
  createFirestoreOperationalScopeRepository,
  resolveOperationalScopeForActor,
  type OperationalScopeRepository,
} from "./operationalScopeRepository";
import type { EffectiveOperationalScope } from "./operationalScopeService";
import { OrganizationalHierarchyError } from "./organizationalHierarchyService";

export interface PharmacyReadRepository {
  queryByAreaIds(areaIds: string[]): Promise<Pharmacy[]>;
}

export interface ScopedPharmacyReadResult {
  authorized: boolean;
  code?: string;
  pharmacies: Pharmacy[];
}

export function isValidScopedPharmacyReadRequest(body: unknown): boolean {
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

function isActivePharmacy(pharmacy: Pharmacy): boolean {
  const record = pharmacy as Pharmacy & { isDeleted?: boolean };
  return record.isDeleted !== true
    && record.active !== false
    && record.status !== "Inactive"
    && record.status !== "Archived";
}

export function canRoleReadPharmacyDirectory(actorUid: string, role: string): boolean {
  // Medical Supervisor access is read-only customer context for canonical
  // Supervisor Visits; it grants no commercial mutation capability.
  if (role === "Medical Supervisor") return true;
  return canAccessView({ id: actorUid, role: role as Role } as User, "pharmacies-list");
}

export function filterPharmaciesWithinOperationalScope(
  pharmacies: Pharmacy[],
  scope: EffectiveOperationalScope,
): Pharmacy[] {
  if (!scope.authorized || scope.queryPlan.denyAll) return [];

  const allowedAreas = new Set(canonicalIds(scope.areaIds));
  if (allowedAreas.size === 0 || canonicalIds(scope.subjectUids).length === 0) return [];

  const byId = new Map<string, Pharmacy>();
  for (const pharmacy of pharmacies) {
    const id = typeof pharmacy.id === "string" ? pharmacy.id.trim() : "";
    const areaId = typeof pharmacy.areaId === "string" ? pharmacy.areaId.trim() : "";
    if (!id || !areaId || !allowedAreas.has(areaId) || !isActivePharmacy(pharmacy)) continue;

    byId.set(id, pharmacy);
  }
  return Array.from(byId.values()).sort((left, right) => left.id.localeCompare(right.id));
}

export function createFirestorePharmacyReadRepository(): PharmacyReadRepository {
  return {
    async queryByAreaIds(areaIds) {
      const canonicalAreaIds = canonicalIds(areaIds);
      if (canonicalAreaIds.length === 0 || canonicalAreaIds.length > 30) {
        throw new Error("Pharmacy area query must contain between 1 and 30 canonical IDs");
      }
      const { db } = getFirebaseAdminServices();
      const snapshot = await db.collection("pharmacies")
        .where("areaId", "in", canonicalAreaIds)
        .get();
      return snapshot.docs.map((document) => ({ id: document.id, ...document.data() } as Pharmacy));
    },
  };
}

export async function resolveScopedPharmacyRead(
  authenticatedActorUid: string,
  dependencies: {
    operationalScopeRepository?: OperationalScopeRepository;
    pharmacyReadRepository?: PharmacyReadRepository;
    canReadDirectory?: (actorUid: string, role: string) => boolean;
  } = {},
): Promise<ScopedPharmacyReadResult> {
  let scope: EffectiveOperationalScope;
  try {
    scope = await resolveOperationalScopeForActor(
      authenticatedActorUid,
      {},
      dependencies.operationalScopeRepository || createFirestoreOperationalScopeRepository(),
    );
  } catch (error) {
    if (error instanceof OrganizationalHierarchyError && EXPECTED_SCOPE_DENIAL_CODES.has(error.code)) {
      return { authorized: false, code: error.code, pharmacies: [] };
    }
    throw error;
  }

  if (!scope.authorized || scope.queryPlan.denyAll) {
    return { authorized: false, code: scope.code || "OPERATIONAL_SCOPE_DENIED", pharmacies: [] };
  }
  const canReadDirectory = dependencies.canReadDirectory || canRoleReadPharmacyDirectory;
  if (!canReadDirectory(scope.actorUid, scope.role)) {
    return { authorized: false, code: "PHARMACY_DIRECTORY_ACCESS_DENIED", pharmacies: [] };
  }

  const chunks = scope.queryPlan.areaIdChunks;
  if (chunks.length === 0 || chunks.some((chunk) => chunk.length === 0 || chunk.length > 30)) {
    return { authorized: false, code: "INVALID_AREA_QUERY_PLAN", pharmacies: [] };
  }

  const pharmacyRepository = dependencies.pharmacyReadRepository || createFirestorePharmacyReadRepository();
  const boundedResults = await Promise.all(chunks.map((chunk) => pharmacyRepository.queryByAreaIds(chunk)));
  return {
    authorized: true,
    pharmacies: filterPharmaciesWithinOperationalScope(boundedResults.flat(), scope),
  };
}
