import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Role, type User } from "../src/types";
import { getReadiness } from "../src/lib/userPolicyEngine";
import {
  OrganizationalHierarchyError,
  resolveOrganizationalScope,
  type OrganizationalHierarchyRepository,
  type OrganizationalUser,
} from "./organizationalHierarchyService";

function repository(
  actor: OrganizationalUser,
  viewTeamData: boolean,
  descendants: OrganizationalUser[] = [],
): OrganizationalHierarchyRepository {
  const users = [actor, ...descendants];
  return {
    async getUser(uid) { return users.find((user) => user.id === uid) || null; },
    async getDirectReports(managerUid) { return users.filter((user) => user.managerId === managerUid); },
    async getAllUsers() { return users; },
    async getRolePermissions() { return { viewTeamData }; },
    async getAccessGovernance() { return null; },
  };
}

const actor = (role: Role): OrganizationalUser => ({
  id: `actor-${role}`,
  role,
  active: true,
  loginAllowed: true,
  status: "Active",
  employmentStatus: "Active",
});

const readinessUser = (role: Role, id: string, managerId = "manager"): User => ({
  id,
  email: `${id}@example.invalid`,
  name: id,
  role,
  managerId,
  active: true,
  loginAllowed: true,
  status: "Active",
  employmentStatus: "Active",
  isDeleted: false,
  assignmentSyncStatus: "COMPLETE",
  primaryPromotionGroupId: "GROUP-A",
} as User);

const manager = readinessUser(Role.GENERAL_MANAGER, "manager", "");
const territory = (userId: string) => ({ userId, areaId: "AREA-A", status: "Active", active: true });
const product = (userId: string) => ({ userId, productId: "PRODUCT-A", status: "Active", active: true });

