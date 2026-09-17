import { createHash } from "node:crypto";
import type { Firestore, Transaction, DocumentReference, QueryDocumentSnapshot } from "firebase-admin/firestore";
import type { CanonicalPrescriptionIntent, PhysicianVisit, SampleBatch, SampleAllocation, SampleSku } from "../src/types";
import { validateDetailingCompletion } from "../src/lib/physicianVisitDetailingIntegrity";
import { eligibleProductsForPhysician } from "../src/lib/canonicalRepresentativeScope";
import { validateBusinessDocumentCode, type MarketBusinessSettings } from "../src/lib/marketSettings";
import { removeUndefinedRecursively } from "../src/utils/importNormalization";
import { aggregateSampleRequests, assertRollingPhysicianLimit, isCanonicalDate, marketLocalDate, planRepresentativeFefo, SampleDistributionPolicyError } from "./sampleDistributionPolicy";
import { VISIT_MARKETING_REQUEST_RESOURCE, VISIT_MARKETING_REQUEST_SCHEMA_VERSION, hasVisitMarketingRequestPermission, isCanonicalUserActive, parseVisitMarketingRequestDraft, type CanonicalVisitMarketingRequest, type VisitMarketingRequestDraft } from "../src/lib/visitMarketingRequestPolicy";
import { canonicalSampleRequest, visitSampleRequestId } from "./sampleRequestService";

const MEDICAL_REP = "Medical Representative";

export class PhysicianVisitWriteError extends Error {
  constructor(public code: string, public status: number, message = code) { super(message); }
}

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const active = (value: any) => value?.active !== false && value?.isActive !== false && value?.isDeleted !== true && value?.status !== "Inactive";
const unique = (values: string[]) => [...new Set(values.filter(Boolean))];
const PRESCRIPTION_INTENTS = new Set<CanonicalPrescriptionIntent>(["Will Prescribe", "Considering", "Needs Info", "Not Interested"]);

function submittedMaterialIds(detail: any): string[] {
  const hasMaterialIds = detail.materialIds !== undefined;
  const hasPresentedResources = detail.presentedResources !== undefined;
  if ((hasMaterialIds && !Array.isArray(detail.materialIds)) || (hasPresentedResources && !Array.isArray(detail.presentedResources))) {
    throw new PhysicianVisitWriteError("INVALID_DETAILING_MATERIAL_PRESENTATION", 400);
  }
  const materialIds = (detail.materialIds || []).map(text);
  const presentedResources = (detail.presentedResources || []).map(text);
  if (materialIds.some((id: string) => !id) || presentedResources.some((id: string) => !id)
    || unique(materialIds).length !== materialIds.length || unique(presentedResources).length !== presentedResources.length
    || (hasMaterialIds && hasPresentedResources && JSON.stringify(materialIds) !== JSON.stringify(presentedResources))) {
    throw new PhysicianVisitWriteError("INVALID_DETAILING_MATERIAL_PRESENTATION", 400);
  }
  return hasMaterialIds ? materialIds : presentedResources;
}

export function validateCanonicalDetailingMaterials(input: {
  visit: PhysicianVisit;
  physician: any;
  products: any[];
  allowedProductIds: string[];
  resources: any[];
}): void {
  const resources = new Map(input.resources.map(resource => [text(resource.id), resource]));
  const allowedProducts = new Set(input.allowedProductIds);
  const visitDate = text(input.visit.visitDate).slice(0, 10);

  input.visit.detailing.forEach(detail => {
    const productId = text(detail.productId);
    const product = input.products.find(item => text(item.id) === productId);
    for (const resourceId of submittedMaterialIds(detail)) {
      if (!allowedProducts.has(productId)) throw new PhysicianVisitWriteError("DETAILING_MATERIAL_PRODUCT_NOT_AUTHORIZED", 403);
      const resource = resources.get(resourceId);
      validateCanonicalResourceForProduct({ resource, resourceId, product, productId, physicianSpecialtyId: text(input.physician.specialtyId), atDate: visitDate });
    }
  });
}

