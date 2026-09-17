import { decodeCanonicalUserDocument } from "./organizationalHierarchyRepository";
import { resolveOfferCreatorProductScope, restrictOfferProducts, productWithinOfferScope, defaultOfferScopeDependencies, type OfferScopeDependencies } from "./offerAdministrationService";
import { createOfferAudienceOperation, resolveOfferRuntimeCapacity } from "./pharmacyOfferReadService";
import { validateCanonicalOfferDefinition } from "../src/features/offers/offerValidation";
import { randomUUID } from "node:crypto";
import type { DocumentReference, Firestore } from "firebase-admin/firestore";
import type { PharmacyVisitDraft } from "../src/features/pharmacyVisit/types/domain";
import { validateStep6 } from "../src/features/pharmacyVisit/validation/validateStep6";
import { formatBusinessDocumentNumber } from "../src/lib/businessDocumentFormat";
import { marketDateForInstant, validateBusinessDocumentCode, validateMarketSettings, type MarketBusinessSettings } from "../src/lib/marketSettings";
import { createFirestoreOperationalScopeRepository, resolveOperationalScopeForActor, type OperationalScopeRepository } from "./operationalScopeRepository";
import { getFirebaseAdminServices } from "./firebaseAdmin";
import { readProductStockQuantity } from "./pharmacyProductAvailabilityService";
import { calculateAuthoritativeVisitOffers, parseCompletionOfferIntent, PharmacyVisitOfferCompletionError } from "./pharmacyVisitOfferCompletion";
import { requireCanonicalWorkflowTemplate } from "./pharmacyOrderCreateService";
import { hasOfferCapability } from "./offerAuthorization";
import { aggregatePhysicalDemand, createReservationsInTransaction, InventoryReservationError, INVENTORY_CONTRACT_VERSION } from "./inventoryReservationService";

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const active = (value: any) => value?.active !== false && value?.isActive !== false && value?.isDeleted !== true && value?.status !== "Inactive" && value?.status !== "Archived";

export class PharmacyVisitCompletionError extends Error {
  constructor(public code: string, public status = 400, public safeReferences?: { offerId?: string; productId?: string }) { super(code); }
}

export function authoritativeProductPrice(value: unknown, preview: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new PharmacyVisitCompletionError("PHARMACY_VISIT_PRODUCT_PRICE_INVALID", 409);
  if (preview !== value) throw new PharmacyVisitCompletionError("PHARMACY_VISIT_PRODUCT_PRICE_CHANGED", 409);
  return value === 0 ? 0 : value;
}

export interface PharmacyVisitCompletionRequest { draft: PharmacyVisitDraft; finalRemarks?: string }
export interface PharmacyVisitCompletionDependencies { db?: Firestore; operationalScopeRepository?: OperationalScopeRepository; now?: () => Date; offerScopeDependencies?: OfferScopeDependencies }

export function collectPharmacyVisitProductIds(draft: PharmacyVisitDraft): string[] {
  return [...new Set([
    ...(draft.order?.lines || []).map(line => text(line.canonicalProductId)),
    ...(draft.stock?.requestLines || []).map(line => text(line.canonicalProductId)),
  ].filter(Boolean))];
}

