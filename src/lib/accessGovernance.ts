import { Role, normalizeRole, type User } from "../types";
import type { EffectiveOperationalScope } from "../../server/operationalScopeService";
import { resolveRoleScopePolicy, type RoleScopePolicyOverride } from "./roleScopePolicy";
import type { NavigationRestrictions } from "./navigationRestrictionPolicy";

export type DataScopeMode = "SELF" | "DIRECT_REPORTS" | "DESCENDANTS" | "GEOGRAPHY" | "PRODUCT_GEOGRAPHY" | "ORGANIZATION" | "CUSTOM";
export type GovernedModule = "FIELD_OPERATIONS" | "PHARMACIES" | "PHYSICIANS" | "VISITS" | "TEAM_ACTIVITY" | "REPORTS" | "ANALYTICS" | "ADMINISTRATION" | "ORDERS";
export type ModuleAction = "view" | "create" | "edit" | "delete" | "export" | "approve" | "reject" | "return" | "assign" | "reassign";
export interface NavigationGrant { module: GovernedModule; visible: boolean }
export interface CapabilityGrant { module: GovernedModule; actions: Partial<Record<ModuleAction, boolean>> }
export interface AccessGovernanceRecord { role: string; navigation: NavigationGrant[]; navigationRestrictions?: NavigationRestrictions; capabilities: CapabilityGrant[]; dataScopeMode: DataScopeMode; scopePolicy?: RoleScopePolicyOverride; active: boolean }

const FIELD_NAV = new Set<string>([Role.GENERAL_MANAGER, Role.REGIONAL_MANAGER, Role.COUNTRY_MANAGER, Role.SALES_MARKETING_MANAGER, Role.MARKETING_MANAGER, Role.PRODUCT_MANAGER, Role.MEDICAL_MANAGER, Role.MEDICAL_SUPERVISOR, Role.MEDICAL_REP]);
const PHARMACY_NAV = new Set<string>([Role.GENERAL_MANAGER, Role.REGIONAL_MANAGER, Role.COUNTRY_MANAGER, Role.SALES_MARKETING_MANAGER, Role.MARKETING_MANAGER, Role.PRODUCT_MANAGER, Role.MEDICAL_SUPERVISOR, Role.SALES_SUPERVISOR, Role.SALES_REP]);

export function defaultScopeModeForRole(role: string): DataScopeMode {
  const policy = resolveRoleScopePolicy(role);
  if (!policy) return "CUSTOM";
  if (policy.subjectMode === "ORGANIZATION") return "ORGANIZATION";
  if (policy.subjectMode === "FUNCTIONAL") return "PRODUCT_GEOGRAPHY";
  if (policy.subjectMode === "SELF") return "SELF";
  return policy.productSource === "DESCENDANTS" && policy.geographySource === "DESCENDANTS"
    ? "DESCENDANTS"
    : "GEOGRAPHY";
}

export function defaultNavigationVisible(role: string, module: GovernedModule): boolean {
  const normalized = normalizeRole(role);
  if (resolveRoleScopePolicy(String(normalized))?.subjectMode === "ORGANIZATION") return true;
  if (module === "FIELD_OPERATIONS") return FIELD_NAV.has(normalized);
  if (module === "PHARMACIES") return PHARMACY_NAV.has(normalized);
  return false;
}

export function resolveNavigationVisibility(role: string, module: GovernedModule, record?: AccessGovernanceRecord | null): boolean {
  const normalized = normalizeRole(role);
  if (record?.active && normalizeRole(record.role) === normalized) {
    const explicit = record.navigation.find(item => item.module === module);
    if (explicit) return explicit.visible;
  }
  return defaultNavigationVisible(normalized, module);
}

export function hasGovernedCapability(user: User | null | undefined, module: GovernedModule, action: ModuleAction, record?: AccessGovernanceRecord | null): boolean {
  if (!user) return false;
  const normalized = normalizeRole(user.role);
  if (record?.active && normalizeRole(record.role) === normalized) return record.capabilities.find(item => item.module === module)?.actions[action] === true;
  return false;
}

export function scopeDescriptorFromOperationalScope(scope: EffectiveOperationalScope): { mode: DataScopeMode; subjectUids: string[]; areaIds: string[]; productIds: string[]; authorized: boolean } {
  const roleMode = scope.role ? defaultScopeModeForRole(scope.role) : "CUSTOM";
  return { mode: scope.subjectMode === "SELF" ? "SELF" : roleMode, subjectUids: [...scope.subjectUids], areaIds: [...scope.areaIds], productIds: [...scope.productIds], authorized: scope.authorized && !scope.queryPlan.denyAll };
}

export function navigationDoesNotAuthorizeData(_visible: boolean, scope: ReturnType<typeof scopeDescriptorFromOperationalScope>): boolean {
  return scope.authorized;
}
