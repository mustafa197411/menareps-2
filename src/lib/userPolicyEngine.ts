import { Role, User, Permissions } from "../types";
import { canAccessSampleView, hasSampleCapability } from "./sampleAuthorization";

// 1. Roles & Hierarchy Level Mapping
export function getHierarchyLevel(role: Role): number {
  switch (role) {
    case Role.SUPER_ADMIN:
      return 100;
    case Role.SYSTEM_ADMINISTRATOR:
      return 95;
    case Role.ADMIN:
      return 90;
    case Role.GENERAL_MANAGER:
      return 80;
    case Role.SALES_MARKETING_MANAGER:
      return 75;
    case Role.MARKETING_MANAGER:
    case Role.MEDICAL_MANAGER:
    case Role.SALES_MANAGER:
    case Role.FINANCE_MANAGER:
      return 70;
    case Role.MEDICAL_SUPERVISOR:
    case Role.SALES_SUPERVISOR:
    case Role.AREA_SALES_MANAGER:
    case Role.REGIONAL_MANAGER:
    case Role.COUNTRY_MANAGER:
      return 50;
    case Role.FINANCE:
    case Role.TREASURY_OFFICER:
    case Role.PRODUCT_MANAGER:
    case Role.STORE_MANAGER:
    case Role.WAREHOUSE_MANAGER:
      return 30;
    case Role.WAREHOUSE_INVENTORY:
    case Role.INVENTORY_OFFICER:
    case Role.ORDER_OPS_OFFICER:
      return 20;
    case Role.MEDICAL_REP:
    case Role.SALES_REP:
    case Role.DELIVERY_OFFICER:
    case Role.MARKETING:
    case Role.MARKETING_OFFICER:
      return 10;
    default:
      return 0;
  }
}

// 2. Department Mapping
export type Department = "MEDICAL" | "SALES" | "FINANCE" | "PRODUCT_MARKETING" | "INVENTORY_STORE" | "ADMIN" | "GENERAL_MANAGEMENT";

export function getDepartment(role: Role): Department {
  switch (role) {
    case Role.SUPER_ADMIN:
    case Role.ADMIN:
    case Role.SYSTEM_ADMINISTRATOR:
      return "ADMIN";
    case Role.GENERAL_MANAGER:
      return "GENERAL_MANAGEMENT";
    case Role.MEDICAL_MANAGER:
    case Role.MEDICAL_SUPERVISOR:
    case Role.MEDICAL_REP:
      return "MEDICAL";
    case Role.SALES_MARKETING_MANAGER:
    case Role.SALES_MANAGER:
    case Role.SALES_SUPERVISOR:
    case Role.SALES_REP:
    case Role.AREA_SALES_MANAGER:
    case Role.REGIONAL_MANAGER:
    case Role.COUNTRY_MANAGER:
      return "SALES";
    case Role.FINANCE:
    case Role.FINANCE_MANAGER:
    case Role.TREASURY_OFFICER:
      return "FINANCE";
    case Role.PRODUCT_MANAGER:
    case Role.MARKETING_MANAGER:
    case Role.MARKETING:
    case Role.MARKETING_OFFICER:
      return "PRODUCT_MARKETING";
    case Role.STORE_MANAGER:
    case Role.WAREHOUSE_MANAGER:
    case Role.WAREHOUSE_INVENTORY:
    case Role.INVENTORY_OFFICER:
    case Role.DELIVERY_OFFICER:
      return "INVENTORY_STORE";
    default:
      return "SALES"; // Default fallback
  }
}

// 3. Manager Resolution Helper
export function findManager(user: Partial<User>, allUsers: User[]): User | undefined {
  if (user.managerId) {
    const mgr = allUsers.find((u) => u.id === user.managerId || u.uid === user.managerId);
    if (mgr) return mgr;
  }
  return undefined;
}

// 4. Manager Validation Rules
export const allowedManagerRolesByUserRole: Record<Role, Role[]> = {
  [Role.SUPER_ADMIN]: [],
  [Role.ADMIN]: [Role.SUPER_ADMIN],
  [Role.GENERAL_MANAGER]: [Role.ADMIN],
  [Role.REGIONAL_MANAGER]: [Role.GENERAL_MANAGER],
  [Role.COUNTRY_MANAGER]: [Role.REGIONAL_MANAGER, Role.GENERAL_MANAGER],
  [Role.SALES_MARKETING_MANAGER]: [Role.COUNTRY_MANAGER, Role.REGIONAL_MANAGER, Role.GENERAL_MANAGER],
  [Role.SALES_MANAGER]: [Role.SALES_MARKETING_MANAGER, Role.COUNTRY_MANAGER, Role.REGIONAL_MANAGER, Role.GENERAL_MANAGER],
  [Role.AREA_SALES_MANAGER]: [Role.SALES_MANAGER, Role.SALES_MARKETING_MANAGER, Role.COUNTRY_MANAGER, Role.REGIONAL_MANAGER, Role.GENERAL_MANAGER],
  [Role.SALES_SUPERVISOR]: [Role.AREA_SALES_MANAGER, Role.SALES_MANAGER, Role.SALES_MARKETING_MANAGER, Role.COUNTRY_MANAGER, Role.REGIONAL_MANAGER, Role.GENERAL_MANAGER],
  [Role.SALES_REP]: [Role.SALES_SUPERVISOR, Role.AREA_SALES_MANAGER, Role.SALES_MANAGER, Role.SALES_MARKETING_MANAGER, Role.COUNTRY_MANAGER, Role.REGIONAL_MANAGER, Role.GENERAL_MANAGER, Role.ADMIN],
  [Role.MARKETING_MANAGER]: [Role.SALES_MARKETING_MANAGER, Role.COUNTRY_MANAGER, Role.REGIONAL_MANAGER, Role.GENERAL_MANAGER],
  [Role.PRODUCT_MANAGER]: [Role.MEDICAL_MANAGER, Role.MARKETING_MANAGER, Role.SALES_MARKETING_MANAGER, Role.COUNTRY_MANAGER, Role.REGIONAL_MANAGER, Role.GENERAL_MANAGER],
  [Role.MARKETING_OFFICER]: [Role.PRODUCT_MANAGER, Role.MARKETING_MANAGER, Role.SALES_MARKETING_MANAGER, Role.COUNTRY_MANAGER, Role.REGIONAL_MANAGER, Role.GENERAL_MANAGER],
  [Role.MEDICAL_MANAGER]: [Role.MARKETING_MANAGER, Role.SALES_MARKETING_MANAGER, Role.COUNTRY_MANAGER, Role.REGIONAL_MANAGER, Role.GENERAL_MANAGER],
  [Role.MEDICAL_SUPERVISOR]: [Role.MEDICAL_MANAGER, Role.MARKETING_MANAGER, Role.SALES_MARKETING_MANAGER, Role.COUNTRY_MANAGER, Role.REGIONAL_MANAGER, Role.GENERAL_MANAGER],
  [Role.MEDICAL_REP]: [Role.MEDICAL_SUPERVISOR, Role.MEDICAL_MANAGER, Role.MARKETING_MANAGER, Role.SALES_MARKETING_MANAGER, Role.COUNTRY_MANAGER, Role.REGIONAL_MANAGER, Role.GENERAL_MANAGER, Role.ADMIN],
  [Role.FINANCE_MANAGER]: [Role.GENERAL_MANAGER],
  [Role.FINANCE]: [Role.FINANCE_MANAGER, Role.GENERAL_MANAGER],
  [Role.TREASURY_OFFICER]: [Role.FINANCE_MANAGER, Role.GENERAL_MANAGER],
  [Role.WAREHOUSE_MANAGER]: [Role.COUNTRY_MANAGER, Role.REGIONAL_MANAGER, Role.GENERAL_MANAGER],
  [Role.INVENTORY_OFFICER]: [Role.WAREHOUSE_MANAGER, Role.FINANCE_MANAGER, Role.GENERAL_MANAGER],
  [Role.STORE_MANAGER]: [Role.WAREHOUSE_MANAGER, Role.FINANCE_MANAGER, Role.GENERAL_MANAGER],
  [Role.DELIVERY_OFFICER]: [Role.FINANCE, Role.STORE_MANAGER, Role.WAREHOUSE_MANAGER, Role.GENERAL_MANAGER],
  [Role.ORDER_OPS_OFFICER]: [Role.FINANCE_MANAGER, Role.WAREHOUSE_MANAGER, Role.STORE_MANAGER, Role.COUNTRY_MANAGER, Role.REGIONAL_MANAGER, Role.GENERAL_MANAGER],
  [Role.SYSTEM_ADMINISTRATOR]: [Role.SUPER_ADMIN],
  [Role.WAREHOUSE_INVENTORY]: [Role.WAREHOUSE_MANAGER, Role.FINANCE_MANAGER, Role.GENERAL_MANAGER],
  [Role.MARKETING]: [Role.MARKETING_MANAGER, Role.SALES_MARKETING_MANAGER]
};

