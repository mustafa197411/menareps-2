import {
  resolveRoleScopePolicy,
  type CanonicalRoleScopePolicy,
  type RoleScopePolicyOverride,
} from "../src/lib/roleScopePolicy";
import { randomUUID } from "node:crypto";
import { Role } from "../src/types";
import { getValidManagerRoles } from "../src/lib/userPolicyEngine";

export type OrganizationalDepth = "self" | "direct" | "descendants";
export type OrganizationalDepartmentScope = "actor" | "all";
export type OrganizationalGeographyScope = "actor" | "all";

export interface OrganizationalUser {
  id: string;
  role: string;
  managerId?: string;
  active?: boolean;
  status?: string;
  employmentStatus?: string;
  accountStatus?: string;
  loginAllowed?: boolean;
  isDeleted?: boolean;
  department?: string;
  country?: string;
  assignedCountries?: string[];
  region?: string;
  district?: string;
  city?: string;
  areaIds?: string[];
  [key: string]: unknown;
}

export interface OrganizationalScopeRequest {
  actorUid?: string;
  depth?: OrganizationalDepth;
  includeSelf?: boolean;
  includeInactive?: boolean;
  departmentScope?: OrganizationalDepartmentScope;
  geographyScope?: OrganizationalGeographyScope;
}

export interface OrganizationalScopeResult {
  actor: OrganizationalUser;
  directReports: OrganizationalUser[];
  descendants: OrganizationalUser[];
  allHierarchyUsers: OrganizationalUser[];
  directReportUids: string[];
  descendantUids: string[];
  allHierarchyUids: string[];
  scopePolicy: CanonicalRoleScopePolicy;
}

export interface OrganizationalHierarchyRepository {
  getUser(uid: string): Promise<OrganizationalUser | null>;
  getDirectReports(managerUid: string): Promise<OrganizationalUser[]>;
  getAllUsers(): Promise<OrganizationalUser[]>;
  getRolePermissions(role: string): Promise<Record<string, unknown> | null>;
  getAccessGovernance?(role: string): Promise<{ active?: boolean; scopePolicy?: RoleScopePolicyOverride } | null>;
}

export class OrganizationalHierarchyError extends Error {
  constructor(public readonly code: string, public readonly httpStatus: number, message: string) {
    super(message);
  }
}

/** Strict reporting ancestry, independent of visibility and action permissions. */
export async function isReportingAncestor(
  ancestorUid: string,
  descendantUid: string,
  repository: Pick<OrganizationalHierarchyRepository, "getUser">,
): Promise<boolean> {
  if (!exactDiscoveryUid(ancestorUid) || !exactDiscoveryUid(descendantUid) || ancestorUid === descendantUid) return false;
  return walkReportingChain(descendantUid, repository, ancestorUid);
}

/** One bounded chain validator, shared by ancestry proof and discovery roots. */
async function walkReportingChain(uid: string, repository: Pick<OrganizationalHierarchyRepository, "getUser">, ancestorUid?: string): Promise<boolean> {
  const visited = new Set<string>();
  let found = ancestorUid === undefined;
  while (true) {
    if (visited.size >= DISCOVERY_WORK_LIMIT) throw discoveryError("HIERARCHY_DISCOVERY_CAPACITY_EXCEEDED", "Reporting chain exceeds bounded read capacity", 413);
    if (!exactDiscoveryUid(uid) || visited.has(uid)) return false;
    visited.add(uid);
    const user = await repository.getUser(uid);
    try { validDiscoveryUser(user, uid); } catch (error) {
      if (error instanceof OrganizationalHierarchyError) return false;
      throw error;
    }
    if (uid === ancestorUid) found = true;
    if (user.managerId === undefined || user.managerId === null || user.managerId === "") {
      return found && getValidManagerRoles(user.role as Role).length === 0;
    }
    uid = user.managerId;
  }
}

export async function assertReportingChainIntegrity(uid: string, repository: Pick<OrganizationalHierarchyRepository, "getUser">): Promise<void> {
  if (!await walkReportingChain(uid, repository)) malformedHierarchy();
}

function active(user: OrganizationalUser): boolean {
  return user.isDeleted !== true && user.active !== false && user.loginAllowed !== false &&
    !["Inactive", "Archived", "Suspended"].includes(user.status || "") &&
    !["Inactive", "Archived", "Suspended"].includes(user.employmentStatus || "") &&
    user.accountStatus !== "INACTIVE";
}

