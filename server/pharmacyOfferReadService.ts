import { decodeCanonicalUserDocument } from "./organizationalHierarchyRepository";
import { resolveOfferCreatorProductScope, restrictOfferProducts, productWithinOfferScope, defaultOfferScopeDependencies, type OfferScopeDependencies } from "./offerAdministrationService";
import { isActorMarketContext, type ActorMarketContext } from "../src/lib/operationalScopeClient";
import { FieldPath, type Firestore } from "firebase-admin/firestore";
import { getFirebaseAdminServices } from "./firebaseAdmin";
import { createFirestoreOperationalScopeRepository, resolveOperationalScopeForActor, readActorMarketContext, type OperationalScopeRepository } from "./operationalScopeRepository";
import { OfferAdministrationError, validateOfferActorProfile } from "./offerAdministrationService";
import { hasOfferCapability } from "./offerAuthorization";
import { validateCanonicalOfferDefinition } from "../src/features/offers/offerValidation";
import type { CanonicalOfferDefinition } from "../src/features/offers/types";
import type { Permissions } from "../src/types";
import { calculateOffersForServer } from "../src/features/offers/offerCalculation";
import { isEligibleSalesRepresentativeCandidate, isReportingAncestor, type OrganizationalUser } from "./organizationalHierarchyService";
import { readProductAvailableToPromise } from "./pharmacyProductAvailabilityService";

// Server runtime configuration follows the existing environment-input pattern.
// Owner-approved capacities; absent or different values require explicit configuration review.
export function resolveOfferRuntimeCapacity(env: Record<string, string | undefined> = process.env) {
  if (env.OFFER_RUNTIME_MAX_ACTIVE_DOCUMENTS !== "250" || env.OFFER_RUNTIME_MAX_AUDIENCE_LOOKUPS !== "3000") {
    throw new OfferRuntimeError("OFFER_CONFIGURATION_UNAVAILABLE");
  }
  return { maxActiveDocuments: 250, maxAudienceLookups: 3000 } as const;
}

export class OfferRuntimeError extends Error {
  readonly status = 503;
  readonly complete = false;
  constructor(public readonly code: "OFFER_CONFIGURATION_UNAVAILABLE" | "OFFER_DISCOVERY_CAPACITY_EXCEEDED") {
    super("Offer discovery could not be completed safely. No Offer result is available.");
  }
}

/** One operation-local cache. Count cache hits too; never catch infrastructure errors as denial. */
export function createOfferAudienceOperation(actorUid: string, getUser: (id: string) => Promise<Record<string, unknown> | null>, maxLookups: number, budget = { lookups: 0 }) {
  const cache = new Map<string, Promise<OrganizationalUser | null>>();
  const repository = { async getUser(uid: string): Promise<OrganizationalUser | null> {
    if (budget.lookups >= maxLookups) throw new OfferRuntimeError("OFFER_DISCOVERY_CAPACITY_EXCEEDED");
    budget.lookups++;
    if (!cache.has(uid)) cache.set(uid, getUser(uid).then(user => user as OrganizationalUser | null));
    return cache.get(uid)!;
  } };
  return {
    getUser: repository.getUser,
    async eligible(offer: CanonicalOfferDefinition) {
      if (!isEligibleSalesRepresentativeCandidate(await repository.getUser(actorUid), actorUid)) return false;
      const audience = offer.eligibility;

      if (audience.audienceType === "SELECTED_SALES_REPRESENTATIVES" && !audience.audienceUserIds.includes(actorUid)) return false;
      return isReportingAncestor(offer.createdBy, actorUid, repository);
    },
  };
}

