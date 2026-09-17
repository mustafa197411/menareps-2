import { describe, expect, it, vi } from "vitest";

vi.mock("./firebase", () => ({
  auth: { currentUser: { getIdToken: vi.fn().mockResolvedValue("firebase-token") } },
}));

import { uploadAcademicResourceThroughBackend } from "./resourceUploadClient";

describe("Resource Center binary upload boundary", () => {
  it("does not finalize metadata when the binary upload fails", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ authorizationId: "AUTH-1", uploadSessionUri: "https://storage.googleapis.com/upload/session" }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const file = new File(["pdf"], "study.pdf", { type: "application/pdf" });

    await expect(uploadAcademicResourceThroughBackend({ file, promotionGroupId: "PG-1", productIds: ["P-1"], metadata: { mimeType: "application/pdf" } }))
      .rejects.toThrow("Failed to fetch");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/resources/uploads/finalize")).toBe(false);
  });
});
