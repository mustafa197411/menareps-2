import { financialMinorUnits, settlementProjection } from "../src/features/ar/arResolvers";
import { FieldPath, type Firestore, type Transaction } from "firebase-admin/firestore";
import type { CanonicalReceivable, SettlementIdentity, PaymentAllocationEvent, CollectionReversalRecord } from "../src/features/ar/arTypes";
import { calculatePaymentReversal, financialIdentityKey, certifiedReceivable, assertCustomerCertification, assertFinancialIdentity, type prepareVerification } from "./financialSettlementService";

/**
 * Read-only dependency, not a runtime authorization entry point. The caller owns
 * authorization, canonical market/precision resolution and the transaction.
 * Requires protected certification; this query cannot discover legacy documents
 * missing isOpen/createdAt and must never serve as historical initialization.
 */
export async function readCertifiedOpenReceivables(
  db: Firestore, tx: Transaction, identity: SettlementIdentity,
): Promise<CanonicalReceivable[]> {
  assertFinancialIdentity(identity, identity);
  financialMinorUnits(0, identity.decimalPlaces);
  if (typeof identity.pharmacyId !== "string" || identity.pharmacyId !== identity.pharmacyId.trim()
    || identity.pharmacyId.includes("/") || [".", ".."].includes(identity.pharmacyId)) {
    throw new Error("FINANCIAL_IDENTITY_MISMATCH");
  }
  const [pharmacy, profile] = await Promise.all([
    tx.get(db.doc(`pharmacies/${identity.pharmacyId}`)),
    tx.get(db.doc(`customerFinancialProfiles/${identity.pharmacyId}`)),
  ]);
  if (!pharmacy.exists || pharmacy.id !== identity.pharmacyId
    || (pharmacy.data()?.id !== undefined && pharmacy.data()!.id !== identity.pharmacyId)
    || !profile.exists) throw new Error("FINANCIAL_PROJECTION_INITIALIZATION_REQUIRED");
  assertCustomerCertification(profile.id, profile.data()!, identity);

  const snapshot = await tx.get(db.collection("customerLedgerEntries")
    .where("pharmacyId", "==", identity.pharmacyId)
    .where("isOpen", "==", true)
    .orderBy("createdAt", "asc")
    .orderBy(FieldPath.documentId(), "asc")
    .limit(81));
  // A sentinel means completeness is unproven, not that collection is forbidden.
  if (snapshot.docs.length > 80) throw new Error("FINANCIAL_RECEIVABLE_SET_CAPACITY_EXCEEDED");
  return snapshot.docs.map(document => {
    const raw = document.data();
    const receivable = certifiedReceivable(document.id, raw, identity);
    if (raw.isOpen !== true) throw new Error("FINANCIAL_PROJECTION_INITIALIZATION_REQUIRED");
    return receivable;
  });
}

type Plan = ReturnType<typeof prepareVerification>;
function settlementFingerprint(payment: Record<string, any>, allocations: Record<string, any>[]) {
  const { settlementFingerprint: ignored, ...entry } = payment;
  return financialIdentityKey({ payment: { ...entry, createdAt: undefined, createdByUid: undefined },
    allocations: allocations.map(({ actorUid, createdAt, operationId, ...a }) => a) });
}
function collectionFingerprint(collection: Record<string, any>) {
  const { status, revision, verifiedAt, verifiedByUid, ledgerEntryId, verificationResult, ...submitted } = collection;
  return financialIdentityKey(submitted);
}
const documentId = (value: unknown): value is string => typeof value === "string" && !!value && value === value.trim() && !value.includes("/") && ![".", ".."].includes(value);

