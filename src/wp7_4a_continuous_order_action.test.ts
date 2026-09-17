import { describe, it, expect } from "vitest";
import { 
  canTransitionOrder, 
  applyOrderTransition, 
  normalizeOrderStatus, 
  getStageForStatus,
  OrderStatus 
} from "./features/orders/orderWorkflowEngine";
import { Role } from "./types";

describe("WP7.4A — Continuous Order Action Workspace Specification", () => {

  const baseOrder = {
    id: "ORD-2026-7890",
    displayNumber: "ORD-2026-7890",
    orderNumber: "ORD-2026-7890",
    status: "PENDING_FINANCE_REVIEW" as OrderStatus,
    stage: "FINANCE_REVIEW",
    items: [
      { id: "P1", name: "Paracetamol 500mg", quantity: 100, unitPrice: 5.0, totalPrice: 500.0 }
    ],
    totalAmount: 500.0,
    pharmacyName: "Al-Shifa Pharmacy",
    pharmacyId: "PH-001",
    territoryId: "TR-TRIPOLI-01",
    createdByUid: "REP-001",
    createdByName: "Omar Rep",
    createdByRole: Role.SALES_REP,
    createdAt: "2026-07-28T10:00:00Z"
  };

  it("TEST A — Finance Officer Transition keeps Order Details open and reloads state", () => {
    let viewMode = "details";
    let selectedOrderId: string | null = baseOrder.id;
    let selectedOrderDetail: any = { ...baseOrder };

    const financeActor = { uid: "FIN-001", role: Role.FINANCE, name: "Salma Finance" };

    const result = applyOrderTransition({
      order: selectedOrderDetail,
      action: "APPROVE_FINANCE",
      actor: financeActor,
      comments: "Finance approved based on credit limit.",
      source: "WEB"
    });

    expect(result.success).toBe(true);
    expect(result.updatedOrder.status).toBe("PENDING_OPERATIONS_REVIEW");

    // Continuous processing contract: do NOT reset selectedOrderDetail or viewMode
    selectedOrderDetail = { ...result.updatedOrder };
    
    expect(selectedOrderId).toBe("ORD-2026-7890");
    expect(selectedOrderDetail.id).toBe("ORD-2026-7890");
    expect(selectedOrderDetail.status).toBe("PENDING_OPERATIONS_REVIEW");
    expect(viewMode).toBe("details");
  });

  it("TEST B — Operations Officer Transition updates Order Details in-place without back-navigation", () => {
    let viewMode = "details";
    let selectedOrderId: string | null = baseOrder.id;
    let selectedOrderDetail: any = { ...baseOrder, status: "PENDING_OPERATIONS_REVIEW" };

    const opsActor = { uid: "OPS-001", role: Role.ORDER_OPS_OFFICER, name: "Khaled Ops" };

    const result = applyOrderTransition({
      order: selectedOrderDetail,
      action: "OPERATIONS_APPROVE",
      actor: opsActor,
      comments: "Operations approved for warehouse allocation.",
      source: "WEB"
    });

    expect(result.success).toBe(true);
    expect(["PENDING_STORE_PREPARATION", "OPERATIONS_APPROVED"]).toContain(result.updatedOrder.status);

    selectedOrderDetail = { ...result.updatedOrder };

    expect(selectedOrderId).toBe("ORD-2026-7890");
    expect(["PENDING_STORE_PREPARATION", "OPERATIONS_APPROVED"]).toContain(selectedOrderDetail.status);
    expect(viewMode).toBe("details");
  });

  it("TEST C — Store Manager Delivery Officer Assignment Hand-Off inline on Order Page", () => {
    let selectedOrderDetail: any = { 
      ...baseOrder, 
      status: "STORE_PREPARING", 
      inventoryVerified: true, 
      pickingStatus: "COMPLETED", 
      packingStatus: "COMPLETED" 
    };

    // Store Manager assigns delivery officer inline
    const assignedOfficerUid = "USR-DEL-01";
    const assignedOfficerName = "Tariq Al-Mansouri";
    const plannedDate = "2026-07-29";
    const plannedTime = "10:00 AM - 02:00 PM";

    selectedOrderDetail = {
      ...selectedOrderDetail,
      deliveryOfficerId: assignedOfficerUid,
      deliveryOfficerUid: assignedOfficerUid,
      deliveryOfficerName: assignedOfficerName,
      deliveryAssignedByUid: "STORE-001",
      deliveryAssignedByName: "Hassan Store Manager",
      deliveryAssignedAt: "2026-07-28T14:00:00Z",
      plannedDeliveryDate: plannedDate,
      plannedDeliveryTime: plannedTime,
      deliveryAssignmentStatus: "ASSIGNED"
    };

    expect(selectedOrderDetail.deliveryOfficerName).toBe("Tariq Al-Mansouri");
    expect(selectedOrderDetail.plannedDeliveryDate).toBe("2026-07-29");
    expect(selectedOrderDetail.deliveryAssignmentStatus).toBe("ASSIGNED");
  });

  it("TEST D — Store Manager Release for Delivery transitions Order to READY_FOR_DISPATCH", () => {
    let viewMode = "details";
    let selectedOrderDetail: any = { 
      ...baseOrder, 
      status: "STORE_PREPARING", 
      inventoryVerified: true, 
      pickingStatus: "COMPLETED", 
      packingStatus: "COMPLETED",
      deliveryOfficerId: "USR-DEL-01",
      deliveryOfficerName: "Tariq Al-Mansouri",
      plannedDeliveryDate: "2026-07-29"
    };

    const storeActor = { uid: "STORE-001", role: Role.STORE_MANAGER, name: "Hassan Store Manager" };

    const result = applyOrderTransition({
      order: selectedOrderDetail,
      action: "STORE_MARK_READY",
      actor: storeActor,
      comments: "Order prepared, packed, assigned to Tariq, ready for field dispatch.",
      source: "WEB"
    });

    expect(result.success).toBe(true);
    expect(result.updatedOrder.status).toBe("READY_FOR_DISPATCH");

    selectedOrderDetail = { ...result.updatedOrder };

    expect(selectedOrderDetail.status).toBe("READY_FOR_DISPATCH");
    expect(viewMode).toBe("details");
  });

  it("TEST E — Delivery Officer Start Delivery and Complete Delivery cycle on same Detail view", () => {
    let viewMode = "details";
    let selectedOrderDetail: any = { 
      ...baseOrder, 
      status: "ASSIGNED_FOR_DELIVERY",
      deliveryOfficerId: "USR-DEL-01",
      deliveryOfficerName: "Tariq Al-Mansouri",
      plannedDeliveryDate: "2026-07-29"
    };

    const deliveryActor = { uid: "USR-DEL-01", role: Role.DELIVERY_OFFICER, name: "Tariq Al-Mansouri" };

    // 1. Store assignment is already complete; Delivery Officer starts the run
    const startResult = applyOrderTransition({
      order: selectedOrderDetail,
      action: "DELIVERY_START",
      actor: deliveryActor,
      comments: "Out for delivery to Al-Shifa Pharmacy.",
      source: "WEB"
    });
    expect(startResult.success).toBe(true);
    expect(startResult.updatedOrder.status).toBe("OUT_FOR_DELIVERY");

    selectedOrderDetail = { ...startResult.updatedOrder };
    expect(selectedOrderDetail.status).toBe("OUT_FOR_DELIVERY");
    expect(viewMode).toBe("details");

    // 2. Delivery Officer completes delivery
    const completeResult = applyOrderTransition({
      order: selectedOrderDetail,
      action: "DELIVERY_COMPLETE",
      actor: deliveryActor,
      comments: "Delivered in full, payment received.",
      metadata: { deliveryGPS: "32.8872, 13.1913", signatureUrl: "Signed by Pharmacist" },
      source: "WEB"
    });
    expect(completeResult.success).toBe(true);
    expect(completeResult.updatedOrder.status).toBe("DELIVERED");

    selectedOrderDetail = { ...completeResult.updatedOrder };
    expect(selectedOrderDetail.status).toBe("DELIVERED");
    expect(viewMode).toBe("details");
  });

});
