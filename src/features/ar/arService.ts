/**
 * WP-FI-1.1 Enterprise Financial Intelligence & Collections - Service & Persistence Layer
 * FINANCIAL DATA IS FOR COLLECTION AND REPORTING ONLY. IT NEVER BLOCKS OR CANCELS ORDERS.
 */

import { doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs, writeBatch } from "firebase/firestore";
import { db } from "../../lib/firebase";
import {
  CustomerFinancialProfile, 
  CustomerLedgerEntry, 
  PaymentTermCode, 
  ArBootstrapReport,
  LedgerTransactionType
} from "./arTypes";
import { 
  generateCustomerAccountNumber, 
  calculateDueDate, 
  calculateBalances, 
  calculateRunningBalances, 
  validateLedgerEntry,
  getPaymentTermDays
} from "./arResolvers";
import { assertSingleCurrency, requireFinancialIdentity } from "../../lib/financialIdentity";
import { validateMarketSettings, type MarketBusinessSettings } from "../../lib/marketSettings";

async function loadCanonicalMarketSettings(): Promise<MarketBusinessSettings[]> {
  const snapshot = await getDocs(query(collection(db, "marketSettings"), where("active", "==", true)));
  const markets = snapshot.docs.map(item => ({ marketId: item.id, ...item.data() } as MarketBusinessSettings));
  if (!markets.length || markets.some(market => validateMarketSettings(market).length > 0)) throw new Error("MARKET_CONFIGURATION_REQUIRED");
  return markets;
}

/**
 * Retrieves an existing Customer Financial Profile or initializes a canonical default profile
 */
export async function getOrCreateCustomerProfile(
  pharmacyId: string,
  actorUid: string = "system",
  actorName: string = "System Engine"
): Promise<CustomerFinancialProfile> {
  if (!pharmacyId) {
    throw new Error("pharmacyId is required to fetch or create a customer financial profile.");
  }

  const profileRef = doc(db, "customerFinancialProfiles", pharmacyId);
  const profileSnap = await getDoc(profileRef);
  const markets = await loadCanonicalMarketSettings();

  if (profileSnap.exists()) {
    const rawData = profileSnap.data();
    const identity = requireFinancialIdentity([rawData], markets);
    return {
      pharmacyId,
      pharmacyName: rawData.pharmacyName || "Pharmacy " + pharmacyId.slice(-4),
      customerAccountNumber: rawData.customerAccountNumber || generateCustomerAccountNumber({ ...rawData, id: pharmacyId }, markets),
      currency: identity.currencyCode,
      currencyCode: identity.currencyCode,
      marketId: identity.marketId,
      paymentTermCode: rawData.paymentTermCode || "CASH",
      paymentTermDays: rawData.paymentTermDays ?? 0,
      openingBalance: rawData.openingBalance || 0,
      outstandingBalance: rawData.outstandingBalance || 0,
      overdueBalance: rawData.overdueBalance || 0,
      totalInvoiced: rawData.totalInvoiced || 0,
      totalCollected: rawData.totalCollected || 0,
      openInvoiceCount: rawData.openInvoiceCount || 0,
      paidInvoiceCount: rawData.paidInvoiceCount || 0,
      oldestOpenInvoiceDate: rawData.oldestOpenInvoiceDate || null,
      averagePaymentDays: rawData.averagePaymentDays || null,
      collectionRate: rawData.collectionRate || null,
      lastInvoiceDate: rawData.lastInvoiceDate || null,
      lastPaymentDate: rawData.lastPaymentDate || null,
      lastLedgerActivityAt: rawData.lastLedgerActivityAt || null,
      financeNotes: rawData.financeNotes || "",
      active: rawData.active !== undefined ? rawData.active : true,
      createdAt: rawData.createdAt || new Date().toISOString(),
      createdByUid: rawData.createdByUid || actorUid,
      updatedAt: rawData.updatedAt || new Date().toISOString(),
      updatedByUid: rawData.updatedByUid || actorUid,

      countryId: identity.countryId,
      regionId: rawData.regionId || "",
      districtId: rawData.districtId || "",
      cityId: rawData.cityId || "",
      areaId: rawData.areaId || "",
      areaName: rawData.areaName || "",
      country: rawData.country || "",
      city: rawData.city || "",
      area: rawData.area || "",

      // Preserved legacy fields
      creditLimit: rawData.creditLimit || 0,
      creditStatus: rawData.creditStatus || "ACTIVE",
      manualCreditHold: Boolean(rawData.manualCreditHold),
      availableCredit: rawData.availableCredit || 0
    };
  }

  // Retrieve canonical Pharmacy record to copy name & location scoping attributes
  let pharmacyName = "Pharmacy " + pharmacyId.slice(-4);
  let pharmacyData: any = {};

  try {
    const pharmRef = doc(db, "pharmacies", pharmacyId);
    const pharmSnap = await getDoc(pharmRef);
    if (pharmSnap.exists()) {
      pharmacyData = pharmSnap.data();
      pharmacyName = pharmacyData.name || pharmacyData.pharmacyName || pharmacyName;
    }
  } catch (err) {
    console.warn("[FI_SERVICE] Could not fetch pharmacy record for metadata inheritance:", err);
  }

  const customerAccountNumber = generateCustomerAccountNumber({ ...pharmacyData, id: pharmacyId }, markets);
  const now = new Date().toISOString();
  const identity = requireFinancialIdentity([pharmacyData], markets);

  const defaultProfile: CustomerFinancialProfile = {
    pharmacyId,
    pharmacyName,
    customerAccountNumber,
    currency: identity.currencyCode,
    currencyCode: identity.currencyCode,
    marketId: identity.marketId,
    paymentTermCode: "CASH",
    paymentTermDays: 0,
    openingBalance: 0,
    outstandingBalance: 0,
    overdueBalance: 0,
    totalInvoiced: 0,
    totalCollected: 0,
    openInvoiceCount: 0,
    paidInvoiceCount: 0,
    oldestOpenInvoiceDate: null,
    averagePaymentDays: null,
    collectionRate: null,
    lastInvoiceDate: null,
    lastPaymentDate: null,
    lastLedgerActivityAt: null,
    financeNotes: "",
    active: true,
    createdAt: now,
    createdByUid: actorUid,
    updatedAt: now,
    updatedByUid: actorUid,

    countryId: identity.countryId,
    regionId: pharmacyData.regionId || pharmacyData.region || "",
    districtId: pharmacyData.districtId || pharmacyData.district || "",
    cityId: pharmacyData.cityId || pharmacyData.city || "",
    areaId: pharmacyData.areaId || pharmacyData.area || "",
    areaName: pharmacyData.areaName || pharmacyData.area || "",
    country: pharmacyData.country || "",
    city: pharmacyData.city || "",
    area: pharmacyData.area || "",

    // Legacy fields preserved for compatibility
    creditLimit: 0,
    creditStatus: "ACTIVE",
    manualCreditHold: false,
    availableCredit: 0
  };

  await setDoc(profileRef, defaultProfile);
  return defaultProfile;
}