/** Recognize a committed result using immutable linkage, never today's open invoices. */
export async function readCompletedVerification(db: Firestore, tx: Transaction, collection: Record<string, any>, expectedRevision: number) {
  const result = collection.verificationResult;
  if (collection.status !== "Verified" || expectedRevision !== 1 || collection.revision !== 2
    || !documentId(collection.id) || result?.version !== 1 || result.expectedRevision !== expectedRevision
    || result.paymentLedgerId !== `LEDGER_PAYMENT_${collection.id}` || collection.ledgerEntryId !== result.paymentLedgerId
    || result.collectionFingerprint !== collectionFingerprint(collection)
    || !Array.isArray(result.allocationIds) || !result.allocationIds.length || result.allocationIds.length > 80
    || result.allocationIds.some((id: unknown) => !documentId(id)) || new Set(result.allocationIds).size !== result.allocationIds.length) throw new Error("INCOMPLETE_SETTLEMENT");
  const [paymentSnap, auditSnap, ...allocationSnaps] = await Promise.all([
    tx.get(db.doc(`customerLedgerEntries/${result.paymentLedgerId}`)),
    tx.get(db.doc(`auditLogs/VERIFIED_${collection.id}`)),
    ...result.allocationIds.map((id: string) => tx.get(db.doc(`paymentAllocations/${id}`))),
  ]);
  const payment = paymentSnap.data(), audit = auditSnap.data();
  const allocations = allocationSnaps.map(snapshot => snapshot.data());
  if (!payment || !audit || allocations.some(a => !a)) throw new Error("INCOMPLETE_SETTLEMENT");
  try {
    assertFinancialIdentity(collection as SettlementIdentity, payment as SettlementIdentity);
    if (payment.id !== result.paymentLedgerId || payment.paymentId !== collection.id || payment.sourceId !== collection.id
      || payment.transactionType !== "PAYMENT" || payment.sourceType !== "PAYMENT_COLLECTION" || payment.status !== "POSTED"
      || payment.isReversal !== false || payment.reversesEntryId !== null || payment.debitAmount !== 0
      || payment.creditAmount !== collection.amount || payment.netAmount !== -collection.amount || payment.postingDate !== collection.collectionDate
      || !documentId(payment.createdByUid) || !Number.isFinite(Date.parse(payment.createdAt))
      || collection.verifiedByUid !== payment.createdByUid || collection.verifiedAt !== payment.createdAt
      || audit.action !== "COLLECTION_VERIFIED" || audit.collectionId !== collection.id
      || audit.actorUid !== payment.createdByUid || audit.createdAt !== payment.createdAt) throw new Error();
    const invoiceIds = new Set<string>();
    let sum = 0;
    allocations.forEach((a, i) => {
      assertFinancialIdentity(collection as SettlementIdentity, a as SettlementIdentity);
      if (!a || !documentId(a.invoiceLedgerId) || !documentId(a.orderId) || invoiceIds.has(a.invoiceLedgerId)
        || a.id !== result.allocationIds[i] || a.id !== `ALLOC_${financialIdentityKey([payment.id, a.invoiceLedgerId])}`
        || a.sequence !== i + 1 || a.collectionId !== collection.id || a.paymentLedgerId !== payment.id
        || a.actorUid !== payment.createdByUid || a.createdAt !== payment.createdAt || !a.operationId
        || a.operationId !== allocations[0]!.operationId || a.reversesAllocationId !== undefined) throw new Error();
      invoiceIds.add(a.invoiceLedgerId);
      const units = financialMinorUnits(a.amount, collection.decimalPlaces);
      if (units <= 0) throw new Error();
      sum += units;
    });
    if (!Number.isSafeInteger(sum) || sum !== financialMinorUnits(collection.amount, collection.decimalPlaces)
      || payment.settlementFingerprint !== result.settlementFingerprint
      || settlementFingerprint(payment, allocations as Record<string, any>[]) !== result.settlementFingerprint) throw new Error();
  } catch { throw new Error("INCOMPLETE_SETTLEMENT"); }
  return { posted: false };
}

