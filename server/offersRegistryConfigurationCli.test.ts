import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { validateCountryReference, validateProductReference } from "../src/lib/commercialRegistry";
import type { MarketBusinessSettings } from "../src/lib/marketSettings";
import { createFirestoreCommercialMarketRegistryRepository } from "./commercialMarketRegistryRepository";
import {
  buildPlan,
  executeConfiguration,
  executeProductIdentityConfiguration,
  executeProductNormalizationConfiguration,
  parseManifest,
  parseProductIdentityManifest,
  parseProductNormalizationManifest,
  type ActorResolver,
  type ConfigurationDependencies,
  type OffersRegistryManifest,
  type ProductIdentityManifest,
  type ProductNormalizationManifest,
  type OffersRegistryRepository,
  type RegistryTransaction,
  type StoredDocument,
} from "./offersRegistryConfigurationCli";

const NOW = "2034-03-04T05:06:07.000Z";
const START = "2034-01-01T00:00:00.000Z";
const AUDIT = { createdAt: "2033-01-01T00:00:00.000Z", createdBy: "ACTOR_SEED", updatedAt: "2033-01-01T00:00:00.000Z", updatedBy: "ACTOR_SEED" };

const manifest = (suffix = "A", overrides: Partial<OffersRegistryManifest> = {}): OffersRegistryManifest => ({
  projectId: `project-${suffix.toLowerCase()}`,
  databaseId: `database-${suffix.toLowerCase()}`,
  companyId: `COMPANY_${suffix}`,
  companyName: `Company ${suffix}`,
  marketId: `MARKET_${suffix}`,
  productId: `PRODUCT_${suffix}`,
  unitPrice: suffix === "A" ? 17.25 : 42.5,
  relationshipEffectiveFrom: START,
  productEffectiveFrom: START,
  active: true,
  saleable: true,
  ...overrides,
});

const market = (input: OffersRegistryManifest, suffix = "A"): MarketBusinessSettings => ({
  marketId: input.marketId,
  countryId: `COUNTRY_${suffix}`,
  countryNameEn: `Country ${suffix}`,
  countryNameAr: `Country Arabic ${suffix}`,
  active: true,
  currencyCode: suffix === "A" ? "AAA" : "BBB",
  currencySymbol: suffix,
  symbolPosition: "AFTER",
  decimalPlaces: 2,
  numeralLocale: "en",
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
  maximumWorkdayMinutes: 600,
});

class MemoryRepository implements OffersRegistryRepository {
  readonly documents = new Map<string, Record<string, unknown>>();
  readonly creates: string[] = [];
  readonly updates: Array<{ path: string; fields: Record<string, unknown> }> = [];
  readonly deletes: string[] = [];
  readonly creationTimes = new Map<string, string>();
  transactionRace?: () => void;

  constructor(input: OffersRegistryManifest, suffix = "A") {
    const configuredMarket = market(input, suffix);
    this.documents.set(`marketSettings/${input.marketId}`, configuredMarket as unknown as Record<string, unknown>);
    this.documents.set(`countries/${configuredMarket.countryId}`, { countryId: configuredMarket.countryId, active: true, ...AUDIT });
    this.documents.set(`products/${input.productId}`, { productId: input.productId, name: `Product ${suffix}`, active: true, price: 999999, ...AUDIT });
    for (const path of this.documents.keys()) this.creationTimes.set(path, "2032-01-02T03:04:05.000Z");
  }

  private value(path: string): StoredDocument {
    const data = this.documents.get(path);
    return { id: path.split("/").at(-1)!, exists: Boolean(data), ...(data ? { data: structuredClone(data) } : {}), ...(this.creationTimes.has(path) ? { createTime: this.creationTimes.get(path) } : {}) };
  }

  async readMarket(path: string) { return this.value(path); }
  async readRemaining(paths: readonly string[]) { return paths.map(path => this.value(path)); }

  async transact<T>(work: (transaction: RegistryTransaction) => Promise<T>): Promise<T> {
    this.transactionRace?.();
    const pendingCreates: Array<[string, Record<string, unknown>]> = [];
    const pendingUpdates: Array<[string, Record<string, unknown>]> = [];
    const pendingDeletes: string[] = [];
    const transaction: RegistryTransaction = {
      readMarket: async path => this.value(path),
      readRemaining: async paths => paths.map(path => this.value(path)),
      create: (path, data) => {
        if (this.documents.has(path) || pendingCreates.some(([candidate]) => candidate === path)) throw new Error("CREATE_COLLISION");
        pendingCreates.push([path, structuredClone(data)]);
      },
      update: (path, data) => {
        if (!this.documents.has(path)) throw new Error("UPDATE_MISSING");
        pendingUpdates.push([path, structuredClone(data)]);
      },
      delete: path => pendingDeletes.push(path),
    };
    const result = await work(transaction);
    for (const [path, data] of pendingCreates) { this.documents.set(path, data); this.creates.push(path); }
    for (const [path, fields] of pendingUpdates) { this.documents.set(path, { ...this.documents.get(path)!, ...fields }); this.updates.push({ path, fields }); }
    for (const path of pendingDeletes) { this.documents.delete(path); this.deletes.push(path); }
    return result;
  }
}

