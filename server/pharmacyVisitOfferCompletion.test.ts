import { describe, expect, it } from "vitest";
import type { CanonicalOfferDefinition } from "../src/features/offers/types";
import { OFFER_CALCULATION_VERSION } from "../src/features/offers/offerCalculation";
import { offerInputFingerprint } from "../src/features/pharmacyVisit/services/canonicalOfferVisit";
import { calculateAuthoritativeVisitOffers, parseCompletionOfferIntent, PharmacyVisitOfferCompletionError, type AuthoritativeOfferContext } from "./pharmacyVisitOfferCompletion";

const now = new Date("2026-06-01T12:00:00.000Z");
const percentage = (overrides: Record<string, unknown> = {}): CanonicalOfferDefinition => ({ id: "PCT", schemaVersion: 1, offerVersion: 1, revision: 1, code: "PCT", name: "Ten", type: "PRODUCT_PERCENTAGE", lifecycleStatus: "ACTIVE", productScope: { mode: "ALL_PRODUCTS", productIds: [] }, benefit: { kind: "PRODUCT_PERCENTAGE", percentage: 10, base: "ELIGIBLE_PAID_PRODUCT_LINES" }, eligibility: { audienceType: "ALL_SALES_REPRESENTATIVES", startAt: "2026-01-01T00:00:00.000Z", endAt: "2026-12-31T23:59:59.000Z" }, stackingPolicy: { mode: "NO_STACKING", priority: 1, maximumProductOrQuantityOffersPerPaidLine: 1, maximumInvoicePercentageOffersPerInvoice: 1 }, createdAt: "2026-01-01T00:00:00.000Z", createdBy: "A", updatedAt: "2026-01-01T00:00:00.000Z", updatedBy: "A", ...overrides } as CanonicalOfferDefinition);
const buy = (id = "BUY", productId = "P1", rewardProductId?: string): CanonicalOfferDefinition => ({ ...percentage(), id, code: id, type: "BUY_X_GET_Y", productScope: { mode: "SELECTED_PRODUCTS", productIds: [productId] }, benefit: { kind: "BUY_X_GET_Y", buyQuantity: 5, freeQuantity: 1, reward: rewardProductId ? { mode: "SELECTED_PRODUCT", rewardProductId } : { mode: "SAME_AS_TRIGGER" }, aggregationMode: "PER_PRODUCT", multiples: "REPEAT_COMPLETE_MULTIPLES", remainder: "NO_REWARD_BELOW_THRESHOLD" } } as CanonicalOfferDefinition);
const tier = (): CanonicalOfferDefinition => ({ ...percentage(), id: "TIER", code: "TIER", type: "TIER_BONUS", productScope: { mode: "SELECTED_PRODUCTS", productIds: ["P1"] }, benefit: { kind: "TIER_BONUS", tiers: [{ buyQuantity: 5, freeQuantity: 1 }, { buyQuantity: 10, freeQuantity: 3 }], reward: { mode: "SELECTED_PRODUCT", rewardProductId: "R" }, aggregationMode: "PER_PRODUCT", applicationMode: "REPEATING_GREEDY_WITH_REMAINDER" } } as CanonicalOfferDefinition);
const product = (stockQuantity: number) => ({ active: true, productType: "Commercial", stockQuantity, price: 1, name: "Product" });
const base = (offers: CanonicalOfferDefinition[], lines = [{ lineId: "L1", productId: "P1", quantity: 10, unitPrice: 1 }], stocks: Record<string, number> = { P1: 20, R: 20 }): AuthoritativeOfferContext => {
  const calculation = { currencyCode: "LYD", decimalPlaces: 3, roundingMode: "DECIMAL_HALF_UP" as const, paidLines: lines, selectedOffers: offers };
  const fingerprint = offerInputFingerprint(calculation);
  return { intents: offers.map(offer => ({ offerId: offer.id, offerVersion: offer.offerVersion, calculationVersion: OFFER_CALCULATION_VERSION, selected: true, confirmed: true, confirmedAt: now.toISOString(), inputFingerprint: fingerprint })), offerDocuments: new Map(offers.map(offer => [offer.id, offer as any])), products: new Map(Object.entries(stocks).map(([id, stock]) => [id, product(stock)])), paidLines: lines, currencyCode: "LYD", decimalPlaces: 3, roundingMode: "DECIMAL_HALF_UP", now, pharmacy: { id: "PH", companyId: "CO", marketId: "M", countryId: "C", districtId: "D", cityId: "CT", areaId: "A", type: "Retail" }, authorizedProductIds: new Set(Object.keys(stocks)) };
};
const code = (fn: () => unknown) => { try { fn(); return ""; } catch (error) { return (error as PharmacyVisitOfferCompletionError).code; } };

