import {
  CANONICAL_OFFER_TYPES,
  DEFAULT_OFFER_AGGREGATION_MODE,
  OFFER_POLICY_ROLES,
  type BuyXGetYBenefit,
  type CanonicalOfferDefinition,
  type OfferAggregationMode,
  type OfferLifecycleStatus,
  type OfferValidationError,
  type OfferValidationResult,
  type TierBonusTier,
} from "./types";

const TRANSITIONS: Readonly<Record<OfferLifecycleStatus, readonly OfferLifecycleStatus[]>> = {
  DRAFT: ["PENDING_APPROVAL"],
  PENDING_APPROVAL: ["DRAFT", "SCHEDULED", "ACTIVE"],
  SCHEDULED: ["ACTIVE", "CANCELLED"],
  ACTIVE: ["PAUSED", "CANCELLED", "EXPIRED"],
  PAUSED: ["ACTIVE", "CANCELLED", "EXPIRED"],
  EXPIRED: [],
  CANCELLED: [],
};

export function isScheduledOfferDueForActivation(
  offer: Pick<CanonicalOfferDefinition, "lifecycleStatus" | "eligibility">,
  evaluationAt: string,
): boolean {
  const at = Date.parse(evaluationAt);
  const start = Date.parse(offer.eligibility.startAt);
  const end = Date.parse(offer.eligibility.endAt);
  return offer.lifecycleStatus === "SCHEDULED" && Number.isFinite(at) && Number.isFinite(start) && Number.isFinite(end) && at >= start && at <= end;
}

export const OFFER_LIFECYCLE_TRANSITIONS = TRANSITIONS;

const policyError = (code: OfferValidationError["code"], path: string, message: string): OfferValidationResult<never> => ({
  valid: false,
  errors: [{ code, path, message }],
});

export function evaluateLifecycleTransition(
  from: OfferLifecycleStatus,
  to: OfferLifecycleStatus,
): OfferValidationResult<{ from: OfferLifecycleStatus; to: OfferLifecycleStatus }> {
  return TRANSITIONS[from].includes(to)
    ? { valid: true, value: { from, to }, errors: [] }
    : policyError("INVALID_LIFECYCLE_TRANSITION", "lifecycleStatus", `${from} cannot transition to ${to}.`);
}

export function evaluateApprovalSeparation(
  creatorId: string,
  approverId: string,
): OfferValidationResult<{ separated: true }> {
  if (!creatorId.trim() || !approverId.trim()) return policyError("INVALID_IDENTIFIER", "actor", "Creator and approver IDs are required.");
  if (creatorId.trim() === approverId.trim()) return policyError("CREATOR_APPROVER_CONFLICT", "approvedBy", "A creator cannot approve or activate their own offer.");
  return { valid: true, value: { separated: true }, errors: [] };
}

export function evaluateMakerSeparation(
  makerIds: readonly string[],
  approverId: string,
): OfferValidationResult<{ separated: true }> {
  if (!approverId.trim() || makerIds.length === 0 || makerIds.some(id => !id.trim())) return policyError("INVALID_IDENTIFIER", "makerIds", "Complete maker and approver identities are required.");
  if (makerIds.includes(approverId)) return policyError("CREATOR_APPROVER_CONFLICT", "approvedBy", "A maker cannot approve or activate their offer.");
  return { valid: true, value: { separated: true }, errors: [] };
}

export function evaluateActiveCommercialEdit(
  current: CanonicalOfferDefinition,
  proposed: CanonicalOfferDefinition,
): OfferValidationResult<{ requiresNewVersion: boolean }> {
  const commercialChanged = JSON.stringify({
    type: current.type,
    productScope: current.productScope,
    benefit: current.benefit,
    eligibility: current.eligibility,
    stackingPolicy: current.stackingPolicy,
    usageLimits: current.usageLimits,
  }) !== JSON.stringify({
    type: proposed.type,
    productScope: proposed.productScope,
    benefit: proposed.benefit,
    eligibility: proposed.eligibility,
    stackingPolicy: proposed.stackingPolicy,
    usageLimits: proposed.usageLimits,
  });
  if (current.lifecycleStatus === "ACTIVE" && commercialChanged && proposed.offerVersion <= current.offerVersion) {
    return policyError("ACTIVE_EDIT_REQUIRES_NEW_VERSION", "offerVersion", "Active commercial fields require a new offer version.");
  }
  return { valid: true, value: { requiresNewVersion: current.lifecycleStatus === "ACTIVE" && commercialChanged }, errors: [] };
}

export function defaultBuyXGetYPolicy(input: Omit<BuyXGetYBenefit, "aggregationMode" | "multiples" | "remainder"> & {
  aggregationMode?: OfferAggregationMode;
}): BuyXGetYBenefit {
  return {
    ...input,
    aggregationMode: input.aggregationMode ?? DEFAULT_OFFER_AGGREGATION_MODE,
    multiples: "REPEAT_COMPLETE_MULTIPLES",
    remainder: "NO_REWARD_BELOW_THRESHOLD",
  };
}

export function evaluateRepeatingGreedyTierBonus(paidQuantity: number, tiers: readonly TierBonusTier[]): number {
  if (!Number.isSafeInteger(paidQuantity) || paidQuantity < 0) return 0;
  if (tiers.length < 1 || tiers.length > 5) return 0;
  if (tiers.some(tier => !Number.isSafeInteger(tier.buyQuantity) || tier.buyQuantity <= 0 || !Number.isSafeInteger(tier.freeQuantity) || tier.freeQuantity <= 0)) return 0;
  const thresholds = tiers.map(tier => tier.buyQuantity);
  if (new Set(thresholds).size !== thresholds.length || thresholds.some((value, index) => index > 0 && value <= thresholds[index - 1])) return 0;
  let remainder = paidQuantity;
  let reward = 0;
  for (const tier of [...tiers].reverse()) {
    const multiples = Math.floor(remainder / tier.buyQuantity);
    reward += multiples * tier.freeQuantity;
    remainder -= multiples * tier.buyQuantity;
  }
  return Number.isSafeInteger(reward) ? reward : 0;
}

export function isApprovedOfferCreatorRole(role: string): boolean {
  return (OFFER_POLICY_ROLES.creators as readonly string[]).includes(role);
}

export function isApprovedOfferApproverRole(role: string): boolean {
  return (OFFER_POLICY_ROLES.approvers as readonly string[]).includes(role);
}

export function isCanonicalOperationalOfferType(value: string): boolean {
  return (CANONICAL_OFFER_TYPES as readonly string[]).includes(value);
}

export const OFFER_HISTORICAL_POLICY = {
  completedSnapshots: "IMMUTABLE",
  activeCommercialChanges: "NEW_VERSION_REQUIRED",
  historicalVersions: "NO_OVERWRITE_OR_DELETE",
  unknownSchemaOperationalBehavior: "FAIL_CLOSED",
  unknownSchemaPresentationBehavior: "READ_ONLY_LEGACY",
  cancellationNewSelection: "BLOCKED",
  cancellationIncompleteCompletion: "BLOCKED",
  cancellationHistoricalSnapshots: "UNCHANGED",
} as const;
