import { CANONICAL_USER_ROLES, Role, normalizeRole } from "../types";

/**
 * AP2N role-access characterization baseline.
 *
 * This registry describes module and route availability only. It must never be
 * used to infer record visibility: operationalScope remains authoritative for
 * subjects, geography, products, promotion groups, and reporting hierarchy.
 * Dynamic rolePermissions and accessGovernance overlays remain outside this
 * static baseline until AP2O.
 */
export const APPLICATION_MODULES = [
  "dashboard", "field-operations", "pharmacies", "products", "master-data",
  "samples", "marketing", "sales-and-orders", "territory-team", "supervision",
  "finance", "productivity", "targets", "inventory", "operations", "analytics",
  "administration", "account",
] as const;

export type ApplicationModuleId = typeof APPLICATION_MODULES[number];
export type CanonicalApplicationRole = Exclude<
  Role,
  Role.WAREHOUSE_INVENTORY | Role.MARKETING | Role.SYSTEM_ADMINISTRATOR
>;
export type BaselineAccess = "ALLOW" | "DENY" | "CONDITIONAL";

export interface ApplicationViewFamily {
  module: ApplicationModuleId;
  exact: readonly string[];
  prefixes: readonly string[];
}

/** Declarative ownership of the route identifiers currently recognized by canAccessView. */
export const APPLICATION_VIEW_FAMILIES: Readonly<Record<ApplicationModuleId, ApplicationViewFamily>> = Object.freeze({
  dashboard: { module: "dashboard", exact: ["dashboard"], prefixes: [] },
  "field-operations": { module: "field-operations", exact: [], prefixes: ["field-", "physician-"] },
  pharmacies: { module: "pharmacies", exact: [], prefixes: ["pharmacies-"] },
  products: { module: "products", exact: [], prefixes: ["products-"] },
  "master-data": { module: "master-data", exact: ["master", "master-data"], prefixes: ["master-"] },
  samples: { module: "samples", exact: ["sample-management"], prefixes: ["samples-", "sample-management-"] },
  marketing: { module: "marketing", exact: [], prefixes: ["marketing-"] },
  "sales-and-orders": { module: "sales-and-orders", exact: ["payment-collection"], prefixes: ["sales-", "order-"] },
  "territory-team": { module: "territory-team", exact: [], prefixes: ["territory-"] },
  supervision: { module: "supervision", exact: [], prefixes: ["supervision-"] },
  finance: { module: "finance", exact: [], prefixes: ["finance-"] },
  productivity: { module: "productivity", exact: [], prefixes: ["productivity-"] },
  targets: { module: "targets", exact: [], prefixes: ["targets-"] },
  inventory: { module: "inventory", exact: [], prefixes: ["inventory-"] },
  operations: { module: "operations", exact: [], prefixes: ["operations-"] },
  analytics: { module: "analytics", exact: [], prefixes: ["analytics-"] },
  administration: { module: "administration", exact: [], prefixes: ["admin-"] },
  account: { module: "account", exact: ["account-logout"], prefixes: ["account-"] },
});

/** True compatibility aliases must inherit the canonical destination decision. */
export const CANONICAL_VIEW_ALIASES = Object.freeze({
  physicians: "field-physician-list",
  "payment-collections": "payment-collection",
  visits: "visits-review",
  "field-visits-review": "visits-review",
} as const);

/** Routes intentionally rendered outside Sidebar metadata but governed by one module. */
export const CANONICAL_INDEPENDENT_VIEWS = Object.freeze({
  admin: "administration",
  audit: "administration",
} as const satisfies Readonly<Record<string, ApplicationModuleId>>);

/** A shared route is allowed when at least one explicitly listed module path is allowed. */
export const CANONICAL_SHARED_VIEWS = Object.freeze({
  "visits-review": ["field-operations", "pharmacies"],
} as const satisfies Readonly<Record<string, readonly ApplicationModuleId[]>>);

