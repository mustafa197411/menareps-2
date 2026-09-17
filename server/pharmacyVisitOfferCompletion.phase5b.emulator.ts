import { deleteApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import type { CanonicalOfferDefinition } from "../src/features/offers/types";
import { OFFER_CALCULATION_VERSION } from "../src/features/offers/offerCalculation";
import { ENTERPRISE_WORKFLOW_TEMPLATE } from "../src/features/orders/orderWorkflowTemplate";
import { offerInputFingerprint } from "../src/features/pharmacyVisit/services/canonicalOfferVisit";
import type { PharmacyVisitDraft } from "../src/features/pharmacyVisit/types/domain";
import type { OperationalScopeRepository } from "./operationalScopeRepository";

const PROJECT_ID = "demo-menareps-phase5c";
const ACTOR_UID = "phase5b-sales-rep";
const NOW = new Date("2030-01-02T10:00:00.000Z");

function assertIsolation(): void {
  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST?.trim() || "";
  if (!/^127\.0\.0\.1:\d+$/.test(emulatorHost)) throw new Error("PHASE5B_FIRESTORE_EMULATOR_REQUIRED");
  const configuredProjects = [process.env.GCLOUD_PROJECT, process.env.GOOGLE_CLOUD_PROJECT, process.env.FIREBASE_PROJECT_ID]
    .map(value => value?.trim()).filter(Boolean);
  if (configuredProjects.some(value => value !== PROJECT_ID || /menareps-crm-production/i.test(value!))) {
    throw new Error("PHASE5B_PRODUCTION_PROJECT_FORBIDDEN");
  }
  if (process.env.FIREBASE_CONFIG && /menareps-crm-production/i.test(process.env.FIREBASE_CONFIG)) {
    throw new Error("PHASE5B_PRODUCTION_CONFIG_FORBIDDEN");
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.FIREBASE_TOKEN) {
    throw new Error("PHASE5B_PRODUCTION_CREDENTIALS_FORBIDDEN");
  }
}

assertIsolation();
Object.assign(process.env, {
  OFFER_RUNTIME_MAX_ACTIVE_DOCUMENTS: "250",
  OFFER_RUNTIME_MAX_AUDIENCE_LOOKUPS: "3000",
  GCLOUD_PROJECT: PROJECT_ID,
  GOOGLE_CLOUD_PROJECT: PROJECT_ID,
  FIREBASE_PROJECT_ID: PROJECT_ID,
  FIRESTORE_DATABASE_ID: "(default)",
  FIREBASE_CONFIG: JSON.stringify({ projectId: PROJECT_ID }),
});

const { executePharmacyVisitCompletion, PharmacyVisitCompletionError } = await import("./pharmacyVisitCompletionService");
const { executeCommercialOrderTransition } = await import("./commercialOrderTransitionService");

const app = getApps().find(candidate => candidate.name === "phase5b-transaction-certification")
  ?? initializeApp({ projectId: PROJECT_ID }, "phase5b-transaction-certification");
const db = getFirestore(app);

function assert(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}

async function reset(): Promise<void> {
  for (const collection of await db.listCollections()) await db.recursiveDelete(collection);
}

const product = (stockQuantity: number) => ({
  id: "P1", name: "Synthetic Phase 5B Product", code: "P1", sku: "P1", promotionGroupId: "PG1",
  marketId: "LY", productType: "Commercial", active: true, status: "Active", price: 7, stockQuantity,
});

const offer = (): CanonicalOfferDefinition => ({
  id: "OFFER-BUY-5-GET-1", schemaVersion: 1, offerVersion: 1, revision: 1,
  code: "P5A-BUY", name: "Synthetic Buy Five Get One", type: "BUY_X_GET_Y", lifecycleStatus: "ACTIVE",
  productScope: { mode: "SELECTED_PRODUCTS", productIds: ["P1"] },
  benefit: {
    kind: "BUY_X_GET_Y", buyQuantity: 5, freeQuantity: 1, reward: { mode: "SAME_AS_TRIGGER" },
    aggregationMode: "PER_PRODUCT", multiples: "REPEAT_COMPLETE_MULTIPLES", remainder: "NO_REWARD_BELOW_THRESHOLD",
  },
  eligibility: {
    audienceType: "ALL_SALES_REPRESENTATIVES",
    startAt: "2029-01-01T00:00:00.000Z", endAt: "2031-12-31T23:59:59.999Z",
  },
  stackingPolicy: {
    mode: "NO_STACKING", priority: 1, maximumProductOrQuantityOffersPerPaidLine: 1,
    maximumInvoicePercentageOffersPerInvoice: 1,
  },
  createdAt: "2029-01-01T00:00:00.000Z", createdBy: "phase5b-admin",
  updatedAt: "2029-01-01T00:00:00.000Z", updatedBy: "phase5b-admin",
  submittedAt: "2029-01-01T00:00:00.000Z", submittedBy: "phase5b-manager",
  approvedAt: "2029-01-01T01:00:00.000Z", approvedBy: "phase5b-admin",
  activatedAt: "2029-01-01T02:00:00.000Z", activatedBy: "phase5b-admin",
});

function scopeRepository(uid = ACTOR_UID, role = "Sales Representative"): OperationalScopeRepository {
  const actor = { id: uid, role, active: true, status: "Active", loginAllowed: true };
  return {
    hierarchy: {
      async getUser(candidateUid) { return candidateUid === uid ? actor : null; },
      async getDirectReports() { return []; },
      async getAllUsers() { return [actor]; },
      async getRolePermissions() { return { viewTeamData: false }; },
      async getAccessGovernance() { return null; },
    },
    async getGeographyCatalog() {
      return {
        countries: [{ id: "LY", active: true }],
        districts: [{ id: "WEST", countryId: "LY", active: true }],
        cities: [{ id: "TRIPOLI", countryId: "LY", districtId: "WEST", active: true }],
        areas: [{ id: "WEST-A1", countryId: "LY", districtId: "WEST", cityId: "TRIPOLI", active: true }],
        nodes: [{ countryId: "LY", regionId: "WEST", districtId: "WEST", cityId: "TRIPOLI", areaId: "WEST-A1", active: true }],
      };
    },
    async getTerritoryAssignments() {
      return [{ assignmentId: `TA-${uid}`, userId: uid, status: "Active", active: true, countryId: "LY", regionId: "WEST", districtId: "WEST", cityId: "TRIPOLI", areaId: "WEST-A1" }];
    },
    async getProductAssignments() {
      return [{ id: `PA-${uid}`, assignmentId: `PA-${uid}`, userId: uid, productId: "P1", productGroupId: "PG1", status: "Active", active: true }] as any;
    },
    async getProducts() {
      const snapshot = await db.collection("products").doc("P1").get();
      return snapshot.exists ? [{ ...snapshot.data(), id: snapshot.id } as any] : [];
    },
  };
}

async function seed(stockQuantity: number): Promise<void> {
  await reset();
  const records: Array<[string, string, Record<string, unknown>]> = [
    ["users", ACTOR_UID, { id: ACTOR_UID, role: "Sales Representative", active: true, status: "Active", loginAllowed: true }],
    ["rolePermissions", "Sales Representative", { role: "Sales Representative", active: true, view: true, create: true, offerCapabilities: { "offers.applyDuringVisit": true } }],
    ["countries", "LY", { id: "LY", active: true }],
    ["districts", "WEST", { id: "WEST", countryId: "LY", active: true }],
    ["cities", "TRIPOLI", { id: "TRIPOLI", countryId: "LY", districtId: "WEST", active: true }],
    ["areas", "WEST-A1", { id: "WEST-A1", countryId: "LY", districtId: "WEST", cityId: "TRIPOLI", active: true }],
    ["products", "P1", product(stockQuantity)],
    ["pharmacies", "PHARM-PHASE5B", { id: "PHARM-PHASE5B", name: "Synthetic Phase 5B Pharmacy", type: "Retail", companyId: "SYNTHETIC", active: true, status: "Active", areaId: "WEST-A1", outstandingBalance: 0 }],
    ["marketSettings", "LY", { marketId: "LY", countryId: "LY", countryNameEn: "Synthetic Market", countryNameAr: "Synthetic", active: true, businessDocumentCode: "UT", currencyCode: "TST", currencySymbol: "T", symbolPosition: "before", decimalPlaces: 2, roundingMode: "DECIMAL_HALF_UP", numeralLocale: "en", timezone: "Africa/Tripoli", dateFormat: "YYYY-MM-DD", timeFormat: "24h", weekStartDay: 1, workingWeekdays: [1, 2, 3, 4, 5], normalWorkdayStart: "08:00", normalWorkdayEnd: "16:00", checkInOpensAt: "07:30", lateToleranceMinutes: 15, autoCheckoutAt: "18:00", maximumWorkdayMinutes: 600 }],
    ["orderWorkflowTemplates", "ENTERPRISE_V1", { ...ENTERPRISE_WORKFLOW_TEMPLATE, createdBy: "PHASE5B", updatedBy: "PHASE5B" }],
    ["offers", "OFFER-BUY-5-GET-1", offer() as unknown as Record<string, unknown>],
    ["users", "phase5b-finance", { id: "phase5b-finance", name: "Finance", role: "Finance Officer", active: true, status: "Active", loginAllowed: true }],
    ["users", "phase5b-store", { id: "phase5b-store", name: "Store", role: "Store Manager", active: true, status: "Active", loginAllowed: true }],
    ["users", "phase5b-delivery", { id: "phase5b-delivery", name: "Delivery", role: "Delivery Officer", active: true, status: "Active", loginAllowed: true }],
  ];
  for (const [collection, id, data] of records) await db.collection(collection).doc(id).set(data);
}

function draft(draftId: string, tampered = false): PharmacyVisitDraft {
  const selectedOffer = offer();
  const paidLines = [{ lineId: "LINE-P1", productId: "P1", quantity: 10, unitPrice: 7 }];
  const inputFingerprint = offerInputFingerprint({
    currencyCode: "TST", decimalPlaces: 2, roundingMode: "DECIMAL_HALF_UP", paidLines, selectedOffers: [selectedOffer],
  });
  return {
    schemaVersion: "2.0", draftId, repUid: ACTOR_UID, companyId: "FORGED", countryId: "FORGED", areaId: "WEST-A1",
    pharmacyId: "PHARM-PHASE5B", pharmacySnapshot: { id: "PHARM-PHASE5B", nameEn: "Forged", type: "Forged", areaId: "FORGED", outstandingBalance: 999 },
    entrySource: "PHARMACY_LIST", status: "REVIEW_READY", currentStep: 6,
    visitPurpose: { code: "REGULAR_COMMERCIAL_VISIT", labelEn: "Regular", labelAr: "Regular" },
    order: {
      lines: [{ id: "LINE-P1", canonicalProductId: "P1", productCode: "FORGED", productNameSnapshot: "Forged", quantity: 10, unitPricePreview: tampered ? 0 : 7, lineTotalPreview: tampered ? 0 : 70, currency: "FORGED", inputSource: "MANUAL", userConfirmed: true, userCorrected: false, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), ...(tampered ? { stockQuantity: 999999, freeQuantity: 999999, rewardProductId: "FORGED" } : {}) } as any],
      subtotalPreview: tampered ? 0 : 70, currency: "FORGED", updatedAt: NOW.toISOString(),
    },
    offers: tampered ? ({ offerDefinition: { id: "FORGED", lifecycleStatus: "ACTIVE" }, calculatedDiscount: 999999, calculatedTotals: { net: 0 }, freeQuantity: 999999 } as any) : undefined,
    offerIntent: [{ offerId: selectedOffer.id, offerVersion: selectedOffer.offerVersion, calculationVersion: OFFER_CALCULATION_VERSION, selected: true, confirmed: true, confirmedAt: NOW.toISOString(), inputFingerprint }],
    payment: { paymentEntry: { amount: 1, method: "CASH" }, financialContext: { outstandingBalanceBefore: 999, projectedNetOrder: 0, projectedBalanceAfter: 999 } },
    stock: { requestLines: [] }, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), deviceSessionId: "PHASE5B", localRevision: 1,
  } as unknown as PharmacyVisitDraft;
}

