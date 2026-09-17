import { describe, it, expect } from "vitest";
import { getReadiness, validateManager } from "./lib/userPolicyEngine";
import { isUserOperational, setGlobalSecurityContext } from "./lib/securityEngine";
import { getActiveCanonicalAssignmentsForUser, getAssignmentOperationalState } from "./lib/productAssignmentService";
import { User, Role, UserTerritoryAssignment, UserProductAssignment, Product } from "./types";

describe("WP7.6 Phase 2 - Medical Representative Assignment Engine Certification", () => {
  const mockManager: User = {
    id: "kBUbCmDZnVS3sQt3OD7PsNCeKjf2",
    email: "gm@esnad.local",
    name: "GM",
    role: Role.GENERAL_MANAGER,
    active: true,
    employmentStatus: "Active",
    loginAllowed: true
  };

  const canonicalMedRep: User = {
    id: "J37PXq5iqQSjIqXGnDhfPSLKC292",
    email: "medreptest@esand.local",
    name: "medtest",
    role: Role.MEDICAL_REP,
    status: "Active",
    active: true,
    employmentStatus: "Active",
    loginAllowed: true,
    managerId: "kBUbCmDZnVS3sQt3OD7PsNCeKjf2",
    managerEmail: "gm@esnad.local",
    areaIds: ["A-713066"],
    areaNames: ["TEST"],
    territory: "TEST",
    territories: ["TEST"],
    district: "WEST",
    city: "TRIPOLI",
    country: "LIBYA",
    primaryPromotionGroupId: "test",
    products: ["PROD-9188"],
    assignmentSyncStatus: "COMPLETE"
  };

  const mockTerritoryAssignments: UserTerritoryAssignment[] = [
    {
      id: "TA_J37PXq5iqQSjIqXGnDhfPSLKC292_A-713066",
      assignmentId: "TA_J37PXq5iqQSjIqXGnDhfPSLKC292_A-713066",
      userId: "J37PXq5iqQSjIqXGnDhfPSLKC292",
      areaId: "A-713066",
      territoryId: "A-713066",
      territoryName: "TEST",
      status: "Active",
      active: true,
      assignedBy: "admin",
      assignedAt: "2026-08-06T11:01:33.108Z"
    }
  ];

  const mockProductAssignments: UserProductAssignment[] = [
    {
      id: "PA_J37PXq5iqQSjIqXGnDhfPSLKC292_PROD-9188",
      assignmentId: "PA_J37PXq5iqQSjIqXGnDhfPSLKC292_PROD-9188",
      userId: "J37PXq5iqQSjIqXGnDhfPSLKC292",
      productId: "PROD-9188",
      productName: "PROD-9188",
      productGroupId: "test",
      primaryGroupId: "test",
      status: "Active",
      active: true,
      userRole: Role.MEDICAL_REP,
      assignedBy: "admin",
      assignedAt: "2026-08-06T11:01:33.108Z"
    }
  ];

  const mockProducts: Product[] = [
    {
      id: "PROD-9188",
      name: "Test Product",
      sku: "Test",
      promotionGroupId: "test",
      promotionGroupName: "Test",
      isActive: true,
      stock: 500
    } as Product
  ];

  const allUsersList = [mockManager, canonicalMedRep];

  it("1. Validates Manager Relationship and Hierarchy", () => {
    const mgrValidation = validateManager(canonicalMedRep, allUsersList);
    expect(mgrValidation.isValid).toBe(true);
    expect(mgrValidation.reason).toBeUndefined();
  });

  it("2. Validates Active Canonical Product Assignments selector", () => {
    const report = getActiveCanonicalAssignmentsForUser({
      assignments: mockProductAssignments,
      userId: canonicalMedRep.id,
      products: mockProducts
    });
    expect(report.productIds).toEqual(["PROD-9188"]);
    expect(report.invalidCount).toBe(0);
    expect(report.inactiveCount).toBe(0);
    expect(report.missingProductCount).toBe(0);
    expect(report.duplicateCount).toBe(0);
  });

  it("3. Validates Assignment Synchronization Operational State", () => {
    const state = getAssignmentOperationalState(canonicalMedRep);
    expect(state.allowed).toBe(true);
    expect(state.state).toBe("READY");
  });

  it("4. Certifies getReadiness returns Operational with COMPLETE reason", () => {
    const readiness = getReadiness(canonicalMedRep, allUsersList, { territoryAssignments: mockTerritoryAssignments, productAssignments: mockProductAssignments, assignmentsHydrated: true });
    expect(readiness.status).toBe("Operational");
    expect(readiness.reasons).toEqual(["COMPLETE"]);
  });

  it("5. Certifies isUserOperational with passed-in users and products list", () => {
    setGlobalSecurityContext(canonicalMedRep, allUsersList, mockTerritoryAssignments, mockProductAssignments, mockProducts);
    const isOp = isUserOperational(
      canonicalMedRep,
      mockTerritoryAssignments,
      mockProductAssignments,
      allUsersList,
      mockProducts
    );
    expect(isOp).toBe(true);
  });

  it("6. Rejects readiness if Area Assignment is missing", () => {
    const incompleteRep = { ...canonicalMedRep, areaIds: [], territories: [] };
    const readiness = getReadiness(incompleteRep, allUsersList, { territoryAssignments: [], productAssignments: mockProductAssignments, assignmentsHydrated: true });
    expect(readiness.status).toBe("Incomplete");
    expect(readiness.reasons).toContain("AREA_ASSIGNMENT_MISSING");
  });

  it("7. Rejects readiness if Primary Promotion Group is missing", () => {
    const incompleteRep = { ...canonicalMedRep, primaryPromotionGroupId: "" };
    const readiness = getReadiness(incompleteRep, allUsersList, { territoryAssignments: mockTerritoryAssignments, productAssignments: mockProductAssignments, assignmentsHydrated: true });
    expect(readiness.status).toBe("Incomplete");
    expect(readiness.reasons).toContain("PRIMARY_PROMOTION_GROUP_MISSING");
  });

  it("8. Rejects readiness if Product Assignment is missing", () => {
    const incompleteRep = { ...canonicalMedRep, products: [] };
    const readiness = getReadiness(incompleteRep, allUsersList, { territoryAssignments: mockTerritoryAssignments, productAssignments: [], assignmentsHydrated: true });
    expect(readiness.status).toBe("Incomplete");
    expect(readiness.reasons).toContain("PRODUCT_ASSIGNMENT_MISSING");
  });

  it("9. Handles PENDING or FAILED assignmentSyncStatus correctly", () => {
    const failedRep = { ...canonicalMedRep, assignmentSyncStatus: "FAILED" as const };
    const failedReadiness = getReadiness(failedRep, allUsersList, { territoryAssignments: mockTerritoryAssignments, productAssignments: mockProductAssignments, assignmentsHydrated: true });
    expect(failedReadiness.status).toBe("Incomplete");
    expect(failedReadiness.reasons).toContain("ASSIGNMENT_SYNC_FAILED");

    const pendingRep = { ...canonicalMedRep, assignmentSyncStatus: "PENDING" as const };
    const pendingReadiness = getReadiness(pendingRep, allUsersList, { territoryAssignments: mockTerritoryAssignments, productAssignments: mockProductAssignments, assignmentsHydrated: true });
    expect(pendingReadiness.status).toBe("Pending");
    expect(pendingReadiness.reasons).toContain("ASSIGNMENT_SYNC_PENDING");
  });
});
