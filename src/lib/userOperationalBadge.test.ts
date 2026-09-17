import { describe, expect, it } from "vitest";
import { Role, User, UserProductAssignment, UserTerritoryAssignment } from "../types";
import { getReadiness } from "./userPolicyEngine";
import { getUserOperationalBadge } from "./userOperationalBadge";

const manager = {
  id: "manager-1",
  uid: "manager-1",
  name: "Manager",
  email: "manager@example.test",
  role: Role.MEDICAL_SUPERVISOR,
  active: true,
} as User;

const representative = (overrides: Partial<User> = {}) => ({
  id: "rep-1",
  uid: "rep-1",
  name: "Representative",
  email: "rep@example.test",
  role: Role.MEDICAL_REP,
  active: true,
  loginAllowed: true,
  managerId: manager.id,
  primaryPromotionGroupId: "group-1",
  assignmentSyncStatus: "COMPLETE",
  ...overrides,
} as User);

const territory = (userId = "rep-1") => ({
  userId,
  territoryId: "area-1",
  status: "Active",
  active: true,
} as UserTerritoryAssignment);

const product = (userId = "rep-1") => ({
  userId,
  productId: "product-1",
  status: "Active",
  active: true,
} as UserProductAssignment);

const evaluate = (
  user = representative(),
  territoryAssignments: UserTerritoryAssignment[] = [territory()],
  productAssignments: UserProductAssignment[] = [product()],
  territoryAssignmentsHydrated = true,
  productAssignmentsHydrated = true,
) => getUserOperationalBadge(user, [user, manager], {
  territoryAssignments,
  productAssignments,
  territoryAssignmentsHydrated,
  productAssignmentsHydrated,
});

describe("User Management canonical operational badge", () => {
  it("shows Operational for a fully configured Medical Representative", () => {
    const result = evaluate();
    expect(result.state).toBe("OPERATIONAL");
    expect(result.readiness).toEqual({ status: "Operational", reasons: ["COMPLETE"] });
  });

  it("shows loading while territory assignments are not hydrated", () => {
    const result = evaluate(representative(), [territory()], [product()], false, true);
    expect(result.state).toBe("ASSIGNMENTS_LOADING");
    expect(result.readiness.reasons).toContain("CANONICAL_ASSIGNMENTS_NOT_HYDRATED");
  });

  it("shows loading while product assignments are not hydrated", () => {
    const result = evaluate(representative(), [territory()], [product()], true, false);
    expect(result.state).toBe("ASSIGNMENTS_LOADING");
    expect(result.readiness.reasons).toContain("CANONICAL_ASSIGNMENTS_NOT_HYDRATED");
  });

  it("shows Awaiting Geography when hydrated territory assignments are empty", () => {
    const result = evaluate(representative(), [], [product()]);
    expect(result.state).toBe("AWAITING_GEOGRAPHY");
    expect(result.readiness.reasons).toContain("AREA_ASSIGNMENT_MISSING");
  });

  it("shows Awaiting Operational when hydrated product assignments are empty", () => {
    const result = evaluate(representative(), [territory()], []);
    expect(result.state).toBe("AWAITING_OPERATIONAL");
    expect(result.readiness.reasons).toContain("PRODUCT_ASSIGNMENT_MISSING");
  });

  it("does not accept legacy assignment summaries as readiness authority", () => {
    const user = representative({ areaIds: ["legacy-area"], territories: ["Legacy"], products: ["Legacy Product"] });
    const result = evaluate(user, [], []);
    expect(result.state).not.toBe("OPERATIONAL");
    expect(result.readiness.reasons).toEqual(expect.arrayContaining(["AREA_ASSIGNMENT_MISSING", "PRODUCT_ASSIGNMENT_MISSING"]));
  });

  it.each(["PENDING", "FAILED"])("keeps assignmentSyncStatus %s non-operational", assignmentSyncStatus => {
    const result = evaluate(representative({ assignmentSyncStatus: assignmentSyncStatus as User["assignmentSyncStatus"] }));
    expect(result.state).toBe("AWAITING_OPERATIONAL");
    expect(result.readiness.status).not.toBe("Operational");
  });

  it("does not use another representative's canonical assignments", () => {
    const result = evaluate(representative(), [territory("rep-2")], [product("rep-2")]);
    expect(result.state).toBe("AWAITING_GEOGRAPHY");
    expect(result.readiness.reasons).toEqual(expect.arrayContaining(["AREA_ASSIGNMENT_MISSING", "PRODUCT_ASSIGNMENT_MISSING"]));
  });

  it("uses the same canonical readiness semantics as representative runtime", () => {
    const user = representative();
    const badge = evaluate(user);
    const runtime = getReadiness(user, [user, manager], {
      territoryAssignments: [territory()],
      productAssignments: [product()],
      assignmentsHydrated: true,
    });
    expect(badge.readiness).toEqual(runtime);
  });
});
