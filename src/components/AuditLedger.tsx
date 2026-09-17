import React, { useState, useEffect } from "react";
import { 
  History, 
  Search, 
  ShieldAlert, 
  Filter, 
  Download, 
  Clock, 
  Database, 
  UserCheck,
  ChevronLeft,
  ChevronRight
} from "lucide-react";
import { User, AuditLog } from "../types";
import { motion } from "motion/react";

interface AuditLedgerProps {
  lang: "en" | "ar";
  auditLogs: AuditLog[];
}

export default function AuditLedger({
  lang,
  auditLogs
}: AuditLedgerProps) {
  const isRtl = lang === "ar";
  const [searchTerm, setSearchTerm] = useState("");
  const [actionFilter, setActionFilter] = useState("all");

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // Reset pagination on filter or search change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, actionFilter]);

  const t = {
    en: {
      title: "Security & Operations Audit Ledger",
      subtitle: "Permanently recorded, immutable trace logs for security compliance audits",
      searchPlaceholder: "Search details, IP addresses, or user names...",
      action: "Action Type",
      entity: "Module Name",
      user: "Rep/Actor",
      details: "Audit Details",
      time: "Event Timestamp",
      all: "All Logs",
      exportBtn: "Export Audit Ledger",
      prev: "Prev",
      next: "Next",
      pageOf: "Page {current} of {total}",
      showing: "Showing {start}-{end} of {total} logs"
    },
    ar: {
      title: "سجل التدقيق الأمني والعملياتي",
      subtitle: "سجلات تتبع غير قابلة للتغيير ومدونة بدقة لامتثال وتدقيق الإدارة العليا",
      searchPlaceholder: "البحث في تفاصيل السجل، الموظفين، أو الحركات...",
      action: "نوع الحركة",
      entity: "الوحدة المتأثرة",
      user: "الممثل / الفاعل",
      details: "تفاصيل العملية",
      time: "طابع الوقت الرقمي",
      all: "جميع الحركات",
      exportBtn: "تصدير سجل حركات التدقيق",
      prev: "السابق",
      next: "التالي",
      pageOf: "الصفحة {current} من {total}",
      showing: "عرض {start}-{end} من أصل {total} سجل"
    }
  }[lang];

  // Simple download as Excel simulated exporter
  const handleExportCSV = () => {
    import("xlsx").then((XLSX) => {
      const headers = ["Timestamp", "User", "Action", "Module", "Details"];
      const data = [headers];
      
      auditLogs.forEach(log => {
        data.push([log.timestamp, log.userName, log.action, log.entityName, log.details]);
      });
      
      const worksheet = XLSX.utils.aoa_to_sheet(data);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Audit Ledger");
      
      XLSX.writeFile(workbook, "menareps_audit_ledger.xlsx");
    });
  };

  // Filter logs
  const filteredLogs = auditLogs.filter(log => {
    const matchSearch = log.userName.toLowerCase().includes(searchTerm.toLowerCase()) || 
                        log.details.toLowerCase().includes(searchTerm.toLowerCase());
    const matchAction = actionFilter === "all" || log.action === actionFilter;
    return matchSearch && matchAction;
  });

  // Pagination calculation
  const totalPages = Math.ceil(filteredLogs.length / itemsPerPage) || 1;
  const paginatedLogs = filteredLogs.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const startIdx = filteredLogs.length > 0 ? (currentPage - 1) * itemsPerPage + 1 : 0;
  const endIdx = Math.min(currentPage * itemsPerPage, filteredLogs.length);

  return (
    <div className="space-y-6" id="audit-ledger-wrapper" dir={isRtl ? "rtl" : "ltr"}>
      
      {/* Header */}
      <div className="border-b border-slate-100 dark:border-slate-800 pb-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4" id="audit-ledger-header">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
            <History className="text-blue-600" />
            {t.title}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {t.subtitle}
          </p>
        </div>

        <button
          onClick={handleExportCSV}
          className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer w-full md:w-auto justify-center"
          id="btn-export-audit"
        >
          <Download size={14} />
          {t.exportBtn}
        </button>
      </div>

      {/* Filters bar */}
      <div className="flex flex-col md:flex-row gap-3" id="audit-filters">
        <div className="relative flex-1" id="search-box">
          <Search className={`absolute ${isRtl ? "right-3" : "left-3"} top-1/2 -translate-y-1/2 text-slate-400`} size={16} />
          <input
            type="text"
            placeholder={t.searchPlaceholder}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className={`w-full ${isRtl ? "pr-10 pl-4" : "pl-10 pr-4"} py-2 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-white dark:bg-slate-900 text-slate-800 dark:text-white`}
          />
        </div>

        <div className="flex gap-2" id="action-filters-radio">
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-white dark:bg-slate-900 text-slate-800 dark:text-white w-full md:w-auto"
          >
            <option value="all">{t.all}</option>
            <option value="Create">Creates (إضافة)</option>
            <option value="Update">Updates (تعديل)</option>
            <option value="Detail">Detailing Call (زيارة علمية)</option>
            <option value="Order">Sales Order (طلبية مبيعات)</option>
          </select>
        </div>
      </div>

      {/* Desktop view: Table (hidden on mobile) */}
      <div className="hidden md:block bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl overflow-hidden shadow-xs" id="audit-logs-desktop-box">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800 text-xxs font-mono uppercase tracking-wider text-slate-400">
              <tr>
                <th className="p-4">{t.time}</th>
                <th className="p-4">{t.user}</th>
                <th className="p-4">{t.action}</th>
                <th className="p-4">{t.entity}</th>
                <th className="p-4">{t.details}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
              {paginatedLogs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-colors">
                  <td className="p-4 font-mono text-xxs text-slate-400 whitespace-nowrap">{log.timestamp}</td>
                  <td className="p-4 font-semibold text-slate-900 dark:text-white">{log.userName}</td>
                  <td className="p-4">
                    <span className={`px-2 py-0.5 rounded text-xxs font-mono font-bold ${
                      log.action === "Create" ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600" :
                      log.action === "Update" ? "bg-amber-50 dark:bg-amber-950/40 text-amber-600" :
                      "bg-blue-50 dark:bg-blue-950/40 text-blue-600"
                    }`}>
                      {log.action}
                    </span>
                  </td>
                  <td className="p-4 text-slate-500 font-mono text-xxs">{log.entityName}</td>
                  <td className="p-4 text-slate-600 dark:text-slate-400 font-medium max-w-sm truncate" title={log.details}>
                    {log.details}
                  </td>
                </tr>
              ))}
              {paginatedLogs.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-slate-400">
                    No logs found matching your criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile view: Cards (hidden on desktop) */}
      <div className="block md:hidden space-y-3" id="audit-logs-mobile-box">
        {paginatedLogs.map((log) => (
          <div 
            key={log.id} 
            className="p-4 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl space-y-2"
          >
            <div className="flex justify-between items-start">
              <div>
                <p className="font-semibold text-xs text-slate-900 dark:text-white">{log.userName}</p>
                <p className="text-[10px] font-mono text-slate-400">{log.timestamp}</p>
              </div>
              <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                log.action === "Create" ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600" :
                log.action === "Update" ? "bg-amber-50 dark:bg-amber-950/40 text-amber-600" :
                "bg-blue-50 dark:bg-blue-950/40 text-blue-600"
              }`}>
                {log.action}
              </span>
            </div>
            
            <div className="text-xxs font-mono text-slate-500 flex items-center gap-1">
              <span className="text-slate-400 font-semibold uppercase">{t.entity}:</span>
              <span>{log.entityName}</span>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-400 font-medium break-words leading-relaxed pt-1 border-t border-slate-50 dark:border-slate-800/60">
              {log.details}
            </p>
          </div>
        ))}
        {paginatedLogs.length === 0 && (
          <p className="p-8 text-center text-slate-400 text-xs bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl">
            No logs found matching your criteria.
          </p>
        )}
      </div>

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2 border-t border-slate-100 dark:border-slate-800" id="audit-pagination">
          <p className="text-xxs text-slate-400 font-mono">
            {t.showing
              .replace("{start}", String(startIdx))
              .replace("{end}", String(endIdx))
              .replace("{total}", String(filteredLogs.length))}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
              disabled={currentPage === 1}
              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-500 disabled:opacity-40 transition-opacity hover:bg-slate-50 cursor-pointer text-xs flex items-center gap-1 px-3"
            >
              <ChevronLeft size={14} />
              {t.prev}
            </button>
            <span className="text-xxs font-mono font-bold text-slate-600 dark:text-slate-300">
              {t.pageOf
                .replace("{current}", String(currentPage))
                .replace("{total}", String(totalPages))}
            </span>
            <button
              onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
              disabled={currentPage === totalPages}
              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-500 disabled:opacity-40 transition-opacity hover:bg-slate-50 cursor-pointer text-xs flex items-center gap-1 px-3"
            >
              {t.next}
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
