import { describe, it, expect } from "vitest";
import { Role, User, Pharmacy } from "../../types";
import { PharmacyVisitDraft, PharmacyVisitGps, PharmacyVisitPurpose, createInitialGpsState, normalizeDraftGps } from "./types/domain";
import { pharmacyVisitReducer, PharmacyVisitState } from "./state/pharmacyVisitReducer";
import { validateStep1PharmacyGps } from "./validation/step1Validation";
import { resolvePharmacyVisitEntry } from "./routing/resolvePharmacyVisitEntry";
import { PharmacyVisitDraftService } from "./services/pharmacyVisitDraftService";
import { LIBYA_MARKET_DEFAULT } from "../../lib/marketSettings";

const testMarket = { ...LIBYA_MARKET_DEFAULT, marketId: "MARKET-TEST", countryId: "COUNTRY-TEST", currencyCode: "TST", currencySymbol: "TST" };

// Mock Users
const repUser: User = {
  id: "cQt7jjLOaHPgBmGCWzdjZm3pojo2",
  name: "Test Sales Rep",
  email: "test-user1@esnad.local",
  role: Role.SALES_REP,
  active: true,
  status: "Active",
  areaIds: ["LY-WEST-TRE2"],
  territory: "Tripoli East / Tajoura",
  region: "West",
  country: "LY"
};

// Mock Authorized Pharmacies
const authPharmacy1: Pharmacy = {
  id: "PHM-TAJ-001",
  name: "Al-Tajoura Central Pharmacy",
  nameAr: "صيدلية التاجوراء المركزية",
  areaId: "LY-WEST-TRE2",
  territory: "Tripoli East / Tajoura",
  region: "West",
  address: "Tajoura Main Street",
  type: "Retail",
  active: true,
  isDeleted: false,
  latitude: 32.88,
  longitude: 13.35,
  outstandingBalance: 1250.0
};

const authPharmacyNoGps: Pharmacy = {
  id: "PHM-TAJ-002",
  name: "Al-Amal Pharmacy",
  nameAr: "صيدلية الأمل",
  areaId: "LY-WEST-TRE2",
  territory: "Tripoli East / Tajoura",
  region: "West",
  address: "Tajoura Center",
  type: "Retail",
  active: true,
  isDeleted: false,
  latitude: 0,
  longitude: 0,
  outstandingBalance: 0
};

const authorizedPharmaciesList: Pharmacy[] = [authPharmacy1, authPharmacyNoGps];

