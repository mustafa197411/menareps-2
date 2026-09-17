import type { Firestore, Transaction } from "firebase-admin/firestore";
import { getFirebaseAdminServices } from "./firebaseAdmin";
import { hasPermission } from "../src/lib/userPolicyEngine";
import type { Permissions, User } from "../src/types";
import {
  COMMERCIAL_REGISTRY_SCHEMA_VERSION,
  deterministicCompanyMarketId,
  deterministicProductMarketCatalogId,
  validateCompanyRecord,
  validateCompanyMarketAssignment,
  validateCountryReference,
  validateProductMarketCatalogEntry,
  validateProductReference,
  type ProductMarketCatalogEntry,
} from "../src/lib/commercialRegistry";
import { validateMarketSettings, type MarketBusinessSettings } from "../src/lib/marketSettings";
import type { OfferCommercialRegistryDependencies } from "./offerCommercialRegistryAdapter";

export type ProductMarketCatalogErrorCode =
  | "PRODUCT_MARKET_AUTHENTICATION_REQUIRED" | "PRODUCT_MARKET_PERMISSION_DENIED"
  | "PRODUCT_MARKET_INVALID_REQUEST" | "PRODUCT_MARKET_INVALID_PRICE"
  | "PRODUCT_MARKET_PRODUCT_NOT_FOUND" | "PRODUCT_MARKET_PRODUCT_INACTIVE"
  | "PRODUCT_MARKET_MARKET_NOT_FOUND" | "PRODUCT_MARKET_MARKET_INACTIVE"
  | "PRODUCT_MARKET_COMPANY_NOT_FOUND" | "PRODUCT_MARKET_COMPANY_INACTIVE"
  | "PRODUCT_MARKET_RELATIONSHIP_NOT_FOUND" | "PRODUCT_MARKET_RELATIONSHIP_INACTIVE"
  | "PRODUCT_MARKET_REFERENCE_INVALID" | "PRODUCT_MARKET_IDENTITY_CONFLICT"
  | "PRODUCT_MARKET_READ_FAILED" | "PRODUCT_MARKET_WRITE_FAILED";

export class ProductMarketCatalogError extends Error {
  constructor(public readonly code: ProductMarketCatalogErrorCode, public readonly status: number) {
    super(code);
    this.name = "ProductMarketCatalogError";
  }
}

export interface ProductMarketCatalogActor { uid: string; role: string; permissions: Permissions | null; scope?: { global: boolean; companyIds: string[]; countryIds: string[]; marketIds: string[]; productIds: string[] } }
export interface ProductMarketCatalogItemInput { productId: string; unitPrice: number; active: boolean; saleable: boolean; catalogEntryId?: string; effectiveFrom?: string }
export interface ProductMarketCatalogRequest { companyId: string; marketId: string; items: ProductMarketCatalogItemInput[] }
export interface ProductMarketCatalogState { productId: string; configured: boolean; unitPrice?: number; active?: boolean; saleable?: boolean }

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const exactId = (value: unknown): value is string => typeof value === "string" && value === value.trim() && ID.test(value);
const active = (value: Record<string, unknown>) => value.active !== false && value.isActive !== false && value.status !== "Inactive" && value.marketingStatus !== "Inactive";
const effectiveAt = (value: { effectiveFrom: string; effectiveTo?: string }, instant: string) => Date.parse(value.effectiveFrom) <= Date.parse(instant) && (!value.effectiveTo || Date.parse(value.effectiveTo) >= Date.parse(instant));

