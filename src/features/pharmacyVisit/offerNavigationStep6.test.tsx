// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PharmacyVisitEngine } from "./PharmacyVisitEngine";
import { LIBYA_MARKET_DEFAULT } from "../../lib/marketSettings";
import type { PharmacyVisitDraft } from "./types/domain";
import type { User } from "../../types";

// Only external data boundaries are replaced. Engine, Step3, Stepper, reducer,
// offerService, React hooks, and React DOM all execute their real implementations.
vi.mock("../../lib/firebase", () => ({ db: {}, storage: {}, auth: { currentUser: { getIdToken: async () => "synthetic-token" } } }));
vi.mock("firebase/firestore", () => ({
  collection: () => { throw new Error("Unexpected Firestore access"); },
  doc: () => { throw new Error("Unexpected Firestore access"); },
  getDocs: () => { throw new Error("Unexpected Firestore access"); },
  getDoc: () => { throw new Error("Unexpected Firestore access"); },
}));
vi.mock("./services/financialContextService", () => ({ fetchPharmacyFinancialContext: async () => ({ currency: "LYD", outstandingBalanceBefore: 0, currentVisitGrossTotal: 1, currentVisitDiscountTotal: 0, currentVisitNetTotal: 1, sourceStatus: "LIVE" }) }));

const complete = { authorized: true, complete: true, offers: [], unavailableOfferIds: [], selectedCombinationAvailable: true };
const response = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
const draft = (): PharmacyVisitDraft => ({
  schemaVersion: "2.0", draftId: "SYNTHETIC_DRAFT", repUid: "REP", pharmacyId: "PH", areaId: "A", currentStep: 3,
  status: "IN_PROGRESS", entrySource: "DIRECT_MENU", createdAt: "2026-06-01", updatedAt: "2026-06-01", deviceSessionId: "SYNTHETIC_SESSION", localRevision: 1,
  pharmacySnapshot: { id: "PH", countryId: LIBYA_MARKET_DEFAULT.countryId, areaId: "A", nameEn: "Synthetic Pharmacy", currencyCode: "LYD" },
  visitPurpose: { code: "TAKE_ORDER", labelEn: "Take Order" }, currencyCode: "LYD",
  order: { lines: [{ id: "L", canonicalProductId: "P", quantity: 1, unitPricePreview: 1, userConfirmed: true, productNameSnapshot: "Synthetic Product" }], subtotalPreview: 1, currency: "LYD" },
} as PharmacyVisitDraft);
let container: HTMLDivElement, root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
const step = (label: string): HTMLElement => {
  const text = Array.from(container.querySelectorAll("p")).find(node => node.textContent === label);
  if (!text?.parentElement?.parentElement) throw new Error(`Missing step ${label}`);
  return text.parentElement.parentElement;
};
const active = (label: string) => expect(step(label).classList.contains("bg-indigo-600")).toBe(true);
const click = async (element: HTMLElement) => { await act(async () => { element.click(); }); };
const button = (label: string) => {
  const result = Array.from(container.querySelectorAll("button")).find(node => node.textContent?.includes(label));
  if (!result) throw new Error(`Missing button ${label}`);
  return result;
};
async function mount() {
  await act(async () => root.render(<PharmacyVisitEngine lang="en" currentUser={{ id: "REP", role: "Sales Representative" } as User} initialDraft={draft()} entryContext={{ entrySource: "DIRECT_MENU" }} authorizedPharmacies={[]} products={[]} userProductAssignments={[]} marketHydrationOverride={{ status: "RESOLVED", markets: [LIBYA_MARKET_DEFAULT] }} />));
  await vi.waitFor(() => expect(container.textContent).toContain("No eligible Offers"));
  await click(button("Proceed to Payment"));
  active("Payment & AR");
  await click(button("Proceed to Step 5"));
  active("Stock & Notes");
  expect(step("Payment & AR").classList.contains("cursor-pointer")).toBe(true);
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  fetchMock = vi.fn(async (url: string) => {
    if (url !== "/api/pharmacy-offers/scoped-query") throw new Error(`Unexpected network access: ${url}`);
    return response(complete);
  });
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); localStorage.clear(); vi.unstubAllGlobals(); });

describe("Step 6 real React discovery-to-navigation integration", () => {
  it.each([
    ["capacity failure", 503, { complete: false, code: "OFFER_DISCOVERY_CAPACITY_EXCEEDED" }],
    ["incomplete", 200, { ...complete, complete: false }],
    ["unauthorized", 200, { ...complete, authorized: false }],
    ["invalid definition", 200, { ...complete, offers: [{ id: "INVALID" }] }],
  ])("blocks completed Step4 after %s and restores progression after current success", async (_name, status, payload) => {
    await mount();
    fetchMock.mockImplementationOnce(async () => response(payload, status));
    await click(step("Apply Offers"));
    active("Apply Offers");
    expect(container.textContent).toContain("NETWORK ERROR");
    expect(container.textContent).not.toContain("No eligible Offers");
    expect(step("Payment & AR").classList.contains("cursor-pointer")).toBe(true);
    await click(step("Payment & AR"));
    active("Apply Offers");
    // Real debounced local persistence must preserve the draft and order.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1100)); });
    const saved = JSON.parse(localStorage.getItem("menareps_pv_draft_v2_REP_SYNTHETIC_DRAFT")!);
    expect(saved).toMatchObject({ draftId: "SYNTHETIC_DRAFT", pharmacyId: "PH", currentStep: 3, order: { lines: [{ canonicalProductId: "P", quantity: 1 }] } });
    await click(button("Retry"));
    expect(container.textContent).toContain("No eligible Offers");
    await click(button("Proceed to Payment"));
    active("Payment & AR");
    // Return to failed discovery again and prove backward navigation still works.
    fetchMock.mockImplementationOnce(async () => response(payload, status));
    await click(step("Apply Offers"));
    await click(step("Order Items"));
    active("Order Items");
    expect(container.textContent).toContain("Synthetic Product");
    expect(step("Payment & AR").classList.contains("cursor-pointer")).toBe(true);
    expect(fetchMock.mock.calls.every(([url]) => url === "/api/pharmacy-offers/scoped-query")).toBe(true);
  });

  it("ignores an old success after a newer failed discovery using real unmount and effects", async () => {
    await mount();
    let finishOld!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { finishOld = resolve; }));
    await click(step("Apply Offers"));
    expect(container.textContent).toContain("Evaluating Commercial Offers");
    await click(step("Order Items"));
    fetchMock.mockImplementationOnce(async () => response({ ...complete, complete: false }));
    await click(step("Apply Offers"));
    expect(container.textContent).toContain("NETWORK ERROR");
    await act(async () => { finishOld(response(complete)); });
    expect(container.textContent).toContain("NETWORK ERROR");
    await click(step("Payment & AR")); active("Apply Offers");
    await click(button("Retry"));
    await click(button("Proceed to Payment")); active("Payment & AR");
  });
});
