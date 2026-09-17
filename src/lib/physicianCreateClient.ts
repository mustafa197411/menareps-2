import type { User as FirebaseUser } from "firebase/auth";
import type { Physician } from "../types";

export async function createPhysicianAuthoritatively(user: FirebaseUser | null, idempotencyKey: string, physician: Omit<Physician, "id">) {
  if (!user) throw new Error("AUTHENTICATION_REQUIRED");
  const token = await user.getIdToken();
  const response = await fetch("/api/physicians/create", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ idempotencyKey, physician }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.code || "PHYSICIAN_CREATE_FAILED");
  return body as { status: "CREATED" | "IDEMPOTENT_REPLAY"; physician: Physician } | { status: "DUPLICATE_CANDIDATES"; candidates: Physician[] };
}