/**
 * Recalculates and persists profile balance and analytics summaries from active Firestore ledger entries
 */
export async function recalculateAndPersistProfile(
  pharmacyId: string,
  actorUid: string = "system"
): Promise<CustomerFinancialProfile> {
  const profile = await getOrCreateCustomerProfile(pharmacyId, actorUid);

  // Fetch all ledger entries for pharmacy
  const ledgerQuery = query(
    collection(db, "customerLedgerEntries"),
    where("pharmacyId", "==", pharmacyId)
  );

  const querySnap = await getDocs(ledgerQuery);
  const ledgerEntries: CustomerLedgerEntry[] = [];
  querySnap.forEach(d => ledgerEntries.push(d.data() as CustomerLedgerEntry));
  const ledgerCurrency = assertSingleCurrency(ledgerEntries, entry => entry.currencyCode || entry.currency);
  if (ledgerCurrency && ledgerCurrency !== (profile.currencyCode || profile.currency)) throw new Error("PROFILE_LEDGER_CURRENCY_MISMATCH");

  // Compute analytics and balances
  const summary = calculateBalances(ledgerEntries);

  // Find latest invoice date
  let lastInvoiceDate: string | null = profile.lastInvoiceDate;
  const invoiceEntries = ledgerEntries.filter(e => e.transactionType === "INVOICE" && e.status === "POSTED");
  if (invoiceEntries.length > 0) {
    invoiceEntries.sort((a, b) => (b.postingDate || "").localeCompare(a.postingDate || ""));
    lastInvoiceDate = invoiceEntries[0].postingDate;
  }

  const now = new Date().toISOString();
  const updatedFields: Partial<CustomerFinancialProfile> = {
    outstandingBalance: summary.outstandingBalance,
    overdueBalance: summary.overdueBalance,
    totalInvoiced: summary.totalInvoiced,
    totalCollected: summary.totalCollected,
    openInvoiceCount: summary.openInvoiceCount,
    paidInvoiceCount: summary.paidInvoiceCount,
    oldestOpenInvoiceDate: summary.oldestOpenInvoiceDate,
    averagePaymentDays: summary.averagePaymentDays,
    collectionRate: summary.collectionRate,
    lastInvoiceDate,
    lastLedgerActivityAt: now,
    updatedAt: now,
    updatedByUid: actorUid
  };

  const profileRef = doc(db, "customerFinancialProfiles", pharmacyId);
  await updateDoc(profileRef, updatedFields);

  return {
    ...profile,
    ...updatedFields
  } as CustomerFinancialProfile;
}

