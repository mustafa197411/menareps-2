import fs from "node:fs";
import { pathToFileURL } from "node:url";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import {
  COMMERCIAL_REGISTRY_SCHEMA_VERSION,
  deterministicCompanyMarketId,
  deterministicProductMarketCatalogId,
  validateCommercialRegistry,
  validateCompanyMarketAssignment,
  validateCompanyRecord,
  validateCountryReference,
  validateProductMarketCatalogEntry,
  validateProductReference,
  type CompanyMarketAssignment,
  type CompanyRecord,
  type ProductMarketCatalogEntry,
} from "../src/lib/commercialRegistry";
import { validateMarketSettings, type MarketBusinessSettings } from "../src/lib/marketSettings";
import { getFirebaseAdminServices } from "./firebaseAdmin";
import { getFirebaseRuntimeIdentity } from "./firebaseRuntimeIdentity";

export type ConfigurationMode = "preflight" | "dry-run" | "apply" | "verify" | "rollback" | "normalize-references" | "diagnose-product-identities" | "repair-product-identities" | "normalize-product-references";
type RegistryConfigurationMode = Exclude<ConfigurationMode, "diagnose-product-identities" | "repair-product-identities" | "normalize-product-references">;

export interface OffersRegistryManifest {
  projectId: string;
  databaseId: string;
  companyId: string;
  companyName: string;
  marketId: string;
  productId: string;
  unitPrice: number;
  relationshipEffectiveFrom: string;
  productEffectiveFrom: string;
  active: boolean;
  saleable: boolean;
}

export interface ProductIdentityManifest {
  projectId: string;
  databaseId: string;
  productIds: string[];
}

export interface ProductNormalizationManifest extends ProductIdentityManifest {
  active: boolean;
}

export type ProductIdentityStatus =
  | "CANONICAL"
  | "EMBEDDED_ID_MISSING"
  | "EMBEDDED_ID_MISMATCH"
  | "DOCUMENT_MISSING"
  | "PRODUCT_REFERENCE_INVALID"
  | "REPAIRED"
  | "NORMALIZED"
  | "UNCHANGED";

export interface ProductIdentityResult { productId: string; status: ProductIdentityStatus }

export interface StoredDocument { id: string; exists: boolean; data?: Record<string, unknown>; createTime?: string }
export interface RegistryReadSet { product: StoredDocument; country: StoredDocument; market: StoredDocument; company: StoredDocument; companyMarket: StoredDocument; catalog: StoredDocument }
export interface RegistryTransaction {
  readMarket(path: string): Promise<StoredDocument>;
  readRemaining(paths: readonly string[]): Promise<StoredDocument[]>;
  create(path: string, data: Record<string, unknown>): void;
  update(path: string, data: Record<string, unknown>): void;
  delete(path: string): void;
}
export interface OffersRegistryRepository {
  readMarket(path: string): Promise<StoredDocument>;
  readRemaining(paths: readonly string[]): Promise<StoredDocument[]>;
  transact<T>(work: (transaction: RegistryTransaction) => Promise<T>): Promise<T>;
}
export interface ActorResolver { resolveUid(email: string): Promise<string> }
export interface ConfigurationDependencies { repository: OffersRegistryRepository; actorResolver: ActorResolver; clock: () => string }

export interface ConfigurationPlan {
  manifest: OffersRegistryManifest;
  countryId: string;
  currencyCode: string;
  productName: string;
  companyMarketId: string;
  catalogEntryId: string;
  paths: { product: string; country: string; market: string; company: string; companyMarket: string; catalog: string };
  records: { company: CompanyRecord; companyMarket: CompanyMarketAssignment; catalog: ProductMarketCatalogEntry };
}

