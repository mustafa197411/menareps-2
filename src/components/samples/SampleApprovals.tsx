import React, { useState, useEffect } from "react";
import { Check, X, Search, Filter, AlertCircle, Clock, CheckCircle2, XCircle } from "lucide-react";
import { LegacySampleApproval as SampleApproval, SampleRequest, User, Physician, UserTerritoryAssignment, UserProductAssignment, Permissions } from "../../types";
import { initialProducts } from "../../data/mockData";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { applySecurityScope } from "../../lib/securityEngine";
import { canActOnSampleRecord, canApproveSampleRequest, getAuthorizedSampleUserIds, getSampleDataScope, hasSampleCapability } from "../../lib/sampleAuthorization";
import { decideAuthorizedSampleRequest } from "../../lib/sampleApprovalClient";
import { subscribeToScopedSampleCollection } from "../../lib/sampleScopeClient";

interface SampleApprovalsProps {
  currentUser: User;
  users: User[];
  physicians: Physician[];
  permissions?: Permissions;
  lang: "en" | "ar";
  profileLoaded?: boolean;
}

const mockApprovals: SampleApproval[] = [
  {
    id: "APR001",
    repId: "U02",
    repName: "Omar Al-Fares",
    productId: "PROD01",
    productName: "CardioMax 10mg",
    brand: "CardioMax",
    requestedQuantity: 50,
    originalAllocation: 100,
    reason: "Preparing for high-attendance clinical symposium next week.",
    status: "Pending",
    submittedDate: "2026-06-25"
  },
  {
    id: "APR002",
    repId: "U03",
    repName: "Lina Al-Hassan",
    productId: "PROD03",
    productName: "KidVits Chewable",
    brand: "KidVits",
    requestedQuantity: 100,
    originalAllocation: 150,
    reason: "New hospital accounts opened demanding immediate detailing kits.",
    status: "Pending",
    submittedDate: "2026-06-26"
  },
  {
    id: "APR003",
    repId: "U02",
    repName: "Omar Al-Fares",
    productId: "PROD04",
    productName: "OrthoFlex Gel",
    brand: "OrthoFlex",
    requestedQuantity: 30,
    originalAllocation: 50,
    reason: "Orthopedic clinic campaign running in West Amman.",
    status: "Approved",
    submittedDate: "2026-06-20",
    actionBy: "Dr. Supervisor",
    actionDate: "2026-06-21"
  },
  {
    id: "APR004",
    repId: "U05",
    repName: "Ahmad Al-Jamil",
    productId: "PROD02",
    productName: "CardioMax 20mg",
    brand: "CardioMax",
    requestedQuantity: 150,
    originalAllocation: 120,
    reason: "Requested double stock without giving details of physician clinic lists.",
    status: "Rejected",
    submittedDate: "2026-06-18",
    actionBy: "Dr. Supervisor",
    actionDate: "2026-06-19"
  }
];