export function getValidManagerRoles(targetRole: Role): Role[] {
  return allowedManagerRolesByUserRole[targetRole] || [Role.GENERAL_MANAGER, Role.ADMIN, Role.SUPER_ADMIN];
}

export function validateManager(targetUser: Partial<User>, allUsers: User[]): { isValid: boolean; reason?: string } {
  if (targetUser.role === Role.SUPER_ADMIN) {
    return { isValid: true };
  }

  const allowedRoles = getValidManagerRoles(targetUser.role as Role);
  const mgr = findManager(targetUser, allUsers);

  if (!mgr) {
    if (targetUser.managerId) {
      return { isValid: false, reason: `Canonical manager UID '${targetUser.managerId}' was not found in the users database.` };
    }
    // If no manager is provided, but some senior roles allow having no manager (like Admin reporting to Super Admin is optional, or maybe it is required).
    // Let's allow it if allowedRoles is empty, or if we have general fallback.
    if (allowedRoles.length === 0) return { isValid: true };
    return { isValid: false, reason: "A valid manager is required for this role." };
  }

  // Self reporting check
  if (mgr.id === targetUser.id) {
    return { isValid: false, reason: "A user cannot report to themselves." };
  }

  // Circular reporting checks:
  const visited = new Set<string>();
  if (targetUser.id) visited.add(targetUser.id);

  let current: User | undefined = mgr;
  while (current) {
    if (visited.has(current.id)) {
      return { isValid: false, reason: `Circular reporting relationship detected. Subordinate '${targetUser.name || targetUser.email}' cannot be the manager of manager '${mgr.name}'.` };
    }
    if (current.id) visited.add(current.id);

    current = findManager(current, allUsers);
  }

  if (!allowedRoles.includes(mgr.role)) {
    return {
      isValid: false,
      reason: `Invalid manager role. A ${targetUser.role} may report only to one of: ${allowedRoles.join(", ")} (Current manager '${mgr.name}' is a ${mgr.role}).`,
    };
  }

  // If manager is not active, reject
  if (mgr.active === false || String(mgr.active).toLowerCase() === "false") {
    return { isValid: false, reason: `Manager account '${mgr.name}' is inactive. Only active managers can be assigned.` };
  }

  return { isValid: true };
}

// 5. Role Creation Authority
export function canCreateRole(actorRole: Role, targetRole: Role): boolean {
  if (actorRole === Role.SUPER_ADMIN) {
    return true;
  }
  if (actorRole === Role.SYSTEM_ADMINISTRATOR) {
    return targetRole !== Role.SUPER_ADMIN;
  }
  if (actorRole === Role.ADMIN) {
    return targetRole !== Role.SUPER_ADMIN && targetRole !== Role.SYSTEM_ADMINISTRATOR;
  }
  if (actorRole === Role.GENERAL_MANAGER) {
    // Can create managers & operational roles
    const allowed = [
      Role.MEDICAL_MANAGER,
      Role.SALES_MANAGER,
      Role.FINANCE,
      Role.TREASURY_OFFICER,
      Role.PRODUCT_MANAGER,
      Role.STORE_MANAGER,
      Role.WAREHOUSE_MANAGER,
      Role.WAREHOUSE_INVENTORY,
      Role.DELIVERY_OFFICER,
      Role.ORDER_OPS_OFFICER,
    ];
    return allowed.includes(targetRole);
  }
  if (actorRole === Role.MEDICAL_MANAGER) {
    return [Role.MEDICAL_SUPERVISOR, Role.MEDICAL_REP].includes(targetRole);
  }
  if (actorRole === Role.SALES_MANAGER) {
    return [Role.SALES_SUPERVISOR, Role.SALES_REP].includes(targetRole);
  }
  return false;
}

export function canEditRole(actorRole: Role, targetRole: Role): boolean {
  return canCreateRole(actorRole, targetRole);
}

// 6. Required Assignments & Readiness Engine
export interface ReadinessReport {
  status: "Operational" | "Pending" | "Incomplete" | "Suspended" | "Inactive" | "Terminated" | "Blocked";
  reasons: string[];
}

export interface CanonicalAccountState {
  loginEnabled: boolean;
  employmentActive: boolean;
  accountActive: boolean;
  deleted: boolean;
  suspended: boolean;
  terminated: boolean;
  operational: boolean;
  reasons: string[];
}

export function resolveCanonicalAccountState(user: Partial<User>): CanonicalAccountState {
  const reasons: string[] = [];

  // 1. Explicit deletion check
  const isDeletedExplicit =
    user.isDeleted === true ||
    user.isDeleted === ("true" as any) ||
    String((user as any)?.accountStatus || "").toUpperCase() === "DELETED" ||
    String(user?.status || "").toUpperCase() === "DELETED";

  // 2. Explicit termination check
  const isTerminatedExplicit =
    (user as any)?.terminated === true ||
    (user as any)?.terminated === "true" ||
    String(user?.employmentStatus || "").toUpperCase() === "TERMINATED" ||
    String((user as any)?.accountStatus || "").toUpperCase() === "TERMINATED" ||
    String(user?.status || "").toUpperCase() === "TERMINATED";

  // 3. Explicit suspension check
  const isSuspendedExplicit =
    (user as any)?.suspended === true ||
    (user as any)?.suspended === "true" ||
    String(user?.employmentStatus || "").toUpperCase() === "SUSPENDED" ||
    String((user as any)?.accountStatus || "").toUpperCase() === "SUSPENDED" ||
    String(user?.status || "").toUpperCase() === "SUSPENDED";

  // 4. Login disabled check
  const loginDisabled =
    user?.loginAllowed === false ||
    (user as any)?.loginEnabled === false;

  // 5. Employment inactive check
  const employmentStatusStr = String(user?.employmentStatus || "").toUpperCase();
  const employmentInactive =
    employmentStatusStr === "INACTIVE" ||
    employmentStatusStr === "DISABLED";

  // 6. Account inactive check
  const statusStr = String(user?.status || "").toUpperCase();
  const accountInactive =
    user?.active === false ||
    statusStr === "INACTIVE" ||
    statusStr === "DISABLED";

  if (isDeletedExplicit) {
    reasons.push("ACCOUNT_DELETED");
  }
  if (isTerminatedExplicit) {
    reasons.push("ACCOUNT_TERMINATED");
  }
  if (isSuspendedExplicit) {
    reasons.push("ACCOUNT_SUSPENDED");
  }
  if (loginDisabled) {
    reasons.push("LOGIN_DISABLED");
  }
  if (employmentInactive) {
    reasons.push("EMPLOYMENT_INACTIVE");
  }
  if (accountInactive) {
    reasons.push("ACCOUNT_INACTIVE");
  }

  const deleted = isDeletedExplicit;
  const terminated = isTerminatedExplicit;
  const suspended = isSuspendedExplicit;
  const loginEnabled = !loginDisabled;
  const employmentActive = !employmentInactive && !isTerminatedExplicit && !isSuspendedExplicit;
  const accountActive = !accountInactive && !isDeletedExplicit;

  const operational =
    !deleted &&
    !terminated &&
    !suspended &&
    loginEnabled &&
    employmentActive &&
    accountActive;

  if (isDeletedExplicit && (user?.active === true || statusStr === "ACTIVE")) {
    console.info(
      "[ACCOUNT_STATE_CONFLICT_JSON]",
      JSON.stringify({
        uid: user?.id || user?.uid || "unknown",
        conflictingFields: ["isDeleted: true", `active: ${user?.active}`, `status: '${user?.status}'`, `employmentStatus: '${user?.employmentStatus}'`],
        resolvedState: "CONFLICT_DETECTED",
        resolutionReason: "Explicit isDeleted flag set while active/status is Active",
        dataRepairRecommended: true
      })
    );
  }

  return {
    loginEnabled,
    employmentActive,
    accountActive,
    deleted,
    suspended,
    terminated,
    operational,
    reasons
  };
}

