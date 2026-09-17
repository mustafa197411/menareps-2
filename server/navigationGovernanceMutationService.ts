import type { Firestore } from "firebase-admin/firestore";
import { CANONICAL_USER_ROLES, Role } from "../src/types";
import {
  validateNavigationRestrictions,
  type NavigationRestrictions,
} from "../src/lib/navigationRestrictionPolicy";
import { getFirebaseAdminServices } from "./firebaseAdmin";

const NAVIGATION_ADMINS = new Set<string>([Role.SUPER_ADMIN, Role.ADMIN]);

export type NavigationGovernanceMutation =
  | { operation: "SAVE"; role: Role; restrictions: NavigationRestrictions }
  | { operation: "RESET"; role: Role };

export class NavigationGovernanceMutationError extends Error {
  constructor(public code: string, public status: number) { super(code); }
}

export function parseNavigationGovernanceMutation(value: unknown): NavigationGovernanceMutation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const operation = input.operation;
  const role = input.role;
  if ((operation !== "SAVE" && operation !== "RESET") || typeof role !== "string" || !CANONICAL_USER_ROLES.includes(role as Role)) return null;
  if (operation === "RESET") return { operation, role: role as Role };
  const restrictions = validateNavigationRestrictions(input.restrictions);
  return restrictions ? { operation, role: role as Role, restrictions } : null;
}

export async function executeNavigationGovernanceMutation(
  actorUid: string,
  command: NavigationGovernanceMutation,
  db: Firestore = getFirebaseAdminServices().db,
) {
  const actorSnapshot = await db.collection("users").doc(actorUid).get();
  const actor = actorSnapshot.data();
  if (!actorSnapshot.exists || actor?.active === false || !NAVIGATION_ADMINS.has(String(actor?.role || ""))) {
    throw new NavigationGovernanceMutationError("NAVIGATION_GOVERNANCE_ROLE_DENIED", 403);
  }
  const reference = db.collection("accessGovernance").doc(command.role);
  await db.runTransaction(async transaction => {
    const current = await transaction.get(reference);
    const existing = current.data() || {};
    const navigationRestrictions = command.operation === "RESET"
      ? { hiddenModules: [], hiddenViews: [] }
      : command.restrictions;
    transaction.set(reference, {
      ...existing,
      role: command.role,
      navigationRestrictions,
      updatedAt: new Date().toISOString(),
      updatedBy: actorUid,
    }, { merge: true });
  });
  return {
    success: true,
    role: command.role,
    restrictions: command.operation === "RESET" ? { hiddenModules: [], hiddenViews: [] } : command.restrictions,
  };
}
