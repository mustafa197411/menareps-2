import { randomUUID } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { Role, type Permissions } from "../src/types";
import { canManageAcademicResources } from "../src/lib/canonicalPermissionApplicability";
import { authorizeResourceRead, ResourceReadError } from "./resourceReadService";

const MANAGERS = new Set<string>([Role.SUPER_ADMIN, Role.ADMIN, Role.MARKETING_MANAGER, Role.PRODUCT_MANAGER]);
const TYPES = new Set(["KEY_MESSAGE", "PRODUCT_CLAIM", "PRODUCT_FEATURE", "CLINICAL_EVIDENCE", "SAFETY_INFORMATION", "DOSAGE_INFORMATION", "PRODUCT_IMAGE", "NAVIGATION", "GENERAL_CONTENT"]);
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const active = (value: any) => value?.active !== false && value?.isActive !== false && value?.isDeleted !== true && value?.status !== "Inactive" && value?.status !== "Archived";
const safeId = (value: string) => Boolean(value && value.length <= 128 && /^[A-Za-z0-9_-]+$/.test(value));
const nowIso = (now?: () => Date) => (now || (() => new Date()))().toISOString();

export class HotspotError extends Error {
  constructor(public code: string, public status = 400, public internalCode = code) { super(code); }
}

export const publicHotspotReadError = (error: unknown) => new HotspotError("RESOURCE_NOT_FOUND", 404, error instanceof HotspotError || error instanceof ResourceReadError ? error.code : "HOTSPOT_ACCESS_FAILED");

export interface HotspotMutationInput {
  productId: string;
  pageNumber: number;
  hotspotName: string;
  hotspotType: string;
  xPercent: number;
  yPercent: number;
  widthPercent: number;
  heightPercent: number;
  linkedKeyMessageId?: string;
  description?: string;
}

export function parseHotspotMutation(value: unknown): HotspotMutationInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(key => !["productId", "pageNumber", "hotspotName", "hotspotType", "xPercent", "yPercent", "widthPercent", "heightPercent", "linkedKeyMessageId", "description"].includes(key))) return null;
  const result = {
    productId: text(row.productId), pageNumber: Number(row.pageNumber), hotspotName: text(row.hotspotName), hotspotType: text(row.hotspotType),
    xPercent: Number(row.xPercent), yPercent: Number(row.yPercent), widthPercent: Number(row.widthPercent), heightPercent: Number(row.heightPercent),
    ...(text(row.linkedKeyMessageId) ? { linkedKeyMessageId: text(row.linkedKeyMessageId) } : {}), ...(text(row.description) ? { description: text(row.description) } : {}),
  };
  if (!safeId(result.productId) || !Number.isInteger(result.pageNumber) || result.pageNumber < 1 || result.pageNumber > 10000 || !result.hotspotName || result.hotspotName.length > 200 || !TYPES.has(result.hotspotType)) return null;
  if (![result.xPercent, result.yPercent, result.widthPercent, result.heightPercent].every(Number.isFinite) || result.xPercent < 0 || result.yPercent < 0 || result.widthPercent <= 0 || result.heightPercent <= 0 || result.xPercent + result.widthPercent > 100 || result.yPercent + result.heightPercent > 100) return null;
  if (result.linkedKeyMessageId && !safeId(result.linkedKeyMessageId)) return null;
  return result;
}

async function actor(actorUid: string, db: Firestore) {
  const snap = await db.collection("users").doc(actorUid).get(), row = snap.data() || {}, role = text(row.role);
  if (!snap.exists || !active(row) || row.loginAllowed === false || !MANAGERS.has(role)) throw new HotspotError("HOTSPOT_ROLE_DENIED", 403);
  const permissionsSnap = await db.collection("rolePermissions").doc(role).get();
  const permissions = (permissionsSnap.exists ? permissionsSnap.data() : null) as Permissions | null;
  if (role !== Role.SUPER_ADMIN && !canManageAcademicResources(role, permissions)) throw new HotspotError("HOTSPOT_CAPABILITY_DENIED", 403);
  return { role };
}

