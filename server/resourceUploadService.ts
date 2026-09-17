import { randomUUID } from "node:crypto";
import { GoogleAuth } from "google-auth-library";
import type { Firestore } from "firebase-admin/firestore";
import { Role, type Permissions } from "../src/types";
import { canManageAcademicResources } from "../src/lib/canonicalPermissionApplicability";
import { getActiveCanonicalAssignmentsForUser, isProductAssignmentEffectiveAt } from "../src/lib/productAssignmentService";
import { createFirestoreOperationalScopeRepository, resolveOperationalScopeForActor, type OperationalScopeRepository } from "./operationalScopeRepository";
import { getFirebaseAdminServices } from "./firebaseAdmin";
import { getFirebaseRuntimeIdentity } from "./firebaseRuntimeIdentity";

const MAX_BYTES = 250 * 1024 * 1024;
const TTL_MS = 15 * 60 * 1000;
const MIME_TYPES = new Set([
  "application/pdf", "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm",
]);
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const safeId = (value: string) => /^[A-Za-z0-9_-]{1,128}$/.test(value);
export class ResourceUploadError extends Error { constructor(public code: string, public status = 400) { super(code); } }

export function validateResourceUploadOrigin(originHeader: unknown, requestHost: unknown): string {
  const origin = text(originHeader), host = text(requestHost).toLowerCase();
  if (!origin || !host || host.includes(",") || /[\s/\\]/.test(host)) throw new ResourceUploadError("RESOURCE_UPLOAD_ORIGIN_DENIED", 403);
  let parsed: URL;
  try { parsed = new URL(origin); } catch { throw new ResourceUploadError("RESOURCE_UPLOAD_ORIGIN_DENIED", 403); }
  const loopback = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]";
  if (parsed.origin !== origin || parsed.host.toLowerCase() !== host || (parsed.protocol !== "https:" && !(loopback && parsed.protocol === "http:"))) {
    throw new ResourceUploadError("RESOURCE_UPLOAD_ORIGIN_DENIED", 403);
  }
  return parsed.origin;
}

export interface ResourceUploadAuthorizationCommand {
  promotionGroupId: string; productIds: string[]; resourceScope: "SELECTED_PRODUCTS" | "PROMOTION_GROUP"; originalFileName: string; mimeType: string; expectedSize: number;
  metadata: Record<string, unknown>; replaceResourceId?: string;
}
const RESOURCE_METADATA_FIELDS = new Set(["titleEn", "titleAr", "title", "category", "resourceScope", "specialtyIds", "therapeuticAreaId", "therapeuticArea", "language", "approvalStatus", "active", "effectiveDate", "expiryDate", "brand", "promotionGroupName", "productNames", "specialtyNames", "size", "type", "isDeleted"]);
const cleanMetadata = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value).filter(([key, item]) => RESOURCE_METADATA_FIELDS.has(key) && item !== undefined));
export function parseResourceUploadAuthorization(value: unknown): ResourceUploadAuthorizationCommand | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>, promotionGroupId = text(row.promotionGroupId), originalFileName = text(row.originalFileName), mimeType = text(row.mimeType), expectedSize = Number(row.expectedSize);
  const productIds = Array.isArray(row.productIds) ? [...new Set(row.productIds.map(text).filter(Boolean))] : [], replaceResourceId = text(row.replaceResourceId);
  const resourceScope = text((row.metadata as Record<string, unknown> | undefined)?.resourceScope);
  if (!safeId(promotionGroupId) || !originalFileName || originalFileName.length > 255 || !MIME_TYPES.has(mimeType) || !Number.isInteger(expectedSize) || expectedSize <= 0 || expectedSize > MAX_BYTES || !row.metadata || typeof row.metadata !== "object" || Array.isArray(row.metadata)) return null;
  if (!(["SELECTED_PRODUCTS", "PROMOTION_GROUP"] as string[]).includes(resourceScope)) return null;
  if (replaceResourceId && !safeId(replaceResourceId)) return null;
  return { promotionGroupId, productIds, resourceScope: resourceScope as ResourceUploadAuthorizationCommand["resourceScope"], originalFileName, mimeType, expectedSize, metadata: cleanMetadata(row.metadata as Record<string, unknown>), ...(replaceResourceId ? { replaceResourceId } : {}) };
}
export function sanitizeResourceFileName(name: string): string {
  const parts = name.normalize("NFKC").split("."), extension = (parts.pop() || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const base = parts.join(".").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 160);
  if (!base || !extension) throw new ResourceUploadError("RESOURCE_FILENAME_INVALID");
  return `${base}.${extension}`;
}

