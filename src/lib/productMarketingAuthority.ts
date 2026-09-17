import { Role, normalizeRole, type Product, type User } from "../types";
import { canAccessCanonicalView, type CanonicalAccessContext } from "./canonicalAccessControl";
import { isCanonicalApplicationRole } from "./canonicalRoleAccessBaseline";
import type { CanonicalOperationalScope } from "./operationalScopeClient";
import type { OperationalScopeSessionState } from "./operationalScopeSession";
import { hasPermission } from "./userPolicyEngine";
import { isProductMarketingRoleApplicable } from "./productMarketingRoleApplicability";

export type ProductMarketingAction =
  | "VIEW_PRODUCT"
  | "VIEW_PRODUCT_LIST"
  | "MANAGE_PRODUCT"
  | "VIEW_PROMOTION_GROUP"
  | "MANAGE_PROMOTION_GROUP"
  | "VIEW_KEY_MESSAGES"
  | "MANAGE_KEY_MESSAGES"
  | "VIEW_MARKETING_CONTENT"
  | "MANAGE_MARKETING_CONTENT"
  | "MANAGE_MARKETING_SETTINGS"
  | "VIEW_PHYSICIAN_ALIGNMENT"
  | "MANAGE_PHYSICIAN_ALIGNMENT";

export type ProductMarketingAuthorityReason =
  | "ALLOWED"
  | "ROLE_DENY"
  | "MODULE_DENY"
  | "PRODUCT_SCOPE_DENY"
  | "PROMOTION_GROUP_SCOPE_DENY"
  | "PHYSICIAN_ALIGNMENT_DENY"
  | "INACTIVE_PRODUCT"
  | "NONCANONICAL_ROLE";

export type ProductMarketingScopeBasis =
  | "ADMINISTRATIVE_GLOBAL"
  | "OPERATIONAL_PRODUCT_SCOPE"
  | "OPERATIONAL_PROMOTION_GROUP_SCOPE"
  | "PHYSICIAN_ALIGNMENT"
  | "ROLE_CAPABILITY"
  | "NONE";

export interface ProductMarketingAuthorityContext extends CanonicalAccessContext {
  operationalScope?: CanonicalOperationalScope | null;
  operationalScopeSession?: OperationalScopeSessionState | null;
  product?: Pick<Product, "id" | "promotionGroupId" | "isActive"> & { active?: boolean };
  productId?: string;
  promotionGroupId?: string;
  physician?: {
    alignedProductIds?: string[];
    primaryPromotionGroupId?: string;
    targetPromotionGroupIds?: string[];
  };
}

export interface ProductMarketingAuthorityDecision {
  action: ProductMarketingAction;
  allowed: boolean;
  reason: ProductMarketingAuthorityReason;
  scopeBasis: ProductMarketingScopeBasis;
}

const ACTION_VIEW: Record<ProductMarketingAction, string> = {
  VIEW_PRODUCT: "products-list",
  VIEW_PRODUCT_LIST: "products-list",
  MANAGE_PRODUCT: "products-list",
  VIEW_PROMOTION_GROUP: "master-promotion-groups",
  MANAGE_PROMOTION_GROUP: "master-promotion-groups",
  VIEW_KEY_MESSAGES: "products-key-messages",
  MANAGE_KEY_MESSAGES: "products-key-messages",
  VIEW_MARKETING_CONTENT: "marketing-campaigns",
  MANAGE_MARKETING_CONTENT: "marketing-campaigns",
  MANAGE_MARKETING_SETTINGS: "marketing-materials-requests",
  VIEW_PHYSICIAN_ALIGNMENT: "field-physician-list",
  MANAGE_PHYSICIAN_ALIGNMENT: "field-physician-list",
};

function decision(action: ProductMarketingAction, allowed: boolean, reason: ProductMarketingAuthorityReason, scopeBasis: ProductMarketingScopeBasis): ProductMarketingAuthorityDecision {
  return { action, allowed, reason, scopeBasis };
}

function activeScope(context: ProductMarketingAuthorityContext): CanonicalOperationalScope | null {
  if (context.operationalScope) return context.operationalScope.authorized && !context.operationalScope.queryPlan.denyAll ? context.operationalScope : null;
  const session = context.operationalScopeSession;
  if (session?.status !== "READY" || session.actorUid !== context.user?.id || !session.scope) return null;
  return session.scope.authorized && !session.scope.queryPlan.denyAll && session.scope.actorUid === context.user?.id
    ? session.scope
    : null;
}

