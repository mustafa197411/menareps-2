import { financialMinorUnits } from "../src/features/ar/arResolvers";
import { getFirebaseAdminServices } from "./firebaseAdmin";
import { createFirestoreOperationalScopeRepository, resolveOperationalScopeForActor, type OperationalScopeRepository } from "./operationalScopeRepository";
import { resolveFinancialIdentity } from "../src/lib/financialIdentity";
import { validateMarketSettings, type MarketBusinessSettings } from "../src/lib/marketSettings";
import type { OperationalSubjectMode } from "./operationalScopeService";

export type CommercialReadKind = "PAYMENTS" | "CUSTOMER_ACCOUNTS" | "ORDERS";
export interface CommercialReadRequest { kind: CommercialReadKind; pharmacyId?: string; orderId?: string }
export interface CommercialReadRepository {
  queryByAreas(collectionName: "paymentCollections" | "pharmacies" | "orders", areaIds: string[]): Promise<Record<string, any>[]>;
  getProfiles(pharmacyIds: string[]): Promise<Record<string, any>[]>;
  getLedger(pharmacyId: string): Promise<Record<string, any>[]>;
  queryOrdersByPharmacies?(pharmacyIds: string[]): Promise<Record<string, any>[]>;
  getMarketSettings?(): Promise<MarketBusinessSettings[]>;
}

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const unique = (values: string[]) => Array.from(new Set(values.map(text).filter(Boolean))).sort();
const GLOBAL_ROLES = new Set(["Super Admin", "Admin", "System Administrator", "General Manager"]);
const FINANCIAL_ROLES = new Set([...GLOBAL_ROLES, "Finance Manager", "Finance Officer"]);
const ORDER_ROLES = new Set([...GLOBAL_ROLES, "Regional Manager", "Country Manager", "Sales & Marketing Manager", "Sales Manager", "Area Sales Manager", "Sales Supervisor", "Medical Manager", "Medical Supervisor", "Finance Manager", "Finance Officer", "Warehouse Manager", "Store Manager", "Delivery Officer", "Medical Representative", "Sales Representative"]);
const PAYMENT_ROLES = new Set([...FINANCIAL_ROLES, "Regional Manager", "Country Manager", "Sales & Marketing Manager", "Sales Manager", "Area Sales Manager", "Sales Supervisor", "Medical Supervisor", "Medical Representative", "Sales Representative"]);

export function parseCommercialReadRequest(value: unknown): CommercialReadRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>; const kind = text(raw.kind) as CommercialReadKind;
  if (!(["PAYMENTS", "CUSTOMER_ACCOUNTS", "ORDERS"] as string[]).includes(kind)) return null;
  if (Object.keys(raw).some(key => !["kind", "pharmacyId", "orderId"].includes(key))) return null;
  const pharmacyId = text(raw.pharmacyId); const orderId = text(raw.orderId);
  if (orderId && kind !== "ORDERS") return null;
  return { kind, ...(pharmacyId ? { pharmacyId } : {}), ...(orderId ? { orderId } : {}) };
}

export function createFirestoreCommercialReadRepository(): CommercialReadRepository {
  const { db } = getFirebaseAdminServices();
  return {
    async queryByAreas(collectionName, areaIds) {
      if (!areaIds.length || areaIds.length > 30) throw new Error("INVALID_COMMERCIAL_AREA_CHUNK");
      const snapshot = await db.collection(collectionName).where("areaId", "in", areaIds).get();
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    },
    async getProfiles(pharmacyIds) {
      const records: Record<string, any>[] = [];
      for (const id of unique(pharmacyIds)) { const snapshot = await db.collection("customerFinancialProfiles").doc(id).get(); if (snapshot.exists) records.push({ id: snapshot.id, ...snapshot.data() }); }
      return records;
    },
    async getLedger(pharmacyId) {
      const snapshot = await db.collection("customerLedgerEntries").where("pharmacyId", "==", pharmacyId).get();
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    },
    async queryOrdersByPharmacies(pharmacyIds) {
      if (!pharmacyIds.length || pharmacyIds.length > 30) throw new Error("INVALID_COMMERCIAL_PHARMACY_CHUNK");
      const snapshot = await db.collection("orders").where("pharmacyId", "in", pharmacyIds).get();
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    },
    async getMarketSettings() {
      const snapshot = await db.collection("marketSettings").where("active", "==", true).get();
      return snapshot.docs.map(doc => ({ marketId: doc.id, ...doc.data() } as MarketBusinessSettings));
    },
  };
}

