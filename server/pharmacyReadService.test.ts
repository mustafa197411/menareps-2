import { describe, expect, it, vi } from "vitest";
import type { Pharmacy } from "../src/types";
import type { OperationalScopeRepository } from "./operationalScopeRepository";
import type { EffectiveOperationalScope } from "./operationalScopeService";
import {
  canRoleReadPharmacyDirectory,
  filterPharmaciesWithinOperationalScope,
  isValidScopedPharmacyReadRequest,
  resolveScopedPharmacyRead,
  type PharmacyReadRepository,
} from "./pharmacyReadService";

const pharmacy = (id: string, areaId: string, owner = "REP1"): Pharmacy => ({
  id, name: id, territory: areaId, region: "R1", address: "Street", outstandingBalance: 0,
  areaId, assignedRepId: owner, active: true, status: "Active",
});

const scope = (overrides: Partial<EffectiveOperationalScope> = {}): EffectiveOperationalScope => ({
  authorized: true, actorUid: "REP1", role: "Sales Representative", boundaryKind: "AREA", subjectMode: "SELF",
  subjectUids: ["REP1"], countryIds: ["C1"], regionIds: ["R1"], districtIds: ["R1"], cityIds: ["CT1"], areaIds: ["A1"],
  productIds: ["P1"], productGroupIds: [],
  queryPlan: { denyAll: false, areaIdChunks: [["A1"]], subjectUidChunks: [["REP1"]], productIdChunks: [["P1"]], requiresPostFilter: true },
  diagnostics: { excludedAssignmentIds: [], malformedAssignmentIds: [], outsideBoundaryAssignmentIds: [] },
  ...overrides,
});

function operationalRepository({
  role = "Sales Representative", configuredAreas = ["A1"], assignmentAreas = ["A1"], actorActive = true, manager = false,
}: { role?: string; configuredAreas?: string[]; assignmentAreas?: string[]; actorActive?: boolean; manager?: boolean } = {}): OperationalScopeRepository {
  const actor = { id: "ACTOR", email: "actor@example.com", role, active: actorActive, loginAllowed: true, status: "Active", securityScope: "Area", areaIds: configuredAreas, country: "C1" };
  const subordinate = { id: "REP1", email: "rep@example.com", role: role.includes("Medical") ? "Medical Representative" : "Sales Representative", active: true, managerId: "ACTOR" };
  const subjects = manager ? [actor, subordinate] : [actor];
  return {
    hierarchy: {
      async getUser(uid) { return uid === "ACTOR" ? actor : uid === "REP1" ? subordinate : null; },
      async getDirectReports(uid) { return manager && uid === "ACTOR" ? [subordinate] : []; },
      async getAllUsers() { return subjects; }, async getRolePermissions() { return null; },
    },
    async getGeographyCatalog() {
      return {
        countries: [{ id: "C1", active: true }], districts: [{ id: "R1", countryId: "C1", active: true }],
        cities: [{ id: "CT1", districtId: "R1", countryId: "C1", active: true }, { id: "CT2", districtId: "R1", countryId: "C1", active: true }],
        areas: [{ id: "A1", cityId: "CT1", districtId: "R1", countryId: "C1", active: true }, { id: "A2", cityId: "CT2", districtId: "R1", countryId: "C1", active: true }],
        nodes: [{ areaId: "A1", cityId: "CT1", districtId: "R1", regionId: "R1", countryId: "C1", active: true }, { areaId: "A2", cityId: "CT2", districtId: "R1", regionId: "R1", countryId: "C1", active: true }],
      };
    },
    async getTerritoryAssignments(subjectUids) {
      return assignmentAreas.map((areaId, index) => ({ assignmentId: `TA${index}`, userId: manager ? "REP1" : subjectUids[0], status: "Active", active: true, countryId: "C1", regionId: "R1", districtId: "R1", cityId: areaId === "A1" ? "CT1" : "CT2", areaId }));
    },
    async getProductAssignments() { return [{ assignmentId: "PA1", userId: manager ? "REP1" : "ACTOR", productId: "P1", effectiveFrom: "2026-01-01", effectiveTo: "2030-01-01", assignedAt: "2026-01-01", assignedBy: "TEST", status: "Active", active: true }]; },
    async getProducts() { return [{ id: "P1", name: "Product", brand: "Brand", sku: "P1", therapeuticArea: "TA1", price: 1, stock: 1, isActive: true }]; },
  };
}

