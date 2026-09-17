import type { Firestore } from "firebase-admin/firestore";
import type { Pharmacy } from "../src/types";
import { getFirebaseAdminServices } from "./firebaseAdmin";
import { createFirestoreOperationalScopeRepository, type OperationalScopeRepository } from "./operationalScopeRepository";
import { prepareCollectionSubmission, resolveCollectionActorScope } from "./collectionService";
import { createSubmittedCollection } from "./collectionRepository";
import { readCertifiedOpenReceivables } from "./financialSettlementRepository";
import { filterPharmaciesWithinOperationalScope } from "./pharmacyReadService";
import { permitsCollection } from "../src/lib/collectionPermissions";
import { resolveFinancialIdentity } from "../src/lib/financialIdentity";
import { resolveMarketForIdentity, validateMarketSettings, type MarketBusinessSettings } from "../src/lib/marketSettings";

export interface CollectionSubmissionInput {
  pharmacyId: string; requestKey: string; amount: number; method: "Cash" | "Cheque" | "Bank Transfer" | "Other";
  reference: string; collectionDate: string; evidence?: string[]; notes?: string;
  chequeBank?: string; chequeDate?: string; transferBank?: string;
}
export function parseCollectionSubmission(input: unknown): CollectionSubmissionInput | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  if (Object.keys(raw).some(key => !["pharmacyId", "requestKey", "amount", "method", "reference", "collectionDate", "evidence", "notes", "chequeBank", "chequeDate", "transferBank"].includes(key))) return null;
  if (typeof raw.pharmacyId !== "string" || !raw.pharmacyId || raw.pharmacyId !== raw.pharmacyId.trim() || raw.pharmacyId.includes("/") || [".", ".."].includes(raw.pharmacyId)) return null;
  return raw as unknown as CollectionSubmissionInput;
}
export async function executeCollectionSubmission(actorUid: string, input: unknown, deps: { db?: Firestore; scopeRepository?: OperationalScopeRepository; now?: () => string } = {}) {
  const request = parseCollectionSubmission(input);
  if (!request) throw new Error("INVALID_COLLECTION_REQUEST");
  const scope = await resolveCollectionActorScope(actorUid, deps.scopeRepository || createFirestoreOperationalScopeRepository());
  if (!actorUid || !scope.authorized || scope.queryPlan.denyAll) throw new Error("COLLECTION_SCOPE_DENIED");
  const db = deps.db || getFirebaseAdminServices().db;
  return db.runTransaction(async tx => {
    const restrictions = (await tx.get(db.collection("rolePermissions").doc(scope.role))).data() || {};
    if (!permitsCollection(scope.role, "create", restrictions)) throw new Error("COLLECTION_SCOPE_DENIED");
    const pharmacySnap = await tx.get(db.collection("pharmacies").doc(request.pharmacyId));
    if (!pharmacySnap.exists || (pharmacySnap.data()?.id !== undefined && pharmacySnap.data()!.id !== pharmacySnap.id)) throw new Error("COLLECTION_SCOPE_DENIED");
    const pharmacy = { ...pharmacySnap.data(), id: pharmacySnap.id } as Pharmacy;
    if (filterPharmaciesWithinOperationalScope([pharmacy], scope).length !== 1) throw new Error("COLLECTION_SCOPE_DENIED");
    const profile = (await tx.get(db.collection("customerFinancialProfiles").doc(request.pharmacyId))).data();
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
    const identity = { pharmacyId: request.pharmacyId, marketId: financial.marketId, currencyCode: financial.currencyCode, decimalPlaces: market.decimalPlaces };
    const receivables = await readCertifiedOpenReceivables(db, tx, identity);
    const command = prepareCollectionSubmission(request, { ...identity, actorUid, scope, pharmacy, restrictions, receivables, now: (deps.now || (() => new Date().toISOString()))() });
    const result = await createSubmittedCollection(db, tx, command);
    return { success: true, created: result.created, collectionId: command.id };
  });
}
