import type { Product } from "../../types";
import {
  CANONICAL_OFFER_TYPES,
  DEFAULT_OFFER_AGGREGATION_MODE,
  type CanonicalOfferType,
  type CanonicalOfferDefinition,
  type OfferAggregationMode,
  type OfferRewardMode,
  type ProductScope as CanonicalProductScope,
} from "../../features/offers/types";

export const OFFER_TYPES = CANONICAL_OFFER_TYPES;
export type OfferAdminType = CanonicalOfferType;
export type ProductScope = CanonicalProductScope["mode"];
export interface OfferTier { buyQuantity: string; freeQuantity: string }

/** Browser-only administration preview. It is not a persisted CanonicalOfferDefinition. */
export interface OfferAdminRecord {
  id: string;
  prototypeBoundary?: "LOCAL_PREVIEW_ONLY";
  name: string;
  description: string;
  type: string;
  value?: string | number;
  percentage?: number;
  buyQuantity?: number;
  getQuantity?: number;
  rewardMode?: OfferRewardMode;
  rewardProductId?: string;
  aggregationMode?: OfferAggregationMode;
  tiers?: Array<{ buyQuantity: number; freeQuantity: number }>;
  tierApplicationMode?: "REPEATING_GREEDY_WITH_REMAINDER";
  productScope?: ProductScope;
  productId?: string;
  productIds?: string[];
  startDate: string;
  endDate: string;
  status?: boolean;
  isActive?: boolean;
  lifecycleStatus?: CanonicalOfferDefinition["lifecycleStatus"];
  revision?: number;
  canonical?: CanonicalOfferDefinition;
}

export interface OfferFormState {
  id?: string;
  code: string;
  name: string;
  description: string;
  type: OfferAdminType;
  productScope: ProductScope;
  productIds: string[];
  percentage: string;
  buyQuantity: string;
  freeQuantity: string;
  rewardMode: OfferRewardMode;
  rewardProductId: string;
  aggregationMode: OfferAggregationMode;
  tiers: OfferTier[];
  startDate: string;
  endDate: string;
  isActive: boolean;
  audienceType: "" | "ALL_SALES_REPRESENTATIVES" | "MY_SALES_TEAM" | "SELECTED_SALES_REPRESENTATIVES";
  audienceUserIds: string[];
}

export type OfferHydrationResult =
  | { editable: true; form: OfferFormState }
  | { editable: false; reason: "LEGACY_READ_ONLY"; legacyType: string };

export const isSupportedOfferType = (value: string): value is OfferAdminType =>
  (CANONICAL_OFFER_TYPES as readonly string[]).includes(value);

export const offerTypeLabel = (type: string) => ({
  PRODUCT_PERCENTAGE: "Product Percentage Discount",
  INVOICE_PERCENTAGE: "Total Invoice Percentage Discount",
  BUY_X_GET_Y: "Buy X Get Y",
  TIER_BONUS: "Tier Bonus",
  PERCENTAGE_DISCOUNT: "Product Percentage Discount",
  ORDER_VALUE_DISCOUNT: "Total Invoice Percentage Discount",
  TIERED_DISCOUNT: "Tier Bonus",
  "Percentage Discount": "Product Percentage Discount",
  "Fixed Discount": "Product Fixed Discount",
  FIXED_DISCOUNT: "Product Fixed Discount",
  PRODUCT_FIXED_DISCOUNT: "Product Fixed Discount",
  "Invoice Fixed Discount": "Invoice Fixed Discount",
  INVOICE_FIXED_DISCOUNT: "Invoice Fixed Discount",
  "Buy X Get Y Free": "Buy X Get Y",
  "Tiered Discount": "Tier Bonus",
}[type] || type || "Unknown Legacy Offer Type");

export const isLegacyOffer = (type: string) => !isSupportedOfferType(type);
export const canMutatePrototypeOffer = (offer: OfferAdminRecord) => isSupportedOfferType(offer.type);

