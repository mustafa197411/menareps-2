import { it, expect, vi } from "vitest";
import { submitCollection } from "./collectionSubmissionClient";
it("authenticates and preserves request key across failed HTTP retry", async () => {
  const user = { getIdToken: vi.fn(async () => "SYNTHETIC-TOKEN") };
  const input = { pharmacyId: "PHARMACY-SYNTHETIC", requestKey: "REQUEST-SYNTHETIC", amount: 10, method: "Cash" as const, reference: "RECEIPT-SYNTHETIC", collectionDate: "2026-01-01" };
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({success:false,code:"RETRY"}),{status:500})).mockResolvedValueOnce(new Response(JSON.stringify({success:true,created:true,collectionId:"COLLECTION-SYNTHETIC"})));
  await expect(submitCollection(user,input,fetcher)).rejects.toThrow("RETRY");
  await expect(submitCollection(user,input,fetcher)).resolves.toMatchObject({success:true});
  for (const [url, options] of fetcher.mock.calls) { expect(url).toBe("/api/collections/submit"); expect(options.headers.Authorization).toBe("Bearer SYNTHETIC-TOKEN"); expect(JSON.parse(options.body)).toEqual(input); }
});
