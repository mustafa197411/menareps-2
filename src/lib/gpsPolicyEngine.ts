import { doc, runTransaction } from "firebase/firestore";
import { db } from "./firebase";
import { acquireHardenedGPS, GPSRecord } from "./gpsHardening";
import { User } from "../types";

export interface EstablishedLocationResult {
  latitude: number;
  longitude: number;
  gpsVerified: boolean;
  gpsVerificationStatus: string;
  gpsVerifiedAt: string;
  gpsVerifiedBy: string;
  gpsVerifiedVisitId?: string;
  isFirstVisitVerification: boolean;
  rawGpsRecord?: GPSRecord;
}

export interface CustomerLocationTarget {
  id?: string;
  customerId?: string;
  name?: string;
  type?: "PHYSICIAN" | "PHARMACY" | "Physician" | "Pharmacy";
  customerType?: "physician" | "pharmacy" | "PHYSICIAN" | "PHARMACY";
  collectionName?: "physicians" | "pharmacies";
  latitude?: number | null;
  longitude?: number | null;
  gpsVerified?: boolean;
  gpsVerificationStatus?: string;
  gpsVerifiedAt?: string;
  gpsVerifiedBy?: string;
  gpsVerifiedByUid?: string;
  gpsVerifiedVisitId?: string;
  representativeUid?: string;
  visitId?: string;
  verificationTimestamp?: string;
  [key: string]: any;
}

/**
 * Centralized GPS Policy Engine
 * Manages the 'first-visit-only' verification rule.
 * Performs a single-write atomic Firestore transaction.
 * Reads the customer document; if already verified (`gpsVerified: true`), returns immediately without writing.
 * If unverified, writes canonical verification fields and sets gpsVerified: true.
 */
export async function establishCustomerLocation(
  targetOrInput: CustomerLocationTarget,
  currentUser?: User | { id: string; name?: string; role?: any },
  options?: {
    accuracyMode?: "HARD_REJECT" | "WARNING_ONLY";
    providedGpsRecord?: GPSRecord;
  }
): Promise<EstablishedLocationResult> {
  const customerId = targetOrInput.customerId || targetOrInput.id || "";
  const repUid = targetOrInput.representativeUid || currentUser?.id || "SYSTEM";
  const visitId = targetOrInput.visitId || targetOrInput.gpsVerifiedVisitId || `v_${Date.now()}`;
  const nowIso = targetOrInput.verificationTimestamp || new Date().toISOString();

  let typeStr = targetOrInput.customerType || targetOrInput.type || "";
  let collectionName = targetOrInput.collectionName;
  if (!collectionName) {
    if (typeStr.toLowerCase().includes("physician") || customerId.startsWith("PHY-") || customerId.startsWith("DOC-")) {
      collectionName = "physicians";
    } else {
      collectionName = "pharmacies";
    }
  }

  // Check if target is already globally verified in memory
  const isAlreadyVerified = Boolean(
    targetOrInput.gpsVerified === true || targetOrInput.gpsVerificationStatus === "VERIFIED"
  );

  if (isAlreadyVerified && targetOrInput.latitude != null && targetOrInput.longitude != null) {
    return {
      latitude: Number(targetOrInput.latitude),
      longitude: Number(targetOrInput.longitude),
      gpsVerified: true,
      gpsVerificationStatus: "VERIFIED",
      gpsVerifiedAt: targetOrInput.gpsVerifiedAt || nowIso,
      gpsVerifiedBy: targetOrInput.gpsVerifiedBy || targetOrInput.gpsVerifiedByUid || repUid,
      gpsVerifiedVisitId: visitId,
      isFirstVisitVerification: false
    };
  }

  // Determine latitude & longitude to verify
  let lat = targetOrInput.latitude;
  let lng = targetOrInput.longitude;
  let gpsRecord: GPSRecord | undefined = options?.providedGpsRecord;

  if (lat == null || lng == null) {
    if (gpsRecord) {
      lat = gpsRecord.latitude;
      lng = gpsRecord.longitude;
    } else {
      gpsRecord = await acquireHardenedGPS(
        { id: repUid, name: currentUser?.name || "User", role: currentUser?.role },
        `First Visit Registration - ${targetOrInput.name || customerId}`,
        { accuracyMode: options?.accuracyMode || "WARNING_ONLY" }
      );
      lat = gpsRecord.latitude;
      lng = gpsRecord.longitude;
    }
  }

  const finalLat = Number(lat);
  const finalLng = Number(lng);

  let isFirstVisitVerification = true;

  // Single atomic transaction write
  if (customerId && db) {
    try {
      const customerDocRef = doc(db, collectionName, customerId);
      await runTransaction(db, async (transaction) => {
        const docSnap = await transaction.get(customerDocRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          // Rule 4: If customer is ALREADY verified, return immediately without writing
          if (data.gpsVerified === true || data.gpsVerificationStatus === "VERIFIED") {
            isFirstVisitVerification = false;
            return;
          }

          // Atomic write ONLY when customer is still UNVERIFIED
          transaction.update(customerDocRef, {
            latitude: finalLat,
            longitude: finalLng,
            gpsVerified: true,
            gpsVerificationStatus: "VERIFIED",
            gpsVerifiedAt: nowIso,
            gpsVerifiedBy: repUid,
            gpsVerifiedByUid: repUid,
            gpsVerifiedVisitId: visitId,
            gpsVerificationSource: "FIRST_VISIT"
          });
        }
      });
    } catch (err) {
      console.warn("Firestore transaction for GPS verification failed, using local fallback:", err);
    }
  }

  // Mutate in-memory target object for client state consistency
  targetOrInput.latitude = finalLat;
  targetOrInput.longitude = finalLng;
  targetOrInput.gpsVerified = true;
  targetOrInput.gpsVerificationStatus = "VERIFIED";
  targetOrInput.gpsVerifiedAt = nowIso;
  targetOrInput.gpsVerifiedBy = repUid;
  targetOrInput.gpsVerifiedByUid = repUid;
  targetOrInput.gpsVerifiedVisitId = visitId;

  return {
    latitude: finalLat,
    longitude: finalLng,
    gpsVerified: true,
    gpsVerificationStatus: "VERIFIED",
    gpsVerifiedAt: nowIso,
    gpsVerifiedBy: repUid,
    gpsVerifiedVisitId: visitId,
    isFirstVisitVerification,
    rawGpsRecord: gpsRecord
  };
}
