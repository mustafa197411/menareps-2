import React from "react";
import { Pharmacy, User } from "../../../types";
import { PharmacyVisitDraft, PharmacyVisitGps, PharmacyVisitPurpose } from "../types/domain";
import { PharmacySelectionPanel } from "../components/PharmacySelectionPanel";
import { VisitPurposeSelector } from "../components/VisitPurposeSelector";
import { GpsCheckInPanel } from "../components/GpsCheckInPanel";
import { validateStep1PharmacyGps } from "../validation/step1Validation";
import { 
  evaluateGpsPolicyDecision, 
  CustomerGpsTarget, 
  logDiagnostic, 
  logRuntimeStage 
} from "../services/customerGpsPolicyService";
import { CANONICAL_VISIT_PURPOSES } from "../config/pharmacyVisitConfig";
import { CollapsibleSection } from "../components/CollapsibleSection";
import { Store, Target, Navigation, AlertTriangle, ArrowRight, ArrowLeft } from "lucide-react";

interface Step1PharmacyGpsProps {
  currentUser: User;
  authorizedPharmacies: Pharmacy[];
  draft: PharmacyVisitDraft;
  onSelectPharmacy: (pharmacy: Pharmacy) => void;
  onSelectPurpose: (purpose: PharmacyVisitPurpose) => void;
  onSelectAdditionalPurposes?: (codes: string[]) => void;
  onGpsAcquired: (gps: PharmacyVisitGps) => void;
  onProceedToStep2: () => void;
  lang: "en" | "ar";
}

