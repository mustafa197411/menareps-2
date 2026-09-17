import { Role, type Permissions, type SampleCapability, type SampleDataScope, type User } from "../types";
import { resolveRoleScopePolicy } from "./roleScopePolicy";
import { isCanonicalApplicationRole } from "./canonicalRoleAccessBaseline";
import { restrictSampleCapability } from "./canonicalPermissionApplicability";

const ALL_SAMPLE_CAPABILITIES: readonly SampleCapability[] = [
  "VIEW_SAMPLE_MANAGEMENT", "VIEW_SAMPLE_REPORTS", "CREATE_SAMPLE_SKU", "EDIT_SAMPLE_SKU",
  "DEACTIVATE_SAMPLE_SKU", "VIEW_SAMPLE_INVENTORY", "RECEIVE_SAMPLE_STOCK", "ADJUST_SAMPLE_STOCK",
  "CREATE_SAMPLE_REQUEST", "VIEW_OWN_SAMPLE_REQUESTS", "VIEW_TEAM_SAMPLE_REQUESTS",
  "APPROVE_SAMPLE_REQUEST", "REJECT_SAMPLE_REQUEST", "ALLOCATE_SAMPLE_STOCK",
  "VIEW_OWN_SAMPLE_BALANCE", "VIEW_TEAM_SAMPLE_BALANCE", "DISTRIBUTE_SAMPLE",
  "VIEW_PHYSICIAN_SAMPLE_HISTORY", "EXPORT_SAMPLE_REPORTS"
];

const roleDefaults = (allowed: readonly SampleCapability[]): Record<SampleCapability, boolean> => {
  const set = new Set(allowed);
  return Object.fromEntries(ALL_SAMPLE_CAPABILITIES.map(capability => [capability, set.has(capability)])) as Record<SampleCapability, boolean>;
};

// Distribution remains an authenticated representative action. Administrative
// correction needs a separate audited workflow before it can be authorized.
const ADMIN_CAPABILITIES = roleDefaults(ALL_SAMPLE_CAPABILITIES.filter(capability => capability !== "DISTRIBUTE_SAMPLE"));
const MANAGER_CAPABILITIES = roleDefaults([
  "VIEW_SAMPLE_MANAGEMENT", "VIEW_SAMPLE_REPORTS", "VIEW_SAMPLE_INVENTORY",
  "VIEW_TEAM_SAMPLE_REQUESTS", "APPROVE_SAMPLE_REQUEST", "REJECT_SAMPLE_REQUEST",
  "ALLOCATE_SAMPLE_STOCK", "VIEW_TEAM_SAMPLE_BALANCE", "VIEW_PHYSICIAN_SAMPLE_HISTORY", "EXPORT_SAMPLE_REPORTS"
]);
const REP_CAPABILITIES = roleDefaults([
  "VIEW_SAMPLE_MANAGEMENT", "CREATE_SAMPLE_REQUEST", "VIEW_OWN_SAMPLE_REQUESTS",
  "VIEW_OWN_SAMPLE_BALANCE", "DISTRIBUTE_SAMPLE", "VIEW_PHYSICIAN_SAMPLE_HISTORY",
  "VIEW_SAMPLE_REPORTS", "EXPORT_SAMPLE_REPORTS"
]);
const SAMPLE_MASTER_CAPABILITIES = roleDefaults(["VIEW_SAMPLE_MANAGEMENT", "VIEW_SAMPLE_REPORTS", "VIEW_PHYSICIAN_SAMPLE_HISTORY", "EXPORT_SAMPLE_REPORTS"]);
const INVENTORY_MANAGER_CAPABILITIES = roleDefaults([
  "VIEW_SAMPLE_MANAGEMENT", "VIEW_SAMPLE_REPORTS", "VIEW_SAMPLE_INVENTORY", "RECEIVE_SAMPLE_STOCK",
  "ADJUST_SAMPLE_STOCK", "VIEW_TEAM_SAMPLE_BALANCE",
  "VIEW_PHYSICIAN_SAMPLE_HISTORY", "EXPORT_SAMPLE_REPORTS"
]);
const STORE_CAPABILITIES = roleDefaults([
  "VIEW_SAMPLE_MANAGEMENT", "VIEW_SAMPLE_REPORTS", "VIEW_SAMPLE_INVENTORY",
  "RECEIVE_SAMPLE_STOCK", "ADJUST_SAMPLE_STOCK",
  "VIEW_TEAM_SAMPLE_BALANCE", "EXPORT_SAMPLE_REPORTS"
]);

