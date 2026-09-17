import { describe, it, expect } from "vitest";
import { allocateOldestFirst, prepareVerification, calculatePaymentReversal, certifiedReceivable } from "./financialSettlementService";
import { settlementProjection } from "../src/features/ar/arResolvers";
const identity = { pharmacyId: "CUSTOMER-SYNTHETIC", marketId: "MARKET-SYNTHETIC", currencyCode: "TST", decimalPlaces: 2 };
const row = (id: string, amount: number, date: string): any => ({ ...identity, id, orderId: `ORDER-${id}`, originalAmount: amount, creditedAmount: 0, appliedAmount: 0, revision: 1, postingTimestamp: date, dueDate: "1900-01-01", status: "POSTED", transactionType: "INVOICE", sourceType: "DELIVERED_ORDER" });
const rows = [row("A", 300, "1999-01-01"), row("B", 400, "2000-01-01"), row("C", 500, "2001-01-01")];
const collection: any = { ...identity, id: "PAY-SYNTHETIC", method: "Cash", reference: "RECEIPT-SYNTHETIC", evidence: [], amount: 1000, status: "Submitted", revision: 1, collectionDate: "2026-01-01" };
const context = { ...identity, actorUid: "FINANCE-SYNTHETIC", role: "Finance Officer", restrictions: {}, scopeAuthorized: true, now: "2026-01-01T00:00:00Z", operationId: "OP-SYNTHETIC" };
describe("FIFO and verified settlement", () => {
  it("allocates A300 B400 C500 as 300/400/300", () => {
    const plan = allocateOldestFirst(identity, 1000, [...rows].reverse());
    expect(plan.map(p => p.amount)).toEqual([300, 400, 300]);
    expect(plan.map(p => p.projection.invoiceOpenAmount)).toEqual([0, 0, 200]);
  });
  it.each([[100, [100]], [500, [300, 200]], [1200, [300, 400, 500]]])("allocates %s exactly", (amount, expected) => expect(allocateOldestFirst(identity, amount as number, rows).map(p => p.amount)).toEqual(expected));
  it("rejects excess", () => expect(() => allocateOldestFirst(identity, 1201, rows)).toThrow("COLLECTION_OVERPAYMENT"));
  it("uses document ID for equal timestamps", () => expect(allocateOldestFirst(identity, 10, [row("Z", 30, "2000-01-01"), row("A", 30, "2000-01-01")])[0].receivable.id).toBe("A"));
  it("ignores reversed due dates and invoice age", () => expect(allocateOldestFirst(identity, 10, [{ ...rows[0], dueDate: "2099-01-01" }, rows[1]])[0].receivable.id).toBe("A"));
  it.each(["pharmacyId", "marketId", "currencyCode"])("rejects crossing %s", key => expect(() => allocateOldestFirst(identity, 10, [{ ...rows[0], [key]: "OTHER" }])).toThrow());
  it("ignores fully credited, settled and void obligations", () => expect(() => allocateOldestFirst(identity, 1, [{ ...rows[0], creditedAmount: 300 }, { ...rows[1], appliedAmount: 400 }, { ...rows[2], status: "VOID" }])).toThrow("NO_OPEN_RECEIVABLE"));
  it.each([[0, "Unpaid"], [10, "Partially Paid"], [100, "Paid"]])("projects applied %s", (amount, status) => expect(settlementProjection(100, 0, amount as number, 2).paidStatus).toBe(status));
  it("does not fabricate cash for a credit", () => expect(settlementProjection(100, 100, 0, 2)).toMatchObject({ paidStatus: "Unpaid", paidAmount: 0, financiallyClosed: true }));
  it("rejects over-allocation", () => expect(() => settlementProjection(100, 0, 101, 2)).toThrow());
  it("supports progressive verified payments", () => {
    const first = allocateOldestFirst(identity, 100, rows);
    const second = allocateOldestFirst(identity, 200, [{ ...rows[0], appliedAmount: first[0].projection.paidAmount }]);
    expect(second[0].projection.paidStatus).toBe("Paid");
  });
  it("requires approval and Submitted state", () => {
    expect(() => prepareVerification(collection, rows, { ...context, role: "Sales Representative" })).toThrow();
    expect(() => prepareVerification(collection, rows, { ...context, restrictions: { approve: false } })).toThrow();
    expect(() => prepareVerification({ ...collection, status: "Verified" }, rows, context)).toThrow();
  });
  it("builds deterministic credit and allocation identities without mutation", () => {
    const before = structuredClone(rows);
    const a = prepareVerification(collection, rows, context), b = prepareVerification(collection, rows, context);
    expect(a).toEqual(b); expect(a.payment.id).toBe("LEDGER_PAYMENT_PAY-SYNTHETIC");
    expect(a.allocations).toHaveLength(3); expect(rows).toEqual(before);
  });
  it("reverses linked allocations, retains originals and blocks independent second reversal", () => {
    const plan = prepareVerification(collection, rows, context);
    const settled = rows.map((r, i) => ({ ...r, appliedAmount: plan.projections[i].invoiceAppliedAmount }));
    const before = structuredClone(plan);
    const reversed = calculatePaymentReversal(plan.payment, plan.allocations, settled, "REV-SYNTHETIC", context.actorUid, context.now);
    expect(reversed.alreadyReversed).toBe(false);
    if (reversed.alreadyReversed) throw new Error("Expected reversal");
    expect(reversed.counterEntry.reversesEntryId).toBe(plan.payment.id);
    expect(reversed.projections.map(p => p.invoiceOpenAmount)).toEqual([300, 400, 500]);
    expect(reversed.projections.every(p => p.paidAmount === 0)).toBe(true);
    expect(plan).toEqual(before);
    expect(calculatePaymentReversal(plan.payment, plan.allocations, settled, "REV-SYNTHETIC", context.actorUid, context.now, reversed)).toEqual({ alreadyReversed: true });
    expect(() => calculatePaymentReversal(plan.payment, plan.allocations, settled, "ANOTHER", context.actorUid, context.now, reversed)).toThrow("PAYMENT_ALREADY_REVERSED");
    expect(() => calculatePaymentReversal(plan.payment, [{ ...plan.allocations[0], amount: 2000 }], settled, "REV", context.actorUid, context.now)).toThrow();
  });
});

