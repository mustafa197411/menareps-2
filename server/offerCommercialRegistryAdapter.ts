import { deterministicCompanyMarketId, type CompanyMarketAssignment } from "../src/lib/commercialRegistry";
import type { CommercialMarketRegistryRepository } from "./commercialMarketRegistryRepository";
import {
  classifyMarketResolution,
  resolveCommercialMarketRegistry,
  type CanonicalCommercialScope,
  type CommercialRegistryResolution,
  type ResolvedCommercialRegistry,
} from "./commercialMarketRegistryResolver";

export type OfferCommercialRegistryErrorCode =
  | "OFFER_COMMERCIAL_SCOPE_INVALID"
  | "OFFER_COMMERCIAL_CONFIGURATION_INVALID"
  | "OFFER_COMMERCIAL_MARKET_REQUIRED"
  | "OFFER_COMMERCIAL_MARKET_SELECTION_REQUIRED"
  | "OFFER_COMMERCIAL_SELECTION_MISMATCH"
  | "OFFER_COMMERCIAL_PRODUCT_UNAVAILABLE"
  | "OFFER_COMMERCIAL_PRODUCT_UNAUTHORIZED";

export class OfferCommercialRegistryError extends Error {
  constructor(public readonly code: OfferCommercialRegistryErrorCode, public readonly status: number) {
    super(code);
    this.name = "OfferCommercialRegistryError";
  }
}

export interface OfferCommercialActorScope {
  global: boolean;
  companyIds: readonly string[];
  countryIds: readonly string[];
  marketIds: readonly string[];
  productIds: readonly string[];
}

export interface OfferCommercialRegistryDependencies {
  repository: CommercialMarketRegistryRepository;
  resolver: (scope: CanonicalCommercialScope, repository: CommercialMarketRegistryRepository) => Promise<CommercialRegistryResolution>;
  clock: () => string;
}

export interface OfferCommercialOptions {
  state: "ZERO" | "ONE" | "MULTIPLE";
  relationships: Array<{
    companyMarketId: string;
    companyId: string;
    marketId: string;
    countryId: string;
    companyName: string;
    marketName: string;
    countryName: string;
    currencyCode: string;
    products: Array<{ productId: string; name: string }>;
  }>;
}

export function createOfferCommercialRegistryDependencies(
  repository: CommercialMarketRegistryRepository,
  clock: () => string = () => new Date().toISOString(),
): OfferCommercialRegistryDependencies {
  return { repository, resolver: resolveCommercialMarketRegistry, clock };
}

export type CommercialProductSelection = Pick<CompanyMarketAssignment, "companyMarketId"> & {
  productIds: readonly string[];
};

function scopeFor(actor: OfferCommercialActorScope, effectiveAt: string): CanonicalCommercialScope {
  return {
    global: actor.global,
    authorizedCompanyIds: actor.global ? [] : [...actor.companyIds],
    authorizedCountryIds: actor.global ? [] : [...actor.countryIds],
    authorizedProductIds: actor.global ? [] : [...actor.productIds],
    productScopeRequired: !actor.global && actor.productIds.length > 0,
    effectiveAt,
  };
}

function failResolution(result: Exclude<CommercialRegistryResolution, { ok: true }>): never {
  if (result.code === "COMMERCIAL_SCOPE_INVALID") throw new OfferCommercialRegistryError("OFFER_COMMERCIAL_SCOPE_INVALID", 403);
  throw new OfferCommercialRegistryError("OFFER_COMMERCIAL_CONFIGURATION_INVALID", 409);
}

async function authorizedRegistry(actor: OfferCommercialActorScope, dependencies: OfferCommercialRegistryDependencies, effectiveAt: string) {
  const result = await dependencies.resolver(scopeFor(actor, effectiveAt), dependencies.repository);
  if (result.ok === false) failResolution(result);
  const markets = actor.global || actor.marketIds.length === 0
    ? result.value.markets
    : result.value.markets.filter(value => actor.marketIds.includes(value.marketId));
  return { registry: result.value, markets };
}

