import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { Physician, PhysicianVisit } from "../src/types";
import type { OperationalScopeRepository } from "./operationalScopeRepository";
import type { EffectiveOperationalScope } from "./operationalScopeService";
import {
  filterPhysicianVisitsWithinOperationalScope,
  parsePhysicianVisitReadControls,
  resolveScopedPhysicianVisitRead,
  type PhysicianVisitReadRepository,
} from "./physicianVisitReadService";

const visit = (id: string, repId = "ACTOR", areaId: string | undefined = "A1", physicianId = "PHY1", productId = "P1"): PhysicianVisit => ({
  id, physicianId, physicianName: physicianId, repId, repName: repId, areaId, status: "Completed", visitDate: "2026-08-01", durationSeconds: 60,
  detailing: [{ productId, brandName: productId, reaction: "Positive", notes: "note" }], samples: [{ productId, productName: productId, brand: productId, quantity: 1 }],
  additionalSampleRequests: [], prescriptionIntent: 8, generalNotes: "product note", gpsVerified: true, createdAt: "2026-08-01T00:00:00Z",
});
const legacyVisit = (id: string, repId = "ACTOR", physicianId = "PHY1", productId = "P1"): PhysicianVisit => {
  const record = visit(id, repId, "A1", physicianId, productId);
  delete record.areaId;
  return record;
};

const scope = (overrides: Partial<EffectiveOperationalScope> = {}): EffectiveOperationalScope => ({
  authorized: true, actorUid: "ACTOR", role: "Medical Representative", boundaryKind: "AREA", subjectMode: "SELF", subjectUids: ["ACTOR"],
  countryIds: ["C1"], regionIds: ["R1"], districtIds: ["R1"], cityIds: ["CT1"], areaIds: ["A1"], productIds: ["P1"], productGroupIds: ["PG1"],
  queryPlan: { denyAll: false, areaIdChunks: [["A1"]], subjectUidChunks: [["ACTOR"]], productIdChunks: [["P1"]], requiresPostFilter: true },
  diagnostics: { excludedAssignmentIds: [], malformedAssignmentIds: [], outsideBoundaryAssignmentIds: [] }, ...overrides,
});
const controls = { fromDate: "2026-06-01", toDate: "2026-08-11", pageSize: 50 };

function operationalRepository({ role = "Medical Representative", manager = false, actorActive = true, configuredAreas = ["A1"], assignmentAreas = ["A1"] } = {}): OperationalScopeRepository {
  const actor = { id: "ACTOR", email: "actor@test", role, active: actorActive, loginAllowed: true, status: "Active", securityScope: "Area", areaIds: configuredAreas, country: "C1" };
  const subordinate = { id: "REP1", email: "rep@test", role: "Medical Representative", active: true, managerId: "ACTOR" };
  return {
    hierarchy: { async getUser(uid) { return uid === "ACTOR" ? actor : uid === "REP1" ? subordinate : null; }, async getDirectReports(uid) { return manager && uid === "ACTOR" ? [subordinate] : []; }, async getAllUsers() { return manager ? [actor, subordinate] : [actor]; }, async getRolePermissions() { return null; } },
    async getGeographyCatalog() { return { countries: [{ id: "C1", active: true }], districts: [{ id: "R1", countryId: "C1", active: true }], cities: [{ id: "CT1", districtId: "R1", countryId: "C1", active: true }, { id: "CT2", districtId: "R1", countryId: "C1", active: true }], areas: [{ id: "A1", cityId: "CT1", districtId: "R1", countryId: "C1", active: true }, { id: "A2", cityId: "CT2", districtId: "R1", countryId: "C1", active: true }], nodes: [{ areaId: "A1", cityId: "CT1", districtId: "R1", regionId: "R1", countryId: "C1", active: true }, { areaId: "A2", cityId: "CT2", districtId: "R1", regionId: "R1", countryId: "C1", active: true }] }; },
    async getTerritoryAssignments(subjects) { return assignmentAreas.map((areaId, index) => ({ assignmentId: `TA${index}`, userId: manager ? "REP1" : subjects[0], status: "Active", active: true, countryId: "C1", regionId: "R1", districtId: "R1", cityId: areaId === "A1" ? "CT1" : "CT2", areaId })); },
    async getProductAssignments() { return [{ assignmentId: "PA1", userId: manager ? "REP1" : "ACTOR", productId: "P1", productGroupId: "PG1", effectiveFrom: "2026-01-01", effectiveTo: "2030-01-01", assignedAt: "2026-01-01", assignedBy: "TEST", status: "Active", active: true }]; },
    async getProducts() { return [{ id: "P1", name: "P1", brand: "P1", sku: "P1", therapeuticArea: "TA", price: 1, stock: 1, promotionGroupId: "PG1", isActive: true }]; },
  };
}
const readRepository = (records: PhysicianVisit[]): PhysicianVisitReadRepository => ({ queryBySubjectUids: vi.fn(async () => records) });
const physicianRecord = (id: string, areaId = "A1", productId = "P1", owner = "ACTOR"): Physician => ({ id, name: id, specialty: "GP", classification: "A", territory: areaId, region: "R1", address: "Clinic", areaId, alignedProductIds: [productId], primaryPromotionGroupId: "PG1", assignedRepId: owner });

