import {
  CANONICAL_OFFER_SCHEMA_VERSION,
  OFFER_ROUNDING_MODES,
  type CanonicalOfferDefinition,
  type OfferCompatibility,
  type OfferRoundingMode,
  type TierBonusTier,
} from "./types";
import { validateCanonicalOfferDefinition } from "./offerValidation";

export const OFFER_CALCULATION_VERSION = "MENAREPS_OFFERS_V1" as const;
export const OFFER_DECIMAL_PLACES_RANGE = { minimum: 0, maximum: 6 } as const;

export type OfferCalculationCode =
  | "OFFER_CALCULATION_INPUT_INVALID" | "OFFER_NOT_APPLICABLE" | "OFFER_PRODUCT_SCOPE_EMPTY"
  | "OFFER_CONFLICT" | "OFFER_DUPLICATE_SELECTION" | "OFFER_UNSUPPORTED_TYPE"
  | "OFFER_UNSUPPORTED_SCHEMA" | "OFFER_INVALID_PERCENTAGE" | "OFFER_INVALID_QUANTITY"
  | "OFFER_INVALID_TIER" | "OFFER_INVALID_REWARD" | "OFFER_INVALID_CURRENCY"
  | "OFFER_INVALID_DECIMAL_PLACES" | "OFFER_UNSAFE_MONETARY_VALUE" | "OFFER_DISCOUNT_EXCEEDS_BASE";

export interface OfferCalculationPaidLineInput {
  lineId: string;
  productId: string;
  unitPrice: number;
  quantity: number;
  productName?: string;
  sku?: string;
}

export interface OfferCalculationInput {
  currencyCode: string;
  decimalPlaces: number;
  roundingMode: OfferRoundingMode;
  paidLines: OfferCalculationPaidLineInput[];
  selectedOffers: CanonicalOfferDefinition[];
}

export interface OfferCalculationIssue { code: OfferCalculationCode; path: string; message: string }
export interface RejectedOffer { offerId: string; offerVersion?: number; code: OfferCalculationCode; message: string }
export interface OfferConflict { offerId: string; conflictingOfferId: string; paidLineIds: string[]; code: "OFFER_CONFLICT"; message: string }
export interface AppliedTierBreakdown {
  aggregationGroup: string;
  tierThreshold: number;
  tierReward: number;
  repetitions: number;
  consumedPaidQuantity: number;
  generatedFreeQuantity: number;
}
export interface CalculatedPaidLine {
  lineId: string; productId: string; quantity: number; unitPrice: number; grossAmount: number;
  productDiscountAmount: number; invoiceDiscountAmount: number; totalDiscountAmount: number;
  netAmount: number; appliedOfferIds: string[];
}
export interface CalculatedFreeLine {
  deterministicLineKey: string; rewardProductId: string; quantity: number; sourceOfferId: string;
  sourceOfferVersion: number; triggerPaidLineIds: string[]; lineKind: "PROMOTIONAL_FREE_LINE";
}
export interface AppliedOfferCalculation {
  offerId: string; offerVersion: number; offerType: CanonicalOfferDefinition["type"];
  appliedPaidLineIds: string[]; appliedTierBreakdown?: AppliedTierBreakdown[];
  grossEligibleBase: number; discountAmount: number; freeQuantity: number;
}
export type OfferCalculationResult =
  | { success: false; calculationVersion: typeof OFFER_CALCULATION_VERSION; errors: OfferCalculationIssue[] }
  | {
      success: true; calculationVersion: typeof OFFER_CALCULATION_VERSION; currencyCode: string; decimalPlaces: number;
      roundingMode: OfferRoundingMode; paidLines: CalculatedPaidLine[]; freeLines: CalculatedFreeLine[];
      appliedOffers: AppliedOfferCalculation[]; rejectedOffers: RejectedOffer[]; conflicts: OfferConflict[];
      grossPaidSubtotal: number; productDiscountTotal: number; subtotalAfterProductDiscounts: number;
      invoiceDiscountTotal: number; totalDiscount: number; netSubtotal: number;
    };

interface Rational { numerator: bigint; denominator: bigint }
interface WorkingLine extends OfferCalculationPaidLineInput {
  grossMinor: bigint; productDiscountMinor: bigint; invoiceDiscountMinor: bigint; appliedOfferIds: string[];
}
interface Resolution { offer: CanonicalOfferDefinition; lineIds: string[] }

