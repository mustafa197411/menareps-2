import { describe, expect, it } from "vitest";
import type { CanonicalOfferDefinition, CanonicalOfferType, OfferCompatibility } from "./types";
import {
  OFFER_CALCULATION_VERSION, calculateOffers, calculateOffersForBrowser, calculateOffersForServer,
  offersAreMutuallyCompatible, type OfferCalculationInput, type OfferCalculationResult,
} from "./offerCalculation";

const line = (lineId: string, productId: string, unitPrice = 10, quantity = 1) => ({ lineId, productId, unitPrice, quantity });
const compatibilityFor = (type: CanonicalOfferType): OfferCompatibility => type === "PRODUCT_PERCENTAGE" ? "PRODUCT_PERCENTAGE_WITH_INVOICE_PERCENTAGE" : type === "BUY_X_GET_Y" ? "BUY_X_GET_Y_WITH_INVOICE_PERCENTAGE" : "TIER_BONUS_WITH_INVOICE_PERCENTAGE";
const offer = (type: CanonicalOfferType, overrides: Record<string, unknown> = {}): CanonicalOfferDefinition => {
  const benefits = {
    PRODUCT_PERCENTAGE: { kind: "PRODUCT_PERCENTAGE", percentage: 10, base: "ELIGIBLE_PAID_PRODUCT_LINES" },
    INVOICE_PERCENTAGE: { kind: "INVOICE_PERCENTAGE", percentage: 10, base: "PAID_ELIGIBLE_SUBTOTAL_AFTER_PRODUCT_DISCOUNTS_BEFORE_TAX", excludesFreeLines: true, excludesProductsOutsideScope: true },
    BUY_X_GET_Y: { kind: "BUY_X_GET_Y", buyQuantity: 5, freeQuantity: 1, reward: { mode: "SAME_AS_TRIGGER" }, aggregationMode: "PER_PRODUCT", multiples: "REPEAT_COMPLETE_MULTIPLES", remainder: "NO_REWARD_BELOW_THRESHOLD" },
    TIER_BONUS: { kind: "TIER_BONUS", tiers: [{ buyQuantity: 5, freeQuantity: 1 }, { buyQuantity: 10, freeQuantity: 3 }, { buyQuantity: 25, freeQuantity: 10 }], reward: { mode: "SAME_AS_TRIGGER" }, aggregationMode: "PER_PRODUCT", applicationMode: "REPEATING_GREEDY_WITH_REMAINDER" },
  } as const;
  return {
    id: `${type}-1`, schemaVersion: 1, offerVersion: 1, code: `${type}-CODE`, name: type, type, lifecycleStatus: "ACTIVE",
    productScope: { mode: "ALL_PRODUCTS", productIds: [] }, benefit: benefits[type] as any,
    eligibility: { audienceType: "ALL_SALES_REPRESENTATIVES", startAt: "2026-01-01T00:00:00.000Z", endAt: "2030-01-01T00:00:00.000Z" },
    stackingPolicy: { mode: "NO_STACKING", priority: 1, maximumProductOrQuantityOffersPerPaidLine: 1, maximumInvoicePercentageOffersPerInvoice: 1 },
    createdAt: "2026-01-01T00:00:00.000Z", createdBy: "CREATOR", updatedAt: "2026-01-01T00:00:00.000Z", updatedBy: "CREATOR", revision: 1,
    ...overrides,
  } as CanonicalOfferDefinition;
};
const explicit = (type: CanonicalOfferType, priority = 1, overrides: Record<string, unknown> = {}) => offer(type, { stackingPolicy: { mode: "EXPLICIT_COMPATIBILITY", priority, compatibleCombination: compatibilityFor(type === "INVOICE_PERCENTAGE" ? "PRODUCT_PERCENTAGE" : type), maximumProductOrQuantityOffersPerPaidLine: 1, maximumInvoicePercentageOffersPerInvoice: 1 }, ...overrides });
const input = (paidLines = [line("L1", "P1")], selectedOffers: CanonicalOfferDefinition[] = [], overrides: Partial<OfferCalculationInput> = {}): OfferCalculationInput => ({ currencyCode: "TST", decimalPlaces: 2, roundingMode: "DECIMAL_HALF_UP", paidLines, selectedOffers, ...overrides });
const success = (result: OfferCalculationResult) => { expect(result.success).toBe(true); return result as Extract<OfferCalculationResult, { success: true }>; };
const codes = (result: OfferCalculationResult) => result.success ? [] : result.errors.map(error => error.code);

