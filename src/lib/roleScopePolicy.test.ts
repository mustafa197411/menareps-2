import { describe, expect, it } from "vitest";
import { Role } from "../types";
import { resolveRoleScopePolicy } from "./roleScopePolicy";

describe("canonical role-scope policy", () => {
  it("models Product Manager as direct functional geography and product scope", () => {
    expect(resolveRoleScopePolicy(Role.PRODUCT_MANAGER)).toMatchObject({
      subjectMode: "FUNCTIONAL",
      hierarchyDepth: "self",
      geographySource: "SELF",
      productSource: "SELF",
      descendantsContribute: false,
      functionalDirectAssignments: true,
      productScopeRequired: true,
    });
  });

  it("keeps representative and management subject policies distinct", () => {
    expect(resolveRoleScopePolicy(Role.MEDICAL_REP)?.subjectMode).toBe("SELF");
    expect(resolveRoleScopePolicy(Role.SALES_REP)?.subjectMode).toBe("SELF");
    expect(resolveRoleScopePolicy(Role.MEDICAL_MANAGER)).toMatchObject({ subjectMode: "HIERARCHY", hierarchyDepth: "descendants" });
    expect(resolveRoleScopePolicy(Role.SALES_MANAGER)).toMatchObject({ subjectMode: "HIERARCHY", hierarchyDepth: "descendants" });
  });

  it("fails closed for unknown roles and structurally invalid overrides", () => {
    expect(resolveRoleScopePolicy("Example Role")).toBeNull();
    expect(resolveRoleScopePolicy(Role.PRODUCT_MANAGER, { functionalDirectAssignments: false })).toBeNull();
    expect(resolveRoleScopePolicy(Role.MEDICAL_REP, { hierarchyDepth: "descendants" })).toBeNull();
  });
});