export interface ConfigurationResult {
  status: "PASS" | "BLOCKED";
  code: string;
  mode: ConfigurationMode;
  details?: string[];
  manifest?: Record<string, unknown>;
  products?: ProductIdentityResult[];
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const MANIFEST_KEYS = ["projectId", "databaseId", "companyId", "companyName", "marketId", "productId", "unitPrice", "relationshipEffectiveFrom", "productEffectiveFrom", "active", "saleable"] as const;
const PRODUCT_IDENTITY_MANIFEST_KEYS = ["projectId", "databaseId", "productIds"] as const;
const PRODUCT_NORMALIZATION_MANIFEST_KEYS = ["projectId", "databaseId", "productIds", "active"] as const;
const exactTimestamp = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const exactId = (value: unknown): value is string => typeof value === "string" && value === value.trim() && ID.test(value);
const firestoreDatabaseId = (value: unknown): value is string => typeof value === "string" && (
  value === "(default)"
  || (value === value.trim() && /^[a-z][a-z0-9-]{2,61}[a-z0-9]$/.test(value))
);
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

export class ConfigurationError extends Error {
  constructor(public readonly code: string, public readonly details: string[] = []) { super(code); this.name = "ConfigurationError"; }
}

export function parseManifest(input: unknown): OffersRegistryManifest {
  const value = record(input);
  if (!value || Object.keys(value).sort().join("\0") !== [...MANIFEST_KEYS].sort().join("\0")) throw new ConfigurationError("MANIFEST_SCHEMA_INVALID");
  for (const field of ["projectId", "companyId", "marketId", "productId"] as const) if (!exactId(value[field])) throw new ConfigurationError("MANIFEST_FIELD_INVALID", [field]);
  if (!firestoreDatabaseId(value.databaseId)) throw new ConfigurationError("MANIFEST_FIELD_INVALID", ["databaseId"]);
  if (typeof value.companyName !== "string" || !value.companyName.trim() || value.companyName !== value.companyName.trim()) throw new ConfigurationError("MANIFEST_FIELD_INVALID", ["companyName"]);
  if (typeof value.unitPrice !== "number" || !Number.isFinite(value.unitPrice) || value.unitPrice < 0) throw new ConfigurationError("MANIFEST_FIELD_INVALID", ["unitPrice"]);
  for (const field of ["relationshipEffectiveFrom", "productEffectiveFrom"] as const) if (!exactTimestamp(value[field])) throw new ConfigurationError("MANIFEST_FIELD_INVALID", [field]);
  if (typeof value.active !== "boolean" || typeof value.saleable !== "boolean") throw new ConfigurationError("MANIFEST_FIELD_INVALID", ["active", "saleable"]);
  return value as unknown as OffersRegistryManifest;
}

export function parseProductIdentityManifest(input: unknown): ProductIdentityManifest {
  const value = record(input);
  if (!value || Object.keys(value).sort().join("\0") !== [...PRODUCT_IDENTITY_MANIFEST_KEYS].sort().join("\0")) throw new ConfigurationError("MANIFEST_SCHEMA_INVALID");
  if (!exactId(value.projectId)) throw new ConfigurationError("MANIFEST_FIELD_INVALID", ["projectId"]);
  if (!firestoreDatabaseId(value.databaseId)) throw new ConfigurationError("MANIFEST_FIELD_INVALID", ["databaseId"]);
  if (!Array.isArray(value.productIds) || value.productIds.length < 1 || value.productIds.length > 100) throw new ConfigurationError("MANIFEST_FIELD_INVALID", ["productIds"]);
  if (!value.productIds.every(exactId) || new Set(value.productIds).size !== value.productIds.length) throw new ConfigurationError("MANIFEST_FIELD_INVALID", ["productIds"]);
  return value as unknown as ProductIdentityManifest;
}

export function parseProductNormalizationManifest(input: unknown): ProductNormalizationManifest {
  const value = record(input);
  if (!value || Object.keys(value).sort().join("\0") !== [...PRODUCT_NORMALIZATION_MANIFEST_KEYS].sort().join("\0")) throw new ConfigurationError("MANIFEST_SCHEMA_INVALID");
  const identity = parseProductIdentityManifest({ projectId: value.projectId, databaseId: value.databaseId, productIds: value.productIds });
  if (typeof value.active !== "boolean") throw new ConfigurationError("MANIFEST_FIELD_INVALID", ["active"]);
  return { ...identity, active: value.active };
}

function canonical(document: StoredDocument, idField: string, path: string): Record<string, unknown> {
  if (!document.exists || !document.data) throw new ConfigurationError("REFERENCE_NOT_FOUND", [path]);
  if (document.data[idField] !== document.id) throw new ConfigurationError("DOCUMENT_ID_MISMATCH", [`${path}.${idField}`]);
  return document.data;
}

function canonicalForNormalization(document: StoredDocument, idField: string, path: string): { value: Record<string, unknown>; patch: Record<string, unknown> } {
  if (!document.exists || !document.data) throw new ConfigurationError("REFERENCE_NOT_FOUND", [path]);
  if (document.data[idField] !== undefined && document.data[idField] !== document.id) throw new ConfigurationError("DOCUMENT_ID_MISMATCH", [`${path}.${idField}`]);
  const patch = document.data[idField] === undefined ? { [idField]: document.id } : {};
  return { value: { ...document.data, ...patch }, patch };
}

function marketReference(document: StoredDocument, expectedId: string): MarketBusinessSettings {
  const value = canonical(document, "marketId", `marketSettings/${expectedId}`) as unknown as MarketBusinessSettings;
  const errors = validateMarketSettings(value);
  if (errors.length) throw new ConfigurationError("MARKET_REFERENCE_INVALID", errors.map(field => `marketSettings/${expectedId}.${field}`));
  if (value.marketId !== expectedId) throw new ConfigurationError("DOCUMENT_ID_MISMATCH", [`marketSettings/${expectedId}.marketId`]);
  if (!value.active) throw new ConfigurationError("MARKET_INACTIVE");
  return value;
}

function auditTime(clock: () => string): string {
  const value = clock();
  if (!exactTimestamp(value)) throw new ConfigurationError("AUDIT_TIMESTAMP_INVALID");
  return value;
}

async function auditActor(actorResolver: ActorResolver, email: string | undefined): Promise<string> {
  if (!email) throw new ConfigurationError("ACTOR_EMAIL_REQUIRED");
  try {
    const uid = await actorResolver.resolveUid(email);
    if (!exactId(uid)) throw new ConfigurationError("ACTOR_ID_INVALID");
    return uid;
  } catch (error) {
    if (error instanceof ConfigurationError) throw error;
    throw new ConfigurationError("ACTOR_LOOKUP_FAILED");
  }
}

function derivedPaths(manifest: OffersRegistryManifest, countryId: string) {
  const companyMarketId = deterministicCompanyMarketId(manifest.companyId, manifest.marketId);
  const catalogEntryId = deterministicProductMarketCatalogId(manifest.companyId, manifest.marketId, manifest.productId, manifest.productEffectiveFrom);
  return {
    companyMarketId, catalogEntryId,
    paths: {
      product: `products/${manifest.productId}`, country: `countries/${countryId}`, market: `marketSettings/${manifest.marketId}`,
      company: `companies/${manifest.companyId}`, companyMarket: `companyMarkets/${companyMarketId}`, catalog: `productMarketCatalog/${catalogEntryId}`,
    },
  };
}

function remainingPaths(manifest: OffersRegistryManifest, market: MarketBusinessSettings): string[] {
  const { paths } = derivedPaths(manifest, market.countryId);
  return [paths.product, paths.country, paths.company, paths.companyMarket, paths.catalog];
}

function readSet(manifest: OffersRegistryManifest, market: StoredDocument, remaining: StoredDocument[]): RegistryReadSet {
  if (remaining.length !== 5) throw new ConfigurationError("EXACT_READ_CONTRACT_VIOLATED");
  return { market, product: remaining[0], country: remaining[1], company: remaining[2], companyMarket: remaining[3], catalog: remaining[4] };
}

async function exactRead(manifest: OffersRegistryManifest, repository: OffersRegistryRepository): Promise<RegistryReadSet> {
  const market = await repository.readMarket(`marketSettings/${manifest.marketId}`);
  const parsedMarket = marketReference(market, manifest.marketId);
  return readSet(manifest, market, await repository.readRemaining(remainingPaths(manifest, parsedMarket)));
}

export function buildPlan(manifest: OffersRegistryManifest, reads: RegistryReadSet, actorUid: string, now: string): ConfigurationPlan {
  if (!exactId(actorUid)) throw new ConfigurationError("ACTOR_ID_INVALID");
  if (!exactTimestamp(now)) throw new ConfigurationError("AUDIT_TIMESTAMP_INVALID");
  const market = marketReference(reads.market, manifest.marketId);
  const product = canonical(reads.product, "productId", `products/${manifest.productId}`);
  const country = canonical(reads.country, "countryId", `countries/${market.countryId}`);
  const productValidation = validateProductReference(product, "product");
  const countryValidation = validateCountryReference(country, "country");
  const details = [...(productValidation.valid ? [] : productValidation.errors.map(value => value.path)), ...(countryValidation.valid ? [] : countryValidation.errors.map(value => value.path))];
  if (details.length) throw new ConfigurationError("REFERENCE_VALIDATION_FAILED", details);
  const productName = product.name;
  if (typeof productName !== "string" || !productName.trim()) throw new ConfigurationError("PRODUCT_NAME_INVALID");
  if (reads.company.exists || reads.companyMarket.exists || reads.catalog.exists) throw new ConfigurationError("TARGET_ALREADY_EXISTS");
  const { companyMarketId, catalogEntryId, paths } = derivedPaths(manifest, market.countryId);
  const audit = { createdAt: now, createdBy: actorUid, updatedAt: now, updatedBy: actorUid };
  const company: CompanyRecord = { schemaVersion: COMMERCIAL_REGISTRY_SCHEMA_VERSION, companyId: manifest.companyId, name: manifest.companyName, active: manifest.active, ...audit };
  const companyMarket: CompanyMarketAssignment = {
    schemaVersion: COMMERCIAL_REGISTRY_SCHEMA_VERSION, companyMarketId, companyId: manifest.companyId, marketId: manifest.marketId,
    active: manifest.active, effectiveFrom: manifest.relationshipEffectiveFrom, ...audit,
  };
  const catalog: ProductMarketCatalogEntry = { schemaVersion: COMMERCIAL_REGISTRY_SCHEMA_VERSION, catalogEntryId, companyMarketId, companyId: manifest.companyId, marketId: manifest.marketId, productId: manifest.productId, active: manifest.active, saleable: manifest.saleable, unitPrice: manifest.unitPrice, effectiveFrom: manifest.productEffectiveFrom, ...audit };
  const validations = [validateCompanyRecord(company), validateCompanyMarketAssignment(companyMarket), validateProductMarketCatalogEntry(catalog)];
  const invalid = validations.flatMap(value => value.valid ? [] : value.errors.map(error => `${error.code}:${error.path}`));
  const registry = validateCommercialRegistry({
    companies: [company],
    markets: [market],
    companyMarkets: [companyMarket],
    productMarketCatalog: [catalog],
    countries: [country],
    products: [product],
  });
  if (!registry.valid) invalid.push(...registry.errors.map(error => `${error.code}:${error.path}`));
  if (invalid.length) throw new ConfigurationError("PLAN_VALIDATION_FAILED", invalid);
  return { manifest, countryId: market.countryId, currencyCode: market.currencyCode, productName, companyMarketId, catalogEntryId, paths, records: { company, companyMarket, catalog } };
}

function sanitizedPlan(plan: ConfigurationPlan): Record<string, unknown> {
  const stripAudit = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === "createdBy" || key === "updatedBy" ? "<CANONICAL_ACTOR_UID>" : item]));
  return {
    operation: "CREATE_ONLY", projectId: plan.manifest.projectId, databaseId: plan.manifest.databaseId,
    derived: { countryId: plan.countryId, currencyCode: plan.currencyCode, productName: plan.productName, companyMarketId: plan.companyMarketId, catalogEntryId: plan.catalogEntryId },
    creates: [
      { path: plan.paths.company, data: stripAudit(plan.records.company as unknown as Record<string, unknown>) },
      { path: plan.paths.companyMarket, data: stripAudit(plan.records.companyMarket as unknown as Record<string, unknown>) },
      { path: plan.paths.catalog, data: stripAudit(plan.records.catalog as unknown as Record<string, unknown>) },
    ],
  };
}

