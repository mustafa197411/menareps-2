import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { Pharmacy, PharmacyVisit } from "../src/types";
import type { OperationalScopeRepository } from "./operationalScopeRepository";
import type { EffectiveOperationalScope } from "./operationalScopeService";
import {
  filterPharmacyVisitsWithinOperationalScope,
  parsePharmacyVisitReadControls,
  redactPharmacyVisitCommercialFields,
  resolveScopedPharmacyVisitRead,
  resolvePharmacyVisitMarketIdentity,
  type PharmacyVisitReadRepository,
} from "./pharmacyVisitReadService";
import { JORDAN_MARKET_DEFAULT, LIBYA_MARKET_DEFAULT } from "../src/lib/marketSettings";

const visit = (id: string, repId = "ACTOR", areaId: string | undefined = "A1", pharmacyId = "PH1"): PharmacyVisit & { areaId?: string; payment?: unknown; receiptImage?: string } => ({
  id, pharmacyId, pharmacyName: pharmacyId, repId, repName: repId, areaId, visitDate: "2026-08-01", gpsVerified: true,
  visitPurpose: "Order Intake", items: [{ productId: "P1", productName: "P1", quantity: 2, price: 10, discount: 0 }],
  totalAmount: 20, discountApplied: 0, netAmount: 20, paymentCollected: 5, outstandingBalanceAfter: 15,
  stockAudit: [{ productId: "P1", productName: "P1", availableStock: 2, shelfQty: 1 }], stockRequests: [{ productId: "P1", productName: "P1", requestQty: 3 }],
  intelNotes: "sensitive", createdAt: "2026-08-01T00:00:00Z", payment: { cheque: "SECRET" }, receiptImage: "SECRET",
});
const legacyVisit = (id: string, repId = "ACTOR", pharmacyId = "PH1") => { const record = visit(id, repId, "A1", pharmacyId); delete record.areaId; return record; };
const pharmacy = (id: string, areaId = "A1"): Pharmacy => ({ id, name: id, territory: areaId, region: "R1", address: "Street", outstandingBalance: 0, areaId, active: true, status: "Active" });
const scope = (overrides: Partial<EffectiveOperationalScope> = {}): EffectiveOperationalScope => ({
  authorized: true, actorUid: "ACTOR", role: "Sales Representative", boundaryKind: "AREA", subjectMode: "SELF", subjectUids: ["ACTOR"],
  countryIds: ["C1"], regionIds: ["R1"], districtIds: ["R1"], cityIds: ["CT1"], areaIds: ["A1"], productIds: ["P1"], productGroupIds: [],
  queryPlan: { denyAll: false, areaIdChunks: [["A1"]], subjectUidChunks: [["ACTOR"]], productIdChunks: [["P1"]], requiresPostFilter: true },
  diagnostics: { excludedAssignmentIds: [], malformedAssignmentIds: [], outsideBoundaryAssignmentIds: [] }, ...overrides,
});
const controls = { fromDate: "2026-06-01", toDate: "2026-08-11", pageSize: 50 };