/**
 * Bootstrap engine: Initializes missing financial profiles for all active pharmacies
 */
export async function bootstrapAllFinancialProfiles(
  actorUid: string,
  actorName: string
): Promise<ArBootstrapReport> {
  const report: ArBootstrapReport = {
    pharmaciesScanned: 0,
    profilesCreated: 0,
    profilesPreserved: 0,
    profilesFailed: 0,
    details: []
  };

  try {
    const markets = await loadCanonicalMarketSettings();
    const pharmSnap = await getDocs(collection(db, "pharmacies"));
    report.pharmaciesScanned = pharmSnap.size;

    for (const pharmDoc of pharmSnap.docs) {
      const pData = pharmDoc.data();
      const pId = pharmDoc.id;

      try {
        const profileRef = doc(db, "customerFinancialProfiles", pId);
        const pSnap = await getDoc(profileRef);

        if (pSnap.exists()) {
          report.profilesPreserved++;
        } else {
          await getOrCreateCustomerProfile(pId, actorUid, actorName);
          report.profilesCreated++;
          report.details?.push(`Created profile for Pharmacy [${pData.name || pId}] with Account #${generateCustomerAccountNumber(pData, markets)}`);
        }
      } catch (e: any) {
        report.profilesFailed++;
        report.details?.push(`Failed to create profile for Pharmacy [${pId}]: ${e.message}`);
      }
    }
  } catch (err: any) {
    console.error("[FI_BOOTSTRAP_ERROR]", err);
  }

  return report;
}

/**
 * Diagnostics migration runner: Scans profiles for legacy credit fields and reports safely
 */
export async function runArMigrationDiagnostics(): Promise<{
  profilesScanned: number;
  legacyCreditFieldsFound: number;
  legacyFieldsIgnored: number;
  profilesFailed: number;
}> {
  const diag = {
    profilesScanned: 0,
    legacyCreditFieldsFound: 0,
    legacyFieldsIgnored: 0,
    profilesFailed: 0
  };

  try {
    const snap = await getDocs(collection(db, "customerFinancialProfiles"));
    diag.profilesScanned = snap.size;

    snap.forEach(d => {
      const data = d.data();
      if ("creditLimit" in data || "creditStatus" in data || "manualCreditHold" in data) {
        diag.legacyCreditFieldsFound++;
        diag.legacyFieldsIgnored++;
      }
    });
  } catch (e) {
    diag.profilesFailed++;
  }

  console.info("[AR_MIGRATION_DIAGNOSTICS_JSON]", JSON.stringify(diag));
  return diag;
}

/**
 * Updates editable profile fields (Payment terms, Finance notes, Active status)
 */
