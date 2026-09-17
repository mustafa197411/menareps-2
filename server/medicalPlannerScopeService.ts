import type { Firestore } from "firebase-admin/firestore";
import { filterPhysiciansWithinOperationalScope } from "./physicianReadService";
import { canAccessView } from "../src/lib/userPolicyEngine";
import type { EffectiveOperationalScope } from "./operationalScopeService";
import {
  createFirestoreOperationalScopeRepository,
  resolveOperationalScopeForActor,
  type OperationalScopeRepository,
} from "./operationalScopeRepository";
import { getFirebaseAdminServices } from "./firebaseAdmin";
import { validateMarketSettings, type MarketBusinessSettings } from "../src/lib/marketSettings";

export type MedicalPlannerPeriodType = "weekly" | "monthly";
export type MedicalPlannerAction = "REMOVE_VISIT" | "CLEAR_PERIOD" | "SAVE_WEEK";

export interface MedicalPlannerReadRequest {
  repId: string;
  planningType: MedicalPlannerPeriodType;
  period?: string;
}

export interface MedicalPlannerActionRequest extends MedicalPlannerReadRequest {
  action: MedicalPlannerAction;
  visitId?: string;
  visitIds?: string[];
}

export class MedicalPlannerScopeError extends Error {
  constructor(public readonly code: string, public readonly status = 403) {
    super(code);
    this.name = "MedicalPlannerScopeError";
  }
}

const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const active = (value: any): boolean => value?.active !== false
  && value?.loginAllowed !== false
  && value?.isDeleted !== true
  && !["Inactive", "Archived", "Suspended"].includes(text(value?.status))
  && !["Inactive", "Archived", "Suspended"].includes(text(value?.employmentStatus))
  && value?.accountStatus !== "INACTIVE";
export const visiblePlannerVisit = (visit: any): boolean => text(visit?.planStatus) !== "DRAFT";
export function reconcileSavedWeek(rows: Array<{ id: string }>, requestedVisitIds: string[]): { saveIds: string[]; deleteIds: string[] } {
  const requested = new Set(requestedVisitIds);
  if ([...requested].some(id => !rows.some(row => row.id === id))) throw new MedicalPlannerScopeError("PLANNER_VISIT_NOT_FOUND", 404);
  return { saveIds: rows.filter(row => requested.has(row.id)).map(row => row.id), deleteIds: rows.filter(row => !requested.has(row.id)).map(row => row.id) };
}

export function parseMedicalPlannerReadRequest(value: unknown): MedicalPlannerReadRequest | null {
  if (!value || typeof value !== "object") return null;
  const input = value as any;
  const repId = text(input.repId);
  const period = text(input.period);
  if (!repId || !["weekly", "monthly"].includes(input.planningType)) return null;
  return { repId, ...(period ? { period } : {}), planningType: input.planningType };
}

export function parseMedicalPlannerActionRequest(value: unknown): MedicalPlannerActionRequest | null {
  const base = parseMedicalPlannerReadRequest(value);
  if (!base || !base.period) return null;
  const input = value as any;
  const actions = new Set<MedicalPlannerAction>(["REMOVE_VISIT", "CLEAR_PERIOD", "SAVE_WEEK"]);
  if (!actions.has(input.action)) return null;
  const visitId = text(input.visitId);
  if (input.action === "REMOVE_VISIT" && !visitId) return null;
  if (input.action === "SAVE_WEEK" && base.planningType !== "weekly") return null;
  const visitIds: string[] = Array.isArray(input.visitIds) ? Array.from(new Set<string>(input.visitIds.map((item: unknown) => text(item)).filter(Boolean))) : [];
  return { ...base, action: input.action, ...(visitId ? { visitId } : {}), ...(visitIds.length ? { visitIds } : {}) };
}

export function assertMedicalPlannerTargetAuthorization(
  actorUid: string,
  actorScope: EffectiveOperationalScope,
  targetRep: any,
  targetScope: EffectiveOperationalScope,
): void {
  const authorizedRepresentatives = new Set(actorScope.authorizedRepresentativeUids || []);
  if (!text(actorUid)
    || actorScope.actorUid !== actorUid
    || actorScope.authorized !== true
    || actorScope.queryPlan?.denyAll !== false
    || !actorScope.subjectUids.includes(text(targetRep?.id))
    || !authorizedRepresentatives.has(text(targetRep?.id))) {
    throw new MedicalPlannerScopeError("PLANNER_REP_NOT_AUTHORIZED");
  }
  if (!active(targetRep) || text(targetRep?.role) !== "Medical Representative") {
    throw new MedicalPlannerScopeError("PLANNER_REP_NOT_AUTHORIZED");
  }
  if (targetScope.actorUid !== text(targetRep.id)
    || targetScope.authorized !== true
    || targetScope.queryPlan?.denyAll !== false
    || targetScope.subjectMode !== "SELF") {
    throw new MedicalPlannerScopeError("PLANNER_REP_NOT_OPERATIONAL");
  }
}

