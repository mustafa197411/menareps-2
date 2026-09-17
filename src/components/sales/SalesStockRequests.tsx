import React, { useState, useEffect, useMemo } from "react";
import { 
  Package, 
  Clock, 
  Truck, 
  CheckCircle, 
  BarChart2, 
  Search, 
  Filter, 
  Download, 
  Plus, 
  X, 
  Store, 
  Layers,
  Check,
  AlertCircle,
  ChevronLeft,
  ChevronRight
} from "lucide-react";
import { Product, Pharmacy } from "../../types";
import { listenCollection } from "../../lib/firebaseSync";

interface SalesStockRequestsProps {
  products: Product[];
  pharmacies: Pharmacy[];
  lang: "en" | "ar";
}

interface StockRequest {
  id: string;
  displayNumber?: string;
  pharmacyName: string;
  productName: string;
  brand: string;
  quantity: number;
  date: string;
  status: "Pending" | "In Transit" | "Fulfilled" | "Rejected";
}

const INITIAL_REQUESTS: StockRequest[] = [];

export default function SalesStockRequests({ products, pharmacies, lang }: SalesStockRequestsProps) {
  const isRtl = lang === "ar";

  const [requests, setRequests] = useState<StockRequest[]>(() => {
    try {
      const saved = localStorage.getItem("pharma_crm_stock_requests");
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      // Ignore storage access errors in sandboxed preview
    }
    return INITIAL_REQUESTS;
  });

  useEffect(() => {
    try {
      localStorage.setItem("pharma_crm_stock_requests", JSON.stringify(requests));
    } catch (e) {
      // Ignore storage access errors in sandboxed preview
    }
  }, [requests]);

  // UI States
  const [activeTab, setActiveTab] = useState<"list" | "aggregated">("list");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Pagination states
  const [currentPageList, setCurrentPageList] = useState(1);
  const [currentPageAggregated, setCurrentPageAggregated] = useState(1);
  const itemsPerPage = 5;

  // Reset pagination on search, filter, or tab change
  useEffect(() => {
    setCurrentPageList(1);
    setCurrentPageAggregated(1);
  }, [searchTerm, statusFilter, activeTab]);

  const [liveRequests, setLiveRequests] = useState<StockRequest[]>([]);

  useEffect(() => {
    const unsub = listenCollection<any>("stockRequests", (docs) => {
      const mapped: StockRequest[] = docs.map((doc) => {
        const pharm = pharmacies.find(p => p.id === doc.pharmacyId);
        return {
          id: doc.id || doc.stockRequestId,
          displayNumber: doc.displayNumber || doc.stockRequestDisplayNumber || undefined,
          pharmacyName: pharm?.name || doc.pharmacyName || doc.pharmacyId || "Pharmacy",
          productName: doc.productName || "Product",
          brand: doc.brand || "OTHERS",
          quantity: doc.requestedQty || doc.unfulfilledQty || doc.quantity || 1,
          date: doc.createdAt ? doc.createdAt.substring(0, 10) : new Date().toISOString().substring(0, 10),
          status: (doc.status === "PENDING_INVENTORY_VALIDATION" || doc.status === "PENDING" || doc.status === "Pending") 
            ? "Pending" 
            : (doc.status === "FULFILLED" || doc.status === "Fulfilled") 
            ? "Fulfilled" 
            : (doc.status === "REJECTED" || doc.status === "Rejected") 
            ? "Rejected" 
            : "In Transit"
        };
      });
      setLiveRequests(mapped);
    });
    return () => unsub();
  }, [pharmacies]);

  const allRequests = useMemo(() => {
    const liveIds = new Set(liveRequests.map(r => r.id));
    const localOnly = requests.filter(r => !liveIds.has(r.id));
    return [...liveRequests, ...localOnly];
  }, [liveRequests, requests]);

  // Form State
  const [formPharmacyId, setFormPharmacyId] = useState("");
  const [formProductId, setFormProductId] = useState("");
  const [formQuantity, setFormQuantity] = useState(1);

  // Stats calculation
  const totalRequests = allRequests.length;
  const pendingRequests = allRequests.filter(r => r.status === "Pending").length;
  const inTransitRequests = allRequests.filter(r => r.status === "In Transit").length;
  const fulfilledRequests = allRequests.filter(r => r.status === "Fulfilled").length;

  // Search & Filter List
  const filteredRequests = allRequests.filter(r => {
    const matchesSearch = r.pharmacyName.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          r.productName.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === "All" || r.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  // Pagination for Requests List
  const totalPagesList = Math.ceil(filteredRequests.length / itemsPerPage) || 1;
  const paginatedRequests = filteredRequests.slice(
    (currentPageList - 1) * itemsPerPage,
    currentPageList * itemsPerPage
  );
  const startIdxList = filteredRequests.length > 0 ? (currentPageList - 1) * itemsPerPage + 1 : 0;
  const endIdxList = Math.min(currentPageList * itemsPerPage, filteredRequests.length);

  // Calculate Aggregated Demand dynamically
  const aggregatedDemand = React.useMemo(() => {
    const agg: Record<string, {
      product: string;
      brand: string;
      totalQty: number;
      uniquePharmacies: Set<string>;
      requestsCount: number;
      pendingQty: number;
      approvedQty: number;
    }> = {};

    allRequests.forEach(r => {
      if (!agg[r.productName]) {
        agg[r.productName] = {
          product: r.productName,
          brand: r.brand || "OTHERS",
          totalQty: 0,
          uniquePharmacies: new Set<string>(),
          requestsCount: 0,
          pendingQty: 0,
          approvedQty: 0
        };
      }

      agg[r.productName].totalQty += r.quantity;
      agg[r.productName].uniquePharmacies.add(r.pharmacyName);
      agg[r.productName].requestsCount += 1;
      
      if (r.status === "Pending") {
        agg[r.productName].pendingQty += r.quantity;
      } else if (r.status === "Fulfilled" || r.status === "In Transit") {
        agg[r.productName].approvedQty += r.quantity;
      }
    });

    return Object.values(agg).sort((a, b) => b.totalQty - a.totalQty);
  }, [allRequests]);

  const filteredAggregated = aggregatedDemand.filter(item => 
    item.product.toLowerCase().includes(searchTerm.toLowerCase()) || 
    item.brand.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Pagination for Aggregated Demand
  const totalPagesAggregated = Math.ceil(filteredAggregated.length / itemsPerPage) || 1;
  const paginatedAggregated = filteredAggregated.slice(
    (currentPageAggregated - 1) * itemsPerPage,
    currentPageAggregated * itemsPerPage
  );
  const startIdxAggregated = filteredAggregated.length > 0 ? (currentPageAggregated - 1) * itemsPerPage + 1 : 0;
  const endIdxAggregated = Math.min(currentPageAggregated * itemsPerPage, filteredAggregated.length);

  // Actions
  const handleApprove = (id: string) => {
    setRequests(requests.map(r => r.id === id ? { ...r, status: "Fulfilled" } : r));
  };

  const handleReject = (id: string) => {
    if (confirm(isRtl ? "هل أنت متأكد من رفض طلب المخزون هذا؟" : "Are you sure you want to reject this stock request?")) {
      setRequests(requests.map(r => r.id === id ? { ...r, status: "Rejected" } : r));
    }
  };

  const handleOpenModal = () => {
    setFormPharmacyId(pharmacies[0]?.id || "");
    setFormProductId(products[0]?.id || "");
    setFormQuantity(1);
    setIsModalOpen(true);
  };

  const handleCreateRequest = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formPharmacyId || !formProductId || formQuantity <= 0) return;

    const selectedPharmacy = pharmacies.find(p => p.id === formPharmacyId);
    const selectedProduct = products.find(p => p.id === formProductId);

    if (!selectedPharmacy || !selectedProduct) return;

    const newReq: StockRequest = {
      id: `REQ-${Date.now().toString().slice(-3)}`,
      pharmacyName: selectedPharmacy.name,
      productName: selectedProduct.name,
      brand: selectedProduct.brand || "OTHERS",
      quantity: formQuantity,
      date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
      status: "Pending"
    };

    setRequests([newReq, ...requests]);
    setIsModalOpen(false);
  };

  const handleExportCSV = () => {
    const headers = ["ID", "Pharmacy", "Product", "Brand", "Quantity", "Date", "Status"];
    const rows = requests.map(r => [r.id, r.pharmacyName, r.productName, r.brand, r.quantity, r.date, r.status]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `pharma_crm_stock_requests_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const translations = {
    title: isRtl ? "طلبات تغذية المخزون" : "Stock Requests",
    subtitle: isRtl ? "إدارة وتوزيع مخزون الأدوية في الصيدليات والأقاليم الطبية" : "Manage product stock requests and fulfillment",
    totalRequests: isRtl ? "إجمالي الطلبات" : "Total Requests",
    pending: isRtl ? "قيد المراجعة" : "Pending",
    inTransit: isRtl ? "قيد الشحن" : "In Transit",
    fulfilled: isRtl ? "مكتملة وموزعة" : "Fulfilled",
    allRequestsTab: isRtl ? "جميع الطلبات" : "All Requests",
    aggregatedTab: isRtl ? "الطلب المجمع" : "Aggregated Demand",
    newBtn: isRtl ? "طلب مخزون جديد" : "New Request",
    exportBtn: isRtl ? "تصدير" : "Export",
    searchPlaceholder: isRtl ? "بحث باسم المنتج أو الصيدلية..." : "Search",
    filterAll: isRtl ? "الكل" : "All",
    pharmacy: isRtl ? "الصيدلية" : "Pharmacy",
    product: isRtl ? "المنتج الطبي" : "Product",
    qty: isRtl ? "الكمية المطلوبة" : "Quantity",
    date: isRtl ? "التاريخ" : "Date",
    status: isRtl ? "الحالة" : "Status",
    actions: isRtl ? "إجراءات" : "Actions",
    approve: isRtl ? "اعتماد وتوريد" : "Approve",
    reject: isRtl ? "رفض الطلب" : "Reject",
    brand: isRtl ? "العلامة / الفئة" : "Brand",
    totalQty: isRtl ? "إجمالي الكمية" : "Total Qty",
    pharmaciesCount: isRtl ? "عدد الصيدليات" : "Pharmacies",
    requestsCount: isRtl ? "عدد الطلبات" : "Requests",
    pendingQty: isRtl ? "الكمية المعلقة" : "Pending Qty",
    approvedQty: isRtl ? "الكمية المعتمدة" : "Approved Qty",
    noRequests: isRtl ? "لا توجد طلبات تغذية مخزون" : "No stock requests found",
    addTitle: isRtl ? "طلب تغذية مخزون جديد" : "New Stock Request",
    cancel: isRtl ? "إلغاء" : "Cancel",
    submit: isRtl ? "إرسال الطلب الميداني" : "Submit Request"
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Package className="h-6 w-6 text-indigo-600" />
            {translations.title}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {translations.subtitle}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-1.5 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 px-3.5 py-2 rounded-xl text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <Download className="h-4 w-4" />
            {translations.exportBtn}
          </button>
          <button
            onClick={handleOpenModal}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors shadow-sm cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            {translations.newBtn}
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Requests */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 flex items-center gap-4 shadow-xs">
          <div className="p-3 bg-indigo-50 dark:bg-indigo-950/40 rounded-xl text-indigo-600">
            <Package className="h-6 w-6" />
          </div>
          <div>
            <div className="text-2xl font-bold text-slate-900 dark:text-white">{totalRequests}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">{translations.totalRequests}</div>
          </div>
        </div>

        {/* Pending Requests */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 flex items-center gap-4 shadow-xs">
          <div className="p-3 bg-amber-50 dark:bg-amber-950/40 rounded-xl text-amber-600">
            <Clock className="h-6 w-6" />
          </div>
          <div>
            <div className="text-2xl font-bold text-slate-900 dark:text-white">{pendingRequests}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">{translations.pending}</div>
          </div>
        </div>

        {/* In Transit Requests */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 flex items-center gap-4 shadow-xs">
          <div className="p-3 bg-blue-50 dark:bg-blue-950/40 rounded-xl text-blue-600">
            <Truck className="h-6 w-6" />
          </div>
          <div>
            <div className="text-2xl font-bold text-slate-900 dark:text-white">{inTransitRequests}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">{translations.inTransit}</div>
          </div>
        </div>

        {/* Fulfilled Requests */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 flex items-center gap-4 shadow-xs">
          <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 rounded-xl text-emerald-600">
            <CheckCircle className="h-6 w-6" />
          </div>
          <div>
            <div className="text-2xl font-bold text-slate-900 dark:text-white">{fulfilledRequests}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">{translations.fulfilled}</div>
          </div>
        </div>
      </div>

      {/* Tab controls */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 gap-6">
        <button
          onClick={() => setActiveTab("list")}
          className={`pb-3 flex items-center gap-2 text-sm font-medium transition-colors border-b-2 cursor-pointer ${
            activeTab === "list"
              ? "border-indigo-600 text-indigo-600"
              : "border-transparent text-slate-500 hover:text-slate-950 dark:text-slate-400"
          }`}
        >
          <Package className="h-4 w-4" />
          {translations.allRequestsTab}
        </button>
        <button
          onClick={() => setActiveTab("aggregated")}
          className={`pb-3 flex items-center gap-2 text-sm font-medium transition-colors border-b-2 cursor-pointer ${
            activeTab === "aggregated"
              ? "border-indigo-600 text-indigo-600"
              : "border-transparent text-slate-500 hover:text-slate-950 dark:text-slate-400"
          }`}
        >
          <BarChart2 className="h-4 w-4" />
          {translations.aggregatedTab}
        </button>
      </div>

      {/* Main Container card */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs">
        {/* Controls bar */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="flex items-center gap-2">
            {activeTab === "list" ? (
              <>
                <Package className="h-5 w-5 text-indigo-600" />
                <span className="font-semibold text-slate-900 dark:text-white">{translations.allRequestsTab}</span>
              </>
            ) : (
              <>
                <BarChart2 className="h-5 w-5 text-indigo-600" />
                <span className="font-semibold text-slate-900 dark:text-white">{translations.aggregatedTab}</span>
              </>
            )}
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            {/* Search */}
            <div className="relative w-full sm:w-60">
              <Search className={`absolute top-2.5 h-4 w-4 text-slate-400 ${isRtl ? "right-3" : "left-3"}`} />
              <input
                type="text"
                placeholder={translations.searchPlaceholder}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className={`pl-9 pr-4 py-1.5 w-full border border-slate-200 dark:border-slate-800 rounded-xl text-sm bg-slate-50 dark:bg-slate-950 focus:outline-none focus:ring-1 focus:ring-indigo-600 dark:text-white ${isRtl ? "pl-4 pr-9 text-right" : ""}`}
              />
            </div>

            {/* Filter (only on list tab) */}
            {activeTab === "list" && (
              <div className="flex items-center gap-2 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-1.5 bg-slate-50 dark:bg-slate-950">
                <Filter className="h-4 w-4 text-slate-400" />
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="bg-transparent text-sm text-slate-700 dark:text-slate-300 focus:outline-none pr-6 cursor-pointer"
                >
                  <option value="All">{translations.filterAll}</option>
                  <option value="Pending">Pending</option>
                  <option value="In Transit">In Transit</option>
                  <option value="Fulfilled">Fulfilled</option>
                  <option value="Rejected">Rejected</option>
                </select>
              </div>
            )}
          </div>
        </div>

        {/* Table Content */}
        {activeTab === "list" ? (
          /* ALL REQUESTS TAB TABLE */
          filteredRequests.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              <AlertCircle className="mx-auto h-12 w-12 text-slate-300 dark:text-slate-700 mb-3" />
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{translations.noRequests}</h3>
            </div>
          ) : (
            <>
              <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-950/40 text-xs font-semibold text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800 uppercase tracking-wider">
                    <th className="py-3.5 px-4">{translations.pharmacy}</th>
                    <th className="py-3.5 px-4">{translations.product}</th>
                    <th className="py-3.5 px-4 text-center">{translations.qty}</th>
                    <th className="py-3.5 px-4">{translations.date}</th>
                    <th className="py-3.5 px-4">{translations.status}</th>
                    <th className="py-3.5 px-4 text-center">{translations.actions}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-sm">
                  {paginatedRequests.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/20">
                      <td className="py-4 px-4 font-semibold text-slate-900 dark:text-white">
                        {r.pharmacyName}
                      </td>
                      <td className="py-4 px-4 text-slate-700 dark:text-slate-300 font-medium">
                        {r.productName}
                      </td>
                      <td className="py-4 px-4 text-center font-bold text-slate-900 dark:text-white">
                        {r.quantity}
                      </td>
                      <td className="py-4 px-4 text-xs text-slate-500 dark:text-slate-400">
                        {r.date}
                      </td>
                      <td className="py-4 px-4">
                        <span className={`inline-flex items-center rounded-md px-2.5 py-0.5 text-xs font-semibold ${
                          r.status === "Fulfilled"
                            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                            : r.status === "Rejected"
                            ? "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400"
                            : r.status === "In Transit"
                            ? "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400"
                            : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
                        }`}>
                          {r.status}
                        </span>
                      </td>
                      <td className="py-4 px-4 text-center">
                        {r.status === "Pending" ? (
                          <div className="flex items-center justify-center gap-4">
                            <button
                              onClick={() => handleApprove(r.id)}
                              className="text-indigo-600 hover:text-indigo-800 font-semibold text-xs cursor-pointer hover:underline"
                            >
                              {translations.approve}
                            </button>
                            <button
                              onClick={() => handleReject(r.id)}
                              className="text-rose-600 hover:text-rose-800 font-semibold text-xs cursor-pointer hover:underline"
                            >
                              {translations.reject}
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400 italic">No actions</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {paginatedRequests.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-slate-400 dark:text-slate-500">
                        <Package className="h-8 w-8 mx-auto mb-2 opacity-40 text-slate-400" />
                        <p className="text-xs font-semibold">{isRtl ? "لا توجد طلبات مخزنية حالياً." : "No stock requests currently."}</p>
                        <p className="text-[10px] opacity-75 mt-0.5">{isRtl ? "اضغط على زر 'إنشاء طلب جديد' للبدء." : "Click 'Create New Request' to get started."}</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards View */}
            <div className="block md:hidden space-y-4 p-4 border-t border-slate-100 dark:border-slate-800">
              {paginatedRequests.map((r) => (
                <div 
                  key={r.id} 
                  className="bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-800 rounded-xl p-4 shadow-xxs space-y-3 animate-fade-in"
                >
                  <div className="flex justify-between items-start gap-2">
                    <span className="font-mono text-xs font-bold text-indigo-600 dark:text-indigo-400">{r.displayNumber || "Legacy Record — Number Not Assigned"}</span>
                    <span className="text-[10px] text-slate-400 font-mono">{r.date}</span>
                  </div>

                  <div className="space-y-1">
                    <h4 className="font-semibold text-xs text-slate-900 dark:text-white line-clamp-2">{r.pharmacyName}</h4>
                    <p className="text-xxs font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1">
                      <Package className="h-3 w-3 text-slate-400" />
                      <span>{r.productName}</span>
                    </p>
                    {r.brand && (
                      <span className="inline-flex items-center rounded bg-slate-50 dark:bg-slate-950/60 text-[9px] font-semibold text-slate-500 dark:text-slate-400 px-1.5 py-0.5">
                        {r.brand}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-50 dark:border-slate-800/50">
                    <div className="flex items-center gap-1">
                      <span className="text-xxs text-slate-400 font-semibold">
                        {isRtl ? "الكمية:" : "Qty:"}
                      </span>
                      <span className="inline-flex items-center justify-center bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 font-bold text-xs px-2.5 py-0.5 rounded">
                        {r.quantity}
                      </span>
                    </div>

                    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold ${
                      r.status === "Fulfilled"
                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                        : r.status === "Rejected"
                        ? "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400"
                        : r.status === "In Transit"
                        ? "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400"
                        : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
                    }`}>
                      {r.status}
                    </span>
                  </div>

                  {r.status === "Pending" && (
                    <div className="flex items-center justify-end gap-3 pt-2.5 border-t border-slate-50 dark:border-slate-800/50">
                      <button
                        onClick={() => handleReject(r.id)}
                        className="p-1.5 px-3 border border-rose-200 dark:border-rose-950/40 text-rose-600 bg-rose-50/50 dark:bg-rose-950/20 hover:bg-rose-600 hover:text-white rounded-lg transition-colors cursor-pointer flex items-center gap-1 text-[10px] font-bold"
                      >
                        <X className="h-3.5 w-3.5" />
                        <span>{translations.reject}</span>
                      </button>

                      <button
                        onClick={() => handleApprove(r.id)}
                        className="p-1.5 px-3 border border-emerald-200 dark:border-emerald-950/40 text-emerald-600 bg-emerald-50/50 dark:bg-emerald-950/20 hover:bg-emerald-600 hover:text-white rounded-lg transition-colors cursor-pointer flex items-center gap-1 text-[10px] font-bold"
                      >
                        <Check className="h-3.5 w-3.5" />
                        <span>{translations.approve}</span>
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {paginatedRequests.length === 0 && (
                <div className="py-12 text-center text-slate-400 dark:text-slate-500">
                  <Package className="h-8 w-8 mx-auto mb-2 opacity-40 text-slate-400" />
                  <p className="text-xs font-semibold">{isRtl ? "لا توجد طلبات مخزنية حالياً." : "No stock requests currently."}</p>
                  <p className="text-[10px] opacity-75 mt-0.5">{isRtl ? "اضغط على زر 'إنشاء طلب جديد' للبدء." : "Click 'Create New Request' to get started."}</p>
                </div>
              )}
            </div>

            {/* Pagination Controls */}
            {totalPagesList > 1 && (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/20 dark:bg-slate-950/20" id="requests-list-pagination">
                <p className="text-xxs text-slate-400 font-mono">
                  {isRtl 
                    ? `عرض ${startIdxList} إلى ${endIdxList} من ${filteredRequests.length} طلبات`
                    : `Showing ${startIdxList} to ${endIdxList} of ${filteredRequests.length} requests`
                  }
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCurrentPageList(prev => Math.max(prev - 1, 1))}
                    disabled={currentPageList === 1}
                    className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-500 disabled:opacity-40 transition-opacity hover:bg-slate-50 cursor-pointer text-xs flex items-center gap-1 px-3"
                  >
                    <ChevronLeft size={14} />
                    {isRtl ? "السابق" : "Previous"}
                  </button>
                  <span className="text-xxs font-mono font-bold text-slate-600 dark:text-slate-300">
                    {isRtl 
                      ? `صفحة ${currentPageList} من ${totalPagesList}`
                      : `Page ${currentPageList} of ${totalPagesList}`
                    }
                  </span>
                  <button
                    onClick={() => setCurrentPageList(prev => Math.min(prev + 1, totalPagesList))}
                    disabled={currentPageList === totalPagesList}
                    className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-500 disabled:opacity-40 transition-opacity hover:bg-slate-50 cursor-pointer text-xs flex items-center gap-1 px-3"
                  >
                    {isRtl ? "التالي" : "Next"}
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}
          </>
          )
        ) : (
          /* AGGREGATED DEMAND TAB TABLE */
          filteredAggregated.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              <BarChart2 className="mx-auto h-12 w-12 text-slate-300 dark:text-slate-700 mb-3" />
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{translations.noRequests}</h3>
            </div>
          ) : (
            <>
              <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-950/40 text-xs font-semibold text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800 uppercase tracking-wider">
                    <th className="py-3.5 px-4">{translations.product}</th>
                    <th className="py-3.5 px-4">{translations.brand}</th>
                    <th className="py-3.5 px-4 text-center">{translations.totalQty}</th>
                    <th className="py-3.5 px-4 text-center">{translations.pharmaciesCount}</th>
                    <th className="py-3.5 px-4 text-center">{translations.requestsCount}</th>
                    <th className="py-3.5 px-4 text-center">{translations.pendingQty}</th>
                    <th className="py-3.5 px-4 text-center">{translations.approvedQty}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-sm">
                  {paginatedAggregated.map((item, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/20">
                      <td className="py-4 px-4 font-semibold text-slate-900 dark:text-white">
                        {item.product}
                      </td>
                      <td className="py-4 px-4 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        {item.brand}
                      </td>
                      <td className="py-4 px-4 text-center">
                        <span className="inline-flex items-center justify-center bg-blue-600 text-white font-bold text-xs px-2.5 py-1 rounded-md min-w-[32px]">
                          {item.totalQty}
                        </span>
                      </td>
                      <td className="py-4 px-4 text-center">
                        <div className="flex items-center justify-center gap-1 text-slate-700 dark:text-slate-300">
                          <Store className="h-3.5 w-3.5 text-slate-400" />
                          <span className="font-semibold">{item.uniquePharmacies.size}</span>
                        </div>
                      </td>
                      <td className="py-4 px-4 text-center font-semibold text-slate-700 dark:text-slate-300">
                        {item.requestsCount}
                      </td>
                      <td className="py-4 px-4 text-center bg-slate-50/30 dark:bg-slate-950/10 font-bold text-amber-600">
                        {item.pendingQty}
                      </td>
                      <td className="py-4 px-4 text-center font-bold text-emerald-600">
                        {item.approvedQty}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards View */}
            <div className="block md:hidden space-y-4 p-4 border-t border-slate-100 dark:border-slate-800">
              {paginatedAggregated.map((item, idx) => (
                <div 
                  key={idx} 
                  className="bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-800 rounded-xl p-4 shadow-xxs space-y-3 animate-fade-in"
                >
                  <div className="flex justify-between items-start gap-2">
                    <h4 className="font-bold text-xs text-slate-900 dark:text-white line-clamp-2">{item.product}</h4>
                    <span className="inline-flex items-center rounded bg-slate-50 dark:bg-slate-950/60 text-[9px] font-semibold text-slate-500 dark:text-slate-400 px-1.5 py-0.5">
                      {item.brand}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2.5 pt-2 border-t border-slate-50 dark:border-slate-800/50 text-[10px]">
                    <div>
                      <span className="text-slate-400 block font-semibold mb-0.5">
                        {isRtl ? "إجمالي الكمية" : "Total Qty"}
                      </span>
                      <span className="inline-flex items-center justify-center bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 font-bold px-2 py-0.5 rounded">
                        {item.totalQty}
                      </span>
                    </div>

                    <div>
                      <span className="text-slate-400 block font-semibold mb-0.5">
                        {isRtl ? "الصيدليات" : "Pharmacies"}
                      </span>
                      <span className="font-bold text-slate-800 dark:text-slate-300">
                        {item.uniquePharmacies.size}
                      </span>
                    </div>

                    <div>
                      <span className="text-slate-400 block font-semibold mb-0.5">
                        {isRtl ? "الطلبات" : "Requests"}
                      </span>
                      <span className="font-bold text-slate-800 dark:text-slate-300">
                        {item.requestsCount}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5 pt-2 border-t border-slate-50 dark:border-slate-800/50 text-[10px]">
                    <div>
                      <span className="text-slate-400 block font-semibold mb-0.5">
                        {isRtl ? "قيد الانتظار" : "Pending Qty"}
                      </span>
                      <span className="font-bold text-amber-600">
                        {item.pendingQty}
                      </span>
                    </div>

                    <div>
                      <span className="text-slate-400 block font-semibold mb-0.5">
                        {isRtl ? "المعتمد" : "Approved Qty"}
                      </span>
                      <span className="font-bold text-emerald-600">
                        {item.approvedQty}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination Controls */}
            {totalPagesAggregated > 1 && (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/20 dark:bg-slate-950/20" id="aggregated-pagination">
                <p className="text-xxs text-slate-400 font-mono">
                  {isRtl 
                    ? `عرض ${startIdxAggregated} إلى ${endIdxAggregated} من ${filteredAggregated.length} منتجات`
                    : `Showing ${startIdxAggregated} to ${endIdxAggregated} of ${filteredAggregated.length} products`
                  }
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCurrentPageAggregated(prev => Math.max(prev - 1, 1))}
                    disabled={currentPageAggregated === 1}
                    className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-500 disabled:opacity-40 transition-opacity hover:bg-slate-50 cursor-pointer text-xs flex items-center gap-1 px-3"
                  >
                    <ChevronLeft size={14} />
                    {isRtl ? "السابق" : "Previous"}
                  </button>
                  <span className="text-xxs font-mono font-bold text-slate-600 dark:text-slate-300">
                    {isRtl 
                      ? `صفحة ${currentPageAggregated} من ${totalPagesAggregated}`
                      : `Page ${currentPageAggregated} of ${totalPagesAggregated}`
                    }
                  </span>
                  <button
                    onClick={() => setCurrentPageAggregated(prev => Math.min(prev + 1, totalPagesAggregated))}
                    disabled={currentPageAggregated === totalPagesAggregated}
                    className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-500 disabled:opacity-40 transition-opacity hover:bg-slate-50 cursor-pointer text-xs flex items-center gap-1 px-3"
                  >
                    {isRtl ? "التالي" : "Next"}
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}
          </>
          )
        )}
      </div>

      {/* New Request Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full shadow-2xl animate-fade-in">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Package className="h-5 w-5 text-indigo-600" />
                {translations.addTitle}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-500 hover:text-slate-800 dark:hover:text-white transition-colors cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleCreateRequest} className="p-6 space-y-4">
              {/* Pharmacy */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {translations.pharmacy}
                </label>
                <select
                  value={formPharmacyId}
                  onChange={(e) => setFormPharmacyId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-indigo-600 dark:text-white cursor-pointer"
                >
                  {pharmacies.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              {/* Product */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {translations.product}
                </label>
                <select
                  value={formProductId}
                  onChange={(e) => setFormProductId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-indigo-600 dark:text-white cursor-pointer"
                >
                  {products.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              {/* Quantity */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {translations.qty}
                </label>
                <input
                  type="number"
                  min="1"
                  required
                  value={formQuantity}
                  onChange={(e) => setFormQuantity(parseInt(e.target.value) || 1)}
                  className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-indigo-600 dark:text-white"
                />
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 border border-slate-200 dark:border-slate-800 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  {translations.cancel}
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-medium cursor-pointer"
                >
                  {translations.submit}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
