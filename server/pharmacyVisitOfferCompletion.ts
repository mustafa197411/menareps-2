import { calculateOffersForServer, OFFER_CALCULATION_VERSION, type OfferCalculationResult, type AppliedOfferCalculation, type CalculatedPaidLine } from "../src/features/offers/offerCalculation";
import { DEFAULT_OFFER_ROUNDING_MODE, OFFER_ROUNDING_MODES, type CanonicalOfferDefinition, type OfferRoundingMode } from "../src/features/offers/types";
import { validateCanonicalOfferDefinition } from "../src/features/offers/offerValidation";
import { offerInputFingerprint, type OfferDraftIntent } from "../src/features/pharmacyVisit/services/canonicalOfferVisit";
import { readProductAvailableToPromise } from "./pharmacyProductAvailabilityService";

export type PharmacyVisitOfferCompletionCode =
  | "PHARMACY_VISIT_OFFER_SELECTION_LIMIT_EXCEEDED"
  | "PHARMACY_VISIT_OFFER_CONFIRMATION_REQUIRED" | "PHARMACY_VISIT_OFFER_CONFIRMATION_STALE"
  | "PHARMACY_VISIT_OFFER_NOT_FOUND" | "PHARMACY_VISIT_OFFER_VERSION_STALE"
  | "PHARMACY_VISIT_OFFER_NOT_APPLICABLE" | "PHARMACY_VISIT_OFFER_CONFLICT"
  | "PHARMACY_VISIT_OFFER_CALCULATION_INVALID" | "PHARMACY_VISIT_OFFER_MARKET_CONFIGURATION_REQUIRED"
  | "PHARMACY_VISIT_OFFER_REWARD_STOCK_INSUFFICIENT";

export class PharmacyVisitOfferCompletionError extends Error {
  constructor(public readonly code: PharmacyVisitOfferCompletionCode, public readonly safeReferences?: { offerId?: string; productId?: string }) { super(code); }
}

const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const activeCommercial = (product: Record<string, unknown>): boolean => product.active !== false && product.isActive !== false && product.isDeleted !== true && product.status !== "Inactive" && product.status !== "Archived" && product.isSample !== true && product.isSampleSku !== true && !/sample/i.test(text(product.productType));

export function parseCompletionOfferIntent(value: unknown): OfferDraftIntent[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new PharmacyVisitOfferCompletionError("PHARMACY_VISIT_OFFER_CONFIRMATION_REQUIRED");
  if (value.length > 20) throw new PharmacyVisitOfferCompletionError("PHARMACY_VISIT_OFFER_SELECTION_LIMIT_EXCEEDED");
  for (let index = 0; index < value.length; index++) if (!Object.prototype.hasOwnProperty.call(value, index)) throw new PharmacyVisitOfferCompletionError("PHARMACY_VISIT_OFFER_CONFIRMATION_REQUIRED");
  const allowed = new Set(["offerId", "offerVersion", "calculationVersion", "selected", "confirmed", "confirmedAt", "inputFingerprint"]), seen = new Set<string>();
  return value.map(candidate => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate) || Object.keys(candidate).some(key => !allowed.has(key))) throw new PharmacyVisitOfferCompletionError("PHARMACY_VISIT_OFFER_CONFIRMATION_REQUIRED");
    const row = candidate as Record<string, unknown>, offerId = typeof row.offerId === "string" ? row.offerId : "", calculationVersion = text(row.calculationVersion), inputFingerprint = text(row.inputFingerprint), confirmedAt = text(row.confirmedAt);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(offerId) || seen.has(offerId) || !Number.isSafeInteger(row.offerVersion) || Number(row.offerVersion) < 1 || row.selected !== true || row.confirmed !== true || !confirmedAt || !Number.isFinite(Date.parse(confirmedAt))) throw new PharmacyVisitOfferCompletionError("PHARMACY_VISIT_OFFER_CONFIRMATION_REQUIRED", { offerId: offerId || undefined });
    if (calculationVersion !== OFFER_CALCULATION_VERSION || !inputFingerprint) throw new PharmacyVisitOfferCompletionError("PHARMACY_VISIT_OFFER_CONFIRMATION_STALE", { offerId });
    seen.add(offerId);
    return { offerId, offerVersion: Number(row.offerVersion), calculationVersion, selected: true, confirmed: true, confirmedAt, inputFingerprint };
  });
}

