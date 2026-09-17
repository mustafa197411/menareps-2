import { describe, expect, it } from "vitest";
import type { KeyMessage, Physician, Product } from "./types";
import {
  getPersistedDetailingKeyMessageIds,
  resolveCanonicalPhysicianAlignedProducts,
  resolveCanonicalVisitProductName,
  resolveDetailingKeyMessages
} from "./lib/canonicalVisitDisplay";

const products: Product[] = [
  { id: "PROD-7964", name: "Test 4", brand: "Test", therapeuticArea: "Dermatology", price: 25, stock: 500, promotionGroupId: "test", isActive: true },
  { id: "PROD-9188", name: "Test", brand: "Test", therapeuticArea: "Dermatology", price: 25, stock: 500, promotionGroupId: "test", isActive: true },
  { id: "PROD-INACTIVE", name: "Inactive", brand: "Test", therapeuticArea: "Dermatology", price: 0, stock: 0, promotionGroupId: "test", isActive: false },
  { id: "PROD-OTHER", name: "Other", brand: "Other", therapeuticArea: "Other", price: 0, stock: 0, promotionGroupId: "other", isActive: true }
];

describe("WP710P canonical completed-visit display", () => {
  it("resolves a persisted Product ID to the canonical Product name", () => {
    expect(resolveCanonicalVisitProductName({ productId: "PROD-7964", brandName: "Test" }, products)).toBe("Test 4");
  });

  it("falls back safely when the Product master record is unavailable", () => {
    expect(resolveCanonicalVisitProductName({ productId: "MISSING", productName: "Historical Name", brandName: "Brand" }, products)).toBe("Historical Name");
    expect(resolveCanonicalVisitProductName({ productId: "MISSING", brandName: "Historical Brand" }, products)).toBe("Historical Brand");
  });

  it("uses aligned Product IDs and canonical promotion-group IDs", () => {
    const physician = {
      alignedProductIds: ["PROD-7964", "PROD-9188", "PROD-INACTIVE", "PROD-OTHER"],
      targetPromotionGroupIds: ["test"]
    } as Pick<Physician, "alignedProductIds" | "primaryPromotionGroupId" | "targetPromotionGroupIds">;
    expect(resolveCanonicalPhysicianAlignedProducts(physician, products).map(product => product.id)).toEqual(["PROD-7964", "PROD-9188"]);
  });

  it("returns a legitimate empty alignment when no Product IDs are aligned", () => {
    expect(resolveCanonicalPhysicianAlignedProducts({ alignedProductIds: [], targetPromotionGroupIds: ["test"] }, products)).toEqual([]);
  });

  it("resolves persisted Key Message IDs to readable claims with ID fallback", () => {
    const messages = [{ id: "MSG-103", message: "Resolved claim" }] as KeyMessage[];
    expect(resolveDetailingKeyMessages({ keyMessageIds: ["MSG-103", "MSG-MISSING"] }, messages)).toEqual([
      { id: "MSG-103", text: "Resolved claim" },
      { id: "MSG-MISSING", text: "MSG-MISSING" }
    ]);
  });

  it("supports compatibility IDs and keeps zero selected messages valid", () => {
    expect(getPersistedDetailingKeyMessageIds({ presentedKeyMessages: ["MSG-101"] })).toEqual(["MSG-101"]);
    expect(resolveDetailingKeyMessages({ keyMessageIds: [] }, [])).toEqual([]);
  });
});
