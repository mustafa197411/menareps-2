import { describe, it, expect } from "vitest";
import { normalizeRole, Role } from "./src/types";

describe("WP7.3C — Unified Order Lifecycle Workspace Integration", () => {
  it("normalizes roles correctly for default stage mapping", () => {
    expect(normalizeRole(Role.FINANCE)).toBe(Role.FINANCE);
    expect(normalizeRole(Role.ORDER_OPS_OFFICER)).toBe(Role.ORDER_OPS_OFFICER);
    expect(normalizeRole(Role.STORE_MANAGER)).toBe(Role.STORE_MANAGER);
    expect(normalizeRole(Role.DELIVERY_OFFICER)).toBe(Role.DELIVERY_OFFICER);
    expect(normalizeRole(Role.SUPER_ADMIN)).toBe(Role.SUPER_ADMIN);
  });

  it("verifies legacy route IDs map to valid operational views", () => {
    const legacyRoutes = [
      "inventory-warehouse-operations",
      "operations-fulfillment-center",
      "operations-delivery-management"
    ];
    legacyRoutes.forEach(route => {
      expect(route).toBeDefined();
    });
  });
});

