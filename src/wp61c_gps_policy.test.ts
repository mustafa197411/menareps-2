import { describe, it, expect } from "vitest";
import {
  resolveCustomerGpsVerificationStatus,
  isCustomerAreaAuthorized,
  evaluateGpsPolicyDecision,
  CustomerGpsTarget
} from "./features/pharmacyVisit/services/customerGpsPolicyService";
import { pharmacyVisitReducer, PharmacyVisitState } from "./features/pharmacyVisit/state/pharmacyVisitReducer";
import { validateStep1PharmacyGps } from "./features/pharmacyVisit/validation/step1Validation";
import { validateStep6 } from "./features/pharmacyVisit/validation/validateStep6";
import { auditCustomerDataset, isKnownDefaultCoordinate } from "./utils/auditGpsRecords";
import { sanitizeAndAuditPayload } from "./utils/importNormalization";
import { User, Physician, Pharmacy } from "./types";
import { PharmacyVisitDraft, PharmacyVisitGps } from "./features/pharmacyVisit/types/domain";

describe("WP6.1C First-Visit-Only Global GPS Compliance Suite (20 Scenarios)", () => {
  const mockUser: User = {
    id: "USR-REP-01",
    name: "Sales Rep 1",
    email: "rep1@menareps.com",
    role: "Sales Representative" as any,
    status: "Active",
    userAreas: ["Tripoli District / Tripoli / Al-Dhahra", "Tabarbour"]
  };

  const repB: User = {
    id: "USR-REP-02",
    name: "Sales Rep 2",
    email: "rep2@menareps.com",
    role: "Sales Representative" as any,
    status: "Active",
    userAreas: ["Tripoli District / Tripoli / Al-Dhahra", "Tabarbour"]
  };

  it("1. Registration / Import: New Physician without GPS has null coords & UNVERIFIED status", () => {
    const rawPhysician = {
      name: "Dr. Salem Mansour",
      specialty: "Cardiology",
      latitude: null,
      longitude: null,
      gpsVerified: false,
      gpsVerificationStatus: "UNVERIFIED"
    };
    const sanitized = sanitizeAndAuditPayload("Physician", "PHYS-01", rawPhysician);
    expect(sanitized.latitude).toBeNull();
    expect(sanitized.longitude).toBeNull();
    expect(sanitized.gpsVerified).toBe(false);
    expect(sanitized.gpsVerificationStatus).toBe("UNVERIFIED");
  });

  it("2. Registration / Import: New Pharmacy without GPS has null coords & UNVERIFIED status", () => {
    const rawPharmacy = {
      name: "Al-Eman Pharmacy",
      latitude: null,
      longitude: null,
      gpsVerified: false,
      gpsVerificationStatus: "UNVERIFIED"
    };
    const sanitized = sanitizeAndAuditPayload("Pharmacy", "PHARM-01", rawPharmacy);
    expect(sanitized.latitude).toBeNull();
    expect(sanitized.longitude).toBeNull();
    expect(sanitized.gpsVerified).toBe(false);
    expect(sanitized.gpsVerificationStatus).toBe("UNVERIFIED");
  });

  it("3. Import Normalization: Import record with no GPS results in clean UNVERIFIED status", () => {
    const importPharmacy = {
      name: "Al-Majd Pharmacy",
      latitude: null,
      longitude: null,
      gpsVerified: false,
      gpsVerificationStatus: "UNVERIFIED",
      importBatchId: "BATCH-2026-001"
    };
    const sanitized = sanitizeAndAuditPayload("Pharmacy", "PHARM-IMP-01", importPharmacy);
    expect(sanitized.latitude).toBeNull();
    expect(sanitized.longitude).toBeNull();
    expect(sanitized.gpsVerified).toBe(false);

    const target: CustomerGpsTarget = {
      id: "PHARM-IMP-01",
      latitude: sanitized.latitude,
      longitude: sanitized.longitude,
      gpsVerified: sanitized.gpsVerified,
      gpsVerificationStatus: sanitized.gpsVerificationStatus,
      importBatchId: sanitized.importBatchId
    };
    expect(resolveCustomerGpsVerificationStatus(target)).toBe("UNVERIFIED");
  });

  it("4. Physician First Visit: Customer UNVERIFIED requires live GPS capture", () => {
    const unverifiedPhysician: CustomerGpsTarget = {
      id: "PHYS-01",
      type: "PHYSICIAN",
      areaId: "Tabarbour",
      latitude: null,
      longitude: null,
      gpsVerified: false,
      gpsVerificationStatus: "UNVERIFIED"
    };
    const decision = evaluateGpsPolicyDecision({
      currentUser: mockUser,
      customer: unverifiedPhysician,
      userAreas: ["Tabarbour"],
      visitGps: null
    });
    expect(decision.customerGpsStatus).toBe("UNVERIFIED");
    expect(decision.gpsCaptureRequired).toBe(true);
    expect(decision.canProceedToStep2).toBe(false);
  });

  it("5. Physician First Visit: Valid live GPS captured allows proceeding", () => {
    const unverifiedPhysician: CustomerGpsTarget = {
      id: "PHYS-01",
      type: "PHYSICIAN",
      areaId: "Tabarbour",
      latitude: null,
      longitude: null,
      gpsVerified: false,
      gpsVerificationStatus: "UNVERIFIED"
    };
    const capturedGps: PharmacyVisitGps = {
      latitude: 32.8875,
      longitude: 13.192,
      accuracy: 10,
      accuracyMeters: 10,
      source: "device",
      status: "ACQUIRED"
    };
    const decision = evaluateGpsPolicyDecision({
      currentUser: mockUser,
      customer: unverifiedPhysician,
      userAreas: ["Tabarbour"],
      visitGps: capturedGps
    });
    expect(decision.customerGpsStatus).toBe("UNVERIFIED");
    expect(decision.gpsCaptureRequired).toBe(true);
    expect(decision.canProceedToStep2).toBe(true);
  });

  it("6. Physician Second Visit: Customer now VERIFIED allows immediate proceed without GPS", () => {
    const verifiedPhysician: CustomerGpsTarget = {
      id: "PHYS-01",
      type: "PHYSICIAN",
      areaId: "Tabarbour",
      latitude: 32.8875,
      longitude: 13.192,
      gpsVerified: true,
      gpsVerificationStatus: "VERIFIED",
      gpsVerifiedAt: "2026-03-01T10:00:00Z",
      gpsVerifiedByUid: "USR-REP-01"
    };
    const decision = evaluateGpsPolicyDecision({
      currentUser: mockUser,
      customer: verifiedPhysician,
      userAreas: ["Tabarbour"],
      visitGps: null
    });
    expect(decision.customerGpsStatus).toBe("VERIFIED");
    expect(decision.gpsCaptureRequired).toBe(false);
    expect(decision.canProceedToStep2).toBe(true);
  });

  it("7. Physician Later Visit: Zero GPS operations required when customer is VERIFIED", () => {
    const verifiedPhysician: CustomerGpsTarget = {
      id: "PHYS-01",
      type: "PHYSICIAN",
      areaId: "Tabarbour",
      latitude: 32.8875,
      longitude: 13.192,
      gpsVerified: true,
      gpsVerificationStatus: "VERIFIED"
    };
    const decision = evaluateGpsPolicyDecision({
      currentUser: mockUser,
      customer: verifiedPhysician,
      userAreas: ["Tabarbour"],
      visitGps: null
    });
    expect(decision.gpsCaptureRequired).toBe(false);
    expect(decision.canProceedToStep2).toBe(true);
    expect(decision.reasons).toContain("Customer location is globally verified. Proceeding without GPS operation.");
  });

  it("8. Pharmacy First Visit: Customer UNVERIFIED requires live GPS capture", () => {
    const unverifiedPharmacy: CustomerGpsTarget = {
      id: "PHARM-01",
      type: "PHARMACY",
      areaId: "Tabarbour",
      latitude: null,
      longitude: null,
      gpsVerified: false,
      gpsVerificationStatus: "UNVERIFIED"
    };
    const decision = evaluateGpsPolicyDecision({
      currentUser: mockUser,
      customer: unverifiedPharmacy,
      userAreas: ["Tabarbour"],
      visitGps: null
    });
    expect(decision.customerGpsStatus).toBe("UNVERIFIED");
    expect(decision.gpsCaptureRequired).toBe(true);
    expect(decision.canProceedToStep2).toBe(false);
  });

  it("9. Pharmacy First Visit: Valid live GPS captured allows proceeding", () => {
    const unverifiedPharmacy: CustomerGpsTarget = {
      id: "PHARM-01",
      type: "PHARMACY",
      areaId: "Tabarbour",
      latitude: null,
      longitude: null,
      gpsVerified: false,
      gpsVerificationStatus: "UNVERIFIED"
    };
    const capturedGps: PharmacyVisitGps = {
      latitude: 32.8875,
      longitude: 13.192,
      accuracy: 12,
      accuracyMeters: 12,
      source: "device",
      status: "ACQUIRED"
    };
    const decision = evaluateGpsPolicyDecision({
      currentUser: mockUser,
      customer: unverifiedPharmacy,
      userAreas: ["Tabarbour"],
      visitGps: capturedGps
    });
    expect(decision.canProceedToStep2).toBe(true);
  });

  it("10. Pharmacy Second Visit: Customer now VERIFIED allows immediate proceed without GPS", () => {
    const verifiedPharmacy: CustomerGpsTarget = {
      id: "PHARM-01",
      type: "PHARMACY",
      areaId: "Tabarbour",
      latitude: 32.8875,
      longitude: 13.192,
      gpsVerified: true,
      gpsVerificationStatus: "VERIFIED",
      gpsVerifiedAt: "2026-03-01T10:00:00Z",
      gpsVerifiedByUid: "USR-REP-01"
    };
    const decision = evaluateGpsPolicyDecision({
      currentUser: mockUser,
      customer: verifiedPharmacy,
      userAreas: ["Tabarbour"],
      visitGps: null
    });
    expect(decision.customerGpsStatus).toBe("VERIFIED");
    expect(decision.gpsCaptureRequired).toBe(false);
    expect(decision.canProceedToStep2).toBe(true);
  });

  it("11. Pharmacy Later Visit: Zero GPS operations required when customer is VERIFIED", () => {
    const verifiedPharmacy: CustomerGpsTarget = {
      id: "PHARM-01",
      type: "PHARMACY",
      areaId: "Tabarbour",
      latitude: 32.8875,
      longitude: 13.192,
      gpsVerified: true,
      gpsVerificationStatus: "VERIFIED"
    };
    const decision = evaluateGpsPolicyDecision({
      currentUser: mockUser,
      customer: verifiedPharmacy,
      userAreas: ["Tabarbour"],
      visitGps: null
    });
    expect(decision.gpsCaptureRequired).toBe(false);
    expect(decision.canProceedToStep2).toBe(true);
  });

  it("12. Policy Output Verification: Verified decision contains no legacy fields", () => {
    const verifiedCustomer: CustomerGpsTarget = {
      id: "PHARM-01",
      areaId: "Tabarbour",
      latitude: 32.8875,
      longitude: 13.192,
      gpsVerified: true,
      gpsVerificationStatus: "VERIFIED"
    };
    const decision = evaluateGpsPolicyDecision({
      currentUser: mockUser,
      customer: verifiedCustomer,
      userAreas: ["Tabarbour"],
      visitGps: null
    });
    expect(decision.customerGpsStatus).toBe("VERIFIED");
    expect(decision.gpsCaptureRequired).toBe(false);
    expect(decision.canProceedToStep2).toBe(true);

    const keys = Object.keys(decision);
    expect(keys).not.toContain("gpsCaptureOptional");
    expect(keys).not.toContain("distanceMeters");
    expect(keys).not.toContain("thresholdMeters");
    expect(keys).not.toContain("outsideRadiusBehavior");
    expect(keys).not.toContain("reverificationProposal");
  });

  it("13. Global Verification Sharing: Verified by Rep A is recognized as VERIFIED for Rep B", () => {
    const verifiedByRepA: CustomerGpsTarget = {
      id: "PHARM-01",
      areaId: "Tabarbour",
      latitude: 32.8875,
      longitude: 13.192,
      gpsVerified: true,
      gpsVerificationStatus: "VERIFIED",
      gpsVerifiedAt: "2026-03-01T10:00:00Z",
      gpsVerifiedByUid: "USR-REP-01"
    };

    const decisionRepB = evaluateGpsPolicyDecision({
      currentUser: repB,
      customer: verifiedByRepA,
      userAreas: ["Tabarbour"],
      visitGps: null
    });
    expect(decisionRepB.customerGpsStatus).toBe("VERIFIED");
    expect(decisionRepB.gpsCaptureRequired).toBe(false);
    expect(decisionRepB.canProceedToStep2).toBe(true);
  });

  it("14. Demo GPS Rejection: Demo coordinates (32.8872, 13.1913) resolve to UNVERIFIED", () => {
    const demoTarget: CustomerGpsTarget = {
      id: "PHARM-DEMO",
      latitude: 32.8872,
      longitude: 13.1913
    };
    expect(isKnownDefaultCoordinate(32.8872, 13.1913)).toBe(true);
    expect(resolveCustomerGpsVerificationStatus(demoTarget)).toBe("UNVERIFIED");
  });

  it("15. Area Authorization: Unassigned area blocks visit regardless of GPS", () => {
    const unassignedAreaCustomer: CustomerGpsTarget = {
      id: "PHARM-OUT",
      areaId: "Unassigned City / District / Area",
      latitude: 32.8875,
      longitude: 13.192,
      gpsVerified: true,
      gpsVerificationStatus: "VERIFIED"
    };
    const decision = evaluateGpsPolicyDecision({
      currentUser: mockUser,
      customer: unassignedAreaCustomer,
      userAreas: ["Tabarbour"],
      visitGps: null
    });
    expect(decision.areaAuthorized).toBe(false);
    expect(decision.canProceedToStep2).toBe(false);
  });

  it("16. Validation Step 1: Blocks unverified customer without GPS capture, passes verified customer without GPS", () => {
    const authorizedPharmacies = [
      {
        id: "PHARM-UNVERIFIED",
        name: "Unverified Pharmacy",
        areaId: "Tabarbour",
        territory: "Tabarbour",
        latitude: null,
        longitude: null,
        gpsVerified: false
      } as any,
      {
        id: "PHARM-VERIFIED",
        name: "Verified Pharmacy",
        areaId: "Tabarbour",
        territory: "Tabarbour",
        latitude: 32.8875,
        longitude: 13.192,
        gpsVerified: true,
        gpsVerificationStatus: "VERIFIED"
      } as any
    ];

    const draftUnverified: PharmacyVisitDraft = {
      draftId: "D1",
      repUid: mockUser.id,
      companyId: "MENAREPS",
      countryId: "LY",
      areaId: "Tabarbour",
      pharmacyId: "PHARM-UNVERIFIED",
      entrySource: "DIRECT_MENU",
      status: "DRAFT",
      currentStep: 1,
      visitPurpose: { code: "ORDER_COLLECTION", labelEn: "Order", labelAr: "طلب" },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      gps: {
        latitude: null,
        longitude: null,
        accuracy: null,
        timestamp: null,
        source: null,
        status: "NOT_ACQUIRED"
      }
    };

    const valUnverified = validateStep1PharmacyGps(draftUnverified, mockUser, authorizedPharmacies);
    expect(valUnverified.isValid).toBe(false);

    const draftVerified: PharmacyVisitDraft = {
      ...draftUnverified,
      pharmacyId: "PHARM-VERIFIED"
    };

    const valVerified = validateStep1PharmacyGps(draftVerified, mockUser, authorizedPharmacies);
    expect(valVerified.isValid).toBe(true);
  });

  it("17. Validation Step 6: Succeeds for verified customer without GPS warnings or errors", () => {
    const completedDraft: PharmacyVisitDraft = {
      draftId: "D2",
      repUid: mockUser.id,
      companyId: "MENAREPS",
      countryId: "LY",
      areaId: "Tabarbour",
      pharmacyId: "PHARM-VERIFIED",
      entrySource: "DIRECT_MENU",
      status: "DRAFT",
      currentStep: 6,
      visitPurpose: { code: "ORDER_COLLECTION", labelEn: "Order", labelAr: "طلب" },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      gps: {
        latitude: null,
        longitude: null,
        accuracy: null,
        timestamp: null,
        source: null,
        status: "NOT_ACQUIRED"
      },
      order: {
        lines: [
          {
            canonicalProductId: "PROD-01",
            productNameSnapshot: "Aspirin 100mg",
            quantity: 10,
            unitPricePreview: 5,
            lineTotalPreview: 50,
            userConfirmed: true
          }
        ],
        subtotalPreview: 50
      },
      stock: {
        crmNotes: { generalNotes: "Satisfactory visit" }
      }
    };

    const res = validateStep6(completedDraft);
    expect(res.isValid).toBe(true);
    expect(res.errors).toHaveLength(0);
    expect(res.warnings).not.toContain("GPS location captured outside default pharmacy geofence radius.");
  });

  it("18. Audit Records: auditCustomerDataset accurately categorizes records", () => {
    const mockPhysicians: Physician[] = [
      {
        id: "P1",
        name: "Dr. Bad GPS",
        latitude: 32.1196,
        longitude: 20.0857,
        gpsVerified: false,
        gpsVerificationStatus: "UNVERIFIED"
      } as any,
      {
        id: "P2",
        name: "Dr. Clean Unverified",
        latitude: null,
        longitude: null,
        gpsVerified: false,
        gpsVerificationStatus: "UNVERIFIED"
      } as any,
      {
        id: "P3",
        name: "Dr. Valid Verified",
        latitude: 32.8875,
        longitude: 13.1920,
        gpsVerified: true,
        gpsVerificationStatus: "VERIFIED",
        gpsVerifiedAt: "2026-03-01T10:00:00Z",
        gpsVerifiedBy: "USR-REP-01"
      } as any
    ];

    const audit = auditCustomerDataset(mockPhysicians, []);
    expect(audit.totalRecords).toBe(3);
    expect(audit.knownDefaultCount).toBe(1);
    expect(audit.cleanUnverifiedCount).toBe(1);
    expect(audit.validVerifiedCount).toBe(1);
  });

  it("19. Transaction Payload: Sanitize and audit payload produces clean output for Firestore", () => {
    const rawPayload = {
      id: "TEST-01",
      name: "Test Entity",
      latitude: undefined,
      longitude: null,
      notes: "Clean note"
    };

    const sanitized = sanitizeAndAuditPayload("TestEntity", "TEST-01", rawPayload);
    expect(sanitized.latitude).toBeUndefined();
    expect(sanitized.longitude).toBeNull();
    expect(sanitized.notes).toBe("Clean note");
  });

  it("20. Reducer Test: SET_GPS action updates draft state cleanly in pharmacyVisitReducer", () => {
    const initialState: PharmacyVisitState = {
      draft: {
        draftId: "DRAFT-TEST-01",
        repUid: mockUser.id,
        status: "NEW",
        currentStep: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        entrySource: "PHARMACY_LIST",
        gps: {
          latitude: null,
          longitude: null,
          accuracy: null,
          timestamp: null,
          source: null,
          status: "NOT_ACQUIRED"
        }
      } as any,
      isLoading: false
    };

    const gpsPayload: PharmacyVisitGps = {
      latitude: 32.8875,
      longitude: 13.192,
      accuracy: 10,
      accuracyMeters: 10,
      status: "ACQUIRED",
      source: "device"
    };

    const updatedState = pharmacyVisitReducer(initialState, { type: "SET_GPS", payload: gpsPayload });
    expect(updatedState.draft.gps?.latitude).toBe(32.8875);
    expect(updatedState.draft.gps?.longitude).toBe(13.192);
    expect(updatedState.draft.gps?.status).toBe("ACQUIRED");
  });
});
