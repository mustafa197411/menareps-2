import { prepareDeliveredInvoicePosting } from "./deliveredInvoicePostingService";
import { describe, it, expect } from "vitest";
import { collectionSubmissionId, prepareCollectionSubmission } from "./collectionService";
import { createSubmittedCollection } from "./collectionRepository";
import { persistVerification } from "./financialSettlementRepository";
import { prepareVerification, certifiedReceivable } from "./financialSettlementService";
const identity = { pharmacyId: "CUSTOMER-SYNTHETIC", marketId: "MARKET-SYNTHETIC", currencyCode: "TST", decimalPlaces: 2 };
const command: any = { ...identity, id: collectionSubmissionId("REP-SYNTHETIC", "REQUEST-SYNTHETIC"), requestKey: "REQUEST-SYNTHETIC", method: "Cash", reference: "RECEIPT-SYNTHETIC", evidence: [], amount: 100, actorUid: "REP-SYNTHETIC", payloadHash: "HASH-SYNTHETIC", status: "Submitted", revision: 1, collectionDate: "2026-01-01", createdAt: "2026-01-01" };
function fixture() {
  const records: Record<string, any> = {};
  const writes: string[] = [];
  let writing = false;
  const ref = (path: string) => ({ path });
  const query: any = { where: () => query, orderBy: () => query, limit: () => query };
  const db: any = { doc: ref, collection: (name: string) => name === "customerLedgerEntries" ? query : ({ doc: (id: string) => ref(`${name}/${id}`) }) };
  const tx: any = {
    get: async (r: any) => { if (writing) throw new Error("READ_AFTER_WRITE"); if (r === query) return { docs: Object.entries(records).filter(([path, row]) => path.startsWith("customerLedgerEntries/") && row.isOpen === true).map(([path, row]) => ({ id: path.split("/")[1], data: () => row })) }; return { id: r.path.split("/")[1], exists: r.path in records, data: () => records[r.path] }; },
    create: (r: any, data: any) => { writing = true; if (r.path in records) throw new Error("ALREADY_EXISTS"); records[r.path] = structuredClone(data); writes.push(r.path); },
    update: (r: any, data: any) => { writing = true; records[r.path] = { ...records[r.path], ...structuredClone(data) }; writes.push(r.path); },
  };
  return { db, tx, records, writes, next: () => { writing = false; } };
}
describe("injected exact-document financial repositories", () => {
  it("creates one collection on retry and rejects changed payload", async () => {
    const f = fixture();
    expect((await createSubmittedCollection(f.db, f.tx, command)).created).toBe(true);
    f.next(); expect((await createSubmittedCollection(f.db, f.tx, command)).created).toBe(false);
    expect(f.writes).toHaveLength(2);
    await expect(createSubmittedCollection(f.db, f.tx, { ...command, payloadHash: "CHANGED" })).rejects.toThrow("COLLECTION_IDEMPOTENCY_CONFLICT");
    expect(f.writes).toHaveLength(2);
  });
  function verificationFixture() {
    const f = fixture();
    const row: any = { ...identity, id: "INVOICE-SYNTHETIC", orderId: "ORDER-SYNTHETIC", postingTimestamp: "2000-01-01", originalAmount: 100, creditedAmount: 0, appliedAmount: 0, revision: 1, status: "POSTED", transactionType: "INVOICE", sourceType: "DELIVERED_ORDER" };
    const plan = prepareVerification(command, [row], { ...identity, actorUid: "FINANCE-SYNTHETIC", role: "Finance Officer", scopeAuthorized: true, restrictions: {}, operationId: "VERIFY-SYNTHETIC", now: "2026-01-01" });
    f.records[`pharmacies/${identity.pharmacyId}`] = { id: identity.pharmacyId };
    f.records[`paymentCollections/${command.id}`] = command;
    f.records[`customerLedgerEntries/${row.id}`] = { ...row, invoiceOriginalAmount: 100, invoiceAppliedAmount: 0, invoiceCreditedAmount: 0, invoiceOpenAmount: 100, isOpen: true, projectionVersion: 1, createdAt: "2000-01-01T00:00:00.000Z" };
    f.records[`orders/${row.orderId}`] = { ...identity };
    f.records[`customerFinancialProfiles/${identity.pharmacyId}`] = { ...identity, projectionSource: "customerLedgerEntries", projectionVersion: 1, outstandingBalance: 100, totalCollected: 0, totalInvoiced: 100, openInvoiceCount: 1, paidInvoiceCount: 0 };
    return { ...f, row, plan };
  }
  it("posts payment, allocations, order and profile once with all reads before writes", async () => {
    const f = verificationFixture();
    expect(await persistVerification(f.db, f.tx, f.plan, 1)).toEqual({ posted: true });
    expect(f.records[`orders/${f.row.orderId}`]).toMatchObject({ paidAmount: 100, paidStatus: "Paid" });
    expect(f.records[`customerFinancialProfiles/${identity.pharmacyId}`].outstandingBalance).toBe(0);
    const count = f.writes.length;
    f.next(); expect(await persistVerification(f.db, f.tx, f.plan, 1)).toEqual({ posted: false });
    expect(f.writes).toHaveLength(count);
  });
  it("rejects changed verification under the same payment identity", async () => {
    const f = verificationFixture(); await persistVerification(f.db, f.tx, f.plan, 1); f.next();
    await expect(persistVerification(f.db, f.tx, { ...f.plan, payment: { ...f.plan.payment, creditAmount: 99 } }, 1)).rejects.toThrow("VERIFICATION_IDEMPOTENCY_CONFLICT");
  });
  it("rejects stale invoice before any writes", async () => {
    const f = verificationFixture(); f.records[`customerLedgerEntries/${f.row.id}`].revision = 2;
    await expect(persistVerification(f.db, f.tx, f.plan, 1)).rejects.toThrow("STALE_RECEIVABLE"); expect(f.writes).toHaveLength(0);
  });
  it("does not silently initialize a legacy profile", async () => {
    const f = verificationFixture(); delete f.records[`customerFinancialProfiles/${identity.pharmacyId}`].projectionSource;
    await expect(persistVerification(f.db, f.tx, f.plan, 1)).rejects.toThrow("FINANCIAL_PROFILE_RECONCILIATION_REQUIRED"); expect(f.writes).toHaveLength(0);
  });
  it("rejects existing allocation conflict before writes", async () => {
    const f = verificationFixture(); f.records[`paymentAllocations/${f.plan.allocations[0].id}`] = {};
    await expect(persistVerification(f.db, f.tx, f.plan, 1)).rejects.toThrow("ALLOCATION_CONFLICT"); expect(f.writes).toHaveLength(0);
  });
  it.each([{ projectionVersion: undefined }, { invoiceCreditedAmount: undefined }, { createdAt: undefined },
    { invoiceOpenAmount: 99 }, { isOpen: false }, { decimalPlaces: 7 }])("rejects malformed invoice before writes %j", patch => {
    const f = verificationFixture();
    Object.assign(f.records[`customerLedgerEntries/${f.row.id}`], patch);
    return expect(persistVerification(f.db, f.tx, f.plan, 1)).rejects.toThrow("FINANCIAL_PROJECTION_INITIALIZATION_REQUIRED").then(() => expect(f.writes).toEqual([]));
  });
  it("progressively settles with independent payments, increments revisions and rejects stale plans", async () => {
    const f = verificationFixture();
    const firstCollection = { ...command, amount: 30 };
    f.records[`paymentCollections/${command.id}`] = firstCollection;
    const ctx = { ...identity, actorUid: "FINANCE-SYNTHETIC", role: "Finance Officer", scopeAuthorized: true, restrictions: {}, operationId: "VERIFY-SYNTHETIC", now: "2026-01-01" };
    const first = prepareVerification(firstCollection, [f.row], ctx);
    await persistVerification(f.db, f.tx, first, 1);
    expect(f.records[`customerLedgerEntries/${f.row.id}`]).toMatchObject({ invoiceAppliedAmount: 30, invoiceOpenAmount: 70, invoiceCreditedAmount: 0, isOpen: true, revision: 2 });
    const nextCollection = { ...command, id: "PAY-SECOND-SYNTHETIC", amount: 70 };
    f.records[`paymentCollections/${nextCollection.id}`] = nextCollection;
    f.next();
    const stale = prepareVerification(nextCollection, [f.row], ctx);
    const writeCount = f.writes.length;
    await expect(persistVerification(f.db, f.tx, stale, 1)).rejects.toThrow("STALE_RECEIVABLE");
    expect(f.writes).toHaveLength(writeCount);
    const freshRow = certifiedReceivable(f.row.id, f.records[`customerLedgerEntries/${f.row.id}`], identity);
    const fresh = prepareVerification(nextCollection, [freshRow], ctx);
    await persistVerification(f.db, f.tx, fresh, 1);
    expect(f.records[`customerLedgerEntries/${f.row.id}`]).toMatchObject({ invoiceAppliedAmount: 100, invoiceOpenAmount: 0, isOpen: false, revision: 3 });
    expect(f.records[`orders/${f.row.orderId}`]).toMatchObject({ paidAmount: 100, paidStatus: "Paid" });
  });
  it("rejects a conflicting profile cache without overwriting it", async () => {
    const f = verificationFixture();
    f.records[`customerFinancialProfiles/${identity.pharmacyId}`].outstandingBalance = 0;
    await expect(persistVerification(f.db, f.tx, f.plan, 1)).rejects.toThrow();
    expect(f.writes).toEqual([]);
  });

  it("settles the actual invoice writer output for an unchanged alias-only Order", async () => {
    const f = verificationFixture();
    const order = { id: f.row.orderId, pharmacy: identity.pharmacyId, currency: identity.currencyCode,
      marketId: identity.marketId, total: 100, status: "DELIVERED", stage: "CLOSED", deliveryOfficerUid: "DELIVERY-SYNTHETIC" };
    const profile = { ...identity, id: identity.pharmacyId, projectionSource: "customerLedgerEntries", projectionVersion: 1,
      customerAccountNumber: "ACCOUNT-SYNTHETIC", outstandingBalance: 0, totalInvoiced: 0, openInvoiceCount: 0, paidInvoiceCount: 0, totalCollected: 0 };
    const market = { id: identity.marketId, marketId: identity.marketId, countryId: "COUNTRY-SYNTHETIC",
      countryNameEn: "Synthetic", countryNameAr: "Synthetic", active: true, currencyCode: identity.currencyCode,
      currencySymbol: "T", symbolPosition: "AFTER", decimalPlaces: identity.decimalPlaces, numeralLocale: "en",
      timezone: "Etc/UTC", dateFormat: "YYYY-MM-DD", timeFormat: "24H", weekStartDay: 0, workingWeekdays: [0, 1, 2, 3, 4],
      normalWorkdayStart: "08:00", normalWorkdayEnd: "16:00", checkInOpensAt: "07:30", lateToleranceMinutes: 15,
      autoCheckoutAt: "18:00", maximumWorkdayMinutes: 600 };
    const result = prepareDeliveredInvoicePosting("DELIVERY-SYNTHETIC", {
      actor: { id: "DELIVERY-SYNTHETIC", role: "Delivery Officer", active: true, loginAllowed: true },
      order, pharmacy: { id: identity.pharmacyId }, profile, market, existingLedger: null, ledgerId: f.row.id,
      create: (ledger, update) => {
        f.records[`customerLedgerEntries/${f.row.id}`] = ledger;
        f.records[`customerFinancialProfiles/${identity.pharmacyId}`] = { ...profile, ...update };
      },
    }, () => "2026-01-01T00:00:00.000Z");
    expect(result).toMatchObject({ posted: true });
    f.records[`orders/${f.row.orderId}`] = structuredClone(order);
    const canonical = certifiedReceivable(f.row.id, f.records[`customerLedgerEntries/${f.row.id}`], identity);
    const plan = prepareVerification(command, [canonical], { ...identity, actorUid: "FINANCE-SYNTHETIC", role: "Finance Officer",
      scopeAuthorized: true, restrictions: {}, operationId: "VERIFY-SYNTHETIC", now: "2026-01-02T00:00:00.000Z" });
    expect(await persistVerification(f.db, f.tx, plan, 1)).toEqual({ posted: true });
    expect(f.records[`orders/${f.row.orderId}`]).toEqual({ ...order, paidAmount: 100, paidStatus: "Paid" });
    expect(order).not.toHaveProperty("pharmacyId");
    expect(order).not.toHaveProperty("currencyCode");
  });

  it.each([
    { pharmacyId: identity.pharmacyId, currencyCode: identity.currencyCode },
    { pharmacy: identity.pharmacyId, currencyCode: identity.currencyCode },
    { pharmacyId: identity.pharmacyId, currency: identity.currencyCode },
    { pharmacy: identity.pharmacyId, currency: identity.currencyCode },
    { pharmacyId: identity.pharmacyId, pharmacy: identity.pharmacyId, currencyCode: identity.currencyCode },
    { pharmacyId: " " + identity.pharmacyId + " ", pharmacy: identity.pharmacyId, currencyCode: identity.currencyCode },
    { pharmacyId: identity.pharmacyId, currencyCode: identity.currencyCode, currency: identity.currencyCode },
  ])("settles a writer-compatible Order identity %j", async representation => {
    const f = verificationFixture();
    f.records[`orders/${f.row.orderId}`] = { ...representation, marketId: identity.marketId, total: 100, status: "DELIVERED", stage: "CLOSED" };
    const before = structuredClone(f.records[`orders/${f.row.orderId}`]);
    expect(await persistVerification(f.db, f.tx, f.plan, 1)).toEqual({ posted: true });
    expect(f.records[`orders/${f.row.orderId}`]).toEqual({ ...before, paidAmount: 100, paidStatus: "Paid" });
  });
  it.each([
    { pharmacy: "OTHER" },
    { currency: "BAD" },
    { pharmacyId: undefined, pharmacy: "OTHER" },
    { currencyCode: undefined, currency: "BAD" },
    { marketId: "OTHER" },
    { pharmacyId: undefined, pharmacy: undefined },
    { currencyCode: undefined, currency: undefined },
    { currency: null },
  ])("rejects conflicting/missing Order identity before writes %j", async patch => {
    const f = verificationFixture();
    Object.assign(f.records[`orders/${f.row.orderId}`], patch);
    await expect(persistVerification(f.db, f.tx, f.plan, 1)).rejects.toThrow("STALE_RECEIVABLE");
    expect(f.writes).toEqual([]);
  });

});

