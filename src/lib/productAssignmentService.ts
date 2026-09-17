import { Product, UserProductAssignment } from "../types";

export type ProductResolutionCode =
  | "PRODUCT_ID_REQUIRED"
  | "PRODUCT_NOT_FOUND"
  | "PRODUCT_INACTIVE"
  | "PRODUCT_GROUP_MISSING"
  | "INVALID_PRODUCT_METADATA";

export type ProductResolutionResult =
  | {
      ok: true;
      product: Product;
    }
  | {
      ok: false;
      code: ProductResolutionCode;
      message: string;
    };

/**
 * Resolves a product by its exact canonical Firestore document ID.
 * Product name, SKU, or fuzzy matches are strictly rejected for normal runtime assignment.
 */
export function resolveCanonicalProductById(
  products: Product[],
  productId: string
): ProductResolutionResult {
  if (!productId || productId.trim() === "") {
    return {
      ok: false,
      code: "PRODUCT_ID_REQUIRED",
      message: "A non-empty product ID is required for resolution."
    };
  }

  // Exact Match on product ID only (cannot match by name or SKU)
  const exactMatches = products.filter(p => p.id === productId);

  if (exactMatches.length === 0) {
    return {
      ok: false,
      code: "PRODUCT_NOT_FOUND",
      message: `Product with exact ID '${productId}' was not found in the Product Master.`
    };
  }

  if (exactMatches.length > 1) {
    return {
      ok: false,
      code: "INVALID_PRODUCT_METADATA",
      message: `Ambiguity detected: multiple products resolved with the ID '${productId}'.`
    };
  }

  const product = exactMatches[0];

  // Validate active status
  const isActive = product.isActive !== false && (product as any).active !== false;
  if (!isActive) {
    return {
      ok: false,
      code: "PRODUCT_INACTIVE",
      message: `Product '${product.name}' (ID: ${productId}) is currently inactive and cannot be assigned.`
    };
  }

  // Validate product promotion group
  const productGroupId = product.promotionGroupId || (product as any).productPromotionGroupId || product.brand;
  if (!productGroupId || productGroupId.trim() === "") {
    return {
      ok: false,
      code: "PRODUCT_GROUP_MISSING",
      message: `Product '${product.name}' (ID: ${productId}) is missing a valid Promotion Group assignment.`
    };
  }

  return {
    ok: true,
    product
  };
}

/**
 * Creates a safe, deterministic Firestore document ID for a product assignment.
 * Encodes potential unsafe characters (like '/' or spaces) to avoid breaking database paths.
 */
export function createUserProductAssignmentId(
  userId: string,
  productId: string
): string {
  const safeUserId = encodeURIComponent(userId.trim()).replace(/%/g, "_");
  const safeProductId = encodeURIComponent(productId.trim()).replace(/%/g, "_");
  return `PA_${safeUserId}_${safeProductId}`;
}

export interface BuildAssignmentParams {
  userId: string;
  product: Product;
  actorUid: string;
  assignmentType?: "medical" | "sales" | "both";
}

/**
 * Builds a type-safe, canonical product assignment payload from resolved metadata.
 * No fallback group or therapeutic area values are ever generated if missing.
 */
