import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { executeAtomicCommercialDeliveryCompletion, executeCommercialOrderTransition, parseCommercialOrderTransition } from "./commercialOrderTransitionService";
import { ENTERPRISE_WORKFLOW_TEMPLATE } from "../src/features/orders/orderWorkflowTemplate";
import { deterministicReservationId } from "./inventoryReservationService";

const scope = vi.hoisted(() => ({ authorized: true, queryPlan: { denyAll: false }, areaIds: ["AREA-SYNTHETIC"], role: "Delivery Officer" }));
vi.mock("./operationalScopeRepository", () => ({
  createFirestoreOperationalScopeRepository: vi.fn(), resolveOperationalScopeForActor: vi.fn(async () => scope),
}));

const actorId = "DELIVERY-SYNTHETIC", orderId = "ORDER-SYNTHETIC", pharmacyId = "PHARMACY-SYNTHETIC";
const orderPath = `orders/${orderId}`, profilePath = `customerFinancialProfiles/${pharmacyId}`;
const ledgerPath = `customerLedgerEntries/LEDGER_INVOICE_${orderId}_INVOICE-SYNTHETIC`;
const now = "2026-01-02T12:00:00.000Z";
const market = {
  marketId: "MARKET-SYNTHETIC", countryId: "COUNTRY-SYNTHETIC", countryNameEn: "Synthetic Country", countryNameAr: "بلد",
  active: true, currencyCode: "TST", currencySymbol: "T", symbolPosition: "AFTER", decimalPlaces: 2,
  numeralLocale: "en", timezone: "Etc/UTC", dateFormat: "YYYY-MM-DD", timeFormat: "24H", weekStartDay: 0,
  workingWeekdays: [0, 1, 2, 3, 4], normalWorkdayStart: "08:00", normalWorkdayEnd: "16:00",
  checkInOpensAt: "07:30", lateToleranceMinutes: 15, autoCheckoutAt: "18:00", maximumWorkdayMinutes: 600,
};
function fixture() {
  const reservationId = deterministicReservationId(orderId, "PRODUCT-SYNTHETIC");
  const records: Record<string, any> = {
    [orderPath]: { id: orderId, displayNumber: "SO-SYNTHETIC", invoiceNumber: "INVOICE-SYNTHETIC",
      status: "OUT_FOR_DELIVERY", stage: "DELIVERY", deliveryOfficerUid: actorId, createdByUid: "REP-SYNTHETIC",
      pharmacyId, areaId: "AREA-SYNTHETIC", marketId: market.marketId, currencyCode: "TST", currency: "TST",
      total: 90, grossTotal: 100, totalDiscount: 10, paidStatus: "Unpaid", paidAmount: 0,
      items: [{ productId: "PRODUCT-SYNTHETIC", quantity: 4, price: 25, total: 90 }, { productId: "GIFT-SYNTHETIC", quantity: 2, price: 0, total: 0 }],
      inventoryContractVersion: 2, reservationIds: [reservationId], updatedAt: "VERSION-SYNTHETIC", history: [],
    },
    [`users/${actorId}`]: { role: "Delivery Officer", name: "Synthetic Driver", active: true, loginAllowed: true },
    "orderWorkflowTemplates/ENTERPRISE_V1": ENTERPRISE_WORKFLOW_TEMPLATE,
    [`inventoryReservations/${reservationId}`]: { reservationId, orderId, productId: "PRODUCT-SYNTHETIC", status: "CONSUMED",
      saleableReservedQuantity: 4, promotionalReservedQuantity: 2, totalReservedQuantity: 6 },
    [`pharmacies/${pharmacyId}`]: { id: pharmacyId, name: "Synthetic Pharmacy", marketId: market.marketId, currencyCode: "TST", outstandingBalance: 0 },
    [profilePath]: { pharmacyId, marketId: market.marketId, currencyCode: "TST", projectionSource: "customerLedgerEntries", projectionVersion: 1,
      customerAccountNumber: "ACCOUNT-SYNTHETIC", outstandingBalance: 0, totalInvoiced: 0, totalCollected: 0, openInvoiceCount: 0 },
    [`marketSettings/${market.marketId}`]: market,
  };
  const events: Array<{ attempt: number; type: string; path: string }> = [];
  const control = { failWrite: "", failRead: "", failCommit: false, retry: false };
  const snapshot = (path: string) => ({ id: path.split("/")[1], exists: path in records, data: () => structuredClone(records[path]) });
  const ref = (path: string) => ({ path, get: async () => snapshot(path) });
  const db: any = {
    collection: (path: string) => ({ doc: (id: string) => ref(`${path}/${id}`), where: (field: string, _op: string, value: string) => ({ limit: (limit: number) => ({ path, field, value, limit }) }) }),
    runTransaction: vi.fn(async (operation: any) => {
      let result;
      for (let attempt = 0; attempt < (control.retry ? 2 : 1); attempt++) {
        const writes: Array<{ path: string; value: any; create: boolean }> = [];
        const write = (r: any, value: any, create: boolean) => {
          events.push({ attempt, type: "write", path: r.path });
          if (control.failWrite && r.path.startsWith(control.failWrite)) throw new Error("SYNTHETIC_WRITE_FAILURE");
          writes.push({ path: r.path, value: structuredClone(value), create });
        };
        const tx = {
          get: async (r: any) => {
            if (writes.length) throw new Error("READ_AFTER_WRITE");
            events.push({ attempt, type: "read", path: r.path });
            if (control.failRead && r.path.startsWith(control.failRead)) throw new Error("SYNTHETIC_READ_FAILURE");
            if (r.limit) return { docs: Object.keys(records).filter(path => path.startsWith(`${r.path}/`) && records[path][r.field] === r.value).slice(0, r.limit).map(snapshot) };
            return snapshot(r.path);
          },
          create: (r: any, value: any) => write(r, value, true),
          set: (r: any, value: any) => write(r, value, false),
          update: (r: any, value: any) => write(r, value, false),
        };
        result = await operation(tx);
        if (control.retry && attempt === 0) continue; // Aborted attempt: no writes escape.
        if (control.failCommit) throw new Error("SYNTHETIC_COMMIT_FAILURE");
        const committed = structuredClone(records);
        for (const w of writes) {
          if (w.create && w.path in committed) throw new Error("ALREADY_EXISTS");
          committed[w.path] = w.create ? w.value : { ...committed[w.path], ...w.value };
        }
        Object.assign(records, committed);
      }
      return result;
    }),
  };
  const request = { orderId, action: "DELIVERY_COMPLETE", expectedVersion: "VERSION-SYNTHETIC", metadata: { recipientName: "Synthetic Recipient" } };
  const run = (patch: Record<string, any> = {}) => executeAtomicCommercialDeliveryCompletion(actorId, { ...request, ...patch }, { db, now: () => new Date(now) });
  return { db, records, events, control, request, run, reservationId };
}

