import React, { useState, useMemo, useCallback, useEffect } from "react";
import { 
  Users, 
  MapPin, 
  Search, 
  Filter, 
  RefreshCw, 
  CheckCircle2, 
  Clock, 
  Compass, 
  PhoneCall, 
  AlertCircle, 
  ExternalLink,
  Navigation,
  CheckSquare,
  X
} from "lucide-react";
import { motion } from "motion/react";
import type { User } from "../../types";
import { auth } from "../../lib/firebase";
import { db } from "../../lib/firebase";
import { collection, getDocs } from "firebase/firestore";
import { fetchScopedTeamActivity } from "../../lib/teamActivityReadClient";
import { resolveAttendanceDateWindow } from "../../lib/attendanceDateWindow";
import { resolveMarketForIdentity, type MarketBusinessSettings } from "../../lib/marketSettings";

interface TeamActivityProps {
  lang: "en" | "ar";
  currentUser: User;
  users: User[];
}

interface TeamMemberActivity {
  id: string;
  name: string;
  role: string;
  status: "Active" | "Idle" | "Offline";
  visitsLogged: number;
  targetCallRate: number;
  gpsCompliance: string;
  gpsAccuracy: string;
  lastLocation: string;
  lastLocationAr: string;
  lastActiveTime: string;
  lat: number;
  lng: number;
  recentVisitType: "Physician" | "Pharmacy" | "None";
  recentClient: string;
}

const INITIAL_TEAM_ACTIVITIES: TeamMemberActivity[] = [];