export function canonicalizeStockRequestLine(line: any, product: any, orderedQuantity: number) {
  const productId = text(line?.canonicalProductId);
  const requestedQty = Number(line?.requestedQuantity);
  const approvedOrderQty = Number(line?.approvedOrderQty ?? orderedQuantity);
  const unfulfilledQty = Number(line?.unfulfilledQty ?? requestedQty - approvedOrderQty);
  const canonicalSkuId = text(line?.canonicalSkuId);
  const allowedSkuIds = new Set([text(product?.sku), text(product?.code), productId].filter(Boolean));
  if (!productId || !product || !Number.isSafeInteger(requestedQty) || requestedQty <= 0
    || !Number.isSafeInteger(approvedOrderQty) || approvedOrderQty < 0 || approvedOrderQty !== orderedQuantity
    || !Number.isSafeInteger(unfulfilledQty) || unfulfilledQty !== requestedQty - approvedOrderQty
    || (canonicalSkuId && !allowedSkuIds.has(canonicalSkuId))) throw new PharmacyVisitCompletionError("PHARMACY_VISIT_STOCK_REQUEST_INVALID");
  const source = text(line?.source);
  if (source === "CONFIRMED_ZERO_STOCK") {
    if (readProductStockQuantity(product) !== 0 || orderedQuantity !== 0 || Number(line?.warehouseAvailableQty) !== 0
      || line?.userConfirmed !== true || line?.backendRevalidationRequired !== true) throw new PharmacyVisitCompletionError("PHARMACY_VISIT_STOCK_REQUEST_INVALID");
  }
  return {
    productId,
    ...(canonicalSkuId ? { canonicalSkuId } : {}),
    productCode: text(product.code || product.sku),
    productNameSnapshot: text(product.name || product.nameEn || product.brand),
    requestedQty,
    approvedOrderQty,
    unfulfilledQty,
    ...(source ? { source } : {}),
    ...(text(line?.reason) ? { reason: text(line.reason) } : {}),
    ...(text(line?.priority) ? { priority: text(line.priority) } : {}),
  };
}

export function canonicalizePersistedPharmacyVisitOrder(order: PharmacyVisitDraft["order"], lines: any[], grossTotal: number, currency: string) {
  if (!order) return undefined;
  return {
    lines,
    ...(order.inputSource !== undefined ? { inputSource: order.inputSource } : {}),
    ...(order.imageAttachments !== undefined ? { imageAttachments: order.imageAttachments } : {}),
    ...(order.extractionResults !== undefined ? { extractionResults: order.extractionResults } : {}),
    ...(order.lastParseResult !== undefined ? { lastParseResult: order.lastParseResult } : {}),
    subtotalPreview: grossTotal,
    currency,
    updatedAt: order.updatedAt,
  };
}

export function parsePharmacyVisitCompletionRequest(body: unknown): PharmacyVisitCompletionRequest | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const value = body as Record<string, unknown>;
  if (Object.keys(value).some(key => !["draft", "finalRemarks"].includes(key))) return null;
  if (!value.draft || typeof value.draft !== "object" || Array.isArray(value.draft)) return null;
  if (value.finalRemarks !== undefined && typeof value.finalRemarks !== "string") return null;
  const draft = value.draft as PharmacyVisitDraft;
  if (!text(draft.draftId) || !text(draft.repUid) || !text(draft.pharmacyId) || !text(draft.areaId)) return null;
  return { draft, ...(text(value.finalRemarks) ? { finalRemarks: text(value.finalRemarks) } : {}) };
}

