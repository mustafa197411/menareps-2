import type { CanonicalReceivable, SettlementIdentity, SubmittedCollection, PaymentMethod } from "../src/features/ar/arTypes";
import type { EffectiveOperationalScope } from "./operationalScopeService";
import type { Pharmacy } from "../src/types";
import { permitsCollection, type CollectionRestrictions } from "../src/lib/collectionPermissions";
import { filterPharmaciesWithinOperationalScope } from "./pharmacyReadService";
import { resolveOperationalScopeForActor, type OperationalScopeRepository } from "./operationalScopeRepository";
import { allocateOldestFirst, financialIdentityKey, assertFinancialIdentity } from "./financialSettlementService";

export interface CollectionContext extends SettlementIdentity {
  actorUid: string; scope: EffectiveOperationalScope; pharmacy: Pharmacy; restrictions: CollectionRestrictions;
  now: string; receivables: readonly CanonicalReceivable[];
}
/** Resolve with the existing authority, never a collection-specific geography resolver. */
export async function resolveCollectionActorScope(actorUid: string, repository: OperationalScopeRepository) {
  return resolveOperationalScopeForActor(actorUid, {}, repository);
}
/** The request binding is independent of optional business/source identity. */
export function collectionSubmissionId(actorUid: string, requestKey: string): string {
  if (typeof actorUid !== "string" || !actorUid.trim() || typeof requestKey !== "string"
    || !requestKey || requestKey !== requestKey.trim() || requestKey.length > 512) throw new Error("INVALID_COLLECTION_COMMAND");
  return `PAY_${financialIdentityKey([actorUid, "request", requestKey])}`;
}
export function prepareCollectionSubmission(input: unknown, context: CollectionContext): SubmittedCollection {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("INVALID_COLLECTION_REQUEST");
  const raw = input as Record<string, unknown>;
  const allowed = ["requestKey", "amount", "method", "reference", "evidence", "collectionDate", "sourceKey", "pharmacyId", "marketId", "currencyCode", "chequeBank", "chequeDate", "transferBank", "notes"];
  if (Object.keys(raw).some(key => !allowed.includes(key))) throw new Error("FORGED_COLLECTION_FIELD");
  if (!context.actorUid || !context.scope.authorized || !context.scope.subjectUids.includes(context.actorUid) || !permitsCollection(context.scope.role, "create", context.restrictions) || filterPharmaciesWithinOperationalScope([context.pharmacy], context.scope).length !== 1) throw new Error("COLLECTION_SCOPE_DENIED");
  if (context.pharmacy.id !== context.pharmacyId) throw new Error("FINANCIAL_IDENTITY_MISMATCH");
  assertFinancialIdentity(context, context);
  for (const key of ["pharmacyId", "marketId", "currencyCode"] as const) if (raw[key] !== undefined && raw[key] !== context[key]) throw new Error("FINANCIAL_IDENTITY_MISMATCH");
  const str = (key: string, required = true) => {
    if (raw[key] === undefined && !required) return undefined;
    if (typeof raw[key] !== "string" || !(raw[key] as string).trim() || (raw[key] as string).length > 512) throw new Error("INVALID_COLLECTION_REQUEST");
    return (raw[key] as string).trim();
  };
  const requestKey = str("requestKey")!;
  const sourceKey = str("sourceKey", false);
  const method = str("method") as PaymentMethod;
  if (!["Cash", "Cheque", "Bank Transfer", "Other"].includes(method)) throw new Error("INVALID_PAYMENT_METHOD");
  const reference = str("reference")!;
  const collectionDate = str("collectionDate")!;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(collectionDate) || !Number.isFinite(Date.parse(collectionDate)) || new Date(collectionDate).toISOString().slice(0, 10) !== collectionDate || !Number.isFinite(Date.parse(context.now))) throw new Error("INVALID_COLLECTION_DATE");
  if (method === "Cheque") { str("chequeBank"); const date = str("chequeDate")!; if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))) throw new Error("INVALID_CHEQUE_DATE"); }
  if (method === "Bank Transfer") str("transferBank");
  const evidence = raw.evidence === undefined ? [] : raw.evidence;
  if (!Array.isArray(evidence) || evidence.length > 10 || evidence.some(item => typeof item !== "string" || !item.trim() || item.length > 2048)) throw new Error("INVALID_PAYMENT_EVIDENCE");
  if (raw.notes !== undefined && typeof raw.notes !== "string") throw new Error("INVALID_COLLECTION_NOTES");
  const notes = (raw.notes as string | undefined)?.trim();
  if (notes && notes.length > 4000) throw new Error("INVALID_COLLECTION_NOTES");
  const areaId = context.pharmacy.areaId;
  if (typeof areaId !== "string" || !areaId.trim() || areaId !== areaId.trim()) throw new Error("COLLECTION_SCOPE_DENIED");
  const amount = raw.amount as number;
  allocateOldestFirst(context, amount, context.receivables); // validation only; no allocation is recorded
  const payload = { pharmacyId: context.pharmacyId, marketId: context.marketId, currencyCode: context.currencyCode, decimalPlaces: context.decimalPlaces,
    areaId, ...(notes ? { notes } : {}), amount, method, reference, evidence, collectionDate, ...(sourceKey ? { sourceKey } : {}),
    ...(method === "Cheque" ? { chequeBank: str("chequeBank"), chequeDate: str("chequeDate") } : {}),
    ...(method === "Bank Transfer" ? { transferBank: str("transferBank") } : {}) };
  return { ...payload, id: collectionSubmissionId(context.actorUid, requestKey),
    requestKey, payloadHash: financialIdentityKey(payload), actorUid: context.actorUid, createdAt: context.now, status: "Submitted", revision: 1 };
}
