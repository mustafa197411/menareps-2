export const CANONICAL_OFFER_SCHEMA_VERSION = 1 as const;

export const CANONICAL_OFFER_TYPES = [
  "PRODUCT_PERCENTAGE",
  "INVOICE_PERCENTAGE",
  "BUY_X_GET_Y",
  "TIER_BONUS",
] as const;
export type CanonicalOfferType = (typeof CANONICAL_OFFER_TYPES)[number];

export const OFFER_LIFECYCLE_STATUSES = [
  "DRAFT",
  "PENDING_APPROVAL",
  "SCHEDULED",
  "ACTIVE",
  "PAUSED",
  "EXPIRED",
  "CANCELLED",
] as const;
export type OfferLifecycleStatus = (typeof OFFER_LIFECYCLE_STATUSES)[number];

export type ProductScope =
  | { mode: "ALL_PRODUCTS"; productIds: [] }
  | { mode: "SELECTED_PRODUCTS"; productIds: string[] };

export const OFFER_PRODUCT_IDENTITY = "FIRESTORE_PRODUCTS_DOCUMENT_ID" as const;
export const OFFER_STOCK_SOURCE = "products/{productId}.stockQuantity" as const;

export const OFFER_REWARD_MODES = ["SAME_AS_TRIGGER", "SELECTED_PRODUCT"] as const;
export type OfferRewardMode = (typeof OFFER_REWARD_MODES)[number];

export type OfferRewardConfiguration =
  | { mode: "SAME_AS_TRIGGER" }
  | { mode: "SELECTED_PRODUCT"; rewardProductId: string };

export const OFFER_AGGREGATION_MODES = ["PER_PRODUCT", "ACROSS_ELIGIBLE_PRODUCTS"] as const;
export type OfferAggregationMode = (typeof OFFER_AGGREGATION_MODES)[number];

export const DEFAULT_OFFER_AGGREGATION_MODE: OfferAggregationMode = "PER_PRODUCT";
export const TIER_APPLICATION_MODES = ["REPEATING_GREEDY_WITH_REMAINDER"] as const;
export type TierApplicationMode = (typeof TIER_APPLICATION_MODES)[number];

export interface ProductPercentageBenefit {
  kind: "PRODUCT_PERCENTAGE";
  percentage: number;
  base: "ELIGIBLE_PAID_PRODUCT_LINES";
}

export interface InvoicePercentageBenefit {
  kind: "INVOICE_PERCENTAGE";
  percentage: number;
  base: "PAID_ELIGIBLE_SUBTOTAL_AFTER_PRODUCT_DISCOUNTS_BEFORE_TAX";
  excludesFreeLines: true;
  excludesProductsOutsideScope: true;
}

export interface BuyXGetYBenefit {
  kind: "BUY_X_GET_Y";
  buyQuantity: number;
  freeQuantity: number;
  reward: OfferRewardConfiguration;
  aggregationMode: OfferAggregationMode;
  multiples: "REPEAT_COMPLETE_MULTIPLES";
  remainder: "NO_REWARD_BELOW_THRESHOLD";
}

export interface TierBonusTier {
  buyQuantity: number;
  freeQuantity: number;
}

export interface TierBonusBenefit {
  kind: "TIER_BONUS";
  tiers: TierBonusTier[];
  reward: OfferRewardConfiguration;
  aggregationMode: OfferAggregationMode;
  applicationMode: "REPEATING_GREEDY_WITH_REMAINDER";
}

export type CanonicalOfferBenefit =
  | ProductPercentageBenefit
  | InvoicePercentageBenefit
  | BuyXGetYBenefit
  | TierBonusBenefit;

export interface CanonicalGeographyPath {
  countryId: string;
  districtId: string;
  cityId: string;
  areaId: string;
}

export const OFFER_AUDIENCE_TYPES = [
  "ALL_SALES_REPRESENTATIVES",
  "MY_SALES_TEAM",
  "SELECTED_SALES_REPRESENTATIVES",
] as const;

export type CanonicalOfferAudience =
  | { audienceType: "ALL_SALES_REPRESENTATIVES" | "MY_SALES_TEAM"; audienceUserIds?: never }
  | { audienceType: "SELECTED_SALES_REPRESENTATIVES"; audienceUserIds: string[] };

