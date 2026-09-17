import { describe, it, expect } from "vitest";
import { sanitizeAndAuditPayload } from "./utils/importNormalization";
import {
  resolveCustomerGpsVerificationStatus,
  evaluateGpsPolicyDecision,
  CustomerGpsTarget
} from "./features/pharmacyVisit/services/customerGpsPolicyService";
import { auditCustomerDataset, isKnownDefaultCoordinate } from "./utils/auditGpsRecords";
import { User, Physician, Pharmacy } from "./types";

describe("Global Customer GPS Verification Model", () => {
  const mockUser: User = {
    id: "USR-REP-01",
    name: "John Rep",
    email: "rep@example.com",
    role: "Medical Representative",
    status: "Active",
    userAreas: ["Tripoli District / Tripoli / Al-Dhahra"]
  };

  it("1. Registration & Creation: Creates unverified records with null coordinates when omitted", () => {
    const rawPhysicianPayload = {
      name: "Dr. Ahmed Mansour",
      specialty: "Cardiology",
      classification: "A",
      territory: "Tripoli District / Tripoli / Al-Dhahra",
      areaId: "Al-Dhahra",
      latitude: null,
      longitude: null,
      gpsVerified: false,
      gpsVerificationStatus: "UNVERIFIED"
    };

    const sanitized = sanitizeAndAuditPayload("Physician", "PHYS-01", rawPhysicianPayload);
    expect(sanitized.latitude).toBeNull();
    expect(sanitized.longitude).toBeNull();
    expect(sanitized.gpsVerified).toBe(false);
    expect(sanitized.gpsVerificationStatus).toBe("UNVERIFIED");
  });

  it("2. Import Normalization: Import without coordinates results in clean IMPORTED_UNVERIFIED", () => {
    const importPayload = {
      name: "Al-Fateh Pharmacy",
      territory: "Tripoli District / Tripoli / Al-Dhahra",
      importBatchId: "BATCH-2026-001",
      latitude: null,
      longitude: null,
      gpsVerified: false,
      gpsVerificationStatus: "IMPORTED_UNVERIFIED"
    };

    const sanitized = sanitizeAndAuditPayload("Pharmacy", "PHARM-IMP-01", importPayload);
    expect(sanitized.latitude).toBeNull();
    expect(sanitized.longitude).toBeNull();
    expect(sanitized.gpsVerified).toBe(false);
    expect(sanitized.gpsVerificationStatus).toBe("IMPORTED_UNVERIFIED");

    const target: CustomerGpsTarget = {
      id: "PHARM-IMP-01",
      nameEn: sanitized.name,
      latitude: sanitized.latitude,
      longitude: sanitized.longitude,
      gpsVerified: sanitized.gpsVerified,
      gpsVerificationStatus: sanitized.gpsVerificationStatus,
      importBatchId: sanitized.importBatchId
    };

    const status = resolveCustomerGpsVerificationStatus(target);
    expect(status).toBe("UNVERIFIED");
  });

  it("3. First Visit: Requires live GPS acquisition for unverified customer", () => {
    const unverifiedTarget: CustomerGpsTarget = {
      id: "PHYS-001",
      nameEn: "Dr. Ahmed Mansour",
      areaId: "Tripoli District / Tripoli / Al-Dhahra",
      latitude: null,
      longitude: null,
      gpsVerified: false,
      gpsVerificationStatus: "UNVERIFIED"
    };

    const decisionWithoutGps = evaluateGpsPolicyDecision({
      currentUser: mockUser,
      customer: unverifiedTarget,
      userAreas: ["Tripoli District / Tripoli / Al-Dhahra"],
      visitGps: null
    });

    expect(decisionWithoutGps.gpsCaptureRequired).toBe(true);
    expect(decisionWithoutGps.canProceedToStep2).toBe(false);

    const decisionWithGps = evaluateGpsPolicyDecision({
      currentUser: mockUser,
      customer: unverifiedTarget,
      userAreas: ["Tripoli District / Tripoli / Al-Dhahra"],
      visitGps: {
        latitude: 32.8875,
        longitude: 13.1920,
        accuracy: 12,
        status: "ACQUIRED"
      }
    });

    expect(decisionWithGps.canProceedToStep2).toBe(true);
  });

  it("4. Permanent Verification & Later Visits: Once verified, subsequent visits allow proceeding without forced GPS check-in", () => {
    const verifiedTarget: CustomerGpsTarget = {
      id: "PHYS-001",
      nameEn: "Dr. Ahmed Mansour",
      areaId: "Tripoli District / Tripoli / Al-Dhahra",
      latitude: 32.8875,
      longitude: 13.1920,
      gpsVerified: true,
      gpsVerificationStatus: "VERIFIED",
      gpsVerifiedAt: "2026-03-01T10:00:00Z",
      gpsVerifiedByUid: "USR-REP-01"
    };

    const status = resolveCustomerGpsVerificationStatus(verifiedTarget);
    expect(status).toBe("VERIFIED");

    // Subsequent visit without acquiring fresh GPS
    const decisionLaterVisit = evaluateGpsPolicyDecision({
      currentUser: mockUser,
      customer: verifiedTarget,
      userAreas: ["Tripoli District / Tripoli / Al-Dhahra"],
      visitGps: null
    });

    expect(decisionLaterVisit.gpsCaptureRequired).toBe(false);
    expect(decisionLaterVisit.canProceedToStep2).toBe(true);
  });

  it("5. Global Verification: Verification is shared across different representatives", () => {
    const anotherRep: User = {
      id: "USR-REP-02",
      name: "Jane Rep",
      email: "janerep@example.com",
      role: "Medical Representative",
      status: "Active",
      userAreas: ["Tripoli District / Tripoli / Al-Dhahra"]
    };

    const verifiedTarget: CustomerGpsTarget = {
      id: "PHARM-001",
      nameEn: "Al-Shifa Pharmacy",
      areaId: "Tripoli District / Tripoli / Al-Dhahra",
      latitude: 32.8875,
      longitude: 13.1920,
      gpsVerified: true,
      gpsVerificationStatus: "VERIFIED",
      gpsVerifiedAt: "2026-03-01T10:00:00Z",
      gpsVerifiedByUid: "USR-REP-01" // Verified by USR-REP-01
    };

    // USR-REP-02 visits the same pharmacy
    const decisionAnotherRep = evaluateGpsPolicyDecision({
      currentUser: anotherRep,
      customer: verifiedTarget,
      userAreas: ["Tripoli District / Tripoli / Al-Dhahra"],
      visitGps: null
    });

    expect(decisionAnotherRep.customerGpsStatus).toBe("VERIFIED");
    expect(decisionAnotherRep.canProceedToStep2).toBe(true);
  });

  it("6. Read-Only Audit Utility: Detects default coordinates and unverified states accurately", () => {
    expect(isKnownDefaultCoordinate(32.1196, 20.0857)).toBe(true);
    expect(isKnownDefaultCoordinate(32.8872, 13.1913)).toBe(true);
    expect(isKnownDefaultCoordinate(32.8875, 13.1920)).toBe(false);

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
});