export interface CanonicalReadinessAssignments {
  territoryAssignments?: Array<{ userId?: string; areaId?: string; territoryId?: string; status?: string; active?: boolean }>;
  productAssignments?: Array<{ userId?: string; productId?: string; status?: string; active?: boolean }>;
  assignmentsHydrated?: boolean;
  operationalScopeStatus?: "UNINITIALIZED" | "LOADING" | "READY" | "DENIED" | "ERROR";
}

export function getReadiness(user: Partial<User>, allUsers: User[], canonicalAssignments: CanonicalReadinessAssignments = {}): ReadinessReport {
  const accountState = resolveCanonicalAccountState(user);

  if (accountState.deleted || accountState.terminated) {
    return { status: "Terminated", reasons: ["ACCOUNT_TERMINATED"] };
  }
  if (accountState.suspended) {
    return { status: "Suspended", reasons: ["EMPLOYMENT_SUSPENDED"] };
  }
  if (!accountState.loginEnabled) {
    return { status: "Blocked", reasons: ["ACCOUNT_BLOCKED"] };
  }

  const reasons: string[] = [];
  if (!accountState.employmentActive) {
    reasons.push("EMPLOYMENT_INACTIVE");
  }
  if (!accountState.accountActive) {
    reasons.push("ACCOUNT_INACTIVE");
  }

  // 2. Profile completion check
  if (!user.role || !user.email) {
    return { status: "Incomplete", reasons: ["CORE_PROFILE_MISSING"] };
  }

  // 3. Manager check
  const mgrValidation = validateManager(user, allUsers);
  if (!mgrValidation.isValid) {
    reasons.push("MANAGER_MISSING");
  }

  // 4. Territory/Product assignments checks
  const uid = user.id || user.uid || "";
  const canonicalTerritories = (canonicalAssignments.territoryAssignments || []).filter(assignment => assignment.userId === uid && assignment.status === "Active" && assignment.active !== false && Boolean((assignment.areaId || assignment.territoryId || "").trim()));
  const canonicalProducts = (canonicalAssignments.productAssignments || []).filter(assignment => assignment.userId === uid && assignment.status === "Active" && assignment.active !== false && Boolean((assignment.productId || "").trim()));
  if (user.role === Role.MEDICAL_REP) {
    const hasAreas = canonicalTerritories.length > 0;
    const hasProducts = canonicalProducts.length > 0;
    const hasPrimaryGroup = user.primaryPromotionGroupId && user.primaryPromotionGroupId.trim() !== "";
    if (!hasAreas) {
      reasons.push("AREA_ASSIGNMENT_MISSING");
    }
    if (!hasPrimaryGroup) {
      reasons.push("PRIMARY_PROMOTION_GROUP_MISSING");
    }
    if (!hasProducts) {
      reasons.push("PRODUCT_ASSIGNMENT_MISSING");
    }
  }

  if (user.role === Role.SALES_REP) {
    const hasAreas = canonicalTerritories.length > 0;
    const hasPrimaryGroup = user.primaryPromotionGroupId && user.primaryPromotionGroupId.trim() !== "";
    if (!hasAreas) {
      reasons.push("AREA_ASSIGNMENT_MISSING");
    }
    if (!hasPrimaryGroup) {
      reasons.push("PRIMARY_PROMOTION_GROUP_MISSING");
    }
  }

  // 5. Assignment Synchronization Status check for representatives
  if (user.role === Role.MEDICAL_REP || user.role === Role.SALES_REP) {
    if (canonicalAssignments.assignmentsHydrated !== true || canonicalAssignments.operationalScopeStatus === "UNINITIALIZED" || canonicalAssignments.operationalScopeStatus === "LOADING") reasons.push("CANONICAL_ASSIGNMENTS_NOT_HYDRATED");
    if (canonicalAssignments.operationalScopeStatus === "DENIED" || canonicalAssignments.operationalScopeStatus === "ERROR") reasons.push("CANONICAL_OPERATIONAL_SCOPE_DENIED");
    if (user.assignmentSyncStatus !== "COMPLETE") {
      const syncStatus = user.assignmentSyncStatus;
      if (syncStatus === "FAILED") {
        reasons.push("ASSIGNMENT_SYNC_FAILED");
      } else {
        reasons.push("ASSIGNMENT_SYNC_PENDING");
      }
    }
  }

  // Flexible reporting role checks are handled by validateManager above. No other rigid direct manager constraints.

  if (reasons.length > 0) {
    const hasPending = reasons.includes("ASSIGNMENT_SYNC_PENDING") || reasons.includes("CANONICAL_ASSIGNMENTS_NOT_HYDRATED");
    const status = hasPending ? "Pending" : "Incomplete";
    return { status, reasons };
  }

  return { status: "Operational", reasons: ["COMPLETE"] };
}

let firstEvaluationLogged = false;

export function canAccessCommercialOrderQueue(user: User, permissions?: Permissions): boolean {
  return hasPermission(user, "Orders", "view", permissions);
}

