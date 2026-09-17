import {
  CANONICAL_OFFER_SCHEMA_VERSION,
  CANONICAL_OFFER_TYPES,
  OFFER_AUDIENCE_TYPES,
  OFFER_AGGREGATION_MODES,
  OFFER_LIFECYCLE_STATUSES,
  OFFER_MAKER_ACTIONS,
  TIER_APPLICATION_MODES,
  type CanonicalOfferDefinition,
  type LegacyOfferPresentation,
  type OfferValidationError,
  type OfferValidationErrorCode,
  type OfferValidationResult,
} from "./types";

type DataRecord = Record<string, unknown>;

const record = (value: unknown): DataRecord | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as DataRecord : null;
const nonBlank = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const safePositiveInteger = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const member = <T extends string>(values: readonly T[], value: unknown): value is T => typeof value === "string" && (values as readonly string[]).includes(value);
const timestamp = (value: unknown): value is string => nonBlank(value) && Number.isFinite(Date.parse(value));
const exactTimestamp = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const exactCanonicalId = (value: unknown): value is string => typeof value === "string" && value === value.trim() && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value);

function issue(code: OfferValidationErrorCode, path: string, message: string): OfferValidationError {
  return { code, path, message };
}

function validateIdentifier(errors: OfferValidationError[], value: unknown, path: string): void {
  if (!nonBlank(value)) errors.push(issue("INVALID_IDENTIFIER", path, `${path} must be a non-empty canonical identifier.`));
}

function validateUniqueIdentifiers(errors: OfferValidationError[], value: unknown, path: string, emptyCode: OfferValidationErrorCode = "INVALID_IDENTIFIER"): void {
  if (!Array.isArray(value)) {
    errors.push(issue(emptyCode, path, `${path} must be an identifier array.`));
    return;
  }
  if (value.some(item => !nonBlank(item))) errors.push(issue("INVALID_IDENTIFIER", path, `${path} contains a blank or invalid identifier.`));
  const normalized = value.filter(nonBlank).map(item => item.trim());
  if (new Set(normalized).size !== normalized.length) errors.push(issue("DUPLICATE_PRODUCT_IDS", path, `${path} contains duplicate identifiers.`));
}

function validateProductScope(errors: OfferValidationError[], value: unknown): void {
  const scope = record(value);
  if (!scope || (scope.mode !== "ALL_PRODUCTS" && scope.mode !== "SELECTED_PRODUCTS") || !Array.isArray(scope.productIds)) {
    errors.push(issue("INVALID_PRODUCT_SCOPE", "productScope", "Product scope must use a supported mode and productIds array."));
    return;
  }
  if (scope.mode === "ALL_PRODUCTS") {
    if (scope.productIds.length !== 0) errors.push(issue("INVALID_PRODUCT_SCOPE", "productScope.productIds", "All Products must use an empty productIds tuple."));
    return;
  }
  if (scope.productIds.length === 0) errors.push(issue("EMPTY_SELECTED_PRODUCTS", "productScope.productIds", "Selected Products requires at least one canonical product ID."));
  validateUniqueIdentifiers(errors, scope.productIds, "productScope.productIds");
}

function validateReward(errors: OfferValidationError[], value: unknown, path: string): void {
  const reward = record(value);
  if (!reward || (reward.mode !== "SAME_AS_TRIGGER" && reward.mode !== "SELECTED_PRODUCT")) {
    errors.push(issue("MISSING_REWARD_PRODUCT", path, "A supported reward mode is required."));
    return;
  }
  if (reward.mode === "SELECTED_PRODUCT" && !nonBlank(reward.rewardProductId)) {
    errors.push(issue("MISSING_REWARD_PRODUCT", `${path}.rewardProductId`, "Selected Product reward requires a canonical reward product ID."));
  }
  if (reward.mode === "SAME_AS_TRIGGER" && Object.prototype.hasOwnProperty.call(reward, "rewardProductId")) {
    errors.push(issue("FORBIDDEN_REWARD_PRODUCT", `${path}.rewardProductId`, "Same-as-trigger reward must not contain rewardProductId."));
  }
}

function validateRewardAggregation(errors: OfferValidationError[], benefit: DataRecord): void {
  const reward = record(benefit.reward);
  if (benefit.aggregationMode === "ACROSS_ELIGIBLE_PRODUCTS" && reward?.mode !== "SELECTED_PRODUCT") {
    errors.push(issue("INVALID_REWARD_AGGREGATION", "benefit", "Across-products aggregation requires one explicitly selected canonical reward product."));
  }
  if (reward?.mode === "SAME_AS_TRIGGER" && benefit.aggregationMode !== "PER_PRODUCT") {
    errors.push(issue("INVALID_REWARD_AGGREGATION", "benefit.aggregationMode", "Same-as-trigger rewards are permitted only with per-product aggregation."));
  }
}