async function managementContext(actorUid: string, resourceId: string, productId: string, db: Firestore) {
  const { role } = await actor(actorUid, db);
  let authorized;
  try { authorized = await authorizeResourceRead(actorUid, resourceId, { purpose: "MANAGEMENT" }, { db }); }
  catch (error) { throw new HotspotError("HOTSPOT_RESOURCE_SCOPE_DENIED", 403, error instanceof Error ? error.message : "RESOURCE_DENIED"); }
  const resource = authorized.resource;
  const resourceVersion = Number(resource.fileVersion), mimeType = text(resource.mimeType || resource.type).toLowerCase();
  if (!Number.isInteger(resourceVersion) || resourceVersion < 1) throw new HotspotError("HOTSPOT_RESOURCE_VERSION_INVALID", 409);
  if (!(mimeType === "application/pdf" || mimeType.startsWith("image/"))) throw new HotspotError("HOTSPOT_MEDIA_UNSUPPORTED", 409);
  if (role === Role.PRODUCT_MANAGER && text(resource.resourceScope) === "PROMOTION_GROUP") throw new HotspotError("RESOURCE_PROMOTION_GROUP_OWNERSHIP_REQUIRED", 403);
  const productSnap = await db.collection("products").doc(productId).get(), product = productSnap.data() || {};
  if (!productSnap.exists || !active(product)) throw new HotspotError("HOTSPOT_PRODUCT_INVALID", 403);
  if (text(product.promotionGroupId) !== text(resource.promotionGroupId)) throw new HotspotError("HOTSPOT_PROMOTION_GROUP_MISMATCH", 403);
  if (text(resource.resourceScope) !== "PROMOTION_GROUP" && !(resource.productIds || []).map(text).includes(productId)) throw new HotspotError("HOTSPOT_PRODUCT_NOT_APPLICABLE", 403);
  if (role === Role.PRODUCT_MANAGER) {
    const assignments = await db.collection("userProductAssignments").where("userId", "==", actorUid).get();
    const today = Date.now();
    const assigned = assignments.docs.some(doc => { const row = doc.data(); const from = Date.parse(text(row.effectiveFrom) || "1970-01-01"), to = Date.parse(text(row.effectiveTo) || "9999-12-31"); return text(row.productId) === productId && active(row) && from <= today && to >= today; });
    if (!assigned) throw new HotspotError("HOTSPOT_PRODUCT_SCOPE_DENIED", 403);
  }
  return { role, resource: { resourceId, ...resource }, product: { id: productSnap.id, ...product } };
}

async function canonicalMessage(db: Firestore, messageId: string | undefined, productId: string, specialtyId?: string) {
  if (!messageId) return null;
  const snap = await db.collection("keyMessages").doc(messageId).get(), row = snap.data() || {};
  if (!snap.exists || !active(row) || row.isApproved !== true || text(row.productId) !== productId) throw new HotspotError("HOTSPOT_KEY_MESSAGE_INVALID", 403);
  const targets = Array.isArray(row.targetSpecialtyIds) ? row.targetSpecialtyIds.map(text).filter(Boolean) : [];
  if (specialtyId && targets.length && !targets.includes(specialtyId)) throw new HotspotError("HOTSPOT_KEY_MESSAGE_SPECIALTY_DENIED", 403);
  return { id: snap.id, ...row };
}

const output = (doc: any) => ({ hotspotId: doc.id, ...doc.data() });

export async function discoverManagedHotspots(actorUid: string, resourceId: string, db: Firestore) {
  const identity = await actor(actorUid, db);
  let authorized;
  try { authorized = await authorizeResourceRead(actorUid, resourceId, { purpose: "MANAGEMENT" }, { db }); }
  catch (error) { throw new HotspotError("HOTSPOT_RESOURCE_SCOPE_DENIED", 403); }
  const [snap, productsSnap, messagesSnap] = await Promise.all([db.collection("detailingHotspotDefinitions").where("materialId", "==", resourceId).get(), db.collection("products").get(), db.collection("keyMessages").get()]);
  const resource = authorized.resource, groupWidePm = identity.role === Role.PRODUCT_MANAGER && text(resource.resourceScope) === "PROMOTION_GROUP", supportedMedia = text(resource.mimeType || resource.type).toLowerCase() === "application/pdf" || text(resource.mimeType || resource.type).toLowerCase().startsWith("image/");
  const candidates = productsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)).filter(product => active(product) && text(product.promotionGroupId) === text(resource.promotionGroupId) && (text(resource.resourceScope) === "PROMOTION_GROUP" || (resource.productIds || []).map(text).includes(product.id)));
  const products = [] as any[];
  if (!groupWidePm && supportedMedia) for (const product of candidates) { try { await managementContext(actorUid, resourceId, product.id, db); products.push(product); } catch { /* exclude unauthorized Product */ } }
  const ids = new Set(products.map(product => product.id));
  const keyMessages = messagesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)).filter(message => active(message) && message.isApproved === true && ids.has(text(message.productId)));
  return { hotspots: snap.docs.map(output), products, keyMessages, canCreate: !groupWidePm && supportedMedia };
}