export type PharmacyOfferReadCode = "OFFER_AUTHENTICATION_REQUIRED" | "OFFER_ACTOR_NOT_FOUND" | "OFFER_ACTOR_INACTIVE" | "OFFER_PERMISSION_DENIED" | "OFFER_PHARMACY_NOT_FOUND" | "OFFER_PHARMACY_INACTIVE" | "OFFER_SCOPE_DENIED" | "OFFER_PRODUCT_NOT_FOUND" | "OFFER_PRODUCT_INACTIVE" | "OFFER_CONFIGURATION_UNAVAILABLE";
export interface PharmacyOfferReadRequest { pharmacyId: string; productIds: string[]; paidLines?: Array<{ lineId: string; productId: string; quantity: number }>; selectedOfferIds?: string[] }
export interface PharmacyOfferReadRepository {
  getUser(id: string): Promise<Record<string, unknown> | null>;
  getPermissions(role: string): Promise<Permissions | null>;
  getPharmacy(id: string): Promise<Record<string, unknown> | null>;
  getProduct(id: string): Promise<Record<string, unknown> | null>;
  queryActive(limit: number): Promise<Array<{ id: string; data: Record<string, unknown> }>>;
}
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const active = (value: Record<string, unknown>) => value.isDeleted !== true && value.active !== false && value.isActive !== false && value.status !== "Inactive" && value.status !== "Archived";
const commercial = (value: Record<string, unknown>) => active(value) && value.isSample !== true && value.isSampleSku !== true && !/sample/i.test(text(value.productType));
const strings = (value: unknown) => Array.isArray(value) ? Array.from(new Set(value.map(text).filter(Boolean))).sort() : [];

export function parsePharmacyOfferReadRequest(value: unknown): PharmacyOfferReadRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>, pharmacyId = text(row.pharmacyId), productIds = strings(row.productIds);
  if (!pharmacyId || productIds.length === 0 || Object.keys(row).some(key => !["pharmacyId", "productIds", "paidLines", "selectedOfferIds"].includes(key))) return null;
  const paidLines = row.paidLines === undefined ? undefined : Array.isArray(row.paidLines) ? row.paidLines.map((line, index) => {
    const item = line as Record<string, unknown>, lineId = text(item?.lineId), productId = text(item?.productId), quantity = Number(item?.quantity);
    if (!line || typeof line !== "object" || Array.isArray(line) || Object.keys(item).some(key => !["lineId", "productId", "quantity"].includes(key)) || !lineId || !productIds.includes(productId) || !Number.isSafeInteger(quantity) || quantity <= 0) return null;
    return { lineId: lineId || `L${index}`, productId, quantity };
  }) : [null];
  if (paidLines?.some(line => !line)) return null;
  const selectedOfferIds = row.selectedOfferIds === undefined ? undefined : strings(row.selectedOfferIds);
  if (row.selectedOfferIds !== undefined && (!Array.isArray(row.selectedOfferIds) || selectedOfferIds!.length !== row.selectedOfferIds.length)) return null;
  return { pharmacyId, productIds, ...(paidLines ? { paidLines: paidLines as Array<{ lineId: string; productId: string; quantity: number }> } : {}), ...(selectedOfferIds ? { selectedOfferIds } : {}) };
}

export function physicalDemandIsAvailable(paidLines: readonly { productId: string; quantity: number }[], freeLines: readonly { rewardProductId: string; quantity: number }[], products: ReadonlyMap<string, Record<string, unknown>>): boolean {
  const demand = new Map<string, number>();
  for (const line of paidLines) demand.set(line.productId, (demand.get(line.productId) || 0) + line.quantity);
  for (const line of freeLines) demand.set(line.rewardProductId, (demand.get(line.rewardProductId) || 0) + line.quantity);
  for (const [productId, required] of demand) { const available = readProductAvailableToPromise(products.get(productId)); if (!Number.isSafeInteger(required) || available == null || available < required) return false; }
  return true;
}

export function createFirestorePharmacyOfferReadRepository(db: Firestore = getFirebaseAdminServices().db): PharmacyOfferReadRepository {
  const get = async (collection: string, id: string) => { const snap = await db.collection(collection).doc(id).get(); return snap.exists ? snap.data() || null : null; };
  return {
    getUser: async id => { const user = await get("users", id); return user ? decodeCanonicalUserDocument(id, user) : null; }, getPermissions: async role => await get("rolePermissions", role) as Permissions | null,
    getPharmacy: id => get("pharmacies", id), getProduct: id => get("products", id),
    async queryActive(limit) { const snap = await db.collection("offers").where("lifecycleStatus", "==", "ACTIVE").orderBy(FieldPath.documentId(), "asc").limit(limit).get(); return snap.docs.map(doc => ({ id: doc.id, data: doc.data() })); },
  };
}