export async function updateCustomerProfile(
  pharmacyId: string,
  updates: Partial<CustomerFinancialProfile>,
  actorUid: string,
  actorName: string,
  actorRole: string
): Promise<CustomerFinancialProfile> {
  const currentProfile = await getOrCreateCustomerProfile(pharmacyId, actorUid, actorName);

  const allowedPaymentTermCode = updates.paymentTermCode !== undefined ? updates.paymentTermCode : currentProfile.paymentTermCode;
  const allowedPaymentTermDays = updates.paymentTermCode === "CUSTOM"
    ? (updates.paymentTermDays !== undefined ? updates.paymentTermDays : currentProfile.paymentTermDays)
    : getPaymentTermDays(allowedPaymentTermCode);

  const financeNotes = updates.financeNotes !== undefined ? String(updates.financeNotes) : currentProfile.financeNotes;
  const active = updates.active !== undefined ? Boolean(updates.active) : currentProfile.active;

  const now = new Date().toISOString();
  const profileUpdates: Partial<CustomerFinancialProfile> = {
    paymentTermCode: allowedPaymentTermCode,
    paymentTermDays: allowedPaymentTermDays,
    financeNotes,
    active,
    updatedAt: now,
    updatedByUid: actorUid
  };

  const profileRef = doc(db, "customerFinancialProfiles", pharmacyId);
  await updateDoc(profileRef, profileUpdates);

  // Log Audit Event
  try {
    const auditRef = doc(collection(db, "auditLogs"));
    await setDoc(auditRef, {
      id: auditRef.id,
      eventType: "FINANCIAL_PROFILE_UPDATED",
      actorUid,
      actorName,
      actorRole,
      pharmacyId,
      customerAccountNumber: currentProfile.customerAccountNumber,
      updates: {
        paymentTermCode: allowedPaymentTermCode,
        paymentTermDays: allowedPaymentTermDays,
        financeNotes,
        active
      },
      timestamp: now
    });
  } catch (err) {
    console.warn("[FI_AUDIT_LOG_WARNING] Could not write audit log:", err);
  }

  return {
    ...currentProfile,
    ...profileUpdates
  } as CustomerFinancialProfile;
}

/**
 * AUTOMATIC INVOICE LEDGER POSTING ENGINE (WP-FI-1.1 Part 7)
 * Posts exactly one INVOICE entry with deterministic idempotency upon Commercial Invoice finalization.
 * Does NOT alter order status or block order progression.
 */
export async function postInvoiceLedgerEntry(
  order: any,
  actorUid: string = "system",
  actorName: string = "Order Finalization Engine"
): Promise<{ posted: boolean; entry: CustomerLedgerEntry; message: string }> {
  if (!order) {
    throw new Error("Order record is required for invoice ledger posting.");
  }

  const orderId = String(order.id || order.displayNumber || "");
  const pharmacyId = String(order.pharmacyId || order.pharmacy || "");

  if (!pharmacyId) {
    throw new Error("Cannot post invoice ledger entry: Missing Pharmacy ID.");
  }

  const items = order.items || order.products || [];
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Cannot post invoice ledger entry: Order has no products.");
  }

  const orderTotal = Number(order.grandTotal || order.total || order.subtotal || 0);
  if (orderTotal <= 0) {
    throw new Error("Cannot post invoice ledger entry: Invoice total must be greater than zero.");
  }

  const invoiceNumber = String(
    order.invoiceNumber || 
    order.commercialInvoiceNumber || 
    `INV-${order.displayNumber || orderId}`
  );

  // Deterministic Idempotency Key
  const idempotencyKey = `INVOICE_POSTING_${orderId}_${invoiceNumber}`;
  const safeDocId = `LEDGER_INVOICE_${orderId.replace(/[^a-zA-Z0-9_-]/g, "_")}_${invoiceNumber.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

  // Idempotency Check 1: Check document existence by safeDocId
  const ledgerDocRef = doc(db, "customerLedgerEntries", safeDocId);
  const existingSnap = await getDoc(ledgerDocRef);

  if (existingSnap.exists()) {
    const existingEntry = existingSnap.data() as CustomerLedgerEntry;
    return {
      posted: false,
      entry: existingEntry,
      message: `Idempotency match: Invoice entry [${invoiceNumber}] for Order [${orderId}] already exists.`
    };
  }

  // Idempotency Check 2: Query by idempotencyKey
  const keyQuery = query(
    collection(db, "customerLedgerEntries"),
    where("idempotencyKey", "==", idempotencyKey)
  );
  const keySnap = await getDocs(keyQuery);
  if (!keySnap.empty) {
    const existingEntry = keySnap.docs[0].data() as CustomerLedgerEntry;
    return {
      posted: false,
      entry: existingEntry,
      message: `Idempotency match: Key [${idempotencyKey}] already posted.`
    };
  }

  // Retrieve or create Customer Financial Profile
  const profile = await getOrCreateCustomerProfile(pharmacyId, actorUid, actorName);

  const rawDate = order.invoiceDate || order.commercialInvoiceDate || order.createdAt || new Date().toISOString();
  const postingDate = new Date(rawDate).toISOString().split("T")[0];
  const dueDate = calculateDueDate(postingDate, profile.paymentTermCode, profile.paymentTermDays);

  const now = new Date().toISOString();

  const ledgerEntry: CustomerLedgerEntry = {
    id: safeDocId,
    pharmacyId,
    customerAccountNumber: profile.customerAccountNumber,
    orderId,
    orderNumber: String(order.displayNumber || order.orderNumber || orderId),
    invoiceId: invoiceNumber,
    invoiceNumber,
    transactionType: "INVOICE",
    sourceType: "ORDER",
    sourceId: orderId,
    description: `Commercial Invoice ${invoiceNumber} for Order #${order.displayNumber || orderId}`,
    debitAmount: orderTotal,
    creditAmount: 0,
    netAmount: orderTotal,
    currency: profile.currencyCode || profile.currency,
    currencyCode: profile.currencyCode || profile.currency,
    marketId: profile.marketId,
    postingDate,
    dueDate,
    paymentTermCodeSnapshot: profile.paymentTermCode || undefined,
    paymentTermDaysSnapshot: profile.paymentTermDays || undefined,
    invoiceOriginalAmount: orderTotal,
    invoiceAppliedAmount: 0,
    invoiceOpenAmount: orderTotal,
    status: "POSTED",
    isReversal: false,
    reversesEntryId: null,
    idempotencyKey,
    createdAt: now,
    createdByUid: actorUid,
    createdByName: actorName
  };

  // Validate ledger entry rules
  const valResult = validateLedgerEntry(ledgerEntry);
  if (!valResult.valid) {
    throw new Error(`Ledger posting validation failed: ${valResult.error}`);
  }

  // Write ledger entry to Firestore
  await setDoc(ledgerDocRef, ledgerEntry);

  // Recalculate and update profile balances
  await recalculateAndPersistProfile(pharmacyId, actorUid);

  return {
    posted: true,
    entry: ledgerEntry,
    message: `Successfully posted Commercial Invoice [${invoiceNumber}] to ledger.`
  };
}