async function rejectDuplicate(tx: Transaction, db: Firestore, resourceId: string, pageNumber: number, name: string, excludeId?: string) {
  const query = db.collection("detailingHotspotDefinitions").where("materialId", "==", resourceId).where("pageNumber", "==", pageNumber);
  const snap = await tx.get(query), normalized = name.trim().toLowerCase();
  if (snap.docs.some(doc => doc.id !== excludeId && doc.data().active === true && text(doc.data().hotspotName).toLowerCase() === normalized)) throw new HotspotError("HOTSPOT_DUPLICATE", 409);
}

export async function createHotspot(actorUid: string, resourceId: string, input: HotspotMutationInput, db: Firestore, now?: () => Date) {
  const context = await managementContext(actorUid, resourceId, input.productId, db);
  await canonicalMessage(db, input.linkedKeyMessageId, input.productId);
  const ref = db.collection("detailingHotspotDefinitions").doc(), timestamp = nowIso(now);
  const record = { hotspotId: ref.id, materialId: resourceId, materialName: text(context.resource.titleEn || context.resource.title), productId: input.productId, promotionGroupId: text(context.resource.promotionGroupId), resourceVersion: Number(context.resource.fileVersion), pageNumber: input.pageNumber, hotspotName: input.hotspotName, hotspotType: input.hotspotType, xPercent: input.xPercent, yPercent: input.yPercent, widthPercent: input.widthPercent, heightPercent: input.heightPercent, linkedKeyMessageId: input.linkedKeyMessageId || "", linkedProductId: input.productId, description: input.description || "", active: true, version: 1, createdByUid: actorUid, createdAt: timestamp, updatedByUid: actorUid, updatedAt: timestamp };
  await db.runTransaction(async tx => { await rejectDuplicate(tx, db, resourceId, input.pageNumber, input.hotspotName); tx.create(ref, record); });
  return { hotspot: record };
}

export async function updateHotspot(actorUid: string, resourceId: string, hotspotId: string, input: HotspotMutationInput, db: Firestore, now?: () => Date) {
  if (!safeId(hotspotId)) throw new HotspotError("HOTSPOT_NOT_FOUND", 404);
  const ref = db.collection("detailingHotspotDefinitions").doc(hotspotId), existing = await ref.get(), old = existing.data() || {};
  if (!existing.exists || text(old.materialId) !== resourceId) throw new HotspotError("HOTSPOT_NOT_FOUND", 404);
  const context = await managementContext(actorUid, resourceId, input.productId, db);
  if (Number(old.resourceVersion) !== Number(context.resource.fileVersion)) throw new HotspotError("HOTSPOT_RESOURCE_VERSION_STALE", 409);
  await canonicalMessage(db, input.linkedKeyMessageId, input.productId);
  const patch = { productId: input.productId, linkedProductId: input.productId, promotionGroupId: text(context.resource.promotionGroupId), pageNumber: input.pageNumber, hotspotName: input.hotspotName, hotspotType: input.hotspotType, xPercent: input.xPercent, yPercent: input.yPercent, widthPercent: input.widthPercent, heightPercent: input.heightPercent, linkedKeyMessageId: input.linkedKeyMessageId || "", description: input.description || "", version: Number(old.version || 1) + 1, updatedByUid: actorUid, updatedAt: nowIso(now) };
  await db.runTransaction(async tx => { await rejectDuplicate(tx, db, resourceId, input.pageNumber, input.hotspotName, hotspotId); tx.update(ref, patch); });
  return { hotspot: { hotspotId, ...old, ...patch } };
}

