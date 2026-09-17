import { collection, doc, getDoc, getDocs, query, runTransaction, where } from "firebase/firestore";
import { db } from "./firebase";
import type { Product, SampleAllocation, SampleBatch, SampleDistribution, SampleInventoryBalance, SampleInventoryMovement, SampleRequest, SampleSku } from "../types";
import { removeUndefinedRecursively } from "../utils/importNormalization";
import { calculateRepresentativeSampleBalance, createSampleAllocation, createSampleInventoryMovement } from "./sampleDomainService";

export type SampleStockReasonCode =
  | "ALLOWED" | "INVALID_QUANTITY" | "SAMPLE_SKU_INACTIVE" | "NO_ELIGIBLE_BATCH"
  | "EXPIRED" | "INSUFFICIENT_SHELF_LIFE" | "INSUFFICIENT_CENTRAL_STOCK"
  | "INSUFFICIENT_REP_STOCK" | "PHYSICIAN_ALLOWANCE_EXCEEDED" | "ALLOCATION_OWNER_MISMATCH"
  | "APPROVAL_REQUIRED" | "APPROVED_QUANTITY_EXCEEDED" | "ADJUSTMENT_REASON_REQUIRED";

export class SampleStockError extends Error {
  constructor(public readonly reasonCode: SampleStockReasonCode, message: string) { super(message); this.name = "SampleStockError"; }
}

export interface PhysicianAllowanceResult {
  allowed: boolean;
  reasonCode: "ALLOWED" | "PHYSICIAN_ALLOWANCE_EXCEEDED" | "ALLOWANCE_NOT_CONFIGURED";
  physicianUsedQuantity: number;
  physicianRemainingAllowance: number | null;
  configuredLimit: number | null;
  periodStart: string;
  periodEnd: string;
}

export interface DistributionEligibilityResult extends PhysicianAllowanceResult {
  availableRepQuantity: number;
  eligibleAllocations: SampleAllocation[];
  stockReasonCode: SampleStockReasonCode;
}

export interface BatchConsumption { batchId: string; quantity: number; }
export interface AllocationConsumption { allocationId: string; batchId?: string; quantity: number; }

const positiveInt = (quantity: number): number => {
  if (!Number.isInteger(quantity) || quantity <= 0) throw new SampleStockError("INVALID_QUANTITY", "Quantity must be a positive integer.");
  return quantity;
};
const stripUndefined = <T extends Record<string, unknown>>(value: T): T => removeUndefinedRecursively(value);

export function isBatchUsable(batch: SampleBatch, at: string): boolean {
  return batch.status === "AVAILABLE" && batch.availableQuantity > 0 && batch.expiryDate.slice(0, 10) >= at.slice(0, 10);
}

export function selectBatchesFefo(batches: readonly SampleBatch[], sampleSkuId: string, quantity: number, at: string): BatchConsumption[] {
  let remaining = positiveInt(quantity);
  const eligible = batches.filter(batch => batch.sampleSkuId === sampleSkuId && isBatchUsable(batch, at))
    .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const result: BatchConsumption[] = [];
  for (const batch of eligible) {
    if (remaining === 0) break;
    const consumed = Math.min(remaining, batch.availableQuantity);
    result.push({ batchId: batch.id, quantity: consumed });
    remaining -= consumed;
  }
  if (remaining > 0) throw new SampleStockError("INSUFFICIENT_CENTRAL_STOCK", `Central Sample stock is short by ${remaining} units.`);
  return result;
}

