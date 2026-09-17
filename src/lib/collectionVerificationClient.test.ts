import { expect, it, vi } from "vitest";
import { verifyCollection } from "./collectionVerificationClient";
it("authenticates and sends only identifiers, retaining them on retry",async()=>{
 const user={getIdToken:vi.fn(async()=>"SYNTHETIC-TOKEN")};
 const input={collectionId:"COLLECTION-SYNTHETIC",expectedRevision:1,actorUid:"FORGED",amount:999};
 const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({success:false,code:"STALE_COLLECTION"}),{status:409})).mockResolvedValueOnce(new Response(JSON.stringify({success:true,collectionId:input.collectionId,alreadyCompleted:true})));
 await expect(verifyCollection(user,input,fetcher)).rejects.toThrow("STALE_COLLECTION");
 await expect(verifyCollection(user,input,fetcher)).resolves.toMatchObject({alreadyCompleted:true});
 for(const [url,options] of fetcher.mock.calls){expect(url).toBe("/api/collections/verify");expect(options.headers.Authorization).toBe("Bearer SYNTHETIC-TOKEN");expect(JSON.parse(options.body)).toEqual({collectionId:input.collectionId,expectedRevision:1});}
});
it("does not call HTTP without an authenticated token",async()=>{
 const fetcher=vi.fn();await expect(verifyCollection({getIdToken:async()=>{throw new Error("AUTH_FAILED");}},{collectionId:"COLLECTION-SYNTHETIC",expectedRevision:1},fetcher)).rejects.toThrow("AUTH_FAILED");expect(fetcher).not.toHaveBeenCalled();
});
