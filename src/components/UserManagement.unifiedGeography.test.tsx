import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Role } from "../types";
import { isDescendantInheritedScopeRole, resolveRoleAssignmentAdministrationContract, resolveRoleScopePolicy } from "../lib/roleScopePolicy";

const inheritedRoles = [
  Role.GENERAL_MANAGER, Role.REGIONAL_MANAGER, Role.COUNTRY_MANAGER,
  Role.SALES_MARKETING_MANAGER, Role.SALES_MANAGER, Role.AREA_SALES_MANAGER,
  Role.SALES_SUPERVISOR, Role.MARKETING_MANAGER, Role.MEDICAL_MANAGER,
  Role.MEDICAL_SUPERVISOR,
];
const source = readFileSync(new URL("./UserManagement.tsx", import.meta.url), "utf8");
const creationSource = readFileSync(new URL("../lib/firestoreService.ts", import.meta.url), "utf8");

describe("User Management canonical scope-source contract", () => {
  it.each(inheritedRoles)("%s inherits both sources without direct assignment editors", role => {
    expect(isDescendantInheritedScopeRole(role)).toBe(true);
    expect(resolveRoleScopePolicy(role)).toMatchObject({ geographySource: "DESCENDANTS", productSource: "DESCENDANTS", hierarchyDepth: "descendants" });
    expect(resolveRoleAssignmentAdministrationContract(role)).toMatchObject({ canonicalGeography: false, canonicalProducts: false, productScopeRequired: false });
  });

  it("keeps organization roles distinct", () => {
    for (const role of [Role.SUPER_ADMIN, Role.ADMIN]) {
      expect(isDescendantInheritedScopeRole(role)).toBe(false);
      expect(resolveRoleScopePolicy(role)).toMatchObject({ geographySource: "ORGANIZATION", productSource: "ORGANIZATION" });
    }
  });

  it("keeps representatives direct", () => {
    for (const role of [Role.MEDICAL_REP, Role.SALES_REP]) {
      expect(resolveRoleScopePolicy(role)).toMatchObject({ geographySource: "SELF", productSource: "SELF" });
      expect(resolveRoleAssignmentAdministrationContract(role).canonicalGeography).toBe(true);
    }
  });

  it("removes scalar Country and direct assignment synchronization gates from inherited roles while unknown roles fail safely", () => {
    expect(source).toContain("!inheritedScope && !organizationScope && !country.trim()");
    expect(source).toContain("if (assignmentAdminContract.canonicalGeography || assignmentAdminContract.canonicalProducts)");
    expect(source).toContain("Inherited from Subordinates");
    expect(source).toContain('data-scope-source="descendants"');
    expect(creationSource).toContain('const directGeography = !scopePolicy || scopePolicy.geographySource === "SELF"');
    expect(creationSource).toContain("if (directGeography && !input.country");
  });

  it("uses transient four-level arrays and no persisted Select All flags", () => {
    expect(source).toContain("assignCountryIds");
    expect(source).toContain("assignDistrictIds");
    expect(source).toContain("assignCityIds");
    expect(source).toContain("Select All Available Areas");
    expect(source).not.toMatch(/selectAllCountries\s*:|selectAllDistricts\s*:|selectAllCities\s*:|selectAllAreas\s*:/);
  });

  it("leaves canonical Area assignment documents as direct geography authority", () => {
    expect(source).toContain("const taId = `TA_${uId}_${areaId}`");
    expect(source).toContain("canonicalPathForArea(areaId, districtsList, citiesList, areasList)");
    expect(source).toContain("areaIds: assignedAreas.map(a => a.id)");
  });
});
