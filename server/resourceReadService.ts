import { randomUUID } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { Role, type Permissions } from "../src/types";
import { canManageAcademicResources } from "../src/lib/canonicalPermissionApplicability";
import { eligibleProductsForPhysician } from "../src/lib/canonicalRepresentativeScope";
import { getActiveCanonicalAssignmentsForUser, isProductAssignmentEffectiveAt } from "../src/lib/productAssignmentService";
import { validateCanonicalResourceForProduct, PhysicianVisitWriteError } from "./physicianVisitWriteService";
import { createFirestoreOperationalScopeRepository, resolveOperationalScopeForActor, type OperationalScopeRepository } from "./operationalScopeRepository";

const MEDICAL_REP = "Medical Representative";
const CONTEXT_TTL_MS = 4 * 60 * 60 * 1000;
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const active = (value: any) => value?.active !== false && value?.isActive !== false && value?.isDeleted !== true && value?.status !== "Inactive" && value?.status !== "Archived";
const unique = (values: string[]) => [...new Set(values.map(text).filter(Boolean))];
const effectiveAt = (value: any, now: Date) => {
  const from = text(value?.effectiveFrom), to = text(value?.effectiveTo);
  return (!from || (Number.isFinite(Date.parse(from)) && Date.parse(from) <= now.getTime())) && (!to || (Number.isFinite(Date.parse(to)) && Date.parse(to) >= now.getTime()));
};

export type ResourceReadPurpose = "MANAGEMENT" | "PHYSICIAN_VISIT" | "PRODUCT_DETAIL";
export interface ResourceReadContext { purpose: ResourceReadPurpose; contextId?: string; productId?: string }
export interface ResourceReadDependencies { db: Firestore; now?: () => Date; scopeRepository?: OperationalScopeRepository }

export class ResourceReadError extends Error {
  constructor(public code: string, public status: number, message = code, public internalCode = code) { super(message); }
}

export const publicResourceReadError = (error: unknown): ResourceReadError => {
  if (error instanceof ResourceReadError && error.status === 400) return error;
  if (error instanceof ResourceReadError && error.code === "RESOURCE_BINARY_RANGE_INVALID") return error;
  return new ResourceReadError("RESOURCE_NOT_FOUND", 404, "RESOURCE_NOT_FOUND", error instanceof ResourceReadError ? error.internalCode : "RESOURCE_READ_FAILED");
};

export function parseVisitContextCreate(value: unknown): { physicianId: string; visitDate: string; plannerVisitId?: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as any, keys = Object.keys(row);
  if (keys.some(key => !["physicianId", "visitDate", "plannerVisitId"].includes(key))) return null;
  const physicianId = text(row.physicianId), visitDate = text(row.visitDate), plannerVisitId = text(row.plannerVisitId);
  if (!physicianId || !/^\d{4}-\d{2}-\d{2}$/.test(visitDate)) return null;
  return { physicianId, visitDate, ...(plannerVisitId ? { plannerVisitId } : {}) };
}

async function actorAndPermissions(actorUid: string, db: Firestore) {
  const actorSnap = await db.collection("users").doc(actorUid).get();
  if (!actorSnap.exists || !active(actorSnap.data()) || actorSnap.data()?.loginAllowed === false) throw new ResourceReadError("RESOURCE_ACTOR_DENIED", 403);
  const actor = { id: actorSnap.id, ...actorSnap.data() } as any, role = text(actor.role);
  const permissionSnap = await db.collection("rolePermissions").doc(role).get();
  return { actor, role, permissions: (permissionSnap.exists ? permissionSnap.data() : null) as Permissions | null };
}

async function canonicalProductsForUser(actorUid: string, db: Firestore, now: Date) {
  const [assignmentSnap, productSnap] = await Promise.all([
    db.collection("userProductAssignments").where("userId", "==", actorUid).get(),
    db.collection("products").get(),
  ]);
  const products = productSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
  const assignments = assignmentSnap.docs.map(doc => ({ assignmentId: doc.id, ...doc.data() } as any));
  const report = getActiveCanonicalAssignmentsForUser({ assignments, userId: actorUid, products });
  const effectiveAssignments = report.assignments.filter(item => isProductAssignmentEffectiveAt(item, now));
  const ids = new Set(effectiveAssignments.map(item => item.productId));
  return { products, assignments: effectiveAssignments, authorizedProducts: products.filter(product => ids.has(product.id) && active(product)) };
}

function metadata(resource: any) {
  const { storagePath: _storagePath, downloadUrl: _downloadUrl, generation: _generation, ...safe } = resource;
  return safe;
}

