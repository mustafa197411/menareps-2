import fs from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

describe("WP77 operational stabilization architecture", () => {
  it("contains no identity-specific production authorization exceptions", () => {
    const rules = read("../firestore.rules"); const storageRules = read("../storage.rules"); const visitFlag = read("./features/pharmacyVisit/config/pharmacyVisitConfig.ts");
    expect(rules.slice(rules.indexOf("function isAdmin()"), rules.indexOf("function isRep()"))).not.toMatch(/@[a-z0-9.-]+/i);
    expect(storageRules).not.toMatch(/GQynj6LObmfQPz6PbNR9poANfXv1|shwayat\.mustafa@gmail\.com|admin\.\*@menareps/i);
    expect(storageRules).toContain("allow read: if isAuthenticated()");
    expect(storageRules).toContain("allow create, update, delete: if false");
    expect(visitFlag).not.toContain("pilotUids");
    expect(visitFlag).toContain("PHARMACY_VISIT_V2_CONFIG.enabled");
    expect(visitFlag).not.toContain("cQt7jjLOaHPgBmGCWzdjZm3pojo2");
  });

  it("persists canonical commercial scope identity on new pharmacy orders", () => {
    const creation = read("../server/pharmacyOrderCreateService.ts");
    for (const field of ["const areaId = text(pharmacy.areaId)", "const countryId = text(area.countryId)", "marketId: text(market.marketId)", "salesRepUid: actorUid", "representativeUid: actorUid"]) expect(creation).toContain(field);
    expect(creation).toContain("resolveOperationalScopeForActor");
  });

  it("uses backend-scoped offers and preserves a visible error state", () => {
    const service = read("./features/pharmacyVisit/services/offerService.ts"); const step = read("./features/pharmacyVisit/steps/Step3ApplyOffers.tsx");
    expect(service).toContain('/api/pharmacy-offers/scoped-query'); expect(service).not.toContain('collection(db, "offers")'); expect(step).toContain("setValidationError");
  });

  it("My Workday has no fixed operational attendance values and uses canonical APIs", () => {
    const workday = read("./components/productivity/MyWorkday.tsx");
    for (const fictional of ["9.1h", "June 2026", "Wajdi Qarba", ">23<", ">21<"]) expect(workday).not.toContain(fictional);
    expect(workday).toContain("fetchScopedTeamActivity"); expect(workday).toContain("mutateOwnAttendance"); expect(workday).toContain("mutateLeaveRequest");
  });

  it("planner does not reapply legacy name-based security filtering", () => {
    const planner = read("./components/MedicalPlanner.tsx"); expect(planner).not.toContain("filterBySecurity("); expect(planner).toContain("fetchAuthorizedMedicalPlanner");
  });

  it("exposes immutable runtime identity without inventing values", () => {
    const server = read("../server.ts"); const runtime = read("../server/releaseRuntime.ts");
    expect(server).toContain('/api/runtime-identity'); expect(server).toContain("resolveReleaseRuntime(process.env)");
    expect(runtime).toContain("env.K_REVISION?.trim()"); expect(runtime).toContain("env.MENAREPS_GIT_COMMIT");
  });

  it("does not allow production demo seeding, GPS simulation, or fictional analytics totals", () => {
    const sync = read("./lib/firebaseSync.ts"); const gps = read("./lib/gpsHardening.ts"); const analytics = read("./components/analytics/AnalyticsAIReports.tsx");
    expect(sync).toContain("import.meta.env.DEV &&"); expect(gps).toContain("if (!import.meta.env.DEV) return false");
    for (const fallback of ["totalVisits || 120", "totalCompleted || 110", ": 92", "|| 85", "|| 88"]) expect(analytics).not.toContain(fallback);
  });

  it("has no unconditional analytics view bypass or live fictional organization/planner route", () => {
    const analytics = read("./components/analytics/AnalyticsDashboard.tsx"); const router = read("./components/SidebarPageRouter.tsx");
    expect(analytics).not.toContain('includes("analytics") || true');
    expect(router).not.toContain('import OrganizationStructure from');
    expect(router).not.toContain('import SupervisorPlanningHub from');
  });

  it("uses the backend-authoritative commercial transition path for the live workflow modal", () => {
    const orders = read("./components/sales/SalesOrders.tsx");
    const start = orders.indexOf("const handleApplyTransition"); const end = orders.indexOf("const getThresholdValue", start);
    const liveTransition = orders.slice(start, end);
    expect(liveTransition).toContain("transitionCommercialOrder");
    expect(liveTransition).not.toContain("await saveOrder(");
  });
});
