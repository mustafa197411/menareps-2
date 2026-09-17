import { describe, expect, it } from "vitest";
import { canonicalizeOrderLines, parsePharmacyOrderCreateRequest, requireCanonicalWorkflowTemplate } from "./pharmacyOrderCreateService";
import { ENTERPRISE_WORKFLOW_TEMPLATE } from "../src/features/orders/orderWorkflowTemplate";

const products = new Map([
  ["PRODUCT-A", { id: "PRODUCT-A", name: "Alpha", price: 7, stockQuantity: 5, active: true }],
  ["PRODUCT-B", { id: "PRODUCT-B", name: "Beta", price: 11, stockQuantity: 5, active: true }],
  ["PRODUCT-INACTIVE", { id: "PRODUCT-INACTIVE", name: "Inactive", price: 2, stockQuantity: 5, active: false }],
]);

describe("backend-authoritative Pharmacy order creation policy", () => {
  it("accepts only the visit identity as client authority", () => {
    expect(parsePharmacyOrderCreateRequest({ visitId: "VISIT-X" })).toEqual({ visitId: "VISIT-X" });
    expect(parsePharmacyOrderCreateRequest({ visitId: "VISIT-X", status: "DELIVERED" })).toBeNull();
    expect(parsePharmacyOrderCreateRequest({ visitId: "" })).toBeNull();
  });

  it("derives prices and totals from active canonical Products", () => {
    expect(canonicalizeOrderLines([{ canonicalProductId: "PRODUCT-A", quantity: 3 }], products, new Set(["PRODUCT-A"]))).toEqual([
      { id: "PRODUCT-A", productId: "PRODUCT-A", name: "Alpha", quantity: 3, price: 7, total: 21 },
    ]);
  });

  it.each([
    [[{ canonicalProductId: "PRODUCT-A", quantity: 0 }], "ORDER_LINE_INVALID"],
    [[{ canonicalProductId: "PRODUCT-A", quantity: 1.5 }], "ORDER_LINE_INVALID"],
    [[{ canonicalProductId: "PRODUCT-A", quantity: 1 }, { canonicalProductId: "PRODUCT-A", quantity: 1 }], "ORDER_LINE_INVALID"],
    [[{ canonicalProductId: "PRODUCT-B", quantity: 1 }], "ORDER_PRODUCT_NOT_AUTHORIZED"],
    [[{ canonicalProductId: "PRODUCT-INACTIVE", quantity: 1 }], "ORDER_PRODUCT_NOT_AUTHORIZED"],
  ])("rejects malformed or unauthorized canonical lines", (lines, code) => {
    expect(() => canonicalizeOrderLines(lines, products, new Set(["PRODUCT-A", "PRODUCT-INACTIVE"]))).toThrow(code as string);
  });

  it("requires one valid active persisted enterprise workflow", () => {
    expect(requireCanonicalWorkflowTemplate(ENTERPRISE_WORKFLOW_TEMPLATE)).toBe(ENTERPRISE_WORKFLOW_TEMPLATE);
    expect(() => requireCanonicalWorkflowTemplate(null)).toThrow("ORDER_WORKFLOW_CONFIGURATION_REQUIRED");
    expect(() => requireCanonicalWorkflowTemplate({ ...ENTERPRISE_WORKFLOW_TEMPLATE, active: false })).toThrow("ORDER_WORKFLOW_CONFIGURATION_INVALID");
    expect(() => requireCanonicalWorkflowTemplate({ ...ENTERPRISE_WORKFLOW_TEMPLATE, stages: [] })).toThrow("ORDER_WORKFLOW_CONFIGURATION_INVALID");
  });

  it("rejects quantity exceeding server-authorized availability", () => {
    expect(() => canonicalizeOrderLines([{ canonicalProductId: "PRODUCT-A", quantity: 6 }], products, new Set(["PRODUCT-A"]), new Map([["PRODUCT-A", 5]]))).toThrow("ORDER_QUANTITY_EXCEEDS_AUTHORIZED_AVAILABILITY");
    expect(() => canonicalizeOrderLines([{ canonicalProductId: "PRODUCT-A", quantity: 1 }], products, new Set(["PRODUCT-A"]), new Map())).toThrow("ORDER_PRODUCT_AVAILABILITY_UNAVAILABLE");
  });
});
