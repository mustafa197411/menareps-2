import type { Firestore } from "firebase-admin/firestore";
import { Role } from "../src/types";
import { getFirebaseAdminServices } from "./firebaseAdmin";
import { createFirestoreOperationalScopeRepository, resolveOperationalScopeForActor, type OperationalScopeRepository } from "./operationalScopeRepository";

const MANAGERS = new Set<string>([
  Role.SUPER_ADMIN, Role.ADMIN, Role.PRODUCT_MANAGER, Role.MARKETING_MANAGER,
  Role.MARKETING_OFFICER, Role.SALES_MARKETING_MANAGER,
]);

export function canMutateScopedKeyMessage(
  role: string,
  scope: { authorized: boolean; queryPlan: { denyAll: boolean }; productIds: string[]; productGroupIds: string[] },
  product: { id: string; promotionGroupId?: string; active?: boolean },
): boolean {
  return MANAGERS.has(role) && scope.authorized && !scope.queryPlan.denyAll && product.active !== false &&
    scope.productIds.includes(product.id) && Boolean(product.promotionGroupId) && scope.productGroupIds.includes(String(product.promotionGroupId));
}

export class KeyMessageMutationError extends Error {
  constructor(public code: string, public status: number) { super(code); }
}

export type KeyMessageMutationCommand = {
  operation: "UPSERT" | "SOFT_DELETE";
  messageId: string;
  payload?: Record<string, unknown>;
};

export function parseKeyMessageMutation(value: unknown): KeyMessageMutationCommand | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const operation = input.operation;
  const messageId = typeof input.messageId === "string" ? input.messageId.trim() : "";
  if ((operation !== "UPSERT" && operation !== "SOFT_DELETE") || !messageId || messageId.length > 128 || !/^[A-Za-z0-9_-]+$/.test(messageId)) return null;
  if (operation === "UPSERT" && (!input.payload || typeof input.payload !== "object" || Array.isArray(input.payload))) return null;
  return { operation, messageId, ...(operation === "UPSERT" ? { payload: input.payload as Record<string, unknown> } : {}) };
}

export async function executeKeyMessageMutation(
  actorUid: string,
  command: KeyMessageMutationCommand,
  dependencies: { db?: Firestore; operationalScopeRepository?: OperationalScopeRepository } = {},
) {
  const db = dependencies.db || getFirebaseAdminServices().db;
  const actorSnap = await db.collection("users").doc(actorUid).get();
  if (!actorSnap.exists || actorSnap.data()?.active === false || !MANAGERS.has(String(actorSnap.data()?.role || ""))) throw new KeyMessageMutationError("KEY_MESSAGE_ROLE_DENIED", 403);
  const scope = await resolveOperationalScopeForActor(actorUid, {}, dependencies.operationalScopeRepository || createFirestoreOperationalScopeRepository());
  if (!scope.authorized || scope.queryPlan.denyAll) throw new KeyMessageMutationError(scope.code || "KEY_MESSAGE_SCOPE_DENIED", 403);
  const ref = db.collection("keyMessages").doc(command.messageId);
  const existing = await ref.get();
  if (command.operation === "SOFT_DELETE") {
    if (!existing.exists) throw new KeyMessageMutationError("KEY_MESSAGE_NOT_FOUND", 404);
    const data = existing.data() || {};
    if (!scope.productIds.includes(String(data.productId || "")) || !scope.productGroupIds.includes(String(data.promotionGroupId || ""))) throw new KeyMessageMutationError("KEY_MESSAGE_SCOPE_DENIED", 403);
    await ref.set({ isDeleted: true, updatedAt: new Date().toISOString(), updatedBy: actorUid }, { merge: true });
    return { success: true, messageId: command.messageId };
  }
  const payload = command.payload || {};
  const productId = String(payload.productId || "").trim();
  const promotionGroupId = String(payload.promotionGroupId || "").trim();
  if (!productId || !promotionGroupId || !scope.productIds.includes(productId) || !scope.productGroupIds.includes(promotionGroupId)) throw new KeyMessageMutationError("KEY_MESSAGE_SCOPE_DENIED", 403);
  const productSnap = await db.collection("products").doc(productId).get();
  const product = productSnap.data() || {};
  if (!productSnap.exists || String(product.promotionGroupId || "") !== promotionGroupId ||
    !canMutateScopedKeyMessage(String(actorSnap.data()?.role || ""), scope, { id: productId, promotionGroupId, active: product.active })) {
    throw new KeyMessageMutationError("KEY_MESSAGE_PRODUCT_INVALID", 403);
  }
  await ref.set({ ...payload, id: command.messageId, productId, promotionGroupId, updatedBy: actorUid }, { merge: true });
  return { success: true, messageId: command.messageId };
}
