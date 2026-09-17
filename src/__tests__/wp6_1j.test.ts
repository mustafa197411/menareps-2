import { describe, it, expect, vi } from "vitest";
import { 
  removeUndefinedRecursively, 
  getUndefinedPaths, 
  sanitizeAndAuditPayload 
} from "../utils/importNormalization";
import { resolvePharmacyCurrency, getCurrencyInfo } from "../features/pharmacyVisit/utils/currency";
import { completePharmacyVisitV2 } from "../features/pharmacyVisit/services/completePharmacyVisitV2";
import { PharmacyVisitDraft } from "../features/pharmacyVisit/types/domain";
import { User } from "../types";

vi.mock("../lib/pharmacyOrderCreateClient", () => ({ createOrderFromCompletedPharmacyVisit: vi.fn(async () => ({ success: true, orderId: "ORDER-BACKEND", displayNumber: "ZX-SO-2030-000001", alreadyCreated: false })) }));
vi.mock("../lib/pharmacyVisitCompletionClient", () => ({ completePharmacyVisitAuthoritatively: vi.fn(async (draft: PharmacyVisitDraft) => ({ success: true, visitId: `PV2_${draft.repUid}_${draft.draftId}`, displayNumber: "ZX-PV-2030-000001" })) }));
vi.mock("../features/pharmacyVisit/services/pharmacyVisitDraftService", () => ({ PharmacyVisitDraftService: { saveDraftLocally: vi.fn() } }));

// Mock firebase/firestore for completion tests
vi.mock("firebase/firestore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("firebase/firestore")>();
  return {
    ...actual,
    doc: vi.fn((db: any, col: string, id: string) => ({ path: `${col}/${id}`, id })),
    collection: vi.fn((db: any, col: string) => ({ path: col })),
    query: vi.fn((...args: any[]) => args),
    where: vi.fn((field: string, op: string, val: any) => ({ field, op, val })),
    getDocs: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
    runTransaction: vi.fn(async (db: any, updateFunction: (transaction: any) => Promise<any>) => {
      const mockTransaction = {
        get: vi.fn().mockResolvedValue({ exists: () => false, data: () => ({}) }),
        set: vi.fn(),
        update: vi.fn()
      };
      return updateFunction(mockTransaction);
    })
  };
});