const actor = (uid = "ACTOR_A"): ActorResolver => ({ async resolveUid() { return uid; } });
const dependencies = (repository: MemoryRepository, resolver: ActorResolver = actor(), clock = () => NOW): ConfigurationDependencies => ({ repository, actorResolver: resolver, clock });
const options = (input: OffersRegistryManifest, mode: "CREATE_ONLY" | "DELETE_EXACT_CHANGESET" | "NORMALIZE_MISSING_REFERENCE_FIELDS" = "CREATE_ONLY") => ({ actorEmail: "operator@example.invalid", confirmProject: input.projectId, confirmMode: mode });
const identityManifest = (productIds = ["PRODUCT_ONE"]): ProductIdentityManifest => ({ projectId: "project-identities", databaseId: "database-identities", productIds });
const repairOptions = (input: ProductIdentityManifest) => ({ actorEmail: "operator@example.invalid", confirmProject: input.projectId, confirmMode: "REPAIR_EXACT_PRODUCT_IDENTITIES" });
const normalizationManifest = (productIds = ["PRODUCT_ONE"], active = true): ProductNormalizationManifest => ({ ...identityManifest(productIds), active });
const normalizationOptions = (input: ProductNormalizationManifest) => ({ actorEmail: "operator@example.invalid", confirmProject: input.projectId, confirmMode: "NORMALIZE_EXACT_PRODUCT_REFERENCES" });

function addCanonicalProduct(repository: MemoryRepository, productId: string, overrides: Record<string, unknown> = {}) {
  repository.documents.set(`products/${productId}`, { productId, active: true, name: `Product ${productId}`, sku: `SKU_${productId}`, code: `CODE_${productId}`, price: 123, stock: 45, ...AUDIT, ...overrides });
  repository.creationTimes.set(`products/${productId}`, "2032-01-02T03:04:05.000Z");
}

function legacyReferences(repository: MemoryRepository, input: OffersRegistryManifest, suffix = "A") {
  const productPath = `products/${input.productId}`;
  const countryPath = `countries/${market(input, suffix).countryId}`;
  const product = repository.documents.get(productPath)!;
  const country = repository.documents.get(countryPath)!;
  for (const field of ["productId", "active", "createdAt", "updatedAt"]) delete product[field];
  for (const field of ["countryId", "active", "createdAt", "createdBy", "updatedAt", "updatedBy"]) delete country[field];
  product.legacyProductField = "preserved-product";
  country.legacyCountryField = "preserved-country";
  return { productPath, countryPath };
}

function runtimeRepository(documents: Map<string, Record<string, unknown>>) {
  return createFirestoreCommercialMarketRegistryRepository({
    collection(collection: string) {
      let ids: readonly string[] | undefined;
      const query = {
        where(_field: unknown, _operator: string, values: readonly string[]) { ids = values; return query; },
        orderBy() { return query; },
        limit() { return query; },
        startAfter() { return query; },
        async get() {
          return {
            docs: [...documents.entries()]
              .filter(([path]) => path.startsWith(`${collection}/`))
              .filter(([path]) => !ids || ids.includes(path.split("/").at(-1)!))
              .map(([path, data]) => ({ id: path.split("/").at(-1)!, data: () => structuredClone(data) })),
          };
        },
      };
      return query;
    },
  } as never);
}

async function applied(input = manifest(), suffix = "A", uid = "ACTOR_A") {
  const repository = new MemoryRepository(input, suffix);
  const result = await executeConfiguration("apply", input, options(input), dependencies(repository, actor(uid)));
  expect(result).toMatchObject({ status: "PASS", code: "APPLY_PASS" });
  return repository;
}

