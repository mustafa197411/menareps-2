import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { parseOrderWorkflowQueueControls, resolveOrderWorkflowQueueRead, type OrderWorkflowQueueReadRepository } from "./orderWorkflowQueueReadService";
import type { WorkflowQueueScopeRepository } from "./workflowQueueScopeRepository";

const controls = { fromDate: "2026-06-01T00:00:00.000Z", toDate: "2026-08-01T00:00:00.000Z", pageSize: 25 };
const order = (id: string, overrides: Record<string, any> = {}) => ({ id, version: `${id}:1`, data: { id, displayNumber: id, status: "FINANCE_APPROVED", stage: "OPERATIONS_REVIEW", areaId: "A1", pharmacyId: "P1", pharmacyName: "Pharmacy", createdByName: "Rep", createdAt: "2026-07-01T00:00:00.000Z", items: [{ secret: true }], total: 10, paymentEvidence: "SECRET", receiptImage: "SECRET", chequeNumber: "SECRET", treasuryLedger: "SECRET", warehouseStock: "SECRET", inventoryAllocation: "SECRET", deliveryOfficerPhone: "SECRET", deliveryGPS: "SECRET", history: ["SECRET"], ...overrides } });
function scopeRepo(overrides: Record<string, any> = {}): WorkflowQueueScopeRepository { return { getActor: vi.fn(async () => ({ id: "OPS", role: "Order Operations Officer", active: true, loginAllowed: true, status: "Active", securityScope: "COUNTRY", country: "Libya", ...overrides })), getGeographyCatalog: vi.fn(async () => ({ countries: [{ id: "C1", name: "Libya", active: true }], districts: [{ id: "D1", countryId: "C1", active: true }], cities: [{ id: "CT1", countryId: "C1", districtId: "D1", active: true }], areas: [{ id: "A1", countryId: "C1", districtId: "D1", cityId: "CT1", active: true }] })) }; }
function queueRepo(documents = [order("O1")], legacyDocuments: ReturnType<typeof order>[] = [], names = new Map<string, string>()) {
  const queryByArea = vi.fn(async () => documents);
  const listActivePharmacyIdsByArea = vi.fn(async () => legacyDocuments.length ? ["P1"] : []);
  const queryByPharmacy = vi.fn(async () => legacyDocuments);
  const getRepresentativeNames = vi.fn(async () => names);
  return { repository: { queryByArea, listActivePharmacyIdsByArea, queryByPharmacy, getRepresentativeNames } as OrderWorkflowQueueReadRepository, queryByArea, listActivePharmacyIdsByArea, queryByPharmacy, getRepresentativeNames };
}
async function resolve(input: any = controls, actor: Record<string, any> = {}, documents = [order("O1")], legacyDocuments: ReturnType<typeof order>[] = []) {
  const repo = queueRepo(documents, legacyDocuments); const result = await resolveOrderWorkflowQueueRead("OPS", input, { workflowScopeRepository: scopeRepo(actor), queueRepository: repo.repository }); return { result, ...repo };
}
const source = () => fs.readFileSync(new URL("./orderWorkflowQueueReadService.ts", import.meta.url), "utf8");

