import { createHash } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { getFirebaseAdminServices } from "./firebaseAdmin";
import { createFirestoreOrganizationalHierarchyRepository } from "./organizationalHierarchyRepository";
import { resolveOrganizationalScope } from "./organizationalHierarchyService";
import { hasSampleCapability } from "../src/lib/sampleAuthorization";
import type { Permissions, SampleAllocation, SampleBatch, SampleRequest, SampleSku, User } from "../src/types";
import { addCalendarDays, isCanonicalDate } from "./sampleDistributionPolicy";

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const active = (value: any) => value && value.isDeleted !== true && value.active !== false && value.loginAllowed !== false && !["Inactive", "Archived", "Suspended"].includes(text(value.status));
const hash = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 32);
const clean = <T extends Record<string, unknown>>(value: T) => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
const positive = (value: unknown) => Number.isInteger(Number(value)) && Number(value) > 0;
export class SampleMutationError extends Error { constructor(public code: string, public httpStatus = 409) { super(code); } }

export interface SampleAdjustmentCommand { idempotencyKey: string; sampleSkuId: string; batchId: string; targetAvailableQuantity: number; reason: string; notes?: string; }
export function parseSampleAdjustmentCommand(value: unknown): SampleAdjustmentCommand | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  if (Object.keys(r).some(key => !["idempotencyKey", "sampleSkuId", "batchId", "targetAvailableQuantity", "reason", "notes"].includes(key))) return null;
  const command = { idempotencyKey: text(r.idempotencyKey), sampleSkuId: text(r.sampleSkuId), batchId: text(r.batchId), targetAvailableQuantity: Number(r.targetAvailableQuantity), reason: text(r.reason), notes: text(r.notes) || undefined };
  return command.idempotencyKey && command.sampleSkuId && command.batchId && Number.isInteger(command.targetAvailableQuantity) && command.targetAvailableQuantity >= 0 && command.reason ? command : null;
}

async function actorContext(actorUid: string, capability: Parameters<typeof hasSampleCapability>[1], db: Firestore) {
  const actorSnap = await db.collection("users").doc(actorUid).get();
  const actor = actorSnap.exists ? ({ id: actorSnap.id, ...actorSnap.data() } as User) : null;
  if (!actor || !active(actor)) throw new SampleMutationError("SAMPLE_MUTATION_ACTOR_DENIED", 403);
  const permissionSnap = await db.collection("rolePermissions").doc(text(actor.role)).get();
  const permissions = permissionSnap.exists ? permissionSnap.data() as Permissions : undefined;
  if (!hasSampleCapability(actor, capability, permissions)) throw new SampleMutationError("SAMPLE_MUTATION_CAPABILITY_DENIED", 403);
  return { actor, permissions };
}

export async function executeSampleAdjustment(actorUid: string, command: SampleAdjustmentCommand, database?: Firestore) {
  const db = database || getFirebaseAdminServices().db, { actor } = await actorContext(actorUid, "ADJUST_SAMPLE_STOCK", db);
  const opId = `SAD-${hash(`${actorUid}|${command.idempotencyKey}`)}`, opRef = db.collection("sampleOperationKeys").doc(opId), now = new Date().toISOString();
  const prior = await opRef.get();
  if (prior.exists) return { success: true, replayed: true };
  const batchRef = db.collection("sampleBatches").doc(command.batchId), inventoryRef = db.collection("sampleInventory").doc(command.sampleSkuId);
  return db.runTransaction(async tx => {
    const [operation, batch, inventory] = await Promise.all([tx.get(opRef), tx.get(batchRef), tx.get(inventoryRef)]);
    if (operation.exists) return { success: true, replayed: true };
    if (!batch.exists || !inventory.exists || text(batch.data()?.sampleSkuId) !== command.sampleSkuId) throw new SampleMutationError("SAMPLE_ADJUSTMENT_RESOURCE_DENIED", 403);
    const delta = command.targetAvailableQuantity - Number(batch.data()?.availableQuantity || 0), nextInventory = Number(inventory.data()?.availableQuantity || 0) + delta;
    if (nextInventory < 0) throw new SampleMutationError("SAMPLE_ADJUSTMENT_NEGATIVE_STOCK");
    tx.update(batchRef, { availableQuantity: command.targetAvailableQuantity, status: command.targetAvailableQuantity === 0 ? "DEPLETED" : batch.data()?.status, updatedAt: now, updatedBy: actorUid });
    tx.update(inventoryRef, { availableQuantity: nextInventory, updatedAt: now, updatedBy: actorUid });
    tx.create(db.collection("sampleTransactions").doc(`SM-${opId}`), clean({ id: `SM-${opId}`, sampleSkuId: command.sampleSkuId, batchId: command.batchId, type: "ADJUSTMENT", quantity: delta, sourceId: command.batchId, sourceType: "MANUAL_ADJUSTMENT", actorId: actorUid, createdAt: now, notes: `${command.reason}${command.notes ? `: ${command.notes}` : ""}` }));
    tx.create(opRef, { id: opId, type: "SAMPLE_ADJUSTMENT", actorId: actorUid, createdAt: now });
    tx.create(db.collection("auditLogs").doc(`AUD-${opId}`), { id: `AUD-${opId}`, userId: actorUid, userName: actor.name, userRole: actor.role, action: "Sample Stock Adjusted", entityType: "SampleInventory", entityId: command.sampleSkuId, timestamp: now, createdAt: now, createdBy: actorUid });
    return { success: true, replayed: false };
  });
}