describe("strict persisted certified invoice adapter", () => {
  const persisted = () => ({ ...identity, id: "INVOICE-SYNTHETIC", orderId: "ORDER-SYNTHETIC",
    projectionVersion: 1, revision: 1, createdAt: "2000-01-01T00:00:00.000Z",
    invoiceOriginalAmount: 500, invoiceAppliedAmount: 0, invoiceCreditedAmount: 0,
    invoiceOpenAmount: 500, isOpen: true, status: "POSTED", transactionType: "INVOICE", sourceType: "DELIVERED_ORDER" });
  it("maps immutable createdAt and ignores due date for FIFO", () => {
    const raw = { ...persisted(), dueDate: "1900-01-01" };
    const before = structuredClone(raw);
    expect(certifiedReceivable(raw.id, raw, identity)).toMatchObject({ postingTimestamp: raw.createdAt, originalAmount: 500, revision: 1 });
    expect(raw).toEqual(before);
  });
  it.each([
    { projectionVersion: undefined }, { revision: undefined }, { revision: 0 }, { revision: 1.5 },
    { createdAt: undefined }, { createdAt: "2000-01-01" }, { createdAt: "bad" },
    { decimalPlaces: undefined }, { decimalPlaces: 7 }, { decimalPlaces: 1.5 },
    { invoiceOriginalAmount: NaN }, { invoiceOriginalAmount: Infinity }, { invoiceOriginalAmount: -1 },
    { invoiceCreditedAmount: 501 }, { invoiceAppliedAmount: 501 }, { invoiceOpenAmount: 400 },
    { invoiceAppliedAmount: 0.001 }, { invoiceCreditedAmount: undefined }, { isOpen: false },
    { invoiceOpenAmount: undefined }, { marketId: "OTHER" }, { currencyCode: "BAD" }, { pharmacyId: "OTHER" },
    { status: "VOID" }, { transactionType: "PAYMENT" }, { sourceType: "OTHER" },
  ])("rejects uninitialized/inconsistent persisted state %j", patch => {
    const raw = { ...persisted(), ...patch };
    expect(() => certifiedReceivable(raw.id, raw, identity)).toThrow("FINANCIAL_PROJECTION_INITIALIZATION_REQUIRED");
  });
  it("accepts partial, settled and fully credited projections without fabricating cash", () => {
    for (const [credited, applied] of [[0, 300], [0, 500], [500, 0]]) {
      const projection = settlementProjection(500, credited, applied, 2);
      const raw = { ...persisted(), ...projection };
      expect(certifiedReceivable(raw.id, raw, identity)).toMatchObject({ creditedAmount: credited, appliedAmount: applied });
      expect(projection.isOpen).toBe(credited + applied < 500);
      if (credited === 500) expect(projection.paidStatus).toBe("Unpaid");
    }
  });
  it("reversal restores open state and advances expected revision without altering originals", () => {
    const r = certifiedReceivable("INVOICE-SYNTHETIC", persisted(), identity);
    const plan = prepareVerification({ ...collection, amount: 300 }, [r], context);
    const settled = { ...r, appliedAmount: 300, revision: 2 };
    const original = structuredClone(settled);
    const result = calculatePaymentReversal(plan.payment, plan.allocations, [settled], "REV-SYNTHETIC", context.actorUid, context.now);
    expect(result.alreadyReversed).toBe(false);
    if (result.alreadyReversed) throw new Error("unexpected retry");
    expect(result.projections[0]).toMatchObject({ invoiceAppliedAmount: 0, invoiceOpenAmount: 500, isOpen: true, expectedRevision: 2, revision: 3 });
    expect(settled).toEqual(original);
  });
});