describe("Offer calculation input safety", () => {
  it.each([
    [input([], []), "OFFER_CALCULATION_INPUT_INVALID"],
    [input([line("L1", "P1"), line("L1", "P2")]), "OFFER_CALCULATION_INPUT_INVALID"],
    [input([line("L1", "", 1, 1)]), "OFFER_CALCULATION_INPUT_INVALID"],
    [input([line("L1", "P1", 1, 0)]), "OFFER_INVALID_QUANTITY"],
    [input([line("L1", "P1", 1, -1)]), "OFFER_INVALID_QUANTITY"],
    [input([line("L1", "P1", 1, 1.5)]), "OFFER_INVALID_QUANTITY"],
    [input([line("L1", "P1", 1, Number.MAX_SAFE_INTEGER + 1)]), "OFFER_INVALID_QUANTITY"],
    [input([line("L1", "P1", -1, 1)]), "OFFER_UNSAFE_MONETARY_VALUE"],
    [input([line("L1", "P1", Number.NaN, 1)]), "OFFER_UNSAFE_MONETARY_VALUE"],
    [input([line("L1", "P1", Number.POSITIVE_INFINITY, 1)]), "OFFER_UNSAFE_MONETARY_VALUE"],
    [input(undefined as never, [], { currencyCode: "" }), "OFFER_INVALID_CURRENCY"],
    [input(undefined as never, [], { decimalPlaces: 7 }), "OFFER_INVALID_DECIMAL_PLACES"],
  ])("returns controlled input error %#", (value, code) => expect(codes(calculateOffers(value as OfferCalculationInput))).toContain(code));

  it("rejects duplicate selections, unsupported schema/type and malformed benefits", () => {
    const canonical = offer("PRODUCT_PERCENTAGE");
    expect(codes(calculateOffers(input(undefined as never, [canonical, canonical])))).toContain("OFFER_DUPLICATE_SELECTION");
    expect(codes(calculateOffers(input(undefined as never, [{ ...canonical, schemaVersion: 99 }])))).toContain("OFFER_UNSUPPORTED_SCHEMA");
    expect(codes(calculateOffers(input(undefined as never, [{ ...canonical, type: "FIXED" } as any])))).toContain("OFFER_UNSUPPORTED_TYPE");
    expect(codes(calculateOffers(input(undefined as never, [{ ...canonical, benefit: { kind: "PRODUCT_PERCENTAGE", percentage: 0 } } as any])))).toContain("OFFER_INVALID_PERCENTAGE");
  });
});

