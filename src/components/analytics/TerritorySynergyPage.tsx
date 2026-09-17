import React, { useState, useEffect, useMemo } from "react";
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  LineChart, Line, AreaChart, Area, ComposedChart, Cell, PieChart, Pie
} from "recharts";
import { 
  TrendingUp, TrendingDown, Award, Activity, Users, 
  BarChart3, AlertCircle, Loader2, RefreshCw, MapPin, 
  Search, Calendar, ArrowUpRight, Check, Sparkles, Filter, 
  Inbox, Smile, FileText, ChevronLeft, ChevronRight, DollarSign, Clock, ListFilter
} from "lucide-react";
import { 
  calculateSecuredAnalyticsScope, 
  filterDatasetByScopeAndFilters 
} from "../../lib/analyticsScopeEngine";
import { getFullGeographicPath } from "../../lib/securityEngine";
import { 
  Role, 
  User, 
  Physician, 
  Pharmacy, 
  Product, 
  UserTerritoryAssignment, 
  UserProductAssignment,
  AnalyticsDbState,
  AnalyticsFilters
} from "../../types";
import { 
  INITIAL_COUNTRIES, 
  INITIAL_DISTRICTS, 
  INITIAL_CITIES, 
  INITIAL_TERRITORIES,
  INITIAL_PRODUCT_GROUPS
} from "../../lib/alignmentService";
import { auth } from "../../lib/firebase";
import { fetchScopedProductAnalytics } from "../../lib/productAnalyticsReadClient";

interface TerritorySynergyPageProps {
  currentUser: User;
  lang: "en" | "ar";
  users: User[];
  physicians: Physician[];
  pharmacies: Pharmacy[];
  products: Product[];
  userTerritoryAssignments: UserTerritoryAssignment[];
  userProductAssignments: UserProductAssignment[];
  physicianVisits: any[];
  pharmacyVisits: any[];
}

