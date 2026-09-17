import { describe, expect, it, vi } from "vitest";

vi.mock("./firebase", () => ({ storage: {} }));

import {
  downloadResourceBinary,
  resolveResourceBinary,
} from "./resourceBinaryResolver";

describe("resourceBinaryResolver", () => {
  it("resolves storagePath through an authenticated Storage blob and revokes once", async () => {
    const blob = new Blob(["%PDF-test"], { type: "application/pdf" });
    const fetchStorageBlob = vi.fn().mockResolvedValue(blob);
    const revokeObjectUrl = vi.fn();
    const resolved = await resolveResourceBinary(
      { storagePath: "resources/PG/RES/v1/test.pdf", originalFileName: "Original.pdf" },
      { fetchStorageBlob, createObjectUrl: () => "blob:canonical", revokeObjectUrl },
    );
    expect(fetchStorageBlob).toHaveBeenCalledWith("resources/PG/RES/v1/test.pdf");
    expect(resolved).toMatchObject({ url: "blob:canonical", mimeType: "application/pdf", filename: "Original.pdf" });
    resolved.cleanup();
    resolved.cleanup();
    expect(revokeObjectUrl).toHaveBeenCalledTimes(1);
  });

  it("does not accept a legacy durable URL as Resource authority", async () => {
    await expect(resolveResourceBinary(
      { mimeType: "application/pdf", fileName: "legacy.pdf" },
    )).rejects.toThrow("RESOURCE_AUTHORIZED_CONTEXT_REQUIRED");
  });

  it("resolves through the backend-authorized transport", async () => {
    const fetchAuthorizedBlob = vi.fn().mockResolvedValue({ blob: new Blob(["%PDF"], { type: "application/pdf" }), filename: "canonical.pdf" });
    const resolved = await resolveResourceBinary({ resourceId: "RES-1", readContext: { purpose: "MANAGEMENT" } }, { fetchAuthorizedBlob, createObjectUrl: () => "blob:authorized" });
    expect(fetchAuthorizedBlob).toHaveBeenCalledWith("RES-1", { purpose: "MANAGEMENT" });
    expect(resolved).toMatchObject({ url: "blob:authorized", filename: "canonical.pdf" });
  });

  it("propagates a handled storage retrieval failure", async () => {
    await expect(resolveResourceBinary(
      { storagePath: "resources/PG/RES/v1/missing.pdf" },
      { fetchStorageBlob: vi.fn().mockRejectedValue(new Error("storage/unauthorized")) },
    )).rejects.toThrow("storage/unauthorized");
  });

  it("retrieval returns a storagePath-only binary without presentation side effects", async () => {
    const resolved = await resolveResourceBinary(
      { storagePath: "resources/PG/RES/v1/visit.pdf", mimeType: "application/pdf" },
      { fetchStorageBlob: vi.fn().mockResolvedValue(new Blob(["%PDF"], { type: "application/pdf" })), createObjectUrl: () => "blob:visit" },
    );
    expect(resolved.url).toBe("blob:visit");
  });

  it("downloads with the original filename and revokes the generated URL", async () => {
    const click = vi.fn();
    const remove = vi.fn();
    const anchor = { href: "", download: "", style: { display: "" }, click, remove } as unknown as HTMLAnchorElement;
    const revokeObjectUrl = vi.fn();
    await downloadResourceBinary(
      { storagePath: "resources/PG/RES/v1/safe.pdf", originalFileName: "Approved Brochure.pdf" },
      {
        fetchStorageBlob: vi.fn().mockResolvedValue(new Blob(["%PDF"], { type: "application/pdf" })),
        createObjectUrl: () => "blob:download",
        revokeObjectUrl,
        createDownloadAnchor: () => anchor,
        appendDownloadAnchor: vi.fn(),
      },
    );
    expect(anchor.download).toBe("Approved Brochure.pdf");
    expect(anchor.href).toBe("blob:download");
    expect(click).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:download");
  });
});
