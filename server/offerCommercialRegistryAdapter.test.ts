import { describe, expect, it } from "vitest";
import type { MarketBusinessSettings } from "../src/lib/marketSettings";
import {
  COMMERCIAL_REGISTRY_SCHEMA_VERSION,
  deterministicCompanyMarketId,
  deterministicProductMarketCatalogId,
  type CompanyMarketAssignment,
  type ProductMarketCatalogEntry,
} from "../src/lib/commercialRegistry";
import type { CommercialMarketRegistryRepository, CommercialRegistryReadRequest } from "./commercialMarketRegistryRepository";
import { resolveCommercialMarketRegistry } from "./commercialMarketRegistryResolver";
import { createOfferCommercialRegistryDependencies, OfferCommercialRegistryError, resolveOfferCommercialContext, resolveOfferCommercialOptions, type OfferCommercialActorScope, type OfferCommercialRegistryDependencies } from "./offerCommercialRegistryAdapter";

const NOW = "2032-04-15T10:00:00.000Z";
const AUDIT = { createdAt: "2031-01-01T00:00:00.000Z", createdBy: "SYNTHETIC_ACTOR_A", updatedAt: "2031-02-01T00:00:00.000Z", updatedBy: "SYNTHETIC_ACTOR_B" };
const company = (companyId: string, active = true) => ({ schemaVersion: COMMERCIAL_REGISTRY_SCHEMA_VERSION, companyId, name: `Synthetic ${companyId}`, active, ...AUDIT });
const country = (countryId: string, active = true) => ({ countryId, active, ...AUDIT });
const product = (productId: string, active = true) => ({ productId, name: `Synthetic ${productId}`, active, ...AUDIT });
const market = (marketId: string, countryId: string, currencyCode: string, active = true): MarketBusinessSettings => ({
  marketId, countryId, countryNameEn: `Synthetic ${countryId}`, countryNameAr: `Synthetic Arabic ${countryId}`, active,
  currencyCode, currencySymbol: currencyCode, symbolPosition: "AFTER", decimalPlaces: 2, numeralLocale: "en-US", timezone: "UTC",
  dateFormat: "YYYY-MM-DD", timeFormat: "24H", weekStartDay: 1, workingWeekdays: [1, 2, 3, 4, 5], normalWorkdayStart: "08:00",
  normalWorkdayEnd: "17:00", checkInOpensAt: "07:30", lateToleranceMinutes: 15, autoCheckoutAt: "19:00", maximumWorkdayMinutes: 540,
});
const relationship = (companyId: string, marketId: string, overrides: Partial<CompanyMarketAssignment> = {}): CompanyMarketAssignment => ({
  schemaVersion: COMMERCIAL_REGISTRY_SCHEMA_VERSION, companyMarketId: deterministicCompanyMarketId(companyId, marketId), companyId, marketId,
  active: true, effectiveFrom: "2032-01-01T00:00:00.000Z", ...AUDIT, ...overrides,
});
const catalog = (companyId: string, marketId: string, productId: string, unitPrice: number, overrides: Partial<ProductMarketCatalogEntry> = {}): ProductMarketCatalogEntry => ({
  schemaVersion: COMMERCIAL_REGISTRY_SCHEMA_VERSION,
  catalogEntryId: deterministicProductMarketCatalogId(companyId, marketId, productId, "2032-01-01T00:00:00.000Z"),
  companyMarketId: deterministicCompanyMarketId(companyId, marketId), companyId, marketId, productId, active: true, saleable: true,
  unitPrice, effectiveFrom: "2032-01-01T00:00:00.000Z", ...AUDIT, ...overrides,
});

