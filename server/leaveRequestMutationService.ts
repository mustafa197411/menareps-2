import { randomUUID } from "node:crypto";
import { getFirebaseAdminServices } from "./firebaseAdmin";
import { createFirestoreOperationalScopeRepository, resolveOperationalScopeForActor, type OperationalScopeRepository } from "./operationalScopeRepository";

const CATEGORIES = new Set(["ANNUAL", "SICK", "PERSONAL", "UNPAID", "WORK_FROM_HOME"]);
const DECISIONS = new Set(["APPROVE", "REJECT"]);
export type LeaveRequestMutation = { action: "CREATE"; userId: string; category: string; startDate: string; endDate: string; reason: string } | { action: "APPROVE" | "REJECT"; requestId: string };
export interface LeaveMutationRepository { create(id: string, data: Record<string, unknown>): Promise<void>; decide(id: string, expectedUserIds: string[], patch: Record<string, unknown>): Promise<boolean> }

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";
export function parseLeaveRequestMutation(body: unknown): LeaveRequestMutation | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const value = body as Record<string, unknown>; const action = text(value.action);
  if (action === "CREATE") {
    if (Object.keys(value).some(key => !["action", "userId", "category", "startDate", "endDate", "reason"].includes(key))) return null;
    const userId = text(value.userId), category = text(value.category), startDate = text(value.startDate), endDate = text(value.endDate), reason = text(value.reason);
    return userId && CATEGORIES.has(category) && DATE.test(startDate) && DATE.test(endDate) && startDate <= endDate && reason.length <= 2000 ? { action, userId, category, startDate, endDate, reason } : null;
  }
  if (DECISIONS.has(action)) {
    if (Object.keys(value).some(key => !["action", "requestId"].includes(key))) return null;
    const requestId = text(value.requestId);
    return requestId ? { action: action as "APPROVE" | "REJECT", requestId } : null;
  }
  return null;
}

export function createFirestoreLeaveMutationRepository(): LeaveMutationRepository {
  return {
    async create(id, data) { const { db } = getFirebaseAdminServices(); await db.collection("leaveRequests").doc(id).create(data); },
    async decide(id, expectedUserIds, patch) {
      const { db } = getFirebaseAdminServices(); const ref = db.collection("leaveRequests").doc(id);
      return db.runTransaction(async transaction => { const snapshot = await transaction.get(ref); if (!snapshot.exists) return false; const data = snapshot.data()!; if (!expectedUserIds.includes(text(data.userId)) || text(data.status) !== "PENDING") return false; transaction.update(ref, patch); return true; });
    },
  };
}

export async function executeLeaveRequestMutation(actorUid: string, request: LeaveRequestMutation, dependencies: { operationalScopeRepository?: OperationalScopeRepository; repository?: LeaveMutationRepository; now?: () => string; id?: () => string } = {}) {
  const scope = await resolveOperationalScopeForActor(actorUid, {}, dependencies.operationalScopeRepository || createFirestoreOperationalScopeRepository());
  if (!scope.authorized || scope.queryPlan.denyAll) return { success: false, code: scope.code || "OPERATIONAL_SCOPE_DENIED" };
  const allowed = new Set(scope.subjectUids); const repository = dependencies.repository || createFirestoreLeaveMutationRepository(); const now = (dependencies.now || (() => new Date().toISOString()))();
  if (request.action === "CREATE") {
    if (!allowed.has(request.userId) || (scope.subjectMode === "SELF" && request.userId !== actorUid)) return { success: false, code: "LEAVE_SUBJECT_DENIED" };
    const id = (dependencies.id || (() => `LEAVE-${randomUUID()}`))();
    await repository.create(id, { id, userId: request.userId, category: request.category, startDate: request.startDate, endDate: request.endDate, reason: request.reason, status: "PENDING", createdBy: actorUid, createdAt: now, updatedBy: actorUid, updatedAt: now });
    return { success: true, requestId: id };
  }
  if (scope.subjectMode === "SELF") return { success: false, code: "LEAVE_APPROVAL_DENIED" };
  const success = await repository.decide(request.requestId, [...allowed], { status: request.action === "APPROVE" ? "APPROVED" : "REJECTED", decidedBy: actorUid, decidedAt: now, updatedBy: actorUid, updatedAt: now });
  return success ? { success: true, requestId: request.requestId } : { success: false, code: "LEAVE_NOT_FOUND_OR_STALE" };
}
