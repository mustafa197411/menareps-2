import React from "react";
import { CANONICAL_VISIT_PURPOSES } from "../config/pharmacyVisitConfig";
import { PharmacyVisitPurpose } from "../types/domain";
import { Target, Plus, X, Layers } from "lucide-react";

export interface VisitPurposeSelectorProps {
  // Legacy single selection
  selectedPurpose?: PharmacyVisitPurpose;
  onSelectPurpose?: (purpose: PharmacyVisitPurpose) => void;

  // New primary + additional selection
  primaryPurposeCode?: string;
  additionalPurposeCodes?: string[];
  onChangePrimaryPurpose?: (code: string) => void;
  onChangeAdditionalPurposes?: (codes: string[]) => void;

  lang: "en" | "ar";
}

export const VisitPurposeSelector: React.FC<VisitPurposeSelectorProps> = ({
  selectedPurpose,
  onSelectPurpose,
  primaryPurposeCode,
  additionalPurposeCodes = [],
  onChangePrimaryPurpose,
  onChangeAdditionalPurposes,
  lang
}) => {
  const isRtl = lang === "ar";

  // Resolve current primary code
  const currentPrimaryCode = primaryPurposeCode || selectedPurpose?.code || "";

  // Handle setting primary purpose
  const handlePrimaryChange = (code: string) => {
    if (onChangePrimaryPurpose) {
      onChangePrimaryPurpose(code);
    }
    const found = CANONICAL_VISIT_PURPOSES.find((p) => p.code === code);
    if (found && onSelectPurpose) {
      onSelectPurpose(found);
    }
    // Remove from additional purposes if previously added
    if (additionalPurposeCodes.includes(code) && onChangeAdditionalPurposes) {
      onChangeAdditionalPurposes(additionalPurposeCodes.filter((c) => c !== code));
    }
  };

  // Handle adding an additional purpose
  const handleAddAdditional = (code: string) => {
    if (!code || code === currentPrimaryCode || additionalPurposeCodes.includes(code)) return;
    if (onChangeAdditionalPurposes) {
      onChangeAdditionalPurposes([...additionalPurposeCodes, code]);
    }
  };

  // Handle removing an additional purpose
  const handleRemoveAdditional = (code: string) => {
    if (onChangeAdditionalPurposes) {
      onChangeAdditionalPurposes(additionalPurposeCodes.filter((c) => c !== code));
    }
  };

  // Filter available additional options (exclude primary and already selected)
  const availableAdditional = CANONICAL_VISIT_PURPOSES.filter(
    (p) => p.code !== currentPrimaryCode && !additionalPurposeCodes.includes(p.code)
  );

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs space-y-4">
      <div>
        <h3 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
          <Target className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
          {isRtl ? "غرض الزيارة (الرئيسي والإضافي)" : "Visit Purpose (Primary & Additional)"}
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          {isRtl
            ? "حدد الغرض الرئيسي الإجباري، مع إمكانية إضافة أهداف ثانوية للزيارة"
            : "Select the mandatory primary objective and optional secondary objectives for this visit"}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 1. Primary Purpose (Mandatory Single-Select Dropdown) */}
        <div className="space-y-1.5">
          <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1">
            <span>{isRtl ? "الهدف الرئيسي للزيارة *" : "Primary Visit Purpose *"}</span>
            <span className="text-xs text-rose-500">*</span>
          </label>

          <select
            value={currentPrimaryCode}
            onChange={(e) => handlePrimaryChange(e.target.value)}
            className="w-full p-2.5 text-xs border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"
          >
            <option value="">
              -- {isRtl ? "اختر الهدف الرئيسي للزيارة" : "Select Primary Visit Purpose"} --
            </option>
            {CANONICAL_VISIT_PURPOSES.map((purpose) => (
              <option key={purpose.code} value={purpose.code}>
                {isRtl ? purpose.labelAr : purpose.labelEn}
              </option>
            ))}
          </select>
        </div>

        {/* 2. Additional Purposes (Optional Multi-Select Dropdown & Chips) */}
        <div className="space-y-1.5">
          <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1">
            <Layers className="w-3.5 h-3.5 text-indigo-500" />
            <span>{isRtl ? "أهداف إضافية للزيارة (اختياري)" : "Additional Visit Purposes (Optional)"}</span>
          </label>

          <select
            value=""
            disabled={!currentPrimaryCode || availableAdditional.length === 0}
            onChange={(e) => handleAddAdditional(e.target.value)}
            className="w-full p-2.5 text-xs border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white disabled:opacity-50"
          >
            <option value="">
              {!currentPrimaryCode
                ? isRtl ? "-- حدد الهدف الرئيسي أولاً --" : "-- Select Primary Purpose First --"
                : availableAdditional.length === 0
                ? isRtl ? "-- تم اختيار جميع الأهداف --" : "-- All Purposes Selected --"
                : isRtl ? "-- إضافة هدف إضافي --" : "-- Add Additional Purpose --"}
            </option>
            {availableAdditional.map((purpose) => (
              <option key={purpose.code} value={purpose.code}>
                + {isRtl ? purpose.labelAr : purpose.labelEn}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Selected Additional Purpose Chips */}
      {additionalPurposeCodes.length > 0 && (
        <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
          <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-2">
            {isRtl ? "الأهداف الإضافية المحددة:" : "Selected Additional Objectives:"}
          </p>
          <div className="flex flex-wrap gap-2">
            {additionalPurposeCodes.map((code) => {
              const purposeObj = CANONICAL_VISIT_PURPOSES.find((p) => p.code === code);
              if (!purposeObj) return null;
              return (
                <span
                  key={code}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-semibold bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-900/50"
                >
                  <span>{isRtl ? purposeObj.labelAr : purposeObj.labelEn}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveAdditional(code)}
                    className="p-0.5 hover:bg-indigo-200 dark:hover:bg-indigo-900 rounded-full transition-colors cursor-pointer"
                  >
                    <X size={12} />
                  </button>
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
