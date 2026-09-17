import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createOrderWorkflowDetailReadController, fetchOrderWorkflowDetail } from "./orderWorkflowDetailReadClient";

const detail = { kind: "AUTHORITATIVE_ORDER_OPERATIONS_DETAIL" as const, orderId: "O1", displayNumber: "SO1", version: "1:2", currentStatus: "FINANCE_APPROVED" as const, stage: "OPERATIONS_REVIEW", pharmacyId: "P1", pharmacyName: "Pharmacy", areaId: "A1", countryId: "C1", creatorUid: "REP1", representativeName: "Rep", orderDate: "2026-08-01", items: [], total: 10, financePrerequisite: { approved: true as const, approvedAt: "T", approvedByUid: "FIN", approvedByName: "Finance" }, history: [] };
const user = { getIdToken: vi.fn(async () => "SECRET_TOKEN") };

describe("WP5.2F.6B.0D detail client", () => {
  it("35. malformed response fails closed", async () => await expect(fetchOrderWorkflowDetail(user, "O1", vi.fn(async () => ({ json: async () => ({ authorized: true }) })) as any)).rejects.toThrow("Malformed"));
  it("36. sends bearer token", async () => { const fetcher = vi.fn(async () => ({ json: async () => ({ authorized: true, detail }) })); await fetchOrderWorkflowDetail(user, "O1", fetcher as any); expect(fetcher.mock.calls[0][1].headers.Authorization).toBe("Bearer SECRET_TOKEN"); });
  it("37. token is not logged or persisted", () => { const source = fs.readFileSync(new URL("./orderWorkflowDetailReadClient.ts", import.meta.url), "utf8"); expect(source).not.toMatch(/console\.|localStorage|sessionStorage/); });
  it("38. selection change clears old detail immediately", async () => { let resolveSecond!: (value: any) => void; const controller = createOrderWorkflowDetailReadController((_u, id) => id === "O1" ? Promise.resolve({ authorized: true, detail }) : new Promise((resolve) => { resolveSecond = resolve; })); await controller.load("UID", "O1", user); const pending = controller.load("UID", "O2", user); expect(controller.getState()).toMatchObject({ status: "LOADING", orderId: "O2", detail: null }); resolveSecond({ authorized: true, detail: { ...detail, orderId: "O2" } }); await pending; });
  it("39. UID change clears prior detail", async () => { const controller = createOrderWorkflowDetailReadController(async () => ({ authorized: true, detail })); await controller.load("UID1", "O1", user); const pending = controller.load("UID2", "O2", user); expect(controller.getState()).toMatchObject({ actorUid: "UID2", detail: null }); await pending; });
  it("40. logout clear removes detail", async () => { const controller = createOrderWorkflowDetailReadController(async () => ({ authorized: true, detail })); await controller.load("UID", "O1", user); controller.clear(); expect(controller.getState()).toMatchObject({ status: "UNINITIALIZED", detail: null }); });
  it("41. stale in-flight response cannot overwrite newer selection", async () => { let resolveOld!: (value: any) => void; const controller = createOrderWorkflowDetailReadController((_u, id) => id === "O1" ? new Promise((resolve) => { resolveOld = resolve; }) : Promise.resolve({ authorized: true, detail: { ...detail, orderId: "O2" } })); const old = controller.load("UID", "O1", user); await controller.load("UID", "O2", user); resolveOld({ authorized: true, detail }); await old; expect(controller.getState().orderId).toBe("O2"); });
  it("42. detail client has no saveOrder mutation dependency", () => expect(fs.readFileSync(new URL("./orderWorkflowDetailReadClient.ts", import.meta.url), "utf8")).not.toContain("saveOrder"));
});

it("rejects malformed transported market context", async () => {
  const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ authorized: true, detail: { ...detail, marketContext: { status: "RESOLVED", market: {} } } }) })) as any;
  await expect(fetchOrderWorkflowDetail({ getIdToken: async () => "token" }, "O1", fetcher)).rejects.toThrow("Malformed order-workflow-detail response");
});
