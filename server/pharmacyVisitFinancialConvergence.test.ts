import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { executePharmacyVisitCompletion } from "./pharmacyVisitCompletionService";
import { ENTERPRISE_WORKFLOW_TEMPLATE } from "../src/features/orders/orderWorkflowTemplate";
import { readFileSync } from "node:fs";

vi.mock("./operationalScopeRepository", () => ({
  createFirestoreOperationalScopeRepository: vi.fn(),
  resolveOperationalScopeForActor: async () => ({ authorized: true, queryPlan: {}, role: "Sales Representative", areaIds: ["AREA-SYNTHETIC"], productIds: ["PRODUCT-SYNTHETIC"] }),
}));
const actor = "REP-SYNTHETIC", pharmacyId = "PHARMACY-SYNTHETIC";
const market = {
  marketId: "MARKET-SYNTHETIC", countryId: "COUNTRY-SYNTHETIC", countryNameEn: "Synthetic Country", countryNameAr: "بلد",
  active: true, currencyCode: "TST", currencySymbol: "T", symbolPosition: "AFTER", decimalPlaces: 2,
  businessDocumentCode: "ZX", numeralLocale: "en", timezone: "Etc/UTC", dateFormat: "YYYY-MM-DD", timeFormat: "24H", weekStartDay: 0,
  workingWeekdays: [0, 1, 2, 3, 4], normalWorkdayStart: "08:00", normalWorkdayEnd: "16:00",
  checkInOpensAt: "07:30", lateToleranceMinutes: 15, autoCheckoutAt: "18:00", maximumWorkdayMinutes: 600,
};
function fixture(withOrder = false) {
  const draft: any = { schemaVersion: "2.0", draftId: "DRAFT-SYNTHETIC", repUid: actor, pharmacyId, areaId: "AREA-SYNTHETIC",
    currentStep: 6, entrySource: "DIRECT_MENU", status: "IN_PROGRESS", currencyCode: "TST",
    visitPurpose: { code: "FINANCIAL_COLLECTION", labelEn: "Collection follow-up" },
    pharmacySnapshot: { id: pharmacyId, outstandingBalance: 999999 },
    gps: { status: "VERIFIED", latitude: 1, longitude: 2, accuracy: 5 },
    order: { lines: withOrder ? [{ id: "LINE-SYNTHETIC", canonicalProductId: "PRODUCT-SYNTHETIC", quantity: 2, unitPricePreview: 10, userConfirmed: true }] : [], currency: "TST", subtotalPreview: withOrder ? 20 : 0, updatedAt: "2026-01-01" },
    payment: { paymentEntry: { amount: 0, method: "CASH", notes: "Discussed account follow-up", evidences: [] }, financialContext: { outstandingBalanceBefore: 999999 }, balancePreview: { projectedBalanceAfter: 1 } },
    stock: { crmNotes: { generalNotes: "Operational notes" }, competitiveIntelligence: { competitorBrands: [] }, requestLines: [] },
    plannerId: "PLANNER-SYNTHETIC",
  };
  const records: Record<string, any> = {
    "rolePermissions/Sales Representative": { create: true },
    [`pharmacies/${pharmacyId}`]: { name: "Synthetic Pharmacy", areaId: "AREA-SYNTHETIC", companyId: "COMPANY-SYNTHETIC", outstandingBalance: 123 },
    "areas/AREA-SYNTHETIC": { countryId: market.countryId, districtId: "DISTRICT-SYNTHETIC", cityId: "CITY-SYNTHETIC" },
    [`countries/${market.countryId}`]: {}, "districts/DISTRICT-SYNTHETIC": { countryId: market.countryId },
    "cities/CITY-SYNTHETIC": { countryId: market.countryId, districtId: "DISTRICT-SYNTHETIC" },
    "products/PRODUCT-SYNTHETIC": { price: 10, stockQuantity: 100, activeReservedQuantity: 0, name: "Synthetic Product" },
    "salesPlannerVisits/PLANNER-SYNTHETIC": { repId: actor },
    "orderWorkflowTemplates/ENTERPRISE_V1": ENTERPRISE_WORKFLOW_TEMPLATE,
  };
  const writes: Array<{ path: string; data: any }> = [];
  const snapshot = (path: string) => ({ id: path.split("/")[1], exists: path in records, data: () => structuredClone(records[path]) });
  const db: any = {
    collection: (path: string) => ({ path, where() { return this; }, doc: (id: string) => ({ path: `${path}/${id}`, get: async () => snapshot(`${path}/${id}`) }) }),
    runTransaction: vi.fn(async (operation: any) => {
      const pending: typeof writes = [];
      const write = (ref: any, data: any) => pending.push({ path: ref.path, data });
      const tx = { get: async (ref: any) => {
        if (pending.length) throw new Error("READ_AFTER_WRITE");
        return ref.path === "marketSettings" ? { size: 1, docs: [{ id: market.marketId, data: () => market }] } : snapshot(ref.path);
      }, create: write, set: write, update: write };
      const result = await operation(tx);
      for (const w of pending) records[w.path] = { ...records[w.path], ...w.data };
      writes.push(...pending); return result;
    }),
  };
  const run = () => executePharmacyVisitCompletion(actor, { draft, finalRemarks: "Follow-up agreed" }, { db, now: () => new Date("2026-01-02T12:00:00.000Z") });
  return { draft, records, writes, db, run };
}
beforeEach(() => { vi.spyOn(console, "info").mockImplementation(() => {}); });
afterEach(() => vi.restoreAllMocks());
describe("Pharmacy Visit financial retirement", () => {
  it.each([false, true])("preserves operational Visit with Order=%s without debt or collection", async withOrder => {
    const f = fixture(withOrder), original = structuredClone(f.draft);
    const result = await f.run(); expect(result.success).toBe(true);
    const visit = f.records[`pharmacyVisits/${result.visitId}`];
    expect(visit).toMatchObject({ status: "COMPLETED", visitPurpose: original.visitPurpose, stock: original.stock,
      finalRemarks: "Follow-up agreed", areaId: "AREA-SYNTHETIC", countryId: market.countryId, marketId: market.marketId,
      payment: { paymentEntry: original.payment.paymentEntry }, gps: original.gps });
    for (const field of ["collectedAmount", "outstandingBalanceBefore", "outstandingBalanceAfter"]) expect(visit).not.toHaveProperty(field);
    expect(visit.pharmacySnapshot).not.toHaveProperty("outstandingBalance");
    expect(visit.payment).not.toHaveProperty("financialContext"); expect(visit.payment).not.toHaveProperty("balancePreview");
    expect(f.records[`pharmacies/${pharmacyId}`]).toMatchObject({ outstandingBalance: 123, lastVisitDate: "2026-01-02", gpsVerified: true, gpsVerifiedVisitId: result.visitId });
    expect(f.writes.find(w => w.path === `pharmacies/${pharmacyId}`)!.data).not.toHaveProperty("outstandingBalance");
    expect(f.records["salesPlannerVisits/PLANNER-SYNTHETIC"]).toMatchObject({ completedVisitId: result.visitId, visitStatus: "Completed" });
    expect(f.writes.some(w => w.path.startsWith("auditLogs/"))).toBe(true);
    expect(f.writes.some(w => w.path.startsWith("businessDocumentSequences/"))).toBe(true);
    expect(f.writes.filter(w => /^(payments|paymentCollections|paymentAllocations|customerLedgerEntries|customerFinancialProfiles)\//.test(w.path))).toEqual([]);
    if (withOrder) {
      expect(f.records[`orders/${result.orderId}`]).toMatchObject({ paidStatus: "Unpaid", paidAmount: 0, status: "PENDING_FINANCE_REVIEW", total: 20, currencyCode: "TST", items: [expect.objectContaining({ quantity: 2, price: 10 })] });
      expect(f.writes.filter(w => w.path.startsWith("inventoryReservations/"))).toHaveLength(1);
      expect(f.records["products/PRODUCT-SYNTHETIC"].activeReservedQuantity).toBe(2);
    }
    expect(f.draft).toEqual(original);
  });
  it("accepts absent collection and preserves validated stock requests", async () => {
    const f = fixture(); delete f.draft.payment;
    f.draft.stock.requestLines = [{ canonicalProductId: "PRODUCT-SYNTHETIC", requestedQuantity: 3, priority: "NORMAL" }];
    expect((await f.run()).success).toBe(true);
    expect(f.writes.find(w => w.path.startsWith("stockRequests/"))!.data).toMatchObject({ requestedQty: 3, approvedOrderQty: 0, unfulfilledQty: 3 });
  });
  it.each([0.01, 25, 999999])("rejects positive amount %s before any transaction and preserves draft", async amount => {
    const f = fixture(true); f.draft.payment.paymentEntry.amount = amount; const before = structuredClone(f.draft);
    await expect(f.run()).rejects.toMatchObject({ code: "PHARMACY_VISIT_COLLECTION_UNAVAILABLE", status: 409 });
    expect(f.db.runTransaction).not.toHaveBeenCalled(); expect(f.writes).toEqual([]); expect(f.draft).toEqual(before);
  });
  it.each([-1, NaN, Infinity, "25", null])("rejects malformed amount %s without coercion or writes", async amount => {
    const f = fixture(); f.draft.payment.paymentEntry.amount = amount;
    await expect(f.run()).rejects.toMatchObject({ code: "PHARMACY_VISIT_PAYMENT_INVALID" }); expect(f.writes).toEqual([]);
  });
  it("retains idempotent completion without rewriting existing records", async () => {
    const f = fixture(true); const first = await f.run(), before = JSON.stringify(f.records), count = f.writes.length;
    expect(await f.run()).toMatchObject({ visitId: first.visitId, alreadyCompleted: true });
    expect(f.writes).toHaveLength(count); expect(JSON.stringify(f.records)).toBe(before);
  });
  it("introduces no financial writer, synchronization or resolver", () => {
    const source = readFileSync(new URL("./pharmacyVisitCompletionService.ts", import.meta.url), "utf8");
    for (const name of ["syncVisitPaymentCollection", "readCertifiedOpenReceivables", "prepareCollectionSubmission", "createSubmittedCollection", "prepareVerification", "persistVerification", "calculatePaymentReversal", "outstandingBalance", "PAY_${visitId}"]) expect(source).not.toContain(name);
    expect(source).toContain("resolveOperationalScopeForActor");
    for (const collection of ["payments", "paymentCollections", "paymentAllocations", "customerLedgerEntries", "customerFinancialProfiles"]) expect(source).not.toContain(`collection("${collection}")`);
  });
});
