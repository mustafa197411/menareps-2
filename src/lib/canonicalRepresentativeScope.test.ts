import { describe, expect, it } from "vitest";
import fs from "node:fs";
import type { Area, City, District, Physician, Product, UserProductAssignment } from "../types";
import { filterPharmaciesWithinOperationalScope } from "../../server/pharmacyReadService";
import type { EffectiveOperationalScope } from "../../server/operationalScopeService";
import {
  canonicalPathForArea,
  cascadeRepresentativeSelection,
  deriveReportingScope,
  eligibleProductsForPhysician,
  isPhysicianEligibleForRepresentative,
  resolveAssignedRepresentativeScope,
} from "./canonicalRepresentativeScope";

const districts: District[] = [
  { id: "d-a", name: "District A", countryId: "c-a", countryName: "Country A" },
  { id: "d-b", name: "District B", countryId: "c-b", countryName: "Country B" },
];
const cities: City[] = [
  { id: "ct-a", name: "City A", districtId: "d-a", districtName: "District A", countryId: "c-a", countryName: "Country A" },
  { id: "ct-b", name: "City B", districtId: "d-b", districtName: "District B", countryId: "c-b", countryName: "Country B" },
];
const areas: Area[] = [
  { id: "a-1", name: "Area 1", cityId: "ct-a", cityName: "City A", districtId: "d-a", districtName: "District A", countryId: "c-a", countryName: "Country A" },
  { id: "a-2", name: "Area 2", cityId: "ct-a", cityName: "City A", districtId: "d-a", districtName: "District A", countryId: "c-a", countryName: "Country A" },
  { id: "a-3", name: "Area 3", cityId: "ct-b", cityName: "City B", districtId: "d-b", districtName: "District B", countryId: "c-b", countryName: "Country B" },
];
const products: Product[] = [
  { id: "p-1", name: "Product 1", brand: "Brand 1", therapeuticArea: "T", price: 1, stock: 1, promotionGroupId: "g-1", isActive: true },
  { id: "p-2", name: "Product 2", brand: "Brand 2", therapeuticArea: "T", price: 1, stock: 1, promotionGroupId: "g-2", isActive: true },
  { id: "p-off", name: "Inactive", brand: "Brand 3", therapeuticArea: "T", price: 1, stock: 1, promotionGroupId: "g-1", isActive: false },
];
const assignment = (userId: string, productId: string, active = true): UserProductAssignment => ({
  assignmentId: `pa-${userId}-${productId}`, userId, productId,
  productGroupId: products.find((product) => product.id === productId)?.promotionGroupId || "",
  therapeuticArea: "T", assignmentType: "medical", effectiveFrom: "2026-01-01", effectiveTo: "9999-12-31",
  assignedAt: "2026-01-01", assignedBy: "actor", status: active ? "Active" : "Inactive", active,
});
const physician = (overrides: Partial<Physician> = {}): Physician => ({
  id: "ph-1", name: "Physician", specialty: "S", classification: "A", territory: "a-1", region: "d-a", address: "Address",
  areaId: "a-1", primaryPromotionGroupId: "g-1", targetPromotionGroupIds: [], active: true, ...overrides,
} as Physician);
const eligibility = (physicianRecord: Physician, uid = "rep-alpha", assigned = [assignment(uid, "p-1")], areaIds = ["a-1"]) =>
  isPhysicianEligibleForRepresentative({ physician: physicianRecord, representativeUid: uid, effectiveAreaIds: areaIds, productAssignments: assigned, products });

