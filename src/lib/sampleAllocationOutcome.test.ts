import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { commitAllocationThenAudit, commitBulkAllocationsThenAudit } from "./sampleAllocationOutcome";

const allocationUiSource = readFileSync(new URL("../components/samples/SampleAllocation.tsx", import.meta.url), "utf8");

describe("sample allocation primary/audit outcome boundary", () => {
  it("reports a committed allocation when its audit succeeds", async () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    const audit = vi.fn().mockResolvedValue(undefined);
    await expect(commitAllocationThenAudit({ commit, audit })).resolves.toEqual({ committed: true, auditWarning: false });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledTimes(1);
  });

  it("keeps a committed allocation successful when its audit fails", async () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    const audit = vi.fn().mockRejectedValue(new Error("audit unavailable"));
    await expect(commitAllocationThenAudit({ commit, audit })).resolves.toEqual({ committed: true, auditWarning: true });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledTimes(1);
  });

  it("rejects a primary allocation failure and does not attempt audit", async () => {
    const commit = vi.fn().mockRejectedValue(new Error("allocation failed"));
    const audit = vi.fn();
    await expect(commitAllocationThenAudit({ commit, audit })).rejects.toThrow("allocation failed");
    expect(commit).toHaveBeenCalledTimes(1);
    expect(audit).not.toHaveBeenCalled();
  });

  it("never retries a committed allocation after audit failure", async () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    await commitAllocationThenAudit({ commit, audit: vi.fn().mockRejectedValue(new Error("audit failed")) });
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("keeps bulk committed and failed items distinct when summary audit fails", async () => {
    const calls: string[] = [];
    const result = await commitBulkAllocationsThenAudit({
      items: ["SKU-A", "SKU-B", "SKU-C"],
      commitItem: vi.fn(async item => { calls.push(item); if (item === "SKU-B") throw new Error("stock unavailable"); }),
      audit: vi.fn().mockRejectedValue(new Error("audit unavailable")),
    });
    expect(calls).toEqual(["SKU-A", "SKU-B", "SKU-C"]);
    expect(result.committedItems).toEqual(["SKU-A", "SKU-C"]);
    expect(result.failedItems.map(entry => entry.item)).toEqual(["SKU-B"]);
    expect(result.auditWarning).toBe(true);
  });

  it("does not audit or retry when every bulk primary operation fails", async () => {
    const commitItem = vi.fn().mockRejectedValue(new Error("primary failure"));
    const audit = vi.fn();
    const result = await commitBulkAllocationsThenAudit({ items: ["SKU-A", "SKU-B"], commitItem, audit });
    expect(result.committedItems).toEqual([]);
    expect(result.failedItems).toHaveLength(2);
    expect(commitItem).toHaveBeenCalledTimes(2);
    expect(audit).not.toHaveBeenCalled();
  });

  it("routes operational allocation and audit through the authoritative API", () => {
    expect(allocationUiSource).toContain("allocateSampleStock");
    expect(allocationUiSource).not.toContain("saveAuditLogRecord({");
    expect(allocationUiSource).not.toContain("allocateCanonicalSampleStock");
  });
});
