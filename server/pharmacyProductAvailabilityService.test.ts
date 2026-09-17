import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { availabilityResult, parsePharmacyProductAvailabilityRequest, readProductAvailableToPromise, readProductStockQuantity, resolvePharmacyProductAvailability } from "./pharmacyProductAvailabilityService";

const snap = (data?: any) => ({ exists: !!data, data: () => data });

describe("Pharmacy Visit product availability policy", () => {
  it("subtracts active reservations while treating a missing legacy balance as zero", () => {
    expect(readProductAvailableToPromise({ stockQuantity: 12 })).toBe(12);
    expect(readProductAvailableToPromise({ stockQuantity: 12, activeReservedQuantity: 5 })).toBe(7);
    expect(readProductAvailableToPromise({ stockQuantity: 12, activeReservedQuantity: 12 })).toBe(0);
  });
  it("keeps actual 500 orderable while hiding the Sales Representative quantity", () => {
    expect(availabilityResult("P1", 500, false)).toEqual({ productId: "P1", availabilityState: "AVAILABLE", canOrder: true, shortageEligible: false, showNumericStock: false });
  });
  it("classifies only confirmed zero as out of stock and shortage eligible", () => {
    expect(availabilityResult("P1", 0, false)).toMatchObject({ availabilityState: "OUT_OF_STOCK", canOrder: false, shortageEligible: true });
  });
  it("does not turn missing availability into zero or shortage demand", () => {
    expect(availabilityResult("P1", null, false, "BALANCE_MISSING")).toMatchObject({ availabilityState: "UNAVAILABLE_ERROR", canOrder: false, shortageEligible: false, code: "BALANCE_MISSING" });
  });
  it.each([undefined, "500", Number.NaN, -1])("rejects missing, nonnumeric, non-finite, and negative stockQuantity", value => {
    expect(readProductStockQuantity({ stockQuantity: value, stock: 500 })).toBeNull();
    expect(availabilityResult("P1", readProductStockQuantity({ stockQuantity: value, stock: 500 }), false)).toMatchObject({ availabilityState: "UNAVAILABLE_ERROR", canOrder: false, shortageEligible: false });
  });
  it("supports intended numeric visibility without changing eligibility", () => {
    expect(availabilityResult("P1", 500, true)).toMatchObject({ actualAvailableQty: 500, showNumericStock: true, canOrder: true });
  });
  it("validates the narrow request DTO", () => {
    expect(parsePharmacyProductAvailabilityRequest({ pharmacyId: "PH1", productIds: ["P1", "P1"] })).toEqual({ pharmacyId: "PH1", productIds: ["P1"] });
    expect(parsePharmacyProductAvailabilityRequest({ pharmacyId: "PH1", productIds: ["P1"], scope: "ALL" })).toBeNull();
  });
  it("returns only hidden availability states from canonical Product stockQuantity", async () => {
    const actor = { id: "REP", email: "rep@test", role: "Sales Representative", active: true, loginAllowed: true, status: "Active", securityScope: "Area", areaIds: ["A1"], country: "C1" };
    const canonicalProducts = [
      { id: "P500", name: "Stocked", brand: "B", sku: "P500", therapeuticArea: "T", price: 1, stock: 500, stockQuantity: 500, isActive: true },
      { id: "P0", name: "Empty", brand: "B", sku: "P0", therapeuticArea: "T", price: 1, stock: 0, stockQuantity: 0, isActive: true },
    ];
    const operationalScopeRepository = {
      hierarchy: { getUser: vi.fn(async () => actor), getDirectReports: vi.fn(async () => []), getAllUsers: vi.fn(async () => [actor]), getRolePermissions: vi.fn(async () => null) },
      getGeographyCatalog: vi.fn(async () => ({ countries: [{ id: "C1", active: true }], districts: [{ id: "D1", countryId: "C1", active: true }], cities: [{ id: "CT1", countryId: "C1", districtId: "D1", active: true }], areas: [{ id: "A1", countryId: "C1", districtId: "D1", cityId: "CT1", active: true }], nodes: [{ countryId: "C1", regionId: "D1", districtId: "D1", cityId: "CT1", areaId: "A1", active: true }] })),
      getTerritoryAssignments: vi.fn(async () => [{ assignmentId: "TA", userId: "REP", countryId: "C1", districtId: "D1", cityId: "CT1", areaId: "A1", active: true, status: "Active" }]),
      getProductAssignments: vi.fn(async () => [
        { assignmentId: "PA500", userId: "REP", productId: "P500", active: true, status: "Active", effectiveFrom: "2020-01-01", effectiveTo: "2035-01-01", assignedAt: "2020-01-01", assignedBy: "TEST" },
        { assignmentId: "PA0", userId: "REP", productId: "P0", active: true, status: "Active", effectiveFrom: "2020-01-01", effectiveTo: "2035-01-01", assignedAt: "2020-01-01", assignedBy: "TEST" },
      ]),
      getProducts: vi.fn(async () => canonicalProducts),
    } as any;
    const rows: Record<string, Record<string, any>> = {
      pharmacies: { PH: { areaId: "A1", active: true } },
      products: { P500: canonicalProducts[0], P0: canonicalProducts[1] },
    };
    const collection = vi.fn((name: string) => ({ doc: (id: string) => ({ get: vi.fn(async () => snap(rows[name]?.[id])) }) }));
    const result = await resolvePharmacyProductAvailability("REP", { pharmacyId: "PH", productIds: ["P500", "P0"] }, { db: { collection } as any, operationalScopeRepository });
    expect(result).toEqual({ authorized: true, availability: [
      { productId: "P500", availabilityState: "AVAILABLE", canOrder: true, shortageEligible: false, showNumericStock: false },
      { productId: "P0", availabilityState: "OUT_OF_STOCK", canOrder: false, shortageEligible: true, showNumericStock: false },
    ] });
    expect(collection.mock.calls.map(call => call[0])).toEqual(["pharmacies", "products", "products"]);
  });
  it("fails authorization before inventory reads", async () => {
    const collection = vi.fn();
    const actor = { id: "REP", email: "rep@test", role: "Medical Representative", active: true, loginAllowed: true, status: "Active" };
    const operationalScopeRepository = {
      hierarchy: { getUser: vi.fn(async () => actor), getDirectReports: vi.fn(async () => []), getAllUsers: vi.fn(async () => [actor]), getRolePermissions: vi.fn(async () => null) },
      getGeographyCatalog: vi.fn(async () => ({ countries: [], districts: [], cities: [], areas: [], nodes: [] })),
      getTerritoryAssignments: vi.fn(async () => []), getProductAssignments: vi.fn(async () => []), getProducts: vi.fn(async () => []),
    } as any;
    const result = await resolvePharmacyProductAvailability("REP", { pharmacyId: "PH", productIds: ["P"] }, { db: { collection } as any, operationalScopeRepository });
    expect(result.authorized).toBe(false);
    expect(collection).not.toHaveBeenCalled();
  });
  it("contains no unsupported commercial warehouse model reads", () => {
    const availabilitySource = fs.readFileSync(new URL("./pharmacyProductAvailabilityService.ts", import.meta.url), "utf8");
    const orderSource = fs.readFileSync(new URL("./pharmacyOrderCreateService.ts", import.meta.url), "utf8");
    for (const unsupported of ["commercialRoutes", "warehouses", "commercialInventoryBalances", "commercialInventoryBatches", "warehouseId", "skuId", "expiryDate"]) {
      expect(availabilitySource).not.toContain(unsupported);
      expect(orderSource).not.toContain(unsupported);
    }
  });
});
