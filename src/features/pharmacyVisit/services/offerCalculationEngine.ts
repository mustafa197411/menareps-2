import { 
  AppliedOfferSnapshot, 
  OfferBonusLine, 
  OfferCalculationResult, 
  OfferConflict, 
  OfferDiscountLine, 
  PharmacyOfferEligibilityResult, 
  PharmacyOrderLine 
} from "../types/domain";

export function calculateOfferTotals(
  grossSubtotal: number,
  appliedOffers: AppliedOfferSnapshot[],
  eligibleOffersMap: Map<string, PharmacyOfferEligibilityResult>,
  lines: PharmacyOrderLine[]
): { calculation: OfferCalculationResult; conflicts: OfferConflict[] } {
  const discountLines: OfferDiscountLine[] = [];
  const bonusLines: OfferBonusLine[] = [];
  const conflicts: OfferConflict[] = [];

  const exclusiveApplied: AppliedOfferSnapshot[] = [];

  appliedOffers.forEach((snap) => {
    const eligibleInfo = eligibleOffersMap.get(snap.offerId);
    if (!eligibleInfo || !eligibleInfo.isEligible) {
      return;
    }

    // Track exclusive offers for conflict detection
    if (eligibleInfo.offer.isExclusive) {
      exclusiveApplied.push(snap);
    }

    // 1. Calculate discount
    if (snap.discountAmountPreview > 0) {
      discountLines.push({
        offerId: snap.offerId,
        offerCode: snap.offerCode,
        offerName: snap.offerNameSnapshot,
        discountType: snap.type,
        discountAmount: snap.discountAmountPreview,
        currency: snap.currency || ""
      });
    }

    // 2. Calculate bonus lines
    if (eligibleInfo.previewBonusQuantity && eligibleInfo.previewBonusQuantity > 0) {
      const bonusProdId = eligibleInfo.offer.freeProductId || eligibleInfo.offer.productId || lines[0]?.canonicalProductId || "PRD-BONUS";
      const bonusProdCode = eligibleInfo.offer.freeProductCode || lines[0]?.productCode || "BONUS";
      const bonusName = eligibleInfo.previewBonusProductName || `${snap.offerNameSnapshot} Free Bonus`;

      bonusLines.push({
        id: `bonus_${snap.offerId}_${Date.now()}`,
        offerId: snap.offerId,
        offerCode: snap.offerCode,
        offerName: snap.offerNameSnapshot,
        productId: bonusProdId,
        productCode: bonusProdCode,
        productName: bonusName,
        bonusQuantity: eligibleInfo.previewBonusQuantity,
        unitPricePreview: 0,
        currency: snap.currency || ""
      });
    }
  });

  // Detect conflicts if more than 1 exclusive offer is applied
  if (exclusiveApplied.length > 1) {
    for (let i = 0; i < exclusiveApplied.length - 1; i++) {
      for (let j = i + 1; j < exclusiveApplied.length; j++) {
        conflicts.push({
          offerIdA: exclusiveApplied[i].offerId,
          offerNameA: exclusiveApplied[i].offerNameSnapshot,
          offerIdB: exclusiveApplied[j].offerId,
          offerNameB: exclusiveApplied[j].offerNameSnapshot,
          conflictReason: "EXCLUSIVE_OFFER_OVERLAP"
        });
      }
    }

    console.info(
      "[PHARMACY_VISIT_OFFER_CONFLICT_JSON]",
      JSON.stringify({
        conflictCount: conflicts.length,
        conflicts: conflicts.map((c) => ({
          offerA: c.offerNameA,
          offerB: c.offerNameB,
          reason: c.conflictReason
        })),
        timestamp: new Date().toISOString()
      })
    );
  }

  const rawTotalDiscount = discountLines.reduce((acc, d) => acc + d.discountAmount, 0);
  const totalDiscountAmount = Math.min(grossSubtotal, Math.round(rawTotalDiscount * 100) / 100);
  const netTotal = Math.max(0, Math.round((grossSubtotal - totalDiscountAmount) * 100) / 100);

  const calculationCurrency = appliedOffers[0]?.currency || "";

  const calculation: OfferCalculationResult = {
    grossSubtotal: Math.round(grossSubtotal * 100) / 100,
    totalDiscountAmount,
    netTotal,
    currency: calculationCurrency,
    discountLines,
    bonusLines,
    calculationTimestamp: new Date().toISOString()
  };

  console.info(
    "[PHARMACY_VISIT_OFFER_CALCULATION_JSON]",
    JSON.stringify({
      grossSubtotal: calculation.grossSubtotal,
      totalDiscountAmount: calculation.totalDiscountAmount,
      netTotal: calculation.netTotal,
      appliedOfferCount: appliedOffers.length,
      bonusLineCount: bonusLines.length,
      hasConflicts: conflicts.length > 0,
      timestamp: new Date().toISOString()
    })
  );

  return { calculation, conflicts };
}
