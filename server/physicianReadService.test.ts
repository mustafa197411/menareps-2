import { describe, expect, it, vi } from "vitest";
import type { Physician } from "../src/types";
import type { OperationalScopeRepository } from "./operationalScopeRepository";
import type { EffectiveOperationalScope } from "./operationalScopeService";
import {
  filterPhysiciansWithinOperationalScope,
  isValidScopedPhysicianReadRequest,
  resolveScopedPhysicianRead,
  type PhysicianReadRepository,
} from "./physicianReadService";

const physician = (id: string, areaId: string, products = ["P1"], owner = "REP1"): Physician => ({
  id,
  name: id,
  specialty: "GP",
  classification: "A",
  territory: areaId,
  region: "R1",
  address: "Clinic",
  areaId,
  alignedProductIds: products,
  primaryPromotionGroupId: products.includes("P1") ? "PG1" : "PG2",
  assignedRepId: owner,
});

const scope = (overrides: Partial<EffectiveOperationalScope> = {}): EffectiveOperationalScope => ({
  authorized: true,
  actorUid: "REP1",
  role: "Medical Representative",
  boundaryKind: "AREA",
  subjectMode: "SELF",
  subjectUids: ["REP1"],
  countryIds: ["C1"],
  regionIds: ["R1"],
  districtIds: ["R1"],
  cityIds: ["CT1"],
  areaIds: ["A1"],
  productIds: ["P1"],
  productGroupIds: ["PG1"],
  queryPlan: {
    denyAll: false,
    areaIdChunks: [["A1"]],
    subjectUidChunks: [["REP1"]],
    productIdChunks: [["P1"]],
    requiresPostFilter: true,
  },
  diagnostics: { excludedAssignmentIds: [], malformedAssignmentIds: [], outsideBoundaryAssignmentIds: [] },
  ...overrides,
});

function operationalRepository({
  role = "Medical Representative",
  configuredAreas = ["A1"],
  assignmentAreas = ["A1"],
  actorActive = true,
  manager = false,
}: {
  role?: string;
  configuredAreas?: string[];
  assignmentAreas?: string[];
  actorActive?: boolean;
  manager?: boolean;
} = {}): OperationalScopeRepository {
  const actor = {
    id: "ACTOR",
    email: "actor@example.com",
    role,
    active: actorActive,
    loginAllowed: true,
    status: "Active",
    securityScope: "Area",
    areaIds: configuredAreas,
    country: "C1",
  };
  const subordinate = { id: "REP1", email: "rep@example.com", role: "Medical Representative", active: true, managerId: "ACTOR" };
  const subjects = manager ? [actor, subordinate] : [actor];
  return {
    hierarchy: {
      async getUser(uid) { return uid === "ACTOR" ? actor : uid === "REP1" ? subordinate : null; },
      async getDirectReports(uid) { return manager && uid === "ACTOR" ? [subordinate] : []; },
      async getAllUsers() { return subjects; },
      async getRolePermissions() { return null; },
    },
    async getGeographyCatalog() {
      return {
        countries: [{ id: "C1", active: true }],
        districts: [{ id: "R1", countryId: "C1", active: true }],
        cities: [{ id: "CT1", districtId: "R1", countryId: "C1", active: true }, { id: "CT2", districtId: "R1", countryId: "C1", active: true }],
        areas: [{ id: "A1", cityId: "CT1", districtId: "R1", countryId: "C1", active: true }, { id: "A2", cityId: "CT2", districtId: "R1", countryId: "C1", active: true }],
        nodes: [{ areaId: "A1", cityId: "CT1", districtId: "R1", regionId: "R1", countryId: "C1", active: true }, { areaId: "A2", cityId: "CT2", districtId: "R1", regionId: "R1", countryId: "C1", active: true }],
      };
    },
    async getTerritoryAssignments(subjectUids) {
      return assignmentAreas.map((areaId, index) => ({
        assignmentId: `TA${index}`,
        userId: manager ? "REP1" : subjectUids[0],
        status: "Active",
        active: true,
        countryId: "C1",
        regionId: "R1",
        districtId: "R1",
        cityId: areaId === "A1" ? "CT1" : "CT2",
        areaId,
      }));
    },
    async getProductAssignments() {
      return [{ assignmentId: "PA1", userId: manager ? "REP1" : "ACTOR", productId: "P1", productGroupId: "PG1", therapeuticArea: "TA1", assignmentType: "medical", effectiveFrom: "2026-01-01", effectiveTo: "2030-01-01", assignedAt: "2026-01-01", assignedBy: "TEST", status: "Active", active: true }];
    },
    async getProducts() { return [{ id: "P1", name: "Product", brand: "Brand", sku: "P1", therapeuticArea: "TA1", price: 1, stock: 1, promotionGroupId: "PG1", isActive: true }]; },
  };
}

