import type { OfferDraftDefinitionInput, OfferMutationCommand } from "./offerAdministrationService";

type DataRecord = Record<string, unknown>;
const record = (value: unknown): DataRecord | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as DataRecord : null;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const exactId = (value: unknown): value is string => typeof value === "string" && value === value.trim() && ID.test(value);
const exactKeys = (value: DataRecord, allowed: readonly string[]): boolean => Object.keys(value).every(key => allowed.includes(key));
const idArray = (value: unknown): boolean => Array.isArray(value) && value.every(exactId) && new Set(value).size === value.length;

function validReward(value: unknown): boolean {
  const reward = record(value);
  return Boolean(reward && exactKeys(reward, ["mode", "rewardProductId"]) &&
    (reward.mode === "SAME_AS_TRIGGER" ? !("rewardProductId" in reward) : reward.mode === "SELECTED_PRODUCT" && exactId(reward.rewardProductId)));
}

function validBenefit(value: unknown): boolean {
  const benefit = record(value);
  if (!benefit || typeof benefit.kind !== "string") return false;
  if (benefit.kind === "PRODUCT_PERCENTAGE") return exactKeys(benefit, ["kind", "percentage", "base"]);
  if (benefit.kind === "INVOICE_PERCENTAGE") return exactKeys(benefit, ["kind", "percentage", "base", "excludesFreeLines", "excludesProductsOutsideScope"]);
  if (benefit.kind === "BUY_X_GET_Y") return exactKeys(benefit, ["kind", "buyQuantity", "freeQuantity", "reward", "aggregationMode", "multiples", "remainder"]) && validReward(benefit.reward);
  if (benefit.kind !== "TIER_BONUS" || !exactKeys(benefit, ["kind", "tiers", "reward", "aggregationMode", "applicationMode"]) || !validReward(benefit.reward) || !Array.isArray(benefit.tiers)) return false;
  return benefit.tiers.every(value => { const tier = record(value); return Boolean(tier && exactKeys(tier, ["buyQuantity", "freeQuantity"])); });
}

function validEligibility(value: unknown): boolean {
  const eligibility = record(value);
  if (!eligibility || !exactKeys(eligibility, ["audienceType", "audienceUserIds", "startAt", "endAt"])) return false;
  if (eligibility.audienceType === "SELECTED_SALES_REPRESENTATIVES") {
    if (!Array.isArray(eligibility.audienceUserIds) || !eligibility.audienceUserIds.length) return false;
    for (let i = 0; i < eligibility.audienceUserIds.length; i++) {
      if (!Object.prototype.hasOwnProperty.call(eligibility.audienceUserIds, i) || !exactId(eligibility.audienceUserIds[i])) return false;
    }
    return new Set(eligibility.audienceUserIds).size === eligibility.audienceUserIds.length;
  }
  return ["ALL_SALES_REPRESENTATIVES", "MY_SALES_TEAM"].includes(String(eligibility.audienceType)) && !("audienceUserIds" in eligibility);
}

export interface OfferListControls { pageSize: number; cursor?: { createdAt: string; documentId: string } }
export function parseOfferListRequest(value: unknown): OfferListControls | null {
  const input = record(value);
  if (!input || !exactKeys(input, ["pageSize", "continuation"])) return null;
  const raw = input.pageSize;
  if (raw !== undefined && typeof raw !== "number" && (typeof raw !== "string" || !/^[1-9][0-9]*$/.test(raw))) return null;
  const pageSize = raw === undefined ? 25 : Number(raw);
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 50) return null;
  if (input.continuation === undefined) return { pageSize };
  const token = input.continuation;
  if (typeof token !== "string" || !token.length || token.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  try {
    const decoded = Buffer.from(token, "base64url");
    if (decoded.toString("base64url") !== token) return null;
    const cursor = record(JSON.parse(decoded.toString("utf8")));
    if (!cursor || !exactKeys(cursor, ["createdAt", "documentId"]) || !exactId(cursor.documentId) || typeof cursor.createdAt !== "string" || !Number.isFinite(Date.parse(cursor.createdAt)) || new Date(cursor.createdAt).toISOString() !== cursor.createdAt) return null;
    return { pageSize, cursor: { createdAt: cursor.createdAt, documentId: cursor.documentId } };
  } catch { return null; }
}

export function parseOfferRepresentativeRequest(value: unknown): { offerId?: string; pageSize?: number; continuationToken?: string } | null {
  const input = record(value);
  if (!input || !exactKeys(input, ["offerId", "pageSize", "continuationToken"])) return null;
  if (input.offerId !== undefined && !exactId(input.offerId)) return null;
  if (input.pageSize !== undefined && (!Number.isInteger(input.pageSize) || Number(input.pageSize) < 1 || Number(input.pageSize) > 100)) return null;
  if (input.continuationToken !== undefined && !exactId(input.continuationToken)) return null;
  return input;
}

export function parseOfferProductRequest(value: unknown): { continuation?: string; offerId?: string } | null {
  const input = record(value);
  if (!input || !exactKeys(input, ["continuation", "offerId"]) || (input.offerId !== undefined && !exactId(input.offerId)) || (input.continuation !== undefined && !exactId(input.continuation))) return null;
  return input;
}

export function parseOfferDraftRequest(value: unknown): OfferDraftDefinitionInput | null {
  const wrapper = record(value);
  const input = record(wrapper?.definition);
  if (!wrapper || !input || !exactKeys(wrapper, ["definition"]) || !exactKeys(input, ["code", "name", "nameAr", "description", "previousVersionId", "type", "productScope", "benefit", "eligibility", "stackingPolicy", "usageLimits"])) return null;
  const productScope = record(input.productScope), stacking = record(input.stackingPolicy), limits = input.usageLimits === undefined ? undefined : record(input.usageLimits);
  if (!productScope || !exactKeys(productScope, ["mode", "productIds"]) || !idArray(productScope.productIds)) return null;
  if (!validBenefit(input.benefit) || !validEligibility(input.eligibility)) return null;
  if (!stacking || !exactKeys(stacking, ["mode", "priority", "compatibleCombination", "maximumProductOrQuantityOffersPerPaidLine", "maximumInvoicePercentageOffersPerInvoice"])) return null;
  if (input.usageLimits !== undefined && !limits) return null;
  if (limits && !exactKeys(limits, ["perPharmacy", "campaignTotal"])) return null;
  return input as unknown as OfferDraftDefinitionInput;
}

export function parseOfferMutationRequest(value: unknown): OfferMutationCommand | null {
  const command = record(value);
  if (!command || !exactId(command.offerId) || !Number.isSafeInteger(command.expectedRevision)) return null;
  if (command.action === "UPDATE_DRAFT") {
    if (!exactKeys(command, ["action", "offerId", "expectedRevision", "definition"])) return null;
    const definition = parseOfferDraftRequest({ definition: command.definition });
    return definition ? { action: "UPDATE_DRAFT", offerId: command.offerId, expectedRevision: Number(command.expectedRevision), definition } : null;
  }
  if (command.action === "CANCEL") return exactKeys(command, ["action", "offerId", "expectedRevision", "reason"]) && typeof command.reason === "string"
    ? command as unknown as OfferMutationCommand : null;
  const actions = ["SUBMIT", "RETURN_TO_DRAFT", "APPROVE", "ACTIVATE", "PAUSE", "REACTIVATE"];
  return actions.includes(String(command.action)) && exactKeys(command, ["action", "offerId", "expectedRevision"])
    ? command as unknown as OfferMutationCommand : null;
}