function fieldReady(resource: any, product: any, specialtyId: string | undefined, atDate: string): boolean {
  try {
    validateCanonicalResourceForProduct({ resource, resourceId: text(resource.resourceId || resource.id), product, productId: text(product?.id), physicianSpecialtyId: specialtyId, atDate });
    return true;
  } catch { return false; }
}

export async function createPhysicianVisitContext(actorUid: string, request: { physicianId: string; visitDate: string; plannerVisitId?: string }, deps: ResourceReadDependencies) {
  const { db } = deps, now = (deps.now || (() => new Date()))();
  const { actor, role } = await actorAndPermissions(actorUid, db);
  if (role !== MEDICAL_REP) throw new ResourceReadError("RESOURCE_VISIT_CONTEXT_DENIED", 403);
  const [physicianSnap, territorySnap, canonical] = await Promise.all([
    db.collection("physicians").doc(request.physicianId).get(),
    db.collection("userTerritoryAssignments").where("userId", "==", actorUid).get(),
    canonicalProductsForUser(actorUid, db, now),
  ]);
  if (!physicianSnap.exists || !active(physicianSnap.data())) throw new ResourceReadError("RESOURCE_VISIT_CONTEXT_DENIED", 403);
  const physician = { id: physicianSnap.id, ...physicianSnap.data() } as any;
  const areaIds = new Set(territorySnap.docs.map(doc => doc.data()).filter(row => active(row) && effectiveAt(row, now)).map(row => text(row.areaId || row.territoryId)));
  if (!text(physician.areaId) || !areaIds.has(text(physician.areaId))) throw new ResourceReadError("RESOURCE_VISIT_CONTEXT_DENIED", 403);
  let plannerVisitId = "";
  if (request.plannerVisitId) {
    const planner = await db.collection("medicalPlannerVisits").doc(request.plannerVisitId).get(), row = planner.data();
    if (!planner.exists || text(row?.repId) !== actorUid || text(row?.physicianId) !== request.physicianId || text(row?.date) !== request.visitDate || ["CANCELLED", "REMOVED", "REJECTED"].includes(text(row?.status).toUpperCase())) throw new ResourceReadError("RESOURCE_VISIT_CONTEXT_DENIED", 403);
    plannerVisitId = planner.id;
  } else {
    const planned = await db.collection("medicalPlannerVisits").where("repId", "==", actorUid).where("physicianId", "==", request.physicianId).where("date", "==", request.visitDate).get();
    const usable = planned.docs.find(doc => !["CANCELLED", "REMOVED", "REJECTED"].includes(text(doc.data().status).toUpperCase()));
    plannerVisitId = usable?.id || "";
  }
  const eligible = eligibleProductsForPhysician({ physician, representativeUid: actorUid, productAssignments: canonical.assignments as any, products: canonical.products as any });
  if (!eligible.length) throw new ResourceReadError("RESOURCE_VISIT_CONTEXT_DENIED", 403);
  const contextId = `PVC_${randomUUID().replace(/-/g, "")}`;
  const visitId = `VIS_${randomUUID().replace(/-/g, "")}`;
  const createdAt = now.toISOString(), expiresAt = new Date(now.getTime() + CONTEXT_TTL_MS).toISOString();
  await db.collection("physicianVisitContexts").doc(contextId).create({ contextId, visitId, representativeUid: actorUid, physicianId: physician.id, visitDate: request.visitDate, kind: plannerVisitId ? "PLANNED" : "AD_HOC", ...(plannerVisitId ? { plannerVisitId } : {}), eligibleProductIds: eligible.map(product => product.id), status: "ACTIVE", createdAt, createdBy: actor.id, expiresAt });
  return { contextId, visitId, physicianId: physician.id, visitDate: request.visitDate, kind: plannerVisitId ? "PLANNED" as const : "AD_HOC" as const, expiresAt, eligibleProductIds: eligible.map(product => product.id) };
}