export function buildCanonicalProductAssignment({
  userId,
  product,
  actorUid,
  assignmentType = "both"
}: BuildAssignmentParams): UserProductAssignment {
  const productGroupId = product.promotionGroupId || (product as any).productPromotionGroupId || product.brand;
  const therapeuticArea = product.therapeuticArea;

  if (!userId || userId.trim() === "") {
    throw new Error("Cannot build assignment payload: userId is required.");
  }

  if (!product.id || product.id.trim() === "") {
    throw new Error("Cannot build assignment payload: product.id is required.");
  }

  if (!productGroupId || productGroupId.trim() === "") {
    throw new Error(`Cannot build assignment payload: Product '${product.name}' is missing a valid productGroupId.`);
  }

  const assignmentId = createUserProductAssignmentId(userId, product.id);

  const payload: UserProductAssignment = {
    assignmentId,
    userId: userId.trim(),
    productId: product.id.trim(),
    productGroupId: productGroupId.trim(),
    therapeuticArea: therapeuticArea || "General",
    assignmentType,
    effectiveFrom: new Date().toISOString().split("T")[0],
    effectiveTo: "2030-12-31",
    status: "Active",
    active: true,

    productSku: product.sku || "",
    productNameSnapshot: product.name,
    productArabicNameSnapshot: product.nameAr || "",

    productGroupNameSnapshot: product.promotionGroupName || (product as any).productPromotionGroupName || product.brand || "",

    therapeuticAreaId: (product as any).therapeuticAreaId || "",
    therapeuticAreaNameSnapshot: therapeuticArea || "",

    assignmentSource: "USER_MANAGEMENT",
    assignedBy: actorUid,
    assignedAt: new Date().toISOString(),

    schemaVersion: 2
  };

  return payload;
}

/**
 * Combines the selected Primary and Target Promotion Group IDs,
 * filters for active products belonging to those groups, and returns them in deterministic order.
 */
export function deriveEligibleProducts({
  products,
  primaryPromotionGroupId,
  targetPromotionGroupIds
}: {
  products: Product[];
  primaryPromotionGroupId: string | null;
  targetPromotionGroupIds: string[];
}): Product[] {
  const groupIds = new Set<string>();
  if (primaryPromotionGroupId) {
    groupIds.add(primaryPromotionGroupId);
  }
  targetPromotionGroupIds.forEach(id => {
    if (id) groupIds.add(id);
  });

  if (groupIds.size === 0) {
    return [];
  }

  return products
    .filter(p => {
      const isActive = p.isActive !== false && (p as any).active !== false;
      if (!isActive) return false;
      if (!p.promotionGroupId) return false;
      return groupIds.has(p.promotionGroupId);
    })
    .sort((a, b) => {
      const nameA = (a.name || (a as any).productName || "").trim().toLowerCase();
      const nameB = (b.name || (b as any).productName || "").trim().toLowerCase();
      if (nameA !== nameB) {
        return nameA.localeCompare(nameB);
      }
      const skuA = (a.sku || (a as any).code || "").trim().toLowerCase();
      const skuB = (b.sku || (b as any).code || "").trim().toLowerCase();
      if (skuA !== skuB) {
        return skuA.localeCompare(skuB);
      }
      return a.id.localeCompare(b.id);
    });
}

/** Active Product master records with one valid active canonical Promotion Group. */
export function getAssignableCanonicalProducts({
  products,
  promotionGroups,
}: {
  products: Product[];
  promotionGroups: Array<{ id: string; isActive?: boolean; active?: boolean }>;
}): Product[] {
  const activeGroupIds = new Set(promotionGroups
    .filter(group => group.isActive !== false && group.active !== false)
    .map(group => group.id));
  return products.filter(product =>
    product.isActive !== false
    && (product as Product & { active?: boolean }).active !== false
    && typeof product.promotionGroupId === "string"
    && activeGroupIds.has(product.promotionGroupId));
}

/**
 * Resolves the active Product Master IDs eligible for explicit physician
 * alignment. Representative authority is intentionally not considered here.
 */
export function getPhysicianEligibleProductIds({
  physician,
  products,
  userProductAssignments
}: {
  physician: {
    assignedRepId?: string;
    primaryPromotionGroupId?: string;
    targetPromotionGroupIds?: string[];
  };
  products: Product[];
  userProductAssignments: UserProductAssignment[];
}): string[] {
  // Identify primary and target promotion group IDs.
  const groupIds = new Set<string>();
  if (physician.primaryPromotionGroupId) {
    groupIds.add(physician.primaryPromotionGroupId);
  }
  (physician.targetPromotionGroupIds || []).forEach(id => {
    if (id) groupIds.add(id);
  });

  if (groupIds.size === 0) {
    return [];
  }

  // Filter only by canonical Product Master state and physician master groups.
  return products
    .filter(p => {
      const isProductActive = p.isActive !== false && (p as any).active !== false;
      if (!isProductActive) return false;
      if (!p.promotionGroupId || !groupIds.has(p.promotionGroupId)) return false;
      return Boolean(p.id);
    })
    .map(p => p.id)
    .sort();
}

