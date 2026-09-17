import { describe, expect, it } from "vitest";
import type { Product } from "../types";
import { getUndefinedPaths } from "../utils/importNormalization";
import { createSampleSku, SampleDomainError } from "./sampleDomainService";
import { prepareSampleCatalogWrite } from "./samplePersistence";

const baseProduct = (manufacturer?: string): Product => ({
  id: "PROD-2551", name: "Panadol", brand: "Panadol", therapeuticArea: "Pain", price: 0, stock: 0, manufacturer
});

const build = (product: Product) => createSampleSku({
  id: "S617", productId: product.id, name: `${product.name} - Trial`, descriptor: "Trial",
  unitSize: "75", unitsPerPack: 1, coldChain: false, manufacturer: product.manufacturer,
  actorId: "admin-1", occurredAt: "2026-08-09T00:00:00.000Z"
}, new Set([product.id]), { canCreateSampleSku: true });

describe("WP-S10B Sample Catalog persistence boundary", () => {
  it("creates a Firestore-safe Sample Variant when optional manufacturer is absent", () => {
    const payload = prepareSampleCatalogWrite(build(baseProduct()), "admin-1");
    expect(payload).not.toHaveProperty("manufacturer");
    expect(getUndefinedPaths(payload)).toEqual([]);
  });

  it("inherits manufacturer from the canonical parent Product when available", () => {
    const payload = prepareSampleCatalogWrite(build(baseProduct("Canonical Pharma")), "admin-1");
    expect(payload.manufacturer).toBe("Canonical Pharma");
  });

  it("preserves canonical identity and valid false and numeric values", () => {
    const payload = prepareSampleCatalogWrite(build(baseProduct()), "admin-1");
    expect(payload.productId).toBe("PROD-2551");
    expect(payload.unitsPerPack).toBe(1);
    expect(payload.coldChain).toBe(false);
  });

  it("continues to reject missing required Sample fields", () => {
    expect(() => createSampleSku({ id: "S617", productId: "PROD-2551", name: "", descriptor: "", actorId: "admin-1", occurredAt: "2026-08-09T00:00:00.000Z" }, new Set(["PROD-2551"]), { canCreateSampleSku: true }))
      .toThrowError(SampleDomainError);
  });

  it("does not allow sanitization to hide a missing required field", () => {
    const invalid = { ...build(baseProduct()), productId: undefined } as any;
    expect(() => prepareSampleCatalogWrite(invalid, "admin-1")).toThrow(/productId is required/);
  });
});
