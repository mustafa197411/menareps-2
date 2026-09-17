export interface DetailingProductLike {
  id: string;
  promotionGroupId?: string;
  isActive?: boolean;
  active?: boolean;
}

export interface DetailingSelectionLike {
  productId: string;
}

export interface DetailingEligibilityInput<T extends DetailingProductLike = DetailingProductLike> {
  products: T[];
  physicianAlignedProductIds: string[];
  representativeActiveProductIds: string[];
  primaryPromotionGroupId?: string;
  targetPromotionGroupIds: string[];
  selections: DetailingSelectionLike[];
  blockIndex: number;
  selectedPromotionGroupId?: string;
}

export interface DetailingEligibilityResolution {
  allowedVisitProductIds: string[];
  productsInSelectedPromotionGroup: string[];
  eligibleProductIds: string[];
  excludedAlreadySelectedProductIds: string[];
  remainingEligiblePrimaryProductIds: string[];
  remainingEligibleTargetProductIds: string[];
  availableProductIdsForBlock: string[];
}

export interface CompletionProductValidation {
  selectedProductIds: string[];
  uniqueProductIds: string[];
  duplicateProductIds: string[];
  unauthorizedProductIds: string[];
  primaryFirstValidation: "PASS" | "FAIL" | "LEGACY_NO_PRIMARY_GROUP" | "NO_ELIGIBLE_PRIMARY_PRODUCT";
  validationResult: "PASS" | "FAIL";
}

export function duplicateProductIds(productIds: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  productIds.filter(Boolean).forEach(id => seen.has(id) ? duplicates.add(id) : seen.add(id));
  return [...duplicates];
}

export function getEligibleProductsForDetailingBlock<T extends DetailingProductLike>(
  input: DetailingEligibilityInput<T>
): T[] {
  const resolution = resolveDetailingEligibility(input);
  const available = new Set(resolution.availableProductIdsForBlock);
  return input.products.filter(product => available.has(product.id));
}

/** Resolves visit detailing exclusively through canonical Product and Promotion Group IDs. */
export function resolveDetailingEligibility<T extends DetailingProductLike>(
  input: DetailingEligibilityInput<T>
): DetailingEligibilityResolution {
  const aligned = new Set(input.physicianAlignedProductIds);
  const assigned = new Set(input.representativeActiveProductIds);
  const allowedGroups = new Set([
    input.primaryPromotionGroupId,
    ...input.targetPromotionGroupIds
  ].filter(Boolean));
  const selectedElsewhere = new Set(input.selections
    .filter((_, index) => index !== input.blockIndex)
    .map(item => item.productId)
    .filter(Boolean));

  const allowedVisitProducts = input.products.filter(product => {
    if (product.isActive === false || product.active === false) return false;
    if (!aligned.has(product.id) || !assigned.has(product.id)) return false;
    if (!product.promotionGroupId || !allowedGroups.has(product.promotionGroupId)) return false;
    return true;
  });
  const remaining = allowedVisitProducts.filter(product => !selectedElsewhere.has(product.id));
  const remainingPrimary = remaining.filter(product => product.promotionGroupId === input.primaryPromotionGroupId);
  const targetGroups = new Set(input.targetPromotionGroupIds);
  const remainingTarget = remaining.filter(product => product.promotionGroupId && targetGroups.has(product.promotionGroupId));
  const firstBlockPool = input.blockIndex === 0 && remainingPrimary.length > 0 ? remainingPrimary : remaining;
  const available = firstBlockPool.filter(product =>
    !input.selectedPromotionGroupId || product.promotionGroupId === input.selectedPromotionGroupId
  );

  return {
    allowedVisitProductIds: allowedVisitProducts.map(product => product.id),
    productsInSelectedPromotionGroup: input.selectedPromotionGroupId
      ? allowedVisitProducts.filter(product => product.promotionGroupId === input.selectedPromotionGroupId).map(product => product.id)
      : allowedVisitProducts.map(product => product.id),
    eligibleProductIds: available.map(product => product.id),
    excludedAlreadySelectedProductIds: [...selectedElsewhere],
    remainingEligiblePrimaryProductIds: remainingPrimary.map(product => product.id),
    remainingEligibleTargetProductIds: remainingTarget.map(product => product.id),
    availableProductIdsForBlock: available.map(product => product.id)
  };
}

