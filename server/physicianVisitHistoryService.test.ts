import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { Physician, PhysicianVisit } from "../src/types";
import type { OperationalScopeRepository } from "./operationalScopeRepository";
import {
  parsePhysicianVisitHistoryRequest,
  resolveScopedPhysicianVisitHistory,
  type PhysicianVisitHistoryRepository,
} from "./physicianVisitHistoryService";

const physician = (id = "PHY_1"): Physician => ({
  id, name: id, specialty: "GP", classification: "A", territory: "AREA_1", region: "DISTRICT_1",
  address: "Clinic", areaId: "AREA_1", alignedProductIds: ["PRODUCT_1"], primaryPromotionGroupId: "GROUP_1",
  // Deliberately unrelated global metadata: it must never enter the history resolver.
  lastVisitDate: "2026-12-31",
});

const visit = (id: string, repId: string, visitDate: string, completedAt?: string): PhysicianVisit => ({
  id, physicianId: "PHY_1", physicianName: "PHY_1", repId, repName: repId, status: "Completed", visitDate,
  completedAt, durationSeconds: 60, detailing: [], samples: [], additionalSampleRequests: [], generalNotes: "", gpsVerified: true,
});

function operationalRepository(role: string, representativeUids: string[]): OperationalScopeRepository {
  const actor = { id: role === "Medical Representative" ? representativeUids[0] : "ACTOR", role, active: true, loginAllowed: true, status: "Active", securityScope: "Area", country: "COUNTRY_1" };
  const reps = representativeUids.map((id) => ({ id, role: "Medical Representative", active: true, loginAllowed: true, status: "Active", managerId: actor.id }));
  return {
    hierarchy: {
      async getUser(uid) { return uid === actor.id ? actor : reps.find((rep) => rep.id === uid) || null; },
      async getDirectReports(uid) { return uid === actor.id && role !== "Medical Representative" ? reps : []; },
      async getAllUsers() { return [actor, ...reps.filter((rep) => rep.id !== actor.id)]; },
      async getRolePermissions() { return null; },
    },
    async getGeographyCatalog() { return { countries: [{ id: "COUNTRY_1", active: true }], districts: [{ id: "DISTRICT_1", countryId: "COUNTRY_1", active: true }], cities: [{ id: "CITY_1", districtId: "DISTRICT_1", countryId: "COUNTRY_1", active: true }], areas: [{ id: "AREA_1", cityId: "CITY_1", districtId: "DISTRICT_1", countryId: "COUNTRY_1", active: true }], nodes: [{ areaId: "AREA_1", cityId: "CITY_1", districtId: "DISTRICT_1", regionId: "DISTRICT_1", countryId: "COUNTRY_1", active: true }] }; },
    async getTerritoryAssignments(subjects) { return subjects.map((userId, index) => ({ assignmentId: `TA_${index}`, userId, status: "Active", active: true, countryId: "COUNTRY_1", districtId: "DISTRICT_1", regionId: "DISTRICT_1", cityId: "CITY_1", areaId: "AREA_1" })); },
    async getProductAssignments(subjects) { return subjects.map((userId, index) => ({ assignmentId: `PA_${index}`, userId, productId: "PRODUCT_1", productGroupId: "GROUP_1", status: "Active", active: true, effectiveFrom: "2020-01-01", effectiveTo: "2030-01-01" })); },
    async getProducts() { return [{ id: "PRODUCT_1", name: "Product", brand: "Brand", sku: "P1", therapeuticArea: "TA", price: 1, stock: 1, promotionGroupId: "GROUP_1", isActive: true }]; },
  };
}

const physicianRepository = { queryByAreaIds: vi.fn(async () => [physician()]) };
const request = { physicianIds: ["PHY_1"], includeHistory: true };

