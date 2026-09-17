import { describe, expect, it } from "vitest";
import type { MarketBusinessSettings } from "./marketSettings";
import {
  COMMERCIAL_REGISTRY_SCHEMA_VERSION,
  deterministicCompanyMarketId,
  deterministicProductMarketCatalogId,
  validateCommercialRegistry,
  validateCompanyMarketAssignment,
  validateCompanyRecord,
  validateProductMarketCatalogEntry,
  type CommercialRegistrySnapshot,
  type CanonicalCountryReference,
  type CanonicalProductReference,
  type CompanyMarketAssignment,
  type CompanyRecord,
  type ProductMarketCatalogEntry,
} from "./commercialRegistry";

const FROM = "2026-01-01T00:00:00.000Z";
const AUDIT = {
  createdAt: "2025-12-01T00:00:00.000Z",
  createdBy: "ACTOR_CREATE",
  updatedAt: "2025-12-02T00:00:00.000Z",
  updatedBy: "ACTOR_UPDATE",
} as const;

const company = (companyId: string, active = true): CompanyRecord => ({
  schemaVersion: COMMERCIAL_REGISTRY_SCHEMA_VERSION,
  companyId,
  name: `Synthetic ${companyId}`,
  active,
  ...AUDIT,
});

const country = (countryId: string, active = true): CanonicalCountryReference => ({ countryId, active, ...AUDIT });
const product = (productId: string, active = true): CanonicalProductReference => ({ productId, active, ...AUDIT });

const market = (marketId: string, countryId: string, currencyCode: string, active = true): MarketBusinessSettings => ({
  marketId,
  countryId,
  countryNameEn: `Synthetic ${countryId}`,
  countryNameAr: `Synthetic Arabic ${countryId}`,
  active,
  currencyCode,
  currencySymbol: currencyCode,
  symbolPosition: "AFTER",
  decimalPlaces: 2,
  numeralLocale: "en-US",
  timezone: "UTC",
  dateFormat: "YYYY-MM-DD",
  timeFormat: "24H",
  weekStartDay: 1,
  workingWeekdays: [1, 2, 3, 4, 5],
  normalWorkdayStart: "08:00",
  normalWorkdayEnd: "17:00",
  checkInOpensAt: "07:30",
  lateToleranceMinutes: 15,
  autoCheckoutAt: "19:00",
  maximumWorkdayMinutes: 540,
});

const companyMarket = (companyId: string, marketId: string, active = true): CompanyMarketAssignment => ({
  schemaVersion: COMMERCIAL_REGISTRY_SCHEMA_VERSION,
  companyMarketId: deterministicCompanyMarketId(companyId, marketId),
  companyId,
  marketId,
  active,
  effectiveFrom: FROM,
  ...AUDIT,
});

const catalogEntry = (
  companyId: string,
  marketId: string,
  productId: string,
  unitPrice: number,
  effectiveFrom = FROM,
): ProductMarketCatalogEntry => ({
  schemaVersion: COMMERCIAL_REGISTRY_SCHEMA_VERSION,
  catalogEntryId: deterministicProductMarketCatalogId(companyId, marketId, productId, effectiveFrom),
  companyMarketId: deterministicCompanyMarketId(companyId, marketId),
  companyId,
  marketId,
  productId,
  active: true,
  saleable: true,
  unitPrice,
  effectiveFrom,
  ...AUDIT,
});

const validRegistry = (): CommercialRegistrySnapshot => ({
  countries: [country("COUNTRY_ALPHA"), country("COUNTRY_BETA")],
  companies: [company("COMPANY_ALPHA"), company("COMPANY_BETA")],
  markets: [
    market("MARKET_ALPHA_NORTH", "COUNTRY_ALPHA", "AAA"),
    market("MARKET_ALPHA_SOUTH", "COUNTRY_ALPHA", "AAB"),
    market("MARKET_BETA", "COUNTRY_BETA", "BBB"),
  ],
  companyMarkets: [
    companyMarket("COMPANY_ALPHA", "MARKET_ALPHA_NORTH"),
    companyMarket("COMPANY_ALPHA", "MARKET_ALPHA_SOUTH"),
    companyMarket("COMPANY_BETA", "MARKET_ALPHA_NORTH"),
    companyMarket("COMPANY_BETA", "MARKET_BETA"),
  ],
  products: [product("PRODUCT_ONE"), product("PRODUCT_TWO")],
  productMarketCatalog: [
    catalogEntry("COMPANY_ALPHA", "MARKET_ALPHA_NORTH", "PRODUCT_ONE", 10),
    catalogEntry("COMPANY_ALPHA", "MARKET_ALPHA_SOUTH", "PRODUCT_ONE", 12.5),
    catalogEntry("COMPANY_BETA", "MARKET_ALPHA_NORTH", "PRODUCT_ONE", 11),
    catalogEntry("COMPANY_BETA", "MARKET_BETA", "PRODUCT_TWO", 20),
  ],
});

