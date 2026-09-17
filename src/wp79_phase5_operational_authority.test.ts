import { describe, it, expect, beforeEach } from "vitest";
import { Role, User, Physician, UserTerritoryAssignment, UserProductAssignment, Product, ProductPromotionGroup } from "./types";
import { isPhysicianEligibleForUser, isUserOperational, setGlobalSecurityContext } from "./lib/securityEngine";
import { getReadiness } from "./lib/userPolicyEngine";

describe("WP7.9 Phase 5 – Operational Authority Verification", () => {
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

  it("1. App Operational result remains true after manager hydration", () => {
    // readinessUsers in App includes manager
    const readinessUsers = [medRepUser, managerUser];
    const report = getReadiness(medRepUser, readinessUsers, { territoryAssignments: [territoryAssignment], productAssignments: [productAssignment], assignmentsHydrated: true });
    const isOp = report.status === "Operational" || isUserOperational(medRepUser, [territoryAssignment], [productAssignment], readinessUsers, [product]);
    expect(isOp).toBe(true);
    expect(report.status).toBe("Operational");
  });

  it("2. PhysicianList receives the same Operational result and uses it", () => {
    const appIsOperational = true;
    // Even if users passed to PhysicianList lacks manager (e.g., [medRepUser] only)
    const usersPassedToPhysicianList = [medRepUser];

    const res = isPhysicianEligibleForUser({
      physician: targetPhysician,
      user: medRepUser,
      userTerritoryAssignments: [territoryAssignment],
      userProductAssignments: [productAssignment],
      products: [product],
      productPromotionGroups: [promotionGroup],
      allUsers: usersPassedToPhysicianList,
      representativeOperational: appIsOperational
    });

    expect(res.eligible).toBe(true);
    expect(res.reason).toBe("ELIGIBLE");
  });

  it("3. PHY-267 is not rejected by a second readiness calculation when representativeOperational is true", () => {
    // Without manager in users, legacy isUserOperational would return false ("MANAGER_MISSING")
    const usersWithoutManager = [medRepUser];
    const legacyCheck = isUserOperational(medRepUser, [territoryAssignment], [productAssignment], usersWithoutManager, [product]);
    expect(legacyCheck).toBe(false);

    // But with explicit representativeOperational = true from App.tsx:
    const res = isPhysicianEligibleForUser({
      physician: targetPhysician,
      user: medRepUser,
      userTerritoryAssignments: [territoryAssignment],
      userProductAssignments: [productAssignment],
      products: [product],
      productPromotionGroups: [promotionGroup],
      allUsers: usersWithoutManager,
      representativeOperational: true
    });

    expect(res.eligible).toBe(true);
    expect(res.reason).toBe("ELIGIBLE");
  });

  it("4. PHY-267 passes Area and Product eligibility", () => {
    const res = isPhysicianEligibleForUser({
      physician: targetPhysician,
      user: medRepUser,
      userTerritoryAssignments: [territoryAssignment],
      userProductAssignments: [productAssignment],
      products: [product],
      productPromotionGroups: [promotionGroup],
      allUsers: [medRepUser],
      representativeOperational: true
    });
    expect(res.eligible).toBe(true);
    expect(res.reason).toBe("ELIGIBLE");
  });

  it("5. Out-of-Area physician remains hidden even when representativeOperational is true", () => {
    const res = isPhysicianEligibleForUser({
      physician: outOfAreaPhysician,
      user: medRepUser,
      userTerritoryAssignments: [territoryAssignment],
      userProductAssignments: [productAssignment],
      products: [product],
      productPromotionGroups: [promotionGroup],
      allUsers: [medRepUser],
      representativeOperational: true
    });
    expect(res.eligible).toBe(false);
    expect(res.reason).toBe("AREA_NOT_ELIGIBLE");
  });

  it("6. Product-mismatched physician remains hidden even when representativeOperational is true", () => {
    const res = isPhysicianEligibleForUser({
      physician: productMismatchedPhysician,
      user: medRepUser,
      userTerritoryAssignments: [territoryAssignment],
      userProductAssignments: [productAssignment],
      products: [product],
      productPromotionGroups: [promotionGroup],
      allUsers: [medRepUser],
      representativeOperational: true
    });
    expect(res.eligible).toBe(false);
    expect(res.reason).toBe("PRODUCT_NOT_ELIGIBLE");
  });

  it("7. When App authoritative operational state is false, physician remains hidden", () => {
    const res = isPhysicianEligibleForUser({
      physician: targetPhysician,
      user: medRepUser,
      userTerritoryAssignments: [territoryAssignment],
      userProductAssignments: [productAssignment],
      products: [product],
      productPromotionGroups: [promotionGroup],
      allUsers: [medRepUser, managerUser],
      representativeOperational: false
    });
    expect(res.eligible).toBe(false);
    expect(res.reason).toBe("REP_NOT_OPERATIONAL");
  });

  it("8. Undefined authoritative state retains legacy readiness calculation", () => {
    // When representativeOperational is undefined, it falls back to isUserOperational using allUsers
    const resWithManager = isPhysicianEligibleForUser({
      physician: targetPhysician,
      user: medRepUser,
      userTerritoryAssignments: [territoryAssignment],
      userProductAssignments: [productAssignment],
      products: [product],
      productPromotionGroups: [promotionGroup],
      allUsers: [medRepUser, managerUser],
      representativeOperational: undefined
    });
    expect(resWithManager.eligible).toBe(true);

    const resWithoutManager = isPhysicianEligibleForUser({
      physician: targetPhysician,
      user: medRepUser,
      userTerritoryAssignments: [territoryAssignment],
      userProductAssignments: [productAssignment],
      products: [product],
      productPromotionGroups: [promotionGroup],
      allUsers: [medRepUser],
      representativeOperational: undefined
    });
    expect(resWithoutManager.eligible).toBe(false);
    expect(resWithoutManager.reason).toBe("REP_NOT_OPERATIONAL");
  });

  it("9. Administrator behavior remains unchanged (national access)", () => {
    const res = isPhysicianEligibleForUser({
      physician: outOfAreaPhysician,
      user: adminUser,
      representativeOperational: true
    });
    expect(res.eligible).toBe(true);
    expect(res.reason).toBe("ELIGIBLE");
  });

  it("10. No hardcoded user exception exists (relies strictly on input parameters)", () => {
    const randomUser: User = {
      ...medRepUser,
      id: "RANDOM-REP-888",
      uid: "RANDOM-REP-888"
    };
    const randomTerritoryAssignment = { ...territoryAssignment, userId: "RANDOM-REP-888" };
    const randomProductAssignment = { ...productAssignment, userId: "RANDOM-REP-888" };

    const res = isPhysicianEligibleForUser({
      physician: targetPhysician,
      user: randomUser,
      userTerritoryAssignments: [randomTerritoryAssignment],
      userProductAssignments: [randomProductAssignment],
      products: [product],
      productPromotionGroups: [promotionGroup],
      allUsers: [randomUser],
      representativeOperational: true
    });
    expect(res.eligible).toBe(true);
  });
});
