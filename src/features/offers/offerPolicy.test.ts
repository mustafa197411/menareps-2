import { describe, expect, it } from "vitest";
import {
  DEFAULT_OFFER_AGGREGATION_MODE,
  DEFAULT_OFFER_ROUNDING_MODE,
  CANONICAL_OFFER_SCHEMA_VERSION,
  CANONICAL_OFFER_TYPES,
  OFFER_CAPABILITIES,
  OFFER_CURRENCY_SOURCE,
  OFFER_LINE_CLASSIFICATIONS,
  OFFER_MONETARY_POLICY,
  OFFER_PRODUCT_IDENTITY,
  OFFER_ROUNDING_MODES,
  OFFER_STACKING_RESOLUTION_POLICY,
  OFFER_STOCK_SOURCE,
  OFFER_VERSIONING_POLICY,
  PROMOTIONAL_SHORTAGE_POLICY,
  type CanonicalOfferDefinition,
} from "./types";
import {
  OFFER_HISTORICAL_POLICY,
  OFFER_LIFECYCLE_TRANSITIONS,
  defaultBuyXGetYPolicy,
  evaluateActiveCommercialEdit,
  evaluateApprovalSeparation,
  evaluateMakerSeparation,
  evaluateLifecycleTransition,
  evaluateRepeatingGreedyTierBonus,
  isScheduledOfferDueForActivation,
  isApprovedOfferApproverRole,
  isApprovedOfferCreatorRole,
  isCanonicalOperationalOfferType,
} from "./offerPolicy";
import { adaptLegacyOfferForReadOnlyPresentation, validateCanonicalOfferDefinition } from "./offerValidation";

const timestamp = "2030-01-01T00:00:00.000Z";

function definition(overrides: Record<string, unknown> = {}): CanonicalOfferDefinition {
  return {
    id: "OFF-1",
    schemaVersion: CANONICAL_OFFER_SCHEMA_VERSION,
    offerVersion: 1,
    code: "OFFER-1",
    name: "Canonical Offer",
    type: "PRODUCT_PERCENTAGE",
    lifecycleStatus: "DRAFT",
    productScope: { mode: "ALL_PRODUCTS", productIds: [] },
    benefit: { kind: "PRODUCT_PERCENTAGE", percentage: 10, base: "ELIGIBLE_PAID_PRODUCT_LINES" },
    eligibility: {
      audienceType: "ALL_SALES_REPRESENTATIVES",
      startAt: timestamp,
      endAt: "2030-12-31T23:59:59.999Z",
    },
    stackingPolicy: {
      mode: "NO_STACKING",
      priority: 100,
      maximumProductOrQuantityOffersPerPaidLine: 1,
      maximumInvoicePercentageOffersPerInvoice: 1,
    },
    createdAt: timestamp,
    createdBy: "USER-1",
    updatedAt: timestamp,
    updatedBy: "USER-1",
    revision: 1,
    ...overrides,
  } as CanonicalOfferDefinition;
}

const codes = (result: ReturnType<typeof validateCanonicalOfferDefinition>) => result.valid ? [] : result.errors.map(error => error.code);

