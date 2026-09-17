import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role, type User } from "../../types";
import type { PharmacyVisitDraft } from "./types/domain";
import { completePharmacyVisitV2 } from "./services/completePharmacyVisitV2";
import { completePharmacyVisitAuthoritatively } from "../../lib/pharmacyVisitCompletionClient";

vi.mock("../../lib/pharmacyVisitCompletionClient", () => ({ completePharmacyVisitAuthoritatively: vi.fn() }));
vi.mock("../../lib/pharmacyOrderCreateClient", () => ({ createOrderFromCompletedPharmacyVisit: vi.fn(async () => ({ orderId: "ORD_VISIT", displayNumber: "ZX-SO-2030-000001" })) }));
vi.mock("./services/pharmacyVisitDraftService", () => ({ PharmacyVisitDraftService: { saveDraftLocally: vi.fn() } }));

const actor = { id: "REP-A", name: "Rep", role: Role.SALES_REP, active: true, status: "Active" } as User;
const draft = (): PharmacyVisitDraft => ({ schemaVersion: "2.0", draftId: "DRAFT-A", repUid: actor.id, companyId: "ORG", countryId: "C1", areaId: "A1", pharmacyId: "PH1", pharmacySnapshot: { id: "PH1", nameEn: "Pharmacy", type: "Retail", areaId: "A1" }, entrySource: "PHARMACY_LIST", status: "REVIEW_READY", currentStep: 6, visitPurpose: { code: "REGULAR_COMMERCIAL_VISIT", labelEn: "Regular", labelAr: "Regular" }, order: { lines: [{ id: "L1", canonicalProductId: "P1", productCode: "P1", productNameSnapshot: "Product", quantity: 1, unitPricePreview: 1, lineTotalPreview: 1, currency: "TST", inputSource: "MANUAL", userConfirmed: true, userCorrected: false, createdAt: "2030-01-01", updatedAt: "2030-01-01" }], subtotalPreview: 1, currency: "TST", updatedAt: "2030-01-01" }, offers: { eligibleOffers: [], ineligibleOffers: [], appliedOffers: [], conflicts: [], calculation: { grossSubtotal: 1, totalDiscountAmount: 0, netTotal: 1, appliedOfferCount: 0, hasConflicts: false, calculatedAt: "2030-01-01" } }, payment: { paymentEntry: { amount: 0, method: "CASH" }, financialContext: { outstandingBalanceBefore: 0, projectedNetOrder: 1, projectedBalanceAfter: 1 } }, stock: { requestLines: [] }, createdAt: "2030-01-01", updatedAt: "2030-01-01", deviceSessionId: "S1", localRevision: 1 });

describe("WP102 governed Pharmacy Visit completion client", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(completePharmacyVisitAuthoritatively).mockResolvedValue({ success: true, visitId: "VISIT", displayNumber: "ZX-PV-2030-000001" }); });
  it("submits the validated draft to backend authority", async () => { const input = draft(); expect((await completePharmacyVisitV2(input, actor)).success).toBe(true); expect(completePharmacyVisitAuthoritatively).toHaveBeenCalledWith(input, undefined); });
  it("rejects forged representative ownership before submission", async () => { const result = await completePharmacyVisitV2({ ...draft(), repUid: "OTHER" }, actor); expect(result.success).toBe(false); expect(completePharmacyVisitAuthoritatively).not.toHaveBeenCalled(); });
  it("propagates authoritative backend denial", async () => { vi.mocked(completePharmacyVisitAuthoritatively).mockRejectedValue(new Error("PHARMACY_OUTSIDE_AUTHORIZED_AREA")); const result = await completePharmacyVisitV2(draft(), actor); expect(result.errors).toEqual(["PHARMACY_OUTSIDE_AUTHORIZED_AREA"]); });
});
