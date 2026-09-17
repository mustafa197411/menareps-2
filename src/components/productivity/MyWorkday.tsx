import React, { useEffect, useMemo, useState } from "react";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  CheckCircle2,
  Coffee,
  Car,
  ArrowRight,
  MapPin,
  X,
  ChevronDown,
  Check,
  Home,
  PlusSquare
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import type { User } from "../../types";
import { auth } from "../../lib/firebase";
import { db } from "../../lib/firebase";
import { collection, getDocs, query, where } from "firebase/firestore";
import { fetchScopedTeamActivity } from "../../lib/teamActivityReadClient";
import { mutateOwnAttendance } from "../../lib/attendanceMutationClient";
import { mutateLeaveRequest } from "../../lib/leaveRequestClient";
import { calculateAttendanceSummary, type AttendanceSession, type ApprovedLeave } from "../../lib/attendanceEngine";
import { resolveMarketForIdentity, type BusinessCalendarException, type MarketBusinessSettings } from "../../lib/marketSettings";
import { findCurrentAttendanceSession, resolveAttendanceDateWindow } from "../../lib/attendanceDateWindow";

interface MyWorkdayProps {
  lang: "en" | "ar";
  currentUser: User;
}

export default function MyWorkday({ lang, currentUser }: MyWorkdayProps) {
  const isRtl = lang === "ar";

  const [currentInstant] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState("");
  const [isLeaveModalOpen, setIsLeaveModalOpen] = useState(false);

  // Leave Form State matching screenshots 3, 4, 5
  const [leaveType, setLeaveType] = useState("ANNUAL");
  const [isLeaveTypeMenuOpen, setIsLeaveTypeMenuOpen] = useState(false);
  const [duration, setDuration] = useState("Full Day");
  const [isDurationMenuOpen, setIsDurationMenuOpen] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [leaveNotes, setLeaveNotes] = useState("");

  const [toast, setToast] = useState("");
  const [sessions, setSessions] = useState<AttendanceSession[]>([]); const [leaves, setLeaves] = useState<ApprovedLeave[]>([]); const [markets, setMarkets] = useState<MarketBusinessSettings[]>([]); const [calendarExceptions, setCalendarExceptions] = useState<BusinessCalendarException[]>([]); const [loadError, setLoadError] = useState(""); const [busy, setBusy] = useState(false);
  const market = resolveMarketForIdentity(markets, currentUser as User & { marketId?: string; countryId?: string });
  const dateWindow = useMemo(() => market ? resolveAttendanceDateWindow(currentInstant, market.timezone) : null, [currentInstant, market]);
  const todayIso = dateWindow?.currentDate || ""; const monthStart = dateWindow?.monthStart || "";
  const weekDays = useMemo(() => (dateWindow?.weekDates || []).map(iso => { const value = new Date(`${iso}T12:00:00Z`); return { dayName: new Intl.DateTimeFormat(isRtl ? "ar" : "en", { weekday: "short", timeZone: "UTC" }).format(value).slice(0, 2).toUpperCase(), dayNum: iso.slice(8), date: iso, hasDot: false }; }), [dateWindow, isRtl]);
  useEffect(() => { if (!todayIso) return; setSelectedDate(todayIso.slice(8)); setStartDate(todayIso); setEndDate(todayIso); }, [todayIso]);
  useEffect(() => { void getDocs(collection(db, "marketSettings")).then(snapshot => { const loaded = snapshot.docs.map(item => ({ marketId: item.id, ...item.data() } as MarketBusinessSettings)); setMarkets(loaded); const resolved = resolveMarketForIdentity(loaded, currentUser as User & { marketId?: string; countryId?: string }); if (!resolved) { setCalendarExceptions([]); return; } return getDocs(query(collection(db, "businessCalendarExceptions"), where("marketId", "==", resolved.marketId))).then(exceptions => setCalendarExceptions(exceptions.docs.map(item => ({ id: item.id, ...item.data() } as BusinessCalendarException)))); }).catch(error => setLoadError(error instanceof Error ? error.message : "MARKET_SETTINGS_LOAD_FAILED")); }, [currentUser.id]);
  const load = async () => { const firebaseUser = auth.currentUser; if (!firebaseUser) { setLoadError("AUTHENTICATION_REQUIRED"); return; } if (!market || !monthStart || !todayIso) return; try { const result = await fetchScopedTeamActivity(firebaseUser, monthStart, todayIso); setSessions(result.attendanceSessions.filter(row => row.userId === currentUser.id) as AttendanceSession[]); setLeaves(result.leaveRequests.filter(row => row.userId === currentUser.id).map(row => ({ id: row.id, userId: row.userId, marketId: market.marketId, startDate: row.startDate, endDate: row.endDate, type: row.category as ApprovedLeave["type"], status: row.status as ApprovedLeave["status"] }))); setLoadError(""); } catch (error) { setLoadError(error instanceof Error ? error.message : "ATTENDANCE_LOAD_FAILED"); } };
  useEffect(() => { void load(); }, [currentUser.id, monthStart, todayIso, market?.marketId]);
  const todaySession = market && todayIso ? findCurrentAttendanceSession(sessions, currentUser.id, market.marketId, todayIso) : undefined; const summary = market && monthStart && todayIso ? calculateAttendanceSummary({ userId: currentUser.id, fromDate: monthStart, toDate: todayIso, market, exceptions: calendarExceptions, sessions, leaves }) : null; const effectiveness = summary && summary.expectedAttendanceDays ? Math.round(summary.workedDays / summary.expectedAttendanceDays * 100) : 0;
  const attendanceAction = async (action: "CHECK_IN" | "CHECK_OUT") => { const firebaseUser = auth.currentUser; if (!firebaseUser) return; setBusy(true); try { const position = await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15000 })); await mutateOwnAttendance(firebaseUser, action, { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracyMeters: position.coords.accuracy }); await load(); showToast(action === "CHECK_IN" ? t.checkIn : t.checkOut); } catch (error) { setLoadError(error instanceof Error ? error.message : "ATTENDANCE_ACTION_FAILED"); } finally { setBusy(false); } };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  };

  const t = {
    title: isRtl ? "يومي الميداني" : "My Workday",
    subtitle: isRtl ? "متابعة أنشطتك وزياراتك اليومية" : "Track your daily activities and visits",
    requestLeave: isRtl ? "طلب إجازة" : "Request Leave",
    totalHours: isRtl ? "إجمالي الساعات" : "Total Hours",
    visitsCompleted: isRtl ? "الزيارات المنجزة" : "Visits Completed",
    breakTime: isRtl ? "وقت الراحة" : "Break Time",
    travelTime: isRtl ? "وقت التنقل" : "Travel Time",
    monthlyEffectiveness: isRtl ? "الفاعلية الشهرية" : "Monthly Effectiveness",
    monthLabel: todayIso ? new Intl.DateTimeFormat(isRtl ? "ar" : "en", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${todayIso}T12:00:00Z`)) : "",
    scheduled: isRtl ? "المجدول" : "Scheduled",
    worked: isRtl ? "ساعات العمل" : "Worked",
    leave: isRtl ? "الإجازات" : "Leave",
    quickActions: isRtl ? "إجراءات سريعة" : "Quick Actions",
    onDuty: isRtl ? "في العمل" : "On Duty",
    remainingTime: isRtl ? "متبقي 4 ساعات و 55 دقيقة حتى تسجيل الخروج" : "4h 55m remaining until check-out",
    checkIn: isRtl ? "تسجيل الدخول" : "Check In",
    checkOut: isRtl ? "تسجيل الخروج" : "Check Out",
    activityTimeline: isRtl ? "الجدول الزمني للأنشطة" : "Activity Timeline",
    logged: isRtl ? "مسجل" : "Logged",
    leaveModalTitle: isRtl ? "طلب إجازة" : "Request Leave",
    leaveTypeLabel: isRtl ? "نوع الإجازة" : "Leave Type",
    durationLabel: isRtl ? "المدة" : "Duration",
    startDateLabel: isRtl ? "تاريخ البدء" : "Start Date",
    endDateLabel: isRtl ? "تاريخ الانتهاء" : "End Date",
    notesLabel: isRtl ? "ملاحظات" : "Notes",
    notesPlaceholder: isRtl ? "سبب طلب الإجازة..." : "Reason for leave request...",
    cancel: isRtl ? "إلغاء" : "Cancel",
    submitRequest: isRtl ? "تقديم الطلب" : "Submit Request",
    leaveSuccess: isRtl ? "تم تقديم طلب الإجازة بنجاح!" : "Leave request submitted successfully!"
  };

  const leaveTypesList = [
    { id: "ANNUAL", label: isRtl ? "إجازة سنوية" : "Annual Leave", icon: Calendar },
    { id: "SICK", label: isRtl ? "إجازة مرضية" : "Sick Leave", icon: PlusSquare },
    { id: "PERSONAL", label: isRtl ? "إجازة شخصية" : "Personal Leave", icon: Calendar },
    { id: "UNPAID", label: isRtl ? "إجازة بدون راتب" : "Unpaid Leave", icon: PlusSquare },
    { id: "WORK_FROM_HOME", label: isRtl ? "عمل من المنزل" : "Work from Home", icon: Home }
  ];

  const durationsList = [
    { id: "Full Day", label: isRtl ? "يوم كامل" : "Full Day" },
    { id: "Half Day (AM)", label: isRtl ? "نصف يوم (صباحي)" : "Half Day (AM)" },
    { id: "Half Day (PM)", label: isRtl ? "نصف يوم (مسائي)" : "Half Day (PM)" }
  ];

  const handleLeaveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const firebaseUser = auth.currentUser; if (!firebaseUser) return; try { await mutateLeaveRequest(firebaseUser, { action: "CREATE", userId: currentUser.id, category: leaveType, startDate, endDate, reason: leaveNotes }); setIsLeaveModalOpen(false); showToast(t.leaveSuccess); setLeaveNotes(""); await load(); } catch (error) { setLoadError(error instanceof Error ? error.message : "LEAVE_REQUEST_FAILED"); }
  };

  return (
    <div className="w-full max-w-7xl mx-auto p-4 md:p-8 text-slate-800 dark:text-slate-100" dir={isRtl ? "rtl" : "ltr"}>
      {/* Toast Notification */}
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

      {/* Top Header Row */}
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
          onClick={() => setIsLeaveModalOpen(true)}
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/80 text-slate-800 dark:text-slate-100 px-4 py-2 rounded-xl font-semibold text-xs flex items-center gap-2 shadow-xxs transition-colors cursor-pointer shrink-0"
        >
          <Calendar size={15} />
          <span>{t.requestLeave}</span>
        </button>
      </div>

      {/* 7-Day Horizontal Calendar Navigator (Screenshot 2 Exact Layout) */}
      <div className="flex items-center gap-2 mt-6">
        <button
          type="button"
          className="p-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer shrink-0"
        >
          <ChevronLeft size={18} className={isRtl ? "rotate-180" : ""} />
        </button>

        <div className="grid grid-cols-7 gap-2 sm:gap-3 flex-1 overflow-x-auto">
          {weekDays.map(day => {
            const isSelected = day.dayNum === selectedDate;
            const isTu23 = day.dayNum === "23";

            return (
              <div
                key={day.dayNum}
                onClick={() => setSelectedDate(day.dayNum)}
                className={`py-3 px-2 rounded-xl text-center flex flex-col items-center justify-center transition-all cursor-pointer relative min-w-[45px] sm:min-w-[70px] ${
                  isSelected
                    ? "bg-[#2563eb] text-white font-bold shadow-sm"
                    : isTu23
                    ? "bg-emerald-50 dark:bg-emerald-950/30 text-slate-800 dark:text-slate-200 font-semibold border border-emerald-100 dark:border-emerald-900/40"
                    : "bg-slate-100 dark:bg-slate-900/60 text-slate-700 dark:text-slate-300 font-medium hover:bg-slate-200/70 dark:hover:bg-slate-800"
                }`}
              >
                <span className={`text-[10px] uppercase tracking-wider ${isSelected ? "text-blue-100" : "text-slate-400 dark:text-slate-500"}`}>
                  {day.dayName}
                </span>
                <span className="text-base sm:text-lg mt-0.5">
                  {day.dayNum}
                </span>
                {day.hasDot && !isSelected && (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 absolute bottom-1.5" />
                )}
              </div>
            );
          })}
        </div>

        <button
          type="button"
          className="p-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer shrink-0"
        >
          <ChevronRight size={18} className={isRtl ? "rotate-180" : ""} />
        </button>
      </div>

      {/* 4 Stats Cards Row (Screenshot 2 Exact Layout) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-5">
        {/* Total Hours */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200/80 dark:border-slate-800 flex items-center gap-3.5 shadow-xxs">
          <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
            <Clock size={20} />
          </div>
          <div>
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 block">
              {t.totalHours}
            </span>
            <span className="text-lg font-bold text-slate-900 dark:text-white mt-0.5 block font-mono">
              {summary ? `${(summary.totalFieldMinutes / 60).toFixed(1)}h` : "0.0h"}
            </span>
          </div>
        </div>

        {/* Visits Completed */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200/80 dark:border-slate-800 flex items-center gap-3.5 shadow-xxs">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
            <CheckCircle2 size={20} />
          </div>
          <div>
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 block">
              {t.visitsCompleted}
            </span>
            <span className="text-lg font-bold text-slate-900 dark:text-white mt-0.5 block font-mono">
              0
            </span>
          </div>
        </div>

        {/* Break Time */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200/80 dark:border-slate-800 flex items-center gap-3.5 shadow-xxs">
          <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
            <Coffee size={20} />
          </div>
          <div>
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 block">
              {t.breakTime}
            </span>
            <span className="text-lg font-bold text-slate-900 dark:text-white mt-0.5 block font-mono">
              0m
            </span>
          </div>
        </div>

        {/* Travel Time */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200/80 dark:border-slate-800 flex items-center gap-3.5 shadow-xxs">
          <div className="w-10 h-10 rounded-xl bg-cyan-50 dark:bg-cyan-950/60 text-cyan-600 dark:text-cyan-400 flex items-center justify-center shrink-0">
            <Car size={20} />
          </div>
          <div>
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 block">
              {t.travelTime}
            </span>
            <span className="text-lg font-bold text-slate-900 dark:text-white mt-0.5 block font-mono">
              0m
            </span>
          </div>
        </div>
      </div>

      {/* Monthly Effectiveness Card (Screenshot 2 Exact Layout) */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200/80 dark:border-slate-800 mt-5 shadow-xxs">
        <h2 className="text-xs font-bold text-slate-700 dark:text-slate-300">
          {t.monthlyEffectiveness}
        </h2>
        
        <div className="flex items-baseline gap-2 mt-2">
          <span className="text-3xl font-extrabold text-[#2563eb] font-mono tracking-tight">
            {effectiveness}%
          </span>
          <span className="text-xs text-slate-400 font-medium">
            {t.monthLabel}
          </span>
        </div>

        {/* Progress Bar Row */}
        <div className="w-full h-1 bg-slate-100 dark:bg-slate-800 rounded-full mt-4 overflow-hidden">
          <div className="h-full bg-[#2563eb]" style={{ width: `${Math.min(100, effectiveness)}%` }} />
        </div>

        {/* Bottom Metrics Breakdown Row */}
        <div className="flex flex-wrap items-center justify-between gap-4 mt-4 text-xs font-medium pt-2">
          <span className="text-slate-500 dark:text-slate-400">
            {t.scheduled}: <strong className="text-slate-800 dark:text-slate-200 font-mono">{summary?.scheduledWorkingDays ?? 0}</strong>
          </span>
          <span className="text-emerald-600 dark:text-emerald-400">
            {t.worked}: <strong className="font-mono">{summary?.workedDays ?? 0}</strong>
          </span>
          <span className="text-amber-500 dark:text-amber-400">
            {t.leave}: <strong className="font-mono">{summary?.approvedLeaveDays ?? 0}</strong>
          </span>
        </div>
      </div>

      {/* Quick Actions Card (Screenshot 2 Exact Layout) */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200/80 dark:border-slate-800 mt-5 shadow-xxs">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">
            {t.quickActions}
          </h2>
          <span className="bg-emerald-600 text-white text-[10px] font-bold px-2.5 py-0.5 rounded tracking-wide uppercase">
            {todaySession?.actualCheckOut ? t.checkOut : todaySession ? t.onDuty : t.checkIn}
          </span>
        </div>

        {/* Banner */}
        <div className="mt-4 bg-blue-50/70 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900/50 text-blue-600 dark:text-blue-300 px-4 py-3 rounded-xl text-xs font-semibold">
          {loadError || (market ? `${market.normalWorkdayStart}–${market.normalWorkdayEnd} ${market.timezone}` : "Market attendance configuration required")}
        </div>

        {/* Check In / Check Out Side by Side Buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
          <button
            type="button"
            onClick={() => void attendanceAction("CHECK_IN")}
            disabled={busy || Boolean(todaySession) || !market}
            className="w-full py-6 bg-slate-100/90 dark:bg-slate-800/80 text-slate-400 dark:text-slate-500 rounded-xl flex flex-col items-center justify-center gap-2 cursor-pointer hover:bg-slate-200/70 dark:hover:bg-slate-800 transition-colors border border-slate-200/50 dark:border-slate-700/50"
          >
            <ArrowRight size={18} className="text-slate-400" />
            <span className="text-xs font-semibold">{t.checkIn}</span>
          </button>

          <button
            type="button"
            onClick={() => void attendanceAction("CHECK_OUT")}
            disabled={busy || !todaySession || Boolean(todaySession.actualCheckOut) || !market}
            className="w-full py-6 bg-slate-100/90 dark:bg-slate-800/80 text-slate-400 dark:text-slate-500 rounded-xl flex flex-col items-center justify-center gap-2 cursor-pointer hover:bg-slate-200/70 dark:hover:bg-slate-800 transition-colors border border-slate-200/50 dark:border-slate-700/50"
          >
            <ArrowRight size={18} className="text-slate-400 rotate-180" />
            <span className="text-xs font-semibold">{t.checkOut}</span>
          </button>
        </div>
      </div>

      {/* Activity Timeline Card (Screenshot 2 Exact Layout) */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200/80 dark:border-slate-800 mt-5 shadow-xxs">
        <h2 className="text-sm font-bold text-slate-900 dark:text-white mb-5">
          {t.activityTimeline}
        </h2>

        {/* Timeline List */}
        <div className="relative pl-2 space-y-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                <ArrowRight size={16} />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold text-slate-900 dark:text-white">
                    {currentUser.name || currentUser.email || currentUser.id} — {todaySession ? "Check In" : "Not Checked In"}
                  </span>
                  <span className="bg-rose-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded uppercase">
                    {t.logged}
                  </span>
                </div>
                <div className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  <MapPin size={13} className="text-slate-400 shrink-0" />
                  <span>{todaySession?.checkInLocation ? `${todaySession.checkInLocation.latitude.toFixed(5)}, ${todaySession.checkInLocation.longitude.toFixed(5)}` : "No attendance location recorded"}</span>
                </div>
              </div>
            </div>

            <span className="text-xs text-slate-400 font-mono shrink-0 pt-1">
              {todaySession?.actualCheckIn ? new Date(todaySession.actualCheckIn).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
            </span>
          </div>
        </div>
      </div>

      {/* Exact Replica Modal Dialog for Request Leave (Screenshots 3, 4, 5) */}
      <AnimatePresence>
        {isLeaveModalOpen && (
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
                  onClick={() => setIsLeaveModalOpen(false)}
                  className="absolute top-5 right-5 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg transition-colors cursor-pointer"
                >
                  <X size={18} />
                </button>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                  {t.leaveModalTitle}
                </h2>
              </div>

              {/* Form Content */}
              <form onSubmit={handleLeaveSubmit} className="px-6 py-4 overflow-y-auto space-y-4 flex-1 text-xs">
                {/* Leave Type */}
                <div className="relative">
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    {t.leaveTypeLabel}
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setIsLeaveTypeMenuOpen(!isLeaveTypeMenuOpen);
                      setIsDurationMenuOpen(false);
                    }}
                    className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-950 border border-[#2563eb] rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-100 focus:outline-none shadow-xxs flex items-center justify-between cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <Calendar size={16} className="text-slate-700 dark:text-slate-300" />
                      <span>{leaveTypesList.find(l => l.id === leaveType)?.label}</span>
                    </div>
                    <ChevronDown size={15} className="text-slate-400" />
                  </button>

                  {/* Screenshot 4 Exact Leave Type Visual Dropdown */}
                  <AnimatePresence>
                    {isLeaveTypeMenuOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 4 }}
                        className="absolute left-0 right-0 top-full mt-1.5 bg-slate-100/95 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-30 p-2 space-y-1 text-xs backdrop-blur-md"
                      >
                        {leaveTypesList.map(item => {
                          const isSelected = leaveType === item.id;
                          const IconComp = item.icon;
                          return (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => {
                                setLeaveType(item.id);
                                setIsLeaveTypeMenuOpen(false);
                              }}
                              className={`w-full px-3 py-2 rounded-lg text-left flex items-center gap-2.5 transition-colors cursor-pointer ${
                                isSelected ? "font-bold text-slate-900 dark:text-white" : "text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-700"
                              }`}
                            >
                              <span className="w-4 flex items-center justify-center">
                                {isSelected ? <Check size={14} className="text-slate-900 dark:text-white" /> : <IconComp size={15} className="text-slate-600 dark:text-slate-400" />}
                              </span>
                              <span>{item.label}</span>
                            </button>
                          );
                        })}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Duration */}
                <div className="relative">
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    {t.durationLabel}
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setIsDurationMenuOpen(!isDurationMenuOpen);
                      setIsLeaveTypeMenuOpen(false);
                    }}
                    className={`w-full px-3.5 py-2.5 bg-white dark:bg-slate-950 border rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-100 focus:outline-none shadow-xxs flex items-center justify-between cursor-pointer ${
                      isDurationMenuOpen ? "border-[#2563eb]" : "border-slate-200 dark:border-slate-800"
                    }`}
                  >
                    <span>{durationsList.find(d => d.id === duration)?.label}</span>
                    <ChevronDown size={15} className="text-slate-400" />
                  </button>

                  {/* Screenshot 5 Exact Duration Visual Dropdown */}
                  <AnimatePresence>
                    {isDurationMenuOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 4 }}
                        className="absolute left-0 right-0 top-full mt-1.5 bg-slate-100/95 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-30 p-2 space-y-1 text-xs backdrop-blur-md"
                      >
                        {durationsList.map(item => {
                          const isSelected = duration === item.id;
                          return (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => {
                                setDuration(item.id);
                                setIsDurationMenuOpen(false);
                              }}
                              className={`w-full px-3 py-2 rounded-lg text-left flex items-center gap-2.5 transition-colors cursor-pointer ${
                                isSelected ? "font-bold text-slate-900 dark:text-white" : "text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-700"
                              }`}
                            >
                              <span className="w-4 flex items-center justify-center">
                                {isSelected && <Check size={14} className="text-slate-900 dark:text-white" />}
                              </span>
                              <span>{item.label}</span>
                            </button>
                          );
                        })}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Start Date & End Date Row (Screenshot 3 Exact Layout) */}
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                      {t.startDateLabel}
                    </label>
                    <div className="relative">
                      <input
                        type="date"
                        value={startDate}
                        onChange={e => setStartDate(e.target.value)}
                        className="w-full px-3 py-2.5 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none shadow-xxs pr-9"
                      />
                      <Calendar size={14} className="absolute right-3 top-3 text-slate-800 dark:text-slate-200 pointer-events-none" />
                    </div>
                  </div>

                  <div>
                    <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                      {t.endDateLabel}
                    </label>
                    <div className="relative">
                      <input
                        type="date"
                        value={endDate}
                        onChange={e => setEndDate(e.target.value)}
                        className="w-full px-3 py-2.5 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none shadow-xxs pr-9"
                      />
                      <Calendar size={14} className="absolute right-3 top-3 text-slate-800 dark:text-slate-200 pointer-events-none" />
                    </div>
                  </div>
                </div>

                {/* Notes Textarea (Screenshot 3 Exact Layout) */}
                <div className="pt-1">
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    {t.notesLabel}
                  </label>
                  <textarea
                    rows={3}
                    value={leaveNotes}
                    onChange={e => setLeaveNotes(e.target.value)}
                    placeholder={t.notesPlaceholder}
                    className="w-full p-3 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-blue-500 shadow-xxs resize-none"
                  />
                </div>

                {/* Footer Actions */}
                <div className="flex items-center justify-end gap-3 pt-5 pb-1 border-t border-slate-100 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setIsLeaveModalOpen(false)}
                    className="px-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-semibold cursor-pointer transition-colors shadow-xxs"
                  >
                    {t.cancel}
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2.5 bg-[#2563eb] hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-sm cursor-pointer transition-colors"
                  >
                    {t.submitRequest}
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
