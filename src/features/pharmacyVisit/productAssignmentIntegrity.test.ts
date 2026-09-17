import { describe, it, expect, vi } from "vitest";
import { User, Product, UserProductAssignment } from "../../types";
import {
  getEligibleProductsForRep,
  getEligibleStockProductsForRep
} from "./services/pharmacyProductEligibility";

describe("WP6.4 — Product Assignment Integrity & Audit", () => {
  const actorUid = "usr_rep_100";

  const sampleProducts: Product[] = [
    {
      id: "PROD-VALID-1",
      name: "Panadol Extra 500mg",
      category: "Analgesics",
      packageSize: "20 Tablets",
      isActive: true,
      price: 15.5
    },
    {
      id: "PROD-VALID-2",
      name: "Amoxil 500mg",
      category: "Antibiotics",
      packageSize: "12 Capsules",
      isActive: true,
      price: 25.0
    },
    {
      id: "PROD-INACTIVE-3",
      name: "Old Discontinued Drug",
      category: "Analgesics",
      packageSize: "10 Tabs",
      isActive: false,
      price: 10.0
    },
    {
      id: "PROD-NONSELLABLE-4",
      name: "Hospital Only Injectable",
      category: "Injections",
      packageSize: "1 Vial",
      isActive: true,
      isSellable: false,
      price: 50.0
    }
  ];

  const sampleAssignments: UserProductAssignment[] = [
    { id: "upa_1", userId: actorUid, productId: "PROD-VALID-1", status: "Active" },
    { id: "upa_2", userId: actorUid, productId: "PROD-VALID-2", status: "Active" },
    { id: "upa_3", userId: actorUid, productId: "PROD-1116", status: "Active" }, // Orphan
    { id: "upa_4", userId: actorUid, productId: "PROD-2184", status: "Active" }, // Orphan
    { id: "upa_5", userId: actorUid, productId: "PROD-INACTIVE-3", status: "Active" }, // Inactive
    { id: "upa_6", userId: actorUid, productId: "PROD-NONSELLABLE-4", status: "Active" } // Non-sellable
  ];

  it("Test Case 1 & 17: Active assignment with valid canonical Product is included and prints REP_PRODUCT_ASSIGNMENT_INTEGRITY_JSON", () => {
    const consoleSpy = vi.spyOn(console, "info");
    const report = getEligibleProductsForRep(actorUid, sampleAssignments, sampleProducts);

    expect(report.eligibleProducts.map((p) => p.id)).toEqual(["PROD-VALID-2", "PROD-VALID-1"]);
    expect(report.eligibleProductCount).toBe(2);

    expect(consoleSpy).toHaveBeenCalledWith(
      "[REP_PRODUCT_ASSIGNMENT_INTEGRITY_JSON]",
      expect.stringContaining("PROD-1116")
    );
    consoleSpy.mockRestore();
  });

  it("Test Case 2: Orphan Product assignments (PROD-1116, PROD-2184) are captured in orphanAssignments and excluded from eligible products", () => {
    const report = getEligibleProductsForRep(actorUid, sampleAssignments, sampleProducts);

    const orphanIds = report.excluded
      .filter((ex) => ex.reason.includes("not found"))
      .map((ex) => ex.productId);

    expect(orphanIds).toContain("PROD-1116");
    expect(orphanIds).toContain("PROD-2184");
    expect(report.eligibleProducts.find((p) => p.id === "PROD-1116")).toBeUndefined();
  });

  it("Test Case 3 & 4: Inactive and Non-sellable canonical Products are excluded from ORDER_ELIGIBLE_PRODUCTS", () => {
    const report = getEligibleProductsForRep(actorUid, sampleAssignments, sampleProducts);

    const inactiveReasons = report.excluded.filter(
      (ex) => ex.reason.includes("inactive") || ex.reason.includes("non-sellable")
    );

    expect(inactiveReasons.length).toBe(2);
    expect(report.eligibleProducts.find((p) => p.id === "PROD-INACTIVE-3")).toBeUndefined();
    expect(report.eligibleProducts.find((p) => p.id === "PROD-NONSELLABLE-4")).toBeUndefined();
  });
});
