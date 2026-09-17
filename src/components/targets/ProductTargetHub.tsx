import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Target,
  MapPin,
  Calendar,
  Calculator,
  BarChart3,
  Download,
  Upload,
  Trash2,
  Plus,
  Edit2,
  Save,
  Send,
  Check,
  CheckCircle2,
  FileText,
  Clock,
  X,
  ChevronDown,
  AlertTriangle,
  RotateCcw,
  Loader2,
  FileSpreadsheet,
  ArrowRight
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  setDoc, 
  doc, 
  deleteDoc, 
  orderBy, 
  limit, 
  onSnapshot,
  writeBatch
} from "firebase/firestore";
import { db, auth } from "../../lib/firebase";
import { 
  getProductTargetPlanDocRef,
  getProductAnnualTargetDocRef,
  getProductAreaPotentialDocRef,
  getProductQuarterlyDistributionDocRef,
  getProductTargetPlanCollection,
  getProductAnnualTargetCollection,
  getProductAreaPotentialCollection,
  getProductQuarterlyDistributionCollection,
  getCalculatedProductTargetCollection,
  getTargetCalculationRunCollection
} from "../../lib/productTargetService";
import { 
  createProductTargetPlanId, 
  createProductAnnualTargetId, 
  createProductAreaPotentialId, 
  createProductQuarterlyDistributionId 
} from "../../lib/productTargetIdService";
import { TargetStatus, Role } from "../../types";
import * as XLSX from "xlsx";
import { formatCurrencyForIdentity, resolveMarketForIdentity } from "../../lib/marketSettings";

interface ProductTargetHubProps {
  lang: "en" | "ar";
  currentUser?: any;
}

