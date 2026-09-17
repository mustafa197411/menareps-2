import React, { useState, useEffect } from "react";
import { Plus, Search, Filter, Trash2, Edit2, Check, Download, AlertCircle, RefreshCw, X } from "lucide-react";
import { LegacySampleAllocation, SampleAllocation as CanonicalSampleAllocation, SampleApproval, SampleRequest, SampleSku, User, Role, Permissions, Product } from "../../types";
import { collection, getDoc, getDocs, onSnapshot, doc, setDoc, deleteDoc, query, where } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { decorateRecord } from "../../lib/firebaseSync";
import { filterSampleAllocationsByAuthorizedRepIds, getAuthorizedSampleBalanceUserIds, getSampleDataScope, hasSampleCapability } from "../../lib/sampleAuthorization";
import { allocateSampleStock } from "../../lib/sampleMutationClient";
import { buildApprovedRequestQueue } from "../../lib/sampleRequestLifecycleService";
import { filterSampleAllocationRows, resolveSampleAllocationDisplay, type SampleAllocationDisplayRow } from "../../lib/sampleAllocationDisplay";
import { saveAuditLogRecord } from "../../lib/firestoreService";
import { fetchScopedSampleCollection, subscribeToScopedSampleCollection } from "../../lib/sampleScopeClient";

interface SampleAllocationProps {
  currentUser: User;
  users: User[];
  products: Product[];
  permissions?: Permissions;
  lang: "en" | "ar";
  profileLoaded?: boolean;
}


const mockAllocations: LegacySampleAllocation[] = [
  {
    id: "AL001",
    repId: "U02",
    repName: "Omar Al-Fares",
    productId: "PROD01",
    productName: "CardioMax 10mg",
    brand: "CardioMax",
    allocatedQuantity: 100,
    distributedQuantity: 45,
    remainingQuantity: 55,
    month: "2026-06",
    region: "Amman"
  },
  {
    id: "AL002",
    repId: "U02",
    repName: "Omar Al-Fares",
    productId: "PROD03",
    productName: "KidVits Chewable",
    brand: "KidVits",
    allocatedQuantity: 200,
    distributedQuantity: 120,
    remainingQuantity: 80,
    month: "2026-06",
    region: "Amman"
  },
  {
    id: "AL003",
    repId: "U03",
    repName: "Lina Al-Hassan",
    productId: "PROD01",
    productName: "CardioMax 10mg",
    brand: "CardioMax",
    allocatedQuantity: 150,
    distributedQuantity: 60,
    remainingQuantity: 90,
    month: "2026-06",
    region: "Tripoli"
  },
  {
    id: "AL004",
    repId: "U03",
    repName: "Lina Al-Hassan",
    productId: "PROD04",
    productName: "OrthoFlex Gel",
    brand: "OrthoFlex",
    allocatedQuantity: 80,
    distributedQuantity: 30,
    remainingQuantity: 50,
    month: "2026-06",
    region: "Tripoli"
  },
  {
    id: "AL005",
    repId: "U05",
    repName: "Ahmad Al-Jamil",
    productId: "PROD02",
    productName: "CardioMax 20mg",
    brand: "CardioMax",
    allocatedQuantity: 120,
    distributedQuantity: 50,
    remainingQuantity: 70,
    month: "2026-06",
    region: "Riyadh"
  }
];

const CURRENT_REPORTING_MONTH = new Date().toISOString().slice(0, 7);