const issue = (code: OfferCalculationCode, path: string, message: string): OfferCalculationIssue => ({ code, path, message });
const power10 = (places: number): bigint => 10n ** BigInt(places);
const nonBlank = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const compareText = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

function rationalFromNumber(value: number): Rational | null {
  if (!Number.isFinite(value)) return null;
  const negative = value < 0;
  const [coefficient, exponentText = "0"] = Math.abs(value).toString().toLowerCase().split("e");
  const exponent = Number(exponentText);
  const [whole, fraction = ""] = coefficient.split(".");
  const digits = `${whole}${fraction}`.replace(/^0+(?=\d)/, "") || "0";
  let numerator = BigInt(digits), denominator = power10(fraction.length);
  if (exponent >= 0) numerator *= power10(exponent); else denominator *= power10(-exponent);
  return { numerator: negative ? -numerator : numerator, denominator };
}

function roundRatio(numerator: bigint, denominator: bigint, mode: OfferRoundingMode): bigint {
  const quotient = numerator / denominator, remainder = numerator % denominator;
  const comparison = remainder * 2n - denominator;
  if (comparison > 0n || (comparison === 0n && (mode === "DECIMAL_HALF_UP" || quotient % 2n !== 0n))) return quotient + 1n;
  return quotient;
}

function scaled(value: number, decimalPlaces: number, mode: OfferRoundingMode, multiplier = 1): bigint | null {
  const rational = rationalFromNumber(value);
  if (!rational || rational.numerator < 0n || !Number.isSafeInteger(multiplier) || multiplier < 0) return null;
  const minor = roundRatio(rational.numerator * BigInt(multiplier) * power10(decimalPlaces), rational.denominator, mode);
  return minor <= BigInt(Number.MAX_SAFE_INTEGER) ? minor : null;
}

function percentOfMinor(base: bigint, percentage: number, mode: OfferRoundingMode): bigint | null {
  const rational = rationalFromNumber(percentage);
  if (!rational || rational.numerator <= 0n) return null;
  const result = roundRatio(base * rational.numerator, rational.denominator * 100n, mode);
  return result <= base && result <= BigInt(Number.MAX_SAFE_INTEGER) ? result : null;
}

function money(minor: bigint, decimalPlaces: number): number {
  if (minor === 0n) return 0;
  return Number(minor) / (10 ** decimalPlaces);
}