/**
 * Validates an explicit physician product selection against Product Master and
 * the physician's canonical promotion-group IDs. Representative ownership is a
 * visit-runtime concern and must never erase Physician Master alignment.
 */
export function getValidatedPhysicianAlignedProductIds({
  selectedProductIds,
  physician,
  products,
  userProductAssignments
}: {
  selectedProductIds: string[];
  physician: {
    assignedRepId?: string;
    primaryPromotionGroupId?: string;
    targetPromotionGroupIds?: string[];
  };
  products: Product[];
  userProductAssignments: UserProductAssignment[];
}): string[] {
  const eligibleProductIds = new Set(getPhysicianEligibleProductIds({
    physician,
    products,
    userProductAssignments
  }));

  return Array.from(new Set(selectedProductIds.filter(Boolean)))
    .filter(productId => eligibleProductIds.has(productId))
    .sort();
}

/**
 * Resolves visit products using canonical IDs only. `authorizedProducts` must
 * already be scoped to the representative before this physician intersection.
 */
export function resolvePhysicianVisitProducts({
  physician,
  authorizedProducts
}: {
  physician: {
    primaryPromotionGroupId?: string;
    targetPromotionGroupIds?: string[];
    alignedProductIds?: string[];
  };
  authorizedProducts: Product[];
}): Product[] {
  const promotionGroupIds = new Set([
    physician.primaryPromotionGroupId,
    ...(physician.targetPromotionGroupIds || [])
  ].filter((id): id is string => Boolean(id)));
  const alignedProductIds = new Set(physician.alignedProductIds || []);

  return authorizedProducts.filter(product =>
    alignedProductIds.has(product.id) &&
    Boolean(product.promotionGroupId) &&
    promotionGroupIds.has(product.promotionGroupId!)
  );
}

/**
 * Compares the legacy user-profile Product ID snapshot with ACTIVE canonical
 * assignments. This is diagnostic only; runtime authorization continues to use
 * userProductAssignments exclusively.
 */
export function diagnoseRepresentativeProductAssignmentSync({
  userProfileProductIds,
  activeUserProductAssignmentIds
}: {
  userProfileProductIds: string[];
  activeUserProductAssignmentIds: string[];
}) {
  const profileIds = [...new Set(userProfileProductIds.filter(Boolean))].sort();
  const assignmentIds = [...new Set(activeUserProductAssignmentIds.filter(Boolean))].sort();
  const profileSet = new Set(profileIds);
  const assignmentSet = new Set(assignmentIds);
  const missingActiveAssignmentIds = profileIds.filter(id => !assignmentSet.has(id));
  const activeAssignmentIdsMissingFromProfile = assignmentIds.filter(id => !profileSet.has(id));

  return {
    userProfileProductIds: profileIds,
    activeUserProductAssignmentIds: assignmentIds,
    missingActiveAssignmentIds,
    activeAssignmentIdsMissingFromProfile,
    synchronized: missingActiveAssignmentIds.length === 0 && activeAssignmentIdsMissingFromProfile.length === 0
  };
}

export interface GroupRemovalImpactResult {
  affectedProductIds: string[];
  unaffectedProductIds: string[];
}

/**
 * Pure helper to calculate which selected products are affected by a group's removal.
 */