// 7. Department Isolation & Module Access
export function canAccessView(user: User, viewId: string, permissions?: Permissions): boolean {
  if (!user || !user.role) {
    return false;
  }

  if (!firstEvaluationLogged) {
    firstEvaluationLogged = true;
    const timestamp = new Date().toISOString();
    console.info(`[DIAGNOSTIC] [${timestamp}] First canAccessView evaluation`, {
      userId: user.id || "none",
      role: user.role || "none",
      viewId
    });
  }

  // Public & Unified Visits review always allowed
  if (viewId === "dashboard" || viewId === "account-logout" || viewId.startsWith("account-") || viewId === "visits-review" || viewId === "visits" || viewId === "field-visits-review") {
    return true;
  }

  const role = user.role;
  const dept = getDepartment(role);

  // Productivity remains backward-compatible when no canonical role record
  // has been hydrated, but an explicit configurable denial always wins over
  // role and department convenience defaults.
  if (viewId.startsWith("productivity-") && permissions?.view === false) {
    return false;
  }

  // Visit Marketing Requests are a distinct governed resource. Expose only
  // their canonical worklist when the actor has creator or lifecycle
  // capability; backend hierarchy, scope, and resource checks remain final.
  if (viewId === "marketing-my-requests") {
    return canAccessVisitMarketingRequestWorklist(user, permissions);
  }

  if (viewId === "sales-orders") {
    return canAccessCommercialOrderQueue(user, permissions);
  }

  // Workflow-template configuration is an Administration capability, not an
  // operational order route. Keep this exact gate ahead of broad department
  // route matching such as `viewId.includes("order")`.
  if (
    viewId === "admin-order-workflow-settings" &&
    !hasPermission(user, "Administration", "view", permissions)
  ) {
    return false;
  }

  if (viewId.startsWith("samples-") || viewId.startsWith("sample-management")) {
    return canAccessSampleView(user, viewId, permissions);
  }

  // Department Isolation:
  if (role === Role.MEDICAL_REP) {
    // Must never see Sales Planner or Pharmacy commercial flows
    if (viewId.startsWith("pharmacies-") || viewId.includes("sales-") || viewId.includes("order") || viewId.startsWith("finance-")) {
      return false;
    }
  }
  if (role === Role.SALES_REP) {
    // Must never see Medical Planner, Physicians, Medical Detailing
    if (viewId.startsWith("field-") || viewId.includes("physician") || viewId.includes("medical") || viewId.startsWith("samples-")) {
      if (viewId !== "field-gps-verified") { // Keep general tracking if needed, but block planner/physicians
        return false;
      }
    }
  }

  // Super Admins & Admins have general access
  if (role === Role.SUPER_ADMIN || role === Role.ADMIN || role === Role.SYSTEM_ADMINISTRATOR) {
    return true;
  }

  // General Manager can access management, team organization, supervision, analytics, and summaries
  if (role === Role.GENERAL_MANAGER) {
    if (viewId.startsWith("admin-") && viewId !== "admin-user-management" && viewId !== "admin-template-catalog") {
      return false; // General Manager is not system config/DB administrator
    }
    return true; // Can view summaries, reports, approvals, team list, etc.
  }

  // Sales & Marketing Manager can access all commercial, medical promotion, supervision, and analytics views
  if (role === Role.SALES_MARKETING_MANAGER) {
    if (viewId.startsWith("admin-") && viewId !== "admin-user-management" && viewId !== "admin-template-catalog") {
      return false; // Sales & Marketing Manager is not system config/DB administrator
    }
    return true; // Full cross-functional access to sales, medical, and summaries
  }

  // Finance Officer Operational Scope
  if (role === Role.FINANCE || role === Role.TREASURY_OFFICER) {
    if (viewId.startsWith("finance-") || viewId.startsWith("operations-") || viewId === "dashboard" || viewId.startsWith("productivity-")) {
      return true;
    }
    // No unrelated user/medical/sales planning views
    if (viewId.startsWith("field-") || viewId.startsWith("pharmacies-") || viewId.startsWith("admin-")) {
      return false;
    }
    return false;
  }

  // Product Manager Scope
  if (role === Role.PRODUCT_MANAGER) {
    return viewId.startsWith("products-") || viewId.startsWith("productivity-") || viewId === "dashboard" || viewId === "master" || viewId === "master-data";
  }

  // Store Manager / Warehouse Operations
  if (role === Role.STORE_MANAGER || role === Role.WAREHOUSE_MANAGER || role === Role.WAREHOUSE_INVENTORY) {
    return viewId.startsWith("inventory-") || viewId.startsWith("operations-") || viewId.startsWith("productivity-") || viewId === "dashboard";
  }

  // Delivery Officer
  if (role === Role.DELIVERY_OFFICER) {
    return viewId.startsWith("operations-") || viewId.startsWith("productivity-") || viewId === "dashboard";
  }

  // Order Operations Officer
  if (role === Role.ORDER_OPS_OFFICER) {
    return viewId.includes("order") || viewId.startsWith("productivity-") || viewId === "dashboard";
  }

  // Medical Manager & Supervisor
  if (dept === "MEDICAL") {
    // medical modules, planner, physicians, visits, team list, samples, supervision
    if (viewId.startsWith("field-") || viewId.startsWith("products-") || viewId.startsWith("samples-") || viewId.startsWith("supervision-") || viewId.startsWith("territory-") || viewId.startsWith("productivity-") || viewId.startsWith("analytics-")) {
      return true;
    }
    return false;
  }

  // Sales Manager & Supervisor
  if (dept === "SALES") {
    // pharmacies, sales planner, orders, team list, supervision, analytics
    if (viewId.startsWith("pharmacies-") || viewId.includes("order") || viewId.startsWith("supervision-") || viewId.startsWith("territory-") || viewId.startsWith("productivity-") || viewId.startsWith("analytics-")) {
      return true;
    }
    return false;
  }

  return true;
}

export function canAccessVisitMarketingRequestWorklist(user: User, permissions?: Permissions): boolean {
  const dynamic = permissions as (Permissions & {
    active?: boolean;
    execute?: boolean;
    marketingRequestCapabilities?: {
      supervisorApprove?: boolean;
      supervisorReject?: boolean;
      finalApprove?: boolean;
      finalReject?: boolean;
      execute?: boolean;
    };
  }) | undefined;
  if (dynamic?.active === false || !hasPermission(user, "Marketing Activities", "view", permissions)) return false;

  const canCreate = getDepartment(user.role) === "MEDICAL" && dynamic?.create === true;
  const explicitCapabilities = dynamic?.marketingRequestCapabilities;
  if (explicitCapabilities) {
    return canCreate || Object.values(explicitCapabilities).some(value => value === true);
  }

  return canCreate
    || hasPermission(user, "Marketing Activities", "approve", permissions)
    || hasPermission(user, "Marketing Activities", "reject", permissions)
    || dynamic?.execute === true;
}

export function canAccessGroup(user: User, groupId: string, permissions?: Permissions): boolean {
  if (!user || !user.role) {
    return false;
  }

  if (groupId === "dashboard" || groupId === "account") {
    return true;
  }

  if (groupId === "productivity" && permissions?.view === false) {
    return false;
  }

  const role = user.role;
  if (groupId === "samples") {
    return hasSampleCapability(user, "VIEW_SAMPLE_MANAGEMENT", permissions) ||
      hasSampleCapability(user, "VIEW_SAMPLE_REPORTS", permissions);
  }
  if (groupId === "marketing" && canAccessVisitMarketingRequestWorklist(user, permissions)) {
    return true;
  }
  if (groupId === "sales-and-orders") {
    if (permissions?.view === false) return false;
    if (canAccessCommercialOrderQueue(user, permissions)) return true;
  }
  if (role === Role.SUPER_ADMIN || role === Role.ADMIN || role === Role.SYSTEM_ADMINISTRATOR) {
    return true;
  }

  if (role === Role.GENERAL_MANAGER) {
    return true; // GM can access most groups, individual view-level checks will restrict config panels
  }

  const dept = getDepartment(role);

  // Representatives isolation
  if (role === Role.MEDICAL_REP) {
    if (groupId === "pharmacies" || groupId === "sales-and-orders" || groupId === "finance" || groupId === "inventory" || groupId === "administration") {
      return false;
    }
  }
  if (role === Role.SALES_REP) {
    if (groupId === "field-operations" || groupId === "samples" || groupId === "marketing" || groupId === "administration") {
      return false;
    }
  }

  // Other specific role limits
  if (role === Role.FINANCE || role === Role.TREASURY_OFFICER) {
    return ["dashboard", "operations", "finance", "account"].includes(groupId);
  }

  if (role === Role.ORDER_OPS_OFFICER) {
    return ["dashboard", "operations", "account"].includes(groupId);
  }

  if (role === Role.PRODUCT_MANAGER) {
    return ["dashboard", "products", "master-data", "account"].includes(groupId);
  }

  if (role === Role.STORE_MANAGER || role === Role.WAREHOUSE_MANAGER || role === Role.WAREHOUSE_INVENTORY) {
    return ["dashboard", "inventory", "operations", "account"].includes(groupId);
  }

  if (role === Role.DELIVERY_OFFICER) {
    return ["dashboard", "operations", "account"].includes(groupId);
  }

  if (dept === "MEDICAL") {
    return ["dashboard", "field-operations", "products", "samples", "marketing", "territory-team", "supervision", "analytics", "productivity", "master-data", "account"].includes(groupId);
  }

  if (dept === "SALES") {
    return ["dashboard", "pharmacies", "products", "sales-and-orders", "territory-team", "supervision", "analytics", "productivity", "master-data", "account"].includes(groupId);
  }

  return true;
}

