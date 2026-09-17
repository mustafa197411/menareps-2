import { normalizeRole, type Permissions, type User, type Role } from "../types";
import { CRM_MODULE_PERMISSIONS, hasPermission } from "./userPolicyEngine";

export type CollectionAction = "view" | "create" | "edit" | "approve" | "reject" | "reverse";
export type CollectionRestrictions = Partial<Record<CollectionAction, boolean>> & { active?: boolean };
/** Baseline is the ceiling; no administrative bypass or inferred reversal grant. */
export function permitsCollection(role: string, action: CollectionAction, restrictions: CollectionRestrictions = {}): boolean {
  if (action === "reverse") {
    return hasPermission({ role: normalizeRole(role) as Role } as User, "Collections", action, restrictions as Permissions);
  }
  const baseline = CRM_MODULE_PERMISSIONS[normalizeRole(role) as Role]?.Collections;
  return baseline?.[action] === true && restrictions.active !== false && restrictions[action] !== false;
}