/** Existing ledger-derived open-invoice reporting conventions shared by settlement and reversal. */
function openInvoiceSummary(open: readonly CanonicalReceivable[], rawInvoices: Record<string, any>[], projections: Plan["projections"], now: string) {
  let oldestOpenInvoiceDate: string | null = null, overdueUnits = 0;
  const ageing = { current: 0, oneToThirty: 0, thirtyOneToSixty: 0, sixtyOneToNinety: 0, overNinety: 0 };
  const today = now.split("T")[0];
  for (let i = 0; i < open.length; i++) {
    const row = open[i], raw = rawInvoices[i];
    const projection = projections.find(p => p.invoiceLedgerId === row.id)
      || settlementProjection(row.originalAmount, row.creditedAmount, row.appliedAmount, row.decimalPlaces);
    if (!projection.isOpen) continue;
    const postingDate = raw.postingDate || raw.createdAt;
    const dueDate = (raw.dueDate || postingDate)?.split("T")[0];
    if (typeof postingDate !== "string" || !Number.isFinite(Date.parse(postingDate)) || !Number.isFinite(Date.parse(dueDate))) throw new Error("FINANCIAL_PROFILE_RECONCILIATION_REQUIRED");
    if (!oldestOpenInvoiceDate || postingDate < oldestOpenInvoiceDate) oldestOpenInvoiceDate = postingDate;
    const amount = financialMinorUnits(projection.invoiceOpenAmount, row.decimalPlaces);
    const days = Math.max(0, Math.floor((Date.parse(now) - Date.parse(dueDate)) / 86400000));
    if (dueDate < today) overdueUnits += amount;
    const bucket = dueDate >= today || days <= 0 ? "current" : days <= 30 ? "oneToThirty" : days <= 60 ? "thirtyOneToSixty" : days <= 90 ? "sixtyOneToNinety" : "overNinety";
    ageing[bucket] += amount;
  }
  return { oldestOpenInvoiceDate, overdueUnits, ageing };
}

