import { createFirestoreDeliveredInvoicePostingRepository } from "./deliveredInvoicePostingRepository";
import { describe, expect, it } from "vitest";
import { postDeliveredInvoiceServer, prepareDeliveredInvoicePosting } from "./deliveredInvoicePostingService";
import type { DeliveredInvoicePostingRepository } from "./deliveredInvoicePostingRepository";

const ACTOR_UID = "delivery-uid";
const ORDER_ID = "order-1";
const LEDGER_ID = "LEDGER_INVOICE_order-1_INV-LY-SO-1";
const MARKET = {
  id: "MARKET-A", marketId: "MARKET-A", countryId: "COUNTRY-A", countryNameEn: "Country A", countryNameAr: "بلد أ",
  active: true, currencyCode: "AAA", currencySymbol: "A", symbolPosition: "AFTER", decimalPlaces: 2,
  numeralLocale: "en", timezone: "Etc/UTC", dateFormat: "YYYY-MM-DD", timeFormat: "24H", weekStartDay: 0,
  workingWeekdays: [0, 1, 2, 3, 4], normalWorkdayStart: "08:00", normalWorkdayEnd: "16:00",
  checkInOpensAt: "07:30", lateToleranceMinutes: 15, autoCheckoutAt: "18:00", maximumWorkdayMinutes: 600,
};

function fixture(overrides: Record<string, any> = {}) {
  const state: Record<string, any> = {
    actor: { id: ACTOR_UID, uid: ACTOR_UID, role: "Delivery Officer", active: true, loginAllowed: true, name: "Driver" },
    order: {
      id: ORDER_ID, displayNumber: "LY-SO-1", status: "DELIVERED", stage: "CLOSED",
      deliveryOfficerUid: ACTOR_UID, pharmacyId: "pharmacy-1", total: 200, marketId: "MARKET-A", currency: "AAA", deliveredAt: "2026-08-13T10:00:00.000Z",
    },
    existingLedger: null,
    profile: { projectionSource: "customerLedgerEntries", projectionVersion: 1, pharmacyId: "pharmacy-1", marketId: "MARKET-A", currencyCode: "AAA", id: "pharmacy-1", customerAccountNumber: "ACC-1", paymentTermCode: "CASH", paymentTermDays: 0, outstandingBalance: 10, totalInvoiced: 10, openInvoiceCount: 1 },
    pharmacy: { id: "pharmacy-1", name: "Test Pharmacy" },
    market: MARKET,
    certificationEvidence: { ledger: [], collections: [], payments: [], visits: [], orders: [], legacyOrders: [] },
    ...overrides,
  };
  const writes: Array<{ ledger: Record<string, any>; profile: Record<string, any> }> = [];
  const repository: DeliveredInvoicePostingRepository = {
    async runTransaction(_actorUid, _orderId, operation) {
      return operation({
        ...state,
        ledgerId: LEDGER_ID,
        create(ledger, profile) {
          writes.push({ ledger, profile });
          state.existingLedger = ledger;
        },
      });
    },
  };
  return { repository, state, writes };
}

