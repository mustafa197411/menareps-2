import { User, Pharmacy, PharmacyVisit, Role } from "../../../types";

export type VisitGpsVerificationStatus =
  | "UNVERIFIED"
  | "FIRST_VISIT_CAPTURED"
  | "VERIFIED_PREVIOUSLY"
  | "REVERIFIED";

export type GpsCaptureSource =
  | "LIVE_DEVICE_FIRST_VISIT"
  | "LIVE_DEVICE_VISIT_TELEMETRY"
  | "LIVE_DEVICE_REVERIFICATION"
  | "ADMIN_MANUAL";

export interface CanonicalVisitGps {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  capturedAt: string;
  source: GpsCaptureSource;
  warningType?: string | null;
}

export interface CanonicalPharmacyGpsMaster {
  latitude: number;
  longitude: number;
  gpsAccuracyMeters: number;
  gpsVerificationStatus: "VERIFIED" | "UNVERIFIED";
  gpsVerifiedAt: string;
  gpsVerifiedByUid: string;
  gpsVerifiedVisitId: string;
  gpsVerificationSource: GpsCaptureSource;
  gpsVerified?: boolean;
}

export interface PharmacyGpsResolution {
  verified: boolean;
  status: VisitGpsVerificationStatus;
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  capturedAt: string | null;
  verifiedByUid: string | null;
  verifiedVisitId: string | null;
  source: string | null;
  reason: string;
  warningType?: string | null;
}

/**
 * Checks if coordinates are valid non-zero, non-demo coordinates.
 */
export function isValidGpsCoordinate(lat: number | null | undefined, lng: number | null | undefined): boolean {
  if (lat == null || lng == null || isNaN(lat) || isNaN(lng) || lat === 0 || lng === 0) {
    return false;
  }
  // Filter out default demo fallback coordinates (e.g. 32.8872, 13.1913 or 32.88, 13.18)
  const isDemo =
    (Math.abs(lat - 32.8872) < 0.001 && Math.abs(lng - 13.1913) < 0.001) ||
    (Math.abs(lat - 32.88) < 0.001 && Math.abs(lng - 13.18) < 0.001);
  return !isDemo;
}

/**
 * Shared Resolver for Pharmacy GPS Verification Status
 */
export function resolvePharmacyGpsVerificationStatus({
  visit,
  pharmacy
}: {
  visit?: Partial<PharmacyVisit> | any;
  pharmacy?: Partial<Pharmacy> | any;
}): PharmacyGpsResolution {
  // 1. Evaluate Visit record if available
  if (visit) {
    const vGpsStatus = visit.gpsVerificationStatus || (visit as any).gpsStatus;
    const isVisitVerified =
      visit.gpsVerified === true ||
      vGpsStatus === "FIRST_VISIT_CAPTURED" ||
      vGpsStatus === "VERIFIED_PREVIOUSLY" ||
      vGpsStatus === "REVERIFIED" ||
      vGpsStatus === "VERIFIED" ||
      (visit.gps && (visit.gps.status === "VERIFIED" || visit.gps.captureAccepted === true));

    const lat = visit.gps?.latitude ?? visit.latitude ?? null;
    const lng = visit.gps?.longitude ?? visit.longitude ?? null;
    const acc = visit.gps?.accuracyMeters ?? visit.gps?.accuracy ?? visit.gpsAccuracy ?? null;
    const captAt = visit.gps?.capturedAt ?? visit.visitDate ?? visit.date ?? null;
    const repUid = visit.repId || visit.repUid || visit.createdBy || null;
    const visitId = visit.id || null;
    const src = visit.gps?.source || (vGpsStatus === "FIRST_VISIT_CAPTURED" ? "LIVE_DEVICE_FIRST_VISIT" : "LIVE_DEVICE_VISIT_TELEMETRY");

    if (isVisitVerified && isValidGpsCoordinate(lat, lng)) {
      let resolvedStatus: VisitGpsVerificationStatus = "FIRST_VISIT_CAPTURED";
      if (vGpsStatus === "VERIFIED_PREVIOUSLY") resolvedStatus = "VERIFIED_PREVIOUSLY";
      else if (vGpsStatus === "REVERIFIED") resolvedStatus = "REVERIFIED";
      else if (vGpsStatus === "FIRST_VISIT_CAPTURED") resolvedStatus = "FIRST_VISIT_CAPTURED";

      return {
        verified: true,
        status: resolvedStatus,
        latitude: lat,
        longitude: lng,
        accuracyMeters: acc != null ? Number(acc) : null,
        capturedAt: captAt,
        verifiedByUid: repUid,
        verifiedVisitId: visitId,
        source: src,
        reason: "Visit has valid verified GPS evidence",
        warningType: visit.gps?.warningType || null
      };
    }
  }

  // 2. Evaluate Pharmacy Master record
  if (pharmacy) {
    const pAny = pharmacy as any;
    const lat = pharmacy.latitude ?? pAny.verifiedGps?.latitude ?? null;
    const lng = pharmacy.longitude ?? pAny.verifiedGps?.longitude ?? null;
    const acc = pharmacy.gpsAccuracyMeters ?? pAny.gpsAccuracy ?? pAny.verifiedGps?.accuracy ?? null;
    const captAt = pAny.gpsVerifiedAt ?? pAny.verifiedGps?.verifiedAt ?? null;
    const repUid = pAny.gpsVerifiedByUid ?? pAny.verifiedGps?.verifiedByRepId ?? null;
    const visitId = pAny.gpsVerifiedVisitId ?? null;
    const status = pAny.gpsVerificationStatus ?? pAny.verifiedGpsStatus ?? (pAny.gpsVerified ? "VERIFIED" : "UNVERIFIED");
    const src = pAny.gpsVerificationSource ?? pAny.gpsSource ?? "UNKNOWN";

    const hasValidCoords = isValidGpsCoordinate(lat, lng);
    const isMasterVerified = status === "VERIFIED" || pAny.gpsVerified === true;
    const hasProvenance = Boolean(captAt && repUid && visitId);
    const isTrustedSource = src !== "CSV_IMPORT" && src !== "import" && src !== "MASTER_FORM" && src !== "MANUAL" && !pAny.importBatchId;

    if (hasValidCoords && isMasterVerified && hasProvenance && isTrustedSource) {
      return {
        verified: true,
        status: "VERIFIED_PREVIOUSLY",
        latitude: lat,
        longitude: lng,
        accuracyMeters: acc != null ? Number(acc) : null,
        capturedAt: captAt,
        verifiedByUid: repUid,
        verifiedVisitId: visitId,
        source: src,
        reason: "Pharmacy master has complete verified provenance metadata"
      };
    }
  }

  return {
    verified: false,
    status: "UNVERIFIED",
    latitude: null,
    longitude: null,
    accuracyMeters: null,
    capturedAt: null,
    verifiedByUid: null,
    verifiedVisitId: null,
    source: null,
    reason: "No complete verified GPS evidence found"
  };
}

