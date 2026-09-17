import { randomUUID } from "node:crypto";
import { applyOrderTransition, normalizeOrderStatus } from "../src/features/orders/orderWorkflowEngine";
import { classifyInventoryContract } from "../src/features/orders/inventoryContractClassifier";
import {
  createFirestoreWorkflowQueueScopeRepository,
  type WorkflowQueueScopeRepository,
} from "./workflowQueueScopeRepository";
import { resolveWorkflowQueueScope, type WorkflowQueueStatus } from "./workflowQueueScopeService";
import {
  createFirestoreOrderOperationsTransitionRepository,
  type OrderOperationsTransitionRepository,
} from "./orderOperationsTransitionRepository";

export type OperationsAction =
  | "OPERATIONS_APPROVE"
  | "OPERATIONS_REJECT"
  | "OPERATIONS_RETURN_TO_FINANCE"
  | "OPERATIONS_RETURN_TO_REP";

export type OrderOperationsTransitionCode =
  | "INVALID_REQUEST"
  | "WORKFLOW_SCOPE_DENIED"
  | "ORDER_NOT_FOUND"
  | "ORDER_STATUS_NOT_AUTHORIZED"
  | "ORDER_GEOGRAPHY_DENIED"
  | "ORDER_GEOGRAPHY_UNRESOLVED"
  | "CREATOR_IDENTITY_UNRESOLVED"
  | "COMMENTS_REQUIRED"
  | "STALE_ORDER_VERSION"
  | "TRANSITION_DENIED";

export interface OrderOperationsTransitionRequest {
  orderId: string;
  action: OperationsAction;
  comments?: string;
  expectedStatus: WorkflowQueueStatus;
  expectedVersion: string;
}

export interface OrderOperationsTransitionResult {
  success: boolean;
  code?: OrderOperationsTransitionCode | string;
  orderId?: string;
  previousStatus?: string;
  currentStatus?: string;
  updatedAt?: string;
  transition?: { action: OperationsAction; actorUid: string; actorRole: "Order Operations Officer"; createdAt: string };
}

export interface OrderOperationsTransitionDependencies {
  workflowScopeRepository: WorkflowQueueScopeRepository;
  transitionRepository: OrderOperationsTransitionRepository;
  now(): string;
  auditId(): string;
}

const ACTIONS = new Set<OperationsAction>([
  "OPERATIONS_APPROVE", "OPERATIONS_REJECT", "OPERATIONS_RETURN_TO_FINANCE", "OPERATIONS_RETURN_TO_REP",
]);
const COMMENT_ACTIONS = new Set<OperationsAction>([
  "OPERATIONS_REJECT", "OPERATIONS_RETURN_TO_FINANCE", "OPERATIONS_RETURN_TO_REP",
]);

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function parseOrderOperationsTransitionRequest(input: unknown): OrderOperationsTransitionRequest | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const body = input as Record<string, unknown>;
  const allowedKeys = new Set(["orderId", "action", "comments", "expectedStatus", "expectedVersion"]);
  if (Object.keys(body).some((key) => !allowedKeys.has(key))) return null;
  const orderId = text(body.orderId);
  const action = text(body.action) as OperationsAction;
  const expectedStatus = text(body.expectedStatus) as WorkflowQueueStatus;
  const expectedVersion = text(body.expectedVersion);
  const comments = body.comments === undefined ? undefined : text(body.comments);
  if (!orderId || orderId.length > 256 || !ACTIONS.has(action) || !expectedVersion || expectedVersion.length > 256) return null;
  if (!(["FINANCE_APPROVED", "PENDING_OPERATIONS_REVIEW"] as string[]).includes(expectedStatus)) return null;
  if (body.comments !== undefined && typeof body.comments !== "string") return null;
  return { orderId, action, expectedStatus, expectedVersion, ...(comments ? { comments } : {}) };
}

function creatorUid(order: Record<string, any>): string {
  return text(order.createdByUid) || text(order.salesRepUid);
}

function canonicalArea(order: Record<string, any>): string {
  return text(order.areaId) || text(order.territoryId);
}

function operationPatch(updated: Record<string, any>, action: OperationsAction): Record<string, any> {
  const keys = [
    "status", "stage", "updatedAt", "history", "operationsReviewedAt", "operationsReviewedByUid",
    "opsApprovedAt", "opsApprovedByUid", "opsApprovedByName", "opsApprovedByEmail", "opsRemarks", "rejectionReason",
  ];
  const patch: Record<string, any> = {};
  for (const key of keys) if (updated[key] !== undefined) patch[key] = updated[key];
  patch.lastWorkflowAction = action;
  return patch;
}

