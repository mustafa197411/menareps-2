import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";

const { getFirebaseAdminServices } = vi.hoisted(() => ({
  getFirebaseAdminServices: vi.fn(),
}));
vi.mock("./firebaseAdmin", () => ({ getFirebaseAdminServices }));

import { createFirestoreWorkflowQueueScopeRepository } from "./workflowQueueScopeRepository";

function dbFixture() {
  const records: Record<string, Array<{ id: string; data: Record<string, unknown> }>> = {
    countries: [{ id: "C1", data: { name: "Libya", active: true } }], districts: [], cities: [], areas: [],
  };
  return {
    collection: vi.fn((name: string) => ({
      doc: (id: string) => ({ get: async () => ({ exists: id === "OPS1", id, data: () => ({ role: "Order Operations Officer" }) }) }),
      get: async () => ({ docs: (records[name] || []).map((entry) => ({ id: entry.id, data: () => entry.data })) }),
    })),
  };
}

describe("WP5.2G.1 workflow queue repository and isolation", () => {
  it("37. repository reads actor and geography without duplicating WP5.2E resolution", async () => {
    getFirebaseAdminServices.mockReturnValue({ db: dbFixture() });
    const repository = createFirestoreWorkflowQueueScopeRepository();
    expect((await repository.getActor("OPS1"))?.role).toBe("Order Operations Officer");
    expect((await repository.getGeographyCatalog()).countries[0].id).toBe("C1");
  });
  it("38. foundation contains no whole orders collection scan", () => {
    const source = fs.readFileSync(new URL("./workflowQueueScopeRepository.ts", import.meta.url), "utf8") + fs.readFileSync(new URL("./workflowQueueScopeService.ts", import.meta.url), "utf8");
    expect(source).not.toContain('collection("orders")');
  });
  it("39. foundation introduces no production write, schema, or rules workaround", () => {
    const source = fs.readFileSync(new URL("./workflowQueueScopeRepository.ts", import.meta.url), "utf8") + fs.readFileSync(new URL("./workflowQueueScopeService.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/\.set\(|\.update\(|batch\.(set|update|delete)\(|bulkWriter|runTransaction/);
  });
  it("40. foundation contains no UID special case", () => {
    const source = fs.readFileSync(new URL("./workflowQueueScopeService.ts", import.meta.url), "utf8");
    expect(source).not.toContain('=== "OPS1"');
  });
});
