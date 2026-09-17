import { describe, it, expect } from "vitest";
import { User } from "../../types";
import { PharmacyVisitDraft } from "./types/domain";
import { validateStep6 } from "./validation/validateStep6";

describe("PharmacyVisitV2 Step 6 (Complete Visit) Engine & Validation", () => {
  const testUser: User = {
    id: "usr_rep_1",
    name: "Test Representative",
    email: "rep@menareps.local",
    role: "Sales Representative" as any,
    areaIds: ["LY-WEST-TRE2"]
  };

  function createValidDraft(): PharmacyVisitDraft {
    return {
      schemaVersion: "2.0",
      draftId: "draft_test_step6_2001",
      repUid: testUser.id,
      companyId: "MENAREPS",
      countryId: "LY",
      areaId: "LY-WEST-TRE2",
      pharmacyId: "ph_101",
      visitPurpose: {
        code: "ORDER_COLLECTION",
        labelEn: "Order & Payment Collection",
        labelAr: "الطلب والتحصيل"
      },
      pharmacySnapshot: {
        id: "ph_101",
        nameEn: "Al-Shifa Central Pharmacy",
        nameAr: "صيدلية الشفاء المركزية",
        type: "Retail",
        areaId: "LY-WEST-TRE2",
        outstandingBalance: 1500
      },
      gps: {
        status: "VERIFIED",
        latitude: 32.8872,
        longitude: 13.1913,
        accuracy: 10,
        timestamp: new Date().toISOString(),
        source: "device"
      },
      order: {
        lines: [
          {
            id: "line_1",
            productId: "PRD-01",
            canonicalProductId: "PRD-01",
            productNameSnapshot: "Panadol Extra 500mg",
            packSnapshot: "20 Tabs",
            quantity: 10,
            unitPricePreview: 15.0,
            lineTotalPreview: 150.0,
            userConfirmed: true,
            isConfirmedByRep: true,
            addedAt: new Date().toISOString()
          }
        ],
        subtotalPreview: 150.0,
        currencyCode: "LYD",
        lastCalculatedAt: new Date().toISOString(),
        isStale: false
      },
      offers: {
        calculation: {
          grossSubtotal: 150.0,
          totalDiscountAmount: 15.0,
          netTotal: 135.0,
          appliedRuleResults: []
        },
        campaignNameSnapshot: "Spring Promotion 10%",
        appliedAt: new Date().toISOString()
      },
      payment: {
        financialContext: {
          pharmacyId: "ph_101",
          pharmacyName: "Al-Shifa Central Pharmacy",
          areaId: "LY-WEST-TRE2",
          outstandingBalanceBefore: 1500,
          creditLimit: 5000,
          isOverdue: false,
          oldestInvoiceDays: 10
        },
        paymentEntry: {
          amount: 0,
          method: "CASH",
          evidenceCount: 0,
          recordedAt: new Date().toISOString()
        }
      },
      stock: {
        noStockRequestRequired: true,
        requestLines: [],
        crmNotes: {
          generalNotes: "Spoke with chief pharmacist. Order placed and cash collected."
        }
      },
      status: "IN_PROGRESS",
      currentStep: 6,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deviceSessionId: "session_test_6",
      localRevision: 1
    };
  }

  it("should validate a completely filled, consistent step 6 draft successfully with zero errors", () => {
    const draft = createValidDraft();
    const result = validateStep6(draft);

    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("should fail step 6 validation if pharmacyId is missing", () => {
    const draft = createValidDraft();
    draft.pharmacyId = "";

    const result = validateStep6(draft);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes("Pharmacy selection"))).toBe(true);
  });

  it("should fail step 6 validation if visit purpose is missing", () => {
    const draft = createValidDraft();
    draft.visitPurpose = { code: "", labelEn: "", labelAr: "" };

    const result = validateStep6(draft);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes("Visit Purpose"))).toBe(true);
  });

  it("should fail step 6 validation if repUid is missing", () => {
    const draft = createValidDraft();
    draft.repUid = "";

    const result = validateStep6(draft);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes("Sales Representative UID"))).toBe(true);
  });

  it("should detect order quantity <= 0 error in step 6 validation", () => {
    const draft = createValidDraft();
    draft.order!.lines[0].quantity = 0;

    const result = validateStep6(draft);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes("Quantity must be greater than 0"))).toBe(true);
  });

  it("should generate non-blocking informational warnings for relationship visit with no order or collection", () => {
    const draft = createValidDraft();
    draft.visitPurpose = {
      code: "RELATIONSHIP_BUILDING",
      labelEn: "Relationship Building",
      labelAr: "بناء العلاقات"
    };
    draft.order = undefined;
    draft.offers = undefined;
    draft.payment = undefined;
    draft.stock = {
      noStockRequestRequired: true,
      requestLines: [],
      crmNotes: {
        generalNotes: ""
      }
    };

    const result = validateStep6(draft);
    expect(result.isValid).toBe(true);
    expect(result.warnings.some((w) => w.includes("No order items added"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("No payment collection recorded"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("No CRM visit summary notes"))).toBe(true);
  });
  it("rejects a positive saved collection without changing the operational draft", () => {
    const draft = createValidDraft();
    draft.payment!.paymentEntry!.amount = 25;
    const before = JSON.stringify(draft);
    const result = validateStep6(draft);
    expect(result.isValid).toBe(false);
    expect(result.errors.some(error => error.includes("Collection recording is not available"))).toBe(true);
    expect(JSON.stringify(draft)).toBe(before);
  });

});
