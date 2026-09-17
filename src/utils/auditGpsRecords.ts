import { Physician, Pharmacy } from "../types";

export interface GpsAuditItem {
  id: string;
  name: string;
  type: "PHYSICIAN" | "PHARMACY";
  latitude: number | null;
  longitude: number | null;
  gpsVerified?: boolean;
  gpsVerificationStatus?: string;
  gpsVerifiedAt?: string;
  gpsVerifiedBy?: string;
  issueCategory:
    | "KNOWN_DEFAULT_COORDINATES"
    | "MISSING_VERIFICATION_METADATA"
    | "INVALID_VERIFIED_STATUS"
    | "CLEAN_UNVERIFIED"
    | "VALID_VERIFIED";
  details: string;
}

export interface GpsAuditSummary {
  totalRecords: number;
  knownDefaultCount: number;
  missingMetadataCount: number;
  invalidVerifiedStatusCount: number;
  cleanUnverifiedCount: number;
  validVerifiedCount: number;
  auditItems: GpsAuditItem[];
}

const KNOWN_DEFAULT_PAIRS = [
  { lat: 32.88, lng: 13.18 },
  { lat: 32.1196, lng: 20.0857 },
  { lat: 32.8872, lng: 13.1913 },
  { lat: 32.88720, lng: 13.19130 },
  { lat: 32.1158, lng: 20.0739 },
  { lat: 0, lng: 0 }
];

export function isKnownDefaultCoordinate(lat?: number | null, lng?: number | null): boolean {
  if (lat == null || lng == null) return false;
  return KNOWN_DEFAULT_PAIRS.some((pair) => {
    const dLat = Math.abs(lat - pair.lat);
    const dLng = Math.abs(lng - pair.lng);
    return dLat < 0.0001 && dLng < 0.0001;
  });
}

export function auditCustomerGpsRecord(
  record: {
    id: string;
    name: string;
    latitude?: number | null;
    longitude?: number | null;
    gpsVerified?: boolean;
    gpsVerificationStatus?: string;
    gpsVerifiedAt?: string;
    gpsVerifiedBy?: string;
    [key: string]: any;
  },
  type: "PHYSICIAN" | "PHARMACY"
): GpsAuditItem {
  const lat = record.latitude ?? null;
  const lng = record.longitude ?? null;
  const isVerifiedFlag = record.gpsVerified === true || record.gpsVerificationStatus === "VERIFIED";

  if (lat != null && lng != null && isKnownDefaultCoordinate(lat, lng)) {
    return {
      id: record.id,
      name: record.name,
      type,
      latitude: lat,
      longitude: lng,
      gpsVerified: record.gpsVerified,
      gpsVerificationStatus: record.gpsVerificationStatus,
      gpsVerifiedAt: record.gpsVerifiedAt,
      gpsVerifiedBy: record.gpsVerifiedBy,
      issueCategory: "KNOWN_DEFAULT_COORDINATES",
      details: `Contains known default/demo coordinates (${lat}, ${lng}). Should be cleared or verified via first visit.`
    };
  }

  if (isVerifiedFlag && (lat == null || lng == null)) {
    return {
      id: record.id,
      name: record.name,
      type,
      latitude: lat,
      longitude: lng,
      gpsVerified: record.gpsVerified,
      gpsVerificationStatus: record.gpsVerificationStatus,
      gpsVerifiedAt: record.gpsVerifiedAt,
      gpsVerifiedBy: record.gpsVerifiedBy,
      issueCategory: "INVALID_VERIFIED_STATUS",
      details: "Marked as verified but missing coordinates."
    };
  }

  if (lat != null && lng != null && !isVerifiedFlag) {
    return {
      id: record.id,
      name: record.name,
      type,
      latitude: lat,
      longitude: lng,
      gpsVerified: record.gpsVerified,
      gpsVerificationStatus: record.gpsVerificationStatus,
      gpsVerifiedAt: record.gpsVerifiedAt,
      gpsVerifiedBy: record.gpsVerifiedBy,
      issueCategory: "MISSING_VERIFICATION_METADATA",
      details: "Contains coordinates but is unverified (imported or manually entered). Needs first visit verification."
    };
  }

  if (lat == null && lng == null) {
    return {
      id: record.id,
      name: record.name,
      type,
      latitude: null,
      longitude: null,
      gpsVerified: record.gpsVerified,
      gpsVerificationStatus: record.gpsVerificationStatus,
      gpsVerifiedAt: record.gpsVerifiedAt,
      gpsVerifiedBy: record.gpsVerifiedBy,
      issueCategory: "CLEAN_UNVERIFIED",
      details: "Clean unverified record without assumed coordinates."
    };
  }

  return {
    id: record.id,
    name: record.name,
    type,
    latitude: lat,
    longitude: lng,
    gpsVerified: record.gpsVerified,
    gpsVerificationStatus: record.gpsVerificationStatus,
    gpsVerifiedAt: record.gpsVerifiedAt,
    gpsVerifiedBy: record.gpsVerifiedBy,
    issueCategory: "VALID_VERIFIED",
    details: "Valid verified record with first-visit verification evidence."
  };
}

