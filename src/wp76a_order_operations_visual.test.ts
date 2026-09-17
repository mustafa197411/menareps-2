import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { getLocalizedWorkflowStatus, normalizeOrderStatus } from "./features/orders/orderWorkflowEngine";

const source = fs.readFileSync(new URL("./components/sales/SalesOrders.tsx", import.meta.url), "utf8");

describe("WP76A Order Operations visual and workflow contract", () => {
  it("keeps canonical status while presenting a human-readable label", () => {
    expect(normalizeOrderStatus("PENDING_OPERATIONS_REVIEW")).toBe("PENDING_OPERATIONS_REVIEW");
    expect(getLocalizedWorkflowStatus("PENDING_OPERATIONS_REVIEW", "en")).toBe("Pending Operations Review");
  });

  it("uses separate error and empty-state presentation", () => {
    expect(source).toContain('role="alert"');
    expect(source).toContain("<NoDataState");
    expect(source).toContain("No authorized Operations orders");
  });

  it("does not add Delivery Officer assignment to the OOO workspace", () => {
    const workspace = source.slice(source.indexOf("function CanonicalOrderOperationsWorkspace"), source.indexOf("// Canonical workflow stage sequence"));
    expect(workspace).not.toContain("deliveryOfficerUid");
    expect(workspace).toContain("Store Manager for preparation and later Delivery Officer assignment");
  });

  it("preserves bilingual RTL/LTR layout and responsive table behavior", () => {
    expect(source).toContain('dir={isRtl ? "rtl" : "ltr"}');
    expect(source).toContain('className="overflow-x-auto"');
    expect(getLocalizedWorkflowStatus("PENDING_OPERATIONS_REVIEW", "ar")).not.toBe("PENDING_OPERATIONS_REVIEW");
  });
});
