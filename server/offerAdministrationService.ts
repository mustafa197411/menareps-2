import { decodeCanonicalUserDocument } from "./organizationalHierarchyRepository";
import { randomUUID } from "node:crypto";
import { FieldPath, type Firestore } from "firebase-admin/firestore";
import { getFirebaseAdminServices } from "./firebaseAdmin";
import { createFirestoreOperationalScopeRepository, resolveOperationalScopeForActor, readActorMarketContext } from "./operationalScopeRepository";
import type { EffectiveOperationalScope } from "./operationalScopeService";
import type { ActorMarketContext } from "../src/lib/operationalScopeClient";

export interface OfferScopeDependencies {
  resolveScope(uid: string): Promise<EffectiveOperationalScope>;
  readMarket(countryId: string): Promise<ActorMarketContext>;
}
export const defaultOfferScopeDependencies: OfferScopeDependencies = {
  resolveScope: uid => resolveOperationalScopeForActor(uid, {}, createFirestoreOperationalScopeRepository()),
  readMarket: countryId => readActorMarketContext({ countryId }),
};

export async function resolveOfferCreatorProductScope(uid: string, dependencies = defaultOfferScopeDependencies): Promise<EffectiveOperationalScope> {
  const scope = await dependencies.resolveScope(uid);
  if (!scope || !scope.authorized || scope.queryPlan.denyAll || scope.actorUid !== uid || !scope.productIds.length) throw new OfferAdministrationError("OFFER_SCOPE_DENIED", 403);
  return scope;
}

export function productWithinOfferScope(product: Record<string, unknown>, id: string, scope: EffectiveOperationalScope): boolean {
  return scope.productIds.includes(id) && (!product.promotionGroupId || scope.productGroupIds.includes(String(product.promotionGroupId)));
}

/** Operation-local restriction only. Never persists or rewrites the Offer. */
export function restrictOfferProducts(offer: CanonicalOfferDefinition, creatorScope: EffectiveOperationalScope, executorIds: readonly string[]): CanonicalOfferDefinition | null {
  const creator = new Set(creatorScope.productIds), executor = new Set(executorIds);
  if (offer.productScope.mode === "SELECTED_PRODUCTS" && offer.productScope.productIds.some(id => !creator.has(id))) return null;
  const ids = (offer.productScope.mode === "ALL_PRODUCTS" ? creatorScope.productIds : offer.productScope.productIds).filter(id => executor.has(id));
  if (!ids.length) return null;
  if ("reward" in offer.benefit && offer.benefit.reward.mode === "SELECTED_PRODUCT" && (!creator.has(offer.benefit.reward.rewardProductId) || !executor.has(offer.benefit.reward.rewardProductId))) return null;
  return { ...offer, productScope: { mode: "SELECTED_PRODUCTS", productIds: [...new Set(ids)].sort() } };
}
import { normalizeRole, type Permissions } from "../src/types";
import {
  CANONICAL_OFFER_SCHEMA_VERSION,
  type CanonicalOfferDefinition,
  type OfferCapability,
  type OfferLifecycleStatus,
} from "../src/features/offers/types";
import { evaluateLifecycleTransition, evaluateApprovalSeparation } from "../src/features/offers/offerPolicy";
import { adaptLegacyOfferForReadOnlyPresentation, validateCanonicalOfferDefinition } from "../src/features/offers/offerValidation";
import { hasOfferCapability, resolveOfferCapabilities } from "./offerAuthorization";
import { assertReportingChainIntegrity, isReportingAncestor, isEligibleSalesRepresentativeCandidate, listReportingDescendantsPage, type ReportingDescendantRepository } from "./organizationalHierarchyService";
import { COMMERCIAL_REGISTRY_QUERY_LIMIT, type CommercialMarketRegistryRepository } from "./commercialMarketRegistryRepository";
import { parseOfferListRequest, type OfferListControls } from "./offerAdministrationRequestContract";

export const OFFER_COLLECTION = "offers" as const;