export function calculateGroupRemovalImpact({
  removedGroupId,
  remainingGroupIds,
  selectedProductIds,
  products
}: {
  removedGroupId: string;
  remainingGroupIds: string[];
  selectedProductIds: string[];
  products: Product[];
}): GroupRemovalImpactResult {
  const affectedProductIds: string[] = [];
  const unaffectedProductIds: string[] = [];

  const remainingGroupsSet = new Set(remainingGroupIds);

  selectedProductIds.forEach(productId => {
    const product = products.find(p => p.id === productId);
    if (!product) {
      unaffectedProductIds.push(productId);
      return;
    }

    const prodGroupId = product.promotionGroupId;
    if (prodGroupId === removedGroupId) {
      if (!remainingGroupsSet.has(prodGroupId)) {
        affectedProductIds.push(productId);
      } else {
        unaffectedProductIds.push(productId);
      }
    } else {
      unaffectedProductIds.push(productId);
    }
  });

  return {
    affectedProductIds,
    unaffectedProductIds
  };
}

export type ExistingAssignmentClassification =
  | "CANONICAL_ACTIVE"
  | "CANONICAL_INACTIVE"
  | "LEGACY_NAME_BASED"
  | "INVALID";

/**
 * Classifies an existing assignment record into canonical active, inactive, legacy name-based, or invalid.
 */
export function classifyExistingAssignment(
  assignment: UserProductAssignment,
  products: Product[]
): ExistingAssignmentClassification {
  if (!assignment.userId || !assignment.productId) {
    return "INVALID";
  }

  // Must represent an individual Product that exists in the Product Master by ID
  const productExists = products.some(p => p.id === assignment.productId);
  if (!productExists) {
    return "LEGACY_NAME_BASED";
  }

  // Assignment document ID must be consistent with the canonical ID helper
  const canonicalId = createUserProductAssignmentId(assignment.userId, assignment.productId);
  const actualAssignmentId = assignment.assignmentId || (assignment as any).id;
  if (actualAssignmentId !== canonicalId) {
    return "LEGACY_NAME_BASED";
  }

  // Must not represent a promotion group or legacy name
  const isActive = assignment.status === "Active" && assignment.active !== false;
  return isActive ? "CANONICAL_ACTIVE" : "CANONICAL_INACTIVE";
}

export interface SyncValidationResult {
  ok: boolean;
  errors: string[];
}

/**
 * Validates selected Product IDs before writing anything to Firestore.
 */
export function validateSyncInputs({
  representativeUid,
  selectedProductIds,
  products,
  primaryPromotionGroupId,
  targetPromotionGroupIds,
  requirePromotionGroupSelection = true,
  promotionGroups = [],
}: {
  representativeUid: string;
  selectedProductIds: string[];
  products: Product[];
  primaryPromotionGroupId: string | null;
  targetPromotionGroupIds: string[];
  requirePromotionGroupSelection?: boolean;
  promotionGroups?: Array<{ id: string; isActive?: boolean; active?: boolean }>;
}): SyncValidationResult {
  const errors: string[] = [];

  if (!representativeUid || representativeUid.trim() === "") {
    errors.push("Representative UID is required.");
  }

  const eligibleProducts = deriveEligibleProducts({
    products,
    primaryPromotionGroupId,
    targetPromotionGroupIds
  });
  const eligibleIdsSet = new Set(eligibleProducts.map(p => p.id));
  const functionallyAssignableIds = new Set(getAssignableCanonicalProducts({ products, promotionGroups }).map(product => product.id));

  // Normalize duplicate selected Product IDs.
  const uniqueSelectedIds = Array.from(new Set(selectedProductIds.filter(id => id && id.trim() !== "")));

  for (const id of uniqueSelectedIds) {
    // Resolve every selected Product using resolveCanonicalProductById
    const res = resolveCanonicalProductById(products, id);
    if (!res.ok) {
      errors.push(`Validation failed for Product ID '${id}': ${(res as any).message}`);
      continue;
    }

    // Verify each Product remains eligible under the selected Promotion Groups.
    if (requirePromotionGroupSelection && !eligibleIdsSet.has(id)) {
      errors.push(`Product '${res.product.name}' (ID: ${id}) is not eligible under the selected Promotion Groups.`);
    }
    if (!requirePromotionGroupSelection && !functionallyAssignableIds.has(id)) {
      errors.push(`Product '${res.product.name}' (ID: ${id}) does not belong to one active canonical Promotion Group.`);
    }
  }

  return {
    ok: errors.length === 0,
    errors
  };
}

