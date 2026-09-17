import { describe, expect, it } from "vitest";
import { CANONICAL_USER_ROLES, Role, type Product, type User } from "../types";
import type { CanonicalOperationalScope } from "./operationalScopeClient";
import {
  canExerciseProductMarketingAuthority,
  evaluateProductMarketingAuthority,
  filterProductsByCanonicalAuthority,
  type ProductMarketingAction,
} from "./productMarketingAuthority";
import { eligibleProductsForPhysician } from "./canonicalRepresentativeScope";

const user = (role: Role): User => ({ id: `UID-${role}`, name: role, email: "ap2p@example.invalid", role, active: true } as User);
const product = (id: string, group = "PG-1", active = true): Product => ({
  id, name: id, brand: group, promotionGroupId: group, therapeuticArea: "TA", price: 1, stock: 1, isActive: active,
});
const scope = (role: Role, productIds = ["P-1"], productGroupIds = ["PG-1"]): CanonicalOperationalScope => ({
  authorized: true, actorUid: `UID-${role}`, role, boundaryKind: "GLOBAL", subjectMode: "SELF",
  subjectUids: [`UID-${role}`], authorizedRepresentativeUids: [], countryIds: [], regionIds: [], districtIds: [], cityIds: [], areaIds: ["A-1"],
  productIds, productGroupIds,
  queryPlan: { denyAll: false, areaIdChunks: [["A-1"]], subjectUidChunks: [[`UID-${role}`]], productIdChunks: [productIds], requiresPostFilter: true },
  diagnostics: { excludedAssignmentIds: [], malformedAssignmentIds: [], outsideBoundaryAssignmentIds: [] },
});
const context = (role: Role, productIds = ["P-1"], productGroupIds = ["PG-1"]) => ({ user: user(role), operationalScope: scope(role, productIds, productGroupIds) });
const actions: ProductMarketingAction[] = [
  "VIEW_PRODUCT", "VIEW_PRODUCT_LIST", "MANAGE_PRODUCT", "VIEW_PROMOTION_GROUP", "MANAGE_PROMOTION_GROUP",
  "VIEW_KEY_MESSAGES", "MANAGE_KEY_MESSAGES", "VIEW_MARKETING_CONTENT", "MANAGE_MARKETING_CONTENT",
  "MANAGE_MARKETING_SETTINGS",
  "VIEW_PHYSICIAN_ALIGNMENT", "MANAGE_PHYSICIAN_ALIGNMENT",
];