export interface CanonicalRoleAccessRecord {
  role: CanonicalApplicationRole;
  modules: Readonly<Record<ApplicationModuleId, BaselineAccess>>;
  /** Exact current route exceptions that cannot safely be represented by a module grant. */
  routeExceptions: Readonly<Record<string, BaselineAccess>>;
  administrativeGlobalAccess: boolean;
}

const ALL = new Set<ApplicationModuleId>(APPLICATION_MODULES);
const PUBLIC = new Set<ApplicationModuleId>(["dashboard", "productivity", "account"]);
const MEDICAL = new Set<ApplicationModuleId>([
  ...PUBLIC, "field-operations", "products", "samples", "marketing", "territory-team",
  "supervision", "analytics", "master-data",
]);
const SALES = new Set<ApplicationModuleId>([
  ...PUBLIC, "pharmacies", "products", "sales-and-orders", "territory-team",
  "supervision", "analytics", "master-data",
]);
const FINANCE_OPERATIONS = new Set<ApplicationModuleId>(["dashboard", "finance", "operations", "account"]);
const PRODUCT = new Set<ApplicationModuleId>(["dashboard", "products", "master-data", "account"]);
const WAREHOUSE = new Set<ApplicationModuleId>(["dashboard", "inventory", "operations", "account"]);
const DELIVERY = new Set<ApplicationModuleId>(["dashboard", "operations", "account"]);

function modules(allowed: ReadonlySet<ApplicationModuleId>, conditional: readonly ApplicationModuleId[] = []): Readonly<Record<ApplicationModuleId, BaselineAccess>> {
  const conditionalSet = new Set(conditional);
  return Object.freeze(Object.fromEntries(APPLICATION_MODULES.map(module => [
    module,
    conditionalSet.has(module) ? "CONDITIONAL" : allowed.has(module) ? "ALLOW" : "DENY",
  ])) as Record<ApplicationModuleId, BaselineAccess>);
}

function record(
  role: CanonicalApplicationRole,
  allowed: ReadonlySet<ApplicationModuleId>,
  options: { conditional?: readonly ApplicationModuleId[]; routeExceptions?: Readonly<Record<string, BaselineAccess>>; administrativeGlobalAccess?: boolean } = {},
): CanonicalRoleAccessRecord {
  return Object.freeze({
    role,
    modules: modules(allowed, options.conditional),
    routeExceptions: Object.freeze({ ...(options.routeExceptions || {}) }),
    administrativeGlobalAccess: options.administrativeGlobalAccess === true,
  });
}

const admin = (role: CanonicalApplicationRole) => record(role, ALL, {
  conditional: ["samples"],
  administrativeGlobalAccess: true,
});
const managerAdminExceptions = Object.freeze({
  "admin-user-management": "ALLOW",
  "admin-template-catalog": "ALLOW",
  "admin-*": "DENY",
} as const);
const representativeSupervisionExceptions = Object.freeze({
  "supervision-planning": "DENY",
  "supervision-field-visits": "DENY",
  "supervision-visits": "DENY",
} as const);

/**
 * Every CANONICAL_USER_ROLES member has one explicit entry. The group-level
 * values characterize canAccessGroup as recovered on 2026-08-26. CONDITIONAL
 * means dynamic rolePermissions or a specialized capability policy can deny or
 * allow the module and AP2N makes no independent authorization decision.
 */
