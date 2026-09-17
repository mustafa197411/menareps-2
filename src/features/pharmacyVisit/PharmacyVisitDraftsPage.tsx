import React, { useEffect, useState } from "react";
import { getVisitBusinessNumber } from "../../utils/visitNumberUtils";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { User, Pharmacy, Product, UserProductAssignment } from "../../types";
import { PharmacyVisitDraft } from "./types/domain";
import { PharmacyVisitDraftService } from "./services/pharmacyVisitDraftService";
import { formatCurrency, getCurrencyInfo } from "./utils/currency";
import {
  FileText,
  RotateCcw,
  Trash2,
  Clock,
  MapPin,
  AlertCircle,
  Building2,
  CheckCircle2,
  XCircle,
  ShieldAlert,
  ArrowRight
} from "lucide-react";

interface PharmacyVisitDraftsPageProps {
  currentUser: User;
  authorizedPharmacies: Pharmacy[];
  products?: Product[];
  userProductAssignments?: UserProductAssignment[];
  lang?: "en" | "ar";
  onNavigate?: (view: string, params?: any) => void;
  onResumeDraft?: (draft: PharmacyVisitDraft) => void;
}

export const PharmacyVisitDraftsPage: React.FC<PharmacyVisitDraftsPageProps> = ({
  currentUser,
  authorizedPharmacies,
  products = [],
  userProductAssignments = [],
  lang = "en",
  onNavigate,
  onResumeDraft
}) => {
  const isRtl = lang === "ar";
  const [drafts, setDrafts] = useState<PharmacyVisitDraft[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [actionError, setActionError] = useState<string | null>(null);

  // Print Storage Audit JSON on mount
  useEffect(() => {
    console.info(
      "[PHARMACY_VISIT_DRAFT_STORAGE_AUDIT_JSON]",
      JSON.stringify({
        storageType: "LOCAL_STORAGE",
        collectionOrKey: "menareps_pv_draft_v2_{repUid}_{draftId}",
        documentIdPattern: "PV2_{repUid}_{draftId}",
        draftOwnerField: "repUid",
        draftStatusField: "status",
        currentStepField: "currentStep",
        lastUpdatedField: "updatedAt",
        recoverableAfterRefresh: true,
        recoverableAfterSignOut: true
      })
    );
    loadUserDrafts();
  }, [currentUser.id]);

  const loadUserDrafts = async () => {
    setLoading(true);
    setActionError(null);
    try {
      const allDrafts = await PharmacyVisitDraftService.getAllLocalDrafts(currentUser.id);
      const activeDrafts: PharmacyVisitDraft[] = [];

      for (const d of allDrafts) {
        if (d.repUid !== currentUser.id || (d.status as string) === "COMPLETED" || (d.status as string) === "DISCARDED") {
          continue;
        }

        // Check if matching completed Visit exists in Firestore
        const visitIdToLookup = d.completedVisitId || `PV2_${currentUser.id}_${d.draftId}`;
        let matchingCompletedVisitId: string | null = null;
        let matchingDisplayNumber: string | null = null;

        try {
          const visitSnap = await getDoc(doc(db, "pharmacyVisits", visitIdToLookup));
          if (visitSnap.exists() && visitSnap.data().status === "COMPLETED") {
            matchingCompletedVisitId = visitSnap.id;
            matchingDisplayNumber = visitSnap.data().displayNumber || null;
          }
        } catch (e) {
          // Ignore read error
        }

        if (matchingCompletedVisitId) {
          // Reconcile and mark draft COMPLETED
          d.status = "COMPLETED" as any;
          d.completedVisitId = matchingCompletedVisitId;
          if (matchingDisplayNumber) d.completedDisplayNumber = matchingDisplayNumber;
          await PharmacyVisitDraftService.saveDraftLocally(d);

          console.info(
            "[PHARMACY_VISIT_DRAFT_RECONCILIATION_JSON]",
            JSON.stringify({
              draftId: d.draftId,
              statusBefore: "IN_PROGRESS",
              matchingCompletedVisitId,
              matchingDisplayNumber,
              action: "MARK_COMPLETED"
            })
          );
        } else {
          activeDrafts.push(d);
          console.info(
            "[PHARMACY_VISIT_DRAFT_RECONCILIATION_JSON]",
            JSON.stringify({
              draftId: d.draftId,
              statusBefore: d.status || "IN_PROGRESS",
              matchingCompletedVisitId: null,
              matchingDisplayNumber: null,
              action: "KEEP_ACTIVE"
            })
          );
        }
      }

      setDrafts(activeDrafts);
    } catch (err) {
      console.error("[PharmacyVisitDraftsPage] Failed to load drafts:", err);
      setActionError("Failed to load local drafts.");
    } finally {
      setLoading(false);
    }
  };

  const handleResume = (draft: PharmacyVisitDraft) => {
    setActionError(null);

    if (draft.status === "COMPLETED") {
      setActionError("This visit draft has already been officially completed and cannot be reopened.");
      return;
    }

    // Validate pharmacy access
    if (draft.pharmacyId) {
      const pharmExists = authorizedPharmacies.some((p) => p.id === draft.pharmacyId);
      if (!pharmExists && authorizedPharmacies.length > 0) {
        setActionError(`The target Pharmacy (${draft.pharmacySnapshot?.nameEn || draft.pharmacyId}) is no longer in your authorized active list.`);
        return;
      }
    }

    if (onResumeDraft) {
      onResumeDraft(draft);
    } else if (onNavigate) {
      onNavigate("pharmacies-pharmacy-visit", { resumeDraft: draft });
    }
  };

  const handleDiscard = async (draftId: string) => {
    if (!window.confirm("Are you sure you want to discard this visit draft? All uncommitted data will be lost.")) {
      return;
    }
    try {
      await PharmacyVisitDraftService.discardDraft(currentUser.id, draftId);
      await loadUserDrafts();
    } catch (err) {
      console.error("[PharmacyVisitDraftsPage] Failed to discard draft:", err);
      setActionError("Failed to discard draft.");
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-indigo-50 dark:bg-indigo-950/60 rounded-xl text-indigo-600 dark:text-indigo-400">
            <FileText className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">
              {isRtl ? "مسودات زيارات الصيدليات" : "Pharmacy Visit Drafts"}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {isRtl
                ? "إدارة واستئناف مسودات الزيارات المحفوظة غير المكتملة"
                : "Manage, resume, or discard active uncompleted pharmacy visit drafts."}
            </p>
          </div>
        </div>

        <button
          onClick={() => onNavigate && onNavigate("pharmacies-pharmacy-visit")}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold flex items-center gap-2 transition-all shadow-xs"
        >
          <span>{isRtl ? "زيارة صيدلية جديدة" : "New Pharmacy Visit"}</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      {/* Action Error Banner */}
      {actionError && (
        <div className="p-4 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800/60 rounded-xl text-xs text-red-700 dark:text-red-300 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
          <span>{actionError}</span>
        </div>
      )}

      {/* Loading state */}
      {loading ? (
        <div className="p-12 text-center text-slate-400 text-sm font-mono">
          Loading visit drafts...
        </div>
      ) : drafts.length === 0 ? (
        /* Empty State */
        <div className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 rounded-2xl p-12 text-center space-y-4 max-w-md mx-auto my-8">
          <div className="w-12 h-12 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mx-auto text-slate-400">
            <FileText className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">
              {isRtl ? "لا توجد مسودات زيارات محفوظة" : "No Active Visit Drafts Found"}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {isRtl
                ? "جميع زيارات الصيدليات مكتملة أو لم تبدأ بعد."
                : "You do not have any pending uncompleted visit drafts."}
            </p>
          </div>
        </div>
      ) : (
        /* Drafts Cards Grid */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {drafts.map((draft, idx) => {
            const countryCode = draft.currencyCode || draft.order?.currency || draft.pharmacySnapshot?.currencyCode;
            const gross = draft.order?.subtotalPreview ?? 0;
            const discount = draft.offers?.calculation?.totalDiscountAmount ?? 0;
            const netTotal = draft.offers?.calculation?.netTotal ?? Math.max(0, gross - discount);

            const isFailed = draft.status === "FAILED_COMPLETION";

            return (
              <div
                key={draft.draftId}
                className={`bg-white dark:bg-slate-900 rounded-2xl border ${
                  isFailed
                    ? "border-red-300 dark:border-red-900/80 shadow-xs"
                    : "border-slate-200 dark:border-slate-800"
                } p-5 space-y-4 flex flex-col justify-between hover:shadow-md transition-all`}
              >
                <div className="space-y-3">
                  {/* Status & Step */}
                  <div className="flex items-center justify-between">
                    <span
                      className={`px-2.5 py-1 rounded-full text-[11px] font-mono font-bold border ${
                        isFailed
                          ? "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/60 dark:text-red-300"
                          : "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-300"
                      }`}
                    >
                      {isFailed ? "FAILED_COMPLETION" : draft.status || "DRAFT"}
                    </span>

                    <span className="text-xs font-mono font-semibold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2.5 py-0.5 rounded-md">
                      Step {draft.currentStep} of 6
                    </span>
                  </div>

                  {/* Pharmacy Details */}
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-slate-400 shrink-0" />
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                        {draft.pharmacySnapshot?.nameEn || draft.pharmacyId || "Unselected Pharmacy"}
                      </h3>
                    </div>
                    {draft.visitPurpose && (
                      <p className="text-xs text-slate-500 dark:text-slate-400 pl-6">
                        {isRtl ? draft.visitPurpose.labelAr : draft.visitPurpose.labelEn}
                      </p>
                    )}
                  </div>

                  {/* Financial & GPS Summary */}
                  <div className="grid grid-cols-2 gap-2 bg-slate-50 dark:bg-slate-800/50 p-2.5 rounded-xl text-xs font-mono border border-slate-100 dark:border-slate-800">
                    <div>
                      <span className="text-[10px] text-slate-400 block uppercase">Order Net</span>
                      <span className="font-bold text-slate-800 dark:text-slate-200">
                        {formatCurrency(netTotal, countryCode)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 block uppercase">GPS Status</span>
                      <span
                        className={`font-semibold ${
                          draft.gps?.status === "VERIFIED"
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-amber-600 dark:text-amber-400"
                        }`}
                      >
                        {draft.gps?.status || "NOT_CAPTURED"}
                      </span>
                    </div>
                  </div>

                  {/* Metadata */}
                  <div className="space-y-1 text-[11px] font-mono text-slate-400 pt-1">
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3 h-3 text-slate-400" />
                      <span>Saved: {new Date(draft.updatedAt).toLocaleString()}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <FileText className="w-3 h-3 text-slate-400" />
                      <span className="truncate font-bold text-indigo-600 dark:text-indigo-400">
                        {getVisitBusinessNumber(draft, idx, "PV")}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                  <button
                    onClick={() => handleDiscard(draft.draftId)}
                    className="px-3 py-2 border border-slate-200 dark:border-slate-700 hover:border-red-300 hover:bg-red-50 text-slate-600 hover:text-red-600 dark:text-slate-300 dark:hover:bg-red-950/40 rounded-xl text-xs font-medium flex items-center gap-1 transition-all"
                    title="Discard Draft"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>{isRtl ? "حذف" : "Discard"}</span>
                  </button>

                  <button
                    onClick={() => handleResume(draft)}
                    className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all shadow-xs"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>{isRtl ? "استئناف المسودة" : "Resume Draft"}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
