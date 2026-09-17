import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { ALL_PLANNER_FILTERS, DEFAULT_PLANNER_CAPACITY, evaluatePlannerEligibility, filterPlannerPhysicians, normalizePlannerFilters, plannerCapacityCode, plannerCascadeOptions, qualifyingPlannerRecords, togglePlannerFilter, type PlannerFrequencyRecord, type PlannerPhysician } from "./medicalPlannerPolicy";

const physician = (id: string, cityId: string, areaId: string, specialtyId: string, classification: "A" | "B" | "C", group: string): PlannerPhysician => ({
  id, name: id, specialty: specialtyId, specialtyId, classification, territory: areaId, region: cityId, address: "x", areaId, cityId, canonicalAreaId: areaId, canonicalCityId: cityId, primaryPromotionGroupId: group, targetPromotionGroupIds: [], targetFrequency: 2,
});
const pool = [physician("Alpha", "C1", "A1", "S1", "A", "G1"), physician("Beta", "C1", "A2", "S2", "B", "G2"), physician("Gamma", "C2", "A3", "S1", "C", "G2")];
const record = (id: string, date: string, kind: "PLANNED" | "COMPLETED" = "PLANNED", status = kind === "COMPLETED" ? "Completed" : "PLANNED"): PlannerFrequencyRecord => ({ id, date, kind, status, repId: "R", physicianId: "P" });

