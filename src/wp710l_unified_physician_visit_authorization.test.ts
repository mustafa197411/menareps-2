import { describe, expect, it } from "vitest";
import {
  filterKeyMessagesForAuthorizedProducts,
  filterKeyMessagesForProduct,
  filterMaterialsForAuthorizedProducts,
  filterMaterialsForProduct,
  getEligibleProductsForDetailingBlock,
  validateDetailingCompletion
} from "./lib/physicianVisitDetailingIntegrity";
import { resolvePhysicianVisitProducts } from "./lib/productAssignmentService";
import { Product } from "./types";

const products = [
  { id: "PROD-2551", name: "Panadol", sku: "promotion", brand: "promotion 2", promotionGroupId: "promotion2", isActive: true },
  { id: "PROD-TARGET", name: "Target", promotionGroupId: "target", isActive: true },
  { id: "PROD-UNASSIGNED", name: "Unassigned", promotionGroupId: "promotion2", isActive: true },
  { id: "PROD-UNALIGNED", name: "Unaligned", promotionGroupId: "promotion2", isActive: true },
  { id: "PROD-INACTIVE", name: "Inactive", promotionGroupId: "promotion2", isActive: false }
] as Product[];

const physician = {
  primaryPromotionGroupId: "promotion2",
  targetPromotionGroupIds: ["target"],
  alignedProductIds: ["PROD-2551", "PROD-TARGET", "PROD-UNASSIGNED", "PROD-INACTIVE"]
};

const representativeProducts = products.filter(product =>
  ["PROD-2551", "PROD-TARGET", "PROD-UNALIGNED", "PROD-INACTIVE"].includes(product.id) &&
  product.isActive !== false
);

const authorizedProducts = resolvePhysicianVisitProducts({ physician, authorizedProducts: representativeProducts });
const authorizedProductIds = authorizedProducts.map(product => product.id);

const messages = [
  { id: "MSG-102", productId: "PROD-2551", productSku: "promotion", productName: "Panadol", brandName: "promotion 2", isApproved: true, isDeleted: false },
  { id: "MSG-UNAUTHORIZED", productId: "PROD-UNASSIGNED", isApproved: true },
  { id: "MSG-SKU", productSku: "promotion", isApproved: true },
  { id: "MSG-NAME", productName: "Panadol", isApproved: true },
  { id: "MSG-BRAND", brandName: "promotion 2", isApproved: true }
];

describe("WP710L unified Physician Visit Product authorization", () => {
  it("1. exposes an authorized Product to the picker", () => {
    expect(authorizedProductIds).toContain("PROD-2551");
  });

  it("2. uses that same authorized ID set for the Key Message prefilter", () => {
    const authorizedMessages = filterKeyMessagesForAuthorizedProducts(messages, authorizedProductIds);
    expect(authorizedMessages.map(message => message.id)).toEqual(["MSG-102"]);
  });

  it("3. returns MSG-102 through exact canonical Product filtering", () => {
    const authorizedMessages = filterKeyMessagesForAuthorizedProducts(messages, authorizedProductIds);
    expect(filterKeyMessagesForProduct(authorizedMessages, "PROD-2551").map(message => message.id)).toEqual(["MSG-102"]);
  });

  it("4. cannot hide an authorized message through a second Product authority", () => {
    const pickerIds = new Set(authorizedProductIds);
    const messageProductIds = new Set(filterKeyMessagesForAuthorizedProducts(messages, authorizedProductIds).map(message => message.productId));
    expect(pickerIds.has("PROD-2551")).toBe(true);
    expect(messageProductIds.has("PROD-2551")).toBe(true);
  });

  it("5. excludes representative-unauthorized Products and messages", () => {
    expect(authorizedProductIds).not.toContain("PROD-UNASSIGNED");
    expect(filterKeyMessagesForAuthorizedProducts(messages, authorizedProductIds).map(message => message.id)).not.toContain("MSG-UNAUTHORIZED");
  });

  it("6. excludes physician-unaligned Products", () => {
    expect(authorizedProductIds).not.toContain("PROD-UNALIGNED");
  });

  it("7. excludes inactive Products", () => {
    expect(authorizedProductIds).not.toContain("PROD-INACTIVE");
  });

  it("8. rejects SKU, Product name, and brand fallbacks", () => {
    expect(filterKeyMessagesForProduct(messages, "PROD-2551").map(message => message.id)).toEqual(["MSG-102"]);
  });

  it("9. authorizes materials from the same canonical Product ID set", () => {
    const materials = [
      { id: "MAT-ID", productId: "PROD-2551", isApproved: true },
      { id: "MAT-IDS", productIds: ["PROD-2551"], isApproved: true },
      { id: "MAT-UNAUTHORIZED", productId: "PROD-UNASSIGNED", isApproved: true },
      { id: "MAT-DISPLAY", product: "Panadol", isApproved: true }
    ];
    const authorizedMaterials = filterMaterialsForAuthorizedProducts(materials, authorizedProductIds);
    expect(filterMaterialsForProduct(authorizedMaterials, "PROD-2551").map(material => material.id)).toEqual(["MAT-ID", "MAT-IDS"]);
  });

  it("10. preserves Primary-first sequencing", () => {
    const eligible = getEligibleProductsForDetailingBlock({
      products,
      physicianAlignedProductIds: physician.alignedProductIds,
      representativeActiveProductIds: representativeProducts.map(product => product.id),
      primaryPromotionGroupId: physician.primaryPromotionGroupId,
      targetPromotionGroupIds: physician.targetPromotionGroupIds,
      selections: [{ productId: "" }],
      blockIndex: 0
    });
    expect(eligible.map(product => product.id)).toEqual(["PROD-2551"]);
  });

  it("11. preserves duplicate Product prevention", () => {
    expect(validateDetailingCompletion({
      selectedProductIds: ["PROD-2551", "PROD-2551"],
      allowedVisitProductIds: authorizedProductIds,
      products,
      primaryPromotionGroupId: physician.primaryPromotionGroupId
    }).validationResult).toBe("FAIL");
  });
});
