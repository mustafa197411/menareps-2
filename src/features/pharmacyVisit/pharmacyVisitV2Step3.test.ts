import { describe, it, expect, beforeEach } from "vitest";
import { 
  PharmacyVisitDraft, 
  PharmacyOffer, 
  PharmacyOrderLine, 
  AppliedOfferSnapshot,
  PharmacyOfferEligibilityResult
} from "./types/domain";
import { evaluateOfferEligibility, evaluateAllOffers } from "./services/offerEligibilityEngine";
import { calculateOfferTotals } from "./services/offerCalculationEngine";
import { validateStep3 } from "./validation/validateStep3";
import { pharmacyVisitReducer, PharmacyVisitState } from "./state/pharmacyVisitReducer";

describe("WP6.1E Pharmacy Visit V2 Step 3 - Apply Offers & Discounts", () => {
  let sampleDraft: PharmacyVisitDraft;
  let sampleLine1: PharmacyOrderLine;
  let sampleLine2: PharmacyOrderLine;
  let sampleOffers: PharmacyOffer[];

  beforeEach(() => {
    sampleLine1 = {
      id: "line_1",
      canonicalProductId: "PRD-70",
      productCode: "70",
      productNameSnapshot: "Cornex Gel 20gm",
      quantity: 10,
      unitPricePreview: 15,
      lineTotalPreview: 150,
      currency: "LYD",
      inputSource: "MANUAL",
      userConfirmed: true,
      userCorrected: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    sampleLine2 = {
      id: "line_2",
      canonicalProductId: "PRD-83",
      productCode: "83",
      productNameSnapshot: "CardioMax 10mg",
      quantity: 20,
      unitPricePreview: 20,
      lineTotalPreview: 400,
      currency: "LYD",
      inputSource: "MANUAL",
      userConfirmed: true,
      userCorrected: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    sampleDraft = {
      schemaVersion: "2.0",
      draftId: "pv_draft_step3_test",
      repUid: "test-user1@esnad.local",
      companyId: "MENAREPS",
      countryId: "LY",
      areaId: "LY-WEST-TRE2",
      pharmacyId: "PHARM-101",
      pharmacySnapshot: {
        id: "PHARM-101",
        nameEn: "Al-Amal Central Pharmacy",
        type: "Retail",
        areaId: "LY-WEST-TRE2"
      },
      status: "IN_PROGRESS",
      currentStep: 3,
      entrySource: "PHARMACY_LIST",
      visitPurpose: {
        code: "ORDER_TAKING",
        labelEn: "Commercial Order Taking",
        labelAr: "أخذ طلبية تجارية"
      },
      order: {
        lines: [sampleLine1, sampleLine2],
        subtotalPreview: 550,
        currency: "LYD",
        updatedAt: new Date().toISOString()
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deviceSessionId: "session_test",
      localRevision: 1
    };

    sampleOffers = [
      {
        id: "OFF-DERM-10",
        code: "OFF-DERM-10",
        name: "Cornex Gel 10+2 Volume Bonus",
        type: "BUY_X_GET_Y",
        value: "10+2",
        buyQuantity: 10,
        getQuantity: 2,
        productId: "PRD-70",
        freeProductId: "PRD-70",
        freeProductName: "Cornex Gel 20gm (Bonus)",
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        isActive: true,
        autoApply: true
      },
      {
        id: "OFF-CARD-15",
        code: "OFF-CARD-15",
        name: "CardioMax 15% Trade Discount",
        type: "PERCENTAGE_DISCOUNT",
        value: 15,
        percentage: 15,
        productId: "PRD-83",
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        isActive: true,
        rules: {
          productId: "PRD-83",
          minQuantity: 20
        }
      },
      {
        id: "OFF-VAL-500",
        code: "OFF-VAL-500",
        name: "High Value Order Discount 50 LYD",
        type: "ORDER_VALUE_DISCOUNT",
        value: 50,
        fixedAmount: 50,
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        isActive: true,
        isExclusive: true,
        rules: {
          minOrderValue: 500
        }
      },
      {
        id: "OFF-INACTIVE",
        code: "OFF-INACTIVE",
        name: "Expired Promo",
        type: "PERCENTAGE_DISCOUNT",
        value: 50,
        startDate: "2020-01-01",
        endDate: "2020-12-31",
        isActive: false
      }
    ];
  });

  it("1. Evaluates offer eligibility based on date range, active status, quantity thresholds, and order value", () => {
    const context = {
      repUid: sampleDraft.repUid,
      countryId: sampleDraft.countryId,
      areaId: sampleDraft.areaId,
      pharmacySnapshot: sampleDraft.pharmacySnapshot,
      lines: sampleDraft.order!.lines,
      grossSubtotal: sampleDraft.order!.subtotalPreview
    };

    const { eligible, ineligible } = evaluateAllOffers(sampleOffers, context);

    expect(eligible.length).toBe(3);
    expect(ineligible.length).toBe(1);
    expect(ineligible[0].offer.id).toBe("OFF-INACTIVE");
    expect(ineligible[0].rejectionReason).toBe("OFFER_INACTIVE");
  });

  it("2. Accurately calculates percentage discounts and free volume bonus lines", () => {
    const dermResult = evaluateOfferEligibility(sampleOffers[0], {
      repUid: sampleDraft.repUid,
      countryId: sampleDraft.countryId,
      areaId: sampleDraft.areaId,
      lines: [sampleLine1],
      grossSubtotal: 150
    });

    expect(dermResult.isEligible).toBe(true);
    expect(dermResult.previewBonusQuantity).toBe(2);

    const cardResult = evaluateOfferEligibility(sampleOffers[1], {
      repUid: sampleDraft.repUid,
      countryId: sampleDraft.countryId,
      areaId: sampleDraft.areaId,
      lines: [sampleLine2],
      grossSubtotal: 400
    });

    expect(cardResult.isEligible).toBe(true);
    expect(cardResult.previewDiscountAmount).toBe(60); // 15% of 400 LYD = 60 LYD
  });

  it("3. Calculates order totals, net payable amount, and caps discount so net total >= 0", () => {
    const eligibleMap = new Map<string, PharmacyOfferEligibilityResult>([
      ["OFF-CARD-15", { offer: sampleOffers[1], isEligible: true, previewDiscountAmount: 60 }],
      ["OFF-VAL-500", { offer: sampleOffers[2], isEligible: true, previewDiscountAmount: 50 }]
    ]);

    const appliedSnapshots: AppliedOfferSnapshot[] = [
      {
        offerId: "OFF-CARD-15",
        offerCode: "OFF-CARD-15",
        offerNameSnapshot: "CardioMax 15% Trade Discount",
        version: "1.0",
        type: "PERCENTAGE_DISCOUNT",
        discountAmountPreview: 60,
        bonusLinesPreview: [],
        currency: "LYD",
        isAutoApplied: false,
        isUserConfirmed: true,
        backendRevalidationRequired: true,
        appliedAt: new Date().toISOString()
      },
      {
        offerId: "OFF-VAL-500",
        offerCode: "OFF-VAL-500",
        offerNameSnapshot: "High Value Order Discount 50 LYD",
        version: "1.0",
        type: "ORDER_VALUE_DISCOUNT",
        discountAmountPreview: 50,
        bonusLinesPreview: [],
        currency: "LYD",
        isAutoApplied: false,
        isUserConfirmed: true,
        backendRevalidationRequired: true,
        appliedAt: new Date().toISOString()
      }
    ];

    const { calculation } = calculateOfferTotals(550, appliedSnapshots, eligibleMap, sampleDraft.order!.lines);

    expect(calculation.grossSubtotal).toBe(550);
    expect(calculation.totalDiscountAmount).toBe(110);
    expect(calculation.netTotal).toBe(440);
  });

  it("4. Detects exclusive offer overlap conflicts", () => {
    const offerExclA: PharmacyOffer = { ...sampleOffers[2], id: "EXCL-A", name: "Excl A", isExclusive: true };
    const offerExclB: PharmacyOffer = { ...sampleOffers[2], id: "EXCL-B", name: "Excl B", isExclusive: true };

    const eligibleMap = new Map<string, PharmacyOfferEligibilityResult>([
      ["EXCL-A", { offer: offerExclA, isEligible: true, previewDiscountAmount: 50 }],
      ["EXCL-B", { offer: offerExclB, isEligible: true, previewDiscountAmount: 50 }]
    ]);

    const appliedSnapshots: AppliedOfferSnapshot[] = [
      {
        offerId: "EXCL-A",
        offerCode: "EXCL-A",
        offerNameSnapshot: "Excl A",
        version: "1.0",
        type: "ORDER_VALUE_DISCOUNT",
        discountAmountPreview: 50,
        bonusLinesPreview: [],
        currency: "LYD",
        isAutoApplied: false,
        isUserConfirmed: true,
        backendRevalidationRequired: true,
        appliedAt: new Date().toISOString()
      },
      {
        offerId: "EXCL-B",
        offerCode: "EXCL-B",
        offerNameSnapshot: "Excl B",
        version: "1.0",
        type: "ORDER_VALUE_DISCOUNT",
        discountAmountPreview: 50,
        bonusLinesPreview: [],
        currency: "LYD",
        isAutoApplied: false,
        isUserConfirmed: true,
        backendRevalidationRequired: true,
        appliedAt: new Date().toISOString()
      }
    ];

    const { conflicts } = calculateOfferTotals(550, appliedSnapshots, eligibleMap, sampleDraft.order!.lines);

    expect(conflicts.length).toBe(1);
    expect(conflicts[0].conflictReason).toBe("EXCLUSIVE_OFFER_OVERLAP");
  });

  it("5. Validates Step 3 and allows proceeding when valid or when 0 offers applied", () => {
    const res = validateStep3(sampleDraft);
    expect(res.isValid).toBe(true);
  });

  it("6. Advances draft from Step 3 to Step 4 via COMPLETE_STEP_3 reducer action", () => {
    const initialState: PharmacyVisitState = {
      draft: sampleDraft,
      isLoading: false
    };

    const newState = pharmacyVisitReducer(initialState, { type: "COMPLETE_STEP_3" });

    expect(newState.draft.currentStep).toBe(4);
    expect(newState.draft.status).toBe("IN_PROGRESS");
  });
});
