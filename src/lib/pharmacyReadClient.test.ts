import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Pharmacy } from "../types";
import { createPharmacyReadController, fetchScopedPharmacies } from "./pharmacyReadClient";

const pharmacy = (id: string): Pharmacy => ({ id, name: id, territory: "A1", region: "R1", address: "Street", outstandingBalance: 0, areaId: "A1" });
const tokenProvider = { getIdToken: vi.fn(async () => "SECRET") };
afterEach(() => vi.restoreAllMocks());

describe("WP5.2F.4 pharmacy READ client and migration boundary", () => {
  it("15. frontend network failure clears pharmacy data", async () => {
    const controller = createPharmacyReadController(async () => { throw new Error("offline"); });
    await controller.load("UID1", tokenProvider);
    expect(controller.getState()).toEqual({ status: "ERROR", actorUid: "UID1", pharmacies: [] });
  });
  it("16. UID transition clears old pharmacy data", async () => {
    let resolveSecond!: (value: { authorized: boolean; pharmacies: Pharmacy[] }) => void;
    const second = new Promise<{ authorized: boolean; pharmacies: Pharmacy[] }>((resolve) => { resolveSecond = resolve; });
    const loader = vi.fn().mockResolvedValueOnce({ authorized: true, pharmacies: [pharmacy("OLD")] }).mockReturnValueOnce(second);
    const controller = createPharmacyReadController(loader); await controller.load("UID1", tokenProvider);
    const pending = controller.load("UID2", tokenProvider);
    expect(controller.getState()).toEqual({ status: "LOADING", actorUid: "UID2", pharmacies: [] });
    resolveSecond({ authorized: true, pharmacies: [pharmacy("NEW")] }); await pending;
    expect(controller.getState().pharmacies.map((item) => item.id)).toEqual(["NEW"]);
  });
  it("17. malformed endpoint response fails closed", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ authorized: true }), { status: 200 }));
    const controller = createPharmacyReadController((user) => fetchScopedPharmacies(user, fetchMock));
    await controller.load("UID1", tokenProvider);
    expect(controller.getState()).toEqual({ status: "ERROR", actorUid: "UID1", pharmacies: [] });
  });
  it("18. no legacy pharmacy listener fallback remains", () => {
    const app = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    expect(app).toContain("createPharmacyReadController");
    expect(app).not.toContain("PHARMACY_LISTENER_ATTACHED");
  });
  it("19. PharmacyList no longer uses legacy security scope as directory authority", () => {
    const source = fs.readFileSync(new URL("../components/PharmacyList.tsx", import.meta.url), "utf8");
    expect(source).not.toContain("applySecurityScope"); expect(source).toContain("setLocalPharmacies(pharmacies)");
  });
  it("20. visit/order/payment/sample execution logic remains unchanged", () => {
    const list = fs.readFileSync(new URL("../components/PharmacyList.tsx", import.meta.url), "utf8");
    const visit = fs.readFileSync(new URL("../components/PharmacyVisit.tsx", import.meta.url), "utf8");
    const salesOrders = fs.readFileSync(new URL("../components/sales/SalesOrders.tsx", import.meta.url), "utf8");
    expect(list).toContain("createPharmacyOrderReadController");
    expect(list).not.toMatch(/onSnapshot\(collection\(db, ["']orders["']\)/);
    expect(visit).toContain("onCompletePharmacyVisit(completedVisit)");
    expect(visit).toContain("paymentCollected: amountCollected > 0 ? amountCollected : undefined");
    expect(visit).toContain('if (samplesLeft) materials.push("Product Samples")');
    expect(visit).not.toContain("pharmacyOrderReadClient");
    expect(visit).not.toContain("pharmacyReadClient");
    expect(salesOrders).toContain("applyOrderTransition");
    expect(salesOrders).toContain('fetchScopedCommercialRead(auth.currentUser, { kind: "ORDERS" })');
  });
  it("21. action permissions are not broadened", () => {
    const app = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    expect(app).toContain("onAddPharmacy={handleAddPharmacy}"); expect(app).toContain("onUpdatePharmacy={handleUpdatePharmacy}");
    expect(app).not.toContain("operationalScopeSession.scope?.role");
  });
  it("22. backend contains only bounded pharmacy area queries", () => {
    const source = fs.readFileSync(new URL("../../server/pharmacyReadService.ts", import.meta.url), "utf8");
    expect(source).toContain('.where("areaId", "in", canonicalAreaIds)');
    expect(source).not.toMatch(/collection\("pharmacies"\)\s*\.get\s*\(/);
  });
});