async function authorize(
  actorUid: string,
  repId: string,
  db: Firestore,
  scopeRepository: OperationalScopeRepository,
) {
  const [actorScope, targetScope, actorSnapshot, targetSnapshot] = await Promise.all([
    resolveOperationalScopeForActor(actorUid, { actorUid }, scopeRepository),
    resolveOperationalScopeForActor(repId, { actorUid: repId }, scopeRepository),
    db.collection("users").doc(actorUid).get(),
    db.collection("users").doc(repId).get(),
  ]);
  if (!actorSnapshot.exists || !targetSnapshot.exists) throw new MedicalPlannerScopeError("PLANNER_REP_NOT_AUTHORIZED");
  const actor = { id: actorSnapshot.id, ...actorSnapshot.data() } as any;
  const targetRep = { id: targetSnapshot.id, ...targetSnapshot.data() } as any;
  assertMedicalPlannerTargetAuthorization(actorUid, actorScope, targetRep, targetScope);
  const permissionSnapshot = await db.collection("rolePermissions").doc(text(actor.role)).get();
  const permissions = permissionSnapshot.exists ? permissionSnapshot.data() as any : null;
  if (!permissions || permissions.active === false || permissions.view !== true || !canAccessView(actor, "field-medical-planner", permissions)) {
    throw new MedicalPlannerScopeError("PLANNER_ACTION_NOT_AUTHORIZED");
  }
  return { actor, actorScope, targetRep, targetScope, permissions };
}

export async function resolveMedicalPlannerScopedRead(
  actorUid: string,
  request: MedicalPlannerReadRequest,
  dependencies: { db?: Firestore; scopeRepository?: OperationalScopeRepository } = {},
) {
  const db = dependencies.db || getFirebaseAdminServices().db;
  const scopeRepository = dependencies.scopeRepository || createFirestoreOperationalScopeRepository();
  const { targetRep, targetScope } = await authorize(actorUid, request.repId, db, scopeRepository);
  const [visitsSnapshot, completedSnapshot, areasSnapshot, citiesSnapshot, specialtiesSnapshot, groupsSnapshot, marketsSnapshot, exceptionsSnapshot] = await Promise.all([
    db.collection("medicalPlannerVisits").where("repId", "==", request.repId).get(),
    db.collection("physicianVisits").where("repId", "==", request.repId).get(),
    db.collection("areas").get(), db.collection("cities").get(), db.collection("physicianSpecialties").get(), db.collection("productPromotionGroups").get(),
    db.collection("marketSettings").get(), db.collection("businessCalendarExceptions").get(),
  ]);
  const physiciansById = new Map<string, any>();
  for (const areaId of targetScope.areaIds) {
    const snapshot = await db.collection("physicians").where("areaId", "==", areaId).get();
    snapshot.docs.forEach((document) => physiciansById.set(document.id, { id: document.id, ...document.data() }));
  }
  const physicians = filterPhysiciansWithinOperationalScope([...physiciansById.values()], targetScope);
  const periodField = request.planningType === "weekly" ? "week" : "month";
  const visits = visitsSnapshot.docs
    .map((document) => ({ id: document.id, ...document.data() } as any))
    .filter((visit) => visit.planningType === request.planningType && visiblePlannerVisit(visit) && (!request.period || text(visit[periodField]) === request.period))
    .map(visit => { const physician = physiciansById.get(text(visit.physicianId)); const weekday = /^\d{4}-\d{2}-\d{2}$/.test(text(visit.date)) ? new Date(`${visit.date}T12:00:00Z`).toLocaleDateString("en", { weekday: "long", timeZone: "UTC" }) : ""; return { ...visit, physicianName: physician?.name || "", specialty: physician?.specialty || "", day: weekday, repName: targetRep.name || "", isUnplanned: false }; });
  return {
    authorized: true,
    actorUid,
    representative: { id: targetRep.id, name: targetRep.name, role: targetRep.role },
    areaIds: targetScope.areaIds,
    productIds: targetScope.productIds,
    productGroupIds: targetScope.productGroupIds,
    physicians,
    visits,
    frequencyReservations: visitsSnapshot.docs.map(document => ({ id: document.id, ...document.data() })),
    completedVisits: completedSnapshot.docs.map(document => ({ id: document.id, ...document.data() })).filter((visit: any) => text(visit.status).toLowerCase() === "completed"),
    geography: { areas: areasSnapshot.docs.map(document => ({ id: document.id, ...document.data() })), cities: citiesSnapshot.docs.map(document => ({ id: document.id, ...document.data() })) },
    specialties: specialtiesSnapshot.docs.map(document => ({ id: document.id, ...document.data() })),
    promotionGroups: groupsSnapshot.docs.map(document => ({ id: document.id, ...document.data() })),
    marketSettings: marketsSnapshot.docs.map(document => ({ marketId: document.id, ...document.data() } as MarketBusinessSettings)).filter(market => market.active && targetScope.countryIds.includes(text(market.countryId)) && validateMarketSettings(market).length === 0),
    businessCalendarExceptions: exceptionsSnapshot.docs.map(document => ({ id: document.id, ...document.data() })).filter((item: any) => item.active !== false && targetScope.countryIds.includes(text(item.countryId))),
  };
}

