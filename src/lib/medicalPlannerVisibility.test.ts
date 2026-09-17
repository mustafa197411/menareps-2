import { describe, expect, it } from "vitest";
import { resolveAuthorizedMedicalPlannerRepresentatives } from "./medicalPlannerVisibility";
import type { OperationalScopeSessionState } from "./operationalScopeSession";

const actor = { id: "ACTOR" } as any;
const users = [{ id: "ACTOR" }, { id: "DIRECT" }, { id: "RECURSIVE" }, { id: "UNRELATED" }] as any[];
const ready = (overrides: Record<string, any> = {}): OperationalScopeSessionState => ({
  status: "READY",
  actorUid: "ACTOR",
  scope: {
    authorized: true,
    actorUid: "ACTOR",
    role: "SYNTHETIC_MANAGER",
    subjectUids: ["ACTOR", "DIRECT", "RECURSIVE"],
    authorizedRepresentativeUids: ["DIRECT", "RECURSIVE"],
    areaIds: ["CROSS_CITY_AREA"],
    productIds: ["DESCENDANT_PRODUCT"],
    productGroupIds: [], countryIds: [], regionIds: [], districtIds: [], cityIds: [],
    queryPlan: { denyAll: false, areaIdChunks: [], subjectUidChunks: [], productIdChunks: [], requiresPostFilter: true },
    diagnostics: { excludedAssignmentIds: [], malformedAssignmentIds: [], outsideBoundaryAssignmentIds: [] },
    ...overrides,
  } as any,
});

describe("Fix 5B.3B-1 Medical Planner representative visibility", () => {
  it("uses the canonical direct and recursive representative intersection", () => {
    expect(resolveAuthorizedMedicalPlannerRepresentatives(actor, users, ready()).map(user => user.id)).toEqual(["DIRECT", "RECURSIVE"]);
  });
  it("does not grant an unrelated representative from display metadata", () => {
    expect(resolveAuthorizedMedicalPlannerRepresentatives(actor, users, ready()).map(user => user.id)).not.toContain("UNRELATED");
  });
  it.each(["UNINITIALIZED", "LOADING", "DENIED", "ERROR"] as const)("fails closed without a READY session: %s", (status) => {
    expect(resolveAuthorizedMedicalPlannerRepresentatives(actor, users, { status, actorUid: "ACTOR", scope: null })).toEqual([]);
  });
  it("fails closed on actor mismatch, denial, or denyAll", () => {
    expect(resolveAuthorizedMedicalPlannerRepresentatives(actor, users, { ...ready(), actorUid: "OTHER" })).toEqual([]);
    expect(resolveAuthorizedMedicalPlannerRepresentatives(actor, users, ready({ authorized: false }))).toEqual([]);
    expect(resolveAuthorizedMedicalPlannerRepresentatives(actor, users, ready({ queryPlan: { denyAll: true } }))).toEqual([]);
  });
  it("does not consult manager city, area, territory, or product fields", () => {
    const manager = { id: "ACTOR", city: "UNRELATED_CITY", areaIds: ["UNRELATED_AREA"], products: ["UNRELATED_PRODUCT"] } as any;
    expect(resolveAuthorizedMedicalPlannerRepresentatives(manager, users, ready()).map(user => user.id)).toEqual(["DIRECT", "RECURSIVE"]);
  });
});
