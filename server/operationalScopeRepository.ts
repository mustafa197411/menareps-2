import type { Product, UserProductAssignment } from "../src/types";
import { resolveMarket, type MarketBusinessSettings } from "../src/lib/marketSettings";
import type { ActorMarketContext } from "../src/lib/operationalScopeClient";
import type { Firestore } from "firebase-admin/firestore";

/** Record acquisition only; market selection remains in the canonical resolver. */
export async function readActorMarketContext(actor: Record<string, unknown>, db: Firestore = getFirebaseAdminServices().db): Promise<ActorMarketContext> {
  const exact = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value === value.trim() && !value.includes("/");
  const marketId = actor.marketId, countryId = actor.countryId;
  if (marketId !== undefined && !exact(marketId)) return { status: "UNRESOLVED" };
  if (marketId === undefined && !exact(countryId)) return { status: "UNRESOLVED" };
  try {
    const snapshots = exact(marketId)
      ? [await db.collection("marketSettings").doc(marketId).get()].filter(doc => doc.exists)
      : (await db.collection("marketSettings").where("countryId", "==", countryId).where("active", "==", true).limit(2).get()).docs;
    if (snapshots.some(doc => doc.data()?.marketId !== undefined && doc.data()?.marketId !== doc.id)) return { status: "UNRESOLVED" };
    const records = snapshots.map(doc => ({ ...doc.data(), marketId: doc.id } as MarketBusinessSettings));
    const market = resolveMarket(records, exact(marketId) ? { marketId } : { countryId: countryId as string });
    return market ? { status: "RESOLVED", market } : { status: "UNRESOLVED" };
  } catch { return { status: "UNRESOLVED" }; }
}
import { getActiveCanonicalAssignmentsForUser } from "../src/lib/productAssignmentService";
import { getFirebaseAdminServices } from "./firebaseAdmin";
import {
  createFirestoreOrganizationalHierarchyRepository,
} from "./organizationalHierarchyRepository";
import {
  resolveOrganizationalScope,
  type OrganizationalHierarchyRepository,
} from "./organizationalHierarchyService";
import {
  resolveOperationalScope,
  type CanonicalGeographyNode,
  type ConfiguredGeographyBoundary,
  type EffectiveOperationalScope,
  type OperationalActor,
  type OperationalProductAssignment,
  type OperationalTerritoryAssignment,
} from "./operationalScopeService";

interface GeographyRecord {
  id: string;
  name?: string;
  code?: string;
  countryId?: string;
  districtId?: string;
  cityId?: string;
  active?: boolean;
  status?: string;
}

interface OperationalGeographyCatalog {
  countries: GeographyRecord[];
  districts: GeographyRecord[];
  cities: GeographyRecord[];
  areas: GeographyRecord[];
  nodes: CanonicalGeographyNode[];
}

export interface OperationalScopeRepository {
  hierarchy: OrganizationalHierarchyRepository;
  getGeographyCatalog(): Promise<OperationalGeographyCatalog>;
  getTerritoryAssignments(subjectUids: string[]): Promise<OperationalTerritoryAssignment[]>;
  getProductAssignments(subjectUids: string[]): Promise<UserProductAssignment[]>;
  getProducts(): Promise<Product[]>;
}

