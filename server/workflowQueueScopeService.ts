import type {
  WorkflowGeographyCatalog,
  WorkflowGeographyRecord,
  WorkflowQueueActor,
  WorkflowQueueScopeRepository,
} from "./workflowQueueScopeRepository";

export type WorkflowQueueResource = "orders";
export type WorkflowQueueStatus = "FINANCE_APPROVED" | "PENDING_OPERATIONS_REVIEW";

export type WorkflowQueueScopeDenialCode =
  | "ACTOR_NOT_FOUND"
  | "ACTOR_INACTIVE"
  | "UNSUPPORTED_ROLE"
  | "UNSUPPORTED_RESOURCE"
  | "MISSING_CONFIGURED_GEOGRAPHY"
  | "INVALID_CONFIGURED_GEOGRAPHY"
  | "NO_ACTIVE_AREAS"
  | "NO_ALLOWED_STATUSES"
  | "MALFORMED_REQUEST"
  | "REPOSITORY_FAILURE";

export interface WorkflowQueueQueryPlan {
  denyAll: boolean;
  areaIdChunks: string[][];
  workflowStatusChunks: WorkflowQueueStatus[][];
  dateRangeRequired: true;
  requiresBoundedPharmacyResolution: true;
}

export interface WorkflowQueueScope {
  authorized: boolean;
  code?: WorkflowQueueScopeDenialCode;
  actorUid?: string;
  role?: string;
  authorityKind?: "WORKFLOW_QUEUE";
  resource?: WorkflowQueueResource;
  crossSubjectRecords: boolean;
  configuredBoundary?: { kind: "COUNTRY"; countryIds: string[] };
  countryIds: string[];
  areaIds: string[];
  allowedStatuses: WorkflowQueueStatus[];
  queryPlan: WorkflowQueueQueryPlan;
}

export interface WorkflowQueueScopeRequest {
  resource: string;
  statuses?: unknown;
}

interface WorkflowQueuePolicy {
  role: "Order Operations Officer";
  resource: "orders";
  boundaryKind: "COUNTRY";
  crossSubjectRecords: true;
  allowedStatuses: readonly WorkflowQueueStatus[];
}

const ORDER_OPERATIONS_POLICY: WorkflowQueuePolicy = Object.freeze({
  role: "Order Operations Officer",
  resource: "orders",
  boundaryKind: "COUNTRY",
  crossSubjectRecords: true,
  allowedStatuses: Object.freeze<WorkflowQueueStatus[]>(["FINANCE_APPROVED", "PENDING_OPERATIONS_REVIEW"]),
});

const POLICY_REGISTRY: ReadonlyMap<string, WorkflowQueuePolicy> = new Map([
  [`${ORDER_OPERATIONS_POLICY.role}:${ORDER_OPERATIONS_POLICY.resource}`, ORDER_OPERATIONS_POLICY],
]);

const CHUNK_SIZE = 30;
const COUNTRY_BOUNDARY_SCOPE_VALUES = new Set(["country", "national"]);

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function sortedUnique<T extends string>(values: Iterable<T>): T[] {
  return Array.from(new Set(Array.from(values, text).filter(Boolean) as T[]))
    .sort((a, b) => a.localeCompare(b));
}

function chunks<T>(values: T[]): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += CHUNK_SIZE) {
    result.push(values.slice(index, index + CHUNK_SIZE));
  }
  return result;
}

function emptyPlan(): WorkflowQueueQueryPlan {
  return {
    denyAll: true,
    areaIdChunks: [],
    workflowStatusChunks: [],
    dateRangeRequired: true,
    requiresBoundedPharmacyResolution: true,
  };
}

function denial(
  code: WorkflowQueueScopeDenialCode,
  actorUid?: string,
): WorkflowQueueScope {
  return {
    authorized: false,
    code,
    actorUid,
    crossSubjectRecords: false,
    countryIds: [],
    areaIds: [],
    allowedStatuses: [],
    queryPlan: emptyPlan(),
  };
}

function inactive(record: WorkflowQueueActor | WorkflowGeographyRecord): boolean {
  return record.active === false
    || record.status === "Inactive"
    || ("loginAllowed" in record && record.loginAllowed === false)
    || ("isDeleted" in record && record.isDeleted === true)
    || ("employmentStatus" in record && ["Inactive", "Archived", "Suspended"].includes(record.employmentStatus || ""))
    || ("accountStatus" in record && record.accountStatus === "INACTIVE");
}

