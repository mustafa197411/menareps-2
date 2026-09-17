import React, { useState } from "react";
import { Pharmacy, User } from "../../../types";
import { PharmacyVisitGps } from "../types/domain";
import { acquireHardenedGPS } from "../../../lib/gpsHardening";
import {
  resolveCustomerGpsVerificationStatus,
  CustomerGpsTarget,
  logDiagnostic,
  logRuntimeStage
} from "../services/customerGpsPolicyService";
import {
  Navigation,
  MapPin,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Info
} from "lucide-react";

interface GpsCheckInPanelProps {
  currentUser: User;
  selectedPharmacy?: Pharmacy;
  gpsData?: PharmacyVisitGps;
  onGpsAcquired: (gps: PharmacyVisitGps) => void;
  lang: "en" | "ar";
}

export const GpsCheckInPanel: React.FC<GpsCheckInPanelProps> = ({
  currentUser,
  selectedPharmacy,
  gpsData,
  onGpsAcquired,
  lang
}) => {
  const isRtl = lang === "ar";
  const [isAcquiring, setIsAcquiring] = useState(false);
  const [acquireError, setAcquireError] = useState<string | null>(null);

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

  const customerGpsStatus = resolveCustomerGpsVerificationStatus(customerTarget);
  const isVerified = customerGpsStatus === "VERIFIED";

  const handleAcquireGPS = async () => {
    if (!selectedPharmacy) {
      setAcquireError(
        isRtl
          ? "يرجى اختيار صيدلية أولاً قبل إجراء تسجيل الحضور."
          : "Please select a pharmacy first before acquiring GPS."
      );
      return;
    }

    setIsAcquiring(true);
    setAcquireError(null);

    let lifecycleResult = "ACQUIRED";
    let lifecycleErrorCode: string | null = null;

    try {
      logRuntimeStage({
        stage: "1_ACQUIRE_CLICK",
        draftId: (gpsData as any)?.timestamp || "active_draft",
        pharmacyId: selectedPharmacy.id,
        source: "device",
        captureStatus: "ACQUIRING"
      });

      const pharmName = (selectedPharmacy as any).nameEn || selectedPharmacy.name;
      const record = await acquireHardenedGPS(
        currentUser,
        `Pharmacy Visit - ${pharmName}`,
        { accuracyMode: "WARNING_ONLY" }
      );

      logRuntimeStage({
        stage: "2_HARDENED_GPS_RETURN",
        draftId: record.timestamp,
        pharmacyId: selectedPharmacy.id,
        latitude: record.latitude,
        longitude: record.longitude,
        accuracyMeters: record.accuracy,
        source: record.source,
        captureStatus: "ACQUIRED",
        captureAccepted: true
      });

      const updatedGps: PharmacyVisitGps = {
        latitude: record.latitude,
        longitude: record.longitude,
        accuracy: record.accuracy,
        accuracyMeters: record.accuracy,
        timestamp: record.timestamp,
        capturedAt: record.timestamp,
        source: "device",
        spoofCheckStatus: record.spoofCheckStatus,
        status: "VERIFIED"
      };

      setAcquireError(null);

      logDiagnostic("PHARMACY_VISIT_GPS_CAPTURE_JSON", {
        draftId: updatedGps.timestamp,
        capturedAt: updatedGps.capturedAt,
        source: updatedGps.source,
        latitude: updatedGps.latitude,
        longitude: updatedGps.longitude,
        accuracyMeters: updatedGps.accuracyMeters,
        status: updatedGps.status
      });

      onGpsAcquired(updatedGps);
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      setAcquireError(errMsg);

      const errCode = errMsg.toLowerCase().includes("permission")
        ? "PERMISSION_DENIED"
        : errMsg.toLowerCase().includes("timeout")
        ? "TIMEOUT"
        : "ERROR";

      lifecycleResult = "ERROR";
      lifecycleErrorCode = errCode;

      const failedGps: PharmacyVisitGps = {
        latitude: null,
        longitude: null,
        accuracy: null,
        accuracyMeters: null,
        timestamp: null,
        capturedAt: null,
        source: null,
        status: errCode as any,
        errorCode: errCode,
        errorMessage: errMsg,
        failureReason: errMsg
      };

      logDiagnostic("PHARMACY_VISIT_GPS_CAPTURE_JSON", failedGps);
      onGpsAcquired(failedGps);
    } finally {
      setIsAcquiring(false);
      logDiagnostic("GPS_ACQUISITION_LIFECYCLE_JSON", {
        stage: "ACQUISITION_LIFECYCLE_END",
        isAcquiring: false,
        result: lifecycleResult,
        errorCode: lifecycleErrorCode,
        loadingCleared: true
      });
    }
  };

  const isAcquired = gpsData && gpsData.latitude !== null && gpsData.longitude !== null;

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs space-y-4">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <Navigation className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
              {isVerified
                ? isRtl
                  ? "موقع الصيدلية مؤكد مسبقاً"
                  : "Location Previously Verified On File"
                : isRtl
                ? "تسجيل الموقع لأول مرة مطلوب"
                : "First-Visit GPS Verification Required"}
            </h3>

            <span
              className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                isVerified
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                  : "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
              }`}
            >
              {customerGpsStatus}
            </span>
          </div>

          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {isVerified
              ? isRtl
                ? "تم إثبات الموقع الجغرافي لهذه الصيدلية سابقاً. لا يلزم التقاط موقع للزيارات التالية."
                : "This customer’s location is globally verified. No further GPS checks required."
              : isRtl
              ? "يتطلب تسجيل الحضور لالتقاط الموقع الجغرافي الميداني لأول مرة."
              : "First visit requires acquiring live physical GPS location once."}
          </p>
        </div>

        {!isVerified && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleAcquireGPS}
              disabled={isAcquiring || !selectedPharmacy}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-xs font-medium flex items-center justify-center gap-2 transition-all shadow-xs cursor-pointer disabled:cursor-not-allowed"
            >
              {isAcquiring ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  {isRtl ? "جاري التقاط الموقع..." : "Acquiring Location..."}
                </>
              ) : (
                <>
                  <MapPin className="w-3.5 h-3.5" />
                  {isAcquired
                    ? isRtl
                      ? "إعادة التقاط GPS"
                      : "Re-Acquire GPS"
                    : isRtl
                    ? "تسجيل الحضور بالموقع"
                    : "Acquire GPS Check-In"}
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {acquireError && (
        <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 rounded-lg flex items-start gap-2.5 text-xs text-red-700 dark:text-red-400">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-500" />
          <div>
            <p className="font-semibold">{isRtl ? "تنبيه التقاط الموقع" : "GPS Acquisition Result"}</p>
            <p className="mt-0.5">{acquireError}</p>
          </div>
        </div>
      )}

      {/* Main Status Display Panel */}
      {isVerified ? (
        <div className="p-4 rounded-xl border bg-emerald-50/60 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-800 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                {isRtl
                  ? "موقع الصيدلية مؤكد ومسجل في الملف"
                  : "Pharmacy Location Verified On File"}
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-300">
                {isRtl
                  ? "تم التحقق من الموقع الجغرافي سابقاً. يمكنك متابعة إجراءات الزيارة مباشرة دون الحاجة لإعادة الالتقاط."
                  : "Customer location is globally verified. You may proceed immediately without additional GPS checks."}
              </p>
              {selectedPharmacy?.latitude != null && selectedPharmacy?.longitude != null && (
                <div className="mt-2 pt-2 border-t border-emerald-200 dark:border-emerald-900/40 text-[11px] font-mono text-slate-600 dark:text-slate-300">
                  Location: {selectedPharmacy.latitude.toFixed(5)}, {selectedPharmacy.longitude.toFixed(5)}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : !isAcquired ? (
        <div className="p-4 rounded-xl border bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700/60 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                {isRtl
                  ? "لم يتم التقاط موقع الزيارة الجغرافي بعد"
                  : "GPS status: Not acquired"}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {isRtl
                  ? "انقر فوق 'تسجيل الحضور بالموقع' لإثبات الحضور الميداني وإرسال الإحداثيات."
                  : "Click 'Acquire GPS Check-In' to capture live physical coordinates."}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="p-4 rounded-xl border bg-emerald-50/60 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-800">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-xs font-semibold text-slate-900 dark:text-white">
                  {isRtl
                    ? "تم التقاط الموقع الجغرافي بنجاح"
                    : "GPS Location Acquired Successfully"}
                </p>
                <p className="text-xs text-slate-700 dark:text-slate-300 font-sans">
                  {isRtl
                    ? "تم التقاط الإحداثيات الميدانية وتوثيقها للعميل."
                    : "Live physical location captured and verified for customer registration."}
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-2 text-[11px] font-mono text-slate-700 dark:text-slate-200">
                  <div>
                    <span className="text-slate-400 block font-sans">{isRtl ? "خط العرض" : "Latitude"}</span>
                    {gpsData.latitude!.toFixed(5)}
                  </div>
                  <div>
                    <span className="text-slate-400 block font-sans">{isRtl ? "خط الطول" : "Longitude"}</span>
                    {gpsData.longitude!.toFixed(5)}
                  </div>
                  <div>
                    <span className="text-slate-400 block font-sans">{isRtl ? "الدقة" : "Accuracy"}</span>
                    ±{(gpsData.accuracy ?? gpsData.accuracyMeters ?? 0).toFixed(1)}m
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

