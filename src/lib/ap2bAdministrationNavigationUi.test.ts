import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { Role } from "../types";
import { SIDEBAR_COMPATIBILITY_VIEW_IDS, SIDEBAR_NAVIGATION_REGISTRY, sidebarNavigationRegistryForRole } from "./sidebarNavigationRegistry";
import { canonicalViewId } from "./navigationRestrictionPolicy";

const router = fs.readFileSync("src/components/SidebarPageRouter.tsx", "utf8");
const administration = fs.readFileSync("src/components/Administration.tsx", "utf8");
const settings = fs.readFileSync("src/components/RoleSidebarSettings.tsx", "utf8");

describe("Prompt B Administration navigation and Role Sidebar Settings presentation", () => {
  it("keeps only the intentional direct Administration Sidebar entries", () => {
    const children = SIDEBAR_NAVIGATION_REGISTRY.find(group => group.id === "administration")?.children?.map(child => child.id);
    expect(children).toEqual([
      "admin-user-management",
      "admin-product-assignment-audit",
      "admin-role-settings",
      "admin-data-import",
    ]);
    expect(children).not.toContain("admin-location");
    expect(children).not.toContain("admin-order-workflow-settings");
  });

  it("keeps Location and Order Workflow router compatibility and Administration tabs", () => {
    expect(router).toContain('case "admin-location"');
    expect(router).toContain('case "admin-location-settings"');
    expect(router).toContain('initialTab="geography"');
    expect(router).toContain('case "admin-order-workflow-settings"');
    expect(router).toContain('initialTab="order-workflow"');
    expect(administration).toContain('setActiveTab("geography")');
    expect(administration).toContain("Location Management");
    expect(administration).toContain('setActiveTab("order-workflow")');
    expect(administration).toContain("Order Workflow");
    expect(SIDEBAR_COMPATIBILITY_VIEW_IDS).toEqual(["admin-location", "admin-order-workflow-settings"]);
    expect(canonicalViewId("admin-location")).toBe("admin-location");
    expect(canonicalViewId("admin-order-workflow-settings")).toBe("admin-order-workflow-settings");
  });

  it("preserves all intentional direct-entry router destinations", () => {
    for (const viewId of ["admin-user-management", "admin-product-assignment-audit", "admin-role-settings", "admin-data-import"]) {
      expect(router).toContain(`case "${viewId}"`);
    }
    expect(router).toContain('initialTab="product-audits"');
    expect(router).toContain("<UserManagement");
    expect(router).toContain("<RoleSidebarSettings");
    expect(router).toContain("<ImportModule");
  });

  it("places Template Catalog under Master Data exactly once without removing its route", () => {
    const parents = SIDEBAR_NAVIGATION_REGISTRY.filter(group => group.children?.some(child => child.id === "admin-template-catalog")).map(group => group.id);
    expect(parents).toEqual(["master-data"]);
    expect(router).toContain('case "admin-template-catalog"');
    expect(router).toContain("<TemplateCatalog");
  });

  it("continues to use the shared registry for every role", () => {
    expect(settings).toContain("sidebarNavigationRegistryForRole(selectedRole)");
    expect(sidebarNavigationRegistryForRole(Role.ADMIN)).toEqual(SIDEBAR_NAVIGATION_REGISTRY);
  });

  it("provides presentation-only search and status filtering", () => {
    expect(settings).toContain('useState("")');
    expect(settings).toContain('setQuery(event.target.value)');
    expect(settings).toContain('useState<StatusFilter>("all")');
    expect(settings).toContain('setStatusFilter(event.target.value as StatusFilter)');
    expect(settings).toContain("matchesFilter(child.decision, statusFilter)");
    expect(settings).toContain("moduleMatchesSearch");
  });

  it("uses a responsive 1/2/3-column card grid and compact child rows", () => {
    expect(settings).toContain("grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3");
    expect(settings).toContain("data-navigation-module");
    expect(settings).toContain("data-navigation-view");
    expect(settings).toContain("flex items-center gap-2 px-3 py-2");
  });

  it("derives conditional labels and preview content from existing evaluator decisions", () => {
    expect(settings).toContain('decision.allowed ? "Conditional — Currently Allowed" : "Conditional — Currently Denied"');
    expect(settings).toContain("evaluateModuleAccess(context, group.id)");
    expect(settings).toContain("evaluateViewAccess(context, child.id)");
    expect(settings).toContain("evaluatedRegistry.filter(group => group.decision.allowed)");
    expect(settings).toContain('role="dialog"');
  });

  it("retains the restriction-only mutation payload", () => {
    expect(settings).toContain('{ operation, role: selectedRole, ...(operation === "SAVE" ? { restrictions: draft } : {}) }');
    expect(settings).toContain("hiddenModules");
    expect(settings).toContain("hiddenViews");
    expect(settings).not.toContain("sidebarVisibility");
  });
});