describe("Fix 5B.3B-1C simple Planner policy", () => {
  it("defaults every structured filter to ALL and resets cleanly", () => { expect(ALL_PLANNER_FILTERS).toEqual({ cityId: ["ALL"], areaId: ["ALL"], specialtyId: ["ALL"], classification: ["ALL"], promotionGroupId: ["ALL"], search: "" }); expect(togglePlannerFilter(["C1", "C2"], "ALL")).toEqual(["ALL"]); });
  it("supports multi-City and multi-Area selections", () => { expect(filterPlannerPhysicians(pool, { ...ALL_PLANNER_FILTERS, cityId: ["C1", "C2"], areaId: ["A1", "A3"] }).map(item => item.id)).toEqual(["Alpha", "Gamma"]); expect(plannerCascadeOptions(pool, { ...ALL_PLANNER_FILTERS, cityId: ["C1"] })).toMatchObject({ areaId: ["A1", "A2"], specialtyId: ["S1", "S2"], classification: ["A", "B"], promotionGroupId: ["G1", "G2"] }); });
  it("supports multi-Specialty, Class, and Promotion Group selections", () => { expect(filterPlannerPhysicians(pool, { ...ALL_PLANNER_FILTERS, specialtyId: ["S1", "S2"], classification: ["A", "C"], promotionGroupId: ["G1", "G2"] }).map(item => item.id)).toEqual(["Alpha", "Gamma"]); });
  it("cascades Area and Promotion Group in every direction", () => { expect(plannerCascadeOptions(pool, { ...ALL_PLANNER_FILTERS, areaId: ["A1"] }).promotionGroupId).toEqual(["G1"]); expect(plannerCascadeOptions(pool, { ...ALL_PLANNER_FILTERS, promotionGroupId: ["G2"] })).toMatchObject({ cityId: ["C1", "C2"], areaId: ["A2", "A3"], specialtyId: ["S1", "S2"], classification: ["B", "C"] }); });
  it("removes impossible combinations and cascades Specialty", () => { const options = plannerCascadeOptions(pool, { ...ALL_PLANNER_FILTERS, specialtyId: ["S1"], cityId: ["C1"] }); expect(options.areaId).toEqual(["A1"]); expect(options.classification).toEqual(["A"]); expect(normalizePlannerFilters({ ...ALL_PLANNER_FILTERS, areaId: ["A2"] }, { ...options, areaId: ["A1"] }).areaId).toEqual(["ALL"]); });
  it("filters Class and search inside authorization", () => expect(filterPlannerPhysicians(pool, { ...ALL_PLANNER_FILTERS, classification: ["A"], search: "alp" }).map(item => item.id)).toEqual(["Alpha"]));
  for (const [frequency, gap] of [[1, 25], [2, 10], [3, 8], [4, 5]] as const) it(`enforces frequency ${frequency} and ${gap}-day spacing`, () => { expect(evaluatePlannerEligibility(frequency, `2026-01-${String(gap).padStart(2, "0")}`, [record("V", "2026-01-01")]).eligible).toBe(false); expect(evaluatePlannerEligibility(frequency, `2026-01-${String(gap + 1).padStart(2, "0")}`, [record("V", "2026-01-01")]).eligible).toBe(frequency > 1); });
  it("uses the selected future date and rolling 30-day maximum", () => { expect(evaluatePlannerEligibility(2, "2026-01-10", [record("A", "2026-01-01")]).eligible).toBe(false); expect(evaluatePlannerEligibility(2, "2026-01-11", [record("A", "2026-01-01")]).eligible).toBe(true); expect(evaluatePlannerEligibility(2, "2026-01-21", [record("A", "2026-01-01"), record("B", "2026-01-11")]).code).toBe("TARGET_REACHED"); expect(evaluatePlannerEligibility(1, "2026-02-01", [record("OLD", "2026-01-01")]).eligible).toBe(true); });
  it("reserves planned entries, releases cancelled entries, and deduplicates completed origins", () => { expect(evaluatePlannerEligibility(1, "2026-01-30", [record("P", "2026-01-05")]).eligible).toBe(false); expect(evaluatePlannerEligibility(1, "2026-01-30", [record("P", "2026-01-05", "PLANNED", "CANCELLED")]).eligible).toBe(true); const records = [record("VISIT", "2026-01-05", "COMPLETED"), { ...record("PLAN", "2026-01-05"), completedVisitId: "VISIT" }]; expect(qualifyingPlannerRecords(records)).toHaveLength(1); });
  it("cannot expand beyond the canonical input pool", () => expect(filterPlannerPhysicians(pool, { ...ALL_PLANNER_FILTERS, cityId: ["OUTSIDE"] })).toEqual([]));
  it("enforces all five representative capacity preferences", () => { const dates = ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09", "2026-01-10", "2026-01-11"]; const candidate = { physicianId: "P", date: dates[0], classification: "A" }; expect(plannerCapacityCode({ ...DEFAULT_PLANNER_CAPACITY, totalVisitsPerDay: 1 }, [{ physicianId: "Q", date: dates[0] }], candidate, dates)).toBe("DAILY_CAPACITY_REACHED"); expect(plannerCapacityCode({ ...DEFAULT_PLANNER_CAPACITY, totalVisitsPerWeek: 1 }, [{ physicianId: "Q", date: dates[1] }], candidate, dates)).toBe("WEEKLY_CAPACITY_REACHED"); expect(plannerCapacityCode({ ...DEFAULT_PLANNER_CAPACITY, samePhysicianPerDay: 1 }, [candidate], candidate, dates)).toBe("PHYSICIAN_DAILY_CAPACITY_REACHED"); expect(plannerCapacityCode({ ...DEFAULT_PLANNER_CAPACITY, samePhysicianPerWeek: 1 }, [{ ...candidate, date: dates[1] }], candidate, dates)).toBe("PHYSICIAN_WEEKLY_CAPACITY_REACHED"); expect(plannerCapacityCode({ ...DEFAULT_PLANNER_CAPACITY, maxClassAVisitsPerDay: 1 }, [{ physicianId: "Q", date: dates[0], classification: "A" }], candidate, dates)).toBe("CLASS_A_DAILY_CAPACITY_REACHED"); });
  it("capacity never overrides target-frequency eligibility", () => { expect(plannerCapacityCode(DEFAULT_PLANNER_CAPACITY, [], { physicianId: "P", date: "2026-01-02" }, ["2026-01-02"])).toBeNull(); expect(evaluatePlannerEligibility(1, "2026-01-02", [record("A", "2026-01-01")]).eligible).toBe(false); });
  it("keeps the Planner owner-only, approval-free, and independent from Visit authorization", () => {
    const component = fs.readFileSync(new URL("../components/MedicalPlanner.tsx", import.meta.url), "utf8");
    const scope = fs.readFileSync(new URL("../../server/medicalPlannerScopeService.ts", import.meta.url), "utf8");
    const mutation = fs.readFileSync(new URL("../../server/medicalPlannerMutationService.ts", import.meta.url), "utf8");
    const visit = fs.readFileSync(new URL("../../server/physicianVisitWriteService.ts", import.meta.url), "utf8");
    expect(component).not.toMatch(/Submit Detailing Plan|Approve Plan|Pending Approval|master territory alignment/i);
    expect(component).not.toMatch(/requires an approved prioritization and travel policy/i);
    expect(component).toContain("saveAuthorizedMedicalPlannerWeek");
    expect(component).toContain("if (isReadOnly || isAutoPlanning) return");
    expect(scope).not.toContain('db.collection("medicalPlannerApprovals")');
    expect(scope).toContain('actorUid !== request.repId');
    expect(mutation).toContain('actorUid !== proposal.repId');
    expect(visit).not.toMatch(/PLANNER_(VISIT_)?REQUIRED/);
    expect(visit).toContain('plannerQuery.docs.forEach');
  });
});
