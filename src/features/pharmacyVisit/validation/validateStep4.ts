import { PharmacyVisitDraft, Step4ValidationResult } from "../types/domain";
import { validateStep3 } from "./validateStep3";

export const VISIT_COLLECTION_UNAVAILABLE_MESSAGE = "Collection recording is not available from Visit completion yet. Your saved amount has not been submitted. Keep the draft, or explicitly remove the amount in Step 4 to complete an operational Visit without recording collection.";

export function isFinancialCollectionPurpose(purposeCode?: string): boolean {
  if (!purposeCode) return false;
  const code = purposeCode.toUpperCase();
  return (
    code === "FINANCIAL_COLLECTION" ||
    code === "DEBT_COLLECTION" ||
    code === "COLLECTION_ONLY"
  );
}

export function validateStep4(draft: PharmacyVisitDraft): Step4ValidationResult {
  const errors: string[] = [];

  // 1. Validate Step 3 first (optional if empty)
  const step3Res = validateStep3(draft);
  if (!step3Res.isValid) {
    const step3Errors = step3Res.errors ?? [];
    step3Errors.forEach((err) => errors.push(`Step 3 error: ${err}`));
  }

  // 2. Validate Payment State
  const paymentState = draft?.payment;
  const paymentEntry = paymentState?.paymentEntry;
  const amount = paymentEntry?.amount === undefined ? 0 : paymentEntry.amount;

  if (typeof amount !== "number" || !Number.isFinite(amount)) {
    errors.push("Payment amount must be a valid number.");
  } else if (amount < 0) {
    errors.push("Payment amount cannot be negative.");
  }

  // Visit purpose does not require money to be recorded.
  if (typeof amount === "number" && amount > 0) errors.push(VISIT_COLLECTION_UNAVAILABLE_MESSAGE);

  // Method-specific checks ONLY when payment amount > 0
  if (amount > 0) {
    if (!paymentEntry?.method) {
      errors.push("Payment method is required when payment amount is greater than 0.");
    } else {
      const method = paymentEntry.method;
      if (method === "CHEQUE") {
        if (!paymentEntry.chequeNumber || !paymentEntry.chequeNumber.trim()) {
          errors.push("Cheque number is required for cheque payments.");
        }
        if (!paymentEntry.chequeDate || !paymentEntry.chequeDate.trim()) {
          errors.push("Cheque date is required for cheque payments.");
        }
      } else if (method === "BANK_TRANSFER") {
        if (!paymentEntry.bankReferenceNumber || !paymentEntry.bankReferenceNumber.trim()) {
          errors.push("Bank reference number is required for bank transfer payments.");
        }
      } else if (method === "OTHER") {
        if (!paymentEntry.otherMethodDescription || !paymentEntry.otherMethodDescription.trim()) {
          errors.push("Description is required when selecting 'Other' payment method.");
        }
      }
    }
  }

  const isValid = errors.length === 0;

  console.info(
    "[PHARMACY_VISIT_STEP4_VALIDATION_JSON]",
    JSON.stringify({
      draftId: draft?.draftId || "",
      isValid,
      paymentAmount: amount,
      method: paymentEntry?.method || "NONE",
      errors,
      timestamp: new Date().toISOString()
    })
  );

  return {
    isValid,
    errors
  };
}