async function prepare(manifest: OffersRegistryManifest, actorEmail: string | undefined, dependencies: ConfigurationDependencies): Promise<ConfigurationPlan> {
  const [reads, actorUid] = await Promise.all([exactRead(manifest, dependencies.repository), auditActor(dependencies.actorResolver, actorEmail)]);
  return buildPlan(manifest, reads, actorUid, auditTime(dependencies.clock));
}

function exactRecord(actual: StoredDocument, expected: Record<string, unknown>): boolean {
  return actual.exists && JSON.stringify(actual.data, Object.keys(actual.data || {}).sort()) === JSON.stringify(expected, Object.keys(expected).sort());
}

function missingCreatedAt(document: StoredDocument, patch: Record<string, unknown>): void {
  if (exactTimestamp(document.data?.createdAt)) return;
  if (!exactTimestamp(document.createTime)) throw new ConfigurationError("REFERENCE_CREATION_TIME_UNAVAILABLE");
  patch.createdAt = document.createTime;
}

function missingUpdatedAt(document: StoredDocument, patch: Record<string, unknown>, now: string): void {
  if (exactTimestamp(document.data?.updatedAt)) return;
  patch.updatedAt = now;
}

function missingActive(document: StoredDocument, patch: Record<string, unknown>): void {
  if (document.data?.active === undefined) patch.active = true;
  else if (document.data.active !== true) throw new ConfigurationError("REFERENCE_CANONICAL_CONFLICT", ["active"]);
}

