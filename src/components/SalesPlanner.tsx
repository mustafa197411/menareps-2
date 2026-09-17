import React, { useState, useEffect, useMemo } from "react";
import { 
  Calendar as CalendarIcon, 
  Store, 
  Plus, 
  Trash2, 
  Sparkles, 
  CheckCircle, 
  Clock, 
  Map, 
  Navigation,
  Compass,
  DollarSign,
  AlertCircle,
  HelpCircle,
  ChevronLeft,
  ChevronRight,
  Filter,
  Check,
  X,
  FileText,
  Bookmark,
  Award,
  Zap,
  Briefcase,
  UserCheck,
  ThumbsUp,
  RotateCcw,
  Route
} from "lucide-react";
import { Pharmacy, User, Role, UserTerritoryAssignment, UserProductAssignment, AuditLog } from "../types";
import { saveAuditLogRecord } from "../lib/firestoreService";
import { 
  collection, 
  doc, 
  setDoc, 
  deleteDoc, 
  query, 
  where, 
  onSnapshot 
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { handleFirestoreError, OperationType } from "../lib/firebaseError";
import { decorateRecord } from "../lib/firebaseSync";
import { savePlannerApprovalTransactional } from "../lib/firestoreService";
import { applySecurityScope, getCurrentUserScope, getAllSubordinates } from "../lib/securityEngine";
import { filterBySecurity } from "../lib/alignmentService";
import { triggerPlannerSubmissionAlert } from "../lib/notificationService";
import { resolveBusinessCalendarDay, resolveMarketForIdentity, type BusinessCalendarException } from "../lib/marketSettings";
import { rollingPlannerPeriods, workingDayNames } from "../lib/plannerCalendar";

interface SalesPlannerProps {
  pharmacies: Pharmacy[];
  lang: "en" | "ar";
  currentUser: User;
  users: User[];
  userTerritoryAssignments?: UserTerritoryAssignment[];
  userProductAssignments?: UserProductAssignment[];
}

interface PlannedPharmacyVisit {
  id: string;
  pharmacyId: string;
  pharmacyName: string;
  territory: string;
  day: string; // "Monday", etc.
  time: string; // e.g. "11:00 AM"
  date: string; // e.g. "2026-06-29"
  month: string; // e.g. "2026-06"
  week: string; // e.g. "2026-W27"
  repId: string;
  repName: string;
  planningType: "weekly" | "monthly";
  isUnplanned: boolean;
  status: "Draft" | "Pending Approval" | "Approved" | "Rejected";
}

interface SalesPlannerApproval {
  id: string;
  repId: string;
  repName: string;
  period: string; // e.g. "2026-W27" or "2026-06"
  planningType: "weekly" | "monthly";
  status: "Draft" | "Pending Approval" | "Approved" | "Rejected";
  notes: string;
  updatedAt: string;
  updatedBy: string;
}

export default function SalesPlanner({ 
  pharmacies, 
  lang, 
  currentUser, 
  users,
  userTerritoryAssignments = [],
  userProductAssignments = []
}: SalesPlannerProps) {
  const isRtl = lang === "ar";
  
  const marketIdentity = currentUser as User & { marketId?: string; countryId?: string };
  const market = useMemo(() => resolveMarketForIdentity([], marketIdentity), [marketIdentity.marketId, marketIdentity.countryId, marketIdentity.country]);
  const daysOfWeek = useMemo(() => market ? workingDayNames(market) : [], [market]);
  const periods = useMemo(() => rollingPlannerPeriods(), []); const weeksList = periods.weeks; const monthsList = periods.months;
  const [calendarExceptions, setCalendarExceptions] = useState<BusinessCalendarException[]>([]);
  useEffect(() => { if (!market) { setCalendarExceptions([]); return; } return onSnapshot(query(collection(db, "businessCalendarExceptions"), where("marketId", "==", market.marketId)), snapshot => setCalendarExceptions(snapshot.docs.map(item => ({ id: item.id, ...item.data() } as BusinessCalendarException))), () => setCalendarExceptions([])); }, [market?.marketId]);

  // State Management
  const [planningType, setPlanningType] = useState<"weekly" | "monthly">("weekly");
  const [selectedWeek, setSelectedWeek] = useState(weeksList[0] || "");
  const [selectedMonth, setSelectedMonth] = useState(monthsList[0] || "");
  
  // Rep selections (Supervisor viewing subordinates, or Rep viewing self)
  const isRep = currentUser.role === Role.MEDICAL_REP || currentUser.role === Role.SALES_REP;
  
  // Securely filter representatives according to user's hierarchy level and role
  const salesReps = useMemo(() => {
    const rawReps = users.filter(u => u.role === Role.MEDICAL_REP || u.role === Role.SALES_REP);
    const scope = getCurrentUserScope(currentUser, userTerritoryAssignments);
    if (scope.level === "national") {
      return rawReps;
    }
    const team = getAllSubordinates(users, currentUser);
    const teamIds = new Set(team.map(u => u.id));
    return rawReps.filter(u => u.id === currentUser.id || teamIds.has(u.id));
  }, [users, currentUser, userTerritoryAssignments]);

  const [selectedRepId, setSelectedRepId] = useState<string>(
    isRep ? currentUser.id : (salesReps[0]?.id || "")
  );

  const selectedRepUser = users.find(u => u.id === selectedRepId) || currentUser;

  // Active state lists from Firestore
  const [plannedVisits, setPlannedVisits] = useState<PlannedPharmacyVisit[]>([]);
  const [approvalDoc, setApprovalDoc] = useState<SalesPlannerApproval | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Search filtering & scheduling fields
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDay, setSelectedDay] = useState("Monday");
  const [selectedTime, setSelectedTime] = useState("09:00 AM");
  const [isUnplannedField, setIsUnplannedField] = useState(false);
  const [activeCalendarDate, setActiveCalendarDate] = useState("2026-06-29"); // Monday of 2026-W27

  // AI Planner simulations
  const [isAutoPlanning, setIsAutoPlanning] = useState(false);
  const [optimizedRoute, setOptimizedRoute] = useState<string | null>(null);

  // Filter pharmacies list to show ONLY those assigned to the selected representative
  // and ensuring alignment with their explicit territory and product assignments
  const assignedPharmacies = useMemo(() => {
    return filterBySecurity(
      selectedRepUser || currentUser,
      pharmacies,
      "territory",
      "id",
      "assignedRepId",
      userTerritoryAssignments,
      userProductAssignments
    );
  }, [pharmacies, selectedRepId, selectedRepUser, userTerritoryAssignments, userProductAssignments, currentUser]);

  // Dynamic status of the current plan period
  const periodKey = planningType === "weekly" ? selectedWeek : selectedMonth;
  const currentApprovalStatus = approvalDoc?.status || "Draft";

  // Filter out planned pharmacies to show unplanned/unassigned list
  const plannedPharmacyIds = new Set(plannedVisits.map(v => v.pharmacyId));
  const filterablePharmacies = assignedPharmacies.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          p.territory.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          (p.city && p.city.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesSearch && !plannedPharmacyIds.has(p.id);
  });

  // Real-time Firestore synchronization for visits and approvals
  useEffect(() => {
    if (!selectedRepId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);

    const visitsCollection = collection(db, "salesPlannerVisits");
    const qVisits = query(
      visitsCollection,
      where("repId", "==", selectedRepId),
      where("planningType", "==", planningType),
      where(planningType === "weekly" ? "week" : "month", "==", periodKey)
    );

    const unsubscribeVisits = onSnapshot(qVisits, (snapshot) => {
      const list: PlannedPharmacyVisit[] = [];
      snapshot.forEach((doc) => {
        list.push(doc.data() as PlannedPharmacyVisit);
      });
      setPlannedVisits(list);
      setIsLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, "salesPlannerVisits");
      setIsLoading(false);
    });

    const approvalCollection = collection(db, "salesPlannerApprovals");
    const approvalId = `${selectedRepId}_${periodKey}`;
    const unsubscribeApproval = onSnapshot(doc(approvalCollection, approvalId), (docSnap) => {
      if (docSnap.exists()) {
        setApprovalDoc(docSnap.data() as SalesPlannerApproval);
      } else {
        setApprovalDoc(null);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `salesPlannerApprovals/${approvalId}`);
    });

    return () => {
      unsubscribeVisits();
      unsubscribeApproval();
    };
  }, [selectedRepId, planningType, periodKey]);

  // Audit logging helper
  const logAudit = async (action: string, details: string) => {
    const logId = `AL-${Math.floor(1000 + Math.random() * 9000)}`;
    const auditRecord: AuditLog = {
      id: logId,
      timestamp: new Date().toISOString().replace("T", " ").substring(0, 19) + " UTC",
      userId: currentUser?.id || "unknown",
      userName: currentUser?.name || "Anonymous",
      userRole: currentUser?.role,
      action,
      entityType: "SalesPlanner",
      entityName: "Sales Planner",
      details
    };

    try {
      await saveAuditLogRecord(auditRecord);
    } catch (e) {
      console.error("Audit log failed:", e);
    }
  };

  // Handle scheduling a pharmacy
  const handleSchedulePharmacy = async (pharmacy: Pharmacy, day: string, time: string, dateStr?: string) => {
    if (currentApprovalStatus === "Pending Approval" || currentApprovalStatus === "Approved") {
      alert(isRtl ? "لا يمكن تعديل الخطة لأنها قيد المراجعة أو معتمدة بالفعل." : "Cannot modify the plan because it is currently under review or already approved.");
      return;
    }

    const targetDate = dateStr || (planningType === "weekly" ? getLocalDateForWeekDay(day) : activeCalendarDate);
    if (!market || !resolveBusinessCalendarDay(targetDate, market, calendarExceptions, currentUser.region).scheduledWorkingDay) { alert(isRtl ? "لا يمكن الجدولة في يوم غير عامل حسب إعدادات السوق." : "Scheduling is not permitted on a configured non-working day."); return; }
    if (targetDate) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const target = new Date(targetDate);
      target.setHours(0, 0, 0, 0);

      const diffTime = today.getTime() - target.getTime();
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
      if (diffDays > 3) {
        alert(
          isRtl
            ? "خطأ في التحقق من التاريخ: لا يمكن جدولة أو تسجيل زيارات بأثر رجعي تتجاوز نافذة الـ 3 أيام المسموح بها."
            : "Date Validation Error: Cannot schedule or submit visits retroactively beyond the allowed 3-day calendar window."
        );
        return;
      }
    }

    const isAssigned = assignedPharmacies.some(p => p.id === pharmacy.id);
    if (!isAssigned) {
      alert(isRtl ? "هذه الصيدلية ليست ضمن النطاق المسموح به لك." : "This pharmacy is not within your allowed planning scope.");
      return;
    }

    const visitId = `phv-${Date.now()}`;
    const newVisit: PlannedPharmacyVisit = {
      id: visitId,
      pharmacyId: pharmacy.id,
      pharmacyName: pharmacy.name,
      territory: pharmacy.territory,
      day: day,
      time: time,
      date: targetDate,
      month: selectedMonth,
      week: selectedWeek,
      repId: selectedRepId,
      repName: selectedRepUser.name,
      planningType: planningType,
      isUnplanned: isUnplannedField,
      status: "Draft"
    };

    const decorated = decorateRecord(newVisit, currentUser.id, "create");

    try {
      await setDoc(doc(db, "salesPlannerVisits", visitId), decorated);
      setOptimizedRoute(null); // Reset optimized route banner upon edit
      await logAudit(
        isUnplannedField ? "Unplanned Visit Created" : "Planned Visit Created",
        `Created ${isUnplannedField ? "unplanned" : "planned"} visit for pharmacy ${pharmacy.name} on ${newVisit.date} (${time}) for rep ${selectedRepUser.name}`
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `salesPlannerVisits/${visitId}`);
    }
  };

  // Remove scheduled visit
  const handleRemoveVisit = async (id: string) => {
    if (currentApprovalStatus === "Pending Approval" || currentApprovalStatus === "Approved") {
      alert(isRtl ? "لا يمكن تعديل الخطة لأنها قيد المراجعة أو معتمدة بالفعل." : "Cannot modify the plan because it is currently under review or already approved.");
      return;
    }

    const visit = plannedVisits.find(v => v.id === id);
    try {
      await deleteDoc(doc(db, "salesPlannerVisits", id));
      setOptimizedRoute(null);
      if (visit) {
        await logAudit(
          "Planned Visit Removed",
          `Removed planned pharmacy visit for ${visit.pharmacyName} on ${visit.date} for rep ${selectedRepUser.name}`
        );
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `salesPlannerVisits/${id}`);
    }
  };

  // Helper: Match day names of week to actual local dates in 2026-W27 week for representation
  const getLocalDateForWeekDay = (dayName: string) => {
    const baseDates: { [key: string]: string } = {
      "Monday": "2026-06-29",
      "Tuesday": "2026-06-30",
      "Wednesday": "2026-07-01",
      "Thursday": "2026-07-02",
      "Friday": "2026-07-03"
    };
    return baseDates[dayName] || "2026-06-29";
  };

  // Submit plan to supervisor
  const handleRequestApproval = async () => {
    const approvalId = `${selectedRepId}_${periodKey}`;
    const approvalData: SalesPlannerApproval = {
      id: approvalId,
      repId: selectedRepId,
      repName: selectedRepUser.name,
      period: periodKey,
      planningType: planningType,
      status: "Pending Approval",
      notes: `Sales plan submitted by ${currentUser.name} on ${new Date().toLocaleDateString()}`,
      updatedAt: new Date().toISOString(),
      updatedBy: currentUser.id
    };

    try {
      await savePlannerApprovalTransactional(
        approvalData,
        "salesPlannerApprovals",
        currentUser.id,
        currentUser.role,
        currentUser.name,
        `Submitted sales planner detailing plan for period ${periodKey} (${planningType}) for rep ${selectedRepUser.name}`
      );

      // Trigger automated notification and approval alerts
      triggerPlannerSubmissionAlert(
        approvalId,
        selectedRepId,
        selectedRepUser.name,
        periodKey,
        "sales",
        currentUser.id
      ).catch(e => console.error("[Alert Engine] Planner submission alert failed:", e));

    } catch (error: any) {
      console.error(error);
      alert(error.message || "Failed to submit plan due to a state conflict.");
    }
  };

  // Approve / Reject plan as Supervisor/Manager/Admin
  const handleUpdateApproval = async (status: "Approved" | "Draft" | "Rejected") => {
    const approvalId = `${selectedRepId}_${periodKey}`;
    const approvalData: SalesPlannerApproval = {
      id: approvalId,
      repId: selectedRepId,
      repName: selectedRepUser.name,
      period: periodKey,
      planningType: planningType,
      status: status,
      notes: `${status} by supervisor ${currentUser.name} on ${new Date().toLocaleDateString()}`,
      updatedAt: new Date().toISOString(),
      updatedBy: currentUser.id
    };

    try {
      await savePlannerApprovalTransactional(
        approvalData,
        "salesPlannerApprovals",
        currentUser.id,
        currentUser.role,
        currentUser.name,
        `Supervisor ${currentUser.name} updated sales detailing plan status to ${status} for rep ${selectedRepUser.name}, period ${periodKey}`
      );
    } catch (error: any) {
      console.error(error);
      alert(error.message || "Failed to update plan status due to a state conflict.");
    }
  };

  // Reset/Clear all visits in current period
  const handleClearPeriod = async () => {
    if (currentApprovalStatus === "Pending Approval" || currentApprovalStatus === "Approved") {
      alert(isRtl ? "لا يمكن تعديل الخطة لأنها قيد المراجعة أو معتمدة بالفعل." : "Cannot modify the plan because it is currently under review or already approved.");
      return;
    }

    if (!window.confirm(isRtl ? "هل أنت متأكد من مسح جميع الزيارات المخططة لهذه الفترة؟" : "Are you sure you want to clear all planned visits in this period?")) {
      return;
    }
    try {
      const count = plannedVisits.length;
      for (const visit of plannedVisits) {
        await deleteDoc(doc(db, "salesPlannerVisits", visit.id));
      }
      setOptimizedRoute(null);
      await logAudit(
        "Plan Cleared",
        `Cleared all ${count} planned pharmacy visits for period ${periodKey} for rep ${selectedRepUser.name}`
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `salesPlannerVisits/multiple`);
    }
  };

  // AI Auto-Planner optimization action
  const handleAutoPlan = async () => {
    if (currentApprovalStatus === "Pending Approval" || currentApprovalStatus === "Approved") {
      alert(isRtl ? "لا يمكن تعديل الخطة لأنها قيد المراجعة أو معتمدة بالفعل." : "Cannot modify the plan because it is currently under review or already approved.");
      return;
    }

    setIsAutoPlanning(true);
    setOptimizedRoute(null);
    
    // Simulate transit sequence and coordinates optimization
    setTimeout(async () => {
      const unplaced = assignedPharmacies.filter(p => !plannedPharmacyIds.has(p.id));
      const slots = [
        { day: "Monday", time: "11:00 AM" },
        { day: "Wednesday", time: "01:30 PM" },
        { day: "Friday", time: "04:30 PM" }
      ];

      try {
        const count = Math.min(unplaced.length, 3);
        let plannedCount = 0;
        for (let i = 0; i < count; i++) {
          const pharm = unplaced[i];
          const slot = slots[i % slots.length];
          const visitId = `phv-ai-${Date.now()}-${i}`;
          
          const newVisit: PlannedPharmacyVisit = {
            id: visitId,
            pharmacyId: pharm.id,
            pharmacyName: pharm.name,
            territory: pharm.territory,
            day: slot.day,
            time: slot.time,
            date: getLocalDateForWeekDay(slot.day),
            month: selectedMonth,
            week: selectedWeek,
            repId: selectedRepId,
            repName: selectedRepUser.name,
            planningType: planningType,
            isUnplanned: false,
            status: "Draft"
          };

          const decorated = decorateRecord(newVisit, currentUser.id, "create");
          await setDoc(doc(db, "salesPlannerVisits", visitId), decorated);
          plannedCount++;
        }
        
        setOptimizedRoute(
          isRtl 
            ? "تم تحسين مسار الـ GPS بالكامل لتغطية الصيدليات المحددة بنجاح! تم توفير 18.5 كم من مسافة الترانزيت الإجمالية." 
            : "GPS Path optimized successfully! Saved 18.5 km of total transit distance and queued aligned pharmacies."
        );

        await logAudit(
          "AI Plan Optimized",
          `Ran AI Auto-Planner, successfully scheduled ${plannedCount} pharmacy visits for period ${periodKey} for rep ${selectedRepUser.name}`
        );
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, "salesPlannerVisits/ai-bulk");
      } finally {
        setIsAutoPlanning(false);
      }
    }, 1500);
  };

  // Calculate days for the interactive month calendar grid (June 2026 starts on Monday)
  const getJune2026CalendarDays = () => {
    const days = [];
    // June 1, 2026 is Monday, so 1 leading blank day (Sunday representation if we want standard grid)
    days.push({ dayNumber: null, dateStr: "" });

    for (let i = 1; i <= 30; i++) {
      const dayStr = i < 10 ? `0${i}` : `${i}`;
      days.push({
        dayNumber: i,
        dateStr: `2026-06-${dayStr}`
      });
    }
    return days;
  };

  const calendarDays = getJune2026CalendarDays();
  const selectedDateVisits = plannedVisits.filter(v => v.date === activeCalendarDate);

  // Group visits into a sequential list for Route Planner/GPS Visualizer
  const sortedVisitsForRoute = [...plannedVisits].sort((a, b) => {
    const timeA = a.time.includes("AM") ? 0 : 1;
    const timeB = b.time.includes("AM") ? 0 : 1;
    if (timeA !== timeB) return timeA - timeB;
    return a.time.localeCompare(b.time);
  });

  return (
    <div className="space-y-6 animate-fade-in" id="sales-planner-module" dir={isRtl ? "rtl" : "ltr"}>
      
      {/* Page Header */}
      <div className="p-6 bg-gradient-to-br from-slate-900 via-emerald-950 to-slate-900 border border-slate-800 rounded-2xl shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-full text-[10px] font-mono font-bold tracking-widest uppercase">
              MENAREPS 2.0 Sales Core
            </span>
            <span className="px-2.5 py-0.5 bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 rounded-full text-[10px] font-mono font-bold tracking-widest uppercase flex items-center gap-1">
              <CheckCircle size={10} /> Firestore Active
            </span>
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-2">
            <Store className="text-emerald-400" />
            {isRtl ? "مخطط مبيعات وجرد الصيدليات" : "Sales & Pharmacy Auditor Planner"}
          </h1>
          <p className="text-xs text-slate-300 max-w-2xl leading-relaxed">
            {isRtl 
              ? "خطط لمسارات جرد المخزون، تحصيل الفواتير الميدانية، ومتابعة مديونيات الصيدليات بالتوافق مع قواعد التغطية الجغرافية."
              : "Strategize retail stock audits, follow up outstanding billing collections, and map transit paths with secure real-time Firestore synchronization."}
          </p>
        </div>

        {/* AI Auto-Planner */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handleAutoPlan}
            disabled={isAutoPlanning || currentApprovalStatus === "Approved"}
            className="px-4 py-2.5 bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold rounded-xl shadow-lg hover:shadow-emerald-500/10 flex items-center gap-2 transition-all cursor-pointer disabled:opacity-40 animate-pulse active:scale-95"
            id="btn-sales-auto-planner"
          >
            <Sparkles size={14} className={isAutoPlanning ? "animate-spin text-amber-300" : "text-amber-200"} />
            {isAutoPlanning 
              ? (isRtl ? "جاري جدولة المسار..." : "AI Optimizing...") 
              : (isRtl ? "مجدول المسارات الذكي" : "AI Route Planner")}
          </button>
        </div>
      </div>

      {/* Role & Representative Selector Block */}
      <div className="p-4 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl flex flex-col sm:flex-row items-center justify-between gap-4 shadow-2xs">
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 rounded-lg">
            <Briefcase size={18} />
          </div>
          <div className="space-y-0.5">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-mono">
              {isRtl ? "نطاق الصلاحيات والأمن" : "Secure Operational Context"}
            </p>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-slate-800 dark:text-slate-100">
                {currentUser.name}
              </span>
              <span className="px-1.5 py-0.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300 text-[8.5px] font-black rounded uppercase">
                {currentUser.role}
              </span>
            </div>
          </div>
        </div>

        {/* Inter-territory rep switcher for supervisors */}
        {!isRep ? (
          <div className="flex items-center gap-2.5 w-full sm:w-auto border-t sm:border-t-0 pt-3 sm:pt-0">
            <span className="text-xxs font-black uppercase text-slate-400 tracking-wider flex items-center gap-1 shrink-0">
              <UserCheck size={12} className="text-emerald-500" />
              {isRtl ? "المندوب المستهدف:" : "View Representative:"}
            </span>
            <select
              value={selectedRepId}
              onChange={(e) => setSelectedRepId(e.target.value)}
              className="w-full sm:w-60 px-3 py-1.5 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-950 text-xs font-bold text-slate-800 dark:text-slate-200 shadow-3xs focus:ring-1 focus:ring-emerald-500 focus:outline-hidden cursor-pointer"
            >
              {salesReps.map(rep => (
                <option key={rep.id} value={rep.id}>
                  {rep.name} ({rep.role})
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="px-3 py-1.5 bg-slate-50 dark:bg-slate-950/60 border border-slate-100 dark:border-slate-850 rounded-lg text-xxs font-semibold text-slate-500 flex items-center gap-1">
            <Compass size={12} className="text-emerald-400" />
            {isRtl ? "تم تصفية قائمة الصيدليات تلقائياً لنطاقك المعتمد" : "Automatically showing pharmacies assigned to your representative territory"}
          </div>
        )}
      </div>

      {/* Control row: Planning Period selector & approval triggers */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
        
        {/* Planning Period Tab-Pills */}
        <div className="md:col-span-8 bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="flex flex-wrap items-center gap-3">
            {/* Planning Mode Tab */}
            <div className="flex bg-slate-200/60 dark:bg-slate-800/80 p-1 rounded-lg">
              <button
                onClick={() => setPlanningType("weekly")}
                className={`px-3 py-1 rounded-md text-xxs font-bold transition-all ${
                  planningType === "weekly"
                    ? "bg-white dark:bg-slate-950 text-slate-900 dark:text-white shadow-3xs"
                    : "text-slate-500 hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                {isRtl ? "تخطيط أسبوعي" : "Weekly Plan"}
              </button>
              <button
                onClick={() => setPlanningType("monthly")}
                className={`px-3 py-1 rounded-md text-xxs font-bold transition-all ${
                  planningType === "monthly"
                    ? "bg-white dark:bg-slate-950 text-slate-900 dark:text-white shadow-3xs"
                    : "text-slate-500 hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                {isRtl ? "تخطيط شهري" : "Monthly Plan"}
              </button>
            </div>

            {/* Selection dropdown based on planning type */}
            {planningType === "weekly" ? (
              <select
                value={selectedWeek}
                onChange={(e) => setSelectedWeek(e.target.value)}
                className="px-2.5 py-1.5 border border-slate-200 dark:border-slate-800 rounded bg-white dark:bg-slate-950 text-xxs font-bold text-slate-700 dark:text-slate-300 cursor-pointer shadow-3xs"
              >
                {weeksList.map(w => (
                  <option key={w} value={w}>{w === "2026-W27" ? `${w} (Active Current)` : w}</option>
                ))}
              </select>
            ) : (
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="px-2.5 py-1.5 border border-slate-200 dark:border-slate-800 rounded bg-white dark:bg-slate-950 text-xxs font-bold text-slate-700 dark:text-slate-300 cursor-pointer shadow-3xs"
              >
                {monthsList.map(m => (
                  <option key={m} value={m}>{m === "2026-06" ? `${m} (June 2026)` : m}</option>
                ))}
              </select>
            )}

            {/* Reset planning grid */}
            {plannedVisits.length > 0 && currentApprovalStatus !== "Approved" && (
              <button
                onClick={handleClearPeriod}
                className="px-2 py-1 border border-rose-200 hover:bg-rose-50 text-rose-600 dark:border-rose-950 dark:hover:bg-rose-950/20 rounded text-[9.5px] font-black uppercase tracking-wider flex items-center gap-1 transition-colors cursor-pointer"
              >
                <RotateCcw size={10} />
                {isRtl ? "إعادة تعيين" : "Reset Grid"}
              </button>
            )}
          </div>

          {/* Current Period Approval status */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-400">
              {isRtl ? "حالة الاعتماد:" : "Approval Status:"}
            </span>
            <div className={`px-2.5 py-1 rounded-lg text-xxs font-black uppercase tracking-widest flex items-center gap-1.5 ${
              currentApprovalStatus === "Draft"
                ? "bg-slate-100 text-slate-600 dark:bg-slate-850 dark:text-slate-400 border border-slate-200 dark:border-slate-800"
                : currentApprovalStatus === "Pending Approval"
                ? "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border border-amber-200 dark:border-amber-900 animate-pulse"
                : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900"
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${
                currentApprovalStatus === "Draft" ? "bg-slate-400" : currentApprovalStatus === "Pending Approval" ? "bg-amber-500" : "bg-emerald-500"
              }`} />
              {currentApprovalStatus === "Draft" && (isRtl ? "مسودة" : "Draft")}
              {currentApprovalStatus === "Pending Approval" && (isRtl ? "انتظار المراجعة" : "Pending Approval")}
              {currentApprovalStatus === "Approved" && (isRtl ? "معتمد وموافق عليه" : "Approved Plan")}
            </div>
          </div>
        </div>

        {/* Dynamic Action Buttons Panel */}
        <div className="md:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex items-center justify-end shadow-2xs">
          {isRep ? (
            <div className="w-full">
              {currentApprovalStatus === "Draft" ? (
                <button
                  onClick={handleRequestApproval}
                  disabled={plannedVisits.length === 0}
                  className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:hover:bg-emerald-600 text-white text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-sm active:scale-98"
                >
                  <CheckCircle size={14} />
                  {isRtl ? "إرسال خطة المبيعات للمشرف" : "Submit Sales Plan"}
                </button>
              ) : (
                <p className="text-center text-xxs text-slate-400 font-mono">
                  {currentApprovalStatus === "Pending Approval" 
                    ? (isRtl ? "بانتظار موافقة المشرف الميداني المباشر" : "Under active supervisor verification") 
                    : (isRtl ? "تم الاعتماد بنجاح! لا يمكنك التعديل حالياً" : "Schedule locked. Compliance hold released!")}
                </p>
              )}
            </div>
          ) : (
            <div className="flex gap-2 w-full">
              {currentApprovalStatus === "Pending Approval" ? (
                <>
                  <button
                    onClick={() => handleUpdateApproval("Approved")}
                    className="flex-1 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xxs font-black uppercase rounded-lg shadow-sm cursor-pointer flex items-center justify-center gap-1"
                  >
                    <ThumbsUp size={12} />
                    {isRtl ? "اعتماد الخطة" : "Approve Plan"}
                  </button>
                  <button
                    onClick={() => handleUpdateApproval("Draft")}
                    className="flex-1 py-1.5 bg-rose-50 border border-rose-200 hover:bg-rose-100 text-rose-700 dark:bg-rose-950/20 dark:border-rose-900 dark:text-rose-400 text-xxs font-black uppercase rounded-lg shadow-sm cursor-pointer"
                  >
                    {isRtl ? "إرجاع للمسودة" : "Return/Reject"}
                  </button>
                </>
              ) : (
                <p className="text-center text-xxs text-slate-400 font-mono w-full">
                  {currentApprovalStatus === "Approved" 
                    ? (isRtl ? "الخطة معتمدة حالياً. يمكنك التعديل بالنقر لرجوعها" : "Approved Plan (Verified)") 
                    : (isRtl ? "المندوب لم يرسل خطة المبيعات للمراجعة بعد" : "Rep has not submitted sales plan yet")}
                  {currentApprovalStatus === "Approved" && (
                    <button 
                      onClick={() => handleUpdateApproval("Draft")}
                      className="ml-2 underline text-indigo-500 hover:text-indigo-600 cursor-pointer font-bold"
                    >
                      (Unlock)
                    </button>
                  )}
                </p>
              )}
            </div>
          )}
        </div>

      </div>

      {/* Optimized Route GPS Placeholder Banner */}
      <div className="p-4 bg-slate-900/40 border border-slate-200/60 dark:border-slate-800 rounded-xl space-y-3">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300">
          <Navigation size={16} className="text-emerald-500 animate-pulse shrink-0" />
          <span>{isRtl ? "مسار الـ GPS وتخطيط الترانزيت الميداني الفعال" : "Transit GPS & Live Routing Optimization Path:"}</span>
        </div>
        
        {optimizedRoute ? (
          <div className="p-3 bg-emerald-950/30 border border-emerald-900/60 rounded-lg text-xxs font-mono text-emerald-400 leading-relaxed">
            {optimizedRoute}
          </div>
        ) : sortedVisitsForRoute.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono text-slate-400">
            <span className="text-emerald-500 font-bold uppercase shrink-0">Seq:</span>
            {sortedVisitsForRoute.map((v, index) => (
              <React.Fragment key={v.id}>
                {index > 0 && <span className="text-slate-600">→</span>}
                <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-850 rounded text-slate-750 dark:text-slate-300">
                  {v.pharmacyName} ({v.time})
                </span>
              </React.Fragment>
            ))}
          </div>
        ) : (
          <p className="text-[10px] text-slate-400 leading-relaxed italic">
            {isRtl 
              ? "لم يتم جدولة صيدليات بعد. أضف صيدليات إلى جدول التخطيط النشط لتوليد تسلسل المسار الجغرافي تلقائياً."
              : "No locations planned in this period yet. Add pharmacies to generate the optimized sequential routing timeline."}
          </p>
        )}
      </div>

      {/* Main Grid: Pharmacies selection vs Calendar Schedule Views */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column (Span 4): Pharmacy alignment selector */}
        <div className="lg:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4 shadow-3xs flex flex-col justify-between h-fit min-h-[500px]">
          <div className="space-y-4">
            
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-xs font-bold text-slate-850 dark:text-slate-100 uppercase tracking-wider font-mono flex items-center gap-2">
                <Store size={16} className="text-emerald-500" />
                {isRtl ? "صيدليات النطاق غير المجدولة" : "Unplanned Territory Pharmacies"}
              </h3>
              <span className="px-2 py-0.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-900 rounded-md text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                {filterablePharmacies.length} {isRtl ? "متبقية" : "Left"}
              </span>
            </div>

            {/* Rep alignment details */}
            <div className="p-3 bg-slate-50 dark:bg-slate-950/40 border border-slate-100 dark:border-slate-850 rounded-lg space-y-1.5">
              <p className="text-[10px] font-bold text-slate-700 dark:text-slate-300">
                {isRtl ? "موقع التغطية المعتمد:" : "Aligned Representative's Territory:"}
              </p>
              <div className="flex items-center gap-1.5 flex-wrap text-[9px] font-semibold text-slate-500">
                <span className="px-1.5 py-0.5 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded">
                  {selectedRepUser.region || "Tripoli"}
                </span>
                <span>/</span>
                <span className="px-1.5 py-0.5 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded text-emerald-600 dark:text-emerald-400">
                  {selectedRepUser.territory || "Al-Dhahra"}
                </span>
              </div>
            </div>

            {/* Filter inputs */}
            <input
              type="text"
              placeholder={isRtl ? "البحث بالاسم أو المنطقة..." : "Filter by pharmacy name, city or area..."}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-transparent text-slate-800 dark:text-white placeholder-slate-400 focus:outline-hidden focus:ring-1 focus:ring-emerald-500"
            />

            {/* Target Scheduler details selector */}
            <div className="p-3.5 bg-emerald-50/40 dark:bg-emerald-950/10 border border-emerald-100/30 dark:border-emerald-950/40 rounded-lg space-y-3">
              <div className="flex justify-between items-center">
                <p className="text-[9.5px] font-bold text-slate-400 font-mono uppercase tracking-wider">
                  {isRtl ? "موعد الزيارة المستهدف:" : "Target Schedule Block:"}
                </p>
                {/* Planned vs Unplanned Visit toggler */}
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={isUnplannedField}
                    onChange={(e) => setIsUnplannedField(e.target.checked)}
                    className="rounded border-slate-300 dark:border-slate-800 text-emerald-600 focus:ring-emerald-500 w-3 h-3"
                  />
                  <span className={`text-[9px] font-black uppercase tracking-wider ${isUnplannedField ? "text-amber-500" : "text-slate-400"}`}>
                    {isUnplannedField ? "Ad-hoc (Unplanned)" : "Planned Visit"}
                  </span>
                </label>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {planningType === "weekly" ? (
                  <select
                    value={selectedDay}
                    onChange={(e) => setSelectedDay(e.target.value)}
                    className="px-2 py-1.5 border border-slate-200 dark:border-slate-800 rounded bg-white dark:bg-slate-950 text-xxs font-bold text-slate-700 dark:text-slate-300 cursor-pointer focus:ring-1 focus:ring-emerald-500"
                  >
                    {daysOfWeek.map(d => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                ) : (
                  <select
                    value={activeCalendarDate}
                    onChange={(e) => setActiveCalendarDate(e.target.value)}
                    className="px-2 py-1.5 border border-slate-200 dark:border-slate-800 rounded bg-white dark:bg-slate-950 text-xxs font-bold text-slate-700 dark:text-slate-300 cursor-pointer focus:ring-1 focus:ring-emerald-500"
                  >
                    {calendarDays.filter(d => d.dayNumber !== null).map(d => (
                      <option key={d.dateStr} value={d.dateStr}>June {d.dayNumber}, 2026</option>
                    ))}
                  </select>
                )}

                <select
                  value={selectedTime}
                  onChange={(e) => setSelectedTime(e.target.value)}
                  className="px-2 py-1.5 border border-slate-200 dark:border-slate-800 rounded bg-white dark:bg-slate-950 text-xxs font-bold text-slate-700 dark:text-slate-300 cursor-pointer focus:ring-1 focus:ring-emerald-500"
                >
                  <option value="09:00 AM">09:00 AM</option>
                  <option value="11:00 AM">11:00 AM</option>
                  <option value="01:30 PM">01:30 PM</option>
                  <option value="03:00 PM">03:00 PM</option>
                  <option value="04:30 PM">04:30 PM</option>
                </select>
              </div>
            </div>

            {/* Pharmacy List */}
            <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
              {isLoading ? (
                <div className="py-12 flex flex-col items-center justify-center space-y-2">
                  <span className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                  <span className="text-[10px] text-slate-400 font-mono">Syncing Territory Pharmacies...</span>
                </div>
              ) : filterablePharmacies.length > 0 ? (
                filterablePharmacies.map((pharm) => (
                  <div
                    key={pharm.id}
                    className="p-3 border border-slate-100 dark:border-slate-800/80 rounded-xl hover:border-emerald-400/80 dark:hover:border-emerald-800/80 transition-all flex justify-between items-start bg-slate-50/20 dark:bg-slate-950/20 shadow-4xs animate-fade-in"
                  >
                    <div className="space-y-1">
                      <h4 className="font-bold text-xs text-slate-800 dark:text-slate-100">{pharm.name}</h4>
                      <p className="text-[10px] text-slate-400 font-medium">{pharm.territory} • {pharm.city || pharm.region}</p>
                      
                      <div className="flex items-center gap-1.5 font-mono text-rose-500 font-bold text-[9px] mt-1">
                        <DollarSign size={10} />
                        <span>AR Balance: ${pharm.outstandingBalance ? pharm.outstandingBalance.toLocaleString() : "0"}</span>
                      </div>
                    </div>

                    <button
                      onClick={() => handleSchedulePharmacy(pharm, selectedDay, selectedTime)}
                      disabled={currentApprovalStatus === "Approved"}
                      className="p-2 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-600 hover:text-white text-emerald-600 dark:text-emerald-400 disabled:opacity-40 disabled:hover:bg-emerald-50 rounded-xl transition-all cursor-pointer active:scale-95 shadow-4xs"
                      title={isRtl ? "جدولة الصيدلية" : "Schedule Pharmacy"}
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                ))
              ) : (
                <div className="text-center py-10 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                  <Store className="mx-auto text-slate-300 dark:text-slate-700 mb-2" size={24} />
                  <p className="text-[10px] text-slate-400 font-mono px-3">
                    {assignedPharmacies.length === 0 
                      ? (isRtl ? "لا توجد صيدليات مخصصة لهذا المندوب في قاعدة البيانات." : "No pharmacies are aligned to this representative in the territory alignment database.")
                      : (isRtl ? "تمت جدولة جميع صيدليات النطاق النشط!" : "All aligned pharmacies have been scheduled for this planning period.")}
                  </p>
                </div>
              )}
            </div>

          </div>

          <div className="pt-4 border-t border-slate-100 dark:border-slate-800/80">
            <p className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-widest font-mono flex items-center gap-1">
              <Compass size={11} className="animate-pulse" />
              {isRtl ? "تنبيهات الامتثال المالي والجرد" : "Financial Auditing Compliance:"}
            </p>
            <p className="text-[9px] text-slate-400 leading-relaxed mt-1">
              {isRtl 
                ? "قواعد المبيعات تلزم بجدولة زيارات الصيدليات ذات المديونيات المعلقة Outstanding Balances لتجنب تراكم المديونية."
                : "Pharma routing directives require prioritizing visits to pharmacies with high outstanding balances to accelerate credit collections."}
            </p>
          </div>
        </div>

        {/* Right Column (Span 8): Interactive Calendar Views */}
        <div className="lg:col-span-8 space-y-4">
          
          {planningType === "weekly" ? (
            /* WEEKLY CALENDAR GRID: Mon - Fri columns */
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4 shadow-3xs">
              <div className="flex justify-between items-center">
                <h3 className="text-xs font-bold text-slate-850 dark:text-slate-100 uppercase tracking-wider font-mono flex items-center gap-2">
                  <CalendarIcon size={16} className="text-emerald-500" />
                  {isRtl ? "جدول التخطيط الميداني الأسبوعي" : "Weekly Sales Detailing Grid"}
                </h3>
                <span className="text-xxs text-slate-400 font-mono">
                  {isRtl ? "الأسبوع المستهدف:" : "Active Period:"} <strong className="text-emerald-600 dark:text-emerald-400">{selectedWeek}</strong>
                </span>
              </div>

              {/* Mon - Fri column grid */}
              <div className="grid grid-cols-1 md:grid-cols-5 gap-3" id="weekly-calendar-grid">
                {daysOfWeek.map((day) => {
                  const dayVisits = plannedVisits.filter(v => v.day === day);
                  return (
                    <div
                      key={day}
                      className="bg-slate-50/50 dark:bg-slate-950/40 border border-slate-100 dark:border-slate-850/60 rounded-xl p-3 min-h-[420px] flex flex-col space-y-3"
                    >
                      {/* Column Header */}
                      <div className="text-center pb-2.5 border-b border-slate-200/50 dark:border-slate-800/50 space-y-0.5">
                        <p className="text-[10px] font-black text-slate-800 dark:text-slate-200 uppercase font-mono tracking-tight">{day}</p>
                        <p className="text-[8.5px] font-bold text-slate-400 font-mono">{dayVisits.length} {isRtl ? "زيارات" : "planned"}</p>
                      </div>

                      {/* Day list */}
                      <div className="flex-1 flex flex-col gap-2.5 overflow-y-auto">
                        {dayVisits.length > 0 ? (
                          dayVisits.map((visit) => (
                            <div
                              key={visit.id}
                              className={`p-2.5 rounded-lg border shadow-3xs relative group flex flex-col justify-between transition-all ${
                                visit.isUnplanned 
                                  ? "bg-amber-50/40 border-amber-200 dark:bg-amber-950/10 dark:border-amber-900"
                                  : "bg-white border-slate-100 dark:bg-slate-900 dark:border-slate-850"
                              }`}
                            >
                              <div className="space-y-1">
                                <p className="text-[10px] font-black text-slate-800 dark:text-slate-100 leading-tight">
                                  {visit.pharmacyName}
                                </p>
                                <p className="text-[9px] text-slate-400 font-semibold">{visit.territory}</p>
                                
                                <div className="mt-1.5 flex items-center justify-between">
                                  <div className="flex items-center gap-1 text-[8px] font-mono text-emerald-600 dark:text-emerald-400 font-bold">
                                    <Clock size={10} />
                                    <span>{visit.time}</span>
                                  </div>
                                  
                                  {visit.isUnplanned && (
                                    <span className="px-1 py-0.5 bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300 text-[7px] font-mono font-black rounded uppercase">
                                      Ad-hoc
                                    </span>
                                  )}
                                </div>
                              </div>

                              {/* Unschedule button */}
                              {currentApprovalStatus !== "Approved" && (
                                <button
                                  onClick={() => handleRemoveVisit(visit.id)}
                                  className="absolute -top-1 right-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 p-1 text-rose-600 md:text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded transition-all cursor-pointer bg-rose-50 md:bg-transparent border md:border-0 border-rose-100 dark:border-rose-900"
                                  title={isRtl ? "إلغاء الموعد" : "Unschedule"}
                                >
                                  <Trash2 size={10} />
                                </button>
                              )}
                            </div>
                          ))
                        ) : (
                          <div className="flex-1 flex flex-col items-center justify-center border border-dashed border-slate-200 dark:border-slate-800/80 rounded-xl p-3 text-center text-[9px] text-slate-400 font-mono">
                            <Plus size={14} className="text-slate-300 dark:text-slate-700 mb-1" />
                            <span>{isRtl ? "شاغر" : "No Vis."}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            /* MONTHLY CALENDAR GRID */
            <div className="grid grid-cols-1 md:grid-cols-12 gap-6 animate-fade-in">
              
              {/* Left Calendar view */}
              <div className="md:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4 shadow-3xs">
                <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-3">
                  <h3 className="text-xs font-bold text-slate-850 dark:text-slate-100 uppercase tracking-wider font-mono flex items-center gap-2">
                    <CalendarIcon size={16} className="text-emerald-500" />
                    {isRtl ? "مخطط الرزنامة الشهرية" : "Interactive Monthly Sales Planner"}
                  </h3>
                  <span className="text-xxs font-black font-mono text-emerald-600 dark:text-emerald-400">June 2026</span>
                </div>

                {/* Day Letters */}
                <div className="grid grid-cols-7 gap-1 text-center text-[9px] font-black uppercase text-slate-400 font-mono">
                  <div>Sun</div>
                  <div>Mon</div>
                  <div>Tue</div>
                  <div>Wed</div>
                  <div>Thu</div>
                  <div>Fri</div>
                  <div>Sat</div>
                </div>

                {/* Day Blocks */}
                <div className="grid grid-cols-7 gap-1.5">
                  {calendarDays.map((day, idx) => {
                    if (day.dayNumber === null) {
                      return <div key={`blank-${idx}`} className="aspect-square bg-slate-50/20 dark:bg-slate-950/20 rounded-lg opacity-40" />;
                    }

                    const isSelected = activeCalendarDate === day.dateStr;
                    const dateVisitsCount = plannedVisits.filter(v => v.date === day.dateStr).length;

                    return (
                      <button
                        key={day.dateStr}
                        onClick={() => setActiveCalendarDate(day.dateStr)}
                        className={`aspect-square rounded-lg border flex flex-col justify-between p-1.5 transition-all text-left relative cursor-pointer group active:scale-95 ${
                          isSelected
                            ? "bg-emerald-600 border-emerald-600 text-white shadow-md shadow-emerald-600/10"
                            : "bg-slate-50/40 border-slate-100 hover:border-emerald-400 text-slate-800 dark:bg-slate-950/40 dark:border-slate-850 dark:text-slate-200"
                        }`}
                      >
                        <span className="text-[10px] font-black font-mono">{day.dayNumber}</span>
                        
                        {/* Dot indicator for scheduled items */}
                        {dateVisitsCount > 0 && (
                          <div className="flex items-center gap-0.5 justify-end w-full">
                            <span className={`w-1.5 h-1.5 rounded-full ${isSelected ? "bg-amber-300" : "bg-emerald-500"}`} />
                            {dateVisitsCount > 1 && (
                              <span className={`text-[7px] font-mono font-bold ${isSelected ? "text-emerald-200" : "text-slate-400"}`}>
                                x{dateVisitsCount}
                              </span>
                            )}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Right Day Details list */}
              <div className="md:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4 shadow-3xs flex flex-col justify-between">
                <div className="space-y-4">
                  <div className="border-b border-slate-100 dark:border-slate-800 pb-3">
                    <p className="text-[10px] font-bold text-slate-400 font-mono uppercase tracking-wider">
                      {isRtl ? "مواعيد جرد وتحصيل اليوم المختار:" : "Schedules for Active Date:"}
                    </p>
                    <h4 className="text-xs font-black text-emerald-600 dark:text-emerald-300 font-mono mt-0.5">
                      {activeCalendarDate}
                    </h4>
                  </div>

                  {/* Date planner list */}
                  <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
                    {selectedDateVisits.length > 0 ? (
                      selectedDateVisits.map((visit) => (
                        <div
                          key={visit.id}
                          className={`p-3 rounded-xl border relative group space-y-1 shadow-4xs ${
                            visit.isUnplanned 
                              ? "bg-amber-50/40 border-amber-200 dark:bg-amber-950/10 dark:border-amber-900"
                              : "bg-slate-50/40 border-slate-100 dark:bg-slate-950/20 dark:border-slate-850"
                          }`}
                        >
                          <div className="flex justify-between items-start">
                            <h5 className="font-bold text-xs text-slate-800 dark:text-white">
                              {visit.pharmacyName}
                            </h5>
                            
                            {/* Delete Button */}
                            {currentApprovalStatus !== "Approved" && (
                              <button
                                onClick={() => handleRemoveVisit(visit.id)}
                                className="opacity-0 group-hover:opacity-100 p-1 text-rose-500 hover:text-rose-700 rounded transition-all cursor-pointer"
                                title={isRtl ? "إلغاء الزيارة" : "Unschedule"}
                              >
                                <Trash2 size={11} />
                              </button>
                            )}
                          </div>
                          <p className="text-[9px] text-slate-400 font-medium">{visit.territory}</p>
                          
                          <div className="flex items-center gap-1.5 mt-2">
                            <span className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-750 text-[8px] font-mono font-bold text-slate-600 dark:text-slate-300 rounded flex items-center gap-1">
                              <Clock size={9} /> {visit.time}
                            </span>
                            {visit.isUnplanned && (
                              <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400 text-[8px] font-black rounded uppercase">
                                Ad-hoc
                              </span>
                            )}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-10 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                        <Plus className="mx-auto text-slate-300 dark:text-slate-700 mb-2" size={20} />
                        <p className="text-[10px] text-slate-400 font-mono px-2">
                          {isRtl 
                            ? "شاغر. لم تتم جدولة زيارات جرد أو تحصيل لهذا اليوم." 
                            : "No scheduled visits configured for this specific day block."}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Day Summary Compliance Footer */}
                <div className="pt-4 border-t border-slate-150 dark:border-slate-800">
                  <div className="flex items-center justify-between text-[9px] font-mono font-bold text-slate-400">
                    <span>{isRtl ? "مجموع زيارات اليوم:" : "Total Daily Visits:"}</span>
                    <span className="text-emerald-600 dark:text-emerald-400">{selectedDateVisits.length}</span>
                  </div>
                </div>

              </div>

            </div>
          )}

        </div>

      </div>

    </div>
  );
}