/**
 * WP-FI-2.1 DELIVERED INVOICE POSTING SERVICE
 * Posts exactly one INVOICE entry with deterministic idempotency ONLY when an order reaches DELIVERED state.
 * Does NOT alter order status, block order progression, or require credit approvals.
 */
export async function postDeliveredOrderInvoice(
  order: any,
  actorUid: string = "system",
  actorName: string = "Delivery Posting Engine",
  previousStageOrStatus?: string
): Promise<{ posted: boolean; reason?: string; entry?: CustomerLedgerEntry; message: string }> {
  if (!order) {
    throw new Error("Order record is required for delivered invoice posting.");
  }

  const normStatus = String(order.status || "").toUpperCase();
  const normStage = String(order.stage || "").toUpperCase();
  const deliveryOutcome = String(order.deliveryOutcome || order.deliveryStatus || "").toUpperCase();

  const isDelivered = 
    normStatus === "DELIVERED" || 
    normStatus === "DELIVERED" || 
    normStage === "DELIVERED" || 
    deliveryOutcome === "DELIVERED" ||
    (normStage === "CLOSED" && (normStatus === "DELIVERED" || deliveryOutcome === "DELIVERED"));

  if (!isDelivered) {
    return {
      posted: false,
      reason: "NOT_DELIVERED",
      message: `Order [${order.id || order.displayNumber}] is in state '${order.status}' (stage: '${order.stage}'), which is not DELIVERED. Invoice posting skipped.`
    };
  }

  // Canonical trigger check: If previous state was already DELIVERED, prevent duplicate post calls
  if (previousStageOrStatus) {
    const prevNorm = String(previousStageOrStatus).toUpperCase();
    if (prevNorm === "DELIVERED" || prevNorm === "CLOSED") {
      return {
        posted: false,
        reason: "ALREADY_DELIVERED_STAGE",
        message: `Order [${order.id || order.displayNumber}] was already in DELIVERED/CLOSED stage previously.`
      };
    }
  }

  const orderId = String(order.id || order.displayNumber || "");
  const pharmacyId = String(order.pharmacyId || order.pharmacy || "");

  if (!pharmacyId) {
    console.warn("[DELIVERED_INVOICE_POSTING_SKIPPED] Missing pharmacyId for Order:", orderId);
    return {
      posted: false,
      reason: "MISSING_PHARMACY_ID",
      message: `Cannot post delivered invoice: Order [${orderId}] is missing pharmacyId.`
    };
  }

  const invoiceAmount = Number(
    order.grandTotal ?? order.total ?? order.netTotal ?? order.totalAmount ?? order.subtotal ?? 0
  );

  if (invoiceAmount <= 0) {
    console.warn("[DELIVERED_INVOICE_POSTING_SKIPPED] Total <= 0 for Order:", orderId);
    return {
      posted: false,
      reason: "INVALID_AMOUNT",
      message: `Cannot post delivered invoice: Order [${orderId}] invoice amount must be greater than zero.`
    };
  }

  const invoiceNumber = String(
    order.invoiceNumber || 
    order.commercialInvoiceNumber || 
    order.invoiceId || 
    `INV-${order.displayNumber || order.orderNumber || orderId}`
  );

  // Deterministic Idempotency Key & Safe Doc ID
  const idempotencyKey = `DELIVERED_INVOICE_${orderId}_${invoiceNumber}`;
  const safeDocId = `LEDGER_INVOICE_${orderId.replace(/[^a-zA-Z0-9_-]/g, "_")}_${invoiceNumber.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

  // Idempotency Check 1: Check document existence by safeDocId
  const ledgerDocRef = doc(db, "customerLedgerEntries", safeDocId);
  const existingSnap = await getDoc(ledgerDocRef);

  if (existingSnap.exists()) {
    const existingEntry = existingSnap.data() as CustomerLedgerEntry;
    console.info("[DELIVERED_INVOICE_POSTING]", JSON.stringify({
      orderId,
      orderNumber: String(order.displayNumber || order.orderNumber || orderId),
      previousStage: previousStageOrStatus || "",
      newStage: "DELIVERED",
      pharmacyId,
      invoiceNumber,
      invoiceAmount,
      idempotencyKey,
      ledgerEntryCreated: false,
      profileRecalculated: false,
      result: "ALREADY_POSTED"
    }));
    return {
      posted: false,
      reason: "ALREADY_POSTED",
      entry: existingEntry,
      message: `Idempotency match: Delivered invoice [${invoiceNumber}] for Order [${orderId}] already posted to ledger.`
    };
  }

  // Idempotency Check 2: Query by idempotencyKey
  const keyQuery = query(
    collection(db, "customerLedgerEntries"),
    where("idempotencyKey", "==", idempotencyKey)
  );
  const keySnap = await getDocs(keyQuery);
  if (!keySnap.empty) {
    const existingEntry = keySnap.docs[0].data() as CustomerLedgerEntry;
    console.info("[DELIVERED_INVOICE_POSTING]", JSON.stringify({
      orderId,
      orderNumber: String(order.displayNumber || order.orderNumber || orderId),
      previousStage: previousStageOrStatus || "",
      newStage: "DELIVERED",
      pharmacyId,
      invoiceNumber,
      invoiceAmount,
      idempotencyKey,
      ledgerEntryCreated: false,
      profileRecalculated: false,
      result: "ALREADY_POSTED"
    }));
    return {
      posted: false,
      reason: "ALREADY_POSTED",
      entry: existingEntry,
      message: `Idempotency match: Key [${idempotencyKey}] already posted.`
    };
  }

  // Retrieve or create Customer Financial Profile
  const profile = await getOrCreateCustomerProfile(pharmacyId, actorUid, actorName);

  const rawDate = order.deliveredAt || order.commercialInvoiceDate || order.invoiceDate || order.date || order.createdAt || new Date().toISOString();
  const postingDate = new Date(rawDate).toISOString().split("T")[0];
  const dueDate = calculateDueDate(postingDate, profile.paymentTermCode, profile.paymentTermDays);

  const now = new Date().toISOString();

  const ledgerEntry: CustomerLedgerEntry = {
    id: safeDocId,
    pharmacyId,
    customerAccountNumber: profile.customerAccountNumber,
    orderId,
    orderNumber: String(order.displayNumber || order.orderNumber || orderId),
    invoiceId: invoiceNumber,
    invoiceNumber,
    transactionType: "INVOICE",
    sourceType: "DELIVERED_ORDER",
    sourceId: orderId,
    description: `Commercial Invoice ${invoiceNumber} for Delivered Order #${order.displayNumber || orderId}`,
    debitAmount: invoiceAmount,
    creditAmount: 0,
    netAmount: invoiceAmount,
    currency: profile.currencyCode || profile.currency,
    currencyCode: profile.currencyCode || profile.currency,
    marketId: profile.marketId,
    postingDate,
    dueDate,
    paymentTermCodeSnapshot: profile.paymentTermCode || "CASH",
    paymentTermDaysSnapshot: profile.paymentTermDays ?? 0,
    invoiceOriginalAmount: invoiceAmount,
    invoiceAppliedAmount: 0,
    invoiceOpenAmount: invoiceAmount,
    status: "POSTED",
    isReversal: false,
    reversesEntryId: null,
    idempotencyKey,
    createdAt: now,
    createdByUid: actorUid,
    createdByName: actorName
  };

  // Validate ledger entry rules
  const valResult = validateLedgerEntry(ledgerEntry);
  if (!valResult.valid) {
    throw new Error(`Ledger posting validation failed: ${valResult.error}`);
  }

  // Write ledger entry to Firestore
  await setDoc(ledgerDocRef, ledgerEntry);

  // Recalculate and update profile balances
  await recalculateAndPersistProfile(pharmacyId, actorUid);

  console.info("[DELIVERED_INVOICE_POSTING]", JSON.stringify({
    orderId,
    orderNumber: String(order.displayNumber || order.orderNumber || orderId),
    previousStage: previousStageOrStatus || "",
    newStage: "DELIVERED",
    pharmacyId,
    invoiceNumber,
    invoiceAmount,
    idempotencyKey,
    ledgerEntryCreated: true,
    profileRecalculated: true,
    result: "SUCCESS"
  }));

  return {
    posted: true,
    entry: ledgerEntry,
    message: `Successfully posted Commercial Invoice [${invoiceNumber}] to customer ledger.`
  };
}

