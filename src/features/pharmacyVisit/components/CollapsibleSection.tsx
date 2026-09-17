import React, { useState } from "react";
import { ChevronDown, ChevronUp, AlertCircle, CheckCircle2 } from "lucide-react";

interface CollapsibleSectionProps {
  id: string;
  title: string;
  subtitle?: string;
  badge?: string;
  icon?: React.ReactNode;
  isError?: boolean;
  isComplete?: boolean;
  defaultOpen?: boolean;
  children: React.ReactNode;
  lang: "en" | "ar";
}

export const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  id,
  title,
  subtitle,
  badge,
  icon,
  isError,
  isComplete,
  defaultOpen = true,
  children,
  lang
}) => {
  const isRtl = lang === "ar";
  const [isOpen, setIsOpen] = useState(defaultOpen);

  // If there's a validation error, automatically expand section to expose error
  React.useEffect(() => {
    if (isError) {
      setIsOpen(true);
    }
  }, [isError]);

  return (
    <div 
      id={id}
      className={`border rounded-2xl transition-all duration-200 bg-white dark:bg-slate-900 overflow-hidden shadow-xs ${
        isError 
          ? "border-rose-300 dark:border-rose-800/60 ring-1 ring-rose-400/20" 
          : isComplete 
          ? "border-emerald-200 dark:border-emerald-900/40" 
          : "border-slate-200 dark:border-slate-800"
      }`}
    >
      <header className="w-full flex items-center justify-between p-4 sm:p-5 select-none bg-slate-50/50 dark:bg-slate-950/30">
        <div className="flex items-center gap-3 min-w-0">
          {icon && <div className="text-indigo-600 dark:text-indigo-400 shrink-0">{icon}</div>}
          <div className="min-w-0 text-left rtl:text-right">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                {title}
              </h3>
              {badge && (
                <span className="px-2 py-0.5 text-[10px] font-mono font-semibold rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                  {badge}
                </span>
              )}
              {isError && (
                <span className="flex items-center gap-1 text-[10px] font-bold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 px-2 py-0.5 rounded-md border border-rose-200 dark:border-rose-900/40">
                  <AlertCircle size={12} />
                  {isRtl ? "يتطلب إجراء" : "Action Required"}
                </span>
              )}
              {isComplete && !isError && (
                <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-md border border-emerald-200 dark:border-emerald-900/40">
                  <CheckCircle2 size={12} />
                  {isRtl ? "مكتمل" : "Complete"}
                </span>
              )}
            </div>
            {subtitle && (
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                {subtitle}
              </p>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsOpen(prev => !prev)}
          aria-expanded={isOpen}
          aria-controls={`${id}-content`}
          className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
        >
          <span className="hidden sm:inline">
            {isOpen ? (isRtl ? "طي" : "Collapse") : (isRtl ? "توسيع" : "Expand")}
          </span>
          {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </header>

      {isOpen && (
        <div id={`${id}-content`} className="p-4 sm:p-5 border-t border-slate-100 dark:border-slate-800/80 space-y-4">
          {children}
        </div>
      )}
    </div>
  );
};
