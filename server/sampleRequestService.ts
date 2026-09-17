import { createHash } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { getFirebaseAdminServices } from "./firebaseAdmin";
import { eligibleProductsForPhysician } from "../src/lib/canonicalRepresentativeScope";
import { hasSampleCapability } from "../src/lib/sampleAuthorization";
import type { Permissions, SampleRequest, SampleSku, User } from "../src/types";

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const active = (value: any) => value && value.isDeleted !== true && value.active !== false && value.isActive !== false && value.loginAllowed !== false && !["Inactive", "Archived", "Suspended"].includes(text(value.status));
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class SampleRequestError extends Error { constructor(public code: string, public httpStatus = 409) { super(code); } }
export interface StandaloneSampleRequestInput { idempotencyKey: string; physicianId?: string; sampleSkuId: string; quantity: number; reason: string; expectedDeliveryDate?: string; urgent: boolean; }

export function parseStandaloneSampleRequestInput(value: unknown): StandaloneSampleRequestInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(key => !["idempotencyKey", "physicianId", "sampleSkuId", "quantity", "reason", "expectedDeliveryDate", "urgent"].includes(key))) return null;
  const input = { idempotencyKey: text(row.idempotencyKey), physicianId: text(row.physicianId), sampleSkuId: text(row.sampleSkuId), quantity: Number(row.quantity), reason: text(row.reason), expectedDeliveryDate: text(row.expectedDeliveryDate) || undefined, urgent: row.urgent === true };
  if (!input.idempotencyKey || input.idempotencyKey.length > 128 || !input.sampleSkuId || !Number.isInteger(input.quantity) || input.quantity <= 0 || !input.reason) return null;
  if (input.expectedDeliveryDate && !DATE.test(input.expectedDeliveryDate)) return null;
  return input;
}

const stableId = (prefix: string, value: string) => `${prefix}-${createHash("sha256").update(value).digest("hex").slice(0, 32)}`;
export const standaloneSampleRequestId = (actorUid: string, key: string) => stableId("SR", `${actorUid}|STANDALONE|${key}`);
export const visitSampleRequestId = (visitId: string, sampleSkuId: string, intentKey: string) => stableId("SRV", `${visitId}|${sampleSkuId}|${intentKey}`);

export async function resolveAuthorizedSampleRequestContext(actorUid: string, physicianId: string | undefined, sampleSkuId: string, db: Firestore) {
  const [actorSnap, physicianSnap, skuSnap, assignments, territories, products, permissionSnap] = await Promise.all([
    db.collection("users").doc(actorUid).get(), physicianId ? db.collection("physicians").doc(physicianId).get() : Promise.resolve(null), db.collection("sampleCatalog").doc(sampleSkuId).get(),
    db.collection("userProductAssignments").where("userId", "==", actorUid).get(), db.collection("userTerritoryAssignments").where("userId", "==", actorUid).get(), db.collection("products").get(),
    db.collection("users").doc(actorUid).get().then(s => s.exists ? db.collection("rolePermissions").doc(text(s.data()?.role)).get() : null),
  ]);
  const actor = actorSnap.exists ? ({ id: actorSnap.id, ...actorSnap.data() } as User) : null;
  const physician = physicianSnap?.exists ? ({ id: physicianSnap.id, ...physicianSnap.data() } as any) : null;
  const sku = skuSnap.exists ? ({ id: skuSnap.id, ...skuSnap.data() } as SampleSku) : null;
  const permissions = permissionSnap?.exists ? permissionSnap.data() as Permissions : undefined;
  if (!actor || !active(actor) || text(actor.role) !== "Medical Representative" || !hasSampleCapability(actor, "CREATE_SAMPLE_REQUEST", permissions)) throw new SampleRequestError("SAMPLE_REQUEST_ACTOR_DENIED", 403);
  const productRows = products.docs.map(d => ({ id: d.id, ...d.data() } as any));
  const assignmentRows = assignments.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
  let eligibleProductIds: Set<string>;
  if (physician) {
    if (!active(physician) || !text(physician.areaId)) throw new SampleRequestError("SAMPLE_REQUEST_PHYSICIAN_DENIED", 403);
    const areaIds = territories.docs.map(d => d.data()).filter(active).map(row => text(row.areaId) || text(row.territoryId));
    if (!areaIds.includes(text(physician.areaId))) throw new SampleRequestError("SAMPLE_REQUEST_PHYSICIAN_DENIED", 403);
    eligibleProductIds = new Set(eligibleProductsForPhysician({ physician, representativeUid: actorUid, productAssignments: assignmentRows as any, products: productRows }).map(product => product.id));
  } else {
    eligibleProductIds = new Set(assignmentRows.filter(active).map(row => text(row.productId)));
  }
  const product = productRows.find(row => row.id === sku?.productId);
  if (!sku || !active(sku) || sku.status !== "ACTIVE" || !product || !active(product) || !eligibleProductIds.has(sku.productId)) throw new SampleRequestError("SAMPLE_REQUEST_SKU_DENIED", 403);
  return { actor, physician, sku, product };
}

