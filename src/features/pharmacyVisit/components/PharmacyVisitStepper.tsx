import React from "react";
import { PharmacyVisitStep } from "../types/domain";
import { Store, ShoppingBag, Tag, CreditCard, ClipboardList, CheckCircle } from "lucide-react";

interface PharmacyVisitStepperProps {
  currentStep: PharmacyVisitStep;
  completedSteps: PharmacyVisitStep[];
  onSelectStep?: (step: PharmacyVisitStep) => void;
  lang: "en" | "ar";
}

const STEPS_CONFIG = [
  { step: 1 as PharmacyVisitStep, labelEn: "Select & GPS", labelAr: "الصيدلية والموقع", icon: Store },
  { step: 2 as PharmacyVisitStep, labelEn: "Order Items", labelAr: "طلبات الأصناف", icon: ShoppingBag },
  { step: 3 as PharmacyVisitStep, labelEn: "Apply Offers", labelAr: "تطبيق العروض", icon: Tag },
  { step: 4 as PharmacyVisitStep, labelEn: "Payment & AR", labelAr: "الدفع والمستحقات", icon: CreditCard },
  { step: 5 as PharmacyVisitStep, labelEn: "Stock & Notes", labelAr: "المخزون والملاحظات", icon: ClipboardList },
  { step: 6 as PharmacyVisitStep, labelEn: "Review & Save", labelAr: "المراجعة والحفظ", icon: CheckCircle }
];

export const PharmacyVisitStepper: React.FC<PharmacyVisitStepperProps> = ({
  currentStep,
  completedSteps,
  onSelectStep,
  lang
}) => {
  const isRtl = lang === "ar";

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-xs overflow-x-auto">
      <div className="flex items-center justify-between min-w-[640px] gap-2">
        {STEPS_CONFIG.map(({ step, labelEn, labelAr, icon: Icon }, idx) => {
          const isActive = currentStep === step;
          const isCompleted = completedSteps.includes(step);
          const isFuture = step > currentStep && !isCompleted;

          return (
            <React.Fragment key={step}>
              <div
                onClick={() => {
                  if (isCompleted && onSelectStep) {
                    onSelectStep(step);
                  }
                }}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-xl transition-all ${
                  isCompleted ? "cursor-pointer" : "cursor-default"
                } ${
                  isActive
                    ? "bg-indigo-600 text-white font-semibold shadow-xs"
                    : isCompleted
                    ? "bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 font-medium"
                    : "bg-slate-50 dark:bg-slate-800/40 text-slate-400 dark:text-slate-500"
                }`}
              >
                <div
                  className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold ${
                    isActive
                      ? "bg-white/20 text-white"
                      : isCompleted
                      ? "bg-indigo-600 text-white"
                      : "bg-slate-200 dark:bg-slate-700 text-slate-500"
                  }`}
                >
                  {isCompleted ? <CheckCircle className="w-3.5 h-3.5" /> : step}
                </div>

                <div className="text-xs whitespace-nowrap">
                  <p>{isRtl ? labelAr : labelEn}</p>
                </div>
              </div>

              {idx < STEPS_CONFIG.length - 1 && (
                <div
                  className={`h-0.5 flex-1 min-w-[12px] rounded ${
                    isCompleted
                      ? "bg-indigo-600 dark:bg-indigo-500"
                      : "bg-slate-200 dark:bg-slate-800"
                  }`}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};
