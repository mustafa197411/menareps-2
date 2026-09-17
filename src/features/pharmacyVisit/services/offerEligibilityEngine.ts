import { 
  PharmacyOffer, 
  PharmacyOfferEligibilityResult, 
  PharmacyOrderLine, 
  PharmacyVisitDraft 
} from "../types/domain";

export interface OfferEvaluationContext {
  repUid: string;
  countryId: string;
  areaId: string;
  pharmacySnapshot?: PharmacyVisitDraft["pharmacySnapshot"];
  lines: PharmacyOrderLine[];
  grossSubtotal: number;
  currentDateIso?: string;
}

export function evaluateOfferEligibility(
  offer: PharmacyOffer,
  context: OfferEvaluationContext
): PharmacyOfferEligibilityResult {
  const currentDate = context.currentDateIso ? new Date(context.currentDateIso) : new Date();

  // 1. Check Active Status
  if (!offer.isActive) {
    return {
      offer,
      isEligible: false,
      rejectionReason: "OFFER_INACTIVE"
    };
  }

  // 2. Check Date Range
  const start = new Date(offer.startDate);
  const end = new Date(offer.endDate);
  if (currentDate < start || currentDate > end) {
    return {
      offer,
      isEligible: false,
      rejectionReason: "OUTSIDE_DATE_RANGE"
    };
  }

  // 3. Check Country Restriction
  if (offer.rules?.countryId && offer.rules.countryId !== context.countryId) {
    return {
      offer,
      isEligible: false,
      rejectionReason: "COUNTRY_NOT_ELIGIBLE"
    };
  }

  // 4. Check Area Restriction
  if (offer.rules?.areaId && offer.rules.areaId !== context.areaId) {
    return {
      offer,
      isEligible: false,
      rejectionReason: "AREA_NOT_ELIGIBLE"
    };
  }

  // 5. Check Pharmacy / Customer Restriction
  if (offer.rules?.pharmacyId && offer.rules.pharmacyId !== context.pharmacySnapshot?.id) {
    return {
      offer,
      isEligible: false,
      rejectionReason: "PHARMACY_NOT_ELIGIBLE"
    };
  }

  if (
    offer.rules?.pharmacyType &&
    context.pharmacySnapshot?.type &&
    offer.rules.pharmacyType.toLowerCase() !== context.pharmacySnapshot.type.toLowerCase()
  ) {
    return {
      offer,
      isEligible: false,
      rejectionReason: "PHARMACY_NOT_ELIGIBLE"
    };
  }

  // 6. Check Product / SKU Scope
  let targetLines: PharmacyOrderLine[] = [];
  if (offer.productId || offer.rules?.productId) {
    const targetPid = offer.productId || offer.rules?.productId;
    targetLines = context.lines.filter((l) => l.canonicalProductId === targetPid);
    if (targetLines.length === 0) {
      return {
        offer,
        isEligible: false,
        rejectionReason: "PRODUCT_NOT_ELIGIBLE"
      };
    }
  } else if (offer.rules?.skuId) {
    targetLines = context.lines.filter((l) => l.canonicalSkuId === offer.rules?.skuId);
    if (targetLines.length === 0) {
      return {
        offer,
        isEligible: false,
        rejectionReason: "SKU_NOT_ELIGIBLE"
      };
    }
  } else {
    // Order-wide offer applies to all lines
    targetLines = context.lines;
  }

  // 7. Check Quantity Threshold
  const requiredQty = offer.rules?.minQuantity || offer.buyQuantity || 0;
  if (requiredQty > 0) {
    const totalMatchingQty = targetLines.reduce((acc, l) => acc + l.quantity, 0);
    if (totalMatchingQty < requiredQty) {
      return {
        offer,
        isEligible: false,
        rejectionReason: "QUANTITY_THRESHOLD_NOT_MET",
        missingQuantityToThreshold: requiredQty - totalMatchingQty
      };
    }
  }

  // 8. Check Order Value Threshold
  const requiredValue = offer.rules?.minOrderValue || 0;
  if (requiredValue > 0 && context.grossSubtotal < requiredValue) {
    return {
      offer,
      isEligible: false,
      rejectionReason: "ORDER_VALUE_THRESHOLD_NOT_MET",
      missingValueToThreshold: Math.round((requiredValue - context.grossSubtotal) * 100) / 100
    };
  }

  // 9. Calculate Preview Discounts & Bonuses
  let previewDiscountAmount = 0;
  let previewBonusQuantity = 0;
  let previewBonusProductName = offer.freeProductName;

  const targetSubtotal = targetLines.reduce(
    (acc, l) => acc + (l.lineTotalPreview ?? l.unitPricePreview * l.quantity),
    0
  );

  if (offer.type === "PERCENTAGE_DISCOUNT" && offer.percentage) {
    previewDiscountAmount = Math.round((targetSubtotal * (offer.percentage / 100)) * 100) / 100;
  } else if (offer.type === "FIXED_DISCOUNT" || offer.type === "ORDER_VALUE_DISCOUNT") {
    const fixed = offer.fixedAmount || (typeof offer.value === "number" ? offer.value : Number(offer.value)) || 0;
    previewDiscountAmount = Math.min(targetSubtotal, fixed);
  } else if (offer.type === "BUY_X_GET_Y") {
    const buyQty = offer.buyQuantity || offer.rules?.minQuantity || 1;
    const getQty = offer.getQuantity || 1;
    const totalMatchingQty = targetLines.reduce((acc, l) => acc + l.quantity, 0);
    const sets = Math.floor(totalMatchingQty / buyQty);
    previewBonusQuantity = sets * getQty;
    if (!previewBonusProductName && targetLines.length > 0) {
      previewBonusProductName = `${targetLines[0].productNameSnapshot} (Bonus)`;
    }
  } else if (offer.type === "BONUS_QUANTITY" || offer.type === "FREE_PRODUCT") {
    previewBonusQuantity = offer.bonusQuantity || offer.getQuantity || 1;
  }

  return {
    offer,
    isEligible: true,
    previewDiscountAmount,
    previewBonusQuantity,
    previewBonusProductName,
    appliedLines: targetLines.map((l) => l.id)
  };
}

export function evaluateAllOffers(
  offers: PharmacyOffer[],
  context: OfferEvaluationContext
): { eligible: PharmacyOfferEligibilityResult[]; ineligible: PharmacyOfferEligibilityResult[] } {
  const eligible: PharmacyOfferEligibilityResult[] = [];
  const ineligible: PharmacyOfferEligibilityResult[] = [];

  offers.forEach((offer) => {
    const res = evaluateOfferEligibility(offer, context);
    if (res.isEligible) {
      eligible.push(res);
    } else {
      ineligible.push(res);
    }
  });

  console.info(
    "[PHARMACY_VISIT_OFFER_ELIGIBILITY_JSON]",
    JSON.stringify({
      grossSubtotal: context.grossSubtotal,
      lineCount: context.lines.length,
      totalOffersEvaluated: offers.length,
      eligibleCount: eligible.length,
      ineligibleCount: ineligible.length,
      eligibleOfferIds: eligible.map((e) => e.offer.id),
      ineligibleDetails: ineligible.map((i) => ({
        offerId: i.offer.id,
        reason: i.rejectionReason,
        missingQty: i.missingQuantityToThreshold,
        missingValue: i.missingValueToThreshold
      })),
      timestamp: new Date().toISOString()
    })
  );

  return { eligible, ineligible };
}