export type OfferAdministrationErrorCode =
  | "OFFER_AUTHENTICATION_REQUIRED" | "OFFER_ACTOR_NOT_FOUND" | "OFFER_ACTOR_INACTIVE"
  | "OFFER_PERMISSION_DENIED" | "OFFER_NOT_FOUND" | "OFFER_LEGACY_READ_ONLY"
  | "OFFER_UNSUPPORTED_SCHEMA" | "OFFER_INVALID_DEFINITION" | "OFFER_INVALID_TRANSITION"
  | "OFFER_CREATOR_APPROVER_CONFLICT" | "OFFER_STALE_REVISION" | "OFFER_PRODUCT_NOT_FOUND"
  | "OFFER_PRODUCT_INACTIVE" | "OFFER_PRODUCT_NOT_COMMERCIAL" | "OFFER_SCOPE_DENIED"
  | "OFFER_CANCELLATION_REASON_REQUIRED" | "OFFER_NOT_CURRENTLY_VALID"
  | "OFFER_INVALID_REQUEST" | "OFFER_MAKER_HISTORY_REQUIRED" | "OFFER_MAKER_APPROVER_CONFLICT"
  | "OFFER_AUDIENCE_INVALID" | "OFFER_APPROVAL_ANCESTRY_REQUIRED" | "OFFER_PRODUCT_DISPLAY_INVALID"
  | "OFFER_READ_FAILED" | "OFFER_WRITE_FAILED";

export class OfferAdministrationError extends Error {
  constructor(public readonly code: OfferAdministrationErrorCode, public readonly status: number, message: string = code) {
    super(message);
    this.name = "OfferAdministrationError";
  }
}

export interface OfferAdministrationScope {
  global: boolean;
  companyIds: string[];
  countryIds: string[];
  marketIds: string[];
  areaIds: string[];
  productIds: string[];
}

export interface OfferAdministrationActor {
  uid: string;
  role: string;
  permissions: Permissions | null;
}

export interface OfferAdministrationRepository {
  list(controls: OfferListControls): Promise<Array<{ id: string; data: Record<string, unknown> }>>;
  get(id: string): Promise<Record<string, unknown> | null>;
  create(id: string, data: CanonicalOfferDefinition): Promise<void>;
  transact(id: string, expectedRevision: number, mutate: (current: Record<string, unknown>) => CanonicalOfferDefinition | Promise<CanonicalOfferDefinition>): Promise<CanonicalOfferDefinition>;
  getProduct(id: string): Promise<Record<string, unknown> | null>;
}

export type OfferDraftDefinitionInput = Pick<CanonicalOfferDefinition,
  "code" | "name" | "type" | "productScope" | "benefit" | "eligibility" | "stackingPolicy" | "usageLimits"
> & { nameAr?: string; description?: string; previousVersionId?: string };

export type OfferMutationCommand =
  | { action: "UPDATE_DRAFT"; offerId: string; expectedRevision: number; definition: OfferDraftDefinitionInput }
  | { action: "SUBMIT" | "RETURN_TO_DRAFT" | "APPROVE" | "ACTIVATE" | "PAUSE" | "REACTIVATE"; offerId: string; expectedRevision: number }
  | { action: "CANCEL"; offerId: string; expectedRevision: number; reason: string };

const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const strings = (value: unknown): string[] => Array.isArray(value) ? Array.from(new Set(value.map(text).filter(Boolean))) : [];
const activeRecord = (data: Record<string, unknown>): boolean => data.active !== false && data.isActive !== false && data.status !== "Inactive" && data.status !== "Archived" && data.marketingStatus !== "Inactive";

function assertCapability(actor: OfferAdministrationActor, capability: OfferCapability): void {
  if (!hasOfferCapability(actor.role, actor.permissions, capability)) throw new OfferAdministrationError("OFFER_PERMISSION_DENIED", 403);
}

function assertRevision(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new OfferAdministrationError("OFFER_STALE_REVISION", 409);
}

