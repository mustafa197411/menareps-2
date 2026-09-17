import { describe, it, expect } from "vitest";
import { prepareCollectionSubmission } from "./collectionService";
const identity = { pharmacyId: "CUSTOMER-SYNTHETIC", marketId: "MARKET-SYNTHETIC", currencyCode: "TST", decimalPlaces: 2 };
const row: any = { ...identity, id: "INVOICE-SYNTHETIC", orderId: "ORDER-SYNTHETIC", postingTimestamp: "1999-01-01T00:00:00Z", dueDate: "1999-01-02", status: "POSTED", transactionType: "INVOICE", sourceType: "DELIVERED_ORDER", originalAmount: 100, creditedAmount: 0, appliedAmount: 0, revision: 1 };
const context: any = { ...identity, actorUid: "ACTOR-SYNTHETIC", scope: { authorized: true, queryPlan: { denyAll: false }, role: "Sales Representative", areaIds: ["AREA-SYNTHETIC"], subjectUids: ["ACTOR-SYNTHETIC"] }, pharmacy: { id: identity.pharmacyId, areaId: "AREA-SYNTHETIC", active: true, status: "Active" }, restrictions: {}, now: "2026-01-01T00:00:00Z", receivables: [row] };
const input = { requestKey: "REQUEST-SYNTHETIC", amount: 100, method: "Cash", reference: "RECEIPT-SYNTHETIC", collectionDate: "2026-01-01" };
describe("Submitted collection preparation", () => {
  it("accepts exact debt, old overdue receivable, without settlement", () => {
    const result = prepareCollectionSubmission(input, context);
    expect(result).toMatchObject({ status: "Submitted", amount: 100, revision: 1 });
    expect(result).not.toHaveProperty("paidAmount"); expect(result).not.toHaveProperty("ledgerEntryId");
  });
  it.each([0, -1, NaN, Infinity, "10", 0.001, 101])("rejects invalid/overpaid amount %s", amount => expect(() => prepareCollectionSubmission({ ...input, amount }, context)).toThrow());
  it("rejects no receivable", () => expect(() => prepareCollectionSubmission(input, { ...context, receivables: [] })).toThrow("NO_OPEN_RECEIVABLE"));
  it.each(["pharmacyId", "marketId", "currencyCode"])("rejects forged %s", key => expect(() => prepareCollectionSubmission({ ...input, [key]: "FORGED" }, context)).toThrow("FINANCIAL_IDENTITY_MISMATCH"));
  it("rejects scope mismatch", () => expect(() => prepareCollectionSubmission(input, { ...context, pharmacy: { ...context.pharmacy, areaId: "OTHER" } })).toThrow("COLLECTION_SCOPE_DENIED"));
  it("restricts persisted authority", () => expect(() => prepareCollectionSubmission(input, { ...context, restrictions: { create: false } })).toThrow());
  it("rejects inactive pharmacy", () => expect(() => prepareCollectionSubmission(input, { ...context, pharmacy: { ...context.pharmacy, active: false } })).toThrow());
  it("rejects client verification state", () => expect(() => prepareCollectionSubmission({ ...input, status: "Verified" }, context)).toThrow("FORGED_COLLECTION_FIELD"));
  it("returns identical logical identity on retry and detects material payload changes", () => {
    const a = prepareCollectionSubmission(input, context), b = prepareCollectionSubmission(input, { ...context, now: "2026-01-02" });
    expect(a.id).toBe(b.id); expect(a.payloadHash).toBe(b.payloadHash);
    expect(prepareCollectionSubmission({ ...input, amount: 90 }, context).payloadHash).not.toBe(a.payloadHash);
  });
  it("different request keys remain distinct despite matching source keys", () => expect(prepareCollectionSubmission({ ...input, sourceKey: "VISIT-SYNTHETIC" }, context).id).not.toBe(prepareCollectionSubmission({ ...input, requestKey: "RETRY", sourceKey: "VISIT-SYNTHETIC" }, context).id));
  it("validates cheque and method evidence", () => {
    expect(() => prepareCollectionSubmission({ ...input, method: "Cheque" }, context)).toThrow();
    expect(() => prepareCollectionSubmission({ ...input, method: "UNKNOWN" }, context)).toThrow();
    expect(() => prepareCollectionSubmission({ ...input, reference: "" }, context)).toThrow();
  });
});

it("requires bank identity for transfers and retains method evidence", () => {
  expect(() => prepareCollectionSubmission({ ...input, method: "Bank Transfer" }, context)).toThrow();
  expect(prepareCollectionSubmission({ ...input, method: "Bank Transfer", transferBank: "BANK-SYNTHETIC", evidence: ["EVIDENCE-SYNTHETIC"] }, context)).toMatchObject({ transferBank: "BANK-SYNTHETIC", evidence: ["EVIDENCE-SYNTHETIC"] });
});
it("accepts supported market precision without silently rounding", () => {
  expect(prepareCollectionSubmission({ ...input, amount: 0.001 }, { ...context, decimalPlaces: 3, receivables: [{ ...row, decimalPlaces: 3 }] }).amount).toBe(0.001);
});

it.each([undefined, "SOURCE-A", "SOURCE-B"])("source %s never changes actor/request document identity", sourceKey => {
  const original = prepareCollectionSubmission(input, context);
  const changed = prepareCollectionSubmission({ ...input, ...(sourceKey === undefined ? {} : { sourceKey }) }, context);
  expect(changed.id).toBe(original.id);
  expect(changed.payloadHash === original.payloadHash).toBe(sourceKey === undefined);
});
it.each([null, "", "   "])("does not silently treat source %s as absent", sourceKey => {
  expect(() => prepareCollectionSubmission({ ...input, sourceKey }, context)).toThrow("INVALID_COLLECTION_REQUEST");
});

it.each([undefined, "", "   "])("normalizes empty notes %s to absence", notes => {
  const result = prepareCollectionSubmission({ ...input, notes }, context);
  expect(result).not.toHaveProperty("notes");
  expect(result.payloadHash).toBe(prepareCollectionSubmission(input, context).payloadHash);
});
it.each([null, 12, "x".repeat(4001)])("rejects invalid notes", notes => expect(() => prepareCollectionSubmission({ ...input, notes }, context)).toThrow("INVALID_COLLECTION_NOTES"));
it("fingerprints normalized notes and server Area without ownership aliases", () => {
  const result = prepareCollectionSubmission({ ...input, notes: "  A  B\nC  " }, context);
  expect(result).toMatchObject({ notes: "A  B\nC", areaId: "AREA-SYNTHETIC", actorUid: context.actorUid });
  for (const key of ["representativeUid", "salesRepUid", "createdByUid", "repId", "userId"]) expect(result).not.toHaveProperty(key);
  expect(prepareCollectionSubmission({ ...input, notes: "A  B\nC" }, context).payloadHash).toBe(result.payloadHash);
  expect(prepareCollectionSubmission({ ...input, notes: "Different" }, context).payloadHash).not.toBe(result.payloadHash);
});
it.each(["areaId", "actorUid", "representativeUid", "role"])("rejects browser authority %s", key => expect(() => prepareCollectionSubmission({ ...input, [key]: "FORGED" }, context)).toThrow("FORGED_COLLECTION_FIELD"));
it("accepts exactly 4000 notes characters", () => expect(prepareCollectionSubmission({ ...input, notes: "x".repeat(4000) }, context).notes).toHaveLength(4000));
