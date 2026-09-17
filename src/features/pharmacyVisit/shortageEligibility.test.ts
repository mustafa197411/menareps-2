import { describe, it, expect, vi } from "vitest";
import { Product, UserProductAssignment } from "../../types";
import { PharmacyVisitDraft } from "./types/domain";
import {
  calculateShortageCandidates,
  generateDeterministicShortageLineId,
  auditWarehouseInventorySource
} from "./services/shortageEligibilityEngine";
import { getEligibleProductsForRep } from "./services/pharmacyProductEligibility";

describe("WP6.4 — Shortage Eligibility & Demand Calculation Engine", () => {
  const actorUid = "usr_rep_100";

  const sampleProducts: Product[] = [
    {
      id: "PROD-1",
      name: "Panadol Extra 500mg",
      category: "Analgesics",
      packageSize: "20 Tablets",
      isActive: true,
      price: 15.5,
      stock: 100
    },
    {
      id: "PROD-2",
      name: "Amoxil 500mg",
      category: "Antibiotics",
      packageSize: "12 Capsules",
      isActive: true,
      price: 25.0,
      stock: 10
    },
    {
      id: "PROD-3",
      name: "Augmentin 1g",
      category: "Antibiotics",
      packageSize: "14 Tablets",
      isActive: true,
      price: 45.0,
      stock: 0
    },
    {
      id: "PROD-4",
      name: "Cataflam 50mg",
      category: "Analgesics",
      packageSize: "20 Tablets",
      isActive: true,
      price: 20.0,
      stock: 50
    }
  ];

  const sampleAssignments: UserProductAssignment[] = [
    { id: "upa_1", userId: actorUid, productId: "PROD-1", status: "Active" },
    { id: "upa_2", userId: actorUid, productId: "PROD-2", status: "Active" },
    { id: "upa_3", userId: actorUid, productId: "PROD-3", status: "Active" },
    { id: "upa_4", userId: actorUid, productId: "PROD-4", status: "Active" }
  ];

  function createDraft(orderLines: any[] = []): PharmacyVisitDraft {
    return {
      schemaVersion: "2.0",
      draftId: "visit_draft_200",
      repUid: actorUid,
      companyId: "MENAREPS",
      countryId: "LY",
      areaId: "LY-WEST-TRE2",
      pharmacyId: "ph_101",
      visitPurpose: {
        code: "RELATIONSHIP_BUILDING",
        labelEn: "Relationship Building",
        labelAr: "بناء العلاقات"
      },
      pharmacySnapshot: {
        id: "ph_101",
        nameEn: "Al-Shifa Pharmacy",
        nameAr: "صيدلية الشفاء",
        type: "Retail",
        areaId: "LY-WEST-TRE2",
        outstandingBalance: 1200
      },
      status: "IN_PROGRESS",
      currentStep: 5,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deviceSessionId: "session_200",
      localRevision: 1,
      payment: {
        financialContext: {
          pharmacyId: "ph_101",
          pharmacyName: "Al-Shifa Pharmacy",
          areaId: "LY-WEST-TRE2",
          outstandingBalance: 1200,
          creditLimit: 5000,
          availableCredit: 3800,
          paymentTerms: "CREDIT_30",
          allowCreditOrders: true
        },
        selectedPaymentMethod: "CREDIT",
        overrideJustification: ""
      },
      order: {
        lines: orderLines,
        subtotalPreview: 100,
        currency: "LYD",
        updatedAt: new Date().toISOString()
      }
    };
  }

  it("Test Case 7 & 11 (Case D): Unrequested assigned products are NOT included in SHORTAGE_CANDIDATES", () => {
    const report = getEligibleProductsForRep(actorUid, sampleAssignments, sampleProducts);
    expect(report.eligibleProducts.length).toBe(4); // 4 eligible assigned products for Order Entry

    // Draft has NO requested order lines in Step 2
    const draft = createDraft([]);
    const candidates = calculateShortageCandidates(draft, sampleProducts);

    // Step 5 must NOT inherit all 4 assigned products
    expect(candidates.length).toBe(0);
  });

  it("Test Case 8 (Case A): Order demand line requested 10, fulfilled 10 => unfulfilledQty = 0 => excluded from shortage candidates", () => {
    const draft = createDraft([
      {
        id: "line_1",
        canonicalProductId: "PROD-1",
        quantity: 10,
        fulfilledQty: 10,
        productNameSnapshot: "Panadol Extra 500mg"
      }
    ]);

    const candidates = calculateShortageCandidates(draft, sampleProducts);
    expect(candidates.find((c) => c.productId === "PROD-1")).toBeUndefined();
  });

  it("Test Case 9 (Case B): Order demand line requested 50, warehouse/approved 10 => unfulfilledQty = 40 => included in shortage candidates", () => {
    const draft = createDraft([
      {
        id: "line_2",
        canonicalProductId: "PROD-2",
        quantity: 50,
        fulfilledQty: 10,
        warehouseAvailableQty: 10,
        approvedOrderQty: 10,
        productNameSnapshot: "Amoxil 500mg"
      }
    ]);

    const candidates = calculateShortageCandidates(draft, sampleProducts);
    const cand = candidates.find((c) => c.productId === "PROD-2");

    expect(cand).toBeDefined();
    expect(cand?.requestedQty).toBe(50);
    expect(cand?.fulfilledQty).toBe(10);
    expect(cand?.unfulfilledQty).toBe(40);
  });

  it("Test Case 10 (Case C): Order demand line requested 10, warehouse available 0 => unfulfilledQty = 10 => included in shortage candidates", () => {
    const draft = createDraft([
      {
        id: "line_3",
        canonicalProductId: "PROD-3",
        quantity: 10,
        fulfilledQty: 0,
        warehouseAvailableQty: 0,
        productNameSnapshot: "Augmentin 1g"
      }
    ]);

    const candidates = calculateShortageCandidates(draft, sampleProducts);
    const cand = candidates.find((c) => c.productId === "PROD-3");

    expect(cand).toBeDefined();
    expect(cand?.requestedQty).toBe(10);
    expect(cand?.fulfilledQty).toBe(0);
    expect(cand?.unfulfilledQty).toBe(10);
  });

  it("Test Case 13, 14 & 15: Deterministic ID generation prevents duplicates and preserves metrics", () => {
    const visitId = "visit_draft_200";
    const orderId = "order_999";
    const productId = "PROD-2";

    const lineId1 = generateDeterministicShortageLineId(visitId, orderId, productId);
    const lineId2 = generateDeterministicShortageLineId(visitId, orderId, productId);

    expect(lineId1).toBe("sl_visit_draft_200_order_999_PROD-2");
    expect(lineId1).toBe(lineId2);
  });

  it("Test Case 16: Order Operations allocation reduction updates unfulfilled quantity correctly", () => {
    const draft = createDraft([
      {
        id: "line_2",
        canonicalProductId: "PROD-2",
        quantity: 50,
        approvedOrderQty: 5, // Reduced from 50 to 5 by Order Operations
        productNameSnapshot: "Amoxil 500mg"
      }
    ]);

    const candidates = calculateShortageCandidates(draft, sampleProducts);
    const cand = candidates.find((c) => c.productId === "PROD-2");

    expect(cand?.unfulfilledQty).toBe(45);
  });

  it("Test Case 18: Audit log prints WAREHOUSE_INVENTORY_SOURCE_AUDIT_JSON", () => {
    const consoleSpy = vi.spyOn(console, "info");
    auditWarehouseInventorySource("LY");

    expect(consoleSpy).toHaveBeenCalledWith(
      "[WAREHOUSE_INVENTORY_SOURCE_AUDIT_JSON]",
      expect.stringContaining('"countryId":"LY"')
    );
    consoleSpy.mockRestore();
  });
});
