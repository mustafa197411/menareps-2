import { CANONICAL_USER_ROLES } from "../src/types";

export type OperationalBoundaryKind = "AREA" | "COUNTRY" | "REGION" | "GLOBAL";
export type OperationalSubjectMode = "SELF" | "HIERARCHY" | "ORGANIZATION" | "FUNCTIONAL";

export interface ConfiguredGeographyBoundary {
  kind: OperationalBoundaryKind;
  countryIds: string[];
  regionIds: string[];
  areaIds: string[];
}

export interface OperationalActor {
  id: string;
  uid?: string;
  role: string;
  active?: boolean;
  loginAllowed?: boolean;
  isDeleted?: boolean;
  status?: string;
  employmentStatus?: string;
  accountStatus?: string;
  configuredBoundary?: ConfiguredGeographyBoundary;
}

export interface OperationalTerritoryAssignment {
  assignmentId: string;
  userId: string;
  status: string;
  active?: boolean;
  effectiveFrom?: string;
  effectiveTo?: string;
  countryId?: string;
  regionId?: string;
  districtId?: string;
  cityId?: string;
  territoryId?: string;
  territoryName?: string;
  areaId?: string;
}

export interface OperationalProductAssignment {
  assignmentId: string;
  userId: string;
  productId: string;
  productGroupId?: string;
  status: string;
  active?: boolean;
  effectiveFrom?: string;
  effectiveTo?: string;
}

export interface CanonicalGeographyNode {
  countryId: string;
  regionId: string;
  districtId?: string;
  cityId?: string;
  areaId: string;
  active: boolean;
}

export interface OperationalHierarchyInput {
  mode: OperationalSubjectMode;
  actorUid: string;
  directReportUids: string[];
  descendantUids: string[];
  allowedSubjectUids: string[];
  /** Active Medical Representative UIDs already proven by the canonical hierarchy. */
  authorizedRepresentativeUids?: string[];
  productScopeRequired?: boolean;
}

export interface OperationalQueryPlan {
  denyAll: boolean;
  areaIdChunks: string[][];
  subjectUidChunks: string[][];
  productIdChunks: string[][];
  requiresPostFilter: boolean;
}

export interface OperationalScopeDiagnostics {
  excludedAssignmentIds: string[];
  malformedAssignmentIds: string[];
  outsideBoundaryAssignmentIds: string[];
}

export type OperationalScopeDenialCode =
  | "UNAUTHENTICATED"
  | "ACTOR_UID_MISMATCH"
  | "ACTOR_NOT_FOUND"
  | "ACTOR_INACTIVE"
  | "UNSUPPORTED_ROLE"
  | "MISSING_CONFIGURED_GEOGRAPHY"
  | "INVALID_CONFIGURED_GEOGRAPHY"
  | "NO_ACTIVE_ASSIGNMENTS"
  | "NO_ACTIVE_PRODUCT_ASSIGNMENTS"
  | "NO_ASSIGNMENTS_WITHIN_BOUNDARY"
  | "HIERARCHY_DENIED"
  | "MALFORMED_INPUT";

export interface EffectiveOperationalScope {
  authorized: boolean;
  code?: OperationalScopeDenialCode;
  actorUid?: string;
  role?: string;
  boundaryKind?: OperationalBoundaryKind;
  subjectMode?: OperationalSubjectMode;
  subjectUids: string[];
  /** Resource-ready representative owners; never inferred from names, email, or Area. */
  authorizedRepresentativeUids?: string[];
  countryIds: string[];
  regionIds: string[];
  districtIds: string[];
  cityIds: string[];
  areaIds: string[];
  productIds: string[];
  productGroupIds: string[];
  queryPlan: OperationalQueryPlan;
  diagnostics: OperationalScopeDiagnostics;
}

export interface ResolveOperationalScopeInput {
  authenticatedActorUid: string | null | undefined;
  requestedActorUid?: string | null;
  actor: OperationalActor | null;
  now: string;
  geographyRegistry: CanonicalGeographyNode[];
  territoryAssignments: OperationalTerritoryAssignment[];
  productAssignments: OperationalProductAssignment[];
  hierarchy: OperationalHierarchyInput;
}

export class OperationalScopeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "OperationalScopeError";
  }
}