export interface SyncDiffResult {
  toCreate: Product[];
  toRetain: UserProductAssignment[];
  toReactivate: UserProductAssignment[];
  toUpdate: { existing: UserProductAssignment; updated: UserProductAssignment }[];
  toDeactivate: UserProductAssignment[];
  legacyUnchanged: UserProductAssignment[];
}

/** Firestore snapshot metadata is for local identity only and must never be written. */
export function withoutFirestoreDocumentId<T extends Record<string, any>>(record: T): Omit<T, "id"> {
  const { id: _documentId, ...payload } = record;
  return payload;
}

/**
 * Calculates the idempotent diff to synchronize assignments with Firestore.
 */
export function calculateSyncDiff({
  representativeUid,
  selectedProductIds,
  products,
  existingAssignments,
  actorUid,
  assignmentType = "both"
}: {
  representativeUid: string;
  selectedProductIds: string[];
  products: Product[];
  existingAssignments: UserProductAssignment[];
  actorUid: string;
  assignmentType: "medical" | "sales" | "both";
}): SyncDiffResult {
  const uniqueSelectedIds = Array.from(new Set(selectedProductIds.filter(id => id && id.trim() !== "")));

  const toCreate: Product[] = [];
  const toRetain: UserProductAssignment[] = [];
  const toReactivate: UserProductAssignment[] = [];
  const toUpdate: { existing: UserProductAssignment; updated: UserProductAssignment }[] = [];
  const toDeactivate: UserProductAssignment[] = [];
  const legacyUnchanged: UserProductAssignment[] = [];

  const canonicalActiveMap = new Map<string, UserProductAssignment>();
  const canonicalInactiveMap = new Map<string, UserProductAssignment>();

  existingAssignments.forEach(assignment => {
    const classification = classifyExistingAssignment(assignment, products);
    if (classification === "CANONICAL_ACTIVE") {
      canonicalActiveMap.set(assignment.productId, assignment);
    } else if (classification === "CANONICAL_INACTIVE") {
      canonicalInactiveMap.set(assignment.productId, assignment);
    } else if (classification === "LEGACY_NAME_BASED") {
      legacyUnchanged.push(assignment);
    }
  });

  uniqueSelectedIds.forEach(productId => {
    const resolution = resolveCanonicalProductById(products, productId);
    if (!resolution.ok) return;

    const product = resolution.product;
    const activeAss = canonicalActiveMap.get(productId);
    const inactiveAss = canonicalInactiveMap.get(productId);

    if (activeAss) {
      const latestPayload = buildCanonicalProductAssignment({
        userId: representativeUid,
        product,
        actorUid,
        assignmentType
      });

      const needsUpdate =
        activeAss.productSku !== latestPayload.productSku ||
        activeAss.productNameSnapshot !== latestPayload.productNameSnapshot ||
        activeAss.productArabicNameSnapshot !== latestPayload.productArabicNameSnapshot ||
        activeAss.productGroupNameSnapshot !== latestPayload.productGroupNameSnapshot ||
        activeAss.therapeuticAreaNameSnapshot !== latestPayload.therapeuticAreaNameSnapshot ||
        activeAss.assignmentType !== latestPayload.assignmentType;

      if (needsUpdate) {
        const updatedPayload: UserProductAssignment = {
          ...withoutFirestoreDocumentId(activeAss),
          productSku: latestPayload.productSku,
          productNameSnapshot: latestPayload.productNameSnapshot,
          productArabicNameSnapshot: latestPayload.productArabicNameSnapshot,
          productGroupNameSnapshot: latestPayload.productGroupNameSnapshot,
          therapeuticAreaNameSnapshot: latestPayload.therapeuticAreaNameSnapshot,
          assignmentType: latestPayload.assignmentType,
          updatedAt: new Date().toISOString(),
          updatedBy: actorUid
        };
        toUpdate.push({ existing: activeAss, updated: updatedPayload });
      } else {
        toRetain.push(activeAss);
      }
    } else if (inactiveAss) {
      const latestPayload = buildCanonicalProductAssignment({
        userId: representativeUid,
        product,
        actorUid,
        assignmentType
      });

      const reactivatedPayload: UserProductAssignment = {
        ...withoutFirestoreDocumentId(inactiveAss),
        active: true,
        status: "Active",
        productSku: latestPayload.productSku,
        productNameSnapshot: latestPayload.productNameSnapshot,
        productArabicNameSnapshot: latestPayload.productArabicNameSnapshot,
        productGroupNameSnapshot: latestPayload.productGroupNameSnapshot,
        therapeuticAreaNameSnapshot: latestPayload.therapeuticAreaNameSnapshot,
        assignmentType: latestPayload.assignmentType,
        updatedAt: new Date().toISOString(),
        updatedBy: actorUid
      };

      // Ensure deactivation fields are cleared
      delete (reactivatedPayload as any).deactivatedAt;
      delete (reactivatedPayload as any).deactivatedBy;
      delete (reactivatedPayload as any).deactivationReason;

      toReactivate.push(reactivatedPayload);
    } else {
      toCreate.push(product);
    }
  });

  canonicalActiveMap.forEach((assignment, productId) => {
    if (!uniqueSelectedIds.includes(productId)) {
      toDeactivate.push(assignment);
    }
  });

  return {
    toCreate,
    toRetain,
    toReactivate,
    toUpdate,
    toDeactivate,
    legacyUnchanged
  };
}

