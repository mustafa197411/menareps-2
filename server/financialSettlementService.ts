import { createHash } from "node:crypto";
import type { CanonicalReceivable, PaymentAllocationEvent, SettlementIdentity, SubmittedCollection } from "../src/features/ar/arTypes";
import { financialMinorUnits, settlementProjection } from "../src/features/ar/arResolvers";
import { permitsCollection, type CollectionRestrictions } from "../src/lib/collectionPermissions";
import { getCapabilitiesForRole } from "../src/features/orders/orderWorkflowEngine";

export function financialIdentityKey(value: unknown): string {
  const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => [k, canonical(v[k])])) : v;
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}
export function assertFinancialIdentity(a: SettlementIdentity, b: SettlementIdentity): void {
  if (!a.pharmacyId || !a.marketId || !/^[A-Z]{3}$/.test(a.currencyCode) || a.pharmacyId !== b.pharmacyId || a.marketId !== b.marketId || a.currencyCode !== b.currencyCode || a.decimalPlaces !== b.decimalPlaces) throw new Error("FINANCIAL_IDENTITY_MISMATCH");
}
export function eligibleReceivables(identity: SettlementIdentity, rows: readonly CanonicalReceivable[]) {
  assertFinancialIdentity(identity, identity);
  const ids = new Set<string>();
  return rows.map(row => {
    assertFinancialIdentity(identity, row);
    if (!row.id || row.id.includes("/") || ids.has(row.id) || !row.orderId || !Number.isSafeInteger(row.revision) || row.revision < 1 || row.revision >= Number.MAX_SAFE_INTEGER || !Number.isFinite(Date.parse(row.postingTimestamp))) throw new Error("INVALID_RECEIVABLE");
    ids.add(row.id);
    if (row.transactionType !== "INVOICE" || row.sourceType !== "DELIVERED_ORDER") throw new Error("INVALID_RECEIVABLE");
    const projection = settlementProjection(row.originalAmount, row.creditedAmount, row.appliedAmount, identity.decimalPlaces);
    return { ...row, ...projection };
  }).filter(row => row.status === "POSTED" && row.invoiceOpenAmount > 0)
    .sort((a, b) => Date.parse(a.postingTimestamp) - Date.parse(b.postingTimestamp) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
export function allocateOldestFirst(identity: SettlementIdentity, amount: number, rows: readonly CanonicalReceivable[]) {
  let remaining = financialMinorUnits(amount, identity.decimalPlaces);
  if (remaining <= 0) throw new Error("INVALID_COLLECTION_AMOUNT");
  const eligible = eligibleReceivables(identity, rows);
  const total = eligible.reduce((sum, row) => sum + financialMinorUnits(row.invoiceOpenAmount, identity.decimalPlaces), 0);
  if (!Number.isSafeInteger(total)) throw new Error("INVALID_FINANCIAL_AMOUNT");
  if (!total) throw new Error("NO_OPEN_RECEIVABLE");
  if (remaining > total) throw new Error("COLLECTION_OVERPAYMENT");
  const allocations: Array<{ receivable: CanonicalReceivable; amount: number; projection: ReturnType<typeof settlementProjection> }> = [];
  for (const row of eligible) {
    if (!remaining) break;
    const units = Math.min(remaining, financialMinorUnits(row.invoiceOpenAmount, identity.decimalPlaces));
    remaining -= units;
    const applied = (financialMinorUnits(row.appliedAmount, identity.decimalPlaces) + units) / 10 ** identity.decimalPlaces;
    allocations.push({ receivable: row, amount: units / 10 ** identity.decimalPlaces, projection: settlementProjection(row.originalAmount, row.creditedAmount, applied, identity.decimalPlaces) });
  }
  return allocations;
}
export interface VerificationContext extends SettlementIdentity {
  actorUid: string; role: string; restrictions: CollectionRestrictions; scopeAuthorized: boolean;
  now: string; operationId: string;
}
export function prepareVerification(collection: SubmittedCollection, rows: readonly CanonicalReceivable[], context: VerificationContext) {
  if (!context.actorUid || !context.scopeAuthorized || !permitsCollection(context.role, "approve", context.restrictions) || !getCapabilitiesForRole(context.role).includes("ORDER_FINANCE_APPROVE")) throw new Error("COLLECTION_APPROVAL_DENIED");
  assertFinancialIdentity(collection, context);
  if (collection.status !== "Submitted" || collection.revision !== 1 || !collection.id || collection.id.includes("/") || !context.operationId || !Number.isFinite(Date.parse(context.now))) throw new Error("COLLECTION_STATE_INVALID");
  if (!["Cash", "Cheque", "Bank Transfer", "Other"].includes(collection.method) || !collection.reference?.trim() || !Array.isArray(collection.evidence) || !Number.isFinite(Date.parse(collection.collectionDate))) throw new Error("INVALID_COLLECTION_EVIDENCE");
  if (collection.method === "Cheque" && (!collection.chequeBank?.trim() || !collection.chequeDate || !Number.isFinite(Date.parse(collection.chequeDate)))) throw new Error("INVALID_COLLECTION_EVIDENCE");
  if (collection.method === "Bank Transfer" && !collection.transferBank?.trim()) throw new Error("INVALID_COLLECTION_EVIDENCE");
  const plan = allocateOldestFirst(context, collection.amount, rows);
  const paymentLedgerId = `LEDGER_PAYMENT_${collection.id}`;
  const allocations: PaymentAllocationEvent[] = plan.map((item, index) => ({
    pharmacyId: context.pharmacyId, marketId: context.marketId, currencyCode: context.currencyCode, decimalPlaces: context.decimalPlaces,
    id: `ALLOC_${financialIdentityKey([paymentLedgerId, item.receivable.id])}`, collectionId: collection.id, paymentLedgerId,
    invoiceLedgerId: item.receivable.id, orderId: item.receivable.orderId, amount: item.amount, sequence: index + 1,
    operationId: context.operationId, actorUid: context.actorUid, createdAt: context.now,
  }));
  const payment = { id: paymentLedgerId, pharmacyId: context.pharmacyId, marketId: context.marketId, currencyCode: context.currencyCode,
    decimalPlaces: context.decimalPlaces, paymentId: collection.id, transactionType: "PAYMENT", sourceType: "PAYMENT_COLLECTION",
    sourceId: collection.id, debitAmount: 0, creditAmount: collection.amount, netAmount: -collection.amount,
    postingDate: collection.collectionDate, createdAt: context.now, createdByUid: context.actorUid, status: "POSTED", isReversal: false, reversesEntryId: null };
  return { payment, allocations, projections: plan.map(item => ({ invoiceLedgerId: item.receivable.id, orderId: item.receivable.orderId, expectedRevision: item.receivable.revision, revision: item.receivable.revision + 1, ...item.projection })),
    collectionUpdate: { status: "Verified", revision: 2, verifiedAt: context.now, verifiedByUid: context.actorUid, ledgerEntryId: paymentLedgerId } };
}
/** Pure only. No runtime reversal authorization or write command is exported. */
export function calculatePaymentReversal(payment: ReturnType<typeof prepareVerification>["payment"], allocations: readonly PaymentAllocationEvent[], rows: readonly CanonicalReceivable[], operationId: string, actorUid: string, now: string, prior?: { operationId: string; fingerprint: string }) {
  if (!operationId || !actorUid || !Number.isFinite(Date.parse(now)) || payment.transactionType !== "PAYMENT" || payment.status !== "POSTED" || payment.debitAmount !== 0) throw new Error("INVALID_PAYMENT_REVERSAL");
  const fingerprint = financialIdentityKey({ payment, allocations });
  if (prior) {
    if (prior.operationId !== operationId || prior.fingerprint !== fingerprint) throw new Error("PAYMENT_ALREADY_REVERSED");
    return { alreadyReversed: true as const };
  }
  const byId = new Map(rows.map(row => [row.id, row]));
  if (byId.size !== rows.length || new Set(allocations.map(a => a.id)).size !== allocations.length) throw new Error("INVALID_PAYMENT_REVERSAL");
  const restored = new Map<string, CanonicalReceivable>();
  let sum = 0;
  const reversals = allocations.map(a => {
    assertFinancialIdentity(payment, a);
    if (a.paymentLedgerId !== payment.id || a.collectionId !== payment.paymentId || a.reversesAllocationId) throw new Error("INVALID_PAYMENT_REVERSAL");
    const row = restored.get(a.invoiceLedgerId) || byId.get(a.invoiceLedgerId);
    if (!row || !Number.isSafeInteger(row.revision) || row.revision < 1 || row.revision >= Number.MAX_SAFE_INTEGER || row.orderId !== a.orderId) throw new Error("INVALID_PAYMENT_REVERSAL");
    assertFinancialIdentity(payment, row);
    settlementProjection(row.originalAmount, row.creditedAmount, row.appliedAmount, row.decimalPlaces);
    const units = financialMinorUnits(a.amount, payment.decimalPlaces);
    if (!units) throw new Error("INVALID_PAYMENT_REVERSAL");
    sum += units;
    const remaining = financialMinorUnits(row.appliedAmount, payment.decimalPlaces) - units;
    if (remaining < 0) throw new Error("INVALID_PAYMENT_REVERSAL");
    restored.set(row.id, { ...row, appliedAmount: remaining / 10 ** payment.decimalPlaces });
    return { ...a, id: `REVERSE_${a.id}`, reversesAllocationId: a.id, operationId, actorUid, createdAt: now };
  });
  if (sum <= 0 || sum !== financialMinorUnits(payment.creditAmount, payment.decimalPlaces)) throw new Error("INVALID_PAYMENT_REVERSAL");
  return { alreadyReversed: false as const, fingerprint, operationId,
    counterEntry: { ...payment, id: `REVERSE_${payment.id}`, transactionType: "REVERSAL", debitAmount: payment.creditAmount, creditAmount: 0, netAmount: payment.creditAmount, isReversal: true, reversesEntryId: payment.id, createdAt: now, createdByUid: actorUid },
    allocations: reversals, projections: [...restored.values()].map(row => ({ invoiceLedgerId: row.id, orderId: row.orderId, expectedRevision: row.revision, revision: row.revision + 1, ...settlementProjection(row.originalAmount, row.creditedAmount, row.appliedAmount, row.decimalPlaces) })) };
}

/** Strict adapter: persisted legacy values must never be inferred or normalized. */
export function certifiedReceivable(id: string, raw: Record<string, any>, identity: SettlementIdentity): CanonicalReceivable {
  try {
    assertFinancialIdentity(identity, raw as SettlementIdentity);
    if (!id || id.includes("/") || raw.id !== id || !raw.orderId || raw.orderId.includes("/")
      || raw.projectionVersion !== 1 || !Number.isSafeInteger(raw.revision) || raw.revision < 1
      || raw.revision >= Number.MAX_SAFE_INTEGER
      || !isCanonicalPostingInstant(raw.createdAt)
      || raw.status !== "POSTED" || raw.transactionType !== "INVOICE" || raw.sourceType !== "DELIVERED_ORDER"
      || (raw.currency !== undefined && raw.currency !== identity.currencyCode)) throw new Error("INVALID");
    const projection = settlementProjection(raw.invoiceOriginalAmount, raw.invoiceCreditedAmount, raw.invoiceAppliedAmount, raw.decimalPlaces);
    if (financialMinorUnits(raw.invoiceOpenAmount, raw.decimalPlaces) !== financialMinorUnits(projection.invoiceOpenAmount, raw.decimalPlaces)
      || raw.isOpen !== projection.isOpen) throw new Error("INVALID");
    return { ...identity, id, orderId: raw.orderId, postingTimestamp: raw.createdAt,
      dueDate: raw.dueDate, status: raw.status, transactionType: raw.transactionType, sourceType: raw.sourceType,
      originalAmount: raw.invoiceOriginalAmount, appliedAmount: raw.invoiceAppliedAmount,
      creditedAmount: raw.invoiceCreditedAmount, revision: raw.revision };
  } catch {
    throw new Error("FINANCIAL_PROJECTION_INITIALIZATION_REQUIRED");
  }
}
export function isCanonicalPostingInstant(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
export function assertCustomerCertification(id: string, profile: Record<string, any>, identity: Omit<SettlementIdentity, "decimalPlaces">) {
  if (id !== identity.pharmacyId || profile.pharmacyId !== id
    || profile.projectionSource !== "customerLedgerEntries" || profile.projectionVersion !== 1
    || profile.marketId !== identity.marketId || profile.currencyCode !== identity.currencyCode
    || (profile.currency !== undefined && profile.currency !== identity.currencyCode)) {
    throw new Error("FINANCIAL_PROJECTION_INITIALIZATION_REQUIRED");
  }
}
