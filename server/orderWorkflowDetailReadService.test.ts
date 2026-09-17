import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  parseOrderWorkflowDetailReadRequest,
  resolveOrderWorkflowDetailRead,
  type OrderWorkflowDetailReadRepository,
} from "./orderWorkflowDetailReadService";
import type { WorkflowQueueScopeRepository } from "./workflowQueueScopeRepository";

const order = {
  id: "O1", displayNumber: "SO-1", status: "FINANCE_APPROVED", stage: "OPERATIONS_REVIEW",
  pharmacyId: "P1", pharmacyName: "Pharmacy", areaId: "A1", countryId: "C1",
  createdByUid: "REP1", createdByName: "Rep One", orderDate: "2026-08-01", total: 100,
  items: [{ productId: "PR1", name: "Product", quantity: 2, price: 40, total: 80 }],
  financeApprovedAt: "2026-08-02", financeApprovedByUid: "FIN1", financeApprovedByName: "Finance Officer",
  history: [
    { action: "FINANCE_APPROVE", fromStatus: "PENDING_FINANCE_REVIEW", toStatus: "FINANCE_APPROVED", actorUid: "FIN1", actorName: "Finance", createdAt: "T1", comments: "SECRET FINANCE COMMENT" },
    { action: "OPERATIONS_RETURN_TO_FINANCE", fromStatus: "FINANCE_APPROVED", toStatus: "RETURNED_TO_FINANCE", actorUid: "OPS", actorName: "Ops", createdAt: "T2", comments: "Review again" },
    { action: "DELIVERY_COMPLETE", actorUid: "D1", comments: "SECRET DELIVERY" },
  ],
  receiptImage: "SECRET", paymentEvidence: "SECRET", chequeNumber: "SECRET", bankDetails: "SECRET", treasuryLedger: "SECRET",
  warehouseStock: "SECRET", inventoryAllocation: "SECRET", deliveryOfficerPhone: "SECRET", deliveryGPS: "SECRET", deliverySignature: "SECRET", deliveryPhotos: ["SECRET"], auditTrail: ["SECRET"],
};

function scopeRepo(overrides: Record<string, any> = {}): WorkflowQueueScopeRepository {
  return {
    getActor: vi.fn(async () => ({ id: "OPS", role: "Order Operations Officer", active: true, loginAllowed: true, status: "Active", securityScope: "COUNTRY", country: "Libya", ...overrides })),
    getGeographyCatalog: vi.fn(async () => ({ countries: [{ id: "C1", name: "Libya", active: true }], districts: [{ id: "D1", countryId: "C1", active: true }], cities: [{ id: "CT1", countryId: "C1", districtId: "D1", active: true }], areas: [{ id: "A1", countryId: "C1", districtId: "D1", cityId: "CT1", active: true }] })),
  };
}
function detailRepo(options: { order?: any; version?: string; pharmacy?: any; representative?: any } = {}) {
  const getOrder = vi.fn(async () => options.order === null ? null : ({ id: "O1", version: options.version === undefined ? "1:2" : options.version, data: { ...order, ...(options.order || {}) } }));
  const getPharmacy = vi.fn(async () => options.pharmacy === null ? null : (options.pharmacy || { id: "P1", areaId: "A1" }));
  const getRepresentative = vi.fn(async () => options.representative === null ? null : (options.representative || { id: "REP1", name: "Rep One" }));
  return { repository: { getOrder, getPharmacy, getRepresentative } as OrderWorkflowDetailReadRepository, getOrder, getPharmacy, getRepresentative };
}
async function resolve(options: Parameters<typeof detailRepo>[0] = {}, actorOverrides: Record<string, any> = {}) {
  const repo = detailRepo(options);
  const result = await resolveOrderWorkflowDetailRead("OPS", "O1", { workflowScopeRepository: scopeRepo(actorOverrides), detailRepository: repo.repository });
  return { result, ...repo };
}
const detail = async () => { const result = (await resolve()).result; if (!result.authorized) throw new Error("expected detail"); return result.detail; };

