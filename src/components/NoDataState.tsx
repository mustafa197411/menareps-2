import React from "react";
import { Plus, Database } from "lucide-react";
import { motion } from "motion/react";

interface NoDataStateProps {
  /** Main title of the empty state */
  title?: string;
  /** Explanatory description */
  description?: string;
  /** Label for the action button */
  actionLabel?: string;
  /** Callback when action button is clicked */
  onAction?: () => void;
  /** Custom Icon component from lucide-react */
  icon?: React.ComponentType<{ className?: string; size?: number }>;
  /** Language switcher state */
  lang?: "en" | "ar";
  /** Optional override to hide action button */
  showAction?: boolean;
}

export default function NoDataState({
  title,
  description,
  actionLabel,
  onAction,
  icon: Icon = Database,
  lang = "en",
  showAction = true,
}: NoDataStateProps) {
  const isRtl = lang === "ar";

  const defaultTitle = isRtl ? "لا توجد سجلات حالياً" : "No Records Found";
  const defaultDesc = isRtl
    ? "قاعدة البيانات الخاصة بك فارغة. ابدأ بإنشاء أول سجل لك ليتم تخزينه ومزامنته سحابياً بشكل آمن."
    : "Your database is empty. Get started by creating your first record to securely store and synchronize it to the cloud.";
  const defaultActionLabel = isRtl ? "إنشاء أول سجل" : "Create First Record";

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98, y: 15 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="w-full py-16 px-6 text-center bg-white dark:bg-slate-900 border border-dashed border-slate-300 dark:border-slate-800 rounded-3xl shadow-xs flex flex-col items-center justify-center space-y-6"
      dir={isRtl ? "rtl" : "ltr"}
      id="no-data-state-container"
    >
      {/* Decorative Premium Illustration Container */}
      <div className="relative flex items-center justify-center w-24 h-24" id="no-data-illustration">
        {/* Soft glowing concentric background rings */}
        <div className="absolute inset-0 bg-blue-500/5 dark:bg-blue-400/5 rounded-full animate-ping duration-1000 opacity-75" />
        <div className="absolute w-20 h-20 bg-blue-500/10 dark:bg-blue-400/10 rounded-full border border-blue-500/20 dark:border-blue-400/20 animate-pulse" />
        <div className="absolute w-14 h-14 bg-gradient-to-tr from-blue-600/20 to-indigo-600/20 dark:from-blue-500/30 dark:to-indigo-500/30 rounded-2xl rotate-12" />
        
        {/* Main Floating Icon */}
        <div className="relative z-10 flex items-center justify-center text-blue-600 dark:text-blue-400 drop-shadow-md">
          <Icon size={32} className="animate-bounce" style={{ animationDuration: "3s" }} />
        </div>
      </div>

      {/* Typography & Messaging */}
      <div className="max-w-md space-y-2" id="no-data-messaging">
        <h3 className="font-extrabold text-slate-800 dark:text-white text-sm tracking-tight sm:text-base">
          {title || defaultTitle}
        </h3>
        <p className="text-xxs sm:text-xs text-slate-400 dark:text-slate-500 leading-relaxed max-w-sm mx-auto font-medium">
          {description || defaultDesc}
        </p>
      </div>

      {/* Primary Action Trigger (Onboarding help) */}
      {showAction && onAction && (
        <motion.button
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          onClick={onAction}
          className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500 text-white font-extrabold text-xs rounded-xl shadow-md shadow-blue-500/10 hover:shadow-lg hover:shadow-blue-500/20 transition-all cursor-pointer border-none outline-none"
          id="no-data-create-action-btn"
        >
          <Plus size={15} strokeWidth={2.5} />
          <span>{actionLabel || defaultActionLabel}</span>
        </motion.button>
      )}
    </motion.div>
  );
}
