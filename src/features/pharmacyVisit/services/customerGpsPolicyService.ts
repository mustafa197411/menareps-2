import { Pharmacy, User } from "../../../types";
import { PharmacyVisitDraft, PharmacyVisitGps } from "../types/domain";
import { isKnownDefaultCoordinate } from "../../../utils/auditGpsRecords";

export type CustomerType = "PHARMACY" | "PHYSICIAN";

export type CustomerGpsVerificationStatus = 
  | "UNVERIFIED"
  | "VERIFIED";

export type CurrentVisitGpsPresenceStatus =
  | "NOT_ACQUIRED"
  | "ACQUIRED"
  | "GPS_UNAVAILABLE"
  | "PERMISSION_DENIED"
  | "TIMEOUT"
  | "ERROR";

export interface CustomerGpsTarget {
  id: string;
  nameEn?: string;
  nameAr?: string;
  type?: CustomerType;
  areaId?: string;
  area?: string;
  territory?: string;
  latitude?: number | null;
  longitude?: number | null;
  gpsVerified?: boolean;
  gpsVerificationStatus?: CustomerGpsVerificationStatus | string;
  gpsVerifiedAt?: string;
  gpsVerifiedByUid?: string;
  gpsVerifiedVisitId?: string;
  gpsSource?: string;
  importBatchId?: string;
  source?: string;
  sourceTemplateCode?: string;
}

export interface GpsPolicyDecision {
  areaAuthorized: boolean;
  customerGpsStatus: CustomerGpsVerificationStatus;
  gpsCaptureRequired: boolean;
  currentVisitGpsStatus: CurrentVisitGpsPresenceStatus;
  canProceedToStep2: boolean;
  reasons: string[];
  captureAccepted?: boolean;
}

/**
 * Pure resolver for customer GPS verification status
 */
export function resolveCustomerGpsVerificationStatus(
  customer?: CustomerGpsTarget | null
): CustomerGpsVerificationStatus {
  if (!customer) return "UNVERIFIED";

  const lat = customer.latitude;
  const lng = customer.longitude;

  if (lat == null || lng == null || (lat === 0 && lng === 0) || isKnownDefaultCoordinate(lat, lng)) {
    return "UNVERIFIED";
  }

  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return "UNVERIFIED";
  }

  if (
    customer.gpsVerified === true ||
    customer.gpsVerificationStatus === "VERIFIED"
  ) {
    return "VERIFIED";
  }

  return "UNVERIFIED";
}

/**
 * Check strict Area authorization for a user and customer
 */
export function isCustomerAreaAuthorized(
  currentUser: User,
  customer?: CustomerGpsTarget | null,
  userAreas: string[] = []
): boolean {
  if (!customer) return false;
  if (!currentUser || currentUser.status === "Inactive" || currentUser.loginAllowed === false) {
    return false;
  }

  const customerArea = customer.areaId || customer.area || customer.territory;
  if (!customerArea) return false;

  const normCustArea = customerArea.trim().toUpperCase();

  const rawUserAreas = [
    ...userAreas,
    ...((currentUser as any)?.userAreas || []),
    ...((currentUser as any)?.areaIds || []),
    ...((currentUser as any)?.territories || []),
    ...((currentUser as any)?.areaNames || []),
    (currentUser as any)?.territory,
    (currentUser as any)?.area
  ].filter(Boolean) as string[];

  if (rawUserAreas.length === 0) {
    return true;
  }

  const normalizedUserAreas = rawUserAreas.map((a) => a.trim().toUpperCase());

  return normalizedUserAreas.some((ua) => {
    if (ua === normCustArea) return true;
    if (ua.includes("/") && ua.split("/").map((s) => s.trim()).includes(normCustArea)) return true;
    if (normCustArea.includes("/") && normCustArea.split("/").map((s) => s.trim()).includes(ua)) return true;
    if (ua.includes(normCustArea) || normCustArea.includes(ua)) return true;
    return false;
  });
}

/**
 * Central First-Visit-Only GPS Policy Decision Evaluator
 */
