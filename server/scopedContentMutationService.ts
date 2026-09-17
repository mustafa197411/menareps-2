import type { Firestore } from "firebase-admin/firestore";
import { Role } from "../src/types";
import { isCanonicalPermissionApplicable } from "../src/lib/canonicalPermissionApplicability";
import { createFirestoreOperationalScopeRepository, resolveOperationalScopeForActor, type OperationalScopeRepository } from "./operationalScopeRepository";
import { getFirebaseAdminServices } from "./firebaseAdmin";

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const id = (value: string) => /^[A-Za-z0-9_-]{1,128}$/.test(value);
export class ScopedContentMutationError extends Error { constructor(public code: string, public status = 400) { super(code); } }
export type ScopedContentCommand = { domain: "CAMPAIGN" | "ACTIVITY" | "PROMOTION_GROUP"; operation: "UPSERT" | "DELETE"; id: string; payload?: Record<string, unknown> };
export function parseScopedContentMutation(value: unknown): ScopedContentCommand | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>, domain = r.domain, operation = r.operation, targetId = text(r.id);
  if (!["CAMPAIGN", "ACTIVITY", "PROMOTION_GROUP"].includes(String(domain)) || !["UPSERT", "DELETE"].includes(String(operation)) || !id(targetId)) return null;
  if (operation === "UPSERT" && (!r.payload || typeof r.payload !== "object" || Array.isArray(r.payload))) return null;
  return { domain: domain as ScopedContentCommand["domain"], operation: operation as ScopedContentCommand["operation"], id: targetId, ...(operation === "UPSERT" ? { payload: r.payload as Record<string, unknown> } : {}) };
}
export async function executeScopedContentMutation(actorUid: string, command: ScopedContentCommand, deps: { db?: Firestore; scopeRepository?: OperationalScopeRepository } = {}) {
  const db = deps.db || getFirebaseAdminServices().db, actorSnap = await db.collection("users").doc(actorUid).get(), actor = actorSnap.data() || {}, role = text(actor.role);
  if (!actorSnap.exists || actor.active === false || actor.loginAllowed === false) throw new ScopedContentMutationError("CONTENT_ACTOR_DENIED", 403);
  const admin = role === Role.SUPER_ADMIN || role === Role.ADMIN;
  const applicability = command.domain === "PROMOTION_GROUP" ? "PROMOTION_GROUP_MANAGE" : "MARKETING_CONTENT_MANAGE";
  if (!isCanonicalPermissionApplicable(role, applicability)) throw new ScopedContentMutationError("CONTENT_ROLE_DENIED", 403);
  const collectionName = command.domain === "CAMPAIGN" ? "marketingCampaigns" : command.domain === "ACTIVITY" ? "marketingActivities" : "productPromotionGroups";
  const ref = db.collection(collectionName).doc(command.id), existing = await ref.get();
  if (!admin) {
    const scope = await resolveOperationalScopeForActor(actorUid, {}, deps.scopeRepository || createFirestoreOperationalScopeRepository());
    if (!scope.authorized || scope.queryPlan.denyAll) throw new ScopedContentMutationError("CONTENT_SCOPE_DENIED", 403);
    if (command.domain === "PROMOTION_GROUP") {
      if (!existing.exists || !scope.productGroupIds.includes(command.id)) throw new ScopedContentMutationError("CONTENT_SCOPE_DENIED", 403);
    } else {
      const brand = text(command.payload?.brand || existing.data()?.brand);
      if (!brand) throw new ScopedContentMutationError("CONTENT_PRODUCT_CONTEXT_REQUIRED", 403);
      const products = await db.collection("products").where("brand", "==", brand).get();
      if (!products.docs.some(product => product.data()?.active !== false && scope.productIds.includes(product.id))) throw new ScopedContentMutationError("CONTENT_SCOPE_DENIED", 403);
    }
  }
  if (command.operation === "DELETE") { if (!admin) throw new ScopedContentMutationError("CONTENT_DELETE_DENIED", 403); await ref.delete(); }
  else await ref.set({ ...command.payload, id: command.id, updatedAt: new Date().toISOString(), updatedBy: actorUid }, { merge: true });
  return { success: true, id: command.id };
}
