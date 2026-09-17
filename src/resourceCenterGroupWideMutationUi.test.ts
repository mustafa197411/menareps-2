import { describe, expect, it } from "vitest";
import { Role } from "./types";
import { canShowResourceMutationControls, ResourceScope } from "./lib/resourceMaterialService";

describe("Product Manager group-wide Resource mutation UI", () => {
  it("keeps PM group-wide reads possible while removing guaranteed-to-fail mutation controls", () => {
    expect(canShowResourceMutationControls(Role.PRODUCT_MANAGER, ResourceScope.PROMOTION_GROUP, true)).toBe(false);
    expect(canShowResourceMutationControls(Role.PRODUCT_MANAGER, ResourceScope.SELECTED_PRODUCTS, true)).toBe(true);
  });
  it("does not change Admin, Super Admin, or Marketing Manager controls", () => {
    expect(canShowResourceMutationControls(Role.ADMIN, ResourceScope.PROMOTION_GROUP, true)).toBe(true);
    expect(canShowResourceMutationControls(Role.SUPER_ADMIN, ResourceScope.PROMOTION_GROUP, true)).toBe(true);
    expect(canShowResourceMutationControls(Role.MARKETING_MANAGER, ResourceScope.PROMOTION_GROUP, true)).toBe(true);
  });
  it("still requires canonical manage capability", () => {
    expect(canShowResourceMutationControls(Role.ADMIN, ResourceScope.SELECTED_PRODUCTS, false)).toBe(false);
  });
});
