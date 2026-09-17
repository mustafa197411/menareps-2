import { PharmacyVisitDraft, OrderLineValidationResult } from "../types/domain";

export function isOrderTakingPurpose(purposeCode?: string): boolean {
  if (!purposeCode) return true; // Default to requiring order if purpose not specified
  const code = purposeCode.toUpperCase();
  return (
    code.includes("ORDER") ||
    code.includes("PURCHASE") ||
    code.includes("COMMERCIAL") ||
    code.includes("SALE") ||
    code === "TAKE_ORDER" ||
    code === "STOCK_REPLENISHMENT"
  );
}

export function validateStep2OrderDraft(draft: PharmacyVisitDraft): OrderLineValidationResult {
  const errors: string[] = [];

  // 1. Check Step 1 prerequisites
  if (!draft?.pharmacyId) {
    errors.push("Pharmacy selection from Step 1 is required.");
  }

  if (!draft?.visitPurpose) {
    errors.push("Visit purpose from Step 1 is required.");
  }

  const order = draft?.order;
  const lines = order?.lines ?? [];

  // 2. Check Order Requirement based on Visit Purpose
  const requiresOrder = isOrderTakingPurpose(draft?.visitPurpose?.code);

  if (requiresOrder && lines.length === 0) {
    errors.push(`Visit purpose '${draft?.visitPurpose?.labelEn || draft?.visitPurpose?.code || ""}' requires at least one valid order line.`);
  }

  // 3. Validate each Order Line
  lines.forEach((line, idx) => {
    const lineNum = idx + 1;

    if (!line?.canonicalProductId || line.canonicalProductId.trim() === "") {
      errors.push(`Line #${lineNum} (${line?.productNameSnapshot || "Item"}) is missing a canonical Product ID.`);
    }

    if (typeof line?.quantity !== "number" || !Number.isInteger(line.quantity) || line.quantity < 1) {
      errors.push(`Line #${lineNum} (${line?.productNameSnapshot || "Item"}) has an invalid quantity (${line?.quantity}). Minimum is 1.`);
    }

    if (!line?.userConfirmed) {
      errors.push(`Line #${lineNum} (${line?.productNameSnapshot || "Item"}) requires user review and confirmation before proceeding.`);
    }
  });

  const result: OrderLineValidationResult = {
    isValid: errors.length === 0,
    errors
  };

  console.info(
    "[PHARMACY_VISIT_STEP2_VALIDATION_JSON]",
    JSON.stringify({
      draftId: draft?.draftId || "",
      pharmacyId: draft?.pharmacyId || "",
      purposeCode: draft?.visitPurpose?.code || "",
      lineCount: lines.length,
      isValid: result.isValid,
      errorCount: errors.length,
      errors: result.errors,
      timestamp: new Date().toISOString()
    })
  );

  return result;
}

export const validateStep2 = validateStep2OrderDraft;