export interface ActiveCanonicalAssignmentsReport {
  assignments: UserProductAssignment[];
  productIds: string[];
  legacyCount: number;
  invalidCount: number;
  inactiveCount: number;
  missingProductCount: number;
  duplicateCount: number;
}

/** True only while a canonical Product assignment is inside its configured effective window. */
export function isProductAssignmentEffectiveAt(
  assignment: Pick<UserProductAssignment, "effectiveFrom" | "effectiveTo">,
  asOf: Date = new Date(),
): boolean {
  const asOfMs = asOf.getTime();
  if (!Number.isFinite(asOfMs)) return false;
  if (assignment.effectiveFrom) {
    const from = Date.parse(assignment.effectiveFrom);
    if (!Number.isFinite(from) || from > asOfMs) return false;
  }
  if (assignment.effectiveTo) {
    const to = Date.parse(assignment.effectiveTo);
    if (!Number.isFinite(to) || to < asOfMs) return false;
  }
  return true;
}

/**
 * Shared Pure Selector for extracting active canonical assignments.
 */
export function getActiveCanonicalAssignmentsForUser({
  assignments,
  userId,
  products
}: {
  assignments: UserProductAssignment[];
  userId: string;
  products: Product[];
}): ActiveCanonicalAssignmentsReport {
  if (!userId || userId.trim() === "") {
    throw new Error("A valid userId is required.");
  }

  const userAssignments = (assignments || []).filter(a => a.userId === userId);

  let legacyCount = 0;
  let invalidCount = 0;
  let inactiveCount = 0;
  let missingProductCount = 0;
  let duplicateCount = 0;

  const seenProductIds = new Set<string>();
  const validActiveAssignments: UserProductAssignment[] = [];

  userAssignments.forEach(a => {
    // 1. Invalid checks
    if (!a.productId || a.productId.trim() === "" || !a.userId || a.userId.trim() === "") {
      invalidCount++;
      return;
    }

    // 2. Legacy name/SKU/Promo Group check
    const isLegacy = 
      a.productId.includes(" ") ||
      products.some(p => (p.name === a.productId || p.sku === a.productId) && p.id !== a.productId);

    if (isLegacy) {
      legacyCount++;
      return;
    }

    const isPromoGroup = products.some(p => p.promotionGroupId === a.productId) && !products.some(p => p.id === a.productId);
    if (isPromoGroup) {
      legacyCount++;
      return;
    }

    // 3. Inactive check
    const isActive = a.status === "Active" && a.active !== false;
    if (!isActive) {
      inactiveCount++;
      return;
    }

    // 4. Check if Product exists in catalog
    const matchingProduct = products.find(p => p.id === a.productId);
    if (!matchingProduct) {
      missingProductCount++;
      return;
    }

    // Exclude if product is inactive
    const isProdActive = matchingProduct.isActive !== false && (matchingProduct as any).active !== false;
    if (!isProdActive) {
      inactiveCount++;
      return;
    }

    // 5. Duplicate check
    if (seenProductIds.has(a.productId)) {
      duplicateCount++;
      return;
    }

    seenProductIds.add(a.productId);
    validActiveAssignments.push(a);
  });

  // Sort deterministically by productId
  validActiveAssignments.sort((a, b) => a.productId.localeCompare(b.productId));

  return {
    assignments: validActiveAssignments,
    productIds: Array.from(seenProductIds).sort(),
    legacyCount,
    invalidCount,
    inactiveCount,
    missingProductCount,
    duplicateCount
  };
}

