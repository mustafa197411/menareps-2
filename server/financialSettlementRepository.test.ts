import { describe, expect, it, vi } from "vitest";
import { FieldPath, type Firestore, type Transaction } from "firebase-admin/firestore";
import { readCertifiedOpenReceivables } from "./financialSettlementRepository";
import { certifiedReceivable } from "./financialSettlementService";

const identity = { pharmacyId: "PHARMACY-SYNTHETIC", marketId: "MARKET-SYNTHETIC", currencyCode: "TST", decimalPlaces: 2 };
const initialization = "FINANCIAL_PROJECTION_INITIALIZATION_REQUIRED";
function invoice(id = "INVOICE-SYNTHETIC", patch: Record<string, unknown> = {}) {
  return { ...identity, id, orderId: `ORDER-${id}`, transactionType: "INVOICE", sourceType: "DELIVERED_ORDER",
    status: "POSTED", projectionVersion: 1, revision: 1, createdAt: "2001-01-01T00:00:00.000Z",
    invoiceOriginalAmount: 100, invoiceAppliedAmount: 0, invoiceCreditedAmount: 0, invoiceOpenAmount: 100,
    isOpen: true, ...patch };
}
function fixture(rows = [invoice()]) {
  const records: Record<string, Record<string, unknown> | undefined> = {
    [`pharmacies/${identity.pharmacyId}`]: { id: identity.pharmacyId },
    [`customerFinancialProfiles/${identity.pharmacyId}`]: { ...identity, projectionSource: "customerLedgerEntries", projectionVersion: 1 },
  };
  const forbidden = () => { throw new Error("UNAUTHORIZED_IO"); };
  const query = {
    where: vi.fn().mockReturnThis(), orderBy: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
    startAfter: vi.fn(forbidden), offset: vi.fn(forbidden), get: vi.fn(forbidden),
  };
  const db = { doc: vi.fn((path: string) => ({ path, get: forbidden })), collection: vi.fn(() => query), runTransaction: vi.fn(forbidden) };
  const tx = {
    get: vi.fn(async (ref: unknown) => {
      if (ref === query) return { docs: rows.map(raw => ({ id: raw.id, data: () => raw })) };
      const path = (ref as { path: string }).path;
      return { id: path.split("/")[1], exists: records[path] !== undefined, data: () => records[path] };
    }),
    create: vi.fn(forbidden), set: vi.fn(forbidden), update: vi.fn(forbidden), delete: vi.fn(forbidden),
  };
  const read = (binding = identity) => readCertifiedOpenReceivables(db as unknown as Firestore, tx as unknown as Transaction, binding);
  const noWrites = () => {
    for (const method of [tx.create, tx.set, tx.update, tx.delete, db.runTransaction, query.get, query.startAfter, query.offset]) expect(method).not.toHaveBeenCalled();
  };
  return { rows, records, query, db, tx, read, noWrites };
}

