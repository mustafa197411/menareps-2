import React, { useState, useMemo } from "react";
import { getVisitBusinessNumber } from "../../utils/visitNumberUtils";
import { 
  Calendar, 
  Search, 
  Filter, 
  CheckCircle2, 
  DollarSign, 
  TrendingUp, 
  Clock, 
  UserCheck, 
  ArrowLeft,
  FileText,
  AlertCircle,
  Building,
  Sparkles,
  ClipboardList
} from "lucide-react";
import { PharmacyVisit as PharmacyVisitType } from "../../types";
import { formatCurrencyForIdentity } from "../../lib/marketSettings";
import { assertSingleCurrency, resolveFinancialIdentity } from "../../lib/financialIdentity";

interface PharmacyVisitHistoryProps {
  lang: "en" | "ar";
  onNavigate?: (target: string) => void;
  pharmacyVisits?: PharmacyVisitType[];
}

export default function PharmacyVisitHistory({ lang, onNavigate, pharmacyVisits }: PharmacyVisitHistoryProps) {
  const isRtl = lang === "ar";

  const visits = useMemo(() => {
    const liveVisitsMapped = (pharmacyVisits || []).map((v: any, idx: number) => {
      const billed = v.orderTotal ?? v.netAmount ?? 0;
      const collected = v.collectedAmount ?? v.paymentCollected ?? 0;
      const visitDateStr = v.visitDate || v.date || (v.createdAt ? v.createdAt.substring(0, 10) : new Date().toISOString().substring(0, 10));
      const remarks = v.finalRemarks || v.intelNotes || "Standard field visit and detailing support.";
      const purposeName = v.visitPurpose || "Order Intake";
      const displayNo = getVisitBusinessNumber(v, idx, "PV");

      const identity = resolveFinancialIdentity([v]);
      return {
        id: v.id,
        displayNumber: displayNo,
        pharmacyId: v.pharmacyId,
        pharmacyName: v.pharmacyName || v.pharmacySnapshot?.nameEn || v.pharmacyId,
        pharmacyNameAr: v.pharmacySnapshot?.nameAr || v.pharmacyName || v.pharmacyId,
        repName: v.repName || v.createdBy || "Sales Rep",
        date: visitDateStr,
        time: "Live Sync",
        type: purposeName,
        typeAr: purposeName === "Order Intake" ? "طلبية ومبيعات" : purposeName === "Collection" ? "تحصيل مقبوضات" : purposeName === "Stock Audit" ? "جرد ومطابقة الرف" : "زيارة ميدانية",
        amountBilled: billed,
        amountCollected: collected,
        purpose: remarks,
        purposeAr: remarks,
        currencyCode: identity?.currencyCode || "",
        marketId: identity?.marketId || "",
        outcome: `Completed Visit (${purposeName}).`,
        outcomeAr: `تم توثيق ${purposeName === "Order Intake" ? "طلبية" : "زيارة"}.`
      };
    });
    return liveVisitsMapped;
  }, [pharmacyVisits]);

  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState("All");

  // Calculations for KPI Cards
  const totalVisitsCount = visits.length;
  const summaryCurrency = assertSingleCurrency(visits as Array<{ currencyCode: string }>, visit => visit.currencyCode);
  const totalBilledVal = visits.reduce((sum, v) => sum + v.amountBilled, 0);
  const totalCollectedVal = visits.reduce((sum, v) => sum + v.amountCollected, 0);

  // Filter lists
  const filteredVisits = visits.filter(visit => {
    const matchesSearch = 
      visit.pharmacyName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (visit.pharmacyNameAr && visit.pharmacyNameAr.includes(searchTerm)) ||
      visit.repName.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesType = filterType === "All" || visit.type === filterType;

    return matchesSearch && matchesType;
  });

  const formatCurrency = (val: number) => {
    const marketId = visits.find(visit => visit.currencyCode === summaryCurrency)?.marketId;
    return marketId ? formatCurrencyForIdentity(val, { marketId }) : (visits.length ? "Configuration required" : "—");
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      {/* Header Back Link */}
      <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <button 
            onClick={() => onNavigate && onNavigate("pharmacies-list")}
            className="p-2 rounded-xl border border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer text-slate-500"
          >
            <ArrowLeft size={16} className={isRtl ? "rotate-180" : ""} />
          </button>
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">
              {isRtl ? "أرشيف زيارات وجرد الصيدليات" : "Pharmacy Visit Historic Ledger"}
            </h2>
            <p className="text-xxs text-slate-400">
              {isRtl ? "سجل تاريخي للتحصيل، الجرد والطلبيات مع تتبع الإيرادات وحساب الذمم المستردة" : "Historic check-in record logging shelf stock velocities, cash collection summaries, and reps comments."}
            </p>
          </div>
        </div>

        <button 
          onClick={() => onNavigate && onNavigate("pharmacies-list")}
          className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
        >
          {isRtl ? "قائمة الصيدليات الكلية" : "Back to Directory"}
        </button>
      </div>

      {/* KPI Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        
        {/* KPI 1 */}
        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-4 rounded-2xl flex items-center gap-4">
          <div className="p-3 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400">
            <ClipboardList size={20} />
          </div>
          <div>
            <span className="text-xxs text-slate-400 block uppercase font-bold tracking-wider">
              {isRtl ? "إجمالي الزيارات" : "Total Logged Visits"}
            </span>
            <span className="text-base font-bold text-slate-800 dark:text-slate-100 font-mono">
              {totalVisitsCount} {isRtl ? "زيارة" : "Visits"}
            </span>
          </div>
        </div>

        {/* KPI 2 */}
        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-4 rounded-2xl flex items-center gap-4">
          <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400">
            <TrendingUp size={20} />
          </div>
          <div>
            <span className="text-xxs text-slate-400 block uppercase font-bold tracking-wider">
              {isRtl ? "إجمالي الطلبيات المسجلة" : "Total Invoiced Volume"}
            </span>
            <span className="text-base font-bold text-blue-600 dark:text-blue-400 font-mono">
              {formatCurrency(totalBilledVal)}
            </span>
          </div>
        </div>

        {/* KPI 3 */}
        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-4 rounded-2xl flex items-center gap-4">
          <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400">
            <DollarSign size={20} />
          </div>
          <div>
            <span className="text-xxs text-slate-400 block uppercase font-bold tracking-wider">
              {isRtl ? "المبالغ المحصلة فعلياً" : "Total Collected Cash"}
            </span>
            <span className="text-base font-bold text-emerald-600 dark:text-emerald-400 font-mono">
              {formatCurrency(totalCollectedVal)}
            </span>
          </div>
        </div>

      </div>

      {/* Filters & Search Toolbar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-4 rounded-2xl flex flex-col md:flex-row gap-3 items-center justify-between">
        <div className="relative w-full md:w-72">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input 
            type="text" 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={isRtl ? "البحث باسم الصيدلية أو المندوب..." : "Search pharmacy or sales rep..."}
            className="w-full text-xs pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-transparent focus:border-indigo-500 bg-transparent"
          />
        </div>

        <div className="flex gap-2 w-full md:w-auto justify-end">
          <select 
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="text-xs p-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-transparent min-w-[150px]"
          >
            <option value="All">{isRtl ? "جميع أنواع التفاعلات" : "All Interaction Types"}</option>
            <option value="Collection & Order">{isRtl ? "تحصيل وطلبيات" : "Collection & Order"}</option>
            <option value="Shelf Stock Audit">{isRtl ? "جرد ومطابقة الرف" : "Shelf Stock Audit"}</option>
            <option value="Regular Detailing & Order">{isRtl ? "زيارة ترويجية" : "Regular Detailing"}</option>
            <option value="Collection">{isRtl ? "تحصيل الديون" : "Collection"}</option>
          </select>
        </div>
      </div>

      {/* Visits Cards Feed */}
      <div className="space-y-4">
        {filteredVisits.length === 0 ? (
          <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-12 text-center rounded-2xl">
            <AlertCircle className="mx-auto h-8 w-8 text-slate-400 mb-2" />
            <p className="text-xs text-slate-500">
              {isRtl ? "لم يتم العثور على أي زيارات تطابق فلاتر البحث." : "No retail pharmacy interactions found matching criteria."}
            </p>
          </div>
        ) : (
          filteredVisits.map((v) => (
            <div 
              key={v.id}
              className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-5 rounded-2xl shadow-xxs hover:border-indigo-100 dark:hover:border-indigo-950 transition-all space-y-4"
            >
              <div className="flex justify-between items-start">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xxs px-2 py-0.5 rounded-full font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-mono">
                      {v.displayNumber || v.id}
                    </span>
                    <span className="text-xxs font-mono text-slate-400">{v.date} • {v.time}</span>
                  </div>
                  <h4 
                    onClick={() => onNavigate && onNavigate("pharmacies-profile")}
                    className="text-sm font-bold text-slate-800 dark:text-white hover:text-indigo-600 hover:underline cursor-pointer"
                  >
                    {isRtl ? v.pharmacyNameAr : v.pharmacyName}
                  </h4>
                  <p className="text-xxs text-slate-400">
                    {isRtl ? `بواسطة المندوب: ${v.repName}` : `Conducted by Rep: ${v.repName}`}
                  </p>
                </div>

                <div className="text-right space-y-1">
                  <span className="inline-block text-xxs px-2.5 py-1 rounded-full font-bold bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400">
                    {isRtl ? v.typeAr : v.type}
                  </span>
                  
                  {/* Ledger mini-badges */}
                  <div className="flex gap-2 justify-end text-[10px] font-mono">
                    {v.amountBilled > 0 && (
                      <span className="text-blue-600 dark:text-blue-400 font-bold bg-blue-50 dark:bg-blue-950/20 px-1.5 py-0.5 rounded">
                        {isRtl ? `فوترة: ${formatCurrency(v.amountBilled)}` : `Billed: ${formatCurrency(v.amountBilled)}`}
                      </span>
                    )}
                    {v.amountCollected > 0 && (
                      <span className="text-emerald-600 dark:text-emerald-400 font-bold bg-emerald-50 dark:bg-emerald-950/20 px-1.5 py-0.5 rounded">
                        {isRtl ? `تحصيل: ${formatCurrency(v.amountCollected)}` : `Collected: ${formatCurrency(v.amountCollected)}`}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Detailed Descriptions */}
              <div className="pt-3 border-t border-slate-50 dark:border-slate-800/50 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div className="space-y-1 bg-slate-50/50 dark:bg-slate-800/20 p-3 rounded-xl">
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">{isRtl ? "ملاحظات الزيارة والغرض" : "Visit Purpose & Notes"}</span>
                  <p className="text-slate-700 dark:text-slate-300 leading-relaxed font-sans">
                    {isRtl ? v.purposeAr : v.purpose}
                  </p>
                </div>

                <div className="space-y-1 bg-slate-50/50 dark:bg-slate-800/20 p-3 rounded-xl">
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">{isRtl ? "النتائج والإجراءات المسجلة" : "Outcomes & Completed Tasks"}</span>
                  <p className="text-emerald-600 dark:text-emerald-400 font-semibold leading-relaxed">
                    {isRtl ? v.outcomeAr : v.outcome}
                  </p>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
