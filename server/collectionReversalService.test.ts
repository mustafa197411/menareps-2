import { readFileSync } from "node:fs";
import ts from "typescript";
import { it, expect, vi, beforeEach } from "vitest";
import { executeCollectionReversal, resolveCollectionReversal } from "./collectionReversalService";
import { executeCollectionVerification } from "./collectionVerificationService";
import { collectionSubmissionId } from "./collectionService";
const scope = vi.hoisted(() => ({ authorized: true, queryPlan: { denyAll: false, areaIdChunks: [["AREA-SYNTHETIC"]] }, subjectMode: "FUNCTIONAL", role: "Finance Manager", areaIds: ["AREA-SYNTHETIC"], subjectUids: ["FINANCE-SYNTHETIC"] }));
vi.mock("./operationalScopeRepository", () => ({ createFirestoreOperationalScopeRepository: vi.fn(), resolveOperationalScopeForActor: vi.fn(async () => scope) }));
const market = {
  marketId: "MARKET-SYNTHETIC", countryId: "COUNTRY-SYNTHETIC", countryNameEn: "Synthetic Country", countryNameAr: "بلد",
  active: true, currencyCode: "TST", currencySymbol: "T", symbolPosition: "AFTER", decimalPlaces: 2,
  numeralLocale: "en", timezone: "Etc/UTC", dateFormat: "YYYY-MM-DD", timeFormat: "24H", weekStartDay: 0,
  workingWeekdays: [0, 1, 2, 3, 4], normalWorkdayStart: "08:00", normalWorkdayEnd: "16:00",
  checkInOpensAt: "07:30", lateToleranceMinutes: 15, autoCheckoutAt: "18:00", maximumWorkdayMinutes: 600,
};
const identity = { pharmacyId: "PHARMACY-SYNTHETIC", marketId: "MARKET-SYNTHETIC", currencyCode: "TST", decimalPlaces: 2 };
const collectionId = collectionSubmissionId("REP-SYNTHETIC", "REQUEST-SYNTHETIC");
const input = { collectionId, expectedRevision: 2, reason: "Synthetic reversal reason" };
const now = "2026-01-01T00:00:00.000Z";
function fixture(amount = 1000, amounts = [300, 400, 500]) {
  const records: Record<string, any> = {
    [`pharmacies/${identity.pharmacyId}`]: { id: identity.pharmacyId, ...identity, areaId: "AREA-SYNTHETIC", active: true, status: "Active", outstandingBalance: 99 },
    [`customerFinancialProfiles/${identity.pharmacyId}`]: { ...identity, projectionSource: "customerLedgerEntries", projectionVersion: 1,
      outstandingBalance: amounts.reduce((a,b)=>a+b,0), totalInvoiced: amounts.reduce((a,b)=>a+b,0), totalCollected: 0, openInvoiceCount: amounts.length, paidInvoiceCount: 0, ageing: {} },
    [`marketSettings/${identity.marketId}`]: market,
    "rolePermissions/Finance Manager": { approve: true, reverse: true },
    [`paymentCollections/${collectionId}`]: { ...identity, id: collectionId, actorUid: "REP-SYNTHETIC", requestKey: "REQUEST-SYNTHETIC", payloadHash: "SYNTHETIC-HASH", areaId: "AREA-SYNTHETIC", amount, method: "Cash", reference: "RECEIPT-SYNTHETIC", evidence: [], collectionDate: "2025-12-31", createdAt: "2025-12-31T00:00:00.000Z", status: "Submitted", revision: 1 },
  };
  amounts.forEach((amount, i) => {
    records[`customerLedgerEntries/INVOICE-${i}`] = { ...identity, id: `INVOICE-${i}`, orderId: `ORDER-${i}`, status: "POSTED", transactionType: "INVOICE", sourceType: "DELIVERED_ORDER", revision: 1, projectionVersion: 1, debitAmount: amount, creditAmount: 0, netAmount: amount, invoiceOriginalAmount: amount, invoiceAppliedAmount: 0, invoiceCreditedAmount: 0, invoiceOpenAmount: amount, isOpen: true, createdAt: `2000-01-0${i%9+1}T00:00:00.000Z`, postingDate: `2000-01-0${i%9+1}`, dueDate: "2000-02-01" };
    records[`orders/ORDER-${i}`] = { ...identity, total: amount, paidAmount: 0, paidStatus: "Unpaid", status: "DELIVERED", items: [{ price: amount, paidQuantity: 1, freeQuantity: 2 }] };
  });
  records["products/PRODUCT-SYNTHETIC"] = { price: 900, reservedQuantity: 4 };
  records["inventoryReservations/RESERVATION-SYNTHETIC"] = { status: "CONSUMED", quantity: 3 };
  const writes: string[] = [];
  const ref = (path: string) => ({path});
  const query: any = { where: vi.fn().mockReturnThis(), orderBy: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis() };
  let failWrite = 0, attempts = 0, retryOnce = false;
  // Optimistic transaction simulator: conflicting snapshots retry the whole callback.
  // Pending writes are discarded on failure or conflict, as with Firestore.
  let version = 0;
  const db: any = { doc: ref, collection: (name: string) => name === "customerLedgerEntries" ? query : { doc: (id: string) => ref(`${name}/${id}`) }, runTransaction: (operation: any) => {
    const run = (async () => {
      for (;;) {
        attempts++;
        const readVersion = version, snapshot = structuredClone(records);
        const pending: Array<[string, any]> = [];
        const tx = {
          get: async (r: any) => {
            if (pending.length) throw new Error("READ_AFTER_WRITE");
            if (r === query) return { docs: Object.entries(snapshot).filter(([path,row]) => path.startsWith("customerLedgerEntries/") && row.isOpen === true && row.pharmacyId === identity.pharmacyId)
              .sort(([a,x],[b,y]) => x.createdAt < y.createdAt ? -1 : x.createdAt > y.createdAt ? 1 : a.localeCompare(b))
              .slice(0,81).map(([path,row]) => ({ id:path.split("/")[1],data:()=>structuredClone(row) })) };
            return { id:r.path.split("/")[1],exists:r.path in snapshot,data:()=>snapshot[r.path] && structuredClone(snapshot[r.path]) };
          },
          create: (r: any, value: any) => { if (snapshot[r.path]) throw new Error("DUPLICATE"); pending.push([r.path,structuredClone(value)]); if (failWrite === pending.length) throw new Error("INJECTED_WRITE_FAILURE"); },
          update: (r: any, value: any) => { if (!snapshot[r.path]) throw new Error("MISSING"); pending.push([r.path,{...snapshot[r.path],...structuredClone(value)}]); if (failWrite === pending.length) throw new Error("INJECTED_WRITE_FAILURE"); },
        };
        const result = await operation(tx);
        if (retryOnce) { retryOnce=false; continue; }
        if (readVersion !== version) continue;
        for (const [path,value] of pending) { records[path]=value; writes.push(path); }
        if (pending.length) version++;
        return result;
      }
    })();
    return run;
  } };
  return { records,writes,query, setFailWrite:(n:number)=>{failWrite=n;}, retry:()=>{retryOnce=true;}, attempts:()=>attempts,
    verify:(patch:Record<string,unknown>={})=>executeCollectionVerification("VERIFIER-SYNTHETIC",{collectionId,expectedRevision:1,...patch},{db,now:()=>now}),
    run:(patch:Record<string,unknown>={},actor="REVERSER-SYNTHETIC")=>executeCollectionReversal(actor,{...input,...patch},{db,now:()=>"2026-01-02T00:00:00.000Z"}),
    read:(patch:Record<string,unknown>={})=>resolveCollectionReversal("READER-SYNTHETIC",{collectionId,expectedRevision:2,...patch},{db}) };
}
beforeEach(()=>{scope.authorized=true;scope.queryPlan.denyAll=false;scope.role="Finance Manager";scope.subjectMode="FUNCTIONAL";scope.areaIds=["AREA-SYNTHETIC"];scope.subjectUids=["FINANCE-SYNTHETIC"];});
const counterId = `REVERSE_LEDGER_PAYMENT_${collectionId}`;
async function verified(amount=1000,amounts=[300,400,500]) { const f=fixture(amount,amounts);await f.verify();f.writes.length=0;return f; }
it.each(["Finance Manager", "Treasury Officer"])("%s can fully reverse a multi-invoice payment and preserve original evidence", async role => {
  const f=await verified(), before=structuredClone(f.records);scope.role=role;
  f.records[`rolePermissions/${role}`]={reverse:true};
  const result=await f.run();expect(result).toMatchObject({success:true,alreadyCompleted:false,reversal:{ledgerEntryId:counterId,actorUid:"REVERSER-SYNTHETIC"}});
  expect(f.records[`customerLedgerEntries/${counterId}`]).toMatchObject({transactionType:"REVERSAL",debitAmount:1000,creditAmount:0,netAmount:1000,isReversal:true,reversesEntryId:`LEDGER_PAYMENT_${collectionId}`});
  for(let i=0;i<3;i++) {
    expect(f.records[`customerLedgerEntries/INVOICE-${i}`]).toEqual({...before[`customerLedgerEntries/INVOICE-${i}`],invoiceAppliedAmount:0,invoiceOpenAmount:[300,400,500][i],isOpen:true,revision:3});
    expect(f.records[`orders/ORDER-${i}`]).toEqual({...before[`orders/ORDER-${i}`],paidAmount:0,paidStatus:"Unpaid"});
  }
  for(const [path,record] of Object.entries(before)) {
    if(path.startsWith("paymentCollections/")||path.startsWith("paymentAllocations/")||path.startsWith("auditLogs/")||path.includes("LEDGER_PAYMENT_")||path.startsWith("pharmacies/")||path.startsWith("products/")||path.startsWith("inventoryReservations/"))expect(f.records[path]).toEqual(record);
  }
  const originals=Object.entries(before).filter(([p])=>p.startsWith("paymentAllocations/"));
  for(const [path,a] of originals)expect(f.records[`paymentAllocations/REVERSE_${a.id}`]).toEqual({...a,id:`REVERSE_${a.id}`,reversesAllocationId:a.id,operationId:counterId,actorUid:"REVERSER-SYNTHETIC",createdAt:"2026-01-02T00:00:00.000Z"});
  expect(f.records[`customerFinancialProfiles/${identity.pharmacyId}`]).toMatchObject({outstandingBalance:1200,totalCollected:0,openInvoiceCount:3,paidInvoiceCount:0,oldestOpenInvoiceDate:"2000-01-01",overdueBalance:1200,collectionRate:0,lastPaymentDate:"2025-12-31",lastLedgerActivityAt:"2026-01-02T00:00:00.000Z",ageing:{overNinety:1200}});
  expect(f.records[`auditLogs/REVERSED_${collectionId}`]).toMatchObject({action:"COLLECTION_REVERSED",...result.reversal});
  expect(f.writes.filter(p=>p.startsWith("paymentAllocations/"))).toHaveLength(3);
});
it("preserves later valid settlement instead of restoring old snapshots", async()=>{
 const f=await verified();const secondId=collectionSubmissionId("REP-SYNTHETIC","SECOND-SYNTHETIC");
 const {verificationResult,verifiedAt,verifiedByUid,ledgerEntryId,...base}=f.records[`paymentCollections/${collectionId}`];
 f.records[`paymentCollections/${secondId}`]={...base,id:secondId,requestKey:"SECOND-SYNTHETIC",amount:200,status:"Submitted",revision:1};
 await f.verify({collectionId:secondId});const before=structuredClone(f.records);await f.run();
 expect(f.records["customerLedgerEntries/INVOICE-2"]).toMatchObject({invoiceAppliedAmount:200,invoiceOpenAmount:300,isOpen:true});
 expect(f.records["orders/ORDER-2"]).toEqual({...before["orders/ORDER-2"],paidAmount:200,paidStatus:"Partially Paid"});
 expect(f.records[`customerFinancialProfiles/${identity.pharmacyId}`]).toMatchObject({totalCollected:200,outstandingBalance:1000,openInvoiceCount:3,paidInvoiceCount:0});
 expect(f.records[`customerLedgerEntries/LEDGER_PAYMENT_${secondId}`]).toEqual(before[`customerLedgerEntries/LEDGER_PAYMENT_${secondId}`]);
});
it.each(["Finance Officer","Sales Representative","Admin","Super Admin"])("%s cannot gain reversal authority from an override",async role=>{
 const f=await verified();scope.role=role;f.records[`rolePermissions/${role}`]={reverse:true};const before=structuredClone(f.records);
 await expect(f.run()).rejects.toThrow("COLLECTION_REVERSAL_DENIED");expect(f.records).toEqual(before);expect(f.writes).toEqual([]);
});
it.each([["Finance Manager","reverse"],["Treasury Officer","reverse"],["Finance Manager","active"],["Treasury Officer","active"]])("%s restriction %s denies",async(role,restriction)=>{
 const f=await verified();scope.role=role;f.records[`rolePermissions/${role}`]={[restriction]:false};await expect(f.run()).rejects.toThrow("COLLECTION_REVERSAL_DENIED");expect(f.writes).toEqual([]);
});
it.each(["actorUid","amount","pharmacyId","marketId","currencyCode","allocations","orderIds","invoiceIds","createdAt","role","paidStatus"])("rejects forged browser %s",async key=>{
 const f=await verified();await expect(f.run({[key]:"FORGED"})).rejects.toThrow("INVALID_REVERSAL_REQUEST");expect(f.writes).toEqual([]);
});
it.each(["missing","Submitted","Rejected","Reversed","revision","verificationResult","payment","allocation","verificationAudit","area","scope","customer","market","currency","order","profile"])("fails closed for %s",async kind=>{
 const f=await verified();const c=f.records[`paymentCollections/${collectionId}`];
 if(kind==="missing")delete f.records[`paymentCollections/${collectionId}`];
 if(["Submitted","Rejected","Reversed"].includes(kind))c.status=kind;
 if(kind==="revision")c.revision=4;
 if(kind==="verificationResult")delete c.verificationResult;
 if(kind==="payment")delete f.records[`customerLedgerEntries/${c.ledgerEntryId}`];
 if(kind==="allocation")delete f.records[`paymentAllocations/${c.verificationResult.allocationIds[0]}`];
 if(kind==="verificationAudit")delete f.records[`auditLogs/VERIFIED_${collectionId}`];
 if(kind==="area")scope.areaIds=[];
 if(kind==="scope")scope.authorized=false;
 if(kind==="customer")f.records["customerLedgerEntries/INVOICE-0"].pharmacyId="OTHER-SYNTHETIC";
 if(kind==="market")c.marketId="OTHER-SYNTHETIC";
 if(kind==="currency")c.currencyCode="BAD";
 if(kind==="order")f.records["orders/ORDER-0"].pharmacyId="OTHER-SYNTHETIC";
 if(kind==="profile")f.records[`customerFinancialProfiles/${identity.pharmacyId}`].paidInvoiceCount=0;
 const before=structuredClone(f.records);await expect(f.run()).rejects.toThrow();expect(f.records).toEqual(before);expect(f.writes).toEqual([]);
});
it.each([null,12,""," ","x".repeat(4001)])("rejects invalid reason %j",async reason=>{const f=await verified();await expect(f.run({reason})).rejects.toThrow("INVALID_REVERSAL_REASON");expect(f.writes).toEqual([]);});
it("trims reasons, preserves inner whitespace, and rejects changed-reason replay",async()=>{
 const f=await verified();await f.run({reason:"  Synthetic  reason  "});const before=structuredClone(f.records),count=f.writes.length;
 expect(await f.run({reason:"Synthetic  reason"})).toMatchObject({alreadyCompleted:true,reversal:{reason:"Synthetic  reason"}});
 await expect(f.run({reason:"Different reason"})).rejects.toThrow("REVERSAL_IDEMPOTENCY_CONFLICT");expect(f.records).toEqual(before);expect(f.writes).toHaveLength(count);
});
it.each([100,1000,1200])("fresh retry for %s changes nothing and does not query current open debt",async amount=>{
 const f=await verified(amount);await f.run();const before=structuredClone(f.records),count=f.writes.length,queries=f.query.where.mock.calls.length;
 expect(await f.run({},"OTHER-REVERSER-SYNTHETIC")).toMatchObject({alreadyCompleted:true});expect(f.records).toEqual(before);expect(f.writes).toHaveLength(count);expect(f.query.where).toHaveBeenCalledTimes(queries);
});
it("concurrent reversals and callback retries cannot reverse twice",async()=>{
 const f=await verified();f.retry();const results=await Promise.all([f.run(),f.run({},"OTHER-REVERSER-SYNTHETIC")]);
 expect(results.map(r=>r.alreadyCompleted).sort()).toEqual([false,true]);expect(f.writes.filter(p=>p===`customerLedgerEntries/${counterId}`)).toHaveLength(1);
 expect(f.records[`customerFinancialProfiles/${identity.pharmacyId}`].outstandingBalance).toBe(1200);
});
it.each(Array.from({length:12},(_,i)=>i+1))("injected failure at reversal write %s commits nothing",async position=>{
 const f=await verified();f.setFailWrite(position);const before=structuredClone(f.records);
 await expect(f.run()).rejects.toThrow("INJECTED_WRITE_FAILURE");expect(f.records).toEqual(before);expect(f.writes).toEqual([]);
});
it.each(["entry","audit","event","amount","reason","actor","fingerprint","originalFingerprint","link","eventAmount","eventLink","auditLink"])("incomplete/corrupt reversal %s fails closed",async kind=>{
 const f=await verified();await f.run();const entry=f.records[`customerLedgerEntries/${counterId}`];
 const event=f.records[`paymentAllocations/REVERSE_${f.records[`paymentCollections/${collectionId}`].verificationResult.allocationIds[0]}`];
 if(kind==="entry")delete f.records[`customerLedgerEntries/${counterId}`];
 if(kind==="audit")delete f.records[`auditLogs/REVERSED_${collectionId}`];
 if(kind==="event")delete f.records[`paymentAllocations/${event.id}`];
 if(kind==="amount")entry.debitAmount++;
 if(kind==="reason")entry.reason="";
 if(kind==="actor")entry.createdByUid="FORGED";
 if(kind==="fingerprint")entry.reversalResult.fingerprint="FORGED";
 if(kind==="originalFingerprint")entry.reversalResult.originalFingerprint="FORGED";
 if(kind==="link")entry.reversesEntryId="OTHER-SYNTHETIC";
 if(kind==="eventAmount")event.amount++;
 if(kind==="eventLink")event.reversesAllocationId="OTHER-SYNTHETIC";
 if(kind==="auditLink")f.records[`auditLogs/REVERSED_${collectionId}`].originalLedgerEntryId="OTHER-SYNTHETIC";
 const before=structuredClone(f.records),count=f.writes.length;await expect(f.run()).rejects.toThrow("INCOMPLETE_REVERSAL");expect(f.records).toEqual(before);expect(f.writes).toHaveLength(count);
});
it("linked result is readable after refresh without granting Finance Officer mutation authority",async()=>{
 const f=await verified();expect(await f.read()).toEqual({success:true,reversal:null});await f.run();scope.role="Finance Officer";
 const before=structuredClone(f.records),count=f.writes.length;expect(await f.read()).toMatchObject({success:true,reversal:{ledgerEntryId:counterId}});
 await expect(f.run()).rejects.toThrow("COLLECTION_REVERSAL_DENIED");expect(f.records).toEqual(before);expect(f.writes).toHaveLength(count);
});
it("exact result lookup respects canonical ownership for representative reads",async()=>{
 const f=await verified();scope.role="Sales Representative";scope.subjectMode="SELF";scope.subjectUids=["OTHER-REP-SYNTHETIC"];
 await expect(f.read()).rejects.toThrow("COLLECTION_SCOPE_DENIED");scope.subjectUids=["REP-SYNTHETIC"];expect(await f.read()).toEqual({success:true,reversal:null});expect(f.writes).toEqual([]);
});
it("replay still requires current canonical reversal permission",async()=>{
 const f=await verified();await f.run();f.records["rolePermissions/Finance Manager"].reverse=false;await expect(f.run()).rejects.toThrow("COLLECTION_REVERSAL_DENIED");
});
it("strict revision and identifier validation fail closed",async()=>{
 const f=await verified();await expect(f.run({expectedRevision:1})).rejects.toThrow("STALE_COLLECTION");await expect(f.run({collectionId:"bad/path"})).rejects.toThrow("INVALID_REVERSAL_REQUEST");expect(f.writes).toEqual([]);
});
it("production mutation and lookup routes authenticate, bind server UID and control errors",async()=>{
 const source=readFileSync("server.ts","utf8"),ast=ts.createSourceFile("server.ts",source,ts.ScriptTarget.Latest,true);
 const routes:ts.CallExpression[]=[],helpers:ts.VariableStatement[]=[];
 const visit=(node:ts.Node)=>{
  if(ts.isCallExpression(node)&&["app.post","app.get"].includes(node.expression.getText(ast))&&node.arguments[0]&&ts.isStringLiteral(node.arguments[0])&&node.arguments[0].text==="/api/collections/reverse")routes.push(node);
  if(ts.isVariableStatement(node)&&node.declarationList.declarations.some(d=>d.name.getText(ast)==="collectionReversalError"))helpers.push(node);
  ts.forEachChild(node,visit);
 };visit(ast);expect(routes).toHaveLength(2);expect(helpers).toHaveLength(1);
 const post=vi.fn(),get=vi.fn(),auth=vi.fn(),execute=vi.fn().mockResolvedValue({success:true,alreadyCompleted:false}),resolve=vi.fn().mockResolvedValue({success:true,reversal:null});
 const code=[helpers[0].getText(ast),...routes.map(r=>r.getText(ast)+";")].join("\n");
 new Function("app","requireFirebaseAuth","executeCollectionReversal","resolveCollectionReversal",ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)({post,get},auth,execute,resolve);
 expect(post).toHaveBeenCalledWith("/api/collections/reverse",auth,expect.any(Function));expect(get).toHaveBeenCalledWith("/api/collections/reverse",auth,expect.any(Function));
 const res={status:vi.fn().mockReturnThis(),json:vi.fn().mockReturnThis()},handler=post.mock.calls[0][2];
 await handler({authUid:"REVERSER-SYNTHETIC",body:input},res);expect(execute).toHaveBeenCalledWith("REVERSER-SYNTHETIC",input);expect(res.status).toHaveBeenLastCalledWith(200);
 await get.mock.calls[0][2]({authUid:"READER-SYNTHETIC",query:{collectionId,expectedRevision:"2"}},res);expect(resolve).toHaveBeenCalledWith("READER-SYNTHETIC",{collectionId,expectedRevision:2});
 for(const [error,status] of [["COLLECTION_REVERSAL_DENIED",403],["REVERSAL_IDEMPOTENCY_CONFLICT",409],["INCOMPLETE_REVERSAL",409],["INVALID_REVERSAL_REASON",400],["PRIVATE_INTERNAL",500]] as const){execute.mockRejectedValueOnce(new Error(error));await handler({authUid:"REVERSER-SYNTHETIC",body:input},res);expect(res.status).toHaveBeenLastCalledWith(status);expect(res.json).toHaveBeenLastCalledWith({success:false,code:status===500?"COLLECTION_REVERSAL_FAILED":error});}
 resolve.mockRejectedValueOnce(new Error("COLLECTION_SCOPE_DENIED"));await get.mock.calls[0][2]({authUid:"READER-SYNTHETIC",query:{}},res);expect(res.status).toHaveBeenLastCalledWith(403);
});
it("a subsequent valid payment cannot be undone by replaying an earlier reversal",async()=>{
 const f=await verified();await f.run();const secondId=collectionSubmissionId("REP-SYNTHETIC","SECOND-SYNTHETIC");
 const {verificationResult,verifiedAt,verifiedByUid,ledgerEntryId,...base}=f.records[`paymentCollections/${collectionId}`];
 f.records[`paymentCollections/${secondId}`]={...base,id:secondId,requestKey:"SECOND-SYNTHETIC",amount:200,status:"Submitted",revision:1};
 await f.verify({collectionId:secondId});const before=structuredClone(f.records),count=f.writes.length;
 expect(await f.run()).toMatchObject({alreadyCompleted:true});expect(f.records).toEqual(before);expect(f.writes).toHaveLength(count);expect(f.records["orders/ORDER-0"].paidAmount).toBe(200);
});
it("concurrent reversals of different payments preserve current projections",async()=>{
 const f=await verified();const secondId=collectionSubmissionId("REP-SYNTHETIC","SECOND-SYNTHETIC");
 const {verificationResult,verifiedAt,verifiedByUid,ledgerEntryId,...base}=f.records[`paymentCollections/${collectionId}`];
 f.records[`paymentCollections/${secondId}`]={...base,id:secondId,requestKey:"SECOND-SYNTHETIC",amount:200,status:"Submitted",revision:1};await f.verify({collectionId:secondId});
 const results=await Promise.all([f.run(),f.run({collectionId:secondId})]);expect(results.every(r=>r.alreadyCompleted===false)).toBe(true);
 expect(f.records[`customerFinancialProfiles/${identity.pharmacyId}`]).toMatchObject({outstandingBalance:1200,totalCollected:0,openInvoiceCount:3,paidInvoiceCount:0});
 expect(f.records["orders/ORDER-2"]).toMatchObject({paidAmount:0,paidStatus:"Unpaid"});
});
