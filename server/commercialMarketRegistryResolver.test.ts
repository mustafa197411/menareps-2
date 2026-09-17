import { describe, expect, it } from "vitest";
import type { MarketBusinessSettings } from "../src/lib/marketSettings";
import {
  COMMERCIAL_REGISTRY_SCHEMA_VERSION,
  deterministicCompanyMarketId,
  deterministicProductMarketCatalogId,
  type CanonicalCountryReference,
  type CanonicalProductReference,
  type CompanyMarketAssignment,
  type CompanyRecord,
  type ProductMarketCatalogEntry,
} from "../src/lib/commercialRegistry";
import type { CommercialMarketRegistryRepository, CommercialRegistryReadRequest } from "./commercialMarketRegistryRepository";
import { classifyMarketResolution, resolveCommercialMarketRegistry, type CanonicalCommercialScope } from "./commercialMarketRegistryResolver";

const AT = "2026-06-01T00:00:00.000Z";
const AUDIT = { createdAt: "2025-01-01T00:00:00.000Z", createdBy: "ACTOR_A", updatedAt: "2025-02-01T00:00:00.000Z", updatedBy: "ACTOR_B" } as const;
const company = (companyId: string, active = true): CompanyRecord => ({ schemaVersion: COMMERCIAL_REGISTRY_SCHEMA_VERSION, companyId, name: `Synthetic ${companyId}`, active, ...AUDIT });
const country = (countryId: string, active = true): CanonicalCountryReference => ({ countryId, active, ...AUDIT });
const product = (productId: string, active = true): CanonicalProductReference & { name: string } => ({ productId, name: `Synthetic ${productId}`, active, ...AUDIT });
const market = (marketId: string, countryId: string, currencyCode: string, active = true): MarketBusinessSettings => ({
  marketId, countryId, countryNameEn: `Synthetic ${countryId}`, countryNameAr: `Synthetic Arabic ${countryId}`, active,
  currencyCode, currencySymbol: currencyCode, symbolPosition: "AFTER", decimalPlaces: 2, numeralLocale: "en-US", timezone: "UTC",
  dateFormat: "YYYY-MM-DD", timeFormat: "24H", weekStartDay: 1, workingWeekdays: [1, 2, 3, 4, 5], normalWorkdayStart: "08:00",
  normalWorkdayEnd: "17:00", checkInOpensAt: "07:30", lateToleranceMinutes: 15, autoCheckoutAt: "19:00", maximumWorkdayMinutes: 540,
});
const relationship = (companyId: string, marketId: string, overrides: Partial<CompanyMarketAssignment> = {}): CompanyMarketAssignment => ({
  schemaVersion: COMMERCIAL_REGISTRY_SCHEMA_VERSION, companyMarketId: deterministicCompanyMarketId(companyId, marketId), companyId, marketId,
  active: true, effectiveFrom: "2026-01-01T00:00:00.000Z", ...AUDIT, ...overrides,
});
const catalog = (companyId: string, marketId: string, productId: string, price: number, overrides: Partial<ProductMarketCatalogEntry> = {}): ProductMarketCatalogEntry => ({
  schemaVersion: COMMERCIAL_REGISTRY_SCHEMA_VERSION,
  catalogEntryId: deterministicProductMarketCatalogId(companyId, marketId, productId, "2026-01-01T00:00:00.000Z"),
  companyMarketId: deterministicCompanyMarketId(companyId, marketId), companyId, marketId, productId, active: true, saleable: true,
  unitPrice: price, effectiveFrom: "2026-01-01T00:00:00.000Z", ...AUDIT, ...overrides,
});

interface DataSet {
  companies: unknown[]; countries: unknown[]; markets: unknown[]; companyMarkets: unknown[]; catalog: unknown[]; products: unknown[];
}

const dataSet = (): DataSet => ({
  companies: [company("COMPANY_A"), company("COMPANY_B")],
  countries: [country("COUNTRY_A"), country("COUNTRY_B")],
  markets: [market("MARKET_A1", "COUNTRY_A", "AAA"), market("MARKET_A2", "COUNTRY_A", "AAB"), market("MARKET_B", "COUNTRY_B", "BBB")],
  companyMarkets: [relationship("COMPANY_A", "MARKET_A1"), relationship("COMPANY_A", "MARKET_A2"), relationship("COMPANY_B", "MARKET_A1"), relationship("COMPANY_B", "MARKET_B")],
  products: [product("PRODUCT_A"), product("PRODUCT_B")],
  catalog: [catalog("COMPANY_A", "MARKET_A1", "PRODUCT_A", 10), catalog("COMPANY_A", "MARKET_A2", "PRODUCT_A", 12), catalog("COMPANY_B", "MARKET_A1", "PRODUCT_A", 11), catalog("COMPANY_B", "MARKET_B", "PRODUCT_B", 20)],
});