function missingActor(document: StoredDocument, field: "createdBy" | "updatedBy", patch: Record<string, unknown>, actorUid: string): void {
  if (exactId(document.data?.[field])) return;
  patch[field] = actorUid;
}

function normalizedProduct(document: StoredDocument, manifest: OffersRegistryManifest, actorUid: string, now: string): { value: Record<string, unknown>; patch: Record<string, unknown> } {
  const canonicalReference = canonicalForNormalization(document, "productId", `products/${manifest.productId}`);
  const { value, patch } = canonicalReference;
  missingActive(document, patch);
  missingCreatedAt(document, patch);
  missingUpdatedAt(document, patch, now);
  missingActor(document, "createdBy", patch, actorUid);
  missingActor(document, "updatedBy", patch, actorUid);
  const normalized = { ...value, ...patch };
  const validation = validateProductReference(normalized, "product");
  if (!validation.valid) throw new ConfigurationError("REFERENCE_CANONICAL_CONFLICT", validation.errors.map(error => error.path));
  return { value: normalized, patch };
}

function normalizedCountry(document: StoredDocument, countryId: string, actorUid: string, now: string): { value: Record<string, unknown>; patch: Record<string, unknown> } {
  const canonicalReference = canonicalForNormalization(document, "countryId", `countries/${countryId}`);
  const { value, patch } = canonicalReference;
  missingActive(document, patch);
  missingCreatedAt(document, patch);
  missingUpdatedAt(document, patch, now);
  missingActor(document, "createdBy", patch, actorUid);
  missingActor(document, "updatedBy", patch, actorUid);
  const normalized = { ...value, ...patch };
  const validation = validateCountryReference(normalized, "country");
  if (!validation.valid) throw new ConfigurationError("REFERENCE_CANONICAL_CONFLICT", validation.errors.map(error => error.path));
  return { value: normalized, patch };
}