export function consumeAllocationsFefo(allocations: readonly SampleAllocation[], batches: readonly SampleBatch[], repId: string, sampleSkuId: string, quantity: number, at: string): AllocationConsumption[] {
  let remaining = positiveInt(quantity);
  const expiryByBatch = new Map(batches.map(batch => [batch.id, batch.expiryDate]));
  const eligible = allocations.filter(allocation => allocation.repId === repId && allocation.sampleSkuId === sampleSkuId && allocation.status === "ACTIVE" && allocation.quantityRemaining > 0)
    .filter(allocation => !allocation.batchId || batches.some(batch => batch.id === allocation.batchId && isBatchUsable(batch, at)))
    .sort((a, b) => (expiryByBatch.get(a.batchId || "") || "9999-12-31").localeCompare(expiryByBatch.get(b.batchId || "") || "9999-12-31") || a.allocatedAt.localeCompare(b.allocatedAt) || a.id.localeCompare(b.id));
  const result: AllocationConsumption[] = [];
  for (const allocation of eligible) {
    if (remaining === 0) break;
    const consumed = Math.min(remaining, allocation.quantityRemaining);
    result.push({ allocationId: allocation.id, batchId: allocation.batchId, quantity: consumed });
    remaining -= consumed;
  }
  if (remaining > 0) throw new SampleStockError("INSUFFICIENT_REP_STOCK", `Representative Sample balance is short by ${remaining} units.`);
  return result;
}

export function calculatePhysicianAllowance(input: { distributions: readonly SampleDistribution[]; physicianId: string; productId: string; proposedQuantity: number; monthlyLimit?: number; at: string }): PhysicianAllowanceResult {
  const quantity = positiveInt(input.proposedQuantity);
  const periodStart = `${input.at.slice(0, 7)}-01`;
  const nextMonth = new Date(`${periodStart}T00:00:00.000Z`); nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  const periodEnd = nextMonth.toISOString().slice(0, 10);
  const used = input.distributions.filter(item => item.physicianId === input.physicianId && item.productId === input.productId && item.distributedAt >= periodStart && item.distributedAt < periodEnd).reduce((sum, item) => sum + item.quantity, 0);
  const limit = input.monthlyLimit && input.monthlyLimit > 0 ? input.monthlyLimit : null;
  if (limit === null) return { allowed: true, reasonCode: "ALLOWANCE_NOT_CONFIGURED", physicianUsedQuantity: used, physicianRemainingAllowance: null, configuredLimit: null, periodStart, periodEnd };
  const remaining = Math.max(0, limit - used);
  return { allowed: quantity <= remaining, reasonCode: quantity <= remaining ? "ALLOWED" : "PHYSICIAN_ALLOWANCE_EXCEEDED", physicianUsedQuantity: used, physicianRemainingAllowance: remaining, configuredLimit: limit, periodStart, periodEnd };
}

export function validateDistributionEligibility(input: { sampleSku: SampleSku; allocations: readonly SampleAllocation[]; batches: readonly SampleBatch[]; distributions: readonly SampleDistribution[]; repId: string; physicianId: string; quantity: number; monthlyLimit?: number; at: string }): DistributionEligibilityResult {
  const quantity = positiveInt(input.quantity);
  const relevant = input.allocations.filter(allocation => allocation.repId === input.repId && allocation.sampleSkuId === input.sampleSku.id && allocation.status === "ACTIVE");
  const available = relevant.reduce((sum, allocation) => sum + allocation.quantityRemaining, 0);
  const allowance = calculatePhysicianAllowance({ distributions: input.distributions, physicianId: input.physicianId, productId: input.sampleSku.productId, proposedQuantity: quantity, monthlyLimit: input.monthlyLimit, at: input.at });
  if (!input.sampleSku.active || input.sampleSku.status !== "ACTIVE") return { ...allowance, allowed: false, stockReasonCode: "SAMPLE_SKU_INACTIVE", availableRepQuantity: available, eligibleAllocations: [] };
  try { consumeAllocationsFefo(relevant, input.batches, input.repId, input.sampleSku.id, quantity, input.at); }
  catch (error) { return { ...allowance, allowed: false, stockReasonCode: error instanceof SampleStockError ? error.reasonCode : "INSUFFICIENT_REP_STOCK", availableRepQuantity: available, eligibleAllocations: relevant }; }
  return { ...allowance, allowed: allowance.allowed, stockReasonCode: allowance.allowed ? "ALLOWED" : "PHYSICIAN_ALLOWANCE_EXCEEDED", availableRepQuantity: available, eligibleAllocations: relevant };
}

