import type { Firestore } from "firebase-admin/firestore";
import { marketDateForInstant, resolveBusinessCalendarDay, validateMarketSettings, type BusinessCalendarException, type MarketBusinessSettings } from "../src/lib/marketSettings";
export { marketDateForInstant } from "../src/lib/marketSettings";
import { isPhysicianEligibleForRepresentative } from "../src/lib/canonicalRepresentativeScope";
import { canAccessView } from "../src/lib/userPolicyEngine";
import type { Permissions, User } from "../src/types";
import { getFirebaseAdminServices } from "./firebaseAdmin";
import { createFirestoreOperationalScopeRepository, resolveOperationalScopeForActor } from "./operationalScopeRepository";
import { evaluatePlannerEligibility, type PlannerFrequencyRecord } from "../src/lib/medicalPlannerPolicy";
import { filterPhysiciansWithinOperationalScope } from "./physicianReadService";

export type PlannerMutationMode = "MANUAL" | "AUTO";
export interface MedicalPlannerProposal { id: string; repId: string; physicianId: string; date: string; time?: string; planningType: "weekly" | "monthly"; week: string; month: string; isUnplanned?: boolean; }
export interface ExistingPlannerVisit { id: string; repId: string; physicianId: string; date: string; time?: string; week?: string; status?: string; planStatus?: string; kind?: "PLANNED" | "COMPLETED"; completedVisitId?: string; }
export interface PlannerValidationInput {
  actorUid: string;
  actorRole: string;
  actorSubjectUids: string[];
  targetRep: any;
  targetAreaIds: string[];
  targetProductAssignments: any[];
  products: any[];
  physician: any;
  area: any;
  district: any;
  city: any;
  country: any;
  markets: MarketBusinessSettings[];
  exceptions: BusinessCalendarException[];
  existingVisits: ExistingPlannerVisit[];
  proposal: MedicalPlannerProposal;
  mode: PlannerMutationMode;
  now?: string;
}

export class MedicalPlannerMutationError extends Error {
  constructor(public readonly code: string, public readonly status = 409) { super(code); }
}
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const active = (value: any) => value?.active !== false && value?.isActive !== false && value?.isDeleted !== true && value?.status !== "Inactive";
const unique = (values: string[]) => [...new Set(values.filter(Boolean))];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseMedicalPlannerMutationRequest(body: unknown): { mode: PlannerMutationMode; proposal: MedicalPlannerProposal } | null {
  if (!body || typeof body !== "object") return null;
  const value = body as any;
  const proposal = value.proposal;
  if ((value.mode !== "MANUAL" && value.mode !== "AUTO") || !proposal || typeof proposal !== "object") return null;
  if (!["weekly", "monthly"].includes(proposal.planningType) || !text(proposal.id) || !text(proposal.repId) || !text(proposal.physicianId) || !DATE.test(text(proposal.date))) return null;
  return { mode: value.mode, proposal: { ...proposal, id: text(proposal.id), repId: text(proposal.repId), physicianId: text(proposal.physicianId), date: text(proposal.date), week: text(proposal.week), month: text(proposal.month) } };
}