describe("WP5.2F.5A canonical physician visit-history READ", () => {
  it("preserves canonical and legacy Product-level Prescription Intent values during scoped readback", () => { const record = visit("INTENT"); record.detailing = [{ ...record.detailing[0], prescriptionIntent: "Will Prescribe" }, { ...record.detailing[0], productId: "P1", prescriptionIntent: "High" }]; const result = filterPhysicianVisitsWithinOperationalScope([record], scope(), new Set()); expect(result[0].detailing.map(detail => detail.prescriptionIntent)).toEqual(["Will Prescribe", "High"]); });
  it("1. Medical Representative receives own authorized visit", () => expect(filterPhysicianVisitsWithinOperationalScope([visit("V1")], scope(), new Set()).map(v => v.id)).toEqual(["V1"]));
  it("2. Medical Representative cannot read another representative's visit", () => expect(filterPhysicianVisitsWithinOperationalScope([visit("V1", "OTHER")], scope(), new Set())).toEqual([]));
  it("3. Medical Supervisor receives canonical subordinate visit", async () => { const result = await resolveScopedPhysicianVisitRead("ACTOR", controls, { operationalScopeRepository: operationalRepository({ role: "Medical Supervisor", manager: true }), physicianVisitReadRepository: readRepository([visit("V1", "REP1")]) }); expect(result.visits.map(v => v.id)).toEqual(["V1"]); });
  it("4. non-subordinate visit is excluded", () => expect(filterPhysicianVisitsWithinOperationalScope([visit("V1", "OTHER")], scope({ role: "Medical Supervisor", subjectMode: "HIERARCHY", subjectUids: ["ACTOR", "REP1"] }), new Set())).toEqual([]));
  it("5. canonical area boundary is enforced", () => expect(filterPhysicianVisitsWithinOperationalScope([visit("V1", "ACTOR", "A2")], scope(), new Set())).toEqual([]));
  it("6. canonical multi-area assignments are not narrowed by legacy profile geography", async () => { const repository = readRepository([visit("A1", "ACTOR", "A1"), visit("A2", "ACTOR", "A2")]); const result = await resolveScopedPhysicianVisitRead("ACTOR", controls, { operationalScopeRepository: operationalRepository({ configuredAreas: ["A1"], assignmentAreas: ["A1", "A2"] }), physicianVisitReadRepository: repository }); expect(result.visits.map(v => v.id)).toEqual(["A1", "A2"]); });
  it("7. modern visit with valid areaId is allowed", () => expect(filterPhysicianVisitsWithinOperationalScope([visit("V1")], scope(), new Set())).toHaveLength(1));
  it("8. modern visit outside area is denied", () => expect(filterPhysicianVisitsWithinOperationalScope([visit("V1", "ACTOR", "A2")], scope(), new Set())).toHaveLength(0));
  it("9. legacy missing-area visit requires a physician inside bounded set", async () => { const boundedLookup = vi.fn(async () => [physicianRecord("PHY1")]); const result = await resolveScopedPhysicianVisitRead("ACTOR", controls, { operationalScopeRepository: operationalRepository(), physicianVisitReadRepository: readRepository([legacyVisit("V1")]), legacyPhysicianReadRepository: { queryByAreaIds: boundedLookup } }); expect(result.visits.map(v => v.id)).toEqual(["V1"]); expect(boundedLookup).toHaveBeenCalledWith(["A1"]); });
  it("10. legacy missing-area visit outside bounded physician set is denied", async () => { const boundedLookup = vi.fn(async () => [physicianRecord("PHY1")]); const result = await resolveScopedPhysicianVisitRead("ACTOR", controls, { operationalScopeRepository: operationalRepository(), physicianVisitReadRepository: readRepository([legacyVisit("V1", "ACTOR", "OUT")]), legacyPhysicianReadRepository: { queryByAreaIds: boundedLookup } }); expect(result.visits).toEqual([]); expect(boundedLookup).toHaveBeenCalledWith(["A1"]); });
  it("11. inactive actor is denied before physicianVisits query", async () => { const query = vi.fn(); const result = await resolveScopedPhysicianVisitRead("ACTOR", controls, { operationalScopeRepository: operationalRepository({ actorActive: false }), physicianVisitReadRepository: { queryBySubjectUids: query } }); expect(result).toMatchObject({ authorized: false, code: "ACTOR_INACTIVE", visits: [] }); expect(query).not.toHaveBeenCalled(); });
  it("12. denyAll scope filters every visit", () => expect(filterPhysicianVisitsWithinOperationalScope([visit("V1")], scope({ queryPlan: { ...scope().queryPlan, denyAll: true } }), new Set())).toEqual([]));
  it("13. ambiguous Sales Representative role fails closed", async () => { const query = vi.fn(); const result = await resolveScopedPhysicianVisitRead("ACTOR", controls, { operationalScopeRepository: operationalRepository({ role: "Sales Representative" }), physicianVisitReadRepository: { queryBySubjectUids: query } }); expect(result.code).toBe("PHYSICIAN_VISIT_HISTORY_ROLE_DENIED"); expect(query).not.toHaveBeenCalled(); });
  it("14. Product Manager detailed history fails closed", async () => { const query = vi.fn(); const result = await resolveScopedPhysicianVisitRead("ACTOR", controls, { operationalScopeRepository: operationalRepository({ role: "Product Manager" }), physicianVisitReadRepository: { queryBySubjectUids: query } }); expect(result.code).toBe("PHYSICIAN_VISIT_HISTORY_ROLE_DENIED"); });
  it("15. GLOBAL remains explicitly subject and geography bounded", () => { const global = scope({ role: "Super Admin", boundaryKind: "GLOBAL", subjectMode: "HIERARCHY", subjectUids: ["ADMIN", "REP1"], areaIds: ["A1"] }); expect(filterPhysicianVisitsWithinOperationalScope([visit("IN", "REP1", "A1"), visit("SUBJECT", "OTHER", "A1"), visit("AREA", "REP1", "A2")], global, new Set()).map(v => v.id)).toEqual(["IN"]); });
  it("16. backend contains no unbounded physicianVisits collection scan", () => { const source = fs.readFileSync(new URL("./physicianVisitReadService.ts", import.meta.url), "utf8"); expect(source).toContain('.where("repId", "in", subjects)'); expect(source).not.toMatch(/collection\("physicianVisits"\)\s*\.get\s*\(/); });
  it("17. date range is limited to 90 days", () => { expect(parsePhysicianVisitReadControls({ fromDate: "2026-01-01", toDate: "2026-08-01" })).toBeNull(); expect(parsePhysicianVisitReadControls({ fromDate: "2026-06-01", toDate: "2026-08-01" })).not.toBeNull(); });
  it("18. page-size cap is enforced", () => { expect(parsePhysicianVisitReadControls({ pageSize: 101 })).toBeNull(); expect(parsePhysicianVisitReadControls({ pageSize: 100 })).not.toBeNull(); });
  it("19. ordering is deterministic by date descending then ID", () => { const records = [visit("Z"), { ...visit("B"), visitDate: "2026-08-02" }, visit("A")]; expect(filterPhysicianVisitsWithinOperationalScope(records, scope(), new Set()).map(v => v.id)).toEqual(["B", "A", "Z"]); });
  it("20. duplicate IDs are deduplicated", () => expect(filterPhysicianVisitsWithinOperationalScope([visit("V1"), visit("V1")], scope(), new Set())).toHaveLength(1));
  it("21. malformed visits are excluded safely", () => expect(filterPhysicianVisitsWithinOperationalScope([{ ...visit("V1"), physicianId: "" }], scope(), new Set())).toEqual([]));
  it("22. product scope only redacts and cannot widen geography", () => { const result = filterPhysicianVisitsWithinOperationalScope([visit("OUT", "ACTOR", "A2", "PHY1", "P1")], scope({ productIds: ["P1", "P9"] }), new Set()); expect(result).toEqual([]); });
  it("23. product scope cannot widen subject scope", () => expect(filterPhysicianVisitsWithinOperationalScope([visit("OUT", "OTHER", "A1", "PHY1", "P1")], scope({ productIds: ["P1"] }), new Set())).toEqual([]));
  it("24. endpoint is protected by Firebase authentication", () => { const source = fs.readFileSync(new URL("../server.ts", import.meta.url), "utf8"); expect(source).toContain('app.post("/api/physician-visits/scoped-query", requireFirebaseAuth'); });
});

describe("WP76J Admin physician visit-history authorization", () => {
  it("25. Super Admin remains allowed within resolved subject and geography scope", async () => {
    const result = await resolveScopedPhysicianVisitRead("ACTOR", controls, {
      operationalScopeRepository: operationalRepository({ role: "Super Admin", manager: true }),
      physicianVisitReadRepository: readRepository([visit("TEAM", "REP1"), visit("OUT", "OTHER")]),
    });
    expect(result).toMatchObject({ authorized: true });
    expect(result.visits.map((record) => record.id)).toEqual(["TEAM"]);
  });

  it("26. Admin is allowed within its already-resolved global hierarchy scope", async () => {
    const query = readRepository([visit("TEAM", "REP1"), visit("OUT", "OTHER")]);
    const result = await resolveScopedPhysicianVisitRead("ACTOR", controls, {
      operationalScopeRepository: operationalRepository({ role: "Admin", manager: true }),
      physicianVisitReadRepository: query,
    });
    expect(result).toMatchObject({ authorized: true });
    expect(result.visits.map((record) => record.id)).toEqual(["TEAM"]);
    expect(query.queryBySubjectUids).toHaveBeenCalledWith(["ACTOR", "REP1"], controls.fromDate, controls.toDate);
  });

  it("27. Medical Representative remains restricted to its own UID", async () => {
    const query = readRepository([visit("OWN"), visit("OTHER", "REP1")]);
    const result = await resolveScopedPhysicianVisitRead("ACTOR", controls, {
      operationalScopeRepository: operationalRepository({ role: "Medical Representative" }),
      physicianVisitReadRepository: query,
    });
    expect(result.visits.map((record) => record.id)).toEqual(["OWN"]);
    expect(query.queryBySubjectUids).toHaveBeenCalledWith(["ACTOR"], controls.fromDate, controls.toDate);
  });

  it("28. an unrelated non-approved role remains denied before querying visits", async () => {
    const query = vi.fn();
    const result = await resolveScopedPhysicianVisitRead("ACTOR", controls, {
      operationalScopeRepository: operationalRepository({ role: "Product Manager" }),
      physicianVisitReadRepository: { queryBySubjectUids: query },
    });
    expect(result).toMatchObject({ authorized: false, code: "PHYSICIAN_VISIT_HISTORY_ROLE_DENIED", visits: [] });
    expect(query).not.toHaveBeenCalled();
  });
});