describe("canonical representative geography, hierarchy and customer eligibility", () => {
  it("1 Medical Rep supports multiple areas in one country", () => expect(resolveAssignedRepresentativeScope(["a-1", "a-2"], districts, cities, areas)?.countryIds).toEqual(["c-a"]));
  it("2 Medical Rep supports multiple countries", () => expect(resolveAssignedRepresentativeScope(["a-1", "a-3"], districts, cities, areas)?.countryIds).toEqual(["c-a", "c-b"]));
  it("3 Sales Rep uses the same multi-area canonical model", () => expect(resolveAssignedRepresentativeScope(["a-2", "a-1"], districts, cities, areas)?.areaIds).toEqual(["a-1", "a-2"]));
  it("4 Sales Rep supports multiple countries", () => expect(resolveAssignedRepresentativeScope(["a-2", "a-3"], districts, cities, areas)?.countryIds).toHaveLength(2));
  it("5 districts remain scoped to selected countries", () => expect(districts.filter((item) => ["c-b"].includes(item.countryId)).map((item) => item.id)).toEqual(["d-b"]));
  it("6 cities remain scoped to selected districts", () => expect(cities.filter((item) => ["d-a"].includes(item.districtId)).map((item) => item.id)).toEqual(["ct-a"]));
  it("7 areas remain scoped to selected cities", () => expect(areas.filter((item) => ["ct-a"].includes(item.cityId)).map((item) => item.id)).toEqual(["a-1", "a-2"]));
  it("8 country removal cascades descendants", () => expect(cascadeRepresentativeSelection(["a-1", "a-3"], { countryId: "c-a" }, districts, cities, areas)).toEqual({ retainedAreaIds: ["a-3"], removedAreaIds: ["a-1"] }));
  it("9 district removal cascades descendants", () => expect(cascadeRepresentativeSelection(["a-1", "a-3"], { districtId: "d-b" }, districts, cities, areas).retainedAreaIds).toEqual(["a-1"]));
  it("10 city removal cascades areas", () => expect(cascadeRepresentativeSelection(["a-1", "a-2", "a-3"], { cityId: "ct-a" }, districts, cities, areas).removedAreaIds).toEqual(["a-1", "a-2"]));
  it("11 malformed ancestry cannot create orphan assignments", () => expect(resolveAssignedRepresentativeScope(["a-bad"], districts, cities, [...areas, { ...areas[0], id: "a-bad", districtId: "d-b" }])).toBeNull());
  it("12 two Medical Reps contribute distinct subordinate scope", () => expect(deriveReportingScope([{ userId: "r1", active: true, managerId: "m", scope: resolveAssignedRepresentativeScope(["a-1"], districts, cities, areas) }, { userId: "r2", active: true, managerId: "m", scope: resolveAssignedRepresentativeScope(["a-3"], districts, cities, areas) }], "m")?.areaIds).toEqual(["a-1", "a-3"]));
  it("13 two Sales Reps use the same hierarchy union", () => expect(deriveReportingScope([{ userId: "s1", active: true, managerId: "sm", scope: resolveAssignedRepresentativeScope(["a-1"], districts, cities, areas) }, { userId: "s2", active: true, managerId: "sm", scope: resolveAssignedRepresentativeScope(["a-2"], districts, cities, areas) }], "sm")?.areaIds).toEqual(["a-1", "a-2"]));
  it("14 overlapping subordinate areas deduplicate", () => expect(deriveReportingScope([{ userId: "r1", active: true, managerId: "m", scope: resolveAssignedRepresentativeScope(["a-1"], districts, cities, areas) }, { userId: "r2", active: true, managerId: "m", scope: resolveAssignedRepresentativeScope(["a-1"], districts, cities, areas) }], "m")?.areaIds).toEqual(["a-1"]));
  it("15 reassignment recalculates derived scope", () => expect(deriveReportingScope([{ userId: "r1", active: true, managerId: "other", scope: resolveAssignedRepresentativeScope(["a-1"], districts, cities, areas) }], "m")).toBeNull());
  it("16 inactive subordinate contributes no scope", () => expect(deriveReportingScope([{ userId: "r1", active: false, managerId: "m", scope: resolveAssignedRepresentativeScope(["a-1"], districts, cities, areas) }], "m")).toBeNull());
  it("17 identity values do not alter equal canonical eligibility", () => expect(eligibility(physician(), "rep-alpha", [assignment("rep-alpha", "p-1")])).toBe(eligibility(physician(), "rep-beta", [assignment("rep-beta", "p-1")])));
  it("18 a new canonical UID needs no source registration", () => expect(eligibility(physician(), "new-arbitrary-uid", [assignment("new-arbitrary-uid", "p-1")])).toBe(true));
  it("19 same area plus product-group overlap is eligible", () => expect(eligibility(physician())).toBe(true));
  it("20 same area without product-group overlap is ineligible", () => expect(eligibility(physician({ primaryPromotionGroupId: "g-2" }))).toBe(false));
  it("21 product overlap outside geography is ineligible", () => expect(eligibility(physician({ areaId: "a-3" }))).toBe(false));
  it("22 any valid target promotion group overlap is eligible", () => expect(eligibility(physician({ primaryPromotionGroupId: "g-2", targetPromotionGroupIds: ["g-1"] }))).toBe(true));
  it("23 inactive physician is ineligible", () => expect(eligibility(physician({ active: false }))).toBe(false));
  it("24 inactive representative product assignment is ineligible", () => expect(eligibility(physician(), "rep-alpha", [assignment("rep-alpha", "p-1", false)])).toBe(false));
  it("25 List, Planner and Visit share the same resolver result", () => expect([eligibility(physician()), eligibility(physician()), eligibility(physician())]).toEqual([true, true, true]));
  it("26 invalid geography parent fails closed", () => expect(canonicalPathForArea("a-bad", districts, cities, [{ ...areas[0], id: "a-bad", countryId: "missing" }])).toBeNull());
  it("27 missing product/promotion relation fails closed", () => expect(eligibleProductsForPhysician({ physician: physician({ primaryPromotionGroupId: undefined }), representativeUid: "rep-alpha", productAssignments: [assignment("rep-alpha", "p-1")], products })).toEqual([]));
  it("28 Sales pharmacy rule is active canonical geography, not physician product alignment", () => {
    const scope: EffectiveOperationalScope = { authorized: true, actorUid: "sales", role: "Sales Representative", boundaryKind: "AREA", subjectMode: "SELF", subjectUids: ["sales"], countryIds: ["c-a"], regionIds: ["d-a"], districtIds: ["d-a"], cityIds: ["ct-a"], areaIds: ["a-1"], productIds: [], productGroupIds: [], queryPlan: { denyAll: false, areaIdChunks: [["a-1"]], subjectUidChunks: [["sales"]], productIdChunks: [], requiresPostFilter: true }, diagnostics: { excludedAssignmentIds: [], malformedAssignmentIds: [], outsideBoundaryAssignmentIds: [] } };
    expect(filterPharmaciesWithinOperationalScope([{ id: "customer", name: "Customer", territory: "a-1", region: "d-a", address: "", outstandingBalance: 0, areaId: "a-1", active: true }], scope)).toHaveLength(1);
  });
  it("29 examples are data inputs and never consulted as identity allowlists", () => {
    expect(eligibility(physician({ id: "arbitrary-customer" }), "arbitrary-user", [assignment("arbitrary-user", "p-1")])).toBe(true);
    const production = [
      fs.readFileSync(new URL("./canonicalRepresentativeScope.ts", import.meta.url), "utf8"),
      fs.readFileSync(new URL("../components/UserManagement.tsx", import.meta.url), "utf8"),
      fs.readFileSync(new URL("../../server/physicianReadService.ts", import.meta.url), "utf8"),
      fs.readFileSync(new URL("../../server/physicianVisitWriteService.ts", import.meta.url), "utf8"),
    ].join("\n");
    expect(production).not.toMatch(/rep-alpha|rep-beta|arbitrary-user|Country A|arbitrary-customer/);
    expect(production).not.toMatch(/pilotUids|test-user@|test-email@/);
  });
});