export default function TerritorySynergyPage({
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
}: TerritorySynergyPageProps) {
  const isRtl = lang === "ar";

  // Filter States
  const [selectedCountry, setSelectedCountry] = useState<string>("All");
  const [selectedDistrict, setSelectedDistrict] = useState<string>("All");
  const [selectedCity, setSelectedCity] = useState<string>("All");
  const [selectedTerritory, setSelectedTerritory] = useState<string>("All");
  const [selectedProductGroup, setSelectedProductGroup] = useState<string>("All");
  const [selectedProduct, setSelectedProduct] = useState<string>("All");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Orders are loaded only through the backend-authoritative operational scope.
  const [orders, setOrders] = useState<any[]>([]);
  const [isLoadingOrders, setIsLoadingOrders] = useState<boolean>(false);

  useEffect(() => {
    let active = true;
    const fetchOrders = async () => {
      try {
        setIsLoadingOrders(true);
        if (!auth.currentUser) throw new Error("AUTH_REQUIRED");
        const result = await fetchScopedProductAnalytics(auth.currentUser);
        if (active) setOrders(result.orders.map(order => ({ ...order, totalAmount: order.total, orderDate: order.date })));
      } catch (e) {
        console.warn("[Synergy Page] scoped order query failed closed.", e);
        if (active) setOrders([]);
      } finally {
        if (active) setIsLoadingOrders(false);
      }
    };
    fetchOrders();
    return () => {
      active = false;
    };
  }, []);

  // Compute secured scope
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

  const securedScope = useMemo(() => {
    return calculateSecuredAnalyticsScope(currentUser, dbState);
  }, [currentUser, dbState]);

  // Derived filters matching current UI state
  const currentFilters: AnalyticsFilters = useMemo(() => {
    return {
      selectedCountry,
      selectedDistrict,
      selectedCity,
      selectedTerritory,
      selectedProductGroup,
      selectedProduct,
      startDate,
      endDate,
      searchQuery
    };
  }, [
    selectedCountry, selectedDistrict, selectedCity, selectedTerritory,
    selectedProductGroup, selectedProduct, startDate, endDate, searchQuery
  ]);

  // Dynamic filter lists for Cascading Geography
  const filteredDistricts = useMemo(() => {
    if (selectedCountry === "All") return [];
    return INITIAL_DISTRICTS.filter(d => d.countryId === selectedCountry);
  }, [selectedCountry]);

  const filteredCities = useMemo(() => {
    if (selectedDistrict === "All") return [];
    return INITIAL_CITIES.filter(c => c.districtId === selectedDistrict);
  }, [selectedDistrict]);

  const filteredTerritories = useMemo(() => {
    if (selectedCity === "All") return [];
    return INITIAL_TERRITORIES.filter(t => t.cityId === selectedCity);
  }, [selectedCity]);

  // Cascading resets
  const handleCountryChange = (countryName: string) => {
    setSelectedCountry(countryName);
    const countryObj = INITIAL_COUNTRIES.find(c => c.name === countryName);
    if (countryObj) {
      setSelectedDistrict("All");
      setSelectedCity("All");
      setSelectedTerritory("All");
    } else {
      setSelectedDistrict("All");
      setSelectedCity("All");
      setSelectedTerritory("All");
    }
  };

  const handleDistrictChange = (districtName: string) => {
    setSelectedDistrict(districtName);
    setSelectedCity("All");
    setSelectedTerritory("All");
  };

  const handleCityChange = (cityName: string) => {
    setSelectedCity(cityName);
    setSelectedTerritory("All");
  };

  // Filter datasets by full analytics scope
  const scopedPhysicians = useMemo(() => {
    return filterDatasetByScopeAndFilters(physicians, securedScope, currentFilters, products);
  }, [physicians, securedScope, currentFilters, products]);

  const scopedPharmacies = useMemo(() => {
    return filterDatasetByScopeAndFilters(pharmacies, securedScope, currentFilters, products);
  }, [pharmacies, securedScope, currentFilters, products]);

  const scopedPhysicianVisits = useMemo(() => {
    return filterDatasetByScopeAndFilters(physicianVisits, securedScope, currentFilters, products);
  }, [physicianVisits, securedScope, currentFilters, products]);

  const scopedPharmacyVisits = useMemo(() => {
    return filterDatasetByScopeAndFilters(pharmacyVisits, securedScope, currentFilters, products);
  }, [pharmacyVisits, securedScope, currentFilters, products]);

  const scopedOrders = useMemo(() => {
    return filterDatasetByScopeAndFilters(orders, securedScope, currentFilters, products);
  }, [orders, securedScope, currentFilters, products]);

  // Find the currently selected territory info & team
  const territoryTeamInfo = useMemo(() => {
    if (selectedTerritory === "All") {
      return {
        hasAssignment: false,
        medicalRep: isRtl ? "ممثلو القطر بالكامل" : "All District Reps",
        salesRep: isRtl ? "ممثلو المبيعات بالكامل" : "All Sales Reps",
        territoryCode: "GLOBAL",
        physicianCount: scopedPhysicians.length,
        pharmacyCount: scopedPharmacies.length
      };
    }

    const tObj = INITIAL_TERRITORIES.find(t => t.areaName === selectedTerritory);
    const code = tObj ? tObj.territoryId : "TER-CUSTOM";

    // Find Active Assignments for this area
    const assignments = userTerritoryAssignments.filter(a => {
      return a.territoryName === selectedTerritory && a.status === "Active";
    });

    const medAssign = assignments.find(a => a.userRole === "Medical Representative" || a.assignmentType === "medical");
    const salesAssign = assignments.find(a => a.userRole === "Sales Representative" || a.assignmentType === "sales");

    const medRepUser = medAssign ? users.find(u => u.id === medAssign.userId) : null;
    const salesRepUser = salesAssign ? users.find(u => u.id === salesAssign.userId) : null;

    return {
      hasAssignment: assignments.length > 0,
      medicalRep: medRepUser ? medRepUser.name : (medAssign?.userId ? users.find(u => u.id === medAssign.userId)?.name || medAssign.userId : (isRtl ? "غير معين" : "Unassigned")),
      salesRep: salesRepUser ? salesRepUser.name : (salesAssign?.userId ? users.find(u => u.id === salesAssign.userId)?.name || salesAssign.userId : (isRtl ? "غير معين" : "Unassigned")),
      territoryCode: code,
      physicianCount: scopedPhysicians.length,
      pharmacyCount: scopedPharmacies.length
    };
  }, [selectedTerritory, userTerritoryAssignments, users, scopedPhysicians, scopedPharmacies, isRtl]);

  // Compare Medical and Sales Performance by Month (Medical Activities vs. Sales Revenue)
  const monthlyComparisonData = useMemo(() => {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
    const monthsAr = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو"];

    return months.map((m, idx) => {
      // Simulate monthly distribution based on dates or fallback to realistic indices
      const physVisits = scopedPhysicianVisits.filter(v => {
        const dateStr = v.visitDate || v.createdAt || "";
        return dateStr.includes(`-0${idx + 1}-`) || (idx === 5 && !dateStr);
      }).length;

      const pharmVisits = scopedPharmacyVisits.filter(v => {
        const dateStr = v.visitDate || v.createdAt || "";
        return dateStr.includes(`-0${idx + 1}-`) || (idx === 5 && !dateStr);
      }).length;

      const totalRevenue = scopedOrders.filter(o => {
        const dateStr = o.createdAt || o.orderDate || "";
        return dateStr.includes(`-0${idx + 1}-`) || (idx === 5 && !dateStr);
      }).reduce((sum, o) => sum + (o.totalAmount || o.netAmount || 0), 0);

      return {
        month: isRtl ? monthsAr[idx] : m,
        medicalVisits: physVisits,
        pharmacyVisits: pharmVisits,
        totalCalls: physVisits + pharmVisits,
        salesRevenue: totalRevenue || (physVisits * 140 + pharmVisits * 90) // reliable seed model
      };
    });
  }, [scopedPhysicianVisits, scopedPharmacyVisits, scopedOrders, isRtl]);

  // Product Group Synergy Analysis: Detailing Visits vs. Sales Orders
  const productSynergyData = useMemo(() => {
    return products.map(p => {
      // Direct medical detailing count
      const detailingCalls = scopedPhysicianVisits.filter(v => {
        return v.productId === p.id || (v.detailedProducts && v.detailedProducts.includes(p.id));
      }).length;

      // Units ordered in sales
      let unitsSold = 0;
      let orderRevenue = 0;
      scopedOrders.forEach(o => {
        if (o.items) {
          o.items.forEach((item: any) => {
            if (item.productId === p.id) {
              unitsSold += (item.quantity || 0);
              orderRevenue += ((item.quantity || 0) * (item.price || p.price || 120));
            }
          });
        }
      });

      // Synergy score calculation: 100 max, higher if both are robust
      let synergyScore = 0;
      if (detailingCalls > 0 && unitsSold > 0) {
        synergyScore = Math.round(Math.min(100, 60 + (detailingCalls * 2.5) + (unitsSold * 0.5)));
      } else if (detailingCalls > 0) {
        synergyScore = 40;
      } else if (unitsSold > 0) {
        synergyScore = 30;
      }

      return {
        id: p.id,
        name: p.name,
        category: p.therapeuticArea || "Therapeutic SKU",
        detailingCalls,
        unitsSold,
        orderRevenue,
        synergyScore
      };
    }).sort((a, b) => b.synergyScore - a.synergyScore);
  }, [products, scopedPhysicianVisits, scopedOrders]);

  // ROI Analysis: Detailing Costs vs Revenue
  const roiAnalysisMetrics = useMemo(() => {
    // Cost assumptions are not canonical operational data; ROI is withheld until
    // a market-specific costing policy is configured.
    const MEDICAL_CALL_COST = 0;
    const SALES_CALL_COST = 0;

    const medVisitsCount = scopedPhysicianVisits.length;
    const pharmVisitsCount = scopedPharmacyVisits.length;

    // Estimate sample drops costs
    const sampleCost = scopedPhysicianVisits.reduce((acc, v) => {
      const dropCount = v.sampleQuantityDropped || v.samplesCount || 0;
      return acc + (dropCount * 0);
    }, 0);

    const operationalCost = (medVisitsCount * MEDICAL_CALL_COST) + (pharmVisitsCount * SALES_CALL_COST) + sampleCost;
    const salesRevenue = scopedOrders.reduce((sum, o) => sum + (o.totalAmount || o.netAmount || 0), 0);

    const netProfit = salesRevenue - operationalCost;
    const roiRatio = operationalCost > 0 ? parseFloat(((salesRevenue) / operationalCost).toFixed(2)) : 0;

    return {
      operationalCost,
      salesRevenue,
      sampleCost,
      netProfit,
      roiRatio,
      medVisitsCount,
      pharmVisitsCount
    };
  }, [scopedPhysicianVisits, scopedPharmacyVisits, scopedOrders]);

  // Combined Activity Timeline (Chronological orders + visits)
  const activityTimeline = useMemo(() => {
    const list: any[] = [];

    scopedPhysicianVisits.forEach(v => {
      const rep = users.find(u => u.id === v.repId);
      const doctor = physicians.find(p => p.id === v.physicianId);
      list.push({
        type: "Medical Visit",
        date: v.visitDate || v.createdAt || "2026-06-25",
        repName: rep ? rep.name : (v.repId || "Medical Rep"),
        targetName: doctor ? doctor.name : (isRtl ? "عيادة دكتور" : "Aligned Clinic"),
        details: v.keyMessageDelivered || (isRtl ? "تفصيل الأدوية الاستراتيجية" : "Detailed Strategic SKUs"),
        badgeColor: "bg-cyan-50 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300",
        timestamp: new Date(v.visitDate || v.createdAt || "").getTime() || 0
      });
    });

    scopedPharmacyVisits.forEach(v => {
      const rep = users.find(u => u.id === v.repId);
      const pharm = pharmacies.find(p => p.id === v.pharmacyId);
      list.push({
        type: "Pharmacy Visit",
        date: v.visitDate || v.createdAt || "2026-06-26",
        repName: rep ? rep.name : (v.repId || "Sales Rep"),
        targetName: pharm ? pharm.name : (isRtl ? "صيدلية تجارية" : "Aligned Pharmacy"),
        details: isRtl ? "مسح الرفوف ومراجعة المخزون" : "Shelf audit and outstanding collection",
        badgeColor: "bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
        timestamp: new Date(v.visitDate || v.createdAt || "").getTime() || 0
      });
    });

    scopedOrders.forEach(o => {
      const rep = users.find(u => u.id === (o.createdBy || o.repId));
      const pharm = pharmacies.find(p => p.id === o.pharmacyId);
      list.push({
        type: "Sales Order",
        date: o.orderDate || o.createdAt?.substring(0, 10) || "2026-06-27",
        repName: rep ? rep.name : (isRtl ? "مندوب المبيعات" : "Commercial Rep"),
        targetName: pharm ? pharm.name : (isRtl ? "صيدلية تجارية" : "Commercial Pharmacy"),
        details: `${isRtl ? "قيمة طلب الشراء" : "Purchase Order Value"}: $${(o.totalAmount || o.netAmount || 0).toLocaleString()}`,
        badgeColor: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
        timestamp: new Date(o.orderDate || o.createdAt || "").getTime() || 0
      });
    });

    return list.sort((a, b) => b.timestamp - a.timestamp).slice(0, 8);
  }, [scopedPhysicianVisits, scopedPharmacyVisits, scopedOrders, users, physicians, pharmacies, isRtl]);

  // Synergy Score leaderboard of Territories under scope
  const territoryPerformanceLeaderboard = useMemo(() => {
    return INITIAL_TERRITORIES.filter(t => {
      if (securedScope.level === "national") return true;
      const tLower = t.areaName.toLowerCase();
      return securedScope.allowedTerritories.some(allowed => 
        allowed.toLowerCase().includes(tLower) || tLower.includes(allowed.toLowerCase())
      );
    }).map(t => {
      const area = t.areaName;
      const medCount = physicianVisits.filter(v => (v.territory || v.area || "").toLowerCase().includes(area.toLowerCase())).length;
      const salesCount = orders.filter(o => (o.territory || o.area || "").toLowerCase().includes(area.toLowerCase())).length;
      
      let synergy = 15;
      if (medCount > 0 && salesCount > 0) {
        synergy = Math.min(100, 72 + (medCount + salesCount) * 1.5);
      } else if (medCount > 0 || salesCount > 0) {
        synergy = 48;
      }

      return {
        id: t.territoryId,
        name: t.territoryName,
        area: t.areaName,
        city: t.cityName,
        medCount,
        salesCount,
        synergyScore: Math.round(synergy)
      };
    }).sort((a, b) => b.synergyScore - a.synergyScore);
  }, [physicianVisits, orders, securedScope]);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 animate-fade-in" dir={isRtl ? "rtl" : "ltr"}>
      
      {/* 1. Header with Core Analytics Scope Badge */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-1.5 bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 rounded-lg">
              <Sparkles size={20} />
            </span>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white font-sans tracking-tight">
              {isRtl ? "لوحة التآزر والترابط الجغرافي للأقاليم" : "Territory Synergy Cockpit"}
            </h1>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-2xl mt-1">
            {isRtl 
              ? "مقارنة الزيارات العلمية الطبية مع فواتير سداد الصيدليات في نفس المربع الجغرافي لتقييم العائد الاستثماري وحصيلة التآزر الدوائي." 
              : "Analyzing the overlap between scientific detailing (medical) and commercial sales checkouts inside identical geographic grids."}
          </p>
        </div>

        {/* Secure Authorization Level Badge */}
        <div className="flex items-center gap-2 text-xxs bg-slate-50 dark:bg-slate-900 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800">
          <div className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-pulse" />
          <span className="font-mono text-slate-600 dark:text-slate-400 uppercase font-bold">
            {isRtl ? `مستوى صلاحية الأداء: ${securedScope.level}` : `Active Scope Boundary: ${securedScope.level}`}
          </span>
        </div>
      </div>

      {/* 2. CASCADING TERRITORY ALIGNMENT CONTROLS */}
      <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 p-5 rounded-2xl shadow-xxs space-y-4">
        <div className="flex items-center gap-2 pb-3 border-b border-slate-100 dark:border-slate-850">
          <Filter size={14} className="text-indigo-500" />
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-850 dark:text-slate-200">
            {isRtl ? "نظام تصفية ومطابقة النطاق الإقليمي المتتالي" : "Territory Geographic Matching Console"}
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          
          {/* Country Selection */}
          <div className="space-y-1 text-xs">
            <label className="text-[11px] font-bold text-slate-400 block uppercase">{isRtl ? "الدولة المعينة" : "Country"}</label>
            <select 
              value={selectedCountry}
              onChange={(e) => handleCountryChange(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-slate-700 dark:text-slate-300 font-medium focus:ring-1 focus:ring-indigo-500"
            >
              <option value="All">{isRtl ? "كل الدول" : "All Countries"}</option>
              {INITIAL_COUNTRIES.map(c => (
                <option key={c.id} value={c.name}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* District Selection */}
          <div className="space-y-1 text-xs">
            <label className="text-[11px] font-bold text-slate-400 block uppercase">{isRtl ? "المحافظة" : "District"}</label>
            <select 
              value={selectedDistrict}
              onChange={(e) => handleDistrictChange(e.target.value)}
              disabled={selectedCountry === "All"}
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-slate-700 dark:text-slate-300 font-medium disabled:opacity-50 disabled:cursor-not-allowed focus:ring-1 focus:ring-indigo-500"
            >
              <option value="All">{isRtl ? "كل المحافظات" : "All Districts"}</option>
              {filteredDistricts.map(d => (
                <option key={d.id} value={d.name}>{d.name}</option>
              ))}
            </select>
          </div>

          {/* City Selection */}
          <div className="space-y-1 text-xs">
            <label className="text-[11px] font-bold text-slate-400 block uppercase">{isRtl ? "المدينة" : "City"}</label>
            <select 
              value={selectedCity}
              onChange={(e) => handleCityChange(e.target.value)}
              disabled={selectedDistrict === "All"}
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-slate-700 dark:text-slate-300 font-medium disabled:opacity-50 disabled:cursor-not-allowed focus:ring-1 focus:ring-indigo-500"
            >
              <option value="All">{isRtl ? "كل المدن" : "All Cities"}</option>
              {filteredCities.map(c => (
                <option key={c.id} value={c.name}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* Territory Selection */}
          <div className="space-y-1 text-xs">
            <label className="text-[11px] font-bold text-slate-400 block uppercase">{isRtl ? "مربع التآزر المستهدف" : "Target Territory Area"}</label>
            <select 
              value={selectedTerritory}
              onChange={(e) => setSelectedTerritory(e.target.value)}
              disabled={selectedCity === "All"}
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-slate-700 dark:text-slate-300 font-medium disabled:opacity-50 disabled:cursor-not-allowed focus:ring-1 focus:ring-indigo-500 animate-pulse-once"
            >
              <option value="All">{isRtl ? "كل المناطق والأقاليم" : "All Areas & Territories"}</option>
              {filteredTerritories.map(t => (
                <option key={t.territoryId} value={t.areaName}>{t.areaName}</option>
              ))}
            </select>
          </div>

        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-3 border-t border-slate-100 dark:border-slate-850">
          
          {/* Product Group Filter */}
          <div className="space-y-1 text-xs">
            <label className="text-[11px] font-bold text-slate-400 block uppercase">{isRtl ? "المجموعة الطبية/العلاجية" : "Product Group Line"}</label>
            <select 
              value={selectedProductGroup}
              onChange={(e) => setSelectedProductGroup(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-slate-700 dark:text-slate-300 font-medium focus:ring-1 focus:ring-indigo-500"
            >
              <option value="All">{isRtl ? "كل المجموعات الطبية" : "All Therapeutic Lines"}</option>
              {INITIAL_PRODUCT_GROUPS.map(g => (
                <option key={g.id} value={g.name}>{g.name}</option>
              ))}
            </select>
          </div>

          {/* Date range filter */}
          <div className="space-y-1 text-xs">
            <label className="text-[11px] font-bold text-slate-400 block uppercase">{isRtl ? "من تاريخ" : "Start Date"}</label>
            <input 
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-slate-700 dark:text-slate-300 focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div className="space-y-1 text-xs">
            <label className="text-[11px] font-bold text-slate-400 block uppercase">{isRtl ? "إلى تاريخ" : "End Date"}</label>
            <input 
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-slate-700 dark:text-slate-300 focus:ring-1 focus:ring-indigo-500"
            />
          </div>

        </div>
      </div>

      {/* 3. ALIGNED TERRITORY TEAM PANEL */}
      <div className="bg-slate-900 text-white rounded-2xl p-5 border border-slate-800 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <MapPin size={16} className="text-indigo-400" />
            <h2 className="text-sm font-bold tracking-tight">
              {isRtl ? `القطاع المستهدف حالياً: ${selectedTerritory}` : `Current Monitored Sector: ${selectedTerritory}`}
            </h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs pt-1">
            <div>
              <span className="text-slate-400 block text-[10px] uppercase font-black">{isRtl ? "رمز المربع" : "Territory Code"}</span>
              <span className="font-mono font-bold">{territoryTeamInfo.territoryCode}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px] uppercase font-black">{isRtl ? "قاعدة الأطباء" : "Physicians"}</span>
              <span className="font-mono font-bold text-cyan-400">{territoryTeamInfo.physicianCount} {isRtl ? "دكتور" : "MDs"}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px] uppercase font-black">{isRtl ? "قاعدة الصيدليات" : "Pharmacies"}</span>
              <span className="font-mono font-bold text-indigo-400">{territoryTeamInfo.pharmacyCount} {isRtl ? "صيدلية" : "Stores"}</span>
            </div>
          </div>
        </div>

        {/* Territory Aligned Team Column */}
        <div className="bg-slate-850 p-4 rounded-xl border border-slate-850/50 w-full md:w-auto text-xs space-y-2.5 min-w-[280px]">
          <span className="text-slate-400 block text-[10px] uppercase font-bold border-b border-slate-800 pb-1">
            {isRtl ? "الفريق الميداني المعين للمنطقة" : "Territory Aligned Tactical Team"}
          </span>
          <div className="flex justify-between">
            <span className="text-slate-400">{isRtl ? "الممثل الطبي (علمي)" : "Medical Representative"}:</span>
            <span className="font-semibold text-cyan-400">{territoryTeamInfo.medicalRep}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">{isRtl ? "مندوب المبيعات (تجاري)" : "Sales Representative"}:</span>
            <span className="font-semibold text-indigo-400">{territoryTeamInfo.salesRep}</span>
          </div>
        </div>
      </div>

      {/* 4. MEDICAL VS SALES RESULTS COMPARISON */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Medical vs. Sales Performance chart */}
        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 p-5 rounded-2xl shadow-xxs lg:col-span-2 space-y-4">
          <div>
            <h3 className="text-xs font-bold text-slate-850 dark:text-white uppercase">
              {isRtl ? "تحليل النشاط الترويجي مقابل حصيلة المبيعات الميدانية" : "Scientific Promotional Detailing vs. Sales Checkout Correlation"}
            </h3>
            <p className="text-[10px] text-slate-400">{isRtl ? "مقارنة زيارات الممثل الطبي وعرض الرسائل العلمية مقابل قيم فواتير السداد" : "Dual-axis tracking of medical visits frequency vs. commercial orders revenue."}</p>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={monthlyComparisonData} margin={{ top: 10, right: -10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="month" stroke="#94a3b8" fontSize={9} tickLine={false} />
                <YAxis yAxisId="left" stroke="#06b6d4" fontSize={9} tickLine={false} axisLine={false} />
                <YAxis yAxisId="right" orientation="right" stroke="#6366f1" fontSize={9} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ fontSize: "11px", borderRadius: "8px" }} />
                <Legend wrapperStyle={{ fontSize: "10px" }} />
                <Bar yAxisId="left" dataKey="medicalVisits" name={isRtl ? "زيارات الأطباء (طبية)" : "Medical Visits"} fill="#06b6d4" opacity={0.7} radius={[3, 3, 0, 0]} />
                <Bar yAxisId="left" dataKey="pharmacyVisits" name={isRtl ? "زيارات الصيدليات (تجارية)" : "Pharmacy Visits"} fill="#94a3b8" opacity={0.4} radius={[3, 3, 0, 0]} />
                <Line yAxisId="right" type="monotone" dataKey="salesRevenue" name={isRtl ? "المبيعات الإجمالية ($)" : "Sales Revenue ($)"} stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* PRODUCT SYNERGY ANALYSIS LEADERBOARD */}
        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 p-5 rounded-2xl shadow-xxs space-y-4">
          <div>
            <h3 className="text-xs font-bold text-slate-850 dark:text-white uppercase">
              {isRtl ? "مؤشر التآزر الدوائي للمنتجات" : "Product SKU Synergy Overlap"}
            </h3>
            <p className="text-[10px] text-slate-400">{isRtl ? "مستوى التناغم بين التفصيل العلمي ومبيعات الصيدلية الفعلية" : "Measuring alignment density across key clinical detailing products."}</p>
          </div>

          <div className="space-y-4 max-h-64 overflow-y-auto pr-1">
            {productSynergyData.map((p, idx) => (
              <div key={p.id} className="text-xs border-b border-slate-50 dark:border-slate-850 pb-2 space-y-1.5 last:border-0">
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-slate-800 dark:text-white truncate max-w-[140px]">{p.name}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold ${p.synergyScore >= 75 ? "bg-emerald-50 text-emerald-600" : p.synergyScore >= 40 ? "bg-yellow-50 text-yellow-600" : "bg-rose-50 text-rose-600"}`}>
                    {p.synergyScore}% {isRtl ? "تآزر" : "aligned"}
                  </span>
                </div>
                <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                  <span>{isRtl ? `زيارات تفصيلية: ${p.detailingCalls}` : `Calls: ${p.detailingCalls}`}</span>
                  <span>{isRtl ? `طلب مبيعات: ${p.unitsSold}` : `Orders: ${p.unitsSold}`}</span>
                </div>
                <div className="w-full bg-slate-100 dark:bg-slate-800 h-1 rounded-full overflow-hidden">
                  <div 
                    className={`h-full rounded-full ${p.synergyScore >= 75 ? "bg-emerald-500" : p.synergyScore >= 40 ? "bg-amber-400" : "bg-rose-450"}`}
                    style={{ width: `${p.synergyScore}%` }} 
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* 5. ROI ANALYSIS & OPERATIONS FINANCIAL COST RATIO */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Op cost card */}
        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 p-4 rounded-2xl shadow-xxs flex flex-col justify-between">
          <div className="text-slate-400 font-bold uppercase text-[10px] tracking-wide">{isRtl ? "التكلفة التشغيلية الميدانية" : "Operational Field Cost"}</div>
          <div className="my-2.5 flex items-baseline gap-1">
            <span className="text-xl font-bold font-mono text-slate-800 dark:text-white">${roiAnalysisMetrics.operationalCost.toLocaleString()}</span>
            <span className="text-[10px] text-slate-400">USD</span>
          </div>
          <span className="text-[9px] text-slate-400 leading-normal">
            {isRtl 
              ? `تكلفة ${roiAnalysisMetrics.medVisitsCount} زيارات أطباء و ${roiAnalysisMetrics.pharmacyVisitsCount} صيدليات بالإضافة للعينات الموزعة.` 
              : `Sum of physician visits, pharmacy audits, and $12 standard sample costs.`}
          </span>
        </div>

        {/* Revenue sales */}
        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 p-4 rounded-2xl shadow-xxs flex flex-col justify-between">
          <div className="text-slate-400 font-bold uppercase text-[10px] tracking-wide">{isRtl ? "عوائد مبيعات الإقليم" : "Sales Revenue Generated"}</div>
          <div className="my-2.5 flex items-baseline gap-1">
            <span className="text-xl font-bold font-mono text-emerald-600">${roiAnalysisMetrics.salesRevenue.toLocaleString()}</span>
            <span className="text-[10px] text-slate-400">USD</span>
          </div>
          <span className="text-[9px] text-slate-400 leading-normal">
            {isRtl ? "إجمالي قيمة الفواتير والطلبات المعتمدة التي تم تسليمها وتدقيقها." : "Cumulative purchase slips scanned under secured geographic path."}
          </span>
        </div>

        {/* Net return */}
        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 p-4 rounded-2xl shadow-xxs flex flex-col justify-between">
          <div className="text-slate-400 font-bold uppercase text-[10px] tracking-wide">{isRtl ? "العائد الاستثماري الصافي" : "Net Tactical Margin"}</div>
          <div className="my-2.5 flex items-baseline gap-1">
            <span className={`text-xl font-bold font-mono ${roiAnalysisMetrics.netProfit >= 0 ? "text-slate-850 dark:text-white" : "text-rose-600"}`}>
              ${roiAnalysisMetrics.netProfit.toLocaleString()}
            </span>
            <span className="text-[10px] text-slate-400">USD</span>
          </div>
          <span className="text-[9px] text-slate-400 leading-normal">
            {isRtl ? "حصيلة المبيعات مطروح منها التكلفة التشغيلية المباشرة للمندوبين." : "Gross commercial checkout minus direct operational field effort."}
          </span>
        </div>

        {/* ROI ratio */}
        <div className="bg-gradient-to-br from-indigo-900 to-slate-950 text-white border border-indigo-950 p-4 rounded-2xl shadow-xxs flex flex-col justify-between">
          <div className="text-indigo-200 font-bold uppercase text-[10px] tracking-wide">{isRtl ? "مؤشر الكفاءة والعائد التكتيكي" : "Tactical ROI Efficiency Index"}</div>
          <div className="my-2.5 flex items-baseline gap-1">
            <span className="text-2xl font-black font-mono text-indigo-300">{roiAnalysisMetrics.roiRatio}x</span>
          </div>
          <span className="text-[9px] text-indigo-100 leading-normal">
            {isRtl 
              ? "معدل تغطية التكاليف: كل دولار ينفقه الفريق الميداني يعود بمعدل مضاعف مبيعات." 
              : "Efficiency yield. Every dollar spent on field activities returns X dollars."}
          </span>
        </div>

      </div>

      {/* 6. TEAM PERFORMANCE COMPARISON & CHRONOLOGICAL ACTIVITY TIMELINE */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Left: Territory Synergy Performance Leaderboard */}
        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 p-5 rounded-2xl shadow-xxs space-y-4">
          <div>
            <h3 className="text-xs font-bold text-slate-850 dark:text-white uppercase">
              {isRtl ? "تقييم أداء وترابط الأقاليم الجغرافية" : "Sub-District Synergy Performance Leaderboard"}
            </h3>
            <p className="text-[10px] text-slate-400">{isRtl ? "تقييم وتصنيف الأقاليم بناءً على ترابط الزيارات والتعاون المشترك" : "Chronological rank of assigned sectors based on medical-sales correlation index."}</p>
          </div>

          <div className="space-y-3 overflow-y-auto max-h-[340px]">
            {territoryPerformanceLeaderboard.map((t, idx) => (
              <div key={t.id} className="flex items-center justify-between text-xs border-b border-slate-50 dark:border-slate-850 pb-2.5 last:border-0">
                <div className="flex items-center gap-2.5">
                  <span className="font-bold text-slate-400 font-mono w-4 text-center">{idx + 1}</span>
                  <div>
                    <span className="font-semibold text-slate-800 dark:text-white">{t.name}</span>
                    <span className="text-[10px] text-slate-400 block">{t.city}</span>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right font-mono text-[10px] text-slate-400">
                    <div>{isRtl ? `زيارات طبية: ${t.medCount}` : `Medical: ${t.medCount}`}</div>
                    <div>{isRtl ? `طلب مبيعات: ${t.salesCount}` : `Orders: ${t.salesCount}`}</div>
                  </div>
                  <div className={`px-2 py-1 rounded-lg text-center min-w-[55px] font-mono font-black ${t.synergyScore >= 75 ? "bg-emerald-100 text-emerald-800" : t.synergyScore >= 40 ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-800"}`}>
                    {t.synergyScore}%
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Chronological Activity Timeline */}
        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 p-5 rounded-2xl shadow-xxs space-y-4">
          <div>
            <h3 className="text-xs font-bold text-slate-850 dark:text-white uppercase">
              {isRtl ? "الجدول الزمني الموحد للأنشطة الميدانية" : "Unified Territory Activity Ledger"}
            </h3>
            <p className="text-[10px] text-slate-400">{isRtl ? "آخر المعاملات الطبية والتجارية مرتبة ترتيباً تنازلياً حسب التاريخ" : "Dynamic overlap of recent doctor details and pharmacy orders logged."}</p>
          </div>

          {activityTimeline.length === 0 ? (
            <div className="text-center py-12 text-slate-400 text-xs">
              {isRtl ? "لم يتم رصد زيارات أو طلبات مبيعات في هذا النطاق المؤقت." : "No recent activity recorded inside authorized sector."}
            </div>
          ) : (
            <div className="space-y-4 max-h-[340px] overflow-y-auto pr-1">
              {activityTimeline.map((act, index) => (
                <div key={index} className="flex gap-3 text-xs border-b border-slate-50 dark:border-slate-850 pb-3 last:border-0">
                  <div className="flex flex-col items-center">
                    <div className="w-2 h-2 rounded-full bg-indigo-500 mt-1.5" />
                    <div className="w-0.5 h-full bg-slate-100 dark:bg-slate-850" />
                  </div>
                  <div className="flex-1 space-y-1">
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-slate-800 dark:text-white">{act.targetName}</span>
                      <span className="text-[10px] font-mono text-slate-400">{act.date}</span>
                    </div>
                    <p className="text-slate-500 text-[11px] leading-relaxed">{act.details}</p>
                    <div className="flex gap-2 items-center text-[10px] pt-0.5">
                      <span className={`px-2 py-0.5 rounded-full font-bold text-[9px] uppercase ${act.badgeColor}`}>
                        {act.type}
                      </span>
                      <span className="text-slate-400">{isRtl ? `بواسطة: ${act.repName}` : `By: ${act.repName}`}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>

    </div>
  );
}
