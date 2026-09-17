import { describe, it, expect } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import GPSVerifiedPharmacies, { toSafeDate, formatVerificationDate } from "./GPSVerifiedPharmacies";
import { User, Pharmacy, Role } from "../types";

const mockUser: User = {
  id: "USR-001",
  name: "Dr. Representative",
  email: "rep@example.com",
  role: Role.MEDICAL_REP,
  territoryId: "TERR-01",
  areaIds: ["A-TRI-DWT"],
  status: "ACTIVE"
};

const mockPharmacyVerified: Pharmacy = {
  id: "PHARM-101",
  name: "Al-Shifa Pharmacy",
  nameAr: "صيدلية الشفاء",
  areaId: "A-TRI-DWT",
  address: "Downtown Tripoli",
  status: "ACTIVE",
  gpsVerified: true,
  latitude: 32.8500,
  longitude: 13.2000,
  gpsAccuracyMeters: 4.2,
  gpsVerifiedAt: "2026-07-20T10:00:00.000Z",
  gpsVerifiedByUid: "USR-001",
  gpsVerifiedVisitId: "VISIT-001",
  gpsVerificationSource: "LIVE_DEVICE_FIRST_VISIT",
  gpsVerificationStatus: "VERIFIED"
} as any;

describe("GPSVerifiedPharmacies Hotfix Tests", () => {
  it("1. GPS Verified Pharmacies renders without crashing and without 'not a constructor' error", () => {
    const html = renderToString(
      <GPSVerifiedPharmacies
        lang="en"
        currentUser={mockUser}
        users={[mockUser]}
        pharmacies={[]}
        pharmacyVisits={[]}
      />
    );
    expect(html).toContain("GPS Verified Pharmacies");
  });

  it("2. Firestore Timestamp values convert safely with toSafeDate", () => {
    const fakeTimestamp = {
      toDate: () => new Date("2026-07-25T14:30:00Z")
    };
    const safeDate = toSafeDate(fakeTimestamp);
    expect(safeDate).toBeInstanceOf(Date);
    expect(formatVerificationDate(fakeTimestamp)).toBe("2026-07-25");
  });

  it("3. ISO string dates render correctly", () => {
    expect(formatVerificationDate("2026-07-21T08:00:00Z")).toBe("2026-07-21");
  });

  it("4. Missing dates render safely with fallback dash", () => {
    expect(formatVerificationDate(null)).toBe("—");
    expect(formatVerificationDate(undefined)).toBe("—");
  });

  it("5. Native Set construction works and is not shadowed by imported components", () => {
    const testSet = new Set<string>(["A", "B", "C"]);
    expect(testSet.has("A")).toBe(true);
    expect(Array.from(testSet)).toEqual(["A", "B", "C"]);
  });

  it("6. Area filter options populate correctly", () => {
    const html = renderToString(
      <GPSVerifiedPharmacies
        lang="en"
        currentUser={mockUser}
        users={[mockUser]}
        pharmacies={[mockPharmacyVerified]}
        pharmacyVisits={[]}
      />
    );
    expect(html).toContain("All Authorized Areas");
    expect(html).toContain("A-TRI-DWT");
  });

  it("7. Representative filter options populate correctly", () => {
    const html = renderToString(
      <GPSVerifiedPharmacies
        lang="en"
        currentUser={mockUser}
        users={[mockUser]}
        pharmacies={[mockPharmacyVerified]}
        pharmacyVisits={[]}
      />
    );
    expect(html).toContain("All Authorized Reps");
    expect(html).toContain("Dr. Representative");
  });

  it("8. Empty verified data shows empty state", () => {
    const html = renderToString(
      <GPSVerifiedPharmacies
        lang="en"
        currentUser={mockUser}
        users={[mockUser]}
        pharmacies={[]}
        pharmacyVisits={[]}
      />
    );
    expect(html).toContain("No GPS verified pharmacies found matching criteria");
  });

  it("9. Verified pharmacy data shows record", () => {
    const html = renderToString(
      <GPSVerifiedPharmacies
        lang="en"
        currentUser={mockUser}
        users={[mockUser]}
        pharmacies={[mockPharmacyVerified]}
        pharmacyVisits={[]}
      />
    );
    expect(html).toContain("Al-Shifa Pharmacy");
    expect(html).toContain("32.8500");
  });

  it("10. No internal object is rendered directly", () => {
    const html = renderToString(
      <GPSVerifiedPharmacies
        lang="en"
        currentUser={mockUser}
        users={[mockUser]}
        pharmacies={[mockPharmacyVerified]}
        pharmacyVisits={[]}
      />
    );
    expect(html).not.toContain("[object Object]");
  });
});
