import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Role } from "./types";
import { buildCanonicalProductAssignment, calculateSyncDiff } from "./lib/productAssignmentService";
import { getRepresentativeEditMasterDataReadiness, hydrateRepresentativeEditState, validateRepresentativePrimaryGroup } from "./lib/representativeEditState";

const groups = [
  { id: "test", name: "Test", isActive: true },
  { id: "other", name: "Other", isActive: true }
] as any[];
const products = [
  { id: "PROD-A", name: "Product A", promotionGroupId: "test", isActive: true },
  { id: "PROD-B", name: "Product B", promotionGroupId: "test", isActive: true },
  { id: "PROD-C", name: "Product C", promotionGroupId: "other", isActive: true }
] as any[];
const baseUser = {
  id: "REP-1", name: "Existing Rep", email: "rep@example.com", role: Role.MEDICAL_REP,
  primaryPromotionGroupId: "test", targetPromotionGroupIds: [], products: ["PROD-A"],
  areaIds: ["A-713066"]
} as any;

const hydrate = (user = baseUser, productAssignments: any[] = [], territoryAssignments: any[] = []) =>
  hydrateRepresentativeEditState({ user, productAssignments, territoryAssignments, products, promotionGroups: groups });
const userManagementSource = readFileSync(new URL("./components/UserManagement.tsx", import.meta.url), "utf8");

describe("WP7.10H existing representative edit state", () => {
  it("1. hydrates the canonical primaryPromotionGroupId", () => {
    expect(hydrate().primaryPromotionGroupId).toBe("test");
  });

  it("2. permits an unchanged representative state to pass the same save validation", () => {
    const state = hydrate();
    expect(validateRepresentativePrimaryGroup(baseUser.role, state.primaryPromotionGroupId).validationResult).toBe("PASS");
    expect(state.selectedProductIds).toEqual(["PROD-A"]);
  });

  it("3. preserves the canonical primary group through hydration/save input", () => {
    const state = hydrate();
    expect({ primaryPromotionGroupId: state.primaryPromotionGroupId }).toEqual({ primaryPromotionGroupId: "test" });
  });

  it("4. accepts a changed canonical primary group ID", () => {
    expect(validateRepresentativePrimaryGroup(Role.MEDICAL_REP, "other").validationResult).toBe("PASS");
    expect(hydrate({ ...baseUser, primaryPromotionGroupId: "other" }).primaryPromotionGroupId).toBe("other");
  });

  it("5. adding a product creates or reactivates its deterministic assignment", () => {
    const existingA = buildCanonicalProductAssignment({ userId: baseUser.id, product: products[0], actorUid: "ADMIN" });
    const inactiveB = { ...buildCanonicalProductAssignment({ userId: baseUser.id, product: products[1], actorUid: "ADMIN" }), active: false, status: "Inactive" };
    const diff = calculateSyncDiff({ representativeUid: baseUser.id, selectedProductIds: ["PROD-A", "PROD-B"], products, existingAssignments: [existingA, inactiveB], actorUid: "ADMIN" });
    expect(diff.toRetain).toHaveLength(1);
    expect(diff.toReactivate.map(item => item.productId)).toEqual(["PROD-B"]);
    expect(diff.toCreate).toHaveLength(0);
    const createDiff = calculateSyncDiff({ representativeUid: baseUser.id, selectedProductIds: ["PROD-A", "PROD-B"], products, existingAssignments: [existingA], actorUid: "ADMIN" });
    expect(createDiff.toCreate.map(item => item.id)).toEqual(["PROD-B"]);
    expect(buildCanonicalProductAssignment({ userId: baseUser.id, product: products[1], actorUid: "ADMIN" }).assignmentId).toBe("PA_REP-1_PROD-B");
  });

  it("6. removing a product deactivates rather than deletes its assignment", () => {
    const assignments = products.slice(0, 2).map(product => buildCanonicalProductAssignment({ userId: baseUser.id, product, actorUid: "ADMIN" }));
    const diff = calculateSyncDiff({ representativeUid: baseUser.id, selectedProductIds: ["PROD-A"], products, existingAssignments: assignments, actorUid: "ADMIN" });
    expect(diff.toRetain.map(item => item.productId)).toEqual(["PROD-A"]);
    expect(diff.toDeactivate.map(item => item.productId)).toEqual(["PROD-B"]);
  });

  it("7. keeps an unchanged active canonical area assignment", () => {
    expect(hydrate(baseUser, [], [{ territoryId: "A-713066", active: true, status: "Active" }]).assignedAreaIds).toEqual(["A-713066"]);
  });

  it("8. does not require a primary group for non-representative roles", () => {
    expect(validateRepresentativePrimaryGroup(Role.MEDICAL_MANAGER, null)).toEqual({ isRepresentative: false, validationResult: "PASS" });
  });

  it("9. resolves a legacy display name only when it uniquely identifies one active group", () => {
    const legacy = { ...baseUser, primaryPromotionGroupId: undefined, primaryPromotionGroupName: "Test" };
    expect(hydrate(legacy).primaryPromotionGroupId).toBe("test");
    expect(hydrate(legacy, [], []).primaryPromotionGroupId).not.toBe("Test");
    expect(hydrateRepresentativeEditState({ user: legacy, productAssignments: [], territoryAssignments: [], products, promotionGroups: [...groups, { id: "test-2", name: "Test", isActive: true }] as any }).primaryPromotionGroupId).toBeNull();
  });

  it("10. retains canonical user and scoped assignment reads for edit hydration", () => {
    expect(userManagementSource).toContain('getDoc(doc(db, "users", user.id))');
    expect(userManagementSource).toContain('collection(db, "userProductAssignments"), where("userId", "==", user.id)');
    expect(userManagementSource).toContain('collection(db, "userTerritoryAssignments"), where("userId", "==", user.id)');
  });

  it("11. hydrates from in-memory products without a full products collection fetch", () => {
    expect(hydrate().selectedProductIds).toEqual(["PROD-A"]);
    expect(userManagementSource).not.toContain('getDocs(collection(db, "products"))');
    expect(userManagementSource).toContain("products: productsList");
  });

  it("12. resolves groups from in-memory state without a full promotion-group collection fetch", () => {
    expect(hydrate().primaryPromotionGroupId).toBe("test");
    expect(userManagementSource).not.toContain('getDocs(collection(db, "productPromotionGroups"))');
    expect(userManagementSource).toContain("promotionGroups: promotionGroupsList");
  });

  it("13. blocks representative edit while either required master list is unavailable", () => {
    expect(getRepresentativeEditMasterDataReadiness({ role: Role.MEDICAL_REP, productsLoading: true, promotionGroupsLoading: false, productCount: 0, promotionGroupCount: 2 }).ready).toBe(false);
    expect(getRepresentativeEditMasterDataReadiness({ role: Role.SALES_REP, productsLoading: false, promotionGroupsLoading: true, productCount: 3, promotionGroupCount: 0 }).ready).toBe(false);
    expect(userManagementSource).toContain("[WP710H_EDIT_MASTER_DATA_NOT_READY_JSON]");
  });

  it("14. does not block non-representative edit on representative master data", () => {
    expect(getRepresentativeEditMasterDataReadiness({ role: Role.MEDICAL_MANAGER, productsLoading: true, promotionGroupsLoading: true, productCount: 0, promotionGroupCount: 0 }).ready).toBe(true);
  });
});
