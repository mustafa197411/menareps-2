import React, { useState, useEffect } from "react";
import { 
  Search, 
  Filter, 
  AlertCircle, 
  Plus, 
  ThermometerSnowflake, 
  ShieldAlert, 
  Archive, 
  Trash2, 
  RefreshCw, 
  AlertTriangle, 
  Upload, 
  Clock, 
  Warehouse, 
  Boxes, 
  Layers, 
  Settings2, 
  Edit2, 
  Check, 
  FileText, 
  User as UserIcon, 
  ArrowRight,
  ChevronDown
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { User, Product, SampleSku, UserTerritoryAssignment, UserProductAssignment, Permissions, Role, normalizeRole } from "../../types";
import { collection, onSnapshot, doc, setDoc, query, where } from "firebase/firestore";
import { auth, db } from "../../lib/firebase";
import { applySecurityScope } from "../../lib/securityEngine";
import { decorateRecord } from "../../lib/firebaseSync";
import { hasSampleCapability } from "../../lib/sampleAuthorization";
import { createSampleSku } from "../../lib/sampleDomainService";
import { receiveCanonicalSampleStock } from "../../lib/sampleStockService";
import { adjustSampleStock } from "../../lib/sampleMutationClient";
import { prepareSampleCatalogWrite } from "../../lib/samplePersistence";
import { mutateSampleVariant, receiveSampleStock } from "../../lib/sampleMutationClient";
import { deriveSampleBatchCounters, eligibleSampleCatalog } from "../../lib/samplePresentation";

interface SampleInventoryProps {
  currentUser: User;
  products?: Product[];
  permissions?: Permissions;
  lang: "en" | "ar";
  workspaceSection?: "all" | "catalog" | "inventory";
}

// Initial mock data mirroring screenshots exactly
const DEFAULT_SAMPLES: any[] = [];

const DEFAULT_WAREHOUSE: any[] = [];

const DEFAULT_TRANSACTIONS: any[] = [];

export default function SampleInventoryLedger({ currentUser, products = [], permissions, lang, workspaceSection = "all" }: SampleInventoryProps) {
  const isRtl = lang === "ar";

  // Tab state
  const [activeTab, setActiveTab] = useState<"samples" | "batches" | "warehouse" | "transactions">(workspaceSection === "inventory" ? "warehouse" : "samples");

  useEffect(() => {
    setActiveTab(workspaceSection === "inventory" ? "warehouse" : "samples");
  }, [workspaceSection]);

  // Core data states (real-time from Firestore)
  const [samples, setSamples] = useState<any[]>([]);
  const [rawSamples, setRawSamples] = useState<any[]>([]);
  
  const [warehouse, setWarehouse] = useState<any[]>([]);
  const [rawWarehouse, setRawWarehouse] = useState<any[]>([]);

  const [transactions, setTransactions] = useState<any[]>([]);
  const [rawTransactions, setRawTransactions] = useState<any[]>([]);

  const [batches, setBatches] = useState<any[]>([]);
  const [rawBatches, setRawBatches] = useState<any[]>([]);

  const [userTerritoryAssignments, setUserTerritoryAssignments] = useState<UserTerritoryAssignment[]>([]);
  const [userProductAssignments, setUserProductAssignments] = useState<UserProductAssignment[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Secure guard: Representatives can NEVER see warehouse stock or access the warehouse tab
  useEffect(() => {
    const canViewInventory = currentUser && hasSampleCapability(currentUser, "VIEW_SAMPLE_INVENTORY", permissions);
    if (!canViewInventory && activeTab === "warehouse") {
      setActiveTab("samples");
    }
  }, [currentUser, permissions, activeTab]);

  // Firestore listeners
  useEffect(() => {
    setIsLoading(true);
    const canViewCentralInventory = hasSampleCapability(currentUser, "VIEW_SAMPLE_INVENTORY", permissions);
    const route = `sample-management?tab=${workspaceSection === "all" ? "catalog" : workspaceSection}`;
    const listenerError = (collectionName: string, queryConstraints: string[], capability: string) => (error: unknown) => {
      console.error("[SAMPLE_LISTENER_DIAGNOSTIC]", {
        collection: collectionName,
        queryConstraints,
        uid: auth.currentUser?.uid ?? null,
        role: normalizeRole(currentUser.role),
        capability,
        route,
        error
      });
    };

    const unsubSamples = onSnapshot(collection(db, "sampleCatalog"), (snap) => {
      const items: any[] = [];
      snap.forEach((doc) => {
        const data = doc.data();
        if (!data.isDeleted) {
          items.push({ id: doc.id, ...data, name: data.name || data.sampleSkuId || doc.id, qty: data.totalReceived ?? data.qty ?? 0, available: data.availableQuantity ?? data.available ?? 0, repsStock: data.allocatedQuantity ?? data.repsStock ?? 0, reorder: data.reorder ?? 0 });
        }
      });
      setRawSamples(items);
    }, listenerError("sampleCatalog", [], "VIEW_SAMPLE_MANAGEMENT"));

    const shouldListenToCentralInventory = workspaceSection !== "catalog" && canViewCentralInventory;
    const unsubWarehouse = shouldListenToCentralInventory ? onSnapshot(collection(db, "sampleInventory"), (snap) => {
      const items: any[] = [];
      snap.forEach((doc) => {
        const data = doc.data();
        if (!data.isDeleted) {
          items.push({ id: doc.id, ...data, name: data.name || data.sampleSkuId || doc.id, qty: data.totalReceived ?? data.qty ?? 0, available: data.availableQuantity ?? data.available ?? 0, repsStock: data.allocatedQuantity ?? data.repsStock ?? 0, reorder: data.reorder ?? 0 });
        }
      });
      setRawWarehouse(items);
    }, listenerError("sampleInventory", [], "VIEW_SAMPLE_INVENTORY")) : () => undefined;

    const unsubTransactions = shouldListenToCentralInventory ? onSnapshot(collection(db, "sampleTransactions"), (snap) => {
      const items: any[] = [];
      snap.forEach((doc) => {
        const data = doc.data();
        if (!data.isDeleted) {
          items.push({ id: doc.id, ...data });
        }
      });
      setRawTransactions(items);
    }, listenerError("sampleTransactions", [], "VIEW_SAMPLE_INVENTORY")) : () => undefined;

    const unsubBatches = shouldListenToCentralInventory ? onSnapshot(collection(db, "sampleBatches"), (snap) => {
      const items: any[] = [];
      snap.forEach((doc) => {
        const data = doc.data();
        if (!data.isDeleted) {
          items.push({ id: doc.id, ...data });
        }
      });
      setRawBatches(items);
    }, listenerError("sampleBatches", [], "VIEW_SAMPLE_INVENTORY")) : () => undefined;

    const unsubTerrAss = onSnapshot(collection(db, "userTerritoryAssignments"), (snap) => {
      const items: UserTerritoryAssignment[] = [];
      snap.forEach((doc) => {
        const data = doc.data();
        if (!data.isDeleted) {
          items.push({ id: doc.id, ...data } as unknown as UserTerritoryAssignment);
        }
      });
      setUserTerritoryAssignments(items);
    }, listenerError("userTerritoryAssignments", [], "VIEW_SAMPLE_MANAGEMENT"));

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
    }, listenerError("userProductAssignments", [`where(userId == ${currentUser.id})`], "VIEW_SAMPLE_MANAGEMENT"));

    return () => {
      unsubSamples();
      unsubWarehouse();
      unsubTransactions();
      unsubBatches();
      unsubTerrAss();
      unsubProdAss();
    };
  }, [currentUser, permissions, workspaceSection]);

  // Filter with Security Scope
  useEffect(() => {
    const assignedProductIds = new Set(userProductAssignments.filter(item => item.userId === currentUser.id && item.status === "Active" && item.active !== false).map(item => item.productId));
    setSamples(currentUser.role === Role.MEDICAL_REP
      ? eligibleSampleCatalog(rawSamples as SampleSku[], products, userProductAssignments, currentUser.id)
      : rawSamples.filter(item => item.isDeleted !== true));
    setWarehouse(applySecurityScope(currentUser, rawWarehouse, userTerritoryAssignments, userProductAssignments));
    setTransactions(applySecurityScope(currentUser, rawTransactions, userTerritoryAssignments, userProductAssignments));
    setBatches(applySecurityScope(currentUser, rawBatches, userTerritoryAssignments, userProductAssignments));
  }, [rawSamples, rawWarehouse, rawTransactions, rawBatches, userTerritoryAssignments, userProductAssignments, currentUser]);

  // Search/Filters states
  const [searchTerm, setSearchTerm] = useState("");
  const [brandFilter, setBrandFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [repFilter, setRepFilter] = useState("All");
  const [txTypeFilter, setTxTypeFilter] = useState("All");

  // Sorting
  const [sortField, setSortField] = useState("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  // Dialog Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [showFixDuplicatesModal, setShowFixDuplicatesModal] = useState(false);
  const [showUploadReceiptModal, setShowUploadReceiptModal] = useState(false);
  const [variantIdempotencyKey, setVariantIdempotencyKey] = useState("");
  const [receiptIdempotencyKey, setReceiptIdempotencyKey] = useState("");
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [selectedAdjustProduct, setSelectedAdjustProduct] = useState<any | null>(null);

  // Form states - Add Sample Variant
  const [newProdName, setNewProdName] = useState("");
  const [newProdBrand, setNewProdBrand] = useState("");
  const [newProdSize, setNewProdSize] = useState("");
  const [newProdUnits, setNewProdUnits] = useState<number>(1);
  const [newProdCold, setNewProdCold] = useState(false);
  const [newProdInitialStock, setNewProdInitialStock] = useState<string>("");
  const [formError, setFormError] = useState("");

  // Form states - Upload Receipt
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptProductId, setReceiptProductId] = useState("");
  const [receiptQty, setReceiptQty] = useState<string>("");
  const [receiptBatchNumber, setReceiptBatchNumber] = useState("");
  const [receiptExpiryDate, setReceiptExpiryDate] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  // Form states - Adjust Stock
  const [adjustQty, setAdjustQty] = useState<string>("");
  const [adjustAvailable, setAdjustAvailable] = useState<string>("");
  const [adjustReason, setAdjustReason] = useState("Physical audit correction");
  const [adjustNotes, setAdjustNotes] = useState("");

  // Bilingual translation dictionary
  const t = {
    en: {
      title: "Sample Inventory",
      subtitle: "Manage pharmaceutical samples and allocations",
      tabSamples: "Samples",
      tabBatches: "Batch Management",
      tabWarehouse: "Warehouse Inventory",
      tabTransactions: "Transactions",
      
      // KPI
      kpiTotalSamples: "Total Samples",
      kpiAvailable: "Available",
      kpiActiveBatches: "Active Batches",
      kpiExpiringSoon: "Expiring Soon",
      kpiReady: "Ready to allocate",
      kpiTotalBatchesCount: "0 total batches",
      kpiWithinDays: "Within 30 days",
      kpiProducts: "products",

      // Buttons
      btnRefresh: "Refresh",
      btnFixDuplicates: "Fix Duplicates",
      btnUploadReceipt: "Upload Receipt",
      btnAddVariant: "Add Sample Variant",

      // Search and Filter Placeholders
      searchPlaceholder: "Search...",
      filterBrand: "Brand",
      filterStatus: "Status",
      filterRep: "Filter by Rep:",
      filterTxType: "Transaction Type",
      all: "All",
      allReps: "All Reps",

      // Tables
      colSampleName: "Sample Name",
      colParentProduct: "Parent Product",
      colUnitSize: "Unit Size",
      colUnitsPack: "Units/Pack",
      colColdStorage: "Cold Storage",
      colStatus: "Status",
      colActions: "Actions",

      colProduct: "Product",
      colBatch: "Batch",
      colWarehouseQty: "Warehouse Qty",
      colAvailable: "Available",
      colMedRepsStock: "Med Reps Stock",
      colReorderLevel: "Reorder Level",

      colDateTime: "Date/Time",
      colType: "Type",
      colQuantity: "Quantity",
      colInvChange: "Inventory Change",
      colSource: "Source",
      colReason: "Reason",
      colNotes: "Notes",

      statusActive: "Active",
      statusDiscontinued: "Discontinued",
      yes: "Yes",
      no: "No",
      noBatchesFound: "No batches found",
      noBatchesSub: "Register a batch or upload a receipt to populate batches.",
      registerBatch: "Register Batch",

      // Dialogs
      titleAddVariant: "Add Sample Variant",
      titleFixDuplicates: "Fix Duplicate Samples",
      titleUploadReceipt: "Upload Warehouse Receipt",
      titleAdjustStock: "Adjust Warehouse Stock",

      labelName: "Sample / Product Name",
      labelBrand: "Brand Name",
      labelUnitSize: "Unit Size (e.g. 25G, 150ML)",
      labelUnitsPack: "Units Per Pack",
      labelColdChain: "Requires Cold Chain (2°C - 8°C)",
      labelInitialStock: "Initial Warehouse Stock (Optional)",
      labelCancel: "Cancel",
      labelSave: "Save",
      labelAdd: "Add Variant",
      labelMerge: "Merge & Clean",
      labelUpload: "Process Receipt",
      labelAdjust: "Adjust Stock",

      labelSelectFile: "Choose file or drag & drop",
      labelDragOver: "Drop receipt here...",
      labelReceiptProduct: "Choose Product for Receipt",
      labelQtyToAdd: "Quantity of Units Added",

      labelWarehouseQty: "Total Warehouse stock quantity",
      labelAvailableQty: "Available for allocation",
      labelReason: "Adjustment Reason",
      labelAudit: "Physical audit correction",
      labelDamaged: "Damaged goods",
      labelTransfer: "Transfer adjustment",
      labelWriteNotes: "Additional Notes"
    },
    ar: {
      title: "مستودع العينات",
      subtitle: "إدارة العينات الدوائية والمخصصات الموزعة",
      tabSamples: "عينات المنتجات",
      tabBatches: "إدارة الدفعات",
      tabWarehouse: "مخزون المستودع",
      tabTransactions: "سجل العمليات",

      // KPI
      kpiTotalSamples: "إجمالي العينات",
      kpiAvailable: "المتاح للتوزيع",
      kpiActiveBatches: "الدفعات النشطة",
      kpiExpiringSoon: "قريبة الانتهاء",
      kpiReady: "جاهز للتوزيع",
      kpiTotalBatchesCount: "0 دفعة نشطة",
      kpiWithinDays: "خلال 30 يوماً",
      kpiProducts: "منتج",

      // Buttons
      btnRefresh: "تحديث",
      btnFixDuplicates: "معالجة المكرر",
      btnUploadReceipt: "رفع إيصال توريد",
      btnAddVariant: "إضافة منتج تجريبي",

      // Search & Filters
      searchPlaceholder: "بحث...",
      filterBrand: "العلامة التجارية",
      filterStatus: "الحالة",
      filterRep: "تصفية حسب المندوب:",
      filterTxType: "نوع العملية",
      all: "الكل",
      allReps: "جميع المناديب",

      // Tables
      colSampleName: "اسم العينة المنتج",
      colParentProduct: "المنتج الأب",
      colUnitSize: "الحجم / القياس",
      colUnitsPack: "الوحدات بالعلبة",
      colColdStorage: "تبريد خاص",
      colStatus: "الحالة",
      colActions: "إجراءات",

      colProduct: "المنتج",
      colBatch: "التشغيلة (اللوط)",
      colWarehouseQty: "مخزون المستودع",
      colAvailable: "المتاح للتوزيع",
      colMedRepsStock: "عهدة المناديب",
      colReorderLevel: "حد إعادة الطلب",

      colDateTime: "التاريخ والوقت",
      colType: "النوع",
      colQuantity: "الكمية",
      colInvChange: "تغير المخزون",
      colSource: "المصدر",
      colReason: "السبب",
      colNotes: "ملاحظات",

      statusActive: "نشط",
      statusDiscontinued: "موقوف",
      yes: "نعم",
      no: "لا",
      noBatchesFound: "لم يتم العثور على أي دفعات",
      noBatchesSub: "سجل دفعة تشغيلية أو ارفع إيصال توريد لعرض الدفعات هنا.",
      registerBatch: "تسجيل دفعة",

      // Dialogs
      titleAddVariant: "إضافة منتج عينات جديد",
      titleFixDuplicates: "دمج عينات المنتجات المكررة",
      titleUploadReceipt: "رفع مستند توريد مستودع",
      titleAdjustStock: "تسوية كميات مستودع العينات",

      labelName: "اسم العينة / المنتج",
      labelBrand: "العلامة التجارية",
      labelUnitSize: "الحجم (مثل 25G, 150ML)",
      labelUnitsPack: "عدد الوحدات بكل علبة",
      labelColdChain: "يتطلب سلسلة تبريد (2°م - 8°م)",
      labelInitialStock: "مخزون المستودع الافتتاحي (اختياري)",
      labelCancel: "إلغاء",
      labelSave: "حفظ",
      labelAdd: "إضافة العينة",
      labelMerge: "دمج وتصفية",
      labelUpload: "تنفيذ التوريد",
      labelAdjust: "حفظ التسوية",

      labelSelectFile: "اختر ملفاً أو اسحبه وأفلته هنا",
      labelDragOver: "أفلت إيصال التوريد هنا...",
      labelReceiptProduct: "اختر المنتج الطبي المورد",
      labelQtyToAdd: "الكمية الموردة بالوحدات",

      labelWarehouseQty: "إجمالي مخزون المستودع",
      labelAvailableQty: "المخزون المتاح للمناديب",
      labelReason: "سبب التسوية",
      labelAudit: "جرد ومطابقة فعلية للمستودع",
      labelDamaged: "تلف عينات / كسر",
      labelTransfer: "تسوية عهدة مندوب",
      labelWriteNotes: "تفاصيل الملاحظات"
    }
  }[lang];

  // Calculated dynamic KPI totals
  const totalSamplesQuantity = warehouse.reduce((sum, item) => sum + item.qty, 0);
  const totalAvailableQuantity = warehouse.reduce((sum, item) => sum + item.available, 0);
  const totalUniqueProductsCount = samples.length;
  const batchCounters = deriveSampleBatchCounters(batches, new Date().toISOString().slice(0, 10));

  // Handles Refresh Action
  const handleRefresh = () => {
    setSearchTerm("");
    setBrandFilter("All");
    setStatusFilter("All");
    setRepFilter("All");
    setTxTypeFilter("All");
  };

  // Deactivate the Sample SKU without deleting its inventory or historical lineage.
  const handleDeleteSample = async (id: string) => {
    if (!hasSampleCapability(currentUser, "DEACTIVATE_SAMPLE_SKU", permissions)) return;
    const sampleToDelete = rawSamples.find(s => s.id === id);
    const reactivating = sampleToDelete?.active === false || sampleToDelete?.status === "INACTIVE";
    if (confirm(reactivating ? (isRtl ? "هل تريد إعادة تنشيط هذا الصنف؟" : "Reactivate this Sample SKU?") : (isRtl ? "هل تريد بالتأكيد إلغاء تنشيط هذا الصنف؟" : "Are you sure you want to deactivate this Sample SKU?"))) {
      try {
        if (sampleToDelete) await mutateSampleVariant({ action: reactivating ? "REACTIVATE" : "DEACTIVATE", idempotencyKey: `${reactivating ? "reactivate" : "deactivate"}:${id}:${crypto.randomUUID()}`, sampleSkuId: id });
      } catch (err) {
        console.error(err);
        alert(isRtl ? "فشل حذف الصنف" : "Failed to delete sample variant");
      }
    }
  };

  const handleEditSample = async (id: string) => {
    if (!hasSampleCapability(currentUser, "EDIT_SAMPLE_SKU", permissions)) return;
    const sample = rawSamples.find(item => item.id === id);
    if (!sample) return;
    const name = window.prompt(isRtl ? "اسم صنف العينة" : "Sample Variant name", sample.name);
    if (name === null) return;
    const descriptor = window.prompt(isRtl ? "الوصف" : "Descriptor", sample.descriptor || "Trial");
    if (descriptor === null || !name.trim() || !descriptor.trim()) return;
    try {
      await mutateSampleVariant({ action: "UPDATE", idempotencyKey: `update:${id}:${crypto.randomUUID()}`, sampleSkuId: id, productId: sample.productId, name: name.trim(), descriptor: descriptor.trim(), unitSize: sample.unitSize, unitsPerPack: sample.unitsPerPack || 1, coldChain: sample.coldChain === true });
    } catch (err) {
      console.error(err);
      alert(isRtl ? "فشل تعديل صنف العينة" : "Failed to update Sample Variant");
    }
  };

  // Add sample variant action
  const handleAddSampleVariant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasSampleCapability(currentUser, "CREATE_SAMPLE_SKU", permissions)) return;
    const parentProduct = products.find(product => product.id === newProdName);
    if (!parentProduct) {
      setFormError(isRtl ? "يرجى تعبئة الحقول المطلوبة" : "Please fill out the required fields");
      return;
    }

    try {
      const descriptor = newProdBrand.trim() || "Trial";
      const freshSampleName = `${parentProduct.name} - ${descriptor}`;
      await mutateSampleVariant({ action: "CREATE", idempotencyKey: variantIdempotencyKey, productId: parentProduct.id, name: freshSampleName, descriptor, unitSize: newProdSize || undefined, unitsPerPack: newProdUnits || 1, coldChain: newProdCold });

      // Reset Form
      setNewProdName("");
      setNewProdBrand("");
      setNewProdSize("");
      setNewProdUnits(1);
      setNewProdCold(false);
      setNewProdInitialStock("");
      setShowAddModal(false);
      setFormError("");
    } catch (err) {
      console.error(err);
      setFormError(isRtl ? "فشل إنشاء منتج العينات" : "Failed to create sample variant");
    }
  };

  // Fix duplicates action (Interactive logic matching the screenshots duplicate visual issue)
  const handleMergeDuplicates = async () => {
    if (!hasSampleCapability(currentUser, "EDIT_SAMPLE_SKU", permissions)) return;
    const eramaxTrials = rawSamples.filter(s => s.name.startsWith("ERAMAX MILD"));
    const dermaLuminous = rawSamples.filter(s => s.name.startsWith("DERMA LUMINOUS CREAM"));

    try {
      // Merge Eramax
      if (eramaxTrials.length > 1) {
        const kept = eramaxTrials[0];
        for (const duplicate of eramaxTrials) {
          if (duplicate.id !== kept.id) {
            await setDoc(doc(db, "sampleCatalog", duplicate.id), decorateRecord({ ...duplicate, isDeleted: true }, currentUser.id, "update"));
          }
        }
      }

      // Merge Luminous
      if (dermaLuminous.length > 1) {
        const kept = dermaLuminous.find(d => d.status === "Active") || dermaLuminous[0];
        for (const duplicate of dermaLuminous) {
          if (duplicate.id !== kept.id) {
            await setDoc(doc(db, "sampleCatalog", duplicate.id), decorateRecord({ ...duplicate, isDeleted: true }, currentUser.id, "update"));
          }
        }
      }

      // Save Audit Log
      const logId = `AUD-${Math.floor(100000 + Math.random() * 900000)}`;
      await setDoc(doc(db, "auditLogs", logId), decorateRecord({
        id: logId,
        userId: currentUser.id,
        userName: currentUser.name,
        userRole: currentUser.role,
        action: "Sample Catalog De-duplicated",
        entityType: "SampleCatalog",
        entityId: "SYSTEM",
        details: "Executed interactive catalog de-duplication script to merge duplicate Eramax and Derma Luminous trial records",
        timestamp: new Date().toISOString()
      }, currentUser.id, "create"));

      setShowFixDuplicatesModal(false);
      alert(isRtl ? "تم دمج العينات المكررة وتصفية السجلات بنجاح!" : "Duplicate samples merged and catalog cleaned successfully!");
    } catch (err) {
      console.error(err);
      alert(isRtl ? "فشل دمج السجلات المكررة" : "Failed to merge duplicate entries");
    }
  };

  // File Upload drag drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setReceiptFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setReceiptFile(e.target.files[0]);
    }
  };

  // Process receipt
  const handleProcessReceiptSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasSampleCapability(currentUser, "RECEIVE_SAMPLE_STOCK", permissions)) return;
    if (!receiptProductId || !receiptQty || !receiptBatchNumber.trim() || !receiptExpiryDate) {
      alert(isRtl ? "يرجى اختيار العينة والدفعة والصلاحية والكمية" : "Sample SKU, batch, expiry, and quantity are required.");
      return;
    }

    const selectedSample = rawSamples.find(s => s.id === receiptProductId);
    if (!selectedSample) return;

    const amount = Number(receiptQty);
    
    try {
      await receiveSampleStock({ idempotencyKey: receiptIdempotencyKey, sampleSkuId: receiptProductId, batchNumber: receiptBatchNumber.trim(), expiryDate: receiptExpiryDate, quantity: amount, reference: receiptFile?.name || "Manual receipt" });

      // Reset
      setReceiptProductId("");
      setReceiptQty("");
      setReceiptBatchNumber("");
      setReceiptExpiryDate("");
      setReceiptFile(null);
      setShowUploadReceiptModal(false);
    } catch (err: any) {
      console.error(err);
      alert(err.message || (isRtl ? "فشل حفظ إيصال التوريد" : "Failed to record warehouse receipt"));
    }
  };

  // Open adjustment modal for specific product
  const handleOpenAdjust = (item: any) => {
    const batchItem = rawBatches.filter(candidate => candidate.sampleSkuId === (item.sampleSkuId || item.sampleId)).sort((a, b) => String(a.expiryDate).localeCompare(String(b.expiryDate)))[0];
    setSelectedAdjustProduct({ ...item, batchId: item.batchId || batchItem?.id, batchNumber: item.batchNumber || batchItem?.batchNumber });
    setAdjustQty(String(item.totalReceived ?? item.qty ?? 0));
    setAdjustAvailable(String(batchItem?.availableQuantity ?? item.availableQuantity ?? item.available ?? 0));
    setAdjustReason("Physical audit correction");
    setAdjustNotes("");
    setShowAdjustModal(true);
  };

  // Adjust stock submit
  const handleAdjustSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasSampleCapability(currentUser, "ADJUST_SAMPLE_STOCK", permissions)) return;
    if (!selectedAdjustProduct) return;

    const targetAvail = Number(adjustAvailable);
    if (!adjustReason.trim()) { alert(isRtl ? "سبب التسوية مطلوب" : "Adjustment reason is required."); return; }
    if (!selectedAdjustProduct.batchId) { alert(isRtl ? "لا توجد دفعة قابلة للتسوية" : "No canonical batch is available for adjustment."); return; }

    try {
      await adjustSampleStock({ idempotencyKey: crypto.randomUUID(), sampleSkuId: selectedAdjustProduct.sampleSkuId || selectedAdjustProduct.sampleId, batchId: selectedAdjustProduct.batchId, targetAvailableQuantity: targetAvail, reason: adjustReason, notes: adjustNotes });

      setShowAdjustModal(false);
      setSelectedAdjustProduct(null);
    } catch (err: any) {
      console.error(err);
      alert(err.message || (isRtl ? "فشل حفظ تسوية المخزون" : "Failed to record stock adjustment"));
    }
  };

  // Filter Catalog / Samples list
  const filteredSamples = samples.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          (item.descriptor || item.brand || "").toLowerCase().includes(searchTerm.toLowerCase());
    const matchesBrand = brandFilter === "All" || (item.descriptor || item.brand) === brandFilter;
    const matchesStatus = statusFilter === "All" || item.status === statusFilter;
    return matchesSearch && matchesBrand && matchesStatus;
  });

  // Filter Warehouse inventory
  const filteredWarehouse = warehouse.filter(item => {
    const matchesSearch = String(item.name || item.sampleSkuId || "").toLowerCase().includes(searchTerm.toLowerCase());
    return matchesSearch;
  });

  // Filter Transactions
  const filteredTransactions = transactions.filter(item => {
    const matchesSearch = String(item.product || item.sampleSkuId || "").toLowerCase().includes(searchTerm.toLowerCase()) || 
                          String(item.notes || "").toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = txTypeFilter === "All" || item.type === txTypeFilter;
    return matchesSearch && matchesType;
  });

  // Get unique brands for filters
  const uniqueBrands = Array.from(new Set(samples.map(s => s.descriptor || s.brand).filter(Boolean)));
  const sampleLabel = (sampleSkuId: string) => rawSamples.find(item => item.id === sampleSkuId)?.name || sampleSkuId;

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-2" id="sample-inventory-section">
      {/* Page Header */}
      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4 bg-white p-6 rounded-2xl border border-gray-100 shadow-xs">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight" id="page-title">
            {t.title}
          </h1>
          <p className="text-sm text-gray-500 mt-1" id="page-subtitle">
            {t.subtitle}
          </p>
        </div>
        
        {/* Top Header Controls (Dynamic layout similar to attachment) */}
        <div className="flex flex-wrap items-center gap-2.5 w-full xl:w-auto">
          <button 
            onClick={handleRefresh}
            className="p-2.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-all bg-white shadow-xs"
            title={t.btnRefresh}
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          
          {workspaceSection !== "inventory" && hasSampleCapability(currentUser, "EDIT_SAMPLE_SKU", permissions) && <button 
            onClick={() => setShowFixDuplicatesModal(true)}
            className="flex items-center gap-2 border border-amber-200 bg-amber-50/50 hover:bg-amber-50 text-amber-700 px-3.5 py-2.5 rounded-lg font-medium transition-all text-sm shadow-xs"
          >
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            <span>{t.btnFixDuplicates}</span>
          </button>}

          {workspaceSection !== "catalog" && hasSampleCapability(currentUser, "RECEIVE_SAMPLE_STOCK", permissions) && <button 
            onClick={() => { setReceiptIdempotencyKey(crypto.randomUUID()); setShowUploadReceiptModal(true); }}
            className="flex items-center gap-2 border border-gray-200 hover:bg-gray-50 text-gray-700 px-3.5 py-2.5 rounded-lg font-medium transition-all text-sm bg-white shadow-xs"
          >
            <Upload className="w-4 h-4 text-gray-500" />
            <span>{t.btnUploadReceipt}</span>
          </button>}

          {workspaceSection !== "inventory" && hasSampleCapability(currentUser, "CREATE_SAMPLE_SKU", permissions) && <button 
            onClick={() => { setVariantIdempotencyKey(crypto.randomUUID()); setShowAddModal(true); }}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-lg font-medium transition-all text-sm shadow-xs"
          >
            <Plus className="w-4 h-4" />
            <span>{t.btnAddVariant}</span>
          </button>}
        </div>
      </div>

      {/* KPI Stats Grid */}
      {workspaceSection !== "catalog" && <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-mono uppercase tracking-wider text-gray-400 font-semibold">{t.kpiTotalSamples}</p>
            <h3 className="text-3xl font-bold text-gray-800 mt-1 font-mono">
              {totalSamplesQuantity.toLocaleString()}
            </h3>
            <p className="text-xs text-gray-500 mt-1">
              {totalUniqueProductsCount} {t.kpiProducts}
            </p>
          </div>
          <div className="p-3.5 bg-indigo-50 text-indigo-600 rounded-xl">
            <Boxes className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-mono uppercase tracking-wider text-emerald-500 font-semibold">{t.kpiAvailable}</p>
            <h3 className="text-3xl font-bold text-emerald-600 mt-1 font-mono">
              {totalAvailableQuantity.toLocaleString()}
            </h3>
            <p className="text-xs text-emerald-500 mt-1 font-medium">
              {t.kpiReady}
            </p>
          </div>
          <div className="p-3.5 bg-emerald-50 text-emerald-600 rounded-xl">
            <Check className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-mono uppercase tracking-wider text-purple-500 font-semibold">{t.kpiActiveBatches}</p>
            <h3 className="text-3xl font-bold text-purple-600 mt-1 font-mono">
              {batchCounters.activeBatches}
            </h3>
            <p className="text-xs text-gray-500 mt-1">
              {batchCounters.totalBatches} {isRtl ? "إجمالي الدفعات" : "total batches"}
            </p>
          </div>
          <div className="p-3.5 bg-purple-50 text-purple-600 rounded-xl">
            <Layers className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-mono uppercase tracking-wider text-amber-500 font-semibold">{t.kpiExpiringSoon}</p>
            <h3 className="text-3xl font-bold text-amber-600 mt-1 font-mono">
              0
            </h3>
            <p className="text-xs text-gray-500 mt-1">
              {t.kpiWithinDays}
            </p>
          </div>
          <div className="p-3.5 bg-amber-50 text-amber-500 rounded-xl">
            <ShieldAlert className="w-6 h-6" />
          </div>
        </div>
      </div>}

      {/* Sub-Navigation Custom Tabs */}
      {workspaceSection !== "catalog" && <div className="flex border-b border-gray-200 gap-1 overflow-x-auto pb-0.5">
        {workspaceSection === "all" && (
        <button
          onClick={() => { setActiveTab("samples"); setSearchTerm(""); }}
          className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-all whitespace-nowrap ${
            activeTab === "samples"
              ? "border-indigo-600 text-indigo-600"
              : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
          }`}
        >
          <Boxes className="w-4 h-4" />
          <span>{t.tabSamples}</span>
          <span className="bg-gray-100 text-gray-600 text-[11px] font-mono px-2 py-0.5 rounded-full font-bold">
            {samples.length}
          </span>
        </button>)}

        <button
          onClick={() => { setActiveTab("batches"); setSearchTerm(""); }}
          className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-all whitespace-nowrap ${
            activeTab === "batches"
              ? "border-indigo-600 text-indigo-600"
              : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>{t.tabBatches}</span>
          <span className="bg-gray-100 text-gray-600 text-[11px] font-mono px-2 py-0.5 rounded-full font-bold">
            {batches.length}
          </span>
        </button>

        {hasSampleCapability(currentUser, "VIEW_SAMPLE_INVENTORY", permissions) && (
          <button
            onClick={() => { setActiveTab("warehouse"); setSearchTerm(""); }}
            className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-all whitespace-nowrap ${
              activeTab === "warehouse"
                ? "border-indigo-600 text-indigo-600"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            }`}
          >
            <Warehouse className="w-4 h-4" />
            <span>{t.tabWarehouse}</span>
            <span className="bg-gray-100 text-gray-600 text-[11px] font-mono px-2 py-0.5 rounded-full font-bold">
              {warehouse.length}
            </span>
          </button>
        )}

        <button
          onClick={() => { setActiveTab("transactions"); setSearchTerm(""); }}
          className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-all whitespace-nowrap ${
            activeTab === "transactions"
              ? "border-indigo-600 text-indigo-600"
              : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
          }`}
        >
          <Clock className="w-4 h-4" />
          <span>{t.tabTransactions}</span>
          <span className="bg-gray-100 text-gray-600 text-[11px] font-mono px-2 py-0.5 rounded-full font-bold">
            {transactions.length}
          </span>
        </button>
      </div>}

      {/* Dynamic Content based on Active Tab */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-xs overflow-hidden">
        
        {/* Filters Panel */}
        <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex flex-col md:flex-row gap-4 items-center justify-between">
          <div className="relative w-full md:flex-1">
            <Search className={`absolute top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4 ${isRtl ? "right-3.5" : "left-3.5"}`} />
            <input
              type="text"
              placeholder={t.searchPlaceholder}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className={`w-full py-2 bg-white text-sm border border-gray-200 focus:border-indigo-500 rounded-lg focus:outline-none transition-all ${
                isRtl ? "pr-10 pl-4" : "pl-10 pr-4"
              }`}
            />
          </div>

          <div className="flex flex-wrap gap-2.5 w-full md:w-auto">
            {activeTab === "samples" && (
              <>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-500 font-medium whitespace-nowrap">{t.filterBrand}:</span>
                  <select
                    value={brandFilter}
                    onChange={(e) => setBrandFilter(e.target.value)}
                    className="bg-white border border-gray-200 rounded-lg text-xs py-1.5 px-2.5 focus:outline-none"
                  >
                    <option value="All">{t.all}</option>
                    {uniqueBrands.map(brand => (
                      <option key={brand} value={brand}>{brand}</option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-500 font-medium whitespace-nowrap">{t.filterStatus}:</span>
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="bg-white border border-gray-200 rounded-lg text-xs py-1.5 px-2.5 focus:outline-none"
                  >
                    <option value="All">{t.all}</option>
                    <option value="Active">{t.statusActive}</option>
                    <option value="Discontinued">{t.statusDiscontinued}</option>
                  </select>
                </div>
              </>
            )}

            {activeTab === "warehouse" && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-gray-500 font-medium whitespace-nowrap">{t.filterRep}</span>
                <select
                  value={repFilter}
                  onChange={(e) => setRepFilter(e.target.value)}
                  className="bg-white border border-gray-200 rounded-lg text-xs py-1.5 px-2.5 focus:outline-none"
                >
                  <option value="All">{t.allReps}</option>
                  <option value="Omar">Omar Al-Fares</option>
                  <option value="Zaid">Zaid Al-Ibrahimi</option>
                </select>
              </div>
            )}

            {activeTab === "transactions" && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-gray-500 font-medium whitespace-nowrap">{t.filterTxType}:</span>
                <select
                  value={txTypeFilter}
                  onChange={(e) => setTxTypeFilter(e.target.value)}
                  className="bg-white border border-gray-200 rounded-lg text-xs py-1.5 px-2.5 focus:outline-none"
                >
                  <option value="All">{t.all}</option>
                  <option value="Distribution">Distribution</option>
                  <option value="Allocation">Allocation</option>
                  <option value="Warehouse Receipt">Warehouse Receipt</option>
                  <option value="Adjustment">Adjustment</option>
                </select>
              </div>
            )}
          </div>
        </div>

        {/* Tab content area */}
        <div>
          
          {/* TAB 1: SAMPLES */}
          {activeTab === "samples" && (
            <>
              {/* Desktop View */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-50/70 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      <th className={`py-4 px-6 ${isRtl ? "text-right" : "text-left"}`}>{t.colSampleName}</th>
                      <th className={`py-4 px-6 ${isRtl ? "text-right" : "text-left"}`}>{t.colParentProduct}</th>
                      <th className={`py-4 px-6 ${isRtl ? "text-right" : "text-left"}`}>{t.colUnitSize}</th>
                      <th className={`py-4 px-6 ${isRtl ? "text-right" : "text-left"}`}>{t.colUnitsPack}</th>
                      <th className="py-4 px-6 text-center">{t.colColdStorage}</th>
                      <th className="py-4 px-6 text-center">{t.colStatus}</th>
                      <th className="py-4 px-6 text-center">{t.colActions}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 text-sm text-gray-700">
                    {filteredSamples.map((item) => (
                      <tr key={item.id} className="hover:bg-gray-50/40 transition-all">
                        <td className={`py-4 px-6 font-semibold text-gray-900 ${isRtl ? "text-right" : "text-left"}`}>
                          {item.name}
                        </td>
                        <td className={`py-4 px-6 ${isRtl ? "text-right" : "text-left"} text-gray-400 font-mono text-xs`}>
                          {products.find(product => product.id === item.productId)?.name || item.productId || "—"}
                        </td>
                        <td className={`py-4 px-6 ${isRtl ? "text-right" : "text-left"} text-gray-500 font-mono text-xs`}>
                          {item.unitSize}
                        </td>
                        <td className={`py-4 px-6 ${isRtl ? "text-right" : "text-left"} text-gray-500 font-mono`}>
                          {item.unitsPerPack}
                        </td>
                        <td className="py-4 px-6 text-center">
                          {item.coldChain ? (
                            <span className="inline-flex items-center gap-1.5 text-blue-600 bg-blue-50 px-2.5 py-0.5 rounded-full text-xs font-semibold">
                              <ThermometerSnowflake className="w-3.5 h-3.5" />
                              {t.yes}
                            </span>
                          ) : (
                            <span className="text-gray-400 font-mono text-xs">—</span>
                          )}
                        </td>
                        <td className="py-4 px-6 text-center">
                          <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                            item.status === "ACTIVE" || item.status === "Active"
                              ? "bg-blue-50 text-blue-600" 
                              : "bg-gray-100 text-gray-500"
                          }`}>
                            {item.status === "ACTIVE" || item.status === "Active" ? t.statusActive : t.statusDiscontinued}
                          </span>
                        </td>
                        <td className="py-4 px-6 text-center">
                          <div className="flex items-center justify-center gap-2">
                            {hasSampleCapability(currentUser, "EDIT_SAMPLE_SKU", permissions) && <button onClick={() => handleEditSample(item.id)} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-all">
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>}
                            {hasSampleCapability(currentUser, "DEACTIVATE_SAMPLE_SKU", permissions) && <button 
                              onClick={() => handleDeleteSample(item.id)}
                              className="p-1.5 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-all"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>}
                          </div>
                        </td>
                      </tr>
                    ))}

                    {filteredSamples.length === 0 && (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-gray-400">
                          {isRtl ? "لا توجد عينات متوفرة في الدليل." : "No samples available in catalog."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Mobile Card List View */}
              <div className="block md:hidden divide-y divide-gray-100">
                {filteredSamples.map((item) => (
                  <div key={item.id} className="p-4 space-y-3 hover:bg-gray-50/20 transition-all text-xs">
                    <div className={`flex justify-between items-start gap-2 ${isRtl ? "flex-row-reverse text-right" : "flex-row"}`}>
                      <div>
                        <h4 className="font-semibold text-gray-900 text-sm">{item.name}</h4>
                        <p className="text-gray-400 text-[10px] mt-0.5">{item.unitSize} • {item.unitsPerPack} packs</p>
                      </div>
                      <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-semibold shrink-0 ${
                        item.status === "ACTIVE" || item.status === "Active"
                          ? "bg-blue-50 text-blue-600" 
                          : "bg-gray-100 text-gray-500"
                      }`}>
                        {item.status === "ACTIVE" || item.status === "Active" ? t.statusActive : t.statusDiscontinued}
                      </span>
                    </div>

                    <div className={`flex items-center gap-2 ${isRtl ? "justify-end" : "justify-start"}`}>
                      {item.coldChain ? (
                        <span className="inline-flex items-center gap-1 text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md text-[10px] font-semibold">
                          <ThermometerSnowflake className="w-3 h-3" />
                          {t.colColdStorage}: {t.yes}
                        </span>
                      ) : null}
                    </div>

                    <div className="flex items-center pt-2 border-t border-gray-50 justify-between">
                      <span className="text-[10px] text-gray-400 font-mono">ID: {item.id}</span>
                      <div className="flex items-center gap-1.5">
                        {hasSampleCapability(currentUser, "EDIT_SAMPLE_SKU", permissions) && <button onClick={() => handleEditSample(item.id)} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-all cursor-pointer">
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>}
                        {hasSampleCapability(currentUser, "DEACTIVATE_SAMPLE_SKU", permissions) && <button 
                          onClick={() => handleDeleteSample(item.id)}
                          className="p-1.5 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-all cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>}
                      </div>
                    </div>
                  </div>
                ))}

                {filteredSamples.length === 0 && (
                  <div className="p-8 text-center text-gray-400">
                    {isRtl ? "لا توجد عينات متوفرة في الدليل." : "No samples available in catalog."}
                  </div>
                )}
              </div>
            </>
          )}

          {/* TAB 2: BATCH MANAGEMENT */}
          {activeTab === "batches" && (
            <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="bg-gray-50 text-xs uppercase text-gray-500"><th className="p-4">Sample Variant</th><th className="p-4">Batch</th><th className="p-4">Expiry</th><th className="p-4 text-center">Received</th><th className="p-4 text-center">Available</th><th className="p-4 text-center">Status</th><th className="p-4"></th></tr></thead><tbody className="divide-y divide-gray-100">{batches.map(item => <tr key={item.id}><td className="p-4"><span className="font-semibold">{sampleLabel(item.sampleSkuId)}</span><small className="block font-mono text-gray-400">{item.sampleSkuId}</small></td><td className="p-4 font-mono">{item.batchNumber}</td><td className="p-4 font-mono">{item.expiryDate}</td><td className="p-4 text-center">{item.receivedQuantity}</td><td className="p-4 text-center font-bold">{item.availableQuantity}</td><td className="p-4 text-center">{item.status}</td><td className="p-4">{hasSampleCapability(currentUser, "ADJUST_SAMPLE_STOCK", permissions) && <button onClick={() => handleOpenAdjust({ id: item.sampleSkuId, sampleSkuId: item.sampleSkuId, name: sampleLabel(item.sampleSkuId), totalReceived: item.receivedQuantity, availableQuantity: item.availableQuantity, batchId: item.id, batchNumber: item.batchNumber })} className="text-indigo-600 text-xs font-bold">Adjust</button>}</td></tr>)}{batches.length === 0 && <tr><td colSpan={7} className="p-10 text-center text-gray-400">{t.noBatchesFound}</td></tr>}</tbody></table></div>
          )}

          {/* TAB 3: WAREHOUSE INVENTORY */}
          {activeTab === "warehouse" && (
            <>
              {/* Desktop View */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-50/70 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      <th className={`py-4 px-6 ${isRtl ? "text-right" : "text-left"}`}>{t.colProduct}</th>
                      <th className={`py-4 px-6 ${isRtl ? "text-right" : "text-left"}`}>{t.colBatch}</th>
                      <th className="py-4 px-6 text-center">{t.colWarehouseQty}</th>
                      <th className="py-4 px-6 text-center">{t.colAvailable}</th>
                      <th className="py-4 px-6 text-center">{t.colMedRepsStock}</th>
                      <th className="py-4 px-6 text-center">{t.colReorderLevel}</th>
                      <th className="py-4 px-6 text-center">{t.colActions}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 text-sm text-gray-700">
                    {filteredWarehouse.map((item, index) => (
                      <tr key={index} className="hover:bg-gray-50/40 transition-all">
                        <td className={`py-4 px-6 ${isRtl ? "text-right" : "text-left"}`}>
                          <div>
                            <span className="font-semibold text-gray-900 block">{item.name}</span>
                            {item.isWarning && (
                              <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-bold px-2 py-0.5 rounded-md mt-1">
                                <AlertTriangle className="w-3 h-3 text-amber-500" />
                                No stock record
                              </span>
                            )}
                          </div>
                        </td>
                        <td className={`py-4 px-6 ${isRtl ? "text-right" : "text-left"} text-gray-500 font-mono text-xs`}>
                          {item.batch}
                        </td>
                        <td className="py-4 px-6 text-center font-mono font-semibold text-gray-700 text-sm">
                          {item.qty}
                        </td>
                        <td className="py-4 px-6 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <span className={`font-mono font-bold ${item.available <= 15 && item.available > 0 ? "text-amber-600" : item.available === 0 ? "text-rose-600" : "text-gray-900"}`}>
                              {item.available}
                            </span>
                            {item.available <= 15 && (
                              <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                            )}
                          </div>
                        </td>
                        <td className="py-4 px-6 text-center">
                          {item.repsStock > 0 ? (
                            <span className="text-blue-600 hover:underline font-mono cursor-pointer font-semibold">
                              {item.repsStock}
                            </span>
                          ) : (
                            <span className="text-gray-400 font-mono text-xs">—</span>
                          )}
                        </td>
                        <td className="py-4 px-6 text-center font-mono text-gray-400 text-xs">
                          {item.qty > 0 ? item.reorder : "—"}
                        </td>
                        <td className="py-4 px-6 text-center">
                          {item.qty > 0 ? (
                            hasSampleCapability(currentUser, "ADJUST_SAMPLE_STOCK", permissions) ? <button
                              onClick={() => handleOpenAdjust(item)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-semibold text-gray-700 bg-white hover:bg-gray-50 transition-all shadow-xs"
                            >
                              <Settings2 className="w-3.5 h-3.5 text-gray-400" />
                              <span>Adjust</span>
                            </button> : null
                          ) : (
                            <span className="text-gray-300 font-mono">—</span>
                          )}
                        </td>
                      </tr>
                    ))}

                    {filteredWarehouse.length === 0 && (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-gray-400">
                          {isRtl ? "لا يوجد مخزون عينات متوفر بالمستودع." : "No sample stock available in warehouse."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Mobile Card List View */}
              <div className="block md:hidden divide-y divide-gray-100">
                {filteredWarehouse.map((item, index) => (
                  <div key={index} className="p-4 space-y-3 hover:bg-gray-50/20 transition-all text-xs">
                    <div className={`flex justify-between items-start gap-2 ${isRtl ? "flex-row-reverse text-right" : "flex-row"}`}>
                      <div className="space-y-1">
                        <h4 className="font-semibold text-gray-900 text-sm leading-tight">{item.name}</h4>
                        <p className="text-gray-400 font-mono text-[10px]">{t.colBatch}: {item.batch}</p>
                      </div>
                      {item.isWarning && (
                        <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-800 border border-amber-200 text-[9px] font-bold px-1.5 py-0.5 rounded-md shrink-0">
                          <AlertTriangle className="w-2.5 h-2.5 text-amber-500" />
                          No stock record
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2 bg-gray-50/50 rounded-lg p-2 text-center text-[11px] font-mono border border-gray-100/50">
                      <div>
                        <p className="text-gray-400 text-[9px] uppercase tracking-wider font-sans mb-0.5">{t.colWarehouseQty || "In Warehouse"}</p>
                        <p className="font-bold text-gray-800">{item.qty}</p>
                      </div>
                      <div>
                        <p className="text-gray-400 text-[9px] uppercase tracking-wider font-sans mb-0.5">{t.colAvailable || "Available"}</p>
                        <p className={`font-bold inline-flex items-center gap-0.5 ${item.available <= 15 && item.available > 0 ? "text-amber-600" : item.available === 0 ? "text-rose-600" : "text-gray-900"}`}>
                          {item.available}
                          {item.available <= 15 && <AlertTriangle className="w-2.5 h-2.5 text-amber-500" />}
                        </p>
                      </div>
                      <div>
                        <p className="text-gray-400 text-[9px] uppercase tracking-wider font-sans mb-0.5">{t.colMedRepsStock || "Rep Stock"}</p>
                        <p className="font-bold text-blue-600">{item.repsStock}</p>
                      </div>
                      <div>
                        <p className="text-gray-400 text-[9px] uppercase tracking-wider font-sans mb-0.5">{t.colReorderLevel || "Reorder"}</p>
                        <p className="font-bold text-gray-400">{item.qty > 0 ? item.reorder : "—"}</p>
                      </div>
                    </div>

                    <div className={`flex items-center pt-2 border-t border-gray-50 ${isRtl ? "justify-start" : "justify-end"}`}>
                      {item.qty > 0 ? (
                        hasSampleCapability(currentUser, "ADJUST_SAMPLE_STOCK", permissions) ? <button
                          onClick={() => handleOpenAdjust(item)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-gray-200 text-[10px] font-semibold text-gray-700 bg-white hover:bg-gray-50 transition-all shadow-xs cursor-pointer"
                        >
                          <Settings2 className="w-3.5 h-3.5 text-gray-400" />
                          <span>Adjust</span>
                        </button> : null
                      ) : (
                        <span className="text-gray-300 font-mono text-[10px]">—</span>
                      )}
                    </div>
                  </div>
                ))}

                {filteredWarehouse.length === 0 && (
                  <div className="p-8 text-center text-gray-400">
                    {isRtl ? "لا يوجد مخزون عينات متوفر بالمستودع." : "No sample stock available in warehouse."}
                  </div>
                )}
              </div>
            </>
          )}

          {/* TAB 4: TRANSACTIONS */}
          {activeTab === "transactions" && (
            <>
              {/* Desktop View */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-50/70 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      <th className={`py-4 px-6 ${isRtl ? "text-right" : "text-left"}`}>{t.colDateTime}</th>
                      <th className={`py-4 px-6 ${isRtl ? "text-right" : "text-left"}`}>{t.colType}</th>
                      <th className={`py-4 px-6 ${isRtl ? "text-right" : "text-left"}`}>{t.colProduct}</th>
                      <th className="py-4 px-6 text-center">{t.colQuantity}</th>
                      <th className="py-4 px-6 text-center">{t.colInvChange}</th>
                      <th className={`py-4 px-6 ${isRtl ? "text-right" : "text-left"}`}>{t.colSource}</th>
                      <th className={`py-4 px-6 ${isRtl ? "text-right" : "text-left"}`}>{t.colReason}</th>
                      <th className={`py-4 px-6 ${isRtl ? "text-right" : "text-left"}`}>{t.colNotes}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 text-xs font-medium text-gray-700">
                    {filteredTransactions.map((tx) => {
                      const isNegative = tx.qty < 0;
                      return (
                        <tr key={tx.id} className="hover:bg-gray-50/40 transition-all">
                          <td className={`py-4 px-6 font-mono text-gray-500 whitespace-nowrap ${isRtl ? "text-right" : "text-left"}`}>
                            {tx.datetime}
                          </td>
                          <td className={`py-4 px-6 ${isRtl ? "text-right" : "text-left"}`}>
                            <span className={`inline-flex px-2 py-0.5 rounded font-semibold text-[10px] uppercase tracking-wide ${
                              tx.type === "Distribution"
                                ? "bg-slate-50 text-slate-700 border border-slate-200"
                                : tx.type === "Allocation"
                                ? "bg-rose-50 text-rose-700 border border-rose-200/50"
                                : tx.type === "Warehouse Receipt"
                                ? "bg-blue-50 text-blue-700 border border-blue-200/50"
                                : "bg-amber-50 text-amber-700 border border-amber-200/50"
                            }`}>
                              {tx.type}
                            </span>
                          </td>
                          <td className={`py-4 px-6 font-semibold text-gray-900 ${isRtl ? "text-right" : "text-left"}`}>
                            {tx.product}
                          </td>
                          <td className="py-4 px-6 text-center font-mono font-bold text-sm">
                            <span className={isNegative ? "text-rose-600" : "text-emerald-600"}>
                              {isNegative ? tx.qty : `+${tx.qty}`}
                            </span>
                          </td>
                          <td className="py-4 px-6 text-center font-mono font-semibold text-gray-600">
                            {tx.change}
                          </td>
                          <td className={`py-4 px-6 font-mono text-gray-500 ${isRtl ? "text-right" : "text-left"}`}>
                            {tx.source}
                          </td>
                          <td className={`py-4 px-6 text-gray-500 ${isRtl ? "text-right" : "text-left"}`}>
                            {tx.reason}
                          </td>
                          <td className={`py-4 px-6 text-gray-500 max-w-xs truncate ${isRtl ? "text-right" : "text-left"}`} title={tx.notes}>
                            {tx.notes}
                          </td>
                        </tr>
                      );
                    })}

                    {filteredTransactions.length === 0 && (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-gray-400">
                          {isRtl ? "لا توجد حركات مخزنية متطابقة." : "No matching transaction records."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Mobile Card List View */}
              <div className="block md:hidden divide-y divide-gray-100">
                {filteredTransactions.map((tx) => {
                  const isNegative = tx.qty < 0;
                  return (
                    <div key={tx.id} className="p-4 space-y-3 hover:bg-gray-50/20 transition-all text-xs">
                      <div className={`flex justify-between items-start gap-2 ${isRtl ? "flex-row-reverse text-right" : "flex-row"}`}>
                        <div>
                          <span className={`inline-flex px-2 py-0.5 rounded font-semibold text-[9px] uppercase tracking-wide ${
                            tx.type === "Distribution"
                              ? "bg-slate-50 text-slate-700 border border-slate-200"
                              : tx.type === "Allocation"
                              ? "bg-rose-50 text-rose-700 border border-rose-200/50"
                              : tx.type === "Warehouse Receipt"
                              ? "bg-blue-50 text-blue-700 border border-blue-200/50"
                              : "bg-amber-50 text-amber-700 border border-amber-200/50"
                          }`}>
                            {tx.type}
                          </span>
                          <p className="text-gray-400 font-mono text-[9px] mt-1">{tx.datetime}</p>
                        </div>

                        <div className="text-right shrink-0">
                          <span className={`font-mono font-extrabold text-sm ${isNegative ? "text-rose-600" : "text-emerald-600"}`}>
                            {isNegative ? tx.qty : `+${tx.qty}`}
                          </span>
                          <p className="text-gray-400 font-mono text-[9px] mt-0.5">{t.colInvChange}: {tx.change}</p>
                        </div>
                      </div>

                      <div className={`space-y-1 ${isRtl ? "text-right" : "text-left"}`}>
                        <p className="font-semibold text-gray-900 text-xs">{tx.product}</p>
                        <p className="text-[10px] text-gray-500 font-mono"><span className="text-gray-400 font-sans">Source:</span> {tx.source}</p>
                      </div>

                      {(tx.reason || tx.notes) && (
                        <div className={`text-[10px] bg-gray-50/50 rounded p-2 border border-gray-100 space-y-1 ${isRtl ? "text-right" : "text-left"}`}>
                          {tx.reason && (
                            <p className="text-gray-600"><span className="text-gray-400 font-semibold uppercase text-[8px] tracking-wider mr-1">Reason:</span>{tx.reason}</p>
                          )}
                          {tx.notes && (
                            <p className="text-gray-500 italic"><span className="text-gray-400 font-semibold uppercase text-[8px] tracking-wider mr-1">Notes:</span>{tx.notes}</p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                {filteredTransactions.length === 0 && (
                  <div className="p-8 text-center text-gray-400">
                    {isRtl ? "لا توجد حركات مخزنية متطابقة." : "No matching transaction records."}
                  </div>
                )}
              </div>
            </>
          )}

        </div>
      </div>

      {/* MODAL: ADD SAMPLE VARIANT */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-gray-100 max-w-lg w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h3 className="font-bold text-gray-800 text-lg">{t.titleAddVariant}</h3>
              <button onClick={() => setShowAddModal(false)} className="text-gray-400 hover:text-gray-600 text-xl font-bold">&times;</button>
            </div>
            
            <form onSubmit={handleAddSampleVariant} className="p-6 space-y-4">
              {formError && (
                <div className="p-3 rounded-lg bg-rose-50 text-rose-700 text-xs flex gap-2 items-center">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block">{isRtl ? "المنتج الأساسي" : "Canonical Parent Product"} *</label>
                  <select
                    required
                    value={newProdName}
                    onChange={(e) => setNewProdName(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-lg text-sm p-2.5 focus:outline-none focus:border-indigo-500"
                  ><option value="">{isRtl ? "اختر المنتج" : "Select Product"}</option>{products.map(product => <option key={product.id} value={product.id}>{product.name} ({product.id})</option>)}</select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block">{isRtl ? "الوصف / النوع" : "Descriptor / Type"} *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Trial, Reduced Sample"
                    value={newProdBrand}
                    onChange={(e) => setNewProdBrand(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-lg text-sm p-2.5 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block">{t.labelUnitSize}</label>
                  <input
                    type="text"
                    placeholder="e.g. 75G, 150ML"
                    value={newProdSize}
                    onChange={(e) => setNewProdSize(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-lg text-sm p-2.5 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block">{t.labelUnitsPack}</label>
                  <input
                    type="number"
                    min="1"
                    value={newProdUnits}
                    onChange={(e) => setNewProdUnits(Number(e.target.value))}
                    className="w-full bg-gray-50 border border-gray-200 rounded-lg text-sm p-2.5 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="coldchain-new-checkbox"
                  checked={newProdCold}
                  onChange={(e) => setNewProdCold(e.target.checked)}
                  className="w-4.5 h-4.5 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                />
                <label htmlFor="coldchain-new-checkbox" className="text-sm font-medium text-gray-700 cursor-pointer flex items-center gap-1.5">
                  <ThermometerSnowflake className="w-4.5 h-4.5 text-blue-500" />
                  <span>{t.labelColdChain}</span>
                </label>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 border border-gray-200 text-gray-500 rounded-lg text-sm font-medium hover:bg-gray-50"
                >
                  {t.labelCancel}
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-[#1a73e8] hover:bg-[#1557b0] text-white rounded-lg text-sm font-semibold shadow-xs"
                >
                  {t.labelAdd}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: FIX DUPLICATES */}
      {showFixDuplicatesModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-gray-100 max-w-md w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h3 className="font-bold text-gray-800 text-base">{t.titleFixDuplicates}</h3>
              <button onClick={() => setShowFixDuplicatesModal(false)} className="text-gray-400 hover:text-gray-600 text-xl font-bold">&times;</button>
            </div>
            
            <div className="p-6 space-y-4">
              <div className="p-3 bg-amber-50 text-amber-800 border border-amber-200 rounded-xl text-xs flex gap-2.5">
                <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
                <div>
                  <span className="font-semibold block">System Audit: Duplicates Found</span>
                  <span className="mt-0.5 block">The following samples are duplicated in the catalog:</span>
                </div>
              </div>

              <div className="divide-y divide-gray-100">
                <div className="py-2.5 flex justify-between text-xs font-semibold">
                  <span className="text-gray-700">ERAMAX MILD - Trial</span>
                  <span className="text-rose-600 bg-rose-50 px-2 py-0.5 rounded">2 records</span>
                </div>
                <div className="py-2.5 flex justify-between text-xs font-semibold">
                  <span className="text-gray-700">DERMA LUMINOUS CREAM - Trial</span>
                  <span className="text-rose-600 bg-rose-50 px-2 py-0.5 rounded">2 records</span>
                </div>
              </div>

              <p className="text-xs text-gray-500">
                Clicking merge will automatically combine any sales stats, clean duplicate records, and keep the Catalog neat and accurate.
              </p>

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setShowFixDuplicatesModal(false)}
                  className="px-4 py-2 border border-gray-200 text-gray-500 rounded-lg text-sm font-medium hover:bg-gray-50"
                >
                  {t.labelCancel}
                </button>
                <button
                  onClick={handleMergeDuplicates}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-semibold shadow-xs flex items-center gap-1.5"
                >
                  <Check className="w-4 h-4" />
                  <span>{t.labelMerge}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: UPLOAD RECEIPT */}
      {showUploadReceiptModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-gray-100 max-w-lg w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h3 className="font-bold text-gray-800 text-lg">{t.titleUploadReceipt}</h3>
              <button onClick={() => setShowUploadReceiptModal(false)} className="text-gray-400 hover:text-gray-600 text-xl font-bold">&times;</button>
            </div>

            <form onSubmit={handleProcessReceiptSubmit} className="p-6 space-y-4">
              {/* Drag and Drop Zone */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-2xl p-6 text-center transition-all ${
                  isDragging 
                    ? "border-indigo-500 bg-indigo-50/50" 
                    : "border-gray-200 bg-gray-50 hover:bg-gray-100/50"
                }`}
              >
                <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                <p className="text-sm font-semibold text-gray-700">{t.labelSelectFile}</p>
                <p className="text-xs text-gray-400 mt-1">Supports PDF receipts, Excel, CSV or PNG delivery invoice copies</p>
                
                <input
                  type="file"
                  id="receipt-file-input"
                  onChange={handleFileChange}
                  className="hidden"
                  accept=".pdf,.csv,.xlsx,.xls,.png,.jpg,.jpeg"
                />
                <button
                  type="button"
                  onClick={() => document.getElementById("receipt-file-input")?.click()}
                  className="mt-3 px-3 py-1.5 bg-white border border-gray-200 text-xs font-semibold rounded-lg text-gray-700 shadow-xs hover:bg-gray-50"
                >
                  Browse Files
                </button>

                {receiptFile && (
                  <div className="mt-4 p-2 bg-emerald-50 text-emerald-800 text-xs rounded-lg flex items-center justify-center gap-1.5 font-semibold">
                    <FileText className="w-4 h-4 text-emerald-600" />
                    <span className="truncate max-w-[200px]">{receiptFile.name}</span>
                    <span className="text-[10px] text-emerald-600">({(receiptFile.size / 1024).toFixed(1)} KB)</span>
                  </div>
                )}
              </div>

              {/* Product Select */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block">{t.labelReceiptProduct} *</label>
                <select
                  required
                  value={receiptProductId}
                  onChange={(e) => setReceiptProductId(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg text-sm p-2.5 focus:outline-none focus:border-indigo-500"
                >
                  <option value="">{isRtl ? "-- اختر عينة منتج --" : "-- Choose Sample Product --"}</option>
                  {samples.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>

              {/* Quantity */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block">{isRtl ? "رقم الدفعة" : "Batch Number"} *</label>
                  <input required value={receiptBatchNumber} onChange={e => setReceiptBatchNumber(e.target.value)} className="w-full bg-gray-50 border border-gray-200 rounded-lg text-sm p-2.5 focus:outline-none focus:border-indigo-500 font-mono" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block">{isRtl ? "تاريخ الانتهاء" : "Expiry Date"} *</label>
                  <input type="date" required value={receiptExpiryDate} onChange={e => setReceiptExpiryDate(e.target.value)} className="w-full bg-gray-50 border border-gray-200 rounded-lg text-sm p-2.5 focus:outline-none focus:border-indigo-500 font-mono" />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block">{t.labelQtyToAdd} *</label>
                <input
                  type="number"
                  required
                  min="1"
                  placeholder="e.g. 100"
                  value={receiptQty}
                  onChange={(e) => setReceiptQty(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg text-sm p-2.5 focus:outline-none focus:border-indigo-500 font-mono"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setShowUploadReceiptModal(false)}
                  className="px-4 py-2 border border-gray-200 text-gray-500 rounded-lg text-sm font-medium hover:bg-gray-50"
                >
                  {t.labelCancel}
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-[#1a73e8] hover:bg-[#1557b0] text-white rounded-lg text-sm font-semibold shadow-xs"
                >
                  {t.labelUpload}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: ADJUST WAREHOUSE STOCK */}
      {showAdjustModal && selectedAdjustProduct && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-gray-100 max-w-md w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h3 className="font-bold text-gray-800 text-base">{t.titleAdjustStock}</h3>
              <button onClick={() => { setShowAdjustModal(false); setSelectedAdjustProduct(null); }} className="text-gray-400 hover:text-gray-600 text-xl font-bold">&times;</button>
            </div>

            <form onSubmit={handleAdjustSubmit} className="p-6 space-y-4">
              <div>
                <span className="text-xs font-bold text-indigo-600 uppercase tracking-wider block">Target Product</span>
                <span className="text-base font-bold text-gray-900 mt-0.5 block">{selectedAdjustProduct.name}</span>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block">{t.labelWarehouseQty}</label>
                  <input
                    type="number"
                    required
                    min="0"
                    value={adjustQty}
                    onChange={(e) => setAdjustQty(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-lg text-sm p-2.5 focus:outline-none focus:border-indigo-500 font-mono font-bold"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block">{t.labelAvailableQty}</label>
                  <input
                    type="number"
                    required
                    min="0"
                    value={adjustAvailable}
                    onChange={(e) => setAdjustAvailable(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-lg text-sm p-2.5 focus:outline-none focus:border-indigo-500 font-mono font-bold"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block">{t.labelReason}</label>
                <select
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg text-sm p-2.5 focus:outline-none focus:border-indigo-500"
                >
                  <option value="Physical audit correction">{t.labelAudit}</option>
                  <option value="Damaged goods">{t.labelDamaged}</option>
                  <option value="Transfer adjustment">{t.labelTransfer}</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block">{t.labelWriteNotes}</label>
                <textarea
                  placeholder="Enter adjustment notes or context..."
                  value={adjustNotes}
                  onChange={(e) => setAdjustNotes(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg text-sm p-2.5 focus:outline-none focus:border-indigo-500 h-20"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => { setShowAdjustModal(false); setSelectedAdjustProduct(null); }}
                  className="px-4 py-2 border border-gray-200 text-gray-500 rounded-lg text-sm font-medium hover:bg-gray-50"
                >
                  {t.labelCancel}
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-semibold shadow-xs"
                >
                  {t.labelAdjust}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