export function defaultOfferForm(today = new Date()): OfferFormState {
  const start = today.toISOString().slice(0, 10);
  const end = new Date(today.getTime() + 30 * 86400000).toISOString().slice(0, 10);
  return { code: "", name: "", description: "", type: "PRODUCT_PERCENTAGE", productScope: "ALL_PRODUCTS", productIds: [], percentage: "", buyQuantity: "", freeQuantity: "", rewardMode: "SAME_AS_TRIGGER", rewardProductId: "", aggregationMode: DEFAULT_OFFER_AGGREGATION_MODE, tiers: [{ buyQuantity: "", freeQuantity: "" }], startDate: start, endDate: end, isActive: true, audienceType: "", audienceUserIds: [] };
}

export function hydrateOfferForm(offer: OfferAdminRecord): OfferHydrationResult {
  if (!isSupportedOfferType(offer.type)) return { editable: false, reason: "LEGACY_READ_ONLY", legacyType: offer.type };
  const ids = (offer.productIds?.length ? offer.productIds : offer.productId ? [offer.productId] : []).filter(id => typeof id === "string" && id.trim());
  const rewardMode = offer.rewardMode === "SELECTED_PRODUCT" ? "SELECTED_PRODUCT" : "SAME_AS_TRIGGER";
  return { editable: true, form: {
    id: offer.id, code: offer.canonical?.code || "", name: offer.name || "", description: offer.description || "", type: offer.type,
    productScope: offer.productScope || (ids.length ? "SELECTED_PRODUCTS" : "ALL_PRODUCTS"), productIds: ids,
    percentage: String(offer.percentage ?? ((offer.type === "PRODUCT_PERCENTAGE" || offer.type === "INVOICE_PERCENTAGE") ? offer.value ?? "" : "")),
    buyQuantity: String(offer.buyQuantity ?? ""), freeQuantity: String(offer.getQuantity ?? ""), rewardMode,
    rewardProductId: rewardMode === "SELECTED_PRODUCT" ? offer.rewardProductId || "" : "",
    aggregationMode: offer.aggregationMode || DEFAULT_OFFER_AGGREGATION_MODE,
    tiers: offer.tiers?.length ? offer.tiers.map(tier => ({ buyQuantity: String(tier.buyQuantity), freeQuantity: String(tier.freeQuantity) })) : [{ buyQuantity: "", freeQuantity: "" }],
    startDate: offer.startDate || "", endDate: offer.endDate || "", isActive: offer.isActive ?? offer.status ?? true,
    audienceType: offer.canonical?.eligibility.audienceType || "", audienceUserIds: offer.canonical?.eligibility.audienceUserIds ? [...offer.canonical.eligibility.audienceUserIds] : [],
  } };
}