/**
 * WP-FI-2.1 HISTORICAL BACKFILL & RECONCILIATION ENGINE
 * Safely scans all existing orders in Firestore, filters for Delivered state,
 * and posts missing Commercial Invoices to customer ledger with zero duplication.
 */
export async function reconcileDeliveredInvoices(
  actorUid: string = "system",
  actorName: string = "Finance Reconciliation Engine"
): Promise<{
  deliveredOrdersScanned: number;
  eligibleOrders: number;
  alreadyPosted: number;
  newInvoiceEntriesCreated: number;
  profilesRecalculated: number;
  invalidOrdersSkipped: number;
  failedOrders: number;
  details: string[];
}> {
  const report = {
    deliveredOrdersScanned: 0,
    eligibleOrders: 0,
    alreadyPosted: 0,
    newInvoiceEntriesCreated: 0,
    profilesRecalculated: 0,
    invalidOrdersSkipped: 0,
    failedOrders: 0,
    details: [] as string[]
  };

  try {
    const ordersSnap = await getDocs(collection(db, "orders"));
    report.deliveredOrdersScanned = ordersSnap.size;

    const affectedPharmacies = new Set<string>();

    for (const orderDoc of ordersSnap.docs) {
      const orderData = { id: orderDoc.id, ...orderDoc.data() } as any;

      const normStatus = String(orderData.status || "").toUpperCase();
      const normStage = String(orderData.stage || "").toUpperCase();
      const deliveryOutcome = String(orderData.deliveryOutcome || orderData.deliveryStatus || "").toUpperCase();

      const isDelivered = 
        normStatus === "DELIVERED" || 
        normStatus === "DELIVERED" || 
        normStage === "DELIVERED" || 
        deliveryOutcome === "DELIVERED" ||
        (normStage === "CLOSED" && (normStatus === "DELIVERED" || deliveryOutcome === "DELIVERED"));

      if (!isDelivered) {
        continue;
      }

      report.eligibleOrders++;

      const pharmacyId = String(orderData.pharmacyId || orderData.pharmacy || "");
      const invoiceAmount = Number(
        orderData.grandTotal ?? orderData.total ?? orderData.netTotal ?? orderData.totalAmount ?? orderData.subtotal ?? 0
      );

      if (!pharmacyId || invoiceAmount <= 0) {
        report.invalidOrdersSkipped++;
        report.details.push(`Order [${orderData.id}]: Skipped (${!pharmacyId ? "missing pharmacyId" : "amount <= 0"}).`);
        continue;
      }

      try {
        const postRes = await postDeliveredOrderInvoice(orderData, actorUid, actorName);
        if (postRes.posted) {
          report.newInvoiceEntriesCreated++;
          affectedPharmacies.add(pharmacyId);
          report.details.push(`Order [${orderData.id}]: Created Commercial Invoice entry.`);
        } else if (postRes.reason === "ALREADY_POSTED") {
          report.alreadyPosted++;
        } else {
          report.failedOrders++;
          report.details.push(`Order [${orderData.id}]: ${postRes.message}`);
        }
      } catch (err: any) {
        report.failedOrders++;
        report.details.push(`Order [${orderData.id}]: Error - ${err.message}`);
      }
    }

    // Ensure all affected pharmacy profiles are fresh
    for (const pId of affectedPharmacies) {
      try {
        await recalculateAndPersistProfile(pId, actorUid);
        report.profilesRecalculated++;
      } catch (e: any) {
        console.warn(`[RECONCILE_PROFILE_RECALC_WARN] Failed for ${pId}:`, e);
      }
    }
  } catch (err: any) {
    console.error("[RECONCILE_DELIVERED_INVOICES_ERROR]", err);
  }

  console.info("[DELIVERED_INVOICE_BACKFILL_JSON]", JSON.stringify({
    deliveredOrdersScanned: report.deliveredOrdersScanned,
    eligibleOrders: report.eligibleOrders,
    alreadyPosted: report.alreadyPosted,
    newInvoiceEntriesCreated: report.newInvoiceEntriesCreated,
    profilesRecalculated: report.profilesRecalculated,
    invalidOrdersSkipped: report.invalidOrdersSkipped,
    failedOrders: report.failedOrders
  }));

  return report;
}

