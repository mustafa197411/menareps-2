import { randomUUID } from "crypto";
import { requireCanonicalAuditMetadata } from "../src/lib/auditContract";

const text = (value: unknown, max = 2000) => typeof value === "string" ? value.trim().slice(0, max) : "";

export function buildAuthoritativeAuditEvent(
  payload: Record<string, unknown>,
  actor: { id: string; name?: string; email?: string; role: string },
  now = new Date(),
  idFactory = () => `AUD-${randomUUID()}`,
) {
  const metadata = requireCanonicalAuditMetadata(payload);
  const timestamp = now.toISOString();
  return {
    id: idFactory(),
    userId: actor.id,
    userName: text(actor.name || actor.email, 200),
    userRole: actor.role,
    ...metadata,
    timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    createdBy: actor.id,
    updatedBy: actor.id,
  };
}

export async function persistAuthoritativeAuditEvent(
  db: { collection: (name: string) => { doc: (id: string) => { create: (value: Record<string, unknown>) => Promise<unknown> } } },
  payload: Record<string, unknown>,
  actor: { id: string; name?: string; email?: string; role: string },
) {
  // Build and validate before obtaining a document write operation.
  const event = buildAuthoritativeAuditEvent(payload, actor);
  await db.collection("auditLogs").doc(event.id).create(event);
  return event;
}