/** Shared field-use predicate for Fix 2 persistence and Fix 4 reads. */
export function validateCanonicalResourceForProduct(input: { resource: any; resourceId: string; product: any; productId: string; physicianSpecialtyId?: string; atDate: string }): void {
  const { resource, resourceId, product, productId } = input;
  if (!resource || (text(resource.resourceId) && text(resource.resourceId) !== resourceId)) throw new PhysicianVisitWriteError("DETAILING_MATERIAL_NOT_FOUND", 404);
  if (!active(resource)) throw new PhysicianVisitWriteError("DETAILING_MATERIAL_NOT_ACTIVE", 403);
  if (text(resource.uploadStatus) && text(resource.uploadStatus) !== "COMPLETE") throw new PhysicianVisitWriteError("DETAILING_MATERIAL_UPLOAD_INCOMPLETE", 409);
  const published = resource.isApproved === true || text(resource.status) === "Approved"
    || text(resource.approvalStatus) === "PUBLISHED" || text(resource.approvalStatus) === "APPROVED";
  if (!published) throw new PhysicianVisitWriteError("DETAILING_MATERIAL_NOT_PUBLISHED", 403);
  const effectiveDate = text(resource.effectiveDate).slice(0, 10), expiryDate = text(resource.expiryDate).slice(0, 10);
  if (effectiveDate && input.atDate < effectiveDate) throw new PhysicianVisitWriteError("DETAILING_MATERIAL_NOT_YET_EFFECTIVE", 403);
  if (expiryDate && input.atDate > expiryDate) throw new PhysicianVisitWriteError("DETAILING_MATERIAL_EXPIRED", 403);
  if (!product || !text(product.promotionGroupId) || text(resource.promotionGroupId) !== text(product.promotionGroupId)) throw new PhysicianVisitWriteError("DETAILING_MATERIAL_PROMOTION_GROUP_MISMATCH", 403);
  const eligibleProduct = text(resource.resourceScope) === "PROMOTION_GROUP"
    ? text(resource.promotionGroupId) === text(product.promotionGroupId)
    : text(resource.productId) === productId || (Array.isArray(resource.productIds) && resource.productIds.map(text).includes(productId));
  if (!eligibleProduct) throw new PhysicianVisitWriteError("DETAILING_MATERIAL_PRODUCT_MISMATCH", 403);
  const specialtyIds = Array.isArray(resource.specialtyIds) ? resource.specialtyIds.map(text).filter(Boolean) : [];
  if (specialtyIds.length && !specialtyIds.includes(text(input.physicianSpecialtyId))) throw new PhysicianVisitWriteError("DETAILING_MATERIAL_SPECIALTY_MISMATCH", 403);
}

export function authoritativeFirstVisitGpsUpdate(input: { physician: any; visit: PhysicianVisit; actorUid: string; now: string }): Record<string, unknown> | null {
  if (input.physician.gpsVerified === true || input.physician.gpsVerificationStatus === "VERIFIED") return null;
  const latitude = Number(input.visit.latitude), longitude = Number(input.visit.longitude);
  if (input.visit.gpsVerified !== true || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new PhysicianVisitWriteError("INVALID_GPS_COORDINATES", 400);
  }
  return { latitude, longitude, gpsVerified: true, gpsVerificationStatus: "VERIFIED", gpsVerifiedAt: input.now,
    gpsVerifiedByUid: input.actorUid, gpsVerifiedVisitId: input.visit.id, gpsVerificationSource: "LIVE_DEVICE_FIRST_VISIT",
    updatedAt: input.now, updatedBy: input.actorUid };
}

export function canonicalizeVisitDetailing(detailing: PhysicianVisit["detailing"], products: any[]): PhysicianVisit["detailing"] {
  return detailing.map(detail => ({
    ...detail,
    brandName: products.find(product => text(product.id) === text(detail.productId))?.brand || "",
    keyMessageIds: unique(detail.keyMessageIds || []),
    presentedKeyMessages: unique(detail.keyMessageIds || []),
    materialIds: submittedMaterialIds(detail),
    presentedResources: submittedMaterialIds(detail),
  }));
}

export function parsePhysicianVisitWriteRequest(body: unknown): PhysicianVisit | null {
  const value = body && typeof body === "object" && "visit" in body ? (body as any).visit : null;
  if (!value || typeof value !== "object") return null;
  if (!text(value.id) || !text(value.physicianId) || !text(value.repId) || !text(value.visitDate) || !Array.isArray(value.detailing) || !Array.isArray(value.samples)) return null;
  return value as PhysicianVisit;
}

