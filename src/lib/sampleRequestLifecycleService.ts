import { doc, setDoc, writeBatch } from "firebase/firestore";
import { db } from "./firebase";
import { createSampleRequest, decideSampleRequest, SampleDomainError } from "./sampleDomainService";
import { approvedRemaining } from "./sampleStockService";
import type { SampleAllocation, SampleApproval, SampleRequest, SampleSku, User } from "../types";
import { prepareSampleWrite } from "./samplePersistence";

export interface CanonicalRequestInput {
  id: string;
  authenticatedRequesterId: string;
  repId?: string;
  sampleSku: SampleSku;
  quantityRequested: number;
  reason: string;
  requestedForPhysicianId?: string;
  intendedPhysicianExists?: boolean;
  authorizedProductIds?: readonly string[];
  visitId?: string;
  source: "STANDALONE" | "PHYSICIAN_VISIT";
  urgent: boolean;
  occurredAt: string;
}

export function buildCanonicalSampleRequest(input: CanonicalRequestInput): SampleRequest {
  const repId = input.repId?.trim() || input.authenticatedRequesterId.trim();
  if (!input.authenticatedRequesterId.trim() || repId !== input.authenticatedRequesterId.trim()) {
    throw new SampleDomainError("REQUESTER_IDENTITY_MISMATCH", "A representative can create only their own Sample Request.");
  }
  if (input.requestedForPhysicianId && input.intendedPhysicianExists === false) {
    throw new SampleDomainError("PHYSICIAN_NOT_FOUND", "The intended physician does not exist.");
  }
  if (input.source === "PHYSICIAN_VISIT" && !input.visitId?.trim()) {
    throw new SampleDomainError("VISIT_ID_REQUIRED", "Physician Visit requests require a visit ID.");
  }
  if (input.authorizedProductIds && !input.authorizedProductIds.includes(input.sampleSku.productId)) {
    throw new SampleDomainError("SAMPLE_REQUEST_PRODUCT_SCOPE_DENIED", "The requester is not assigned to this Sample SKU's Product.");
  }
  return createSampleRequest({
    id: input.id,
    repId,
    sampleSkuId: input.sampleSku.id,
    productId: input.sampleSku.productId,
    quantityRequested: input.quantityRequested,
    reason: input.reason,
    requestedForPhysicianId: input.requestedForPhysicianId,
    visitId: input.visitId,
    source: input.source,
    urgent: input.urgent,
    occurredAt: input.occurredAt
  }, input.sampleSku);
}

export function createStandaloneSampleRequest(input: Omit<CanonicalRequestInput, "source" | "visitId">): SampleRequest {
  return buildCanonicalSampleRequest({ ...input, source: "STANDALONE" });
}

export function createPhysicianVisitSampleRequest(input: Omit<CanonicalRequestInput, "source">): SampleRequest {
  return buildCanonicalSampleRequest({ ...input, source: "PHYSICIAN_VISIT" });
}

export async function persistCanonicalSampleRequest(request: SampleRequest): Promise<void> {
  await setDoc(doc(db, "sampleRequests", request.id), prepareSampleWrite("sampleRequests", request.id, request, request.createdBy, "create"));
}

export function buildSampleRequestDecision(input: {
  approvalId: string;
  request: SampleRequest;
  approverId: string;
  decision: "APPROVED" | "REJECTED";
  approvedQuantity?: number;
  rejectionReason?: string;
  reason?: string;
  occurredAt: string;
}): { approval: SampleApproval; request: SampleRequest } {
  if (input.request.repId === input.approverId || input.request.requesterId === input.approverId) {
    throw new SampleDomainError("SELF_APPROVAL_PROHIBITED", "A requester cannot decide their own Sample Request.");
  }
  const decision = decideSampleRequest(input);
  const approval: SampleApproval = {
    ...decision.approval,
    repId: input.request.repId,
    sampleSkuId: input.request.sampleSkuId,
    productId: input.request.productId,
    quantityRequested: input.request.quantityRequested
  };
  return {
    approval,
    request: {
      ...decision.request,
      approvedQuantity: approval.approvedQuantity,
      approvalId: approval.id,
      allocatedQuantity: input.request.allocatedQuantity || 0
    }
  };
}

export async function persistSampleRequestDecision(decision: { approval: SampleApproval; request: SampleRequest }, actorId: string): Promise<void> {
  const batch = writeBatch(db);
  batch.set(doc(db, "sampleApprovals", decision.approval.id), prepareSampleWrite("sampleApprovals", decision.approval.id, decision.approval, actorId, "create"));
  batch.set(doc(db, "sampleRequests", decision.request.id), prepareSampleWrite("sampleRequests", decision.request.id, decision.request, actorId, "update"));
  await batch.commit();
}

export function cancelPendingSampleRequest(request: SampleRequest, actorId: string, occurredAt: string, reason?: string): SampleRequest {
  if (request.repId !== actorId || request.requesterId !== actorId) {
    throw new SampleDomainError("REQUEST_CANCEL_SCOPE_DENIED", "Only the requester may cancel this Sample Request.");
  }
  if (request.status !== "PENDING_APPROVAL") {
    throw new SampleDomainError("REQUEST_NOT_CANCELLABLE", "Only pending Sample Requests can be cancelled.");
  }
  return { ...request, status: "CANCELLED", cancelledAt: occurredAt, cancelledBy: actorId, cancellationReason: reason?.trim() || undefined, updatedAt: occurredAt, updatedBy: actorId };
}

export async function persistSampleRequestCancellation(request: SampleRequest, actorId: string): Promise<void> {
  await setDoc(doc(db, "sampleRequests", request.id), prepareSampleWrite("sampleRequests", request.id, request, actorId, "update"));
}

export interface ApprovedRequestQueueItem {
  request: SampleRequest;
  approval: SampleApproval;
  allocatedTotal: number;
  remainingApproved: number;
}

export function buildApprovedRequestQueue(requests: readonly SampleRequest[], approvals: readonly SampleApproval[], allocations: readonly SampleAllocation[]): ApprovedRequestQueueItem[] {
  return requests
    .filter(request => request.status === "AWAITING_ALLOCATION" || request.status === "PARTIALLY_ALLOCATED")
    .flatMap(request => {
      const approval = approvals.find(item => item.id === request.approvalId || (item.requestId === request.id && item.decision === "APPROVED"));
      if (!approval) return [];
      const remainingApproved = approvedRemaining(approval.approvedQuantity, allocations, request.id);
      return [{ request, approval, allocatedTotal: approval.approvedQuantity - remainingApproved, remainingApproved }];
    })
    .filter(item => item.remainingApproved > 0)
    .sort((a, b) => Number(b.request.urgent) - Number(a.request.urgent) || a.request.createdAt.localeCompare(b.request.createdAt));
}

export function resolveSampleRequestApproverCandidates(requesterId: string, users: readonly User[], authorizedApproverIds: readonly string[]): User[] {
  const byId = new Map(users.map(user => [user.id, user]));
  const candidates: User[] = [];
  const visited = new Set<string>();
  let managerId = byId.get(requesterId)?.managerId;
  while (managerId && !visited.has(managerId)) {
    visited.add(managerId);
    const manager = byId.get(managerId);
    if (!manager) break;
    if (authorizedApproverIds.includes(manager.id)) candidates.push(manager);
    managerId = manager.managerId;
  }
  return candidates;
}
