import { describe, expect, it } from "vitest";
import { Product, Role, User, UserProductAssignment, UserTerritoryAssignment } from "./types";
import {
  getValidatedPhysicianAlignedProductIds,
  resolvePhysicianVisitProducts
} from "./lib/productAssignmentService";
import {
  getCanonicalPhysicianProductSelection,
  resolvePhysicianOperationalAssignment
} from "./lib/physicianAlignmentUi";

const products = [
  { id: "PROD-7964", name: "Test", promotionGroupId: "PG-TEST", isActive: true },
  { id: "PROD-9188", name: "Test 4", promotionGroupId: "PG-TEST", isActive: true },
  { id: "PROD-INACTIVE", name: "Inactive", promotionGroupId: "PG-TEST", isActive: false },
  { id: "PROD-OTHER", name: "Other", promotionGroupId: "PG-OTHER", isActive: true }
] as Product[];

const physicianMaster = {
  areaId: "AREA-TEST",
  primaryPromotionGroupId: "PG-TEST",
  targetPromotionGroupIds: [] as string[]
};

const supervisor = {
  id: "SUP-UID", name: "Supervisor", email: "sup@example.test", role: Role.MEDICAL_SUPERVISOR,
  territory: "", region: "", active: true, managerId: "MGR-UID"
} as User;
const manager = {
  id: "MGR-UID", name: "Manager", email: "mgr@example.test", role: Role.MEDICAL_MANAGER,
  territory: "", region: "", active: true
} as User;
const rep = (id: string): User => ({
  id, name: id, email: `${id}@example.test`, role: Role.MEDICAL_REP,
  territory: "", region: "", active: true, managerId: supervisor.id
});
const territory = (userId: string, territoryId = "AREA-TEST") => ({
  assignmentId: `TA-${userId}`, userId, userRole: Role.MEDICAL_REP,
  countryId: "COUNTRY", districtId: "DISTRICT", cityId: "CITY", territoryId,
  territoryName: territoryId, assignmentType: "medical", effectiveFrom: "2026-01-01",
  effectiveTo: "2030-12-31", status: "Active", assignedBy: "ADMIN", assignedAt: "2026-01-01"
} as UserTerritoryAssignment);
const productAssignment = (userId: string, productId = "PROD-7964") => ({
  assignmentId: `PA-${userId}-${productId}`, userId, productId, productGroupId: "PG-TEST",
  therapeuticArea: "General", assignmentType: "medical", effectiveFrom: "2026-01-01",
  effectiveTo: "2030-12-31", status: "Active", active: true,
  assignedBy: "ADMIN", assignedAt: "2026-01-01"
} as UserProductAssignment);
const validate = (selectedProductIds: string[]) => getValidatedPhysicianAlignedProductIds({
  selectedProductIds, physician: physicianMaster, products, userProductAssignments: []
});
const resolve = ({
  reps = [rep("REP-1")], territories = [territory("REP-1")], assignments = [productAssignment("REP-1")], requestedRepId
}: {
  reps?: User[];
  territories?: UserTerritoryAssignment[];
  assignments?: UserProductAssignment[];
  requestedRepId?: string;
} = {}) => resolvePhysicianOperationalAssignment({
  areaId: physicianMaster.areaId,
  alignedProductIds: ["PROD-7964", "PROD-9188"],
  requestedRepId,
  users: [...reps, supervisor, manager],
  userTerritoryAssignments: territories,
  userProductAssignments: assignments
});

