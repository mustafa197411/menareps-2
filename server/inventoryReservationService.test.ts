import { describe, expect, it } from "vitest";
import { aggregatePhysicalDemand, availableToPromise, deterministicReservationId, readActiveReservedQuantity, terminalReservationStatus } from "./inventoryReservationService";

describe("version-2 complete-invoice inventory reservation policy", () => {
  it("treats a missing active reservation as zero and derives ATP", () => {
    expect(readActiveReservedQuantity({ stockQuantity: 12 })).toBe(0);
    expect(availableToPromise({ stockQuantity: 12 })).toBe(12);
    expect(availableToPromise({ stockQuantity: 12, activeReservedQuantity: 5 })).toBe(7);
    expect(availableToPromise({ stockQuantity: 2, activeReservedQuantity: 5 })).toBe(0);
  });

  it("aggregates duplicate saleable and promotional lines deterministically", () => {
    expect(aggregatePhysicalDemand([
      { productId: "B", saleableQuantity: 2 }, { productId: "A", saleableQuantity: 10 },
      { productId: "A", promotionalFreeQuantity: 1 }, { productId: "A", promotionalFreeQuantity: 2 },
    ])).toEqual([
      { productId: "A", saleableQuantity: 10, promotionalFreeQuantity: 3, totalPhysicalQuantity: 13 },
      { productId: "B", saleableQuantity: 2, promotionalFreeQuantity: 0, totalPhysicalQuantity: 2 },
    ]);
  });

  it("supports saleable-only and a promotional component without merging their audit values", () => {
    expect(aggregatePhysicalDemand([{ productId: "P", saleableQuantity: 4 }])[0]).toMatchObject({ saleableQuantity: 4, promotionalFreeQuantity: 0, totalPhysicalQuantity: 4 });
    expect(aggregatePhysicalDemand([{ productId: "P", promotionalFreeQuantity: 2 }])[0]).toMatchObject({ saleableQuantity: 0, promotionalFreeQuantity: 2, totalPhysicalQuantity: 2 });
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.POSITIVE_INFINITY])("rejects unsafe quantity %s", value => {
    expect(() => aggregatePhysicalDemand([{ productId: "P", saleableQuantity: value }])).toThrow("INVENTORY_RESERVATION_QUANTITY_INVALID");
  });

  it("rejects aggregate overflow", () => expect(() => aggregatePhysicalDemand([
    { productId: "P", saleableQuantity: Number.MAX_SAFE_INTEGER }, { productId: "P", promotionalFreeQuantity: 1 },
  ])).toThrow("INVENTORY_RESERVATION_QUANTITY_INVALID"));

  it("creates stable deterministic reservation IDs", () => {
    expect(deterministicReservationId("ORD_1", "P1")).toBe("RES_ORD_1_P1");
    expect(deterministicReservationId("ORD/1", "P/1")).toBe(deterministicReservationId("ORD/1", "P/1"));
  });

  it("permits only one ACTIVE to terminal transition", () => {
    expect(terminalReservationStatus("ACTIVE", "RELEASE")).toBe("RELEASED");
    expect(terminalReservationStatus("ACTIVE", "CONSUME")).toBe("CONSUMED");
    expect(() => terminalReservationStatus("RELEASED", "RELEASE")).toThrow("INVENTORY_RESERVATION_DUPLICATE_RELEASE");
    expect(() => terminalReservationStatus("CONSUMED", "CONSUME")).toThrow("INVENTORY_RESERVATION_DUPLICATE_CONSUMPTION");
    expect(() => terminalReservationStatus("CONSUMED", "RELEASE")).toThrow();
    expect(() => terminalReservationStatus("RELEASED", "CONSUME")).toThrow();
  });
});
