import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { CANONICAL_USER_ROLES, Role, type User } from "../types";
import { evaluateModuleAccess, evaluateViewAccess } from "./canonicalAccessControl";
import { APPLICATION_MODULES } from "./canonicalRoleAccessBaseline";
import { canonicalViewId, normalizeNavigationRestrictions, validateNavigationRestrictions } from "./navigationRestrictionPolicy";
import { SIDEBAR_NAVIGATION_REGISTRY, sidebarNavigationRegistryForRole } from "./sidebarNavigationRegistry";
import { parseNavigationGovernanceMutation } from "../../server/navigationGovernanceMutationService";

const user = (role: Role | string): User => ({ id: `AP2R-${role}`, name: String(role), email: "ap2r@example.invalid", role: role as Role, active: true, territory: "", region: "" });
const governance = (role: Role, hiddenModules: any[] = [], hiddenViews: string[] = []) => ({ role, active: true, dataScopeMode: "CUSTOM" as const, navigation: [], capabilities: [], navigationRestrictions: { hiddenModules, hiddenViews } });

describe("AP2R canonical Role Sidebar Settings", () => {
  it("keeps Role Sidebar Settings distinct from the RBAC Matrix", () => {
    const router = fs.readFileSync("src/components/SidebarPageRouter.tsx", "utf8");
    expect(router).toContain('case "admin-role-settings"');
    expect(router).toContain("<RoleSidebarSettings");
    expect(router).toContain("<Administration");
    expect(fs.readFileSync("src/components/Administration.tsx", "utf8")).toContain('initialTab = "rbac"');
  });

  it("preserves page authority for Admin and Super Admin only", () => {
    expect(evaluateViewAccess({ user: user(Role.SUPER_ADMIN) }, "admin-role-settings").allowed).toBe(true);
    expect(evaluateViewAccess({ user: user(Role.ADMIN) }, "admin-role-settings").allowed).toBe(true);
    expect(evaluateViewAccess({ user: user(Role.MEDICAL_REP) }, "admin-role-settings").allowed).toBe(false);
  });

  it("uses all 24 canonical roles and rejects unknown/legacy role mutations", () => {
    expect(CANONICAL_USER_ROLES).toHaveLength(24);
    for (const role of CANONICAL_USER_ROLES) expect(parseNavigationGovernanceMutation({ operation: "RESET", role })).toEqual({ operation: "RESET", role });
    expect(parseNavigationGovernanceMutation({ operation: "RESET", role: "Unknown" })).toBeNull();
    expect(parseNavigationGovernanceMutation({ operation: "RESET", role: Role.MARKETING })).toBeNull();
  });

  it("shares the production Sidebar registry and registers every module/view", () => {
    const sidebar = fs.readFileSync("src/components/Sidebar.tsx", "utf8");
    expect(sidebar).toContain("sidebarNavigationRegistryForRole(currentUser.role)");
    expect(SIDEBAR_NAVIGATION_REGISTRY.map(group => group.id)).toEqual(APPLICATION_MODULES);
    for (const group of SIDEBAR_NAVIGATION_REGISTRY) for (const child of group.children || []) expect(canonicalViewId(child.id)).not.toBeNull();
    expect(sidebarNavigationRegistryForRole(Role.FINANCE).find(group => group.id === "finance")?.children?.map(item => item.id)).toEqual(["finance-customer-status", "finance-balances", "finance-credit-monitoring"]);
  });

  it("cannot turn canonical DENY into ALLOW", () => {
    const denied = evaluateModuleAccess({ user: user(Role.MEDICAL_REP), accessGovernance: governance(Role.MEDICAL_REP) }, "finance");
    const attempted = evaluateModuleAccess({ user: user(Role.MEDICAL_REP), accessGovernance: { ...governance(Role.MEDICAL_REP), navigation: [{ module: "ADMINISTRATION", visible: true }] } }, "finance");
    expect(denied.reason).toBe("BASELINE_DENY");
    expect(attempted).toEqual(denied);
  });

  it("allows an upstream ALLOW to be restricted at module or exact-view level", () => {
    expect(evaluateModuleAccess({ user: user(Role.MEDICAL_REP), accessGovernance: governance(Role.MEDICAL_REP, ["products"]) }, "products").reason).toBe("GOVERNANCE_DENY");
    expect(evaluateViewAccess({ user: user(Role.MEDICAL_REP), accessGovernance: governance(Role.MEDICAL_REP, [], ["products-list"]) }, "products-list").reason).toBe("GOVERNANCE_DENY");
    expect(evaluateViewAccess({ user: user(Role.MEDICAL_REP), accessGovernance: governance(Role.MEDICAL_REP, [], ["products-list"]) }, "products-resource-center").allowed).toBe(true);
  });

  it("does not activate unrelated legacy governance fields to apply a restriction", () => {
    const record = { ...governance(Role.MEDICAL_REP, ["products"]), active: false, capabilities: [{ module: "ADMINISTRATION" as const, actions: { view: true } }] };
    expect(evaluateModuleAccess({ user: user(Role.MEDICAL_REP), accessGovernance: record }, "products").reason).toBe("GOVERNANCE_DENY");
    expect(evaluateModuleAccess({ user: user(Role.MEDICAL_REP), accessGovernance: record }, "administration").reason).toBe("BASELINE_DENY");
  });

  it("never converts CONDITIONAL into unconditional ALLOW", () => {
    const upstream = evaluateModuleAccess({ user: user(Role.MEDICAL_REP), accessGovernance: governance(Role.MEDICAL_REP) }, "samples");
    const restricted = evaluateModuleAccess({ user: user(Role.MEDICAL_REP), accessGovernance: governance(Role.MEDICAL_REP, ["samples"]) }, "samples");
    expect(upstream.baseline).toBe("CONDITIONAL");
    expect(restricted.baseline).toBe("CONDITIONAL");
    expect(restricted.allowed).toBe(false);
    expect(restricted.reason).toBe("GOVERNANCE_DENY");
  });

  it("normalizes aliases, rejects arbitrary IDs, and resets to no restrictions", () => {
    expect(normalizeNavigationRestrictions({ hiddenModules: ["products", "unknown"], hiddenViews: ["physicians", "fake"] })).toEqual({ hiddenModules: ["products"], hiddenViews: ["field-physician-list"] });
    expect(validateNavigationRestrictions({ hiddenModules: ["unknown"], hiddenViews: [] })).toBeNull();
    expect(validateNavigationRestrictions({ hiddenModules: [], hiddenViews: ["products-arbitrary-prefix-route"] })).toBeNull();
    expect(parseNavigationGovernanceMutation({ operation: "RESET", role: Role.MEDICAL_REP })).toEqual({ operation: "RESET", role: Role.MEDICAL_REP });
  });

  it("does not introduce user.sidebarVisibility into canonical settings or Sidebar", () => {
    const page = fs.readFileSync("src/components/RoleSidebarSettings.tsx", "utf8");
    const sidebar = fs.readFileSync("src/components/Sidebar.tsx", "utf8");
    expect(page).not.toContain("sidebarVisibility");
    expect(sidebar).not.toContain("sidebarVisibility");
  });
});
