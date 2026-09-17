import { describe, expect, it } from "vitest";
import fs from "node:fs";
import {
  assertMedicalPlannerTargetAuthorization,
  MedicalPlannerScopeError,
  parseMedicalPlannerActionRequest,
  parseMedicalPlannerReadRequest,
  reconcileSavedWeek,
  visiblePlannerVisit,
} from "./medicalPlannerScopeService";

const scope = (overrides: Record<string, any> = {}) => ({
  authorized: true,
  actorUid: "ACTOR",
  role: "SYNTHETIC",
  subjectMode: "HIERARCHY",
  subjectUids: ["ACTOR", "DIRECT", "RECURSIVE"],
  authorizedRepresentativeUids: ["DIRECT", "RECURSIVE"],
  countryIds: [], regionIds: [], districtIds: [], cityIds: [],
  areaIds: ["DESCENDANT_AREA"], productIds: ["DESCENDANT_PRODUCT"], productGroupIds: ["DESCENDANT_GROUP"],
  queryPlan: { denyAll: false, areaIdChunks: [], subjectUidChunks: [], productIdChunks: [], requiresPostFilter: true },
  diagnostics: { excludedAssignmentIds: [], malformedAssignmentIds: [], outsideBoundaryAssignmentIds: [] },
  ...overrides,
} as any);
const targetScope = (uid = "DIRECT", overrides: Record<string, any> = {}) => scope({
  actorUid: uid,
  subjectMode: "SELF",
  subjectUids: [uid],
  authorizedRepresentativeUids: [uid],
  ...overrides,
});
const target = (id = "DIRECT", overrides: Record<string, any> = {}) => ({ id, role: "Medical Representative", active: true, city: "CROSS_CITY", ...overrides });
const errorCode = (fn: () => void) => {
  try { fn(); return "PASS"; } catch (error) { return (error as MedicalPlannerScopeError).code; }
};

