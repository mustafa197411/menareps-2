import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { CANONICAL_USER_ROLES, Role, type User } from "../types";
import { canAccessGroup, canAccessView } from "./userPolicyEngine";
import {
  APPLICATION_MODULES,
  APPLICATION_VIEW_FAMILIES,
  CANONICAL_ROLE_ACCESS_BASELINE,
  LEGACY_OR_NONCANONICAL_ROLES,
  getCanonicalRoleAccessRecord,
} from "./canonicalRoleAccessBaseline";

const user = (role: Role): User => ({ id: `AP2N-${role}`, name: role, email: "ap2n@example.invalid", role, active: true } as User);

describe("AP2N recovered authorization characterization", () => {
  it("records every canonical role exactly once", () => {
    expect(Object.keys(CANONICAL_ROLE_ACCESS_BASELINE).sort()).toEqual([...CANONICAL_USER_ROLES].sort());
    for (const role of CANONICAL_USER_ROLES) {
      expect(CANONICAL_ROLE_ACCESS_BASELINE[role].role).toBe(role);
      expect(Object.keys(CANONICAL_ROLE_ACCESS_BASELINE[role].modules).sort()).toEqual([...APPLICATION_MODULES].sort());
    }
  });

  it("assigns every module one explicit view family", () => {
    expect(Object.keys(APPLICATION_VIEW_FAMILIES).sort()).toEqual([...APPLICATION_MODULES].sort());
    for (const module of APPLICATION_MODULES) {
      expect(APPLICATION_VIEW_FAMILIES[module].module).toBe(module);
    }
  });

  it("identifies enum roles that the recovered canonical inventory excludes", () => {
    expect([...LEGACY_OR_NONCANONICAL_ROLES].sort()).toEqual([
      Role.MARKETING,
      Role.SYSTEM_ADMINISTRATOR,
      Role.WAREHOUSE_INVENTORY,
    ].sort());
    expect(getCanonicalRoleAccessRecord(Role.SYSTEM_ADMINISTRATOR)).toBeNull();
  });

  it.each([
    [Role.MEDICAL_REP, "field-operations", true],
    [Role.MEDICAL_REP, "pharmacies", false],
    [Role.SALES_REP, "field-operations", false],
    [Role.SALES_REP, "pharmacies", true],
    [Role.FINANCE, "finance", true],
    [Role.FINANCE, "administration", false],
    [Role.PRODUCT_MANAGER, "products", true],
    [Role.PRODUCT_MANAGER, "analytics", false],
    [Role.ORDER_OPS_OFFICER, "operations", true],
    [Role.ORDER_OPS_OFFICER, "field-operations", false],
  ] as const)("characterizes %s module %s as %s", (role, module, expected) => {
    expect(canAccessGroup(user(role), module)).toBe(expected);
    expect(CANONICAL_ROLE_ACCESS_BASELINE[role].modules[module]).toBe(expected ? "ALLOW" : "DENY");
  });

  it("captures current administrative and global exceptions explicitly", () => {
    expect(CANONICAL_ROLE_ACCESS_BASELINE[Role.SUPER_ADMIN].administrativeGlobalAccess).toBe(true);
    expect(CANONICAL_ROLE_ACCESS_BASELINE[Role.ADMIN].administrativeGlobalAccess).toBe(true);
    expect(CANONICAL_ROLE_ACCESS_BASELINE[Role.GENERAL_MANAGER].routeExceptions["admin-user-management"]).toBe("ALLOW");
    expect(CANONICAL_ROLE_ACCESS_BASELINE[Role.GENERAL_MANAGER].routeExceptions["admin-*"]).toBe("DENY");
    expect(canAccessView(user(Role.GENERAL_MANAGER), "admin-user-management")).toBe(true);
    expect(canAccessView(user(Role.GENERAL_MANAGER), "admin-role-settings")).toBe(false);
  });

  it("characterizes representative direct-route denials independently of sidebar visibility", () => {
    expect(canAccessGroup(user(Role.MEDICAL_REP), "pharmacies")).toBe(false);
    expect(canAccessView(user(Role.MEDICAL_REP), "pharmacies-list")).toBe(false);
    expect(canAccessGroup(user(Role.SALES_REP), "field-operations")).toBe(false);
    expect(canAccessView(user(Role.SALES_REP), "field-physician-list")).toBe(false);
  });

  it("keeps sidebar hiding separate from route and data authorization", () => {
    const sidebar = fs.readFileSync("src/components/Sidebar.tsx", "utf8");
    const router = fs.readFileSync("src/components/SidebarPageRouter.tsx", "utf8");
    const governance = fs.readFileSync("src/lib/accessGovernance.ts", "utf8");
    expect(sidebar).toContain("canAccessCanonicalModule(accessContext, group.id)");
    expect(sidebar).toContain("canAccessCanonicalView(accessContext, childId)");
    expect(router).toContain("if (!isViewAllowed(activeView))");
    expect(router).toContain('id="access-denied-view"');
    expect(governance).toContain("navigationDoesNotAuthorizeData");
  });

  it("characterizes route restoration as permission checked", () => {
    const app = fs.readFileSync("src/App.tsx", "utf8");
    expect(app).toContain("resolveAuthorizedRestoredView(");
    expect(app).toContain("rolePermissions: permissionsMatrix[profileData.role]");
  });

  it("records dynamic and specialized modules as conditional instead of widening them", () => {
    expect(CANONICAL_ROLE_ACCESS_BASELINE[Role.MEDICAL_REP].modules.samples).toBe("CONDITIONAL");
    expect(CANONICAL_ROLE_ACCESS_BASELINE[Role.MEDICAL_REP].modules.marketing).toBe("CONDITIONAL");
    expect(CANONICAL_ROLE_ACCESS_BASELINE[Role.SALES_REP].modules["sales-and-orders"]).toBe("CONDITIONAL");
  });
});