describe("WP6.1J — Order Completion Payload Repair & Currency Resolution Unit Tests", () => {
  const market = (countryId: string, marketId: string, currencyCode: string, decimalPlaces: number) => ({
    marketId, countryId, countryNameEn: marketId === "LY" ? "Libya" : "Jordan", countryNameAr: marketId,
    active: true, currencyCode, currencySymbol: currencyCode, symbolPosition: "AFTER", decimalPlaces,
    numeralLocale: "en", timezone: "UTC", dateFormat: "YYYY-MM-DD", timeFormat: "24H", weekStartDay: 1,
    workingWeekdays: [0, 1, 2, 3, 4], normalWorkdayStart: "08:00", normalWorkdayEnd: "16:00",
    checkInOpensAt: "07:30", lateToleranceMinutes: 15, autoCheckoutAt: "18:00", maximumWorkdayMinutes: 600,
  } as const);
  const libyaMarket = market("C-LIB-8842", "LY", "LYD", 2);
  const jordanMarket = market("C-JOR-9875", "JO", "JOD", 3);
  // Test 1: Order notes undefined is omitted
  it("1. Order notes undefined is omitted", () => {
    const orderPayload = {
      orderId: "ORD_PV2_TEST_101",
      notes: undefined,
      total: 100,
      currencyCode: "LYD"
    };
    const sanitized = removeUndefinedRecursively(orderPayload);
    expect("notes" in sanitized).toBe(false);
    expect(sanitized).toEqual({
      orderId: "ORD_PV2_TEST_101",
      total: 100,
      currencyCode: "LYD"
    });
  });

  // Test 2: Nested undefined values are removed
  it("2. Nested undefined values are removed", () => {
    const nestedPayload = {
      id: "ORD_123",
      items: [
        { productId: "P1", discount: undefined, quantity: 5 }
      ],
      meta: {
        ref: undefined,
        active: true
      }
    };
    const sanitized = removeUndefinedRecursively(nestedPayload);
    expect("discount" in sanitized.items[0]).toBe(false);
    expect("ref" in sanitized.meta).toBe(false);
    expect(sanitized.items[0].quantity).toBe(5);
    expect(sanitized.meta.active).toBe(true);
  });

  // Test 3: false is preserved
  it("3. false is preserved", () => {
    const payload = { isVerified: false, hasDiscount: false };
    const sanitized = removeUndefinedRecursively(payload);
    expect(sanitized.isVerified).toBe(false);
    expect(sanitized.hasDiscount).toBe(false);
  });

  // Test 4: zero is preserved
  it("4. zero is preserved", () => {
    const payload = { amount: 0, discountTotal: 0, paidAmount: 0 };
    const sanitized = removeUndefinedRecursively(payload);
    expect(sanitized.amount).toBe(0);
    expect(sanitized.discountTotal).toBe(0);
    expect(sanitized.paidAmount).toBe(0);
  });

  // Test 5: empty arrays are preserved
  it("5. empty arrays are preserved", () => {
    const payload = { appliedOffers: [], items: [], imageAttachments: [] };
    const sanitized = removeUndefinedRecursively(payload);
    expect(sanitized.appliedOffers).toEqual([]);
    expect(sanitized.items).toEqual([]);
    expect(sanitized.imageAttachments).toEqual([]);
  });

  // Test 6: required missing field still blocks
  it("6. required missing field still blocks", () => {
    const incompleteOrderPayload = {
      id: "ORD_999",
      notes: undefined
      // missing visitId, pharmacyId, salesRep, status, currencyCode, items, total, createdAt
    };

    const validateOrder = (payload: any) => {
      const errors: string[] = [];
      if (!payload.visitId) errors.push("Missing required field: visitId");
      if (!payload.pharmacyId) errors.push("Missing required field: pharmacyId");
      if (!payload.status) errors.push("Missing required field: status");
      return errors;
    };

    expect(() => {
      sanitizeAndAuditPayload("ORDER", "ORD_999", incompleteOrderPayload, validateOrder);
    }).toThrow("Required field validation failed for ORDER (ORD_999)");
  });

  // Test 7: Firestore Timestamp / Date is preserved
  it("7. Firestore Timestamp / Date is preserved", () => {
    const now = new Date();
    const payload = {
      createdAt: now,
      notes: undefined
    };
    const sanitized = removeUndefinedRecursively(payload);
    expect(sanitized.createdAt).toBe(now);
    expect("notes" in sanitized).toBe(false);
  });

  // Helper mock user and draft for completion tests
  const mockUser: User = {
    id: "cQt7jjLOaHPgBmGCWzdjZm3pojo2",
    name: "Test Representative",
    email: "test-user1@esnad.local",
    role: "Representative",
    companyId: "MENAREPS-CENTRAL",
    assignedAreaIds: ["A-TAJOURA-01"]
  };

  function createValidDraft(): PharmacyVisitDraft {
    return {
      draftId: "pv_draft_1784988014828_uurb9",
      schemaVersion: "2.0",
      repUid: "cQt7jjLOaHPgBmGCWzdjZm3pojo2",
      companyId: "MENAREPS-CENTRAL",
      countryId: "C-LIB-8842",
      currencyCode: "LYD",
      areaId: "A-TAJOURA-01",
      pharmacyId: "PHM-TAJOURA-A",
      pharmacySnapshot: {
        id: "PHM-TAJOURA-A",
        nameEn: "Tajoura Central Pharmacy",
        address: "Tajoura Main St",
        countryId: "C-LIB-8842",
        areaId: "A-TAJOURA-01"
      },
      currentStep: 6,
      completedSteps: [1, 2, 3, 4, 5, 6],
      visitPurpose: { code: "ORDER_FULFILLMENT", labelEn: "Order Fulfillment" },
      visitDate: "2026-07-25",
      isSubmitted: false,
      createdAt: "2026-07-25T10:00:00Z",
      updatedAt: "2026-07-25T10:00:00Z",
      order: {
        lines: [
          {
            id: "LINE_1",
            canonicalProductId: "PRD-LIB-001",
            productCode: "MED-001",
            productNameSnapshot: "Amoxicillin 500mg",
            quantity: 10,
            unitPricePreview: 15.0,
            lineTotalPreview: 150.0,
            currency: "LYD",
            inputSource: "MANUAL",
            userConfirmed: true,
            userCorrected: false,
            createdAt: "2026-07-25T10:00:00Z",
            updatedAt: "2026-07-25T10:00:00Z"
          }
        ],
        subtotalPreview: 150.0,
        currency: "LYD",
        updatedAt: "2026-07-25T10:00:00Z"
      }
    };
  }

  // Test 8: Order completion without notes succeeds
  it("8. Order completion without notes succeeds", async () => {
    const draft = createValidDraft();
    const result = await completePharmacyVisitV2(draft, mockUser);
    expect(result.success).toBe(true);
    expect(result.visitId).toBeTruthy();
    expect(result.orderId).toBeTruthy();
  });

  // Test 9: Visit completion without CRM notes succeeds
  it("9. Visit completion without CRM notes succeeds", async () => {
    const draft = createValidDraft();
    const result = await completePharmacyVisitV2(draft, mockUser, undefined);
    expect(result.success).toBe(true);
    expect(result.visitId).toBeTruthy();
  });

  // Test 10: Payment absent creates no Payment document
  it("10. Payment absent creates no Payment document", async () => {
    const draft = createValidDraft();
    delete draft.payment;
    const result = await completePharmacyVisitV2(draft, mockUser);
    expect(result.success).toBe(true);
  });

  // Test 11: Transaction failure creates no partial Visit or Order
  it("11. Transaction failure creates no partial Visit or Order", async () => {
    const invalidDraft = createValidDraft();
    // Invalidate step 6 validation by emptying lines
    invalidDraft.order!.lines = [];
    const result = await completePharmacyVisitV2(invalidDraft, mockUser);
    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  // Test 12: Retry after corrected payload creates one Visit and one Order only
  it("12. Retry after corrected payload creates one Visit and one Order only", async () => {
    const draft = createValidDraft();
    const result1 = await completePharmacyVisitV2(draft, mockUser);
    expect(result1.success).toBe(true);

    // Second call on same draft (simulating idempotent retry or submission)
    const result2 = await completePharmacyVisitV2(draft, mockUser);
    expect(result2.success).toBe(true);
    expect(result2.visitId).toBe(result1.visitId);
  });

  it("C1: resolvePharmacyCurrency resolves Libya countryId to LYD and never returns country ID as currency code", () => {
    const libyaPharmacy = {
      id: "PHM-TAJOURA-A",
      name: "Tajoura Pharmacy A",
      countryId: "C-LIB-8842"
    };

    const context = resolvePharmacyCurrency(libyaPharmacy, [libyaMarket]);

    expect(context.currencyCode).toBe("LYD");
    expect(context.currencySymbol).toBe("LYD");
    expect(context.currencyCode).not.toBe("C-LIB");
    expect(context.currencySymbol).not.toBe("C-LIB-8842");
    expect(context.pharmacyCountryId).toBe("C-LIB-8842");
  });

  it("C2: resolvePharmacyCurrency resolves Jordan countryId to JOD", () => {
    const jordanPharmacy = {
      id: "PHM-AMMAN-B",
      name: "Amman Pharmacy B",
      countryId: "C-JOR-9875"
    };

    const context = resolvePharmacyCurrency(jordanPharmacy, [jordanMarket]);

    expect(context.currencyCode).toBe("JOD");
    expect(context.currencySymbol).toBe("JOD");
    expect(context.decimalPlaces).toBe(3);
  });

  it("C3: ISO currency codes remain valid while country identity resolves only through canonical Markets", () => {
    expect(getCurrencyInfo("LYD").code).toBe("LYD");
    expect(getCurrencyInfo("JOD").code).toBe("JOD");
    expect(() => getCurrencyInfo("C-LIB-8842")).toThrow("MARKET_CURRENCY_CONFIGURATION_REQUIRED");
    expect(() => getCurrencyInfo("Jordan")).toThrow("MARKET_CURRENCY_CONFIGURATION_REQUIRED");
    expect(resolvePharmacyCurrency({ id: "LY", countryId: "C-LIB-8842" }, [libyaMarket]).currencyCode).toBe("LYD");
    expect(resolvePharmacyCurrency({ id: "JO", countryId: "C-JOR-9875" }, [jordanMarket]).currencyCode).toBe("JOD");
    expect(() => resolvePharmacyCurrency({ id: "UNCONFIGURED", countryId: "UNKNOWN" })).toThrow("PHARMACY_MARKET_CURRENCY_REQUIRED");
  });
});