export function canonicalSampleRequest(input: { id: string; idempotencyKey: string; actor: User; physician?: any; sku: SampleSku; product?: any; quantity: number; reason: string; expectedDeliveryDate?: string; urgent: boolean; source: "STANDALONE" | "PHYSICIAN_VISIT"; visitId?: string; visitDate?: string; now: string }): SampleRequest & Record<string, unknown> {
  return { id: input.id, idempotencyKey: input.idempotencyKey, requesterId: input.actor.id, repId: input.actor.id, repName: input.actor.name, sampleSkuId: input.sku.id, sampleSkuName: input.sku.name, productId: input.sku.productId, productName: input.product?.name || input.sku.name, quantityRequested: input.quantity, reason: input.reason, expectedDeliveryDate: input.expectedDeliveryDate, requestedForPhysicianId: input.physician?.id, requestedForPhysicianName: input.physician?.name, visitId: input.visitId, visitDate: input.visitDate, source: input.source, urgent: input.urgent, status: "PENDING_APPROVAL", createdAt: input.now, createdBy: input.actor.id };
}

export async function executeStandaloneSampleRequest(actorUid: string, input: StandaloneSampleRequestInput, database?: Firestore) {
  const db = database || getFirebaseAdminServices().db;
  const context = await resolveAuthorizedSampleRequestContext(actorUid, input.physicianId, input.sampleSkuId, db);
  const commandHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const id = standaloneSampleRequestId(actorUid, input.idempotencyKey), requestRef = db.collection("sampleRequests").doc(id), auditRef = db.collection("auditLogs").doc(`AUD-${id}`), now = new Date().toISOString();
  const request = canonicalSampleRequest({ id, idempotencyKey: input.idempotencyKey, ...context, quantity: input.quantity, reason: input.reason, expectedDeliveryDate: input.expectedDeliveryDate, urgent: input.urgent, source: "STANDALONE", now });
  const persistedRequest = { ...request, commandHash };
  return db.runTransaction(async (tx: Transaction) => {
    const existing = await tx.get(requestRef);
    if (existing.exists) {
      const row = existing.data() || {};
      if (text(row.idempotencyKey) !== input.idempotencyKey || text(row.commandHash) !== commandHash) throw new SampleRequestError("SAMPLE_REQUEST_IDEMPOTENCY_CONFLICT");
      return { success: true, replayed: true, requestId: id, request: { id, ...row } };
    }
    tx.create(requestRef, Object.fromEntries(Object.entries(persistedRequest).filter(([, value]) => value !== undefined)));
    tx.create(auditRef, { id: auditRef.id, userId: actorUid, userName: context.actor.name, userRole: context.actor.role, action: "Sample Request Created", entityType: "SampleRequest", entityId: id, details: `Created standalone stock request / ${context.sku.name}`, timestamp: now, createdAt: now, createdBy: actorUid });
    return { success: true, replayed: false, requestId: id, request: persistedRequest };
  });
}
