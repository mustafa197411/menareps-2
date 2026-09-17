import { reverseCollection, fetchCollectionReversal } from "../../lib/collectionReversalClient";
import type { CollectionReversalRecord } from "../../features/ar/arTypes";
import { verifyCollection } from "../../lib/collectionVerificationClient";
import { doc, onSnapshot } from "firebase/firestore";
import { permitsCollection, type CollectionRestrictions } from "../../lib/collectionPermissions";
import { getCapabilitiesForRole } from "../../features/orders/orderWorkflowEngine";
import { submitCollection } from "../../lib/collectionSubmissionClient";
import React, { useState, useEffect, useMemo } from "react";
import { 
  Building2, 
  Search, 
  Filter, 
  RefreshCw, 
  Plus, 
  X, 
  DollarSign, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  FileText, 
  Eye, 
  Edit3, 
  CreditCard, 
  BarChart3, 
  Calendar, 
  Shield, 
  AlertTriangle,
  UserCheck,
  MapPin,
  Image as ImageIcon,
  ExternalLink,
  Download
} from "lucide-react";
import { auth, db } from "../../lib/firebase";
import { normalizeRole, Role } from "../../types";
import { 
  PaymentCollection, 
  PaymentMethod, 
  PaymentStatus, 
  PaymentSummaryReport 
} from "../../features/ar/arTypes";
import { 
  rejectPaymentCollection, 
  correctPaymentCollection, 
  generatePaymentSummaryReportsByCurrency,
  CreatePaymentInput 
} from "../../features/ar/paymentService";
import { useModalScrollLock } from "../../lib/scrollLock";
import { fetchScopedCommercialRead } from "../../lib/commercialReadClient";
import { formatCurrencyForIdentity } from "../../lib/marketSettings";
import { resolveFinancialIdentity } from "../../lib/financialIdentity";

interface PaymentCollectionPageProps {
  currentUser: any;
  lang: "en" | "ar";
}

