import { CANONICAL_USER_ROLES, Role, normalizeRole } from "../types";
import type { ProductMarketingAction } from "./productMarketingAuthority";

const KEY_MESSAGE_MANAGERS = new Set<Role>([
  Role.SUPER_ADMIN, Role.ADMIN, Role.MARKETING_OFFICER, Role.PRODUCT_MANAGER,
  Role.SALES_MARKETING_MANAGER, Role.MARKETING_MANAGER,
]);
const MARKETING_CONTENT_MANAGERS = new Set<Role>(KEY_MESSAGE_MANAGERS);
const MARKETING_SETTINGS_MANAGERS = new Set<Role>([
  Role.SUPER_ADMIN, Role.ADMIN, Role.PRODUCT_MANAGER,
  Role.MARKETING_MANAGER, Role.SALES_MARKETING_MANAGER,
]);
const PROMOTION_GROUP_MANAGERS = new Set<Role>([
  Role.SUPER_ADMIN, Role.ADMIN, Role.PRODUCT_MANAGER,
]);
const PHYSICIAN_ALIGNMENT_MANAGERS = new Set<Role>([
  Role.SUPER_ADMIN, Role.ADMIN, Role.MEDICAL_MANAGER, Role.PRODUCT_MANAGER,
]);

/** Canonical role envelope only; record/module/scope checks remain mandatory. */
export function isProductMarketingRoleApplicable(action: ProductMarketingAction, roleInput: string | Role): boolean {
  const normalized = normalizeRole(String(roleInput));
  if (!CANONICAL_USER_ROLES.includes(normalized as Role)) return false;
  const role = normalized as Role;
  if (action === "MANAGE_PROMOTION_GROUP") return PROMOTION_GROUP_MANAGERS.has(role);
  if (action === "MANAGE_KEY_MESSAGES") return KEY_MESSAGE_MANAGERS.has(role);
  if (action === "MANAGE_MARKETING_CONTENT") return MARKETING_CONTENT_MANAGERS.has(role);
  if (action === "MANAGE_MARKETING_SETTINGS") return MARKETING_SETTINGS_MANAGERS.has(role);
  if (action === "MANAGE_PHYSICIAN_ALIGNMENT") return PHYSICIAN_ALIGNMENT_MANAGERS.has(role);
  return true;
}