export interface SampleAllocationCommand { idempotencyKey: string; repId: string; sampleSkuId: string; quantity: number; requestId?: string; }
export function parseSampleAllocationCommand(value: unknown): SampleAllocationCommand | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null; const row = value as Record<string, unknown>;
  if (Object.keys(row).some(key => !["idempotencyKey", "repId", "sampleSkuId", "quantity", "requestId"].includes(key))) return null;
  const result = { idempotencyKey: text(row.idempotencyKey), repId: text(row.repId), sampleSkuId: text(row.sampleSkuId), quantity: Number(row.quantity), requestId: text(row.requestId) || undefined };
  return result.idempotencyKey && result.repId && result.sampleSkuId && positive(result.quantity) ? result : null;
}

export async function executeSampleAllocation(actorUid: string, command: SampleAllocationCommand, database?: Firestore) {
  const db = database || getFirebaseAdminServices().db, { actor } = await actorContext(actorUid, "ALLOCATE_SAMPLE_STOCK", db);
  const managerialRoles = ["Super Admin", "Admin", "General Manager", "Regional Manager", "Country Manager", "Sales & Marketing Manager", "Sales Manager", "Area Sales Manager", "Sales Supervisor", "Medical Manager", "Medical Supervisor"];
  if (!managerialRoles.includes(text(actor.role))) throw new SampleMutationError("SAMPLE_ALLOCATION_ROLE_DENIED", 403);
  const hierarchy = await resolveOrganizationalScope(actorUid, { depth: "descendants", includeSelf: false }, createFirestoreOrganizationalHierarchyRepository());
  if (!["Super Admin", "Admin"].includes(text(actor.role)) && !hierarchy.descendantUids.includes(command.repId)) throw new SampleMutationError("SAMPLE_ALLOCATION_DESCENDANT_DENIED", 403);
  const operationId = `SAL-${hash(`${actorUid}|${command.idempotencyKey}`)}`, operationRef = db.collection("sampleOperationKeys").doc(operationId);
  const commandHash = hash(JSON.stringify(command)), priorOperation = await operationRef.get();
  if (priorOperation.exists) { if (priorOperation.data()?.commandHash !== commandHash) throw new SampleMutationError("SAMPLE_ALLOCATION_IDEMPOTENCY_CONFLICT"); return { success: true, replayed: true, allocationIds: priorOperation.data()?.allocationIds || [] }; }
  const [skuSnap, repSnap, batchQuery, inventorySnap, requestSnap] = await Promise.all([
    db.collection("sampleCatalog").doc(command.sampleSkuId).get(), db.collection("users").doc(command.repId).get(),
    db.collection("sampleBatches").where("sampleSkuId", "==", command.sampleSkuId).get(), db.collection("sampleInventory").doc(command.sampleSkuId).get(),
    command.requestId ? db.collection("sampleRequests").doc(command.requestId).get() : Promise.resolve(null),
  ]);
  const sku = skuSnap.exists ? ({ id: skuSnap.id, ...skuSnap.data() } as SampleSku) : null, rep = repSnap.data();
  if (!sku || !active(sku) || sku.status !== "ACTIVE" || !rep || !active(rep)) throw new SampleMutationError("SAMPLE_ALLOCATION_RESOURCE_DENIED", 403);
  const now = new Date().toISOString(), date = now.slice(0, 10);
  const eligible = batchQuery.docs.map(doc => ({ id: doc.id, ref: doc.ref, ...doc.data() } as any as SampleBatch & { ref: FirebaseFirestore.DocumentReference }))
    .filter(batch => active(batch) && batch.status === "AVAILABLE" && batch.availableQuantity > 0 && isCanonicalDate(batch.expiryDate.slice(0, 10)) && batch.expiryDate.slice(0, 10) >= date)
    .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate) || a.id.localeCompare(b.id));
  let remaining = command.quantity; const plan: Array<{ batch: typeof eligible[number]; quantity: number; index: number }> = [];
  for (const batch of eligible) { if (!remaining) break; const quantity = Math.min(remaining, Number(batch.availableQuantity)); plan.push({ batch, quantity, index: plan.length + 1 }); remaining -= quantity; }
  if (remaining) throw new SampleMutationError("INSUFFICIENT_CENTRAL_STOCK");
  const request = requestSnap?.exists ? ({ id: requestSnap.id, ...requestSnap.data() } as SampleRequest) : null;
  let approvalSnap: FirebaseFirestore.DocumentSnapshot | null = null, priorAllocations: FirebaseFirestore.QuerySnapshot | null = null;
  if (command.requestId) {
    if (!request || request.repId !== command.repId || request.sampleSkuId !== command.sampleSkuId || !["AWAITING_ALLOCATION", "PARTIALLY_ALLOCATED"].includes(request.status) || !request.approvalId) throw new SampleMutationError("SAMPLE_ALLOCATION_REQUEST_DENIED");
    [approvalSnap, priorAllocations] = await Promise.all([db.collection("sampleApprovals").doc(request.approvalId).get(), db.collection("sampleAllocations").where("requestId", "==", command.requestId).get()]);
    const approved = Number(approvalSnap.data()?.approvedQuantity || 0), already = priorAllocations.docs.filter(doc => doc.data().status !== "CANCELLED").reduce((sum, doc) => sum + Number(doc.data().quantityAllocated || 0), 0);
    if (!approvalSnap.exists || approvalSnap.data()?.decision !== "APPROVED" || command.quantity > approved - already) throw new SampleMutationError("APPROVED_QUANTITY_EXCEEDED");
  }
  return db.runTransaction(async (tx: Transaction) => {
    const replay = await tx.get(operationRef); if (replay.exists) return { success: true, replayed: true, allocationIds: replay.data()?.allocationIds || [] };
    const liveInventory = await tx.get(inventorySnap.ref); if (!liveInventory.exists || Number(liveInventory.data()?.availableQuantity || 0) < command.quantity) throw new SampleMutationError("INSUFFICIENT_CENTRAL_STOCK");
    const liveBatches = await Promise.all(plan.map(item => tx.get(item.batch.ref)));
    if (liveBatches.some((snap, index) => !snap.exists || snap.data()?.status !== "AVAILABLE" || Number(snap.data()?.availableQuantity || 0) < plan[index].quantity)) throw new SampleMutationError("INSUFFICIENT_CENTRAL_STOCK");
    let liveRequest: FirebaseFirestore.DocumentSnapshot | null = null;
    let liveApproval: FirebaseFirestore.DocumentSnapshot | null = null;
    let livePriorAllocations: FirebaseFirestore.QuerySnapshot | null = null;
    if (request && requestSnap) {
      liveRequest = await tx.get(db.collection("sampleRequests").doc(command.requestId!));
      const liveRequestData = liveRequest.data();
      if (!liveRequest.exists || liveRequestData?.repId !== command.repId || liveRequestData?.sampleSkuId !== command.sampleSkuId || !["AWAITING_ALLOCATION", "PARTIALLY_ALLOCATED"].includes(liveRequestData?.status) || !text(liveRequestData?.approvalId)) throw new SampleMutationError("SAMPLE_ALLOCATION_REQUEST_DENIED");
      liveApproval = await tx.get(db.collection("sampleApprovals").doc(text(liveRequestData?.approvalId)));
      livePriorAllocations = await tx.get(db.collection("sampleAllocations").where("requestId", "==", command.requestId));
      const approved = Number(liveApproval.data()?.approvedQuantity || 0);
      const already = livePriorAllocations.docs.filter(doc => doc.data().status !== "CANCELLED").reduce((sum, doc) => sum + Number(doc.data().quantityAllocated || 0), 0);
      if (!liveApproval.exists || liveApproval.data()?.decision !== "APPROVED" || command.quantity > approved - already) throw new SampleMutationError("APPROVED_QUANTITY_EXCEEDED");
    }
    const allocationIds: string[] = [];
    plan.forEach((item, index) => {
      const allocationId = `SA-${hash(`${operationId}|${index + 1}`)}`, movementId = `SM-${allocationId}`; allocationIds.push(allocationId);
      const approvalId = text(liveRequest?.data()?.approvalId) || request?.approvalId;
      const allocation = clean({ id: allocationId, sampleSkuId: sku.id, productId: sku.productId, repId: command.repId, repName: rep.name || command.repId, sampleSkuName: sku.name, quantityAllocated: item.quantity, quantityDistributed: 0, quantityRemaining: item.quantity, batchId: item.batch.id, inventoryMovementId: movementId, requestId: command.requestId, approvalId, allocatedAt: now, allocatedBy: actorUid, allocatorName: actor.name, status: "ACTIVE", reportingMonth: now.slice(0, 7), createdAt: now, createdBy: actorUid, allocationSource: command.requestId ? "REQUEST" : "DIRECT", idempotencyKey: command.idempotencyKey });
      tx.create(db.collection("sampleAllocations").doc(allocationId), allocation); tx.create(db.collection("sampleTransactions").doc(movementId), clean({ id: movementId, sampleSkuId: sku.id, batchId: item.batch.id, type: "ALLOCATION", quantity: -item.quantity, sourceId: allocationId, sourceType: "SAMPLE_ALLOCATION", actorId: actorUid, repId: command.repId, requestId: command.requestId, approvalId, createdAt: now }));
      tx.update(item.batch.ref, { availableQuantity: Number(liveBatches[index].data()?.availableQuantity) - item.quantity, status: Number(liveBatches[index].data()?.availableQuantity) === item.quantity ? "DEPLETED" : "AVAILABLE", updatedAt: now, updatedBy: actorUid });
    });
    tx.update(inventorySnap.ref, { availableQuantity: Number(liveInventory.data()?.availableQuantity) - command.quantity, allocatedQuantity: Number(liveInventory.data()?.allocatedQuantity || 0) + command.quantity, updatedAt: now, updatedBy: actorUid });
    if (request && liveRequest && liveApproval && livePriorAllocations) { const approved = Number(liveApproval.data()?.approvedQuantity), already = livePriorAllocations.docs.filter(doc => doc.data().status !== "CANCELLED").reduce((sum, doc) => sum + Number(doc.data().quantityAllocated || 0), 0), total = already + command.quantity; tx.update(liveRequest.ref, { allocatedQuantity: total, status: total < approved ? "PARTIALLY_ALLOCATED" : "ALLOCATED", updatedAt: now, updatedBy: actorUid }); }
    tx.create(operationRef, { id: operationId, type: "SAMPLE_ALLOCATION", actorId: actorUid, idempotencyKey: command.idempotencyKey, commandHash, allocationIds, createdAt: now });
    tx.create(db.collection("auditLogs").doc(`AUD-${operationId}`), { id: `AUD-${operationId}`, userId: actorUid, userName: actor.name, userRole: actor.role, action: "Sample Allocation Created", entityType: "SampleAllocation", entityId: allocationIds[0], details: `Allocated ${command.quantity} ${sku.name} to ${rep.name || command.repId}`, timestamp: now, createdAt: now, createdBy: actorUid });
    return { success: true, replayed: false, allocationIds };
  });
}

