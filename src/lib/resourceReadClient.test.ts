import { describe, expect, it, vi } from "vitest";
import { fetchAuthorizedResourceBlob } from "./resourceReadClient";

describe("Resource read client", () => {
  it("sends Firebase authentication and trusted context without a storage path", async () => {
    const fetcher = vi.fn(async (_url, init) => new Response(new Blob(["%PDF"], { type: "application/pdf" }), { status: 200, headers: { "Content-Disposition": "inline; filename*=UTF-8''Brochure.pdf" } }));
    const result = await fetchAuthorizedResourceBlob("RES-1", { purpose: "MANAGEMENT" }, undefined, { getIdToken: vi.fn(async () => "token") }, fetcher as any);
    expect(fetcher).toHaveBeenCalledWith("/api/resources/RES-1/binary", expect.objectContaining({ method: "POST", body: JSON.stringify({ context: { purpose: "MANAGEMENT" } }) }));
    expect(result.filename).toBe("Brochure.pdf");
  });
  it("surfaces deterministic backend denial", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ code: "RESOURCE_NOT_FOUND" }), { status: 404, headers: { "Content-Type": "application/json" } }));
    await expect(fetchAuthorizedResourceBlob("RES-X", { purpose: "MANAGEMENT" }, undefined, { getIdToken: vi.fn(async () => "token") }, fetcher as any)).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND", status: 404 });
  });
});
