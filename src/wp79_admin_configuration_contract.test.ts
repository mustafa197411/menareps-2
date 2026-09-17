import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Role } from "./types";
import { getAssignableCanonicalProducts, validateSyncInputs } from "./lib/productAssignmentService";
import { hydrateRepresentativeEditState, validateRepresentativePrimaryGroup } from "./lib/representativeEditState";
import { resolveRoleAssignmentAdministrationContract, resolveRoleScopePolicy } from "./lib/roleScopePolicy";

const groups = [
  { id: "GROUP-ALPHA", name: "Alpha", isActive: true },
  { id: "GROUP-BETA", name: "Beta", isActive: true },
  { id: "GROUP-INACTIVE", name: "Inactive", isActive: false },
] as any[];
const products = [
  { id: "PRODUCT-ONE", name: "One", promotionGroupId: "GROUP-ALPHA", isActive: true },
  { id: "PRODUCT-TWO", name: "Two", promotionGroupId: "GROUP-BETA", isActive: true },
  { id: "PRODUCT-NO-GROUP", name: "No group", isActive: true },
  { id: "PRODUCT-INACTIVE-GROUP", name: "Inactive group", promotionGroupId: "GROUP-INACTIVE", isActive: true },
] as any[];
const userManagementSource = readFileSync(new URL("./components/UserManagement.tsx", import.meta.url), "utf8");
const cascadeSource = readFileSync(new URL("./lib/multiAreaCascade.ts", import.meta.url), "utf8");
const representativeScopeSource = readFileSync(new URL("./lib/canonicalRepresentativeScope.ts", import.meta.url), "utf8");

describe("WP79 Product Manager assignment administration contract", () => {
  it("derives direct canonical geography and Product editors from the canonical functional policy", () => {
    expect(resolveRoleAssignmentAdministrationContract(Role.PRODUCT_MANAGER)).toEqual({
      canonicalGeography: true,
      canonicalProducts: true,
      representativePromotionGroups: false,
      productScopeRequired: true,
    });
    expect(resolveRoleScopePolicy(Role.PRODUCT_MANAGER)).toMatchObject({ subjectMode: "FUNCTIONAL", descendantsContribute: false });
  });

  it("keeps representative assignment support and representative-only Promotion Group semantics separate", () => {
    expect(resolveRoleAssignmentAdministrationContract(Role.MEDICAL_REP)).toMatchObject({ canonicalGeography: true, canonicalProducts: true, representativePromotionGroups: true });
    expect(validateRepresentativePrimaryGroup(Role.PRODUCT_MANAGER, null).validationResult).toBe("PASS");
  });

  it("lists multiple active canonical Products and derives scope only through their canonical Promotion Groups", () => {
    expect(getAssignableCanonicalProducts({ products, promotionGroups: groups }).map(product => product.id))
      .toEqual(["PRODUCT-ONE", "PRODUCT-TWO"]);
  });

  it("accepts multiple canonical Product IDs without imposing representative Primary/Target selection", () => {
    expect(validateSyncInputs({
      representativeUid: "SYNTHETIC-PRODUCT-MANAGER",
      selectedProductIds: ["PRODUCT-ONE", "PRODUCT-TWO"],
      products,
      primaryPromotionGroupId: null,
      targetPromotionGroupIds: [],
      requirePromotionGroupSelection: false,
      promotionGroups: groups,
    })).toEqual({ ok: true, errors: [] });
  });

  it("fails closed for a non-canonical Product ID", () => {
    expect(validateSyncInputs({
      representativeUid: "SYNTHETIC-PRODUCT-MANAGER",
      selectedProductIds: ["UNKNOWN-PRODUCT"],
      products,
      primaryPromotionGroupId: null,
      targetPromotionGroupIds: [],
      requirePromotionGroupSelection: false,
      promotionGroups: groups,
    }).ok).toBe(false);
  });

  it("fails closed when a selected Product lacks one active canonical Promotion Group", () => {
    expect(validateSyncInputs({
      representativeUid: "SYNTHETIC-PRODUCT-MANAGER",
      selectedProductIds: ["PRODUCT-INACTIVE-GROUP"],
      products,
      primaryPromotionGroupId: null,
      targetPromotionGroupIds: [],
      requirePromotionGroupSelection: false,
      promotionGroups: groups,
    }).ok).toBe(false);
  });

  it("rehydrates exact canonical multi-area and multi-Product assignments without profile fallback", () => {
    const state = hydrateRepresentativeEditState({
      user: { id: "SYNTHETIC-PM", role: Role.PRODUCT_MANAGER, areaIds: ["LEGACY-AREA"], products: ["PRODUCT-ONE"] } as any,
      territoryAssignments: [
        { territoryId: "AREA-ONE", active: true, status: "Active" },
        { territoryId: "AREA-TWO", active: true, status: "Active" },
      ],
      productAssignments: [
        { productId: "PRODUCT-ONE", active: true, status: "Active" },
        { productId: "PRODUCT-TWO", active: true, status: "Active" },
      ],
      products,
      promotionGroups: groups,
      canonicalAssignmentsOnly: true,
    });
    expect(state.assignedAreaIds).toEqual(["AREA-ONE", "AREA-TWO"]);
    expect(state.selectedProductIds).toEqual(["PRODUCT-ONE", "PRODUCT-TWO"]);
  });

  it("does not hydrate Product Manager authority from legacy profile-only Areas or Products", () => {
    const state = hydrateRepresentativeEditState({
      user: { id: "SYNTHETIC-PM", role: Role.PRODUCT_MANAGER, areaIds: ["LEGACY-AREA"], products: ["PRODUCT-ONE"] } as any,
      territoryAssignments: [], productAssignments: [], products, promotionGroups: groups, canonicalAssignmentsOnly: true,
    });
    expect(state.assignedAreaIds).toEqual([]);
    expect(state.selectedProductIds).toEqual([]);
  });

  it("uses the canonical assignment sync path without changing reporting hierarchy", () => {
    expect(userManagementSource).toContain("assignmentAdminContract.canonicalGeography");
    expect(userManagementSource).toContain("assignmentAdminContract.canonicalProducts");
    expect(userManagementSource).toContain("await syncAssignments(updatedUser.id, role");
    expect(userManagementSource).not.toContain("setManager(assignedAreas");
  });

  it("requires the complete canonical parent path in every dependent Area selector", () => {
    expect(userManagementSource).toContain("citiesForDistrict(citiesList, assignCountryId, assignDistrictId)");
    expect(userManagementSource).toContain("areasForSelectedCities(areasList, assignCountryId, assignDistrictId, assignCityIds)");
    expect(userManagementSource).toContain("canonicalPathForArea(areaId, districtsList, citiesList, areasList)");
    expect(cascadeSource).toContain("city.countryId === countryId");
    expect(cascadeSource).toContain("area.countryId === countryId");
    expect(cascadeSource).toContain("area.districtId === districtId");
    expect(representativeScopeSource).toContain("district.countryId !== area.countryId");
  });

  it("does not grant Product Manager representative-only visit creation", () => {
    expect(resolveRoleScopePolicy(Role.PRODUCT_MANAGER)?.subjectMode).toBe("FUNCTIONAL");
    expect(userManagementSource).not.toContain('role === Role.PRODUCT_MANAGER && canCreatePhysicianVisit');
  });
});