export const HIERARCHY_CONTINUATION_MAX_BYTES = 750 * 1024;
const DISCOVERY_WORK_LIMIT = 1000;
const CONTINUATION_LIFETIME_MS = 30 * 60 * 1000;
const CANDIDATE_MODE = "ACTIVE_SALES_REPRESENTATIVES" as const;

/** Only traversal identities are persisted; no user profiles or business data. */
export interface HierarchyContinuationDocument {
  schemaVersion: 1;
  actorUid: string;
  rootUid: string;
  pageSize: number;
  candidateMode: typeof CANDIDATE_MODE;
  createdAt: number;
  expiresAt: number;
  // A string avoids indexing each member of potentially large identity arrays.
  stateJson: string;
}

export interface HierarchyContinuationSnapshot {
  token: string;
  document: unknown;
  /** Repository-owned compare-and-swap version; never sent to the client. */
  revision: unknown;
}

export interface ReportingDescendantRepository extends Pick<OrganizationalHierarchyRepository, "getUser"> {
  getDirectReportsPage(managerUid: string, afterDocumentId: string | undefined, limit: number): Promise<OrganizationalUser[]>;
  getContinuation(token: string): Promise<HierarchyContinuationSnapshot | null>;
  /** Conditional delete + optional create in one atomic operation; no retries. */
  advanceContinuation(current: HierarchyContinuationSnapshot | undefined,
    replacement: { token: string; document: HierarchyContinuationDocument } | undefined): Promise<void>;
}

interface ReportingTraversalState {
  frontier: string[];
  discoveredIds: string[];
  afterDocumentId?: string;
  /** Canonical parent of the cursor row, recorded when that row is validated. */
  afterManagerUid?: string;
}

export interface ReportingDescendantRequest {
  rootUid: string;
  pageSize?: number;
  continuationToken?: string;
}

function discoveryError(code: string, message: string, status = 400): OrganizationalHierarchyError {
  return new OrganizationalHierarchyError(code, status, message);
}

function exactDiscoveryUid(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value === value.trim() && !value.includes("/");
}

/** Measure the complete persisted representation, including escaped stateJson. */
export function assertHierarchyContinuationCapacity(document: HierarchyContinuationDocument): void {
  if (Buffer.byteLength(JSON.stringify(document), "utf8") > HIERARCHY_CONTINUATION_MAX_BYTES) {
    throw discoveryError("HIERARCHY_CONTINUATION_CAPACITY_EXCEEDED", "Hierarchy continuation exceeds its storage capacity", 413);
  }
}

function malformedHierarchy(): never {
  throw discoveryError("HIERARCHY_MALFORMED", "Canonical hierarchy or continuation state is malformed", 409);
}

function validDiscoveryUser(user: OrganizationalUser | null, expectedUid?: string): asserts user is OrganizationalUser {
  // Reuse the existing top-level manager policy, without changing stored data.
  const permittedNoManager = user && getValidManagerRoles(user.role as Role).length === 0
    && (user.managerId === "" || user.managerId === null);
  if (!user || !exactDiscoveryUid(user.id) || (expectedUid !== undefined && user.id !== expectedUid) ||
      typeof user.role !== "string" || !user.role.length ||
      (user.managerId !== undefined && !permittedNoManager && (!exactDiscoveryUid(user.managerId) || user.managerId === user.id))) malformedHierarchy();
  for (const key of ["active", "isDeleted", "loginAllowed"] as const) {
    if (user[key] !== undefined && typeof user[key] !== "boolean") malformedHierarchy();
  }
  for (const key of ["status", "employmentStatus", "accountStatus"] as const) {
    if (user[key] !== undefined && typeof user[key] !== "string") malformedHierarchy();
  }
}

/** Record eligibility only: no reads, permissions, or reporting-ancestry proof. */
export function isEligibleSalesRepresentativeCandidate(
  user: OrganizationalUser | null,
  expectedUid?: string,
): boolean {
  try {
    validDiscoveryUser(user, expectedUid);
  } catch (error) {
    if (error instanceof OrganizationalHierarchyError && error.code === "HIERARCHY_MALFORMED") return false;
    throw error;
  }
  return user.role === Role.SALES_REP && active(user);
}

