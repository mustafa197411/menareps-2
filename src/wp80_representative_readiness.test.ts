import { describe, expect, it } from "vitest";
import { Role } from "./types";
import { getReadiness } from "./lib/userPolicyEngine";

const manager = { id: "MANAGER-X", uid: "MANAGER-X", name: "Synthetic Manager", email: "manager@synthetic.invalid", role: Role.MEDICAL_SUPERVISOR, active: true, loginAllowed: true, employmentStatus: "Active", status: "Active" } as any;
const salesManager = { ...manager, role: Role.SALES_SUPERVISOR } as any;
const representative = (role: Role.MEDICAL_REP | Role.SALES_REP = Role.MEDICAL_REP) => ({ id: "REP-X", uid: "REP-X", name: "Synthetic Representative", email: "rep@synthetic.invalid", role, managerId: "MANAGER-X", active: true, loginAllowed: true, employmentStatus: "Active", status: "Active", accountStatus: "ACTIVE", assignmentSyncStatus: "COMPLETE", primaryPromotionGroupId: "GROUP-X", areaIds: ["LEGACY-AREA"], territories: ["LEGACY-TERRITORY"], products: ["LEGACY-PRODUCT"] } as any);
const canonical = { assignmentsHydrated: true, territoryAssignments: [{ userId: "REP-X", areaId: "AREA-X", status: "Active", active: true }], productAssignments: [{ userId: "REP-X", productId: "PRODUCT-X", status: "Active", active: true }] };

describe("WP80 canonical representative readiness", () => {
  it("canonical Medical Representative assignments are operational", () => expect(getReadiness(representative(), [manager], canonical).status).toBe("Operational"));
  it("canonical Sales Representative territory assignment is operational", () => expect(getReadiness(representative(Role.SALES_REP), [salesManager], canonical).status).toBe("Operational"));
  it("legacy-only geography is not operational authority", () => expect(getReadiness(representative(), [manager], { ...canonical, territoryAssignments: [] }).reasons).toContain("AREA_ASSIGNMENT_MISSING"));
  it("legacy-only Products are not operational authority", () => expect(getReadiness(representative(), [manager], { ...canonical, productAssignments: [] }).reasons).toContain("PRODUCT_ASSIGNMENT_MISSING"));
  it("unhydrated canonical assignments remain a valid pending onboarding state", () => { const report = getReadiness(representative(), [manager]); expect(report.status).toBe("Pending"); expect(report.reasons).toContain("CANONICAL_ASSIGNMENTS_NOT_HYDRATED"); expect(report.status).not.toBe("Operational"); });
  it("two arbitrary identities use the same canonical rule", () => { const second = { ...representative(), id: "REP-Y", uid: "REP-Y", email: "other@synthetic.invalid" }; const context = { assignmentsHydrated: true, territoryAssignments: [{ userId: "REP-Y", areaId: "AREA-Y", status: "Active", active: true }], productAssignments: [{ userId: "REP-Y", productId: "PRODUCT-Y", status: "Active", active: true }] }; expect(getReadiness(second, [manager], context).status).toBe("Operational"); });
});
