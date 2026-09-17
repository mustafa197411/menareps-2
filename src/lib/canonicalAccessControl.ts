import { normalizeRole, type Permissions, type User } from "../types";
import {
  APPLICATION_MODULES,
  APPLICATION_VIEW_FAMILIES,
  CANONICAL_INDEPENDENT_VIEWS,
  CANONICAL_SHARED_VIEWS,
  CANONICAL_VIEW_ALIASES,
  type ApplicationModuleId,
  type BaselineAccess,
  getCanonicalRoleAccessRecord,
} from "./canonicalRoleAccessBaseline";
import {
  resolveNavigationVisibility,
  type AccessGovernanceRecord,
  type GovernedModule,
} from "./accessGovernance";
import { canAccessSampleView, hasSampleCapability } from "./sampleAuthorization";
import {
  canAccessCommercialOrderQueue,
  canAccessVisitMarketingRequestWorklist,
  hasPermission,
} from "./userPolicyEngine";
import { isNavigationRestricted } from "./navigationRestrictionPolicy";
import { resolveOfferCapabilities } from "../../server/offerAuthorization";

export interface CanonicalAccessContext {
  user: User | null | undefined;
  rolePermissions?: Permissions;
  accessGovernance?: AccessGovernanceRecord | null;
}

export type CanonicalAccessReason =
  | "ALLOWED"
  | "BASELINE_DENY"
  | "CONDITIONAL_DENY"
  | "GOVERNANCE_DENY"
  | "NONCANONICAL_ROLE"
  | "UNKNOWN_MODULE"
  | "UNKNOWN_VIEW"
  | "ROUTE_EXCEPTION_DENY"
  | "DYNAMIC_PERMISSION_DENY";

export interface CanonicalAccessDecision {
  allowed: boolean;
  reason: CanonicalAccessReason;
  module: ApplicationModuleId | null;
  baseline: BaselineAccess | null;
}

export type CanonicalViewRegistration =
  | { kind: "ALIAS"; viewId: string; canonicalViewId: string }
  | { kind: "SHARED"; viewId: string; modules: readonly ApplicationModuleId[] }
  | { kind: "INDEPENDENT"; viewId: string; module: ApplicationModuleId }
  | { kind: "MODULE"; viewId: string; module: ApplicationModuleId }
  | { kind: "UNKNOWN"; viewId: string };

const GOVERNED_MODULES: Partial<Record<ApplicationModuleId, GovernedModule>> = {
  "field-operations": "FIELD_OPERATIONS",
  pharmacies: "PHARMACIES",
  supervision: "TEAM_ACTIVITY",
  analytics: "ANALYTICS",
  administration: "ADMINISTRATION",
  "sales-and-orders": "ORDERS",
};

function denied(reason: CanonicalAccessReason, module: ApplicationModuleId | null, baseline: BaselineAccess | null): CanonicalAccessDecision {
  return { allowed: false, reason, module, baseline };
}

function allowed(module: ApplicationModuleId, baseline: BaselineAccess): CanonicalAccessDecision {
  return { allowed: true, reason: "ALLOWED", module, baseline };
}

export function resolveApplicationModule(viewId: string): ApplicationModuleId | null {
  if ((APPLICATION_MODULES as readonly string[]).includes(viewId)) return viewId as ApplicationModuleId;
  const matches = APPLICATION_MODULES.flatMap(module => {
    const family = APPLICATION_VIEW_FAMILIES[module];
    if (family.exact.includes(viewId)) return [{ module, length: Number.MAX_SAFE_INTEGER }];
    return family.prefixes.filter(prefix => viewId.startsWith(prefix)).map(prefix => ({ module, length: prefix.length }));
  }).sort((left, right) => right.length - left.length);
  return matches[0]?.module || null;
}

export function getCanonicalViewRegistration(viewId: string): CanonicalViewRegistration {
  const alias = CANONICAL_VIEW_ALIASES[viewId as keyof typeof CANONICAL_VIEW_ALIASES];
  if (alias) return { kind: "ALIAS", viewId, canonicalViewId: alias };
  const shared = CANONICAL_SHARED_VIEWS[viewId as keyof typeof CANONICAL_SHARED_VIEWS];
  if (shared) return { kind: "SHARED", viewId, modules: shared };
  const independent = CANONICAL_INDEPENDENT_VIEWS[viewId as keyof typeof CANONICAL_INDEPENDENT_VIEWS];
  if (independent) return { kind: "INDEPENDENT", viewId, module: independent };
  const module = resolveApplicationModule(viewId);
  return module ? { kind: "MODULE", viewId, module } : { kind: "UNKNOWN", viewId };
}

function routeException(viewId: string, exceptions: Readonly<Record<string, BaselineAccess>>): BaselineAccess | null {
  if (exceptions[viewId]) return exceptions[viewId];
  const wildcard = Object.entries(exceptions)
    .filter(([pattern]) => pattern.endsWith("*") && viewId.startsWith(pattern.slice(0, -1)))
    .sort(([left], [right]) => right.length - left.length)[0];
  return wildcard?.[1] || null;
}

