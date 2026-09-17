import { PharmacyVisitDraft, Step6ValidationResult } from "../types/domain";
import { validateStep5 } from "./validateStep5";

export function validateStep6(draft: PharmacyVisitDraft): Step6ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Verify Step 1: Pharmacy & Visit Purpose Required
  if (!draft?.pharmacyId) {
    errors.push("Pharmacy selection is required (Step 1).");
  }

  if (!draft?.visitPurpose || !draft.visitPurpose.code) {
    errors.push("Visit Purpose selection is required (Step 1).");
  }

  // 2. Run Step 5 validation chain (which cascade-validates Step 4 & Step 3)
  const step5Res = validateStep5(draft);
  if (!step5Res.isValid) {
    const step5Errors = step5Res.errors ?? [];
    step5Errors.forEach((err) => errors.push(err));
  }

  // 3. Draft Internal Consistency Checks
  if (!draft?.repUid) {
    errors.push("Sales Representative UID is missing from visit draft.");
  }

  const orderLines = draft?.order?.lines ?? [];
  if (orderLines.length > 0) {
    orderLines.forEach((line, idx) => {
      if (typeof line?.quantity !== "number" || line.quantity <= 0) {
        errors.push(`Order line #${idx + 1} (${line?.productNameSnapshot || "Item"}): Quantity must be greater than 0.`);
      }
      if (typeof line?.unitPricePreview !== "number" || line.unitPricePreview < 0) {
        errors.push(`Order line #${idx + 1} (${line?.productNameSnapshot || "Item"}): Unit price cannot be negative.`);
      }
    });
  }

  // 4. Generate Non-blocking Informational Warnings
  const orderLinesCount = orderLines.length;
  if (orderLinesCount === 0) {
    warnings.push("No order items added for this visit.");
  }

  const collectedAmount = draft?.payment?.paymentEntry?.amount ?? 0;
  if (collectedAmount === 0) {
    warnings.push("No payment collection recorded for this visit.");
  }

  const gpsStatus = draft?.gps?.status || "NOT_ACQUIRED";
  if (gpsStatus === "NOT_ACQUIRED") {
    warnings.push("GPS location was not acquired during this visit.");
  }

  const stockLinesCount = draft?.stock?.requestLines?.length ?? 0;
  const competitorObsCount = draft?.stock?.competitiveIntelligence?.competitorBrands?.length ?? 0;
  if (stockLinesCount === 0 && competitorObsCount === 0) {
    warnings.push("No stock replenishment requests or competitive intelligence logged.");
  }

  const crmNotes = draft?.stock?.crmNotes?.generalNotes;
  if (!crmNotes || !crmNotes.trim()) {
    warnings.push("No CRM visit summary notes entered.");
  }

  const isValid = errors.length === 0;

  console.info(
    "[PHARMACY_VISIT_STEP6_VALIDATION_JSON]",
    JSON.stringify({
      draftId: draft?.draftId || "",
      isValid,
      errorsCount: errors.length,
      warningsCount: warnings.length,
      errors,
      warnings,
      timestamp: new Date().toISOString()
    })
  );

  return {
    isValid,
    errors,
    warnings
  };
}
