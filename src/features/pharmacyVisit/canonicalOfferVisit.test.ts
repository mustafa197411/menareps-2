import { describe, expect, it } from "vitest";
import { buildOfferDraftIntent, offerInputFingerprint, sanitizeDraftOffers, sanitizeOfferDraftIntent, validateOfferProceed } from "./services/canonicalOfferVisit";
import { pharmacyVisitReducer } from "./state/pharmacyVisitReducer";

const base = { currencyCode: "JOD", decimalPlaces: 3, roundingMode: "DECIMAL_HALF_EVEN" as const, paidLines: [{ lineId: "L2", productId: "P2", quantity: 2, unitPrice: 1 }, { lineId: "L1", productId: "P1", quantity: 1, unitPrice: 2 }] };
describe("Pharmacy Visit Offer intent", () => {
  it("creates a stable basis independent of line order", () => { expect(offerInputFingerprint(base)).toBe(offerInputFingerprint({ ...base, paidLines: [...base.paidLines].reverse() })); });
  it("selection is not confirmation and a material input change requires reconfirmation", () => { const first = offerInputFingerprint(base); const changed = offerInputFingerprint({ ...base, paidLines: [{ ...base.paidLines[0], quantity: 3 }, base.paidLines[1]] }); expect(buildOfferDraftIntent({ id: "O1", offerVersion: 1 }, first).confirmed).toBe(false); expect(buildOfferDraftIntent({ id: "O1", offerVersion: 1 }, first, first, "2026-01-01T00:00:00Z").confirmed).toBe(true); expect(buildOfferDraftIntent({ id: "O1", offerVersion: 1 }, changed, first).confirmed).toBe(false); });
  it("restores recognizable intent but always requires reconfirmation", () => { expect(sanitizeOfferDraftIntent([{ offerId: "O1", offerVersion: 2, calculationVersion: "MENAREPS_OFFERS_V1", inputFingerprint: "basis", selected: true, confirmed: true, confirmedAt: "x", definition: { unsafe: true } }])).toEqual([{ offerId: "O1", offerVersion: 2, calculationVersion: "MENAREPS_OFFERS_V1", inputFingerprint: "basis", selected: true, confirmed: false }]); });
  it("discards embedded legacy snapshots and malformed values", () => { expect(sanitizeDraftOffers({ appliedOffers: [{ offerId: "O1", version: "1.0", discountAmountPreview: 100, offer: { type: "FIXED_DISCOUNT" } }] })).toEqual([]); expect(sanitizeDraftOffers({ eligibleOffers: [{ unsafe: true }], calculation: { net: 1 } })).toEqual([]); });
  it("drops duplicates and blank IDs", () => { expect(sanitizeOfferDraftIntent([{ offerId: "", offerVersion: 1 }, { offerId: "O", offerVersion: 1, calculationVersion: "V", inputFingerprint: "B", selected: true }, { offerId: "O", offerVersion: 1, calculationVersion: "V", inputFingerprint: "B", selected: true }])).toHaveLength(1); });
  it("allows no-Offer visits and blocks unconfirmed, stale, rejected and invalid calculations", () => {
    const applied = { success: true, appliedOffers: [{ offerId: "O1" }], rejectedOffers: [], conflicts: [] } as any;
    expect(validateOfferProceed([], "B", null).valid).toBe(true);
    expect(validateOfferProceed([{ offerId: "O1", offerVersion: 1, calculationVersion: "V", selected: true, confirmed: false, inputFingerprint: "B" }], "B", applied).errors).toContain("OFFER_CONFIRMATION_REQUIRED:O1");
    expect(validateOfferProceed([{ offerId: "O1", offerVersion: 1, calculationVersion: "V", selected: true, confirmed: true, inputFingerprint: "OLD" }], "B", applied).errors).toContain("OFFER_CONFIRMATION_STALE:O1");
    expect(validateOfferProceed([{ offerId: "O1", offerVersion: 1, calculationVersion: "V", selected: true, confirmed: true, inputFingerprint: "B" }], "B", { ...applied, appliedOffers: [], rejectedOffers: [{ offerId: "O1" }] }).errors).toContain("OFFER_SELECTED_NOT_APPLIED:O1");
    expect(validateOfferProceed([{ offerId: "O1", offerVersion: 1, calculationVersion: "V", selected: true, confirmed: true, inputFingerprint: "B" }], "B", { success: false, errors: [] } as any).errors).toContain("OFFER_CALCULATION_INVALID");
  });
  it("atomically removes a deterministic paid/free bundle and invalidates remaining confirmations", () => {
    const line = (id: string) => ({ id, canonicalProductId: id, productCode: id, productNameSnapshot: id, quantity: 2, unitPricePreview: 5, lineTotalPreview: 10, currency: "JOD", inputSource: "MANUAL", userConfirmed: true, userCorrected: false, createdAt: "x", updatedAt: "x" });
    const draft: any = { schemaVersion: "2.0", draftId: "D", repUid: "R", companyId: "C", countryId: "C1", areaId: "A", status: "IN_PROGRESS", currentStep: 3, entrySource: "DIRECT_MENU", createdAt: "x", updatedAt: "x", deviceSessionId: "S", localRevision: 1, order: { lines: [line("L1"), line("L2")], subtotalPreview: 20, currency: "JOD", updatedAt: "x" }, offerIntent: [{ offerId: "O1", confirmed: true }, { offerId: "O2", confirmed: true }] };
    const result = pharmacyVisitReducer({ draft, isLoading: false }, { type: "REMOVE_PROMOTIONAL_BUNDLE", payload: { offerId: "O1", triggerPaidLineIds: ["L1"] } });
    expect(result.draft.order.lines.map((item: any) => item.id)).toEqual(["L2"]);
    expect(result.draft.order.subtotalPreview).toBe(10);
    expect(result.draft.offerIntent).toEqual([{ offerId: "O2", confirmed: false, confirmedAt: undefined }]);
    expect(result.draft.offers).toBeUndefined();
  });
});