export function getDefaultSampleCapabilities(role: Role): Record<SampleCapability, boolean> {
  if (!isCanonicalApplicationRole(String(role))) return roleDefaults([]);
  if ([Role.SUPER_ADMIN, Role.ADMIN].includes(role)) return { ...ADMIN_CAPABILITIES };
  if ([Role.GENERAL_MANAGER, Role.REGIONAL_MANAGER, Role.COUNTRY_MANAGER, Role.SALES_MARKETING_MANAGER, Role.SALES_MANAGER, Role.AREA_SALES_MANAGER, Role.SALES_SUPERVISOR, Role.MEDICAL_MANAGER, Role.MEDICAL_SUPERVISOR].includes(role)) return { ...MANAGER_CAPABILITIES };
  if (role === Role.MEDICAL_REP) return { ...REP_CAPABILITIES };
  if (role === Role.PRODUCT_MANAGER) return { ...SAMPLE_MASTER_CAPABILITIES };
  if ([Role.WAREHOUSE_MANAGER, Role.INVENTORY_OFFICER].includes(role)) return { ...INVENTORY_MANAGER_CAPABILITIES };
  if (role === Role.STORE_MANAGER) return { ...STORE_CAPABILITIES };
  if ([Role.ORDER_OPS_OFFICER, Role.FINANCE_MANAGER, Role.FINANCE, Role.TREASURY_OFFICER, Role.DELIVERY_OFFICER].includes(role)) return roleDefaults([]);
  return roleDefaults(["VIEW_SAMPLE_MANAGEMENT"]);
}

export function resolveSampleCapabilities(role: Role, permissions?: Permissions): Record<SampleCapability, boolean> {
  const defaults = getDefaultSampleCapabilities(role);
  return Object.fromEntries(ALL_SAMPLE_CAPABILITIES.map(capability => [
    capability,
    restrictSampleCapability(defaults[capability], capability, permissions),
  ])) as Record<SampleCapability, boolean>;
}

export function hasSampleCapability(user: Pick<User, "role">, capability: SampleCapability, permissions?: Permissions): boolean {
  if (["CREATE_SAMPLE_SKU", "EDIT_SAMPLE_SKU", "DEACTIVATE_SAMPLE_SKU"].includes(capability) && ![Role.SUPER_ADMIN, Role.ADMIN].includes(user.role)) return false;
  if (capability === "ALLOCATE_SAMPLE_STOCK" && ![Role.SUPER_ADMIN, Role.ADMIN, Role.GENERAL_MANAGER, Role.REGIONAL_MANAGER, Role.COUNTRY_MANAGER, Role.SALES_MARKETING_MANAGER, Role.SALES_MANAGER, Role.AREA_SALES_MANAGER, Role.SALES_SUPERVISOR, Role.MEDICAL_MANAGER, Role.MEDICAL_SUPERVISOR].includes(user.role)) return false;
  return resolveSampleCapabilities(user.role, permissions)[capability] === true;
}

const viewCapabilities: Record<string, SampleCapability> = {
  "sample-management": "VIEW_SAMPLE_MANAGEMENT",
  "samples-management": "VIEW_SAMPLE_MANAGEMENT",
  "samples-allocation": "VIEW_TEAM_SAMPLE_BALANCE",
  "samples-approvals": "APPROVE_SAMPLE_REQUEST",
  "samples-physician": "VIEW_PHYSICIAN_SAMPLE_HISTORY",
  "samples-requests": "VIEW_OWN_SAMPLE_REQUESTS",
  "samples-inventory": "VIEW_SAMPLE_INVENTORY",
  "samples-reports": "VIEW_SAMPLE_REPORTS"
};