describe("DEF-WP76E-02 server-authoritative delivered invoice posting", () => {
  it("posts an authorized delivered invoice without changing the order", async () => {
    const f = fixture();
    const result = await postDeliveredInvoiceServer(ACTOR_UID, { orderId: ORDER_ID }, { repository: f.repository, now: () => "2026-08-13T12:00:00.000Z" });
    expect(result).toMatchObject({ success: true, posted: true, orderId: ORDER_ID, invoiceId: "INV-LY-SO-1", ledgerEntryId: LEDGER_ID });
    expect(f.writes[0].ledger).toMatchObject({ orderId: ORDER_ID, invoiceId: "INV-LY-SO-1", idempotencyKey: "DELIVERED_INVOICE_order-1_INV-LY-SO-1", debitAmount: 200 });
    expect(f.state.order).toMatchObject({ status: "DELIVERED", stage: "CLOSED" });
  });

  it("rejects an unassigned Delivery Officer", async () => {
    const f = fixture({ actor: { id: "other", role: "Delivery Officer", active: true, loginAllowed: true } });
    const result = await postDeliveredInvoiceServer("other", { orderId: ORDER_ID }, { repository: f.repository });
    expect(result).toMatchObject({ success: false, posted: false, code: "ACTOR_NOT_AUTHORIZED" });
    expect(f.writes).toHaveLength(0);
  });

  it("is idempotent when the deterministic ledger entry already exists", async () => {
    const f = fixture();
    await postDeliveredInvoiceServer(ACTOR_UID, { orderId: ORDER_ID }, { repository: f.repository });
    f.writes.length = 0;
    const result = await postDeliveredInvoiceServer(ACTOR_UID, { orderId: ORDER_ID }, { repository: f.repository });
    expect(result).toMatchObject({ success: true, posted: false, code: "ALREADY_POSTED", ledgerEntryId: LEDGER_ID });
    expect(f.writes).toHaveLength(0);
  });

  it("rejects posting before the canonical Delivered/Closed terminal pair", async () => {
    const f = fixture({ order: { id: ORDER_ID, status: "OUT_FOR_DELIVERY", stage: "DELIVERY", deliveryOfficerUid: ACTOR_UID } });
    const result = await postDeliveredInvoiceServer(ACTOR_UID, { orderId: ORDER_ID }, { repository: f.repository });
    expect(result).toMatchObject({ success: false, posted: false, code: "ORDER_NOT_DELIVERED" });
  });

  it("preserves canonical invoice identity and increments the existing profile once", async () => {
    const f = fixture();
    await postDeliveredInvoiceServer(ACTOR_UID, { orderId: ORDER_ID }, { repository: f.repository });
    expect(f.writes[0].ledger).toMatchObject({ id: LEDGER_ID, sourceType: "DELIVERED_ORDER", sourceId: ORDER_ID, invoiceNumber: "INV-LY-SO-1" });
    expect(f.writes[0].profile).toMatchObject({ outstandingBalance: 210, totalInvoiced: 210, openInvoiceCount: 2 });
  });

  it("fails closed when legacy records contain no resolvable financial identity", async () => {
    const f = fixture({
      order: { id: ORDER_ID, displayNumber: "SO-1", status: "DELIVERED", stage: "CLOSED", deliveryOfficerUid: ACTOR_UID, pharmacyId: "pharmacy-1", total: 200 },
      profile: { id: "pharmacy-1", customerAccountNumber: "ACC-1" },
      pharmacy: { id: "pharmacy-1", name: "Unknown Market Pharmacy" },
    });
    await expect(postDeliveredInvoiceServer(ACTOR_UID, { orderId: ORDER_ID }, { repository: f.repository }))
      .resolves.toMatchObject({ success: false, posted: false, code: "FINANCIAL_MARKET_CURRENCY_REQUIRED" });
    expect(f.writes).toHaveLength(0);
  });

  it("persists the explicit market and currency for new-format records", async () => {
    const f = fixture({
      order: { id: ORDER_ID, displayNumber: "JO-SO-1", status: "DELIVERED", stage: "CLOSED", deliveryOfficerUid: ACTOR_UID, pharmacyId: "pharmacy-1", total: 200, marketId: "MARKET-B", currencyCode: "BBB" },
      profile: null,
      pharmacy: { id: "pharmacy-1", name: "Arbitrary Pharmacy", marketId: "MARKET-B", countryId: "COUNTRY-B" },
      market: { ...MARKET, id: "MARKET-B", marketId: "MARKET-B", countryId: "COUNTRY-B", currencyCode: "BBB" },
    });
    await expect(postDeliveredInvoiceServer(ACTOR_UID, { orderId: ORDER_ID }, { repository: f.repository }))
      .resolves.toMatchObject({ success: true, posted: true });
    expect(f.writes[0].ledger).toMatchObject({ marketId: "MARKET-B", countryId: "COUNTRY-B", currency: "BBB", currencyCode: "BBB" });
    expect(f.writes[0].profile).toMatchObject({ marketId: "MARKET-B", countryId: "COUNTRY-B", currency: "BBB", currencyCode: "BBB" });
  });

  it("rejects a currency mismatch against the persisted market", async () => {
    const f = fixture({ order: { ...fixture().state.order, currencyCode: "BBB" } });
    await expect(postDeliveredInvoiceServer(ACTOR_UID, { orderId: ORDER_ID }, { repository: f.repository }))
      .resolves.toMatchObject({ success: false, posted: false, code: "FINANCIAL_MARKET_CURRENCY_REQUIRED" });
  });

  it("rejects an inactive persisted market without falling back to bundled defaults", async () => {
    const f = fixture({ market: { ...MARKET, active: false } });
    await expect(postDeliveredInvoiceServer(ACTOR_UID, { orderId: ORDER_ID }, { repository: f.repository }))
      .resolves.toMatchObject({ success: false, posted: false, code: "FINANCIAL_MARKET_CURRENCY_REQUIRED" });
  });

  it("rejects a missing or malformed persisted market", async () => {
    const missing = fixture({ market: null });
    const malformed = fixture({ market: { ...MARKET, currencyCode: "" } });
    await expect(postDeliveredInvoiceServer(ACTOR_UID, { orderId: ORDER_ID }, { repository: missing.repository }))
      .resolves.toMatchObject({ success: false, posted: false, code: "FINANCIAL_MARKET_CURRENCY_REQUIRED" });
    await expect(postDeliveredInvoiceServer(ACTOR_UID, { orderId: ORDER_ID }, { repository: malformed.repository }))
      .resolves.toMatchObject({ success: false, posted: false, code: "FINANCIAL_MARKET_CURRENCY_REQUIRED" });
  });
});