describe("Product Percentage", () => {
  it("applies All Products to one and several paid lines", () => {
    const result = success(calculateOffers(input([line("B", "P2", 20, 2), line("A", "P1", 10, 1)], [offer("PRODUCT_PERCENTAGE")])));
    expect(result.paidLines.map(row => [row.lineId, row.productDiscountAmount])).toEqual([["A", 1], ["B", 4]]);
    expect(result.productDiscountTotal).toBe(5);
  });
  it("applies Selected Products and excludes out-of-scope lines", () => {
    const selected = offer("PRODUCT_PERCENTAGE", { productScope: { mode: "SELECTED_PRODUCTS", productIds: ["P2"] } });
    const result = success(calculateOffers(input([line("A", "P1"), line("B", "P2")], [selected])));
    expect(result.paidLines.map(row => row.productDiscountAmount)).toEqual([0, 1]);
    const missing = success(calculateOffers(input([line("A", "P1")], [selected])));
    expect(missing.rejectedOffers[0].code).toBe("OFFER_PRODUCT_SCOPE_EMPTY");
  });
  it.each([[1, 0.1], [12.5, 1.25], [100, 10]])("calculates %s percent", (percentage, expected) => {
    const value = offer("PRODUCT_PERCENTAGE", { benefit: { kind: "PRODUCT_PERCENTAGE", percentage, base: "ELIGIBLE_PAID_PRODUCT_LINES" } });
    expect(success(calculateOffers(input(undefined as never, [value]))).productDiscountTotal).toBe(expected);
  });
  it("rejects zero and above 100", () => {
    for (const percentage of [0, 100.01]) expect(codes(calculateOffers(input(undefined as never, [offer("PRODUCT_PERCENTAGE", { benefit: { kind: "PRODUCT_PERCENTAGE", percentage, base: "ELIGIBLE_PAID_PRODUCT_LINES" } })])))).toContain("OFFER_INVALID_PERCENTAGE");
  });
});

describe("Invoice Percentage", () => {
  it("uses the eligible subtotal after mutually compatible product discounts", () => {
    const combination = "PRODUCT_PERCENTAGE_WITH_INVOICE_PERCENTAGE";
    const policy = { mode: "EXPLICIT_COMPATIBILITY", priority: 1, compatibleCombination: combination, maximumProductOrQuantityOffersPerPaidLine: 1, maximumInvoicePercentageOffersPerInvoice: 1 } as const;
    const result = success(calculateOffers(input([line("A", "P1", 100, 1)], [offer("PRODUCT_PERCENTAGE", { stackingPolicy: policy }), offer("INVOICE_PERCENTAGE", { stackingPolicy: policy })])));
    expect(result).toMatchObject({ grossPaidSubtotal: 100, productDiscountTotal: 10, subtotalAfterProductDiscounts: 90, invoiceDiscountTotal: 9, totalDiscount: 19, netSubtotal: 81 });
  });
  it("excludes products outside invoice scope", () => {
    const invoice = offer("INVOICE_PERCENTAGE", { productScope: { mode: "SELECTED_PRODUCTS", productIds: ["P1"] } });
    const result = success(calculateOffers(input([line("A", "P1", 10), line("B", "P2", 10)], [invoice])));
    expect(result.invoiceDiscountTotal).toBe(1); expect(result.paidLines.find(row => row.lineId === "B")?.invoiceDiscountAmount).toBe(0);
  });
  it("allocates the rounded total exactly using remainder then stable line ID", () => {
    const result = success(calculateOffers(input([line("C", "P3", .05), line("A", "P1", .05), line("B", "P2", .05)], [offer("INVOICE_PERCENTAGE")])));
    expect(result.invoiceDiscountTotal).toBe(.02);
    expect(result.paidLines.map(row => [row.lineId, row.invoiceDiscountAmount])).toEqual([["A", .01], ["B", .01], ["C", 0]]);
    expect(result.paidLines.reduce((sum, row) => sum + row.invoiceDiscountAmount, 0)).toBe(result.invoiceDiscountTotal);
  });
});