describe("server-authoritative Pharmacy Visit Offer completion", () => {
  it("keeps no-Offer completion valid", () => expect(calculateAuthoritativeVisitOffers(base([]))).toBeNull());
  it("ignores browser totals because intent accepts only its bounded fields", () => expect(() => parseCompletionOfferIntent([{ offerId: "O", offerVersion: 1, calculationVersion: OFFER_CALCULATION_VERSION, selected: true, confirmed: true, confirmedAt: now.toISOString(), inputFingerprint: "B", calculatedDiscount: 999 }])).toThrow("PHARMACY_VISIT_OFFER_CONFIRMATION_REQUIRED"));
  it("calculates discount-only Offers without reward stock", () => { const result = calculateAuthoritativeVisitOffers(base([percentage()], undefined, { P1: 20 }))!; expect(result.totalDiscount).toBe(1); expect(result.netSubtotal).toBe(9); expect(result.freeLines).toEqual([]); });
  it("persists complete zero-price Buy X Get Y rewards without changing revenue", () => { const result = calculateAuthoritativeVisitOffers(base([buy()]))!; expect(result.freeLines[0]).toMatchObject({ lineKind: "PROMOTIONAL_FREE_LINE", productId: "P1", quantity: 2, unitPrice: 0, grossAmount: 0, netAmount: 0, sourceOfferId: "BUY" }); expect(result.netSubtotal).toBe(10); });
  it("supports Tier Bonus with sufficient complete reward stock", () => { const result = calculateAuthoritativeVisitOffers(base([tier()]))!; expect(result.freeLines[0].quantity).toBe(3); expect(result.appliedOffers[0].appliedTierBreakdown).toBeTruthy(); });
  it.each([0, 11])("rejects zero/insufficient same-trigger stock %s with no partial output", stock => expect(code(() => calculateAuthoritativeVisitOffers(base([buy()], undefined, { P1: stock })))).toBe("PHARMACY_VISIT_OFFER_REWARD_STOCK_INSUFFICIENT"));
  it("aggregates multiple disjoint rewards sharing one product", () => { const offers = [buy("A", "P1", "R"), buy("B", "P2", "R")]; const lines = [{ lineId: "L1", productId: "P1", quantity: 5, unitPrice: 1 }, { lineId: "L2", productId: "P2", quantity: 5, unitPrice: 1 }]; expect(code(() => calculateAuthoritativeVisitOffers(base(offers, lines, { P1: 5, P2: 5, R: 1 })))).toBe("PHARMACY_VISIT_OFFER_REWARD_STOCK_INSUFFICIENT"); expect(calculateAuthoritativeVisitOffers(base(offers, lines, { P1: 5, P2: 5, R: 2 }))?.freeLines.reduce((sum, line) => sum + line.quantity, 0)).toBe(2); });
  it("fails the complete same-trigger offer when any reward product is insufficient", () => { const offer = { ...buy(), productScope: { mode: "ALL_PRODUCTS", productIds: [] } } as CanonicalOfferDefinition; const lines = [{ lineId: "L1", productId: "P1", quantity: 5, unitPrice: 1 }, { lineId: "L2", productId: "P2", quantity: 5, unitPrice: 1 }]; expect(code(() => calculateAuthoritativeVisitOffers(base([offer], lines, { P1: 6, P2: 5 })))).toBe("PHARMACY_VISIT_OFFER_REWARD_STOCK_INSUFFICIENT"); });
  it("rejects missing, stale-version, stale-fingerprint and non-active Offers", () => { const offer = percentage(); const missing = base([offer]); missing.offerDocuments.clear(); expect(code(() => calculateAuthoritativeVisitOffers(missing))).toBe("PHARMACY_VISIT_OFFER_NOT_FOUND"); const version = base([offer]); version.intents[0].offerVersion = 2; expect(code(() => calculateAuthoritativeVisitOffers(version))).toBe("PHARMACY_VISIT_OFFER_VERSION_STALE"); const stale = base([offer]); stale.intents[0].inputFingerprint = "forged"; expect(code(() => calculateAuthoritativeVisitOffers(stale))).toBe("PHARMACY_VISIT_OFFER_CONFIRMATION_STALE"); const paused = percentage({ lifecycleStatus: "PAUSED" }); expect(code(() => calculateAuthoritativeVisitOffers(base([paused])))).toBe("PHARMACY_VISIT_OFFER_NOT_APPLICABLE"); });
  it("uses injected server time and rejects future/expired definitions", () => { const offer = percentage(); const future = base([offer]); future.now = new Date("2025-01-01"); const expired = base([offer]); expired.now = new Date("2027-01-01"); expect(code(() => calculateAuthoritativeVisitOffers(future))).toBe("PHARMACY_VISIT_OFFER_NOT_APPLICABLE"); expect(code(() => calculateAuthoritativeVisitOffers(expired))).toBe("PHARMACY_VISIT_OFFER_NOT_APPLICABLE"); });
});