export async function deactivateHotspot(actorUid: string, resourceId: string, hotspotId: string, db: Firestore, now?: () => Date) {
  const ref = db.collection("detailingHotspotDefinitions").doc(hotspotId), snap = await ref.get(), row = snap.data() || {};
  if (!snap.exists || text(row.materialId) !== resourceId) throw new HotspotError("HOTSPOT_NOT_FOUND", 404);
  const context = await managementContext(actorUid, resourceId, text(row.productId), db);
  if (Number(row.resourceVersion) !== Number(context.resource.fileVersion)) throw new HotspotError("HOTSPOT_RESOURCE_VERSION_STALE", 409);
  await ref.update({ active: false, version: Number(row.version || 1) + 1, updatedByUid: actorUid, updatedAt: nowIso(now) });
  return { hotspotId, active: false };
}

export async function recordHotspotInteraction(actorUid: string, resourceId: string, hotspotId: string, input: { contextId: string; productId: string; usageSessionId?: string }, db: Firestore, now?: () => Date) {
  if (!safeId(hotspotId) || !safeId(input.contextId) || !safeId(input.productId) || (input.usageSessionId && !safeId(input.usageSessionId))) throw new HotspotError("RESOURCE_NOT_FOUND", 404);
  let authorized;
  try { authorized = await authorizeResourceRead(actorUid, resourceId, { purpose: "PHYSICIAN_VISIT", contextId: input.contextId, productId: input.productId }, { db, now }); }
  catch (error) { throw publicHotspotReadError(error); }
  const [hotspotSnap, contextSnap] = await Promise.all([db.collection("detailingHotspotDefinitions").doc(hotspotId).get(), db.collection("physicianVisitContexts").doc(input.contextId).get()]);
  const hotspot = hotspotSnap.data() || {}, visitContext = contextSnap.data() || {};
  if (!hotspotSnap.exists || hotspot.active !== true || text(hotspot.materialId) !== resourceId || text(hotspot.productId) !== input.productId || Number(hotspot.resourceVersion) !== Number(authorized.resource.fileVersion)) throw new HotspotError("RESOURCE_NOT_FOUND", 404);
  const physicianSnap = await db.collection("physicians").doc(text(visitContext.physicianId)).get(), physician = physicianSnap.data() || {};
  if (input.usageSessionId) {
    const usage = await db.collection("detailingMaterialUsage").doc(input.usageSessionId).get(), row = usage.data() || {};
    if (!usage.exists || text(row.representativeUid) !== actorUid || text(row.physicianId) !== text(visitContext.physicianId) || text(row.productId) !== input.productId || text(row.materialId) !== resourceId || text(row.visitId) !== text(visitContext.visitId)) throw new HotspotError("RESOURCE_NOT_FOUND", 404, "HOTSPOT_USAGE_SESSION_INVALID");
  }
  const message = await canonicalMessage(db, text(hotspot.linkedKeyMessageId) || undefined, input.productId, text(physician.specialtyId));
  const interactionId = `HSI_${randomUUID().replace(/-/g, "")}`, timestamp = nowIso(now);
  const event = { interactionId, hotspotId, hotspotVersion: Number(hotspot.version), resourceId, resourceVersion: Number(authorized.resource.fileVersion), productId: input.productId, promotionGroupId: text(authorized.resource.promotionGroupId), ...(message ? { keyMessageId: message.id } : {}), pageNumber: Number(hotspot.pageNumber), ...(input.usageSessionId ? { usageSessionId: input.usageSessionId } : {}), visitContextId: input.contextId, visitId: text(visitContext.visitId), physicianId: text(visitContext.physicianId), physicianSpecialtyId: text(physician.specialtyId), representativeUid: actorUid, interactionType: "ACTIVATE", interactedAt: timestamp, createdAt: timestamp };
  if (!event.visitId) throw new HotspotError("RESOURCE_NOT_FOUND", 404, "HOTSPOT_VISIT_ID_MISSING");
  await db.collection("detailingHotspotInteractions").doc(interactionId).create(event);
  return { interactionId, recorded: true };
}