// 8. Subordinate Visibility Check
export function canViewUserRecord(actor: User, target: User, allUsers: User[]): boolean {
  if (actor.id === target.id) return true;

  const actorRole = actor.role;
  if (actorRole === Role.SUPER_ADMIN || actorRole === Role.ADMIN || actorRole === Role.SYSTEM_ADMINISTRATOR || actorRole === Role.GENERAL_MANAGER) {
    return true;
  }

  // Recursive direct report lookup using findManager
  const visited = new Set<string>();
  function isSubordinate(user: User): boolean {
    if (visited.has(user.id)) return false;
    visited.add(user.id);

    const mgr = findManager(user, allUsers);
    if (!mgr) return false;
    if (mgr.id === actor.id) return true;
    return isSubordinate(mgr);
  }

  return isSubordinate(target);
}

// 9. Centralized Authorization Helper Utilities (Section 20)
export function canAssignManager(employeeRole: Role, managerRole: Role): boolean {
  const allowed = getValidManagerRoles(employeeRole);
  return allowed.includes(managerRole);
}

export function canManageUser(actor: User, targetUser: User, allUsers: User[] = []): boolean {
  if (actor.role === Role.SUPER_ADMIN || actor.role === Role.ADMIN || actor.role === Role.SYSTEM_ADMINISTRATOR || actor.role === Role.GENERAL_MANAGER) {
    return true;
  }
  if (actor.id === targetUser.id) return false;
  return canViewUserRecord(actor, targetUser, allUsers);
}

export function canViewCountry(actor: User, countryId: string): boolean {
  if (actor.role === Role.SUPER_ADMIN || actor.role === Role.ADMIN || actor.role === Role.SYSTEM_ADMINISTRATOR || actor.role === Role.GENERAL_MANAGER) {
    return true;
  }
  if (!countryId) return false;
  
  const normCountryId = countryId.toLowerCase().trim();
  
  // Check assignedCountries first (e.g. Regional Manager managing multiple countries)
  if (actor.assignedCountries && actor.assignedCountries.some(c => c.toLowerCase().trim() === normCountryId)) {
    return true;
  }
  
  // Check primary country name or standard country field
  if (actor.country && actor.country.toLowerCase().trim() === normCountryId) {
    return true;
  }
  
  return false;
}

export function canViewUserScope(actor: User, targetUser: User, allUsers: User[] = []): boolean {
  if (actor.id === targetUser.id) return true;
  
  if (actor.role === Role.SUPER_ADMIN || actor.role === Role.ADMIN || actor.role === Role.SYSTEM_ADMINISTRATOR || actor.role === Role.GENERAL_MANAGER) {
    return true;
  }
  
  if (actor.role === Role.COUNTRY_MANAGER) {
    return targetUser.country === actor.country;
  }
  
  if (actor.role === Role.REGIONAL_MANAGER) {
    return canViewCountry(actor, targetUser.country || "");
  }
  
  return canViewUserRecord(actor, targetUser, allUsers);
}

export function canValidateOrder(actor: User, order: any): boolean {
  if (actor.role === Role.SUPER_ADMIN || actor.role === Role.ADMIN || actor.role === Role.GENERAL_MANAGER) {
    return true;
  }
  
  const allowedRoles = [Role.ORDER_OPS_OFFICER, Role.SALES_MARKETING_MANAGER, Role.SALES_MANAGER];
  if (!allowedRoles.includes(actor.role)) return false;

  // Segregation of Duties: Creator cannot approve their own order
  if (order && (order.salesRep === actor.name || order.repId === actor.id || order.createdBy === actor.id)) {
    return false;
  }
  
  return true;
}

export function canApproveOrderFinancially(actor: User, order: any): boolean {
  if (actor.role === Role.SUPER_ADMIN || actor.role === Role.ADMIN || actor.role === Role.GENERAL_MANAGER) {
    return true;
  }
  
  const allowedRoles = [Role.FINANCE, Role.FINANCE_MANAGER];
  if (!allowedRoles.includes(actor.role)) return false;

  // Segregation of Duties: Creator cannot approve their own order
  if (order && (order.salesRep === actor.name || order.repId === actor.id || order.createdBy === actor.id)) {
    return false;
  }
  
  return true;
}

export function canReviewStoreOrder(actor: User, order: any): boolean {
  if (actor.role === Role.SUPER_ADMIN || actor.role === Role.ADMIN || actor.role === Role.GENERAL_MANAGER) {
    return true;
  }
  
  const allowedRoles = [Role.STORE_MANAGER, Role.WAREHOUSE_MANAGER, Role.INVENTORY_OFFICER];
  return allowedRoles.includes(actor.role);
}

export function canAssignDelivery(actor: User, order: any): boolean {
  if (actor.role === Role.SUPER_ADMIN || actor.role === Role.ADMIN || actor.role === Role.GENERAL_MANAGER) {
    return true;
  }
  
  const allowedRoles = [Role.STORE_MANAGER, Role.WAREHOUSE_MANAGER];
  return allowedRoles.includes(actor.role);
}

export function canCompleteDelivery(actor: User, order: any): boolean {
  if (actor.role === Role.SUPER_ADMIN || actor.role === Role.ADMIN || actor.role === Role.GENERAL_MANAGER) {
    return true;
  }
  
  return actor.role === Role.DELIVERY_OFFICER;
}

export function canApproveMarketingRequest(actor: User, request: any): boolean {
  if (actor.role === Role.SUPER_ADMIN || actor.role === Role.ADMIN || actor.role === Role.GENERAL_MANAGER) {
    return true;
  }
  
  const allowedRoles = [Role.MARKETING_MANAGER, Role.SALES_MARKETING_MANAGER, Role.COUNTRY_MANAGER];
  return allowedRoles.includes(actor.role);
}

// ==========================================
// CENTRALIZED CRM PERMISSIONS MATRIX ENGINE
// ==========================================

export interface ModulePermissions {
  view?: boolean;
  create?: boolean;
  edit?: boolean;
  delete?: boolean;
  approve?: boolean;
  reject?: boolean;
  reverse?: boolean;
  execute?: boolean;
  export?: boolean;
  import?: boolean;
  assign?: boolean;
  override?: boolean;
  admin?: boolean;
}