/** Caller owns the transaction; the existing reader supplies the complete profile projection set. */
export async function persistVerification(db: Firestore, tx: Transaction, plan: Plan, expectedCollectionRevision: number) {
  const paymentId = plan.payment.paymentId;
  const paths = [
    `paymentCollections/${paymentId}`, `customerLedgerEntries/${plan.payment.id}`,
    ...plan.allocations.map(a => `paymentAllocations/${a.id}`),
    ...plan.projections.map(p => `customerLedgerEntries/${p.invoiceLedgerId}`),
    ...plan.projections.map(p => `orders/${p.orderId}`),
    `customerFinancialProfiles/${plan.payment.pharmacyId}`,
  ];
  if (new Set(plan.projections.map(p => p.orderId)).size !== plan.projections.length || plan.allocations.length !== plan.projections.length || plan.projections.length > 80 || plan.projections.length === 0 || paths.some(path => path.split("/").length !== 2)) throw new Error("INVALID_SETTLEMENT_PLAN");
  const refs = paths.map(path => db.doc(path));
  const snapshots = await Promise.all(refs.map(ref => tx.get(ref)));
  const fingerprint = settlementFingerprint(plan.payment, plan.allocations);
  if (snapshots[1].exists) {
    if (snapshots[1].data()?.settlementFingerprint !== fingerprint) throw new Error("VERIFICATION_IDEMPOTENCY_CONFLICT");
    if (snapshots[0].data()?.status !== "Verified" || snapshots[0].data()?.ledgerEntryId !== plan.payment.id || snapshots.slice(2, 2 + plan.allocations.length).some(s => !s.exists)) throw new Error("INCOMPLETE_SETTLEMENT");
    return readCompletedVerification(db, tx, snapshots[0].data()!, expectedCollectionRevision);
  }
  const collection = snapshots[0].data();
  if (!collection || collection.status !== "Submitted" || collection.revision !== expectedCollectionRevision || collection.amount !== plan.payment.creditAmount || collection.pharmacyId !== plan.payment.pharmacyId || collection.marketId !== plan.payment.marketId || collection.currencyCode !== plan.payment.currencyCode) throw new Error("STALE_COLLECTION");
  const n = plan.allocations.length;
  const sum = plan.allocations.reduce((total, allocation) => total + financialMinorUnits(allocation.amount, plan.payment.decimalPlaces), 0);
  if (sum !== financialMinorUnits(plan.payment.creditAmount, plan.payment.decimalPlaces)) throw new Error("INVALID_SETTLEMENT_PLAN");
  if (snapshots.slice(2, 2 + n).some(s => s.exists)) throw new Error("ALLOCATION_CONFLICT");
  let targetOpenUnits = 0;
  plan.projections.forEach((p, i) => {
    const invoice = snapshots[2 + n + i].data();
    const order = snapshots[2 + n + plan.projections.length + i].data();
    // Match the invoice writer's supported persisted representations without rewriting the Order.
    const primaryPharmacy = typeof order?.pharmacyId === "string" ? order.pharmacyId.trim() : "";
    const legacyPharmacy = typeof order?.pharmacy === "string" ? order.pharmacy.trim() : "";
    if ((order?.pharmacyId !== undefined && typeof order.pharmacyId !== "string")
      || (order?.pharmacy !== undefined && typeof order.pharmacy !== "string")
      || (primaryPharmacy && legacyPharmacy && primaryPharmacy !== legacyPharmacy)
      || (primaryPharmacy || legacyPharmacy) !== plan.payment.pharmacyId
      || (order?.currencyCode === undefined && order?.currency === undefined)
      || (order?.currencyCode !== undefined && order.currencyCode !== plan.payment.currencyCode)
      || (order?.currency !== undefined && order.currency !== plan.payment.currencyCode)) throw new Error("STALE_RECEIVABLE");
    if (!invoice || invoice.revision !== p.expectedRevision || !order || invoice.orderId !== p.orderId || invoice.status !== "POSTED" || invoice.sourceType !== "DELIVERED_ORDER" || invoice.pharmacyId !== plan.payment.pharmacyId || invoice.marketId !== plan.payment.marketId || invoice.currencyCode !== plan.payment.currencyCode || order.marketId !== plan.payment.marketId) throw new Error("STALE_RECEIVABLE");
    const row = certifiedReceivable(p.invoiceLedgerId, invoice, plan.payment);
    targetOpenUnits += financialMinorUnits(invoice.invoiceOpenAmount, plan.payment.decimalPlaces);
    const applied = (financialMinorUnits(invoice.invoiceAppliedAmount, plan.payment.decimalPlaces) + financialMinorUnits(plan.allocations[i].amount, plan.payment.decimalPlaces)) / 10 ** plan.payment.decimalPlaces;
    const actual = settlementProjection(invoice.invoiceOriginalAmount, row.creditedAmount, applied, plan.payment.decimalPlaces);
    if (plan.allocations[i].invoiceLedgerId !== p.invoiceLedgerId || actual.invoiceAppliedAmount !== p.invoiceAppliedAmount || actual.invoiceOpenAmount !== p.invoiceOpenAmount || actual.paidStatus !== p.paidStatus || actual.isOpen !== p.isOpen || actual.invoiceCreditedAmount !== p.invoiceCreditedAmount || p.revision !== p.expectedRevision + 1) throw new Error("STALE_RECEIVABLE");
  });
  const profile = snapshots.at(-1)!.data();
  if (!profile || profile.projectionSource !== "customerLedgerEntries" || profile.currencyCode !== plan.payment.currencyCode || profile.marketId !== plan.payment.marketId) throw new Error("FINANCIAL_PROFILE_RECONCILIATION_REQUIRED");
  assertCustomerCertification(plan.payment.pharmacyId, profile, plan.payment);
  const units = financialMinorUnits(plan.payment.creditAmount, plan.payment.decimalPlaces);
  const balance = financialMinorUnits(profile.outstandingBalance, plan.payment.decimalPlaces);
  const collected = financialMinorUnits(profile.totalCollected, plan.payment.decimalPlaces);
  if (!Number.isSafeInteger(targetOpenUnits) || balance < targetOpenUnits || !Number.isSafeInteger(collected + units)) throw new Error("FINANCIAL_PROFILE_RECONCILIATION_REQUIRED");
  // Reuse the bounded certified reader: summaries require ALL current open invoices,
  // including those this payment does not touch. Exact reads retain posting-date conventions.
  const open = await readCertifiedOpenReceivables(db, tx, plan.payment);
  const invoiceSnapshots = await Promise.all(open.map(row => tx.get(db.doc(`customerLedgerEntries/${row.id}`))));
  const openUnits = open.reduce((sum, row) => sum + financialMinorUnits(settlementProjection(row.originalAmount, row.creditedAmount, row.appliedAmount, row.decimalPlaces).invoiceOpenAmount, row.decimalPlaces), 0);
  if (!Number.isSafeInteger(openUnits) || openUnits !== balance || profile.openInvoiceCount !== open.length
    || !Number.isSafeInteger(profile.paidInvoiceCount) || profile.paidInvoiceCount < 0
    || !Number.isSafeInteger(profile.paidInvoiceCount + plan.projections.filter(p => !p.isOpen).length)) throw new Error("FINANCIAL_PROFILE_RECONCILIATION_REQUIRED");
  const totalInvoiced = financialMinorUnits(profile.totalInvoiced, plan.payment.decimalPlaces);
  const { oldestOpenInvoiceDate, overdueUnits, ageing } = openInvoiceSummary(open, invoiceSnapshots.map(snapshot => snapshot.data()!), plan.projections, plan.payment.createdAt);
  const scale = 10 ** plan.payment.decimalPlaces;
  const profileUpdate = {
    outstandingBalance: (openUnits - units) / scale, totalCollected: (collected + units) / scale,
    openInvoiceCount: open.length - plan.projections.filter(p => !p.isOpen).length,
    paidInvoiceCount: profile.paidInvoiceCount + plan.projections.filter(p => !p.isOpen).length,
    oldestOpenInvoiceDate, overdueBalance: overdueUnits / scale,
    ...(profile.ageing !== undefined ? { ageing: Object.fromEntries(Object.entries(ageing).map(([key, value]) => [key, value / scale])) } : {}),
    collectionRate: totalInvoiced > 0 ? Math.min(100, Math.round((collected + units) / totalInvoiced * 100)) : 100,
    lastPaymentDate: plan.payment.postingDate, lastLedgerActivityAt: plan.payment.createdAt,
    updatedAt: plan.payment.createdAt, updatedByUid: plan.payment.createdByUid,
  };
  tx.create(refs[1], { ...plan.payment, settlementFingerprint: fingerprint });
  plan.allocations.forEach((a, i) => tx.create(refs[2 + i], a));
  plan.projections.forEach((p, i) => {
    tx.update(refs[2 + n + i], { invoiceAppliedAmount: p.invoiceAppliedAmount, invoiceCreditedAmount: p.invoiceCreditedAmount, invoiceOpenAmount: p.invoiceOpenAmount, isOpen: p.isOpen, revision: p.expectedRevision + 1 });
    tx.update(refs[2 + n + plan.projections.length + i], { paidAmount: p.paidAmount, paidStatus: p.paidStatus });
  });
  tx.update(refs.at(-1)!, profileUpdate);
  tx.update(refs[0], { ...plan.collectionUpdate, verificationResult: {
    version: 1, expectedRevision: expectedCollectionRevision, paymentLedgerId: plan.payment.id,
    allocationIds: plan.allocations.map(a => a.id), settlementFingerprint: fingerprint,
    collectionFingerprint: collectionFingerprint(collection),
  } });
  tx.create(db.collection("auditLogs").doc(`VERIFIED_${paymentId}`), { action: "COLLECTION_VERIFIED", collectionId: paymentId, actorUid: plan.payment.createdByUid, createdAt: plan.payment.createdAt });
  return { posted: true };
}

