import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  executeOrderOperationsTransition,
  parseOrderOperationsTransitionRequest,
  type OperationsAction,
} from "./orderOperationsTransitionService";
import type { WorkflowQueueScopeRepository } from "./workflowQueueScopeRepository";
import type { OrderOperationsTransitionRepository } from "./orderOperationsTransitionRepository";

const baseRequest = {
  orderId: "O1", action: "OPERATIONS_APPROVE" as OperationsAction,
  expectedStatus: "FINANCE_APPROVED" as const, expectedVersion: "1:2",
};
const baseOrder: Record<string, any> = {
  id: "O1", status: "FINANCE_APPROVED", stage: "OPERATIONS_REVIEW", areaId: "A1",
  pharmacyId: "P1", createdByUid: "REP1", displayNumber: "SO-1",
  history: [{ transitionId: "OLD", action: "FINANCE_APPROVE" }],
  financeEvidence: "KEEP", paymentEvidence: "KEEP", warehouseInternal: "KEEP", deliveryGPS: "KEEP",
};

function scopeRepo(overrides: Record<string, any> = {}): WorkflowQueueScopeRepository {
  return {
    getActor: vi.fn(async () => ({ id: "OPS", role: "Order Operations Officer", active: true, loginAllowed: true, status: "Active", securityScope: "COUNTRY", country: "Libya", ...overrides })),
    getGeographyCatalog: vi.fn(async () => ({
      countries: [{ id: "C1", name: "Libya", active: true }],
      districts: [{ id: "D1", countryId: "C1", active: true }],
      cities: [{ id: "CT1", countryId: "C1", districtId: "D1", active: true }],
      areas: [{ id: "A1", countryId: "C1", districtId: "D1", cityId: "CT1", active: true }],
    })),
  };
}

function transactionRepo(options: { order?: Record<string, any> | null; version?: string; pharmacy?: Record<string, any> | null; fail?: boolean } = {}) {
  const writes: Array<{ patch: Record<string, any>; audit: Record<string, any> }> = [];
  const getPharmacy = vi.fn(async () => options.pharmacy === undefined ? { id: "P1", areaId: "A1" } : options.pharmacy);
  const repository: OrderOperationsTransitionRepository = {
    runTransaction: vi.fn(async (_orderId, operation) => {
      if (options.fail) throw new Error("repository failed");
      const selected = options.order === undefined ? baseOrder : options.order;
      return operation({
        order: selected ? { id: "O1", version: options.version || "1:2", data: { ...selected } } : null,
        getPharmacy,
        write: (patch, audit) => writes.push({ patch, audit }),
      });
    }),
  };
  return { repository, writes, getPharmacy };
}

async function execute(
  request: any = baseRequest,
  options: Parameters<typeof transactionRepo>[0] = {},
  actorOverrides: Record<string, any> = {},
) {
  const tx = transactionRepo(options);
  const result = await executeOrderOperationsTransition("OPS", request, {
    workflowScopeRepository: scopeRepo(actorOverrides), transitionRepository: tx.repository,
    now: () => "2026-08-11T10:00:00.000Z", auditId: () => "AUD1",
  });
  return { result, ...tx };
}