beforeEach(() => { scope.authorized = true; scope.role = "Delivery Officer"; scope.areaIds = ["AREA-SYNTHETIC"]; });
describe("atomic commercial Delivery completion", () => {
  it("commits Delivery, invoice, profile and audit in one transaction with reads before writes", async () => {
    const f = fixture(); expect(await f.run()).toMatchObject({ success: true });
    expect(f.db.runTransaction).toHaveBeenCalledTimes(1);
    expect(f.records[orderPath]).toMatchObject({ status: "DELIVERED", stage: "CLOSED", paidStatus: "Unpaid", paidAmount: 0 });
    expect(f.records[ledgerPath]).toMatchObject({ transactionType: "INVOICE", sourceType: "DELIVERED_ORDER", debitAmount: 90,
      invoiceOriginalAmount: 90, invoiceOpenAmount: 90, invoiceAppliedAmount: 0, createdAt: now });
    expect(f.records[profilePath]).toMatchObject({ outstandingBalance: 90, totalInvoiced: 90, openInvoiceCount: 1, totalCollected: 0 });
    const firstWrite = f.events.findIndex(e => e.type === "write");
    expect(firstWrite).toBeGreaterThan(0); expect(f.events.slice(firstWrite).every(e => e.type === "write")).toBe(true);
    expect(f.events.filter(e => e.type === "write").map(e => e.path)).toEqual([ledgerPath, profilePath, orderPath, expect.stringMatching(/^auditLogs\//)]);
    expect(f.records[`inventoryReservations/${f.reservationId}`].status).toBe("CONSUMED");
    expect(f.events.some(e => e.path.startsWith("products/"))).toBe(false);
  });
  it("uses the server commercial snapshot and ignores forged financial metadata", async () => {
    const f = fixture(), before = structuredClone(f.records[orderPath]);
    await f.run({ metadata: { recipientName: "Synthetic Recipient", total: 999, currencyCode: "BAD", pharmacyId: "OTHER-SYNTHETIC", paidStatus: "Paid", paidAmount: 999, items: [] } });
    for (const field of ["items", "grossTotal", "totalDiscount", "total", "currency", "currencyCode", "pharmacyId"]) expect(f.records[orderPath][field]).toEqual(before[field]);
    expect(f.records[ledgerPath]).toMatchObject({ debitAmount: before.total, pharmacyId, currencyCode: "TST", invoiceAppliedAmount: 0 });
    expect(f.records[orderPath]).toMatchObject({ paidStatus: "Unpaid", paidAmount: 0 });
  });
  it.each([["Unpaid", 0], ["Partially Paid", 20], ["Paid", 90]])("preserves existing payment projections %s/%i without inferring payment", async (paidStatus, paidAmount) => {
    const f = fixture(); Object.assign(f.records[orderPath], { paidStatus, paidAmount }); await f.run();
    expect(f.records[orderPath]).toMatchObject({ paidStatus, paidAmount });
    expect(Object.keys(f.records).some(p => /^(payments|paymentCollections|paymentAllocations)\//.test(p))).toBe(false);
  });
  it.each([false, true])("preserves optional payment fields (present=%s)", async present => {
    const f = fixture();
    if (present) Object.assign(f.records[orderPath], { paymentStatus: "Partially Paid", payments: [{ id: "PAYMENT-SYNTHETIC", amount: 20 }] });
    const before = structuredClone(f.records[orderPath]);
    await f.run({ metadata: { recipientName: "Synthetic Recipient", paymentStatus: "Paid", payments: [{ amount: 90 }] } });
    for (const field of ["paymentStatus", "payments"]) {
      expect(Object.hasOwn(f.records[orderPath], field)).toBe(Object.hasOwn(before, field));
      expect(f.records[orderPath][field]).toEqual(before[field]);
    }
  });
  it.each(["scope", "area", "assignment", "capability", "stale", "state", "reservation", "recipient"])("rejects %s before any writes", async reason => {
    const f = fixture(); let patch = {};
    if (reason === "scope") scope.authorized = false;
    if (reason === "area") scope.areaIds = [];
    if (reason === "assignment") f.records[orderPath].deliveryOfficerUid = "OTHER-SYNTHETIC";
    if (reason === "capability") scope.role = "Sales Representative";
    if (reason === "stale") patch = { expectedVersion: "STALE-SYNTHETIC" };
    if (reason === "state") f.records[orderPath].status = "PENDING_FINANCE_REVIEW";
    if (reason === "reservation") f.records[`inventoryReservations/${f.reservationId}`].status = "ACTIVE";
    if (reason === "recipient") patch = { metadata: {} };
    const before = structuredClone(f.records);
    expect(await f.run(patch)).toMatchObject({ success: false }); expect(f.records).toEqual(before);
    expect(f.events.filter(e => e.type === "write")).toEqual([]);
  });
  it.each(["certification", "posting-authorization", "market", "currency", "amount", "history"])("aborts for %s posting failure without committing Delivery", async reason => {
    const f = fixture();
    if (reason === "certification") delete f.records[profilePath].projectionSource;
    if (reason === "posting-authorization") f.records[`users/${actorId}`].loginAllowed = false;
    if (reason === "market") delete f.records[`marketSettings/${market.marketId}`];
    if (reason === "currency") f.records[orderPath].currencyCode = "BAD";
    if (reason === "amount") f.records[orderPath].total = 0;
    if (reason === "history") { delete f.records[profilePath]; f.records["pharmacyVisits/VISIT-SYNTHETIC"] = { pharmacyId }; }
    const before = structuredClone(f.records);
    await expect(f.run()).rejects.toThrow(); expect(f.records).toEqual(before);
    expect(f.events.filter(e => e.type === "write")).toEqual([]);
  });
  it.each([ledgerPath, profilePath, orderPath, "auditLogs/"])("rolls back all queued writes when %s persistence fails", async path => {
    const f = fixture(); const before = structuredClone(f.records); f.control.failWrite = path;
    await expect(f.run()).rejects.toThrow("SYNTHETIC_WRITE_FAILURE"); expect(f.records).toEqual(before);
  });
  it("rolls back a commit failure after all writes are prepared", async () => {
    const f = fixture(); const before = structuredClone(f.records); f.control.failCommit = true;
    await expect(f.run()).rejects.toThrow("SYNTHETIC_COMMIT_FAILURE"); expect(f.records).toEqual(before);
  });
  it("propagates posting read errors before any writes", async () => {
    const f = fixture(); f.control.failRead = profilePath; const before = structuredClone(f.records);
    await expect(f.run()).rejects.toThrow("SYNTHETIC_READ_FAILURE"); expect(f.records).toEqual(before);
    expect(f.events.filter(e => e.type === "write")).toEqual([]);
  });
  it("retries an aborted transaction without duplicating invoice, profile effect or audit", async () => {
    const f = fixture(); f.control.retry = true; await f.run();
    expect(f.db.runTransaction).toHaveBeenCalledTimes(1);
    expect(Object.keys(f.records).filter(p => p.startsWith("customerLedgerEntries/"))).toEqual([ledgerPath]);
    expect(Object.keys(f.records).filter(p => p.startsWith("auditLogs/"))).toHaveLength(1);
    expect(f.records[profilePath].outstandingBalance).toBe(90);
    expect(f.events.filter(e => e.path === ledgerPath && e.type === "write")).toHaveLength(2);
    const before = structuredClone(f.records);
    expect(await f.run()).toMatchObject({ success: false, code: "STALE_ORDER_VERSION" }); expect(f.records).toEqual(before);
    expect(await f.run({ expectedVersion: now })).toMatchObject({ success: false, code: "VERSION2_DELIVERY_START_REQUIRED" }); expect(f.records).toEqual(before);
  });
  it("reuses an existing certified deterministic invoice without incrementing its profile", async () => {
    const f = fixture(); const originalOrder = structuredClone(f.records[orderPath]); await f.run();
    const profile = structuredClone(f.records[profilePath]), invoice = structuredClone(f.records[ledgerPath]);
    f.records[orderPath] = originalOrder; f.events.length = 0;
    expect(await f.run()).toMatchObject({ success: true });
    expect(f.records[ledgerPath]).toEqual(invoice); expect(f.records[profilePath]).toEqual(profile);
    expect(f.events.filter(e => e.type === "write" && e.path.startsWith("customer"))).toEqual([]);
  });
  it("keeps the existing runtime entry point non-financial even if a caller supplies an extra flag", async () => {
    const f = fixture(); delete f.records[profilePath];
    expect(await executeCommercialOrderTransition(actorId, { ...f.request, atomicCompletion: true } as any, { db: f.db })).toMatchObject({ success: true });
    expect(f.records[ledgerPath]).toBeUndefined(); expect(f.records[profilePath]).toBeUndefined();
    expect(f.events.filter(e => e.type === "write")).toHaveLength(2);
    expect(parseCommercialOrderTransition({ ...f.request, atomicCompletion: true })).toBeNull();
  });
  it("restricts the atomic entry point to completion", async () => {
    const f = fixture(); expect(await f.run({ action: "DELIVERY_START" })).toMatchObject({ success: false, code: "ATOMIC_DELIVERY_COMPLETE_REQUIRED" });
    expect(f.db.runTransaction).not.toHaveBeenCalled();
  });
  it("allows only the production server to call the atomic entry", () => {
    const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)]);
    const production = ["server.ts", ...files("server"), ...files("src")].filter(path => /\.tsx?$/.test(path) && !/\.(test|emulator)\./.test(path) && path !== "server/commercialOrderTransitionService.ts");
    expect(production.filter(path => readFileSync(path, "utf8").includes("executeAtomicCommercialDeliveryCompletion"))).toEqual(["server.ts"]);
  });
});

// Execute the actual route registration without booting the application or Admin SDK.
function productionRoute(path: string, atomic = vi.fn(), ordinary = vi.fn()) {
  const source = readFileSync("server.ts", "utf8");
  const ast = ts.createSourceFile("server.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const matches: ts.CallExpression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === "app.post" &&
      node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === path) matches.push(node);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  expect(matches).toHaveLength(1);
  const post = vi.fn(), auth = vi.fn(), posting = vi.fn();
  const code = ts.transpileModule(matches[0].getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("app", "requireFirebaseAuth", "parseCommercialOrderTransition", "executeAtomicCommercialDeliveryCompletion", "executeCommercialOrderTransition", "postDeliveredInvoiceServer", "console", code)(
    { post }, auth, parseCommercialOrderTransition, atomic, ordinary, posting, { error: vi.fn() });
  expect(post).toHaveBeenCalledWith(path, auth, expect.any(Function));
  const handler = post.mock.calls[0][2];
  const response = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  return { handler, response, posting };
}

describe("production Delivery cutover routing", () => {
  const path = "/api/orders/commercial/transition";
  it.each(["DELIVERY_COMPLETE", "APPROVE_FINANCE", "FINANCE_APPROVE", "FINANCE_REJECT", "FINANCE_RETURN", "STORE_START_PREPARE", "STORE_MARK_READY", "STORE_REJECT", "STORE_RETURN_TO_OPS", "DELIVERY_START", "DELIVERY_PARTIAL", "DELIVERY_REFUSE", "DELIVERY_FAIL", "DELIVERY_RETURN", "DELIVERY_POSTPONE", "CANCEL"])("dispatches %s exclusively to its intended service", async action => {
    const result = { success: true, order: { id: orderId } };
    const atomic = vi.fn(async () => result), ordinary = vi.fn(async () => result);
    const route = productionRoute(path, atomic, ordinary), request = { ...fixture().request, action };
    await route.handler({ authUid: actorId, body: request }, route.response);
    const selected = action === "DELIVERY_COMPLETE" ? atomic : ordinary;
    const unused = action === "DELIVERY_COMPLETE" ? ordinary : atomic;
    expect(selected).toHaveBeenCalledExactlyOnceWith(actorId, request);
    expect(unused).not.toHaveBeenCalled();
    expect(route.response.status).toHaveBeenCalledWith(200);
    expect(route.response.json).toHaveBeenCalledWith(result);
  });
  it("rejects invalid requests before either service", async () => {
    const atomic = vi.fn(), ordinary = vi.fn(), route = productionRoute(path, atomic, ordinary);
    await route.handler({ authUid: actorId, body: { ...fixture().request, atomicCompletion: true } }, route.response);
    expect(route.response.status).toHaveBeenCalledWith(400);
    expect(atomic).not.toHaveBeenCalled(); expect(ordinary).not.toHaveBeenCalled();
  });
  it.each(["STALE_ORDER_VERSION", "ORDER_SCOPE_DENIED", "throw"])("preserves error response for %s", async code => {
    const atomic = vi.fn(async () => { if (code === "throw") throw new Error("SYNTHETIC_FAILURE"); return { success: false, code }; });
    const ordinary = vi.fn(), route = productionRoute(path, atomic, ordinary);
    await route.handler({ authUid: actorId, body: fixture().request }, route.response);
    expect(route.response.status).toHaveBeenCalledWith(code === "throw" ? 500 : code === "STALE_ORDER_VERSION" ? 409 : 403);
    expect(route.response.json).toHaveBeenCalledWith({ success: false, code: code === "throw" ? "COMMERCIAL_ORDER_TRANSITION_FAILED" : code });
    expect(ordinary).not.toHaveBeenCalled();
  });
  it("executes the real atomic completion through the production handler", async () => {
    const f = fixture();
    const atomic = vi.fn((uid, request) => executeAtomicCommercialDeliveryCompletion(uid, request, { db: f.db, now: () => new Date(now) }));
    const route = productionRoute(path, atomic);
    await route.handler({ authUid: actorId, body: f.request }, route.response);
    expect(route.response.status).toHaveBeenCalledWith(200);
    expect(Object.keys(f.records).filter(key => key.startsWith("customerLedgerEntries/"))).toEqual([ledgerPath]);
    expect(f.records[orderPath].status).toBe("DELIVERED");
  });
  it("retires standalone posting without invoking financial services", async () => {
    const atomic = vi.fn(), ordinary = vi.fn();
    const route = productionRoute("/api/ar/delivered-invoice", atomic, ordinary);
    await route.handler({ authUid: actorId, body: { orderId } }, route.response);
    expect(route.response.status).toHaveBeenCalledExactlyOnceWith(410);
    expect(route.response.json).toHaveBeenCalledWith({ success: false, posted: false, code: "DELIVERED_INVOICE_ENDPOINT_RETIRED", message: "Receivables are created as part of successful Delivery completion." });
    expect(route.posting).not.toHaveBeenCalled(); expect(atomic).not.toHaveBeenCalled(); expect(ordinary).not.toHaveBeenCalled();
    expect(readFileSync("server.ts", "utf8")).not.toContain("postDeliveredInvoiceServer");
  });
  it("removes both client second-posting calls and their import", () => {
    const client = readFileSync("src/components/sales/SalesOrders.tsx", "utf8");
    expect(client).not.toContain("postDeliveredInvoice");
    expect(client).not.toContain("deliveredInvoicePostingClient");
    expect(client).toContain("transitionCommercialOrder(firebaseUser");
  });
});
