import React, { useState, useMemo } from "react";
import { getVisitBusinessNumber } from "../../utils/visitNumberUtils";
import { 
  Search, 
  Filter, 
  Calendar, 
  CheckCircle, 
  Award, 
  ChevronLeft, 
  ChevronRight,
  User,
  Stethoscope,
  Download,
  Clock,
  ThumbsUp,
  ArrowUpRight
} from "lucide-react";
import { PhysicianVisit } from "../../types";

interface PhysicianVisitHistoryProps {
  lang: "en" | "ar";
  onNavigate?: (target: string) => void;
  physicianVisits?: PhysicianVisit[];
  onViewVisitSummary?: (visit: PhysicianVisit) => void;
}

export default function PhysicianVisitHistory({ lang, onNavigate, physicianVisits = [], onViewVisitSummary }: PhysicianVisitHistoryProps) {
  const isRtl = lang === "ar";

  const activeVisitsList = physicianVisits;

  // Search and filter states
  const [searchTerm, setSearchTerm] = useState("");
  const [purposeFilter, setPurposeFilter] = useState("All");
  const [classFilter, setClassFilter] = useState("All");

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const filteredVisits = useMemo(() => {
    return activeVisitsList.filter((v) => {
      const docName = v.physicianName || "";
      const repName = v.repName || "";
      const id = v.id || "";
      const matchesSearch = docName.toLowerCase().includes(searchTerm.toLowerCase()) || 
                            repName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                            id.toLowerCase().includes(searchTerm.toLowerCase());
      
      return matchesSearch;
    });
  }, [activeVisitsList, searchTerm]);

  // Reset page when filtering
  React.useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, purposeFilter, classFilter]);

  // Paginated calculations
  const totalPages = Math.ceil(filteredVisits.length / itemsPerPage) || 1;
  const paginatedVisits = filteredVisits.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );
  const startIdx = filteredVisits.length > 0 ? (currentPage - 1) * itemsPerPage + 1 : 0;
  const endIdx = Math.min(currentPage * itemsPerPage, filteredVisits.length);

  return (
    <div className="p-6 space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      
      {/* Header and Title */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">
            {isRtl ? "أرشيف تاريخ زيارات الأطباء" : "Physician Visit Historic Ledger"}
          </h2>
          <p className="text-xxs text-slate-400">
            {isRtl ? "سجلات تفاصيل الترويج الطبي، العينات الطبية الموزعة، والتقييمات النوعية السابقة" : "Historic detailing logs, sample drops, and verified medical representative feedback scores."}
          </p>
        </div>

        <button 
          onClick={() => {
            const headers = ["ID", "Doctor Name", "Representative", "Date", "Duration", "Samples Disbursed", "Score"];
            const rows = filteredVisits.map((v, idx) => [
              getVisitBusinessNumber(v, idx, "MV"), 
              v.physicianName, 
              v.repName, 
              v.visitDate, 
              `${Math.floor(v.durationSeconds / 60)}m`, 
              v.samples?.map(s => `${s.quantity}x ${s.productName}`).join("; ") || "None", 
              `${v.prescriptionIntent}/10`
            ]);
            const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
            const encodedUri = encodeURI(csvContent);
            const link = document.createElement("a");
            link.setAttribute("href", encodedUri);
            link.setAttribute("download", `physician_visits_ledger_${new Date().toISOString().substring(0, 10)}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
          }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer text-xs font-semibold shadow-xxs"
        >
          <Download size={14} />
          <span>{isRtl ? "تصدير البيانات" : "Export CSV"}</span>
        </button>
      </div>

      {/* Filters Bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl p-4 shadow-xxs max-w-md">
        
        {/* Search Input */}
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input 
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={isRtl ? "البحث عن طبيب أو مندوب..." : "Search doctor, rep, ID..."}
            className="w-full text-xs pl-9 pr-4 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-transparent focus:ring-1 focus:ring-indigo-500"
          />
        </div>
      </div>

      {/* Roster / Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl shadow-xxs overflow-hidden">
        {filteredVisits.length === 0 ? (
          <div className="p-8 text-center space-y-2">
            <Calendar className="h-8 w-8 text-slate-300 mx-auto" />
            <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200">
              {isRtl ? "لا توجد زيارات ترويجية مطابقة" : "No matching detailing visits"}
            </h3>
            <p className="text-xxs text-slate-400">
              {isRtl ? "حاول تغيير كلمات البحث أو معايير التصفية" : "Try revising your search terms."}
            </p>
          </div>
        ) : (
          <>
            {/* Desktop Table View */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-950/40 text-[10px] font-bold text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800 uppercase tracking-wider">
                    <th className="py-3 px-4">{isRtl ? "رمز الزيارة" : "Visit ID"}</th>
                    <th className="py-3 px-4">{isRtl ? "الطبيب" : "Physician Name"}</th>
                    <th className="py-3 px-4">{isRtl ? "المندوب الميداني" : "Representative"}</th>
                    <th className="py-3 px-4">{isRtl ? "التاريخ" : "Date"}</th>
                    <th className="py-3 px-4">{isRtl ? "المنتجات المفصلة" : "Products Detailed"}</th>
                    <th className="py-3 px-4">{isRtl ? "العينات الموزعة" : "Samples Disbursed"}</th>
                    <th className="py-3 px-4 text-center">{isRtl ? "التحقق والملخص" : "Verification & Summary"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-xs">
                  {paginatedVisits.map((v, idx) => (
                    <tr key={v.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/20 font-medium text-slate-800 dark:text-slate-200">
                      <td className="py-4 px-4 font-mono font-bold text-indigo-600 dark:text-indigo-400">
                        {getVisitBusinessNumber(v, (currentPage - 1) * itemsPerPage + idx, "MV")}
                      </td>
                      <td className="py-4 px-4">
                        <div className="space-y-0.5">
                          <span className="font-bold block">{v.physicianName}</span>
                        </div>
                      </td>
                      <td className="py-4 px-4 font-semibold text-slate-700 dark:text-slate-300">
                        <div className="flex items-center gap-1.5">
                          <User size={12} className="text-slate-400" />
                          <span>{v.repName}</span>
                        </div>
                      </td>
                      <td className="py-4 px-4 font-mono text-slate-500">{v.visitDate}</td>
                      <td className="py-4 px-4 font-semibold text-slate-600 dark:text-slate-300">
                        {v.detailing?.map(d => d.brandName || d.productId).join(", ") || "—"}
                      </td>
                      <td className="py-4 px-4 text-slate-500 font-bold text-xxs">
                        {v.samples?.map(s => `${s.quantity}x ${s.productName}`).join(", ") || "None"}
                      </td>
                      <td className="py-4 px-4 text-center">
                        <button
                          onClick={() => onViewVisitSummary && onViewVisitSummary(v)}
                          className="inline-flex items-center gap-1 text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                        >
                          <span>{isRtl ? "عرض التقرير الكامل" : "View Full Report"}</span>
                          <ArrowUpRight size={12} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards View */}
            <div className="block md:hidden space-y-4 p-4">
              {paginatedVisits.map((v, idx) => (
                <div key={v.id} className="bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-800 rounded-xl p-4 shadow-xxs space-y-3">
                  <div className="flex justify-between items-start gap-2">
                    <span className="font-mono text-xs font-bold text-indigo-600 dark:text-indigo-400">
                      {getVisitBusinessNumber(v, (currentPage - 1) * itemsPerPage + idx, "MV")}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">{v.visitDate}</span>
                  </div>

                  <div className="space-y-1">
                    <h4 className="font-bold text-xs text-slate-900 dark:text-white">{v.physicianName}</h4>
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-50 dark:border-slate-800/50 text-[10px]">
                    <div>
                      <span className="text-slate-400 block font-semibold mb-0.5">{isRtl ? "المندوب" : "Representative"}</span>
                      <span className="font-bold text-slate-800 dark:text-slate-300">{v.repName}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block font-semibold mb-0.5">{isRtl ? "المنتجات" : "Products"}</span>
                      <span className="font-bold text-indigo-600 dark:text-indigo-400 truncate block max-w-[120px]">
                        {v.detailing?.map(d => d.brandName || d.productId).join(", ") || "—"}
                      </span>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-50 dark:border-slate-800/50 flex justify-between items-center text-[10px]">
                    <div>
                      <span className="text-slate-400 font-semibold">{isRtl ? "العينات:" : "Samples:"} </span>
                      <span className="font-bold text-slate-700 dark:text-slate-300">
                        {v.samples?.map(s => `${s.quantity}x ${s.productName}`).join(", ") || "None"}
                      </span>
                    </div>
                    <button
                      onClick={() => onViewVisitSummary && onViewVisitSummary(v)}
                      className="inline-flex items-center gap-0.5 text-indigo-600 dark:text-indigo-400 font-bold"
                    >
                      <span>{isRtl ? "التقرير" : "Report"}</span>
                      <ArrowUpRight size={11} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/20 dark:bg-slate-950/20">
                <p className="text-xxs text-slate-400 font-mono">
                  {isRtl 
                    ? `عرض ${startIdx} إلى ${endIdx} من ${filteredVisits.length} زيارات`
                    : `Showing ${startIdx} to ${endIdx} of ${filteredVisits.length} visits`
                  }
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                    disabled={currentPage === 1}
                    className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-500 disabled:opacity-40 transition-opacity hover:bg-slate-50 cursor-pointer text-xs flex items-center gap-1 px-3"
                  >
                    <ChevronLeft size={14} />
                    {isRtl ? "السابق" : "Previous"}
                  </button>
                  <span className="text-xxs font-mono font-bold text-slate-600 dark:text-slate-300">
                    {isRtl 
                      ? `صفحة ${currentPage} من ${totalPages}`
                      : `Page ${currentPage} of ${totalPages}`
                    }
                  </span>
                  <button
                    onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                    disabled={currentPage === totalPages}
                    className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-500 disabled:opacity-40 transition-opacity hover:bg-slate-50 cursor-pointer text-xs flex items-center gap-1 px-3"
                  >
                    {isRtl ? "التالي" : "Next"}
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