describe("WP5.2F.3 canonical physician READ", () => {
  it("1. authorized representative receives only canonical-area physicians", () => {
    expect(filterPhysiciansWithinOperationalScope([physician("IN", "A1"), physician("OUT", "A2")], scope()).map((p) => p.id)).toEqual(["IN"]);
  });

  it("2. representative product restrictions remain enforced", () => {
    expect(filterPhysiciansWithinOperationalScope([physician("P1", "A1"), physician("P2", "A1", ["P2"])], scope()).map((p) => p.id)).toEqual(["P1"]);
  });

  it("3. manager receives physicians inside canonical managerial boundary", async () => {
    const read: PhysicianReadRepository = { queryByAreaIds: vi.fn(async () => [physician("TEAM", "A1", ["P1"], "REP1")]) };
    const result = await resolveScopedPhysicianRead("ACTOR", { operationalScopeRepository: operationalRepository({ role: "Medical Manager", manager: true }), physicianReadRepository: read });
    expect(result.physicians.map((p) => p.id)).toEqual(["TEAM"]);
  });

  it("4. Sales & Marketing Manager READ uses canonical team products, not personal assignments", async () => {
    const read: PhysicianReadRepository = { queryByAreaIds: vi.fn(async () => [physician("TEAM", "A1", ["P1"], "REP1")]) };
    const result = await resolveScopedPhysicianRead("ACTOR", { operationalScopeRepository: operationalRepository({ role: "Sales & Marketing Manager", manager: true }), physicianReadRepository: read });
    expect(result).toMatchObject({ authorized: true, physicians: [{ id: "TEAM" }] });
  });

  it("5. legacy profile geography cannot narrow valid canonical multi-area assignments", async () => {
    const queryByAreaIds = vi.fn(async () => [physician("A1", "A1")]);
    await resolveScopedPhysicianRead("ACTOR", { operationalScopeRepository: operationalRepository({ configuredAreas: ["A1"], assignmentAreas: ["A1", "A2"] }), physicianReadRepository: { queryByAreaIds } });
    expect(queryByAreaIds).toHaveBeenCalledWith(["A1", "A2"]);
  });

  it("6. physician outside canonical geography is excluded after bounded retrieval", () => {
    expect(filterPhysiciansWithinOperationalScope([physician("OUT", "A2")], scope())).toEqual([]);
  });

  it("7. physician outside applicable product scope is excluded", () => {
    expect(filterPhysiciansWithinOperationalScope([physician("OUT", "A1", ["P9"])], scope())).toEqual([]);
  });

  it("8. duplicate chunk results are deduplicated", () => {
    expect(filterPhysiciansWithinOperationalScope([physician("ONE", "A1"), physician("ONE", "A1")], scope())).toHaveLength(1);
  });

  it("9. output ordering is deterministic", () => {
    expect(filterPhysiciansWithinOperationalScope([physician("Z", "A1"), physician("A", "A1")], scope()).map((p) => p.id)).toEqual(["A", "Z"]);
  });

  it("10. DENIED scope returns no records", async () => {
    const result = await resolveScopedPhysicianRead("ACTOR", { operationalScopeRepository: operationalRepository({ configuredAreas: [], assignmentAreas: [] }), physicianReadRepository: { queryByAreaIds: vi.fn() } });
    expect(result).toMatchObject({ authorized: false, physicians: [] });
  });

  it("11. denyAll scope returns no filtered records", () => {
    expect(filterPhysiciansWithinOperationalScope([physician("ONE", "A1")], scope({ queryPlan: { ...scope().queryPlan, denyAll: true } }))).toEqual([]);
  });

  it("12. inactive actor is denied before any physician query", async () => {
    const queryByAreaIds = vi.fn();
    const result = await resolveScopedPhysicianRead("ACTOR", { operationalScopeRepository: operationalRepository({ actorActive: false }), physicianReadRepository: { queryByAreaIds } });
    expect(result).toEqual({ authorized: false, code: "ACTOR_INACTIVE", physicians: [] });
    expect(queryByAreaIds).not.toHaveBeenCalled();
  });

  it("13. malformed request/query plan fail closed while unexpected errors propagate", async () => {
    expect(isValidScopedPhysicianReadRequest({ actorUid: "ATTACKER", areaIds: ["A2"] })).toBe(false);
    expect(filterPhysiciansWithinOperationalScope([physician("ONE", "A1")], scope({ areaIds: [], queryPlan: { ...scope().queryPlan, areaIdChunks: [] } }))).toEqual([]);
    const repository = operationalRepository();
    repository.hierarchy.getUser = async () => { throw new Error("UNEXPECTED_REPOSITORY_FAILURE"); };
    await expect(resolveScopedPhysicianRead("ACTOR", {
      operationalScopeRepository: repository,
      physicianReadRepository: { queryByAreaIds: vi.fn() },
    })).rejects.toThrow("UNEXPECTED_REPOSITORY_FAILURE");
  });
  it("14. exposes only saved today's Planner physicians to Today's Planned Visits", async () => {
    const read: PhysicianReadRepository = {
      queryByAreaIds: vi.fn(async () => [physician("TODAY", "A1"), physician("DRAFT", "A1"), physician("OTHER", "A1")]),
      queryPlannerVisitsByRep: vi.fn(async () => [
        { physicianId: "TODAY", date: "2026-08-25", planStatus: "SAVED" },
        { physicianId: "DRAFT", date: "2026-08-25", planStatus: "DRAFT" },
        { physicianId: "OTHER", date: "2026-08-24", planStatus: "SAVED" },
      ]),
    };
    const result = await resolveScopedPhysicianRead("ACTOR", { operationalScopeRepository: operationalRepository(), physicianReadRepository: read, today: () => "2026-08-25" });
    expect(result.physicians.find(item => item.id === "TODAY")?.plannedVisitDate).toBe("2026-08-25");
    expect(result.physicians.find(item => item.id === "DRAFT")?.plannedVisitDate).toBeUndefined();
    expect(result.physicians.find(item => item.id === "OTHER")?.plannedVisitDate).toBeUndefined();
  });
});