function hasCompleteMakerHistory(data: Record<string, unknown>): boolean {
  return Array.isArray(data.makerIds) && data.makerIds.length > 0 && Array.isArray(data.makerAudit) && data.makerAudit.length > 0;
}

function canonicalExisting(data: Record<string, unknown>): CanonicalOfferDefinition {
  if (data.schemaVersion !== CANONICAL_OFFER_SCHEMA_VERSION) {
    throw new OfferAdministrationError(data.schemaVersion === undefined ? "OFFER_LEGACY_READ_ONLY" : "OFFER_UNSUPPORTED_SCHEMA", 409);
  }
  if (!hasCompleteMakerHistory(data)) {
    throw new OfferAdministrationError("OFFER_MAKER_HISTORY_REQUIRED", 409, "Offer has no complete immutable maker history and is read-only for mutations.");
  }
  const result = validateCanonicalOfferDefinition(data);
  if (!result.valid) throw new OfferAdministrationError("OFFER_INVALID_DEFINITION", 422);
  return result.value;
}

const exactUid = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value === value.trim() && !value.includes("/");

async function visibleTo(actor: OfferAdministrationActor, data: Record<string, unknown>, hierarchy: ReportingDescendantRepository): Promise<boolean> {
  if (!exactUid(data.createdBy)) return false;
  const creator = await hierarchy.getUser(data.createdBy);
  if (!creator || creator.id !== data.createdBy) return false;
  return actor.uid === data.createdBy || await isReportingAncestor(actor.uid, data.createdBy, hierarchy);
}

async function validateReferences(definition: CanonicalOfferDefinition, repository: OfferAdministrationRepository, hierarchy: ReportingDescendantRepository, dependencies = defaultOfferScopeDependencies): Promise<void> {
  await assertReportingChainIntegrity(definition.createdBy, hierarchy);
  const scope = await resolveOfferCreatorProductScope(definition.createdBy, dependencies);
  const ids = [...definition.productScope.productIds];
  if ("reward" in definition.benefit && definition.benefit.reward.mode === "SELECTED_PRODUCT") ids.push(definition.benefit.reward.rewardProductId);
  for (const id of new Set(ids)) {
    const product = await repository.getProduct(id);
    if (!product || product.productId !== id) throw new OfferAdministrationError("OFFER_PRODUCT_NOT_FOUND", 422);
    if (!activeRecord(product)) throw new OfferAdministrationError("OFFER_PRODUCT_INACTIVE", 422);
    if (product.isDeleted === true || !productWithinOfferScope(product, id, scope)) throw new OfferAdministrationError("OFFER_SCOPE_DENIED", 403);
    if (typeof product.price !== "number" || !Number.isFinite(product.price) || product.price < 0) throw new OfferAdministrationError("OFFER_PRODUCT_DISPLAY_INVALID", 422);
  }
  if (definition.eligibility.audienceType === "SELECTED_SALES_REPRESENTATIVES") {
    for (const uid of definition.eligibility.audienceUserIds) {
      const user = await hierarchy.getUser(uid);
      if (!isEligibleSalesRepresentativeCandidate(user, uid) || !await isReportingAncestor(definition.createdBy, uid, hierarchy)) {
        throw new OfferAdministrationError("OFFER_AUDIENCE_INVALID", 422);
      }
    }
  }
}

