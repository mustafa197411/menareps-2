import { readFileSync } from "node:fs";
import ts from "typescript";
import { resolveScopedCommercialRead } from "./commercialReadService";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeCollectionSubmission, parseCollectionSubmission } from "./collectionSubmissionService";
const scope = vi.hoisted(() => ({ authorized: true, queryPlan: { denyAll: false, areaIdChunks: [["AREA-SYNTHETIC"]] }, subjectMode: "SELF", role: "Sales Representative", areaIds: ["AREA-SYNTHETIC"], subjectUids: ["REP-SYNTHETIC"] }));
vi.mock("./operationalScopeRepository", () => ({ createFirestoreOperationalScopeRepository: vi.fn(), resolveOperationalScopeForActor: vi.fn(async () => scope) }));
const market = {
  marketId: "MARKET-SYNTHETIC", countryId: "COUNTRY-SYNTHETIC", countryNameEn: "Synthetic Country", countryNameAr: "بلد",
  active: true, currencyCode: "TST", currencySymbol: "T", symbolPosition: "AFTER", decimalPlaces: 2,
  numeralLocale: "en", timezone: "Etc/UTC", dateFormat: "YYYY-MM-DD", timeFormat: "24H", weekStartDay: 0,
  workingWeekdays: [0, 1, 2, 3, 4], normalWorkdayStart: "08:00", normalWorkdayEnd: "16:00",
  checkInOpensAt: "07:30", lateToleranceMinutes: 15, autoCheckoutAt: "18:00", maximumWorkdayMinutes: 600,
};
const identity = { pharmacyId: "PHARMACY-SYNTHETIC", marketId: "MARKET-SYNTHETIC", currencyCode: "TST", decimalPlaces: 2 };
const input = { pharmacyId: identity.pharmacyId, requestKey: "REQUEST-SYNTHETIC", amount: 100, method: "Cash", reference: "RECEIPT-SYNTHETIC", collectionDate: "2026-01-01", notes: " Note " };
function fixture() {
  const records: Record<string, any> = {
    [`pharmacies/${identity.pharmacyId}`]: { id: identity.pharmacyId, ...identity, areaId: "AREA-SYNTHETIC", active: true, status: "Active" },
    [`customerFinancialProfiles/${identity.pharmacyId}`]: { ...identity, projectionSource: "customerLedgerEntries", projectionVersion: 1 },
    [`marketSettings/${identity.marketId}`]: market,
    "rolePermissions/Sales Representative": { create: true },
  };
  const rows: any[] = [{ ...identity, id: "INVOICE-SYNTHETIC", orderId: "ORDER-SYNTHETIC", status: "POSTED", transactionType: "INVOICE", sourceType: "DELIVERED_ORDER", revision: 1, projectionVersion: 1, invoiceOriginalAmount: 100, invoiceAppliedAmount: 0, invoiceCreditedAmount: 0, invoiceOpenAmount: 100, isOpen: true, createdAt: "1999-01-01T00:00:00.000Z", dueDate: "1999-01-02" }];
  const writes: string[] = [];
  const ref = (path: string) => ({ path });
  const query: any = { where: vi.fn().mockReturnThis(), orderBy: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis() };
  const db: any = { doc: ref, collection: (name: string) => name === "customerLedgerEntries" ? query : { doc: (id: string) => ref(`${name}/${id}`) }, runTransaction: async (operation: any) => {
    const pending: any[] = [];
    const tx = { get: async (r: any) => { if (pending.length) throw new Error("READ_AFTER_WRITE"); return r === query ? { docs: rows.map(row => ({ id: row.id, data: () => row })) } : { id: r.path.split("/")[1], exists: r.path in records, data: () => records[r.path] }; }, create: (r: any, value: any) => { if (records[r.path]) throw new Error("DUPLICATE"); pending.push([r.path, structuredClone(value)]); } };
    const result = await operation(tx); for (const [path,value] of pending) { records[path] = value; writes.push(path); } return result;
  } };
  return { records, rows, writes, query, run: (patch = {}) => executeCollectionSubmission("REP-SYNTHETIC", { ...input, ...patch }, { db, now: () => "2026-01-01T00:00:00.000Z" }) };
}
beforeEach(() => { scope.authorized = true; scope.role = "Sales Representative"; scope.areaIds = ["AREA-SYNTHETIC"]; });
it("submits exact old debt with only collection/audit writes and canonical metadata", async () => {
  const f = fixture(), before = structuredClone(f.records); const result = await f.run();
  expect(result.success).toBe(true); expect(f.writes).toEqual([`paymentCollections/${result.collectionId}`, `auditLogs/SUBMITTED_${result.collectionId}`]);
  expect(f.records[`paymentCollections/${result.collectionId}`]).toMatchObject({ status: "Submitted", actorUid: "REP-SYNTHETIC", areaId: "AREA-SYNTHETIC", notes: "Note", amount: 100 });
  for (const [path,value] of Object.entries(before)) expect(f.records[path]).toEqual(value);
  for (const key of ["representativeUid", "salesRepUid", "createdByUid", "repId", "userId"]) expect(f.records[`paymentCollections/${result.collectionId}`]).not.toHaveProperty(key);
  expect(f.query.limit).toHaveBeenCalledWith(81);
});
it.each([0,-1,101])("rejects invalid amount %s before writes", async amount => { const f=fixture(); await expect(f.run({amount})).rejects.toThrow(); expect(f.writes).toEqual([]); });
it.each(["active", "create", "baseline", "area", "scope", "customer", "capacity", "empty"])("fails closed for %s", async reason => {
 const f=fixture();
 if(reason === "active") f.records["rolePermissions/Sales Representative"].active=false;
 if(reason === "create") f.records["rolePermissions/Sales Representative"].create=false;
 if(reason === "baseline") { scope.role="Medical Representative"; f.records["rolePermissions/Medical Representative"]={create:true}; }
 if(reason === "area") scope.areaIds=[];
 if(reason === "scope") scope.authorized=false;
 if(reason === "customer") f.rows[0].pharmacyId="OTHER-SYNTHETIC";
 if(reason === "capacity") f.rows.push(...Array.from({length:80},(_,i)=>({...f.rows[0],id:`ROW-${i}`})));
 if(reason === "empty") f.rows.length=0;
 await expect(f.run()).rejects.toThrow(); expect(f.writes).toEqual([]);
});
it.each(["actorUid","representativeUid","areaId","role","marketId","currencyCode","status","allocations"])("rejects forged %s", async key => { const f=fixture(); await expect(f.run({[key]:"FORGED"})).rejects.toThrow("INVALID_COLLECTION_REQUEST"); expect(f.writes).toEqual([]); });
it("retries without duplicate and conflicts on changed normalized notes", async () => { const f=fixture(); const first=await f.run(); expect(await f.run({notes:"Note"})).toMatchObject({created:false,collectionId:first.collectionId}); await expect(f.run({notes:"Other"})).rejects.toThrow("COLLECTION_IDEMPOTENCY_CONFLICT"); expect(f.writes).toHaveLength(2); });
it("revalidates current receivables on replay rather than bypassing closed debt", async () => { const f=fixture(); await f.run(); f.rows.length=0; await expect(f.run()).rejects.toThrow("NO_OPEN_RECEIVABLE"); expect(f.writes).toHaveLength(2); });
it("rejects malformed target paths", () => { expect(parseCollectionSubmission({...input,pharmacyId:"a/b"})).toBeNull(); });