describe("Fix 5B.1B generic operational bootstrap", () => {
  it.each([
    Role.MEDICAL_REP,
    Role.SALES_REP,
    Role.FINANCE,
    Role.ORDER_OPS_OFFICER,
    Role.INVENTORY_OFFICER,
    Role.DELIVERY_OFFICER,
    Role.PRODUCT_MANAGER,
  ])("allows %s to resolve authenticated SELF/FUNCTIONAL scope when team visibility is false", async (role) => {
    const user = actor(role);
    const result = await resolveOrganizationalScope(user.id, {}, repository(user, false));
    expect(result.allHierarchyUids).toEqual([user.id]);
    expect(result.descendantUids).toEqual([]);
  });

  it.each([Role.MEDICAL_REP, Role.SALES_REP])("does not let SELF role %s enumerate subordinates", async (role) => {
    const user = actor(role);
    await expect(resolveOrganizationalScope(user.id, { depth: "descendants" }, repository(user, false, [
      { ...actor(Role.MEDICAL_REP), id: "unavailable-child", managerId: user.id },
    ]))).rejects.toMatchObject({ code: "SUBORDINATE_ENUMERATION_DENIED" });
  });

  it.each([
    Role.GENERAL_MANAGER,
    Role.REGIONAL_MANAGER,
    Role.COUNTRY_MANAGER,
    Role.MEDICAL_MANAGER,
    Role.MEDICAL_SUPERVISOR,
  ])("enforces team visibility for HIERARCHY role %s", async (role) => {
    const user = actor(role);
    await expect(resolveOrganizationalScope(user.id, {}, repository(user, false)))
      .rejects.toEqual(expect.objectContaining<Partial<OrganizationalHierarchyError>>({ code: "HIERARCHY_PERMISSION_DENIED" }));
  });

  it.each([Role.SUPER_ADMIN, Role.ADMIN])("enforces team visibility for ORGANIZATION role %s", async (role) => {
    const user = actor(role);
    await expect(resolveOrganizationalScope(user.id, {}, repository(user, false)))
      .rejects.toMatchObject({ code: "HIERARCHY_PERMISSION_DENIED" });
  });

  it("allows an authorized supervisor hierarchy without widening unrelated subjects", async () => {
    const supervisor = actor(Role.MEDICAL_SUPERVISOR);
    const direct = { ...actor(Role.MEDICAL_REP), id: "authorized-rep", managerId: supervisor.id };
    const unrelated = { ...actor(Role.MEDICAL_REP), id: "unrelated-rep", managerId: "other-supervisor" };
    const result = await resolveOrganizationalScope(supervisor.id, {}, repository(supervisor, true, [direct, unrelated]));
    expect(result.descendantUids).toEqual([direct.id]);
  });

  it("preserves representative assignment readiness requirements without sharing Medical product rules", () => {
    const medical = readinessUser(Role.MEDICAL_REP, "medical-rep");
    const sales = readinessUser(Role.SALES_REP, "sales-rep");
    expect(getReadiness(medical, [medical, manager], {
      territoryAssignments: [territory(medical.id)], productAssignments: [product(medical.id)], assignmentsHydrated: true, operationalScopeStatus: "READY",
    }).status).toBe("Operational");
    expect(getReadiness({ ...medical, id: "medical-no-product" }, [{ ...medical, id: "medical-no-product" }, manager], {
      territoryAssignments: [territory("medical-no-product")], productAssignments: [], assignmentsHydrated: true, operationalScopeStatus: "READY",
    }).reasons).toContain("PRODUCT_ASSIGNMENT_MISSING");
    expect(getReadiness(sales, [sales, manager], {
      territoryAssignments: [territory(sales.id)], productAssignments: [], assignmentsHydrated: true, operationalScopeStatus: "READY",
    }).status).toBe("Operational");
    expect(getReadiness({ ...sales, id: "sales-no-area" }, [{ ...sales, id: "sales-no-area" }, manager], {
      territoryAssignments: [], productAssignments: [], assignmentsHydrated: true, operationalScopeStatus: "READY",
    }).reasons).toContain("AREA_ASSIGNMENT_MISSING");
  });

  it("keeps functional base readiness independent of irrelevant assignments", () => {
    for (const role of [Role.FINANCE, Role.ORDER_OPS_OFFICER, Role.INVENTORY_OFFICER, Role.DELIVERY_OFFICER]) {
      const user = readinessUser(role, `functional-${role}`);
      expect(getReadiness(user, [user, manager], {
        territoryAssignments: [], productAssignments: [], assignmentsHydrated: true, operationalScopeStatus: "DENIED",
      }).status).toBe("Operational");
    }
  });

  it("hydrates only authenticated-UID assignments before scope and leaves business resources scope-gated", () => {
    const source = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
    const hydrationStart = source.indexOf("const territoryQuery = query(");
    const scopeStart = source.indexOf("await operationalScopeController.bootstrap", hydrationStart);
    expect(hydrationStart).toBeGreaterThan(-1);
    expect(scopeStart).toBeGreaterThan(hydrationStart);
    expect(source.slice(hydrationStart, scopeStart)).toContain('collection(db, "userTerritoryAssignments")');
    expect(source.slice(hydrationStart, scopeStart)).toContain('where("userId", "==", firebaseAuthUid)');
    expect(source.slice(hydrationStart, scopeStart)).toContain('collection(db, "userProductAssignments")');
    expect(source.slice(hydrationStart, scopeStart).match(/where\("userId", "==", firebaseAuthUid\)/g)).toHaveLength(2);

    const assignmentEffect = source.slice(source.indexOf("// 3. User Territory & Product Assignments Listeners"), source.indexOf("// 4. Import History Listener"));
    expect(assignmentEffect).not.toContain("if (!isOperational)");
    expect(assignmentEffect).toContain('where("userId", "==", currentUser.id)');
    expect(assignmentEffect).toContain('operationalScopeSession.status === "READY"');
    expect(source.match(/operationalScopeSession\.status !== "READY"/g)?.length).toBeGreaterThanOrEqual(4);
    expect(source).not.toContain("getDocs(collection(db, \"userTerritoryAssignments\"))");
    expect(source).not.toContain("getDocs(collection(db, \"userProductAssignments\"))");
  });
});