export type CanonicalOfferEligibility = CanonicalOfferAudience & {
  startAt: string;
  endAt: string;
};

export const OFFER_MAKER_ACTIONS = ["CREATE", "EDIT", "SUBMIT"] as const;
export type OfferMakerAction = (typeof OFFER_MAKER_ACTIONS)[number];
export interface OfferMakerAuditIdentity {
  actorId: string;
  action: OfferMakerAction;
  occurredAt: string;
  revision: number;
}

export interface CanonicalOfferUsageLimits {
  perPharmacy?: number;
  campaignTotal?: number;
}

export type OfferCompatibility =
  | "PRODUCT_PERCENTAGE_WITH_INVOICE_PERCENTAGE"
  | "BUY_X_GET_Y_WITH_INVOICE_PERCENTAGE"
  | "TIER_BONUS_WITH_INVOICE_PERCENTAGE";

export type CanonicalOfferStackingPolicy =
  | {
      mode: "NO_STACKING";
      priority: number;
      maximumProductOrQuantityOffersPerPaidLine: 1;
      maximumInvoicePercentageOffersPerInvoice: 1;
    }
  | {
      mode: "EXPLICIT_COMPATIBILITY";
      priority: number;
      compatibleCombination: OfferCompatibility;
      maximumProductOrQuantityOffersPerPaidLine: 1;
      maximumInvoicePercentageOffersPerInvoice: 1;
    };

export const OFFER_STACKING_RESOLUTION_POLICY = {
  defaultMode: "NO_STACKING",
  productOrQuantityOffersPerPaidLine: 1,
  invoicePercentageOffersPerInvoice: 1,
  quantityConsumptionReuse: "FORBIDDEN",
  resolutionOrder: ["EXPLICIT_COMPATIBILITY", "PRIORITY_DESCENDING", "OFFER_ID_ASCENDING"],
} as const;

interface CanonicalOfferDefinitionBase {
  id: string;
  schemaVersion: number;
  offerVersion: number;
  code: string;
  name: string;
  nameAr?: string;
  description?: string;
  lifecycleStatus: OfferLifecycleStatus;
  productScope: ProductScope;
  eligibility: CanonicalOfferEligibility;
  stackingPolicy: CanonicalOfferStackingPolicy;
  usageLimits?: CanonicalOfferUsageLimits;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  makerIds?: string[];
  makerAudit?: OfferMakerAuditIdentity[];
  submittedAt?: string;
  submittedBy?: string;
  approvedAt?: string;
  approvedBy?: string;
  scheduledAt?: string;
  scheduledBy?: string;
  activatedAt?: string;
  activatedBy?: string;
  pausedAt?: string;
  pausedBy?: string;
  cancelledAt?: string;
  cancelledBy?: string;
  cancellationReason?: string;
  previousVersionId?: string;
  revision: number;
}

export type CanonicalOfferDefinition =
  | (CanonicalOfferDefinitionBase & { type: "PRODUCT_PERCENTAGE"; benefit: ProductPercentageBenefit })
  | (CanonicalOfferDefinitionBase & { type: "INVOICE_PERCENTAGE"; benefit: InvoicePercentageBenefit })
  | (CanonicalOfferDefinitionBase & { type: "BUY_X_GET_Y"; benefit: BuyXGetYBenefit })
  | (CanonicalOfferDefinitionBase & { type: "TIER_BONUS"; benefit: TierBonusBenefit });

export const OFFER_CAPABILITIES = [
  "offers.view",
  "offers.create",
  "offers.editDraft",
  "offers.submit",
  "offers.approve",
  "offers.activate",
  "offers.pause",
  "offers.cancel",
  "offers.viewAudit",
  "offers.applyDuringVisit",
] as const;
export type OfferCapability = (typeof OFFER_CAPABILITIES)[number];

export const OFFER_POLICY_ROLES = {
  creators: ["Super Admin", "Admin", "Sales & Marketing Manager", "Sales Manager"],
  approvers: ["Sales & Marketing Manager", "Country Manager", "Regional Manager", "General Manager", "Admin", "Super Admin"],
  visitUsers: ["Sales Representative"],
} as const;

