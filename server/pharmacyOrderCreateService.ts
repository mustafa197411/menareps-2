import type { Firestore } from "firebase-admin/firestore";
import { randomUUID } from "node:crypto";
import { formatBusinessDocumentNumber } from "../src/lib/businessDocumentFormat";
import { marketDateForInstant, validateBusinessDocumentCode, validateMarketSettings, type MarketBusinessSettings } from "../src/lib/marketSettings";
import { isRuntimeOrderWorkflowTemplate, type OrderWorkflowTemplate } from "../src/features/orders/orderWorkflowTemplate";
import { createFirestoreOperationalScopeRepository, resolveOperationalScopeForActor, type OperationalScopeRepository } from "./operationalScopeRepository";
import { getFirebaseAdminServices } from "./firebaseAdmin";
import { readProductStockQuantity } from "./pharmacyProductAvailabilityService";
import { classifyInventoryContract } from "../src/features/orders/inventoryContractClassifier";

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const active = (value: any) => value?.active !== false && value?.isActive !== false && value?.isDeleted !== true && value?.status !== "Inactive";

export interface PharmacyOrderCreateRequest { visitId: string }
export interface PharmacyOrderCreateDependencies { db?: Firestore; operationalScopeRepository?: OperationalScopeRepository; now?: () => Date }

export function parsePharmacyOrderCreateRequest(body: unknown): PharmacyOrderCreateRequest | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const value = body as Record<string, unknown>;
  if (Object.keys(value).some(key => key !== "visitId")) return null;
  const visitId = text(value.visitId);
  return visitId ? { visitId } : null;
}

export function requireCanonicalWorkflowTemplate(value: unknown): OrderWorkflowTemplate {
  if (!isRuntimeOrderWorkflowTemplate(value)) throw new Error(value && typeof value === "object" ? "ORDER_WORKFLOW_CONFIGURATION_INVALID" : "ORDER_WORKFLOW_CONFIGURATION_REQUIRED");
  return value;
}

export function canonicalizeOrderLines(raw: unknown, products: Map<string, any>, authorizedProductIds: Set<string>, availableByProduct?: Map<string, number>) {
  if (!Array.isArray(raw) || !raw.length) throw new Error("ORDER_LINES_REQUIRED");
  const seen = new Set<string>();
  return raw.map((line: any) => {
    const productId = text(line?.canonicalProductId);
    const quantity = Number(line?.quantity);
    if (!productId || seen.has(productId) || !Number.isSafeInteger(quantity) || quantity <= 0) throw new Error("ORDER_LINE_INVALID");
    seen.add(productId);
    const product = products.get(productId);
    if (!product || !active(product) || !authorizedProductIds.has(productId)) throw new Error("ORDER_PRODUCT_NOT_AUTHORIZED");
    if (availableByProduct) {
      const available = availableByProduct.get(productId);
      if (available == null) throw new Error("ORDER_PRODUCT_AVAILABILITY_UNAVAILABLE");
      if (quantity > available) throw new Error("ORDER_QUANTITY_EXCEEDS_AUTHORIZED_AVAILABILITY");
    }
    const price = Number(product.price);
    if (!Number.isFinite(price) || price < 0) throw new Error("ORDER_PRODUCT_PRICE_INVALID");
    return { id: productId, productId, name: text(product.name || product.nameEn || product.brand), quantity, price, total: price * quantity };
  });
}