function validatePercentage(errors: OfferValidationError[], value: unknown, path: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 100) {
    errors.push(issue(Number.isFinite(value) ? "INVALID_PERCENTAGE" : "UNSAFE_NUMERIC_VALUE", path, "Percentage must be finite, greater than 0, and no greater than 100."));
  }
}

function validateBenefit(errors: OfferValidationError[], type: unknown, value: unknown): void {
  const benefit = record(value);
  if (!member(CANONICAL_OFFER_TYPES, type) || !benefit || benefit.kind !== type) {
    errors.push(issue("UNSUPPORTED_TYPE", "benefit.kind", "Offer type and benefit kind must be the same supported canonical type."));
    return;
  }
  if (type === "PRODUCT_PERCENTAGE") {
    validatePercentage(errors, benefit.percentage, "benefit.percentage");
    if (benefit.base !== "ELIGIBLE_PAID_PRODUCT_LINES") errors.push(issue("INVALID_IDENTIFIER", "benefit.base", "Product percentage base is invalid."));
    return;
  }
  if (type === "INVOICE_PERCENTAGE") {
    validatePercentage(errors, benefit.percentage, "benefit.percentage");
    if (benefit.base !== "PAID_ELIGIBLE_SUBTOTAL_AFTER_PRODUCT_DISCOUNTS_BEFORE_TAX" || benefit.excludesFreeLines !== true || benefit.excludesProductsOutsideScope !== true) {
      errors.push(issue("INVALID_IDENTIFIER", "benefit.base", "Invoice percentage base/exclusions do not match canonical policy."));
    }
    return;
  }
  if (type === "BUY_X_GET_Y") {
    if (!safePositiveInteger(benefit.buyQuantity)) errors.push(issue(Number.isSafeInteger(benefit.buyQuantity) ? "INVALID_BUY_QUANTITY" : "UNSAFE_NUMERIC_VALUE", "benefit.buyQuantity", "Buy quantity must be a positive safe integer."));
    if (!safePositiveInteger(benefit.freeQuantity)) errors.push(issue(Number.isSafeInteger(benefit.freeQuantity) ? "INVALID_FREE_QUANTITY" : "UNSAFE_NUMERIC_VALUE", "benefit.freeQuantity", "Free quantity must be a positive safe integer."));
    validateReward(errors, benefit.reward, "benefit.reward");
    validateRewardAggregation(errors, benefit);
    if (!member(OFFER_AGGREGATION_MODES, benefit.aggregationMode) || benefit.multiples !== "REPEAT_COMPLETE_MULTIPLES" || benefit.remainder !== "NO_REWARD_BELOW_THRESHOLD") {
      errors.push(issue("INVALID_IDENTIFIER", "benefit.aggregationMode", "Buy X Get Y quantity policy is invalid."));
    }
    return;
  }
  const tiers = benefit.tiers;
  if (!Array.isArray(tiers) || tiers.length < 1 || tiers.length > 5) {
    errors.push(issue("INVALID_TIER_COUNT", "benefit.tiers", "Tier Bonus requires one through five tiers."));
  } else {
    const buys: number[] = [];
    tiers.forEach((rawTier, index) => {
      const tier = record(rawTier);
      if (!tier || !safePositiveInteger(tier.buyQuantity) || !safePositiveInteger(tier.freeQuantity)) {
        errors.push(issue("UNSAFE_NUMERIC_VALUE", `benefit.tiers.${index}`, "Tier quantities must be positive safe integers."));
      }
      if (tier && typeof tier.buyQuantity === "number") buys.push(tier.buyQuantity);
    });
    if (new Set(buys).size !== buys.length) errors.push(issue("DUPLICATE_TIER_THRESHOLDS", "benefit.tiers", "Tier Buy thresholds must be unique."));
    else if (buys.some((buy, index) => index > 0 && buy <= buys[index - 1])) errors.push(issue("UNORDERED_TIER_THRESHOLDS", "benefit.tiers", "Tier Buy thresholds must be strictly increasing."));
  }
  validateReward(errors, benefit.reward, "benefit.reward");
  validateRewardAggregation(errors, benefit);
  if (!member(OFFER_AGGREGATION_MODES, benefit.aggregationMode) || !member(TIER_APPLICATION_MODES, benefit.applicationMode)) {
    errors.push(issue("INVALID_IDENTIFIER", "benefit.applicationMode", "Tier aggregation or application mode is invalid."));
  }
}

