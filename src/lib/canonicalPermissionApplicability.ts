import { CANONICAL_USER_ROLES, Role, normalizeRole, type Permissions, type SampleCapability } from "../types";
import { isProductMarketingRoleApplicable } from "./productMarketingRoleApplicability";

export type CanonicalPermissionDomain =
  | "ACADEMIC_RESOURCE_MANAGE"
  | "PHYSICIAN_CREATE"
  | "MARKETING_CONTENT_MANAGE"
  | "PROMOTION_GROUP_MANAGE"
  | "MARKETING_REQUEST_SUPERVISOR"
  | "MARKETING_REQUEST_FINAL"
  | "MARKETING_REQUEST_EXECUTE";


export type PermissionApplicability = "AVAILABLE" | "CONDITIONAL" | "DENIED";

const canonical = (role: string | Role): Role | null => {
  const normalized = normalizeRole(String(role));
  return CANONICAL_USER_ROLES.includes(normalized as Role) ? normalized as Role : null;
};

const DOMAIN_ROLES: Readonly<Record<CanonicalPermissionDomain, ReadonlySet<Role>>> = Object.freeze({
  ACADEMIC_RESOURCE_MANAGE: new Set(CANONICAL_USER_ROLES.filter(role => isProductMarketingRoleApplicable("MANAGE_MARKETING_SETTINGS", role))),
  PHYSICIAN_CREATE: new Set([Role.SUPER_ADMIN, Role.ADMIN, Role.MEDICAL_MANAGER, Role.MEDICAL_SUPERVISOR]),
  MARKETING_CONTENT_MANAGE: new Set(CANONICAL_USER_ROLES.filter(role => isProductMarketingRoleApplicable("MANAGE_MARKETING_CONTENT", role))),
  PROMOTION_GROUP_MANAGE: new Set(CANONICAL_USER_ROLES.filter(role => isProductMarketingRoleApplicable("MANAGE_PROMOTION_GROUP", role))),
  MARKETING_REQUEST_SUPERVISOR: new Set([Role.MEDICAL_SUPERVISOR, Role.SALES_SUPERVISOR]),
  MARKETING_REQUEST_FINAL: new Set([Role.MEDICAL_MANAGER, Role.SALES_MANAGER, Role.AREA_SALES_MANAGER, Role.COUNTRY_MANAGER, Role.REGIONAL_MANAGER, Role.SALES_MARKETING_MANAGER]),
  MARKETING_REQUEST_EXECUTE: new Set([Role.MEDICAL_MANAGER, Role.MARKETING_MANAGER, Role.SALES_MARKETING_MANAGER]),
});

export function canonicalPermissionApplicability(role: string | Role, domain: CanonicalPermissionDomain): PermissionApplicability {
  const resolved = canonical(role);
  if (!resolved || !DOMAIN_ROLES[domain].has(resolved)) return "DENIED";
  return [Role.SUPER_ADMIN, Role.ADMIN].includes(resolved) ? "AVAILABLE" : "CONDITIONAL";
}

export function isCanonicalPermissionApplicable(role: string | Role, domain: CanonicalPermissionDomain): boolean {
  return canonicalPermissionApplicability(role, domain) !== "DENIED";
}

/** A persisted true is only the absence of an RBAC restriction, never a grant. */
export function permitsApplicableCapability(applicable: boolean, persisted: boolean | undefined, defaultWhenMissing: boolean): boolean {
  return applicable && (persisted === undefined ? defaultWhenMissing : persisted === true);
}

export function canManageAcademicResources(role: string | Role, permissions?: Pick<Permissions, "resourceCapabilities"> | null): boolean {
  return permitsApplicableCapability(
    isCanonicalPermissionApplicable(role, "ACADEMIC_RESOURCE_MANAGE"),
    permissions?.resourceCapabilities?.manage,
    false,
  );
}

export function restrictSampleCapability(
  roleDefault: boolean,
  capability: SampleCapability,
  permissions?: Pick<Permissions, "sampleCapabilities"> | null,
): boolean {
  return permitsApplicableCapability(roleDefault, permissions?.sampleCapabilities?.[capability], roleDefault);
}

export type RbacMatrixPermission = keyof Pick<Permissions, "view" | "create" | "edit" | "delete" | "approve" | "export" | "import" | "assign" | "reassign" | "viewTeamData" | "viewNationalData" | "viewFinancialData"> | "resourceManage" | "marketingExecute";
export function rbacMatrixApplicability(role: string | Role, permission: RbacMatrixPermission): PermissionApplicability {
  if (!canonical(role)) return "DENIED";
  if (permission === "resourceManage") return canonicalPermissionApplicability(role, "ACADEMIC_RESOURCE_MANAGE");
  if (permission === "marketingExecute") return canonicalPermissionApplicability(role, "MARKETING_REQUEST_EXECUTE");
  if (["reassign", "viewNationalData", "viewFinancialData"].includes(permission)) return "DENIED";
  // Generic flags have no domain-independent grant meaning. Their consumers
  // must establish a canonical domain ceiling and treat the flag as a limit.
  return "CONDITIONAL";
}
