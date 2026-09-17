import { expect, it, vi } from "vitest";
import { reverseCollection, fetchCollectionReversal } from "./collectionReversalClient";
const input={collectionId:"COLLECTION-SYNTHETIC",expectedRevision:2,reason:"Synthetic reason"};
it("authenticates and sends identifiers/reason only, retaining the same payload on retry",async()=>{
 const user={getIdToken:vi.fn(async()=>"SYNTHETIC-TOKEN")};
 const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({success:false,code:"TEMPORARY_FAILURE"}),{status:500})).mockResolvedValueOnce(new Response(JSON.stringify({success:true,alreadyCompleted:true,reversal:{collectionId:input.collectionId}})));
 const forged={...input,actorUid:"FORGED",amount:999,allocations:[],marketId:"FORGED",currencyCode:"BAD"};
 await expect(reverseCollection(user,forged,fetcher)).rejects.toThrow("TEMPORARY_FAILURE");
 await expect(reverseCollection(user,forged,fetcher)).resolves.toMatchObject({alreadyCompleted:true});
 for(const [url,options] of fetcher.mock.calls){expect(url).toBe("/api/collections/reverse");expect(options.method).toBe("POST");expect(options.headers.Authorization).toBe("Bearer SYNTHETIC-TOKEN");expect(JSON.parse(options.body)).toEqual(input);}
});
it("reads persisted linked status through an authenticated exact lookup",async()=>{
 const fetcher=vi.fn(async()=>new Response(JSON.stringify({success:true,reversal:null})));
 expect(await fetchCollectionReversal({getIdToken:async()=>"SYNTHETIC-TOKEN"},input.collectionId,2,fetcher)).toEqual({success:true,reversal:null});
 expect(fetcher).toHaveBeenCalledWith("/api/collections/reverse?collectionId=COLLECTION-SYNTHETIC&expectedRevision=2",{headers:{Authorization:"Bearer SYNTHETIC-TOKEN"}});
});
it("lookup failures stay controlled",async()=>{
 const fetcher=vi.fn(async()=>new Response(JSON.stringify({success:false,code:"INCOMPLETE_REVERSAL"}),{status:409}));
 await expect(fetchCollectionReversal({getIdToken:async()=>"SYNTHETIC-TOKEN"},input.collectionId,2,fetcher)).rejects.toThrow("INCOMPLETE_REVERSAL");
});
it("does not send requests without authentication",async()=>{
 const fetcher=vi.fn(),user={getIdToken:async()=>{throw new Error("AUTH_FAILED");}};
 await expect(reverseCollection(user,input,fetcher)).rejects.toThrow("AUTH_FAILED");
 await expect(fetchCollectionReversal(user,input.collectionId,2,fetcher)).rejects.toThrow("AUTH_FAILED");expect(fetcher).not.toHaveBeenCalled();
});