const SUPPORTED_ROLES = new Set<string>(CANONICAL_USER_ROLES);
const VALID_BOUNDARY_KINDS = new Set<OperationalBoundaryKind>(["AREA", "COUNTRY", "REGION", "GLOBAL"]);
const EMPTY_DIAGNOSTICS: OperationalScopeDiagnostics = {
  excludedAssignmentIds: [],
  malformedAssignmentIds: [],
  outsideBoundaryAssignmentIds: [],
};

function normalizedId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function canonicalAreaIdForTerritoryAssignment(
  assignment: Pick<OperationalTerritoryAssignment, "areaId" | "territoryId">,
): string {
  return normalizedId(assignment.areaId) || normalizedId(assignment.territoryId);
}

function sortedUnique(values: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(values, normalizedId).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function chunks(values: string[], size = 30): string[][] {
  const result: string[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function emptyQueryPlan(): OperationalQueryPlan {
  return {
    denyAll: true,
    areaIdChunks: [],
    subjectUidChunks: [],
    productIdChunks: [],
    requiresPostFilter: true,
  };
}

function denial(code: OperationalScopeDenialCode, actorUid?: string): EffectiveOperationalScope {
  return {
    authorized: false,
    code,
    actorUid,
    subjectUids: [],
    authorizedRepresentativeUids: [],
    countryIds: [],
    regionIds: [],
    districtIds: [],
    cityIds: [],
    areaIds: [],
    productIds: [],
    productGroupIds: [],
    queryPlan: emptyQueryPlan(),
    diagnostics: { ...EMPTY_DIAGNOSTICS },
  };
}

function actorIsInactive(actor: OperationalActor): boolean {
  const inactiveStates = new Set(["Inactive", "Archived", "Suspended"]);
  return actor.active === false
    || actor.loginAllowed === false
    || actor.isDeleted === true
    || inactiveStates.has(actor.status || "")
    || inactiveStates.has(actor.employmentStatus || "")
    || actor.accountStatus === "INACTIVE";
}

function validCanonicalNode(node: CanonicalGeographyNode): boolean {
  return node.active === true
    && Boolean(normalizedId(node.countryId))
    && Boolean(normalizedId(node.regionId))
    && Boolean(normalizedId(node.districtId))
    && Boolean(normalizedId(node.cityId))
    && Boolean(normalizedId(node.areaId));
}

function activeAt(
  record: { status: string; active?: boolean; effectiveFrom?: string; effectiveTo?: string },
  nowMs: number,
): boolean {
  if (record.status !== "Active" || record.active === false) return false;
  if (record.effectiveFrom) {
    const from = Date.parse(record.effectiveFrom);
    if (!Number.isFinite(from) || from > nowMs) return false;
  }
  if (record.effectiveTo) {
    const to = Date.parse(record.effectiveTo);
    if (!Number.isFinite(to) || to < nowMs) return false;
  }
  return true;
}

function canonicalAssignmentNode(
  assignment: OperationalTerritoryAssignment,
  nodesByArea: Map<string, CanonicalGeographyNode[]>,
): CanonicalGeographyNode | null {
  const areaId = canonicalAreaIdForTerritoryAssignment(assignment);
  if (!areaId) return null;
  const matches = nodesByArea.get(areaId) || [];
  if (matches.length !== 1 || !validCanonicalNode(matches[0])) return null;
  const node = matches[0];
  const suppliedAncestry: Array<[unknown, string | undefined]> = [
    [assignment.countryId, node.countryId],
    [assignment.regionId, node.regionId],
    [assignment.districtId, node.districtId],
    [assignment.cityId, node.cityId],
  ];
  if (suppliedAncestry.some(([supplied, canonical]) => normalizedId(supplied) && normalizedId(supplied) !== normalizedId(canonical))) {
    return null;
  }
  return node;
}

function insideBoundary(node: CanonicalGeographyNode, boundary: ConfiguredGeographyBoundary): boolean {
  const countries = new Set(sortedUnique(boundary.countryIds || []));
  const regions = new Set(sortedUnique(boundary.regionIds || []));
  const areas = new Set(sortedUnique(boundary.areaIds || []));
  switch (boundary.kind) {
    case "AREA":
      return areas.has(node.areaId);
    case "COUNTRY":
      return countries.has(node.countryId);
    case "REGION":
      return countries.has(node.countryId) && regions.has(node.regionId);
    case "GLOBAL":
      return countries.has(node.countryId)
        && (regions.size === 0 || regions.has(node.regionId))
        && (areas.size === 0 || areas.has(node.areaId));
  }
}

function validateBoundary(
  boundary: ConfiguredGeographyBoundary,
  registry: CanonicalGeographyNode[],
): OperationalScopeDenialCode | null {
  if (!VALID_BOUNDARY_KINDS.has(boundary.kind)) return "INVALID_CONFIGURED_GEOGRAPHY";
  const countries = sortedUnique(boundary.countryIds || []);
  const regions = sortedUnique(boundary.regionIds || []);
  const areas = sortedUnique(boundary.areaIds || []);
  if (boundary.kind === "AREA" && areas.length === 0) return "MISSING_CONFIGURED_GEOGRAPHY";
  if (boundary.kind === "COUNTRY" && countries.length === 0) return "MISSING_CONFIGURED_GEOGRAPHY";
  if (boundary.kind === "REGION" && regions.length === 0) return "MISSING_CONFIGURED_GEOGRAPHY";
  if (boundary.kind === "REGION" && countries.length === 0) return "INVALID_CONFIGURED_GEOGRAPHY";
  if (boundary.kind === "GLOBAL" && countries.length === 0) return "MISSING_CONFIGURED_GEOGRAPHY";
  const areaMatches = (areaId: string) => registry.filter((node) => normalizedId(node.areaId) === areaId);
  if (areas.some((areaId) => {
    const matches = areaMatches(areaId);
    return matches.length !== 1 || !validCanonicalNode(matches[0]);
  })) return "INVALID_CONFIGURED_GEOGRAPHY";

  const validNodes = registry.filter(validCanonicalNode);
  if (countries.some((countryId) => !validNodes.some((node) => node.countryId === countryId))) {
    return "INVALID_CONFIGURED_GEOGRAPHY";
  }
  if (regions.some((regionId) => {
    const matchingNodes = validNodes.filter((node) => node.regionId === regionId);
    return matchingNodes.length === 0
      || (countries.length > 0 && !matchingNodes.some((node) => countries.includes(node.countryId)));
  })) return "INVALID_CONFIGURED_GEOGRAPHY";
  return null;
}

export function resolveOperationalScope(input: ResolveOperationalScopeInput): EffectiveOperationalScope {
  if (!input || !Array.isArray(input.geographyRegistry)) {
    throw new OperationalScopeError("MALFORMED_INPUT", "A canonical geography registry array is required");
  }
  const authenticatedActorUid = normalizedId(input.authenticatedActorUid);
  if (!authenticatedActorUid) return denial("UNAUTHENTICATED");
  if (normalizedId(input.requestedActorUid) && normalizedId(input.requestedActorUid) !== authenticatedActorUid) {
    return denial("ACTOR_UID_MISMATCH", authenticatedActorUid);
  }
  if (!input.actor) return denial("ACTOR_NOT_FOUND", authenticatedActorUid);
  const actor = input.actor;
  if (normalizedId(actor.id) !== authenticatedActorUid) return denial("ACTOR_UID_MISMATCH", authenticatedActorUid);
  if (actorIsInactive(actor)) return denial("ACTOR_INACTIVE", authenticatedActorUid);
  if (!SUPPORTED_ROLES.has(actor.role)) return denial("UNSUPPORTED_ROLE", authenticatedActorUid);
  if (!actor.configuredBoundary) return denial("MISSING_CONFIGURED_GEOGRAPHY", authenticatedActorUid);

  const boundaryError = validateBoundary(actor.configuredBoundary, input.geographyRegistry);
  if (boundaryError) return denial(boundaryError, authenticatedActorUid);

  const nowMs = Date.parse(input.now);
  if (!Number.isFinite(nowMs) || !Array.isArray(input.territoryAssignments) || !Array.isArray(input.productAssignments) || !input.hierarchy) {
    throw new OperationalScopeError("MALFORMED_INPUT", "Operational scope input is structurally invalid");
  }

  const subjectMode: OperationalSubjectMode = input.hierarchy.mode;
  const subjectUids = subjectMode === "SELF"
    || subjectMode === "FUNCTIONAL"
    ? [authenticatedActorUid]
    : sortedUnique([authenticatedActorUid, ...(input.hierarchy.allowedSubjectUids || [])]);
  const allowedSubjects = new Set(subjectUids);

  const excludedAssignmentIds: string[] = [];
  const malformedAssignmentIds: string[] = [];
  const outsideBoundaryAssignmentIds: string[] = [];
  const activeAllowedAssignments: OperationalTerritoryAssignment[] = [];
  for (const assignment of input.territoryAssignments) {
    if (!allowedSubjects.has(normalizedId(assignment.userId))) {
      excludedAssignmentIds.push(assignment.assignmentId);
      continue;
    }
    if (activeAt(assignment, nowMs)) activeAllowedAssignments.push(assignment);
  }
  if (activeAllowedAssignments.length === 0) return denial("NO_ACTIVE_ASSIGNMENTS", authenticatedActorUid);

  const nodesByArea = new Map<string, CanonicalGeographyNode[]>();
  for (const node of input.geographyRegistry) {
    const key = normalizedId(node.areaId);
    if (!nodesByArea.has(key)) nodesByArea.set(key, []);
    nodesByArea.get(key)!.push(node);
  }

  const retainedNodes: CanonicalGeographyNode[] = [];
  for (const assignment of activeAllowedAssignments) {
    const node = canonicalAssignmentNode(assignment, nodesByArea);
    if (!node) {
      malformedAssignmentIds.push(assignment.assignmentId);
      continue;
    }
    if (!insideBoundary(node, actor.configuredBoundary)) {
      outsideBoundaryAssignmentIds.push(assignment.assignmentId);
      continue;
    }
    retainedNodes.push(node);
  }
  if (retainedNodes.length === 0) return denial("NO_ASSIGNMENTS_WITHIN_BOUNDARY", authenticatedActorUid);

  const productIds: string[] = [];
  const productGroupIds: string[] = [];
  for (const product of input.productAssignments) {
    if (!allowedSubjects.has(normalizedId(product.userId)) || !activeAt(product, nowMs)) continue;
    const productId = normalizedId(product.productId);
    if (!productId) continue;
    productIds.push(productId);
    const productGroupId = normalizedId(product.productGroupId);
    if (productGroupId) productGroupIds.push(productGroupId);
  }

  const effectiveAreaIds = sortedUnique(retainedNodes.map((node) => node.areaId));
  const effectiveSubjectUids = sortedUnique(subjectUids);
  const authorizedRepresentativeUids = sortedUnique(input.hierarchy.authorizedRepresentativeUids || [])
    .filter((uid) => allowedSubjects.has(uid));
  const effectiveProductIds = sortedUnique(productIds);
  if (input.hierarchy.productScopeRequired === true && effectiveProductIds.length === 0) {
    return denial("NO_ACTIVE_PRODUCT_ASSIGNMENTS", authenticatedActorUid);
  }
  return {
    authorized: true,
    actorUid: authenticatedActorUid,
    role: actor.role,
    boundaryKind: actor.configuredBoundary.kind,
    subjectMode,
    subjectUids: effectiveSubjectUids,
    authorizedRepresentativeUids,
    countryIds: sortedUnique(retainedNodes.map((node) => node.countryId)),
    regionIds: sortedUnique(retainedNodes.map((node) => node.regionId)),
    districtIds: sortedUnique(retainedNodes.map((node) => node.districtId || "")),
    cityIds: sortedUnique(retainedNodes.map((node) => node.cityId || "")),
    areaIds: effectiveAreaIds,
    productIds: effectiveProductIds,
    productGroupIds: sortedUnique(productGroupIds),
    queryPlan: {
      denyAll: false,
      areaIdChunks: chunks(effectiveAreaIds),
      subjectUidChunks: chunks(effectiveSubjectUids),
      productIdChunks: chunks(effectiveProductIds),
      requiresPostFilter: true,
    },
    diagnostics: {
      excludedAssignmentIds: sortedUnique(excludedAssignmentIds),
      malformedAssignmentIds: sortedUnique(malformedAssignmentIds),
      outsideBoundaryAssignmentIds: sortedUnique(outsideBoundaryAssignmentIds),
    },
  };
}
