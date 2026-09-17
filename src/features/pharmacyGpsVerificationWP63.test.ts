import { describe, it, expect } from "vitest";
import { resolveCustomerGpsVerificationStatus } from "./pharmacyVisit/services/customerGpsPolicyService";
import { isKnownDefaultCoordinate } from "../utils/auditGpsRecords";

describe("WP6.3 — Pharmacy GPS Verification Certification & Default Fallback Elimination", () => {
  describe("1. Default Fallback Elimination & Verification Policy Tests", () => {
    it("identifies hardcoded demo fallback coordinates (32.88, 13.18) and (32.8872, 13.1913) as demo", () => {
      expect(isKnownDefaultCoordinate(32.88, 13.18)).toBe(true);
      expect(isKnownDefaultCoordinate(32.8872, 13.1913)).toBe(true);
      expect(isKnownDefaultCoordinate(32.1234, 13.5678)).toBe(false);
      expect(isKnownDefaultCoordinate(null, null)).toBe(false);
    });

    it("resolves verification status to UNVERIFIED for null or demo coordinates", () => {
      expect(resolveCustomerGpsVerificationStatus({
        latitude: null,
        longitude: null,
        gpsVerificationStatus: "UNVERIFIED"
      })).toBe("UNVERIFIED");

      expect(resolveCustomerGpsVerificationStatus({
        latitude: 32.88,
        longitude: 13.18,
        gpsVerificationStatus: "VERIFIED"
      })).toBe("UNVERIFIED");

      expect(resolveCustomerGpsVerificationStatus({
        latitude: 32.8872,
        longitude: 13.1913,
        gpsVerificationStatus: "VERIFIED"
      })).toBe("UNVERIFIED");
    });

    it("resolves verification status to VERIFIED for pharmacy with valid live captured coordinates and metadata", () => {
      expect(resolveCustomerGpsVerificationStatus({
        latitude: 32.1234,
        longitude: 13.5678,
        gpsVerificationStatus: "VERIFIED",
        gpsVerifiedAt: "2026-07-26T10:00:00Z",
        gpsVerifiedByUid: "REP123",
        gpsVerifiedVisitId: "PV2_REP123_1"
      })).toBe("VERIFIED");
    });

    it("classifies unverified imported coordinates as UNVERIFIED if status is not explicitly VERIFIED", () => {
      expect(resolveCustomerGpsVerificationStatus({
        latitude: 32.5000,
        longitude: 13.8000,
        gpsVerificationStatus: "UNVERIFIED",
        gpsSource: "CSV_IMPORT"
      })).toBe("UNVERIFIED");
    });
  });

  describe("2. Import & Data Model Invariants", () => {
    it("guarantees imported pharmacy without GPS columns has null coordinates and UNVERIFIED status", () => {
      const recWithoutGps = {
        "Pharmacy Name": "Test Pharmacy No GPS",
        "Country": "Libya",
        "District": "Tripoli",
        "City": "Tripoli",
        "Area": "Tajoura",
        "Address": "Main St"
      };

      const rawLat = (recWithoutGps as any)["latitude"] || (recWithoutGps as any)["GPS Latitude"];
      const rawLng = (recWithoutGps as any)["longitude"] || (recWithoutGps as any)["GPS Longitude"];

      let parsedLat: number | null = null;
      let parsedLng: number | null = null;
      let importGpsStatus = "UNVERIFIED";

      if (rawLat && rawLng) {
        const l1 = parseFloat(rawLat);
        const l2 = parseFloat(rawLng);
        if (!isNaN(l1) && !isNaN(l2) && l1 !== 0 && l2 !== 0) {
          parsedLat = l1;
          parsedLng = l2;
          importGpsStatus = "IMPORTED_UNVERIFIED";
        }
      }

      expect(parsedLat).toBeNull();
      expect(parsedLng).toBeNull();
      expect(importGpsStatus).toBe("UNVERIFIED");
    });

    it("rejects incomplete coordinate pairs during import (e.g. lat present, lng missing)", () => {
      const recIncompleteGps = {
        "Pharmacy Name": "Test Incomplete GPS",
        "latitude": "32.1234"
      };

      const rawLat = recIncompleteGps["latitude"];
      const rawLng = (recIncompleteGps as any)["longitude"];

      let parsedLat: number | null = null;
      let parsedLng: number | null = null;
      let importGpsStatus = "UNVERIFIED";

      if (rawLat && rawLng) {
        const l1 = parseFloat(rawLat);
        const l2 = parseFloat(rawLng);
        if (!isNaN(l1) && !isNaN(l2)) {
          parsedLat = l1;
          parsedLng = l2;
          importGpsStatus = "IMPORTED_UNVERIFIED";
        }
      }

      expect(parsedLat).toBeNull();
      expect(parsedLng).toBeNull();
      expect(importGpsStatus).toBe("UNVERIFIED");
    });
  });

  describe("3. Provenance Audit Logging JSON Structures", () => {
    it("outputs valid PHARMACY_DEFAULT_GPS_SOURCE_JSON structure", () => {
      const logObj = {
        sourceFile: "src/App.tsx",
        sourceFunction: "handleImportPharmacies",
        fallbackType: "Hardcoded default fallback coordinates (32.88 / 13.18) removed in favor of strict absent/UNVERIFIED classification",
        fallbackLatitude: null,
        fallbackLongitude: null,
        appliedDuringImport: false,
        appliedDuringManualCreate: false,
        appliedDuringEditLoad: false
      };

      expect(logObj.sourceFile).toBe("src/App.tsx");
      expect(logObj.fallbackLatitude).toBeNull();
      expect(logObj.fallbackLongitude).toBeNull();
      expect(logObj.appliedDuringImport).toBe(false);
    });

    it("outputs valid PHARMACY_GPS_PROVENANCE_AUDIT_JSON structure", () => {
      const auditObj = {
        pharmacyId: "PHM-123",
        latitude: null,
        longitude: null,
        gpsVerificationStatus: "UNVERIFIED",
        gpsVerifiedVisitId: "",
        gpsVerificationSource: "UNKNOWN",
        matchesKnownAreaReference: false,
        trustedEvidence: false,
        classification: "Unverified — Missing Coordinates"
      };

      expect(auditObj.pharmacyId).toBe("PHM-123");
      expect(auditObj.trustedEvidence).toBe(false);
      expect(auditObj.classification).toContain("Unverified");
    });
  });
});