describe("canonical representative audience structure", () => {
  const withAudience = (audience: Record<string, unknown>) => definition({
    eligibility: { startAt: timestamp, endAt: "2030-12-31T23:59:59.999Z", ...audience },
  });

  it.each(["ALL_SALES_REPRESENTATIVES", "MY_SALES_TEAM"])("accepts %s only without selected IDs", audienceType => {
    expect(validateCanonicalOfferDefinition(withAudience({ audienceType })).valid).toBe(true);
    for (const audienceUserIds of [[], ["REP-A"], undefined, null]) {
      expect(validateCanonicalOfferDefinition(withAudience({ audienceType, audienceUserIds })).valid).toBe(false);
    }
  });

  it("accepts explicit structural user IDs without performing runtime identity lookups", () => {
    const input = withAudience({ audienceType: "SELECTED_SALES_REPRESENTATIVES", audienceUserIds: ["REP-A", "REP-B"] });
    const before = structuredClone(input);
    const result = validateCanonicalOfferDefinition(input);
    expect(result.valid).toBe(true);
    expect(input).toEqual(before);
  });

  it.each([undefined, null, [], [""], [" REP-A"], ["REP-A "], ["bad/id"], [7], ["REP-A", "REP-A"], "REP-A"])("rejects invalid selected IDs %j", audienceUserIds => {
    expect(validateCanonicalOfferDefinition(withAudience({ audienceType: "SELECTED_SALES_REPRESENTATIVES", audienceUserIds })).valid).toBe(false);
  });

  it.each(["fully sparse", "partially sparse"])("rejects %s selected IDs without mutation", shape => {
    const audienceUserIds = shape === "fully sparse" ? new Array(1) : ["REP-A", "REP-B"];
    if (shape === "partially sparse") delete audienceUserIds[1];
    const input = withAudience({ audienceType: "SELECTED_SALES_REPRESENTATIVES", audienceUserIds });
    const before = structuredClone(input);
    const keysBefore = Object.keys(audienceUserIds);
    const result = validateCanonicalOfferDefinition(input);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "INVALID_IDENTIFIER", path: "eligibility.audienceUserIds" }));
    expect(input).toStrictEqual(before);
    expect(Object.keys(audienceUserIds)).toEqual(keysBefore);
  });

  it.each([undefined, null, "", "COUNTRY", "ALL", 7])("rejects missing or unknown audience %j", audienceType => {
    expect(validateCanonicalOfferDefinition(withAudience({ audienceType })).valid).toBe(false);
  });
  it("does not default an omitted audience or accept old commercial-only eligibility", () => {
    expect(validateCanonicalOfferDefinition(withAudience({})).valid).toBe(false);
    const old = withAudience({ companyId: "SYNTH-C", marketId: "SYNTH-M", countryId: "SYNTH-N" });
    const before = structuredClone(old);
    expect(validateCanonicalOfferDefinition(old).valid).toBe(false);
    expect(old).toEqual(before);
  });

  it.each(["companyId", "marketId", "countryId", "companyMarketId", "geographyPaths", "pharmacyIds", "pharmacyTypes", "productVerificationPolicy", "marketTimePolicy"])("rejects removed eligibility field %s even with valid audience", field => {
    expect(validateCanonicalOfferDefinition(withAudience({ audienceType: "ALL_SALES_REPRESENTATIVES", [field]: "SYNTH-OLD" })).valid).toBe(false);
  });
  it("rejects commercial context instead of accepting a second contract", () => {
    for (const commercialContext of [undefined, null, {}]) {
      expect(validateCanonicalOfferDefinition(definition({ commercialContext })).valid).toBe(false);
    }
  });
  it.each([null, [], "invalid"])("fails closed on malformed eligibility %j", eligibility => {
    expect(validateCanonicalOfferDefinition(definition({ eligibility })).valid).toBe(false);
  });
});

