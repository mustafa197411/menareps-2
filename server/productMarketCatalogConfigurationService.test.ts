import { describe, expect, it, vi } from "vitest";
import {
  parseProductMarketCatalogRequest,
  readProductMarketRelationships,
  saveProductMarketCatalog,
  type ProductMarketCatalogActor,
} from "./productMarketCatalogConfigurationService";
import { COMMERCIAL_REGISTRY_SCHEMA_VERSION, deterministicCompanyMarketId, deterministicProductMarketCatalogId } from "../src/lib/commercialRegistry";

const COMPANY = "COMPANY_TEST", MARKET = "MARKET_TEST", COUNTRY = "COUNTRY_TEST", EFFECTIVE = "2026-06-01T12:00:00.000Z", RELATIONSHIP_EFFECTIVE = "2025-01-01T00:00:00.000Z";
const AUDIT = { createdAt: "2025-01-01T00:00:00.000Z", createdBy: "CREATOR_TEST", updatedAt: "2025-02-01T00:00:00.000Z", updatedBy: "UPDATER_TEST" };
const permissions = { view: true, create: true, edit: true, delete: true, approve: true, export: true, import: true, assign: true, reassign: true, viewTeamData: true, viewNationalData: true, viewFinancialData: true };
const actor: ProductMarketCatalogActor = { uid: "ACTOR_TEST", role: "Admin", permissions };
const relationshipId = deterministicCompanyMarketId(COMPANY, MARKET);
const product = (id: string, active = true) => ({ productId: id, name: `Product ${id}`, active, ...AUDIT });
const market = (active = true) => ({ marketId: MARKET, countryId: COUNTRY, countryNameEn: "Test Country", countryNameAr: "Test Country Arabic", active, currencyCode: "TST", currencySymbol: "T", symbolPosition: "AFTER", decimalPlaces: 2, numeralLocale: "en-US", timezone: "UTC", dateFormat: "YYYY-MM-DD", timeFormat: "24H", weekStartDay: 1, workingWeekdays: [1, 2, 3, 4, 5], normalWorkdayStart: "08:00", normalWorkdayEnd: "17:00", checkInOpensAt: "07:30", lateToleranceMinutes: 15, autoCheckoutAt: "19:00", maximumWorkdayMinutes: 540, ...AUDIT });

class MemoryDb {
  documents = new Map<string, Record<string, unknown>>();
  writes: Array<{ method: string; path: string; data: Record<string, unknown> }> = [];
  failFirstAttempt = false;
  collection(name: string) { return { doc: (id: string) => ({ id, path: `${name}/${id}` }) }; }
  async runTransaction<T>(work: (tx: any) => Promise<T>): Promise<T> {
    let attempt = 0;
    while (true) {
      attempt += 1;
      const staged: typeof this.writes = [];
      const snapshot = (ref: any) => ({ exists: this.documents.has(ref.path), data: () => this.documents.get(ref.path) });
      const tx = {
        get: async (ref: any) => snapshot(ref), getAll: async (...refs: any[]) => refs.map(snapshot),
        create: (ref: any, data: Record<string, unknown>) => staged.push({ method: "create", path: ref.path, data }),
        update: (ref: any, data: Record<string, unknown>) => staged.push({ method: "update", path: ref.path, data }),
      };
      const result = await work(tx);
      if (this.failFirstAttempt && attempt === 1) continue;
      for (const write of staged) this.documents.set(write.path, { ...(this.documents.get(write.path) || {}), ...write.data });
      this.writes.push(...staged);
      return result;
    }
  }
}

function dbFixture(ids = ["PRODUCT_ONE", "PRODUCT_TWO"]) {
  const db = new MemoryDb();
  db.documents.set(`companies/${COMPANY}`, { schemaVersion: COMMERCIAL_REGISTRY_SCHEMA_VERSION, companyId: COMPANY, name: "Test Company", active: true, ...AUDIT });
  db.documents.set(`marketSettings/${MARKET}`, market());
  db.documents.set(`countries/${COUNTRY}`, { countryId: COUNTRY, active: true, ...AUDIT });
  db.documents.set(`companyMarkets/${relationshipId}`, { schemaVersion: COMMERCIAL_REGISTRY_SCHEMA_VERSION, companyMarketId: relationshipId, companyId: COMPANY, marketId: MARKET, active: true, effectiveFrom: RELATIONSHIP_EFFECTIVE, ...AUDIT });
  ids.forEach(id => db.documents.set(`products/${id}`, product(id)));
  return db;
}
const request = (ids = ["PRODUCT_ONE"], price: unknown = 12.5) => parseProductMarketCatalogRequest({ companyId: COMPANY, marketId: MARKET, items: ids.map(productId => ({ productId, unitPrice: price, active: true, saleable: true })) }, true);
const catalogPath = (id: string) => `productMarketCatalog/${deterministicProductMarketCatalogId(COMPANY, MARKET, id, EFFECTIVE)}`;
const saveCatalog = (requestValue: ReturnType<typeof request>, db: MemoryDb, actorValue = actor) => saveProductMarketCatalog(actorValue, requestValue, db as never, () => EFFECTIVE);
const existingRequest = (price = 12.5) => parseProductMarketCatalogRequest({ companyId: COMPANY, marketId: MARKET, items: [{ productId: "PRODUCT_ONE", unitPrice: price, active: true, saleable: true, effectiveFrom: EFFECTIVE, catalogEntryId: catalogPath("PRODUCT_ONE").split("/")[1] }] }, true);