export async function executeConfiguration(mode: RegistryConfigurationMode, manifest: OffersRegistryManifest, options: { actorEmail?: string; confirmProject?: string; confirmMode?: string }, dependencies: ConfigurationDependencies): Promise<ConfigurationResult> {
  try {
    if (mode === "preflight" || mode === "dry-run") {
      const plan = await prepare(manifest, options.actorEmail, dependencies);
      return { status: "PASS", code: mode === "preflight" ? "PREFLIGHT_PASS" : "DRY_RUN_PASS", mode, ...(mode === "dry-run" ? { manifest: sanitizedPlan(plan) } : {}) };
    }
    if (mode === "apply") {
      if (options.confirmProject !== manifest.projectId || options.confirmMode !== "CREATE_ONLY") throw new ConfigurationError("APPLY_CONFIRMATION_REQUIRED");
      const actorUid = await auditActor(dependencies.actorResolver, options.actorEmail);
      await dependencies.repository.transact(async transaction => {
        const marketDoc = await transaction.readMarket(`marketSettings/${manifest.marketId}`);
        const market = marketReference(marketDoc, manifest.marketId);
        const reads = readSet(manifest, marketDoc, await transaction.readRemaining(remainingPaths(manifest, market)));
        const plan = buildPlan(manifest, reads, actorUid, auditTime(dependencies.clock));
        transaction.create(plan.paths.company, plan.records.company as unknown as Record<string, unknown>);
        transaction.create(plan.paths.companyMarket, plan.records.companyMarket as unknown as Record<string, unknown>);
        transaction.create(plan.paths.catalog, plan.records.catalog as unknown as Record<string, unknown>);
      });
      return { status: "PASS", code: "APPLY_PASS", mode };
    }
    if (mode === "normalize-references") {
      if (options.confirmProject !== manifest.projectId || options.confirmMode !== "NORMALIZE_MISSING_REFERENCE_FIELDS") throw new ConfigurationError("NORMALIZATION_CONFIRMATION_REQUIRED");
      const actorUid = await auditActor(dependencies.actorResolver, options.actorEmail);
      await dependencies.repository.transact(async transaction => {
        const marketDocument = await transaction.readMarket(`marketSettings/${manifest.marketId}`);
        const market = marketReference(marketDocument, manifest.marketId);
        const [productDocument, countryDocument] = await transaction.readRemaining([`products/${manifest.productId}`, `countries/${market.countryId}`]);
        if (!productDocument || !countryDocument) throw new ConfigurationError("EXACT_READ_CONTRACT_VIOLATED");
        const now = auditTime(dependencies.clock);
        const product = normalizedProduct(productDocument, manifest, actorUid, now);
        const country = normalizedCountry(countryDocument, market.countryId, actorUid, now);
        if (validateMarketSettings(market).length) throw new ConfigurationError("MARKET_REFERENCE_INVALID");
        if (Object.keys(product.patch).length) transaction.update(`products/${manifest.productId}`, product.patch);
        if (Object.keys(country.patch).length) transaction.update(`countries/${market.countryId}`, country.patch);
      });
      return { status: "PASS", code: "NORMALIZE_REFERENCES_PASS", mode };
    }
    if (mode === "verify") {
      const reads = await exactRead(manifest, dependencies.repository);
      const market = marketReference(reads.market, manifest.marketId);
      const product = canonical(reads.product, "productId", `products/${manifest.productId}`);
      const country = canonical(reads.country, "countryId", `countries/${market.countryId}`);
      if (!reads.company.exists || !reads.companyMarket.exists || !reads.catalog.exists) throw new ConfigurationError("CONFIGURATION_NOT_FOUND");
      const registry = validateCommercialRegistry({ companies: [canonical(reads.company, "companyId", "company")], markets: [market], companyMarkets: [canonical(reads.companyMarket, "companyMarketId", "companyMarket")], productMarketCatalog: [canonical(reads.catalog, "catalogEntryId", "catalog")], countries: [country], products: [product] });
      if (!registry.valid) throw new ConfigurationError("REGISTRY_VALIDATION_FAILED", registry.errors.map(error => `${error.code}:${error.path}`));
      const expected = buildExpectedWithoutAudit(manifest, market);
      if (!matchesExpected(reads, expected)) throw new ConfigurationError("CONFIGURATION_VALUE_MISMATCH");
      return { status: "PASS", code: "VERIFY_PASS", mode };
    }
    if (options.confirmProject !== manifest.projectId || options.confirmMode !== "DELETE_EXACT_CHANGESET") throw new ConfigurationError("ROLLBACK_CONFIRMATION_REQUIRED");
    const actorUid = await auditActor(dependencies.actorResolver, options.actorEmail);
    await dependencies.repository.transact(async transaction => {
      const expected = rollbackExpected(manifest);
      const [company, companyMarket, catalog] = await transaction.readRemaining([expected.paths.company, expected.paths.companyMarket, expected.paths.catalog]);
      for (const [key, document] of [["company", company], ["companyMarket", companyMarket], ["catalog", catalog]] as const) {
        if (!document.exists || !document.data) throw new ConfigurationError("ROLLBACK_TARGET_MISSING");
        const data = document.data;
        if (data.createdBy !== actorUid || data.updatedBy !== actorUid || data.createdAt !== data.updatedAt || !exactTimestamp(data.createdAt)) throw new ConfigurationError("ROLLBACK_AUDIT_MISMATCH");
        if (!exactRecord(document, { ...expected[key], createdAt: data.createdAt, createdBy: actorUid, updatedAt: data.createdAt, updatedBy: actorUid })) throw new ConfigurationError("ROLLBACK_TARGET_CHANGED");
      }
      transaction.delete(expected.paths.catalog);
      transaction.delete(expected.paths.companyMarket);
      transaction.delete(expected.paths.company);
    });
    return { status: "PASS", code: "ROLLBACK_PASS", mode };
  } catch (error) {
    const failure = error instanceof ConfigurationError ? error : new ConfigurationError("UNEXPECTED_ERROR");
    return { status: "BLOCKED", code: failure.code, mode, ...(failure.details.length ? { details: failure.details } : {}) };
  }
}

