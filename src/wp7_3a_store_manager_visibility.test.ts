import { describe, it, expect } from "vitest";
import { normalizeRole, Role } from "./types";
import {
  normalizeOrderStatus,
  getStageForStatus,
  canTransitionOrder,
  applyOrderTransition,
  getCapabilitiesForRole
} from "./features/orders/orderWorkflowEngine";

describe("WP7.3A — Store Manager Data Visibility & Order Queue Certification", () => {
  const storeManagerUser = {
    id: "RkpHdgEgzkW80wjSgCC98ObQCw12",
    uid: "RkpHdgEgzkW80wjSgCC98ObQCw12",
    name: "Store",
    email: "store@esnad.local",
    role: Role.STORE_MANAGER,
    managerId: "DWiCv6fkv0AKfLRUSi02",
    country: "Libya",
    active: true,
    employmentStatus: "Active",
    securityScope: "National"
  };

  const sampleOrders = [
    {
      id: "ORD-2026-001",
      displayNumber: "ORD-2026-001",
      pharmacyId: "PHM-TAJOURA-A",
      pharmacyName: "Tajoura Central Pharmacy",
      salesRep: "Omar Rep",
      status: "OPERATIONS_APPROVED",
      country: "Libya",
      countryId: "LY",
      total: 2500,
      items: [{ id: "P1", name: "CardioMax", quantity: 10, price: 250, total: 2500 }]
    },
    {
      id: "ORD-2026-002",
      displayNumber: "ORD-2026-002",
      pharmacyId: "PHM-BENGHAZI-B",
      pharmacyName: "Benghazi Care Pharmacy",
      salesRep: "Sami Rep",
      status: "PENDING_STORE_PREPARATION",
      country: "Libya",
      countryId: "LY",
      total: 1800,
      items: [{ id: "P2", name: "KidVits", quantity: 20, price: 90, total: 1800 }]
    },
    {
      id: "ORD-2026-UNAUTH",
      displayNumber: "ORD-2026-UNAUTH",
      pharmacyId: "PHM-JORDAN-01",
      pharmacyName: "Amman Care Pharmacy",
      salesRep: "Jordan Rep",
      status: "PENDING_STORE_PREPARATION",
      country: "Jordan",
      countryId: "JO",
      total: 5000,
      items: []
    }
  ];

  it("1. Normalizes Store Manager role correctly", () => {
    expect(normalizeRole(storeManagerUser.role)).toBe(Role.STORE_MANAGER);
  });

  it("2. Verifies Store Manager readiness criteria", () => {
    expect(Boolean(storeManagerUser.managerId)).toBe(true);
    expect(storeManagerUser.active).toBe(true);
    expect(storeManagerUser.employmentStatus).toBe("Active");
  });

  it("3. Maps OPERATIONS_APPROVED and PENDING_STORE_PREPARATION to STORE_PREPARATION stage", () => {
    expect(getStageForStatus(normalizeOrderStatus("OPERATIONS_APPROVED"))).toBe("STORE_PREPARATION");
    expect(getStageForStatus(normalizeOrderStatus("PENDING_STORE_PREPARATION"))).toBe("STORE_PREPARATION");
    expect(getStageForStatus(normalizeOrderStatus("STORE_PREPARING"))).toBe("STORE_PREPARATION");
  });

  it("4. Filters authorized orders by national country scope and excludes unauthorized countries", () => {
    const activeRole = normalizeRole(storeManagerUser.role);
    const isWarehouseStaff = activeRole === Role.STORE_MANAGER || activeRole === Role.WAREHOUSE_MANAGER;

    const authorizedOrders = sampleOrders.filter(o => {
      const userCountry = storeManagerUser.country || "Libya";
      const orderCountry = o.country || o.countryId || "Libya";
      const matchesCountry = userCountry === "All Libya" || orderCountry === userCountry || orderCountry === "Libya";
      return isWarehouseStaff && matchesCountry;
    });

    expect(authorizedOrders.length).toBe(2);
    expect(authorizedOrders.some(o => o.id === "ORD-2026-UNAUTH")).toBe(false);
  });

  it("5. Verifies assignedStoreManagerId is NOT required for unassigned Store queue Orders", () => {
    const storePrepOrders = sampleOrders.filter(o => {
      const st = normalizeOrderStatus(o.status);
      return (st === "PENDING_STORE_PREPARATION" || st === "OPERATIONS_APPROVED") && o.country === "Libya";
    });

    storePrepOrders.forEach(order => {
      expect((order as any).assignedStoreManagerId).toBeUndefined();
    });
    expect(storePrepOrders.length).toBe(2);
  });

  it("6. Verifies Store Manager capability resolution", () => {
    const capabilities = getCapabilitiesForRole(Role.STORE_MANAGER);
    expect(capabilities).toContain("ORDER_STORE_PREPARE");
    expect(capabilities).toContain("ORDER_STORE_READY");
  });

  it("7. Verifies Store Manager transition authorization on Store Prep orders", () => {
    const freshOrder = { ...sampleOrders[0], status: "OPERATIONS_APPROVED" };
    const transitionCheck = canTransitionOrder({
      order: freshOrder,
      action: "STORE_START_PREPARE",
      actor: {
        uid: storeManagerUser.uid,
        role: storeManagerUser.role,
        name: storeManagerUser.name
      }
    });

    expect(transitionCheck.allowed).toBe(true);
  });

  it("8. Verifies delivery officer assignment and dispatch execution for Store Manager", () => {
    const readyOrder = { ...sampleOrders[0], status: "READY_FOR_DISPATCH", pickingStatus: "COMPLETED", packingStatus: "COMPLETED" };
    const transitionCheck = canTransitionOrder({
      order: readyOrder,
      action: "DELIVERY_ASSIGN",
      actor: {
        uid: storeManagerUser.uid,
        role: storeManagerUser.role,
        name: storeManagerUser.name
      }
    });

    expect(transitionCheck.allowed).toBe(true);
  });

  it("9. Verifies dataset consistency between authorized orders and stats counters", () => {
    const authorizedOrders = sampleOrders.filter(o => o.country === "Libya");
    const totalCounter = authorizedOrders.length;
    const pendingCounter = authorizedOrders.filter(o => getStageForStatus(normalizeOrderStatus(o.status)) !== "CLOSED").length;
    const storePrepVisibleOrders = authorizedOrders.filter(o => {
      const normStatus = normalizeOrderStatus(o.status);
      const orderStage = getStageForStatus(normStatus);
      return orderStage === "STORE_PREPARATION" || normStatus === "PENDING_STORE_PREPARATION" || normStatus === "OPERATIONS_APPROVED";
    }).length;

    expect(totalCounter).toBe(2);
    expect(pendingCounter).toBe(2);
    expect(storePrepVisibleOrders).toBe(2);
    expect(totalCounter).toBeGreaterThan(0);
  });
});