describe("Buy X Get Y", () => {
  it.each([[4, 0], [5, 1], [10, 2], [14, 2]])("applies threshold/multiple/remainder for quantity %s", (quantity, expected) => {
    const result = success(calculateOffers(input([line("L1", "P1", 10, quantity)], [offer("BUY_X_GET_Y")])));
    expect(result.freeLines.reduce((sum, row) => sum + row.quantity, 0)).toBe(expected);
  });
  it("aggregates per product across multiple trigger lines with same-trigger rewards", () => {
    const result = success(calculateOffers(input([line("A", "P1", 1, 3), line("B", "P1", 1, 2), line("C", "P2", 1, 5)], [offer("BUY_X_GET_Y")])));
    expect(result.freeLines.map(row => [row.rewardProductId, row.quantity, row.triggerPaidLineIds])).toEqual([["P1", 1, ["A", "B"]], ["P2", 1, ["C"]]]);
  });
  it("supports explicit across-product aggregation only with a selected reward", () => {
    const across = offer("BUY_X_GET_Y", { benefit: { kind: "BUY_X_GET_Y", buyQuantity: 5, freeQuantity: 2, reward: { mode: "SELECTED_PRODUCT", rewardProductId: "REWARD" }, aggregationMode: "ACROSS_ELIGIBLE_PRODUCTS", multiples: "REPEAT_COMPLETE_MULTIPLES", remainder: "NO_REWARD_BELOW_THRESHOLD" } });
    const result = success(calculateOffers(input([line("A", "P1", 1, 2), line("B", "P2", 1, 3)], [across])));
    expect(result.freeLines[0]).toMatchObject({ rewardProductId: "REWARD", quantity: 2, triggerPaidLineIds: ["A", "B"] });
    expect(result.freeLines[0].deterministicLineKey).toBe("BUY_X_GET_Y-1|1|REWARD|ACROSS_ELIGIBLE_PRODUCTS|A,B");
  });
  it("combines identical selected rewards deterministically and preserves triggers", () => {
    const selected = offer("BUY_X_GET_Y", { benefit: { kind: "BUY_X_GET_Y", buyQuantity: 5, freeQuantity: 1, reward: { mode: "SELECTED_PRODUCT", rewardProductId: "R" }, aggregationMode: "PER_PRODUCT", multiples: "REPEAT_COMPLETE_MULTIPLES", remainder: "NO_REWARD_BELOW_THRESHOLD" } });
    const result = success(calculateOffers(input([line("B", "P2", 1, 5), line("A", "P1", 1, 5)], [selected])));
    expect(result.freeLines).toEqual([{ deterministicLineKey: "BUY_X_GET_Y-1|1|R|COMBINED_SELECTED_REWARD|A,B", rewardProductId: "R", quantity: 2, sourceOfferId: "BUY_X_GET_Y-1", sourceOfferVersion: 1, triggerPaidLineIds: ["A", "B"], lineKind: "PROMOTIONAL_FREE_LINE" }]);
  });
});

describe("Tier Bonus", () => {
  it.each([[4, 0], [5, 1], [10, 3], [20, 6], [25, 10], [30, 11], [50, 20]])("matches golden quantity %s => %s", (quantity, expected) => {
    const result = success(calculateOffers(input([line("L", "P", 1, quantity)], [offer("TIER_BONUS")])));
    expect(result.freeLines.reduce((sum, row) => sum + row.quantity, 0)).toBe(expected);
  });
  it("reports repeated highest tier and lower-tier remainder breakdown", () => {
    const result = success(calculateOffers(input([line("L", "P", 1, 30)], [offer("TIER_BONUS")])));
    expect(result.appliedOffers[0].appliedTierBreakdown).toEqual([
      { aggregationGroup: "P", tierThreshold: 25, tierReward: 10, repetitions: 1, consumedPaidQuantity: 25, generatedFreeQuantity: 10 },
      { aggregationGroup: "P", tierThreshold: 5, tierReward: 1, repetitions: 1, consumedPaidQuantity: 5, generatedFreeQuantity: 1 },
    ]);
  });
  it.each([1, 2, 3, 4, 5])("accepts %s tiers", count => {
    const tiers = Array.from({ length: count }, (_, index) => ({ buyQuantity: index + 1, freeQuantity: 1 }));
    const tierOffer = offer("TIER_BONUS", { benefit: { kind: "TIER_BONUS", tiers, reward: { mode: "SAME_AS_TRIGGER" }, aggregationMode: "PER_PRODUCT", applicationMode: "REPEATING_GREEDY_WITH_REMAINDER" } });
    expect(calculateOffers(input([line("L", "P", 1, 10)], [tierOffer])).success).toBe(true);
  });
  it("supports across-products selected reward and rejects malformed tiers", () => {
    const across = offer("TIER_BONUS", { benefit: { kind: "TIER_BONUS", tiers: [{ buyQuantity: 5, freeQuantity: 2 }], reward: { mode: "SELECTED_PRODUCT", rewardProductId: "R" }, aggregationMode: "ACROSS_ELIGIBLE_PRODUCTS", applicationMode: "REPEATING_GREEDY_WITH_REMAINDER" } });
    expect(success(calculateOffers(input([line("A", "P1", 1, 2), line("B", "P2", 1, 3)], [across]))).freeLines[0].quantity).toBe(2);
    const malformed = offer("TIER_BONUS", { benefit: { kind: "TIER_BONUS", tiers: [], reward: { mode: "SAME_AS_TRIGGER" }, aggregationMode: "PER_PRODUCT", applicationMode: "REPEATING_GREEDY_WITH_REMAINDER" } });
    expect(codes(calculateOffers(input(undefined as never, [malformed])))).toContain("OFFER_INVALID_TIER");
  });
});