export default function SampleAllocationManager({ currentUser, users, products, permissions, lang, profileLoaded }: SampleAllocationProps) {
  const isRtl = lang === "ar";
  
  // Real-time Firestore States
  const [allocations, setAllocations] = useState<SampleAllocationDisplayRow[]>([]);
  const [rawAllocations, setRawAllocations] = useState<LegacySampleAllocation[]>([]);
  const [reps, setReps] = useState<{ id: string; name: string; region: string }[]>([]);
  const [productsList, setProductsList] = useState<SampleSku[]>([]);
  const [centralInventory, setCentralInventory] = useState<any[]>([]);
  const [approvedRequests, setApprovedRequests] = useState<Array<{ request: SampleRequest; approval: SampleApproval; remaining: number }>>([]);
  const [allocationIdempotencyKey, setAllocationIdempotencyKey] = useState("");
  const [bulkIdempotencyKey, setBulkIdempotencyKey] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  // Search/Filter state
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedRegion, setSelectedRegion] = useState("all");
  const [selectedProduct, setSelectedProduct] = useState("all");
  const [selectedMonth, setSelectedMonth] = useState(CURRENT_REPORTING_MONTH);

  // Form State
  const [showAddModal, setShowAddModal] = useState(false);
  const [formRepId, setFormRepId] = useState("");
  const [formProductId, setFormProductId] = useState("");
  const [formAllocatedQty, setFormAllocatedQty] = useState<number | "">("");
  const setFormQty = (value: string) => setFormAllocatedQty(value === "" ? "" : Number(value));
  const [formMonth, setFormMonth] = useState(CURRENT_REPORTING_MONTH);
  const [formError, setFormError] = useState("");
  const [operationNotice, setOperationNotice] = useState<{ kind: "success" | "warning"; message: string } | null>(null);
  const [allocationSource, setAllocationSource] = useState<"DIRECT" | "REQUEST">("DIRECT");
  const [formRequestId, setFormRequestId] = useState("");

  // Bulk Allocation Form State
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkRepId, setBulkRepId] = useState("");
  const [bulkFilterBrand, setBulkFilterBrand] = useState("all");
  const [bulkSelectedProductIds, setBulkSelectedProductIds] = useState<string[]>([]);
  const [bulkQty, setBulkQty] = useState<number | "">("");
  const [bulkMonth, setBulkMonth] = useState(CURRENT_REPORTING_MONTH);
  const [bulkError, setBulkError] = useState("");

  // Firestore Listeners Setup
  useEffect(() => {
    if (!profileLoaded || !currentUser) return;
    setIsLoading(true);

    // 1. Listen allocations
    const capability = hasSampleCapability(currentUser, "VIEW_TEAM_SAMPLE_BALANCE", permissions) ? "VIEW_TEAM_SAMPLE_BALANCE" : "VIEW_OWN_SAMPLE_BALANCE";
    const scope = getSampleDataScope(currentUser, capability, permissions);
    const authorizedIds = getAuthorizedSampleBalanceUserIds(currentUser, users, scope);
    const unsubAlloc = subscribeToScopedSampleCollection(db, "sampleAllocations", scope, authorizedIds, (docs) => {
      const items: LegacySampleAllocation[] = [];
      docs.forEach((doc) => {
        const data = doc.data();
        if (!data.isDeleted) {
          items.push({
            id: doc.id,
            ...data,
            allocatedQuantity: data.quantityAllocated ?? data.allocatedQuantity ?? 0,
            distributedQuantity: data.quantityDistributed ?? data.distributedQuantity ?? 0,
            remainingQuantity: data.quantityRemaining ?? data.remainingQuantity ?? 0,
            productName: data.productName || data.sampleSkuId || data.productId || "—",
            brand: data.brand || data.sampleSkuId || "—",
            month: data.reportingMonth || data.month || "—",
            region: data.region || "—"
          } as LegacySampleAllocation);
        }
      });
      setRawAllocations(items);
      setIsLoading(false);
    }, (err) => {
      console.error("Error listening to sampleAllocations:", err);
    });
    console.info("SAFE LISTENER STARTED: sampleAllocations");

    // 2. Listen canonical Sample SKUs, never commercial Product stock.
    const unsubProducts = onSnapshot(collection(db, "sampleCatalog"), (snap) => {
      const items: SampleSku[] = [];
      snap.forEach((doc) => {
        const data = doc.data();
        if (!data.isDeleted) {
          items.push({ id: doc.id, ...data } as SampleSku);
        }
      });
      setProductsList(items);
    });

    const canManageAllocationQueue = scope !== "NONE" && hasSampleCapability(currentUser, "ALLOCATE_SAMPLE_STOCK", permissions);
    const unsubInventory = canManageAllocationQueue
      ? onSnapshot(collection(db, "sampleInventory"), snap => setCentralInventory(snap.docs.map(item => ({ id: item.id, ...item.data() }))))
      : () => undefined;
    const unsubRequests = canManageAllocationQueue ? subscribeToScopedSampleCollection(db, "sampleRequests", scope, authorizedIds, async docs => {
      const requests = docs.map(item => ({ id: item.id, ...item.data() } as SampleRequest)).filter(item => ["AWAITING_ALLOCATION", "PARTIALLY_ALLOCATED"].includes(item.status));
      const approvalDocs = await Promise.all(requests.map(item => item.approvalId ? getDoc(doc(db, "sampleApprovals", item.approvalId)) : Promise.resolve(null)));
      const approvalItems = approvalDocs.filter((item): item is NonNullable<typeof item> => Boolean(item?.exists())).map(item => ({ id: item.id, ...item.data() } as SampleApproval));
      const allocationDocs = await fetchScopedSampleCollection(db, "sampleAllocations", scope, authorizedIds);
      const allocationItems = allocationDocs.map(item => ({ id: item.id, ...item.data() } as CanonicalSampleAllocation));
      setApprovedRequests(buildApprovedRequestQueue(requests, approvalItems, allocationItems).map(item => ({ request: item.request, approval: item.approval, remaining: item.remainingApproved })));
    }) : () => undefined;

    // 3. Listen reps (users with representative roles)
    setReps(users.filter(user => !user.isDeleted && (user.role === Role.MEDICAL_REP || user.role === Role.SALES_REP))
      .map(user => ({ id: user.id, name: user.name, region: user.region || "" })));
    const unsubUsers = () => undefined;

    return () => {
      unsubAlloc();
      unsubProducts();
      unsubInventory();
      unsubRequests();
      unsubUsers();
    };
  }, [profileLoaded, currentUser, users, permissions]);

  // Filter/Security Scoping Effect
  useEffect(() => {
    const capability = hasSampleCapability(currentUser, "VIEW_TEAM_SAMPLE_BALANCE", permissions) ? "VIEW_TEAM_SAMPLE_BALANCE" : "VIEW_OWN_SAMPLE_BALANCE";
    const scope = getSampleDataScope(currentUser, capability, permissions);
    const authorizedIds = getAuthorizedSampleBalanceUserIds(currentUser, users, scope);
    const secured = filterSampleAllocationsByAuthorizedRepIds(rawAllocations, authorizedIds, scope);
    setAllocations(secured.map(item => resolveSampleAllocationDisplay(item as unknown as CanonicalSampleAllocation & Record<string, unknown>, users, productsList, products)));
  }, [rawAllocations, currentUser, users, productsList, products, permissions]);


  const t = {
    en: {
      title: "Sample Allocation Manager",
      subtitle: "Set, track, and manage monthly sample quotas for medical representatives",
      searchPlaceholder: "Search representative or product...",
      allRegions: "All Regions",
      allProducts: "All Products",
      month: "Month",
      rep: "Representative",
      product: "Product",
      brand: "Brand",
      allocated: "Allocated Qty",
      distributed: "Distributed Qty",
      remaining: "Remaining Qty",
      region: "Region",
      actions: "Actions",
      addAllocation: "New Allocation",
      modalTitle: "Create Sample Allocation",
      selectRep: "Select Representative",
      selectProduct: "Select Product",
      allocatedQtyLabel: "Allocated Quota Quantity",
      save: "Save Allocation",
      cancel: "Cancel",
      totalAllocated: "Total Quota Assigned",
      totalDistributed: "Total Handed Out",
      totalRemaining: "Total Shelf Reserves",
      successMsg: "Allocation successfully updated",
      errorSelectAll: "Please fill in all fields",
      errorRepProductExists: "An allocation for this representative and product already exists for this month.",
      confirmDelete: "Are you sure you want to delete this allocation?",
      repPlaceholder: "-- Choose a Representative --",
      productPlaceholder: "-- Choose a Product --",
      noData: "No allocations found matching filters.",
      bulkAllocation: "Bulk Allocation",
      bulkSubtitle: "Allocate samples to medical representatives",
      selectTeamMember: "Select Team Member",
      filterByParentProduct: "Filter by Parent Product",
      selectProducts: "Select Products",
      selectAll: "Select All",
      deselectAll: "Deselect All",
      qtyPerProduct: "Quantity per product",
      allocationMonth: "Allocation Month",
      saveBulk: "Save Allocations",
      noProductsSelected: "Please select at least one product",
      availableLabel: "available",
      noStockLabel: "No stock",
      successBulkMsg: "Bulk allocations successfully created/updated"
    },
    ar: {
      title: "إدارة تخصيص العينات",
      subtitle: "تحديد وتتبع وإدارة الكوتة الشهرية للعينات الطبية للمندوبين الميدانيين",
      searchPlaceholder: "بحث عن المندوب أو المنتج...",
      allRegions: "كل المناطق",
      allProducts: "كل المنتجات",
      month: "الشهر",
      rep: "المندوب الميداني",
      product: "المنتج",
      brand: "العلامة التجارية",
      allocated: "الكمية المخصصة",
      distributed: "الكمية الموزعة",
      remaining: "الكمية المتبقية",
      region: "المنطقة",
      actions: "الإجراءات",
      addAllocation: "تخصيص كوتة جديدة",
      modalTitle: "إنشاء تخصيص كوتة العينات",
      selectRep: "اختر المندوب الميداني",
      selectProduct: "اختر المنتج الطبي",
      allocatedQtyLabel: "الكمية المخصصة (الكوتة)",
      save: "حفظ التخصيص",
      cancel: "إلغاء",
      totalAllocated: "إجمالي الكوتة الموزعة",
      totalDistributed: "إجمالي ما تم تسليمه للأطباء",
      totalRemaining: "إجمالي رصيد حقائب المندوبين",
      successMsg: "تم تحديث تخصيص الكوتة بنجاح",
      errorSelectAll: "يرجى تعبئة جميع الحقول المطلوبة",
      errorRepProductExists: "يوجد بالفعل كوتة مخصصة لهذا المندوب وهذا المنتج خلال هذا الشهر.",
      confirmDelete: "هل أنت متأكد من رغبتك في حذف هذا التخصيص؟",
      repPlaceholder: "-- اختر المندوب --",
      productPlaceholder: "-- اختر المنتج --",
      noData: "لم يتم العثور على أي تخصيصات مطابقة للفلاتر.",
      bulkAllocation: "تخصيص جماعي",
      bulkSubtitle: "توزيع كوتة عينات جماعية على المندوبين الميدانيين",
      selectTeamMember: "اختر عضو الفريق (المندوب)",
      filterByParentProduct: "تصفية حسب العلامة التجارية للمنتج",
      selectProducts: "اختر المنتجات الطبية",
      selectAll: "تحديد الكل",
      deselectAll: "إلغاء التحديد",
      qtyPerProduct: "الكمية لكل منتج",
      allocationMonth: "شهر التخصيص",
      saveBulk: "حفظ التخصيص الجماعي",
      noProductsSelected: "يرجى تحديد منتج واحد على الأقل",
      availableLabel: "متاح",
      noStockLabel: "غير متوفر",
      successBulkMsg: "تم إنشاء وتحديث التخصيص الجماعي بنجاح"
    }
  }[lang];

  const handleAddAllocation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasSampleCapability(currentUser, "ALLOCATE_SAMPLE_STOCK", permissions)) return;
    if (!formRepId || !formProductId || !formAllocatedQty || Number(formAllocatedQty) <= 0) {
      setFormError(t.errorSelectAll);
      return;
    }

    const repObj = reps.find((r) => r.id === formRepId);
    const prodObj = productsList.find((p) => p.id === formProductId);

    if (!repObj || !prodObj) return;

    const allocId = `AL-${Math.floor(100000 + Math.random() * 900000)}`;
    const requestLink = allocationSource === "REQUEST" ? approvedRequests.find(item => item.request.id === formRequestId) : undefined;
    if (allocationSource === "REQUEST" && !requestLink) { setFormError(isRtl ? "اختر طلباً معتمداً" : "Select an approved request."); return; }
    const centralAvailable = Number(centralInventory.find(item => item.sampleSkuId === prodObj.id || item.id === prodObj.id)?.availableQuantity || 0);
    if (Number(formAllocatedQty) > centralAvailable) { setFormError(isRtl ? "الكمية تتجاوز المخزون المركزي" : "Allocation exceeds central available stock."); return; }
    if (requestLink && Number(formAllocatedQty) > requestLink.remaining) { setFormError(isRtl ? "الكمية تتجاوز المتبقي المعتمد" : "Allocation exceeds remaining approved quantity."); return; }

    try {
      await allocateSampleStock({ idempotencyKey: allocationIdempotencyKey, repId: formRepId, sampleSkuId: prodObj.id, quantity: Number(formAllocatedQty), requestId: requestLink?.request.id });

      setShowAddModal(false);
      // Reset Form
      setFormRepId("");
      setFormProductId("");
      setFormAllocatedQty("");
      setFormError("");
      setOperationNotice({
        kind: "success",
        message: isRtl ? "تم حفظ التخصيص بنجاح." : "Allocation saved successfully."
      });
    } catch (err) {
      console.error(err);
      setFormError(isRtl ? "فشل حفظ التخصيص في قاعدة البيانات" : "Failed to save allocation in database");
    }
  };

  const handleBulkAllocation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasSampleCapability(currentUser, "ALLOCATE_SAMPLE_STOCK", permissions)) return;
    if (!bulkRepId || bulkSelectedProductIds.length === 0 || !bulkQty || Number(bulkQty) <= 0) {
      setBulkError(t.errorSelectAll || "Please fill in all required fields and select at least one product");
      return;
    }

    const repObj = reps.find((r) => r.id === bulkRepId);
    if (!repObj) return;

    const eligibleProducts = bulkSelectedProductIds
      .map(pId => productsList.find(product => product.id === pId))
      .filter((product): product is SampleSku => Boolean(product));

    try {
      const committedItems: SampleSku[] = [], failedItems: Array<{ item: SampleSku; error: unknown }> = [];
      for (const prodObj of eligibleProducts) {
        try { await allocateSampleStock({ idempotencyKey: `${bulkIdempotencyKey}:${prodObj.id}`, repId: bulkRepId, sampleSkuId: prodObj.id, quantity: Number(bulkQty) }); committedItems.push(prodObj); }
        catch (error) { failedItems.push({ item: prodObj, error }); }
      }
      const outcome = { committedItems, failedItems, auditWarning: false };

      if (outcome.committedItems.length === 0 && outcome.failedItems.length > 0) {
        setBulkError(isRtl ? "فشل حفظ جميع التخصيصات الجماعية" : "All bulk allocation transactions failed");
        return;
      }

      setShowBulkModal(false);
      // Reset Form
      setBulkRepId("");
      setBulkFilterBrand("all");
      setBulkSelectedProductIds([]);
      setBulkQty("");
      setBulkError("");
      const summary = isRtl
        ? `تم حفظ ${outcome.committedItems.length} تخصيص؛ فشل ${outcome.failedItems.length}.`
        : `${outcome.committedItems.length} allocation(s) saved; ${outcome.failedItems.length} failed.`;
      setOperationNotice({
        kind: outcome.auditWarning || outcome.failedItems.length > 0 ? "warning" : "success",
        message: outcome.auditWarning
          ? `${summary} ${isRtl ? "فشل تسجيل التدقيق." : "Audit logging failed."}`
          : summary
      });
    } catch (err) {
      console.error(err);
      setBulkError(isRtl ? "فشل حفظ التخصيص الجماعي" : "Failed to save bulk allocations");
    }
  };

  const handleDelete = async (id: string) => {
    if (!hasSampleCapability(currentUser, "ALLOCATE_SAMPLE_STOCK", permissions)) return;
    if (window.confirm(t.confirmDelete)) {
      try {
        await setDoc(doc(db, "sampleAllocations", id), decorateRecord({ isDeleted: true }, currentUser.id, "update"));
        
        // Save Audit Log
        const logId = `AUD-${Math.floor(100000 + Math.random() * 900000)}`;
        await setDoc(doc(db, "auditLogs", logId), decorateRecord({
          id: logId,
          userId: currentUser.id,
          userName: currentUser.name,
          userRole: currentUser.role,
          action: "Sample Allocation Deleted",
          entityType: "SampleAllocation",
          entityId: id,
          details: `Deleted sample allocation quota with ID ${id}`,
          timestamp: new Date().toISOString()
        }, currentUser.id, "create"));
      } catch (err) {
        console.error(err);
        alert(isRtl ? "فشل حذف التخصيص" : "Failed to delete allocation");
      }
    }
  };

  // Filter Logic
  const filteredAllocations = filterSampleAllocationRows(allocations, { searchTerm, selectedRegion, selectedProduct, selectedMonth });

  // Analytics Cards
  const totalAllocatedSum = filteredAllocations.reduce((sum, a) => sum + a.allocatedQuantity, 0);
  const totalDistributedSum = filteredAllocations.reduce((sum, a) => sum + a.distributedQuantity, 0);
  const totalRemainingSum = filteredAllocations.reduce((sum, a) => sum + a.remainingQuantity, 0);

  // List unique products and regions for filters
  const uniqueProducts = productsList;
  const uniqueRegions = Array.from(new Set(allocations.map((a) => a.region)));

  const bulkFilteredProducts = productsList.filter(p => {
    if (bulkFilterBrand === "all") return true;
    return p.descriptor === bulkFilterBrand;
  });

  const handleSelectAllBulk = () => {
    const currentFilteredIds = bulkFilteredProducts.map(p => p.id);
    setBulkSelectedProductIds(Array.from(new Set([...bulkSelectedProductIds, ...currentFilteredIds])));
  };

  const handleDeselectAllBulk = () => {
    const currentFilteredIds = bulkFilteredProducts.map(p => p.id);
    setBulkSelectedProductIds(bulkSelectedProductIds.filter(id => !currentFilteredIds.includes(id)));
  };

  return (
    <div className="space-y-6" id="sample-allocation-container">
      {/* Header section */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-xl border border-gray-100 shadow-xs">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight" id="alloc-page-title">{t.title}</h1>
          <p className="text-sm text-gray-500 mt-1" id="alloc-page-subtitle">{t.subtitle}</p>
        </div>
        {hasSampleCapability(currentUser, "ALLOCATE_SAMPLE_STOCK", permissions) && (
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => {
                setBulkSelectedProductIds([]);
                setBulkRepId("");
                setBulkQty("");
                setBulkFilterBrand("all");
                setBulkError("");
                setBulkIdempotencyKey(crypto.randomUUID());
                setShowBulkModal(true);
              }}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-lg font-medium transition-all text-sm shadow-xs"
              id="btn-bulk-allocation"
            >
              <span>{t.bulkAllocation}</span>
            </button>
            <button
              onClick={() => { setAllocationIdempotencyKey(crypto.randomUUID()); setShowAddModal(true); }}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-lg font-medium transition-all text-sm shadow-xs"
              id="btn-add-allocation"
            >
              <Plus className="w-4 h-4" />
              <span>{t.addAllocation}</span>
            </button>
          </div>
        )}
      </div>

      {operationNotice && (
        <div
          role="status"
          className={`flex items-center justify-between rounded-xl border px-4 py-3 text-sm ${operationNotice.kind === "warning" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}
        >
          <span>{operationNotice.message}</span>
          <button type="button" onClick={() => setOperationNotice(null)} aria-label={isRtl ? "إغلاق الإشعار" : "Dismiss notification"} className="ml-3 rounded p-1 hover:bg-black/5"><X className="h-4 w-4" /></button>
        </div>
      )}

      {/* Analytics Bento Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-mono uppercase tracking-wider text-gray-400">{t.totalAllocated}</p>
            <h3 className="text-3xl font-bold text-gray-800 mt-1 font-mono">{totalAllocatedSum}</h3>
          </div>
          <div className="p-3 rounded-lg bg-indigo-50 text-indigo-600 font-bold">QTY</div>
        </div>
        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-mono uppercase tracking-wider text-gray-400">{t.totalDistributed}</p>
            <h3 className="text-3xl font-bold text-emerald-600 mt-1 font-mono">{totalDistributedSum}</h3>
          </div>
          <div className="p-3 rounded-lg bg-emerald-50 text-emerald-600 font-bold">OUT</div>
        </div>
        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-mono uppercase tracking-wider text-gray-400">{t.totalRemaining}</p>
            <h3 className="text-3xl font-bold text-indigo-600 mt-1 font-mono">{totalRemainingSum}</h3>
          </div>
          <div className="p-3 rounded-lg bg-indigo-50/50 text-indigo-600 font-bold">REMAIN</div>
        </div>
      </div>

      {hasSampleCapability(currentUser, "ALLOCATE_SAMPLE_STOCK", permissions) && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-xs overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between"><div><h3 className="font-bold text-gray-900">{isRtl ? "الطلبات المعتمدة بانتظار التخصيص" : "Approved Requests Awaiting Allocation"}</h3><p className="text-xs text-gray-500 mt-1">{isRtl ? "منفصلة عن التخصيص المباشر" : "Request-linked workload, separate from direct allocation"}</p></div><span className="px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 text-xs font-bold">{approvedRequests.length}</span></div>
          {approvedRequests.length > 0 ? <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-gray-50 text-[11px] uppercase text-gray-500"><tr><th className="p-3 text-left">{isRtl ? "الطلب" : "Request"}</th><th className="p-3 text-left">{isRtl ? "المندوب / العينة" : "Rep / Sample SKU"}</th><th className="p-3 text-center">{isRtl ? "مطلوب" : "Requested"}</th><th className="p-3 text-center">{isRtl ? "معتمد" : "Approved"}</th><th className="p-3 text-center">{isRtl ? "مخصص" : "Allocated"}</th><th className="p-3 text-center">{isRtl ? "متبقي" : "Remaining"}</th><th className="p-3 text-center">{isRtl ? "المخزون المركزي" : "Central"}</th><th className="p-3"></th></tr></thead><tbody className="divide-y divide-gray-100">{approvedRequests.map(item => { const allocated = item.approval.approvedQuantity - item.remaining; const central = Number(centralInventory.find(balance => balance.sampleSkuId === item.request.sampleSkuId || balance.id === item.request.sampleSkuId)?.availableQuantity || 0); const physicianName = item.request.requestedForPhysicianName || item.request.requestedForPhysicianId; const productName = products.find(product => product.id === item.request.productId)?.name || item.request.productName || item.request.productId; return <tr key={item.request.id}><td className="p-3 font-mono text-xs">{item.request.id}{item.request.urgent && <span className="ml-2 text-rose-600 font-bold">URGENT</span>}<div className="text-[10px] text-gray-400">{item.request.source}</div></td><td className="p-3"><div className="font-medium">{users.find(user => user.id === item.request.repId)?.name || item.request.repName || item.request.repId}</div><div className="text-xs text-gray-500">{productsList.find(sku => sku.id === item.request.sampleSkuId)?.name || item.request.sampleSkuName || item.request.sampleSkuId} · {productName}</div>{physicianName && <div className="text-[10px] text-gray-400">{isRtl ? "للطبيب" : "For physician"}: {physicianName}</div>}</td><td className="p-3 text-center">{item.request.quantityRequested}</td><td className="p-3 text-center font-bold">{item.approval.approvedQuantity}</td><td className="p-3 text-center">{allocated}</td><td className="p-3 text-center font-bold text-amber-700">{item.remaining}</td><td className="p-3 text-center">{central}</td><td className="p-3 text-right"><button onClick={() => { setAllocationIdempotencyKey(crypto.randomUUID()); setAllocationSource("REQUEST"); setFormRequestId(item.request.id); setFormRepId(item.request.repId); setFormProductId(item.request.sampleSkuId); setFormQty(String(Math.min(item.remaining, central))); setShowAddModal(true); }} className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-bold">{isRtl ? "تخصيص" : "Allocate"}</button></td></tr>; })}</tbody></table></div> : <p className="p-6 text-sm text-center text-gray-400">{isRtl ? "لا توجد طلبات معتمدة بانتظار التخصيص" : "No approved requests are awaiting allocation."}</p>}
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-xs flex flex-col md:flex-row gap-4 items-center">
        <div className="relative w-full md:flex-1">
          <Search className={`absolute top-1/2 -translate-y-1/2 text-gray-400 w-4.5 h-4.5 ${isRtl ? "right-3.5" : "left-3.5"}`} />
          <input
            type="text"
            placeholder={t.searchPlaceholder}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className={`w-full py-2 bg-gray-50 hover:bg-gray-100/50 focus:bg-white text-sm border border-gray-200 focus:border-indigo-500 rounded-lg focus:outline-none transition-all ${
              isRtl ? "pr-10 pl-4" : "pl-10 pr-4"
            }`}
            id="alloc-search-input"
          />
        </div>

        <div className="flex flex-wrap md:flex-nowrap gap-2 w-full md:w-auto">
          {/* Region Filter */}
          <select
            value={selectedRegion}
            onChange={(e) => setSelectedRegion(e.target.value)}
            className="bg-gray-50 hover:bg-gray-100/50 border border-gray-200 rounded-lg text-xs py-2 px-3 focus:outline-none text-gray-600"
            id="alloc-region-filter"
          >
            <option value="all">{t.allRegions}</option>
            {uniqueRegions.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>

          {/* Product Filter */}
          <select
            value={selectedProduct}
            onChange={(e) => setSelectedProduct(e.target.value)}
            className="bg-gray-50 hover:bg-gray-100/50 border border-gray-200 rounded-lg text-xs py-2 px-3 focus:outline-none text-gray-600 max-w-[180px]"
            id="alloc-product-filter"
          >
            <option value="all">{t.allProducts}</option>
            {uniqueProducts.map((p) => (
              <option key={p.id} value={p.id}>{p.descriptor} ({p.name})</option>
            ))}
          </select>

          {/* Month Filter */}
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="bg-gray-50 hover:bg-gray-100/50 border border-gray-200 rounded-lg text-xs py-2 px-3 focus:outline-none text-gray-600"
            id="alloc-month-filter"
          >
            <option value="all">{isRtl ? "كل الأشهر" : "All Months"}</option>
            <option value="2026-06">2026-06</option>
            <option value="2026-07">2026-07</option>
          </select>
        </div>
      </div>

      {/* Main Allocations Table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-xs overflow-hidden">
        {/* Desktop Table View */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse" id="allocations-table">
            <thead>
              <tr className="bg-gray-50/70 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                <th className={`py-4 px-6 ${isRtl ? "text-right" : "text-left"}`}>{t.rep}</th>
                <th className={`py-4 px-6 ${isRtl ? "text-right" : "text-left"}`}>{t.region}</th>
                <th className={`py-4 px-6 ${isRtl ? "text-right" : "text-left"}`}>{t.product}</th>
                <th className={`py-4 px-6 ${isRtl ? "text-right" : "text-left"}`}>{t.brand}</th>
                <th className={`py-4 px-6 text-center`}>{t.allocated}</th>
                <th className={`py-4 px-6 text-center`}>{t.distributed}</th>
                <th className={`py-4 px-6 text-center`}>{t.remaining}</th>
                <th className={`py-4 px-6 text-center`}>{t.month}</th>
                <th className={`py-4 px-6 text-center`}>{t.actions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 text-sm text-gray-700">
              {filteredAllocations.length > 0 ? (
                filteredAllocations.map((alloc) => (
                  <tr key={alloc.id} className="hover:bg-gray-50/40 transition-all">
                    <td className={`py-3.5 px-6 font-medium text-gray-900 ${isRtl ? "text-right" : "text-left"}`}>
                      {alloc.repName}
                    </td>
                    <td className={`py-3.5 px-6 ${isRtl ? "text-right" : "text-left"}`}>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                        {alloc.region}
                      </span>
                    </td>
                    <td className={`py-3.5 px-6 text-gray-500 ${isRtl ? "text-right" : "text-left"}`}>
                      {alloc.productName}
                    </td>
                    <td className={`py-3.5 px-6 ${isRtl ? "text-right" : "text-left"}`}>
                      <span className="font-mono text-xs font-semibold text-indigo-600 bg-indigo-50/50 px-2 py-1 rounded">
                        {alloc.brand}
                      </span>
                    </td>
                    <td className="py-3.5 px-6 text-center font-semibold font-mono">
                      {alloc.allocatedQuantity}
                    </td>
                    <td className="py-3.5 px-6 text-center text-emerald-600 font-semibold font-mono">
                      {alloc.distributedQuantity}
                    </td>
                    <td className="py-3.5 px-6 text-center text-indigo-600 font-semibold font-mono">
                      {alloc.remainingQuantity}
                    </td>
                    <td className="py-3.5 px-6 text-center text-xs text-gray-400 font-mono">
                      {alloc.month}
                    </td>
                    <td className="py-3.5 px-6 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          onClick={() => handleDelete(alloc.id)}
                          className="p-1.5 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-all"
                          title="Delete Allocation"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
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
          {filteredAllocations.length > 0 ? (
            filteredAllocations.map((alloc) => (
              <div key={alloc.id} className="p-4 space-y-3 hover:bg-gray-50/20 transition-all text-xs">
                <div className={`flex justify-between items-start gap-2 ${isRtl ? "flex-row-reverse text-right" : "flex-row"}`}>
                  <div>
                    <h4 className="font-semibold text-gray-900 text-sm">{alloc.repName}</h4>
                    <p className="text-gray-400 text-[10px] mt-0.5">{alloc.month}</p>
                  </div>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 text-gray-700 shrink-0">
                    {alloc.region}
                  </span>
                </div>

                <div className={`space-y-1.5 ${isRtl ? "text-right" : "text-left"}`}>
                  <p className="text-gray-600 font-medium leading-tight">{alloc.productName}</p>
                  <span className="inline-block font-mono text-[10px] font-semibold text-indigo-600 bg-indigo-50/50 px-2 py-0.5 rounded">
                    {alloc.brand}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 bg-gray-50/50 rounded-lg p-2 text-center text-[11px] font-mono border border-gray-100/50">
                  <div>
                    <p className="text-gray-400 text-[9px] uppercase tracking-wider font-sans mb-0.5">{t.allocated}</p>
                    <p className="font-bold text-gray-800">{alloc.allocatedQuantity}</p>
                  </div>
                  <div>
                    <p className="text-gray-400 text-[9px] uppercase tracking-wider font-sans mb-0.5">{t.distributed}</p>
                    <p className="font-bold text-emerald-600">{alloc.distributedQuantity}</p>
                  </div>
                  <div>
                    <p className="text-gray-400 text-[9px] uppercase tracking-wider font-sans mb-0.5">{t.remaining}</p>
                    <p className="font-bold text-indigo-600">{alloc.remainingQuantity}</p>
                  </div>
                </div>

                <div className={`flex items-center pt-2 border-t border-gray-50 ${isRtl ? "justify-start" : "justify-end"}`}>
                  <button
                    onClick={() => handleDelete(alloc.id)}
                    className="flex items-center gap-1 py-1 px-2.5 text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-md transition-all font-medium text-[10px] cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>{isRtl ? "حذف الحصة" : "Delete Allocation"}</span>
                  </button>
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

      {/* Modal for adding New Allocation */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl border border-gray-100 max-w-md w-full overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h3 className="font-bold text-gray-800" id="alloc-modal-title">{t.modalTitle}</h3>
              <button onClick={() => setShowAddModal(false)} className="text-gray-400 hover:text-gray-600 text-lg">&times;</button>
            </div>
            <form onSubmit={handleAddAllocation} className="p-6 space-y-4">
              {formError && (
                <div className="p-3 rounded bg-rose-50 text-rose-700 text-xs flex gap-2 items-center">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block">{isRtl ? "مصدر التخصيص" : "Allocation Source"}</label>
                <select value={allocationSource} onChange={e => { setAllocationSource(e.target.value as "DIRECT" | "REQUEST"); setFormRequestId(""); }} className="w-full bg-gray-50 border border-gray-200 rounded-lg text-sm p-2.5">
                  <option value="DIRECT">DIRECT</option><option value="REQUEST">REQUESTED ALLOCATION</option>
                </select>
              </div>

              {allocationSource === "REQUEST" && <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block">{isRtl ? "الطلب المعتمد" : "Approved Request"}</label>
                <select value={formRequestId} onChange={e => { const link = approvedRequests.find(item => item.request.id === e.target.value); setFormRequestId(e.target.value); if (link) { setFormRepId(link.request.repId); setFormProductId(link.request.sampleSkuId); } }} className="w-full bg-gray-50 border border-gray-200 rounded-lg text-sm p-2.5">
                  <option value="">{isRtl ? "اختر الطلب" : "Select request"}</option>
                  {approvedRequests.map(item => <option key={item.request.id} value={item.request.id}>{item.request.id} — {productsList.find(sku => sku.id === item.request.sampleSkuId)?.name || item.request.sampleSkuName || item.request.sampleSkuId} — {isRtl ? "متبقي" : "Remaining"}: {item.remaining}</option>)}
                </select>
              </div>}

              {/* Rep Select */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block">{t.selectRep}</label>
                <select
                  value={formRepId}
                  onChange={(e) => setFormRepId(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg text-sm p-2.5 focus:outline-none focus:border-indigo-500"
                >
                  <option value="">{t.repPlaceholder}</option>
                  {reps.map((r) => (
                    <option key={r.id} value={r.id}>{r.name} ({r.region})</option>
                  ))}
                </select>
                {formProductId && <p className="text-[11px] text-gray-500 mt-1">{isRtl ? "المتاح مركزياً" : "Central available"}: <strong>{Number(centralInventory.find(item => item.sampleSkuId === formProductId || item.id === formProductId)?.availableQuantity || 0)}</strong>{allocationSource === "REQUEST" && formRequestId ? ` · ${isRtl ? "المتبقي المعتمد" : "Approved remaining"}: ${approvedRequests.find(item => item.request.id === formRequestId)?.remaining || 0}` : ""}</p>}
              </div>

              {/* Product Select */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block">{t.selectProduct}</label>
                <select
                  value={formProductId}
                  onChange={(e) => setFormProductId(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg text-sm p-2.5 focus:outline-none focus:border-indigo-500"
                >
                  <option value="">{t.productPlaceholder}</option>
                  {productsList.map((p) => (
                    <option key={p.id} value={p.id}>{p.descriptor} - {p.name}</option>
                  ))}
                </select>
              </div>

              {/* Allocated Quantity */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block">{t.allocatedQtyLabel}</label>
                <input
                  type="number"
                  min="1"
                  value={formAllocatedQty}
                  onChange={(e) => setFormAllocatedQty(e.target.value === "" ? "" : Number(e.target.value))}
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg text-sm p-2.5 focus:outline-none focus:border-indigo-500 font-mono"
                  placeholder="e.g. 100"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 border border-gray-200 text-gray-500 rounded-lg text-sm font-medium hover:bg-gray-50"
                >
                  {t.cancel}
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium shadow-xs"
                >
                  {t.save}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal for Bulk Allocation */}
      {showBulkModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl border border-gray-100 max-w-md w-full overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-start bg-white">
              <div>
                <h3 className="text-lg font-bold text-gray-900 leading-tight" id="bulk-modal-title">{t.bulkAllocation}</h3>
                <p className="text-xs text-gray-500 mt-0.5">{t.bulkSubtitle}</p>
              </div>
              <button type="button" onClick={() => setShowBulkModal(false)} className="text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-gray-50 transition-all">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleBulkAllocation} className="p-6 space-y-4">
              {bulkError && (
                <div className="p-3 rounded bg-rose-50 text-rose-700 text-xs flex gap-2 items-center">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{bulkError}</span>
                </div>
              )}

              {/* Select Team Member */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-700 block">{t.selectTeamMember}</label>
                <div className="relative">
                  <select
                    value={bulkRepId}
                    onChange={(e) => setBulkRepId(e.target.value)}
                    className="w-full bg-white border border-gray-200 hover:border-gray-300 focus:border-indigo-500 rounded-lg text-sm p-2.5 pr-8 focus:outline-none appearance-none transition-all shadow-2xs"
                  >
                    <option value="">{t.repPlaceholder}</option>
                    {reps.map((r) => (
                      <option key={r.id} value={r.id}>{r.name} ({r.region})</option>
                    ))}
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-500">
                    <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                      <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/>
                    </svg>
                  </div>
                </div>
              </div>

              {/* Filter by Parent Product */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-700 block">{t.filterByParentProduct}</label>
                <div className="relative">
                  <select
                    value={bulkFilterBrand}
                    onChange={(e) => setBulkFilterBrand(e.target.value)}
                    className="w-full bg-white border border-gray-200 hover:border-gray-300 focus:border-indigo-500 rounded-lg text-sm p-2.5 pr-8 focus:outline-none appearance-none transition-all shadow-2xs"
                  >
                    <option value="all">{isRtl ? "كل المنتجات" : "All Products"}</option>
                    {Array.from(new Set(productsList.map(p => p.descriptor))).map((brand) => (
                      <option key={brand} value={brand}>{brand}</option>
                    ))}
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-500">
                    <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                      <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/>
                    </svg>
                  </div>
                </div>
              </div>

              {/* Select Products */}
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-semibold text-gray-700">{t.selectProducts}</label>
                  <div className="flex items-center gap-3 text-xs">
                    <button
                      type="button"
                      onClick={handleSelectAllBulk}
                      className="text-indigo-600 hover:text-indigo-800 font-medium inline-flex items-center gap-1 transition-all"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>{t.selectAll}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleDeselectAllBulk}
                      className="text-gray-500 hover:text-gray-700 font-medium inline-flex items-center gap-1 transition-all"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>{t.deselectAll}</span>
                    </button>
                  </div>
                </div>

                {/* Checklist Box */}
                <div className="border border-gray-150 rounded-lg p-2 max-h-56 overflow-y-auto bg-gray-50/50 space-y-1.5">
                  {bulkFilteredProducts.map((p) => {
                    const isSelected = bulkSelectedProductIds.includes(p.id);
                    const isOutOfStock = p.stock <= 0;
                    return (
                      <label
                        key={p.id}
                        className={`flex items-center justify-between p-2.5 rounded-md cursor-pointer transition-all border ${
                          isSelected
                            ? "bg-indigo-50/50 border-indigo-150 hover:bg-indigo-50"
                            : "bg-white border-gray-100 hover:bg-gray-50/50"
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {
                              if (isSelected) {
                                setBulkSelectedProductIds(bulkSelectedProductIds.filter(id => id !== p.id));
                              } else {
                                setBulkSelectedProductIds([...bulkSelectedProductIds, p.id]);
                              }
                            }}
                            className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-gray-300"
                          />
                          <div className="leading-tight">
                            <p className="text-xs font-semibold text-gray-800">{p.name} - Trial</p>
                            <p className="text-[10px] text-gray-400 font-mono mt-0.5">{p.descriptor}</p>
                          </div>
                        </div>

                        {/* Status Badge */}
                        <div>
                          {isOutOfStock ? (
                            <span className="text-[10px] font-medium bg-rose-50 text-rose-600 px-2 py-0.5 rounded-full">
                              {t.noStockLabel}
                            </span>
                          ) : (
                            <span className="text-[10px] font-medium bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-full font-mono">
                              {p.stock} {t.availableLabel}
                            </span>
                          )}
                        </div>
                      </label>
                    );
                  })}
                  {bulkFilteredProducts.length === 0 && (
                    <p className="text-center text-xs text-gray-400 py-4">{isRtl ? "لا توجد منتجات مطابقة للتصفية" : "No products matching brand filter."}</p>
                  )}
                </div>
              </div>

              {/* Quantity per product */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-700 block">{t.qtyPerProduct}</label>
                <input
                  type="number"
                  min="1"
                  value={bulkQty}
                  onChange={(e) => setBulkQty(e.target.value === "" ? "" : Number(e.target.value))}
                  className="w-full bg-white border border-gray-200 hover:border-gray-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-lg text-sm p-2.5 focus:outline-none transition-all shadow-2xs font-mono"
                  placeholder={isRtl ? "مثال: 50" : "e.g. 50"}
                />
              </div>

              {/* Allocation Month */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-700 block">{t.allocationMonth}</label>
                <div className="relative">
                  <select
                    value={bulkMonth}
                    onChange={(e) => setBulkMonth(e.target.value)}
                    className="w-full bg-white border border-gray-200 hover:border-gray-300 focus:border-indigo-500 rounded-lg text-sm p-2.5 pr-8 focus:outline-none appearance-none transition-all shadow-2xs font-mono"
                  >
                    <option value="2026-06">June 2026</option>
                    <option value="2026-07">July 2026</option>
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-500">
                    <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                      <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/>
                    </svg>
                  </div>
                </div>
              </div>

              {/* Footer Actions */}
              <div className="flex justify-end gap-3 pt-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setShowBulkModal(false)}
                  className="px-4 py-2 border border-gray-200 text-gray-500 rounded-lg text-sm font-medium hover:bg-gray-50 transition-all"
                >
                  {t.cancel}
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium shadow-xs transition-all"
                >
                  {t.saveBulk}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