function readTraversal(document: HierarchyContinuationDocument): ReportingTraversalState {
  let state: ReportingTraversalState;
  try { state = JSON.parse(document.stateJson); } catch { malformedHierarchy(); }
  const denseUniqueIds = (values: unknown): values is string[] => {
    if (!Array.isArray(values) || !values.length) return false;
    for (let i = 0; i < values.length; i++) {
      if (!Object.prototype.hasOwnProperty.call(values, i) || !exactDiscoveryUid(values[i])) return false;
    }
    return new Set(values).size === values.length;
  };
  if (!state || typeof state !== "object" || Array.isArray(state) ||
      Object.keys(state).some(key => !["frontier", "discoveredIds", "afterDocumentId", "afterManagerUid"].includes(key)) ||
      !denseUniqueIds(state.frontier) || !denseUniqueIds(state.discoveredIds)) malformedHierarchy();
  const discovered = new Set(state.discoveredIds);
  if (state.discoveredIds[0] !== document.rootUid || state.frontier.some(uid => !discovered.has(uid)) ||
      (state.frontier.includes(document.rootUid) && state.frontier[0] !== document.rootUid) ||
      (state.afterDocumentId !== undefined && (!exactDiscoveryUid(state.afterDocumentId) || !discovered.has(state.afterDocumentId)))) malformedHierarchy();
  // The pending FIFO is a suffix of the discovery order, never reordered state.
  const offset = state.discoveredIds.length - state.frontier.length;
  if (state.frontier.some((uid, index) => state.discoveredIds[offset + index] !== uid)) malformedHierarchy();
  if (state.afterDocumentId !== undefined) {
    // BFS cannot discover another manager's children while this manager's page
    // is unfinished. Its last returned child must be the last discovered node,
    // still pending after its parent, with the validated parent provenance.
    if (state.afterManagerUid !== state.frontier[0] || state.frontier.length < 2 ||
        state.afterDocumentId !== state.discoveredIds[state.discoveredIds.length - 1] ||
        state.afterDocumentId === state.frontier[0]) malformedHierarchy();
  } else if (state.afterManagerUid !== undefined) {
    malformedHierarchy();
  }
  return state;
}

/**
 * Live reporting discovery, NOT action authorization. The caller authenticates
 * the actor and authorizes the root. Submitted IDs need independent validation.
 * Completeness across pages assumes unchanged hierarchy/candidate data.
 */
