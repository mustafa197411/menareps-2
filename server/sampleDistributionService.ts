import type { Firestore, Transaction } from "firebase-admin/firestore";
import { getFirebaseAdminServices } from "./firebaseAdmin";
import { eligibleProductsForPhysician } from "../src/lib/canonicalRepresentativeScope";
import type { SampleAllocation, SampleBatch, SampleSku } from "../src/types";
import { assertRollingPhysicianLimit, marketLocalDate, planRepresentativeFefo, SampleDistributionPolicyError } from "./sampleDistributionPolicy";

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const active = (value: any) => value?.active !== false && value?.isActive !== false && value?.isDeleted !== true && value?.status !== "Inactive";
export class CanonicalSampleDistributionError extends Error { constructor(public code: string, public status = 409) { super(code); } }
export interface StandaloneSampleDistributionRequest { id: string; physicianId: string; productId: string; sampleSkuId: string; quantity: number; notes?: string; }

export function parseStandaloneSampleDistributionRequest(value: unknown): StandaloneSampleDistributionRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const request = { id: text(row.id), physicianId: text(row.physicianId), productId: text(row.productId), sampleSkuId: text(row.sampleSkuId), quantity: Number(row.quantity), notes: text(row.notes) || undefined };
  return request.id && request.physicianId && request.productId && request.sampleSkuId && Number.isInteger(request.quantity) && request.quantity > 0 ? request : null;
}

