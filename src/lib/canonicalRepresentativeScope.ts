import type { Area, City, District, Physician, Product, UserProductAssignment, UserTerritoryAssignment } from "../types";

const id = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const unique = (values: Iterable<string>): string[] => [...new Set([...values].map(id).filter(Boolean))].sort();
const active = (record: any): boolean => record?.active !== false
  && record?.isActive !== false
  && record?.isDeleted !== true
  && record?.status !== "Inactive"
  && record?.status !== "Archived";

export interface CanonicalGeographyPath {
  countryId: string;
  districtId: string;
  cityId: string;
  areaId: string;
}

export interface CanonicalRepresentativeScope {
  countryIds: string[];
  districtIds: string[];
  cityIds: string[];
  areaIds: string[];
}

export function canonicalPathForArea(
  areaId: string,
  districts: Pick<District, "id" | "countryId">[],
  cities: Pick<City, "id" | "countryId" | "districtId">[],
  areas: Pick<Area, "id" | "countryId" | "districtId" | "cityId" | "active">[],
): CanonicalGeographyPath | null {
  const matches = areas.filter((area) => area.id === id(areaId) && area.active !== false);
  if (matches.length !== 1) return null;
  const area = matches[0];
  const district = districts.find((candidate) => candidate.id === area.districtId);
  const city = cities.find((candidate) => candidate.id === area.cityId);
  if (!district || !city
    || district.countryId !== area.countryId
    || city.countryId !== area.countryId
    || city.districtId !== area.districtId) return null;
  return { countryId: area.countryId, districtId: area.districtId, cityId: area.cityId, areaId: area.id };
}

export function resolveAssignedRepresentativeScope(
  areaIds: string[],
  districts: Pick<District, "id" | "countryId">[],
  cities: Pick<City, "id" | "countryId" | "districtId">[],
  areas: Pick<Area, "id" | "countryId" | "districtId" | "cityId" | "active">[],
): CanonicalRepresentativeScope | null {
  const paths = unique(areaIds).map((areaId) => canonicalPathForArea(areaId, districts, cities, areas));
  if (paths.length === 0 || paths.some((path) => !path)) return null;
  const valid = paths as CanonicalGeographyPath[];
  return {
    countryIds: unique(valid.map((path) => path.countryId)),
    districtIds: unique(valid.map((path) => path.districtId)),
    cityIds: unique(valid.map((path) => path.cityId)),
    areaIds: unique(valid.map((path) => path.areaId)),
  };
}

export function cascadeRepresentativeSelection(
  selectedAreaIds: string[],
  removal: Partial<Pick<CanonicalGeographyPath, "countryId" | "districtId" | "cityId">>,
  districts: Pick<District, "id" | "countryId">[],
  cities: Pick<City, "id" | "countryId" | "districtId">[],
  areas: Pick<Area, "id" | "countryId" | "districtId" | "cityId" | "active">[],
): { retainedAreaIds: string[]; removedAreaIds: string[] } {
  const removedAreaIds = unique(selectedAreaIds).filter((areaId) => {
    const path = canonicalPathForArea(areaId, districts, cities, areas);
    if (!path) return true;
    return Boolean(
      (removal.countryId && path.countryId === removal.countryId)
      || (removal.districtId && path.districtId === removal.districtId)
      || (removal.cityId && path.cityId === removal.cityId),
    );
  });
  const removed = new Set(removedAreaIds);
  return { retainedAreaIds: unique(selectedAreaIds).filter((areaId) => !removed.has(areaId)), removedAreaIds };
}

export function deriveReportingScope(input: Array<{
  userId: string;
  active: boolean;
  managerId?: string;
  scope: CanonicalRepresentativeScope | null;
}>, managerId: string): CanonicalRepresentativeScope | null {
  const scopes = input.filter((item) => item.active && item.managerId === managerId && item.scope).map((item) => item.scope!);
  if (!scopes.length) return null;
  return {
    countryIds: unique(scopes.flatMap((scope) => scope.countryIds)),
    districtIds: unique(scopes.flatMap((scope) => scope.districtIds)),
    cityIds: unique(scopes.flatMap((scope) => scope.cityIds)),
    areaIds: unique(scopes.flatMap((scope) => scope.areaIds)),
  };
}

export function eligibleProductsForPhysician(input: {
  physician: Physician;
  representativeUid: string;
  productAssignments: UserProductAssignment[];
  products: Product[];
}): Product[] {
  const physicianGroups = new Set(unique([
    id(input.physician.primaryPromotionGroupId),
    ...(input.physician.targetPromotionGroupIds || []),
  ]));
  if (!active(input.physician) || physicianGroups.size === 0) return [];
  const assignedProductIds = new Set(input.productAssignments
    .filter((assignment) => assignment.userId === input.representativeUid && active(assignment))
    .map((assignment) => id(assignment.productId))
    .filter(Boolean));
  return input.products.filter((product) => active(product)
    && assignedProductIds.has(id(product.id))
    && physicianGroups.has(id(product.promotionGroupId)));
}

export function isPhysicianEligibleForRepresentative(input: {
  physician: Physician;
  representativeUid: string;
  effectiveAreaIds: string[];
  productAssignments: UserProductAssignment[];
  products: Product[];
}): boolean {
  return active(input.physician)
    && new Set(unique(input.effectiveAreaIds)).has(id(input.physician.areaId))
    && eligibleProductsForPhysician(input).length > 0;
}

export function canonicalTerritoryAssignment(input: {
  userId: string;
  userRole: string;
  areaId: string;
  actorUid: string;
  path: CanonicalGeographyPath;
  now: string;
}): UserTerritoryAssignment {
  if (input.path.areaId !== input.areaId) throw new Error("Canonical area path mismatch");
  return {
    assignmentId: `TA_${input.userId}_${input.areaId}`,
    userId: input.userId,
    userRole: input.userRole,
    countryId: input.path.countryId,
    districtId: input.path.districtId,
    cityId: input.path.cityId,
    territoryId: input.path.areaId,
    territoryName: input.path.areaId,
    assignmentType: input.userRole === "Sales Representative" ? "sales" : input.userRole === "Medical Representative" ? "medical" : "manager",
    effectiveFrom: input.now.slice(0, 10),
    effectiveTo: "9999-12-31",
    status: "Active",
    assignedBy: input.actorUid,
    assignedAt: input.now,
  };
}