type Data = { companies: unknown[]; countries: unknown[]; markets: unknown[]; relationships: unknown[]; catalog: unknown[]; products: unknown[] };
const data = (): Data => ({
  companies: [company("SYNTH_COMPANY_A"), company("SYNTH_COMPANY_B")],
  countries: [country("SYNTH_COUNTRY_A"), country("SYNTH_COUNTRY_B")],
  markets: [market("SYNTH_MARKET_A", "SYNTH_COUNTRY_A", "XAA"), market("SYNTH_MARKET_B", "SYNTH_COUNTRY_B", "XBB")],
  relationships: [relationship("SYNTH_COMPANY_A", "SYNTH_MARKET_A"), relationship("SYNTH_COMPANY_B", "SYNTH_MARKET_B")],
  catalog: [catalog("SYNTH_COMPANY_A", "SYNTH_MARKET_A", "SYNTH_PRODUCT_A", 17), catalog("SYNTH_COMPANY_B", "SYNTH_MARKET_B", "SYNTH_PRODUCT_B", 29)],
  products: [product("SYNTH_PRODUCT_A"), product("SYNTH_PRODUCT_B")],
});
const repository = (source: Data): CommercialMarketRegistryRepository => {
  const read = (values: unknown[], idField: string, filterField = idField) => async (request: CommercialRegistryReadRequest) => ({
    records: request.ids ? values.filter(value => request.ids!.includes((value as Record<string, string>)[filterField])) : values,
  });
  return {
    readCompanies: read(source.companies, "companyId"), readCountries: read(source.countries, "countryId"), readMarkets: read(source.markets, "marketId"),
    readCompanyMarkets: read(source.relationships, "companyMarketId", "companyId"), readProductMarketCatalog: read(source.catalog, "catalogEntryId", "companyMarketId"), readProducts: read(source.products, "productId"),
  };
};
const dependencies = (source: Data): OfferCommercialRegistryDependencies => ({ repository: repository(source), resolver: resolveCommercialMarketRegistry, clock: () => NOW });
const globalActor = (): OfferCommercialActorScope => ({ global: true, companyIds: [], countryIds: [], marketIds: [], productIds: [] });
const scopedActor = (overrides: Partial<OfferCommercialActorScope> = {}): OfferCommercialActorScope => ({ global: false, companyIds: ["SYNTH_COMPANY_A"], countryIds: ["SYNTH_COUNTRY_A"], marketIds: [], productIds: ["SYNTH_PRODUCT_A"], ...overrides });
const selection = (companyMarketId = deterministicCompanyMarketId("SYNTH_COMPANY_A", "SYNTH_MARKET_A"), productIds = ["SYNTH_PRODUCT_A"]) => ({ companyMarketId, productIds });
const code = async (work: () => Promise<unknown>) => { try { await work(); return "PASS"; } catch (error) { return (error as OfferCommercialRegistryError).code; } };

