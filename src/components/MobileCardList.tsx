import React, { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight, Database } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import NoDataState from "./NoDataState";

interface MobileCardListProps<T> {
  /** The full dataset to display and paginate */
  data: T[];
  /** Unique key extractor for each item */
  keyExtractor: (item: T, index: number) => string | number;
  /** Function to render each card styled for stacked mobile layout */
  renderItem: (item: T, index: number) => React.ReactNode;
  /** Language configuration for RTL support and translation */
  lang?: "en" | "ar";
  /** Optional override for items displayed per page (defaults to 5) */
  itemsPerPage?: number;
  /** Optional custom empty state render */
  emptyState?: React.ReactNode;
  /** A descriptive label for the entity being displayed (e.g., "physicians", "products") */
  itemName?: {
    en: string;
    ar: string;
  };
  /** Callback when action button is clicked */
  onAction?: () => void;
  /** Optional label for the action button */
  actionLabel?: string;
}

export default function MobileCardList<T>({
  data = [],
  keyExtractor,
  renderItem,
  lang = "en",
  itemsPerPage = 5,
  emptyState,
  itemName = { en: "items", ar: "عنصر" },
  onAction,
  actionLabel,
}: MobileCardListProps<T>) {
  const [currentPage, setCurrentPage] = useState(1);
  const isRtl = lang === "ar";

  // Reset pagination to first page if the item list length changes (due to search/filters)
  useEffect(() => {
    setCurrentPage(1);
  }, [data.length]);

  const totalItems = data.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));

  // Slice list to display exactly the paged items
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedItems = data.slice(startIndex, startIndex + itemsPerPage);

  const handlePrevPage = () => {
    setCurrentPage((prev) => Math.max(prev - 1, 1));
  };

  const handleNextPage = () => {
    setCurrentPage((prev) => Math.min(prev + 1, totalPages));
  };

  const showingStart = totalItems === 0 ? 0 : startIndex + 1;
  const showingEnd = Math.min(currentPage * itemsPerPage, totalItems);

  return (
    <div 
      className="block md:hidden w-full space-y-4"
      dir={isRtl ? "rtl" : "ltr"}
      id="mobile-card-list-wrapper"
    >
      {/* Cards container with motion stagger transitions for premium feedback */}
      <div className="space-y-3.5" id="mobile-card-list-container">
        {totalItems > 0 ? (
          <AnimatePresence mode="popLayout">
            {paginatedItems.map((item, idx) => {
              const key = keyExtractor(item, idx);
              return (
                <motion.div
                  key={key}
                  layout
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.22, ease: "easeOut" }}
                  className="bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-800/80 rounded-2xl p-4.5 shadow-xs hover:border-blue-500/30 dark:hover:border-blue-500/20 transition-all duration-300"
                >
                  {renderItem(item, startIndex + idx)}
                </motion.div>
              );
            })}
          </AnimatePresence>
        ) : (
          emptyState || (
            <NoDataState
              title={isRtl ? `لم يتم العثور على أي ${itemName.ar || "عناصر"}` : `No ${itemName.en || "items"} found`}
              description={isRtl 
                ? `لم نجد أي ${itemName.ar || "عناصر"} مطابقة لمعايير البحث الحالية.` 
                : `We couldn't find any ${itemName.en || "items"} matching your current criteria.`
              }
              onAction={onAction}
              actionLabel={actionLabel}
              lang={lang}
              icon={Database}
            />
          )
        )}
      </div>

      {/* Pagination Controls Footer - strictly optimized for responsive touch targets >= 44px */}
      {totalPages > 1 && (
        <div 
          className="flex items-center justify-between bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-800/80 rounded-2xl p-3 shadow-xxs gap-4"
          id="mobile-card-list-pagination"
        >
          {/* Item Counter / Status info */}
          <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 font-sans select-none pl-1 rtl:pl-0 rtl:pr-1">
            {isRtl ? (
              <span>
                عرض <strong className="text-slate-800 dark:text-slate-100 font-extrabold">{showingStart}–{showingEnd}</strong> من <strong className="text-slate-800 dark:text-slate-100 font-extrabold">{totalItems}</strong> {itemName.ar}
              </span>
            ) : (
              <span>
                Showing <strong className="text-slate-800 dark:text-slate-100 font-extrabold">{showingStart}–{showingEnd}</strong> of <strong className="text-slate-800 dark:text-slate-100 font-extrabold">{totalItems}</strong> {itemName.en}
              </span>
            )}
          </div>

          {/* Navigation controls */}
          <div className="flex items-center gap-2">
            {/* Previous Page Button */}
            <button
              onClick={handlePrevPage}
              disabled={currentPage === 1}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-950 hover:bg-slate-50 dark:hover:bg-slate-900 disabled:opacity-35 disabled:cursor-not-allowed transition-all active:scale-95 cursor-pointer"
              title={isRtl ? "الصفحة السابقة" : "Previous page"}
            >
              {isRtl ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
            </button>

            {/* Current/Total display indicator */}
            <div className="px-3 text-xs font-mono font-bold text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-slate-950 border border-slate-200/50 dark:border-slate-800/50 rounded-xl min-h-[44px] flex items-center justify-center select-none">
              {currentPage} / {totalPages}
            </div>

            {/* Next Page Button */}
            <button
              onClick={handleNextPage}
              disabled={currentPage === totalPages}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-950 hover:bg-slate-50 dark:hover:bg-slate-900 disabled:opacity-35 disabled:cursor-not-allowed transition-all active:scale-95 cursor-pointer"
              title={isRtl ? "الصفحة التالية" : "Next page"}
            >
              {isRtl ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
