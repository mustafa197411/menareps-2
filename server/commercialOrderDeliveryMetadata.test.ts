import { describe, expect, it, vi } from "vitest";
import { canonicalDeliveryMetadata, executeCommercialOrderTransition } from "./commercialOrderTransitionService";
import { applyOrderTransition } from "../src/features/orders/orderWorkflowEngine";
import { ENTERPRISE_WORKFLOW_TEMPLATE } from "../src/features/orders/orderWorkflowTemplate";
import { deterministicReservationId } from "./inventoryReservationService";

vi.mock("./operationalScopeRepository", () => ({
  createFirestoreOperationalScopeRepository: vi.fn(),
  resolveOperationalScopeForActor: vi.fn(async () => ({
    authorized: true, queryPlan: { denyAll: false }, areaIds: ["AREA-SYNTHETIC"], role: "Delivery Officer",
  })),
}));

describe("WP110 canonical Delivery recipient persistence", () => {
  it.each(["CONSUMED", "ACTIVE"])("completion verifies %s reservation without consuming inventory again", async reservationStatus => {
    const orderId = "ORDER-SYNTHETIC";
    const reservationId = deterministicReservationId(orderId, "PRODUCT-SYNTHETIC");
    const order = {
      id: orderId, createdByUid: "REP-SYNTHETIC", deliveryOfficerUid: "DELIVERY-SYNTHETIC",
      areaId: "AREA-SYNTHETIC", inventoryContractVersion: 2, reservationIds: [reservationId],
      status: "OUT_FOR_DELIVERY", stage: "DELIVERY", deliveryStatus: "OUT_FOR_DELIVERY",
      paidStatus: "Unpaid", paidAmount: 0, total: 120, updatedAt: "VERSION-SYNTHETIC", history: [],
    };
    const records: Record<string, any> = {
      [`orders/${orderId}`]: order,
      "users/DELIVERY-SYNTHETIC": { name: "Synthetic Delivery Actor" },
      "orderWorkflowTemplates/ENTERPRISE_V1": ENTERPRISE_WORKFLOW_TEMPLATE,
      [`inventoryReservations/${reservationId}`]: {
        reservationId, orderId, productId: "PRODUCT-SYNTHETIC", status: reservationStatus,
        saleableReservedQuantity: 12, promotionalReservedQuantity: 6, totalReservedQuantity: 18,
      },
    };
    const snapshot = (path: string) => ({ id: path.split("/")[1], exists: path in records, data: () => records[path] });
    const tx = {
      get: vi.fn(async (ref: any) => snapshot(ref.path)),
      set: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(),
    };
    const db: any = {
      collection: (name: string) => ({ doc: (id: string) => ({ path: `${name}/${id}`, get: async () => snapshot(`${name}/${id}`) }) }),
      runTransaction: async (callback: any) => callback(tx),
    };
    const result = await executeCommercialOrderTransition("DELIVERY-SYNTHETIC", {
      orderId, action: "DELIVERY_COMPLETE", expectedVersion: order.updatedAt,
      metadata: { recipientName: "Synthetic Recipient" },
    }, { db });
    expect(tx.get.mock.calls.map(([ref]) => ref.path)).toContain(`inventoryReservations/${reservationId}`);
    expect(tx.get.mock.calls.map(([ref]) => ref.path).some(path => path.startsWith("products/"))).toBe(false);
    expect(tx.update).not.toHaveBeenCalled();
    expect(tx.delete).not.toHaveBeenCalled();
    if (reservationStatus === "CONSUMED") {
      expect(result.success).toBe(true);
      expect(tx.set).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ path: `orders/${orderId}` }), expect.objectContaining({
        paidStatus: "Unpaid", paidAmount: 0, status: "DELIVERED", stage: "CLOSED",
        deliveryStatus: "DELIVERED", deliveryOutcome: "DELIVERED",
      }), { merge: true });
      expect(tx.create).toHaveBeenCalledTimes(1);
      expect(tx.create.mock.calls[0][0].path).toMatch(/^auditLogs\//);
    } else {
      expect(result).toMatchObject({ success: false, code: "VERSION2_DELIVERY_RESERVATION_NOT_CONSUMED" });
      expect(tx.set).not.toHaveBeenCalled();
      expect(tx.create).not.toHaveBeenCalled();
    }
  });

  it("requires and sanitizes the governed recipient without accepting actor identity", () => {
    expect(canonicalDeliveryMetadata("DELIVERY_COMPLETE", {})).toEqual({ code: "DELIVERY_RECIPIENT_REQUIRED" });
    expect(canonicalDeliveryMetadata("DELIVERY_COMPLETE", {
      recipientName: "  Arbitrary Recipient  ",
      deliveredByUid: "forged-actor",
      deliverySignature: "recipient-signature",
    })).toEqual({ metadata: {
      recipientName: "Arbitrary Recipient",
      deliverySignature: "recipient-signature",
    } });
  });

  it("persists recipient and server actor through the terminal transition exactly once", () => {
    const result = applyOrderTransition({
      order: {
        id: "ORDER-A", displayNumber: "SO-A", status: "ASSIGNED_FOR_DELIVERY", stage: "DELIVERY",
        createdByUid: "REP-A", deliveryOfficerUid: "DELIVERY-A", history: [], total: 10,
      },
      action: "DELIVERY_COMPLETE",
      actor: { uid: "DELIVERY-A", role: "Delivery Officer", name: "Arbitrary Delivery Actor" },
      orderPermissions: ["ORDER_DELIVERY_COMPLETE"],
      metadata: { recipientName: "Arbitrary Recipient", deliveredByUid: "forged-actor" },
      source: "BACKEND",
    });
    expect(result.success).toBe(true);
    expect(result.updatedOrder).toMatchObject({
      status: "DELIVERED", stage: "CLOSED", recipientName: "Arbitrary Recipient", deliveredByUid: "DELIVERY-A",
    });
    expect(result.updatedOrder.history).toHaveLength(1);
    expect(result.updatedOrder.history[0]).toMatchObject({ action: "DELIVERY_COMPLETE", actorUid: "DELIVERY-A", toStatus: "DELIVERED", toStage: "CLOSED" });
  });

  it("denies an unrelated Delivery actor through segregation/assignment authority", () => {
    const result = applyOrderTransition({
      order: { id: "ORDER-A", status: "ASSIGNED_FOR_DELIVERY", createdByUid: "DELIVERY-B", deliveryOfficerUid: "DELIVERY-A", history: [] },
      action: "DELIVERY_COMPLETE",
      actor: { uid: "DELIVERY-B", role: "Delivery Officer" },
      orderPermissions: ["ORDER_DELIVERY_COMPLETE"],
      metadata: { recipientName: "Forged Recipient" },
    });
    expect(result.success).toBe(false);
    expect(result.reasonCode).toBe("SEGREGATION_OF_DUTIES_VIOLATION");
  });
});