export function validateAuthoritativeDetailing(input: {
  actorUid: string;
  actor: any;
  physician: any;
  visit: PhysicianVisit;
  assignments: any[];
  products: any[];
  keyMessages: any[];
  resources?: any[];
}) {
  const { actorUid, actor, physician, visit } = input;
  if (text(actor?.role) !== MEDICAL_REP || !active(actor) || actor?.loginAllowed === false) throw new PhysicianVisitWriteError("VISIT_ROLE_NOT_AUTHORIZED", 403);
  if (text(visit.repId) !== actorUid) throw new PhysicianVisitWriteError("VISIT_ACTOR_MISMATCH", 403);
  if (!active(physician)) throw new PhysicianVisitWriteError("PHYSICIAN_INACTIVE", 403);
  if (!text(physician?.primaryPromotionGroupId)) throw new PhysicianVisitWriteError("PHYSICIAN_PRIMARY_PROMOTION_GROUP_REQUIRED", 409);
  if (!text(physician?.areaId) || text(visit.areaId) !== text(physician.areaId)) throw new PhysicianVisitWriteError("VISIT_CANONICAL_GEOGRAPHY_INVALID", 409);

  const actorAreas = new Set(unique((actor?.areaIds || []).map(text)));
  if (!text(physician?.areaId) || !actorAreas.has(text(physician.areaId))) throw new PhysicianVisitWriteError("PHYSICIAN_OUTSIDE_AUTHORIZED_AREA", 403);

  const allowedProducts = eligibleProductsForPhysician({
    physician,
    representativeUid: actorUid,
    productAssignments: input.assignments,
    products: input.products,
  });
  const allowedIds = allowedProducts.map(product => text(product.id));
  const selectedIds = visit.detailing.map(item => text(item.productId));
  const completion = validateDetailingCompletion({ selectedProductIds: selectedIds, allowedVisitProductIds: allowedIds, products: allowedProducts, primaryPromotionGroupId: text(physician.primaryPromotionGroupId) || undefined });
  if (!selectedIds.length || completion.validationResult !== "PASS") throw new PhysicianVisitWriteError("DETAILING_PRODUCT_NOT_AUTHORIZED", 403);
  visit.detailing.forEach((detail, index) => {
    if (Number(detail.detailingOrder) !== index + 1) throw new PhysicianVisitWriteError("INVALID_DETAILING_ORDER", 400);
    const selected = unique((detail.keyMessageIds || []).map(text));
    const presented = unique((detail.presentedKeyMessages || []).map(text));
    if (JSON.stringify(selected) !== JSON.stringify(presented) || selected.length !== (detail.keyMessageIds || []).length) throw new PhysicianVisitWriteError("INVALID_KEY_MESSAGE_PRESENTATION", 400);
    const eligible = new Set(input.keyMessages.filter(message => active(message) && message.isApproved === true && text(message.productId) === text(detail.productId) && (
      !(message.targetSpecialtyIds || []).length || (message.targetSpecialtyIds || []).map(text).includes(text(physician.specialtyId))
    )).map(message => text(message.id)));
    if (selected.some(id => !eligible.has(id))) throw new PhysicianVisitWriteError("KEY_MESSAGE_NOT_AUTHORIZED", 403);
    if (!PRESCRIPTION_INTENTS.has(detail.prescriptionIntent as CanonicalPrescriptionIntent)) throw new PhysicianVisitWriteError("INVALID_PRODUCT_PRESCRIPTION_INTENT", 400);
  });
  const allowed = new Set(allowedIds);
  if ((visit.samples || []).some(sample => !allowed.has(text(sample.productId)) || Number(sample.quantity) <= 0)) throw new PhysicianVisitWriteError("SAMPLE_PRODUCT_NOT_AUTHORIZED", 403);
  validateCanonicalDetailingMaterials({ visit, physician, products: input.products, allowedProductIds: allowedIds, resources: input.resources || [] });
  return { allowedProductIds: allowedIds };
}

export function resolveAuthoritativeVisitMarket(input: {
  physician: any;
  actorAreaIds: string[];
  area: any;
  district: any;
  city: any;
  country: any;
  markets: MarketBusinessSettings[];
}): { countryId: string; marketId: string; businessDocumentCode: string } {
  const physicianAreaId = text(input.physician?.areaId);
  const areaId = text(input.area?.id);
  const countryId = text(input.area?.countryId);
  if (!physicianAreaId || physicianAreaId !== areaId || !active(input.area)
    || !countryId || !active(input.country) || text(input.country?.id) !== countryId
    || !active(input.district) || text(input.district?.id) !== text(input.area?.districtId)
    || text(input.district?.countryId) !== countryId
    || !active(input.city) || text(input.city?.id) !== text(input.area?.cityId)
    || text(input.city?.districtId) !== text(input.area?.districtId)
    || text(input.city?.countryId) !== countryId) {
    throw new PhysicianVisitWriteError("VISIT_CANONICAL_GEOGRAPHY_INVALID", 409);
  }
  if (!unique(input.actorAreaIds.map(text)).includes(areaId)) {
    throw new PhysicianVisitWriteError("PHYSICIAN_OUTSIDE_AUTHORIZED_AREA", 403);
  }
  const matches = input.markets.filter((market) => market.active && text(market.countryId) === countryId);
  if (matches.length === 0) throw new PhysicianVisitWriteError("VISIT_MARKET_CONFIGURATION_REQUIRED", 409);
  if (matches.length !== 1) throw new PhysicianVisitWriteError("VISIT_MARKET_CONFIGURATION_AMBIGUOUS", 409);
  const businessDocumentCode = text(matches[0].businessDocumentCode).toUpperCase();
  if (!validateBusinessDocumentCode(businessDocumentCode)) {
    throw new PhysicianVisitWriteError("VISIT_DOCUMENT_CODE_CONFIGURATION_REQUIRED", 409);
  }
  return { countryId, marketId: text(matches[0].marketId), businessDocumentCode };
}

