import type { Physician, PhysicianVisit } from "../src/types";
import { getFirebaseAdminServices } from "./firebaseAdmin";
import {
  createFirestoreOperationalScopeRepository,
  resolveOperationalScopeForActor,
  type OperationalScopeRepository,
} from "./operationalScopeRepository";
import type { EffectiveOperationalScope } from "./operationalScopeService";
import {
  createFirestorePhysicianReadRepository,
  filterPhysiciansWithinOperationalScope,
  type PhysicianReadRepository,
} from "./physicianReadService";

export type PhysicianHistoryScopeMode = "SELF" | "TEAM" | "ORGANIZATION";

export interface PhysicianVisitHistoryRequest {
  physicianIds: string[];
  subjectUid?: string;
  includeHistory: boolean;
}

export interface ScopedPhysicianVisitSummary {
  physicianId: string;
  scopeMode: PhysicianHistoryScopeMode;
  subjectUids: string[];
  lastVisit: PhysicianVisit | null;
  totalCompletedVisits: number;
  currentMonthCompletedVisits: number;
  visits?: PhysicianVisit[];
}

export interface ScopedPhysicianVisitHistoryResult {
  authorized: boolean;
  code?: string;
  scopeMode?: PhysicianHistoryScopeMode;
  summaries: ScopedPhysicianVisitSummary[];
}

export interface PhysicianVisitHistoryRepository {
  queryByPhysicianAndSubjectUids(physicianId: string, subjectUids: string[]): Promise<PhysicianVisit[]>;
}

const MAX_PHYSICIANS_PER_REQUEST = 100;
const MAX_SUBJECTS_PER_QUERY = 30;

const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const canonicalIds = (values: unknown): string[] => Array.isArray(values)
  ? Array.from(new Set(values.map(text).filter(Boolean))).sort((a, b) => a.localeCompare(b))
  : [];

export function parsePhysicianVisitHistoryRequest(value: unknown): PhysicianVisitHistoryRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !["physicianIds", "subjectUid", "includeHistory"].includes(key))) return null;
  const physicianIds = canonicalIds(input.physicianIds);
  if (physicianIds.length === 0 || physicianIds.length > MAX_PHYSICIANS_PER_REQUEST) return null;
  const subjectUid = input.subjectUid === undefined ? "" : text(input.subjectUid);
  if (input.subjectUid !== undefined && !subjectUid) return null;
  const includeHistory = input.includeHistory === true;
  if (includeHistory && physicianIds.length !== 1) return null;
  return { physicianIds, ...(subjectUid ? { subjectUid } : {}), includeHistory };
}

function completed(visit: PhysicianVisit): boolean {
  return text(visit.status).toLowerCase() === "completed";
}