describe("Offers registry configuration CLI", () => {
  it("parses the exact manifest schema and rejects invalid timestamps and prices", () => {
    expect(parseManifest(manifest())).toEqual(manifest());
    expect(() => parseManifest({ ...manifest(), unitPrice: -1 })).toThrow("MANIFEST_FIELD_INVALID");
    expect(() => parseManifest({ ...manifest(), productEffectiveFrom: "2034-01-01" })).toThrow("MANIFEST_FIELD_INVALID");
    expect(() => parseManifest({ ...manifest(), unexpected: true })).toThrow("MANIFEST_SCHEMA_INVALID");
  });

  it("accepts the default and valid named Firestore database IDs", () => {
    expect(parseManifest({ ...manifest(), databaseId: "(default)" }).databaseId).toBe("(default)");
    expect(parseManifest({ ...manifest(), databaseId: "named-database-2" }).databaseId).toBe("named-database-2");
  });

  it.each([
    "",
    "   ",
    " named-database ",
    "named/database",
    "abc",
    "Named_database",
    "-named-database",
    "named-database-",
    "(malformed)",
  ])("rejects invalid Firestore database ID %j", databaseId => {
    expect(() => parseManifest({ ...manifest(), databaseId })).toThrow("MANIFEST_FIELD_INVALID");
  });

  it("blocks an invalid injected audit timestamp", async () => {
    const input = manifest();
    const result = await executeConfiguration("preflight", input, { actorEmail: "operator@example.invalid" }, dependencies(new MemoryRepository(input), actor(), () => "not-a-timestamp"));
    expect(result).toEqual({ status: "BLOCKED", code: "AUDIT_TIMESTAMP_INVALID", mode: "preflight" });
  });

  it.each(["product", "country", "market"] as const)("blocks a missing %s reference", async key => {
    const input = manifest();
    const repository = new MemoryRepository(input);
    const configuredMarket = market(input);
    const path = key === "product" ? `products/${input.productId}` : key === "country" ? `countries/${configuredMarket.countryId}` : `marketSettings/${input.marketId}`;
    repository.documents.delete(path);
    expect(await executeConfiguration("preflight", input, { actorEmail: "operator@example.invalid" }, dependencies(repository))).toMatchObject({ status: "BLOCKED" });
  });

  it("blocks an invalid product", async () => {
    const input = manifest(); const repository = new MemoryRepository(input);
    repository.documents.get(`products/${input.productId}`)!.active = "yes";
    expect((await executeConfiguration("preflight", input, { actorEmail: "operator@example.invalid" }, dependencies(repository))).code).toBe("REFERENCE_VALIDATION_FAILED");
  });

  it("blocks an invalid country", async () => {
    const input = manifest(); const repository = new MemoryRepository(input); const countryId = market(input).countryId;
    repository.documents.get(`countries/${countryId}`)!.createdAt = "invalid";
    expect((await executeConfiguration("preflight", input, { actorEmail: "operator@example.invalid" }, dependencies(repository))).code).toBe("REFERENCE_VALIDATION_FAILED");
  });

  it.each([
    ["product", "productId"],
    ["country", "countryId"],
  ] as const)("blocks preflight when the persisted %s embedded ID is missing", async (kind, idField) => {
    const input = manifest(); const repository = new MemoryRepository(input); const configuredMarket = market(input);
    const path = kind === "product" ? `products/${input.productId}` : `countries/${configuredMarket.countryId}`;
    delete repository.documents.get(path)![idField];
    expect(await executeConfiguration("preflight", input, { actorEmail: "operator@example.invalid" }, dependencies(repository))).toEqual({
      status: "BLOCKED",
      code: "DOCUMENT_ID_MISMATCH",
      mode: "preflight",
      details: [`${path}.${idField}`],
    });
  });

  it("blocks embedded ID mismatch", async () => {
    const input = manifest(); const repository = new MemoryRepository(input);
    repository.documents.get(`products/${input.productId}`)!.productId = "DIFFERENT_PRODUCT";
    expect((await executeConfiguration("preflight", input, { actorEmail: "operator@example.invalid" }, dependencies(repository))).code).toBe("DOCUMENT_ID_MISMATCH");
  });

  it("blocks an invalid or inactive market", async () => {
    const input = manifest(); const invalid = new MemoryRepository(input);
    invalid.documents.get(`marketSettings/${input.marketId}`)!.timezone = "Invalid/Timezone";
    expect((await executeConfiguration("preflight", input, { actorEmail: "operator@example.invalid" }, dependencies(invalid))).code).toBe("MARKET_REFERENCE_INVALID");
    const inactive = new MemoryRepository(input); inactive.documents.get(`marketSettings/${input.marketId}`)!.active = false;
    expect((await executeConfiguration("preflight", input, { actorEmail: "operator@example.invalid" }, dependencies(inactive))).code).toBe("MARKET_INACTIVE");
  });

  it("passes preflight and returns a sanitized exact dry-run", async () => {
    const input = manifest(); const repository = new MemoryRepository(input);
    expect(await executeConfiguration("preflight", input, { actorEmail: "operator@example.invalid" }, dependencies(repository))).toEqual({ status: "PASS", code: "PREFLIGHT_PASS", mode: "preflight" });
    const dryRun = await executeConfiguration("dry-run", input, { actorEmail: "operator@example.invalid" }, dependencies(repository));
    expect(dryRun).toMatchObject({ status: "PASS", code: "DRY_RUN_PASS", manifest: { operation: "CREATE_ONLY", derived: { countryId: "COUNTRY_A", currencyCode: "AAA" } } });
    expect(JSON.stringify(dryRun)).not.toContain("operator@example.invalid");
    expect(JSON.stringify(dryRun)).not.toContain("ACTOR_A");
  });

  it("blocks target existence and actor lookup failure", async () => {
    const input = manifest(); const repository = new MemoryRepository(input);
    repository.documents.set(`companies/${input.companyId}`, {});
    expect((await executeConfiguration("preflight", input, { actorEmail: "operator@example.invalid" }, dependencies(repository))).code).toBe("TARGET_ALREADY_EXISTS");
    const clean = new MemoryRepository(input);
    const failingActor: ActorResolver = { async resolveUid() { throw new Error("private provider detail"); } };
    expect(await executeConfiguration("preflight", input, { actorEmail: "operator@example.invalid" }, dependencies(clean, failingActor))).toEqual({ status: "BLOCKED", code: "ACTOR_LOOKUP_FAILED", mode: "preflight" });
  });

  it("apply creates exactly three records and never copies global product price", async () => {
    const input = manifest("B"); const repository = await applied(input, "B", "ACTOR_B");
    expect(repository.creates).toHaveLength(3);
    const catalog = [...repository.documents.entries()].find(([path]) => path.startsWith("productMarketCatalog/"))![1];
    const relationship = [...repository.documents.entries()].find(([path]) => path.startsWith("companyMarkets/"))![1];
    expect(catalog.unitPrice).toBe(input.unitPrice);
    expect(catalog).not.toHaveProperty("price");
    expect(catalog.unitPrice).not.toBe(999999);
    expect(relationship).not.toHaveProperty("countryId");
    expect(relationship).not.toHaveProperty("currencyCode");
    for (const record of [catalog, relationship, repository.documents.get(`companies/${input.companyId}`)!]) {
      expect(record).toMatchObject({ createdBy: "ACTOR_B", updatedBy: "ACTOR_B" });
    }
  });

  it("failed apply and a transaction race produce zero writes", async () => {
    const input = manifest(); const invalid = new MemoryRepository(input);
    invalid.documents.get(`products/${input.productId}`)!.active = false;
    expect((await executeConfiguration("apply", input, options(input), dependencies(invalid))).status).toBe("BLOCKED");
    expect(invalid.creates).toEqual([]);
    const raced = new MemoryRepository(input);
    raced.transactionRace = () => { raced.documents.set(`companies/${input.companyId}`, { collision: true }); };
    expect((await executeConfiguration("apply", input, options(input), dependencies(raced))).code).toBe("TARGET_ALREADY_EXISTS");
    expect(raced.creates).toEqual([]);
  });

  it("requires exact apply and rollback confirmations", async () => {
    const input = manifest();
    expect((await executeConfiguration("apply", input, { actorEmail: "operator@example.invalid" }, dependencies(new MemoryRepository(input)))).code).toBe("APPLY_CONFIRMATION_REQUIRED");
    expect((await executeConfiguration("rollback", input, { actorEmail: "operator@example.invalid" }, dependencies(new MemoryRepository(input)))).code).toBe("ROLLBACK_CONFIRMATION_REQUIRED");
  });

  it("normalizes both legacy references with exactly two partial updates", async () => {
    const input = manifest();
    const repository = new MemoryRepository(input);
    const paths = legacyReferences(repository, input);
    const result = await executeConfiguration("normalize-references", input, options(input, "NORMALIZE_MISSING_REFERENCE_FIELDS"), dependencies(repository));
    expect(result).toEqual({ status: "PASS", code: "NORMALIZE_REFERENCES_PASS", mode: "normalize-references" });
    expect(repository.updates.map(update => update.path)).toEqual([paths.productPath, paths.countryPath]);
    expect(repository.documents.get(paths.productPath)).toMatchObject({ productId: input.productId, active: true, createdAt: "2032-01-02T03:04:05.000Z", updatedAt: NOW, createdBy: "ACTOR_SEED", updatedBy: "ACTOR_SEED", legacyProductField: "preserved-product", price: 999999 });
    expect(repository.documents.get(paths.countryPath)).toMatchObject({ countryId: market(input).countryId, active: true, createdAt: "2032-01-02T03:04:05.000Z", updatedAt: NOW, createdBy: "ACTOR_A", updatedBy: "ACTOR_A", legacyCountryField: "preserved-country" });
    expect(repository.updates[0].fields).toMatchObject({ productId: input.productId });
    expect(repository.updates[1].fields).toMatchObject({ countryId: market(input).countryId });
    expect(validateProductReference(repository.documents.get(paths.productPath))).toMatchObject({ valid: true });
    expect(validateCountryReference(repository.documents.get(paths.countryPath))).toMatchObject({ valid: true });
    expect(JSON.stringify(result)).not.toContain("ACTOR_A");
    expect(JSON.stringify(result)).not.toContain("operator@example.invalid");
  });

  it("preserves existing canonical fields and never writes or copies price", async () => {
    const input = manifest("B");
    const repository = new MemoryRepository(input, "B");
    const productPath = `products/${input.productId}`;
    const countryPath = `countries/${market(input, "B").countryId}`;
    const beforeProduct = structuredClone(repository.documents.get(productPath));
    const beforeCountry = structuredClone(repository.documents.get(countryPath));
    expect((await executeConfiguration("normalize-references", input, options(input, "NORMALIZE_MISSING_REFERENCE_FIELDS"), dependencies(repository, actor("ACTOR_B")))).status).toBe("PASS");
    expect(repository.updates).toEqual([]);
    expect(repository.documents.get(productPath)).toEqual(beforeProduct);
    expect(repository.documents.get(countryPath)).toEqual(beforeCountry);
  });

  it("repairs invalid legacy timestamps from createTime and the server clock", async () => {
    const input = manifest(); const repository = new MemoryRepository(input);
    const productPath = `products/${input.productId}`;
    const countryPath = `countries/${market(input).countryId}`;
    for (const path of [productPath, countryPath]) {
      repository.documents.get(path)!.createdAt = "legacy-created-at";
      repository.documents.get(path)!.updatedAt = "legacy-updated-at";
    }
    expect((await executeConfiguration("normalize-references", input, options(input, "NORMALIZE_MISSING_REFERENCE_FIELDS"), dependencies(repository))).status).toBe("PASS");
    for (const path of [productPath, countryPath]) expect(repository.documents.get(path)).toMatchObject({ createdAt: "2032-01-02T03:04:05.000Z", updatedAt: NOW });
  });

  it("repairs missing and invalid actor fields while preserving valid actors", async () => {
    const input = manifest(); const repository = new MemoryRepository(input);
    const productPath = `products/${input.productId}`;
    const countryPath = `countries/${market(input).countryId}`;
    repository.documents.get(productPath)!.createdBy = " invalid actor ";
    delete repository.documents.get(productPath)!.updatedBy;
    repository.documents.get(countryPath)!.createdBy = "ACTOR_HISTORICAL";
    repository.documents.get(countryPath)!.updatedBy = "invalid actor";
    expect((await executeConfiguration("normalize-references", input, options(input, "NORMALIZE_MISSING_REFERENCE_FIELDS"), dependencies(repository, actor("ACTOR_NORMALIZER")))).status).toBe("PASS");
    expect(repository.documents.get(productPath)).toMatchObject({ createdBy: "ACTOR_NORMALIZER", updatedBy: "ACTOR_NORMALIZER" });
    expect(repository.documents.get(countryPath)).toMatchObject({ createdBy: "ACTOR_HISTORICAL", updatedBy: "ACTOR_NORMALIZER" });
    expect(validateProductReference(repository.documents.get(productPath))).toMatchObject({ valid: true });
    expect(validateCountryReference(repository.documents.get(countryPath))).toMatchObject({ valid: true });
  });

  it("rejects conflicting active and embedded identifier values", async () => {
    const input = manifest();
    const inactive = new MemoryRepository(input); legacyReferences(inactive, input); inactive.documents.get(`products/${input.productId}`)!.active = false;
    expect((await executeConfiguration("normalize-references", input, options(input, "NORMALIZE_MISSING_REFERENCE_FIELDS"), dependencies(inactive))).code).toBe("REFERENCE_CANONICAL_CONFLICT");
    expect(inactive.updates).toEqual([]);
    const mismatch = new MemoryRepository(input); legacyReferences(mismatch, input); mismatch.documents.get(`countries/${market(input).countryId}`)!.countryId = "DIFFERENT_COUNTRY";
    expect((await executeConfiguration("normalize-references", input, options(input, "NORMALIZE_MISSING_REFERENCE_FIELDS"), dependencies(mismatch))).code).toBe("DOCUMENT_ID_MISMATCH");
    expect(mismatch.updates).toEqual([]);
  });

  it.each(["product", "market", "country"] as const)("blocks normalization when %s is missing", async kind => {
    const input = manifest(); const repository = new MemoryRepository(input); const paths = legacyReferences(repository, input);
    repository.documents.delete(kind === "product" ? paths.productPath : kind === "country" ? paths.countryPath : `marketSettings/${input.marketId}`);
    const result = await executeConfiguration("normalize-references", input, options(input, "NORMALIZE_MISSING_REFERENCE_FIELDS"), dependencies(repository));
    expect(result.status).toBe("BLOCKED");
    expect(repository.updates).toEqual([]);
  });

  it("blocks normalization on actor failure or unavailable creation timestamp", async () => {
    const input = manifest(); const actorFailure = new MemoryRepository(input); legacyReferences(actorFailure, input);
    const failingActor: ActorResolver = { async resolveUid() { throw new Error("provider detail"); } };
    expect((await executeConfiguration("normalize-references", input, options(input, "NORMALIZE_MISSING_REFERENCE_FIELDS"), dependencies(actorFailure, failingActor))).code).toBe("ACTOR_LOOKUP_FAILED");
    expect(actorFailure.updates).toEqual([]);
    const missingTime = new MemoryRepository(input); const paths = legacyReferences(missingTime, input); missingTime.creationTimes.delete(paths.productPath);
    expect((await executeConfiguration("normalize-references", input, options(input, "NORMALIZE_MISSING_REFERENCE_FIELDS"), dependencies(missingTime))).code).toBe("REFERENCE_CREATION_TIME_UNAVAILABLE");
    expect(missingTime.updates).toEqual([]);
    const invalidTime = new MemoryRepository(input); const invalidPaths = legacyReferences(invalidTime, input); invalidTime.creationTimes.set(invalidPaths.countryPath, "invalid-create-time");
    expect((await executeConfiguration("normalize-references", input, options(input, "NORMALIZE_MISSING_REFERENCE_FIELDS"), dependencies(invalidTime))).code).toBe("REFERENCE_CREATION_TIME_UNAVAILABLE");
    expect(invalidTime.updates).toEqual([]);
  });

  it("revalidates transaction state and produces zero writes on a race", async () => {
    const input = manifest(); const repository = new MemoryRepository(input); const paths = legacyReferences(repository, input);
    repository.transactionRace = () => { repository.documents.get(paths.countryPath)!.active = false; };
    expect((await executeConfiguration("normalize-references", input, options(input, "NORMALIZE_MISSING_REFERENCE_FIELDS"), dependencies(repository))).code).toBe("REFERENCE_CANONICAL_CONFLICT");
    expect(repository.updates).toEqual([]);
  });

  it("requires exact normalization confirmations", async () => {
    const input = manifest(); const repository = new MemoryRepository(input); legacyReferences(repository, input);
    expect((await executeConfiguration("normalize-references", input, { actorEmail: "operator@example.invalid" }, dependencies(repository))).code).toBe("NORMALIZATION_CONFIRMATION_REQUIRED");
    expect(repository.updates).toEqual([]);
  });

  it("verifies an applied registry", async () => {
    const input = manifest(); const repository = await applied(input);
    expect(await executeConfiguration("verify", input, {}, dependencies(repository))).toEqual({ status: "PASS", code: "VERIFY_PASS", mode: "verify" });
  });

  it("verify rejects a missing persisted embedded ID instead of synthesizing it", async () => {
    const input = manifest(); const repository = await applied(input);
    delete repository.documents.get(`products/${input.productId}`)!.productId;
    expect(await executeConfiguration("verify", input, {}, dependencies(repository))).toEqual({
      status: "BLOCKED",
      code: "DOCUMENT_ID_MISMATCH",
      mode: "verify",
      details: [`products/${input.productId}.productId`],
    });
  });

  it("produces references accepted by the runtime repository after normalization", async () => {
    const input = manifest(); const repository = new MemoryRepository(input); const paths = legacyReferences(repository, input);
    expect((await executeConfiguration("normalize-references", input, options(input, "NORMALIZE_MISSING_REFERENCE_FIELDS"), dependencies(repository))).status).toBe("PASS");
    const runtime = runtimeRepository(repository.documents);
    await expect(runtime.readProducts({ ids: [input.productId], limit: 1 })).resolves.toMatchObject({ records: [{ productId: input.productId, price: 999999, legacyProductField: "preserved-product" }] });
    await expect(runtime.readCountries({ ids: [market(input).countryId], limit: 1 })).resolves.toMatchObject({ records: [{ countryId: market(input).countryId, legacyCountryField: "preserved-country" }] });
    expect(repository.updates.map(update => update.path)).toEqual([paths.productPath, paths.countryPath]);
  });

  it("rolls back only the exact unchanged changeset in dependency order", async () => {
    const input = manifest(); const repository = await applied(input);
    expect(await executeConfiguration("rollback", input, options(input, "DELETE_EXACT_CHANGESET"), dependencies(repository))).toEqual({ status: "PASS", code: "ROLLBACK_PASS", mode: "rollback" });
    expect(repository.deletes.map(path => path.split("/")[0])).toEqual(["productMarketCatalog", "companyMarkets", "companies"]);
    expect(repository.documents.has(`products/${input.productId}`)).toBe(true);
    expect(repository.documents.has(`countries/${market(input).countryId}`)).toBe(true);
    expect(repository.documents.has(`marketSettings/${input.marketId}`)).toBe(true);
  });

  it("rollback refuses changed, later-modified, missing, or different-actor targets", async () => {
    const input = manifest();
    for (const mutate of [
      (repository: MemoryRepository) => { [...repository.documents.entries()].find(([path]) => path.startsWith("productMarketCatalog/"))![1].unitPrice = 88; },
      (repository: MemoryRepository) => { repository.documents.get(`companies/${input.companyId}`)!.updatedAt = "2035-01-01T00:00:00.000Z"; },
      (repository: MemoryRepository) => { repository.documents.delete(`companies/${input.companyId}`); },
    ]) {
      const repository = await applied(input); mutate(repository);
      expect((await executeConfiguration("rollback", input, options(input, "DELETE_EXACT_CHANGESET"), dependencies(repository))).status).toBe("BLOCKED");
      expect(repository.deletes).toEqual([]);
    }
    const repository = await applied(input, "A", "ACTOR_B");
    expect((await executeConfiguration("rollback", input, options(input, "DELETE_EXACT_CHANGESET"), dependencies(repository, actor("ACTOR_A")))).code).toBe("ROLLBACK_AUDIT_MISMATCH");
  });

  it("supports distinct canonical configurations without embedded environment identifiers", async () => {
    const first = manifest("A"), second = manifest("B");
    const firstPlan = buildPlan(first, await readForPlan(new MemoryRepository(first), first), "ACTOR_A", NOW);
    const secondPlan = buildPlan(second, await readForPlan(new MemoryRepository(second, "B"), second), "ACTOR_B", NOW);
    expect(firstPlan.companyMarketId).not.toBe(secondPlan.companyMarketId);
    expect(firstPlan.countryId).not.toBe(secondPlan.countryId);
    expect(firstPlan.currencyCode).not.toBe(secondPlan.currencyCode);
  });

  it("contains no fixture identifiers, operator emails, or global-price access in CLI source", () => {
    const source = fs.readFileSync(new URL("./offersRegistryConfigurationCli.ts", import.meta.url), "utf8");
    for (const forbidden of ["COMPANY_A", "COUNTRY_A", "MARKET_A", "PRODUCT_A", "operator@example.invalid"]) expect(source).not.toContain(forbidden);
    expect(source).not.toMatch(/product(?:Data)?\s*\.\s*price|product\s*\[\s*["']price["']\s*\]/);
  });
});

describe("Product identity modes", () => {
  it("accepts only a bounded exact product identity manifest", () => {
    const input = identityManifest();
    expect(parseProductIdentityManifest(input)).toEqual(input);
    for (const invalid of [
      { ...input, extra: true },
      { ...input, productIds: [] },
      { ...input, productIds: ["PRODUCT_ONE", "PRODUCT_ONE"] },
      { ...input, productIds: [" PRODUCT_ONE"] },
      { ...input, productIds: Array.from({ length: 101 }, (_, index) => `PRODUCT_${index}`) },
    ]) expect(() => parseProductIdentityManifest(invalid)).toThrow();
  });

  it("diagnoses canonical, missing, mismatched, absent, and otherwise invalid products", async () => {
    const input = manifest();
    const repository = new MemoryRepository(input);
    const ids = ["PRODUCT_CANONICAL", "PRODUCT_MISSING_ID", "PRODUCT_MISMATCH", "PRODUCT_ABSENT", "PRODUCT_INVALID"];
    addCanonicalProduct(repository, ids[0]);
    addCanonicalProduct(repository, ids[1]); delete repository.documents.get(`products/${ids[1]}`)!.productId;
    addCanonicalProduct(repository, ids[2], { productId: "DIFFERENT_ID" });
    addCanonicalProduct(repository, ids[4], { active: "invalid" });
    const result = await executeProductIdentityConfiguration("diagnose-product-identities", identityManifest(ids), {}, dependencies(repository));
    expect(result).toEqual({
      status: "PASS", code: "PRODUCT_IDENTITY_DIAGNOSIS_COMPLETE", mode: "diagnose-product-identities",
      products: [
        { productId: ids[0], status: "CANONICAL" },
        { productId: ids[1], status: "EMBEDDED_ID_MISSING" },
        { productId: ids[2], status: "EMBEDDED_ID_MISMATCH" },
        { productId: ids[3], status: "DOCUMENT_MISSING" },
        { productId: ids[4], status: "PRODUCT_REFERENCE_INVALID" },
      ],
    });
    expect(repository.updates).toEqual([]);
  });

  it("atomically repairs multiple identities and changes only permitted fields", async () => {
    const input = manifest(); const repository = new MemoryRepository(input);
    const ids = ["PRODUCT_MISSING_ID", "PRODUCT_MISMATCH", "PRODUCT_CANONICAL"];
    for (const id of ids) addCanonicalProduct(repository, id, { customBusinessField: `preserve-${id}` });
    delete repository.documents.get(`products/${ids[0]}`)!.productId;
    repository.documents.get(`products/${ids[1]}`)!.productId = "DIFFERENT_ID";
    const before = ids.map(id => structuredClone(repository.documents.get(`products/${id}`)!));
    const identityInput = identityManifest(ids);
    const result = await executeProductIdentityConfiguration("repair-product-identities", identityInput, repairOptions(identityInput), dependencies(repository, actor("ACTOR_REPAIR")));
    expect(result).toMatchObject({ status: "PASS", code: "PRODUCT_IDENTITIES_REPAIRED", products: [{ status: "REPAIRED" }, { status: "REPAIRED" }, { status: "UNCHANGED" }] });
    expect(repository.updates).toEqual([
      { path: `products/${ids[0]}`, fields: { productId: ids[0], updatedAt: NOW, updatedBy: "ACTOR_REPAIR" } },
      { path: `products/${ids[1]}`, fields: { productId: ids[1], updatedAt: NOW, updatedBy: "ACTOR_REPAIR" } },
    ]);
    for (let index = 0; index < 2; index += 1) {
      const after = repository.documents.get(`products/${ids[index]}`)!;
      expect(after).toMatchObject({ sku: before[index].sku, code: before[index].code, price: before[index].price, stock: before[index].stock, createdAt: before[index].createdAt, createdBy: before[index].createdBy, customBusinessField: before[index].customBusinessField });
    }
    expect(repository.documents.get(`products/${ids[2]}`)).toEqual(before[2]);
  });

  it("aborts the entire repair for a missing or non-identity-invalid product", async () => {
    for (const failure of ["missing", "invalid"] as const) {
      const base = manifest(); const repository = new MemoryRepository(base);
      const ids = ["PRODUCT_REPAIRABLE", "PRODUCT_FAILURE"];
      addCanonicalProduct(repository, ids[0]); delete repository.documents.get(`products/${ids[0]}`)!.productId;
      if (failure === "invalid") addCanonicalProduct(repository, ids[1], { active: "invalid" });
      const identityInput = identityManifest(ids);
      expect(await executeProductIdentityConfiguration("repair-product-identities", identityInput, repairOptions(identityInput), dependencies(repository))).toMatchObject({ status: "BLOCKED", code: "PRODUCT_IDENTITY_BATCH_INVALID" });
      expect(repository.updates).toEqual([]);
      expect(repository.documents.get(`products/${ids[0]}`)).not.toHaveProperty("productId");
    }
  });

  it("blocks bad confirmation, actor lookup, and clock with zero writes", async () => {
    const base = manifest(); const identityInput = identityManifest();
    for (const kind of ["confirmation", "actor", "clock"] as const) {
      const repository = new MemoryRepository(base); addCanonicalProduct(repository, identityInput.productIds[0]); delete repository.documents.get(`products/${identityInput.productIds[0]}`)!.productId;
      const resolver: ActorResolver = kind === "actor" ? { async resolveUid() { throw new Error("private"); } } : actor();
      const result = await executeProductIdentityConfiguration("repair-product-identities", identityInput, kind === "confirmation" ? {} : repairOptions(identityInput), dependencies(repository, resolver, kind === "clock" ? () => "invalid" : () => NOW));
      expect(result.status).toBe("BLOCKED");
      expect(repository.updates).toEqual([]);
    }
  });

  it("uses exact document reads, no collection discovery, and tolerates transaction retry", async () => {
    const base = manifest(); const repository = new MemoryRepository(base); const identityInput = identityManifest(["PRODUCT_RETRY"]);
    addCanonicalProduct(repository, identityInput.productIds[0]); delete repository.documents.get(`products/${identityInput.productIds[0]}`)!.productId;
    const readBatches: readonly string[][] = [];
    let attempts = 0;
    const retryingRepository: OffersRegistryRepository = {
      readMarket: path => repository.readMarket(path),
      readRemaining: paths => repository.readRemaining(paths),
      async transact(work) {
        attempts += 1;
        await work({ readMarket: path => repository.readMarket(path), readRemaining: async paths => { (readBatches as string[][]).push([...paths]); return repository.readRemaining(paths); }, create() {}, update() {}, delete() {} });
        attempts += 1;
        return repository.transact(work);
      },
    };
    expect((await executeProductIdentityConfiguration("repair-product-identities", identityInput, repairOptions(identityInput), { ...dependencies(repository), repository: retryingRepository })).status).toBe("PASS");
    expect(attempts).toBe(2);
    expect(readBatches).toEqual([[`products/${identityInput.productIds[0]}`]]);
    expect(repository.updates).toHaveLength(1);
  });
});

describe("Exact Product reference normalization", () => {
  it("parses only the strict normalization manifest", () => {
    const input = normalizationManifest();
    expect(parseProductNormalizationManifest(input)).toEqual(input);
    expect(() => parseProductNormalizationManifest({ ...input, active: "true" })).toThrow("MANIFEST_FIELD_INVALID");
    expect(() => parseProductNormalizationManifest({ ...input, unexpected: true })).toThrow("MANIFEST_SCHEMA_INVALID");
  });

  it("normalizes only the four authorized fields and preserves every other field", async () => {
    const base = manifest(); const repository = new MemoryRepository(base); const input = normalizationManifest(["PRODUCT_LEGACY"]);
    addCanonicalProduct(repository, input.productIds[0], { active: "legacy", createdAt: "legacy", updatedAt: "legacy", updatedBy: "LEGACY_ACTOR", customBusinessField: "preserved" });
    delete repository.documents.get(`products/${input.productIds[0]}`)!.productId;
    repository.creationTimes.set(`products/${input.productIds[0]}`, "2032-02-03T04:05:06.000Z");
    const before = structuredClone(repository.documents.get(`products/${input.productIds[0]}`)!);
    const result = await executeProductNormalizationConfiguration(input, normalizationOptions(input), dependencies(repository, actor("ACTOR_NORMALIZE")));
    expect(result).toEqual({ status: "PASS", code: "PRODUCT_REFERENCES_NORMALIZED", mode: "normalize-product-references", products: [{ productId: input.productIds[0], status: "NORMALIZED" }] });
    expect(repository.updates).toEqual([{ path: `products/${input.productIds[0]}`, fields: { active: true, createdAt: "2032-02-03T04:05:06.000Z", updatedAt: NOW, updatedBy: "ACTOR_NORMALIZE" } }]);
    const after = repository.documents.get(`products/${input.productIds[0]}`)!;
    for (const field of ["name", "sku", "code", "price", "stock", "createdBy", "customBusinessField"] as const) expect(after[field]).toEqual(before[field]);
    expect(after).not.toHaveProperty("productId");
  });

  it("aborts with zero writes on validation failure", async () => {
    const base = manifest(); const repository = new MemoryRepository(base); const input = normalizationManifest(["PRODUCT_VALID", "PRODUCT_INVALID"]);
    for (const id of input.productIds) { addCanonicalProduct(repository, id); delete repository.documents.get(`products/${id}`)!.productId; }
    repository.documents.get(`products/${input.productIds[1]}`)!.createdBy = " invalid actor ";
    expect(await executeProductNormalizationConfiguration(input, normalizationOptions(input), dependencies(repository))).toMatchObject({ status: "BLOCKED", code: "PRODUCT_NORMALIZATION_BATCH_INVALID" });
    expect(repository.updates).toEqual([]);
  });

  it("returns a sanitized failure and zero writes when the transaction precondition fails", async () => {
    const base = manifest(); const repository = new MemoryRepository(base); const input = normalizationManifest();
    addCanonicalProduct(repository, input.productIds[0]);
    const preconditionRepository: OffersRegistryRepository = {
      readMarket: path => repository.readMarket(path),
      readRemaining: paths => repository.readRemaining(paths),
      async transact() { throw new Error("private update-time conflict"); },
    };
    expect(await executeProductNormalizationConfiguration(input, normalizationOptions(input), { ...dependencies(repository), repository: preconditionRepository })).toEqual({ status: "BLOCKED", code: "UNEXPECTED_ERROR", mode: "normalize-product-references" });
    expect(repository.updates).toEqual([]);
  });

  it("resolves the actor through the existing resolver and requires exact confirmation", async () => {
    const base = manifest(); const repository = new MemoryRepository(base); const input = normalizationManifest();
    addCanonicalProduct(repository, input.productIds[0]); delete repository.documents.get(`products/${input.productIds[0]}`)!.productId;
    const emails: string[] = [];
    const resolver: ActorResolver = { async resolveUid(email) { emails.push(email); return "ACTOR_RESOLVED"; } };
    expect((await executeProductNormalizationConfiguration(input, normalizationOptions(input), dependencies(repository, resolver))).status).toBe("PASS");
    expect(emails).toEqual(["operator@example.invalid"]);
    const blocked = new MemoryRepository(base); addCanonicalProduct(blocked, input.productIds[0]);
    expect((await executeProductNormalizationConfiguration(input, { actorEmail: "operator@example.invalid" }, dependencies(blocked, resolver))).code).toBe("PRODUCT_NORMALIZATION_CONFIRMATION_REQUIRED");
    expect(blocked.updates).toEqual([]);
  });
});

async function readForPlan(repository: MemoryRepository, input: OffersRegistryManifest) {
  const marketDoc = await repository.readMarket(`marketSettings/${input.marketId}`);
  const countryId = (marketDoc.data as unknown as MarketBusinessSettings).countryId;
  const companyMarketId = `CM_${input.companyId.length}:${input.companyId}_${input.marketId.length}:${input.marketId}`;
  const catalogEntryId = `PMC_${input.companyId.length}:${input.companyId}_${input.marketId.length}:${input.marketId}_${input.productId.length}:${input.productId}_${input.productEffectiveFrom}`;
  const remaining = await repository.readRemaining([`products/${input.productId}`, `countries/${countryId}`, `companies/${input.companyId}`, `companyMarkets/${companyMarketId}`, `productMarketCatalog/${catalogEntryId}`]);
  return { market: marketDoc, product: remaining[0], country: remaining[1], company: remaining[2], companyMarket: remaining[3], catalog: remaining[4] };
}