function targetProductId(context: ProductMarketingAuthorityContext): string {
  return String(context.productId || context.product?.id || "").trim();
}

function targetPromotionGroupId(context: ProductMarketingAuthorityContext): string {
  return String(context.promotionGroupId || context.product?.promotionGroupId || "").trim();
}

function roleAllows(action: ProductMarketingAction, context: ProductMarketingAuthorityContext, role: Role): boolean {
  if (action === "MANAGE_PRODUCT") {
    return hasPermission(context.user, "Products", "create", context.rolePermissions)
      || hasPermission(context.user, "Products", "edit", context.rolePermissions);
  }
  if (["MANAGE_PROMOTION_GROUP", "MANAGE_KEY_MESSAGES", "MANAGE_MARKETING_CONTENT", "MANAGE_MARKETING_SETTINGS", "MANAGE_PHYSICIAN_ALIGNMENT"].includes(action)) {
    return isProductMarketingRoleApplicable(action, role);
  }
  return true;
}

export function evaluateProductMarketingAuthority(
  action: ProductMarketingAction,
  context: ProductMarketingAuthorityContext,
): ProductMarketingAuthorityDecision {
  const normalized = normalizeRole(context.user?.role);
  if (!isCanonicalApplicationRole(String(normalized))) return decision(action, false, "NONCANONICAL_ROLE", "NONE");
  const role = normalized as Role;
  if (!canAccessCanonicalView(context, ACTION_VIEW[action])) return decision(action, false, "MODULE_DENY", "NONE");
  if (!roleAllows(action, context, role)) return decision(action, false, "ROLE_DENY", "NONE");

  const scope = activeScope(context);
  if (action === "VIEW_PRODUCT_LIST" && !scope) return decision(action, false, "PRODUCT_SCOPE_DENY", "NONE");
  const productId = targetProductId(context);
  const groupId = targetPromotionGroupId(context);
  if (context.product && (context.product.isActive === false || context.product.active === false)) {
    return decision(action, false, "INACTIVE_PRODUCT", "NONE");
  }

  if (productId) {
    if (!scope?.productIds.includes(productId)) return decision(action, false, "PRODUCT_SCOPE_DENY", "NONE");
    if (groupId && !scope.productGroupIds.includes(groupId)) return decision(action, false, "PROMOTION_GROUP_SCOPE_DENY", "NONE");
  } else if (groupId && !scope?.productGroupIds.includes(groupId)) {
    return decision(action, false, "PROMOTION_GROUP_SCOPE_DENY", "NONE");
  }

  if (action === "VIEW_PHYSICIAN_ALIGNMENT" || action === "MANAGE_PHYSICIAN_ALIGNMENT") {
    const aligned = context.physician?.alignedProductIds || [];
    const physicianGroups = [context.physician?.primaryPromotionGroupId, ...(context.physician?.targetPromotionGroupIds || [])].filter(Boolean) as string[];
    if (!scope || !aligned.some(id => scope.productIds.includes(id)) || !physicianGroups.some(id => scope.productGroupIds.includes(id))) {
      return decision(action, false, "PHYSICIAN_ALIGNMENT_DENY", "NONE");
    }
    return decision(action, true, "ALLOWED", "PHYSICIAN_ALIGNMENT");
  }

  if (productId) return decision(action, true, "ALLOWED", "OPERATIONAL_PRODUCT_SCOPE");
  if (groupId) return decision(action, true, "ALLOWED", "OPERATIONAL_PROMOTION_GROUP_SCOPE");
  const global = role === Role.SUPER_ADMIN || role === Role.ADMIN;
  return decision(action, true, "ALLOWED", global ? "ADMINISTRATIVE_GLOBAL" : "ROLE_CAPABILITY");
}

export function canExerciseProductMarketingAuthority(action: ProductMarketingAction, context: ProductMarketingAuthorityContext): boolean {
  return evaluateProductMarketingAuthority(action, context).allowed;
}

/** Filters with backend-issued product scope; navigation alone never supplies IDs. */
export function filterProductsByCanonicalAuthority(context: ProductMarketingAuthorityContext, products: Product[]): Product[] {
  if (!canExerciseProductMarketingAuthority("VIEW_PRODUCT_LIST", context)) return [];
  const scope = activeScope(context);
  if (!scope) return [];
  return products.filter(product => evaluateProductMarketingAuthority("VIEW_PRODUCT", { ...context, product }).allowed);
}