function buildDefinition(id: string, input: OfferDraftDefinitionInput, actorUid: string, now: string, current?: CanonicalOfferDefinition): CanonicalOfferDefinition {
  const revision = current ? current.revision + 1 : 1;
  const makerIds = Array.from(new Set([...(current?.makerIds || []), actorUid]));
  const makerAudit = [...(current?.makerAudit || []), { actorId: actorUid, action: current ? "EDIT" as const : "CREATE" as const, occurredAt: now, revision }];
  const value = {
    id,
    schemaVersion: CANONICAL_OFFER_SCHEMA_VERSION,
    offerVersion: current?.offerVersion ?? 1,
    code: input.code,
    name: input.name,
    ...(input.nameAr ? { nameAr: input.nameAr } : {}),
    ...(input.description ? { description: input.description } : {}),
    type: input.type,
    lifecycleStatus: "DRAFT",
    productScope: input.productScope,
    benefit: input.benefit,
    eligibility: input.eligibility,
    stackingPolicy: input.stackingPolicy,
    ...(input.usageLimits ? { usageLimits: input.usageLimits } : {}),
    createdAt: current?.createdAt ?? now,
    createdBy: current?.createdBy ?? actorUid,
    updatedAt: now,
    updatedBy: actorUid,
    makerIds,
    makerAudit,
    ...(current?.previousVersionId || input.previousVersionId ? { previousVersionId: current?.previousVersionId || input.previousVersionId } : {}),
    revision,
  } as CanonicalOfferDefinition;
  const result = validateCanonicalOfferDefinition(value);
  if (!result.valid) throw new OfferAdministrationError("OFFER_INVALID_DEFINITION", 422, result.errors.map(error => `${error.path}:${error.code}`).join(","));
  return result.value;
}

export async function createOfferDraft(
  actor: OfferAdministrationActor,
  input: OfferDraftDefinitionInput,
  repository: OfferAdministrationRepository,
  hierarchy: ReportingDescendantRepository,
  options: { id?: string; now?: string; scopeDependencies?: OfferScopeDependencies } = {},
): Promise<CanonicalOfferDefinition> {
  assertCapability(actor, "offers.create");
  const id = options.id || `OFR-${randomUUID()}`;
  const now = options.now || new Date().toISOString();
  const offer = buildDefinition(id, input, actor.uid, now);
  await validateReferences(offer, repository, hierarchy, options.scopeDependencies);
  await repository.create(id, offer);
  return offer;
}

function lifecycle(current: CanonicalOfferDefinition, to: OfferLifecycleStatus): void {
  if (!evaluateLifecycleTransition(current.lifecycleStatus, to).valid) throw new OfferAdministrationError("OFFER_INVALID_TRANSITION", 409);
}


/** Shared date-aware transition for explicit activation and one-action approval. */
function activateApprovedOffer(current: CanonicalOfferDefinition, next: CanonicalOfferDefinition, actorUid: string, now: string): CanonicalOfferDefinition {
  const instant = Date.parse(now);
  const start = Date.parse(current.eligibility.startAt), end = Date.parse(current.eligibility.endAt);
  if (instant > end) throw new OfferAdministrationError("OFFER_NOT_CURRENTLY_VALID", 409);
  const target = instant < start ? "SCHEDULED" : "ACTIVE";
  lifecycle(current, target);
  return target === "SCHEDULED"
    ? { ...next, lifecycleStatus: target, scheduledAt: now, scheduledBy: actorUid }
    : { ...next, lifecycleStatus: target, activatedAt: now, activatedBy: actorUid };
}

