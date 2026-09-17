import type { Firestore, Transaction } from "firebase-admin/firestore";
import { getFirebaseAdminServices } from "./firebaseAdmin";
import { createFirestoreOrganizationalHierarchyRepository } from "./organizationalHierarchyRepository";
import { resolveOrganizationalScope } from "./organizationalHierarchyService";
import { buildSampleRequestDecision } from "../src/lib/sampleRequestLifecycleService";
import { hasSampleCapability } from "../src/lib/sampleAuthorization";
import type { Permissions, SampleRequest, User } from "../src/types";

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const withoutUndefined = <T extends Record<string, unknown>>(value: T): T => Object.fromEntries(
  Object.entries(value).filter(([, field]) => field !== undefined),
) as T;
const active = (value: any) => value && value.isDeleted !== true && value.active !== false && value.loginAllowed !== false
  && !["Inactive", "Archived", "Suspended"].includes(text(value.status))
  && !["Inactive", "Archived", "Suspended"].includes(text(value.employmentStatus));

export class SampleApprovalError extends Error {
  constructor(public readonly code: string, public readonly httpStatus = 409) { super(code); }
}

export interface SampleApprovalDecisionRequest {
  requestId: string;
  decision: "APPROVED" | "REJECTED";
  approvedQuantity?: number;
  rejectionReason?: string;
}

export function authorizeSampleApprovalDecision(input: {
  actor: User;
  permissions?: Permissions;
  descendantUids: readonly string[];
  request: SampleRequest;
  decision: SampleApprovalDecisionRequest;
  approvalAlreadyExists?: boolean;
  occurredAt: string;
}) {
  if (!active(input.actor)) throw new SampleApprovalError("SAMPLE_APPROVAL_ACTOR_INACTIVE", 403);
  const capability = input.decision.decision === "APPROVED" ? "APPROVE_SAMPLE_REQUEST" : "REJECT_SAMPLE_REQUEST";
  if (!hasSampleCapability(input.actor, capability, input.permissions)) throw new SampleApprovalError("SAMPLE_APPROVAL_CAPABILITY_DENIED", 403);
  const request = input.request;
  if (!text(request.repId) || request.repId !== request.requesterId || request.repId !== request.createdBy) throw new SampleApprovalError("SAMPLE_REQUEST_OWNERSHIP_INVALID", 403);
  if (request.repId === input.actor.id) throw new SampleApprovalError("SELF_APPROVAL_PROHIBITED", 403);
  if (!input.descendantUids.includes(request.repId)) throw new SampleApprovalError("SAMPLE_REQUEST_DESCENDANT_DENIED", 403);
  if (input.approvalAlreadyExists || request.status !== "PENDING_APPROVAL") throw new SampleApprovalError("REQUEST_NOT_PENDING", 409);
  try {
    return buildSampleRequestDecision({
      approvalId: `SAP-${request.id}`, request, approverId: input.actor.id,
      decision: input.decision.decision, approvedQuantity: input.decision.approvedQuantity,
      rejectionReason: input.decision.rejectionReason, occurredAt: input.occurredAt,
    });
  } catch (error: any) {
    throw new SampleApprovalError(text(error?.code) || "SAMPLE_APPROVAL_VALIDATION_FAILED", 409);
  }
}

export function parseSampleApprovalDecisionRequest(value: unknown): SampleApprovalDecisionRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(key => !["requestId", "decision", "approvedQuantity", "rejectionReason"].includes(key))) return null;
  const requestId = text(row.requestId), decision = text(row.decision);
  if (!requestId || !["APPROVED", "REJECTED"].includes(decision)) return null;
  const approvedQuantity = row.approvedQuantity === undefined ? undefined : Number(row.approvedQuantity);
  if (approvedQuantity !== undefined && (!Number.isInteger(approvedQuantity) || approvedQuantity < 0)) return null;
  return { requestId, decision: decision as SampleApprovalDecisionRequest["decision"], approvedQuantity, rejectionReason: text(row.rejectionReason) || undefined };
}

export async function executeSampleApprovalDecision(actorUid: string, input: SampleApprovalDecisionRequest, database?: Firestore) {
  const db = database || getFirebaseAdminServices().db;
  const [actorSnap, permissionsSnap] = await Promise.all([
    db.collection("users").doc(actorUid).get(),
    db.collection("users").doc(actorUid).get().then(snapshot => snapshot.exists
      ? db.collection("rolePermissions").doc(text(snapshot.data()?.role)).get()
      : null),
  ]);
  const actor = actorSnap.exists ? ({ id: actorSnap.id, ...actorSnap.data() } as User) : null;
  if (!active(actor)) throw new SampleApprovalError("SAMPLE_APPROVAL_ACTOR_INACTIVE", 403);
  const capability = input.decision === "APPROVED" ? "APPROVE_SAMPLE_REQUEST" : "REJECT_SAMPLE_REQUEST";
  const permissions = permissionsSnap?.exists ? permissionsSnap.data() as Permissions : undefined;
  if (!hasSampleCapability(actor!, capability, permissions)) throw new SampleApprovalError("SAMPLE_APPROVAL_CAPABILITY_DENIED", 403);

  const hierarchy = await resolveOrganizationalScope(actorUid, { depth: "descendants", includeSelf: false }, createFirestoreOrganizationalHierarchyRepository());
  const requestRef = db.collection("sampleRequests").doc(input.requestId);
  const approvalRef = db.collection("sampleApprovals").doc(`SAP-${input.requestId}`);
  const auditRef = db.collection("auditLogs").doc(`AUD-SAMPLE-${input.requestId}`);
  return db.runTransaction(async (tx: Transaction) => {
    const [requestSnap, existingApproval] = await Promise.all([tx.get(requestRef), tx.get(approvalRef)]);
    if (!requestSnap.exists) throw new SampleApprovalError("SAMPLE_REQUEST_NOT_FOUND", 404);
    const request = { id: requestSnap.id, ...requestSnap.data() } as SampleRequest;
    const occurredAt = new Date().toISOString();
    const result = authorizeSampleApprovalDecision({ actor: actor!, permissions, descendantUids: hierarchy.descendantUids, request, decision: input, approvalAlreadyExists: existingApproval.exists, occurredAt });
    tx.create(approvalRef, withoutUndefined(result.approval as unknown as Record<string, unknown>));
    tx.update(requestRef, result.request);
    tx.create(auditRef, {
      id: auditRef.id, userId: actorUid, userName: actor!.name || actorUid, userRole: actor!.role,
      action: `Sample Request ${input.decision}`, entityType: "SampleApproval", entityId: input.requestId,
      details: `${input.decision} sample request ${input.requestId} for representative ${request.repId}`,
      timestamp: occurredAt, createdAt: occurredAt, createdBy: actorUid,
    });
    return { success: true, requestId: request.id, approvalId: result.approval.id, requestStatus: result.request.status, approvedQuantity: result.approval.approvedQuantity, approverId: actorUid, approverName: actor!.name || actorUid };
  });
}
