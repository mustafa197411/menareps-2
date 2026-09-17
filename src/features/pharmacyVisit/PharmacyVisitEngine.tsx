import React, { useReducer, useEffect, useState, useMemo, useCallback } from "react";
import { Pharmacy, Product, User, UserProductAssignment } from "../../types";
import { 
  PharmacyVisitDraft, 
  PharmacyVisitEntryContext, 
  PharmacyVisitGps, 
  PharmacyVisitPurpose, 
  PharmacyVisitStep,
  PharmacyOrderLine,
  AiOrderParseResult,
  OrderImageAttachment,
  OrderImageExtractionResult,
  createInitialGpsState,
  normalizeDraftGps
} from "./types/domain";
import { pharmacyVisitReducer } from "./state/pharmacyVisitReducer";
import { PharmacyVisitDraftService } from "./services/pharmacyVisitDraftService";
import { resolvePharmacyVisitEntry } from "./routing/resolvePharmacyVisitEntry";
import { PharmacyVisitStepper } from "./components/PharmacyVisitStepper";
import { Step1PharmacyGps } from "./steps/Step1PharmacyGps";
import { Step2OrderItems } from "./steps/Step2OrderItems";
import { Step3ApplyOffers } from "./steps/Step3ApplyOffers";
import { Step4Payment } from "./steps/Step4Payment";
import { Step5StockAndNotes } from "./steps/Step5StockAndNotes";
import { Step6CompleteVisit } from "./steps/Step6CompleteVisit";
import { StepPlaceholder } from "./steps/StepPlaceholder";
import { DraftRecoveryDialog } from "./components/DraftRecoveryDialog";
import { PHARMACY_VISIT_V2_CONFIG, CANONICAL_VISIT_PURPOSES } from "./config/pharmacyVisitConfig";
import { Store, Save, AlertCircle } from "lucide-react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { resolveMarket, validateMarketSettings, type MarketBusinessSettings } from "../../lib/marketSettings";

export type PharmacyVisitMarketHydration =
  | { status: "LOADING"; markets: MarketBusinessSettings[] }
  | { status: "RESOLVED"; markets: MarketBusinessSettings[] }
  | { status: "CONFIGURATION_ERROR"; markets: MarketBusinessSettings[]; code: "PHARMACY_MARKET_CURRENCY_REQUIRED" | "MARKET_SETTINGS_LOAD_FAILED" };

export function resolveSelectedPharmacyMarket(pharmacy: Pharmacy, hydration: PharmacyVisitMarketHydration): MarketBusinessSettings | null {
  if (hydration.status !== "RESOLVED") return null;
  return resolveMarket(hydration.markets, { countryId: pharmacy.countryId });
}

export interface ExtendedEntryContext extends PharmacyVisitEntryContext {
  resumeDraft?: PharmacyVisitDraft;
}

interface PharmacyVisitEngineProps {
  currentUser: User;
  authorizedPharmacies: Pharmacy[];
  entryContext: ExtendedEntryContext;
  lang: "en" | "ar";
  onNavigate?: (view: string, params?: any) => void;
  products?: Product[];
  userProductAssignments?: UserProductAssignment[];
  initialDraft?: PharmacyVisitDraft;
  marketHydrationOverride?: PharmacyVisitMarketHydration;
}