type VerifiedPayment = { payment: Plan["payment"] & Record<string, any>; allocations: PaymentAllocationEvent[] };
async function loadVerifiedPayment(db: Firestore, tx: Transaction, collection: Record<string, any>): Promise<VerifiedPayment> {
  await readCompletedVerification(db, tx, collection, 1);
  const [payment, ...allocations] = await Promise.all([
    tx.get(db.doc(`customerLedgerEntries/${collection.ledgerEntryId}`)),
    ...collection.verificationResult.allocationIds.map((id: string) => tx.get(db.doc(`paymentAllocations/${id}`))),
  ]);
  return { payment: payment.data() as VerifiedPayment["payment"], allocations: allocations.map(a => a.data() as PaymentAllocationEvent) };
}
function reversalFingerprint(entry: Record<string, any>, allocations: PaymentAllocationEvent[]) {
  const { reversalResult, ...counter } = entry;
  return financialIdentityKey({ counter, allocations });
}
async function completedReversal(db: Firestore, tx: Transaction, collection: Record<string, any>, original: VerifiedPayment): Promise<CollectionReversalRecord | null> {
  const id = `REVERSE_${original.payment.id}`;
  const [entrySnap, auditSnap, ...allocationSnaps] = await Promise.all([
    tx.get(db.doc(`customerLedgerEntries/${id}`)),
    tx.get(db.doc(`auditLogs/REVERSED_${collection.id}`)),
    ...original.allocations.map(a => tx.get(db.doc(`paymentAllocations/REVERSE_${a.id}`))),
  ]);
  if (!entrySnap.exists) {
    if (auditSnap.exists || allocationSnaps.some(a => a.exists)) throw new Error("INCOMPLETE_REVERSAL");
    return null;
  }
  const entry = entrySnap.data()!, audit = auditSnap.data(), events = allocationSnaps.map(a => a.data() as PaymentAllocationEvent);
  const result = entry.reversalResult;
  try {
    assertFinancialIdentity(original.payment, entry as SettlementIdentity);
    if (!audit || events.some(a => !a) || result?.version !== 1 || result.expectedRevision !== 2
      || result.originalFingerprint !== financialIdentityKey(original)
      || entry.id !== id || entry.paymentId !== collection.id || entry.sourceId !== original.payment.sourceId
      || entry.sourceType !== original.payment.sourceType || entry.transactionType !== "REVERSAL" || entry.status !== "POSTED"
      || entry.isReversal !== true || entry.reversesEntryId !== original.payment.id || entry.debitAmount !== original.payment.creditAmount
      || entry.creditAmount !== 0 || entry.netAmount !== original.payment.creditAmount || entry.postingDate !== original.payment.postingDate
      || !documentId(entry.createdByUid) || !Number.isFinite(Date.parse(entry.createdAt))
      || typeof entry.reason !== "string" || !entry.reason.trim() || entry.reason !== entry.reason.trim() || entry.reason.length > 4000
      || audit.action !== "COLLECTION_REVERSED" || audit.collectionId !== collection.id || audit.ledgerEntryId !== id || audit.originalLedgerEntryId !== original.payment.id
      || audit.actorUid !== entry.createdByUid || audit.createdAt !== entry.createdAt || audit.reason !== entry.reason
      || audit.fingerprint !== result.fingerprint) throw new Error();
    events.forEach((event, i) => {
      const expected = { ...original.allocations[i], id: `REVERSE_${original.allocations[i].id}`,
        reversesAllocationId: original.allocations[i].id, operationId: id, actorUid: entry.createdByUid, createdAt: entry.createdAt };
      if (financialIdentityKey(event) !== financialIdentityKey(expected)) throw new Error();
    });
    if (reversalFingerprint(entry, events) !== result.fingerprint) throw new Error();
  } catch { throw new Error("INCOMPLETE_REVERSAL"); }
  return { collectionId: collection.id, ledgerEntryId: id, originalLedgerEntryId: original.payment.id,
    actorUid: entry.createdByUid, createdAt: entry.createdAt, reason: entry.reason };
}
/** Exact-document lookup for the UI; original collection and verification remain immutable. */
export async function readCollectionReversal(db: Firestore, tx: Transaction, collection: Record<string, any>) {
  return completedReversal(db, tx, collection, await loadVerifiedPayment(db, tx, collection));
}