describe("transaction-injected delivered invoice reuse", () => {
  it("uses the injected transaction without nested ownership or product reads", async () => {
    const f = fixture();
    const records: Record<string, any> = {
      [`users/${ACTOR_UID}`]: f.state.actor, [`orders/${ORDER_ID}`]: f.state.order,
      "customerFinancialProfiles/pharmacy-1": f.state.profile,
      "pharmacies/pharmacy-1": f.state.pharmacy, "marketSettings/MARKET-A": f.state.market,
    };
    const reads: string[] = [], writes: any[] = [];
    const db: any = { collection: (c: string) => ({ doc: (id: string) => ({ path: `${c}/${id}` }) }), runTransaction: () => { throw new Error("NESTED_TRANSACTION"); } };
    const tx: any = {
      get: async (ref: any) => { reads.push(ref.path); return { id: ref.path.split("/")[1], exists: ref.path in records, data: () => records[ref.path] }; },
      create: (ref: any, value: any) => writes.push({ path: ref.path, value }), set: (ref: any, value: any) => writes.push({ path: ref.path, value }),
    };
    const repository = createFirestoreDeliveredInvoicePostingRepository({ db, transaction: tx });
    const result = await postDeliveredInvoiceServer(ACTOR_UID, { orderId: ORDER_ID }, { repository, now: () => "2026-08-13T12:00:00.000Z" });
    expect(result.success).toBe(true); expect(writes).toHaveLength(2);
    expect(reads.some(path => path.startsWith("products/"))).toBe(false);
    expect(writes[0].value.debitAmount).toBe(f.state.order.total);
  });
  it("preserves the commercial snapshot despite free physical lines", async () => {
    const f = fixture();
    f.state.order.items = [{ quantity: 20, price: 10, total: 200 }, { quantity: 10, price: 0, total: 0, lineKind: "PROMOTIONAL_FREE_LINE" }];
    await f.repository.runTransaction(ACTOR_UID, ORDER_ID, context => prepareDeliveredInvoicePosting(ACTOR_UID, context, () => "2026-08-13T12:00:00.000Z"));
    expect(f.writes[0].ledger.debitAmount).toBe(200);
    expect(f.state.order.items[1].price).toBe(0);
  });
});