export const OFFER_LINE_CLASSIFICATIONS = [
  "PAID_ORDER_LINE",
  "PROMOTIONAL_FREE_LINE",
  "PAID_GOODS_SHORTAGE",
  "PROMOTIONAL_FREE_GOODS_SHORTAGE",
] as const;
export type OfferLineClassification = (typeof OFFER_LINE_CLASSIFICATIONS)[number];

export const PROMOTIONAL_SHORTAGE_POLICY = {
  paidSaleWhenRewardUnavailable: "PRESERVE",
  earnedRewardReduction: "FORBIDDEN",
  defaultRewardShortageOutcome: "PROMOTIONAL_FREE_GOODS_SHORTAGE",
  overrideFulfillmentPolicy: "ALL_OR_NOTHING_WHEN_EXPLICITLY_CONFIGURED_LATER",
} as const;

export const OFFER_CURRENCY_SOURCE = "AUTHORITATIVE_ACTIVE_MARKET_CONFIGURATION" as const;
export const OFFER_ROUNDING_MODES = ["DECIMAL_HALF_UP", "DECIMAL_HALF_EVEN"] as const;
export type OfferRoundingMode = (typeof OFFER_ROUNDING_MODES)[number];
export const DEFAULT_OFFER_ROUNDING_MODE: OfferRoundingMode = "DECIMAL_HALF_UP";
export const OFFER_MONETARY_POLICY = {
  currencyFallback: "FORBIDDEN",
  decimalPlacesSource: "AUTHORITATIVE_ACTIVE_MARKET_CONFIGURATION",
  defaultRoundingMode: DEFAULT_OFFER_ROUNDING_MODE,
} as const;

export const OFFER_VERSIONING_POLICY = {
  newDefinition: { schemaVersion: CANONICAL_OFFER_SCHEMA_VERSION, offerVersion: 1, revision: 1 },
  draftAdministrativeEdit: "INCREMENT_REVISION",
  activeCommercialEdit: "CREATE_NEW_OFFER_VERSION",
  priorVersionLink: "previousVersionId",
  historicalVersionMutation: "FORBIDDEN",
  historicalVersionDeletion: "FORBIDDEN",
} as const;

export interface LegacyOfferPresentation {
  id: string;
  name: string;
  legacyTypeLabel: string;
  status: "READ_ONLY_LEGACY";
  operationallyApplicable: false;
  canEdit: false;
  canDelete: false;
  canActivate: false;
}

export const OFFER_VALIDATION_ERROR_CODES = [
  "UNSUPPORTED_TYPE",
  "UNSUPPORTED_SCHEMA_VERSION",
  "INVALID_PRODUCT_SCOPE",
  "EMPTY_SELECTED_PRODUCTS",
  "DUPLICATE_PRODUCT_IDS",
  "INVALID_PERCENTAGE",
  "INVALID_BUY_QUANTITY",
  "INVALID_FREE_QUANTITY",
  "INVALID_TIER_COUNT",
  "DUPLICATE_TIER_THRESHOLDS",
  "UNORDERED_TIER_THRESHOLDS",
  "MISSING_REWARD_PRODUCT",
  "FORBIDDEN_REWARD_PRODUCT",
  "INVALID_DATE_RANGE",
  "INVALID_LIFECYCLE_TRANSITION",
  "CREATOR_APPROVER_CONFLICT",
  "INVALID_STACKING_POLICY",
  "INVALID_IDENTIFIER",
  "UNSAFE_NUMERIC_VALUE",
  "CANCELLATION_METADATA_REQUIRED",
  "ACTIVE_EDIT_REQUIRES_NEW_VERSION",
  "INVALID_REWARD_AGGREGATION",
] as const;
export type OfferValidationErrorCode = (typeof OFFER_VALIDATION_ERROR_CODES)[number];

export interface OfferValidationError {
  code: OfferValidationErrorCode;
  path: string;
  message: string;
}

export type OfferValidationResult<T> =
  | { valid: true; value: T; errors: [] }
  | { valid: false; errors: OfferValidationError[] };
