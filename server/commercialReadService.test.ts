import { describe, expect, it } from "vitest";
import { readablePayments, filterCommercialRows, parseCommercialReadRequest, selectRequestedOrder } from "./commercialReadService";
import { CANONICAL_MARKET_DEFAULTS } from "../src/lib/marketSettings";
const order = (id: string, rep: string, areaId = "A1") => ({ id, areaId, representativeUid: rep, marketId: "LY", countryId: "LY", currencyCode: "LYD" });
describe("WP77 backend commercial read policy", () => {
  it("parses only purpose-specific requests", () => { expect(parseCommercialReadRequest({ kind: "PAYMENTS" })).toEqual({ kind: "PAYMENTS" }); expect(parseCommercialReadRequest({ kind: "ORDERS", unsafe: true })).toBeNull(); });
  it("accepts exact order selection only for the governed Orders read", () => { expect(parseCommercialReadRequest({ kind: "ORDERS", orderId: "ORDER-A" })).toEqual({ kind: "ORDERS", orderId: "ORDER-A" }); expect(parseCommercialReadRequest({ kind: "PAYMENTS", orderId: "ORDER-A" })).toBeNull(); });
  it("representative sees own records only", () => expect(filterCommercialRows([order("own", "R1"), order("other", "R2")], { actor: "R1", role: "Sales Representative", subjectMode: "SELF", areaIds: ["A1"], subjectUids: ["R1"], kind: "ORDERS" }, CANONICAL_MARKET_DEFAULTS).map(row => row.id)).toEqual(["own"]));
  it("manager sees only authorized hierarchy and geography", () => expect(filterCommercialRows([order("team", "R1"), order("other", "R2"), order("outside", "R1", "A2")], { actor: "M1", role: "Sales Manager", subjectMode: "HIERARCHY", areaIds: ["A1"], subjectUids: ["M1", "R1"], kind: "ORDERS" }, CANONICAL_MARKET_DEFAULTS).map(row => row.id)).toEqual(["team"]));
  it("functional geography scope and unresolved currency fail closed generically", () => expect(filterCommercialRows([order("valid", "R1"), { id: "legacy", areaId: "A1", representativeUid: "R1" }], { actor: "F1", role: "Finance Officer", subjectMode: "FUNCTIONAL", areaIds: ["A1"], subjectUids: ["F1"], kind: "PAYMENTS" }, CANONICAL_MARKET_DEFAULTS).map(row => row.id)).toEqual(["valid"]));
  it("uses persisted market identity for newly backend-created canonical orders", () => {
    const persistedMarkets = [{ ...CANONICAL_MARKET_DEFAULTS[0], marketId: "MARKET-ARBITRARY", countryId: "COUNTRY-ARBITRARY", currencyCode: "TST", active: true }];
    const created = { id: "ORDER-CANONICAL", displayNumber: "ZZ-SO-2030-000001", pharmacyId: "PHARMACY-A", pharmacyName: "Arbitrary Pharmacy", areaId: "AREA-A", countryId: "COUNTRY-ARBITRARY", marketId: "MARKET-ARBITRARY", currencyCode: "TST", representativeUid: "REP-A", status: "PENDING_FINANCE_REVIEW", stage: "FINANCE_REVIEW", total: 25 };
    const legacyDefault = { ...created, id: "ORDER-LEGACY", marketId: "LY", countryId: "LY", currencyCode: "LYD" };
    const visible = filterCommercialRows([created, legacyDefault], { actor: "FINANCE-A", role: "Finance Officer", subjectMode: "FUNCTIONAL", areaIds: ["AREA-A"], subjectUids: ["FINANCE-A"], kind: "ORDERS" }, persistedMarkets);
    expect(visible).toEqual([created]);
    expect(visible[0]).toMatchObject({ displayNumber: "ZZ-SO-2030-000001", pharmacyId: "PHARMACY-A", pharmacyName: "Arbitrary Pharmacy", status: "PENDING_FINANCE_REVIEW", marketId: "MARKET-ARBITRARY", countryId: "COUNTRY-ARBITRARY", areaId: "AREA-A", representativeUid: "REP-A" });
  });
  it("keeps geography and representative scope fail closed with persisted markets", () => {
    const markets = [{ ...CANONICAL_MARKET_DEFAULTS[0], marketId: "M", countryId: "C", currencyCode: "TST", active: true }];
    const canonical = (id: string, representativeUid: string, areaId: string) => ({ id, representativeUid, areaId, marketId: "M", countryId: "C", currencyCode: "TST" });
    expect(filterCommercialRows([canonical("team", "REP-A", "AREA-A"), canonical("unrelated", "REP-B", "AREA-A"), canonical("outside", "REP-A", "AREA-B")], { actor: "MANAGER-A", role: "Sales Manager", subjectMode: "HIERARCHY", areaIds: ["AREA-A"], subjectUids: ["MANAGER-A", "REP-A"], kind: "ORDERS" }, markets).map(row => row.id)).toEqual(["team"]);
  });
  it("selects an exact order only after scope filtering", () => {
    const authorized = [{ id: "ORDER-A", status: "PENDING_OPERATIONS_REVIEW" }];
    expect(selectRequestedOrder(authorized, "ORDER-A")).toEqual(authorized);
    expect(selectRequestedOrder(authorized, "OUT-OF-SCOPE")).toEqual([]);
  });
  it("delivery officer sees assigned records only", () => expect(filterCommercialRows([{ ...order("mine", "R1"), deliveryOfficerUid: "D1" }, { ...order("other", "R1"), deliveryOfficerUid: "D2" }], { actor: "D1", role: "Delivery Officer", subjectMode: "SELF", areaIds: ["A1"], subjectUids: ["D1"], kind: "ORDERS" }, CANONICAL_MARKET_DEFAULTS).map(row => row.id)).toEqual(["mine"]));
});