export const CANONICAL_ROLE_ACCESS_BASELINE: Readonly<Record<CanonicalApplicationRole, CanonicalRoleAccessRecord>> = Object.freeze({
  [Role.SUPER_ADMIN]: admin(Role.SUPER_ADMIN),
  [Role.ADMIN]: admin(Role.ADMIN),
  [Role.GENERAL_MANAGER]: record(Role.GENERAL_MANAGER, ALL, { conditional: ["samples"], routeExceptions: managerAdminExceptions }),
  [Role.REGIONAL_MANAGER]: record(Role.REGIONAL_MANAGER, SALES, { conditional: ["samples", "sales-and-orders"] }),
  [Role.COUNTRY_MANAGER]: record(Role.COUNTRY_MANAGER, SALES, { conditional: ["samples", "sales-and-orders"] }),
  [Role.SALES_MARKETING_MANAGER]: record(Role.SALES_MARKETING_MANAGER, SALES, { conditional: ["samples", "sales-and-orders"], routeExceptions: managerAdminExceptions }),
  [Role.SALES_MANAGER]: record(Role.SALES_MANAGER, SALES, { conditional: ["samples", "sales-and-orders"] }),
  [Role.AREA_SALES_MANAGER]: record(Role.AREA_SALES_MANAGER, SALES, { conditional: ["samples", "sales-and-orders"] }),
  [Role.SALES_SUPERVISOR]: record(Role.SALES_SUPERVISOR, SALES, { conditional: ["samples", "sales-and-orders"] }),
  [Role.SALES_REP]: record(Role.SALES_REP, SALES, { conditional: ["sales-and-orders"], routeExceptions: representativeSupervisionExceptions }),
  [Role.MARKETING_MANAGER]: record(Role.MARKETING_MANAGER, ALL, { conditional: ["samples", "sales-and-orders"] }),
  [Role.PRODUCT_MANAGER]: record(Role.PRODUCT_MANAGER, PRODUCT),
  [Role.MARKETING_OFFICER]: record(Role.MARKETING_OFFICER, ALL, { conditional: ["samples", "sales-and-orders"] }),
  [Role.MEDICAL_MANAGER]: record(Role.MEDICAL_MANAGER, MEDICAL, { conditional: ["samples", "marketing"] }),
  [Role.MEDICAL_SUPERVISOR]: record(Role.MEDICAL_SUPERVISOR, MEDICAL, { conditional: ["samples", "marketing"], routeExceptions: { "pharmacies-list": "ALLOW" } }),
  [Role.MEDICAL_REP]: record(Role.MEDICAL_REP, MEDICAL, { conditional: ["samples", "marketing"], routeExceptions: representativeSupervisionExceptions }),
  [Role.FINANCE_MANAGER]: record(Role.FINANCE_MANAGER, ALL, { conditional: ["samples", "sales-and-orders"] }),
  [Role.FINANCE]: record(Role.FINANCE, FINANCE_OPERATIONS),
  [Role.TREASURY_OFFICER]: record(Role.TREASURY_OFFICER, FINANCE_OPERATIONS),
  [Role.WAREHOUSE_MANAGER]: record(Role.WAREHOUSE_MANAGER, WAREHOUSE),
  [Role.INVENTORY_OFFICER]: record(Role.INVENTORY_OFFICER, ALL, { conditional: ["samples", "sales-and-orders"] }),
  [Role.STORE_MANAGER]: record(Role.STORE_MANAGER, WAREHOUSE),
  [Role.DELIVERY_OFFICER]: record(Role.DELIVERY_OFFICER, DELIVERY),
  [Role.ORDER_OPS_OFFICER]: record(Role.ORDER_OPS_OFFICER, DELIVERY),
});

/** Enum values excluded from CANONICAL_USER_ROLES in the recovered baseline. */
export const LEGACY_OR_NONCANONICAL_ROLES = Object.freeze(
  Object.values(Role).filter(role => !CANONICAL_USER_ROLES.includes(role)),
);

export function isCanonicalApplicationRole(role: string | null | undefined): role is CanonicalApplicationRole {
  const normalized = normalizeRole(role);
  return CANONICAL_USER_ROLES.includes(normalized as Role);
}

export function getCanonicalRoleAccessRecord(role: string | null | undefined): CanonicalRoleAccessRecord | null {
  const normalized = normalizeRole(role);
  return isCanonicalApplicationRole(String(normalized))
    ? CANONICAL_ROLE_ACCESS_BASELINE[normalized as CanonicalApplicationRole]
    : null;
}
