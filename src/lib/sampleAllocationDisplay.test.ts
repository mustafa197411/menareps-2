import { describe, expect, it } from "vitest";
import { Role, type Product, type SampleAllocation, type SampleSku, type User } from "../types";
import { filterSampleAllocationRows, resolveSampleAllocationDisplay } from "./sampleAllocationDisplay";

const user = { id: "REP-1", name: "Canonical Rep", email: "rep@test.local", role: Role.MEDICAL_REP, region: "Tripoli", territory: "Libya / Tripoli / Tripoli / Centre", active: true } as User;
const sku = { id: "S399", productId: "P-1", name: "Panadol – Trial", descriptor: "Trial sample", status: "ACTIVE", active: true, createdAt: "2026-08-01", createdBy: "PM-1", updatedAt: "2026-08-01", updatedBy: "PM-1" } as SampleSku;
const product = { id: "P-1", name: "Panadol" } as Product;
const canonical = { id: "AL-1", repId: user.id, sampleSkuId: sku.id, productId: product.id, quantityAllocated: 10, quantityDistributed: 0, quantityRemaining: 10, allocatedAt: "2026-08-01", allocatedBy: "WH-1", status: "ACTIVE", reportingMonth: "2026-08", createdAt: "2026-08-01", createdBy: "WH-1" } as SampleAllocation;

describe("WP-S10C allocation display runtime repair", () => {
  it("does not crash or hide an allocation with missing optional display fields", () => {
    const row = resolveSampleAllocationDisplay(canonical, [], [], []);
    expect(() => filterSampleAllocationRows([row], { searchTerm: "", selectedRegion: "all", selectedProduct: "all", selectedMonth: "all" })).not.toThrow();
    expect(filterSampleAllocationRows([row], { searchTerm: "", selectedRegion: "all", selectedProduct: "all", selectedMonth: "all" })).toHaveLength(1);
  });

  it("handles an undefined representative name safely", () => {
    const row = { ...resolveSampleAllocationDisplay(canonical, [], [sku], [product]), repName: undefined as unknown as string };
    expect(filterSampleAllocationRows([row], { searchTerm: "panadol", selectedRegion: "all", selectedProduct: "all", selectedMonth: "all" })).toHaveLength(1);
  });

  it("handles undefined product and sample display fields safely", () => {
    const row = { ...resolveSampleAllocationDisplay(canonical, [], [], []), productName: undefined as unknown as string, brand: undefined as unknown as string };
    expect(() => filterSampleAllocationRows([row], { searchTerm: "missing", selectedRegion: "all", selectedProduct: "all", selectedMonth: "all" })).not.toThrow();
  });

  it("resolves representative, Sample SKU, and parent Product by canonical IDs", () => {
    const row = resolveSampleAllocationDisplay({ ...canonical, repName: "Legacy Rep", productName: "Legacy Sample", brand: "Legacy Product" }, [user], [sku], [product]);
    expect(row).toMatchObject({ repName: "Canonical Rep", productName: "Panadol – Trial", brand: "Panadol", sampleSkuId: "S399", productId: "P-1" });
  });

  it("keeps legacy display values only as unresolved-join fallbacks", () => {
    const row = resolveSampleAllocationDisplay({ ...canonical, repName: "Legacy Rep", productName: "Legacy Sample", brand: "Legacy Product" }, [], [], []);
    expect(row).toMatchObject({ repName: "Legacy Rep", productName: "Legacy Sample", brand: "Legacy Product" });
  });

  it("keeps direct and request-linked allocations distinguishable", () => {
    expect(resolveSampleAllocationDisplay(canonical, [user], [sku], [product]).allocationSource).toBe("DIRECT");
    expect(resolveSampleAllocationDisplay({ ...canonical, id: "AL-2", requestId: "REQ-1", approvalId: "APR-1" }, [user], [sku], [product]).allocationSource).toBe("REQUEST");
  });

  it("filters Sample SKUs by canonical sampleSkuId", () => {
    const row = resolveSampleAllocationDisplay(canonical, [user], [sku], [product]);
    expect(filterSampleAllocationRows([row], { searchTerm: "", selectedRegion: "all", selectedProduct: "S399", selectedMonth: "all" })).toEqual([row]);
  });
});
