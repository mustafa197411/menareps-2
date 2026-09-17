/**
 * WP-FI-2.0 Payment Collection Service & Persistence Engine
 * MENAREPS FINANCIAL INTELLIGENCE
 * 
 * PAYMENTS ARE FOR FINANCIAL INTELLIGENCE, DATA COLLECTION, AND REPORTING ONLY.
 * THEY MUST NEVER CONTROL ORDERS, BLOCK ORDERS, AFFECT DELIVERY, OR ALTER ORDER APPROVALS.
 */

import { 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  collection, 
  query, 
  where, 
  getDocs, 
  orderBy 
} from "firebase/firestore";
import { db } from "../../lib/firebase";
import { 
  PaymentCollection, 
  PaymentMethod, 
  PaymentStatus, 
  PaymentVerificationRecord, 
  PaymentSummaryReport, 
  CustomerLedgerEntry 
} from "./arTypes";
import { getOrCreateCustomerProfile, recalculateAndPersistProfile } from "./arService";
import { validateLedgerEntry } from "./arResolvers";
import { assertSingleCurrency } from "../../lib/financialIdentity";

/**
 * Generates an automatic sequential payment number e.g. PAY-2026-0001
 */
export async function generateSequentialPaymentNumber(): Promise<string> {
  const currentYear = new Date().getFullYear();
  const prefix = `PAY-${currentYear}-`;
  // Collision-resistant display number without an unauthorized collection scan.
  return `${prefix}${Date.now().toString().slice(-10)}`;
}

export interface CreatePaymentInput {
  pharmacyId: string;
  pharmacyName?: string;
  amount: number;
  collectionDate: string; // YYYY-MM-DD
  paymentMethod: PaymentMethod;
  referenceNumber?: string;
  notes?: string;
  attachmentUrls?: string[];

  // Method conditional fields
  receiptNumber?: string;
  chequeNumber?: string;
  chequeBankName?: string;
  chequeDate?: string;
  chequeImageUrl?: string;
  transferBankName?: string;
  transferReference?: string;
  transferProofUrl?: string;

  representativeUid: string;
  representativeName: string;
  areaId?: string;
  areaName?: string;
  cityId?: string;
  cityName?: string;
}

/**
 * Creates a new Payment Collection document in status 'Submitted'
 * Does NOT alter any Orders, Delivery, or Finance Order Approvals.
 */