export default function PaymentCollectionPage({
  currentUser,
  lang
}: PaymentCollectionPageProps) {
  const isRtl = lang === "ar";
  const userRole = normalizeRole(currentUser?.role);

  // Role checks
  const isFinanceRole = userRole === Role.FINANCE_MANAGER || userRole === Role.FINANCE || userRole === Role.SUPER_ADMIN || userRole === Role.ADMIN || userRole === Role.GENERAL_MANAGER;
  const [verificationRestrictions, setVerificationRestrictions] = useState<CollectionRestrictions | null>(null);
  useEffect(() => {
    setVerificationRestrictions(null);
    return onSnapshot(doc(db, "rolePermissions", userRole), snapshot => setVerificationRestrictions(snapshot.data() || {}), () => setVerificationRestrictions(null));
  }, [userRole]);
  const canVerify = verificationRestrictions !== null && permitsCollection(userRole, "approve", verificationRestrictions)
    && getCapabilitiesForRole(userRole).includes("ORDER_FINANCE_APPROVE");
  const canReverse = verificationRestrictions !== null && permitsCollection(userRole, "reverse", verificationRestrictions);
  const isRepRole = userRole === Role.MEDICAL_REP || userRole === Role.SALES_REP;

  // View state
  const [activeTab, setActiveTab] = useState<"list" | "reports">("list");
  const [loading, setLoading] = useState(true);
  const [payments, setPayments] = useState<PaymentCollection[]>([]);
  const [pharmacies, setPharmacies] = useState<any[]>([]);

  // Search and Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<PaymentStatus | "ALL">("ALL");
  const [methodFilter, setMethodFilter] = useState<PaymentMethod | "ALL">("ALL");
  const [startDateFilter, setStartDateFilter] = useState("");
  const [endDateFilter, setEndDateFilter] = useState("");
  const [repFilter, setRepFilter] = useState("ALL");
  const [pharmacyFilter, setPharmacyFilter] = useState("ALL");

  // Selected Payment Modal / Details
  const [selectedPayment, setSelectedPayment] = useState<PaymentCollection | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [reversalState, setReversalState] = useState<{ collectionId: string; reversal: CollectionReversalRecord | null } | null>(null);
  const [reversalReason, setReversalReason] = useState("");
  const [reversalError, setReversalError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setReversalState(null);
    setReversalReason("");
    setReversalError("");
    if (isDetailsOpen && selectedPayment?.status === "Verified" && selectedPayment.revision === 2 && auth.currentUser) {
      const id = selectedPayment.paymentId;
      fetchCollectionReversal(auth.currentUser, id, selectedPayment.revision).then(result => {
        if (!cancelled) setReversalState({ collectionId: id, reversal: result.reversal });
      }).catch(error => {
        if (!cancelled) setReversalError(error.message || "COLLECTION_REVERSAL_FAILED");
      });
    }
    return () => { cancelled = true; };
  }, [isDetailsOpen, selectedPayment?.paymentId, selectedPayment?.status, selectedPayment?.revision]);


  // Record Payment Modal
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [requestKey, setRequestKey] = useState("");
  const [createError, setCreateError] = useState("");
  const [formData, setFormData] = useState<CreatePaymentInput>({
    pharmacyId: "",
    pharmacyName: "",
    amount: 0,
    collectionDate: new Date().toISOString().split("T")[0],
    paymentMethod: "Cash",
    receiptNumber: "",
    chequeNumber: "",
    chequeBankName: "",
    chequeDate: new Date().toISOString().split("T")[0],
    chequeImageUrl: "",
    transferBankName: "",
    transferReference: "",
    transferProofUrl: "",
    notes: "",
    attachmentUrls: [],
    representativeUid: currentUser?.id || "",
    representativeName: currentUser?.name || ""
  });

  // Action states for Finance (Verify / Reject / Correct)
  const [actionLoading, setActionLoading] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [actionSuccessMessage, setActionSuccessMessage] = useState("");

  // Edit / Correct Modal
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<Partial<PaymentCollection>>({});

  useModalScrollLock(isDetailsOpen || isCreateOpen || isEditOpen);

  // Load Initial Data
  const fetchData = async () => {
    setLoading(true);
    try {
      if (!auth.currentUser) throw new Error("AUTHENTICATION_REQUIRED");
      const result = await fetchScopedCommercialRead(auth.currentUser, { kind: "PAYMENTS" });
      setPharmacies(result.pharmacies || []);
      setPayments(result.payments || []);
    } catch (err) {
      console.error("[PAYMENT_PAGE_ERROR] Error loading payments:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Filtered Payments
  const filteredPayments = useMemo(() => {
    return payments.filter((p) => {
      // Search
      const queryLower = searchQuery.toLowerCase().trim();
      if (queryLower) {
        const matchesNum = p.paymentNumber?.toLowerCase().includes(queryLower);
        const matchesPharm = p.pharmacyName?.toLowerCase().includes(queryLower);
        const matchesRep = p.representativeName?.toLowerCase().includes(queryLower);
        const matchesRef = p.referenceNumber?.toLowerCase().includes(queryLower);
        const matchesAcc = p.customerAccountNumber?.toLowerCase().includes(queryLower);
        if (!matchesNum && !matchesPharm && !matchesRep && !matchesRef && !matchesAcc) {
          return false;
        }
      }

      // Status
      if (statusFilter !== "ALL" && p.status !== statusFilter) return false;

      // Method
      if (methodFilter !== "ALL" && p.paymentMethod !== methodFilter) return false;

      // Date Range
      if (startDateFilter && p.collectionDate < startDateFilter) return false;
      if (endDateFilter && p.collectionDate > endDateFilter) return false;

      // Representative
      if (repFilter !== "ALL" && p.representativeUid !== repFilter) return false;

      // Pharmacy
      if (pharmacyFilter !== "ALL" && p.pharmacyId !== pharmacyFilter) return false;

      return true;
    });
  }, [payments, searchQuery, statusFilter, methodFilter, startDateFilter, endDateFilter, repFilter, pharmacyFilter]);

  // Aggregated Summary Report
  const reportsByCurrency = useMemo(() => {
    return generatePaymentSummaryReportsByCurrency(filteredPayments);
  }, [filteredPayments]);
  const reportEntries = Object.entries(reportsByCurrency) as Array<[string, PaymentSummaryReport]>;
  const reports: PaymentSummaryReport = reportEntries.length === 1 ? reportEntries[0][1] : generatePaymentSummaryReportsByCurrency([]).__none || {
    totalCollected: 0, totalPaymentsCount: 0, byStatus: { Submitted: 0, Verified: 0, Rejected: 0, Corrected: 0 }, countByMethod: { Cash: 0, Cheque: 0, "Bank Transfer": 0, Other: 0 }, amountByMethod: { Cash: 0, Cheque: 0, "Bank Transfer": 0, Other: 0 }, byRepresentative: {}, byPharmacy: {}, byArea: {}, byMonth: {}
  };
  const formatPaymentMoney = (amount: number, payment?: PaymentCollection) => {
    const identity = payment ? resolveFinancialIdentity([payment]) : null;
    try { return formatCurrencyForIdentity(amount, { marketId: identity?.marketId }); }
    catch { return isRtl ? "إعدادات السوق مطلوبة" : "Market configuration required"; }
  };

  // Unique lists for filter dropdowns
  const uniqueReps = useMemo(() => {
    const map = new Map<string, string>();
    payments.forEach((p) => {
      if (p.representativeUid) map.set(p.representativeUid, p.representativeName || p.representativeUid);
    });
    return Array.from(map.entries()).map(([uid, name]) => ({ uid, name }));
  }, [payments]);

  const uniquePharmacies = useMemo(() => {
    const map = new Map<string, string>();
    payments.forEach((p) => {
      if (p.pharmacyId) map.set(p.pharmacyId, p.pharmacyName || p.pharmacyId);
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [payments]);

  // Handle Pharmacy Selection in Create Form
  const handlePharmacySelect = (pharmacyId: string) => {
    const found = pharmacies.find((p) => p.id === pharmacyId);
    setFormData((prev) => ({
      ...prev,
      pharmacyId,
      pharmacyName: found?.name || found?.pharmacyName || "",
      areaId: found?.areaId || found?.area || "",
      areaName: found?.areaName || found?.area || "",
      cityId: found?.cityId || found?.city || "",
      cityName: found?.cityName || found?.city || ""
    }));
  };

  // Submit Create Payment
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError("");

    if (!formData.pharmacyId) {
      setCreateError(isRtl ? "يرجى اختيار الصيدلية." : "Please select a pharmacy.");
      return;
    }

    if (!formData.amount || formData.amount <= 0) {
      setCreateError(isRtl ? "المبلغ يجب أن يكون أكبر من صفر." : "Amount must be greater than zero.");
      return;
    }

    setCreating(true);
    try {
      if (!auth.currentUser || !requestKey) throw new Error("AUTHENTICATION_OR_SUBMISSION_KEY_REQUIRED");
      const reference = formData.paymentMethod === "Cash" ? formData.receiptNumber || formData.referenceNumber
        : formData.paymentMethod === "Cheque" ? formData.chequeNumber
        : formData.paymentMethod === "Bank Transfer" ? formData.transferReference || formData.referenceNumber : formData.referenceNumber;
      const created = await submitCollection(auth.currentUser, {
        requestKey, pharmacyId: formData.pharmacyId, amount: formData.amount, method: formData.paymentMethod,
        reference: reference || "", collectionDate: formData.collectionDate, notes: formData.notes,
        evidence: [...(formData.attachmentUrls || []), ...(formData.paymentMethod === "Cheque" && formData.chequeImageUrl ? [formData.chequeImageUrl] : []), ...(formData.paymentMethod === "Bank Transfer" && formData.transferProofUrl ? [formData.transferProofUrl] : [])],
        ...(formData.paymentMethod === "Cheque" ? { chequeBank: formData.chequeBankName, chequeDate: formData.chequeDate } : {}),
        ...(formData.paymentMethod === "Bank Transfer" ? { transferBank: formData.transferBankName } : {}),
      });
      setRequestKey("");

      setActionSuccessMessage(
        isRtl 
          ? `تم إرسال التحصيل ${created.collectionId} للتحقق.`
          : `Collection ${created.collectionId} submitted for verification.`
      );

      setIsCreateOpen(false);
      fetchData();
    } catch (err: any) {
      setCreateError(err.message || "Error creating payment collection.");
    } finally {
      setCreating(false);
    }
  };

  const handleReverse = async () => {
    if (!canReverse || !auth.currentUser || !selectedPayment || selectedPayment.status !== "Verified" || selectedPayment.revision !== 2
      || reversalState?.collectionId !== selectedPayment.paymentId || reversalState.reversal || !reversalReason.trim()) return;
    setActionLoading(true);
    setReversalError("");
    try {
      const result = await reverseCollection(auth.currentUser, {
        collectionId: selectedPayment.paymentId, expectedRevision: selectedPayment.revision, reason: reversalReason,
      });
      setReversalState({ collectionId: selectedPayment.paymentId, reversal: result.reversal });
      setReversalReason("");
      await fetchData();
    } catch (error: any) {
      setReversalError(error.message || "COLLECTION_REVERSAL_FAILED");
    } finally { setActionLoading(false); }
  };

  // Handle Finance Actions (Verify)
  const handleVerify = async (paymentId: string) => {
    setActionLoading(true);
    setActionSuccessMessage("");
    try {
      if (!canVerify || !auth.currentUser || selectedPayment?.paymentId !== paymentId || selectedPayment.status !== "Submitted" || !selectedPayment.revision) throw new Error("COLLECTION_APPROVAL_DENIED");
      await verifyCollection(auth.currentUser, { collectionId: paymentId, expectedRevision: selectedPayment.revision });
      setIsDetailsOpen(false);
      setSelectedPayment(null);
      setActionSuccessMessage(isRtl ? "تم اعتماد الدفعة." : "Collection verified.");
      await fetchData();
    } catch (err: any) {
      alert(err.message || "Error verifying payment.");
    } finally {
      setActionLoading(false);
    }
  };

  // Handle Finance Actions (Reject)
  const handleReject = async (paymentId: string) => {
    if (!rejectReason.trim()) {
      alert(isRtl ? "يرجى كتابة سبب الرفض." : "Please enter rejection reason.");
      return;
    }

    setActionLoading(true);
    try {
      const rejected = await rejectPaymentCollection(
        paymentId,
        rejectReason,
        currentUser?.id || "unknown",
        currentUser?.name || "Finance Officer",
        userRole
      );

      setSelectedPayment(rejected);
      setShowRejectInput(false);
      setRejectReason("");
      setActionSuccessMessage(
        isRtl ? `تم رفض تسجيل الدفعة ${rejected.paymentNumber}.` : `Payment ${rejected.paymentNumber} rejected.`
      );
      fetchData();
    } catch (err: any) {
      alert(err.message || "Error rejecting payment.");
    } finally {
      setActionLoading(false);
    }
  };

  // Handle Corrections
  const handleSaveCorrection = async () => {
    if (!selectedPayment) return;
    setActionLoading(true);
    try {
      const corrected = await correctPaymentCollection(
        selectedPayment.paymentId,
        editForm,
        currentUser?.id || "unknown",
        currentUser?.name || "Finance Officer",
        userRole,
        "Correction applied by Finance Officer."
      );

      setSelectedPayment(corrected);
      setIsEditOpen(false);
      setActionSuccessMessage(
        isRtl ? "تم تعديل وتصحيح بيانات الدفعة بنجاح." : "Payment collection record corrected successfully."
      );
      fetchData();
    } catch (err: any) {
      alert(err.message || "Error saving corrections.");
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Page Title & Top Actions */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-xl">
              <CreditCard size={24} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white">
                {isRtl ? "تحصيل المدفوعات والذكاء المالي" : "Payment Collections & Intelligence"}
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {isRtl 
                  ? "تسجيل وتدقيق المقبوضات النقدية والمصرفية وإصدار السجلات المالية بشكل مستقل"
                  : "Enterprise Payment Collection, Finance Verification, and Analytical Ledger Reporting"}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchData}
            disabled={loading}
            className="p-2.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition border border-slate-200 dark:border-slate-700 flex items-center gap-2 text-xs font-medium"
            title={isRtl ? "تحديث البيانات" : "Refresh Data"}
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            <span className="hidden sm:inline">{isRtl ? "تحديث" : "Refresh"}</span>
          </button>

          <button
            onClick={() => {
              setFormData({
                pharmacyId: "",
                pharmacyName: "",
                amount: 0,
                collectionDate: new Date().toISOString().split("T")[0],
                paymentMethod: "Cash",
                receiptNumber: "",
                chequeNumber: "",
                chequeBankName: "",
                chequeDate: new Date().toISOString().split("T")[0],
                chequeImageUrl: "",
                transferBankName: "",
                transferReference: "",
                transferProofUrl: "",
                notes: "",
                attachmentUrls: [],
                representativeUid: currentUser?.id || "",
                representativeName: currentUser?.name || ""
              });
              setCreateError("");
              setRequestKey(crypto.randomUUID());
              setIsCreateOpen(true);
            }}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-medium text-xs flex items-center gap-2 shadow-sm transition"
          >
            <Plus size={16} />
            <span>{isRtl ? "تسجيل دفعة جديدة" : "Record Payment"}</span>
          </button>
        </div>
      </div>

      {/* Action Success Alert */}
      {actionSuccessMessage && (
        <div className="p-4 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 rounded-xl border border-emerald-200 dark:border-emerald-800/60 flex items-center justify-between text-xs font-medium animate-fadeIn">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={18} className="text-emerald-600" />
            <span>{actionSuccessMessage}</span>
          </div>
          <button onClick={() => setActionSuccessMessage("")} className="hover:opacity-75">
            <X size={16} />
          </button>
        </div>
      )}

      {/* Stat Summary Cards */}
      {reportEntries.length > 1 && <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
        {isRtl ? "تم فصل الإجماليات حسب العملة:" : "Totals are grouped by currency:"} {reportEntries.map(([currency, report]) => `${currency} ${report.totalCollected.toLocaleString()}`).join(" · ")}
      </div>}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-xs font-medium">{isRtl ? "إجمالي المحصّل المعتمَد" : "Total Verified Collected"}</span>
            <DollarSign size={16} className="text-emerald-600" />
          </div>
          <div className="text-xl font-bold text-slate-900 dark:text-white">
            {reportEntries.length === 1 ? `${reportEntries[0][0]} ${reports.totalCollected.toLocaleString()}` : (isRtl ? "عملات متعددة" : "Multiple currencies")}
          </div>
          <div className="text-[10px] text-slate-400 mt-1">
            {isRtl ? "المبالغ المؤكدة والمرحلة" : "Confirmed in Customer Ledger"}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-xs font-medium">{isRtl ? "دفوعات قيد المراجعة" : "Pending Verification"}</span>
            <Clock size={16} className="text-amber-500" />
          </div>
          <div className="text-xl font-bold text-amber-600 dark:text-amber-400">
            {reports.byStatus.Submitted} <span className="text-xs font-normal text-slate-400">{isRtl ? "دفعة" : "payments"}</span>
          </div>
          <div className="text-[10px] text-slate-400 mt-1">
            {isRtl ? "في انتظار تدقيق المالية" : "Awaiting Finance Review"}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-xs font-medium">{isRtl ? "الدفوعات المعتمدة" : "Verified Payments"}</span>
            <CheckCircle2 size={16} className="text-emerald-500" />
          </div>
          <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
            {reports.byStatus.Verified} <span className="text-xs font-normal text-slate-400">{isRtl ? "سجل" : "records"}</span>
          </div>
          <div className="text-[10px] text-slate-400 mt-1">
            {isRtl ? "تم ترحيلها بنجاح" : "Posted & Verified"}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-xs font-medium">{isRtl ? "إجمالي العمليات المسجلة" : "Total Collection Records"}</span>
            <FileText size={16} className="text-blue-500" />
          </div>
          <div className="text-xl font-bold text-slate-900 dark:text-white">
            {reports.totalPaymentsCount} <span className="text-xs font-normal text-slate-400">{isRtl ? "عملية" : "items"}</span>
          </div>
          <div className="text-[10px] text-slate-400 mt-1">
            {isRtl ? "جميع الدفوعات المسجلة" : "Across all channels"}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center border-b border-slate-200 dark:border-slate-800 gap-6 text-sm font-medium">
        <button
          onClick={() => setActiveTab("list")}
          className={`pb-3 transition relative flex items-center gap-2 ${
            activeTab === "list"
              ? "text-emerald-600 dark:text-emerald-400 border-b-2 border-emerald-600 font-semibold"
              : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
        >
          <CreditCard size={16} />
          <span>{isRtl ? "سجل التحصيلات والمدفوعات" : "Payments List"}</span>
          <span className="ml-1 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-2 py-0.5 rounded-full text-xs">
            {filteredPayments.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab("reports")}
          className={`pb-3 transition relative flex items-center gap-2 ${
            activeTab === "reports"
              ? "text-emerald-600 dark:text-emerald-400 border-b-2 border-emerald-600 font-semibold"
              : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
        >
          <BarChart3 size={16} />
          <span>{isRtl ? "تقارير وتحليلات التحصيل" : "Reports & Intelligence"}</span>
        </button>
      </div>

      {/* TAB 1: LIST VIEW */}
      {activeTab === "list" && (
        <div className="space-y-4">
          {/* Filters Bar */}
          <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* Search */}
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={isRtl ? "بحث برقم الدفعة، الصيدلية، المندوب..." : "Search payment #, pharmacy, rep..."}
                  className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              {/* Status Filter */}
              <div>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as any)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="ALL">{isRtl ? "جميع الحالات" : "All Statuses"}</option>
                  <option value="Submitted">{isRtl ? "مقدم للمراجعة (Submitted)" : "Submitted"}</option>
                  <option value="Verified">{isRtl ? "معتمد ومرحل (Verified)" : "Verified"}</option>
                  <option value="Rejected">{isRtl ? "مرفوض (Rejected)" : "Rejected"}</option>
                  <option value="Corrected">{isRtl ? "معدل / مصحح (Corrected)" : "Corrected"}</option>
                </select>
              </div>

              {/* Method Filter */}
              <div>
                <select
                  value={methodFilter}
                  onChange={(e) => setMethodFilter(e.target.value as any)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="ALL">{isRtl ? "جميع طرق الدفع" : "All Payment Methods"}</option>
                  <option value="Cash">{isRtl ? "نقدي (Cash)" : "Cash"}</option>
                  <option value="Cheque">{isRtl ? "صك مصرفي (Cheque)" : "Cheque"}</option>
                  <option value="Bank Transfer">{isRtl ? "تحويل بانكي (Bank Transfer)" : "Bank Transfer"}</option>
                  <option value="Other">{isRtl ? "أخرى (Other)" : "Other"}</option>
                </select>
              </div>

              {/* Representative Filter */}
              <div>
                <select
                  value={repFilter}
                  onChange={(e) => setRepFilter(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="ALL">{isRtl ? "جميع المندوبين" : "All Representatives"}</option>
                  {uniqueReps.map((r) => (
                    <option key={r.uid} value={r.uid}>{r.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Sub-row for Date Range & Reset */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-slate-500 font-medium">{isRtl ? "التاريخ من:" : "From:"}</span>
                <input
                  type="date"
                  value={startDateFilter}
                  onChange={(e) => setStartDateFilter(e.target.value)}
                  className="px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                />
                <span className="text-slate-500 font-medium">{isRtl ? "إلى:" : "To:"}</span>
                <input
                  type="date"
                  value={endDateFilter}
                  onChange={(e) => setEndDateFilter(e.target.value)}
                  className="px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                />
              </div>

              {(searchQuery || statusFilter !== "ALL" || methodFilter !== "ALL" || repFilter !== "ALL" || startDateFilter || endDateFilter) && (
                <button
                  onClick={() => {
                    setSearchQuery("");
                    setStatusFilter("ALL");
                    setMethodFilter("ALL");
                    setRepFilter("ALL");
                    setPharmacyFilter("ALL");
                    setStartDateFilter("");
                    setEndDateFilter("");
                  }}
                  className="text-xs text-rose-600 dark:text-rose-400 hover:underline font-medium"
                >
                  {isRtl ? "إعادة ضبط الفلاتر" : "Reset Filters"}
                </button>
              )}
            </div>
          </div>

          {/* Payments Table */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
            {loading ? (
              <div className="p-12 text-center text-slate-400">
                <RefreshCw size={24} className="animate-spin mx-auto mb-2" />
                <p className="text-xs">{isRtl ? "جاري تحميل سجلات التحصيل..." : "Loading payment collections..."}</p>
              </div>
            ) : filteredPayments.length === 0 ? (
              <div className="p-12 text-center text-slate-400">
                <CreditCard size={32} className="mx-auto mb-2 opacity-50" />
                <p className="text-sm font-medium">{isRtl ? "لا توجد سجلات تحصيل مطابقة" : "No payment collection records found"}</p>
                <p className="text-xs text-slate-500 mt-1">{isRtl ? "قم بتسجيل دفعة جديدة أو تعديل خيارات البحث." : "Record a new payment or adjust search filters."}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 uppercase tracking-wider border-b border-slate-200 dark:border-slate-800 font-semibold">
                    <tr>
                      <th className="py-3.5 px-4">{isRtl ? "رقم العملية" : "Payment #"}</th>
                      <th className="py-3.5 px-4">{isRtl ? "التاريخ" : "Date"}</th>
                      <th className="py-3.5 px-4">{isRtl ? "الصيدلية والعميل" : "Pharmacy & Account"}</th>
                      <th className="py-3.5 px-4">{isRtl ? "المندوب" : "Representative"}</th>
                      <th className="py-3.5 px-4">{isRtl ? "المبلغ" : "Amount"}</th>
                      <th className="py-3.5 px-4">{isRtl ? "طريقة الدفع" : "Method"}</th>
                      <th className="py-3.5 px-4">{isRtl ? "الحالة" : "Status"}</th>
                      <th className="py-3.5 px-4 text-center">{isRtl ? "الإجراءات" : "Actions"}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                    {filteredPayments.map((p) => {
                      // Status styling
                      let statusBadge = "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border-amber-200";
                      if (p.status === "Verified") {
                        statusBadge = "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border-emerald-200";
                      } else if (p.status === "Rejected") {
                        statusBadge = "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400 border-rose-200";
                      } else if (p.status === "Corrected") {
                        statusBadge = "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400 border-blue-200";
                      }

                      // Method badge
                      let methodBadge = "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
                      if (p.paymentMethod === "Cash") methodBadge = "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300";
                      if (p.paymentMethod === "Cheque") methodBadge = "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300";
                      if (p.paymentMethod === "Bank Transfer") methodBadge = "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300";

                      return (
                        <tr key={p.paymentId} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40 transition">
                          <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">
                            {p.paymentNumber}
                          </td>
                          <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                            {p.collectionDate}
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-semibold text-slate-900 dark:text-white">{p.pharmacyName}</div>
                            <div className="text-[10px] text-slate-400">{p.customerAccountNumber}</div>
                          </td>
                          <td className="py-3 px-4 text-slate-700 dark:text-slate-300">
                            {p.representativeName}
                          </td>
                          <td className="py-3 px-4 font-bold text-emerald-600 dark:text-emerald-400">
                            {formatPaymentMoney(p.amount, p)}
                          </td>
                          <td className="py-3 px-4">
                            <span className={`px-2 py-0.5 rounded-md text-[11px] font-medium border ${methodBadge}`}>
                              {p.paymentMethod}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${statusBadge}`}>
                              {p.status}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-center">
                            <button
                              onClick={() => {
                                setSelectedPayment(p);
                                setShowRejectInput(false);
                                setRejectReason("");
                                setIsDetailsOpen(true);
                              }}
                              className="px-3 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-medium transition inline-flex items-center gap-1"
                            >
                              <Eye size={14} />
                              <span>{isRtl ? "التفاصيل" : "Details"}</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: REPORTS & ANALYTICS VIEW */}
      {activeTab === "reports" && (
        <div className="space-y-6">
          {/* Method Summary */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {(["Cash", "Cheque", "Bank Transfer", "Other"] as PaymentMethod[]).map((method) => {
              const amt = reports.amountByMethod[method] || 0;
              const count = reports.countByMethod[method] || 0;
              return (
                <div key={method} className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                  <div className="text-xs font-semibold text-slate-500 uppercase">{method}</div>
                  <div className="text-lg font-bold text-slate-900 dark:text-white mt-1">
                    {reportEntries.length === 1 ? `${reportEntries[0][0]} ${amt.toLocaleString()}` : "—"}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    {count} {isRtl ? "عملية تحصيل" : "collections"}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* By Representative */}
            <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <UserCheck size={16} className="text-emerald-500" />
                <span>{isRtl ? "التحصيل حسب المندوب" : "Payments by Representative"}</span>
              </h3>

              <div className="space-y-3 max-h-80 overflow-y-auto pr-1 text-xs">
                {Object.values(reports.byRepresentative).length === 0 ? (
                  <p className="text-slate-400 text-center py-4">{isRtl ? "لا توجد بيانات متاحة" : "No data available"}</p>
                ) : (
                  Object.values(reports.byRepresentative).map((rep: { uid: string; name: string; count: number; totalAmount: number }) => (
                    <div key={rep.uid} className="flex items-center justify-between p-2.5 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
                      <div>
                        <div className="font-semibold text-slate-900 dark:text-white">{rep.name}</div>
                        <div className="text-[10px] text-slate-400">{rep.count} {isRtl ? "عمليات" : "payments"}</div>
                      </div>
                      <div className="font-bold text-emerald-600 dark:text-emerald-400">
                        {reportEntries.length === 1 ? `${reportEntries[0][0]} ${rep.totalAmount.toLocaleString()}` : "—"}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* By Pharmacy */}
            <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Building2 size={16} className="text-blue-500" />
                <span>{isRtl ? "التحصيل حسب الصيدلية" : "Payments by Pharmacy"}</span>
              </h3>

              <div className="space-y-3 max-h-80 overflow-y-auto pr-1 text-xs">
                {Object.values(reports.byPharmacy).length === 0 ? (
                  <p className="text-slate-400 text-center py-4">{isRtl ? "لا توجد بيانات متاحة" : "No data available"}</p>
                ) : (
                  Object.values(reports.byPharmacy).map((ph: { pharmacyId: string; name: string; count: number; totalAmount: number }) => (
                    <div key={ph.pharmacyId} className="flex items-center justify-between p-2.5 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
                      <div>
                        <div className="font-semibold text-slate-900 dark:text-white">{ph.name}</div>
                        <div className="text-[10px] text-slate-400">{ph.count} {isRtl ? "عملية تحصيل" : "records"}</div>
                      </div>
                      <div className="font-bold text-emerald-600 dark:text-emerald-400">
                        {reportEntries.length === 1 ? `${reportEntries[0][0]} ${ph.totalAmount.toLocaleString()}` : "—"}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 1: CREATE PAYMENT */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between sticky top-0 bg-white dark:bg-slate-900 z-10">
              <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
                <CreditCard size={18} className="text-emerald-600" />
                <span>{isRtl ? "تسجيل تحصيل دفعة جديدة" : "Record Payment Collection"}</span>
              </div>
              <button onClick={() => setIsCreateOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="p-5 space-y-4 text-xs">
              {createError && (
                <div className="p-3 bg-rose-50 text-rose-700 border border-rose-200 rounded-xl font-medium">
                  {createError}
                </div>
              )}

              {/* Pharmacy Selection */}
              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                  {isRtl ? "الصيدلية والعميل *" : "Pharmacy Customer *"}
                </label>
                <select
                  required
                  value={formData.pharmacyId}
                  onChange={(e) => handlePharmacySelect(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="">{isRtl ? "-- اختر الصيدلية --" : "-- Select Pharmacy --"}</option>
                  {pharmacies.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name || p.pharmacyName} ({p.customerAccountNumber || p.code || p.id})
                    </option>
                  ))}
                </select>
              </div>

              {/* Amount & Date */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                    {isRtl ? "المبلغ (عملة السوق) *" : "Amount (market currency) *"}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    value={formData.amount || ""}
                    onChange={(e) => setFormData({ ...formData, amount: parseFloat(e.target.value) || 0 })}
                    placeholder="0.00"
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white font-bold text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                    {isRtl ? "تاريخ التحصيل *" : "Collection Date *"}
                  </label>
                  <input
                    type="date"
                    required
                    value={formData.collectionDate}
                    onChange={(e) => setFormData({ ...formData, collectionDate: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              {/* Payment Method */}
              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                  {isRtl ? "طريقة الدفع *" : "Payment Method *"}
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(["Cash", "Cheque", "Bank Transfer", "Other"] as PaymentMethod[]).map((m) => (
                    <button
                      type="button"
                      key={m}
                      onClick={() => setFormData({ ...formData, paymentMethod: m })}
                      className={`py-2 px-3 rounded-xl border text-center font-semibold transition ${
                        formData.paymentMethod === m
                          ? "bg-emerald-600 text-white border-emerald-600 shadow-sm"
                          : "bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              {/* CONDITIONAL METHOD FIELDS (PART 3) */}
              {formData.paymentMethod === "Cash" && (
                <div className="p-3 bg-emerald-50/50 dark:bg-emerald-950/20 rounded-xl border border-emerald-200/60 dark:border-emerald-800/60 space-y-2 animate-fadeIn">
                  <div className="font-semibold text-emerald-800 dark:text-emerald-300">{isRtl ? "تفاصيل الدفع النقدي (Cash)" : "Cash Payment Details"}</div>
                  <div>
                    <label className="block text-slate-600 dark:text-slate-300 font-medium mb-1">{isRtl ? "رقم الإيصال النقدي *" : "Receipt Number *"}</label>
                    <input
                      type="text"
                      required
                      value={formData.receiptNumber || ""}
                      onChange={(e) => setFormData({ ...formData, receiptNumber: e.target.value })}
                      placeholder="e.g. RCT-2026-99"
                      className="w-full px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                    />
                  </div>
                </div>
              )}

              {formData.paymentMethod === "Cheque" && (
                <div className="p-3 bg-purple-50/50 dark:bg-purple-950/20 rounded-xl border border-purple-200/60 dark:border-purple-800/60 space-y-3 animate-fadeIn">
                  <div className="font-semibold text-purple-800 dark:text-purple-300">{isRtl ? "تفاصيل الصك المصرفي (Cheque)" : "Cheque Details"}</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="block text-slate-600 dark:text-slate-300 font-medium mb-1">{isRtl ? "رقم الصك *" : "Cheque Number *"}</label>
                      <input
                        type="text"
                        required
                        value={formData.chequeNumber || ""}
                        onChange={(e) => setFormData({ ...formData, chequeNumber: e.target.value })}
                        placeholder="e.g. 0004589"
                        className="w-full px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-600 dark:text-slate-300 font-medium mb-1">{isRtl ? "اسم البنك *" : "Bank Name *"}</label>
                      <input
                        type="text"
                        required
                        value={formData.chequeBankName || ""}
                        onChange={(e) => setFormData({ ...formData, chequeBankName: e.target.value })}
                        placeholder="e.g. Jumhouria Bank"
                        className="w-full px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="block text-slate-600 dark:text-slate-300 font-medium mb-1">{isRtl ? "تاريخ الصك *" : "Cheque Date *"}</label>
                      <input
                        type="date"
                        required
                        value={formData.chequeDate || ""}
                        onChange={(e) => setFormData({ ...formData, chequeDate: e.target.value })}
                        className="w-full px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-600 dark:text-slate-300 font-medium mb-1">{isRtl ? "رابط صورة الصك" : "Cheque Image URL"}</label>
                      <input
                        type="text"
                        value={formData.chequeImageUrl || ""}
                        onChange={(e) => setFormData({ ...formData, chequeImageUrl: e.target.value })}
                        placeholder="https://..."
                        className="w-full px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                      />
                    </div>
                  </div>
                </div>
              )}

              {formData.paymentMethod === "Bank Transfer" && (
                <div className="p-3 bg-sky-50/50 dark:bg-sky-950/20 rounded-xl border border-sky-200/60 dark:border-sky-800/60 space-y-3 animate-fadeIn">
                  <div className="font-semibold text-sky-800 dark:text-sky-300">{isRtl ? "تفاصيل التحويل البنكي (Bank Transfer)" : "Bank Transfer Details"}</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="block text-slate-600 dark:text-slate-300 font-medium mb-1">{isRtl ? "اسم البنك *" : "Bank Name *"}</label>
                      <input
                        type="text"
                        required
                        value={formData.transferBankName || ""}
                        onChange={(e) => setFormData({ ...formData, transferBankName: e.target.value })}
                        placeholder="e.g. Sahara Bank"
                        className="w-full px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-600 dark:text-slate-300 font-medium mb-1">{isRtl ? "رقم التحويل *" : "Transfer Reference *"}</label>
                      <input
                        type="text"
                        required
                        value={formData.transferReference || ""}
                        onChange={(e) => setFormData({ ...formData, transferReference: e.target.value })}
                        placeholder="e.g. TRF-908123"
                        className="w-full px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-slate-600 dark:text-slate-300 font-medium mb-1">{isRtl ? "رابط إثبات التحويل" : "Transfer Proof URL"}</label>
                    <input
                      type="text"
                      value={formData.transferProofUrl || ""}
                      onChange={(e) => setFormData({ ...formData, transferProofUrl: e.target.value })}
                      placeholder="https://..."
                      className="w-full px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                    />
                  </div>
                </div>
              )}

              {/* Notes */}
              {formData.paymentMethod === "Other" && (
                <input className="w-full px-3 py-2 border rounded-xl" placeholder={isRtl ? "المرجع" : "Reference"} aria-label={isRtl ? "المرجع" : "Reference"} required value={formData.referenceNumber || ""}
                  onChange={e => setFormData({ ...formData, referenceNumber: e.target.value })} />
              )}
              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                  {isRtl ? "ملاحظات إضافية" : "Notes"}
                </label>
                <textarea
                  rows={2}
                  maxLength={4000}
                  value={formData.notes || ""}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder={isRtl ? "أية تفاصيل إضافية حول التحصيل..." : "Additional notes or description..."}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="px-4 py-2 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition"
                >
                  {isRtl ? "إلغاء" : "Cancel"}
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-xl transition flex items-center gap-2"
                >
                  {creating && <RefreshCw size={14} className="animate-spin" />}
                  <span>{isRtl ? "حفظ وتسجيل الدفعة" : "Save & Record Payment"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: VIEW PAYMENT DETAILS (PART 7 & PART 8) */}
      {isDetailsOpen && selectedPayment && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between sticky top-0 bg-white dark:bg-slate-900 z-10">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-xl">
                  <FileText size={20} />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900 dark:text-white">
                    {isRtl ? "تفاصيل عملية التحصيل" : "Payment Collection Details"} #{selectedPayment.paymentNumber}
                  </h2>
                  <p className="text-[11px] text-slate-400">ID: {selectedPayment.paymentId}</p>
                </div>
              </div>
              <button onClick={() => setIsDetailsOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-6 text-xs">
              {/* Status Banner */}
              <div className="p-4 rounded-xl border flex items-center justify-between bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800">
                <div>
                  <div className="text-[10px] text-slate-400 uppercase font-semibold">{isRtl ? "حالة الدفعة الحالية" : "Current Payment Status"}</div>
                  <div className="text-sm font-bold text-slate-900 dark:text-white mt-0.5">{selectedPayment.status}</div>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${
                  selectedPayment.status === "Verified"
                    ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                    : selectedPayment.status === "Rejected"
                    ? "bg-rose-100 text-rose-800 border-rose-300"
                    : "bg-amber-100 text-amber-800 border-amber-300"
                }`}>
                  {selectedPayment.status}
                </span>
              </div>

              {/* SECTION 1: CUSTOMER INFO */}
              <div className="space-y-2">
                <h3 className="font-bold text-slate-900 dark:text-white text-xs uppercase tracking-wider text-slate-500">{isRtl ? "معلومات العميل والصيدلية" : "Customer Information"}</h3>
                <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl grid grid-cols-2 gap-3">
                  <div>
                    <span className="text-slate-400">{isRtl ? "اسم الصيدلية:" : "Pharmacy Name:"}</span>
                    <div className="font-bold text-slate-900 dark:text-white">{selectedPayment.pharmacyName}</div>
                  </div>
                  <div>
                    <span className="text-slate-400">{isRtl ? "رقم الحساب:" : "Customer Account #:"}</span>
                    <div className="font-bold text-slate-900 dark:text-white">{selectedPayment.customerAccountNumber}</div>
                  </div>
                  <div>
                    <span className="text-slate-400">{isRtl ? "المندوب المحصل:" : "Representative:"}</span>
                    <div className="font-medium text-slate-800 dark:text-slate-200">{selectedPayment.representativeName}</div>
                  </div>
                  <div>
                    <span className="text-slate-400">{isRtl ? "المنطقة / المدينة:" : "Area / City:"}</span>
                    <div className="font-medium text-slate-800 dark:text-slate-200">{selectedPayment.areaName || selectedPayment.cityName || "N/A"}</div>
                  </div>
                </div>
              </div>

              {/* SECTION 2: PAYMENT INFO */}
              <div className="space-y-2">
                <h3 className="font-bold text-slate-900 dark:text-white text-xs uppercase tracking-wider text-slate-500">{isRtl ? "معلومات الدفعة والمبلغ" : "Payment Information"}</h3>
                <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div>
                    <span className="text-slate-400">{isRtl ? "المبلغ:" : "Amount:"}</span>
                    <div className="font-bold text-emerald-600 dark:text-emerald-400 text-sm">{formatPaymentMoney(selectedPayment.amount, selectedPayment)}</div>
                  </div>
                  <div>
                    <span className="text-slate-400">{isRtl ? "تاريخ التحصيل:" : "Collection Date:"}</span>
                    <div className="font-medium text-slate-900 dark:text-white">{selectedPayment.collectionDate}</div>
                  </div>
                  <div>
                    <span className="text-slate-400">{isRtl ? "طريقة الدفع:" : "Payment Method:"}</span>
                    <div className="font-bold text-slate-900 dark:text-white">{selectedPayment.paymentMethod}</div>
                  </div>
                  <div className="col-span-2 sm:col-span-3">
                    <span className="text-slate-400">{isRtl ? "الرقم المرجعي الإجمالي:" : "Reference Number:"}</span>
                    <div className="font-mono text-slate-900 dark:text-white font-semibold">{selectedPayment.referenceNumber}</div>
                  </div>
                </div>
              </div>

              {/* CONDITIONAL METHOD DETAILS DISPLAY */}
              {selectedPayment.paymentMethod === "Cash" && (
                <div className="p-3 bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded-xl space-y-1">
                  <div className="font-bold text-emerald-800 dark:text-emerald-300">{isRtl ? "تفاصيل الدفع النقدي" : "Cash Payment Details"}</div>
                  <div><span className="text-slate-500">{isRtl ? "رقم الإيصال:" : "Receipt Number:"}</span> <strong className="text-slate-900 dark:text-white">{selectedPayment.receiptNumber || selectedPayment.referenceNumber}</strong></div>
                </div>
              )}

              {selectedPayment.paymentMethod === "Cheque" && (
                <div className="p-3 bg-purple-50/60 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800 rounded-xl space-y-2">
                  <div className="font-bold text-purple-800 dark:text-purple-300">{isRtl ? "تفاصيل الصك المصرفي" : "Cheque Details"}</div>
                  <div className="grid grid-cols-2 gap-2">
                    <div><span className="text-slate-500">{isRtl ? "رقم الصك:" : "Cheque #:"}</span> <strong className="text-slate-900 dark:text-white">{selectedPayment.chequeNumber || "N/A"}</strong></div>
                    <div><span className="text-slate-500">{isRtl ? "اسم البنك:" : "Bank Name:"}</span> <strong className="text-slate-900 dark:text-white">{selectedPayment.chequeBankName || "N/A"}</strong></div>
                    <div><span className="text-slate-500">{isRtl ? "تاريخ الصك:" : "Cheque Date:"}</span> <strong className="text-slate-900 dark:text-white">{selectedPayment.chequeDate || "N/A"}</strong></div>
                  </div>
                  {selectedPayment.chequeImageUrl && (
                    <div className="pt-1">
                      <a href={selectedPayment.chequeImageUrl} target="_blank" rel="noreferrer" className="text-purple-600 hover:underline flex items-center gap-1 font-medium">
                        <ImageIcon size={14} />
                        <span>{isRtl ? "عرض صورة الصك" : "View Cheque Image"}</span>
                      </a>
                    </div>
                  )}
                </div>
              )}

              {selectedPayment.paymentMethod === "Bank Transfer" && (
                <div className="p-3 bg-sky-50/60 dark:bg-sky-950/20 border border-sky-200 dark:border-sky-800 rounded-xl space-y-2">
                  <div className="font-bold text-sky-800 dark:text-sky-300">{isRtl ? "تفاصيل التحويل البنكي" : "Bank Transfer Details"}</div>
                  <div className="grid grid-cols-2 gap-2">
                    <div><span className="text-slate-500">{isRtl ? "اسم البنك:" : "Bank Name:"}</span> <strong className="text-slate-900 dark:text-white">{selectedPayment.transferBankName || "N/A"}</strong></div>
                    <div><span className="text-slate-500">{isRtl ? "رقم مرجع التحويل:" : "Transfer Ref:"}</span> <strong className="text-slate-900 dark:text-white">{selectedPayment.transferReference || selectedPayment.referenceNumber}</strong></div>
                  </div>
                  {selectedPayment.transferProofUrl && (
                    <div className="pt-1">
                      <a href={selectedPayment.transferProofUrl} target="_blank" rel="noreferrer" className="text-sky-600 hover:underline flex items-center gap-1 font-medium">
                        <ExternalLink size={14} />
                        <span>{isRtl ? "عرض إثبات التحويل" : "View Transfer Proof"}</span>
                      </a>
                    </div>
                  )}
                </div>
              )}

              {/* NOTES */}
              {selectedPayment.attachmentUrls?.map((url, index) => (
                <a key={index} href={/^https?:\/\//i.test(url) ? url : undefined} target="_blank" rel="noreferrer" className="block text-sky-600 hover:underline">
                  {isRtl ? "مرفق" : "Evidence"} {index + 1}
                </a>
              ))}
              {selectedPayment.notes && (
                <div>
                  <span className="text-slate-400 block mb-1 font-medium">{isRtl ? "ملاحظات:" : "Notes:"}</span>
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl text-slate-800 dark:text-slate-200">
                    {selectedPayment.notes}
                  </div>
                </div>
              )}

              {/* LEDGER REFERENCE */}
              {selectedPayment.ledgerEntryId && (
                <div className="p-3 bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/60 rounded-xl flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={16} className="text-emerald-600" />
                    <div>
                      <div className="font-bold text-slate-900 dark:text-white">{isRtl ? "قيد المحاسبة في حساب العملاء" : "Customer Ledger Reference"}</div>
                      <div className="text-[10px] text-slate-400">ID: {selectedPayment.ledgerEntryId}</div>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded font-semibold text-[10px]">
                    POSTED
                  </span>
                </div>
              )}

              {selectedPayment.status === "Verified" && selectedPayment.revision === 2 && (
                <div className="space-y-2 border-t border-slate-200 dark:border-slate-800 pt-3">
                  {reversalError && <p role="alert" className="text-rose-600">{reversalError}</p>}
                  {reversalState?.collectionId === selectedPayment.paymentId && reversalState.reversal && (
                    <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 text-xs">
                      <strong>{isRtl ? "تم تسجيل عكس مرتبط؛ سجل الاعتماد الأصلي محفوظ." : "Linked reversal recorded; original verification retained."}</strong>
                      <div>{reversalState.reversal.ledgerEntryId}</div>
                      <div>{reversalState.reversal.reason}</div>
                      <div>{reversalState.reversal.actorUid} — {reversalState.reversal.createdAt}</div>
                    </div>
                  )}
                  {canReverse && reversalState?.collectionId === selectedPayment.paymentId && !reversalState.reversal && (
                    <div className="space-y-2">
                      <label className="block font-semibold" htmlFor="collection-reversal-reason">{isRtl ? "سبب عكس الدفعة" : "Reversal reason"}</label>
                      <textarea id="collection-reversal-reason" maxLength={4000} rows={2} value={reversalReason}
                        onChange={event => setReversalReason(event.target.value)} disabled={actionLoading}
                        className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-900" />
                      <button type="button" onClick={handleReverse} disabled={actionLoading || !reversalReason.trim()}
                        className="px-4 py-2 rounded-xl bg-rose-600 text-white font-semibold disabled:opacity-50">
                        {isRtl ? "عكس الدفعة المعتمدة" : "Reverse verified payment"}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* VERIFICATION HISTORY */}
              <div className="space-y-2">
                <h3 className="font-bold text-slate-900 dark:text-white text-xs uppercase tracking-wider text-slate-500">{isRtl ? "سجل الاعتمادات والمراجعة" : "Verification Audit History"}</h3>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {selectedPayment.verificationHistory?.map((vh, idx) => (
                    <div key={idx} className="p-2.5 bg-slate-50 dark:bg-slate-800/40 rounded-xl flex items-start justify-between text-[11px]">
                      <div>
                        <div className="font-bold text-slate-900 dark:text-white">{vh.status} by {vh.actorName} ({vh.actorRole})</div>
                        <div className="text-slate-500">{vh.notes || vh.reason}</div>
                      </div>
                      <div className="text-[10px] text-slate-400 whitespace-nowrap">{new Date(vh.timestamp).toLocaleString()}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* REJECT INPUT IF TOGGLED */}
              {showRejectInput && (
                <div className="p-4 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 rounded-xl space-y-2 animate-fadeIn">
                  <label className="block text-rose-800 dark:text-rose-300 font-bold">{isRtl ? "سبب رفض الدفعة *" : "Rejection Reason *"}</label>
                  <textarea
                    rows={2}
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder={isRtl ? "اكتب سبب عدم اعتمادات الدفعة..." : "Reason for rejection..."}
                    className="w-full p-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white text-xs"
                  />
                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setShowRejectInput(false)}
                      className="px-3 py-1 bg-slate-200 hover:bg-slate-300 rounded-lg text-slate-700"
                    >
                      {isRtl ? "إلغاء" : "Cancel"}
                    </button>
                    <button
                      type="button"
                      disabled={actionLoading}
                      onClick={() => handleReject(selectedPayment.paymentId)}
                      className="px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-lg"
                    >
                      {isRtl ? "تأكيد الرفض" : "Confirm Rejection"}
                    </button>
                  </div>
                </div>
              )}

              {/* FINANCE ACTION BUTTONS (PART 8) */}
              {(isFinanceRole || canVerify) && selectedPayment.status !== "Verified" && !showRejectInput && (
                <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
                  {isFinanceRole && <button
                    type="button"
                    onClick={() => {
                      setEditForm(selectedPayment);
                      setIsEditOpen(true);
                    }}
                    className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl font-medium flex items-center gap-1.5"
                  >
                    <Edit3 size={14} />
                    <span>{isRtl ? "تعديل السجل (Correct)" : "Correct Record"}</span>
                  </button>}

                  <div className="flex items-center gap-2">
                    {isFinanceRole && <button
                      type="button"
                      onClick={() => setShowRejectInput(true)}
                      className="px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 rounded-xl font-medium border border-rose-200 dark:border-rose-800 transition"
                    >
                      {isRtl ? "رفض الدفعة" : "Reject Payment"}
                    </button>}

                    {canVerify && selectedPayment.status === "Submitted" && selectedPayment.revision === 1 && <button
                      type="button"
                      disabled={actionLoading}
                      onClick={() => handleVerify(selectedPayment.paymentId)}
                      className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-sm transition flex items-center gap-2"
                    >
                      {actionLoading ? <RefreshCw size={14} className="animate-spin" /> : <CheckCircle2 size={16} />}
                      <span>{isRtl ? "اعتماد وترحيل الدفعة" : "Verify & Post Payment"}</span>
                    </button>}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: EDIT / CORRECT PAYMENT */}
      {isEditOpen && selectedPayment && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl w-full max-w-lg p-5 space-y-4 text-xs">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Edit3 size={16} className="text-blue-500" />
                <span>{isRtl ? "تعديل وتصحيح بيانات الدفعة" : "Correct Payment Record"} #{selectedPayment.paymentNumber}</span>
              </h3>
              <button onClick={() => setIsEditOpen(false)}><X size={16} /></button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-slate-600 mb-1">{isRtl ? "المبلغ (عملة السوق):" : "Amount (market currency):"}</label>
                <input
                  type="number"
                  step="0.01"
                  value={editForm.amount || 0}
                  onChange={(e) => setEditForm({ ...editForm, amount: parseFloat(e.target.value) || 0 })}
                  className="w-full p-2 border rounded-xl dark:bg-slate-800 dark:border-slate-700"
                />
              </div>

              <div>
                <label className="block text-slate-600 mb-1">{isRtl ? "تاريخ التحصيل:" : "Collection Date:"}</label>
                <input
                  type="date"
                  value={editForm.collectionDate || ""}
                  onChange={(e) => setEditForm({ ...editForm, collectionDate: e.target.value })}
                  className="w-full p-2 border rounded-xl dark:bg-slate-800 dark:border-slate-700"
                />
              </div>

              <div>
                <label className="block text-slate-600 mb-1">{isRtl ? "الرقم المرجعي / رقم الإيصال:" : "Reference / Receipt Number:"}</label>
                <input
                  type="text"
                  value={editForm.referenceNumber || ""}
                  onChange={(e) => setEditForm({ ...editForm, referenceNumber: e.target.value })}
                  className="w-full p-2 border rounded-xl dark:bg-slate-800 dark:border-slate-700"
                />
              </div>

              <div>
                <label className="block text-slate-600 mb-1">{isRtl ? "ملاحظات التصحيح:" : "Correction Notes:"}</label>
                <textarea
                  rows={2}
                  value={editForm.notes || ""}
                  onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                  className="w-full p-2 border rounded-xl dark:bg-slate-800 dark:border-slate-700"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button onClick={() => setIsEditOpen(false)} className="px-4 py-2 bg-slate-100 dark:bg-slate-800 rounded-xl">
                {isRtl ? "إلغاء" : "Cancel"}
              </button>
              <button
                disabled={actionLoading}
                onClick={handleSaveCorrection}
                className="px-5 py-2 bg-blue-600 text-white rounded-xl font-bold"
              >
                {isRtl ? "حفظ التعديلات" : "Save Corrections"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