async function liveVisitContext(actorUid: string, contextId: string, deps: ResourceReadDependencies) {
  const now = (deps.now || (() => new Date()))(), snap = await deps.db.collection("physicianVisitContexts").doc(contextId).get(), context = snap.data() as any;
  if (!snap.exists || text(context.representativeUid) !== actorUid || text(context.status) !== "ACTIVE" || text(context.expiresAt) <= now.toISOString()) throw new ResourceReadError("RESOURCE_VISIT_CONTEXT_DENIED", 403);
  const [physicianSnap, territorySnap, canonical] = await Promise.all([
    deps.db.collection("physicians").doc(text(context.physicianId)).get(),
    deps.db.collection("userTerritoryAssignments").where("userId", "==", actorUid).get(),
    canonicalProductsForUser(actorUid, deps.db, now),
  ]);
  if (!physicianSnap.exists || !active(physicianSnap.data())) throw new ResourceReadError("RESOURCE_VISIT_CONTEXT_DENIED", 403);
  const physician = { id: physicianSnap.id, ...physicianSnap.data() } as any;
  const areas = new Set(territorySnap.docs.map(doc => doc.data()).filter(row => active(row) && effectiveAt(row, now)).map(row => text(row.areaId || row.territoryId)));
  if (!areas.has(text(physician.areaId))) throw new ResourceReadError("RESOURCE_VISIT_CONTEXT_DENIED", 403);
  const products = eligibleProductsForPhysician({ physician, representativeUid: actorUid, productAssignments: canonical.assignments as any, products: canonical.products as any });
  if (!products.length) throw new ResourceReadError("RESOURCE_VISIT_CONTEXT_DENIED", 403);
  return { context: { id: snap.id, ...context }, physician, products, atDate: text(context.visitDate) };
}

async function productScope(actorUid: string, role: string, deps: ResourceReadDependencies) {
  if (role === Role.SUPER_ADMIN || role === Role.ADMIN) return { global: true, products: (await canonicalProductsForUser(actorUid, deps.db, (deps.now || (() => new Date()))())).products };
  if (role === Role.PRODUCT_MANAGER) return { global: false, products: (await canonicalProductsForUser(actorUid, deps.db, (deps.now || (() => new Date()))())).authorizedProducts };
  const scope = await resolveOperationalScopeForActor(actorUid, {}, deps.scopeRepository || createFirestoreOperationalScopeRepository());
  if (!scope.authorized || scope.queryPlan.denyAll) throw new ResourceReadError("RESOURCE_SCOPE_DENIED", 403);
  const all = (await canonicalProductsForUser(actorUid, deps.db, (deps.now || (() => new Date()))())).products;
  return { global: false, products: all.filter(product => scope.productIds.includes(product.id)) };
}

export async function discoverManagementResources(actorUid: string, deps: ResourceReadDependencies) {
  const { role, permissions } = await actorAndPermissions(actorUid, deps.db);
  if (role !== Role.SUPER_ADMIN && !canManageAcademicResources(role, permissions)) throw new ResourceReadError("RESOURCE_MANAGEMENT_READ_DENIED", 403);
  const scope = await productScope(actorUid, role, deps), resourceSnap = await deps.db.collection("academicResources").get();
  const productIds = new Set(scope.products.map((product: any) => product.id)), groups = new Set(scope.products.map((product: any) => text(product.promotionGroupId)));
  const resources = resourceSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)).filter(resource => !resource.isDeleted && (scope.global || (text(resource.resourceScope) === "PROMOTION_GROUP" ? groups.has(text(resource.promotionGroupId)) : (resource.productIds || []).some((id: string) => productIds.has(text(id))))));
  return { resources: resources.map(metadata) };
}

export async function discoverVisitResources(actorUid: string, contextId: string, deps: ResourceReadDependencies) {
  const { role } = await actorAndPermissions(actorUid, deps.db); if (role !== MEDICAL_REP) throw new ResourceReadError("RESOURCE_VISIT_CONTEXT_DENIED", 403);
  const live = await liveVisitContext(actorUid, contextId, deps), snap = await deps.db.collection("academicResources").get();
  const resourcesByProduct: Record<string, any[]> = {};
  for (const product of live.products) resourcesByProduct[product.id] = snap.docs.map(doc => ({ id: doc.id, resourceId: doc.id, ...doc.data() })).filter(resource => fieldReady(resource, product, text(live.physician.specialtyId), live.atDate)).map(metadata);
  return { contextId, physicianId: live.physician.id, visitDate: live.atDate, eligibleProductIds: live.products.map(product => product.id), resourcesByProduct };
}

export async function discoverProductResources(actorUid: string, productId: string, deps: ResourceReadDependencies) {
  const { role } = await actorAndPermissions(actorUid, deps.db), scope = await productScope(actorUid, role, deps);
  const product = scope.products.find((item: any) => item.id === productId && active(item));
  if (!product) throw new ResourceReadError("RESOURCE_PRODUCT_NOT_AUTHORIZED", 403);
  const today = (deps.now || (() => new Date()))().toISOString().slice(0, 10), snap = await deps.db.collection("academicResources").get();
  return { productId, resources: snap.docs.map(doc => ({ id: doc.id, resourceId: doc.id, ...doc.data() })).filter(resource => fieldReady(resource, product, undefined, today)).map(metadata) };
}