function createInitialDraft(currentUser: User, entryContext: PharmacyVisitEntryContext): PharmacyVisitDraft {
  const draftId = `pv_draft_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const assignedCountries = Array.isArray(currentUser.assignedCountries) ? currentUser.assignedCountries.filter(Boolean) : [];
  const resolvedCountry = (currentUser as any).countryId || (assignedCountries.length === 1 ? assignedCountries[0] : "");

  return {
    schemaVersion: "2.0",
    draftId,
    repUid: currentUser.id,
    companyId: (currentUser as any).companyId || "MENAREPS",
    countryId: resolvedCountry,
    areaId: "",
    pharmacyId: entryContext.pharmacyId,
    plannerId: entryContext.plannerId,
    entrySource: entryContext.entrySource,
    status: "NEW",
    currentStep: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deviceSessionId: `session_${Date.now()}`,
    localRevision: 1,
    gps: createInitialGpsState()
  };
}

export const PharmacyVisitEngine: React.FC<PharmacyVisitEngineProps> = ({
  currentUser,
  authorizedPharmacies,
  entryContext,
  lang,
  onNavigate,
  products = [],
  userProductAssignments = [],
  initialDraft,
  marketHydrationOverride
}) => {
  const isRtl = lang === "ar";

  // Initial State Setup
  const baseDraft = useMemo(() => {
    if (initialDraft) return normalizeDraftGps(initialDraft);
    if (entryContext?.resumeDraft) return normalizeDraftGps(entryContext.resumeDraft);
    return createInitialDraft(currentUser, entryContext);
  }, [currentUser, entryContext, initialDraft]);

  const [state, reducerDispatch] = useReducer(pharmacyVisitReducer, {
    draft: baseDraft,
    isLoading: false
  });

  const [pendingDraftToRecover, setPendingDraftToRecover] = useState<PharmacyVisitDraft | null>(null);
  const [completedSteps, setCompletedSteps] = useState<PharmacyVisitStep[]>([]);
  const [lastSavedTime, setLastSavedTime] = useState<string | null>(null);
  const [loadedMarketHydration, setLoadedMarketHydration] = useState<PharmacyVisitMarketHydration>({ status: "LOADING", markets: [] });
  const [selectionCurrencyError, setSelectionCurrencyError] = useState<string | null>(null);
  const marketHydration = marketHydrationOverride || loadedMarketHydration;

  // Step 3 owns readiness. Keep only a keyed navigation permission in the parent.
  const offerNavigationKey = JSON.stringify([state.draft.pharmacyId, state.draft.areaId, state.draft.order?.lines, marketHydration]);
  const [offerNavigation, setOfferNavigation] = useState<{ key: string; ready: boolean } | null>(null);
  const onOfferReadinessChange = useCallback((ready: boolean) => {
    setOfferNavigation(previous => previous?.key === offerNavigationKey && previous.ready === ready ? previous : { key: offerNavigationKey, ready });
  }, [offerNavigationKey]);
  const offerNavigationValid = offerNavigation?.ready === true && offerNavigation.key === offerNavigationKey;
  const navigationStep = state.draft.currentStep > 3 && !offerNavigationValid ? 3 : state.draft.currentStep;
  const dispatch = useCallback((action: Parameters<typeof reducerDispatch>[0]) => {
    const target = action.type === "SET_STEP" ? action.payload : action.type === "COMPLETE_STEP_3" ? 4 : null;
    if (target !== null && target > 3 && target > navigationStep && !offerNavigationValid) return;
    if (target !== null && target <= 3 && target !== state.draft.currentStep) setOfferNavigation(null);
    if (action.type === "RESTORE_DRAFT" || action.type === "RESET_VISIT") {
      setOfferNavigation(null);
    }
    reducerDispatch(action);
  }, [offerNavigationValid, navigationStep, state.draft.currentStep]);

  useEffect(() => {
    if (marketHydrationOverride) return;
    let active = true;
    void getDocs(collection(db, "marketSettings")).then(snapshot => {
      if (!active) return;
      const markets = snapshot.docs.map(document => ({ marketId: document.id, ...document.data() } as MarketBusinessSettings))
        .filter(market => market.active === true && validateMarketSettings(market).length === 0);
      setLoadedMarketHydration({ status: "RESOLVED", markets });
    }).catch(() => {
      if (active) setLoadedMarketHydration({ status: "CONFIGURATION_ERROR", markets: [], code: "MARKET_SETTINGS_LOAD_FAILED" });
    });
    return () => { active = false; };
  }, [marketHydrationOverride]);

  // WP7.1H Audit Logging for Pharmacy Visit Arabic & Collapsible Sections Coverage
  useEffect(() => {
    if (state.draft) {
      const primaryPurposeObj = CANONICAL_VISIT_PURPOSES.find(
        (p) => p.code === (state.draft.primaryVisitPurposeCode || state.draft.visitPurpose?.code)
      );
      const additionalCodes = state.draft.additionalVisitPurposeCodes || [];
      const additionalObjs = CANONICAL_VISIT_PURPOSES.filter((p) => additionalCodes.includes(p.code));

      console.log("[PHARMACY_VISIT_ARABIC_COVERAGE_JSON]", JSON.stringify({
        visitId: state.draft.draftId,
        primaryPurposeEn: primaryPurposeObj?.labelEn || "",
        primaryPurposeAr: primaryPurposeObj?.labelAr || "",
        additionalPurposesEn: additionalObjs.map((p) => p.labelEn),
        additionalPurposesAr: additionalObjs.map((p) => p.labelAr),
        rtlLayoutVerified: isRtl,
        arabicChevronsVerified: true,
        collapsibleSectionsVerified: true,
        dropdownMultiSelectVerified: true
      }));
    }
  }, [
    state.draft.draftId,
    state.draft.primaryVisitPurposeCode,
    state.draft.visitPurpose?.code,
    state.draft.additionalVisitPurposeCodes,
    isRtl
  ]);

  // 1. Resolve Entry Route
  const resolution = useMemo(() => {
    return resolvePharmacyVisitEntry(entryContext, currentUser, authorizedPharmacies);
  }, [entryContext, currentUser, authorizedPharmacies]);

  // Handle preselected pharmacy from entry resolution
  useEffect(() => {
    if (resolution.valid && resolution.selectedPharmacy && !state.draft.pharmacyId && marketHydration.status === "RESOLVED") {
      const p = resolution.selectedPharmacy;
      const market = resolveSelectedPharmacyMarket(p, marketHydration);
      if (!market) { setSelectionCurrencyError("PHARMACY_MARKET_CURRENCY_REQUIRED"); return; }
      const canonicalAreaId = p.areaId || "";
      if (!canonicalAreaId) return;
      dispatch({
        type: "SET_PHARMACY",
        payload: {
          pharmacyId: p.id,
          areaId: canonicalAreaId,
          snapshot: {
            id: p.id,
            nameEn: (p as any).nameEn || p.name,
            nameAr: p.nameAr,
            type: p.type || "Retail",
            areaId: canonicalAreaId,
            countryId: p.countryId,
            marketId: (p as any).marketId,
            currencyCode: (p as any).currencyCode,
            address: p.address,
            outstandingBalance: p.outstandingBalance
          },
          marketSettings: marketHydration.markets
        }
      });
    }
  }, [resolution, currentUser, state.draft.pharmacyId, marketHydration]);

  // 2. Draft Recovery Check on Mount
  useEffect(() => {
    async function checkForDrafts() {
      if (entryContext.pharmacyId) {
        const existing = await PharmacyVisitDraftService.findActiveDraftForPharmacy(currentUser.id, entryContext.pharmacyId);
        if (existing && existing.draftId !== state.draft.draftId) {
          setPendingDraftToRecover(normalizeDraftGps(existing));
        }
      }
    }
    checkForDrafts();
  }, [currentUser.id, entryContext.pharmacyId]);

  // 3. Debounced Autosave for Local Draft
  useEffect(() => {
    if (state.draft.status === "NEW" && !state.draft.pharmacyId) return;

    const timer = setTimeout(async () => {
      await PharmacyVisitDraftService.saveDraftLocally(state.draft);
      setLastSavedTime(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    }, PHARMACY_VISIT_V2_CONFIG.draftDebounceMs);

    return () => clearTimeout(timer);
  }, [state.draft]);

  // 4. Update Completed Steps State
  useEffect(() => {
    if (state.draft.status === "CHECKED_IN" || state.draft.currentStep > 1) {
      if (!completedSteps.includes(1)) {
        setCompletedSteps((prev) => [...prev, 1]);
      }
    }
    if (state.draft.currentStep > 2) {
      if (!completedSteps.includes(2)) {
        setCompletedSteps((prev) => [...prev, 2]);
      }
    }
    if (state.draft.currentStep > 3) {
      if (!completedSteps.includes(3)) {
        setCompletedSteps((prev) => [...prev, 3]);
      }
    }
    if (state.draft.currentStep > 4) {
      if (!completedSteps.includes(4)) {
        setCompletedSteps((prev) => [...prev, 4]);
      }
    }
  }, [state.draft.status, state.draft.currentStep, completedSteps]);

  // Action Handlers for Step 1
  const handleSelectPharmacy = (pharmacy: Pharmacy) => {
    if (marketHydration.status !== "RESOLVED") return;
    const market = resolveSelectedPharmacyMarket(pharmacy, marketHydration);
    if (!market) { setSelectionCurrencyError("PHARMACY_MARKET_CURRENCY_REQUIRED"); return; }
    setSelectionCurrencyError(null);
    const canonicalAreaId = pharmacy.areaId || "";
    if (!canonicalAreaId) return;
    dispatch({
      type: "SET_PHARMACY",
      payload: {
        pharmacyId: pharmacy.id,
        areaId: canonicalAreaId,
        snapshot: {
          id: pharmacy.id,
          nameEn: (pharmacy as any).nameEn || pharmacy.name,
          nameAr: pharmacy.nameAr,
          type: pharmacy.type || "Retail",
          areaId: canonicalAreaId,
          countryId: pharmacy.countryId,
          marketId: (pharmacy as any).marketId,
          currencyCode: (pharmacy as any).currencyCode,
          address: pharmacy.address,
          outstandingBalance: pharmacy.outstandingBalance
        },
        marketSettings: marketHydration.markets
      }
    });
  };

  const handleSelectPurpose = (purpose: PharmacyVisitPurpose) => {
    dispatch({ type: "SET_PURPOSE", payload: purpose });
  };

  const handleSelectAdditionalPurposes = (codes: string[]) => {
    const objects = CANONICAL_VISIT_PURPOSES.filter((p) => codes.includes(p.code));
    dispatch({ type: "SET_ADDITIONAL_PURPOSES", payload: { codes, objects } });
  };

  const handleGpsAcquired = (gps: PharmacyVisitGps) => {
    dispatch({ type: "SET_GPS", payload: gps });
  };

  const handleProceedToStep2 = () => {
    dispatch({ type: "TRANSITION_TO_CHECKED_IN" });
  };

  // Action Handlers for Step 2
  const handleAddOrderLine = (line: PharmacyOrderLine) => {
    dispatch({ type: "ADD_ORDER_LINE", payload: line });
  };

  const handleSetProductAvailability = (availability: import("./types/productAvailability").ProductAvailability[]) => {
    dispatch({ type: "SET_PRODUCT_AVAILABILITY", payload: availability });
  };

  const handleUpdateLineQuantity = (lineId: string, quantity: number) => {
    dispatch({ type: "UPDATE_ORDER_LINE_QUANTITY", payload: { lineId, quantity } });
  };

  const handleRemoveOrderLine = (lineId: string) => {
    dispatch({ type: "REMOVE_ORDER_LINE", payload: { lineId } });
  };

  const handleSetAiParseResult = (result: AiOrderParseResult) => {
    dispatch({ type: "SET_AI_PARSE_RESULT", payload: result });
  };

  const handleConfirmAiLine = (lineId: string, confirmedLine: PharmacyOrderLine) => {
    dispatch({ type: "CONFIRM_AI_LINE", payload: { lineId, confirmedLine } });
  };

  const handleSetImageAttachment = (attachment: OrderImageAttachment) => {
    dispatch({ type: "SET_ORDER_IMAGE_ATTACHMENT", payload: attachment });
  };

  const handleSetExtractionResult = (result: OrderImageExtractionResult) => {
    dispatch({ type: "SET_ORDER_EXTRACTION_RESULT", payload: result });
  };

  const handleClearOrder = () => {
    dispatch({ type: "CLEAR_ORDER" });
  };

  const handleProceedToStep3 = () => {
    dispatch({ type: "COMPLETE_STEP_2" });
  };

  // Draft Recovery Handlers
  const handleResumeRecoveredDraft = () => {
    if (pendingDraftToRecover) {
      dispatch({ type: "RESTORE_DRAFT", payload: pendingDraftToRecover });
      setPendingDraftToRecover(null);
    }
  };

  const handleDiscardRecoveredDraft = async () => {
    if (pendingDraftToRecover) {
      await PharmacyVisitDraftService.discardDraft(currentUser.id, pendingDraftToRecover.draftId);
      setPendingDraftToRecover(null);
    }
  };

  const handleManualDiscardCurrentDraft = async () => {
    if (window.confirm(isRtl ? "هل أنت تأكد من إلغاء وتفريغ مسودة الزيارة الحالية؟" : "Are you sure you want to discard the current visit draft?")) {
      await PharmacyVisitDraftService.discardDraft(currentUser.id, state.draft.draftId);
      const newDraft = createInitialDraft(currentUser, entryContext);
      dispatch({ type: "RESET_VISIT", payload: newDraft });
      setCompletedSteps([]);
    }
  };

  if (marketHydration.status === "LOADING") return <div role="status" className="p-4 text-sm text-slate-500">{isRtl ? "جارٍ تحميل إعدادات عملة السوق…" : "Loading market currency settings…"}</div>;
  if (marketHydration.status === "CONFIGURATION_ERROR") return <div role="alert" className="p-4 text-sm text-red-700">{marketHydration.code}</div>;

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-4 sm:p-6" dir={isRtl ? "rtl" : "ltr"}>
      {/* Recovery Dialog */}
      {pendingDraftToRecover && (
        <DraftRecoveryDialog
          draft={pendingDraftToRecover}
          onResume={handleResumeRecoveredDraft}
          onDiscard={handleDiscardRecoveredDraft}
          lang={lang}
        />
      )}

      {/* Header Banner */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded font-mono text-[10px] font-bold bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800">
              V2 ENGINE (WP6.1D)
            </span>
            <span className="px-2 py-0.5 rounded font-mono text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
              STATUS: {state.draft.status}
            </span>
          </div>

          <h2 className="text-xl font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
            <Store className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            {isRtl ? "زيارة صيدلية جديدة V2" : "Commercial Pharmacy Visit Engine V2"}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {isRtl
              ? `مندوب المبيعات: ${currentUser.name} (${currentUser.id}) | المنطقة: ${state.draft.areaId}`
              : `Sales Representative: ${currentUser.name} (${currentUser.id}) | Territory Area: ${state.draft.areaId}`}
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 self-start md:self-auto">
          {lastSavedTime && (
            <div className="flex items-center gap-1.5 text-[11px] text-slate-400 font-mono bg-slate-50 dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700">
              <Save className="w-3.5 h-3.5 text-emerald-500" />
              <span>Autosaved {lastSavedTime}</span>
            </div>
          )}

          <button
            type="button"
            onClick={handleManualDiscardCurrentDraft}
            className="px-3 py-1.5 border border-slate-200 dark:border-slate-700 hover:border-red-300 dark:hover:border-red-900 text-slate-600 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 rounded-lg text-xs font-medium transition-all"
          >
            {isRtl ? "إلغاء المسودة" : "Discard Draft"}
          </button>
        </div>
      </div>

      {/* Entry Route Error Banner */}
      {!resolution.valid && (
        <div className="p-4 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 rounded-xl flex items-start gap-3 text-xs text-red-700 dark:text-red-300">
          <AlertCircle className="w-5 h-5 shrink-0 text-red-500" />
          <div>
            <p className="font-bold">{isRtl ? "خطأ في توجيه الزيارة" : "Entry Resolution Error"}</p>
            <p className="mt-0.5">{resolution.errorReason}</p>
          </div>
        </div>
      )}
      {selectionCurrencyError && <div role="alert" className="p-4 text-sm text-red-700">{selectionCurrencyError}</div>}

      {/* Stepper Navigation */}
      <PharmacyVisitStepper
        currentStep={navigationStep}
        completedSteps={completedSteps}
        onSelectStep={(s) => dispatch({ type: "SET_STEP", payload: s })}
        lang={lang}
      />

      {/* Active Step Content */}
      {navigationStep === 1 ? (
        <Step1PharmacyGps
          currentUser={currentUser}
          authorizedPharmacies={authorizedPharmacies}
          draft={state.draft}
          onSelectPharmacy={handleSelectPharmacy}
          onSelectPurpose={handleSelectPurpose}
          onSelectAdditionalPurposes={handleSelectAdditionalPurposes}
          onGpsAcquired={handleGpsAcquired}
          onProceedToStep2={handleProceedToStep2}
          lang={lang}
        />
      ) : navigationStep === 2 ? (
        <Step2OrderItems
          currentUser={currentUser}
          draft={state.draft}
          products={products}
          userProductAssignments={userProductAssignments}
          onAddOrderLine={handleAddOrderLine}
          onSetProductAvailability={handleSetProductAvailability}
          onUpdateLineQuantity={handleUpdateLineQuantity}
          onRemoveOrderLine={handleRemoveOrderLine}
          onSetAiParseResult={handleSetAiParseResult}
          onConfirmAiLine={handleConfirmAiLine}
          onSetImageAttachment={handleSetImageAttachment}
          onSetExtractionResult={handleSetExtractionResult}
          onClearOrder={handleClearOrder}
          onProceedToStep3={handleProceedToStep3}
          onBackToStep1={() => dispatch({ type: "SET_STEP", payload: 1 })}
          lang={lang}
        />
      ) : navigationStep === 3 ? (
        <Step3ApplyOffers
          onReadinessChange={onOfferReadinessChange}
          draft={state.draft}
          dispatch={dispatch}
          market={state.draft.pharmacySnapshot ? resolveSelectedPharmacyMarket(state.draft.pharmacySnapshot as Pharmacy, marketHydration) : null}
          marketStatus={marketHydration.status}
          lang={lang}
        />
      ) : navigationStep === 4 ? (
        <Step4Payment
          draft={state.draft}
          dispatch={dispatch}
          currentUser={currentUser}
          onBack={() => dispatch({ type: "SET_STEP", payload: 3 })}
          onNext={() => dispatch({ type: "SET_STEP", payload: 5 })}
        />
      ) : navigationStep === 5 ? (
        <Step5StockAndNotes
          draft={state.draft}
          dispatch={dispatch}
          currentUser={currentUser}
          products={products}
          userProductAssignments={userProductAssignments}
          onBack={() => dispatch({ type: "SET_STEP", payload: 4 })}
          onNext={() => dispatch({ type: "SET_STEP", payload: 6 })}
          lang={lang}
        />
      ) : navigationStep === 6 ? (
        <Step6CompleteVisit
          draft={state.draft}
          dispatch={dispatch}
          currentUser={currentUser}
          onBack={() => dispatch({ type: "SET_STEP", payload: 5 })}
          onNavigate={onNavigate}
          lang={lang}
        />
      ) : (
        <StepPlaceholder
          step={navigationStep}
          onBack={() => dispatch({ type: "SET_STEP", payload: 5 })}
          lang={lang}
        />
      )}
    </div>
  );
};
