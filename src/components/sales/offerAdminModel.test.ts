import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  OFFER_TYPES, canMutatePrototypeOffer, canonicalDraftFromForm, defaultOfferForm, eligibleCommercialProducts, hydrateOfferForm, isLegacyOffer,
  offerSummary, offerTypeLabel, resetIncompatibleFields, serializeOfferForm, setRewardMode, validateOfferForm,
  type OfferAdminRecord, type OfferFormState,
} from "./offerAdminModel";
import { CANONICAL_OFFER_TYPES } from "../../features/offers/types";

const valid = (): OfferFormState => ({ ...defaultOfferForm(new Date("2030-01-01T00:00:00Z")), code: "OFF-1", name: "Commercial launch", audienceType: "ALL_SALES_REPRESENTATIVES", percentage: "10" });
const legacy = (type = "FIXED_DISCOUNT"): OfferAdminRecord => ({ id: "OLD-1", name: "Historical", description: "", type, startDate: "2029-01-01", endDate: "2029-02-01", isActive: true });
const pageSource = readFileSync(new URL("./SalesOffers.tsx", import.meta.url), "utf8");

describe("Offers administration canonical alignment", () => {
  it("1. exposes exactly the shared four canonical creation types", () => {
    expect(OFFER_TYPES).toBe(CANONICAL_OFFER_TYPES);
    expect(OFFER_TYPES).toEqual(["PRODUCT_PERCENTAGE", "INVOICE_PERCENTAGE", "BUY_X_GET_Y", "TIER_BONUS"]);
  });

  it.each(["PERCENTAGE_DISCOUNT", "ORDER_VALUE_DISCOUNT", "TIERED_DISCOUNT", "FIXED_DISCOUNT"])("2. cannot create old temporary type %s", type => {
    expect(OFFER_TYPES).not.toContain(type as never);
    expect(validateOfferForm({ ...valid(), type: type as never }).type).toBeTruthy();
  });

  it("3. retains the four approved display labels", () => {
    expect(OFFER_TYPES.map(offerTypeLabel)).toEqual(["Product Percentage Discount", "Total Invoice Percentage Discount", "Buy X Get Y", "Tier Bonus"]);
  });

  it("4. accepts and labels All Products without None wording", () => {
    expect(validateOfferForm(valid()).products).toBeUndefined();
    expect(offerSummary(serializeOfferForm(valid()))).toContain("All Products");
    expect(offerSummary(serializeOfferForm(valid()))).not.toContain("None");
  });

  it("5. requires at least one Selected Product", () => {
    expect(validateOfferForm({ ...valid(), productScope: "SELECTED_PRODUCTS" }).products).toBeTruthy();
  });

  it("6. serializes multiple canonical Product IDs and rejects blank/duplicate IDs", () => {
    const record = serializeOfferForm({ ...valid(), productScope: "SELECTED_PRODUCTS", productIds: ["P1", "P2"] });
    expect(record.productIds).toEqual(["P1", "P2"]);
    expect(record.productId).toBeUndefined();
    expect(validateOfferForm({ ...valid(), productScope: "SELECTED_PRODUCTS", productIds: ["P1", ""] }).products).toBeTruthy();
    expect(validateOfferForm({ ...valid(), productScope: "SELECTED_PRODUCTS", productIds: ["P1", "P1"] }).products).toBeTruthy();
  });

  it("7. serializes both Buy X Get Y reward modes without fallback identifiers", () => {
    const base = { ...valid(), type: "BUY_X_GET_Y" as const, buyQuantity: "5", freeQuantity: "1" };
    expect(serializeOfferForm({ ...base, rewardMode: "SAME_AS_TRIGGER", rewardProductId: "" })).toMatchObject({ rewardMode: "SAME_AS_TRIGGER", aggregationMode: "PER_PRODUCT" });
    expect(serializeOfferForm({ ...base, rewardMode: "SELECTED_PRODUCT", rewardProductId: "P2" })).toMatchObject({ rewardMode: "SELECTED_PRODUCT", rewardProductId: "P2" });
    expect(JSON.stringify(serializeOfferForm({ ...base, rewardMode: "SAME_AS_TRIGGER", rewardProductId: "" }))).not.toContain("PRD-BONUS");
  });

  it("8. switching to Same As Trigger clears stale reward product ID", () => {
    expect(setRewardMode({ ...valid(), rewardMode: "SELECTED_PRODUCT", rewardProductId: "P2" }, "SAME_AS_TRIGGER").rewardProductId).toBe("");
  });

  it("9. serializes the approved Tier Bonus application mode", () => {
    const record = serializeOfferForm({ ...valid(), type: "TIER_BONUS", tiers: [{ buyQuantity: "5", freeQuantity: "1" }] });
    expect(record.tierApplicationMode).toBe("REPEATING_GREEDY_WITH_REMAINDER");
  });

  it.each([1, 2, 3, 4, 5])("10. accepts %s valid tiers", count => {
    const tiers = Array.from({ length: count }, (_, index) => ({ buyQuantity: String((index + 1) * 5), freeQuantity: String(index + 1) }));
    expect(validateOfferForm({ ...valid(), type: "TIER_BONUS", tiers }).tiers).toBeUndefined();
  });

  it("11. rejects a sixth tier", () => {
    expect(validateOfferForm({ ...valid(), type: "TIER_BONUS", tiers: Array.from({ length: 6 }, (_, index) => ({ buyQuantity: String(index + 1), freeQuantity: "1" })) }).tiers).toBeTruthy();
  });

  it.each(["0", "-1", "1.5", String(Number.MAX_SAFE_INTEGER + 1), "NaN", "Infinity"])("12. rejects unsafe integer %s", quantity => {
    expect(validateOfferForm({ ...valid(), type: "BUY_X_GET_Y", buyQuantity: quantity, freeQuantity: "1" }).buyQuantity).toBeTruthy();
    expect(validateOfferForm({ ...valid(), type: "TIER_BONUS", tiers: [{ buyQuantity: quantity, freeQuantity: "1" }] })["tier-0"]).toBeTruthy();
  });

  it("13. preserves fixed-discount presentation as visibly legacy", () => {
    expect(isLegacyOffer(legacy().type)).toBe(true);
    expect(offerTypeLabel(legacy().type)).toContain("Fixed Discount");
    expect(pageSource).toContain("Legacy · read only");
  });

  it("14–16. denies edit, delete, and activation mutations for legacy records", () => {
    expect(hydrateOfferForm(legacy())).toEqual({ editable: false, reason: "LEGACY_READ_ONLY", legacyType: "FIXED_DISCOUNT" });
    expect(canMutatePrototypeOffer(legacy())).toBe(false);
    expect(pageSource).toContain("if (legacy) return");
    expect(pageSource).not.toContain("Delete offer");
  });

  it("17. never coerces an unknown legacy type", () => {
    expect(hydrateOfferForm(legacy("UNKNOWN_HISTORICAL_SCHEME"))).toEqual({ editable: false, reason: "LEGACY_READ_ONLY", legacyType: "UNKNOWN_HISTORICAL_SCHEME" });
  });

  it("18. hydrates supported prototype drafts for editing", () => {
    const result = hydrateOfferForm({ id: "O1", name: "Tiers", description: "", type: "TIER_BONUS", productIds: ["P1", "P2"], rewardMode: "SELECTED_PRODUCT", rewardProductId: "P3", tiers: [{ buyQuantity: 5, freeQuantity: 1 }], startDate: "2030-01-01", endDate: "2030-02-01" });
    expect(result).toMatchObject({ editable: true, form: { type: "TIER_BONUS", productScope: "SELECTED_PRODUCTS", productIds: ["P1", "P2"], rewardMode: "SELECTED_PRODUCT", rewardProductId: "P3" } });
  });

  it("preserves Arabic and English validity date labels", () => {
    expect(pageSource).toContain('label={rtl ? "تاريخ البدء" : "Start date"} error={errors.startDate}');
    expect(pageSource).toContain('label={rtl ? "تاريخ الانتهاء" : "End date"} error={errors.endDate}');
    expect(pageSource).not.toContain('label="Start date"');
    expect(pageSource).not.toContain('label="End date"');
  });

  it("19. preserves responsive mobile layout and bounded overflow classes", () => {
    expect(pageSource).toContain("lg:hidden");
    expect(pageSource).toContain("hidden overflow-x-auto lg:block");
    expect(pageSource).toContain("overflow-x-clip");
    expect(pageSource).toContain("sm:max-w-4xl");
  });

  it("loads from the authenticated server and never reads or writes Offer localStorage", () => {
    expect(pageSource).toContain("listAdminOffers");
    expect(pageSource).toContain("getAdminOfferProducts");
    expect(pageSource).not.toContain("localStorage");
    expect(pageSource).not.toContain("pharma_crm_offers");
  });

  it("submits only canonical audience and product identifiers", () => {
    const payload = canonicalDraftFromForm({ ...valid(), productScope: "SELECTED_PRODUCTS", productIds: ["SYNTHETIC_PRODUCT_A"] });
    expect(payload.eligibility).toMatchObject({ audienceType: "ALL_SALES_REPRESENTATIVES" });
    expect(Object.keys(payload.eligibility)).not.toEqual(expect.arrayContaining(["companyId", "marketId", "countryId", "currencyCode", "unitPrice"]));
    expect(payload.productScope.productIds).toEqual(["SYNTHETIC_PRODUCT_A"]);
  });

  it("uses independent audience, Product and representative controls", () => {
    expect(pageSource).toContain("Who Can Use This Offer?");
    expect(pageSource).toContain("getAdminOfferRepresentatives");
    expect(pageSource).toContain("product.price");
    expect(pageSource).toContain("offerContinuation");
    expect(pageSource).not.toContain("selectedRelationship");
    expect(pageSource).not.toContain("commercialOptions");
    expect(pageSource).not.toContain("productMarketCatalog");
  });

  it("has no audience default and preserves selected IDs through canonical hydration", () => {
    expect(defaultOfferForm().audienceType).toBe("");
    expect(validateOfferForm({ ...valid(), audienceType: "" }).audience).toBeTruthy();
    for (const audienceType of ["ALL_SALES_REPRESENTATIVES", "MY_SALES_TEAM"] as const) {
      const form = { ...valid(), audienceType };
      expect(canonicalDraftFromForm(form).eligibility).not.toHaveProperty("audienceUserIds");
      expect(validateOfferForm({ ...form, audienceUserIds: ["REP-A"] }).audience).toBeTruthy();
    }
    const form = { ...valid(), audienceType: "SELECTED_SALES_REPRESENTATIVES" as const, audienceUserIds: ["REP-A", "REP-B"] };
    expect(canonicalDraftFromForm(form).eligibility).toMatchObject({ audienceType: form.audienceType, audienceUserIds: form.audienceUserIds });
    const hydrated = hydrateOfferForm({ ...serializeOfferForm(form), canonical: { ...canonicalDraftFromForm(form) } as any });
    expect(hydrated).toMatchObject({ editable: true, form: { audienceType: form.audienceType, audienceUserIds: form.audienceUserIds } });
    for (const ids of [[], [""], ["REP-A", "REP-A"], [" REP-A"], new Array(1)]) expect(validateOfferForm({ ...form, audienceUserIds: ids }).audience).toBeTruthy();
  });

  it("also validates percentage, dates, rewards and tier ordering consistently", () => {
    expect(validateOfferForm({ ...valid(), percentage: "100" }).percentage).toBeUndefined();
    expect(validateOfferForm({ ...valid(), percentage: "100.1" }).percentage).toBeTruthy();
    expect(validateOfferForm({ ...valid(), type: "BUY_X_GET_Y", buyQuantity: "5", freeQuantity: "1", rewardMode: "SELECTED_PRODUCT", rewardProductId: "" }).rewardProductId).toBeTruthy();
    expect(validateOfferForm({ ...valid(), type: "TIER_BONUS", tiers: [{ buyQuantity: "5", freeQuantity: "1" }, { buyQuantity: "5", freeQuantity: "2" }] }).tiers).toContain("unique");
    expect(validateOfferForm({ ...valid(), type: "TIER_BONUS", tiers: [{ buyQuantity: "10", freeQuantity: "2" }, { buyQuantity: "5", freeQuantity: "1" }] }).tiers).toContain("increasing");
    expect(validateOfferForm({ ...valid(), startDate: "2030-02-01", endDate: "2030-01-01" }).endDate).toBeTruthy();
  });

  it("retains only eligible active commercial products by canonical Product ID", () => {
    expect(eligibleCommercialProducts([{ id: "P1", name: "Commercial", brand: "B", therapeuticArea: "T", price: 1, stock: 0, isActive: true }, { id: "P2", name: "Inactive", brand: "B", therapeuticArea: "T", price: 1, stock: 0, isActive: false }, { id: "P3", name: "Sample", brand: "B", therapeuticArea: "T", price: 0, stock: 0, isSampleSku: true }]).map(product => product.id)).toEqual(["P1"]);
  });

  it("clears incompatible values when changing supported type", () => {
    expect(resetIncompatibleFields({ ...valid(), rewardMode: "SELECTED_PRODUCT", rewardProductId: "P2", tiers: [{ buyQuantity: "10", freeQuantity: "2" }] }, "BUY_X_GET_Y")).toMatchObject({ type: "BUY_X_GET_Y", rewardMode: "SAME_AS_TRIGGER", rewardProductId: "", aggregationMode: "PER_PRODUCT", tiers: [{ buyQuantity: "", freeQuantity: "" }] });
  });
});
