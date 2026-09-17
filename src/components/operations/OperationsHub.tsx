import React from "react";
import { AlertCircle } from "lucide-react";

interface OperationsHubProps {
  lang: "en" | "ar";
  initialTab?: "delivery" | "support";
}

/** Legacy fleet/support shell. Order Operations and Delivery remain available
 * through their canonical governed workflow routes; no static records are used. */
export default function OperationsHub({ lang }: OperationsHubProps) {
  const isRtl = lang === "ar";
  return (
    <div className="p-6" dir={isRtl ? "rtl" : "ltr"} data-testid="operations-canonical-source-required">
      <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        <AlertCircle size={18} className="mt-0.5 shrink-0" />
        <div>
          <strong className="block">{isRtl ? "لا توجد بيانات تشغيلية افتراضية" : "No default operational data"}</strong>
          <span>{isRtl ? "يجب ربط خدمة أسطول أو دعم معتمدة قبل عرض السجلات." : "A governed fleet or support service must be configured before records are displayed."}</span>
        </div>
      </div>
    </div>
  );
}