export interface SampleVariantCommand { action: "CREATE" | "UPDATE" | "DEACTIVATE" | "REACTIVATE"; idempotencyKey: string; sampleSkuId?: string; productId?: string; name?: string; descriptor?: string; unitSize?: string; unitsPerPack?: number; coldChain?: boolean; }
export function parseSampleVariantCommand(value: unknown): SampleVariantCommand | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  if (Object.keys(r).some(key => !["action", "idempotencyKey", "sampleSkuId", "productId", "name", "descriptor", "unitSize", "unitsPerPack", "coldChain"].includes(key))) return null;
  const action = text(r.action) as SampleVariantCommand["action"], idempotencyKey = text(r.idempotencyKey), sampleSkuId = text(r.sampleSkuId);
  if (!["CREATE", "UPDATE", "DEACTIVATE", "REACTIVATE"].includes(action) || !idempotencyKey) return null;
  if (["DEACTIVATE", "REACTIVATE"].includes(action)) return sampleSkuId ? { action, idempotencyKey, sampleSkuId } : null;
  const productId = text(r.productId), name = text(r.name), descriptor = text(r.descriptor);
  if (!productId || !name || !descriptor || (r.unitsPerPack !== undefined && !positive(r.unitsPerPack))) return null;
  return { action, idempotencyKey, sampleSkuId: action === "UPDATE" ? sampleSkuId : undefined, productId, name, descriptor, unitSize: text(r.unitSize) || undefined, unitsPerPack: Number(r.unitsPerPack || 1), coldChain: r.coldChain === true };
}
const normalizeVariant = (value: string) => value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
export async function executeSampleVariantMutation(actorUid: string, command: SampleVariantCommand, database?: Firestore) {
  const db = database || getFirebaseAdminServices().db;
  const capability = command.action === "CREATE" ? "CREATE_SAMPLE_SKU" : command.action === "UPDATE" ? "EDIT_SAMPLE_SKU" : "DEACTIVATE_SAMPLE_SKU";
  const { actor } = await actorContext(actorUid, capability, db);
  if (!["Super Admin", "Admin"].includes(text(actor.role))) throw new SampleMutationError("SAMPLE_VARIANT_ROLE_DENIED", 403);
  const opId = `SVOP-${hash(`${actorUid}|${command.idempotencyKey}`)}`, opRef = db.collection("sampleOperationKeys").doc(opId), commandHash = hash(JSON.stringify(command)), prior = await opRef.get(), now = new Date().toISOString();
  if (prior.exists) { if (prior.data()?.commandHash !== commandHash) throw new SampleMutationError("SAMPLE_VARIANT_IDEMPOTENCY_CONFLICT"); return { success: true, replayed: true, sampleSkuId: prior.data()?.sampleSkuId }; }
  if (["UPDATE", "DEACTIVATE", "REACTIVATE"].includes(command.action)) return db.runTransaction(async tx => {
    const skuRef = db.collection("sampleCatalog").doc(command.sampleSkuId!), [op, sku] = await Promise.all([tx.get(opRef), tx.get(skuRef)]);
    if (op.exists) return { success: true, replayed: true, sampleSkuId: command.sampleSkuId };
    if (!sku.exists) throw new SampleMutationError("SAMPLE_VARIANT_NOT_FOUND", 404);
    const existing = sku.data()!;
    if (command.action === "UPDATE" && command.productId !== text(existing.productId)) throw new SampleMutationError("SAMPLE_VARIANT_IDENTITY_IMMUTABLE");
    const patch = command.action === "UPDATE"
      ? clean({ name: command.name, descriptor: command.descriptor, unitSize: command.unitSize, unitsPerPack: command.unitsPerPack, coldChain: command.coldChain, updatedAt: now, updatedBy: actorUid })
      : { active: command.action === "REACTIVATE", status: command.action === "REACTIVATE" ? "ACTIVE" : "INACTIVE", updatedAt: now, updatedBy: actorUid };
    tx.update(skuRef, patch);
    tx.create(opRef, { id: opId, type: `SAMPLE_VARIANT_${command.action}`, commandHash, sampleSkuId: sku.id, createdAt: now });
    tx.create(db.collection("auditLogs").doc(`AUD-${opId}`), { id: `AUD-${opId}`, userId: actorUid, userName: actor.name, userRole: actor.role, action: `Sample Variant ${command.action}`, entityType: "SampleCatalog", entityId: sku.id, timestamp: now, createdAt: now, createdBy: actorUid });
    return { success: true, replayed: false, sampleSkuId: sku.id };
  });
  const product = await db.collection("products").doc(command.productId!).get();
  if (!product.exists || !active(product.data())) throw new SampleMutationError("CANONICAL_PRODUCT_NOT_FOUND", 404);
  const semanticKey = `${command.productId}|${normalizeVariant(command.name!)}|${normalizeVariant(command.descriptor!)}`, semanticHash = hash(semanticKey), skuId = `SKU-${semanticHash}`, skuRef = db.collection("sampleCatalog").doc(skuId);
  const legacyCandidates = await db.collection("sampleCatalog").where("productId", "==", command.productId).get();
  if (legacyCandidates.docs.some(doc => { const row = doc.data(); return hash(`${command.productId}|${normalizeVariant(text(row.name))}|${normalizeVariant(text(row.descriptor))}`) === semanticHash; })) throw new SampleMutationError("SAMPLE_VARIANT_DUPLICATE");
  return db.runTransaction(async tx => {
    const [op, existing] = await Promise.all([tx.get(opRef), tx.get(skuRef)]);
    if (op.exists) return { success: true, replayed: true, sampleSkuId: op.data()?.sampleSkuId };
    if (existing.exists) throw new SampleMutationError("SAMPLE_VARIANT_DUPLICATE");
    const sku = clean({ id: skuId, productId: command.productId, name: command.name, descriptor: command.descriptor, normalizedVariantKey: semanticHash, status: "ACTIVE", active: true, unitSize: command.unitSize, unitsPerPack: command.unitsPerPack, coldChain: command.coldChain, manufacturer: product.data()?.manufacturer, createdAt: now, createdBy: actorUid, updatedAt: now, updatedBy: actorUid });
    tx.create(skuRef, sku); tx.create(opRef, { id: opId, type: "SAMPLE_VARIANT_CREATE", commandHash, sampleSkuId: skuId, createdAt: now });
    tx.create(db.collection("auditLogs").doc(`AUD-${opId}`), { id: `AUD-${opId}`, userId: actorUid, userName: actor.name, userRole: actor.role, action: "Sample Variant Created", entityType: "SampleCatalog", entityId: skuId, details: `Created ${command.name}`, timestamp: now, createdAt: now, createdBy: actorUid });
    return { success: true, replayed: false, sampleSkuId: skuId };
  });
}