function productIdentityStatus(document: StoredDocument): ProductIdentityStatus {
  if (!document.exists || !document.data) return "DOCUMENT_MISSING";
  if (document.data.productId === undefined) return "EMBEDDED_ID_MISSING";
  if (document.data.productId !== document.id) return "EMBEDDED_ID_MISMATCH";
  return validateProductReference(document.data, `products/${document.id}`).valid ? "CANONICAL" : "PRODUCT_REFERENCE_INVALID";
}

function validateRepairCandidate(document: StoredDocument, actorUid: string, now: string): void {
  if (!document.exists || !document.data) throw new ConfigurationError("PRODUCT_IDENTITY_BATCH_INVALID", [document.id]);
  const candidate = { ...document.data, productId: document.id, updatedAt: now, updatedBy: actorUid };
  const validation = validateProductReference(candidate, `products/${document.id}`);
  if (!validation.valid) throw new ConfigurationError("PRODUCT_IDENTITY_BATCH_INVALID", [document.id]);
}

export async function executeProductIdentityConfiguration(
  mode: "diagnose-product-identities" | "repair-product-identities",
  manifest: ProductIdentityManifest,
  options: { actorEmail?: string; confirmProject?: string; confirmMode?: string },
  dependencies: ConfigurationDependencies,
): Promise<ConfigurationResult> {
  try {
    const paths = manifest.productIds.map(productId => `products/${productId}`);
    if (mode === "diagnose-product-identities") {
      const documents = await dependencies.repository.readRemaining(paths);
      if (documents.length !== paths.length) throw new ConfigurationError("EXACT_READ_CONTRACT_VIOLATED");
      return {
        status: "PASS",
        code: "PRODUCT_IDENTITY_DIAGNOSIS_COMPLETE",
        mode,
        products: documents.map(document => ({ productId: document.id, status: productIdentityStatus(document) })),
      };
    }

    if (options.confirmProject !== manifest.projectId || options.confirmMode !== "REPAIR_EXACT_PRODUCT_IDENTITIES") throw new ConfigurationError("PRODUCT_IDENTITY_REPAIR_CONFIRMATION_REQUIRED");
    const actorUid = await auditActor(dependencies.actorResolver, options.actorEmail);
    const products = await dependencies.repository.transact(async transaction => {
      const documents = await transaction.readRemaining(paths);
      if (documents.length !== paths.length) throw new ConfigurationError("EXACT_READ_CONTRACT_VIOLATED");
      const now = auditTime(dependencies.clock);
      const results: ProductIdentityResult[] = [];
      const repairs: StoredDocument[] = [];
      for (const document of documents) {
        const status = productIdentityStatus(document);
        if (status === "DOCUMENT_MISSING" || status === "PRODUCT_REFERENCE_INVALID") throw new ConfigurationError("PRODUCT_IDENTITY_BATCH_INVALID", [document.id]);
        if (status === "CANONICAL") {
          results.push({ productId: document.id, status: "UNCHANGED" });
          continue;
        }
        validateRepairCandidate(document, actorUid, now);
        repairs.push(document);
        results.push({ productId: document.id, status: "REPAIRED" });
      }
      for (const document of repairs) transaction.update(`products/${document.id}`, { productId: document.id, updatedAt: now, updatedBy: actorUid });
      return results;
    });
    return { status: "PASS", code: "PRODUCT_IDENTITIES_REPAIRED", mode, products };
  } catch (error) {
    const failure = error instanceof ConfigurationError ? error : new ConfigurationError("UNEXPECTED_ERROR");
    return { status: "BLOCKED", code: failure.code, mode, ...(failure.details.length ? { details: failure.details } : {}) };
  }
}

