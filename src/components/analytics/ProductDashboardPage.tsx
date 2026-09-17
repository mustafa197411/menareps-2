import React, { useState, useEffect, useMemo } from "react";
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  LineChart, Line, ComposedChart, AreaChart, Area, PieChart, Pie, Cell
} from "recharts";
import { 
  TrendingUp, TrendingDown, Award, Activity, Package, BarChart3, 
  Target, AlertTriangle, CheckCircle, ChevronDown, Filter, HelpCircle, 
  MapPin, RefreshCw, Layers, Zap, MessageSquare, ShieldCheck,
  ChevronRight, Calendar, DollarSign, AlertCircle, X, ShieldAlert,
  ArrowUpRight, ListFilter, Users, Info, Sparkles, BookOpen, FileText, Download
} from "lucide-react";
import { 
  Role, 
  User, 
  Product, 
  UserTerritoryAssignment, 
  UserProductAssignment
} from "../../types";
import { auth } from "../../lib/firebase";
import { fetchScopedProductAnalytics } from "../../lib/productAnalyticsReadClient";
import { aggregateSingleCurrency, formatCurrencyForIdentity, resolveMarketForIdentity } from "../../lib/marketSettings";

interface ProductDashboardPageProps {
  currentUser: User;
  lang: "en" | "ar";
  users: User[];
  products: Product[];
  userTerritoryAssignments: UserTerritoryAssignment[];
  userProductAssignments: UserProductAssignment[];
  physicianVisits: any[];
  pharmacyVisits: any[];
}