function governanceAllows(context: CanonicalAccessContext, module: ApplicationModuleId): boolean {
  const governed = GOVERNED_MODULES[module];
  if (!governed) return true;
  // Preserve the recovered Field/Pharmacy defaults when no persisted record is
  // hydrated. Other modules are restricted only by an explicit active record.
  if (!context.accessGovernance && module !== "field-operations" && module !== "pharmacies") return true;
  if (context.accessGovernance) {
    if (context.accessGovernance.active !== true || normalizeRole(context.accessGovernance.role) !== normalizeRole(context.user?.role)) return true;
    const explicit = context.accessGovernance.navigation.find(item => item.module === governed);
    if (!explicit && module !== "field-operations" && module !== "pharmacies") return true;
  }
  return resolveNavigationVisibility(String(context.user?.role || ""), governed, context.accessGovernance);
}

function conditionalModuleAllows(context: CanonicalAccessContext, module: ApplicationModuleId, viewId?: string): boolean {
  const user = context.user;
  if (!user) return false;
  if (module === "samples") {
    if (viewId) return canAccessSampleView(user, viewId, context.rolePermissions);
    return hasSampleCapability(user, "VIEW_SAMPLE_MANAGEMENT", context.rolePermissions)
      || hasSampleCapability(user, "VIEW_SAMPLE_REPORTS", context.rolePermissions);
  }
  if (module === "sales-and-orders") {
    if (viewId === "sales-offers") return resolveOfferCapabilities(user.role, context.rolePermissions)["offers.view"];
    if (viewId && viewId !== "sales-orders") return false;
    return canAccessCommercialOrderQueue(user, context.rolePermissions);
  }
  if (module === "marketing") {
    if (viewId && viewId !== "marketing-my-requests") return false;
    return canAccessVisitMarketingRequestWorklist(user, context.rolePermissions);
  }
  return context.rolePermissions?.view === true;
}

function dynamicRestriction(context: CanonicalAccessContext, module: ApplicationModuleId, viewId?: string): boolean {
  if (viewId === "sales-offers") return resolveOfferCapabilities(context.user?.role, context.rolePermissions)["offers.view"];
  if (module === "productivity" && context.rolePermissions?.view === false) return false;
  if (viewId === "admin-order-workflow-settings") {
    return hasPermission(context.user, "Administration", "view", context.rolePermissions);
  }
  return true;
}

function evaluate(context: CanonicalAccessContext, module: ApplicationModuleId, viewId?: string): CanonicalAccessDecision {
  const record = getCanonicalRoleAccessRecord(context.user?.role);
  if (!record) return denied("NONCANONICAL_ROLE", module, null);
  const exception = viewId ? routeException(viewId, record.routeExceptions) : null;
  if (exception === "DENY") return denied("ROUTE_EXCEPTION_DENY", module, record.modules[module]);
  const baseline = exception || record.modules[module];
  if (baseline === "DENY") return denied("BASELINE_DENY", module, baseline);
  if (!governanceAllows(context, module)) return denied("GOVERNANCE_DENY", module, baseline);
  if (baseline === "CONDITIONAL" && !conditionalModuleAllows(context, module, viewId)) {
    return denied("CONDITIONAL_DENY", module, baseline);
  }
  if (!dynamicRestriction(context, module, viewId)) return denied("DYNAMIC_PERMISSION_DENY", module, baseline);
  // AP2R navigationRestrictions are restriction-only and remain effective
  // independently of the legacy record-wide `active` flag. Activating that
  // flag here could unintentionally activate unrelated capabilities/scope.
  if (context.accessGovernance
    && normalizeRole(context.accessGovernance.role) === normalizeRole(context.user?.role)
    && isNavigationRestricted(context.accessGovernance.navigationRestrictions, module, viewId)) {
    return denied("GOVERNANCE_DENY", module, baseline);
  }
  return allowed(module, baseline);
}

export function evaluateModuleAccess(context: CanonicalAccessContext, moduleId: string): CanonicalAccessDecision {
  if (!(APPLICATION_MODULES as readonly string[]).includes(moduleId)) return denied("UNKNOWN_MODULE", null, null);
  return evaluate(context, moduleId as ApplicationModuleId);
}

export function evaluateViewAccess(context: CanonicalAccessContext, viewId: string): CanonicalAccessDecision {
  const registration = getCanonicalViewRegistration(viewId);
  if (registration.kind === "UNKNOWN") return denied("UNKNOWN_VIEW", null, null);
  if (registration.kind === "ALIAS") return evaluateViewAccess(context, registration.canonicalViewId);
  if (registration.kind === "SHARED") {
    const decisions = registration.modules.map(module => evaluate(context, module, viewId));
    return decisions.find(decision => decision.allowed) || decisions[0] || denied("UNKNOWN_VIEW", null, null);
  }
  return evaluate(context, registration.module, viewId);
}

export function canAccessCanonicalModule(context: CanonicalAccessContext, moduleId: string): boolean {
  return evaluateModuleAccess(context, moduleId).allowed;
}

export function canAccessCanonicalView(context: CanonicalAccessContext, viewId: string): boolean {
  return evaluateViewAccess(context, viewId).allowed;
}

export function resolveAuthorizedRestoredView(
  context: CanonicalAccessContext,
  requestedView: string,
  fallbackViews: readonly string[],
): string | null {
  if (canAccessCanonicalView(context, requestedView)) return requestedView;
  return fallbackViews.find(view => canAccessCanonicalView(context, view)) || null;
}

/** Navigation decisions are deliberately unusable as record-level proof. */
export function navigationDecisionDoesNotAuthorizeData(_decision: CanonicalAccessDecision): false {
  return false;
}
