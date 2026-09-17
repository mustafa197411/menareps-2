import type { Firestore } from "firebase-admin/firestore";
import type { Pharmacy } from "../src/types";
import type { CollectionReversalRequest, CollectionReversalResponse, CollectionReversalStatus, SubmittedCollection } from "../src/features/ar/arTypes";
import { getFirebaseAdminServices } from "./firebaseAdmin";
import { createFirestoreOperationalScopeRepository, type OperationalScopeRepository } from "./operationalScopeRepository";
import { collectionSubmissionId, resolveCollectionActorScope } from "./collectionService";
import { persistPaymentReversal, readCollectionReversal } from "./financialSettlementRepository";
import { assertFinancialIdentity } from "./financialSettlementService";
import { filterPharmaciesWithinOperationalScope } from "./pharmacyReadService";
import { permitsCollection } from "../src/lib/collectionPermissions";
import { resolveFinancialIdentity } from "../src/lib/financialIdentity";
import { resolveMarketForIdentity, validateMarketSettings, type MarketBusinessSettings } from "../src/lib/marketSettings";

type Dependencies = { db?: Firestore; scopeRepository?: OperationalScopeRepository; now?: () => string };
function parseRequest(input: unknown, readOnly: boolean): CollectionReversalRequest {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("INVALID_REVERSAL_REQUEST");
  const raw = input as Record<string, unknown>;
  const allowed = readOnly ? ["collectionId", "expectedRevision"] : ["collectionId", "expectedRevision", "reason"];
  if (Object.keys(raw).some(key => !allowed.includes(key)) || typeof raw.collectionId !== "string"
    || !raw.collectionId || raw.collectionId !== raw.collectionId.trim() || raw.collectionId.includes("/")
    || [".", ".."].includes(raw.collectionId) || !Number.isSafeInteger(raw.expectedRevision)) throw new Error("INVALID_REVERSAL_REQUEST");
  if (raw.expectedRevision !== 2) throw new Error("STALE_COLLECTION");
  if (!readOnly && (typeof raw.reason !== "string" || !raw.reason.trim() || raw.reason.trim().length > 4000)) throw new Error("INVALID_REVERSAL_REASON");
  return { collectionId: raw.collectionId, expectedRevision: 2, reason: readOnly ? "" : (raw.reason as string).trim() };
}
async function execute(actorUid: string, input: unknown, readOnly: boolean, deps: Dependencies) {
  const request = parseRequest(input, readOnly);
  const scope = await resolveCollectionActorScope(actorUid, deps.scopeRepository || createFirestoreOperationalScopeRepository());
  if (!actorUid || !scope.authorized || scope.queryPlan.denyAll) throw new Error("COLLECTION_SCOPE_DENIED");
  const db = deps.db || getFirebaseAdminServices().db;
  return db.runTransaction(async tx => {
    const restrictions = (await tx.get(db.collection("rolePermissions").doc(scope.role))).data() || {};
    if (!permitsCollection(scope.role, readOnly ? "view" : "reverse", restrictions)) throw new Error("COLLECTION_REVERSAL_DENIED");
    const snap = await tx.get(db.doc(`paymentCollections/${request.collectionId}`));
    const collection = snap.data();
    if (!collection || collection.id !== request.collectionId || collection.status !== "Verified" || collection.revision !== request.expectedRevision
      || typeof collection.pharmacyId !== "string" || !collection.pharmacyId || collection.pharmacyId.includes("/")
      || [".", ".."].includes(collection.pharmacyId) || collection.id !== collectionSubmissionId(collection.actorUid, collection.requestKey)) throw new Error("COLLECTION_STATE_INVALID");
    if (readOnly && !["ORGANIZATION", "FUNCTIONAL"].includes(scope.subjectMode) && !scope.subjectUids.includes(collection.actorUid)) throw new Error("COLLECTION_SCOPE_DENIED");
    const pharmacySnap = await tx.get(db.collection("pharmacies").doc(collection.pharmacyId));
    if (!pharmacySnap.exists || (pharmacySnap.data()?.id !== undefined && pharmacySnap.data()!.id !== pharmacySnap.id)) throw new Error("COLLECTION_SCOPE_DENIED");
    const pharmacy = { ...pharmacySnap.data(), id: pharmacySnap.id } as Pharmacy;
    if (filterPharmaciesWithinOperationalScope([pharmacy], scope).length !== 1) throw new Error("COLLECTION_SCOPE_DENIED");
    const profile = (await tx.get(db.collection("customerFinancialProfiles").doc(collection.pharmacyId))).data();
    if (!profile || typeof profile.marketId !== "string" || !profile.marketId || profile.marketId.includes("/")) throw new Error("FINANCIAL_PROJECTION_INITIALIZATION_REQUIRED");
    const marketSnap = await tx.get(db.collection("marketSettings").doc(profile.marketId));
    if (marketSnap.data()?.marketId !== undefined && marketSnap.data()!.marketId !== marketSnap.id) throw new Error("FINANCIAL_IDENTITY_MISMATCH");
    const market = { ...marketSnap.data(), marketId: marketSnap.id } as MarketBusinessSettings;
    if (!marketSnap.exists || market.active !== true || validateMarketSettings(market).length) throw new Error("FINANCIAL_MARKET_CURRENCY_REQUIRED");
    for (const record of [pharmacy, profile]) {
      if (record.country !== undefined && (typeof record.country !== "string" || !record.country.trim() || !resolveMarketForIdentity([market], { country: record.country }))) throw new Error("FINANCIAL_IDENTITY_MISMATCH");
    }
    const financial = resolveFinancialIdentity([pharmacy, profile], [market]);
    if (!financial || [pharmacy, profile].some(record => Object.entries({ marketId: financial.marketId, currencyCode: financial.currencyCode, currency: financial.currencyCode, countryId: financial.countryId }).some(([key, value]) => (record as any)[key] !== undefined && (record as any)[key] !== value))) throw new Error("FINANCIAL_IDENTITY_MISMATCH");
    const identity = { pharmacyId: collection.pharmacyId, marketId: financial.marketId, currencyCode: financial.currencyCode, decimalPlaces: market.decimalPlaces };
    if (collection.areaId !== pharmacy.areaId || !collection.areaId) throw new Error("COLLECTION_SCOPE_DENIED");
    assertFinancialIdentity(collection as SubmittedCollection, identity);
    if (readOnly) return { success: true as const, reversal: await readCollectionReversal(db, tx, collection) };
    return persistPaymentReversal(db, tx, collection, actorUid, request.reason, (deps.now || (() => new Date().toISOString()))());
  });
}
export async function executeCollectionReversal(actorUid: string, input: unknown, deps: Dependencies = {}): Promise<CollectionReversalResponse> {
  return await execute(actorUid, input, false, deps) as CollectionReversalResponse;
}
export async function resolveCollectionReversal(actorUid: string, input: unknown, deps: Dependencies = {}): Promise<CollectionReversalStatus> {
  return execute(actorUid, input, true, deps);
}
