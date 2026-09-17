import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { addPlannerDraftVisit, movePlannerDraftVisit, plannerLastVisitPresentation, removePlannerDraftVisit } from "./medicalPlannerPolicy";

const dates = ["2026-08-24", "2026-08-25", "2026-08-26"];
const visit = { id: "V1", physicianId: "P1", date: dates[0], classification: "A" };

describe("Fix 5B.3B-1D mobile weekly Planner lifecycle", () => {
  it("adds, removes, and moves draft physicians only on configured working days", () => {
    expect(addPlannerDraftVisit([], visit, dates)).toEqual([visit]);
    expect(movePlannerDraftVisit([visit], "V1", dates[1], dates)[0].date).toBe(dates[1]);
    expect(removePlannerDraftVisit([visit], "V1")).toEqual([]);
    expect(() => movePlannerDraftVisit([visit], "V1", "2026-08-30", dates)).toThrow("PLANNER_NON_WORKING_DAY");
  });
  it("uses canonical completed-visit dates and supports Never", () => {
    expect(plannerLastVisitPresentation(["2026-08-01", "2026-08-13"], new Date("2026-08-25T12:00:00Z"))).toEqual({ exact: "2026-08-13", elapsedDays: 12 });
    expect(plannerLastVisitPresentation([])).toEqual({ exact: null, elapsedDays: null });
  });
  it("renders a purpose-built mobile summary and vertical day detail", () => {
    const source = fs.readFileSync(new URL("../components/MedicalPlanner.tsx", import.meta.url), "utf8");
    expect(source).toContain('id="mobile-weekly-plan"');
    expect(source).toContain('id="mobile-planner-day-detail"');
    expect(source).toContain('className="md:hidden');
    expect(source).toContain('className="hidden md:grid');
    expect(source).toContain("configuredWorkingDays.map");
  });
  it("has no exact-time requirement and displays direct target frequency", () => {
    const component = fs.readFileSync(new URL("../components/MedicalPlanner.tsx", import.meta.url), "utf8");
    const mutation = fs.readFileSync(new URL("../../server/medicalPlannerMutationService.ts", import.meta.url), "utf8");
    expect(component).not.toMatch(/type="time"|selectedTime|Target:.*\/30d/);
    expect(component).toContain("Target Frequency:");
    expect(mutation).not.toContain("PLANNER_TIME_OUTSIDE_WORKDAY");
  });
  it("keeps generated plans draft until explicit representative save", () => {
    const component = fs.readFileSync(new URL("../components/MedicalPlanner.tsx", import.meta.url), "utf8");
    const scope = fs.readFileSync(new URL("../../server/medicalPlannerScopeService.ts", import.meta.url), "utf8");
    expect(component).toContain('setPlanState("DRAFT")');
    expect(component).toContain("SAVE WEEKLY PLAN");
    expect(component).toContain("saveAuthorizedMedicalPlannerWeek");
    expect(scope).toContain('planStatus: "SAVED"');
    expect(scope).not.toMatch(/APPROV|SUBMIT|REJECT/);
  });
  it("keeps manager controls read-only and refreshes Today’s Planned Visits after save", () => {
    const component = fs.readFileSync(new URL("../components/MedicalPlanner.tsx", import.meta.url), "utf8");
    const app = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    const read = fs.readFileSync(new URL("../../server/physicianReadService.ts", import.meta.url), "utf8");
    const visit = fs.readFileSync(new URL("../../server/physicianVisitWriteService.ts", import.meta.url), "utf8");
    expect(component).toContain("if (isReadOnly || planningType");
    expect(app).toContain("menareps:medical-planner-saved");
    expect(read).toContain("plannedVisitDate: today");
    expect(read).toContain('planStatus === "SAVED"');
    expect(visit).not.toMatch(/PLANNER_(VISIT_)?REQUIRED/);
  });
});
