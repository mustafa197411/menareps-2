import { describe, it, expect } from "vitest";
import {
  PharmacyVisitDraft,
  PharmacyFinancialContext,
  PharmacyPaymentMethod,
  PharmacyPaymentEvidence
} from "./types/domain";
import { pharmacyVisitReducer, PharmacyVisitState } from "./state/pharmacyVisitReducer";
import { calculateBalancePreview } from "./services/balancePreviewEngine";
import { validateStep4, VISIT_COLLECTION_UNAVAILABLE_MESSAGE } from "./validation/validateStep4";

function createMockDraft(step = 4): PharmacyVisitDraft {
  return {
    schemaVersion: "2.0",
    draftId: "pv_draft_step4_test",
    repUid: "cQt7jjLOaHPgBmGCWzdjZm3pojo2",
    companyId: "CMP-001",
    countryId: "LY",
    areaId: "LY-WEST-TRE2",
    pharmacyId: "PHARM-101",
    pharmacySnapshot: {
      id: "PHARM-101",
      nameEn: "Tajoura Central Pharmacy",
      type: "Retail",
      areaId: "LY-WEST-TRE2",
      outstandingBalance: 1250
    },
    entrySource: "DIRECT_URL",
    status: "IN_PROGRESS",
    currentStep: step as any,
    visitPurpose: {
      code: "ORDER_TAKING",
      labelEn: "Order Taking",
      labelAr: "أخذ طلبية تجارية",
      requiresGps: true,
      allowsOrder: true
    },
    gps: {
      latitude: 32.88,
      longitude: 13.35,
      accuracy: 10,
      timestamp: new Date().toISOString(),
      source: "device",
      spoofCheckStatus: "Passed",
      status: "VERIFIED"
    },
    order: {
      lines: [
        {
          id: "l1",
          canonicalProductId: "PRD-70",
          productCode: "70",
          productNameSnapshot: "Cornex Gel",
          quantity: 10,
          unitPricePreview: 25,
          lineTotalPreview: 250,
          currency: "LYD",
          inputSource: "MANUAL",
          userConfirmed: true,
          userCorrected: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          id: "l2",
          canonicalProductId: "PRD-83",
          productCode: "83",
          productNameSnapshot: "CardioMax 10mg",
          quantity: 10,
          unitPricePreview: 30,
          lineTotalPreview: 300,
          currency: "LYD",
          inputSource: "MANUAL",
          userConfirmed: true,
          userCorrected: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      inputSource: "MANUAL",
      subtotalPreview: 550,
      currency: "LYD",
      updatedAt: new Date().toISOString()
    },
    offers: {
      eligibleOffers: [],
      ineligibleOffers: [],
      appliedOffers: [],
      conflicts: [],
      calculation: {
        grossSubtotal: 550,
        totalDiscountAmount: 100,
        netTotal: 450,
        currency: "LYD",
        discountLines: [],
        bonusLines: [],
        calculationTimestamp: new Date().toISOString()
      },
      lastEvaluatedAt: new Date().toISOString()
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deviceSessionId: "session_test_123",
    localRevision: 1
  };
}

describe("WP6.1F Pharmacy Visit V2 Step 4 - Payment & Accounts Receivable", () => {
  it("A1. Calculates balance preview formula accurately: before + netOrder - payment", () => {
    const preview = calculateBalancePreview(1250, 450, 200, "LYD");
    expect(preview.outstandingBalanceBefore).toBe(1250);
    expect(preview.currentVisitNetTotal).toBe(450);
    expect(preview.paymentAmount).toBe(200);
    expect(preview.projectedBalanceAfter).toBe(1500); // 1250 + 450 - 200 = 1500
    expect(preview.isOverpayment).toBe(false);
  });

  it("A2. Handles zero payment visit correctly", () => {
    const preview = calculateBalancePreview(1250, 450, 0, "LYD");
    expect(preview.projectedBalanceAfter).toBe(1700); // 1250 + 450 = 1700
    expect(preview.isOverpayment).toBe(false);
  });

  it("A3. Handles full payment visit resulting in original balance remaining", () => {
    const preview = calculateBalancePreview(1250, 450, 450, "LYD");
    expect(preview.projectedBalanceAfter).toBe(1250);
    expect(preview.isOverpayment).toBe(false);
  });

  it("A4. Detects overpayment when payment exceeds balance before + net order total", () => {
    const preview = calculateBalancePreview(100, 200, 500, "LYD");
    expect(preview.isOverpayment).toBe(true);
    expect(preview.overpaymentAmount).toBe(200); // 500 - 300 = 200
    expect(preview.projectedBalanceAfter).toBe(-200);
  });

  it("A5. Performs controlled rounding on decimal payment amounts", () => {
    const preview = calculateBalancePreview(100.555, 200.123, 150.333, "LYD");
    expect(preview.projectedBalanceAfter).toBe(150.35); // (100.555 + 200.123) - 150.333 = 150.345 rounded to 150.35
  });

  it("A6. Supports no-order visit balance calculation (debt collection only)", () => {
    const preview = calculateBalancePreview(1000, 0, 300, "LYD");
    expect(preview.currentVisitNetTotal).toBe(0);
    expect(preview.paymentAmount).toBe(300);
    expect(preview.projectedBalanceAfter).toBe(700); // 1000 - 300 = 700
  });

  it("B1. Validates valid zero payment for routine order-taking visit", () => {
    const draft = createMockDraft(4);
    const fin: PharmacyFinancialContext = {
      pharmacyId: "PHARM-101",
      currency: "LYD",
      outstandingBalanceBefore: 1250,
      currentVisitGrossTotal: 550,
      currentVisitDiscountTotal: 100,
      currentVisitNetTotal: 450,
      openReceivableTotal: 1250,
      creditLimit: 5000,
      availableCredit: 3750,
      paymentTermDays: 30,
      overdueAmount: null,
      agingBuckets: null,
      source: "firestore/pharmacies/PHARM-101",
      sourceStatus: "LIVE",
      mockFallbackUsed: false,
      backendRevalidationRequired: true
    };

    const state: PharmacyVisitState = { draft, isLoading: false };
    const step4State = pharmacyVisitReducer(state, { type: "SET_FINANCIAL_CONTEXT", payload: fin });

    const valRes = validateStep4(step4State.draft);
    expect(valRes.isValid).toBe(true);
    expect(valRes.errors.length).toBe(0);
  });

  it("B2. Requires payment method and cheque details when cheque payment is entered", () => {
    const draft = createMockDraft(4);
    const fin: PharmacyFinancialContext = {
      pharmacyId: "PHARM-101",
      currency: "LYD",
      outstandingBalanceBefore: 1250,
      currentVisitGrossTotal: 550,
      currentVisitDiscountTotal: 100,
      currentVisitNetTotal: 450,
      openReceivableTotal: 1250,
      creditLimit: 5000,
      availableCredit: 3750,
      paymentTermDays: 30,
      overdueAmount: null,
      agingBuckets: null,
      source: "firestore/pharmacies/PHARM-101",
      sourceStatus: "LIVE",
      mockFallbackUsed: false,
      backendRevalidationRequired: true
    };

    let s = pharmacyVisitReducer({ draft, isLoading: false }, { type: "SET_FINANCIAL_CONTEXT", payload: fin });
    s = pharmacyVisitReducer(s, { type: "SET_PAYMENT_METHOD", payload: "CHEQUE" });
    s = pharmacyVisitReducer(s, { type: "SET_PAYMENT_AMOUNT", payload: { amount: 300, userUid: "u1" } });

    // Missing cheque number & date
    let valRes = validateStep4(s.draft);
    expect(valRes.isValid).toBe(false);
    expect(valRes.errors).toContain("Cheque number is required for cheque payments.");
    expect(valRes.errors).toContain("Cheque date is required for cheque payments.");

    // Fill cheque fields
    s = pharmacyVisitReducer(s, { type: "SET_PAYMENT_FIELD", payload: { field: "chequeNumber", value: "CHQ-1002" } });
    s = pharmacyVisitReducer(s, { type: "SET_PAYMENT_FIELD", payload: { field: "chequeDate", value: "2026-08-01" } });

    valRes = validateStep4(s.draft);
    expect(valRes.isValid).toBe(false);
    expect(valRes.errors).toContain(VISIT_COLLECTION_UNAVAILABLE_MESSAGE);
  });

  it("B3. Requires bank reference number for bank transfer payments", () => {
    const draft = createMockDraft(4);
    const fin: PharmacyFinancialContext = {
      pharmacyId: "PHARM-101",
      currency: "LYD",
      outstandingBalanceBefore: 1250,
      currentVisitGrossTotal: 550,
      currentVisitDiscountTotal: 100,
      currentVisitNetTotal: 450,
      openReceivableTotal: 1250,
      creditLimit: 5000,
      availableCredit: 3750,
      paymentTermDays: 30,
      overdueAmount: null,
      agingBuckets: null,
      source: "firestore/pharmacies/PHARM-101",
      sourceStatus: "LIVE",
      mockFallbackUsed: false,
      backendRevalidationRequired: true
    };

    let s = pharmacyVisitReducer({ draft, isLoading: false }, { type: "SET_FINANCIAL_CONTEXT", payload: fin });
    s = pharmacyVisitReducer(s, { type: "SET_PAYMENT_METHOD", payload: "BANK_TRANSFER" });
    s = pharmacyVisitReducer(s, { type: "SET_PAYMENT_AMOUNT", payload: { amount: 450, userUid: "u1" } });

    let valRes = validateStep4(s.draft);
    expect(valRes.isValid).toBe(false);
    expect(valRes.errors).toContain("Bank reference number is required for bank transfer payments.");

    s = pharmacyVisitReducer(s, { type: "SET_PAYMENT_FIELD", payload: { field: "bankReferenceNumber", value: "REF-88301" } });
    valRes = validateStep4(s.draft);
    expect(valRes.isValid).toBe(false);
    expect(valRes.errors).toContain(VISIT_COLLECTION_UNAVAILABLE_MESSAGE);
  });

  it("B4. Allows operational FINANCIAL_COLLECTION purpose without recording money", () => {
    const draft = createMockDraft(4);
    draft.visitPurpose = {
      code: "FINANCIAL_COLLECTION",
      labelEn: "Debt Collection",
      labelAr: "تحصيل ديون",
      requiresGps: true,
      allowsOrder: false
    };

    const fin: PharmacyFinancialContext = {
      pharmacyId: "PHARM-101",
      currency: "LYD",
      outstandingBalanceBefore: 1250,
      currentVisitGrossTotal: 0,
      currentVisitDiscountTotal: 0,
      currentVisitNetTotal: 0,
      openReceivableTotal: 1250,
      creditLimit: 5000,
      availableCredit: 3750,
      paymentTermDays: 30,
      overdueAmount: null,
      agingBuckets: null,
      source: "firestore/pharmacies/PHARM-101",
      sourceStatus: "LIVE",
      mockFallbackUsed: false,
      backendRevalidationRequired: true
    };

    let s = pharmacyVisitReducer({ draft, isLoading: false }, { type: "SET_FINANCIAL_CONTEXT", payload: fin });
    let valRes = validateStep4(s.draft);
    expect(valRes.isValid).toBe(true);
    expect(valRes.errors).toEqual([]);

    s = pharmacyVisitReducer(s, { type: "SET_PAYMENT_AMOUNT", payload: { amount: 250, userUid: "u1" } });
    valRes = validateStep4(s.draft);
    expect(valRes.isValid).toBe(false);
    expect(valRes.errors).toContain(VISIT_COLLECTION_UNAVAILABLE_MESSAGE);
  });

  it("C1. Manages evidence attachments metadata in reducer without storing binaries", () => {
    const draft = createMockDraft(4);
    let s = pharmacyVisitReducer({ draft, isLoading: false }, { type: "SET_PAYMENT_METHOD", payload: "CASH" });

    const evidence: PharmacyPaymentEvidence = {
      attachmentId: "ev_101",
      fileName: "receipt_scan.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 154000,
      uploadStatus: "SUCCESS",
      createdAt: new Date().toISOString()
    };

    s = pharmacyVisitReducer(s, { type: "ADD_PAYMENT_EVIDENCE", payload: evidence });
    expect(s.draft.payment?.paymentEntry?.evidences.length).toBe(1);
    expect(s.draft.payment?.paymentEntry?.evidences[0].attachmentId).toBe("ev_101");

    s = pharmacyVisitReducer(s, { type: "REMOVE_PAYMENT_EVIDENCE", payload: { attachmentId: "ev_101" } });
    expect(s.draft.payment?.paymentEntry?.evidences.length).toBe(0);
  });

  it("D1. Advances draft from Step 4 to Step 5 via COMPLETE_STEP_4 reducer action", () => {
    const draft = createMockDraft(4);
    let s = pharmacyVisitReducer({ draft, isLoading: false }, { type: "COMPLETE_STEP_4" });

    expect(s.draft.currentStep).toBe(5);
    expect(s.draft.status).toBe("IN_PROGRESS");
  });
});
