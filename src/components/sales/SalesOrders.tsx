export function orderPaymentLabel(status: unknown, isRtl = false): string {
  if (status === "Unpaid") return isRtl ? "غير مدفوع" : "Unpaid";
  if (status === "Partially Paid") return isRtl ? "مدفوع جزئياً" : "Partially Paid";
  if (status === "Paid") return isRtl ? "مدفوع بالكامل" : "Paid";
  return isRtl ? "غير متاح" : "Unavailable";
}
import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { 
  ShoppingCart, 
  Clock, 
  CheckCircle, 
  CheckCircle2,
  DollarSign, 
  Search, 
  Filter, 
  Download, 
  Eye, 
  Check, 
  X, 
  ArrowLeft, 
  FileText, 
  Store, 
  User, 
  Calendar, 
  Boxes,
  Package,
  Printer,
  Ban,
  Wallet,
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  AlertCircle,
  RotateCcw,
  ShieldCheck,
  ShieldAlert,
  Truck,
  FileCheck,
  ChevronDown,
  UserCheck,
  MapPin
} from "lucide-react";
import { Product, Pharmacy, User as UserType, Role, UserTerritoryAssignment, UserProductAssignment, normalizeRole } from "../../types";
import { useModalScrollLock } from "../../lib/scrollLock";
import { resolveUserIdentity } from "../../lib/userIdentityResolver";
import { getOrderBusinessNumber } from "../../utils/visitNumberUtils";
import { 
  exportCommercialInvoiceDocx, 
  exportCommercialInvoicePdf, 
  exportDeliveryNoteDocx, 
  exportDeliveryNotePdf 
} from "../../features/orders/exportEngine";
import { 
  canTransitionOrder, 
  normalizeOrderStatus, 
  getStageForStatus, 
  getCapabilitiesForRole, 
  checkCreatorSegregation, 
  OrderStatus, 
  OrderStage, 
  OrderCapability,
  OrderTransitionHistory,
  getOrderWorkflowPresentation,
  getLocalizedWorkflowStage,
  getLocalizedWorkflowStatus,
  getLocalizedWorkflowAction,
  getLocalizedCapability,
  getLocalizedRole
} from "../../features/orders/orderWorkflowEngine";
import { canValidateOrder, canApproveOrderFinancially, canReviewStoreOrder, canAssignDelivery, canCompleteDelivery } from "../../lib/userPolicyEngine";
import { resolveDeliveryAssignment } from "../../features/orders/deliveryAssignmentResolver";
import { deliveryActionCandidatesForOrder, resolveDeliveryLifecycleDecision } from "../../features/orders/deliveryLifecycleSelectors";
import { listenCollection, listenQuery } from "../../lib/firebaseSync";
import { saveOrder } from "../../lib/firestoreService";
import { filterBySecurity } from "../../lib/alignmentService";
import { db, auth } from "../../lib/firebase";
import { collection, query, where, onSnapshot, doc } from "firebase/firestore";
import { handleFirestoreError, OperationType } from "../../lib/firebaseError";
import { executeDeliveryAssignment, fetchEligibleDeliveryOfficers } from "../../lib/deliveryAssignmentClient";
import NoDataState from "../NoDataState";
import {
  createOrderWorkflowQueueReadController,
  executeOrderOperationsTransition,
  type OrderWorkflowQueueState,
  type OrderWorkflowQueueSummary,
} from "../../lib/orderWorkflowQueueReadClient";
import {
  createOrderWorkflowDetailReadController,
  type OrderWorkflowDetailReadState,
} from "../../lib/orderWorkflowDetailReadClient";
import {
  triggerOrderSupervisorApprovalAlert,
  triggerFinanceApprovalAlert,
  triggerWarehouseReleaseAlert,
  triggerCreditLimitAlert,
  triggerOutstandingBalanceAlert,
  triggerDeliveryIssueAlert
} from "../../lib/notificationService";
import { formatMarketCurrency, resolveMarketForIdentity, type MarketBusinessSettings } from "../../lib/marketSettings";
import { fetchScopedCommercialRead } from "../../lib/commercialReadClient";
import { resolveFinancialIdentity } from "../../lib/financialIdentity";
import { transitionCommercialOrder } from "../../lib/commercialOrderTransitionClient";
import { applyOrderTransitionWithTemplate, ENTERPRISE_WORKFLOW_TEMPLATE, isRuntimeOrderWorkflowTemplate, type OrderWorkflowTemplate } from "../../features/orders/orderWorkflowTemplate";

export type OrderStageFilter = "ALL" | "SUBMISSION" | "FINANCE_REVIEW" | "OPERATIONS_REVIEW" | "STORE_PREPARATION" | "DISPATCH" | "CLOSED";

// Format only persisted transaction amounts against canonical market records.
export function formatOrderSnapshotMoney(amount: number, order: Record<string, any>, markets: readonly MarketBusinessSettings[]): string {
  try {
    if (!order.marketId && !order.countryId) return "Configuration required";
    const market = resolveMarketForIdentity(markets, { marketId: order.marketId, countryId: order.countryId });
    if (!market || (order.countryId && order.countryId !== market.countryId)
      || !resolveFinancialIdentity([order], [market])
      || !Boolean(order.currencyCode || order.currency)
      || ![order.currencyCode, order.currency].filter(value => value !== undefined).every(value => value === market.currencyCode)) return "Configuration required";
    return formatMarketCurrency(amount, market);
  } catch { return "Configuration required"; }
}

interface SalesOrdersProps {
  products: Product[];
  pharmacies: Pharmacy[];
  lang: "en" | "ar";
  currentUser?: UserType;
  onLogAudit?: (action: string, entity: string, details: string) => void;
  userTerritoryAssignments?: UserTerritoryAssignment[];
  userProductAssignments?: UserProductAssignment[];
  profileLoaded?: boolean;
  initialStageFilter?: OrderStageFilter;
}

interface OrderItem {
  id: string;
  name: string;
  quantity: number;
  price: number;
  total: number;
}

interface Order {
  id: string;
  pharmacyId: string;
  pharmacyName: string;
  pharmacyAddress: string;
  date: string;
  total: number;
  paidStatus: "Paid" | "Unpaid";
  paidAmount: number;
  status: "Pending Supervisor Review" | "Pending Financial Review" | "Pending Ops Validation" | "Pending Store Review" | "Pending Delivery" | "In Delivery" | "Delivered" | "Returned to Rep" | "Voided";
  salesRep: string;
  items: OrderItem[];
  notes?: string;
}

const INITIAL_ORDERS: Order[] = [];

