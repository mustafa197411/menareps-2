import { describe, expect, it } from "vitest";
import type { PharmacyVisit, PhysicianVisit } from "../types";
import { isCompletedVisit, completedPharmacyVisits, calculatePhysicianCoverage, filterVisitsForDashboardPeriod, resolveDashboardPeriod } from "./dashboardOperationalPeriod";

const visit = (id: string, physicianId: string, visitDate: string, status = "Completed") => ({ id, physicianId, visitDate, status } as PhysicianVisit);

describe("operational dashboard period and physician coverage", () => {
  it("counts repeated completed visits once and intersects with current authorized physicians", () => {
    const result = calculatePhysicianCoverage(
      [{ id: "A" }, { id: "B" }, { id: "DELETED", deleted: true }],
      [visit("1", "A", "2026-08-28"), visit("2", "A", "2026-08-28"), visit("3", "OUT", "2026-08-28"), visit("4", "DELETED", "2026-08-28")],
    );
    expect(result).toEqual({ physiciansVisited: 1, totalPhysicians: 2, percentage: 50 });
  });

  it("excludes incomplete visits rather than clamping the percentage", () => {
    const result = calculatePhysicianCoverage([{ id: "A" }], [visit("1", "A", "2026-08-28", "IN_PROGRESS"), visit("2", "OUT", "2026-08-28")]);
    expect(result).toEqual({ physiciansVisited: 0, totalPhysicians: 1, percentage: 0 });
  });

  it("resolves Today, Monday-based Week, and Month boundaries", () => {
    const now = new Date("2026-08-28T15:00:00.000Z");
    expect(resolveDashboardPeriod("today", now)).toMatchObject({ fromDate: "2026-08-28", toDate: "2026-08-28" });
    expect(resolveDashboardPeriod("this-week", now)).toMatchObject({ fromDate: "2026-08-24", toDate: "2026-08-28" });
    expect(resolveDashboardPeriod("this-month", now)).toMatchObject({ fromDate: "2026-08-01", toDate: "2026-08-28" });
  });

  it("changes the underlying records at inclusive period boundaries", () => {
    const records = [visit("1", "A", "2026-08-01"), visit("2", "A", "2026-08-24"), visit("3", "A", "2026-08-28"), visit("4", "A", "2026-08-29")];
    const now = new Date("2026-08-28T15:00:00.000Z");
    expect(filterVisitsForDashboardPeriod(records, resolveDashboardPeriod("today", now)).map((v) => v.id)).toEqual(["3"]);
    expect(filterVisitsForDashboardPeriod(records, resolveDashboardPeriod("this-week", now)).map((v) => v.id)).toEqual(["2", "3"]);
    expect(filterVisitsForDashboardPeriod(records, resolveDashboardPeriod("this-month", now)).map((v) => v.id)).toEqual(["1", "2", "3"]);
  });
});


describe("completed-visit predicate boundary", () => {
  it.each(["COMPLETED", "Completed", "completed", "  cOmPlEtEd  "])("preserves completed normalization for %j", status => expect(isCompletedVisit({ status })).toBe(true));
  it.each([{}, { status: undefined }, { status: "" }, { status: "IN_PROGRESS" }, { status: "CANCELLED" }, null, undefined])("excludes missing and non-completed status %j", value => expect(isCompletedVisit(value)).toBe(false));
  it("filters pharmacy visits without changing order or the domain schema", () => {
    const completed = { id: "DONE", status: " Completed " } as unknown as PharmacyVisit;
    const missing = { id: "MISSING" } as PharmacyVisit;
    const pending = { id: "PENDING", status: "IN_PROGRESS" } as unknown as PharmacyVisit;
    expect(completedPharmacyVisits([missing, completed, pending])).toEqual([completed]);
  });
});