export default function SampleApprovals({ currentUser, users, physicians, permissions, lang, profileLoaded }: SampleApprovalsProps) {
  const isRtl = lang === "ar";
  
  // Real-time Firestore state
  const [approvals, setApprovals] = useState<SampleApproval[]>([]);
  const [rawApprovals, setRawApprovals] = useState<SampleApproval[]>([]);
  const [canonicalRequests, setCanonicalRequests] = useState<SampleRequest[]>([]);
  const [userTerritoryAssignments, setUserTerritoryAssignments] = useState<UserTerritoryAssignment[]>([]);
  const [userProductAssignments, setUserProductAssignments] = useState<UserProductAssignment[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [statusFilter, setStatusFilter] = useState<"All" | "Pending" | "Approved" | "Rejected">("All");
  const [searchTerm, setSearchTerm] = useState("");
  const [decisionTarget, setDecisionTarget] = useState<{ id: string; action: "Approved" | "Rejected" } | null>(null);
  const [decisionQuantity, setDecisionQuantity] = useState("");
  const [decisionReason, setDecisionReason] = useState("");
  const [decisionError, setDecisionError] = useState("");

  useEffect(() => {
    if (!profileLoaded || !currentUser) return;
    setIsLoading(true);

    const scope = getSampleDataScope(currentUser, "VIEW_TEAM_SAMPLE_REQUESTS", permissions);
    const authorizedIds = getAuthorizedSampleUserIds(currentUser, users, scope);
    const unsubApprovals = subscribeToScopedSampleCollection(db, "sampleRequests", scope, authorizedIds, (docs) => {
      const items: SampleApproval[] = [];
      const requests: SampleRequest[] = [];
      docs.forEach((doc) => {
        const data = doc.data();
        if (!data.isDeleted) {
          const request = { id: doc.id, ...data } as SampleRequest;
          requests.push(request);
          items.push({
            id: request.id,
            repId: request.repId,
            repName: users.find(user => user.id === request.repId)?.name || request.repId,
            productId: request.productId,
            productName: data.sampleSkuName || data.productName || request.sampleSkuId,
            brand: data.brand || data.productName || request.productId,
            requestedQuantity: request.quantityRequested,
            // Legacy view field only; canonical approval quantity is stored on the request/approval records.
            originalAllocation: request.approvedQuantity || 0,
            reason: request.reason,
            status: request.status === "PENDING_APPROVAL" ? "Pending" : request.status === "REJECTED" ? "Rejected" : "Approved",
            submittedDate: request.createdAt?.slice(0, 10) || "—",
            actionBy: users.find(user => user.id === request.updatedBy)?.name || request.updatedBy,
            actionDate: request.updatedAt?.slice(0, 10)
          });
        }
      });
      setCanonicalRequests(requests);
      setRawApprovals(items);
    }, (err) => {
      console.error("Error listening to sampleApprovals:", err);
    });
    console.info("SAFE LISTENER STARTED: canonical sampleRequests approvals view");

    const unsubTerrAss = onSnapshot(collection(db, "userTerritoryAssignments"), (snap) => {
      const items: UserTerritoryAssignment[] = [];
      snap.forEach((doc) => {
        const data = doc.data();
        if (!data.isDeleted) {
          items.push({ id: doc.id, ...data } as unknown as UserTerritoryAssignment);
        }
      });
      setUserTerritoryAssignments(items);
    });

    const pq = query(
      collection(db, "userProductAssignments"),
      where("userId", "==", currentUser.id)
    );
    const unsubProdAss = onSnapshot(pq, (snap) => {
      const items: UserProductAssignment[] = [];
      snap.forEach((doc) => {
        const data = doc.data();
        if (!data.isDeleted) {
          items.push({ id: doc.id, ...data } as unknown as UserProductAssignment);
        }
      });
      setUserProductAssignments(items);
      setIsLoading(false);
    });

    return () => {
      unsubApprovals();
      unsubTerrAss();
      unsubProdAss();
    };
  }, [profileLoaded, currentUser, users, permissions]);

  // Filter with Security Scope
  useEffect(() => {
    const secured = applySecurityScope(currentUser, rawApprovals, userTerritoryAssignments, userProductAssignments);
    setApprovals(secured);
  }, [rawApprovals, userTerritoryAssignments, userProductAssignments, currentUser]);

  const t = {
    en: {
      title: "Sample Allocation Approvals",
      subtitle: "Review and manage medical representative requests for supplemental sample quotas",
      searchPlaceholder: "Search by representative or product...",
      statusAll: "All Statuses",
      statusPending: "Pending",
      statusApproved: "Approved",
      statusRejected: "Rejected",
      rep: "Representative",
      product: "Product",
      brand: "Brand",
      requestedQty: "Requested Qty",
      originalAlloc: "Approved Qty",
      reason: "Justification Reason",
      submittedDate: "Submitted",
      statusLabel: "Status",
      actions: "Actions",
      approve: "Approve",
      reject: "Reject",
      noData: "No pending or evaluated approval requests found.",
      successApprove: "Request approved and awaiting allocation.",
      successReject: "Request rejected.",
      confirmApprove: "Are you sure you want to APPROVE this extra sample allocation?",
      confirmReject: "Are you sure you want to REJECT this extra sample allocation?",
      pendingCount: "Pending Approvals",
      approvedCount: "Approved Requests",
      rejectedCount: "Rejected Requests",
      totalRequests: "Total Requests Analyzed"
    },
    ar: {
      title: "اعتمادات طلبات العينات",
      subtitle: "مراجعة وإدارة طلبات المندوبين لزيادة كوتة العينات الاستثنائية والطارئة",
      searchPlaceholder: "البحث عن المندوب أو المنتج...",
      statusAll: "كل الحالات",
      statusPending: "قيد الانتظار",
      statusApproved: "مقبول",
      statusRejected: "مرفوض",
      rep: "المندوب الميداني",
      product: "المنتج",
      brand: "العلامة التجارية",
      requestedQty: "الكمية المطلوبة",
      originalAlloc: "الكمية المعتمدة",
      reason: "السبب والمبرر",
      submittedDate: "تاريخ الطلب",
      statusLabel: "الحالة",
      actions: "الإجراءات",
      approve: "موافقة",
      reject: "رفض",
      noData: "لم يتم العثور على أي طلبات اعتماد مطابقة.",
      successApprove: "تمت الموافقة على الطلب وهو بانتظار التخصيص.",
      successReject: "تم رفض الطلب.",
      confirmApprove: "هل أنت متأكد من رغبتك في الموافقة على كوتة العينات الإضافية هذه؟",
      confirmReject: "هل أنت متأكد من رغبتك في رفض كوتة العينات الإضافية هذه؟",
      pendingCount: "اعتمادات معلقة",
      approvedCount: "طلبات مقبولة",
      rejectedCount: "طلبات مرفوضة",
      totalRequests: "إجمالي الطلبات المقدمة"
    }
  }[lang];

  const handleAction = async (id: string, action: "Approved" | "Rejected") => {
    const request = canonicalRequests.find(candidate => candidate.id === id);
    if (!request) return;
    setDecisionTarget({ id, action });
    setDecisionQuantity(action === "Approved" ? String(request.quantityRequested) : "0");
    setDecisionReason("");
    setDecisionError("");
  };

  const submitDecision = async () => {
    if (decisionTarget) {
      const { id, action } = decisionTarget;
      const item = rawApprovals.find(a => a.id === id);
      if (!item) return;
      const request = canonicalRequests.find(candidate => candidate.id === id);
      if (!request) return;
      const capability = action === "Approved" ? "APPROVE_SAMPLE_REQUEST" : "REJECT_SAMPLE_REQUEST";
      if (action === "Approved" ? !canApproveSampleRequest(currentUser, item.repId, users, permissions) : (!hasSampleCapability(currentUser, capability, permissions) || !canActOnSampleRecord(currentUser, item.repId, users, capability, permissions) || item.repId === currentUser.id)) return;

      try {
        const approvedQuantity = action === "Approved" ? Number(decisionQuantity) : 0;
        const rejectionReason = action === "Rejected" ? decisionReason : undefined;
        await decideAuthorizedSampleRequest({ requestId: request.id, decision: action === "Approved" ? "APPROVED" : "REJECTED", approvedQuantity, rejectionReason });
        setDecisionTarget(null);
      } catch (err) {
        console.error(err);
        setDecisionError(err instanceof Error ? err.message : (isRtl ? "فشل حفظ قرار الاعتماد" : "Failed to record approval decision"));
      }
    }
  };

  // Filter and Search Logic
  const filteredApprovals = approvals.filter((app) => {
    const matchesSearch =
      app.repName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      app.productName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      app.brand.toLowerCase().includes(searchTerm.toLowerCase()) ||
      app.reason.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus = statusFilter === "All" || app.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  // Analytics counts
  const pendingRequestsCount = approvals.filter((a) => a.status === "Pending").length;
  const approvedRequestsCount = approvals.filter((a) => a.status === "Approved").length;
  const rejectedRequestsCount = approvals.filter((a) => a.status === "Rejected").length;

  return (
    <div className="space-y-6" id="sample-approvals-container">
      {/* Header section */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-xl border border-gray-100 shadow-xs">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight" id="approvals-page-title">{t.title}</h1>
          <p className="text-sm text-gray-500 mt-1" id="approvals-page-subtitle">{t.subtitle}</p>
        </div>
      </div>

      {/* Analytics widgets */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-5">
        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-mono uppercase tracking-wider text-gray-400">{t.totalRequests}</p>
            <h3 className="text-3xl font-bold text-gray-800 mt-1 font-mono">{approvals.length}</h3>
          </div>
          <div className="w-10 h-10 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">ALL</div>
        </div>
        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-mono uppercase tracking-wider text-amber-500">{t.pendingCount}</p>
            <h3 className="text-3xl font-bold text-amber-500 mt-1 font-mono">{pendingRequestsCount}</h3>
          </div>
          <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
            <Clock className="w-5 h-5 animate-pulse" />
          </div>
        </div>
        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-mono uppercase tracking-wider text-emerald-600">{t.approvedCount}</p>
            <h3 className="text-3xl font-bold text-emerald-600 mt-1 font-mono">{approvedRequestsCount}</h3>
          </div>
          <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <CheckCircle2 className="w-5 h-5" />
          </div>
        </div>
        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-mono uppercase tracking-wider text-rose-600">{t.rejectedCount}</p>
            <h3 className="text-3xl font-bold text-rose-600 mt-1 font-mono">{rejectedRequestsCount}</h3>
          </div>
          <div className="w-10 h-10 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center">
            <XCircle className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-xs flex flex-col sm:flex-row gap-4 items-center">
        <div className="relative w-full sm:flex-1">
          <Search className={`absolute top-1/2 -translate-y-1/2 text-gray-400 w-4.5 h-4.5 ${isRtl ? "right-3.5" : "left-3.5"}`} />
          <input
            type="text"
            placeholder={t.searchPlaceholder}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className={`w-full py-2 bg-gray-50 hover:bg-gray-100/50 focus:bg-white text-sm border border-gray-200 focus:border-indigo-500 rounded-lg focus:outline-none transition-all ${
              isRtl ? "pr-10 pl-4" : "pl-10 pr-4"
            }`}
            id="approvals-search-input"
          />
        </div>

        <div className="flex gap-2 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
          {(["All", "Pending", "Approved", "Rejected"] as const).map((status) => {
            const label =
              status === "All"
                ? t.statusAll
                : status === "Pending"
                ? t.statusPending
                : status === "Approved"
                ? t.statusApproved
                : t.statusRejected;

            const activeColor =
              status === "All"
                ? "bg-indigo-600 text-white"
                : status === "Pending"
                ? "bg-amber-500 text-white"
                : status === "Approved"
                ? "bg-emerald-600 text-white"
                : "bg-rose-600 text-white";

            const inactiveColor = "bg-gray-50 hover:bg-gray-100 text-gray-600 border border-gray-200";

            return (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                  statusFilter === status ? activeColor : inactiveColor
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Approvals Table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-xs overflow-hidden">
        {/* Desktop Table View */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse" id="approvals-table">
            <thead>
              <tr className="bg-gray-50/70 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                <th className={`py-4 px-6 ${isRtl ? "text-right" : "text-left"}`}>{t.rep}</th>
                <th className={`py-4 px-6 ${isRtl ? "text-right" : "text-left"}`}>{t.product}</th>
                <th className={`py-4 px-6 ${isRtl ? "text-right" : "text-left"}`}>{t.brand}</th>
                <th className="py-4 px-6 text-center">{t.requestedQty}</th>
                <th className="py-4 px-6 text-center">{t.originalAlloc}</th>
                <th className={`py-4 px-6 ${isRtl ? "text-right" : "text-left"}`}>{t.reason}</th>
                <th className="py-4 px-6 text-center">{t.submittedDate}</th>
                <th className="py-4 px-6 text-center">{t.statusLabel}</th>
                <th className="py-4 px-6 text-center">{t.actions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 text-sm text-gray-700">
              {filteredApprovals.length > 0 ? (
                filteredApprovals.map((req) => (
                  <tr key={req.id} className="hover:bg-gray-50/40 transition-all">
                    <td className={`py-4 px-6 font-medium text-gray-900 ${isRtl ? "text-right" : "text-left"}`}>
                      {req.repName}
                    </td>
                    <td className={`py-4 px-6 text-gray-500 ${isRtl ? "text-right" : "text-left"}`}>
                      {req.productName}
                    </td>
                    <td className={`py-4 px-6 ${isRtl ? "text-right" : "text-left"}`}>
                      <span className="font-mono text-xs font-semibold text-indigo-600 bg-indigo-50/50 px-2 py-1 rounded">
                        {req.brand}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-center font-bold font-mono text-indigo-600">
                      +{req.requestedQuantity}
                    </td>
                    <td className="py-4 px-6 text-center font-mono text-gray-500">
                      {req.originalAllocation}
                    </td>
                    <td className={`py-4 px-6 text-xs text-gray-500 max-w-xs truncate ${isRtl ? "text-right" : "text-left"}`} title={req.reason}>
                      {req.reason}
                    </td>
                    <td className="py-4 px-6 text-center text-xs font-mono text-gray-400">
                      {req.submittedDate}
                    </td>
                    <td className="py-4 px-6 text-center">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${
                          req.status === "Pending"
                            ? "bg-amber-50 text-amber-700 border border-amber-200/50"
                            : req.status === "Approved"
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200/50"
                            : "bg-rose-50 text-rose-700 border border-rose-200/50"
                        }`}
                      >
                        {req.status === "Pending" && <Clock className="w-3 h-3" />}
                        {req.status === "Approved" && <Check className="w-3 h-3" />}
                        {req.status === "Rejected" && <X className="w-3 h-3" />}
                        {req.status === "Pending"
                          ? t.statusPending
                          : req.status === "Approved"
                          ? t.statusApproved
                          : t.statusRejected}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-center">
                      {req.status === "Pending" && (
                        canApproveSampleRequest(currentUser, req.repId, users, permissions) ? (
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => handleAction(req.id, "Approved")}
                              className="p-1.5 bg-emerald-50 hover:bg-emerald-500 text-emerald-600 hover:text-white rounded-lg transition-all"
                              title={t.approve}
                            >
                              <Check className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleAction(req.id, "Rejected")}
                              className="p-1.5 bg-rose-50 hover:bg-rose-500 text-rose-600 hover:text-white rounded-lg transition-all"
                              title={t.reject}
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400 font-medium">Supervisor Action</span>
                        )
                      )}
                      {req.status !== "Pending" && (
                        <div className="text-xs text-gray-400 font-mono">
                          {req.actionBy} <span className="block text-[10px]">{req.actionDate}</span>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={9} className="py-8 px-6 text-center text-gray-400">
                    <AlertCircle className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                    <span>{t.noData}</span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile Cards List View */}
        <div className="block md:hidden divide-y divide-gray-100">
          {filteredApprovals.length > 0 ? (
            filteredApprovals.map((req) => (
              <div key={req.id} className="p-4 space-y-3 hover:bg-gray-50/20 transition-all text-xs">
                <div className={`flex justify-between items-start gap-2 ${isRtl ? "flex-row-reverse text-right" : "flex-row"}`}>
                  <div>
                    <h4 className="font-semibold text-gray-900 text-sm">{req.repName}</h4>
                    <p className="text-gray-400 text-[10px] mt-0.5">{req.submittedDate}</p>
                  </div>
                  
                  <span
                    className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
                      req.status === "Pending"
                        ? "bg-amber-50 text-amber-700 border border-amber-200/50"
                        : req.status === "Approved"
                        ? "bg-emerald-50 text-emerald-700 border border-emerald-200/50"
                        : "bg-rose-50 text-rose-700 border border-rose-200/50"
                    }`}
                  >
                    {req.status === "Pending" && <Clock className="w-3 h-3" />}
                    {req.status === "Approved" && <Check className="w-3 h-3" />}
                    {req.status === "Rejected" && <X className="w-3 h-3" />}
                    {req.status === "Pending"
                      ? t.statusPending
                      : req.status === "Approved"
                      ? t.statusApproved
                      : t.statusRejected}
                  </span>
                </div>

                <div className={`space-y-1.5 ${isRtl ? "text-right" : "text-left"}`}>
                  <p className="text-gray-600 font-medium leading-tight">{req.productName}</p>
                  <span className="inline-block font-mono text-[10px] font-semibold text-indigo-600 bg-indigo-50/50 px-2 py-0.5 rounded">
                    {req.brand}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 bg-gray-50/50 rounded-lg p-2 text-center text-[11px] font-mono border border-gray-100/50">
                  <div>
                    <p className="text-gray-400 text-[9px] uppercase tracking-wider font-sans mb-0.5">{t.requestedQty}</p>
                    <p className="font-bold text-indigo-600 font-mono">+{req.requestedQuantity}</p>
                  </div>
                  <div>
                    <p className="text-gray-400 text-[9px] uppercase tracking-wider font-sans mb-0.5">{t.originalAlloc}</p>
                    <p className="font-bold text-gray-800 font-mono">{req.originalAllocation}</p>
                  </div>
                </div>

                {req.reason && (
                  <div className={`text-[11px] text-gray-500 bg-gray-50/30 p-2 rounded border border-gray-100/30 ${isRtl ? "text-right" : "text-left"}`}>
                    <span className="font-semibold text-gray-400 block text-[9px] uppercase tracking-wider mb-0.5">{t.reason}</span>
                    <p className="leading-relaxed">{req.reason}</p>
                  </div>
                )}

                <div className={`flex items-center pt-2.5 border-t border-gray-50 justify-between ${isRtl ? "flex-row-reverse" : "flex-row"}`}>
                  {/* Approval / Rejection status metadata or action buttons */}
                  <div>
                    {req.status !== "Pending" && (
                      <div className={`text-[10px] text-gray-400 font-mono ${isRtl ? "text-right" : "text-left"}`}>
                        <span className="font-sans block text-[9px] text-gray-400 uppercase tracking-wider">Processed By</span>
                        <span className="font-bold text-gray-600">{req.actionBy}</span> <span className="text-gray-300">|</span> <span>{req.actionDate}</span>
                      </div>
                    )}
                  </div>

                  <div>
                    {req.status === "Pending" && (
                      canApproveSampleRequest(currentUser, req.repId, users, permissions) ? (
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => handleAction(req.id, "Approved")}
                            className="flex items-center gap-1 py-1 px-3 bg-emerald-50 hover:bg-emerald-500 text-emerald-600 hover:text-white rounded-md transition-all font-bold text-[10px] cursor-pointer"
                          >
                            <Check className="w-3 h-3" />
                            <span>{t.approve || "Approve"}</span>
                          </button>
                          <button
                            onClick={() => handleAction(req.id, "Rejected")}
                            className="flex items-center gap-1 py-1 px-3 bg-rose-50 hover:bg-rose-500 text-rose-600 hover:text-white rounded-md transition-all font-bold text-[10px] cursor-pointer"
                          >
                            <X className="w-3 h-3" />
                            <span>{t.reject || "Reject"}</span>
                          </button>
                        </div>
                      ) : (
                        <span className="text-[10px] text-gray-400 font-medium italic">Supervisor Action Required</span>
                      )
                    )}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="py-8 px-4 text-center text-gray-400">
              <AlertCircle className="w-8 h-8 mx-auto mb-2 text-gray-300" />
              <span>{t.noData}</span>
            </div>
          )}
        </div>
      </div>
      {decisionTarget && (() => {
        const request = canonicalRequests.find(item => item.id === decisionTarget.id);
        if (!request) return null;
        return <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl border border-gray-100 w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between"><div><h3 className="font-bold text-gray-900">{decisionTarget.action === "Approved" ? t.approve : t.reject}</h3><p className="text-xs text-gray-500 mt-1">{request.sampleSkuName || request.productName || request.sampleSkuId} · {request.quantityRequested}</p></div><button onClick={() => setDecisionTarget(null)} className="p-1.5 text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button></div>
            <div className="p-6 space-y-4">
              <div className="rounded-lg bg-gray-50 border border-gray-100 p-3 text-xs text-gray-600"><p><strong>{isRtl ? "المندوب" : "Representative"}:</strong> {users.find(user => user.id === request.repId)?.name || request.repId}</p><p className="mt-1"><strong>{isRtl ? "السبب" : "Reason"}:</strong> {request.reason}</p>{request.requestedForPhysicianId && <p className="mt-1"><strong>{isRtl ? "الطبيب المقصود" : "Intended physician"}:</strong> {physicians.find(physician => physician.id === request.requestedForPhysicianId)?.name || request.requestedForPhysicianId}</p>}<p className="mt-1"><strong>{isRtl ? "المصدر" : "Source"}:</strong> {request.source}{request.urgent ? ` · ${isRtl ? "عاجل" : "Urgent"}` : ""}</p></div>
              {decisionTarget.action === "Approved" ? <label className="block text-sm font-medium text-gray-700">{isRtl ? "الكمية الموافق عليها" : "Approved quantity"}<input type="number" min="1" max={request.quantityRequested} value={decisionQuantity} onChange={event => setDecisionQuantity(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 p-2.5" /></label> : <label className="block text-sm font-medium text-gray-700">{isRtl ? "سبب الرفض" : "Rejection reason"}<textarea value={decisionReason} onChange={event => setDecisionReason(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 p-2.5" rows={3} required /></label>}
              {decisionError && <p className="text-xs text-rose-600 bg-rose-50 p-2 rounded">{decisionError}</p>}
              <div className="flex justify-end gap-2"><button onClick={() => setDecisionTarget(null)} className="px-4 py-2 rounded-lg border border-gray-200 text-sm">{isRtl ? "إلغاء" : "Cancel"}</button><button onClick={submitDecision} className={`px-4 py-2 rounded-lg text-white text-sm font-bold ${decisionTarget.action === "Approved" ? "bg-emerald-600" : "bg-rose-600"}`}>{decisionTarget.action === "Approved" ? t.approve : t.reject}</button></div>
            </div>
          </div>
        </div>;
      })()}
    </div>
  );
}