function actorUid(row: Record<string, any>): string { return text(row.representativeUid || row.salesRepUid || row.createdByUid || row.repId || row.userId); }
function hasIdentity(row: Record<string, any>, markets: readonly MarketBusinessSettings[]): boolean { return Boolean(resolveFinancialIdentity([row], markets)); }

export function filterCommercialRows(rows: Record<string, any>[], context: { actor: string; role: string; subjectMode: OperationalSubjectMode; areaIds: string[]; subjectUids: string[]; kind: CommercialReadKind }, markets: readonly MarketBusinessSettings[] = []): Record<string, any>[] {
  const areas = new Set(context.areaIds); const subjects = new Set(context.subjectUids); const global = context.subjectMode === "ORGANIZATION"; const geographyOperator = context.subjectMode === "FUNCTIONAL";
  return rows.filter(row => areas.has(text(row.areaId)) && hasIdentity(row, markets) && (context.kind === "CUSTOMER_ACCOUNTS" || global || geographyOperator || subjects.has(actorUid(row)) || (context.role === "Delivery Officer" && text(row.deliveryOfficerUid || row.deliveryOfficerId) === context.actor)));
}

/** Payment-only adapter: authorize canonical ownership before exposing presentation aliases. */
export function readablePayments(rows: Record<string, any>[], pharmacies: Record<string, any>[], context: Parameters<typeof filterCommercialRows>[1], markets: readonly MarketBusinessSettings[]) {
  return rows.flatMap(row => {
    const canonical = ["actorUid", "requestKey", "payloadHash"].some(key => Object.hasOwn(row, key));
    if (!canonical) return filterCommercialRows([row], context, markets);
    const pharmacy = pharmacies.find(item => item.id === row.pharmacyId);
    if (!pharmacy || typeof row.actorUid !== "string" || !row.actorUid.trim() || row.actorUid !== row.actorUid.trim()
      || row.areaId !== pharmacy.areaId || !context.areaIds.includes(row.areaId) || !hasIdentity(row, markets)
      || !row.id || typeof row.requestKey !== "string" || !row.requestKey || typeof row.payloadHash !== "string" || !row.payloadHash
      || !Number.isSafeInteger(row.revision) || row.revision < 1 || !Number.isFinite(row.amount) || row.amount <= 0
      || !["Cash", "Cheque", "Bank Transfer", "Other"].includes(row.method) || typeof row.reference !== "string"
      || !Array.isArray(row.evidence) || row.evidence.length > 10 || row.evidence.some((item: unknown) => typeof item !== "string" || !item.trim() || item.length > 2048)
      || (row.notes !== undefined && (typeof row.notes !== "string" || row.notes.length > 4000))
      || !["Submitted", "Verified", "Rejected", "Corrected", "Reversed"].includes(row.status)) return [];
    const identity = resolveFinancialIdentity([pharmacy], markets);
    if (!identity || row.marketId !== identity.marketId || row.currencyCode !== identity.currencyCode) return [];
    const market = markets.find(item => item.marketId === identity.marketId);
    if (!market || row.decimalPlaces !== market.decimalPlaces) return [];
    try { financialMinorUnits(row.amount, market.decimalPlaces); } catch { return []; }
    if (!["ORGANIZATION", "FUNCTIONAL"].includes(context.subjectMode) && !context.subjectUids.includes(row.actorUid)) return [];
    return [{ ...row, paymentId: row.id, paymentNumber: row.id, paymentMethod: row.method, referenceNumber: row.reference,
      representativeUid: row.actorUid, representativeName: row.actorUid, pharmacyName: pharmacy.name || pharmacy.pharmacyName || pharmacy.id,
      attachmentUrls: row.evidence, currency: row.currencyCode, chequeBankName: row.chequeBank, transferBankName: row.transferBank }];
  });
}

export function selectRequestedOrder(authorizedOrders: Record<string, any>[], orderId?: string): Record<string, any>[] {
  const requestedOrderId = text(orderId);
  return requestedOrderId ? authorizedOrders.filter(order => text(order.id) === requestedOrderId) : authorizedOrders;
}

