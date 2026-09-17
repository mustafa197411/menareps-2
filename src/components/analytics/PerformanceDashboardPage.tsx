import React, { useState, useEffect, useMemo } from "react";
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  LineChart, Line, AreaChart, Area
} from "recharts";
import { 
  TrendingUp, TrendingDown, Award, Activity, Users, 
  BarChart3, AlertCircle, Loader2, RefreshCw, MapPin, 
  Search, Calendar, ArrowUpRight, Check, Sparkles, Filter, 
  Inbox, Smile, FileText, LayoutDashboard, ChevronLeft, ChevronRight
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
import { auth, app } from "../../lib/firebase";
import { getFunctions, httpsCallable } from "firebase/functions";
import { fetchScopedProductAnalytics } from "../../lib/productAnalyticsReadClient";

interface PerformanceDashboardPageProps {
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

export default function PerformanceDashboardPage({
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
}: PerformanceDashboardPageProps) {
  const isRtl = lang === "ar";

  // Tab State
  // Products, Unvisited, Visited, Rep Performance, Territory Synergy and Team Sales
  const [activeTab, setActiveTab] = useState<"products" | "unvisited" | "visited" | "reps" | "synergy" | "sales">("products");

  // Pagination states
  const [pages, setPages] = useState({
    products: 1,
    unvisited: 1,
    visited: 1,
    reps: 1,
    synergy: 1,
    sales: 1
  });
  const pageSize = 8;

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

  // Live Firebase Orders state
  const [firestoreOrders, setFirestoreOrders] = useState<any[]>([]);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [cloudFunctionStatus, setCloudFunctionStatus] = useState<"idle" | "calling" | "success" | "fallback">("idle");
  const [cloudMessage, setCloudMessage] = useState<string>("");

  // Fetch only backend-authorized orders. Analytics never treats browser storage as authority.
  useEffect(() => {
    let active = true;
    const fetchOrders = async () => {
      try {
        setIsSyncing(true);
        if (!auth.currentUser) throw new Error("AUTHENTICATION_REQUIRED");
        const result = await fetchScopedProductAnalytics(auth.currentUser);
        const list = result.orders;
        if (active) {
          setFirestoreOrders(list);
        }
      } catch (e) {
        console.warn("[Performance Analytics] Authorized order query failed closed.", e);
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
  }, []);

  // Compute secured scope on the client side
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

  // Derived filters matching the current selection
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

  // Territory Alignment lookup for Medical Rep and Sales Rep
  const getRepsForTerritory = useMemo(() => {
    return (territoryName: string, territoryId?: string) => {
      const normName = (territoryName || "").toLowerCase().trim();
      const normId = (territoryId || "").toLowerCase().trim();

      // Find assignments
      const assignments = userTerritoryAssignments.filter(a => {
        const aName = (a.territoryName || "").toLowerCase().trim();
        const aId = (a.territoryId || "").toLowerCase().trim();
        return (
          (normId && (aId === normId || aName.includes(normId))) ||
          (normName && (aName === normName || aName.includes(normName) || normName.includes(aName) || aId === normName))
        );
      });

      // Find Medical Rep
      const medAssignment = assignments.find(a => 
        a.userRole === "Medical Representative" || a.assignmentType === "medical"
      );
      const medRepUser = medAssignment ? users.find(u => u.id === medAssignment.userId) : null;
      const medRepName = medRepUser ? medRepUser.name : (medAssignment?.userId ? users.find(u => u.id === medAssignment.userId)?.name || medAssignment.userId : "Unassigned");

      // Find Sales Rep
      const salesAssignment = assignments.find(a => 
        a.userRole === "Sales Representative" || a.assignmentType === "sales"
      );
      const salesRepUser = salesAssignment ? users.find(u => u.id === salesAssignment.userId) : null;
      const salesRepName = salesRepUser ? salesRepUser.name : (salesAssignment?.userId ? users.find(u => u.id === salesAssignment.userId)?.name || salesAssignment.userId : "Unassigned");

      return { medRepName, salesRepName };
    };
  }, [userTerritoryAssignments, users]);

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

  // Handle cascading resets
  const handleCountryChange = (countryId: string) => {
    setSelectedCountry(countryId);
    setSelectedDistrict("All");
    setSelectedCity("All");
    setSelectedTerritory("All");
  };

  const handleDistrictChange = (districtId: string) => {
    setSelectedDistrict(districtId);
    setSelectedCity("All");
    setSelectedTerritory("All");
  };

  const handleCityChange = (cityId: string) => {
    setSelectedCity(cityId);
    setSelectedTerritory("All");
  };

  // ---------------------------------------------------------------------------
  // DUAL-MODE CLOUD HANDLERS WITH LOCAL RECOVERY OR REAL FUNCTION CALL
  // ---------------------------------------------------------------------------
  const [cloudPerformanceData, setCloudPerformanceData] = useState<any>(null);

  const fetchCloudAnalytics = async () => {
    try {
      setCloudFunctionStatus("calling");
      setCloudMessage("Connecting to secure Firebase cloud function...");
      
      const functionsInstance = getFunctions(app);
      // Let's call the summary or product function depending on tab
      const functionName = activeTab === "products" ? "getProductPerformanceAnalytics" 
                         : activeTab === "unvisited" ? "getUnvisitedCustomersAnalytics"
                         : activeTab === "visited" ? "getVisitedCustomersAnalytics"
                         : activeTab === "reps" ? "getRepPerformanceAnalytics"
                         : activeTab === "synergy" ? "getTerritorySynergyAnalytics"
                         : "getFinanceApprovalAnalytics";

      const callable = httpsCallable(functionsInstance, functionName);
      const res = await callable({ filters: currentFilters });
      
      setCloudPerformanceData(res.data);
      setCloudFunctionStatus("success");
      setCloudMessage(`Live secure function '${functionName}' called successfully!`);
    } catch (err: any) {
      console.warn("[Performance Analytics] Cloud Function call skipped/failed, recovering client-side:", err.message);
      setCloudFunctionStatus("fallback");
      setCloudMessage("Offline. Cascading client-side security boundaries actively applied.");
    }
  };

  useEffect(() => {
    fetchCloudAnalytics();
  }, [activeTab, selectedCountry, selectedDistrict, selectedCity, selectedTerritory, selectedProductGroup, selectedProduct, searchQuery, startDate, endDate]);

  // ---------------------------------------------------------------------------
  // CASCADING CLIENT-SIDE ANALYTICS ENGINE (Mathematical fallback guarantee)
  // ---------------------------------------------------------------------------

  // 1. Scoped physicians & pharmacies datasets
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
    return filterDatasetByScopeAndFilters(firestoreOrders, securedScope, currentFilters, products);
  }, [firestoreOrders, securedScope, currentFilters, products]);

  // 2. Computed KPI Calculations
  const kpis = useMemo(() => {
    // Physician Target Visits
    const totalPhysicians = scopedPhysicians.length;
    const targetVisits = totalPhysicians * 2; // Assuming baseline target frequency is 2 visits/physician

    // Pharmacy Visits
    const pharmacyVisitsCount = scopedPharmacyVisits.length;

    // Visit Frequency Achievement
    const uniqueVisitedPhysicians = new Set(scopedPhysicianVisits.map(v => v.physicianId)).size;
    const visitFrequencyAch = uniqueVisitedPhysicians > 0 
      ? Math.min(100, Math.round((scopedPhysicianVisits.length / (uniqueVisitedPhysicians * 2)) * 100))
      : 0;

    // Sales / Territory Sales
    const totalSales = scopedOrders.reduce((sum, o) => sum + (o.totalAmount || o.netAmount || 0), 0);

    // Working Days
    const workingDays = 22; // Master plan default

    // Average Visits
    const totalVisitsCount = scopedPhysicianVisits.length + scopedPharmacyVisits.length;
    const avgVisitsPerDay = parseFloat((totalVisitsCount / workingDays).toFixed(1));

    // A Segment Visited
    const visitedPhysIds = new Set(scopedPhysicianVisits.filter(v => v.status === "Completed" || !v.status).map(v => v.physicianId));
    const aSegmentCount = scopedPhysicians.filter(p => p.classification === "A" && visitedPhysIds.has(p.id)).length;

    // B Segment Visited
    const bSegmentCount = scopedPhysicians.filter(p => p.classification === "B" && visitedPhysIds.has(p.id)).length;

    // Coverage
    const totalCustomers = scopedPhysicians.length + scopedPharmacies.length;
    const visitedPharmIds = new Set(scopedPharmacyVisits.filter(v => v.status === "Completed" || !v.status).map(v => v.pharmacyId));
    const totalVisitedCustomers = visitedPhysIds.size + visitedPharmIds.size;
    const coveragePercent = totalCustomers > 0 ? Math.round((totalVisitedCustomers / totalCustomers) * 100) : 0;

    return {
      targetVisits,
      pharmacyVisitsCount,
      visitFrequencyAch,
      totalSales,
      workingDays,
      avgVisitsPerDay,
      aSegmentCount,
      bSegmentCount,
      coveragePercent
    };
  }, [scopedPhysicians, scopedPharmacies, scopedPhysicianVisits, scopedPharmacyVisits, scopedOrders]);


  // ---------------------------------------------------------------------------
  // TAB-SPECIFIC DATASETS COMPUTATION
  // ---------------------------------------------------------------------------

  // Tab 1: Products Performance
  const productsPerformanceData = useMemo(() => {
    return products.map(prod => {
      // Detailing Count
      const detailingCount = scopedPhysicianVisits.filter(v => {
        const matchingProduct = v.productId === prod.id || v.detailedProducts?.includes(prod.id);
        return matchingProduct;
      }).length;

      // Units sold and revenue
      let unitsSold = 0;
      scopedOrders.forEach(o => {
        if (o.items) {
          o.items.forEach((item: any) => {
            if (item.productId === prod.id) {
              unitsSold += (item.quantity || 0);
            }
          });
        }
      });

      const revenue = unitsSold * (prod.price || 120); // standard baseline pricing

      return {
        id: prod.id,
        name: prod.name,
        category: prod.therapeuticArea || "Therapeutic SKU",
        sku: prod.sku || prod.id,
        detailingCount,
        unitsSold,
        revenue
      };
    }).sort((a, b) => b.revenue - a.revenue);
  }, [products, scopedPhysicianVisits, scopedOrders]);

  // Tab 2: Unvisited Customers
  const unvisitedCustomers = useMemo(() => {
    // Unvisited means lastVisitDate doesn't exist, is empty, or is cancelled
    const visitedPhysIds = new Set(scopedPhysicianVisits.map(v => v.physicianId));
    const visitedPharmIds = new Set(scopedPharmacyVisits.map(v => v.pharmacyId));

    const list: any[] = [];

    scopedPhysicians.forEach(p => {
      if (!visitedPhysIds.has(p.id)) {
        const reps = getRepsForTerritory(p.territory || "", p.territoryId);
        list.push({
          id: p.id,
          name: p.name,
          type: "Physician",
          specialty: p.specialty || p.classification || "General Medicine",
          territory: p.territory || "Unassigned Area",
          medRep: reps.medRepName,
          salesRep: reps.salesRepName,
          lastStatus: "No Visits Recorded"
        });
      }
    });

    scopedPharmacies.forEach(ph => {
      if (!visitedPharmIds.has(ph.id)) {
        const reps = getRepsForTerritory(ph.territory || "", ph.territoryId);
        list.push({
          id: ph.id,
          name: ph.name,
          type: "Pharmacy",
          specialty: "Commercial Pharmacy",
          territory: ph.territory || "Unassigned Area",
          medRep: reps.medRepName,
          salesRep: reps.salesRepName,
          lastStatus: "No Orders Logged"
        });
      }
    });

    return list;
  }, [scopedPhysicians, scopedPharmacies, scopedPhysicianVisits, scopedPharmacyVisits, getRepsForTerritory]);

  // Tab 3: Visited Customers
  const visitedCustomers = useMemo(() => {
    const list: any[] = [];

    const physVisitsByPhys = new Map<string, any[]>();
    scopedPhysicianVisits.forEach(v => {
      if (!physVisitsByPhys.has(v.physicianId)) physVisitsByPhys.set(v.physicianId, []);
      physVisitsByPhys.get(v.physicianId)!.push(v);
    });

    const pharmVisitsByPharm = new Map<string, any[]>();
    scopedPharmacyVisits.forEach(v => {
      if (!pharmVisitsByPharm.has(v.pharmacyId)) pharmVisitsByPharm.set(v.pharmacyId, []);
      pharmVisitsByPharm.get(v.pharmacyId)!.push(v);
    });

    scopedPhysicians.forEach(p => {
      const visits = physVisitsByPhys.get(p.id) || [];
      if (visits.length > 0) {
        // Find most recent visit
        const sorted = [...visits].sort((a, b) => new Date(b.visitDate || b.createdAt).getTime() - new Date(a.visitDate || a.createdAt).getTime());
        const lastVisit = sorted[0];
        const reps = getRepsForTerritory(p.territory || "", p.territoryId);
        list.push({
          id: p.id,
          name: p.name,
          type: "Physician",
          specialty: p.specialty || p.classification || "General Practice",
          territory: p.territory || "Unassigned Area",
          medRep: reps.medRepName,
          salesRep: reps.salesRepName,
          lastVisitDate: lastVisit.visitDate || lastVisit.createdAt?.substring(0, 10) || "Recent",
          status: lastVisit.status || "Completed"
        });
      }
    });

    scopedPharmacies.forEach(ph => {
      const visits = pharmVisitsByPharm.get(ph.id) || [];
      if (visits.length > 0) {
        const sorted = [...visits].sort((a, b) => new Date(b.visitDate || b.createdAt).getTime() - new Date(a.visitDate || a.createdAt).getTime());
        const lastVisit = sorted[0];
        const reps = getRepsForTerritory(ph.territory || "", ph.territoryId);
        list.push({
          id: ph.id,
          name: ph.name,
          type: "Pharmacy",
          specialty: "Commercial Pharmacy",
          territory: ph.territory || "Unassigned Area",
          medRep: reps.medRepName,
          salesRep: reps.salesRepName,
          lastVisitDate: lastVisit.visitDate || lastVisit.createdAt?.substring(0, 10) || "Recent",
          status: lastVisit.status || "Completed"
        });
      }
    });

    return list.sort((a, b) => new Date(b.lastVisitDate).getTime() - new Date(a.lastVisitDate).getTime());
  }, [scopedPhysicians, scopedPharmacies, scopedPhysicianVisits, scopedPharmacyVisits, getRepsForTerritory]);

  // Tab 4: Representative Performance
  const representativesPerformance = useMemo(() => {
    // Filter users list to standard Representatives who have scoped access
    const repsList = users.filter(u => 
      u.role === "Medical Representative" || u.role === "Sales Representative"
    ).filter(u => 
      securedScope.level === "national" || 
      securedScope.subordinateUserIds.includes(u.id) || 
      u.id === currentUser.id
    );

    return repsList.map(rep => {
      const isMed = rep.role === "Medical Representative";
      const medVisitsCount = physicianVisits.filter(v => v.repId === rep.id).length;
      const pharmVisitsCount = pharmacyVisits.filter(v => v.repId === rep.id).length;
      const totalVisits = medVisitsCount + pharmVisitsCount;

      // Completion rate calculation (based on dynamic vis)
      const targetBase = isMed ? 40 : 30;
      const completionRate = targetBase > 0 ? Math.min(100, Math.round((totalVisits / targetBase) * 100)) : 100;

      // Coaching Score
      const coachingScore = totalVisits > 25 ? 4.8 : totalVisits > 12 ? 4.2 : 3.5;

      return {
        id: rep.id,
        name: rep.name,
        role: rep.role,
        medicalVisits: medVisitsCount,
        pharmacyVisits: pharmVisitsCount,
        totalVisits,
        completionRate,
        coachingScore
      };
    }).sort((a, b) => b.totalVisits - a.totalVisits);
  }, [users, physicianVisits, pharmacyVisits, securedScope, currentUser]);

  // Tab 5: Territory Synergy
  const territorySynergyData = useMemo(() => {
    // Get unique territories
    const territoriesToAnalyze = INITIAL_TERRITORIES.filter(t => {
      if (securedScope.level === "national") return true;
      const tLower = t.areaName.toLowerCase();
      return securedScope.allowedTerritories.some(allowed => 
        allowed.toLowerCase().includes(tLower) || tLower.includes(allowed.toLowerCase())
      );
    });

    return territoriesToAnalyze.map(t => {
      const area = t.areaName;
      // Count medical visits
      const medCount = scopedPhysicianVisits.filter(v => 
        (v.territory || v.area || "").toLowerCase().includes(area.toLowerCase())
      ).length;

      // Count pharmacy visits
      const pharmCount = scopedPharmacyVisits.filter(v => 
        (v.territory || v.area || "").toLowerCase().includes(area.toLowerCase())
      ).length;

      // Synergy score: highly synergistic if both medical and sales check-ins happen in the same geographic grid
      let synergyScore = 0;
      if (medCount > 0 && pharmCount > 0) {
        synergyScore = Math.min(100, 70 + (medCount + pharmCount) * 2);
      } else if (medCount > 0 || pharmCount > 0) {
        synergyScore = 45;
      } else {
        synergyScore = 15;
      }

      return {
        id: t.territoryId,
        name: t.territoryName,
        area: t.areaName,
        city: t.cityName,
        medicalVisits: medCount,
        pharmacyVisits: pharmCount,
        synergyScore
      };
    }).sort((a, b) => b.synergyScore - a.synergyScore);
  }, [scopedPhysicianVisits, scopedPharmacyVisits, securedScope]);

  // Tab 6: Team Sales
  const teamSalesData = useMemo(() => {
    const repsList = users.filter(u => 
      u.role === "Sales Representative" || u.role === "Medical Representative"
    ).filter(u => 
      securedScope.level === "national" || 
      securedScope.subordinateUserIds.includes(u.id) || 
      u.id === currentUser.id
    );

    return repsList.map(rep => {
      const repOrders = scopedOrders.filter(o => o.createdBy === rep.id || o.repId === rep.id);
      const ordersCount = repOrders.length;
      const salesVolume = repOrders.reduce((acc, o) => acc + (o.totalAmount || o.netAmount || 0), 0);
      const averageOrder = ordersCount > 0 ? Math.round(salesVolume / ordersCount) : 0;

      const target = rep.role === "Sales Representative" ? 15000 : 5000;
      const achievement = target > 0 ? Math.round((salesVolume / target) * 100) : 100;

      return {
        id: rep.id,
        name: rep.name,
        role: rep.role,
        ordersCount,
        salesVolume,
        averageOrder,
        achievement
      };
    }).sort((a, b) => b.salesVolume - a.salesVolume);
  }, [users, scopedOrders, securedScope, currentUser]);


  // ---------------------------------------------------------------------------
  // PAGINATION HANDLER
  // ---------------------------------------------------------------------------
  const getPaginatedItems = (list: any[], tabName: keyof typeof pages) => {
    const currentPage = pages[tabName];
    const startIndex = (currentPage - 1) * pageSize;
    return list.slice(startIndex, startIndex + pageSize);
  };

  const totalPages = (list: any[]) => Math.max(1, Math.ceil(list.length / pageSize));

  const handlePageChange = (tabName: keyof typeof pages, direction: "prev" | "next", maxPages: number) => {
    setPages(prev => {
      const current = prev[tabName];
      let updated = current;
      if (direction === "prev" && current > 1) updated -= 1;
      if (direction === "next" && current < maxPages) updated += 1;
      return { ...prev, [tabName]: updated };
    });
  };

  // Reset tab page on switch
  useEffect(() => {
    setPages(prev => ({ ...prev, [activeTab]: 1 }));
  }, [activeTab]);


  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      
      {/* 1. Header & Live Cloud Indicators */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="p-1.5 bg-cyan-100 dark:bg-cyan-950 text-cyan-600 dark:text-cyan-400 rounded-lg">
              <BarChart3 size={20} />
            </span>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white font-sans tracking-tight">
              {isRtl ? "لوحة الأداء والتحليلات المؤمنة" : "Secured Performance Analytics Center"}
            </h1>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-2xl">
            {isRtl 
              ? "مؤشرات تغطية الزيارات وتقييم المبيعات الإقليمية المفصلة الخاضعة لقواعد السرية الجغرافية والهيكلية." 
              : "Enterprise commercial performance insights with automatic geo-boundary constraints, subordinate line filtering, and territory alignment."}
          </p>
        </div>

        {/* Cloud Connection Badge */}
        <div className="flex items-center gap-2 text-xxs bg-slate-100 dark:bg-slate-900 px-3 py-2 rounded-xl border border-slate-250 dark:border-slate-800">
          <div className={`w-2 h-2 rounded-full ${cloudFunctionStatus === "success" ? "bg-emerald-500 animate-pulse" : cloudFunctionStatus === "calling" ? "bg-cyan-500 animate-spin" : "bg-indigo-500"}`} />
          <span className="font-mono text-slate-600 dark:text-slate-400 font-semibold">{cloudMessage || "Connected to Secured CRM Grid"}</span>
        </div>
      </div>

      {/* 2. CASCADING GEOGRAPHIC & PRODUCT FILTERING CONSOLE */}
      <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 p-5 rounded-2xl shadow-xxs space-y-4">
        <div className="flex items-center gap-2 pb-3 border-b border-slate-100 dark:border-slate-850 text-slate-800 dark:text-slate-200">
          <Filter size={14} className="text-cyan-500" />
          <h2 className="text-xs font-bold uppercase tracking-wider">
            {isRtl ? "نظام التصفية الجغرافية المتتالية" : "Cascading Territory Alignment Filter Console"}
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          
          {/* Country Selection */}
          <div className="space-y-1 text-xs">
            <label className="text-[11px] font-bold text-slate-400 block uppercase">{isRtl ? "الدولة" : "Country"}</label>
            <select 
              value={selectedCountry}
              onChange={(e) => handleCountryChange(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-slate-700 dark:text-slate-300 font-medium focus:ring-1 focus:ring-cyan-500"
            >
              <option value="All">{isRtl ? "كل الدول" : "All Countries"}</option>
              {INITIAL_COUNTRIES.map(c => (
                <option key={c.id} value={c.name}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* District Selection */}
          <div className="space-y-1 text-xs">
            <label className="text-[11px] font-bold text-slate-400 block uppercase">{isRtl ? "المحافظة / الإقليم" : "District"}</label>
            <select 
              value={selectedDistrict}
              onChange={(e) => handleDistrictChange(e.target.value)}
              disabled={selectedCountry === "All"}
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-slate-700 dark:text-slate-300 font-medium disabled:opacity-50 disabled:cursor-not-allowed focus:ring-1 focus:ring-cyan-500"
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
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-slate-700 dark:text-slate-300 font-medium disabled:opacity-50 disabled:cursor-not-allowed focus:ring-1 focus:ring-cyan-500"
            >
              <option value="All">{isRtl ? "كل المدن" : "All Cities"}</option>
              {filteredCities.map(c => (
                <option key={c.id} value={c.name}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* Territory Selection */}
          <div className="space-y-1 text-xs">
            <label className="text-[11px] font-bold text-slate-400 block uppercase">{isRtl ? "المنطقة / المربع الميداني" : "Territory"}</label>
            <select 
              value={selectedTerritory}
              onChange={(e) => setSelectedTerritory(e.target.value)}
              disabled={selectedCity === "All"}
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-slate-700 dark:text-slate-300 font-medium disabled:opacity-50 disabled:cursor-not-allowed focus:ring-1 focus:ring-cyan-500"
            >
              <option value="All">{isRtl ? "كل المناطق" : "All Territories"}</option>
              {filteredTerritories.map(t => (
                <option key={t.territoryId} value={t.areaName}>{t.areaName}</option>
              ))}
            </select>
          </div>

        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-3 border-t border-slate-100 dark:border-slate-850">
          
          {/* Product Group */}
          <div className="space-y-1 text-xs">
            <label className="text-[11px] font-bold text-slate-400 block uppercase">{isRtl ? "مجموعة المنتجات" : "Product Group"}</label>
            <select 
              value={selectedProductGroup}
              onChange={(e) => setSelectedProductGroup(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-slate-700 dark:text-slate-300 font-medium focus:ring-1 focus:ring-cyan-500"
            >
              <option value="All">{isRtl ? "كل المجموعات" : "All Groups"}</option>
              {INITIAL_PRODUCT_GROUPS.map(g => (
                <option key={g.id} value={g.name}>{g.name}</option>
              ))}
            </select>
          </div>

          {/* Search Box */}
          <div className="space-y-1 text-xs sm:col-span-2">
            <label className="text-[11px] font-bold text-slate-400 block uppercase">{isRtl ? "البحث بالاسم" : "Search Query"}</label>
            <div className="relative">
              <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
              <input 
                type="text"
                placeholder={isRtl ? "البحث عن الأطباء، الصيدليات، أو الممثلين..." : "Search doctors, pharmacies, reps or SKU..."}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl pl-9 pr-3 py-2 text-slate-700 dark:text-slate-300 text-xs focus:ring-1 focus:ring-cyan-500"
              />
            </div>
          </div>

        </div>
      </div>

      {/* 3. PERFORMANCE SPECIALIZED KPI CARDS GRID (9 REQUESTED KPIS) */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-9 gap-4">
        
        {/* KPI 1: Physician Target Visits */}
        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 p-3 rounded-xl flex flex-col justify-between shadow-xxs min-h-[90px]">
          <span className="text-[9px] font-extrabold text-slate-400 block uppercase leading-tight">{isRtl ? "مستهدف الأطباء" : "Physician Target"}</span>
          <div className="my-1.5 flex items-baseline gap-1">
            <span className="text-base font-bold text-slate-800 dark:text-white font-mono">{kpis.targetVisits}</span>
            <span className="text-[9px] text-slate-400">{isRtl ? "زيارة" : "calls"}</span>
          </div>
          <span className="text-[8.5px] text-cyan-600 dark:text-cyan-400 font-semibold">{isRtl ? "مستند للتمثيل الطبي" : "Medical aligned"}</span>
        </div>

        {/* KPI 2: Pharmacy Visits */}
        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 p-3 rounded-xl flex flex-col justify-between shadow-xxs min-h-[90px]">
          <span className="text-[9px] font-extrabold text-slate-400 block uppercase leading-tight">{isRtl ? "زيارات الصيدليات" : "Pharmacy Visits"}</span>
          <div className="my-1.5 flex items-baseline gap-1">
            <span className="text-base font-bold text-slate-800 dark:text-white font-mono">{kpis.pharmacyVisitsCount}</span>
            <span className="text-[9px] text-emerald-500 font-bold">+{scopedPharmacyVisits.length > 0 ? "Live" : "0"}</span>
          </div>
          <span className="text-[8.5px] text-emerald-600 dark:text-emerald-400 font-semibold">{isRtl ? "زيارات مبيعات فعلية" : "Actual checkout logs"}</span>
        </div>

        {/* KPI 3: Visit Frequency Achievement */}
        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 p-3 rounded-xl flex flex-col justify-between shadow-xxs min-h-[90px]">
          <span className="text-[9px] font-extrabold text-slate-400 block uppercase leading-tight">{isRtl ? "إنجاز وتكرار الزيارات" : "Visit Frequency"}</span>
          <div className="my-1.5 flex items-baseline gap-1">
            <span className="text-base font-bold text-slate-800 dark:text-white font-mono">{kpis.visitFrequencyAch}%</span>
          </div>
          <span className="text-[8.5px] text-indigo-600 dark:text-indigo-400 font-semibold">{isRtl ? "مستهدف مرتان لكل دكتور" : "Target 2.0x / doctor"}</span>
        </div>

        {/* KPI 4: Sales/Territory Sales */}
        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 p-3 rounded-xl flex flex-col justify-between shadow-xxs min-h-[90px] lg:col-span-2">
          <span className="text-[9px] font-extrabold text-slate-400 block uppercase leading-tight">{isRtl ? "مبيعات الإقليم" : "Territory Sales"}</span>
          <div className="my-1.5 flex items-baseline gap-1">
            <span className="text-base font-bold text-slate-800 dark:text-white font-mono">${kpis.totalSales.toLocaleString()}</span>
            <span className="text-[9px] text-slate-400">USD</span>
          </div>
          <span className="text-[8.5px] text-emerald-600 dark:text-emerald-400 font-semibold">{isRtl ? "مجموع عقود الشراء المستلمة" : "Scanned commercial slips"}</span>
        </div>

        {/* KPI 5: Working Days */}
        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 p-3 rounded-xl flex flex-col justify-between shadow-xxs min-h-[90px]">
          <span className="text-[9px] font-extrabold text-slate-400 block uppercase leading-tight">{isRtl ? "أيام العمل" : "Working Days"}</span>
          <div className="my-1.5 flex items-baseline gap-1">
            <span className="text-base font-bold text-slate-800 dark:text-white font-mono">{kpis.workingDays}</span>
            <span className="text-[9px] text-slate-400">{isRtl ? "يوم" : "days"}</span>
          </div>
          <span className="text-[8.5px] text-slate-400 font-semibold">{isRtl ? "خطة العمل الشهرية" : "Standard monthly cycle"}</span>
        </div>

        {/* KPI 6: Average Visits */}
        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 p-3 rounded-xl flex flex-col justify-between shadow-xxs min-h-[90px]">
          <span className="text-[9px] font-extrabold text-slate-400 block uppercase leading-tight">{isRtl ? "متوسط الزيارات اليومي" : "Average Visits"}</span>
          <div className="my-1.5 flex items-baseline gap-1">
            <span className="text-base font-bold text-slate-800 dark:text-white font-mono">{kpis.avgVisitsPerDay}</span>
            <span className="text-[9px] text-slate-400">/ {isRtl ? "يوم" : "day"}</span>
          </div>
          <span className="text-[8.5px] text-cyan-600 dark:text-cyan-400 font-semibold">{isRtl ? "طبي وبيعي مدمج" : "Combined field pace"}</span>
        </div>

        {/* KPI 7: A Segment */}
        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 p-3 rounded-xl flex flex-col justify-between shadow-xxs min-h-[90px]">
          <span className="text-[9px] font-extrabold text-slate-400 block uppercase leading-tight">{isRtl ? "زيارات فئة أ" : "A Segment Visited"}</span>
          <div className="my-1.5 flex items-baseline gap-1">
            <span className="text-base font-bold text-slate-800 dark:text-white font-mono">{kpis.aSegmentCount}</span>
            <span className="text-[9px] text-slate-400">/ {scopedPhysicians.filter(p => p.classification === "A").length}</span>
          </div>
          <span className="text-[8.5px] text-indigo-600 dark:text-indigo-400 font-semibold">{isRtl ? "أطباء ذوي أهمية عليا" : "High-priority KOLs"}</span>
        </div>

        {/* KPI 8: B Segment */}
        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 p-3 rounded-xl flex flex-col justify-between shadow-xxs min-h-[90px]">
          <span className="text-[9px] font-extrabold text-slate-400 block uppercase leading-tight">{isRtl ? "زيارات فئة ب" : "B Segment Visited"}</span>
          <div className="my-1.5 flex items-baseline gap-1">
            <span className="text-base font-bold text-slate-800 dark:text-white font-mono">{kpis.bSegmentCount}</span>
            <span className="text-[9px] text-slate-400">/ {scopedPhysicians.filter(p => p.classification === "B").length}</span>
          </div>
          <span className="text-[8.5px] text-slate-400 font-semibold">{isRtl ? "أطباء الفئة المتوسطة" : "Medium value base"}</span>
        </div>

      </div>

      {/* KPI 9 (Special Badge): General Grid Coverage */}
      <div className="bg-gradient-to-r from-cyan-600 to-indigo-600 p-4 rounded-xl text-white flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
        <div className="flex items-center gap-2">
          <Sparkles size={16} />
          <div className="text-xs">
            <span className="font-bold">{isRtl ? "معدل التغطية الكلي للأطباء والصيدليات المستهدفة" : "Global Target Customer Coverage Metric"}</span>
            <p className="text-[10px] text-cyan-100">{isRtl ? "تم حسابه بناءً على النطاق الجغرافي المعين والفريد لحسابك." : "Dynamically aggregated across all assigned territory boundaries in real-time."}</p>
          </div>
        </div>
        <div className="bg-white/10 px-4 py-1.5 rounded-lg border border-white/20 text-center">
          <span className="text-[9px] text-cyan-200 uppercase font-black block">{isRtl ? "معدل التغطية الكلي" : "Combined Coverage"}</span>
          <span className="text-lg font-black font-mono">{kpis.coveragePercent}%</span>
        </div>
      </div>


      {/* 4. PERFORMANCE REPORTING NAVIGATION TABS (6 TABS) */}
      <div className="flex border-b border-slate-200 dark:border-slate-850 overflow-x-auto gap-2 text-xs font-bold whitespace-nowrap scrollbar-none">
        
        {/* Tab 1: Products */}
        <button 
          onClick={() => setActiveTab("products")}
          className={`pb-3 px-4 border-b-2 transition-all cursor-pointer ${activeTab === "products" ? "border-cyan-500 text-cyan-600 dark:text-cyan-400" : "border-transparent text-slate-500 hover:text-slate-700"}`}
        >
          {isRtl ? "أداء الأدوية والترويج" : "Products"}
        </button>

        {/* Tab 2: Unvisited */}
        <button 
          onClick={() => setActiveTab("unvisited")}
          className={`pb-3 px-4 border-b-2 transition-all cursor-pointer ${activeTab === "unvisited" ? "border-cyan-500 text-cyan-600 dark:text-cyan-400" : "border-transparent text-slate-500 hover:text-slate-700"}`}
        >
          {isRtl ? "عملاء لم يزاروا" : "Unvisited"}
        </button>

        {/* Tab 3: Visited */}
        <button 
          onClick={() => setActiveTab("visited")}
          className={`pb-3 px-4 border-b-2 transition-all cursor-pointer ${activeTab === "visited" ? "border-cyan-500 text-cyan-600 dark:text-cyan-400" : "border-transparent text-slate-500 hover:text-slate-700"}`}
        >
          {isRtl ? "عملاء تم زيارتهم" : "Visited"}
        </button>

        {/* Tab 4: Rep Performance */}
        <button 
          onClick={() => setActiveTab("reps")}
          className={`pb-3 px-4 border-b-2 transition-all cursor-pointer ${activeTab === "reps" ? "border-cyan-500 text-cyan-600 dark:text-cyan-400" : "border-transparent text-slate-500 hover:text-slate-700"}`}
        >
          {isRtl ? "أداء المندوبين" : "Rep Performance"}
        </button>

        {/* Tab 5: Territory Synergy */}
        <button 
          onClick={() => setActiveTab("synergy")}
          className={`pb-3 px-4 border-b-2 transition-all cursor-pointer ${activeTab === "synergy" ? "border-cyan-500 text-cyan-600 dark:text-cyan-400" : "border-transparent text-slate-500 hover:text-slate-700"}`}
        >
          {isRtl ? "تآزر الأقاليم" : "Territory Synergy"}
        </button>

        {/* Tab 6: Team Sales */}
        <button 
          onClick={() => setActiveTab("sales")}
          className={`pb-3 px-4 border-b-2 transition-all cursor-pointer ${activeTab === "sales" ? "border-cyan-500 text-cyan-600 dark:text-cyan-400" : "border-transparent text-slate-500 hover:text-slate-700"}`}
        >
          {isRtl ? "مبيعات الفريق" : "Team Sales"}
        </button>

      </div>

      {/* 5. TAB DETAIL VIEWS WITH INTEGRATED PAGINATION */}
      <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 rounded-2xl p-5 shadow-xxs">
        
        {/* LOADING INDICATOR */}
        {isSyncing && (
          <div className="flex items-center gap-2 justify-center py-6 text-slate-400 text-xs font-semibold">
            <Loader2 className="animate-spin" size={16} />
            <span>{isRtl ? "جاري تجميع السجلات وتنسيق النطاق..." : "Aggregating aligned records..."}</span>
          </div>
        )}

        {/* TAB 1: PRODUCTS SKUS DETAILED PERFORMANCE */}
        {!isSyncing && activeTab === "products" && (() => {
          const items = productsPerformanceData;
          const paginated = getPaginatedItems(items, "products");
          const maxP = totalPages(items);

          return (
            <div className="space-y-4">
              <div className="flex justify-between items-center pb-3 border-b border-slate-100 dark:border-slate-850">
                <div>
                  <h3 className="text-xs font-bold text-slate-800 dark:text-white uppercase">{isRtl ? "أداء المبيعات والتوعية الطبية لكل دواء" : "Product SKU Detailing & Sales Ledger"}</h3>
                  <p className="text-[10px] text-slate-400">{isRtl ? "عدد مرات تفصيل الدواء للأطباء مقابل قيم المبيعات للصيدليات." : "Correlating scientific presentations with downstream purchase form counts."}</p>
                </div>
              </div>

              {items.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-xs">{isRtl ? "لا توجد أدوية ترويجية في هذا النطاق" : "No product skus align with selected filters."}</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 font-bold uppercase text-[10px] bg-slate-50 dark:bg-slate-950">
                        <th className="p-3">{isRtl ? "الدواء" : "Product SKU"}</th>
                        <th className="p-3">{isRtl ? "المجموعة العلاجية" : "Category"}</th>
                        <th className="p-3 text-center">{isRtl ? "مرات التفصيل العلمي" : "Detailing Calls"}</th>
                        <th className="p-3 text-center">{isRtl ? "الوحدات المباعة" : "Units Sold"}</th>
                        <th className="p-3 text-right">{isRtl ? "قيمة المبيعات الكلية" : "Revenue ($)"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginated.map((p, index) => (
                        <tr key={p.id || index} className="border-b border-slate-50 dark:border-slate-850 hover:bg-slate-50/50 dark:hover:bg-slate-850/50">
                          <td className="p-3 font-semibold text-slate-800 dark:text-white">{p.name}</td>
                          <td className="p-3 text-slate-500 font-mono text-[11px]">{p.category}</td>
                          <td className="p-3 text-center font-bold text-cyan-600 font-mono">{p.detailingCount}x</td>
                          <td className="p-3 text-center font-mono">{p.unitsSold}</td>
                          <td className="p-3 text-right font-bold text-emerald-600 font-mono">${p.revenue.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* PAGINATION PANEL */}
              {items.length > pageSize && (
                <div className="flex items-center justify-between pt-4 border-t border-slate-100 dark:border-slate-850 text-xxs font-bold text-slate-500">
                  <span>{isRtl ? `صفحة ${pages.products} من ${maxP}` : `Page ${pages.products} of ${maxP}`}</span>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => handlePageChange("products", "prev", maxP)}
                      disabled={pages.products === 1}
                      className="p-1.5 border border-slate-200 dark:border-slate-850 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <button 
                      onClick={() => handlePageChange("products", "next", maxP)}
                      disabled={pages.products === maxP}
                      className="p-1.5 border border-slate-200 dark:border-slate-850 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* TAB 2: UNVISITED CUSTOMERS (WITH DERIVED SALES & MEDICAL REPS) */}
        {!isSyncing && activeTab === "unvisited" && (() => {
          const items = unvisitedCustomers;
          const paginated = getPaginatedItems(items, "unvisited");
          const maxP = totalPages(items);

          return (
            <div className="space-y-4">
              <div className="flex justify-between items-center pb-3 border-b border-slate-100 dark:border-slate-850">
                <div>
                  <h3 className="text-xs font-bold text-slate-800 dark:text-white uppercase">{isRtl ? "قائمة التغطية الصفرية - عملاء لم يزاروا" : "Zero-Coverage Client Gap Ledger"}</h3>
                  <p className="text-[10px] text-slate-400">{isRtl ? "الأطباء والصيدليات المعينين الذين لم يسجل لهم أي نشاط ميداني ضمن النطاق المعتمد." : "Physicians and commercial pharmacies currently missing representative check-ins."}</p>
                </div>
              </div>

              {items.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-xs">{isRtl ? "رائع! تم تغطية وزيارة جميع العملاء بالكامل" : "Excellent! 100% active coverage achieved in this territory."}</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 font-bold uppercase text-[10px] bg-slate-50 dark:bg-slate-950">
                        <th className="p-3">{isRtl ? "العميل" : "Customer Name"}</th>
                        <th className="p-3">{isRtl ? "النوع" : "Type"}</th>
                        <th className="p-3">{isRtl ? "الفئة / الاختصاص" : "Specialty / Classification"}</th>
                        <th className="p-3">{isRtl ? "الإقليم الميداني" : "Territory Grid"}</th>
                        <th className="p-3 text-cyan-600 dark:text-cyan-400">{isRtl ? "المندوب الطبي المخطط" : "Assigned Med Rep"}</th>
                        <th className="p-3 text-indigo-600 dark:text-indigo-400">{isRtl ? "المندوب التجاري المخطط" : "Assigned Sales Rep"}</th>
                        <th className="p-3 text-center">{isRtl ? "حالة الزيارة" : "Tracking Status"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginated.map((c, index) => (
                        <tr key={c.id || index} className="border-b border-slate-50 dark:border-slate-850 hover:bg-slate-50/50 dark:hover:bg-slate-850/50">
                          <td className="p-3 font-semibold text-slate-800 dark:text-white">{c.name}</td>
                          <td className="p-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${c.type === "Physician" ? "bg-cyan-50 dark:bg-cyan-950 text-cyan-600 dark:text-cyan-400" : "bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400"}`}>
                              {c.type}
                            </span>
                          </td>
                          <td className="p-3 text-slate-500 font-mono text-[11px]">{c.specialty}</td>
                          <td className="p-3 font-medium text-slate-600 dark:text-slate-350">{c.territory}</td>
                          <td className="p-3 font-semibold text-slate-700 dark:text-slate-300 font-mono text-[11px]">{c.medRep}</td>
                          <td className="p-3 font-semibold text-slate-700 dark:text-slate-300 font-mono text-[11px]">{c.salesRep}</td>
                          <td className="p-3 text-center">
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-500">
                              <AlertCircle size={10} />
                              <span>{isRtl ? "لم يزر بعد" : "Pending call"}</span>
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* PAGINATION PANEL */}
              {items.length > pageSize && (
                <div className="flex items-center justify-between pt-4 border-t border-slate-100 dark:border-slate-850 text-xxs font-bold text-slate-500">
                  <span>{isRtl ? `صفحة ${pages.unvisited} من ${maxP}` : `Page ${pages.unvisited} of ${maxP}`}</span>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => handlePageChange("unvisited", "prev", maxP)}
                      disabled={pages.unvisited === 1}
                      className="p-1.5 border border-slate-200 dark:border-slate-850 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <button 
                      onClick={() => handlePageChange("unvisited", "next", maxP)}
                      disabled={pages.unvisited === maxP}
                      className="p-1.5 border border-slate-200 dark:border-slate-850 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* TAB 3: VISITED CUSTOMERS (WITH REPS FROM ALIGNMENT) */}
        {!isSyncing && activeTab === "visited" && (() => {
          const items = visitedCustomers;
          const paginated = getPaginatedItems(items, "visited");
          const maxP = totalPages(items);

          return (
            <div className="space-y-4">
              <div className="flex justify-between items-center pb-3 border-b border-slate-100 dark:border-slate-850">
                <div>
                  <h3 className="text-xs font-bold text-slate-800 dark:text-white uppercase">{isRtl ? "سجل التغطية الفعلي - عملاء تم زيارتهم" : "Active Customer Coverage Registry"}</h3>
                  <p className="text-[10px] text-slate-400">{isRtl ? "الأطباء والصيدليات الذين تم تسجيل زيارات ميدانية منجزة لهم مؤخراً." : "Auditable physician visits and completed pharmacy purchase slips."}</p>
                </div>
              </div>

              {items.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-xs">{isRtl ? "لم تسجل أي زيارات في الإقليم حتى الآن" : "No visits have been completed within this scope yet."}</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 font-bold uppercase text-[10px] bg-slate-50 dark:bg-slate-950">
                        <th className="p-3">{isRtl ? "العميل" : "Customer Name"}</th>
                        <th className="p-3">{isRtl ? "النوع" : "Type"}</th>
                        <th className="p-3">{isRtl ? "الفئة / الاختصاص" : "Specialty"}</th>
                        <th className="p-3">{isRtl ? "الإقليم الجغرافي" : "Territory Grid"}</th>
                        <th className="p-3 text-cyan-600 dark:text-cyan-400">{isRtl ? "المندوب الطبي المنسق" : "Assigned Med Rep"}</th>
                        <th className="p-3 text-indigo-600 dark:text-indigo-400">{isRtl ? "المندوب التجاري المنسق" : "Assigned Sales Rep"}</th>
                        <th className="p-3 text-center">{isRtl ? "تاريخ آخر زيارة" : "Last Visit"}</th>
                        <th className="p-3 text-right">{isRtl ? "الحالة" : "Status"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginated.map((c, index) => (
                        <tr key={c.id || index} className="border-b border-slate-50 dark:border-slate-850 hover:bg-slate-50/50 dark:hover:bg-slate-850/50">
                          <td className="p-3 font-semibold text-slate-800 dark:text-white">{c.name}</td>
                          <td className="p-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${c.type === "Physician" ? "bg-cyan-50 dark:bg-cyan-950 text-cyan-600 dark:text-cyan-400" : "bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400"}`}>
                              {c.type}
                            </span>
                          </td>
                          <td className="p-3 text-slate-500 font-mono text-[11px]">{c.specialty}</td>
                          <td className="p-3 font-medium text-slate-600 dark:text-slate-350">{c.territory}</td>
                          <td className="p-3 font-semibold text-slate-700 dark:text-slate-300 font-mono text-[11px]">{c.medRep}</td>
                          <td className="p-3 font-semibold text-slate-700 dark:text-slate-300 font-mono text-[11px]">{c.salesRep}</td>
                          <td className="p-3 text-center font-mono font-bold text-slate-700 dark:text-slate-250">{c.lastVisitDate}</td>
                          <td className="p-3 text-right">
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-500">
                              <Check size={11} />
                              <span>{c.status}</span>
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* PAGINATION PANEL */}
              {items.length > pageSize && (
                <div className="flex items-center justify-between pt-4 border-t border-slate-100 dark:border-slate-850 text-xxs font-bold text-slate-500">
                  <span>{isRtl ? `صفحة ${pages.visited} من ${maxP}` : `Page ${pages.visited} of ${maxP}`}</span>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => handlePageChange("visited", "prev", maxP)}
                      disabled={pages.visited === 1}
                      className="p-1.5 border border-slate-200 dark:border-slate-850 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <button 
                      onClick={() => handlePageChange("visited", "next", maxP)}
                      disabled={pages.visited === maxP}
                      className="p-1.5 border border-slate-200 dark:border-slate-850 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* TAB 4: REPRESENTATIVES FIELD PERFORMANCE */}
        {!isSyncing && activeTab === "reps" && (() => {
          const items = representativesPerformance;
          const paginated = getPaginatedItems(items, "reps");
          const maxP = totalPages(items);

          return (
            <div className="space-y-4">
              <div className="flex justify-between items-center pb-3 border-b border-slate-100 dark:border-slate-850">
                <div>
                  <h3 className="text-xs font-bold text-slate-800 dark:text-white uppercase">{isRtl ? "مؤشرات كفاءة المندوبين وتغطية الأهداف" : "Field Representatives Performance & Coaching Board"}</h3>
                  <p className="text-[10px] text-slate-400">{isRtl ? "مقارنة زيارات المندوبين مع خطة العمل الميدانية ومستوى التوجيه الطبي." : "Tracking individual check-in volumes against expected regional targets."}</p>
                </div>
              </div>

              {items.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-xs">{isRtl ? "لا يوجد مندوبون في هذا النطاق" : "No field representatives found under your cascading scope."}</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 font-bold uppercase text-[10px] bg-slate-50 dark:bg-slate-950">
                        <th className="p-3">{isRtl ? "المندوب" : "Representative"}</th>
                        <th className="p-3">{isRtl ? "الدور الوظيفي" : "Role"}</th>
                        <th className="p-3 text-center text-cyan-500">{isRtl ? "الزيارات الطبية" : "Medical Visits"}</th>
                        <th className="p-3 text-center text-emerald-500">{isRtl ? "زيارات الصيدليات" : "Pharmacy Visits"}</th>
                        <th className="p-3 text-center font-bold text-slate-900 dark:text-white">{isRtl ? "مجموع الزيارات" : "Total Checkins"}</th>
                        <th className="p-3 text-center">{isRtl ? "معدل الإنجاز" : "Completion Rate"}</th>
                        <th className="p-3 text-right">{isRtl ? "تقييم التوجيه" : "Coaching Score"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginated.map((r, index) => (
                        <tr key={r.id || index} className="border-b border-slate-50 dark:border-slate-850 hover:bg-slate-50/50 dark:hover:bg-slate-850/50">
                          <td className="p-3 font-semibold text-slate-800 dark:text-white">{r.name}</td>
                          <td className="p-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${r.role.includes("Medical") ? "bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400" : "bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400"}`}>
                              {r.role}
                            </span>
                          </td>
                          <td className="p-3 text-center font-mono font-bold text-cyan-600">{r.medicalVisits}</td>
                          <td className="p-3 text-center font-mono font-bold text-emerald-600">{r.pharmacyVisits}</td>
                          <td className="p-3 text-center font-mono font-bold">{r.totalVisits}</td>
                          <td className="p-3 text-center">
                            <div className="flex items-center gap-2 justify-center">
                              <span className="font-mono font-bold text-slate-700 dark:text-slate-200">{r.completionRate}%</span>
                              <div className="w-12 bg-slate-100 dark:bg-slate-800 h-1 rounded-full overflow-hidden hidden sm:block">
                                <div className="bg-cyan-500 h-full" style={{ width: `${r.completionRate}%` }} />
                              </div>
                            </div>
                          </td>
                          <td className="p-3 text-right font-bold text-indigo-600 dark:text-indigo-400 font-mono">{r.coachingScore} / 5.0</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* PAGINATION PANEL */}
              {items.length > pageSize && (
                <div className="flex items-center justify-between pt-4 border-t border-slate-100 dark:border-slate-850 text-xxs font-bold text-slate-500">
                  <span>{isRtl ? `صفحة ${pages.reps} من ${maxP}` : `Page ${pages.reps} of ${maxP}`}</span>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => handlePageChange("reps", "prev", maxP)}
                      disabled={pages.reps === 1}
                      className="p-1.5 border border-slate-200 dark:border-slate-850 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <button 
                      onClick={() => handlePageChange("reps", "next", maxP)}
                      disabled={pages.reps === maxP}
                      className="p-1.5 border border-slate-200 dark:border-slate-850 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* TAB 5: TERRITORY MEDICAL-SALES ALIGNMENT SYNERGY */}
        {!isSyncing && activeTab === "synergy" && (() => {
          const items = territorySynergyData;
          const paginated = getPaginatedItems(items, "synergy");
          const maxP = totalPages(items);

          return (
            <div className="space-y-4">
              <div className="flex justify-between items-center pb-3 border-b border-slate-100 dark:border-slate-850">
                <div>
                  <h3 className="text-xs font-bold text-slate-800 dark:text-white uppercase">{isRtl ? "مؤشرات التآزر الطبي والبيعي للأقاليم" : "Territory Medical-Sales Synergy & Overlap Board"}</h3>
                  <p className="text-[10px] text-slate-400">{isRtl ? "حساب التوافق والتآزر عند تسجيل نشاط طبي ونشاط بيعي متوازن في نفس المربع الجغرافي." : "Measuring synchronization rates between physicians detailing and retail orders."}</p>
                </div>
              </div>

              {items.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-xs">{isRtl ? "لا توجد أقاليم مسجلة في النطاق" : "No territories align with current geographic selections."}</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 font-bold uppercase text-[10px] bg-slate-50 dark:bg-slate-950">
                        <th className="p-3">{isRtl ? "المربع / المنطقة" : "Territory Area"}</th>
                        <th className="p-3">{isRtl ? "المدينة التابعة" : "City Group"}</th>
                        <th className="p-3 text-center text-cyan-600">{isRtl ? "الزيارات الطبية" : "Medical Visits"}</th>
                        <th className="p-3 text-center text-emerald-600">{isRtl ? "زيارات الصيدليات" : "Pharmacy Visits"}</th>
                        <th className="p-3 text-center font-bold text-slate-900 dark:text-white">{isRtl ? "مؤشر التآزر" : "Synergy Overlap Score"}</th>
                        <th className="p-3 text-right">{isRtl ? "حالة المربع الميداني" : "Alignment Status"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginated.map((s, index) => (
                        <tr key={s.id || index} className="border-b border-slate-50 dark:border-slate-850 hover:bg-slate-50/50 dark:hover:bg-slate-850/50">
                          <td className="p-3 font-semibold text-slate-800 dark:text-white">{s.area}</td>
                          <td className="p-3 text-slate-500 font-mono text-[11px]">{s.city}</td>
                          <td className="p-3 text-center font-mono font-bold text-cyan-600">{s.medicalVisits}x</td>
                          <td className="p-3 text-center font-mono font-bold text-emerald-600">{s.pharmacyVisits}x</td>
                          <td className="p-3 text-center">
                            <div className="flex items-center gap-2 justify-center">
                              <span className="font-mono font-bold text-slate-700 dark:text-slate-200">{s.synergyScore}%</span>
                              <div className="w-16 bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                                <div className={`h-full ${s.synergyScore > 75 ? "bg-emerald-500" : s.synergyScore > 40 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${s.synergyScore}%` }} />
                              </div>
                            </div>
                          </td>
                          <td className="p-3 text-right">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${s.synergyScore > 75 ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400" : s.synergyScore > 40 ? "bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400" : "bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400"}`}>
                              {s.synergyScore > 75 ? (isRtl ? "تآزر عالي" : "Highly Aligned") : s.synergyScore > 40 ? (isRtl ? "توافق جزئي" : "Moderate Gap") : (isRtl ? "انعدام التوافق" : "No Synergy")}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* PAGINATION PANEL */}
              {items.length > pageSize && (
                <div className="flex items-center justify-between pt-4 border-t border-slate-100 dark:border-slate-850 text-xxs font-bold text-slate-500">
                  <span>{isRtl ? `صفحة ${pages.synergy} من ${maxP}` : `Page ${pages.synergy} of ${maxP}`}</span>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => handlePageChange("synergy", "prev", maxP)}
                      disabled={pages.synergy === 1}
                      className="p-1.5 border border-slate-200 dark:border-slate-850 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <button 
                      onClick={() => handlePageChange("synergy", "next", maxP)}
                      disabled={pages.synergy === maxP}
                      className="p-1.5 border border-slate-200 dark:border-slate-850 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* TAB 6: TEAM SALES CONVERSIONS */}
        {!isSyncing && activeTab === "sales" && (() => {
          const items = teamSalesData;
          const paginated = getPaginatedItems(items, "sales");
          const maxP = totalPages(items);

          return (
            <div className="space-y-4">
              <div className="flex justify-between items-center pb-3 border-b border-slate-100 dark:border-slate-850">
                <div>
                  <h3 className="text-xs font-bold text-slate-800 dark:text-white uppercase">{isRtl ? "تقارير تحصيل ومبيعات المندوبين" : "Representative Sales & Contract Value Ledger"}</h3>
                  <p className="text-[10px] text-slate-400">{isRtl ? "تحليل فواتير المبيعات الصادرة لكل مندوب تجاري ومعدل إنجاز الحصص الربعية." : "Sum of physical or credit purchase agreements completed by individual reps."}</p>
                </div>
              </div>

              {items.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-xs">{isRtl ? "لم تسجل أي فواتير بيع في هذا النطاق" : "No commercial sales orders have been captured under this scope."}</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 font-bold uppercase text-[10px] bg-slate-50 dark:bg-slate-950">
                        <th className="p-3">{isRtl ? "المندوب" : "Representative"}</th>
                        <th className="p-3">{isRtl ? "الدور الوظيفي" : "Role"}</th>
                        <th className="p-3 text-center">{isRtl ? "عدد الطلبيات" : "Orders count"}</th>
                        <th className="p-3 text-right text-emerald-600">{isRtl ? "حجم المبيعات الكلي" : "Sales Volume ($)"}</th>
                        <th className="p-3 text-right">{isRtl ? "متوسط قيمة الطلب" : "Avg Order Value ($)"}</th>
                        <th className="p-3 text-right">{isRtl ? "إنجاز المستهدف الربع سنوي" : "Target Achievement %"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginated.map((r, index) => (
                        <tr key={r.id || index} className="border-b border-slate-50 dark:border-slate-850 hover:bg-slate-50/50 dark:hover:bg-slate-850/50">
                          <td className="p-3 font-semibold text-slate-800 dark:text-white">{r.name}</td>
                          <td className="p-3 text-slate-500 font-mono text-[11px]">{r.role}</td>
                          <td className="p-3 text-center font-mono font-bold">{r.ordersCount}x</td>
                          <td className="p-3 text-right font-bold text-emerald-600 font-mono">${r.salesVolume.toLocaleString()}</td>
                          <td className="p-3 text-right font-mono">${r.averageOrder.toLocaleString()}</td>
                          <td className="p-3 text-right font-bold font-mono">
                            <span className={r.achievement >= 100 ? "text-emerald-600" : r.achievement >= 60 ? "text-amber-500" : "text-red-500"}>
                              {r.achievement}%
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* PAGINATION PANEL */}
              {items.length > pageSize && (
                <div className="flex items-center justify-between pt-4 border-t border-slate-100 dark:border-slate-850 text-xxs font-bold text-slate-500">
                  <span>{isRtl ? `صفحة ${pages.sales} من ${maxP}` : `Page ${pages.sales} of ${maxP}`}</span>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => handlePageChange("sales", "prev", maxP)}
                      disabled={pages.sales === 1}
                      className="p-1.5 border border-slate-200 dark:border-slate-850 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <button 
                      onClick={() => handlePageChange("sales", "next", maxP)}
                      disabled={pages.sales === maxP}
                      className="p-1.5 border border-slate-200 dark:border-slate-850 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })()}

      </div>

    </div>
  );
}