export async function executeOrderOperationsTransition(
  authenticatedActorUid: string,
  request: OrderOperationsTransitionRequest,
  dependencies?: Partial<OrderOperationsTransitionDependencies>,
): Promise<OrderOperationsTransitionResult> {
  const deps: OrderOperationsTransitionDependencies = {
    workflowScopeRepository: dependencies?.workflowScopeRepository || createFirestoreWorkflowQueueScopeRepository(),
    transitionRepository: dependencies?.transitionRepository || createFirestoreOrderOperationsTransitionRepository(),
    now: dependencies?.now || (() => new Date().toISOString()),
    auditId: dependencies?.auditId || (() => `AUD-${randomUUID()}`),
  };
  const scope = await resolveWorkflowQueueScope(authenticatedActorUid, { resource: "orders" }, deps.workflowScopeRepository);
  if (!scope.authorized || scope.queryPlan.denyAll || scope.resource !== "orders") {
    return { success: false, code: scope.code || "WORKFLOW_SCOPE_DENIED" };
  }

  return deps.transitionRepository.runTransaction(request.orderId, async (context) => {
    if (!context.order) return { success: false, code: "ORDER_NOT_FOUND" };
    const current = context.order.data;
    const currentStatus = normalizeOrderStatus(current.status);
    if (!scope.allowedStatuses.includes(currentStatus as WorkflowQueueStatus)) {
      return { success: false, code: "ORDER_STATUS_NOT_AUTHORIZED", orderId: request.orderId };
    }
    if (currentStatus !== request.expectedStatus || context.order.version !== request.expectedVersion) {
      return { success: false, code: "STALE_ORDER_VERSION", orderId: request.orderId, currentStatus };
    }

    let areaId = canonicalArea(current);
    if (!areaId) {
      const pharmacyId = text(current.pharmacyId);
      if (!pharmacyId) return { success: false, code: "ORDER_GEOGRAPHY_UNRESOLVED", orderId: request.orderId };
      const pharmacy = await context.getPharmacy(pharmacyId);
      if (!pharmacy) return { success: false, code: "ORDER_GEOGRAPHY_UNRESOLVED", orderId: request.orderId };
      areaId = canonicalArea(pharmacy);
      if (!areaId) return { success: false, code: "ORDER_GEOGRAPHY_UNRESOLVED", orderId: request.orderId };
    }
    if (!scope.areaIds.includes(areaId)) return { success: false, code: "ORDER_GEOGRAPHY_DENIED", orderId: request.orderId };
    if (!creatorUid(current)) return { success: false, code: "CREATOR_IDENTITY_UNRESOLVED", orderId: request.orderId };
    if (COMMENT_ACTIONS.has(request.action) && !text(request.comments)) {
      return { success: false, code: "COMMENTS_REQUIRED", orderId: request.orderId };
    }

    const transition = applyOrderTransition({
      order: current,
      action: request.action,
      actor: { uid: authenticatedActorUid, role: "Order Operations Officer", name: "Order Operations Officer" },
      comments: request.comments,
      source: "BACKEND",
    });
    if (!transition.success || !transition.historyEntry) {
      return { success: false, code: transition.reasonCode || "TRANSITION_DENIED", orderId: request.orderId };
    }
    const inventoryContract = classifyInventoryContract(current);
    if (request.action === "OPERATIONS_REJECT" && inventoryContract.kind === "INTEGRITY_ERROR") {
      return { success: false, code: inventoryContract.code, orderId: request.orderId };
    }
    if (request.action === "OPERATIONS_REJECT" && inventoryContract.version2) {
      if (!context.releaseVersion2Reservation) return { success: false, code: "VERSION2_RESERVATION_AUTHORITY_UNAVAILABLE", orderId: request.orderId };
      try { await context.releaseVersion2Reservation(current, authenticatedActorUid, request.comments); }
      catch (error) { return { success: false, code: error instanceof Error ? error.message : "INVENTORY_RESERVATION_RELEASE_FAILED", orderId: request.orderId }; }
    }
    const now = deps.now();
    transition.updatedOrder.updatedAt = now;
    transition.historyEntry.createdAt = now;
    const history = Array.isArray(current.history) ? [...current.history, transition.historyEntry] : [transition.historyEntry];
    transition.updatedOrder.history = history;
    const patch = operationPatch(transition.updatedOrder, request.action);
    const audit = {
      id: deps.auditId(), actorUid: authenticatedActorUid, actorRole: "Order Operations Officer",
      action: request.action, entityType: "Order", entityId: request.orderId,
      previousStatus: currentStatus, currentStatus: transition.updatedOrder.status, createdAt: now,
    };
    context.write(patch, audit);
    return {
      success: true,
      orderId: request.orderId,
      previousStatus: currentStatus,
      currentStatus: transition.updatedOrder.status,
      updatedAt: now,
      transition: { action: request.action, actorUid: authenticatedActorUid, actorRole: "Order Operations Officer", createdAt: now },
    };
  });
}