export async function mutateOffer(
  actor: OfferAdministrationActor,
  command: OfferMutationCommand,
  repository: OfferAdministrationRepository,
  hierarchy: ReportingDescendantRepository,
  options: { now?: string; scopeDependencies?: OfferScopeDependencies } = {},
): Promise<CanonicalOfferDefinition> {
  assertRevision(command.expectedRevision);
  const capabilities: Record<OfferMutationCommand["action"], OfferCapability> = {
    UPDATE_DRAFT: "offers.editDraft", SUBMIT: "offers.submit", RETURN_TO_DRAFT: "offers.approve", APPROVE: "offers.approve",
    ACTIVATE: "offers.activate", PAUSE: "offers.pause", REACTIVATE: "offers.activate", CANCEL: "offers.cancel",
  };
  assertCapability(actor, capabilities[command.action]);
  assertCapability(actor, "offers.view");
  const now = options.now || new Date().toISOString();
  return repository.transact(command.offerId, command.expectedRevision, async currentData => {
    const current = canonicalExisting(currentData);
    // Approval proves stricter ancestry below, after preserving maker-checker errors.
    if (command.action !== "APPROVE" && !await visibleTo(actor, currentData, hierarchy)) throw new OfferAdministrationError("OFFER_SCOPE_DENIED", 403);

    if (command.action === "UPDATE_DRAFT") {
      if (current.lifecycleStatus !== "DRAFT") throw new OfferAdministrationError("OFFER_INVALID_TRANSITION", 409);
      const updated = buildDefinition(current.id, command.definition, actor.uid, now, current);
      await validateReferences(updated, repository, hierarchy, options.scopeDependencies);
      return updated;
    }
    if (["SUBMIT", "APPROVE", "ACTIVATE", "REACTIVATE"].includes(command.action)) {
      await validateReferences(current, repository, hierarchy, options.scopeDependencies);
    }
    let next: CanonicalOfferDefinition = { ...current, updatedAt: now, updatedBy: actor.uid, revision: current.revision + 1 };
    if (command.action === "SUBMIT") {
      lifecycle(current, "PENDING_APPROVAL");
      next = {
        ...next,
        lifecycleStatus: "PENDING_APPROVAL",
        submittedAt: now,
        submittedBy: actor.uid,
        makerIds: Array.from(new Set([...(current.makerIds || []), actor.uid])),
        makerAudit: [...(current.makerAudit || []), { actorId: actor.uid, action: "SUBMIT", occurredAt: now, revision: next.revision }],
      };
    } else if (command.action === "RETURN_TO_DRAFT") {
      lifecycle(current, "DRAFT");
      const { approvedAt: _a, approvedBy: _b, scheduledAt: _s, scheduledBy: _sb, activatedAt: _c, activatedBy: _d, ...rest } = next;
      next = { ...rest, lifecycleStatus: "DRAFT" } as CanonicalOfferDefinition;
    } else if (command.action === "APPROVE") {
      if (current.lifecycleStatus !== "PENDING_APPROVAL") throw new OfferAdministrationError("OFFER_INVALID_TRANSITION", 409);
      if (Boolean(current.approvedAt) !== Boolean(current.approvedBy)) throw new OfferAdministrationError("OFFER_INVALID_TRANSITION", 409, "Incomplete approval metadata.");
      if (!evaluateApprovalSeparation(current.createdBy, actor.uid).valid) throw new OfferAdministrationError("OFFER_MAKER_APPROVER_CONFLICT", 409);
      if (!await isReportingAncestor(actor.uid, current.createdBy, hierarchy)) throw new OfferAdministrationError("OFFER_APPROVAL_ANCESTRY_REQUIRED", 403);
      next = activateApprovedOffer(current, { ...next, approvedAt: current.approvedAt || now, approvedBy: current.approvedBy || actor.uid }, actor.uid, now);
    } else if (command.action === "ACTIVATE") {
      if (!current.approvedAt || !current.approvedBy) throw new OfferAdministrationError("OFFER_INVALID_TRANSITION", 409, "Approval is required before activation.");
      if (!evaluateApprovalSeparation(current.createdBy, actor.uid).valid) throw new OfferAdministrationError("OFFER_MAKER_APPROVER_CONFLICT", 409);
      next = activateApprovedOffer(current, next, actor.uid, now);
    } else if (command.action === "PAUSE") {
      lifecycle(current, "PAUSED");
      next = { ...next, lifecycleStatus: "PAUSED", pausedAt: now, pausedBy: actor.uid };
    } else if (command.action === "REACTIVATE") {
      lifecycle(current, "ACTIVE");
      if (!current.approvedAt || !current.approvedBy) throw new OfferAdministrationError("OFFER_INVALID_TRANSITION", 409);
      if (!evaluateApprovalSeparation(current.createdBy, actor.uid).valid) throw new OfferAdministrationError("OFFER_MAKER_APPROVER_CONFLICT", 409);
      if (Date.parse(now) < Date.parse(current.eligibility.startAt) || Date.parse(now) > Date.parse(current.eligibility.endAt)) throw new OfferAdministrationError("OFFER_NOT_CURRENTLY_VALID", 409);

      next = { ...next, lifecycleStatus: "ACTIVE", activatedAt: now, activatedBy: actor.uid };
    } else {
      const reason = "reason" in command ? command.reason : "";
      if (!text(reason)) throw new OfferAdministrationError("OFFER_CANCELLATION_REASON_REQUIRED", 422);
      lifecycle(current, "CANCELLED");
      next = { ...next, lifecycleStatus: "CANCELLED", cancelledAt: now, cancelledBy: actor.uid, cancellationReason: text(reason) };
    }
    const result = validateCanonicalOfferDefinition(next);
    if (!result.valid) throw new OfferAdministrationError("OFFER_INVALID_DEFINITION", 422);
    return result.value;
  });
}