const positiveSafeInteger = (value: string) => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`));

export function setRewardMode(form: OfferFormState, rewardMode: OfferRewardMode): OfferFormState {
  return { ...form, rewardMode, rewardProductId: rewardMode === "SAME_AS_TRIGGER" ? "" : form.rewardProductId };
}

export function validateOfferForm(form: OfferFormState): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!form.name.trim()) errors.name = "Offer name is required.";
  if (!form.code.trim()) errors.code = "Offer code is required.";
  if (!["ALL_SALES_REPRESENTATIVES", "MY_SALES_TEAM", "SELECTED_SALES_REPRESENTATIVES"].includes(form.audienceType)) errors.audience = "Choose who can use this Offer.";
  if (form.audienceType === "SELECTED_SALES_REPRESENTATIVES") {
    if (!form.audienceUserIds.length || Array.from(form.audienceUserIds).some(id => typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(id)) || new Set(form.audienceUserIds).size !== form.audienceUserIds.length) errors.audience = "Select valid, unique representatives.";
  } else if (form.audienceUserIds.length) errors.audience = "Selected representatives are only allowed in selected mode.";
  if (!isSupportedOfferType(form.type)) errors.type = "Select a supported canonical offer type.";
  const normalizedIds = form.productIds.map(id => id.trim());
  if (form.productScope === "SELECTED_PRODUCTS" && normalizedIds.length === 0) errors.products = "Select at least one product.";
  if (normalizedIds.some(id => !id) || new Set(normalizedIds).size !== normalizedIds.length) errors.products = "Product IDs must be non-blank and unique.";
  if (!validDate(form.startDate)) errors.startDate = "Enter a valid start date.";
  if (!validDate(form.endDate)) errors.endDate = "Enter a valid end date.";
  if (!errors.startDate && !errors.endDate && form.endDate < form.startDate) errors.endDate = "End date cannot be before start date.";
  if (form.type === "PRODUCT_PERCENTAGE" || form.type === "INVOICE_PERCENTAGE") {
    const value = Number(form.percentage);
    if (form.percentage.trim() === "" || !Number.isFinite(value) || value <= 0 || value > 100) errors.percentage = "Percentage must be greater than 0 and no greater than 100.";
  }
  if (form.type === "BUY_X_GET_Y") {
    if (!positiveSafeInteger(form.buyQuantity)) errors.buyQuantity = "Buy quantity must be a positive safe integer.";
    if (!positiveSafeInteger(form.freeQuantity)) errors.freeQuantity = "Free quantity must be a positive safe integer.";
  }
  if (form.type === "TIER_BONUS") {
    if (form.tiers.length < 1 || form.tiers.length > 5) errors.tiers = "Tier Bonus requires one to five tiers.";
    const buys: number[] = [];
    form.tiers.forEach((tier, index) => {
      if (!positiveSafeInteger(tier.buyQuantity) || !positiveSafeInteger(tier.freeQuantity)) errors[`tier-${index}`] = "Buy and free quantities must be positive safe integers.";
      buys.push(Number(tier.buyQuantity));
    });
    if (new Set(buys).size !== buys.length) errors.tiers = "Buy thresholds must be unique.";
    else if (buys.some((value, index) => index > 0 && value <= buys[index - 1])) errors.tiers = "Buy thresholds must be strictly increasing.";
  }
  if ((form.type === "BUY_X_GET_Y" || form.type === "TIER_BONUS") && form.rewardMode === "SELECTED_PRODUCT" && !form.rewardProductId.trim()) errors.rewardProductId = "Select a canonical reward product.";
  if (form.rewardMode === "SAME_AS_TRIGGER" && form.rewardProductId) errors.rewardProductId = "Same As Trigger cannot retain a reward product.";
  return errors;
}

export function canonicalDraftFromForm(form: OfferFormState) {
  const productScope = form.productScope === "ALL_PRODUCTS"
    ? { mode: "ALL_PRODUCTS" as const, productIds: [] as [] }
    : { mode: "SELECTED_PRODUCTS" as const, productIds: form.productIds.map(id => id.trim()) };
  const reward = form.rewardMode === "SAME_AS_TRIGGER"
    ? { mode: "SAME_AS_TRIGGER" as const }
    : { mode: "SELECTED_PRODUCT" as const, rewardProductId: form.rewardProductId.trim() };
  const benefit = form.type === "PRODUCT_PERCENTAGE"
    ? { kind: "PRODUCT_PERCENTAGE" as const, percentage: Number(form.percentage), base: "ELIGIBLE_PAID_PRODUCT_LINES" as const }
    : form.type === "INVOICE_PERCENTAGE"
      ? { kind: "INVOICE_PERCENTAGE" as const, percentage: Number(form.percentage), base: "PAID_ELIGIBLE_SUBTOTAL_AFTER_PRODUCT_DISCOUNTS_BEFORE_TAX" as const, excludesFreeLines: true as const, excludesProductsOutsideScope: true as const }
      : form.type === "BUY_X_GET_Y"
        ? { kind: "BUY_X_GET_Y" as const, buyQuantity: Number(form.buyQuantity), freeQuantity: Number(form.freeQuantity), reward, aggregationMode: form.aggregationMode, multiples: "REPEAT_COMPLETE_MULTIPLES" as const, remainder: "NO_REWARD_BELOW_THRESHOLD" as const }
        : { kind: "TIER_BONUS" as const, tiers: form.tiers.map(tier => ({ buyQuantity: Number(tier.buyQuantity), freeQuantity: Number(tier.freeQuantity) })), reward, aggregationMode: form.aggregationMode, applicationMode: "REPEATING_GREEDY_WITH_REMAINDER" as const };
  return {
    code: form.code.trim(), name: form.name.trim(), ...(form.description.trim() ? { description: form.description.trim() } : {}),
    type: form.type, productScope, benefit,
    eligibility: {
      audienceType: form.audienceType,
      ...(form.audienceType === "SELECTED_SALES_REPRESENTATIVES" ? { audienceUserIds: [...form.audienceUserIds] } : {}),
      startAt: `${form.startDate}T00:00:00.000Z`, endAt: `${form.endDate}T23:59:59.999Z`,
    },
    stackingPolicy: { mode: "NO_STACKING" as const, priority: 0, maximumProductOrQuantityOffersPerPaidLine: 1 as const, maximumInvoicePercentageOffersPerInvoice: 1 as const },
  };
}

export function serializeOfferForm(form: OfferFormState): OfferAdminRecord {
  const productIds = form.productScope === "SELECTED_PRODUCTS" ? form.productIds.map(id => id.trim()) : [];
  const common: OfferAdminRecord = {
    id: form.id || "UNPERSISTED_DRAFT", prototypeBoundary: "LOCAL_PREVIEW_ONLY", name: form.name.trim(), description: form.description.trim(), type: form.type,
    productScope: form.productScope, productIds, productId: productIds.length === 1 ? productIds[0] : undefined,
    startDate: form.startDate, endDate: form.endDate, status: form.isActive, isActive: form.isActive,
  };
  if (form.type === "PRODUCT_PERCENTAGE" || form.type === "INVOICE_PERCENTAGE") return { ...common, percentage: Number(form.percentage), value: Number(form.percentage) };
  const reward = { rewardMode: form.rewardMode, rewardProductId: form.rewardMode === "SELECTED_PRODUCT" ? form.rewardProductId.trim() : undefined, aggregationMode: form.aggregationMode };
  if (form.type === "BUY_X_GET_Y") return { ...common, ...reward, buyQuantity: Number(form.buyQuantity), getQuantity: Number(form.freeQuantity), value: `Buy ${form.buyQuantity} Get ${form.freeQuantity}` };
  return { ...common, ...reward, tiers: form.tiers.map(tier => ({ buyQuantity: Number(tier.buyQuantity), freeQuantity: Number(tier.freeQuantity) })), tierApplicationMode: "REPEATING_GREEDY_WITH_REMAINDER", value: `${form.tiers.length} tiers` };
}

export function resetIncompatibleFields(form: OfferFormState, type: OfferAdminType): OfferFormState {
  return { ...form, type, percentage: "", buyQuantity: "", freeQuantity: "", rewardMode: "SAME_AS_TRIGGER", rewardProductId: "", aggregationMode: DEFAULT_OFFER_AGGREGATION_MODE, tiers: [{ buyQuantity: "", freeQuantity: "" }] };
}

export const eligibleCommercialProducts = (products: Product[]) => products.filter(product =>
  product.isActive !== false && product.marketingStatus !== "Inactive" && product.isSample !== "Yes" && product.isSampleSku !== true && !/sample/i.test(product.productType || "")
);

export function offerSummary(offer: OfferAdminRecord): string {
  const count = offer.productIds?.length || (offer.productId ? 1 : 0);
  const scope = count ? `${count} selected product${count === 1 ? "" : "s"}` : "All Products";
  if (!isSupportedOfferType(offer.type)) return `Legacy offer — ${scope}`;
  if (offer.type === "PRODUCT_PERCENTAGE") return `${offer.percentage ?? offer.value}% discount on ${scope}`;
  if (offer.type === "INVOICE_PERCENTAGE") return `Invoice discount: ${offer.percentage ?? offer.value}% — ${scope}`;
  if (offer.type === "BUY_X_GET_Y") return `Buy ${offer.buyQuantity ?? "–"}, Get ${offer.getQuantity ?? "–"} — ${scope}`;
  return `Tier Bonus — ${offer.tiers?.length || 0} tiers — ${scope}`;
}