describe("transaction-owned certified FIFO reader", () => {
  it("binds exact Pharmacy/profile paths and uses only the supplied transaction", async () => {
    const f = fixture(); await f.read();
    expect(f.db.doc.mock.calls).toEqual([[`pharmacies/${identity.pharmacyId}`], [`customerFinancialProfiles/${identity.pharmacyId}`]]);
    expect(f.tx.get).toHaveBeenCalledTimes(3);
    expect(f.tx.get.mock.calls[2][0]).toBe(f.query);
    f.noWrites();
  });
  it("issues exactly the bounded FIFO query, without pagination or fallback", async () => {
    const f = fixture(); await f.read();
    expect(f.db.collection.mock.calls).toEqual([["customerLedgerEntries"]]);
    expect(f.query.where.mock.calls).toEqual([["pharmacyId", "==", identity.pharmacyId], ["isOpen", "==", true]]);
    expect(f.query.orderBy.mock.calls).toEqual([["createdAt", "asc"], [FieldPath.documentId(), "asc"]]);
    expect(f.query.limit.mock.calls).toEqual([[81]]);
    f.noWrites();
  });
  it.each([0, 1, 80])("returns a complete validated set of %i rows", async count => {
    const rows = Array.from({ length: count }, (_, i) => invoice(`INVOICE-SYNTHETIC-${String(i).padStart(3, "0")}`));
    const f = fixture(rows);
    expect(await f.read()).toEqual(rows.map(row => certifiedReceivable(row.id, row, identity)));
    f.noWrites();
  });
  it("rejects the 81st sentinel rather than returning a partial set", async () => {
    const f = fixture(Array.from({ length: 81 }, (_, i) => invoice(`INVOICE-SYNTHETIC-${i}`)));
    await expect(f.read()).rejects.toThrow("FINANCIAL_RECEIVABLE_SET_CAPACITY_EXCEEDED");
    expect(f.tx.get).toHaveBeenCalledTimes(3); expect(f.query.limit).toHaveBeenCalledExactlyOnceWith(81); f.noWrites();
  });
  it("preserves Firestore timestamp ordering and canonical document-ID ties", async () => {
    // Supplied in the order Firestore guarantees for the asserted orderBy clauses.
    const rows = [invoice("Z", { createdAt: "2000-01-01T00:00:00.000Z" }), invoice("A"), invoice("B")];
    const f = fixture(rows);
    expect((await f.read()).map(row => row.id)).toEqual(["Z", "A", "B"]);
    expect(f.query.orderBy.mock.calls).toEqual([["createdAt", "asc"], [FieldPath.documentId(), "asc"]]);
  });
  it.each(["1900-01-01", "2999-01-01", undefined])("never excludes due date %s or old debt", async dueDate => {
    const f = fixture([invoice("OLD-SYNTHETIC", { dueDate, createdAt: "1900-01-01T00:00:00.000Z" })]);
    expect(await f.read()).toHaveLength(1);
    expect(f.query.where).toHaveBeenCalledTimes(2);
  });
  it.each([
    { createdAt: undefined }, { createdAt: "invalid" }, { createdAt: "2001-01-01" },
    { createdAt: "2001-01-01T01:00:00.000+01:00" },
    { pharmacyId: "OTHER-SYNTHETIC" }, { marketId: "OTHER-MARKET-SYNTHETIC" },
    { currencyCode: "BAD" }, { currency: "BAD" }, { decimalPlaces: 3 }, { decimalPlaces: 7 },
    { revision: 0 }, { revision: 1.5 }, { revision: undefined }, { projectionVersion: 2 }, { projectionVersion: undefined },
    { transactionType: "PAYMENT" }, { sourceType: "OTHER" }, { status: "VOID" },
    { invoiceOriginalAmount: undefined }, { invoiceAppliedAmount: undefined }, { invoiceCreditedAmount: undefined },
    { invoiceOpenAmount: undefined }, { invoiceOpenAmount: 99 }, { invoiceOriginalAmount: Infinity },
    { invoiceAppliedAmount: -1 }, { invoiceCreditedAmount: 101 }, { invoiceAppliedAmount: 101 },
    { invoiceOriginalAmount: 100.001 }, { isOpen: undefined }, { isOpen: false }, { orderId: undefined },
  ])("fails closed without filtering malformed receivable %j", async patch => {
    const f = fixture([invoice("VALID-SYNTHETIC"), invoice("INVALID-SYNTHETIC", patch)]);
    await expect(f.read()).rejects.toThrow(initialization); f.noWrites();
  });
  it("rejects a persisted ledger ID that differs from the document ID", async () => {
    const f = fixture();
    f.tx.get.mockImplementationOnce(async () => ({ id: identity.pharmacyId, exists: true, data: () => ({}) }))
      .mockImplementationOnce(async () => ({ id: identity.pharmacyId, exists: true, data: () => f.records[`customerFinancialProfiles/${identity.pharmacyId}`] }))
      .mockImplementationOnce(async () => ({ docs: [{ id: "OTHER-SYNTHETIC", data: () => invoice() }] }));
    await expect(f.read()).rejects.toThrow(initialization); f.noWrites();
  });
  it.each([
    { projectionSource: undefined }, { projectionSource: "pharmacies" }, { projectionVersion: 2 },
    { pharmacyId: "OTHER-SYNTHETIC" }, { marketId: "OTHER-SYNTHETIC" }, { currencyCode: "BAD" }, { currency: "BAD" },
  ])("requires matching certified profile %j even for an empty ledger", async patch => {
    const f = fixture([]); Object.assign(f.records[`customerFinancialProfiles/${identity.pharmacyId}`]!, patch);
    await expect(f.read()).rejects.toThrow(initialization); expect(f.db.collection).not.toHaveBeenCalled(); f.noWrites();
  });
  it.each(["pharmacies", "customerFinancialProfiles"])("rejects missing %s without bootstrap", async collection => {
    const f = fixture(); delete f.records[`${collection}/${identity.pharmacyId}`];
    await expect(f.read()).rejects.toThrow(initialization); expect(f.db.collection).not.toHaveBeenCalled(); f.noWrites();
  });
  it("rejects conflicting persisted Pharmacy identity", async () => {
    const f = fixture(); f.records[`pharmacies/${identity.pharmacyId}`] = { id: "OTHER-SYNTHETIC" };
    await expect(f.read()).rejects.toThrow(initialization); f.noWrites();
  });
  it.each(["", " ", " PHARMACY-SYNTHETIC", "parent/child", ".", ".."]) ("rejects noncanonical Pharmacy path %j before reads", async pharmacyId => {
    const f = fixture(); await expect(f.read({ ...identity, pharmacyId })).rejects.toThrow();
    expect(f.tx.get).not.toHaveBeenCalled(); f.noWrites();
  });
  it.each([-1, 1.5, 7, NaN])("validates supplied precision %s even with zero rows", async decimalPlaces => {
    const f = fixture([]); await expect(f.read({ ...identity, decimalPlaces })).rejects.toThrow(Number.isNaN(decimalPlaces) ? "FINANCIAL_IDENTITY_MISMATCH" : "INVALID_FINANCIAL_AMOUNT");
    expect(f.tx.get).not.toHaveBeenCalled(); f.noWrites();
  });
  it.each([0, 1, 2])("propagates transaction read failure %i without fallback or writes", async failure => {
    const f = fixture(); const original = f.tx.get.getMockImplementation()!; let calls = 0;
    f.tx.get.mockImplementation(async ref => { if (calls++ === failure) throw new Error("SYNTHETIC_READ_FAILURE"); return original(ref); });
    await expect(f.read()).rejects.toThrow("SYNTHETIC_READ_FAILURE");
    expect(f.tx.get.mock.calls.length).toBeLessThanOrEqual(3); f.noWrites();
  });
});