/**
 * Resolves the authorized set of Representative User IDs for a given user.
 */
export function getAuthorizedUserIds(currentUser: User, allUsers: User[] = []): string[] {
  const role = currentUser.role;

  if (
    role === Role.SUPER_ADMIN ||
    role === Role.ADMIN ||
    role === Role.SYSTEM_ADMINISTRATOR ||
    role === Role.GENERAL_MANAGER
  ) {
    const ids = new Set<string>(allUsers.map((u) => u.id));
    ids.add(currentUser.id);
    return Array.from(ids);
  }

  if (
    role === Role.REGIONAL_MANAGER ||
    role === Role.COUNTRY_MANAGER ||
    role === Role.AREA_SALES_MANAGER ||
    role === Role.SALES_MANAGER ||
    role === Role.MEDICAL_MANAGER ||
    role === Role.SALES_MARKETING_MANAGER ||
    role === Role.FINANCE_MANAGER
  ) {
    const directReports = allUsers.filter(
      (u) => u.managerId === currentUser.id
    );
    const directReportIds = directReports.map((u) => u.id);

    const indirectReports = allUsers.filter(
      (u) => u.managerId && directReportIds.includes(u.managerId)
    );

    const authorized = new Set<string>([currentUser.id, ...directReportIds, ...indirectReports.map((u) => u.id)]);
    return Array.from(authorized);
  }

  if (role === Role.MEDICAL_SUPERVISOR || role === Role.SALES_SUPERVISOR) {
    const directReports = allUsers.filter(
      (u) => u.managerId === currentUser.id
    );
    return Array.from(new Set([currentUser.id, ...directReports.map((u) => u.id)]));
  }

  return [currentUser.id];
}

/**
 * Resolves authorized area IDs for a given user.
 */
export function getAuthorizedAreaIds(currentUser: User, allUsers: User[] = []): string[] {
  const authorizedUids = getAuthorizedUserIds(currentUser, allUsers);
  const areaSet = new Set<string>();

  allUsers
    .filter((u) => authorizedUids.includes(u.id))
    .forEach((u) => {
      (u.areaIds || []).forEach((aId) => areaSet.add(aId));
    });

  (currentUser.areaIds || []).forEach((aId) => areaSet.add(aId));

  return Array.from(areaSet);
}

/**
 * Log diff JSON
 */
export function logPharmacyGpsDiff(params: {
  visitId: string;
  displayNumber: string;
  pharmacyId: string;
  draftGps: any;
  completedVisitGps: any;
  pharmacyMasterGps: any;
  visitsPageExpectedFields: string[];
  gpsVerifiedPageExpectedFields: string[];
  missingFields: string[];
  mismatchedFieldNames: string[];
  rootCause: string;
}) {
  console.info("[PHARMACY_GPS_COMPLETION_DIFF_JSON]", JSON.stringify(params));
}