export interface ResourceObjectGateway {
  start(input: { bucket: string; objectPath: string; mimeType: string; size: number; origin: string }): Promise<string>;
  get(bucket: string, objectPath: string): Promise<{ size: number; contentType: string; generation: string; metageneration?: string }>;
  delete(bucket: string, objectPath: string, generation: string): Promise<void>;
}
async function accessToken(): Promise<string> {
  const client = await new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/devstorage.read_write"] }).getClient();
  const token = await client.getAccessToken();
  if (!token.token) throw new ResourceUploadError("RESOURCE_STORAGE_CREDENTIAL_UNAVAILABLE", 503);
  return token.token;
}
export const googleStorageGateway: ResourceObjectGateway = {
  async start(input) {
    const response = await fetch(`https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(input.bucket)}/o?uploadType=resumable&name=${encodeURIComponent(input.objectPath)}&ifGenerationMatch=0`, {
      method: "POST", headers: { Authorization: `Bearer ${await accessToken()}`, Origin: input.origin, "Content-Type": "application/json", "X-Upload-Content-Type": input.mimeType, "X-Upload-Content-Length": String(input.size) }, body: JSON.stringify({ name: input.objectPath, contentType: input.mimeType, metadata: { menarepsUpload: "resource" } }),
    });
    const location = response.headers.get("location");
    if (!response.ok || !location) throw new ResourceUploadError("RESOURCE_RESUMABLE_SESSION_FAILED", 502);
    return location;
  },
  async get(bucket, objectPath) {
    const response = await fetch(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectPath)}`, { headers: { Authorization: `Bearer ${await accessToken()}` } });
    if (!response.ok) throw new ResourceUploadError("RESOURCE_OBJECT_NOT_FOUND", response.status === 404 ? 404 : 502);
    const row = await response.json() as any;
    return { size: Number(row.size), contentType: text(row.contentType), generation: text(row.generation), metageneration: text(row.metageneration) };
  },
  async delete(bucket, objectPath, generation) {
    const response = await fetch(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectPath)}?ifGenerationMatch=${encodeURIComponent(generation)}`, { method: "DELETE", headers: { Authorization: `Bearer ${await accessToken()}` } });
    if (!response.ok && response.status !== 404) throw new ResourceUploadError("RESOURCE_ORPHAN_DELETE_FAILED", 502);
  },
};

export type ResourceUploadDependencies = { db?: Firestore; scopeRepository?: OperationalScopeRepository; gateway?: ResourceObjectGateway; now?: () => Date; bucket?: string };
export async function authorizeResourceUpload(actorUid: string, command: ResourceUploadAuthorizationCommand, deps: ResourceUploadDependencies) {
  const db = deps.db || getFirebaseAdminServices().db;
  const actorSnap = await db.collection("users").doc(actorUid).get(), actor = actorSnap.data() || {}, role = text(actor.role);
  const permissionSnap = await db.collection("rolePermissions").doc(role).get(), permissions = permissionSnap.data() as Permissions | undefined;
  if (!actorSnap.exists || actor.active === false || actor.loginAllowed === false || !canManageAcademicResources(role, permissions)) throw new ResourceUploadError("RESOURCE_ROLE_DENIED", 403);
  if (command.resourceScope === "SELECTED_PRODUCTS" && command.productIds.length === 0) throw new ResourceUploadError("RESOURCE_SELECTED_PRODUCTS_REQUIRED", 400);
  if (role === Role.PRODUCT_MANAGER && command.resourceScope === "PROMOTION_GROUP") throw new ResourceUploadError("RESOURCE_PROMOTION_GROUP_OWNERSHIP_REQUIRED", 403);
  const productSnaps = command.productIds.length
    ? await Promise.all(command.productIds.map(id => db.collection("products").doc(id).get()))
    : (await db.collection("products").where("promotionGroupId", "==", command.promotionGroupId).get()).docs;
  const productIds = productSnaps.filter(s => s.exists && s.data()?.active !== false && s.data()?.isActive !== false && text(s.data()?.promotionGroupId) === command.promotionGroupId).map(s => s.id);
  if (!productIds.length || (command.productIds.length > 0 && productIds.length !== command.productIds.length)) throw new ResourceUploadError("RESOURCE_PRODUCT_INVALID", 403);
  if (role === Role.PRODUCT_MANAGER) {
    const repository = deps.scopeRepository || createFirestoreOperationalScopeRepository();
    const [assignments, products] = await Promise.all([repository.getProductAssignments([actorUid]), repository.getProducts()]);
    const report = getActiveCanonicalAssignmentsForUser({ assignments, userId: actorUid, products });
    const assignedProductIds = new Set(report.assignments.filter(assignment => isProductAssignmentEffectiveAt(assignment, (deps.now || (() => new Date()))())).map(assignment => assignment.productId));
    if (productIds.some(id => !assignedProductIds.has(id))) throw new ResourceUploadError("RESOURCE_PRODUCT_SCOPE_DENIED", 403);
  } else if (![Role.SUPER_ADMIN, Role.ADMIN].includes(role as Role)) {
    const scope = await resolveOperationalScopeForActor(actorUid, {}, deps.scopeRepository || createFirestoreOperationalScopeRepository());
    if (!scope.authorized || scope.queryPlan.denyAll || !scope.productGroupIds.includes(command.promotionGroupId) || productIds.some(id => !scope.productIds.includes(id))) throw new ResourceUploadError("RESOURCE_SCOPE_DENIED", 403);
  }
  return { db, role, productIds: command.resourceScope === "PROMOTION_GROUP" ? [] : productIds };
}

