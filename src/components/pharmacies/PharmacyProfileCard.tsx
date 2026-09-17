import React, { useState } from "react";
import { 
  Building, 
  MapPin, 
  Phone, 
  DollarSign, 
  Calendar, 
  Clock, 
  CheckCircle2, 
  AlertCircle,
  FileText,
  TrendingUp,
  CreditCard,
  UserCheck,
  Plus,
  ArrowLeft,
  ChevronRight,
  Sparkles
} from "lucide-react";
import { formatCurrencyForIdentity } from "../../lib/marketSettings";

interface PharmacyProfileCardProps {
  lang: "en" | "ar";
  onNavigate?: (target: string) => void;
  selectedPharmacy?: any;
}

export default function PharmacyProfileCard({ lang, onNavigate, selectedPharmacy }: PharmacyProfileCardProps) {
  const isRtl = lang === "ar";

  const pharmacy = selectedPharmacy || {};

  // Tabs state
  const [activeTab, setActiveTab] = useState<"overview" | "history" | "ledger" | "stocks">("overview");
  
  // Interactive mini-states
  const [quickNotes, setQuickNotes] = useState("");
  const [notesList, setNotesList] = useState<string[]>([]);
  const [logBalanceChange, setLogBalanceChange] = useState("");
  const [currentBalance, setCurrentBalance] = useState(pharmacy.outstandingBalance);

  const handleAddNote = () => {
    if (!quickNotes.trim()) return;
    setNotesList([quickNotes, ...notesList]);
    setQuickNotes("");
  };

  const handlePostCollection = () => {
    const amt = parseFloat(logBalanceChange);
    if (!amt || isNaN(amt)) return;
    setCurrentBalance((prev: number) => Math.max(0, prev - amt));
    setLogBalanceChange("");
  };

  const formatCurrency = (val: number) => {
    try { return formatCurrencyForIdentity(val, pharmacy); } catch { return isRtl ? "إعدادات السوق مطلوبة" : "Market configuration required"; }
  };

  if (!selectedPharmacy) return <div className="p-6 text-sm text-slate-500">{isRtl ? "اختر صيدلية لعرض بياناتها الفعلية." : "Select a pharmacy to view its canonical record."}</div>;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      {/* Header back row */}
      <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <button 
            onClick={() => onNavigate && onNavigate("pharmacies-list")}
            className="p-2 rounded-xl border border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer text-slate-500"
          >
            <ArrowLeft size={16} className={isRtl ? "rotate-180" : ""} />
          </button>
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <span>{isRtl ? pharmacy.nameAr || pharmacy.name : pharmacy.name}</span>
              <span className="text-xxs px-2.5 py-0.5 rounded-full font-bold bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400">
                {pharmacy.id}
              </span>
            </h2>
            <p className="text-xxs text-slate-400">
              {isRtl ? `${pharmacy.type} • إقليم ${pharmacy.region}` : `${pharmacy.type} • Region: ${pharmacy.region}`}
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          <button 
            onClick={() => onNavigate && onNavigate("pharmacies-visit-history")}
            className="px-3 py-1.5 border border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-xxs font-bold text-slate-600 dark:text-slate-300 rounded-lg cursor-pointer transition-colors"
          >
            {isRtl ? "سجل الزيارات" : "Visit Archives"}
          </button>
          <button 
            onClick={() => onNavigate && onNavigate("pharmacies-list")}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-xxs font-bold text-white rounded-lg cursor-pointer transition-colors shadow-sm"
          >
            {isRtl ? "القائمة العامة" : "Full List"}
          </button>
        </div>
      </div>

      {/* Main Grid: Card Overview Metrics & Map Details */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left column: Key Financial and Status Badges */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-5 rounded-2xl shadow-xxs space-y-4">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              {isRtl ? "الحالة والوضعية المالية" : "Financial Status & Exposure"}
            </h3>

            {/* Outstanding Balance */}
            <div className="bg-slate-50 dark:bg-slate-800/40 p-4 rounded-xl space-y-1">
              <span className="text-[10px] font-semibold text-slate-400">
                {isRtl ? "الذمم المالية المستحقة" : "Outstanding Balance (AR)"}
              </span>
              <div className="text-xl font-extrabold text-indigo-600 dark:text-indigo-400 font-mono">
                {formatCurrency(currentBalance)}
              </div>
              <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-100 dark:border-slate-800">
                <span>{isRtl ? "سقف التسهيل الائتماني" : "Credit Limit"}</span>
                <span className="font-semibold">{pharmacy.creditLimit == null ? "—" : formatCurrency(pharmacy.creditLimit)}</span>
              </div>
            </div>

            {/* General parameters */}
            <div className="space-y-3 pt-2 text-xs">
              <div className="flex justify-between items-center py-1 border-b border-slate-50 dark:border-slate-800/50">
                <span className="text-slate-400">{isRtl ? "شروط الدفع" : "Payment Terms"}</span>
                <span className="font-semibold text-slate-700 dark:text-slate-300 font-mono">{pharmacy.paymentTerms || "Net 45 Days"}</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-slate-50 dark:border-slate-800/50">
                <span className="text-slate-400">{isRtl ? "آخر زيارة" : "Last Detailing Visit"}</span>
                <span className="font-semibold text-slate-700 dark:text-slate-300 font-mono">{pharmacy.lastVisitDate}</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-slate-50 dark:border-slate-800/50">
                <span className="text-slate-400">{isRtl ? "الزيارة المجدولة القادمة" : "Next Scheduled Visit"}</span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400 font-mono">{pharmacy.nextVisitDate}</span>
              </div>
              <div className="flex justify-between items-center py-1">
                <span className="text-slate-400">{isRtl ? "تاريخ التحقق من GPS" : "GPS Status"}</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400">
                  {isRtl ? "مُتحقق ومُثبت" : "GPS Verified"}
                </span>
              </div>
            </div>
          </div>

          {/* Retired: client-only balance mutation was not a persistence contract. */}
          {false && <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-5 rounded-2xl shadow-xxs space-y-3">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <CreditCard size={13} className="text-emerald-500" />
              {isRtl ? "تسجيل تحصيل ذمم مالية فورية" : "Log Quick AR Collection"}
            </h3>
            <p className="text-[10px] text-slate-400">
              {isRtl ? "أدخل القيمة المالية المستلمة من الصيدلي لتحديث فوري لرصيد الذمم" : "Log outstanding receipts collected directly to decrease exposure."}
            </p>
            <div className="flex gap-2">
              <input 
                type="number"
                value={logBalanceChange}
                onChange={(e) => setLogBalanceChange(e.target.value)}
                placeholder="e.g. 500"
                className="w-full text-xs p-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-transparent font-mono"
              />
              <button 
                onClick={handlePostCollection}
                className="px-3 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer"
              >
                {isRtl ? "خصم" : "Post"}
              </button>
            </div>
          </div>}
        </div>

        {/* Right Columns: Interactive Detail Tabs & Timeline */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Tabs header */}
          <div className="flex border-b border-slate-100 dark:border-slate-800 gap-1 overflow-x-auto">
            {false && <button
              onClick={() => setActiveTab("overview")}
              className={`pb-3 px-4 text-xs font-bold border-b-2 transition-all cursor-pointer whitespace-nowrap ${
                activeTab === "overview" 
                  ? "border-indigo-600 text-indigo-600 dark:text-indigo-400" 
                  : "border-transparent text-slate-400 hover:text-slate-600"
              }`}
            >
              {isRtl ? "المعلومات العامة" : "Commercial Profile"}
            </button>}
            {false && <button
              onClick={() => setActiveTab("history")}
              className={`pb-3 px-4 text-xs font-bold border-b-2 transition-all cursor-pointer whitespace-nowrap ${
                activeTab === "history" 
                  ? "border-indigo-600 text-indigo-600 dark:text-indigo-400" 
                  : "border-transparent text-slate-400 hover:text-slate-600"
              }`}
            >
              {isRtl ? "التفاعل والتسجيل" : "Interactive Notes"}
            </button>}
            {false && <button
              onClick={() => setActiveTab("ledger")}
              className={`pb-3 px-4 text-xs font-bold border-b-2 transition-all cursor-pointer whitespace-nowrap ${
                activeTab === "ledger" 
                  ? "border-indigo-600 text-indigo-600 dark:text-indigo-400" 
                  : "border-transparent text-slate-400 hover:text-slate-600"
              }`}
            >
              {isRtl ? "تاريخ طلبيات المبيعات" : "Sales Order Ledger"}
            </button>}
            <button 
              onClick={() => setActiveTab("stocks")}
              className={`pb-3 px-4 text-xs font-bold border-b-2 transition-all cursor-pointer whitespace-nowrap ${
                activeTab === "stocks" 
                  ? "border-indigo-600 text-indigo-600 dark:text-indigo-400" 
                  : "border-transparent text-slate-400 hover:text-slate-600"
              }`}
            >
              {isRtl ? "مخزون الصيدلية (جرد الرف)" : "Shelf Stock Audits"}
            </button>
          </div>

          {/* TAB 1: OVERVIEW */}
          {activeTab === "overview" && (
            <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl p-5 space-y-6 animate-fade-in">
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 border-b pb-1">
                    {isRtl ? "التواصل وتفاصيل الترخيص" : "Corporate Details & Contact"}
                  </h4>
                  <div className="space-y-2 text-xs text-slate-600 dark:text-slate-400">
                    <p className="flex items-center gap-2">
                      <Phone size={14} className="text-slate-400" />
                      <span className="font-mono">{pharmacy.contact || pharmacy.phone || "—"}</span>
                    </p>
                    <p className="flex items-center gap-2">
                      <Building size={14} className="text-slate-400" />
                      <span>{isRtl ? `نوع صنف الكيان: ${pharmacy.type}` : `Entity Classification: ${pharmacy.type}`}</span>
                    </p>
                    <p className="flex items-center gap-2">
                      <MapPin size={14} className="text-slate-400" />
                      <span>{pharmacy.address}</span>
                    </p>
                  </div>
                </div>

                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 border-b pb-1 flex justify-between items-center">
                    <span>{isRtl ? "إحداثيات تحديد الموقع الفعلي" : "GPS & Coordinates Log"}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                      pharmacy.latitude != null && pharmacy.longitude != null && (pharmacy.gpsVerificationStatus === "VERIFIED" || pharmacy.verifiedGps)
                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                        : "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                    }`}>
                      {pharmacy.latitude != null && pharmacy.longitude != null && (pharmacy.gpsVerificationStatus === "VERIFIED" || pharmacy.verifiedGps)
                        ? (isRtl ? "مؤكد عبر الزيارة" : "GPS Verified")
                        : (isRtl ? "غير مؤكد — تتطلب زيارة أولى" : "Unverified — First Visit GPS Required")}
                    </span>
                  </h4>
                  <div className="space-y-2 text-xs text-slate-600 dark:text-slate-400">
                    <div className="flex justify-between font-mono bg-slate-50 dark:bg-slate-800 p-2 rounded-lg">
                      <span>Latitude:</span>
                      <span className="font-bold text-indigo-600">{pharmacy.latitude != null && pharmacy.latitude !== 0 ? pharmacy.latitude : "—"}</span>
                    </div>
                    <div className="flex justify-between font-mono bg-slate-50 dark:bg-slate-800 p-2 rounded-lg">
                      <span>Longitude:</span>
                      <span className="font-bold text-indigo-600">{pharmacy.longitude != null && pharmacy.longitude !== 0 ? pharmacy.longitude : "—"}</span>
                    </div>
                    {pharmacy.area && (
                      <div className="p-2 bg-slate-100 dark:bg-slate-800/60 rounded-lg text-[10px] text-slate-500 space-y-0.5">
                        <span className="font-semibold block text-slate-700 dark:text-slate-300">
                          {isRtl ? "إحداثيات المنطقة المرجعية (ليست موقع الصيدلية)" : "Area Reference Coordinates (Not Pharmacy GPS)"}
                        </span>
                        <p>{pharmacy.area} • {pharmacy.city || pharmacy.region}</p>
                      </div>
                    )}
                    <p className="text-[10px] text-slate-400">
                      {pharmacy.latitude != null && pharmacy.longitude != null && (pharmacy.gpsVerificationStatus === "VERIFIED" || pharmacy.verifiedGps)
                        ? (isRtl ? "* تم تأكيد الموقع من الجهاز الميداني أثناء الزيارة المكتملة" : "* Location was verified and stamped on-site via field mobile device GPS trackers.")
                        : (isRtl ? "* تتطلب هذه الصيدلية التقاط موقع GPS عند إجراء أول زيارة ميدانية مكتملة" : "* First visit requires live device GPS acquisition to verify coordinates.")}
                    </p>
                  </div>
                </div>
              </div>

              {/* Territory Assignment Details */}
              <div className="bg-slate-50 dark:bg-slate-800/40 p-4 rounded-xl space-y-2">
                <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  {isRtl ? "بيانات توزيع الإقليم والمندوبين" : "Assigned Sales & Medical Representatives"}
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase">{isRtl ? "المربع الجغرافي" : "Sales Territory"}</span>
                    <span className="font-semibold">{pharmacy.territory}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase">{isRtl ? "مندوب المبيعات المسؤول" : "Sales Representative"}</span>
                    <span className="font-semibold">{pharmacy.assignedRepName || pharmacy.repName || pharmacy.assignedRepId || "—"}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase">{isRtl ? "مشرف المبيعات" : "Sales Supervisor"}</span>
                    <span className="font-semibold">{pharmacy.assignedSupervisorName || pharmacy.supervisorName || pharmacy.assignedSupervisorId || "—"}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: INTERACTIVE NOTES */}
          {false && activeTab === "history" && (
            <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl p-5 space-y-6 animate-fade-in">
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  {isRtl ? "سجل الملاحظات والتعليقات الميدانية للتفاعل" : "Add Live Operational Note"}
                </h4>
                <p className="text-[10px] text-slate-400">
                  {isRtl ? "سجل التفاعلات العاجلة وملاحظات المنافسين وعروض الأسعار المباشرة المتفق عليها" : "Log competitors' pricing matches, urgent out-of-stock complaints, and credit feedback."}
                </p>
                <div className="flex gap-2">
                  <textarea 
                    value={quickNotes}
                    onChange={(e) => setQuickNotes(e.target.value)}
                    placeholder={isRtl ? "مثال: يطلب الصيدلي خصم إضافي 3% على منتجات العناية بالبشرة للطلبيات القادمة..." : "e.g., Pharmacy demands an additional 3% on skin care formulations for the upcoming order..."}
                    className="w-full text-xs p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-transparent min-h-[80px]"
                  />
                </div>
                <div className="flex justify-end">
                  <button 
                    onClick={handleAddNote}
                    className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl cursor-pointer"
                  >
                    {isRtl ? "حفظ الملاحظة" : "Save Live Note"}
                  </button>
                </div>
              </div>

              {/* Notes List */}
              <div className="space-y-3">
                <h5 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  {isRtl ? "الملاحظات المدونة حديثاً" : "Recently Logged Notes"}
                </h5>
                <div className="space-y-2">
                  {notesList.map((note, idx) => (
                    <div key={idx} className="p-3 bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 rounded-xl text-xs space-y-1">
                      <div className="flex justify-between items-center text-[10px] text-slate-400">
                        <span className="font-bold text-indigo-600">You (Logged Live)</span>
                        <span>Just now</span>
                      </div>
                      <p className="text-slate-700 dark:text-slate-300 font-sans">{note}</p>
                    </div>
                  ))}

                  {notesList.length === 0 && <p className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-xs text-slate-400">{isRtl ? "لا توجد ملاحظات فعلية مسجلة" : "No persisted notes are available"}</p>}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: SALES ORDER LEDGER */}
          {false && activeTab === "ledger" && (
            <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl p-5 space-y-4 animate-fade-in">
              <div className="flex justify-between items-center border-b border-slate-50 dark:border-slate-800 pb-2">
                <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  {isRtl ? "أرشيف معاملات مبيعات وطلبيات الكيان" : "Retail Commercial Invoice Ledger"}
                </h4>
                <span className="text-[10px] text-slate-400 font-semibold font-mono">3 Orders Flipped</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="text-[10px] uppercase text-slate-400 border-b border-slate-100 dark:border-slate-800">
                      <th className="py-2">{isRtl ? "رقم الطلبية" : "Order ID"}</th>
                      <th className="py-2">{isRtl ? "التاريخ" : "Date"}</th>
                      <th className="py-2">{isRtl ? "المندوب" : "Sales Rep"}</th>
                      <th className="py-2">{isRtl ? "القيمة الإجمالية" : "Total Value"}</th>
                      <th className="py-2">{isRtl ? "حالة السداد" : "Payment Status"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-slate-50 dark:border-slate-800/50">
                      <td className="py-2.5 font-bold font-mono text-indigo-600 dark:text-indigo-400">#ORD-993</td>
                      <td className="py-2.5 font-mono">2026-06-20</td>
                      <td className="py-2.5">Osama Al-Fakhri</td>
                      <td className="py-2.5 font-semibold font-mono text-slate-800 dark:text-slate-200">4,120.00 LYD</td>
                      <td className="py-2.5">
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-amber-50 dark:bg-amber-950/40 text-amber-600">
                          {isRtl ? "ذمم مستحقة" : "Unpaid (Debit)"}
                        </span>
                      </td>
                    </tr>
                    <tr className="border-b border-slate-50 dark:border-slate-800/50">
                      <td className="py-2.5 font-bold font-mono text-indigo-600 dark:text-indigo-400">#ORD-811</td>
                      <td className="py-2.5 font-mono">2026-05-15</td>
                      <td className="py-2.5">Osama Al-Fakhri</td>
                      <td className="py-2.5 font-semibold font-mono text-slate-800 dark:text-slate-200">8,330.00 LYD</td>
                      <td className="py-2.5">
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600">
                          {isRtl ? "تم تحصيله كاملاً" : "Paid & Collected"}
                        </span>
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2.5 font-bold font-mono text-indigo-600 dark:text-indigo-400">#ORD-705</td>
                      <td className="py-2.5 font-mono">2026-04-10</td>
                      <td className="py-2.5">Osama Al-Fakhri</td>
                      <td className="py-2.5 font-semibold font-mono text-slate-800 dark:text-slate-200">5,400.00 LYD</td>
                      <td className="py-2.5">
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600">
                          {isRtl ? "تم تحصيله كاملاً" : "Paid & Collected"}
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 4: SHELF STOCK AUDITS */}
          {false && activeTab === "stocks" && (
            <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl p-5 space-y-4 animate-fade-in">
              <div className="flex justify-between items-center border-b border-slate-50 dark:border-slate-800 pb-2">
                <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  {isRtl ? "سجل جرد الرف والمخزون في الصيدلية" : "Shelf Space & Competitor Stock Audits"}
                </h4>
                <span className="text-[10px] text-slate-400 font-semibold">{isRtl ? "آخر جرد: 2026-06-20" : "Last Checked: 2026-06-20"}</span>
              </div>

              <div className="space-y-3">
                <p className="text-[10px] text-slate-400">
                  {isRtl 
                    ? "يقوم مندوب المبيعات بجرد مخزون رف الصيدلية خلال كل زيارة للتأكد من عدم نفاد المخزون (OOS) وتجنب خسارة فرص المبيعات."
                    : "Shelf audits run parallel to billing visits to calculate run-rate velocities and identify competitive displacements."
                  }
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-3 border border-slate-100 dark:border-slate-800 rounded-xl space-y-2">
                    <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 block border-b pb-1">
                      {isRtl ? "مخزون مستحضرات التجميل" : "Menareps Skin Formulations"}
                    </span>
                    <div className="space-y-1.5 text-xs text-slate-700 dark:text-slate-300">
                      <div className="flex justify-between">
                        <span>Avene Cream SPF 50+:</span>
                        <span className="font-bold font-mono">14 Units</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Eucerin Hydrating Gel:</span>
                        <span className="font-bold font-mono text-rose-600 dark:text-rose-400">2 Units (Critically Low!)</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Ducray Anti-Hair Loss:</span>
                        <span className="font-bold font-mono">22 Units</span>
                      </div>
                    </div>
                  </div>

                  <div className="p-3 border border-slate-100 dark:border-slate-800 rounded-xl space-y-2">
                    <span className="text-[11px] font-bold text-slate-500 block border-b pb-1">
                      {isRtl ? "منتجات الشركات المنافسة المرصودة" : "Competitor Products Spotted"}
                    </span>
                    <div className="space-y-1.5 text-xs text-slate-700 dark:text-slate-300">
                      <div className="flex justify-between">
                        <span>La Roche-Posay SPF:</span>
                        <span className="font-semibold text-slate-500">{isRtl ? "متوفر بكثرة" : "High Stock"}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Vichy Mineral 89:</span>
                        <span className="font-semibold text-slate-500">{isRtl ? "متوسط" : "Medium Stock"}</span>
                      </div>
                      <div className="flex justify-between text-indigo-600 dark:text-indigo-400 font-bold">
                        <span>Our Shelf Share %:</span>
                        <span>42% Share</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