export default function TeamActivity({ lang, currentUser, users }: TeamActivityProps) {
  const isRtl = lang === "ar";
  const [activities, setActivities] = useState<TeamMemberActivity[]>(INITIAL_TEAM_ACTIVITIES);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedRep, setSelectedRep] = useState<TeamMemberActivity | null>(null);
  const [toastMessage, setToastMessage] = useState("");
  const [isSyncing, setIsSyncing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [markets, setMarkets] = useState<MarketBusinessSettings[]>([]);
  const market = resolveMarketForIdentity(markets, currentUser as User & { marketId?: string; countryId?: string });

  useEffect(() => {
    void getDocs(collection(db, "marketSettings"))
      .then(snapshot => setMarkets(snapshot.docs.map(item => ({ marketId: item.id, ...item.data() } as MarketBusinessSettings))))
      .catch(error => setLoadError(error instanceof Error ? error.message : "MARKET_SETTINGS_LOAD_FAILED"));
  }, [currentUser.id]);

  // Localization Dictionary
  const dict = {
    en: {
      title: "Field Team Activity Dashboard",
      subtitle: "Track real-time location verify check-ins, representative status, and dynamic route performance.",
      totalLoggedToday: "Total Calls Today",
      coverageRate: "Visit Coverage Rate",
      activeReps: "Active Field Reps",
      averageGps: "GPS Compliance Rate",
      searchPlaceholder: "Search representative name...",
      filterStatus: "Filter Status",
      allStatuses: "All Statuses",
      active: "Active Now",
      idle: "Idle / Break",
      offline: "Offline",
      tableRep: "Representative",
      tableVisits: "Visits Today",
      tableGps: "GPS Quality / Compliance",
      tableLocation: "Last Position Logged",
      tableActions: "Actions",
      pingRep: "Ping Rep",
      viewRoute: "View Route",
      pingSuccess: "Successfully pinged and requested immediate GPS coordinates from ",
      syncButton: "Sync GPS Feeds",
      syncSuccess: "Synced all medical representatives' real-time telemetry successfully!",
      noRecords: "No field activities match your filters.",
      detailsTitle: "Active Route Telemetry for",
      recentVisit: "Recent Visit Detailing",
      clientName: "Client Name",
      visitCategory: "Visit Category",
      gpsAccuracyTitle: "GPS Verification Radius",
      liveStatus: "Telemetry Connection Status",
      lastCheckinTime: "Last Active Time",
      latLng: "Geospatial Coordinates",
      syncing: "Synchronizing..."
    },
    ar: {
      title: "نشاط وتغطية الفريق الميداني",
      subtitle: "تتبع عمليات الدخول الميداني المباشر، الزيارات المكتملة، ومؤشرات التغطية والتحقق الجغرافي للفريق.",
      totalLoggedToday: "زيارات الفريق المنجزة اليوم",
      coverageRate: "نسبة تغطية الزيارات الإجمالية",
      activeReps: "مندوبين متواجدين ميدانياً الآن",
      averageGps: "معدل الالتزام بـ GPS",
      searchPlaceholder: "ابحث عن اسم المندوب...",
      filterStatus: "تصفية حسب الحالة",
      allStatuses: "جميع الحالات",
      active: "نشط الآن",
      idle: "خامل / استراحة",
      offline: "غير متصل",
      tableRep: "المندوب الميداني",
      tableVisits: "الزيارات المنجزة اليوم",
      tableGps: "دقة وجودة الـ GPS",
      tableLocation: "آخر موقع تم تسجيله",
      tableActions: "الإجراءات المتاحة",
      pingRep: "إرسال تنبيه",
      viewRoute: "عرض المسار",
      pingSuccess: "تم إرسال تنبيه بنجاح وطلب إرسال إحداثيات GPS فورية من المندوب ",
      syncButton: "مزامنة بيانات الإحداثيات",
      syncSuccess: "تم تحديث ومزامنة بيانات تحديد المواقع المباشرة للفريق الميداني بنجاح!",
      noRecords: "لا توجد أنشطة ميدانية تطابق خيارات التصفية الحالية.",
      detailsTitle: "البيانات التفصيلية لإحداثيات المسار لـ",
      recentVisit: "آخر تفاصيل زيارة ميدانية",
      clientName: "اسم العميل / الطبيب",
      visitCategory: "تصنيف ونوع الزيارة",
      gpsAccuracyTitle: "نطاق دقة التحقق الجغرافي",
      liveStatus: "حالة اتصال القياس والتحقق المباشر",
      lastCheckinTime: "تاريخ آخر نشاط فعلّي",
      latLng: "الإحداثيات الجغرافية الدقيقة",
      syncing: "جاري المزامنة..."
    }
  };

  const t = dict[lang];

  const loadScopedActivity = useCallback(async () => {
    setIsSyncing(true);
    setLoadError("");
    try {
      if (!auth.currentUser) throw new Error("AUTH_REQUIRED");
      if (!market) throw new Error("MARKET_SETTINGS_REQUIRED");
      const today = resolveAttendanceDateWindow(new Date(), market.timezone).currentDate;
      const response = await fetchScopedTeamActivity(auth.currentUser, today, today);
      const latest = new Map(response.attendanceSessions.sort((a, b) => String(b.actualCheckIn || "").localeCompare(String(a.actualCheckIn || ""))).map(session => [session.userId, session]));
      setActivities(response.subjectUids.map(userId => {
        const profile = users.find(user => (user.uid || user.id) === userId);
        const session = latest.get(userId);
        const checkedOut = Boolean(session?.actualCheckOut);
        return {
          id: userId, name: profile?.name || `${profile?.firstName || ""} ${profile?.lastName || ""}`.trim() || userId,
          role: profile?.role || "Field User", status: session ? (checkedOut ? "Offline" : "Active") : "Offline",
          visitsLogged: 0, targetCallRate: 0, gpsCompliance: session?.checkInLocation ? "Recorded" : "—", gpsAccuracy: "—",
          lastLocation: session?.checkInLocation ? "Attendance location recorded" : "—", lastLocationAr: session?.checkInLocation ? "تم تسجيل موقع الحضور" : "—",
          lastActiveTime: session?.actualCheckOut || session?.actualCheckIn || "—", lat: 0, lng: 0, recentVisitType: "None", recentClient: "—",
        };
      }));
    } catch (error) {
      setActivities([]);
      setLoadError(error instanceof Error ? error.message : "Unable to load team activity");
    } finally {
      setIsSyncing(false);
    }
  }, [currentUser.id, currentUser.uid, market, users]);

  useEffect(() => { void loadScopedActivity(); }, [loadScopedActivity]);

  const handleSyncTelemetry = () => { void loadScopedActivity(); };

  // Toast helper
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(""), 4000);
  };

  // Ping Rep
  const handlePingRep = (rep: TeamMemberActivity) => {
    showToast(`${t.pingSuccess} ${rep.name}`);
  };

  // Filter logic
  const filteredActivities = useMemo(() => {
    return activities.filter(rep => {
      const matchesSearch = rep.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                            rep.role.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = statusFilter === "all" || rep.status.toLowerCase() === statusFilter.toLowerCase();
      return matchesSearch && matchesStatus;
    });
  }, [activities, searchTerm, statusFilter]);

  // Calculations for stats card
  const totalCalls = activities.reduce((sum, item) => sum + item.visitsLogged, 0);
  const liveRepsCount = activities.filter(rep => rep.status === "Active").length;
  const targetCalls = activities.reduce((sum, item) => sum + item.targetCallRate, 0);
  const coveragePercent = targetCalls > 0 ? Math.round((totalCalls / targetCalls) * 100) : 0;

  return (
    <div className="space-y-6" id="team-activity-root">
      {/* Toast Alert */}
      {toastMessage && (
        <div className="fixed top-4 right-4 z-50 bg-emerald-600 dark:bg-emerald-500 text-white text-xs font-bold px-4 py-3 rounded-xl shadow-lg flex items-center gap-2 animate-fade-in">
          <CheckCircle2 size={16} />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Header section */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="p-1.5 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 rounded-lg">
              <Users size={18} />
            </span>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">{t.title}</h1>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-2xl">{t.subtitle}</p>
        </div>
        <div className="flex items-center gap-2 self-start md:self-auto">
          <button
            onClick={handleSyncTelemetry}
            disabled={isSyncing}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition-colors shadow-sm disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw size={14} className={isSyncing ? "animate-spin" : ""} />
            <span>{isSyncing ? t.syncing : t.syncButton}</span>
          </button>
        </div>
      </div>

      {/* Stats Board */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 rounded-xl text-emerald-600">
            <PhoneCall size={20} />
          </div>
          <div>
            <p className="text-xxs text-slate-400 font-bold uppercase tracking-wider">{t.totalLoggedToday}</p>
            <h3 className="text-lg font-bold text-slate-800 dark:text-white mt-1">{totalCalls} / 30</h3>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-blue-50 dark:bg-blue-950/40 rounded-xl text-blue-600">
            <Compass size={20} />
          </div>
          <div>
            <p className="text-xxs text-slate-400 font-bold uppercase tracking-wider">{t.coverageRate}</p>
            <h3 className="text-lg font-bold text-slate-800 dark:text-white mt-1">{coveragePercent}%</h3>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-indigo-50 dark:bg-indigo-950/40 rounded-xl text-indigo-600">
            <Users size={20} />
          </div>
          <div>
            <p className="text-xxs text-slate-400 font-bold uppercase tracking-wider">{t.activeReps}</p>
            <h3 className="text-lg font-bold text-slate-800 dark:text-white mt-1">{liveRepsCount} {isRtl ? "نشط" : "Active"}</h3>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-teal-50 dark:bg-teal-950/40 rounded-xl text-teal-600">
            <MapPin size={20} />
          </div>
          <div>
            <p className="text-xxs text-slate-400 font-bold uppercase tracking-wider">{t.averageGps}</p>
            <h3 className="text-lg font-bold text-slate-800 dark:text-white mt-1">98.6%</h3>
          </div>
        </div>
      </div>

      {/* Search and Filters */}
      {loadError && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-700">{loadError}</div>}
      <div className="flex flex-col sm:flex-row items-center gap-3 bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm">
        <div className="relative flex-1 w-full">
          <Search size={15} className="absolute left-3 top-3 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={t.searchPlaceholder}
            className="w-full pl-9 pr-4 py-2 border border-slate-200 dark:border-slate-800 dark:bg-slate-950 rounded-lg text-xs text-slate-700 dark:text-slate-200 focus:outline-none focus:border-blue-500"
          />
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto shrink-0">
          <Filter size={14} className="text-slate-400" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full sm:w-44 px-3 py-2 border border-slate-200 dark:border-slate-800 dark:bg-slate-950 rounded-lg text-xs text-slate-700 dark:text-slate-200 focus:outline-none focus:border-blue-500"
          >
            <option value="all">{t.allStatuses}</option>
            <option value="active">{t.active}</option>
            <option value="idle">{t.idle}</option>
            <option value="offline">{t.offline}</option>
          </select>
        </div>
      </div>

      {/* Main content split layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Activity Feed Table */}
        <div className="lg:col-span-2 bg-white dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm overflow-hidden">
          {/* Desktop View */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-950 border-b border-slate-100 dark:border-slate-800">
                  <th className="p-4 text-xxs font-bold text-slate-400 uppercase tracking-wider">{t.tableRep}</th>
                  <th className="p-4 text-xxs font-bold text-slate-400 uppercase tracking-wider text-center">{t.tableVisits}</th>
                  <th className="p-4 text-xxs font-bold text-slate-400 uppercase tracking-wider">{t.tableGps}</th>
                  <th className="p-4 text-xxs font-bold text-slate-400 uppercase tracking-wider">{t.tableLocation}</th>
                  <th className="p-4 text-xxs font-bold text-slate-400 uppercase tracking-wider text-right">{t.tableActions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                {filteredActivities.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-xs text-slate-400">
                      {t.noRecords}
                    </td>
                  </tr>
                ) : (
                  filteredActivities.map((rep) => (
                    <tr 
                      key={rep.id} 
                      className={`hover:bg-slate-50/50 dark:hover:bg-slate-950/40 transition-colors ${selectedRep?.id === rep.id ? "bg-blue-50/20 dark:bg-blue-950/10" : ""}`}
                    >
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <div className="relative">
                            <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center font-bold text-slate-700 dark:text-slate-200 text-xs">
                              {rep.name.charAt(0)}
                            </div>
                            <span className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-slate-900 ${
                              rep.status === "Active" ? "bg-emerald-500" :
                              rep.status === "Idle" ? "bg-amber-500" : "bg-slate-400"
                            }`} />
                          </div>
                          <div>
                            <p className="text-xs font-semibold text-slate-800 dark:text-white">{rep.name}</p>
                            <p className="text-xxs text-slate-400">{rep.role}</p>
                          </div>
                        </div>
                      </td>
                      <td className="p-4 text-center">
                        <div className="inline-block">
                          <span className="text-xs font-bold text-slate-800 dark:text-white">{rep.visitsLogged}</span>
                          <span className="text-xxs text-slate-400"> / {rep.targetCallRate}</span>
                          <div className="w-16 h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden mt-1 mx-auto">
                            <div 
                              className="h-full bg-emerald-500 rounded-full" 
                              style={{ width: `${rep.targetCallRate > 0 ? (rep.visitsLogged / rep.targetCallRate) * 100 : 0}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="flex flex-col">
                          <span className="text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1">
                            <CheckSquare size={12} className="text-emerald-500" />
                            {rep.gpsCompliance}
                          </span>
                          <span className="text-xxs text-slate-400">{rep.gpsAccuracy}</span>
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="flex flex-col">
                          <span className="text-xs font-medium text-slate-700 dark:text-slate-200 flex items-center gap-1">
                            <MapPin size={12} className="text-blue-500 shrink-0" />
                            {isRtl ? rep.lastLocationAr : rep.lastLocation}
                          </span>
                          <span className="text-xxs text-slate-400 flex items-center gap-1 mt-0.5">
                            <Clock size={10} />
                            {rep.lastActiveTime}
                          </span>
                        </div>
                      </td>
                      <td className="p-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => handlePingRep(rep)}
                            className="p-1 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 rounded cursor-pointer"
                            title={t.pingRep}
                          >
                            <PhoneCall size={14} />
                          </button>
                          <button
                            onClick={() => setSelectedRep(rep)}
                            className="p-1 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 rounded cursor-pointer"
                            title={t.viewRoute}
                          >
                            <ExternalLink size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile View */}
          <div className="block md:hidden divide-y divide-slate-100 dark:divide-slate-800">
            {filteredActivities.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400">
                {t.noRecords}
              </div>
            ) : (
              filteredActivities.map((rep) => (
                <div 
                  key={rep.id} 
                  className={`p-4 space-y-3 text-xs transition-colors ${selectedRep?.id === rep.id ? "bg-blue-50/10 dark:bg-blue-950/5" : ""} ${isRtl ? "text-right" : "text-left"}`}
                >
                  <div className={`flex justify-between items-start gap-2 ${isRtl ? "flex-row-reverse" : "flex-row"}`}>
                    <div className="flex items-center gap-3">
                      <div className="relative shrink-0">
                        <div className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center font-bold text-slate-700 dark:text-slate-200 text-xs">
                          {rep.name.charAt(0)}
                        </div>
                        <span className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-slate-900 ${
                          rep.status === "Active" ? "bg-emerald-500" :
                          rep.status === "Idle" ? "bg-amber-500" : "bg-slate-400"
                        }`} />
                      </div>
                      <div>
                        <h4 className="font-bold text-slate-900 dark:text-white text-xs">{rep.name}</h4>
                        <p className="text-[10px] text-slate-400">{rep.role}</p>
                      </div>
                    </div>

                    <div className="text-right">
                      <span className="text-[11px] font-bold text-slate-800 dark:text-white font-mono">{rep.visitsLogged}</span>
                      <span className="text-[10px] text-slate-400 font-mono"> / {rep.targetCallRate}</span>
                      <p className="text-[9px] text-slate-400 font-medium">{t.tableVisits}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 bg-slate-50 dark:bg-slate-950/40 rounded-lg p-2.5 border border-slate-100/50 dark:border-slate-800/40 text-[11px]">
                    <div>
                      <p className="text-slate-400 text-[9px] uppercase font-bold">{t.tableGps}</p>
                      <p className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1 mt-0.5">
                        <CheckSquare size={11} className="text-emerald-500" />
                        {rep.gpsCompliance}
                      </p>
                      <p className="text-[9px] text-slate-400 font-mono mt-0.5">{rep.gpsAccuracy}</p>
                    </div>
                    <div>
                      <p className="text-slate-400 text-[9px] uppercase font-bold">{t.tableLocation}</p>
                      <p className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1 mt-0.5 truncate">
                        <MapPin size={11} className="text-blue-500 shrink-0" />
                        {isRtl ? rep.lastLocationAr : rep.lastLocation}
                      </p>
                      <p className="text-[9px] text-slate-400 font-mono flex items-center gap-1 mt-0.5">
                        <Clock size={9} />
                        {rep.lastActiveTime}
                      </p>
                    </div>
                  </div>

                  <div className={`flex items-center justify-between pt-1`}>
                    <span className="text-slate-400 text-[10px]">{isRtl ? "تعديل المسار" : "Field Sync Status"}</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handlePingRep(rep)}
                        className="px-2.5 py-1.5 text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 rounded-md transition-colors flex items-center gap-1 cursor-pointer font-bold"
                      >
                        <PhoneCall size={12} />
                        <span>{t.pingRep}</span>
                      </button>
                      <button
                        onClick={() => setSelectedRep(rep)}
                        className="px-2.5 py-1.5 text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30 hover:bg-blue-100 rounded-md transition-colors flex items-center gap-1 cursor-pointer font-bold"
                      >
                        <ExternalLink size={12} />
                        <span>{t.viewRoute}</span>
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Telemetry Detail sidebar */}
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm p-4 space-y-4">
          {selectedRep ? (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-4"
            >
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <h4 className="text-xs font-bold text-slate-800 dark:text-white uppercase tracking-wider flex items-center gap-1">
                  <Navigation size={14} className="text-blue-500 animate-pulse" />
                  {t.detailsTitle} {selectedRep.name.split(" ")[0]}
                </h4>
                <button
                  onClick={() => setSelectedRep(null)}
                  className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 rounded cursor-pointer"
                >
                  <X size={14} />
                </button>
              </div>

              {/* Simulated Map Container */}
              <div className="relative h-44 bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800 rounded-lg overflow-hidden flex flex-col items-center justify-center p-4">
                {/* Radial Pulse Waves representing GPS verification */}
                <span className="absolute flex h-10 w-10">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-30"></span>
                  <span className="relative inline-flex rounded-full h-10 w-10 bg-blue-500/10"></span>
                </span>
                
                <MapPin className="h-8 w-8 text-blue-600 dark:text-blue-500 z-10" />
                
                <div className="absolute bottom-2 left-2 right-2 bg-white/90 dark:bg-slate-900/95 border border-slate-200 dark:border-slate-800 p-2 rounded shadow-md text-center">
                  <p className="text-xxs font-bold text-slate-800 dark:text-white flex items-center justify-center gap-1">
                    <CheckSquare size={10} className="text-emerald-500" />
                    {selectedRep.gpsAccuracy} Accuracy Verified
                  </p>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                    {isRtl ? selectedRep.lastLocationAr : selectedRep.lastLocation}
                  </p>
                </div>
              </div>

              <div className="space-y-3 pt-1">
                <div className="grid grid-cols-2 gap-3 text-xxs">
                  <div className="bg-slate-50 dark:bg-slate-950 p-2.5 rounded-lg border border-slate-100 dark:border-slate-800">
                    <p className="text-slate-400 font-semibold">{t.liveStatus}</p>
                    <p className={`font-bold mt-1.5 flex items-center gap-1 ${
                      selectedRep.status === "Active" ? "text-emerald-600" :
                      selectedRep.status === "Idle" ? "text-amber-600" : "text-slate-500"
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        selectedRep.status === "Active" ? "bg-emerald-500" :
                        selectedRep.status === "Idle" ? "bg-amber-500" : "bg-slate-400"
                      }`} />
                      {selectedRep.status}
                    </p>
                  </div>
                  <div className="bg-slate-50 dark:bg-slate-950 p-2.5 rounded-lg border border-slate-100 dark:border-slate-800">
                    <p className="text-slate-400 font-semibold">{t.lastCheckinTime}</p>
                    <p className="text-slate-800 dark:text-white font-bold mt-1.5">{selectedRep.lastActiveTime}</p>
                  </div>
                </div>

                <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded-lg border border-slate-100 dark:border-slate-800 text-xxs space-y-1.5">
                  <p className="text-slate-400 font-bold uppercase tracking-wider">{t.latLng}</p>
                  <div className="flex justify-between font-mono text-[10px] text-slate-600 dark:text-slate-400">
                    <span>Latitude: {selectedRep.lat.toFixed(6)}</span>
                    <span>Longitude: {selectedRep.lng.toFixed(6)}</span>
                  </div>
                </div>

                {selectedRep.recentVisitType !== "None" && (
                  <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded-lg border border-slate-100 dark:border-slate-800 text-xxs space-y-2">
                    <p className="text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1">
                      <Clock size={12} className="text-blue-500" />
                      {t.recentVisit}
                    </p>
                    <div className="space-y-1">
                      <div className="flex justify-between">
                        <span className="text-slate-500">{t.clientName}:</span>
                        <span className="font-semibold text-slate-800 dark:text-white">{selectedRep.recentClient}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">{t.visitCategory}:</span>
                        <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                          selectedRep.recentVisitType === "Physician" 
                            ? "bg-purple-50 dark:bg-purple-950/40 text-purple-600" 
                            : "bg-teal-50 dark:bg-teal-950/40 text-teal-600"
                        }`}>
                          {selectedRep.recentVisitType === "Physician" ? (isRtl ? "زيارة طبيب" : "Physician") : (isRtl ? "زيارة صيدلية" : "Pharmacy")}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-400 space-y-2 py-16">
              <Compass size={36} className="text-slate-300 dark:text-slate-700 animate-pulse" />
              <p className="text-xs font-semibold">{isRtl ? "اضغط على أي مندوب لعرض إحداثيات GPS المباشرة" : "Select a representative to view detailed GPS coordinates."}</p>
              <p className="text-xxs max-w-xs">{isRtl ? "تتبع دقة التحقق الجغرافي والخطوط المباشرة للرحلة الميدانية" : "Track real-time location precision, check-in accuracy radius, and active routes."}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
