import { describe, it, expect, beforeEach, vi } from "vitest";
import { PharmacyVisitDraftService } from "./services/pharmacyVisitDraftService";
import { PharmacyVisitDraft } from "./types/domain";

if (typeof localStorage === "undefined") {
  const store: Record<string, string> = {};
  globalThis.localStorage = {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => { store[key] = value.toString(); },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
    key: (index: number) => Object.keys(store)[index] || null,
    get length() { return Object.keys(store).length; }
  } as any;
}

describe("WP6.5 — Resumable Pharmacy Visit Drafts Certification", () => {
  const repA = "rep_user_alpha";
  const repB = "rep_user_beta";

  const draftA1: PharmacyVisitDraft = {
    schemaVersion: "2.0",
    draftId: "pv_draft_alpha_101",
    repUid: repA,
    companyId: "MENAREPS",
    countryId: "LY",
    areaId: "LY-WEST-TRE2",
    pharmacyId: "PHM-001",
    pharmacySnapshot: {
      id: "PHM-001",
      nameEn: "Alpha Pharmacy",
      type: "Retail",
      areaId: "LY-WEST-TRE2"
    },
    entrySource: "PHARMACY_LIST",
    status: "IN_PROGRESS",
    currentStep: 3,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    gps: {
      latitude: 32.8801,
      longitude: 13.3501,
      accuracy: 12,
      timestamp: new Date().toISOString(),
      source: "device",
      status: "VERIFIED"
    },
    order: {
      lines: [
        {
          id: "line_1",
          canonicalProductId: "PRD-101",
          productCode: "P-101",
          productNameSnapshot: "Paracetamol 500mg",
          quantity: 10,
          unitPricePreview: 5.0,
          lineTotalPreview: 50.0,
          currency: "LYD",
          inputSource: "MANUAL",
          userConfirmed: true,
          userCorrected: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      subtotalPreview: 50.0,
      currency: "LYD",
      updatedAt: new Date().toISOString()
    }
  };

  const draftB1: PharmacyVisitDraft = {
    schemaVersion: "2.0",
    draftId: "pv_draft_beta_201",
    repUid: repB,
    companyId: "MENAREPS",
    countryId: "LY",
    areaId: "LY-WEST-TRW1",
    pharmacyId: "PHM-002",
    entrySource: "DIRECT_MENU",
    status: "CHECKED_IN",
    currentStep: 2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  beforeEach(() => {
    localStorage.clear();
  });

  it("1. Draft is created and saved locally", async () => {
    await PharmacyVisitDraftService.saveDraft(draftA1);
    const loaded = await PharmacyVisitDraftService.loadDraftLocally(repA, draftA1.draftId);

    expect(loaded).not.toBeNull();
    expect(loaded?.draftId).toBe(draftA1.draftId);
    expect(loaded?.repUid).toBe(repA);
  });

  it("2. Draft persists and reloads accurately", async () => {
    await PharmacyVisitDraftService.saveDraft(draftA1);
    const loaded = await PharmacyVisitDraftService.loadDraftLocally(repA, draftA1.draftId);

    expect(loaded?.pharmacyId).toBe("PHM-001");
    expect(loaded?.order?.lines.length).toBe(1);
    expect(loaded?.order?.lines[0].canonicalProductId).toBe("PRD-101");
  });

  it("3. Representative sees only own drafts", async () => {
    await PharmacyVisitDraftService.saveDraft(draftA1);
    await PharmacyVisitDraftService.saveDraft(draftB1);

    const repADrafts = await PharmacyVisitDraftService.getAllLocalDrafts(repA);
    const repBDrafts = await PharmacyVisitDraftService.getAllLocalDrafts(repB);

    expect(repADrafts.length).toBe(1);
    expect(repADrafts[0].draftId).toBe(draftA1.draftId);

    expect(repBDrafts.length).toBe(1);
    expect(repBDrafts[0].draftId).toBe(draftB1.draftId);
  });

  it("4. Resume restores currentStep, GPS, and Order lines", async () => {
    await PharmacyVisitDraftService.saveDraft(draftA1);
    const loaded = await PharmacyVisitDraftService.loadDraftLocally(repA, draftA1.draftId);

    expect(loaded?.currentStep).toBe(3);
    expect(loaded?.gps?.status).toBe("VERIFIED");
    expect(loaded?.gps?.latitude).toBe(32.8801);
    expect(loaded?.order?.lines[0].quantity).toBe(10);
  });

  it("5. Resume keeps same draftId", async () => {
    await PharmacyVisitDraftService.saveDraft(draftA1);
    const activeDraft = await PharmacyVisitDraftService.findActiveDraftForPharmacy(repA, "PHM-001");

    expect(activeDraft).not.toBeNull();
    expect(activeDraft?.draftId).toBe("pv_draft_alpha_101");
  });

  it("6. Failed completion remains recoverable with status FAILED_COMPLETION", async () => {
    const failedDraft: PharmacyVisitDraft = {
      ...draftA1,
      draftId: "pv_draft_failed_999",
      status: "FAILED_COMPLETION",
      currentStep: 6
    };

    await PharmacyVisitDraftService.saveDraft(failedDraft);
    const loaded = await PharmacyVisitDraftService.loadDraftLocally(repA, "pv_draft_failed_999");

    expect(loaded).not.toBeNull();
    expect(loaded?.status).toBe("FAILED_COMPLETION");
    expect(loaded?.currentStep).toBe(6);

    const allActive = await PharmacyVisitDraftService.getAllLocalDrafts(repA);
    expect(allActive.some((d) => d.draftId === "pv_draft_failed_999")).toBe(true);
  });

  it("7. Discard removes draft from active list", async () => {
    await PharmacyVisitDraftService.saveDraft(draftA1);
    let active = await PharmacyVisitDraftService.getAllLocalDrafts(repA);
    expect(active.length).toBe(1);

    await PharmacyVisitDraftService.discardDraft(repA, draftA1.draftId);
    active = await PharmacyVisitDraftService.getAllLocalDrafts(repA);
    expect(active.length).toBe(0);

    const reloaded = await PharmacyVisitDraftService.loadDraftLocally(repA, draftA1.draftId);
    expect(reloaded).toBeNull();
  });

  it("8. Completed draft cannot be resumed", async () => {
    const completedDraft: PharmacyVisitDraft = {
      ...draftA1,
      draftId: "pv_draft_completed_888",
      status: "COMPLETED"
    };

    await PharmacyVisitDraftService.saveDraft(completedDraft);
    const active = await PharmacyVisitDraftService.getAllLocalDrafts(repA);

    expect(active.some((d) => d.draftId === "pv_draft_completed_888")).toBe(false);

    const activeForPharm = await PharmacyVisitDraftService.findActiveDraftForPharmacy(repA, "PHM-001");
    expect(activeForPharm?.draftId).not.toBe("pv_draft_completed_888");
  });
});