export async function executeProductNormalizationConfiguration(
  manifest: ProductNormalizationManifest,
  options: { actorEmail?: string; confirmProject?: string; confirmMode?: string },
  dependencies: ConfigurationDependencies,
): Promise<ConfigurationResult> {
  const mode = "normalize-product-references" as const;
  try {
    if (options.confirmProject !== manifest.projectId || options.confirmMode !== "NORMALIZE_EXACT_PRODUCT_REFERENCES") throw new ConfigurationError("PRODUCT_NORMALIZATION_CONFIRMATION_REQUIRED");
    const actorUid = await auditActor(dependencies.actorResolver, options.actorEmail);
    const products = await dependencies.repository.transact(async transaction => {
      const paths = manifest.productIds.map(productId => `products/${productId}`);
      const documents = await transaction.readRemaining(paths);
      if (documents.length !== paths.length) throw new ConfigurationError("EXACT_READ_CONTRACT_VIOLATED");
      const now = auditTime(dependencies.clock);
      const patches: Array<{ document: StoredDocument; fields: Record<string, unknown> }> = [];
      for (const document of documents) {
        if (!document.exists || !document.data) throw new ConfigurationError("PRODUCT_NORMALIZATION_BATCH_INVALID", [document.id]);
        if (!exactTimestamp(document.createTime)) throw new ConfigurationError("PRODUCT_CREATION_TIME_INVALID", [document.id]);
        const fields = { active: manifest.active, createdAt: document.createTime, updatedAt: now, updatedBy: actorUid };
        const validation = validateProductReference({ ...document.data, productId: document.id, ...fields }, `products/${document.id}`);
        if (!validation.valid) throw new ConfigurationError("PRODUCT_NORMALIZATION_BATCH_INVALID", [document.id]);
        patches.push({ document, fields });
      }
      for (const { document, fields } of patches) transaction.update(`products/${document.id}`, fields);
      return documents.map(document => ({ productId: document.id, status: "NORMALIZED" as const }));
    });
    return { status: "PASS", code: "PRODUCT_REFERENCES_NORMALIZED", mode, products };
  } catch (error) {
    const failure = error instanceof ConfigurationError ? error : new ConfigurationError("UNEXPECTED_ERROR");
    return { status: "BLOCKED", code: failure.code, mode, ...(failure.details.length ? { details: failure.details } : {}) };
  }
}

function buildExpectedWithoutAudit(manifest: OffersRegistryManifest, market: MarketBusinessSettings) {
  const { companyMarketId, catalogEntryId, paths } = derivedPaths(manifest, market.countryId);
  return {
    paths,
    company: { schemaVersion: 1, companyId: manifest.companyId, name: manifest.companyName, active: manifest.active },
    companyMarket: { schemaVersion: 1, companyMarketId, companyId: manifest.companyId, marketId: manifest.marketId, active: manifest.active, effectiveFrom: manifest.relationshipEffectiveFrom },
    catalog: { schemaVersion: 1, catalogEntryId, companyMarketId, companyId: manifest.companyId, marketId: manifest.marketId, productId: manifest.productId, active: manifest.active, saleable: manifest.saleable, unitPrice: manifest.unitPrice, effectiveFrom: manifest.productEffectiveFrom },
  };
}

function rollbackExpected(manifest: OffersRegistryManifest) {
  const companyMarketId = deterministicCompanyMarketId(manifest.companyId, manifest.marketId);
  const catalogEntryId = deterministicProductMarketCatalogId(manifest.companyId, manifest.marketId, manifest.productId, manifest.productEffectiveFrom);
  return {
    paths: { company: `companies/${manifest.companyId}`, companyMarket: `companyMarkets/${companyMarketId}`, catalog: `productMarketCatalog/${catalogEntryId}` },
    company: { schemaVersion: 1, companyId: manifest.companyId, name: manifest.companyName, active: manifest.active },
    companyMarket: { schemaVersion: 1, companyMarketId, companyId: manifest.companyId, marketId: manifest.marketId, active: manifest.active, effectiveFrom: manifest.relationshipEffectiveFrom },
    catalog: { schemaVersion: 1, catalogEntryId, companyMarketId, companyId: manifest.companyId, marketId: manifest.marketId, productId: manifest.productId, active: manifest.active, saleable: manifest.saleable, unitPrice: manifest.unitPrice, effectiveFrom: manifest.productEffectiveFrom },
  };
}

