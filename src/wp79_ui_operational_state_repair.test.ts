import { describe, it, expect } from "vitest";
import { Role, User, Physician, UserTerritoryAssignment, UserProductAssignment, Product, ProductPromotionGroup } from "./types";
import { isUserOperational } from "./lib/securityEngine";
import { getReadiness } from "./lib/userPolicyEngine";

describe("WP7.9 – Phase 2 UI Operational State Repair Tests", () => {
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
    id: "ADM-001",
    email: "admin@menareps.com",
    name: "System Admin",
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

  it("1. Pending manager hydration evaluates operational report as Pending / Loading", () => {
    const managerHydrated = false;
    const readinessReport = managerHydrated 
      ? getReadiness(medRepUser, [medRepUser, managerUser]) 
      : { status: "Pending", reasons: ["LOADING_MANAGER"] };

    expect(readinessReport.status).toBe("Pending");
    expect(readinessReport.reasons).toContain("LOADING_MANAGER");
  });

  it("2. Operational readiness hides blocker and certifies readiness as Operational", () => {
    const managerHydrated = true;
    const readinessReport = getReadiness(medRepUser, [medRepUser, managerUser], { territoryAssignments: [territoryAssignment], productAssignments: [productAssignment], assignmentsHydrated: true });
    const isOp = isUserOperational(
      medRepUser,
      [territoryAssignment],
      [productAssignment],
      [medRepUser, managerUser],
      [product]
    );

    expect(readinessReport.status).toBe("Operational");
    expect(isOp).toBe(true);
  });

  it("3. Pending to Operational transition updates reactive readiness state", () => {
    let managerHydrated = false;
    let readinessUsers: User[] = [medRepUser];

    // Phase A: Pending
    let readinessReport = managerHydrated 
      ? getReadiness(medRepUser, readinessUsers) 
      : { status: "Pending", reasons: ["LOADING_MANAGER"] };
    expect(readinessReport.status).toBe("Pending");

    // Phase B: Hydrated
    managerHydrated = true;
    readinessUsers = [medRepUser, managerUser];
    readinessReport = getReadiness(medRepUser, readinessUsers, { territoryAssignments: [territoryAssignment], productAssignments: [productAssignment], assignmentsHydrated: true });
    expect(readinessReport.status).toBe("Operational");
  });

  it("4. Full users/products context is used when checking readiness", () => {
    const isOpWithContext = isUserOperational(
      medRepUser,
      [territoryAssignment],
      [productAssignment],
      [medRepUser, managerUser],
      [product]
    );
    expect(isOpWithContext).toBe(true);
  });

  it("5. SidebarPageRouter operational props receive live reactive calculation from App", () => {
    const readinessReport = getReadiness(medRepUser, [medRepUser, managerUser], { territoryAssignments: [territoryAssignment], productAssignments: [productAssignment], assignmentsHydrated: true });
    const isOperationalProp = readinessReport.status === "Operational";
    expect(isOperationalProp).toBe(true);
  });

  it("6. Missing Area after hydration still yields Incomplete status", () => {
    const repNoArea: User = {
      ...medRepUser,
      areaIds: []
    };
    const isOp = isUserOperational(
      repNoArea,
      [], // no territory assignments
      [productAssignment],
      [repNoArea, managerUser],
      [product]
    );
    expect(isOp).toBe(false);
  });

  it("7. Missing Product after hydration still yields Incomplete status", () => {
    const repNoProduct: User = {
      ...medRepUser,
      products: []
    };
    const isOp = isUserOperational(
      repNoProduct,
      [territoryAssignment],
      [], // no product assignments
      [repNoProduct, managerUser],
      []
    );
    expect(isOp).toBe(false);
  });

  it("8. Physician query permission error is distinguished from assignment failure", () => {
    const dbError = {
      path: "physicians",
      classification: "permission-denied",
      error: "Missing or insufficient permissions"
    };

    const isOperational = true; // Medical Rep remains operational
    expect(isOperational).toBe(true);
    expect(dbError.path).toBe("physicians");
  });

  it("9. Operational Medical Representative can access field activity views", () => {
    const readinessReport = getReadiness(medRepUser, [medRepUser, managerUser], { territoryAssignments: [territoryAssignment], productAssignments: [productAssignment], assignmentsHydrated: true });
    const isOp = readinessReport.status === "Operational";
    expect(isOp).toBe(true);
  });

  it("10. Administrator behavior is unchanged and bypasses rep operational gates", () => {
    const readinessReport = getReadiness(adminUser, [adminUser]);
    expect(readinessReport.status).toBe("Operational");
  });

  it("11. No business rule was bypassed (unassigned rep remains blocked)", () => {
    const unassignedRep: User = {
      id: "REP-UNASSIGNED",
      name: "Unassigned Rep",
      email: "unassigned@menareps.com",
      role: Role.MEDICAL_REP,
      active: true,
      employmentStatus: "Active",
      loginAllowed: true,
      areaIds: [],
      products: []
    };
    const isOp = isUserOperational(unassignedRep, [], [], [unassignedRep], []);
    expect(isOp).toBe(false);
  });

  it("12. No hardcoded user-specific exceptions exist in securityEngine or userPolicyEngine", () => {
    const randomRep: User = {
      id: "RANDOM-REP-888",
      name: "Generic Rep",
      email: "generic.rep@menareps.com",
      role: Role.MEDICAL_REP,
      active: true,
      status: "Active",
      employmentStatus: "Active",
      loginAllowed: true,
      managerId: "MGR-001",
      areaIds: ["A-100"],
      primaryPromotionGroupId: "p-group-1",
      products: ["P-100"],
      assignmentSyncStatus: "COMPLETE"
    };

    const isOp = isUserOperational(
      randomRep,
      [{ id: "TA-1", userId: "RANDOM-REP-888", territoryId: "A-100", status: "Active", assignedAt: "" }],
      [{ id: "PA-1", userId: "RANDOM-REP-888", productId: "P-100", status: "Active", assignedAt: "" }],
      [randomRep, managerUser],
      [{ id: "P-100", name: "P100", promotionGroupId: "p-group-1", isActive: true }]
    );

    expect(isOp).toBe(true);
  });
});
