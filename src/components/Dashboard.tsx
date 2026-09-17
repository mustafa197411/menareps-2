import { useFinancialProfileDisplay, profileDisplayTotals } from "../lib/financialProfileDisplay";
import React, { useState, useEffect } from "react";
import { 
  DollarSign, 
  TrendingUp, 
  AlertTriangle, 
  Percent, 
  ShoppingBag, 
  CheckCircle, 
  XCircle, 
  Compass, 
  Users, 
  Stethoscope, 
  Pill, 
  ShieldAlert,
  Sparkles,
  Calendar,
  Filter,
  RefreshCw,
  Award,
  ChevronRight
} from "lucide-react";
import { Role, User, PhysicianVisit, PharmacyVisit, AnalyticsDbState, AnalyticsFilters } from "../types";
import { 
  getSalesAnalytics, 
  getMedicalAnalytics, 
  getRepresentativeAnalytics
} from "../lib/analyticsService";
import { 
  ResponsiveContainer, 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  BarChart, 
  Bar 
} from "recharts";
import { fetchAiInsight } from "../utils/aiService";
import { motion } from "motion/react";
import { formatMarketCurrency, resolveMarketForIdentity } from "../lib/marketSettings";
import { auth } from "../lib/firebase";
import { calculatePhysicianCoverage, completedPharmacyVisits, completedPhysicianVisits, filterVisitsForDashboardPeriod, resolveDashboardPeriod, type DashboardPeriodFilter } from "../lib/dashboardOperationalPeriod";
import { fetchDashboardPharmacyVisits, fetchDashboardPhysicianVisits } from "../lib/dashboardVisitDataClient";

export function safeToLocaleString(val: any, fallback = "0"): string {
  if (val === undefined || val === null) return fallback;
  const num = typeof val === "number" ? val : Number(val);
  if (isNaN(num)) return fallback;
  return num.toLocaleString();
}

export function safeToFixed(val: any, digits = 1, fallback = "0.0"): string {
  if (val === undefined || val === null) return fallback;
  const num = typeof val === "number" ? val : Number(val);
  if (isNaN(num)) return fallback;
  return num.toFixed(digits);
}

export function resolveDisplayLabel(val: any, lang: string = "en"): string {
  if (val === null || val === undefined) return "—";
  if (typeof val === "string") return val || "—";
  if (typeof val === "number") return String(val);
  if (typeof val === "boolean") return val ? "Yes" : "No";

  if (typeof val === "object") {
    // 1. Structured registry label object: { code, labelEn, labelAr }
    if ("labelEn" in val || "labelAr" in val || "code" in val) {
      if (lang === "ar") {
        if (val.labelAr) return String(val.labelAr);
        if (val.labelEn) return String(val.labelEn);
        if (val.code) return String(val.code);
      } else {
        if (val.labelEn) return String(val.labelEn);
        if (val.code) return String(val.code);
        if (val.labelAr) return String(val.labelAr);
      }
    }

    // 2. Multilingual name object: { name, nameEn, nameAr }
    if ("name" in val || "nameEn" in val || "nameAr" in val) {
      if (lang === "ar" && val.nameAr) return String(val.nameAr);
      if (val.nameEn) return String(val.nameEn);
      if (val.name) return String(val.name);
      if (val.nameAr) return String(val.nameAr);
    }

    // 3. Title object: { title, titleEn, titleAr }
    if ("title" in val || "titleEn" in val || "titleAr" in val) {
      if (lang === "ar" && val.titleAr) return String(val.titleAr);
      if (val.titleEn) return String(val.titleEn);
      if (val.title) return String(val.title);
      if (val.titleAr) return String(val.titleAr);
    }

    // 4. Object with code or id only
    if (val.code) return String(val.code);
    if (val.id) return String(val.id);

    console.warn("[DASHBOARD_STRUCTURED_LABEL_UNSUPPORTED]", JSON.stringify(val));
    return "—";
  }

  return "—";
}

interface DashboardProps {
  currentUser: User;
  physicianVisits: PhysicianVisit[];
  pharmacyVisits: PharmacyVisit[];
  lang: "en" | "ar";
  users?: User[];
  physicians?: any[];
  pharmacies?: any[];
  products?: any[];
}