function validateInput(input: OfferCalculationInput): OfferCalculationIssue[] {
  const errors: OfferCalculationIssue[] = [];
  if (!input || typeof input !== "object") return [issue("OFFER_CALCULATION_INPUT_INVALID", "input", "Calculation input is required.")];
  if (!nonBlank(input.currencyCode)) errors.push(issue("OFFER_INVALID_CURRENCY", "currencyCode", "Currency code is required."));
  if (!Number.isInteger(input.decimalPlaces) || input.decimalPlaces < OFFER_DECIMAL_PLACES_RANGE.minimum || input.decimalPlaces > OFFER_DECIMAL_PLACES_RANGE.maximum) errors.push(issue("OFFER_INVALID_DECIMAL_PLACES", "decimalPlaces", "Decimal places must be a whole number from 0 through 6."));
  if (!(OFFER_ROUNDING_MODES as readonly string[]).includes(input.roundingMode)) errors.push(issue("OFFER_CALCULATION_INPUT_INVALID", "roundingMode", "A supported rounding mode is required."));
  if (!Array.isArray(input.paidLines) || input.paidLines.length === 0) errors.push(issue("OFFER_CALCULATION_INPUT_INVALID", "paidLines", "At least one paid line is required."));
  const lineIds = new Set<string>();
  (input.paidLines || []).forEach((line, index) => {
    if (!nonBlank(line.lineId) || !nonBlank(line.productId)) errors.push(issue("OFFER_CALCULATION_INPUT_INVALID", `paidLines.${index}`, "Line and Product IDs must be nonblank."));
    if (lineIds.has(line.lineId)) errors.push(issue("OFFER_CALCULATION_INPUT_INVALID", `paidLines.${index}.lineId`, "Paid line IDs must be unique."));
    lineIds.add(line.lineId);
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) errors.push(issue("OFFER_INVALID_QUANTITY", `paidLines.${index}.quantity`, "Paid quantity must be a positive safe integer."));
    if (!Number.isFinite(line.unitPrice) || line.unitPrice < 0) errors.push(issue("OFFER_UNSAFE_MONETARY_VALUE", `paidLines.${index}.unitPrice`, "Unit price must be finite and nonnegative."));
  });
  if (!Number.isSafeInteger((input.paidLines || []).reduce((sum, line) => sum + (Number.isSafeInteger(line.quantity) ? line.quantity : 0), 0))) errors.push(issue("OFFER_INVALID_QUANTITY", "paidLines", "Aggregate paid quantity exceeds the safe integer boundary."));
  if (!Array.isArray(input.selectedOffers)) errors.push(issue("OFFER_CALCULATION_INPUT_INVALID", "selectedOffers", "Selected Offers must be an array."));
  const selections = new Set<string>();
  (input.selectedOffers || []).forEach((offer, index) => {
    const key = `${offer?.id || ""}:${offer?.offerVersion || ""}`;
    if (selections.has(key)) errors.push(issue("OFFER_DUPLICATE_SELECTION", `selectedOffers.${index}`, "Duplicate Offer ID/version selections are not permitted."));
    selections.add(key);
    const validated = validateCanonicalOfferDefinition(offer);
    if (!validated.valid) {
      const codes = new Set(validated.errors.map(error => error.code));
      const code: OfferCalculationCode = codes.has("UNSUPPORTED_SCHEMA_VERSION") ? "OFFER_UNSUPPORTED_SCHEMA"
        : codes.has("UNSUPPORTED_TYPE") ? "OFFER_UNSUPPORTED_TYPE"
          : codes.has("INVALID_PERCENTAGE") || codes.has("UNSAFE_NUMERIC_VALUE") && String(offer?.type).includes("PERCENTAGE") ? "OFFER_INVALID_PERCENTAGE"
            : codes.has("INVALID_TIER_COUNT") || codes.has("DUPLICATE_TIER_THRESHOLDS") || codes.has("UNORDERED_TIER_THRESHOLDS") ? "OFFER_INVALID_TIER"
              : codes.has("MISSING_REWARD_PRODUCT") || codes.has("FORBIDDEN_REWARD_PRODUCT") || codes.has("INVALID_REWARD_AGGREGATION") ? "OFFER_INVALID_REWARD"
                : codes.has("INVALID_BUY_QUANTITY") || codes.has("INVALID_FREE_QUANTITY") || codes.has("UNSAFE_NUMERIC_VALUE") ? "OFFER_INVALID_QUANTITY"
                  : "OFFER_CALCULATION_INPUT_INVALID";
      errors.push(issue(code, `selectedOffers.${index}`, "Selected Offer is not a valid canonical definition."));
    }
  });
  return errors;
}

function eligibleLineIds(offer: CanonicalOfferDefinition, lines: readonly WorkingLine[]): string[] {
  const allowed = offer.productScope.mode === "ALL_PRODUCTS" ? null : new Set(offer.productScope.productIds);
  return lines.filter(line => !allowed || allowed.has(line.productId)).map(line => line.lineId).sort();
}

function expectedCompatibility(type: CanonicalOfferDefinition["type"]): OfferCompatibility | null {
  if (type === "PRODUCT_PERCENTAGE") return "PRODUCT_PERCENTAGE_WITH_INVOICE_PERCENTAGE";
  if (type === "BUY_X_GET_Y") return "BUY_X_GET_Y_WITH_INVOICE_PERCENTAGE";
  if (type === "TIER_BONUS") return "TIER_BONUS_WITH_INVOICE_PERCENTAGE";
  return null;
}