async function complete(draftId: string, tampered = false, paymentAmount = 1, paymentMethod = "CASH") {
  const value = draft(draftId, tampered);
  value.payment!.paymentEntry = { amount: paymentAmount, method: paymentMethod } as any;
  return executePharmacyVisitCompletion(ACTOR_UID, { draft: value }, { db, operationalScopeRepository: scopeRepository(), now: () => NOW });
}

async function transition(orderId: string, actorUid: string, role: string, action: string, comments = "Certified Phase 5B action", metadata?: Record<string, unknown>) {
  const order = (await db.collection("orders").doc(orderId).get()).data()!;
  return executeCommercialOrderTransition(actorUid, { orderId, action, comments, expectedVersion: String(order.updatedAt), ...(metadata ? { metadata } : {}) }, { db, operationalScopeRepository: scopeRepository(actorUid, role), now: () => NOW });
}

const countedCollections = ["pharmacyVisits", "orders", "inventoryReservations", "businessDocumentSequences", "auditLogs", "payments", "stockRequests", "promotionalFreeGoodsShortages"] as const;
async function counts(): Promise<Record<string, number>> {
  return Object.fromEntries(await Promise.all(countedCollections.map(async collection => [collection, (await db.collection(collection).get()).size])));
}

async function reportScenario(name: string, before: Record<string, number>, after: Record<string, number>) {
  console.log(`PHASE5B_SCENARIO=${JSON.stringify({ name, before, after })}`);
}

