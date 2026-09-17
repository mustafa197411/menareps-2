import { afterEach, describe, expect, it, vi } from "vitest";
import { validateStep3 } from "./validation/validateStep3";
vi.mock("./validation/validateStep2", () => ({ validateStep2OrderDraft: () => ({ isValid: true }) }));
afterEach(() => vi.restoreAllMocks());
describe("canonical Offer diagnostic representation", () => {
  it.each([false, true])("reports selection and confirmation separately; confirmed=%s", confirmed => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    expect(validateStep3({ offerIntent: [{ selected: true, confirmed }] } as any).isValid).toBe(true);
    const report = JSON.parse(log.mock.calls[0][1]);
    expect(report).toMatchObject({ selectedOfferCount: 1, confirmedOfferCount: confirmed ? 1 : 0, authoritativeApplicationStatus: "NOT_EVALUATED_AT_THIS_STAGE" });
    expect(report).not.toHaveProperty("appliedOfferCount");
  });
  it("does not weaken legacy validation or relabel preview as application", () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    expect(validateStep3({ offers: { appliedOffers: [{ offerId: "SYNTH-O" }], eligibleOffers: [], conflicts: [] } } as any).isValid).toBe(false);
    const report = JSON.parse(log.mock.calls[0][1]);
    expect(report.legacyPreviewOfferCount).toBe(1);
    expect(report).not.toHaveProperty("appliedOfferCount");
  });
});