export function parseProductMarketCatalogRequest(input: unknown, requirePrices: boolean): ProductMarketCatalogRequest {
  const value = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : null;
  if (!value || !exactId(value.companyId) || !exactId(value.marketId) || !Array.isArray(value.items) || value.items.length < 1 || value.items.length > 30) {
    throw new ProductMarketCatalogError("PRODUCT_MARKET_INVALID_REQUEST", 400);
  }
  const seen = new Set<string>();
  const items = value.items.map(raw => {
    const item = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
    if (!item || !exactId(item.productId) || seen.has(item.productId)) throw new ProductMarketCatalogError("PRODUCT_MARKET_INVALID_REQUEST", 400);
    seen.add(item.productId);
    if (requirePrices && (typeof item.unitPrice !== "number" || !Number.isFinite(item.unitPrice) || item.unitPrice < 0)) throw new ProductMarketCatalogError("PRODUCT_MARKET_INVALID_PRICE", 422);
    if (requirePrices && (typeof item.active !== "boolean" || typeof item.saleable !== "boolean")) throw new ProductMarketCatalogError("PRODUCT_MARKET_INVALID_REQUEST", 400);
    const hasCatalogId = item.catalogEntryId !== undefined, hasEffectiveFrom = item.effectiveFrom !== undefined;
    if (hasCatalogId !== hasEffectiveFrom || (hasCatalogId && (!exactId(item.catalogEntryId) || typeof item.effectiveFrom !== "string" || !Number.isFinite(Date.parse(item.effectiveFrom)) || new Date(item.effectiveFrom).toISOString() !== item.effectiveFrom))) throw new ProductMarketCatalogError("PRODUCT_MARKET_INVALID_REQUEST", 400);
    return { productId: item.productId, unitPrice: item.unitPrice as number, active: item.active as boolean, saleable: item.saleable as boolean, ...(hasCatalogId ? { catalogEntryId: item.catalogEntryId as string, effectiveFrom: item.effectiveFrom as string } : {}) };
  });
  return { companyId: value.companyId, marketId: value.marketId, items };
}

function authorize(actor: ProductMarketCatalogActor): void {
  if (!exactId(actor.uid)) throw new ProductMarketCatalogError("PRODUCT_MARKET_AUTHENTICATION_REQUIRED", 401);
  if (!hasPermission({ role: actor.role } as User, "Products", "assign", actor.permissions || undefined)) {
    throw new ProductMarketCatalogError("PRODUCT_MARKET_PERMISSION_DENIED", 403);
  }
}

export async function readProductMarketRelationships(actor: ProductMarketCatalogActor, productIds: readonly string[], dependencies: OfferCommercialRegistryDependencies) {
  authorize(actor);
  if (!actor.scope || productIds.length < 1 || productIds.length > 30 || productIds.some(id => !exactId(id)) || new Set(productIds).size !== productIds.length) throw new ProductMarketCatalogError("PRODUCT_MARKET_INVALID_REQUEST", 400);
  const result = await dependencies.resolver({
    global: actor.scope.global,
    authorizedCompanyIds: actor.scope.global ? [] : actor.scope.companyIds,
    authorizedCountryIds: actor.scope.global ? [] : actor.scope.countryIds,
    authorizedProductIds: [...productIds],
    productScopeRequired: true,
    effectiveAt: dependencies.clock(),
  }, dependencies.repository);
  if (!result.ok) throw new ProductMarketCatalogError("PRODUCT_MARKET_REFERENCE_INVALID", 409);
  const markets = actor.scope.global || actor.scope.marketIds.length === 0 ? result.value.markets : result.value.markets.filter(market => actor.scope!.marketIds.includes(market.marketId));
  return markets.map(market => ({
    companyMarketId: deterministicCompanyMarketId(market.companyId, market.marketId), companyId: market.companyId, marketId: market.marketId,
    companyName: result.value.companies.find(company => company.companyId === market.companyId)!.name,
    marketName: market.nameEn, countryName: result.value.countries.find(country => country.countryId === market.countryId)!.nameEn,
    currencyCode: market.currencyCode,
    configurations: productIds.map(productId => {
      const configuration = result.value.catalogConfigurations.find(value => value.companyId === market.companyId && value.marketId === market.marketId && value.productId === productId);
      return configuration ? { productId, configured: true, unitPrice: configuration.unitPrice, active: configuration.active, saleable: configuration.saleable, effectiveFrom: configuration.effectiveFrom, catalogEntryId: configuration.catalogEntryId } : { productId, configured: false };
    }),
  }));
}