function matchesExpected(reads: RegistryReadSet, expected: ReturnType<typeof buildExpectedWithoutAudit>): boolean {
  return (["company", "companyMarket", "catalog"] as const).every(key => {
    const data = reads[key].data;
    return Boolean(data) && Object.entries(expected[key]).every(([field, value]) => data![field] === value);
  });
}

function firestoreDocument(snapshot: FirebaseFirestore.DocumentSnapshot): StoredDocument {
  const convert = (value: unknown): unknown => value && typeof value === "object" && "toDate" in value && typeof (value as { toDate(): Date }).toDate === "function" ? (value as { toDate(): Date }).toDate().toISOString() : Array.isArray(value) ? value.map(convert) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, convert(item)])) : value;
  return {
    id: snapshot.id,
    exists: snapshot.exists,
    ...(snapshot.exists ? { data: convert(snapshot.data()) as Record<string, unknown> } : {}),
    ...(snapshot.createTime ? { createTime: snapshot.createTime.toDate().toISOString() } : {}),
  };
}

function firestoreTransaction(db: Firestore, transaction: Transaction): RegistryTransaction {
  return {
    async readMarket(path) { return firestoreDocument(await transaction.get(db.doc(path))); },
    async readRemaining(paths) { return (await transaction.getAll(...paths.map(path => db.doc(path)))).map(firestoreDocument); },
    create(path, data) { transaction.create(db.doc(path), data); },
    update(path, data) { transaction.update(db.doc(path), data); },
    delete(path) { transaction.delete(db.doc(path)); },
  };
}

export function createFirebaseDependencies(clock: () => string = () => new Date().toISOString()): ConfigurationDependencies {
  const services = getFirebaseAdminServices();
  const db = services.db;
  return {
    clock,
    actorResolver: { async resolveUid(email) { return (await services.auth.getUserByEmail(email)).uid; } },
    repository: {
      async readMarket(path) { return firestoreDocument(await db.doc(path).get()); },
      async readRemaining(paths) { return (await db.getAll(...paths.map(path => db.doc(path)))).map(firestoreDocument); },
      async transact(work) { return db.runTransaction(transaction => work(firestoreTransaction(db, transaction))); },
    },
  };
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1]?.trim() : undefined;
}

function sanitizedOutput(result: ConfigurationResult): void { process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); }

export async function main(): Promise<void> {
  try {
    const mode = process.argv[2] as ConfigurationMode;
    if (!(["preflight", "dry-run", "apply", "verify", "rollback", "normalize-references", "diagnose-product-identities", "repair-product-identities", "normalize-product-references"] as string[]).includes(mode)) throw new ConfigurationError("MODE_INVALID");
    const manifestPath = argument("--manifest");
    if (!manifestPath) throw new ConfigurationError("MANIFEST_PATH_REQUIRED");
    const parsedInput = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const productIdentityMode = mode === "diagnose-product-identities" || mode === "repair-product-identities";
    const productNormalizationMode = mode === "normalize-product-references";
    const manifest = productNormalizationMode ? parseProductNormalizationManifest(parsedInput) : productIdentityMode ? parseProductIdentityManifest(parsedInput) : parseManifest(parsedInput);
    process.env.FIREBASE_PROJECT_ID = manifest.projectId;
    process.env.FIRESTORE_DATABASE_ID = manifest.databaseId;
    process.env.GOOGLE_CLOUD_PROJECT ||= manifest.projectId;
    const identity = getFirebaseRuntimeIdentity();
    if (identity.projectId !== manifest.projectId || identity.databaseId !== manifest.databaseId) throw new ConfigurationError("RUNTIME_IDENTITY_MISMATCH");
    console.info = () => undefined;
    console.warn = () => undefined;
    const options = { actorEmail: argument("--actor-email"), confirmProject: argument("--confirm-project"), confirmMode: argument("--confirm-mode") };
    const dependencies = createFirebaseDependencies();
    const result = productNormalizationMode
      ? await executeProductNormalizationConfiguration(manifest as ProductNormalizationManifest, options, dependencies)
      : productIdentityMode
        ? await executeProductIdentityConfiguration(mode, manifest as ProductIdentityManifest, options, dependencies)
        : await executeConfiguration(mode as RegistryConfigurationMode, manifest as OffersRegistryManifest, options, dependencies);
    sanitizedOutput(result);
    if (result.status !== "PASS") process.exitCode = 1;
  } catch (error) {
    const failure = error instanceof ConfigurationError ? error : new ConfigurationError("UNEXPECTED_ERROR");
    sanitizedOutput({ status: "BLOCKED", code: failure.code, mode: (process.argv[2] || "preflight") as ConfigurationMode, ...(failure.details.length ? { details: failure.details } : {}) });
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
