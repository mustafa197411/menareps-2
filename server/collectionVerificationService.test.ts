import { readFileSync } from "node:fs";
import ts from "typescript";
import { it, expect, vi, beforeEach } from "vitest";
import { executeCollectionVerification } from "./collectionVerificationService";
import { collectionSubmissionId } from "./collectionService";
import { financialIdentityKey } from "./financialSettlementService";
const scope = vi.hoisted(() => ({ authorized: true, queryPlan: { denyAll: false, areaIdChunks: [["AREA-SYNTHETIC"]] }, subjectMode: "FUNCTIONAL", role: "Finance Officer", areaIds: ["AREA-SYNTHETIC"], subjectUids: ["FINANCE-SYNTHETIC"] }));
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
const input = { collectionId, expectedRevision: 1 };
const now = "2026-01-01T00:00:00.000Z";
function fixture(amount = 1000, amounts = [300, 400, 500]) {
  const records: Record<string, any> = {
    [`pharmacies/${identity.pharmacyId}`]: { id: identity.pharmacyId, ...identity, areaId: "AREA-SYNTHETIC", active: true, status: "Active", outstandingBalance: 99 },
    [`customerFinancialProfiles/${identity.pharmacyId}`]: { ...identity, projectionSource: "customerLedgerEntries", projectionVersion: 1,
      outstandingBalance: amounts.reduce((a,b)=>a+b,0), totalInvoiced: amounts.reduce((a,b)=>a+b,0), totalCollected: 0, openInvoiceCount: amounts.length, paidInvoiceCount: 0, ageing: {} },
    [`marketSettings/${identity.marketId}`]: market,
    "rolePermissions/Finance Officer": { approve: true },
    [`paymentCollections/${collectionId}`]: { ...identity, id: collectionId, actorUid: "REP-SYNTHETIC", requestKey: "REQUEST-SYNTHETIC", payloadHash: "SYNTHETIC-HASH", areaId: "AREA-SYNTHETIC", amount, method: "Cash", reference: "RECEIPT-SYNTHETIC", evidence: [], collectionDate: "2025-12-31", createdAt: "2025-12-31T00:00:00.000Z", status: "Submitted", revision: 1 },
  };
  amounts.forEach((amount, i) => {
    records[`customerLedgerEntries/INVOICE-${i}`] = { ...identity, id: `INVOICE-${i}`, orderId: `ORDER-${i}`, status: "POSTED", transactionType: "INVOICE", sourceType: "DELIVERED_ORDER", revision: 1, projectionVersion: 1, invoiceOriginalAmount: amount, invoiceAppliedAmount: 0, invoiceCreditedAmount: 0, invoiceOpenAmount: amount, isOpen: true, createdAt: `2000-01-0${i%9+1}T00:00:00.000Z`, postingDate: `2000-01-0${i%9+1}`, dueDate: "2000-02-01" };
    records[`orders/ORDER-${i}`] = { ...identity, total: amount, paidAmount: 0, paidStatus: "Unpaid", status: "DELIVERED", items: [{ price: amount, paidQuantity: 1, freeQuantity: 2 }] };
  });
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
    run:(patch:Record<string,unknown>={},actor="FINANCE-SYNTHETIC")=>executeCollectionVerification(actor,{...input,...patch},{db,now:()=>now}) };
}
beforeEach(()=>{scope.authorized=true;scope.queryPlan.denyAll=false;scope.role="Finance Officer";scope.areaIds=["AREA-SYNTHETIC"];});
it("atomically allocates 300/400/300, preserves commercial state, and projects all summaries",async()=>{
 const f=fixture(),before=structuredClone(f.records);expect(await f.run()).toMatchObject({alreadyCompleted:false});
 const allocations=Object.entries(f.records).filter(([p])=>p.startsWith("paymentAllocations/")).map(([,a])=>a);
 expect(allocations.map(a=>a.amount)).toEqual([300,400,300]);
 for(let i=0;i<3;i++) {
   expect(f.records[`orders/ORDER-${i}`]).toEqual({...before[`orders/ORDER-${i}`],paidAmount:[300,400,300][i],paidStatus:i<2?"Paid":"Partially Paid"});
   expect(f.records[`customerLedgerEntries/INVOICE-${i}`]).toMatchObject({invoiceOpenAmount:i<2?0:200,isOpen:i===2,revision:2});
   expect(allocations[i].id).toBe(`ALLOC_${financialIdentityKey([`LEDGER_PAYMENT_${collectionId}`,`INVOICE-${i}`])}`);
 }
 expect(f.records[`customerFinancialProfiles/${identity.pharmacyId}`]).toMatchObject({outstandingBalance:200,totalCollected:1000,openInvoiceCount:1,paidInvoiceCount:2,oldestOpenInvoiceDate:"2000-01-03",lastPaymentDate:"2025-12-31",lastLedgerActivityAt:now,updatedAt:now,overdueBalance:200,ageing:{overNinety:200}});
 expect(f.records[`pharmacies/${identity.pharmacyId}`]).toEqual(before[`pharmacies/${identity.pharmacyId}`]);
 expect(f.records[`paymentCollections/${collectionId}`]).toMatchObject({status:"Verified",revision:2,verifiedByUid:"FINANCE-SYNTHETIC",verifiedAt:now});
 expect(f.records[`auditLogs/VERIFIED_${collectionId}`]).toMatchObject({actorUid:"FINANCE-SYNTHETIC",createdAt:now});
 expect(f.query.limit).toHaveBeenCalledWith(81);
});
it.each([100,1200])("fresh retry after partial/full payment %s writes nothing",async amount=>{
 const f=fixture(amount);await f.run();const before=structuredClone(f.records),count=f.writes.length,queryCount=f.query.where.mock.calls.length;
 expect(await f.run({},"OTHER-FINANCE-SYNTHETIC")).toMatchObject({alreadyCompleted:true});expect(f.records).toEqual(before);expect(f.writes).toHaveLength(count);expect(f.query.where).toHaveBeenCalledTimes(queryCount);
});
it("two concurrent requests settle once and a transaction callback retry is safe",async()=>{
 const f=fixture();f.retry();const results=await Promise.all([f.run(),f.run({},"OTHER-FINANCE-SYNTHETIC")]);
 expect(results.map(r=>r.alreadyCompleted).sort()).toEqual([false,true]);expect(f.attempts()).toBeGreaterThanOrEqual(3);
 expect(f.records[`customerFinancialProfiles/${identity.pharmacyId}`].totalCollected).toBe(1000);
 expect(f.writes.filter(p=>p.startsWith("paymentAllocations/"))).toHaveLength(3);
});
it("uses canonical document ID for exact timestamp ties",async()=>{
 const f=fixture(350); for(let i=0;i<3;i++)f.records[`customerLedgerEntries/INVOICE-${i}`].createdAt="2000-01-01T00:00:00.000Z";
 await f.run();expect(f.records["orders/ORDER-0"].paidAmount).toBe(300);expect(f.records["orders/ORDER-1"].paidAmount).toBe(50);expect(f.records["orders/ORDER-2"].paidAmount).toBe(0);
});
it.each(["approve","active","baseline","scope","area","storedArea","market","currency","precision","noOpen","overpayment","capacity","stale","rejected","missing","profileCount"])("rejects %s without mutation",async reason=>{
 const f=fixture();
 if(reason==="approve"||reason==="active")f.records["rolePermissions/Finance Officer"][reason]=false;
 if(reason==="baseline"){scope.role="Sales Representative";f.records["rolePermissions/Sales Representative"]={approve:true};}
 if(reason==="scope")scope.authorized=false;
 if(reason==="area")scope.areaIds=[];
 if(reason==="storedArea")f.records[`paymentCollections/${collectionId}`].areaId="OTHER-SYNTHETIC";
 if(reason==="market")f.records[`paymentCollections/${collectionId}`].marketId="OTHER-SYNTHETIC";
 if(reason==="currency")f.records[`paymentCollections/${collectionId}`].currencyCode="BAD";
 if(reason==="precision")f.records[`paymentCollections/${collectionId}`].decimalPlaces=3;
 if(reason==="noOpen")for(let i=0;i<3;i++)delete f.records[`customerLedgerEntries/INVOICE-${i}`];
 if(reason==="overpayment")f.records[`paymentCollections/${collectionId}`].amount=1201;
 if(reason==="capacity")for(let i=3;i<81;i++)f.records[`customerLedgerEntries/INVOICE-${i}`]={...f.records["customerLedgerEntries/INVOICE-0"],id:`INVOICE-${i}`,orderId:`ORDER-${i}`};
 if(reason==="rejected")f.records[`paymentCollections/${collectionId}`].status="Rejected";
 if(reason==="missing")delete f.records[`paymentCollections/${collectionId}`];
 if(reason==="profileCount")f.records[`customerFinancialProfiles/${identity.pharmacyId}`].openInvoiceCount=7;
 const before=structuredClone(f.records);await expect(f.run(reason==="stale"?{expectedRevision:2}:{})).rejects.toThrow();expect(f.writes).toEqual([]);expect(f.records).toEqual(before);
});
it.each(["Admin","Super Admin"])("%s cannot bypass a persisted denial",async role=>{const f=fixture();scope.role=role;f.records[`rolePermissions/${role}`]={approve:false};await expect(f.run()).rejects.toThrow("COLLECTION_APPROVAL_DENIED");expect(f.writes).toEqual([]);});
it.each([0,-1])("rejects amount %s",async amount=>{const f=fixture(amount);await expect(f.run()).rejects.toThrow(amount < 0 ? "INVALID_FINANCIAL_AMOUNT" : "INVALID_COLLECTION_AMOUNT");expect(f.writes).toEqual([]);});
it.each(["actorUid","role","amount","pharmacyId","marketId","currencyCode","allocations","invoiceIds","paidStatus","paidAmount"])("rejects browser authority %s",async key=>{const f=fixture();await expect(f.run({[key]:"FORGED"})).rejects.toThrow("INVALID_VERIFICATION_REQUEST");expect(f.writes).toEqual([]);});
it.each([1,2,5,10,13])("failure at write %s aborts every effect",async position=>{const f=fixture();f.setFailWrite(position);const before=structuredClone(f.records);await expect(f.run()).rejects.toThrow("INJECTED_WRITE_FAILURE");expect(f.records).toEqual(before);expect(f.writes).toEqual([]);});
it.each(["result","credit","allocation","audit","fingerprint","amount","verifier","revision","allocationAmount","allocationActor"])("incomplete/conflicting replay %s fails closed",async kind=>{
 const f=fixture();await f.run();const collection=f.records[`paymentCollections/${collectionId}`],payment=f.records[`customerLedgerEntries/LEDGER_PAYMENT_${collectionId}`];
 const id=collection.verificationResult.allocationIds[0];
 if(kind==="result")delete collection.verificationResult;
 if(kind==="credit")delete f.records[`customerLedgerEntries/LEDGER_PAYMENT_${collectionId}`];
 if(kind==="allocation")delete f.records[`paymentAllocations/${id}`];
 if(kind==="audit")delete f.records[`auditLogs/VERIFIED_${collectionId}`];
 if(kind==="fingerprint")payment.settlementFingerprint="FORGED";
 if(kind==="amount")collection.amount++;
 if(kind==="verifier")collection.verifiedByUid="FORGED";
 if(kind==="revision")collection.revision=3;
 if(kind==="allocationAmount")f.records[`paymentAllocations/${id}`].amount++;
 if(kind==="allocationActor")f.records[`paymentAllocations/${id}`].actorUid="FORGED";
 const before=structuredClone(f.records),count=f.writes.length;await expect(f.run()).rejects.toThrow("INCOMPLETE_SETTLEMENT");expect(f.records).toEqual(before);expect(f.writes).toHaveLength(count);
});
it("full settlement clears oldest open date and partial settlement does not increment paid count",async()=>{
 const full=fixture(1200);await full.run();expect(full.records[`customerFinancialProfiles/${identity.pharmacyId}`]).toMatchObject({openInvoiceCount:0,paidInvoiceCount:3,oldestOpenInvoiceDate:null,outstandingBalance:0});
 const partial=fixture(100);await partial.run();expect(partial.records[`customerFinancialProfiles/${identity.pharmacyId}`]).toMatchObject({openInvoiceCount:3,paidInvoiceCount:0,oldestOpenInvoiceDate:"2000-01-01"});
});
it("does not allocate another customer's open invoice",async()=>{const f=fixture(1201);f.records["customerLedgerEntries/OTHER"]={...f.records["customerLedgerEntries/INVOICE-0"],id:"OTHER",pharmacyId:"OTHER-SYNTHETIC"};await expect(f.run()).rejects.toThrow("COLLECTION_OVERPAYMENT");expect(f.writes).toEqual([]);});
it("production route authenticates, binds only auth UID, and controls errors",async()=>{
 const source=readFileSync("server.ts","utf8"),ast=ts.createSourceFile("server.ts",source,ts.ScriptTarget.Latest,true),matches:ts.CallExpression[]=[];
 const visit=(node:ts.Node)=>{if(ts.isCallExpression(node)&&node.expression.getText(ast)==="app.post"&&node.arguments[0]&&ts.isStringLiteral(node.arguments[0])&&node.arguments[0].text==="/api/collections/verify")matches.push(node);ts.forEachChild(node,visit);};visit(ast);expect(matches).toHaveLength(1);
 const post=vi.fn(),auth=vi.fn(),execute=vi.fn().mockResolvedValueOnce({success:true,alreadyCompleted:false,collectionId});
 new Function("app","requireFirebaseAuth","executeCollectionVerification",ts.transpileModule(matches[0].getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)({post},auth,execute);
 expect(post).toHaveBeenCalledWith("/api/collections/verify",auth,expect.any(Function));
 const handler=post.mock.calls[0][2],res={status:vi.fn().mockReturnThis(),json:vi.fn().mockReturnThis()};
 await handler({authUid:"FINANCE-SYNTHETIC",body:input},res);expect(execute).toHaveBeenCalledWith("FINANCE-SYNTHETIC",input);expect(res.status).toHaveBeenLastCalledWith(200);
 for(const [code,status] of [["COLLECTION_APPROVAL_DENIED",403],["STALE_COLLECTION",409],["INCOMPLETE_SETTLEMENT",409],["COLLECTION_OVERPAYMENT",400],["PRIVATE_INTERNAL",500]] as const){execute.mockRejectedValueOnce(new Error(code));await handler({authUid:"FINANCE-SYNTHETIC",body:input},res);expect(res.status).toHaveBeenLastCalledWith(status);expect(res.json).toHaveBeenLastCalledWith({success:false,code:status===500?"COLLECTION_VERIFICATION_FAILED":code});}
});
it("revalidates debt changed after submission rather than using the submitted-time balance",async()=>{
 const f=fixture();const row=f.records["customerLedgerEntries/INVOICE-0"];
 row.invoiceAppliedAmount=250;row.invoiceOpenAmount=50;row.revision=2;
 f.records[`customerFinancialProfiles/${identity.pharmacyId}`].outstandingBalance=950;
 const before=structuredClone(f.records);await expect(f.run()).rejects.toThrow("COLLECTION_OVERPAYMENT");expect(f.records).toEqual(before);expect(f.writes).toEqual([]);
});
it("subsequent valid settlement does not invalidate immutable replay of an earlier payment",async()=>{
 const f=fixture(100);await f.run();const first=structuredClone(f.records[`paymentCollections/${collectionId}`]);
 const secondId=collectionSubmissionId("REP-SYNTHETIC","SECOND-SYNTHETIC");
 const {verificationResult,verifiedAt,verifiedByUid,ledgerEntryId,...submitted}=first;
 f.records[`paymentCollections/${secondId}`]={...submitted,id:secondId,requestKey:"SECOND-SYNTHETIC",amount:200,status:"Submitted",revision:1};
 await f.run({collectionId:secondId});const before=structuredClone(f.records),count=f.writes.length;
 expect(await f.run()).toMatchObject({alreadyCompleted:true});expect(f.records).toEqual(before);expect(f.writes).toHaveLength(count);
});
it.each(["status","method","source","allocationId","sequence","auditActor"])("rejects conflicting persisted result %s",async kind=>{
 const f=fixture();await f.run();const c=f.records[`paymentCollections/${collectionId}`],p=f.records[`customerLedgerEntries/${c.ledgerEntryId}`],a=f.records[`paymentAllocations/${c.verificationResult.allocationIds[0]}`];
 if(kind==="status")p.status="VOID";
 if(kind==="method")c.method="Other";
 if(kind==="source")p.sourceId="OTHER-SYNTHETIC";
 if(kind==="allocationId")a.invoiceLedgerId="OTHER-SYNTHETIC";
 if(kind==="sequence")a.sequence=2;
 if(kind==="auditActor")f.records[`auditLogs/VERIFIED_${collectionId}`].actorUid="OTHER-SYNTHETIC";
 await expect(f.run()).rejects.toThrow("INCOMPLETE_SETTLEMENT");
});
it("concurrent different collections reread reduced debt and cannot over-settle",async()=>{
 const f=fixture(800),secondId=collectionSubmissionId("REP-SYNTHETIC","SECOND-SYNTHETIC");
 f.records[`paymentCollections/${secondId}`]={...f.records[`paymentCollections/${collectionId}`],id:secondId,requestKey:"SECOND-SYNTHETIC"};
 const results=await Promise.allSettled([f.run(),f.run({collectionId:secondId})]);
 expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
 const rejected=results.find(r=>r.status==="rejected") as PromiseRejectedResult;expect(rejected.reason.message).toBe("COLLECTION_OVERPAYMENT");
 expect(f.records[`customerFinancialProfiles/${identity.pharmacyId}`]).toMatchObject({outstandingBalance:400,totalCollected:800});
 expect(Object.values(f.records).filter(r=>r.transactionType==="PAYMENT")).toHaveLength(1);
});
it("successful replay still requires current approval permission",async()=>{
 const f=fixture();await f.run();f.records["rolePermissions/Finance Officer"].approve=false;
 const count=f.writes.length;await expect(f.run()).rejects.toThrow("COLLECTION_APPROVAL_DENIED");expect(f.writes).toHaveLength(count);
});
