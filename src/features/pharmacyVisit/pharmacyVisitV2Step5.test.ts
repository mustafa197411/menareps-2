import { describe, it, expect, vi } from "vitest";
import { User, Product, UserProductAssignment } from "../../types";
import { PharmacyVisitDraft, PharmacyStockRequestLine, PharmacyVisitStockState } from "./types/domain";
import { pharmacyVisitReducer } from "./state/pharmacyVisitReducer";
import { getEligibleStockProductsForRep } from "./services/pharmacyProductEligibility";
import { validateStep5 } from "./validation/validateStep5";
import { parsePositivePackQuantity } from "./steps/Step5StockAndNotes";

describe("PharmacyVisitV2 Step 5 (Stock Requests & Field Notes) Engine", () => {
  it("accepts default and larger whole-pack quantities without an arbitrary maximum", () => {
    expect(parsePositivePackQuantity("1")).toBe(1);
    expect(parsePositivePackQuantity("12")).toBe(12);
  });

  it.each(["", "0", "-1", "1.5"])("rejects invalid pack quantity %j", value => {
    expect(parsePositivePackQuantity(value)).toBeNull();
  });

  const testUser: User = {
    id: "usr_rep_1",
    name: "Test Rep",
    email: "rep@esnad.local",
    role: "Sales Representative" as any,
    areaIds: ["LY-WEST-TRE2"]
  };

  const sampleProducts: Product[] = [
    {
      id: "PRD-01",
      name: "Panadol Extra 500mg",
      category: "Analgesics",
      packageSize: "20 Tablets",
      isActive: true,
      price: 15.5
    },
    {
      id: "PRD-02",
      name: "Amoxil 500mg Caps",
      category: "Antibiotics",
      packageSize: "12 Capsules",
      isActive: true,
      price: 25.0
    },
    {
      id: "PRD-03",
      name: "Inactive Drug 100mg",
      category: "Other",
      packageSize: "10 Tabs",
      isActive: false,
      price: 10.0
    }
  ];

  const sampleAssignments: UserProductAssignment[] = [
    {
      id: "upa_1",
      userId: "usr_rep_1",
      productId: "PRD-01",
      status: "Active"
    },
    {
      id: "upa_2",
      userId: "usr_rep_1",
      productId: "PRD-02",
      status: "Active"
    },
    {
      id: "upa_3",
      userId: "usr_rep_1",
      productId: "PRD-03",
      status: "Active"
    }
  ];

  function createTestDraft(): PharmacyVisitDraft {
    return {
      schemaVersion: "2.0",
      draftId: "draft_test_step5_1001",
      repUid: testUser.id,
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
      deviceSessionId: "session_test_5",
      localRevision: 1,
      payment: {
        financialContext: {
          pharmacyId: "ph_101",
          pharmacyName: "Al-Shifa Pharmacy",
          areaId: "LY-WEST-TRE2",
          outstandingBalance: 1200,
          creditLimit: 5000,
          overdueBalance: 0,
          currency: "LYD"
        },
        paymentEntry: {
          amount: 0,
          method: "CASH",
          evidences: []
        },
        balancePreview: {
          pharmacyId: "ph_101",
          currentOutstandingBalance: 1200,
          thisOrderValue: 0,
          paymentCollectionAmount: 0,
          projectedOutstandingBalance: 700,
          currency: "LYD",
          calculatedAt: new Date().toISOString()
        }
      }
    };
  }

  it("1. Resolves eligible stock products reusing canonical Step 2 source and emits PHARMACY_VISIT_STOCK_PRODUCT_SOURCE_JSON", () => {
    const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const report = getEligibleStockProductsForRep(testUser.id, sampleAssignments, sampleProducts);

    expect(report.actorUid).toBe(testUser.id);
    expect(report.eligibleProductCount).toBe(2); // PRD-01 and PRD-02 (PRD-03 is inactive)
    expect(report.eligibleProducts.map(p => p.id)).toEqual(["PRD-02", "PRD-01"]);

    expect(consoleSpy).toHaveBeenCalledWith(
      "[PHARMACY_VISIT_STOCK_PRODUCT_SOURCE_JSON]",
      expect.stringContaining("reusedStep2ProductSource")
    );

    consoleSpy.mockRestore();
  });

  it("2. Reducer handles ADD_STOCK_REQUEST_LINE, UPDATE, and REMOVE actions with diagnostic logs", () => {
    const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const initialDraft = createTestDraft();
    let state = { draft: initialDraft, isLoading: false };

    const newLine: PharmacyStockRequestLine = {
      draftLineId: "sl_1",
      canonicalProductId: "PRD-01",
      productCode: "PRD-01",
      productNameSnapshot: "Panadol Extra 500mg",
      observedQuantity: 5,
      targetQuantity: 20,
      requestedQuantity: 15,
      priority: "URGENT",
      reason: "LOW_STOCK",
      notes: "High patient demand",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      userConfirmed: true,
      backendRevalidationRequired: true
    };

    // Add Line
    state = pharmacyVisitReducer(state, { type: "ADD_STOCK_REQUEST_LINE", payload: newLine });
    expect(state.draft.stock?.requestLines.length).toBe(1);
    expect(state.draft.stock?.requestLines[0].requestedQuantity).toBe(15);
    expect(consoleSpy).toHaveBeenCalledWith(
      "[PHARMACY_VISIT_STOCK_REQUEST_JSON]",
      expect.stringContaining("sl_1")
    );

    // Update Line
    state = pharmacyVisitReducer(state, {
      type: "UPDATE_STOCK_REQUEST_LINE",
      payload: { draftLineId: "sl_1", updates: { requestedQuantity: 25 } }
    });
    expect(state.draft.stock?.requestLines[0].requestedQuantity).toBe(25);

    // Remove Line
    state = pharmacyVisitReducer(state, {
      type: "REMOVE_STOCK_REQUEST_LINE",
      payload: { draftLineId: "sl_1" }
    });
    expect(state.draft.stock?.requestLines.length).toBe(0);

    consoleSpy.mockRestore();
  });

  it("3. Reducer handles TOGGLE NO_STOCK_REQUEST_REQUIRED", () => {
    const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const initialDraft = createTestDraft();
    let state = { draft: initialDraft, isLoading: false };

    state = pharmacyVisitReducer(state, { type: "SET_NO_STOCK_REQUEST_REQUIRED", payload: true });
    expect(state.draft.stock?.noStockRequestRequired).toBe(true);
    expect(state.draft.stock?.requestLines.length).toBe(0);

    consoleSpy.mockRestore();
  });

  it("4. Reducer handles Competitor Intelligence, CRM Notes & Follow-up actions", () => {
    const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const initialDraft = createTestDraft();
    let state = { draft: initialDraft, isLoading: false };

    // Competitor Brand
    state = pharmacyVisitReducer(state, {
      type: "ADD_COMPETITOR_BRAND",
      payload: { id: "cb_1", brandName: "Brand X", companyName: "CompCorp" }
    });
    expect(state.draft.stock?.competitiveIntelligence?.competitorBrands?.length).toBe(1);

    // Competitor Price
    state = pharmacyVisitReducer(state, {
      type: "ADD_COMPETITOR_PRICE",
      payload: { id: "cp_1", brandOrProduct: "Brand X", observedPrice: 18.0, currency: "LYD", observedDate: "2026-07-24" }
    });
    expect(state.draft.stock?.competitiveIntelligence?.competitorPricing?.length).toBe(1);

    // Relationship Quality & General Notes
    state = pharmacyVisitReducer(state, { type: "SET_RELATIONSHIP_QUALITY", payload: "EXCELLENT" });
    state = pharmacyVisitReducer(state, { type: "SET_GENERAL_NOTES", payload: "Great feedback from pharmacist." });

    expect(state.draft.stock?.crmNotes?.relationshipQuality).toBe("EXCELLENT");
    expect(state.draft.stock?.crmNotes?.generalNotes).toBe("Great feedback from pharmacist.");

    // Follow-up
    state = pharmacyVisitReducer(state, {
      type: "SET_FOLLOW_UP",
      payload: {
        required: true,
        followUpDate: "2026-08-01",
        purpose: "Deliver promotional materials",
        priority: "NORMAL",
        taskPersistencePending: true
      }
    });

    expect(state.draft.stock?.followUp?.required).toBe(true);
    expect(state.draft.stock?.followUp?.followUpDate).toBe("2026-08-01");

    consoleSpy.mockRestore();
  });

  it("5. validateStep5 returns valid for normal draft and logs PHARMACY_VISIT_STEP5_VALIDATION_JSON", () => {
    const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const draft = createTestDraft();
    draft.stock = {
      noStockRequestRequired: true,
      requestLines: [],
      crmNotes: {
        relationshipQuality: "GOOD",
        generalNotes: "Regular visit checkup."
      }
    };

    const result = validateStep5(draft);

    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);

    expect(consoleSpy).toHaveBeenCalledWith(
      "[PHARMACY_VISIT_STEP5_VALIDATION_JSON]",
      expect.stringContaining("draft_test_step5_1001")
    );

    consoleSpy.mockRestore();
  });

  it("6. validateStep5 catches invalid line requested quantity and past follow-up date", () => {
    const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const draft = createTestDraft();
    draft.stock = {
      noStockRequestRequired: false,
      requestLines: [
        {
          draftLineId: "sl_inv",
          canonicalProductId: "PRD-01",
          productCode: "PRD-01",
          productNameSnapshot: "Panadol Extra",
          requestedQuantity: 0, // Invalid: must be > 0
          priority: "NORMAL",
          reason: "LOW_STOCK",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          userConfirmed: true,
          backendRevalidationRequired: true
        }
      ],
      followUp: {
        required: true,
        followUpDate: "2020-01-01", // Invalid: date in past
        taskPersistencePending: true
      }
    };

    const result = validateStep5(draft);

    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes("Requested quantity must be a positive number"))).toBe(true);
    expect(result.errors.some(e => e.includes("cannot be before the visit date"))).toBe(true);

    consoleSpy.mockRestore();
  });

  it("7. Transitioning Step 5 with COMPLETE_STEP_5 advances currentStep to 6 and logs PHARMACY_VISIT_STEP_TRANSITION_JSON", () => {
    const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const draft = createTestDraft();
    let state = { draft, isLoading: false };

    state = pharmacyVisitReducer(state, { type: "COMPLETE_STEP_5" });

    expect(state.draft.currentStep).toBe(6);

    expect(consoleSpy).toHaveBeenCalledWith(
      "[PHARMACY_VISIT_STEP_TRANSITION_JSON]",
      expect.stringContaining('"fromStep":5,"toStep":6')
    );

    consoleSpy.mockRestore();
  });
  it("rejects a positive saved collection without changing the operational draft", () => {
    const draft = createTestDraft();
    draft.payment!.paymentEntry!.amount = 25;
    const before = JSON.stringify(draft);
    const result = validateStep5(draft);
    expect(result.isValid).toBe(false);
    expect(result.errors.some(error => error.includes("Collection recording is not available"))).toBe(true);
    expect(JSON.stringify(draft)).toBe(before);
  });

});