export interface BackendOperationalScopeRequest {
  actorUid?: string;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function sortedUnique(values: string[]): string[] {
  return Array.from(new Set(values.map(text).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function documents(snapshot: any): GeographyRecord[] {
  return snapshot.docs.map((document: any) => ({ ...document.data(), id: document.id }));
}

async function queryAssignmentsForSubjects(
  collectionName: "userTerritoryAssignments" | "userProductAssignments",
  subjectUids: string[],
): Promise<any[]> {
  const db = getFirebaseAdminServices().db;
  const results: any[] = [];
  for (const uid of sortedUnique(subjectUids)) {
    const snapshot = await db.collection(collectionName).where("userId", "==", uid).get();
    snapshot.docs.forEach((document: any) => results.push({ ...document.data(), id: document.id }));
  }
  return results;
}

export function createFirestoreOperationalScopeRepository(): OperationalScopeRepository {
  const db = getFirebaseAdminServices().db;
  return {
    hierarchy: createFirestoreOrganizationalHierarchyRepository(),
    async getGeographyCatalog() {
      const [countriesSnapshot, districtsSnapshot, citiesSnapshot, areasSnapshot] = await Promise.all([
        db.collection("countries").get(),
        db.collection("districts").get(),
        db.collection("cities").get(),
        db.collection("areas").get(),
      ]);
      const countries = documents(countriesSnapshot);
      const districts = documents(districtsSnapshot);
      const cities = documents(citiesSnapshot);
      const areas = documents(areasSnapshot);
      const countryIds = new Set(countries.map((country) => country.id));
      const districtById = new Map(districts.map((district) => [district.id, district]));
      const cityById = new Map(cities.map((city) => [city.id, city]));
      const nodes = areas.map((area): CanonicalGeographyNode => {
        const district = districtById.get(text(area.districtId));
        const city = cityById.get(text(area.cityId));
        const ancestryValid = Boolean(
          countryIds.has(text(area.countryId))
          && district
          && city
          && text(district.countryId) === text(area.countryId)
          && text(city.countryId) === text(area.countryId)
          && text(city.districtId) === text(area.districtId),
        );
        return {
          countryId: text(area.countryId),
          regionId: text(area.districtId),
          districtId: text(area.districtId),
          cityId: text(area.cityId),
          areaId: area.id,
          active: ancestryValid && area.active !== false && area.status !== "Inactive",
        };
      });
      return { countries, districts, cities, areas, nodes };
    },
    async getTerritoryAssignments(subjectUids) {
      return queryAssignmentsForSubjects("userTerritoryAssignments", subjectUids) as Promise<OperationalTerritoryAssignment[]>;
    },
    async getProductAssignments(subjectUids) {
      return queryAssignmentsForSubjects("userProductAssignments", subjectUids) as Promise<UserProductAssignment[]>;
    },
    async getProducts() {
      const snapshot = await db.collection("products").get();
      return snapshot.docs.map((document: any) => ({ ...document.data(), id: document.id } as Product));
    },
  };
}

export async function resolveOperationalScopeForActor(
  authenticatedActorUid: string,
  request: BackendOperationalScopeRequest,
  repository: OperationalScopeRepository,
): Promise<EffectiveOperationalScope> {
  const hierarchyResult = await resolveOrganizationalScope(
    authenticatedActorUid,
    {
      actorUid: request.actorUid,
      includeSelf: true,
    },
    repository.hierarchy,
  );
  const policy = hierarchyResult.scopePolicy;
  const hierarchyUids = hierarchyResult.allHierarchyUids;
  const sourceUids = (source: typeof policy.geographySource): string[] => {
    if (source === "SELF") return [authenticatedActorUid];
    if (source === "DESCENDANTS") return hierarchyResult.descendantUids;
    if (source === "ORGANIZATION") return hierarchyUids;
    return [];
  };
  const geographySubjectUids = sourceUids(policy.geographySource);
  const productSubjectUids = sourceUids(policy.productSource);
  const subjectUids = policy.subjectMode === "HIERARCHY" || policy.subjectMode === "ORGANIZATION"
    ? hierarchyUids
    : [authenticatedActorUid];
  const authorizedRepresentativeUids = hierarchyResult.allHierarchyUsers
    .filter((user) => text(user.role) === "Medical Representative")
    .map((user) => user.id);
  const catalog = await repository.getGeographyCatalog();
  const [territoryAssignments, rawProductAssignments, products] = await Promise.all([
    repository.getTerritoryAssignments(geographySubjectUids),
    repository.getProductAssignments(productSubjectUids),
    repository.getProducts(),
  ]);
  const geographySubjects = new Set(geographySubjectUids);
  const configuredBoundary: ConfiguredGeographyBoundary | undefined = geographySubjectUids.length > 0
    ? {
        kind: "GLOBAL",
        countryIds: sortedUnique(territoryAssignments
          .filter((assignment) => geographySubjects.has(text(assignment.userId))
            && assignment.active !== false && assignment.status === "Active")
          .map((assignment) => text(assignment.countryId))),
        regionIds: [],
        areaIds: [],
      }
    : undefined;

  const canonicalProductAssignments: OperationalProductAssignment[] = [];
  for (const subjectUid of sortedUnique(productSubjectUids)) {
    const report = getActiveCanonicalAssignmentsForUser({
      assignments: rawProductAssignments,
      userId: subjectUid,
      products,
    });
    report.assignments.forEach((assignment) => canonicalProductAssignments.push({
      assignmentId: assignment.assignmentId,
      userId: assignment.userId,
      productId: assignment.productId,
      productGroupId: assignment.productGroupId,
      status: assignment.status,
      active: assignment.active,
      effectiveFrom: assignment.effectiveFrom,
      effectiveTo: assignment.effectiveTo,
    }));
  }

  const operationalActor: OperationalActor = {
    ...hierarchyResult.actor,
    id: hierarchyResult.actor.id,
    role: hierarchyResult.actor.role,
    configuredBoundary,
  };
  return resolveOperationalScope({
    authenticatedActorUid,
    requestedActorUid: request.actorUid,
    actor: operationalActor,
    now: new Date().toISOString(),
    geographyRegistry: catalog.nodes,
    territoryAssignments,
    productAssignments: canonicalProductAssignments,
    hierarchy: {
      mode: policy.subjectMode,
      actorUid: authenticatedActorUid,
      directReportUids: hierarchyResult.directReportUids,
      descendantUids: hierarchyResult.descendantUids,
      allowedSubjectUids: subjectUids,
      authorizedRepresentativeUids,
      productScopeRequired: policy.productScopeRequired,
    },
  });
}
