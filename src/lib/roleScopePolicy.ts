import { CANONICAL_USER_ROLES, Role, normalizeRole } from "../types";

export type RoleScopeSubjectMode = "SELF" | "HIERARCHY" | "ORGANIZATION" | "FUNCTIONAL";
export type RoleScopeHierarchyDepth = "self" | "direct" | "descendants";
export type RoleScopeAssignmentSource = "SELF" | "DESCENDANTS" | "ORGANIZATION" | "NONE";

export interface CanonicalRoleScopePolicy {
  role: string;
  subjectMode: RoleScopeSubjectMode;
  hierarchyDepth: RoleScopeHierarchyDepth;
  geographySource: RoleScopeAssignmentSource;
  productSource: RoleScopeAssignmentSource;
  descendantsContribute: boolean;
  functionalDirectAssignments: boolean;
  productScopeRequired: boolean;
  crossGeography: boolean;
  crossDepartment: boolean;
}

export type RoleScopePolicyOverride = Partial<Omit<CanonicalRoleScopePolicy, "role">>;

const self = (role: Role, productSource: RoleScopeAssignmentSource = "SELF"): CanonicalRoleScopePolicy => ({
  role,
  subjectMode: "SELF",
  hierarchyDepth: "self",
  geographySource: "SELF",
  productSource,
  descendantsContribute: false,
  functionalDirectAssignments: false,
  productScopeRequired: false,
  crossGeography: false,
  crossDepartment: false,
});

const hierarchy = (
  role: Role,
  options: Partial<Pick<CanonicalRoleScopePolicy, "productSource" | "crossGeography" | "crossDepartment">> = {},
): CanonicalRoleScopePolicy => ({
  role,
  subjectMode: "HIERARCHY",
  hierarchyDepth: "descendants",
  geographySource: "DESCENDANTS",
  productSource: options.productSource || "DESCENDANTS",
  descendantsContribute: true,
  functionalDirectAssignments: false,
  productScopeRequired: false,
  crossGeography: options.crossGeography === true,
  crossDepartment: options.crossDepartment === true,
});

const organization = (role: Role): CanonicalRoleScopePolicy => ({
  role,
  subjectMode: "ORGANIZATION",
  hierarchyDepth: "descendants",
  geographySource: "ORGANIZATION",
  productSource: "ORGANIZATION",
  descendantsContribute: true,
  functionalDirectAssignments: false,
  productScopeRequired: false,
  crossGeography: true,
  crossDepartment: true,
});

const functional = (role: Role, productSource: RoleScopeAssignmentSource = "SELF"): CanonicalRoleScopePolicy => ({
  role,
  subjectMode: "FUNCTIONAL",
  hierarchyDepth: "self",
  geographySource: "SELF",
  productSource,
  descendantsContribute: false,
  functionalDirectAssignments: true,
  productScopeRequired: productSource === "SELF",
  crossGeography: false,
  crossDepartment: true,
});

/**
 * The single code default for operational data-scope semantics. Persisted
 * accessGovernance role records may override these fields, but navigation or
 * action grants never do so implicitly.
 */
export const CANONICAL_ROLE_SCOPE_POLICIES: Readonly<Record<Role, CanonicalRoleScopePolicy>> = {
  [Role.SUPER_ADMIN]: organization(Role.SUPER_ADMIN),
  [Role.ADMIN]: organization(Role.ADMIN),
  [Role.GENERAL_MANAGER]: hierarchy(Role.GENERAL_MANAGER, { crossGeography: true, crossDepartment: true }),
  [Role.REGIONAL_MANAGER]: hierarchy(Role.REGIONAL_MANAGER, { crossDepartment: true }),
  [Role.COUNTRY_MANAGER]: hierarchy(Role.COUNTRY_MANAGER, { crossDepartment: true }),
  [Role.SALES_MARKETING_MANAGER]: hierarchy(Role.SALES_MARKETING_MANAGER, { crossGeography: true, crossDepartment: true }),
  [Role.SALES_MANAGER]: hierarchy(Role.SALES_MANAGER),
  [Role.AREA_SALES_MANAGER]: hierarchy(Role.AREA_SALES_MANAGER),
  [Role.SALES_SUPERVISOR]: hierarchy(Role.SALES_SUPERVISOR),
  [Role.SALES_REP]: self(Role.SALES_REP),
  [Role.MARKETING_MANAGER]: hierarchy(Role.MARKETING_MANAGER),
  [Role.PRODUCT_MANAGER]: functional(Role.PRODUCT_MANAGER),
  [Role.MARKETING_OFFICER]: self(Role.MARKETING_OFFICER),
  [Role.MEDICAL_MANAGER]: hierarchy(Role.MEDICAL_MANAGER),
  [Role.MEDICAL_SUPERVISOR]: hierarchy(Role.MEDICAL_SUPERVISOR),
  [Role.MEDICAL_REP]: self(Role.MEDICAL_REP),
  [Role.FINANCE_MANAGER]: functional(Role.FINANCE_MANAGER, "NONE"),
  [Role.FINANCE]: functional(Role.FINANCE, "NONE"),
  [Role.TREASURY_OFFICER]: functional(Role.TREASURY_OFFICER, "NONE"),
  [Role.WAREHOUSE_MANAGER]: functional(Role.WAREHOUSE_MANAGER, "NONE"),
  [Role.INVENTORY_OFFICER]: functional(Role.INVENTORY_OFFICER, "NONE"),
  [Role.STORE_MANAGER]: functional(Role.STORE_MANAGER, "NONE"),
  [Role.DELIVERY_OFFICER]: functional(Role.DELIVERY_OFFICER, "NONE"),
  [Role.ORDER_OPS_OFFICER]: functional(Role.ORDER_OPS_OFFICER, "NONE"),
  [Role.WAREHOUSE_INVENTORY]: functional(Role.WAREHOUSE_INVENTORY, "NONE"),
  [Role.MARKETING]: self(Role.MARKETING),
  [Role.SYSTEM_ADMINISTRATOR]: organization(Role.SYSTEM_ADMINISTRATOR),
};

