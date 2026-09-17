import React, { useState, useEffect } from "react";
import { Plus, Search, Filter, AlertCircle, Clock, Check, Send, ShieldAlert, CheckCircle2, Truck, Stethoscope, Package, X, SlidersHorizontal } from "lucide-react";
import { LegacySampleRequest as SampleRequest, SampleRequest as CanonicalSampleRequest, User, Physician, SampleSku, UserProductAssignment, Permissions, Role } from "../../types";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { auth, db } from "../../lib/firebase";
import { triggerSampleRequestAlert } from "../../lib/notificationService";
import { getAuthorizedSampleUserIds, getSampleDataScope, hasSampleCapability } from "../../lib/sampleAuthorization";
import { getSampleRequestStatusLabel, normalizeSampleRequestStatus } from "../../lib/sampleWorkspace";
import { cancelPendingSampleRequest, persistSampleRequestCancellation } from "../../lib/sampleRequestLifecycleService";
import { createAuthorizedSampleRequest } from "../../lib/sampleRequestClient";
import { subscribeToScopedSampleCollection } from "../../lib/sampleScopeClient";

interface SampleRequestsProps {
  currentUser: User;
  users: User[];
  physicians?: Physician[];
  permissions?: Permissions;
  lang: "en" | "ar";
  profileLoaded?: boolean;
}