const INIT = "FINANCIAL_PROJECTION_INITIALIZATION_REQUIRED";
const INSTANT = "2026-08-13T12:00:00.000Z";
function postingHarness(options: { profile?: any; pharmacy?: any; order?: any; evidence?: Record<string, string[]>; fail?: string; ledger?: any } = {}) {
  const base = fixture().state;
  const records: Record<string, any> = {
    [`users/${ACTOR_UID}`]: base.actor,
    [`orders/${ORDER_ID}`]: { ...base.order, ...options.order },
    "pharmacies/pharmacy-1": { ...base.pharmacy, ...options.pharmacy },
    "marketSettings/MARKET-A": MARKET,
  };
  if (options.profile) records["customerFinancialProfiles/pharmacy-1"] = options.profile;
  if (options.ledger) records[`customerLedgerEntries/${LEDGER_ID}`] = options.ledger;
  const queries: any[] = [], reads: string[] = [], writes: any[] = [];
  const db: any = {
    collection: (collection: string) => ({
      doc: (id: string) => ({ path: `${collection}/${id}` }),
      where: (field: string, operator: string, value: string) => ({
        limit: (limit: number) => ({ collection, field, operator, value, limit }),
      }),
    }),
    runTransaction: () => { throw new Error("NESTED_TRANSACTION"); },
  };
  const tx: any = {
    get: async (ref: any) => {
      if (writes.length) throw new Error("READ_AFTER_WRITE");
      if (ref.path) {
        reads.push(ref.path);
        return { id: ref.path.split("/")[1], exists: ref.path in records, data: () => records[ref.path] };
      }
      queries.push(ref);
      const key = `${ref.collection}:${ref.field}`;
      if (options.fail === key) throw new Error("QUERY_FAILED");
      return { docs: (options.evidence?.[key] || []).map(id => ({ id })) };
    },
    create: (ref: any, value: any) => writes.push({ path: ref.path, value }),
    set: (ref: any, value: any) => writes.push({ path: ref.path, value }),
  };
  const repository = createFirestoreDeliveredInvoicePostingRepository({ db, transaction: tx });
  return { reads, queries, writes, records, run: () => postDeliveredInvoiceServer(ACTOR_UID, { orderId: ORDER_ID }, { repository, now: () => INSTANT }) };
}
describe("certified receivable bootstrap", () => {
  it.each([undefined, 0])("certifies a preexisting Pharmacy with balance %s after exactly six bounded queries", async balance => {
    const f = postingHarness({ pharmacy: { createdAt: "1990-01-01", outstandingBalance: balance }, evidence: {
      "orders:pharmacyId": [ORDER_ID], "orders:pharmacy": [ORDER_ID],
    } });
    expect(await f.run()).toMatchObject({ success: true, posted: true });
    expect(f.queries.map(q => [q.collection, q.field, q.operator, q.value, q.limit])).toEqual([
      ["customerLedgerEntries", "pharmacyId", "==", "pharmacy-1", 1],
      ["paymentCollections", "pharmacyId", "==", "pharmacy-1", 1],
      ["payments", "pharmacyId", "==", "pharmacy-1", 1],
      ["pharmacyVisits", "pharmacyId", "==", "pharmacy-1", 1],
      ["orders", "pharmacyId", "==", "pharmacy-1", 2],
      ["orders", "pharmacy", "==", "pharmacy-1", 2],
    ]);
    expect(f.reads.filter(p => p === "pharmacies/pharmacy-1" || p === "customerFinancialProfiles/pharmacy-1")).toHaveLength(2);
    expect(f.writes).toHaveLength(2);
    expect(f.writes[0].value).toMatchObject({ id: LEDGER_ID, invoiceOriginalAmount: 200, invoiceAppliedAmount: 0,
      invoiceCreditedAmount: 0, invoiceOpenAmount: 200, isOpen: true, revision: 1, projectionVersion: 1,
      decimalPlaces: 2, createdAt: INSTANT });
    expect(f.writes[0].value).not.toHaveProperty("postingTimestamp");
    expect(f.writes[1].value).toMatchObject({ pharmacyId: "pharmacy-1", marketId: "MARKET-A", currencyCode: "AAA",
      projectionSource: "customerLedgerEntries", projectionVersion: 1, outstandingBalance: 200 });
  });
  it.each(["customerLedgerEntries:pharmacyId", "paymentCollections:pharmacyId", "payments:pharmacyId",
    "pharmacyVisits:pharmacyId", "orders:pharmacyId", "orders:pharmacy"])("blocks history in %s with zero writes", async key => {
    const f = postingHarness({ evidence: { [key]: key.startsWith("orders:") ? [ORDER_ID, "older-synthetic-order"] : ["history-synthetic"] } });
    await expect(f.run()).rejects.toThrow(INIT);
    expect(f.writes).toEqual([]);
  });
  it.each(["customerLedgerEntries:pharmacyId", "paymentCollections:pharmacyId", "payments:pharmacyId",
    "pharmacyVisits:pharmacyId", "orders:pharmacyId", "orders:pharmacy"])("fails closed on query error %s", async fail => {
    const f = postingHarness({ fail }); await expect(f.run()).rejects.toThrow(INIT); expect(f.writes).toEqual([]);
  });
  it.each([1, -1, "0", null, NaN, Infinity])("blocks ambiguous balance %s", async outstandingBalance => {
    const f = postingHarness({ pharmacy: { outstandingBalance } }); await expect(f.run()).rejects.toThrow(INIT); expect(f.writes).toEqual([]);
  });
  it("blocks an uncertified zero profile without bootstrap or writes", async () => {
    const f = postingHarness({ profile: { outstandingBalance: 0 } });
    await expect(f.run()).rejects.toThrow(INIT); expect(f.queries).toEqual([]); expect(f.writes).toEqual([]);
  });
  it("rejects conflicting Order Pharmacy aliases before writes", async () => {
    const f = postingHarness({ order: { pharmacy: "other-synthetic" } });
    await expect(f.run()).rejects.toThrow(INIT); expect(f.writes).toEqual([]);
  });
  it.each([{ marketId: "OTHER" }, { currencyCode: "BBB" }, { pharmacyId: "OTHER" }, { projectionVersion: 2 },
    { currency: "BBB" }, { projectionSource: "other" }])("rejects invalid certification %j", async patch => {
    const f = postingHarness({ profile: { ...fixture().state.profile, ...patch } });
    await expect(f.run()).rejects.toThrow(INIT); expect(f.writes).toEqual([]); expect(f.queries).toEqual([]);
  });
  it("takes certified fast path without bootstrap queries", async () => {
    const f = postingHarness({ profile: fixture().state.profile });
    expect(await f.run()).toMatchObject({ posted: true }); expect(f.queries).toEqual([]);
  });
  it("preserves applied/credited/open/revision and instant on retry", async () => {
    const created = postingHarness(); await created.run();
    const ledger = { ...created.writes[0].value, invoiceAppliedAmount: 50, invoiceCreditedAmount: 20, invoiceOpenAmount: 130, revision: 3 };
    const before = structuredClone(ledger);
    const f = postingHarness({ profile: fixture().state.profile, ledger });
    expect(await f.run()).toMatchObject({ posted: false, code: "ALREADY_POSTED" });
    expect(ledger).toEqual(before); expect(f.writes).toEqual([]); expect(f.queries).toEqual([]);
  });
  it("does not upgrade a legacy deterministic invoice", async () => {
    const f = postingHarness({ profile: fixture().state.profile, ledger: { id: LEDGER_ID, orderId: ORDER_ID } });
    await expect(f.run()).rejects.toThrow(INIT); expect(f.writes).toEqual([]);
  });
  it.each([NaN, Infinity, -1, 1.001, "200"])("rejects invalid Order money %s with zero writes", async total => {
    const f = postingHarness({ order: { total } });
    const outcome = await f.run().then(result => result.success, () => false);
    expect(outcome).toBe(false);
    expect(f.writes).toEqual([]);
  });
});