describe("WP5.2F.6B.0D authoritative detail read", () => {
  it("1. authenticated Operations actor allowed", async () => expect((await resolve()).result.authorized).toBe(true));
  it("2. route requires authentication", () => expect(fs.readFileSync(new URL("../server.ts", import.meta.url), "utf8")).toContain('app.post("/api/orders/workflow/detail", requireFirebaseAuth'));
  it("3. wrong role denied", async () => expect((await resolve({}, { role: "Finance Officer" })).result.authorized).toBe(false));
  it("4. inactive actor denied", async () => expect((await resolve({}, { active: false })).result).toMatchObject({ authorized: false, code: "ACTOR_INACTIVE" }));
  it("5. reads only exact orderId", async () => expect((await resolve()).getOrder).toHaveBeenCalledWith("O1"));
  it("6. missing order denied", async () => expect((await resolve({ order: null })).result).toMatchObject({ authorized: false, code: "ORDER_NOT_FOUND" }));
  it("7. current FINANCE_APPROVED allowed", async () => expect((await resolve()).result.authorized).toBe(true));
  it("8. current PENDING_OPERATIONS_REVIEW allowed", async () => expect((await resolve({ order: { status: "PENDING_OPERATIONS_REVIEW" } })).result.authorized).toBe(true));
  it("9. moved order denied", async () => expect((await resolve({ order: { status: "OPERATIONS_APPROVED" } })).result).toMatchObject({ authorized: false, code: "ORDER_STATUS_NOT_AUTHORIZED" }));
  it("10. canonical area accepted", async () => expect((await resolve()).result.authorized).toBe(true));
  it("11. outside area denied", async () => expect((await resolve({ order: { areaId: "A2" } })).result).toMatchObject({ authorized: false, code: "ORDER_GEOGRAPHY_DENIED" }));
  it("12. missing geography uses bounded pharmacy", async () => { const value = await resolve({ order: { areaId: undefined } }); expect(value.result.authorized).toBe(true); expect(value.getPharmacy).toHaveBeenCalledWith("P1"); });
  it("13. unresolved pharmacy denied", async () => expect((await resolve({ order: { areaId: undefined }, pharmacy: null })).result).toMatchObject({ authorized: false, code: "ORDER_GEOGRAPHY_UNRESOLVED" }));
  it("14. no broad orders scan", () => expect(fs.readFileSync(new URL("./orderWorkflowDetailReadService.ts", import.meta.url), "utf8")).not.toContain('collection("orders").get()'));
  it("15. no broad pharmacy scan", () => expect(fs.readFileSync(new URL("./orderWorkflowDetailReadService.ts", import.meta.url), "utf8")).not.toContain('collection("pharmacies").get()'));
  it("16. no broad users scan", () => expect(fs.readFileSync(new URL("./orderWorkflowDetailReadService.ts", import.meta.url), "utf8")).not.toContain('collection("users").get()'));
  it("17. canonical creator included", async () => expect((await detail()).creatorUid).toBe("REP1"));
  it("18. missing creator denied", async () => expect((await resolve({ order: { createdByUid: undefined } })).result).toMatchObject({ authorized: false, code: "CREATOR_IDENTITY_UNRESOLVED" }));
  it("19. Firestore updateTime becomes version", async () => expect((await detail()).version).toBe("1:2"));
  it("20. missing version fails closed without schema workaround", async () => expect((await resolve({ version: "" })).result).toMatchObject({ authorized: false, code: "ORDER_VERSION_UNRESOLVED" }));
  it("21. detail has unique discriminator", async () => expect((await detail()).kind).toBe("AUTHORITATIVE_ORDER_OPERATIONS_DETAIL"));
  it("22. detail is not an OrderRecord", async () => expect(await detail()).not.toHaveProperty("paidStatus"));
  it("23. detail is not a transition request", async () => expect(await detail()).not.toHaveProperty("action"));
  for (const [number, field] of [[24, "receiptImage"], [25, "paymentEvidence"], [26, "chequeNumber"], [27, "treasuryLedger"], [28, "warehouseStock"], [29, "inventoryAllocation"], [30, "deliveryOfficerPhone"], [31, "deliveryGPS"]] as const) it(`${number}. excludes ${field}`, async () => expect(await detail()).not.toHaveProperty(field));
  it("32. Finance prerequisite is minimal", async () => expect((await detail()).financePrerequisite).toEqual({ approved: true, approvedAt: "2026-08-02", approvedByUid: "FIN1", approvedByName: "Finance Officer" }));
  it("33. history is sanitized", async () => expect((await detail()).history).toHaveLength(2));
  it("34. unrestricted Finance/history comments are not returned", async () => { const history = (await detail()).history; expect(history[0]).not.toHaveProperty("comments"); expect(JSON.stringify(history)).not.toContain("SECRET"); });
  it("43. orderWorkflowEngine is unchanged by candidate", () => expect(fs.readFileSync(new URL("../src/features/orders/orderWorkflowEngine.ts", import.meta.url), "utf8")).not.toContain("AUTHORITATIVE_ORDER_OPERATIONS_DETAIL"));
  it("44. transition request contract remains narrow", () => expect(fs.readFileSync(new URL("./orderOperationsTransitionService.ts", import.meta.url), "utf8")).toContain('new Set(["orderId", "action", "comments", "expectedStatus", "expectedVersion"])'));
  it("45. G.1 remains separate", () => expect(fs.readFileSync(new URL("./workflowQueueScopeService.ts", import.meta.url), "utf8")).not.toContain("OrderWorkflowDetail"));
  it("46. WP5.2E remains unchanged", () => expect(fs.readFileSync(new URL("./operationalScopeService.ts", import.meta.url), "utf8")).not.toContain("WORKFLOW_QUEUE"));
  it("47. detail service performs no Firestore write", () => expect(fs.readFileSync(new URL("./orderWorkflowDetailReadService.ts", import.meta.url), "utf8")).not.toMatch(/\.set\(|\.update\(|runTransaction/));
  it("48. no rules or config workaround", () => expect(fs.readFileSync(new URL("./orderWorkflowDetailReadService.ts", import.meta.url), "utf8")).not.toContain("firestore.rules"));
  it("49. no UID special case", () => expect(fs.readFileSync(new URL("./orderWorkflowDetailReadService.ts", import.meta.url), "utf8")).not.toContain('=== "OPS"'));
  it("50. legacy queue now uses the backend scope boundary", () => { const source = fs.readFileSync(new URL("../src/components/sales/SalesOrders.tsx", import.meta.url), "utf8"); expect(source).toContain("fetchScopedCommercialRead"); expect(source).not.toContain('listenCollection<any>("orders"'); });
  it("WP76A. detail maps a representative UID to an authoritative display name", async () => {
    const result = await resolve({ order: { createdByName: "REP1" }, representative: { name: "Omar Representative" } });
    expect(result.result.authorized && result.result.detail.representativeName).toBe("Omar Representative");
    expect(result.getRepresentative).toHaveBeenCalledWith("REP1");
  });
});

const snapshotMarket: any = { marketId: "SYNTH-M", countryId: "C1", countryNameEn: "Synthetic", countryNameAr: "بلد", active: true, currencyCode: "TST", currencySymbol: "T", symbolPosition: "AFTER", decimalPlaces: 2, numeralLocale: "en-US", timezone: "UTC", workingWeekdays: [1], normalWorkdayStart: "09:00", normalWorkdayEnd: "17:00", checkInOpensAt: "08:00", autoCheckoutAt: "18:00" };
describe("Order-rooted financial context transport", () => {
  it.each(["valid", "currency conflict", "country conflict", "read failure", "malformed"])("handles %s without changing authorization or stored amounts", async scenario => {
    const repo = detailRepo({ order: { marketId: "SYNTH-M", currencyCode: scenario === "currency conflict" ? "OTHER" : "TST" } });
    const readMarketContext = vi.fn(async () => {
      if (scenario === "read failure") throw new Error("unavailable");
      return { status: "RESOLVED" as const, market: { ...snapshotMarket, ...(scenario === "country conflict" ? { countryId: "OTHER" } : {}), ...(scenario === "malformed" ? { currencyCode: "bad" } : {}) } };
    });
    const result = await resolveOrderWorkflowDetailRead("OPS", "O1", { workflowScopeRepository: scopeRepo({ marketId: "VIEWER-M" }), detailRepository: { ...repo.repository, readMarketContext } });
    expect(result.authorized).toBe(true);
    if (!result.authorized) throw new Error("denied");
    expect(readMarketContext).toHaveBeenCalledExactlyOnceWith({ marketId: "SYNTH-M", countryId: "C1" });
    expect(result.detail.marketContext?.status).toBe(scenario === "valid" ? "RESOLVED" : "UNRESOLVED");
    expect(result.detail.items[0].unitPrice).toBe(40);
    expect(result.detail.total).toBe(100);
  });
});