export default function SampleRequests({ currentUser, users, physicians = [], permissions, lang, profileLoaded }: SampleRequestsProps) {
  const isRtl = lang === "ar";
  
  // Real-time Firestore States
  const [requests, setRequests] = useState<SampleRequest[]>([]);
  const [rawRequests, setRawRequests] = useState<SampleRequest[]>([]);
  const [canonicalRequests, setCanonicalRequests] = useState<CanonicalSampleRequest[]>([]);
  const [dbProducts, setDbProducts] = useState<SampleSku[]>([]);
  const [dbPhysicians, setDbPhysicians] = useState<Physician[]>([]);
  const [userProductAssignments, setUserProductAssignments] = useState<UserProductAssignment[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  // Firestore Synchronizers
  useEffect(() => {
    if (!profileLoaded || !currentUser) return;

    setIsLoading(true);

    // 1. Listen sampleRequests
    const capability = hasSampleCapability(currentUser, "VIEW_TEAM_SAMPLE_REQUESTS", permissions) ? "VIEW_TEAM_SAMPLE_REQUESTS" : "VIEW_OWN_SAMPLE_REQUESTS";
    const scope = getSampleDataScope(currentUser, capability, permissions);
    const authorizedIds = getAuthorizedSampleUserIds(currentUser, users, scope);
    const unsubRequests = subscribeToScopedSampleCollection(db, "sampleRequests", scope, authorizedIds, (docs) => {
      const items: SampleRequest[] = [];
      const canonical: CanonicalSampleRequest[] = [];
      docs.forEach((doc) => {
        const data = doc.data();
        if (!data.isDeleted) {
          canonical.push({ id: doc.id, ...data } as CanonicalSampleRequest);
          const repId = data.repId || data.requesterId || "";
          items.push({
            id: doc.id,
            repId,
            repName: data.repName || users.find(user => user.id === repId)?.name || repId,
            productId: data.productId || "",
            productName: data.productName || data.sampleSkuName || data.sampleSkuId || "—",
            brand: data.brand || data.descriptor || data.productId || "—",
            quantity: data.quantityRequested ?? data.quantity ?? 0,
            reason: data.reason || "",
            status: data.status || "PENDING_APPROVAL",
            requestedDate: data.createdAt?.slice?.(0, 10) || data.requestedDate || "—",
            urgent: data.urgent === true,
            physicianId: data.requestedForPhysicianId || data.physicianId,
            physicianName: data.requestedForPhysicianName || data.physicianName || physicians.find(physician => physician.id === (data.requestedForPhysicianId || data.physicianId))?.name
          } as SampleRequest);
        }
      });
      setRawRequests(items);
      setCanonicalRequests(canonical);
    }, (err) => {
      console.error("Error listening to sampleRequests:", err);
    });
    console.info("SAFE LISTENER STARTED: sampleRequests");

    // 2. Listen canonical Sample SKUs. Product commercial stock is never a request source.
    const unsubProducts = onSnapshot(collection(db, "sampleCatalog"), (snap) => {
      const items: SampleSku[] = [];
      snap.forEach((doc) => {
        const data = doc.data();
        if (!data.isDeleted && data.active !== false) {
          items.push({ id: doc.id, ...data } as SampleSku);
        }
      });
      setDbProducts(items);
    });

    // Canonical physician population is hydrated by the scoped physician service.
    setDbPhysicians(physicians.filter(physician => (physician as Physician & { isDeleted?: boolean; active?: boolean }).isDeleted !== true && (physician as Physician & { active?: boolean }).active !== false));

    // 4. Listen product assignments (secured query scoped to the current user's UID to prevent broad collection enumeration)
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
      unsubRequests();
      unsubProducts();
      unsubProdAss();
    };
  }, [profileLoaded, currentUser, users, physicians, permissions]);

  // Firestore already returned only the explicitly authorized repId scope. Do not
  // pass request rows through the generic physician/customer scope classifier:
  // request view models can contain physicianName and are not physician records.
  useEffect(() => {
    setRequests(rawRequests);
  }, [rawRequests]);

  // Request Form
  const [showFormModal, setShowFormModal] = useState(false);
  const [formPhysicianId, setFormPhysicianId] = useState("");
  const [formProductSearch, setFormProductSearch] = useState("");
  const [formProductBrandFilter, setFormProductBrandFilter] = useState("all");
  const [showFormFilters, setShowFormFilters] = useState(false);
  const [selectedFormProducts, setSelectedFormProducts] = useState<Record<string, number>>({});
  const [formReason, setFormReason] = useState("");
  const [formUrgent, setFormUrgent] = useState(false);
  const [formExpectedDeliveryDate, setFormExpectedDeliveryDate] = useState("");
  const [formIdempotencyKey, setFormIdempotencyKey] = useState("");
  const [formError, setFormError] = useState("");

  const t = {
    en: {
      title: "Field Sample Inventory Requests",
      subtitle: "Submit and track representative requests to replenish clinical field sample containers",
      newRequest: "New Stock Request",
      searchPlaceholder: "Search requests by representative, product or brand...",
      allStatus: "All Statuses",
      statusPending: "Pending Approval",
      statusApproved: "Approved",
      statusRejected: "Rejected",
      statusShipped: "Shipped",
      statusDelivered: "Delivered",
      rep: "Representative",
      product: "Product",
      brand: "Brand",
      quantity: "Quantity",
      reason: "Justification Reason",
      statusLabel: "Status",
      date: "Requested On",
      priority: "Priority",
      urgent: "Urgent",
      normal: "Normal",
      modalTitle: "Request Field Sample Refill",
      selectProduct: "Choose Product",
      qtyLabel: "Refill Quantity",
      reasonLabel: "Reason / Purpose",
      submit: "Submit Request",
      cancel: "Cancel",
      noData: "No sample requests found matching filters.",
      requiredFields: "Please specify the product, quantity and justification.",
      confirmDeliver: "Mark this request as DELIVERED to representative's hand?",
      deliverBtn: "Mark Delivered",
      shipBtn: "Mark Shipped"
    },
    ar: {
      title: "طلبات توريد عينات ميدانية",
      subtitle: "تقديم وتتبع طلبات المندوبين لإعادة ملء حقائب العينات الطبية والمستودعات الفرعية",
      newRequest: "طلب توريد جديد",
      searchPlaceholder: "البحث عن طلب بواسطة المندوب أو المنتج...",
      allStatus: "كل الحالات",
      statusPending: "قيد المراجعة والاعتماد",
      statusApproved: "معتمد",
      statusRejected: "مرفوض",
      statusShipped: "تم الشحن",
      statusDelivered: "تم التسليم",
      rep: "المندوب الميداني",
      product: "المنتج",
      brand: "العلامة التجارية",
      quantity: "الكمية المطلوبة",
      reason: "السبب والغرض",
      statusLabel: "الحالة",
      date: "تاريخ الطلب",
      priority: "الأولوية",
      urgent: "عاجل جداً",
      normal: "عادي",
      modalTitle: "طلب إعادة تعبئة حقيبة العينات",
      selectProduct: "اختر المنتج الطبي",
      qtyLabel: "الكمية المطلوبة لتجديد المخزون",
      reasonLabel: "مبرر وسبب الطلب",
      submit: "إرسال الطلب للموافقة",
      cancel: "إلغاء",
      noData: "لم يتم العثور على أي طلبات مطابقة للفلاتر.",
      requiredFields: "يرجى تعبئة جميع الحقول وتحديد المنتج والكمية والسبب.",
      confirmDeliver: "هل ترغب في تأكيد استلام وتسليم الشحنة للمندوب الميداني؟",
      deliverBtn: "تأكيد الاستلام",
      shipBtn: "شحن العينات"
    }
  }[lang];

  const handleCreateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasSampleCapability(currentUser, "CREATE_SAMPLE_REQUEST", permissions)) return;
    const selectedKeys = Object.keys(selectedFormProducts).filter(id => selectedFormProducts[id] > 0);
    if (selectedKeys.length === 0) {
      setFormError(isRtl ? "يرجى اختيار عينة واحدة على الأقل وتحديد الكمية." : "Please select at least one sample product and specify a quantity.");
      return;
    }

    if (!formReason.trim()) {
      setFormError(isRtl ? "يرجى تقديم مبرر أو سبب الطلب." : "Please explain why you need these samples.");
      return;
    }
    const phys = dbPhysicians.find(p => p.id === formPhysicianId);
    const physicianName = phys ? phys.name : "";

    try {
      for (const sampleSkuId of selectedKeys) {
        const sampleSku = dbProducts.find((sku) => sku.id === sampleSkuId);
        if (!sampleSku) continue;

        const assignedProductIds = userProductAssignments.filter(item => item.status === "Active" && item.active !== false).map(item => item.productId);
        if (!assignedProductIds.includes(sampleSku.productId)) throw new Error("SAMPLE_REQUEST_PRODUCT_SCOPE_DENIED");
        if (!auth.currentUser) throw new Error("AUTHENTICATION_REQUIRED");
        const result = await createAuthorizedSampleRequest(auth.currentUser, { idempotencyKey: `${formIdempotencyKey}:${sampleSkuId}`, physicianId: formPhysicianId || undefined, sampleSkuId, quantity: selectedFormProducts[sampleSkuId], reason: formReason, expectedDeliveryDate: formExpectedDeliveryDate || undefined, urgent: formUrgent });
        const reqId = result.requestId as string;

        // Trigger automated sample requests approval alert
        triggerSampleRequestAlert(
          reqId,
          currentUser.name,
          sampleSku.name,
          selectedFormProducts[sampleSkuId],
          formUrgent,
          currentUser.id
        ).catch(e => console.error("[Alert Engine] Sample request alert failed:", e));
      }

      setShowFormModal(false);
      // Reset Form
      setFormPhysicianId("");
      setFormProductSearch("");
      setFormProductBrandFilter("all");
      setShowFormFilters(false);
      setSelectedFormProducts({});
      setFormReason("");
      setFormUrgent(false);
      setFormExpectedDeliveryDate("");
      setFormIdempotencyKey("");
      setFormError("");
    } catch (err) {
      console.error(err);
      setFormError(isRtl ? "فشل إرسال الطلب في قاعدة البيانات" : "Failed to save sample request in database");
    }
  };

  const cancelRequest = async (id: string) => {
    const request = canonicalRequests.find(item => item.id === id);
    if (!request) return;
    try {
      const cancelled = cancelPendingSampleRequest(request, currentUser.id, new Date().toISOString());
      await persistSampleRequestCancellation(cancelled, currentUser.id);
    } catch (err) {
      console.error(err);
      alert(isRtl ? "تعذر إلغاء الطلب" : "Unable to cancel this request");
    }
  };

  // Filter Logic
  const filteredRequests = requests.filter((r) => {
    const matchesSearch =
      r.repName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.productName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.brand.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus = statusFilter === "all" || r.status.toLowerCase() === statusFilter.toLowerCase();

    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-6" id="sample-requests-container">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-xl border border-gray-100 shadow-xs">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight" id="req-page-title">{t.title}</h1>
          <p className="text-sm text-gray-500 mt-1" id="req-page-subtitle">{t.subtitle}</p>
        </div>
        {hasSampleCapability(currentUser, "CREATE_SAMPLE_REQUEST", permissions) ? (
          <button
            onClick={() => { setFormIdempotencyKey(crypto.randomUUID()); setShowFormModal(true); }}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-lg font-medium transition-all text-sm shadow-xs animate-pulse"
            id="btn-new-request"
          >
            <Plus className="w-4 h-4" />
            <span>{t.newRequest}</span>
          </button>
        ) : null}
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
            id="requests-search-input"
          />
        </div>

        <div className="flex gap-2 w-full sm:w-auto">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-gray-50 hover:bg-gray-100/50 border border-gray-200 rounded-lg text-xs py-2 px-3 focus:outline-none text-gray-600 w-full sm:w-auto"
            id="requests-status-filter"
          >
            <option value="all">{t.allStatus}</option>
            <option value="pending">{t.statusPending}</option>
            <option value="shipped">{t.statusShipped}</option>
            <option value="delivered">{t.statusDelivered}</option>
            <option value="rejected">{t.statusRejected}</option>
          </select>
        </div>
      </div>

      {/* Requests Ledger Table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-xs overflow-hidden">
        {/* Desktop View */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse" id="requests-table">
            <thead>
              <tr className="bg-gray-50/70 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                <th className={`py-4 px-6 ${isRtl ? "text-right" : "text-left"}`}>{t.rep}</th>
                <th className={`py-4 px-6 ${isRtl ? "text-right" : "text-left"}`}>{t.product}</th>
                <th className={`py-4 px-6 ${isRtl ? "text-right" : "text-left"}`}>{t.brand}</th>
                <th className="py-4 px-6 text-center">{t.quantity}</th>
                <th className="py-4 px-6 text-center">{t.priority}</th>
                <th className={`py-4 px-6 ${isRtl ? "text-right" : "text-left"}`}>{t.reason}</th>
                <th className="py-4 px-6 text-center">{t.date}</th>
                <th className="py-4 px-6 text-center">{t.statusLabel}</th>
                <th className="py-4 px-6 text-center">{isRtl ? "تعديل الحالة" : "Actions"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 text-sm text-gray-700">
              {filteredRequests.length > 0 ? (
                filteredRequests.map((req) => (
                  <tr key={req.id} className="hover:bg-gray-50/40 transition-all">
                    <td className={`py-4 px-6 font-medium text-gray-900 ${isRtl ? "text-right" : "text-left"}`}>
                      <div>{req.repName}</div>
                      {req.physicianName && (
                        <div className="text-[11px] text-amber-600 font-semibold mt-0.5 flex items-center gap-1">
                          <Stethoscope className="w-3.5 h-3.5 inline shrink-0" />
                          <span>{req.physicianName}</span>
                        </div>
                      )}
                    </td>
                    <td className={`py-4 px-6 text-gray-500 ${isRtl ? "text-right" : "text-left"}`}>
                      {req.productName}
                    </td>
                    <td className={`py-4 px-6 ${isRtl ? "text-right" : "text-left"}`}>
                      <span className="font-mono text-xs font-semibold text-indigo-600 bg-indigo-50/50 px-2 py-1 rounded">
                        {req.brand}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-center font-bold font-mono">
                      {req.quantity}
                    </td>
                    <td className="py-4 px-6 text-center">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold ${
                          req.urgent
                            ? "bg-rose-50 text-rose-700 font-bold border border-rose-100"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {req.urgent && <ShieldAlert className="w-3 h-3" />}
                        {req.urgent ? t.urgent : t.normal}
                      </span>
                    </td>
                    <td className={`py-4 px-6 text-xs text-gray-500 max-w-xs truncate ${isRtl ? "text-right" : "text-left"}`} title={req.reason}>
                      {req.reason}
                    </td>
                    <td className="py-4 px-6 text-center text-xs font-mono text-gray-400">
                      {req.requestedDate}
                    </td>
                    <td className="py-4 px-6 text-center">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${
                          req.status === "Pending"
                            ? "bg-amber-50 text-amber-700 border border-amber-200/50"
                            : req.status === "Approved"
                            ? "bg-indigo-50 text-indigo-700 border border-indigo-200/50"
                            : req.status === "Shipped"
                            ? "bg-blue-50 text-blue-700 border border-blue-200/50"
                            : req.status === "Delivered"
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200/50"
                            : "bg-rose-50 text-rose-700 border border-rose-200/50"
                        }`}
                      >
                        {req.status === "Pending" && <Clock className="w-3 h-3" />}
                        {req.status === "Shipped" && <Truck className="w-3 h-3" />}
                        {req.status === "Delivered" && <CheckCircle2 className="w-3 h-3" />}
                        {getSampleRequestStatusLabel(normalizeSampleRequestStatus(req.status), lang)}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-center">
                      {normalizeSampleRequestStatus(req.status) === "PENDING_APPROVAL" && req.repId === currentUser.id ? <button onClick={() => cancelRequest(req.id)} className="text-xs bg-gray-100 hover:bg-rose-600 text-gray-600 hover:text-white px-2.5 py-1 rounded font-medium transition-all">{t.cancel}</button> : <span className="text-xs text-gray-400">-</span>}
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

        {/* Mobile Cards View */}
        <div className="block md:hidden divide-y divide-gray-100" id="sample-requests-mobile-list">
          {filteredRequests.length > 0 ? (
            filteredRequests.map((req) => (
              <div key={req.id} className={`p-4 space-y-3.5 text-xs ${isRtl ? "text-right" : "text-left"}`}>
                <div className="flex justify-between items-start gap-2">
                  <div>
                    <h4 className="font-bold text-gray-900 dark:text-white text-sm">{req.repName}</h4>
                    {req.physicianName && (
                      <div className="text-[11px] text-amber-600 font-semibold mt-1 flex items-center gap-1">
                        <Stethoscope className="w-3.5 h-3.5 inline shrink-0" />
                        <span>{req.physicianName}</span>
                      </div>
                    )}
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
                      req.status === "Pending"
                        ? "bg-amber-50 text-amber-700 border border-amber-200/50"
                        : req.status === "Approved"
                        ? "bg-indigo-50 text-indigo-700 border border-indigo-200/50"
                        : req.status === "Shipped"
                        ? "bg-blue-50 text-blue-700 border border-blue-200/50"
                        : req.status === "Delivered"
                        ? "bg-emerald-50 text-emerald-700 border border-emerald-200/50"
                        : "bg-rose-50 text-rose-700 border border-rose-200/50"
                    }`}
                  >
                    {getSampleRequestStatusLabel(normalizeSampleRequestStatus(req.status), lang)}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3.5 bg-gray-50/70 rounded-xl p-3 border border-gray-100/50 text-[11px]">
                  <div>
                    <span className="text-gray-400 font-semibold uppercase text-[8px] block mb-0.5">{t.product}</span>
                    <span className="font-bold text-gray-800">{req.productName}</span>
                  </div>
                  <div>
                    <span className="text-gray-400 font-semibold uppercase text-[8px] block mb-0.5">{t.brand}</span>
                    <span className="font-mono font-bold text-indigo-600 bg-indigo-50/50 px-1.5 py-0.5 rounded text-[10px]">{req.brand}</span>
                  </div>
                  <div>
                    <span className="text-gray-400 font-semibold uppercase text-[8px] block mb-0.5">{t.quantity}</span>
                    <span className="font-mono font-bold text-gray-800">{req.quantity} packs</span>
                  </div>
                  <div>
                    <span className="text-gray-400 font-semibold uppercase text-[8px] block mb-0.5">{t.priority}</span>
                    <span className={`inline-flex items-center gap-1 font-bold ${req.urgent ? "text-rose-600" : "text-gray-600"}`}>
                      {req.urgent ? t.urgent : t.normal}
                    </span>
                  </div>
                </div>

                {req.reason && (
                  <div className="p-2.5 bg-gray-50 rounded-lg text-[11px] text-gray-500 border border-gray-100">
                    <span className="text-[9px] text-gray-400 font-bold block uppercase mb-1">{t.reason}</span>
                    <p className="line-clamp-2">{req.reason}</p>
                  </div>
                )}

                <div className="flex justify-between items-center pt-1.5 border-t border-gray-50 text-[11px]">
                  <span className="text-gray-400 font-mono text-[10px]">{req.requestedDate}</span>
                  <div>
                    {normalizeSampleRequestStatus(req.status) === "PENDING_APPROVAL" && req.repId === currentUser.id ? <button onClick={() => cancelRequest(req.id)} className="text-xs bg-gray-100 text-gray-700 px-3 py-1.5 rounded-lg font-bold hover:bg-rose-600 hover:text-white transition-all">{t.cancel}</button> : <span className="text-xs text-gray-400">-</span>}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="py-8 px-6 text-center text-gray-400 text-xs">
              <AlertCircle className="w-8 h-8 mx-auto mb-2 text-gray-300" />
              <span>{t.noData}</span>
            </div>
          )}
        </div>
      </div>

      {/* New Request Modal */}
      {showFormModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl border border-gray-100 max-w-md w-full overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-white">
              <h3 className="text-lg font-bold text-gray-900 leading-tight" id="req-modal-title">
                {isRtl ? "طلب جديد" : "New Request"}
              </h3>
              <button
                onClick={() => {
                  setShowFormModal(false);
                  // Reset form states
                  setFormPhysicianId("");
                  setFormProductSearch("");
                  setFormProductBrandFilter("all");
                  setShowFormFilters(false);
                  setSelectedFormProducts({});
                  setFormReason("");
                  setFormUrgent(false);
                  setFormError("");
                }}
                className="text-gray-400 hover:text-gray-600 p-1.5 rounded-full hover:bg-gray-50 transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateRequest} className="p-6 space-y-4">
              {formError && (
                <div className="p-3 rounded bg-rose-50 text-rose-700 text-xs flex gap-2 items-center">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              {/* Intended Physician */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
                  <Stethoscope className="w-4 h-4 text-gray-500" />
                  <span>{isRtl ? "الطبيب المستهدف" : "Intended Physician"}</span>
                  <span className="text-rose-500 font-bold">*</span>
                </label>
                <div className="relative">
                  <select
                    value={formPhysicianId}
                    onChange={(e) => setFormPhysicianId(e.target.value)}
                    className="w-full bg-white border border-gray-200 hover:border-gray-300 focus:border-indigo-500 rounded-lg text-sm p-2.5 pr-8 focus:outline-none appearance-none transition-all shadow-2xs"
                  >
                    <option value="">{isRtl ? "طلب مخزون عام (بدون طبيب)" : "General stock request (no physician)"}</option>
                    {dbPhysicians.map((p) => (
                      <option key={p.id} value={p.id}>{p.name} ({p.specialty} - {p.region})</option>
                    ))}
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-500">
                    <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                      <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/>
                    </svg>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-amber-600 font-medium">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>{isRtl ? "الطبيب اختياري لطلب المخزون العام" : "Physician is optional for a standalone stock request"}</span>
                </div>
              </div>

              <div className="space-y-1.5"><label className="text-xs font-semibold text-gray-700">{isRtl ? "تاريخ التسليم المتوقع" : "Expected Delivery Date"}</label><input type="date" value={formExpectedDeliveryDate} onChange={event => setFormExpectedDeliveryDate(event.target.value)} className="w-full bg-white border border-gray-200 rounded-lg text-sm p-2.5" /></div>

              {/* Search Samples & Filters Bar */}
              <div className="space-y-1.5">
                <div className="flex gap-2 items-center">
                  <div className="relative flex-1">
                    <Search className="absolute top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4 left-3" />
                    <input
                      type="text"
                      placeholder={isRtl ? "البحث في العينات..." : "Search samples..."}
                      value={formProductSearch}
                      onChange={(e) => setFormProductSearch(e.target.value)}
                      className="w-full py-2 bg-gray-50 hover:bg-gray-100/50 focus:bg-white text-xs border border-gray-200 focus:border-indigo-500 rounded-lg focus:outline-none pl-9 pr-3 transition-all"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowFormFilters(!showFormFilters)}
                    className={`px-3 py-2 border rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                      showFormFilters
                        ? "bg-indigo-50 border-indigo-200 text-indigo-700"
                        : "bg-white border-gray-250 text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5" />
                    <span>{isRtl ? "الفلاتر" : "Filters"}</span>
                  </button>
                </div>

                {/* Form Filters Brand Expandable */}
                {showFormFilters && (
                  <div className="flex gap-1.5 flex-wrap py-1 animate-in fade-in slide-in-from-top-2 duration-150">
                    <button
                      type="button"
                      onClick={() => setFormProductBrandFilter("all")}
                      className={`px-2.5 py-1 rounded-full text-[10px] transition-all font-semibold border ${
                        formProductBrandFilter === "all"
                          ? "bg-indigo-600 text-white border-indigo-600"
                          : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                      }`}
                    >
                      {isRtl ? "كل العلامات" : "All Brands"}
                    </button>
                    {Array.from(new Set(dbProducts.map(p => p.descriptor))).map(brand => (
                      <button
                        key={brand}
                        type="button"
                        onClick={() => setFormProductBrandFilter(brand)}
                        className={`px-2.5 py-1 rounded-full text-[10px] transition-all font-semibold border ${
                          formProductBrandFilter === brand
                            ? "bg-indigo-600 text-white border-indigo-600"
                            : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                        }`}
                      >
                        {brand}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Products List Checklist Container */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-700 block">{isRtl ? "اختر العينات الطبية" : "Select Products"}</label>
                <div className="border border-gray-150 rounded-lg p-2 max-h-56 overflow-y-auto bg-gray-50/50 space-y-1.5">
                  {dbProducts.filter(p => {
                    const matchesSearch = p.name.toLowerCase().includes(formProductSearch.toLowerCase()) || p.descriptor.toLowerCase().includes(formProductSearch.toLowerCase());
                    const matchesBrand = formProductBrandFilter === "all" || p.descriptor === formProductBrandFilter;
                    return matchesSearch && matchesBrand;
                  }).map((p) => {
                    const isSelected = selectedFormProducts[p.id] !== undefined;
                    return (
                      <div
                        key={p.id}
                        className={`flex items-center justify-between p-2.5 rounded-lg transition-all border ${
                          isSelected
                            ? "bg-indigo-50/30 border-indigo-150"
                            : "bg-white border-gray-100 hover:bg-gray-50/50"
                        }`}
                      >
                        <div className="flex items-center gap-2.5 flex-1 min-w-0 mr-2">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {
                              if (isSelected) {
                                const copy = { ...selectedFormProducts };
                                delete copy[p.id];
                                setSelectedFormProducts(copy);
                              } else {
                                setSelectedFormProducts({
                                  ...selectedFormProducts,
                                  [p.id]: 50 // default quantity
                                });
                              }
                            }}
                            className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-gray-300 cursor-pointer"
                          />
                          <div className="flex items-center gap-2 min-w-0">
                            <Package className="w-4.5 h-4.5 text-gray-400 shrink-0" />
                            <div className="leading-tight truncate">
                              <p className="text-xs font-semibold text-gray-800 truncate">{p.name} - Trial</p>
                              <p className="text-[10px] text-gray-400 font-mono mt-0.5 truncate">{p.descriptor}</p>
                            </div>
                          </div>
                        </div>

                        {/* Right Actions */}
                        <div className="flex items-center gap-2 shrink-0">
                          {isSelected ? (
                            <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-md p-1 shadow-3xs">
                              <button
                                type="button"
                                onClick={() => {
                                  const current = selectedFormProducts[p.id];
                                  if (current <= 10) {
                                    const copy = { ...selectedFormProducts };
                                    delete copy[p.id];
                                    setSelectedFormProducts(copy);
                                  } else {
                                    setSelectedFormProducts({
                                      ...selectedFormProducts,
                                      [p.id]: current - 10
                                    });
                                  }
                                }}
                                className="w-5 h-5 flex items-center justify-center text-gray-500 hover:bg-gray-100 rounded text-xs font-bold font-mono transition-all"
                              >
                                -
                              </button>
                              <input
                                type="number"
                                min="1"
                                value={selectedFormProducts[p.id]}
                                onChange={(e) => {
                                  const val = e.target.value === "" ? 0 : Number(e.target.value);
                                  setSelectedFormProducts({
                                    ...selectedFormProducts,
                                    [p.id]: val
                                  });
                                }}
                                className="w-10 text-center text-xs font-bold text-indigo-700 bg-transparent focus:outline-none focus:ring-0 p-0 m-0 border-none font-mono"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedFormProducts({
                                    ...selectedFormProducts,
                                    [p.id]: (selectedFormProducts[p.id] || 0) + 10
                                  });
                                }}
                                className="w-5 h-5 flex items-center justify-center text-gray-500 hover:bg-gray-100 rounded text-xs font-bold font-mono transition-all"
                              >
                                +
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedFormProducts({
                                  ...selectedFormProducts,
                                  [p.id]: 50
                                });
                              }}
                              className="w-7 h-7 flex items-center justify-center border border-gray-250 hover:border-indigo-500 rounded-md text-gray-500 hover:text-indigo-600 hover:bg-indigo-50/30 transition-all font-semibold"
                            >
                              +
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {dbProducts.filter(p => {
                    const matchesSearch = p.name.toLowerCase().includes(formProductSearch.toLowerCase()) || p.descriptor.toLowerCase().includes(formProductSearch.toLowerCase());
                    const matchesBrand = formProductBrandFilter === "all" || p.descriptor === formProductBrandFilter;
                    return matchesSearch && matchesBrand;
                  }).length === 0 && (
                    <p className="text-center text-xs text-gray-400 py-6">{isRtl ? "لا توجد منتجات مطابقة للتصفية" : "No products matching brand filter."}</p>
                  )}
                </div>
              </div>

              {/* Reason text */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-700 block">
                  {isRtl ? "السبب" : "Reason"}
                </label>
                <textarea
                  value={formReason}
                  onChange={(e) => setFormReason(e.target.value)}
                  rows={3}
                  className="w-full bg-white border border-gray-250 focus:border-indigo-500 rounded-lg text-sm p-2.5 focus:outline-none transition-all shadow-2xs"
                  placeholder={isRtl ? "اشرح سبب حاجتك لهذه العينات..." : "Explain why you need these samples..."}
                />
              </div>

              {/* Urgent Flag */}
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="urgent-checkbox"
                  checked={formUrgent}
                  onChange={(e) => setFormUrgent(e.target.checked)}
                  className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500 cursor-pointer"
                />
                <label htmlFor="urgent-checkbox" className="text-xs font-semibold text-gray-700 select-none cursor-pointer flex items-center gap-1">
                  <ShieldAlert className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                  <span>{isRtl ? "طلب عاجل واستثنائي" : "Mark as highly urgent / priority shipment"}</span>
                </label>
              </div>

              {/* Footer Actions */}
              <div className="flex justify-end gap-3 pt-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => {
                    setShowFormModal(false);
                    // Reset form states
                    setFormPhysicianId("");
                    setFormProductSearch("");
                    setFormProductBrandFilter("all");
                    setShowFormFilters(false);
                    setSelectedFormProducts({});
                    setFormReason("");
                    setFormUrgent(false);
                    setFormError("");
                  }}
                  className="px-4 py-2 border border-gray-255 text-gray-500 rounded-lg text-sm font-semibold hover:bg-gray-50 transition-all"
                >
                  {t.cancel}
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-semibold shadow-xs transition-all flex items-center gap-2"
                >
                  <Send className="w-4 h-4" />
                  <span>{isRtl ? "تقديم الطلب" : "Submit Request"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