export function canAccessSampleView(user: Pick<User, "role">, viewId: string, permissions?: Permissions): boolean {
  const capability = viewCapabilities[viewId];
  if (!capability) return hasSampleCapability(user, "VIEW_SAMPLE_MANAGEMENT", permissions);
  if (viewId === "samples-requests") {
    return hasSampleCapability(user, "VIEW_OWN_SAMPLE_REQUESTS", permissions) || hasSampleCapability(user, "VIEW_TEAM_SAMPLE_REQUESTS", permissions);
  }
  if (viewId === "samples-allocation") {
    return hasSampleCapability(user, "VIEW_OWN_SAMPLE_BALANCE", permissions) || hasSampleCapability(user, "VIEW_TEAM_SAMPLE_BALANCE", permissions) || hasSampleCapability(user, "ALLOCATE_SAMPLE_STOCK", permissions);
  }
  return hasSampleCapability(user, capability, permissions);
}

export function getSampleDataScope(user: Pick<User, "role">, capability: SampleCapability, permissions?: Permissions): SampleDataScope {
  if (!hasSampleCapability(user, capability, permissions)) return "NONE";
  if ([Role.SUPER_ADMIN, Role.ADMIN, Role.SYSTEM_ADMINISTRATOR, Role.GENERAL_MANAGER].includes(user.role)) return "ORG";
  if ([Role.WAREHOUSE_MANAGER, Role.INVENTORY_OFFICER, Role.STORE_MANAGER].includes(user.role)) return "ORG";
  if (hasSampleCapability(user, "VIEW_TEAM_SAMPLE_REQUESTS", permissions) || hasSampleCapability(user, "VIEW_TEAM_SAMPLE_BALANCE", permissions)) return "TEAM";
  return "OWN";
}

export function getAuthorizedSampleUserIds(actor: User, allUsers: readonly User[], scope: SampleDataScope): string[] {
  if (scope === "NONE") return [];
  if (scope === "OWN") return [actor.id];
  if (scope === "ORG") return allUsers.filter(user => user.isDeleted !== true).map(user => user.id);
  const authorized = new Set<string>([actor.id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const user of allUsers) {
      const manager = user.managerId
        ? allUsers.find(candidate => candidate.id === user.managerId)
        : undefined;
      if (manager && authorized.has(manager.id) && resolveRoleScopePolicy(manager.role)?.descendantsContribute && !authorized.has(user.id)) {
        authorized.add(user.id);
        changed = true;
      }
    }
  }
  return [...authorized];
}

export function getAuthorizedSampleBalanceUserIds(actor: User, allUsers: readonly User[], scope: SampleDataScope): string[] {
  return getAuthorizedSampleUserIds(actor, allUsers, scope);
}

export function filterSampleAllocationsByAuthorizedRepIds<T extends { repId?: string }>(
  allocations: readonly T[],
  authorizedRepIds: readonly string[],
  scope: SampleDataScope,
): T[] {
  if (scope === "ORG") return [...allocations];
  const authorized = new Set(authorizedRepIds);
  return allocations.filter(allocation => typeof allocation.repId === "string" && authorized.has(allocation.repId));
}

export function canActOnSampleRecord(actor: User, targetRepId: string, allUsers: readonly User[], capability: SampleCapability, permissions?: Permissions): boolean {
  const scope = getSampleDataScope(actor, capability, permissions);
  return getAuthorizedSampleUserIds(actor, allUsers, scope).includes(targetRepId);
}

export function canApproveSampleRequest(actor: User, requesterId: string, allUsers: readonly User[], permissions?: Permissions): boolean {
  return actor.id !== requesterId &&
    hasSampleCapability(actor, "APPROVE_SAMPLE_REQUEST", permissions) &&
    canActOnSampleRecord(actor, requesterId, allUsers, "APPROVE_SAMPLE_REQUEST", permissions);
}

export function canExportSampleReports(user: Pick<User, "role">, permissions?: Permissions): boolean {
  return hasSampleCapability(user, "VIEW_SAMPLE_REPORTS", permissions) && hasSampleCapability(user, "EXPORT_SAMPLE_REPORTS", permissions);
}