describe("AP2P canonical Product / Medical / Marketing authority", () => {
  it("resolves every action deterministically for all 24 canonical roles", () => {
    for (const role of CANONICAL_USER_ROLES) for (const action of actions) {
      const first = evaluateProductMarketingAuthority(action, context(role));
      expect(evaluateProductMarketingAuthority(action, context(role))).toEqual(first);
      expect(typeof first.allowed).toBe("boolean");
    }
  });

  it.each([Role.WAREHOUSE_INVENTORY, Role.MARKETING, Role.SYSTEM_ADMINISTRATOR])("fails closed for legacy role %s", role => {
    expect(evaluateProductMarketingAuthority("VIEW_PRODUCT_LIST", context(role)).reason).toBe("NONCANONICAL_ROLE");
  });

  it("fails closed for an unknown role", () => {
    expect(evaluateProductMarketingAuthority("VIEW_PRODUCT_LIST", { user: { ...user(Role.ADMIN), role: "Future Role" as Role } }).reason).toBe("NONCANONICAL_ROLE");
  });

  it("keeps Product Manager product view and management inside operational scope", () => {
    const allowed = { ...context(Role.PRODUCT_MANAGER), product: product("P-1") };
    const outside = { ...context(Role.PRODUCT_MANAGER), product: product("P-2") };
    expect(evaluateProductMarketingAuthority("MANAGE_PRODUCT", allowed)).toMatchObject({ allowed: true, scopeBasis: "OPERATIONAL_PRODUCT_SCOPE" });
    expect(evaluateProductMarketingAuthority("MANAGE_PRODUCT", outside).reason).toBe("PRODUCT_SCOPE_DENY");
  });

  it("keeps Medical Representative products assigned, active, and promotion-group eligible", () => {
    expect(canExerciseProductMarketingAuthority("VIEW_PRODUCT", { ...context(Role.MEDICAL_REP), product: product("P-1") })).toBe(true);
    expect(evaluateProductMarketingAuthority("VIEW_PRODUCT", { ...context(Role.MEDICAL_REP), product: product("P-2") }).reason).toBe("PRODUCT_SCOPE_DENY");
    expect(evaluateProductMarketingAuthority("VIEW_PRODUCT", { ...context(Role.MEDICAL_REP), product: product("P-1", "PG-X") }).reason).toBe("PROMOTION_GROUP_SCOPE_DENY");
  });

  it.each([Role.MEDICAL_SUPERVISOR, Role.MEDICAL_MANAGER])("preserves scoped medical hierarchy behavior for %s", role => {
    expect(filterProductsByCanonicalAuthority(context(role), [product("P-1"), product("P-2")]).map(item => item.id)).toEqual(["P-1"]);
  });

  it.each([Role.MARKETING_MANAGER, Role.MARKETING_OFFICER, Role.SALES_MARKETING_MANAGER])("keeps %s explicit and product-scoped", role => {
    expect(canExerciseProductMarketingAuthority("MANAGE_KEY_MESSAGES", { ...context(role), product: product("P-1") })).toBe(true);
    expect(canExerciseProductMarketingAuthority("MANAGE_KEY_MESSAGES", { ...context(role), product: product("P-2") })).toBe(false);
  });

  it("rejects inactive products even inside scope", () => {
    expect(evaluateProductMarketingAuthority("VIEW_PRODUCT", { ...context(Role.PRODUCT_MANAGER), product: product("P-1", "PG-1", false) }).reason).toBe("INACTIVE_PRODUCT");
  });

  it("does not turn a promotion-group match into unrelated product access", () => {
    const result = evaluateProductMarketingAuthority("VIEW_PRODUCT", { ...context(Role.MARKETING_OFFICER, [], ["PG-1"]), product: product("P-2") });
    expect(result.reason).toBe("PRODUCT_SCOPE_DENY");
  });

  it("requires key-message product ownership when a product is identified", () => {
    expect(canExerciseProductMarketingAuthority("MANAGE_KEY_MESSAGES", { ...context(Role.PRODUCT_MANAGER), productId: "P-1", promotionGroupId: "PG-1" })).toBe(true);
    expect(evaluateProductMarketingAuthority("MANAGE_KEY_MESSAGES", { ...context(Role.PRODUCT_MANAGER), productId: "P-X", promotionGroupId: "PG-1" }).reason).toBe("PRODUCT_SCOPE_DENY");
  });

  it("keeps marketing-content managers explicit and respects the AP2O module ceiling", () => {
    expect(canExerciseProductMarketingAuthority("MANAGE_MARKETING_CONTENT", context(Role.MARKETING_MANAGER))).toBe(true);
    expect(canExerciseProductMarketingAuthority("MANAGE_MARKETING_CONTENT", context(Role.MARKETING_OFFICER))).toBe(true);
    expect(evaluateProductMarketingAuthority("MANAGE_MARKETING_CONTENT", context(Role.PRODUCT_MANAGER)).reason).toBe("MODULE_DENY");
    expect(evaluateProductMarketingAuthority("MANAGE_MARKETING_SETTINGS", context(Role.MARKETING_OFFICER)).reason).toBe("ROLE_DENY");
  });

  it("keeps physician alignment separate from general product visibility", () => {
    const base = { ...context(Role.ADMIN), physician: { alignedProductIds: ["P-1"], primaryPromotionGroupId: "PG-1" } };
    expect(evaluateProductMarketingAuthority("MANAGE_PHYSICIAN_ALIGNMENT", base)).toMatchObject({ allowed: true, scopeBasis: "PHYSICIAN_ALIGNMENT" });
    expect(evaluateProductMarketingAuthority("MANAGE_PHYSICIAN_ALIGNMENT", { ...base, physician: { alignedProductIds: ["P-X"], primaryPromotionGroupId: "PG-1" } }).reason).toBe("PHYSICIAN_ALIGNMENT_DENY");
    expect(evaluateProductMarketingAuthority("MANAGE_PHYSICIAN_ALIGNMENT", { ...context(Role.PRODUCT_MANAGER), physician: base.physician }).reason).toBe("MODULE_DENY");
  });

  it("allows Medical Manager through Field governance only with valid alignment scope", () => {
    const base = {
      ...context(Role.MEDICAL_MANAGER),
      physician: { alignedProductIds: ["P-1"], primaryPromotionGroupId: "PG-1" },
    };
    expect(evaluateProductMarketingAuthority("MANAGE_PHYSICIAN_ALIGNMENT", base)).toMatchObject({ allowed: true, scopeBasis: "PHYSICIAN_ALIGNMENT" });
    expect(evaluateProductMarketingAuthority("MANAGE_PHYSICIAN_ALIGNMENT", {
      ...context(Role.MEDICAL_MANAGER, ["P-X"], ["PG-1"]), physician: base.physician,
    }).reason).toBe("PHYSICIAN_ALIGNMENT_DENY");
    expect(evaluateProductMarketingAuthority("MANAGE_PHYSICIAN_ALIGNMENT", {
      ...context(Role.MEDICAL_MANAGER, ["P-1"], ["PG-X"]), physician: base.physician,
    }).reason).toBe("PHYSICIAN_ALIGNMENT_DENY");
    expect(evaluateProductMarketingAuthority("MANAGE_PHYSICIAN_ALIGNMENT", {
      ...context(Role.MEDICAL_MANAGER), physician: { alignedProductIds: ["P-X"], primaryPromotionGroupId: "PG-1" },
    }).reason).toBe("PHYSICIAN_ALIGNMENT_DENY");
  });

  it("does not turn Medical Manager Field navigation into unrelated or global authority", () => {
    expect(evaluateProductMarketingAuthority("MANAGE_MARKETING_CONTENT", context(Role.MEDICAL_MANAGER)).reason).toBe("MODULE_DENY");
    expect(evaluateProductMarketingAuthority("MANAGE_KEY_MESSAGES", context(Role.MEDICAL_MANAGER)).reason).toBe("ROLE_DENY");
    expect(evaluateProductMarketingAuthority("MANAGE_PRODUCT", { ...context(Role.MEDICAL_MANAGER), product: product("P-X") }).reason).toBe("PRODUCT_SCOPE_DENY");
  });

  it("makes Admin and Super Admin authority explicit without bypassing record scope", () => {
    for (const role of [Role.ADMIN, Role.SUPER_ADMIN]) {
      expect(evaluateProductMarketingAuthority("MANAGE_PRODUCT", { ...context(role), product: product("P-1") }).allowed).toBe(true);
      expect(evaluateProductMarketingAuthority("MANAGE_PRODUCT", { user: user(role), product: product("P-1") }).reason).toBe("PRODUCT_SCOPE_DENY");
    }
  });

  it("does not treat navigation as product-data authority", () => {
    expect(evaluateProductMarketingAuthority("VIEW_PRODUCT_LIST", { user: user(Role.MEDICAL_REP) }).reason).toBe("PRODUCT_SCOPE_DENY");
    expect(filterProductsByCanonicalAuthority({ user: user(Role.MEDICAL_REP) }, [product("P-1")])).toEqual([]);
  });

  it("does not alter representative detailing/sample eligibility primitives", () => {
    const physician = { id: "DR-1", name: "Doctor", specialty: "Cardiology", classification: "A" as const, territory: "A-1", region: "R", address: "Clinic", areaId: "A-1", primaryPromotionGroupId: "PG-1" };
    const assignments = [{ assignmentId: "PA-1", userId: "REP-1", productId: "P-1", productGroupId: "PG-1", therapeuticArea: "TA", assignmentType: "medical" as const, effectiveFrom: "2026-01-01", effectiveTo: "2030-01-01", status: "Active" as const, assignedBy: "ADMIN", assignedAt: "2026-01-01", active: true }];
    expect(eligibleProductsForPhysician({ physician, representativeUid: "REP-1", productAssignments: assignments, products: [product("P-1"), product("P-2")] }).map(item => item.id)).toEqual(["P-1"]);
  });
});