describe("Stacking and deterministic resolution", () => {
  it("requires mutual identical compatibility declarations", () => {
    const product = explicit("PRODUCT_PERCENTAGE"), invoice = explicit("INVOICE_PERCENTAGE");
    expect(offersAreMutuallyCompatible(product, invoice)).toBe(true);
    expect(offersAreMutuallyCompatible(product, offer("INVOICE_PERCENTAGE"))).toBe(false);
  });
  it.each(["PRODUCT_PERCENTAGE", "BUY_X_GET_Y", "TIER_BONUS"] as const)("permits explicit mutual %s plus Invoice Percentage", type => {
    const combination = compatibilityFor(type), policy = { mode: "EXPLICIT_COMPATIBILITY", priority: 1, compatibleCombination: combination, maximumProductOrQuantityOffersPerPaidLine: 1, maximumInvoicePercentageOffersPerInvoice: 1 } as const;
    const nonInvoice = offer(type, { stackingPolicy: policy }), invoice = offer("INVOICE_PERCENTAGE", { stackingPolicy: policy });
    expect(success(calculateOffers(input([line("L", "P", 10, 5)], [nonInvoice, invoice]))).appliedOffers.map(row => row.offerId).sort()).toEqual([nonInvoice.id, invoice.id].sort());
  });
  it("reports incompatible product and quantity reuse rather than silently stacking", () => {
    const first = offer("BUY_X_GET_Y", { id: "A", stackingPolicy: { mode: "NO_STACKING", priority: 2, maximumProductOrQuantityOffersPerPaidLine: 1, maximumInvoicePercentageOffersPerInvoice: 1 } });
    const second = offer("TIER_BONUS", { id: "B", stackingPolicy: { mode: "NO_STACKING", priority: 1, maximumProductOrQuantityOffersPerPaidLine: 1, maximumInvoicePercentageOffersPerInvoice: 1 } });
    const result = success(calculateOffers(input([line("L", "P", 10, 5)], [second, first])));
    expect(result.appliedOffers.map(row => row.offerId)).toEqual(["A"]); expect(result.rejectedOffers[0].code).toBe("OFFER_CONFLICT"); expect(result.conflicts[0].paidLineIds).toEqual(["L"]);
  });
  it("uses explicit compatibility, priority, then stable Offer ID independent of input order", () => {
    const a = offer("PRODUCT_PERCENTAGE", { id: "A", stackingPolicy: { mode: "NO_STACKING", priority: 5, maximumProductOrQuantityOffersPerPaidLine: 1, maximumInvoicePercentageOffersPerInvoice: 1 } });
    const b = offer("PRODUCT_PERCENTAGE", { id: "B", stackingPolicy: { mode: "NO_STACKING", priority: 5, maximumProductOrQuantityOffersPerPaidLine: 1, maximumInvoicePercentageOffersPerInvoice: 1 } });
    const left = calculateOffers(input(undefined as never, [b, a])), right = calculateOffers(input(undefined as never, [a, b]));
    expect(JSON.stringify(left)).toBe(JSON.stringify(right)); expect(success(left).appliedOffers[0].offerId).toBe("A");
  });
  it("uses higher priority before the stable ID tie-break", () => {
    const low = offer("PRODUCT_PERCENTAGE", { id: "A", stackingPolicy: { mode: "NO_STACKING", priority: 1, maximumProductOrQuantityOffersPerPaidLine: 1, maximumInvoicePercentageOffersPerInvoice: 1 } });
    const high = offer("PRODUCT_PERCENTAGE", { id: "Z", stackingPolicy: { mode: "NO_STACKING", priority: 2, maximumProductOrQuantityOffersPerPaidLine: 1, maximumInvoicePercentageOffersPerInvoice: 1 } });
    expect(success(calculateOffers(input(undefined as never, [low, high]))).appliedOffers[0].offerId).toBe("Z");
  });
});