export type OfferReadRecord =
  | { kind: "CANONICAL"; offer: CanonicalOfferDefinition }
  | { kind: "LEGACY"; offer: ReturnType<typeof adaptLegacyOfferForReadOnlyPresentation> extends { valid: true; value: infer T } ? T : never };

function readRecord(id: string, data: Record<string, unknown>): OfferReadRecord {
  const withId = { ...data, id };
  if (data.schemaVersion === CANONICAL_OFFER_SCHEMA_VERSION && !hasCompleteMakerHistory(data)) {
    const legacy = adaptLegacyOfferForReadOnlyPresentation(withId);
    return { kind: "LEGACY", offer: legacy.valid ? legacy.value : { id, name: "Legacy Offer", legacyTypeLabel: text(data.type) || "Unknown Legacy Offer Type", status: "READ_ONLY_LEGACY", operationallyApplicable: false, canEdit: false, canDelete: false, canActivate: false } } as OfferReadRecord;
  }
  const validation = validateCanonicalOfferDefinition(withId);
  if (validation.valid) return { kind: "CANONICAL", offer: validation.value };
  const legacy = adaptLegacyOfferForReadOnlyPresentation(withId);
  return { kind: "LEGACY", offer: legacy.valid ? legacy.value : { id, name: "Legacy Offer", legacyTypeLabel: text(data.type) || "Unknown Legacy Offer Type", status: "READ_ONLY_LEGACY", operationallyApplicable: false, canEdit: false, canDelete: false, canActivate: false } } as OfferReadRecord;
}

export async function listOffers(actor: OfferAdministrationActor, repository: OfferAdministrationRepository, hierarchy: ReportingDescendantRepository, request: unknown = {}): Promise<{ offers: OfferReadRecord[]; continuation?: string }> {
  assertCapability(actor, "offers.view");
  const controls = parseOfferListRequest(request);
  if (!controls) throw new OfferAdministrationError("OFFER_INVALID_REQUEST", 400);
  const documents = await repository.list(controls);
  const offers: OfferReadRecord[] = [];
  for (const document of documents) {
    if (await visibleTo(actor, document.data, hierarchy)) offers.push(readRecord(document.id, document.data));
  }
  const last = documents[documents.length - 1];
  if (documents.length === controls.pageSize && last) {
    const tuple = { createdAt: last.data.createdAt, documentId: last.id };
    const continuation = Buffer.from(JSON.stringify(tuple), "utf8").toString("base64url");
    if (!parseOfferListRequest({ continuation })) throw new OfferAdministrationError("OFFER_INVALID_DEFINITION", 422);
    return { offers, continuation };
  }
  return { offers };
}

export async function readOffer(actor: OfferAdministrationActor, id: string, repository: OfferAdministrationRepository, hierarchy: ReportingDescendantRepository): Promise<OfferReadRecord> {
  assertCapability(actor, "offers.view");
  const data = await repository.get(id);
  if (!data) throw new OfferAdministrationError("OFFER_NOT_FOUND", 404);
  if (!await visibleTo(actor, data, hierarchy)) throw new OfferAdministrationError("OFFER_SCOPE_DENIED", 403);
  return readRecord(id, data);
}

