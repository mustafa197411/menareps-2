import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createOrderFromCompletedPharmacyVisit } from "./lib/pharmacyOrderCreateClient";

describe("WP98 commercial order authority contract", () => {
  it("uses authenticated backend creation with visit identity only", async () => {
    const user = { getIdToken: vi.fn(async () => "TOKEN") };
    const fetcher = vi.fn(async (_url, init) => { expect(JSON.parse(String(init?.body))).toEqual({ visitId: "VISIT-X" }); return new Response(JSON.stringify({ success: true, orderId: "ORDER-X", displayNumber: "ZX-SO-2030-000001", alreadyCreated: false }), { status: 200 }); });
    await expect(createOrderFromCompletedPharmacyVisit("VISIT-X", fetcher as typeof fetch, user)).resolves.toMatchObject({ orderId: "ORDER-X" });
    expect(fetcher).toHaveBeenCalledWith("/api/pharmacy-orders/create", expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer TOKEN" }) }));
  });

  it("removes browser order persistence and denies direct Rules creation", () => {
    const completion = fs.readFileSync(new URL("./features/pharmacyVisit/services/completePharmacyVisitV2.ts", import.meta.url), "utf8");
    const backendCompletion = fs.readFileSync(new URL("../server/pharmacyVisitCompletionService.ts", import.meta.url), "utf8");
    const rules = fs.readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
    expect(completion).not.toContain("createOrderFromCompletedPharmacyVisit");
    expect(completion).not.toContain('doc(db, "orders", orderId)');
    expect(backendCompletion).toContain('tx.create(db.collection("orders").doc(orderId), order)');
    expect(rules).toMatch(/match \/orders\/\{orderId\}[\s\S]*?allow create: if false;/);
  });

  it("fails closed for workflow configuration and distinguishes read errors from zero results", () => {
    const backend = fs.readFileSync(new URL("../server/commercialOrderTransitionService.ts", import.meta.url), "utf8");
    const ui = fs.readFileSync(new URL("./components/sales/SalesOrders.tsx", import.meta.url), "utf8");
    expect(backend).toContain("requireCanonicalWorkflowTemplate");
    expect(backend).not.toMatch(/isOrderWorkflowTemplate\(candidate\) \? candidate : ENTERPRISE_WORKFLOW_TEMPLATE/);
    expect(ui).toContain('setOrdersReadError(error instanceof Error ? error.message');
    expect(ui).not.toMatch(/SCOPED_ORDER_READ_ERROR[^\n]*setOrders\(\[\]\)/);
    expect(ui).toContain('data-testid="commercial-orders-load-error"');
  });
});