export async function executePhysicianVisitWrite(actorUid: string, visit: PhysicianVisit, db: Firestore): Promise<{ status: "COMPLETED"; displayNumber: string; marketingRequestIds: string[]; replayed?: boolean }> {
  const writeCommandHash = createHash("sha256").update(JSON.stringify(visit)).digest("hex");
  const actorRef = db.collection("users").doc(actorUid);
  const physicianRef = db.collection("physicians").doc(visit.physicianId);
  const visitRef = db.collection("physicianVisits").doc(visit.id);
  const resourceContextId = text((visit as any).resourceContextId);
  if (!resourceContextId) throw new PhysicianVisitWriteError("RESOURCE_VISIT_CONTEXT_REQUIRED", 403);
  const resourceContextRef = db.collection("physicianVisitContexts").doc(resourceContextId);
  const submittedResourceIds = unique(visit.detailing.flatMap(detail => submittedMaterialIds(detail)));
  const resourceRefs = submittedResourceIds.map(id => db.collection("academicResources").doc(id));
  const [assignmentQuery, territoryQuery, productQuery, keyMessageQuery, plannerQuery] = await Promise.all([
    db.collection("userProductAssignments").where("userId", "==", actorUid).get(),
    db.collection("userTerritoryAssignments").where("userId", "==", actorUid).get(),
    db.collection("products").get(),
    db.collection("keyMessages").get(),
    db.collection("medicalPlannerVisits").where("physicianId", "==", visit.physicianId).where("repId", "==", actorUid).where("date", "==", visit.visitDate).get(),
  ]);
  let sampleRequests;
  try { sampleRequests = aggregateSampleRequests(visit.samples || []); }
  catch (error) { throw new PhysicianVisitWriteError(error instanceof SampleDistributionPolicyError ? error.code : "INVALID_SAMPLE_REQUEST", 400); }
  const additionalRequestIntents = Array.isArray(visit.additionalSampleRequests) ? visit.additionalSampleRequests : [];
  for (const intent of additionalRequestIntents) {
    if (!text(intent.intentKey) || !text(intent.sampleSkuId) || !text(intent.productId) || !Number.isInteger(Number(intent.quantityNeeded)) || Number(intent.quantityNeeded) <= 0 || !text(intent.reason) || !isCanonicalDate(text(intent.expectedDeliveryDate))) throw new PhysicianVisitWriteError("INVALID_VISIT_SAMPLE_REQUEST", 400);
  }
  const sampleSkuIds = unique([...sampleRequests.map(item => item.sampleSkuId), ...additionalRequestIntents.map(item => text(item.sampleSkuId))]);
  const skuDocs = sampleSkuIds.length ? await db.getAll(...sampleSkuIds.map(id => db.collection("sampleCatalog").doc(id))) : [];
  const allocationQueries = await Promise.all(sampleSkuIds.map(sampleSkuId => db.collection("sampleAllocations").where("repId", "==", actorUid).where("sampleSkuId", "==", sampleSkuId).get()));
  const allocationDocs = allocationQueries.flatMap(snapshot => snapshot.docs);
  const batchRefs = unique(allocationDocs.map(doc => text(doc.data().batchId))).map(id => db.collection("sampleBatches").doc(id));
  const rollingLockRef = db.collection("physicianSampleRollingUsage").doc(visit.physicianId);
  const rawMarketingRequests = Array.isArray(visit.marketingRequests) ? visit.marketingRequests : [];
  const marketingDrafts: VisitMarketingRequestDraft[] = rawMarketingRequests.map((request) => {
    const parsed = parseVisitMarketingRequestDraft(request);
    if (!parsed) throw new PhysicianVisitWriteError("INVALID_VISIT_MARKETING_REQUEST", 400);
    return parsed;
  });
  const marketingRequestRefs = marketingDrafts.map(() => db.collection("visitMarketingRequests").doc());
  const marketingAuditRefs = marketingDrafts.map(() => db.collection("visitMarketingRequestAudit").doc());

  return db.runTransaction(async (tx: Transaction) => {
    const lockRefs: DocumentReference[] = [
      resourceContextRef,
      ...assignmentQuery.docs.map(doc => doc.ref), ...territoryQuery.docs.map(doc => doc.ref), ...productQuery.docs.map(doc => doc.ref), ...keyMessageQuery.docs.map(doc => doc.ref),
      ...plannerQuery.docs.map(doc => doc.ref), ...resourceRefs, ...skuDocs.map(doc => doc.ref), ...allocationDocs.map(doc => doc.ref), ...batchRefs, rollingLockRef,
    ];
    const [actorSnap, physicianSnap, existingVisit, ...locked] = await Promise.all([
      tx.get(actorRef), tx.get(physicianRef), tx.get(visitRef), ...lockRefs.map(ref => tx.get(ref)),
    ]);
    const lockedByPath = new Map(lockRefs.map((ref, index) => [ref.path, locked[index]]));
    if (!actorSnap.exists) throw new PhysicianVisitWriteError("ACTOR_NOT_FOUND", 403);
    if (!physicianSnap.exists) throw new PhysicianVisitWriteError("PHYSICIAN_NOT_FOUND", 404);
    if (existingVisit.exists) {
      const existing = existingVisit.data() || {};
      if (text(existing.createdBy) === actorUid && text(existing.writeCommandHash) === writeCommandHash) return { status: "COMPLETED", displayNumber: text(existing.displayNumber), marketingRequestIds: Array.isArray(existing.marketingRequestIds) ? existing.marketingRequestIds : [], replayed: true };
      throw new PhysicianVisitWriteError("VISIT_ALREADY_COMPLETED", 409);
    }
    const live = (docs: QueryDocumentSnapshot[]) => docs.map(doc => lockedByPath.get(doc.ref.path)).filter(snap => snap?.exists).map(snap => ({ id: snap!.id, ...snap!.data() } as any));
    const assignments: any[] = live(assignmentQuery.docs);
    const territories: any[] = live(territoryQuery.docs);
    const products: any[] = live(productQuery.docs);
    const messages: any[] = live(keyMessageQuery.docs);
    const resources: any[] = resourceRefs.map(ref => lockedByPath.get(ref.path)).filter(snap => snap?.exists).map(snap => ({ id: snap!.id, ...snap!.data() }));
    const resourceContextSnap = lockedByPath.get(resourceContextRef.path), resourceContext = resourceContextSnap?.data() || {};
    if (!resourceContextSnap?.exists || text(resourceContext.visitId) !== text(visit.id) || text(resourceContext.representativeUid) !== actorUid || text(resourceContext.physicianId) !== text(visit.physicianId) || text(resourceContext.visitDate) !== text(visit.visitDate) || text(resourceContext.status) !== "ACTIVE" || text(resourceContext.expiresAt) <= new Date().toISOString()) throw new PhysicianVisitWriteError("RESOURCE_VISIT_CONTEXT_DENIED", 403);
    const actor = {
      ...actorSnap.data(),
      areaIds: unique(territories
        .filter(active)
        .map((item) => text(item.areaId) || text(item.territoryId))),
    };
    const visitAuthorization = validateAuthoritativeDetailing({ actorUid, actor, physician: physicianSnap.data(), visit, assignments, products, keyMessages: messages, resources });

    let supervisorUid = "";
    if (marketingDrafts.length) {
      supervisorUid = text(actorSnap.data()?.managerId);
      if (!supervisorUid) throw new PhysicianVisitWriteError("CANONICAL_SUPERVISOR_REQUIRED", 409);
      const supervisorSnap = await tx.get(db.collection("users").doc(supervisorUid));
      if (!supervisorSnap.exists || !isCanonicalUserActive(supervisorSnap.data() as any)) throw new PhysicianVisitWriteError("CANONICAL_SUPERVISOR_REQUIRED", 409);
      const supervisorPermissions = await tx.get(db.collection("rolePermissions").doc(text(supervisorSnap.data()?.role)));
      if (!hasVisitMarketingRequestPermission(text(supervisorSnap.data()?.role), "supervisorApprove", supervisorPermissions.exists ? supervisorPermissions.data() : null)
        || !hasVisitMarketingRequestPermission(text(supervisorSnap.data()?.role), "supervisorReject", supervisorPermissions.exists ? supervisorPermissions.data() : null)) {
        throw new PhysicianVisitWriteError("CANONICAL_SUPERVISOR_REQUIRED", 409);
      }
    }

    const physician = physicianSnap.data() || {};
    const areaId = text(physician.areaId);
    if (!areaId) throw new PhysicianVisitWriteError("VISIT_CANONICAL_GEOGRAPHY_INVALID", 409);
    const areaSnap = await tx.get(db.collection("areas").doc(areaId));
    if (!areaSnap.exists) throw new PhysicianVisitWriteError("VISIT_CANONICAL_GEOGRAPHY_INVALID", 409);
    const area = { id: areaSnap.id, ...areaSnap.data() } as any;
    const [countrySnap, districtSnap, citySnap, marketSnap] = await Promise.all([
      tx.get(db.collection("countries").doc(text(area.countryId))),
      tx.get(db.collection("districts").doc(text(area.districtId))),
      tx.get(db.collection("cities").doc(text(area.cityId))),
      tx.get(db.collection("marketSettings").where("countryId", "==", text(area.countryId))),
    ]);
    const market = resolveAuthoritativeVisitMarket({
      physician,
      actorAreaIds: actor.areaIds,
      area,
      country: countrySnap.exists ? { id: countrySnap.id, ...countrySnap.data() } : null,
      district: districtSnap.exists ? { id: districtSnap.id, ...districtSnap.data() } : null,
      city: citySnap.exists ? { id: citySnap.id, ...citySnap.data() } : null,
      markets: marketSnap.docs.map(doc => ({ marketId: doc.id, ...doc.data() } as MarketBusinessSettings)),
    });

    const now = new Date().toISOString();
    const marketSettings = marketSnap.docs.find(doc => doc.id === market.marketId || text(doc.data().marketId) === market.marketId)?.data() as MarketBusinessSettings | undefined;
    const timezone = text(marketSettings?.timezone);
    if (!timezone) throw new PhysicianVisitWriteError("VISIT_MARKET_CONFIGURATION_REQUIRED", 409);
    let distributionDate: string;
    try { distributionDate = marketLocalDate(now, timezone); }
    catch { throw new PhysicianVisitWriteError("VISIT_MARKET_CONFIGURATION_REQUIRED", 409); }
    const historySnap = sampleRequests.length
      ? await tx.get(db.collection("sampleDisbursedLogs").where("physicianId", "==", visit.physicianId))
      : null;
    try {
      assertRollingPhysicianLimit({ records: historySnap?.docs.map(doc => doc.data()) || [], physicianId: visit.physicianId, classification: physician.classification, distributionDate, timezone, proposedQuantity: sampleRequests.reduce((sum, item) => sum + item.quantity, 0) });
    } catch (error) {
      throw new PhysicianVisitWriteError(error instanceof SampleDistributionPolicyError ? error.code : "PHYSICIAN_ROLLING_SAMPLE_LIMIT_FAILED", 409);
    }
    const code = market.businessDocumentCode;
    const year = Number(visit.visitDate.slice(0, 4));
    if (!Number.isInteger(year)) throw new PhysicianVisitWriteError("INVALID_VISIT_DATE", 400);
    const sequenceRef = db.collection("businessDocumentSequences").doc(`${code}_MV_${year}`);
    const sequenceSnap = await tx.get(sequenceRef);
    const next = Number(sequenceSnap.data()?.lastSequence || 0) + 1;
    const displayNumber = `${code}-MV-${year}-${String(next).padStart(6, "0")}`;
    tx.set(sequenceRef, { documentType: "PHYSICIAN_VISIT", countryCode: code, year, lastSequence: next, updatedAt: now, updatedBy: actorUid }, { merge: true });

    const canonicalSamples = [];
    for (const sample of sampleRequests) {
      const sku = live(skuDocs as QueryDocumentSnapshot[]).find(item => item.id === sample.sampleSkuId) as SampleSku | undefined;
      if (!sku || !active(sku) || sku.status !== "ACTIVE") throw new PhysicianVisitWriteError("SAMPLE_SKU_NOT_ACTIVE", 403);
      if (text(sku.productId) !== text(sample.productId)) throw new PhysicianVisitWriteError("SAMPLE_SKU_PRODUCT_MISMATCH", 403);
      const matching = allocationDocs.map(doc => lockedByPath.get(doc.ref.path)).filter(snap => snap?.exists).map(snap => ({ id: snap!.id, ref: snap!.ref, ...snap!.data() } as any)).filter(item => item.productId === sample.productId && item.sampleSkuId === sku.id && active(item) && Number(item.quantityRemaining) > 0);
      if (!matching.length) throw new PhysicianVisitWriteError("SAMPLE_ALLOCATION_NOT_AVAILABLE", 403);
      const batches = batchRefs.map(ref => ({ id: ref.id, ...(lockedByPath.get(ref.path)?.data() || {}) } as any));
      let plan;
      try { plan = planRepresentativeFefo({ allocations: matching as SampleAllocation[], batches: batches as SampleBatch[], repId: actorUid, sku, quantity: Number(sample.quantity), distributionDate }); }
      catch (error) { throw new PhysicianVisitWriteError(error instanceof SampleDistributionPolicyError ? error.code : "SAMPLE_CONSUMPTION_FAILED", 409); }
      for (const consumption of plan) {
        const alloc = matching.find(item => item.id === consumption.allocationId)!;
        tx.update(alloc.ref, { quantityDistributed: Number(alloc.quantityDistributed || 0) + consumption.quantity, quantityRemaining: Number(alloc.quantityRemaining) - consumption.quantity, status: Number(alloc.quantityRemaining) === consumption.quantity ? "DEPLETED" : "ACTIVE", updatedAt: now, updatedBy: actorUid });
      }
      const safeVisit = visit.id.replace(/[^a-zA-Z0-9_-]/g, "_"); const safeSku = sku.id.replace(/[^a-zA-Z0-9_-]/g, "_");
      const distributionId = `DIST-${safeVisit}-${safeSku}`;
      const transactionId = `SM-${safeVisit}-${safeSku}`;
      const lineage = plan.map(item => { const allocation = matching.find(row => row.id === item.allocationId); return { ...item, requestId: allocation?.requestId || null, approvalId: allocation?.approvalId || null }; });
      const requestIds = unique(lineage.map(item => text(item.requestId))), approvalIds = unique(lineage.map(item => text(item.approvalId)));
      tx.set(db.collection("sampleDisbursedLogs").doc(distributionId), { id: distributionId, status: "DISTRIBUTED", sampleSkuId: sku.id, sampleSkuName: sku.name, sampleSkuDescriptor: sku.descriptor || null, productId: sample.productId, productName: products.find(product => product.id === sample.productId)?.name || null, brand: products.find(product => product.id === sample.productId)?.brand || null, repId: actorUid, repName: text(actorSnap.data()?.name), physicianId: visit.physicianId, physicianName: text(physician.name), quantity: Number(sample.quantity), allocationId: plan[0].allocationId, allocationIds: plan.map(p => p.allocationId), allocationConsumptions: lineage, requestId: requestIds.length === 1 ? requestIds[0] : null, requestIds, approvalId: approvalIds.length === 1 ? approvalIds[0] : null, approvalIds, batchId: plan[0].batchId, visitId: visit.id, distributionDate, marketId: market.marketId, timezone, distributedAt: now, createdBy: actorUid });
      tx.set(db.collection("sampleTransactions").doc(transactionId), { id: transactionId, sampleSkuId: sku.id, batchId: plan.length === 1 ? plan[0].batchId : null, allocationConsumptions: lineage, allocationIds: plan.map(p => p.allocationId), requestIds, approvalIds, visitId: visit.id, physicianId: visit.physicianId, repId: actorUid, type: "DISTRIBUTION", quantity: -Number(sample.quantity), sourceId: distributionId, sourceType: "SAMPLE_DISTRIBUTION", actorId: actorUid, createdAt: now });
      canonicalSamples.push({ productId: sample.productId, productName: products.find(product => product.id === sample.productId)?.name || sample.productName, brand: products.find(product => product.id === sample.productId)?.brand || sample.brand, sampleSkuId: sku.id, sampleSkuName: sku.name, sampleSkuDescriptor: sku.descriptor, quantity: Number(sample.quantity), requestId: requestIds.length === 1 ? requestIds[0] : undefined, approvalId: approvalIds.length === 1 ? approvalIds[0] : undefined, allocationIds: plan.map(p => p.allocationId), allocationConsumptions: lineage, distributionId, transactionId });
    }
    const canonicalAdditionalRequests = additionalRequestIntents.map(intent => {
      const sku = live(skuDocs as QueryDocumentSnapshot[]).find(item => item.id === text(intent.sampleSkuId)) as SampleSku | undefined;
      const product = products.find(item => item.id === text(intent.productId));
      if (!sku || !active(sku) || sku.status !== "ACTIVE" || sku.productId !== text(intent.productId) || !product || !visitAuthorization.allowedProductIds.includes(sku.productId)) throw new PhysicianVisitWriteError("SAMPLE_REQUEST_SKU_NOT_AUTHORIZED", 403);
      const requestId = visitSampleRequestId(visit.id, sku.id, text(intent.intentKey));
      const request = canonicalSampleRequest({ id: requestId, idempotencyKey: text(intent.intentKey), actor: { id: actorUid, name: text(actorSnap.data()?.name), role: actorSnap.data()?.role } as any, physician: { id: visit.physicianId, name: text(physician.name) }, sku, product, quantity: Number(intent.quantityNeeded), reason: text(intent.reason), expectedDeliveryDate: text(intent.expectedDeliveryDate), urgent: intent.urgent === true, source: "PHYSICIAN_VISIT", visitId: visit.id, visitDate: visit.visitDate, now });
      tx.create(db.collection("sampleRequests").doc(requestId), removeUndefinedRecursively(request));
      tx.create(db.collection("auditLogs").doc(`AUD-${requestId}`), { id: `AUD-${requestId}`, userId: actorUid, userName: text(actorSnap.data()?.name), userRole: actorSnap.data()?.role, action: "Visit Sample Request Created", entityType: "SampleRequest", entityId: requestId, details: `Created ${sku.name} request during visit ${displayNumber}`, timestamp: now, createdAt: now, createdBy: actorUid });
      return { ...intent, requestId, sampleSkuId: sku.id, productId: sku.productId, sampleVariantName: sku.name, productName: product.name, status: "PENDING_APPROVAL" };
    });
    tx.set(rollingLockRef, { physicianId: visit.physicianId, lastVisitId: visit.id, lastDistributionDate: distributionDate, updatedAt: now }, { merge: true });
    const canonicalDetailing = canonicalizeVisitDetailing(visit.detailing, products);
    const marketingRequestIds = marketingRequestRefs.map(ref => ref.id);
    const canonicalVisit = { ...visit, samples: canonicalSamples, samplesGiven: canonicalSamples, additionalSampleRequests: canonicalAdditionalRequests, sampleRequests: canonicalAdditionalRequests, repId: actorUid, representativeId: actorUid, areaId, countryId: market.countryId, marketId: market.marketId, businessDocumentCode: code, displayNumber, detailing: canonicalDetailing, prescriptionIntent: undefined, marketingRequest: undefined, marketingRequests: undefined, marketingRequestIds, writeCommandHash, createdAt: now, createdBy: actorUid, updatedAt: now, updatedBy: actorUid };
    tx.set(visitRef, removeUndefinedRecursively(canonicalVisit));
    tx.update(resourceContextRef, { status: "COMPLETED", completedVisitId: visit.id, completedAt: now, updatedAt: now, updatedBy: actorUid });
    marketingDrafts.forEach((draft, index) => {
      const requestRef = marketingRequestRefs[index];
      const auditRef = marketingAuditRefs[index];
      const request: CanonicalVisitMarketingRequest = {
        id: requestRef.id, resourceType: VISIT_MARKETING_REQUEST_RESOURCE, creatorUid: actorUid, representativeUid: actorUid,
        supervisorUid, visitId: visit.id, physicianId: visit.physicianId, areaId, countryId: market.countryId, marketId: market.marketId,
        status: "PENDING_SUPERVISOR", schemaVersion: VISIT_MARKETING_REQUEST_SCHEMA_VERSION, createdAt: now, updatedAt: now, ...draft,
      };
      tx.create(requestRef, request);
      tx.create(auditRef, { id: auditRef.id, requestId: request.id, resourceType: VISIT_MARKETING_REQUEST_RESOURCE, actorUid, action: "CREATED", fromStatus: null, toStatus: "PENDING_SUPERVISOR", occurredAt: now });
    });
    const gpsMasterUpdate = authoritativeFirstVisitGpsUpdate({ physician, visit, actorUid, now });
    tx.update(physicianRef, { lastVisitDate: visit.visitDate, lastVisitStatus: "Completed", ...(gpsMasterUpdate || {}), updatedAt: now, updatedBy: actorUid });
    if (gpsMasterUpdate) tx.create(db.collection("auditLogs").doc(`AUD-GPS-${visit.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`), { id: `AUD-GPS-${visit.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`, userId: actorUid, userRole: MEDICAL_REP, action: "Physician GPS Verified", entityType: "Physician", entityId: visit.physicianId, visitId: visit.id, timestamp: now, createdAt: now, createdBy: actorUid });
    plannerQuery.docs.forEach(doc => tx.update(doc.ref, { completedVisitId: visit.id, visitStatus: "Completed" }));
    tx.set(db.collection("auditLogs").doc(`AUD-PV-${visit.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`), { id: `AUD-PV-${visit.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`, userId: actorUid, userName: text(actorSnap.data()?.name) || "Representative", userRole: MEDICAL_REP, action: "Physician Visit Completed", entityType: "PhysicianVisit", entityId: visit.id, details: `Completed physician visit ${displayNumber}.`, timestamp: now, createdAt: now, createdBy: actorUid });
    return { status: "COMPLETED" as const, displayNumber, marketingRequestIds };
  });
}
