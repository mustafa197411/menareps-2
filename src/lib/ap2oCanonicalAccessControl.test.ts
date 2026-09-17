import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { CANONICAL_USER_ROLES, Role, type Permissions, type User } from "../types";
import type { AccessGovernanceRecord, GovernedModule } from "./accessGovernance";
import {
  canAccessCanonicalModule,
  canAccessCanonicalView,
  evaluateModuleAccess,
  evaluateViewAccess,
  navigationDecisionDoesNotAuthorizeData,
  resolveAuthorizedRestoredView,
} from "./canonicalAccessControl";

const user = (role: Role | string): User => ({ id: `AP2O-${role}`, name: String(role), email: "ap2o@example.invalid", role: role as Role, active: true } as User);
const permission = (values: Partial<Permissions> = {}): Permissions => ({
  view: true, create: true, edit: true, delete: false, approve: false, export: true,
  import: false, assign: false, reassign: false, viewTeamData: false,
  viewNationalData: false, viewFinancialData: false, ...values,
});
const governance = (role: Role, module: GovernedModule, visible: boolean): AccessGovernanceRecord => ({
  role, active: true, dataScopeMode: "CUSTOM", capabilities: [], navigation: [{ module, visible }],
});

describe("AP2O canonical access control", () => {
  it.each(CANONICAL_USER_ROLES)("resolves canonical role %s deterministically", role => {
    const context = { user: user(role) };
    expect(evaluateModuleAccess(context, "dashboard")).toEqual(evaluateModuleAccess(context, "dashboard"));
  });

  it.each(["Unknown Role", Role.SYSTEM_ADMINISTRATOR, Role.MARKETING, Role.WAREHOUSE_INVENTORY])("fails closed for unknown or noncanonical role %s", role => {
    expect(canAccessCanonicalModule({ user: user(role) }, "administration")).toBe(false);
    expect(canAccessCanonicalView({ user: user(role) }, "admin-user-management")).toBe(false);
  });

  it("keeps AP2N DENY above dynamic or governance grants", () => {
    expect(canAccessCanonicalModule({ user: user(Role.MEDICAL_REP), rolePermissions: permission(), accessGovernance: governance(Role.MEDICAL_REP, "PHARMACIES", true) }, "pharmacies")).toBe(false);
  });

  it("preserves conditional Samples capabilities", () => {
    expect(canAccessCanonicalView({ user: user(Role.MEDICAL_REP), rolePermissions: permission({ sampleCapabilities: { VIEW_SAMPLE_INVENTORY: false } }) }, "samples-inventory")).toBe(false);
    expect(canAccessCanonicalView({ user: user(Role.MEDICAL_REP), rolePermissions: permission({ sampleCapabilities: { VIEW_SAMPLE_MANAGEMENT: true } }) }, "sample-management")).toBe(true);
  });

  it("preserves conditional Orders policy without overriding a baseline deny", () => {
    expect(canAccessCanonicalView({ user: user(Role.SALES_REP), rolePermissions: permission({ view: true }) }, "sales-orders")).toBe(true);
    expect(canAccessCanonicalView({ user: user(Role.SALES_REP), rolePermissions: permission({ view: false }) }, "sales-orders")).toBe(false);
    expect(canAccessCanonicalView({ user: user(Role.FINANCE), rolePermissions: permission({ view: true }) }, "sales-orders")).toBe(false);
  });

  it("preserves conditional Marketing Request capabilities", () => {
    expect(canAccessCanonicalView({ user: user(Role.MEDICAL_REP), rolePermissions: permission({ create: true }) }, "marketing-my-requests")).toBe(true);
    expect(canAccessCanonicalView({ user: user(Role.MEDICAL_REP), rolePermissions: permission({ view: false, create: true }) }, "marketing-my-requests")).toBe(false);
    expect(canAccessCanonicalView({ user: user(Role.MEDICAL_REP), rolePermissions: permission({ create: true }) }, "marketing-settings")).toBe(false);
  });

  it("applies recovered dynamic productivity restriction", () => {
    expect(canAccessCanonicalView({ user: user(Role.MEDICAL_REP), rolePermissions: permission({ view: false }) }, "productivity-workday")).toBe(false);
  });

  it("keeps sidebar modules and direct views on one evaluator", () => {
    const context = { user: user(Role.SALES_REP), rolePermissions: permission() };
    expect(canAccessCanonicalModule(context, "pharmacies")).toBe(true);
    expect(canAccessCanonicalView(context, "pharmacies-list")).toBe(true);
    expect(canAccessCanonicalModule(context, "field-operations")).toBe(false);
    expect(canAccessCanonicalView(context, "field-physician-list")).toBe(false);
  });

  it("preserves shared visit review through either authorized module path", () => {
    expect(canAccessCanonicalView({ user: user(Role.MEDICAL_REP) }, "visits-review")).toBe(true);
    expect(canAccessCanonicalView({ user: user(Role.SALES_REP) }, "visits-review")).toBe(true);
    expect(canAccessCanonicalView({ user: user(Role.FINANCE) }, "visits-review")).toBe(false);
  });

  it("rejects unknown direct routes", () => expect(evaluateViewAccess({ user: user(Role.ADMIN) }, "unregistered-privileged-view").reason).toBe("UNKNOWN_VIEW"));

  it("rejects restored routes and selects only an authorized fallback", () => {
    const context = { user: user(Role.FINANCE), rolePermissions: permission() };
    expect(resolveAuthorizedRestoredView(context, "admin-user-management", ["pharmacies-list", "finance-balances", "dashboard"])).toBe("finance-balances");
    expect(resolveAuthorizedRestoredView({ user: user("Unknown") }, "admin-user-management", ["dashboard"])).toBeNull();
  });

  it("makes Super Admin and Admin global behavior explicit", () => {
    for (const role of [Role.SUPER_ADMIN, Role.ADMIN]) expect(canAccessCanonicalView({ user: user(role) }, "admin-role-settings")).toBe(true);
  });

  it("preserves General Manager administration exceptions", () => {
    expect(canAccessCanonicalView({ user: user(Role.GENERAL_MANAGER) }, "admin-user-management")).toBe(true);
    expect(canAccessCanonicalView({ user: user(Role.GENERAL_MANAGER) }, "admin-role-settings")).toBe(false);
  });

  it("preserves representative isolation", () => {
    expect(canAccessCanonicalView({ user: user(Role.MEDICAL_REP) }, "pharmacies-list")).toBe(false);
    expect(canAccessCanonicalView({ user: user(Role.SALES_REP) }, "field-physician-list")).toBe(false);
  });

  it.each([Role.MEDICAL_REP, Role.SALES_REP])("denies supervisor operational routes but preserves Coaching Reports classification for %s", role => {
    const context = { user: user(role) };
    expect(canAccessCanonicalView(context, "supervision-planning")).toBe(false);
    expect(canAccessCanonicalView(context, "supervision-field-visits")).toBe(false);
    expect(canAccessCanonicalView(context, "supervision-visits")).toBe(false);
    expect(canAccessCanonicalView(context, "supervision-coaching-reports")).toBe(true);
  });

  it.each([Role.MEDICAL_SUPERVISOR, Role.SALES_SUPERVISOR])("retains supervisor operational routes for %s", role => {
    const context = { user: user(role) };
    expect(canAccessCanonicalView(context, "supervision-planning")).toBe(true);
    expect(canAccessCanonicalView(context, "supervision-field-visits")).toBe(true);
    expect(canAccessCanonicalView(context, "supervision-visits")).toBe(true);
  });

  it("allows Sales Supervisor Pharmacy navigation and profile access without a physician path", () => {
    const context = { user: user(Role.SALES_SUPERVISOR) };
    expect(canAccessCanonicalModule(context, "pharmacies")).toBe(true);
    expect(canAccessCanonicalView(context, "pharmacies-list")).toBe(true);
    expect(canAccessCanonicalView(context, "field-physician-list")).toBe(false);
  });

  it("allows Medical Supervisor only the read-only Pharmacy list/profile route", () => {
    const context = { user: user(Role.MEDICAL_SUPERVISOR) };
    expect(canAccessCanonicalModule(context, "pharmacies")).toBe(false);
    expect(canAccessCanonicalView(context, "pharmacies-list")).toBe(true);
    expect(canAccessCanonicalView(context, "pharmacies-pharmacy-visit")).toBe(false);
    expect(canAccessCanonicalView(context, "pharmacies-sales-planner")).toBe(false);
    expect(canAccessCanonicalView(context, "sales-orders")).toBe(false);
    expect(canAccessCanonicalView(context, "payment-collection")).toBe(false);
    expect(fs.readFileSync("src/components/Sidebar.tsx", "utf8")).toContain("group.children?.some(child => canAccessCanonicalView(accessContext, child.id))");
  });

  it("keeps Medical Manager Sidebar and direct Field-route decisions in parity", () => {
    const context = { user: user(Role.MEDICAL_MANAGER) };
    expect(canAccessCanonicalModule(context, "field-operations")).toBe(true);
    expect(canAccessCanonicalView(context, "field-physician-list")).toBe(true);
    expect(canAccessCanonicalView(context, "marketing-campaigns")).toBe(false);
    expect(canAccessCanonicalView(context, "admin-user-management")).toBe(false);
  });

  it.each([
    [Role.FINANCE, "finance-balances", true], [Role.FINANCE, "admin-role-settings", false],
    [Role.PRODUCT_MANAGER, "products-list", true], [Role.PRODUCT_MANAGER, "analytics-reports", false],
    [Role.WAREHOUSE_MANAGER, "inventory-dashboard", true], [Role.STORE_MANAGER, "field-physician-list", false],
    [Role.DELIVERY_OFFICER, "operations-order-operations", true], [Role.ORDER_OPS_OFFICER, "finance-balances", false],
  ] as const)("enforces %s boundary for %s", (role, view, expected) => expect(canAccessCanonicalView({ user: user(role) }, view)).toBe(expected));

  it("applies accessGovernance as a restriction, never a baseline grant", () => {
    expect(canAccessCanonicalModule({ user: user(Role.MEDICAL_REP), accessGovernance: governance(Role.MEDICAL_REP, "FIELD_OPERATIONS", false) }, "field-operations")).toBe(false);
    expect(canAccessCanonicalModule({ user: user(Role.SALES_REP), accessGovernance: governance(Role.SALES_REP, "FIELD_OPERATIONS", true) }, "field-operations")).toBe(false);
  });

  it("does not turn navigation into data authorization", () => {
    const decision = evaluateModuleAccess({ user: user(Role.ADMIN) }, "dashboard");
    expect(decision.allowed).toBe(true);
    expect(navigationDecisionDoesNotAuthorizeData(decision)).toBe(false);
  });

  it("migrates sidebar, router, and restoration to the shared evaluator", () => {
    const sidebar = fs.readFileSync("src/components/Sidebar.tsx", "utf8");
    const router = fs.readFileSync("src/components/SidebarPageRouter.tsx", "utf8");
    const app = fs.readFileSync("src/App.tsx", "utf8");
    expect(sidebar).toContain("canAccessCanonicalModule");
    expect(sidebar).toContain("canAccessCanonicalView");
    expect(router).toContain("canAccessCanonicalView");
    expect(router).toContain('id="access-denied-view"');
    expect(app).toContain("resolveAuthorizedRestoredView");
    expect(app).toContain("accessGovernanceMatrix");
  });
});