export function applyCentralAdjustment(balance: SampleInventoryBalance, targetAvailable: number, reason: string): { balance: SampleInventoryBalance; delta: number } {
  if (!reason.trim()) throw new SampleStockError("ADJUSTMENT_REASON_REQUIRED", "A stock adjustment reason is required.");
  if (!Number.isInteger(targetAvailable) || targetAvailable < 0) throw new SampleStockError("INSUFFICIENT_CENTRAL_STOCK", "Adjusted available quantity cannot be negative.");
  return { balance: { ...balance, availableQuantity: targetAvailable }, delta: targetAvailable - balance.availableQuantity };
}

export function approvedRemaining(approvedQuantity: number, allocations: readonly SampleAllocation[], requestId: string): number {
  return Math.max(0, approvedQuantity - allocations.filter(allocation => allocation.requestId === requestId && allocation.status !== "CANCELLED").reduce((sum, allocation) => sum + allocation.quantityAllocated, 0));
}

export function applyReceipt(balance: SampleInventoryBalance, batch: SampleBatch, quantity: number): { balance: SampleInventoryBalance; batch: SampleBatch } {
  const amount = positiveInt(quantity);
  return { balance: { ...balance, totalReceived: balance.totalReceived + amount, availableQuantity: balance.availableQuantity + amount }, batch: { ...batch, receivedQuantity: batch.receivedQuantity + amount, availableQuantity: batch.availableQuantity + amount, status: "AVAILABLE" } };
}

export function applyAllocationToStock(balance: SampleInventoryBalance, batch: SampleBatch, quantity: number): { balance: SampleInventoryBalance; batch: SampleBatch } {
  const amount = positiveInt(quantity);
  if (batch.availableQuantity < amount || balance.availableQuantity < amount) throw new SampleStockError("INSUFFICIENT_CENTRAL_STOCK", "Allocation exceeds central stock.");
  return { balance: { ...balance, availableQuantity: balance.availableQuantity - amount, allocatedQuantity: balance.allocatedQuantity + amount }, batch: { ...batch, availableQuantity: batch.availableQuantity - amount, status: batch.availableQuantity === amount ? "DEPLETED" : batch.status } };
}

export function applyDistributionToAllocation(allocation: SampleAllocation, quantity: number, repId: string): SampleAllocation {
  const amount = positiveInt(quantity);
  if (allocation.repId !== repId) throw new SampleStockError("ALLOCATION_OWNER_MISMATCH", "Allocation belongs to another representative.");
  if (allocation.quantityRemaining < amount) throw new SampleStockError("INSUFFICIENT_REP_STOCK", "Distribution exceeds allocation balance.");
  return { ...allocation, quantityRemaining: allocation.quantityRemaining - amount, quantityDistributed: allocation.quantityDistributed + amount, status: allocation.quantityRemaining === amount ? "DEPLETED" : allocation.status };
}

export function requestStatusAfterAllocation(approvedQuantity: number, totalAllocated: number): SampleRequest["status"] {
  if (totalAllocated <= 0) return "AWAITING_ALLOCATION";
  return totalAllocated < approvedQuantity ? "PARTIALLY_ALLOCATED" : "ALLOCATED";
}

const movement = (id: string, sampleSkuId: string, batchId: string | undefined, type: SampleInventoryMovement["type"], quantity: number, sourceId: string, sourceType: SampleInventoryMovement["sourceType"], actorId: string, createdAt: string, notes?: string) =>
  createSampleInventoryMovement({ id, sampleSkuId, batchId, type, quantity, sourceId, sourceType, actorId, createdAt, notes });

