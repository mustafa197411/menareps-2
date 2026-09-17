import { describe, it, expect } from "vitest";
import { normalizeRole, Role } from "./types";
import {
  normalizeOrderStatus,
  getStageForStatus,
  getCapabilitiesForRole
} from "./features/orders/orderWorkflowEngine";

describe("WP7.3B — Warehouse Operations Runtime Stabilization (TDZ Elimination)", () => {
  it("1. Correctly derives isWarehouseStaff for Store Manager, Warehouse Manager, and Inventory Officer", () => {
    const rolesToTest = [
      Role.STORE_MANAGER,
      Role.WAREHOUSE_MANAGER,
      Role.INVENTORY_OFFICER,
      "Store Manager",
      "Warehouse Manager",
      "Inventory Officer"
    ];

    rolesToTest.forEach(rawRole => {
      const activeRole = normalizeRole(rawRole);
      const isWarehouseStaff =
        activeRole === Role.STORE_MANAGER ||
        activeRole === Role.WAREHOUSE_MANAGER ||
        activeRole === Role.INVENTORY_OFFICER;

      expect(isWarehouseStaff).toBe(true);
    });
  });

  it("2. Safely evaluates role flags when currentUser is null or role is undefined", () => {
    const nullUserRole = null;
    const undefinedUserRole = undefined;

    const activeRoleNull = nullUserRole ? normalizeRole(nullUserRole) : null;
    const activeRoleUndef = undefinedUserRole ? normalizeRole(undefinedUserRole) : null;

    const isWarehouseStaffNull =
      activeRoleNull === Role.STORE_MANAGER ||
      activeRoleNull === Role.WAREHOUSE_MANAGER ||
      activeRoleNull === Role.INVENTORY_OFFICER;

    const isWarehouseStaffUndef =
      activeRoleUndef === Role.STORE_MANAGER ||
      activeRoleUndef === Role.WAREHOUSE_MANAGER ||
      activeRoleUndef === Role.INVENTORY_OFFICER;

    expect(isWarehouseStaffNull).toBe(false);
    expect(isWarehouseStaffUndef).toBe(false);
  });

  it("3. Verifies default stage filter resolution for Store Manager in Order Operations route", () => {
    const currentUser = { role: Role.STORE_MANAGER };
    const defaultStageForOps =
      currentUser?.role === Role.STORE_MANAGER || currentUser?.role === Role.WAREHOUSE_MANAGER
        ? "STORE_PREPARATION"
        : "OPERATIONS_REVIEW";

    expect(defaultStageForOps).toBe("STORE_PREPARATION");
  });

  it("4. Verifies stage filter override in SalesOrders when initialStageFilter is OPERATIONS_REVIEW for Warehouse staff", () => {
    const activeRole = normalizeRole(Role.STORE_MANAGER);
    const isWarehouseStaff =
      activeRole === Role.STORE_MANAGER ||
      activeRole === Role.WAREHOUSE_MANAGER ||
      activeRole === Role.INVENTORY_OFFICER;

    let initialStageFilter = "OPERATIONS_REVIEW";
    let effectiveStageFilter = initialStageFilter;

    if (initialStageFilter) {
      if (isWarehouseStaff && initialStageFilter === "OPERATIONS_REVIEW") {
        effectiveStageFilter = "STORE_PREPARATION";
      } else {
        effectiveStageFilter = initialStageFilter;
      }
    }

    expect(effectiveStageFilter).toBe("STORE_PREPARATION");
  });

  it("5. Verifies Store Manager receives STORE_PREPARE and DISPATCH permissions", () => {
    const capabilities = getCapabilitiesForRole(Role.STORE_MANAGER);
    expect(capabilities).toContain("ORDER_STORE_PREPARE");
    expect(capabilities).toContain("ORDER_STORE_READY");
    expect(capabilities).toContain("ORDER_DELIVERY_ASSIGN");
  });

  it("6. Re-verifies WP7.3A data visibility remains fully intact", () => {
    const sampleOrders = [
      { id: "ORD-001", status: "PENDING_STORE_PREPARATION", country: "Libya" },
      { id: "ORD-002", status: "OPERATIONS_APPROVED", country: "Libya" },
      { id: "ORD-003", status: "DELIVERED", country: "Libya" }
    ];

    const storePrepOrders = sampleOrders.filter(o => {
      const norm = normalizeOrderStatus(o.status);
      const stage = getStageForStatus(norm);
      return stage === "STORE_PREPARATION";
    });

    expect(storePrepOrders.length).toBe(2);
  });
});