function matchesOffer(offer: CanonicalOfferDefinition, request: PharmacyOfferReadRequest, pharmacy: Record<string, unknown>, scope: Awaited<ReturnType<typeof resolveOperationalScopeForActor>>, at: number): boolean {
  const e = offer.eligibility;
  if (offer.lifecycleStatus !== "ACTIVE" || at < Date.parse(e.startAt) || at > Date.parse(e.endAt)) return false;
  const authorizedProducts = new Set(scope.productIds), requested = request.productIds.filter(id => authorizedProducts.has(id));
  if (requested.length !== request.productIds.length || requested.length === 0) return false;
  const selectedProductIds: readonly string[] = offer.productScope.productIds;
  const trigger = offer.productScope.mode === "ALL_PRODUCTS" ? requested : requested.filter(id => selectedProductIds.includes(id));
  if (!trigger.length) return false;
  return !("reward" in offer.benefit && offer.benefit.reward.mode === "SELECTED_PRODUCT" && !authorizedProducts.has(offer.benefit.reward.rewardProductId));
}

export async function resolveScopedPharmacyOffers(actorUid: string, request: PharmacyOfferReadRequest, dependencies: { operationalScopeRepository?: OperationalScopeRepository; repository?: PharmacyOfferReadRepository; now?: () => Date; offerScopeDependencies?: OfferScopeDependencies; readTransactionMarket?: (countryId: string) => Promise<ActorMarketContext> } = {}) {
  const capacity = resolveOfferRuntimeCapacity();
  const repository = dependencies.repository || createFirestorePharmacyOfferReadRepository();
  const audience = createOfferAudienceOperation(actorUid, id => repository.getUser(id), capacity.maxAudienceLookups);
  const user = await audience.getUser(actorUid);
  if (!isEligibleSalesRepresentativeCandidate(user, actorUid)) return { authorized: false, complete: false, code: "OFFER_PERMISSION_DENIED" as const, offers: [] };
  const role = validateOfferActorProfile(actorUid, user), permissions = await repository.getPermissions(role);
  if (!hasOfferCapability(role, permissions, "offers.applyDuringVisit")) return { authorized: false, complete: false, code: "OFFER_PERMISSION_DENIED" as const, offers: [] };
  const scope = await resolveOperationalScopeForActor(actorUid, {}, dependencies.operationalScopeRepository || createFirestoreOperationalScopeRepository());
  if (!scope.authorized || scope.queryPlan.denyAll) return { authorized: false, complete: false, code: "OFFER_SCOPE_DENIED" as const, offers: [] };
  const pharmacy = await repository.getPharmacy(request.pharmacyId);
  if (!pharmacy || (pharmacy.id !== undefined && pharmacy.id !== request.pharmacyId)) return { authorized: false, complete: false, code: "OFFER_PHARMACY_NOT_FOUND" as const, offers: [] };
  if (!active(pharmacy)) return { authorized: false, complete: false, code: "OFFER_PHARMACY_INACTIVE" as const, offers: [] };
  if (!scope.areaIds.includes(text(pharmacy.areaId)) || !scope.countryIds.includes(text(pharmacy.countryId))) return { authorized: false, complete: false, code: "OFFER_SCOPE_DENIED" as const, offers: [] };
  const productRecords = new Map<string, Record<string, unknown>>();
  for (const id of request.productIds) { const product = await repository.getProduct(id); if (!product || (product.id !== undefined && product.id !== id) || (product.productId !== undefined && product.productId !== id)) return { authorized: false, complete: false, code: "OFFER_PRODUCT_NOT_FOUND" as const, offers: [] }; if (!commercial(product)) return { authorized: false, complete: false, code: "OFFER_PRODUCT_INACTIVE" as const, offers: [] }; if (typeof product.price !== "number" || !Number.isFinite(product.price) || product.price < 0) throw new OfferAdministrationError("OFFER_PRODUCT_DISPLAY_INVALID", 422); productRecords.set(id, product); }
  const creatorScopes = new Map<string, Awaited<ReturnType<typeof resolveOfferCreatorProductScope>>>();
  const creatorDependencies = dependencies.offerScopeDependencies || { ...defaultOfferScopeDependencies, resolveScope: (uid: string) => resolveOperationalScopeForActor(uid, {}, dependencies.operationalScopeRepository || createFirestoreOperationalScopeRepository()) };
  const offers: CanonicalOfferDefinition[] = [], candidates: CanonicalOfferDefinition[] = [];
  const authoritativeNow = (dependencies.now || (() => new Date()))().getTime();
  const documents = await repository.queryActive(capacity.maxActiveDocuments + 1);
  if (documents.length > capacity.maxActiveDocuments) throw new OfferRuntimeError("OFFER_DISCOVERY_CAPACITY_EXCEEDED");
  for (const document of documents) {
    const parsed = validateCanonicalOfferDefinition({ ...document.data, id: document.id });
    if (!parsed.valid || !matchesOffer(parsed.value, request, pharmacy, scope, authoritativeNow)) continue;
    if (!await audience.eligible(parsed.value)) continue;
    if (!creatorScopes.has(parsed.value.createdBy)) creatorScopes.set(parsed.value.createdBy, await resolveOfferCreatorProductScope(parsed.value.createdBy, creatorDependencies));
    const restricted = restrictOfferProducts(parsed.value, creatorScopes.get(parsed.value.createdBy)!, scope.productIds);
    if (restricted) {
      const creatorScope = creatorScopes.get(parsed.value.createdBy)!;
      const ids = restricted.productScope.productIds.filter(id => {
        const product = productRecords.get(id);
        return product && productWithinOfferScope(product, id, creatorScope) && productWithinOfferScope(product, id, scope);
      });
      if (ids.length) candidates.push({ ...restricted, productScope: { mode: "SELECTED_PRODUCTS", productIds: ids } });
    }
  }
  for (const candidate of candidates) if ("reward" in candidate.benefit && candidate.benefit.reward.mode === "SELECTED_PRODUCT" && !productRecords.has(candidate.benefit.reward.rewardProductId)) { const product = await repository.getProduct(candidate.benefit.reward.rewardProductId); if (product) productRecords.set(candidate.benefit.reward.rewardProductId, product); }
  const transactionMarket = request.paidLines ? await (dependencies.readTransactionMarket || (countryId => readActorMarketContext({ countryId })))(text(pharmacy.countryId)) : undefined;
  if (request.paidLines && (!isActorMarketContext(transactionMarket) || transactionMarket.status !== "RESOLVED" || transactionMarket.market.countryId !== text(pharmacy.countryId))) throw new OfferRuntimeError("OFFER_CONFIGURATION_UNAVAILABLE");
  const previewMarket = transactionMarket?.status === "RESOLVED" ? transactionMarket.market : undefined;
  const unavailableOfferIds: string[] = [];
  for (const candidate of candidates) {
    if ("reward" in candidate.benefit && candidate.benefit.reward.mode === "SELECTED_PRODUCT") {
      const id = candidate.benefit.reward.rewardProductId, product = productRecords.get(id);
      if (!product || !commercial(product) || !productWithinOfferScope(product, id, creatorScopes.get(candidate.createdBy)!) || !productWithinOfferScope(product, id, scope)) continue;
    }
    if (!request.paidLines || (candidate.type !== "BUY_X_GET_Y" && candidate.type !== "TIER_BONUS")) { offers.push(candidate); continue; }
    const preview = calculateOffersForServer({ currencyCode: previewMarket!.currencyCode, decimalPlaces: previewMarket!.decimalPlaces, roundingMode: "DECIMAL_HALF_UP", paidLines: request.paidLines.map(line => ({ ...line, unitPrice: productRecords.get(line.productId)!.price as number })), selectedOffers: [candidate] });
    if (!preview.success || !physicalDemandIsAvailable(request.paidLines, preview.freeLines, productRecords)) unavailableOfferIds.push(candidate.id); else offers.push(candidate);
  }
  let selectedCombinationAvailable = true;
  if (request.paidLines && request.selectedOfferIds?.length) {
    const selected = request.selectedOfferIds.map(id => offers.find(offer => offer.id === id));
    if (selected.some(offer => !offer)) selectedCombinationAvailable = false;
    else {
      const preview = calculateOffersForServer({ currencyCode: previewMarket!.currencyCode, decimalPlaces: previewMarket!.decimalPlaces, roundingMode: "DECIMAL_HALF_UP", paidLines: request.paidLines.map(line => ({ ...line, unitPrice: productRecords.get(line.productId)!.price as number })), selectedOffers: selected as CanonicalOfferDefinition[] });
      selectedCombinationAvailable = preview.success && preview.rejectedOffers.length === 0 && preview.conflicts.length === 0 && physicalDemandIsAvailable(request.paidLines, preview.freeLines, productRecords);
    }
  }
  return { authorized: true, complete: true, capabilities: { "offers.applyDuringVisit": true }, offers: offers.sort((a, b) => a.id.localeCompare(b.id)), unavailableOfferIds: unavailableOfferIds.sort(), selectedCombinationAvailable };
}