describe("WP5.2F.4 canonical pharmacy READ", () => {
  it("1. Sales Representative reads every active pharmacy in canonical area regardless of assignedRepId", () => {
    expect(filterPharmaciesWithinOperationalScope([pharmacy("IN", "A1"), pharmacy("AREA-OUT", "A2"), pharmacy("OWNER-OUT", "A1", "REP2")], scope()).map((item) => item.id)).toEqual(["IN", "OWNER-OUT"]);
  });
  it("2. pharmacy outside canonical geography is excluded", () => expect(filterPharmaciesWithinOperationalScope([pharmacy("OUT", "A2")], scope())).toEqual([]));
  it("3. manager receives pharmacies inside canonical managerial boundary", async () => {
    const read: PharmacyReadRepository = { queryByAreaIds: vi.fn(async () => [pharmacy("TEAM", "A1", "REP1")]) };
    const result = await resolveScopedPharmacyRead("ACTOR", { operationalScopeRepository: operationalRepository({ role: "Sales Manager", manager: true }), pharmacyReadRepository: read });
    expect(result.pharmacies.map((item) => item.id)).toEqual(["TEAM"]);
  });
  it("4. Sales & Marketing Manager READ remains bounded without a role exception", async () => {
    const queryByAreaIds = vi.fn(async () => [pharmacy("IN", "A1", "REP1"), pharmacy("OUT", "A2", "REP1")]);
    const result = await resolveScopedPharmacyRead("ACTOR", { operationalScopeRepository: operationalRepository({ role: "Sales & Marketing Manager", manager: true }), pharmacyReadRepository: { queryByAreaIds } });
    expect(result.pharmacies.map((item) => item.id)).toEqual(["IN"]);
    expect(queryByAreaIds).toHaveBeenCalledWith(["A1"]);
  });
  it("5. GLOBAL scope still uses explicit bounded canonical geography", async () => {
    const queryByAreaIds = vi.fn(async () => [pharmacy("IN", "A1", "REP1")]);
    const result = await resolveScopedPharmacyRead("ACTOR", { operationalScopeRepository: operationalRepository({ role: "Super Admin", manager: true }), pharmacyReadRepository: { queryByAreaIds } });
    expect(result.authorized).toBe(true);
    expect(queryByAreaIds).toHaveBeenCalledWith(["A1"]);
  });
  it("6. legacy profile geography cannot narrow valid canonical multi-area assignments", async () => {
    const queryByAreaIds = vi.fn(async () => [pharmacy("A1", "A1", "ACTOR")]);
    await resolveScopedPharmacyRead("ACTOR", { operationalScopeRepository: operationalRepository({ configuredAreas: ["A1"], assignmentAreas: ["A1", "A2"] }), pharmacyReadRepository: { queryByAreaIds } });
    expect(queryByAreaIds).toHaveBeenCalledWith(["A1", "A2"]);
  });
  it("7. empty geography fails closed before querying", async () => {
    const queryByAreaIds = vi.fn();
    const result = await resolveScopedPharmacyRead("ACTOR", { operationalScopeRepository: operationalRepository({ configuredAreas: [], assignmentAreas: [] }), pharmacyReadRepository: { queryByAreaIds } });
    expect(result).toMatchObject({ authorized: false, pharmacies: [] }); expect(queryByAreaIds).not.toHaveBeenCalled();
  });
  it("8. denyAll returns no records", () => expect(filterPharmaciesWithinOperationalScope([pharmacy("ONE", "A1")], scope({ queryPlan: { ...scope().queryPlan, denyAll: true } }))).toEqual([]));
  it("9. inactive actor is denied before any pharmacy query", async () => {
    const queryByAreaIds = vi.fn();
    const result = await resolveScopedPharmacyRead("ACTOR", { operationalScopeRepository: operationalRepository({ actorActive: false }), pharmacyReadRepository: { queryByAreaIds } });
    expect(result).toEqual({ authorized: false, code: "ACTOR_INACTIVE", pharmacies: [] }); expect(queryByAreaIds).not.toHaveBeenCalled();
  });
  it("10. medical feature-policy denial returns a typed empty response", async () => {
    const queryByAreaIds = vi.fn();
    const result = await resolveScopedPharmacyRead("ACTOR", { operationalScopeRepository: operationalRepository({ role: "Medical Manager", manager: true }), pharmacyReadRepository: { queryByAreaIds } });
    expect(result).toEqual({ authorized: false, code: "PHARMACY_DIRECTORY_ACCESS_DENIED", pharmacies: [] });
    expect(canRoleReadPharmacyDirectory("ACTOR", "Medical Representative")).toBe(false); expect(queryByAreaIds).not.toHaveBeenCalled();
  });
  it("11. unexpected runtime/repository errors propagate", async () => {
    const repository = operationalRepository(); repository.hierarchy.getUser = async () => { throw new Error("UNEXPECTED_REPOSITORY_FAILURE"); };
    await expect(resolveScopedPharmacyRead("ACTOR", { operationalScopeRepository: repository, pharmacyReadRepository: { queryByAreaIds: vi.fn() } })).rejects.toThrow("UNEXPECTED_REPOSITORY_FAILURE");
  });
  it("12. duplicate results deduplicate deterministically", () => expect(filterPharmaciesWithinOperationalScope([pharmacy("Z", "A1"), pharmacy("A", "A1"), pharmacy("Z", "A1")], scope()).map((item) => item.id)).toEqual(["A", "Z"]));
  it("13. malformed authority-bearing requests are rejected", () => expect(isValidScopedPharmacyReadRequest({ actorUid: "ATTACKER", areaIds: ["A2"] })).toBe(false));
  it("14. known hierarchy authorization denials normalize without querying", async () => {
    const queryByAreaIds = vi.fn();
    const result = await resolveScopedPharmacyRead("ACTOR", { operationalScopeRepository: operationalRepository({ actorActive: false }), pharmacyReadRepository: { queryByAreaIds } });
    expect(result.code).toBe("ACTOR_INACTIVE"); expect(queryByAreaIds).not.toHaveBeenCalled();
  });
  it("15. Medical Supervisor receives read-only pharmacy context for supervisor visits", () => {
    expect(canRoleReadPharmacyDirectory("ACTOR", "Medical Supervisor")).toBe(true);
  });
});
