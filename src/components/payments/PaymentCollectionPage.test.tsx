// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import PaymentCollectionPage from "./PaymentCollectionPage";
const mocks = vi.hoisted(() => ({ submit: vi.fn(), verify: vi.fn(), reverse: vi.fn(), reversalRead: vi.fn(), read: vi.fn(), restrictions: {} as any, user: { getIdToken: vi.fn() } }));
vi.mock("../../lib/collectionSubmissionClient", () => ({ submitCollection: mocks.submit }));
vi.mock("../../lib/collectionVerificationClient", () => ({ verifyCollection: mocks.verify }));
vi.mock("../../lib/collectionReversalClient", () => ({ reverseCollection: mocks.reverse, fetchCollectionReversal: mocks.reversalRead }));
vi.mock("firebase/firestore", () => ({ doc: vi.fn(), onSnapshot: (_ref: any, callback: any) => { callback({data:()=>mocks.restrictions}); return () => {}; } }));
vi.mock("../../lib/firebase", () => ({ auth: { currentUser: mocks.user }, db: {} }));
vi.mock("../../lib/commercialReadClient", () => ({ fetchScopedCommercialRead: mocks.read.mockImplementation(async () => ({ payments: [], pharmacies: [{id:"PHARMACY-SYNTHETIC",name:"Synthetic Pharmacy",areaId:"AREA-SYNTHETIC"}] })) }));
vi.mock("../../features/ar/paymentService", () => ({ verifyPaymentCollection: vi.fn(), rejectPaymentCollection: vi.fn(), correctPaymentCollection: vi.fn(), generatePaymentSummaryReportsByCurrency: vi.fn(() => []) }));
vi.mock("../../lib/scrollLock", () => ({ useModalScrollLock: vi.fn() }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: ReturnType<typeof createRoot>;
afterEach(async () => { if(root) await act(async () => root.unmount()); document.body.innerHTML=""; vi.clearAllMocks(); mocks.restrictions = {}; });
async function change(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")!.set!.call(element,value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", {bubbles:true}));
  });
}
it("retains key on failed retry, maps legitimate input only, and creates a new key for a new form", async () => {
  mocks.submit.mockRejectedValueOnce(new Error("TEMPORARY_FAILURE")).mockResolvedValue({success:true,created:true,collectionId:"COLLECTION-SYNTHETIC"});
  const container=document.createElement("div"); document.body.appendChild(container); root=createRoot(container);
  await act(async () => root.render(<PaymentCollectionPage currentUser={{id:"REP-SYNTHETIC",role:"Sales Representative",name:"Synthetic Rep"}} lang="en" />));
  const open = async () => { await act(async () => Array.from(container.querySelectorAll("button")).find(button=>button.textContent?.includes("Record Payment"))!.click()); };
  const fill = async () => {
    await change(container.querySelector("form select")!,"PHARMACY-SYNTHETIC");
    await change(container.querySelector('form input[type="number"]')!,"10");
    await change(container.querySelector('form input[placeholder="e.g. RCT-2026-99"]')!,"RECEIPT-SYNTHETIC");
    await change(container.querySelector("form textarea")!," Notes ");
  };
  const submit = async () => { await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})); }); };
  await open(); await fill(); expect(container.querySelector("textarea")!.maxLength).toBe(4000);
  await submit(); expect(mocks.submit).toHaveBeenCalledTimes(1); const first=mocks.submit.mock.calls[0][1];
  expect(first.requestKey).toBeTruthy(); expect(first).toMatchObject({pharmacyId:"PHARMACY-SYNTHETIC",amount:10,reference:"RECEIPT-SYNTHETIC",notes:" Notes ",evidence:[]});
  for(const key of ["actorUid","representativeUid","areaId","marketId","currencyCode","role"]) expect(first).not.toHaveProperty(key);
  await submit(); expect(mocks.submit.mock.calls[1][1]).toEqual(first);
  await open(); await fill(); await submit(); expect(mocks.submit.mock.calls[2][1].requestKey).not.toBe(first.requestKey);
});
it("contains no legacy create mutation and displays generic canonical evidence", () => {
  const source=readFileSync("src/components/payments/PaymentCollectionPage.tsx","utf8");
  expect(source).not.toContain("createPaymentCollection"); expect(source).toContain("selectedPayment.attachmentUrls?.map");
});
it("maps transfer evidence and bank data without submitting client authority", async () => {
  mocks.submit.mockResolvedValue({success:true,created:true,collectionId:"COLLECTION-SYNTHETIC"});
  const container=document.createElement("div"); document.body.appendChild(container); root=createRoot(container);
  await act(async () => root.render(<PaymentCollectionPage currentUser={{id:"REP-SYNTHETIC",role:"Sales Representative"}} lang="en" />));
  await act(async () => Array.from(container.querySelectorAll("button")).find(button=>button.textContent?.includes("Record Payment"))!.click());
  await change(container.querySelector("form select")!,"PHARMACY-SYNTHETIC");
  await change(container.querySelector('form input[type="number"]')!,"10");
  await act(async () => Array.from(container.querySelectorAll("form button")).find(button=>button.textContent==="Bank Transfer")!.click());
  const bank=container.querySelector('form input[placeholder^="e.g."]')! as HTMLInputElement;
  await change(bank,"Synthetic Bank");
  await change(container.querySelector('form input[placeholder="e.g. TRF-908123"]')!,"TRANSFER-SYNTHETIC");
  await change(container.querySelector('form input[placeholder="https://..."]')!,"https://example.invalid/proof");
  await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})); });
  expect(mocks.submit).toHaveBeenCalledWith(mocks.user,expect.objectContaining({method:"Bank Transfer",transferBank:"Synthetic Bank",reference:"TRANSFER-SYNTHETIC",evidence:["https://example.invalid/proof"]}));
});
const submittedPayment = {paymentId:"COLLECTION-SYNTHETIC",paymentNumber:"COLLECTION-SYNTHETIC",revision:1,status:"Submitted",amount:100,pharmacyId:"PHARMACY-SYNTHETIC",pharmacyName:"Synthetic Pharmacy",paymentMethod:"Cash",referenceNumber:"RECEIPT-SYNTHETIC",collectionDate:"2026-01-01",representativeUid:"REP-SYNTHETIC",representativeName:"Synthetic Rep",attachmentUrls:[]};
async function openPayment(role="Finance Officer", payment=submittedPayment) {
  mocks.read.mockResolvedValue({payments:[payment],pharmacies:[]});
  const container=document.createElement("div");document.body.appendChild(container);root=createRoot(container);
  await act(async()=>root.render(<PaymentCollectionPage currentUser={{id:"FINANCE-SYNTHETIC",role}} lang="en"/>));
  await act(async()=>Array.from(container.querySelectorAll("button")).find(b=>b.textContent?.includes("Details"))!.click());
  return container;
}
it("Verify uses only identifiers and refreshes canonical state",async()=>{
  mocks.verify.mockResolvedValue({success:true,alreadyCompleted:false,collectionId:submittedPayment.paymentId});
  const container=await openPayment();const count=mocks.read.mock.calls.length;
  await act(async()=>Array.from(container.querySelectorAll("button")).find(b=>b.textContent?.includes("Verify & Post"))!.click());
  expect(mocks.verify).toHaveBeenCalledWith(mocks.user,{collectionId:submittedPayment.paymentId,expectedRevision:1});
  expect(mocks.read.mock.calls.length).toBe(count+1);
  expect(readFileSync("src/components/payments/PaymentCollectionPage.tsx","utf8")).not.toContain("verifyPaymentCollection");
});
it.each(["Finance Officer","Admin","Super Admin"])("effective restriction hides Verify for %s",async role=>{
  mocks.restrictions={approve:false};const container=await openPayment(role);
  expect(Array.from(container.querySelectorAll("button")).some(b=>b.textContent?.includes("Verify & Post"))).toBe(false);
  expect(mocks.verify).not.toHaveBeenCalled();
});
it("Treasury canonical applicability permits Verify without the legacy Finance role gate",async()=>{
  const container=await openPayment("Treasury Officer");expect(Array.from(container.querySelectorAll("button")).some(b=>b.textContent?.includes("Verify & Post"))).toBe(true);
  expect(Array.from(container.querySelectorAll("button")).some(b=>b.textContent?.includes("Correct Record"))).toBe(false);
});
it("baseline denied actor cannot gain Verify from an override",async()=>{
  mocks.restrictions={approve:true};const container=await openPayment("Sales Representative");expect(Array.from(container.querySelectorAll("button")).some(b=>b.textContent?.includes("Verify & Post"))).toBe(false);
});
const verifiedPayment={...submittedPayment,status:"Verified",revision:2};
const reversalRecord={collectionId:verifiedPayment.paymentId,ledgerEntryId:"REVERSE_LEDGER_PAYMENT_SYNTHETIC",originalLedgerEntryId:"LEDGER_PAYMENT_SYNTHETIC",actorUid:"REVERSER-SYNTHETIC",createdAt:"2026-01-02T00:00:00.000Z",reason:"Synthetic reversal reason"};
const reverseButton=(container:HTMLElement)=>Array.from(container.querySelectorAll("button")).find(b=>b.textContent?.includes("Reverse verified payment"));
it.each(["Finance Manager","Treasury Officer"])("%s sends a trusted reversal and refreshes while retaining verified history",async role=>{
 mocks.reversalRead.mockResolvedValue({success:true,reversal:null});mocks.reverse.mockResolvedValue({success:true,alreadyCompleted:false,reversal:reversalRecord});
 const container=await openPayment(role,verifiedPayment);expect(mocks.reversalRead).toHaveBeenCalledWith(mocks.user,verifiedPayment.paymentId,2);
 const count=mocks.read.mock.calls.length;expect(reverseButton(container)).toBeDefined();expect(reverseButton(container)!.disabled).toBe(true);
 const reason=container.querySelector<HTMLTextAreaElement>("#collection-reversal-reason")!;expect(reason.maxLength).toBe(4000);await change(reason,"Synthetic reversal reason");
 await act(async()=>reverseButton(container)!.click());
 expect(mocks.reverse).toHaveBeenCalledWith(mocks.user,{collectionId:verifiedPayment.paymentId,expectedRevision:2,reason:"Synthetic reversal reason"});
 expect(mocks.read.mock.calls.length).toBe(count+1);expect(container.textContent).toContain("Linked reversal recorded; original verification retained.");expect(container.textContent).toContain(reversalRecord.ledgerEntryId);expect(reverseButton(container)).toBeUndefined();
});
it.each(["Finance Officer","Sales Representative","Admin","Super Admin"])("%s cannot receive reversal authority from override",async role=>{
 mocks.reversalRead.mockResolvedValue({success:true,reversal:null});mocks.restrictions={reverse:true};const container=await openPayment(role,verifiedPayment);expect(reverseButton(container)).toBeUndefined();expect(mocks.reverse).not.toHaveBeenCalled();
});
it.each(["Finance Manager","Treasury Officer"])("restriction denies %s reversal",async role=>{
 mocks.reversalRead.mockResolvedValue({success:true,reversal:null});mocks.restrictions={reverse:false};const container=await openPayment(role,verifiedPayment);expect(reverseButton(container)).toBeUndefined();
});
it("reads linked reversal on refresh without offering a second mutation",async()=>{
 mocks.reversalRead.mockResolvedValue({success:true,reversal:reversalRecord});const container=await openPayment("Finance Officer",verifiedPayment);expect(container.textContent).toContain(reversalRecord.reason);expect(container.textContent).toContain(reversalRecord.ledgerEntryId);expect(reverseButton(container)).toBeUndefined();
});
it("failed reversal retains reason and reuses identifiers for retry",async()=>{
 mocks.reversalRead.mockResolvedValue({success:true,reversal:null});mocks.reverse.mockRejectedValueOnce(new Error("TEMPORARY_FAILURE")).mockResolvedValue({success:true,alreadyCompleted:true,reversal:reversalRecord});
 const container=await openPayment("Finance Manager",verifiedPayment);await change(container.querySelector<HTMLTextAreaElement>("#collection-reversal-reason")!,"Synthetic reversal reason");
 await act(async()=>reverseButton(container)!.click());expect(container.textContent).toContain("TEMPORARY_FAILURE");expect(container.querySelector<HTMLTextAreaElement>("#collection-reversal-reason")!.value).toBe("Synthetic reversal reason");
 const first=mocks.reverse.mock.calls[0][1];await act(async()=>reverseButton(container)!.click());expect(mocks.reverse.mock.calls[1][1]).toEqual(first);
});
it("failed eligibility lookup never enables Reverse",async()=>{
 mocks.reversalRead.mockRejectedValueOnce(new Error("INCOMPLETE_SETTLEMENT"));const container=await openPayment("Finance Manager",verifiedPayment);expect(container.textContent).toContain("INCOMPLETE_SETTLEMENT");expect(reverseButton(container)).toBeUndefined();
});
it("Submitted records do not expose Reverse",async()=>{
 const container=await openPayment("Finance Manager");expect(reverseButton(container)).toBeUndefined();expect(mocks.reversalRead).not.toHaveBeenCalled();
});