export async function receiveCanonicalSampleStock(input: { sampleSkuId: string; batchId: string; batchNumber: string; expiryDate: string; quantity: number; actorId: string; reference?: string; occurredAt?: string }): Promise<void> {
  const quantity = positiveInt(input.quantity), now = input.occurredAt || new Date().toISOString();
  if (input.expiryDate.slice(0, 10) < now.slice(0, 10)) throw new SampleStockError("EXPIRED", "Expired Sample stock cannot be received as available.");
  const batchRef = doc(db, "sampleBatches", input.batchId), inventoryRef = doc(db, "sampleInventory", input.sampleSkuId), movementRef = doc(db, "sampleTransactions", `SM-${crypto.randomUUID()}`);
  await runTransaction(db, async tx => {
    const [batchSnap, inventorySnap] = await Promise.all([tx.get(batchRef), tx.get(inventoryRef)]);
    const oldBatch = batchSnap.data() as Partial<SampleBatch> | undefined, oldInventory = inventorySnap.data() as Partial<SampleInventoryBalance> | undefined;
    tx.set(batchRef, { id: input.batchId, sampleSkuId: input.sampleSkuId, batchNumber: input.batchNumber, expiryDate: input.expiryDate, receivedQuantity: (oldBatch?.receivedQuantity || 0) + quantity, availableQuantity: (oldBatch?.availableQuantity || 0) + quantity, status: "AVAILABLE", createdAt: oldBatch?.createdAt || now, createdBy: oldBatch?.createdBy || input.actorId, updatedAt: now, updatedBy: input.actorId });
    tx.set(inventoryRef, { sampleSkuId: input.sampleSkuId, totalReceived: (oldInventory?.totalReceived || 0) + quantity, availableQuantity: (oldInventory?.availableQuantity || 0) + quantity, allocatedQuantity: oldInventory?.allocatedQuantity || 0, expiredOrBlockedQuantity: oldInventory?.expiredOrBlockedQuantity || 0, updatedAt: now, updatedBy: input.actorId });
    const m = movement(movementRef.id, input.sampleSkuId, input.batchId, "RECEIPT", quantity, input.batchId, "SAMPLE_BATCH", input.actorId, now, input.reference);
    tx.set(movementRef, stripUndefined(m as unknown as Record<string, unknown>));
  });
}

export async function adjustCanonicalSampleStock(input: { sampleSkuId: string; batchId: string; targetAvailableQuantity: number; reason: string; notes?: string; actorId: string; occurredAt?: string }): Promise<void> {
  if (!input.reason.trim()) throw new SampleStockError("ADJUSTMENT_REASON_REQUIRED", "A stock adjustment reason is required.");
  const now = input.occurredAt || new Date().toISOString(), batchRef = doc(db, "sampleBatches", input.batchId), inventoryRef = doc(db, "sampleInventory", input.sampleSkuId), movementRef = doc(db, "sampleTransactions", `SM-${crypto.randomUUID()}`);
  await runTransaction(db, async tx => {
    const [batchSnap, inventorySnap] = await Promise.all([tx.get(batchRef), tx.get(inventoryRef)]); if (!batchSnap.exists() || !inventorySnap.exists()) throw new SampleStockError("NO_ELIGIBLE_BATCH", "Sample batch or inventory balance was not found.");
    const batch = batchSnap.data() as SampleBatch, inventory = inventorySnap.data() as SampleInventoryBalance;
    const delta = input.targetAvailableQuantity - batch.availableQuantity; if (input.targetAvailableQuantity < 0 || inventory.availableQuantity + delta < 0) throw new SampleStockError("INSUFFICIENT_CENTRAL_STOCK", "Adjustment would create negative stock.");
    tx.update(batchRef, { availableQuantity: input.targetAvailableQuantity, status: input.targetAvailableQuantity === 0 ? "DEPLETED" : batch.status, updatedAt: now, updatedBy: input.actorId });
    tx.update(inventoryRef, { availableQuantity: inventory.availableQuantity + delta, updatedAt: now, updatedBy: input.actorId });
    tx.set(movementRef, stripUndefined(movement(movementRef.id, input.sampleSkuId, input.batchId, "ADJUSTMENT", delta, input.batchId, "MANUAL_ADJUSTMENT", input.actorId, now, `${input.reason}${input.notes ? `: ${input.notes}` : ""}`) as unknown as Record<string, unknown>));
  });
}

