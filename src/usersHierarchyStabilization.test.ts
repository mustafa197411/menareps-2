import { describe, expect, it } from "vitest";
import { Role, User } from "./types";
import {
  allowedManagerRolesByUserRole,
  canAssignManager,
  getValidManagerRoles,
  validateManager,
} from "./lib/userPolicyEngine";
import { getOperationalPresentation } from "./lib/operationalPresentation";
import { getTeamRoleCounts } from "./lib/teamMetrics";
import { resolveUserIdentity } from "./lib/userIdentityResolver";

const user = (id: string, role: Role, managerId?: string): User => ({
  id,
  name: `Person ${id}`,
  email: `${id}@example.test`,
  role,
  managerId,
  territory: "Area A",
  region: "City A",
  active: true,
});

describe("canonical manager-role eligibility", () => {
  it("accepts every declared combination and rejects every undeclared role combination", () => {
    const allRoles = Object.values(Role);
    for (const employeeRole of allRoles) {
      const allowed = allowedManagerRolesByUserRole[employeeRole];
      expect(getValidManagerRoles(employeeRole)).toEqual(allowed);
      for (const managerRole of allRoles) {
        expect(canAssignManager(employeeRole, managerRole)).toBe(allowed.includes(managerRole));
      }
    }
  });

  it.each([
    Role.MARKETING_MANAGER,
    Role.SALES_MARKETING_MANAGER,
    Role.COUNTRY_MANAGER,
  ])("allows a Medical Manager to report to %s", (managerRole) => {
    const manager = user("manager-arbitrary", managerRole);
    const employee = user("employee-arbitrary", Role.MEDICAL_MANAGER, manager.id);
    expect(validateManager(employee, [employee, manager])).toEqual({ isValid: true });
  });

  it("rejects an invalid generic Medical Manager relationship", () => {
    const manager = user("manager-arbitrary", Role.MEDICAL_REP);
    const employee = user("employee-arbitrary", Role.MEDICAL_MANAGER, manager.id);
    expect(validateManager(employee, [employee, manager]).isValid).toBe(false);
  });
});

describe("readiness presentation", () => {
  it("presents LOADING_MANAGER as neutral loading, never as a failure", () => {
    expect(getOperationalPresentation("Pending", ["LOADING_MANAGER"])).toEqual({
      tone: "loading",
      label: "Loading",
      definitiveFailure: false,
    });
  });

  it("presents resolved readiness as operational and definitive invalid readiness as incomplete", () => {
    expect(getOperationalPresentation("Operational", [])).toMatchObject({ tone: "success", definitiveFailure: false });
    expect(getOperationalPresentation("Incomplete", ["MANAGER_MISSING"])).toMatchObject({ tone: "warning", definitiveFailure: true });
  });
});

describe("team counters and identity presentation", () => {
  it("counts only actual representative roles", () => {
    expect(getTeamRoleCounts([
      { role: Role.MEDICAL_REP },
      { role: Role.MEDICAL_MANAGER },
      { role: Role.MEDICAL_SUPERVISOR },
      { role: Role.SALES_REP },
      { role: Role.SALES_MANAGER },
      { role: Role.SALES_MARKETING_MANAGER },
    ])).toEqual({ totalTeam: 6, medicalReps: 1, salesReps: 1 });
  });

  it("derives the Medical Manager Team KPI from the same three visible users", () => {
    expect(getTeamRoleCounts([
      { role: Role.MEDICAL_SUPERVISOR },
      { role: Role.MEDICAL_REP },
      { role: Role.MEDICAL_REP },
    ])).toEqual({ totalTeam: 3, medicalReps: 2, salesReps: 0 });
  });

  it("resolves canonical UIDs to a display name or safe fallback", () => {
    const manager = user("opaque-uid-123", Role.COUNTRY_MANAGER);
    expect(resolveUserIdentity(manager.id, [manager])).toBe(manager.name);
    expect(resolveUserIdentity("unknown-uid", [manager], "Unknown manager")).toBe("Unknown manager");
  });
});