describe("commercial/Product configuration adapter", () => {
  it("preserves the live dependency factory and shared resolver/repository integration", async () => {
    const repo = repository(data()), clock = () => NOW;
    const deps = createOfferCommercialRegistryDependencies(repo, clock);
    expect(deps.repository).toBe(repo); expect(deps.resolver).toBe(resolveCommercialMarketRegistry); expect(deps.clock).toBe(clock);
    const result = await resolveOfferCommercialContext(scopedActor(), selection(), deps);
    expect(result.companyMarketId).toBe(selection().companyMarketId);
    expect(result.resolvedAt).toBe(NOW);
    expect(result).not.toHaveProperty("eligibility");
    expect(result).not.toHaveProperty("commercialContext");
  });

  it("keeps catalog prices as configuration while completion price authority uses Product.price", async () => {
    const { authoritativeProductPrice } = await import("./pharmacyVisitCompletionService");
    const source = data(); source.products[0] = { ...(source.products[0] as object), price: 7 };
    const result = await resolveOfferCommercialContext(scopedActor(), selection(), dependencies(source));
    expect(result.productConfigurations[0].unitPrice).toBe(17);
    expect(authoritativeProductPrice((source.products[0] as { price: number }).price, 7)).toBe(7);
    expect(() => authoritativeProductPrice(7, result.productConfigurations[0].unitPrice)).toThrow("PHARMACY_VISIT_PRODUCT_PRICE_CHANGED");
    expect(source.products[0]).toHaveProperty("price", 7);
  });
  it("returns sanitized ZERO, ONE, and MULTIPLE UI option states without catalog prices", async () => {
    const multiple = await resolveOfferCommercialOptions(globalActor(), dependencies(data()));
    expect(multiple.state).toBe("MULTIPLE");
    expect(JSON.stringify(multiple)).not.toContain("unitPrice");
    const one = await resolveOfferCommercialOptions(scopedActor(), dependencies(data()));
    expect(one).toMatchObject({ state: "ONE", relationships: [{ companyId: "SYNTH_COMPANY_A", marketId: "SYNTH_MARKET_A", countryId: "SYNTH_COUNTRY_A", currencyCode: "XAA", products: [{ productId: "SYNTH_PRODUCT_A" }] }] });
    const empty = data(); empty.relationships = []; empty.catalog = [];
    expect(await resolveOfferCommercialOptions(globalActor(), dependencies(empty))).toEqual({ state: "ZERO", relationships: [] });
  });
  it("derives relationship, country, currency, and prices for scoped actors", async () => {
    const result = await resolveOfferCommercialContext(scopedActor(), selection(), dependencies(data()));
    expect(result.market).toMatchObject({ companyId: "SYNTH_COMPANY_A", marketId: "SYNTH_MARKET_A", countryId: "SYNTH_COUNTRY_A" });
    expect(result).toMatchObject({ resolvedAt: NOW, productConfigurations: [{ productId: "SYNTH_PRODUCT_A", unitPrice: 17, currencyCode: "XAA" }] });
  });

  it("supports canonical relationship ID and requires selection for global multiple relationships", async () => {
    const source = data();
    expect(await code(() => resolveOfferCommercialContext(globalActor(), selection("", []), dependencies(source)))).toBe("OFFER_COMMERCIAL_MARKET_SELECTION_REQUIRED");
    await expect(resolveOfferCommercialContext(globalActor(), selection(deterministicCompanyMarketId("SYNTH_COMPANY_B", "SYNTH_MARKET_B"), ["SYNTH_PRODUCT_B"]), dependencies(source))).resolves.toMatchObject({ market: { companyId: "SYNTH_COMPANY_B", marketId: "SYNTH_MARKET_B", countryId: "SYNTH_COUNTRY_B", currencyCode: "XBB" } });
  });

  it("fails closed for two companies sharing one market unless the relationship is explicit", async () => {
    const source = data();
    source.markets = [market("SYNTH_MARKET_SHARED", "SYNTH_COUNTRY_A", "XAA")];
    source.relationships = [relationship("SYNTH_COMPANY_A", "SYNTH_MARKET_SHARED"), relationship("SYNTH_COMPANY_B", "SYNTH_MARKET_SHARED")];
    source.catalog = [];
    expect(await code(() => resolveOfferCommercialContext(globalActor(), selection("SYNTH_MARKET_SHARED", []), dependencies(source)))).toBe("OFFER_COMMERCIAL_MARKET_SELECTION_REQUIRED");
  });

  it.each([
    deterministicCompanyMarketId("SYNTH_COMPANY_FORGED", "SYNTH_MARKET_A"),
    deterministicCompanyMarketId("SYNTH_COMPANY_A", "SYNTH_MARKET_FORGED"),
    "SYNTH_RELATIONSHIP_FORGED",
  ])("rejects forged commercial relationship %s", async id => {
    expect(await code(() => resolveOfferCommercialContext(globalActor(), selection(id), dependencies(data())))).toBe("OFFER_COMMERCIAL_MARKET_SELECTION_REQUIRED");
  });

  it("rejects obsolete eligibility and injected country fields instead of reconstructing them", async () => {
    for (const extra of [{ eligibility: { companyId: "SYNTH_COMPANY_A" } }, { countryId: "SYNTH_COUNTRY_FORGED" }]) {
      expect(await code(() => resolveOfferCommercialContext(globalActor(), { ...selection(), ...extra }, dependencies(data())))).toBe("OFFER_COMMERCIAL_SELECTION_MISMATCH");
    }
  });

  it("rejects zero, inactive, expired, and malformed commercial configuration", async () => {
    const zero = data(); zero.relationships = []; zero.catalog = [];
    expect(await code(() => resolveOfferCommercialContext(globalActor(), selection(), dependencies(zero)))).toBe("OFFER_COMMERCIAL_MARKET_REQUIRED");
    const inactive = data(); inactive.relationships = inactive.relationships.map(value => ({ ...(value as object), active: false }));
    expect(await code(() => resolveOfferCommercialContext(globalActor(), selection(), dependencies(inactive)))).toBe("OFFER_COMMERCIAL_CONFIGURATION_INVALID");
    const expired = data(); expired.relationships = expired.relationships.map(value => ({ ...(value as object), effectiveTo: "2032-04-14T23:59:59.999Z" }));
    expect(await code(() => resolveOfferCommercialContext(globalActor(), selection(), dependencies(expired)))).toBe("OFFER_COMMERCIAL_CONFIGURATION_INVALID");
    const malformed = data(); malformed.markets = [{ ...(malformed.markets[0] as object), currencyCode: "bad" }]; malformed.relationships = [malformed.relationships[0]]; malformed.catalog = [malformed.catalog[0]];
    expect(await code(() => resolveOfferCommercialContext(globalActor(), selection(), dependencies(malformed)))).toBe("OFFER_COMMERCIAL_CONFIGURATION_INVALID");
  });

  it("rejects cross-market, inactive, expired, and actor-unauthorized products", async () => {
    expect(await code(() => resolveOfferCommercialContext(scopedActor(), selection(undefined, ["SYNTH_PRODUCT_B"]), dependencies(data())))).toBe("OFFER_COMMERCIAL_PRODUCT_UNAUTHORIZED");
    const inactive = data(); inactive.catalog[0] = { ...(inactive.catalog[0] as object), active: false };
    expect(await code(() => resolveOfferCommercialContext(scopedActor(), selection(), dependencies(inactive)))).toBe("OFFER_COMMERCIAL_PRODUCT_UNAUTHORIZED");
    const expired = data(); expired.catalog[0] = { ...(expired.catalog[0] as object), effectiveTo: "2032-04-14T23:59:59.999Z" };
    expect(await code(() => resolveOfferCommercialContext(scopedActor(), selection(), dependencies(expired)))).toBe("OFFER_COMMERCIAL_PRODUCT_UNAUTHORIZED");
    expect(await code(() => resolveOfferCommercialContext(scopedActor({ productIds: ["SYNTH_PRODUCT_B"] }), selection(), dependencies(data())))).toBe("OFFER_COMMERCIAL_PRODUCT_UNAUTHORIZED");
  });

  it("never substitutes a country identifier for a market identifier", async () => {
    expect(await code(() => resolveOfferCommercialContext(scopedActor(), selection(deterministicCompanyMarketId("SYNTH_COMPANY_A", "SYNTH_COUNTRY_A")), dependencies(data())))).toBe("OFFER_COMMERCIAL_SELECTION_MISMATCH");
  });
});