function documentData(snapshot: any, idField: string, expectedId: string, missing: ProductMarketCatalogErrorCode): Record<string, unknown> {
  if (!snapshot.exists) throw new ProductMarketCatalogError(missing, 404);
  const data = snapshot.data() as Record<string, unknown>;
  if (data[idField] !== expectedId) throw new ProductMarketCatalogError("PRODUCT_MARKET_IDENTITY_CONFLICT", 409);
  return data;
}

async function loadReferences(tx: Transaction, db: Firestore, request: ProductMarketCatalogRequest) {
  const companyMarketId = deterministicCompanyMarketId(request.companyId, request.marketId);
  const [companySnap, marketSnap, relationshipSnap, ...productSnaps] = await tx.getAll(
    db.collection("companies").doc(request.companyId), db.collection("marketSettings").doc(request.marketId),
    db.collection("companyMarkets").doc(companyMarketId), ...request.items.map(item => db.collection("products").doc(item.productId)),
  );
  const company = documentData(companySnap, "companyId", request.companyId, "PRODUCT_MARKET_COMPANY_NOT_FOUND");
  const companyValidation = validateCompanyRecord(company);
  if (!companyValidation.valid) throw new ProductMarketCatalogError("PRODUCT_MARKET_REFERENCE_INVALID", 409);
  if (!companyValidation.value.active || !active(company)) throw new ProductMarketCatalogError("PRODUCT_MARKET_COMPANY_INACTIVE", 409);
  const market = documentData(marketSnap, "marketId", request.marketId, "PRODUCT_MARKET_MARKET_NOT_FOUND") as unknown as MarketBusinessSettings;
  if (validateMarketSettings(market).length) throw new ProductMarketCatalogError("PRODUCT_MARKET_REFERENCE_INVALID", 409);
  if (!market.active) throw new ProductMarketCatalogError("PRODUCT_MARKET_MARKET_INACTIVE", 409);
  const countrySnap = await tx.get(db.collection("countries").doc(market.countryId));
  const country = documentData(countrySnap, "countryId", market.countryId, "PRODUCT_MARKET_REFERENCE_INVALID");
  const countryValidation = validateCountryReference(country);
  if (!countryValidation.valid || !countryValidation.value.active) throw new ProductMarketCatalogError("PRODUCT_MARKET_REFERENCE_INVALID", 409);
  const relationship = documentData(relationshipSnap, "companyMarketId", companyMarketId, "PRODUCT_MARKET_RELATIONSHIP_NOT_FOUND");
  const relationshipValidation = validateCompanyMarketAssignment(relationship);
  if (!relationshipValidation.valid || relationship.companyId !== request.companyId || relationship.marketId !== request.marketId) throw new ProductMarketCatalogError("PRODUCT_MARKET_IDENTITY_CONFLICT", 409);
  if (!relationshipValidation.value.active) throw new ProductMarketCatalogError("PRODUCT_MARKET_RELATIONSHIP_INACTIVE", 409);
  const products = productSnaps.map((snapshot, index) => {
    const product = documentData(snapshot, "productId", request.items[index].productId, "PRODUCT_MARKET_PRODUCT_NOT_FOUND");
    const validation = validateProductReference(product);
    if (!validation.valid) throw new ProductMarketCatalogError("PRODUCT_MARKET_REFERENCE_INVALID", 409);
    if (!validation.value.active || !active(product)) throw new ProductMarketCatalogError("PRODUCT_MARKET_PRODUCT_INACTIVE", 409);
    return validation.value;
  });
  return { companyMarketId, market, relationship: relationshipValidation.value, products };
}