export async function initiateResourceUpload(actorUid: string, command: ResourceUploadAuthorizationCommand, origin: string, deps: ResourceUploadDependencies = {}) {
  const { db, role, productIds } = await authorizeResourceUpload(actorUid, command, deps), now = (deps.now || (() => new Date()))();
  const authorizationId = randomUUID(), resourceId = command.replaceResourceId || `RES-${randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`;
  const existing = command.replaceResourceId ? await db.collection("academicResources").doc(resourceId).get() : null;
  if (command.replaceResourceId && !existing?.exists) throw new ResourceUploadError("RESOURCE_NOT_FOUND", 404);
  if (existing) {
    const current = existing.data() || {};
    const currentProductIds = Array.isArray(current.productIds) ? current.productIds.map(text).filter(Boolean) : [];
    const currentScope = text(current.resourceScope);
    const scopeMismatch = currentScope !== command.resourceScope;
    const selectedProductMismatch = command.resourceScope === "SELECTED_PRODUCTS" && [...currentProductIds].sort().join("\u0000") !== [...productIds].sort().join("\u0000");
    if (text(current.promotionGroupId) !== command.promotionGroupId || scopeMismatch || selectedProductMismatch) {
      throw new ResourceUploadError("RESOURCE_REPLACEMENT_SCOPE_IMMUTABLE", 403);
    }
  }
  const version = existing ? Number(existing.data()?.fileVersion || 0) + 1 : 1;
  const fileName = sanitizeResourceFileName(command.originalFileName), objectPath = `resources/${command.promotionGroupId}/${resourceId}/v${version}/${fileName}`;
  const bucket = deps.bucket || process.env.FIREBASE_STORAGE_BUCKET || `${getFirebaseRuntimeIdentity().projectId}.firebasestorage.app`;
  const ref = db.collection("resourceUploadAuthorizations").doc(authorizationId);
  await ref.create({ authorizationId, actorUid, role, resourceId, replacing: Boolean(existing), promotionGroupId: command.promotionGroupId, resourceScope: command.resourceScope, productIds, bucket, objectPath, originalFileName: command.originalFileName, sanitizedFileName: fileName, expectedMimeType: command.mimeType, expectedSize: command.expectedSize, version, metadata: command.metadata, status: "PENDING", createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + TTL_MS).toISOString() });
  try {
    const uploadSessionUri = await (deps.gateway || googleStorageGateway).start({ bucket, objectPath, mimeType: command.mimeType, size: command.expectedSize, origin });
    return { authorizationId, resourceId, uploadSessionUri, objectPath, expiresAt: new Date(now.getTime() + TTL_MS).toISOString() };
  } catch (error) { await ref.set({ status: "FAILED", failedAt: now.toISOString() }, { merge: true }); throw error; }
}

