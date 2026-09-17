import { describe, expect, it } from "vitest";
import { CANONICAL_USER_ROLES, Role, type SampleCapability } from "../types";
import { canManageAcademicResources, canonicalPermissionApplicability, rbacMatrixApplicability } from "./canonicalPermissionApplicability";
import { getDefaultSampleCapabilities, hasSampleCapability } from "./sampleAuthorization";
import { hasVisitMarketingRequestPermission } from "./visitMarketingRequestPolicy";

describe("AP2R canonical authorization cascade", () => {
  it("evaluates all 24 canonical roles and fails legacy identities closed", () => {
    expect(CANONICAL_USER_ROLES).toHaveLength(24);
    for (const role of CANONICAL_USER_ROLES) expect(canonicalPermissionApplicability(role, "ACADEMIC_RESOURCE_MANAGE")).toMatch(/AVAILABLE|CONDITIONAL|DENIED/);
    expect(canonicalPermissionApplicability("Marketing", "ACADEMIC_RESOURCE_MANAGE")).toBe("DENIED");
    expect(canonicalPermissionApplicability("Warehouse / Inventory", "ACADEMIC_RESOURCE_MANAGE")).toBe("DENIED");
    expect(canonicalPermissionApplicability("Unknown", "PHYSICIAN_CREATE")).toBe("DENIED");
  });

  it("makes stale Resource RBAC true harmless outside the canonical envelope", () => {
    expect(canManageAcademicResources(Role.FINANCE, { resourceCapabilities: { manage: true } })).toBe(false);
    expect(canManageAcademicResources(Role.MARKETING_OFFICER, { resourceCapabilities: { manage: true } })).toBe(false);
    expect(canManageAcademicResources(Role.PRODUCT_MANAGER, { resourceCapabilities: { manage: false } })).toBe(false);
    expect(canManageAcademicResources(Role.PRODUCT_MANAGER, { resourceCapabilities: { manage: true } })).toBe(true);
    expect(rbacMatrixApplicability(Role.FINANCE, "resourceManage")).toBe("DENIED");
  });

  it("cannot manufacture Sample authority from persisted true", () => {
    const capabilities: SampleCapability[] = ["VIEW_SAMPLE_INVENTORY", "RECEIVE_SAMPLE_STOCK", "ADJUST_SAMPLE_STOCK", "ALLOCATE_SAMPLE_STOCK", "APPROVE_SAMPLE_REQUEST"];
    for (const capability of capabilities) {
      expect(hasSampleCapability({ role: Role.FINANCE }, capability, { sampleCapabilities: { [capability]: true } } as any)).toBe(false);
      expect(hasSampleCapability({ role: Role.DELIVERY_OFFICER }, capability, { sampleCapabilities: { [capability]: true } } as any)).toBe(false);
    }
    expect(getDefaultSampleCapabilities(Role.WAREHOUSE_INVENTORY).ADJUST_SAMPLE_STOCK).toBe(false);
    expect(hasSampleCapability({ role: Role.INVENTORY_OFFICER }, "ADJUST_SAMPLE_STOCK", { sampleCapabilities: { ADJUST_SAMPLE_STOCK: false } } as any)).toBe(false);
  });

  it("requires canonical Marketing Request lifecycle roles before persisted flags", () => {
    expect(hasVisitMarketingRequestPermission(Role.FINANCE, "finalApprove", { approve: true, marketingRequestCapabilities: { finalApprove: true } })).toBe(false);
    expect(hasVisitMarketingRequestPermission(Role.MEDICAL_REP, "supervisorApprove", { approve: true, marketingRequestCapabilities: { supervisorApprove: true } })).toBe(false);
    expect(hasVisitMarketingRequestPermission(Role.MEDICAL_SUPERVISOR, "supervisorApprove", { marketingRequestCapabilities: { supervisorApprove: true } })).toBe(true);
    expect(hasVisitMarketingRequestPermission(Role.MEDICAL_SUPERVISOR, "supervisorApprove", { marketingRequestCapabilities: { supervisorApprove: false } })).toBe(false);
  });

  it("limits physician creation to the approved canonical roles", () => {
    for (const role of [Role.SUPER_ADMIN, Role.ADMIN, Role.MEDICAL_MANAGER, Role.MEDICAL_SUPERVISOR]) expect(canonicalPermissionApplicability(role, "PHYSICIAN_CREATE")).not.toBe("DENIED");
    for (const role of [Role.MEDICAL_REP, Role.SALES_MANAGER, Role.PRODUCT_MANAGER, Role.FINANCE]) expect(canonicalPermissionApplicability(role, "PHYSICIAN_CREATE")).toBe("DENIED");
  });
});