export async function readOfferRepresentativeOptions(actor: OfferAdministrationActor, request: { offerId?: string; pageSize?: number; continuationToken?: string }, repository: OfferAdministrationRepository, hierarchy: ReportingDescendantRepository) {
  assertCapability(actor, request.offerId ? "offers.editDraft" : "offers.create");
  let rootUid = actor.uid;
  if (request.offerId) {
    const record = await readOffer(actor, request.offerId, repository, hierarchy);
    if (record.kind !== "CANONICAL" || record.offer.lifecycleStatus !== "DRAFT") throw new OfferAdministrationError("OFFER_INVALID_TRANSITION", 409);
    rootUid = record.offer.createdBy;
  }
  const result = await listReportingDescendantsPage(actor.uid, { rootUid, pageSize: request.pageSize, continuationToken: request.continuationToken }, hierarchy);
  return { representatives: result.representatives.map(user => ({ id: user.id, name: typeof user.name === "string" ? user.name : user.id })), ...(result.continuationToken ? { continuationToken: result.continuationToken } : {}) };
}

export async function readOfferProductOptions(actor: OfferAdministrationActor, repository: Pick<CommercialMarketRegistryRepository, "readProducts">, cursor?: string, options: { offerId?: string; repository?: OfferAdministrationRepository; hierarchy?: ReportingDescendantRepository; dependencies?: OfferScopeDependencies } = {}) {
  assertCapability(actor, "offers.view");
  let root = actor.uid;
  if (options.offerId) {
    assertCapability(actor, "offers.editDraft");
    if (!options.repository || !options.hierarchy) throw new OfferAdministrationError("OFFER_SCOPE_DENIED", 403);
    const record = await readOffer(actor, options.offerId, options.repository, options.hierarchy);
    if (record.kind !== "CANONICAL" || record.offer.lifecycleStatus !== "DRAFT") throw new OfferAdministrationError("OFFER_INVALID_TRANSITION", 409);
    root = record.offer.createdBy;
  } else assertCapability(actor, "offers.create");
  const dependencies = options.dependencies || defaultOfferScopeDependencies;
  const scope = await resolveOfferCreatorProductScope(root, dependencies);
  const displayScope = root === actor.uid ? scope : await dependencies.resolveScope(actor.uid);
  const countryId = displayScope.countryIds?.length === 1 ? displayScope.countryIds[0] : undefined;
  const marketContext: ActorMarketContext = displayScope.authorized && !displayScope.queryPlan.denyAll
    && displayScope.actorUid === actor.uid && exactUid(countryId)
    ? await dependencies.readMarket(countryId)
    : { status: "UNRESOLVED" };
  const page = await repository.readProducts({ limit: COMMERCIAL_REGISTRY_QUERY_LIMIT, ...(cursor ? { cursor } : {}) });
  const products: Array<{ id: string; name: string; price: number }> = [];
  for (const raw of page.records) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new OfferAdministrationError("OFFER_PRODUCT_DISPLAY_INVALID", 422);
    const product = raw as Record<string, unknown>;
    if (!exactUid(product.productId)) throw new OfferAdministrationError("OFFER_PRODUCT_DISPLAY_INVALID", 422);
    if (!productWithinOfferScope(product, product.productId, scope) || !activeRecord(product) || product.isDeleted === true) continue;
    if (typeof product.name !== "string" || !product.name.trim() || typeof product.price !== "number" || !Number.isFinite(product.price) || product.price < 0) throw new OfferAdministrationError("OFFER_PRODUCT_DISPLAY_INVALID", 422);
    products.push({ id: product.productId, name: product.name, price: product.price });
  }
  return { products, marketContext, ...(page.nextCursor ? { continuation: page.nextCursor } : {}) };
}