export const Step1PharmacyGps: React.FC<Step1PharmacyGpsProps> = ({
  currentUser,
  authorizedPharmacies,
  draft,
  onSelectPharmacy,
  onSelectPurpose,
  onSelectAdditionalPurposes,
  onGpsAcquired,
  onProceedToStep2,
  lang
}) => {
  const isRtl = lang === "ar";

  const selectedPharmacy = authorizedPharmacies.find((p) => p.id === draft.pharmacyId);
  const validation = validateStep1PharmacyGps(draft, currentUser, authorizedPharmacies);

  const userAreas = (currentUser as any)?.userAreas || [
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

  const gpsPolicyDecision = evaluateGpsPolicyDecision({
    currentUser,
    customer: customerTarget,
    userAreas,
    visitGps: draft.gps
  });

  const pharmacySelected = !!draft.pharmacyId && !!selectedPharmacy;
  const purposeSelected = !!draft.visitPurpose?.code;
  const areaAuthorized = gpsPolicyDecision.areaAuthorized;
  const gpsPolicyCanProceed = gpsPolicyDecision.canProceedToStep2;

  const isButtonDisabled = !validation.isValid;
  const disabledReasons = validation.errors.map((e) => e.messageEn);

  logDiagnostic("GPS_PROCEED_BUTTON_JSON", {
    pharmacySelected,
    purposeSelected,
    areaAuthorized,
    gpsPolicyCanProceed,
    disabled: isButtonDisabled,
    disabledReasons
  });

  logRuntimeStage({
    stage: "7_BUTTON_STATE",
    draftId: draft.draftId,
    pharmacyId: draft.pharmacyId || "",
    latitude: draft.gps?.latitude ?? null,
    longitude: draft.gps?.longitude ?? null,
    accuracyMeters: draft.gps?.accuracyMeters ?? draft.gps?.accuracy ?? null,
    source: draft.gps?.source || "",
    captureStatus: draft.gps?.status || "NOT_ACQUIRED",
    captureAccepted: draft.gps?.latitude != null && draft.gps?.longitude != null && draft.gps?.status !== "NOT_ACQUIRED",
    policyCanProceed: gpsPolicyCanProceed,
    validationCanProceed: validation.isValid,
    buttonDisabled: isButtonDisabled,
    blockingReason: disabledReasons.join("; ")
  });

  const handleProceedWithLog = () => {
    logDiagnostic("PHARMACY_VISIT_STEP_TRANSITION_JSON", {
      draftId: draft.draftId,
      fromStep: 1,
      toStep: 2,
      pharmacyId: draft.pharmacyId,
      pharmacyName: selectedPharmacy?.name,
      gpsStatus: draft.gps?.status || "NOT_ACQUIRED",
      transitionAt: new Date().toISOString()
    });
    onProceedToStep2();
  };

  return (
    <div className="space-y-6">
      {/* 1. Pharmacy Selection */}
      <CollapsibleSection
        id="section-pharmacy-selection"
        title={isRtl ? "اختيار الصيدلية" : "Pharmacy Selection"}
        subtitle={isRtl ? "تحديد الصيدلية المستهدفة للزيارة" : "Select target pharmacy for this visit"}
        icon={<Store className="w-5 h-5" />}
        isError={!draft.pharmacyId}
        isComplete={!!draft.pharmacyId}
        defaultOpen={!draft.pharmacyId}
        lang={lang}
      >
        <PharmacySelectionPanel
          currentUser={currentUser}
          authorizedPharmacies={authorizedPharmacies}
          selectedPharmacyId={draft.pharmacyId}
          onSelectPharmacy={onSelectPharmacy}
          lang={lang}
        />
      </CollapsibleSection>

      {/* 2. Visit Purpose */}
      <CollapsibleSection
        id="section-visit-purpose"
        title={isRtl ? "غرض الزيارة" : "Visit Purpose"}
        subtitle={isRtl ? "اختيار الهدف الرئيسي والأهداف الثانوية" : "Select primary and secondary objectives"}
        icon={<Target className="w-5 h-5" />}
        isError={!draft.visitPurpose?.code && !draft.primaryVisitPurposeCode}
        isComplete={!!(draft.visitPurpose?.code || draft.primaryVisitPurposeCode)}
        defaultOpen={true}
        lang={lang}
      >
        <VisitPurposeSelector
          selectedPurpose={draft.visitPurpose}
          primaryPurposeCode={draft.primaryVisitPurposeCode || draft.visitPurpose?.code}
          additionalPurposeCodes={draft.additionalVisitPurposeCodes || []}
          onSelectPurpose={onSelectPurpose}
          onChangePrimaryPurpose={(code) => {
            const found = CANONICAL_VISIT_PURPOSES.find(p => p.code === code);
            if (found) onSelectPurpose(found);
          }}
          onChangeAdditionalPurposes={onSelectAdditionalPurposes}
          lang={lang}
        />
      </CollapsibleSection>

      {/* 3. GPS Check-In */}
      <CollapsibleSection
        id="section-gps-verification"
        title={isRtl ? "التحقق من الموقع الميداني (GPS)" : "Field Location Verification (GPS)"}
        subtitle={isRtl ? "التحقق الجغرافي للزيارة الأولى لتثبيت موقع الصيدلية" : "First-visit location verification for customer registration"}
        icon={<Navigation className="w-5 h-5" />}
        isError={!gpsPolicyDecision.canProceedToStep2 && !draft.gps?.latitude}
        isComplete={gpsPolicyDecision.canProceedToStep2}
        defaultOpen={true}
        lang={lang}
      >
        <GpsCheckInPanel
          currentUser={currentUser}
          selectedPharmacy={selectedPharmacy}
          gpsData={draft.gps}
          onGpsAcquired={onGpsAcquired}
          lang={lang}
        />
      </CollapsibleSection>

      {/* Inline Validation Errors */}
      {!validation.isValid && (
        <div className="p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded-xl space-y-2">
          <div className="flex items-center gap-2 text-xs font-bold text-amber-800 dark:text-amber-400">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              {isRtl
                ? "يرجى استكمال جميع المتطلبات للانتقال للخطوة التالية:"
                : "Please satisfy all requirements before proceeding to Step 2:"}
            </span>
          </div>

          <ul className="list-disc list-inside text-xs text-amber-700 dark:text-amber-300/90 space-y-1 pl-1">
            {validation.errors.map((err, i) => (
              <li key={i}>{isRtl ? err.messageAr : err.messageEn}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Step Transition Footer */}
      <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-slate-800">
        <div className="text-xs text-slate-500 dark:text-slate-400">
          {draft.pharmacySnapshot
            ? `${isRtl ? "الصيدلية المحددة:" : "Selected Pharmacy:"} ${
                draft.pharmacySnapshot.nameEn
              }`
            : isRtl
            ? "لم يتم اختيار صيدلية بعد"
            : "No pharmacy selected"}
        </div>

        <button
          type="button"
          disabled={!validation.isValid}
          onClick={handleProceedWithLog}
          className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-xs transition-all cursor-pointer disabled:cursor-not-allowed"
        >
          <span>{isRtl ? "الانتقال لطلب الأصناف (Step 2)" : "Proceed to Order Items (Step 2)"}</span>
          {isRtl ? <ArrowLeft className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
};
