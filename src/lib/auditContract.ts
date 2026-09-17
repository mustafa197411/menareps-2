export const INVALID_AUDIT_EVENT_PAYLOAD = "INVALID_AUDIT_EVENT_PAYLOAD";

export interface CanonicalAuditMetadata {
  action: string;
  entityType: string;
  entityName: string;
  entityId?: string;
  details: string;
}

const auditText = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

export function requireCanonicalAuditMetadata(payload: Record<string, unknown>): CanonicalAuditMetadata {
  const action = auditText(payload.action, 160);
  const entityType = auditText(payload.entityType, 160);
  const entityName = auditText(payload.entityName, 300);
  const entityId = auditText(payload.entityId, 300);
  const details = auditText(payload.details, 4000);

  if (!action || !entityType || !entityName || !details) {
    throw new Error(INVALID_AUDIT_EVENT_PAYLOAD);
  }

  return {
    action,
    entityType,
    entityName,
    ...(entityId ? { entityId } : {}),
    details,
  };
}
