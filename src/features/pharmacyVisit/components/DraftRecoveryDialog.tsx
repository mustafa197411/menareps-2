import React from "react";
import { PharmacyVisitDraft } from "../types/domain";
import { RotateCcw, Trash2, Clock, MapPin, AlertCircle } from "lucide-react";

interface DraftRecoveryDialogProps {
  draft: PharmacyVisitDraft;
  onResume: () => void;
  onDiscard: () => void;
  lang: "en" | "ar";
}

export const DraftRecoveryDialog: React.FC<DraftRecoveryDialogProps> = ({
  draft,
  onResume,
  onDiscard,
  lang
}) => {
  const isRtl = lang === "ar";

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4">
        <div className="flex items-center gap-3 text-indigo-600 dark:text-indigo-400">
          <div className="p-2 bg-indigo-50 dark:bg-indigo-950/50 rounded-xl">
            <RotateCcw className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              {isRtl ? "تم العثور على مسودة زيارة سابقة" : "Unfinished Visit Draft Found"}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {isRtl ? "تتوفر مسودة زيارة غير مكتملة لهذه الصيدلية" : "You have an uncompleted draft saved on this device."}
            </p>
          </div>
        </div>

        <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/60 rounded-xl p-3.5 space-y-2 text-xs">
          <div className="flex justify-between items-center text-slate-700 dark:text-slate-200">
            <span className="font-semibold">{draft.pharmacySnapshot?.nameEn || draft.pharmacyId}</span>
            <span className="font-mono text-[10px] text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950 px-2 py-0.5 rounded font-bold">
              Step {draft.currentStep} of 6
            </span>
          </div>

          {draft.visitPurpose && (
            <p className="text-slate-500 dark:text-slate-400">
              {isRtl ? draft.visitPurpose.labelAr : draft.visitPurpose.labelEn}
            </p>
          )}

          <div className="flex items-center gap-1.5 text-[11px] text-slate-400 font-mono pt-1">
            <Clock className="w-3 h-3" />
            <span>Last Saved: {new Date(draft.updatedAt).toLocaleString()}</span>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onDiscard}
            className="w-full sm:w-auto px-4 py-2 border border-slate-200 dark:border-slate-700 hover:border-red-300 dark:hover:border-red-900 text-slate-700 dark:text-slate-300 hover:text-red-600 dark:hover:text-red-400 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-all"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {isRtl ? "حذف المسودة والبدء جديداً" : "Discard Draft"}
          </button>

          <button
            type="button"
            onClick={onResume}
            className="w-full sm:w-auto px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-all shadow-xs"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            {isRtl ? "استئناف المسودة" : "Resume Draft"}
          </button>
        </div>
      </div>
    </div>
  );
};