function operationalRepository({ role = "Sales Representative", manager = false, actorActive = true, configuredAreas = ["A1"], assignmentAreas = ["A1"] } = {}): OperationalScopeRepository {
  const actor = { id: "ACTOR", email: "actor@test", role, active: actorActive, loginAllowed: true, status: "Active", securityScope: "Area", areaIds: configuredAreas, country: "C1" };
  const subordinate = { id: "REP1", email: "rep@test", role: role.includes("Medical") ? "Medical Representative" : "Sales Representative", active: true, managerId: "ACTOR" };
  return {
    hierarchy: { async getUser(uid) { return uid === "ACTOR" ? actor : uid === "REP1" ? subordinate : null; }, async getDirectReports(uid) { return manager && uid === "ACTOR" ? [subordinate] : []; }, async getAllUsers() { return manager ? [actor, subordinate] : [actor]; }, async getRolePermissions() { return null; } },
    async getGeographyCatalog() { return { countries: [{ id: "C1", active: true }], districts: [{ id: "R1", countryId: "C1", active: true }], cities: [{ id: "CT1", districtId: "R1", countryId: "C1", active: true }, { id: "CT2", districtId: "R1", countryId: "C1", active: true }], areas: [{ id: "A1", cityId: "CT1", districtId: "R1", countryId: "C1", active: true }, { id: "A2", cityId: "CT2", districtId: "R1", countryId: "C1", active: true }], nodes: [{ areaId: "A1", cityId: "CT1", districtId: "R1", regionId: "R1", countryId: "C1", active: true }, { areaId: "A2", cityId: "CT2", districtId: "R1", regionId: "R1", countryId: "C1", active: true }] }; },
    async getTerritoryAssignments(subjects) { return assignmentAreas.map((areaId, index) => ({ assignmentId: `TA${index}`, userId: manager ? "REP1" : subjects[0], status: "Active", active: true, countryId: "C1", regionId: "R1", districtId: "R1", cityId: areaId === "A1" ? "CT1" : "CT2", areaId })); },
    async getProductAssignments() { return [{ assignmentId: "PA1", userId: manager ? "REP1" : "ACTOR", productId: "P1", effectiveFrom: "2026-01-01", effectiveTo: "2030-01-01", assignedAt: "2026-01-01", assignedBy: "TEST", status: "Active", active: true }]; },
    async getProducts() { return [{ id: "P1", name: "P1", brand: "P1", sku: "P1", therapeuticArea: "TA", price: 1, stock: 1, isActive: true }]; },
  };
}
const readRepository = (records: PharmacyVisit[]): PharmacyVisitReadRepository => ({ queryBySubjectUids: vi.fn(async () => records) });
const marketReadRepository = { getAreasByIds: vi.fn(async (ids: string[]) => ids.map(id => ({ id, countryId: "C-LIB-1999" }))), getActiveMarkets: vi.fn(async () => [LIBYA_MARKET_DEFAULT]) };
const pharmacyReadRepository = { queryByAreaIds: vi.fn(async () => [pharmacy("PH1")]) };

