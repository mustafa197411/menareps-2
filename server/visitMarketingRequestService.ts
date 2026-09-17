import type { Firestore } from "firebase-admin/firestore";
import { createFirestoreOperationalScopeRepository, resolveOperationalScopeForActor } from "./operationalScopeRepository";
import {
  VISIT_MARKETING_REQUEST_RESOURCE,
  VISIT_MARKETING_REQUEST_SCHEMA_VERSION,
  hasVisitMarketingRequestPermission,
  isApplicableVisitMarketingSupervisor,
  isCanonicalUserActive,
  isEligibleVisitMarketingFinalApprover,
  evaluateVisitMarketingExecute,
  nextVisitMarketingRequestStatus,
  parseVisitMarketingRequestDraft,
  type CanonicalVisitMarketingRequest,
  type MarketingRequestPermissionRecord,
  type VisitMarketingRequestAction,
  type VisitMarketingRequestAuditEvent,
  type VisitMarketingRequestDraft,
} from "../src/lib/visitMarketingRequestPolicy";

export class VisitMarketingRequestError extends Error {
  constructor(public readonly code: string, public readonly status = 403) { super(code); }
}

const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const safeId = (value: string): string => value.replace(/[^a-zA-Z0-9_-]/g, "_");

export function parseVisitMarketingRequestCreate(value: unknown): { visitId: string; request: VisitMarketingRequestDraft } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const visitId = text(input.visitId);
  const request = parseVisitMarketingRequestDraft(input.request);
  return visitId && request ? { visitId, request } : null;
}

export function parseVisitMarketingRequestTransition(value: unknown): { requestId: string; reason?: string; comment?: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const requestId = text(input.requestId);
  const reason = text(input.reason);
  const comment = text(input.comment);
  return requestId ? { requestId, ...(reason ? { reason } : {}), ...(comment ? { comment } : {}) } : null;
}