export interface AuthoritativeOfferContext {
  intents: OfferDraftIntent[];
  offerDocuments: Map<string, Record<string, unknown>>;
  products: Map<string, Record<string, unknown>>;
  paidLines: Array<{ lineId: string; productId: string; quantity: number; unitPrice: number; productName?: string; sku?: string }>;
  currencyCode: string;
  decimalPlaces: number;
  roundingMode?: unknown;
  now: Date;
  pharmacy: { id: string; companyId: string; marketId: string; countryId: string; districtId: string; cityId: string; areaId: string; type: string };
  authorizedProductIds: ReadonlySet<string>;
}

export interface AuthoritativeOfferSnapshot {
  calculationVersion: string; calculatedAt: string; currencyCode: string; decimalPlaces: number; roundingMode: OfferRoundingMode;
  selectedOfferIds: string[]; appliedOffers: AppliedOfferCalculation[];
  paidLines: CalculatedPaidLine[];
  freeLines: Array<{ lineKind: "PROMOTIONAL_FREE_LINE"; productId: string; quantity: number; unitPrice: 0; grossAmount: 0; netAmount: 0; sourceOfferId: string; sourceOfferVersion: number; calculationVersion: string; deterministicFreeLineKey: string; triggerPaidLineIds: string[] }>;
  grossSubtotal: number; productDiscountTotal: number; subtotalAfterProductDiscounts: number; invoiceDiscountTotal: number; totalDiscount: number; netSubtotal: number;
}

function scopeMatches(offer: CanonicalOfferDefinition, context: AuthoritativeOfferContext): boolean {
  const e = offer.eligibility, p = context.pharmacy, now = context.now.getTime();
  if (offer.lifecycleStatus !== "ACTIVE" || now < Date.parse(e.startAt) || now > Date.parse(e.endAt)) return false;
  const triggers = offer.productScope.mode === "ALL_PRODUCTS" ? context.paidLines.map(line => line.productId) : offer.productScope.productIds;
  if (!triggers.some(id => context.paidLines.some(line => line.productId === id)) || triggers.some(id => !context.authorizedProductIds.has(id))) return false;
  const rewardId = "reward" in offer.benefit && offer.benefit.reward.mode === "SELECTED_PRODUCT" ? offer.benefit.reward.rewardProductId : "";
  return !rewardId || context.authorizedProductIds.has(rewardId);
}