function authoritativeVisitTime(visit: PhysicianVisit): number {
  const candidates = [visit.completedAt, visit.visitDate && `${visit.visitDate}T${text((visit as any).visitTime) || "00:00:00"}Z`, visit.createdAt];
  for (const candidate of candidates) {
    const timestamp = candidate ? Date.parse(candidate) : Number.NaN;
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return Number.NEGATIVE_INFINITY;
}

export function sortCompletedPhysicianVisits(visits: PhysicianVisit[]): PhysicianVisit[] {
  const byId = new Map<string, PhysicianVisit>();
  visits.forEach((visit) => {
    const id = text(visit.id);
    if (id && text(visit.repId) && text(visit.physicianId) && completed(visit)) byId.set(id, visit);
  });
  return [...byId.values()].sort((left, right) =>
    authoritativeVisitTime(right) - authoritativeVisitTime(left) || left.id.localeCompare(right.id));
}

export function resolvePhysicianHistorySubjects(
  scope: EffectiveOperationalScope,
  requestedSubjectUid?: string,
): { mode: PhysicianHistoryScopeMode; subjectUids: string[] } | null {
  if (!scope.authorized || scope.queryPlan.denyAll || !scope.actorUid) return null;
  const representatives = canonicalIds(scope.authorizedRepresentativeUids);
  const actorIsRepresentative = text(scope.role) === "Medical Representative";
  const authorizedRepresentatives = representatives.length > 0
    ? representatives
    : actorIsRepresentative ? [scope.actorUid] : [];

  let mode: PhysicianHistoryScopeMode;
  if (scope.subjectMode === "SELF") mode = "SELF";
  else if (scope.subjectMode === "HIERARCHY") mode = "TEAM";
  else if (scope.subjectMode === "ORGANIZATION") mode = "ORGANIZATION";
  else return null;

  if (mode === "SELF") {
    if (!actorIsRepresentative || requestedSubjectUid && requestedSubjectUid !== scope.actorUid) return null;
    return { mode, subjectUids: [scope.actorUid] };
  }
  if (requestedSubjectUid) {
    return authorizedRepresentatives.includes(requestedSubjectUid)
      ? { mode, subjectUids: [requestedSubjectUid] }
      : null;
  }
  return authorizedRepresentatives.length > 0 ? { mode, subjectUids: authorizedRepresentatives } : null;
}

export function createFirestorePhysicianVisitHistoryRepository(): PhysicianVisitHistoryRepository {
  return {
    async queryByPhysicianAndSubjectUids(physicianId, subjectUids) {
      const subjects = canonicalIds(subjectUids);
      if (!text(physicianId) || subjects.length === 0 || subjects.length > MAX_SUBJECTS_PER_QUERY) {
        throw new Error("Physician history query requires one physician and 1-30 canonical representative UIDs");
      }
      const { db } = getFirebaseAdminServices();
      const snapshot = await db.collection("physicianVisits")
        .where("physicianId", "==", physicianId)
        .where("repId", "in", subjects)
        .get();
      return snapshot.docs.map((document) => ({ id: document.id, ...document.data() } as PhysicianVisit));
    },
  };
}

export async function resolveScopedPhysicianVisitHistory(
  authenticatedActorUid: string,
  request: PhysicianVisitHistoryRequest,
  dependencies: {
    operationalScopeRepository?: OperationalScopeRepository;
    physicianReadRepository?: PhysicianReadRepository;
    historyRepository?: PhysicianVisitHistoryRepository;
    now?: Date;
  } = {},
): Promise<ScopedPhysicianVisitHistoryResult> {
  const scope = await resolveOperationalScopeForActor(
    authenticatedActorUid,
    {},
    dependencies.operationalScopeRepository || createFirestoreOperationalScopeRepository(),
  );
  const subjects = resolvePhysicianHistorySubjects(scope, request.subjectUid);
  if (!subjects) return { authorized: false, code: "PHYSICIAN_HISTORY_SUBJECT_SCOPE_DENIED", summaries: [] };

  const physicianRepository = dependencies.physicianReadRepository || createFirestorePhysicianReadRepository();
  const scopedPhysicians = filterPhysiciansWithinOperationalScope(
    (await Promise.all(scope.queryPlan.areaIdChunks.map((chunk) => physicianRepository.queryByAreaIds(chunk)))).flat(),
    scope,
  );
  const authorizedPhysicianIds = new Set(scopedPhysicians.map((physician: Physician) => physician.id));
  if (request.physicianIds.some((id) => !authorizedPhysicianIds.has(id))) {
    return { authorized: false, code: "PHYSICIAN_HISTORY_PHYSICIAN_SCOPE_DENIED", summaries: [] };
  }

  const historyRepository = dependencies.historyRepository || createFirestorePhysicianVisitHistoryRepository();
  const subjectChunks: string[][] = [];
  for (let index = 0; index < subjects.subjectUids.length; index += MAX_SUBJECTS_PER_QUERY) {
    subjectChunks.push(subjects.subjectUids.slice(index, index + MAX_SUBJECTS_PER_QUERY));
  }
  const now = dependencies.now || new Date();
  const currentMonth = now.toISOString().slice(0, 7);
  const summaries = await Promise.all(request.physicianIds.map(async (physicianId) => {
    const queried = (await Promise.all(subjectChunks.map((chunk) =>
      historyRepository.queryByPhysicianAndSubjectUids(physicianId, chunk)))).flat();
    const visits = sortCompletedPhysicianVisits(queried).filter((visit) =>
      visit.physicianId === physicianId && subjects.subjectUids.includes(visit.repId));
    return {
      physicianId,
      scopeMode: subjects.mode,
      subjectUids: [...subjects.subjectUids],
      lastVisit: visits[0] || null,
      totalCompletedVisits: visits.length,
      currentMonthCompletedVisits: visits.filter((visit) => visit.visitDate.startsWith(currentMonth)).length,
      ...(request.includeHistory ? { visits } : {}),
    } satisfies ScopedPhysicianVisitSummary;
  }));
  return { authorized: true, scopeMode: subjects.mode, summaries };
}