export async function resolveOfferCommercialOptions(
  actor: OfferCommercialActorScope,
  dependencies: OfferCommercialRegistryDependencies,
  effectiveAt = dependencies.clock(),
): Promise<OfferCommercialOptions> {
  const { registry, markets } = await authorizedRegistry(actor, dependencies, effectiveAt);
  return {
    state: classifyMarketResolution(markets),
    relationships: markets.map(market => ({
      companyMarketId: deterministicCompanyMarketId(market.companyId, market.marketId),
      companyId: market.companyId,
      marketId: market.marketId,
      countryId: market.countryId,
      companyName: registry.companies.find(value => value.companyId === market.companyId)!.name,
      marketName: market.nameEn,
      countryName: registry.countries.find(value => value.countryId === market.countryId)!.nameEn,
      currencyCode: market.currencyCode,
      products: registry.products
        .filter(value => value.companyId === market.companyId && value.marketId === market.marketId)
        .map(value => ({ productId: value.productId, name: value.name })),
    })),
  };
}

/** Commercial configuration only. Catalog prices are not Offer/order price authority. */
export async function resolveOfferCommercialContext(
  actor: OfferCommercialActorScope,
  selection: CommercialProductSelection,
  dependencies: OfferCommercialRegistryDependencies,
  effectiveAt = dependencies.clock(),
): Promise<{
  companyMarketId: string;
  market: ResolvedCommercialRegistry["markets"][number];
  productConfigurations: ResolvedCommercialRegistry["products"];
  resolvedAt: string;
}> {
  const { registry, markets: authorizedMarkets } = await authorizedRegistry(actor, dependencies, effectiveAt);
  const state = classifyMarketResolution(authorizedMarkets);
  if (state === "ZERO") throw new OfferCommercialRegistryError("OFFER_COMMERCIAL_MARKET_REQUIRED", 409);

  if (!selection || typeof selection !== "object" || Array.isArray(selection)
    || Object.keys(selection).some(key => !["companyMarketId", "productIds"].includes(key))) {
    throw new OfferCommercialRegistryError("OFFER_COMMERCIAL_SELECTION_MISMATCH", 422);
  }
  const selected = authorizedMarkets.filter(value => deterministicCompanyMarketId(value.companyId, value.marketId) === selection.companyMarketId);
  if (selected.length !== 1) {
    throw new OfferCommercialRegistryError(state === "MULTIPLE" ? "OFFER_COMMERCIAL_MARKET_SELECTION_REQUIRED" : "OFFER_COMMERCIAL_SELECTION_MISMATCH", 422);
  }
  const market = selected[0];
  const companyMarketId = deterministicCompanyMarketId(market.companyId, market.marketId);
  if (!Array.isArray(selection.productIds) || selection.productIds.some(id => typeof id !== "string" || !id || id !== id.trim() || id.includes("/"))
    || new Set(selection.productIds).size !== selection.productIds.length) {
    throw new OfferCommercialRegistryError("OFFER_COMMERCIAL_SELECTION_MISMATCH", 422);
  }
  const requestedProductIds = selection.productIds;
  const products = requestedProductIds.map(productId => registry.products.find(value => value.productId === productId && value.companyId === market.companyId && value.marketId === market.marketId));
  if (products.some(value => !value)) {
    const authorizedElsewhere = requestedProductIds.some(productId => registry.products.some(value => value.productId === productId));
    throw new OfferCommercialRegistryError(authorizedElsewhere ? "OFFER_COMMERCIAL_PRODUCT_UNAVAILABLE" : "OFFER_COMMERCIAL_PRODUCT_UNAUTHORIZED", 422);
  }
  return {
    companyMarketId,
    market,
    productConfigurations: products.map(value => ({ ...value! })),
    resolvedAt: effectiveAt,
  };
}