function validateEligibility(errors: OfferValidationError[], value: unknown): void {
  const eligibility = record(value);
  if (!eligibility) {
    errors.push(issue("INVALID_IDENTIFIER", "eligibility", "Eligibility contract is required."));
    return;
  }
  for (const field of Object.keys(eligibility)) {
    if (!["startAt", "endAt", "audienceType", "audienceUserIds"].includes(field)) {
      errors.push(issue("INVALID_IDENTIFIER", `eligibility.${field}`, "Field is not part of canonical Offer eligibility."));
    }
  }
  if (!member(OFFER_AUDIENCE_TYPES, eligibility.audienceType)) {
    errors.push(issue("INVALID_IDENTIFIER", "eligibility.audienceType", "A canonical representative audience is required."));
  }
  if (eligibility.audienceType === "SELECTED_SALES_REPRESENTATIVES") {
    const ids = eligibility.audienceUserIds;
    let validIds = Array.isArray(ids) && ids.length > 0;
    if (Array.isArray(ids)) {
      for (let index = 0; index < ids.length; index++) {
        if (!Object.prototype.hasOwnProperty.call(ids, index) || !exactCanonicalId(ids[index])) {
          validIds = false;
          break;
        }
      }
    }
    if (!Array.isArray(ids) || !validIds || new Set(ids).size !== ids.length) {
      errors.push(issue("INVALID_IDENTIFIER", "eligibility.audienceUserIds", "Selected representatives require non-empty, unique exact canonical user IDs."));
    }
  } else if ("audienceUserIds" in eligibility) {
    errors.push(issue("INVALID_IDENTIFIER", "eligibility.audienceUserIds", "Selected user IDs are only allowed for the selected-representatives audience."));
  }
  if (!timestamp(eligibility.startAt) || !timestamp(eligibility.endAt) || Date.parse(String(eligibility.endAt)) < Date.parse(String(eligibility.startAt))) {
    errors.push(issue("INVALID_DATE_RANGE", "eligibility", "Eligibility requires valid timestamps with endAt not before startAt."));
  }
}

function validateMakerContracts(errors: OfferValidationError[], value: DataRecord): void {
  if (value.makerIds === undefined && value.makerAudit === undefined) return;
  if (!Array.isArray(value.makerIds) || value.makerIds.length === 0 || value.makerIds.some(id => !exactCanonicalId(id)) || new Set(value.makerIds).size !== value.makerIds.length) {
    errors.push(issue("INVALID_IDENTIFIER", "makerIds", "Maker IDs must be unique exact canonical actor IDs."));
  }
  if (!Array.isArray(value.makerAudit) || value.makerAudit.length === 0) {
    errors.push(issue("INVALID_IDENTIFIER", "makerAudit", "Immutable maker audit identities are required when maker history is present."));
    return;
  }
  let previousRevision = 0;
  value.makerAudit.forEach((candidate, index) => {
    const event = record(candidate);
    if (!event || !exactCanonicalId(event.actorId) || !(OFFER_MAKER_ACTIONS as readonly unknown[]).includes(event.action) || !exactTimestamp(event.occurredAt) || !safePositiveInteger(event.revision) || Number(event.revision) < previousRevision) {
      errors.push(issue("INVALID_IDENTIFIER", `makerAudit.${index}`, "Maker audit identity must contain an exact actor, action, timestamp, and ordered revision."));
      return;
    }
    previousRevision = Number(event.revision);
    if (Array.isArray(value.makerIds) && !value.makerIds.includes(event.actorId)) errors.push(issue("INVALID_IDENTIFIER", `makerAudit.${index}.actorId`, "Every maker audit actor must belong to makerIds."));
  });
  const events = value.makerAudit.map(record).filter((event): event is DataRecord => event !== null);
  if (events[0]?.action !== "CREATE" || events[0]?.actorId !== value.createdBy || events[0]?.revision !== 1) errors.push(issue("INVALID_IDENTIFIER", "makerAudit.0", "Maker history must begin with the immutable creator identity at revision 1."));
  if (Array.isArray(value.makerIds) && events.length > 0) {
    const auditedActors = new Set(events.map(event => event.actorId));
    if (value.makerIds.some(id => !auditedActors.has(id)) || auditedActors.size !== value.makerIds.length) errors.push(issue("INVALID_IDENTIFIER", "makerIds", "Maker IDs must exactly match immutable maker audit actors."));
  }
  if (exactCanonicalId(value.submittedBy) && !events.some(event => event.action === "SUBMIT" && event.actorId === value.submittedBy)) errors.push(issue("INVALID_IDENTIFIER", "makerAudit", "Submitter must have an immutable submit maker event."));
  if (Array.isArray(value.makerIds) && exactCanonicalId(value.createdBy) && !value.makerIds.includes(value.createdBy)) errors.push(issue("INVALID_IDENTIFIER", "makerIds", "Creator must belong to the maker set."));
  if (exactCanonicalId(value.submittedBy) && Array.isArray(value.makerIds) && !value.makerIds.includes(value.submittedBy)) errors.push(issue("INVALID_IDENTIFIER", "makerIds", "Submitter must belong to the maker set."));
}