/**
 * Shared Assigned Product Resolver.
 */
export function getAssignedProductsForUser({
  assignments,
  products,
  userId
}: {
  assignments: UserProductAssignment[];
  products: Product[];
  userId: string;
}): Product[] {
  const report = getActiveCanonicalAssignmentsForUser({ assignments, userId, products });
  const assignedProducts: Product[] = [];
  report.assignments.forEach(a => {
    const product = products.find(p => p.id === a.productId);
    if (product) {
      const isProdActive = product.isActive !== false && (product as any).active !== false;
      if (isProdActive) {
        assignedProducts.push(product);
      }
    }
  });
  return assignedProducts;
}

export interface AssignmentOperationalState {
  allowed: boolean;
  state: "READY" | "PENDING" | "FAILED" | "LEGACY_REVIEW_REQUIRED";
  reason: string;
}

/**
 * Pure helper for gating representative operational state based on sync status.
 */
export function getAssignmentOperationalState(user: any): AssignmentOperationalState {
  if (!user) {
    return {
      allowed: false,
      state: "FAILED",
      reason: "User session is invalid or missing."
    };
  }

  const role = user.role;
  const isRep = role === "Medical Representative" || role === "Sales Representative" || role === "Representative";

  if (!isRep) {
    return {
      allowed: true,
      state: "READY",
      reason: "User has a managerial or administrative role; bypasses synchronization checks."
    };
  }

  const syncStatus = user.assignmentSyncStatus;

  if (!syncStatus) {
    return {
      allowed: false,
      state: "LEGACY_REVIEW_REQUIRED",
      reason: "Assignment synchronization has not completed. Operational workflows are unavailable."
    };
  }

  switch (syncStatus) {
    case "COMPLETE":
      return {
        allowed: true,
        state: "READY",
        reason: "Synchronization is complete. Operational workflows are ready."
      };
    case "PENDING":
    case "IN_PROGRESS":
      return {
        allowed: false,
        state: "PENDING",
        reason: "Product assignments are being synchronized. Operational workflows are temporarily unavailable."
      };
    case "FAILED":
      return {
        allowed: false,
        state: "FAILED",
        reason: "Synchronization Failed"
      };
    default:
      return {
        allowed: false,
        state: "LEGACY_REVIEW_REQUIRED",
        reason: "Assignment synchronization has not completed. Operational workflows are unavailable."
      };
  }
}
