import type { MarketBusinessSettings } from "../src/lib/marketSettings";
import {
  validateCommercialRegistry,
  type CanonicalCountryReference,
  type CanonicalProductReference,
  type CompanyMarketAssignment,
  type CompanyRecord,
  type ProductMarketCatalogEntry,
} from "../src/lib/commercialRegistry";
import {
  COMMERCIAL_REGISTRY_QUERY_LIMIT,
  FIRESTORE_IN_QUERY_LIMIT,
  type CommercialMarketRegistryRepository,
  type CommercialRegistryPage,
  type CommercialRegistryReadRequest,
} from "./commercialMarketRegistryRepository";

export interface CanonicalCommercialScope {
  global: boolean;
  authorizedCompanyIds: readonly string[];
  authorizedCountryIds: readonly string[];
  authorizedProductIds: readonly string[];
  productScopeRequired: boolean;
  effectiveAt: string;
}

export type MarketResolutionState = "ZERO" | "ONE" | "MULTIPLE";

export function classifyMarketResolution(
  relationships: ReadonlyArray<Pick<CompanyMarketAssignment, "companyId" | "marketId">>,
): MarketResolutionState {
  const relationshipKeys = new Set(relationships.map(value => `${value.companyId.length}:${value.companyId}:${value.marketId.length}:${value.marketId}`));
  return relationshipKeys.size === 0 ? "ZERO" : relationshipKeys.size === 1 ? "ONE" : "MULTIPLE";
}

export interface ResolvedCommercialRegistry {
  state: MarketResolutionState;
  companies: Array<{ companyId: string; name: string }>;
  countries: Array<{ countryId: string; nameEn: string; nameAr: string }>;
  markets: Array<{ marketId: string; companyId: string; countryId: string; nameEn: string; nameAr: string; currencyCode: string; currencySymbol: string; decimalPlaces: number }>;
  products: Array<{ productId: string; name: string; companyId: string; marketId: string; unitPrice: number; currencyCode: string }>;
  catalogConfigurations: Array<{ productId: string; companyId: string; marketId: string; unitPrice: number; active: boolean; saleable: boolean; effectiveFrom: string; catalogEntryId: string }>;
}

export type CommercialRegistryResolution =
  | { ok: true; value: ResolvedCommercialRegistry }
  | { ok: false; code: "COMMERCIAL_SCOPE_INVALID" | "COMMERCIAL_REGISTRY_INTEGRITY_ERROR"; details: string[] };

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const exactId = (value: unknown): value is string => typeof value === "string" && value === value.trim() && ID.test(value);
const exactTimestamp = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const unique = (values: readonly string[]): string[] => [...new Set(values)].sort((a, b) => a.localeCompare(b));
const chunks = (values: readonly string[]): string[][] => {
  const result: string[][] = [];
  for (let index = 0; index < values.length; index += FIRESTORE_IN_QUERY_LIMIT) result.push(values.slice(index, index + FIRESTORE_IN_QUERY_LIMIT));
  return result;
};
const effective = (record: { effectiveFrom: string; effectiveTo?: string }, at: number): boolean =>
  Date.parse(record.effectiveFrom) <= at && (!record.effectiveTo || Date.parse(record.effectiveTo) >= at);

async function allPages(
  reader: (request: CommercialRegistryReadRequest) => Promise<CommercialRegistryPage>,
  ids?: readonly string[],
): Promise<unknown[]> {
  const records: unknown[] = [];
  let cursor: string | undefined;
  do {
    const page = await reader({ ids, cursor, limit: COMMERCIAL_REGISTRY_QUERY_LIMIT });
    records.push(...page.records);
    cursor = page.nextCursor;
  } while (cursor);
  return records;
}

async function readChunked(
  reader: (request: CommercialRegistryReadRequest) => Promise<CommercialRegistryPage>,
  ids: readonly string[],
): Promise<unknown[]> {
  const records: unknown[] = [];
  for (const chunk of chunks(unique(ids))) records.push(...await allPages(reader, chunk));
  return records;
}

function scopeErrors(scope: CanonicalCommercialScope): string[] {
  const errors: string[] = [];
  if (typeof scope.global !== "boolean" || typeof scope.productScopeRequired !== "boolean" || !exactTimestamp(scope.effectiveAt)) errors.push("INVALID_SCOPE_METADATA");
  for (const [name, values] of [["companies", scope.authorizedCompanyIds], ["countries", scope.authorizedCountryIds], ["products", scope.authorizedProductIds]] as const) {
    if (!Array.isArray(values) || values.some(value => !exactId(value)) || unique(values).length !== values.length) errors.push(`INVALID_${name.toUpperCase()}_SCOPE`);
  }
  if (!scope.global && (scope.authorizedCompanyIds.length === 0 || scope.authorizedCountryIds.length === 0)) errors.push("EMPTY_SCOPED_BOUNDARY");
  if (!scope.global && scope.productScopeRequired && scope.authorizedProductIds.length === 0) errors.push("EMPTY_PRODUCT_SCOPE");
  return errors;
}

const productName = (product: CanonicalProductReference): string => {
  const candidate = (product as CanonicalProductReference & { name?: unknown }).name;
  return typeof candidate === "string" && candidate === candidate.trim() && candidate.length > 0 ? candidate : "";
};