describe("WP6.1C PHARMACY VISIT V2 STEP 1 CERTIFICATION SUITE", () => {
  it("1. Reducer State Transitions & Initial GPS Test", () => {
    const initialDraft: PharmacyVisitDraft = {
      schemaVersion: "2.0",
      draftId: "draft_test_100",
      repUid: repUser.id,
      companyId: "MENAREPS",
      countryId: "LY",
      areaId: "LY-WEST-TRE2",
      entrySource: "DIRECT_MENU",
      status: "NEW",
      currentStep: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deviceSessionId: "session_001",
      localRevision: 1,
      gps: createInitialGpsState()
    };

    expect(initialDraft.gps?.status).toBe("NOT_ACQUIRED");
    expect(initialDraft.gps?.latitude).toBeNull();
    expect(initialDraft.gps?.longitude).toBeNull();

    let state: PharmacyVisitState = { draft: initialDraft, isLoading: false };

    state = pharmacyVisitReducer(state, {
      type: "SET_PHARMACY",
      payload: {
        pharmacyId: authPharmacy1.id,
        areaId: authPharmacy1.areaId!,
        snapshot: {
          id: authPharmacy1.id,
          nameEn: authPharmacy1.name,
          nameAr: authPharmacy1.nameAr,
          type: authPharmacy1.type!,
          areaId: authPharmacy1.areaId!, countryId: "COUNTRY-TEST", marketId: "MARKET-TEST", currencyCode: "TST"
        },
        marketSettings: [testMarket]
      }
    });

    expect(state.draft.pharmacyId).toBe("PHM-TAJ-001");
    expect(state.draft.status).toBe("DRAFT");

    const samplePurpose: PharmacyVisitPurpose = {
      code: "REGULAR_COMMERCIAL_VISIT",
      labelEn: "Regular Commercial Visit & Order Collection",
      labelAr: "زيارة تجارية اعتيادية وتحصيل طلبات"
    };
    state = pharmacyVisitReducer(state, { type: "SET_PURPOSE", payload: samplePurpose });
    expect(state.draft.visitPurpose?.code).toBe("REGULAR_COMMERCIAL_VISIT");

    const valNotAcquired = validateStep1PharmacyGps(state.draft, repUser, authorizedPharmaciesList);
    expect(valNotAcquired.isValid).toBe(false);

    const sampleGps: PharmacyVisitGps = {
      latitude: 32.8801,
      longitude: 13.3501,
      accuracy: 12.5,
      accuracyMeters: 12.5,
      timestamp: new Date().toISOString(),
      capturedAt: new Date().toISOString(),
      source: "device",
      spoofCheckStatus: "Passed",
      pharmacyLatitude: 32.88,
      pharmacyLongitude: 13.35,
      status: "VERIFIED"
    };
    state = pharmacyVisitReducer(state, { type: "SET_GPS", payload: sampleGps });

    expect(state.draft.gps?.status).toBe("VERIFIED");
    expect(state.draft.gps?.latitude).toBe(32.8801);

    const valVerified = validateStep1PharmacyGps(state.draft, repUser, authorizedPharmaciesList);
    expect(valVerified.isValid).toBe(true);

    state = pharmacyVisitReducer(state, { type: "TRANSITION_TO_CHECKED_IN" });
    expect(state.draft.status).toBe("CHECKED_IN");
    expect(state.draft.currentStep).toBe(2);

    const permDeniedGps: PharmacyVisitGps = {
      ...createInitialGpsState(),
      status: "PERMISSION_DENIED",
      errorCode: "PERMISSION_DENIED",
      errorMessage: "Location permission denied"
    };
    const draftPermDenied: PharmacyVisitDraft = { ...state.draft, gps: permDeniedGps };
    const valPermDenied = validateStep1PharmacyGps(draftPermDenied, repUser, authorizedPharmaciesList);
    expect(valPermDenied.isValid).toBe(false);

    const timeoutGps: PharmacyVisitGps = {
      ...createInitialGpsState(),
      status: "TIMEOUT",
      errorCode: "TIMEOUT",
      errorMessage: "GPS request timed out"
    };
    const draftTimeout: PharmacyVisitDraft = { ...state.draft, gps: timeoutGps };
    const valTimeout = validateStep1PharmacyGps(draftTimeout, repUser, authorizedPharmaciesList);
    expect(valTimeout.isValid).toBe(false);

    let stateWithVerifiedGps: PharmacyVisitState = { draft: { ...state.draft, gps: sampleGps }, isLoading: false };
    const stateAfterPharmacyChange = pharmacyVisitReducer(stateWithVerifiedGps, {
      type: "SET_PHARMACY",
      payload: {
        pharmacyId: "PHM-TAJ-002",
        areaId: "LY-WEST-TRE2",
        snapshot: { id: "PHM-TAJ-002", nameEn: "Al-Amal Pharmacy", nameAr: "صيدلية الأمل", type: "Retail", areaId: "LY-WEST-TRE2", countryId: "COUNTRY-TEST", marketId: "MARKET-TEST", currencyCode: "TST" },
        marketSettings: [testMarket]
      }
    });
    expect(stateAfterPharmacyChange.draft.gps?.status).toBe("NOT_ACQUIRED");

    const legacyDemoDraft: PharmacyVisitDraft = {
      ...initialDraft,
      gps: {
        status: "VERIFIED" as any,
        latitude: 32.88720,
        longitude: 13.19130,
        accuracy: 15,
        timestamp: "",
        source: "simulation_demo"
      }
    };
    const normalizedDraft = normalizeDraftGps(legacyDemoDraft);
    expect(normalizedDraft.gps?.status).toBe("NOT_ACQUIRED");
  });

  it("2. Comprehensive First-Visit and Verified GPS Policy Scenarios", () => {
    const baseDraft: PharmacyVisitDraft = {
      schemaVersion: "2.0",
      draftId: "draft_gps_scenarios",
      repUid: repUser.id,
      companyId: "MENAREPS",
      countryId: "LY",
      areaId: "LY-WEST-TRE2",
      pharmacyId: authPharmacy1.id,
      visitPurpose: {
        code: "REGULAR_COMMERCIAL_VISIT",
        labelEn: "Regular Commercial Visit",
        labelAr: "زيارة تجارية"
      },
      entrySource: "DIRECT_MENU",
      status: "DRAFT",
      currentStep: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deviceSessionId: "session_001",
      localRevision: 1
    };

    // 1. Unverified Pharmacy with no GPS remains blocked
    const draftNoGps = { ...baseDraft, gps: createInitialGpsState() };
    const res1 = validateStep1PharmacyGps(draftNoGps, repUser, authorizedPharmaciesList);
    expect(res1.isValid).toBe(false);

    // 2. Unverified Pharmacy with valid real inside-radius capture is allowed
    const draftInsideGps: PharmacyVisitDraft = {
      ...baseDraft,
      gps: {
        latitude: 32.8801,
        longitude: 13.3501,
        accuracy: 10,
        timestamp: new Date().toISOString(),
        source: "device",
        status: "VERIFIED"
      }
    };
    const res2 = validateStep1PharmacyGps(draftInsideGps, repUser, authorizedPharmaciesList);
    expect(res2.isValid).toBe(true);

    // 3. Unverified Pharmacy with valid real outside-radius capture is allowed with warning
    const draftOutsideGps: PharmacyVisitDraft = {
      ...baseDraft,
      gps: {
        latitude: 32.9000,
        longitude: 13.4000,
        accuracy: 15,
        timestamp: new Date().toISOString(),
        source: "device",
        status: "VERIFIED"
      }
    };
    const res3 = validateStep1PharmacyGps(draftOutsideGps, repUser, authorizedPharmaciesList);
    expect(res3.isValid).toBe(true);

    // 4 & 5. Manually entered / imported master coordinates do not hard-block first registration
    const importedPharmacy: Pharmacy = {
      ...authPharmacy1,
      id: "PHM-IMP-001",
      importBatchId: "batch_2026_01",
      source: "import"
    };
    const draftImported = { ...baseDraft, pharmacyId: importedPharmacy.id, gps: draftOutsideGps.gps };
    const res4 = validateStep1PharmacyGps(draftImported, repUser, [importedPharmacy]);
    expect(res4.isValid).toBe(true);

    // 6. Simulation remains blocked
    const draftSimGps: PharmacyVisitDraft = {
      ...baseDraft,
      gps: {
        latitude: 32.8801,
        longitude: 13.3501,
        accuracy: 10,
        timestamp: new Date().toISOString(),
        source: "simulation_demo",
        status: "VERIFIED"
      }
    };
    const res6 = validateStep1PharmacyGps(draftSimGps, repUser, authorizedPharmaciesList);
    expect(res6.isValid).toBe(false);

    // 7. Permission denied remains blocked for unverified Pharmacy
    const draftPermDenied: PharmacyVisitDraft = {
      ...baseDraft,
      gps: { ...createInitialGpsState(), status: "PERMISSION_DENIED" }
    };
    const res7 = validateStep1PharmacyGps(draftPermDenied, repUser, authorizedPharmaciesList);
    expect(res7.isValid).toBe(false);

    // 8. Timeout remains blocked for unverified Pharmacy
    const draftTimeout: PharmacyVisitDraft = {
      ...baseDraft,
      gps: { ...createInitialGpsState(), status: "TIMEOUT" }
    };
    const res8 = validateStep1PharmacyGps(draftTimeout, repUser, authorizedPharmaciesList);
    expect(res8.isValid).toBe(false);

    // 9. Verified Pharmacy without GPS is allowed
    const verifiedPharmacy: Pharmacy = {
      ...authPharmacy1,
      id: "PHM-VER-001",
      gpsVerified: true,
      gpsVerifiedAt: new Date().toISOString(),
      gpsVerificationStatus: "VERIFIED"
    };
    const draftVerifiedNoGps = {
      ...baseDraft,
      pharmacyId: verifiedPharmacy.id,
      gps: createInitialGpsState()
    };
    const res9 = validateStep1PharmacyGps(draftVerifiedNoGps, repUser, [verifiedPharmacy]);
    expect(res9.isValid).toBe(true);

    // 10. Verified Pharmacy outside radius is allowed with warning
    const draftVerifiedOutside = {
      ...baseDraft,
      pharmacyId: verifiedPharmacy.id,
      gps: draftOutsideGps.gps
    };
    const res10 = validateStep1PharmacyGps(draftVerifiedOutside, repUser, [verifiedPharmacy]);
    expect(res10.isValid).toBe(true);

    // 11. Area unauthorized remains blocked
    const unauthPharmacy: Pharmacy = {
      ...authPharmacy1,
      id: "PHM-UNAUTH-001",
      areaId: "LY-EAST-BEN1",
      territory: "Benghazi Central"
    };
    const draftUnauth = {
      ...baseDraft,
      pharmacyId: unauthPharmacy.id,
      gps: draftInsideGps.gps
    };
    const res11 = validateStep1PharmacyGps(draftUnauth, repUser, [unauthPharmacy]);
    expect(res11.isValid).toBe(false);
  });

  it("3. Routing Entry Resolution Test", () => {
    const directRes = resolvePharmacyVisitEntry({ entrySource: "DIRECT_MENU" }, repUser, authorizedPharmaciesList);
    expect(directRes.valid).toBe(true);

    const prefRes = resolvePharmacyVisitEntry(
      { entrySource: "PHARMACY_LIST", pharmacyId: "PHM-TAJ-001" },
      repUser,
      authorizedPharmaciesList
    );
    expect(prefRes.valid).toBe(true);

    const unauthRes = resolvePharmacyVisitEntry(
      { entrySource: "PHARMACY_LIST", pharmacyId: "PHM-BEN-001" },
      repUser,
      authorizedPharmaciesList
    );
    expect(unauthRes.valid).toBe(false);
  });

  it("4. Local Draft Storage Service Test", async () => {
    const mockStorage: Record<string, string> = {};
    global.localStorage = {
      getItem: (key: string) => mockStorage[key] || null,
      setItem: (key: string, val: string) => { mockStorage[key] = val; },
      removeItem: (key: string) => { delete mockStorage[key]; },
      clear: () => { Object.keys(mockStorage).forEach(k => delete mockStorage[k]); },
      key: (i: number) => Object.keys(mockStorage)[i] || null,
      length: 0
    } as any;

    const draftToSave: PharmacyVisitDraft = {
      schemaVersion: "2.0",
      draftId: "draft_local_001",
      repUid: repUser.id,
      companyId: "MENAREPS",
      countryId: "LY",
      areaId: "LY-WEST-TRE2",
      pharmacyId: "PHM-TAJ-001",
      entrySource: "DIRECT_MENU",
      status: "DRAFT",
      currentStep: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deviceSessionId: "session_001",
      localRevision: 1
    };

    PharmacyVisitDraftService.saveDraftLocally(draftToSave);
    const loaded = await PharmacyVisitDraftService.loadDraftLocally(repUser.id, "draft_local_001");
    expect(loaded?.draftId).toBe("draft_local_001");

    const otherUserLoaded = await PharmacyVisitDraftService.loadDraftLocally("other_user_id", "draft_local_001");
    expect(otherUserLoaded).toBeNull();

    await PharmacyVisitDraftService.discardDraft(repUser.id, "draft_local_001");
    const discarded = await PharmacyVisitDraftService.loadDraftLocally(repUser.id, "draft_local_001");
    expect(discarded).toBeNull();
  });
});