describe("WP5.2F.6B.1 bounded Operations queue service", () => {
  it("1. endpoint requires authentication", () => expect(fs.readFileSync(new URL("../server.ts", import.meta.url), "utf8")).toContain('app.post("/api/orders/workflow/scoped-query", requireFirebaseAuth'));
  it("2. wrong role denied", async () => expect((await resolve(controls, { role: "Finance Officer" })).result.authorized).toBe(false));
  it("3. inactive actor denied", async () => expect((await resolve(controls, { active: false })).result.code).toBe("ACTOR_INACTIVE"));
  it("4. Operations actor authorized", async () => expect((await resolve()).result.authorized).toBe(true));
  it("5. G.1 scope resolved server-side", () => expect(source()).toContain("resolveWorkflowQueueScope"));
  it("6. resource is orders only", () => expect(source()).toContain('{ resource: "orders"'));
  it("7. FINANCE_APPROVED included", async () => expect((await resolve()).result.orders[0].currentStatus).toBe("FINANCE_APPROVED"));
  it("8. PENDING_OPERATIONS_REVIEW included", async () => expect((await resolve(controls, {}, [order("O1", { status: "PENDING_OPERATIONS_REVIEW" })])).result.orders[0].currentStatus).toBe("PENDING_OPERATIONS_REVIEW"));
  it("9. unsupported status cannot widen", () => expect(parseOrderWorkflowQueueControls({ statuses: ["DELIVERED"] })).toBeNull());
  it("10. client status narrows", async () => { const value = await resolve({ ...controls, statuses: ["FINANCE_APPROVED"] }); expect(value.queryByArea).toHaveBeenCalledWith("A1", ["FINANCE_APPROVED"], controls.fromDate, controls.toDate, 26); });
  it("11. area scope drives query", async () => expect((await resolve()).queryByArea.mock.calls[0][0]).toBe("A1"));
  it("12. outside-area documents are never queried", async () => expect((await resolve()).queryByArea).toHaveBeenCalledTimes(1));
  it("13. date range required/defaulted", () => expect(parseOrderWorkflowQueueControls({}, new Date("2026-08-01"))?.fromDate).toBe("2026-05-03T00:00:00.000Z"));
  it("14. excessive range denied", () => expect(parseOrderWorkflowQueueControls({ fromDate: "2025-01-01", toDate: "2026-08-01" })).toBeNull());
  it("15. page size bounded", () => expect(parseOrderWorkflowQueueControls({ pageSize: 51 })).toBeNull());
  it("16. stable cursor emitted", async () => expect((await resolve({ ...controls, pageSize: 1 }, {}, [order("O1"), order("O2", { createdAt: "2026-06-01T00:00:00.000Z" })])).result.nextCursor).toBeTruthy());
  it("17. deterministic ordering", async () => expect((await resolve(controls, {}, [order("O2"), order("O1")])).result.orders.map((item) => item.orderId)).toEqual(["O1", "O2"]));
  it("18. deduplicates documents", async () => expect((await resolve(controls, {}, [order("O1"), order("O1")])).result.orders).toHaveLength(1));
  it("19. no whole orders scan", () => expect(source()).not.toContain('collection("orders").get()'));
  it("20. no broad pharmacy scan", () => expect(source()).not.toContain('collection("pharmacies").get()'));
  it("21. no broad users scan", () => expect(source()).not.toContain('collection("users").get()'));
  it("22. missing-area legacy order enters only through an authorized-area pharmacy", async () => {
    const legacy = order("LEGACY", { areaId: undefined, status: "PENDING_OPERATIONS_REVIEW" });
    const value = await resolve(controls, {}, [], [legacy]);
    expect(value.listActivePharmacyIdsByArea).toHaveBeenCalledWith("A1");
    expect(value.queryByPharmacy).toHaveBeenCalledWith("P1", ["FINANCE_APPROVED", "PENDING_OPERATIONS_REVIEW"], controls.fromDate, controls.toDate, 26);
    expect(value.result.orders.map((item) => item.orderId)).toEqual(["LEGACY"]);
  });
  it("23. summary discriminator unique", async () => expect((await resolve()).result.orders[0].kind).toBe("ORDER_WORKFLOW_QUEUE_SUMMARY"));
  for (const [number, field] of [[24, "paymentEvidence"], [25, "receiptImage"], [26, "chequeNumber"], [27, "treasuryLedger"], [28, "warehouseStock"], [29, "inventoryAllocation"], [30, "deliveryOfficerPhone"], [31, "history"]] as const) it(`${number}. excludes ${field}`, async () => expect((await resolve()).result.orders[0]).not.toHaveProperty(field));
  it("32. Firestore updateTime version returned", async () => expect((await resolve()).result.orders[0].version).toBe("O1:1"));
  it("WP76. PENDING_FINANCE_REVIEW is excluded from Operations queue", async () => expect((await resolve(controls, {}, [order("FIN", { status: "PENDING_FINANCE_REVIEW" })])).result.orders).toEqual([]));
  it("WP76. PENDING_OPERATIONS_REVIEW is visible through bounded pharmacy resolution", async () => expect((await resolve(controls, {}, [], [order("OPS", { areaId: undefined, status: "PENDING_OPERATIONS_REVIEW" })])).result.orders[0].orderId).toBe("OPS"));
  it("WP76. STORE_PREPARATION is excluded from Operations queue", async () => expect((await resolve(controls, {}, [order("STORE", { status: "PENDING_STORE_PREPARATION", stage: "STORE_PREPARATION" })])).result.orders).toEqual([]));
  it("WP76. repository errors propagate instead of becoming an authorized empty queue", async () => {
    const repository = queueRepo().repository; repository.queryByArea = vi.fn(async () => { throw Object.assign(new Error("index"), { code: "FAILED_PRECONDITION" }); });
    await expect(resolveOrderWorkflowQueueRead("OPS", controls, { workflowScopeRepository: scopeRepo(), queueRepository: repository })).rejects.toMatchObject({ code: "FAILED_PRECONDITION" });
  });
  it("WP76. diagnostics are deterministic and do not alter the canonical status vocabulary", () => {
    expect(source()).toContain("[WP76_OOO_QUEUE_QUERY_JSON]"); expect(source()).toContain("[WP76_OOO_ORDER_FILTER_JSON]"); expect(source()).toContain("[WP76_OOO_QUEUE_CERTIFICATION_JSON]");
    expect(source()).not.toContain('"OPERATIONS_REVIEW" as WorkflowQueueStatus');
  });
  it("WP76A. representative UID is replaced by the authoritative display name", async () => {
    const repo = queueRepo([order("O1", { createdByUid: "REP1", createdByName: "REP1" })], [], new Map([["REP1", "Omar Representative"]]));
    const result = await resolveOrderWorkflowQueueRead("OPS", controls, { workflowScopeRepository: scopeRepo(), queueRepository: repo.repository });
    expect(result.orders[0].representativeName).toBe("Omar Representative");
    expect(repo.getRepresentativeNames).toHaveBeenCalledWith(["REP1"]);
  });
});