export function evaluateGpsPolicyDecision(input: {
  currentUser: User;
  customer?: CustomerGpsTarget | null;
  userAreas: string[];
  visitGps?: PharmacyVisitGps | null;
}): GpsPolicyDecision {
  const { currentUser, customer, userAreas, visitGps } = input;

  const areaAuthorized = isCustomerAreaAuthorized(currentUser, customer, userAreas);
  const customerGpsStatus = resolveCustomerGpsVerificationStatus(customer);

  if (!areaAuthorized) {
    const decision: GpsPolicyDecision = {
      areaAuthorized: false,
      customerGpsStatus,
      gpsCaptureRequired: customerGpsStatus === "UNVERIFIED",
      currentVisitGpsStatus: "NOT_ACQUIRED",
      canProceedToStep2: false,
      reasons: ["Customer is outside the representative's assigned geographic territory/area."]
    };
    logDiagnostic("PHARMACY_VISIT_GPS_POLICY_DECISION_JSON", decision);
    return decision;
  }

  // If customer is VERIFIED: zero GPS operations required, allow visit immediately
  if (customerGpsStatus === "VERIFIED") {
    const decision: GpsPolicyDecision = {
      areaAuthorized: true,
      customerGpsStatus: "VERIFIED",
      gpsCaptureRequired: false,
      currentVisitGpsStatus: "NOT_ACQUIRED",
      canProceedToStep2: true,
      captureAccepted: true,
      reasons: ["Customer location is globally verified. Proceeding without GPS operation."]
    };
    logDiagnostic("PHARMACY_VISIT_GPS_POLICY_DECISION_JSON", decision);
    return decision;
  }

  // If UNVERIFIED: live physical GPS acquisition required
  const hasGpsCapture =
    visitGps &&
    visitGps.latitude != null &&
    visitGps.longitude != null &&
    visitGps.status !== "NOT_ACQUIRED";

  const isDemoCapture =
    visitGps?.source?.toLowerCase() === "simulation_demo" ||
    visitGps?.source?.toLowerCase() === "simulation";

  if (hasGpsCapture && !isDemoCapture) {
    const decision: GpsPolicyDecision = {
      areaAuthorized: true,
      customerGpsStatus: "UNVERIFIED",
      gpsCaptureRequired: true,
      currentVisitGpsStatus: "ACQUIRED",
      canProceedToStep2: true,
      captureAccepted: true,
      reasons: ["First visit live GPS captured for customer location establishment."]
    };
    logDiagnostic("PHARMACY_VISIT_GPS_POLICY_DECISION_JSON", decision);
    return decision;
  }

  const decision: GpsPolicyDecision = {
    areaAuthorized: true,
    customerGpsStatus: "UNVERIFIED",
    gpsCaptureRequired: true,
    currentVisitGpsStatus: "NOT_ACQUIRED",
    canProceedToStep2: false,
    captureAccepted: false,
    reasons: ["First visit requires acquiring live physical GPS location."]
  };
  logDiagnostic("PHARMACY_VISIT_GPS_POLICY_DECISION_JSON", decision);
  return decision;
}

export interface RuntimeStageDiagnosticInput {
  stage: string;
  draftId?: string;
  pharmacyId?: string;
  latitude?: number | null;
  longitude?: number | null;
  accuracyMeters?: number | null;
  source?: string;
  captureStatus?: string;
  captureAccepted?: boolean;
  policyCanProceed?: boolean;
  validationCanProceed?: boolean;
  buttonDisabled?: boolean;
  blockingReason?: string;
}

export function logRuntimeStage(input: RuntimeStageDiagnosticInput): void {
  try {
    const payload = {
      stage: input?.stage || "UNKNOWN",
      draftId: input?.draftId || "",
      pharmacyId: input?.pharmacyId || "",
      latitude: input?.latitude ?? null,
      longitude: input?.longitude ?? null,
      accuracyMeters: input?.accuracyMeters ?? null,
      source: input?.source || "",
      captureStatus: input?.captureStatus || "NOT_ACQUIRED",
      captureAccepted: input?.captureAccepted ?? false,
      policyCanProceed: input?.policyCanProceed ?? false,
      validationCanProceed: input?.validationCanProceed ?? false,
      buttonDisabled: input?.buttonDisabled ?? true,
      blockingReason: input?.blockingReason || ""
    };
    logDiagnostic("GPS_RUNTIME_STAGE_JSON", payload);
  } catch (logError) {
    console.warn("[GPS_DIAGNOSTIC_LOG_FAILURE]", logError);
  }
}

/**
 * Diagnostics logger wrapper
 */
export function logDiagnostic(tag: string, data: any): void {
  try {
    const payload = JSON.stringify(data);
    console.log(`[${tag}] ${payload}`);
  } catch (e) {
    console.warn(`Failed logging diagnostic ${tag}:`, e);
  }
}
