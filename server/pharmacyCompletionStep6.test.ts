import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executePharmacyVisitCompletion } from "./pharmacyVisitCompletionService";
import { offerInputFingerprint } from "../src/features/pharmacyVisit/services/canonicalOfferVisit";
import { OFFER_CALCULATION_VERSION } from "../src/features/offers/offerCalculation";
vi.mock("../src/features/pharmacyVisit/validation/validateStep6", () => ({ validateStep6: () => ({ isValid: true }) }));
vi.mock("./operationalScopeRepository", () => ({ createFirestoreOperationalScopeRepository: vi.fn(), resolveOperationalScopeForActor: async (uid: string) => ({ actorUid: uid, productGroupIds: [], authorized: true, queryPlan: {}, role: "Sales Representative", areaIds: ["A"], productIds: ["P"] }) }));
vi.mock("../src/lib/marketSettings", () => ({ validateMarketSettings: () => [], validateBusinessDocumentCode: () => true, marketDateForInstant: () => "2026-06-01" }));
vi.mock("./pharmacyOrderCreateService", () => ({ requireCanonicalWorkflowTemplate: () => {} }));
const offer = (id = "O") => ({ id, schemaVersion: 1, offerVersion: 1, revision: 1, code: id, name: id, type: "PRODUCT_PERCENTAGE", lifecycleStatus: "ACTIVE", productScope: { mode: "ALL_PRODUCTS", productIds: [] }, benefit: { kind: "PRODUCT_PERCENTAGE", percentage: 10, base: "ELIGIBLE_PAID_PRODUCT_LINES" }, eligibility: { audienceType: "MY_SALES_TEAM", startAt: "2026-01-01", endAt: "2027-01-01" }, stackingPolicy: { mode: "NO_STACKING", priority: 1, maximumProductOrQuantityOffersPerPaidLine: 1, maximumInvoicePercentageOffersPerInvoice: 1 }, createdAt: "2026-01-01", updatedAt: "2026-01-01", createdBy: "MANAGER", updatedBy: "MANAGER" });
function fixture(patch: Record<string, any> = {}, selected = [offer()]) {
  const records: Record<string, any> = { "rolePermissions/Sales Representative": { create: true }, "pharmacies/PH": { areaId: "A", companyId: "CO" }, "areas/A": { countryId: "C", districtId: "D", cityId: "CITY" }, "countries/C": {}, "districts/D": { countryId: "C" }, "cities/CITY": { countryId: "C", districtId: "D" }, "products/P": { price: 1, stockQuantity: 100 }, "users/REP": { role: "Sales Representative", managerId: "MANAGER" }, "users/MANAGER": { role: "Sales Supervisor", managerId: "TOP" }, "users/TOP": { role: "Super Admin" }, ...Object.fromEntries(selected.map(o => [`offers/${o.id}`, o])), ...patch };
  const snapshot = (key: string) => ({ id: key.split("/")[1], exists: key in records, data: () => records[key] });
  const reads: string[] = [], writes = vi.fn();
  const tx: any = { get: vi.fn(async (ref: any) => { reads.push(ref.key); return ref.key === "marketSettings" ? { size: 1, docs: [{ id: "M", data: () => ({ currencyCode: "TST", decimalPlaces: 2, businessDocumentCode: "ZX" }) }] } : snapshot(ref.key); }), set: writes, create: writes, update: writes };
  const db: any = { collection: (key: string) => ({ key, where() { return this; }, doc(id: string) { return { key: `${key}/${id}`, get: async () => snapshot(`${key}/${id}`) }; } }), runTransaction: vi.fn(async fn => fn(tx)) };
  const fingerprint = offerInputFingerprint({ currencyCode: "TST", decimalPlaces: 2, roundingMode: "DECIMAL_HALF_UP", paidLines: [{ lineId: "L", productId: "P", quantity: 1, unitPrice: 1 }], selectedOffers: selected });
  const draft: any = { draftId: "DRAFT", repUid: "REP", pharmacyId: "PH", areaId: "A", order: { lines: [{ id: "L", canonicalProductId: "P", quantity: 1, unitPricePreview: 1 }] }, offerIntent: selected.map(o => ({ offerId: o.id, offerVersion: 1, calculationVersion: OFFER_CALCULATION_VERSION, selected: true, confirmed: true, confirmedAt: "2026-06-01", inputFingerprint: fingerprint })) };
  return { db, reads, writes, draft, run: () => executePharmacyVisitCompletion("REP", { draft }, { db, now: () => new Date("2026-06-01") }) };
}
beforeEach(() => { vi.stubEnv("OFFER_RUNTIME_MAX_ACTIVE_DOCUMENTS", "250"); vi.stubEnv("OFFER_RUNTIME_MAX_AUDIENCE_LOOKUPS", "3000"); });
afterEach(() => vi.unstubAllEnvs());
describe("Step 6 completion transaction failure atomicity", () => {
  it("persists server-derived price, currency, Offer and transaction provenance", async () => {
    const f = fixture();
    await expect(f.run()).resolves.toMatchObject({ success: true, authoritativeTotals: { grossSubtotal: 1, netSubtotal: 0.9, currencyCode: "TST" } });
    const order = f.writes.mock.calls.find(([ref]) => ref.key.startsWith("orders/"))![1];
    expect(order.items[0]).toMatchObject({ price: 1, total: 0.9, appliedOfferIds: ["O"] });
    expect(order).toMatchObject({ countryId: "C", marketId: "M", currencyCode: "TST" });
    expect(order.offerCalculation).toMatchObject({ currencyCode: "TST", decimalPlaces: 2, roundingMode: "DECIMAL_HALF_UP", calculationVersion: OFFER_CALCULATION_VERSION, selectedOfferIds: ["O"], paidLines: [expect.objectContaining({ unitPrice: 1 })] });
    const reservation = f.writes.mock.calls.find(([ref]) => ref.key.startsWith("inventoryReservations/"))![1];
    expect(reservation).toMatchObject({ companyId: "CO", countryId: "C", marketId: "M" });
  });
  it("independently reads stored audience and changed manager in the transaction", async () => {
    const f = fixture({ "users/REP": { role: "Sales Representative", managerId: "UNRELATED" } });
    await expect(f.run()).rejects.toMatchObject({ code: "PHARMACY_VISIT_OFFER_NOT_APPLICABLE" });
    expect(f.reads).toContain("offers/O"); expect(f.reads).toContain("users/REP"); expect(f.reads).not.toContain("products/P"); expect(f.writes).not.toHaveBeenCalled();
  });
  it.each([null, "1", -1, undefined])("invalid reread price %s cannot write", async price => {
    const f = fixture({ "products/P": { price, stockQuantity: 100 } });
    await expect(f.run()).rejects.toMatchObject({ code: "PHARMACY_VISIT_PRODUCT_PRICE_INVALID" }); expect(f.writes).not.toHaveBeenCalled();
  });
  it.each([2, 999])("stale or forged preview %s receives the same 409 without writes", async preview => {
    const f = fixture(); f.draft.order.lines[0].unitPricePreview = preview;
    await expect(f.run()).rejects.toMatchObject({ status: 409, code: "PHARMACY_VISIT_PRODUCT_PRICE_CHANGED" }); expect(f.reads).toContain("products/P"); expect(f.writes).not.toHaveBeenCalled();
  });
  it("fails completion audience lookup 3001 explicitly without writes", async () => {
    const patch: Record<string, any> = { "users/REP": { role: "Sales Representative", managerId: "N0" } };
    for (let i = 0; i < 3000; i++) patch[`users/N${i}`] = { role: "Sales Supervisor", managerId: `N${i + 1}` };
    const f = fixture(patch);
    await expect(f.run()).rejects.toMatchObject({ code: "HIERARCHY_DISCOVERY_CAPACITY_EXCEEDED", httpStatus: 413 });
    expect(f.writes).not.toHaveBeenCalled(); expect(f.reads).not.toContain("products/P");
  });
  it("rejects conflicts without persisting a silent winner", async () => {
    const f = fixture({}, [offer("O1"), offer("O2")]);
    await expect(f.run()).rejects.toMatchObject({ code: "PHARMACY_VISIT_OFFER_CONFLICT" }); expect(f.writes).not.toHaveBeenCalled();
  });
});

