import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import type { Physician } from "../src/types";
import { removeUndefinedRecursively } from "../src/utils/importNormalization";
import { isCanonicalUserActive } from "../src/lib/visitMarketingRequestPolicy";
import { isCanonicalPermissionApplicable } from "../src/lib/canonicalPermissionApplicability";
import { createFirestoreOperationalScopeRepository, resolveOperationalScopeForActor, type OperationalScopeRepository } from "./operationalScopeRepository";

export type PhysicianCreateOutcome =
  | { status: "CREATED" | "IDEMPOTENT_REPLAY"; physician: Physician }
  | { status: "DUPLICATE_CANDIDATES"; candidates: Physician[] };
export class PhysicianCreateError extends Error { constructor(public code: string, public status = 400) { super(code); } }
const text = (v: unknown) => typeof v === "string" ? v.trim() : "";
const normalizeName = (v: unknown) => text(v).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const normalizePhone = (v: unknown) => text(v).replace(/\D/g, "");
const normalizeEmail = (v: unknown) => text(v).toLowerCase();
const normalizeText = (v: unknown) => normalizeName(v);
const digest = (v: string) => createHash("sha256").update(v).digest("hex");

export function parsePhysicianCreateRequest(value: unknown): { idempotencyKey: string; physician: Omit<Physician, "id"> } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as any, physician = row.physician;
  const idempotencyKey = text(row.idempotencyKey);
  if (!idempotencyKey || idempotencyKey.length > 128 || !physician || typeof physician !== "object") return null;
  if (!text(physician.name) || !text(physician.areaId) || !text(physician.specialty) || !text(physician.address) || !text(physician.countryId) || !text(physician.districtId) || !text(physician.cityId)) return null;
  return { idempotencyKey, physician };
}

export function duplicatePhysicianCandidates(input: Omit<Physician, "id">, rows: Physician[]): Physician[] {
  const name = normalizeName(input.name), areaId = text(input.areaId);
  return rows.filter(row => {
    if (normalizeName(row.name) !== name || text(row.areaId) !== areaId) return false;
    const comparable = [
      [normalizeText(input.clinic), normalizeText(row.clinic)], [normalizePhone(input.phone), normalizePhone(row.phone)],
      [normalizeEmail(input.email), normalizeEmail(row.email)], [text(input.specialtyId || input.specialty), text(row.specialtyId || row.specialty)],
    ].filter(([a, b]) => Boolean(a && b));
    return comparable.some(([a, b]) => a === b);
  });
}

export async function executePhysicianCreate(actorUid: string, command: { idempotencyKey: string; physician: Omit<Physician, "id"> }, db: Firestore, scopeRepository?: OperationalScopeRepository): Promise<PhysicianCreateOutcome> {
  const actorSnap = await db.collection("users").doc(actorUid).get();
  if (!actorSnap.exists || !isCanonicalUserActive(actorSnap.data() as any)) throw new PhysicianCreateError("AUTHORIZATION_DENIED", 403);
  const role = text(actorSnap.data()?.role);
  if (!isCanonicalPermissionApplicable(role, "PHYSICIAN_CREATE")) throw new PhysicianCreateError("AUTHORIZATION_DENIED", 403);
  const permissionSnap = await db.collection("rolePermissions").doc(role).get();
  if (!permissionSnap.exists || permissionSnap.data()?.create !== true) throw new PhysicianCreateError("AUTHORIZATION_DENIED", 403);
  if (!["Super Admin", "Admin"].includes(role)) {
    const scope = await resolveOperationalScopeForActor(actorUid, { actorUid }, scopeRepository || createFirestoreOperationalScopeRepository());
    if (!scope.authorized || !scope.areaIds.includes(text(command.physician.areaId))) throw new PhysicianCreateError("PHYSICIAN_CREATE_SCOPE_DENIED", 403);
  }
  const normalizedName = normalizeName(command.physician.name);
  if (!normalizedName) throw new PhysicianCreateError("VALIDATION_FAILED");
  const operationId = `PC-${digest(`${actorUid}|${command.idempotencyKey}`).slice(0, 32)}`;
  const physicianId = `PHY-${digest(operationId).slice(0, 12).toUpperCase()}`;
  const operationRef = db.collection("physicianCreationOperations").doc(operationId);
  const physicianRef = db.collection("physicians").doc(physicianId);
  const commandHash = digest(JSON.stringify({ ...command.physician, name: normalizedName }));
  return db.runTransaction(async tx => {
    const prior = await tx.get(operationRef);
    if (prior.exists) {
      if (prior.data()?.commandHash !== commandHash) throw new PhysicianCreateError("IDEMPOTENCY_CONFLICT", 409);
      const committed = await tx.get(db.collection("physicians").doc(text(prior.data()?.physicianId)));
      if (!committed.exists) throw new PhysicianCreateError("TRANSIENT_FAILURE", 503);
      return { status: "IDEMPOTENT_REPLAY", physician: { id: committed.id, ...committed.data() } as Physician };
    }
    // Legacy physician records predate normalizedName. Evaluate the canonical
    // collection in memory so the first protected create can still identify a
    // legacy candidate without a migration or a new composite index.
    const candidatesSnap = await tx.get(db.collection("physicians"));
    const candidates = duplicatePhysicianCandidates(command.physician, candidatesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Physician)));
    if (candidates.length) return { status: "DUPLICATE_CANDIDATES", candidates };
    const now = new Date().toISOString();
    const physician = removeUndefinedRecursively({ ...command.physician, id: physicianId, normalizedName, latitude: null, longitude: null, gpsVerified: false, gpsVerificationStatus: "UNVERIFIED", createdAt: now, createdBy: actorUid, updatedAt: now, updatedBy: actorUid }) as Physician;
    tx.create(physicianRef, physician);
    tx.create(operationRef, { id: operationId, actorUid, idempotencyKey: command.idempotencyKey, commandHash, physicianId, createdAt: now });
    tx.create(db.collection("auditLogs").doc(`AUD-${operationId}`), { id: `AUD-${operationId}`, userId: actorUid, userRole: role, action: "Physician Created", entityType: "Physician", entityId: physicianId, timestamp: now, createdAt: now, createdBy: actorUid });
    return { status: "CREATED", physician };
  });
}