export async function executePharmacyOrderCreate(actorUid: string, request: PharmacyOrderCreateRequest, dependencies: PharmacyOrderCreateDependencies = {}) {
  const scope = await resolveOperationalScopeForActor(actorUid, {}, dependencies.operationalScopeRepository || createFirestoreOperationalScopeRepository());
  if (!scope.authorized || scope.queryPlan.denyAll || scope.role !== "Sales Representative") return { success: false, code: scope.code || "ORDER_CREATE_NOT_AUTHORIZED" };
  const db = dependencies.db || getFirebaseAdminServices().db;
  const permissionSnap = await db.collection("rolePermissions").doc(scope.role).get();
  if (!permissionSnap.exists || permissionSnap.data()?.active === false || permissionSnap.data()?.create !== true) return { success: false, code: "ORDER_CREATE_PERMISSION_DENIED" };
  const now = (dependencies.now || (() => new Date()))();
  const nowIso = now.toISOString();
  const visitRef = db.collection("pharmacyVisits").doc(request.visitId);
  const orderId = `ORD_${request.visitId}`;
  const orderRef = db.collection("orders").doc(orderId);
  try {
    return await db.runTransaction(async tx => {
      const [visitSnap, existingOrder, templateSnap] = await Promise.all([
        tx.get(visitRef), tx.get(orderRef), tx.get(db.collection("orderWorkflowTemplates").doc("ENTERPRISE_V1")),
      ]);
      if (existingOrder.exists) return { success: true, orderId, displayNumber: text(existingOrder.data()?.displayNumber), alreadyCreated: true };
      if (!visitSnap.exists) throw new Error("PHARMACY_VISIT_REQUIRED");
      const visit = visitSnap.data()!;
      if (text(visit.status) !== "COMPLETED" || ![visit.repId, visit.createdBy, visit.representativeUid].map(text).includes(actorUid)) throw new Error("PHARMACY_VISIT_NOT_AUTHORIZED");
      if (!classifyInventoryContract(visit).legacy) throw new Error("VERSION2_VISIT_ORDER_INTEGRITY_ERROR");
      requireCanonicalWorkflowTemplate(templateSnap.exists ? templateSnap.data() : null);
      const pharmacyId = text(visit.pharmacyId);
      const pharmacySnap = pharmacyId ? await tx.get(db.collection("pharmacies").doc(pharmacyId)) : null;
      if (!pharmacySnap?.exists || !active(pharmacySnap.data())) throw new Error("PHARMACY_INACTIVE_OR_MISSING");
      const pharmacy = pharmacySnap.data()!;
      const areaId = text(pharmacy.areaId);
      if (!areaId || text(visit.areaId) !== areaId || !scope.areaIds.includes(areaId)) throw new Error("PHARMACY_OUTSIDE_AUTHORIZED_AREA");
      const areaSnap = await tx.get(db.collection("areas").doc(areaId));
      if (!areaSnap.exists || !active(areaSnap.data())) throw new Error("PHARMACY_GEOGRAPHY_INVALID");
      const area = areaSnap.data()!;
      const countryId = text(area.countryId);
      const [countrySnap, districtSnap, citySnap, marketSnap] = await Promise.all([
        tx.get(db.collection("countries").doc(countryId)),
        tx.get(db.collection("districts").doc(text(area.districtId))),
        tx.get(db.collection("cities").doc(text(area.cityId))),
        tx.get(db.collection("marketSettings").where("countryId", "==", countryId).where("active", "==", true)),
      ]);
      if (!countrySnap.exists || !active(countrySnap.data()) || !districtSnap.exists || !active(districtSnap.data()) || !citySnap.exists || !active(citySnap.data())
        || text(districtSnap.data()?.countryId) !== countryId || text(citySnap.data()?.countryId) !== countryId || text(citySnap.data()?.districtId) !== text(area.districtId)) throw new Error("PHARMACY_GEOGRAPHY_INVALID");
      if (marketSnap.size !== 1) throw new Error(marketSnap.empty ? "ORDER_MARKET_CONFIGURATION_REQUIRED" : "ORDER_MARKET_CONFIGURATION_AMBIGUOUS");
      const market = { marketId: marketSnap.docs[0].id, ...marketSnap.docs[0].data() } as MarketBusinessSettings;
      if (validateMarketSettings(market).length > 0 || !validateBusinessDocumentCode(market.businessDocumentCode) || !text(market.currencyCode)) throw new Error("ORDER_MARKET_CONFIGURATION_INVALID");
      const rawLines = visit.order?.lines;
      const productIds = Array.isArray(rawLines) ? [...new Set(rawLines.map((line: any) => text(line?.canonicalProductId)).filter(Boolean))] : [];
      const productSnaps = productIds.length ? await Promise.all(productIds.map(id => tx.get(db.collection("products").doc(id)))) : [];
      const products = new Map(productSnaps.filter(snap => snap.exists).map(snap => [snap.id, { id: snap.id, ...snap.data() }]));
      const availableByProduct = new Map<string, number>();
      for (const [productId, product] of products) {
        const quantity = readProductStockQuantity(product);
        if (quantity == null) throw new Error("ORDER_PRODUCT_AVAILABILITY_UNAVAILABLE");
        availableByProduct.set(productId, quantity);
      }
      const items = canonicalizeOrderLines(rawLines, products, new Set(scope.productIds), availableByProduct);
      const total = items.reduce((sum, line) => sum + line.total, 0);
      const marketDate = marketDateForInstant(now, market.timezone);
      const year = Number(marketDate.slice(0, 4));
      const code = text(market.businessDocumentCode).toUpperCase();
      const sequenceRef = db.collection("businessDocumentSequences").doc(`${code}_SO_${year}`);
      const sequenceSnap = await tx.get(sequenceRef);
      const nextSequence = Number(sequenceSnap.exists ? sequenceSnap.data()?.lastSequence : 0) + 1;
      if (!Number.isSafeInteger(nextSequence) || nextSequence <= 0) throw new Error("ORDER_SEQUENCE_INVALID");
      const displayNumber = formatBusinessDocumentNumber(code, "SO", year, nextSequence);
      const notes = text(visit.finalRemarks || visit.order?.notes);
      const order = { id: orderId, orderId, displayNumber, visitDisplayNumber: text(visit.displayNumber), visitId: request.visitId, pharmacyId, pharmacyName: text(pharmacy.nameEn || pharmacy.name), pharmacyAddress: text(pharmacy.address), areaId, countryId, marketId: text(market.marketId), date: marketDate, total, currencyCode: text(market.currencyCode), currency: text(market.currencyCode), paidStatus: "Unpaid", paidAmount: 0, status: "PENDING_FINANCE_REVIEW", stage: "FINANCE_REVIEW", createdByUid: actorUid, salesRepUid: actorUid, representativeUid: actorUid, salesRep: actorUid, createdBy: actorUid, items, history: [{ transitionId: `TR_${randomUUID()}`, orderId, orderDisplayNumber: displayNumber, fromStatus: "DRAFT", toStatus: "PENDING_FINANCE_REVIEW", fromStage: "SUBMISSION", toStage: "FINANCE_REVIEW", action: "CREATE_AND_SUBMIT", actorUid, orderCapabilityUsed: "ORDER_SUBMIT", comments: notes || "Order submitted via Pharmacy Visit completion.", createdAt: nowIso, source: "BACKEND" }], ...(notes ? { notes } : {}), createdAt: nowIso, updatedAt: nowIso, updatedBy: actorUid };
      tx.set(sequenceRef, { countryCode: code, documentPrefix: "SO", year, lastSequence: nextSequence, updatedAt: nowIso, updatedByUid: actorUid }, { merge: true });
      tx.create(orderRef, order);
      tx.set(visitRef, { orderId, orderDisplayNumber: displayNumber, orderTotal: total, currencyCode: text(market.currencyCode), countryId, marketId: text(market.marketId), updatedAt: nowIso, updatedBy: actorUid }, { merge: true });
      return { success: true, orderId, displayNumber, alreadyCreated: false };
    });
  } catch (error) {
    return { success: false, code: error instanceof Error ? error.message : "ORDER_CREATE_FAILED" };
  }
}