describe("Product Market Catalog configuration", () => {
  it("uses one resolver execution to return options and selected-product catalog identity", async () => {
    const resolver = vi.fn(async () => ({ ok: true as const, value: {
      state: "ONE" as const, companies: [{ companyId: COMPANY, name: "Test Company" }], countries: [{ countryId: COUNTRY, nameEn: "Test Country", nameAr: "Test" }],
      markets: [{ marketId: MARKET, companyId: COMPANY, countryId: COUNTRY, nameEn: "Test Market", nameAr: "Test", currencyCode: "TST", currencySymbol: "T", decimalPlaces: 2 }], products: [],
      catalogConfigurations: [{ productId: "PRODUCT_ONE", companyId: COMPANY, marketId: MARKET, unitPrice: 5, active: false, saleable: false, effectiveFrom: EFFECTIVE, catalogEntryId: catalogPath("PRODUCT_ONE").split("/")[1] }],
    } }));
    const scopedActor = { ...actor, scope: { global: true, companyIds: [], countryIds: [], marketIds: [], productIds: [] } };
    const result = await readProductMarketRelationships(scopedActor, ["PRODUCT_ONE"], { resolver, repository: {} as never, clock: () => EFFECTIVE });
    expect(resolver).toHaveBeenCalledOnce();
    expect(result[0].configurations[0]).toMatchObject({ configured: true, active: false, effectiveFrom: EFFECTIVE });
  });

  it("configures one product and derives currency without reading global price", async () => {
    const db = dbFixture();
    db.documents.get("products/PRODUCT_ONE")!.price = 999;
    const result = await saveCatalog(request(), db);
    expect(result).toMatchObject({ currencyCode: "TST", items: [{ productId: "PRODUCT_ONE", unitPrice: 12.5 }] });
    expect(db.documents.get(catalogPath("PRODUCT_ONE"))?.unitPrice).toBe(12.5);
  });

  it("configures multiple products atomically and writes only catalog documents", async () => {
    const db = dbFixture();
    await saveCatalog(request(["PRODUCT_ONE", "PRODUCT_TWO"]), db);
    expect(db.writes).toHaveLength(2);
    expect(db.writes.every(write => write.path.startsWith("productMarketCatalog/"))).toBe(true);
  });

  it("updates only mutable fields while preserving canonical created audit fields", async () => {
    const db = dbFixture();
    const path = catalogPath("PRODUCT_ONE");
    db.documents.set(path, { schemaVersion: 1, catalogEntryId: path.split("/")[1], companyMarketId: relationshipId, companyId: COMPANY, marketId: MARKET, productId: "PRODUCT_ONE", active: true, saleable: true, unitPrice: 5, effectiveFrom: EFFECTIVE, ...AUDIT });
    await saveCatalog(existingRequest(), db);
    expect(db.writes[0]).toMatchObject({ method: "update", data: { unitPrice: 12.5, active: true, saleable: true, updatedBy: "ACTOR_TEST" } });
    expect(Object.keys(db.writes[0].data).sort()).toEqual(["active", "saleable", "unitPrice", "updatedAt", "updatedBy"]);
    expect(db.documents.get(path)).toMatchObject({ createdAt: AUDIT.createdAt, createdBy: AUDIT.createdBy });
  });

  it.each([null, NaN, -1, Infinity])("rejects invalid price %s", value => {
    expect(() => request(["PRODUCT_ONE"], value)).toThrowError("PRODUCT_MARKET_INVALID_PRICE");
  });

  it("rejects a missing price", () => {
    expect(() => parseProductMarketCatalogRequest({ companyId: COMPANY, marketId: MARKET, items: [{ productId: "PRODUCT_ONE", active: true, saleable: true }] }, true)).toThrowError("PRODUCT_MARKET_INVALID_PRICE");
  });

  it("rejects missing and inactive products with zero writes", async () => {
    const missing = dbFixture([]);
    await expect(saveCatalog(request(), missing)).rejects.toThrowError("PRODUCT_MARKET_PRODUCT_NOT_FOUND");
    expect(missing.writes).toHaveLength(0);
    const inactive = dbFixture(); inactive.documents.set("products/PRODUCT_ONE", product("PRODUCT_ONE", false));
    await expect(saveCatalog(request(), inactive)).rejects.toThrowError("PRODUCT_MARKET_PRODUCT_INACTIVE");
    expect(inactive.writes).toHaveLength(0);
  });

  it("rejects missing or inactive Market and companyMarket", async () => {
    for (const [path, expected] of [[`marketSettings/${MARKET}`, "PRODUCT_MARKET_MARKET_NOT_FOUND"], [`companyMarkets/${relationshipId}`, "PRODUCT_MARKET_RELATIONSHIP_NOT_FOUND"]] as const) {
      const db = dbFixture(); db.documents.delete(path);
      await expect(saveCatalog(request(), db)).rejects.toThrowError(expected);
    }
    const inactiveMarket = dbFixture(); inactiveMarket.documents.set(`marketSettings/${MARKET}`, market(false));
    await expect(saveCatalog(request(), inactiveMarket)).rejects.toThrowError("PRODUCT_MARKET_MARKET_INACTIVE");
    const inactiveRelationship = dbFixture(); inactiveRelationship.documents.set(`companyMarkets/${relationshipId}`, { ...inactiveRelationship.documents.get(`companyMarkets/${relationshipId}`), active: false });
    await expect(saveCatalog(request(), inactiveRelationship)).rejects.toThrowError("PRODUCT_MARKET_RELATIONSHIP_INACTIVE");
  });

  it("rejects deterministic or embedded identity mismatch and malformed existing audit", async () => {
    for (const mutation of [
      (record: Record<string, unknown>) => { record.productId = "PRODUCT_OTHER"; },
      (record: Record<string, unknown>) => { record.createdAt = "invalid"; },
    ]) {
      const db = dbFixture(); const path = catalogPath("PRODUCT_ONE");
      const record = { schemaVersion: 1, catalogEntryId: path.split("/")[1], companyMarketId: relationshipId, companyId: COMPANY, marketId: MARKET, productId: "PRODUCT_ONE", active: true, saleable: true, unitPrice: 5, effectiveFrom: EFFECTIVE, ...AUDIT };
      mutation(record); db.documents.set(path, record);
      await expect(saveCatalog(existingRequest(), db)).rejects.toThrowError("PRODUCT_MARKET_IDENTITY_CONFLICT");
      expect(db.writes).toHaveLength(0);
    }
  });

  it("denies an unauthorized actor before starting a transaction", async () => {
    const db = dbFixture(); const spy = vi.spyOn(db, "runTransaction");
    await expect(saveCatalog(request(), db, { uid: "ACTOR_TEST", role: "Sales Representative", permissions: null })).rejects.toThrowError("PRODUCT_MARKET_PERMISSION_DENIED");
    expect(spy).not.toHaveBeenCalled();
  });

  it("retries a transaction race without leaking first-attempt writes", async () => {
    const db = dbFixture(); db.failFirstAttempt = true;
    await saveCatalog(request(), db);
    expect(db.writes).toHaveLength(1);
  });

  it("aborts a mixed invalid batch with zero writes", async () => {
    const db = dbFixture(["PRODUCT_ONE"]);
    await expect(saveCatalog(request(["PRODUCT_ONE", "PRODUCT_TWO"]), db)).rejects.toThrow();
    expect(db.writes).toHaveLength(0);
  });

  it("uses server clock for a new product effectiveFrom instead of the relationship date", async () => {
    const db = dbFixture();
    const result = await saveCatalog(request(), db);
    expect(result.items[0]).toMatchObject({ effectiveFrom: EFFECTIVE, catalogEntryId: catalogPath("PRODUCT_ONE").split("/")[1] });
    expect(result.items[0].effectiveFrom).not.toBe(RELATIONSHIP_EFFECTIVE);
  });

  it("rejects stale submitted identity with zero writes and creates no duplicate", async () => {
    const db = dbFixture();
    const path = catalogPath("PRODUCT_ONE");
    db.documents.set(path, { schemaVersion: 1, catalogEntryId: path.split("/")[1], companyMarketId: relationshipId, companyId: COMPANY, marketId: MARKET, productId: "PRODUCT_ONE", active: true, saleable: true, unitPrice: 5, effectiveFrom: EFFECTIVE, ...AUDIT });
    const stale = parseProductMarketCatalogRequest({ companyId: COMPANY, marketId: MARKET, items: [{ productId: "PRODUCT_ONE", unitPrice: 10, active: true, saleable: true, effectiveFrom: "2026-05-01T00:00:00.000Z", catalogEntryId: deterministicProductMarketCatalogId(COMPANY, MARKET, "PRODUCT_ONE", "2026-05-01T00:00:00.000Z") }] }, true);
    await expect(saveCatalog(stale, db)).rejects.toThrowError("PRODUCT_MARKET_IDENTITY_CONFLICT");
    expect(db.writes).toHaveLength(0);
    expect([...db.documents.keys()].filter(key => key.startsWith("productMarketCatalog/"))).toEqual([path]);
  });
});