describe("Scheduled Offer calculation safety", () => {
  it("never treats Scheduled as operationally active", () => {
    const result = success(calculateOffers(input(undefined as never, [offer("PRODUCT_PERCENTAGE", { lifecycleStatus: "SCHEDULED" })])));
    expect(result.appliedOffers).toEqual([]);
    expect(result.rejectedOffers).toMatchObject([{ code: "OFFER_NOT_APPLICABLE" }]);
  });
});

describe("Market-aware monetary correctness and shared parity", () => {
  it.each([0, 1, 2, 3, 4, 5, 6])("supports configured decimalPlaces=%s", decimalPlaces => expect(calculateOffers(input(undefined as never, [], { decimalPlaces })).success).toBe(true));
  it("implements decimal half-up and half-even boundaries", () => {
    const pct = offer("PRODUCT_PERCENTAGE", { benefit: { kind: "PRODUCT_PERCENTAGE", percentage: .5, base: "ELIGIBLE_PAID_PRODUCT_LINES" } });
    expect(success(calculateOffers(input([line("L", "P", 1)], [pct], { roundingMode: "DECIMAL_HALF_UP" }))).productDiscountTotal).toBe(.01);
    expect(success(calculateOffers(input([line("L", "P", 1)], [pct], { roundingMode: "DECIMAL_HALF_EVEN" }))).productDiscountTotal).toBe(0);
  });
  it("handles tiny and large safe amounts without NaN, negative zero, or drift", () => {
    const tiny = success(calculateOffers(input([line("L", "P", .0000005)], [], { decimalPlaces: 6 })));
    expect(tiny.grossPaidSubtotal).toBe(.000001);
    const large = success(calculateOffers(input([line("L", "P", 9_000_000, 1000)], [])));
    expect(large.netSubtotal).toBe(9_000_000_000); expect(JSON.stringify([tiny, large])).not.toMatch(/NaN|-0/);
  });
  it("is byte-for-byte deterministic across browser/server adapters and repeated calls", () => {
    const value = input([line("B", "P2", 3.33, 5), line("A", "P1", 1.11, 10)], [offer("BUY_X_GET_Y")]);
    const browser = calculateOffersForBrowser(value), server = calculateOffersForServer(value);
    expect(JSON.stringify(browser)).toBe(JSON.stringify(server)); expect(JSON.stringify(calculateOffers(value))).toBe(JSON.stringify(calculateOffers(value)));
    expect(success(browser).calculationVersion).toBe(OFFER_CALCULATION_VERSION);
  });
});