export async function executeStandaloneSampleDistribution(actorUid: string, request: StandaloneSampleDistributionRequest, database?: Firestore) {
  const db = database || getFirebaseAdminServices().db;
  const actorRef = db.collection("users").doc(actorUid); const physicianRef = db.collection("physicians").doc(request.physicianId);
  const skuRef = db.collection("sampleCatalog").doc(request.sampleSkuId); const productRef = db.collection("products").doc(request.productId);
  const [territories, assignments, allocationsQuery] = await Promise.all([
    db.collection("userTerritoryAssignments").where("userId", "==", actorUid).get(), db.collection("userProductAssignments").where("userId", "==", actorUid).get(),
    db.collection("sampleAllocations").where("repId", "==", actorUid).where("sampleSkuId", "==", request.sampleSkuId).get(),
  ]);
  const batchRefs = [...new Set(allocationsQuery.docs.map(doc => text(doc.data().batchId)).filter(Boolean))].map(id => db.collection("sampleBatches").doc(id));
  const lockRef = db.collection("physicianSampleRollingUsage").doc(request.physicianId);
  const distributionRef = db.collection("sampleDisbursedLogs").doc(request.id);
  return db.runTransaction(async (tx: Transaction) => {
    const refs = [...territories.docs.map(doc => doc.ref), ...assignments.docs.map(doc => doc.ref), ...allocationsQuery.docs.map(doc => doc.ref), ...batchRefs, lockRef];
    const [actorSnap, physicianSnap, skuSnap, productSnap, existing, ...snaps] = await Promise.all([tx.get(actorRef), tx.get(physicianRef), tx.get(skuRef), tx.get(productRef), tx.get(distributionRef), ...refs.map(ref => tx.get(ref))]);
    if (existing.exists) throw new CanonicalSampleDistributionError("SAMPLE_DISTRIBUTION_ALREADY_EXISTS");
    const byPath = new Map(refs.map((ref, index) => [ref.path, snaps[index]]));
    const actor = actorSnap.data(); const physician = physicianSnap.data(); const sku = skuSnap.exists ? { id: skuSnap.id, ...skuSnap.data() } as SampleSku : null; const product = productSnap.exists ? { id: productSnap.id, ...productSnap.data() } : null;
    if (!actor || text(actor.role) !== "Medical Representative" || !active(actor) || actor.loginAllowed === false) throw new CanonicalSampleDistributionError("ACTOR_NOT_AUTHORIZED", 403);
    if (!physician || !active(physician) || !text(physician.areaId)) throw new CanonicalSampleDistributionError("PHYSICIAN_NOT_ELIGIBLE", 403);
    const territoryRows = territories.docs.map(doc => byPath.get(doc.ref.path)).filter(snap => snap?.exists).map(snap => snap!.data()).filter(active);
    if (!territoryRows.some(row => (text(row.areaId) || text(row.territoryId)) === text(physician.areaId))) throw new CanonicalSampleDistributionError("PHYSICIAN_OUTSIDE_AUTHORIZED_AREA", 403);
    const assignmentRows = assignments.docs.map(doc => byPath.get(doc.ref.path)).filter(snap => snap?.exists).map(snap => ({ id: snap!.id, ...snap!.data() }));
    const eligible = eligibleProductsForPhysician({ physician: physician as any, representativeUid: actorUid, productAssignments: assignmentRows as any, products: product ? [product] as any : [] });
    if (!product || !active(product) || !eligible.some(row => row.id === request.productId)) throw new CanonicalSampleDistributionError("SAMPLE_PRODUCT_NOT_AUTHORIZED", 403);
    if (!sku || !active(sku) || sku.status !== "ACTIVE" || sku.productId !== request.productId) throw new CanonicalSampleDistributionError("SAMPLE_SKU_NOT_AUTHORIZED", 403);
    const areaSnap = await tx.get(db.collection("areas").doc(text(physician.areaId)));
    if (!areaSnap.exists || !active(areaSnap.data()) || !text(areaSnap.data()?.countryId)) throw new CanonicalSampleDistributionError("CANONICAL_GEOGRAPHY_INVALID");
    const markets = await tx.get(db.collection("marketSettings").where("countryId", "==", text(areaSnap.data()?.countryId)));
    const activeMarkets = markets.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)).filter(active);
    if (activeMarkets.length !== 1 || !text(activeMarkets[0].timezone)) throw new CanonicalSampleDistributionError(activeMarkets.length ? "MARKET_CONFIGURATION_AMBIGUOUS" : "MARKET_CONFIGURATION_REQUIRED");
    const now = new Date().toISOString(); const timezone = text(activeMarkets[0].timezone); let distributionDate: string;
    try { distributionDate = marketLocalDate(now, timezone); }
    catch { throw new CanonicalSampleDistributionError("MARKET_TIMEZONE_INVALID"); }
    const history = await tx.get(db.collection("sampleDisbursedLogs").where("physicianId", "==", request.physicianId));
    try { assertRollingPhysicianLimit({ records: history.docs.map(doc => doc.data()), physicianId: request.physicianId, classification: physician.classification, distributionDate, timezone, proposedQuantity: request.quantity }); }
    catch (error) { throw new CanonicalSampleDistributionError(error instanceof SampleDistributionPolicyError ? error.code : "PHYSICIAN_ROLLING_SAMPLE_LIMIT_FAILED"); }
    const allocationRows = allocationsQuery.docs.map(doc => ({ id: doc.id, ref: doc.ref, ...(byPath.get(doc.ref.path)?.data() || {}) } as any));
    const batchRows = batchRefs.map(ref => ({ id: ref.id, ...(byPath.get(ref.path)?.data() || {}) } as SampleBatch));
    let plan;
    try { plan = planRepresentativeFefo({ allocations: allocationRows as SampleAllocation[], batches: batchRows, repId: actorUid, sku, quantity: request.quantity, distributionDate }); }
    catch (error) { throw new CanonicalSampleDistributionError(error instanceof SampleDistributionPolicyError ? error.code : "SAMPLE_CONSUMPTION_FAILED"); }
    for (const consumption of plan) { const allocation = allocationRows.find(row => row.id === consumption.allocationId)!; tx.update(allocation.ref, { quantityDistributed: Number(allocation.quantityDistributed || 0) + consumption.quantity, quantityRemaining: Number(allocation.quantityRemaining) - consumption.quantity, status: Number(allocation.quantityRemaining) === consumption.quantity ? "DEPLETED" : "ACTIVE", updatedAt: now, updatedBy: actorUid }); }
    const transactionId = `SM-${request.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
    tx.create(distributionRef, { id: request.id, status: "DISTRIBUTED", sampleSkuId: sku.id, sampleSkuName: sku.name, sampleSkuDescriptor: sku.descriptor || null, productId: product.id, productName: (product as any).name || null, brand: (product as any).brand || null, repId: actorUid, physicianId: request.physicianId, quantity: request.quantity, allocationId: plan[0].allocationId, allocationIds: plan.map(row => row.allocationId), allocationConsumptions: plan, batchId: plan[0].batchId, distributionDate, marketId: activeMarkets[0].id, timezone, distributedAt: now, createdBy: actorUid, notes: request.notes || null });
    tx.create(db.collection("sampleTransactions").doc(transactionId), { id: transactionId, sampleSkuId: sku.id, batchId: plan.length === 1 ? plan[0].batchId : null, allocationConsumptions: plan, type: "DISTRIBUTION", quantity: -request.quantity, sourceId: request.id, sourceType: "SAMPLE_DISTRIBUTION", actorId: actorUid, createdAt: now });
    tx.set(lockRef, { physicianId: request.physicianId, lastDistributionId: request.id, lastDistributionDate: distributionDate, updatedAt: now }, { merge: true });
    return { success: true, distributionId: request.id, transactionId, allocationConsumptions: plan };
  });
}