export async function listReportingDescendantsPage(
  verifiedActorUid: string,
  request: ReportingDescendantRequest,
  repository: ReportingDescendantRepository,
  options: { now?: () => number } = {},
): Promise<{ representatives: OrganizationalUser[]; continuationToken?: string; workUnits: number }> {
  const now = options.now ?? Date.now;
  const pageSize = request.pageSize === undefined ? 50 : request.pageSize;
  if (!exactDiscoveryUid(verifiedActorUid) || !exactDiscoveryUid(request.rootUid) ||
      !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100 ||
      (request.continuationToken !== undefined && !exactDiscoveryUid(request.continuationToken))) {
    throw discoveryError("HIERARCHY_DISCOVERY_REQUEST_INVALID", "Invalid hierarchy discovery request");
  }
  let workUnits = 0;
  let current: HierarchyContinuationSnapshot | undefined;
  let document: HierarchyContinuationDocument;
  let state: ReportingTraversalState;
  if (request.continuationToken !== undefined) {
    workUnits += 1;
    const snapshot = await repository.getContinuation(request.continuationToken);
    if (!snapshot) throw discoveryError("HIERARCHY_CONTINUATION_INVALID", "Continuation is missing or consumed", 409);
    workUnits += 1;
    current = snapshot;
    const data = snapshot.document as HierarchyContinuationDocument;
    // Never invalidate another actor's or root's legitimate continuation.
    if (!data || data.actorUid !== verifiedActorUid || data.rootUid !== request.rootUid ||
        data.pageSize !== pageSize || data.candidateMode !== CANDIDATE_MODE) {
      throw discoveryError("HIERARCHY_CONTINUATION_MISMATCH", "Continuation does not match this actor/root/request", 403);
    }
    document = data;
    if (Number.isFinite(data.expiresAt) && now() >= data.expiresAt) {
      await repository.advanceContinuation(current, undefined);
      throw discoveryError("HIERARCHY_CONTINUATION_EXPIRED", "Continuation has expired", 410);
    }
  } else {
    const createdAt = now();
    document = { schemaVersion: 1, actorUid: verifiedActorUid, rootUid: request.rootUid, pageSize,
      candidateMode: CANDIDATE_MODE, createdAt, expiresAt: createdAt + CONTINUATION_LIFETIME_MS,
      stateJson: JSON.stringify({ frontier: [request.rootUid], discoveredIds: [request.rootUid] }) };
  }
  try {
    if (document.schemaVersion !== 1 || !Number.isFinite(document.createdAt) || !Number.isFinite(document.expiresAt) ||
        document.expiresAt !== document.createdAt + CONTINUATION_LIFETIME_MS || document.createdAt > now() ||
        typeof document.stateJson !== "string" ||
        Object.keys(document).some(key => !["schemaVersion", "actorUid", "rootUid", "pageSize", "candidateMode", "createdAt", "expiresAt", "stateJson"].includes(key))) malformedHierarchy();
    state = readTraversal(document);
    const discovered = new Set(state.discoveredIds);
    const representatives: OrganizationalUser[] = [];
    // Exact reads cost one operation plus one returned document, at most two.
    const readUser = async (uid: string) => {
      workUnits += 1;
      const user = await repository.getUser(uid);
      if (user) workUnits += 1;
      validDiscoveryUser(user, uid);
      return user;
    };
    await assertReportingChainIntegrity(request.rootUid, { getUser: async uid => {
      if (workUnits + 2 > DISCOVERY_WORK_LIMIT) throw discoveryError("HIERARCHY_DISCOVERY_CAPACITY_EXCEEDED", "Discovery root exceeds capacity", 413);
      return readUser(uid);
    } });
    while (state.frontier.length && representatives.length < pageSize) {
      // A manager read (<=2) and at least one query/result (<=2) must fit.
      if (DISCOVERY_WORK_LIMIT - workUnits < 4) break;
      const managerUid = state.frontier[0];
      await readUser(managerUid);
      const limit = Math.min(pageSize - representatives.length, DISCOVERY_WORK_LIMIT - workUnits - 1);
      workUnits += 1;
      const reports = await repository.getDirectReportsPage(managerUid, state.afterDocumentId, limit);
      workUnits += reports.length;
      if (reports.length > limit) malformedHierarchy();
      let previous = state.afterDocumentId;
      for (const report of reports) {
        validDiscoveryUser(report);
        if (report.managerId !== managerUid || discovered.has(report.id) ||
            (previous !== undefined && Buffer.compare(Buffer.from(previous), Buffer.from(report.id)) >= 0)) malformedHierarchy();
        discovered.add(report.id);
        state.discoveredIds.push(report.id);
        state.frontier.push(report.id);
        previous = report.id;
        // Eligibility never controls whether this canonical edge is traversed.
        if (isEligibleSalesRepresentativeCandidate(report)) representatives.push(report);
      }
      if (reports.length < limit) {
        state.frontier.shift();
        delete state.afterDocumentId;
        delete state.afterManagerUid;
      } else {
        state.afterDocumentId = previous;
        state.afterManagerUid = reports[reports.length - 1].managerId;
      }
    }
    if (now() >= document.expiresAt) {
      if (current) await repository.advanceContinuation(current, undefined);
      throw discoveryError("HIERARCHY_CONTINUATION_EXPIRED", "Continuation has expired", 410);
    }
    let replacement: { token: string; document: HierarchyContinuationDocument } | undefined;
    if (state.frontier.length) {
      const nextDocument = { ...document, stateJson: JSON.stringify(state) };
      assertHierarchyContinuationCapacity(nextDocument);
      replacement = { token: randomUUID(), document: nextDocument };
    }
    // No result escapes until conditional atomic advancement has succeeded.
    await repository.advanceContinuation(current, replacement);
    return { representatives, ...(replacement ? { continuationToken: replacement.token } : {}), workUnits };
  } catch (error) {
    if (current && error instanceof OrganizationalHierarchyError && error.code === "HIERARCHY_MALFORMED") {
      await repository.advanceContinuation(current, undefined);
    }
    throw error;
  }
}

function departmentFamily(user: OrganizationalUser): string {
  const explicit = String(user.department || "").trim().toLowerCase();
  if (explicit) return explicit;
  const role = user.role.toLowerCase();
  if (role.includes("medical")) return "medical";
  if (role.includes("sales") || role.includes("commercial")) return "sales";
  if (role.includes("marketing") || role.includes("product")) return "marketing";
  if (role.includes("finance") || role.includes("treasury")) return "finance";
  if (role.includes("warehouse") || role.includes("store") || role.includes("inventory")) return "warehouse";
  return "enterprise";
}

function inActorPolicy(
  actor: OrganizationalUser,
  target: OrganizationalUser,
  request: OrganizationalScopeRequest,
  policy: CanonicalRoleScopePolicy,
): boolean {
  const departmentRestricted = !policy.crossDepartment || request.departmentScope === "actor";
  if (departmentRestricted && departmentFamily(actor) !== departmentFamily(target)) return false;
  // Geography authorization is deliberately deferred to canonical territory
  // assignments. Profile/display country strings never widen hierarchy scope.
  return true;
}