/**
 * Posts a manual debit or credit adjustment entry (Finance role only)
 */
export async function postAdjustmentEntry(
  pharmacyId: string,
  transactionType: "ADJUSTMENT_DEBIT" | "ADJUSTMENT_CREDIT",
  amount: number,
  description: string,
  actorUid: string,
  actorName: string
): Promise<CustomerLedgerEntry> {
  if (amount <= 0) {
    throw new Error("Adjustment amount must be greater than zero.");
  }

  const profile = await getOrCreateCustomerProfile(pharmacyId, actorUid, actorName);
  const now = new Date().toISOString();
  const entryId = `LEDGER_ADJ_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  const debitAmount = transactionType === "ADJUSTMENT_DEBIT" ? amount : 0;
  const creditAmount = transactionType === "ADJUSTMENT_CREDIT" ? amount : 0;

  const entry: CustomerLedgerEntry = {
    id: entryId,
    pharmacyId,
    customerAccountNumber: profile.customerAccountNumber,
    orderId: null,
    orderNumber: null,
    invoiceId: null,
    invoiceNumber: null,
    transactionType,
    sourceType: "MANUAL_ADJUSTMENT",
    sourceId: entryId,
    description: description || `${transactionType} adjustment`,
    debitAmount,
    creditAmount,
    netAmount: debitAmount - creditAmount,
    currency: profile.currencyCode || profile.currency,
    currencyCode: profile.currencyCode || profile.currency,
    marketId: profile.marketId,
    postingDate: now.split("T")[0],
    dueDate: null,
    status: "POSTED",
    isReversal: false,
    reversesEntryId: null,
    idempotencyKey: `ADJUSTMENT_${entryId}`,
    createdAt: now,
    createdByUid: actorUid,
    createdByName: actorName
  };

  const valRes = validateLedgerEntry(entry);
  if (!valRes.valid) {
    throw new Error(`Adjustment entry validation failed: ${valRes.error}`);
  }

  await setDoc(doc(db, "customerLedgerEntries", entryId), entry);
  await recalculateAndPersistProfile(pharmacyId, actorUid);

  return entry;
}

/**
 * Fetches Customer Ledger for a pharmacy with calculated running balances
 */
export async function getCustomerLedger(
  pharmacyId: string,
  sortOrder: "asc" | "desc" = "desc"
): Promise<CustomerLedgerEntry[]> {
  const ledgerQuery = query(
    collection(db, "customerLedgerEntries"),
    where("pharmacyId", "==", pharmacyId)
  );

  const querySnap = await getDocs(ledgerQuery);
  const entries: CustomerLedgerEntry[] = [];
  querySnap.forEach(d => entries.push(d.data() as CustomerLedgerEntry));

  return calculateRunningBalances(entries, sortOrder);
}