const queueMarket: any = { marketId: "SYNTH-M1", countryId: "C1", countryNameEn: "Synthetic", countryNameAr: "بلد", active: true, currencyCode: "TST", currencySymbol: "T", symbolPosition: "AFTER", decimalPlaces: 2, numeralLocale: "en-US", timezone: "UTC", workingWeekdays: [1], normalWorkdayStart: "09:00", normalWorkdayEnd: "17:00", checkInOpensAt: "08:00", autoCheckoutAt: "18:00" };
describe("queue Order-specific context transport", () => {
  it("uses each returned Order identity, preserves snapshots and bounds reads to the page", async () => {
    const docs = [order("A", { marketId: "SYNTH-M1", countryId: "C1", currencyCode: "TST", total: 2500 }), order("B", { marketId: "SYNTH-M2", countryId: "C2", currency: "USD", total: 0 }), order("C", { marketId: "NOT-ON-PAGE" })];
    const repo = queueRepo(docs);
    const readMarketContext = vi.fn(async (identity: any) => ({ status: "RESOLVED" as const, market: identity.marketId === "SYNTH-M1" ? queueMarket : { ...queueMarket, marketId: "SYNTH-M2", countryId: "C2", currencyCode: "USD" } }));
    const result = await resolveOrderWorkflowQueueRead("OPS", { ...controls, pageSize: 2 }, { workflowScopeRepository: scopeRepo({ marketId: "VIEWER" }), queueRepository: { ...repo.repository, readMarketContext } });
    expect(result.orders.map(row => [row.orderId, row.total, row.currencyCode, row.marketContext?.status])).toEqual([["A", 2500, "TST", "RESOLVED"], ["B", 0, "USD", "RESOLVED"]]);
    expect(readMarketContext.mock.calls).toEqual([[{ marketId: "SYNTH-M1", countryId: "C1" }], [{ marketId: "SYNTH-M2", countryId: "C2" }]]);
  });
  it.each(["missing", "conflicting", "malformed", "read failure"])("keeps %s context unresolved without hiding authorized Orders", async scenario => {
    const repo = queueRepo([order("A", { marketId: "SYNTH-M1", countryId: "C1", currencyCode: scenario === "conflicting" ? "USD" : scenario === "missing" ? undefined : "TST" })]);
    const readMarketContext = vi.fn(async () => { if (scenario === "read failure") throw new Error("unavailable"); return { status: "RESOLVED" as const, market: { ...queueMarket, ...(scenario === "malformed" ? { active: false } : {}) } }; });
    const result = await resolveOrderWorkflowQueueRead("OPS", controls, { workflowScopeRepository: scopeRepo(), queueRepository: { ...repo.repository, readMarketContext } });
    expect(result.orders[0]).toMatchObject({ total: 10, marketContext: { status: "UNRESOLVED" } });
  });
  it("reuses acquired context while checking currency independently for each Order", async () => {
    const repo = queueRepo([order("A", { marketId: "SYNTH-M1", countryId: "C1", currencyCode: "TST" }), order("B", { marketId: "SYNTH-M1", countryId: "C1", currencyCode: "USD" })]);
    const readMarketContext = vi.fn(async () => ({ status: "RESOLVED" as const, market: queueMarket }));
    const result = await resolveOrderWorkflowQueueRead("OPS", controls, { workflowScopeRepository: scopeRepo(), queueRepository: { ...repo.repository, readMarketContext } });
    expect(readMarketContext).toHaveBeenCalledTimes(1);
    expect(result.orders.map(row => row.marketContext?.status)).toEqual(["RESOLVED", "UNRESOLVED"]);
  });
});
