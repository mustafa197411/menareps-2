export type ConfigurationDomain = "MARKET" | "BUSINESS_CALENDAR" | "CALENDAR" | "ATTENDANCE_POLICY" | "ACCESS_NAVIGATION" | "CAPABILITY" | "DATA_SCOPE" | "ORDER_WORKFLOW";
export interface ConfigurationAuditEvent { eventId: string; domain: ConfigurationDomain; entityId: string; action: "CREATE" | "UPDATE" | "ACTIVATE" | "DEACTIVATE"; actorUid: string; actorRole: string; occurredAt: string; before: Record<string, unknown> | null; after: Record<string, unknown>; changedFields: string[] }

export function createConfigurationAuditEvent(input: Omit<ConfigurationAuditEvent, "eventId" | "changedFields">): ConfigurationAuditEvent {
  if (!input.actorUid.trim() || !input.entityId.trim() || !Number.isFinite(Date.parse(input.occurredAt))) throw new Error("INVALID_CONFIGURATION_AUDIT_EVENT");
  const keys = new Set([...Object.keys(input.before || {}), ...Object.keys(input.after)]);
  const changedFields = [...keys].filter(key => JSON.stringify(input.before?.[key]) !== JSON.stringify(input.after[key])).sort();
  if (changedFields.length === 0) throw new Error("EMPTY_CONFIGURATION_CHANGE");
  return { ...input, eventId: `${input.domain}::${input.entityId}::${input.occurredAt}::${input.actorUid}`, changedFields };
}