export async function executePharmacyVisitCompletion(
  actorUid: string,
  request: PharmacyVisitCompletionRequest,
  dependencies: PharmacyVisitCompletionDependencies = {},
) {
  const { draft } = request;
  if (!actorUid) throw new PharmacyVisitCompletionError("PHARMACY_VISIT_ACTOR_NOT_AUTHORIZED", 403);
  const enteredAmount = draft.payment?.paymentEntry?.amount;
  if (enteredAmount !== undefined && (typeof enteredAmount !== "number" || !Number.isFinite(enteredAmount) || enteredAmount < 0)) {
    throw new PharmacyVisitCompletionError("PHARMACY_VISIT_PAYMENT_INVALID");
  }
  if (enteredAmount !== undefined && enteredAmount > 0) {
    throw new PharmacyVisitCompletionError("PHARMACY_VISIT_COLLECTION_UNAVAILABLE", 409);
  }
  let offerIntents;
  try { offerIntents = parseCompletionOfferIntent(draft.offerIntent); }
  catch (error) {
    if (error instanceof PharmacyVisitOfferCompletionError) throw new PharmacyVisitCompletionError(error.code, 400, error.safeReferences);
    throw error;
  }
  const capacity = offerIntents.length ? resolveOfferRuntimeCapacity() : null;
  const validation = validateStep6(draft);
  if (!validation.isValid) throw new PharmacyVisitCompletionError("PHARMACY_VISIT_VALIDATION_FAILED");
  const scope = await resolveOperationalScopeForActor(actorUid, {}, dependencies.operationalScopeRepository || createFirestoreOperationalScopeRepository());
  if (!scope.authorized || scope.queryPlan.denyAll || scope.role !== "Sales Representative") throw new PharmacyVisitCompletionError("PHARMACY_VISIT_ACTOR_NOT_AUTHORIZED", 403);
  if (text(draft.repUid) !== actorUid) throw new PharmacyVisitCompletionError("PHARMACY_VISIT_ACTOR_MISMATCH", 403);
  const db = dependencies.db || getFirebaseAdminServices().db;
  const permission = await db.collection("rolePermissions").doc(scope.role).get();
  if (!permission.exists || permission.data()?.active === false || permission.data()?.create !== true) throw new PharmacyVisitCompletionError("PHARMACY_VISIT_CREATE_PERMISSION_DENIED", 403);

  const visitId = `PV2_${actorUid}_${text(draft.draftId)}`;
  const visitRef = db.collection("pharmacyVisits").doc(visitId);
  const pharmacyRef = db.collection("pharmacies").doc(text(draft.pharmacyId));
  const productIds = collectPharmacyVisitProductIds(draft);
  if (offerIntents.length && !hasOfferCapability(scope.role, permission.data() as any, "offers.applyDuringVisit")) throw new PharmacyVisitCompletionError("PHARMACY_VISIT_OFFER_NOT_APPLICABLE", 403);
  const now = (dependencies.now || (() => new Date()))();
  const nowIso = now.toISOString();

  const audienceBudget = { lookups: 0 };
  // Transaction-local records are refreshed on every retry.
  return db.runTransaction(async tx => {
    const audience = capacity ? createOfferAudienceOperation(actorUid, async uid => {
      const snapshot = await tx.get(db.collection("users").doc(uid));
      return snapshot.exists ? decodeCanonicalUserDocument(snapshot.id, snapshot.data()!) : null;
    }, capacity.maxAudienceLookups, audienceBudget) : null;

    const existingVisit = await tx.get(visitRef);
    if (existingVisit.exists) {
      const existing = existingVisit.data()!;
      if (text(existing.repId) !== actorUid) throw new PharmacyVisitCompletionError("PHARMACY_VISIT_ACTOR_MISMATCH", 403);
      if (text(existing.status) === "COMPLETED") return { success: true, visitId, displayNumber: text(existing.displayNumber), orderId: text(existing.orderId) || undefined, orderDisplayNumber: text(existing.orderDisplayNumber) || undefined, authoritativeTotals: { grossSubtotal: Number(existing.grossOrderTotal || existing.orderTotal || 0), totalDiscount: Number(existing.totalDiscount || 0), netSubtotal: Number(existing.orderTotal || 0), currencyCode: text(existing.currencyCode) }, appliedOfferIds: Array.isArray(existing.offerCalculation?.selectedOfferIds) ? existing.offerCalculation.selectedOfferIds : [], alreadyCompleted: true };
      throw new PharmacyVisitCompletionError("PHARMACY_VISIT_ID_CONFLICT", 409);
    }
    const pharmacySnap = await tx.get(pharmacyRef);
    if (!pharmacySnap.exists || !active(pharmacySnap.data())) throw new PharmacyVisitCompletionError("PHARMACY_INACTIVE_OR_MISSING", 403);
    const pharmacy = pharmacySnap.data()!;
    const areaId = text(pharmacy.areaId);
    if (!areaId || text(draft.areaId) !== areaId || !scope.areaIds.includes(areaId)) throw new PharmacyVisitCompletionError("PHARMACY_OUTSIDE_AUTHORIZED_AREA", 403);
    const areaRef = db.collection("areas").doc(areaId);
    const areaSnap = await tx.get(areaRef);
    if (!areaSnap.exists || !active(areaSnap.data())) throw new PharmacyVisitCompletionError("PHARMACY_GEOGRAPHY_INVALID", 409);
    const area = areaSnap.data()!;
    const countryId = text(area.countryId);
    const [countrySnap, districtSnap, citySnap, marketQuery] = await Promise.all([
      tx.get(db.collection("countries").doc(countryId)),
      tx.get(db.collection("districts").doc(text(area.districtId))),
      tx.get(db.collection("cities").doc(text(area.cityId))),
      tx.get(db.collection("marketSettings").where("countryId", "==", countryId).where("active", "==", true)),
    ]);
    if (!countrySnap.exists || !active(countrySnap.data()) || !districtSnap.exists || !active(districtSnap.data()) || !citySnap.exists || !active(citySnap.data())
      || text(districtSnap.data()?.countryId) !== countryId || text(citySnap.data()?.countryId) !== countryId || text(citySnap.data()?.districtId) !== text(area.districtId)) {
      throw new PharmacyVisitCompletionError("PHARMACY_GEOGRAPHY_INVALID", 409);
    }
    if (marketQuery.size !== 1) throw new PharmacyVisitCompletionError(marketQuery.empty ? "PHARMACY_VISIT_MARKET_REQUIRED" : "PHARMACY_VISIT_MARKET_AMBIGUOUS", 409);
    const market = { marketId: marketQuery.docs[0].id, ...marketQuery.docs[0].data() } as MarketBusinessSettings;
    if (validateMarketSettings(market).length || !validateBusinessDocumentCode(market.businessDocumentCode) || !text(market.currencyCode)) throw new PharmacyVisitCompletionError("PHARMACY_VISIT_MARKET_INVALID", 409);
    const offerSnaps = await Promise.all(offerIntents.map(intent => tx.get(db.collection("offers").doc(intent.offerId))));
    const offerDocuments = new Map(offerSnaps.filter(snap => snap.exists).map(snap => [snap.id, snap.data() || {}]));
    const creatorScopes = new Map<string, Awaited<ReturnType<typeof resolveOfferCreatorProductScope>>>();
    const creatorDependencies = dependencies.offerScopeDependencies || { ...defaultOfferScopeDependencies, resolveScope: (uid: string) => resolveOperationalScopeForActor(uid, {}, dependencies.operationalScopeRepository || createFirestoreOperationalScopeRepository()) };
    for (const intent of offerIntents) {
      const document = offerDocuments.get(intent.offerId);
      if (!document) throw new PharmacyVisitCompletionError("PHARMACY_VISIT_OFFER_NOT_FOUND", 409, { offerId: intent.offerId });
      const parsed = validateCanonicalOfferDefinition({ ...document, id: intent.offerId });
      if (!parsed.valid || !await audience!.eligible(parsed.value)) throw new PharmacyVisitCompletionError("PHARMACY_VISIT_OFFER_NOT_APPLICABLE", 403, { offerId: intent.offerId });
      if (!creatorScopes.has(parsed.value.createdBy)) creatorScopes.set(parsed.value.createdBy, await resolveOfferCreatorProductScope(parsed.value.createdBy, creatorDependencies));
      const restricted = restrictOfferProducts(parsed.value, creatorScopes.get(parsed.value.createdBy)!, scope.productIds);
      if (!restricted) throw new PharmacyVisitCompletionError("PHARMACY_VISIT_OFFER_NOT_APPLICABLE", 403, { offerId: intent.offerId });
      offerDocuments.set(intent.offerId, restricted as unknown as Record<string, unknown>);
    }
    const rewardProductIds = offerSnaps.flatMap(snap => {
      const benefit: any = snap.data()?.benefit;
      return benefit?.reward?.mode === "SELECTED_PRODUCT" && text(benefit.reward.rewardProductId) ? [text(benefit.reward.rewardProductId)] : [];
    });
    const allProductIds = Array.from(new Set([...productIds, ...rewardProductIds]));
    const productSnaps = await Promise.all(allProductIds.map(id => tx.get(db.collection("products").doc(id))));
    const products = new Map<string, Record<string, unknown>>(productSnaps.filter(snap => snap.exists).map(snap => {
      const data = snap.data()!;
      if ((data.id !== undefined && data.id !== snap.id) || (data.productId !== undefined && data.productId !== snap.id)) throw new PharmacyVisitCompletionError("PHARMACY_VISIT_PRODUCT_NOT_AUTHORIZED", 403);
      return [snap.id, { ...data, id: snap.id }];
    }));
    for (const [offerId, document] of offerDocuments) {
      const definition = document as unknown as import("../src/features/offers/types").CanonicalOfferDefinition;
      const creatorScope = creatorScopes.get(definition.createdBy)!;
      const allowed = scope.productIds.filter(id => {
        const product = products.get(id);
        return product && active(product) && productWithinOfferScope(product, id, creatorScope) && productWithinOfferScope(product, id, scope);
      });
      const restricted = restrictOfferProducts(definition, creatorScope, allowed);
      if (!restricted) throw new PharmacyVisitCompletionError("PHARMACY_VISIT_OFFER_NOT_APPLICABLE", 403, { offerId });
      offerDocuments.set(offerId, restricted as unknown as Record<string, unknown>);
    }
    const seen = new Set<string>();
    const canonicalLines = (draft.order?.lines || []).map(line => {
      const productId = text(line.canonicalProductId); const quantity = Number(line.quantity); const product: any = products.get(productId);
      if (!productId || seen.has(productId) || !Number.isSafeInteger(quantity) || quantity <= 0) throw new PharmacyVisitCompletionError("PHARMACY_VISIT_ORDER_LINE_INVALID");
      seen.add(productId);
      if (!product || !active(product) || !scope.productIds.includes(productId)) throw new PharmacyVisitCompletionError("PHARMACY_VISIT_PRODUCT_NOT_AUTHORIZED", 403);
      const price = authoritativeProductPrice(product.price, line.unitPricePreview);
      // Preserve the ordinary saleable-line shortage validation here. The
      // complete version-2 ATP check (saleable + promotional) runs below.
      const available = readProductStockQuantity(product);
      if (available == null || quantity > available) throw new PharmacyVisitCompletionError("PHARMACY_VISIT_ORDER_QUANTITY_EXCEEDS_AVAILABILITY", 409);
      return { ...line, canonicalProductId: productId, productCode: text(product.code || product.sku), productNameSnapshot: text(product.name || product.nameEn || product.brand), quantity, unitPrice: price, lineSubtotal: price * quantity };
    });
    let offerCalculation = null;
    try {
      offerCalculation = calculateAuthoritativeVisitOffers({
        intents: offerIntents, offerDocuments, products,
        paidLines: canonicalLines.map(line => ({ lineId: text(line.id), productId: line.canonicalProductId, quantity: line.quantity, unitPrice: line.unitPrice, productName: line.productNameSnapshot, sku: line.productCode })),
        currencyCode: text(market.currencyCode), decimalPlaces: market.decimalPlaces, roundingMode: (market as any).roundingMode,
        now, pharmacy: { id: pharmacySnap.id, companyId: text(pharmacy.companyId || pharmacy.company), marketId: text(market.marketId), countryId, districtId: text(area.districtId), cityId: text(area.cityId), areaId, type: text(pharmacy.type || pharmacy.pharmacyType) },
        authorizedProductIds: new Set(scope.productIds),
      });
    } catch (error) {
      if (error instanceof PharmacyVisitOfferCompletionError) throw new PharmacyVisitCompletionError(error.code, 409, error.safeReferences);
      throw error;
    }
    const grossTotal = offerCalculation?.grossSubtotal ?? canonicalLines.reduce((sum, line) => sum + Number(line.lineSubtotal), 0);
    const netTotal = offerCalculation?.netSubtotal ?? grossTotal;
    const marketDate = marketDateForInstant(now, market.timezone);
    const year = Number(marketDate.slice(0, 4));
    const code = text(market.businessDocumentCode).toUpperCase();
    const sequenceRef = db.collection("businessDocumentSequences").doc(`${code}_PV_${year}`);
    const sequenceSnap = await tx.get(sequenceRef);
    const next = Number(sequenceSnap.data()?.lastSequence || 0) + 1;
    if (!Number.isSafeInteger(next) || next <= 0) throw new PharmacyVisitCompletionError("PHARMACY_VISIT_SEQUENCE_INVALID", 409);
    const displayNumber = formatBusinessDocumentNumber(code, "PV", year, next);
    let plannerRef = null; let plannerSnap = null;
    if (text(draft.plannerId)) {
      plannerRef = db.collection("salesPlannerVisits").doc(text(draft.plannerId)); plannerSnap = await tx.get(plannerRef);
      if (!plannerSnap.exists || text(plannerSnap.data()?.repId) !== actorUid) throw new PharmacyVisitCompletionError("PHARMACY_VISIT_PLANNER_NOT_AUTHORIZED", 403);
    }
    const orderId = canonicalLines.length ? `ORD_${visitId}` : null;
    const calculatedPaid = new Map<string, import("../src/features/offers/offerCalculation").CalculatedPaidLine>(offerCalculation?.paidLines.map(line => [line.lineId, line]) || []);
    const authoritativePaidLines = canonicalLines.map(line => ({ ...line, lineKind: "PAID_ORDER_LINE", ...(calculatedPaid.get(text(line.id)) || {}) }));
    const physicalDemand = aggregatePhysicalDemand([
      ...authoritativePaidLines.map(line => ({ productId: line.canonicalProductId, saleableQuantity: line.quantity })),
      ...(offerCalculation?.freeLines || []).map(line => ({ productId: line.productId, promotionalFreeQuantity: line.quantity })),
    ]);
    const canonicalOrder = {
      ...canonicalizePersistedPharmacyVisitOrder(draft.order, authoritativePaidLines, grossTotal, text(market.currencyCode)),
      freeLines: offerCalculation?.freeLines || [], grossSubtotal: grossTotal,
      productDiscountTotal: offerCalculation?.productDiscountTotal || 0, invoiceDiscountTotal: offerCalculation?.invoiceDiscountTotal || 0,
      totalDiscount: offerCalculation?.totalDiscount || 0, netSubtotal: netTotal,
    };
    let order: Record<string, unknown> | null = null;
    let orderSequenceRef: DocumentReference | null = null;
    if (orderId) {
      const orderRef = db.collection("orders").doc(orderId);
      const orderYear = year;
      orderSequenceRef = db.collection("businessDocumentSequences").doc(`${code}_SO_${orderYear}`);
      const existingOrder = await tx.get(orderRef);
      const templateSnap = await tx.get(db.collection("orderWorkflowTemplates").doc("ENTERPRISE_V1"));
      const orderSequenceSnap = await tx.get(orderSequenceRef);
      if (existingOrder.exists) throw new PharmacyVisitCompletionError("PHARMACY_VISIT_ORDER_ID_CONFLICT", 409);
      try { requireCanonicalWorkflowTemplate(templateSnap.exists ? templateSnap.data() : null); }
      catch { throw new PharmacyVisitCompletionError("PHARMACY_VISIT_ORDER_WORKFLOW_REQUIRED", 409); }
      const orderSequence = Number(orderSequenceSnap.data()?.lastSequence || 0) + 1;
      if (!Number.isSafeInteger(orderSequence) || orderSequence <= 0) throw new PharmacyVisitCompletionError("PHARMACY_VISIT_ORDER_SEQUENCE_INVALID", 409);
      const orderDisplayNumber = formatBusinessDocumentNumber(code, "SO", orderYear, orderSequence);
      const paidItems = authoritativePaidLines.map(line => ({ id: line.canonicalProductId, productId: line.canonicalProductId, name: line.productNameSnapshot, quantity: line.quantity, price: line.unitPrice, total: calculatedPaid.get(text(line.id))?.netAmount ?? line.lineSubtotal, lineKind: "PAID_ORDER_LINE", productDiscountAmount: calculatedPaid.get(text(line.id))?.productDiscountAmount || 0, invoiceDiscountAmount: calculatedPaid.get(text(line.id))?.invoiceDiscountAmount || 0, appliedOfferIds: calculatedPaid.get(text(line.id))?.appliedOfferIds || [] }));
      const freeItems = (offerCalculation?.freeLines || []).map(line => ({ id: line.deterministicFreeLineKey, productId: line.productId, name: text(products.get(line.productId)?.name || products.get(line.productId)?.nameEn || products.get(line.productId)?.brand), quantity: line.quantity, price: 0, total: 0, ...line }));
      let reservationIds: string[];
      try {
        reservationIds = createReservationsInTransaction(db, tx, { orderId, pharmacyVisitId: visitId, pharmacyId: pharmacySnap.id, companyId: text(pharmacy.companyId || pharmacy.company), countryId, marketId: text(market.marketId), actorUid, products, demand: physicalDemand });
      } catch (error) {
        if (error instanceof InventoryReservationError) throw new PharmacyVisitCompletionError(error.code, 409, error.productId ? { productId: error.productId } : undefined);
        throw error;
      }
      order = { id: orderId, orderId, displayNumber: orderDisplayNumber, visitDisplayNumber: displayNumber, visitId, pharmacyId: pharmacySnap.id, pharmacyName: text(pharmacy.nameEn || pharmacy.name), pharmacyAddress: text(pharmacy.address), areaId, countryId, marketId: text(market.marketId), date: marketDate, total: netTotal, grossTotal, totalDiscount: offerCalculation?.totalDiscount || 0, currencyCode: text(market.currencyCode), currency: text(market.currencyCode), paidStatus: "Unpaid", paidAmount: 0, status: "PENDING_FINANCE_REVIEW", stage: "FINANCE_REVIEW", inventoryContractVersion: INVENTORY_CONTRACT_VERSION, reservationIds, physicalDemand, totalSaleableQuantity: physicalDemand.reduce((sum, row) => sum + row.saleableQuantity, 0), totalPromotionalFreeQuantity: physicalDemand.reduce((sum, row) => sum + row.promotionalFreeQuantity, 0), totalPhysicalQuantity: physicalDemand.reduce((sum, row) => sum + row.totalPhysicalQuantity, 0), createdByUid: actorUid, salesRepUid: actorUid, representativeUid: actorUid, salesRep: actorUid, createdBy: actorUid, items: [...paidItems, ...freeItems], offerCalculation, history: [{ transitionId: `TR_${randomUUID()}`, orderId, orderDisplayNumber, fromStatus: "DRAFT", toStatus: "PENDING_FINANCE_REVIEW", fromStage: "SUBMISSION", toStage: "FINANCE_REVIEW", action: "CREATE_AND_SUBMIT", actorUid, orderCapabilityUsed: "ORDER_SUBMIT", comments: "Order submitted via Pharmacy Visit completion.", createdAt: nowIso, source: "BACKEND" }], createdAt: nowIso, updatedAt: nowIso, updatedBy: actorUid, orderSequence };
    }
    const visit = {
      id: visitId, displayNumber, visitNumber: displayNumber, schemaVersion: "2.0", draftId: text(draft.draftId),
      repId: actorUid, representativeUid: actorUid, pharmacyId: pharmacySnap.id, pharmacyName: text(pharmacy.name),
      pharmacySnapshot: { id: pharmacySnap.id, nameEn: text(pharmacy.name), nameAr: text(pharmacy.nameAr), type: text(pharmacy.type), areaId, countryId, marketId: text(market.marketId), currencyCode: text(market.currencyCode), address: text(pharmacy.address) },
      areaId, countryId, marketId: text(market.marketId), currencyCode: text(market.currencyCode), businessDocumentCode: code,
      plannerId: text(draft.plannerId) || null, entrySource: draft.entrySource, visitPurpose: draft.visitPurpose, status: "COMPLETED", currentStep: 6,
      date: marketDate, visitDate: marketDate, completedAt: nowIso, order: canonicalOrder, orderId, orderDisplayNumber: text(order?.displayNumber), offerIntent: offerIntents, offerCalculation,
      payment: draft.payment?.paymentEntry ? { paymentEntry: draft.payment.paymentEntry } : null, stock: draft.stock || null, finalRemarks: text(request.finalRemarks) || null,
      orderTotal: netTotal, grossOrderTotal: grossTotal, totalDiscount: offerCalculation?.totalDiscount || 0,
      gps: draft.gps || null, gpsVerified: draft.gps?.status === "VERIFIED", gpsVerificationStatus: draft.gps?.status === "VERIFIED" ? "FIRST_VISIT_CAPTURED" : pharmacy.gpsVerified === true ? "VERIFIED_PREVIOUSLY" : "UNVERIFIED",
      ...(orderId ? { inventoryContractVersion: INVENTORY_CONTRACT_VERSION } : {}), createdAt: nowIso, createdBy: actorUid, updatedAt: nowIso, updatedBy: actorUid,
    };
    tx.set(sequenceRef, { countryCode: code, documentPrefix: "PV", year, lastSequence: next, updatedAt: nowIso, updatedByUid: actorUid }, { merge: true });
    if (order && orderId && orderSequenceRef) {
      tx.set(orderSequenceRef, { countryCode: code, documentPrefix: "SO", year, lastSequence: order.orderSequence, updatedAt: nowIso, updatedByUid: actorUid }, { merge: true });
      tx.create(db.collection("orders").doc(orderId), order);
    }
    const pharmacyUpdate: Record<string, unknown> = { lastVisitDate: marketDate, updatedAt: nowIso, updatedBy: actorUid };
    if (pharmacy.gpsVerified !== true && draft.gps?.status === "VERIFIED" && Number.isFinite(draft.gps.latitude) && Number.isFinite(draft.gps.longitude)) {
      Object.assign(pharmacyUpdate, { latitude: draft.gps.latitude, longitude: draft.gps.longitude, gpsAccuracyMeters: Number(draft.gps.accuracy ?? draft.gps.accuracyMeters ?? 0), gpsVerificationStatus: "VERIFIED", gpsVerified: true, gpsVerifiedAt: nowIso, gpsVerifiedByUid: actorUid, gpsVerifiedVisitId: visitId, gpsVerificationSource: "LIVE_DEVICE_FIRST_VISIT" });
    }
    tx.update(pharmacyRef, pharmacyUpdate);
    if (plannerRef && plannerSnap) tx.update(plannerRef, { completedVisitId: visitId, visitStatus: "Completed", updatedAt: nowIso, updatedBy: actorUid });
    for (const line of draft.stock?.requestLines || []) {
      const productId = text(line.canonicalProductId);
      const ordered = canonicalLines.find(item => item.canonicalProductId === productId)?.quantity || 0;
      if (!scope.productIds.includes(productId)) throw new PharmacyVisitCompletionError("PHARMACY_VISIT_STOCK_REQUEST_INVALID");
      const canonicalRequest = canonicalizeStockRequestLine(line, products.get(productId), ordered);
      if (canonicalRequest.unfulfilledQty > 0) tx.create(db.collection("stockRequests").doc(`SR_${visitId}_${productId}`), { id: `SR_${visitId}_${productId}`, visitId, pharmacyId: pharmacySnap.id, representativeUid: actorUid, ...canonicalRequest, status: "PENDING_INVENTORY_VALIDATION", createdAt: nowIso, createdBy: actorUid, persistenceSource: "BACKEND" });
    }
    tx.create(visitRef, visit);
    tx.create(db.collection("auditLogs").doc(`AUD-PV2-${randomUUID()}`), { userId: actorUid, userRole: scope.role, action: "Pharmacy Visit Completed (V2)", entityType: "PharmacyVisit", entityId: visitId, timestamp: nowIso, source: "BACKEND" });
    return { success: true, visitId, displayNumber, orderId, orderDisplayNumber: text(order?.displayNumber), authoritativeTotals: { grossSubtotal: grossTotal, totalDiscount: offerCalculation?.totalDiscount || 0, netSubtotal: netTotal, currencyCode: text(market.currencyCode) }, appliedOfferIds: offerCalculation?.selectedOfferIds || [], alreadyCompleted: false };
  });
}
