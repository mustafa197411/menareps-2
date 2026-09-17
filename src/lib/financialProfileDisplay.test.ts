// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: { currentUser: null as any }, read: vi.fn() }));
vi.mock("./firebase", () => ({ auth: mocks.auth }));
vi.mock("./commercialReadClient", () => ({ fetchScopedCommercialRead: mocks.read }));
import { canonicalDisplayProfile, profileDisplayTotals, useFinancialProfileDisplay } from "./financialProfileDisplay";
const pharmacy = { id: "PHARMACY-SYNTHETIC", marketId: "MARKET-SYNTHETIC", currencyCode: "TST", outstandingBalance: 9000 };
const profile = { pharmacyId: pharmacy.id, marketId: pharmacy.marketId, currencyCode: "TST", projectionSource: "customerLedgerEntries", projectionVersion: 1, outstandingBalance: 1500, totalCollected: 500, openInvoiceCount: 2 };
it("uses the canonical 1500 projection, never stale Pharmacy 9000", () => {
 expect(canonicalDisplayProfile([profile], pharmacy)?.outstandingBalance).toBe(1500);
 expect(profileDisplayTotals({pharmacies:[pharmacy],profiles:[profile]},pharmacy.marketId,"TST")).toEqual({outstandingBalance:1500,paymentsCollected:500});
 expect(pharmacy.outstandingBalance).toBe(9000);
});
it.each([[],[{...profile,projectionSource:"legacy"}],[{...profile,currencyCode:"OTHER"}],[{...profile,outstandingBalance:NaN}],[profile,profile]].map(profiles => [profiles]))("missing/malformed projections never fall back to Pharmacy debt", profiles => {
 expect(canonicalDisplayProfile(profiles,pharmacy)).toBeNull();
});
it("does not sum different markets/currencies",()=>{
 const other={...pharmacy,id:"OTHER-SYNTHETIC",marketId:"OTHER-MARKET",currencyCode:"OTH"};
 expect(profileDisplayTotals({pharmacies:[pharmacy,other],profiles:[profile,{...profile,pharmacyId:other.id,marketId:other.marketId,currencyCode:"OTH",outstandingBalance:999}]},pharmacy.marketId,"TST")?.outstandingBalance).toBe(1500);
});
it("denied/unavailable data and missing profile are not zero debt",()=>{
 expect(profileDisplayTotals(null,pharmacy.marketId,"TST")).toBeNull();
 expect(profileDisplayTotals({pharmacies:[pharmacy],profiles:[]},pharmacy.marketId,"TST")).toBeNull();
});

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
it("existing scoped read drives displayed 1500, denies safely and clears data when actor changes", async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
 const container=document.createElement("div"),root=createRoot(container);
 mocks.auth.currentUser={uid:"ACTOR-SYNTHETIC"};
 mocks.read.mockResolvedValue({pharmacies:[pharmacy],profiles:[profile]});
 function Display({actor}:{actor:string}) {
  const data=useFinancialProfileDisplay(actor,pharmacy.id);
  const canonical=data && canonicalDisplayProfile(data.profiles,data.pharmacies[0]);
  return React.createElement("span",null,canonical ? canonical.outstandingBalance : "Unavailable");
 }
 try {
  await act(async()=>root.render(React.createElement(Display,{actor:"ACTOR-SYNTHETIC"})));
  expect(container.textContent).toBe("1500");
  expect(mocks.read).toHaveBeenCalledWith(mocks.auth.currentUser,{kind:"CUSTOMER_ACCOUNTS",pharmacyId:pharmacy.id});
  mocks.auth.currentUser={uid:"OTHER-SYNTHETIC"};mocks.read.mockRejectedValue(new Error("DENIED"));
  await act(async()=>root.render(React.createElement(Display,{actor:"OTHER-SYNTHETIC"})));
  expect(container.textContent).toBe("Unavailable");
 } finally {await act(async()=>root.unmount());mocks.auth.currentUser=null;}
});
it("Pharmacy and Dashboard consumers use the shared canonical path without legacy financial fallback",()=>{
 const pharmacySource=readFileSync("src/components/PharmacyList.tsx","utf8");
 expect(pharmacySource).toContain("canonicalDisplayProfile(financialData.profiles, financialPharmacy)");
 expect(pharmacySource).toContain("{currentOutstanding}");
 expect(pharmacySource).not.toContain("selectedPharmacyForProfile.outstandingBalance");
 const analytics=readFileSync("src/lib/analyticsService.ts","utf8");
 expect(analytics).not.toContain("visit.paymentCollected");expect(analytics).not.toContain("visit.outstandingBalanceAfter");
 const display=readFileSync("src/lib/financialProfileDisplay.ts","utf8");
 expect(display).not.toMatch(/setDoc|updateDoc|addDoc|runTransaction/);
});
