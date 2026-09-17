import { auth } from "./firebase";
import { Role, User, normalizeRole } from "../types";

export type HierarchyDepth = "self" | "direct" | "descendants";
export type InactiveUserPolicy = "exclude-and-traverse" | "exclude-branch" | "include";

export interface ResolveSubordinateScopeOptions {
  depth?: HierarchyDepth;
  inactiveUserPolicy?: InactiveUserPolicy;
  actor?: User;
  fetchDirectReports?: (managerUid: string) => Promise<User[]>;
}

export interface HierarchyScope {
  actor: User;
  directReports: User[];
  descendants: User[];
  allHierarchyUsers: User[];
  directReportUids: string[];
  descendantUids: string[];
  allHierarchyUids: string[];
}

const HIERARCHY_DISCOVERY_ROLES = new Set<string>([
  Role.SUPER_ADMIN,
  Role.ADMIN,
  Role.SYSTEM_ADMINISTRATOR,
  Role.GENERAL_MANAGER,
  Role.REGIONAL_MANAGER,
  Role.COUNTRY_MANAGER,
  Role.SALES_MARKETING_MANAGER,
  Role.SALES_MANAGER,
  Role.AREA_SALES_MANAGER,
  Role.MEDICAL_MANAGER,
  Role.MARKETING_MANAGER,
  Role.PRODUCT_MANAGER,
  Role.FINANCE_MANAGER,
  Role.WAREHOUSE_MANAGER,
  Role.STORE_MANAGER,
  Role.MEDICAL_SUPERVISOR,
  Role.SALES_SUPERVISOR,
]);

export function canResolveSubordinates(user: Pick<User, "role" | "active" | "status" | "isDeleted">): boolean {
  return isHierarchyUserActive(user) && hasHierarchyDiscoveryRole(user);
}

function hasHierarchyDiscoveryRole(user: Pick<User, "role">): boolean {
  return HIERARCHY_DISCOVERY_ROLES.has(normalizeRole(user.role));
}

export function isHierarchyUserActive(user: Pick<User, "active" | "status" | "employmentStatus" | "accountStatus" | "isDeleted">): boolean {
  return user.isDeleted !== true &&
    user.active !== false &&
    user.status !== "Inactive" &&
    user.status !== "Archived" &&
    user.employmentStatus !== "Inactive" &&
    user.employmentStatus !== "Archived" &&
    user.accountStatus !== "INACTIVE";
}

function sortUsers(users: User[]): User[] {
  return [...users].sort((a, b) => a.id.localeCompare(b.id));
}

export async function resolveSubordinateScope(
  actorUid: string,
  options: ResolveSubordinateScopeOptions = {},
): Promise<HierarchyScope> {
  const actor = options.actor;
  if (!actorUid || !actor || actor.id !== actorUid) {
    throw new Error("resolveSubordinateScope requires the authenticated actor's canonical Firebase Auth UID and matching profile");
  }

  const depth = options.depth ?? "descendants";
  const inactivePolicy = options.inactiveUserPolicy ?? "exclude-and-traverse";
  if (depth === "self" || !canResolveSubordinates(actor)) {
    return {
      actor,
      directReports: [],
      descendants: [],
      allHierarchyUsers: [actor],
      directReportUids: [],
      descendantUids: [],
      allHierarchyUids: [actor.id],
    };
  }
  if (!options.fetchDirectReports) {
    const authenticatedUser = auth.currentUser;
    if (!authenticatedUser || authenticatedUser.uid !== actorUid) {
      throw new Error("Authenticated Firebase UID does not match hierarchy actor");
    }
    const token = await authenticatedUser.getIdToken();
    const response = await fetch("/api/organizational-scope", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        actorUid,
        depth,
        includeSelf: true,
        includeInactive: inactivePolicy === "include",
        departmentScope: "all",
        geographyScope: "all",
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.code || payload?.error || "Secure hierarchy resolution failed");
    }
    return payload as HierarchyScope;
  }
  const fetchDirectReports = options.fetchDirectReports;
  const directReports: User[] = [];
  const descendants: User[] = [];
  const discovered = new Set<string>([actorUid]);
  const expanded = new Set<string>();

  const queue: Array<{ managerUid: string; level: number }> = [{ managerUid: actorUid, level: 0 }];
    while (queue.length > 0) {
      const next = queue.shift()!;
      if (expanded.has(next.managerUid)) continue;
      expanded.add(next.managerUid);

      const reports = sortUsers(await fetchDirectReports(next.managerUid));
      for (const report of reports) {
        if (!report.id || discovered.has(report.id)) continue;
        discovered.add(report.id);

        const active = isHierarchyUserActive(report);
        if (active || inactivePolicy === "include") {
          descendants.push(report);
          if (next.level === 0) directReports.push(report);
        }

        const mayTraverse = inactivePolicy !== "exclude-branch" || active;
        if (depth === "descendants" && mayTraverse && hasHierarchyDiscoveryRole(report)) {
          queue.push({ managerUid: report.id, level: next.level + 1 });
        }
      }
  }

  const sortedDirectReports = sortUsers(directReports);
  const sortedDescendants = sortUsers(descendants);
  const allHierarchyUsers = sortUsers([actor, ...sortedDescendants]);
  return {
    actor,
    directReports: sortedDirectReports,
    descendants: sortedDescendants,
    allHierarchyUsers,
    directReportUids: sortedDirectReports.map((user) => user.id),
    descendantUids: sortedDescendants.map((user) => user.id),
    allHierarchyUids: allHierarchyUsers.map((user) => user.id),
  };
}