function sortUsers(users: OrganizationalUser[]): OrganizationalUser[] {
  return [...users].sort((a, b) => a.id.localeCompare(b.id));
}

export async function resolveOrganizationalScope(
  verifiedActorUid: string | null | undefined,
  request: OrganizationalScopeRequest,
  repository: OrganizationalHierarchyRepository,
): Promise<OrganizationalScopeResult> {
  if (!verifiedActorUid) throw new OrganizationalHierarchyError("UNAUTHENTICATED", 401, "Authentication is required");
  if (request.actorUid && request.actorUid !== verifiedActorUid) {
    throw new OrganizationalHierarchyError("ACTOR_UID_MISMATCH", 403, "Requested actor does not match authenticated actor");
  }

  const actor = await repository.getUser(verifiedActorUid);
  if (!actor) throw new OrganizationalHierarchyError("ACTOR_NOT_FOUND", 403, "Authenticated user profile not found");
  if (!active(actor)) throw new OrganizationalHierarchyError("ACTOR_INACTIVE", 403, "Inactive actor cannot discover hierarchy");

  const [permissions, governance] = await Promise.all([
    repository.getRolePermissions(actor.role),
    repository.getAccessGovernance?.(actor.role) || Promise.resolve(null),
  ]);
  const scopePolicy = resolveRoleScopePolicy(
    actor.role,
    governance?.active === true ? governance.scopePolicy : null,
  );
  if (!scopePolicy) {
    throw new OrganizationalHierarchyError("ROLE_SCOPE_POLICY_INVALID", 403, "Canonical role scope policy is missing or invalid");
  }

  const depth = request.depth || scopePolicy.hierarchyDepth;
  const includeSelf = request.includeSelf !== false;
  const global = scopePolicy.subjectMode === "ORGANIZATION";
  const enumeratesOtherSubjects = depth !== "self"
    && (scopePolicy.subjectMode === "HIERARCHY" || scopePolicy.subjectMode === "ORGANIZATION");
  if (enumeratesOtherSubjects && permissions?.viewTeamData === false) {
    throw new OrganizationalHierarchyError("HIERARCHY_PERMISSION_DENIED", 403, "Role permission denies team hierarchy visibility");
  }
  const includeInactive = request.includeInactive === true && global;
  if (!global && depth !== "self" && !scopePolicy.descendantsContribute) {
    throw new OrganizationalHierarchyError("SUBORDINATE_ENUMERATION_DENIED", 403, "Actor role cannot enumerate subordinates");
  }

  let candidates: OrganizationalUser[] = [];
  let rawDirectIds = new Set<string>();
  if (depth !== "self") {
    if (global) {
      candidates = await repository.getAllUsers();
      rawDirectIds = new Set(candidates.filter((user) => user.managerId === actor.id).map((user) => user.id));
    } else {
      const queue = [actor.id];
      const expanded = new Set<string>();
      const discovered = new Set<string>([actor.id]);
      while (queue.length) {
        const managerUid = queue.shift()!;
        if (expanded.has(managerUid)) continue;
        expanded.add(managerUid);
        const reports = sortUsers(await repository.getDirectReports(managerUid));
        for (const report of reports) {
          if (!report.id || discovered.has(report.id)) continue;
          // An inactive relationship endpoint is neither visible nor a bridge
          // to otherwise active descendants.
          if (!active(report)) continue;
          discovered.add(report.id);
          candidates.push(report);
          if (managerUid === actor.id) rawDirectIds.add(report.id);
          if (depth === "descendants" && resolveRoleScopePolicy(report.role)?.descendantsContribute) queue.push(report.id);
        }
        if (depth === "direct") break;
      }
    }
  }

  const visible = sortUsers(candidates.filter((user) =>
    user.id !== actor.id && (includeInactive || active(user)) && inActorPolicy(actor, user, request, scopePolicy),
  ));
  const directReports = visible.filter((user) => rawDirectIds.has(user.id));
  const allHierarchyUsers = sortUsers(includeSelf ? [actor, ...visible] : visible);
  return {
    actor,
    directReports,
    descendants: visible,
    allHierarchyUsers,
    directReportUids: directReports.map((user) => user.id),
    descendantUids: visible.map((user) => user.id),
    allHierarchyUids: allHierarchyUsers.map((user) => user.id),
    scopePolicy,
  };
}
