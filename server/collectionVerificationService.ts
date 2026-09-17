import type { Firestore } from "firebase-admin/firestore";
import type { Pharmacy } from "../src/types";
import type { CollectionVerificationRequest, CollectionVerificationResponse, SubmittedCollection } from "../src/features/ar/arTypes";
import { getFirebaseAdminServices } from "./firebaseAdmin";
import { createFirestoreOperationalScopeRepository, type OperationalScopeRepository } from "./operationalScopeRepository";
import { collectionSubmissionId, resolveCollectionActorScope } from "./collectionService";
import { readCertifiedOpenReceivables, persistVerification, readCompletedVerification } from "./financialSettlementRepository";
import { prepareVerification, assertFinancialIdentity } from "./financialSettlementService";
import { filterPharmaciesWithinOperationalScope } from "./pharmacyReadService";
import { permitsCollection } from "../src/lib/collectionPermissions";
import { getCapabilitiesForRole } from "../src/features/orders/orderWorkflowEngine";
import { resolveFinancialIdentity } from "../src/lib/financialIdentity";
import { resolveMarketForIdentity, validateMarketSettings, type MarketBusinessSettings } from "../src/lib/marketSettings";

export function parseCollectionVerification(input: unknown): CollectionVerificationRequest | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  if (Object.keys(raw).some(key => !["collectionId", "expectedRevision"].includes(key))
    || typeof raw.collectionId !== "string" || !raw.collectionId || raw.collectionId !== raw.collectionId.trim()
    || raw.collectionId.includes("/") || [".", ".."].includes(raw.collectionId)
    || !Number.isSafeInteger(raw.expectedRevision) || (raw.expectedRevision as number) < 1) return null;
  return raw as unknown as CollectionVerificationRequest;
}
export async function executeCollectionVerification(actorUid: string, input: unknown, deps: { db?: Firestore; scopeRepository?: OperationalScopeRepository; now?: () => string } = {}): Promise<CollectionVerificationResponse> {
  const request = parseCollectionVerification(input);
  if (!request) throw new Error("INVALID_VERIFICATION_REQUEST");
  const scope = await resolveCollectionActorScope(actorUid, deps.scopeRepository || createFirestoreOperationalScopeRepository());
  if (!actorUid || !scope.authorized || scope.queryPlan.denyAll) throw new Error("COLLECTION_SCOPE_DENIED");
  const db = deps.db || getFirebaseAdminServices().db;
  return db.runTransaction(async tx => {
    const restrictions = (await tx.get(db.collection("rolePermissions").doc(scope.role))).data() || {};
    if (!permitsCollection(scope.role, "approve", restrictions) || !getCapabilitiesForRole(scope.role).includes("ORDER_FINANCE_APPROVE")) throw new Error("COLLECTION_APPROVAL_DENIED");
    const snap = await tx.get(db.doc(`paymentCollections/${request.collectionId}`));
    const collection = snap.data();
    if (!collection || collection.id !== request.collectionId || typeof collection.pharmacyId !== "string"
      || !collection.pharmacyId || collection.pharmacyId.includes("/") || [".", ".."].includes(collection.pharmacyId)
      || collection.id !== collectionSubmissionId(collection.actorUid, collection.requestKey)) throw new Error("COLLECTION_STATE_INVALID");
    if (request.expectedRevision !== 1) throw new Error("STALE_COLLECTION");
    if (collection.status !== "Verified" && (collection.status !== "Submitted" || collection.revision !== request.expectedRevision)) throw new Error("STALE_COLLECTION");
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
    if (collection.status === "Verified") {
      await readCompletedVerification(db, tx, collection, request.expectedRevision);
      return { success: true, collectionId: collection.id, alreadyCompleted: true };
    }
    const receivables = await readCertifiedOpenReceivables(db, tx, identity);
    const plan = prepareVerification(collection as SubmittedCollection, receivables, {
      ...identity, actorUid, role: scope.role, restrictions, scopeAuthorized: true,
      operationId: `VERIFIED_${collection.id}`, now: (deps.now || (() => new Date().toISOString()))(),
    });
    await persistVerification(db, tx, plan, request.expectedRevision);
    return { success: true, collectionId: collection.id, alreadyCompleted: false };
  });
}