try {
  // A. The real transaction persists the authoritative visit/order snapshot atomically.
  await seed(12);
  let before = await counts();
  const success = await complete("SUCCESS");
  let after = await counts();
  assert(success.success && !success.alreadyCompleted, "PHASE5B_SUCCESS_RESPONSE_INVALID");
  assert(JSON.stringify(after) === JSON.stringify({ pharmacyVisits: 1, orders: 1, inventoryReservations: 1, businessDocumentSequences: 2, auditLogs: 1, payments: 1, stockRequests: 0, promotionalFreeGoodsShortages: 0 }), "PHASE5B_SUCCESS_COUNTS_INVALID");
  const visit = (await db.collection("pharmacyVisits").doc(success.visitId).get()).data()!;
  const order = (await db.collection("orders").doc(success.orderId!).get()).data()!;
  const freeItems = order.items.filter((item: any) => item.lineKind === "PROMOTIONAL_FREE_LINE");
  const reservation = (await db.collection("inventoryReservations").doc(order.reservationIds[0]).get()).data()!;
  assert(visit.status === "COMPLETED" && visit.offerCalculation?.calculationVersion === OFFER_CALCULATION_VERSION, "PHASE5B_VISIT_SNAPSHOT_INVALID");
  assert(order.total === 70 && order.grossTotal === 70 && freeItems.length === 1, "PHASE5B_ORDER_TOTAL_INVALID");
  assert(freeItems[0].price === 0 && freeItems[0].total === 0 && freeItems[0].quantity === 2, "PHASE5B_FREE_LINE_VALUE_INVALID");
  assert(freeItems[0].sourceOfferId === "OFFER-BUY-5-GET-1" && freeItems[0].sourceOfferVersion === 1 && freeItems[0].deterministicFreeLineKey && JSON.stringify(freeItems[0].triggerPaidLineIds) === JSON.stringify(["LINE-P1"]), "PHASE5B_FREE_LINE_TRACE_INVALID");
  assert(order.inventoryContractVersion === 2 && reservation.status === "ACTIVE" && reservation.saleableReservedQuantity === 10 && reservation.promotionalReservedQuantity === 2 && reservation.totalReservedQuantity === 12, "PHASE5B_RESERVATION_INVALID");
  assert((await db.collection("products").doc("P1").get()).data()?.activeReservedQuantity === 12, "PHASE5B_ACTIVE_RESERVED_INVALID");
  await reportScenario("SUCCESSFUL_ATOMIC_COMPLETION", before, after);

  // B. Insufficient combined paid/free demand aborts every completion-side write.
  await seed(11);
  await db.collection("pharmacyVisitDrafts").doc("ROLLBACK").set({ id: "ROLLBACK", status: "DRAFT", marker: "RECOVERABLE" });
  before = await counts();
  let rollbackCode = "";
  try { await complete("ROLLBACK"); } catch (error) { rollbackCode = error instanceof PharmacyVisitCompletionError ? error.code : String(error); }
  after = await counts();
  assert(rollbackCode === "PHARMACY_VISIT_OFFER_REWARD_STOCK_INSUFFICIENT", "PHASE5B_ROLLBACK_CODE_INVALID");
  assert(JSON.stringify(after) === JSON.stringify(before), "PHASE5B_ROLLBACK_PARTIAL_WRITES");
  assert((await db.collection("pharmacyVisitDrafts").doc("ROLLBACK").get()).data()?.marker === "RECOVERABLE", "PHASE5B_DRAFT_NOT_RECOVERABLE");
  assert((await db.collection("pharmacies").doc("PHARM-PHASE5B").get()).data()?.outstandingBalance === 0, "PHASE5B_ROLLBACK_PHARMACY_MUTATED");
  await reportScenario("INSUFFICIENT_PROMOTIONAL_STOCK_ROLLBACK", before, after);

  // C. The same visit identity returns the committed result without duplicate effects.
  await seed(12);
  before = await counts();
  const first = await complete("IDEMPOTENT");
  const afterFirst = await counts();
  const second = await complete("IDEMPOTENT");
  after = await counts();
  assert(!first.alreadyCompleted && second.alreadyCompleted && first.orderId === second.orderId && first.displayNumber === second.displayNumber, "PHASE5B_IDEMPOTENT_RESPONSE_INVALID");
  assert(JSON.stringify(after) === JSON.stringify(afterFirst), "PHASE5B_IDEMPOTENT_DUPLICATE_EFFECT");
  await reportScenario("REPEATED_REQUEST_IDEMPOTENCY", before, after);

  // E. Browser-derived authority fields cannot replace server products, Offers, totals or time.
  await seed(12);
  before = await counts();
  let tamperedError: unknown;
  try { await complete("TAMPERED", true); } catch (error) { tamperedError = error; }
  assert(tamperedError instanceof PharmacyVisitCompletionError
    && tamperedError.status === 409
    && tamperedError.code === "PHARMACY_VISIT_PRODUCT_PRICE_CHANGED", "PHASE5B_TAMPERED_PRICE_NOT_REJECTED");
  after = await counts();
  assert(JSON.stringify(after) === JSON.stringify(before), "PHASE5B_TAMPERED_PRICE_PARTIAL_PERSISTENCE");
  await reportScenario("CLIENT_PRICE_TAMPERING_REJECTED", before, after);

  // D. Two distinct real transactions contend on the same canonical Product reservation balance.
  await seed(12);
  before = await counts();
  const concurrent = await Promise.allSettled([complete("CONCURRENT-A"), complete("CONCURRENT-B")]);
  after = await counts();
  const succeeded = concurrent.filter(result => result.status === "fulfilled").length;
  const failures = concurrent.filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map(result => result.reason instanceof PharmacyVisitCompletionError ? result.reason.code : String(result.reason));
  const concurrentProduct = (await db.collection("products").doc("P1").get()).data()!;
  console.log(`PHASE5B_CONCURRENCY=${JSON.stringify({ succeeded, failures, before, after, productStockQuantity: concurrentProduct.stockQuantity, activeReservedQuantity: concurrentProduct.activeReservedQuantity })}`);
  assert(succeeded === 1 && failures.length === 1 && failures[0] === "PHARMACY_VISIT_OFFER_REWARD_STOCK_INSUFFICIENT", "PHASE5B_CONCURRENCY_UNEXPECTED_RESULT");
  assert(after.pharmacyVisits === 1 && after.orders === 1 && after.inventoryReservations === 1 && concurrentProduct.stockQuantity === 12 && concurrentProduct.activeReservedQuantity === 12, "PHASE5B_CONCURRENCY_BALANCE_INVALID");
  console.log("PROMOTIONAL_STOCK_CONCURRENCY=PASS");

  // Cash, zero-payment credit, and partially paid credit all reserve the same physical invoice independently of payment.
  for (const payment of [{ name: "CASH", amount: 70, method: "CASH" }, { name: "CREDIT_ZERO", amount: 0, method: "CREDIT" }, { name: "CREDIT_PARTIAL", amount: 25, method: "CREDIT" }]) {
    await seed(12);
    const result = await complete(payment.name, false, payment.amount, payment.method);
    const paymentOrder = (await db.collection("orders").doc(result.orderId!).get()).data()!;
    const paymentProduct = (await db.collection("products").doc("P1").get()).data()!;
    assert(paymentOrder.inventoryContractVersion === 2 && paymentProduct.activeReservedQuantity === 12 && paymentProduct.stockQuantity === 12, `PHASE5B_${payment.name}_RESERVATION_INVALID`);
    assert(paymentOrder.total === 70 && paymentOrder.totalPromotionalFreeQuantity === 2, `PHASE5B_${payment.name}_FINANCE_INVALID`);
    console.log(`PHASE5B_PAYMENT=${JSON.stringify({ name: payment.name, collected: payment.amount, invoiceTotal: paymentOrder.total, activeReservedQuantity: paymentProduct.activeReservedQuantity })}`);
  }

  // Finance approval and nonterminal review return retain the complete reservation.
  await seed(12);
  let lifecycle = await complete("FINANCE-RETAIN");
  let outcome = await transition(lifecycle.orderId!, "phase5b-finance", "Finance Officer", "FINANCE_APPROVE");
  assert(outcome.success && (await db.collection("products").doc("P1").get()).data()?.activeReservedQuantity === 12, "PHASE5B_FINANCE_APPROVAL_CHANGED_RESERVATION");
  await seed(12);
  lifecycle = await complete("FINANCE-RETURN");
  outcome = await transition(lifecycle.orderId!, "phase5b-finance", "Finance Officer", "FINANCE_RETURN");
  assert(outcome.success && (await db.collection("products").doc("P1").get()).data()?.activeReservedQuantity === 12, "PHASE5B_FINANCE_RETURN_CHANGED_RESERVATION");

  // Final Finance rejection releases exactly once without changing physical stock.
  await seed(12);
  lifecycle = await complete("FINANCE-REJECT");
  outcome = await transition(lifecycle.orderId!, "phase5b-finance", "Finance Officer", "FINANCE_REJECT");
  let lifecycleProduct = (await db.collection("products").doc("P1").get()).data()!;
  let lifecycleReservation = (await db.collection("inventoryReservations").get()).docs[0].data();
  assert(outcome.success && lifecycleReservation.status === "RELEASED" && lifecycleProduct.activeReservedQuantity === 0 && lifecycleProduct.stockQuantity === 12, "PHASE5B_FINANCE_RELEASE_INVALID");
  const repeatedReject = await transition(lifecycle.orderId!, "phase5b-finance", "Finance Officer", "FINANCE_REJECT");
  lifecycleProduct = (await db.collection("products").doc("P1").get()).data()!;
  assert(!repeatedReject.success && lifecycleProduct.activeReservedQuantity === 0 && lifecycleProduct.stockQuantity === 12, "PHASE5B_REPEATED_RELEASE_EFFECT");

  // Delivery Start is the unique complete physical issue; completion and partial delivery have no inventory effect.
  await seed(12);
  lifecycle = await complete("DELIVERY-INTEGRITY");
  await db.collection("orders").doc(lifecycle.orderId!).update({ inventoryContractVersion: null, status: "ASSIGNED_FOR_DELIVERY", stage: "DELIVERY", deliveryOfficerUid: "phase5b-delivery", updatedAt: "AMBIGUOUS-V1" });
  const integrityRejected = await transition(lifecycle.orderId!, "phase5b-delivery", "Delivery Officer", "DELIVERY_COMPLETE", "Synthetic ambiguous completion", { recipientName: "Synthetic Recipient" });
  lifecycleProduct = (await db.collection("products").doc("P1").get()).data()!;
  lifecycleReservation = (await db.collection("inventoryReservations").get()).docs[0].data();
  const integrityOrder = (await db.collection("orders").doc(lifecycle.orderId!).get()).data()!;
  assert(!integrityRejected.success && integrityRejected.code === "INVENTORY_CONTRACT_INTEGRITY_ERROR"
    && integrityOrder.status === "ASSIGNED_FOR_DELIVERY" && lifecycleReservation.status === "ACTIVE"
    && lifecycleProduct.stockQuantity === 12 && lifecycleProduct.activeReservedQuantity === 12,
  "PHASE5C_INTEGRITY_REJECTION_MUTATED_STATE");

  await seed(12);
  lifecycle = await complete("DELIVERY-ACTIVE-RESERVATION");
  await db.collection("orders").doc(lifecycle.orderId!).update({ status: "OUT_FOR_DELIVERY", stage: "DELIVERY", deliveryOfficerUid: "phase5b-delivery", updatedAt: "OUT-WITH-ACTIVE-V1" });
  const activeReservationRejected = await transition(lifecycle.orderId!, "phase5b-delivery", "Delivery Officer", "DELIVERY_COMPLETE", "Synthetic completion with active reservation", { recipientName: "Synthetic Recipient" });
  lifecycleProduct = (await db.collection("products").doc("P1").get()).data()!;
  lifecycleReservation = (await db.collection("inventoryReservations").get()).docs[0].data();
  const activeReservationOrder = (await db.collection("orders").doc(lifecycle.orderId!).get()).data()!;
  assert(!activeReservationRejected.success && activeReservationRejected.code === "VERSION2_DELIVERY_RESERVATION_NOT_CONSUMED"
    && activeReservationOrder.status === "OUT_FOR_DELIVERY" && lifecycleReservation.status === "ACTIVE"
    && lifecycleProduct.stockQuantity === 12 && lifecycleProduct.activeReservedQuantity === 12,
  "PHASE5C_ACTIVE_RESERVATION_REJECTION_MUTATED_STATE");

  await seed(12);
  lifecycle = await complete("DELIVERY-COMPLETE");
  await db.collection("orders").doc(lifecycle.orderId!).update({ inventoryContractVersion: " 2 ", status: "ASSIGNED_FOR_DELIVERY", stage: "DELIVERY", deliveryOfficerUid: "phase5b-delivery", updatedAt: "ASSIGNED-V1" });
  const completionBeforeStart = await transition(lifecycle.orderId!, "phase5b-delivery", "Delivery Officer", "DELIVERY_COMPLETE", "Synthetic premature completion", { recipientName: "Synthetic Recipient" });
  lifecycleProduct = (await db.collection("products").doc("P1").get()).data()!;
  lifecycleReservation = (await db.collection("inventoryReservations").get()).docs[0].data();
  assert(!completionBeforeStart.success && completionBeforeStart.code === "VERSION2_DELIVERY_START_REQUIRED"
    && lifecycleReservation.status === "ACTIVE" && lifecycleProduct.stockQuantity === 12 && lifecycleProduct.activeReservedQuantity === 12,
  "PHASE5B_PREMATURE_COMPLETION_MUTATED_INVENTORY");
  outcome = await transition(lifecycle.orderId!, "phase5b-delivery", "Delivery Officer", "DELIVERY_START");
  lifecycleProduct = (await db.collection("products").doc("P1").get()).data()!;
  lifecycleReservation = (await db.collection("inventoryReservations").get()).docs[0].data();
  assert(outcome.success && lifecycleReservation.status === "CONSUMED" && lifecycleProduct.stockQuantity === 0 && lifecycleProduct.activeReservedQuantity === 0, "PHASE5B_DELIVERY_START_CONSUMPTION_INVALID");
  const repeatedStart = await transition(lifecycle.orderId!, "phase5b-delivery", "Delivery Officer", "DELIVERY_START");
  assert(!repeatedStart.success && (await db.collection("products").doc("P1").get()).data()?.stockQuantity === 0, "PHASE5B_REPEATED_CONSUMPTION_EFFECT");
  const partial = await transition(lifecycle.orderId!, "phase5b-delivery", "Delivery Officer", "DELIVERY_PARTIAL");
  assert(!partial.success && partial.code === "VERSION2_PARTIAL_DELIVERY_PROHIBITED", "PHASE5B_PARTIAL_DELIVERY_NOT_REJECTED");
  outcome = await transition(lifecycle.orderId!, "phase5b-delivery", "Delivery Officer", "DELIVERY_COMPLETE", "Complete delivery", { recipientName: "Synthetic Pharmacy" });
  assert(outcome.success && (await db.collection("products").doc("P1").get()).data()?.stockQuantity === 0, "PHASE5B_COMPLETE_DELIVERY_STOCK_CHANGED");

  // Failure retains issued stock; confirmed complete return restores saleable and promotional goods exactly once.
  await seed(12);
  lifecycle = await complete("DELIVERY-RETURN");
  await db.collection("orders").doc(lifecycle.orderId!).update({ status: "ASSIGNED_FOR_DELIVERY", stage: "DELIVERY", deliveryOfficerUid: "phase5b-delivery", updatedAt: "ASSIGNED-V1" });
  assert((await transition(lifecycle.orderId!, "phase5b-delivery", "Delivery Officer", "DELIVERY_START")).success, "PHASE5B_RETURN_START_FAILED");
  assert((await transition(lifecycle.orderId!, "phase5b-delivery", "Delivery Officer", "DELIVERY_FAIL")).success, "PHASE5B_DELIVERY_FAILURE_FAILED");
  assert((await db.collection("products").doc("P1").get()).data()?.stockQuantity === 0, "PHASE5B_FAILURE_RESTORED_STOCK");
  const partialReturn = await transition(lifecycle.orderId!, "phase5b-delivery", "Delivery Officer", "DELIVERY_RETURN", "Partial forged return", { quantity: 1 });
  assert(!partialReturn.success && partialReturn.code === "VERSION2_PARTIAL_RETURN_PROHIBITED", "PHASE5B_PARTIAL_RETURN_NOT_REJECTED");
  outcome = await transition(lifecycle.orderId!, "phase5b-delivery", "Delivery Officer", "DELIVERY_RETURN", "Complete return");
  lifecycleProduct = (await db.collection("products").doc("P1").get()).data()!;
  assert(outcome.success && lifecycleProduct.stockQuantity === 12 && lifecycleProduct.activeReservedQuantity === 0 && (await db.collection("inventoryReturnEvents").get()).size === 1, "PHASE5B_COMPLETE_RETURN_INVALID");
  const repeatedReturn = await transition(lifecycle.orderId!, "phase5b-delivery", "Delivery Officer", "DELIVERY_RETURN", "Repeated return");
  assert(!repeatedReturn.success && (await db.collection("products").doc("P1").get()).data()?.stockQuantity === 12 && (await db.collection("inventoryReturnEvents").get()).size === 1, "PHASE5B_REPEATED_RETURN_EFFECT");

  // Explicit complete-invoice customer refusal: issued goods remain out until one confirmed full return.
  await seed(12);
  lifecycle = await complete("DELIVERY-REFUSE");
  lifecycleProduct = (await db.collection("products").doc("P1").get()).data()!;
  lifecycleReservation = (await db.collection("inventoryReservations").get()).docs[0].data();
  assert(lifecycleProduct.stockQuantity === 12 && lifecycleProduct.activeReservedQuantity === 12 && lifecycleReservation.status === "ACTIVE"
    && lifecycleReservation.saleableReservedQuantity === 10 && lifecycleReservation.promotionalReservedQuantity === 2 && lifecycleReservation.totalReservedQuantity === 12,
  "PHASE5B_REFUSAL_COMPLETION_INVALID");
  await db.collection("orders").doc(lifecycle.orderId!).update({ status: "ASSIGNED_FOR_DELIVERY", stage: "DELIVERY", deliveryOfficerUid: "phase5b-delivery", updatedAt: "ASSIGNED-REFUSAL-V1" });
  assert((await transition(lifecycle.orderId!, "phase5b-delivery", "Delivery Officer", "DELIVERY_START")).success, "PHASE5B_REFUSAL_START_FAILED");
  lifecycleProduct = (await db.collection("products").doc("P1").get()).data()!;
  lifecycleReservation = (await db.collection("inventoryReservations").get()).docs[0].data();
  assert(lifecycleProduct.stockQuantity === 0 && lifecycleProduct.activeReservedQuantity === 0 && lifecycleReservation.status === "CONSUMED", "PHASE5B_REFUSAL_START_INVENTORY_INVALID");
  outcome = await transition(lifecycle.orderId!, "phase5b-delivery", "Delivery Officer", "DELIVERY_REFUSE", "Complete invoice refused");
  const refusedOrder = (await db.collection("orders").doc(lifecycle.orderId!).get()).data()!;
  lifecycleProduct = (await db.collection("products").doc("P1").get()).data()!;
  lifecycleReservation = (await db.collection("inventoryReservations").get()).docs[0].data();
  assert(outcome.success && refusedOrder.status === "CUSTOMER_REFUSED" && lifecycleProduct.stockQuantity === 0 && lifecycleProduct.activeReservedQuantity === 0
    && lifecycleReservation.status === "CONSUMED" && (await db.collection("inventoryReturnEvents").get()).empty
    && (await db.collection("stockRequests").get()).empty && (await db.collection("promotionalFreeGoodsShortages").get()).empty
    && refusedOrder.status !== "PARTIALLY_DELIVERED", "PHASE5B_REFUSAL_RETENTION_INVALID");
  outcome = await transition(lifecycle.orderId!, "phase5b-delivery", "Delivery Officer", "DELIVERY_RETURN", "Confirmed complete refusal return");
  const returnedOrder = (await db.collection("orders").doc(lifecycle.orderId!).get()).data()!;
  lifecycleProduct = (await db.collection("products").doc("P1").get()).data()!;
  lifecycleReservation = (await db.collection("inventoryReservations").get()).docs[0].data();
  const refusalReturnEvents = await db.collection("inventoryReturnEvents").get();
  assert(outcome.success && returnedOrder.status === "RETURNED_TO_STORE" && lifecycleProduct.stockQuantity === 12 && lifecycleProduct.activeReservedQuantity === 0
    && lifecycleReservation.status === "CONSUMED" && refusalReturnEvents.size === 1
    && refusalReturnEvents.docs[0].id === `RETURN_${lifecycleReservation.reservationId}`,
  "PHASE5B_REFUSAL_COMPLETE_RETURN_INVALID");
  const repeatedRefusalReturn = await transition(lifecycle.orderId!, "phase5b-delivery", "Delivery Officer", "DELIVERY_RETURN", "Repeated refusal return");
  assert(!repeatedRefusalReturn.success && (await db.collection("products").doc("P1").get()).data()?.stockQuantity === 12
    && (await db.collection("inventoryReturnEvents").get()).size === 1, "PHASE5B_REFUSAL_REPEATED_RETURN_EFFECT");
  console.log("PHASE5B_DELIVERY_REFUSE_LIFECYCLE=PASS");
  console.log("PHASE5B_COMPLETE_INVOICE_LIFECYCLE=PASS");
  console.log("PHASE5B_TRANSACTION_HARNESS=PASS");
} finally {
  await deleteApp(app);
}
