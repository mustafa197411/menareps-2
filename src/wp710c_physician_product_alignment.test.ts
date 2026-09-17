import { describe, expect, it, vi } from "vitest";
import {
  getValidatedPhysicianAlignedProductIds,
  resolvePhysicianVisitProducts
} from "./lib/productAssignmentService";
import {
  getCanonicalPhysicianProductSelection,
  persistPhysicianBeforeSuccess,
  toggleCanonicalProductSelection
} from "./lib/physicianAlignmentUi";
import { Physician, Product, UserProductAssignment } from "./types";

const products = [
  { id: "PROD-9188", name: "Test", brand: "Completely Different Brand", promotionGroupId: "test", isActive: true },
  { id: "PROD-WRONG-GROUP", name: "Wrong Group", brand: "Test", promotionGroupId: "other", isActive: true },
  { id: "PROD-UNAUTHORIZED", name: "Unauthorized", brand: "Test", promotionGroupId: "test", isActive: true }
] as Product[];

const assignments = [
  { userId: "REP-1", productId: "PROD-9188", status: "Active", active: true },
  { userId: "REP-1", productId: "PROD-WRONG-GROUP", status: "Active", active: true }
] as UserProductAssignment[];

const physician = {
  id: "PHY-804",
  name: "Canonical Physician",
  specialty: "Cardiology",
  classification: "A",
  territory: "Jordan / Amman / Amman / Test",
  region: "Amman",
  address: "Clinic",
  assignedRepId: "REP-1",
  primaryPromotionGroupId: "test",
  targetPromotionGroupIds: [],
  alignedProductIds: ["PROD-9188"]
} as Physician;

describe("WP7.10C canonical physician product alignment", () => {
  it("initializes Edit from alignedProductIds and ignores legacy assignedProducts", () => {
    const record = { ...physician, assignedProducts: ["Legacy Product Name"] };
    expect(getCanonicalPhysicianProductSelection(record)).toEqual(["PROD-9188"]);
  });

  it("stores canonical product document IDs in checkbox state", () => {
    expect(toggleCanonicalProductSelection([], "PROD-9188")).toEqual(["PROD-9188"]);
    expect(toggleCanonicalProductSelection(["PROD-9188"], "PROD-9188")).toEqual([]);
  });

  it("persists the explicit active, promotion-group-valid canonical selection independently of representative ownership", () => {
    expect(getValidatedPhysicianAlignedProductIds({
      selectedProductIds: ["PROD-9188", "PROD-WRONG-GROUP", "PROD-UNAUTHORIZED"],
      physician,
      products,
      userProductAssignments: assignments
    })).toEqual(["PROD-9188", "PROD-UNAUTHORIZED"]);
  });

  it("does not apply representative authorization during Physician Master save", () => {
    expect(getValidatedPhysicianAlignedProductIds({
      selectedProductIds: ["PROD-UNAUTHORIZED"], physician, products, userProductAssignments: assignments
    })).toEqual(["PROD-UNAUTHORIZED"]);
  });

  it("rejects products outside the physician promotion groups", () => {
    expect(getValidatedPhysicianAlignedProductIds({
      selectedProductIds: ["PROD-WRONG-GROUP"], physician, products, userProductAssignments: assignments
    })).toEqual([]);
  });

  it("rehydrates exactly the canonical IDs returned by persistence", () => {
    const saved = getValidatedPhysicianAlignedProductIds({
      selectedProductIds: ["PROD-9188"], physician, products, userProductAssignments: assignments
    });
    expect(getCanonicalPhysicianProductSelection({ alignedProductIds: saved })).toEqual(["PROD-9188"]);
  });

  it("resolves Visit products by promotionGroupId and alignedProductIds, independent of brand", () => {
    expect(resolvePhysicianVisitProducts({ physician, authorizedProducts: products }).map(product => product.id))
      .toEqual(["PROD-9188"]);
  });

  it("does not admit a matching brand from the wrong promotion group", () => {
    const wrongBrandJoinProduct = products.find(product => product.id === "PROD-WRONG-GROUP")!;
    expect(resolvePhysicianVisitProducts({
      physician: { ...physician, alignedProductIds: [wrongBrandJoinProduct.id] },
      authorizedProducts: [wrongBrandJoinProduct]
    })).toEqual([]);
  });

  it("enforces representative authorization before Visit resolution", () => {
    expect(resolvePhysicianVisitProducts({ physician, authorizedProducts: [] })).toEqual([]);
  });

  it("runs dialog success only after persistence resolves and never on failure", async () => {
    let resolvePersistence!: () => void;
    const persistence = new Promise<void>(resolve => { resolvePersistence = resolve; });
    const onSuccess = vi.fn();
    const pending = persistPhysicianBeforeSuccess(physician, () => persistence, onSuccess);

    expect(onSuccess).not.toHaveBeenCalled();
    resolvePersistence();
    await pending;
    expect(onSuccess).toHaveBeenCalledOnce();

    const failedSuccess = vi.fn();
    await expect(persistPhysicianBeforeSuccess(
      physician,
      async () => { throw new Error("write rejected"); },
      failedSuccess
    )).rejects.toThrow("write rejected");
    expect(failedSuccess).not.toHaveBeenCalled();
  });
});