/** Compatibility is deliberately mutual: both definitions must declare the same known pair. */
export function offersAreMutuallyCompatible(left: CanonicalOfferDefinition, right: CanonicalOfferDefinition): boolean {
  const invoice = left.type === "INVOICE_PERCENTAGE" ? left : right.type === "INVOICE_PERCENTAGE" ? right : null;
  const other = invoice === left ? right : invoice === right ? left : null;
  const combination = other ? expectedCompatibility(other.type) : null;
  return Boolean(combination && left.stackingPolicy.mode === "EXPLICIT_COMPATIBILITY" && right.stackingPolicy.mode === "EXPLICIT_COMPATIBILITY" && left.stackingPolicy.compatibleCombination === combination && right.stackingPolicy.compatibleCombination === combination);
}

function compareOffers(left: CanonicalOfferDefinition, right: CanonicalOfferDefinition): number {
  const explicit = Number(right.stackingPolicy.mode === "EXPLICIT_COMPATIBILITY") - Number(left.stackingPolicy.mode === "EXPLICIT_COMPATIBILITY");
  return explicit || right.stackingPolicy.priority - left.stackingPolicy.priority || compareText(left.id, right.id) || left.offerVersion - right.offerVersion;
}

function resolveOffers(offers: CanonicalOfferDefinition[], lines: WorkingLine[]) {
  const resolutions: Resolution[] = [], rejected: RejectedOffer[] = [], conflicts: OfferConflict[] = [];
  const occupiedByLine = new Map<string, CanonicalOfferDefinition>();
  let invoiceResolution: Resolution | null = null;
  for (const offer of [...offers].sort(compareOffers)) {
    if (offer.lifecycleStatus !== "ACTIVE") { rejected.push({ offerId: offer.id, offerVersion: offer.offerVersion, code: "OFFER_NOT_APPLICABLE", message: `${offer.lifecycleStatus} Offers are not operationally active.` }); continue; }
    const eligible = eligibleLineIds(offer, lines);
    if (!eligible.length) { rejected.push({ offerId: offer.id, offerVersion: offer.offerVersion, code: offer.productScope.mode === "SELECTED_PRODUCTS" ? "OFFER_PRODUCT_SCOPE_EMPTY" : "OFFER_NOT_APPLICABLE", message: "No supplied paid line is in Offer scope." }); continue; }
    if (offer.type === "INVOICE_PERCENTAGE") {
      if (invoiceResolution) {
        conflicts.push({ offerId: offer.id, conflictingOfferId: invoiceResolution.offer.id, paidLineIds: eligible, code: "OFFER_CONFLICT", message: "Only one Invoice Percentage Offer is permitted." });
        rejected.push({ offerId: offer.id, offerVersion: offer.offerVersion, code: "OFFER_CONFLICT", message: "A higher-ranked Invoice Percentage Offer was selected." }); continue;
      }
      const incompatible = [...occupiedByLine.entries()].filter(([lineId, selected]) => eligible.includes(lineId) && !offersAreMutuallyCompatible(offer, selected));
      if (incompatible.length) {
        conflicts.push({ offerId: offer.id, conflictingOfferId: incompatible[0][1].id, paidLineIds: incompatible.map(([id]) => id).sort(), code: "OFFER_CONFLICT", message: "Invoice and line Offer do not mutually declare compatibility." });
        rejected.push({ offerId: offer.id, offerVersion: offer.offerVersion, code: "OFFER_CONFLICT", message: "A higher-ranked incompatible Offer was selected." }); continue;
      }
      invoiceResolution = { offer, lineIds: eligible }; resolutions.push(invoiceResolution); continue;
    }
    const incompatibleInvoiceIds = invoiceResolution && !offersAreMutuallyCompatible(offer, invoiceResolution.offer) ? eligible.filter(id => invoiceResolution!.lineIds.includes(id)) : [];
    const occupiedIds = eligible.filter(id => occupiedByLine.has(id));
    const blocked = [...new Set([...incompatibleInvoiceIds, ...occupiedIds])].sort();
    if (blocked.length) {
      const conflicting = occupiedByLine.get(blocked[0]) || invoiceResolution?.offer;
      conflicts.push({ offerId: offer.id, conflictingOfferId: conflicting?.id || "", paidLineIds: blocked, code: "OFFER_CONFLICT", message: "Paid quantity cannot be reused by incompatible Offers." });
    }
    if ("aggregationMode" in offer.benefit && offer.benefit.aggregationMode === "ACROSS_ELIGIBLE_PRODUCTS" && blocked.length) {
      rejected.push({ offerId: offer.id, offerVersion: offer.offerVersion, code: "OFFER_CONFLICT", message: "Across-product aggregation cannot partially consume a paid-line group." }); continue;
    }
    const applicable = eligible.filter(id => !blocked.includes(id));
    if (!applicable.length) { rejected.push({ offerId: offer.id, offerVersion: offer.offerVersion, code: "OFFER_CONFLICT", message: "Every eligible paid line is already consumed by a higher-ranked Offer." }); continue; }
    applicable.forEach(id => occupiedByLine.set(id, offer));
    resolutions.push({ offer, lineIds: applicable });
  }
  return { resolutions, rejected, conflicts };
}