describe("Fix 5B.3B-1 canonical Medical Planner target authorization", () => {
  it("authorizes direct and recursively authorized representatives across cities", () => {
    expect(() => assertMedicalPlannerTargetAuthorization("ACTOR", scope(), target("DIRECT"), targetScope("DIRECT"))).not.toThrow();
    expect(() => assertMedicalPlannerTargetAuthorization("ACTOR", scope(), target("RECURSIVE"), targetScope("RECURSIVE"))).not.toThrow();
  });
  it("authorizes representative self behavior when canonical scope explicitly includes self", () => {
    const selfScope = scope({ subjectMode: "SELF", subjectUids: ["ACTOR"], authorizedRepresentativeUids: ["ACTOR"] });
    expect(() => assertMedicalPlannerTargetAuthorization("ACTOR", selfScope, target("ACTOR"), targetScope("ACTOR"))).not.toThrow();
  });
  it("rejects unrelated and inactive representatives", () => {
    expect(errorCode(() => assertMedicalPlannerTargetAuthorization("ACTOR", scope(), target("UNRELATED"), targetScope("UNRELATED")))).toBe("PLANNER_REP_NOT_AUTHORIZED");
    expect(errorCode(() => assertMedicalPlannerTargetAuthorization("ACTOR", scope(), target("DIRECT", { active: false }), targetScope("DIRECT")))).toBe("PLANNER_REP_NOT_AUTHORIZED");
  });
  it("rejects actor mismatch, denied scope, and denyAll", () => {
    expect(errorCode(() => assertMedicalPlannerTargetAuthorization("ACTOR", scope({ actorUid: "OTHER" }), target(), targetScope()))).toBe("PLANNER_REP_NOT_AUTHORIZED");
    expect(errorCode(() => assertMedicalPlannerTargetAuthorization("ACTOR", scope({ authorized: false }), target(), targetScope()))).toBe("PLANNER_REP_NOT_AUTHORIZED");
    expect(errorCode(() => assertMedicalPlannerTargetAuthorization("ACTOR", scope({ queryPlan: { denyAll: true } }), target(), targetScope()))).toBe("PLANNER_REP_NOT_AUTHORIZED");
  });
  it("rejects a target whose canonical SELF scope is denied or mismatched", () => {
    expect(errorCode(() => assertMedicalPlannerTargetAuthorization("ACTOR", scope(), target(), targetScope("DIRECT", { authorized: false })))).toBe("PLANNER_REP_NOT_OPERATIONAL");
    expect(errorCode(() => assertMedicalPlannerTargetAuthorization("ACTOR", scope(), target(), targetScope("OTHER")))).toBe("PLANNER_REP_NOT_OPERATIONAL");
  });
  it("parses only canonical period reads and supported actions", () => {
    expect(parseMedicalPlannerReadRequest({ repId: "R", planningType: "weekly", period: "W" })).toEqual({ repId: "R", planningType: "weekly", period: "W" });
    expect(parseMedicalPlannerReadRequest({ repId: "", planningType: "weekly", period: "W" })).toBeNull();
    for (const action of ["REMOVE_VISIT", "CLEAR_PERIOD"] as const) {
      const parsed = parseMedicalPlannerActionRequest({ repId: "R", planningType: "monthly", period: "M", action, visitId: action === "REMOVE_VISIT" ? "V" : undefined });
      expect(parsed?.action).toBe(action);
    }
    expect(parseMedicalPlannerActionRequest({ repId: "R", planningType: "monthly", period: "M", action: "REMOVE_VISIT" })).toBeNull();
    expect(parseMedicalPlannerActionRequest({ repId: "R", planningType: "weekly", period: "2026-W35", action: "SAVE_WEEK", visitIds: ["V1", "V1", "V2"] })).toMatchObject({ action: "SAVE_WEEK", visitIds: ["V1", "V2"] });
    expect(parseMedicalPlannerActionRequest({ repId: "R", planningType: "monthly", period: "M", action: "SAVE_WEEK" })).toBeNull();
  });
  it("routes reads and every sensitive mutation through the shared canonical authorize boundary", () => {
    const service = fs.readFileSync(new URL("./medicalPlannerScopeService.ts", import.meta.url), "utf8");
    expect(service).toContain("const { targetRep, targetScope } = await authorize(actorUid, request.repId");
    expect(service).toContain("const { permissions } = await authorize(actorUid, request.repId");
    expect(service).toContain('db.collection("medicalPlannerVisits").where("repId", "==", request.repId)');
    expect(service).not.toContain('db.collection("medicalPlannerApprovals")');
    expect(service).toContain("PLANNER_OWNER_REQUIRED");
    expect(service).toContain("text(visit[periodField]) !== request.period");
  });
  it("uses canonical target areas and product assignments for physician eligibility", () => {
    const service = fs.readFileSync(new URL("./medicalPlannerScopeService.ts", import.meta.url), "utf8");
    expect(service).toContain("filterPhysiciansWithinOperationalScope([...physiciansById.values()], targetScope)");
    expect(service).not.toContain("targetRep.city");
    expect(service).not.toContain("targetRep.areaIds");
  });
  it("contains no production identity or resource allowlist", () => {
    const files = [
      "./medicalPlannerScopeService.ts",
      "../src/lib/medicalPlannerVisibility.ts",
    ].map(path => fs.readFileSync(new URL(path, import.meta.url), "utf8")).join("\n");
    expect(files).not.toMatch(/@esnad\.local|PROD-\d+|UID-[A-Za-z0-9]+|mspr/i);
  });
  it("reconstructs saved weeks, hides staged drafts, and reconciles Save Changes", () => {
    expect(visiblePlannerVisit({ planStatus: "SAVED" })).toBe(true);
    expect(visiblePlannerVisit({ planStatus: "DRAFT" })).toBe(false);
    expect(reconcileSavedWeek([{ id: "KEEP" }, { id: "REMOVE" }], ["KEEP", "ADD"].filter(id => id !== "ADD"))).toEqual({ saveIds: ["KEEP"], deleteIds: ["REMOVE"] });
    expect(() => reconcileSavedWeek([{ id: "KEEP" }], ["MISSING"])).toThrow("PLANNER_VISIT_NOT_FOUND");
  });
});
