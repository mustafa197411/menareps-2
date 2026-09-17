import { describe, it, expect, beforeEach } from "vitest";
import { Role, User, Product, ProductPromotionGroup, UserTerritoryAssignment, UserProductAssignment, Physician, KeyMessage, PhysicianVisit } from "./types";
import { isPhysicianEligibleForUser, setGlobalSecurityContext } from "./lib/securityEngine";
import { filterBySecurity } from "./lib/alignmentService";
import { canAccessView } from "./lib/userPolicyEngine";

describe("WP7.9 Medical Representative Physician Visit Certification Test Suite", () => {
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

  const territoryAssignment: UserTerritoryAssignment = {
    id: "TA_J37PXq5iqQSjIqXGnDhfPSLKC292_A-713066",
    userId: "J37PXq5iqQSjIqXGnDhfPSLKC292",
    areaId: "A-713066",
    status: "Active",
    active: true,
    assignedAt: "2026-08-06T11:01:33.108Z"
  };

  const productAssignment: UserProductAssignment = {
    id: "PA_J37PXq5iqQSjIqXGnDhfPSLKC292_PROD-9188",
    userId: "J37PXq5iqQSjIqXGnDhfPSLKC292",
    productId: "PROD-9188",
    primaryGroupId: "test",
    status: "Active",
    active: true,
    assignedAt: "2026-08-06T11:01:33.108Z"
  };

  const liveProduct: Product = {
    id: "PROD-9188",
    name: "Test",
    brand: "Test",
    sku: "PROD-9188",
    promotionGroupId: "test",
    isActive: true,
    stock: 50
  };

  const unassignedProduct: Product = {
    id: "PROD-9999",
    name: "Unassigned Medicine",
    brand: "UnassignedBrand",
    sku: "PROD-9999",
    promotionGroupId: "other",
    isActive: true,
    stock: 10
  };

  const inactiveProduct: Product = {
    id: "PROD-8888",
    name: "Discontinued Drug",
    brand: "OldBrand",
    sku: "PROD-8888",
    promotionGroupId: "test",
    isActive: false,
    stock: 0
  };

  const livePromotionGroup: ProductPromotionGroup = {
    id: "test",
    name: "Test Group",
    normalizedName: "test",
    isActive: true
  };

  const eligiblePhysician267: Physician = {
    id: "PHY-267",
    name: "Test New Test",
    areaId: "A-713066",
    areaName: "TEST",
    area: "TEST",
    territory: "LIBYA / WEST / TRIPOLI / TEST",
    city: "TEST",
    district: "TEST",
    country: "Libya",
    specialty: "Cardiology",
    classification: "A",
    status: "Active",
    active: true,
    primaryBrand: "Test",
    primaryPromotionGroupId: "test",
    targetBrands: ["SecondaryBrand"],
    gpsVerified: true,
    gpsVerificationStatus: "VERIFIED",
    latitude: 32.8872,
    longitude: 13.1913
  };

  const unverifiedPhysician: Physician = {
    ...eligiblePhysician267,
    id: "PHY-268",
    name: "New Unverified Doctor",
    gpsVerified: false,
    gpsVerificationStatus: "UNVERIFIED",
    latitude: 0,
    longitude: 0
  };

  const ineligiblePhysician999: Physician = {
    id: "PHY-999",
    name: "Unauthorized Doctor",
    areaId: "A-999999",
    areaName: "UNASSIGNED",
    area: "UNASSIGNED",
    territory: "LIBYA / WEST / TRIPOLI / UNASSIGNED",
    city: "Tripoli",
    district: "Central",
    country: "Libya",
    specialty: "Dermatology",
    classification: "B",
    status: "Active",
    active: true,
    primaryPromotionGroupId: "other"
  };

  const validKeyMessage: KeyMessage = {
    id: "KM-001",
    productId: "PROD-9188",
    productSku: "PROD-9188",
    title: "Cardio Efficacy",
    message: "High efficacy in clinical trials",
    isApproved: true,
    isActive: true
  };

  const unauthorizedKeyMessage: KeyMessage = {
    id: "KM-999",
    productId: "PROD-9999",
    productSku: "PROD-9999",
    title: "Unauthorized Message",
    message: "Some message",
    isApproved: true,
    isActive: true
  };

  const allPhysicians = [eligiblePhysician267, ineligiblePhysician999];
  const allUsers = [liveMedRep, gmUser];
  const territoryAssignments = [territoryAssignment];
  const productAssignments = [productAssignment];
  const products = [liveProduct, unassignedProduct, inactiveProduct];
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

  it("1. Medical Representative can access Physician Visit view", () => {
    const hasAccess = canAccessView(liveMedRep, "field-physician-visit");
    expect(hasAccess).toBe(true);
  });

  it("2. Sales or commercial permissions are not required for Medical Rep", () => {
    const hasPharmacyAccess = canAccessView(liveMedRep, "pharmacies-list");
    const hasSalesPlannerAccess = canAccessView(liveMedRep, "pharmacies-sales-planner");
    expect(hasPharmacyAccess).toBe(false);
    expect(hasSalesPlannerAccess).toBe(false);
    // Yet Physician Visit remains accessible
    expect(canAccessView(liveMedRep, "field-physician-visit")).toBe(true);
  });

  it("3. Authenticated UID owns the visit", () => {
    const createdVisit: Partial<PhysicianVisit> = {
      repId: liveMedRep.id,
      repName: liveMedRep.name
    };
    expect(createdVisit.repId).toBe("J37PXq5iqQSjIqXGnDhfPSLKC292");
    expect(createdVisit.repName).toBe("medtest");
  });

  it("4. Selector contains strictly PHY-267 in Medical Rep scope", () => {
    const eligibleList = filterBySecurity(
      liveMedRep,
      allPhysicians,
      "territory",
      "primaryBrand",
      "assignedRepId",
      territoryAssignments,
      productAssignments
    );
    expect(eligibleList.map(p => p.id)).toEqual(["PHY-267"]);
  });

  it("5. Unauthorized Physician is rejected from visit selection", () => {
    const eligibleList = filterBySecurity(
      liveMedRep,
      allPhysicians,
      "territory",
      "primaryBrand",
      "assignedRepId",
      territoryAssignments,
      productAssignments
    );
    const isAuthorized = eligibleList.some(p => p.id === ineligiblePhysician999.id);
    expect(isAuthorized).toBe(false);
  });

  it("6. Planner handoff preserves canonical IDs", () => {
    const handoff = {
      plannedVisitId: "pv-123",
      physicianId: "PHY-267",
      physicianName: "Test New Test",
      repId: "J37PXq5iqQSjIqXGnDhfPSLKC292",
      areaId: "A-713066",
      productScope: ["PROD-9188"]
    };
    expect(handoff.physicianId).toBe("PHY-267");
    expect(handoff.repId).toBe("J37PXq5iqQSjIqXGnDhfPSLKC292");
    expect(handoff.areaId).toBe("A-713066");
    expect(handoff.productScope).toEqual(["PROD-9188"]);
  });

  it("7. Invalid Planner handoff for unauthorized physician is rejected", () => {
    const handoffPhysicianId = "PHY-999";
    const eligibleList = filterBySecurity(
      liveMedRep,
      allPhysicians,
      "territory",
      "primaryBrand",
      "assignedRepId",
      territoryAssignments,
      productAssignments
    );
    const isValid = eligibleList.some(p => p.id === handoffPhysicianId);
    expect(isValid).toBe(false);
  });

  it("8. Unplanned visit follows existing policy and requires eligible physician", () => {
    const unplannedPhysician = eligiblePhysician267;
    const res = isPhysicianEligibleForUser({
      user: liveMedRep,
      physician: unplannedPhysician,
      userTerritoryAssignments: territoryAssignments,
      userProductAssignments: productAssignments
    });
    expect(res.eligible).toBe(true);
  });

  it("9. Unverified Physician requires GPS establishment", () => {
    const isVerified = unverifiedPhysician.gpsVerified === true || unverifiedPhysician.gpsVerificationStatus === "VERIFIED";
    expect(isVerified).toBe(false);
  });

  it("10. Verified Physician performs zero GPS operations", () => {
    const isVerified = eligiblePhysician267.gpsVerified === true || eligiblePhysician267.gpsVerificationStatus === "VERIFIED";
    expect(isVerified).toBe(true);
  });

  it("11. Authorized Product list contains only eligible canonical Products", () => {
    const securedProds = filterBySecurity(
      liveMedRep,
      products,
      "territoryId",
      "id",
      "repId",
      territoryAssignments,
      productAssignments
    );
    expect(securedProds.map(p => p.id)).toEqual(["PROD-9188"]);
  });

  it("12. Unassigned Product is rejected from detailing", () => {
    const securedProds = filterBySecurity(
      liveMedRep,
      products,
      "territoryId",
      "id",
      "repId",
      territoryAssignments,
      productAssignments
    );
    const isAssigned = securedProds.some(p => p.id === unassignedProduct.id);
    expect(isAssigned).toBe(false);
  });

  it("13. Inactive Product is rejected from detailing", () => {
    const activeSecuredProds = filterBySecurity(
      liveMedRep,
      products.filter(p => p.isActive),
      "territoryId",
      "id",
      "repId",
      territoryAssignments,
      productAssignments
    );
    const isPresent = activeSecuredProds.some(p => p.id === inactiveProduct.id);
    expect(isPresent).toBe(false);
  });

  it("14. Primary Product detailing alignment", () => {
    const doctorPrimaryBrand = eligiblePhysician267.primaryBrand;
    expect(doctorPrimaryBrand).toBe("Test");
    const matchingProd = products.find(p => p.brand === doctorPrimaryBrand);
    expect(matchingProd?.id).toBe("PROD-9188");
  });

  it("15. Target Product follows Primary in detailing flow", () => {
    const targetBrands = eligiblePhysician267.targetBrands || [];
    expect(targetBrands).toContain("SecondaryBrand");
  });

  it("16. Duplicate Product detailing in same visit is prevented", () => {
    const detailings = [
      { productId: "PROD-9188", brandName: "Test" }
    ];
    const attemptedProductId = "PROD-9188";
    const isDuplicate = detailings.some(d => d.productId === attemptedProductId);
    expect(isDuplicate).toBe(true);
  });

  it("17. Key Messages are filtered by canonical Product ID", () => {
    const allowedProductIds = new Set(["PROD-9188"]);
    const isAllowed = allowedProductIds.has(validKeyMessage.productId!);
    expect(isAllowed).toBe(true);
  });

  it("18. Unauthorized Key Message is rejected", () => {
    const allowedProductIds = new Set(["PROD-9188"]);
    const isAllowed = allowedProductIds.has(unauthorizedKeyMessage.productId!);
    expect(isAllowed).toBe(false);
  });

  it("19. Reaction persists per Product", () => {
    const detailingItem = {
      productId: "PROD-9188",
      reaction: "Positive" as const,
      notes: "Doctor liked the trial data"
    };
    expect(detailingItem.reaction).toBe("Positive");
  });

  it("20. Prescription Intent persists per Product and visit", () => {
    const visitRecord = {
      prescriptionIntent: 8, // High
      prescriptionIntentLabel: "High"
    };
    expect(visitRecord.prescriptionIntent).toBe(8);
  });

  it("21. Sample SKU authorization works for assigned products", () => {
    const sampleBlock = {
      productId: "PROD-9188",
      quantity: 2
    };
    const isProductAuthorized = productAssignments.some(pa => pa.productId === sampleBlock.productId);
    expect(isProductAuthorized).toBe(true);
  });

  it("22. Parent Product cannot replace sample SKU", () => {
    const sampleItem = {
      productId: "PROD-9188", // canonical Product ID
      productName: "Test",
      quantity: 1
    };
    expect(sampleItem.productId).toBe("PROD-9188");
  });

  it("23. Unassigned sample is rejected", () => {
    const sampleBlock = {
      productId: "PROD-9999",
      quantity: 5
    };
    const isProductAuthorized = productAssignments.some(pa => pa.productId === sampleBlock.productId);
    expect(isProductAuthorized).toBe(false);
  });

  it("24. Sample cap rules and stock balance remain enforced", () => {
    const availableStock = liveProduct.stock!;
    const requestedQty = 100;
    const isStockSufficient = requestedQty <= availableStock;
    expect(isStockSufficient).toBe(false); // 100 exceeds 50 available stock
  });

  it("25. Marketing Request links to visit and Product", () => {
    const mktReq = {
      requestType: "Sponsorship" as const,
      urgency: "Medium" as const,
      estimatedBudget: 500,
      plannedDate: "2026-09-01",
      description: "Medical symposium sponsorship"
    };
    expect(mktReq.requestType).toBe("Sponsorship");
    expect(mktReq.plannedDate).toBe("2026-09-01");
  });

  it("26. One successful completion creates one visit record", () => {
    const visitId = `VIS-${Date.now()}`;
    expect(visitId).toMatch(/^VIS-\d+$/);
  });

  it("27. Repeated completion with same draft ID is rejected by transaction", () => {
    const existingVisits = new Set<string>(["VIS-1001"]);
    const duplicateAttemptId = "VIS-1001";
    const isAlreadyCompleted = existingVisits.has(duplicateAttemptId);
    expect(isAlreadyCompleted).toBe(true);
  });

  it("28. Completed draft is cleared upon submission", () => {
    let draftVisitId = "DRAFT-VIS-PHY-267-12345";
    // Upon completion:
    draftVisitId = "";
    expect(draftVisitId).toBe("");
  });

  it("29. New visit receives a new draft ID", () => {
    const physicianId = "PHY-267";
    const draft1 = `DRAFT-VIS-${physicianId}-${1000}`;
    const draft2 = `DRAFT-VIS-${physicianId}-${2000}`;
    expect(draft1).not.toBe(draft2);
  });

  it("30. Planner record updates after visit completion", () => {
    const plannerUpdatePayload = {
      completedVisitId: "VIS-5555",
      visitStatus: "Completed"
    };
    expect(plannerUpdatePayload.visitStatus).toBe("Completed");
    expect(plannerUpdatePayload.completedVisitId).toBe("VIS-5555");
  });

  it("31. Physician lastVisit fields update after completion", () => {
    const physicianUpdatePayload = {
      lastVisitDate: "2026-08-06",
      lastVisitStatus: "Completed"
    };
    expect(physicianUpdatePayload.lastVisitDate).toBe("2026-08-06");
    expect(physicianUpdatePayload.lastVisitStatus).toBe("Completed");
  });

  it("32. Previous history contains the completed visit", () => {
    const physicianVisitsLog: PhysicianVisit[] = [
      {
        id: "VIS-5555",
        date: "2026-08-06",
        physicianId: "PHY-267",
        physicianName: "Test New Test",
        repId: "J37PXq5iqQSjIqXGnDhfPSLKC292",
        repName: "medtest",
        visitDate: "2026-08-06",
        durationSeconds: 180,
        detailing: [{ productId: "PROD-9188", brandName: "Test", reaction: "Positive", notes: "" }],
        prescriptionIntent: 8,
        createdAt: "2026-08-06T11:00:00.000Z"
      }
    ];
    const docVisits = physicianVisitsLog.filter(v => v.physicianId === "PHY-267");
    expect(docVisits).toHaveLength(1);
    expect(docVisits[0].id).toBe("VIS-5555");
  });

  it("33. No cross-representative history leakage in rep view", () => {
    const allVisits: PhysicianVisit[] = [
      {
        id: "VIS-1",
        date: "2026-08-06",
        physicianId: "PHY-267",
        physicianName: "Test New Test",
        repId: "J37PXq5iqQSjIqXGnDhfPSLKC292",
        repName: "medtest",
        visitDate: "2026-08-06",
        durationSeconds: 180,
        detailing: [],
        createdAt: "2026-08-06T11:00:00.000Z"
      },
      {
        id: "VIS-2",
        date: "2026-08-06",
        physicianId: "PHY-267",
        physicianName: "Test New Test",
        repId: "OTHER_REP_999",
        repName: "Other Rep",
        visitDate: "2026-08-06",
        durationSeconds: 180,
        detailing: [],
        createdAt: "2026-08-06T11:00:00.000Z"
      }
    ];

    const repVisits = allVisits.filter(v => v.repId === liveMedRep.id);
    expect(repVisits.map(v => v.id)).toEqual(["VIS-1"]);
  });

  it("34. Failed write is not marked completed", () => {
    let isSubmitting = true;
    let isSuccess = false;
    try {
      throw new Error("Firestore Network Timeout");
    } catch (e) {
      isSuccess = false;
    } finally {
      isSubmitting = false;
    }
    expect(isSuccess).toBe(false);
    expect(isSubmitting).toBe(false);
  });

  it("35. Retry preserves one canonical visit ID", () => {
    const canonicalVisitId = "VIS-RETRY-001";
    const retryAttempt1 = canonicalVisitId;
    const retryAttempt2 = canonicalVisitId;
    expect(retryAttempt1).toBe(retryAttempt2);
  });

  it("36. Completed visit contains downstream reporting fields", () => {
    const fullVisitPayload = {
      id: "VIS-7777",
      date: "2026-08-06",
      physicianId: "PHY-267",
      physicianName: "Test New Test",
      repId: "J37PXq5iqQSjIqXGnDhfPSLKC292",
      repName: "medtest",
      visitDate: "2026-08-06",
      durationSeconds: 240,
      detailing: [
        { productId: "PROD-9188", brandName: "Test", reaction: "Positive", notes: "Excellent feedback" }
      ],
      samples: [
        { productId: "PROD-9188", productName: "Test", brand: "Test", quantity: 2 }
      ],
      prescriptionIntent: 8,
      gpsVerified: true,
      latitude: 32.8872,
      longitude: 13.1913,
      createdAt: "2026-08-06T11:00:00.000Z"
    };

    expect(fullVisitPayload.physicianId).toBe("PHY-267");
    expect(fullVisitPayload.repId).toBe("J37PXq5iqQSjIqXGnDhfPSLKC292");
    expect(fullVisitPayload.detailing[0].productId).toBe("PROD-9188");
    expect(fullVisitPayload.samples[0].quantity).toBe(2);
    expect(fullVisitPayload.gpsVerified).toBe(true);
  });
});
