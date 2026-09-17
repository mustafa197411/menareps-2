import React, { useState } from "react";
import {
  AlertCircle,
  Clock,
  CheckCircle2,
  Search,
  ChevronDown,
  Check
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface MyTasksProps {
  lang: "en" | "ar";
}

interface TaskItem {
  id: string;
  title: string;
  status: "Open" | "In Progress" | "Done" | "Cancelled";
  priority: "High" | "Medium" | "Low";
  dueDate: string;
}

export default function MyTasks({ lang }: MyTasksProps) {
  const isRtl = lang === "ar";

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<string>("All Statuses");
  const [selectedPriority, setSelectedPriority] = useState<string>("All Priorities");

  // Dropdown open states to replicate screenshot 1 exact visual dropdown
  const [isStatusMenuOpen, setIsStatusMenuOpen] = useState(false);
  const [isPriorityMenuOpen, setIsPriorityMenuOpen] = useState(false);

  // Initial state matching screenshot 1 (0 tasks)
  const [tasks] = useState<TaskItem[]>([]);

  const t = {
    title: isRtl ? "مهامي" : "My Tasks",
    subtitle: isRtl ? "عرض والرد على المهام المخصصة لك" : "View and respond to tasks assigned to you",
    open: isRtl ? "مفتوحة" : "Open",
    inProgress: isRtl ? "قيد التنفيذ" : "In Progress",
    completed: isRtl ? "مكتملة" : "Completed",
    overdue: isRtl ? "متأخرة" : "Overdue",
    searchPlaceholder: isRtl ? "البحث في المهام..." : "Search tasks...",
    allStatuses: isRtl ? "كل الحالات" : "All Statuses",
    statusOpen: isRtl ? "مفتوح" : "Open",
    statusInProgress: isRtl ? "قيد التنفيذ" : "In Progress",
    statusDone: isRtl ? "مكتمل" : "Done",
    statusCancelled: isRtl ? "ملغي" : "Cancelled",
    allPriorities: isRtl ? "كل الألويات" : "All Priorities",
    priorityHigh: isRtl ? "عالية" : "High",
    priorityMedium: isRtl ? "متوسطة" : "Medium",
    priorityLow: isRtl ? "منخفضة" : "Low",
    noTasks: isRtl ? "لا توجد مهام مخصصة لك" : "No tasks assigned to you"
  };

  const statusOptions = [
    { id: "All Statuses", label: t.allStatuses },
    { id: "Open", label: t.statusOpen },
    { id: "In Progress", label: t.statusInProgress },
    { id: "Done", label: t.statusDone },
    { id: "Cancelled", label: t.statusCancelled }
  ];

  const priorityOptions = [
    { id: "All Priorities", label: t.allPriorities },
    { id: "High", label: t.priorityHigh },
    { id: "Medium", label: t.priorityMedium },
    { id: "Low", label: t.priorityLow }
  ];

  return (
    <div className="w-full max-w-7xl mx-auto p-4 md:p-8 text-slate-800 dark:text-slate-100" dir={isRtl ? "rtl" : "ltr"}>
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          {t.title}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          {t.subtitle}
        </p>
      </div>

      {/* Top Status Cards (Screenshot 1 Exact Layout) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
        {/* Open */}
        <div className="bg-slate-50/80 dark:bg-slate-900/50 rounded-2xl p-5 border border-slate-200/80 dark:border-slate-800 flex items-center justify-between shadow-xxs">
          <div>
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 block">
              {t.open}
            </span>
            <span className="text-2xl font-bold text-slate-900 dark:text-white mt-1 block font-mono">
              0
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400 flex items-center justify-center">
            <AlertCircle size={20} />
          </div>
        </div>

        {/* In Progress */}
        <div className="bg-slate-50/80 dark:bg-slate-900/50 rounded-2xl p-5 border border-slate-200/80 dark:border-slate-800 flex items-center justify-between shadow-xxs">
          <div>
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 block">
              {t.inProgress}
            </span>
            <span className="text-2xl font-bold text-slate-900 dark:text-white mt-1 block font-mono">
              0
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-purple-100 dark:bg-purple-950 text-purple-600 dark:text-purple-400 flex items-center justify-center">
            <Clock size={20} />
          </div>
        </div>

        {/* Completed */}
        <div className="bg-slate-50/80 dark:bg-slate-900/50 rounded-2xl p-5 border border-slate-200/80 dark:border-slate-800 flex items-center justify-between shadow-xxs">
          <div>
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 block">
              {t.completed}
            </span>
            <span className="text-2xl font-bold text-slate-900 dark:text-white mt-1 block font-mono">
              0
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
            <CheckCircle2 size={20} />
          </div>
        </div>

        {/* Overdue */}
        <div className="bg-slate-50/80 dark:bg-slate-900/50 rounded-2xl p-5 border border-slate-200/80 dark:border-slate-800 flex items-center justify-between shadow-xxs">
          <div>
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 block">
              {t.overdue}
            </span>
            <span className="text-2xl font-bold text-slate-900 dark:text-white mt-1 block font-mono">
              0
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-rose-100 dark:bg-rose-950 text-rose-600 dark:text-rose-400 flex items-center justify-center">
            <AlertCircle size={20} />
          </div>
        </div>
      </div>

      {/* Main Filter & Tasks Container */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-6 mt-6 shadow-xxs min-h-[420px] flex flex-col relative">
        {/* Filters Row */}
        <div className="flex flex-col sm:flex-row items-center gap-3">
          {/* Search Bar */}
          <div className="relative w-full sm:flex-1">
            <Search size={16} className="absolute left-3.5 top-3 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={t.searchPlaceholder}
              className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-blue-500 transition-colors shadow-xxs"
            />
          </div>

          {/* All Statuses Dropdown */}
          <div className="relative w-full sm:w-auto">
            <button
              type="button"
              onClick={() => {
                setIsStatusMenuOpen(!isStatusMenuOpen);
                setIsPriorityMenuOpen(false);
              }}
              className="w-full sm:w-[150px] px-3.5 py-2.5 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-medium text-slate-700 dark:text-slate-200 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer shadow-xxs"
            >
              <span>{statusOptions.find(o => o.id === selectedStatus)?.label}</span>
              <ChevronDown size={14} className="text-slate-400" />
            </button>

            {/* Exact Replica Dropdown Menu from Screenshot 1 */}
            <AnimatePresence>
              {isStatusMenuOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 4, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 4, scale: 0.98 }}
                  className="absolute left-0 sm:right-0 top-full mt-1.5 w-full sm:w-[170px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl z-30 py-1 text-xs"
                >
                  {statusOptions.map(option => {
                    const isSelected = selectedStatus === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => {
                          setSelectedStatus(option.id);
                          setIsStatusMenuOpen(false);
                        }}
                        className={`w-full px-3.5 py-2 text-left flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer ${
                          isSelected ? "bg-slate-100/80 dark:bg-slate-800 font-semibold text-slate-900 dark:text-white" : "text-slate-700 dark:text-slate-300"
                        }`}
                      >
                        <span className="w-3.5 flex items-center justify-center">
                          {isSelected && <Check size={13} className="text-slate-800 dark:text-slate-200" />}
                        </span>
                        <span>{option.label}</span>
                      </button>
                    );
                  })}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* All Priorities Dropdown */}
          <div className="relative w-full sm:w-auto">
            <button
              type="button"
              onClick={() => {
                setIsPriorityMenuOpen(!isPriorityMenuOpen);
                setIsStatusMenuOpen(false);
              }}
              className="w-full sm:w-[150px] px-3.5 py-2.5 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-medium text-slate-700 dark:text-slate-200 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer shadow-xxs"
            >
              <span>{priorityOptions.find(o => o.id === selectedPriority)?.label}</span>
              <ChevronDown size={14} className="text-slate-400" />
            </button>

            <AnimatePresence>
              {isPriorityMenuOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 4, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 4, scale: 0.98 }}
                  className="absolute right-0 top-full mt-1.5 w-full sm:w-[170px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl z-30 py-1 text-xs"
                >
                  {priorityOptions.map(option => {
                    const isSelected = selectedPriority === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => {
                          setSelectedPriority(option.id);
                          setIsPriorityMenuOpen(false);
                        }}
                        className={`w-full px-3.5 py-2 text-left flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer ${
                          isSelected ? "bg-slate-100/80 dark:bg-slate-800 font-semibold text-slate-900 dark:text-white" : "text-slate-700 dark:text-slate-300"
                        }`}
                      >
                        <span className="w-3.5 flex items-center justify-center">
                          {isSelected && <Check size={13} className="text-slate-800 dark:text-slate-200" />}
                        </span>
                        <span>{option.label}</span>
                      </button>
                    );
                  })}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Empty State Centered (Exact Replica of Screenshot 1 Checkmark icon circle) */}
        <div className="flex-1 flex flex-col items-center justify-center py-24 text-center my-auto">
          <div className="w-12 h-12 rounded-full border-2 border-slate-300 dark:border-slate-600 flex items-center justify-center text-slate-400 dark:text-slate-500 mb-3 shadow-xxs">
            <Check size={26} strokeWidth={2.5} />
          </div>
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
            {t.noTasks}
          </p>
        </div>
      </div>
    </div>
  );
}
