import { describe, expect, it } from "vitest";
import { canMutateScopedKeyMessage, parseKeyMessageMutation } from "./keyMessageMutationService";

const scope = (overrides: Partial<{ authorized: boolean; denyAll: boolean; productIds: string[]; productGroupIds: string[] }> = {}) => ({
  authorized: overrides.authorized ?? true,
  queryPlan: { denyAll: overrides.denyAll ?? false },
  productIds: overrides.productIds ?? ["P-A"],
  productGroupIds: overrides.productGroupIds ?? ["PG-A"],
});

describe("AP2Q Key Message backend mutation authority", () => {
  it.each(["Product Manager", "Marketing Manager", "Marketing Officer", "Sales & Marketing Manager", "Admin", "Super Admin"])("allows canonical %s only inside Product and Promotion Group scope", role => {
    expect(canMutateScopedKeyMessage(role, scope(), { id: "P-A", promotionGroupId: "PG-A", active: true })).toBe(true);
    expect(canMutateScopedKeyMessage(role, scope(), { id: "P-X", promotionGroupId: "PG-A", active: true })).toBe(false);
    expect(canMutateScopedKeyMessage(role, scope(), { id: "P-A", promotionGroupId: "PG-X", active: true })).toBe(false);
  });

  it("fails closed for legacy, unknown, inactive Product, and denied scope", () => {
    expect(canMutateScopedKeyMessage("Marketing", scope(), { id: "P-A", promotionGroupId: "PG-A", active: true })).toBe(false);
    expect(canMutateScopedKeyMessage("Unknown", scope(), { id: "P-A", promotionGroupId: "PG-A", active: true })).toBe(false);
    expect(canMutateScopedKeyMessage("Product Manager", scope(), { id: "P-A", promotionGroupId: "PG-A", active: false })).toBe(false);
    expect(canMutateScopedKeyMessage("Product Manager", scope({ denyAll: true }), { id: "P-A", promotionGroupId: "PG-A", active: true })).toBe(false);
  });

  it("accepts only bounded mutation commands", () => {
    expect(parseKeyMessageMutation({ operation: "UPSERT", messageId: "KM-1", payload: { productId: "P-A" } })).not.toBeNull();
    expect(parseKeyMessageMutation({ operation: "DELETE", messageId: "KM-1" })).toBeNull();
    expect(parseKeyMessageMutation({ operation: "SOFT_DELETE", messageId: "../escape" })).toBeNull();
  });
});