type AllocationInput = { idPrefix: string; sampleSku: SampleSku; repId: string; quantity: number; actorId: string; allocationSource: "REQUEST" | "DIRECT"; requestId?: string; approvalId?: string; occurredAt?: string };
export async function allocateCanonicalSampleStock(input: AllocationInput): Promise<string[]> {
  const quantity = positiveInt(input.quantity), now = input.occurredAt || new Date().toISOString();
  const batchQuery = query(collection(db, "sampleBatches"), where("sampleSkuId", "==", input.sampleSku.id));
  const allocationQuery = input.requestId ? query(collection(db, "sampleAllocations"), where("requestId", "==", input.requestId)) : null;
  const [batchSnaps, previousSnaps] = await Promise.all([getDocs(batchQuery), allocationQuery ? getDocs(allocationQuery) : Promise.resolve(null)]);
  const batches = batchSnaps.docs.map(item => ({ id: item.id, ...item.data() } as SampleBatch));
  const plan = selectBatchesFefo(batches, input.sampleSku.id, quantity, now);
  const inventoryRef = doc(db, "sampleInventory", input.sampleSku.id), requestRef = input.requestId ? doc(db, "sampleRequests", input.requestId) : null, approvalRef = input.approvalId ? doc(db, "sampleApprovals", input.approvalId) : null;
  const ids = plan.map((_, index) => `${input.idPrefix}-${index + 1}`);
  await runTransaction(db, async tx => {
    const inventorySnap = await tx.get(inventoryRef); if (!inventorySnap.exists()) throw new SampleStockError("INSUFFICIENT_CENTRAL_STOCK", "Central Sample inventory does not exist.");
    const inventory = inventorySnap.data() as SampleInventoryBalance; if (inventory.availableQuantity < quantity) throw new SampleStockError("INSUFFICIENT_CENTRAL_STOCK", "Allocation exceeds central Sample stock.");
    const liveBatches: SampleBatch[] = [];
    for (const item of plan) { const snap = await tx.get(doc(db, "sampleBatches", item.batchId)); if (!snap.exists()) throw new SampleStockError("NO_ELIGIBLE_BATCH", "Selected batch no longer exists."); liveBatches.push({ id: snap.id, ...snap.data() } as SampleBatch); }
    selectBatchesFefo(liveBatches, input.sampleSku.id, quantity, now);
    let request: SampleRequest | undefined, approvedQuantity: number | undefined;
    if (requestRef) { const snap = await tx.get(requestRef); if (!snap.exists()) throw new SampleStockError("APPROVAL_REQUIRED", "Request was not found."); request = { id: snap.id, ...snap.data() } as SampleRequest; if (!["AWAITING_ALLOCATION", "PARTIALLY_ALLOCATED"].includes(request.status)) throw new SampleStockError("APPROVAL_REQUIRED", "Request is not awaiting allocation."); }
    if (approvalRef) { const snap = await tx.get(approvalRef); if (!snap.exists() || snap.data().decision !== "APPROVED") throw new SampleStockError("APPROVAL_REQUIRED", "Approved decision was not found."); approvedQuantity = snap.data().approvedQuantity; }
    if (request && approvedQuantity !== undefined) { const previous = previousSnaps?.docs.map(item => ({ id: item.id, ...item.data() } as SampleAllocation)) || []; if (quantity > approvedRemaining(approvedQuantity, previous, request.id)) throw new SampleStockError("APPROVED_QUANTITY_EXCEEDED", "Allocation exceeds remaining approved quantity."); }
    plan.forEach((item, index) => {
      const batch = liveBatches.find(candidate => candidate.id === item.batchId)!; const batchRef = doc(db, "sampleBatches", item.batchId);
      tx.update(batchRef, { availableQuantity: batch.availableQuantity - item.quantity, status: batch.availableQuantity === item.quantity ? "DEPLETED" : batch.status, updatedAt: now, updatedBy: input.actorId });
      const movementId = `SM-${crypto.randomUUID()}`; const allocation = createSampleAllocation({ id: ids[index], sampleSku: input.sampleSku, repId: input.repId, quantityAllocated: item.quantity, batchId: item.batchId, inventoryMovementId: movementId, requestId: input.requestId, approvalId: input.approvalId, allocatedBy: input.actorId, allocatedAt: now });
      tx.set(doc(db, "sampleAllocations", allocation.id), stripUndefined({ ...allocation, allocationSource: input.allocationSource }));
      tx.set(doc(db, "sampleTransactions", movementId), stripUndefined(movement(movementId, input.sampleSku.id, item.batchId, "ALLOCATION", -item.quantity, allocation.id, "SAMPLE_ALLOCATION", input.actorId, now, `${input.allocationSource} allocation to ${input.repId}`) as unknown as Record<string, unknown>));
    });
    tx.update(inventoryRef, { availableQuantity: inventory.availableQuantity - quantity, allocatedQuantity: inventory.allocatedQuantity + quantity, updatedAt: now, updatedBy: input.actorId });
    if (requestRef && request && approvedQuantity !== undefined) { const already = approvedQuantity - approvedRemaining(approvedQuantity, previousSnaps?.docs.map(item => ({ id: item.id, ...item.data() } as SampleAllocation)) || [], request.id); const total = already + quantity; tx.update(requestRef, { status: requestStatusAfterAllocation(approvedQuantity, total), allocatedQuantity: total, updatedAt: now, updatedBy: input.actorId }); }
  });
  return ids;
}

