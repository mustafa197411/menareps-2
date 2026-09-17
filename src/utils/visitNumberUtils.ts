import { resolveOperationalCountryCode, validateDisplayNumber } from "../lib/businessDocumentNumberService";

/**
 * Helper to compute a deterministic 6-digit sequence from a string identifier (e.g., Firestore doc ID)
 */
function deriveDeterministicSequence(idStr: string, fallbackIndex?: number): number {
  if (!idStr || typeof idStr !== "string") {
    return fallbackIndex !== undefined && fallbackIndex !== null && fallbackIndex >= 0 ? fallbackIndex + 1 : 1;
  }

  // Attempt to extract digits from ID e.g., "VST-9081" -> 9081 or "17200021" -> 200021
  const digitsMatch = idStr.match(/\d+/g);
  if (digitsMatch && digitsMatch.length > 0) {
    const lastDigits = digitsMatch[digitsMatch.length - 1];
    const extracted = parseInt(lastDigits, 10);
    if (!isNaN(extracted) && extracted > 0) {
      const mod = extracted % 1000000;
      return mod === 0 ? 1 : mod;
    }
  }

  // Fallback to string hash
  let hash = 0;
  for (let i = 0; i < idStr.length; i++) {
    hash = ((hash << 5) - hash) + idStr.charCodeAt(i);
    hash |= 0;
  }
  const seq = (Math.abs(hash) % 999999) + 1;
  return seq;
}

/**
 * Standardizes formatting of user-visible business visit numbers across MENAREPS 2.0.
 * Internal Firestore document IDs (e.g., PV2_<uid>_pv_draft_<timestamp>_<suffix> or raw UUIDs)
 * must NEVER be displayed in any user-facing UI.
 */
export function getVisitBusinessNumber(
  visit: any,
  fallbackIndex?: number,
  defaultPrefix: "PV" | "MV" = "PV"
): string {
  if (!visit) {
    const seq = fallbackIndex !== undefined && fallbackIndex !== null && fallbackIndex >= 0 ? fallbackIndex + 1 : 1;
    return `LY-${defaultPrefix}-LEG-${String(seq).padStart(6, "0")}`;
  }

  // If passed a direct string
  if (typeof visit === "string") {
    if (validateDisplayNumber(visit)) {
      return visit;
    }
    const seq = deriveDeterministicSequence(visit, fallbackIndex);
    return `LY-${defaultPrefix}-LEG-${String(seq).padStart(6, "0")}`;
  }

  // Check explicit fields on object
  const num = visit.visitNumber || visit.displayNumber || visit.visitDisplayNumber || (visit as any).formattedDisplayNumber;
  if (
    num &&
    typeof num === "string" &&
    !num.startsWith("PV2_") &&
    !num.includes("_pv_draft_") &&
    !num.startsWith("ORD_") &&
    num !== "Legacy Record — Number Not Assigned" &&
    validateDisplayNumber(num)
  ) {
    return num;
  }

  // Resolve prefix from visit type if not explicitly passed
  let prefix = defaultPrefix;
  if (visit.physicianId || visit.physicianName || visit.specialty || visit.primaryPromotionGroup) {
    prefix = "MV";
  } else if (visit.pharmacyId || visit.pharmacyName) {
    prefix = "PV";
  }

  // Resolve country code
  const countryInput =
    visit.countryId ||
    visit.countryCode ||
    visit.country ||
    visit.pharmacySnapshot?.countryId ||
    visit.pharmacySnapshot?.country ||
    "LY";
  const countryCode = resolveOperationalCountryCode(countryInput);

  // Derive legacy sequence
  const docId = visit.id || visit.visitId || visit.draftId || "";
  const legacySeq = deriveDeterministicSequence(docId, fallbackIndex);
  const paddedSeq = String(legacySeq).padStart(6, "0");
  return `${countryCode}-${prefix}-LEG-${paddedSeq}`;
}

/**
 * Standardizes formatting of user-visible business sales order numbers across MENAREPS 2.0.
 */
export function getOrderBusinessNumber(order: any, fallbackIndex?: number): string {
  if (!order) {
    const seq = fallbackIndex !== undefined && fallbackIndex >= 0 ? fallbackIndex + 1 : 1;
    return `LY-SO-LEG-${String(seq).padStart(6, "0")}`;
  }

  if (typeof order === "string") {
    if (validateDisplayNumber(order)) {
      return order;
    }
    const seq = deriveDeterministicSequence(order, fallbackIndex);
    return `LY-SO-LEG-${String(seq).padStart(6, "0")}`;
  }

  const num = order.displayNumber || order.orderDisplayNumber || order.orderNumber;
  if (
    num &&
    typeof num === "string" &&
    !num.startsWith("ORD_") &&
    !num.startsWith("PV2_") &&
    num !== "Legacy Record — Number Not Assigned" &&
    validateDisplayNumber(num)
  ) {
    return num;
  }

  const countryInput = order.countryId || order.countryCode || order.country || "LY";
  const countryCode = resolveOperationalCountryCode(countryInput);
  const docId = order.id || order.orderId || "";
  const legacySeq = deriveDeterministicSequence(docId, fallbackIndex);
  const paddedSeq = String(legacySeq).padStart(6, "0");
  return `${countryCode}-SO-LEG-${paddedSeq}`;
}

/**
 * Ensures clean visit number for CSV/PDF exports.
 */
export function getVisitNumberForExport(visit: any, index?: number, prefix: "PV" | "MV" = "PV"): string {
  return getVisitBusinessNumber(visit, index, prefix);
}

