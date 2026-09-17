import { randomUUID } from "node:crypto";
import { applyOrderTransitionWithTemplate, ENTERPRISE_WORKFLOW_TEMPLATE } from "../src/features/orders/orderWorkflowTemplate";
import { requireCanonicalWorkflowTemplate } from "./pharmacyOrderCreateService";
import { getFirebaseAdminServices } from "./firebaseAdmin";
import { createFirestoreOperationalScopeRepository, resolveOperationalScopeForActor } from "./operationalScopeRepository";
import type { Firestore } from "firebase-admin/firestore";
import type { OperationalScopeRepository } from "./operationalScopeRepository";
import { applyReservationEffectInTransaction, InventoryReservationError, requireConsumedReservationsInTransaction } from "./inventoryReservationService";
import { classifyInventoryContract } from "../src/features/orders/inventoryContractClassifier";
import { createFirestoreDeliveredInvoicePostingRepository } from "./deliveredInvoicePostingRepository";
import { prepareDeliveredInvoicePosting } from "./deliveredInvoicePostingService";

const ACTIONS = new Set(["APPROVE_FINANCE", "FINANCE_APPROVE", "FINANCE_REJECT", "FINANCE_RETURN", "STORE_START_PREPARE", "STORE_MARK_READY", "STORE_REJECT", "STORE_RETURN_TO_OPS", "DELIVERY_START", "DELIVERY_COMPLETE", "DELIVERY_PARTIAL", "DELIVERY_REFUSE", "DELIVERY_FAIL", "DELIVERY_RETURN", "DELIVERY_POSTPONE", "CANCEL"]);
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
export interface CommercialOrderTransitionRequest { orderId: string; action: string; comments?: string; expectedVersion: string; metadata?: Record<string, unknown> }
export function parseCommercialOrderTransition(body: unknown): CommercialOrderTransitionRequest | null { if (!body || typeof body !== "object" || Array.isArray(body)) return null; const value = body as Record<string, unknown>; if (Object.keys(value).some(key => !["orderId", "action", "comments", "expectedVersion", "metadata"].includes(key))) return null; const orderId = text(value.orderId), action = text(value.action), expectedVersion = text(value.expectedVersion), comments = text(value.comments); if (!orderId || !ACTIONS.has(action) || !expectedVersion || (value.metadata !== undefined && (!value.metadata || typeof value.metadata !== "object" || Array.isArray(value.metadata)))) return null; return { orderId, action, expectedVersion, ...(comments ? { comments } : {}), ...(value.metadata ? { metadata: value.metadata as Record<string, unknown> } : {}) }; }
export function canonicalDeliveryMetadata(action: string, metadata?: Record<string, unknown>): { metadata?: Record<string, unknown>; code?: string } {
  if (!action.startsWith("DELIVERY_")) return { metadata };
  const source = metadata || {};
  const boundedText = (value: unknown, maximum = 512) => { const result = text(value); return result.length <= maximum ? result : ""; };
  const recipientName = boundedText(source.recipientName, 256);
  if (action === "DELIVERY_COMPLETE" && !recipientName) return { code: "DELIVERY_RECIPIENT_REQUIRED" };
  const photos = Array.isArray(source.deliveryPhotos) ? source.deliveryPhotos.map(item => boundedText(item, 2048)).filter(Boolean).slice(0, 20) : [];
  const sanitizedMetadata: Record<string, unknown> = {
    ...(recipientName ? { recipientName } : {}),
    ...(boundedText(source.deliverySignature, 2048) ? { deliverySignature: boundedText(source.deliverySignature, 2048) } : {}),
    ...(boundedText(source.deliveryReceipt, 2048) ? { deliveryReceipt: boundedText(source.deliveryReceipt, 2048) } : {}),
    ...(photos.length ? { deliveryPhotos: photos } : {}),
    ...(source.deliveryGPS && (typeof source.deliveryGPS === "string" || typeof source.deliveryGPS === "object") ? { deliveryGPS: source.deliveryGPS } : {}),
    ...(boundedText(source.newDeliveryDate, 10) ? { newDeliveryDate: boundedText(source.newDeliveryDate, 10) } : {}),
    ...(boundedText(source.plannedDeliveryDate, 10) ? { plannedDeliveryDate: boundedText(source.plannedDeliveryDate, 10) } : {}),
  };
  return { metadata: sanitizedMetadata };
}
const sanitized = (value: unknown): unknown => { if (Array.isArray(value)) return value.map(sanitized); if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).map(([key, item]) => [key, sanitized(item)])); return value; };

