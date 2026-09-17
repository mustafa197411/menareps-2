import { describe, it, expect } from "vitest";
import {
  resolveCanonicalAccountState,
  getReadiness,
  canAccessGroup,
  validateManager
} from "./lib/userPolicyEngine";
import { User, Role, Permissions } from "./types";

describe("WP7.1C — Finance Officer Readiness & Listener Gating Tests", () => {
  // 1. resolveCanonicalAccountState tests
  it("1. resolveCanonicalAccountState resolves deleted: true when isDeleted === true", () => {
    const user: Partial<User> = {
      id: "u1",
      email: "fo@esand.local",
      isDeleted: true,
      active: true,
      status: "Active",
      employmentStatus: "Active"
    };
    const state = resolveCanonicalAccountState(user);
    expect(state.deleted).toBe(true);
    expect(state.operational).toBe(false);
    expect(state.reasons).toContain("ACCOUNT_DELETED");
  });

  it("2. resolveCanonicalAccountState resolves deleted: true when isDeleted === 'true'", () => {
    const user: Partial<User> = {
      id: "u1",
      email: "fo@esand.local",
      isDeleted: "true" as any,
      active: true
    };
    const state = resolveCanonicalAccountState(user);
    expect(state.deleted).toBe(true);
    expect(state.operational).toBe(false);
  });

  it("3. resolveCanonicalAccountState resolves deleted: true when status === 'Deleted'", () => {
    const user: Partial<User> = {
      id: "u1",
      email: "fo@esand.local",
      status: "Deleted",
      active: true
    };
    const state = resolveCanonicalAccountState(user);
    expect(state.deleted).toBe(true);
    expect(state.operational).toBe(false);
  });

  it("4. resolveCanonicalAccountState resolves terminated: true when employmentStatus === 'Terminated'", () => {
    const user: Partial<User> = {
      id: "u1",
      email: "fo@esand.local",
      employmentStatus: "Terminated",
      active: true
    };
    const state = resolveCanonicalAccountState(user);
    expect(state.terminated).toBe(true);
    expect(state.operational).toBe(false);
    expect(state.reasons).toContain("ACCOUNT_TERMINATED");
  });

  it("5. resolveCanonicalAccountState resolves suspended: true when employmentStatus === 'Suspended'", () => {
    const user: Partial<User> = {
      id: "u1",
      email: "fo@esand.local",
      employmentStatus: "Suspended",
      active: true
    };
    const state = resolveCanonicalAccountState(user);
    expect(state.suspended).toBe(true);
    expect(state.operational).toBe(false);
    expect(state.reasons).toContain("ACCOUNT_SUSPENDED");
  });

  it("6. resolveCanonicalAccountState resolves loginEnabled: false when loginAllowed === false", () => {
    const user: Partial<User> = {
      id: "u1",
      email: "fo@esand.local",
      loginAllowed: false,
      active: true
    };
    const state = resolveCanonicalAccountState(user);
    expect(state.loginEnabled).toBe(false);
    expect(state.operational).toBe(false);
    expect(state.reasons).toContain("LOGIN_DISABLED");
  });

  it("7. resolveCanonicalAccountState resolves operational: true for clean active profile", () => {
    const user: Partial<User> = {
      id: "B1LhUX154pSAa0zC4iVaHTxzHnO2",
      email: "fo@esand.local",
      isDeleted: false,
      active: true,
      status: "Active",
      employmentStatus: "Active",
      loginAllowed: true
    };
    const state = resolveCanonicalAccountState(user);
    expect(state.deleted).toBe(false);
    expect(state.terminated).toBe(false);
    expect(state.suspended).toBe(false);
    expect(state.loginEnabled).toBe(true);
    expect(state.employmentActive).toBe(true);
    expect(state.accountActive).toBe(true);
    expect(state.operational).toBe(true);
  });

  // 2. getReadiness tests
  it("8. getReadiness returns status: 'Terminated' when isDeleted: true", () => {
    const user: Partial<User> = {
      id: "u1",
      email: "fo@esand.local",
      role: Role.FINANCE,
      isDeleted: true
    };
    const readiness = getReadiness(user, []);
    expect(readiness.status).toBe("Terminated");
    expect(readiness.reasons).toContain("ACCOUNT_TERMINATED");
  });

  it("9. getReadiness returns status: 'Terminated' when employmentStatus: 'Terminated'", () => {
    const user: Partial<User> = {
      id: "u1",
      email: "fo@esand.local",
      role: Role.FINANCE,
      employmentStatus: "Terminated"
    };
    const readiness = getReadiness(user, []);
    expect(readiness.status).toBe("Terminated");
    expect(readiness.reasons).toContain("ACCOUNT_TERMINATED");
  });

  it("10. getReadiness returns status: 'Suspended' when employmentStatus: 'Suspended'", () => {
    const user: Partial<User> = {
      id: "u1",
      email: "fo@esand.local",
      role: Role.FINANCE,
      employmentStatus: "Suspended"
    };
    const readiness = getReadiness(user, []);
    expect(readiness.status).toBe("Suspended");
    expect(readiness.reasons).toContain("EMPLOYMENT_SUSPENDED");
  });

  it("11. getReadiness returns status: 'Blocked' when loginAllowed: false", () => {
    const user: Partial<User> = {
      id: "u1",
      email: "fo@esand.local",
      role: Role.FINANCE,
      loginAllowed: false
    };
    const readiness = getReadiness(user, []);
    expect(readiness.status).toBe("Blocked");
    expect(readiness.reasons).toContain("ACCOUNT_BLOCKED");
  });

  it("12. getReadiness returns status: 'Incomplete' with MANAGER_MISSING when manager is missing (NOT ACCOUNT_TERMINATED)", () => {
    const user: Partial<User> = {
      id: "u1",
      email: "fo@esand.local",
      role: Role.FINANCE,
      isDeleted: false,
      active: true,
      status: "Active",
      employmentStatus: "Active",
      loginAllowed: true,
      managerEmail: "unknown-manager@esand.local"
    };
    const readiness = getReadiness(user, []);
    expect(readiness.status).toBe("Incomplete");
    expect(readiness.reasons).toContain("MANAGER_MISSING");
    expect(readiness.status).not.toBe("Terminated");
  });

  it("13. getReadiness returns status: 'Operational' for valid active Finance Officer", () => {
    const manager: User = {
      id: "fm1",
      email: "fm@esand.local",
      role: Role.FINANCE_MANAGER,
      active: true,
      isDeleted: false,
      status: "Active",
      employmentStatus: "Active",
      loginAllowed: true,
      areaIds: [],
      products: [],
      sidebarVisibility: [],
      country: "Libya"
    } as any;

    const foUser: Partial<User> = {
      id: "B1LhUX154pSAa0zC4iVaHTxzHnO2",
      email: "fo@esand.local",
      role: Role.FINANCE,
      managerId: "fm1",
      managerEmail: "fm@esand.local",
      isDeleted: false,
      active: true,
      status: "Active",
      employmentStatus: "Active",
      loginAllowed: true
    };

    const readiness = getReadiness(foUser, [manager]);
    expect(readiness.status).toBe("Operational");
    expect(readiness.reasons).toContain("COMPLETE");
  });

  it("14. getReadiness returns status: 'Operational' for valid active Order Operations Officer", () => {
    const manager: User = {
      id: "ops-mgr",
      email: "ops-mgr@esand.local",
      role: Role.GENERAL_MANAGER,
      active: true,
      isDeleted: false,
      status: "Active",
      employmentStatus: "Active",
      loginAllowed: true,
      areaIds: [],
      products: [],
      sidebarVisibility: [],
      country: "Libya"
    } as any;

    const oooUser: Partial<User> = {
      id: "MbE6J5DfRpkZ39M16UeO",
      email: "ooo@esand.local",
      role: Role.ORDER_OPS_OFFICER,
      managerId: "ops-mgr",
      isDeleted: false,
      active: true,
      status: "Active",
      employmentStatus: "Active",
      loginAllowed: true
    };

    const readiness = getReadiness(oooUser, [manager]);
    expect(readiness.status).toBe("Operational");
    expect(readiness.reasons).toContain("COMPLETE");
  });

  // 3. Listener Gating & Scope
  it("15. Non-operational Finance Officer state blocks operational CRM listeners", () => {
    const blockedUser: Partial<User> = {
      id: "u1",
      email: "fo@esand.local",
      role: Role.FINANCE,
      loginAllowed: false
    };

    const accountState = resolveCanonicalAccountState(blockedUser);
    expect(accountState.operational).toBe(false);

    const gateLog = {
      uid: blockedUser.id,
      role: blockedUser.role,
      operational: accountState.operational,
      listenersAttempted: ["physicians", "pharmacies", "userTerritoryAssignments"],
      listenersBlocked: ["physicians", "pharmacies", "userTerritoryAssignments"],
      gateCondition: "isOperational === false"
    };

    expect(gateLog.operational).toBe(false);
    expect(gateLog.listenersBlocked.length).toBe(3);
  });

  it("16. Finance Officer role does not require territory or product assignments to be operational", () => {
    const manager: User = {
      id: "fm1",
      email: "fm@esand.local",
      role: Role.FINANCE_MANAGER,
      active: true,
      isDeleted: false
    } as any;

    const foUser: Partial<User> = {
      id: "fo1",
      email: "fo@esand.local",
      role: Role.FINANCE,
      managerId: "fm1",
      areaIds: [],
      products: [],
      isDeleted: false,
      active: true,
      loginAllowed: true
    };

    const readiness = getReadiness(foUser, [manager]);
    expect(readiness.status).toBe("Operational");
    expect(readiness.reasons).not.toContain("AREA_ASSIGNMENT_MISSING");
    expect(readiness.reasons).not.toContain("PRODUCT_ASSIGNMENT_MISSING");
  });

  it("17. Order Operations Officer role does not require territory or product assignments to be operational", () => {
    const manager: User = {
      id: "mgr1",
      email: "mgr1@esand.local",
      role: Role.GENERAL_MANAGER,
      active: true,
      isDeleted: false
    } as any;

    const oooUser: Partial<User> = {
      id: "ooo1",
      email: "ooo@esand.local",
      role: Role.ORDER_OPS_OFFICER,
      managerId: "mgr1",
      areaIds: [],
      products: [],
      isDeleted: false,
      active: true,
      loginAllowed: true
    };

    const readiness = getReadiness(oooUser, [manager]);
    expect(readiness.status).toBe("Operational");
    expect(readiness.reasons).not.toContain("AREA_ASSIGNMENT_MISSING");
    expect(readiness.reasons).not.toContain("PRODUCT_ASSIGNMENT_MISSING");
  });

  it("18. explicit canonical denial overrides legacy role navigation defaults", () => {
    const denied = { view: false } as Permissions;
    expect(canAccessGroup({ role: Role.FINANCE } as User, "sales-and-orders", denied)).toBe(false);
    expect(canAccessGroup({ role: Role.ORDER_OPS_OFFICER } as User, "sales-and-orders", denied)).toBe(false);
    expect(canAccessGroup({ role: Role.FINANCE } as User, "field-crm")).toBe(false);
  });
});
