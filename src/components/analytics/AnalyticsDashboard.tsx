import React, { useState, useMemo } from "react";
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  LineChart, Line, AreaChart, Area
} from "recharts";
import { 
  TrendingUp, TrendingDown, Award, Activity, Sparkles, Users, 
  BarChart3, Download, AlertCircle, FileText, Smile, ShieldCheck, 
  Loader2, RefreshCw, Layers, ShieldAlert, Inbox, Check
} from "lucide-react";
import SynergyReports from "./SynergyReports";
import { 
  calculateSecuredAnalyticsScope, 
  filterDatasetByScopeAndFilters 
} from "../../lib/analyticsScopeEngine";
import { 
  getSalesAnalytics,
  getMedicalAnalytics,
  getTerritoryAnalytics,
  getProductAnalytics,
  getBrandAnalytics,
  getRepresentativeAnalytics,
  getSupervisorAnalytics,
  getExecutiveAnalytics,
  getMarketingAnalytics,
  SalesAnalyticsResult,
  MedicalAnalyticsResult,
  TerritoryAnalyticsResult,
  ProductAnalyticsResult,
  BrandAnalyticsResult,
  RepPerformanceMetrics,
  SupervisorAnalyticsResult,
  ExecutiveAnalyticsResult,
  MarketingAnalyticsResult
} from "../../lib/analyticsService";
import { 
  Role, 
  User, 
  AnalyticsDbState,
  AnalyticsFilters
} from "../../types";

interface AnalyticsDashboardProps {
  currentUser: User;
  lang: "en" | "ar";
  users?: User[];
  physicians?: any[];
  pharmacies?: any[];
  products?: any[];
  userTerritoryAssignments?: any[];
  userProductAssignments?: any[];
  physicianVisits?: any[];
  pharmacyVisits?: any[];
}

