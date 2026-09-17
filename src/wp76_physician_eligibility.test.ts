import { describe, it, expect, beforeEach } from "vitest";
import { Role, User, Product, ProductPromotionGroup, UserTerritoryAssignment, UserProductAssignment, Physician } from "./types";
import { isPhysicianEligibleForUser, setGlobalSecurityContext, applySecurityScope } from "./lib/securityEngine";

describe("WP7.6 Phase 3 - Physician & Pharmacy Eligibility Certification", () => {
  // Target Representative Baseline Context
  const managerUser: User = {
    id: "kBUbCmDZnVS3sQt3OD7PsNCeKjf2",
    email: "gm@esnad.local",
    name: "GM",
    role: Role.GENERAL_MANAGER,
    active: true,
    employmentStatus: "Active",
    loginAllowed: true
  };

  const repUser: User = {
    id: "J37PXq5iqQSjIqXGnDhfPSLKC292",
    name: "Medical Rep UAT",
    email: "medrep.uat@menareps.com",
    role: Role.MEDICAL_REP,
    status: "Active",
    active: true,
    employmentStatus: "Active",
    loginAllowed: true,
    managerId: "kBUbCmDZnVS3sQt3OD7PsNCeKjf2",
    managerEmail: "gm@esnad.local",
    areaIds: ["A-713066"],
    primaryPromotionGroupId: "test",
    products: ["PROD-9188"],
    assignmentSyncStatus: "COMPLETE"
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
    name: "Test Promotion Group",
    code: "TEST_PG",
    active: true,
    description: "Certification Promotion Group"
  };

  const allUsers = [repUser, managerUser];
  const territoryAssignments = [territoryAssignment];
  const productAssignments = [productAssignment];
  const products = [product];
  const promotionGroups = [promotionGroup];

  beforeEach(() => {
    setGlobalSecurityContext(repUser, allUsers, territoryAssignments, productAssignments, products, promotionGroups);
  });

  // 10 MANDATORY LEAKAGE TEST CASES

  it("Leakage Test Case 1: Same Area + matching Product -> Visible", () => {
    const physician: Physician = {
      id: "PHY-001",
      name: "Dr. Case 1",
      areaId: "A-713066",
      primaryPromotionGroupId: "test",
      specialty: "Cardiology",
      active: true,
      status: "Active"
    };

    const res = isPhysicianEligibleForUser({
      physician,
      user: repUser,
      userTerritoryAssignments: territoryAssignments,
      userProductAssignments: productAssignments,
      products,
      productPromotionGroups: promotionGroups,
      allUsers
    });

    expect(res.eligible).toBe(true);
  });

  it("Leakage Test Case 2: Same Area + no matching Product -> Hidden (PRODUCT_NOT_ELIGIBLE)", () => {
    const physician: Physician = {
      id: "PHY-002",
      name: "Dr. Case 2",
      areaId: "A-713066",
      primaryPromotionGroupId: "cardiology_pg",
      specialty: "Cardiology",
      active: true,
      status: "Active"
    };

    const res = isPhysicianEligibleForUser({
      physician,
      user: repUser,
      userTerritoryAssignments: territoryAssignments,
      userProductAssignments: productAssignments,
      products,
      productPromotionGroups: promotionGroups,
      allUsers
    });

    expect(res.eligible).toBe(false);
    expect(res.reason).toBe("PRODUCT_NOT_ELIGIBLE");
  });

  it("Leakage Test Case 3: Different Area + matching Product -> Hidden (AREA_NOT_ELIGIBLE)", () => {
    const physician: Physician = {
      id: "PHY-003",
      name: "Dr. Case 3",
      areaId: "A-999999",
      primaryPromotionGroupId: "test",
      specialty: "Cardiology",
      active: true,
      status: "Active"
    };

    const res = isPhysicianEligibleForUser({
      physician,
      user: repUser,
      userTerritoryAssignments: territoryAssignments,
      userProductAssignments: productAssignments,
      products,
      productPromotionGroups: promotionGroups,
      allUsers
    });

    expect(res.eligible).toBe(false);
    expect(res.reason).toBe("AREA_NOT_ELIGIBLE");
  });

  it("Leakage Test Case 4: Different Area + no matching Product -> Hidden (AREA_NOT_ELIGIBLE)", () => {
    const physician: Physician = {
      id: "PHY-004",
      name: "Dr. Case 4",
      areaId: "A-999999",
      primaryPromotionGroupId: "cardiology_pg",
      specialty: "Cardiology",
      active: true,
      status: "Active"
    };

    const res = isPhysicianEligibleForUser({
      physician,
      user: repUser,
      userTerritoryAssignments: territoryAssignments,
      userProductAssignments: productAssignments,
      products,
      productPromotionGroups: promotionGroups,
      allUsers
    });

    expect(res.eligible).toBe(false);
    expect(res.reason).toBe("AREA_NOT_ELIGIBLE");
  });

  it("Leakage Test Case 5: Inactive Physician -> Hidden (PHYSICIAN_INACTIVE / PHYSICIAN_DELETED)", () => {
    const inactivePhysician: Physician = {
      id: "PHY-005A",
      name: "Dr. Case 5A",
      areaId: "A-713066",
      primaryPromotionGroupId: "test",
      specialty: "Cardiology",
      active: false,
      status: "Inactive"
    };

    const deletedPhysician: Physician = {
      id: "PHY-005B",
      name: "Dr. Case 5B",
      areaId: "A-713066",
      primaryPromotionGroupId: "test",
      specialty: "Cardiology",
      isDeleted: true
    };

    const resA = isPhysicianEligibleForUser({ physician: inactivePhysician, user: repUser, userTerritoryAssignments: territoryAssignments, userProductAssignments: productAssignments, products, productPromotionGroups: promotionGroups, allUsers });
    expect(resA.eligible).toBe(false);
    expect(resA.reason).toBe("PHYSICIAN_INACTIVE");

    const resB = isPhysicianEligibleForUser({ physician: deletedPhysician, user: repUser, userTerritoryAssignments: territoryAssignments, userProductAssignments: productAssignments, products, productPromotionGroups: promotionGroups, allUsers });
    expect(resB.eligible).toBe(false);
    expect(resB.reason).toBe("PHYSICIAN_DELETED");
  });

  it("Leakage Test Case 6: Invalid or missing Area ID -> Hidden (PHYSICIAN_MISSING_AREA_ID)", () => {
    const physician: Physician = {
      id: "PHY-006",
      name: "Dr. Case 6",
      areaId: "",
      primaryPromotionGroupId: "test",
      specialty: "Cardiology",
      territory: "LIBYA / WEST / TRIPOLI / TEST",
      active: true,
      status: "Active"
    };

    const res = isPhysicianEligibleForUser({ physician, user: repUser, userTerritoryAssignments: territoryAssignments, userProductAssignments: productAssignments, products, productPromotionGroups: promotionGroups, allUsers });
    expect(res.eligible).toBe(false);
    expect(res.reason).toBe("PHYSICIAN_MISSING_AREA_ID");
  });

  it("Leakage Test Case 7: Inactive Promotion Group -> Hidden (PRODUCT_NOT_ELIGIBLE)", () => {
    const inactivePGs: ProductPromotionGroup[] = [
      { id: "test", name: "Test PG", code: "TEST_PG", active: false }
    ];

    const physician: Physician = {
      id: "PHY-007",
      name: "Dr. Case 7",
      areaId: "A-713066",
      primaryPromotionGroupId: "test",
      specialty: "Cardiology",
      active: true,
      status: "Active"
    };

    const res = isPhysicianEligibleForUser({ physician, user: repUser, userTerritoryAssignments: territoryAssignments, userProductAssignments: productAssignments, products, productPromotionGroups: inactivePGs, allUsers });
    expect(res.eligible).toBe(false);
    expect(res.reason).toBe("PRODUCT_NOT_ELIGIBLE");
  });

  it("Leakage Test Case 8: Inactive Product -> Hidden (NO_ACTIVE_PRODUCT_ASSIGNMENTS)", () => {
    const inactiveProducts: Product[] = [
      { id: "PROD-9188", name: "Test Product", sku: "SKU-9188", promotionGroupId: "test", isActive: false }
    ];

    const physician: Physician = {
      id: "PHY-008",
      name: "Dr. Case 8",
      areaId: "A-713066",
      primaryPromotionGroupId: "test",
      specialty: "Cardiology",
      active: true,
      status: "Active"
    };

    const res = isPhysicianEligibleForUser({ physician, user: repUser, userTerritoryAssignments: territoryAssignments, userProductAssignments: productAssignments, products: inactiveProducts, productPromotionGroups: promotionGroups, allUsers });
    expect(res.eligible).toBe(false);
    expect(res.reason).toBe("NO_ACTIVE_PRODUCT_ASSIGNMENTS");
  });

  it("Leakage Test Case 9: Legacy primaryBrand text only without promotion group -> Hidden (PHYSICIAN_NO_PROMOTION_GROUPS)", () => {
    const physician: Physician = {
      id: "PHY-009",
      name: "Dr. Case 9",
      areaId: "A-713066",
      primaryBrand: "Test Product 9188",
      specialty: "Cardiology",
      active: true,
      status: "Active"
    };

    const res = isPhysicianEligibleForUser({ physician, user: repUser, userTerritoryAssignments: territoryAssignments, userProductAssignments: productAssignments, products, productPromotionGroups: promotionGroups, allUsers });
    expect(res.eligible).toBe(false);
    expect(res.reason).toBe("PHYSICIAN_NO_PROMOTION_GROUPS");
  });

  it("Leakage Test Case 10: Direct assignedRepId without canonical Area authorization -> Hidden (AREA_NOT_ELIGIBLE)", () => {
    const physician: Physician = {
      id: "PHY-010",
      name: "Dr. Case 10",
      assignedRepId: "J37PXq5iqQSjIqXGnDhfPSLKC292",
      areaId: "A-999999",
      primaryPromotionGroupId: "test",
      specialty: "Cardiology",
      active: true,
      status: "Active"
    };

    const res = isPhysicianEligibleForUser({ physician, user: repUser, userTerritoryAssignments: territoryAssignments, userProductAssignments: productAssignments, products, productPromotionGroups: promotionGroups, allUsers });
    expect(res.eligible).toBe(false);
    expect(res.reason).toBe("AREA_NOT_ELIGIBLE");
  });

  // PHARMACY RESTRICTION TEST

  it("Pharmacy Access Certification: Medical Representative DENIED all pharmacy records", () => {
    const pharmacyRecord = {
      id: "PHARM-001",
      name: "Central Pharmacy",
      areaId: "A-713066",
      outstandingBalance: 5000,
      creditLimit: 10000
    };

    const filtered = applySecurityScope(repUser, [pharmacyRecord], territoryAssignments, productAssignments);
    expect(filtered.length).toBe(0);
  });

  // TARGET PROMOTION GROUPS INTERSECTION TEST

  it("Target Promotion Groups: Physician eligible if targetPromotionGroupIds intersects assigned product line", () => {
    const physician: Physician = {
      id: "PHY-TARGET",
      name: "Dr. Target",
      areaId: "A-713066",
      primaryPromotionGroupId: "cardio",
      targetPromotionGroupIds: ["derma", "test"],
      specialty: "Dermatology",
      active: true,
      status: "Active"
    };

    const res = isPhysicianEligibleForUser({ physician, user: repUser, userTerritoryAssignments: territoryAssignments, userProductAssignments: productAssignments, products, productPromotionGroups: promotionGroups, allUsers });
    expect(res.eligible).toBe(true);
  });
});