function tierReward(quantity: number, tiers: readonly TierBonusTier[], aggregationGroup: string): { free: number; breakdown: AppliedTierBreakdown[] } {
  let remaining = quantity, free = 0;
  const breakdown: AppliedTierBreakdown[] = [];
  for (const tier of [...tiers].reverse()) {
    const repetitions = Math.floor(remaining / tier.buyQuantity);
    if (!repetitions) continue;
    const consumedPaidQuantity = repetitions * tier.buyQuantity, generatedFreeQuantity = repetitions * tier.freeQuantity;
    breakdown.push({ aggregationGroup, tierThreshold: tier.buyQuantity, tierReward: tier.freeQuantity, repetitions, consumedPaidQuantity, generatedFreeQuantity });
    remaining -= consumedPaidQuantity; free += generatedFreeQuantity;
  }
  return { free, breakdown };
}

function freeLineKey(offer: CanonicalOfferDefinition, rewardProductId: string, group: string, triggerIds: string[]): string {
  return [offer.id, offer.offerVersion, rewardProductId, group, [...triggerIds].sort().join(",")].join("|");
}

function allocateInvoice(total: bigint, lineBases: Array<{ line: WorkingLine; base: bigint }>, percentage: number): void {
  const percent = rationalFromNumber(percentage)!;
  const denominator = percent.denominator * 100n;
  const allocations = lineBases.map(entry => {
    const numerator = entry.base * percent.numerator;
    return { ...entry, amount: numerator / denominator, remainder: numerator % denominator };
  });
  let distributed = allocations.reduce((sum, entry) => sum + entry.amount, 0n);
  allocations.sort((left, right) => left.remainder === right.remainder ? compareText(left.line.lineId, right.line.lineId) : left.remainder > right.remainder ? -1 : 1);
  for (let index = 0; distributed < total; index = (index + 1) % allocations.length) { allocations[index].amount += 1n; distributed += 1n; }
  allocations.forEach(entry => { entry.line.invoiceDiscountMinor += entry.amount; });
}

