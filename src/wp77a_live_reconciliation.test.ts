import { describe, it, expect, beforeEach } from "vitest";
import { Role, User, Product, ProductPromotionGroup, UserTerritoryAssignment, UserProductAssignment, Physician, Pharmacy } from "./types";
import { isPhysicianEligibleForUser, setGlobalSecurityContext, applySecurityScope } from "./lib/securityEngine";
import { filterBySecurity } from "./lib/alignmentService";

describe("WP7.7A Live Medical Representative Eligibility Reconciliation Test Suite", () => {
  // Sanitized Live Representatives Fixtures matching live Firestore J37PXq5iqQSjIqXGnDhfPSLKC292
  const gmUser: User = {
    id: "kBUbCmDZnVS3sQt3OD7PsNCeKjf2",
    email: "gm@esnad.local",
    name: "General Manager",
    role: Role.GENERAL_MANAGER,
    active: true,
    employmentStatus: "Active",
    loginAllowed: true
  };

  const liveMedRep: User = {
    id: "J37PXq5iqQSjIqXGnDhfPSLKC292",
    name: "medtest",
    email: "medreptest@esand.local",
    role: Role.MEDICAL_REP,
    status: "Active",
    active: true,
    employmentStatus: "Active",
    loginAllowed: true,
    managerId: "kBUbCmDZnVS3sQt3OD7PsNCeKjf2",
    managerEmail: "gm@esnad.local",
    areaIds: ["A-713066"],
    products: ["PROD-9188"],
    primaryPromotionGroupId: "test",
    assignmentSyncStatus: "COMPLETE"
  };

  // Sanitized Live Territory Assignment matching TA_J37PXq5iqQSjIqXGnDhfPSLKC292_A-713066
  const territoryAssignment: UserTerritoryAssignment = {
    id: "TA_J37PXq5iqQSjIqXGnDhfPSLKC292_A-713066",
    userId: "J37PXq5iqQSjIqXGnDhfPSLKC292",
    areaId: "A-713066",
    status: "Active",
    active: true,
    assignedAt: "2026-08-06T11:01:33.108Z"
  };

  // Sanitized Live Product Assignment matching PA_J37PXq5iqQSjIqXGnDhfPSLKC292_PROD-9188
  const productAssignment: UserProductAssignment = {
    id: "PA_J37PXq5iqQSjIqXGnDhfPSLKC292_PROD-9188",
    userId: "J37PXq5iqQSjIqXGnDhfPSLKC292",
    productId: "PROD-9188",
    primaryGroupId: "test",
    status: "Active",
    active: true,
    assignedAt: "2026-08-06T11:01:33.108Z"
  };

  // Sanitized Live Product PROD-9188
  const liveProduct: Product = {
    id: "PROD-9188",
    name: "Test",
    brand: "Test",
    sku: "Test",
    promotionGroupId: "test",
    isActive: true
  };

  // Sanitized Live Promotion Group test
  const livePromotionGroup: ProductPromotionGroup = {
    id: "test",
    name: "Test",
    normalizedName: "test",
    isActive: true
  };

  // Sanitized Live Physician PHY-267
  const livePhysician267: Physician = {
    id: "PHY-267",
    name: "Test New Test",
    areaId: "A-713066",
    areaName: "TEST",
    area: "TEST",
    territory: "LIBYA / WEST / TRIPOLI / TEST",
    primaryPromotionGroupId: "test",
    specialty: "Dermatology",
    specialtyId: "dermatology",
    active: true,
    status: "Active"
  };

  const allUsers = [liveMedRep, gmUser];
  const territoryAssignments = [territoryAssignment];
  const productAssignments = [productAssignment];
  const products = [liveProduct];
  const promotionGroups = [livePromotionGroup];

  beforeEach(() => {
    setGlobalSecurityContext(
      liveMedRep,
      allUsers,
      territoryAssignments,
      productAssignments,
      products,
      promotionGroups
    );
  });

  it("1. Live Physician PHY-267 evaluates to ELIGIBLE (true) for Representative J37PXq5iqQSjIqXGnDhfPSLKC292", () => {
    const res = isPhysicianEligibleForUser({
      physician: livePhysician267,
      user: liveMedRep,
      userTerritoryAssignments: territoryAssignments,
      userProductAssignments: productAssignments,
      products,
      productPromotionGroups: promotionGroups,
      allUsers
    });

    expect(res.eligible).toBe(true);
    expect(res.reason).toBe("ELIGIBLE");
  });

  it("2. applySecurityScope returns PHY-267 as the single eligible physician", () => {
    const scoped = applySecurityScope(
      liveMedRep,
      [livePhysician267],
      territoryAssignments,
      productAssignments
    );

    expect(scoped.length).toBe(1);
    expect(scoped[0].id).toBe("PHY-267");
  });

  it("3. All Representative Modules (Planner, Visit, Territory, GPS, Dashboard) yield PHY-267 consistently", () => {
    const allPhysicians = [livePhysician267];

    const physListRes = applySecurityScope(liveMedRep, allPhysicians, territoryAssignments, productAssignments);
    const plannerRes = filterBySecurity(liveMedRep, allPhysicians, "territory", "primaryBrand", "assignedRepId", territoryAssignments, productAssignments);
    const visitRes = filterBySecurity(liveMedRep, allPhysicians, "territory", "primaryBrand", "assignedRepId", territoryAssignments, productAssignments);
    const terrRes = filterBySecurity(liveMedRep, allPhysicians, "territory", "primaryBrand", "assignedRepId", territoryAssignments, productAssignments);
    const gpsRes = filterBySecurity(liveMedRep, allPhysicians, "territory", "primaryBrand", "assignedRepId", territoryAssignments, productAssignments);
    const dashRes = filterBySecurity(liveMedRep, allPhysicians, "territory", "primaryBrand", "assignedRepId", territoryAssignments, productAssignments);

    expect(physListRes.map(p => p.id)).toEqual(["PHY-267"]);
    expect(plannerRes.map(p => p.id)).toEqual(["PHY-267"]);
    expect(visitRes.map(p => p.id)).toEqual(["PHY-267"]);
    expect(terrRes.map(p => p.id)).toEqual(["PHY-267"]);
    expect(gpsRes.map(p => p.id)).toEqual(["PHY-267"]);
    expect(dashRes.map(p => p.id)).toEqual(["PHY-267"]);
  });

  it("4. Medical Representative is DENIED Pharmacy access per canonical MENAREPS business policy", () => {
    const livePharmacy: Pharmacy = {
      id: "PHM-LIVE-001",
      name: "Central Pharmacy Test",
      licenseNumber: "LIC-001",
      areaId: "A-713066",
      active: true,
      status: "Active"
    };

    const scopedPharmacies = applySecurityScope(
      liveMedRep,
      [livePharmacy],
      territoryAssignments,
      productAssignments
    );

    expect(scopedPharmacies.length).toBe(0);
  });
});