function fakeRepository(data: DataSet, pageSize = 100, observedChunks: number[] = []): CommercialMarketRegistryRepository {
  const reader = (records: unknown[], idField: string, filterField = idField) => async (request: CommercialRegistryReadRequest) => {
    if (request.ids) observedChunks.push(request.ids.length);
    const filtered = request.ids ? records.filter(value => request.ids!.includes((value as Record<string, string>)[filterField])) : records;
    const start = request.cursor ? Number(request.cursor) : 0;
    const size = Math.min(request.limit, pageSize);
    const page = filtered.slice(start, start + size);
    return { records: page, nextCursor: start + size < filtered.length ? String(start + size) : undefined };
  };
  return {
    readCompanies: reader(data.companies, "companyId"), readCountries: reader(data.countries, "countryId"),
    readMarkets: reader(data.markets, "marketId"), readCompanyMarkets: reader(data.companyMarkets, "companyMarketId", "companyId"),
    readProductMarketCatalog: reader(data.catalog, "catalogEntryId", "companyMarketId"), readProducts: reader(data.products, "productId"),
  };
}

const globalScope = (): CanonicalCommercialScope => ({ global: true, authorizedCompanyIds: [], authorizedCountryIds: [], authorizedProductIds: [], productScopeRequired: false, effectiveAt: AT });
const scoped = (overrides: Partial<CanonicalCommercialScope> = {}): CanonicalCommercialScope => ({ global: false, authorizedCompanyIds: ["COMPANY_A"], authorizedCountryIds: ["COUNTRY_A"], authorizedProductIds: ["PRODUCT_A"], productScopeRequired: true, effectiveAt: AT, ...overrides });

