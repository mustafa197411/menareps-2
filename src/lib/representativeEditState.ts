import { Product, ProductPromotionGroup, Role, User } from "../types";
import { resolveRoleAssignmentAdministrationContract } from "./roleScopePolicy";

type AssignmentRecord = Record<string, unknown>;

export interface RepresentativeEditState {
  primaryPromotionGroupId: string | null;
  targetPromotionGroupIds: string[];
  selectedProductIds: string[];
  assignedAreaIds: string[];
  legacyUnresolvedProducts: string[];
}

export interface RepresentativeEditMasterDataReadiness {
  isRepresentative: boolean;
  productsLoaded: boolean;
  promotionGroupsLoaded: boolean;
  ready: boolean;
}

const uniqueStrings = (values: unknown[]): string[] => Array.from(new Set(
  values.filter((value): value is string => typeof value === "string" && value.trim() !== "")
));

const isActiveAssignment = (assignment: AssignmentRecord): boolean =>
  assignment.active !== false && String(assignment.status || "Active").toLowerCase() === "active";

const normalized = (value: unknown): string => String(value || "").trim().toLowerCase();
const stringArray = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

export function getRepresentativeEditMasterDataReadiness({
  role,
  productsLoading,
  promotionGroupsLoading,
  productCount,
  promotionGroupCount
}: {
  role: Role;
  productsLoading: boolean;
  promotionGroupsLoading: boolean;
  productCount: number;
  promotionGroupCount: number;
}): RepresentativeEditMasterDataReadiness {
  const assignmentContract = resolveRoleAssignmentAdministrationContract(role);
  const isRepresentative = assignmentContract.representativePromotionGroups;
  const productsLoaded = !productsLoading && productCount > 0;
  const promotionGroupsLoaded = !promotionGroupsLoading && promotionGroupCount > 0;
  return {
    isRepresentative,
    productsLoaded,
    promotionGroupsLoaded,
    ready: !assignmentContract.canonicalProducts || (productsLoaded && promotionGroupsLoaded)
  };
}

function resolveUniqueActiveGroupId(
  hint: unknown,
  promotionGroups: ProductPromotionGroup[]
): string | null {
  const key = normalized(hint);
  if (!key) return null;
  const matches = promotionGroups.filter(group =>
    group.isActive !== false && normalized(group.name) === key
  );
  return matches.length === 1 ? matches[0].id : null;
}

/** Hydrates an existing representative using canonical IDs, with narrow legacy-name hints only. */
export function hydrateRepresentativeEditState({
  user,
  productAssignments,
  territoryAssignments,
  products,
  promotionGroups,
  canonicalAssignmentsOnly = false,
}: {
  user: User;
  productAssignments: AssignmentRecord[];
  territoryAssignments: AssignmentRecord[];
  products: Product[];
  promotionGroups: ProductPromotionGroup[];
  canonicalAssignmentsOnly?: boolean;
}): RepresentativeEditState {
  const rawUser = user as User & Record<string, unknown>;
  const activeGroupIds = new Set(promotionGroups.filter(group => group.isActive !== false).map(group => group.id));
  const storedPrimaryId = typeof user.primaryPromotionGroupId === "string" && user.primaryPromotionGroupId.trim()
    ? user.primaryPromotionGroupId
    : null;
  const primaryPromotionGroupId = storedPrimaryId ||
    resolveUniqueActiveGroupId(rawUser.primaryPromotionGroupName, promotionGroups) ||
    resolveUniqueActiveGroupId(rawUser.primaryBrand, promotionGroups);

  const storedTargetIds = uniqueStrings(user.targetPromotionGroupIds || []).filter(id =>
    id !== primaryPromotionGroupId && activeGroupIds.has(id)
  );
  const legacyTargetHints = uniqueStrings([
    ...stringArray(rawUser.targetPromotionGroupNames),
    ...stringArray(rawUser.targetBrands)
  ]);
  const targetPromotionGroupIds = storedTargetIds.length > 0
    ? storedTargetIds
    : uniqueStrings(legacyTargetHints.map(hint => resolveUniqueActiveGroupId(hint, promotionGroups)))
        .filter(id => id !== primaryPromotionGroupId);

  const productIds = new Set(products
    .filter(product => product.isActive !== false && (product as Product & { active?: boolean }).active !== false)
    .map(product => product.id));
  const activeAssignedProductIds = uniqueStrings(productAssignments
    .filter(isActiveAssignment)
    .map(assignment => assignment.productId));
  const storedProducts = uniqueStrings(user.products || []);
  const selectedProductIds = (activeAssignedProductIds.length > 0
    ? activeAssignedProductIds
    : canonicalAssignmentsOnly ? [] : storedProducts)
    .filter(id => productIds.has(id));
  const legacyUnresolvedProducts = canonicalAssignmentsOnly
    ? []
    : storedProducts.filter(value => !productIds.has(value));

  const activeAssignedAreaIds = uniqueStrings(territoryAssignments
    .filter(isActiveAssignment)
    .map(assignment => assignment.territoryId));
  const assignedAreaIds = activeAssignedAreaIds.length > 0
    ? activeAssignedAreaIds
    : canonicalAssignmentsOnly ? [] : uniqueStrings(user.areaIds || []);

  return {
    primaryPromotionGroupId,
    targetPromotionGroupIds,
    selectedProductIds,
    assignedAreaIds,
    legacyUnresolvedProducts
  };
}

export function validateRepresentativePrimaryGroup(
  role: Role,
  primaryPromotionGroupId: string | null
): { isRepresentative: boolean; validationResult: "PASS" | "PRIMARY_PROMOTION_GROUP_MISSING" } {
  const isRepresentative = role === Role.MEDICAL_REP || role === Role.SALES_REP;
  return {
    isRepresentative,
    validationResult: isRepresentative && !primaryPromotionGroupId?.trim()
      ? "PRIMARY_PROMOTION_GROUP_MISSING"
      : "PASS"
  };
}
