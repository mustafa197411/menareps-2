import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { runProductDetailResourceDownload } from "./productDetailResourceDownload";

const resource = {
  resourceId: "RES-1",
  originalFileName: "Canonical Brochure.pdf",
  readContext: { purpose: "PRODUCT_DETAIL" as const, productId: "PROD-1" },
};

describe("Fix 7 Product Detail Resource download", () => {
  it("passes the canonical Product Detail context and filename unchanged to the shared downloader", async () => {
    const downloader = vi.fn().mockResolvedValue(undefined);
    expect(await runProductDetailResourceDownload(resource, new Set(), downloader)).toBe(true);
    expect(downloader).toHaveBeenCalledWith(expect.objectContaining({
      resourceId: "RES-1",
      originalFileName: "Canonical Brochure.pdf",
      readContext: { purpose: "PRODUCT_DETAIL", productId: "PROD-1" },
    }));
  });

  it("fails closed without the trusted Product Detail context", async () => {
    const downloader = vi.fn();
    await expect(runProductDetailResourceDownload({ ...resource, readContext: { purpose: "MANAGEMENT" } }, new Set(), downloader)).rejects.toThrow("PRODUCT_DETAIL_RESOURCE_CONTEXT_REQUIRED");
    expect(downloader).not.toHaveBeenCalled();
  });

  it("prevents duplicate concurrent downloads", async () => {
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const downloader = vi.fn(() => pending), inFlight = new Set<string>();
    const first = runProductDetailResourceDownload(resource, inFlight, downloader);
    expect(await runProductDetailResourceDownload(resource, inFlight, downloader)).toBe(false);
    expect(downloader).toHaveBeenCalledTimes(1);
    release();
    expect(await first).toBe(true);
  });

  it("releases the lock after failure so retry remains possible", async () => {
    const downloader = vi.fn().mockRejectedValueOnce(new Error("RESOURCE_NOT_FOUND")).mockResolvedValueOnce(undefined), inFlight = new Set<string>();
    await expect(runProductDetailResourceDownload(resource, inFlight, downloader)).rejects.toThrow("RESOURCE_NOT_FOUND");
    expect(inFlight.size).toBe(0);
    await expect(runProductDetailResourceDownload(resource, inFlight, downloader)).resolves.toBe(true);
    expect(downloader).toHaveBeenCalledTimes(2);
  });

  it("wires visible loading/error handling without changing trusted discovery", () => {
    const productList = fs.readFileSync("src/components/ProductList.tsx", "utf8");
    expect(productList).toContain("discoverProductResources(selectedProductDetails.id)");
    expect(productList).toContain('readContext: { purpose: "PRODUCT_DETAIL", productId: selectedProductDetails.id }');
    expect(productList).toContain("onClick={() => void handleProductResourceDownload(res)}");
    expect(productList).toContain("disabled={downloadingResourceIds.has(res.resourceId || res.id)}");
    expect(productList).toContain('role="alert"');
  });

  it("introduces no direct Resource or Storage access", () => {
    const sources = ["src/components/ProductList.tsx", "src/lib/productDetailResourceDownload.ts"].map(path => fs.readFileSync(path, "utf8")).join("\n");
    expect(sources).not.toContain('collection(db, "academicResources")');
    expect(sources).not.toMatch(/\bgetDownloadURL\s*\(|\bgetBlob\s*\(|\bgetBytes\s*\(/);
    expect(sources).not.toContain("downloadUrl");
    expect(sources).not.toContain("storage.googleapis.com");
  });
});