function auditEvent(input: {
  requestId: string;
  actorUid: string;
  action: VisitMarketingRequestAuditEvent["action"];
  fromStatus: VisitMarketingRequestAuditEvent["fromStatus"];
  toStatus: VisitMarketingRequestAuditEvent["toStatus"];
  occurredAt: string;
  reason?: string;
  comment?: string;
}): VisitMarketingRequestAuditEvent {
  return {
    id: `VMRA-${safeId(input.requestId)}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    requestId: input.requestId,
    resourceType: VISIT_MARKETING_REQUEST_RESOURCE,
    actorUid: input.actorUid,
    action: input.action,
    fromStatus: input.fromStatus,
    toStatus: input.toStatus,
    occurredAt: input.occurredAt,
    ...(input.reason ? { reason: input.reason } : {}),
    ...(input.comment ? { comment: input.comment } : {}),
  };
}

async function rolePermissions(db: Firestore, role: string): Promise<MarketingRequestPermissionRecord | null> {
  const snapshot = await db.collection("rolePermissions").doc(role).get();
  return snapshot.exists ? snapshot.data() as MarketingRequestPermissionRecord : null;
}

async function activeAncestorChain(db: Firestore, supervisorUid: string): Promise<string[]> {
  const result: string[] = [];
  const seen = new Set<string>([supervisorUid]);
  let currentUid = supervisorUid;
  while (currentUid) {
    const current = await db.collection("users").doc(currentUid).get();
    if (!current.exists || !isCanonicalUserActive(current.data() as any)) throw new VisitMarketingRequestError("REQUEST_HIERARCHY_INVALID");
    const managerId = text(current.data()?.managerId);
    if (!managerId) break;
    if (seen.has(managerId)) throw new VisitMarketingRequestError("REQUEST_HIERARCHY_INVALID");
    const manager = await db.collection("users").doc(managerId).get();
    if (!manager.exists || !isCanonicalUserActive(manager.data() as any)) throw new VisitMarketingRequestError("REQUEST_HIERARCHY_INVALID");
    seen.add(managerId);
    result.push(managerId);
    currentUid = managerId;
  }
  return result;
}

async function assertActorAreaScope(db: Firestore, actorUid: string, areaId: string): Promise<void> {
  const scope = await resolveOperationalScopeForActor(actorUid, {}, createFirestoreOperationalScopeRepository());
  if (!scope.authorized || scope.queryPlan.denyAll || !scope.areaIds.includes(areaId)) {
    throw new VisitMarketingRequestError("REQUEST_SCOPE_DENIED");
  }
}

export async function executeVisitMarketingRequestCreate(
  actorUid: string,
  visitId: string,
  draft: VisitMarketingRequestDraft,
  db: Firestore,
): Promise<{ request: CanonicalVisitMarketingRequest }> {
  const parsed = parseVisitMarketingRequestDraft(draft);
  if (!parsed) throw new VisitMarketingRequestError("INVALID_VISIT_MARKETING_REQUEST", 400);
  const requestRef = db.collection("visitMarketingRequests").doc();
  const auditRef = db.collection("visitMarketingRequestAudit").doc();
  return db.runTransaction(async tx => {
    const [actor, visit] = await Promise.all([
      tx.get(db.collection("users").doc(actorUid)),
      tx.get(db.collection("physicianVisits").doc(visitId)),
    ]);
    if (!actor.exists || !isCanonicalUserActive(actor.data() as any) || text(actor.data()?.role) !== "Medical Representative") throw new VisitMarketingRequestError("REQUEST_CREATOR_NOT_AUTHORIZED");
    if (!visit.exists || text(visit.data()?.repId) !== actorUid || text(visit.data()?.status).toLowerCase() !== "completed") throw new VisitMarketingRequestError("VISIT_NOT_AUTHORIZED");
    const physicianId = text(visit.data()?.physicianId); const areaId = text(visit.data()?.areaId);
    const countryId = text(visit.data()?.countryId); const marketId = text(visit.data()?.marketId);
    if (!physicianId || !areaId || !countryId || !marketId) throw new VisitMarketingRequestError("VISIT_CANONICAL_CONTEXT_INVALID", 409);
    const [physician, territoryAssignments] = await Promise.all([
      tx.get(db.collection("physicians").doc(physicianId)),
      tx.get(db.collection("userTerritoryAssignments").where("userId", "==", actorUid)),
    ]);
    const areaAuthorized = territoryAssignments.docs.some(doc => doc.data().status === "Active" && doc.data().active !== false && text(doc.data().areaId || doc.data().territoryId) === areaId);
    if (!physician.exists || text(physician.data()?.areaId) !== areaId || physician.data()?.active === false || !areaAuthorized) throw new VisitMarketingRequestError("VISIT_CANONICAL_CONTEXT_INVALID", 403);
    const supervisorUid = text(actor.data()?.managerId);
    if (!supervisorUid) throw new VisitMarketingRequestError("CANONICAL_SUPERVISOR_REQUIRED", 409);
    const supervisor = await tx.get(db.collection("users").doc(supervisorUid));
    const permissions = supervisor.exists
      ? await tx.get(db.collection("rolePermissions").doc(text(supervisor.data()?.role)))
      : null;
    if (!supervisor.exists || !isApplicableVisitMarketingSupervisor({
      representativeUid: actorUid, representativeManagerId: supervisorUid, supervisorUid,
      supervisor: supervisor.data() as any, permissions: permissions?.exists ? permissions.data() : null,
    })) {
      throw new VisitMarketingRequestError("CANONICAL_SUPERVISOR_REQUIRED", 409);
    }
    const now = new Date().toISOString();
    const request: CanonicalVisitMarketingRequest = {
      id: requestRef.id, resourceType: VISIT_MARKETING_REQUEST_RESOURCE, creatorUid: actorUid, representativeUid: actorUid,
      supervisorUid, visitId, physicianId, areaId, countryId, marketId, status: "PENDING_SUPERVISOR",
      schemaVersion: VISIT_MARKETING_REQUEST_SCHEMA_VERSION, createdAt: now, updatedAt: now, ...parsed,
    };
    const audit = auditEvent({ requestId: request.id, actorUid, action: "CREATED", fromStatus: null, toStatus: request.status, occurredAt: now });
    tx.create(requestRef, request); tx.create(auditRef, { ...audit, id: auditRef.id });
    return { request };
  });
}

export async function executeVisitMarketingRequestTransition(
  actorUid: string,
  action: Exclude<VisitMarketingRequestAction, "CREATE">,
  input: { requestId: string; reason?: string; comment?: string },
  db: Firestore,
): Promise<{ request: CanonicalVisitMarketingRequest }> {
  const requestRef = db.collection("visitMarketingRequests").doc(input.requestId);
  const [actor, current] = await Promise.all([db.collection("users").doc(actorUid).get(), requestRef.get()]);
  if (!actor.exists || !isCanonicalUserActive(actor.data() as any)) throw new VisitMarketingRequestError("ACTOR_INACTIVE");
  if (!current.exists) throw new VisitMarketingRequestError("REQUEST_NOT_FOUND", 404);
  const request = current.data() as CanonicalVisitMarketingRequest;
  if (request.resourceType !== VISIT_MARKETING_REQUEST_RESOURCE) throw new VisitMarketingRequestError("REQUEST_RESOURCE_INVALID", 409);
  const next = nextVisitMarketingRequestStatus(request.status, action);
  if (!next) throw new VisitMarketingRequestError("REQUEST_TRANSITION_INVALID", 409);
  if (actorUid === request.creatorUid && action !== "CANCEL") throw new VisitMarketingRequestError("REQUEST_SELF_REVIEW_DENIED");
  if ((action.endsWith("REJECT") || action === "CANCEL") && !text(input.reason)) throw new VisitMarketingRequestError("REQUEST_REASON_REQUIRED", 400);
  if (action === "EXECUTE" && !text(input.comment)) throw new VisitMarketingRequestError("REQUEST_EXECUTION_NOTE_REQUIRED", 400);

  if (action === "CANCEL") {
    if (actorUid !== request.creatorUid) throw new VisitMarketingRequestError("REQUEST_CANCELLATION_DENIED");
  } else if (action.startsWith("SUPERVISOR_")) {
    if (actorUid !== request.supervisorUid) throw new VisitMarketingRequestError("REQUEST_SUPERVISOR_DENIED");
    const representative = await db.collection("users").doc(request.representativeUid).get();
    if (!representative.exists || !isApplicableVisitMarketingSupervisor({
      representativeUid: request.representativeUid, representativeManagerId: text(representative.data()?.managerId), supervisorUid: actorUid,
      supervisor: actor.data() as any, permissions: await rolePermissions(db, text(actor.data()?.role)),
    })) throw new VisitMarketingRequestError("REQUEST_SUPERVISOR_DENIED");
    const capability = action === "SUPERVISOR_APPROVE" ? "supervisorApprove" : "supervisorReject";
    if (!hasVisitMarketingRequestPermission(text(actor.data()?.role), capability, await rolePermissions(db, text(actor.data()?.role)))) throw new VisitMarketingRequestError("REQUEST_PERMISSION_DENIED");
    await assertActorAreaScope(db, actorUid, request.areaId);
  } else if (action === "EXECUTE") {
    const scope = await resolveOperationalScopeForActor(actorUid, {}, createFirestoreOperationalScopeRepository());
    const permissions = await rolePermissions(db, text(actor.data()?.role));
    const decision = evaluateVisitMarketingExecute({ actorUid, actor: actor.data() as any, request,
      actorAreaIds: scope.authorized && !scope.queryPlan.denyAll ? scope.areaIds : [], permissions });
    if (!decision.allowed) {
      console.info("[MARKETING_EXECUTION_AUTHZ]", JSON.stringify({ actorUid, requestId: request.id, code: decision.code }));
      throw new VisitMarketingRequestError("REQUEST_PERMISSION_OR_SCOPE_DENIED");
    }
  } else {
    const ancestors = await activeAncestorChain(db, request.supervisorUid);
    const capability = action === "FINAL_APPROVE" ? "finalApprove" : action === "FINAL_REJECT" ? "finalReject" : "execute";
    const scope = await resolveOperationalScopeForActor(actorUid, {}, createFirestoreOperationalScopeRepository());
    const permissions = await rolePermissions(db, text(actor.data()?.role));
    if (!isEligibleVisitMarketingFinalApprover({ actorUid, creatorUid: request.creatorUid, actor: actor.data() as any, activeAncestorUids: ancestors,
      requestAreaId: request.areaId, actorAreaIds: scope.authorized && !scope.queryPlan.denyAll ? scope.areaIds : [], action: capability, permissions })) {
      throw new VisitMarketingRequestError(!ancestors.includes(actorUid) ? "REQUEST_FINAL_APPROVER_HIERARCHY_DENIED" : "REQUEST_PERMISSION_OR_SCOPE_DENIED");
    }
  }

  const now = new Date().toISOString();
  const eventAction: VisitMarketingRequestAuditEvent["action"] = action === "SUPERVISOR_APPROVE" ? "SUPERVISOR_APPROVED"
    : action === "SUPERVISOR_REJECT" ? "SUPERVISOR_REJECTED" : action === "FINAL_APPROVE" ? "FINAL_APPROVED"
    : action === "FINAL_REJECT" ? "FINAL_REJECTED" : action === "EXECUTE" ? "EXECUTED" : "CANCELLED";
  const auditRef = db.collection("visitMarketingRequestAudit").doc();
  return db.runTransaction(async tx => {
    const [lockedRequest, lockedActor] = await Promise.all([tx.get(requestRef), tx.get(actor.ref)]);
    if (!lockedRequest.exists || !lockedActor.exists || !isCanonicalUserActive(lockedActor.data() as any)) throw new VisitMarketingRequestError("REQUEST_STATE_CHANGED", 409);
    const live = lockedRequest.data() as CanonicalVisitMarketingRequest;
    const lockedNext = nextVisitMarketingRequestStatus(live.status, action);
    if (!lockedNext || live.creatorUid !== request.creatorUid || live.supervisorUid !== request.supervisorUid) throw new VisitMarketingRequestError("REQUEST_STATE_CHANGED", 409);
    const changes: Partial<CanonicalVisitMarketingRequest> = { status: lockedNext, updatedAt: now };
    if (action === "SUPERVISOR_APPROVE") Object.assign(changes, { supervisorReviewedByUid: actorUid, supervisorReviewedAt: now });
    if (action === "FINAL_APPROVE") Object.assign(changes, { finalReviewedByUid: actorUid, finalReviewedAt: now });
    if (action === "EXECUTE") Object.assign(changes, { executedByUid: actorUid, executedAt: now, executionNote: text(input.comment) });
    if (action.endsWith("REJECT")) Object.assign(changes, { rejectedByUid: actorUid, rejectedAt: now, rejectionReason: text(input.reason) });
    if (action === "CANCEL") Object.assign(changes, { cancelledByUid: actorUid, cancelledAt: now, cancellationReason: text(input.reason) });
    const event = auditEvent({ requestId: live.id, actorUid, action: eventAction, fromStatus: live.status, toStatus: lockedNext, occurredAt: now, reason: text(input.reason), comment: text(input.comment) });
    tx.update(requestRef, changes); tx.create(auditRef, { ...event, id: auditRef.id });
    return { request: { ...live, ...changes } };
  });
}

export async function executeScopedVisitMarketingRequestRead(actorUid: string, db: Firestore): Promise<{ requests: CanonicalVisitMarketingRequest[] }> {
  const scope = await resolveOperationalScopeForActor(actorUid, {}, createFirestoreOperationalScopeRepository());
  if (!scope.authorized || scope.queryPlan.denyAll) throw new VisitMarketingRequestError("REQUEST_READ_SCOPE_DENIED");
  const actor = await db.collection("users").doc(actorUid).get();
  if (!actor.exists || !isCanonicalUserActive(actor.data() as any)) throw new VisitMarketingRequestError("ACTOR_INACTIVE");
  const subjects = new Set(scope.subjectUids);
  const areas = new Set(scope.areaIds);
  const subjectUids = [...subjects];
  const requests: CanonicalVisitMarketingRequest[] = [];
  for (let index = 0; index < subjectUids.length; index += 30) {
    const chunk = subjectUids.slice(index, index + 30);
    if (!chunk.length) continue;
    const snapshot = await db.collection("visitMarketingRequests").where("representativeUid", "in", chunk).get();
    snapshot.docs.forEach(doc => requests.push(doc.data() as CanonicalVisitMarketingRequest));
  }
  const permissions = await rolePermissions(db, text(actor.data()?.role));
  const visible = requests.filter(request => subjects.has(request.representativeUid) && areas.has(request.areaId));
  return { requests: await Promise.all(visible.map(async request => {
    const authorizedActions: CanonicalVisitMarketingRequest["authorizedActions"] = [];
    if (request.creatorUid === actorUid && nextVisitMarketingRequestStatus(request.status, "CANCEL")) authorizedActions.push("CANCEL");
    if (actorUid === request.supervisorUid && hasVisitMarketingRequestPermission(text(actor.data()?.role), "supervisorApprove", permissions)) {
      if (nextVisitMarketingRequestStatus(request.status, "SUPERVISOR_APPROVE")) authorizedActions.push("SUPERVISOR_APPROVE");
      if (nextVisitMarketingRequestStatus(request.status, "SUPERVISOR_REJECT")) authorizedActions.push("SUPERVISOR_REJECT");
    }
    if (request.status === "PENDING_FINAL_APPROVAL") {
      const ancestors = await activeAncestorChain(db, request.supervisorUid);
      if (isEligibleVisitMarketingFinalApprover({ actorUid, creatorUid: request.creatorUid, actor: actor.data() as any, activeAncestorUids: ancestors, requestAreaId: request.areaId, actorAreaIds: [...areas], action: "finalApprove", permissions })) authorizedActions.push("FINAL_APPROVE");
      if (isEligibleVisitMarketingFinalApprover({ actorUid, creatorUid: request.creatorUid, actor: actor.data() as any, activeAncestorUids: ancestors, requestAreaId: request.areaId, actorAreaIds: [...areas], action: "finalReject", permissions })) authorizedActions.push("FINAL_REJECT");
    }
    const execute = evaluateVisitMarketingExecute({ actorUid, actor: actor.data() as any, request, actorAreaIds: [...areas], permissions });
    if (execute.allowed) authorizedActions.push("EXECUTE");
    return { ...request, authorizedActions };
  })) };
}