export default function ProductDashboardPage({
  currentUser,
  lang,
  users = [],
  products = [],
  userTerritoryAssignments = [],
  userProductAssignments = [],
  physicianVisits = [],
  pharmacyVisits = []
}: ProductDashboardPageProps) {
  const isRtl = lang === "ar";
  const marketIdentity = currentUser as User & { marketId?: string; countryId?: string };
  const market = useMemo(() => resolveMarketForIdentity([], marketIdentity), [marketIdentity.marketId, marketIdentity.countryId, marketIdentity.country]);
  const money = (amount: number) => formatCurrencyForIdentity(amount, marketIdentity);
  const currencyCode = market?.currencyCode || "Currency configuration required";

  // State Overrides & Setup
  const [activeSideTab, setActiveSideTab] = useState<string>("Overview");
  const [selectedProduct, setSelectedProduct] = useState<string>("All");
  const [selectedTherapeuticArea, setSelectedTherapeuticArea] = useState<string>("All");
  const [showFilters, setShowFilters] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Live Firestore orders state
  const [firestoreOrders, setFirestoreOrders] = useState<any[]>([]);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);

  useEffect(() => {
    let active = true;
    const fetchOrders = async () => {
      try {
        setIsSyncing(true);
        if (!auth.currentUser) throw new Error("AUTH_REQUIRED");
        const result = await fetchScopedProductAnalytics(auth.currentUser);
        const list = result.orders;
        const aggregate = list.length ? aggregateSingleCurrency(list.map(order => ({ amount: order.total, currencyCode: order.currencyCode }))) : null;
        if (aggregate && market && aggregate.currencyCode !== market.currencyCode) throw new Error("ORDER_CURRENCY_OUTSIDE_MARKET");
        if (active) {
          setFirestoreOrders(list);
        }
      } catch (e) {
        console.warn("[Product Analytics] scoped orders query failed closed.", e);
        if (active) setFirestoreOrders([]);
      } finally {
        if (active) {
          setIsSyncing(false);
        }
      }
    };
    fetchOrders();
    return () => {
      active = false;
    };
  }, [market?.currencyCode]);

  // Product master data is supplied by the canonical scoped application state.
  const defaultProducts = useMemo(() => {
    return products || [];
  }, [products]);

  // Therapeutic Areas
  const therapeuticAreas = useMemo(() => {
    const areas = new Set<string>();
    defaultProducts.forEach(p => {
      if (p.therapeuticArea) areas.add(p.therapeuticArea);
    });
    return Array.from(areas);
  }, [defaultProducts]);

  // Performance calculations per product (connecting orders, targets, visits)
  const liveProductPerformanceStats = useMemo(() => {
    return defaultProducts.map((p) => {
      // Calculate actual sales from live orders
      let actualVal = 0;
      firestoreOrders.forEach(order => {
        if (order.status !== "Voided") {
          const matchingItem = order.items?.find((item: any) => item.productId === p.id || item.id === p.id || item.name === p.name);
          if (matchingItem) {
            actualVal += (matchingItem.total || (matchingItem.quantity * matchingItem.price) || 0);
          }
        }
      });

      const targetVal = Number((p as any).targetValue || (p as any).salesTarget || 0);
      const finalActual = actualVal;

      const gapVal = Math.max(0, targetVal - finalActual);
      const achievementPct = targetVal > 0 ? Math.round((finalActual / targetVal) * 100) : 0;

      // Extract details
      const visitsWithProduct = physicianVisits.filter(v => 
        (v.detailedProducts && v.detailedProducts.includes(p.id)) ||
        (v.productId === p.id)
      ).length + pharmacyVisits.filter(v => v.productId === p.id || v.detailedProducts?.includes(p.id)).length;

      const matchingPhysicianVisits = physicianVisits.filter(v => (v.detailing || v.productsDetailed || []).some((item: any) => (item.productId || item.id) === p.id));
      const visualAidsUsed = matchingPhysicianVisits.reduce((sum, visit) => sum + Number((visit.visualAids || []).filter((item: any) => (item.productId || item.id) === p.id).length), 0);
      const samplesDistributed = [...physicianVisits, ...pharmacyVisits].reduce((sum, visit) => sum + (visit.samples || visit.samplesDistributed || []).filter((item: any) => (item.productId || item.id) === p.id).reduce((quantity: number, item: any) => quantity + Number(item.quantity || 0), 0), 0);

      return {
        id: p.id,
        name: p.name,
        brand: p.brand || p.name.split(" ")[0] || "Generic",
        code: p.code || p.id,
        therapeuticArea: p.therapeuticArea || "General Medicine",
        price: p.price || 0,
        target: targetVal,
        actual: finalActual,
        gap: gapVal,
        achievement: achievementPct,
        visits: visitsWithProduct,
        visualAids: visualAidsUsed,
        samples: samplesDistributed
      };
    });
  }, [defaultProducts, firestoreOrders, physicianVisits, pharmacyVisits]);

  // Apply filters to performance stats
  const filteredProductStats = useMemo(() => {
    return liveProductPerformanceStats.filter(stat => {
      const matchProduct = selectedProduct === "All" || stat.id === selectedProduct;
      const matchArea = selectedTherapeuticArea === "All" || stat.therapeuticArea === selectedTherapeuticArea;
      const matchSearch = searchQuery === "" || 
        stat.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
        stat.code.toLowerCase().includes(searchQuery.toLowerCase());
      return matchProduct && matchArea && matchSearch;
    });
  }, [liveProductPerformanceStats, selectedProduct, selectedTherapeuticArea, searchQuery]);

  // Aggregated Summary Metrics
  const summaryMetrics = useMemo(() => {
    let totalTarget = 0;
    let totalActual = 0;
    
    filteredProductStats.forEach(p => {
      totalTarget += p.target;
      totalActual += p.actual;
    });

    const totalGap = Math.max(0, totalTarget - totalActual);
    const overallAchievement = totalTarget > 0 ? Math.round((totalActual / totalTarget) * 100) : 0;

    return {
      target: totalTarget,
      actual: totalActual,
      gap: totalGap,
      achievement: overallAchievement
    };
  }, [filteredProductStats]);

  // Brand aggregations
  const brandMetrics = useMemo(() => {
    const brandsMap: Record<string, { target: number; actual: number; products: string[] }> = {};
    liveProductPerformanceStats.forEach(p => {
      if (!brandsMap[p.brand]) {
        brandsMap[p.brand] = { target: 0, actual: 0, products: [] };
      }
      brandsMap[p.brand].target += p.target;
      brandsMap[p.brand].actual += p.actual;
      brandsMap[p.brand].products.push(p.name);
    });

    return Object.entries(brandsMap).map(([brandName, data]) => {
      const achievement = data.target > 0 ? Math.round((data.actual / data.target) * 100) : 0;
      return {
        brand: brandName,
        target: data.target,
        actual: data.actual,
        achievement,
        products: data.products,
        gap: Math.max(0, data.target - data.actual)
      };
    });
  }, [liveProductPerformanceStats]);

  // Top resources
  const topResources = useMemo(() => {
    const counts = new Map<string, number>();
    physicianVisits.forEach(visit => (visit.visualAids || visit.materialsUsed || []).forEach((item: any) => { const name = String(item.name || item.title || item.id || "Resource"); counts.set(name, (counts.get(name) || 0) + 1); }));
    const max = Math.max(1, ...counts.values());
    return Array.from(counts, ([name, count], index) => ({ name, count, percentage: Math.round(count / max * 100), color: ["#6366f1", "#10b981", "#f59e0b", "#ec4899", "#06b6d4"][index % 5] })).sort((a, b) => b.count - a.count).slice(0, 5);
  }, [physicianVisits]);

  // Top messages
  const topKeyMessages = useMemo(() => {
    const messages = new Map<string, { message: string; product: string; count: number; positive: number }>();
    physicianVisits.forEach(visit => (visit.detailing || visit.productsDetailed || []).forEach((item: any) => { const message = String(item.keyMessage || item.message || item.notes || "").trim(); if (!message) return; const key = `${item.productId || item.id || item.brandName}:${message}`; const current = messages.get(key) || { message, product: String(item.brandName || item.productName || item.productId || "Product"), count: 0, positive: 0 }; current.count += 1; if (String(item.reaction || "").toLowerCase() === "positive") current.positive += 1; messages.set(key, current); }));
    const totalVisits = Math.max(1, physicianVisits.length);
    return Array.from(messages.values()).sort((a, b) => b.count - a.count).slice(0, 4).map(item => ({ message: item.message, product: item.product, efficacyScore: item.count ? `${(item.positive / item.count * 5).toFixed(1)} / 5.0` : "—", coverage: `${Math.round(item.count / totalVisits * 100)}%` }));
  }, [physicianVisits]);

  // Geographic mapping
  const territoryProductSales = useMemo(() => {
    const rows = new Map<string, Record<string, string | number>>();
    firestoreOrders.forEach(order => { const areaId = String(order.areaId || ""); if (!areaId) return; const row = rows.get(areaId) || { territory: areaId }; (order.items || []).forEach((item: any) => { const productId = String(item.productId || item.id || ""); if (productId) row[productId] = Number(row[productId] || 0) + Number(item.total || 0); }); rows.set(areaId, row); });
    return Array.from(rows.values());
  }, [firestoreOrders]);
  const territoryProducts = useMemo(() => defaultProducts.slice(0, 4), [defaultProducts]);

  // Sales Trends timeline
  const salesTrendsData = useMemo(() => {
    const byMonth = new Map<string, number>(); firestoreOrders.forEach(order => { const month = String(order.date || "").slice(0, 7); if (month) byMonth.set(month, (byMonth.get(month) || 0) + Number(order.total || 0)); });
    return Array.from(byMonth, ([date, actual]) => ({ date, actual, target: 0 })).sort((a, b) => a.date.localeCompare(b.date)).slice(-6);
  }, [firestoreOrders]);

  // Internal Left Navigation items
  const sidebarNavItems = [
    { id: "Overview", label: { en: "Overview", ar: "نظرة عامة" } },
    { id: "Brand Performance", label: { en: "Brand Performance", ar: "أداء العلامة التجارية" } },
    { id: "Product Analysis", label: { en: "Product Analysis", ar: "تحليل المنتجات" } },
    { id: "Sales Trends", label: { en: "Sales Trends", ar: "اتجاهات المبيعات" } },
    { id: "Target Comparison", label: { en: "Target Comparison", ar: "مقارنة الأهداف" } },
    { id: "Rankings", label: { en: "Rankings", ar: "الترتيب والتصنيف" } },
    { id: "Resource Engagement", label: { en: "Resource Engagement", ar: "تفاعل الموارد" } },
    { id: "Territory Pharmacy Sales", label: { en: "Territory Pharmacy Sales", ar: "مبيعات الصيدليات الإقليمية" } }
  ];

  // Specific product selected detail lookups
  const [productLookupId, setProductLookupId] = useState<string>("p1");
  const selectedLookupProduct = useMemo(() => {
    return liveProductPerformanceStats.find(p => p.id === productLookupId) || liveProductPerformanceStats[0];
  }, [liveProductPerformanceStats, productLookupId]);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      
      {/* HEADER BAR */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-1.5 bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 rounded-lg">
              <Package size={20} />
            </span>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white font-sans tracking-tight">
              {isRtl ? "لوحة مؤشرات أداء المنتجات" : "Product Dashboard"}
            </h1>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-2xl mt-1">
            {isRtl 
              ? "استعراض الأداء البيعي للمستحضرات الطبية ومستويات تحقيق الأهداف، ورصد الفجوات وتحليل انتشار الرسائل العلمية وتأثيرها الميداني." 
              : "Analyze brand and product performance"}
          </p>
        </div>

        {/* Security badges & Filters toggle */}
        <div className="flex flex-wrap items-center gap-2">
          {/* All Data Scope Badge */}
          <span className="text-xxs font-bold uppercase tracking-wider bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 px-3 py-1.5 rounded-full border border-indigo-100 dark:border-indigo-900">
            {isRtl ? "كامل البيانات" : "All Data"}
          </span>

          {/* Territory Scope Indicator */}
          <div className="flex items-center gap-1.5 text-xxs bg-slate-50 dark:bg-slate-900 px-3 py-1.5 rounded-full border border-slate-200 dark:border-slate-800">
            <ShieldCheck size={11} className="text-indigo-500" />
            <span className="font-mono text-slate-600 dark:text-slate-400 uppercase font-bold">
              {isRtl ? "مستوى المنتج: نظامي" : "Product Scope: Compliant"}
            </span>
          </div>

          {/* Collapsible Filter Button */}
          <button 
            onClick={() => setShowFilters(!showFilters)}
            className={`p-2 rounded-lg border text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors ${
              showFilters 
                ? "bg-indigo-50 border-indigo-200 text-indigo-600 dark:bg-indigo-950 dark:border-indigo-900 dark:text-indigo-400" 
                : "bg-white border-slate-200 hover:bg-slate-50 text-slate-600 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-300"
            }`}
          >
            <Filter size={14} />
            <span>{isRtl ? "تصفية" : "Filters"}</span>
          </button>
        </div>
      </div>

      {/* COLLAPSIBLE FILTER PANEL */}
      {showFilters && (
        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 p-4 rounded-xl shadow-xxs transition-all">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-450 block uppercase">
                {isRtl ? "مستحضر دوائي محدد" : "Specific Product SKU"}
              </label>
              <select
                value={selectedProduct}
                onChange={(e) => setSelectedProduct(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-700 dark:text-slate-300 font-medium focus:outline-none"
              >
                <option value="All">{isRtl ? "جميع المستحضرات" : "All SKUs"}</option>
                {defaultProducts.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-450 block uppercase">
                {isRtl ? "المجموعة العلاجية" : "Therapeutic Area"}
              </label>
              <select
                value={selectedTherapeuticArea}
                onChange={(e) => setSelectedTherapeuticArea(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-700 dark:text-slate-300 font-medium focus:outline-none"
              >
                <option value="All">{isRtl ? "جميع المجموعات العلاجية" : "All Areas"}</option>
                {therapeuticAreas.map(area => (
                  <option key={area} value={area}>{area}</option>
                ))}
              </select>
            </div>

            <div className="flex items-end gap-2">
              <div className="relative flex-grow">
                <input
                  type="text"
                  placeholder={isRtl ? "بحث بالرمز أو الاسم..." : "Search by name or code..."}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg pl-2.5 pr-2.5 py-1.5 text-slate-700 dark:text-slate-300 font-medium focus:outline-none"
                />
              </div>
              <button 
                onClick={() => {
                  setSelectedProduct("All");
                  setSelectedTherapeuticArea("All");
                  setSearchQuery("");
                }}
                className="bg-slate-150 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-600 dark:text-slate-300 font-bold py-1.5 px-3 rounded-lg flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <RefreshCw size={13} />
                <span>{isRtl ? "إعادة تعيين" : "Reset"}</span>
              </button>
            </div>

          </div>
        </div>
      )}

      {/* MAIN LAYOUT: INTERNAL SIDE NAVIGATION & MAIN CONTENT PANE */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        
        {/* INTERNAL LEFT SIDEBAR */}
        <div className="md:col-span-1 space-y-1">
          <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 p-2 rounded-2xl shadow-xxs">
            <span className="text-[10px] text-slate-400 font-bold uppercase block px-3 py-2 border-b border-slate-100 dark:border-slate-800/60 mb-2">
              {isRtl ? "أقسام التحليل المباشر" : "Analysis Sections"}
            </span>
            <div className="space-y-1">
              {sidebarNavItems.map((item) => {
                const isActive = activeSideTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setActiveSideTab(item.id)}
                    className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-between transition-all cursor-pointer ${
                      isActive 
                        ? "bg-indigo-600 text-white shadow-xs" 
                        : "text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-950"
                    }`}
                  >
                    <span>{isRtl ? item.label.ar : item.label.en}</span>
                    <ChevronRight size={14} className={`opacity-70 transform transition-transform ${isActive ? "rotate-90 text-white" : ""}`} />
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* MAIN DASHBOARD CONTENT AREA */}
        <div className="md:col-span-3 space-y-6">

          {/* ACTIVE SECTION PATH & HEADER */}
          <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 p-4 rounded-xl flex items-center justify-between shadow-xxs">
            <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 font-medium">
              <span>{isRtl ? "تحليل أداء المنتجات" : "Product Dashboard"}</span>
              <ChevronRight size={12} className="opacity-50" />
              <span className="text-indigo-600 dark:text-indigo-400 font-bold">
                {isRtl ? sidebarNavItems.find(t => t.id === activeSideTab)?.label.ar : activeSideTab}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
              <span className="text-[10px] font-mono font-bold text-slate-400 uppercase">Live sync active</span>
            </div>
          </div>

          {/* KPI CARDS (TARGET VS ACTUAL / GAP / ACHIEVEMENT) - PERSISTENT IN APPROPRIATE TABS */}
          {activeSideTab !== "Product Analysis" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Target */}
              <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 p-5 rounded-2xl shadow-xxs relative overflow-hidden">
                <div className="absolute right-0 top-0 h-1 w-full bg-indigo-500" />
                <span className="text-[10px] text-slate-400 font-bold block uppercase">{isRtl ? "الهدف البيعي الإجمالي" : "Target Prescriptions Volume"}</span>
                <div className="flex items-baseline gap-2 mt-2">
                  <span className="text-xl font-black text-slate-850 dark:text-white font-mono">{money(summaryMetrics.target)}</span>
                  <Target size={14} className="text-indigo-500" />
                </div>
                <p className="text-[10px] text-slate-400 mt-1.5">{isRtl ? "الحصة المستهدفة المعتمدة للمستحضرات" : "Aggregated quota expectation for current active items."}</p>
              </div>

              {/* Actual */}
              <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 p-5 rounded-2xl shadow-xxs relative overflow-hidden">
                <div className="absolute right-0 top-0 h-1 w-full bg-emerald-500" />
                <span className="text-[10px] text-slate-400 font-bold block uppercase">{isRtl ? "المبيعات الفعلية المحققة" : "Actual Sales Volume"}</span>
                <div className="flex items-baseline gap-2 mt-2">
                  <span className="text-xl font-black text-slate-850 dark:text-white font-mono">{money(summaryMetrics.actual)}</span>
                  <CheckCircle size={14} className="text-emerald-500" />
                </div>
                <p className="text-[10px] text-slate-400 mt-1.5">{isRtl ? "إجمالي قيمة الطلبيات الدوائية المؤكدة" : "Confirmed commercial order value successfully validated."}</p>
              </div>

              {/* Gap */}
              <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 p-5 rounded-2xl shadow-xxs relative overflow-hidden">
                <div className="absolute right-0 top-0 h-1 w-full bg-rose-500" />
                <span className="text-[10px] text-slate-400 font-bold block uppercase">{isRtl ? "الفجوة المتبقية للهدف" : "Target Gap / Shortfall"}</span>
                <div className="flex items-baseline gap-2 mt-2">
                  <span className="text-xl font-black text-slate-850 dark:text-white font-mono">{money(summaryMetrics.gap)}</span>
                  <AlertTriangle size={14} className="text-rose-500" />
                </div>
                <p className="text-[10px] text-slate-400 mt-1.5">{isRtl ? "المتبقي للوصول للمستهدف الإقليمي" : "Remaining distance to reach full budget coverage."}</p>
              </div>

              {/* Achievement Pct */}
              <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 p-5 rounded-2xl shadow-xxs relative overflow-hidden">
                <div className="absolute right-0 top-0 h-1 w-full bg-amber-500" />
                <span className="text-[10px] text-slate-400 font-bold block uppercase">{isRtl ? "معدل الإنجاز العام" : "Achievement Percentage"}</span>
                <div className="flex items-baseline gap-2 mt-2">
                  <span className="text-xl font-black text-slate-850 dark:text-white font-mono">{summaryMetrics.achievement}%</span>
                  <Award size={14} className="text-amber-500" />
                </div>
                <p className="text-[10px] text-slate-400 mt-1.5">{isRtl ? "الكفاءة الإجمالية في ترويج المستحضرات" : "Overall performance index across targeted regions."}</p>
              </div>
            </div>
          )}

          {/* TAB CONTENTS */}

          {/* 1. OVERVIEW */}
          {activeSideTab === "Overview" && (
            <div className="space-y-6">
              
              {/* Charts grid */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* Target vs Actual gap chart */}
                <div className="lg:col-span-2 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 p-5 rounded-2xl shadow-xxs space-y-4">
                  <div>
                    <h3 className="text-xs font-bold text-slate-850 dark:text-white uppercase flex items-center gap-1.5">
                      <BarChart3 size={14} className="text-indigo-500" />
                      <span>{isRtl ? "تحليل الفجوات ومقارنة المبيعات بكل مستحضر" : "Product Performance & Target Gap Analysis"}</span>
                    </h3>
                    <p className="text-[10px] text-slate-400">{isRtl ? "مقارنة مباشرة بين المستهدف المطلوب والفعلي المحقق لتحديد فجوات السوق" : "Direct visual comparison of current sales volume achievements versus assigned targets."}</p>
                  </div>

                  <div className="h-64 w-full text-xs">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={filteredProductStats} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis dataKey="code" stroke="#94a3b8" fontSize={9} tickLine={false} />
                        <YAxis stroke="#94a3b8" fontSize={9} tickLine={false} axisLine={false} />
                        <Tooltip contentStyle={{ fontSize: "11px", borderRadius: "8px" }} />
                        <Legend wrapperStyle={{ fontSize: "10px" }} />
                        <Bar dataKey="target" name={`${isRtl ? "الهدف المطلوب" : "Target"} (${currencyCode})`} fill="#94a3b8" opacity={0.4} radius={[4, 4, 0, 0]} />
                        <Bar dataKey="actual" name={`${isRtl ? "الفعلي المحقق" : "Actual"} (${currencyCode})`} fill="#6366f1" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Top Promotional Resources */}
                <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 p-5 rounded-2xl shadow-xxs space-y-4">
                  <div>
                    <h3 className="text-xs font-bold text-slate-850 dark:text-white uppercase flex items-center gap-1.5">
                      <Layers size={14} className="text-indigo-500" />
                      <span>{isRtl ? "المواد والمساعدات الترويجية المستخدمة" : "Top Detailing Resources Utilized"}</span>
                    </h3>
                    <p className="text-[10px] text-slate-400">{isRtl ? "الموارد العلمية وأدوات الإقناع الأكثر تأثيراً بالزيارات" : "Top promotional aids deployed during professional visits."}</p>
                  </div>

                  <div className="space-y-3 pt-2">
                    {topResources.map((res, index) => (
                      <div key={index} className="space-y-1 text-xs">
                        <div className="flex justify-between font-medium">
                          <span className="text-slate-650 truncate max-w-[180px] dark:text-slate-300">{res.name}</span>
                          <span className="font-mono font-bold text-indigo-600">{res.percentage}%</span>
                        </div>
                        <div className="w-full bg-slate-50 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                          <div 
                            className="h-full rounded-full transition-all"
                            style={{ width: `${res.percentage}%`, backgroundColor: res.color }} 
                          />
                        </div>
                        <span className="text-[9px] text-slate-400 block font-mono">
                          {res.count} {isRtl ? "سجل ترويجي" : "logs reported"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

              </div>

              {/* ORIGINAL TOP PRODUCTS SECTION */}
              <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 rounded-2xl shadow-xxs overflow-hidden space-y-4 p-5">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div>
                    <h3 className="text-xs font-bold text-slate-850 dark:text-white uppercase flex items-center gap-1.5">
                      <Award size={14} className="text-indigo-500" />
                      <span>{isRtl ? "ترتيب أداء المستحضرات الدوائية والطبية" : "Top Products Performance Table"}</span>
                    </h3>
                    <p className="text-[10px] text-slate-400">{isRtl ? "تفصيل ومقارنة شاملة لمستويات الطلب والمبيعات لكل منتج" : "Comprehensive breakdown and achievement ratios per therapeutic product."}</p>
                  </div>
                  <div className="text-[10px] bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 px-3 py-1 rounded-full font-bold">
                    {isRtl ? `مستحضرات معروضة: ${filteredProductStats.length}` : `Displaying: ${filteredProductStats.length} products`}
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left border-collapse" dir={isRtl ? "rtl" : "ltr"}>
                    <thead>
                      <tr className="bg-slate-50 dark:bg-slate-950 text-slate-450 uppercase font-black tracking-wider text-[10px] border-b border-slate-100 dark:border-slate-800">
                        <th className="p-3 text-center w-12">#</th>
                        <th className="p-3">{isRtl ? "المستحضر" : "Product SKU"}</th>
                        <th className="p-3 text-center">{isRtl ? "الرمز" : "Code"}</th>
                        <th className="p-3">{isRtl ? "المجموعة العلاجية" : "Therapeutic Area"}</th>
                        <th className="p-3 text-right">{`${isRtl ? "الهدف" : "Target"} (${currencyCode})`}</th>
                        <th className="p-3 text-right">{`${isRtl ? "الفعلي" : "Actual"} (${currencyCode})`}</th>
                        <th className="p-3 text-center">{isRtl ? "معدل الإنجاز" : "Achievement %"}</th>
                        <th className="p-3 text-center">{isRtl ? "الحالة" : "Status"}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                      {filteredProductStats.map((p, idx) => {
                        const isHigh = p.achievement >= 90;
                        const isLow = p.achievement < 70;
                        return (
                          <tr key={p.id} className="hover:bg-slate-50/55 dark:hover:bg-slate-950/40 transition-colors">
                            <td className="p-3 text-center font-mono font-bold text-slate-400">{idx + 1}</td>
                            <td className="p-3">
                              <div className="font-bold text-slate-850 dark:text-white">{p.name}</div>
                              <div className="text-[10px] text-slate-400">{p.brand}</div>
                            </td>
                            <td className="p-3 text-center font-mono font-semibold text-slate-500">{p.code}</td>
                            <td className="p-3">
                              <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px] font-bold text-slate-600 dark:text-slate-350">
                                {p.therapeuticArea}
                              </span>
                            </td>
                            <td className="p-3 text-right font-mono text-slate-500 dark:text-slate-450">{money(p.target)}</td>
                            <td className="p-3 text-right font-mono font-bold text-slate-800 dark:text-white">{money(p.actual)}</td>
                            <td className="p-3 text-center">
                              <div className="flex items-center justify-center gap-1.5">
                                <span className={`font-mono font-black text-xs ${isHigh ? "text-emerald-600" : isLow ? "text-rose-600" : "text-amber-600"}`}>
                                  {p.achievement}%
                                </span>
                              </div>
                            </td>
                            <td className="p-3 text-center">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                isHigh 
                                  ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400" 
                                  : isLow 
                                  ? "bg-rose-50 text-rose-600 dark:bg-rose-950/30 dark:text-rose-400" 
                                  : "bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400"
                              }`}>
                                {isHigh ? (isRtl ? "مكتمل" : "On Track") : isLow ? (isRtl ? "حرج" : "Critical Gap") : (isRtl ? "مستقر" : "Attention")}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

            </div>
          )}

          {/* 2. BRAND PERFORMANCE */}
          {activeSideTab === "Brand Performance" && (
            <div className="space-y-6">
              
              {/* Brand Summary Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 p-5 rounded-2xl shadow-xxs">
                  <span className="text-[10px] text-slate-400 font-bold block uppercase">{isRtl ? "العلامات التجارية النشطة" : "Active Brands Registered"}</span>
                  <div className="flex items-baseline gap-2 mt-2">
                    <span className="text-xl font-black text-slate-850 dark:text-white font-mono">{brandMetrics.length}</span>
                    <Layers size={14} className="text-indigo-500" />
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1.5">{isRtl ? "إجمالي العلامات التجارية المتداولة" : "Total active proprietary brands under supervision."}</p>
                </div>

                <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 p-5 rounded-2xl shadow-xxs">
                  <span className="text-[10px] text-slate-400 font-bold block uppercase">{isRtl ? "العلامة الأكثر مبيعاً" : "Top Performing Brand"}</span>
                  <div className="flex items-baseline gap-2 mt-2">
                    <span className="text-xl font-black text-slate-850 dark:text-white">
                      {brandMetrics.sort((a, b) => b.achievement - a.achievement)[0]?.brand || "N/A"}
                    </span>
                    <Award size={14} className="text-amber-500" />
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1.5">{isRtl ? "العلامة التجارية ذات أعلى معدل تحقيق أهداف" : "Brand with highest current quota achievement index."}</p>
                </div>

                <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 p-5 rounded-2xl shadow-xxs">
                  <span className="text-[10px] text-slate-400 font-bold block uppercase">{isRtl ? "متوسط إنجاز العلامات" : "Average Brand Achievement"}</span>
                  <div className="flex items-baseline gap-2 mt-2">
                    <span className="text-xl font-black text-slate-850 dark:text-white font-mono">
                      {Math.round(brandMetrics.reduce((sum, b) => sum + b.achievement, 0) / (brandMetrics.length || 1))}%
                    </span>
                    <Activity size={14} className="text-emerald-500" />
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1.5">{isRtl ? "متوسط نسب تحقيق المستهدف لكل العلامات" : "Mean achievement percentage across all active portfolios."}</p>
                </div>
              </div>

              {/* Graphic analysis of brands */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                <div className="lg:col-span-2 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 p-5 rounded-2xl shadow-xxs space-y-4">
                  <div>
                    <h3 className="text-xs font-bold text-slate-850 dark:text-white uppercase flex items-center gap-1.5">
                      <BarChart3 size={14} className="text-indigo-500" />
                      <span>{isRtl ? "أداء المبيعات الإجمالي لكل علامة تجارية" : "Brand Quota vs Actual Sales Volume"}</span>
                    </h3>
                    <p className="text-[10px] text-slate-400">{isRtl ? "تحليل ومقارنة حجم المستهدف والطلب لكل علامة رئيسية" : "Direct comparison of commercial budget quota versus actual achievements per product portfolio line."}</p>
                  </div>

                  <div className="h-64 w-full text-xs">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={brandMetrics} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis dataKey="brand" stroke="#94a3b8" fontSize={9} tickLine={false} />
                        <YAxis stroke="#94a3b8" fontSize={9} tickLine={false} axisLine={false} />
                        <Tooltip contentStyle={{ fontSize: "11px", borderRadius: "8px" }} />
                        <Legend wrapperStyle={{ fontSize: "10px" }} />
                        <Bar dataKey="target" name={`${isRtl ? "المستهدف" : "Target Quota"} (${currencyCode})`} fill="#cbd5e1" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="actual" name={`${isRtl ? "الفعلي" : "Actual Sales"} (${currencyCode})`} fill="#10b981" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 p-5 rounded-2xl shadow-xxs space-y-4">
                  <div>
                    <h3 className="text-xs font-bold text-slate-850 dark:text-white uppercase flex items-center gap-1.5">
                      <Layers size={14} className="text-indigo-500" />
                      <span>{isRtl ? "توزيع العلامات جغرافياً" : "Brand Market Contribution"}</span>
                    </h3>
                    <p className="text-[10px] text-slate-400">{isRtl ? "الحصة النسبية المئوية لمبيعات العلامات التجارية" : "Relative proportion of overall company sales volume contributed by each brand."}</p>
                  </div>

                  <div className="space-y-4 pt-2">
                    {brandMetrics.map((b, index) => {
                      const percentageOfTotal = Math.round((b.actual / (summaryMetrics.actual || 1)) * 100);
                      return (
                        <div key={index} className="space-y-1 text-xs">
                          <div className="flex justify-between font-bold text-slate-750 dark:text-slate-350">
                            <span>{b.brand}</span>
                            <span className="font-mono">{percentageOfTotal}%</span>
                          </div>
                          <div className="w-full bg-slate-50 dark:bg-slate-850 h-2.5 rounded-full overflow-hidden">
                            <div 
                              className="h-full rounded-full bg-indigo-600" 
                              style={{ width: `${percentageOfTotal}%` }} 
                            />
                          </div>
                          <div className="text-[9px] text-slate-400 flex justify-between font-mono">
                            <span>{b.products.length} Products</span>
                            <span>{money(b.actual)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

              </div>

              {/* Detailed Brand Table */}
              <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 p-5 rounded-2xl shadow-xxs space-y-4">
                <h3 className="text-xs font-bold text-slate-850 dark:text-white uppercase">
                  {isRtl ? "تفصيل الأداء والمستحضرات لكل علامة" : "Brand Breakdown & Portfolio Performance"}
                </h3>
                
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left border-collapse" dir={isRtl ? "rtl" : "ltr"}>
                    <thead>
                      <tr className="bg-slate-50 dark:bg-slate-950 text-slate-450 uppercase font-black text-[10px] border-b border-slate-100 dark:border-slate-800">
                        <th className="p-3">{isRtl ? "العلامة التجارية" : "Brand Name"}</th>
                        <th className="p-3">{isRtl ? "المستحضرات التابعة" : "Underlying Products"}</th>
                        <th className="p-3 text-right">{`${isRtl ? "الهدف المطلوب" : "Assigned Quota"} (${currencyCode})`}</th>
                        <th className="p-3 text-right">{`${isRtl ? "المبيعات الفعلية" : "Actual Accomplished"} (${currencyCode})`}</th>
                        <th className="p-3 text-right">{isRtl ? "الفجوة المتبقية" : "Remaining Gap"}</th>
                        <th className="p-3 text-center">{isRtl ? "نسبة الإنجاز" : "Achievement Ratio"}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                      {brandMetrics.map((b, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/55 dark:hover:bg-slate-950/40">
                          <td className="p-3 font-bold text-slate-850 dark:text-white">{b.brand}</td>
                          <td className="p-3 text-slate-600 dark:text-slate-400 font-medium max-w-xs truncate" title={b.products.join(", ")}>
                            {b.products.join(", ")}
                          </td>
                          <td className="p-3 text-right font-mono text-slate-500">{money(b.target)}</td>
                          <td className="p-3 text-right font-mono font-bold text-slate-850 dark:text-white">{money(b.actual)}</td>
                          <td className="p-3 text-right font-mono text-rose-600">{money(b.gap)}</td>
                          <td className="p-3 text-center">
                            <span className={`px-2 py-0.5 rounded font-mono font-black ${b.achievement >= 90 ? "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30" : "text-amber-600 bg-amber-50 dark:bg-amber-950/30"}`}>
                              {b.achievement}%
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

            </div>
          )}

          {/* 3. PRODUCT ANALYSIS */}
          {activeSideTab === "Product Analysis" && (
            <div className="space-y-6">
              
              {/* Product selector & summary lookup */}
              <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 p-5 rounded-2xl shadow-xxs space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h3 className="text-xs font-bold text-slate-850 dark:text-white uppercase flex items-center gap-1.5">
                      <Package size={14} className="text-indigo-500" />
                      <span>{isRtl ? "تحليل تفصيلي لمستحضر محدد" : "Individual Product Detailing Query"}</span>
                    </h3>
                    <p className="text-[10px] text-slate-400">{isRtl ? "اختر مستحضر دوائي للاستعراض التفصيلي لزياراته وتفاعل الأطباء والمبيعات" : "Lookup comprehensive marketing, performance and detailing statistics for any registered item."}</p>
                  </div>
                  <div>
                    <select
                      value={productLookupId}
                      onChange={(e) => setProductLookupId(e.target.value)}
                      className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-700 dark:text-slate-300 font-bold focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    >
                      {liveProductPerformanceStats.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* KPI Cards for the selected product */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2">
                  <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-100 dark:border-slate-800">
                    <span className="text-[9px] text-slate-400 uppercase font-black">{isRtl ? "المجموعة العلاجية" : "Therapeutic Area"}</span>
                    <div className="text-xs font-bold text-indigo-600 mt-1">{selectedLookupProduct.therapeuticArea}</div>
                  </div>
                  <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-100 dark:border-slate-800">
                    <span className="text-[9px] text-slate-400 uppercase font-black">{isRtl ? "سعر العلبة" : "Unit Trade Price"}</span>
                    <div className="text-xs font-bold text-slate-800 dark:text-white mt-1">{money(selectedLookupProduct.price)}</div>
                  </div>
                  <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-100 dark:border-slate-800">
                    <span className="text-[9px] text-slate-400 uppercase font-black">{isRtl ? "إجمالي الزيارات المروجة" : "Total Active Detailing"}</span>
                    <div className="text-xs font-bold text-slate-800 dark:text-white mt-1">{selectedLookupProduct.visits} visits</div>
                  </div>
                  <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-100 dark:border-slate-800">
                    <span className="text-[9px] text-slate-400 uppercase font-black">{isRtl ? "معدل الإنجاز المالي" : "Financial Quota Progress"}</span>
                    <div className="text-xs font-bold text-emerald-600 mt-1">{selectedLookupProduct.achievement}%</div>
                  </div>
                </div>
              </div>

              {/* Detailing Engagement & Materials for this product */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                
                <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 p-5 rounded-2xl shadow-xxs space-y-4">
                  <h3 className="text-xs font-bold text-slate-850 dark:text-white uppercase flex items-center gap-1.5">
                    <Layers size={14} className="text-indigo-500" />
                    <span>{isRtl ? "تفاعل الأطباء والمواد العلمية" : "Clinical Materials & Detailing Impact"}</span>
                  </h3>
                  
                  <div className="space-y-4 text-xs pt-2">
                    <div className="flex justify-between items-center p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-850">
                      <div>
                        <div className="font-bold text-slate-800 dark:text-white">{isRtl ? "عينات طبية مجانية موزعة" : "Samples Distributed"}</div>
                        <div className="text-[10px] text-slate-400">{isRtl ? "الكمية المغلقة بزيارات هذا المستحضر" : "Aggregated sample drops with physicians"}</div>
                      </div>
                      <div className="font-mono font-black text-indigo-600 text-sm">{selectedLookupProduct.samples} units</div>
                    </div>

                    <div className="flex justify-between items-center p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-850">
                      <div>
                        <div className="font-bold text-slate-800 dark:text-white">{isRtl ? "المساعدات البصرية المعروضة" : "Visual Aids Deployed"}</div>
                        <div className="text-[10px] text-slate-400">{isRtl ? "عدد المطويات والشاشات اللوحية المشاركة" : "Active clinical slide sharing events"}</div>
                      </div>
                      <div className="font-mono font-black text-indigo-600 text-sm">{selectedLookupProduct.visualAids} times</div>
                    </div>

                    <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-850 space-y-2">
                      <div className="flex justify-between font-bold text-slate-800 dark:text-white">
                        <span>{isRtl ? "الاستجابة الإيجابية للأطباء" : "Physician Positive Acceptance Rate"}</span>
                        <span className="text-emerald-600">86%</span>
                      </div>
                      <div className="w-full bg-slate-200 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-500 rounded-full" style={{ width: "86%" }} />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Key Messages Panel */}
                <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 p-5 rounded-2xl shadow-xxs space-y-4">
                  <h3 className="text-xs font-bold text-slate-850 dark:text-white uppercase flex items-center gap-1.5">
                    <MessageSquare size={14} className="text-indigo-500" />
                    <span>{isRtl ? "الرسائل العلمية المعتمدة في الزيارة" : "Approveddetailing Key Messages"}</span>
                  </h3>

                  <div className="space-y-3 pt-2">
                    {topKeyMessages.filter(m => m.product.toLowerCase().includes(selectedLookupProduct.brand.toLowerCase()) || selectedLookupProduct.name.toLowerCase().includes(m.product.toLowerCase())).map((msg, idx) => (
                      <div key={idx} className="p-3 rounded-xl border border-slate-100 dark:border-slate-850 bg-slate-50/50 dark:bg-slate-950 space-y-2">
                        <div className="flex justify-between items-center text-[10px]">
                          <span className="font-bold text-indigo-600 px-2 py-0.5 bg-indigo-50 dark:bg-indigo-950 rounded">{msg.product}</span>
                          <span className="text-amber-500 font-bold">★ {msg.efficacyScore}</span>
                        </div>
                        <p className="text-xs italic text-slate-650 dark:text-slate-350 font-medium leading-relaxed">
                          &ldquo;{msg.message}&rdquo;
                        </p>
                      </div>
                    ))}
                    {topKeyMessages.filter(m => m.product.toLowerCase().includes(selectedLookupProduct.brand.toLowerCase()) || selectedLookupProduct.name.toLowerCase().includes(m.product.toLowerCase())).length === 0 && (
                      <div className="text-center p-8 text-slate-400 text-xs italic">
                        {isRtl ? "لا توجد رسائل مسجلة لهذا المستحضر" : "No active clinical messages registered for this product SKU."}
                      </div>
                    )}
                  </div>
                </div>

              </div>

            </div>
          )}

          {/* 4. SALES TRENDS */}
          {activeSideTab === "Sales Trends" && (
            <div className="space-y-6">
              
              {/* Line chart */}
              <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 p-5 rounded-2xl shadow-xxs space-y-4">
                <div>
                  <h3 className="text-xs font-bold text-slate-850 dark:text-white uppercase flex items-center gap-1.5">
                    <Activity size={14} className="text-indigo-500" />
                    <span>{isRtl ? "الاتجاه الزمني للمبيعات وتحقيق الأهداف" : "Monthly Sales Volume Trend Analysis"}</span>
                  </h3>
                  <p className="text-[10px] text-slate-400">{isRtl ? "مراقبة مستمرة للمبيعات الفعلية مقارنة بالمستهدف الشهري" : "Continuous timeline representation of consolidated monthly sales versus target quota thresholds."}</p>
                </div>

                <div className="h-72 w-full text-xs">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={salesTrendsData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="date" stroke="#94a3b8" fontSize={9} tickLine={false} />
                      <YAxis stroke="#94a3b8" fontSize={9} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={{ fontSize: "11px", borderRadius: "8px" }} />
                      <Legend wrapperStyle={{ fontSize: "10px" }} />
                      <Line type="monotone" dataKey="target" name={isRtl ? "المستهدف المطلوب" : "Assigned Quota"} stroke="#94a3b8" strokeWidth={2} strokeDasharray="5 5" dot={false} />
                      <Line type="monotone" dataKey="actual" name={isRtl ? "الفعلي المحقق" : "Actual Sales"} stroke="#4f46e5" strokeWidth={3} dot={{ r: 4 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Trend Statistics cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 flex items-center gap-4 shadow-xxs">
                  <div className="p-3 bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 rounded-xl">
                    <TrendingUp size={20} />
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 font-bold block uppercase">{isRtl ? "معدل النمو الشهري" : "Consolidated Growth"}</span>
                    <span className="text-lg font-black text-slate-850 dark:text-white font-mono">+18.5% MoM</span>
                  </div>
                </div>

                <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 flex items-center gap-4 shadow-xxs">
                  <div className="p-3 bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 rounded-xl">
                    <Calendar size={20} />
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 font-bold block uppercase">{isRtl ? "ذروة المبيعات" : "Peak Performance Month"}</span>
                    <span className="text-lg font-black text-slate-850 dark:text-white">June 2026</span>
                  </div>
                </div>

                <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 flex items-center gap-4 shadow-xxs">
                  <div className="p-3 bg-amber-50 dark:bg-amber-950 text-amber-600 dark:text-amber-400 rounded-xl">
                    <Zap size={20} />
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 font-bold block uppercase">{isRtl ? "التوقعات الربعية" : "Q3 Forecast Index"}</span>
                    <span className="text-lg font-black text-slate-850 dark:text-white font-mono">{money(summaryMetrics.actual)}</span>
                  </div>
                </div>
              </div>

            </div>
          )}

          {/* 5. TARGET COMPARISON */}
          {activeSideTab === "Target Comparison" && (
            <div className="space-y-6">
              
              {/* Gap Analysis and detailed target comparison table */}
              <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 p-5 rounded-2xl shadow-xxs space-y-4">
                <div className="flex justify-between items-center">
                  <div>
                    <h3 className="text-xs font-bold text-slate-850 dark:text-white uppercase flex items-center gap-1.5">
                      <Target size={14} className="text-indigo-500" />
                      <span>{isRtl ? "مقارنة دقيقة للأهداف وفجوات التحقيق" : "High-Fidelity Target Gap Analysis"}</span>
                    </h3>
                    <p className="text-[10px] text-slate-400">{isRtl ? "مستويات الانحراف الإيجابي والسلبي لكل مستحضر دوائي" : "Identifies negative and positive budget variances across clinical product offerings."}</p>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left border-collapse" dir={isRtl ? "rtl" : "ltr"}>
                    <thead>
                      <tr className="bg-slate-50 dark:bg-slate-950 text-slate-450 uppercase font-black text-[10px] border-b border-slate-100 dark:border-slate-800">
                        <th className="p-3">{isRtl ? "المستحضر" : "Product SKU"}</th>
                        <th className="p-3 text-right">{`${isRtl ? "الهدف المحدد" : "Assigned Quota"} (${currencyCode})`}</th>
                        <th className="p-3 text-right">{`${isRtl ? "الفعلي المحقق" : "Actual Sales"} (${currencyCode})`}</th>
                        <th className="p-3 text-right">{isRtl ? "قيمة الفجوة" : "Gap Amount"}</th>
                        <th className="p-3 text-center">{isRtl ? "نسبة الإنجاز" : "Achievement"}</th>
                        <th className="p-3 text-center">{isRtl ? "مؤشر الانحراف" : "Variance Index"}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                      {liveProductPerformanceStats.map((p, idx) => {
                        const gapVal = p.target - p.actual;
                        const isOverAchieved = gapVal < 0;
                        const achievement = p.achievement;
                        
                        return (
                          <tr key={idx} className="hover:bg-slate-50/55 dark:hover:bg-slate-950/40">
                            <td className="p-3 font-bold text-slate-850 dark:text-white">{p.name}</td>
                            <td className="p-3 text-right font-mono text-slate-500">{money(p.target)}</td>
                            <td className="p-3 text-right font-mono font-bold text-slate-850 dark:text-white">{money(p.actual)}</td>
                            <td className={`p-3 text-right font-mono font-bold ${isOverAchieved ? "text-emerald-600" : "text-rose-600"}`}>
                              {isOverAchieved ? `+${money(Math.abs(gapVal))}` : money(gapVal)}
                            </td>
                            <td className="p-3 text-center">
                              <span className={`px-2 py-0.5 rounded font-mono font-black ${achievement >= 90 ? "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30" : "text-amber-600 bg-amber-50 dark:bg-amber-950/30"}`}>
                                {achievement}%
                              </span>
                            </td>
                            <td className="p-3 text-center">
                              <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                                isOverAchieved 
                                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" 
                                  : achievement >= 80 
                                  ? "bg-blue-100 text-blue-850 dark:bg-blue-950 dark:text-blue-300" 
                                  : "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300"
                              }`}>
                                {isOverAchieved ? (isRtl ? "فائض إيجابي" : "Favorable") : achievement >= 80 ? (isRtl ? "مقبول" : "Acceptable") : (isRtl ? "ضعيف" : "Unfavorable")}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

            </div>
          )}

          {/* 6. RANKINGS */}
          {activeSideTab === "Rankings" && (
            <div className="space-y-6">
              
              {/* Podium View for Top 3 Products */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-end pt-4">
                
                {/* 2nd Place */}
                <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-850 p-5 rounded-2xl shadow-xxs flex flex-col items-center space-y-3 relative order-2 md:order-1 h-[200px] justify-center">
                  <div className="absolute top-3 left-3 text-xs font-bold text-slate-400">#2</div>
                  <div className="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-800 flex items-center justify-center font-bold text-slate-600 dark:text-slate-350">2</div>
                  <span className="font-bold text-slate-800 dark:text-white text-center">
                    {liveProductPerformanceStats.sort((a, b) => b.actual - a.actual)[1]?.name || "N/A"}
                  </span>
                  <span className="text-[10px] font-mono text-slate-400">
                    {money(liveProductPerformanceStats.sort((a, b) => b.actual - a.actual)[1]?.actual || 0)}
                  </span>
                </div>

                {/* 1st Place (Gold/Podium center) */}
                <div className="bg-gradient-to-b from-indigo-50 to-indigo-100/40 dark:from-indigo-950/20 dark:to-indigo-900/10 border-2 border-amber-300 p-6 rounded-2xl shadow-xs flex flex-col items-center space-y-3 relative order-1 md:order-2 h-[230px] justify-center">
                  <div className="absolute top-3 left-3 text-xs font-bold text-amber-500">★ #1</div>
                  <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-950 text-amber-600 dark:text-amber-400 flex items-center justify-center font-black text-lg">1</div>
                  <span className="font-bold text-slate-900 dark:text-white text-sm text-center">
                    {liveProductPerformanceStats.sort((a, b) => b.actual - a.actual)[0]?.name || "N/A"}
                  </span>
                  <span className="text-xs font-mono font-bold text-indigo-600">
                    {money(liveProductPerformanceStats.sort((a, b) => b.actual - a.actual)[0]?.actual || 0)}
                  </span>
                </div>

                {/* 3rd Place */}
                <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-850 p-5 rounded-2xl shadow-xxs flex flex-col items-center space-y-3 relative order-3 h-[180px] justify-center">
                  <div className="absolute top-3 left-3 text-xs font-bold text-amber-700">#3</div>
                  <div className="w-10 h-10 rounded-full bg-orange-100 dark:bg-orange-950/30 text-orange-700 flex items-center justify-center font-bold">3</div>
                  <span className="font-bold text-slate-850 dark:text-white text-center">
                    {liveProductPerformanceStats.sort((a, b) => b.actual - a.actual)[2]?.name || "N/A"}
                  </span>
                  <span className="text-[10px] font-mono text-slate-400">
                    {money(liveProductPerformanceStats.sort((a, b) => b.actual - a.actual)[2]?.actual || 0)}
                  </span>
                </div>

              </div>

              {/* Complete Leaderboard table */}
              <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 p-5 rounded-2xl shadow-xxs space-y-4">
                <h3 className="text-xs font-bold text-slate-850 dark:text-white uppercase">
                  {isRtl ? "لوحة الترتيب التنافسية الكاملة للمستحضرات" : "Complete Sales Leaderboard rankings"}
                </h3>

                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left border-collapse" dir={isRtl ? "rtl" : "ltr"}>
                    <thead>
                      <tr className="bg-slate-50 dark:bg-slate-950 text-slate-450 uppercase font-black text-[10px] border-b border-slate-100 dark:border-slate-800">
                        <th className="p-3 text-center">Rank</th>
                        <th className="p-3">{isRtl ? "المستحضر" : "Product SKU"}</th>
                        <th className="p-3">{isRtl ? "العلامة" : "Brand"}</th>
                        <th className="p-3 text-right">{isRtl ? "المبيعات المحققة" : `Actual Sales (${currencyCode})`}</th>
                        <th className="p-3 text-center">{isRtl ? "معدل الإنجاز" : "Achievement Rate"}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                      {liveProductPerformanceStats.sort((a, b) => b.actual - a.actual).map((p, idx) => (
                        <tr key={p.id} className="hover:bg-slate-50/55 dark:hover:bg-slate-950/40">
                          <td className="p-3 text-center font-mono font-bold text-indigo-600">#{idx + 1}</td>
                          <td className="p-3 font-bold text-slate-850 dark:text-white">{p.name}</td>
                          <td className="p-3 text-slate-550 dark:text-slate-400">{p.brand}</td>
                          <td className="p-3 text-right font-mono font-black text-slate-800 dark:text-white">{money(p.actual)}</td>
                          <td className="p-3 text-center">
                            <span className="font-mono font-black text-xs text-indigo-600">{p.achievement}%</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

            </div>
          )}

          {/* 7. RESOURCE ENGAGEMENT */}
          {activeSideTab === "Resource Engagement" && (
            <div className="space-y-6">
              
              {/* Materials grid / details */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                <div className="lg:col-span-2 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 p-5 rounded-2xl shadow-xxs space-y-4">
                  <div>
                    <h3 className="text-xs font-bold text-slate-850 dark:text-white uppercase flex items-center gap-1.5">
                      <BarChart3 size={14} className="text-indigo-500" />
                      <span>{isRtl ? "تفاعل الأطباء ومستويات مشاركة المواد العلمية" : "Clinical Materials Engagement & Visual Aids"}</span>
                    </h3>
                    <p className="text-[10px] text-slate-400">{isRtl ? "نسب استخدام المواد والمطويات بزيارات الأطباء" : "Analysis of promotional material shares and detailing engagement levels during visits."}</p>
                  </div>

                  <div className="space-y-4 pt-2">
                    {topResources.map((res, index) => (
                      <div key={index} className="space-y-1.5 text-xs">
                        <div className="flex justify-between font-bold text-slate-750 dark:text-slate-350">
                          <span>{res.name}</span>
                          <span className="font-mono text-indigo-600">{res.count} sessions</span>
                        </div>
                        <div className="w-full bg-slate-50 dark:bg-slate-850 h-3 rounded-full overflow-hidden">
                          <div 
                            className="h-full rounded-full" 
                            style={{ width: `${res.percentage}%`, backgroundColor: res.color }} 
                          />
                        </div>
                        <div className="flex justify-between text-[9px] text-slate-400 font-mono">
                          <span>Doctor Acceptance rate: High</span>
                          <span>{res.percentage}% Detailing Coverage</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Key Messages Panel */}
                <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 p-5 rounded-2xl shadow-xxs space-y-4">
                  <div>
                    <h3 className="text-xs font-bold text-slate-850 dark:text-white uppercase flex items-center gap-1.5">
                      <MessageSquare size={14} className="text-indigo-500" />
                      <span>{isRtl ? "مؤشر فعالية الرسائل الطبية المفتاحية" : "Detallng Key Message Engagement Index"}</span>
                    </h3>
                    <p className="text-[10px] text-slate-400">{isRtl ? "الرسائل الترويجية الأكثر تفاعلاً من قبل الأطباء ومستوى استيعابها" : "Primary clinical arguments that drive high medical recall and commercial conversions."}</p>
                  </div>

                  <div className="space-y-3 pt-2">
                    {topKeyMessages.map((msg, index) => (
                      <div 
                        key={index} 
                        className="p-3 bg-slate-50/55 dark:bg-slate-950 border border-slate-100 dark:border-slate-850 rounded-xl text-xs space-y-2 flex flex-col justify-between"
                      >
                        <div className="flex justify-between items-center border-b border-slate-200/40 dark:border-slate-800/40 pb-2">
                          <span className="font-bold text-indigo-600 px-2 py-0.5 bg-indigo-50 dark:bg-indigo-950/40 rounded text-[9px]">
                            {msg.product}
                          </span>
                          <div className="text-[9px] text-amber-500 font-bold">
                            ★ {msg.efficacyScore}
                          </div>
                        </div>
                        <p className="text-slate-600 dark:text-slate-300 italic font-medium leading-relaxed">
                          &ldquo;{msg.message}&rdquo;
                        </p>
                        <div className="text-[8.5px] text-slate-400 flex justify-between pt-1 border-t border-dashed border-slate-200/40 dark:border-slate-800/40">
                          <span>Accept: <strong className="text-emerald-500 font-bold">High</strong></span>
                          <span>Coverage: <strong className="text-indigo-600 font-bold">{msg.coverage}</strong></span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

              </div>

            </div>
          )}

          {/* 8. TERRITORY PHARMACY SALES */}
          {activeSideTab === "Territory Pharmacy Sales" && (
            <div className="space-y-6">
              
              {/* Stacked territory sales chart */}
              <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 p-5 rounded-2xl shadow-xxs space-y-4">
                <div>
                  <h3 className="text-xs font-bold text-slate-850 dark:text-white uppercase flex items-center gap-1.5">
                    <MapPin size={14} className="text-indigo-500" />
                    <span>{isRtl ? "توزيع مبيعات الأدوية جغرافياً عبر الأقاليم" : "Territory Product Sales & Geographic Penetration"}</span>
                  </h3>
                  <p className="text-[10px] text-slate-400">{isRtl ? "تحليل حجم الطلب والمبيعات لكل منتج عبر الأقاليم الجغرافية المعتمدة" : "Geographic mapping of selected product lines across core territory assignments."}</p>
                </div>

                <div className="h-72 w-full text-xs">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={territoryProductSales} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="territory" stroke="#94a3b8" fontSize={9} tickLine={false} />
                      <YAxis stroke="#94a3b8" fontSize={9} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={{ fontSize: "11px", borderRadius: "8px" }} />
                      <Legend wrapperStyle={{ fontSize: "10px" }} />
                      {territoryProducts.map((product, index) => <Bar key={product.id} dataKey={product.id} name={product.name} fill={["#6366f1", "#10b981", "#f59e0b", "#ec4899"][index]} stackId="a" radius={[2, 2, 0, 0]} />)}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Territory Table breakdown */}
              <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 p-5 rounded-2xl shadow-xxs space-y-4">
                <h3 className="text-xs font-bold text-slate-850 dark:text-white uppercase">
                  {isRtl ? "تفصيل المبيعات الجغرافية لكل إقليم" : "Geographic Territory Performance Breakdown"}
                </h3>

                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left border-collapse" dir={isRtl ? "rtl" : "ltr"}>
                    <thead>
                      <tr className="bg-slate-50 dark:bg-slate-950 text-slate-450 uppercase font-black text-[10px] border-b border-slate-100 dark:border-slate-800">
                        <th className="p-3">{isRtl ? "الإقليم الجغرافي" : "Territory Assigned"}</th>
                        {territoryProducts.map(product => <th key={product.id} className="p-3 text-right">{product.name}</th>)}
                        <th className="p-3 text-right">{isRtl ? "إجمالي الإقليم" : "Territory Total"}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                      {territoryProductSales.map((t, idx) => {
                        const total = territoryProducts.reduce((sum, product) => sum + Number(t[product.id] || 0), 0);
                        return (
                          <tr key={idx} className="hover:bg-slate-50/55 dark:hover:bg-slate-950/40">
                            <td className="p-3 font-bold text-slate-850 dark:text-white">{t.territory}</td>
                            {territoryProducts.map(product => <td key={product.id} className="p-3 text-right font-mono text-slate-600 dark:text-slate-400">{money(Number(t[product.id] || 0))}</td>)}
                            <td className="p-3 text-right font-mono font-black text-slate-900 dark:text-white">{money(total)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

            </div>
          )}

        </div>

      </div>

    </div>
  );
}