export async function finalizeResourceUpload(actorUid: string, authorizationId: string, deps: ResourceUploadDependencies = {}) {
  if (!safeId(authorizationId)) throw new ResourceUploadError("RESOURCE_AUTHORIZATION_INVALID");
  const db = deps.db || getFirebaseAdminServices().db, ref = db.collection("resourceUploadAuthorizations").doc(authorizationId), snap = await ref.get(), auth = snap.data();
  if (!snap.exists || auth?.actorUid !== actorUid || auth?.status !== "PENDING") throw new ResourceUploadError("RESOURCE_AUTHORIZATION_DENIED", 403);
  const now = (deps.now || (() => new Date()))();
  if (Date.parse(auth.expiresAt) <= now.getTime()) {
    const gateway = deps.gateway || googleStorageGateway;
    try {
      const object = await gateway.get(auth.bucket, auth.objectPath);
      if (object.generation) await gateway.delete(auth.bucket, auth.objectPath, object.generation);
    } catch (error) {
      if (!(error instanceof ResourceUploadError) || error.code !== "RESOURCE_OBJECT_NOT_FOUND") throw error;
    }
    await ref.set({ status: "EXPIRED", expiredAt: now.toISOString() }, { merge: true });
    throw new ResourceUploadError("RESOURCE_AUTHORIZATION_EXPIRED", 410);
  }
  const command: ResourceUploadAuthorizationCommand = { promotionGroupId: auth.promotionGroupId, productIds: auth.productIds, resourceScope: auth.resourceScope || auth.metadata?.resourceScope, originalFileName: auth.originalFileName, mimeType: auth.expectedMimeType, expectedSize: auth.expectedSize, metadata: auth.metadata, ...(auth.replacing ? { replaceResourceId: auth.resourceId } : {}) };
  await authorizeResourceUpload(actorUid, command, deps);
  const object = await (deps.gateway || googleStorageGateway).get(auth.bucket, auth.objectPath);
  if (object.size !== auth.expectedSize || object.contentType !== auth.expectedMimeType || !object.generation) {
    if (object.generation) await (deps.gateway || googleStorageGateway).delete(auth.bucket, auth.objectPath, object.generation);
    await ref.set({ status: "FAILED", failedAt: now.toISOString() }, { merge: true });
    throw new ResourceUploadError("RESOURCE_OBJECT_MISMATCH", 409);
  }
  await db.runTransaction(async tx => {
    const live = await tx.get(ref);
    if (live.data()?.status !== "PENDING") throw new ResourceUploadError("RESOURCE_AUTHORIZATION_REPLAY", 409);
    const resourceRef = db.collection("academicResources").doc(auth.resourceId), resourceData = { ...auth.metadata, resourceId: auth.resourceId, promotionGroupId: auth.promotionGroupId, productIds: auth.productIds, fileName: auth.sanitizedFileName, originalFileName: auth.originalFileName, sanitizedFileName: auth.sanitizedFileName, mimeType: auth.expectedMimeType, fileSizeBytes: auth.expectedSize, storagePath: auth.objectPath, fileVersion: auth.version, uploadStatus: "COMPLETE", uploadedByUid: actorUid, uploadedAt: now.toISOString(), updatedByUid: actorUid, updatedAt: now.toISOString(), active: auth.metadata?.active !== false };
    if (auth.replacing) tx.set(resourceRef, resourceData, { merge: true }); else tx.create(resourceRef, resourceData);
    tx.update(ref, { status: "FINALIZED", finalizedAt: now.toISOString(), objectGeneration: object.generation, objectMetageneration: object.metageneration || null });
  });
  return { success: true, resourceId: auth.resourceId, storagePath: auth.objectPath };
}

const MUTABLE_METADATA = new Set([...RESOURCE_METADATA_FIELDS, "uploadStatus"]);
export async function mutateResourceMetadata(actorUid: string, input: { resourceId: string; patch: Record<string, unknown> }, deps: ResourceUploadDependencies = {}) {
  if (!safeId(input.resourceId) || !input.patch || Object.keys(input.patch).some(key => !MUTABLE_METADATA.has(key))) throw new ResourceUploadError("RESOURCE_METADATA_INVALID");
  const db = deps.db || getFirebaseAdminServices().db, ref = db.collection("academicResources").doc(input.resourceId), existing = await ref.get();
  if (!existing.exists) throw new ResourceUploadError("RESOURCE_NOT_FOUND", 404);
  const row = existing.data() || {};
  const resourceScope = text(row.resourceScope) as ResourceUploadAuthorizationCommand["resourceScope"];
  if (input.patch.resourceScope !== undefined && text(input.patch.resourceScope) !== resourceScope) throw new ResourceUploadError("RESOURCE_REPLACEMENT_SCOPE_IMMUTABLE", 403);
  await authorizeResourceUpload(actorUid, { promotionGroupId: text(row.promotionGroupId), productIds: resourceScope === "PROMOTION_GROUP" ? [] : Array.isArray(row.productIds) ? row.productIds.map(text) : [], resourceScope, originalFileName: text(row.originalFileName || row.fileName), mimeType: text(row.mimeType), expectedSize: Number(row.fileSizeBytes), metadata: input.patch }, deps);
  await ref.set({ ...input.patch, ...(resourceScope === "PROMOTION_GROUP" ? { productIds: [] } : {}), updatedAt: (deps.now || (() => new Date()))().toISOString(), updatedByUid: actorUid }, { merge: true });
  return { success: true, resourceId: input.resourceId };
}
