import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { Role } from "../types";
import { defaultNavigationVisible, defaultScopeModeForRole, navigationDoesNotAuthorizeData, resolveNavigationVisibility, scopeDescriptorFromOperationalScope } from "./accessGovernance";

describe("WP77D unified navigation, capability and operational scope registry", () => {
  it.each([Role.GENERAL_MANAGER, Role.REGIONAL_MANAGER, Role.COUNTRY_MANAGER, Role.SALES_MARKETING_MANAGER, Role.MARKETING_MANAGER, Role.PRODUCT_MANAGER])("supports Field Operations and Pharmacies for %s", role => { expect(defaultNavigationVisible(role, "FIELD_OPERATIONS")).toBe(true); expect(defaultNavigationVisible(role, "PHARMACIES")).toBe(true); });
  it("supports scoped Pharmacy navigation for Medical Supervisor", () => expect(defaultNavigationVisible(Role.MEDICAL_SUPERVISOR, "PHARMACIES")).toBe(true));
  it("aligns Medical Manager Field navigation with the canonical AP2N module baseline", () => {
    expect(defaultNavigationVisible(Role.MEDICAL_MANAGER, "FIELD_OPERATIONS")).toBe(true);
    expect(defaultNavigationVisible(Role.MEDICAL_MANAGER, "PHARMACIES")).toBe(false);
  });
  it.each([Role.SALES_MANAGER, Role.SALES_SUPERVISOR])("does not infer Field Operations from manager title for %s", role => expect(defaultNavigationVisible(role, "FIELD_OPERATIONS")).toBe(false));
  it.each([Role.ORDER_OPS_OFFICER, Role.FINANCE, Role.TREASURY_OFFICER, Role.STORE_MANAGER, Role.DELIVERY_OFFICER])("keeps operational specialist %s out of Field Operations and Pharmacies", role => { expect(defaultNavigationVisible(role, "FIELD_OPERATIONS")).toBe(false); expect(defaultNavigationVisible(role, "PHARMACIES")).toBe(false); });
  it("allows an explicit active navigation record without granting data", () => { expect(resolveNavigationVisibility(Role.SALES_MANAGER, "FIELD_OPERATIONS", { role: Role.SALES_MANAGER, active: true, dataScopeMode: "GEOGRAPHY", navigation: [{ module: "FIELD_OPERATIONS", visible: true }], capabilities: [] })).toBe(true); expect(navigationDoesNotAuthorizeData(true, { mode: "GEOGRAPHY", subjectUids: [], areaIds: [], productIds: [], authorized: false })).toBe(false); });
  it("derives data descriptors only from backend operational scope", () => { const descriptor = scopeDescriptorFromOperationalScope({ authorized: true, actorUid: "U", role: Role.MEDICAL_SUPERVISOR, boundaryKind: "AREA", subjectMode: "HIERARCHY", subjectUids: ["U", "R"], countryIds: ["C"], regionIds: ["D"], districtIds: ["D"], cityIds: ["CT"], areaIds: ["A"], productIds: ["P"], productGroupIds: [], queryPlan: { denyAll: false, areaIdChunks: [["A"]], subjectUidChunks: [["U", "R"]], productIdChunks: [["P"]], requiresPostFilter: true }, diagnostics: { excludedAssignmentIds: [], malformedAssignmentIds: [], outsideBoundaryAssignmentIds: [] } }); expect(descriptor).toMatchObject({ mode: "DESCENDANTS", subjectUids: ["U", "R"], authorized: true }); });
  it("maps global and representative modes explicitly", () => { expect(defaultScopeModeForRole(Role.ADMIN)).toBe("ORGANIZATION"); expect(defaultScopeModeForRole(Role.MEDICAL_REP)).toBe("SELF"); });
  it("preserves the WP76J server-scoped visit query and approved roles", () => { const source = fs.readFileSync(new URL("../../server/physicianVisitReadService.ts", import.meta.url), "utf8"); expect(source).toContain('"Super Admin"'); expect(source).toContain('"Admin"'); expect(source).toContain('"Medical Supervisor"'); expect(source).toContain('"Medical Representative"'); expect(source).toContain('.where("repId", "in", subjects)'); });
});