describe("immutable actor/request submission binding", () => {
  const row: any = { ...identity, id: "INVOICE-SYNTHETIC", orderId: "ORDER-SYNTHETIC", postingTimestamp: "2000-01-01T00:00:00.000Z",
    originalAmount: 100, appliedAmount: 0, creditedAmount: 0, revision: 1, status: "POSTED", transactionType: "INVOICE", sourceType: "DELIVERED_ORDER" };
  const context: any = { ...identity, actorUid: "REP-SYNTHETIC", scope: { authorized: true, queryPlan: { denyAll: false }, role: "Sales Representative",
    areaIds: ["AREA-SYNTHETIC"], subjectUids: ["REP-SYNTHETIC"] }, pharmacy: { id: identity.pharmacyId, areaId: "AREA-SYNTHETIC", active: true, status: "Active" },
    restrictions: {}, now: "2026-01-01T00:00:00.000Z", receivables: [row] };
  const input = { requestKey: "REQUEST-SYNTHETIC", amount: 50, method: "Cash", reference: "RECEIPT-SYNTHETIC", collectionDate: "2026-01-01" };
  it.each([
    ["added", undefined, "SOURCE-A"],
    ["removed", "SOURCE-A", undefined],
    ["replaced", "SOURCE-A", "SOURCE-B"],
  ])("source %s conflicts at the same exact collection document", async (_label, beforeSource, afterSource) => {
    const f = fixture();
    const before = prepareCollectionSubmission({ ...input, ...(beforeSource === undefined ? {} : { sourceKey: beforeSource }) }, context);
    const after = prepareCollectionSubmission({ ...input, ...(afterSource === undefined ? {} : { sourceKey: afterSource }) }, context);
    expect(before.id).toBe(after.id);
    expect(before.payloadHash).not.toBe(after.payloadHash);
    await createSubmittedCollection(f.db, f.tx, before); f.next();
    await expect(createSubmittedCollection(f.db, f.tx, after)).rejects.toThrow("COLLECTION_IDEMPOTENCY_CONFLICT");
    expect(f.writes).toEqual([`paymentCollections/${before.id}`, `auditLogs/SUBMITTED_${before.id}`]);
    expect(Object.keys(f.records).filter(path => path.startsWith("paymentCollections/"))).toHaveLength(1);
  });
  it.each(["amount", "pharmacyId", "marketId", "currencyCode", "method", "evidence"])("changed %s conflicts under the same request", async key => {
    const f = fixture();
    const original = prepareCollectionSubmission(input, context);
    let changedInput: any = { ...input };
    let changedContext = context;
    if (["pharmacyId", "marketId", "currencyCode"].includes(key)) {
      const value = key === "currencyCode" ? "ZZZ" : "OTHER-SYNTHETIC";
      changedContext = { ...context, [key]: value, pharmacy: { ...context.pharmacy, ...(key === "pharmacyId" ? { id: value } : {}) },
        receivables: [{ ...row, [key]: value }] };
    } else changedInput[key] = key === "amount" ? 40 : key === "method" ? "Other" : ["EVIDENCE-SYNTHETIC"];
    const changed = prepareCollectionSubmission(changedInput, changedContext);
    expect(changed.id).toBe(original.id); expect(changed.payloadHash).not.toBe(original.payloadHash);
    await createSubmittedCollection(f.db, f.tx, original); f.next();
    await expect(createSubmittedCollection(f.db, f.tx, changed)).rejects.toThrow("COLLECTION_IDEMPOTENCY_CONFLICT");
    expect(f.writes).toHaveLength(2);
  });
  it("exact retry uses only document reads and creates no duplicate writes", async () => {
    const f = fixture();
    const first = prepareCollectionSubmission({ ...input, sourceKey: "SOURCE-A" }, context);
    const retry = prepareCollectionSubmission({ ...input, sourceKey: "SOURCE-A" }, { ...context, now: "2026-01-02T00:00:00.000Z" });
    await createSubmittedCollection(f.db, f.tx, first); f.next();
    expect(await createSubmittedCollection(f.db, f.tx, retry)).toMatchObject({ created: false, collection: first });
    expect(f.writes).toHaveLength(2);
    // Fixture exposes doc/get only: a query or scan cannot satisfy this test.
  });
  it("different request keys have distinct deterministic documents", async () => {
    const f = fixture();
    const first = prepareCollectionSubmission(input, context);
    const second = prepareCollectionSubmission({ ...input, requestKey: "SECOND-REQUEST" }, context);
    expect(first.id).not.toBe(second.id);
    await createSubmittedCollection(f.db, f.tx, first); f.next();
    expect(await createSubmittedCollection(f.db, f.tx, second)).toMatchObject({ created: true });
  });
  it("repository rejects an ID that bypasses its actor/request binding", async () => {
    const f = fixture();
    const prepared = prepareCollectionSubmission(input, context);
    await expect(createSubmittedCollection(f.db, f.tx, { ...prepared, id: "FORGED-SYNTHETIC" })).rejects.toThrow("INVALID_COLLECTION_COMMAND");
    expect(f.writes).toEqual([]);
  });
});

it("persists notes and rejects a different notes fingerprint on replay", async () => {
  const f = fixture();
  const first = { ...command, areaId: "AREA-SYNTHETIC", notes: "First note", payloadHash: "FIRST-NOTES-HASH" };
  await createSubmittedCollection(f.db, f.tx, first); f.next();
  expect((await createSubmittedCollection(f.db, f.tx, first)).created).toBe(false);
  expect(f.records[`paymentCollections/${first.id}`].notes).toBe("First note");
  await expect(createSubmittedCollection(f.db, f.tx, { ...first, notes: "Different note", payloadHash: "OTHER-NOTES-HASH" })).rejects.toThrow("COLLECTION_IDEMPOTENCY_CONFLICT");
  expect(f.writes).toHaveLength(2);
});
