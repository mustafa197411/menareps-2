import { PharmacyVisitDraft, Step3ValidationResult } from "../types/domain";
import { validateStep2OrderDraft } from "./validateStep2";

export function validateStep3(draft: PharmacyVisitDraft): Step3ValidationResult {
  const errors: string[] = [];

  // 1. Verify Step 2 validity first
  const step2Res = validateStep2OrderDraft(draft);
  if (!step2Res.isValid) {
    const step2Errors = step2Res.errors ?? [];
    step2Errors.forEach((err) => errors.push(`Step 2 error: ${err}`));
  }

  const offersState = draft?.offers;
  // Draft diagnostics describe intent, never authoritative completion results.
  const selected = (draft.offerIntent || []).filter(item => item.selected);
  const offerDiagnostics = {
    selectedOfferCount: selected.length,
    confirmedOfferCount: selected.filter(item => item.confirmed).length,
    authoritativeApplicationStatus: "NOT_EVALUATED_AT_THIS_STAGE",
  };

  // If no offers state exists, step 3 is valid with 0 discounts if step 2 is valid
  if (!offersState) {
    console.info(
      "[PHARMACY_VISIT_STEP3_VALIDATION_JSON]",
      JSON.stringify({
        draftId: draft?.draftId || "",
        isValid: errors.length === 0,
        ...offerDiagnostics,
        netTotal: draft?.order?.subtotalPreview || 0,
        errors,
        timestamp: new Date().toISOString()
      })
    );
    return { isValid: errors.length === 0, errors };
  }

  // 2. Check for unresolved conflicts
  const conflicts = offersState?.conflicts ?? [];
  if (conflicts.length > 0) {
    const unresolved = conflicts.filter((c) => !c?.resolvedOfferId);
    if (unresolved.length > 0) {
      errors.push("Exclusive offer conflict must be resolved before proceeding.");
    }
  }

  // 3. Check that all applied offers are in eligibleOffers list
  const eligibleOffers = offersState?.eligibleOffers ?? [];
  const appliedOffers = offersState?.appliedOffers ?? [];
  const eligibleIds = new Set(eligibleOffers.map((e) => e?.offer?.id).filter(Boolean));
  appliedOffers.forEach((applied) => {
    if (applied?.offerId && !eligibleIds.has(applied.offerId)) {
      errors.push(`Applied offer '${applied?.offerNameSnapshot || applied?.offerId}' is no longer eligible.`);
    }

    if (typeof applied?.discountAmountPreview === "number" && applied.discountAmountPreview < 0) {
      errors.push(`Discount amount for offer '${applied?.offerNameSnapshot || "Offer"}' cannot be negative.`);
    }
  });

  // 4. Verify calculation net total >= 0
  if (offersState?.calculation && typeof offersState.calculation.netTotal === "number" && offersState.calculation.netTotal < 0) {
    errors.push("Order net total cannot be negative.");
  }

  const isValid = errors.length === 0;

  console.info(
    "[PHARMACY_VISIT_STEP3_VALIDATION_JSON]",
    JSON.stringify({
      draftId: draft?.draftId || "",
      isValid,
      ...offerDiagnostics,
      legacyPreviewOfferCount: appliedOffers.length,
      grossSubtotal: offersState?.calculation?.grossSubtotal || draft?.order?.subtotalPreview || 0,
      totalDiscountAmount: offersState?.calculation?.totalDiscountAmount || 0,
      netTotal: offersState?.calculation?.netTotal || draft?.order?.subtotalPreview || 0,
      errorCount: errors.length,
      errors,
      timestamp: new Date().toISOString()
    })
  );

  return { isValid, errors };
}