export interface CommercialOrderTransitionDependencies { db?: Firestore; operationalScopeRepository?: OperationalScopeRepository; now?: () => Date }
export async function executeCommercialOrderTransition(actorUid: string, request: CommercialOrderTransitionRequest, dependencies: CommercialOrderTransitionDependencies = {}) {
  return executeTransition(actorUid, request, dependencies, false);
}

/** Dormant: no route or UI caller. Activation requires financial write protection and Visit convergence. */
export async function executeAtomicCommercialDeliveryCompletion(actorUid: string, request: CommercialOrderTransitionRequest, dependencies: CommercialOrderTransitionDependencies = {}) {
  if (request.action !== "DELIVERY_COMPLETE") return { success: false, code: "ATOMIC_DELIVERY_COMPLETE_REQUIRED" };
  return executeTransition(actorUid, request, dependencies, true);
}

// The composition choice is private server code, never a request/dependency flag.
async function executeTransition(actorUid: string, request: CommercialOrderTransitionRequest, dependencies: CommercialOrderTransitionDependencies, atomicCompletion: boolean) {
  const scope = await resolveOperationalScopeForActor(actorUid, {}, dependencies.operationalScopeRepository || createFirestoreOperationalScopeRepository()); if (!scope.authorized || scope.queryPlan.denyAll) return { success: false, code: scope.code || "ORDER_SCOPE_DENIED" };
  const canonicalMetadata = canonicalDeliveryMetadata(request.action, request.metadata); if (canonicalMetadata.code) return { success: false, code: canonicalMetadata.code };
  const db = dependencies.db || getFirebaseAdminServices().db; const actorSnap = await db.collection("users").doc(actorUid).get(); if (!actorSnap.exists) return { success: false, code: "ACTOR_NOT_FOUND" }; const actor = actorSnap.data()!;
  const orderRef = db.collection("orders").doc(request.orderId); const templateRef = db.collection("orderWorkflowTemplates").doc(ENTERPRISE_WORKFLOW_TEMPLATE.templateId);
  return db.runTransaction(async transaction => { const [orderSnap, templateSnap] = await Promise.all([transaction.get(orderRef), transaction.get(templateRef)]); if (!orderSnap.exists) return { success: false, code: "ORDER_NOT_FOUND" }; const order = { id: orderSnap.id, ...orderSnap.data() } as Record<string, any>; if (text(order.updatedAt || order.createdAt) !== request.expectedVersion) return { success: false, code: "STALE_ORDER_VERSION" };
    const inventoryContract = classifyInventoryContract(order);
    if (inventoryContract.kind === "INTEGRITY_ERROR") return { success: false, code: inventoryContract.code };
    if (inventoryContract.version2 && request.action === "DELIVERY_PARTIAL") return { success: false, code: "VERSION2_PARTIAL_DELIVERY_PROHIBITED" };
    if (inventoryContract.version2 && ["DELIVERY_COMPLETE", "DELIVERY_REFUSE", "DELIVERY_FAIL"].includes(request.action) && text(order.status) !== "OUT_FOR_DELIVERY") return { success: false, code: "VERSION2_DELIVERY_START_REQUIRED" };
    if (inventoryContract.version2 && request.action === "DELIVERY_RETURN" && request.metadata && Object.keys(request.metadata).some(key => /quantity|items|lines/i.test(key))) return { success: false, code: "VERSION2_PARTIAL_RETURN_PROHIBITED" };
    let areaId = text(order.areaId || order.territoryId); if (!areaId && text(order.pharmacyId)) { const pharmacy = await transaction.get(db.collection("pharmacies").doc(text(order.pharmacyId))); areaId = pharmacy.exists ? text(pharmacy.data()?.areaId || pharmacy.data()?.territoryId) : ""; } if (!areaId || !scope.areaIds.includes(areaId)) return { success: false, code: "ORDER_GEOGRAPHY_DENIED" };
    if (scope.role === "Delivery Officer" && ![order.deliveryOfficerUid, order.deliveryOfficerId, order.assignedDeliveryOfficerUid].map(text).includes(actorUid)) return { success: false, code: "DELIVERY_ASSIGNMENT_DENIED" };
    let template; try { template = requireCanonicalWorkflowTemplate(templateSnap.exists ? templateSnap.data() : null); } catch (error) { return { success: false, code: error instanceof Error ? error.message : "ORDER_WORKFLOW_CONFIGURATION_REQUIRED" }; } const result = applyOrderTransitionWithTemplate({ template, order, action: request.action, actor: { uid: actorUid, role: scope.role, name: text(actor.name || actor.fullName || actor.email) || scope.role }, comments: request.comments, metadata: canonicalMetadata.metadata, source: "BACKEND" }); if (!result.success || !result.historyEntry) return { success: false, code: result.reasonCode || "TRANSITION_DENIED" };
    try {
      if (inventoryContract.version2 && ["DELIVERY_COMPLETE", "DELIVERY_REFUSE", "DELIVERY_FAIL", "DELIVERY_RETURN"].includes(request.action)) await requireConsumedReservationsInTransaction(db, transaction, order);
      if (request.action === "DELIVERY_START") await applyReservationEffectInTransaction(db, transaction, order, actorUid, "CONSUME");
      else if (request.action === "DELIVERY_RETURN") await applyReservationEffectInTransaction(db, transaction, order, actorUid, "RESTORE_RETURN", request.comments);
      else if (request.action === "FINANCE_REJECT" || request.action === "STORE_REJECT" || request.action === "CANCEL") await applyReservationEffectInTransaction(db, transaction, order, actorUid, "RELEASE", request.comments);
    } catch (error) {
      if (error instanceof InventoryReservationError) return { success: false, code: error.code };
      throw error;
    }
    const now = (dependencies.now || (() => new Date()))().toISOString(); result.updatedOrder.updatedAt = now; result.historyEntry.createdAt = now; const history = [...(Array.isArray(order.history) ? order.history : []), result.historyEntry]; const updatedOrder = sanitized({ ...result.updatedOrder, history, areaId, updatedBy: actorUid }) as Record<string, any>;
    if (atomicCompletion) {
      if (updatedOrder.id !== orderSnap.id || updatedOrder.paidStatus !== order.paidStatus || updatedOrder.paidAmount !== order.paidAmount) {
        throw new Error("ATOMIC_DELIVERY_ORDER_INVARIANT_FAILED");
      }
      // Completion only reads consumed reservations above. Acquire all posting
      // dependencies before either posting or Order/audit writes are queued.
      const postingRepository = createFirestoreDeliveredInvoicePostingRepository({ db, transaction });
      const posting = await postingRepository.runTransaction(actorUid, request.orderId, context =>
        prepareDeliveredInvoicePosting(actorUid, {
          ...context,
          // Firestore still contains OUT_FOR_DELIVERY. Use only the state
          // prepared by the validated server transition, never request metadata.
          order: { ...updatedOrder, id: orderSnap.id },
        }, () => now));
      if (!posting.success) throw new Error(posting.code || "DELIVERED_INVOICE_POSTING_FAILED");
    }
    transaction.set(orderRef, updatedOrder, { merge: true }); const auditId = `ORDER-${randomUUID()}`; transaction.create(db.collection("auditLogs").doc(auditId), { id: auditId, userId: actorUid, userName: text(actor.name || actor.email) || scope.role, userRole: scope.role, action: request.action, entityName: "Order", entityId: request.orderId, previousStatus: order.status, currentStatus: updatedOrder.status, timestamp: now, createdAt: now }); return { success: true, order: updatedOrder, transition: result.historyEntry };
  });
}