export default function ProductTargetHub({ lang, currentUser }: ProductTargetHubProps) {
  const isRtl = lang === "ar";
  const activeMarket = useMemo(() => resolveMarketForIdentity([], currentUser || {}), [currentUser?.marketId, currentUser?.countryId, currentUser?.country]);
  const [activeTab, setActiveTab] = useState<"annual" | "territory" | "quarterly" | "calculate" | "mytargets" | "audit">("annual");
  const [selectedYear, setSelectedYear] = useState("2026");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState("");

  // WP4.1H states
  const [plansList, setPlansList] = useState<any[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string>("");
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [isReasonModalOpen, setIsReasonModalOpen] = useState(false);
  const [reasonModalAction, setReasonModalAction] = useState<"approve" | "reject" | "amend" | "cancel" | null>(null);
  const [reasonText, setReasonText] = useState("");
  const [amendEffectiveFrom, setAmendEffectiveFrom] = useState("");

  // WP4.1G: Actual Performance State
  const [performanceRecords, setPerformanceRecords] = useState<any[]>([]);
  const [performanceSummary, setPerformanceSummary] = useState<any | null>(null);
  const [exceptionsList, setExceptionsList] = useState<any[]>([]);
  const [rebuilding, setRebuilding] = useState(false);
  const [performanceLoading, setPerformanceLoading] = useState(false);

  const [myPerformanceRecords, setMyPerformanceRecords] = useState<any[]>([]);
  const [myPerformanceSummary, setMyPerformanceSummary] = useState<any | null>(null);
  const [myPerformanceLoading, setMyPerformanceLoading] = useState(false);

  // Plan and Live Targets state
  const [plan, setPlan] = useState<any | null>(null);
  const [annualProducts, setAnnualProducts] = useState<any[]>([]);
  const [areaPotentials, setAreaPotentials] = useState<any[]>([]);
  const [quarterlyDistributions, setQuarterlyDistributions] = useState<any[]>([]);
  const [calculatedTargets, setCalculatedTargets] = useState<any[]>([]);
  const [calculationRun, setCalculationRun] = useState<any | null>(null);

  // Master Catalogs state
  const [productsCatalog, setProductsCatalog] = useState<any[]>([]);
  const [areasCatalog, setAreasCatalog] = useState<any[]>([]);

  // Local state for tabs
  const [selectedTerritoryProduct, setSelectedTerritoryProduct] = useState("");
  const [selectedCalcProduct, setSelectedCalcProduct] = useState("");

  // Modals state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingProd, setEditingProd] = useState<any | null>(null);
  const [prodFormId, setProdFormId] = useState("");
  const [prodFormUnits, setProdFormUnits] = useState("");
  const [prodFormPrice, setProdFormPrice] = useState("");

  // Import modal state
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [stagedImport, setStagedImport] = useState<any | null>(null);
  const [importSuccessMessage, setImportSuccessMessage] = useState("");

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  };

  // Check role-based edit privileges
  const isPlanningOfficer = useMemo(() => {
    if (!currentUser) return false;
    const allowedRoles = ["Super Admin", "Admin", "General Manager", "Country Manager", "Sales & Marketing Manager", "Sales Manager"];
    return allowedRoles.includes(currentUser.role);
  }, [currentUser]);

  // Is plan currently read-only?
  const isReadOnly = useMemo(() => {
    if (!isPlanningOfficer) return true;
    if (!plan) return false;
    return [TargetStatus.APPROVED, TargetStatus.ACTIVE, TargetStatus.SUBMITTED].includes(plan.status);
  }, [isPlanningOfficer, plan]);

  // 1. Fetch Master Catalogs once on mount
  useEffect(() => {
    const fetchCatalogs = async () => {
      try {
        const prodSnap = await getDocs(collection(db, "products"));
        const pList: any[] = [];
        prodSnap.forEach(d => {
          const data = d.data();
          if (data.isActive !== false) {
            pList.push({ id: d.id, ...data });
          }
        });
        setProductsCatalog(pList);

        const areaSnap = await getDocs(collection(db, "areas"));
        const aList: any[] = [];
        areaSnap.forEach(d => {
          const data = d.data();
          if (data.active !== false) {
            aList.push({ id: d.id, ...data });
          }
        });
        setAreasCatalog(aList);
      } catch (err: any) {
        console.error("Error loading masters catalogs:", err);
      }
    };
    fetchCatalogs();
  }, []);

  // Set default products once catalog is loaded
  useEffect(() => {
    if (productsCatalog.length > 0) {
      if (!selectedTerritoryProduct) setSelectedTerritoryProduct(productsCatalog[0].id);
      if (!selectedCalcProduct) setSelectedCalcProduct(productsCatalog[0].id);
    }
  }, [productsCatalog]);

  // 2. Main Live Sync of plans list for selectedYear & countryId
  useEffect(() => {
    if (!selectedYear) return;
    const countryId = activeMarket?.countryId;
    if (!countryId) { setError("Canonical market assignment is required."); setLoading(false); return; }
    
    const q = query(
      getProductTargetPlanCollection(),
      where("countryId", "==", countryId),
      where("year", "==", Number(selectedYear))
    );

    const unsubscribe = onSnapshot(q, async (snap) => {
      const list: any[] = [];
      snap.forEach(d => list.push(d.data()));
      // Sort by version descending
      list.sort((a, b) => b.version - a.version);
      setPlansList(list);

      if (list.length === 0) {
        if (isPlanningOfficer) {
          try {
            const defaultPlanId = createProductTargetPlanId(countryId, Number(selectedYear), 1);
            const newPlan = {
              planId: defaultPlanId,
              countryId,
              year: Number(selectedYear),
              currencyCode: activeMarket.currencyCode,
              monthlyDistributionMethod: "EQUAL_WITHIN_QUARTER",
              status: TargetStatus.DRAFT,
              version: 1,
              active: true,
              createdAt: new Date().toISOString(),
              createdBy: currentUser?.email || currentUser?.id || "system",
              updatedAt: new Date().toISOString(),
              updatedBy: currentUser?.email || currentUser?.id || "system"
            };
            await setDoc(doc(db, "productTargetPlans", defaultPlanId), newPlan);
          } catch (err) {
            console.error("Failed to auto-create plan version 1:", err);
          }
        } else {
          setLoading(false);
        }
      } else {
        // Automatically select highest version plan if none selected or if selected is not in the list
        const selectedStillExists = list.some(p => p.planId === selectedPlanId);
        if (!selectedPlanId || !selectedStillExists) {
          setSelectedPlanId(list[0].planId);
        }
      }
    });

    return () => unsubscribe();
  }, [selectedYear, currentUser, isPlanningOfficer, selectedPlanId, activeMarket]);

  // 3. Sync target details for the selected plan ID
  useEffect(() => {
    if (!selectedPlanId) return;
    setLoading(true);

    const planRef = doc(db, "productTargetPlans", selectedPlanId);
    const unsubscribePlan = onSnapshot(planRef, (snap) => {
      if (snap.exists()) {
        setPlan(snap.data());
      }
      setLoading(false);
    }, (err) => {
      console.error("Plan listener error:", err);
      setLoading(false);
    });

    // Subscribe to Annual Targets
    const annualQuery = query(getProductAnnualTargetCollection(), where("planId", "==", selectedPlanId), where("active", "==", true));
    const unsubscribeAnnual = onSnapshot(annualQuery, (snap) => {
      const list: any[] = [];
      snap.forEach(d => list.push(d.data()));
      setAnnualProducts(list);
    });

    // Subscribe to Area Potentials
    const potentialsQuery = query(getProductAreaPotentialCollection(), where("planId", "==", selectedPlanId), where("active", "==", true));
    const unsubscribePotentials = onSnapshot(potentialsQuery, (snap) => {
      const list: any[] = [];
      snap.forEach(d => list.push(d.data()));
      setAreaPotentials(list);
    });

    // Subscribe to Quarterly Distributions
    const quarterlyQuery = query(getProductQuarterlyDistributionCollection(), where("planId", "==", selectedPlanId), where("active", "==", true));
    const unsubscribeQuarterly = onSnapshot(quarterlyQuery, (snap) => {
      const list: any[] = [];
      snap.forEach(d => list.push(d.data()));
      setQuarterlyDistributions(list);
    });

    // Subscribe to Calculated Product Targets
    const calculatedQuery = query(getCalculatedProductTargetCollection(), where("planId", "==", selectedPlanId), where("active", "==", true));
    const unsubscribeCalculated = onSnapshot(calculatedQuery, (snap) => {
      const list: any[] = [];
      snap.forEach(d => list.push(d.data()));
      setCalculatedTargets(list);
    });

    // Subscribe to latest Calculation Run
    const runsQuery = query(getTargetCalculationRunCollection(), where("planId", "==", selectedPlanId), orderBy("requestedAt", "desc"), limit(1));
    const unsubscribeRuns = onSnapshot(runsQuery, (snap) => {
      if (!snap.empty) {
        setCalculationRun(snap.docs[0].data());
      } else {
        setCalculationRun(null);
      }
    });

    // Subscribe to Audit Logs (WP4.1H Visual Audit Trail)
    const auditQuery = query(collection(db, "auditLogs"), where("planId", "==", selectedPlanId));
    const unsubscribeAudit = onSnapshot(auditQuery, (snap) => {
      const list: any[] = [];
      snap.forEach(d => list.push(d.data()));
      // Sort client-side to keep 100% composite index resilience
      list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setAuditLogs(list);
    });

    return () => {
      unsubscribePlan();
      unsubscribeAnnual();
      unsubscribePotentials();
      unsubscribeQuarterly();
      unsubscribeCalculated();
      unsubscribeRuns();
      unsubscribeAudit();
    };
  }, [selectedPlanId]);

  // WP4.1G: Load target performance actuals from REST endpoints
  const fetchPerformanceData = async () => {
    if (!selectedYear) return;
    setPerformanceLoading(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      
      const url = `/api/product-target-performance?year=${selectedYear}${selectedCalcProduct ? `&productId=${selectedCalcProduct}` : ""}`;
      const res = await fetch(url, {
        headers: {
          "Authorization": `Bearer ${token}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        setPerformanceRecords(data.performanceRecords || []);
        setPerformanceSummary(data.summary || null);
      }

      if (isPlanningOfficer) {
        const excRes = await fetch("/api/product-target-performance/exceptions", {
          headers: {
            "Authorization": `Bearer ${token}`
          }
        });
        if (excRes.ok) {
          const excData = await excRes.json();
          setExceptionsList(excData.exceptions || []);
        }
      }
    } catch (err: any) {
      console.error("Error loading performance actuals:", err);
    } finally {
      setPerformanceLoading(false);
    }
  };

  const fetchMyPerformanceData = async () => {
    setMyPerformanceLoading(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch(`/api/product-target-performance/my-targets?year=${selectedYear}`, {
        headers: {
          "Authorization": `Bearer ${token}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        setMyPerformanceRecords(data.performanceRecords || []);
        setMyPerformanceSummary(data.summary || null);
      }
    } catch (err) {
      console.error("Error loading my performance:", err);
    } finally {
      setMyPerformanceLoading(false);
    }
  };

  useEffect(() => {
    fetchPerformanceData();
  }, [selectedYear, selectedCalcProduct, activeTab]);

  useEffect(() => {
    if (activeTab === "mytargets") {
      fetchMyPerformanceData();
    }
  }, [activeTab, selectedYear]);

  const handleRebuildPerformance = async () => {
    setRebuilding(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch("/api/product-target-performance/rebuild", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ year: Number(selectedYear) })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Rebuild failed");
      }
      showToast(isRtl ? "تم إعادة بناء بيانات الأداء وتدقيق الأخطاء بنجاح" : "Performance insights and gaps rebuilt successfully!");
      fetchPerformanceData();
    } catch (err: any) {
      showToast("Rebuild Error: " + err.message);
    } finally {
      setRebuilding(false);
    }
  };


  // --- CRUD Functions for Annual Tab ---
  const handleOpenAddModal = (prod?: any) => {
    if (prod) {
      setEditingProd(prod);
      setProdFormId(prod.productId);
      setProdFormUnits(prod.annualTargetUnits.toString());
      setProdFormPrice(prod.unitPriceSnapshot?.toString() || "");
    } else {
      setEditingProd(null);
      setProdFormId(productsCatalog[0]?.id || "");
      setProdFormUnits("");
      setProdFormPrice("");
    }
    setIsAddModalOpen(true);
  };

  const handleSaveProductTarget = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isReadOnly || !plan) return;

    const units = parseInt(prodFormUnits) || 0;
    const price = parseFloat(prodFormPrice) || 0;
    const selectedProd = productsCatalog.find(p => p.id === prodFormId);

    if (!selectedProd) return;

    const targetId = createProductAnnualTargetId(plan.planId, selectedProd.id);
    const payload = {
      targetId,
      planId: plan.planId,
      countryId: plan.countryId,
      productId: selectedProd.id,
      year: plan.year,
      annualTargetUnits: units,
      currencyCode: plan.currencyCode,
      status: plan.status,
      version: plan.version,
      active: true,
      productNameSnapshot: selectedProd.name,
      productSkuSnapshot: selectedProd.sku || "",
      unitPriceSnapshot: price || selectedProd.price || 0,
      annualTargetValue: units * (price || selectedProd.price || 0),
      createdAt: editingProd?.createdAt || new Date().toISOString(),
      createdBy: editingProd?.createdBy || currentUser?.email || "system",
      updatedAt: new Date().toISOString(),
      updatedBy: currentUser?.email || "system"
    };

    try {
      await setDoc(getProductAnnualTargetDocRef(targetId), payload);
      setIsAddModalOpen(false);
      showToast(isRtl ? "تم حفظ المستهدف بنجاح" : "Target saved successfully");
    } catch (err: any) {
      showToast("Error: " + err.message);
    }
  };

  const handleDeleteProductTarget = async (targetId: string) => {
    if (isReadOnly) return;
    if (window.confirm(isRtl ? "هل أنت متأكد من حذف هذا الهدف؟" : "Are you sure you want to delete this target?")) {
      try {
        await deleteDoc(getProductAnnualTargetDocRef(targetId));
        showToast(isRtl ? "تم الحذف بنجاح" : "Target deleted successfully");
      } catch (err: any) {
        showToast("Error: " + err.message);
      }
    }
  };

  // --- Territory Potentials Mapping and Saving ---
  const currentProductPotentials = useMemo(() => {
    const list: any[] = [];
    areasCatalog.forEach(area => {
      const existing = areaPotentials.find(
        p => p.productId === selectedTerritoryProduct && p.areaId === area.id
      );
      list.push({
        areaId: area.id,
        areaName: area.name,
        district: area.districtName || "",
        city: area.cityName || "",
        potential: existing ? existing.potentialPercentage : 0
      });
    });
    return list;
  }, [areasCatalog, areaPotentials, selectedTerritoryProduct]);

  const potentialsTotalSum = useMemo(() => {
    return currentProductPotentials.reduce((acc, row) => acc + row.potential, 0);
  }, [currentProductPotentials]);

  const handlePotentialChangeLocal = async (areaId: string, val: string) => {
    if (isReadOnly || !plan) return;
    const num = parseFloat(val) || 0;
    const targetId = createProductAnnualTargetId(plan.planId, selectedTerritoryProduct);
    const potentialId = createProductAreaPotentialId(targetId, areaId);
    const areaObj = areasCatalog.find(a => a.id === areaId);

    const payload = {
      areaPotentialId: potentialId,
      planId: plan.planId,
      annualTargetId: targetId,
      countryId: plan.countryId,
      productId: selectedTerritoryProduct,
      year: plan.year,
      areaId,
      potentialPercentage: num,
      status: plan.status,
      version: plan.version,
      active: true,
      areaNameSnapshot: areaObj?.name || "",
      areaCodeSnapshot: areaObj?.code || "",
      createdAt: new Date().toISOString(),
      createdBy: currentUser?.email || "system",
      updatedAt: new Date().toISOString(),
      updatedBy: currentUser?.email || "system"
    };

    await setDoc(getProductAreaPotentialDocRef(potentialId), payload);
  };

  // --- Quarterly % Distribution Saving ---
  const quarterlyListMapped = useMemo(() => {
    return annualProducts.map(prod => {
      const existing = quarterlyDistributions.find(q => q.productId === prod.productId);
      return {
        productId: prod.productId,
        productName: prod.productNameSnapshot,
        annualTargetId: prod.targetId,
        q1: existing ? existing.q1Percentage : 25,
        q2: existing ? existing.q2Percentage : 25,
        q3: existing ? existing.q3Percentage : 25,
        q4: existing ? existing.q4Percentage : 25
      };
    });
  }, [annualProducts, quarterlyDistributions]);

  const handleQuarterlyChangeLocal = async (prodId: string, annualTargetId: string, quarter: "q1" | "q2" | "q3" | "q4", val: string) => {
    if (isReadOnly || !plan) return;
    const num = parseFloat(val) || 0;
    const distId = createProductQuarterlyDistributionId(annualTargetId);
    
    const existing = quarterlyDistributions.find(q => q.productId === prodId) || {
      q1Percentage: 25, q2Percentage: 25, q3Percentage: 25, q4Percentage: 25
    };

    const payload = {
      quarterlyDistributionId: distId,
      planId: plan.planId,
      annualTargetId,
      countryId: plan.countryId,
      productId: prodId,
      year: plan.year,
      q1Percentage: quarter === "q1" ? num : existing.q1Percentage,
      q2Percentage: quarter === "q2" ? num : existing.q2Percentage,
      q3Percentage: quarter === "q3" ? num : existing.q3Percentage,
      q4Percentage: quarter === "q4" ? num : existing.q4Percentage,
      status: plan.status,
      version: plan.version,
      active: true,
      createdAt: new Date().toISOString(),
      createdBy: currentUser?.email || "system",
      updatedAt: new Date().toISOString(),
      updatedBy: currentUser?.email || "system"
    };

    await setDoc(getProductQuarterlyDistributionDocRef(distId), payload);
  };

  // --- Calculated Product Targets Filtering and Triggers ---
  const calculatedRowsFiltered = useMemo(() => {
    return calculatedTargets.filter(r => r.productId === selectedCalcProduct);
  }, [calculatedTargets, selectedCalcProduct]);

  const calcStats = useMemo(() => {
    const total = calculatedTargets.length;
    const draft = calculatedTargets.filter(r => r.status === TargetStatus.DRAFT).length;
    const pending = calculatedTargets.filter(r => r.status === TargetStatus.SUBMITTED).length;
    const approved = calculatedTargets.filter(r => r.status === TargetStatus.APPROVED || r.status === TargetStatus.ACTIVE).length;
    return { total, draft, pending, approved };
  }, [calculatedTargets]);

  const handleTriggerCalculation = async (scope: "all" | "single") => {
    if (!plan || isReadOnly) return;
    setLoading(true);

    try {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch(`/api/target-plans/${plan.planId}/calculate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          productId: scope === "single" ? selectedCalcProduct : undefined
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to trigger calculation run");
      }

      showToast(isRtl ? "تم بدء عملية الاحتساب بنجاح" : "Calculation run started successfully");
    } catch (err: any) {
      showToast("Calculation Error: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  // --- REST Lifecycle Transition Actions (WP4.1H) ---
  const handleLifecycleTransition = async (action: "submit" | "approve" | "reject" | "activate" | "amend" | "close" | "cancel", payload?: any) => {
    if (!plan) return;
    setLoading(true);

    try {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch(`/api/product-target-plans/${plan.planId}/${action}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify(payload || {})
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || `Failed to execute ${action} on this plan.`);
      }

      showToast(isRtl ? `تمت العملية بنجاح` : `Operation ${action} completed successfully`);
      if (data.planId) {
        setSelectedPlanId(data.planId);
      }
    } catch (err: any) {
      showToast("Transition Error: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  // User Role-based Action Privileges
  const userRole = currentUser?.role;

  const canSubmit = useMemo(() => {
    if (!plan || (plan.status !== TargetStatus.DRAFT && plan.status !== TargetStatus.REJECTED)) return false;
    const allowed = [Role.SUPER_ADMIN, Role.ADMIN, Role.SYSTEM_ADMINISTRATOR, Role.SALES_MARKETING_MANAGER, Role.SALES_MANAGER, Role.COUNTRY_MANAGER];
    return allowed.includes(userRole);
  }, [plan, userRole]);

  const canApproveReject = useMemo(() => {
    if (!plan || plan.status !== TargetStatus.SUBMITTED) return false;
    const allowed = [Role.SUPER_ADMIN, Role.ADMIN, Role.SYSTEM_ADMINISTRATOR, Role.GENERAL_MANAGER, Role.SALES_MARKETING_MANAGER, Role.COUNTRY_MANAGER];
    return allowed.includes(userRole);
  }, [plan, userRole]);

  const canActivate = useMemo(() => {
    if (!plan || plan.status !== TargetStatus.APPROVED) return false;
    const allowed = [Role.SUPER_ADMIN, Role.ADMIN, Role.SYSTEM_ADMINISTRATOR, Role.GENERAL_MANAGER, Role.SALES_MARKETING_MANAGER, Role.COUNTRY_MANAGER];
    return allowed.includes(userRole);
  }, [plan, userRole]);

  const canAmend = useMemo(() => {
    if (!plan || plan.status !== TargetStatus.ACTIVE) return false;
    const allowed = [Role.SUPER_ADMIN, Role.ADMIN, Role.SYSTEM_ADMINISTRATOR, Role.SALES_MARKETING_MANAGER, Role.SALES_MANAGER, Role.COUNTRY_MANAGER];
    return allowed.includes(userRole);
  }, [plan, userRole]);

  const canClose = useMemo(() => {
    if (!plan || plan.status !== TargetStatus.ACTIVE) return false;
    const allowed = [Role.SUPER_ADMIN, Role.ADMIN, Role.SYSTEM_ADMINISTRATOR, Role.GENERAL_MANAGER, Role.SALES_MARKETING_MANAGER, Role.COUNTRY_MANAGER];
    return allowed.includes(userRole);
  }, [plan, userRole]);

  const canCancel = useMemo(() => {
    if (!plan || plan.status !== TargetStatus.DRAFT) return false;
    const allowed = [Role.SUPER_ADMIN, Role.ADMIN, Role.SYSTEM_ADMINISTRATOR, Role.SALES_MARKETING_MANAGER, Role.SALES_MANAGER, Role.COUNTRY_MANAGER];
    return allowed.includes(userRole);
  }, [plan, userRole]);

  // --- Representative "My Targets" Filter ---
  const myAssignedTargets = useMemo(() => {
    const userAreaIds = currentUser?.areaIds || [];
    if (!userAreaIds || userAreaIds.length === 0) return [];
    return calculatedTargets.filter(r => userAreaIds.includes(r.areaId));
  }, [calculatedTargets, currentUser]);

  // --- Dynamic XLSX Template Downloads ---
  const handleDownloadTemplate = (type: "annual" | "area" | "quarterly") => {
    let headers: string[] = [];
    let sampleData: any[] = [];
    if (type === "annual") {
      headers = ["Product (ID or SKU)", "Year", "Annual Target Units"];
      sampleData = [
        { "Product (ID or SKU)": productsCatalog[0]?.sku || "TACRUS_01", "Year": 2026, "Annual Target Units": 5000 },
        { "Product (ID or SKU)": productsCatalog[1]?.sku || "PHOTO_PLUS", "Year": 2026, "Annual Target Units": 7500 }
      ];
    } else if (type === "area") {
      headers = ["Product (ID or SKU)", "Area (ID or Code)", "Year", "Potential Percentage"];
      sampleData = [
        { "Product (ID or SKU)": productsCatalog[0]?.sku || "TACRUS_01", "Area (ID or Code)": areasCatalog[0]?.code || "TRIP_CTR", "Year": 2026, "Potential Percentage": 40 },
        { "Product (ID or SKU)": productsCatalog[0]?.sku || "TACRUS_01", "Area (ID or Code)": areasCatalog[1]?.code || "MISR_CTR", "Year": 2026, "Potential Percentage": 60 }
      ];
    } else if (type === "quarterly") {
      headers = ["Product (ID or SKU)", "Year", "Q1 Percentage", "Q2 Percentage", "Q3 Percentage", "Q4 Percentage"];
      sampleData = [
        { "Product (ID or SKU)": productsCatalog[0]?.sku || "TACRUS_01", "Year": 2026, "Q1 Percentage": 25, "Q2 Percentage": 25, "Q3 Percentage": 25, "Q4 Percentage": 25 }
      ];
    }

    const ws = XLSX.utils.json_to_sheet(sampleData, { header: headers });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    XLSX.writeFile(wb, `target_template_${type}.xlsx`);
  };

  // --- Multi-Step Staging Upload Operations ---
  const handleXlsxUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportLoading(true);
    setStagedImport(null);
    setImportSuccessMessage("");

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: "binary" });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const rows = XLSX.utils.sheet_to_json(ws);

        if (rows.length === 0) {
          throw new Error("Spreadsheet is completely empty.");
        }

        // Determine template type from headers
        const firstRow = rows[0] as Record<string, any>;
        const headers = Object.keys(firstRow);
        let templateType: "annualproducttarget" | "productareadistribution" | "productquarterlydistribution" = "annualproducttarget";

        if (headers.some(h => h.toLowerCase().includes("potential"))) {
          templateType = "productareadistribution";
        } else if (headers.some(h => h.toLowerCase().includes("q1"))) {
          templateType = "productquarterlydistribution";
        }

        // Submit to Staging Validation API
        const token = await auth.currentUser?.getIdToken();
        const response = await fetch("/api/target-plans/import/validate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
          },
          body: JSON.stringify({
            templateType,
            rows,
            fileName: file.name,
            countryId: activeMarket?.countryId || "",
            year: Number(selectedYear)
          })
        });

        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.error || "Validation request failed");
        }

        setStagedImport(result);
      } catch (err: any) {
        showToast("Import error: " + err.message);
      } finally {
        setImportLoading(false);
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleCommitImport = async () => {
    if (!stagedImport) return;
    setImportLoading(true);

    try {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch("/api/target-plans/import/commit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ importId: stagedImport.importId })
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "Commit failed");
      }

      setImportSuccessMessage(isRtl ? "تم إدخال البيانات وحفظها بنجاح!" : "Import committed and written successfully!");
      showToast(isRtl ? "تم الاستيراد بنجاح" : "Import successful");
    } catch (err: any) {
      showToast("Commit Error: " + err.message);
    } finally {
      setImportLoading(false);
    }
  };

  const handleRollbackImport = async () => {
    if (!stagedImport) return;
    setImportLoading(true);

    try {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch("/api/target-plans/import/rollback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ importId: stagedImport.importId })
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "Rollback failed");
      }

      setStagedImport(null);
      setImportSuccessMessage("");
      showToast(isRtl ? "تم التراجع عن الاستيراد بنجاح" : "Import rolled back successfully!");
    } catch (err: any) {
      showToast("Rollback Error: " + err.message);
    } finally {
      setImportLoading(false);
    }
  };

  const formatCurrency = (val: number) => {
    return formatCurrencyForIdentity(val, currentUser || {});
  };

  // Empty/Loading/Error boundaries
  const isActiveUser = useMemo(() => {
    if (!currentUser) return false;
    return currentUser.active === true || currentUser.status === "Active" || currentUser.status === "Operational";
  }, [currentUser]);

  if (!currentUser) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-slate-500 font-sans p-8">
        <AlertTriangle className="w-12 h-12 text-amber-500 mb-3" />
        <h3 className="text-sm font-bold text-slate-900 dark:text-white">{isRtl ? "لم يتم العثور على ملف تعريف المستخدم" : "User Profile Not Found"}</h3>
        <p className="text-xs text-slate-500 mt-1">{isRtl ? "يرجى تسجيل الدخول للوصول إلى مركز الأهداف." : "Please sign in to access the target settings hub."}</p>
      </div>
    );
  }

  if (!isActiveUser) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-slate-500 font-sans p-8">
        <AlertTriangle className="w-12 h-12 text-red-500 mb-3" />
        <h3 className="text-sm font-bold text-slate-900 dark:text-white">{isRtl ? "تم إلغاء تنشيط حسابك" : "Access Denied: Inactive Account"}</h3>
        <p className="text-xs text-slate-500 mt-1">{isRtl ? "ملف تعريف المستخدم هذا غير نشط حاليًا في النظام. يرجى مراجعة المسؤول." : "Your user profile is currently inactive in MENAREPS 2.0. Target setting access is strictly restricted."}</p>
      </div>
    );
  }

  if (loading && annualProducts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-slate-500">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600 mb-2" />
        <p className="text-xs font-bold">{isRtl ? "جاري تحميل خطة الأهداف السنوية..." : "Loading target planning engine..."}</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-7xl mx-auto p-4 md:p-8 text-slate-800 dark:text-slate-100 font-sans" dir={isRtl ? "rtl" : "ltr"}>
      {/* Toast Notification Banner */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-5 right-5 z-50 bg-blue-600 text-white px-4 py-3 rounded-xl shadow-xl flex items-center gap-2 text-xs font-bold"
          >
            <Check size={16} />
            <span>{toast}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Page Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-slate-950 dark:text-white">
              {isRtl ? "مركز إعداد أهداف المبيعات للera" : "Product Target Setting Hub"}
            </h1>
            {plan && (
              <span className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                plan.status === TargetStatus.DRAFT ? "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" :
                plan.status === TargetStatus.SUBMITTED ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" :
                plan.status === TargetStatus.APPROVED ? "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300" :
                plan.status === TargetStatus.ACTIVE ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" :
                "bg-red-105 text-red-700 dark:bg-red-950 dark:text-red-300"
              }`}>
                {plan.status} (V{plan.version})
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-medium">
            {isRtl ? "إعداد الأهداف السنوية، التوزيع الجغرافي، الاحتساب، والموافقة" : "Configure annual targets, territory distribution, and deterministic calculations"}
          </p>
        </div>

        {/* Global Planning Context controls */}
        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <div className="relative">
            <select
              value={selectedYear}
              onChange={e => setSelectedYear(e.target.value)}
              className="appearance-none bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 pr-9 text-xs font-bold text-slate-700 dark:text-slate-200 focus:outline-none shadow-xxs cursor-pointer min-w-[90px]"
            >
              <option value="2026">2026</option>
              <option value="2025">2025</option>
              <option value="2027">2027</option>
            </select>
            <ChevronDown size={14} className="absolute right-3 top-3 text-slate-400 pointer-events-none" />
          </div>

          {plansList.length > 1 && (
            <div className="relative">
              <select
                value={selectedPlanId}
                onChange={e => setSelectedPlanId(e.target.value)}
                className="appearance-none bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 pr-9 text-xs font-bold text-slate-700 dark:text-slate-200 focus:outline-none shadow-xxs cursor-pointer min-w-[120px]"
              >
                {plansList.map(p => (
                  <option key={p.planId} value={p.planId}>
                    Version {p.version} ({p.status})
                  </option>
                ))}
              </select>
              <ChevronDown size={14} className="absolute right-3 top-3 text-slate-400 pointer-events-none" />
            </div>
          )}

          {isPlanningOfficer && (
            <>
              {plan && [TargetStatus.DRAFT, TargetStatus.REJECTED].includes(plan.status) && (
                <button
                  onClick={() => setIsImportModalOpen(true)}
                  className="bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 shadow-xxs transition-colors cursor-pointer"
                >
                  <Upload size={14} />
                  <span>{isRtl ? "استيراد البيانات" : "Import Spreadsheets"}</span>
                </button>
              )}

              {canSubmit && (
                <button
                  onClick={() => handleLifecycleTransition("submit")}
                  className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 shadow-sm transition-colors cursor-pointer"
                >
                  <Send size={14} />
                  <span>{isRtl ? "إرسال للموافقة" : "Submit Plan"}</span>
                </button>
              )}

              {canApproveReject && (
                <>
                  <button
                    onClick={() => {
                      setReasonModalAction("approve");
                      setReasonText("");
                      setIsReasonModalOpen(true);
                    }}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 shadow-sm transition-colors cursor-pointer"
                  >
                    <Check size={14} strokeWidth={3} />
                    <span>{isRtl ? "اعتماد الخطة" : "Approve Plan"}</span>
                  </button>

                  <button
                    onClick={() => {
                      setReasonModalAction("reject");
                      setReasonText("");
                      setIsReasonModalOpen(true);
                    }}
                    className="bg-rose-600 hover:bg-rose-700 text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 shadow-sm transition-colors cursor-pointer"
                  >
                    <X size={14} />
                    <span>{isRtl ? "رفض الخطة" : "Reject Plan"}</span>
                  </button>
                </>
              )}

              {canActivate && (
                <button
                  onClick={() => handleLifecycleTransition("activate")}
                  className="bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 shadow-sm transition-colors cursor-pointer"
                >
                  <CheckCircle2 size={14} />
                  <span>{isRtl ? "تفعيل الخطة" : "Activate Plan"}</span>
                </button>
              )}

              {canAmend && (
                <button
                  onClick={() => {
                    setReasonModalAction("amend");
                    setReasonText("");
                    setAmendEffectiveFrom("");
                    setIsReasonModalOpen(true);
                  }}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 shadow-sm transition-colors cursor-pointer"
                >
                  <Edit2 size={14} />
                  <span>{isRtl ? "تعديل الخطة" : "Amend Plan"}</span>
                </button>
              )}

              {canClose && (
                <button
                  onClick={() => handleLifecycleTransition("close")}
                  className="bg-slate-700 hover:bg-slate-800 text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 shadow-sm transition-colors cursor-pointer"
                >
                  <X size={14} />
                  <span>{isRtl ? "إغلاق الخطة" : "Close Plan"}</span>
                </button>
              )}

              {canCancel && (
                <button
                  onClick={() => {
                    setReasonModalAction("cancel");
                    setReasonText("");
                    setIsReasonModalOpen(true);
                  }}
                  className="bg-red-700 hover:bg-red-800 text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 shadow-sm transition-colors cursor-pointer"
                >
                  <X size={14} />
                  <span>{isRtl ? "إلغاء الخطة" : "Cancel Plan"}</span>
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="bg-slate-100 dark:bg-slate-800/70 p-1.5 rounded-2xl flex items-center justify-between gap-1 mb-6 overflow-x-auto shadow-inner">
        {[
          { id: "annual", label: isRtl ? "السنوية" : "Annual", icon: Target },
          { id: "territory", label: isRtl ? "التوزيع الجغرافي %" : "Territory %", icon: MapPin },
          { id: "quarterly", label: isRtl ? "التوزيع الربع سنوي %" : "Quarterly %", icon: Calendar },
          { id: "calculate", label: isRtl ? "الاحتساب" : "Calculate", icon: Calculator },
          { id: "mytargets", label: isRtl ? "أهدافي" : "My Targets", icon: BarChart3 },
          { id: "audit", label: isRtl ? "سجل التدقيق" : "Audit Trail", icon: FileText }
        ].map(tab => {
          const IconC = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex-1 py-2.5 px-4 rounded-xl text-xs flex items-center justify-center gap-2 shrink-0 transition-all cursor-pointer ${
                isActive
                  ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm font-bold"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white font-medium hover:bg-white/40 dark:hover:bg-slate-800/50"
              }`}
            >
              <IconC size={15} className={isActive ? "text-blue-600" : "text-slate-400"} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* TAB PANELS */}
      <AnimatePresence mode="wait">
        {/* Tab 1: Annual Products */}
        {activeTab === "annual" && (
          <motion.div key="annual" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <h2 className="text-lg font-bold text-slate-950 dark:text-white">
                {isRtl ? "المستهدف السنوي للمحافظ العلاجية" : "Annual Product Sales Targets"}
              </h2>

              {!isReadOnly && (
                <button
                  onClick={() => handleOpenAddModal()}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
                >
                  <Plus size={14} strokeWidth={2.5} />
                  <span>{isRtl ? "إضافة هدف" : "Add Target"}</span>
                </button>
              )}
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xxs">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs" dir={isRtl ? "rtl" : "ltr"}>
                  <thead>
                    <tr className="bg-slate-50/80 dark:bg-slate-950/50 border-b border-slate-200/80 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-semibold text-[11px]">
                      <th className="py-3.5 px-6">{isRtl ? "المنتج" : "Product"}</th>
                      <th className="py-3.5 px-6 text-center">{isRtl ? "السنة" : "Year"}</th>
                      <th className="py-3.5 px-6 text-right">{isRtl ? "الوحدات المستهدفة السنوية" : "Annual Target Units"}</th>
                      <th className="py-3.5 px-6 text-right">{isRtl ? "سعر الوحدة" : "Unit Price"}</th>
                      <th className="py-3.5 px-6 text-right">{isRtl ? "القيمة الإجمالية" : "Annual Value"}</th>
                      {!isReadOnly && <th className="py-3.5 px-6 text-center">{isRtl ? "الإجراءات" : "Actions"}</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium text-slate-700 dark:text-slate-200">
                    {annualProducts.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-12 text-center text-slate-400">
                          {isRtl ? "لا توجد أهداف مسجلة لهذه السنة" : "No annual product targets configured"}
                        </td>
                      </tr>
                    ) : (
                      annualProducts.map(prod => (
                        <tr key={prod.targetId} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors">
                          <td className="py-4 px-6 font-bold text-slate-900 dark:text-white">
                            {prod.productNameSnapshot}
                          </td>
                          <td className="py-4 px-6 text-center text-slate-500 dark:text-slate-400">
                            {prod.year}
                          </td>
                          <td className="py-4 px-6 text-right font-mono font-bold text-slate-900 dark:text-white">
                            {prod.annualTargetUnits.toLocaleString()}
                          </td>
                          <td className="py-4 px-6 text-right font-mono text-slate-500 dark:text-slate-400">
                            {formatCurrency(prod.unitPriceSnapshot || 0)}
                          </td>
                          <td className="py-4 px-6 text-right font-mono font-bold text-slate-900 dark:text-white">
                            {formatCurrency(prod.annualTargetValue || 0)}
                          </td>
                          {!isReadOnly && (
                            <td className="py-4 px-6 text-center">
                              <div className="flex items-center justify-center gap-3 text-slate-400">
                                <button
                                  onClick={() => handleOpenAddModal(prod)}
                                  className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer"
                                >
                                  <Edit2 size={15} />
                                </button>
                                <button
                                  onClick={() => handleDeleteProductTarget(prod.targetId)}
                                  className="hover:text-red-600 dark:hover:text-red-400 transition-colors cursor-pointer"
                                >
                                  <Trash2 size={15} />
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.div>
        )}

        {/* Tab 2: Territory % potentials */}
        {activeTab === "territory" && (
          <motion.div key="territory" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-bold text-slate-950 dark:text-white">
                  {isRtl ? "توزيع الإمكانيات الجغرافية" : "Territory Potential Allocation"}
                </h2>
                <div className="relative">
                  <select
                    value={selectedTerritoryProduct}
                    onChange={e => setSelectedTerritoryProduct(e.target.value)}
                    className="appearance-none bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-3.5 py-1.5 pr-8 text-xs font-bold text-slate-800 dark:text-slate-100 shadow-xxs focus:outline-none focus:border-blue-500 cursor-pointer max-w-[240px] truncate"
                  >
                    {annualProducts.map(p => (
                      <option key={p.targetId} value={p.productId}>{p.productNameSnapshot}</option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="absolute right-2.5 top-2.5 text-slate-400 pointer-events-none" />
                </div>
              </div>

              <div className="flex items-center gap-3">
                <span className={`px-3 py-1.5 rounded-lg text-xs font-bold text-white shadow-sm ${
                  Math.abs(potentialsTotalSum - 100) < 0.05 ? "bg-emerald-600" : "bg-red-600"
                }`}>
                  Total: {potentialsTotalSum.toFixed(2)}%
                </span>
                {Math.abs(potentialsTotalSum - 100) >= 0.05 && (
                  <span className="text-[10px] text-red-500 font-bold flex items-center gap-1">
                    <AlertTriangle size={12} />
                    <span>{isRtl ? "يجب أن يساوي المجموع 100%" : "Must sum to exactly 100%"}</span>
                  </span>
                )}
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xxs">
              <table className="w-full text-left text-xs" dir={isRtl ? "rtl" : "ltr"}>
                <thead>
                  <tr className="bg-slate-50/80 dark:bg-slate-950/50 border-b border-slate-200/80 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-semibold text-[11px]">
                    <th className="py-3.5 px-6">{isRtl ? "المنطقة الجغرافية" : "Territory / Area Path"}</th>
                    <th className="py-3.5 px-6">{isRtl ? "المدينة" : "City"}</th>
                    <th className="py-3.5 px-6">{isRtl ? "المحافظة" : "District"}</th>
                    <th className="py-3.5 px-6 text-right w-44">{isRtl ? "النسبة المحتملة %" : "Potential %"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium text-slate-700 dark:text-slate-200">
                  {currentProductPotentials.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-12 text-center text-slate-400">
                        {isRtl ? "لا توجد مناطق جغرافية معرفة" : "No geographic areas catalog defined"}
                      </td>
                    </tr>
                  ) : (
                    currentProductPotentials.map(row => (
                      <tr key={row.areaId} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors">
                        <td className="py-3.5 px-6 font-bold text-slate-900 dark:text-white">
                          {row.areaName}
                        </td>
                        <td className="py-3.5 px-6 text-slate-500">
                          {row.city}
                        </td>
                        <td className="py-3.5 px-6 text-slate-500">
                          {row.district}
                        </td>
                        <td className="py-2.5 px-6 text-right">
                          <input
                            type="number"
                            step="0.01"
                            disabled={isReadOnly}
                            value={row.potential || ""}
                            onChange={e => handlePotentialChangeLocal(row.areaId, e.target.value)}
                            className="w-24 px-3 py-1 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg text-right font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:border-blue-500 disabled:opacity-60 disabled:cursor-not-allowed"
                          />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}

        {/* Tab 3: Quarterly Distribution */}
        {activeTab === "quarterly" && (
          <motion.div key="quarterly" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-4">
            <h2 className="text-lg font-bold text-slate-950 dark:text-white">
              {isRtl ? "مستهدف التوزيع الربع سنوي للمحافظ" : "Quarterly Target Distributions %"}
            </h2>

            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xxs">
              <table className="w-full text-left text-xs" dir={isRtl ? "rtl" : "ltr"}>
                <thead>
                  <tr className="bg-slate-50/80 dark:bg-slate-950/50 border-b border-slate-200/80 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-semibold text-[11px]">
                    <th className="py-3.5 px-6">{isRtl ? "المنتج" : "Product"}</th>
                    <th className="py-3.5 px-4 text-center">Q1 %</th>
                    <th className="py-3.5 px-4 text-center">Q2 %</th>
                    <th className="py-3.5 px-4 text-center">Q3 %</th>
                    <th className="py-3.5 px-4 text-center">Q4 %</th>
                    <th className="py-3.5 px-6 text-right">{isRtl ? "الإجمالي" : "Total"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium text-slate-700 dark:text-slate-200">
                  {quarterlyListMapped.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-slate-400">
                        {isRtl ? "يرجى إضافة أهداف سنوية أولاً" : "Please add annual product targets first"}
                      </td>
                    </tr>
                  ) : (
                    quarterlyListMapped.map(row => {
                      const totalSum = row.q1 + row.q2 + row.q3 + row.q4;
                      const isExact = Math.abs(totalSum - 100) < 0.05;
                      return (
                        <tr key={row.productId} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors">
                          <td className="py-4 px-6 font-bold text-slate-900 dark:text-white">
                            {row.productName}
                          </td>
                          {(["q1", "q2", "q3", "q4"] as const).map(q => (
                            <td key={q} className="py-3 px-4 text-center">
                              <input
                                type="number"
                                step="0.01"
                                disabled={isReadOnly}
                                value={row[q]}
                                onChange={e => handleQuarterlyChangeLocal(row.productId, row.annualTargetId, q, e.target.value)}
                                className="w-20 px-2.5 py-1.5 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg text-center font-mono text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:border-blue-500 shadow-xxs disabled:opacity-60"
                              />
                            </td>
                          ))}
                          <td className="py-4 px-6 text-right">
                            <span className={`inline-block px-2.5 py-1 rounded-md text-[11px] font-bold text-white shadow-xxs ${
                              isExact ? "bg-emerald-600" : "bg-red-600"
                            }`}>
                              {totalSum.toFixed(1)}%
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}

        {/* Tab 4: Calculate Engine */}
        {activeTab === "calculate" && (
          <motion.div key="calculate" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-lg font-bold text-slate-950 dark:text-white">
                  {isRtl ? "أهداف التوزيع وتحليل الأداء" : "Calculated Targets & Performance Analytics"}
                </h2>
                <div className="relative">
                  <select
                    value={selectedCalcProduct}
                    onChange={e => setSelectedCalcProduct(e.target.value)}
                    className="appearance-none bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-3.5 py-1.5 pr-8 text-xs font-bold text-slate-800 dark:text-slate-100 shadow-xxs focus:outline-none cursor-pointer max-w-[240px] truncate"
                  >
                    {annualProducts.map(p => (
                      <option key={p.targetId} value={p.productId}>{p.productNameSnapshot}</option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="absolute right-2.5 top-2.5 text-slate-400 pointer-events-none" />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {isPlanningOfficer && (
                  <button
                    onClick={handleRebuildPerformance}
                    disabled={rebuilding}
                    className="bg-amber-600 hover:bg-amber-700 text-white px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xxs cursor-pointer disabled:opacity-60 transition-colors"
                  >
                    {rebuilding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw size={14} />}
                    <span>{isRtl ? "إعادة بناء مطابقة المبيعات" : "Rebuild Sales Alignments"}</span>
                  </button>
                )}

                {!isReadOnly && (
                  <>
                    <button
                      onClick={() => handleTriggerCalculation("single")}
                      className="bg-white dark:bg-slate-900 hover:bg-slate-50 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-xxs cursor-pointer"
                    >
                      <Calculator size={14} />
                      <span>{isRtl ? "احتساب هذا المنتج" : "Recalculate Selected"}</span>
                    </button>

                    <button
                      onClick={() => handleTriggerCalculation("all")}
                      className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
                    >
                      <Calculator size={14} />
                      <span>{isRtl ? "احتساب الخطة كاملة" : "Calculate All Portfolio"}</span>
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Live Calculation Progress bar */}
            {calculationRun && (calculationRun.status === "PENDING" || calculationRun.status === "IN_PROGRESS") && (
              <div className="bg-blue-50 dark:bg-blue-950/40 border border-blue-200 p-4 rounded-xl flex items-center justify-between gap-4 animate-pulse">
                <div className="flex items-center gap-3">
                  <Loader2 className="animate-spin text-blue-600" size={18} />
                  <div>
                    <p className="text-xs font-bold text-blue-900 dark:text-blue-200">
                      {isRtl ? "جاري احتساب أهداف المبيعات في الخلفية..." : "Background deterministic calculations running..."}
                    </p>
                    <p className="text-[10px] text-blue-700 dark:text-blue-300 mt-0.5">
                      Completed: {calculationRun.productsSucceeded} / {calculationRun.productsRequested} Products
                    </p>
                  </div>
                </div>
                <span className="text-xs font-extrabold text-blue-600">{calculationRun.status}</span>
              </div>
            )}

            {/* WP4.1G Performance Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-xxs">
                <p className="text-[10px] uppercase tracking-wider font-bold text-slate-400">YTD Target Units</p>
                <p className="text-2xl font-extrabold text-slate-900 dark:text-white mt-1">
                  {performanceSummary ? performanceSummary.targetUnits.toLocaleString() : "-"}
                </p>
              </div>
              <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-xxs">
                <p className="text-[10px] uppercase tracking-wider font-bold text-slate-400">YTD Delivered Units</p>
                <p className="text-2xl font-extrabold text-blue-600 dark:text-blue-400 mt-1">
                  {performanceSummary ? performanceSummary.actualUnits.toLocaleString() : "-"}
                  {performanceSummary && (
                    <span className="text-xs font-bold text-slate-400 block mt-0.5">
                      Achievement: {performanceSummary.achievementUnitsPercentage}%
                    </span>
                  )}
                </p>
              </div>
              <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-xxs">
                <p className="text-[10px] uppercase tracking-wider font-bold text-slate-400">YTD Delivered Sales</p>
                <p className="text-2xl font-extrabold text-emerald-600 mt-1">
                  {performanceSummary ? (
                    performanceSummary.valueAchievementStatus === "CURRENCY_MISMATCH"
                      ? "Currency Mismatch"
                      : formatCurrency(performanceSummary.actualValue)
                  ) : "-"}
                  {performanceSummary && (
                    <span className="text-xs font-bold text-slate-400 block mt-0.5">
                      Target: {performanceSummary.valueAchievementStatus === "CURRENCY_MISMATCH" ? "N/A" : formatCurrency(performanceSummary.targetValue)} (
                      {performanceSummary.valueAchievementStatus === "CURRENCY_MISMATCH" ? "Currency Mismatch" : `${performanceSummary.achievementValuePercentage}%`}
                      )
                    </span>
                  )}
                </p>
              </div>
              <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-xxs">
                <p className="text-[10px] uppercase tracking-wider font-bold text-slate-400">Projected Run-rate Forecast</p>
                <p className="text-2xl font-extrabold text-indigo-600 dark:text-indigo-400 mt-1">
                  {performanceSummary ? (
                    performanceSummary.valueAchievementStatus === "CURRENCY_MISMATCH"
                      ? "Currency Mismatch / Not Available"
                      : typeof performanceSummary.forecastedValue === "number"
                        ? formatCurrency(performanceSummary.forecastedValue)
                        : performanceSummary.forecastedValue
                  ) : "-"}
                  {performanceSummary && (
                    <span className="text-xs font-bold text-slate-400 block mt-0.5">
                      Forecast Achievement: {performanceSummary.valueAchievementStatus === "CURRENCY_MISMATCH" ? "N/A" : `${performanceSummary.forecastAchievementPercentage}%`}
                    </span>
                  )}
                </p>
              </div>
            </div>

            {/* Exceptions Gaps Board */}
            {isPlanningOfficer && exceptionsList.length > 0 && (
              <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 rounded-2xl p-4 space-y-3 shadow-xxs">
                <h4 className="font-bold text-amber-900 dark:text-amber-300 flex items-center gap-1.5 text-xs uppercase tracking-wider">
                  <AlertTriangle size={14} className="text-amber-600" />
                  <span>Data Quality Exceptions & Geographic Alignment Gaps ({exceptionsList.length})</span>
                </h4>
                <div className="max-h-[140px] overflow-y-auto divide-y divide-amber-200/50 text-xs font-medium text-amber-800 dark:text-amber-400">
                  {exceptionsList.map((exc, idx) => (
                    <div key={idx} className="py-2 flex justify-between items-start gap-4">
                      <div>
                        <p className="font-bold text-slate-900 dark:text-white">Order: {exc.orderId} - Pharmacy: {exc.pharmacyName}</p>
                        <p className="text-[10px] text-amber-700 dark:text-amber-500 mt-0.5">{exc.details}</p>
                      </div>
                      <span className="px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 font-extrabold text-[9px] uppercase">{exc.issueType}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xxs">
              <table className="w-full text-left text-xs" dir={isRtl ? "rtl" : "ltr"}>
                <thead>
                  <tr className="bg-slate-50/80 dark:bg-slate-950/50 border-b border-slate-200/80 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-semibold text-[11px]">
                    <th className="py-3.5 px-4">{isRtl ? "المنطقة" : "Area"}</th>
                    <th className="py-3.5 px-4 text-center">{isRtl ? "الشهر" : "Month"}</th>
                    <th className="py-3.5 px-4 text-right">{isRtl ? "الوحدات المستهدفة" : "Target Units"}</th>
                    <th className="py-3.5 px-4 text-right">{isRtl ? "المبيعات المحققة" : "Delivered Units"}</th>
                    <th className="py-3.5 px-4 text-right">{isRtl ? "قيمة الهدف" : "Target Value"}</th>
                    <th className="py-3.5 px-4 text-right">{isRtl ? "المبيعات الفعلية" : "Delivered Sales"}</th>
                    <th className="py-3.5 px-4 text-right">{isRtl ? "الإنجاز" : "Achievement"}</th>
                    <th className="py-3.5 px-4 text-right">{isRtl ? "الانحراف" : "Variance"}</th>
                    <th className="py-3.5 px-4 text-right">{isRtl ? "المتبقي" : "Remaining"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium text-slate-700 dark:text-slate-200">
                  {calculatedRowsFiltered.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-12 text-center text-slate-400">
                        {isRtl ? "لا توجد حسابات مسجلة للمنتج المختار" : "No calculated targets found for this product. Run calculate above."}
                      </td>
                    </tr>
                  ) : (
                    calculatedRowsFiltered.map(row => {
                      const perf = performanceRecords.find(p => 
                        p.productId === row.productId && 
                        p.areaId === row.areaId && 
                        p.month === row.month
                      );

                      return (
                        <tr key={row.calculatedTargetId} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors">
                          <td className="py-3.5 px-4 font-bold text-slate-950 dark:text-white">{row.areaNameSnapshot}</td>
                          <td className="py-3.5 px-4 text-center text-slate-500 font-mono text-xs">Month {row.month}</td>
                          <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-900 dark:text-white">{row.targetUnits.toLocaleString()}</td>
                          <td className="py-3.5 px-4 text-right font-mono font-bold text-blue-600">{perf ? perf.actualUnits.toLocaleString() : "0"}</td>
                          <td className="py-3.5 px-4 text-right font-mono text-slate-600 dark:text-slate-400">{formatCurrency(row.targetValue)}</td>
                          <td className="py-3.5 px-4 text-right font-mono font-bold text-emerald-600">
                            {perf ? (perf.valueAchievementStatus === "CURRENCY_MISMATCH" ? "Currency Mismatch" : formatCurrency(perf.actualValue)) : formatCurrency(0)}
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono font-extrabold text-blue-600">
                            {perf ? (perf.valueAchievementStatus === "CURRENCY_MISMATCH" ? "Currency Mismatch" : `${perf.achievementValuePercentage}%`) : "0%"}
                          </td>
                          <td className={`py-3.5 px-4 text-right font-mono font-bold ${perf && perf.varianceValue >= 0 && perf.valueAchievementStatus !== "CURRENCY_MISMATCH" ? "text-emerald-600" : "text-red-500"}`}>
                            {perf ? (perf.valueAchievementStatus === "CURRENCY_MISMATCH" ? "Currency Mismatch" : formatCurrency(perf.varianceValue)) : formatCurrency(-row.targetValue)}
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono text-slate-500">
                            {perf ? (perf.valueAchievementStatus === "CURRENCY_MISMATCH" ? "Currency Mismatch" : formatCurrency(perf.remainingValue)) : formatCurrency(row.targetValue)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}

        {/* Tab 5: My assigned targets */}
        {activeTab === "mytargets" && (
          <motion.div key="mytargets" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold text-slate-950 dark:text-white">
                {isRtl ? "أهدافي المخصصة لمناطق ترويجي" : "My Assigned Targets & Achievement"}
              </h2>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xxs">
              <table className="w-full text-left text-xs" dir={isRtl ? "rtl" : "ltr"}>
                <thead>
                  <tr className="bg-slate-50/80 dark:bg-slate-950/50 border-b border-slate-200/80 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-semibold text-[11px]">
                    <th className="py-3.5 px-6">{isRtl ? "المنتج" : "Product"}</th>
                    <th className="py-3.5 px-6">{isRtl ? "المنطقة الجغرافية" : "Territory"}</th>
                    <th className="py-3.5 px-6 text-center">{isRtl ? "الشهر" : "Month"}</th>
                    <th className="py-3.5 px-6 text-right">{isRtl ? "الوحدات المستهدفة" : "Target Units"}</th>
                    <th className="py-3.5 px-6 text-right">{isRtl ? "قيمة الهدف" : "Target Value"}</th>
                    <th className="py-3.5 px-6 text-center">{isRtl ? "نسبة الإنجاز" : "Progress"}</th>
                  </tr>
                </thead>
                 <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium text-slate-700 dark:text-slate-200">
                  {myPerformanceRecords.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-16 text-center text-slate-400">
                        {isRtl ? "لا توجد أهداف وأداء مخصصة لمناطقك الجغرافية حالياً" : "No targets or actual performance records assigned to your territories"}
                      </td>
                    </tr>
                  ) : (
                    myPerformanceRecords.map(r => ({
                      calculatedTargetId: r.performanceId,
                      productNameSnapshot: productsCatalog.find(p => p.id === r.productId)?.name || r.productId,
                      areaNameSnapshot: areasCatalog.find(a => a.id === r.areaId)?.name || r.areaId,
                      month: r.month,
                      targetUnits: r.targetUnits,
                      targetValue: r.targetValue,
                      achievementValuePercentage: r.achievementValuePercentage !== undefined ? r.achievementValuePercentage : (r.achievementValuePercentagePercentage || 0)
                    })).map(row => (
                      <tr key={row.calculatedTargetId} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors">
                        <td className="py-4 px-6 font-bold text-slate-900 dark:text-white">{row.productNameSnapshot}</td>
                        <td className="py-4 px-6">{row.areaNameSnapshot}</td>
                        <td className="py-4 px-6 text-center">Month {row.month}</td>
                        <td className="py-4 px-6 text-right font-mono font-bold">{row.targetUnits.toLocaleString()}</td>
                        <td className="py-4 px-6 text-right font-mono font-bold text-slate-850 dark:text-slate-300">{formatCurrency(row.targetValue)}</td>
                        <td className={`py-4 px-6 text-center font-extrabold ${row.achievementValuePercentage >= 90 ? "text-emerald-600" : row.achievementValuePercentage >= 70 ? "text-blue-600" : "text-amber-600"}`}>
                          {row.achievementValuePercentage}%
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}

        {/* Tab 6: Audit Trail (WP4.1H Visual Audit Trail) */}
        {activeTab === "audit" && (
          <motion.div key="audit" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold text-slate-950 dark:text-white">
                {isRtl ? "سجل تتبع تدقيق التعديلات والاعتمادات" : "Product Target Plan Audit Trail"}
              </h2>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-xxs">
              {auditLogs.length === 0 ? (
                <div className="py-12 text-center text-slate-400">
                  <FileText className="mx-auto w-10 h-10 text-slate-300 dark:text-slate-700 mb-2" />
                  <p className="font-semibold text-xs">{isRtl ? "لا توجد سجلات تدقيق لهذه الخطة بعد" : "No audit logs recorded for this plan yet"}</p>
                </div>
              ) : (
                <div className="relative border-l border-slate-200 dark:border-slate-800 pl-6 ml-3 space-y-6">
                  {auditLogs.map((log) => (
                    <div key={log.logId} className="relative">
                      {/* Timeline Dot */}
                      <span className="absolute -left-[31px] top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-950 border-2 border-white dark:border-slate-900 shadow-xxs">
                        <span className="h-1.5 w-1.5 rounded-full bg-blue-600"></span>
                      </span>
                      
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-900 dark:text-white capitalize">
                            {log.action}
                          </span>
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                            V{log.planVersionSnapshot}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 font-mono text-[10px] text-slate-400">
                          <Clock size={11} />
                          <span>{new Date(log.timestamp).toLocaleString()}</span>
                        </div>
                      </div>

                      <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 font-medium">
                        By <span className="font-bold text-slate-800 dark:text-slate-200">{log.actorEmail}</span> ({log.actorRole})
                      </p>

                      {log.comment && (
                        <div className="bg-slate-50 dark:bg-slate-950/40 border border-slate-100 dark:border-slate-800 p-2.5 rounded-xl text-[11px] text-slate-700 dark:text-slate-300 mt-2 italic font-mono">
                          "{log.comment}"
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MODAL: Add / Edit Target */}
      <AnimatePresence>
        {isAddModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs">
            <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} className="bg-white dark:bg-slate-900 w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden relative flex flex-col text-left">
              <div className="px-6 pt-6 pb-3 relative border-b border-slate-100 dark:border-slate-800">
                <button type="button" onClick={() => setIsAddModalOpen(false)} className="absolute top-5 right-5 text-slate-400 hover:text-slate-600 cursor-pointer"><X size={18} /></button>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">{editingProd ? (isRtl ? "تعديل المستهدف السنوي" : "Edit Target") : (isRtl ? "إضافة هدف مبيعات سنوي" : "Add Annual Target")}</h3>
              </div>

              <form onSubmit={handleSaveProductTarget} className="p-6 space-y-4 text-xs">
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1.5">{isRtl ? "اختر منتج من الدليل" : "Select Master Product"}</label>
                  <select
                    value={prodFormId}
                    onChange={e => {
                      setProdFormId(e.target.value);
                      const p = productsCatalog.find(x => x.id === e.target.value);
                      if (p) setProdFormPrice((p.price || 0).toString());
                    }}
                    disabled={!!editingProd}
                    className="w-full px-3 py-2.5 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl"
                  >
                    {productsCatalog.map(p => (
                      <option key={p.id} value={p.id}>{p.name} (SKU: {p.sku})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1.5">{isRtl ? "الوحدات المستهدفة السنوية" : "Annual Target Units"}</label>
                  <input type="number" required value={prodFormUnits} onChange={e => setProdFormUnits(e.target.value)} className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl font-mono text-xs" />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1.5">{isRtl ? "سعر الوحدة" : `Unit Price (${activeMarket?.currencyCode || "—"})`}</label>
                  <input type="number" step="0.01" required value={prodFormPrice} onChange={e => setProdFormPrice(e.target.value)} className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl font-mono text-xs" />
                </div>

                <div className="flex justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                  <button type="button" onClick={() => setIsAddModalOpen(false)} className="px-4 py-2 bg-slate-100 rounded-xl font-semibold cursor-pointer">{isRtl ? "إلغاء" : "Cancel"}</button>
                  <button type="submit" className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold cursor-pointer">{isRtl ? "حفظ" : "Save Target"}</button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL: Import Spreadsheet Manager */}
      <AnimatePresence>
        {isImportModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs">
            <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} className="bg-white dark:bg-slate-900 w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden relative flex flex-col max-h-[85vh]">
              <div className="px-6 pt-6 pb-3 relative border-b border-slate-100 dark:border-slate-800 flex justify-between items-center">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">{isRtl ? "استيراد وتدقيق البيانات السنوية والجغرافية" : "Excel Import & Staging Center"}</h3>
                <button type="button" onClick={() => { setIsImportModalOpen(false); setStagedImport(null); setImportSuccessMessage(""); }} className="text-slate-400 hover:text-slate-600 cursor-pointer"><X size={18} /></button>
              </div>

              <div className="p-6 overflow-y-auto space-y-4 text-xs">
                {/* Download sample template controls */}
                <div className="bg-slate-50 dark:bg-slate-950/40 p-4 border border-slate-100 dark:border-slate-800 rounded-xl">
                  <p className="font-bold text-slate-800 dark:text-slate-200 mb-2">{isRtl ? "تحميل قوالب الإدخال الرسمية" : "Download Official Formatting Templates"}</p>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => handleDownloadTemplate("annual")} className="px-3 py-1.5 bg-white border border-slate-200 dark:bg-slate-900 dark:border-slate-700 rounded text-[10px] font-bold flex items-center gap-1 cursor-pointer"><Download size={11} /> <span>Annual Targets</span></button>
                    <button onClick={() => handleDownloadTemplate("area")} className="px-3 py-1.5 bg-white border border-slate-200 dark:bg-slate-900 dark:border-slate-700 rounded text-[10px] font-bold flex items-center gap-1 cursor-pointer"><Download size={11} /> <span>Area Distributions</span></button>
                    <button onClick={() => handleDownloadTemplate("quarterly")} className="px-3 py-1.5 bg-white border border-slate-200 dark:bg-slate-900 dark:border-slate-700 rounded text-[10px] font-bold flex items-center gap-1 cursor-pointer"><Download size={11} /> <span>Quarterly Split</span></button>
                  </div>
                </div>

                {/* Drag Drop / Selector Area */}
                {!stagedImport && !importLoading && (
                  <div className="border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl p-8 text-center flex flex-col items-center justify-center cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-950/20 transition-colors relative">
                    <input type="file" accept=".xlsx, .xls, .csv" onChange={handleXlsxUpload} className="absolute inset-0 opacity-0 cursor-pointer" />
                    <FileSpreadsheet className="w-10 h-10 text-blue-600 mb-3" />
                    <p className="font-bold text-slate-900 dark:text-white mb-1">{isRtl ? "انقر أو اسحب ملف Excel لرفعه" : "Drag and drop or click to select spreadsheet"}</p>
                    <p className="text-[10px] text-slate-400">Supports .XLSX, .XLS, or .CSV formatted templates</p>
                  </div>
                )}

                {/* Loading State */}
                {importLoading && (
                  <div className="py-12 flex flex-col items-center justify-center">
                    <Loader2 className="animate-spin text-blue-600 w-8 h-8 mb-3" />
                    <p className="font-bold text-slate-700 dark:text-slate-300">{isRtl ? "جاري تشغيل محرك التدقيق والتحقق من القوانين..." : "Executing schema rules & verifying group sums..."}</p>
                  </div>
                )}

                {/* Staged Data Preview & Validation Report */}
                {stagedImport && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-3 bg-slate-50 dark:bg-slate-950/20 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
                      <div>
                        <p className="font-bold text-slate-900 dark:text-white">Import ID: {stagedImport.importId.split("::").slice(0, 3).join("::")}...</p>
                        <p className="text-[10px] text-slate-400 mt-1">Template Type: <span className="font-bold text-blue-600 uppercase">{stagedImport.templateType}</span></p>
                      </div>
                      <span className={`px-2.5 py-1 rounded text-[10px] font-bold text-white uppercase ${
                        stagedImport.status === "PREVIEW_READY" ? "bg-emerald-600" : "bg-red-600"
                      }`}>{stagedImport.status}</span>
                    </div>

                    {/* Stats */}
                    <div className="grid grid-cols-3 gap-3 text-center">
                      <div className="bg-slate-50 p-2.5 border rounded-lg">
                        <p className="text-slate-400 text-[9px] uppercase font-bold">Total Rows</p>
                        <p className="text-lg font-bold text-slate-850">{stagedImport.totalRecords}</p>
                      </div>
                      <div className="bg-emerald-50 p-2.5 border border-emerald-100 rounded-lg">
                        <p className="text-emerald-500 text-[9px] uppercase font-bold">Valid Rows</p>
                        <p className="text-lg font-bold text-emerald-700">{stagedImport.validRecordsCount}</p>
                      </div>
                      <div className="bg-red-50 p-2.5 border border-red-100 rounded-lg">
                        <p className="text-red-500 text-[9px] uppercase font-bold">Error Rows</p>
                        <p className="text-lg font-bold text-red-700">{stagedImport.errorRecordsCount}</p>
                      </div>
                    </div>

                    {/* Global or Staging Errors */}
                    {stagedImport.globalErrors && stagedImport.globalErrors.length > 0 && (
                      <div className="bg-red-50 border border-red-200 text-red-800 p-3 rounded-xl space-y-1">
                        <p className="font-bold flex items-center gap-1 text-[11px]"><AlertTriangle size={13} /> <span>Group-Level Validation Mismatch:</span></p>
                        <ul className="list-disc pl-4 space-y-1 text-[10px]">
                          {stagedImport.globalErrors.map((err: any, i: number) => <li key={i}>{err.message}</li>)}
                        </ul>
                      </div>
                    )}

                    {/* Record rows scroll area */}
                    <div className="max-h-[220px] overflow-y-auto border rounded-xl divide-y bg-white dark:bg-slate-950 font-medium">
                      {stagedImport.records.map((rec: any, idx: number) => (
                        <div key={idx} className="p-3 flex items-start justify-between gap-4 text-[11px]">
                          <div>
                            <p className="font-bold text-slate-900 dark:text-white">Row #{rec.rowNumber} - Product: {rec.parsed.product || rec.raw["Product (ID or SKU)"]}</p>
                            {rec.parsed.area && <p className="text-[10px] text-slate-400 mt-0.5">Area: {rec.parsed.area}</p>}
                            {rec.errors && rec.errors.length > 0 && (
                              <div className="text-red-500 font-bold text-[10px] mt-1 space-y-0.5">
                                {rec.errors.map((e: any, i: number) => <p key={i}>● {e.message}</p>)}
                              </div>
                            )}
                          </div>
                          <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${rec.valid ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>{rec.valid ? "Valid" : "Error"}</span>
                        </div>
                      ))}
                    </div>

                    {/* Import success banner */}
                    {importSuccessMessage && (
                      <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 p-4 rounded-xl flex items-center gap-2 font-bold text-[11px]">
                        <CheckCircle2 className="text-emerald-600" size={16} />
                        <span>{importSuccessMessage}</span>
                      </div>
                    )}

                    {/* Commit and Rollback action triggers */}
                    <div className="flex items-center justify-between border-t pt-4">
                      <button type="button" onClick={() => { setStagedImport(null); setImportSuccessMessage(""); }} className="px-4 py-2 bg-slate-100 rounded-xl font-bold cursor-pointer">Upload Different File</button>
                      <div className="flex items-center gap-2.5">
                        {stagedImport.status === "COMPLETE" && (
                          <button type="button" onClick={handleRollbackImport} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold cursor-pointer flex items-center gap-1"><RotateCcw size={13} /> <span>Rollback/Undo Import</span></button>
                        )}
                        {stagedImport.status === "PREVIEW_READY" && (
                          <button type="button" onClick={handleCommitImport} className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold cursor-pointer flex items-center gap-1.5"><CheckCircle2 size={14} /> <span>Commit staged to active plan</span></button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL: Transition Reason / Comment Input (WP4.1H) */}
      <AnimatePresence>
        {isReasonModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs">
            <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} className="bg-white dark:bg-slate-900 w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden relative flex flex-col text-left">
              <div className="px-6 pt-6 pb-3 relative border-b border-slate-100 dark:border-slate-800">
                <button type="button" onClick={() => setIsReasonModalOpen(false)} className="absolute top-5 right-5 text-slate-400 hover:text-slate-600 cursor-pointer"><X size={18} /></button>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white uppercase tracking-tight">
                  {reasonModalAction === "approve" ? (isRtl ? "تأكيد اعتماد الخطة" : "Approve Target Plan") :
                   reasonModalAction === "reject" ? (isRtl ? "تأكيد رفض الخطة" : "Reject Target Plan") :
                   reasonModalAction === "amend" ? (isRtl ? "تأكيد تعديل الخطة" : "Amend Target Plan") :
                   (isRtl ? "تأكيد إلغاء الخطة" : "Cancel Target Plan")}
                </h3>
              </div>

              <div className="p-6 space-y-4 text-xs">
                <div>
                  <p className="text-slate-500 dark:text-slate-400 font-medium mb-3">
                    {reasonModalAction === "approve" 
                      ? (isRtl ? "هل أنت متأكد من رغبتك في اعتماد هذه الخطة؟ يمكنك إضافة تعليق اختياري أدناه." : "Are you sure you want to approve this target plan? You may optionally specify a comment below.")
                      : (isRtl ? "الرجاء تحديد سبب إلزامي لهذه العملية للتوثيق والتدقيق." : "Please specify the required reason for this transition. This comment is logged in the immutable audit trail.")
                    }
                  </p>

                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                    {reasonModalAction === "approve" ? (isRtl ? "تعليق (اختياري)" : "Comment (Optional)") : (isRtl ? "السبب (إلزامي)" : "Reason / Comment (Required)")}
                  </label>
                  <textarea
                    required={reasonModalAction !== "approve"}
                    value={reasonText}
                    onChange={e => setReasonText(e.target.value)}
                    rows={4}
                    placeholder={isRtl ? "أدخل التفاصيل هنا..." : "Enter details here..."}
                    className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 mb-3"
                  />
                </div>

                {reasonModalAction === "amend" && (
                  <div>
                    <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                      {isRtl ? "تاريخ بدء السريان (إلزامي)" : "Effective From Date (Required)"}
                    </label>
                    <input
                      type="date"
                      required
                      value={amendEffectiveFrom}
                      onChange={e => setAmendEffectiveFrom(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                )}

                <div className="flex justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                  <button 
                    type="button" 
                    onClick={() => setIsReasonModalOpen(false)} 
                    className="px-4 py-2 bg-slate-100 rounded-xl font-semibold cursor-pointer"
                  >
                    {isRtl ? "إلغاء" : "Cancel"}
                  </button>
                  <button 
                    type="button"
                    onClick={() => {
                      if (reasonModalAction !== "approve" && !reasonText.trim()) {
                        showToast(isRtl ? "السبب إلزامي لإتمام العملية" : "A reason is strictly required to proceed.");
                        return;
                      }
                      if (reasonModalAction === "amend" && !amendEffectiveFrom.trim()) {
                        showToast(isRtl ? "تاريخ بدء السريان إلزامي للتعديل" : "An effective from date is strictly required to proceed.");
                        return;
                      }
                      
                      let payload: any = {};
                      if (reasonModalAction === "approve") {
                        payload = { comment: reasonText };
                      } else if (reasonModalAction === "amend") {
                        payload = { reason: reasonText, effectiveFrom: amendEffectiveFrom };
                      } else {
                        payload = { reason: reasonText };
                      }

                      handleLifecycleTransition(reasonModalAction!, payload);
                      setIsReasonModalOpen(false);
                    }}
                    className={`px-5 py-2 text-white rounded-xl font-bold cursor-pointer transition-colors ${
                      reasonModalAction === "approve" ? "bg-emerald-600 hover:bg-emerald-700" :
                      reasonModalAction === "reject" || reasonModalAction === "cancel" ? "bg-red-600 hover:bg-red-700" :
                      "bg-indigo-600 hover:bg-indigo-700"
                    }`}
                  >
                    {isRtl ? "تأكيد وإرسال" : "Confirm & Execute"}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