describe("completion creator Product loss and integrity atomicity", () => {
  it.each([
    { "users/MANAGER": { role: "Sales Supervisor", managerId: "MANAGER" } },
    { "users/MANAGER": { role: "Sales Supervisor", managerId: "REP" } },
    { "users/REP": { id: "FORGED", role: "Sales Representative", managerId: "MANAGER" } },
  ])("rejects malformed transaction identities without any writes", async patch => {
    const f = fixture(patch);
    await expect(f.run()).rejects.toThrow();
    expect(f.writes).not.toHaveBeenCalled();
  });
  it("cannot switch to editor scope after creator loses a Product", async () => {
    const f = fixture({}, [{ ...offer(), updatedBy: "EDITOR" }]);
    await expect(executePharmacyVisitCompletion("REP", { draft: f.draft }, { db: f.db, now: () => new Date("2026-06-01"), offerScopeDependencies: {
      readMarket: async () => ({ status: "UNRESOLVED" }),
      resolveScope: async uid => ({ actorUid: uid, authorized: true, productIds: uid === "MANAGER" ? ["OTHER-PRODUCT"] : ["P"], productGroupIds: [], queryPlan: { denyAll: false } } as any),
    } })).rejects.toMatchObject({ code: "PHARMACY_VISIT_OFFER_NOT_APPLICABLE" });
    expect(f.writes).not.toHaveBeenCalled();
  });
});

describe("completed Visit confirmation audit", () => {
  it("preserves the accepted confirmation and calculation without restoration sanitization", async () => {
    const f = fixture(); await f.run();
    const visit = f.writes.mock.calls.find(([ref]) => ref.key.startsWith("pharmacyVisits/"))![1];
    expect(visit.offerIntent).toEqual(f.draft.offerIntent);
    expect(visit.offerIntent[0]).toMatchObject({ confirmed: true, confirmedAt: "2026-06-01" });
    expect(visit.offerCalculation).toMatchObject({ selectedOfferIds: ["O"], netSubtotal: 0.9 });
  });
  it.each(["unconfirmed", "stale"])("still rejects %s confirmation before writes", async kind => {
    const f = fixture();
    if (kind === "unconfirmed") f.draft.offerIntent[0].confirmed = false;
    else f.draft.offerIntent[0].inputFingerprint = "stale";
    await expect(f.run()).rejects.toMatchObject({ code: kind === "unconfirmed" ? "PHARMACY_VISIT_OFFER_CONFIRMATION_REQUIRED" : "PHARMACY_VISIT_OFFER_CONFIRMATION_STALE" });
    expect(f.writes).not.toHaveBeenCalled();
  });
});