describe("certification failure completeness", () => {
  it("rejects a missing exact Pharmacy document without writes", async () => {
    const f = postingHarness(); delete f.records["pharmacies/pharmacy-1"];
    await expect(f.run()).rejects.toThrow(INIT); expect(f.writes).toEqual([]);
  });
  it.each([{ countryId: "OTHER" }, { country: "Unknown country" }, { currency: "BBB" }])("rejects redundant Pharmacy identity conflict %j", async pharmacy => {
    const f = postingHarness({ pharmacy }); await expect(f.run()).rejects.toThrow(INIT); expect(f.writes).toEqual([]);
  });
  it("rejects an impossible over-limit query response before writes", async () => {
    const f = postingHarness({ evidence: { "orders:pharmacyId": [ORDER_ID, ORDER_ID, ORDER_ID] } });
    await expect(f.run()).rejects.toThrow(INIT); expect(f.writes).toEqual([]);
  });
  it("rejects noncanonical posting time without writes", async () => {
    const f = fixture();
    await expect(postDeliveredInvoiceServer(ACTOR_UID, { orderId: ORDER_ID }, { repository: f.repository, now: () => "2026-01-01" })).rejects.toThrow("INVALID_POSTING_INSTANT");
    expect(f.writes).toEqual([]);
  });
  it("rejects changed financial snapshot on deterministic retry", async () => {
    const f = fixture(); await postDeliveredInvoiceServer(ACTOR_UID, { orderId: ORDER_ID }, { repository: f.repository });
    f.writes.length = 0; f.state.order.total = 201;
    await expect(postDeliveredInvoiceServer(ACTOR_UID, { orderId: ORDER_ID }, { repository: f.repository })).rejects.toThrow(INIT);
    expect(f.writes).toEqual([]);
  });
});