const paymentMarket = [{ ...CANONICAL_MARKET_DEFAULTS[0], marketId: "MARKET-SYNTHETIC", currencyCode: "TST", active: true }];
const paymentContext: any = { actor: "REP-SYNTHETIC", role: "Sales Representative", subjectMode: "SELF", areaIds: ["AREA-SYNTHETIC"], subjectUids: ["REP-SYNTHETIC"], kind: "PAYMENTS" };
const pharmacy = { id: "PHARMACY-SYNTHETIC", areaId: "AREA-SYNTHETIC", marketId: "MARKET-SYNTHETIC", currencyCode: "TST", name: "Synthetic Pharmacy" };
const canonical = { id: "COLLECTION-SYNTHETIC", pharmacyId: pharmacy.id, areaId: pharmacy.areaId, marketId: pharmacy.marketId, currencyCode: "TST", decimalPlaces: paymentMarket[0].decimalPlaces, actorUid: "REP-SYNTHETIC", requestKey: "REQUEST-SYNTHETIC", payloadHash: "HASH-SYNTHETIC", revision: 1, amount: 10, method: "Cash", reference: "RECEIPT-SYNTHETIC", evidence: ["https://example.invalid/evidence"], notes: "Canonical notes", status: "Submitted" };
it("maps an authorized canonical payment after refresh without rewriting persistence", () => {
  const before = structuredClone(canonical);
  expect(readablePayments([canonical], [pharmacy], paymentContext, paymentMarket)).toEqual([expect.objectContaining({ paymentId: canonical.id, paymentNumber: canonical.id, representativeUid: canonical.actorUid, paymentMethod: "Cash", referenceNumber: canonical.reference, notes: canonical.notes, attachmentUrls: canonical.evidence })]);
  expect(canonical).toEqual(before); expect(canonical).not.toHaveProperty("representativeUid");
});
it.each([{ actorUid: "OTHER" }, { actorUid: "" }, { areaId: "OTHER" }, { pharmacyId: "OTHER" }, { currencyCode: "BAD" }, { decimalPlaces: 9 }, { amount: 10 ** -(paymentMarket[0].decimalPlaces + 1) }])("canonical malformed/outside record cannot fall back to legacy ownership", patch => {
  expect(readablePayments([{ ...canonical, ...patch, representativeUid: "REP-SYNTHETIC" }], [pharmacy], paymentContext, paymentMarket)).toEqual([]);
});
it("preserves authorized historical representation", () => {
  const legacy = { id: "LEGACY-SYNTHETIC", areaId: pharmacy.areaId, marketId: pharmacy.marketId, currencyCode: "TST", representativeUid: "REP-SYNTHETIC", paymentMethod: "Cash" };
  expect(readablePayments([legacy], [pharmacy], paymentContext, paymentMarket)).toEqual([legacy]);
});

import { vi } from "vitest";
import { createFirestoreCommercialReadRepository, resolveScopedCommercialRead } from "./commercialReadService";
const readMocks=vi.hoisted(()=>({collection:vi.fn(),scope:vi.fn()}));
vi.mock("./firebaseAdmin",()=>({getFirebaseAdminServices:()=>({db:{collection:readMocks.collection}})}));
vi.mock("./operationalScopeRepository",()=>({createFirestoreOperationalScopeRepository:()=>({}),resolveOperationalScopeForActor:(...args:any[])=>readMocks.scope(...args)}));
it("Customer Accounts returns canonical invoice, payment and reversal through its existing scoped contract",async()=>{
 const entries=["INVOICE","PAYMENT","REVERSAL"].map((transactionType,i)=>({id:`ENTRY-SYNTHETIC-${i}`,pharmacyId:pharmacy.id,marketId:pharmacy.marketId,currencyCode:"TST",transactionType}));
 const where=vi.fn(()=>({get:async()=>({docs:entries.map(row=>({id:row.id,data:()=>row}))})}));
 readMocks.collection.mockReturnValue({where});
 const actual=createFirestoreCommercialReadRepository();
 readMocks.scope.mockResolvedValue({authorized:true,role:"Finance Officer",subjectMode:"FUNCTIONAL",queryPlan:{denyAll:false,areaIdChunks:[[pharmacy.areaId]]},areaIds:[pharmacy.areaId],subjectUids:[]});
 const repository:any={queryByAreas:async()=>[pharmacy],getProfiles:async()=>[],getMarketSettings:async()=>paymentMarket,getLedger:actual.getLedger};
 const result=await resolveScopedCommercialRead("ACTOR-SYNTHETIC",{kind:"CUSTOMER_ACCOUNTS",pharmacyId:pharmacy.id},{repository});
 expect(readMocks.collection).toHaveBeenCalledWith("customerLedgerEntries");
 expect(where).toHaveBeenCalledWith("pharmacyId","==",pharmacy.id);
 expect(result.ledger).toEqual(entries);
 const before=readMocks.collection.mock.calls.length;
 expect(await resolveScopedCommercialRead("ACTOR-SYNTHETIC",{kind:"CUSTOMER_ACCOUNTS",pharmacyId:"OUTSIDE-SYNTHETIC"},{repository})).toMatchObject({authorized:false});
 expect(readMocks.collection).toHaveBeenCalledTimes(before);
 readMocks.scope.mockResolvedValue({authorized:true,role:"Sales Representative",queryPlan:{denyAll:false,areaIdChunks:[[pharmacy.areaId]]},areaIds:[pharmacy.areaId]});
 expect(await resolveScopedCommercialRead("ACTOR-SYNTHETIC",{kind:"CUSTOMER_ACCOUNTS"},{repository})).toMatchObject({authorized:false});
});