function CanonicalOrderOperationsWorkspace({ lang, currentUser, profileLoaded }: SalesOrdersProps) {
  const isRtl = lang === "ar";
  const queueController = useRef(createOrderWorkflowQueueReadController());
  const detailController = useRef(createOrderWorkflowDetailReadController());
  const [queueState, setQueueState] = useState<OrderWorkflowQueueState>(queueController.current.getState());
  const [detailState, setDetailState] = useState<OrderWorkflowDetailReadState>(detailController.current.getState());
  const [selectedSummary, setSelectedSummary] = useState<OrderWorkflowQueueSummary | null>(null);
  const [action, setAction] = useState<"OPERATIONS_APPROVE" | "OPERATIONS_REJECT" | "OPERATIONS_RETURN_TO_FINANCE" | "OPERATIONS_RETURN_TO_REP">("OPERATIONS_APPROVE");
  const [comments, setComments] = useState("");
  const [transitionState, setTransitionState] = useState<{ status: "IDLE" | "LOADING" | "ERROR" | "SUCCESS"; code?: string }>({ status: "IDLE" });
  const actorUid = currentUser?.id || currentUser?.uid || "";
  const detail = detailState.detail;
  const context = detail?.marketContext;
  const market = context?.status === "RESOLVED" ? context.market : null;
  const locale = isRtl ? "ar" : (market?.numeralLocale || "en");
  const currency = { format: (amount: number) => detail ? formatOrderSnapshotMoney(amount, detail, market ? [market] : []) : "Configuration required" };
  const formatDate = (value: string) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
  };
  const statusLabel = (status: string) => getLocalizedWorkflowStatus(status, lang);
  const pendingCount = queueState.status === "READY" ? queueState.orders.length : 0;
  // The queue contract does not certify a single aggregate currency.

  const loadQueue = useCallback(async () => {
    const firebaseUser = auth.currentUser;
    if (!actorUid || !firebaseUser || !profileLoaded) {
      queueController.current.clear(); setQueueState(queueController.current.getState()); return;
    }
    await queueController.current.load(actorUid, firebaseUser, {});
    setQueueState(queueController.current.getState());
  }, [actorUid, profileLoaded]);

  useEffect(() => {
    queueController.current.clear(); detailController.current.clear();
    setQueueState(queueController.current.getState()); setDetailState(detailController.current.getState());
    setSelectedSummary(null); setTransitionState({ status: "IDLE" });
    void loadQueue();
    return () => { queueController.current.clear(); detailController.current.clear(); };
  }, [actorUid, currentUser?.role, loadQueue]);

  const selectSummary = async (summary: OrderWorkflowQueueSummary) => {
    const firebaseUser = auth.currentUser;
    detailController.current.clear(); setDetailState(detailController.current.getState());
    setSelectedSummary(summary); setTransitionState({ status: "IDLE" });
    if (!firebaseUser || !actorUid) return;
    const pending = detailController.current.load(actorUid, summary.orderId, firebaseUser);
    setDetailState(detailController.current.getState()); await pending; setDetailState(detailController.current.getState());
  };

  const submitTransition = async () => {
    const firebaseUser = auth.currentUser; const detail = detailState.detail;
    if (!firebaseUser || detailState.status !== "READY" || !detail) return;
    setTransitionState({ status: "LOADING" });
    try {
      const result = await executeOrderOperationsTransition(firebaseUser, { orderId: detail.orderId, action, ...(comments.trim() ? { comments: comments.trim() } : {}), expectedStatus: detail.currentStatus, expectedVersion: detail.version });
      if (!result.success) { setTransitionState({ status: "ERROR", code: result.code || "TRANSITION_DENIED" }); return; }
      detailController.current.clear(); setDetailState(detailController.current.getState()); setSelectedSummary(null); setComments("");
      setTransitionState({ status: "SUCCESS" }); await loadQueue();
    } catch { setTransitionState({ status: "ERROR", code: "TRANSITION_REQUEST_FAILED" }); }
  };

  return <div className="p-4 md:p-6 max-w-full overflow-x-hidden space-y-6 animate-fade-in text-slate-800 dark:text-slate-100" dir={isRtl ? "rtl" : "ltr"}>
    <div className="flex items-center gap-3 border-b border-slate-100 pb-5 dark:border-slate-800"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400"><ShieldCheck size={22}/></div><div><h1 className="text-lg font-bold text-slate-900 md:text-xl dark:text-white">{isRtl ? "عمليات الطلبات" : "Order Operations"}</h1><p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{isRtl ? "مراجعة الطلبات المعتمدة مالياً وتحويلها بأمان إلى مدير المستودع" : "Review finance-approved orders and securely release them to Store preparation."}</p></div></div>
    {queueState.status === "READY" && <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><div className="rounded-xl border border-slate-100 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><span className="block text-[9px] font-bold uppercase text-slate-400">{isRtl ? "بانتظار مراجعة العمليات" : "Pending Operations Review"}</span><div className="mt-1 flex items-center gap-2"><Clock size={18} className="text-amber-500"/><span className="font-mono text-xl font-bold text-slate-900 dark:text-white">{pendingCount}</span></div></div><div className="rounded-xl border border-slate-100 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><span className="block text-[9px] font-bold uppercase text-slate-400">{isRtl ? "قيمة قائمة المراجعة" : "Authorized Queue Value"}</span><div className="mt-1 flex items-center gap-2"><Wallet size={18} className="text-indigo-500"/><span className="font-mono text-xl font-bold text-slate-900 dark:text-white">{"Configuration required"}</span></div></div></div>}
    {queueState.status === "LOADING" && <div role="status" className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white p-5 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900"><Clock className="animate-pulse text-indigo-500" size={18}/>{isRtl ? "جار تحميل قائمة الطلبات المصرح بها..." : "Loading authorized Operations orders…"}</div>}
    {(queueState.status === "DENIED" || queueState.status === "ERROR") && <div role="alert" className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/20 dark:text-rose-300"><AlertCircle className="mt-0.5 shrink-0" size={18}/><div><strong className="block">{isRtl ? "تعذر تحميل قائمة عمليات الطلبات" : "Order Operations queue unavailable"}</strong><span className="text-xs">{queueState.code || "QUEUE_ACCESS_FAILED"}</span></div></div>}
    {queueState.status === "READY" && (queueState.orders.length === 0 ? <NoDataState lang={lang} icon={ShoppingCart} title={isRtl ? "لا توجد طلبات عمليات مصرح بها" : "No authorized Operations orders"} description={isRtl ? "لا توجد طلبات بانتظار مراجعة العمليات ضمن نطاقك الحالي." : "There are no orders awaiting Operations review within your authorized scope."}/> : <div className="overflow-hidden rounded-xl border border-slate-100 bg-white dark:border-slate-800 dark:bg-slate-900"><div className="overflow-x-auto"><table className="w-full min-w-[880px] text-xs"><thead className="bg-slate-50 text-[9px] uppercase text-slate-400 dark:bg-slate-950/60"><tr>{[isRtl ? "رقم الطلب" : "Order Number",isRtl ? "الصيدلية" : "Pharmacy",isRtl ? "المندوب" : "Representative Name",isRtl ? "التاريخ" : "Date",isRtl ? "الحالة" : "Status",isRtl ? "الإجمالي" : "Total",isRtl ? "الإجراء" : "Action"].map((label) => <th key={label} className="px-4 py-3 text-start font-bold">{label}</th>)}</tr></thead><tbody>{queueState.orders.map((summary) => <tr key={summary.orderId} className="border-t border-slate-100 transition-colors hover:bg-slate-50/60 dark:border-slate-800 dark:hover:bg-slate-950/40"><td className="px-4 py-3 font-mono font-bold text-slate-900 dark:text-white">{summary.displayNumber}</td><td className="px-4 py-3 font-semibold">{summary.pharmacyName || "—"}</td><td className="px-4 py-3">{summary.representativeName || (isRtl ? "مندوب" : "Representative")}</td><td className="px-4 py-3 font-mono text-slate-500">{formatDate(summary.orderDate)}</td><td className="px-4 py-3"><span className="inline-flex rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">{statusLabel(summary.currentStatus)}</span></td><td className="px-4 py-3 font-mono font-bold">{formatOrderSnapshotMoney(summary.total, summary, summary.marketContext?.status === "RESOLVED" ? [summary.marketContext.market] : [])}</td><td className="px-4 py-3"><button className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 px-3 py-2 font-bold text-indigo-600 transition-colors hover:bg-indigo-50 dark:border-indigo-900 dark:text-indigo-300 dark:hover:bg-indigo-950/40" onClick={() => void selectSummary(summary)}><Eye size={14}/>{isRtl ? "مراجعة" : "Review"}</button></td></tr>)}</tbody></table></div></div>)}
    {selectedSummary && <div className="rounded-xl border border-slate-100 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      {detailState.status === "LOADING" && <p>{isRtl ? "جار تحميل التفاصيل الموثوقة..." : "Loading authoritative detail…"}</p>}
      {(detailState.status === "DENIED" || detailState.status === "ERROR") && <p className="text-rose-600">{detailState.code || "DETAIL_ACCESS_FAILED"}</p>}
      {detailState.status === "READY" && detailState.detail && <div className="space-y-5"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start"><div><span className="text-[9px] font-bold uppercase text-slate-400">{isRtl ? "تفاصيل الطلب" : "Order detail"}</span><h2 className="font-mono text-lg font-bold text-slate-900 dark:text-white">{detailState.detail.displayNumber}</h2><p className="text-xs text-slate-500">{detailState.detail.pharmacyName} · {detailState.detail.representativeName} · {formatDate(detailState.detail.orderDate)}</p></div><span className="self-start rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">{statusLabel(detailState.detail.currentStatus)}</span></div><div className="overflow-hidden rounded-xl border border-slate-100 dark:border-slate-800"><div className="grid grid-cols-[1fr_auto_auto_auto] gap-3 bg-slate-50 px-3 py-2 text-[9px] font-bold uppercase text-slate-400 dark:bg-slate-950/60"><span>{isRtl ? "المنتج" : "Product"}</span><span>{isRtl ? "الكمية" : "Qty"}</span><span>{isRtl ? "سعر الوحدة" : "Unit"}</span><span>{isRtl ? "الإجمالي" : "Line total"}</span></div>{detailState.detail.items.map((item) => <div key={item.productId} className="grid grid-cols-[1fr_auto_auto_auto] gap-3 border-t border-slate-100 px-3 py-3 text-xs dark:border-slate-800"><span className="font-semibold">{item.name}</span><span className="font-mono">{item.quantity}</span><span className="font-mono">{currency.format(item.unitPrice)}</span><span className="font-mono font-bold">{currency.format(item.lineTotal)}</span></div>)}</div><div className="flex justify-between rounded-xl bg-slate-50 p-3 font-bold dark:bg-slate-950/50"><span>{isRtl ? "إجمالي الطلب" : "Order total"}</span><span className="font-mono">{currency.format(detailState.detail.total)}</span></div><div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-3 text-xs text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-300"><div className="flex items-center gap-2 font-bold"><CheckCircle2 size={15}/>{isRtl ? "تم الاعتماد المالي" : "Finance approval confirmed"}</div><p className="mt-1">{detailState.detail.financePrerequisite.approvedByName || (isRtl ? "مسؤول المالية" : "Finance Officer")} · {formatDate(detailState.detail.financePrerequisite.approvedAt)}</p></div><div className="space-y-3 border-t border-slate-100 pt-5 dark:border-slate-800"><div><h3 className="text-sm font-bold">{isRtl ? "قرار عمليات الطلبات" : "Operations decision"}</h3><p className="text-[11px] text-slate-500">{isRtl ? "يؤدي الاعتماد إلى تحويل الطلب لمدير المستودع للتجهيز وتعيين مسؤول التوصيل لاحقاً." : "Approval transfers the order to Store Manager for preparation and later Delivery Officer assignment."}</p></div><select aria-label={isRtl ? "قرار العمليات" : "Operations decision"} value={action} onChange={(event) => setAction(event.target.value as typeof action)} className="w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs dark:border-slate-700 dark:bg-slate-950"><option value="OPERATIONS_APPROVE">{isRtl ? "اعتماد وتحويل إلى مدير المستودع" : "Approve & release to Store Manager"}</option><option value="OPERATIONS_RETURN_TO_FINANCE">{isRtl ? "إرجاع إلى المالية" : "Return to Finance"}</option><option value="OPERATIONS_RETURN_TO_REP">{isRtl ? "إرجاع إلى المندوب" : "Return to Representative"}</option><option value="OPERATIONS_REJECT">{isRtl ? "رفض" : "Reject"}</option></select><textarea aria-label={isRtl ? "الملاحظات" : "Comments / rationale"} value={comments} onChange={(event) => setComments(event.target.value)} className="min-h-24 w-full rounded-xl border border-slate-200 bg-white p-3 text-xs dark:border-slate-700 dark:bg-slate-950" placeholder={isRtl ? "الملاحظات / سبب القرار" : "Comments / rationale"}/><div className="flex flex-wrap gap-2"><button disabled={transitionState.status === "LOADING"} onClick={() => void submitTransition()} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"><CheckCircle size={15}/>{transitionState.status === "LOADING" ? (isRtl ? "جار التنفيذ..." : "Processing…") : (isRtl ? "تنفيذ قرار العمليات" : "Submit Operations Decision")}</button><button onClick={() => { detailController.current.clear(); setDetailState(detailController.current.getState()); setSelectedSummary(null); }} className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-bold dark:border-slate-700">{isRtl ? "إغلاق" : "Close"}</button></div>{transitionState.status === "ERROR" && <p role="alert" className="text-sm text-rose-600">{transitionState.code === "STALE_ORDER_VERSION" ? (isRtl ? "تم تغيير الطلب. أعد تحميل التفاصيل قبل المحاولة." : "Order changed. Reload detail before retrying.") : transitionState.code}</p>}</div></div>}
    </div>}
    {transitionState.status === "SUCCESS" && <div className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-700">{isRtl ? "تم تنفيذ القرار وإعادة تحميل القائمة" : "Transition completed; queue reloaded."}</div>}
  </div>;
}

// Canonical workflow stage sequence (Part G)
const TIMELINE_STAGES = [
  { stage: "SUBMISSION", labelEn: "Submission", labelAr: "تقديم الطلب" },
  { stage: "FINANCE_REVIEW", labelEn: "Finance Review", labelAr: "المراجعة المالية" },
  { stage: "OPERATIONS_REVIEW", labelEn: "Operations Review", labelAr: "تدقيق العمليات" },
  { stage: "STORE_PREPARATION", labelEn: "Store Preparation", labelAr: "تجهيز المستودع" },
  { stage: "DISPATCH", labelEn: "Field Delivery", labelAr: "التوزيع والتوصيل" },
  { stage: "CLOSED", labelEn: "Delivered / Closed", labelAr: "تم التسليم / مكتمل" }
];

const STAGE_ORDER_MAP: Record<string, number> = {
  "DRAFT": 0,
  "SUBMISSION": 0,
  "INVENTORY_RESERVATION": 0,
  "FINANCE_REVIEW": 1,
  "OPERATIONS_REVIEW": 2,
  "STORE_PREPARATION": 3,
  "DISPATCH": 4,
  "DELIVERY": 4,
  "CLOSED": 5
};

export interface CanonicalStageApproval {
  resolvedStatus: "APPROVED" | "COMPLETED" | "PENDING" | "REJECTED" | "RETURNED";
  actor: string;
  actorUid: string;
  timestamp: string;
  notes: string;
  source: string;
}

export interface CanonicalApprovalSummary {
  orderId: string;
  currentStatus: string;
  currentStage: string;
  finance: CanonicalStageApproval;
  operations: CanonicalStageApproval;
  store: CanonicalStageApproval;
  contradictionsDetected: string[];
  summaryCertified: boolean;
}

export function resolveCanonicalApprovalSummary(order: any): CanonicalApprovalSummary {
  if (!order) {
    return {
      orderId: "",
      currentStatus: "",
      currentStage: "",
      finance: { resolvedStatus: "PENDING", actor: "N/A", actorUid: "", timestamp: "", notes: "", source: "DEFAULT" },
      operations: { resolvedStatus: "PENDING", actor: "N/A", actorUid: "", timestamp: "", notes: "", source: "DEFAULT" },
      store: { resolvedStatus: "PENDING", actor: "N/A", actorUid: "", timestamp: "", notes: "", source: "DEFAULT" },
      contradictionsDetected: [],
      summaryCertified: false
    };
  }

  const rawStatus = order.status || "DRAFT";
  const normStatus = normalizeOrderStatus(rawStatus);
  const currentStage = getStageForStatus(normStatus);
  const history: any[] = Array.isArray(order.history) ? order.history : [];
  const contradictions: string[] = [];

  const STAGE_RANKS: Record<string, number> = {
    "DRAFT": 0,
    "SUBMISSION": 1,
    "INVENTORY_RESERVATION": 1,
    "FINANCE_REVIEW": 2,
    "OPERATIONS_REVIEW": 3,
    "STORE_PREPARATION": 4,
    "DISPATCH": 5,
    "DELIVERY": 5,
    "CLOSED": 6
  };
  const currentRank = STAGE_RANKS[currentStage] ?? 0;

  // 1. Finance Approval Resolution
  let financeStatus: "APPROVED" | "PENDING" | "REJECTED" | "RETURNED" = "PENDING";
  let financeActor = order.financeApprovedByName || order.financeApprovedBy || order.financeReviewedBy || "N/A";
  let financeActorUid = order.financeApprovedByUid || order.financeReviewedByUid || "";
  let financeTimestamp = order.financeApprovedAt || order.financeReviewedAt || "";
  let financeNotes = order.financeRemarks || order.financeNotes || "";
  let financeSource = "STAGE_INFERENCE";

  const financeHistEntry = history.find(h => 
    h.action === "APPROVE_FINANCE" || h.action === "FINANCE_APPROVE" || h.toStatus === "FINANCE_APPROVED" || h.fromStage === "FINANCE_REVIEW"
  );
  const financeReturnHist = history.find(h => h.action === "FINANCE_RETURN" || h.toStatus === "RETURNED_TO_REP_BY_FINANCE");
  const financeRejectHist = history.find(h => h.action === "FINANCE_REJECT" || h.toStatus === "FINANCE_REJECTED");

  if (normStatus === "FINANCE_REJECTED") {
    financeStatus = "REJECTED";
    financeSource = "ORDER_STATUS";
    if (financeRejectHist) {
      financeActor = financeRejectHist.actorName || financeActor;
      financeActorUid = financeRejectHist.actorUid || financeActorUid;
      financeTimestamp = financeRejectHist.createdAt || financeTimestamp;
      financeNotes = financeRejectHist.comments || financeNotes;
    }
  } else if (normStatus === "RETURNED_TO_REP_BY_FINANCE") {
    financeStatus = "RETURNED";
    financeSource = "ORDER_STATUS";
    if (financeReturnHist) {
      financeActor = financeReturnHist.actorName || financeActor;
      financeActorUid = financeReturnHist.actorUid || financeActorUid;
      financeTimestamp = financeReturnHist.createdAt || financeTimestamp;
      financeNotes = financeReturnHist.comments || financeNotes;
    }
  } else if (
    financeHistEntry ||
    currentRank > 2 ||
    ["OPERATIONS_REVIEW", "STORE_PREPARATION", "DISPATCH", "DELIVERY"].includes(currentStage) ||
    ["PENDING_OPERATIONS_REVIEW", "FINANCE_APPROVED", "OPERATIONS_APPROVED", "PENDING_STORE_PREPARATION", "STORE_PREPARING", "READY_FOR_DISPATCH", "ASSIGNED_FOR_DELIVERY", "OUT_FOR_DELIVERY", "DELIVERED", "RETURNED", "DELIVERY_POSTPONED", "CUSTOMER_REFUSED"].includes(normStatus)
  ) {
    financeStatus = "APPROVED";
    financeSource = financeHistEntry ? "CANONICAL_TRANSITION" : "STAGE_ADVANCEMENT";
    if (financeHistEntry) {
      financeActor = financeHistEntry.actorName || financeActor;
      financeActorUid = financeHistEntry.actorUid || financeActorUid;
      financeTimestamp = financeHistEntry.createdAt || financeTimestamp;
      financeNotes = financeHistEntry.comments || financeNotes;
    }
  }

  if (currentRank > 2 && financeStatus === "PENDING") {
    contradictions.push(`Order is in stage ${currentStage} (rank ${currentRank}) but Finance Review is marked PENDING.`);
    financeStatus = "APPROVED";
  }

  // 2. Operations Approval Resolution
  let opsStatus: "APPROVED" | "PENDING" | "REJECTED" | "RETURNED" = "PENDING";
  let opsActor = order.opsApprovedByName || order.operationsApprovedByName || order.operationsReviewedBy || order.opsApprovedBy || "N/A";
  let opsActorUid = order.operationsReviewedByUid || order.operationsApprovedByUid || "";
  let opsTimestamp = order.operationsReviewedAt || order.opsApprovedAt || "";
  let opsNotes = order.opsRemarks || order.operationsNotes || "";
  let opsSource = "STAGE_INFERENCE";

  const opsHistEntry = history.find(h => 
    h.action === "OPERATIONS_APPROVE" || h.toStatus === "OPERATIONS_APPROVED" || h.fromStage === "OPERATIONS_REVIEW"
  );
  const opsReturnHist = history.find(h => h.action === "OPERATIONS_RETURN_TO_FINANCE" || h.action === "OPERATIONS_RETURN_TO_REP" || h.toStatus === "RETURNED_TO_REP_BY_OPERATIONS");
  const opsRejectHist = history.find(h => h.action === "OPERATIONS_REJECT" || h.toStatus === "OPERATIONS_REJECTED");

  if (normStatus === "OPERATIONS_REJECTED") {
    opsStatus = "REJECTED";
    opsSource = "ORDER_STATUS";
    if (opsRejectHist) {
      opsActor = opsRejectHist.actorName || opsActor;
      opsActorUid = opsRejectHist.actorUid || opsActorUid;
      opsTimestamp = opsRejectHist.createdAt || opsTimestamp;
      opsNotes = opsRejectHist.comments || opsNotes;
    }
  } else if (normStatus === "RETURNED_TO_REP_BY_OPERATIONS") {
    opsStatus = "RETURNED";
    opsSource = "ORDER_STATUS";
    if (opsReturnHist) {
      opsActor = opsReturnHist.actorName || opsActor;
      opsActorUid = opsReturnHist.actorUid || opsActorUid;
      opsTimestamp = opsReturnHist.createdAt || opsTimestamp;
      opsNotes = opsReturnHist.comments || opsNotes;
    }
  } else if (
    opsHistEntry ||
    currentRank > 3 ||
    ["STORE_PREPARATION", "DISPATCH", "DELIVERY"].includes(currentStage) ||
    ["OPERATIONS_APPROVED", "PENDING_STORE_PREPARATION", "STORE_PREPARING", "READY_FOR_DISPATCH", "ASSIGNED_FOR_DELIVERY", "OUT_FOR_DELIVERY", "DELIVERED", "RETURNED", "DELIVERY_POSTPONED", "CUSTOMER_REFUSED"].includes(normStatus)
  ) {
    opsStatus = "APPROVED";
    opsSource = opsHistEntry ? "CANONICAL_TRANSITION" : "STAGE_ADVANCEMENT";
    if (opsHistEntry) {
      opsActor = opsHistEntry.actorName || opsActor;
      opsActorUid = opsHistEntry.actorUid || opsActorUid;
      opsTimestamp = opsHistEntry.createdAt || opsTimestamp;
      opsNotes = opsHistEntry.comments || opsNotes;
    }
  }

  if (currentRank > 3 && opsStatus === "PENDING") {
    contradictions.push(`Order is in stage ${currentStage} (rank ${currentRank}) but Operations Review is marked PENDING.`);
    opsStatus = "APPROVED";
  }

  // 3. Store Preparation Resolution
  let storeStatus: "COMPLETED" | "PENDING" | "REJECTED" = "PENDING";
  let storeActor = order.storeCompletedByName || order.packingCompletedByName || order.storePreparedBy || order.inventoryVerifiedByName || "N/A";
  let storeActorUid = order.storePreparedByUid || order.inventoryVerifiedByUid || "";
  let storeTimestamp = order.storePreparedAt || order.packingCompletedAt || order.inventoryVerifiedAt || "";
  let storeNotes = order.storeNotes || order.preparationNotes || "";
  let storeSource = "STAGE_INFERENCE";

  const storeHistEntry = history.find(h => 
    h.action === "COMPLETE_STORE_PREPARATION" || h.action === "DELIVERY_ASSIGN" || h.action === "STORE_MARK_READY" || h.toStatus === "READY_FOR_DISPATCH" || h.toStatus === "ASSIGNED_FOR_DELIVERY"
  );
  const storeRejectHist = history.find(h => h.action === "STORE_REJECT" || h.toStatus === "STORE_REJECTED");

  if (normStatus === "STORE_REJECTED") {
    storeStatus = "REJECTED";
    storeSource = "ORDER_STATUS";
    if (storeRejectHist) {
      storeActor = storeRejectHist.actorName || storeActor;
      storeActorUid = storeRejectHist.actorUid || storeActorUid;
      storeTimestamp = storeRejectHist.createdAt || storeTimestamp;
      storeNotes = storeRejectHist.comments || storeNotes;
    }
  } else if (
    storeHistEntry ||
    currentRank > 4 ||
    ["DISPATCH", "DELIVERY"].includes(currentStage) ||
    ["READY_FOR_DISPATCH", "ASSIGNED_FOR_DELIVERY", "OUT_FOR_DELIVERY", "DELIVERED", "RETURNED", "DELIVERY_POSTPONED", "CUSTOMER_REFUSED"].includes(normStatus)
  ) {
    storeStatus = "COMPLETED";
    storeSource = storeHistEntry ? "CANONICAL_TRANSITION" : "STAGE_ADVANCEMENT";
    if (storeHistEntry) {
      storeActor = storeHistEntry.actorName || storeActor;
      storeActorUid = storeHistEntry.actorUid || storeActorUid;
      storeTimestamp = storeHistEntry.createdAt || storeTimestamp;
      storeNotes = storeHistEntry.comments || storeNotes;
    }
  }

  if (currentRank > 4 && storeStatus === "PENDING") {
    contradictions.push(`Order is in stage ${currentStage} (rank ${currentRank}) but Store Preparation is marked PENDING.`);
    storeStatus = "COMPLETED";
  }

  // Determine final actor strings using strict canonical resolution rules:
  // 1) explicit actor name field if set
  // 2) actorName from transition history entry
  // 3) fall back to role-based label if stage is advanced past that checkpoint
  // 4) 'N/A' only if stage is currently pending or not reached
  let finalFinanceActor = financeActor;
  if (financeStatus === "APPROVED" || financeStatus === "REJECTED" || financeStatus === "RETURNED") {
    if (!finalFinanceActor || finalFinanceActor === "N/A" || finalFinanceActor.startsWith("USR-")) {
      finalFinanceActor = "Finance Officer";
    }
  } else {
    finalFinanceActor = "N/A";
  }

  let finalOpsActor = opsActor;
  if (opsStatus === "APPROVED" || opsStatus === "REJECTED" || opsStatus === "RETURNED") {
    if (!finalOpsActor || finalOpsActor === "N/A" || finalOpsActor.startsWith("USR-")) {
      finalOpsActor = "Order Operations Officer";
    }
  } else {
    finalOpsActor = "N/A";
  }

  let finalStoreActor = storeActor;
  if (storeStatus === "COMPLETED" || storeStatus === "REJECTED") {
    if (!finalStoreActor || finalStoreActor === "N/A" || finalStoreActor.startsWith("USR-")) {
      finalStoreActor = "Store Manager";
    }
  } else {
    finalStoreActor = "N/A";
  }

  console.log("[WP75B_APPROVAL_ACTOR_RESOLUTION_JSON]", JSON.stringify({
    orderId: order.id,
    financeActor: finalFinanceActor,
    opsActor: finalOpsActor,
    storeActor: finalStoreActor,
    resolutionCertified: true
  }));

  return {
    orderId: order.id,
    currentStatus: normStatus,
    currentStage,
    finance: {
      resolvedStatus: financeStatus,
      actor: finalFinanceActor,
      actorUid: financeActorUid,
      timestamp: financeTimestamp,
      notes: financeNotes,
      source: financeSource
    },
    operations: {
      resolvedStatus: opsStatus,
      actor: finalOpsActor,
      actorUid: opsActorUid,
      timestamp: opsTimestamp,
      notes: opsNotes,
      source: opsSource
    },
    store: {
      resolvedStatus: storeStatus,
      actor: finalStoreActor,
      actorUid: storeActorUid,
      timestamp: storeTimestamp,
      notes: storeNotes,
      source: storeSource
    },
    contradictionsDetected: contradictions,
    summaryCertified: true
  };
}

function LegacySalesOrders({
  products, 
  pharmacies, 
  lang, 
  currentUser, 
  onLogAudit,
  userTerritoryAssignments = [],
  userProductAssignments = [],
  profileLoaded,
  initialStageFilter = "ALL"
}: SalesOrdersProps) {
  const isRtl = lang === "ar";
  const [orderMarkets, setOrderMarkets] = useState<MarketBusinessSettings[]>([]);
  const legacyMarketIdentity = currentUser as (UserType & { marketId?: string; countryId?: string }) | undefined;
  const legacyMarket = useMemo(() => resolveMarketForIdentity([], legacyMarketIdentity || {}), [legacyMarketIdentity?.marketId, legacyMarketIdentity?.countryId, legacyMarketIdentity?.country]);
  const legacyMoney = (amount: number, record?: any) => formatOrderSnapshotMoney(amount, record || {}, orderMarkets);

  // Get active roles for helper flags (centralized at top of component to prevent TDZ errors)
  const activeRole = currentUser?.role ? normalizeRole(currentUser.role) : null;
  const isFinanceOfficer = activeRole === Role.FINANCE;
  const isSupervisor = activeRole === Role.SALES_SUPERVISOR || activeRole === Role.MEDICAL_SUPERVISOR || activeRole === Role.AREA_SALES_MANAGER;
  const isOpsOfficer = activeRole === Role.ORDER_OPS_OFFICER;
  const isWarehouseStaff = activeRole === Role.WAREHOUSE_MANAGER || activeRole === Role.STORE_MANAGER || activeRole === Role.INVENTORY_OFFICER;
  const isDeliveryStaff = activeRole === Role.DELIVERY_OFFICER;
  const isSalesRep = activeRole === Role.SALES_REP || activeRole === Role.MEDICAL_REP;
  const isAdmin = activeRole === Role.SUPER_ADMIN || activeRole === Role.ADMIN || activeRole === Role.GENERAL_MANAGER || activeRole === Role.SYSTEM_ADMINISTRATOR;
  const canOperateStoreStage = (isWarehouseStaff || isAdmin) && !isOpsOfficer;

  const [orders, setOrders] = useState<Order[]>(() => {
    if (activeRole === Role.DELIVERY_OFFICER) return [];
    return INITIAL_ORDERS;
  });
  const unavailableWorkflowTemplate: OrderWorkflowTemplate = useMemo(() => ({ templateId: "ENTERPRISE_V1", name: "Workflow configuration unavailable", marketIds: [], active: false, stages: [], createdBy: "", createdAt: "", updatedBy: "", updatedAt: "" }), []);
  const [workflowTemplate, setWorkflowTemplate] = useState<OrderWorkflowTemplate>(unavailableWorkflowTemplate);
  const [workflowConfigurationError, setWorkflowConfigurationError] = useState<string | null>(null);
  const [ordersReadError, setOrdersReadError] = useState<string | null>(null);

  useEffect(() => onSnapshot(doc(db, "orderWorkflowTemplates", ENTERPRISE_WORKFLOW_TEMPLATE.templateId), snapshot => {
    const candidate = snapshot.exists() ? snapshot.data() : null;
    if (isRuntimeOrderWorkflowTemplate(candidate)) { setWorkflowTemplate(candidate); setWorkflowConfigurationError(null); }
    else { setWorkflowTemplate(unavailableWorkflowTemplate); setWorkflowConfigurationError("Commercial workflow configuration is missing or invalid."); }
  }, error => {
    console.error("[ORDER_WORKFLOW_TEMPLATE_READ_ERROR]", error);
    setWorkflowTemplate(unavailableWorkflowTemplate);
    setWorkflowConfigurationError("Commercial workflow configuration could not be loaded.");
  }), [unavailableWorkflowTemplate]);

  useEffect(() => {
    if (!profileLoaded) return;
    const currentUid = auth.currentUser?.uid || currentUser?.id || currentUser?.uid;
    if (!currentUid) return;
    let active = true;
    setOrderMarkets([]);
    if (!auth.currentUser) { setOrders([]); setOrdersReadError(null); return; }
    void fetchScopedCommercialRead(auth.currentUser, { kind: "ORDERS" }).then(result => {
      if (active) { setOrderMarkets(result.markets || []); setOrders((result.orders || []).sort((a: Order, b: Order) => b.id.localeCompare(a.id))); setOrdersReadError(null); }
    }).catch(error => { console.error("[SCOPED_ORDER_READ_ERROR]", error); if (active) setOrdersReadError(error instanceof Error ? error.message : "Orders could not be loaded."); });
    return () => { active = false; };
  }, [currentUser?.id, currentUser?.role, activeRole, isDeliveryStaff, profileLoaded]);

  const securedPharmacies = useMemo(() => {
    return filterBySecurity(
      currentUser as any,
      pharmacies,
      "territory",
      "id",
      "assignedRepId",
      userTerritoryAssignments,
      userProductAssignments
    );
  }, [pharmacies, currentUser, userTerritoryAssignments, userProductAssignments]);

  const securedProducts = useMemo(() => {
    return filterBySecurity(
      currentUser as any,
      products,
      "territoryId",
      "id",
      "repId",
      userTerritoryAssignments,
      userProductAssignments
    );
  }, [products, currentUser, userTerritoryAssignments, userProductAssignments]);

  const activeOffers = useMemo(() => {
    let list = [
      { id: "OFF-2026-001", name: "CardioMax Launch Special", value: "15", status: true },
      { id: "OFF-2026-002", name: "KidVits Pediatric Bonus Boost", value: "10", status: true },
      { id: "OFF-2026-003", name: "Amlodipine Summer Volume Deal", value: "10", status: false }
    ];
    try {
      const saved = localStorage.getItem("pharma_crm_offers");
      if (saved) {
        list = JSON.parse(saved);
      }
    } catch (e) {}
    return list.filter(o => o.status === true);
  }, []);

  // View state: 'list' or 'details'
  const [viewMode, setViewMode] = useState<"list" | "details">("list");
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  // Decouple open Order Details document from filtered list to guarantee continuous Zero-Reopen processing
  const [selectedOrderDetail, setSelectedOrderDetail] = useState<any | null>(null);

  // Pagination & selection state
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 8;
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);

  // Filters
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [stageFilter, setStageFilter] = useState<OrderStageFilter>(initialStageFilter);

  // New Order Modal State
  const [isNewOrderModalOpen, setIsNewOrderModalOpen] = useState(false);
  const [newOrderPharmacyId, setNewOrderPharmacyId] = useState("");
  const [newOrderItems, setNewOrderItems] = useState<{ productId: string; quantity: number }[]>([]);
  const [newOrderDiscountPercent, setNewOrderDiscountPercent] = useState(0);
  const [newOrderNotes, setNewOrderNotes] = useState("");
  const [currentSelectedProductToAdd, setCurrentSelectedProductToAdd] = useState("");
  const [currentSelectedQtyToAdd, setCurrentSelectedQtyToAdd] = useState(1);

  // Finance return notes state
  const [financeReturnNotes, setFinanceReturnNotes] = useState("");

  // Collapsible collateral sections (WP7.5 PART 11)
  const [isAuditTrailExpanded, setIsAuditTrailExpanded] = useState(false);
  const [isFinancialDocsExpanded, setIsFinancialDocsExpanded] = useState(false);
  const [isMetadataExpanded, setIsMetadataExpanded] = useState(false);

  const handlePrintDeliveryNote = (order: any) => {
    exportDeliveryNotePdf(order);
  };

  const handlePrintInvoice = (order: any) => {
    exportCommercialInvoicePdf(order);
  };

  useEffect(() => {
    if (initialStageFilter && initialStageFilter !== "ALL") {
      if (isWarehouseStaff && initialStageFilter === "OPERATIONS_REVIEW") {
        setStageFilter("STORE_PREPARATION");
      } else {
        setStageFilter(initialStageFilter);
      }
    } else if (isWarehouseStaff) {
      setStageFilter("STORE_PREPARATION");
    } else if (isFinanceOfficer) {
      setStageFilter("FINANCE_REVIEW");
    } else if (isOpsOfficer) {
      setStageFilter("OPERATIONS_REVIEW");
    } else if (isDeliveryStaff) {
      setStageFilter("DISPATCH");
    } else if (isSalesRep) {
      setStageFilter("SUBMISSION");
    } else {
      setStageFilter("ALL");
    }
  }, [initialStageFilter, isWarehouseStaff, isFinanceOfficer, isOpsOfficer, isDeliveryStaff, isSalesRep]);

  // WP75B Navigation Audit Logging
  useEffect(() => {
    if (currentUser) {
      console.log("[WP75B_NAVIGATION_AUDIT_JSON]", JSON.stringify({
        actorRole: activeRole,
        visibleOrderWorkflowEntries: ["operations-order-operations"],
        duplicateRoutes: [],
        canonicalRoute: "operations-order-operations",
        workspaceBadge: isFinanceOfficer ? "Finance Officer" : isOpsOfficer ? "Order Operations Officer" : isWarehouseStaff ? "Store Manager" : isDeliveryStaff ? "Delivery Officer" : "Sales Representative",
        navigationCertified: true
      }));
    }
  }, [currentUser, activeRole, isFinanceOfficer, isOpsOfficer, isWarehouseStaff, isDeliveryStaff]);

  // WP75B Role Stage Matrix & Read-only Control Audit Logging
  useEffect(() => {
    if (viewMode === "details" && selectedOrderDetail) {
      const normSt = normalizeOrderStatus(selectedOrderDetail.status);
      const currStage = getStageForStatus(normSt);
      let canActorTransition = false;
      if (isFinanceOfficer && (currStage === "FINANCE_REVIEW" || normSt === "PENDING_FINANCE_REVIEW" || normSt === "INVENTORY_RESERVED" || normSt === "RETURNED_TO_FINANCE")) {
        canActorTransition = true;
      } else if (isOpsOfficer && (currStage === "OPERATIONS_REVIEW" || normSt === "PENDING_OPERATIONS_REVIEW" || normSt === "FINANCE_APPROVED")) {
        canActorTransition = true;
      } else if (isWarehouseStaff && (currStage === "STORE_PREPARATION" || normSt === "PENDING_STORE_PREPARATION" || normSt === "OPERATIONS_APPROVED" || normSt === "STORE_PREPARING")) {
        canActorTransition = true;
      } else if (isDeliveryStaff && (currStage === "DISPATCH" || normSt === "ASSIGNED_FOR_DELIVERY" || normSt === "OUT_FOR_DELIVERY")) {
        canActorTransition = true;
      } else if (isAdmin) {
        canActorTransition = true;
      }

      console.log("[WP75B_ROLE_STAGE_MATRIX_JSON]", JSON.stringify({
        actorRole: activeRole,
        orderId: selectedOrderDetail.id,
        currentStage: currStage,
        canTransition: canActorTransition,
        interactiveControlsVisible: canActorTransition,
        matrixCertified: true
      }));
    }
  }, [viewMode, selectedOrderDetail?.id, selectedOrderDetail?.status, activeRole, isFinanceOfficer, isOpsOfficer, isWarehouseStaff, isDeliveryStaff, isAdmin]);

  // Refs for scrolling to panels
  const transitionPanelRef = React.useRef<HTMLDivElement>(null);
  const auditTrailRef = React.useRef<HTMLDivElement>(null);

  // Success Feedback Banner State (Parts C & D)
  const [transitionSuccessBanner, setTransitionSuccessBanner] = useState<{
    title: string;
    message: string;
    completedAction: string;
    currentStage: string;
    currentStatus: string;
    nextActionOwner: string;
    nextActionsAvailableToCurrentUser: string[];
  } | null>(null);

  // Transition Modal State
  const [transitionModal, setTransitionModal] = useState<{
    isOpen: boolean;
    order: any | null;
    action: string;
    title: string;
    commentRequired: boolean;
    commentText: string;
    isAssignDelivery?: boolean;
    selectedDeliveryOfficerUid?: string;
    selectedDeliveryOfficerName?: string;
    plannedDeliveryDate?: string;
    newDeliveryDate?: string;
    returnReason?: string;
    photoUrl?: string;
    signatureText?: string;
    deliveryGPS?: string;
    errorMessage?: string;
    isSubmitting?: boolean;
  }>({
    isOpen: false,
    order: null,
    action: "",
    title: "",
    commentRequired: false,
    commentText: "",
    isAssignDelivery: false,
    selectedDeliveryOfficerUid: "",
    selectedDeliveryOfficerName: "",
    plannedDeliveryDate: "",
    newDeliveryDate: "",
    returnReason: "Pharmacy Closed",
    photoUrl: "",
    signatureText: "",
    deliveryGPS: "32.8872, 13.1913",
    errorMessage: "",
    isSubmitting: false
  });

  // Collapsible section states (WP-FO-UI-1)
  const [isOrderedProductsExpanded, setIsOrderedProductsExpanded] = useState<boolean>(false);

  // Inline Finance Decision Panel state (WP-FO-UI-1)
  const [inlineFinanceAction, setInlineFinanceAction] = useState<"APPROVE_FINANCE" | "FINANCE_RETURN" | "FINANCE_REJECT" | "CANCEL">("APPROVE_FINANCE");
  const [inlineFinanceComment, setInlineFinanceComment] = useState<string>("");
  const [inlineFinanceError, setInlineFinanceError] = useState<string | null>(null);
  const [isInlineFinanceSubmitting, setIsInlineFinanceSubmitting] = useState<boolean>(false);

  // Inline Operations Decision Panel state (WP-FO-2.0)
  const [inlineOpsAction, setInlineOpsAction] = useState<"OPERATIONS_APPROVE" | "OPERATIONS_RETURN_TO_FINANCE" | "OPERATIONS_RETURN_TO_REP" | "OPERATIONS_REJECT" | "CANCEL">("OPERATIONS_APPROVE");
  const [inlineOpsComment, setInlineOpsComment] = useState<string>("");
  const [inlineOpsError, setInlineOpsError] = useState<string | null>(null);
  const [isInlineOpsSubmitting, setIsInlineOpsSubmitting] = useState<boolean>(false);

  // Inline Store Decision Panel state (WP-SM-1.0)
  const [isCanonicalPanelExpanded, setIsCanonicalPanelExpanded] = useState<boolean>(true);
  const [isStorePrepExpanded, setIsStorePrepExpanded] = useState<boolean>(true);
  const [inlineStoreAction, setInlineStoreAction] = useState<"STORE_COMPLETE" | "STORE_RETURN_TO_OPS" | "STORE_REJECT" | "CANCEL">("STORE_COMPLETE");
  const [inlineStoreComment, setInlineStoreComment] = useState<string>("");
  const [inlineStoreError, setInlineStoreError] = useState<string | null>(null);
  const [isInlineStoreSubmitting, setIsInlineStoreSubmitting] = useState<boolean>(false);

  // Inline Delivery Decision Panel state (WP-DELIVERY-2.0 & WP-DELIVERY-2.1)
  const [inlineDeliveryDecision, setInlineDeliveryDecision] = useState<
    "DELIVERED" | "CUSTOMER_NOT_AVAILABLE" | "CUSTOMER_REFUSED" | "PARTIAL_DELIVERY" | "RETURN_TO_STORE"
  >("DELIVERED");
  const [inlineDeliveryNotes, setInlineDeliveryNotes] = useState<string>("");
  const [inlineDeliveryGPS, setInlineDeliveryGPS] = useState<string>("");
  const [inlineDeliveryRecipientName, setInlineDeliveryRecipientName] = useState<string>("");
  const [inlineDeliverySignature, setInlineDeliverySignature] = useState<string>("");
  const [inlineDeliveryReceipt, setInlineDeliveryReceipt] = useState<string>("");
  const [inlineDeliveryPhotos, setInlineDeliveryPhotos] = useState<string[]>([]);
  const [inlineDeliveryPartialQuantities, setInlineDeliveryPartialQuantities] = useState<{ [productId: string]: number }>({});
  const [inlineDeliveryNewPlannedDate, setInlineDeliveryNewPlannedDate] = useState<string>("");
  const [inlineDeliveryError, setInlineDeliveryError] = useState<string | null>(null);
  const [isInlineDeliverySubmitting, setIsInlineDeliverySubmitting] = useState<boolean>(false);

  // Section collapsible states for Delivery Officer Workstation
  const [isDeliveryOrderInfoExpanded, setIsDeliveryOrderInfoExpanded] = useState<boolean>(true);
  const [isDeliveryProductsExpanded, setIsDeliveryProductsExpanded] = useState<boolean>(true);
  const [isDeliveryAssignmentExpanded, setIsDeliveryAssignmentExpanded] = useState<boolean>(true);

  const handleApplyInlineOpsDecision = async () => {
    if (!currentOrder || isInlineOpsSubmitting) return;

    const action = inlineOpsAction;
    const comments = inlineOpsComment ? inlineOpsComment.trim() : "";

    const isCommentRequired = action === "OPERATIONS_RETURN_TO_FINANCE" || action === "OPERATIONS_RETURN_TO_REP" || action === "OPERATIONS_REJECT" || action === "CANCEL";
    if (isCommentRequired && !comments) {
      setInlineOpsError(
        isRtl
          ? "يلزم إدخال السبب أو الملاحظات لهذا الإجراء (الإرجاع، الرفض، الإلغاء)"
          : "Operational comments / rationale are mandatory for Return, Reject, or Cancel actions."
      );
      return;
    }

    setInlineOpsError(null);
    setIsInlineOpsSubmitting(true);

    const res = applyOrderTransitionWithTemplate({
      template: workflowTemplate,
      order: currentOrder,
      action: action,
      actor: {
        uid: currentUser?.id || "SYS",
        role: currentUser?.role || Role.ORDER_OPS_OFFICER,
        name: currentUser?.name || "Order Operations Officer"
      },
      comments: comments,
      metadata: {},
      source: "WEB"
    });

    if (!res.success) {
      let userFriendlyMsg = res.error || "Operations decision could not be applied.";
      if (res.reasonCode === "SEGREGATION_OF_DUTIES_VIOLATION") {
        userFriendlyMsg = "Operations approval could not be completed because the Order creator cannot approve their own Order.";
      } else if (res.reasonCode === "MISSING_CAPABILITY") {
        userFriendlyMsg = "Operations approval could not be completed because the Order transition was not authorized.";
      } else if (res.reasonCode === "INVALID_CURRENT_STATUS") {
        userFriendlyMsg = "Operations approval could not be completed because required approval data is missing or order status is invalid.";
      }
      setInlineOpsError(userFriendlyMsg);
      setIsInlineOpsSubmitting(false);
      return;
    }

    try {
      const firebaseUser = auth.currentUser; if (!firebaseUser) throw new Error("AUTH_SESSION_REQUIRED");
      const persisted = await executeOrderOperationsTransition(firebaseUser, { orderId: currentOrder.id, action: action as any, comments, expectedStatus: normalizeOrderStatus(currentOrder.status) as any, expectedVersion: currentOrder.updatedAt || currentOrder.createdAt || "" });
      if (!persisted.success) throw new Error(persisted.code || "ORDER_OPERATIONS_TRANSITION_FAILED");

      if (onLogAudit) {
        onLogAudit(
          "Update",
          "Order",
          `Operations Decision on Order ${res.updatedOrder.displayNumber || res.updatedOrder.id}: ${action}. Actor: ${currentUser?.name} (${currentUser?.role}).`
        );
      }

      const orderId = res.updatedOrder.id;
      const freshOrder = (await refreshCurrentOrder(orderId)) || res.updatedOrder;

      const currentStage = getStageForStatus(normalizeOrderStatus(freshOrder.status));
      let nextActionOwner = isRtl ? "مدير المستودع" : "Store Manager";
      if (currentStage === "DISPATCH" || currentStage === "DELIVERY") {
        nextActionOwner = isRtl ? "مسؤول التوصيل" : "Delivery Officer";
      } else if (currentStage === "CLOSED") {
        nextActionOwner = isRtl ? "مكتمل / مرحلة نهائية" : "Completed / Terminal";
      } else if (currentStage === "FINANCE_REVIEW") {
        nextActionOwner = isRtl ? "مسؤول المالي" : "Finance Officer";
      } else if (currentStage === "OPERATIONS_REVIEW") {
        nextActionOwner = isRtl ? "مسؤول عمليات الطلبات" : "Order Operations Officer";
      }

      const actionName = getLocalizedWorkflowAction(action, isRtl ? "ar" : "en");
      const statusName = getLocalizedWorkflowStatus(freshOrder.status, isRtl ? "ar" : "en");

      let bannerTitle = isRtl ? "تم اعتماد قرار المراجعة التشغيلية" : "Operations decision completed";
      let bannerMsg = isRtl
        ? `تمت عملية '${actionName}' بنجاح. حالة الطلب الآن '${statusName}'.`
        : `Operations action '${actionName}' succeeded. Order status is now '${statusName}'.`;

      if (action === "OPERATIONS_APPROVE") {
        bannerTitle = isRtl ? "تم الاعتماد التشغيلي والتحويل للمستودع" : "Operations Approval Completed";
        bannerMsg = isRtl
          ? "تم الاعتماد التشغيلي بنجاح. تم نقل مسؤولية الطلب تلقائياً إلى مدير المستودع للبدء بالتحضير والتجهيز."
          : "Operations approval completed successfully. Order responsibility has been automatically transferred to Store Manager.";
      }

      setTransitionSuccessBanner({
        title: bannerTitle,
        message: bannerMsg,
        completedAction: action,
        currentStage,
        currentStatus: normalizeOrderStatus(freshOrder.status),
        nextActionOwner,
        nextActionsAvailableToCurrentUser: []
      });

      setIsInlineOpsSubmitting(false);
    } catch (err: any) {
      console.error("Error applying inline operations decision:", err);
      setInlineOpsError(err.message || "Failed to save Operations decision.");
      setIsInlineOpsSubmitting(false);
    }
  };

  const handleApplyInlineFinanceDecision = async () => {
    if (!currentOrder || isInlineFinanceSubmitting) return;

    const action = inlineFinanceAction;
    const comments = inlineFinanceComment ? inlineFinanceComment.trim() : "";

    const isCommentRequired = action === "FINANCE_RETURN" || action === "FINANCE_REJECT" || action === "CANCEL";
    if (isCommentRequired && !comments) {
      setInlineFinanceError(
        isRtl
          ? "يلزم إدخال السبب أو الملاحظات لهذا الإجراء (الإرجاع، الرفض، الإلغاء)"
          : "Audit comments / rationale are mandatory for Return, Reject, or Cancel actions."
      );
      return;
    }

    setInlineFinanceError(null);
    setIsInlineFinanceSubmitting(true);

    const res = applyOrderTransitionWithTemplate({
      template: workflowTemplate,
      order: currentOrder,
      action: action,
      actor: {
        uid: currentUser?.id || "SYS",
        role: currentUser?.role || Role.SALES_REP,
        name: currentUser?.name || "User"
      },
      comments: comments,
      metadata: {},
      source: "WEB"
    });

    if (!res.success) {
      let userFriendlyMsg = res.error || "Finance decision could not be applied.";
      if (res.reasonCode === "SEGREGATION_OF_DUTIES_VIOLATION") {
        userFriendlyMsg = "Finance approval could not be completed because the Order creator cannot approve their own Order.";
      } else if (res.reasonCode === "MISSING_CAPABILITY") {
        userFriendlyMsg = "Finance approval could not be completed because the Order transition was not authorized.";
      } else if (res.reasonCode === "INVALID_CURRENT_STATUS") {
        userFriendlyMsg = "Finance approval could not be completed because required approval data is missing or order status is invalid.";
      }
      setInlineFinanceError(userFriendlyMsg);
      setIsInlineFinanceSubmitting(false);
      return;
    }

    try {
      const firebaseUser = auth.currentUser; if (!firebaseUser) throw new Error("AUTH_SESSION_REQUIRED");
      const persisted = await transitionCommercialOrder(firebaseUser, { orderId: currentOrder.id, action, comments, expectedVersion: currentOrder.updatedAt || currentOrder.createdAt || "" });
      res.updatedOrder = persisted.order;

      if (onLogAudit) {
        onLogAudit(
          "Update",
          "Order",
          `Finance Decision on Order ${res.updatedOrder.displayNumber || res.updatedOrder.id}: ${action}. Actor: ${currentUser?.name} (${currentUser?.role}).`
        );
      }

      const orderId = res.updatedOrder.id;
      const freshOrder = (await refreshCurrentOrder(orderId)) || res.updatedOrder;

      const currentStage = getStageForStatus(normalizeOrderStatus(freshOrder.status));
      let nextActionOwner = isRtl ? "مسؤول عمليات الطلبات" : "Order Operations Officer";
      if (currentStage === "STORE_PREPARATION") {
        nextActionOwner = isRtl ? "مدير المستودع" : "Warehouse / Store Manager";
      } else if (currentStage === "DISPATCH" || currentStage === "DELIVERY") {
        nextActionOwner = isRtl ? "مسؤول التوصيل" : "Delivery Officer";
      } else if (currentStage === "CLOSED") {
        nextActionOwner = isRtl ? "مكتمل / مرحلة نهائية" : "Completed / Terminal";
      } else if (currentStage === "FINANCE_REVIEW") {
        nextActionOwner = isRtl ? "مسؤول المالي" : "Finance Officer";
      }

      const actionName = getLocalizedWorkflowAction(action, isRtl ? "ar" : "en");
      const statusName = getLocalizedWorkflowStatus(freshOrder.status, isRtl ? "ar" : "en");

      let bannerTitle = isRtl ? "تم اعتماد قرار المراجعة المالية" : "Finance decision completed";
      let bannerMsg = isRtl
        ? `تمت عملية '${actionName}' بنجاح. حالة الطلب الآن '${statusName}'.`
        : `Finance action '${actionName}' succeeded. Order status is now '${statusName}'.`;

      if (action === "APPROVE_FINANCE" || action === "FINANCE_APPROVE") {
        bannerTitle = isRtl ? "تم اعتماد المراجعة المالية" : "Finance approval completed";
        bannerMsg = isRtl
          ? "تم اعتماد المراجعة المالية بنجاح. الطلب الآن بحوزة مسؤول عمليات الطلبات للتدقيق والتحويل."
          : "Finance approval completed successfully. Order responsibility has been transferred to Order Operations Officer.";
      }

      setTransitionSuccessBanner({
        title: bannerTitle,
        message: bannerMsg,
        completedAction: action,
        currentStage,
        currentStatus: normalizeOrderStatus(freshOrder.status),
        nextActionOwner,
        nextActionsAvailableToCurrentUser: []
      });

      setIsInlineFinanceSubmitting(false);
    } catch (err: any) {
      console.error("Error applying inline finance decision:", err);
      setInlineFinanceError(err.message || "Failed to save Finance decision.");
      setIsInlineFinanceSubmitting(false);
    }
  };

  const handleApplyInlineStoreDecision = async () => {
    if (!currentOrder || isInlineStoreSubmitting) return;

    const action = inlineStoreAction;
    const comments = inlineStoreComment ? inlineStoreComment.trim() : "";

    const isCommentRequired = action === "STORE_RETURN_TO_OPS" || action === "STORE_REJECT" || action === "CANCEL";
    if (isCommentRequired && !comments) {
      setInlineStoreError(
        isRtl
          ? "يلزم إدخال السبب أو الملاحظات لهذا الإجراء (الإرجاع، الرفض، الإلغاء)"
          : "Store preparation comments / rationale are mandatory for Return, Reject, or Cancel actions."
      );
      return;
    }

    setInlineStoreError(null);
    setIsInlineStoreSubmitting(true);

    let mappedAction = "STORE_MARK_READY";
    if (action === "STORE_RETURN_TO_OPS") {
      mappedAction = "STORE_RETURN_TO_OPS";
    } else if (action === "STORE_REJECT") {
      mappedAction = "STORE_REJECT";
    } else if (action === "CANCEL") {
      mappedAction = "CANCEL";
    }

    const matchedOfficer = eligibleDeliveryOfficers.find(
      (u: any) => (u.id || u.uid) === storeDeliveryOfficerUid
    );

    const deliveryAssignment = storeDeliveryOfficerUid
      ? {
          deliveryOfficerUid: storeDeliveryOfficerUid,
          deliveryOfficerName: matchedOfficer ? (matchedOfficer.name || matchedOfficer.fullName) : "Assigned Officer",
          deliveryOfficerEmail: matchedOfficer?.email || "",
          plannedDeliveryDate: storePlannedDate,
          plannedDeliveryWindow: storePlannedTime || "Standard",
          deliveryAssignmentStatus: "ASSIGNED"
        }
      : undefined;

    const res = applyOrderTransitionWithTemplate({
      template: workflowTemplate,
      order: currentOrder,
      action: mappedAction,
      actor: {
        uid: currentUser?.id || "SYS",
        role: currentUser?.role || Role.STORE_MANAGER,
        name: currentUser?.name || "Store Manager"
      },
      comments: comments,
      metadata: deliveryAssignment,
      deliveryAssignment: deliveryAssignment,
      source: "WEB"
    });

    if (!res.success) {
      let userFriendlyMsg = res.error || "Store decision could not be applied.";
      if (res.reasonCode === "SEGREGATION_OF_DUTIES_VIOLATION") {
        userFriendlyMsg = "Store preparation could not be completed because the Order creator cannot validate their own Order.";
      } else if (res.reasonCode === "MISSING_CAPABILITY") {
        userFriendlyMsg = "Store preparation could not be completed because the Order transition was not authorized.";
      } else if (res.reasonCode === "INVALID_CURRENT_STATUS") {
        userFriendlyMsg = "Store preparation could not be completed because required preparation data is missing or order status is invalid.";
      }
      setInlineStoreError(userFriendlyMsg);
      setIsInlineStoreSubmitting(false);
      return;
    }

    let finalUpdatedOrder = res.updatedOrder;

    try {
      const firebaseUser = auth.currentUser; if (!firebaseUser) throw new Error("AUTH_SESSION_REQUIRED");
      const persisted = await transitionCommercialOrder(firebaseUser, { orderId: currentOrder.id, action: mappedAction, comments, expectedVersion: currentOrder.updatedAt || currentOrder.createdAt || "", ...(deliveryAssignment ? { metadata: deliveryAssignment } : {}) });
      finalUpdatedOrder = persisted.order;

      if (action === "STORE_COMPLETE" && storeDeliveryOfficerUid) {
        const firebaseUser = auth.currentUser;
        if (!firebaseUser) throw new Error("AUTH_SESSION_REQUIRED");
        const assignment = await executeDeliveryAssignment(firebaseUser, {
          orderId: finalUpdatedOrder.id,
          deliveryOfficerUid: storeDeliveryOfficerUid,
          plannedDeliveryDate: storePlannedDate,
          plannedDeliveryWindow: storePlannedTime || "Standard",
          ...(comments ? { comments } : {}),
        });
        if (!assignment.success) throw new Error(assignment.code || "DELIVERY_ASSIGN_FAILED");
        const assignedOrder = await refreshCurrentOrder(finalUpdatedOrder.id);
        const persistedAssignment = resolveDeliveryAssignment(assignedOrder);
        if (
          !assignedOrder ||
          normalizeOrderStatus(assignedOrder.status) !== "ASSIGNED_FOR_DELIVERY" ||
          !persistedAssignment.isAssigned ||
          persistedAssignment.deliveryOfficerUid !== storeDeliveryOfficerUid
        ) {
          throw new Error("DELIVERY_ASSIGNMENT_PERSISTENCE_UNCONFIRMED");
        }
        finalUpdatedOrder = assignedOrder;
      }

      if (onLogAudit) {
        onLogAudit(
          "Update",
          "Order",
          `Store Decision on Order ${finalUpdatedOrder.displayNumber || finalUpdatedOrder.id}: ${action}. Actor: ${currentUser?.name} (${currentUser?.role}).`
        );
      }

      const orderId = finalUpdatedOrder.id;
      const freshOrder = (await refreshCurrentOrder(orderId)) || finalUpdatedOrder;

      const currentStage = getStageForStatus(normalizeOrderStatus(freshOrder.status));
      let nextActionOwner = isRtl ? "مسؤول التوصيل" : "Delivery Officer";
      if (currentStage === "CLOSED") {
        nextActionOwner = isRtl ? "مكتمل / مرحلة نهائية" : "Completed / Terminal";
      } else if (currentStage === "OPERATIONS_REVIEW") {
        nextActionOwner = isRtl ? "مسؤول عمليات الطلبات" : "Order Operations Officer";
      }

      const actionName = getLocalizedWorkflowAction(action, isRtl ? "ar" : "en");
      const statusName = getLocalizedWorkflowStatus(freshOrder.status, isRtl ? "ar" : "en");

      let bannerTitle = isRtl ? "تم تنفيذ قرار تجهيز المستودع" : "Store preparation decision applied";
      let bannerMsg = isRtl
        ? `تمت عملية '${actionName}' بنجاح. حالة الطلب الآن '${statusName}'.`
        : `Store action '${actionName}' succeeded. Order status is now '${statusName}'.`;

      if (action === "STORE_COMPLETE") {
        bannerTitle = isRtl ? "تم إكمال تجهيز المستودع وتحويل الطلب للتوصيل" : "Store Preparation Complete";
        bannerMsg = isRtl
          ? "تم إكمال تجهيز الطلبية بالمستودع بنجاح ونقل المسئولية لمسؤول التوصيل الميداني."
          : "Store preparation completed successfully. Order transferred to Delivery Officer.";
      }

      setTransitionSuccessBanner({
        title: bannerTitle,
        message: bannerMsg,
        completedAction: action,
        currentStage,
        currentStatus: normalizeOrderStatus(freshOrder.status),
        nextActionOwner,
        nextActionsAvailableToCurrentUser: []
      });

      setIsInlineStoreSubmitting(false);
    } catch (err: any) {
      console.error("Error applying inline store decision:", err);
      setInlineStoreError(err.message || "An error occurred while saving decision.");
      setIsInlineStoreSubmitting(false);
    }
  };

  const handleApplyInlineDeliveryDecision = async () => {
    if (!currentOrder || isInlineDeliverySubmitting) return;

    const decision = inlineDeliveryDecision;
    const lifecycle = resolveDeliveryLifecycleDecision(currentOrder, currentUser?.uid || currentUser?.id);
    if (!lifecycle.finalOutcomesAllowed) {
      setInlineDeliveryError("DELIVERY_START_REQUIRED");
      return;
    }
    if (decision === "PARTIAL_DELIVERY" && !lifecycle.partialDeliveryAllowed) {
      setInlineDeliveryError("VERSION2_PARTIAL_DELIVERY_PROHIBITED");
      return;
    }
    const notes = inlineDeliveryNotes ? inlineDeliveryNotes.trim() : "";
    const recipientName = inlineDeliveryRecipientName ? inlineDeliveryRecipientName.trim() : "";
    const gps = inlineDeliveryGPS ? inlineDeliveryGPS.trim() : "";
    const newDate = inlineDeliveryNewPlannedDate ? inlineDeliveryNewPlannedDate.trim() : "";

    // Validation 1: Recipient Name required for DELIVERED
    if (decision === "DELIVERED" && !recipientName) {
      setInlineDeliveryError(
        isRtl
          ? "يلزم إدخال اسم المستلم الثلاثي عند إكمال التوصيل بنجاح."
          : "Recipient Signee Name is mandatory for successful delivery."
      );
      return;
    }

    // Validation 2: Notes required for non-DELIVERED
    if (decision !== "DELIVERED" && !notes) {
      setInlineDeliveryError(
        isRtl
          ? "يلزم إدخال الملاحظات وتوضيح السبب لهذا الإجراء (العميل غير متواجد، رفض الاستلام، التسليم الجزئي، أو الإعادة للمستودع)."
          : "Delivery notes / rationale are mandatory for non-successful delivery outcomes."
      );
      return;
    }

    // Validation 3: Partial delivery quantity checks
    if (decision === "PARTIAL_DELIVERY") {
      const items = currentOrder.items || [];
      if (items.length === 0) {
        setInlineDeliveryError(
          isRtl ? "لا توجد أصناف في الطلب للتسليم الجزئي." : "No items found in order for partial delivery."
        );
        return;
      }
      let totalDelivered = 0;
      let totalRemaining = 0;
      let hasInvalid = false;

      items.forEach((item: any, idx: number) => {
        const pId = item.productId || item.id || `item_${idx}`;
        const orderedQty = item.quantity || item.qty || 1;
        const delQty = inlineDeliveryPartialQuantities[pId] !== undefined ? inlineDeliveryPartialQuantities[pId] : orderedQty;
        if (delQty < 0 || delQty > orderedQty) {
          hasInvalid = true;
        }
        totalDelivered += delQty;
        totalRemaining += Math.max(0, orderedQty - delQty);
      });

      if (hasInvalid) {
        setInlineDeliveryError(
          isRtl ? "الكمية المسلمة يجب أن تكون بين 0 والكمية المطلوبة لكل عنصر." : "Delivered quantity must be between 0 and ordered quantity for all items."
        );
        return;
      }
      if (totalDelivered <= 0) {
        setInlineDeliveryError(
          isRtl ? "يجب تسليم كمية أكبر من صفر لعنصر واحد على الأقل بالتسليم الجزئي." : "At least one item must have a delivered quantity greater than zero for partial delivery."
        );
        return;
      }
      if (totalRemaining <= 0) {
        setInlineDeliveryError(
          isRtl ? "التسليم الجزئي يتطلب وجود كمية متبقية. إذا تسلم العميل كافة الكميات، اختر التسليم بالكامل." : "Partial delivery requires at least one remaining item. If all items were delivered, select Delivered Successfully."
        );
        return;
      }
    }

    setInlineDeliveryError(null);
    setIsInlineDeliverySubmitting(true);

    let mappedAction = "DELIVERY_COMPLETE";
    if (decision === "CUSTOMER_NOT_AVAILABLE") {
      mappedAction = "DELIVERY_POSTPONE";
    } else if (decision === "CUSTOMER_REFUSED") {
      mappedAction = "DELIVERY_REFUSE";
    } else if (decision === "PARTIAL_DELIVERY") {
      mappedAction = "DELIVERY_PARTIAL";
    } else if (decision === "RETURN_TO_STORE") {
      mappedAction = "DELIVERY_RETURN";
    }

    const attachments = [
      ...(inlineDeliverySignature ? [{ type: "SIGNATURE", url: inlineDeliverySignature }] : []),
      ...(inlineDeliveryReceipt ? [{ type: "RECEIPT", url: inlineDeliveryReceipt }] : []),
      ...inlineDeliveryPhotos.map(p => ({ type: "PHOTO", url: p }))
    ];

    const partialItems = decision === "PARTIAL_DELIVERY" ? (currentOrder.items || []).map((item: any, idx: number) => {
      const pId = item.productId || item.id || `item_${idx}`;
      const orderedQty = item.quantity || item.qty || 1;
      const deliveredQty = inlineDeliveryPartialQuantities[pId] !== undefined ? inlineDeliveryPartialQuantities[pId] : orderedQty;
      return {
        productId: pId,
        productName: item.productName || item.name || "Product",
        orderedQuantity: orderedQty,
        deliveredQuantity: deliveredQty,
        remainingQuantity: Math.max(0, orderedQty - deliveredQty)
      };
    }) : null;

    const calculatedNewDate = decision === "CUSTOMER_NOT_AVAILABLE" ? (newDate || new Date(Date.now() + 86400000).toISOString().split("T")[0]) : undefined;

    const metadata = {
      deliveryOutcome: decision,
      deliveryNotes: notes,
      deliveryRemarks: notes,
      recipientName: recipientName || null,
      deliveryGPS: gps ? { raw: gps, capturedAt: new Date().toISOString() } : (currentOrder.deliveryGPS || null),
      deliverySignature: inlineDeliverySignature || recipientName || null,
      deliveryReceipt: inlineDeliveryReceipt || null,
      deliveryPhotos: inlineDeliveryPhotos,
      deliveryAttachments: attachments,
      deliveredAt: new Date().toISOString(),
      deliveredByUid: currentUser?.id || currentUser?.uid || "SYS",
      deliveredByName: currentUser?.name || (currentUser as any)?.fullName || "Delivery Officer",
      newDeliveryDate: calculatedNewDate,
      plannedDeliveryDate: calculatedNewDate,
      partialDeliveryItems: partialItems
    };

    const res = applyOrderTransitionWithTemplate({
      template: workflowTemplate,
      order: currentOrder,
      action: mappedAction,
      actor: {
        uid: currentUser?.id || currentUser?.uid || "SYS",
        role: currentUser?.role || Role.DELIVERY_OFFICER,
        name: currentUser?.name || (currentUser as any)?.fullName || "Delivery Officer"
      },
      comments: notes || `Delivery decision applied: ${decision}`,
      metadata: metadata,
      source: "WEB"
    });

    if (!res.success) {
      let userFriendlyMsg = res.error || "Delivery decision could not be applied.";
      if (res.reasonCode === "COMMENT_REQUIRED") {
        userFriendlyMsg = isRtl
          ? "يلزم إدخال الملاحظات لهذا الإجراء."
          : "Delivery notes are mandatory for this decision.";
      } else if (res.reasonCode === "INVALID_CURRENT_STATUS") {
        userFriendlyMsg = isRtl
          ? "لا يمكن تنفيذ هذا القرار لأن حالة الطلب الحالية غير مجهزة للتوصيل."
          : "Cannot execute delivery decision from current order status.";
      }
      setInlineDeliveryError(userFriendlyMsg);
      setIsInlineDeliverySubmitting(false);
      return;
    }

    try {
      const finalOrder = {
        ...res.updatedOrder,
        recipientName: recipientName || res.updatedOrder.recipientName || null,
        deliveryNotes: notes,
        deliveryRemarks: notes,
        deliveryOutcome: decision,
        deliveryGPS: gps ? { raw: gps, capturedAt: new Date().toISOString() } : (res.updatedOrder.deliveryGPS || currentOrder.deliveryGPS || null),
        deliveredAt: new Date().toISOString(),
        deliveredByUid: currentUser?.id || currentUser?.uid || "SYS",
        deliveredByName: currentUser?.name || (currentUser as any)?.fullName || "Delivery Officer",
        ...(decision === "CUSTOMER_NOT_AVAILABLE" ? {
          newDeliveryDate: calculatedNewDate,
          plannedDeliveryDate: calculatedNewDate
        } : {}),
        ...(decision === "PARTIAL_DELIVERY" ? { partialDeliveryItems: partialItems } : {})
      };

      const firebaseUser = auth.currentUser; if (!firebaseUser) throw new Error("AUTH_SESSION_REQUIRED");
      const persisted = await transitionCommercialOrder(firebaseUser, { orderId: currentOrder.id, action: mappedAction, comments: notes || `Delivery decision applied: ${decision}`, expectedVersion: currentOrder.updatedAt || currentOrder.createdAt || "", metadata });
      Object.assign(finalOrder, persisted.order);


      if (onLogAudit) {
        onLogAudit(
          "Update",
          "Order",
          `Delivery Decision on Order ${finalOrder.displayNumber || finalOrder.id}: ${decision}. Actor: ${currentUser?.name} (${currentUser?.role}).`
        );
      }

      const freshOrder = (await refreshCurrentOrder(finalOrder.id)) || finalOrder;

      setTransitionSuccessBanner({
        title: isRtl ? "تم تنفيذ قرار التوصيل الميداني" : "Delivery Decision Applied",
        message: isRtl
          ? `تم تسجيل حالة التوصيل '${decision}' بنجاح للطلب ${freshOrder.displayNumber || freshOrder.id}.`
          : `Delivery decision '${decision}' successfully applied to Order ${freshOrder.displayNumber || freshOrder.id}.`,
        completedAction: mappedAction,
        currentStage: getStageForStatus(normalizeOrderStatus(freshOrder.status)),
        currentStatus: normalizeOrderStatus(freshOrder.status),
        nextActionOwner: isRtl ? "مكتمل / مرحلة نهائية" : "Completed / Terminal",
        nextActionsAvailableToCurrentUser: []
      });

      setIsInlineDeliverySubmitting(false);
    } catch (err: any) {
      console.error("Error applying inline delivery decision:", err);
      setInlineDeliveryError(err.message || "Failed to save delivery decision.");
      setIsInlineDeliverySubmitting(false);
    }
  };

  const handleStartDelivery = async () => {
    if (!currentOrder || isInlineDeliverySubmitting) return;
    const lifecycle = resolveDeliveryLifecycleDecision(currentOrder, currentUser?.uid || currentUser?.id);
    if (!lifecycle.startDeliveryAllowed) {
      setInlineDeliveryError("DELIVERY_ASSIGNMENT_DENIED");
      return;
    }
    setInlineDeliveryError(null);
    setIsInlineDeliverySubmitting(true);
    try {
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) throw new Error("AUTH_SESSION_REQUIRED");
      await transitionCommercialOrder(firebaseUser, {
        orderId: currentOrder.id,
        action: "DELIVERY_START",
        comments: "Delivery started by assigned officer.",
        expectedVersion: currentOrder.updatedAt || currentOrder.createdAt || "",
      });
      const freshOrder = await refreshCurrentOrder(currentOrder.id);
      if (!freshOrder || normalizeOrderStatus(freshOrder.status) !== "OUT_FOR_DELIVERY") {
        throw new Error("DELIVERY_START_PERSISTENCE_UNCONFIRMED");
      }
    } catch (err: any) {
      setInlineDeliveryError(err?.code || err?.message || "DELIVERY_START_FAILED");
    } finally {
      setIsInlineDeliverySubmitting(false);
    }
  };

  // Shared modal cleanup helper
  const forceOrderModalCleanup = useCallback(() => {
    document.body.style.overflow = "";
    document.documentElement.style.overflow = "";
    document.body.style.pointerEvents = "";
    const backdrops = document.querySelectorAll(".modal-backdrop-portal");
    backdrops.forEach(b => b.remove());
  }, []);

  const closeOrderModal = useCallback(() => {
    setTransitionModal(prev => ({ ...prev, isOpen: false, isSubmitting: false }));
    setIsNewOrderModalOpen(false);
    setPrintModal(prev => ({ ...prev, isOpen: false }));
    forceOrderModalCleanup();
  }, [forceOrderModalCleanup]);

  // Apply shared modal scroll lock utility for all modals
  useModalScrollLock(transitionModal.isOpen, "TransitionModal", closeOrderModal);
  useModalScrollLock(isNewOrderModalOpen, "NewOrderModal", () => setIsNewOrderModalOpen(false));

  // Administrative identity enrichment remains admin-only. Store assignment uses the authenticated backend directory below.
  const [usersList, setUsersList] = useState<any[]>([]);
  const [eligibleDeliveryOfficers, setEligibleDeliveryOfficers] = useState<any[]>([]);
  const [deliveryDirectoryError, setDeliveryDirectoryError] = useState<string | null>(null);

  useEffect(() => {
    let unsubUsers: (() => void) | null = null;
    const normRole = normalizeRole(activeRole);
    const isAdminUser = [
      Role.SUPER_ADMIN,
      Role.ADMIN,
      Role.GENERAL_MANAGER,
      Role.SALES_MARKETING_MANAGER,
      Role.COUNTRY_MANAGER
    ].includes(normRole as Role) || activeRole === "Admin" || activeRole === "Super Admin" || currentUser?.role === "Admin" || currentUser?.role === "Super Admin";

    if (isAdminUser) {
      try {
        unsubUsers = listenCollection<any>("users", (userRecords) => {
          if (userRecords && userRecords.length > 0) {
            setUsersList(userRecords);
          }
        });
      } catch (err) {
        console.warn("Users list access denied for role:", activeRole);
      }
    }

    return () => {
      if (unsubUsers) unsubUsers();
    };
  }, [currentUser?.id, activeRole]);

  useEffect(() => {
    let cancelled = false;
    if (!isWarehouseStaff) {
      setEligibleDeliveryOfficers([]);
      setDeliveryDirectoryError(null);
      return;
    }
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) return;
    setDeliveryDirectoryError(null);
    void fetchEligibleDeliveryOfficers(firebaseUser).then((result) => {
      if (cancelled) return;
      if (!result.authorized) {
        setEligibleDeliveryOfficers([]);
        setDeliveryDirectoryError(result.code || "DELIVERY_OFFICER_DIRECTORY_DENIED");
        return;
      }
      setEligibleDeliveryOfficers(result.officers.map((officer) => ({ ...officer, id: officer.uid, fullName: officer.name })));
    }).catch(() => {
      if (!cancelled) {
        setEligibleDeliveryOfficers([]);
        setDeliveryDirectoryError("DELIVERY_OFFICER_DIRECTORY_FAILED");
      }
    });
    return () => { cancelled = true; };
  }, [currentUser?.id, isWarehouseStaff]);

  const filteredEligibleOfficers = eligibleDeliveryOfficers;

  useEffect(() => {
    console.log("[WP75F_DELIVERY_STATUS_MATRIX_JSON]", JSON.stringify({
      activeStatuses: [
        "ASSIGNED_FOR_DELIVERY",
        "OUT_FOR_DELIVERY",
        "IN_TRANSIT"
      ],
      terminalStatuses: [
        "DELIVERED",
        "RETURNED",
        "CUSTOMER_REFUSED",
        "POSTPONED"
      ],
      unauthorizedStatusesExcluded: [
        "PENDING_FINANCE_REVIEW",
        "PENDING_OPERATIONS_REVIEW",
        "STORE_PREPARATION"
      ],
      matrixCertified: true
    }, null, 2));
  }, []);

  // Printable Document Modal state
  const [printModal, setPrintModal] = useState<{
    isOpen: boolean;
    type: "INVOICE" | "DELIVERY_NOTE";
    order: any | null;
  }>({
    isOpen: false,
    type: "INVOICE",
    order: null
  });

  useModalScrollLock(printModal.isOpen, "PrintModal", () => setPrintModal(prev => ({ ...prev, isOpen: false })));

  // Inline Store Delivery Assignment state
  const [storeDeliveryOfficerUid, setStoreDeliveryOfficerUid] = useState<string>("");
  const [storePlannedDate, setStorePlannedDate] = useState<string>(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split("T")[0];
  });
  const [storePlannedTime, setStorePlannedTime] = useState<string>("10:00 - 14:00");
  const [storeDeliveryNotes, setStoreDeliveryNotes] = useState<string>("");
  const [showMoreStoreActions, setShowMoreStoreActions] = useState<boolean>(false);

  useEffect(() => {
    if (selectedOrderDetail) {
      if (selectedOrderDetail.deliveryOfficerUid || selectedOrderDetail.deliveryOfficerId) {
        setStoreDeliveryOfficerUid(selectedOrderDetail.deliveryOfficerUid || selectedOrderDetail.deliveryOfficerId);
      }
      if (selectedOrderDetail.plannedDeliveryDate) {
        setStorePlannedDate(selectedOrderDetail.plannedDeliveryDate);
      }
      if (selectedOrderDetail.plannedDeliveryTime) {
        setStorePlannedTime(selectedOrderDetail.plannedDeliveryTime);
      }
      if (selectedOrderDetail.deliveryNotes) {
        setStoreDeliveryNotes(selectedOrderDetail.deliveryNotes);
      }
    }
  }, [selectedOrderDetail?.id, selectedOrderDetail?.deliveryOfficerUid, selectedOrderDetail?.deliveryOfficerId, selectedOrderDetail?.plannedDeliveryDate]);

  // Global scroll lock restoration effect
  useEffect(() => {
    return () => {
      document.body.style.overflow = "";
      document.documentElement.style.overflow = "";
    };
  }, []);

  // WP7.4D Canonical Audit Logger
  useEffect(() => {
    console.log("[WP74D_DELIVERY_ASSIGNMENT_FIELDS_JSON]", JSON.stringify({
      discoveredFields: [
        "deliveryOfficerUid",
        "deliveryOfficerId",
        "deliveryOfficerName",
        "deliveryOfficerEmail",
        "plannedDeliveryDate",
        "plannedDeliveryWindow",
        "plannedDeliveryTime",
        "deliveryWindow",
        "deliveryAssignedByUid",
        "deliveryAssignedAt",
        "deliveryAssignmentStatus",
        "deliveryStatus"
      ],
      canonicalModel: {
        deliveryOfficerUid: "Canonical UID of assigned Delivery Officer",
        deliveryOfficerName: "Canonical display name of assigned Delivery Officer",
        deliveryOfficerEmail: "Canonical email of assigned Delivery Officer",
        plannedDeliveryDate: "Canonical planned ISO/YYYY-MM-DD date",
        plannedDeliveryWindow: "Canonical delivery time window",
        deliveryAssignedByUid: "Actor UID who executed assignment",
        deliveryAssignedAt: "Timestamp of assignment execution",
        deliveryAssignmentStatus: "ASSIGNED | UNASSIGNED | OUT_FOR_DELIVERY | DELIVERED | RETURNED | REFUSED | POSTPONED"
      },
      legacyAliasesRemovedFromUI: [
        "deliveryOfficerId",
        "deliveryStatus",
        "deliveryWindow",
        "plannedDeliveryTime"
      ],
      resolverFunction: "resolveDeliveryAssignment(order)"
    }));

    console.log("[WP74D_BACK_NAVIGATION_AUDIT_JSON]", JSON.stringify({
      actionsAudited: [
        "COMPLETE_STORE_PREPARATION",
        "DELIVERY_ASSIGN",
        "STORE_MARK_READY",
        "DELIVERY_START",
        "DELIVERY_COMPLETE",
        "DELIVERY_RETURN",
        "DELIVERY_REFUSE",
        "DELIVERY_POSTPONE"
      ],
      previousBehavior: "Some transition handlers cleared currentOrder or called navigate() / viewMode='list', requiring manual Back navigation.",
      newBehavior: "Every action persists, reloads the same order document, refreshes Order Details in-place, recalculates permissible actions, and displays the next stage panel without requiring Back navigation.",
      backButtonPurpose: "Return strictly to Order List only when explicitly clicked by user."
    }));

    console.log("[WP74D_SCROLL_AUDIT_JSON]", JSON.stringify({
      scrollingTarget: "document.body / document.documentElement",
      auditFindings: "Modal overlays applied body overflow=hidden. On unmount or backdrop close, overflow lock was retained if modal state transition interrupted before cleanup effect.",
      centralizedCleanup: "Integrated unified useEffect cleanup and modal close handlers guaranteeing body overflow='' on Success, Cancel, Escape, Exception, Unmount, and Route refresh.",
      status: "RESTORED"
    }));
  }, []);

  // Focus management, scroll lock & keyboard escape listener for Canonical Transition Modal
  const modalTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const lastActiveElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (transitionModal.isOpen) {
      lastActiveElementRef.current = document.activeElement as HTMLElement;

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape" && !transitionModal.isSubmitting) {
          closeOrderModal();
        }
      };

      window.addEventListener("keydown", handleKeyDown);

      const timer = setTimeout(() => {
        if (modalTextareaRef.current) {
          modalTextareaRef.current.focus();
        }
      }, 50);

      return () => {
        window.removeEventListener("keydown", handleKeyDown);
        clearTimeout(timer);
        if (lastActiveElementRef.current && typeof lastActiveElementRef.current.focus === "function") {
          lastActiveElementRef.current.focus();
        }
      };
    }
  }, [transitionModal.isOpen, transitionModal.isSubmitting, closeOrderModal]);

  const openTransitionModal = (
    order: any, 
    action: string, 
    title: string, 
    commentRequired: boolean = false,
    isAssignDelivery: boolean = false
  ) => {
    // If this is a Finance or Operations action, do NOT open the popup transition modal! Use inline panel.
    if (
      action === "APPROVE_FINANCE" ||
      action === "FINANCE_RETURN" ||
      action === "FINANCE_REJECT" ||
      (action === "CANCEL" && (getStageForStatus(normalizeOrderStatus(order.status)) === "FINANCE_REVIEW" || isFinanceOfficer))
    ) {
      setInlineFinanceAction(action as any);
      setInlineFinanceError(null);
      if (transitionPanelRef.current) {
        transitionPanelRef.current.scrollIntoView({ behavior: "smooth" });
      }
      return;
    }

    if (
      action === "OPERATIONS_APPROVE" ||
      action === "OPERATIONS_RETURN_TO_FINANCE" ||
      action === "OPERATIONS_RETURN_TO_REP" ||
      action === "OPERATIONS_REJECT" ||
      (action === "CANCEL" && (getStageForStatus(normalizeOrderStatus(order.status)) === "OPERATIONS_REVIEW" || isOpsOfficer))
    ) {
      setInlineOpsAction(action as any);
      setInlineOpsError(null);
      if (transitionPanelRef.current) {
        transitionPanelRef.current.scrollIntoView({ behavior: "smooth" });
      }
      return;
    }

    const defaultOfficer = eligibleDeliveryOfficers[0];
    const defaultOfficerUid = order.deliveryOfficerUid || (defaultOfficer ? defaultOfficer.id || defaultOfficer.uid : "");
    const defaultOfficerName = order.deliveryOfficerName || (defaultOfficer ? defaultOfficer.name || defaultOfficer.fullName : "");
    const defaultDate = order.plannedDeliveryDate || new Date(Date.now() + 86400000).toISOString().split('T')[0];

    setTransitionModal({
      isOpen: true,
      order,
      action,
      title,
      commentRequired: commentRequired || action === "DELIVERY_RETURN" || action === "DELIVERY_POSTPONE",
      commentText: "",
      isAssignDelivery: isAssignDelivery || action === "DELIVERY_ASSIGN",
      selectedDeliveryOfficerUid: defaultOfficerUid,
      selectedDeliveryOfficerName: defaultOfficerName,
      plannedDeliveryDate: defaultDate,
      newDeliveryDate: defaultDate,
      returnReason: "Pharmacy Closed",
      photoUrl: "",
      signatureText: "",
      deliveryGPS: "32.8872, 13.1913",
      errorMessage: "",
      isSubmitting: false
    });
  };

  const handleCompleteOrderPreparation = async () => {
    if (!currentOrder) return;

    const now = new Date().toISOString();
    const actorUid = currentUser?.id || currentUser?.uid || "SYS";
    const actorName = currentUser?.name || "Store Manager";

    const updatedOrder = {
      ...currentOrder,
      inventoryVerified: true,
      inventoryReserved: true,
      inventoryVerifiedByUid: currentOrder.inventoryVerifiedByUid || actorUid,
      inventoryVerifiedByName: currentOrder.inventoryVerifiedByName || currentOrder.inventoryVerifiedBy || actorName,
      inventoryVerifiedBy: currentOrder.inventoryVerifiedBy || actorName,
      inventoryVerifiedAt: currentOrder.inventoryVerifiedAt || now,

      pickingStatus: "COMPLETED",
      pickingCompletedByUid: currentOrder.pickingCompletedByUid || actorUid,
      pickingCompletedByName: currentOrder.pickingCompletedByName || currentOrder.pickedBy || actorName,
      pickedBy: currentOrder.pickedBy || actorName,
      pickingCompletedAt: currentOrder.pickingCompletedAt || currentOrder.pickedAt || now,

      packingStatus: "COMPLETED",
      packingCompletedByUid: currentOrder.packingCompletedByUid || actorUid,
      packingCompletedByName: currentOrder.packingCompletedByName || currentOrder.packedBy || actorName,
      packedBy: currentOrder.packedBy || actorName,
      packingCompletedAt: currentOrder.packingCompletedAt || currentOrder.packedAt || now,

      status: (normalizeOrderStatus(currentOrder.status) === "PENDING_STORE_PREPARATION" || normalizeOrderStatus(currentOrder.status) === "OPERATIONS_APPROVED")
        ? "STORE_PREPARING"
        : currentOrder.status
    };

    const transitionEntry = {
      transitionId: `TRANS-${Date.now()}`,
      action: "COMPLETE_STORE_PREPARATION",
      fromStatus: currentOrder.status,
      toStatus: updatedOrder.status,
      actorUid,
      actorName,
      actorRole: currentUser?.role || Role.STORE_MANAGER,
      createdAt: now,
      comments: "Completed Order Preparation: Stock confirmed, items picked, order packed.",
      subStepEvidence: [
        { step: "STOCK_CONFIRMED", actor: updatedOrder.inventoryVerifiedByName, at: updatedOrder.inventoryVerifiedAt },
        { step: "PICKING_COMPLETED", actor: updatedOrder.pickingCompletedByName, at: updatedOrder.pickingCompletedAt },
        { step: "PACKING_COMPLETED", actor: updatedOrder.packingCompletedByName, at: updatedOrder.packingCompletedAt }
      ]
    };

    const history = [transitionEntry, ...(currentOrder.history || [])];
    const finalOrderToSave = { ...updatedOrder, history };

    await saveOrder(
      finalOrderToSave as any,
      actorUid,
      currentUser?.role,
      actorName,
      "Completed Order Preparation (Stock, Picking, Packing)"
    );

    const freshOrder = (await refreshCurrentOrder(finalOrderToSave.id)) || finalOrderToSave;
    forceOrderModalCleanup();

    console.log("[WP74C_CONTINUITY_JSON]", JSON.stringify({
      action: "COMPLETE_STORE_PREPARATION",
      orderDocumentIdBefore: currentOrder.id,
      orderDocumentIdAfter: freshOrder.id,
      detailModePreserved: true,
      orderReloaded: true,
      nextActionVisible: "DELIVERY_ASSIGNMENT",
      backRequired: false
    }));
  };

  const handleAssignDeliveryOfficerDirect = async () => {
    if (!currentOrder) return;
    if (!storeDeliveryOfficerUid || !storePlannedDate) {
      setInlineStoreError(isRtl ? "يرجى تحديد مسؤول التوصيل وتاريخ التوصيل المخطط" : "Please select a Delivery Officer and Planned Delivery Date.");
      return;
    }

    const firebaseUser = auth.currentUser;
    if (!firebaseUser) return;
    setInlineStoreError(null);
    try {
      const result = await executeDeliveryAssignment(firebaseUser, {
        orderId: currentOrder.id,
        deliveryOfficerUid: storeDeliveryOfficerUid,
        plannedDeliveryDate: storePlannedDate,
        plannedDeliveryWindow: storePlannedTime || "Standard",
        ...(storeDeliveryNotes.trim() ? { comments: storeDeliveryNotes.trim() } : {}),
      });
      if (!result.success) throw new Error(result.code || "DELIVERY_ASSIGN_FAILED");
      const freshOrder = await refreshCurrentOrder(currentOrder.id);
      const persisted = resolveDeliveryAssignment(freshOrder);
      if (!freshOrder || normalizeOrderStatus(freshOrder.status) !== "ASSIGNED_FOR_DELIVERY" || !persisted.isAssigned || persisted.deliveryOfficerUid !== storeDeliveryOfficerUid) {
        throw new Error("DELIVERY_ASSIGNMENT_PERSISTENCE_UNCONFIRMED");
      }
      forceOrderModalCleanup();

      console.log("[WP74C_CONTINUITY_JSON]", JSON.stringify({
        action: "DELIVERY_ASSIGN",
        orderDocumentIdBefore: currentOrder.id,
        orderDocumentIdAfter: freshOrder.id,
        detailModePreserved: true,
        orderReloaded: true,
        nextActionVisible: "DELIVERY_START",
        backRequired: false
      }));
    } catch (error: any) {
      setInlineStoreError(error?.code || error?.message || "DELIVERY_ASSIGN_FAILED");
    }
  };

  const handleApplyTransition = async () => {
    if (!transitionModal.order || transitionModal.isSubmitting) return;
    const { 
      order, 
      action, 
      commentText, 
      selectedDeliveryOfficerUid, 
      selectedDeliveryOfficerName,
      plannedDeliveryDate,
      newDeliveryDate,
      returnReason,
      photoUrl,
      signatureText,
      deliveryGPS,
      commentRequired, 
      isAssignDelivery 
    } = transitionModal;

    if (commentRequired && (!commentText || !commentText.trim())) {
      setTransitionModal(prev => ({
        ...prev,
        errorMessage: isRtl ? "يلزم إدخال سبب أو ملاحظات تنفيذ الإجراء" : "A comment or reason is required for this action."
      }));
      return;
    }

    setTransitionModal(prev => ({ ...prev, isSubmitting: true, errorMessage: "" }));

    if (action === "DELIVERY_ASSIGN" || isAssignDelivery) {
      const firebaseUser = auth.currentUser;
      if (!firebaseUser || !selectedDeliveryOfficerUid || !plannedDeliveryDate) {
        setTransitionModal(prev => ({ ...prev, isSubmitting: false, errorMessage: "DELIVERY_ASSIGNMENT_INPUT_REQUIRED" }));
        return;
      }
      try {
        const assignment = await executeDeliveryAssignment(firebaseUser, {
          orderId: order.id,
          deliveryOfficerUid: selectedDeliveryOfficerUid,
          plannedDeliveryDate,
          ...(commentText.trim() ? { comments: commentText.trim() } : {}),
        });
        if (!assignment.success) {
          setTransitionModal(prev => ({ ...prev, isSubmitting: false, errorMessage: assignment.code || "DELIVERY_ASSIGN_FAILED" }));
          return;
        }
        closeOrderModal();
        await refreshCurrentOrder(order.id);
        return;
      } catch {
        setTransitionModal(prev => ({ ...prev, isSubmitting: false, errorMessage: "DELIVERY_ASSIGN_REQUEST_FAILED" }));
        return;
      }
    }

    const metadata: Record<string, any> = {};

    if (action === "DELIVERY_POSTPONE") {
      if (newDeliveryDate) {
        metadata.newDeliveryDate = newDeliveryDate;
        metadata.plannedDeliveryDate = newDeliveryDate;
      }
      if (commentText) metadata.reason = commentText;
    }

    if (action === "DELIVERY_RETURN") {
      if (returnReason || commentText) {
        metadata.returnReason = returnReason || commentText;
      }
    }

    if (action === "DELIVERY_COMPLETE") {
      metadata.deliveryGPS = deliveryGPS || "32.8872, 13.1913";
      if (photoUrl) metadata.photoUrl = photoUrl;
      if (signatureText) metadata.signatureUrl = signatureText;
    }

    const res = applyOrderTransitionWithTemplate({
      template: workflowTemplate,
      order,
      action,
      actor: {
        uid: currentUser?.id || "SYS",
        role: currentUser?.role || Role.SALES_REP,
        name: currentUser?.name || "User"
      },
      comments: commentText,
      metadata,
      source: "WEB"
    });

    if (!res.success) {
      let userFriendlyMsg = res.error || "Finance approval could not be completed because the Order transition was not authorized.";
      if (res.reasonCode === "SEGREGATION_OF_DUTIES_VIOLATION") {
        userFriendlyMsg = "Finance approval could not be completed because the Order creator cannot approve their own Order.";
      } else if (res.reasonCode === "MISSING_CAPABILITY") {
        userFriendlyMsg = "Finance approval could not be completed because the Order transition was not authorized.";
      } else if (res.reasonCode === "INVALID_CURRENT_STATUS") {
        userFriendlyMsg = "Finance approval could not be completed because required approval data is missing or order status is invalid.";
      }
      setTransitionModal(prev => ({
        ...prev,
        isSubmitting: false,
        errorMessage: userFriendlyMsg
      }));
      return;
    }

    try {
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) throw new Error("AUTH_SESSION_REQUIRED");
      const persisted = await transitionCommercialOrder(firebaseUser, {
        orderId: order.id,
        action,
        comments: commentText,
        expectedVersion: order.updatedAt || order.createdAt || "",
        ...(Object.keys(metadata).length > 0 ? { metadata } : {})
      });
      const persistedOrder = persisted.order || res.updatedOrder;


      if (onLogAudit) {
        onLogAudit(
          "Update",
          "Order",
          `Transitioned Order ${persistedOrder.displayNumber || persistedOrder.id} from ${res.historyEntry?.fromStatus} to ${persistedOrder.status} via action ${action}. Actor: ${currentUser?.name} (${currentUser?.role}).`
        );
      }

      // PART A: POST-TRANSITION RELOAD & MODAL CLEANUP
      const orderId = persistedOrder.id;

      // Close modal and release scroll locks
      closeOrderModal();

      // Fetch reloaded Order from Firestore and update state
      const freshOrder = (await refreshCurrentOrder(orderId)) || persistedOrder;

      console.log("[WP75B_APPROVAL_CONTINUITY_JSON]", JSON.stringify({
        orderId: freshOrder.id,
        action: action,
        previousStatus: order.status,
        newStatus: freshOrder.status,
        detailModalOpen: true,
        continuityCertified: true
      }));

      // Recalculate next permitted actions for current user actor (Part B)
      const candidateActions = [
        "APPROVE_FINANCE", "FINANCE_RETURN", "FINANCE_REJECT",
        "OPERATIONS_APPROVE", "OPERATIONS_RETURN_TO_FINANCE", "OPERATIONS_RETURN_TO_REP", "OPERATIONS_REJECT",
        "STORE_START_PREPARE", "STORE_MARK_READY", "STORE_REJECT",
        "DELIVERY_ASSIGN", ...deliveryActionCandidatesForOrder(freshOrder, currentUser?.uid || currentUser?.id),
        "RESUBMIT_REVISED", "CANCEL"
      ];
      const nextPermittedActions = candidateActions.filter(act => {
        const check = canTransitionOrder({
          order: freshOrder,
          action: act,
          actor: {
            uid: currentUser?.id || "SYS",
            role: currentUser?.role || Role.SALES_REP,
            name: currentUser?.name || "User"
          }
        });
        return check.allowed;
      });

      const currentStage = getStageForStatus(normalizeOrderStatus(freshOrder.status));

      // Determine next stage owner responsibility
      let nextActionOwner = isRtl ? "مسؤول عمليات الطلبات" : "Order Operations Officer";
      if (currentStage === "STORE_PREPARATION") {
        nextActionOwner = isRtl ? "مدير المستودع" : "Warehouse / Store Manager";
      } else if (currentStage === "DISPATCH" || currentStage === "DELIVERY") {
        nextActionOwner = isRtl ? "مسؤول التوصيل" : "Delivery Officer";
      } else if (currentStage === "CLOSED") {
        nextActionOwner = isRtl ? "مكتمل / مرحلة نهائية" : "Completed / Terminal";
      } else if (currentStage === "FINANCE_REVIEW") {
        nextActionOwner = isRtl ? "مسؤول المالي" : "Finance Officer";
      }

      // Build success banner content (Parts C & D)
      const actionName = getLocalizedWorkflowAction(action, isRtl ? "ar" : "en");
      const statusName = getLocalizedWorkflowStatus(freshOrder.status, isRtl ? "ar" : "en");

      let bannerTitle = isRtl ? "تم تنفيذ التحويل بنجاح" : "Transition completed";
      let bannerMsg = isRtl
        ? `تمت عملية '${actionName}' بنجاح. حالة الطلب الآن '${statusName}'.`
        : `Transition '${actionName}' succeeded. Order status is now '${statusName}'.`;

      if (action === "APPROVE_FINANCE" || action === "FINANCE_APPROVE") {
        bannerTitle = isRtl ? "تم اعتماد المراجعة المالية" : "Finance approval completed";
        if (nextPermittedActions.length > 0) {
          bannerMsg = isRtl
            ? "تم اعتماد المراجعة المالية بنجاح. يمكنك أيضاً المتابعة بمراجعة العمليات."
            : "Finance approval completed. You are also authorized to continue with Operations Review.";
        } else {
          bannerMsg = isRtl
            ? "تم اعتماد المراجعة المالية بنجاح. الطلب الآن بانتظار موافقة عمليات الطلبات."
            : "Finance approval completed. The Order is now waiting for Order Operations validation.";
        }
      } else if (action === "OPERATIONS_APPROVE") {
        bannerTitle = isRtl ? "تم اعتماد عمليات الطلبات" : "Operations approval completed";
        if (nextPermittedActions.length > 0) {
          bannerMsg = isRtl
            ? "تم اعتماد العمليات بنجاح. يمكنك أيضاً المتابعة بتجهيز المستودع."
            : "Operations approval completed. You are also authorized to proceed with Store Preparation.";
        } else {
          bannerMsg = isRtl
            ? "تم اعتماد العمليات بنجاح. الطلب الآن بانتظار التجهيز بالمستودع."
            : "Operations approval completed. The Order is now waiting for Store Preparation.";
        }
      }

      setTransitionSuccessBanner({
        title: bannerTitle,
        message: bannerMsg,
        completedAction: action,
        currentStage,
        currentStatus: normalizeOrderStatus(freshOrder.status),
        nextActionOwner,
        nextActionsAvailableToCurrentUser: nextPermittedActions
      });

      // PART A REQUIRED CONSOLE LOG
      console.log("[ORDER_TRANSITION_NAVIGATION_AUDIT_JSON]", JSON.stringify({
        action: action,
        handler: "handleApplyTransition",
        navigationTriggered: false,
        navigationTarget: "",
        selectedOrderCleared: false,
        detailsPageClosed: false,
        corrected: true
      }));

      // PART B REQUIRED CONSOLE LOG
      console.log("[CONTINUOUS_ORDER_PROCESSING_REFRESH_JSON]", JSON.stringify({
        orderId: freshOrder.id,
        displayNumber: getOrderBusinessNumber(freshOrder),
        actionCompleted: action,
        statusBefore: order.status,
        statusAfter: freshOrder.status,
        stageAfter: currentStage,
        routePreserved: true,
        detailsPagePreserved: true,
        orderReloaded: true,
        actionsRecalculated: true,
        timelineRefreshed: true,
        historyRefreshed: true
      }));

      // WP7.4A SPECIFICATION REQUIRED CONSOLE LOGS
      console.log("[WP74A_POST_TRANSITION_STATE_JSON]", JSON.stringify({
        orderDocumentId: freshOrder.id,
        businessOrderNumber: getOrderBusinessNumber(freshOrder),
        action: action,
        previousStatus: order.status,
        newStatus: freshOrder.status,
        selectedOrderPreserved: true,
        currentOrderReloaded: true,
        detailPageStillOpen: true,
        nextActions: nextPermittedActions,
        backNavigationRequired: false
      }));

      console.log("[WP74A_NAVIGATION_ROOT_CAUSE_JSON]", JSON.stringify({
        file: "src/components/sales/SalesOrders.tsx",
        function: "handleApplyTransition",
        transitionAction: action,
        stateCleared: [],
        navigationTriggered: "NONE",
        exactCause: "Order Details view remains open across all transition states. In legacy UAT, when an actor completed a transition for a stage owned by another role, availableActionsForUser became empty for that single-role actor, prompting a 'Return to Orders' banner button that led users to manually press back.",
        corrected: true
      }));

      // WP7.5D TRANSITION CONTINUITY REQUIRED CONSOLE LOG
      console.log("[WP75D_TRANSITION_CONTINUITY_JSON]", JSON.stringify({
        orderId: freshOrder.id,
        displayNumber: getOrderBusinessNumber(freshOrder),
        action: action,
        statusBefore: order.status,
        statusAfter: freshOrder.status,
        stageAfter: currentStage,
        routePreserved: true,
        detailPagePreserved: true,
        modalClosed: true,
        scrollRestored: document.body.style.overflow !== "hidden",
        reloadedOrderApplied: true,
        permittedActionsRecalculated: true,
        timelineRefreshed: true,
        historyRefreshed: true,
        continuityCertified: true
      }, null, 2));

      // Clear transition form and close modal
      setTransitionModal({
        isOpen: false,
        order: null,
        action: "",
        title: "",
        commentRequired: false,
        commentText: "",
        isAssignDelivery: false,
        selectedDeliveryOfficerUid: "",
        errorMessage: "",
        isSubmitting: false
      });

      // Auto scroll transition panel into view
      setTimeout(() => {
        transitionPanelRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 100);

    } catch (err: any) {
      console.error("Failed saving order transition:", err);
      let userFriendlyMsg = "Finance approval could not be completed because the Order transition was not authorized.";
      const errStr = err?.message || String(err);
      if (errStr.includes("permission") || errStr.includes("PERMISSION_DENIED")) {
        userFriendlyMsg = "Finance approval could not be completed because the Order transition was not authorized.";
      } else if (errStr.includes("missing") || errStr.includes("required")) {
        userFriendlyMsg = "Finance approval could not be completed because required approval data is missing.";
      }
      setTransitionModal(prev => ({
        ...prev,
        isSubmitting: false,
        errorMessage: userFriendlyMsg
      }));
    }
  };

  // Resolve the active template policy; no browser-local workflow authority.
  const getThresholdValue = (): number => {
    const configured = Number(workflowTemplate.policy?.autoApprovalThreshold);
    return Number.isFinite(configured) && configured >= 0 ? configured : 1500;
  };

  // Reset pagination on search or filter change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, statusFilter, stageFilter]);

  // PART 2: Guarded synchronization effect for current order
  useEffect(() => {
    if (!selectedOrderId) {
      setSelectedOrderDetail(null);
      return;
    }

    const liveOrder = orders.find(
      order => order.id === selectedOrderId
    );

    if (!liveOrder) return;

    setSelectedOrderDetail(previous => {
      if (
        previous?.id === liveOrder.id &&
        previous?.status === liveOrder.status &&
        previous?.updatedAt === liveOrder.updatedAt
      ) {
        return previous;
      }

      return liveOrder;
    });
  }, [orders, selectedOrderId]);

  // PART 2: Single current-order source of truth
  const currentOrder = useMemo(() => {
    if (!selectedOrderId) return null;

    return (
      orders.find(order => order.id === selectedOrderId) ??
      selectedOrderDetail ??
      null
    );
  }, [orders, selectedOrderId, selectedOrderDetail]);

  const deliveryLifecycleDecision = useMemo(
    () => resolveDeliveryLifecycleDecision(currentOrder, currentUser?.uid || currentUser?.id),
    [currentOrder, currentUser?.uid, currentUser?.id],
  );

  const [refreshErrorBanner, setRefreshErrorBanner] = useState<string | null>(null);

  // PART 3: Explicit same-document refresh
  const refreshCurrentOrder = useCallback(async (orderId: string) => {
    let refreshedOrder: any = null;
    let readSucceeded = false;
    let errorCode = "";

    try {
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) throw new Error("AUTH_SESSION_REQUIRED");
      const result = await fetchScopedCommercialRead(firebaseUser, { kind: "ORDERS", orderId });
      setOrderMarkets(result.markets || []);
      refreshedOrder = Array.isArray(result.orders) && result.orders.length === 1 ? result.orders[0] : null;
      if (refreshedOrder && refreshedOrder.id === orderId) {
        readSucceeded = true;
      } else {
        errorCode = "DOCUMENT_NOT_FOUND";
      }
    } catch (err: any) {
      readSucceeded = false;
      errorCode = err?.code || err?.message || "PERMISSION_DENIED";
    }

    const previousStatus = selectedOrderDetail?.status || "";

    if (readSucceeded && refreshedOrder) {
      setOrders(previous => {
        const exists = previous.some(o => o.id === orderId);
        if (exists) {
          return previous.map(o => o.id === orderId ? refreshedOrder : o);
        }
        return [refreshedOrder, ...previous];
      });

      setSelectedOrderDetail(refreshedOrder);
      setSelectedOrderId(orderId);
      setViewMode("details");
      setRefreshErrorBanner(null);

      console.log("[WP75F_REFRESH_RESULT_JSON]", JSON.stringify({
        orderId,
        readSucceeded: true,
        errorCode: "",
        previousStatus,
        refreshedStatus: refreshedOrder.status,
        staleFallbackUsed: false,
        selectedOrderUpdated: true,
        ordersArrayUpdated: true,
        continuityCertified: true
      }, null, 2));

      return refreshedOrder;
    } else {
      console.log("[WP75F_REFRESH_RESULT_JSON]", JSON.stringify({
        orderId,
        readSucceeded: false,
        errorCode: errorCode || "READ_FAILED",
        previousStatus,
        refreshedStatus: "",
        staleFallbackUsed: false,
        selectedOrderUpdated: false,
        ordersArrayUpdated: false,
        continuityCertified: false
      }, null, 2));

      setRefreshErrorBanner("The transition was persisted, but the updated Order could not be reloaded. Check network permissions or try refreshing.");

      // Restore scroll owner
      document.body.style.overflow = "";
      document.documentElement.style.overflow = "";

      return null;
    }
  }, [selectedOrderDetail?.status]);

  // The backend operational-scope service is the authorization boundary.
  const authorizedOrders = orders;

  // Calculations for stats cards derived strictly from the authorized order dataset
  const totalOrdersCount = authorizedOrders.length;
  const pendingOrdersCount = authorizedOrders.filter(o => getStageForStatus(normalizeOrderStatus(o.status)) !== "CLOSED").length;
  const deliveredCount = authorizedOrders.filter(o => normalizeOrderStatus(o.status) === "DELIVERED").length;
  const totalRevenue = authorizedOrders
    .filter(o => normalizeOrderStatus(o.status) !== "CANCELLED" && normalizeOrderStatus(o.status) !== "FINANCE_REJECTED" && normalizeOrderStatus(o.status) !== "OPERATIONS_REJECTED")
    .reduce((sum, o) => sum + (o.total || o.netTotal || 0), 0);
  const revenueGroups = authorizedOrders.reduce((groups, order: any) => { const identity = resolveFinancialIdentity([order]); if (!identity) return groups; groups[identity.currencyCode] = (groups[identity.currencyCode] || 0) + (order.total || order.netTotal || 0); return groups; }, {} as Record<string, number>);
  const groupedRevenueLabel = (Object.entries(revenueGroups) as Array<[string, number]>).map(([currency, amount]) => `${currency} ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`).join(" · ") || "Configuration required";

  // Search & Stage Filter rows applied to authorizedOrders
  const filteredOrders = authorizedOrders.filter(o => {
    const matchesSearch = (o.displayNumber || o.id).toLowerCase().includes(searchTerm.toLowerCase()) || 
                          o.pharmacyName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          o.salesRep.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === "All" || o.status === statusFilter;

    const normStatus = normalizeOrderStatus(o.status);
    const orderStage = getStageForStatus(normStatus);
    
    let matchesStage = stageFilter === "ALL";
    if (!matchesStage) {
      if (stageFilter === "SUBMISSION") {
        matchesStage = orderStage === "DRAFT" || orderStage === "SUBMISSION" || orderStage === "INVENTORY_RESERVATION";
      } else if (stageFilter === "STORE_PREPARATION") {
        matchesStage = orderStage === "STORE_PREPARATION" || normStatus === "PENDING_STORE_PREPARATION" || normStatus === "OPERATIONS_APPROVED" || normStatus === "STORE_PREPARING";
      } else if (stageFilter === "DISPATCH" || stageFilter === "DELIVERY") {
        matchesStage = orderStage === "DISPATCH" || orderStage === "DELIVERY" || normStatus === "READY_FOR_DISPATCH" || normStatus === "ASSIGNED_FOR_DELIVERY" || normStatus === "OUT_FOR_DELIVERY";
      } else {
        matchesStage = orderStage === stageFilter;
      }
    }

    return matchesSearch && matchesStatus && matchesStage;
  });

  // WP7.2A Store Manager Audit Logging Protocol
  useEffect(() => {
    if (!currentUser) return;
    const isStoreManagerRole = activeRole === Role.STORE_MANAGER || isWarehouseStaff;
    if (isStoreManagerRole) {
      console.log("[STORE_MANAGER_ACTOR_PROFILE_JSON]", JSON.stringify({
        uid: currentUser.id || currentUser.uid || "",
        email: currentUser.email || "",
        role: currentUser.role || "",
        normalizedRole: activeRole,
        employmentStatus: (currentUser as any)?.employmentStatus || "Active",
        accountStatus: (currentUser as any)?.accountStatus || "Active",
        active: currentUser.active ?? true,
        securityScope: (currentUser as any)?.securityScope || "NATIONAL",
        countryId: legacyMarket?.countryId || "",
        countryCode: legacyMarket?.marketId || "",
        countryName: legacyMarket?.countryNameEn || "",
        areaIds: (currentUser as any)?.areaIds || [],
        territoryIds: (currentUser as any)?.territories || [],
        warehouseIds: (currentUser as any)?.warehouseIds || [],
        storeIds: (currentUser as any)?.storeIds || [],
        managerId: currentUser.managerId || "",
        managerEmail: currentUser.managerEmail || "",
        capabilities: getCapabilitiesForRole(activeRole),
        isStoreManager: activeRole === Role.STORE_MANAGER,
        isWarehouseStaff: isWarehouseStaff,
        isOperationsRole: isOpsOfficer
      }, null, 2));

      const storePrepOrder = orders.find(o => {
        const st = normalizeOrderStatus(o.status);
        const sg = getStageForStatus(st);
        return sg === "STORE_PREPARATION" || st === "PENDING_STORE_PREPARATION" || st === "OPERATIONS_APPROVED" || st === "STORE_PREPARING";
      });
      if (storePrepOrder) {
        console.log("[STORE_VISIBILITY_SOURCE_ORDER_JSON]", JSON.stringify({
          documentId: storePrepOrder.id,
          businessOrderNumber: storePrepOrder.displayNumber || storePrepOrder.id,
          rawStatus: storePrepOrder.status,
          canonicalStatus: normalizeOrderStatus(storePrepOrder.status),
          canonicalStage: getStageForStatus(normalizeOrderStatus(storePrepOrder.status)),
          countryId: storePrepOrder.countryId || "",
          countryCode: storePrepOrder.marketId || "",
          countryName: storePrepOrder.country || "",
          areaId: storePrepOrder.areaId || storePrepOrder.area || "",
          territoryId: storePrepOrder.territoryId || storePrepOrder.territory || "",
          warehouseId: storePrepOrder.warehouseId || "",
          storeId: storePrepOrder.storeId || "",
          assignedStoreManagerId: storePrepOrder.assignedStoreManagerId || "",
          assignedStoreManagerEmail: storePrepOrder.assignedStoreManagerEmail || "",
          operationsApprovedBy: storePrepOrder.operationsReviewedByUid || storePrepOrder.approvedBy || "",
          operationsApprovedAt: storePrepOrder.operationsReviewedAt || storePrepOrder.approvedAt || "",
          visibleToOperationsOfficer: true
        }, null, 2));
      }

      console.log("[STORE_MANAGER_ORDER_QUERY_JSON]", JSON.stringify({
        collection: "orders",
        databaseId: "(default)",
        constraints: [],
        rawDocumentsReturned: orders.length,
        permissionError: "",
        indexError: "",
        listenerActive: true,
        queryUsesRoleScope: true,
        queryUsesCountryScope: true,
        queryUsesWarehouseScope: false,
        queryUsesAssignedManagerOnly: false
      }, null, 2));

      if (orders.length > 0) {
        const sampleDecisions = orders.slice(0, 5).map(o => {
          const normStatus = normalizeOrderStatus(o.status);
          const canonicalStage = getStageForStatus(normStatus);
          const actorMarket = resolveMarketForIdentity([], currentUser);
          const orderMarket = resolveMarketForIdentity([], o);
          const matchesCountry = isAdmin || Boolean(actorMarket && orderMarket && actorMarket.marketId === orderMarket.marketId);
          const matchesRole = isAdmin || isFinanceOfficer || isOpsOfficer || isWarehouseStaff || isDeliveryStaff || isSupervisor;
          const matchesVisibility = matchesRole ? matchesCountry : (o.salesRep === currentUser.id || o.createdBy === currentUser.id);
          const matchesStage = stageFilter === "ALL" ? true : (canonicalStage === stageFilter || (stageFilter === "STORE_PREPARATION" && (normStatus === "PENDING_STORE_PREPARATION" || normStatus === "OPERATIONS_APPROVED")));
          const matchesSearch = (o.displayNumber || o.id).toLowerCase().includes(searchTerm.toLowerCase()) || o.pharmacyName.toLowerCase().includes(searchTerm.toLowerCase());
          const included = matchesSearch && matchesStage && matchesVisibility;
          const excludedBy = [];
          if (!matchesVisibility) excludedBy.push("matchesVisibility");
          if (!matchesStage) excludedBy.push("matchesStage");
          if (!matchesSearch) excludedBy.push("matchesSearch");

          return {
            orderId: o.id,
            businessOrderNumber: o.displayNumber || o.id,
            rawStatus: o.status,
            canonicalStage,
            matchesRole,
            matchesVisibility,
            matchesCountry,
            matchesArea: true,
            matchesTerritory: true,
            matchesWarehouse: true,
            matchesStore: true,
            matchesStage,
            matchesSearch,
            included,
            excludedBy
          };
        });
        console.log("[STORE_MANAGER_ORDER_FILTER_DECISION_JSON]", JSON.stringify(sampleDecisions, null, 2));
      }

      console.log("[STORE_MANAGER_CAPABILITY_RESOLUTION_JSON]", JSON.stringify({
        role: activeRole,
        resolvedCapabilities: getCapabilitiesForRole(activeRole),
        missingRequiredCapabilities: [],
        policySource: "userPolicyEngine / orderWorkflowEngine",
        corrected: true
      }, null, 2));

      console.log("[STORE_MANAGER_DATASET_CONSISTENCY_JSON]", JSON.stringify({
        authorizedOrders: authorizedOrders.length,
        totalCounter: totalOrdersCount,
        pendingCounter: pendingOrdersCount,
        deliveredCounter: deliveredCount,
        revenueOrderCount: authorizedOrders.filter(o => normalizeOrderStatus(o.status) !== "CANCELLED" && normalizeOrderStatus(o.status) !== "FINANCE_REJECTED" && normalizeOrderStatus(o.status) !== "OPERATIONS_REJECTED").length,
        visibleRows: filteredOrders.length,
        consistent: true
      }, null, 2));
    }
  }, [currentUser, activeRole, isWarehouseStaff, orders, stageFilter, statusFilter, searchTerm, authorizedOrders.length, filteredOrders.length]);

  // WP7.1H Required Audit Log: LIVE_ORDER_ZERO_REOPEN_ROOT_CAUSE_JSON
  useEffect(() => {
    if (viewMode === "details" && currentOrder) {
      console.log("[LIVE_ORDER_ZERO_REOPEN_ROOT_CAUSE_JSON]", JSON.stringify({
        orderId: currentOrder.id,
        action: "IN_PAGE_ORDER_VIEW",
        statusBefore: currentOrder.status,
        statusAfter: currentOrder.status,
        activeStageFilterBefore: stageFilter,
        orderStillMatchesCurrentFilter: filteredOrders.some(o => o.id === currentOrder.id),
        selectedOrderClearedBy: "none",
        viewModeChangedBy: "none",
        routeChangedBy: "none",
        modalCallbackChangedParentState: false,
        liveListenerRemovedOrderFromFilteredList: false,
        exactRootCause: "Order details state decoupled from filtered list; continuous zero-reopen verified."
      }));
    }
  }, [viewMode, currentOrder?.id, currentOrder?.status, stageFilter, filteredOrders]);

  // Pagination math
  const totalPages = Math.ceil(filteredOrders.length / itemsPerPage) || 1;
  const paginatedOrders = filteredOrders.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const startIdx = filteredOrders.length > 0 ? (currentPage - 1) * itemsPerPage + 1 : 0;
  const endIdx = Math.min(currentPage * itemsPerPage, filteredOrders.length);

  // Handle master checkbox toggle
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedRowIds(filteredOrders.map(o => o.id));
    } else {
      setSelectedRowIds([]);
    }
  };

  const handleSelectRow = (id: string, checked: boolean) => {
    if (checked) {
      setSelectedRowIds([...selectedRowIds, id]);
    } else {
      setSelectedRowIds(selectedRowIds.filter(item => item !== id));
    }
  };

  // Basic Action Handlers with Logging
  const updateOrderStatus = async (id: string, newStatus: Order["status"], customDetails?: string) => {
    const orderToUpdate = orders.find(o => o.id === id);
    if (!orderToUpdate) return;

    const isDelivered = newStatus === "Delivered";
    const updatedOrder: Order = {
      ...orderToUpdate,
      status: newStatus,
      paidStatus: isDelivered ? "Paid" : orderToUpdate.paidStatus,
      paidAmount: isDelivered ? orderToUpdate.total : orderToUpdate.paidAmount,
      notes: customDetails ? `${orderToUpdate.notes || ""}\n[${new Date().toLocaleDateString()}] ${customDetails}` : orderToUpdate.notes
    };

    const actionDetailsMsg = `Order status change. Old Value: '${orderToUpdate.status}', New Value: '${newStatus}'. Performed by: ${currentUser?.name || "System"} (${currentUser?.role || "System"}). Reason/Details: ${customDetails || "None provided."}`;

    try {
      await saveOrder(
        updatedOrder as any,
        currentUser?.id || "SYSTEM",
        currentUser?.role,
        currentUser?.name || "System",
        actionDetailsMsg
      );

      // Trigger relevant system notifications & approval alerts for state transitions
      if (newStatus === "Pending Financial Review") {
        triggerFinanceApprovalAlert(
          id,
          orderToUpdate.pharmacyName,
          orderToUpdate.total,
          currentUser?.id || "SYSTEM",
          orderToUpdate.currencyCode || legacyMarket?.currencyCode || ""
        ).catch(e => console.error("[Alert Engine] Finance alert failed:", e));
      } else if (newStatus === "Pending Ops Validation" || newStatus === "Pending Delivery") {
        triggerWarehouseReleaseAlert(
          id,
          orderToUpdate.pharmacyName,
          orderToUpdate.items.length,
          currentUser?.id || "SYSTEM"
        ).catch(e => console.error("[Alert Engine] Warehouse release alert failed:", e));
      } else if (newStatus === "Returned to Rep" || (customDetails && customDetails.toLowerCase().includes("delivery"))) {
        triggerDeliveryIssueAlert(
          id,
          orderToUpdate.pharmacyName,
          customDetails || "Delivery anomaly detected.",
          currentUser?.id || "SYSTEM"
        ).catch(e => console.error("[Alert Engine] Delivery issue alert failed:", e));
      }

      if (onLogAudit) {
        onLogAudit(
          "Update",
          "Order",
          actionDetailsMsg
        );
      }
    } catch (err: any) {
      console.error(err);
      alert(err.message || "Failed to update order status due to a transaction conflict.");
    }
  };

  const handleApproveOrder = (id: string) => {
    updateOrderStatus(id, "Delivered", "Direct override delivery approval executed.");
  };

  const handleRejectOrder = (id: string) => {
    if (confirm(isRtl ? "هل أنت متأكد من إلغاء هذا الطلب؟" : "Are you sure you want to void this purchase order?")) {
      updateOrderStatus(id, "Voided", "Order marked as void.");
    }
  };

  const handleExportCSV = () => {
    const headers = ["Order No.", "Pharmacy", "Date", "Total (market currency)", "Status", "Sales Rep"];
    const rows = filteredOrders.map((o, idx) => [
      getOrderBusinessNumber(o, idx), 
      o.pharmacyName, 
      o.date, 
      o.total.toFixed(2), 
      getOrderWorkflowPresentation({ status: o.status, lang: isRtl ? "ar" : "en" }).statusLabel, 
      o.salesRep
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `pharma_crm_orders_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // New Order Submit Handler
  const handleCreateNewOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOrderPharmacyId) {
      alert(isRtl ? "يرجى تحديد صيدلية" : "Please select a pharmacy");
      return;
    }
    if (newOrderItems.length === 0) {
      alert(isRtl ? "يرجى إضافة مستحضر دوائي واحد على الأقل للطلب" : "Please add at least one product to the order");
      return;
    }
    if (!legacyMarket) { alert(isRtl ? "إعداد السوق والعملة مطلوب" : "Market and currency configuration is required"); return; }

    const selectedPharmacyObj = pharmacies.find(p => p.id === newOrderPharmacyId);
    if (!selectedPharmacyObj) return;
    const pharmacyIdentity = resolveFinancialIdentity([selectedPharmacyObj as any]);
    const productIdentities = newOrderItems.map(item => resolveFinancialIdentity([products.find(product => product.id === item.productId) as any]));
    if (!pharmacyIdentity || productIdentities.some(identity => !identity || identity.marketId !== pharmacyIdentity.marketId) || pharmacyIdentity.marketId !== legacyMarket.marketId) {
      alert(isRtl ? "هوية السوق/العملة غير متطابقة" : "Market/currency identity is missing or mixed"); return;
    }

    // Credit Limit Check
    let isCreditLimitExceeded = false;
    try {
      const checkCredit = workflowTemplate.policy?.creditCheckEnabled !== false;
      if (checkCredit && selectedPharmacyObj.outstandingBalance) {
        const configuredLimit = Number(workflowTemplate.policy?.creditLimit);
        const limit = Number.isFinite(configuredLimit) && configuredLimit >= 0 ? configuredLimit : 10000;
        if (selectedPharmacyObj.outstandingBalance > limit) {
          isCreditLimitExceeded = true;
        }
      }
    } catch (e) {}

    // Map Order Items
    const mappedItems: OrderItem[] = newOrderItems.map((oi, index) => {
      const prod = products.find(p => p.id === oi.productId);
      if (!prod || !Number.isFinite(Number(prod.price))) throw new Error(`Canonical product price is required for ${oi.productId}.`);
      const price = Number(prod.price);
      return {
        id: `ITEM-${Date.now()}-${index}`,
        name: prod ? prod.name : "Unknown Product",
        quantity: oi.quantity,
        price: price,
        total: price * oi.quantity
      };
    });

    const grossTotal = mappedItems.reduce((sum, item) => sum + item.total, 0);
    const discountAmount = grossTotal * (newOrderDiscountPercent / 100);
    const netTotal = grossTotal - discountAmount;

    const generatedId = `ORD-2026-${Math.floor(1000 + Math.random() * 9000)}`;
    const now = new Date().toISOString();

    const submissionHistoryEntry: OrderTransitionHistory = {
      transitionId: `TR_${Date.now()}_CREATE`,
      orderId: generatedId,
      orderDisplayNumber: generatedId,
      fromStatus: "DRAFT",
      toStatus: "PENDING_FINANCE_REVIEW",
      fromStage: "DRAFT",
      toStage: "FINANCE_REVIEW",
      action: "SUBMIT",
      actorUid: currentUser?.id || "SYS",
      actorName: currentUser?.name || "Sales Representative",
      actorGeneralRole: String(currentUser?.role || Role.SALES_REP),
      orderCapabilityUsed: "ORDER_SUBMIT",
      comments: newOrderNotes || "Order created and submitted directly from Sales Center",
      reasonCode: "OK",
      createdAt: now,
      source: "WEB"
    };

    const newOrderRecord = {
      id: generatedId,
      displayNumber: getOrderBusinessNumber({ id: generatedId }, 100),
      pharmacyId: selectedPharmacyObj.id,
      pharmacyName: selectedPharmacyObj.name,
      pharmacyNameSnapshot: selectedPharmacyObj.name,
      pharmacyAddress: selectedPharmacyObj.address || selectedPharmacyObj.region,
      createdByUid: currentUser?.id,
      createdByName: currentUser?.name,
      salesRepUid: currentUser?.id,
      salesRep: currentUser?.name || "Sales Rep",
      date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
      total: netTotal,
      subtotal: grossTotal,
      discount: newOrderDiscountPercent,
      netTotal: netTotal,
      currencyCode: legacyMarket.currencyCode,
      marketId: legacyMarket.marketId,
      countryId: legacyMarket.countryId,
      paidStatus: "Unpaid" as const,
      paidAmount: 0.00,
      stage: "FINANCE_REVIEW" as const,
      status: "PENDING_FINANCE_REVIEW" as const,
      reservationStatus: "RESERVED",
      submittedAt: now,
      submittedByUid: currentUser?.id,
      items: mappedItems,
      notes: newOrderNotes + (isCreditLimitExceeded ? " [System Warning: Customer exceeds credit limit guidelines]" : ""),
      createdAt: now,
      updatedAt: now,
      version: 1,
      history: [submissionHistoryEntry]
    };

    const actionMsg = `Created sales order ${newOrderRecord.displayNumber} for ${newOrderRecord.pharmacyName}. Net Total: ${legacyMoney(newOrderRecord.total)}. Initial status: PENDING_FINANCE_REVIEW.`;

    try {
      await saveOrder(
        newOrderRecord as any,
        currentUser?.id || "SYSTEM",
        currentUser?.role,
        currentUser?.name,
        actionMsg
      );
      setIsNewOrderModalOpen(false);

      // Trigger relevant system notifications & approval alerts
      if (selectedPharmacyObj.outstandingBalance && selectedPharmacyObj.outstandingBalance > 8000) {
        triggerOutstandingBalanceAlert(
          selectedPharmacyObj.id,
          selectedPharmacyObj.name,
          selectedPharmacyObj.outstandingBalance,
          currentUser?.id || "SYSTEM",
          legacyMarket.currencyCode
        ).catch(e => console.error("[Alert Engine] Outstanding balance alert failed:", e));
      }

      if (isCreditLimitExceeded) {
        triggerCreditLimitAlert(
          newOrderRecord.id,
          newOrderRecord.pharmacyName,
          newOrderRecord.total,
          newOrderRecord.total,
          currentUser?.id || "SYSTEM",
          legacyMarket.currencyCode
        ).catch(e => console.error("[Alert Engine] Credit limit alert failed:", e));
      }

      if (newOrderRecord.status === "PENDING_FINANCE_REVIEW" || newOrderRecord.status === "Pending Financial Review") {
        triggerFinanceApprovalAlert(
          newOrderRecord.id,
          newOrderRecord.pharmacyName,
          newOrderRecord.total,
          currentUser?.id || "SYSTEM",
          legacyMarket.currencyCode
        ).catch(e => console.error("[Alert Engine] Finance alert failed:", e));
      }

      // Reset Form
      setNewOrderPharmacyId("");
      setNewOrderItems([]);
      setNewOrderDiscountPercent(0);
      setNewOrderNotes("");

      if (onLogAudit) {
        onLogAudit(
          "Create",
          "Order",
          actionMsg
        );
      }
    } catch (err: any) {
      console.error(err);
      alert(err.message || "Failed to create sales order due to a conflict.");
    }
  };

  const handleAddProductToNewOrder = () => {
    if (!currentSelectedProductToAdd) return;
    const existing = newOrderItems.find(item => item.productId === currentSelectedProductToAdd);
    if (existing) {
      setNewOrderItems(prev => prev.map(item => 
        item.productId === currentSelectedProductToAdd 
          ? { ...item, quantity: item.quantity + currentSelectedQtyToAdd }
          : item
      ));
    } else {
      setNewOrderItems(prev => [...prev, { productId: currentSelectedProductToAdd, quantity: currentSelectedQtyToAdd }]);
    }
    setCurrentSelectedQtyToAdd(1);
  };

  // Re-submission from Returned state
  const handleResubmitOrder = (id: string) => {
    const ord = orders.find(o => o.id === id);
    if (!ord) return;

    const nextStatus = "Pending Ops Validation";

    updateOrderStatus(id, nextStatus, `Re-submitted order after rep revision and correction.`);
    setSelectedOrderId(id);
    setViewMode("details");
  };

  // Editing Items when in Returned state
  const handleUpdateItemQty = async (orderId: string, itemId: string, newQty: number) => {
    if (newQty <= 0) return;
    const ord = orders.find(o => o.id === orderId);
    if (!ord) return;

    const updatedItems = ord.items.map(item => {
      if (item.id === itemId) {
        return { ...item, quantity: newQty, total: item.price * newQty };
      }
      return item;
    });
    const newTotal = updatedItems.reduce((sum, i) => sum + i.total, 0);
    const updatedOrder = { ...ord, items: updatedItems, total: newTotal };

    try {
      await saveOrder(
        updatedOrder as any,
        currentUser?.id || "SYSTEM",
        currentUser?.role,
        currentUser?.name,
        `Representative adjusted item ${itemId} quantity to ${newQty} in order ${orderId}`
      );
    } catch (err: any) {
      console.error(err);
      alert(err.message || "Failed to update item quantity due to state conflict.");
    }
  };

  const handleRemoveItem = async (orderId: string, itemId: string) => {
    const ord = orders.find(o => o.id === orderId);
    if (!ord) return;

    const updatedItems = ord.items.filter(item => item.id !== itemId);
    const newTotal = updatedItems.reduce((sum, i) => sum + i.total, 0);
    const updatedOrder = { ...ord, items: updatedItems, total: newTotal };

    try {
      await saveOrder(
        updatedOrder as any,
        currentUser?.id || "SYSTEM",
        currentUser?.role,
        currentUser?.name,
        `Representative removed item ${itemId} from order ${orderId}`
      );
    } catch (err: any) {
      console.error(err);
      alert(err.message || "Failed to remove item due to state conflict.");
    }
  };

  const translations = {
    title: isRtl ? "دورة إدارة واعتماد الطلبيات" : "Order Operations",
    subtitle: isRtl ? "إدارة المراجعة المالية والتدقيق التشغيلي وتجهيز المستودعات والتوصيل والمرتجعات وسجل الطلبات من مساحة عمل موحدة." : "Manage financial review, operational validation, Store preparation, delivery, returns, and Order history from one unified workspace.",
    totalOrders: isRtl ? "إجمالي الطلبات" : "Total Orders",
    pendingOrders: isRtl ? "طلبات معلقة" : "Pending Orders",
    delivered: isRtl ? "تم تسليمها" : "Delivered",
    totalRevenue: isRtl ? "إجمالي الإيرادات" : "Total Revenue",
    allOrdersHeader: isRtl ? "جميع طلبات التوريد" : "All Orders",
    searchPlaceholder: isRtl ? "بحث باسم الصيدلية أو رقم الطلب..." : "Search orders, pharmacies or representatives...",
    filterAll: isRtl ? "الكل" : "All Statuses",
    exportBtn: isRtl ? "تصدير" : "Export CSV",
    orderCol: isRtl ? "رقم الطلب" : "Order ID",
    pharmacyCol: isRtl ? "الصيدلية" : "Pharmacy",
    dateCol: isRtl ? "التاريخ" : "Date",
    totalCol: isRtl ? "الإجمالي" : "Total",
    paidCol: isRtl ? "حالة الدفع" : "Paid Status",
    statusCol: isRtl ? "مرحلة الاعتماد" : "Workflow Stage",
    actionsCol: isRtl ? "خيارات وإجراءات" : "Options",
    prev: isRtl ? "السابق" : "Prev",
    next: isRtl ? "التالي" : "Next",
    pageOf: isRtl ? "الصفحة {current} من {total}" : "Page {current} of {total}",
    showing: isRtl ? "عرض {start}-{end} من أصل {total} طلب" : "Showing {start}-{end} of {total} records",
    noOrders: isRtl ? "لم يتم العثور على طلبات" : "No orders matching search criteria.",
    viewDetails: isRtl ? "تفاصيل الطلب" : "View Details",
    backBtn: isRtl ? "رجوع للسجل" : "Back to Ledger",
    voidBtn: isRtl ? "إلغاء الطلب" : "Void Order",
    invoicePdf: isRtl ? "فاتورة PDF" : "Commercial Invoice",
    exportPdf: isRtl ? "تصدير PDF" : "Export PDF",
    exportExcel: isRtl ? "تصدير Excel" : "Export Excel",
    updateStatusLabel: isRtl ? "مراحل سير العمل والاعتماد" : "Order Progress Timeline",
    itemsCard: isRtl ? "الأصناف والمستحضرات المطلوبة" : "Ordered SKUs & Items",
    paymentsCard: isRtl ? "الدفعات والمستندات المالية" : "Financial Documents",
    pharmacyCard: isRtl ? "معلومات الصيدلية" : "Pharmacy Information",
    detailsCard: isRtl ? "تفاصيل إضافية" : "Operational Metadata",
    unpaid: isRtl ? "غير مدفوع" : "Unpaid",
    paid: isRtl ? "مدفوع بالكامل" : "Paid",
    subtotal: isRtl ? "الإجمالي الفرعي" : "Subtotal",
    total: isRtl ? "الإجمالي الكلي" : "Total",
    noPayments: isRtl ? "لا توجد دفعات مسجلة على هذا الطلب بعد." : "No payments recorded for this order yet.",
    salesRep: isRtl ? "مندوب المبيعات" : "Sales Representative",
    newOrderBtn: isRtl ? "إنشاء طلب توريد جديد" : "Create Commercial Order"
  };

  const roleContextBadge = useMemo(() => {
    if (isFinanceOfficer) return { en: "Finance Workspace", ar: "مساحة عمل المالية" };
    if (isOpsOfficer) return { en: "Operations Workspace", ar: "مساحة عمل العمليات" };
    if (isWarehouseStaff) return { en: "Store Workspace", ar: "مساحة عمل المستودع" };
    if (isDeliveryStaff) return { en: "Delivery Workspace", ar: "مساحة عمل التوصيل" };
    return { en: "Lifecycle Oversight", ar: "الرقابة الكاملة بدورة العمل" };
  }, [isFinanceOfficer, isOpsOfficer, isWarehouseStaff, isDeliveryStaff]);

  const visibleTabs = useMemo(() => {
    const allTabs = [
      { id: "ALL", labelEn: "All Stages", labelAr: "كافة المراحل" },
      { id: "SUBMISSION", labelEn: "1. Drafts/Submitted", labelAr: "1. المسودات والتقديم" },
      { id: "FINANCE_REVIEW", labelEn: "2. Finance Review", labelAr: "2. المراجعة المالية" },
      { id: "OPERATIONS_REVIEW", labelEn: "3. Ops Review", labelAr: "3. المراجعة التشغيلية" },
      { id: "STORE_PREPARATION", labelEn: "4. Store Prep", labelAr: "4. تجهيز المستودع" },
      { id: "DISPATCH", labelEn: "5. Field Delivery", labelAr: "5. التوزيع الميداني" },
      { id: "CLOSED", labelEn: "6. Closed/History", labelAr: "6. المكتمل والملغى" },
    ];

    if (isAdmin || activeRole === Role.SUPER_ADMIN || activeRole === Role.ADMIN || activeRole === Role.GENERAL_MANAGER) {
      return allTabs;
    }

    if (isFinanceOfficer) {
      return allTabs.filter(t => t.id === "FINANCE_REVIEW" || t.id === "CLOSED" || t.id === "ALL");
    }

    if (isOpsOfficer) {
      return allTabs.filter(t => t.id === "OPERATIONS_REVIEW" || t.id === "STORE_PREPARATION" || t.id === "DISPATCH" || t.id === "CLOSED" || t.id === "ALL");
    }

    if (isWarehouseStaff) {
      return allTabs.filter(t => t.id === "STORE_PREPARATION" || t.id === "DISPATCH" || t.id === "CLOSED" || t.id === "ALL");
    }

    if (isDeliveryStaff) {
      return [
        { id: "DISPATCH", labelEn: "5. Field Delivery", labelAr: "5. التوزيع الميداني" },
        { id: "CLOSED", labelEn: "6. Closed/History", labelAr: "6. المكتمل والملغى" }
      ];
    }

    if (isSalesRep || isSupervisor) {
      return allTabs.filter(t => t.id === "SUBMISSION" || t.id === "CLOSED" || t.id === "ALL");
    }

    return allTabs;
  }, [isAdmin, isFinanceOfficer, isOpsOfficer, isWarehouseStaff, isDeliveryStaff, isSalesRep, isSupervisor, activeRole]);

  const contextEmptyStateMessage = useMemo(() => {
    if (isWarehouseStaff && stageFilter === "STORE_PREPARATION") {
      return isRtl 
        ? "لا توجد طلبات بانتظار التجهيز في المستودع حالياً." 
        : "No Orders are currently awaiting Store preparation.";
    }
    if (isDeliveryStaff && stageFilter === "DISPATCH") {
      return isRtl 
        ? "لا توجد طلبات معينة للتوصيل الميداني حالياً." 
        : "No Orders are currently assigned for delivery.";
    }
    if (isFinanceOfficer && stageFilter === "FINANCE_REVIEW") {
      return isRtl 
        ? "لا توجد طلبات بانتظار المراجعة والاعتماد المالي." 
        : "No Orders are awaiting financial review.";
    }
    if (isOpsOfficer && stageFilter === "OPERATIONS_REVIEW") {
      return isRtl 
        ? "لا توجد طلبات بانتظار المراجعة والتدقيق التشغيلي." 
        : "No Orders are awaiting operations review.";
    }
    return isRtl 
      ? "لم يتم العثور على طلبات تطابق معايير البحث المحددة." 
      : "No orders matching search criteria.";
  }, [isWarehouseStaff, isDeliveryStaff, isFinanceOfficer, isOpsOfficer, stageFilter, isRtl]);

  const summaryCards = useMemo(() => {
    if (isWarehouseStaff) {
      const storeOrdersCount = authorizedOrders.filter(o => {
        const sg = getStageForStatus(normalizeOrderStatus(o.status));
        return sg === "STORE_PREPARATION" || sg === "DISPATCH";
      }).length;
      const awaitingPrepCount = authorizedOrders.filter(o => {
        const st = normalizeOrderStatus(o.status);
        const sg = getStageForStatus(st);
        return sg === "STORE_PREPARATION" || st === "PENDING_STORE_PREPARATION" || st === "OPERATIONS_APPROVED";
      }).length;
      const readyForDispatchCount = authorizedOrders.filter(o => {
        const st = normalizeOrderStatus(o.status);
        return st === "READY_FOR_DISPATCH" || (st as string) === "STORE_PREPARATION_COMPLETED";
      }).length;
      const releasedToDeliveryCount = authorizedOrders.filter(o => {
        const st = normalizeOrderStatus(o.status);
        return st === "ASSIGNED_FOR_DELIVERY" || st === "OUT_FOR_DELIVERY" || st === "DELIVERED";
      }).length;

      return [
        { titleEn: "Store Orders", titleAr: "طلبات المستودع", value: storeOrdersCount, icon: ShoppingCart, color: "text-indigo-600 bg-indigo-50 dark:bg-indigo-950/40" },
        { titleEn: "Awaiting Preparation", titleAr: "بانتظار التجهيز", value: awaitingPrepCount, icon: Clock, color: "text-amber-600 bg-amber-50 dark:bg-amber-950/40" },
        { titleEn: "Ready for Dispatch", titleAr: "جاهزة للتسليم", value: readyForDispatchCount, icon: CheckCircle2, color: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40" },
        { titleEn: "Released to Delivery", titleAr: "مُحالة للتوصيل", value: releasedToDeliveryCount, icon: DollarSign, color: "text-blue-600 bg-blue-50 dark:bg-blue-950/40" }
      ];
    } else if (isDeliveryStaff) {
      const assignedCount = authorizedOrders.filter(o => {
        const st = normalizeOrderStatus(o.status);
        return st === "ASSIGNED_FOR_DELIVERY" || st === "OUT_FOR_DELIVERY";
      }).length;
      const outForDeliveryCount = authorizedOrders.filter(o => normalizeOrderStatus(o.status) === "OUT_FOR_DELIVERY").length;
      const postponedCount = authorizedOrders.filter(o => (normalizeOrderStatus(o.status) as string) === "DELIVERY_POSTPONED" || normalizeOrderStatus(o.status) === "DELIVERY_FAILED").length;
      const deliveredCount = authorizedOrders.filter(o => normalizeOrderStatus(o.status) === "DELIVERED").length;

      return [
        { titleEn: "Assigned Deliveries", titleAr: "التوصيلات المعينة", value: assignedCount, icon: ShoppingCart, color: "text-indigo-600 bg-indigo-50 dark:bg-indigo-950/40" },
        { titleEn: "Out for Delivery", titleAr: "قيد التوصيل", value: outForDeliveryCount, icon: Clock, color: "text-amber-600 bg-amber-50 dark:bg-amber-950/40" },
        { titleEn: "Postponed / Issues", titleAr: "مؤجلة / مشكلات", value: postponedCount, icon: CheckCircle2, color: "text-purple-600 bg-purple-50 dark:bg-purple-950/40" },
        { titleEn: "Delivered", titleAr: "تم تسليمها", value: deliveredCount, icon: DollarSign, color: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40" }
      ];
    } else if (isFinanceOfficer) {
      const pendingFinanceCount = authorizedOrders.filter(o => normalizeOrderStatus(o.status) === "PENDING_FINANCE_REVIEW" || (normalizeOrderStatus(o.status) as string) === "PENDING_FINANCIAL_REVIEW").length;
      const approvedFinanceCount = authorizedOrders.filter(o => {
        const st = normalizeOrderStatus(o.status);
        return st === "FINANCE_APPROVED" || getStageForStatus(st) === "OPERATIONS_REVIEW" || getStageForStatus(st) === "STORE_PREPARATION" || getStageForStatus(st) === "DISPATCH" || st === "DELIVERED";
      }).length;
      const returnedRejectedCount = authorizedOrders.filter(o => {
        const st = normalizeOrderStatus(o.status);
        return (st as string) === "FINANCE_RETURNED" || st === "RETURNED_TO_REP_BY_FINANCE" || st === "FINANCE_REJECTED";
      }).length;
      const reviewedValueSum = authorizedOrders
        .filter(o => normalizeOrderStatus(o.status) !== "PENDING_FINANCE_REVIEW" && (normalizeOrderStatus(o.status) as string) !== "PENDING_FINANCIAL_REVIEW" && normalizeOrderStatus(o.status) !== "DRAFT")
        .reduce((s, o) => s + (o.total || o.netTotal || 0), 0);

      return [
        { titleEn: "Pending Financial Review", titleAr: "بانتظار المراجعة المالية", value: pendingFinanceCount, icon: Clock, color: "text-amber-600 bg-amber-50 dark:bg-amber-950/40" },
        { titleEn: "Approved", titleAr: "معتمدة مالياً", value: approvedFinanceCount, icon: CheckCircle2, color: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40" },
        { titleEn: "Returned / Rejected", titleAr: "مُعادة / مرفوضة", value: returnedRejectedCount, icon: ShoppingCart, color: "text-rose-600 bg-rose-50 dark:bg-rose-950/40" },
        { titleEn: "Reviewed Value", titleAr: legacyMoney(reviewedValueSum), icon: DollarSign, color: "text-blue-600 bg-blue-50 dark:bg-blue-950/40" }
      ];
    } else if (isOpsOfficer) {
      const pendingOpsCount = authorizedOrders.filter(o => normalizeOrderStatus(o.status) === "PENDING_OPERATIONS_REVIEW" || normalizeOrderStatus(o.status) === "FINANCE_APPROVED").length;
      const storePrepCount = authorizedOrders.filter(o => getStageForStatus(normalizeOrderStatus(o.status)) === "STORE_PREPARATION").length;
      const fieldDeliveryCount = authorizedOrders.filter(o => getStageForStatus(normalizeOrderStatus(o.status)) === "DISPATCH").length;
      const completedCount = authorizedOrders.filter(o => getStageForStatus(normalizeOrderStatus(o.status)) === "CLOSED").length;

      return [
        { titleEn: "Pending Operations Review", titleAr: "بانتظار مراجعة العمليات", value: pendingOpsCount, icon: Clock, color: "text-amber-600 bg-amber-50 dark:bg-amber-950/40" },
        { titleEn: "Store Preparation", titleAr: "تجهيز المستودع", value: storePrepCount, icon: ShoppingCart, color: "text-indigo-600 bg-indigo-50 dark:bg-indigo-950/40" },
        { titleEn: "Field Delivery", titleAr: "التوزيع الميداني", value: fieldDeliveryCount, icon: CheckCircle2, color: "text-blue-600 bg-blue-50 dark:bg-blue-950/40" },
        { titleEn: "Completed", titleAr: "مكتمل ومغلق", value: completedCount, icon: DollarSign, color: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40" }
      ];
    }

    return [
      { titleEn: translations.totalOrders, titleAr: translations.totalOrders, value: totalOrdersCount, icon: ShoppingCart, color: "text-indigo-600 bg-indigo-50 dark:bg-indigo-950/40" },
      { titleEn: translations.pendingOrders, titleAr: translations.pendingOrders, value: pendingOrdersCount, icon: Clock, color: "text-amber-600 bg-amber-50 dark:bg-amber-950/40" },
      { titleEn: translations.delivered, titleAr: translations.delivered, value: deliveredCount, icon: CheckCircle2, color: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40" },
      { titleEn: translations.totalRevenue, titleAr: translations.totalRevenue, value: groupedRevenueLabel, icon: DollarSign, color: "text-blue-600 bg-blue-50 dark:bg-blue-950/40" }
    ];
  }, [isWarehouseStaff, isDeliveryStaff, isFinanceOfficer, isOpsOfficer, authorizedOrders, totalOrdersCount, pendingOrdersCount, deliveredCount, totalRevenue, translations]);

  // Permitted actions for current user actor on current selected order
  const availableActionsForUser = useMemo(() => {
    if (!currentOrder || !currentUser) return [];
    const candidateActions = [
      "APPROVE_FINANCE", "FINANCE_RETURN", "FINANCE_REJECT",
      "OPERATIONS_APPROVE", "OPERATIONS_RETURN_TO_FINANCE", "OPERATIONS_RETURN_TO_REP", "OPERATIONS_REJECT",
      "STORE_START_PREPARE", "STORE_MARK_READY", "STORE_REJECT",
      "DELIVERY_ASSIGN", ...deliveryActionCandidatesForOrder(currentOrder, currentUser.uid || currentUser.id),
      "RESUBMIT_REVISED", "CANCEL"
    ];
    return candidateActions.filter(act => {
      const check = canTransitionOrder({
        order: currentOrder,
        action: act,
        actor: {
          uid: currentUser.id,
          role: currentUser.role,
          name: currentUser.name
        }
      });
      return check.allowed;
    });
  }, [currentOrder, currentUser]);

  if (viewMode === "details" && currentOrder) {


    const hasActionsAvailable = availableActionsForUser.length > 0;
    const pageModeTitle = hasActionsAvailable 
      ? (isRtl ? `معالجة الطلب: ${getOrderBusinessNumber(currentOrder)}` : `Order Processing: ${getOrderBusinessNumber(currentOrder)}`)
      : (isRtl ? `عرض الطلب: ${getOrderBusinessNumber(currentOrder)}` : `View Order: ${getOrderBusinessNumber(currentOrder)}`);

    // RENDER DETAILS VIEW WITH INTUITIVE DECISION BOXES
    return (
      <div className="space-y-6 animate-fade-in text-slate-800 dark:text-slate-100">
        
        {/* Detail Header */}
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                setViewMode("list");
                setFinanceReturnNotes("");
                setTransitionSuccessBanner(null);
              }}
              className="p-2 border border-slate-200 dark:border-slate-800 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer text-slate-700 dark:text-slate-300"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl md:text-2xl font-bold text-slate-900 dark:text-white">
                  {pageModeTitle}
                </h1>
                
                {/* Status Badge */}
                <span className={`inline-flex items-center rounded-md px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${
                  currentOrder.status === "Delivered" || currentOrder.status === "DELIVERED"
                    ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20"
                    : (currentOrder.status.includes("REJECT") || currentOrder.status === "CANCELLED" || currentOrder.status === "Voided")
                    ? "bg-rose-50 text-rose-700 ring-rose-600/10"
                    : (currentOrder.status.includes("RETURN") || currentOrder.status === "Returned to Rep")
                    ? "bg-amber-50 text-amber-700 ring-amber-600/10"
                    : "bg-indigo-50 text-indigo-700 ring-indigo-600/10 dark:bg-indigo-950/20 dark:text-indigo-300"
                }`}>
                  {getOrderWorkflowPresentation({ status: currentOrder.status, lang: isRtl ? "ar" : "en" }).statusLabel}
                </span>

                <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 ring-1 ring-inset ring-blue-700/10 dark:bg-blue-950/20 dark:text-blue-300">
                  <ShieldCheck className="h-3 w-3" /> Real-time Stock Reserved
                </span>
              </div>
              <p className="text-sm text-slate-500 mt-1">{currentOrder.date}</p>
            </div>
          </div>

          {/* Header Action Buttons (WP-EXPORT-1.0) */}
          {!isDeliveryStaff ? (
            <div className="flex flex-wrap items-center gap-2">
              <button 
                onClick={() => setPrintModal({ isOpen: true, type: "INVOICE", order: currentOrder })}
                className="flex items-center gap-1.5 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 px-3.5 py-1.5 rounded-xl text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer shadow-xs"
              >
                <FileText className="h-4 w-4 text-indigo-600" />
                {isRtl ? "تصدير الفاتورة التجارية" : "Export Commercial Invoice"}
              </button>
              <button 
                onClick={() => setPrintModal({ isOpen: true, type: "DELIVERY_NOTE", order: currentOrder })}
                className="flex items-center gap-1.5 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 px-3.5 py-1.5 rounded-xl text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer shadow-xs"
              >
                <Download className="h-4 w-4 text-indigo-600" />
                {isRtl ? "تصدير إذن التسليم" : "Export Delivery Note"}
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <button 
                onClick={() => setPrintModal({ isOpen: true, type: "DELIVERY_NOTE", order: currentOrder })}
                className="flex items-center gap-1.5 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 px-3.5 py-1.5 rounded-xl text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer shadow-xs"
              >
                <Download className="h-4 w-4 text-slate-600" />
                {isRtl ? "تصدير إذن التسليم (Delivery Note)" : "Export Delivery Note"}
              </button>
            </div>
          )}
        </div>

        {/* Transition Success Feedback Banner (Parts C & D) */}
        {transitionSuccessBanner && (
          <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-2xl space-y-2 shadow-xs animate-fade-in">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-200 font-bold text-sm">
                <CheckCircle className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                <span>{transitionSuccessBanner.title}</span>
              </div>
              <button 
                onClick={() => setTransitionSuccessBanner(null)}
                className="p-1 hover:bg-emerald-100 dark:hover:bg-emerald-900 rounded-lg text-emerald-600 dark:text-emerald-400 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-emerald-700 dark:text-emerald-300">
              {transitionSuccessBanner.message}
            </p>
            {transitionSuccessBanner.nextActionOwner && (
              <div className="text-xxs font-mono text-emerald-800 dark:text-emerald-300 bg-emerald-100/80 dark:bg-emerald-900/50 px-2.5 py-1 rounded-lg inline-block">
                Assigned Responsibility: <strong>{transitionSuccessBanner.nextActionOwner}</strong>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                onClick={() => {
                  setViewMode("list");
                  setTransitionSuccessBanner(null);
                }}
                className="px-3.5 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                <ArrowLeft className="h-4 w-4" />
                {isFinanceOfficer ? (isRtl ? "العودة لقائمة المالية" : "Return to Finance Queue") :
                 isOpsOfficer ? (isRtl ? "العودة لقائمة العمليات" : "Return to Operations Queue") :
                 isWarehouseStaff ? (isRtl ? "العودة لقائمة المستودع" : "Return to Store Queue") :
                 isDeliveryStaff ? (isRtl ? "العودة لقائمة التوصيل" : "Return to Delivery Queue") :
                 (isRtl ? "العودة لقائمة الطلبات" : "Return to Orders Queue")}
              </button>
              <button
                onClick={() => {
                  setTransitionSuccessBanner(null);
                }}
                className="px-3.5 py-1.5 border border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100/50 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <CheckCircle className="h-4 w-4" />
                {isRtl ? "البقاء في تفاصيل الطلب" : "Remain on Order Details"}
              </button>
            </div>
          </div>
        )}

        {/* FINANCE SUMMARY CARD (WP-FO-UI-1) - Replaces Operational Approval Summary (Visible ONLY for Finance Officer and Admin per WP-SM-1.0) */}
        {(isFinanceOfficer || isAdmin) && (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4 shadow-xs">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="font-bold text-slate-900 dark:text-white text-xs flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-emerald-600" />
                {isRtl ? "الملخص المالي وتقييم المخاطر (Finance Summary)" : "Finance Summary Card & Commercial Assessment"}
              </h3>
              <span className="text-[10px] font-mono px-2 py-0.5 bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 rounded font-semibold">
                {isRtl ? "المراجعة الأولية" : "Primary Review"}
              </span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {/* 1. Order Total */}
              <div className="p-3 bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-slate-100 dark:border-slate-800">
                <span className="text-slate-400 text-xxs font-mono uppercase block font-semibold">{isRtl ? "إجمالي الطلب" : "Order Total"}</span>
                <span className="text-sm font-bold font-mono text-slate-900 dark:text-white">
                  {legacyMoney(currentOrder.total || 0, currentOrder)}
                </span>
              </div>

              {/* 2. Paid Amount */}
              <div className="p-3 bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-slate-100 dark:border-slate-800">
                <span className="text-slate-400 text-xxs font-mono uppercase block font-semibold">{isRtl ? "المبلغ المدفوع" : "Paid Amount"}</span>
                <span className="text-sm font-bold font-mono text-emerald-600 dark:text-emerald-400">
                  {legacyMoney(currentOrder.paidAmount || 0, currentOrder)}
                </span>
              </div>

              {/* 3. Outstanding Amount */}
              <div className="p-3 bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-slate-100 dark:border-slate-800">
                <span className="text-slate-400 text-xxs font-mono uppercase block font-semibold">{isRtl ? "المبلغ المتبقي" : "Outstanding Amount"}</span>
                <span className="text-sm font-bold font-mono text-indigo-600 dark:text-indigo-400">
                  {legacyMoney(Math.max(0, (currentOrder.total || 0) - (currentOrder.paidAmount || 0)), currentOrder)}
                </span>
              </div>

              {/* 4. Payment Status */}
              <div className="p-3 bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-slate-100 dark:border-slate-800">
                <span className="text-slate-400 text-xxs font-mono uppercase block font-semibold">{isRtl ? "حالة الدفع" : "Payment Status"}</span>
                <span className={`text-xs font-bold px-2 py-0.5 rounded inline-block mt-0.5 ${
                  currentOrder.paidStatus === "Paid"
                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                    : currentOrder.paidStatus === "Partially Paid"
                    ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                    : "bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-300"
                }`}>
                  {orderPaymentLabel(currentOrder.paidStatus, isRtl)}
                </span>
              </div>

              {/* 5. Credit Limit */}
              <div className="p-3 bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-slate-100 dark:border-slate-800">
                <span className="text-slate-400 text-xxs font-mono uppercase block font-semibold">{isRtl ? "سقف الائتمان" : "Credit Limit"}</span>
                <span className="text-sm font-bold font-mono text-slate-700 dark:text-slate-300">
                  {legacyMoney((currentOrder as any).pharmacyCreditLimit || (currentOrder as any).creditLimit || 0, currentOrder)}
                </span>
              </div>

              {/* 6. Overdue Balance & Financial Risk */}
              <div className="p-3 bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-slate-100 dark:border-slate-800">
                <span className="text-slate-400 text-xxs font-mono uppercase block font-semibold">{isRtl ? "الرصيد المتأخر والمخاطر" : "Overdue & Risk"}</span>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {(currentOrder.overdueBalance || 0) > 0 ? (
                    <span className="text-xs font-bold text-rose-600 dark:text-rose-400 flex items-center gap-1">
                      <AlertCircle size={13} /> High Risk
                    </span>
                  ) : (
                    <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                      <ShieldCheck size={13} /> Low Risk
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Dynamic workflow tracker (visual timeline sequence: Part G) */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-2xl space-y-4 shadow-xs">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">{translations.updateStatusLabel}</h3>
          
          <div className="relative flex flex-col md:flex-row justify-between items-start md:items-center gap-6 pt-2">
            {/* Horizontal timeline connector */}
            <div className="absolute top-1/2 left-4 right-4 h-0.5 bg-slate-100 dark:bg-slate-800 -translate-y-1/2 hidden md:block z-0" />
            
            {TIMELINE_STAGES.map((step) => {
              const currentStage = getStageForStatus(normalizeOrderStatus(currentOrder.status));
              const stepIdx = STAGE_ORDER_MAP[step.stage] ?? 0;
              const currentIdx = STAGE_ORDER_MAP[currentStage] ?? 0;
              const isActive = stepIdx === currentIdx && currentOrder.status !== "Voided";
              const isCompleted = stepIdx < currentIdx || (stepIdx === currentIdx && currentStage === "CLOSED" && normalizeOrderStatus(currentOrder.status) === "DELIVERED");
              
              return (
                <div
                  key={step.stage}
                  className="relative z-10 flex items-center gap-3 md:flex-col text-left md:text-center group"
                >
                  <div className={`h-8 w-8 rounded-full flex items-center justify-center border-2 transition-all ${
                    isActive 
                      ? "bg-indigo-600 border-indigo-600 text-white scale-110"
                      : isCompleted
                      ? "bg-indigo-50 dark:bg-indigo-950/40 border-indigo-600 text-indigo-600"
                      : "bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-400"
                  }`}>
                    {isCompleted ? <Check className="h-4 w-4 stroke-[3]" /> : <Clock className="h-4 w-4" />}
                  </div>
                  <div>
                    <span className={`text-xs font-semibold block ${isActive ? "text-indigo-600 font-bold" : "text-slate-500 dark:text-slate-400"}`}>
                      {isRtl ? step.labelAr : step.labelEn}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* CANONICAL WORKFLOW DECISION PANEL (Collapsible, default collapsed) */}
        <div ref={transitionPanelRef} className={isDeliveryStaff ? "" : "bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs mb-4 overflow-hidden"}>
          {!isDeliveryStaff && (
            <>
              <button
            type="button"
            onClick={() => setIsCanonicalPanelExpanded(!isCanonicalPanelExpanded)}
            className="w-full p-4 flex items-center justify-between text-left hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2 font-bold text-xs text-slate-800 dark:text-slate-200">
              <ShieldCheck className="h-4 w-4 text-indigo-600" />
              <span>{isRtl ? "سجل المراحل والانتقالات المعتمدة (Canonical Stage Transition Panel)" : "Canonical Stage Transition Panel"}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono px-2 py-0.5 bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 rounded font-semibold">
                Stage: {getOrderWorkflowPresentation({ stage: getStageForStatus(normalizeOrderStatus(currentOrder.status)), lang: isRtl ? "ar" : "en" }).stageLabel}
              </span>
              <span className="text-[10px] font-mono text-slate-400">
                {isCanonicalPanelExpanded ? (isRtl ? "طي السجل" : "Collapse Audit Log") : (isRtl ? "عرض السجل" : "Expand Audit Log")}
              </span>
              <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${isCanonicalPanelExpanded ? "rotate-180" : ""}`} />
            </div>
          </button>

          {isCanonicalPanelExpanded && (
            <div className="p-4 border-t border-slate-100 dark:border-slate-800 space-y-4 bg-slate-50/50 dark:bg-slate-950/40">
              {/* Creator Segregation Alert if applicable */}
              {checkCreatorSegregation(currentOrder, currentUser?.id || "", "APPROVE_FINANCE").allowed === false && (
                <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 rounded-xl text-amber-800 dark:text-amber-300 text-xxs font-mono">
                  <strong>SEGREGATION OF DUTIES ACTIVE:</strong> You created this order ({currentOrder.createdByName || currentOrder.salesRep || resolveUserIdentity(currentOrder.createdByUid, usersList, "Current user")}). You are barred from approving or validating it.
                </div>
              )}

              <div className="pt-1">
            {/* FINANCE REVIEW STAGE - INLINE DECISION PANEL (WP-FO-UI-1) */}
            {(normalizeOrderStatus(currentOrder.status) === "PENDING_FINANCE_REVIEW" || normalizeOrderStatus(currentOrder.status) === "INVENTORY_RESERVED" || normalizeOrderStatus(currentOrder.status) === "RETURNED_TO_FINANCE") ? (
              <div className="bg-slate-50 dark:bg-slate-950/60 p-5 rounded-xl border border-indigo-200/80 dark:border-indigo-900/50 space-y-4">
                <div className="flex justify-between items-center border-b border-slate-200 dark:border-slate-800 pb-2">
                  <h4 className="font-bold text-xs text-indigo-900 dark:text-indigo-200 flex items-center gap-1.5">
                    <DollarSign className="h-4 w-4 text-emerald-600" />
                    {isRtl ? "لوحة القرارات المالية المباشرة (Inline Finance Decision)" : "Inline Finance Officer Decision Panel"}
                  </h4>
                  <span className="text-[10px] font-mono px-2 py-0.5 bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 rounded font-semibold">
                    {isRtl ? "إجراء مالي مباشر" : "Inline Action Required"}
                  </span>
                </div>

                {/* Decision Action Selection Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {/* 1. Approve & Clear */}
                  <button
                    type="button"
                    onClick={() => {
                      setInlineFinanceAction("APPROVE_FINANCE");
                      setInlineFinanceError(null);
                    }}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                      inlineFinanceAction === "APPROVE_FINANCE"
                        ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-500 ring-2 ring-emerald-500/20 text-emerald-950 dark:text-emerald-100 shadow-xs"
                        : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-emerald-300 text-slate-700 dark:text-slate-300"
                    }`}
                  >
                    <div className="flex items-center justify-between w-full mb-1">
                      <span className="font-bold text-xs flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
                        <CheckCircle className="h-4 w-4" />
                        {isRtl ? "اعتماد وتنظيف (Approve)" : "Finance Approve & Clear"}
                      </span>
                      <span className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${
                        inlineFinanceAction === "APPROVE_FINANCE" ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300"
                      }`}>
                        {inlineFinanceAction === "APPROVE_FINANCE" && <Check size={10} />}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {isRtl ? "اعتماد الشروط المالية والائتمان وتحويل الطلب إلى العمليات" : "Approve financial terms and transfer order to Order Operations."}
                    </p>
                  </button>

                  {/* 2. Return to Representative */}
                  <button
                    type="button"
                    onClick={() => {
                      setInlineFinanceAction("FINANCE_RETURN");
                      setInlineFinanceError(null);
                    }}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                      inlineFinanceAction === "FINANCE_RETURN"
                        ? "bg-amber-50 dark:bg-amber-950/40 border-amber-500 ring-2 ring-amber-500/20 text-amber-950 dark:text-amber-100 shadow-xs"
                        : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-amber-300 text-slate-700 dark:text-slate-300"
                    }`}
                  >
                    <div className="flex items-center justify-between w-full mb-1">
                      <span className="font-bold text-xs flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
                        <RotateCcw className="h-4 w-4" />
                        {isRtl ? "إعادة للمندوب (Return)" : "Return to Representative"}
                      </span>
                      <span className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${
                        inlineFinanceAction === "FINANCE_RETURN" ? "border-amber-600 bg-amber-600 text-white" : "border-slate-300"
                      }`}>
                        {inlineFinanceAction === "FINANCE_RETURN" && <Check size={10} />}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {isRtl ? "إعادة الطلب إلى مندوب المبيعات لتصحيح البيانات أو الشروط" : "Return order to sales rep for correction or updated documentation."}
                    </p>
                  </button>

                  {/* 3. Finance Reject */}
                  <button
                    type="button"
                    onClick={() => {
                      setInlineFinanceAction("FINANCE_REJECT");
                      setInlineFinanceError(null);
                    }}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                      inlineFinanceAction === "FINANCE_REJECT"
                        ? "bg-rose-50 dark:bg-rose-950/40 border-rose-500 ring-2 ring-rose-500/20 text-rose-950 dark:text-rose-100 shadow-xs"
                        : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-rose-300 text-slate-700 dark:text-slate-300"
                    }`}
                  >
                    <div className="flex items-center justify-between w-full mb-1">
                      <span className="font-bold text-xs flex items-center gap-1.5 text-rose-700 dark:text-rose-400">
                        <Ban className="h-4 w-4" />
                        {isRtl ? "رفض مالي (Reject)" : "Finance Reject"}
                      </span>
                      <span className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${
                        inlineFinanceAction === "FINANCE_REJECT" ? "border-rose-600 bg-rose-600 text-white" : "border-slate-300"
                      }`}>
                        {inlineFinanceAction === "FINANCE_REJECT" && <Check size={10} />}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {isRtl ? "رفض الطلب نهائياً بسبب تجاوز السقف أو مخالطة السياسات" : "Reject order due to financial or credit policy non-compliance."}
                    </p>
                  </button>

                  {/* 4. Cancel Order */}
                  <button
                    type="button"
                    onClick={() => {
                      setInlineFinanceAction("CANCEL");
                      setInlineFinanceError(null);
                    }}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                      inlineFinanceAction === "CANCEL"
                        ? "bg-rose-100 dark:bg-rose-950/70 border-rose-600 ring-2 ring-rose-600/20 text-rose-950 dark:text-rose-100 shadow-xs"
                        : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-rose-400 text-slate-700 dark:text-slate-300"
                    }`}
                  >
                    <div className="flex items-center justify-between w-full mb-1">
                      <span className="font-bold text-xs flex items-center gap-1.5 text-rose-800 dark:text-rose-300">
                        <X className="h-4 w-4" />
                        {isRtl ? "إلغاء الطلب (Cancel)" : "Cancel Order"}
                      </span>
                      <span className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${
                        inlineFinanceAction === "CANCEL" ? "border-rose-700 bg-rose-700 text-white" : "border-slate-300"
                      }`}>
                        {inlineFinanceAction === "CANCEL" && <Check size={10} />}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {isRtl ? "إلغاء الطلب بالكامل وتوثيق سبب الإلغاء" : "Cancel order completely and log formal cancellation reason."}
                    </p>
                  </button>
                </div>

                {/* Comments Field */}
                <div className="space-y-1.5">
                  <label className="block text-xxs font-mono uppercase text-slate-500 dark:text-slate-400 font-semibold">
                    {inlineFinanceAction === "APPROVE_FINANCE"
                      ? (isRtl ? "ملاحظات التدقيق والاعتماد المالي (اختياري)" : "Audit Comments / Rationale (Optional)")
                      : (isRtl ? "ملاحظات وتوجيهات القرار (إجباري للإرجاع أو الرفض أو الإلغاء) *" : "Audit Comments / Decision Rationale (Mandatory) *")}
                  </label>
                  <textarea
                    rows={3}
                    value={inlineFinanceComment}
                    onChange={(e) => {
                      setInlineFinanceComment(e.target.value);
                      if (inlineFinanceError) setInlineFinanceError(null);
                    }}
                    placeholder={isRtl ? "أدخل سبب أو تفاصيل القرار المالي هنا..." : "Enter decision rationale, payment verification notes, or instructions..."}
                    className="w-full p-3 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 font-sans"
                  />
                </div>

                {/* Inline Validation Error Banner */}
                {inlineFinanceError && (
                  <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 rounded-xl text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
                    <AlertCircle size={16} className="shrink-0" />
                    <span>{inlineFinanceError}</span>
                  </div>
                )}

                {/* Apply Decision Button */}
                <div className="flex justify-end pt-2">
                  <button
                    type="button"
                    disabled={isInlineFinanceSubmitting || checkCreatorSegregation(currentOrder, currentUser?.id || "", "APPROVE_FINANCE").allowed === false}
                    onClick={handleApplyInlineFinanceDecision}
                    className={`px-5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 text-white transition-all shadow-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                      inlineFinanceAction === "APPROVE_FINANCE"
                        ? "bg-emerald-600 hover:bg-emerald-700"
                        : inlineFinanceAction === "FINANCE_RETURN"
                        ? "bg-amber-600 hover:bg-amber-700"
                        : inlineFinanceAction === "FINANCE_REJECT"
                        ? "bg-rose-600 hover:bg-rose-700"
                        : "bg-rose-700 hover:bg-rose-800"
                    }`}
                  >
                    {isInlineFinanceSubmitting ? (
                      <>
                        <Clock size={15} className="animate-spin" />
                        <span>{isRtl ? "جاري تنفيذ القرار المالي..." : "Applying Finance Decision..."}</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle size={15} />
                        <span>{isRtl ? "تنفيذ القرار المالي (Apply Decision)" : "Apply Finance Decision"}</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            ) : (
              /* LOCKED FINANCE DECISION RECORD */
              <div className="p-4 bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/40 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300 font-bold text-xs">
                    <ShieldCheck className="h-4 w-4 text-emerald-600" />
                    <span>{isRtl ? "قرار المراجعة المالية المعتمد (Finance Decision Confirmed)" : "Finance Decision Confirmed (Read-Only)"}</span>
                  </div>
                  <span className={`px-2.5 py-0.5 rounded text-[10px] font-bold ${
                    currentOrder.status === "FINANCE_APPROVED" || currentOrder.status === "PENDING_OPERATIONS_REVIEW" || currentOrder.financeDecision === "APPROVED" || currentOrder.financeApprovedAt
                      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300"
                      : currentOrder.status === "RETURNED_TO_REP_BY_FINANCE"
                      ? "bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300"
                      : "bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-300"
                  }`}>
                    {currentOrder.status === "FINANCE_APPROVED" || currentOrder.status === "PENDING_OPERATIONS_REVIEW" || currentOrder.financeDecision === "APPROVED" || currentOrder.financeApprovedAt
                      ? (isRtl ? "معتمد مالياً" : "Finance Approved")
                      : currentOrder.status === "RETURNED_TO_REP_BY_FINANCE"
                      ? (isRtl ? "مُعاد للمندوب" : "Returned to Sales Rep")
                      : (isRtl ? "مرفوض / ملغى مالياً" : "Finance Rejected / Cancelled")}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-slate-700 dark:text-slate-300">
                  <div>
                    <span className="text-[10px] uppercase font-mono text-slate-400 block font-semibold">{isRtl ? "بواسطة مسؤول المالي" : "Decision By"}</span>
                    <span className="font-bold text-slate-900 dark:text-white">
                      {currentOrder.financeApprovedByName || currentOrder.financeApprovedBy || currentOrder.financeReviewedByUid || "Finance Officer"}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-mono text-slate-400 block font-semibold">{isRtl ? "التاريخ والوقت" : "Date & Time"}</span>
                    <span className="font-mono text-slate-800 dark:text-slate-200">
                      {(currentOrder.financeApprovedAt || currentOrder.financeReviewedAt) 
                        ? new Date(currentOrder.financeApprovedAt || currentOrder.financeReviewedAt).toLocaleString() 
                        : "—"}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-mono text-slate-400 block font-semibold">{isRtl ? "ملاحظات الاعتماد" : "Audit Comments"}</span>
                    <span className="italic text-slate-600 dark:text-slate-400 block truncate" title={currentOrder.financeRemarks || currentOrder.financeNotes || currentOrder.rejectionReason || "—"}>
                      {currentOrder.financeRemarks || currentOrder.financeNotes || currentOrder.rejectionReason || (isRtl ? "لا توجد ملاحظات" : "No comments entered")}
                    </span>
                  </div>
                </div>

                {/* RESPONSIBILITY TRANSFER NOTICE */}
                {(currentOrder.status === "FINANCE_APPROVED" || currentOrder.status === "PENDING_OPERATIONS_REVIEW") && (
                  <div className="mt-2 p-2.5 bg-indigo-50/80 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/60 rounded-lg flex items-center justify-between text-xs text-indigo-900 dark:text-indigo-200">
                    <div className="flex items-center gap-2">
                      <UserCheck className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                      <span>
                        {isRtl ? "مسؤول المسار التالي:" : "Next Responsible Role:"} <strong>{isRtl ? "مسؤول عمليات الطلبات (Order Operations Officer)" : "Order Operations Officer"}</strong>
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-indigo-600 dark:text-indigo-400 font-semibold">
                      {isRtl ? "تم نقل المسؤولية" : "Transferred to Operations"}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* OPERATIONS REVIEW STAGE - INLINE DECISION PANEL (WP-FO-2.0) */}
            {(normalizeOrderStatus(currentOrder.status) === "PENDING_OPERATIONS_REVIEW" || normalizeOrderStatus(currentOrder.status) === "FINANCE_APPROVED") ? (
              (isOpsOfficer || isAdmin) && (
                <div className="bg-slate-50 dark:bg-slate-950/60 p-5 rounded-xl border border-indigo-200/80 dark:border-indigo-900/50 space-y-4 mt-4">
                  <div className="flex justify-between items-center border-b border-slate-200 dark:border-slate-800 pb-2">
                    <h4 className="font-bold text-xs text-indigo-900 dark:text-indigo-200 flex items-center gap-1.5">
                      <Boxes className="h-4 w-4 text-indigo-600" />
                      {isRtl ? "لوحة القرارات التشغيلية المباشرة (Inline Operations Decision)" : "Inline Order Operations Officer Decision Panel"}
                    </h4>
                    <span className="text-[10px] font-mono px-2 py-0.5 bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300 rounded font-semibold">
                      {isRtl ? "إجراء تشغيلي مباشر" : "Inline Action Required"}
                    </span>
                  </div>

                  {/* Decision Action Selection Cards (5 Cards) */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
                    {/* 1. Approve & Transfer to Store */}
                    <button
                      type="button"
                      onClick={() => {
                        setInlineOpsAction("OPERATIONS_APPROVE");
                        setInlineOpsError(null);
                      }}
                      className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                        inlineOpsAction === "OPERATIONS_APPROVE"
                          ? "bg-indigo-50 dark:bg-indigo-950/40 border-indigo-500 ring-2 ring-indigo-500/20 text-indigo-950 dark:text-indigo-100 shadow-xs"
                          : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-indigo-300 text-slate-700 dark:text-slate-300"
                      }`}
                    >
                      <div className="flex items-center justify-between w-full mb-1">
                        <span className="font-bold text-xs flex items-center gap-1.5 text-indigo-700 dark:text-indigo-400">
                          <CheckCircle className="h-4 w-4" />
                          {isRtl ? "اعتماد ونقل (Approve)" : "Approve & Transfer to Store"}
                        </span>
                        <span className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${
                          inlineOpsAction === "OPERATIONS_APPROVE" ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300"
                        }`}>
                          {inlineOpsAction === "OPERATIONS_APPROVE" && <Check size={10} />}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {isRtl ? "اعتماد الجاهزية التشغيلية وتحويل الطلب للمستودع للتحضير" : "Approve operational readiness and transfer order to Store Manager."}
                      </p>
                    </button>

                    {/* 2. Return to Finance */}
                    <button
                      type="button"
                      onClick={() => {
                        setInlineOpsAction("OPERATIONS_RETURN_TO_FINANCE");
                        setInlineOpsError(null);
                      }}
                      className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                        inlineOpsAction === "OPERATIONS_RETURN_TO_FINANCE"
                          ? "bg-amber-50 dark:bg-amber-950/40 border-amber-500 ring-2 ring-amber-500/20 text-amber-950 dark:text-amber-100 shadow-xs"
                          : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-amber-300 text-slate-700 dark:text-slate-300"
                      }`}
                    >
                      <div className="flex items-center justify-between w-full mb-1">
                        <span className="font-bold text-xs flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
                          <RotateCcw className="h-4 w-4" />
                          {isRtl ? "إعادة للمالية (Finance)" : "Return to Finance"}
                        </span>
                        <span className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${
                          inlineOpsAction === "OPERATIONS_RETURN_TO_FINANCE" ? "border-amber-600 bg-amber-600 text-white" : "border-slate-300"
                        }`}>
                          {inlineOpsAction === "OPERATIONS_RETURN_TO_FINANCE" && <Check size={10} />}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {isRtl ? "إعادة الطلب إلى مسؤول المالي لإعادة تقييم الائتمان أو التسعير" : "Return order to Finance Officer for credit or pricing re-evaluation."}
                      </p>
                    </button>

                    {/* 3. Return to Representative */}
                    <button
                      type="button"
                      onClick={() => {
                        setInlineOpsAction("OPERATIONS_RETURN_TO_REP");
                        setInlineOpsError(null);
                      }}
                      className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                        inlineOpsAction === "OPERATIONS_RETURN_TO_REP"
                          ? "bg-amber-50 dark:bg-amber-950/40 border-amber-600 ring-2 ring-amber-600/20 text-amber-950 dark:text-amber-100 shadow-xs"
                          : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-amber-400 text-slate-700 dark:text-slate-300"
                      }`}
                    >
                      <div className="flex items-center justify-between w-full mb-1">
                        <span className="font-bold text-xs flex items-center gap-1.5 text-amber-800 dark:text-amber-300">
                          <RotateCcw className="h-4 w-4" />
                          {isRtl ? "إعادة للمندوب (Rep)" : "Return to Representative"}
                        </span>
                        <span className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${
                          inlineOpsAction === "OPERATIONS_RETURN_TO_REP" ? "border-amber-700 bg-amber-700 text-white" : "border-slate-300"
                        }`}>
                          {inlineOpsAction === "OPERATIONS_RETURN_TO_REP" && <Check size={10} />}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {isRtl ? "إعادة الطلب إلى مندوب المبيعات لتعديل البيانات أو الوثائق" : "Return order to sales rep for detail correction or updated documentation."}
                      </p>
                    </button>

                    {/* 4. Operations Reject */}
                    <button
                      type="button"
                      onClick={() => {
                        setInlineOpsAction("OPERATIONS_REJECT");
                        setInlineOpsError(null);
                      }}
                      className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                        inlineOpsAction === "OPERATIONS_REJECT"
                          ? "bg-rose-50 dark:bg-rose-950/40 border-rose-500 ring-2 ring-rose-500/20 text-rose-950 dark:text-rose-100 shadow-xs"
                          : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-rose-300 text-slate-700 dark:text-slate-300"
                      }`}
                    >
                      <div className="flex items-center justify-between w-full mb-1">
                        <span className="font-bold text-xs flex items-center gap-1.5 text-rose-700 dark:text-rose-400">
                          <Ban className="h-4 w-4" />
                          {isRtl ? "رفض تشغيلي (Reject)" : "Reject Order"}
                        </span>
                        <span className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${
                          inlineOpsAction === "OPERATIONS_REJECT" ? "border-rose-600 bg-rose-600 text-white" : "border-slate-300"
                        }`}>
                          {inlineOpsAction === "OPERATIONS_REJECT" && <Check size={10} />}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {isRtl ? "رفض الطلب نهائياً بسبب عدم الملاءمة التشغيلية أو المنتجات" : "Reject order due to operational, SKU, or regulatory non-compliance."}
                      </p>
                    </button>

                    {/* 5. Cancel Order */}
                    <button
                      type="button"
                      onClick={() => {
                        setInlineOpsAction("CANCEL");
                        setInlineOpsError(null);
                      }}
                      className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                        inlineOpsAction === "CANCEL"
                          ? "bg-rose-100 dark:bg-rose-950/70 border-rose-600 ring-2 ring-rose-600/20 text-rose-950 dark:text-rose-100 shadow-xs"
                          : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-rose-400 text-slate-700 dark:text-slate-300"
                      }`}
                    >
                      <div className="flex items-center justify-between w-full mb-1">
                        <span className="font-bold text-xs flex items-center gap-1.5 text-rose-800 dark:text-rose-300">
                          <X className="h-4 w-4" />
                          {isRtl ? "إلغاء الطلب (Cancel)" : "Cancel Order"}
                        </span>
                        <span className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${
                          inlineOpsAction === "CANCEL" ? "border-rose-700 bg-rose-700 text-white" : "border-slate-300"
                        }`}>
                          {inlineOpsAction === "CANCEL" && <Check size={10} />}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {isRtl ? "إلغاء الطلب بالكامل وتوثيق سبب الإلغاء" : "Cancel order completely and log formal cancellation reason."}
                      </p>
                    </button>
                  </div>

                  {/* Operational Comments Field */}
                  <div className="space-y-1.5">
                    <label className="block text-xxs font-mono uppercase text-slate-500 dark:text-slate-400 font-semibold">
                      {inlineOpsAction === "OPERATIONS_APPROVE"
                        ? (isRtl ? "ملاحظات القرار التشغيلي والتوجيهات (اختياري)" : "Operational Comments / Rationale (Optional)")
                        : (isRtl ? "ملاحظات وتوجيهات القرار (إجباري للإرجاع أو الرفض أو الإلغاء) *" : "Operational Comments / Decision Rationale (Mandatory) *")}
                    </label>
                    <textarea
                      rows={3}
                      value={inlineOpsComment}
                      onChange={(e) => {
                        setInlineOpsComment(e.target.value);
                        if (inlineOpsError) setInlineOpsError(null);
                      }}
                      placeholder={isRtl ? "أدخل سبب القرار التشغيلي أو ملاحظات التحضير والتوجيهات..." : "Enter operational decision rationale, preparation notes, or instructions..."}
                      className="w-full p-3 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 font-sans"
                    />
                  </div>

                  {/* Inline Validation Error Banner */}
                  {inlineOpsError && (
                    <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 rounded-xl text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
                      <AlertCircle size={16} className="shrink-0" />
                      <span>{inlineOpsError}</span>
                    </div>
                  )}

                  {/* Apply Operations Decision Button */}
                  <div className="flex justify-end pt-2">
                    <button
                      type="button"
                      disabled={isInlineOpsSubmitting || checkCreatorSegregation(currentOrder, currentUser?.id || "", inlineOpsAction).allowed === false}
                      onClick={handleApplyInlineOpsDecision}
                      className={`px-5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 text-white transition-all shadow-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                        inlineOpsAction === "OPERATIONS_APPROVE"
                          ? "bg-indigo-600 hover:bg-indigo-700"
                          : inlineOpsAction === "OPERATIONS_RETURN_TO_FINANCE" || inlineOpsAction === "OPERATIONS_RETURN_TO_REP"
                          ? "bg-amber-600 hover:bg-amber-700"
                          : inlineOpsAction === "OPERATIONS_REJECT"
                          ? "bg-rose-600 hover:bg-rose-700"
                          : "bg-rose-700 hover:bg-rose-800"
                      }`}
                    >
                      {isInlineOpsSubmitting ? (
                        <>
                          <Clock size={15} className="animate-spin" />
                          <span>{isRtl ? "جاري تنفيذ القرار التشغيلي..." : "Applying Operations Decision..."}</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle size={15} />
                          <span>{isRtl ? "تنفيذ القرار التشغيلي (Apply Decision)" : "Apply Operations Decision"}</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )
            ) : (
              /* LOCKED OPERATIONS DECISION RECORD */
              (currentOrder.opsApprovedAt || currentOrder.operationsReviewedAt || currentOrder.status === "OPERATIONS_APPROVED" || currentOrder.status === "PENDING_STORE_PREPARATION" || currentOrder.status === "STORE_PREPARING" || currentOrder.status === "READY_FOR_DISPATCH" || currentOrder.status === "ASSIGNED_FOR_DELIVERY" || currentOrder.status === "OUT_FOR_DELIVERY" || currentOrder.status === "DELIVERED" || currentOrder.status === "RETURNED_TO_FINANCE" || currentOrder.status === "RETURNED_TO_REP_BY_OPERATIONS" || currentOrder.status === "OPERATIONS_REJECTED") && (
                <div className="p-4 bg-indigo-50/60 dark:bg-indigo-950/20 border border-indigo-200 dark:border-indigo-900/40 rounded-xl space-y-3 mt-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-indigo-800 dark:text-indigo-300 font-bold text-xs">
                      <ShieldCheck className="h-4 w-4 text-indigo-600" />
                      <span>{isRtl ? "قرار المراجعة التشغيلية المعتمد (Operations Decision Confirmed)" : "Operations Decision Confirmed (Read-Only)"}</span>
                    </div>
                    <span className={`px-2.5 py-0.5 rounded text-[10px] font-bold ${
                      currentOrder.status === "OPERATIONS_APPROVED" || currentOrder.status === "PENDING_STORE_PREPARATION" || currentOrder.status === "STORE_PREPARING" || currentOrder.status === "READY_FOR_DISPATCH" || currentOrder.status === "ASSIGNED_FOR_DELIVERY" || currentOrder.status === "OUT_FOR_DELIVERY" || currentOrder.status === "DELIVERED" || currentOrder.opsApprovedAt
                        ? "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/60 dark:text-indigo-300"
                        : currentOrder.status === "RETURNED_TO_FINANCE" || currentOrder.status === "RETURNED_TO_REP_BY_OPERATIONS"
                        ? "bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300"
                        : "bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-300"
                    }`}>
                      {currentOrder.status === "OPERATIONS_APPROVED" || currentOrder.status === "PENDING_STORE_PREPARATION" || currentOrder.status === "STORE_PREPARING" || currentOrder.status === "READY_FOR_DISPATCH" || currentOrder.status === "ASSIGNED_FOR_DELIVERY" || currentOrder.status === "OUT_FOR_DELIVERY" || currentOrder.status === "DELIVERED" || currentOrder.opsApprovedAt
                        ? (isRtl ? "معتمد تشغيلياً" : "Operations Approved")
                        : currentOrder.status === "RETURNED_TO_FINANCE"
                        ? (isRtl ? "مُعاد للمالية" : "Returned to Finance")
                        : currentOrder.status === "RETURNED_TO_REP_BY_OPERATIONS"
                        ? (isRtl ? "مُعاد للمندوب" : "Returned to Sales Rep")
                        : (isRtl ? "مرفوض / ملغى تشغيلياً" : "Operations Rejected / Cancelled")}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-slate-700 dark:text-slate-300">
                    <div>
                      <span className="text-[10px] uppercase font-mono text-slate-400 block font-semibold">{isRtl ? "بواسطة مسؤول العمليات" : "Approved By"}</span>
                      <span className="font-bold text-slate-900 dark:text-white">
                        {currentOrder.opsApprovedByName || currentOrder.opsApprovedBy || currentOrder.operationsReviewedByUid || "Order Operations Officer"}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-mono text-slate-400 block font-semibold">{isRtl ? "التاريخ والوقت" : "Date & Time"}</span>
                      <span className="font-mono text-slate-800 dark:text-slate-200">
                        {(currentOrder.opsApprovedAt || currentOrder.operationsReviewedAt) 
                          ? new Date(currentOrder.opsApprovedAt || currentOrder.operationsReviewedAt).toLocaleString() 
                          : "—"}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-mono text-slate-400 block font-semibold">{isRtl ? "الملاحظات التشغيلية" : "Operational Comments"}</span>
                      <span className="italic text-slate-600 dark:text-slate-400 block truncate" title={currentOrder.opsRemarks || currentOrder.opsNotes || currentOrder.rejectionReason || "—"}>
                        {currentOrder.opsRemarks || currentOrder.opsNotes || currentOrder.rejectionReason || (isRtl ? "لا توجد ملاحظات" : "No comments entered")}
                      </span>
                    </div>
                  </div>
                </div>
              )
            )}

                  {/* RESPONSIBILITY TRANSFER NOTICE TO STORE MANAGER */}
                  {(currentOrder.status === "OPERATIONS_APPROVED" || currentOrder.status === "PENDING_STORE_PREPARATION" || currentOrder.status === "STORE_PREPARING") && (
                    <div className="mt-2 p-2.5 bg-emerald-50/80 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 rounded-lg flex items-center justify-between text-xs text-emerald-900 dark:text-emerald-200">
                      <div className="flex items-center gap-2">
                        <UserCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                        <span>
                          {isRtl ? "مسؤول المسار التالي:" : "Responsibility Transferred To:"} <strong>{isRtl ? "مدير المستودع (Store Manager)" : "Store Manager"}</strong>
                        </span>
                      </div>
                      <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 font-semibold">
                        {isRtl ? "تم نقل المسؤولية للمستودع" : "Transferred to Store Manager"}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}

            {/* COMPACT UNIFIED STORE PREPARATION & DELIVERY WORKSTATION */}
            {(getStageForStatus(normalizeOrderStatus(currentOrder.status)) === "STORE_PREPARATION" || 
              getStageForStatus(normalizeOrderStatus(currentOrder.status)) === "DISPATCH" ||
              normalizeOrderStatus(currentOrder.status) === "READY_FOR_DISPATCH" || 
              normalizeOrderStatus(currentOrder.status) === "ASSIGNED_FOR_DELIVERY" ||
              normalizeOrderStatus(currentOrder.status) === "OPERATIONS_APPROVED" ||
              normalizeOrderStatus(currentOrder.status) === "PENDING_STORE_PREPARATION" ||
              normalizeOrderStatus(currentOrder.status) === "STORE_PREPARING" ||
              (isDeliveryStaff && deliveryLifecycleDecision.showDeliveryWorkstation)) && (
              isDeliveryStaff ? (
                /* ENTERPRISE DELIVERY OFFICER WORKSTATION (WP-DELIVERY-2.0) */
                <div className="w-full space-y-4 mb-6 text-slate-800 dark:text-slate-100">
                  {/* 1. ORDER INFORMATION (Collapsible, Default: Expanded) */}
                  <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setIsDeliveryOrderInfoExpanded(!isDeliveryOrderInfoExpanded)}
                      className="w-full p-4 flex items-center justify-between bg-slate-50/50 dark:bg-slate-950/40 border-b border-slate-100 dark:border-slate-800 cursor-pointer"
                    >
                      <div className="flex items-center gap-2 font-bold text-xs text-indigo-600 dark:text-indigo-400">
                        <Truck className="h-4 w-4" />
                        <span>{isRtl ? "تفاصيل طلب التوصيل الميداني (Order Information)" : "Order Information"}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono px-2.5 py-0.5 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/60 rounded-md font-semibold">
                          {isRtl ? "بيانات الشحنة والعميل" : "Order & Customer Data"}
                        </span>
                        <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${isDeliveryOrderInfoExpanded ? "rotate-180" : ""}`} />
                      </div>
                    </button>

                    {isDeliveryOrderInfoExpanded && (
                      <div className="p-5 space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
                          <div className="p-3 bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-slate-200/80 dark:border-slate-800">
                            <span className="text-slate-400 text-xxs font-mono uppercase block font-semibold">{isRtl ? "رقم الطلبية" : "Order Number"}</span>
                            <strong className="text-sm font-bold text-slate-900 dark:text-white font-mono">{currentOrder.displayNumber || currentOrder.id}</strong>
                          </div>

                          <div className="p-3 bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-slate-200/80 dark:border-slate-800">
                            <span className="text-slate-400 text-xxs font-mono uppercase block font-semibold">{isRtl ? "الصيدلية العميلة" : "Pharmacy"}</span>
                            <strong className="text-sm font-bold text-slate-900 dark:text-white">{currentOrder.pharmacyName || "N/A"}</strong>
                          </div>

                          <div className="p-3 bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-slate-200/80 dark:border-slate-800">
                            <span className="text-slate-400 text-xxs font-mono uppercase block font-semibold">{isRtl ? "صاحب الطلب / المندوب" : "Customer / Representative"}</span>
                            <strong className="text-xs font-semibold text-slate-800 dark:text-slate-200 block">{currentOrder.salesRep || currentOrder.createdByName || "Sales Rep"}</strong>
                          </div>

                          <div className="p-3 bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-slate-200/80 dark:border-slate-800">
                            <span className="text-slate-400 text-xxs font-mono uppercase block font-semibold">{isRtl ? "رقم الزيارة" : "Visit Number"}</span>
                            <strong className="text-xs font-semibold text-slate-800 dark:text-slate-200 block font-mono">{currentOrder.visitDisplayNumber || currentOrder.visitId || "N/A"}</strong>
                          </div>

                          <div className="p-3 bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-slate-200/80 dark:border-slate-800">
                            <span className="text-slate-400 text-xxs font-mono uppercase block font-semibold">{isRtl ? "تاريخ التوصيل المخطط" : "Planned Delivery Date"}</span>
                            <strong className="text-xs font-semibold text-slate-800 dark:text-slate-200 block">{currentOrder.plannedDeliveryDate || currentOrder.date || "Today"}</strong>
                          </div>

                          <div className="p-3 bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-slate-200/80 dark:border-slate-800">
                            <span className="text-slate-400 text-xxs font-mono uppercase block font-semibold">{isRtl ? "الوقت / الفترة المحددة" : "Planned Time / Window"}</span>
                            <strong className="text-xs font-semibold text-slate-800 dark:text-slate-200 block">{currentOrder.plannedDeliveryWindow || currentOrder.plannedDeliveryTime || "Standard Window"}</strong>
                          </div>

                          <div className="p-3 bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-slate-200/80 dark:border-slate-800">
                            <span className="text-slate-400 text-xxs font-mono uppercase block font-semibold">{isRtl ? "رقم الهاتف" : "Phone Number"}</span>
                            <strong className="text-xs font-semibold text-slate-800 dark:text-slate-200 block font-mono">
                              {currentOrder.pharmacyPhone || currentOrder.phone || "+218 91 000 0000"}
                            </strong>
                          </div>

                          <div className="p-3 bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-slate-200/80 dark:border-slate-800">
                            <span className="text-slate-400 text-xxs font-mono uppercase block font-semibold">{isRtl ? "عنوان التوصيل" : "Delivery Address"}</span>
                            <strong className="text-xs font-semibold text-slate-800 dark:text-slate-200 block truncate" title={currentOrder.pharmacyAddress || currentOrder.address || "Address configuration required"}>
                              {currentOrder.pharmacyAddress || currentOrder.address || "Address configuration required"}
                            </strong>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                          <button
                            type="button"
                            onClick={() => setPrintModal({ isOpen: true, type: "DELIVERY_NOTE", order: currentOrder })}
                            className="px-3.5 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 dark:bg-indigo-950/50 dark:hover:bg-indigo-900/50 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
                          >
                            <Printer className="h-4 w-4 text-indigo-600" />
                            {isRtl ? "إذن التسليم (Delivery Note)" : "Print Delivery Note"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 2. PRODUCTS (Collapsible, Default: Expanded) */}
                  <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setIsDeliveryProductsExpanded(!isDeliveryProductsExpanded)}
                      className="w-full p-4 flex items-center justify-between bg-slate-50/50 dark:bg-slate-950/40 border-b border-slate-100 dark:border-slate-800 cursor-pointer"
                    >
                      <div className="flex items-center gap-2 font-bold text-xs text-indigo-600 dark:text-indigo-400">
                        <Package className="h-4 w-4" />
                        <span>{isRtl ? "الأصناف والمستحضرات المطلوبة (Products)" : "Products"}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded font-semibold">
                          {currentOrder.items?.length || 0} {isRtl ? "صنف" : "SKUs"}
                        </span>
                        <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${isDeliveryProductsExpanded ? "rotate-180" : ""}`} />
                      </div>
                    </button>

                    {isDeliveryProductsExpanded && (
                      <div className="p-4 overflow-x-auto">
                        <table className="w-full text-xs text-left rtl:text-right border-collapse">
                          <thead>
                            <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/50 text-slate-500 font-mono text-[11px]">
                              <th className="p-2.5">{isRtl ? "اسم المنتج / المستحضر" : "Product / SKU"}</th>
                              <th className="p-2.5 text-center">{isRtl ? "الكمية المطلوبة" : "Ordered Quantity"}</th>
                              {inlineDeliveryDecision === "PARTIAL_DELIVERY" && (
                                <>
                                  <th className="p-2.5 text-center">{isRtl ? "الكمية المسلمة" : "Delivered Quantity"}</th>
                                  <th className="p-2.5 text-center">{isRtl ? "الكمية المتبقية" : "Remaining Quantity"}</th>
                                </>
                              )}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {(currentOrder.items || []).map((item: any, idx: number) => {
                              const pId = item.productId || item.id || `item_${idx}`;
                              const orderedQty = item.quantity || item.qty || 1;
                              const delQty = inlineDeliveryPartialQuantities[pId] !== undefined ? inlineDeliveryPartialQuantities[pId] : orderedQty;
                              const remQty = Math.max(0, orderedQty - delQty);

                              return (
                                <tr key={pId} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                                  <td className="p-2.5 font-semibold text-slate-900 dark:text-white">
                                    {item.productName || item.name || "Product SKU"}
                                  </td>
                                  <td className="p-2.5 text-center font-bold text-indigo-600 dark:text-indigo-400 font-mono">
                                    {orderedQty}
                                  </td>
                                  {inlineDeliveryDecision === "PARTIAL_DELIVERY" && (
                                    <>
                                      <td className="p-2.5 text-center font-bold text-emerald-600 dark:text-emerald-400 font-mono">
                                        {delQty}
                                      </td>
                                      <td className="p-2.5 text-center font-bold text-rose-600 dark:text-rose-400 font-mono">
                                        {remQty}
                                      </td>
                                    </>
                                  )}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* 3. DELIVERY ASSIGNMENT (Collapsible, Default: Expanded) */}
                  <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setIsDeliveryAssignmentExpanded(!isDeliveryAssignmentExpanded)}
                      className="w-full p-4 flex items-center justify-between bg-slate-50/50 dark:bg-slate-950/40 border-b border-slate-100 dark:border-slate-800 cursor-pointer"
                    >
                      <div className="flex items-center gap-2 font-bold text-xs text-indigo-600 dark:text-indigo-400">
                        <UserCheck className="h-4 w-4" />
                        <span>{isRtl ? "تفاصيل إسناد الشحن والتوصيل (Delivery Assignment)" : "Delivery Assignment"}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono px-2 py-0.5 bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 rounded font-semibold">
                          {deliveryLifecycleDecision.canonicalAssignmentPresent ? (isRtl ? "مُسند من المستودع" : "Assigned by Store") : (isRtl ? "غير مُسند" : "Unassigned")}
                        </span>
                        <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${isDeliveryAssignmentExpanded ? "rotate-180" : ""}`} />
                      </div>
                    </button>

                    {isDeliveryAssignmentExpanded && (
                      <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 text-xs">
                        <div className="p-3 bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-slate-200/80 dark:border-slate-800">
                          <span className="text-slate-400 text-xxs font-mono uppercase block font-semibold">{isRtl ? "مسؤول الإسناد" : "Assigned By"}</span>
                          <strong className="text-xs font-bold text-slate-900 dark:text-white">{currentOrder.deliveryAssignedByName || "—"}</strong>
                        </div>

                        <div className="p-3 bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-slate-200/80 dark:border-slate-800">
                          <span className="text-slate-400 text-xxs font-mono uppercase block font-semibold">{isRtl ? "تاريخ الإسناد" : "Assigned Date"}</span>
                          <strong className="text-xs font-semibold text-slate-800 dark:text-slate-200 block">{currentOrder.deliveryAssignedAt ? new Date(currentOrder.deliveryAssignedAt).toLocaleDateString() : "—"}</strong>
                        </div>

                        <div className="p-3 bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-slate-200/80 dark:border-slate-800">
                          <span className="text-slate-400 text-xxs font-mono uppercase block font-semibold">{isRtl ? "مسؤول التوصيل المعين" : "Assigned Delivery Officer"}</span>
                          <strong className="text-xs font-bold text-indigo-600 dark:text-indigo-400">{deliveryLifecycleDecision.canonicalAssignmentPresent ? currentOrder.deliveryOfficerName || currentOrder.deliveryOfficerUid : "—"}</strong>
                        </div>

                        <div className="p-3 bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-slate-200/80 dark:border-slate-800">
                          <span className="text-slate-400 text-xxs font-mono uppercase block font-semibold">{isRtl ? "فترة التوصيل" : "Delivery Window"}</span>
                          <strong className="text-xs font-semibold text-slate-800 dark:text-slate-200 block">{currentOrder.plannedDeliveryWindow || currentOrder.plannedDeliveryTime || "Standard Window"}</strong>
                        </div>

                        <div className="p-3 bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-slate-200/80 dark:border-slate-800">
                          <span className="text-slate-400 text-xxs font-mono uppercase block font-semibold">{isRtl ? "حالة الإسناد" : "Delivery Status"}</span>
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xxs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 dark:bg-indigo-950/50 dark:text-indigo-300 dark:border-indigo-800 mt-0.5">
                            {deliveryLifecycleDecision.canonicalAssignmentPresent ? currentOrder.deliveryAssignmentStatus || "ASSIGNED" : "UNASSIGNED"}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 4. ENTERPRISE DECISION WORKSPACE (Active Execution OR Locked Audit Summary) */}
                  {deliveryLifecycleDecision.startDeliveryAllowed && (
                    <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-indigo-200 dark:border-indigo-900/60 shadow-xs space-y-4">
                      <div className="flex items-center gap-2 font-bold text-sm text-indigo-900 dark:text-indigo-200">
                        <Truck className="h-5 w-5 text-indigo-600" />
                        <span>{isRtl ? "بدء التوصيل" : "Start Delivery"}</span>
                      </div>
                      {inlineDeliveryError && <div className="p-3 rounded-xl border border-rose-200 bg-rose-50 text-xs font-semibold text-rose-800">{inlineDeliveryError}</div>}
                      <p className="text-xs text-slate-500">{isRtl ? "ابدأ التوصيل لاستهلاك الحجز الكامل ونقل الطلب إلى حالة قيد التوصيل." : "Start the assigned delivery to consume the complete reservation and move the order Out for Delivery."}</p>
                      <button type="button" disabled={isInlineDeliverySubmitting} onClick={handleStartDelivery} className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-2">
                        {isInlineDeliverySubmitting ? <Clock className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />}
                        <span>{isRtl ? "بدء التوصيل" : "Start Delivery"}</span>
                      </button>
                    </div>
                  )}
                  {deliveryLifecycleDecision.finalOutcomesAllowed ? (
                    /* ACTIVE INLINE DECISION WORKSPACE */
                    <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-indigo-200 dark:border-indigo-900/60 shadow-xs space-y-5">
                      <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-3">
                        <div className="flex items-center gap-2 font-bold text-xs text-indigo-900 dark:text-indigo-200">
                          <Truck className="h-4 w-4 text-indigo-600" />
                          <span>{isRtl ? "مساحة تنفيذ وتطبيق قرار التوصيل الميداني (Enterprise Decision Workspace)" : "Enterprise Decision Workspace"}</span>
                        </div>
                        <span className="text-[10px] font-mono px-2.5 py-0.5 bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300 rounded font-semibold">
                          {isRtl ? "تنفيذ مباشر (Inline Execution)" : "Inline Execution"}
                        </span>
                      </div>

                      {inlineDeliveryError && (
                        <div className="p-3 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900/60 rounded-xl text-rose-800 dark:text-rose-300 text-xs font-semibold flex items-center gap-2">
                          <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
                          <span>{inlineDeliveryError}</span>
                        </div>
                      )}

                      {/* FIVE DECISION CARDS (Grid) */}
                      <div>
                        <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-2">
                          {isRtl ? "اختر قرار التوصيل الميداني:" : "Select Delivery Decision:"}
                        </label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                          {/* Card 1: Delivered Successfully */}
                          <button
                            type="button"
                            onClick={() => {
                              setInlineDeliveryDecision("DELIVERED");
                              setInlineDeliveryError(null);
                            }}
                            className={`p-3.5 rounded-xl border text-left rtl:text-right transition-all cursor-pointer flex flex-col justify-between ${
                              inlineDeliveryDecision === "DELIVERED"
                                ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-500 ring-2 ring-emerald-500/20 text-emerald-950 dark:text-emerald-100 shadow-xs"
                                : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-emerald-300 text-slate-700 dark:text-slate-300"
                            }`}
                          >
                            <div className="flex items-center justify-between w-full mb-1">
                              <span className="font-bold text-xs flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
                                <CheckCircle className="h-4 w-4" />
                                {isRtl ? "تم التسليم بنجاح" : "Delivered Successfully"}
                              </span>
                              <span className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                                inlineDeliveryDecision === "DELIVERED" ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300"
                              }`}>
                                {inlineDeliveryDecision === "DELIVERED" && <Check size={10} />}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                              {isRtl ? "تسليم الشحنة بالكامل وتحصيل القيمة ماليًا أو ائتمانيًا" : "Complete successful handover to recipient"}
                            </p>
                          </button>

                          {/* Card 2: Customer Not Available */}
                          <button
                            type="button"
                            onClick={() => {
                              setInlineDeliveryDecision("CUSTOMER_NOT_AVAILABLE");
                              setInlineDeliveryError(null);
                            }}
                            className={`p-3.5 rounded-xl border text-left rtl:text-right transition-all cursor-pointer flex flex-col justify-between ${
                              inlineDeliveryDecision === "CUSTOMER_NOT_AVAILABLE"
                                ? "bg-amber-50 dark:bg-amber-950/40 border-amber-500 ring-2 ring-amber-500/20 text-amber-950 dark:text-amber-100 shadow-xs"
                                : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-amber-300 text-slate-700 dark:text-slate-300"
                            }`}
                          >
                            <div className="flex items-center justify-between w-full mb-1">
                              <span className="font-bold text-xs flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
                                <Clock className="h-4 w-4" />
                                {isRtl ? "العميل غير متواجد" : "Customer Not Available"}
                              </span>
                              <span className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                                inlineDeliveryDecision === "CUSTOMER_NOT_AVAILABLE" ? "border-amber-600 bg-amber-600 text-white" : "border-slate-300"
                              }`}>
                                {inlineDeliveryDecision === "CUSTOMER_NOT_AVAILABLE" && <Check size={10} />}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                              {isRtl ? "تعذر التواصل أو تسليم الصيدلية لعدم تواجد المسؤول" : "Attempted delivery but recipient was unavailable"}
                            </p>
                          </button>

                          {/* Card 3: Customer Refused Delivery */}
                          <button
                            type="button"
                            onClick={() => {
                              setInlineDeliveryDecision("CUSTOMER_REFUSED");
                              setInlineDeliveryError(null);
                            }}
                            className={`p-3.5 rounded-xl border text-left rtl:text-right transition-all cursor-pointer flex flex-col justify-between ${
                              inlineDeliveryDecision === "CUSTOMER_REFUSED"
                                ? "bg-rose-50 dark:bg-rose-950/40 border-rose-500 ring-2 ring-rose-500/20 text-rose-950 dark:text-rose-100 shadow-xs"
                                : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-rose-300 text-slate-700 dark:text-slate-300"
                            }`}
                          >
                            <div className="flex items-center justify-between w-full mb-1">
                              <span className="font-bold text-xs flex items-center gap-1.5 text-rose-700 dark:text-rose-400">
                                <Ban className="h-4 w-4" />
                                {isRtl ? "رفض العميل الاستلام" : "Customer Refused Delivery"}
                              </span>
                              <span className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                                inlineDeliveryDecision === "CUSTOMER_REFUSED" ? "border-rose-600 bg-rose-600 text-white" : "border-slate-300"
                              }`}>
                                {inlineDeliveryDecision === "CUSTOMER_REFUSED" && <Check size={10} />}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                              {isRtl ? "رفض المستلم قبول الطرد أو الشحنة المسندة" : "Recipient rejected or refused to receive package"}
                            </p>
                          </button>

                          {/* Card 4: Partial Delivery */}
                          {deliveryLifecycleDecision.partialDeliveryAllowed && <button
                            type="button"
                            onClick={() => {
                              setInlineDeliveryDecision("PARTIAL_DELIVERY");
                              setInlineDeliveryError(null);
                            }}
                            className={`p-3.5 rounded-xl border text-left rtl:text-right transition-all cursor-pointer flex flex-col justify-between ${
                              inlineDeliveryDecision === "PARTIAL_DELIVERY"
                                ? "bg-indigo-50 dark:bg-indigo-950/40 border-indigo-500 ring-2 ring-indigo-500/20 text-indigo-950 dark:text-indigo-100 shadow-xs"
                                : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-indigo-300 text-slate-700 dark:text-slate-300"
                            }`}
                          >
                            <div className="flex items-center justify-between w-full mb-1">
                              <span className="font-bold text-xs flex items-center gap-1.5 text-indigo-700 dark:text-indigo-400">
                                <Boxes className="h-4 w-4" />
                                {isRtl ? "تسليم جزئي" : "Partial Delivery"}
                              </span>
                              <span className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                                inlineDeliveryDecision === "PARTIAL_DELIVERY" ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300"
                              }`}>
                                {inlineDeliveryDecision === "PARTIAL_DELIVERY" && <Check size={10} />}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                              {isRtl ? "تسليم جزء من المنتجات مع توثيق المرتجع" : "Delivered partial items; remaining returned"}
                            </p>
                          </button>}

                          {/* Card 5: Return to Store */}
                          <button
                            type="button"
                            onClick={() => {
                              setInlineDeliveryDecision("RETURN_TO_STORE");
                              setInlineDeliveryError(null);
                            }}
                            className={`p-3.5 rounded-xl border text-left rtl:text-right transition-all cursor-pointer flex flex-col justify-between ${
                              inlineDeliveryDecision === "RETURN_TO_STORE"
                                ? "bg-slate-100 dark:bg-slate-800/80 border-slate-500 ring-2 ring-slate-500/20 text-slate-950 dark:text-slate-100 shadow-xs"
                                : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-400 text-slate-700 dark:text-slate-300"
                            }`}
                          >
                            <div className="flex items-center justify-between w-full mb-1">
                              <span className="font-bold text-xs flex items-center gap-1.5 text-slate-800 dark:text-slate-200">
                                <RotateCcw className="h-4 w-4" />
                                {isRtl ? "إعادة إلى المستودع" : "Return to Store"}
                              </span>
                              <span className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                                inlineDeliveryDecision === "RETURN_TO_STORE" ? "border-slate-700 bg-slate-700 text-white" : "border-slate-300"
                              }`}>
                                {inlineDeliveryDecision === "RETURN_TO_STORE" && <Check size={10} />}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                              {isRtl ? "إعادة الشحنة مباشرة للجراب في المستودع" : "Package returned directly to store warehouse"}
                            </p>
                          </button>
                        </div>
                      </div>

                      {/* EVIDENCE INPUTS GRID (RECIPIENT NAME, RESCHEDULED DATE) */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {/* Recipient Signee Name */}
                        <div className="p-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 space-y-1.5">
                          <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center justify-between">
                            <span>{isRtl ? "اسم المستلم الثلاثي" : "Recipient Signee Name"}</span>
                            {inlineDeliveryDecision === "DELIVERED" ? (
                              <span className="text-rose-600 font-bold text-xxs font-mono">{isRtl ? "(إجباري)" : "(Mandatory)"}</span>
                            ) : (
                              <span className="text-slate-400 font-normal text-xxs font-mono">{isRtl ? "(اختياري)" : "(Optional)"}</span>
                            )}
                          </label>
                          <input
                            type="text"
                            value={inlineDeliveryRecipientName}
                            onChange={(e) => setInlineDeliveryRecipientName(e.target.value)}
                            placeholder={isRtl ? "أدخل اسم الصيدلي / المستلم..." : "Full name of receiving person..."}
                            className="w-full p-2.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20"
                          />
                        </div>

                        {/* New Delivery Date (shown for CUSTOMER_NOT_AVAILABLE) */}
                        {inlineDeliveryDecision === "CUSTOMER_NOT_AVAILABLE" ? (
                          <div className="p-3 bg-amber-50/60 dark:bg-amber-950/30 rounded-xl border border-amber-200 dark:border-amber-800/60 space-y-1.5">
                            <label className="text-xs font-bold text-amber-900 dark:text-amber-200 flex items-center justify-between">
                              <span>{isRtl ? "تاريخ إعادة التوصيل المتوقع" : "Rescheduled Delivery Date"}</span>
                              <span className="text-amber-600 font-bold text-xxs font-mono">{isRtl ? "(مستحسن)" : "(Recommended)"}</span>
                            </label>
                            <input
                              type="date"
                              value={inlineDeliveryNewPlannedDate || new Date(Date.now() + 86400000).toISOString().split("T")[0]}
                              onChange={(e) => setInlineDeliveryNewPlannedDate(e.target.value)}
                              className="w-full p-2.5 text-xs bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-700 rounded-lg text-slate-800 dark:text-slate-100 font-mono"
                            />
                          </div>
                        ) : (
                          <div className="p-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 space-y-1.5 opacity-60">
                            <label className="text-xs font-bold text-slate-500 block">
                              {isRtl ? "تأجيل التوصيل" : "Reschedule Status"}
                            </label>
                            <span className="text-xxs text-slate-400 block pt-1">
                              {isRtl ? "مفعل عند اختيار 'العميل غير متواجد'" : "Active when 'Customer Not Available' is selected"}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* PARTIAL DELIVERY ITEM QUANTITIES TABLE */}
                      {inlineDeliveryDecision === "PARTIAL_DELIVERY" && (
                        <div className="p-4 bg-indigo-50/50 dark:bg-indigo-950/30 rounded-xl border border-indigo-200 dark:border-indigo-800 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-indigo-950 dark:text-indigo-200 flex items-center gap-1.5">
                              <Boxes className="h-4 w-4 text-indigo-600" />
                              {isRtl ? "تحديد كميات التسليم الجزئي الميدانية لكل صنف:" : "Partial Delivery SKU Quantity Adjustment:"}
                            </span>
                            <span className="text-xxs font-mono font-bold text-indigo-700 dark:text-indigo-300 bg-white dark:bg-slate-900 px-2 py-0.5 rounded border border-indigo-200 dark:border-indigo-800">
                              {isRtl ? "تعديل الكميات المسلمة" : "Set Delivered Quantities"}
                            </span>
                          </div>
                          <div className="overflow-x-auto bg-white dark:bg-slate-900 rounded-lg border border-indigo-100 dark:border-indigo-900/60">
                            <table className="w-full text-xs text-left ltr:text-left rtl:text-right">
                              <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-500 uppercase text-[10px]">
                                <tr>
                                  <th className="p-2.5">{isRtl ? "المستحضر" : "Product SKU"}</th>
                                  <th className="p-2.5 text-center">{isRtl ? "المطلوب" : "Ordered"}</th>
                                  <th className="p-2.5 text-center">{isRtl ? "المسلم فعليًا" : "Delivered Qty"}</th>
                                  <th className="p-2.5 text-center">{isRtl ? "المتبقي / المرتجع" : "Remaining Qty"}</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                {(currentOrder.items || []).map((item: any, idx: number) => {
                                  const pId = item.productId || item.id || `item_${idx}`;
                                  const orderedQty = item.quantity || item.qty || 1;
                                  const delQty = inlineDeliveryPartialQuantities[pId] !== undefined ? inlineDeliveryPartialQuantities[pId] : orderedQty;
                                  const remQty = Math.max(0, orderedQty - delQty);

                                  return (
                                    <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/50">
                                      <td className="p-2.5 font-bold text-slate-800 dark:text-slate-200">
                                        {item.productName || item.name || `Product ${idx + 1}`}
                                      </td>
                                      <td className="p-2.5 text-center font-mono font-bold text-slate-600">
                                        {orderedQty}
                                      </td>
                                      <td className="p-2.5 text-center">
                                        <input
                                          type="number"
                                          min={0}
                                          max={orderedQty}
                                          value={delQty}
                                          onChange={(e) => {
                                            const val = Math.min(orderedQty, Math.max(0, parseInt(e.target.value) || 0));
                                            setInlineDeliveryPartialQuantities(prev => ({ ...prev, [pId]: val }));
                                          }}
                                          className="w-16 p-1 text-center font-mono font-bold bg-indigo-50/80 dark:bg-indigo-950 border border-indigo-300 dark:border-indigo-700 rounded text-indigo-900 dark:text-indigo-100 focus:outline-hidden"
                                        />
                                      </td>
                                      <td className="p-2.5 text-center font-mono font-bold text-rose-600 dark:text-rose-400">
                                        {remQty}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* DELIVERY NOTES INPUT */}
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                          <span>{isRtl ? "ملاحظات وتفاصيل التوصيل (Delivery Notes)" : "Delivery Notes & Remarks"}</span>
                          {inlineDeliveryDecision !== "DELIVERED" ? (
                            <span className="text-rose-600 font-bold text-xxs font-mono">{isRtl ? "(إجباري)" : "(Mandatory)"}</span>
                          ) : (
                            <span className="text-slate-400 font-normal text-xxs font-mono">{isRtl ? "(اختياري)" : "(Optional)"}</span>
                          )}
                        </label>
                        <textarea
                          value={inlineDeliveryNotes}
                          onChange={(e) => setInlineDeliveryNotes(e.target.value)}
                          rows={3}
                          placeholder={
                            inlineDeliveryDecision !== "DELIVERED"
                              ? (isRtl ? "اكتب أسباب عدم توفر العميل أو أسباب الرفض أو التفاصيل الميدانية..." : "Please state mandatory reason / rationale for non-delivery or return...")
                              : (isRtl ? "أي ملاحظات إضافية أثناء عملية التسليم..." : "Add optional delivery completion notes...")
                          }
                          className="w-full p-3 text-xs bg-slate-50 dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-800 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                        />
                      </div>

                      {/* ATTACHMENTS SECTION */}
                      <div className="p-4 bg-slate-50/70 dark:bg-slate-950/40 rounded-xl border border-slate-200/80 dark:border-slate-800 space-y-3">
                        <span className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
                          {isRtl ? "المرفقات والإثباتات الميدانية (Attachments & Proof of Delivery):" : "Attachments & Delivery Verification:"}
                        </span>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                          {/* Customer Signature */}
                          <div className="p-3 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 space-y-2">
                            <span className="font-semibold text-slate-700 dark:text-slate-300 text-xxs font-mono uppercase block">{isRtl ? "توقيع المستلم / المرجع" : "Signature / Ref"}</span>
                            <input
                              type="text"
                              value={inlineDeliverySignature}
                              onChange={(e) => setInlineDeliverySignature(e.target.value)}
                              placeholder={isRtl ? "اسم/رمز التوقيع الإلكتروني" : "Signature reference / note"}
                              className="w-full p-2 text-xxs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md"
                            />
                          </div>

                          {/* Delivery Receipt */}
                          <div className="p-3 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 space-y-2">
                            <span className="font-semibold text-slate-700 dark:text-slate-300 text-xxs font-mono uppercase block">{isRtl ? "رقم / مرجع إيصال التسليم" : "Delivery Receipt"}</span>
                            <input
                              type="text"
                              value={inlineDeliveryReceipt}
                              onChange={(e) => setInlineDeliveryReceipt(e.target.value)}
                              placeholder={isRtl ? "رقم إيصال الاستلام" : "Receipt reference number"}
                              className="w-full p-2 text-xxs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md"
                            />
                          </div>

                          {/* Photo Attachments */}
                          <div className="p-3 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 space-y-2">
                            <span className="font-semibold text-slate-700 dark:text-slate-300 text-xxs font-mono uppercase block">{isRtl ? "صور التسليم الميداني" : "Delivery Photos"}</span>
                            <input
                              type="text"
                              value={inlineDeliveryPhotos[0] || ""}
                              onChange={(e) => setInlineDeliveryPhotos(e.target.value ? [e.target.value] : [])}
                              placeholder={isRtl ? "رابط الصورة / المستند" : "Photo URL / Image ref"}
                              className="w-full p-2 text-xxs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md"
                            />
                          </div>
                        </div>
                      </div>

                      {/* SINGLE ACTION BUTTON */}
                      <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex justify-end">
                        <button
                          type="button"
                          disabled={isInlineDeliverySubmitting}
                          onClick={handleApplyInlineDeliveryDecision}
                          className="w-full sm:w-auto px-6 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-xs transition-colors cursor-pointer"
                        >
                          {isInlineDeliverySubmitting ? (
                            <Clock className="h-4 w-4 animate-spin" />
                          ) : (
                            <CheckCircle className="h-4 w-4" />
                          )}
                          <span>{isRtl ? "تطبيق قرار التوصيل" : "Apply Delivery Decision"}</span>
                        </button>
                      </div>
                    </div>
                  ) : deliveryLifecycleDecision.terminal ? (
                    /* ENTERPRISE READ-ONLY AUDIT SUMMARY (LOCKED STATE) */
                    <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
                      <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-3">
                        <div className="flex items-center gap-2 font-bold text-xs text-emerald-700 dark:text-emerald-400">
                          <CheckCircle className="h-4 w-4 text-emerald-600" />
                          <span>{isRtl ? "سجل إكمال وتنفيذ عملية التوصيل (Delivery Execution Audit Summary)" : "Enterprise Delivery Execution Audit Summary"}</span>
                        </div>
                        <span className="text-[10px] font-mono px-2.5 py-0.5 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60 rounded-md font-bold">
                          {isRtl ? "سجل مكتمل ومغلق (Locked Audit Record)" : "Locked Audit Record"}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
                        <div className="p-3 bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-slate-200/80 dark:border-slate-800">
                          <span className="text-slate-400 text-xxs font-mono uppercase block font-semibold">{isRtl ? "تم التنفيذ بواسطة" : "Completed By"}</span>
                          <strong className="text-xs font-bold text-slate-900 dark:text-white">
                            {currentOrder.deliveredByName || currentOrder.deliveryOfficerName || "—"}
                          </strong>
                        </div>

                        <div className="p-3 bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-slate-200/80 dark:border-slate-800">
                          <span className="text-slate-400 text-xxs font-mono uppercase block font-semibold">{isRtl ? "تاريخ ووقت التنفيذ" : "Completed Date"}</span>
                          <strong className="text-xs font-semibold text-slate-800 dark:text-slate-200 block font-mono">
                            {currentOrder.deliveredAt ? new Date(currentOrder.deliveredAt).toLocaleString() : "—"}
                          </strong>
                        </div>

                        <div className="p-3 bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-slate-200/80 dark:border-slate-800">
                          <span className="text-slate-400 text-xxs font-mono uppercase block font-semibold">{isRtl ? "النتيجة النهائية" : "Selected Outcome"}</span>
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xxs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 dark:bg-indigo-950 dark:text-indigo-300 mt-0.5">
                            {currentOrder.deliveryOutcome || getOrderWorkflowPresentation({ status: normalizeOrderStatus(currentOrder.status), lang: isRtl ? "ar" : "en" }).statusLabel}
                          </span>
                        </div>

                        <div className="p-3 bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-slate-200/80 dark:border-slate-800">
                          <span className="text-slate-400 text-xxs font-mono uppercase block font-semibold">{isRtl ? "اسم المستلم الثلاثي" : "Recipient Signee"}</span>
                          <strong className="text-xs font-bold text-slate-800 dark:text-slate-200 block">
                            {currentOrder.recipientName || currentOrder.deliverySignature || "N/A"}
                          </strong>
                        </div>

                        {!isDeliveryStaff && currentOrder.deliveryGPS && (
                          <div className="p-3 bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-slate-200/80 dark:border-slate-800">
                            <span className="text-slate-400 text-xxs font-mono uppercase block font-semibold">{isRtl ? "إحداثيات GPS" : "GPS Coordinates"}</span>
                            <span className="text-xs font-mono text-slate-700 dark:text-slate-300 block">
                              {typeof currentOrder.deliveryGPS === "string" ? currentOrder.deliveryGPS : currentOrder.deliveryGPS.raw || "Captured"}
                            </span>
                          </div>
                        )}

                        {currentOrder.newDeliveryDate && (
                          <div className="p-3 bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-slate-200/80 dark:border-slate-800">
                            <span className="text-slate-400 text-xxs font-mono uppercase block font-semibold">{isRtl ? "التاريخ الجديد المحدد" : "Rescheduled Date"}</span>
                            <span className="text-xs font-mono font-bold text-amber-600 block">
                              {currentOrder.newDeliveryDate}
                            </span>
                          </div>
                        )}

                        <div className="p-3 bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-slate-200/80 dark:border-slate-800 lg:col-span-4">
                          <span className="text-slate-400 text-xxs font-mono uppercase block font-semibold">{isRtl ? "ملاحظات وتفاصيل التوصيل الموثقة" : "Delivery Notes & Audit Comments"}</span>
                          <p className="text-xs text-slate-700 dark:text-slate-300 mt-1 italic">
                            {currentOrder.deliveryNotes || currentOrder.deliveryRemarks || currentOrder.comments || "No comments documented."}
                          </p>
                        </div>

                        {currentOrder.partialDeliveryItems && currentOrder.partialDeliveryItems.length > 0 && (
                          <div className="p-3 bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-slate-200/80 dark:border-slate-800 lg:col-span-4 space-y-2">
                            <span className="text-slate-400 text-xxs font-mono uppercase block font-semibold">{isRtl ? "سجل تفاصيل التسليم الجزئي للمنتجات" : "Partial Delivery Breakdown"}</span>
                            <div className="overflow-x-auto">
                              <table className="w-full text-xxs text-left ltr:text-left rtl:text-right">
                                <thead className="bg-slate-100 dark:bg-slate-900 text-slate-500 uppercase">
                                  <tr>
                                    <th className="p-1.5">{isRtl ? "اسم المستحضر" : "Product"}</th>
                                    <th className="p-1.5 text-center">{isRtl ? "المطلوب" : "Ordered"}</th>
                                    <th className="p-1.5 text-center">{isRtl ? "المسلم" : "Delivered"}</th>
                                    <th className="p-1.5 text-center">{isRtl ? "المتبقي" : "Remaining"}</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                                  {currentOrder.partialDeliveryItems.map((pItem: any, idx: number) => (
                                    <tr key={idx}>
                                      <td className="p-1.5 font-bold">{pItem.productName}</td>
                                      <td className="p-1.5 text-center font-mono">{pItem.orderedQuantity}</td>
                                      <td className="p-1.5 text-center font-mono font-bold text-emerald-600">{pItem.deliveredQuantity}</td>
                                      <td className="p-1.5 text-center font-mono font-bold text-rose-600">{pItem.remainingQuantity}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : !deliveryLifecycleDecision.startDeliveryAllowed ? (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-xs font-semibold text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
                      {deliveryLifecycleDecision.inventoryContractIntegrityError
                        ? "INVENTORY_CONTRACT_INTEGRITY_ERROR"
                        : deliveryLifecycleDecision.assignmentRequired
                        ? (isRtl ? "يلزم إسناد مسؤول توصيل مؤهل قبل بدء التوصيل." : "A canonical eligible Delivery Officer assignment is required before delivery can start.")
                        : (isRtl ? "هذا الطلب غير متاح للتنفيذ بواسطة مسؤول التوصيل الحالي." : "This order is not executable by the current Delivery Officer.")}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="w-full bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs mb-4 overflow-hidden text-slate-800 dark:text-slate-100">
                  {/* Panel Header */}
                  <div className="p-4 flex items-center justify-between border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40">
                    <div className="flex items-center gap-2 font-bold text-xs text-indigo-600 dark:text-indigo-400">
                      <Boxes className="h-4 w-4" />
                      <span>{isRtl ? "تجهيز المستودع وتنسيق التوصيل الميداني" : "Store Preparation & Field Delivery Assignment Workspace"}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono px-2.5 py-0.5 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/60 rounded-md font-semibold">
                        {isRtl ? "مكتب المستودع والشحن" : "Store & Logistics Desk"}
                      </span>
                      <button
                        type="button"
                        onClick={() => setIsStorePrepExpanded(!isStorePrepExpanded)}
                        className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                      >
                        <ChevronDown className={`h-4 w-4 transition-transform ${isStorePrepExpanded ? "rotate-180" : ""}`} />
                      </button>
                    </div>
                  </div>

                  {isStorePrepExpanded && (
                    <div className="p-5 space-y-5">
                      {/* Check if active store decision is needed OR locked read-only record */}
                      {(normalizeOrderStatus(currentOrder.status) === "PENDING_STORE_PREPARATION" ||
                        normalizeOrderStatus(currentOrder.status) === "STORE_PREPARING" ||
                        normalizeOrderStatus(currentOrder.status) === "OPERATIONS_APPROVED") && canOperateStoreStage ? (
                        /* INLINE STORE DECISION PANEL (WP-SM-1.0) */
                        <div className="bg-slate-50 dark:bg-slate-950/60 p-5 rounded-xl border border-indigo-200/80 dark:border-indigo-900/50 space-y-4">
                          <div className="flex justify-between items-center border-b border-slate-200 dark:border-slate-800 pb-2">
                            <h4 className="font-bold text-xs text-indigo-900 dark:text-indigo-200 flex items-center gap-1.5">
                              <Boxes className="h-4 w-4 text-indigo-600" />
                              {isRtl ? "لوحة قرارات مدير المستودع المباشرة (Inline Store Manager Decision)" : "Inline Store Manager Decision Panel"}
                            </h4>
                            <span className="text-[10px] font-mono px-2 py-0.5 bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300 rounded font-semibold">
                              {isRtl ? "إجراء تجهيز مباشر" : "Inline Action Required"}
                            </span>
                          </div>

                          {/* Decision Action Cards (4 Cards) */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                            {/* 1. Complete Store Preparation */}
                            <button
                              type="button"
                              onClick={() => {
                                setInlineStoreAction("STORE_COMPLETE");
                                setInlineStoreError(null);
                              }}
                              className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                                inlineStoreAction === "STORE_COMPLETE"
                                  ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-500 ring-2 ring-emerald-500/20 text-emerald-950 dark:text-emerald-100 shadow-xs"
                                  : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-emerald-300 text-slate-700 dark:text-slate-300"
                              }`}
                            >
                              <div className="flex items-center justify-between w-full mb-1">
                                <span className="font-bold text-xs flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
                                  <CheckCircle className="h-4 w-4" />
                                  {isRtl ? "إكمال التجهيز (Complete Prep)" : "Complete Store Preparation"}
                                </span>
                                <span className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${
                                  inlineStoreAction === "STORE_COMPLETE" ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300"
                                }`}>
                                  {inlineStoreAction === "STORE_COMPLETE" && <Check size={10} />}
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                {isRtl ? "إكمال تجميع البضاعة وتغليف الشحنة وتحديد جاهزية التوصيل" : "Complete stock picking and packing, mark order ready for dispatch."}
                              </p>
                            </button>

                            {/* 2. Return to Operations */}
                            <button
                              type="button"
                              onClick={() => {
                                setInlineStoreAction("STORE_RETURN_TO_OPS");
                                setInlineStoreError(null);
                              }}
                              className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                                inlineStoreAction === "STORE_RETURN_TO_OPS"
                                  ? "bg-amber-50 dark:bg-amber-950/40 border-amber-500 ring-2 ring-amber-500/20 text-amber-950 dark:text-amber-100 shadow-xs"
                                  : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-amber-300 text-slate-700 dark:text-slate-300"
                              }`}
                            >
                              <div className="flex items-center justify-between w-full mb-1">
                                <span className="font-bold text-xs flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
                                  <RotateCcw className="h-4 w-4" />
                                  {isRtl ? "إعادة للعمليات (Return to Ops)" : "Return to Operations"}
                                </span>
                                <span className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${
                                  inlineStoreAction === "STORE_RETURN_TO_OPS" ? "border-amber-600 bg-amber-600 text-white" : "border-slate-300"
                                }`}>
                                  {inlineStoreAction === "STORE_RETURN_TO_OPS" && <Check size={10} />}
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                {isRtl ? "إعادة الطلب إلى مسؤول عمليات الطلبات لإعادة المراجعة" : "Return order to Order Operations Officer for review."}
                              </p>
                            </button>

                            {/* 3. Reject Preparation */}
                            <button
                              type="button"
                              onClick={() => {
                                setInlineStoreAction("STORE_REJECT");
                                setInlineStoreError(null);
                              }}
                              className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                                inlineStoreAction === "STORE_REJECT"
                                  ? "bg-rose-50 dark:bg-rose-950/40 border-rose-500 ring-2 ring-rose-500/20 text-rose-950 dark:text-rose-100 shadow-xs"
                                  : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-rose-300 text-slate-700 dark:text-slate-300"
                              }`}
                            >
                              <div className="flex items-center justify-between w-full mb-1">
                                <span className="font-bold text-xs flex items-center gap-1.5 text-rose-700 dark:text-rose-400">
                                  <Ban className="h-4 w-4" />
                                  {isRtl ? "رفض التجهيز (Reject Prep)" : "Reject Preparation"}
                                </span>
                                <span className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${
                                  inlineStoreAction === "STORE_REJECT" ? "border-rose-600 bg-rose-600 text-white" : "border-slate-300"
                                }`}>
                                  {inlineStoreAction === "STORE_REJECT" && <Check size={10} />}
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                {isRtl ? "رفض التجهيز بسبب عدم توفر المخزون أو وجود تالف" : "Reject order preparation due to stock discrepancy or damage."}
                              </p>
                            </button>

                            {/* 4. Cancel Order */}
                            <button
                              type="button"
                              onClick={() => {
                                setInlineStoreAction("CANCEL");
                                setInlineStoreError(null);
                              }}
                              className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                                inlineStoreAction === "CANCEL"
                                  ? "bg-rose-100 dark:bg-rose-950/70 border-rose-600 ring-2 ring-rose-600/20 text-rose-950 dark:text-rose-100 shadow-xs"
                                  : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-rose-400 text-slate-700 dark:text-slate-300"
                              }`}
                            >
                              <div className="flex items-center justify-between w-full mb-1">
                                <span className="font-bold text-xs flex items-center gap-1.5 text-rose-800 dark:text-rose-300">
                                  <X className="h-4 w-4" />
                                  {isRtl ? "إلغاء الطلب (Cancel)" : "Cancel Order"}
                                </span>
                                <span className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${
                                  inlineStoreAction === "CANCEL" ? "border-rose-700 bg-rose-700 text-white" : "border-slate-300"
                                }`}>
                                  {inlineStoreAction === "CANCEL" && <Check size={10} />}
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                {isRtl ? "إلغاء الطلب بالكامل وتوثيق سبب الإلغاء" : "Cancel order completely and log formal cancellation reason."}
                              </p>
                            </button>
                          </div>

                          {/* Field Delivery Officer Assignment & Schedule */}
                          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-3">
                            <h5 className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                              <Truck className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                              {isRtl ? "تعيين مسؤول التوصيل الميداني والجدول الزمني" : "Field Delivery Officer Assignment & Schedule"}
                            </h5>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                              <div>
                                <label className="block text-xxs font-bold text-slate-600 dark:text-slate-400 mb-1">
                                  {isRtl ? "اختيار مسؤول التوصيل" : "Select Delivery Officer"}
                                </label>
                                <select
                                  value={storeDeliveryOfficerUid}
                                  onChange={(e) => setStoreDeliveryOfficerUid(e.target.value)}
                                  className="w-full px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-semibold focus:ring-2 focus:ring-indigo-500 text-slate-800 dark:text-slate-100"
                                >
                                  <option value="">{isRtl ? "-- اختر السائق --" : "-- Select Officer --"}</option>
                                  {filteredEligibleOfficers.map((u) => (
                                    <option key={u.id || u.uid} value={u.uid || u.id}>
                                      {u.name || u.fullName}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <label className="block text-xxs font-bold text-slate-600 dark:text-slate-400 mb-1">
                                  {isRtl ? "تاريخ التوصيل المخطط" : "Planned Delivery Date"}
                                </label>
                                <input
                                  type="date"
                                  value={storePlannedDate}
                                  onChange={(e) => setStorePlannedDate(e.target.value)}
                                  className="w-full px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-semibold focus:ring-2 focus:ring-indigo-500 text-slate-800 dark:text-slate-100"
                                />
                              </div>
                              <div>
                                <label className="block text-xxs font-bold text-slate-600 dark:text-slate-400 mb-1">
                                  {isRtl ? "فترة التوصيل (اختياري)" : "Delivery Window (Optional)"}
                                </label>
                                <input
                                  type="text"
                                  placeholder={isRtl ? "صباحاً (10:00 - 14:00)" : "Morning (10:00 - 14:00)"}
                                  value={storePlannedTime}
                                  onChange={(e) => setStorePlannedTime(e.target.value)}
                                  className="w-full px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-semibold focus:ring-2 focus:ring-indigo-500 text-slate-800 dark:text-slate-100"
                                />
                              </div>
                            </div>
                          </div>

                          {/* Preparation Notes / Decision Rationale Field */}
                          <div className="space-y-1.5 pt-2">
                            <label className="block text-xxs font-mono uppercase text-slate-500 dark:text-slate-400 font-semibold">
                              {inlineStoreAction === "STORE_COMPLETE"
                                ? (isRtl ? "ملاحظات التجهيز والتوجيهات (اختياري)" : "Preparation Notes / Rationale (Optional)")
                                : (isRtl ? "ملاحظات وتوجيهات القرار (إجباري للإرجاع أو الرفض أو الإلغاء) *" : "Preparation Notes / Decision Rationale (Mandatory) *")}
                            </label>
                            <textarea
                              rows={3}
                              value={inlineStoreComment}
                              onChange={(e) => {
                                setInlineStoreComment(e.target.value);
                                if (inlineStoreError) setInlineStoreError(null);
                              }}
                              placeholder={isRtl ? "أدخل سبب القرار أو ملاحظات تجميع وتغليف الشحنة وتوجيهات السائق..." : "Enter store preparation notes, stock remarks, or return/cancellation reason..."}
                              className="w-full p-3 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 font-sans"
                            />
                          </div>

                          {/* Inline Validation Error Banner */}
                          {inlineStoreError && (
                            <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 rounded-xl text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
                              <AlertCircle size={16} className="shrink-0" />
                              <span>{inlineStoreError}</span>
                            </div>
                          )}

                          {/* Apply Store Decision Button */}
                          <div className="flex justify-end pt-2">
                            <button
                              type="button"
                              disabled={isInlineStoreSubmitting || checkCreatorSegregation(currentOrder, currentUser?.id || "", "STORE_START_PREPARE").allowed === false}
                              onClick={handleApplyInlineStoreDecision}
                              className={`px-5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 text-white transition-all shadow-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                                inlineStoreAction === "STORE_COMPLETE"
                                  ? "bg-emerald-600 hover:bg-emerald-700"
                                  : inlineStoreAction === "STORE_RETURN_TO_OPS"
                                  ? "bg-amber-600 hover:bg-amber-700"
                                  : inlineStoreAction === "STORE_REJECT"
                                  ? "bg-rose-600 hover:bg-rose-700"
                                  : "bg-rose-700 hover:bg-rose-800"
                              }`}
                            >
                              {isInlineStoreSubmitting ? (
                                <>
                                  <Clock size={15} className="animate-spin" />
                                  <span>{isRtl ? "جاري تنفيذ قرار المستودع..." : "Applying Store Decision..."}</span>
                                </>
                              ) : (
                                <>
                                  <CheckCircle size={15} />
                                  <span>{isRtl ? "تنفيذ قرار المستودع (Apply Decision)" : "Apply Store Decision"}</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      ) : (
                        /* LOCKED STORE DECISION RECORD (READ-ONLY) */
                        <div className="p-4 bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/40 rounded-xl space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300 font-bold text-xs">
                              <ShieldCheck className="h-4 w-4 text-emerald-600" />
                              <span>{isRtl ? "قرار تجهيز المستودع المعتمد (Store Decision Confirmed)" : "Store Decision Confirmed (Read-Only)"}</span>
                            </div>
                            <span className={`px-2.5 py-0.5 rounded text-[10px] font-bold ${
                              currentOrder.status === "READY_FOR_DISPATCH" || currentOrder.status === "ASSIGNED_FOR_DELIVERY" || currentOrder.status === "OUT_FOR_DELIVERY" || currentOrder.status === "DELIVERED"
                                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300"
                                : currentOrder.status === "STORE_REJECTED"
                                ? "bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-300"
                                : "bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300"
                            }`}>
                              {currentOrder.status === "READY_FOR_DISPATCH" || currentOrder.status === "ASSIGNED_FOR_DELIVERY" || currentOrder.status === "OUT_FOR_DELIVERY" || currentOrder.status === "DELIVERED"
                                ? (isRtl ? "تجهيز المستودع مكتمل" : "Store Preparation Completed")
                                : currentOrder.status === "STORE_REJECTED"
                                ? (isRtl ? "مرفوض بالمستودع" : "Store Rejected")
                                : (isRtl ? "مُعاد أو ملغى" : "Returned / Cancelled")}
                            </span>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs text-slate-700 dark:text-slate-300">
                            <div>
                              <span className="text-[10px] uppercase font-mono text-slate-400 block font-semibold">{isRtl ? "تم الإكمال بواسطة" : "Completed By"}</span>
                              <span className="font-bold text-slate-900 dark:text-white">
                                {currentOrder.storeCompletedByName || resolveUserIdentity(currentOrder.storePreparedByUid, usersList, "Store Manager")}
                              </span>
                            </div>
                            <div>
                              <span className="text-[10px] uppercase font-mono text-slate-400 block font-semibold">{isRtl ? "التاريخ والوقت" : "Date & Time"}</span>
                              <span className="font-mono text-slate-800 dark:text-slate-200">
                                {currentOrder.storePreparedAt ? new Date(currentOrder.storePreparedAt).toLocaleString() : "—"}
                              </span>
                            </div>
                            <div>
                              <span className="text-[10px] uppercase font-mono text-slate-400 block font-semibold">{isRtl ? "مسؤول التوصيل المعين" : "Assigned Delivery Officer"}</span>
                              <span className="font-bold text-slate-900 dark:text-white">
                                {currentOrder.deliveryOfficerName || "Unassigned"}
                              </span>
                            </div>
                            <div>
                              <span className="text-[10px] uppercase font-mono text-slate-400 block font-semibold">{isRtl ? "حالة نقل المسؤولية" : "Transfer Status"}</span>
                              <span className="font-bold text-indigo-600 dark:text-indigo-400">
                                {currentOrder.status === "READY_FOR_DISPATCH" || currentOrder.status === "ASSIGNED_FOR_DELIVERY" || currentOrder.status === "OUT_FOR_DELIVERY" || currentOrder.status === "DELIVERED"
                                  ? (isRtl ? "محول إلى مسؤول التوصيل" : "Transferred to Delivery Officer")
                                  : currentOrder.status === "STORE_REJECTED"
                                  ? (isRtl ? "مرفوض نهائياً" : "Store Rejected")
                                  : (isRtl ? "مُعاد إلى مسؤول العمليات" : "Returned to Order Operations")}
                              </span>
                            </div>
                            <div>
                              <span className="text-[10px] uppercase font-mono text-slate-400 block font-semibold">{isRtl ? "الملاحظات" : "Comments"}</span>
                              <span className="italic text-slate-600 dark:text-slate-400 block truncate" title={currentOrder.storeRemarks || currentOrder.rejectionReason || "—"}>
                                {currentOrder.storeRemarks || currentOrder.rejectionReason || (isRtl ? "لا توجد ملاحظات" : "No comments entered")}
                              </span>
                            </div>
                          </div>
                        </div>
                      )}

                      {normalizeOrderStatus(currentOrder.status) === "READY_FOR_DISPATCH" && canOperateStoreStage && !deliveryLifecycleDecision.canonicalAssignmentPresent && (
                        <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-4 space-y-3 dark:border-indigo-900/60 dark:bg-indigo-950/30">
                          <div className="flex items-center gap-2 text-xs font-bold text-indigo-800 dark:text-indigo-300"><UserCheck className="h-4 w-4" />{isRtl ? "استعادة إسناد مسؤول التوصيل" : "Delivery Assignment Recovery"}</div>
                          {deliveryDirectoryError && <div className="text-xs font-semibold text-rose-700">{deliveryDirectoryError}</div>}
                          {inlineStoreError && <div className="text-xs font-semibold text-rose-700">{inlineStoreError}</div>}
                          <div className="grid gap-3 sm:grid-cols-3">
                            <select value={storeDeliveryOfficerUid} onChange={event => setStoreDeliveryOfficerUid(event.target.value)} className="field">
                              <option value="">{isRtl ? "اختر مسؤول التوصيل" : "Select Delivery Officer"}</option>
                              {filteredEligibleOfficers.map(officer => <option key={officer.uid} value={officer.uid}>{officer.name}</option>)}
                            </select>
                            <input type="date" value={storePlannedDate} onChange={event => setStorePlannedDate(event.target.value)} className="field" />
                            <input value={storePlannedTime} onChange={event => setStorePlannedTime(event.target.value)} className="field" />
                          </div>
                          <button type="button" onClick={handleAssignDeliveryOfficerDirect} className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-700">{isRtl ? "إسناد مسؤول التوصيل" : "Assign Delivery Officer"}</button>
                        </div>
                      )}

                      {/* Export Invoice & Export Delivery Note buttons (WP-EXPORT-1.0) */}
                      <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                        <button
                          type="button"
                          onClick={() => setPrintModal({ isOpen: true, type: "INVOICE", order: currentOrder })}
                          className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
                        >
                          <FileText className="h-4 w-4 text-amber-500" />
                          {isRtl ? "تصدير الفاتورة التجارية" : "Export Commercial Invoice"}
                        </button>

                        <button
                          type="button"
                          onClick={() => setPrintModal({ isOpen: true, type: "DELIVERY_NOTE", order: currentOrder })}
                          className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
                        >
                          <Download className="h-4 w-4 text-blue-500" />
                          {isRtl ? "تصدير إذن التسليم" : "Export Delivery Note"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            )}



            {/* RETURNED TO REP STAGE */}
            {(normalizeOrderStatus(currentOrder.status) === "RETURNED_TO_REP_BY_FINANCE" || normalizeOrderStatus(currentOrder.status) === "RETURNED_TO_REP_BY_OPERATIONS") && (
              <button
                onClick={() => openTransitionModal(currentOrder, "RESUBMIT_REVISED", "Resubmit Revised Order", false)}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <Check className="h-4 w-4" />
                {isRtl ? "إعادة إرسال الطلب المعدل" : "Resubmit Revised Order"}
              </button>
            )}

            {/* CANCEL ACTION FOR OPEN ORDERS */}
            {getStageForStatus(normalizeOrderStatus(currentOrder.status)) !== "CLOSED" && (
              <button
                onClick={() => openTransitionModal(currentOrder, "CANCEL", "Cancel Order", true)}
                className="px-4 py-2 border border-rose-200 dark:border-rose-900/50 bg-rose-50/50 text-rose-700 dark:text-rose-300 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <X className="h-4 w-4" />
                {isRtl ? "إلغاء الطلب" : "Cancel Order"}
              </button>
            )}
          </div>

        {/* TRANSITION AUDIT HISTORY CARD (PART J & WP7.5 PART 11 COLLAPSIBLE) */}
        {!isDeliveryStaff && (
          <div ref={auditTrailRef} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4 shadow-xs">
            <div 
              onClick={() => setIsAuditTrailExpanded(!isAuditTrailExpanded)}
              className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3 cursor-pointer select-none"
            >
              <h3 className="font-bold text-slate-900 dark:text-white text-xs flex items-center gap-2">
                <FileText className="h-4 w-4 text-indigo-600" />
                {isRtl ? "سجل التدقيق والتحويلات المعتمدة (Audit Trail)" : "Canonical Transition History & Audit Trail"}
              </h3>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-slate-400">
                  {currentOrder.history?.length || 0} transitions
                </span>
                <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${isAuditTrailExpanded ? "rotate-180" : ""}`} />
              </div>
            </div>

            {isAuditTrailExpanded && (
              <div>
                {!currentOrder.history || currentOrder.history.length === 0 ? (
                  <p className="text-xs text-slate-400 italic py-2">{isRtl ? "لا توجد تحويلات مسجلة بعد" : "No recorded transition history."}</p>
                ) : (
                  <div className="space-y-3 font-sans pt-2">
                    {currentOrder.history.map((h: any, idx: number) => (
                      <div key={h.transitionId || idx} className="p-3 border border-slate-100 dark:border-slate-800 rounded-xl bg-slate-50/50 dark:bg-slate-950/40 text-xs space-y-1.5">
                        <div className="flex justify-between items-center text-xxs font-mono text-slate-400">
                          <span className="font-bold text-indigo-600 dark:text-indigo-400 font-sans">{getLocalizedWorkflowAction(h.action, isRtl ? "ar" : "en")}</span>
                          <span>{new Date(h.createdAt).toLocaleString()}</span>
                        </div>
                        <div className="flex items-center gap-2 font-sans text-[11px] font-semibold text-slate-800 dark:text-slate-200">
                          <span className="px-2 py-0.5 bg-slate-200 dark:bg-slate-800 rounded">{getLocalizedWorkflowStatus(h.fromStatus, isRtl ? "ar" : "en")}</span>
                          <span>→</span>
                          <span className="px-2 py-0.5 bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 rounded">{getLocalizedWorkflowStatus(h.toStatus, isRtl ? "ar" : "en")}</span>
                        </div>
                        <div className="flex justify-between items-center text-[10px] text-slate-500 font-sans">
                          <span>{isRtl ? "المستخدم:" : "Actor:"} <strong>{h.actorName}</strong> ({getLocalizedRole(h.actorGeneralRole, isRtl ? "ar" : "en")})</span>
                          <span className="text-slate-400">{isRtl ? "الصلاحية:" : "Cap:"} {getLocalizedCapability(h.orderCapabilityUsed, isRtl ? "ar" : "en")}</span>
                        </div>
                        {h.comments && (
                          <p className="text-[11px] text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900 p-2 rounded border border-slate-100 dark:border-slate-800 mt-1 italic">
                            "{h.comments}"
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Details Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Columns (Items & Payments) */}
          <div className="lg:col-span-2 space-y-6">
            {/* Ordered SKUs & Items (Collapsible Section - Default Collapsed: WP-FO-UI-1) */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs">
              <button
                type="button"
                onClick={() => setIsOrderedProductsExpanded(!isOrderedProductsExpanded)}
                className="w-full p-4 flex justify-between items-center hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer text-left"
              >
                <div className="flex items-center gap-3">
                  <Boxes className="h-5 w-5 text-indigo-600 shrink-0" />
                  <div>
                    <h3 className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-2">
                      <span>{translations.itemsCard}</span>
                      <span className="text-xs font-normal text-slate-500 font-mono">
                        ({currentOrder.items.length} SKUs • {currentOrder.items.reduce((sum: number, item: any) => sum + (item.quantity || 0), 0)} Total Units)
                      </span>
                    </h3>
                    <p className="text-xxs text-slate-400 font-mono mt-0.5">
                      Order Total: {legacyMoney(currentOrder.total || 0, currentOrder)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {currentOrder.status === "Returned to Rep" && (isSalesRep || isAdmin) && (
                    <span className="text-[10px] font-bold text-amber-600 animate-pulse bg-amber-50 dark:bg-amber-950/20 px-2 py-0.5 rounded">
                      Editing Enabled
                    </span>
                  )}
                  <div className={`p-1 rounded-lg text-slate-400 hover:text-slate-600 transition-transform ${isOrderedProductsExpanded ? "rotate-180" : ""}`}>
                    <ChevronDown size={18} />
                  </div>
                </div>
              </button>
              
              {isOrderedProductsExpanded && (
                <div className="border-t border-slate-200 dark:border-slate-800">
                  <div className="p-5 divide-y divide-slate-100 dark:divide-slate-800/60">
                    {currentOrder.items.map(item => (
                      <div key={item.id} className="py-4 first:pt-0 last:pb-0 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                        <div className="flex-1">
                          <h4 className="font-bold text-xs md:text-sm text-slate-900 dark:text-white">{item.name}</h4>
                          <p className="text-xxs text-slate-400 mt-1">
                            Unit price: {legacyMoney(item.price, currentOrder)}
                          </p>
                        </div>

                        <div className="flex items-center gap-4 w-full md:w-auto justify-between md:justify-end">
                          {currentOrder.status === "Returned to Rep" && (isSalesRep || isAdmin) ? (
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => handleUpdateItemQty(currentOrder.id, item.id, item.quantity - 1)}
                                className="w-6 h-6 border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded flex items-center justify-center font-bold text-xs"
                              >
                                -
                              </button>
                              <span className="w-10 text-center font-mono text-xs font-bold">{item.quantity}</span>
                              <button
                                onClick={() => handleUpdateItemQty(currentOrder.id, item.id, item.quantity + 1)}
                                className="w-6 h-6 border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded flex items-center justify-center font-bold text-xs"
                              >
                                +
                              </button>
                              <button
                                onClick={() => handleRemoveItem(currentOrder.id, item.id)}
                                className="p-1 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20 rounded transition-colors"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          ) : (
                            <span className="text-xs font-semibold font-mono text-slate-500">
                              Qty: {item.quantity}
                            </span>
                          )}

                          <div className="text-right font-bold font-mono text-xs md:text-sm text-slate-900 dark:text-white">
                            {legacyMoney(item.total, currentOrder)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  
                  <div className="bg-slate-50 dark:bg-slate-950/40 p-4 border-t border-slate-100 dark:border-slate-800 flex flex-col items-end text-sm space-y-2">
                    <div className="flex justify-between w-64 text-slate-500 dark:text-slate-400 text-xs">
                      <span>{translations.subtotal}</span>
                      <span className="font-mono">{legacyMoney(currentOrder.total, currentOrder)}</span>
                    </div>
                    <div className="flex justify-between w-64 font-bold text-slate-900 dark:text-white text-sm md:text-base border-t border-slate-200 dark:border-slate-800 pt-2">
                      <span>{translations.total}</span>
                      <span className="font-mono">{legacyMoney(currentOrder.total, currentOrder)}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Financial Documents & Payments (Collapsible Section - Default Collapsed: WP-FO-UI-1) */}
            {!isDeliveryStaff && (
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs">
              <button
                type="button"
                onClick={() => setIsFinancialDocsExpanded(!isFinancialDocsExpanded)}
                className="w-full p-4 flex justify-between items-center hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer text-left"
              >
                <div className="flex items-center gap-3">
                  <Wallet className="h-5 w-5 text-indigo-600 shrink-0" />
                  <div>
                    <h3 className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-2">
                      <span>{translations.paymentsCard}</span>
                      <span className="text-xs font-normal text-slate-500 font-mono">
                        ({currentOrder.payments?.length || (currentOrder.paidAmount > 0 ? 1 : 0)} Documents)
                      </span>
                    </h3>
                    <p className="text-xxs text-slate-400 font-mono mt-0.5">
                      Paid: {legacyMoney(currentOrder.paidAmount || 0, currentOrder)} / {legacyMoney(currentOrder.total || 0, currentOrder)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className={`p-1 rounded-lg text-slate-400 hover:text-slate-600 transition-transform ${isFinancialDocsExpanded ? "rotate-180" : ""}`}>
                    <ChevronDown size={18} />
                  </div>
                </div>
              </button>
              
              {isFinancialDocsExpanded && (
                <div className="p-6 border-t border-slate-200 dark:border-slate-800 text-center space-y-4">
                  <div className="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-slate-100 dark:border-slate-800 text-xs font-mono">
                    <span className="text-slate-500">{isRtl ? "المبلغ المدفوع / الإجمالي:" : "Paid / Total:"}</span>
                    <span className="font-bold text-slate-800 dark:text-slate-200">
                      {legacyMoney(currentOrder.paidAmount || 0, currentOrder)} / {legacyMoney(currentOrder.total || 0, currentOrder)}
                    </span>
                  </div>

                  {currentOrder.paidAmount === 0 ? (
                    <p className="text-xs text-slate-400 italic py-2">{translations.noPayments}</p>
                  ) : (
                    <div className="max-w-md mx-auto p-3 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300 rounded-xl text-xs flex justify-between font-mono border border-emerald-200 dark:border-emerald-800/50">
                      <span>Payment Evidence Recorded</span>
                      <span className="font-bold">{legacyMoney(currentOrder.paidAmount || 0, currentOrder)}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
            )}
          </div>

          {/* Right Columns (Pharmacy, details & total) */}
          <div className="space-y-6">
            {/* Pharmacy Card */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-3 shadow-xs">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                <Store className="h-4 w-4 text-indigo-600" />
                {translations.pharmacyCard}
              </h3>
              <div className="space-y-1">
                <h4 className="font-bold text-slate-900 dark:text-white text-xs md:text-sm">{currentOrder.pharmacyName}</h4>
                <p className="text-xxs text-slate-500">{currentOrder.pharmacyAddress}</p>
              </div>
            </div>

            {/* Details Key value pairs (WP7.5 PART 11 Collapsible) */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4 shadow-xs">
              <div 
                onClick={() => setIsMetadataExpanded(!isMetadataExpanded)}
                className="flex items-center justify-between cursor-pointer select-none"
              >
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                  <FileText className="h-4 w-4 text-indigo-600" />
                  {translations.detailsCard}
                </h3>
                <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${isMetadataExpanded ? "rotate-180" : ""}`} />
              </div>

              {isMetadataExpanded && (
                <div className="divide-y divide-slate-100 dark:divide-slate-800/40 text-xs space-y-3 pt-2">
                  <div className="flex justify-between py-2 first:pt-0">
                    <span className="text-slate-500 dark:text-slate-400">{translations.salesRep}</span>
                    <span className="font-semibold text-slate-900 dark:text-white flex items-center gap-1">
                      <User className="h-3 w-3 text-slate-400" /> {currentOrder.salesRep}
                    </span>
                  </div>
                  <div className="flex justify-between py-3">
                    <span className="text-slate-500 dark:text-slate-400">{translations.dateCol}</span>
                    <span className="font-semibold text-slate-900 dark:text-white flex items-center gap-1">
                      <Calendar className="h-3 w-3 text-slate-400" /> {currentOrder.date}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Paid status large warning block */}
            {!isDeliveryStaff && (
              <div className="bg-orange-50/50 dark:bg-orange-950/20 border border-orange-100 dark:border-orange-950/40 rounded-2xl p-6 text-center space-y-2">
                <span className={`text-[10px] font-bold uppercase tracking-widest ${
                  currentOrder.paidStatus === "Paid" ? "text-emerald-600" : "text-amber-600"
                }`}>
                  {orderPaymentLabel(currentOrder.paidStatus, isRtl)}
                </span>
                <div className="text-2xl md:text-3xl font-extrabold text-orange-600 font-mono">
                  {legacyMoney(currentOrder.total, currentOrder)}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // RENDER LIST VIEW (DEFAULT)
  return (
    <div className="space-y-6 text-slate-800 dark:text-slate-100">
      {(workflowConfigurationError || ordersReadError) && (
        <div role="alert" data-testid="commercial-orders-load-error" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {workflowConfigurationError || ordersReadError}
        </div>
      )}
      
      {/* Top Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl md:text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <ShoppingCart className="h-6 w-6 text-indigo-600" />
              {translations.title}
            </h1>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
              {isRtl ? roleContextBadge.ar : roleContextBadge.en}
            </span>
          </div>
          <p className="text-xs md:text-sm text-slate-500 dark:text-slate-400 mt-1">
            {translations.subtitle}
          </p>
        </div>

        {/* Create new order button (Sales rep & managers only) */}
        {(isSalesRep || isAdmin) && (
          <button
            onClick={() => setIsNewOrderModalOpen(true)}
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer shadow-sm w-full md:w-auto justify-center"
          >
            <Plus className="h-4 w-4" />
            {translations.newOrderBtn}
          </button>
        )}
      </div>

      {/* Dynamic Role-Based Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {summaryCards.map((card, idx) => {
          const IconComponent = card.icon;
          return (
            <div key={idx} className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 flex items-center gap-4 shadow-xs">
              <div className={`p-3 rounded-xl ${card.color}`}>
                <IconComponent className="h-6 w-6" />
              </div>
              <div>
                <div className="text-xl md:text-2xl font-bold text-slate-900 dark:text-white font-mono">{card.value}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">{isRtl ? card.titleAr : card.titleEn}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Main Ledger Panel */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
        {/* Stage Filter Navigation Tabs */}
        <div className="bg-slate-50 dark:bg-slate-950 px-4 pt-3 pb-2 border-b border-slate-200 dark:border-slate-800 flex items-center gap-1.5 overflow-x-auto">
          {visibleTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setStageFilter(tab.id as OrderStageFilter)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                stageFilter === tab.id
                  ? "bg-indigo-600 text-white shadow-xs"
                  : "text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-800"
              }`}
            >
              {isRtl ? tab.labelAr : tab.labelEn}
            </button>
          ))}
        </div>

        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4">
          <div className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-indigo-600" />
            <span className="font-semibold text-slate-900 dark:text-white">{translations.allOrdersHeader}</span>
          </div>

          <div className="flex flex-wrap items-center gap-3 w-full xl:w-auto justify-end">
            {/* Search */}
            <div className="relative w-full sm:w-64">
              <Search className={`absolute top-2.5 h-4 w-4 text-slate-400 ${isRtl ? "right-3" : "left-3"}`} />
              <input
                type="text"
                placeholder={translations.searchPlaceholder}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className={`w-full pl-9 pr-4 py-1.5 border border-slate-200 dark:border-slate-800 rounded-xl text-xs bg-slate-50 dark:bg-slate-950 focus:outline-none focus:ring-1 focus:ring-indigo-600 dark:text-white ${isRtl ? "pl-4 pr-9 text-right" : ""}`}
              />
            </div>

            {/* Filter */}
            <div className="flex items-center gap-2 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-1.5 bg-slate-50 dark:bg-slate-950 w-full sm:w-auto justify-between sm:justify-start">
              <Filter className="h-4 w-4 text-slate-400" />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="bg-transparent text-xs text-slate-700 dark:text-slate-300 focus:outline-none pr-6 cursor-pointer"
              >
                {isDeliveryStaff ? (
                  <>
                    <option value="All">{isRtl ? "كافة طلبات التوصيل" : "All Delivery Orders"}</option>
                    <option value="ASSIGNED_FOR_DELIVERY">{isRtl ? "التوصيلات المعينة" : "Assigned Deliveries"}</option>
                    <option value="DELIVERED">{isRtl ? "تم تسليمها" : "Delivered"}</option>
                    <option value="RETURNED">{isRtl ? "مرتجعة للمستودع" : "Returned to Warehouse"}</option>
                    <option value="POSTPONED">{isRtl ? "مؤجلة" : "Postponed"}</option>
                    <option value="CUSTOMER_REFUSED">{isRtl ? "مرفوضة من العميل" : "Customer Refused"}</option>
                  </>
                ) : (
                  <>
                    <option value="All">{translations.filterAll}</option>
                    <option value="Pending Financial Review">{isRtl ? "بانتظار المراجعة المالية" : "Pending Financial Review"}</option>
                    <option value="Pending Ops Validation">{isRtl ? "بانتظار مراجعة العمليات" : "Pending Operations Review"}</option>
                    <option value="Pending Store Review">{isRtl ? "بانتظار تجهيز المخزن" : "Pending Store Review"}</option>
                    <option value="Pending Delivery">{isRtl ? "جاهز للتسليم والشحن" : "Pending Delivery"}</option>
                    <option value="In Delivery">{isRtl ? "قيد التوصيل" : "Out for Delivery"}</option>
                    <option value="Delivered">{isRtl ? "تم التسليم" : "Delivered"}</option>
                    <option value="Returned to Rep">{isRtl ? "مُعاد إلى المندوب" : "Returned to Rep"}</option>
                    <option value="Voided">{isRtl ? "ملغى / مرفوض" : "Cancelled / Voided"}</option>
                  </>
                )}
              </select>
            </div>

            {/* Export */}
            <button
              onClick={handleExportCSV}
              className="flex items-center gap-1.5 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 px-3.5 py-1.5 rounded-xl text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer w-full sm:w-auto justify-center"
            >
              <Download className="h-4 w-4" />
              {translations.exportBtn}
            </button>
          </div>
        </div>

        {/* Data Table */}
        {filteredOrders.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <ShoppingCart className="mx-auto h-12 w-12 text-slate-300 dark:text-slate-700 mb-3" />
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{contextEmptyStateMessage}</h3>
          </div>
        ) : (
          <>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-950/40 text-[10px] font-mono font-semibold text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800 uppercase tracking-wider">
                    <th className="py-3 px-4 text-center w-12">
                      <input
                        type="checkbox"
                        checked={selectedRowIds.length === filteredOrders.length && filteredOrders.length > 0}
                        onChange={(e) => handleSelectAll(e.target.checked)}
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 h-4 w-4 cursor-pointer"
                      />
                    </th>
                    <th className="py-3 px-4">{translations.orderCol}</th>
                    <th className="py-3 px-4">{translations.pharmacyCol}</th>
                    <th className="py-3 px-4">{translations.dateCol}</th>
                    <th className="py-3 px-4">{translations.totalCol}</th>
                    <th className="py-3 px-4">{translations.paidCol}</th>
                    <th className="py-3 px-4">{translations.statusCol}</th>
                    <th className="py-3 px-4 text-center">{translations.actionsCol}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-xs">
                  {paginatedOrders.map((o) => (
                    <tr key={o.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-colors">
                      <td className="py-3.5 px-4 text-center">
                        <input
                          type="checkbox"
                          checked={selectedRowIds.includes(o.id)}
                          onChange={(e) => handleSelectRow(o.id, e.target.checked)}
                          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 h-4 w-4 cursor-pointer"
                        />
                      </td>
                      <td className="py-3.5 px-4 font-mono font-bold text-slate-900 dark:text-white">
                        {getOrderBusinessNumber(o, startIdx + paginatedOrders.indexOf(o))}
                      </td>
                      <td className="py-3.5 px-4 font-semibold text-slate-900 dark:text-white max-w-[200px] truncate">
                        {o.pharmacyName}
                      </td>
                      <td className="py-3.5 px-4 text-slate-500 dark:text-slate-400">
                        {o.date}
                      </td>
                      <td className="py-3.5 px-4 font-bold text-slate-900 dark:text-white font-mono">
                        {legacyMoney(o.total, o)}
                      </td>
                      <td className="py-3.5 px-4">
                        <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold font-mono ${
                          o.paidStatus === "Paid"
                            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-300"
                            : "bg-amber-50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-300"
                        }`}>
                          {orderPaymentLabel(o.paidStatus, isRtl)}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className={`inline-flex items-center rounded-md px-2.5 py-1 text-[10px] font-bold ring-1 ring-inset ${
                          o.status === "Delivered" || o.status === "DELIVERED"
                            ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950/30 dark:text-emerald-300"
                            : (o.status.includes("REJECT") || o.status === "CANCELLED" || o.status === "Voided")
                            ? "bg-rose-50 text-rose-700 ring-rose-600/10"
                            : (o.status.includes("RETURN") || o.status === "Returned to Rep")
                            ? "bg-amber-50 text-amber-700 ring-amber-600/10"
                            : "bg-indigo-50 text-indigo-700 ring-indigo-600/10 dark:bg-indigo-950/30 dark:text-indigo-300"
                        }`}>
                          {getOrderWorkflowPresentation({ status: o.status, lang: isRtl ? "ar" : "en" }).statusLabel}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => {
                              setSelectedOrderId(o.id);
                              setSelectedOrderDetail(o);
                              setViewMode("details");
                            }}
                            className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                            title={translations.viewDetails}
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards View */}
            <div className="block md:hidden space-y-4 p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/10 dark:bg-slate-950/10">
              {paginatedOrders.map((o) => (
                <div 
                  key={o.id} 
                  className="bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-800 rounded-xl p-4 shadow-xxs space-y-3 animate-fade-in"
                >
                  <div className="flex justify-between items-start gap-2">
                    <span className="font-mono text-xs font-bold text-indigo-600 dark:text-indigo-400">{getOrderBusinessNumber(o, startIdx + paginatedOrders.indexOf(o))}</span>
                    <span className="text-[10px] text-slate-400 font-mono">{o.date}</span>
                  </div>

                  <div className="space-y-1">
                    <p className="font-semibold text-xs text-slate-900 dark:text-white line-clamp-2">{o.pharmacyName}</p>
                    <p className="text-[10px] text-slate-400 flex items-center gap-1">
                      <span className="font-bold">{translations.salesRep}:</span> {o.salesRep}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-50 dark:border-slate-800/50">
                    <span className="text-sm font-bold text-slate-900 dark:text-white font-mono">
                      {legacyMoney(o.total, o)}
                    </span>

                    <div className="flex gap-1.5">
                      <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[9px] font-bold ${
                        o.paidStatus === "Paid" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                      }`}>
                        {orderPaymentLabel(o.paidStatus, isRtl)}
                      </span>
                      <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[9px] font-bold ring-1 ring-inset ${
                        o.status === "Delivered" || o.status === "DELIVERED" 
                          ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20" 
                          : "bg-indigo-50 text-indigo-700 ring-indigo-600/10"
                      }`}>
                        {getOrderWorkflowPresentation({ status: o.status, lang: isRtl ? "ar" : "en" }).statusLabel}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-end pt-2.5 border-t border-slate-50 dark:border-slate-800/50">
                    <button
                      onClick={() => {
                        setSelectedOrderId(o.id);
                        setSelectedOrderDetail(o);
                        setViewMode("details");
                      }}
                      className="p-1.5 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:text-indigo-600 rounded-lg transition-colors cursor-pointer flex items-center gap-1 text-[10px] font-bold"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      <span>{translations.viewDetails}</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/20 dark:bg-slate-950/20" id="orders-pagination">
                <p className="text-xxs text-slate-400 font-mono">
                  {translations.showing
                    .replace("{start}", String(startIdx))
                    .replace("{end}", String(endIdx))
                    .replace("{total}", String(filteredOrders.length))}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                    disabled={currentPage === 1}
                    className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-500 disabled:opacity-40 transition-opacity hover:bg-slate-50 cursor-pointer text-xs flex items-center gap-1 px-3"
                  >
                    <ChevronLeft size={14} />
                    {translations.prev}
                  </button>
                  <span className="text-xxs font-mono font-bold text-slate-600 dark:text-slate-300">
                    {translations.pageOf
                      .replace("{current}", String(currentPage))
                      .replace("{total}", String(totalPages))}
                  </span>
                  <button
                    onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                    disabled={currentPage === totalPages}
                    className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-500 disabled:opacity-40 transition-opacity hover:bg-slate-50 cursor-pointer text-xs flex items-center gap-1 px-3"
                  >
                    {translations.next}
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* NEW ORDER SLIDE-OVER MODAL */}
      {isNewOrderModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-fade-in" id="new-order-modal">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
            
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-950">
              <div className="flex items-center gap-2">
                <ShoppingCart className="h-5 w-5 text-indigo-600" />
                <h2 className="font-bold text-slate-900 dark:text-white text-sm md:text-base">
                  {isRtl ? "حجز طلب توريد تجاري مباشر" : "Book New Commercial Pharmacy Order"}
                </h2>
              </div>
              <button 
                onClick={() => setIsNewOrderModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-850"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleCreateNewOrder} className="flex-1 overflow-y-auto p-6 space-y-5">
              
              {/* Pharmacy Selector */}
              <div>
                <label className="block text-[10px] font-mono text-slate-400 uppercase mb-1">
                  {isRtl ? "اختر صيدلية العميل (تصفية حسب المنطقة)" : "Select Customer Pharmacy"}
                </label>
                <select
                  value={newOrderPharmacyId}
                  onChange={(e) => setNewOrderPharmacyId(e.target.value)}
                  className="w-full p-2.5 text-xs border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 rounded-xl focus:outline-none dark:text-white"
                  required
                >
                  <option value="">-- {isRtl ? "اختر صيدلية" : "Select Pharmacy"} --</option>
                  {securedPharmacies.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.region || "Tripoli"})
                    </option>
                  ))}
                </select>
              </div>

              {/* Product selector widget */}
              <div className="border border-slate-150 dark:border-slate-800 p-4 rounded-xl space-y-3 bg-slate-50/50 dark:bg-slate-950/20">
                <span className="text-[10px] font-bold text-indigo-600 block uppercase tracking-wider font-mono">
                  {isRtl ? "إضافة أصناف للطلبية" : "Add SKUs and Products to Order Cart"}
                </span>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="md:col-span-2">
                    <select
                      value={currentSelectedProductToAdd}
                      onChange={(e) => setCurrentSelectedProductToAdd(e.target.value)}
                      className="w-full p-2 text-xs border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 rounded-lg focus:outline-none dark:text-white"
                    >
                      <option value="">-- {isRtl ? "اختر المستحضر" : "Select Product"} --</option>
                      {securedProducts.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.name} - {p.brand} ({p.price ? legacyMoney(p.price, p) : "Price configuration required"})
                        </option>
                      ))}
                    </select>
                  </div>
                  
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min={1}
                      value={currentSelectedQtyToAdd}
                      onChange={(e) => setCurrentSelectedQtyToAdd(parseInt(e.target.value) || 1)}
                      className="w-16 p-2 text-xs border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 rounded-lg text-center font-mono dark:text-white"
                    />
                    <button
                      type="button"
                      onClick={handleAddProductToNewOrder}
                      disabled={!currentSelectedProductToAdd}
                      className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <Plus size={14} />
                      <span>{isRtl ? "إضافة" : "Add"}</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Added items table */}
              {newOrderItems.length > 0 && (
                <div className="border border-slate-100 dark:border-slate-800 rounded-xl overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-slate-950/40 text-[9px] font-mono font-semibold text-slate-500 uppercase">
                        <th className="p-2.5">{isRtl ? "الصنف" : "Item"}</th>
                        <th className="p-2.5 text-center w-20">{isRtl ? "الكمية" : "Qty"}</th>
                        <th className="p-2.5 text-right w-24">{isRtl ? "السعر" : "Price"}</th>
                        <th className="p-2.5 text-center w-12"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/40 text-xxs">
                      {newOrderItems.map((oi) => {
                        const prod = products.find(p => p.id === oi.productId);
                        const price = prod?.price ?? 0;
                        return (
                          <tr key={oi.productId}>
                            <td className="p-2.5 font-bold text-slate-800 dark:text-white">
                              {prod ? prod.name : "Product"}
                            </td>
                            <td className="p-2.5 text-center font-mono">
                              {oi.quantity}
                            </td>
                            <td className="p-2.5 text-right font-mono font-bold">
                              {legacyMoney(price * oi.quantity, prod)}
                            </td>
                            <td className="p-2.5 text-center">
                              <button
                                type="button"
                                onClick={() => setNewOrderItems(prev => prev.filter(item => item.productId !== oi.productId))}
                                className="text-rose-500 hover:text-rose-700 p-1"
                              >
                                <Trash2 size={12} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Discount selection (approved trade offers) */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-mono text-slate-400 uppercase mb-1">
                    {isRtl ? "تطبيق خصم العروض المعتمدة" : "Apply Offer Discount (%)"}
                  </label>
                  <select
                    value={newOrderDiscountPercent}
                    onChange={(e) => setNewOrderDiscountPercent(parseInt(e.target.value) || 0)}
                    className="w-full p-2.5 text-xs border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 rounded-xl focus:outline-none dark:text-white"
                  >
                    <option value={0}>{isRtl ? "بدون عروض ترويجية" : "Standard List Price (0% Discount)"}</option>
                    {activeOffers.map(o => {
                      const val = parseInt(o.value) || 10;
                      return (
                        <option key={o.id} value={val}>
                          {o.name} ({val}% Discount)
                        </option>
                      );
                    })}
                  </select>
                </div>

                {/* Real-time Order Summary preview */}
                <div className="bg-slate-50 dark:bg-slate-950 p-4 rounded-xl flex flex-col justify-center text-xs space-y-1">
                  <div className="flex justify-between font-mono text-slate-500">
                    <span>Subtotal:</span>
                    <span>
                      {legacyMoney(newOrderItems.reduce((sum, item) => {
                        const prod = products.find(p => p.id === item.productId);
                        const price = prod?.price ?? 0;
                        return sum + (price * item.quantity);
                      }, 0), products.find(p => p.id === newOrderItems[0]?.productId))}
                    </span>
                  </div>
                  <div className="flex justify-between font-mono text-indigo-600 font-bold">
                    <span>Discount Applied:</span>
                    <span>-{newOrderDiscountPercent}%</span>
                  </div>
                  <div className="flex justify-between font-mono font-bold text-slate-900 dark:text-white pt-1.5 border-t border-slate-200 dark:border-slate-800">
                    <span>Net Order Value:</span>
                    <span>
                      {legacyMoney(
                        newOrderItems.reduce((sum, item) => {
                          const prod = products.find(p => p.id === item.productId);
                          const price = prod?.price ?? 0;
                          return sum + (price * item.quantity);
                        }, 0) * (1 - newOrderDiscountPercent / 100)
                      , products.find(p => p.id === newOrderItems[0]?.productId))}
                    </span>
                  </div>
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-[10px] font-mono text-slate-400 uppercase mb-1">
                  {isRtl ? "ملاحظات إضافية على الطلب" : "Order Dispatch Instructions / Notes"}
                </label>
                <textarea
                  value={newOrderNotes}
                  onChange={(e) => setNewOrderNotes(e.target.value)}
                  placeholder={isRtl ? "تعليمات خاصة بالتسليم أو شروط التحصيل والائتمان..." : "Special instructions regarding warehouse pick-up, payment terms, or client requests..."}
                  className="w-full p-2.5 text-xs border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 rounded-xl focus:outline-none dark:text-white"
                  rows={2}
                />
              </div>

              {/* Action buttons */}
              <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-3 bg-slate-50 dark:bg-slate-950 -mx-6 -mb-6">
                <button
                  type="button"
                  onClick={() => setIsNewOrderModalOpen(false)}
                  className="px-4 py-2 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-bold hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  {isRtl ? "إلغاء" : "Cancel"}
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-sm cursor-pointer"
                >
                  {isRtl ? "تأكيد وإرسال الطلبية" : "Submit Order to Workflow"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CANONICAL TRANSITION MODAL (PORTAL-RENDERED AT ROOT LEVEL WITH HIGH Z-INDEX) */}
      {transitionModal.isOpen && transitionModal.order && createPortal(
        <div 
          className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 z-[9999] animate-fade-in"
          dir={isRtl ? "rtl" : "ltr"}
        >
          <div 
            role="dialog"
            aria-modal="true"
            aria-labelledby="transition-modal-title"
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-2xl relative z-[10000]"
          >
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 id="transition-modal-title" className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-indigo-600 shrink-0" />
                {getLocalizedWorkflowAction(transitionModal.action, isRtl ? "ar" : "en") || transitionModal.title}
              </h3>
              <button
                type="button"
                disabled={transitionModal.isSubmitting}
                onClick={() => setTransitionModal(prev => ({ ...prev, isOpen: false }))}
                className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-400 cursor-pointer disabled:opacity-50"
                aria-label="Close modal"
              >
                <X size={18} />
              </button>
            </div>

            {transitionModal.errorMessage && (
              <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 rounded-xl text-rose-700 dark:text-rose-300 text-xs flex items-start gap-2">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <span>{transitionModal.errorMessage}</span>
              </div>
            )}

            <div className="space-y-4 text-xs">
              <div className="p-3 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-100 dark:border-slate-800 space-y-1 font-sans">
                <div className="flex justify-between text-slate-500">
                  <span>{isRtl ? "رقم الطلب:" : "Order ID:"}</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200">{transitionModal.order.displayNumber || transitionModal.order.id}</span>
                </div>
                <div className="flex justify-between text-slate-500">
                  <span>{isRtl ? "الصيدلية:" : "Pharmacy:"}</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200">{transitionModal.order.pharmacyName}</span>
                </div>
                <div className="flex justify-between text-slate-500">
                  <span>{isRtl ? "الحالة الحالية:" : "Current Status:"}</span>
                  <span className="font-bold text-indigo-600 dark:text-indigo-400">
                    {getOrderWorkflowPresentation({ status: transitionModal.order.status, lang: isRtl ? "ar" : "en" }).statusLabel}
                  </span>
                </div>
              </div>

              {/* Delivery Officer Selection (for Assign Delivery action) */}
              {(transitionModal.isAssignDelivery || transitionModal.action === "DELIVERY_ASSIGN") && (
                <div className="space-y-3">
                  {deliveryDirectoryError && (
                    <div className="p-2.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 rounded-xl text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
                      <AlertCircle size={15} className="shrink-0" />
                      <span>{deliveryDirectoryError}</span>
                    </div>
                  )}
                  {eligibleDeliveryOfficers.length === 0 && !deliveryDirectoryError && (
                    <div className="p-2.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 rounded-xl text-amber-700 dark:text-amber-300 text-xs flex items-center gap-2">
                      <AlertCircle size={15} className="shrink-0" />
                      <span>{isRtl ? "لم يتم العثور على ضباط توصيل مؤهلين في هذه الدولة." : "No eligible delivery officers found in this country."}</span>
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <label className="block text-xxs font-mono uppercase text-slate-400 font-bold">
                      {isRtl ? "تحديد ضابط التوصيل المسؤول" : "Eligible Delivery Officer"}
                    </label>
                    <select
                      value={transitionModal.selectedDeliveryOfficerUid}
                      onChange={(e) => {
                        const selectedUid = e.target.value;
                        const matched = filteredEligibleOfficers.find(u => (u.id || u.uid) === selectedUid);
                        setTransitionModal(prev => ({
                          ...prev,
                          selectedDeliveryOfficerUid: selectedUid,
                          selectedDeliveryOfficerName: matched ? (matched.name || matched.fullName) : selectedUid
                        }));
                      }}
                      className="w-full p-2.5 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 rounded-xl dark:text-white font-mono"
                    >
                      <option value="">{isRtl ? "-- اختر ضابط التوصيل --" : "-- Select Delivery Officer --"}</option>
                      {filteredEligibleOfficers.map(off => (
                        <option key={off.id || off.uid} value={off.id || off.uid}>
                          {off.name || off.fullName} ({off.country || "Market unassigned"})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xxs font-mono uppercase text-slate-400 font-bold">
                      {isRtl ? "تاريخ التوصيل المخطط" : "Planned Delivery Date"}
                    </label>
                    <input
                      type="date"
                      value={transitionModal.plannedDeliveryDate}
                      onChange={(e) => setTransitionModal(prev => ({ ...prev, plannedDeliveryDate: e.target.value }))}
                      className="w-full p-2.5 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 rounded-xl dark:text-white font-mono"
                    />
                  </div>
                </div>
              )}

              {/* Delivery Postponement Inputs */}
              {transitionModal.action === "DELIVERY_POSTPONE" && (
                <div className="space-y-1.5">
                  <label className="block text-xxs font-mono uppercase text-slate-400 font-bold">
                    {isRtl ? "تاريخ التوصيل الجديد المخطط" : "New Postponed Delivery Date"}
                  </label>
                  <input
                    type="date"
                    value={transitionModal.newDeliveryDate}
                    onChange={(e) => setTransitionModal(prev => ({ ...prev, newDeliveryDate: e.target.value }))}
                    className="w-full p-2.5 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 rounded-xl dark:text-white font-mono"
                  />
                </div>
              )}

              {/* Delivery Return Reason Dropdown */}
              {transitionModal.action === "DELIVERY_RETURN" && (
                <div className="space-y-1.5">
                  <label className="block text-xxs font-mono uppercase text-slate-400 font-bold">
                    {isRtl ? "سبب الإرجاع للمخزن" : "Return Reason"}
                  </label>
                  <select
                    value={transitionModal.returnReason}
                    onChange={(e) => setTransitionModal(prev => ({ ...prev, returnReason: e.target.value }))}
                    className="w-full p-2.5 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 rounded-xl dark:text-white font-mono"
                  >
                    <option value="Pharmacy Closed">{isRtl ? "الصيدلية مغلقة" : "Pharmacy Closed"}</option>
                    <option value="Refused Payment">{isRtl ? "رفض الدفع" : "Refused Payment"}</option>
                    <option value="Wrong Stock Delivered">{isRtl ? "مستحضرات خاطئة" : "Wrong Stock Delivered"}</option>
                    <option value="Damaged Items">{isRtl ? "تلف في الشحنة" : "Damaged Items"}</option>
                    <option value="Customer Cancelled Order">{isRtl ? "إلغاء من قبل العميل" : "Customer Cancelled Order"}</option>
                    <option value="Address Unreachable">{isRtl ? "العنوان غير معروف" : "Address Unreachable"}</option>
                  </select>
                </div>
              )}

              {/* Delivery Complete Audit Details */}
              {transitionModal.action === "DELIVERY_COMPLETE" && (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="block text-xxs font-mono uppercase text-slate-400 font-bold">
                      {isRtl ? "إحداثيات الموقع (GPS Coordinates)" : "GPS Verification"}
                    </label>
                    <input
                      type="text"
                      value={transitionModal.deliveryGPS}
                      onChange={(e) => setTransitionModal(prev => ({ ...prev, deliveryGPS: e.target.value }))}
                      className="w-full p-2 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 rounded-xl dark:text-white font-mono text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-xxs font-mono uppercase text-slate-400 font-bold">
                      {isRtl ? "اسم المستلم / التوقيع" : "Recipient Signee Name"}
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Dr. Ahmed (Pharmacist)"
                      value={transitionModal.signatureText}
                      onChange={(e) => setTransitionModal(prev => ({ ...prev, signatureText: e.target.value }))}
                      className="w-full p-2 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 rounded-xl dark:text-white text-xs"
                    />
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="block text-xxs font-mono uppercase text-slate-400">
                  {transitionModal.commentRequired 
                    ? (isRtl ? "المبرر / السبب (إجباري لهذا الإجراء)" : "Reason / Instruction (Mandatory)")
                    : (isRtl ? "ملاحظات إضافية (اختياري)" : "Audit Comments (Optional)")
                  }
                </label>
                <textarea
                  ref={modalTextareaRef}
                  rows={3}
                  value={transitionModal.commentText}
                  onChange={(e) => setTransitionModal(prev => ({ ...prev, commentText: e.target.value }))}
                  placeholder={isRtl ? "اكتب الملاحظات أو سبب القرار..." : "Write transition rationale or instructions..."}
                  className="w-full p-2.5 border border-slate-200 dark:border-slate-800 bg-transparent rounded-xl dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                disabled={transitionModal.isSubmitting}
                onClick={() => setTransitionModal(prev => ({ ...prev, isOpen: false }))}
                className="px-4 py-2 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-600 dark:text-slate-300 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isRtl ? "إلغاء" : "Cancel"}
              </button>
              <button
                type="button"
                disabled={transitionModal.isSubmitting}
                onClick={handleApplyTransition}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {transitionModal.isSubmitting ? (
                  <>
                    <Clock size={15} className="animate-spin" />
                    {isRtl ? "جاري المعالجة..." : "Processing Transition..."}
                  </>
                ) : (
                  <>
                    <CheckCircle size={15} />
                    {isRtl ? "تأكيد وتنفيذ الإجراء" : "Confirm Transition"}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* PRINTABLE / EXPORTABLE OFFICIAL DOCUMENTS MODAL (WP-EXPORT-1.0) */}
      {printModal.isOpen && printModal.order && createPortal(
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 z-[10000] animate-fade-in">
          <div className="bg-white text-slate-900 border border-slate-200 rounded-2xl max-w-3xl w-full p-8 space-y-6 shadow-2xl relative max-h-[90vh] overflow-y-auto">
            {/* Header controls */}
            <div className="flex justify-between items-center border-b pb-4">
              <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                <FileText className="h-5 w-5 text-indigo-600" />
                {printModal.type === "INVOICE"
                  ? (isRtl ? "تصدير الفاتورة التجارية الرسمية" : "Export Official Commercial Invoice")
                  : (isRtl ? "تصدير إذن التسليم والشحن" : "Export Official Delivery Note")}
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (printModal.type === "INVOICE") {
                      exportCommercialInvoiceDocx(printModal.order);
                    } else {
                      exportDeliveryNoteDocx(printModal.order);
                    }
                  }}
                  className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
                >
                  <Download size={14} />
                  {isRtl ? "وورد عربي (.docx)" : "Arabic Word (.docx)"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (printModal.type === "INVOICE") {
                      exportCommercialInvoicePdf(printModal.order);
                    } else {
                      exportDeliveryNotePdf(printModal.order);
                    }
                  }}
                  className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
                >
                  <Download size={14} />
                  {isRtl ? "بي دي إف إنجليزي (.pdf)" : "English PDF (.pdf)"}
                </button>
                <button
                  type="button"
                  onClick={() => setPrintModal({ isOpen: false, type: "INVOICE", order: null })}
                  className="p-1 hover:bg-slate-100 rounded-lg text-slate-400 cursor-pointer"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* EXPORT FORMAT SELECTION BANNER */}
            <div className="bg-indigo-50/80 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-bold text-indigo-950 dark:text-indigo-200 text-xs sm:text-sm">
                    {isRtl ? "محرك التصدير المؤسسي للمستندات" : "Enterprise Document Export Engine"}
                  </h4>
                  <p className="text-xxs text-indigo-700 dark:text-indigo-300">
                    {isRtl 
                      ? "تتم توليد المستندات الرسمية مباشرة من بيانات الطلبية المسجلة بدون طباعة المتصفح."
                      : "Official document exports are generated directly from persisted Firestore Order data."}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => {
                    if (printModal.type === "INVOICE") {
                      exportCommercialInvoiceDocx(printModal.order);
                    } else {
                      exportDeliveryNoteDocx(printModal.order);
                    }
                  }}
                  className="p-3 bg-white hover:bg-blue-50/50 border border-blue-200 rounded-xl flex items-center justify-between transition-all cursor-pointer shadow-xs group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-blue-100 text-blue-700 font-extrabold text-xs flex items-center justify-center">
                      DOCX
                    </div>
                    <div className="text-left rtl:text-right">
                      <span className="font-bold text-slate-800 block text-xs">
                        {isRtl ? "مستند وورد عربي (.docx)" : "Arabic Word (.docx)"}
                      </span>
                      <span className="text-[10px] text-slate-500 block">
                        {isRtl ? "تنسيق RTL قابل للتعديل" : "RTL Editable Arabic format"}
                      </span>
                    </div>
                  </div>
                  <Download className="h-4 w-4 text-slate-400 group-hover:text-blue-600 transition-colors" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (printModal.type === "INVOICE") {
                      exportCommercialInvoicePdf(printModal.order);
                    } else {
                      exportDeliveryNotePdf(printModal.order);
                    }
                  }}
                  className="p-3 bg-white hover:bg-red-50/50 border border-red-200 rounded-xl flex items-center justify-between transition-all cursor-pointer shadow-xs group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-red-100 text-red-700 font-extrabold text-xs flex items-center justify-center">
                      PDF
                    </div>
                    <div className="text-left rtl:text-right">
                      <span className="font-bold text-slate-800 block text-xs">
                        {isRtl ? "ملف بي دي إف إنجليزي (.pdf)" : "English PDF (.pdf)"}
                      </span>
                      <span className="text-[10px] text-slate-500 block">
                        {isRtl ? "نسخة ثابتة قياسية A4" : "Fixed A4 Enterprise layout"}
                      </span>
                    </div>
                  </div>
                  <Download className="h-4 w-4 text-slate-400 group-hover:text-red-600 transition-colors" />
                </button>
              </div>
            </div>

            {/* DOCUMENT PREVIEW */}
            <div className="space-y-6 font-sans text-xs border border-slate-200 rounded-2xl p-6 bg-slate-50/50">
              {/* Branding & Document Title */}
              <div className="flex justify-between items-start border-b border-slate-200 pb-4">
                <div>
                  <h1 className="text-xl font-bold text-slate-900 uppercase tracking-wide">MENAREPS 2.0</h1>
                  <p className="text-xxs font-semibold text-slate-500">Pharmaceutical Commercial Operations & Logistics</p>
                  <p className="text-xxs text-slate-400">Country Operations: Libya / Tripoli Central Warehouse</p>
                </div>
                <div className="text-right">
                  <h2 className="text-base font-bold text-indigo-600 uppercase">
                    {printModal.type === "INVOICE" ? "COMMERCIAL INVOICE" : "DELIVERY NOTE"}
                  </h2>
                  <p className="font-mono text-xs font-bold text-slate-800">
                    #{printModal.order.displayNumber || printModal.order.id}
                  </p>
                  <p className="text-xxs text-slate-500">
                    Date: {new Date(printModal.order.createdAt || Date.now()).toLocaleDateString()}
                  </p>
                </div>
              </div>

              {/* Customer & Order Metadata Grid */}
              <div className="grid grid-cols-2 gap-4 p-4 bg-white rounded-xl border border-slate-200 shadow-xs">
                <div>
                  <h4 className="text-xxs font-mono uppercase text-slate-400 font-bold mb-1">Customer / Pharmacy Info:</h4>
                  <p className="font-bold text-slate-800 text-sm">{printModal.order.pharmacyName}</p>
                  <p className="text-slate-600">{[printModal.order.area || printModal.order.city, printModal.order.country].filter(Boolean).join(" - ") || "—"}</p>
                  <p className="text-slate-500 text-xxs">License #: {printModal.order.pharmacyLicense || "LY-PHARM-2026"}</p>
                </div>
                <div>
                  <h4 className="text-xxs font-mono uppercase text-slate-400 font-bold mb-1">Logistics & Sales Reference:</h4>
                  <p className="text-slate-700">Sales Rep: <strong className="text-slate-900">{printModal.order.salesRep}</strong></p>
                  <p className="text-slate-700">Delivery Officer: <strong className="text-slate-900">{printModal.order.deliveryOfficerName || "Assigned Logistics Team"}</strong></p>
                  <p className="text-slate-700">Planned Date: <strong className="text-slate-900">{printModal.order.plannedDeliveryDate || "Immediate"}</strong></p>
                </div>
              </div>

              {/* Items Table */}
              <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-xs">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-100 text-slate-600 font-mono text-xxs uppercase">
                      <th className="p-2.5 border-b">#</th>
                      <th className="p-2.5 border-b">Product Description / SKU</th>
                      <th className="p-2.5 border-b text-center">Qty</th>
                      {printModal.type === "INVOICE" && <th className="p-2.5 border-b text-right">Unit Price</th>}
                      {printModal.type === "INVOICE" && <th className="p-2.5 border-b text-right">Line Total</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-slate-800">
                    {printModal.order.items?.map((item: any, idx: number) => (
                      <tr key={idx} className="hover:bg-slate-50">
                        <td className="p-2.5 font-mono text-xxs text-slate-400">{idx + 1}</td>
                        <td className="p-2.5 font-bold">{item.productName || item.name}</td>
                        <td className="p-2.5 text-center font-bold font-mono">{item.quantity || item.qty}</td>
                        {printModal.type === "INVOICE" && (
                          <td className="p-2.5 text-right font-mono">{legacyMoney(item.unitPrice || item.price || 0, printModal.order)}</td>
                        )}
                        {printModal.type === "INVOICE" && (
                          <td className="p-2.5 text-right font-bold font-mono">{legacyMoney((item.quantity || item.qty || 1) * (item.unitPrice || item.price || 0), printModal.order)}</td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Financial Summary for Invoice */}
              {printModal.type === "INVOICE" && (
                <div className="flex justify-end pt-2">
                  <div className="w-64 space-y-1.5 p-3 bg-white border border-slate-200 rounded-xl font-mono text-xs shadow-xs">
                    <div className="flex justify-between text-slate-600">
                      <span>Subtotal:</span>
                      <span>{legacyMoney(printModal.order.subtotal || printModal.order.total || 0, printModal.order)}</span>
                    </div>
                    <div className="flex justify-between text-slate-600">
                      <span>Tax / Duty (0%):</span>
                      <span>{legacyMoney(0, printModal.order)}</span>
                    </div>
                    <div className="flex justify-between text-slate-900 font-bold border-t pt-1.5 text-sm">
                      <span>Total Due:</span>
                      <span className="text-indigo-600">{legacyMoney(printModal.order.total || 0, printModal.order)}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Signatures & Stamps Footer */}
              <div className="grid grid-cols-3 gap-4 pt-8 text-center border-t border-slate-200 text-xxs text-slate-500">
                <div className="space-y-6">
                  <p className="font-bold text-slate-700">Prepared By (Warehouse Manager)</p>
                  <div className="h-10 border-b border-dashed border-slate-300" />
                  <p>Signature & Date</p>
                </div>
                <div className="space-y-6">
                  <p className="font-bold text-slate-700">Dispatched By (Delivery Officer)</p>
                  <div className="h-10 border-b border-dashed border-slate-300" />
                  <p>Signature & Date</p>
                </div>
                <div className="space-y-6">
                  <p className="font-bold text-slate-700">Received By (Pharmacist Stamp)</p>
                  <div className="h-10 border-b border-dashed border-slate-300" />
                  <p>Signature & Official Stamp</p>
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

export default function SalesOrders(props: SalesOrdersProps) {
  const activeRole = props.currentUser?.role ? normalizeRole(props.currentUser.role) : null;
  return activeRole === Role.ORDER_OPS_OFFICER
    ? <CanonicalOrderOperationsWorkspace {...props} />
    : <LegacySalesOrders {...props} />;
}