export async function getCanonicalRepBalance(repId: string, sampleSku: SampleSku): Promise<ReturnType<typeof calculateRepresentativeSampleBalance>> {
  const snaps = await getDocs(query(collection(db, "sampleAllocations"), where("repId", "==", repId), where("sampleSkuId", "==", sampleSku.id)));
  return calculateRepresentativeSampleBalance(snaps.docs.map(item => ({ id: item.id, ...item.data() } as SampleAllocation)), repId, sampleSku);
}

export async function recordCanonicalSampleDistribution(input: { id: string; sampleSku: SampleSku; repId: string; physicianId: string; quantity: number; actorId: string; product?: Pick<Product, "monthlyPhysicianSampleLimit">; requestId?: string; visitId?: string; notes?: string; occurredAt?: string }): Promise<SampleDistribution> {
  if (input.actorId !== input.repId) throw new SampleStockError("ALLOCATION_OWNER_MISMATCH", "Representative may distribute only from their own allocations.");
  const quantity = positiveInt(input.quantity), now = input.occurredAt || new Date().toISOString();
  const usageId = `${input.physicianId}_${input.sampleSku.productId}_${now.slice(0, 7)}`, usageRef = doc(db, "physicianSampleUsage", usageId);
  const [allocationSnaps, batchSnaps, usageSnap] = await Promise.all([
    getDocs(query(collection(db, "sampleAllocations"), where("repId", "==", input.repId), where("sampleSkuId", "==", input.sampleSku.id))),
    getDocs(query(collection(db, "sampleBatches"), where("sampleSkuId", "==", input.sampleSku.id))),
    getDoc(usageRef)
  ]);
  const allocations = allocationSnaps.docs.map(item => ({ id: item.id, ...item.data() } as SampleAllocation));
  const batches = batchSnaps.docs.map(item => ({ id: item.id, ...item.data() } as SampleBatch));
  const usedQuantity = Number(usageSnap.data()?.usedQuantity || 0);
  const distributions: SampleDistribution[] = usedQuantity > 0 ? [{ id: "usage", sampleSkuId: input.sampleSku.id, productId: input.sampleSku.productId, repId: "aggregate", physicianId: input.physicianId, quantity: usedQuantity, allocationId: "aggregate", distributedAt: `${now.slice(0, 7)}-01`, createdBy: "aggregate" }] : [];
  const eligibility = validateDistributionEligibility({ sampleSku: input.sampleSku, allocations, batches, distributions, repId: input.repId, physicianId: input.physicianId, quantity, monthlyLimit: input.product?.monthlyPhysicianSampleLimit, at: now });
  if (!eligibility.allowed) throw new SampleStockError(eligibility.stockReasonCode, eligibility.stockReasonCode);
  const plan = consumeAllocationsFefo(allocations, batches, input.repId, input.sampleSku.id, quantity, now), distributionRef = doc(db, "sampleDisbursedLogs", input.id), movementRef = doc(db, "sampleTransactions", `SM-${crypto.randomUUID()}`);
  const lineageRequestId = input.requestId || allocations.find(item => item.id === plan[0].allocationId)?.requestId;
  const distribution: SampleDistribution = { id: input.id, sampleSkuId: input.sampleSku.id, productId: input.sampleSku.productId, repId: input.repId, physicianId: input.physicianId, quantity, allocationId: plan[0].allocationId, allocationIds: plan.map(item => item.allocationId), allocationConsumptions: plan, batchId: plan[0].batchId, visitId: input.visitId, requestId: lineageRequestId, distributedAt: now, createdBy: input.actorId, notes: input.notes };
  await runTransaction(db, async tx => {
    const [existingDistribution, liveUsageSnap] = await Promise.all([tx.get(distributionRef), tx.get(usageRef)]);
    if (existingDistribution.exists()) throw new SampleStockError("INVALID_QUANTITY", "Distribution ID already exists.");
    const liveUsed = Number(liveUsageSnap.data()?.usedQuantity || 0), configuredLimit = input.product?.monthlyPhysicianSampleLimit;
    if (configuredLimit && configuredLimit > 0 && liveUsed + quantity > configuredLimit) throw new SampleStockError("PHYSICIAN_ALLOWANCE_EXCEEDED", "Physician monthly Sample allowance has been exceeded.");
    const live: SampleAllocation[] = []; for (const item of plan) { const snap = await tx.get(doc(db, "sampleAllocations", item.allocationId)); if (!snap.exists()) throw new SampleStockError("INSUFFICIENT_REP_STOCK", "Allocation no longer exists."); live.push({ id: snap.id, ...snap.data() } as SampleAllocation); }
    const livePlan = consumeAllocationsFefo(live, batches, input.repId, input.sampleSku.id, quantity, now);
    for (const item of livePlan) { const allocation = live.find(candidate => candidate.id === item.allocationId)!; tx.update(doc(db, "sampleAllocations", item.allocationId), { quantityRemaining: allocation.quantityRemaining - item.quantity, quantityDistributed: allocation.quantityDistributed + item.quantity, status: allocation.quantityRemaining === item.quantity ? "DEPLETED" : allocation.status, updatedAt: now, updatedBy: input.actorId }); }
    tx.set(distributionRef, stripUndefined(distribution as unknown as Record<string, unknown>)); tx.set(movementRef, stripUndefined(movement(movementRef.id, input.sampleSku.id, plan[0].batchId, "DISTRIBUTION", -quantity, input.id, "SAMPLE_DISTRIBUTION", input.actorId, now, input.notes) as unknown as Record<string, unknown>));
    tx.set(usageRef, { physicianId: input.physicianId, productId: input.sampleSku.productId, period: now.slice(0, 7), usedQuantity: liveUsed + quantity, lastDistributionId: input.id, updatedAt: now, updatedBy: input.actorId });
  });
  return distribution;
}
