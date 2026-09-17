import { Pharmacy, User } from "../../../types";
import { PharmacyVisitDraft, PharmacyVisitValidationResult } from "../types/domain";
import { evaluateGpsPolicyDecision, CustomerGpsTarget, logRuntimeStage } from "../services/customerGpsPolicyService";

export function validateStep1PharmacyGps(
  draft: PharmacyVisitDraft,
  currentUser: User,
  authorizedPharmacies: Pharmacy[]
): PharmacyVisitValidationResult {
  const errors: Array<{ field: string; messageEn: string; messageAr: string }> = [];

  // 1. User Readiness Check
  if (!currentUser || !currentUser.id) {
    errors.push({
      field: "currentUser",
      messageEn: "Authenticated Sales Representative user profile is missing.",
      messageAr: "ملف مندوب المبيعات الموثق غير موجود."
    });
  }

  // 2. Pharmacy Selection Check
  const selectedPharmacy = draft.pharmacyId
    ? authorizedPharmacies.find((p) => p.id === draft.pharmacyId)
    : null;

  if (!draft.pharmacyId) {
    errors.push({
      field: "pharmacyId",
      messageEn: "Please select an authorized Pharmacy before proceeding.",
      messageAr: "يرجى اختيار صيدلية معتمدة قبل المتابعة."
    });
  } else if (!selectedPharmacy) {
    errors.push({
      field: "pharmacyId",
      messageEn: "The selected Pharmacy is not authorized in your assigned territory.",
      messageAr: "الصيدلية المحددة غير معتمدة ضمن منطقتك المخصصة."
    });
  } else if (selectedPharmacy.active === false || selectedPharmacy.isDeleted === true) {
    errors.push({
      field: "pharmacyId",
      messageEn: "The selected Pharmacy is currently inactive or deleted.",
      messageAr: "الصيدلية المحددة غير نشطة أو محذوفة حالياً."
    });
  }

  // 3. Visit Purpose Check
  if (!draft.visitPurpose || !draft.visitPurpose.code) {
    errors.push({
      field: "visitPurpose",
      messageEn: "Please select a Visit Purpose.",
      messageAr: "يرجى اختيار سبب الزيارة."
    });
  }

  // 4. GPS Policy Verification
  const userAreas =
    (currentUser as any)?.userAreas ||
    (currentUser as any)?.areaIds ||
    (currentUser as any)?.territories ||
    [
      (currentUser as any)?.territory,
      (currentUser as any)?.area,
      selectedPharmacy?.areaId,
      selectedPharmacy?.territory,
      selectedPharmacy?.area
    ].filter(Boolean) as string[];

  const customerTarget: CustomerGpsTarget | null = selectedPharmacy
    ? {
        id: selectedPharmacy.id,
        nameEn: selectedPharmacy.name,
        nameAr: selectedPharmacy.nameAr,
        type: "PHARMACY",
        areaId: selectedPharmacy.areaId || selectedPharmacy.territory,
        latitude: selectedPharmacy.latitude,
        longitude: selectedPharmacy.longitude,
        gpsVerified: (selectedPharmacy as any).gpsVerified,
        gpsVerificationStatus: (selectedPharmacy as any).gpsVerificationStatus,
        gpsVerifiedAt: (selectedPharmacy as any).gpsVerifiedAt,
        gpsVerifiedByUid: (selectedPharmacy as any).gpsVerifiedByUid,
        gpsVerifiedVisitId: (selectedPharmacy as any).gpsVerifiedVisitId,
        gpsSource: (selectedPharmacy as any).gpsSource,
        importBatchId: (selectedPharmacy as any).importBatchId,
        source: (selectedPharmacy as any).source
      }
    : null;

  const policy = evaluateGpsPolicyDecision({
    currentUser,
    customer: customerTarget,
    userAreas,
    visitGps: draft.gps
  });

  if (selectedPharmacy && !policy.canProceedToStep2) {
    if (!policy.areaAuthorized) {
      errors.push({
        field: "area",
        messageEn: "Selected Pharmacy is outside your assigned territory.",
        messageAr: "الصيدلية المحددة خارج نطاق منطقتك المخصصة."
      });
    } else if (policy.gpsCaptureRequired) {
      const isDemoCapture =
        draft.gps?.source?.toLowerCase() === "simulation_demo" ||
        draft.gps?.source?.toLowerCase() === "simulation";

      if (isDemoCapture) {
        errors.push({
          field: "gps",
          messageEn: "Simulation/demo GPS cannot be used to satisfy first-visit GPS registration.",
          messageAr: "لا يمكن استخدام المحاكاة للتحقق من التسجيل الأول للموقع."
        });
      } else if (
        !draft.gps ||
        draft.gps.status === "NOT_ACQUIRED" ||
        draft.gps.latitude === null
      ) {
        errors.push({
          field: "gps",
          messageEn: "First-Visit GPS Verification Required. Please click 'Acquire GPS Check-In' to register location.",
          messageAr: "التحقق الأول من الموقع الجغرافي مطلوب. يرجى النقر على 'تسجيل الحضور بالموقع'."
        });
      } else {
        errors.push({
          field: "gps",
          messageEn: `GPS verification failed (${draft.gps.errorMessage || draft.gps.status}). Please acquire valid GPS.`,
          messageAr: "فشل التحقق من الموقع الجغرافي. يرجى الحصول على إحداثيات صالحة."
        });
      }
    }
  }

  const result = {
    isValid: errors.length === 0,
    errors
  };

  logRuntimeStage({
    stage: "6_VALIDATE_STEP1",
    draftId: draft.draftId,
    pharmacyId: draft.pharmacyId || "",
    latitude: draft.gps?.latitude ?? null,
    longitude: draft.gps?.longitude ?? null,
    accuracyMeters: draft.gps?.accuracyMeters ?? draft.gps?.accuracy ?? null,
    source: draft.gps?.source || "",
    captureStatus: draft.gps?.status || "NOT_ACQUIRED",
    captureAccepted: draft.gps?.latitude != null && draft.gps?.longitude != null && draft.gps?.status !== "NOT_ACQUIRED",
    policyCanProceed: policy.canProceedToStep2,
    validationCanProceed: result.isValid,
    buttonDisabled: !result.isValid,
    blockingReason: errors.length > 0 ? errors[0].messageEn : ""
  });

  console.info(
    "[PHARMACY_VISIT_STEP1_VALIDATION_JSON]",
    JSON.stringify({
      draftId: draft.draftId,
      isValid: result.isValid,
      errorsCount: errors.length,
      gpsStatus: draft.gps?.status || "NOT_ACQUIRED",
      customerGpsStatus: policy.customerGpsStatus,
      gpsCaptureRequired: policy.gpsCaptureRequired,
      canProceedToStep2: policy.canProceedToStep2
    })
  );

  return result;
}
