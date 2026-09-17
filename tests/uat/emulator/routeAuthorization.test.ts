import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canAccessGroup, canAccessView } from "../../../src/lib/userPolicyEngine";
import { Role, type Permissions, type User } from "../../../src/types";
import { UAT_IDENTITIES } from "./roles";

function user(role: Role, uid: string): User {
  return { id: uid, name: `Synthetic ${role}`, email: `${uid}@menareps-uat.test`, role, active: true, status: "Active", region: "WEST", territory: "WEST-A1" } as User;
}

describe("MENAREPS direct-view authorization", () => {
  it.each(UAT_IDENTITIES)("evaluates $role from canonical role rather than identity", identity => {
    const first = canAccessView(user(identity.role, identity.uid), "productivity-workday");
    const second = canAccessView(user(identity.role, `${identity.uid}-second`), "productivity-workday");
    expect(first).toBe(second);
  });

  it("denies representative direct Administration routes", () => {
    for (const role of [Role.MEDICAL_REP, Role.SALES_REP]) {
      expect(canAccessView(user(role, `uat-${role}`), "admin-role-settings")).toBe(false);
      expect(canAccessView(user(role, `uat-${role}`), "admin-location")).toBe(false);
      expect(canAccessView(user(role, `uat-${role}`), "admin-order-workflow-settings")).toBe(false);
    }

    const salesRepA = user(Role.SALES_REP, "uat-sales-rep-a");
    const salesRepB = user(Role.SALES_REP, "uat-sales-rep-b");
    expect(canAccessView(salesRepA, "admin-order-workflow-settings")).toBe(false);
    expect(canAccessView(salesRepB, "admin-order-workflow-settings")).toBe(false);
    expect(canAccessView(salesRepA, "admin-order-workflow-settings", { view: true } as Permissions)).toBe(false);
    expect(canAccessView(user(Role.SUPER_ADMIN, "uat-super-admin"), "admin-order-workflow-settings")).toBe(true);
    expect(canAccessView(user(Role.ADMIN, "uat-admin"), "admin-order-workflow-settings")).toBe(true);
    expect(canAccessView(user(Role.GENERAL_MANAGER, "uat-general-manager"), "admin-order-workflow-settings")).toBe(false);
    expect(canAccessView(salesRepA, "sales-orders")).toBe(true);
    expect(canAccessGroup(salesRepA, "administration")).toBe(false);

    const sidebar = readFileSync("src/components/Sidebar.tsx", "utf8");
    const router = readFileSync("src/components/SidebarPageRouter.tsx", "utf8");
    expect(sidebar).toContain("return canAccessCanonicalModule(accessContext, group.id)");
    const registry = readFileSync("src/lib/sidebarNavigationRegistry.ts", "utf8");
    expect(sidebar).toContain("sidebarNavigationRegistryForRole");
    expect(registry).toContain('group("administration"');
    expect(router).toContain("if (!isViewAllowed(activeView))");
    expect(router).toContain('id="access-denied-view"');
  });

  it("keeps Medical Representative My Workday available", () => {
    expect(canAccessView(user(Role.MEDICAL_REP, "uat-medical-rep"), "productivity-workday")).toBe(true);
  });
});