export function validateDetailingCompletion(input: {
  selectedProductIds: string[];
  allowedVisitProductIds: string[];
  products: DetailingProductLike[];
  primaryPromotionGroupId?: string;
}): CompletionProductValidation {
  const selectedProductIds = input.selectedProductIds.filter(Boolean);
  const uniqueProductIds = [...new Set(selectedProductIds)];
  const duplicates = duplicateProductIds(selectedProductIds);
  const allowed = new Set(input.allowedVisitProductIds);
  const unauthorizedProductIds = uniqueProductIds.filter(id => !allowed.has(id));
  const primaryProducts = input.products.filter(product =>
    allowed.has(product.id) && product.isActive !== false && product.active !== false &&
    product.promotionGroupId === input.primaryPromotionGroupId
  );
  let primaryFirstValidation: CompletionProductValidation["primaryFirstValidation"] = "PASS";
  if (!input.primaryPromotionGroupId) primaryFirstValidation = "LEGACY_NO_PRIMARY_GROUP";
  else if (primaryProducts.length === 0) primaryFirstValidation = "NO_ELIGIBLE_PRIMARY_PRODUCT";
  else if (input.products.find(product => product.id === selectedProductIds[0])?.promotionGroupId !== input.primaryPromotionGroupId) {
    primaryFirstValidation = "FAIL";
  }
  return {
    selectedProductIds,
    uniqueProductIds,
    duplicateProductIds: duplicates,
    unauthorizedProductIds,
    primaryFirstValidation,
    validationResult: duplicates.length || unauthorizedProductIds.length || primaryFirstValidation === "FAIL" ? "FAIL" : "PASS"
  };
}

interface KeyMessageFilterable {
  productId?: string;
  isApproved?: boolean;
  active?: boolean;
  isActive?: boolean;
  isDeleted?: boolean;
}

interface DetailingMaterialFilterable {
  productId?: string;
  productIds?: string[];
  isDeleted?: boolean;
  active?: boolean;
  isActive?: boolean;
  uploadStatus?: string;
  status?: string;
  isApproved?: boolean;
  approvalStatus?: string;
  resourceScope?: "PROMOTION_GROUP" | "SELECTED_PRODUCTS";
  promotionGroupId?: string;
  specialtyIds?: string[];
  effectiveDate?: string;
  expiryDate?: string;
}

export interface CanonicalMaterialContext {
  productId: string;
  productPromotionGroupId?: string;
  physicianSpecialtyId?: string;
  today?: string;
}

export function filterKeyMessagesForAuthorizedProducts<T extends KeyMessageFilterable[]>(
  messages: T, authorizedProductIds: string[]
): Array<T[number]> {
  const authorized = new Set(authorizedProductIds);
  return messages.filter(message => Boolean(message.productId) && authorized.has(message.productId!));
}

export function filterMaterialsForAuthorizedProducts<T extends DetailingMaterialFilterable[]>(
  materials: T, authorizedProductIds: string[], products: DetailingProductLike[] = []
): Array<T[number]> {
  const authorized = new Set(authorizedProductIds);
  const groups = new Set(products.filter(product => authorized.has(product.id)).map(product => product.promotionGroupId).filter(Boolean));
  return materials.filter(material => material.resourceScope === "PROMOTION_GROUP"
    ? Boolean(material.promotionGroupId && groups.has(material.promotionGroupId))
    : Boolean((material.productId && authorized.has(material.productId)) || material.productIds?.some(id => authorized.has(id))));
}

export function filterKeyMessagesForProduct<T extends KeyMessageFilterable[]>(
  messages: T, productId: string
): Array<T[number]> {
  return messages.filter(message =>
    message.productId === productId && message.isApproved === true &&
    message.active !== false && message.isActive !== false && !message.isDeleted
  );
}