export type CRMModule =
  | "Users"
  | "Customers"
  | "Physicians"
  | "Products"
  | "Orders"
  | "Collections"
  | "Samples"
  | "Marketing Activities"
  | "Medical Activities"
  | "Inventory"
  | "Warehouse"
  | "Reports"
  | "Dashboards"
  | "Administration"
  | "Exports"
  | "Imports"
  | "AI Assistant"
  | "Audit Logs"
  | "Configuration";

export type PermissionType =
  | "view"
  | "create"
  | "edit"
  | "delete"
  | "approve"
  | "reject"
  | "reverse"
  | "execute"
  | "export"
  | "import"
  | "assign"
  | "override"
  | "admin";

const fullAccess: ModulePermissions = {
  view: true, create: true, edit: true, delete: true, approve: true, reject: true, execute: true, export: true, import: true, assign: true, override: true, admin: true
};

export const CRM_MODULE_PERMISSIONS: Record<Role, Partial<Record<CRMModule, ModulePermissions>>> = {
  [Role.SUPER_ADMIN]: {
    Users: fullAccess, Customers: fullAccess, Physicians: fullAccess, Products: fullAccess, Orders: fullAccess, Collections: fullAccess, Samples: fullAccess, "Marketing Activities": fullAccess, "Medical Activities": fullAccess, Inventory: fullAccess, Warehouse: fullAccess, Reports: fullAccess, Dashboards: fullAccess, Administration: fullAccess, Exports: fullAccess, Imports: fullAccess, "AI Assistant": fullAccess, "Audit Logs": fullAccess, Configuration: fullAccess
  },
  [Role.SYSTEM_ADMINISTRATOR]: {
    Users: fullAccess, Customers: fullAccess, Physicians: fullAccess, Products: fullAccess, Orders: fullAccess, Collections: fullAccess, Samples: fullAccess, "Marketing Activities": fullAccess, "Medical Activities": fullAccess, Inventory: fullAccess, Warehouse: fullAccess, Reports: fullAccess, Dashboards: fullAccess, Administration: fullAccess, Exports: fullAccess, Imports: fullAccess, "AI Assistant": fullAccess, "Audit Logs": fullAccess, Configuration: fullAccess
  },
  [Role.ADMIN]: {
    Users: fullAccess, Customers: fullAccess, Physicians: fullAccess, Products: fullAccess, Orders: fullAccess, Collections: fullAccess, Samples: fullAccess, "Marketing Activities": fullAccess, "Medical Activities": fullAccess, Inventory: fullAccess, Warehouse: fullAccess, Reports: fullAccess, Dashboards: fullAccess, Administration: fullAccess, Exports: fullAccess, Imports: fullAccess, "AI Assistant": fullAccess, "Audit Logs": fullAccess, Configuration: fullAccess
  },
  [Role.GENERAL_MANAGER]: {
    Users: { view: true, export: true },
    Customers: { view: true, export: true },
    Physicians: { view: true, export: true },
    Products: { view: true },
    Orders: { view: true, approve: true, reject: true, export: true },
    Collections: { view: true, approve: true, reject: true, export: true },
    Samples: { view: true, export: true },
    "Marketing Activities": { view: true, approve: true, reject: true },
    "Medical Activities": { view: true, approve: true, reject: true },
    Inventory: { view: true },
    Warehouse: { view: true },
    Reports: { view: true },
    Dashboards: { view: true },
    Administration: { view: true },
    Exports: { view: true },
    Imports: { view: false },
    "AI Assistant": { view: true },
    "Audit Logs": { view: true },
    Configuration: { view: true }
  },
  [Role.REGIONAL_MANAGER]: {
    Users: { view: true, edit: true, assign: true },
    Customers: { view: true, create: true, edit: true, assign: true, export: true },
    Physicians: { view: true, create: true, edit: true, assign: true, export: true },
    Products: { view: true },
    Orders: { view: true, approve: true, reject: true, export: true, assign: true },
    Collections: { view: true, approve: true, reject: true, export: true },
    Samples: { view: true },
    "Marketing Activities": { view: true, create: true, edit: true, approve: true, reject: true },
    "Medical Activities": { view: true, create: true, edit: true, approve: true, reject: true },
    Inventory: { view: true },
    Warehouse: { view: true },
    Reports: { view: true, export: true },
    Dashboards: { view: true },
    Administration: { view: false },
    Exports: { view: true },
    Imports: { view: false },
    "AI Assistant": { view: true },
    "Audit Logs": { view: true },
    Configuration: { view: false }
  },
  [Role.COUNTRY_MANAGER]: {
    Users: { view: true, edit: true, assign: true },
    Customers: { view: true, create: true, edit: true, assign: true, export: true },
    Physicians: { view: true, create: true, edit: true, assign: true, export: true },
    Products: { view: true },
    Orders: { view: true, approve: true, reject: true, export: true, assign: true },
    Collections: { view: true, approve: true, reject: true, export: true },
    Samples: { view: true },
    "Marketing Activities": { view: true, create: true, edit: true, approve: true, reject: true },
    "Medical Activities": { view: true, create: true, edit: true, approve: true, reject: true },
    Inventory: { view: true },
    Warehouse: { view: true },
    Reports: { view: true, export: true },
    Dashboards: { view: true },
    Administration: { view: false },
    Exports: { view: true },
    Imports: { view: false },
    "AI Assistant": { view: true },
    "Audit Logs": { view: true },
    Configuration: { view: false }
  },
  [Role.SALES_MARKETING_MANAGER]: {
    Users: { view: true, edit: true, assign: true },
    Customers: { view: true, create: true, edit: true, assign: true, export: true },
    Physicians: { view: true, create: true, edit: true, assign: true, export: true },
    Products: { view: true, create: true, edit: true },
    Orders: { view: true, create: true, edit: true, approve: true, reject: true, export: true, assign: true, override: true },
    Collections: { view: true, create: true, edit: true, approve: true, reject: true, export: true },
    Samples: { view: true, create: true, edit: true, approve: true },
    "Marketing Activities": { view: true, create: true, edit: true, delete: true, approve: true, reject: true },
    "Medical Activities": { view: true, create: true, edit: true, delete: true, approve: true, reject: true },
    Inventory: { view: true },
    Warehouse: { view: true },
    Reports: { view: true, export: true },
    Dashboards: { view: true },
    Administration: { view: false },
    Exports: { view: true },
    Imports: { view: true },
    "AI Assistant": { view: true },
    "Audit Logs": { view: true },
    Configuration: { view: false }
  },
  [Role.SALES_MANAGER]: {
    Users: { view: true, assign: true },
    Customers: { view: true, create: true, edit: true, assign: true, export: true },
    Physicians: { view: false },
    Products: { view: true },
    Orders: { view: true, approve: true, reject: true, export: true, assign: true },
    Collections: { view: true, approve: true, reject: true, export: true },
    Samples: { view: false },
    "Marketing Activities": { view: true },
    "Medical Activities": { view: false },
    Inventory: { view: true },
    Warehouse: { view: true },
    Reports: { view: true, export: true },
    Dashboards: { view: true },
    Administration: { view: false },
    Exports: { view: true },
    Imports: { view: false },
    "AI Assistant": { view: true },
    "Audit Logs": { view: true },
    Configuration: { view: false }
  },
  [Role.MEDICAL_MANAGER]: {
    Users: { view: true, assign: true },
    Customers: { view: false },
    Physicians: { view: true, create: true, edit: true, assign: true, export: true },
    Products: { view: true, edit: true },
    Orders: { view: false },
    Collections: { view: false },
    Samples: { view: true, create: true, edit: true, approve: true },
    "Marketing Activities": { view: true, create: true, edit: true, approve: true, reject: true },
    "Medical Activities": { view: true, create: true, edit: true, approve: true, reject: true },
    Inventory: { view: true },
    Warehouse: { view: true },
    Reports: { view: true, export: true },
    Dashboards: { view: true },
    Administration: { view: false },
    Exports: { view: true },
    Imports: { view: false },
    "AI Assistant": { view: true },
    "Audit Logs": { view: true },
    Configuration: { view: false }
  },
  [Role.AREA_SALES_MANAGER]: {
    Users: { view: true, assign: true },
    Customers: { view: true, create: true, edit: true, assign: true, export: true },
    Physicians: { view: false },
    Products: { view: true },
    Orders: { view: true, create: true, edit: true, approve: true, reject: true, export: true, assign: true },
    Collections: { view: true, create: true, edit: true, approve: true, reject: true, export: true },
    Samples: { view: false },
    "Marketing Activities": { view: true },
    "Medical Activities": { view: false },
    Inventory: { view: true },
    Warehouse: { view: true },
    Reports: { view: true, export: true },
    Dashboards: { view: true },
    Administration: { view: false },
    Exports: { view: true },
    Imports: { view: false },
    "AI Assistant": { view: true },
    "Audit Logs": { view: true },
    Configuration: { view: false }
  },
  [Role.SALES_SUPERVISOR]: {
    Users: { view: true },
    Customers: { view: true, create: true, edit: true, assign: true, export: true },
    Physicians: { view: false },
    Products: { view: true },
    Orders: { view: true, create: true, edit: true, approve: true, reject: true, export: true, assign: true },
    Collections: { view: true, create: true, edit: true, approve: true, reject: true, export: true },
    Samples: { view: false },
    "Marketing Activities": { view: true },
    "Medical Activities": { view: false },
    Inventory: { view: true },
    Warehouse: { view: true },
    Reports: { view: true, export: true },
    Dashboards: { view: true },
    Administration: { view: false },
    Exports: { view: true },
    Imports: { view: false },
    "AI Assistant": { view: true },
    "Audit Logs": { view: true },
    Configuration: { view: false }
  },
  [Role.MEDICAL_SUPERVISOR]: {
    Users: { view: true },
    Customers: { view: false },
    Physicians: { view: true, create: true, edit: true, assign: true, export: true },
    Products: { view: true },
    Orders: { view: false },
    Collections: { view: false },
    Samples: { view: true, create: true, edit: true, approve: true },
    // First-stage Visit Marketing Request review is additionally constrained
    // by canonical hierarchy and resource scope in the backend transition service.
    "Marketing Activities": { view: true, approve: true, reject: true },
    "Medical Activities": { view: true, create: true, edit: true, approve: true, reject: true },
    Inventory: { view: true },
    Warehouse: { view: true },
    Reports: { view: true, export: true },
    Dashboards: { view: true },
    Administration: { view: false },
    Exports: { view: true },
    Imports: { view: false },
    "AI Assistant": { view: true },
    "Audit Logs": { view: true },
    Configuration: { view: false }
  },
  [Role.SALES_REP]: {
    Users: { view: false },
    Customers: { view: true, create: true, edit: true },
    Physicians: { view: false },
    Products: { view: true },
    Orders: { view: true, create: true, edit: true, export: true },
    Collections: { view: true, create: true, edit: true, export: true },
    Samples: { view: false },
    "Marketing Activities": { view: true },
    "Medical Activities": { view: false },
    Inventory: { view: true },
    Warehouse: { view: false },
    Reports: { view: true },
    Dashboards: { view: true },
    Administration: { view: false },
    Exports: { view: true },
    Imports: { view: false },
    "AI Assistant": { view: true },
    "Audit Logs": { view: false },
    Configuration: { view: false }
  },
  [Role.MEDICAL_REP]: {
    Users: { view: false },
    Customers: { view: false },
    Physicians: { view: true, create: true, edit: true },
    Products: { view: true },
    Orders: { view: false },
    Collections: { view: false },
    Samples: { view: true, create: true },
    "Marketing Activities": { view: true },
    "Medical Activities": { view: true, create: true, edit: true },
    Inventory: { view: true },
    Warehouse: { view: false },
    Reports: { view: true },
    Dashboards: { view: true },
    Administration: { view: false },
    Exports: { view: true },
    Imports: { view: false },
    "AI Assistant": { view: true },
    "Audit Logs": { view: false },
    Configuration: { view: false }
  },
  [Role.FINANCE_MANAGER]: {
    Users: { view: true },
    Customers: { view: true, export: true },
    Physicians: { view: false },
    Products: { view: true },
    Orders: { view: true, approve: true, reject: true, export: true },
    Collections: { view: true, create: true, edit: true, approve: true, reject: true, export: true, reverse: true },
    Samples: { view: false },
    "Marketing Activities": { view: true },
    "Medical Activities": { view: false },
    Inventory: { view: true },
    Warehouse: { view: true },
    Reports: { view: true, export: true },
    Dashboards: { view: true },
    Administration: { view: false },
    Exports: { view: true },
    Imports: { view: false },
    "AI Assistant": { view: true },
    "Audit Logs": { view: true },
    Configuration: { view: true }
  },
  [Role.FINANCE]: { // Finance Officer
    Users: { view: true },
    Customers: { view: true, export: true },
    Physicians: { view: false },
    Products: { view: true },
    Orders: { view: true, approve: true, reject: true, export: true },
    Collections: { view: true, create: true, edit: true, approve: true, reject: true, export: true },
    Samples: { view: false },
    "Marketing Activities": { view: true },
    "Medical Activities": { view: false },
    Inventory: { view: true },
    Warehouse: { view: true },
    Reports: { view: true, export: true },
    Dashboards: { view: true },
    Administration: { view: false },
    Exports: { view: true },
    Imports: { view: false },
    "AI Assistant": { view: true },
    "Audit Logs": { view: true },
    Configuration: { view: false }
  },
  [Role.TREASURY_OFFICER]: {
    Users: { view: false },
    Customers: { view: true },
    Physicians: { view: false },
    Products: { view: true },
    Orders: { view: true },
    Collections: { view: true, create: true, edit: true, approve: true, reverse: true },
    Samples: { view: false },
    "Marketing Activities": { view: false },
    "Medical Activities": { view: false },
    Inventory: { view: true },
    Warehouse: { view: false },
    Reports: { view: true },
    Dashboards: { view: true },
    Administration: { view: false },
    Exports: { view: true },
    Imports: { view: false },
    "AI Assistant": { view: true },
    "Audit Logs": { view: false },
    Configuration: { view: false }
  },
  [Role.WAREHOUSE_MANAGER]: {
    Users: { view: false },
    Customers: { view: true },
    Physicians: { view: false },
    Products: { view: true, edit: true },
    Orders: { view: true, approve: true, reject: true },
    Collections: { view: false },
    Samples: { view: true, create: true, edit: true, approve: true },
    "Marketing Activities": { view: false },
    "Medical Activities": { view: false },
    Inventory: { view: true, create: true, edit: true, approve: true },
    Warehouse: { view: true, create: true, edit: true, approve: true },
    Reports: { view: true, export: true },
    Dashboards: { view: true },
    Administration: { view: false },
    Exports: { view: true },
    Imports: { view: true },
    "AI Assistant": { view: true },
    "Audit Logs": { view: true },
    Configuration: { view: false }
  },
  [Role.STORE_MANAGER]: {
    Users: { view: false },
    Customers: { view: true },
    Physicians: { view: false },
    Products: { view: true },
    Orders: { view: true, approve: true, reject: true },
    Collections: { view: false },
    Samples: { view: true, edit: true },
    "Marketing Activities": { view: false },
    "Medical Activities": { view: false },
    Inventory: { view: true, create: true, edit: true, approve: true },
    Warehouse: { view: true, edit: true, approve: true },
    Reports: { view: true },
    Dashboards: { view: true },
    Administration: { view: false },
    Exports: { view: true },
    Imports: { view: true },
    "AI Assistant": { view: true },
    "Audit Logs": { view: false },
    Configuration: { view: false }
  },
  [Role.WAREHOUSE_INVENTORY]: {
    Users: { view: false },
    Customers: { view: false },
    Physicians: { view: false },
    Products: { view: true },
    Orders: { view: true },
    Collections: { view: false },
    Samples: { view: true },
    "Marketing Activities": { view: false },
    "Medical Activities": { view: false },
    Inventory: { view: true, create: true, edit: true },
    Warehouse: { view: true, create: true, edit: true },
    Reports: { view: true },
    Dashboards: { view: true },
    Administration: { view: false },
    Exports: { view: true },
    Imports: { view: true },
    "AI Assistant": { view: true },
    "Audit Logs": { view: false },
    Configuration: { view: false }
  },
  [Role.INVENTORY_OFFICER]: {
    Users: { view: false },
    Customers: { view: false },
    Physicians: { view: false },
    Products: { view: true },
    Orders: { view: true },
    Collections: { view: false },
    Samples: { view: true },
    "Marketing Activities": { view: false },
    "Medical Activities": { view: false },
    Inventory: { view: true, create: true, edit: true },
    Warehouse: { view: true, create: true, edit: true },
    Reports: { view: true },
    Dashboards: { view: true },
    Administration: { view: false },
    Exports: { view: true },
    Imports: { view: true },
    "AI Assistant": { view: true },
    "Audit Logs": { view: false },
    Configuration: { view: false }
  },
  [Role.DELIVERY_OFFICER]: {
    Users: { view: false },
    Customers: { view: true },
    Physicians: { view: false },
    Products: { view: true },
    Orders: { view: true, edit: true, approve: true },
    Collections: { view: false },
    Samples: { view: false },
    "Marketing Activities": { view: false },
    "Medical Activities": { view: false },
    Inventory: { view: true },
    Warehouse: { view: true },
    Reports: { view: false },
    Dashboards: { view: false },
    Administration: { view: false },
    Exports: { view: false },
    Imports: { view: false },
    "AI Assistant": { view: true },
    "Audit Logs": { view: false },
    Configuration: { view: false }
  },
  [Role.ORDER_OPS_OFFICER]: {
    Users: { view: false },
    Customers: { view: true },
    Physicians: { view: false },
    Products: { view: true },
    Orders: { view: true, create: true, edit: true, approve: true, reject: true, assign: true },
    Collections: { view: false },
    Samples: { view: false },
    "Marketing Activities": { view: false },
    "Medical Activities": { view: false },
    Inventory: { view: true },
    Warehouse: { view: true },
    Reports: { view: true },
    Dashboards: { view: true },
    Administration: { view: false },
    Exports: { view: true },
    Imports: { view: false },
    "AI Assistant": { view: true },
    "Audit Logs": { view: true },
    Configuration: { view: false }
  },
  [Role.MARKETING_MANAGER]: {
    Users: { view: true },
    Customers: { view: true },
    Physicians: { view: true },
    Products: { view: true, create: true, edit: true },
    Orders: { view: true },
    Collections: { view: false },
    Samples: { view: true },
    "Marketing Activities": { view: true, create: true, edit: true, delete: true, approve: true, reject: true },
    "Medical Activities": { view: true },
    Inventory: { view: true },
    Warehouse: { view: false },
    Reports: { view: true, export: true },
    Dashboards: { view: true },
    Administration: { view: false },
    Exports: { view: true },
    Imports: { view: false },
    "AI Assistant": { view: true },
    "Audit Logs": { view: true },
    Configuration: { view: false }
  },
  [Role.PRODUCT_MANAGER]: {
    Users: { view: false },
    Customers: { view: true },
    Physicians: { view: true },
    Products: { view: true, create: true, edit: true },
    Orders: { view: true },
    Collections: { view: false },
    Samples: { view: true },
    "Marketing Activities": { view: true, create: true, edit: true },
    "Medical Activities": { view: true },
    Inventory: { view: true },
    Warehouse: { view: false },
    Reports: { view: true },
    Dashboards: { view: true },
    Administration: { view: false },
    Exports: { view: true },
    Imports: { view: false },
    "AI Assistant": { view: true },
    "Audit Logs": { view: false },
    Configuration: { view: false }
  },
  [Role.MARKETING_OFFICER]: {
    Users: { view: false },
    Customers: { view: true },
    Physicians: { view: true },
    Products: { view: true, edit: true },
    Orders: { view: true },
    Collections: { view: false },
    Samples: { view: true },
    "Marketing Activities": { view: true, create: true, edit: true },
    "Medical Activities": { view: true },
    Inventory: { view: true },
    Warehouse: { view: false },
    Reports: { view: true },
    Dashboards: { view: true },
    Administration: { view: false },
    Exports: { view: true },
    Imports: { view: false },
    "AI Assistant": { view: true },
    "Audit Logs": { view: false },
    Configuration: { view: false }
  },
  [Role.MARKETING]: {
    Users: { view: false },
    Customers: { view: true },
    Physicians: { view: true },
    Products: { view: true, edit: true },
    Orders: { view: true },
    Collections: { view: false },
    Samples: { view: true },
    "Marketing Activities": { view: true, create: true, edit: true },
    "Medical Activities": { view: true },
    Inventory: { view: true },
    Warehouse: { view: false },
    Reports: { view: true },
    Dashboards: { view: true },
    Administration: { view: false },
    Exports: { view: true },
    Imports: { view: false },
    "AI Assistant": { view: true },
    "Audit Logs": { view: false },
    Configuration: { view: false }
  }
};

