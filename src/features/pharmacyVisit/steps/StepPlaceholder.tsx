import React from "react";
import { PharmacyVisitStep } from "../types/domain";
import { Construction, ArrowLeft, ArrowRight } from "lucide-react";

interface StepPlaceholderProps {
  step: PharmacyVisitStep;
  onBack: () => void;
  lang: "en" | "ar";
}

const STEP_TITLES: Record<PharmacyVisitStep, { en: string; ar: string }> = {
  1: { en: "Select Pharmacy & GPS Check-In", ar: "اختيار الصيدلية والتسجيل الجغرافي" },
  2: { en: "Order Items & AI Quick Add", ar: "طلب الأصناف والإضافة الذكية" },
  3: { en: "Apply Offers & Promotions", ar: "تطبيق العروض والخصومات" },
  4: { en: "Payment & Accounts Receivable", ar: "الدفع وتحصيل المستحقات" },
  5: { en: "Stock Requests & Field Notes", ar: "طلبات المخزون والملاحظات الميدانية" },
  6: { en: "Review & Save Pharmacy Visit", ar: "مراجعة وتأكيد حفظ الزيارة" }
};

export const StepPlaceholder: React.FC<StepPlaceholderProps> = ({ step, onBack, lang }) => {
  const isRtl = lang === "ar";
  const title = STEP_TITLES[step] || { en: `Step ${step}`, ar: `الخطوة ${step}` };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-8 shadow-xs text-center space-y-4 my-4">
      <div className="w-12 h-12 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 rounded-2xl flex items-center justify-center mx-auto text-amber-600 dark:text-amber-400">
        <Construction className="w-6 h-6" />
      </div>

      <div className="max-w-md mx-auto space-y-1">
        <h3 className="text-base font-bold text-slate-900 dark:text-white">
          {isRtl ? title.ar : title.en}
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {isRtl
            ? `الخطوة رقم ${step} مخصصة للحزم القادمة (WP6.1E-WP6.1H) وفقاً لخطة MENAREPS 2.0. لا توجد معاملات تجارية وهمية.`
            : `Step ${step} boundary defined. Scheduled for implementation in subsequent work packages (WP6.1E–WP6.1H). Zero commercial writes generated.`}
        </p>
      </div>

      <div className="pt-4 flex justify-center">
        <button
          type="button"
          onClick={onBack}
          className="px-4 py-2 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-medium flex items-center gap-2 transition-all"
        >
          {isRtl ? <ArrowRight className="w-3.5 h-3.5" /> : <ArrowLeft className="w-3.5 h-3.5" />}
          {isRtl ? "العودة للخطوة الأولى (الموقع والغرض)" : "Return to Step 1 (Pharmacy & GPS)"}
        </button>
      </div>
    </div>
  );
};
