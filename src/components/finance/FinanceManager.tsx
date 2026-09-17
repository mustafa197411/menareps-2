import React from "react";
import { AlertCircle } from "lucide-react";

interface FinanceManagerProps {
  currentUser: unknown;
  lang: "en" | "ar";
  initialTab?: "dashboard" | "receipts" | "settlements" | "approvals" | "credit";
}

/**
 * Compatibility surface for legacy Finance routes. Operational Finance data is
 * intentionally not synthesized here; canonical queues and AR are exposed by
 * Sales Orders and Customer Accounts respectively.
 */
export default function FinanceManager({ lang }: FinanceManagerProps) {
  const isRtl = lang === "ar";
  return (
    <div className="p-6" dir={isRtl ? "rtl" : "ltr"} data-testid="finance-canonical-source-required">
      <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        <AlertCircle size={18} className="mt-0.5 shrink-0" />
        <div>
          <strong className="block">{isRtl ? "لا توجد بيانات تشغيلية افتراضية" : "No default operational Finance data"}</strong>
          <span>{isRtl ? "استخدم حسابات العملاء والذمم أو قائمة مراجعة الطلبات المعتمدة." : "Use canonical Customer Accounts & AR or the governed Order review queue."}</span>
        </div>
      </div>
    </div>
  );
}
