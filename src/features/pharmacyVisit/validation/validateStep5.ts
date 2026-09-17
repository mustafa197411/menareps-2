import { PharmacyVisitDraft, Step5ValidationResult } from "../types/domain";
import { validateStep4 } from "./validateStep4";

export function validateStep5(draft: PharmacyVisitDraft): Step5ValidationResult {
  const errors: string[] = [];

  // 1. Validate Step 4 first (optional)
  const step4Res = validateStep4(draft);
  if (!step4Res.isValid) {
    const step4Errors = step4Res.errors ?? [];
    step4Errors.forEach((err) => errors.push(`Step 4 error: ${err}`));
  }

  const stockState = draft?.stock;
  const requestLines = stockState?.requestLines ?? [];

  // 2. Validate Stock Request Lines if any exist
  if (requestLines.length > 0) {
    requestLines.forEach((line, idx) => {
      if (!line?.canonicalProductId || !line.canonicalProductId.trim()) {
        errors.push(`Stock line #${idx + 1}: Product selection is required.`);
      }
      if (typeof line?.requestedQuantity !== "number" || isNaN(line.requestedQuantity) || line.requestedQuantity <= 0) {
        errors.push(`Stock line #${idx + 1} (${line?.productNameSnapshot || "Product"}): Requested quantity must be a positive number greater than 0.`);
      }
    });
  }

  // 3. Validate Competitive Intelligence pricing entries if provided
  const pricing = stockState?.competitiveIntelligence?.competitorPricing ?? [];
  pricing.forEach((p, idx) => {
    if (typeof p?.observedPrice !== "number" || isNaN(p.observedPrice) || p.observedPrice < 0) {
      errors.push(`Competitor price #${idx + 1} (${p?.brandOrProduct || "Item"}): Price cannot be negative.`);
    }
  });

  // 4. Validate Follow-up task if marked required
  const followUp = stockState?.followUp;
  if (followUp?.required) {
    if (!followUp.followUpDate || !followUp.followUpDate.trim()) {
      errors.push("Follow-up date is required when follow-up task is scheduled.");
    } else {
      const today = new Date().toISOString().split("T")[0];
      if (followUp.followUpDate < today) {
        errors.push("Follow-up date cannot be before the visit date.");
      }
    }
  }

  const isValid = errors.length === 0;

  console.info(
    "[PHARMACY_VISIT_STEP5_VALIDATION_JSON]",
    JSON.stringify({
      draftId: draft?.draftId || "",
      isValid,
      stockRequestCount: requestLines.length,
      hasCompetitiveIntelligence: !!stockState?.competitiveIntelligence,
      hasCrmNotes: !!stockState?.crmNotes,
      followUpRequired: followUp?.required ?? false,
      errors,
      timestamp: new Date().toISOString()
    })
  );

  return {
    isValid,
    errors
  };
}
