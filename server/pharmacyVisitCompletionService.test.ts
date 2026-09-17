import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { canonicalizePersistedPharmacyVisitOrder, canonicalizeStockRequestLine, collectPharmacyVisitProductIds } from "./pharmacyVisitCompletionService";

describe("Pharmacy Visit completion persistence", () => {
  it("excludes transient productAvailability from the authoritative order allowlist", () => {
    const order = {
      lines: [{ canonicalProductId: "FORGED" }],
      productAvailability: [{ productId: "P1", availabilityState: "AVAILABLE", canOrder: true }],
      inputSource: "MANUAL",
      subtotalPreview: 999,
      currency: "FORGED",
      updatedAt: "2030-01-01T00:00:00.000Z",
    } as any;
    const persisted = canonicalizePersistedPharmacyVisitOrder(order, [{ canonicalProductId: "P1", quantity: 1 }], 7, "TST")!;
    expect(persisted).not.toHaveProperty("productAvailability");
    expect(persisted).toMatchObject({ lines: [{ canonicalProductId: "P1", quantity: 1 }], inputSource: "MANUAL", subtotalPreview: 7, currency: "TST" });
  });
});

describe("Pharmacy Visit confirmed zero-stock requests", () => {
  const product = { id: "P1", sku: "SKU1", code: "SKU1", name: "Product", stockQuantity: 0, active: true };
  const line = { canonicalProductId: "P1", canonicalSkuId: "SKU1", requestedQuantity: 1, approvedOrderQty: 0, warehouseAvailableQty: 0, unfulfilledQty: 1, source: "CONFIRMED_ZERO_STOCK", priority: "NORMAL", reason: "LOW_STOCK", userConfirmed: true, backendRevalidationRequired: true };

  it("accepts a valid confirmed-zero-stock request", () => expect(canonicalizeStockRequestLine(line, product, 0)).toMatchObject({ productId: "P1", requestedQty: 1, approvedOrderQty: 0, unfulfilledQty: 1, source: "CONFIRMED_ZERO_STOCK" }));
  it("rejects a positive-stock product as a confirmed-zero-stock request", () => expect(() => canonicalizeStockRequestLine(line, { ...product, stockQuantity: 1 }, 0)).toThrow("PHARMACY_VISIT_STOCK_REQUEST_INVALID"));
  it.each([0, -1])("rejects non-positive requested quantity %s", requestedQuantity => expect(() => canonicalizeStockRequestLine({ ...line, requestedQuantity, unfulfilledQty: requestedQuantity }, product, 0)).toThrow("PHARMACY_VISIT_STOCK_REQUEST_INVALID"));
  it("rejects inconsistent unfulfilled quantity", () => expect(() => canonicalizeStockRequestLine({ ...line, unfulfilledQty: 0 }, product, 0)).toThrow("PHARMACY_VISIT_STOCK_REQUEST_INVALID"));
  it("rejects forged product identity", () => expect(() => canonicalizeStockRequestLine({ ...line, canonicalSkuId: "FORGED" }, product, 0)).toThrow("PHARMACY_VISIT_STOCK_REQUEST_INVALID"));
  it("keeps the zero-stock product out of order IDs while loading it for shortage validation", () => expect(collectPharmacyVisitProductIds({ order: { lines: [] }, stock: { requestLines: [line] } } as any)).toEqual(["P1"]));
  it("supports a valid order plus a distinct valid shortage request", () => expect(collectPharmacyVisitProductIds({ order: { lines: [{ canonicalProductId: "P2" }] }, stock: { requestLines: [line] } } as any)).toEqual(["P2", "P1"]));
  it("supports an empty order plus a valid shortage request", () => expect(collectPharmacyVisitProductIds({ stock: { requestLines: [line] } } as any)).toEqual(["P1"]));
  it("preserves a requested quantity greater than one through completion persistence", () => expect(canonicalizeStockRequestLine({ ...line, requestedQuantity: 7, unfulfilledQty: 7 }, product, 0)).toMatchObject({ requestedQty: 7, approvedOrderQty: 0, unfulfilledQty: 7 }));
  it("supports independent quantities for multiple zero-stock products", () => {
    const second = { ...product, id: "P2", sku: "SKU2", code: "SKU2" };
    expect([
      canonicalizeStockRequestLine({ ...line, requestedQuantity: 2, unfulfilledQty: 2 }, product, 0),
      canonicalizeStockRequestLine({ ...line, canonicalProductId: "P2", canonicalSkuId: "SKU2", requestedQuantity: 5, unfulfilledQty: 5 }, second, 0),
    ].map(request => request.requestedQty)).toEqual([2, 5]);
  });
  it("keeps stockRequests as the standalone destination and does not write commercialShortageDemands", () => {
    const source = fs.readFileSync(new URL("./pharmacyVisitCompletionService.ts", import.meta.url), "utf8");
    expect(source).toContain('db.collection("stockRequests")');
    expect(source).not.toContain("commercialShortageDemands");
  });
});