export function filterMaterialsForProduct<T extends DetailingMaterialFilterable[]>(
  materials: T, productIdOrContext: string | CanonicalMaterialContext
): Array<T[number]> {
  const context: CanonicalMaterialContext = typeof productIdOrContext === "string" ? { productId: productIdOrContext } : productIdOrContext;
  const today = context.today || new Date().toISOString().slice(0, 10);
  return materials.filter(material => {
    if (material.isDeleted || material.active === false || material.isActive === false) return false;
    if (material.uploadStatus && material.uploadStatus !== "COMPLETE") return false;
    const approved = material.isApproved === true || material.status === "Approved" ||
      material.approvalStatus === "PUBLISHED" || material.approvalStatus === "APPROVED";
    if (!approved) return false;
    if (material.effectiveDate && material.effectiveDate > today) return false;
    if (material.expiryDate && material.expiryDate < today) return false;
    if (material.specialtyIds?.length && (!context.physicianSpecialtyId || !material.specialtyIds.includes(context.physicianSpecialtyId))) return false;
    if (material.resourceScope === "PROMOTION_GROUP") return Boolean(context.productPromotionGroupId && material.promotionGroupId === context.productPromotionGroupId);
    return material.productId === context.productId || material.productIds?.includes(context.productId);
  });
}

export function retainEligibleIds(selectedIds: string[], eligibleIds: string[]): string[] {
  const eligible = new Set(eligibleIds);
  return selectedIds.filter(id => eligible.has(id));
}

export interface KeyMessagePresentationGateResult {
  requiredKeyMessageIds: string[];
  presentedKeyMessageIds: string[];
  hasPresented: boolean;
  presentationComplete: boolean;
  gatePass: boolean;
  gateFailureReason: string | null;
}

export interface DetailingKeyMessageCompletionInput {
  availableKeyMessageIds: string[];
  selectedKeyMessageIds: string[];
  presentedKeyMessageIds: string[];
}

/**
 * Normalizes the optional key-message selection for one canonical Product block.
 * Selecting a message is itself the presentation record; no completion gate exists.
 */
export function evaluateKeyMessagePresentationGate(
  availableKeyMessageIds: string[],
  presentedKeyMessageIds: string[]
): KeyMessagePresentationGateResult {
  const requiredKeyMessageIds = [...new Set(availableKeyMessageIds.filter(Boolean))];
  const required = new Set(requiredKeyMessageIds);
  const presented = [...new Set(presentedKeyMessageIds.filter(id => required.has(id)))];

  return {
    requiredKeyMessageIds,
    presentedKeyMessageIds: presented,
    hasPresented: presented.length > 0,
    presentationComplete: true,
    gatePass: true,
    gateFailureReason: null
  };
}

/**
 * Canonical optional-selection predicate for a Product detailing block.
 * Legacy presentation state mirrors the eligible selected IDs for compatibility.
 */
export function evaluateDetailingKeyMessageCompletion(
  input: DetailingKeyMessageCompletionInput
): KeyMessagePresentationGateResult {
  const requiredKeyMessageIds = [...new Set(input.availableKeyMessageIds.filter(Boolean))];
  const selected = [...new Set(input.selectedKeyMessageIds)];
  return evaluateKeyMessagePresentationGate(requiredKeyMessageIds, selected);
}

/** Builds backward-compatible visit payload fields from the optional selection. */
export function buildKeyMessagePersistenceFields(
  availableKeyMessageIds: string[],
  selectedKeyMessageIds: string[]
): { keyMessageIds: string[]; presentedKeyMessages: string[] } {
  const selectedIds = evaluateDetailingKeyMessageCompletion({
    availableKeyMessageIds,
    selectedKeyMessageIds,
    presentedKeyMessageIds: []
  }).presentedKeyMessageIds;
  return { keyMessageIds: selectedIds, presentedKeyMessages: [...selectedIds] };
}

/** Clears only state tied to the previous Product ID; all outcome and visit fields are retained. */
export function changeDetailingProductState<T extends {
  productId: string;
  selectedMessages: string[];
  presentedKeyMessageIds?: string[];
  selectedMaterials: string[];
  hasPresented?: boolean;
}>(block: T, productId: string): T {
  return {
    ...block,
    productId,
    selectedMessages: [],
    presentedKeyMessageIds: [],
    selectedMaterials: [],
    hasPresented: false
  };
}