describe("WP7.10F Physician Master alignment and organizational cascade", () => {
  it("1/5. preserves selected products when no representative is assigned", () => {
    expect(validate(["PROD-7964"])).toEqual(["PROD-7964"]);
  });

  it("2. persists two explicitly selected products deterministically", () => {
    expect(validate(["PROD-9188", "PROD-7964", "PROD-9188"]))
      .toEqual(["PROD-7964", "PROD-9188"]);
  });

  it("3. rejects an inactive product", () => {
    expect(validate(["PROD-INACTIVE"])).toEqual([]);
  });

  it("4. rejects a product outside primary and target Promotion Groups", () => {
    expect(validate(["PROD-OTHER"])).toEqual([]);
  });

  it("6. auto assigns exactly one eligible Medical Representative", () => {
    expect(resolve()).toMatchObject({ assignedRepId: "REP-1", representativeStatus: "AUTO_ASSIGNED" });
  });

  it("7. requires a choice from multiple eligible representatives", () => {
    const reps = [rep("REP-1"), rep("REP-2")];
    const result = resolve({
      reps,
      territories: reps.map(item => territory(item.id)),
      assignments: reps.map(item => productAssignment(item.id))
    });
    expect(result).toMatchObject({
      eligibleRepresentativeIds: ["REP-1", "REP-2"],
      representativeStatus: "MANUAL_ASSIGNMENT_REQUIRED"
    });
    expect(result.assignedRepId).toBeUndefined();
  });

  it("8. preserves Physician Master products when no representative matches", () => {
    const result = resolve({ territories: [] });
    expect(result.representativeStatus).toBe("NO_ELIGIBLE_MEDICAL_REP");
    expect(result.assignedRepId).toBeUndefined();
    expect(validate(["PROD-7964", "PROD-9188"])).toEqual(["PROD-7964", "PROD-9188"]);
  });

  it("9. preserves master alignment but removes unavailable products at visit runtime", () => {
    const alignedProductIds = validate(["PROD-7964", "PROD-9188"]);
    expect(alignedProductIds).toEqual(["PROD-7964", "PROD-9188"]);
    expect(resolvePhysicianVisitProducts({
      physician: { ...physicianMaster, alignedProductIds },
      authorizedProducts: [products[1]]
    }).map(item => item.id)).toEqual(["PROD-9188"]);
  });

  it("10. losing area ownership removes operational ownership without changing Physician Master", () => {
    expect(resolve({ territories: [territory("REP-1", "AREA-OTHER")] }).assignedRepId).toBeUndefined();
    expect(validate(["PROD-7964"])).toEqual(["PROD-7964"]);
  });

  it("11/12. reopens and re-saves existing canonical checkbox IDs without loss", () => {
    const restored = getCanonicalPhysicianProductSelection({ alignedProductIds: ["PROD-9188", "PROD-7964"] });
    expect(restored).toEqual(["PROD-9188", "PROD-7964"]);
    expect(validate(restored)).toEqual(["PROD-7964", "PROD-9188"]);
  });

  it("13/14. resolves Supervisor and Manager through the selected rep hierarchy", () => {
    expect(resolve()).toMatchObject({
      assignedSupervisorId: "SUP-UID", supervisorStatus: "RESOLVED",
      assignedManagerId: "MGR-UID", managerStatus: "RESOLVED"
    });
  });

  it("15. recalculates both hierarchy levels when the representative changes", () => {
    const secondSupervisor = { ...supervisor, id: "SUP-2", managerId: "MGR-2" };
    const secondManager = { ...manager, id: "MGR-2" };
    const secondRep = { ...rep("REP-2"), managerId: secondSupervisor.id };
    const result = resolvePhysicianOperationalAssignment({
      areaId: physicianMaster.areaId,
      alignedProductIds: ["PROD-7964"],
      requestedRepId: secondRep.id,
      users: [rep("REP-1"), supervisor, manager, secondRep, secondSupervisor, secondManager],
      userTerritoryAssignments: [territory("REP-1"), territory("REP-2")],
      userProductAssignments: [productAssignment("REP-1"), productAssignment("REP-2")]
    });
    expect(result).toMatchObject({ assignedRepId: "REP-2", assignedSupervisorId: "SUP-2", assignedManagerId: "MGR-2" });
  });
});
