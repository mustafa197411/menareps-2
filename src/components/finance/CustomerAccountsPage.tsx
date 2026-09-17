import React, { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { 
  Building2, 
  Search, 
  Filter, 
  RefreshCw, 
  Shield, 
  AlertTriangle, 
  CheckCircle2, 
  Clock, 
  FileText, 
  Edit3, 
  Eye, 
  Plus, 
  X, 
  Sliders, 
  DollarSign, 
  TrendingUp, 
  PieChart, 
  Calendar, 
  BarChart3 
} from "lucide-react";
import { auth } from "../../lib/firebase";
import { normalizeRole, Role } from "../../types";
import { 
  CustomerFinancialProfile, 
  CustomerLedgerEntry, 
  PaymentTermCode, 
  ArBootstrapReport,
  AgeingBreakdown 
} from "../../features/ar/arTypes";
import { 
  getOrCreateCustomerProfile, 
  updateCustomerProfile, 
  getCustomerLedger, 
  bootstrapAllFinancialProfiles,
  postAdjustmentEntry,
  reconcileDeliveredInvoices
} from "../../features/ar/arService";
import { reconcileVisitPayments } from "../../features/ar/paymentService";
import { useModalScrollLock } from "../../lib/scrollLock";
import { assertSingleCurrency } from "../../lib/financialIdentity";
import { formatCurrencyForIdentity, type MarketBusinessSettings } from "../../lib/marketSettings";
import { fetchScopedCommercialRead } from "../../lib/commercialReadClient";

interface CustomerAccountsPageProps {
  currentUser: any;
  lang: "en" | "ar";
  userTerritoryAssignments?: any[];
}

export default function CustomerAccountsPage({
  currentUser,
  lang,
  userTerritoryAssignments = []
}: CustomerAccountsPageProps) {
  const isRtl = lang === "ar";
  const userRole = normalizeRole(currentUser?.role);

  // Authorization checks
  const isFinanceRole = userRole === Role.FINANCE_MANAGER || userRole === Role.FINANCE || userRole === Role.SUPER_ADMIN || userRole === Role.ADMIN || userRole === Role.GENERAL_MANAGER;
  const canEditProfile = isFinanceRole;
  // Legacy collection-wide maintenance routines are migration utilities only;
  // they are not exposed from the operational AR surface.
  const maintenanceActionsAvailable = false;

  // Data state
  const [pharmacies, setPharmacies] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<Record<string, CustomerFinancialProfile>>({});
  const [markets, setMarkets] = useState<MarketBusinessSettings[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [bootstrapReport, setBootstrapReport] = useState<ArBootstrapReport | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [reconcileReport, setReconcileReport] = useState<any | null>(null);
  const [reconcilingVisitPayments, setReconcilingVisitPayments] = useState(false);
  const [visitPaymentReport, setVisitPaymentReport] = useState<any | null>(null);

  // Search and Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [termFilter, setTermFilter] = useState<string>("ALL");

  // Selected Account for Details / Ledger View
  const [selectedPharmacy, setSelectedPharmacy] = useState<any | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<CustomerFinancialProfile | null>(null);
  const [selectedLedger, setSelectedLedger] = useState<CustomerLedgerEntry[]>([]);
  const [loadingLedger, setLoadingLedger] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  // Edit Profile Modal
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editForm, setEditForm] = useState<{
    paymentTermCode: PaymentTermCode;
    paymentTermDays: number;
    financeNotes: string;
    active: boolean;
  }>({
    paymentTermCode: "CASH",
    paymentTermDays: 0,
    financeNotes: "",
    active: true
  });
  const [savingProfile, setSavingProfile] = useState(false);

  // Adjustment Modal
  const [isAdjustmentModalOpen, setIsAdjustmentModalOpen] = useState(false);
  const [adjType, setAdjType] = useState<"ADJUSTMENT_DEBIT" | "ADJUSTMENT_CREDIT">("ADJUSTMENT_DEBIT");
  const [adjAmount, setAdjAmount] = useState("");
  const [adjNotes, setAdjNotes] = useState("");
  const [savingAdj, setSavingAdj] = useState(false);

  useModalScrollLock(isDetailsOpen || isEditModalOpen || isAdjustmentModalOpen);

  // Load initial pharmacies and financial profiles
  const loadData = async () => {
    if (!isFinanceRole) { setLoading(false); return; }
    setLoading(true);
    setLoadError(null);
    try {
      if (!auth.currentUser) throw new Error("AUTHENTICATION_REQUIRED");
      const result = await fetchScopedCommercialRead(auth.currentUser, { kind: "CUSTOMER_ACCOUNTS" });
      const pList: any[] = result.pharmacies || [];
      setPharmacies(pList);
      const pMap: Record<string, CustomerFinancialProfile> = {};
      (result.profiles || []).forEach((profile: CustomerFinancialProfile & { id?: string }) => { pMap[profile.pharmacyId || profile.id || ""] = profile; });
      setProfiles(pMap);
      setMarkets(Array.isArray(result.markets) ? result.markets : []);
    } catch (err) {
      console.error("[FI_LOAD_ERROR]", err);
      setLoadError(err instanceof Error ? err.message : "CUSTOMER_ACCOUNTS_LOAD_FAILED");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Filtered Pharmacies based on Search and Scope
  const filteredAccounts = useMemo(() => {
    return pharmacies.filter(p => {
      const profile = profiles[p.id];
      const accNum = profile?.customerAccountNumber || "";
      const pName = p.name || p.pharmacyName || "";
      const cityArea = `${p.city || ""} ${p.area || ""} ${p.district || ""}`;

      // Search matching
      const matchesSearch = 
        !searchQuery.trim() ||
        pName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        accNum.toLowerCase().includes(searchQuery.toLowerCase()) ||
        cityArea.toLowerCase().includes(searchQuery.toLowerCase());

      if (!matchesSearch) return false;

      // Term Filter
      if (termFilter !== "ALL") {
        if ((profile?.paymentTermCode || "CASH") !== termFilter) return false;
      }

      return true;
    });
  }, [pharmacies, profiles, searchQuery, termFilter]);

  // Financial Summaries across accounts
  const summaryCards = useMemo(() => {
    let totalInvoiced = 0;
    let totalCollected = 0;
    let totalOutstanding = 0;
    let totalOverdue = 0;

    const profileList = Object.values(profiles) as CustomerFinancialProfile[];
    let currencyCode: string | null = null; let mixedCurrency = false;
    try { currencyCode = assertSingleCurrency(profileList, p => p.currencyCode || p.currency || ""); } catch { mixedCurrency = true; }
    profileList.forEach((p: CustomerFinancialProfile) => {
      totalInvoiced += (p.totalInvoiced || 0);
      totalCollected += (p.totalCollected || 0);
      totalOutstanding += (p.outstandingBalance || 0);
      totalOverdue += (p.overdueBalance || 0);
    });

    const collectionRate = totalInvoiced > 0 
      ? Math.min(100, Math.round((totalCollected / totalInvoiced) * 100))
      : 100;

    return {
      totalCustomers: pharmacies.length,
      totalInvoiced,
      totalCollected,
      totalOutstanding,
      totalOverdue,
      collectionRate,
      currencyCode,
      marketId: profileList.find(p => (p.currencyCode || p.currency) === currencyCode)?.marketId || ""
      ,mixedCurrency
    };
  }, [pharmacies, profiles]);

  const formatProfileMoney = (amount: number, profile?: CustomerFinancialProfile | null) => {
    if (!profile && summaryCards.mixedCurrency) return isRtl ? "مجمّع حسب العملة أدناه" : "Grouped by currency below";
    const marketId = profile?.marketId || summaryCards.marketId;
    try { return formatCurrencyForIdentity(amount, { marketId }, markets); } catch { return isRtl ? "إعدادات السوق مطلوبة" : "Market configuration required"; }
  };
  const currencySummaryGroups = useMemo(() => (Object.values(profiles) as CustomerFinancialProfile[]).reduce((groups, profile) => {
    const currency = (profile.currencyCode || profile.currency || "").trim().toUpperCase(); if (!/^[A-Z]{3}$/.test(currency)) return groups;
    const group = groups[currency] ||= { currency, totalInvoiced: 0, totalCollected: 0, totalOutstanding: 0, totalOverdue: 0, marketId: profile.marketId || "" };
    group.totalInvoiced += profile.totalInvoiced || 0; group.totalCollected += profile.totalCollected || 0; group.totalOutstanding += profile.outstandingBalance || 0; group.totalOverdue += profile.overdueBalance || 0; return groups;
  }, {} as Record<string, { currency: string; totalInvoiced: number; totalCollected: number; totalOutstanding: number; totalOverdue: number; marketId: string }>), [profiles]);

  // Keydown listener for Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isDetailsOpen) setIsDetailsOpen(false);
        if (isEditModalOpen) setIsEditModalOpen(false);
        if (isAdjustmentModalOpen) setIsAdjustmentModalOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isDetailsOpen, isEditModalOpen, isAdjustmentModalOpen]);

  // Handle Reconcile Delivered Invoices (Backfill)
  const handleReconcile = async () => {
    setReconciling(true);
    setReconcileReport(null);
    try {
      const report = await reconcileDeliveredInvoices(currentUser?.id || "system", currentUser?.name || "User");
      setReconcileReport(report);
      await loadData();
    } catch (err) {
      console.error("[RECONCILE_ERROR]", err);
    } finally {
      setReconciling(false);
    }
  };

  // Handle Reconcile Visit Payments
  const handleReconcileVisitPayments = async () => {
    setReconcilingVisitPayments(true);
    setVisitPaymentReport(null);
    try {
      const report = await reconcileVisitPayments(currentUser?.id || "system", currentUser?.name || "User");
      setVisitPaymentReport(report);
      await loadData();
    } catch (err) {
      console.error("[VISIT_PAYMENT_RECONCILE_ERROR]", err);
    } finally {
      setReconcilingVisitPayments(false);
    }
  };

  // Handle Bootstrap Profiles
  const handleBootstrap = async () => {
    setBootstrapping(true);
    setBootstrapReport(null);
    try {
      const report = await bootstrapAllFinancialProfiles(currentUser?.id || "system", currentUser?.name || "User");
      setBootstrapReport(report);
      await loadData();
    } catch (err) {
      console.error("[BOOTSTRAP_ERROR]", err);
    } finally {
      setBootstrapping(false);
    }
  };

  // View Details & Ledger
  const handleViewAccount = async (pharmacy: any) => {
    setSelectedPharmacy(pharmacy);
    let profile = profiles[pharmacy.id];
    let profileFound = false;
    let ledgerQueryAttempted = false;
    let ledgerQuerySucceeded = false;

    try {
      if (!profile) throw new Error("CUSTOMER_FINANCIAL_PROFILE_NOT_CONFIGURED");
      profileFound = !!profile;
      setSelectedProfile(profile);

      if (!pharmacy || !profile) {
        throw new Error("Missing pharmacy or financial profile");
      }

      setIsDetailsOpen(true);

      // Fetch Ledger History
      setLoadingLedger(true);
      ledgerQueryAttempted = true;
      if (!auth.currentUser) throw new Error("AUTHENTICATION_REQUIRED");
      const result = await fetchScopedCommercialRead(auth.currentUser, { kind: "CUSTOMER_ACCOUNTS", pharmacyId: pharmacy.id });
      const entries = result.ledger || [];
      ledgerQuerySucceeded = true;
      setSelectedLedger(entries);
    } catch (err: any) {
      console.error("[CUSTOMER_ACCOUNT_VIEW_ERROR]", JSON.stringify({
        pharmacyId: pharmacy?.id || "",
        profileFound,
        ledgerQueryAttempted,
        ledgerQuerySucceeded,
        errorCode: err.code || "VIEW_ERROR",
        errorMessage: err.message || String(err)
      }));
    } finally {
      setLoadingLedger(false);
    }
  };

  // Open Edit Profile Modal
  const handleOpenEditProfile = (pharmacy: any, profile: CustomerFinancialProfile | null) => {
    const prof = profile || profiles[pharmacy.id];
    setSelectedPharmacy(pharmacy);
    setSelectedProfile(prof);
    setEditForm({
      paymentTermCode: prof?.paymentTermCode || "CASH",
      paymentTermDays: prof?.paymentTermDays || 0,
      financeNotes: prof?.financeNotes || "",
      active: prof?.active !== undefined ? prof.active : true
    });
    setIsEditModalOpen(true);
  };

  // Save Financial Profile
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPharmacy) return;

    setSavingProfile(true);
    try {
      const updated = await updateCustomerProfile(
        selectedPharmacy.id,
        editForm,
        currentUser?.id || "system",
        currentUser?.name || "Finance User",
        currentUser?.role || "Finance Officer"
      );
      setProfiles(prev => ({ ...prev, [selectedPharmacy.id]: updated }));
      if (selectedProfile?.pharmacyId === selectedPharmacy.id) {
        setSelectedProfile(updated);
      }
      setIsEditModalOpen(false);
    } catch (err) {
      console.error("[PROFILE_SAVE_ERROR]", err);
    } finally {
      setSavingProfile(false);
    }
  };

  // Save Adjustment Entry
  const handleSaveAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPharmacy || !adjAmount || Number(adjAmount) <= 0) return;

    setSavingAdj(true);
    try {
      await postAdjustmentEntry(
        selectedPharmacy.id,
        adjType,
        Number(adjAmount),
        adjNotes,
        currentUser?.id || "system",
        currentUser?.name || "Finance User"
      );
      // Refresh ledger & profile
      if (!auth.currentUser) throw new Error("AUTHENTICATION_REQUIRED");
      const result = await fetchScopedCommercialRead(auth.currentUser, { kind: "CUSTOMER_ACCOUNTS", pharmacyId: selectedPharmacy.id });
      const entries = result.ledger || [];
      setSelectedLedger(entries);
      const updatedProf = await getOrCreateCustomerProfile(selectedPharmacy.id, currentUser?.id, currentUser?.name);
      setSelectedProfile(updatedProf);
      setProfiles(prev => ({ ...prev, [selectedPharmacy.id]: updatedProf }));

      setIsAdjustmentModalOpen(false);
      setAdjAmount("");
      setAdjNotes("");
    } catch (err) {
      console.error("[ADJ_SAVE_ERROR]", err);
    } finally {
      setSavingAdj(false);
    }
  };

  return (
    <div className="space-y-6 pb-12 animate-fade-in font-sans">
      {/* HEADER BAR */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white flex items-center gap-2.5">
            <Building2 className="h-7 w-7 text-indigo-600 dark:text-indigo-400" />
            {isRtl ? "حسابات العملاء والذكاء المالي" : "Customer Accounts & Financial Intelligence"}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {isRtl 
              ? "سجل الفواتير، الذمم القائمة، تاريخ التحصيل، وتحليل الأعمار المالية دون حظر أو تقييد للطلبات (WP-FI-1.1)."
              : "Financial intelligence center: Invoice analytics, ledger history, collections, and ageing breakdown."}
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {isFinanceRole && maintenanceActionsAvailable && (
            <>
              <button
                onClick={handleReconcileVisitPayments}
                disabled={reconcilingVisitPayments}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 transition-colors cursor-pointer shadow-xs disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${reconcilingVisitPayments ? "animate-spin" : ""}`} />
                {isRtl ? "تسوية مدفوعات الزيارات" : "Reconcile Visit Payments"}
              </button>

              <button
                onClick={handleReconcile}
                disabled={reconciling}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 transition-colors cursor-pointer shadow-xs disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${reconciling ? "animate-spin" : ""}`} />
                {isRtl ? "تسوية فواتير الطلبات المسلمة" : "Reconcile Delivered Invoices"}
              </button>

              <button
                onClick={handleBootstrap}
                disabled={bootstrapping}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 transition-colors cursor-pointer shadow-xs disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${bootstrapping ? "animate-spin" : ""}`} />
                {isRtl ? "تهيئة البروفايلات المفقودة" : "Bootstrap Profiles"}
              </button>
            </>
          )}
        </div>
      </div>

      {/* VISIT PAYMENT RECONCILIATION REPORT BANNER */}
      {Object.keys(currencySummaryGroups).length > 1 && <div className="grid gap-3 md:grid-cols-2">{(Object.values(currencySummaryGroups) as Array<{ currency: string; totalInvoiced: number; totalCollected: number; totalOutstanding: number; totalOverdue: number; marketId: string }>).map(group => <div key={group.currency} className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><strong>{group.currency}</strong> · Invoiced {group.totalInvoiced.toLocaleString()} · Collected {group.totalCollected.toLocaleString()} · Outstanding {group.totalOutstanding.toLocaleString()} · Overdue {group.totalOverdue.toLocaleString()}</div>)}</div>}
      {visitPaymentReport && (
        <div className="bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 rounded-2xl p-4 text-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-bold text-purple-900 dark:text-purple-200 flex items-center gap-2">
              <CheckCircle2 size={16} className="text-purple-600" />
              {isRtl ? "تقرير تسوية مدفوعات زيارات الصيدليات" : "Pharmacy Visit Payment Reconciliation Report"}
            </span>
            <button onClick={() => setVisitPaymentReport(null)} className="text-slate-400 hover:text-slate-600">
              <X size={16} />
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-7 gap-2 text-slate-700 dark:text-slate-300 font-mono text-xxs">
            <div>Scanned: <strong>{visitPaymentReport.visitsScanned}</strong></div>
            <div>Eligible: <strong>{visitPaymentReport.eligibleVisits}</strong></div>
            <div>Payments Created: <strong className="text-purple-600">{visitPaymentReport.paymentsCreated}</strong></div>
            <div>Already Synced: <strong>{visitPaymentReport.alreadySynced}</strong></div>
            <div>Visits Linked: <strong>{visitPaymentReport.visitsLinked}</strong></div>
            <div>Skipped: <strong className="text-amber-600">{visitPaymentReport.skipped}</strong></div>
            <div>Failed: <strong className={visitPaymentReport.failed > 0 ? "text-rose-600 font-bold" : "text-slate-500"}>{visitPaymentReport.failed}</strong></div>
          </div>
          {visitPaymentReport.details && visitPaymentReport.details.length > 0 && (
            <div className="mt-2 p-2 bg-slate-100 dark:bg-slate-900 rounded-lg text-xxs font-mono max-h-32 overflow-y-auto space-y-1">
              {visitPaymentReport.details.map((dt: string, i: number) => (
                <div key={i} className="text-slate-600 dark:text-slate-400">{dt}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* RECONCILIATION REPORT BANNER */}
      {reconcileReport && (
        <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-2xl p-4 text-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-bold text-emerald-900 dark:text-emerald-200 flex items-center gap-2">
              <CheckCircle2 size={16} className="text-emerald-600" />
              {isRtl ? "تقرير تسوية فواتير الطلبات المسلمة" : "Delivered Invoice Reconciliation Report"}
            </span>
            <button onClick={() => setReconcileReport(null)} className="text-slate-400 hover:text-slate-600">
              <X size={16} />
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-7 gap-2 text-slate-700 dark:text-slate-300 font-mono text-xxs">
            <div>Scanned: <strong>{reconcileReport.deliveredOrdersScanned}</strong></div>
            <div>Eligible: <strong>{reconcileReport.eligibleOrders}</strong></div>
            <div>Already Posted: <strong>{reconcileReport.alreadyPosted}</strong></div>
            <div>New Invoices: <strong className="text-emerald-600">{reconcileReport.newInvoiceEntriesCreated}</strong></div>
            <div>Profiles Updated: <strong>{reconcileReport.profilesRecalculated}</strong></div>
            <div>Skipped: <strong className="text-amber-600">{reconcileReport.invalidOrdersSkipped}</strong></div>
            <div>Failed: <strong className={reconcileReport.failedOrders > 0 ? "text-rose-600 font-bold" : "text-slate-500"}>{reconcileReport.failedOrders}</strong></div>
          </div>
          {reconcileReport.details && reconcileReport.details.length > 0 && (
            <div className="mt-2 p-2 bg-slate-100 dark:bg-slate-900 rounded-lg text-xxs font-mono max-h-32 overflow-y-auto space-y-1">
              {reconcileReport.details.map((dt: string, i: number) => (
                <div key={i} className="text-slate-600 dark:text-slate-400">{dt}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* BOOTSTRAP REPORT BANNER */}
      {bootstrapReport && (
        <div className="bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 rounded-2xl p-4 text-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-bold text-indigo-900 dark:text-indigo-200 flex items-center gap-2">
              <CheckCircle2 size={16} className="text-indigo-600" />
              {isRtl ? "تقرير تهيئة الحسابات المالية" : "Financial Profile Bootstrap Report"}
            </span>
            <button onClick={() => setBootstrapReport(null)} className="text-slate-400 hover:text-slate-600">
              <X size={16} />
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-slate-700 dark:text-slate-300 font-mono text-xxs">
            <div>Scanned: <strong>{bootstrapReport.pharmaciesScanned}</strong></div>
            <div>Created: <strong className="text-emerald-600">{bootstrapReport.profilesCreated}</strong></div>
            <div>Preserved: <strong>{bootstrapReport.profilesPreserved}</strong></div>
            <div>Failed: <strong className="text-rose-600">{bootstrapReport.profilesFailed}</strong></div>
          </div>
        </div>
      )}

      {/* FINANCIAL SUMMARY CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Card 1: Total Customers */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-xs space-y-1">
          <span className="text-xxs font-bold uppercase tracking-wider text-slate-400 block">
            {isRtl ? "إجمالي العملاء" : "Total Customers"}
          </span>
          <div className="text-2xl font-black text-slate-900 dark:text-white">
            {summaryCards.totalCustomers}
          </div>
          <span className="text-[10px] text-slate-500 block">
            {isRtl ? "صيدليات معتمدة بالنظام" : "Registered Pharmacies"}
          </span>
        </div>

        {/* Card 2: Total Invoiced */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-xs space-y-1">
          <span className="text-xxs font-bold uppercase tracking-wider text-slate-400 block">
            {isRtl ? "إجمالي الفواتير" : "Total Invoiced"}
          </span>
          <div className="text-2xl font-black text-blue-600 dark:text-blue-400">
            {formatProfileMoney(summaryCards.totalInvoiced)}
          </div>
          <span className="text-[10px] text-slate-500 block">
            {isRtl ? "القيمة الإجمالية للفواتير الصادرة" : "Gross Commercial Invoices"}
          </span>
        </div>

        {/* Card 3: Total Collected */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-xs space-y-1">
          <span className="text-xxs font-bold uppercase tracking-wider text-slate-400 block">
            {isRtl ? "إجمالي المحصل" : "Total Collected"}
          </span>
          <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400">
            {formatProfileMoney(summaryCards.totalCollected)}
          </div>
          <span className="text-[10px] text-slate-500 block">
            {isRtl ? `نسبة التحصيل: ${summaryCards.collectionRate}%` : `Collection Rate: ${summaryCards.collectionRate}%`}
          </span>
        </div>

        {/* Card 4: Total Outstanding */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-xs space-y-1">
          <span className="text-xxs font-bold uppercase tracking-wider text-slate-400 block">
            {isRtl ? "إجمالي المديونية القائمة" : "Total Outstanding"}
          </span>
          <div className="text-2xl font-black text-indigo-600 dark:text-indigo-400">
            {formatProfileMoney(summaryCards.totalOutstanding)}
          </div>
          <span className="text-[10px] text-slate-500 block">
            {isRtl ? "الرصيد القائم بالدفتر" : "Open Accounts Receivable"}
          </span>
        </div>

        {/* Card 5: Total Overdue */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-xs space-y-1">
          <span className="text-xxs font-bold uppercase tracking-wider text-slate-400 block">
            {isRtl ? "إجمالي المتأخرات" : "Total Overdue"}
          </span>
          <div className="text-2xl font-black text-rose-600 dark:text-rose-400">
            {formatProfileMoney(summaryCards.totalOverdue)}
          </div>
          <span className="text-[10px] text-slate-500 block">
            {isRtl ? "فواتير تجاوزت فترة الاستحقاق" : "Past Payment Terms"}
          </span>
        </div>
      </div>

      {/* SEARCH AND FILTERS TOOLBAR */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-3 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Search Box */}
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 rtl:right-3 rtl:left-auto top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={isRtl ? "بحث باسم الصيدلية، رقم الحساب CUS-LY-xxx، أو المدينة..." : "Search pharmacy, CUS-LY account #, city..."}
              className="w-full pl-9 rtl:pr-9 rtl:pl-3 pr-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 outline-none text-slate-900 dark:text-white"
            />
          </div>

          {/* Payment Term Filter */}
          <div className="flex items-center gap-2">
            <Sliders className="h-4 w-4 text-slate-400" />
            <select
              value={termFilter}
              onChange={e => setTermFilter(e.target.value)}
              className="px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300 outline-none"
            >
              <option value="ALL">{isRtl ? "جميع شروط الدفع" : "All Payment Terms"}</option>
              <option value="CASH">CASH (نقدي)</option>
              <option value="NET_7">NET 7</option>
              <option value="NET_15">NET 15</option>
              <option value="NET_30">NET 30</option>
              <option value="NET_45">NET 45</option>
              <option value="NET_60">NET 60</option>
              <option value="NET_90">NET 90</option>
              <option value="CUSTOM">CUSTOM</option>
            </select>
          </div>
        </div>
      </div>

      {/* CUSTOMER ACCOUNTS TABLE */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left rtl:text-right border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-mono uppercase text-xxs">
                <th className="p-3.5 font-bold">{isRtl ? "رقم الحساب" : "Account #"}</th>
                <th className="p-3.5 font-bold">{isRtl ? "اسم الصيدلية" : "Pharmacy Name"}</th>
                <th className="p-3.5 font-bold">{isRtl ? "المنطقة / المدينة" : "Area / City"}</th>
                <th className="p-3.5 font-bold">{isRtl ? "شرط الدفع" : "Payment Terms"}</th>
                <th className="p-3.5 font-bold text-right rtl:text-left">{isRtl ? "إجمالي الفواتير" : "Total Invoiced"}</th>
                <th className="p-3.5 font-bold text-right rtl:text-left">{isRtl ? "إجمالي المحصل" : "Total Collected"}</th>
                <th className="p-3.5 font-bold text-right rtl:text-left">{isRtl ? "الرصيد القائم" : "Outstanding Balance"}</th>
                <th className="p-3.5 font-bold text-right rtl:text-left">{isRtl ? "المتأخرات" : "Overdue"}</th>
                <th className="p-3.5 font-bold text-center">{isRtl ? "نسبة التحصيل" : "Collection %"}</th>
                <th className="p-3.5 font-bold text-center">{isRtl ? "الإجراءات" : "Actions"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
              {loading ? (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-slate-400">
                    <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-indigo-600" />
                    {isRtl ? "جاري تحميل سجلات الحسابات..." : "Loading customer accounts..."}
                  </td>
                </tr>
              ) : loadError ? (
                <tr><td colSpan={10} className="p-8 text-center text-rose-600" data-testid="customer-accounts-load-error">{isRtl ? "تعذر تحميل حسابات العملاء المعتمدة." : `Unable to load canonical customer accounts: ${loadError}`}</td></tr>
              ) : filteredAccounts.length === 0 ? (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-slate-400">
                    {isRtl ? "لا توجد صيدليات مطابقة لفلاتر البحث الحالية." : "No customer accounts found matching criteria."}
                  </td>
                </tr>
              ) : (
                filteredAccounts.map(pharmacy => {
                  const profile = profiles[pharmacy.id];
                  const accNum = profile?.customerAccountNumber || "PENDING";
                  const termCode = profile?.paymentTermCode || "CASH";
                  const totalInvoiced = profile?.totalInvoiced || 0;
                  const totalCollected = profile?.totalCollected || 0;
                  const outstanding = profile?.outstandingBalance || 0;
                  const overdue = profile?.overdueBalance || 0;
                  const collRate = profile?.collectionRate ?? (totalInvoiced > 0 ? Math.round((totalCollected / totalInvoiced) * 100) : 100);

                  return (
                    <tr key={pharmacy.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                      <td className="p-3.5 font-mono text-xxs font-bold text-indigo-600 dark:text-indigo-400">
                        {accNum}
                      </td>
                      <td className="p-3.5 font-bold text-slate-900 dark:text-white">
                        {pharmacy.name || pharmacy.pharmacyName}
                      </td>
                      <td className="p-3.5 text-slate-500 dark:text-slate-400 text-xxs">
                        {pharmacy.area || pharmacy.city || "—"}
                      </td>
                      <td className="p-3.5 font-mono text-xxs font-semibold">
                        {termCode === "CUSTOM" ? `CUSTOM (${profile?.paymentTermDays || 0}d)` : termCode}
                      </td>
                      <td className="p-3.5 text-right rtl:text-left font-mono font-semibold text-blue-600 dark:text-blue-400">
                        {formatProfileMoney(totalInvoiced, profile)}
                      </td>
                      <td className="p-3.5 text-right rtl:text-left font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                        {formatProfileMoney(totalCollected, profile)}
                      </td>
                      <td className="p-3.5 text-right rtl:text-left font-mono font-bold text-indigo-700 dark:text-indigo-300">
                        {formatProfileMoney(outstanding, profile)}
                      </td>
                      <td className="p-3.5 text-right rtl:text-left font-mono font-bold text-rose-600 dark:text-rose-400">
                        {formatProfileMoney(overdue, profile)}
                      </td>
                      <td className="p-3.5 text-center font-mono font-bold">
                        <span className={`px-2 py-0.5 rounded-full text-xxs ${collRate >= 80 ? "bg-emerald-50 text-emerald-700" : collRate >= 50 ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700"}`}>
                          {collRate}%
                        </span>
                      </td>
                      <td className="p-3.5 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleViewAccount(pharmacy)}
                            title={isRtl ? "عرض تفاصيل الحساب والدفتر" : "View Account & Ledger"}
                            className="p-1.5 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 dark:bg-slate-800 dark:hover:bg-indigo-950/50 rounded-lg text-slate-600 dark:text-slate-300 cursor-pointer transition-colors"
                          >
                            <Eye size={15} />
                          </button>
                          {canEditProfile && (
                            <button
                              type="button"
                              onClick={() => handleOpenEditProfile(pharmacy, profile)}
                              title={isRtl ? "تعديل الملاحظات وشروط الدفع" : "Edit Terms & Notes"}
                              className="p-1.5 bg-slate-100 hover:bg-blue-50 hover:text-blue-600 dark:bg-slate-800 dark:hover:bg-blue-950/50 rounded-lg text-slate-600 dark:text-slate-300 cursor-pointer transition-colors"
                            >
                              <Edit3 size={15} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* CUSTOMER ACCOUNT DETAILS & LEDGER DRAWER / MODAL */}
      {isDetailsOpen && selectedPharmacy && createPortal(
        <div 
          className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 z-[99999] animate-fade-in"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsDetailsOpen(false);
          }}
        >
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-5xl w-full p-6 space-y-6 shadow-2xl relative max-h-[92vh] overflow-y-auto z-[100000]">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
              <div>
                <span className="text-xxs font-mono font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider block">
                  {selectedProfile?.customerAccountNumber || "CUS-LY-ACCOUNT"}
                </span>
                <h2 className="text-xl font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-indigo-600" />
                  {selectedPharmacy.name || selectedPharmacy.pharmacyName}
                </h2>
              </div>
              <div className="flex items-center gap-2">
                {isFinanceRole && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsAdjustmentModalOpen(true);
                    }}
                    className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Plus size={14} />
                    {isRtl ? "إضافة تسوية مالية" : "New Adjustment"}
                  </button>
                )}
                {canEditProfile && (
                  <button
                    type="button"
                    onClick={() => handleOpenEditProfile(selectedPharmacy, selectedProfile)}
                    className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Edit3 size={14} />
                    {isRtl ? "تعديل الملاحظات والشروط" : "Edit Profile"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setIsDetailsOpen(false)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Profile Overview & Analytics Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Box 1: Customer Identity */}
              <div className="p-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 rounded-2xl space-y-2 text-xs">
                <span className="font-mono text-xxs font-bold uppercase text-slate-400 block">{isRtl ? "هوية العميل" : "Customer Identity"}</span>
                <div><span className="text-slate-500">{isRtl ? "اسم الصيدلية:" : "Name:"}</span> <strong>{selectedPharmacy.name}</strong></div>
                <div><span className="text-slate-500">{isRtl ? "العنوان:" : "Address:"}</span> {selectedPharmacy.address || selectedPharmacy.area || "—"}</div>
                <div><span className="text-slate-500">{isRtl ? "رقم الهاتف:" : "Phone:"}</span> {selectedPharmacy.phone || "N/A"}</div>
                <div><span className="text-slate-500">{isRtl ? "شرط الدفع:" : "Payment Terms:"}</span> <strong>{selectedProfile?.paymentTermCode || "CASH"}</strong> ({selectedProfile?.paymentTermDays || 0} days)</div>
              </div>

              {/* Box 2: Invoicing & Collections */}
              <div className="p-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 rounded-2xl space-y-2 text-xs">
                <span className="font-mono text-xxs font-bold uppercase text-slate-400 block">{isRtl ? "الفواتير والتحصيل" : "Invoicing & Performance"}</span>
                <div><span className="text-slate-500">{isRtl ? "إجمالي الفواتير:" : "Total Invoiced:"}</span> <strong className="text-blue-600">{formatProfileMoney(selectedProfile?.totalInvoiced || 0, selectedProfile)}</strong></div>
                <div><span className="text-slate-500">{isRtl ? "إجمالي المحصل:" : "Total Collected:"}</span> <strong className="text-emerald-600">{formatProfileMoney(selectedProfile?.totalCollected || 0, selectedProfile)}</strong></div>
                <div><span className="text-slate-500">{isRtl ? "نسبة التحصيل:" : "Collection Rate:"}</span> <strong>{selectedProfile?.collectionRate ?? 100}%</strong></div>
                <div><span className="text-slate-500">{isRtl ? "الفواتير القائمة:" : "Open Invoices:"}</span> <strong>{selectedProfile?.openInvoiceCount || 0}</strong></div>
              </div>

              {/* Box 3: Exposure Summary */}
              <div className="p-4 bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-900 rounded-2xl space-y-2 text-xs">
                <span className="font-mono text-xxs font-bold uppercase text-indigo-600 dark:text-indigo-400 block">{isRtl ? "ملخص التعرض المالي" : "Financial Exposure"}</span>
                <div className="flex justify-between">
                  <span className="text-slate-600 dark:text-slate-400">{isRtl ? "الرصيد القائم:" : "Outstanding:"}</span>
                  <strong className="text-indigo-700 dark:text-indigo-300 font-mono text-sm">{formatProfileMoney(selectedProfile?.outstandingBalance || 0, selectedProfile)}</strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600 dark:text-slate-400">{isRtl ? "المتأخرات:" : "Overdue Balance:"}</span>
                  <strong className="text-rose-600 font-mono text-sm">{formatProfileMoney(selectedProfile?.overdueBalance || 0, selectedProfile)}</strong>
                </div>
                <div className="flex justify-between text-xxs pt-1 text-slate-500 border-t border-indigo-200/50">
                  <span>{isRtl ? "تاريخ أقدم فاتورة قائمة:" : "Oldest Open Invoice:"}</span>
                  <span className="font-mono font-semibold">{selectedProfile?.oldestOpenInvoiceDate || "N/A"}</span>
                </div>
              </div>
            </div>

            {/* LEDGER HISTORY TABLE */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                  <FileText className="h-4 w-4 text-indigo-600" />
                  {isRtl ? "دفتر أستاذ العميل (Append-Only Customer Ledger)" : "Customer Ledger History"}
                </h3>
                <span className="text-xxs text-slate-400 font-mono">
                  {selectedLedger.length} {isRtl ? "قيود مسجلة" : "entries recorded"}
                </span>
              </div>

              <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden bg-white dark:bg-slate-900">
                <div className="overflow-x-auto max-h-[400px]">
                  <table className="w-full text-left rtl:text-right border-collapse text-xs">
                    <thead className="sticky top-0 bg-slate-100 dark:bg-slate-800 z-10">
                      <tr className="border-b border-slate-200 dark:border-slate-700 text-slate-500 font-mono text-xxs uppercase">
                        <th className="p-3 font-bold">{isRtl ? "التاريخ" : "Posting Date"}</th>
                        <th className="p-3 font-bold">{isRtl ? "نوع المعاملة" : "Transaction Type"}</th>
                        <th className="p-3 font-bold">{isRtl ? "رقم المرجع" : "Reference"}</th>
                        <th className="p-3 font-bold">{isRtl ? "الوصف" : "Description"}</th>
                        <th className="p-3 font-bold text-right rtl:text-left">{isRtl ? "مدين (+)" : "Debit (+)"}</th>
                        <th className="p-3 font-bold text-right rtl:text-left">{isRtl ? "دائن (-)" : "Credit (-)"}</th>
                        <th className="p-3 font-bold text-right rtl:text-left">{isRtl ? "الرصيد التراكمي" : "Running Balance"}</th>
                        <th className="p-3 font-bold text-center">{isRtl ? "تاريخ الاستحقاق" : "Due Date"}</th>
                        <th className="p-3 font-bold text-center">{isRtl ? "الحالة" : "Status"}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-sans text-xxs">
                      {loadingLedger ? (
                        <tr>
                          <td colSpan={9} className="p-6 text-center text-slate-400">
                            <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-1 text-indigo-600" />
                            {isRtl ? "جاري جلب قيود الدفتر..." : "Loading customer ledger history..."}
                          </td>
                        </tr>
                      ) : selectedLedger.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="p-6 text-center text-slate-400">
                            {isRtl ? "لا توجد قيود مالية مسجلة لهذا العميل حتى الآن." : "No ledger entries recorded for this account."}
                          </td>
                        </tr>
                      ) : (
                        selectedLedger.map((entry) => (
                          <tr key={entry.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                            <td className="p-3 font-mono font-semibold">{entry.postingDate}</td>
                            <td className="p-3 font-bold">
                              <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-mono ${
                                entry.transactionType === "INVOICE" ? "bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300" :
                                entry.transactionType === "ADJUSTMENT_DEBIT" ? "bg-purple-50 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300" :
                                "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                              }`}>
                                {entry.transactionType}
                              </span>
                            </td>
                            <td className="p-3 font-mono font-bold text-indigo-600 dark:text-indigo-400">
                              {entry.invoiceNumber || entry.orderNumber || entry.sourceId || "-"}
                            </td>
                            <td className="p-3 max-w-xs truncate text-slate-600 dark:text-slate-300" title={entry.description}>
                              {entry.description}
                            </td>
                            <td className="p-3 text-right rtl:text-left font-mono font-bold text-indigo-700 dark:text-indigo-300">
                              {entry.debitAmount > 0 ? formatProfileMoney(entry.debitAmount, selectedProfile) : "-"}
                            </td>
                            <td className="p-3 text-right rtl:text-left font-mono font-bold text-emerald-600 dark:text-emerald-400">
                              {entry.creditAmount > 0 ? formatProfileMoney(entry.creditAmount, selectedProfile) : "-"}
                            </td>
                            <td className="p-3 text-right rtl:text-left font-mono font-extrabold text-slate-900 dark:text-white">
                              {formatProfileMoney(entry.runningBalance || 0, selectedProfile)}
                            </td>
                            <td className="p-3 text-center font-mono text-slate-500">
                              {entry.dueDate || "-"}
                            </td>
                            <td className="p-3 text-center font-mono">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${entry.status === "POSTED" ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`}>
                                {entry.status}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* EDIT FINANCIAL PROFILE MODAL */}
      {isEditModalOpen && selectedPharmacy && createPortal(
        <div 
          className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 z-[99999] animate-fade-in"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsEditModalOpen(false);
          }}
        >
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-2xl relative max-h-[90vh] overflow-y-auto z-[100000]">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="font-extrabold text-base text-slate-900 dark:text-white flex items-center gap-2">
                <Edit3 className="h-5 w-5 text-indigo-600" />
                {isRtl ? "تعديل الشروط والملاحظات المالية" : "Edit Payment Terms & Finance Notes"}
              </h3>
              <button onClick={() => setIsEditModalOpen(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveProfile} className="space-y-4 text-xs">
              <div className="bg-slate-50 dark:bg-slate-800/60 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                <span className="text-xxs font-mono text-slate-400 block">{selectedProfile?.customerAccountNumber}</span>
                <strong className="text-sm font-bold text-slate-900 dark:text-white">{selectedPharmacy.name}</strong>
              </div>

              {/* Payment Terms Selector */}
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  {isRtl ? "شرط الدفع المعياري (Payment Terms)" : "Payment Terms"}
                </label>
                <select
                  value={editForm.paymentTermCode}
                  onChange={e => setEditForm(f => ({ ...f, paymentTermCode: e.target.value as PaymentTermCode }))}
                  className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-bold outline-none text-slate-900 dark:text-white"
                >
                  <option value="CASH">CASH (دفع نقدي فوري)</option>
                  <option value="NET_7">NET 7 (7 أيام)</option>
                  <option value="NET_15">NET 15 (15 يوماً)</option>
                  <option value="NET_30">NET 30 (30 يوماً)</option>
                  <option value="NET_45">NET 45 (45 يوماً)</option>
                  <option value="NET_60">NET 60 (60 يوماً)</option>
                  <option value="NET_90">NET 90 (90 يوماً)</option>
                  <option value="CUSTOM">CUSTOM (أيام مخصصة)</option>
                </select>
              </div>

              {/* Custom Term Days */}
              {editForm.paymentTermCode === "CUSTOM" && (
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    {isRtl ? "عدد الأيام المخصصة (Custom Term Days)" : "Custom Term Days"}
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={editForm.paymentTermDays}
                    onChange={e => setEditForm(f => ({ ...f, paymentTermDays: Number(e.target.value) }))}
                    className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-bold outline-none text-slate-900 dark:text-white"
                  />
                </div>
              )}

              {/* Active Toggle */}
              <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
                <span className="font-bold text-slate-700 dark:text-slate-300">{isRtl ? "حساب مالي نشط" : "Active Financial Profile"}</span>
                <input
                  type="checkbox"
                  checked={editForm.active}
                  onChange={e => setEditForm(f => ({ ...f, active: e.target.checked }))}
                  className="w-5 h-5 accent-indigo-600 cursor-pointer"
                />
              </div>

              {/* Finance Notes */}
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  {isRtl ? "ملاحظات وتوجيهات التحصيل" : "Finance & Collection Notes"}
                </label>
                <textarea
                  rows={3}
                  value={editForm.financeNotes}
                  onChange={e => setEditForm(f => ({ ...f, financeNotes: e.target.value }))}
                  placeholder={isRtl ? "ملاحظات وتوجيهات الإدارة المالية الخاصة بالعميل..." : "Internal collection notes & directives..."}
                  className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-normal outline-none text-slate-900 dark:text-white"
                />
              </div>

              {/* Policy Banner */}
              <div className="p-3 bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-xl text-xxs text-blue-800 dark:text-blue-300 space-y-1">
                <strong>{isRtl ? "سياسة البيانات المالية (MENAREPS 2.0 WP-FI-1.1):" : "MENAREPS 2.0 WP-FI-1.1 Policy:"}</strong>
                <p>
                  {isRtl 
                    ? "البيانات المالية وملاحظات التحصيل مخصصة لأغراض التحليل والتسجيل والتقرير فقط، ولا تؤثر مطلقاً على دورة الطلبات التجارية."
                    : "Financial data is for collection history and analytics only. Orders are never blocked by financial balances."}
                </p>
              </div>

              {/* Action Buttons */}
              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl font-bold cursor-pointer"
                >
                  {isRtl ? "إلغاء" : "Cancel"}
                </button>
                <button
                  type="submit"
                  disabled={savingProfile}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {savingProfile && <RefreshCw size={14} className="animate-spin" />}
                  {isRtl ? "حفظ التغييرات" : "Save Profile"}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* MANUAL ADJUSTMENT ENTRY MODAL */}
      {isAdjustmentModalOpen && selectedPharmacy && createPortal(
        <div 
          className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 z-[99999] animate-fade-in"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsAdjustmentModalOpen(false);
          }}
        >
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl relative max-h-[90vh] overflow-y-auto z-[100000]">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="font-extrabold text-base text-slate-900 dark:text-white flex items-center gap-2">
                <Plus className="h-5 w-5 text-indigo-600" />
                {isRtl ? "إضافة تسوية مالية بالحساب" : "New Adjustment Entry"}
              </h3>
              <button onClick={() => setIsAdjustmentModalOpen(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveAdjustment} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">{isRtl ? "نوع التسوية" : "Adjustment Type"}</label>
                <select
                  value={adjType}
                  onChange={e => setAdjType(e.target.value as any)}
                  className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-bold outline-none text-slate-900 dark:text-white"
                >
                  <option value="ADJUSTMENT_DEBIT">ADJUSTMENT_DEBIT (مدين - زيادة المديونية)</option>
                  <option value="ADJUSTMENT_CREDIT">ADJUSTMENT_CREDIT (دائن - تخفيض المديونية)</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">{isRtl ? "المبلغ (عملة السوق)" : "Amount (market currency)"}</label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  value={adjAmount}
                  onChange={e => setAdjAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-bold text-indigo-600 outline-none"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">{isRtl ? "سبب التسوية ووصف القيد" : "Description & Reason"}</label>
                <textarea
                  rows={2}
                  required
                  value={adjNotes}
                  onChange={e => setAdjNotes(e.target.value)}
                  placeholder={isRtl ? "سبب قيد التسوية المعتمد..." : "Authorized adjustment description..."}
                  className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none text-slate-900 dark:text-white"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAdjustmentModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 rounded-xl font-bold cursor-pointer"
                >
                  {isRtl ? "إلغاء" : "Cancel"}
                </button>
                <button
                  type="submit"
                  disabled={savingAdj}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {savingAdj && <RefreshCw size={14} className="animate-spin" />}
                  {isRtl ? "ترحيل التسوية" : "Post Adjustment"}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