describe("WP5.2F.6B.0C authoritative Operations transition", () => {
  it("1. route requires Firebase authentication", () => expect(fs.readFileSync(new URL("../server.ts", import.meta.url), "utf8")).toContain('app.post("/api/orders/workflow/transition", requireFirebaseAuth'));
  it("2. wrong role denied before transaction", async () => { const { result, repository } = await execute(baseRequest, {}, { role: "Finance Officer" }); expect(result.success).toBe(false); expect(repository.runTransaction).not.toHaveBeenCalled(); });
  it("3. inactive actor denied", async () => expect((await execute(baseRequest, {}, { active: false })).result.code).toBe("ACTOR_INACTIVE"));
  it("4. missing order denied", async () => expect((await execute(baseRequest, { order: null })).result.code).toBe("ORDER_NOT_FOUND"));
  it("5. valid Operations actor accepted", async () => expect((await execute()).result.success).toBe(true));
  it("6. scope is resolved from the server repository", async () => expect((await execute()).repository.runTransaction).toHaveBeenCalledOnce());
  for (const [number, field, value] of [[7, "role", "Admin"], [8, "country", "Other"], [9, "areas", ["A2"]], [10, "statuses", ["OPERATIONS_APPROVED"]]] as const) {
    it(`${number}. client cannot inject ${field}`, () => expect(parseOrderOperationsTransitionRequest({ ...baseRequest, [field]: value })).toBeNull());
  }
  it("11. loads the current order inside repository transaction", async () => expect((await execute()).repository.runTransaction).toHaveBeenCalledWith("O1", expect.any(Function)));
  it("12. FINANCE_APPROVED is a valid source", async () => expect((await execute()).result.currentStatus).toBe("PENDING_STORE_PREPARATION"));
  it("13. PENDING_OPERATIONS_REVIEW is a valid source", async () => expect((await execute({ ...baseRequest, expectedStatus: "PENDING_OPERATIONS_REVIEW" }, { order: { ...baseOrder, status: "PENDING_OPERATIONS_REVIEW" } })).result.success).toBe(true));
  it("14. unauthorized current status denied", async () => expect((await execute(baseRequest, { order: { ...baseOrder, status: "OPERATIONS_APPROVED" } })).result.code).toBe("ORDER_STATUS_NOT_AUTHORIZED"));
  it("15. expected status mismatch is stale", async () => expect((await execute({ ...baseRequest, expectedStatus: "PENDING_OPERATIONS_REVIEW" })).result.code).toBe("STALE_ORDER_VERSION"));
  it("16. expected version mismatch is stale", async () => expect((await execute({ ...baseRequest, expectedVersion: "old" })).result.code).toBe("STALE_ORDER_VERSION"));
  it("17. stale transition performs zero writes", async () => expect((await execute({ ...baseRequest, expectedVersion: "old" })).writes).toHaveLength(0));
  it("18. canonical area accepted", async () => expect((await execute()).result.success).toBe(true));
  it("19. unauthorized area denied", async () => expect((await execute(baseRequest, { order: { ...baseOrder, areaId: "A2" } })).result.code).toBe("ORDER_GEOGRAPHY_DENIED"));
  it("20. missing geography uses bounded pharmacy", async () => { const { result, getPharmacy } = await execute(baseRequest, { order: { ...baseOrder, areaId: undefined } }); expect(result.success).toBe(true); expect(getPharmacy).toHaveBeenCalledWith("P1"); });
  it("21. unresolved geography denied", async () => expect((await execute(baseRequest, { order: { ...baseOrder, areaId: undefined }, pharmacy: null })).result.code).toBe("ORDER_GEOGRAPHY_UNRESOLVED"));
  it("22. ambiguous pharmacy geography denied", async () => expect((await execute(baseRequest, { order: { ...baseOrder, areaId: undefined }, pharmacy: { id: "P1" } })).result.code).toBe("ORDER_GEOGRAPHY_UNRESOLVED"));
  it("23. canonical creator UID drives segregation", async () => expect((await execute(baseRequest, { order: { ...baseOrder, createdByUid: "OPS" } })).result.code).toBe("SEGREGATION_OF_DUTIES_VIOLATION"));
  it("24. missing canonical creator identity fails closed", async () => expect((await execute(baseRequest, { order: { ...baseOrder, createdByUid: undefined } })).result.code).toBe("CREATOR_IDENTITY_UNRESOLVED"));
  it("25. creator segregation produces no write", async () => expect((await execute(baseRequest, { order: { ...baseOrder, createdByUid: "OPS" } })).writes).toHaveLength(0));
  const actionCases: Array<[number, OperationsAction, string, string | undefined]> = [
    [26, "OPERATIONS_APPROVE", "PENDING_STORE_PREPARATION", undefined],
    [27, "OPERATIONS_REJECT", "OPERATIONS_REJECTED", "reason"],
    [28, "OPERATIONS_RETURN_TO_FINANCE", "RETURNED_TO_FINANCE", "reason"],
    [29, "OPERATIONS_RETURN_TO_REP", "RETURNED_TO_REP_BY_OPERATIONS", "reason"],
  ];
  for (const [number, action, status, comments] of actionCases) it(`${number}. ${action} preserves engine behavior`, async () => expect((await execute({ ...baseRequest, action, ...(comments ? { comments } : {}) })).result.currentStatus).toBe(status));
  it("30. required comments preserved", async () => expect((await execute({ ...baseRequest, action: "OPERATIONS_REJECT" })).result.code).toBe("COMMENTS_REQUIRED"));
  it("31. invalid action denied", () => expect(parseOrderOperationsTransitionRequest({ ...baseRequest, action: "DELIVERY_COMPLETE" })).toBeNull());
  it("32. transition starts from persisted history", async () => expect((await execute()).writes[0].patch.history[0].transitionId).toBe("OLD"));
  it("33. history appended atomically", async () => expect((await execute()).writes[0].patch.history).toHaveLength(2));
  it("34. client cannot supply stale history", () => expect(parseOrderOperationsTransitionRequest({ ...baseRequest, history: [] })).toBeNull());
  it("35. actor UID is server-generated", async () => expect((await execute()).writes[0].audit.actorUid).toBe("OPS"));
  it("36. actor role is server-generated", async () => expect((await execute()).writes[0].audit.actorRole).toBe("Order Operations Officer"));
  it("37. audit timestamp is server-generated", async () => expect((await execute()).writes[0].audit.createdAt).toBe("2026-08-11T10:00:00.000Z"));
  for (const [number, field] of [[38, "financeEvidence"], [39, "paymentEvidence"], [40, "warehouseInternal"], [41, "deliveryGPS"]] as const) {
    it(`${number}. unrelated ${field} is not overwritten`, async () => expect((await execute()).writes[0].patch).not.toHaveProperty(field));
  }
  it("42. contains no broad orders scan", () => expect(fs.readFileSync(new URL("./orderOperationsTransitionRepository.ts", import.meta.url), "utf8")).not.toContain('collection("orders").get()'));
  it("43. contains no broad pharmacy scan", () => expect(fs.readFileSync(new URL("./orderOperationsTransitionRepository.ts", import.meta.url), "utf8")).not.toContain('collection("pharmacies").get()'));
  it("44. contains no broad users scan", () => expect(fs.readFileSync(new URL("./orderOperationsTransitionRepository.ts", import.meta.url), "utf8")).not.toContain('collection("users")'));
  it("45. has no frontend saveOrder dependency", () => expect(fs.readFileSync(new URL("./orderOperationsTransitionService.ts", import.meta.url), "utf8")).not.toContain("saveOrder"));
  it("46. has no queue DTO dependency", () => expect(fs.readFileSync(new URL("./orderOperationsTransitionService.ts", import.meta.url), "utf8")).not.toContain("QueueSummary"));
  it("47. writes only after complete authorization", async () => expect((await execute(baseRequest, { order: { ...baseOrder, areaId: "A2" } })).writes).toHaveLength(0));
  it("48. repository failures propagate", async () => await expect(execute(baseRequest, { fail: true })).rejects.toThrow("repository failed"));
  it("49. expected denials remain typed", async () => expect((await execute(baseRequest, { order: null })).result).toEqual({ success: false, code: "ORDER_NOT_FOUND" }));
  it("50. success response is sanitized", async () => { const result = (await execute()).result; expect(result).toEqual(expect.objectContaining({ success: true, orderId: "O1" })); expect(result).not.toHaveProperty("order"); expect(result).not.toHaveProperty("paymentEvidence"); });
});