describe("WP5.2F.5B canonical pharmacy visit-history READ", () => {
  it("DEF A. canonical Pharmacy overrides legacy LIBYA", () => expect(resolvePharmacyVisitMarketIdentity({ ...visit("V"), countryId: "LIBYA" } as any, { ...pharmacy("PH1"), countryId: "C-LIB-1999" } as any, undefined, [LIBYA_MARKET_DEFAULT])).toEqual({ marketId: "C-LIB-1999", countryId: "C-LIB-1999" }));
  it("DEF B. canonical Pharmacy/Area overrides retired persisted country", () => expect(resolvePharmacyVisitMarketIdentity({ ...visit("V"), countryId: "C-LIB-8842" } as any, { ...pharmacy("PH1"), countryId: "C-LIB-1999" } as any, { id: "A1", countryId: "C-LIB-1999" }, [LIBYA_MARKET_DEFAULT])).toEqual({ marketId: "C-LIB-1999", countryId: "C-LIB-1999" }));
  it("DEF C. canonical Pharmacy and Area disagreement fails closed", () => expect(resolvePharmacyVisitMarketIdentity(visit("V"), { ...pharmacy("PH1"), countryId: "C-LIB-1999" } as any, { id: "A1", countryId: "C-JOR-0396" }, [LIBYA_MARKET_DEFAULT, JORDAN_MARKET_DEFAULT])).toBeNull());
  it("DEF D. unresolved canonical and unvalidated persisted identity fails closed", () => expect(resolvePharmacyVisitMarketIdentity({ ...visit("V"), countryId: "LIBYA" } as any, undefined, undefined, [LIBYA_MARKET_DEFAULT])).toBeNull());
  it("DEF E. current canonical persisted market identity resolves through active settings", () => expect(resolvePharmacyVisitMarketIdentity({ ...visit("V"), marketId: "C-LIB-1999", countryId: "C-LIB-1999" } as any, undefined, undefined, [LIBYA_MARKET_DEFAULT])).toEqual({ marketId: "C-LIB-1999", countryId: "C-LIB-1999" }));
  it("1. Sales Representative receives own authorized visit", () => expect(filterPharmacyVisitsWithinOperationalScope([visit("V1")], scope(), new Set()).map(v => v.id)).toEqual(["V1"]));
  it("2. Sales Representative cannot read another representative visit", () => expect(filterPharmacyVisitsWithinOperationalScope([visit("V1", "OTHER")], scope(), new Set())).toEqual([]));
  it("3. same-area pharmacy directory visibility does not grant another representative history", () => expect(filterPharmacyVisitsWithinOperationalScope([visit("V1", "OTHER", "A1")], scope(), new Set())).toEqual([]));
  it("4. Sales Supervisor receives authorized subordinate visit", async () => { const result = await resolveScopedPharmacyVisitRead("ACTOR", controls, { operationalScopeRepository: operationalRepository({ role: "Sales Supervisor", manager: true }), pharmacyVisitReadRepository: readRepository([visit("V1", "REP1")]), legacyPharmacyReadRepository: pharmacyReadRepository, marketReadRepository }); expect(result.visits.map(v => v.id)).toEqual(["V1"]); });
  it("5. non-subordinate visit is excluded", () => expect(filterPharmacyVisitsWithinOperationalScope([visit("V1", "OTHER")], scope({ role: "Sales Supervisor", subjectMode: "HIERARCHY", subjectUids: ["ACTOR", "REP1"] }), new Set())).toEqual([]));
  for (const [number, role] of [[6, "Area Sales Manager"], [7, "Sales Manager"], [8, "Sales & Marketing Manager"], [9, "Country Manager"]] as const) {
    it(`${number}. ${role} remains bounded to canonical hierarchy and geography`, () => { const manager = scope({ role, subjectMode: "HIERARCHY", subjectUids: ["ACTOR", "REP1"] }); expect(filterPharmacyVisitsWithinOperationalScope([visit("IN", "REP1", "A1"), visit("SUB", "OTHER", "A1"), visit("AREA", "REP1", "A2")], manager, new Set()).map(v => v.id)).toEqual(["IN"]); });
  }
  it("10. Medical role is denied before pharmacyVisits query", async () => { const query = vi.fn(); const result = await resolveScopedPharmacyVisitRead("ACTOR", controls, { operationalScopeRepository: operationalRepository({ role: "Medical Manager", manager: true }), pharmacyVisitReadRepository: { queryBySubjectUids: query } }); expect(result.code).toBe("PHARMACY_VISIT_HISTORY_ROLE_DENIED"); expect(query).not.toHaveBeenCalled(); });
  it("11. Finance Officer detailed history fails closed", async () => { const query = vi.fn(); const result = await resolveScopedPharmacyVisitRead("ACTOR", controls, { operationalScopeRepository: operationalRepository({ role: "Finance Officer" }), pharmacyVisitReadRepository: { queryBySubjectUids: query } }); expect(result.authorized).toBe(false); expect(query).not.toHaveBeenCalled(); });
  it("12. Product Manager detailed history fails closed", async () => { const query = vi.fn(); const result = await resolveScopedPharmacyVisitRead("ACTOR", controls, { operationalScopeRepository: operationalRepository({ role: "Product Manager" }), pharmacyVisitReadRepository: { queryBySubjectUids: query } }); expect(result.authorized).toBe(false); expect(query).not.toHaveBeenCalled(); });
  it("13. modern visit with valid areaId is allowed", () => expect(filterPharmacyVisitsWithinOperationalScope([visit("V1")], scope(), new Set())).toHaveLength(1));
  it("14. modern visit outside area is denied", () => expect(filterPharmacyVisitsWithinOperationalScope([visit("V1", "ACTOR", "A2")], scope(), new Set())).toEqual([]));
  it("15. legacy missing-area visit requires a pharmacy inside bounded set", async () => { const bounded = vi.fn(async () => [pharmacy("PH1")]); const result = await resolveScopedPharmacyVisitRead("ACTOR", controls, { operationalScopeRepository: operationalRepository(), pharmacyVisitReadRepository: readRepository([legacyVisit("V1")]), legacyPharmacyReadRepository: { queryByAreaIds: bounded }, marketReadRepository }); expect(result.visits.map(v => v.id)).toEqual(["V1"]); expect(bounded).toHaveBeenCalledWith(["A1"]); });
  it("16. legacy missing-area visit outside bounded set is denied", async () => { const bounded = vi.fn(async () => [pharmacy("PH1")]); const result = await resolveScopedPharmacyVisitRead("ACTOR", controls, { operationalScopeRepository: operationalRepository(), pharmacyVisitReadRepository: readRepository([legacyVisit("V1", "ACTOR", "OUT")]), legacyPharmacyReadRepository: { queryByAreaIds: bounded }, marketReadRepository }); expect(result.visits).toEqual([]); expect(bounded).toHaveBeenCalledWith(["A1"]); });
  it("17. canonical multi-area assignments are not narrowed by legacy profile geography", async () => { const result = await resolveScopedPharmacyVisitRead("ACTOR", controls, { operationalScopeRepository: operationalRepository({ configuredAreas: ["A1"], assignmentAreas: ["A1", "A2"] }), pharmacyVisitReadRepository: readRepository([visit("A1", "ACTOR", "A1"), visit("A2", "ACTOR", "A2")]), legacyPharmacyReadRepository: pharmacyReadRepository, marketReadRepository }); expect(result.visits.map(v => v.id)).toEqual(["A1", "A2"]); });
  it("18. inactive actor denied before query", async () => { const query = vi.fn(); const result = await resolveScopedPharmacyVisitRead("ACTOR", controls, { operationalScopeRepository: operationalRepository({ actorActive: false }), pharmacyVisitReadRepository: { queryBySubjectUids: query } }); expect(result.code).toBe("ACTOR_INACTIVE"); expect(query).not.toHaveBeenCalled(); });
  it("19. denyAll denied before query", () => expect(filterPharmacyVisitsWithinOperationalScope([visit("V1")], scope({ queryPlan: { ...scope().queryPlan, denyAll: true } }), new Set())).toEqual([]));
  it("20. GLOBAL remains explicitly bounded", () => { const global = scope({ role: "Super Admin", boundaryKind: "GLOBAL", subjectMode: "HIERARCHY", subjectUids: ["ACTOR", "REP1"] }); expect(filterPharmacyVisitsWithinOperationalScope([visit("IN", "REP1", "A1"), visit("OUT", "OTHER", "A1")], global, new Set()).map(v => v.id)).toEqual(["IN"]); });
  it("21. backend contains no whole-collection pharmacyVisits scan", () => { const source = fs.readFileSync(new URL("./pharmacyVisitReadService.ts", import.meta.url), "utf8"); expect(source).toContain('.where("repId", "in", subjects)'); expect(source).not.toMatch(/collection\("pharmacyVisits"\)\s*\.get\s*\(/); });
  it("DEF security. currency resolution uses targeted server Area reads and does not broaden rules or mutate commerce", () => { const source = fs.readFileSync(new URL("./pharmacyVisitReadService.ts", import.meta.url), "utf8"); expect(source).toContain('collection("areas").doc(areaId).get()'); expect(source).not.toMatch(/collection\("areas"\)\.get\s*\(/); expect(source).not.toContain("writeBatch("); expect(source).not.toContain("runTransaction("); expect(source).not.toMatch(/db\.collection\([^\n]+\)\.doc\([^\n]+\)\.(set|update|create|delete)\s*\(/); });
  it("22. date range is limited to 90 days", () => { expect(parsePharmacyVisitReadControls({ fromDate: "2026-01-01", toDate: "2026-08-01" })).toBeNull(); expect(parsePharmacyVisitReadControls({ fromDate: "2026-06-01", toDate: "2026-08-01" })).not.toBeNull(); });
  it("23. page-size cap is enforced", () => { expect(parsePharmacyVisitReadControls({ pageSize: 101 })).toBeNull(); expect(parsePharmacyVisitReadControls({ pageSize: 100 })).not.toBeNull(); });
  it("24. ordering is deterministic", () => expect(filterPharmacyVisitsWithinOperationalScope([visit("Z"), { ...visit("B"), visitDate: "2026-08-02" }, visit("A")], scope(), new Set()).map(v => v.id)).toEqual(["B", "A", "Z"]));
  it("25. duplicates are removed", () => expect(filterPharmacyVisitsWithinOperationalScope([visit("V1"), visit("V1")], scope(), new Set())).toHaveLength(1));
  it("26. malformed records are excluded", () => expect(filterPharmacyVisitsWithinOperationalScope([{ ...visit("V1"), pharmacyId: "" }], scope(), new Set())).toEqual([]));
  it("27. commercial fields are redacted and cannot widen authority", () => { const result = redactPharmacyVisitCommercialFields(visit("V1")) as PharmacyVisit & Record<string, unknown>; expect(result.items).toEqual([]); expect(result.payment).toBeUndefined(); expect(result.receiptImage).toBeUndefined(); expect(result.netAmount).toBe(0); });
  it("29. endpoint requires Firebase authentication", () => expect(fs.readFileSync(new URL("../server.ts", import.meta.url), "utf8")).toContain('app.post("/api/pharmacy-visits/scoped-query", requireFirebaseAuth'));
});