describe("MENAREPS Offers Phase 1 canonical policy", () => {
  it("1. exposes only four supported canonical operational types", () => {
    expect(CANONICAL_OFFER_TYPES).toEqual(["PRODUCT_PERCENTAGE", "INVOICE_PERCENTAGE", "BUY_X_GET_Y", "TIER_BONUS"]);
    const invoice = definition({ type: "INVOICE_PERCENTAGE", benefit: { kind: "INVOICE_PERCENTAGE", percentage: 10, base: "PAID_ELIGIBLE_SUBTOTAL_AFTER_PRODUCT_DISCOUNTS_BEFORE_TAX", excludesFreeLines: true, excludesProductsOutsideScope: true } });
    const buyGet = definition({ type: "BUY_X_GET_Y", benefit: defaultBuyXGetYPolicy({ kind: "BUY_X_GET_Y", buyQuantity: 5, freeQuantity: 1, reward: { mode: "SAME_AS_TRIGGER" } }) });
    const tier = definition({ type: "TIER_BONUS", benefit: { kind: "TIER_BONUS", tiers: [{ buyQuantity: 5, freeQuantity: 1 }], reward: { mode: "SAME_AS_TRIGGER" }, aggregationMode: "PER_PRODUCT", applicationMode: "REPEATING_GREEDY_WITH_REMAINDER" } });
    expect([definition(), invoice, buyGet, tier].every(offer => validateCanonicalOfferDefinition(offer).valid)).toBe(true);
  });

  it.each(["FIXED_DISCOUNT", "PRODUCT_FIXED_DISCOUNT", "INVOICE_FIXED_DISCOUNT", "BONUS_QUANTITY", "FREE_PRODUCT"])("2. rejects %s for new operational use", type => {
    expect(isCanonicalOperationalOfferType(type)).toBe(false);
    expect(codes(validateCanonicalOfferDefinition({ ...definition(), type }))).toContain("UNSUPPORTED_TYPE");
  });

  it("3. keeps unknown legacy types readable without coercion or operational actions", () => {
    const result = adaptLegacyOfferForReadOnlyPresentation({ id: "OLD-1", name: "Old", type: "Mystery Fixed Scheme" });
    expect(result).toEqual({ valid: true, value: { id: "OLD-1", name: "Old", legacyTypeLabel: "Mystery Fixed Scheme", status: "READ_ONLY_LEGACY", operationallyApplicable: false, canEdit: false, canDelete: false, canActivate: false }, errors: [] });
  });

  it("4. accepts All Products only with its canonical empty tuple", () => {
    expect(validateCanonicalOfferDefinition(definition()).valid).toBe(true);
    expect(codes(validateCanonicalOfferDefinition(definition({ productScope: { mode: "ALL_PRODUCTS", productIds: ["P1"] } })))).toContain("INVALID_PRODUCT_SCOPE");
  });

  it("5. requires Selected Products to contain a product", () => {
    expect(codes(validateCanonicalOfferDefinition(definition({ productScope: { mode: "SELECTED_PRODUCTS", productIds: [] } })))).toContain("EMPTY_SELECTED_PRODUCTS");
  });

  it("6. rejects blank and duplicate canonical product IDs", () => {
    expect(codes(validateCanonicalOfferDefinition(definition({ productScope: { mode: "SELECTED_PRODUCTS", productIds: ["P1", ""] } })))).toContain("INVALID_IDENTIFIER");
    expect(codes(validateCanonicalOfferDefinition(definition({ productScope: { mode: "SELECTED_PRODUCTS", productIds: ["P1", "P1"] } })))).toContain("DUPLICATE_PRODUCT_IDS");
  });

  it.each([[Number.NaN, false], [Number.POSITIVE_INFINITY, false], [0, false], [-1, false], [0.1, true], [100, true], [100.1, false]])("7. validates percentage boundary %s", (percentage, valid) => {
    expect(validateCanonicalOfferDefinition(definition({ benefit: { kind: "PRODUCT_PERCENTAGE", percentage, base: "ELIGIBLE_PAID_PRODUCT_LINES" } })).valid).toBe(valid);
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN])("8. rejects unsafe Buy/Get quantity %s", quantity => {
    const offer = definition({ type: "BUY_X_GET_Y", benefit: defaultBuyXGetYPolicy({ kind: "BUY_X_GET_Y", buyQuantity: quantity, freeQuantity: 1, reward: { mode: "SAME_AS_TRIGGER" } }) });
    expect(validateCanonicalOfferDefinition(offer).valid).toBe(false);
  });

  it("9. enforces reward-mode product requirements", () => {
    const missing = definition({ type: "BUY_X_GET_Y", benefit: defaultBuyXGetYPolicy({ kind: "BUY_X_GET_Y", buyQuantity: 5, freeQuantity: 1, reward: { mode: "SELECTED_PRODUCT", rewardProductId: "" } }) });
    const forbidden = definition({ type: "BUY_X_GET_Y", benefit: { ...defaultBuyXGetYPolicy({ kind: "BUY_X_GET_Y", buyQuantity: 5, freeQuantity: 1, reward: { mode: "SAME_AS_TRIGGER" } }), reward: { mode: "SAME_AS_TRIGGER", rewardProductId: "P2" } } });
    expect(codes(validateCanonicalOfferDefinition(missing))).toContain("MISSING_REWARD_PRODUCT");
    expect(codes(validateCanonicalOfferDefinition(forbidden))).toContain("FORBIDDEN_REWARD_PRODUCT");
  });

  it("prohibits same-trigger across-product rewards and requires a selected canonical reward", () => {
    const invalid = definition({ type: "BUY_X_GET_Y", benefit: { ...defaultBuyXGetYPolicy({ kind: "BUY_X_GET_Y", buyQuantity: 5, freeQuantity: 1, reward: { mode: "SAME_AS_TRIGGER" } }), aggregationMode: "ACROSS_ELIGIBLE_PRODUCTS" } });
    const valid = definition({ type: "BUY_X_GET_Y", benefit: { ...defaultBuyXGetYPolicy({ kind: "BUY_X_GET_Y", buyQuantity: 5, freeQuantity: 1, reward: { mode: "SELECTED_PRODUCT", rewardProductId: "P2" } }), aggregationMode: "ACROSS_ELIGIBLE_PRODUCTS" } });
    expect(codes(validateCanonicalOfferDefinition(invalid))).toContain("INVALID_REWARD_AGGREGATION");
    expect(validateCanonicalOfferDefinition(valid).valid).toBe(true);
    const tier = definition({ type: "TIER_BONUS", benefit: { kind: "TIER_BONUS", tiers: [{ buyQuantity: 5, freeQuantity: 1 }], reward: { mode: "SAME_AS_TRIGGER" }, aggregationMode: "ACROSS_ELIGIBLE_PRODUCTS", applicationMode: "REPEATING_GREEDY_WITH_REMAINDER" } });
    expect(codes(validateCanonicalOfferDefinition(tier))).toContain("INVALID_REWARD_AGGREGATION");
  });

  it("10. defaults quantity aggregation to Per Product", () => {
    expect(defaultBuyXGetYPolicy({ kind: "BUY_X_GET_Y", buyQuantity: 5, freeQuantity: 1, reward: { mode: "SAME_AS_TRIGGER" } }).aggregationMode).toBe(DEFAULT_OFFER_AGGREGATION_MODE);
  });

  it.each([1, 2, 3, 4, 5])("11. accepts %s canonical tiers", count => {
    const tiers = Array.from({ length: count }, (_, index) => ({ buyQuantity: (index + 1) * 5, freeQuantity: index + 1 }));
    const offer = definition({ type: "TIER_BONUS", benefit: { kind: "TIER_BONUS", tiers, reward: { mode: "SAME_AS_TRIGGER" }, aggregationMode: "PER_PRODUCT", applicationMode: "REPEATING_GREEDY_WITH_REMAINDER" } });
    expect(validateCanonicalOfferDefinition(offer).valid).toBe(true);
  });

  it.each([0, 6])("12. rejects %s tiers", count => {
    const tiers = Array.from({ length: count }, (_, index) => ({ buyQuantity: index + 1, freeQuantity: 1 }));
    const offer = definition({ type: "TIER_BONUS", benefit: { kind: "TIER_BONUS", tiers, reward: { mode: "SAME_AS_TRIGGER" }, aggregationMode: "PER_PRODUCT", applicationMode: "REPEATING_GREEDY_WITH_REMAINDER" } });
    expect(codes(validateCanonicalOfferDefinition(offer))).toContain("INVALID_TIER_COUNT");
  });

  it("13. rejects duplicate and unordered Tier Bonus thresholds", () => {
    const make = (tiers: Array<{ buyQuantity: number; freeQuantity: number }>) => definition({ type: "TIER_BONUS", benefit: { kind: "TIER_BONUS", tiers, reward: { mode: "SAME_AS_TRIGGER" }, aggregationMode: "PER_PRODUCT", applicationMode: "REPEATING_GREEDY_WITH_REMAINDER" } });
    expect(codes(validateCanonicalOfferDefinition(make([{ buyQuantity: 5, freeQuantity: 1 }, { buyQuantity: 5, freeQuantity: 2 }])))).toContain("DUPLICATE_TIER_THRESHOLDS");
    expect(codes(validateCanonicalOfferDefinition(make([{ buyQuantity: 10, freeQuantity: 3 }, { buyQuantity: 5, freeQuantity: 1 }])))).toContain("UNORDERED_TIER_THRESHOLDS");
  });

  it.each([[4, 0], [5, 1], [10, 3], [20, 6], [25, 10], [30, 11], [50, 20]])("14. applies repeating greedy tiers to paid %s => free %s", (paid, free) => {
    expect(evaluateRepeatingGreedyTierBonus(paid, [{ buyQuantity: 5, freeQuantity: 1 }, { buyQuantity: 10, freeQuantity: 3 }, { buyQuantity: 25, freeQuantity: 10 }])).toBe(free);
  });

  it("15. permits only explicit bounded stacking contracts", () => {
    const explicit = definition({ stackingPolicy: { mode: "EXPLICIT_COMPATIBILITY", priority: 1, compatibleCombination: "PRODUCT_PERCENTAGE_WITH_INVOICE_PERCENTAGE", maximumProductOrQuantityOffersPerPaidLine: 1, maximumInvoicePercentageOffersPerInvoice: 1 } });
    const arbitrary = definition({ stackingPolicy: { mode: "EXPLICIT_COMPATIBILITY", priority: 1, compatibleCombination: "ANYTHING", maximumProductOrQuantityOffersPerPaidLine: 1, maximumInvoicePercentageOffersPerInvoice: 1 } });
    expect(validateCanonicalOfferDefinition(explicit).valid).toBe(true);
    expect(codes(validateCanonicalOfferDefinition(arbitrary))).toContain("INVALID_STACKING_POLICY");
    expect(OFFER_STACKING_RESOLUTION_POLICY).toMatchObject({ quantityConsumptionReuse: "FORBIDDEN", resolutionOrder: ["EXPLICIT_COMPATIBILITY", "PRIORITY_DESCENDING", "OFFER_ID_ASCENDING"] });
  });

  it("16. accepts exactly the approved lifecycle transitions", () => {
    const actual = Object.entries(OFFER_LIFECYCLE_TRANSITIONS).flatMap(([from, targets]) => targets.map(to => `${from}->${to}`));
    expect(actual).toEqual(["DRAFT->PENDING_APPROVAL", "PENDING_APPROVAL->DRAFT", "PENDING_APPROVAL->SCHEDULED", "PENDING_APPROVAL->ACTIVE", "SCHEDULED->ACTIVE", "SCHEDULED->CANCELLED", "ACTIVE->PAUSED", "ACTIVE->CANCELLED", "ACTIVE->EXPIRED", "PAUSED->ACTIVE", "PAUSED->CANCELLED", "PAUSED->EXPIRED"]);
    expect(evaluateLifecycleTransition("DRAFT", "ACTIVE").valid).toBe(false);
  });

  it("makes Scheduled non-active and due only inside its explicit activation window", () => {
    const scheduled = definition({ lifecycleStatus: "SCHEDULED" });
    expect(scheduled.lifecycleStatus).not.toBe("ACTIVE");
    expect(isScheduledOfferDueForActivation(scheduled, "2029-12-31T23:59:59.999Z")).toBe(false);
    expect(isScheduledOfferDueForActivation(scheduled, timestamp)).toBe(true);
    expect(isScheduledOfferDueForActivation(scheduled, "2031-01-01T00:00:00.000Z")).toBe(false);
    expect(evaluateLifecycleTransition("SCHEDULED", "PAUSED").valid).toBe(false);
    expect(evaluateLifecycleTransition("SCHEDULED", "CANCELLED").valid).toBe(true);
  });

  it("17. makes Expired and Cancelled terminal", () => {
    expect(evaluateLifecycleTransition("EXPIRED", "ACTIVE").valid).toBe(false);
    expect(evaluateLifecycleTransition("CANCELLED", "ACTIVE").valid).toBe(false);
  });

  it("18. defines roles/capabilities and prevents creator self-approval", () => {
    expect(isApprovedOfferCreatorRole("Sales & Marketing Manager")).toBe(true);
    expect(isApprovedOfferApproverRole("Admin")).toBe(true);
    expect(OFFER_CAPABILITIES).toContain("offers.applyDuringVisit");
    expect(evaluateApprovalSeparation("USER-1", "USER-1").valid).toBe(false);
    expect(evaluateApprovalSeparation("USER-1", "USER-2").valid).toBe(true);
    expect(evaluateMakerSeparation(["USER-1", "USER-2", "USER-3"], "USER-2").valid).toBe(false);
    expect(evaluateMakerSeparation(["USER-1", "USER-2", "USER-3"], "USER-4").valid).toBe(true);
  });

  it("19. requires a new version for active commercial edits", () => {
    const current = definition({ lifecycleStatus: "ACTIVE" });
    const sameVersion = definition({ lifecycleStatus: "ACTIVE", benefit: { kind: "PRODUCT_PERCENTAGE", percentage: 20, base: "ELIGIBLE_PAID_PRODUCT_LINES" } });
    const nextVersion = definition({ lifecycleStatus: "DRAFT", offerVersion: 2, previousVersionId: "OFF-1", benefit: { kind: "PRODUCT_PERCENTAGE", percentage: 20, base: "ELIGIBLE_PAID_PRODUCT_LINES" } });
    expect(evaluateActiveCommercialEdit(current, sameVersion).valid).toBe(false);
    expect(evaluateActiveCommercialEdit(current, nextVersion)).toMatchObject({ valid: true, value: { requiresNewVersion: true } });
    expect(OFFER_HISTORICAL_POLICY.historicalVersions).toBe("NO_OVERWRITE_OR_DELETE");
    expect(OFFER_VERSIONING_POLICY.newDefinition).toEqual({ schemaVersion: 1, offerVersion: 1, revision: 1 });
    expect(OFFER_VERSIONING_POLICY.draftAdministrativeEdit).toBe("INCREMENT_REVISION");
  });

  it("20. requires complete cancellation metadata and preserves history policy", () => {
    expect(codes(validateCanonicalOfferDefinition(definition({ lifecycleStatus: "CANCELLED" })))).toContain("CANCELLATION_METADATA_REQUIRED");
    expect(validateCanonicalOfferDefinition(definition({ lifecycleStatus: "CANCELLED", cancelledAt: timestamp, cancelledBy: "ADMIN-1", cancellationReason: "Campaign withdrawn" })).valid).toBe(true);
    expect(OFFER_HISTORICAL_POLICY.cancellationHistoricalSnapshots).toBe("UNCHANGED");
  });

  it("21. validates eligibility timestamps without commercial geography", () => {
    expect(validateCanonicalOfferDefinition(definition()).valid).toBe(true);
    expect(codes(validateCanonicalOfferDefinition(definition({ eligibility: { ...definition().eligibility, startAt: "bad", endAt: timestamp } })))).toContain("INVALID_DATE_RANGE");
    expect(codes(validateCanonicalOfferDefinition(definition({ eligibility: { ...definition().eligibility, startAt: "2031-01-01T00:00:00Z", endAt: timestamp } })))).toContain("INVALID_DATE_RANGE");
  });

  it("22. fails closed on unsupported schema versions", () => {
    expect(codes(validateCanonicalOfferDefinition(definition({ schemaVersion: 999 })))).toContain("UNSUPPORTED_SCHEMA_VERSION");
    expect(OFFER_HISTORICAL_POLICY.unknownSchemaPresentationBehavior).toBe("READ_ONLY_LEGACY");
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])("23. controls invalid numeric value %s without throwing", value => {
    expect(() => validateCanonicalOfferDefinition(definition({ revision: value, usageLimits: { perPharmacy: value } }))).not.toThrow();
    expect(codes(validateCanonicalOfferDefinition(definition({ revision: value })))).toContain("UNSAFE_NUMERIC_VALUE");
  });

  it("24. defines paid/free and shortage classifications without stock integration", () => {
    expect(OFFER_LINE_CLASSIFICATIONS).toEqual(["PAID_ORDER_LINE", "PROMOTIONAL_FREE_LINE", "PAID_GOODS_SHORTAGE", "PROMOTIONAL_FREE_GOODS_SHORTAGE"]);
    expect(PROMOTIONAL_SHORTAGE_POLICY).toMatchObject({ paidSaleWhenRewardUnavailable: "PRESERVE", earnedRewardReduction: "FORBIDDEN", defaultRewardShortageOutcome: "PROMOTIONAL_FREE_GOODS_SHORTAGE" });
    expect(OFFER_PRODUCT_IDENTITY).toBe("FIRESTORE_PRODUCTS_DOCUMENT_ID");
    expect(OFFER_STOCK_SOURCE).toBe("products/{productId}.stockQuantity");
  });

  it("25. defines authoritative market currency and supported rounding modes without a fallback", () => {
    expect(OFFER_CURRENCY_SOURCE).toBe("AUTHORITATIVE_ACTIVE_MARKET_CONFIGURATION");
    expect(DEFAULT_OFFER_ROUNDING_MODE).toBe("DECIMAL_HALF_UP");
    expect(OFFER_ROUNDING_MODES).toEqual(["DECIMAL_HALF_UP", "DECIMAL_HALF_EVEN"]);
    expect(OFFER_MONETARY_POLICY).toMatchObject({ currencyFallback: "FORBIDDEN", decimalPlacesSource: "AUTHORITATIVE_ACTIVE_MARKET_CONFIGURATION" });
    expect(JSON.stringify({ OFFER_CURRENCY_SOURCE, OFFER_ROUNDING_MODES })).not.toMatch(/USD|LYD|JOD/);
  });

  it("26. validates immutable maker identity contracts when present", () => {
    const complete = definition({ makerIds: ["USER-1", "USER-2"], makerAudit: [{ actorId: "USER-1", action: "CREATE", occurredAt: timestamp, revision: 1 }, { actorId: "USER-2", action: "EDIT", occurredAt: timestamp, revision: 2 }] });
    expect(validateCanonicalOfferDefinition(complete).valid).toBe(true);
    expect(validateCanonicalOfferDefinition({ ...complete, makerIds: ["USER-1"] }).valid).toBe(false);
    expect(validateCanonicalOfferDefinition({ ...complete, makerAudit: [{ actorId: " USER-1", action: "CREATE", occurredAt: "not-exact", revision: 1 }] }).valid).toBe(false);
  });
});
