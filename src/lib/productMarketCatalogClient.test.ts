import fs from "node:fs";
import { describe, expect, it } from "vitest";

const component = fs.readFileSync(new URL("../components/ProductList.tsx", import.meta.url), "utf8");
const client = fs.readFileSync(new URL("./productMarketCatalogClient.ts", import.meta.url), "utf8");
const server = fs.readFileSync(new URL("../../server.ts", import.meta.url), "utf8");
const service = fs.readFileSync(new URL("../../server/productMarketCatalogConfigurationService.ts", import.meta.url), "utf8");

describe("Product List Configure Market workflow contract", () => {
  it("uses existing selection and opens authenticated configuration only on demand", () => {
    expect(component).toContain("selectedProductIds");
    expect(component).toContain("Configure Market");
    expect(component).toContain("disabled={selectedProductIds.length === 0}");
    expect(component).toContain("getProductMarketRelationships(selectedProductIds)");
    expect(client).toContain("auth.currentUser?.getIdToken()");
  });

  it("supports selector-derived currency, explicit price, active and saleable values", () => {
    expect(component).toContain('isRtl ? "الشركة المشغلة" : "Operating Company"');
    expect(component).toContain("selectedRelationship.currencyCode");
    expect(component).toContain('type="number"');
    expect(component).toContain("Active in market");
    expect(component).toContain("Saleable");
    expect(component).toContain("PRODUCT_MARKET_INVALID_PRICE");
  });

  it("confirms save, displays success state, refreshes status and exposes failures", () => {
    expect(component).toContain("window.confirm");
    expect(component).toContain("setMarketStatus(response)");
    expect(component).toContain("Configured");
    expect(component).toContain("Not configured");
    expect(component).toContain('role="alert"');
  });

  it("protects focused routes and retains exact catalog reads after selection", () => {
    for (const route of ["options", "save"]) expect(server).toContain(`app.post("/api/products/market-catalog/${route}", requireFirebaseAuth`);
    expect(service).toContain('hasPermission({ role: actor.role } as User, "Products", "assign"');
    expect(service).toContain('db.collection("productMarketCatalog").doc(expectedId)');
    expect(service).not.toContain("product.price");
  });
});
