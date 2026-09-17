import React, { useState, useEffect, useMemo } from "react";
import { 
  Calendar as CalendarIcon, 
  Users, 
  Plus, 
  Trash2, 
  Sparkles, 
  CheckCircle, 
  Clock, 
  Compass, 
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
  RotateCcw
} from "lucide-react";
import { Physician, User, Role, AuditLog } from "../types";
import { saveAuditLogRecord } from "../lib/firestoreService";
import { handleFirestoreError, OperationType } from "../lib/firebaseError";
import { plannerWeekRange, plannerWorkingDays, rollingPlannerPeriods } from "../lib/plannerCalendar";
import { createAuthorizedMedicalPlan, executeAuthorizedMedicalPlannerAction, fetchAuthorizedMedicalPlanner, saveAuthorizedMedicalPlannerWeek } from "../lib/medicalPlannerClient";
import { useOperationalScopeSession } from "../contexts/OperationalScopeSessionContext";
import { resolveAuthorizedMedicalPlannerRepresentatives } from "../lib/medicalPlannerVisibility";
import { ALL_PLANNER_FILTERS, DEFAULT_PLANNER_CAPACITY, evaluatePlannerEligibility, filterPlannerPhysicians, normalizePlannerFilters, plannerCapacityCode, plannerCascadeOptions, plannerLastVisitPresentation, togglePlannerFilter, type PlannerCapacity, type PlannerFilters, type PlannerFrequencyRecord, type PlannerPhysician } from "../lib/medicalPlannerPolicy";

interface MedicalPlannerProps {
  lang: "en" | "ar";
  currentUser: User;
  users: User[];
}

interface PlannedVisit {
  id: string;
  physicianId: string;
  physicianName: string;
  specialty: string;
  day: string; // "Monday", "Tuesday", etc.
  time?: string;
  date: string; // e.g. "2026-06-15"
  month: string; // e.g. "2026-06"
  week: string; // e.g. "2026-W27"
  repId: string;
  repName: string;
  planningType: "weekly" | "monthly";
  isUnplanned: boolean;
  status: "PLANNED" | "SAVED" | "COMPLETED" | "CANCELLED" | "Draft";
  mode?: "MANUAL" | "AUTO";
}

function PlannerMultiSelect({ label, options, selected, disabled, onToggle }: { key?: React.Key; label: string; options: { id: string; name: string }[]; selected: string[]; disabled: boolean; onToggle: (id: string) => void }) {
  const all = selected.includes("ALL");
  return <fieldset disabled={disabled} className="min-w-0 text-[9px] font-bold text-slate-500">
    <legend>{label}</legend>
    <div className="mt-1 max-h-24 overflow-y-auto rounded border border-slate-200 dark:border-slate-800 p-1.5 space-y-1 bg-white dark:bg-slate-950">
      <label className="flex items-center gap-1"><input type="checkbox" checked={all} onChange={() => onToggle("ALL")} /> All</label>
      {options.map(option => <label key={option.id} className="flex items-center gap-1"><input type="checkbox" checked={!all && selected.includes(option.id)} onChange={() => onToggle(option.id)} /> <span className="truncate" title={option.name}>{option.name}</span></label>)}
    </div>
    {!all && <div className="mt-1 flex flex-wrap gap-1">{selected.map(id => <span key={id} className="rounded bg-indigo-50 dark:bg-indigo-950 px-1 text-indigo-600 dark:text-indigo-300">{options.find(option => option.id === id)?.name || id}</span>)}</div>}
  </fieldset>;
}