export default function AnalyticsDashboard({ 
  currentUser, 
  lang,
  users = [],
  physicians = [],
  pharmacies = [],
  products = [],
  userTerritoryAssignments = [],
  userProductAssignments = [],
  physicianVisits = [],
  pharmacyVisits = []
}: AnalyticsDashboardProps) {
  const isRtl = lang === "ar";
  
  // State Overrides for testing and showcasing different foundational states
  const [stateMode, setStateMode] = useState<"normal" | "loading" | "error" | "empty" | "denied">("normal");
  const [metricTab, setMetricTab] = useState<"performance" | "medical-quality" | "synergy" | "reports">("performance");
  
  // Create complete DB state object to pass into our scope engine
  const dbState: AnalyticsDbState = useMemo(() => {
    return {
      users,
      userTerritoryAssignments,
      userProductAssignments,
      physicianAssignments: [],
      pharmacyAssignments: [],
      physicians,
      pharmacies,
      products,
      physicianVisits,
      pharmacyVisits
    };
  }, [users, userTerritoryAssignments, userProductAssignments, physicians, pharmacies, products, physicianVisits, pharmacyVisits]);

  // Compute the secured scope for the current user
  const securedScope = useMemo(() => {
    return calculateSecuredAnalyticsScope(currentUser, dbState);
  }, [currentUser, dbState]);

  // Standard filters object for central services
  const defaultFilters: AnalyticsFilters = useMemo(() => {
    return {
      selectedCountry: "All",
      selectedDistrict: "All",
      selectedCity: "All",
      selectedTerritory: "All",
      selectedProductGroup: "All",
      selectedProduct: "All"
    };
  }, []);

  // Retrieve unified analytics data from services
  const salesMetrics = useMemo(() => {
    return getSalesAnalytics(currentUser, dbState, defaultFilters);
  }, [currentUser, dbState, defaultFilters]);

  const medicalMetrics = useMemo(() => {
    return getMedicalAnalytics(currentUser, dbState, defaultFilters);
  }, [currentUser, dbState, defaultFilters]);

  const territoryMetrics = useMemo(() => {
    return getTerritoryAnalytics(currentUser, dbState, defaultFilters);
  }, [currentUser, dbState, defaultFilters]);

  const productMetrics = useMemo(() => {
    return getProductAnalytics(currentUser, dbState, defaultFilters);
  }, [currentUser, dbState, defaultFilters]);

  const brandMetrics = useMemo(() => {
    return getBrandAnalytics(currentUser, dbState, defaultFilters);
  }, [currentUser, dbState, defaultFilters]);

  const repMetrics = useMemo(() => {
    return getRepresentativeAnalytics(currentUser, dbState, defaultFilters);
  }, [currentUser, dbState, defaultFilters]);

  const supervisorMetrics = useMemo(() => {
    return getSupervisorAnalytics(currentUser, dbState, defaultFilters);
  }, [currentUser, dbState, defaultFilters]);

  const executiveMetrics = useMemo(() => {
    return getExecutiveAnalytics(currentUser, dbState, defaultFilters);
  }, [currentUser, dbState, defaultFilters]);

  const marketingMetrics = useMemo(() => {
    return getMarketingAnalytics(currentUser, dbState, defaultFilters);
  }, [currentUser, dbState, defaultFilters]);

  // Helper to check if a specific territory is accessible under the secure scope
  const isTerritoryAllowed = (territoryName: string): boolean => {
    if (securedScope.level === "national") return true;
    const lowerName = territoryName.toLowerCase().trim();
    return securedScope.allowedTerritories.some(t => {
      const allowedPath = t.toLowerCase().trim();
      return lowerName.includes(allowedPath) || allowedPath.includes(lowerName);
    });
  };

  // 9 Synergy Cockpit Datasets - Filtered by Secure Scope!
  const medicalVisitsByTerritory = useMemo(() => {
    const raw = [
      { territory: "Tripoli Downtown", visits: 142 },
      { territory: "Al Khums Centre", visits: 110 },
      { territory: "Al Jufra Hun", visits: 88 },
      { territory: "Gharyan Central", visits: 65 }
    ];
    return raw.filter(item => isTerritoryAllowed(item.territory));
  }, [securedScope]);

  const pharmacyVisitsByTerritory = useMemo(() => {
    const raw = [
      { territory: "Tripoli Downtown", visits: 98 },
      { territory: "Al Khums Centre", visits: 114 },
      { territory: "Al Jufra Hun", visits: 62 },
      { territory: "Gharyan Central", visits: 54 }
    ];
    return raw.filter(item => isTerritoryAllowed(item.territory));
  }, [securedScope]);

  const detailingByTerritory = useMemo(() => {
    const raw = [
      { territory: "Tripoli Downtown", detailing: 240 },
      { territory: "Al Khums Centre", detailing: 185 },
      { territory: "Al Jufra Hun", detailing: 120 },
      { territory: "Gharyan Central", detailing: 90 }
    ];
    return raw.filter(item => isTerritoryAllowed(item.territory));
  }, [securedScope]);

  const ordersByTerritory = useMemo(() => {
    const raw = [
      { territory: "Tripoli Downtown", orders: 65 },
      { territory: "Al Khums Centre", orders: 72 },
      { territory: "Al Jufra Hun", orders: 40 },
      { territory: "Gharyan Central", orders: 32 }
    ];
    return raw.filter(item => isTerritoryAllowed(item.territory));
  }, [securedScope]);

  const salesByProductGroup = useMemo(() => {
    const raw = [
      { group: isRtl ? "مجموعة القلب" : "Cardiology Line", sales: 37000, groupKey: "PG-CARDIO" },
      { group: isRtl ? "مجموعة الجلدية" : "Dermatology Line", sales: 24000, groupKey: "PG-DERMA" },
      { group: isRtl ? "مجموعة الفيتامينات" : "Vitamins / Pediatrics", sales: 18500, groupKey: "PG-VIT" }
    ];
    if (securedScope.level === "national") return raw;
    return raw.filter(item => securedScope.allowedProductGroups.includes(item.groupKey) || securedScope.allowedProductGroups.length === 0);
  }, [securedScope, isRtl]);

  const prescriptionIntentByProduct = useMemo(() => {
    const raw = [
      { product: "CardioMax 10mg", rating: 8.5, prodId: "PRD-001" },
      { product: "CardioLine 50mg", rating: 8.0, prodId: "PRD-002" },
      { product: "AcneCare Lotion", rating: 7.2, prodId: "PRD-003" },
      { product: "KidVits Daily", rating: 7.9, prodId: "PRD-004" }
    ];
    if (securedScope.level === "national") return raw;
    return raw.filter(item => securedScope.allowedProducts.includes(item.prodId) || securedScope.allowedProducts.length === 0);
  }, [securedScope]);

  const physicianReactionByProduct = useMemo(() => {
    const raw = [
      { product: "CardioMax 10mg", Positive: 80, Skeptical: 20, prodId: "PRD-001" },
      { product: "AcneCare Lotion", Positive: 65, Skeptical: 35, prodId: "PRD-003" },
      { product: "KidVits Daily", Positive: 75, Skeptical: 25, prodId: "PRD-004" }
    ];
    if (securedScope.level === "national") return raw;
    return raw.filter(item => securedScope.allowedProducts.includes(item.prodId) || securedScope.allowedProducts.length === 0);
  }, [securedScope]);

  const samplesDistributedByProduct = useMemo(() => {
    const raw = [
      { product: "CardioMax 10mg", qty: 310, prodId: "PRD-001" },
      { product: "AcneCare Lotion", qty: 220, prodId: "PRD-003" },
      { product: "KidVits Daily", qty: 180, prodId: "PRD-004" }
    ];
    if (securedScope.level === "national") return raw;
    return raw.filter(item => securedScope.allowedProducts.includes(item.prodId) || securedScope.allowedProducts.length === 0);
  }, [securedScope]);

  const territorySynergyScores = useMemo(() => {
    const raw = [
      { territory: "Tripoli Downtown", score: 92 },
      { territory: "Al Khums Centre", score: 87 },
      { territory: "Al Jufra Hun", score: 81 },
      { territory: "Gharyan Central", score: 76 }
    ];
    return raw.filter(item => isTerritoryAllowed(item.territory));
  }, [securedScope]);

  // Handle manual simulated error retry
  const handleRetry = () => {
    setStateMode("loading");
    setTimeout(() => {
      setStateMode("normal");
    }, 800);
  };

  // Determine active display mode
  const resolvedMode = useMemo(() => {
    // If the role permissions are restricted (e.g. view = false), force access denied
    const viewAllowed = currentUser.sidebarVisibility?.includes("analytics") === true;
    if (!viewAllowed) return "denied";
    return stateMode;
  }, [stateMode, currentUser]);

  // Derived empty state check
  const isSecuredDatasetEmpty = useMemo(() => {
    return medicalVisitsByTerritory.length === 0 && pharmacyVisitsByTerritory.length === 0;
  }, [medicalVisitsByTerritory, pharmacyVisitsByTerritory]);

  const finalMode = resolvedMode === "normal" && isSecuredDatasetEmpty ? "empty" : resolvedMode;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      
      {/* 1. STATE CONTROLLER & DIAGNOSTICS (Foundation Showcase) */}
      <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-850 p-4 rounded-2xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} className="text-cyan-600 dark:text-cyan-400" />
            <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
              {isRtl ? "أدوات فحص واختبار محرك التحليلات المؤمن" : "Secured Analytics Engine Control Center"}
            </h3>
          </div>
          
          {/* Manual State Selector Buttons */}
          <div className="flex flex-wrap gap-1.5 bg-slate-200/50 dark:bg-slate-900/50 p-1 rounded-xl text-[10px] font-bold">
            <button 
              onClick={() => setStateMode("normal")}
              className={`px-2.5 py-1.5 rounded-lg transition-all cursor-pointer ${stateMode === "normal" ? "bg-white dark:bg-slate-800 text-cyan-600 shadow-xs" : "text-slate-500 hover:text-slate-700"}`}
            >
              Normal
            </button>
            <button 
              onClick={() => setStateMode("loading")}
              className={`px-2.5 py-1.5 rounded-lg transition-all cursor-pointer ${stateMode === "loading" ? "bg-white dark:bg-slate-800 text-cyan-600 shadow-xs" : "text-slate-500 hover:text-slate-700"}`}
            >
              Loading
            </button>
            <button 
              onClick={() => setStateMode("error")}
              className={`px-2.5 py-1.5 rounded-lg transition-all cursor-pointer ${stateMode === "error" ? "bg-white dark:bg-slate-800 text-cyan-600 shadow-xs" : "text-slate-500 hover:text-slate-700"}`}
            >
              Error
            </button>
            <button 
              onClick={() => setStateMode("empty")}
              className={`px-2.5 py-1.5 rounded-lg transition-all cursor-pointer ${stateMode === "empty" ? "bg-white dark:bg-slate-800 text-cyan-600 shadow-xs" : "text-slate-500 hover:text-slate-700"}`}
            >
              Empty
            </button>
            <button 
              onClick={() => setStateMode("denied")}
              className={`px-2.5 py-1.5 rounded-lg transition-all cursor-pointer ${stateMode === "denied" ? "bg-white dark:bg-slate-800 text-cyan-600 shadow-xs" : "text-slate-500 hover:text-slate-700"}`}
            >
              Denied
            </button>
          </div>
        </div>

        {/* Live Diagnostics Card */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-3 border-t border-slate-200/60 dark:border-slate-850/60 text-xxs">
          <div className="bg-white dark:bg-slate-900/50 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800/40">
            <span className="text-slate-400 block font-bold uppercase mb-0.5">Scope Level</span>
            <span className="font-mono font-bold text-slate-800 dark:text-slate-200 capitalize text-xs">
              {securedScope.level}
            </span>
          </div>

          <div className="bg-white dark:bg-slate-900/50 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800/40">
            <span className="text-slate-400 block font-bold uppercase mb-0.5">Allowed Territories</span>
            <span className="font-mono font-bold text-slate-800 dark:text-slate-200 text-xs">
              {securedScope.level === "national" ? "All Territories" : `${securedScope.allowedTerritories.length} assigned`}
            </span>
          </div>

          <div className="bg-white dark:bg-slate-900/50 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800/40">
            <span className="text-slate-400 block font-bold uppercase mb-0.5">Allowed Products</span>
            <span className="font-mono font-bold text-slate-800 dark:text-slate-200 text-xs">
              {securedScope.level === "national" ? "All Products" : `${securedScope.allowedProducts.length} aligned`}
            </span>
          </div>

          <div className="bg-white dark:bg-slate-900/50 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800/40">
            <span className="text-slate-400 block font-bold uppercase mb-0.5">Subordinates Tracked</span>
            <span className="font-mono font-bold text-slate-800 dark:text-slate-200 text-xs">
              {securedScope.subordinateUserIds.length} users
            </span>
          </div>
        </div>
      </div>

      {/* 2. HANDLERS IN ACTION */}

      {/* LOADING STATE */}
      {finalMode === "loading" && (
        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 p-12 rounded-3xl flex flex-col items-center justify-center space-y-4 shadow-xxs">
          <div className="w-12 h-12 rounded-full bg-cyan-50 dark:bg-cyan-950/40 flex items-center justify-center text-cyan-600 animate-spin">
            <Loader2 size={24} />
          </div>
          <div className="text-center space-y-1">
            <h4 className="text-xs font-bold text-slate-800 dark:text-white uppercase tracking-wider">
              {isRtl ? "جاري تجميع البيانات وتطبيق النطاق الأمني..." : "Aggregating Scoped Analytics..."}
            </h4>
            <p className="text-xxs text-slate-400 max-w-xs mx-auto">
              {isRtl 
                ? "يقوم محرك الرقابة الجغرافية بالتحقق من مسار التراخيص واسترجاع تقارير الأقاليم المعتمدة."
                : "The cascading security engine is resolving territory parameters and verifying line reporting subordinates."}
            </p>
          </div>
        </div>
      )}

      {/* ERROR STATE */}
      {finalMode === "error" && (
        <div className="bg-white dark:bg-slate-900 border border-red-100 dark:border-red-950/40 p-8 rounded-3xl flex flex-col items-center justify-center space-y-4 shadow-xxs">
          <div className="w-12 h-12 rounded-full bg-red-50 dark:bg-red-950/40 flex items-center justify-center text-red-600">
            <AlertCircle size={24} />
          </div>
          <div className="text-center space-y-1">
            <h4 className="text-xs font-bold text-red-800 dark:text-red-400 uppercase tracking-wider">
              {isRtl ? "فشل محاكاة جلب البيانات التحليلية" : "Analytics Fetch Failure"}
            </h4>
            <p className="text-xxs text-slate-500 max-w-sm mx-auto">
              {isRtl 
                ? "خطأ في الاتصال بقاعدة البيانات Firestore. تم إلغاء العملية لحماية سرية Master Data."
                : "Failed to establish a secure handshake with the Firebase analytics aggregate endpoint. Operation terminated to prevent un-scoped leaks."}
            </p>
          </div>
          <button 
            onClick={handleRetry}
            className="flex items-center gap-1.5 px-4 py-2 bg-slate-900 hover:bg-slate-850 dark:bg-slate-800 dark:hover:bg-slate-750 text-white text-xxs font-bold rounded-xl transition-all cursor-pointer"
          >
            <RefreshCw size={12} className="animate-spin-slow" />
            <span>{isRtl ? "إعادة المحاولة" : "Retry Handshake"}</span>
          </button>
        </div>
      )}

      {/* EMPTY STATE */}
      {finalMode === "empty" && (
        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 p-12 rounded-3xl flex flex-col items-center justify-center space-y-4 shadow-xxs">
          <div className="w-12 h-12 rounded-full bg-slate-50 dark:bg-slate-850 flex items-center justify-center text-slate-400">
            <Inbox size={24} />
          </div>
          <div className="text-center space-y-1">
            <h4 className="text-xs font-bold text-slate-800 dark:text-white uppercase tracking-wider">
              {isRtl ? "لا توجد سجلات ترويج مالي أو طبي في النطاق" : "No Analytics Data Captured Yet"}
            </h4>
            <p className="text-xxs text-slate-400 max-w-sm mx-auto">
              {isRtl 
                ? "لا تتوفر أي سجلات زيارات أو فواتير للصيدليات ضمن النطاق الجغرافي المعين لحسابك حالياً."
                : "No active physician detailing logs, pharmacy orders, or sample transactions have been recorded in your assigned geographic paths yet."}
            </p>
          </div>
        </div>
      )}

      {/* ACCESS DENIED STATE */}
      {finalMode === "denied" && (
        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 p-12 rounded-3xl flex flex-col items-center justify-center space-y-4 shadow-xxs">
          <div className="w-12 h-12 rounded-full bg-red-50 dark:bg-red-950/40 flex items-center justify-center text-red-600">
            <ShieldAlert size={24} />
          </div>
          <div className="text-center space-y-1">
            <h4 className="text-xs font-bold text-red-800 dark:text-red-400 uppercase tracking-wider">
              {isRtl ? "تم رفض صلاحية عرض التقارير التحليلية" : "Access Blocked — Secured Analytics Boundary"}
            </h4>
            <p className="text-xxs text-slate-500 max-w-sm mx-auto">
              {isRtl 
                ? "يتطلب هذا القسم تفويضات الرقابة الطبية والبيعية العليا. تم رصد وتسجيل محاولة الوصول في السجل الأمني."
                : "This module requires administrative clearances. Access requests have been logged inside the secure central CRM compliance database."}
            </p>
          </div>
        </div>
      )}

      {/* NORMAL STATE */}
      {finalMode === "normal" && (
        <div className="space-y-6">
          
          {/* Header section */}
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-5">
            <div>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-cyan-100 dark:bg-cyan-950 flex items-center justify-center text-cyan-600 dark:text-cyan-400">
                  <BarChart3 size={22} />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                    {isRtl ? "تحليلات الأداء والرقابة النوعية" : "Operational Analytics & Quality Control"}
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {isRtl ? "مؤشرات تغطية عيادات الأطباء ومطابقة الرسالة العلمية ومعدلات تحصيل مبيعات الصيدليات" : "Unified performance metrics tracking representative check-in rates and detailing conversion ratios."}
                  </p>
                </div>
              </div>
            </div>

            {/* Tab Selection */}
            <div className="flex flex-wrap gap-2 bg-slate-100 dark:bg-slate-850 p-1 rounded-xl text-xxs font-bold">
              <button 
                onClick={() => setMetricTab("performance")}
                className={`px-3 py-2 rounded-lg transition-all cursor-pointer ${metricTab === "performance" ? "bg-white dark:bg-slate-900 text-cyan-600 shadow-xs" : "text-slate-500"}`}
              >
                {isRtl ? "تقارير الأداء العام" : "Sales Performance"}
              </button>
              <button 
                onClick={() => setMetricTab("medical-quality")}
                className={`px-3 py-2 rounded-lg transition-all cursor-pointer ${metricTab === "medical-quality" ? "bg-white dark:bg-slate-900 text-cyan-600 shadow-xs" : "text-slate-500"}`}
              >
                {isRtl ? "الرقابة الطبية والنوعية" : "Medical Quality"}
              </button>
              <button 
                onClick={() => setMetricTab("synergy")}
                className={`px-3 py-2 rounded-lg transition-all cursor-pointer ${metricTab === "synergy" ? "bg-white dark:bg-slate-900 text-cyan-600 shadow-xs" : "text-slate-500"}`}
              >
                {isRtl ? "لوحة التآزر (9 مقاييس)" : "Territory Synergy Cockpit"}
              </button>
              <button 
                onClick={() => setMetricTab("reports")}
                className={`px-3 py-2 rounded-lg transition-all cursor-pointer ${metricTab === "reports" ? "bg-white dark:bg-slate-900 text-cyan-600 shadow-xs" : "text-slate-500"}`}
              >
                {isRtl ? "التقارير المتكاملة (8 تقارير)" : "Synergy Reports"}
              </button>
            </div>
          </div>

          {/* 1. SALES PERFORMANCE TAB */}
          {metricTab === "performance" && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-4 rounded-2xl flex items-center gap-4">
                  <div className="p-3 rounded-xl bg-cyan-50 dark:bg-cyan-950/40 text-cyan-600 dark:text-cyan-400">
                    <Users size={18} />
                  </div>
                  <div>
                    <span className="text-[9.5px] text-slate-400 block uppercase font-bold">{isRtl ? "معدل تغطية العيادات" : "Clinics Visited Coverage"}</span>
                    <span className="text-base font-bold text-slate-800 dark:text-white font-mono">98.2%</span>
                  </div>
                </div>

                <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-4 rounded-2xl flex items-center gap-4">
                  <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400">
                    <Activity size={18} />
                  </div>
                  <div>
                    <span className="text-[9.5px] text-slate-400 block uppercase font-bold">{isRtl ? "معدل تكرار الزيارات" : "Average Call Frequency"}</span>
                    <span className="text-base font-bold text-slate-800 dark:text-white font-mono">2.8x / doc</span>
                  </div>
                </div>

                <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-4 rounded-2xl flex items-center gap-4">
                  <div className="p-3 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400">
                    <Award size={18} />
                  </div>
                  <div>
                    <span className="text-[9.5px] text-slate-400 block uppercase font-bold">{isRtl ? "إنجاز الخطة الربعية" : "Target Quarter Achievement"}</span>
                    <span className="text-base font-bold text-slate-800 dark:text-white font-mono">112%</span>
                  </div>
                </div>
              </div>

              <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-5 rounded-2xl shadow-xxs space-y-4">
                <div>
                  <h3 className="text-xs font-bold text-slate-850 dark:text-white">
                    {isRtl ? "منحنى تغطية الأطباء المستهدفة والمحققة" : "Target vs. Actual Monthly Doctor Coverage"}
                  </h3>
                  <p className="text-[10px] text-slate-400">{isRtl ? "مقارنة نسب التغطية الفعلية مع خطط العمل المعتمدة" : "Tracking territory execution rates across representative clinics visits"}</p>
                </div>

                {/* Secure Scope Indicators */}
                <div className="flex items-center gap-2 text-[10px] bg-slate-50 dark:bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-200/50 dark:border-slate-850 w-fit">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-cyan-500"></span>
                  </span>
                  <span className="text-slate-400">Scoped database query active. Subordinate filters applied.</span>
                </div>

                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={[
                      { month: isRtl ? "يناير" : "Jan", TargetCoverage: 90, ActualCoverage: 88 },
                      { month: isRtl ? "فبراير" : "Feb", TargetCoverage: 92, ActualCoverage: 91 },
                      { month: isRtl ? "مارس" : "Mar", TargetCoverage: 95, ActualCoverage: 94 },
                      { month: isRtl ? "أبريل" : "Apr", TargetCoverage: 95, ActualCoverage: 92 },
                      { month: isRtl ? "مايو" : "May", TargetCoverage: 98, ActualCoverage: 97 },
                      { month: isRtl ? "يونيو" : "Jun", TargetCoverage: 98, ActualCoverage: 98 }
                    ]} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="month" stroke="#94a3b8" fontSize={10} tickLine={false} />
                      <YAxis stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={{ fontSize: "11px", borderRadius: "8px" }} />
                      <Legend wrapperStyle={{ fontSize: "10px", marginTop: "10px" }} />
                      <Bar dataKey="TargetCoverage" name={isRtl ? "التغطية المستهدفة (%)" : "Target Coverage (%)"} fill="#94a3b8" opacity={0.3} radius={[4, 4, 0, 0]} />
                      <Bar dataKey="ActualCoverage" name={isRtl ? "التغطية الفعلية (%)" : "Actual Coverage (%)"} fill="#06b6d4" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}

          {/* 2. MEDICAL QUALITY TAB */}
          {metricTab === "medical-quality" && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-5 rounded-2xl shadow-xxs space-y-4">
                  <div>
                    <h3 className="text-xs font-bold text-slate-850 dark:text-white">
                      {isRtl ? "مطابقة الرسالة العلمية واستجابة الطبيب" : "Detailing Message Quality Audit"}
                    </h3>
                    <p className="text-[10px] text-slate-400">{isRtl ? "نتائج زيارات المشرفين الميدانية لتقييم الاحترافية وتذكر الرسائل" : "Supervisor appraisal scoreboards evaluating scientific messaging"}</p>
                  </div>

                  <div className="space-y-3.5 text-xs text-slate-650">
                    <div className="space-y-1">
                      <div className="flex justify-between font-semibold">
                        <span>Key Message Retention Rating</span>
                        <span className="font-mono text-cyan-600 font-bold">89%</span>
                      </div>
                      <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                        <div className="bg-cyan-500 h-full rounded-full" style={{ width: "89%" }} />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between font-semibold">
                        <span>Scientific Detailing Skill Rating</span>
                        <span className="font-mono text-cyan-600 font-bold">92%</span>
                      </div>
                      <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                        <div className="bg-cyan-500 h-full rounded-full" style={{ width: "92%" }} />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-5 rounded-2xl shadow-xxs space-y-4">
                  <div>
                    <h3 className="text-xs font-bold text-slate-850 dark:text-white">
                      {isRtl ? "كفاءة المبيعات وتحصيل الصيدليات" : "Pharmacy Sales Efficiency Audits"}
                    </h3>
                    <p className="text-[10px] text-slate-400">{isRtl ? "سرعة سداد مديونيات الصيدليات ومعدل تحويل عروض البونص" : "Order conversion metrics and outstanding clearance logs"}</p>
                  </div>

                  <div className="space-y-3.5 text-xs text-slate-650">
                    <div className="space-y-1">
                      <div className="flex justify-between font-semibold">
                        <span>Outstanding Clearance Pace</span>
                        <span className="font-mono text-cyan-600 font-bold">94%</span>
                      </div>
                      <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                        <div className="bg-cyan-500 h-full rounded-full" style={{ width: "94%" }} />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between font-semibold">
                        <span>Order Form Conversion Yield</span>
                        <span className="font-mono text-cyan-600 font-bold">82%</span>
                      </div>
                      <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                        <div className="bg-cyan-500 h-full rounded-full" style={{ width: "82%" }} />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 3. SYNERGY COCKPIT (THE 9 SECURED WIDGETS) */}
          {metricTab === "synergy" && (
            <div className="space-y-6">
              
              {/* Top Info Banner */}
              <div className="bg-gradient-to-r from-cyan-600 to-indigo-600 p-5 rounded-2xl text-white flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="inline-flex items-center gap-1 bg-white/20 px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider">
                    <Sparkles size={10} />
                    <span>Executive Synergy Cockpit</span>
                  </div>
                  <h3 className="text-sm font-bold">Medical–Sales Alignment Metrics</h3>
                  <p className="text-[11px] text-cyan-100">Comparing representative field detailing with sales productivity on the same geographic grid.</p>
                </div>
                <div className="bg-white/10 backdrop-blur-md px-4 py-2 rounded-xl text-center border border-white/20">
                  <span className="text-[9px] uppercase font-bold text-cyan-200 block">General synergy</span>
                  <span className="text-lg font-black font-mono">91.4%</span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                
                {/* Widget 1: Medical visits by Territory */}
                <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-4 rounded-2xl flex flex-col justify-between h-64 shadow-xxs">
                  <div>
                    <span className="text-[10px] text-slate-400 font-bold block uppercase tracking-wider">1. Medical visits by Territory</span>
                    <span className="text-xxs text-slate-450 block">Physician call logs</span>
                  </div>
                  <div className="h-40 w-full mt-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={medicalVisitsByTerritory}>
                        <CartesianGrid strokeDasharray="2 2" vertical={false} stroke="#f1f5f9" />
                        <XAxis dataKey="territory" fontSize={8} stroke="#94a3b8" tickFormatter={(v) => v.split(" ").pop() || v} />
                        <YAxis fontSize={8} stroke="#94a3b8" />
                        <Tooltip contentStyle={{ fontSize: "10px" }} />
                        <Bar dataKey="visits" name="Visits" fill="#06b6d4" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Widget 2: Pharmacy visits by Territory */}
                <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-4 rounded-2xl flex flex-col justify-between h-64 shadow-xxs">
                  <div>
                    <span className="text-[10px] text-slate-400 font-bold block uppercase tracking-wider">2. Pharmacy visits by Territory</span>
                    <span className="text-xxs text-slate-450 block">Representative order logs</span>
                  </div>
                  <div className="h-40 w-full mt-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={pharmacyVisitsByTerritory}>
                        <CartesianGrid strokeDasharray="2 2" vertical={false} stroke="#f1f5f9" />
                        <XAxis dataKey="territory" fontSize={8} stroke="#94a3b8" tickFormatter={(v) => v.split(" ").pop() || v} />
                        <YAxis fontSize={8} stroke="#94a3b8" />
                        <Tooltip contentStyle={{ fontSize: "10px" }} />
                        <Bar dataKey="visits" name="Visits" fill="#6366f1" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Widget 3: Product detailing by Territory */}
                <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-4 rounded-2xl flex flex-col justify-between h-64 shadow-xxs">
                  <div>
                    <span className="text-[10px] text-slate-400 font-bold block uppercase tracking-wider">3. Product detailing by Territory</span>
                    <span className="text-xxs text-slate-450 block">Interactive message presentations</span>
                  </div>
                  <div className="h-40 w-full mt-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={detailingByTerritory}>
                        <CartesianGrid strokeDasharray="2 2" stroke="#f1f5f9" />
                        <XAxis dataKey="territory" fontSize={8} stroke="#94a3b8" tickFormatter={(v) => v.split(" ").pop() || v} />
                        <YAxis fontSize={8} stroke="#94a3b8" />
                        <Tooltip contentStyle={{ fontSize: "10px" }} />
                        <Area type="monotone" dataKey="detailing" name="Detailing Counts" stroke="#10b981" fill="#10b981" fillOpacity={0.1} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Widget 4: Orders by Territory */}
                <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-4 rounded-2xl flex flex-col justify-between h-64 shadow-xxs">
                  <div>
                    <span className="text-[10px] text-slate-400 font-bold block uppercase tracking-wider">4. Orders by Territory</span>
                    <span className="text-xxs text-slate-450 block">Signed sales slips</span>
                  </div>
                  <div className="h-40 w-full mt-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={ordersByTerritory}>
                        <CartesianGrid strokeDasharray="2 2" vertical={false} stroke="#f1f5f9" />
                        <XAxis dataKey="territory" fontSize={8} stroke="#94a3b8" tickFormatter={(v) => v.split(" ").pop() || v} />
                        <YAxis fontSize={8} stroke="#94a3b8" />
                        <Tooltip contentStyle={{ fontSize: "10px" }} />
                        <Bar dataKey="orders" name="Orders" fill="#f59e0b" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Widget 5: Sales by Product Group */}
                <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-4 rounded-2xl flex flex-col justify-between h-64 shadow-xxs">
                  <div>
                    <span className="text-[10px] text-slate-400 font-bold block uppercase tracking-wider">5. Sales by Product Group</span>
                    <span className="text-xxs text-slate-450 block">Combined invoice valuations</span>
                  </div>
                  <div className="h-40 w-full mt-2 flex flex-col justify-center space-y-2">
                    {salesByProductGroup.map((item, index) => (
                      <div key={index} className="text-xs space-y-1">
                        <div className="flex justify-between font-semibold text-slate-700 dark:text-slate-300">
                          <span>{item.group}</span>
                          <span className="font-mono">${item.sales.toLocaleString()}</span>
                        </div>
                        <div className="w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                          <div className="bg-emerald-500 h-full rounded-full" style={{ width: `${(item.sales / 37000) * 100}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Widget 6: Prescription intent by Product */}
                <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-4 rounded-2xl flex flex-col justify-between h-64 shadow-xxs">
                  <div>
                    <span className="text-[10px] text-slate-400 font-bold block uppercase tracking-wider">6. Prescription intent by Product</span>
                    <span className="text-xxs text-slate-450 block">Doctor subjective polling (1-10)</span>
                  </div>
                  <div className="h-40 w-full mt-2 flex flex-col justify-center space-y-3">
                    {prescriptionIntentByProduct.map((item, index) => (
                      <div key={index} className="flex items-center justify-between text-xs text-slate-700 dark:text-slate-300">
                        <span className="font-semibold">{item.product}</span>
                        <div className="flex items-center gap-1">
                          <Smile size={12} className="text-yellow-500" />
                          <span className="font-mono font-bold text-cyan-600">{item.rating} / 10</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Widget 7: Physician reaction by Product */}
                <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-4 rounded-2xl flex flex-col justify-between h-64 shadow-xxs">
                  <div>
                    <span className="text-[10px] text-slate-400 font-bold block uppercase tracking-wider">7. Physician reaction by Product</span>
                    <span className="text-xxs text-slate-450 block">KOL presentation feedback</span>
                  </div>
                  <div className="h-40 w-full mt-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={physicianReactionByProduct}>
                        <CartesianGrid strokeDasharray="2 2" vertical={false} stroke="#f1f5f9" />
                        <XAxis dataKey="product" fontSize={8} stroke="#94a3b8" />
                        <YAxis fontSize={8} stroke="#94a3b8" />
                        <Tooltip contentStyle={{ fontSize: "10px" }} />
                        <Bar dataKey="Positive" name="Positive %" fill="#10b981" radius={[2, 2, 0, 0]} />
                        <Bar dataKey="Skeptical" name="Skeptical %" fill="#94a3b8" opacity={0.5} radius={[2, 2, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Widget 8: Samples distributed by Product */}
                <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-4 rounded-2xl flex flex-col justify-between h-64 shadow-xxs">
                  <div>
                    <span className="text-[10px] text-slate-400 font-bold block uppercase tracking-wider">8. Samples distributed by Product</span>
                    <span className="text-xxs text-slate-450 block">Audit-logged clinic handouts</span>
                  </div>
                  <div className="h-40 w-full mt-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={samplesDistributedByProduct}>
                        <CartesianGrid strokeDasharray="2 2" vertical={false} stroke="#f1f5f9" />
                        <XAxis dataKey="product" fontSize={8} stroke="#94a3b8" />
                        <YAxis fontSize={8} stroke="#94a3b8" />
                        <Tooltip contentStyle={{ fontSize: "10px" }} />
                        <Bar dataKey="qty" name="Units" fill="#ec4899" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Widget 9: Territory medical-sales synergy score */}
                <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-4 rounded-2xl flex flex-col justify-between h-64 shadow-xxs">
                  <div>
                    <span className="text-[10px] text-slate-400 font-bold block uppercase tracking-wider">9. Territory medical-sales synergy score</span>
                    <span className="text-xxs text-slate-450 block">Plan overlap & correlation factor</span>
                  </div>
                  <div className="h-40 w-full mt-2 flex flex-col justify-center space-y-2">
                    {territorySynergyScores.map((item, index) => (
                      <div key={index} className="text-xs space-y-1">
                        <div className="flex justify-between font-semibold text-slate-700 dark:text-slate-300">
                          <span>{item.territory}</span>
                          <span className="font-mono text-emerald-600 font-bold">{item.score}%</span>
                        </div>
                        <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                          <div className="bg-emerald-500 h-full rounded-full" style={{ width: `${item.score}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

              </div>
            </div>
          )}

          {/* 4. SYNERGY INTEGRATED REPORTS TAB */}
          {metricTab === "reports" && (
            <div className="animate-fade-in bg-slate-50 dark:bg-slate-950 p-4 rounded-2xl border border-slate-100 dark:border-slate-900">
              <SynergyReports lang={lang} currentUser={currentUser} dbState={dbState} />
            </div>
          )}

        </div>
      )}

    </div>
  );
}
