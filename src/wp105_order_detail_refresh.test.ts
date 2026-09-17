import fs from "node:fs";
import { describe, expect, it } from "vitest";

const salesOrders = fs.readFileSync(new URL("./components/sales/SalesOrders.tsx", import.meta.url), "utf8");
const readService = fs.readFileSync(new URL("../server/commercialReadService.ts", import.meta.url), "utf8");
const transitionService = fs.readFileSync(new URL("../server/commercialOrderTransitionService.ts", import.meta.url), "utf8");

describe("WP105 authoritative post-transition order detail refresh", () => {
  it("rehydrates the selected order through the governed commercial backend read", () => {
    expect(salesOrders).toContain('fetchScopedCommercialRead(firebaseUser, { kind: "ORDERS", orderId })');
    expect(salesOrders).not.toContain("getOrderById(orderId)");
  });

  it("requires one exact authoritative order rather than retaining stale state", () => {
    expect(salesOrders).toContain("result.orders.length === 1 ? result.orders[0] : null");
    expect(readService).toContain("selectRequestedOrder(authorizedOrders, request.orderId)");
  });

  it("keeps backend transition authority and direct client restrictions unchanged", () => {
    expect(salesOrders).toContain("transitionCommercialOrder(firebaseUser");
    expect(transitionService).toContain("runTransaction");
    expect(salesOrders).not.toContain('updateDoc(doc(db, "orders"');
  });
});