export async function saveProductMarketCatalog(actor: ProductMarketCatalogActor, request: ProductMarketCatalogRequest, db: Firestore = getFirebaseAdminServices().db, clock: () => string = () => new Date().toISOString()) {
  authorize(actor);
  const now = clock();
  if (!Number.isFinite(Date.parse(now)) || new Date(now).toISOString() !== now) throw new ProductMarketCatalogError("PRODUCT_MARKET_WRITE_FAILED", 500);
  return db.runTransaction(async tx => {
    const refs = await loadReferences(tx, db, request);
    if (!effectiveAt(refs.relationship, now)) throw new ProductMarketCatalogError("PRODUCT_MARKET_RELATIONSHIP_INACTIVE", 409);
    const catalogRefs = request.items.map(item => {
      const effectiveFrom = item.effectiveFrom || now;
      const expectedId = deterministicProductMarketCatalogId(request.companyId, request.marketId, item.productId, effectiveFrom);
      if (item.catalogEntryId && item.catalogEntryId !== expectedId) throw new ProductMarketCatalogError("PRODUCT_MARKET_IDENTITY_CONFLICT", 409);
      return db.collection("productMarketCatalog").doc(expectedId);
    });
    const snapshots = await tx.getAll(...catalogRefs);
    const entries = request.items.map((item, index): ProductMarketCatalogEntry => {
      const existing = snapshots[index].exists ? documentData(snapshots[index], "catalogEntryId", catalogRefs[index].id, "PRODUCT_MARKET_IDENTITY_CONFLICT") : null;
      const validatedExisting = existing ? validateProductMarketCatalogEntry(existing) : null;
      if (validatedExisting && !validatedExisting.valid) throw new ProductMarketCatalogError("PRODUCT_MARKET_IDENTITY_CONFLICT", 409);
      if (item.catalogEntryId && !existing) throw new ProductMarketCatalogError("PRODUCT_MARKET_IDENTITY_CONFLICT", 409);
      if (!item.catalogEntryId && existing) throw new ProductMarketCatalogError("PRODUCT_MARKET_IDENTITY_CONFLICT", 409);
      if (validatedExisting?.valid && (validatedExisting.value.companyMarketId !== refs.companyMarketId || validatedExisting.value.companyId !== request.companyId || validatedExisting.value.marketId !== request.marketId || validatedExisting.value.productId !== item.productId || validatedExisting.value.effectiveFrom !== item.effectiveFrom)) throw new ProductMarketCatalogError("PRODUCT_MARKET_IDENTITY_CONFLICT", 409);
      const canonicalExisting = validatedExisting?.valid ? validatedExisting.value : null;
      if (canonicalExisting && !effectiveAt(canonicalExisting, now)) throw new ProductMarketCatalogError("PRODUCT_MARKET_IDENTITY_CONFLICT", 409);
      const entry: ProductMarketCatalogEntry = {
        schemaVersion: COMMERCIAL_REGISTRY_SCHEMA_VERSION, catalogEntryId: catalogRefs[index].id, companyMarketId: refs.companyMarketId,
        companyId: request.companyId, marketId: request.marketId, productId: item.productId, unitPrice: item.unitPrice,
        active: item.active, saleable: item.saleable, effectiveFrom: item.effectiveFrom || now,
        ...(refs.relationship.effectiveTo ? { effectiveTo: refs.relationship.effectiveTo } : {}),
        createdAt: canonicalExisting?.createdAt || now,
        createdBy: canonicalExisting?.createdBy || actor.uid,
        updatedAt: now, updatedBy: actor.uid,
      };
      if (!validateProductMarketCatalogEntry(entry).valid) throw new ProductMarketCatalogError("PRODUCT_MARKET_REFERENCE_INVALID", 409);
      return entry;
    });
    entries.forEach((entry, index) => snapshots[index].exists
      ? tx.update(catalogRefs[index], { unitPrice: entry.unitPrice, active: entry.active, saleable: entry.saleable, updatedAt: entry.updatedAt, updatedBy: entry.updatedBy })
      : tx.create(catalogRefs[index], entry));
    return { companyId: request.companyId, marketId: request.marketId, countryId: refs.market.countryId, currencyCode: refs.market.currencyCode, items: entries.map(entry => ({ productId: entry.productId, configured: true, unitPrice: entry.unitPrice, active: entry.active, saleable: entry.saleable, effectiveFrom: entry.effectiveFrom, catalogEntryId: entry.catalogEntryId })) };
  });
}
