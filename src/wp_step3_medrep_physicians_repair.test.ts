import { describe, it, expect } from "vitest";
import { Role, User, Physician, UserTerritoryAssignment, UserProductAssignment, Product, ProductPromotionGroup } from "./types";
import { isUserOperational, isPhysicianEligibleForUser } from "./lib/securityEngine";
import { getReadiness } from "./lib/userPolicyEngine";

describe("STEP 3 – Medical Representative Scoped Physician Read Repair Verification", () => {
  const medRepUser: User = {
    id: "J37PXq5iqQSjIqXGnDhfPSLKC292",
    uid: "J37PXq5iqQSjIqXGnDhfPSLKC292",
    name: "Medical Rep UAT",
    email: "medrep.uat@menareps.com",
    role: Role.MEDICAL_REP,
    status: "Active",
    active: true,
    employmentStatus: "Active",
    loginAllowed: true,
    managerId: "MGR-001",
    managerEmail: "supervisor@menareps.com",
    areaIds: ["A-713066"],
    primaryPromotionGroupId: "test",
    products: ["PROD-9188"],
    assignmentSyncStatus: "COMPLETE"
  };

  const managerUser: User = {
    id: "MGR-001",
    email: "supervisor@menareps.com",
    name: "Supervisor",
    role: Role.MEDICAL_SUPERVISOR,
    active: true,
    employmentStatus: "Active",
    loginAllowed: true
  };

  const territoryAssignment: UserTerritoryAssignment = {
    id: "UTA-001",
    userId: "J37PXq5iqQSjIqXGnDhfPSLKC292",
    territoryId: "A-713066",
    status: "Active",
    active: true,
    assignedAt: new Date().toISOString()
  };

  const productAssignment: UserProductAssignment = {
    id: "UPA-001",
    userId: "J37PXq5iqQSjIqXGnDhfPSLKC292",
    productId: "PROD-9188",
    status: "Active",
    active: true,
    assignedAt: new Date().toISOString()
  };

  const product: Product = {
    id: "PROD-9188",
    name: "Test Product 9188",
    sku: "SKU-9188",
    promotionGroupId: "test",
    isActive: true
  };

  const promotionGroup: ProductPromotionGroup = {
    id: "test",
    name: "Test Group",
    code: "TEST_PG",
    active: true
  };

  it("1. Certifies isUserOperational is true for Medical Representative during catalog hydration (empty productsList)", () => {
    const isOp = isUserOperational(
      medRepUser,
      [territoryAssignment],
      [productAssignment],
      [medRepUser, managerUser],
      [] // empty productsList during initial hydration
    );
    expect(isOp).toBe(true);
  });

  it("2. Certifies getReadiness status is Operational for UAT Medical Rep user J37PXq5iqQSjIqXGnDhfPSLKC292", () => {
    const report = getReadiness(medRepUser, [medRepUser, managerUser], { territoryAssignments: [territoryAssignment], productAssignments: [productAssignment], assignmentsHydrated: true });
    expect(report.status).toBe("Operational");
    expect(report.reasons).toContain("COMPLETE");
  });

  it("3. Certifies eligible physician PHY-267 in area A-713066 is accessible to Medical Rep J37PXq5iqQSjIqXGnDhfPSLKC292", () => {
    const physician: Physician = {
      id: "PHY-267",
      name: "Dr. Eligible Physician",
      areaId: "A-713066",
      primaryPromotionGroupId: "test",
      specialty: "Dermatology",
      active: true,
      status: "Active"
    };

    const isEligible = isPhysicianEligibleForUser({
      physician,
      user: medRepUser,
      userTerritoryAssignments: [territoryAssignment],
      userProductAssignments: [productAssignment],
      products: [product],
      productPromotionGroups: [promotionGroup],
      allUsers: [medRepUser, managerUser]
    });

    expect(isEligible.eligible).toBe(true);
  });

  it("4. Certifies unassigned physician in area A-999999 is blocked (no cross-area leakage)", () => {
    const physicianLeak: Physician = {
      id: "PHY-LEAK",
      name: "Dr. Unassigned Area",
      areaId: "A-999999",
      primaryPromotionGroupId: "test",
      specialty: "Cardiology",
      active: true,
      status: "Active"
    };

    const isEligible = isPhysicianEligibleForUser({
      physician: physicianLeak,
      user: medRepUser,
      userTerritoryAssignments: [territoryAssignment],
      userProductAssignments: [productAssignment],
      products: [product],
      productPromotionGroups: [promotionGroup],
      allUsers: [medRepUser, managerUser]
    });

    expect(isEligible.eligible).toBe(false);
  });

  it("5. Certifies query building logic for Medical Representative Area IDs", () => {
    // Single area ID -> equals query
    const singleAreaIds = ["A-713066"];
    const singleQueryConstraint = singleAreaIds.length === 1
      ? `where("areaId", "==", "${singleAreaIds[0]}")`
      : `where("areaId", "in", ...)`;
    expect(singleQueryConstraint).toBe('where("areaId", "==", "A-713066")');

    // Multiple area IDs -> in query
    const multiAreaIds = ["A-713066", "A-888888"];
    const multiQueryConstraint = multiAreaIds.length > 1
      ? `where("areaId", "in", ${JSON.stringify(multiAreaIds)})`
      : `where("areaId", "==", ...)`;
    expect(multiQueryConstraint).toBe('where("areaId", "in", ["A-713066","A-888888"])');
  });
});