export function auditCustomerDataset(
  physicians: Physician[] = [],
  pharmacies: Pharmacy[] = []
): GpsAuditSummary {
  const items: GpsAuditItem[] = [];

  physicians.forEach((p) => {
    items.push(auditCustomerGpsRecord({ ...p, name: p.name }, "PHYSICIAN"));
  });

  pharmacies.forEach((p) => {
    items.push(auditCustomerGpsRecord({ ...p, name: p.name }, "PHARMACY"));
  });

  return {
    totalRecords: items.length,
    knownDefaultCount: items.filter((i) => i.issueCategory === "KNOWN_DEFAULT_COORDINATES").length,
    missingMetadataCount: items.filter((i) => i.issueCategory === "MISSING_VERIFICATION_METADATA").length,
    invalidVerifiedStatusCount: items.filter((i) => i.issueCategory === "INVALID_VERIFIED_STATUS").length,
    cleanUnverifiedCount: items.filter((i) => i.issueCategory === "CLEAN_UNVERIFIED").length,
    validVerifiedCount: items.filter((i) => i.issueCategory === "VALID_VERIFIED").length,
    auditItems: items
  };
}

export function logCustomerGpsDiagnosticReport(
  physicians: Physician[] = [],
  pharmacies: Pharmacy[] = []
): GpsAuditSummary {

  const summary = auditCustomerDataset(physicians, pharmacies);
  
  const anomalies = summary.auditItems.filter(
    (item) =>
      item.issueCategory === "KNOWN_DEFAULT_COORDINATES" ||
      item.issueCategory === "MISSING_VERIFICATION_METADATA" ||
      item.issueCategory === "INVALID_VERIFIED_STATUS"
  );

  console.group("GPS CUSTOMER RECORD DIAGNOSTIC REPORT");
  console.log(`Total Customer Records Audited: ${summary.totalRecords}`);
  console.log(`- Known Default Coordinates Detected: ${summary.knownDefaultCount}`);
  console.log(`- Coordinates Missing Verification Status: ${summary.missingMetadataCount}`);
  console.log(`- Invalid Verified Status (Missing Coords): ${summary.invalidVerifiedStatusCount}`);
  console.log(`- Clean Unverified (Awaiting First Visit): ${summary.cleanUnverifiedCount}`);
  console.log(`- Valid Verified Records: ${summary.validVerifiedCount}`);

  if (anomalies.length > 0) {
    console.table(
      anomalies.map((a) => ({
        ID: a.id,
        Name: a.name,
        Type: a.type,
        "Anomaly Type": a.issueCategory,
        Latitude: a.latitude,
        Longitude: a.longitude,
        "gpsVerified": a.gpsVerified ?? false,
        Details: a.details
      }))
    );
  } else {
    console.log("No GPS coordinate anomalies detected in dataset.");
  }
  console.groupEnd();

  return summary;
}

