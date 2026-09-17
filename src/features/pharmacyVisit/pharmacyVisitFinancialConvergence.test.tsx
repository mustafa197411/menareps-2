// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Step4Payment } from "./steps/Step4Payment";
import { Step6CompleteVisit } from "./steps/Step6CompleteVisit";
import { pharmacyVisitReducer } from "./state/pharmacyVisitReducer";
import { completePharmacyVisitV2 } from "./services/completePharmacyVisitV2";
import { PharmacyVisitDraftService } from "./services/pharmacyVisitDraftService";
import { fetchPharmacyFinancialContext } from "./services/financialContextService";
import { readFileSync } from "node:fs";

vi.mock("./services/completePharmacyVisitV2", () => ({ completePharmacyVisitV2: vi.fn() }));
vi.mock("./services/pharmacyVisitDraftService", () => ({ PharmacyVisitDraftService: { saveDraft: vi.fn(), deleteDraft: vi.fn() } }));
vi.mock("./services/financialContextService", () => ({ fetchPharmacyFinancialContext: vi.fn(() => { throw new Error("UNEXPECTED_FINANCIAL_READ"); }) }));

const user: any = { id: "REP-SYNTHETIC", role: "Sales Representative" };
function draft(amount = 0): any {
  return { schemaVersion: "2.0", draftId: "DRAFT-SYNTHETIC", repUid: user.id, pharmacyId: "PHARMACY-SYNTHETIC", areaId: "AREA-SYNTHETIC",
    currentStep: 4, status: "IN_PROGRESS", currencyCode: "TST", entrySource: "DIRECT_MENU",
    visitPurpose: { code: "FINANCIAL_COLLECTION", labelEn: "Collection follow-up" },
    pharmacySnapshot: { id: "PHARMACY-SYNTHETIC", nameEn: "Synthetic Pharmacy", outstandingBalance: 987654 },
    order: { lines: [], subtotalPreview: 0, currency: "TST" },
    payment: { paymentEntry: { amount, method: "CASH", notes: "Preserve these operational notes", currency: "TST", evidences: [{ attachmentId: "EVIDENCE-SYNTHETIC", fileName: "synthetic.png", mimeType: "image/png", sizeBytes: 1024, uploadStatus: "SUCCESS" }], source: "DRAFT" }, financialContext: { outstandingBalanceBefore: 987654 }, balancePreview: { projectedBalanceAfter: 999 } },
    stock: { crmNotes: { generalNotes: "Operational follow-up" }, requestLines: [] },
    gps: { status: "VERIFIED", latitude: 1, longitude: 2 },
  };
}
let root: Root, container: HTMLDivElement;
const dispatch = vi.fn(), next = vi.fn(), back = vi.fn();
async function mount(step: 4 | 6, value: any, onDispatch = dispatch) {
  await act(async () => root.render(step === 4
    ? <Step4Payment draft={value} currentUser={user} dispatch={onDispatch} onBack={back} onNext={next} />
    : <Step6CompleteVisit draft={value} currentUser={user} dispatch={onDispatch} onBack={back} />));
}
function button(label: string) {
  const found = [...container.querySelectorAll("button")].find(b => b.textContent?.includes(label));
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
const click = async (label: string) => { await act(async () => button(label).click()); };
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(console, "info").mockImplementation(() => {});
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  vi.mocked(completePharmacyVisitV2).mockResolvedValue({ success: true, visitId: "VISIT-SYNTHETIC", visitDisplayNumber: "VISIT-SYNTHETIC" });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Visit financial UI retirement", () => {
  it.each([4, 6] as const)("Step %s preserves a loaded positive draft without automatic writes", async step => {
    const value = draft(25), before = JSON.stringify(value); await mount(step, value);
    expect(container.textContent).toContain("Your saved amount has not been submitted");
    expect(container.textContent).not.toMatch(/Partial Collection|Full Collection|Balance After Visit|Projected AR/);
    expect(container.textContent).not.toContain("987,654"); expect(container.textContent).not.toContain("987654");
    expect(JSON.stringify(value)).toBe(before); expect(dispatch).not.toHaveBeenCalled();
    expect(fetchPharmacyFinancialContext).not.toHaveBeenCalled(); expect(PharmacyVisitDraftService.saveDraft).not.toHaveBeenCalled();
    expect(completePharmacyVisitV2).not.toHaveBeenCalled();
  });
  it("Step 4 cannot enter a new positive amount or use order/AR presets", async () => {
    await mount(4, draft()); await click("Saved Collection Details & Notes");
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Saved collection amount"]')!;
    expect(input.readOnly).toBe(true); expect(container.textContent).not.toMatch(/Full Order|Full AR/);
    expect(container.querySelector<HTMLInputElement>('input[placeholder="Optional documentation notes..."]')?.value).toBe("Preserve these operational notes");
    expect(dispatch).not.toHaveBeenCalled();
  });
  it("Step 4 blocks proceeding with a saved positive amount", async () => {
    const value = draft(25); await mount(4, value); await click("Proceed to Step 5");
    expect(next).not.toHaveBeenCalled(); expect(dispatch).not.toHaveBeenCalled(); expect(value.payment.paymentEntry.amount).toBe(25);
  });
  it("only explicit confirmed removal changes the amount; notes/evidence survive", async () => {
    const value = draft(25), before = JSON.stringify(value); const confirmation = vi.spyOn(window, "confirm").mockReturnValue(false);
    await mount(4, value); await click("Remove saved amount explicitly");
    expect(dispatch).not.toHaveBeenCalled(); expect(JSON.stringify(value)).toBe(before);
    confirmation.mockReturnValue(true); await click("Remove saved amount explicitly");
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: "SET_PAYMENT_AMOUNT", payload: { amount: 0, userUid: user.id } });
    const state = pharmacyVisitReducer({ draft: value, isLoading: false }, dispatch.mock.calls[0][0]);
    expect(state.draft.payment!.paymentEntry).toMatchObject({ amount: 0, notes: value.payment.paymentEntry.notes, evidences: value.payment.paymentEntry.evidences });
    expect(JSON.stringify(value)).toBe(before);
  });
  it("zero collection-purpose Visit can proceed and navigate back", async () => {
    const value = draft(); await mount(4, value); await click("Proceed to Step 5");
    expect(next).toHaveBeenCalledOnce(); expect(dispatch).toHaveBeenCalledWith({ type: "COMPLETE_STEP_4" });
    await click("Back"); expect(back).toHaveBeenCalledOnce(); expect(value.visitPurpose.code).toBe("FINANCIAL_COLLECTION");
  });
  it("Step 6 blocks positive collection before calling completion or saving", async () => {
    const value = draft(25), before = JSON.stringify(value); await mount(6, value); await click("Complete Visit");
    expect(completePharmacyVisitV2).not.toHaveBeenCalled(); expect(PharmacyVisitDraftService.saveDraft).not.toHaveBeenCalled();
    expect(JSON.stringify(value)).toBe(before); expect(container.textContent).not.toContain("saved as completed");
  });
  it("explicit Save Draft preserves the positive amount", async () => {
    const value = draft(25); await mount(6, value); await click("Save Draft");
    expect(PharmacyVisitDraftService.saveDraft).toHaveBeenCalledWith(expect.objectContaining({ payment: value.payment }));
    expect(value.payment.paymentEntry.amount).toBe(25);
  });
  it("Step 6 completes zero collection without claiming payment or debt", async () => {
    const value = draft(); await mount(6, value); await click("Complete Visit");
    expect(completePharmacyVisitV2).toHaveBeenCalledWith(value, user, "");
    expect(container.textContent).toContain("saved as completed"); expect(container.textContent).toContain("Not submitted");
    expect(container.textContent).toContain("Not performed"); expect(container.textContent).not.toMatch(/Projected AR|Full Collection|Partial Collection/);
  });
  it("does not connect trusted financial or legacy sync operations", () => {
    for (const file of ["./steps/Step4Payment.tsx", "./steps/Step6CompleteVisit.tsx"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      for (const name of ["syncVisitPaymentCollection", "readCertifiedOpenReceivables", "prepareCollectionSubmission", "createSubmittedCollection", "prepareVerification", "persistVerification", "calculatePaymentReversal", "balanceBefore + netTotal"]) expect(source).not.toContain(name);
    }
  });
});
