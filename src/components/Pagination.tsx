import React from "react";
import { 
  ChevronLeft, 
  ChevronRight, 
  ChevronsLeft, 
  ChevronsRight 
} from "lucide-react";
import { motion } from "motion/react";

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  itemsPerPage: number;
  onPageChange: (page: number) => void;
  onItemsPerPageChange?: (items: number) => void;
  lang: "en" | "ar";
  itemNameEn?: string;
  itemNameAr?: string;
}

export default function Pagination({
  currentPage,
  totalPages,
  totalItems,
  itemsPerPage,
  onPageChange,
  onItemsPerPageChange,
  lang,
  itemNameEn = "items",
  itemNameAr = "عنصر"
}: PaginationProps) {
  const isRtl = lang === "ar";

  const getPageNumbers = () => {
    const total = totalPages;
    const current = currentPage;
    
    if (total <= 5) {
      return Array.from({ length: total }, (_, i) => i + 1);
    }

    const pages: (number | string)[] = [];
    
    if (current <= 3) {
      pages.push(1, 2, 3, 4, "...", total);
    } else if (current >= total - 2) {
      pages.push(1, "...", total - 3, total - 2, total - 1, total);
    } else {
      pages.push(1, "...", current - 1, current, current + 1, "...", total);
    }
    
    return pages;
  };

  const startIdx = (currentPage - 1) * itemsPerPage + 1;
  const endIdx = Math.min(currentPage * itemsPerPage, totalItems);

  const pages = getPageNumbers();

  return (
    <div 
      className="flex flex-col md:flex-row items-center justify-between gap-4 py-4 px-5 bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-800 rounded-xl shadow-xs" 
      dir={isRtl ? "rtl" : "ltr"}
    >
      {/* Dynamic Summary Info & Page Chunk Size Selector */}
      <div className="flex flex-wrap items-center gap-3.5 text-xs text-slate-500 dark:text-slate-400 font-medium">
        {totalItems > 0 ? (
          isRtl ? (
            <span>
              عرض <strong className="text-slate-800 dark:text-slate-200 font-bold">{startIdx}-{endIdx}</strong> من أصل <strong className="text-slate-800 dark:text-slate-200 font-bold">{totalItems}</strong> {itemNameAr}
            </span>
          ) : (
            <span>
              Showing <strong className="text-slate-800 dark:text-slate-200 font-bold">{startIdx}–{endIdx}</strong> of <strong className="text-slate-800 dark:text-slate-200 font-bold">{totalItems}</strong> {itemNameEn}
            </span>
          )
        ) : (
          <span>{isRtl ? "لا توجد عناصر لعرضها" : "No items to display"}</span>
        )}

        {/* Dynamic Page Size Selector */}
        {onItemsPerPageChange && totalItems > 5 && (
          <div className="flex items-center gap-2 border-l border-slate-100 dark:border-slate-800 pl-3.5 rtl:border-l-0 rtl:border-r rtl:pl-0 rtl:pr-3.5">
            <span className="text-[11px] text-slate-400">
              {isRtl ? "العناصر لكل صفحة:" : "Show:"}
            </span>
            <select
              value={itemsPerPage}
              onChange={(e) => onItemsPerPageChange(Number(e.target.value))}
              className="px-2 py-1 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md text-[11px] font-semibold text-slate-700 dark:text-slate-300 focus:outline-none focus:border-blue-500 transition-colors cursor-pointer"
            >
              <option value={5}>5</option>
              <option value={10}>10</option>
              <option value={15}>15</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
            </select>
          </div>
        )}
      </div>

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          {/* First Page Button */}
          <button
            onClick={() => onPageChange(1)}
            disabled={currentPage === 1}
            className="p-1.5 rounded-md border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-35 disabled:cursor-not-allowed transition-all"
            title={isRtl ? "الصفحة الأولى" : "First Page"}
          >
            {isRtl ? <ChevronsRight size={14} /> : <ChevronsLeft size={14} />}
          </button>

          {/* Previous Page Button */}
          <button
            onClick={() => onPageChange(Math.max(currentPage - 1, 1))}
            disabled={currentPage === 1}
            className="p-1.5 rounded-md border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-35 disabled:cursor-not-allowed transition-all"
            title={isRtl ? "الصفحة السابقة" : "Previous Page"}
          >
            {isRtl ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>

          {/* Page Numbers */}
          <div className="flex items-center gap-1">
            {pages.map((p, idx) => {
              if (p === "...") {
                return (
                  <span 
                    key={`ellipsis-${idx}`} 
                    className="w-7 h-7 flex items-center justify-center text-xs text-slate-400 font-bold"
                  >
                    ...
                  </span>
                );
              }

              const isPageActive = currentPage === p;

              return (
                <button
                  key={`page-${p}`}
                  onClick={() => onPageChange(Number(p))}
                  className={`relative w-7 h-7 rounded-md text-[11px] font-bold transition-all ${
                    isPageActive
                      ? "text-white font-extrabold z-10"
                      : "border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
                  }`}
                >
                  {isPageActive && (
                    <motion.div
                      layoutId="active-page-glow"
                      className="absolute inset-0 bg-blue-600 rounded-md -z-10 shadow-md shadow-blue-500/10"
                      transition={{ type: "spring", stiffness: 380, damping: 30 }}
                    />
                  )}
                  {p}
                </button>
              );
            })}
          </div>

          {/* Next Page Button */}
          <button
            onClick={() => onPageChange(Math.min(currentPage + 1, totalPages))}
            disabled={currentPage === totalPages}
            className="p-1.5 rounded-md border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-35 disabled:cursor-not-allowed transition-all"
            title={isRtl ? "الصفحة التالية" : "Next Page"}
          >
            {isRtl ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
          </button>

          {/* Last Page Button */}
          <button
            onClick={() => onPageChange(totalPages)}
            disabled={currentPage === totalPages}
            className="p-1.5 rounded-md border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-35 disabled:cursor-not-allowed transition-all"
            title={isRtl ? "الصفحة الأخيرة" : "Last Page"}
          >
            {isRtl ? <ChevronsLeft size={14} /> : <ChevronsRight size={14} />}
          </button>
        </div>
      )}
    </div>
  );
}