function validateStacking(errors: OfferValidationError[], value: unknown): void {
  const stacking = record(value);
  const compatible = ["PRODUCT_PERCENTAGE_WITH_INVOICE_PERCENTAGE", "BUY_X_GET_Y_WITH_INVOICE_PERCENTAGE", "TIER_BONUS_WITH_INVOICE_PERCENTAGE"];
  if (!stacking || (stacking.mode !== "NO_STACKING" && stacking.mode !== "EXPLICIT_COMPATIBILITY") || !Number.isSafeInteger(stacking.priority) || Number(stacking.priority) < 0 || stacking.maximumProductOrQuantityOffersPerPaidLine !== 1 || stacking.maximumInvoicePercentageOffersPerInvoice !== 1 || (stacking.mode === "EXPLICIT_COMPATIBILITY" && !compatible.includes(String(stacking.compatibleCombination)))) {
    errors.push(issue("INVALID_STACKING_POLICY", "stackingPolicy", "Stacking policy must use canonical limits, priority, and a known compatibility combination."));
  }
}

export function validateCanonicalOfferDefinition(input: unknown): OfferValidationResult<CanonicalOfferDefinition> {
  const errors: OfferValidationError[] = [];
  const value = record(input);
  if (!value) return { valid: false, errors: [issue("INVALID_IDENTIFIER", "offer", "Offer definition must be an object.")] };
  if (value.schemaVersion !== CANONICAL_OFFER_SCHEMA_VERSION) errors.push(issue("UNSUPPORTED_SCHEMA_VERSION", "schemaVersion", "Unknown schema versions fail closed operationally."));
  if (!member(CANONICAL_OFFER_TYPES, value.type)) errors.push(issue("UNSUPPORTED_TYPE", "type", "Offer type is not supported for operational use."));
  if (!member(OFFER_LIFECYCLE_STATUSES, value.lifecycleStatus)) errors.push(issue("INVALID_IDENTIFIER", "lifecycleStatus", "Lifecycle status is invalid."));
  ["id", "code", "name", "createdBy", "updatedBy"].forEach(path => validateIdentifier(errors, value[path], path));
  ["schemaVersion", "offerVersion", "revision"].forEach(path => {
    if (!safePositiveInteger(value[path])) errors.push(issue("UNSAFE_NUMERIC_VALUE", path, `${path} must be a positive safe integer.`));
  });
  if (!timestamp(value.createdAt) || !timestamp(value.updatedAt)) errors.push(issue("INVALID_DATE_RANGE", "auditTimestamps", "Created and updated timestamps must be valid."));
  validateMakerContracts(errors, value);
  validateProductScope(errors, value.productScope);
  validateBenefit(errors, value.type, value.benefit);
  validateEligibility(errors, value.eligibility);
  if ("commercialContext" in value) errors.push(issue("INVALID_IDENTIFIER", "commercialContext", "Commercial context is not part of the canonical Offer contract."));
  validateStacking(errors, value.stackingPolicy);
  if (value.usageLimits !== undefined) {
    const limits = record(value.usageLimits);
    if (!limits || Object.values(limits).some(limit => !safePositiveInteger(limit))) {
      errors.push(issue("UNSAFE_NUMERIC_VALUE", "usageLimits", "Usage limits must be positive safe integers."));
    }
  }
  if (value.previousVersionId !== undefined) validateIdentifier(errors, value.previousVersionId, "previousVersionId");
  if (value.lifecycleStatus === "CANCELLED") {
    if (!nonBlank(value.cancelledBy) || !timestamp(value.cancelledAt) || !nonBlank(value.cancellationReason)) {
      errors.push(issue("CANCELLATION_METADATA_REQUIRED", "cancellation", "Cancellation requires actor, timestamp, and reason."));
    }
  }
  return errors.length ? { valid: false, errors } : { valid: true, value: value as unknown as CanonicalOfferDefinition, errors: [] };
}

export function adaptLegacyOfferForReadOnlyPresentation(input: unknown): OfferValidationResult<LegacyOfferPresentation> {
  const value = record(input);
  if (!value) return { valid: false, errors: [issue("INVALID_IDENTIFIER", "legacyOffer", "Legacy Offer must be an object.")] };
  const id = nonBlank(value.id) ? value.id.trim() : "";
  const name = nonBlank(value.name) ? value.name.trim() : "Legacy Offer";
  const legacyTypeLabel = nonBlank(value.type) ? value.type.trim() : "Unknown Legacy Offer Type";
  if (!id) return { valid: false, errors: [issue("INVALID_IDENTIFIER", "id", "Legacy Offer ID is required for read-only presentation.")] };
  return {
    valid: true,
    value: { id, name, legacyTypeLabel, status: "READ_ONLY_LEGACY", operationallyApplicable: false, canEdit: false, canDelete: false, canActivate: false },
    errors: [],
  };
}
