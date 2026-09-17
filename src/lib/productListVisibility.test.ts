import { describe, expect, it } from "vitest";
import { Role, type Product, type User } from "../types";
import type { CanonicalOperationalScope } from "./operationalScopeClient";
import type { OperationalScopeSessionState } from "./operationalScopeSession";
import {
  authorizeProductListProducts,
  filterProductListForPresentation,
} from "./productListVisibility";

const actor = (role: Role = Role.MEDICAL_SUPERVISOR): User => ({
  id: "SUPERVISOR-UID",
  name: "Supervisor",
  email: "supervisor@example.invalid",
  role,
} as User);

const product = (id: string, overrides: Partial<Product> = {}): Product => ({
  id,
  name: `Product ${id}`,
  sku: `SKU-${id}`,
  price: 10,
  stock: 5,
  isActive: true,
  ...overrides,
} as Product);

const scope = (overrides: Partial<CanonicalOperationalScope> = {}): CanonicalOperationalScope => ({
  authorized: true,
  actorUid: "SUPERVISOR-UID",
  role: Role.MEDICAL_SUPERVISOR,
  boundaryKind: "GLOBAL",
  subjectMode: "HIERARCHY",
  subjectUids: ["SUPERVISOR-UID", "REP-1"],
  countryIds: [], regionIds: [], districtIds: [], cityIds: [], areaIds: [],
  productIds: ["P1"],
  productGroupIds: [],
  queryPlan: {
    denyAll: false,
    areaIdChunks: [], subjectUidChunks: [], productIdChunks: [["P1"]], requiresPostFilter: true,
  },
  diagnostics: { excludedAssignmentIds: [], malformedAssignmentIds: [], outsideBoundaryAssignmentIds: [] },
  ...overrides,
});

const session = (
  status: OperationalScopeSessionState["status"] = "READY",
  scopeValue: CanonicalOperationalScope | null = scope(),
  actorUid: string | null = "SUPERVISOR-UID",
): OperationalScopeSessionState => ({ status, actorUid, scope: scopeValue });

const authorize = (
  products: Product[],
  sessionValue: OperationalScopeSessionState = session(),
  user: User = actor(),
) => authorizeProductListProducts({ currentUser: user, products, operationalScopeSession: sessionValue });

describe("Fix 5B.2 Product List canonical Medical Supervisor authorization", () => {
  it("A exposes the one exact product authorized through one subordinate", () => {
    expect(authorize([product("P1"), product("P2")]).map(({ id }) => id)).toEqual(["P1"]);
  });

  it("B exposes the deduplicated hierarchy product union from canonical scope", () => {
    const hierarchyScope = scope({ productIds: ["P1", "P2", "P1"] });
    expect(authorize([product("P1"), product("P2")], session("READY", hierarchyScope)).map(({ id }) => id))
      .toEqual(["P1", "P2"]);
  });

  it("C excludes Product Master records outside canonical scope", () => {
    expect(authorize([product("P1"), product("OUTSIDE")]).map(({ id }) => id)).toEqual(["P1"]);
  });

  it("D exposes zero products for an empty authorized product set", () => {
    expect(authorize([product("P1")], session("READY", scope({ productIds: [] })))).toEqual([]);
  });

  it.each(["UNINITIALIZED", "LOADING"] as const)("E fails closed while scope is %s", (status) => {
    expect(authorize([product("P1")], session(status, null))).toEqual([]);
  });

  it("F fails closed when scope is unauthorized", () => {
    expect(authorize([product("P1")], session("READY", scope({ authorized: false })))).toEqual([]);
  });

  it("G fails closed when query plan denies all", () => {
    const denied = scope({ queryPlan: { ...scope().queryPlan, denyAll: true } });
    expect(authorize([product("P1")], session("READY", denied))).toEqual([]);
  });

  it("H fails closed on session or scope actor mismatch", () => {
    expect(authorize([product("P1")], session("READY", scope(), "OTHER-UID"))).toEqual([]);
    expect(authorize([product("P1")], session("READY", scope({ actorUid: "OTHER-UID" })))).toEqual([]);
  });

  it("I ignores absent canonical IDs and never substitutes matching name or SKU", () => {
    const catalog = [product("OTHER-ID", { name: "P1", sku: "P1" })];
    expect(authorize(catalog)).toEqual([]);
  });

  it("J applies presentation filters after authorization", () => {
    const canonical = authorize(
      [product("P1", { name: "Authorized active" }), product("P2", { name: "Authorized inactive", isActive: false }), product("P3")],
      session("READY", scope({ productIds: ["P1", "P2"] })),
    );
    expect(filterProductListForPresentation(canonical, {
      searchTerm: "Authorized",
      selectedPromotionType: "All",
      selectedBrand: "All",
      sortOrder: "Default",
      showInactive: false,
      showUat: false,
    }).map(({ id }) => id)).toEqual(["P1"]);
  });

  it.each([
    Role.MEDICAL_REP,
    Role.SALES_REP,
    Role.SALES_SUPERVISOR,
    Role.MEDICAL_MANAGER,
    Role.SALES_MANAGER,
    Role.COUNTRY_MANAGER,
    Role.REGIONAL_MANAGER,
    Role.GENERAL_MANAGER,
    Role.ADMIN,
    Role.SUPER_ADMIN,
  ])("K applies canonical scope to Product-list role %s", (role) => {
    const catalog = [product("P1"), product("P2")];
    expect(authorize(catalog, session(), actor(role)).map(({ id }) => id)).toEqual(["P1"]);
  });

  it("L fails closed for every role when canonical scope is unavailable", () => {
    expect(authorize([product("P1")], session("ERROR", null), actor(Role.SUPER_ADMIN))).toEqual([]);
  });
});