describe("Fix 5B.1 canonical physician Last Visit/history", () => {
  it("returns REP_A own latest visit even when REP_B visited later", async () => {
    const historyRepository: PhysicianVisitHistoryRepository = { queryByPhysicianAndSubjectUids: vi.fn(async () => [
      visit("REP_A_OLD", "REP_A", "2026-01-01"), visit("REP_B_LATER", "REP_B", "2026-08-01"), visit("REP_A_LATEST", "REP_A", "2026-03-01"),
    ]) };
    const result = await resolveScopedPhysicianVisitHistory("REP_A", request, { operationalScopeRepository: operationalRepository("Medical Representative", ["REP_A"]), physicianReadRepository: physicianRepository, historyRepository, now: new Date("2026-08-23T00:00:00Z") });
    expect(result.summaries[0]).toMatchObject({ lastVisit: { id: "REP_A_LATEST" }, totalCompletedVisits: 2, subjectUids: ["REP_A"], scopeMode: "SELF" });
  });

  it("returns NONE when only another representative has visited", async () => {
    const historyRepository = { queryByPhysicianAndSubjectUids: vi.fn(async () => [visit("REP_B", "REP_B", "2026-08-01")]) };
    const result = await resolveScopedPhysicianVisitHistory("REP_A", request, { operationalScopeRepository: operationalRepository("Medical Representative", ["REP_A"]), physicianReadRepository: physicianRepository, historyRepository });
    expect(result.summaries[0]).toMatchObject({ lastVisit: null, totalCompletedVisits: 0, visits: [] });
  });

  it("finds a valid own visit older than the general 90-day feed", async () => {
    const old = visit("OLD", "REP_A", "2025-01-01", "2025-01-01T12:00:00Z");
    const result = await resolveScopedPhysicianVisitHistory("REP_A", request, { operationalScopeRepository: operationalRepository("Medical Representative", ["REP_A"]), physicianReadRepository: physicianRepository, historyRepository: { queryByPhysicianAndSubjectUids: vi.fn(async () => [old]) }, now: new Date("2026-08-23T00:00:00Z") });
    expect(result.summaries[0].lastVisit?.id).toBe("OLD");
  });

  it("allows an authorized supervisor subject and denies an unrelated forged subject", async () => {
    const dependencies = { operationalScopeRepository: operationalRepository("Medical Supervisor", ["REP_A"]), physicianReadRepository: physicianRepository, historyRepository: { queryByPhysicianAndSubjectUids: vi.fn(async () => [visit("A", "REP_A", "2026-08-01")]) } };
    const allowed = await resolveScopedPhysicianVisitHistory("ACTOR", { ...request, subjectUid: "REP_A" }, dependencies);
    const denied = await resolveScopedPhysicianVisitHistory("ACTOR", { ...request, subjectUid: "REP_B" }, dependencies);
    expect(allowed).toMatchObject({ authorized: true, scopeMode: "TEAM", summaries: [{ subjectUids: ["REP_A"] }] });
    expect(denied).toMatchObject({ authorized: false, code: "PHYSICIAN_HISTORY_SUBJECT_SCOPE_DENIED", summaries: [] });
  });

  it("queries every subject chunk for a team larger than 30 without truncation", async () => {
    const reps = Array.from({ length: 65 }, (_, index) => `REP_${String(index).padStart(2, "0")}`);
    const query = vi.fn(async (_physicianId: string, subjects: string[]) => subjects.map((repId) => visit(`V_${repId}`, repId, "2026-08-01")));
    const result = await resolveScopedPhysicianVisitHistory("ACTOR", request, { operationalScopeRepository: operationalRepository("Medical Supervisor", reps), physicianReadRepository: physicianRepository, historyRepository: { queryByPhysicianAndSubjectUids: query } });
    expect(query.mock.calls.map((call) => call[1].length)).toEqual([30, 30, 5]);
    expect(result.summaries[0].totalCompletedVisits).toBe(65);
    expect(result.summaries[0].subjectUids).toHaveLength(65);
  });

  it("rejects a forged client role and protects the endpoint with Firebase auth", () => {
    expect(parsePhysicianVisitHistoryRequest({ physicianIds: ["PHY_1"], includeHistory: false, role: "Super Admin" })).toBeNull();
    const server = fs.readFileSync(new URL("../server.ts", import.meta.url), "utf8");
    expect(server).toContain('app.post("/api/physician-visits/physician-history", requireFirebaseAuth');
  });

  it("removes global/fabricated representative history from both UI workflows", () => {
    const list = fs.readFileSync(new URL("../src/components/PhysicianList.tsx", import.meta.url), "utf8");
    const execution = fs.readFileSync(new URL("../src/components/PhysicianVisit.tsx", import.meta.url), "utf8");
    const visitsTab = list.slice(list.indexOf("TAB 2: VISITS HISTORY"), list.indexOf("TAB 3: SAMPLES"));
    expect(visitsTab).not.toContain("AliM Beitlalmal");
    expect(visitsTab).not.toMatch(/selectedPhysician\.lastVisitDate\s*\?/);
    expect(list).not.toContain("selectedPhysician.lastVisitDate");
    expect(list).toContain("No own visit history.");
    expect(execution).not.toContain("selectedPhysician.lastVisitDate");
    expect(execution).not.toContain("p.lastVisitDate ? p.lastVisitDate");
  });
});
