import { describe, expect, it, vi } from "vitest";
import { buildAuthoritativeAuditEvent, persistAuthoritativeAuditEvent } from "./auditEventService";

const actor = { id: "REP_A", name: "Representative A", role: "Medical Representative" };
const validPayload = {
  action: "Physician Visit Completed",
  entityType: "PhysicianVisit",
  entityName: "Physician Visit",
  entityId: "VISIT_A",
  details: "Completed an authorized physician visit.",
};

describe("trusted audit contract", () => {
  it("rejects missing entityType before requesting a Firestore write", async () => {
    const collection = vi.fn();
    await expect(persistAuthoritativeAuditEvent({ collection } as never, { ...validPayload, entityType: undefined }, actor))
      .rejects.toThrow("INVALID_AUDIT_EVENT_PAYLOAD");
    expect(collection).not.toHaveBeenCalled();
  });

  it("rejects missing entityName before requesting a Firestore write", () => {
    expect(() => buildAuthoritativeAuditEvent({ ...validPayload, entityName: "" }, actor))
      .toThrow("INVALID_AUDIT_EVENT_PAYLOAD");
  });

  it("persists valid canonical metadata without undefined fields", async () => {
    const create = vi.fn().mockResolvedValue(undefined);
    const doc = vi.fn(() => ({ create }));
    const collection = vi.fn(() => ({ doc }));
    const result = await persistAuthoritativeAuditEvent({ collection } as never, validPayload, actor);
    expect(collection).toHaveBeenCalledWith("auditLogs");
    expect(create).toHaveBeenCalledWith(result);
    expect(result).toMatchObject(validPayload);
    expect(Object.values(result)).not.toContain(undefined);
  });
});