/** Full reversal only. Subtract original allocations from CURRENT certified projections. */
export async function persistPaymentReversal(db: Firestore, tx: Transaction, collection: Record<string, any>, actorUid: string, reason: string, now: string) {
  if (!documentId(actorUid) || typeof reason !== "string" || !reason.trim() || reason !== reason.trim() || reason.length > 4000 || !Number.isFinite(Date.parse(now))) throw new Error("INVALID_PAYMENT_REVERSAL");
  const original = await loadVerifiedPayment(db, tx, collection);
  const prior = await completedReversal(db, tx, collection, original);
  if (prior) {
    if (prior.reason !== reason) throw new Error("REVERSAL_IDEMPOTENCY_CONFLICT");
    return { success: true as const, alreadyCompleted: true, reversal: prior };
  }
  const { payment, allocations } = original;
  const invoiceSnaps = await Promise.all(allocations.map(a => tx.get(db.doc(`customerLedgerEntries/${a.invoiceLedgerId}`))));
  const orderSnaps = await Promise.all(allocations.map(a => tx.get(db.doc(`orders/${a.orderId}`))));
  const current = invoiceSnaps.map((snap, i) => certifiedReceivable(allocations[i].invoiceLedgerId, snap.data() || {}, payment));
  const plan = calculatePaymentReversal(payment, allocations, current, `REVERSE_${payment.id}`, actorUid, now);
  if (plan.alreadyReversed) throw new Error("INCOMPLETE_REVERSAL");
  allocations.forEach((a, i) => {
    const order = orderSnaps[i].data();
    const primary = typeof order?.pharmacyId === "string" ? order.pharmacyId.trim() : "";
    const alias = typeof order?.pharmacy === "string" ? order.pharmacy.trim() : "";
    if (!order || (order.pharmacyId !== undefined && typeof order.pharmacyId !== "string")
      || (order.pharmacy !== undefined && typeof order.pharmacy !== "string") || (primary && alias && primary !== alias)
      || (primary || alias) !== payment.pharmacyId || order.marketId !== payment.marketId
      || (order.currencyCode === undefined && order.currency === undefined)
      || (order.currencyCode !== undefined && order.currencyCode !== payment.currencyCode)
      || (order.currency !== undefined && order.currency !== payment.currencyCode)
      || current[i].orderId !== a.orderId) throw new Error("STALE_RECEIVABLE");
  });
  const open = await readCertifiedOpenReceivables(db, tx, payment);
  const openSnaps = await Promise.all(open.map(row => tx.get(db.doc(`customerLedgerEntries/${row.id}`))));
  const profileRef = db.doc(`customerFinancialProfiles/${payment.pharmacyId}`);
  const profile = (await tx.get(profileRef)).data()!;
  assertCustomerCertification(payment.pharmacyId, profile, payment);
  const units = financialMinorUnits(payment.creditAmount, payment.decimalPlaces);
  const balance = financialMinorUnits(profile.outstandingBalance, payment.decimalPlaces);
  const collected = financialMinorUnits(profile.totalCollected, payment.decimalPlaces);
  const totalInvoiced = financialMinorUnits(profile.totalInvoiced, payment.decimalPlaces);
  const openUnits = open.reduce((sum, row) => sum + financialMinorUnits(settlementProjection(row.originalAmount, row.creditedAmount, row.appliedAmount, row.decimalPlaces).invoiceOpenAmount, row.decimalPlaces), 0);
  const reopened = current.filter((row, i) => !settlementProjection(row.originalAmount, row.creditedAmount, row.appliedAmount, row.decimalPlaces).isOpen && plan.projections[i].isOpen).length;
  if (!Number.isSafeInteger(openUnits) || openUnits !== balance || !Number.isSafeInteger(balance + units)
    || profile.openInvoiceCount !== open.length || !Number.isSafeInteger(profile.paidInvoiceCount)
    || profile.paidInvoiceCount < reopened || collected < units) throw new Error("FINANCIAL_PROFILE_RECONCILIATION_REQUIRED");
  // Current open set plus exact original targets is bounded by 160, including closed
  // invoices omitted by the open query. No ledger/history scan is needed.
  const all = new Map(open.map((row, i) => [row.id, { row, raw: openSnaps[i].data()! }]));
  current.forEach((row, i) => all.set(row.id, { row, raw: invoiceSnaps[i].data()! }));
  const values = [...all.values()];
  const { oldestOpenInvoiceDate, overdueUnits, ageing } = openInvoiceSummary(values.map(v => v.row), values.map(v => v.raw), plan.projections, now);
  const scale = 10 ** payment.decimalPlaces;
  const { settlementFingerprint: ignored, ...counter } = plan.counterEntry as typeof plan.counterEntry & { settlementFingerprint?: string };
  const entry = { ...counter, reason };
  const fingerprint = reversalFingerprint(entry, plan.allocations);
  const reversal: CollectionReversalRecord = { collectionId: collection.id, ledgerEntryId: entry.id,
    originalLedgerEntryId: payment.id, actorUid, createdAt: now, reason };
  tx.create(db.doc(`customerLedgerEntries/${entry.id}`), { ...entry, reversalResult: {
    version: 1, expectedRevision: 2, originalFingerprint: financialIdentityKey(original), fingerprint,
  } });
  plan.allocations.forEach(a => tx.create(db.doc(`paymentAllocations/${a.id}`), a));
  plan.projections.forEach(p => {
    tx.update(db.doc(`customerLedgerEntries/${p.invoiceLedgerId}`), {
      invoiceAppliedAmount: p.invoiceAppliedAmount, invoiceOpenAmount: p.invoiceOpenAmount,
      invoiceCreditedAmount: p.invoiceCreditedAmount, isOpen: p.isOpen, revision: p.revision,
    });
    tx.update(db.doc(`orders/${p.orderId}`), { paidAmount: p.paidAmount, paidStatus: p.paidStatus });
  });
  tx.update(profileRef, {
    outstandingBalance: (balance + units) / scale, totalCollected: (collected - units) / scale,
    openInvoiceCount: open.length + reopened, paidInvoiceCount: profile.paidInvoiceCount - reopened,
    oldestOpenInvoiceDate, overdueBalance: overdueUnits / scale,
    ...(profile.ageing !== undefined ? { ageing: Object.fromEntries(Object.entries(ageing).map(([key, value]) => [key, value / scale])) } : {}),
    collectionRate: totalInvoiced > 0 ? Math.min(100, Math.round((collected - units) / totalInvoiced * 100)) : 100,
    // lastPaymentDate remains the historical receipt date; a reversal is not a new payment.
    lastLedgerActivityAt: now, updatedAt: now, updatedByUid: actorUid,
  });
  tx.create(db.doc(`auditLogs/REVERSED_${collection.id}`), { action: "COLLECTION_REVERSED", ...reversal, fingerprint });
  return { success: true as const, alreadyCompleted: false, reversal };
}