export async function createPaymentCollection(
  input: CreatePaymentInput,
  actorUid: string,
  actorName: string,
  actorRole: string
): Promise<PaymentCollection> {
  if (!input.pharmacyId) {
    throw new Error("Pharmacy ID is required to record a payment collection.");
  }

  if (!input.amount || input.amount <= 0) {
    throw new Error("Payment amount must be greater than zero.");
  }

  if (!input.paymentMethod) {
    throw new Error("Payment method is required.");
  }

  // Validate conditional fields by payment method (PART 3)
  let computedReferenceNumber = input.referenceNumber || "";

  if (input.paymentMethod === "Cash") {
    if (!input.receiptNumber && !computedReferenceNumber) {
      throw new Error("Receipt Number is required for Cash payments.");
    }
    if (input.receiptNumber && !computedReferenceNumber) {
      computedReferenceNumber = input.receiptNumber;
    }
  } else if (input.paymentMethod === "Cheque") {
    if (!input.chequeNumber) {
      throw new Error("Cheque Number is required for Cheque payments.");
    }
    if (!input.chequeBankName) {
      throw new Error("Bank Name is required for Cheque payments.");
    }
    if (!input.chequeDate) {
      throw new Error("Cheque Date is required for Cheque payments.");
    }
    if (!computedReferenceNumber) {
      computedReferenceNumber = `CHQ-${input.chequeNumber}`;
    }
  } else if (input.paymentMethod === "Bank Transfer") {
    if (!input.transferBankName) {
      throw new Error("Bank Name is required for Bank Transfers.");
    }
    if (!input.transferReference && !computedReferenceNumber) {
      throw new Error("Transfer Reference is required for Bank Transfers.");
    }
    if (!computedReferenceNumber) {
      computedReferenceNumber = input.transferReference || `TRF-${Date.now().toString().slice(-6)}`;
    }
  } else {
    if (!computedReferenceNumber) {
      computedReferenceNumber = `REF-${Date.now().toString().slice(-6)}`;
    }
  }

  // Retrieve Customer Profile to derive account number & canonical info
  const profile = await getOrCreateCustomerProfile(input.pharmacyId, actorUid, actorName);

  const paymentNumber = await generateSequentialPaymentNumber();
  const paymentId = `PAY_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const now = new Date().toISOString();

  const collectionRecord: PaymentCollection = {
    paymentId,
    paymentNumber,
    pharmacyId: input.pharmacyId,
    pharmacyName: input.pharmacyName || profile.pharmacyName,
    customerAccountNumber: profile.customerAccountNumber,
    representativeUid: input.representativeUid || actorUid,
    representativeName: input.representativeName || actorName,
    areaId: input.areaId || profile.areaId || "",
    areaName: input.areaName || profile.areaName || profile.area || "",
    cityId: input.cityId || profile.cityId || "",
    cityName: input.cityName || profile.city || "",
    districtId: profile.districtId || "",
    countryId: profile.countryId || "",
    collectionDate: input.collectionDate || now.split("T")[0],
    amount: Math.round(Number(input.amount) * 100) / 100,
    currency: profile.currencyCode || profile.currency,
    currencyCode: profile.currencyCode || profile.currency,
    marketId: profile.marketId,
    paymentMethod: input.paymentMethod,
    referenceNumber: computedReferenceNumber,
    notes: input.notes || "",
    attachmentUrls: input.attachmentUrls || [],

    // Conditional method fields
    receiptNumber: input.receiptNumber || undefined,
    chequeNumber: input.chequeNumber || undefined,
    chequeBankName: input.chequeBankName || undefined,
    chequeDate: input.chequeDate || undefined,
    chequeImageUrl: input.chequeImageUrl || undefined,
    transferBankName: input.transferBankName || undefined,
    transferReference: input.transferReference || undefined,
    transferProofUrl: input.transferProofUrl || undefined,

    status: "Submitted",

    verificationHistory: [
      {
        status: "Submitted",
        timestamp: now,
        actorUid,
        actorName,
        actorRole,
        notes: "Payment recorded and submitted for verification."
      }
    ],

    createdAt: now,
    createdByUid: actorUid,
    updatedAt: now,
    updatedByUid: actorUid
  };

  const docRef = doc(db, "paymentCollections", paymentId);
  await setDoc(docRef, collectionRecord);

  // Write Audit Log
  try {
    const auditRef = doc(collection(db, "auditLogs"));
    await setDoc(auditRef, {
      id: auditRef.id,
      eventType: "PAYMENT_COLLECTION_SUBMITTED",
      actorUid,
      actorName,
      actorRole,
      pharmacyId: input.pharmacyId,
      paymentId,
      paymentNumber,
      amount: collectionRecord.amount,
      paymentMethod: collectionRecord.paymentMethod,
      timestamp: now
    });
  } catch (err) {
    console.warn("[PAYMENT_SERVICE] Audit log failure:", err);
  }

  return collectionRecord;
}

/**
 * Finance Verification Workflow (PART 5 & PART 8)
 * Verifies a payment collection, posts a PAYMENT entry to Customer Ledger, and updates Customer Financial Profile summary.
 * NO Order workflow changes occur.
 */
export async function verifyPaymentCollection(
  paymentId: string,
  actorUid: string,
  actorName: string,
  actorRole: string,
  notes: string = ""
): Promise<PaymentCollection> {
  const paymentRef = doc(db, "paymentCollections", paymentId);
  const snap = await getDoc(paymentRef);

  if (!snap.exists()) {
    throw new Error(`Payment Collection [${paymentId}] not found.`);
  }

  const payment = snap.data() as PaymentCollection;

  if (payment.status === "Verified") {
    return payment; // Already verified
  }

  // Resolve the customer account before posting so a payment can never be
  // written into a ledger belonging to a different market/currency.
  const profile = await getOrCreateCustomerProfile(payment.pharmacyId, actorUid, actorName);
  const paymentCurrency = String(payment.currencyCode || payment.currency || "").toUpperCase();
  const profileCurrency = String(profile.currencyCode || profile.currency || "").toUpperCase();
  if (!paymentCurrency || !profileCurrency || paymentCurrency !== profileCurrency
    || (payment.marketId && profile.marketId && payment.marketId !== profile.marketId)) {
    throw new Error("PAYMENT_PROFILE_CURRENCY_MISMATCH");
  }

  const now = new Date().toISOString();
  const ledgerEntryId = `LEDGER_PAYMENT_${paymentId}`;

  // Step 1: Create PAYMENT Ledger Entry
  const ledgerEntry: CustomerLedgerEntry = {
    id: ledgerEntryId,
    pharmacyId: payment.pharmacyId,
    customerAccountNumber: payment.customerAccountNumber,
    orderId: null,
    orderNumber: null,
    invoiceId: null,
    invoiceNumber: null,
    paymentId: payment.paymentId,
    transactionType: "PAYMENT",
    sourceType: "PAYMENT_COLLECTION",
    sourceId: payment.paymentId,
    description: `Payment ${payment.paymentNumber} (${payment.paymentMethod}) - Ref: ${payment.referenceNumber}`,
    debitAmount: 0,
    creditAmount: payment.amount,
    netAmount: -payment.amount,
    currency: paymentCurrency,
    currencyCode: paymentCurrency,
    marketId: payment.marketId || profile.marketId,
    postingDate: payment.collectionDate || now.split("T")[0],
    dueDate: null,
    status: "POSTED",
    isReversal: false,
    reversesEntryId: null,
    idempotencyKey: `PAYMENT_POSTING_${paymentId}`,
    createdAt: now,
    createdByUid: actorUid,
    createdByName: actorName
  };

  const valRes = validateLedgerEntry(ledgerEntry);
  if (!valRes.valid) {
    throw new Error(`Payment ledger entry validation failed: ${valRes.error}`);
  }

  // Write ledger entry to Firestore
  await setDoc(doc(db, "customerLedgerEntries", ledgerEntryId), ledgerEntry);

  // Step 2: Update Customer Financial Profile (Total Collected, Outstanding Balance, Last Payment Date)
  const profileRef = doc(db, "customerFinancialProfiles", payment.pharmacyId);
  const currentCollected = Number(profile.totalCollected || 0);
  const updatedTotalCollected = currentCollected + payment.amount;

  await updateDoc(profileRef, {
    totalCollected: updatedTotalCollected,
    lastPaymentDate: payment.collectionDate || now.split("T")[0],
    updatedAt: now,
    updatedByUid: actorUid
  });

  // Recalculate complete profile analytics from all active entries
  await recalculateAndPersistProfile(payment.pharmacyId, actorUid);

  // Step 3: Update Payment Record Status to 'Verified'
  const newVerificationRecord: PaymentVerificationRecord = {
    status: "Verified",
    timestamp: now,
    actorUid,
    actorName,
    actorRole,
    notes: notes || "Payment verified by Finance Officer."
  };

  const updatedHistory = [...(payment.verificationHistory || []), newVerificationRecord];

  const paymentUpdates: Partial<PaymentCollection> = {
    status: "Verified",
    verifiedAt: now,
    verifiedByUid: actorUid,
    verifiedByName: actorName,
    ledgerEntryId,
    verificationHistory: updatedHistory,
    updatedAt: now,
    updatedByUid: actorUid
  };

  await updateDoc(paymentRef, paymentUpdates);

  // Write Audit Log
  try {
    const auditRef = doc(collection(db, "auditLogs"));
    await setDoc(auditRef, {
      id: auditRef.id,
      eventType: "PAYMENT_COLLECTION_VERIFIED",
      actorUid,
      actorName,
      actorRole,
      pharmacyId: payment.pharmacyId,
      paymentId: payment.paymentId,
      paymentNumber: payment.paymentNumber,
      amount: payment.amount,
      ledgerEntryId,
      timestamp: now
    });
  } catch (err) {
    console.warn("[PAYMENT_SERVICE] Audit log error:", err);
  }

  return {
    ...payment,
    ...paymentUpdates
  };
}

/**
 * Rejects a Payment Collection record (Finance role)
 * Does NOT alter Orders, Delivery, or Finance Order Approvals.
 */
export async function rejectPaymentCollection(
  paymentId: string,
  reason: string,
  actorUid: string,
  actorName: string,
  actorRole: string
): Promise<PaymentCollection> {
  const paymentRef = doc(db, "paymentCollections", paymentId);
  const snap = await getDoc(paymentRef);

  if (!snap.exists()) {
    throw new Error(`Payment Collection [${paymentId}] not found.`);
  }

  const payment = snap.data() as PaymentCollection;
  const now = new Date().toISOString();

  const newRecord: PaymentVerificationRecord = {
    status: "Rejected",
    timestamp: now,
    actorUid,
    actorName,
    actorRole,
    reason,
    notes: `Payment rejected: ${reason}`
  };

  const updatedHistory = [...(payment.verificationHistory || []), newRecord];

  const paymentUpdates: Partial<PaymentCollection> = {
    status: "Rejected",
    rejectionReason: reason,
    verificationHistory: updatedHistory,
    updatedAt: now,
    updatedByUid: actorUid
  };

  await updateDoc(paymentRef, paymentUpdates);

  // Audit Log
  try {
    const auditRef = doc(collection(db, "auditLogs"));
    await setDoc(auditRef, {
      id: auditRef.id,
      eventType: "PAYMENT_COLLECTION_REJECTED",
      actorUid,
      actorName,
      actorRole,
      pharmacyId: payment.pharmacyId,
      paymentId,
      reason,
      timestamp: now
    });
  } catch (e) {
    console.warn("[PAYMENT_SERVICE] Audit log error:", e);
  }

  return {
    ...payment,
    ...paymentUpdates
  };
}

/**
 * Corrects / Updates a Payment Collection record (Finance or Representative)
 */
export async function correctPaymentCollection(
  paymentId: string,
  corrections: Partial<PaymentCollection>,
  actorUid: string,
  actorName: string,
  actorRole: string,
  notes: string = ""
): Promise<PaymentCollection> {
  const paymentRef = doc(db, "paymentCollections", paymentId);
  const snap = await getDoc(paymentRef);

  if (!snap.exists()) {
    throw new Error(`Payment Collection [${paymentId}] not found.`);
  }

  const payment = snap.data() as PaymentCollection;
  const now = new Date().toISOString();

  const newRecord: PaymentVerificationRecord = {
    status: "Corrected",
    timestamp: now,
    actorUid,
    actorName,
    actorRole,
    notes: notes || "Payment record updated and marked as Corrected."
  };

  const updatedHistory = [...(payment.verificationHistory || []), newRecord];

  const allowedUpdates: Partial<PaymentCollection> = {
    amount: corrections.amount !== undefined ? Number(corrections.amount) : payment.amount,
    collectionDate: corrections.collectionDate || payment.collectionDate,
    paymentMethod: corrections.paymentMethod || payment.paymentMethod,
    referenceNumber: corrections.referenceNumber || payment.referenceNumber,
    notes: corrections.notes !== undefined ? corrections.notes : payment.notes,
    attachmentUrls: corrections.attachmentUrls || payment.attachmentUrls,

    receiptNumber: corrections.receiptNumber !== undefined ? corrections.receiptNumber : payment.receiptNumber,
    chequeNumber: corrections.chequeNumber !== undefined ? corrections.chequeNumber : payment.chequeNumber,
    chequeBankName: corrections.chequeBankName !== undefined ? corrections.chequeBankName : payment.chequeBankName,
    chequeDate: corrections.chequeDate !== undefined ? corrections.chequeDate : payment.chequeDate,
    chequeImageUrl: corrections.chequeImageUrl !== undefined ? corrections.chequeImageUrl : payment.chequeImageUrl,
    transferBankName: corrections.transferBankName !== undefined ? corrections.transferBankName : payment.transferBankName,
    transferReference: corrections.transferReference !== undefined ? corrections.transferReference : payment.transferReference,
    transferProofUrl: corrections.transferProofUrl !== undefined ? corrections.transferProofUrl : payment.transferProofUrl,

    status: "Corrected",
    verificationHistory: updatedHistory,
    updatedAt: now,
    updatedByUid: actorUid
  };

  await updateDoc(paymentRef, allowedUpdates);

  // If was previously verified, update customer ledger and profile
  if (payment.ledgerEntryId) {
    const ledgerRef = doc(db, "customerLedgerEntries", payment.ledgerEntryId);
    const newAmount = allowedUpdates.amount || payment.amount;
    await updateDoc(ledgerRef, {
      creditAmount: newAmount,
      netAmount: -newAmount,
      postingDate: allowedUpdates.collectionDate || payment.collectionDate,
      description: `Payment ${payment.paymentNumber} (${allowedUpdates.paymentMethod}) - Ref: ${allowedUpdates.referenceNumber}`
    });

    await recalculateAndPersistProfile(payment.pharmacyId, actorUid);
  }

  return {
    ...payment,
    ...allowedUpdates
  };
}

/**
 * Aggregates Payment Analytics for Reports (PART 9)
 */
export function generatePaymentSummaryReports(payments: PaymentCollection[]): PaymentSummaryReport {
  assertSingleCurrency(payments, payment => payment.currencyCode || payment.currency);
  const report: PaymentSummaryReport = {
    totalCollected: 0,
    totalPaymentsCount: payments.length,
    byStatus: {
      Submitted: 0,
      Verified: 0,
      Rejected: 0,
      Corrected: 0
    },
    countByMethod: {
      Cash: 0,
      Cheque: 0,
      "Bank Transfer": 0,
      Other: 0
    },
    amountByMethod: {
      Cash: 0,
      Cheque: 0,
      "Bank Transfer": 0,
      Other: 0
    },
    byRepresentative: {},
    byPharmacy: {},
    byArea: {},
    byMonth: {}
  };

  for (const p of payments) {
    // Status counts
    if (report.byStatus[p.status] !== undefined) {
      report.byStatus[p.status]++;
    }

    const amt = Number(p.amount || 0);

    // Method breakdowns
    if (report.countByMethod[p.paymentMethod] !== undefined) {
      report.countByMethod[p.paymentMethod]++;
      if (p.status === "Verified") {
        report.amountByMethod[p.paymentMethod] += amt;
      }
    }

    // Only count verified or submitted towards total analytics
    if (p.status === "Verified") {
      report.totalCollected += amt;
    }

    // Representative breakdown
    const repUid = p.representativeUid || "unassigned";
    const repName = p.representativeName || "Representative " + repUid.slice(-4);
    if (!report.byRepresentative[repUid]) {
      report.byRepresentative[repUid] = { uid: repUid, name: repName, totalAmount: 0, count: 0 };
    }
    report.byRepresentative[repUid].count++;
    if (p.status === "Verified") {
      report.byRepresentative[repUid].totalAmount += amt;
    }

    // Pharmacy breakdown
    const pharmId = p.pharmacyId || "unknown";
    const pharmName = p.pharmacyName || "Pharmacy " + pharmId.slice(-4);
    if (!report.byPharmacy[pharmId]) {
      report.byPharmacy[pharmId] = { pharmacyId: pharmId, name: pharmName, totalAmount: 0, count: 0 };
    }
    report.byPharmacy[pharmId].count++;
    if (p.status === "Verified") {
      report.byPharmacy[pharmId].totalAmount += amt;
    }

    // Area breakdown
    const areaId = p.areaId || "unassigned";
    const areaName = p.areaName || areaId || "General Area";
    if (!report.byArea[areaId]) {
      report.byArea[areaId] = { areaId, name: areaName, totalAmount: 0, count: 0 };
    }
    report.byArea[areaId].count++;
    if (p.status === "Verified") {
      report.byArea[areaId].totalAmount += amt;
    }

    // Month breakdown (YYYY-MM)
    const monthKey = (p.collectionDate || p.createdAt || "").substring(0, 7) || "2026-07";
    if (!report.byMonth[monthKey]) {
      report.byMonth[monthKey] = { monthKey, totalAmount: 0, count: 0 };
    }
    report.byMonth[monthKey].count++;
    if (p.status === "Verified") {
      report.byMonth[monthKey].totalAmount += amt;
    }
  }

  // Round numbers
  report.totalCollected = Math.round(report.totalCollected * 100) / 100;
  for (const m of ["Cash", "Cheque", "Bank Transfer", "Other"] as PaymentMethod[]) {
    report.amountByMethod[m] = Math.round(report.amountByMethod[m] * 100) / 100;
  }

  return report;
}

export function generatePaymentSummaryReportsByCurrency(payments: PaymentCollection[]): Record<string, PaymentSummaryReport> {
  const groups: Record<string, PaymentCollection[]> = {};
  for (const payment of payments) {
    const currency = (payment.currencyCode || payment.currency || "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) continue;
    (groups[currency] ||= []).push(payment);
  }
  return Object.fromEntries(Object.entries(groups).map(([currency, records]) => [currency, generatePaymentSummaryReports(records)]));
}

/**
 * Creates or updates a canonical PaymentCollection document for a completed Pharmacy Visit.
 * (WP-FI-2.3)
 */
export async function syncVisitPaymentCollection(input: {
  visitId: string;
  pharmacyId: string;
  collectedAmount: number;
  paymentMethod?: string;
  referenceNumber?: string | null;
  notes?: string | null;
  attachmentUrls?: string[];
  actorUid: string;
  actorName: string;
  orderId?: string | null;
  dateStr?: string | null;
}): Promise<PaymentCollection | null> {
  if (!input.visitId || !input.pharmacyId || input.collectedAmount <= 0) {
    return null;
  }

  const paymentId = `VISIT_PAYMENT_${input.visitId}`;
  let paymentCreationAttempted = false;
  let paymentCreated = false;
  let visitLinkUpdated = false;

  try {
    paymentCreationAttempted = true;
    const existingSnap = await getDoc(doc(db, "paymentCollections", paymentId));

    let paymentNumber = "";
    let paymentRecord: PaymentCollection;

    if (existingSnap.exists()) {
      paymentRecord = existingSnap.data() as PaymentCollection;
      paymentNumber = paymentRecord.paymentNumber;
      paymentCreated = true;
    } else {
      const profile = await getOrCreateCustomerProfile(input.pharmacyId, input.actorUid, input.actorName);
      paymentNumber = await generateSequentialPaymentNumber();
      const now = new Date().toISOString();

      let mappedMethod: PaymentMethod = "Other";
      if (input.paymentMethod) {
        const lower = String(input.paymentMethod).toLowerCase();
        if (lower.includes("cash")) mappedMethod = "Cash";
        else if (lower.includes("cheque") || lower.includes("check")) mappedMethod = "Cheque";
        else if (lower.includes("transfer") || lower.includes("bank")) mappedMethod = "Bank Transfer";
        else mappedMethod = "Other";
      }

      paymentRecord = {
        paymentId,
        paymentNumber,
        pharmacyId: input.pharmacyId,
        pharmacyName: profile.pharmacyName,
        customerAccountNumber: profile.customerAccountNumber,
        representativeUid: input.actorUid,
        representativeName: input.actorName,
        areaId: profile.areaId || null,
        areaName: profile.areaName || profile.area || null,
        cityId: profile.cityId || null,
        cityName: profile.cityName || profile.city || null,
        districtId: profile.districtId || null,
        countryId: profile.countryId || "",
        collectionDate: input.dateStr || now.split("T")[0],
        amount: Math.round(input.collectedAmount * 100) / 100,
        currency: profile.currencyCode || profile.currency,
        currencyCode: profile.currencyCode || profile.currency,
        marketId: profile.marketId,
        paymentMethod: mappedMethod,
        referenceNumber: input.referenceNumber || null,
        notes: input.notes || "",
        attachmentUrls: input.attachmentUrls || [],
        status: "Submitted",
        sourceType: "PHARMACY_VISIT",
        sourceVisitId: input.visitId,
        sourceOrderId: input.orderId || null,
        idempotencyKey: `VISIT_PAYMENT_${input.visitId}`,
        verificationHistory: [
          {
            status: "Submitted",
            timestamp: now,
            actorUid: input.actorUid,
            actorName: input.actorName,
            actorRole: "Representative",
            notes: "Created automatically from completed Pharmacy Visit."
          }
        ],
        createdAt: now,
        createdByUid: input.actorUid,
        updatedAt: now,
        updatedByUid: input.actorUid
      };

      await setDoc(doc(db, "paymentCollections", paymentId), paymentRecord);
      paymentCreated = true;
    }

    // Link back to Pharmacy Visit
    await updateDoc(doc(db, "pharmacyVisits", input.visitId), {
      paymentCollectionId: paymentId,
      paymentCollectionNumber: paymentNumber,
      paymentCollectionStatus: "Submitted",
      paymentCollectionSyncedAt: new Date().toISOString()
    });
    visitLinkUpdated = true;

    return paymentRecord;
  } catch (err: any) {
    console.error("[VISIT_PAYMENT_SYNC_ERROR]", JSON.stringify({
      visitId: input.visitId,
      pharmacyId: input.pharmacyId,
      collectedAmount: input.collectedAmount,
      paymentMethod: input.paymentMethod || "Other",
      paymentCreationAttempted,
      paymentCreated,
      visitLinkUpdated,
      errorCode: err.code || "SYNC_ERROR",
      errorMessage: err.message || String(err)
    }));
    return null;
  }
}

/**
 * Historical Visit Payment Reconciliation Engine (WP-FI-2.3 PART 9)
 * Scans completed pharmacyVisits with collectedAmount > 0 and creates missing PaymentCollection records in 'Submitted' status.
 */
export async function reconcileVisitPayments(
  actorUid: string = "system",
  actorName: string = "Super Admin"
): Promise<{
  visitsScanned: number;
  eligibleVisits: number;
  paymentsCreated: number;
  alreadySynced: number;
  visitsLinked: number;
  skipped: number;
  failed: number;
  details: string[];
}> {
  const report = {
    visitsScanned: 0,
    eligibleVisits: 0,
    paymentsCreated: 0,
    alreadySynced: 0,
    visitsLinked: 0,
    skipped: 0,
    failed: 0,
    details: [] as string[]
  };

  try {
    const visitsSnap = await getDocs(collection(db, "pharmacyVisits"));
    report.visitsScanned = visitsSnap.size;

    for (const vDoc of visitsSnap.docs) {
      const v = vDoc.data();
      const visitId = vDoc.id;
      const collectedAmount = Number(v.collectedAmount ?? v.paymentCollected ?? v.payment?.paymentEntry?.amount ?? 0);

      if (collectedAmount <= 0) {
        continue;
      }
      report.eligibleVisits++;

      const pharmacyId = v.pharmacyId;
      if (!pharmacyId) {
        report.skipped++;
        report.details.push(`Visit [${visitId}]: Skipped because pharmacyId is missing.`);
        continue;
      }

      // Check if payment collection already exists
      const paymentId = `VISIT_PAYMENT_${visitId}`;
      const existingPaySnap = await getDoc(doc(db, "paymentCollections", paymentId));

      let paymentNumber = "";
      if (existingPaySnap.exists()) {
        report.alreadySynced++;
        paymentNumber = existingPaySnap.data().paymentNumber || "";
        report.details.push(`Visit [${visitId}]: Already synced to Payment Collection [${paymentId}].`);
      } else {
        try {
          let rawMethod = v.paymentMethod || v.payment?.paymentEntry?.method || "";
          let mappedMethod: PaymentMethod = "Other";
          let methodNotes = "";

          if (rawMethod) {
            const lower = String(rawMethod).toLowerCase();
            if (lower.includes("cash")) mappedMethod = "Cash";
            else if (lower.includes("cheque") || lower.includes("check")) mappedMethod = "Cheque";
            else if (lower.includes("transfer") || lower.includes("bank")) mappedMethod = "Bank Transfer";
            else mappedMethod = "Other";
          } else {
            mappedMethod = "Other";
            methodNotes = "Historical visit payment imported without a recorded payment method.";
          }

          const refNum = v.referenceNumber || v.payment?.paymentEntry?.bankReferenceNumber || v.payment?.paymentEntry?.chequeNumber || v.payment?.paymentEntry?.receiptNumber || null;
          const pNotes = v.notes || v.finalRemarks || methodNotes || "Historical visit payment.";
          const pAttachments = v.attachmentUrls || (v.payment?.paymentEntry?.attachmentUrl ? [v.payment.paymentEntry.attachmentUrl] : []);

          const profile = await getOrCreateCustomerProfile(pharmacyId, actorUid, actorName);
          paymentNumber = await generateSequentialPaymentNumber();
          const now = new Date().toISOString();

          const paymentRecord: PaymentCollection = {
            paymentId,
            paymentNumber,
            pharmacyId,
            pharmacyName: v.pharmacyName || profile.pharmacyName,
            customerAccountNumber: profile.customerAccountNumber,
            representativeUid: v.repId || v.createdBy || actorUid,
            representativeName: v.repName || actorName,
            areaId: v.areaId || profile.areaId || null,
            areaName: profile.areaName || profile.area || null,
            cityId: v.cityId || profile.cityId || null,
            cityName: profile.cityName || profile.city || null,
            districtId: profile.districtId || null,
            countryId: profile.countryId || "",
            collectionDate: v.date || (v.createdAt ? String(v.createdAt).split("T")[0] : now.split("T")[0]),
            amount: Math.round(collectedAmount * 100) / 100,
            currency: profile.currencyCode || profile.currency,
            currencyCode: profile.currencyCode || profile.currency,
            marketId: profile.marketId,
            paymentMethod: mappedMethod,
            referenceNumber: refNum,
            notes: pNotes,
            attachmentUrls: pAttachments,
            status: "Submitted",
            sourceType: "PHARMACY_VISIT",
            sourceVisitId: visitId,
            sourceOrderId: v.orderId || null,
            idempotencyKey: `VISIT_PAYMENT_${visitId}`,
            verificationHistory: [
              {
                status: "Submitted",
                timestamp: now,
                actorUid,
                actorName,
                actorRole: "Super Admin",
                notes: "Imported during historical visit payment reconciliation."
              }
            ],
            createdAt: now,
            createdByUid: actorUid,
            updatedAt: now,
            updatedByUid: actorUid
          };

          await setDoc(doc(db, "paymentCollections", paymentId), paymentRecord);
          report.paymentsCreated++;
          report.details.push(`Visit [${visitId}]: Created Payment Collection [${paymentId}].`);
        } catch (createErr: any) {
          report.failed++;
          report.details.push(`Visit [${visitId}]: Failed to create Payment Collection - ${createErr.message}`);
          continue;
        }
      }

      // Link visit back if link fields missing
      if (!v.paymentCollectionId) {
        try {
          await updateDoc(doc(db, "pharmacyVisits", visitId), {
            paymentCollectionId: paymentId,
            paymentCollectionNumber: paymentNumber,
            paymentCollectionStatus: "Submitted",
            paymentCollectionSyncedAt: new Date().toISOString()
          });
          report.visitsLinked++;
        } catch (linkErr: any) {
          report.details.push(`Visit [${visitId}]: Linked payment record, but updating visit document failed - ${linkErr.message}`);
        }
      }
    }
  } catch (err: any) {
    console.error("[VISIT_PAYMENT_RECONCILIATION_ERROR]", err);
  }

  console.info("[VISIT_PAYMENT_RECONCILIATION_JSON]", JSON.stringify(report));
  return report;
}