export async function resolveScopedCommercialRead(actor: string, request: CommercialReadRequest, dependencies: { operationalScopeRepository?: OperationalScopeRepository; repository?: CommercialReadRepository } = {}) {
  const scope = await resolveOperationalScopeForActor(actor, {}, dependencies.operationalScopeRepository || createFirestoreOperationalScopeRepository());
  const role = text(scope.role); const allowed = request.kind === "CUSTOMER_ACCOUNTS" ? FINANCIAL_ROLES : request.kind === "PAYMENTS" ? PAYMENT_ROLES : ORDER_ROLES;
  if (!scope.authorized || scope.queryPlan.denyAll || !scope.queryPlan.areaIdChunks.length || !allowed.has(role)) return { authorized: false, code: scope.code || "COMMERCIAL_READ_DENIED", payments: [], pharmacies: [], profiles: [], ledger: [], orders: [] };
  const repository = dependencies.repository || createFirestoreCommercialReadRepository(); const areas = new Set(scope.areaIds);
  const markets = repository.getMarketSettings ? await repository.getMarketSettings() : [];
  if (!markets.length || markets.some(market => validateMarketSettings(market).length > 0)) return { authorized: false, code: "COMMERCIAL_MARKET_CONFIGURATION_REQUIRED", payments: [], pharmacies: [], profiles: [], ledger: [], orders: [] };
  const areaRows = async (collectionName: "paymentCollections" | "pharmacies" | "orders") => (await Promise.all(scope.queryPlan.areaIdChunks.map(chunk => repository.queryByAreas(collectionName, chunk)))).flat().filter(row => areas.has(text(row.areaId)));
  if (request.kind === "PAYMENTS") {
    const [rawPayments, rawPharmacies] = await Promise.all([areaRows("paymentCollections"), areaRows("pharmacies")]);
    const pharmacies = rawPharmacies.filter(row => hasIdentity(row, markets));
    const payments = readablePayments(rawPayments, pharmacies, { actor, role, subjectMode: scope.subjectMode!, areaIds: scope.areaIds, subjectUids: scope.subjectUids, kind: "PAYMENTS" }, markets);
    return { authorized: true, payments, pharmacies, profiles: [], ledger: [], orders: [], markets };
  }
  if (request.kind === "CUSTOMER_ACCOUNTS") {
    const pharmacies = (await areaRows("pharmacies")).filter(row => hasIdentity(row, markets)); const permitted = request.pharmacyId ? pharmacies.filter(row => text(row.id) === request.pharmacyId) : pharmacies;
    if (request.pharmacyId && !permitted.length) return { authorized: false, code: "CUSTOMER_ACCOUNT_OUTSIDE_SCOPE", payments: [], pharmacies: [], profiles: [], ledger: [], orders: [] };
    const profiles = (await repository.getProfiles(permitted.map(row => text(row.id)))).filter(row => hasIdentity(row, markets));
    const ledger = request.pharmacyId ? (await repository.getLedger(request.pharmacyId)).filter(row => hasIdentity(row, markets)) : [];
    return { authorized: true, payments: [], pharmacies: permitted, profiles, ledger, orders: [], markets };
  }
  const rawOrders = await areaRows("orders");
  // Backward-compatible, bounded adapter for legacy orders that predate the
  // canonical areaId field. Scope is first established from authorized
  // pharmacies; this is never an unrestricted orders scan.
  if (repository.queryOrdersByPharmacies) {
    const scopedPharmacies = await areaRows("pharmacies");
    const pharmacyAreas = new Map(scopedPharmacies.map(pharmacy => [text(pharmacy.id), text(pharmacy.areaId)]));
    const pharmacyIds = [...pharmacyAreas.keys()];
    for (let index = 0; index < pharmacyIds.length; index += 30) {
      const legacy = await repository.queryOrdersByPharmacies(pharmacyIds.slice(index, index + 30));
      legacy.forEach(order => { if (!text(order.areaId) && pharmacyAreas.has(text(order.pharmacyId))) rawOrders.push({ ...order, areaId: pharmacyAreas.get(text(order.pharmacyId)), scopeResolution: "LEGACY_PHARMACY_AREA_ADAPTER" }); });
    }
  }
  const authorizedOrders = filterCommercialRows(rawOrders, { actor, role, subjectMode: scope.subjectMode!, areaIds: scope.areaIds, subjectUids: scope.subjectUids, kind: "ORDERS" }, markets);
  const orders = selectRequestedOrder(authorizedOrders, request.orderId);
  return { authorized: true, payments: [], pharmacies: [], profiles: [], ledger: [], orders, markets };
}