export async function resolveCommercialMarketRegistry(
  scope: CanonicalCommercialScope,
  repository: CommercialMarketRegistryRepository,
): Promise<CommercialRegistryResolution> {
  const invalidScope = scopeErrors(scope);
  if (invalidScope.length) return { ok: false, code: "COMMERCIAL_SCOPE_INVALID", details: invalidScope };
  try {
    const rawRelationships = scope.global
      ? await allPages(repository.readCompanyMarkets)
      : await readChunked(repository.readCompanyMarkets, scope.authorizedCompanyIds);
    const relationshipRefs = rawRelationships as CompanyMarketAssignment[];
    const companyIds = unique([...relationshipRefs.map(value => value.companyId), ...scope.authorizedCompanyIds]);
    const marketIds = unique(relationshipRefs.map(value => value.marketId));
    const [companies, markets] = await Promise.all([
      readChunked(repository.readCompanies, companyIds),
      readChunked(repository.readMarkets, marketIds),
    ]);
    const marketRefs = markets as MarketBusinessSettings[];
    const countryIds = unique([...marketRefs.map(value => value.countryId), ...scope.authorizedCountryIds]);
    const relationshipIds = unique(relationshipRefs.map(value => value.companyMarketId));
    const [countries, catalog] = await Promise.all([
      readChunked(repository.readCountries, countryIds),
      readChunked(repository.readProductMarketCatalog, relationshipIds),
    ]);
    const catalogRefs = catalog as ProductMarketCatalogEntry[];
    const scopedCatalogRefs = scope.productScopeRequired ? catalogRefs.filter(value => scope.authorizedProductIds.includes(value.productId)) : catalogRefs;
    const productIds = unique([...scopedCatalogRefs.map(value => value.productId), ...scope.authorizedProductIds]);
    const products = await readChunked(repository.readProducts, productIds);
    const validation = validateCommercialRegistry({ companies, markets, companyMarkets: rawRelationships, productMarketCatalog: scopedCatalogRefs, countries, products });
    const missingScope = [
      ...scope.authorizedCompanyIds.filter(id => !(companies as CompanyRecord[]).some(value => value.companyId === id && value.active)),
      ...scope.authorizedCountryIds.filter(id => !(countries as CanonicalCountryReference[]).some(value => value.countryId === id && value.active)),
      ...(scope.productScopeRequired ? scope.authorizedProductIds.filter(id => !(products as CanonicalProductReference[]).some(value => value.productId === id && value.active)) : []),
    ];
    const unnamedProducts = (products as CanonicalProductReference[]).filter(value => !productName(value)).map(value => value.productId);
    if (!validation.valid || missingScope.length || unnamedProducts.length) return {
      ok: false,
      code: "COMMERCIAL_REGISTRY_INTEGRITY_ERROR",
      details: validation.valid ? [...missingScope.map(id => `INVALID_SCOPE_REFERENCE:${id}`), ...unnamedProducts.map(id => `INVALID_PRODUCT_NAME:${id}`)] : validation.errors.map(error => `${error.code}:${error.path}`),
    };

    const at = Date.parse(scope.effectiveAt);
    const companyById = new Map((companies as CompanyRecord[]).map(value => [value.companyId, value]));
    const marketById = new Map(marketRefs.map(value => [value.marketId, value]));
    const productById = new Map((products as CanonicalProductReference[]).map(value => [value.productId, value]));
    const companyAllowed = new Set(scope.authorizedCompanyIds);
    const countryAllowed = new Set(scope.authorizedCountryIds);
    const productAllowed = new Set(scope.authorizedProductIds);
    const relationships = relationshipRefs.filter(value => value.active && effective(value, at)).filter(value => {
      const company = companyById.get(value.companyId), market = marketById.get(value.marketId);
      if (!company?.active || !market?.active) return false;
      return scope.global || (companyAllowed.has(value.companyId) && countryAllowed.has(market.countryId));
    });
    const relationshipById = new Map(relationships.map(value => [value.companyMarketId, value]));
    const authorizedCatalog = scopedCatalogRefs.filter(value => effective(value, at) && relationshipById.has(value.companyMarketId))
      .filter(value => !scope.productScopeRequired || productAllowed.has(value.productId));
    const resolvedCatalog = authorizedCatalog.filter(value => value.active && value.saleable);
    const resolvedMarketPairs = relationships.map(value => ({ relationship: value, market: marketById.get(value.marketId)! }));
    return {
      ok: true,
      value: {
        state: classifyMarketResolution(relationships),
        companies: unique(relationships.map(value => value.companyId)).map(companyId => ({ companyId, name: companyById.get(companyId)!.name })),
        countries: unique(resolvedMarketPairs.map(value => value.market.countryId)).map(countryId => {
          const market = resolvedMarketPairs.find(value => value.market.countryId === countryId)!.market;
          return { countryId, nameEn: market.countryNameEn, nameAr: market.countryNameAr };
        }),
        markets: resolvedMarketPairs.map(({ relationship, market }) => ({ marketId: market.marketId, companyId: relationship.companyId, countryId: market.countryId, nameEn: market.countryNameEn, nameAr: market.countryNameAr, currencyCode: market.currencyCode, currencySymbol: market.currencySymbol, decimalPlaces: market.decimalPlaces })),
        products: resolvedCatalog.map(entry => ({ productId: entry.productId, name: productName(productById.get(entry.productId)!), companyId: entry.companyId, marketId: entry.marketId, unitPrice: entry.unitPrice, currencyCode: marketById.get(entry.marketId)!.currencyCode })),
        catalogConfigurations: authorizedCatalog.map(entry => ({ productId: entry.productId, companyId: entry.companyId, marketId: entry.marketId, unitPrice: entry.unitPrice, active: entry.active, saleable: entry.saleable, effectiveFrom: entry.effectiveFrom, catalogEntryId: entry.catalogEntryId })),
      },
    };
  } catch (error) {
    return { ok: false, code: "COMMERCIAL_REGISTRY_INTEGRITY_ERROR", details: [error instanceof Error ? error.message : "COMMERCIAL_REGISTRY_READ_FAILED"] };
  }
}