function canonicalCountry(actor: WorkflowQueueActor, catalog: WorkflowGeographyCatalog): WorkflowGeographyRecord | null {
  const rawCountries = Array.isArray(actor.assignedCountries) && actor.assignedCountries.length > 0
    ? actor.assignedCountries.map(text).filter(Boolean)
    : [text(actor.country)].filter(Boolean);
  if (rawCountries.length !== 1) return null;
  const needle = rawCountries[0].toLocaleLowerCase();
  const matches = catalog.countries.filter((country) => [country.id, country.name, country.code]
    .map((candidate) => text(candidate).toLocaleLowerCase())
    .filter(Boolean)
    .includes(needle));
  return matches.length === 1 ? matches[0] : null;
}

function activeCanonicalAreaIds(countryId: string, catalog: WorkflowGeographyCatalog): string[] {
  const districtById = new Map(catalog.districts.map((item) => [item.id, item]));
  const cityById = new Map(catalog.cities.map((item) => [item.id, item]));
  return sortedUnique(catalog.areas.filter((area) => {
    if (inactive(area) || text(area.countryId) !== countryId) return false;
    const district = districtById.get(text(area.districtId));
    const city = cityById.get(text(area.cityId));
    return Boolean(
      district && !inactive(district)
      && city && !inactive(city)
      && text(district.countryId) === countryId
      && text(city.countryId) === countryId
      && text(city.districtId) === text(area.districtId),
    );
  }).map((area) => area.id));
}

function requestedStatuses(
  request: WorkflowQueueScopeRequest,
  policy: WorkflowQueuePolicy,
): WorkflowQueueStatus[] | null {
  if (request.statuses === undefined) return [...policy.allowedStatuses];
  if (!Array.isArray(request.statuses) || request.statuses.some((value) => typeof value !== "string")) return null;
  const requested = sortedUnique(request.statuses as string[]);
  if (requested.some((status) => !policy.allowedStatuses.includes(status as WorkflowQueueStatus))) return null;
  return requested as WorkflowQueueStatus[];
}

export async function resolveWorkflowQueueScope(
  authenticatedActorUid: string,
  request: WorkflowQueueScopeRequest,
  repository: WorkflowQueueScopeRepository,
): Promise<WorkflowQueueScope> {
  const actorUid = text(authenticatedActorUid);
  if (!actorUid || !request || typeof request.resource !== "string") return denial("MALFORMED_REQUEST", actorUid || undefined);
  try {
    const actor = await repository.getActor(actorUid);
    if (!actor) return denial("ACTOR_NOT_FOUND", actorUid);
    if (inactive(actor)) return denial("ACTOR_INACTIVE", actorUid);

    const role = text(actor.role);
    const policy = POLICY_REGISTRY.get(`${role}:${request.resource}`);
    if (!policy) {
      return denial(role === ORDER_OPERATIONS_POLICY.role ? "UNSUPPORTED_RESOURCE" : "UNSUPPORTED_ROLE", actorUid);
    }
    if (!COUNTRY_BOUNDARY_SCOPE_VALUES.has(text(actor.securityScope).toLocaleLowerCase())) {
      return denial("INVALID_CONFIGURED_GEOGRAPHY", actorUid);
    }

    const statuses = requestedStatuses(request, policy);
    if (statuses === null) return denial("MALFORMED_REQUEST", actorUid);
    if (statuses.length === 0) return denial("NO_ALLOWED_STATUSES", actorUid);

    const catalog = await repository.getGeographyCatalog();
    const configuredCountry = canonicalCountry(actor, catalog);
    if (!text(actor.country) && (!actor.assignedCountries || actor.assignedCountries.length === 0)) {
      return denial("MISSING_CONFIGURED_GEOGRAPHY", actorUid);
    }
    if (!configuredCountry || inactive(configuredCountry)) return denial("INVALID_CONFIGURED_GEOGRAPHY", actorUid);
    const areaIds = activeCanonicalAreaIds(configuredCountry.id, catalog);
    if (areaIds.length === 0) return denial("NO_ACTIVE_AREAS", actorUid);

    return {
      authorized: true,
      actorUid,
      role: policy.role,
      authorityKind: "WORKFLOW_QUEUE",
      resource: policy.resource,
      crossSubjectRecords: policy.crossSubjectRecords,
      configuredBoundary: { kind: policy.boundaryKind, countryIds: [configuredCountry.id] },
      countryIds: [configuredCountry.id],
      areaIds,
      allowedStatuses: statuses,
      queryPlan: {
        denyAll: false,
        areaIdChunks: chunks(areaIds),
        workflowStatusChunks: chunks(statuses),
        dateRangeRequired: true,
        requiresBoundedPharmacyResolution: true,
      },
    };
  } catch {
    return denial("REPOSITORY_FAILURE", actorUid);
  }
}