describe("Step 6 canonical compatibility and commercial context", () => {
  const invoice = () => percentage({ id: "INV", type: "INVOICE_PERCENTAGE", benefit: { kind: "INVOICE_PERCENTAGE", percentage: 10, base: "PAID_ELIGIBLE_SUBTOTAL_AFTER_PRODUCT_DISCOUNTS_BEFORE_TAX", excludesFreeLines: true, excludesProductsOutsideScope: true } });
  const compatible = (offer: CanonicalOfferDefinition): CanonicalOfferDefinition => ({ ...offer, stackingPolicy: { ...offer.stackingPolicy, mode: "EXPLICIT_COMPATIBILITY", compatibleCombination: "PRODUCT_PERCENTAGE_WITH_INVOICE_PERCENTAGE" } } as CanonicalOfferDefinition);
  it("supports mutually compatible product and invoice Offers with provenance", () => {
    const offers = [compatible(percentage()), compatible(invoice())];
    const result = calculateAuthoritativeVisitOffers(base(offers))!;
    expect(result.appliedOffers).toHaveLength(2); expect(result.netSubtotal).toBe(8.1);
    expect(result.selectedOfferIds).toEqual(["INV", "PCT"]); expect(result.currencyCode).toBe("LYD"); expect(result.decimalPlaces).toBe(3);
  });
  it("preserves deterministic ranking while rejecting conflicting selections at completion", async () => {
    const a = percentage({ id: "A" }), b = percentage({ id: "B" });
    const { calculateOffersForServer } = await import("../src/features/offers/offerCalculation");
    const context = base([a, b]);
    const calculate = (selectedOffers: CanonicalOfferDefinition[]) => calculateOffersForServer({ currencyCode: context.currencyCode, decimalPlaces: context.decimalPlaces, roundingMode: "DECIMAL_HALF_UP", paidLines: context.paidLines, selectedOffers });
    expect(calculate([a, b])).toEqual(calculate([b, a]));
    expect(calculate([a, b]).appliedOffers[0].offerId).toBe("A");
    const higher = { ...b, stackingPolicy: { ...b.stackingPolicy, priority: 2 } };
    expect(calculate([a, higher]).appliedOffers[0].offerId).toBe("B");
    expect(() => calculateAuthoritativeVisitOffers(context)).toThrow("PHARMACY_VISIT_OFFER_CONFLICT");
  });
  it("preserves the one-invoice restriction", () => {
    expect(() => calculateAuthoritativeVisitOffers(base([invoice(), { ...invoice(), id: "INV2" }]))).toThrow("PHARMACY_VISIT_OFFER_CONFLICT");
  });
  it("does not gate canonical Offers by transaction company/market/country/pharmacy context", () => {
    const context = base([percentage()]);
    context.pharmacy = { id: "DIFFERENT_PHARMACY", companyId: "DIFFERENT_COMPANY", marketId: "DIFFERENT_MARKET", countryId: "DIFFERENT_COUNTRY", districtId: "D2", cityId: "CT2", areaId: "A2", type: "OTHER" };
    expect(calculateAuthoritativeVisitOffers(context)?.netSubtotal).toBe(9);
  });
  it("does not revive legacy eligibility fields", () => {
    for (const field of ["companyId", "marketId", "countryId", "pharmacyIds", "pharmacyTypes", "geographyPaths"]) {
      const o = percentage(); (o.eligibility as any)[field] = "legacy";
      expect(() => calculateAuthoritativeVisitOffers(base([o]))).toThrow("PHARMACY_VISIT_OFFER_NOT_APPLICABLE");
    }
  });
});