export interface SampleReceiptCommand { idempotencyKey: string; sampleSkuId: string; batchNumber: string; expiryDate: string; quantity: number; reference?: string; }
export function parseSampleReceiptCommand(value: unknown): SampleReceiptCommand | null { if (!value || typeof value !== "object" || Array.isArray(value)) return null; const r = value as any; if (Object.keys(r).some(key => !["idempotencyKey", "sampleSkuId", "batchNumber", "expiryDate", "quantity", "reference"].includes(key))) return null; const result = { idempotencyKey: text(r.idempotencyKey), sampleSkuId: text(r.sampleSkuId), batchNumber: text(r.batchNumber), expiryDate: text(r.expiryDate), quantity: Number(r.quantity), reference: text(r.reference) || undefined }; return result.idempotencyKey && result.sampleSkuId && result.batchNumber && isCanonicalDate(result.expiryDate) && positive(result.quantity) ? result : null; }
export async function executeSampleReceipt(actorUid: string, command: SampleReceiptCommand, database?: Firestore) {
  const db = database || getFirebaseAdminServices().db, { actor } = await actorContext(actorUid, "RECEIVE_SAMPLE_STOCK", db), now = new Date().toISOString();
  if (command.expiryDate < now.slice(0, 10)) throw new SampleMutationError("SAMPLE_RECEIPT_EXPIRED");
  const canonicalBatchNumber = command.batchNumber.normalize("NFKC").toUpperCase();
  const existingBatches = await db.collection("sampleBatches").where("sampleSkuId", "==", command.sampleSkuId).get();
  const compatibleBatch = existingBatches.docs.find(doc => text(doc.data().batchNumber).normalize("NFKC").toUpperCase() === canonicalBatchNumber);
  const batchId = compatibleBatch?.id || `SB-${hash(`${command.sampleSkuId}|${canonicalBatchNumber}`)}`, opId = `SRC-${hash(`${actorUid}|${command.idempotencyKey}`)}`, commandHash = hash(JSON.stringify(command)), opRef = db.collection("sampleOperationKeys").doc(opId);
  const prior = await opRef.get(); if (prior.exists) { if (prior.data()?.commandHash !== commandHash) throw new SampleMutationError("SAMPLE_RECEIPT_IDEMPOTENCY_CONFLICT"); return { success: true, replayed: true, batchId: prior.data()?.batchId }; }
  const sku = await db.collection("sampleCatalog").doc(command.sampleSkuId).get(); if (!sku.exists || !active(sku.data())) throw new SampleMutationError("SAMPLE_VARIANT_NOT_FOUND", 404);
  const batchRef = db.collection("sampleBatches").doc(batchId), inventoryRef = db.collection("sampleInventory").doc(command.sampleSkuId), movementRef = db.collection("sampleTransactions").doc(`SM-${opId}`);
  return db.runTransaction(async tx => {
    const [op, batch, inventory] = await Promise.all([tx.get(opRef), tx.get(batchRef), tx.get(inventoryRef)]); if (op.exists) return { success: true, replayed: true, batchId };
    if (batch.exists && (text(batch.data()?.sampleSkuId) !== command.sampleSkuId || text(batch.data()?.batchNumber).normalize("NFKC").toUpperCase() !== canonicalBatchNumber || text(batch.data()?.expiryDate).slice(0, 10) !== command.expiryDate)) throw new SampleMutationError("SAMPLE_BATCH_IDENTITY_CONFLICT");
    const oldBatch = batch.data() || {}, oldInventory = inventory.data() || {};
    tx.set(batchRef, { id: batchId, sampleSkuId: command.sampleSkuId, batchNumber: oldBatch.batchNumber || canonicalBatchNumber, expiryDate: command.expiryDate, receivedQuantity: Number(oldBatch.receivedQuantity || 0) + command.quantity, availableQuantity: Number(oldBatch.availableQuantity || 0) + command.quantity, status: "AVAILABLE", createdAt: oldBatch.createdAt || now, createdBy: oldBatch.createdBy || actorUid, updatedAt: now, updatedBy: actorUid });
    tx.set(inventoryRef, { sampleSkuId: command.sampleSkuId, totalReceived: Number(oldInventory.totalReceived || 0) + command.quantity, availableQuantity: Number(oldInventory.availableQuantity || 0) + command.quantity, allocatedQuantity: Number(oldInventory.allocatedQuantity || 0), expiredOrBlockedQuantity: Number(oldInventory.expiredOrBlockedQuantity || 0), updatedAt: now, updatedBy: actorUid });
    tx.create(movementRef, clean({ id: movementRef.id, sampleSkuId: command.sampleSkuId, batchId, type: "RECEIPT", quantity: command.quantity, sourceId: batchId, sourceType: "SAMPLE_BATCH", actorId: actorUid, createdAt: now, notes: command.reference }));
    tx.create(opRef, { id: opId, type: "SAMPLE_RECEIPT", commandHash, batchId, createdAt: now });
    tx.create(db.collection("auditLogs").doc(`AUD-${opId}`), { id: `AUD-${opId}`, userId: actorUid, userName: actor.name, userRole: actor.role, action: "Sample Stock Received", entityType: "SampleBatch", entityId: batchId, details: `Received ${command.quantity} units`, timestamp: now, createdAt: now, createdBy: actorUid });
    return { success: true, replayed: false, batchId };
  });
}