export default function MedicalPlanner({ 
  lang, 
  currentUser, 
  users,
}: MedicalPlannerProps) {
  const isRtl = lang === "ar";
  const operationalScopeSession = useOperationalScopeSession();
  
  const periods = useMemo(() => rollingPlannerPeriods(), []); const weeksList = periods.weeks; const monthsList = periods.months;

  // State Management
  const [planningType, setPlanningType] = useState<"weekly" | "monthly">("weekly");
  const [selectedWeek, setSelectedWeek] = useState(weeksList[0] || "");
  const [selectedMonth, setSelectedMonth] = useState(monthsList[0] || "");
  
  // Rep selections (Supervisor viewing subordinates, or Rep viewing self)
  const isRep = currentUser.role === Role.MEDICAL_REP;
  
  // Securely filter representatives according to user's hierarchy level and role
  const medicalReps = useMemo(() => {
    return resolveAuthorizedMedicalPlannerRepresentatives(currentUser, users, operationalScopeSession);
  }, [users, currentUser.id, operationalScopeSession]);

  const [selectedRepId, setSelectedRepId] = useState<string>(
    isRep ? currentUser.id : ""
  );
  useEffect(() => {
    if (!isRep && !selectedRepId && medicalReps[0]) setSelectedRepId(medicalReps[0].id);
  }, [isRep, medicalReps, selectedRepId]);

  const selectedRepUser = users.find(u => u.id === selectedRepId) || currentUser;

  // Active state lists from Firestore
  const [plannedVisits, setPlannedVisits] = useState<PlannedVisit[]>([]);
  const [plannerPhysicians, setPlannerPhysicians] = useState<Physician[]>([]);
  const [completedVisits, setCompletedVisits] = useState<any[]>([]);
  const [frequencyReservations, setFrequencyReservations] = useState<any[]>([]);
  const [plannerMetadata, setPlannerMetadata] = useState<any>({ geography: { areas: [], cities: [] }, specialties: [], promotionGroups: [] });
  const [isLoading, setIsLoading] = useState(true);

  // Search filtering & scheduling fields
  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState<PlannerFilters>(ALL_PLANNER_FILTERS);
  const [selectedDay, setSelectedDay] = useState("");
  const [isUnplannedField, setIsUnplannedField] = useState(false);
  const [activeCalendarDate, setActiveCalendarDate] = useState("");

  // AI Planner simulations
  const [isAutoPlanning, setIsAutoPlanning] = useState(false);
  const [showAiModal, setShowAiModal] = useState(false);
  const [autoPlanMessage, setAutoPlanMessage] = useState("");
  const [capacity, setCapacity] = useState<PlannerCapacity>({ ...DEFAULT_PLANNER_CAPACITY });
  const [planState, setPlanState] = useState<"DRAFT" | "SAVED">("DRAFT");
  const [isSaving, setIsSaving] = useState(false);
  const [mobileDayDate, setMobileDayDate] = useState("");

  // Filter physicians list to show ONLY those assigned to the selected representative
  // and ensuring alignment with their explicit territory and product assignments
  const assignedPhysicians = useMemo(() => {
    return plannerPhysicians;
  }, [plannerPhysicians]);

  // Dynamic status of the current plan period
  const periodKey = planningType === "weekly" ? selectedWeek : selectedMonth;
  const isReadOnly = !isRep;
  const marketSettings = plannerMetadata.marketSettings?.length === 1 ? plannerMetadata.marketSettings[0] : null;
  const representativeArea = plannerMetadata.geography.areas.find((item: any) => assignedPhysicians.some(physician => physician.areaId === item.id));
  const configuredWorkingDays = useMemo(() => marketSettings ? plannerWorkingDays(selectedWeek, marketSettings, plannerMetadata.businessCalendarExceptions || [], representativeArea?.districtId) : [], [selectedWeek, marketSettings, plannerMetadata.businessCalendarExceptions, representativeArea?.districtId]);
  useEffect(() => { if (selectedDay && !configuredWorkingDays.some(day => day.name === selectedDay)) setSelectedDay(""); if (mobileDayDate && !configuredWorkingDays.some(day => day.date === mobileDayDate)) setMobileDayDate(""); }, [configuredWorkingDays, selectedDay, mobileDayDate]);

  // Filter out planned doctors to show unplanned/unassigned list
  const cascadePhysicians = useMemo<PlannerPhysician[]>(() => assignedPhysicians.map(physician => {
    const area = plannerMetadata.geography.areas.find((item: any) => item.id === physician.areaId);
    return { ...physician, canonicalAreaId: physician.areaId, canonicalCityId: area?.cityId || physician.cityId };
  }), [assignedPhysicians, plannerMetadata]);
  const activeFilters = useMemo(() => ({ ...filters, search: searchQuery }), [filters, searchQuery]);
  const cascadeOptions = useMemo(() => plannerCascadeOptions(cascadePhysicians, activeFilters), [cascadePhysicians, activeFilters]);
  const filterablePhysicians = useMemo(() => filterPlannerPhysicians(cascadePhysicians, activeFilters), [cascadePhysicians, activeFilters]);
  const frequencyRecords = useMemo<PlannerFrequencyRecord[]>(() => [
    ...frequencyReservations.map(visit => ({ ...visit, kind: "PLANNED" as const, status: visit.status })),
    ...completedVisits.map(visit => ({ id: visit.id, repId: visit.repId, physicianId: visit.physicianId, date: visit.visitDate || visit.date, status: visit.status, kind: "COMPLETED" as const })),
  ], [frequencyReservations, completedVisits]);
  useEffect(() => {
    setFilters(current => {
      const next = normalizePlannerFilters(current, cascadeOptions);
      return JSON.stringify(next) === JSON.stringify(current) ? current : next;
    });
  }, [cascadeOptions]);

  const preferenceKey = `menareps_medical_planner_capacity:${currentUser.id}:${planningType}:${periodKey}`;
  useEffect(() => {
    if (!isRep || !periodKey) return;
    try {
      const stored = window.localStorage.getItem(preferenceKey);
      setCapacity(stored ? { ...DEFAULT_PLANNER_CAPACITY, ...JSON.parse(stored) } : { ...DEFAULT_PLANNER_CAPACITY });
    } catch { setCapacity({ ...DEFAULT_PLANNER_CAPACITY }); }
  }, [isRep, preferenceKey]);
  const updateCapacity = (key: keyof PlannerCapacity, raw: number) => {
    if (!isRep) return;
    const next = { ...capacity, [key]: Math.max(1, raw || 1) };
    setCapacity(next);
    window.localStorage.setItem(preferenceKey, JSON.stringify(next));
  };

  // Canonical server-authorized synchronization for physicians, visits and approval state.
  useEffect(() => {
    const scope = operationalScopeSession.scope;
    if (!selectedRepId || !periodKey
      || operationalScopeSession.status !== "READY"
      || operationalScopeSession.actorUid !== currentUser.id
      || !scope
      || scope.actorUid !== currentUser.id
      || scope.authorized !== true
      || scope.queryPlan?.denyAll !== false) {
      setPlannerPhysicians([]);
      setPlannedVisits([]);
      setCompletedVisits([]);
      setFrequencyReservations([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    let cancelled = false;
    void fetchAuthorizedMedicalPlanner({ repId: selectedRepId, planningType, period: periodKey })
      .then((result) => {
        if (cancelled) return;
        setPlannerPhysicians(Array.isArray(result.physicians) ? result.physicians : []);
        setPlannedVisits(Array.isArray(result.visits) ? result.visits : []);
        setCompletedVisits(Array.isArray(result.completedVisits) ? result.completedVisits : []);
        setFrequencyReservations(Array.isArray(result.frequencyReservations) ? result.frequencyReservations : []);
        setPlannerMetadata({ geography: result.geography || { areas: [], cities: [] }, specialties: result.specialties || [], promotionGroups: result.promotionGroups || [], marketSettings: result.marketSettings || [], businessCalendarExceptions: result.businessCalendarExceptions || [] });
        setPlanState(Array.isArray(result.visits) && result.visits.length > 0 ? "SAVED" : "DRAFT");
      })
      .catch((error) => {
        if (cancelled) return;
        setPlannerPhysicians([]);
        setPlannedVisits([]);
        setCompletedVisits([]);
        setFrequencyReservations([]);
        handleFirestoreError(error, OperationType.LIST, "medicalPlanner/scoped-read");
      })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [selectedRepId, planningType, periodKey, currentUser.id, operationalScopeSession]);

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
      entityType: "MedicalPlanner",
      entityName: "Medical Planner",
      details
    };

    try {
      await saveAuditLogRecord(auditRecord);
    } catch (e) {
      console.error("Audit log failed:", e);
    }
  };

  // Helper: Match day names of week to actual local dates based on week
  const mondayForIsoWeek = (week: string): Date | null => {
    const match = /^(\d{4})-W(\d{2})$/.exec(week);
    if (!match) return null;
    const year = Number(match[1]); const weekNumber = Number(match[2]);
    const januaryFourth = new Date(Date.UTC(year, 0, 4));
    const monday = new Date(januaryFourth);
    monday.setUTCDate(januaryFourth.getUTCDate() - ((januaryFourth.getUTCDay() + 6) % 7) + (weekNumber - 1) * 7);
    return monday;
  };

  const dayOffsets: { [key: string]: number } = {
    "Monday": 0,
    "Tuesday": 1,
    "Wednesday": 2,
    "Thursday": 3,
    "Friday": 4,
    "Saturday": 5,
    "Sunday": 6
  };

  const getLocalDateForWeekDay = (dayName: string, weekStr: string = selectedWeek) => {
    const offset = dayOffsets[dayName] ?? 0;
    const mondayDate = mondayForIsoWeek(weekStr);
    if (!mondayDate) return "";
    mondayDate.setUTCDate(mondayDate.getUTCDate() + offset);
    const yyyy = mondayDate.getUTCFullYear();
    const mm = String(mondayDate.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(mondayDate.getUTCDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  };
  const selectedPlanDate = planningType === "weekly" ? (configuredWorkingDays.find(day => day.name === selectedDay)?.date || "") : activeCalendarDate;
  const selectedWeekDates = configuredWorkingDays.map(day => day.date);

  function calendarDaysForIsoWeek(date: string): string[] {
    if (!date) return [];
    const current = new Date(`${date}T12:00:00Z`);
    current.setUTCDate(current.getUTCDate() - ((current.getUTCDay() + 6) % 7));
    return Array.from({ length: 7 }, (_, index) => { const day = new Date(current); day.setUTCDate(current.getUTCDate() + index); return day.toISOString().slice(0, 10); });
  }

  const capacityVisits = plannedVisits.map(visit => ({ physicianId: visit.physicianId, date: visit.date, classification: assignedPhysicians.find(physician => physician.id === visit.physicianId)?.classification }));

  // Handle scheduling a physician
  const handleScheduleDoctor = (doctor: Physician, day: string, dateStr?: string) => {
    if (isReadOnly) return;

    const targetDate = dateStr || (planningType === "weekly" ? getLocalDateForWeekDay(day, selectedWeek) : activeCalendarDate);

    // 2. Rejection of past dates
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const targetMidnight = new Date(targetDate);
    targetMidnight.setHours(0, 0, 0, 0);

    if (targetMidnight.getTime() < today.getTime()) {
      alert(isRtl ? "لا يمكن جدولة زيارة في تاريخ سابق." : "Cannot schedule a visit for a past date.");
      return;
    }

    // 3. Check scope assignment
    const isAssigned = assignedPhysicians.some(p => p.id === doctor.id);
    if (!isAssigned) {
      alert(isRtl ? "هذا الطبيب ليس ضمن النطاق المسموح به لك." : "This physician is not within your allowed planning scope.");
      return;
    }

    // 4. Check duplicate time slot for the representative
    // 5. Check duplicate visit for the same physician on the same date
    const duplicatePhysicianDate = plannedVisits.some(v => v.physicianId === doctor.id && v.date === targetDate);
    if (duplicatePhysicianDate) {
      alert(isRtl ? "تمت جدولة هذا الطبيب بالفعل في هذا التاريخ." : "This physician is already scheduled on this date.");
      return;
    }
    const capacityCode = plannerCapacityCode(capacity, capacityVisits, { physicianId: doctor.id, date: targetDate, classification: doctor.classification }, planningType === "weekly" ? selectedWeekDates : calendarDaysForIsoWeek(targetDate));
    if (capacityCode) {
      alert(isRtl ? "تم الوصول إلى سعة التخطيط المفضلة لهذا التاريخ." : `Planning preference reached: ${capacityCode}.`);
      return;
    }

    const visitId = crypto.randomUUID();
    const newVisit: PlannedVisit = {
      id: visitId,
      physicianId: doctor.id,
      physicianName: doctor.name,
      specialty: doctor.specialty,
      day: day,
      date: targetDate,
      month: selectedMonth,
      week: selectedWeek,
      repId: selectedRepId,
      repName: selectedRepUser.name,
      planningType: planningType,
      isUnplanned: isUnplannedField,
      status: "PLANNED",
      mode: "MANUAL"
    };
    setPlannedVisits(existing => [...existing, newVisit]); setFrequencyReservations(existing => [...existing, newVisit]); setPlanState("DRAFT");
  };

  // Remove scheduled visit
  const handleRemoveVisit = (id: string) => {
    if (isReadOnly) return;

    setPlannedVisits(existing => existing.filter(candidate => candidate.id !== id)); setFrequencyReservations(existing => existing.filter(candidate => candidate.id !== id)); setPlanState("DRAFT");
  };

  const handleRescheduleVisit = (visit: PlannedVisit, targetDate = selectedPlanDate) => {
    if (isReadOnly || !targetDate || !configuredWorkingDays.some(day => day.date === targetDate)) return;
    const otherVisits = capacityVisits.filter(candidate => !(candidate.physicianId === visit.physicianId && candidate.date === visit.date));
    const classification = assignedPhysicians.find(physician => physician.id === visit.physicianId)?.classification;
    const capacityCode = plannerCapacityCode(capacity, otherVisits, { physicianId: visit.physicianId, date: targetDate, classification }, selectedWeekDates);
    if (capacityCode) { alert(`Planning preference reached: ${capacityCode}.`); return; }
    const targetDay = configuredWorkingDays.find(day => day.date === targetDate)?.name || visit.day;
    const moved = { ...visit, ...(visit.status === "SAVED" ? { id: crypto.randomUUID(), status: "PLANNED" as const, mode: "MANUAL" as const } : {}), date: targetDate, day: targetDay };
    setPlannedVisits(existing => existing.map(item => item.id === visit.id ? moved : item));
    setFrequencyReservations(existing => existing.filter(item => item.id !== visit.id).concat(moved)); setPlanState("DRAFT");
  };

  // Reset/Clear all visits in current period
  const handleClearPeriod = async () => {
    if (isReadOnly) return;

    if (!window.confirm(isRtl ? "هل أنت متأكد من مسح جميع الزيارات المخططة لهذه الفترة؟" : "Are you sure you want to clear all planned visits in this period?")) {
      return;
    }
    setPlannedVisits([]); setFrequencyReservations(existing => existing.filter(visit => visit.planningType !== planningType || visit[planningType === "weekly" ? "week" : "month"] !== periodKey)); setPlanState("DRAFT");
  };

  const handleAutoPlan = async () => {
    if (isReadOnly || isAutoPlanning) return;
    const dates = selectedWeekDates;
    if (planningType !== "weekly" || !dates.length) { setAutoPlanMessage(isRtl ? "إعداد أيام العمل الإقليمية مطلوب." : "Regional working-day configuration is required."); return; }
    setIsAutoPlanning(true); setShowAiModal(true); setAutoPlanMessage("");
    const working: PlannedVisit[] = []; let created = 0;
    const currentVisitIds = new Set(plannedVisits.map(visit => visit.id));
    try {
      for (const date of dates) {
        for (const doctor of filterablePhysicians) {
          const candidate = { physicianId: doctor.id, date, classification: doctor.classification };
          const weekDates = calendarDaysForIsoWeek(date);
          if (plannerCapacityCode(capacity, working.map(visit => ({ physicianId: visit.physicianId, date: visit.date, classification: assignedPhysicians.find(item => item.id === visit.physicianId)?.classification })), candidate, weekDates)) continue;
          const records = frequencyRecords.filter(record => !currentVisitIds.has(record.id)).concat(working.map(visit => ({ ...visit, kind: "PLANNED" as const })));
          if (!evaluatePlannerEligibility(doctor.targetFrequency, date, records.filter(record => record.physicianId === doctor.id)).eligible) continue;
          const id = crypto.randomUUID();
          const visit: PlannedVisit = { id, physicianId: doctor.id, physicianName: doctor.name, specialty: doctor.specialty, day: configuredWorkingDays.find(item => item.date === date)?.name || "", date, month: date.slice(0, 7), week: selectedWeek, repId: selectedRepId, repName: selectedRepUser.name, planningType, isUnplanned: false, status: "PLANNED", mode: "AUTO" };
          working.push(visit); created++;
        }
      }
      setPlannedVisits(working); setFrequencyReservations(existing => [...existing.filter(visit => !currentVisitIds.has(visit.id)), ...working]); setPlanState("DRAFT");
      setAutoPlanMessage(created ? `${created} eligible visit${created === 1 ? "" : "s"} added. You can edit or remove them.` : "No eligible suggestions could be added. Manual planning remains available.");
    } finally { setIsAutoPlanning(false); setShowAiModal(false); }
  };

  const handleSaveWeek = async () => {
    if (isReadOnly || planningType !== "weekly" || isSaving) return;
    setIsSaving(true);
    const stagedNewIds: string[] = [];
    try {
      for (const visit of plannedVisits) { await createAuthorizedMedicalPlan({ id: visit.id, repId: visit.repId, physicianId: visit.physicianId, date: visit.date, planningType: "weekly", week: selectedWeek, month: visit.date.slice(0, 7), isUnplanned: false }, visit.mode || "MANUAL"); if (visit.status === "PLANNED") stagedNewIds.push(visit.id); }
      await saveAuthorizedMedicalPlannerWeek({ repId: selectedRepId, planningType: "weekly", period: selectedWeek, visitIds: plannedVisits.map(visit => visit.id) });
      setPlannedVisits(existing => existing.map(visit => ({ ...visit, status: "SAVED" })));
      setFrequencyReservations(existing => existing.map(visit => visit.week === selectedWeek ? { ...visit, status: "SAVED", planStatus: "SAVED" } : visit));
      setPlanState("SAVED"); setAutoPlanMessage("Weekly plan saved.");
      window.dispatchEvent(new CustomEvent("menareps:medical-planner-saved"));
      await logAudit("Weekly Plan Saved", `Saved ${plannedVisits.length} visits for ${selectedWeek} for rep ${selectedRepUser.name}`);
    } catch (error) { for (const visitId of stagedNewIds) { try { await executeAuthorizedMedicalPlannerAction({ repId: selectedRepId, planningType: "weekly", period: selectedWeek, action: "REMOVE_VISIT", visitId }); } catch { /* Preserve the original save error; server authorization still guards cleanup. */ } } handleFirestoreError(error, OperationType.UPDATE, "medicalPlannerVisits/weekly-save"); }
    finally { setIsSaving(false); }
  };

  const getCalendarDays = (month: string) => {
    if (!/^\d{4}-\d{2}$/.test(month)) return [];
    const [year, monthNumber] = month.split("-").map(Number);
    const days = [];
    const leading = new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay();
    for (let index = 0; index < leading; index++) days.push({ dayNumber: null, dateStr: "" });
    const count = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    for (let day = 1; day <= count; day++) {
      days.push({ dayNumber: day, dateStr: `${month}-${String(day).padStart(2, "0")}` });
    }
    return days;
  };

  const calendarDays = getCalendarDays(selectedMonth);
  const selectedDateVisits = plannedVisits.filter(v => v.date === activeCalendarDate);
  const lastVisitFor = (physicianId: string) => completedVisits.filter(visit => visit.physicianId === physicianId).map(visit => visit.visitDate || visit.date).filter(Boolean).sort().at(-1) || "";
  const lastVisitDisplay = (physicianId: string) => {
    const date = lastVisitFor(physicianId); const presentation = plannerLastVisitPresentation(date ? [date] : []); if (!presentation.exact) return { exact: "Never", relative: "" }; const elapsed = presentation.elapsedDays || 0;
    return { exact: new Intl.DateTimeFormat(isRtl ? "ar" : "en", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`)), relative: elapsed === 0 ? "Today" : `${elapsed} day${elapsed === 1 ? "" : "s"} ago` };
  };

  return (
    <div className="space-y-6" id="medical-planner-module" dir={isRtl ? "rtl" : "ltr"}>
      
      {/* Page Header */}
      <div className="p-6 bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 border border-slate-800 rounded-2xl shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 rounded-full text-[10px] font-mono font-bold tracking-widest uppercase">
              MENAREPS 2.0 Detailing Core
            </span>
            <span className="px-2.5 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-full text-[10px] font-mono font-bold tracking-widest uppercase flex items-center gap-1">
              <CheckCircle size={10} /> Firestore Active
            </span>
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-2">
            <CalendarIcon className="text-indigo-400" />
            {isRtl ? "مخطط الزيارات الطبية والترويجية" : "Medical Field Detailing Planner"}
          </h1>
          <p className="text-xs text-slate-300 max-w-2xl leading-relaxed">
            {isRtl 
              ? "خطط لزيارات الأطباء، وراقب حالة الاعتماد والمسارات الجغرافية مع الالتزام بقواعد التغطية."
              : "Strategize medical representative detailing paths, balance sample allocation weights, and sync planners securely to Firestore."}
          </p>
        </div>

        {/* AI Auto-Planner Glowing Trigger */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handleAutoPlan}
            disabled={isAutoPlanning || isReadOnly}
            className="px-4 py-2.5 bg-gradient-to-r from-indigo-600 via-violet-600 to-indigo-600 hover:from-indigo-500 hover:to-violet-500 text-white text-xs font-bold rounded-xl shadow-lg hover:shadow-indigo-500/10 flex items-center gap-2 transition-all cursor-pointer disabled:opacity-40 animate-pulse active:scale-95"
            id="btn-auto-planner"
          >
            <Sparkles size={14} className={isAutoPlanning ? "animate-spin text-amber-300" : "text-amber-200"} />
            {isAutoPlanning 
              ? (isRtl ? "جاري جدولة المسار..." : "AI Optimizing...") 
              : (isRtl ? "إنشاء الخطة الأسبوعية" : plannedVisits.length ? "Regenerate Weekly Plan" : "Generate Weekly Plan")}
          </button>
        </div>
      </div>

      {planningType === "weekly" && <section className="md:hidden space-y-3" id="mobile-weekly-plan">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
          <div className="flex items-start justify-between"><div><h2 className="text-sm font-black text-slate-900 dark:text-white">MY WEEKLY PLAN</h2><p className="text-xs text-slate-500">{plannerWeekRange(selectedWeek, isRtl ? "ar" : "en")}</p></div><span className={`rounded-full px-2 py-1 text-[9px] font-black ${planState === "SAVED" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{planState}</span></div>
          <p className="text-lg font-black text-indigo-600">{plannedVisits.length} / {capacity.totalVisitsPerWeek} <span className="text-xs font-medium text-slate-500">visits</span></p>
          {!isReadOnly && <button onClick={handleAutoPlan} className="min-h-11 w-full rounded-xl bg-indigo-600 text-white text-xs font-bold">{plannedVisits.length ? "Regenerate Plan" : "Generate Weekly Plan"}</button>}
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {configuredWorkingDays.map(day => <button key={day.date} onClick={() => { setMobileDayDate(day.date); setSelectedDay(day.name); }} className="flex min-h-12 w-full items-center justify-between py-2 text-left"><span><strong className="block text-xs text-slate-800 dark:text-white">{day.name.toUpperCase()}</strong><span className="text-[10px] text-slate-400">{day.date}</span></span><span className="text-xs font-bold text-indigo-600">{plannedVisits.filter(visit => visit.date === day.date).length} visits ›</span></button>)}
          </div>
        </div>
        {mobileDayDate && <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3" id="mobile-planner-day-detail">
          <div className="flex items-center justify-between"><div><h3 className="text-sm font-black">{configuredWorkingDays.find(day => day.date === mobileDayDate)?.name}</h3><p className="text-[10px] text-slate-400">{mobileDayDate}</p></div>{!isReadOnly && <a href="#planner-physician-browser" className="min-h-10 px-3 rounded-lg bg-indigo-50 text-indigo-700 flex items-center text-[10px] font-black">+ ADD PHYSICIAN</a>}</div>
          {plannedVisits.filter(visit => visit.date === mobileDayDate).map((visit, index) => { const doctor = assignedPhysicians.find(item => item.id === visit.physicianId); const last = lastVisitDisplay(visit.physicianId); return <article key={visit.id} className="rounded-xl border border-slate-100 dark:border-slate-800 p-3 space-y-2">
            <div><p className="text-xs font-black">{index + 1}. Dr. {visit.physicianName}</p><p className="text-[10px] text-slate-500">{visit.specialty} · Class {doctor?.classification || "—"}</p><p className="text-[10px] text-slate-500">{doctor?.area || doctor?.territory || "—"}</p></div>
            <div className="text-[10px]"><p>Target Frequency: {doctor?.targetFrequency ?? "—"}</p><p>Last Visit: {last.exact}</p>{last.relative && <p className="text-slate-400">{last.relative}</p>}</div>
            {!isReadOnly && <div className="flex gap-2"><select aria-label="Move physician" value={visit.date} onChange={event => handleRescheduleVisit(visit, event.target.value)} className="min-h-10 flex-1 rounded-lg border bg-transparent px-2 text-[10px]">{configuredWorkingDays.map(day => <option key={day.date} value={day.date}>Move to {day.name}</option>)}</select><button onClick={() => handleRemoveVisit(visit.id)} className="min-h-10 rounded-lg border border-rose-200 px-3 text-[10px] font-bold text-rose-600">Remove</button></div>}
          </article>; })}
          {!plannedVisits.some(visit => visit.date === mobileDayDate) && <p className="py-5 text-center text-xs text-slate-400">No physicians planned for this working day.</p>}
        </div>}
        {!isReadOnly && <div className="sticky bottom-2 z-20"><button onClick={handleSaveWeek} disabled={isSaving} className="min-h-12 w-full rounded-xl bg-emerald-600 text-white text-sm font-black shadow-lg disabled:opacity-50">{isSaving ? "Saving…" : planState === "SAVED" ? "WEEKLY PLAN SAVED" : "SAVE WEEKLY PLAN"}</button></div>}
      </section>}

      {/* Role and Rep Selector (Managers / Supervisors see all, Reps locked to own) */}
      <div className="p-4 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl flex flex-col sm:flex-row items-center justify-between gap-4 shadow-2xs">
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="p-2.5 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 rounded-lg">
            <Briefcase size={18} />
          </div>
          <div className="space-y-0.5">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-mono">
              {isRtl ? "نطاق الصلاحيات والأمن" : "Secure Operational Context"}
            </p>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-slate-850 dark:text-slate-100">
                {currentUser.name}
              </span>
              <span className="px-1.5 py-0.5 bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900 text-indigo-700 dark:text-indigo-300 text-[8.5px] font-black rounded uppercase">
                {currentUser.role}
              </span>
            </div>
          </div>
        </div>

        {/* Interactive Subordinate Rep Dropdown for Supervisors / Managers */}
        {!isRep ? (
          <div className="flex items-center gap-2.5 w-full sm:w-auto border-t sm:border-t-0 pt-3 sm:pt-0">
            <span className="text-xxs font-black uppercase text-slate-400 tracking-wider flex items-center gap-1 shrink-0">
              <UserCheck size={12} className="text-indigo-500" />
              {isRtl ? "المندوب المستهدف:" : "View Representative:"}
            </span>
            <select
              value={selectedRepId}
              onChange={(e) => setSelectedRepId(e.target.value)}
              className="w-full sm:w-60 px-3 py-1.5 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-950 text-xs font-bold text-slate-800 dark:text-slate-200 shadow-3xs focus:ring-1 focus:ring-indigo-500 focus:outline-hidden cursor-pointer"
            >
              {medicalReps.map(rep => (
                <option key={rep.id} value={rep.id}>
                  {rep.name} ({rep.role})
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="px-3 py-1.5 bg-slate-50 dark:bg-slate-950/60 border border-slate-100 dark:border-slate-850 rounded-lg text-xxs font-semibold text-slate-500 flex items-center gap-1">
            <Compass size={12} className="text-indigo-400" />
            {isRtl ? "تم تصفية قائمة الأطباء تلقائياً للمندوب المخصص" : "Automatically showing physicians assigned to your medical territory"}
          </div>
        )}
      </div>

      {/* Control Row: Week/Month Planning Modes, Periods, & Approvals */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
        
        {/* Planning Horizon Navigation & Approvals Status Card */}
        <div className="md:col-span-8 bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="flex flex-wrap items-center gap-3">
            {/* Mode Select Tabs */}
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

            {/* Period selector dropdowns */}
            {planningType === "weekly" ? (
              <select
                value={selectedWeek}
                onChange={(e) => setSelectedWeek(e.target.value)}
                className="px-2.5 py-1.5 border border-slate-200 dark:border-slate-800 rounded bg-white dark:bg-slate-950 text-xxs font-bold text-slate-700 dark:text-slate-300 cursor-pointer shadow-3xs"
              >
                <option value="" disabled>{isRtl ? "اختر الأسبوع" : "Select week"}</option>
                {weeksList.map(w => (
                  <option key={w} value={w}>{w}</option>
                ))}
              </select>
            ) : (
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="px-2.5 py-1.5 border border-slate-200 dark:border-slate-800 rounded bg-white dark:bg-slate-950 text-xxs font-bold text-slate-700 dark:text-slate-300 cursor-pointer shadow-3xs"
              >
                <option value="" disabled>{isRtl ? "اختر الشهر" : "Select month"}</option>
                {monthsList.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            )}

            {/* Clear All Button */}
            {plannedVisits.length > 0 && !isReadOnly && (
              <button
                onClick={handleClearPeriod}
                className="px-2 py-1 border border-rose-200 hover:bg-rose-50 text-rose-600 dark:border-rose-950 dark:hover:bg-rose-950/20 rounded text-[9.5px] font-black uppercase tracking-wider flex items-center gap-1 transition-colors cursor-pointer"
              >
                <RotateCcw size={10} />
                {isRtl ? "مسح الخطة" : "Reset Grid"}
              </button>
            )}
          </div>

          {/* Representative-owned Planner status */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-400">
              {isRtl ? "ملكية الخطة:" : "Plan access:"}
            </span>
            <div className="px-2.5 py-1 rounded-lg text-xxs font-black uppercase tracking-widest flex items-center gap-1.5 bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              {isReadOnly ? (isRtl ? "عرض فقط" : "Manager read only") : (isRtl ? "خطة شخصية" : "Representative owned")}
            </div>
          </div>
        </div>

        {/* Planner is a supporting personal tool; no approval workflow. */}
        <div className="md:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex items-center justify-end shadow-2xs">
          <p className="text-center text-xxs text-slate-500 font-mono w-full">
            {isReadOnly ? (isRtl ? "يمكن للمدير عرض خطط المندوبين التابعين فقط." : "Managers can only view canonical descendant plans.") : (isRtl ? "يمكنك إضافة زياراتك أو تعديلها أو إزالتها دون موافقة." : "Create, reschedule, or remove your own visits without approval.")}
          </p>
        </div>

      </div>

      {/* Main Grid: Physicians alignment master vs Schedule Views */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column (Span 4): Physicians selection for current territory rep */}
        <div id="planner-physician-browser" className="lg:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4 shadow-3xs flex flex-col justify-between h-fit min-h-[500px]">
          <div className="space-y-4">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-xs font-bold text-slate-850 dark:text-slate-100 uppercase tracking-wider font-mono flex items-center gap-2">
                <Users size={16} className="text-indigo-500" />
                {isRtl ? "أطباء الإقليم غير المجدولين" : "Unplanned Territory Doctors"}
              </h3>
              <span className="px-2 py-0.5 bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900 rounded-md text-[10px] font-bold text-indigo-600 dark:text-indigo-400">
                {filterablePhysicians.length} {isRtl ? "طبيب متبقي" : "Left"}
              </span>
            </div>

            {/* Rep-specific physician alignment details banner */}
            <div className="p-3 bg-slate-50 dark:bg-slate-950/40 border border-slate-100 dark:border-slate-850 rounded-lg space-y-2">
              <p className="text-[10px] font-bold text-slate-700 dark:text-slate-300">
                {isRtl ? "الإقليم ومسارات التغطية:" : "Representative's Active Territory Alignment:"}
              </p>
              <div className="flex items-center gap-1.5 flex-wrap text-[9px] font-semibold text-slate-500">
                <span className="px-1.5 py-0.5 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded">
                  {selectedRepUser.region || (isRtl ? "غير مهيأ" : "Not configured")}
                </span>
                <span>/</span>
                <span className="px-1.5 py-0.5 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded text-indigo-600 dark:text-indigo-400">
                  {selectedRepUser.territory || (isRtl ? "غير مهيأ" : "Not configured")}
                </span>
              </div>
            </div>

            {/* Authorized-pool cascading multi-select filters */}
            <div className="grid grid-cols-2 gap-2">
              {([
                ["cityId", "City", plannerMetadata.geography.cities],
                ["areaId", "Area", plannerMetadata.geography.areas],
                ["specialtyId", "Specialty", plannerMetadata.specialties],
                ["classification", "Class", cascadeOptions.classification.map((id: string) => ({ id, name: id }))],
                ["promotionGroupId", "Promotion Group", plannerMetadata.promotionGroups],
              ] as const).map(([key, label, registry]) => <PlannerMultiSelect key={key} label={label} disabled={isReadOnly} selected={filters[key]} onToggle={id => setFilters(current => ({ ...current, [key]: togglePlannerFilter(current[key], id) }))} options={cascadeOptions[key].map(id => { const row = (registry as readonly any[]).find(item => item.id === id); return { id, name: row?.name || row?.nameEn || row?.areaName || row?.cityName || id }; })} />)}
            </div>
            <input
              type="text"
              placeholder={isRtl ? "البحث بالاسم أو التخصص..." : "Filter by specialty, name, or class..."}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              disabled={isReadOnly}
              className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-transparent text-slate-800 dark:text-white placeholder-slate-400 focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
            />

            <div className="p-3 bg-slate-50 dark:bg-slate-950/40 border border-slate-100 dark:border-slate-850 rounded-lg space-y-2">
              <div className="flex items-center justify-between"><p className="text-[9.5px] font-black uppercase text-slate-500">Plan Capacity / Configure Plan</p><span className="text-[8px] text-slate-400">Personal preferences</span></div>
              <div className="grid grid-cols-2 gap-2">
                {([
                  ["totalVisitsPerDay", "Total Visits Per Day"], ["totalVisitsPerWeek", "Total Visits Per Week"],
                  ["samePhysicianPerDay", "Same Physician Per Day"], ["samePhysicianPerWeek", "Same Physician Per Week"],
                  ["maxClassAVisitsPerDay", "Max Class A Visits Per Day"],
                ] as const).map(([key, label]) => <label key={key} className="text-[8.5px] font-bold text-slate-500">{label}<input type="number" min={1} max={100} disabled={isReadOnly} value={capacity[key]} onChange={event => updateCapacity(key, Number(event.target.value))} className="mt-1 w-full rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-2 py-1 text-[10px]" /></label>)}
              </div>
              <p className="text-[8px] text-slate-400">Preferences can narrow suggestions; physician target frequency and canonical scope remain authoritative.</p>
            </div>

            {/* Quick Schedule Selector Box */}
            <div className="p-3.5 bg-indigo-50/40 dark:bg-indigo-950/10 border border-indigo-100/30 dark:border-indigo-950/40 rounded-lg space-y-3">
              <div className="flex justify-between items-center">
                <p className="text-[9.5px] font-bold text-slate-400 font-mono uppercase tracking-wider">
                  {isRtl ? "محدد الموقت المسبق:" : "Detailing Block Selector:"}
                </p>
                {/* Planned vs Unplanned Ad-hoc Toggle */}
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={isUnplannedField}
                    onChange={(e) => setIsUnplannedField(e.target.checked)}
                    disabled={isReadOnly}
                    className="rounded border-slate-300 dark:border-slate-800 text-indigo-600 focus:ring-indigo-500 w-3 h-3"
                  />
                  <span className={`text-[9px] font-black uppercase tracking-wider ${isUnplannedField ? "text-amber-500" : "text-slate-400"}`}>
                    {isUnplannedField ? "Ad-hoc (Unplanned)" : "Planned Visit"}
                  </span>
                </label>
              </div>

              <div className="grid grid-cols-1 gap-2">
                {planningType === "weekly" ? (
                  <select
                    value={selectedDay}
                    onChange={(e) => setSelectedDay(e.target.value)}
                    className="px-2 py-1.5 border border-slate-200 dark:border-slate-800 rounded bg-white dark:bg-slate-950 text-xxs font-bold text-slate-700 dark:text-slate-300 cursor-pointer focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="" disabled>{isRtl ? "اختر اليوم" : "Select day"}</option>
                    {configuredWorkingDays.map(d => (
                      <option key={d.date} value={d.name}>{d.name} · {d.date}</option>
                    ))}
                  </select>
                ) : (
                  <select
                    value={activeCalendarDate}
                    onChange={(e) => setActiveCalendarDate(e.target.value)}
                    className="px-2 py-1.5 border border-slate-200 dark:border-slate-800 rounded bg-white dark:bg-slate-950 text-xxs font-bold text-slate-700 dark:text-slate-300 cursor-pointer focus:ring-1 focus:ring-indigo-500"
                  >
                    {calendarDays.filter(d => d.dayNumber !== null).map(d => (
                      <option key={d.dateStr} value={d.dateStr}>{d.dateStr}</option>
                    ))}
                  </select>
                )}

              </div>
            </div>

            {/* List of physicians */}
            <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
              {isLoading ? (
                <div className="py-12 flex flex-col items-center justify-center space-y-2">
                  <span className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                  <span className="text-[10px] text-slate-400 font-mono">Syncing Territory Alignment...</span>
                </div>
              ) : filterablePhysicians.length > 0 ? (
                filterablePhysicians.map((doc) => (
                  <div
                    key={doc.id}
                    className="p-3 border border-slate-100 dark:border-slate-800/80 rounded-xl hover:border-indigo-400/80 dark:hover:border-indigo-800/80 transition-all flex justify-between items-start bg-slate-50/20 dark:bg-slate-950/20 shadow-4xs"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5">
                        <h4 className="font-bold text-xs text-slate-800 dark:text-slate-100">Dr. {doc.name}</h4>
                        {doc.keyOpinionLeader === "Yes" && (
                          <span className="px-1 bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 text-[8px] font-bold rounded">KOL</span>
                        )}
                      </div>
                      <p className="text-[10px] text-slate-400 font-medium">{doc.specialty} • {doc.area || doc.city || (isRtl ? "الموقع غير مكوّن" : "Geography not configured")}</p>
                      
                      <div className="flex items-center gap-1.5">
                        <span className="px-1.5 py-0.5 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 text-[8px] font-mono font-bold rounded">
                          Class {doc.classification || doc.segment || (isRtl ? "غير مكوّن" : "Configuration required")}
                        </span>
                        {doc.targetFrequency && (
                          <span className="text-[9px] text-slate-400 font-medium">Target Frequency: {doc.targetFrequency}</span>
                        )}
                      </div>
                      {(() => {
                        const eligibility = evaluatePlannerEligibility(doc.targetFrequency, selectedPlanDate, frequencyRecords.filter(record => record.physicianId === doc.id));
                        return <p className={`text-[9px] font-semibold ${eligibility.eligible ? "text-emerald-600" : "text-amber-600"}`}>
                          {!selectedPlanDate ? "Select a planning date to check eligibility" : eligibility.eligible ? `Eligible — ${eligibility.used} / ${eligibility.targetFrequency} used` : eligibility.code === "TARGET_REACHED" ? `Target reached — ${eligibility.used} / ${eligibility.targetFrequency}` : eligibility.nextEligibleDate ? `Next eligible: ${eligibility.nextEligibleDate}` : "Target frequency configuration required"}
                        </p>;
                      })()}
                    </div>

                    <button
                      onClick={() => handleScheduleDoctor(doc, selectedDay)}
                      disabled={isReadOnly || !evaluatePlannerEligibility(doc.targetFrequency, selectedPlanDate, frequencyRecords.filter(record => record.physicianId === doc.id)).eligible || (planningType === "weekly" ? (!selectedWeek || !selectedDay) : (!selectedMonth || !activeCalendarDate))}
                      className="p-2 bg-indigo-50 dark:bg-indigo-950/40 hover:bg-indigo-600 hover:text-white text-indigo-600 dark:text-indigo-400 disabled:opacity-40 disabled:hover:bg-indigo-50 rounded-xl transition-all cursor-pointer active:scale-95 shadow-4xs"
                      title={isRtl ? "إضافة للجدول" : "Place in Schedule"}
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                ))
              ) : (
                <div className="text-center py-10 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                  <Users className="mx-auto text-slate-300 dark:text-slate-700 mb-2" size={24} />
                  <p className="text-[10px] text-slate-400 font-mono px-3">
                    {assignedPhysicians.length === 0 
                      ? (isRtl ? "لا يوجد أطباء في نطاقك المصرح به." : "No physicians are available in the authorized scope.")
                      : (isRtl ? "لا يوجد أطباء يطابقون المرشحات المحددة." : "No physicians match the selected filters.")}
                  </p>
                </div>
              )}
            </div>
          </div>
          {autoPlanMessage && <p className="text-[10px] text-indigo-600 dark:text-indigo-300">{autoPlanMessage}</p>}

          <div className="pt-4 border-t border-slate-100 dark:border-slate-800/80">
            <p className="text-[9px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-widest font-mono flex items-center gap-1">
              <Compass size={11} className="animate-pulse" />
              {isRtl ? "الامتثال وقواعد الأمن الميداني" : "Field Compliance Integrity:"}
            </p>
            <p className="text-[9px] text-slate-400 leading-relaxed mt-1">
              {isRtl 
                ? "التخطيط أداة شخصية مساعدة ولا يشترط لإجراء زيارة ميدانية غير مخططة."
                : "Planning is a personal support tool and is not required for an authorized unplanned field visit."}
            </p>
          </div>
        </div>

        {/* Right Column (Span 8): Interactive Schedules Maps & Visualizer */}
        <div className="lg:col-span-8 space-y-4">
          
          {/* Calendar visualizer based on active Tab Mode */}
          {planningType === "weekly" ? (
            /* WEEKLY GRID: Mon - Fri columns */
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4 shadow-3xs">
              <div className="flex justify-between items-center">
                <h3 className="text-xs font-bold text-slate-850 dark:text-slate-100 uppercase tracking-wider font-mono flex items-center gap-2">
                  <CalendarIcon size={16} className="text-indigo-500" />
                  {isRtl ? "مخطط الأسبوع الميداني الفعال" : "Weekly Detailing Schedule Map"}
                </h3>
                <span className="text-xxs text-slate-400 font-mono">
                  {isRtl ? "الأسبوع المستهدف:" : "Selected Period:"} <strong className="text-indigo-600 dark:text-indigo-400">{selectedWeek}</strong>
                </span>
              </div>

              {/* Day Column Grid */}
            <div className="hidden md:grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3" id="weekly-calendar-grid">
                {configuredWorkingDays.map((workingDay) => {
                  const day = workingDay.name; const dayVisits = plannedVisits.filter(v => v.date === workingDay.date);
                  return (
                    <div
                      key={day}
                      className="bg-slate-50/50 dark:bg-slate-950/40 border border-slate-100 dark:border-slate-850/60 rounded-xl p-3 min-h-[420px] flex flex-col space-y-3"
                    >
                      {/* Day Header */}
                      <div className="text-center pb-2.5 border-b border-slate-200/50 dark:border-slate-800/50 space-y-0.5">
                        <p className="text-[10px] font-black text-slate-800 dark:text-slate-200 uppercase font-mono tracking-tight">{day}</p>
                        <p className="text-[8.5px] font-bold text-slate-400 font-mono">{dayVisits.length} {isRtl ? "زيارات" : "planned"}</p>
                      </div>

                      {/* Day Visits List */}
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
                                <div className="flex items-start justify-between">
                                  <p className="text-[10px] font-black text-slate-800 dark:text-slate-100 leading-tight">
                                    Dr. {visit.physicianName}
                                  </p>
                                </div>
                                <p className="text-[9px] text-slate-400 font-semibold">{visit.specialty}</p>
                                
                                <div className="mt-1.5 flex items-center justify-between">
                                  <div className="text-[8px] font-mono text-indigo-500 dark:text-indigo-400 font-bold">{visit.date}</div>
                                  {visit.isUnplanned && (
                                    <span className="px-1 py-0.5 bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300 text-[7px] font-mono font-black rounded uppercase">
                                      Ad-hoc
                                    </span>
                                  )}
                                </div>
                              </div>

                              {/* Unschedule Hover Button */}
                              {!isReadOnly && (
                                <div className="absolute -top-1 right-1 flex gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100">
                                  <select aria-label="Move physician" value={visit.date} onChange={event => handleRescheduleVisit(visit, event.target.value)} className="max-w-24 rounded border bg-white text-[8px] text-indigo-600">{configuredWorkingDays.map(option => <option key={option.date} value={option.date}>{option.name}</option>)}</select>
                                  <button onClick={() => handleRemoveVisit(visit.id)} className="p-1 text-rose-600 hover:bg-rose-50 rounded" title={isRtl ? "إلغاء الموعد" : "Unschedule"}><Trash2 size={10} /></button>
                                </div>
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
              {!isReadOnly && <div className="hidden md:flex justify-end pt-4"><button onClick={handleSaveWeek} disabled={isSaving} className="min-h-11 rounded-xl bg-emerald-600 px-6 text-xs font-black text-white disabled:opacity-50">{isSaving ? "Saving…" : planState === "SAVED" ? "WEEKLY PLAN SAVED" : "SAVE WEEKLY PLAN"}</button></div>}
            </div>
          ) : (
            /* MONTHLY GRID: generated from the selected period */
            <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
              
              {/* Left span (7): 30-Day Calendar visualizer */}
              <div className="md:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4 shadow-3xs">
                <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-3">
                  <h3 className="text-xs font-bold text-slate-850 dark:text-slate-100 uppercase tracking-wider font-mono flex items-center gap-2">
                    <CalendarIcon size={16} className="text-indigo-500" />
                    {isRtl ? "رزنامة يونيو 2026 الترويجية" : "Interactive Monthly Detailing Calendar"}
                  </h3>
                  <span className="text-xxs font-black font-mono text-indigo-600 dark:text-indigo-400">{selectedMonth}</span>
                </div>

                {/* Day letters of the week */}
                <div className="grid grid-cols-7 gap-1 text-center text-[9px] font-black uppercase text-slate-400 font-mono">
                  <div>Sun</div>
                  <div>Mon</div>
                  <div>Tue</div>
                  <div>Wed</div>
                  <div>Thu</div>
                  <div>Fri</div>
                  <div>Sat</div>
                </div>

                {/* Grid cells */}
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
                            ? "bg-indigo-600 border-indigo-600 text-white shadow-md shadow-indigo-600/10"
                            : "bg-slate-50/40 border-slate-100 hover:border-indigo-400 text-slate-800 dark:bg-slate-950/40 dark:border-slate-850 dark:text-slate-200"
                        }`}
                      >
                        <span className="text-[10px] font-black font-mono">{day.dayNumber}</span>
                        
                        {/* Dot indicator for scheduled items */}
                        {dateVisitsCount > 0 && (
                          <div className="flex items-center gap-0.5 justify-end w-full">
                            <span className={`w-1.5 h-1.5 rounded-full ${isSelected ? "bg-amber-300" : "bg-indigo-500"}`} />
                            {dateVisitsCount > 1 && (
                              <span className={`text-[7px] font-mono font-bold ${isSelected ? "text-indigo-200" : "text-slate-400"}`}>
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

              {/* Right span (5): Active Day List & schedule details */}
              <div className="md:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4 shadow-3xs flex flex-col justify-between">
                <div className="space-y-4">
                  <div className="border-b border-slate-100 dark:border-slate-800 pb-3">
                    <p className="text-[10px] font-bold text-slate-400 font-mono uppercase tracking-wider">
                      {isRtl ? "مواعيد اليوم المختار:" : "Schedules for Active Date:"}
                    </p>
                    <h4 className="text-xs font-black text-indigo-600 dark:text-indigo-300 font-mono mt-0.5">
                      {activeCalendarDate}
                    </h4>
                  </div>

                  {/* Selected Date planned list */}
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
                              Dr. {visit.physicianName}
                            </h5>
                            
                            {/* Delete Button */}
                            {!isReadOnly && (
                              <div className="flex gap-1">
                                <button onClick={() => handleRescheduleVisit(visit)} disabled={!selectedPlanDate} className="p-1 text-indigo-600 hover:bg-indigo-50 rounded disabled:opacity-30" title="Move to selected date"><Clock size={11} /></button>
                                <button onClick={() => handleRemoveVisit(visit.id)} className="p-1 text-rose-600 dark:text-rose-400 hover:bg-rose-50 rounded"><Trash2 size={11} /></button>
                              </div>
                            )}
                          </div>
                          <p className="text-[10px] text-slate-400 font-medium">{visit.specialty}</p>
                          
                          <div className="flex items-center gap-1.5 mt-1">
                            <span className="text-[8.5px] font-mono font-bold text-indigo-600 dark:text-indigo-400">{visit.date}</span>
                            {visit.isUnplanned && (
                              <span className="px-1 py-0.5 bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300 text-[7px] font-mono font-black rounded uppercase">
                                Ad-hoc
                              </span>
                            )}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-10 border border-dashed border-slate-100 dark:border-slate-800 rounded-xl">
                        <CalendarIcon size={20} className="mx-auto text-slate-300 dark:text-slate-700 mb-1.5" />
                        <p className="text-[10px] text-slate-400 font-mono">
                          {isRtl ? "لا توجد زيارات ترويجية مخططة في هذا اليوم." : "No visits scheduled for this calendar date."}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="p-3 bg-indigo-50/30 dark:bg-indigo-950/10 border border-indigo-100/30 dark:border-indigo-900/30 rounded-lg flex items-center gap-2 text-xxs text-slate-500 leading-relaxed">
                  <Compass size={14} className="text-indigo-500 shrink-0" />
                  <span>{isRtl ? "انقر على أي خلية في الرزنامة لمراجعة زياراتها أو إضافة طبيب متاح." : "Select any calendar square to review, insert, or clear detailing schedules."}</span>
                </div>
              </div>

            </div>
          )}

          {/* Optional assist disclosure; route optimization is outside this task. */}
          <div className="p-4 bg-indigo-50/30 dark:bg-indigo-950/10 border border-indigo-100/30 dark:border-indigo-900/30 rounded-xl flex flex-col sm:flex-row items-center gap-4 text-xxs text-slate-600 dark:text-slate-300 leading-relaxed">
            <Sparkles size={18} className="text-indigo-500 shrink-0" />
            <div>
              <strong className="text-slate-850 dark:text-white font-bold block mb-0.5">
                {isRtl ? "مساعد التخطيط الاختياري" : "Optional Auto-Plan Assist"}
              </strong>
              <span>
                {isRtl 
                  ? "يقترح زيارات مؤهلة ضمن نطاقك وإعدادات السعة. تحسين المسار غير متاح حالياً، ويظل التخطيط اليدوي متاحاً."
                  : "Suggests eligible visits within your authorized scope and capacity preferences. Route optimization is not currently available; manual planning always remains available."}
              </span>
            </div>
          </div>

        </div>

      </div>

      {/* AI AUTO PLANNING SIMULATOR FLOATING MODAL */}
      {showAiModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-indigo-500/30 rounded-2xl p-6 max-w-sm w-full text-center space-y-6 shadow-2xl animate-fade-in">
            <div className="relative mx-auto w-16 h-16 flex items-center justify-center">
              {/* Outer pulsing ring */}
              <span className="absolute inset-0 rounded-full border border-indigo-500/40 animate-ping" />
              <div className="p-3.5 bg-indigo-500/20 text-indigo-400 rounded-full border border-indigo-500/30">
                <Sparkles size={28} className="animate-spin text-indigo-300" />
              </div>
            </div>

            <div className="space-y-1.5">
              <h3 className="text-sm font-black text-white uppercase tracking-wider font-mono">
                {isRtl ? "مساعد MENAREPS للتخطيط" : "MENAREPS Auto-Plan Assist"}
              </h3>
              <p className="text-xxs text-slate-400 leading-relaxed max-w-xs mx-auto">
                {isRtl
                  ? "جاري التحقق من النطاق والتكرار والسعة لكل اقتراح..."
                  : "Checking authorized scope, target frequency, and capacity for each suggestion..."}
              </p>
            </div>

            {/* Glowing fake matrix lines */}
            <div className="p-2 bg-slate-950 border border-slate-800 rounded-lg text-[8px] font-mono text-emerald-400 text-left space-y-0.5 max-h-24 overflow-hidden">
              <p className="animate-pulse">&gt; CHECKING SELECTED FILTERS...</p>
              <p>&gt; APPLYING CAPACITY PREFERENCES...</p>
              <p className="text-indigo-400">&gt; SERVER-VALIDATING EACH SUGGESTION...</p>
              <p className="text-slate-500">&gt; MANUAL PLANNING REMAINS AVAILABLE.</p>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