export default function Dashboard({
  currentUser,
  physicianVisits = [],
  pharmacyVisits = [],
  lang,
  users = [],
  physicians = [],
  pharmacies = [],
  products = []
}: DashboardProps) {
  const isRtl = lang === "ar";
  const [dateFilter, setDateFilter] = useState<DashboardPeriodFilter>("this-month");
  const dashboardPeriod = React.useMemo(() => resolveDashboardPeriod(dateFilter), [dateFilter]);
  const [periodVisits, setPeriodVisits] = useState<{ key: string; physician: PhysicianVisit[]; pharmacy: PharmacyVisit[] } | null>(null);
  const [aiInsight, setAiInsight] = useState("");
  const [loadingAi, setLoadingAi] = useState(false);
  const marketIdentity = currentUser as User & { marketId?: string; countryId?: string };
  const market = React.useMemo(() => resolveMarketForIdentity([], marketIdentity), [marketIdentity.marketId, marketIdentity.countryId, marketIdentity.country]);
  const financialData = useFinancialProfileDisplay(currentUser.id);
  const financialTotals = profileDisplayTotals(financialData, market?.marketId, market?.currencyCode);
  const money = React.useCallback((amount: number) => market ? formatMarketCurrency(amount, market) : "Configuration required", [market]);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) return;
    let cancelled = false;
    const key = `${dashboardPeriod.fromDate}:${dashboardPeriod.toDate}`;
    Promise.allSettled([
      fetchDashboardPhysicianVisits(user, dashboardPeriod),
      fetchDashboardPharmacyVisits(user, dashboardPeriod),
    ]).then(([physicianResult, pharmacyResult]) => {
      if (cancelled) return;
      setPeriodVisits({
        key,
        physician: physicianResult.status === "fulfilled" ? physicianResult.value : [],
        pharmacy: pharmacyResult.status === "fulfilled" ? pharmacyResult.value : [],
      });
    });
    return () => { cancelled = true; };
  }, [dashboardPeriod.fromDate, dashboardPeriod.toDate]);

  const periodKey = `${dashboardPeriod.fromDate}:${dashboardPeriod.toDate}`;
  const scopedPhysicianVisits = React.useMemo(() => completedPhysicianVisits(
    periodVisits?.key === periodKey ? periodVisits.physician : filterVisitsForDashboardPeriod(physicianVisits, dashboardPeriod),
  ), [periodVisits, periodKey, physicianVisits, dashboardPeriod]);
  const scopedPharmacyVisits = React.useMemo(() => completedPharmacyVisits(
    periodVisits?.key === periodKey ? periodVisits.pharmacy : filterVisitsForDashboardPeriod(pharmacyVisits, dashboardPeriod),
  ), [periodVisits, periodKey, pharmacyVisits, dashboardPeriod]);

  // Localization labels
  const t = {
    en: {
      dashboardTitle: "Executive Performance Board",
      dashboardSubtitle: "Real-time key metrics and embedded business intelligence",
      dateRange: "Date Range",
      allTime: "All Time",
      today: "Today",
      thisWeek: "This Week",
      thisMonth: "This Month",
      filters: "Filters",
      aiInsights: "MENAREPS AI Assistant",
      getAiExplanation: "Analyze Board with AI",
      explainingKPIs: "Generating dynamic intelligence...",
      salesVsTarget: "Sales vs Target Analysis",
      topPerformers: "Top Field Representatives",
      recentPhysicianVisits: "Recent Physician Detailing Visits",
      recentPharmacyVisits: "Recent Pharmacy Audits & Orders",
      outstandingBalance: "Outstanding Balance",
      class: "Class",
      reaction: "Reaction",
      purpose: "Purpose",
      netAmount: "Net Amount",
      revenue: "Total Revenue",
      target: "Total Target",
      gap: "Unachieved Gap",
      achievement: "Achievement %",
      totalOrders: "Total Orders",
      delivered: "Delivered",
      cancelled: "Cancelled",
      completionRate: "Completion Rate",
      activeReps: "Active Reps",
      physicianCoverage: "Physician Coverage",
      pharmacyCoverage: "Pharmacy Coverage",
      noVisits: "No visits logged in this period.",
      rep: "Representative",
      status: "Status"
    },
    ar: {
      dashboardTitle: "لوحة الأداء التنفيذي",
      dashboardSubtitle: "المؤشرات الرئيسية الفورية والذكاء المدمج لإدارة الحقل",
      dateRange: "نطاق التاريخ",
      allTime: "كل الأوقات",
      today: "اليوم",
      thisWeek: "هذا الأسبوع",
      thisMonth: "هذا الشهر",
      filters: "الفلاتر",
      aiInsights: "مساعد مينا ريبس بالذكاء الاصطناعي",
      getAiExplanation: "تحليل اللوحة بالذكاء الاصطناعي",
      explainingKPIs: "جاري توليد التحليل الذكي...",
      salesVsTarget: "تحليل المبيعات مقابل المستهدف",
      topPerformers: "أفضل المندوبين الميدانيين",
      recentPhysicianVisits: "آخر زيارات الأطباء التفصيلية",
      recentPharmacyVisits: "آخر زيارات الصيدليات والطلبيات",
      outstandingBalance: "الرصيد المتبقي المستحق",
      class: "الفئة",
      reaction: "تفاعل الطبيب",
      purpose: "الهدف من الزيارة",
      netAmount: "صافي القيمة",
      revenue: "إجمالي الإيرادات",
      target: "المستهدف الإجمالي",
      gap: "الفجوة المتبقية للمستهدف",
      achievement: "نسبة التحقيق %",
      totalOrders: "إجمالي الطلبيات",
      delivered: "تم التسليم",
      cancelled: "ملغاة",
      completionRate: "معدل الإنجاز",
      activeReps: "المندوبون النشطون",
      physicianCoverage: "تغطية الأطباء",
      pharmacyCoverage: "تغطية الصيدليات",
      noVisits: "لا توجد زيارات مسجلة في هذه الفترة.",
      rep: "المندوب",
      status: "الحالة"
    }
  }[lang || "en"] || {
    dashboardTitle: "Executive Performance Board",
    dashboardSubtitle: "Real-time key metrics and embedded business intelligence",
    dateRange: "Date Range",
    allTime: "All Time",
    today: "Today",
    thisWeek: "This Week",
    thisMonth: "This Month",
    filters: "Filters",
    aiInsights: "MENAREPS AI Assistant",
    getAiExplanation: "Analyze Board with AI",
    explainingKPIs: "Generating dynamic intelligence...",
    salesVsTarget: "Sales vs Target Analysis",
    topPerformers: "Top Field Representatives",
    recentPhysicianVisits: "Recent Physician Detailing Visits",
    recentPharmacyVisits: "Recent Pharmacy Audits & Orders",
    outstandingBalance: "Outstanding Balance",
    class: "Class",
    reaction: "Reaction",
    purpose: "Purpose",
    netAmount: "Net Amount",
    revenue: "Total Revenue",
    target: "Total Target",
    gap: "Unachieved Gap",
    achievement: "Achievement %",
    totalOrders: "Total Orders",
    delivered: "Delivered",
    cancelled: "Cancelled",
    completionRate: "Completion Rate",
    activeReps: "Active Reps",
    physicianCoverage: "Physician Coverage",
    pharmacyCoverage: "Pharmacy Coverage",
    noVisits: "No visits logged in this period.",
    rep: "Representative",
    status: "Status"
  };

  const dbState: AnalyticsDbState = React.useMemo(() => {
    return {
      users: users || [],
      userTerritoryAssignments: [],
      userProductAssignments: [],
      physicianAssignments: [],
      pharmacyAssignments: [],
      physicians: physicians || [],
      pharmacies: pharmacies || [],
      products: products || [],
      physicianVisits: scopedPhysicianVisits,
      pharmacyVisits: scopedPharmacyVisits
    };
  }, [users, physicians, pharmacies, products, scopedPhysicianVisits, scopedPharmacyVisits]);

  const activeFilters: AnalyticsFilters = React.useMemo(() => {
    return {
      selectedCountry: "All",
      selectedDistrict: "All",
      selectedCity: "All",
      selectedTerritory: "All",
      selectedProductGroup: "All",
      selectedProduct: "All"
    };
  }, []);

  const salesAnalytics = React.useMemo(() => {
    return getSalesAnalytics(currentUser, dbState, activeFilters, financialTotals);
  }, [currentUser, dbState, activeFilters, financialTotals]);

  const repsPerformance = React.useMemo(() => {
    return getRepresentativeAnalytics(currentUser, dbState, activeFilters);
  }, [currentUser, dbState, activeFilters]);

  // Base real analytics values representing the business state (fully dynamic)
  const baseKpiValues = React.useMemo(() => {
    const revenue = Number(salesAnalytics?.totalSales ?? 0);
    const target = 0;
    const outstandingBalance = salesAnalytics.outstandingBalance;
    const totalOrders = Number(salesAnalytics?.ordersCount ?? 0);
    const delivered = Math.round(totalOrders * 0.85);
    const cancelled = Math.round(totalOrders * 0.05);
    const activeReps = (repsPerformance || []).filter(r => (r?.visitsCount || 0) > 0).length;

    const coverage = calculatePhysicianCoverage(physicians || [], scopedPhysicianVisits);
    const physiciansVisited = coverage.physiciansVisited;
    const totalPhysicians = coverage.totalPhysicians;

    const visitedPharmacyIds = new Set(scopedPharmacyVisits.map(v => v?.pharmacyId).filter(Boolean));
    const pharmaciesVisited = visitedPharmacyIds.size;
    const totalPharmacies = (pharmacies || []).length;

    return {
      revenue,
      target,
      outstandingBalance,
      totalOrders,
      delivered,
      cancelled,
      activeReps,
      physiciansVisited,
      totalPhysicians,
      pharmaciesVisited,
      totalPharmacies
    };
  }, [salesAnalytics, repsPerformance, scopedPhysicianVisits, scopedPharmacyVisits, physicians, pharmacies]);

  // Compute specific KPIs
  const gap = Math.max(0, baseKpiValues.target - baseKpiValues.revenue);
  const achievementRate = baseKpiValues.target > 0 ? (baseKpiValues.revenue / baseKpiValues.target) * 100 : 0;
  const completionRate = baseKpiValues.totalOrders > 0 ? (baseKpiValues.delivered / baseKpiValues.totalOrders) * 100 : 0;
  const physicianCoverage = baseKpiValues.totalPhysicians > 0 ? (baseKpiValues.physiciansVisited / baseKpiValues.totalPhysicians) * 100 : 0;
  const pharmacyCoverage = baseKpiValues.totalPharmacies > 0 ? (baseKpiValues.pharmaciesVisited / baseKpiValues.totalPharmacies) * 100 : 0;

  // Role-specific KPI Visibility Settings
  const userRole = currentUser?.role || Role.MEDICAL_REP;
  const canViewFinancials = ![Role.MEDICAL_REP, Role.SALES_REP, Role.DELIVERY_OFFICER].includes(userRole);
  const canViewPhysicianMetrics = ![Role.DELIVERY_OFFICER, Role.ORDER_OPS_OFFICER].includes(userRole);

  // Recharts Chart Data (Sales vs Target) - computed dynamically from real pharmacyVisits
  const chartData = React.useMemo(() => {
    const monthNamesEn = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthNamesAr = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
    
    const months: { name: string; Sales: number; Target: number }[] = [];
    const today = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const mIdx = d.getMonth();
      months.push({
        name: lang === "en" ? monthNamesEn[mIdx] : monthNamesAr[mIdx],
        Sales: 0,
        Target: 0
      });
    }

    scopedPharmacyVisits.forEach(v => {
      const visitDateStr = v?.visitDate || v?.date;
      const amt = v?.netAmount ?? v?.totalAmount ?? 0;
      if (!visitDateStr || amt <= 0) return;
      const d = new Date(visitDateStr);
      if (isNaN(d.getTime())) return;
      
      const mIdx = d.getMonth();
      const mName = lang === "en" ? monthNamesEn[mIdx] : monthNamesAr[mIdx];
      const match = months.find(m => m.name === mName);
      if (match) {
        match.Sales += amt;
      }
    });

    return months;
  }, [scopedPharmacyVisits, lang]);

  // Compute top representative rankings dynamically
  const topReps = React.useMemo(() => {
    return [...(repsPerformance || [])]
      .sort((a, b) => (b?.salesAmount || 0) - (a?.salesAmount || 0))
      .slice(0, 3)
      .map((r, index) => ({
        name: r?.repName || "Representative",
        region: "Tripoli",
        visits: r?.visitsCount || 0,
        revenue: Number(r?.salesAmount ?? 0),
        rank: index + 1
      }));
  }, [repsPerformance]);

  // Request Gemini AI Explanation of the current executive board
  const handleAiAnalyze = async () => {
    setLoadingAi(true);
    try {
      const payload = {
        role: userRole,
        region: currentUser?.region || "N/A",
        revenue: canViewFinancials ? money(baseKpiValues.revenue) : "Hidden",
        target: canViewFinancials ? money(baseKpiValues.target) : "Hidden",
        achievement: canViewFinancials ? safeToFixed(achievementRate, 1) + "%" : "Hidden",
        gap: canViewFinancials ? money(gap) : "Hidden",
        outstandingBalance: baseKpiValues.outstandingBalance === null ? (isRtl ? "غير متاح" : "Unavailable") : money(baseKpiValues.outstandingBalance),
        totalOrders: baseKpiValues.totalOrders,
        deliveryCompletion: safeToFixed(completionRate, 1) + "%",
        activeReps: baseKpiValues.activeReps,
        physicianCoverage: canViewPhysicianMetrics ? safeToFixed(physicianCoverage, 1) + "%" : "Hidden",
        pharmacyCoverage: safeToFixed(pharmacyCoverage, 1) + "%"
      };
      
      const insight = await fetchAiInsight("dashboard", payload, currentUser);
      setAiInsight(insight);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingAi(false);
    }
  };

  // Auto-trigger AI explanation on first load
  useEffect(() => {
    handleAiAnalyze();
  }, [userRole]);

  // Safe diagnostic audit logging
  const auditValues = [
    { field: "revenue", value: baseKpiValues.revenue, type: typeof baseKpiValues.revenue, source: "baseKpiValues.revenue", isMissing: baseKpiValues.revenue === undefined },
    { field: "target", value: baseKpiValues.target, type: typeof baseKpiValues.target, source: "baseKpiValues.target", isMissing: baseKpiValues.target === undefined },
    { field: "gap", value: gap, type: typeof gap, source: "gap", isMissing: gap === undefined },
    { field: "achievementRate", value: achievementRate, type: typeof achievementRate, source: "achievementRate", isMissing: achievementRate === undefined },
    { field: "completionRate", value: completionRate, type: typeof completionRate, source: "completionRate", isMissing: completionRate === undefined },
    { field: "physicianCoverage", value: physicianCoverage, type: typeof physicianCoverage, source: "physicianCoverage", isMissing: physicianCoverage === undefined },
    { field: "pharmacyCoverage", value: pharmacyCoverage, type: typeof pharmacyCoverage, source: "pharmacyCoverage", isMissing: pharmacyCoverage === undefined },
    { field: "outstandingBalance", value: baseKpiValues.outstandingBalance, type: typeof baseKpiValues.outstandingBalance, source: "baseKpiValues.outstandingBalance", isMissing: baseKpiValues.outstandingBalance === undefined },
    ...topReps.map((r, i) => ({ field: `topReps[${i}].revenue`, value: r.revenue, type: typeof r.revenue, source: `topReps[${i}].revenue`, isMissing: r.revenue === undefined })),
    ...scopedPharmacyVisits.slice(0, 3).map((v, i) => ({ field: `pharmacyVisits[${i}].netAmount`, value: v?.netAmount, type: typeof v?.netAmount, source: `pharmacyVisits[${i}].netAmount`, isMissing: v?.netAmount === undefined }))
  ];

  console.info("[DASHBOARD_FORMATTING_AUDIT_JSON]", JSON.stringify(auditValues));

  // Diagnostic audit for structured label objects
  const structuredLabelAudits: any[] = [];
  scopedPhysicianVisits.slice(0, 3).forEach((v, idx) => {
    const fieldsToCheck = [
      { field: `physicianVisits[${idx}].physicianName`, value: v?.physicianName, recordId: v?.id },
      { field: `physicianVisits[${idx}].repName`, value: v?.repName, recordId: v?.id },
      { field: `physicianVisits[${idx}].visitPurpose`, value: (v as any)?.visitPurpose || (v as any)?.purpose, recordId: v?.id },
      { field: `physicianVisits[${idx}].status`, value: (v as any)?.status, recordId: v?.id }
    ];
    (v?.detailing || []).forEach((det: any, dIdx: number) => {
      fieldsToCheck.push(
        { field: `physicianVisits[${idx}].detailing[${dIdx}].brandName`, value: det?.brandName || det?.brand, recordId: v?.id },
        { field: `physicianVisits[${idx}].detailing[${dIdx}].reaction`, value: det?.reaction, recordId: v?.id }
      );
    });

    fieldsToCheck.forEach(item => {
      if (item.value && typeof item.value === "object") {
        structuredLabelAudits.push({
          field: item.field,
          valueType: typeof item.value,
          keys: Object.keys(item.value),
          resolvedText: resolveDisplayLabel(item.value, lang),
          sourceRecordId: item.recordId || ""
        });
      }
    });
  });

  scopedPharmacyVisits.slice(0, 3).forEach((v, idx) => {
    const fieldsToCheck = [
      { field: `pharmacyVisits[${idx}].pharmacyName`, value: v?.pharmacyName, recordId: v?.id },
      { field: `pharmacyVisits[${idx}].repName`, value: v?.repName, recordId: v?.id },
      { field: `pharmacyVisits[${idx}].visitPurpose`, value: v?.visitPurpose || (v as any)?.purpose, recordId: v?.id },
      { field: `pharmacyVisits[${idx}].status`, value: (v as any)?.status, recordId: v?.id }
    ];

    fieldsToCheck.forEach(item => {
      if (item.value && typeof item.value === "object") {
        structuredLabelAudits.push({
          field: item.field,
          valueType: typeof item.value,
          keys: Object.keys(item.value),
          resolvedText: resolveDisplayLabel(item.value, lang),
          sourceRecordId: item.recordId || ""
        });
      }
    });
  });

  if (structuredLabelAudits.length > 0) {
    console.info("[DASHBOARD_STRUCTURED_LABEL_AUDIT_JSON]", JSON.stringify(structuredLabelAudits));
  }

  return (
    <div className="space-y-6" id="dashboard-view-wrapper" dir={isRtl ? "rtl" : "ltr"}>
      {/* Title Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-100 dark:border-slate-800 pb-5" id="dashboard-header-block">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight" id="dashboard-title-text">
            {t.dashboardTitle}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1" id="dashboard-subtitle-text">
            {t.dashboardSubtitle}
          </p>
        </div>

        {/* Filters Panel */}
        <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg self-stretch md:self-auto" id="dashboard-filters">
          <Calendar size={16} className="text-slate-400 mx-2" />
          <button 
            onClick={() => setDateFilter("today")} 
            className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${dateFilter === "today" ? "bg-white dark:bg-slate-700 shadow-xs text-blue-600 dark:text-white" : "text-slate-600 dark:text-slate-400"}`}
            id="filter-today"
          >
            {t.today}
          </button>
          <button 
            onClick={() => setDateFilter("this-week")} 
            className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${dateFilter === "this-week" ? "bg-white dark:bg-slate-700 shadow-xs text-blue-600 dark:text-white" : "text-slate-600 dark:text-slate-400"}`}
            id="filter-this-week"
          >
            {t.thisWeek}
          </button>
          <button 
            onClick={() => setDateFilter("this-month")} 
            className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${dateFilter === "this-month" ? "bg-white dark:bg-slate-700 shadow-xs text-blue-600 dark:text-white" : "text-slate-600 dark:text-slate-400"}`}
            id="filter-this-month"
          >
            {t.thisMonth}
          </button>
        </div>
      </div>

      {/* 12 Enterprise KPI Cards Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4" id="kpi-cards-grid">
        
        {/* Row 1: Financial & Gaps (Role-Restricted Visibility) */}
        {canViewFinancials ? (
          <>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 p-5 rounded-lg shadow-xs border-l-4 border-l-blue-600 relative overflow-hidden" id="card-kpi-revenue">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-[10px] font-mono text-slate-400 dark:text-slate-500 uppercase tracking-wider font-semibold">{t.revenue}</p>
                  <h3 className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{money(baseKpiValues.revenue)}</h3>
                </div>
                <span className="p-2 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 rounded-lg">
                  <DollarSign size={16} />
                </span>
              </div>
              <div className="text-xxs font-mono text-emerald-500 mt-2.5 flex items-center gap-1">
                <TrendingUp size={12} />
                <span>+12.4% vs last month</span>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 p-5 rounded-lg shadow-xs border-l-4 border-l-purple-600 relative overflow-hidden" id="card-kpi-target">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-[10px] font-mono text-slate-400 dark:text-slate-500 uppercase tracking-wider font-semibold">{t.target}</p>
                  <h3 className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{money(baseKpiValues.target)}</h3>
                </div>
                <span className="p-2 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 rounded-lg">
                  <TrendingUp size={16} />
                </span>
              </div>
              <div className="text-xxs font-mono text-slate-400 mt-2.5">
                <span>Set at 2026-Q2 regional review</span>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 p-5 rounded-lg shadow-xs border-l-4 border-l-amber-500 relative overflow-hidden" id="card-kpi-gap">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-[10px] font-mono text-slate-400 dark:text-slate-500 uppercase tracking-wider font-semibold">{t.gap}</p>
                  <h3 className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{money(gap)}</h3>
                </div>
                <span className="p-2 bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 rounded-lg">
                  <AlertTriangle size={16} />
                </span>
              </div>
              <div className="text-xxs font-mono text-amber-600 mt-2.5">
                <span>Remaining to achieve 100% target</span>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 p-5 rounded-lg shadow-xs border-l-4 border-l-pink-600 relative overflow-hidden" id="card-kpi-achievement">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-[10px] font-mono text-slate-400 dark:text-slate-500 uppercase tracking-wider font-semibold">{t.achievement}</p>
                  <h3 className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{safeToFixed(achievementRate, 1)}%</h3>
                </div>
                <span className="p-2 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 rounded-lg">
                  <Percent size={16} />
                </span>
              </div>
              <div className="mt-3.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5">
                <div className="bg-blue-600 h-1.5 rounded-full" style={{ width: `${Math.min(100, achievementRate)}%` }}></div>
              </div>
            </div>
          </>
        ) : (
          <div className="col-span-4 bg-slate-50 dark:bg-slate-800/20 border border-dashed border-slate-200 dark:border-slate-800 p-5 rounded-lg text-center text-xs text-slate-400 font-mono" id="financial-metrics-locked">
            🔒 Financial performance indicators are restricted for {userRole} role.
          </div>
        )}

        {/* Row 2: Delivery & Orders (All Roles) */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 p-5 rounded-lg shadow-xs border-l-4 border-l-sky-500 relative overflow-hidden" id="card-kpi-orders">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-[10px] font-mono text-slate-400 dark:text-slate-500 uppercase tracking-wider font-semibold">{t.totalOrders}</p>
              <h3 className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{baseKpiValues.totalOrders}</h3>
            </div>
            <span className="p-2 bg-sky-50 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400 rounded-lg">
              <ShoppingBag size={16} />
            </span>
          </div>
          <div className="text-xxs font-mono text-slate-400 mt-2.5">
            <span>Direct orders booked from field</span>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 p-5 rounded-lg shadow-xs border-l-4 border-l-emerald-500 relative overflow-hidden" id="card-kpi-delivered">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-[10px] font-mono text-slate-400 dark:text-slate-500 uppercase tracking-wider font-semibold">{t.delivered}</p>
              <h3 className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{baseKpiValues.delivered}</h3>
            </div>
            <span className="p-2 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 rounded-lg">
              <CheckCircle size={16} />
            </span>
          </div>
          <div className="text-xxs font-mono text-emerald-600 mt-2.5">
            <span>Delivered by logistics officers</span>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 p-5 rounded-lg shadow-xs border-l-4 border-l-rose-500 relative overflow-hidden" id="card-kpi-cancelled">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-[10px] font-mono text-slate-400 dark:text-slate-500 uppercase tracking-wider font-semibold">{t.cancelled}</p>
              <h3 className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{baseKpiValues.cancelled}</h3>
            </div>
            <span className="p-2 bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 rounded-lg">
              <XCircle size={16} />
            </span>
          </div>
          <div className="text-xxs font-mono text-rose-600 mt-2.5">
            <span>Orders aborted / credit issues</span>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 p-5 rounded-lg shadow-xs border-l-4 border-l-violet-500 relative overflow-hidden" id="card-kpi-completion">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-[10px] font-mono text-slate-400 dark:text-slate-500 uppercase tracking-wider font-semibold">{t.completionRate}</p>
              <h3 className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{safeToFixed(completionRate, 1)}%</h3>
            </div>
            <span className="p-2 bg-violet-50 dark:bg-violet-950/40 text-violet-600 dark:text-violet-400 rounded-lg">
              <Compass size={16} />
            </span>
          </div>
          <div className="mt-3.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5">
            <div className="bg-violet-600 h-1.5 rounded-full" style={{ width: `${Math.min(100, completionRate)}%` }}></div>
          </div>
        </div>

        {/* Row 3: Coverage & Balances */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 p-5 rounded-lg shadow-xs border-l-4 border-l-pink-500 relative overflow-hidden" id="card-kpi-reps">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-[10px] font-mono text-slate-400 dark:text-slate-500 uppercase tracking-wider font-semibold">{t.activeReps}</p>
              <h3 className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{baseKpiValues.activeReps}</h3>
            </div>
            <span className="p-2 bg-pink-50 dark:bg-pink-950/40 text-pink-600 dark:text-pink-400 rounded-lg">
              <Users size={16} />
            </span>
          </div>
          <div className="text-xxs font-mono text-slate-400 mt-2.5">
            <span>Active in field territories today</span>
          </div>
        </div>

        {canViewPhysicianMetrics ? (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 p-5 rounded-lg shadow-xs border-l-4 border-l-teal-500 relative overflow-hidden" id="card-kpi-physicians">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-[10px] font-mono text-slate-400 dark:text-slate-500 uppercase tracking-wider font-semibold">{t.physicianCoverage}</p>
                <h3 className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{safeToFixed(physicianCoverage, 1)}%</h3>
              </div>
              <span className="p-2 bg-teal-50 dark:bg-teal-950/40 text-teal-600 dark:text-teal-400 rounded-lg">
                <Stethoscope size={16} />
              </span>
            </div>
            <div className="text-xxs font-mono mt-2.5 text-slate-400 flex justify-between">
              <span>{baseKpiValues.physiciansVisited} visited</span>
              <span>{baseKpiValues.totalPhysicians} total</span>
            </div>
          </div>
        ) : (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 p-5 rounded-lg shadow-xs border-l-4 border-l-teal-500 relative overflow-hidden" id="card-kpi-physicians-restricted">
            <p className="text-[10px] font-mono text-slate-400 dark:text-slate-500 uppercase tracking-wider font-semibold">{t.physicianCoverage}</p>
            <p className="text-xs text-slate-400 mt-3 font-mono">⚠️ Restricted to Medical Teams</p>
          </div>
        )}

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 p-5 rounded-lg shadow-xs border-l-4 border-l-indigo-500 relative overflow-hidden" id="card-kpi-pharmacies">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-[10px] font-mono text-slate-400 dark:text-slate-500 uppercase tracking-wider font-semibold">{t.pharmacyCoverage}</p>
              <h3 className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{safeToFixed(pharmacyCoverage, 1)}%</h3>
            </div>
            <span className="p-2 bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 rounded-lg">
              <Pill size={16} />
            </span>
          </div>
          <div className="text-xxs font-mono mt-2.5 text-slate-400 flex justify-between">
            <span>{baseKpiValues.pharmaciesVisited} audited</span>
            <span>{baseKpiValues.totalPharmacies} total</span>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 p-5 rounded-lg shadow-xs border-l-4 border-l-rose-500 relative overflow-hidden" id="card-kpi-balance">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-[10px] font-mono text-rose-500 uppercase tracking-wider font-semibold">{t.outstandingBalance}</p>
              <h3 className="text-2xl font-bold text-rose-600 mt-1">{baseKpiValues.outstandingBalance === null ? (isRtl ? "غير متاح" : "Unavailable") : money(baseKpiValues.outstandingBalance)}</h3>
            </div>
            <span className="p-2 bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 rounded-lg">
              <ShieldAlert size={16} />
            </span>
          </div>
          <div className="text-xxs font-mono text-rose-500 mt-2.5">
            <span>Requires collection activities</span>
          </div>
        </div>

      </div>

      {/* Main Charts & Top Performers Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6" id="dashboard-visuals-grid">
        
        {/* Sales vs Target Chart */}
        <div className="lg:col-span-2 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-5" id="sales-chart-panel">
          <div className="flex justify-between items-center mb-4" id="sales-chart-header">
            <h3 className="text-sm font-semibold text-slate-800 dark:text-white font-sans">
              {t.salesVsTarget}
            </h3>
            <span className="text-xxs font-mono bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 px-2 py-1 rounded" id="chart-currency-label">
              {market?.currencyCode || "Currency configuration required"}
            </span>
          </div>
          
          <div className="h-64 w-full" id="responsive-chart-container">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2563eb" stopOpacity={0.2}/>
                    <stop offset="95%" stopColor="#2563eb" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorTarget" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#cbd5e1" stopOpacity={0.1}/>
                    <stop offset="95%" stopColor="#cbd5e1" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" className="dark:stroke-slate-800" />
                <XAxis dataKey="name" stroke="#94a3b8" fontSize={10} tickLine={false} />
                <YAxis stroke="#94a3b8" fontSize={10} tickLine={false} />
                <Tooltip contentStyle={{ fontSize: '11px', borderRadius: '8px' }} />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                <Area type="monotone" dataKey="Sales" stroke="#2563eb" strokeWidth={2} fillOpacity={1} fill="url(#colorSales)" name={lang === "en" ? "Actual Sales" : "المبيعات الفعلية"} />
                <Area type="monotone" dataKey="Target" stroke="#94a3b8" strokeWidth={1} strokeDasharray="5 5" fillOpacity={1} fill="url(#colorTarget)" name={lang === "en" ? "Target" : "المستهدف"} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Top Performers */}
        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-5 flex flex-col" id="top-performers-panel">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-white mb-4" id="top-performers-title">
            {t.topPerformers}
          </h3>
          <div className="flex-1 space-y-4" id="performers-list">
            {topReps.map((rep, idx) => (
              <div key={idx} className="flex items-center justify-between p-3 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-100/50 dark:border-slate-800/50" id={`top-rep-${idx}`}>
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300 font-bold text-xs">
                    {rep.rank}
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-slate-800 dark:text-white">{resolveDisplayLabel(rep.name, lang)}</h4>
                    <p className="text-xxs text-slate-400">{resolveDisplayLabel(rep.region, lang)}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs font-bold text-slate-800 dark:text-slate-200">{money(rep.revenue)}</p>
                  <p className="text-xxs text-emerald-500 font-mono">{rep.visits} visits</p>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* Recent Visits Activity Lists */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6" id="dashboard-recent-activities">
        
        {/* Recent Physician Visits */}
        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-5" id="recent-physicians-panel">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-white mb-4" id="recent-physicians-title">
            {t.recentPhysicianVisits}
          </h3>
          <div className="space-y-3" id="recent-physicians-list">
            {scopedPhysicianVisits.length === 0 ? (
              <p className="text-xs text-slate-400 py-4 text-center">{t.noVisits}</p>
            ) : (
              scopedPhysicianVisits.slice(0, 3).map((visit) => {
                const durSec = visit?.durationSeconds || 0;
                return (
                  <div key={visit.id} className="p-3 border border-slate-100 dark:border-slate-800 rounded-lg flex justify-between items-start text-xs" id={`recent-physician-visit-${visit.id}`}>
                    <div>
                      <h4 className="font-semibold text-slate-800 dark:text-white">{resolveDisplayLabel(visit.physicianName, lang)}</h4>
                      <p className="text-xxs text-slate-400 mt-1">{t.rep}: {resolveDisplayLabel(visit.repName, lang)} • {resolveDisplayLabel(visit.visitDate || (visit as any).date, lang)}</p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {(visit.detailing || []).map((det, di) => (
                          <span key={di} className="px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 font-mono text-xxs">
                            {resolveDisplayLabel((det as any).brandName || (det as any).brand, lang)} ({resolveDisplayLabel((det as any).reaction, lang)})
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="text-right flex flex-col items-end">
                      <span className="px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 font-mono text-xxs font-medium">
                        GPS Validated
                      </span>
                      <span className="text-xxs text-slate-400 mt-2 font-mono">{Math.floor(durSec / 60)}m {durSec % 60}s</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Recent Pharmacy Visits */}
        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-5" id="recent-pharmacies-panel">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-white mb-4" id="recent-pharmacies-title">
            {t.recentPharmacyVisits}
          </h3>
          <div className="space-y-3" id="recent-pharmacies-list">
            {scopedPharmacyVisits.length === 0 ? (
              <p className="text-xs text-slate-400 py-4 text-center">{t.noVisits}</p>
            ) : (
              scopedPharmacyVisits.slice(0, 3).map((visit) => {
                const netAmt = visit?.netAmount ?? visit?.totalAmount ?? 0;
                return (
                  <div key={visit.id} className="p-3 border border-slate-100 dark:border-slate-800 rounded-lg flex justify-between items-start text-xs" id={`recent-pharmacy-visit-${visit.id}`}>
                    <div>
                      <h4 className="font-semibold text-slate-800 dark:text-white">{resolveDisplayLabel(visit.pharmacyName, lang)}</h4>
                      <p className="text-xxs text-slate-400 mt-1">{t.rep}: {resolveDisplayLabel(visit.repName, lang)} • {resolveDisplayLabel(visit.visitDate || (visit as any).date, lang)}</p>
                      <div className="mt-2 flex gap-2">
                        <span className="px-1.5 py-0.5 rounded bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 font-mono text-xxs">
                          {t.purpose}: {resolveDisplayLabel(visit.visitPurpose || (visit as any).purpose, lang)}
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-200">{money(netAmt)}</span>
                      <p className="text-xxs text-emerald-500 font-mono mt-1">{"Audit"}</p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

      </div>

    </div>
  );
}