export async function authorizeResourceRead(actorUid: string, resourceId: string, context: ResourceReadContext, deps: ResourceReadDependencies) {
  const resourceSnap = await deps.db.collection("academicResources").doc(resourceId).get();
  if (!resourceSnap.exists || resourceSnap.data()?.isDeleted) throw new ResourceReadError("RESOURCE_NOT_FOUND", 404);
  const resource = { id: resourceSnap.id, resourceId: resourceSnap.id, ...resourceSnap.data() } as any;
  const { role, permissions } = await actorAndPermissions(actorUid, deps.db);
  if (context.purpose === "MANAGEMENT") {
    if (role !== Role.SUPER_ADMIN && !canManageAcademicResources(role, permissions)) throw new ResourceReadError("RESOURCE_MANAGEMENT_READ_DENIED", 403);
    const scope = await productScope(actorUid, role, deps);
    const allowed = scope.global || (text(resource.resourceScope) === "PROMOTION_GROUP" ? scope.products.some((p: any) => text(p.promotionGroupId) === text(resource.promotionGroupId)) : (resource.productIds || []).some((id: string) => scope.products.some((p: any) => p.id === id)));
    if (!allowed) throw new ResourceReadError("RESOURCE_SCOPE_DENIED", 403);
    return { resource, product: null, atDate: (deps.now || (() => new Date()))().toISOString().slice(0, 10) };
  }
  if (context.purpose === "PHYSICIAN_VISIT") {
    if (role !== MEDICAL_REP || !context.contextId || !context.productId) throw new ResourceReadError("RESOURCE_VISIT_CONTEXT_DENIED", 403);
    const live = await liveVisitContext(actorUid, context.contextId, deps), product = live.products.find(item => item.id === context.productId);
    if (!product) throw new ResourceReadError("RESOURCE_PRODUCT_NOT_AUTHORIZED", 403);
    validateCanonicalResourceForProduct({ resource, resourceId, product, productId: product.id, physicianSpecialtyId: text(live.physician.specialtyId), atDate: live.atDate });
    return { resource, product, atDate: live.atDate };
  }
  if (context.purpose === "PRODUCT_DETAIL" && context.productId) {
    const scope = await productScope(actorUid, role, deps), product = scope.products.find((item: any) => item.id === context.productId && active(item));
    if (!product) throw new ResourceReadError("RESOURCE_PRODUCT_NOT_AUTHORIZED", 403);
    const today = (deps.now || (() => new Date()))().toISOString().slice(0, 10);
    validateCanonicalResourceForProduct({ resource, resourceId, product, productId: product.id, atDate: today });
    return { resource, product, atDate: today };
  }
  throw new ResourceReadError("RESOURCE_READ_CONTEXT_INVALID", 400);
}

export async function readActiveHotspots(actorUid: string, resourceId: string, context: ResourceReadContext, pageNumber: number | undefined, deps: ResourceReadDependencies) {
  const authorized = await authorizeResourceRead(actorUid, resourceId, context, deps);
  let query: any = deps.db.collection("detailingHotspotDefinitions").where("materialId", "==", resourceId).where("active", "==", true);
  if (pageNumber !== undefined) query = query.where("pageNumber", "==", pageNumber);
  const snap = await query.get();
  return { hotspots: snap.docs.map((doc: any) => ({ hotspotId: doc.id, ...doc.data() })).filter((row: any) => row.active === true && text(row.materialId) === resourceId && Number(row.resourceVersion) === Number(authorized.resource.fileVersion) && (!authorized.product || text(row.productId) === text(authorized.product.id))) };
}

export function parseSingleRange(header: string | undefined, size: number): { start: number; end: number } | null {
  if (!header) return null;
  if (!/^bytes=\d*-\d*$/.test(header) || header.includes(",")) throw new ResourceReadError("RESOURCE_BINARY_RANGE_INVALID", 416);
  const [left, right] = header.slice(6).split("-");
  let start: number, end: number;
  if (!left) { const suffix = Number(right); if (!Number.isInteger(suffix) || suffix <= 0) throw new ResourceReadError("RESOURCE_BINARY_RANGE_INVALID", 416); start = Math.max(0, size - suffix); end = size - 1; }
  else { start = Number(left); end = right ? Number(right) : size - 1; }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size || end >= size) throw new ResourceReadError("RESOURCE_BINARY_RANGE_INVALID", 416);
  return { start, end };
}