export function createFirestoreOfferRepository(db: Firestore = getFirebaseAdminServices().db): OfferAdministrationRepository {
  return {
    async list(controls) {
      if (!Number.isInteger(controls.pageSize) || controls.pageSize < 1 || controls.pageSize > 50) throw new OfferAdministrationError("OFFER_INVALID_REQUEST", 400);
      let query = db.collection(OFFER_COLLECTION).orderBy("createdAt", "desc").orderBy(FieldPath.documentId(), "desc");
      if (controls.cursor) query = query.startAfter(controls.cursor.createdAt, controls.cursor.documentId);
      const snapshot = await query.limit(controls.pageSize).get();
      return snapshot.docs.map(doc => ({ id: doc.id, data: doc.data() }));
    },
    async get(id) { const snapshot = await db.collection(OFFER_COLLECTION).doc(id).get(); return snapshot.exists ? snapshot.data() || null : null; },
    async create(id, data) { await db.collection(OFFER_COLLECTION).doc(id).create(data); },
    async transact(id, expectedRevision, mutate) {
      return db.runTransaction(async transaction => {
        const reference = db.collection(OFFER_COLLECTION).doc(id);
        const snapshot = await transaction.get(reference);
        if (!snapshot.exists) throw new OfferAdministrationError("OFFER_NOT_FOUND", 404);
        const current = snapshot.data() || {};
        if (current.schemaVersion !== CANONICAL_OFFER_SCHEMA_VERSION) return await mutate(current);
        if (current.revision !== expectedRevision) throw new OfferAdministrationError("OFFER_STALE_REVISION", 409);
        const next = await mutate(current);
        transaction.set(reference, next);
        return next;
      });
    },
    async getProduct(id) {
      const snapshot = await db.collection("products").doc(id).get();
      if (!snapshot.exists) return null;
      const data = snapshot.data()!;
      if ((data.id !== undefined && data.id !== id) || (data.productId !== undefined && data.productId !== id)) throw new OfferAdministrationError("OFFER_PRODUCT_NOT_FOUND", 422);
      return { ...data, productId: id };
    },
  };
}

export async function resolveOfferAdministrationActor(uid: string, user: Record<string, unknown>, db: Firestore = getFirebaseAdminServices().db): Promise<OfferAdministrationActor> {
  decodeCanonicalUserDocument(uid, user);
  const role = validateOfferActorProfile(uid, user);
  const permissionSnapshot = await db.collection("rolePermissions").doc(role).get();
  const permissions = permissionSnapshot.exists ? permissionSnapshot.data() as Permissions : null;
  return { uid, role, permissions };
}

/** Product configuration retains the pre-existing commercial scope orchestration. */
export async function resolveProductConfigurationActor(uid: string, user: Record<string, unknown>, db: Firestore = getFirebaseAdminServices().db) {
  const actor = await resolveOfferAdministrationActor(uid, user, db);
  const operational = await resolveOperationalScopeForActor(uid, {}, createFirestoreOperationalScopeRepository());
  if (!operational.authorized) throw new OfferAdministrationError("OFFER_SCOPE_DENIED", 403);
  return { ...actor, scope: {
    global: operational.subjectMode === "ORGANIZATION",
    companyIds: strings(user.companyIds || user.assignedCompanies || [user.companyId || user.company]),
    countryIds: operational.countryIds, marketIds: strings(user.marketIds || user.assignedMarkets),
    areaIds: operational.areaIds, productIds: operational.productIds,
  } };
}

export function validateOfferActorProfile(uid: string, user: Record<string, unknown> | null | undefined): string {
  if (!uid) throw new OfferAdministrationError("OFFER_AUTHENTICATION_REQUIRED", 401);
  if (!user) throw new OfferAdministrationError("OFFER_ACTOR_NOT_FOUND", 403);
  if (user.active === false || user.loginAllowed === false || user.isDeleted === true || ["Inactive", "Suspended", "Archived"].includes(text(user.status) || text(user.employmentStatus))) throw new OfferAdministrationError("OFFER_ACTOR_INACTIVE", 403);
  return String(normalizeRole(text(user.role)));
}

export function offerAdministrationResponse(actor: OfferAdministrationActor) {
  return {
    capabilities: resolveOfferCapabilities(actor.role, actor.permissions),
  };
}