function addUtcDays(date: string, amount: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

export function configuredWorkingDaysBetween(fromDate: string, toDate: string, market: MarketBusinessSettings, exceptions: BusinessCalendarException[], regionId?: string): number {
  if (!DATE.test(fromDate) || !DATE.test(toDate)) throw new MedicalPlannerMutationError("INVALID_PLANNER_DATE", 400);
  const [start, end] = fromDate < toDate ? [fromDate, toDate] : [toDate, fromDate];
  let cursor = start;
  let count = 0;
  while (cursor < end) {
    cursor = addUtcDays(cursor, 1);
    if (cursor < end && resolveBusinessCalendarDay(cursor, market, exceptions, regionId).scheduledWorkingDay) count++;
  }
  return count;
}

export function validateMedicalPlannerProposal(input: PlannerValidationInput): { market: MarketBusinessSettings; countryId: string } {
  const { proposal } = input;
  if (!text(input.actorUid) || !active(input.targetRep) || text(input.targetRep?.role) !== "Medical Representative") throw new MedicalPlannerMutationError("PLANNER_REP_NOT_AUTHORIZED", 403);
  if (!input.actorSubjectUids.includes(proposal.repId) || proposal.repId !== text(input.targetRep.id)) throw new MedicalPlannerMutationError("PLANNER_REP_NOT_AUTHORIZED", 403);
  if (!DATE.test(proposal.date) || !text(proposal.physicianId)) throw new MedicalPlannerMutationError("INVALID_PLANNER_REQUEST", 400);
  const areaId = text(input.area?.id);
  const countryId = text(input.area?.countryId);
  if (!active(input.physician) || text(input.physician?.areaId) !== areaId) throw new MedicalPlannerMutationError("PLANNER_PHYSICIAN_INACTIVE_OR_INVALID", 403);
  if (!areaId || !input.targetAreaIds.includes(areaId)
    || !active(input.area) || !active(input.country) || text(input.country?.id) !== countryId
    || !active(input.district) || text(input.district?.id) !== text(input.area?.districtId) || text(input.district?.countryId) !== countryId
    || !active(input.city) || text(input.city?.id) !== text(input.area?.cityId) || text(input.city?.districtId) !== text(input.area?.districtId) || text(input.city?.countryId) !== countryId) {
    throw new MedicalPlannerMutationError("PLANNER_CANONICAL_GEOGRAPHY_INVALID", 409);
  }
  if (!isPhysicianEligibleForRepresentative({ physician: input.physician, representativeUid: proposal.repId, effectiveAreaIds: input.targetAreaIds, productAssignments: input.targetProductAssignments, products: input.products })) {
    throw new MedicalPlannerMutationError("PLANNER_PHYSICIAN_OUTSIDE_SCOPE", 403);
  }
  const matches = input.markets.filter(market => market.active && market.countryId === countryId && validateMarketSettings(market).length === 0);
  if (matches.length === 0) throw new MedicalPlannerMutationError("PLANNER_MARKET_CONFIGURATION_REQUIRED");
  if (matches.length !== 1) throw new MedicalPlannerMutationError("PLANNER_MARKET_CONFIGURATION_AMBIGUOUS");
  const market = matches[0];
  if (proposal.date < marketDateForInstant(input.now || new Date().toISOString(), market.timezone)) throw new MedicalPlannerMutationError("PLANNER_PAST_DATE");
  const regionId = text(input.area?.districtId);
  if (!resolveBusinessCalendarDay(proposal.date, market, input.exceptions, regionId).scheduledWorkingDay) throw new MedicalPlannerMutationError("PLANNER_NON_WORKING_DAY");
  const activeVisits = input.existingVisits.filter(visit => !["CANCELLED", "REMOVED"].includes(text(visit.status).toUpperCase()) && !(visit.kind !== "COMPLETED" && text(visit.week) === proposal.week && [text(visit.status).toUpperCase(), text(visit.planStatus).toUpperCase()].includes("SAVED")));
  if (activeVisits.some(visit => visit.id !== proposal.id && visit.repId === proposal.repId && visit.physicianId === proposal.physicianId && visit.date === proposal.date)) throw new MedicalPlannerMutationError("PLANNER_DUPLICATE_PHYSICIAN_DATE");
  const frequencyRecords: PlannerFrequencyRecord[] = activeVisits.filter(visit => visit.id !== proposal.id && visit.repId === proposal.repId && visit.physicianId === proposal.physicianId).map(visit => ({ ...visit, kind: visit.kind || "PLANNED" }));
  const eligibility = evaluatePlannerEligibility(input.physician.targetFrequency, proposal.date, frequencyRecords);
  if (!eligibility.eligible) throw new MedicalPlannerMutationError(eligibility.code || "PLANNER_TARGET_FREQUENCY_EXCEEDED");
  return { market, countryId };
}

export async function executeMedicalPlannerMutation(actorUid: string, proposal: MedicalPlannerProposal, mode: PlannerMutationMode, db: Firestore = getFirebaseAdminServices().db) {
  if (actorUid !== proposal.repId) throw new MedicalPlannerMutationError("PLANNER_OWNER_REQUIRED", 403);
  const scopeRepository = createFirestoreOperationalScopeRepository();
  const actorScope = await resolveOperationalScopeForActor(actorUid, { actorUid }, scopeRepository);
  if (!actorScope.authorized || !actorScope.subjectUids.includes(proposal.repId)) throw new MedicalPlannerMutationError("PLANNER_ACTOR_NOT_AUTHORIZED", 403);
  const targetScope = await resolveOperationalScopeForActor(proposal.repId, { actorUid: proposal.repId }, scopeRepository);
  if (!targetScope.authorized || targetScope.subjectMode !== "SELF") throw new MedicalPlannerMutationError("PLANNER_REP_NOT_OPERATIONAL", 403);
  const actorSnapshot = await db.collection("users").doc(actorUid).get();
  if (!actorSnapshot.exists) throw new MedicalPlannerMutationError("PLANNER_ACTOR_NOT_AUTHORIZED", 403);
  const actorData = { id: actorSnapshot.id, ...actorSnapshot.data() } as User;
  const rolePermissionsSnapshot = await db.collection("rolePermissions").doc(text(actorData.role)).get();
  const permissions = rolePermissionsSnapshot.exists ? rolePermissionsSnapshot.data() as Permissions & { active?: boolean } : null;
  if (!permissions || permissions.active === false || permissions.view !== true || permissions.create !== true || !canAccessView(actorData, "field-medical-planner", permissions)) {
    throw new MedicalPlannerMutationError("PLANNER_ACTION_NOT_AUTHORIZED", 403);
  }
  const [repSnap, physicianSnap, productsSnap, assignmentsSnap] = await Promise.all([
    db.collection("users").doc(proposal.repId).get(), db.collection("physicians").doc(proposal.physicianId).get(),
    db.collection("products").get(), db.collection("userProductAssignments").where("userId", "==", proposal.repId).get(),
  ]);
  if (!repSnap.exists || !physicianSnap.exists) throw new MedicalPlannerMutationError("PLANNER_RESOURCE_NOT_FOUND", 404);
  const physician = { id: physicianSnap.id, ...physicianSnap.data() } as any;
  if (filterPhysiciansWithinOperationalScope([physician], targetScope).length !== 1) throw new MedicalPlannerMutationError("PLANNER_PHYSICIAN_OUTSIDE_SCOPE", 403);
  const areaId = text(physician.areaId);
  const areaSnap = await db.collection("areas").doc(areaId).get();
  if (!areaSnap.exists) throw new MedicalPlannerMutationError("PLANNER_CANONICAL_GEOGRAPHY_INVALID");
  const area = { id: areaSnap.id, ...areaSnap.data() } as any;
  const [countrySnap, districtSnap, citySnap, marketsSnap, exceptionsSnap] = await Promise.all([
    db.collection("countries").doc(text(area.countryId)).get(), db.collection("districts").doc(text(area.districtId)).get(), db.collection("cities").doc(text(area.cityId)).get(),
    db.collection("marketSettings").where("countryId", "==", text(area.countryId)).get(), db.collection("businessCalendarExceptions").where("countryId", "==", text(area.countryId)).get(),
  ]);
  const now = new Date().toISOString();
  const validationInput: PlannerValidationInput = {
    actorUid, actorRole: text(actorData.role), actorSubjectUids: actorScope.subjectUids,
    targetRep: { id: repSnap.id, ...repSnap.data() }, targetAreaIds: targetScope.areaIds,
    targetProductAssignments: assignmentsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })), products: productsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })), physician,
    area, district: districtSnap.exists ? { id: districtSnap.id, ...districtSnap.data() } : null, city: citySnap.exists ? { id: citySnap.id, ...citySnap.data() } : null,
    country: countrySnap.exists ? { id: countrySnap.id, ...countrySnap.data() } : null, markets: marketsSnap.docs.map(doc => ({ marketId: doc.id, ...doc.data() } as MarketBusinessSettings)),
    exceptions: exceptionsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as BusinessCalendarException)), existingVisits: [], proposal, mode, now,
  };
  let result!: ReturnType<typeof validateMedicalPlannerProposal>;
  await db.runTransaction(async tx => {
    const [visitsSnap, completedSnap] = await Promise.all([
      tx.get(db.collection("medicalPlannerVisits").where("repId", "==", proposal.repId)),
      tx.get(db.collection("physicianVisits").where("repId", "==", proposal.repId).where("physicianId", "==", proposal.physicianId)),
    ]);
    const existingVisits = [
      ...visitsSnap.docs.map(doc => ({ id: doc.id, ...doc.data(), kind: "PLANNED" } as ExistingPlannerVisit & { kind: "PLANNED"; completedVisitId?: string })),
      ...completedSnap.docs.map(doc => { const data = doc.data(); return { id: doc.id, repId: text(data.repId), physicianId: text(data.physicianId), date: text(data.visitDate) || text(data.date), time: text(data.time) || "00:00", status: text(data.status), kind: "COMPLETED" as const }; }),
    ];
    result = validateMedicalPlannerProposal({ ...validationInput, existingVisits });
    const reference = db.collection("medicalPlannerVisits").doc(proposal.id);
    const current = await tx.get(reference);
    if (current.exists && text(current.data()?.repId) !== actorUid) throw new MedicalPlannerMutationError("PLANNER_OWNER_REQUIRED", 403);
    if (current.exists && permissions.edit !== true) throw new MedicalPlannerMutationError("PLANNER_ACTION_NOT_AUTHORIZED", 403);
    const alreadySaved = current.exists && [text(current.data()?.status).toUpperCase(), text(current.data()?.planStatus).toUpperCase()].includes("SAVED");
    tx.set(reference, { ...proposal, mode, countryId: result.countryId, marketId: result.market.marketId, ...(alreadySaved ? {} : { status: "DRAFT", planStatus: "DRAFT" }), ...(current.exists ? {} : { createdAt: now, createdBy: actorUid }), updatedAt: now, updatedBy: actorUid }, { merge: current.exists });
  });
  return { status: "SAVED" as const, id: proposal.id, marketId: result.market.marketId };
}