describe("commercial market registry resolver", () => {
  it("classifies unique canonical Company x Market relationships", () => {
    expect(classifyMarketResolution([])).toBe("ZERO");
    expect(classifyMarketResolution([relationship("COMPANY_A", "MARKET_SHARED")])).toBe("ONE");
    expect(classifyMarketResolution([
      relationship("COMPANY_A", "MARKET_SHARED"),
      relationship("COMPANY_B", "MARKET_SHARED"),
    ])).toBe("MULTIPLE");
    expect(classifyMarketResolution([
      relationship("COMPANY_A", "MARKET_A1"),
      relationship("COMPANY_A", "MARKET_A2"),
    ])).toBe("MULTIPLE");
    expect(classifyMarketResolution([
      relationship("COMPANY_A", "MARKET_A1"),
      { ...relationship("COMPANY_A", "MARKET_A1") },
    ])).toBe("ONE");
  });

  it("resolves global canonical relationships without bypassing validation", async () => {
    const result = await resolveCommercialMarketRegistry(globalScope(), fakeRepository(dataSet(), 1));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state).toBe("MULTIPLE");
    expect(result.value.companies).toHaveLength(2);
    expect(result.value.markets).toHaveLength(4);
    expect(result.value.products.map(value => [value.marketId, value.unitPrice, value.currencyCode])).toEqual(expect.arrayContaining([["MARKET_A1", 10, "AAA"], ["MARKET_A2", 12, "AAB"]]));
  });

  it("returns controlled zero, one, and multiple market states", async () => {
    const data = dataSet();
    const one = await resolveCommercialMarketRegistry(scoped({ authorizedCountryIds: ["COUNTRY_B"], authorizedCompanyIds: ["COMPANY_B"], authorizedProductIds: ["PRODUCT_B"] }), fakeRepository(data));
    expect(one.ok && one.value.state).toBe("ONE");
    const multiple = await resolveCommercialMarketRegistry(scoped(), fakeRepository(data));
    expect(multiple.ok && multiple.value.state).toBe("MULTIPLE");
    const zeroData = dataSet();
    zeroData.companyMarkets = zeroData.companyMarkets.map(value => ({ ...(value as CompanyMarketAssignment), active: false }));
    zeroData.catalog = zeroData.catalog.map(value => ({ ...(value as ProductMarketCatalogEntry), active: false }));
    const zero = await resolveCommercialMarketRegistry(globalScope(), fakeRepository(zeroData));
    expect(zero.ok && zero.value.state).toBe("ZERO");
  });

  it("derives countries from markets and intersects scoped product assignments", async () => {
    const result = await resolveCommercialMarketRegistry(scoped(), fakeRepository(dataSet()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.countries.map(value => value.countryId)).toEqual(["COUNTRY_A"]);
    expect(result.value.markets.every(value => value.countryId === "COUNTRY_A" && value.companyId === "COMPANY_A")).toBe(true);
    expect(result.value.products.every(value => value.productId === "PRODUCT_A")).toBe(true);
    expect(result.value.markets.some(value => value.marketId === value.countryId)).toBe(false);
  });

  it("fails closed for forged scope IDs and malformed canonical data", async () => {
    const forged = await resolveCommercialMarketRegistry(scoped({ authorizedCompanyIds: ["COMPANY_FORGED"] }), fakeRepository(dataSet()));
    expect(forged).toMatchObject({ ok: false, code: "COMMERCIAL_REGISTRY_INTEGRITY_ERROR" });
    const malformed = dataSet();
    malformed.companyMarkets.push({ ...(malformed.companyMarkets[0] as CompanyMarketAssignment), companyMarketId: "WRONG" });
    const result = await resolveCommercialMarketRegistry(globalScope(), fakeRepository(malformed));
    expect(result).toMatchObject({ ok: false, code: "COMMERCIAL_REGISTRY_INTEGRITY_ERROR" });
  });

  it("filters inactive and expired valid records at the injected effective timestamp", async () => {
    const data = dataSet();
    data.companyMarkets[1] = relationship("COMPANY_A", "MARKET_A2", { active: false });
    data.catalog[1] = { ...catalog("COMPANY_A", "MARKET_A2", "PRODUCT_A", 12), active: false };
    data.companyMarkets[3] = relationship("COMPANY_B", "MARKET_B", { effectiveTo: "2026-05-31T23:59:59.999Z" });
    data.catalog[3] = catalog("COMPANY_B", "MARKET_B", "PRODUCT_B", 20, { effectiveTo: "2026-05-31T23:59:59.999Z" });
    const result = await resolveCommercialMarketRegistry(globalScope(), fakeRepository(data));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.markets.map(value => `${value.companyId}:${value.marketId}`)).not.toEqual(expect.arrayContaining(["COMPANY_A:MARKET_A2", "COMPANY_B:MARKET_B"]));
  });

  it("exposes only canonical catalog identity fields even when product and relationship effective dates differ", async () => {
    const data = dataSet();
    const effectiveFrom = "2026-03-01T00:00:00.000Z";
    data.catalog[0] = catalog("COMPANY_A", "MARKET_A1", "PRODUCT_A", 13, { catalogEntryId: deterministicProductMarketCatalogId("COMPANY_A", "MARKET_A1", "PRODUCT_A", effectiveFrom), effectiveFrom });
    const result = await resolveCommercialMarketRegistry(scoped(), fakeRepository(data));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.catalogConfigurations).toContainEqual({ productId: "PRODUCT_A", companyId: "COMPANY_A", marketId: "MARKET_A1", unitPrice: 13, active: true, saleable: true, effectiveFrom, catalogEntryId: deterministicProductMarketCatalogId("COMPANY_A", "MARKET_A1", "PRODUCT_A", effectiveFrom) });
  });

  it("fails closed when active relationships reference inactive countries or products", async () => {
    const inactiveCountry = dataSet();
    inactiveCountry.countries[0] = country("COUNTRY_A", false);
    expect(await resolveCommercialMarketRegistry(globalScope(), fakeRepository(inactiveCountry))).toMatchObject({ ok: false, code: "COMMERCIAL_REGISTRY_INTEGRITY_ERROR" });

    const inactiveProduct = dataSet();
    inactiveProduct.products[0] = product("PRODUCT_A", false);
    expect(await resolveCommercialMarketRegistry(globalScope(), fakeRepository(inactiveProduct))).toMatchObject({ ok: false, code: "COMMERCIAL_REGISTRY_INTEGRITY_ERROR" });
  });

  it("fails closed for duplicate and overlapping catalog records", async () => {
    const data = dataSet();
    data.catalog.push(catalog("COMPANY_A", "MARKET_A1", "PRODUCT_A", 13, { catalogEntryId: deterministicProductMarketCatalogId("COMPANY_A", "MARKET_A1", "PRODUCT_A", "2026-03-01T00:00:00.000Z"), effectiveFrom: "2026-03-01T00:00:00.000Z" }));
    const result = await resolveCommercialMarketRegistry(globalScope(), fakeRepository(data));
    expect(result).toMatchObject({ ok: false, code: "COMMERCIAL_REGISTRY_INTEGRITY_ERROR" });
  });

  it("uses pagination and chunks Firestore-compatible ID boundaries", async () => {
    const data = dataSet();
    const ids = Array.from({ length: 31 }, (_, index) => `PRODUCT_${String(index).padStart(2, "0")}`);
    data.products = ids.map(id => product(id));
    data.catalog = [catalog("COMPANY_A", "MARKET_A1", ids[0], 10)];
    const observed: number[] = [];
    const result = await resolveCommercialMarketRegistry(scoped({ authorizedProductIds: ids }), fakeRepository(data, 1, observed));
    expect(result.ok).toBe(true);
    expect(Math.max(...observed)).toBeLessThanOrEqual(30);
    expect(observed).toEqual(expect.arrayContaining([30, 1]));
  });
});