it("submitted canonical record is visible through the existing PAYMENTS reader on refresh", async () => {
 const f=fixture(); const result=await f.run();
 const repository:any={ getMarketSettings:async()=>[market], queryByAreas:async(name:string)=>Object.entries(f.records).filter(([path])=>path.startsWith(`${name}/`)).map(([path,row])=>({...row,id:path.split("/")[1]})) };
 const refreshed=await resolveScopedCommercialRead("REP-SYNTHETIC",{kind:"PAYMENTS"},{repository,operationalScopeRepository:{} as any});
 expect(refreshed.authorized).toBe(true); expect(refreshed.payments).toEqual([expect.objectContaining({paymentId:result.collectionId,representativeUid:"REP-SYNTHETIC",notes:"Note",status:"Submitted"})]);
});
it("production route binds auth identity and returns controlled errors", async () => {
 const source=readFileSync("server.ts","utf8"), ast=ts.createSourceFile("server.ts",source,ts.ScriptTarget.Latest,true);
 const matches:ts.CallExpression[]=[];
 const visit=(node:ts.Node)=>{ if(ts.isCallExpression(node)&&node.expression.getText(ast)==="app.post"&&node.arguments[0]&&ts.isStringLiteral(node.arguments[0])&&node.arguments[0].text==="/api/collections/submit")matches.push(node);ts.forEachChild(node,visit); };visit(ast);expect(matches).toHaveLength(1);
 const post=vi.fn(),auth=vi.fn(),execute=vi.fn().mockResolvedValueOnce({success:true,collectionId:"COLLECTION-SYNTHETIC"}).mockRejectedValueOnce(new Error("COLLECTION_IDEMPOTENCY_CONFLICT")).mockRejectedValueOnce(new Error("PRIVATE_INTERNAL_MESSAGE"));
 new Function("app","requireFirebaseAuth","executeCollectionSubmission",ts.transpileModule(matches[0].getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)({post},auth,execute);
 expect(post).toHaveBeenCalledWith("/api/collections/submit",auth,expect.any(Function));
 const handler=post.mock.calls[0][2],res={status:vi.fn().mockReturnThis(),json:vi.fn().mockReturnThis()};
 await handler({authUid:"REP-SYNTHETIC",body:input},res);expect(execute).toHaveBeenCalledWith("REP-SYNTHETIC",input);expect(res.status).toHaveBeenLastCalledWith(200);
 await handler({authUid:"REP-SYNTHETIC",body:input},res);expect(res.status).toHaveBeenLastCalledWith(409);
 await handler({authUid:"REP-SYNTHETIC",body:input},res);expect(res.status).toHaveBeenLastCalledWith(500);expect(res.json).toHaveBeenLastCalledWith({success:false,code:"COLLECTION_SUBMISSION_FAILED"});
});