const codes = (input: unknown): string[] => {
  const result = validateCommercialRegistry(input);
  return result.valid ? [] : result.errors.map(error => error.code);
};

describe("canonical commercial registry contracts", () => {
  it("accepts multiple companies, countries, markets, shared markets, and market-specific prices", () => {
    const registry = validRegistry();
    const result = validateCommercialRegistry(registry);

    expect(result).toEqual({ valid: true, value: registry, errors: [] });
    expect(registry.markets.filter(item => (item as MarketBusinessSettings).countryId === "COUNTRY_ALPHA")).toHaveLength(2);
    expect(registry.companyMarkets.filter(item => (item as CompanyMarketAssignment).marketId === "MARKET_ALPHA_NORTH")).toHaveLength(2);
    expect(registry.productMarketCatalog.filter(item => (item as ProductMarketCatalogEntry).productId === "PRODUCT_ONE").map(item => (item as ProductMarketCatalogEntry).unitPrice)).toEqual([10, 12.5, 11]);
    expect(registry.productMarketCatalog.every(item => !("currencyCode" in (item as object)))).toBe(true);
  });

  it("fails closed for malformed aggregate and individual records", () => {
    expect(codes(null)).toContain("INVALID_RECORD");
    expect(codes({ ...validRegistry(), markets: [{ marketId: "BROKEN" }] })).toContain("INVALID_MARKET_SETTINGS");
    expect(validateCompanyRecord({ ...company("COMPANY_ALPHA"), companyId: " COMPANY_ALPHA" }).valid).toBe(false);
    expect(validateCompanyMarketAssignment({ ...companyMarket("COMPANY_ALPHA", "MARKET_ALPHA_NORTH"), active: "yes" }).valid).toBe(false);
    expect(validateProductMarketCatalogEntry({ ...catalogEntry("COMPANY_ALPHA", "MARKET_ALPHA_NORTH", "PRODUCT_ONE", 10), unitPrice: Number.NaN }).valid).toBe(false);
  });

  it("rejects missing and inactive canonical references", () => {
    const missing = validRegistry();
    missing.products = [];
    missing.countries = [country("COUNTRY_ALPHA")];
    expect(codes(missing)).toEqual(expect.arrayContaining(["MISSING_REFERENCE"]));

    const inactive = validRegistry();
    inactive.companies[0] = company("COMPANY_ALPHA", false);
    expect(codes(inactive)).toContain("INACTIVE_REFERENCE");

    const inactiveMarket = validRegistry();
    inactiveMarket.markets[0] = market("MARKET_ALPHA_NORTH", "COUNTRY_ALPHA", "AAA", false);
    expect(codes(inactiveMarket)).toContain("INACTIVE_REFERENCE");
  });

  it("rejects inactive countries and products used by active relationships", () => {
    const inactiveCountry = validRegistry();
    inactiveCountry.countries[0] = country("COUNTRY_ALPHA", false);
    expect(codes(inactiveCountry)).toContain("INACTIVE_REFERENCE");

    const inactiveProduct = validRegistry();
    inactiveProduct.products[0] = product("PRODUCT_ONE", false);
    expect(codes(inactiveProduct)).toContain("INACTIVE_REFERENCE");
  });

  it("rejects malformed server audit actors, timestamps, and reversed audit chronology", () => {
    const malformedActor = validRegistry();
    malformedActor.companies[0] = { ...(malformedActor.companies[0] as CompanyRecord), updatedBy: " ACTOR_UPDATE" };
    expect(codes(malformedActor)).toContain("INVALID_IDENTIFIER");

    const malformedTimestamp = validRegistry();
    malformedTimestamp.products[0] = { ...(malformedTimestamp.products[0] as CanonicalProductReference), createdAt: "2025-12-01" };
    expect(codes(malformedTimestamp)).toContain("INVALID_EFFECTIVE_DATE");

    const reversed = validRegistry();
    reversed.companyMarkets[0] = {
      ...(reversed.companyMarkets[0] as CompanyMarketAssignment),
      createdAt: "2025-12-03T00:00:00.000Z",
      updatedAt: "2025-12-02T00:00:00.000Z",
    };
    expect(codes(reversed)).toContain("INVALID_EFFECTIVE_RANGE");
  });

  it("rejects duplicate canonical country and product reference records", () => {
    const duplicateCountry = validRegistry();
    duplicateCountry.countries.push(country("COUNTRY_ALPHA"));
    expect(codes(duplicateCountry)).toContain("DUPLICATE_RECORD_ID");

    const duplicateProduct = validRegistry();
    duplicateProduct.products.push(product("PRODUCT_ONE"));
    expect(codes(duplicateProduct)).toContain("DUPLICATE_RECORD_ID");
  });

  it("enforces one deterministic company-market relationship document per pair", () => {
    const registry = validRegistry();
    registry.companyMarkets.push({
      ...companyMarket("COMPANY_ALPHA", "MARKET_ALPHA_NORTH"),
      effectiveFrom: "2027-01-01T00:00:00.000Z",
    });
    expect(codes(registry)).toEqual(expect.arrayContaining(["DUPLICATE_RECORD_ID", "DUPLICATE_RELATIONSHIP"]));
  });

  it("rejects malformed prices, dates, and deterministic relationship identifiers", () => {
    const negative = validRegistry();
    negative.productMarketCatalog[0] = { ...(negative.productMarketCatalog[0] as ProductMarketCatalogEntry), unitPrice: -0.01 };
    expect(codes(negative)).toContain("INVALID_PRICE");

    const malformedDate = validRegistry();
    malformedDate.companyMarkets[0] = { ...(malformedDate.companyMarkets[0] as CompanyMarketAssignment), effectiveFrom: "2026-01-01" };
    expect(codes(malformedDate)).toContain("INVALID_EFFECTIVE_DATE");

    const wrongId = validRegistry();
    wrongId.productMarketCatalog[0] = { ...(wrongId.productMarketCatalog[0] as ProductMarketCatalogEntry), catalogEntryId: "PMC_WRONG" };
    expect(codes(wrongId)).toContain("DETERMINISTIC_ID_MISMATCH");
  });

  it("rejects conflicting company-market references", () => {
    const registry = validRegistry();
    registry.productMarketCatalog[0] = {
      ...(registry.productMarketCatalog[0] as ProductMarketCatalogEntry),
      companyMarketId: deterministicCompanyMarketId("COMPANY_BETA", "MARKET_ALPHA_NORTH"),
    };
    expect(codes(registry)).toContain("RELATIONSHIP_CONFLICT");
  });

  it("keeps currency authoritative in market settings and contains catalog periods within relationships", () => {
    const currencyConflict = validRegistry();
    currencyConflict.productMarketCatalog[0] = {
      ...(currencyConflict.productMarketCatalog[0] as ProductMarketCatalogEntry),
      currencyCode: "ZZZ",
    };
    expect(codes(currencyConflict)).toContain("RELATIONSHIP_CONFLICT");

    const periodConflict = validRegistry();
    periodConflict.companyMarkets[0] = {
      ...(periodConflict.companyMarkets[0] as CompanyMarketAssignment),
      effectiveTo: "2026-06-30T23:59:59.999Z",
    };
    expect(codes(periodConflict)).toContain("RELATIONSHIP_CONFLICT");
  });

  it("rejects overlapping active company-market-product catalog periods", () => {
    const registry = validRegistry();
    const first = registry.productMarketCatalog[0] as ProductMarketCatalogEntry;
    first.effectiveTo = "2026-12-31T23:59:59.000Z";
    registry.productMarketCatalog.push(catalogEntry("COMPANY_ALPHA", "MARKET_ALPHA_NORTH", "PRODUCT_ONE", 15, "2026-06-01T00:00:00.000Z"));
    expect(codes(registry)).toContain("OVERLAPPING_CATALOG_PERIOD");
  });

  it("accepts adjacent non-overlapping periods and preserves supplied records byte-for-byte in memory", () => {
    const registry = validRegistry();
    const first = registry.productMarketCatalog[0] as ProductMarketCatalogEntry;
    first.effectiveTo = "2026-05-31T23:59:59.999Z";
    registry.productMarketCatalog.push(catalogEntry("COMPANY_ALPHA", "MARKET_ALPHA_NORTH", "PRODUCT_ONE", 15, "2026-06-01T00:00:00.000Z"));
    const before = JSON.stringify(registry);
    const result = validateCommercialRegistry(registry);
    expect(result.valid).toBe(true);
    expect(JSON.stringify(registry)).toBe(before);
  });
});
