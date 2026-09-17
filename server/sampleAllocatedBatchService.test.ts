import { describe, expect, it } from "vitest";
import { parseAllocatedBatchRequest, resolveAllocatedBatchesForRepresentative, type AllocatedBatchRepository } from "./sampleAllocatedBatchService";

function repository(overrides: Partial<Record<string, Record<string, any> | null>> = {}): AllocatedBatchRepository {
  const records: Record<string, Record<string, any> | null> = {
    actor: { id: "rep1", role: "Medical Representative", active: true, loginAllowed: true, isDeleted: false },
    "allocation:own": { id: "own", repId: "rep1", sampleSkuId: "SKU-1", batchId: "BATCH-1", status: "ACTIVE" },
    "allocation:other": { id: "other", repId: "rep2", sampleSkuId: "SKU-1", batchId: "BATCH-2", status: "ACTIVE" },
    "batch:BATCH-1": { id: "BATCH-1", sampleSkuId: "SKU-1", status: "AVAILABLE", expiryDate: "2027-01-01", availableQuantity: 10 },
    "batch:BATCH-2": { id: "BATCH-2", sampleSkuId: "SKU-1", status: "AVAILABLE", expiryDate: "2027-01-01", availableQuantity: 10 },
    ...overrides,
  };
  return {
    getUser: async () => records.actor,
    getAllocation: async id => records[`allocation:${id}`],
    getBatch: async id => records[`batch:${id}`],
  };
}

describe("WP76F allocated Sample batch resolver", () => {
  it("returns only the exact batch referenced by an owned active allocation", async () => {
    await expect(resolveAllocatedBatchesForRepresentative("rep1", ["own"], repository())).resolves.toMatchObject({ success: true, batches: [{ id: "BATCH-1" }] });
  });

  it("rejects an allocation owned by another representative", async () => {
    await expect(resolveAllocatedBatchesForRepresentative("rep1", ["other"], repository())).resolves.toEqual({ success: false, code: "ALLOCATION_NOT_AUTHORIZED" });
  });

  it("rejects inactive allocations and inactive actors", async () => {
    await expect(resolveAllocatedBatchesForRepresentative("rep1", ["own"], repository({ "allocation:own": { repId: "rep1", batchId: "BATCH-1", status: "DEPLETED" } }))).resolves.toEqual({ success: false, code: "ALLOCATION_NOT_AUTHORIZED" });
    await expect(resolveAllocatedBatchesForRepresentative("rep1", ["own"], repository({ actor: { role: "Medical Representative", active: false, loginAllowed: true } }))).resolves.toEqual({ success: false, code: "ACTOR_NOT_AUTHORIZED" });
  });

  it("bounds and validates allocation IDs", () => {
    expect(parseAllocatedBatchRequest({ allocationIds: ["own", "own"] })).toEqual({ allocationIds: ["own"] });
    expect(parseAllocatedBatchRequest({ allocationIds: [] })).toBeNull();
    expect(parseAllocatedBatchRequest({ allocationIds: ["own"], extra: true })).toBeNull();
  });
});
