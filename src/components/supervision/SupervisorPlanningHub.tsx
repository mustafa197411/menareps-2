import React, { useState } from "react";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Plus,
  X,
  MapPin,
  Users,
  CheckCircle2,
  Clock,
  Sparkles,
  Trash2,
  FileText
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface SupervisorPlanningHubProps {
  lang: "en" | "ar";
}

interface PlannedActivity {
  id: string;
  dateStr: string; // e.g. "27-Jun-2026"
  planType: string;
  accompaniedRep: string;
  district: string;
  city: string;
  area: string;
  notes: string;
  status: "Scheduled" | "Completed";
}

export default function SupervisorPlanningHub({ lang }: SupervisorPlanningHubProps) {
  const isRtl = lang === "ar";

  // Week definition matching screenshot exact dates
  const weekDays = [
    { dayName: isRtl ? "الأحد" : "Sun", dayNum: "21", dateStr: "21-Jun-2026" },
    { dayName: isRtl ? "الاثنين" : "Mon", dayNum: "22", dateStr: "22-Jun-2026" },
    { dayName: isRtl ? "الثلاثاء" : "Tue", dayNum: "23", dateStr: "23-Jun-2026" },
    { dayName: isRtl ? "الأربعاء" : "Wed", dayNum: "24", dateStr: "24-Jun-2026" },
    { dayName: isRtl ? "الخميس" : "Thu", dayNum: "25", dateStr: "25-Jun-2026" },
    { dayName: isRtl ? "الجمعة" : "Fri", dayNum: "26", dateStr: "26-Jun-2026" },
    { dayName: isRtl ? "السبت" : "Sat", dayNum: "27", dateStr: "27-Jun-2026" }
  ];

  const [selectedDate, setSelectedDate] = useState("27-Jun-2026");
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Form State matching screenshot 2
  const [planDate, setPlanDate] = useState("27-Jun-2026");
  const [planType, setPlanType] = useState("Joint Field Visit");
  const [accompaniedRep, setAccompaniedRep] = useState("Not accompanied");
  const [district, setDistrict] = useState("Select district");
  const [city, setCity] = useState("Select city");
  const [area, setArea] = useState("Select area");
  const [notes, setNotes] = useState("");

  const [toast, setToast] = useState("");

  // Mock initial planned activities
  const [activities, setActivities] = useState<PlannedActivity[]>([
    {
      id: "PLN-101",
      dateStr: "22-Jun-2026",
      planType: "Joint Field Visit",
      accompaniedRep: "Omar Al-Mokhtar",
      district: "Tripoli District",
      city: "Tripoli",
      area: "Hay Al-Andalus",
      notes: "Focus on cardiology Class A hospitals detailing flow coaching.",
      status: "Completed"
    },
    {
      id: "PLN-102",
      dateStr: "24-Jun-2026",
      planType: "Coaching Session",
      accompaniedRep: "Sarah Al-Sharif",
      district: "Benghazi District",
      city: "Benghazi",
      area: "Downtown",
      notes: "Review objection handling and product differentiation.",
      status: "Completed"
    },
    {
      id: "PLN-103",
      dateStr: "27-Jun-2026",
      planType: "Key Account Audit",
      accompaniedRep: "Tarek Abu-Zeid",
      district: "Tripoli District",
      city: "Tripoli",
      area: "Ain Zara",
      notes: "Audit sample distribution compliance at Tripoli Medical Center.",
      status: "Scheduled"
    },
    {
      id: "PLN-104",
      dateStr: "27-Jun-2026",
      planType: "Team Meeting",
      accompaniedRep: "Not accompanied",
      district: "Tripoli District",
      city: "Tripoli",
      area: "Gargaresh",
      notes: "Weekly field operations roundup and Q3 incentive targets discussion.",
      status: "Scheduled"
    }
  ]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  };

  const t = {
    title: isRtl ? "مركز تخطيط المشرف" : "Supervisor Planning Hub",
    subtitle: isRtl ? "تخطيط وتنظيم الأنشطة الميدانية" : "Plan and organize your field activities",
    newPlanBtn: isRtl ? "خطة جديدة" : "New Plan",
    weekRangeHeader: isRtl ? "21 يونيو - 27 يونيو، 2026" : "Jun 21 - Jun 27, 2026",
    createPlanModalTitle: isRtl ? "إنشاء خطة" : "Create Plan",
    planDate: isRtl ? "تاريخ الخطة" : "Plan Date",
    planType: isRtl ? "نوع الخطة" : "Plan Type",
    selectPlanType: isRtl ? "اختر نوع الخطة" : "Select plan type",
    accompaniedRep: isRtl ? "المندوب المرافق" : "Accompanied Rep",
    notAccompanied: isRtl ? "بدون مرافق" : "Not accompanied",
    location: isRtl ? "الموقع" : "Location",
    district: isRtl ? "المنطقة الإدارية" : "District",
    selectDistrict: isRtl ? "اختر المنطقة" : "Select district",
    city: isRtl ? "المدينة" : "City",
    selectCity: isRtl ? "اختر المدينة" : "Select city",
    area: isRtl ? "الحي / المنطقة" : "Area",
    selectArea: isRtl ? "اختر الحي" : "Select area",
    notes: isRtl ? "ملاحظات" : "Notes",
    notesPlaceholder: isRtl ? "ملاحظات" : "Notes",
    cancel: isRtl ? "إلغاء" : "Cancel",
    createPlanSubmit: isRtl ? "حفظ الخطة" : "Create Plan",
    planCreatedSuccess: isRtl ? "تم إنشاء الخطة الميدانية بنجاح!" : "Field plan created successfully!",
    dayActivitiesHeader: isRtl ? "الأنشطة المجدولة ليوم" : "Scheduled Activities for",
    noActivities: isRtl ? "لا توجد خطط مجدولة لهذا اليوم. انقر على 'خطة جديدة' لجدولة نشاط." : "No activities scheduled for this day. Click '+ New Plan' to schedule one.",
    statusCompleted: isRtl ? "مكتمل" : "Completed",
    statusScheduled: isRtl ? "مجدول" : "Scheduled",
    markCompleted: isRtl ? "تحديد كمكتمل" : "Complete",
    delete: isRtl ? "حذف" : "Delete"
  };

  const handleOpenModalForDate = (dateStr: string) => {
    setPlanDate(dateStr);
    setIsModalOpen(true);
  };

  const handleCreatePlanSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!planType) return;

    const newAct: PlannedActivity = {
      id: `PLN-${Math.floor(100 + Math.random() * 900)}`,
      dateStr: planDate,
      planType: planType,
      accompaniedRep: accompaniedRep,
      district: district === "Select district" ? "Tripoli District" : district,
      city: city === "Select city" ? "Tripoli" : city,
      area: area === "Select area" ? "Hay Al-Andalus" : area,
      notes: notes || "No additional notes",
      status: "Scheduled"
    };

    setActivities(prev => [newAct, ...prev]);
    setIsModalOpen(false);
    setSelectedDate(planDate);
    setNotes("");
    showToast(t.planCreatedSuccess);
  };

  const toggleStatus = (id: string) => {
    setActivities(prev =>
      prev.map(act =>
        act.id === id
          ? { ...act, status: act.status === "Scheduled" ? "Completed" : "Scheduled" }
          : act
      )
    );
  };

  const deleteActivity = (id: string) => {
    setActivities(prev => prev.filter(act => act.id !== id));
  };

  const selectedActivities = activities.filter(act => act.dateStr === selectedDate);
  const selectedDayInfo = weekDays.find(d => d.dateStr === selectedDate);

  return (
    <div className="w-full max-w-7xl mx-auto p-4 md:p-8 text-slate-800 dark:text-slate-100" dir={isRtl ? "rtl" : "ltr"}>
      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-5 right-5 z-50 bg-emerald-600 text-white px-4 py-3 rounded-xl shadow-lg flex items-center gap-2 text-xs font-bold"
          >
            <CheckCircle2 size={16} />
            <span>{toast}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top Header Section */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            {t.title}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {t.subtitle}
          </p>
        </div>

        <button
          onClick={() => handleOpenModalForDate(selectedDate)}
          className="bg-[#2563eb] hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium text-sm flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer shrink-0"
        >
          <Plus size={16} />
          <span>{t.newPlanBtn}</span>
        </button>
      </div>

      {/* Main Planning Hub Card (Screenshot 1 Exact Replica) */}
      <div className="bg-slate-50/70 dark:bg-slate-900/40 rounded-2xl p-6 border border-slate-200/80 dark:border-slate-800 mt-6 shadow-xxs">
        {/* Date Navigator Row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-slate-800 dark:text-slate-100">
            <Calendar size={18} className="text-slate-700 dark:text-slate-300" />
            <span className="text-base">{t.weekRangeHeader}</span>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              className="p-1.5 text-slate-500 hover:text-slate-800 dark:hover:text-white hover:bg-slate-200/50 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
            >
              <ChevronLeft size={16} className={isRtl ? "rotate-180" : ""} />
            </button>
            <button
              type="button"
              className="p-1.5 text-slate-500 hover:text-slate-800 dark:hover:text-white hover:bg-slate-200/50 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
            >
              <ChevronRight size={16} className={isRtl ? "rotate-180" : ""} />
            </button>
          </div>
        </div>

        {/* 7-Day Calendar Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-3 mt-5">
          {weekDays.map(day => {
            const isSelected = day.dateStr === selectedDate;
            const dayActs = activities.filter(a => a.dateStr === day.dateStr);

            return (
              <div
                key={day.dateStr}
                onClick={() => setSelectedDate(day.dateStr)}
                className={`rounded-xl p-4 min-h-[200px] md:min-h-[220px] flex flex-col items-center justify-start transition-all cursor-pointer relative ${
                  isSelected
                    ? "bg-white dark:bg-slate-900 border border-[#2563eb] shadow-sm ring-1 ring-[#2563eb]/20"
                    : "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 shadow-xxs"
                }`}
              >
                <span className={`text-xs ${isSelected ? "text-[#2563eb] dark:text-[#60a5fa] font-semibold" : "text-slate-500 dark:text-slate-400"}`}>
                  {day.dayName}
                </span>
                <span className={`text-lg mt-0.5 ${isSelected ? "text-[#2563eb] dark:text-[#60a5fa] font-bold" : "text-slate-800 dark:text-slate-200 font-medium"}`}>
                  {day.dayNum}
                </span>

                {/* Mini Indicators of Planned Activities inside Day Card */}
                <div className="w-full mt-3 space-y-1.5 overflow-hidden flex-1">
                  {dayActs.map(act => (
                    <div
                      key={act.id}
                      className={`w-full p-1.5 rounded-lg text-left text-[11px] border leading-tight ${
                        act.status === "Completed"
                          ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-100 dark:border-emerald-900/50 text-emerald-800 dark:text-emerald-300"
                          : isSelected
                          ? "bg-blue-50 dark:bg-blue-950/50 border-blue-100 dark:border-blue-900/60 text-blue-900 dark:text-blue-200"
                          : "bg-slate-50 dark:bg-slate-800/60 border-slate-100 dark:border-slate-800 text-slate-700 dark:text-slate-300"
                      }`}
                    >
                      <span className="font-bold block truncate">{act.planType}</span>
                      <span className="text-[9px] opacity-80 block truncate mt-0.5">
                        {act.accompaniedRep === "Not accompanied" ? "Solo" : act.accompaniedRep}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Add hover button inside card */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleOpenModalForDate(day.dateStr);
                  }}
                  className="mt-2 opacity-0 group-hover:opacity-100 hover:opacity-100 w-full py-1 text-[10px] font-semibold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/50 rounded transition-opacity flex items-center justify-center gap-1"
                >
                  <Plus size={12} />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Selected Day Activities List */}
      <div className="mt-8 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-xxs">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4 mb-4">
          <div className="flex items-center gap-2">
            <Clock size={18} className="text-blue-600 dark:text-blue-400" />
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              {t.dayActivitiesHeader} ({selectedDayInfo?.dayName} {selectedDayInfo?.dayNum})
            </h2>
            <span className="bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 text-xs font-bold px-2 py-0.5 rounded-full">
              {selectedActivities.length}
            </span>
          </div>

          <button
            onClick={() => handleOpenModalForDate(selectedDate)}
            className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 cursor-pointer"
          >
            <Plus size={14} />
            <span>{isRtl ? "إضافة نشاط لهذا اليوم" : "Add activity to this day"}</span>
          </button>
        </div>

        {selectedActivities.length === 0 ? (
          <div className="py-12 text-center text-slate-400 dark:text-slate-500 text-sm">
            <FileText size={32} className="mx-auto mb-2 opacity-40" />
            <p>{t.noActivities}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {selectedActivities.map(act => (
              <div
                key={act.id}
                className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50 flex flex-col justify-between gap-3 hover:border-slate-300 dark:hover:border-slate-700 transition-colors"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-bold text-slate-900 dark:text-white">
                      {act.planType}
                    </span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                        act.status === "Completed"
                          ? "bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300"
                          : "bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300"
                      }`}
                    >
                      {act.status === "Completed" ? t.statusCompleted : t.statusScheduled}
                    </span>
                  </div>

                  <div className="mt-2 space-y-1.5 text-xs text-slate-600 dark:text-slate-400">
                    <div className="flex items-center gap-1.5">
                      <Users size={14} className="text-slate-400 shrink-0" />
                      <span>{t.accompaniedRep}: <strong className="text-slate-800 dark:text-slate-200">{act.accompaniedRep}</strong></span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <MapPin size={14} className="text-slate-400 shrink-0" />
                      <span>{act.district} — {act.city} ({act.area})</span>
                    </div>
                    {act.notes && (
                      <p className="mt-2 text-xs bg-white dark:bg-slate-900 p-2 rounded-lg border border-slate-100 dark:border-slate-800 text-slate-700 dark:text-slate-300">
                        {act.notes}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200/60 dark:border-slate-800/60">
                  <button
                    onClick={() => deleteActivity(act.id)}
                    className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg transition-colors cursor-pointer"
                    title={t.delete}
                  >
                    <Trash2 size={15} />
                  </button>
                  <button
                    onClick={() => toggleStatus(act.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors ${
                      act.status === "Completed"
                        ? "bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700"
                        : "bg-emerald-600 hover:bg-emerald-700 text-white"
                    }`}
                  >
                    <CheckCircle2 size={14} />
                    <span>{act.status === "Completed" ? (isRtl ? "إعادة كمجدول" : "Mark Pending") : t.markCompleted}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Screenshot 2 Exact Replica Modal Dialog */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 overflow-y-auto backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 15 }}
              className="bg-white dark:bg-slate-900 w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden relative flex flex-col my-auto max-h-[90vh] text-left"
            >
              {/* Modal Header */}
              <div className="px-6 pt-6 pb-3 relative border-b border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="absolute top-5 right-5 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg transition-colors cursor-pointer"
                >
                  <X size={18} />
                </button>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                  {t.createPlanModalTitle}
                </h2>
              </div>

              {/* Form Content */}
              <form onSubmit={handleCreatePlanSubmit} className="px-6 py-4 overflow-y-auto space-y-4 flex-1 text-xs">
                {/* Plan Date */}
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    {t.planDate}
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      readOnly
                      value={planDate}
                      onChange={e => setPlanDate(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-medium text-slate-800 dark:text-slate-100 focus:outline-none focus:border-blue-500 shadow-xxs pr-10 font-mono"
                    />
                    <Calendar size={15} className="absolute right-3.5 top-3 text-slate-800 dark:text-slate-200 pointer-events-none" />
                  </div>
                </div>

                {/* Plan Type */}
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    {t.planType}
                  </label>
                  <select
                    required
                    value={planType}
                    onChange={e => setPlanType(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-medium text-slate-800 dark:text-slate-100 focus:outline-none focus:border-blue-500 shadow-xxs"
                  >
                    <option value="Joint Field Visit">Joint Field Visit</option>
                    <option value="Coaching Session">Coaching Session</option>
                    <option value="Key Account Audit">Key Account Audit</option>
                    <option value="Team Meeting">Team Meeting</option>
                    <option value="Administrative Day">Administrative Day</option>
                    <option value="Scientific Symposia">Scientific Symposia</option>
                  </select>
                </div>

                {/* Accompanied Rep */}
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    {t.accompaniedRep}
                  </label>
                  <select
                    value={accompaniedRep}
                    onChange={e => setAccompaniedRep(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-medium text-slate-800 dark:text-slate-100 focus:outline-none focus:border-blue-500 shadow-xxs"
                  >
                    <option value="Not accompanied">{t.notAccompanied}</option>
                    <option value="Omar Al-Mokhtar">Omar Al-Mokhtar</option>
                    <option value="Sarah Al-Sharif">Sarah Al-Sharif</option>
                    <option value="Tarek Abu-Zeid">Tarek Abu-Zeid</option>
                    <option value="Muna Al-Saeed">Muna Al-Saeed</option>
                    <option value="Wajdi Al-Hasi">Wajdi Al-Hasi</option>
                  </select>
                </div>

                {/* Location Heading & Grid */}
                <div className="pt-1">
                  <span className="block text-[11px] font-semibold text-slate-400 dark:text-slate-500 mb-2">
                    {t.location}
                  </span>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                        {t.district}
                      </label>
                      <select
                        value={district}
                        onChange={e => setDistrict(e.target.value)}
                        className="w-full px-3 py-2.5 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-medium text-slate-500 dark:text-slate-400 focus:outline-none focus:border-blue-500 shadow-xxs"
                      >
                        <option value="Select district">{t.selectDistrict}</option>
                        <option value="Tripoli District">Tripoli District</option>
                        <option value="Benghazi District">Benghazi District</option>
                        <option value="Misrata District">Misrata District</option>
                        <option value="Zawiya District">Zawiya District</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                        {t.city}
                      </label>
                      <select
                        value={city}
                        onChange={e => setCity(e.target.value)}
                        className="w-full px-3 py-2.5 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-medium text-slate-500 dark:text-slate-400 focus:outline-none focus:border-blue-500 shadow-xxs"
                      >
                        <option value="Select city">{t.selectCity}</option>
                        <option value="Tripoli">Tripoli</option>
                        <option value="Benghazi">Benghazi</option>
                        <option value="Misrata">Misrata</option>
                        <option value="Zawiya">Zawiya</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                      {t.area}
                    </label>
                    <select
                      value={area}
                      onChange={e => setArea(e.target.value)}
                      className="w-full px-3 py-2.5 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-medium text-slate-500 dark:text-slate-400 focus:outline-none focus:border-blue-500 shadow-xxs"
                    >
                      <option value="Select area">{t.selectArea}</option>
                      <option value="Hay Al-Andalus">Hay Al-Andalus</option>
                      <option value="Ain Zara">Ain Zara</option>
                      <option value="Gargaresh">Gargaresh</option>
                      <option value="Downtown">Downtown</option>
                    </select>
                  </div>
                </div>

                {/* Notes Textarea */}
                <div className="pt-1">
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    {t.notes}
                  </label>
                  <textarea
                    rows={3}
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder={t.notesPlaceholder}
                    className="w-full p-3 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-blue-500 shadow-xxs resize-none"
                  />
                </div>

                {/* Modal Footer Actions */}
                <div className="flex items-center justify-end gap-3 pt-5 pb-1 border-t border-slate-100 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="px-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-semibold cursor-pointer transition-colors shadow-xxs"
                  >
                    {t.cancel}
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2.5 bg-[#2563eb] hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-sm cursor-pointer transition-colors"
                  >
                    {t.createPlanSubmit}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