export function hasPermission(
  user: User | null | undefined,
  module: CRMModule,
  action: PermissionType,
  dynamicPermissions?: Permissions
): boolean {
  if (!user || !user.role) return false;
  
  // Posted-payment reversal is baseline-limited, including for administrators.
  if (module === "Collections" && action === "reverse") {
    return CRM_MODULE_PERMISSIONS[user.role]?.Collections?.reverse === true
      && dynamicPermissions?.reverse !== false
      && (dynamicPermissions as (Permissions & { active?: boolean }) | undefined)?.active !== false;
  }

  // Preserve the existing administrator bypass for unrelated permissions.
  if (user.role === Role.SUPER_ADMIN || user.role === Role.SYSTEM_ADMINISTRATOR) {
    return true;
  }
  
  // Check dynamic rolePermissions overrides if passed
  if (dynamicPermissions) {
    if (action === "view" && !dynamicPermissions.view) return false;
    if (action === "create" && !dynamicPermissions.create) return false;
    if (action === "edit" && !dynamicPermissions.edit) return false;
    if (action === "delete" && !dynamicPermissions.delete) return false;
    if (action === "approve" && !dynamicPermissions.approve) return false;
    if (action === "reject" && !dynamicPermissions.approve) return false;
    if (action === "export" && !dynamicPermissions.export) return false;
    if (action === "import" && !dynamicPermissions.import) return false;
    if (action === "assign" && !dynamicPermissions.assign) return false;
  }
  
  // Look up in central role permission registry
  const roleRules = CRM_MODULE_PERMISSIONS[user.role];
  if (!roleRules) return false;
  
  const moduleRules = roleRules[module];
  if (!moduleRules) return false;
  
  return !!moduleRules[action];
}