export function calculateAuthoritativeVisitOffers(context: AuthoritativeOfferContext): AuthoritativeOfferSnapshot | null {
  if (context.intents.length === 0) return null;
  if (!text(context.currencyCode) || !Number.isInteger(context.decimalPlaces) || context.decimalPlaces < 0 || context.decimalPlaces > 6) throw new PharmacyVisitOfferCompletionError("PHARMACY_VISIT_OFFER_MARKET_CONFIGURATION_REQUIRED");
  const roundingMode = context.roundingMode === undefined ? DEFAULT_OFFER_ROUNDING_MODE : (OFFER_ROUNDING_MODES as readonly unknown[]).includes(context.roundingMode) ? context.roundingMode as OfferRoundingMode : null;
  if (!roundingMode) throw new PharmacyVisitOfferCompletionError("PHARMACY_VISIT_OFFER_MARKET_CONFIGURATION_REQUIRED");
  const offers: CanonicalOfferDefinition[] = [];
  for (const intent of context.intents) {
    const document = context.offerDocuments.get(intent.offerId);
    if (!document) throw new PharmacyVisitOfferCompletionError("PHARMACY_VISIT_OFFER_NOT_FOUND", { offerId: intent.offerId });
    const parsed = validateCanonicalOfferDefinition({ ...document, id: intent.offerId });
    if (!parsed.valid || !scopeMatches(parsed.value, context)) throw new PharmacyVisitOfferCompletionError("PHARMACY_VISIT_OFFER_NOT_APPLICABLE", { offerId: intent.offerId });
    if (parsed.value.offerVersion !== intent.offerVersion) throw new PharmacyVisitOfferCompletionError("PHARMACY_VISIT_OFFER_VERSION_STALE", { offerId: intent.offerId });
    offers.push(parsed.value);
  }
  const fingerprint = offerInputFingerprint({ currencyCode: context.currencyCode, decimalPlaces: context.decimalPlaces, roundingMode, paidLines: context.paidLines, selectedOffers: offers });
  const stale = context.intents.find(intent => intent.inputFingerprint !== fingerprint);
  if (stale) throw new PharmacyVisitOfferCompletionError("PHARMACY_VISIT_OFFER_CONFIRMATION_STALE", { offerId: stale.offerId });
  const result = calculateOffersForServer({ currencyCode: context.currencyCode, decimalPlaces: context.decimalPlaces, roundingMode, paidLines: context.paidLines, selectedOffers: offers });
  if (!result.success) throw new PharmacyVisitOfferCompletionError("PHARMACY_VISIT_OFFER_CALCULATION_INVALID");
  if (result.conflicts.length) throw new PharmacyVisitOfferCompletionError("PHARMACY_VISIT_OFFER_CONFLICT", { offerId: result.conflicts[0].offerId });
  const applied = new Set(result.appliedOffers.map(item => item.offerId));
  const rejected = context.intents.find(intent => !applied.has(intent.offerId) || result.rejectedOffers.some(item => item.offerId === intent.offerId));
  if (rejected) throw new PharmacyVisitOfferCompletionError("PHARMACY_VISIT_OFFER_NOT_APPLICABLE", { offerId: rejected.offerId });
  const freeByProduct = new Map<string, number>();
  for (const line of result.freeLines) freeByProduct.set(line.rewardProductId, (freeByProduct.get(line.rewardProductId) || 0) + line.quantity);
  for (const [productId, freeQuantity] of freeByProduct) {
    const product = context.products.get(productId), available = product ? readProductAvailableToPromise(product) : null;
    if (!product || !activeCommercial(product) || !context.authorizedProductIds.has(productId)) throw new PharmacyVisitOfferCompletionError("PHARMACY_VISIT_OFFER_NOT_APPLICABLE", { productId });
    const paidQuantity = context.paidLines.filter(line => line.productId === productId).reduce((sum, line) => sum + line.quantity, 0);
    if (available == null || available < paidQuantity + freeQuantity) throw new PharmacyVisitOfferCompletionError("PHARMACY_VISIT_OFFER_REWARD_STOCK_INSUFFICIENT", { productId });
  }
  return {
    calculationVersion: result.calculationVersion, calculatedAt: context.now.toISOString(), currencyCode: result.currencyCode, decimalPlaces: result.decimalPlaces, roundingMode: result.roundingMode,
    selectedOfferIds: context.intents.map(intent => intent.offerId).sort(), appliedOffers: result.appliedOffers, paidLines: result.paidLines,
    freeLines: result.freeLines.map(line => ({ lineKind: line.lineKind, productId: line.rewardProductId, quantity: line.quantity, unitPrice: 0, grossAmount: 0, netAmount: 0, sourceOfferId: line.sourceOfferId, sourceOfferVersion: line.sourceOfferVersion, calculationVersion: result.calculationVersion, deterministicFreeLineKey: line.deterministicLineKey, triggerPaidLineIds: line.triggerPaidLineIds })),
    grossSubtotal: result.grossPaidSubtotal, productDiscountTotal: result.productDiscountTotal, subtotalAfterProductDiscounts: result.subtotalAfterProductDiscounts, invoiceDiscountTotal: result.invoiceDiscountTotal, totalDiscount: result.totalDiscount, netSubtotal: result.netSubtotal,
  };
}
