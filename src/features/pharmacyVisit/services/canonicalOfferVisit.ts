import type { CanonicalOfferDefinition } from "../../offers/types";
import { calculateOffers, OFFER_CALCULATION_VERSION, type OfferCalculationInput, type OfferCalculationResult } from "../../offers/offerCalculation";

export type OfferVisitReadiness = "NOT_READY" | "LOADING" | "READY_EMPTY" | "READY_WITH_OFFERS" | "PERMISSION_DENIED" | "CONFIGURATION_ERROR" | "NETWORK_ERROR" | "STALE";
export type OfferVisitEligibility = "ELIGIBLE" | "NOT_APPLICABLE" | "CONFLICTING" | "INVALID_DEFINITION" | "STALE";
export interface OfferDraftIntent { offerId: string; offerVersion: number; calculationVersion: string; selected: boolean; confirmed: boolean; confirmedAt?: string; inputFingerprint: string }
export interface OfferProceedValidation { valid: boolean; errors: string[] }

const clean = (value: unknown): string => typeof value === "string" ? value.trim() : "";
export function offerInputFingerprint(input: Pick<OfferCalculationInput, "currencyCode" | "decimalPlaces" | "roundingMode" | "paidLines"> & { selectedOffers?: ReadonlyArray<Pick<CanonicalOfferDefinition, "id" | "offerVersion">> }): string {
  const lines = [...input.paidLines].sort((a, b) => a.lineId.localeCompare(b.lineId)).map(line => [line.lineId, line.productId, line.quantity, line.unitPrice]);
  const offers = [...(input.selectedOffers || [])].map(offer => [offer.id, offer.offerVersion]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return JSON.stringify([input.currencyCode, input.decimalPlaces, input.roundingMode, lines, offers]);
}

export function evaluateVisitOffer(offer: CanonicalOfferDefinition, input: Omit<OfferCalculationInput, "selectedOffers">): { status: OfferVisitEligibility; result: OfferCalculationResult } {
  const result = calculateOffers({ ...input, selectedOffers: [offer] });
  if (!result.success) return { status: "INVALID_DEFINITION", result };
  if (result.rejectedOffers.length || result.appliedOffers.length === 0) return { status: "NOT_APPLICABLE", result };
  return { status: result.conflicts.length ? "CONFLICTING" : "ELIGIBLE", result };
}

export function buildOfferDraftIntent(offer: Pick<CanonicalOfferDefinition, "id" | "offerVersion">, inputFingerprint: string, confirmedFingerprint?: string, confirmedAt?: string): OfferDraftIntent {
  const confirmed = Boolean(inputFingerprint && confirmedFingerprint === inputFingerprint);
  return { offerId: offer.id, offerVersion: offer.offerVersion, calculationVersion: OFFER_CALCULATION_VERSION, selected: true, confirmed, ...(confirmed && confirmedAt ? { confirmedAt } : {}), inputFingerprint };
}

export function validateOfferProceed(
  intent: readonly OfferDraftIntent[],
  currentFingerprint: string,
  result: OfferCalculationResult | null,
): OfferProceedValidation {
  const selected = intent.filter(item => item.selected);
  if (selected.length === 0) return { valid: true, errors: [] };
  const errors: string[] = [];
  for (const item of selected) {
    if (!item.confirmed) errors.push(`OFFER_CONFIRMATION_REQUIRED:${item.offerId}`);
    else if (!currentFingerprint || item.inputFingerprint !== currentFingerprint) errors.push(`OFFER_CONFIRMATION_STALE:${item.offerId}`);
  }
  if (!result?.success) errors.push("OFFER_CALCULATION_INVALID");
  else {
    const applied = new Set(result.appliedOffers.map(item => item.offerId));
    const rejected = new Set(result.rejectedOffers.map(item => item.offerId));
    for (const item of selected) {
      if (rejected.has(item.offerId) || !applied.has(item.offerId)) errors.push(`OFFER_SELECTED_NOT_APPLIED:${item.offerId}`);
    }
  }
  return { valid: errors.length === 0, errors: Array.from(new Set(errors)) };
}

export function sanitizeOfferDraftIntent(value: unknown): OfferDraftIntent[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>(), output: OfferDraftIntent[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") continue;
    const row = candidate as Record<string, unknown>, offerId = clean(row.offerId), calculationVersion = clean(row.calculationVersion), inputFingerprint = clean(row.inputFingerprint);
    if (!offerId || seen.has(offerId) || !Number.isSafeInteger(row.offerVersion) || Number(row.offerVersion) < 1 || !calculationVersion || !inputFingerprint) continue;
    seen.add(offerId);
    // Restored intent always requires a fresh canonical load and confirmation.
    output.push({ offerId, offerVersion: Number(row.offerVersion), calculationVersion, inputFingerprint, selected: row.selected === true, confirmed: false });
  }
  return output;
}

export function sanitizeDraftOffers(value: unknown): OfferDraftIntent[] {
  if (Array.isArray(value)) return sanitizeOfferDraftIntent(value);
  if (!value || typeof value !== "object") return [];
  const row = value as Record<string, unknown>;
  if (Array.isArray(row.intent)) return sanitizeOfferDraftIntent(row.intent);
  const legacyApplied = Array.isArray(row.appliedOffers) ? row.appliedOffers : [];
  return sanitizeOfferDraftIntent(legacyApplied.map(item => {
    const old = item as Record<string, unknown>;
    return { offerId: old.offerId, offerVersion: Number(old.offerVersion || old.version), calculationVersion: old.calculationVersion, inputFingerprint: old.inputFingerprint, selected: true, confirmed: false };
  }));
}