const SUBJECT_MODES = new Set<RoleScopeSubjectMode>(["SELF", "HIERARCHY", "ORGANIZATION", "FUNCTIONAL"]);
const DEPTHS = new Set<RoleScopeHierarchyDepth>(["self", "direct", "descendants"]);
const SOURCES = new Set<RoleScopeAssignmentSource>(["SELF", "DESCENDANTS", "ORGANIZATION", "NONE"]);

export function resolveRoleScopePolicy(
  role: string,
  override?: RoleScopePolicyOverride | null,
): CanonicalRoleScopePolicy | null {
  const normalized = normalizeRole(role);
  if (!CANONICAL_USER_ROLES.includes(normalized as Role)) return null;
  const base = CANONICAL_ROLE_SCOPE_POLICIES[normalized as Role];
  if (!override) return { ...base };
  const candidate: CanonicalRoleScopePolicy = { ...base, ...override, role: String(normalized) };
  if (!SUBJECT_MODES.has(candidate.subjectMode)
    || !DEPTHS.has(candidate.hierarchyDepth)
    || !SOURCES.has(candidate.geographySource)
    || !SOURCES.has(candidate.productSource)) return null;
  if (candidate.subjectMode === "FUNCTIONAL" && !candidate.functionalDirectAssignments) return null;
  if ((candidate.subjectMode === "SELF" || candidate.subjectMode === "FUNCTIONAL")
    && candidate.hierarchyDepth !== "self") return null;
  return candidate;
}

export interface RoleAssignmentAdministrationContract {
  canonicalGeography: boolean;
  canonicalProducts: boolean;
  representativePromotionGroups: boolean;
  productScopeRequired: boolean;
}

/**
 * Describes which canonical assignment editors User Management may expose.
 * This is derived from the same operational scope policy used by backend
 * authorization; it grants no action permission by itself.
 */
export function resolveRoleAssignmentAdministrationContract(
  role: string,
  override?: RoleScopePolicyOverride | null,
): RoleAssignmentAdministrationContract {
  const policy = resolveRoleScopePolicy(role, override);
  if (!policy) {
    return {
      canonicalGeography: false,
      canonicalProducts: false,
      representativePromotionGroups: false,
      productScopeRequired: false,
    };
  }
  const normalized = normalizeRole(role);
  const representativePromotionGroups = normalized === Role.MEDICAL_REP || normalized === Role.SALES_REP;
  const directAssignmentSubject = representativePromotionGroups || policy.functionalDirectAssignments;
  return {
    canonicalGeography: directAssignmentSubject && policy.geographySource === "SELF",
    canonicalProducts: directAssignmentSubject && policy.productSource === "SELF",
    representativePromotionGroups,
    productScopeRequired: policy.productScopeRequired,
  };
}

/** True only when both operational assignment sources come from recursive permitted descendants. */
export function isDescendantInheritedScopeRole(role: string, override?: RoleScopePolicyOverride | null): boolean {
  const policy = resolveRoleScopePolicy(role, override);
  return policy?.geographySource === "DESCENDANTS" && policy.productSource === "DESCENDANTS";
}