export function calculateOffers(input: OfferCalculationInput): OfferCalculationResult {
  const errors = validateInput(input);
  if (errors.length) return { success: false, calculationVersion: OFFER_CALCULATION_VERSION, errors };
  const lines: WorkingLine[] = [...input.paidLines].sort((a, b) => compareText(a.lineId, b.lineId)).map(line => ({ ...line, grossMinor: scaled(line.unitPrice, input.decimalPlaces, input.roundingMode, line.quantity)!, productDiscountMinor: 0n, invoiceDiscountMinor: 0n, appliedOfferIds: [] }));
  if (lines.some(line => line.grossMinor === null)) return { success: false, calculationVersion: OFFER_CALCULATION_VERSION, errors: [issue("OFFER_UNSAFE_MONETARY_VALUE", "paidLines", "A line gross amount exceeds the safe monetary boundary.")] };
  if (lines.reduce((sum, line) => sum + line.grossMinor, 0n) > BigInt(Number.MAX_SAFE_INTEGER)) return { success: false, calculationVersion: OFFER_CALCULATION_VERSION, errors: [issue("OFFER_UNSAFE_MONETARY_VALUE", "paidLines", "Aggregate paid amount exceeds the safe monetary boundary.")] };
  const resolution = resolveOffers(input.selectedOffers, lines);
  const appliedOffers: AppliedOfferCalculation[] = [], freeLines: CalculatedFreeLine[] = [];
  const lineMap = new Map(lines.map(line => [line.lineId, line]));

  for (const { offer, lineIds } of resolution.resolutions.filter(item => item.offer.type === "PRODUCT_PERCENTAGE")) {
    if (offer.benefit.kind !== "PRODUCT_PERCENTAGE") continue;
    let base = 0n, discount = 0n;
    for (const id of lineIds) { const line = lineMap.get(id)!; const amount = percentOfMinor(line.grossMinor, offer.benefit.percentage, input.roundingMode)!; line.productDiscountMinor += amount; line.appliedOfferIds.push(offer.id); base += line.grossMinor; discount += amount; }
    appliedOffers.push({ offerId: offer.id, offerVersion: offer.offerVersion, offerType: offer.type, appliedPaidLineIds: lineIds, grossEligibleBase: money(base, input.decimalPlaces), discountAmount: money(discount, input.decimalPlaces), freeQuantity: 0 });
  }

  for (const { offer, lineIds } of resolution.resolutions.filter(item => item.offer.type === "INVOICE_PERCENTAGE")) {
    if (offer.benefit.kind !== "INVOICE_PERCENTAGE") continue;
    const bases = lineIds.map(id => { const line = lineMap.get(id)!; return { line, base: line.grossMinor - line.productDiscountMinor }; });
    const base = bases.reduce((sum, entry) => sum + entry.base, 0n), discount = percentOfMinor(base, offer.benefit.percentage, input.roundingMode)!;
    allocateInvoice(discount, bases, offer.benefit.percentage); bases.forEach(({ line }) => line.appliedOfferIds.push(offer.id));
    appliedOffers.push({ offerId: offer.id, offerVersion: offer.offerVersion, offerType: offer.type, appliedPaidLineIds: lineIds, grossEligibleBase: money(base, input.decimalPlaces), discountAmount: money(discount, input.decimalPlaces), freeQuantity: 0 });
  }

  for (const { offer, lineIds } of resolution.resolutions.filter(item => item.offer.type === "BUY_X_GET_Y" || item.offer.type === "TIER_BONUS")) {
    if (offer.benefit.kind !== "BUY_X_GET_Y" && offer.benefit.kind !== "TIER_BONUS") continue;
    const triggerLines = lineIds.map(id => lineMap.get(id)!);
    const groups = offer.benefit.aggregationMode === "ACROSS_ELIGIBLE_PRODUCTS"
      ? [["ACROSS_ELIGIBLE_PRODUCTS", triggerLines] as const]
      : [...new Set(triggerLines.map(line => line.productId))].sort().map(productId => [productId, triggerLines.filter(line => line.productId === productId)] as const);
    let totalFree = 0, tierBreakdown: AppliedTierBreakdown[] = [];
    const generated: CalculatedFreeLine[] = [];
    for (const [group, groupLines] of groups) {
      const quantity = groupLines.reduce((sum, line) => sum + line.quantity, 0);
      const reward = offer.type === "BUY_X_GET_Y"
        ? { free: Math.floor(quantity / offer.benefit.buyQuantity) * offer.benefit.freeQuantity, breakdown: [] as AppliedTierBreakdown[] }
        : tierReward(quantity, offer.benefit.tiers, group);
      if (!Number.isSafeInteger(reward.free) || !Number.isSafeInteger(totalFree + reward.free)) return { success: false, calculationVersion: OFFER_CALCULATION_VERSION, errors: [issue("OFFER_INVALID_QUANTITY", `selectedOffers.${offer.id}`, "Calculated free quantity exceeds the safe integer boundary.")] };
      if (!reward.free) continue;
      const rewardProductId = offer.benefit.reward.mode === "SELECTED_PRODUCT" ? offer.benefit.reward.rewardProductId : group;
      const triggerPaidLineIds = groupLines.map(line => line.lineId).sort();
      generated.push({ deterministicLineKey: freeLineKey(offer, rewardProductId, group, triggerPaidLineIds), rewardProductId, quantity: reward.free, sourceOfferId: offer.id, sourceOfferVersion: offer.offerVersion, triggerPaidLineIds, lineKind: "PROMOTIONAL_FREE_LINE" });
      totalFree += reward.free; tierBreakdown.push(...reward.breakdown);
    }
    // Selected rewards from per-product groups combine deterministically while preserving every trigger line.
    const combined = new Map<string, CalculatedFreeLine>();
    for (const generatedLine of generated) {
      const key = `${generatedLine.sourceOfferId}|${generatedLine.sourceOfferVersion}|${generatedLine.rewardProductId}`;
      const prior = combined.get(key);
      if (!prior) combined.set(key, generatedLine);
      else { prior.quantity += generatedLine.quantity; prior.triggerPaidLineIds = [...new Set([...prior.triggerPaidLineIds, ...generatedLine.triggerPaidLineIds])].sort(); prior.deterministicLineKey = freeLineKey(offer, prior.rewardProductId, "COMBINED_SELECTED_REWARD", prior.triggerPaidLineIds); }
    }
    if (totalFree === 0) {
      resolution.rejected.push({ offerId: offer.id, offerVersion: offer.offerVersion, code: "OFFER_NOT_APPLICABLE", message: "Qualifying quantity is below the reward threshold." });
      continue;
    }
    freeLines.push(...combined.values()); triggerLines.forEach(line => line.appliedOfferIds.push(offer.id));
    const gross = triggerLines.reduce((sum, line) => sum + line.grossMinor, 0n);
    appliedOffers.push({ offerId: offer.id, offerVersion: offer.offerVersion, offerType: offer.type, appliedPaidLineIds: lineIds, ...(tierBreakdown.length ? { appliedTierBreakdown: tierBreakdown } : {}), grossEligibleBase: money(gross, input.decimalPlaces), discountAmount: 0, freeQuantity: totalFree });
  }

  const gross = lines.reduce((sum, line) => sum + line.grossMinor, 0n), productDiscount = lines.reduce((sum, line) => sum + line.productDiscountMinor, 0n), invoiceDiscount = lines.reduce((sum, line) => sum + line.invoiceDiscountMinor, 0n);
  if (productDiscount + invoiceDiscount > gross) return { success: false, calculationVersion: OFFER_CALCULATION_VERSION, errors: [issue("OFFER_DISCOUNT_EXCEEDS_BASE", "totals", "Offer discount exceeds the paid eligible base.")] };
  const paidLines = lines.map(line => { const total = line.productDiscountMinor + line.invoiceDiscountMinor; return { lineId: line.lineId, productId: line.productId, quantity: line.quantity, unitPrice: line.unitPrice === 0 ? 0 : line.unitPrice, grossAmount: money(line.grossMinor, input.decimalPlaces), productDiscountAmount: money(line.productDiscountMinor, input.decimalPlaces), invoiceDiscountAmount: money(line.invoiceDiscountMinor, input.decimalPlaces), totalDiscountAmount: money(total, input.decimalPlaces), netAmount: money(line.grossMinor - total, input.decimalPlaces), appliedOfferIds: [...line.appliedOfferIds].sort() }; });
  return {
    success: true, calculationVersion: OFFER_CALCULATION_VERSION, currencyCode: input.currencyCode.trim(), decimalPlaces: input.decimalPlaces, roundingMode: input.roundingMode,
    paidLines, freeLines: freeLines.sort((a, b) => compareText(a.deterministicLineKey, b.deterministicLineKey)), appliedOffers: appliedOffers.sort((a, b) => compareText(a.offerId, b.offerId)),
    rejectedOffers: resolution.rejected.sort((a, b) => compareText(a.offerId, b.offerId)), conflicts: resolution.conflicts.sort((a, b) => compareText(a.offerId, b.offerId)),
    grossPaidSubtotal: money(gross, input.decimalPlaces), productDiscountTotal: money(productDiscount, input.decimalPlaces), subtotalAfterProductDiscounts: money(gross - productDiscount, input.decimalPlaces),
    invoiceDiscountTotal: money(invoiceDiscount, input.decimalPlaces), totalDiscount: money(productDiscount + invoiceDiscount, input.decimalPlaces), netSubtotal: money(gross - productDiscount - invoiceDiscount, input.decimalPlaces),
  };
}

/** Thin adapters intentionally share the exact algorithm for byte-for-byte parity. */
export const calculateOffersForBrowser = (input: OfferCalculationInput): OfferCalculationResult => calculateOffers(input);
export const calculateOffersForServer = (input: OfferCalculationInput): OfferCalculationResult => calculateOffers(input);