export async function executeMedicalPlannerScopedAction(
  actorUid: string,
  request: MedicalPlannerActionRequest,
  dependencies: { db?: Firestore; scopeRepository?: OperationalScopeRepository; now?: () => string } = {},
) {
  const db = dependencies.db || getFirebaseAdminServices().db;
  const scopeRepository = dependencies.scopeRepository || createFirestoreOperationalScopeRepository();
  const { permissions } = await authorize(actorUid, request.repId, db, scopeRepository);
  const periodField = request.planningType === "weekly" ? "week" : "month";
  if (actorUid !== request.repId) throw new MedicalPlannerScopeError("PLANNER_OWNER_REQUIRED");

  if (request.action === "REMOVE_VISIT") {
    if (permissions.delete !== true) throw new MedicalPlannerScopeError("PLANNER_ACTION_NOT_AUTHORIZED");
    const reference = db.collection("medicalPlannerVisits").doc(request.visitId!);
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) throw new MedicalPlannerScopeError("PLANNER_VISIT_NOT_FOUND", 404);
      const visit = snapshot.data() as any;
      if (text(visit.repId) !== request.repId
        || visit.planningType !== request.planningType
        || text(visit[periodField]) !== request.period) throw new MedicalPlannerScopeError("PLANNER_REP_NOT_AUTHORIZED");
      transaction.delete(reference);
    });
    return { success: true, action: request.action, removed: 1 };
  }

  if (request.action === "CLEAR_PERIOD") {
    if (permissions.delete !== true) throw new MedicalPlannerScopeError("PLANNER_ACTION_NOT_AUTHORIZED");
    const visitsQuery = db.collection("medicalPlannerVisits").where("repId", "==", request.repId);
    let removed = 0;
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(visitsQuery);
      const matching = snapshot.docs.filter((document) => {
        const visit = document.data() as any;
        return visit.planningType === request.planningType && text(visit[periodField]) === request.period;
      });
      matching.forEach((document) => transaction.delete(document.ref));
      removed = matching.length;
    });
    return { success: true, action: request.action, removed };
  }

  if (request.action === "SAVE_WEEK") {
    if (permissions.edit !== true) throw new MedicalPlannerScopeError("PLANNER_ACTION_NOT_AUTHORIZED");
    const requestedIds = new Set(request.visitIds || []);
    const visitsQuery = db.collection("medicalPlannerVisits").where("repId", "==", request.repId);
    let saved = 0;
    await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(visitsQuery);
      const periodVisits = snapshot.docs.filter(document => { const visit = document.data() as any; return visit.planningType === "weekly" && text(visit.week) === request.period; });
      const reconciliation = reconcileSavedWeek(periodVisits, [...requestedIds]);
      const now = dependencies.now?.() || new Date().toISOString();
      periodVisits.forEach(document => {
        if (reconciliation.saveIds.includes(document.id)) { transaction.update(document.ref, { status: "SAVED", planStatus: "SAVED", savedAt: now, updatedAt: now, updatedBy: actorUid }); saved++; }
        else transaction.delete(document.ref);
      });
    });
    return { success: true, action: request.action, saved, planStatus: "SAVED" };
  }

  throw new MedicalPlannerScopeError("INVALID_PLANNER_ACTION_REQUEST", 400);
}
