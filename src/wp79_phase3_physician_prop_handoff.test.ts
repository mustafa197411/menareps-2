import { describe, it, expect, beforeEach } from "vitest";
import { Role, User, Physician, UserTerritoryAssignment, UserProductAssignment, Product, ProductPromotionGroup } from "./types";
import { isPhysicianEligibleForUser, applySecurityScope, setGlobalSecurityContext } from "./lib/securityEngine";

describe("WP7.9 Phase 4 – Physician Eligibility & Context Repair Verification", () => {
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

  const adminUser: User = {
    id: "ADMIN-001",
    email: "admin@menareps.com",
    name: "Super Admin",
    role: Role.SUPER_ADMIN,
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

  beforeEach(() => {
    setGlobalSecurityContext(
      medRepUser,
      [medRepUser, managerUser, adminUser],
      [territoryAssignment],
      [productAssignment],
      [product],
      [promotionGroup]
    );
  });

  const targetPhysician: Physician = {
    id: "PHY-267",
    name: "Test New Test",
    areaId: "A-713066",
    primaryPromotionGroupId: "test",
    specialty: "DERMA - GP",
    active: true,
    status: "Active"
  };

  const outOfAreaPhysician: Physician = {
    id: "PHY-999",
    name: "Dr. Out of Area",
    areaId: "A-999999",
    primaryPromotionGroupId: "test",
    specialty: "Cardiology",
    active: true,
    status: "Active"
  };

  const productMismatchedPhysician: Physician = {
    id: "PHY-MISMATCH",
    name: "Dr. Product Mismatch",
    areaId: "A-713066",
    primaryPromotionGroupId: "unassigned_promo_group",
    specialty: "Dermatology",
    active: true,
    status: "Active"
  };

  const inactivePhysician: Physician = {
    id: "PHY-INACTIVE",
    name: "Dr. Inactive",
    areaId: "A-713066",
    primaryPromotionGroupId: "test",
    specialty: "Dermatology",
    active: false,
    status: "Inactive"
  };

  const deletedPhysician: Physician = {
    id: "PHY-DELETED",
    name: "Dr. Deleted",
    areaId: "A-713066",
    primaryPromotionGroupId: "test",
    specialty: "Dermatology",
    active: true,
    status: "Active",
    isDeleted: true
  };

  it("1. PHY-267 passes using full live context", () => {
    const res = isPhysicianEligibleForUser({
      physician: targetPhysician,
      user: medRepUser,
      userTerritoryAssignments: [territoryAssignment],
      userProductAssignments: [productAssignment],
      products: [product],
      productPromotionGroups: [promotionGroup],
      allUsers: [medRepUser, managerUser]
    });
    expect(res.eligible).toBe(true);
    expect(res.reason).toBe("ELIGIBLE");
  });

  it("2. PHY-267 appears in final displayed IDs", () => {
    const scoped = applySecurityScope(
      medRepUser,
      [targetPhysician],
      [territoryAssignment],
      [productAssignment]
    );
    const displayedIds = scoped.map(p => p.id);
    expect(displayedIds).toContain("PHY-267");
    expect(displayedIds).toHaveLength(1);
  });

  it("3. out-of-Area physician remains hidden", () => {
    const res = isPhysicianEligibleForUser({
      physician: outOfAreaPhysician,
      user: medRepUser,
      userTerritoryAssignments: [territoryAssignment],
      userProductAssignments: [productAssignment],
      products: [product],
      productPromotionGroups: [promotionGroup],
      allUsers: [medRepUser, managerUser]
    });
    expect(res.eligible).toBe(false);
    expect(res.reason).toBe("AREA_NOT_ELIGIBLE");
  });

  it("4. Product-mismatched physician remains hidden", () => {
    const res = isPhysicianEligibleForUser({
      physician: productMismatchedPhysician,
      user: medRepUser,
      userTerritoryAssignments: [territoryAssignment],
      userProductAssignments: [productAssignment],
      products: [product],
      productPromotionGroups: [promotionGroup],
      allUsers: [medRepUser, managerUser]
    });
    expect(res.eligible).toBe(false);
    expect(res.reason).toBe("PRODUCT_NOT_ELIGIBLE");
  });

  it("5. Inactive physician remains hidden", () => {
    const res = isPhysicianEligibleForUser({
      physician: inactivePhysician,
      user: medRepUser,
      userTerritoryAssignments: [territoryAssignment],
      userProductAssignments: [productAssignment],
      products: [product],
      productPromotionGroups: [promotionGroup],
      allUsers: [medRepUser, managerUser]
    });
    expect(res.eligible).toBe(false);
    expect(res.reason).toBe("PHYSICIAN_INACTIVE");
  });

  it("6. Deleted physician remains hidden", () => {
    const res = isPhysicianEligibleForUser({
      physician: deletedPhysician,
      user: medRepUser,
      userTerritoryAssignments: [territoryAssignment],
      userProductAssignments: [productAssignment],
      products: [product],
      productPromotionGroups: [promotionGroup],
      allUsers: [medRepUser, managerUser]
    });
    expect(res.eligible).toBe(false);
    expect(res.reason).toBe("PHYSICIAN_DELETED");
  });

  it("7. Initial empty context updates reactively after hydration", () => {
    // Before hydration (empty context)
    const initialRes = isPhysicianEligibleForUser({
      physician: targetPhysician,
      user: medRepUser,
      userTerritoryAssignments: [],
      userProductAssignments: [],
      products: [],
      productPromotionGroups: [],
      allUsers: []
    });
    expect(initialRes.eligible).toBe(false);

    // After hydration
    const hydratedRes = isPhysicianEligibleForUser({
      physician: targetPhysician,
      user: medRepUser,
      userTerritoryAssignments: [territoryAssignment],
      userProductAssignments: [productAssignment],
      products: [product],
      productPromotionGroups: [promotionGroup],
      allUsers: [medRepUser, managerUser]
    });
    expect(hydratedRes.eligible).toBe(true);
  });

  it("8. No hardcoded physician exception exists (dynamic eligibility)", () => {
    const dynamicPhysician: Physician = {
      id: "PHY-DYNAMIC-123",
      name: "Dr. Dynamic Physician",
      areaId: "A-713066",
      primaryPromotionGroupId: "test",
      specialty: "General",
      active: true,
      status: "Active"
    };
    const res = isPhysicianEligibleForUser({
      physician: dynamicPhysician,
      user: medRepUser,
      userTerritoryAssignments: [territoryAssignment],
      userProductAssignments: [productAssignment],
      products: [product],
      productPromotionGroups: [promotionGroup],
      allUsers: [medRepUser, managerUser]
    });
    expect(res.eligible).toBe(true);
  });

  it("9. Administrator behavior remains unchanged (national access)", () => {
    const records = [targetPhysician, outOfAreaPhysician, productMismatchedPhysician];
    const scoped = applySecurityScope(
      adminUser,
      records,
      [],
      []
    );
    expect(scoped).toHaveLength(3);
  });

  it("10. No authorization is broadened (unassigned areas and mismatched products remain blocked)", () => {
    const records = [targetPhysician, outOfAreaPhysician, productMismatchedPhysician, inactivePhysician, deletedPhysician];
    const eligibleRecords = records.filter(p => {
      return isPhysicianEligibleForUser({
        physician: p,
        user: medRepUser,
        userTerritoryAssignments: [territoryAssignment],
        userProductAssignments: [productAssignment],
        products: [product],
        productPromotionGroups: [promotionGroup],
        allUsers: [medRepUser, managerUser]
      }).eligible;
    });
    expect(eligibleRecords).toHaveLength(1);
    expect(eligibleRecords[0].id).toBe("PHY-267");
  });
});
