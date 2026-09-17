import React, { useState } from "react";
import { 
  Package, 
  Layers, 
  TrendingUp, 
  AlertTriangle, 
  FileText, 
  Calendar, 
  Search, 
  Plus, 
  ShieldCheck, 
  Truck, 
  CheckCircle2, 
  Sliders,
  Upload,
  Download,
  Clock,
  Check,
  FileSpreadsheet,
  BarChart3,
  PieChart as PieIcon,
  Activity,
  Award
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area
} from "recharts";

interface InventoryManagerProps {
  currentUser: any;
  lang: "en" | "ar";
  initialTab?: "stock" | "batches" | "orders" | "bulk" | "warehouse" | "reports";
}

interface BatchRecord {
  id: string;
  productName: string;
  productNameAr: string;
  expirationDate: string;
  stockLevel: number;
  status: "Optimal" | "Action Required" | "Priority Dispatch";
  statusAr: string;
}

interface PurchaseOrder {
  id: string;
  supplier: string;
  supplierAr: string;
  targetWarehouse: string;
  targetWarehouseAr: string;
  amount: number;
  status: "In Transit" | "Completed" | "Pending Approval";
  statusAr: string;
}

const mockBatches: BatchRecord[] = [
  {
    id: "BCH-CARD-0912",
    productName: "CardioMax 10mg",
    productNameAr: "كاردو ماكس ١٠ ملغ",
    expirationDate: "2028-04-12",
    stockLevel: 42000,
    status: "Optimal",
    statusAr: "ممتاز / مستقر"
  },
  {
    id: "BCH-KIDV-0824",
    productName: "KidVits Chewable",
    productNameAr: "كيد فيتس حبوب مضغ للأطفال",
    expirationDate: "2027-11-30",
    stockLevel: 28500,
    status: "Priority Dispatch",
    statusAr: "أولوية التوزيع (أولاً بأول)"
  },
  {
    id: "BCH-ORTH-0422",
    productName: "OrthoFlex Gel",
    productNameAr: "أورثو فليكس جل للمفاصل",
    expirationDate: "2026-10-15",
    stockLevel: 3400,
    status: "Action Required",
    statusAr: "تنبيه قرب انتهاء الصلاحية"
  }
];

const mockPOs: PurchaseOrder[] = [
  {
    id: "PO-2026-11",
    supplier: "MENA Pharma Manufacturing",
    supplierAr: "مينا فارما للتصنيع الدوائي",
    targetWarehouse: "Tripoli Central Depot",
    targetWarehouseAr: "مستودع طرابلس المركزي",
    amount: 145000,
    status: "In Transit",
    statusAr: "قيد الشحن والتخليص"
  },
  {
    id: "PO-2026-12",
    supplier: "Jordan Med-Supply Group",
    supplierAr: "مجموعة التوريدات الطبية الأردنية",
    targetWarehouse: "Amman Distribution Hub",
    targetWarehouseAr: "مستودع عمان الإقليمي",
    amount: 98000,
    status: "Completed",
    statusAr: "تم الاستلام والمطابقة"
  }
];

export default function InventoryManager({ currentUser, lang, initialTab = "stock" }: InventoryManagerProps) {
  const isRtl = lang === "ar";
  
  const [activeTab, setActiveTab] = useState<"stock" | "batches" | "orders" | "bulk" | "warehouse" | "reports">(initialTab);
  const [batches, setBatches] = useState<BatchRecord[]>(mockBatches);
  const [orders, setOrders] = useState<PurchaseOrder[]>(mockPOs);

  // Bulk uploads state
  const [dragActive, setDragActive] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<string | null>(null);
  const [bulkHistory, setBulkHistory] = useState([
    { id: "BLK-INV-0912", filename: "Tripoli_Warehouse_Settle_June.xlsx", user: "John Doe", count: "48 lines", status: "Succeeded", date: "2026-06-25" },
    { id: "BLK-INV-0913", filename: "East_Samples_Allocation_Draft.xlsx", user: "Sarah Al-Sharif", count: "94 lines", status: "Succeeded", date: "2026-06-22" }
  ]);

  // Warehouse dispatches state
  const [dispatches, setDispatches] = useState([
    { id: "DSP-2026-041", destination: "Al-Farabi Pharmacy Group", destAr: "مجموعة صيدليات الفارابي", courier: "Logistics Rep Omar", weight: "42.5 kg", status: "Loaded & En Route", statusAr: "تم التحميل وفي الطريق" },
    { id: "DSP-2026-042", destination: "Central Hospital Pharmacy", destAr: "صيدلية المستشفى المركزي", courier: "Logistics Rep Sarah", weight: "180.0 kg", status: "Waiting Courier", statusAr: "بانتظار شركة الشحن" },
    { id: "DSP-2026-043", destination: "Ibn Sina Pharmacy East", destAr: "صيدلية ابن سينا الشرقية", courier: "Logistics Rep Tarek", weight: "12.8 kg", status: "Completed", statusAr: "تم التسليم بنجاح" }
  ]);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      simulateUpload(file.name);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      simulateUpload(e.target.files[0].name);
    }
  };

  const simulateUpload = (filename: string) => {
    setUploadedFile(filename);
    setUploadSuccess(true);
    const newId = `BLK-INV-09${Math.floor(10 + Math.random() * 90)}`;
    setBulkHistory([
      { id: newId, filename, user: currentUser?.name || "System Admin", count: "142 lines", status: "Succeeded", date: "2026-06-27" },
      ...bulkHistory
    ]);
    setTimeout(() => {
      setUploadSuccess(false);
    }, 4000);
  };

  const handleAddPO = () => {
    const newPo: PurchaseOrder = {
      id: `PO-2026-${orders.length + 12}`,
      supplier: "Global Pharma Imports Inc.",
      supplierAr: "العالمية للاستيراد الدوائي",
      targetWarehouse: "Tripoli Central Depot",
      targetWarehouseAr: "مستودع طرابلس المركزي",
      amount: 72000,
      status: "Pending Approval",
      statusAr: "قيد المراجعة والاعتماد"
    };
    setOrders([newPo, ...orders]);
  };

  return (
    <div className="p-4 md:p-6 max-w-full overflow-x-hidden space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      
      {/* Header section */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-950 flex items-center justify-center text-indigo-600 dark:text-indigo-400 shrink-0">
              <Package size={22} />
            </div>
            <div>
              <h2 className="text-lg md:text-xl font-bold text-slate-900 dark:text-white">
                {isRtl ? "إدارة المخازن والمخزون الدوائي" : "Inventory & Batch Safeguards"}
              </h2>
              <p className="text-[11px] md:text-xs text-slate-500 dark:text-slate-400 mt-0.5 max-w-xl">
                {isRtl ? "تتبع صلاحية التشغيلات بالأقدمية FIFO، فحص مستويات الأمان بالمستودعات، وإصدار أوامر التوريد" : "Trace pharmaceutical batch expirations, monitor safety stock levels, and issue commercial purchase orders."}
              </p>
            </div>
          </div>
        </div>

        {/* Tab selection */}
        <div className="flex flex-wrap gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg text-[10px] md:text-xs font-bold max-w-full">
          <button 
            onClick={() => setActiveTab("stock")}
            className={`px-2.5 py-1.5 rounded-md transition-all cursor-pointer ${activeTab === "stock" ? "bg-white dark:bg-slate-900 text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
          >
            {isRtl ? "أرصدة المستودعات" : "Warehouse Stocks"}
          </button>
          <button 
            onClick={() => setActiveTab("batches")}
            className={`px-2.5 py-1.5 rounded-md transition-all cursor-pointer ${activeTab === "batches" ? "bg-white dark:bg-slate-900 text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
          >
            {isRtl ? "التشغيلات والصلاحية" : "Batch Expiry"}
          </button>
          <button 
            onClick={() => setActiveTab("orders")}
            className={`px-2.5 py-1.5 rounded-md transition-all cursor-pointer ${activeTab === "orders" ? "bg-white dark:bg-slate-900 text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
          >
            {isRtl ? "أوامر التوريد" : "Purchase Orders"}
          </button>
          <button 
            onClick={() => setActiveTab("bulk")}
            className={`px-2.5 py-1.5 rounded-md transition-all cursor-pointer ${activeTab === "bulk" ? "bg-white dark:bg-slate-900 text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
          >
            {isRtl ? "تحديث المخزون جماعياً" : "Bulk Updates"}
          </button>
          <button 
            onClick={() => setActiveTab("warehouse")}
            className={`px-2.5 py-1.5 rounded-md transition-all cursor-pointer ${activeTab === "warehouse" ? "bg-white dark:bg-slate-900 text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
          >
            {isRtl ? "عمليات الشحن" : "Dispatches"}
          </button>
          <button 
            onClick={() => setActiveTab("reports")}
            className={`px-2.5 py-1.5 rounded-md transition-all cursor-pointer ${activeTab === "reports" ? "bg-white dark:bg-slate-900 text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
          >
            {isRtl ? "تقارير المستودعات" : "Inventory Reports"}
          </button>
        </div>
      </div>

      {activeTab === "stock" && (
        <div className="space-y-6">
          
          {/* Inventory Safety KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-4 rounded-xl">
              <span className="text-[9px] text-slate-400 font-bold block uppercase">{isRtl ? "مؤشر حد الأمان للمخزون" : "Global Safety Stock Buffer"}</span>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-lg font-bold text-slate-900 dark:text-white font-mono">98.2%</span>
                <span className="text-[10px] text-emerald-500 font-bold">↑ {isRtl ? "مستقر" : "Safe"}</span>
              </div>
              <p className="text-[10px] text-slate-400 mt-1">{isRtl ? "مستوى حماية المخزون الحالي لتفادي نفاد السلع المفاجئ بالأسواق" : "Average product safety buffer across regional pharma SKUs"}</p>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-4 rounded-xl">
              <span className="text-[9px] text-slate-400 font-bold block uppercase">{isRtl ? "التشغيلات المنتهية / القريبة للانتهاء" : "Expiry Risk Indicators (90 days)"}</span>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-lg font-bold text-rose-600 dark:text-rose-400 font-mono">1 {isRtl ? "تشغيلة" : "Batch"}</span>
                <span className="text-[10px] text-rose-500 font-bold">⚠️ {isRtl ? "تنبيه" : "Action"}</span>
              </div>
              <p className="text-[10px] text-slate-400 mt-1">{isRtl ? "أرصدة الأدوية التي يقل عمر صلاحيتها المتبقي عن ٣ أشهر" : "Packs flagged for accelerated clinical trial detailing allocations"}</p>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-4 rounded-xl">
              <span className="text-[9px] text-slate-400 font-bold block uppercase">{isRtl ? "مستودعات التوزيع المفعلة" : "Operational Warehouse Hubs"}</span>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-lg font-bold text-slate-900 dark:text-white font-mono">3 {isRtl ? "مستودعات" : "Depots"}</span>
                <span className="text-[10px] text-indigo-500 font-bold">100% {isRtl ? "مزامن" : "Synced"}</span>
              </div>
              <p className="text-[10px] text-slate-400 mt-1">{isRtl ? "المستودعات الإقليمية المربوطة بنظام التوريد المركزي للمندوبين" : "Active locations authorising real-time rep picking and releases"}</p>
            </div>
          </div>

          {/* Warehouse Stocks Detailed Grid */}
          <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-4 rounded-xl space-y-4">
            <h3 className="text-xs font-bold text-slate-800 dark:text-white">
              {isRtl ? "أرصدة المستودعات ومطابقة الجرد الميداني" : "Physical Warehouse Balances & Audits"}
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 rounded-xl border border-slate-100 dark:border-slate-800 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-slate-900 dark:text-white text-xs">{isRtl ? "مستودع طرابلس المركزي" : "Tripoli Depot"}</span>
                  <span className="px-2 py-0.5 rounded-full text-[9px] bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 font-bold">{isRtl ? "ممتاز" : "Optimal"}</span>
                </div>
                <div className="flex justify-between text-[11px] text-slate-500">
                  <span>{isRtl ? "المنتجات المسجلة:" : "Managed SKUs:"}</span>
                  <strong className="font-mono text-slate-800 dark:text-slate-300">18 SKUs</strong>
                </div>
                <div className="flex justify-between text-[11px] text-slate-500">
                  <span>{isRtl ? "إجمالي الوحدات:" : "Total stock units:"}</span>
                  <strong className="font-mono text-slate-800 dark:text-slate-300">142,500 packs</strong>
                </div>
              </div>

              <div className="p-4 rounded-xl border border-slate-100 dark:border-slate-800 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-slate-900 dark:text-white text-xs">{isRtl ? "مستودع بنغازي الشرقي" : "Benghazi Depot"}</span>
                  <span className="px-2 py-0.5 rounded-full text-[9px] bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 font-bold">{isRtl ? "ممتاز" : "Optimal"}</span>
                </div>
                <div className="flex justify-between text-[11px] text-slate-500">
                  <span>{isRtl ? "المنتجات المسجلة:" : "Managed SKUs:"}</span>
                  <strong className="font-mono text-slate-800 dark:text-slate-300">12 SKUs</strong>
                </div>
                <div className="flex justify-between text-[11px] text-slate-500">
                  <span>{isRtl ? "إجمالي الوحدات:" : "Total stock units:"}</span>
                  <strong className="font-mono text-slate-800 dark:text-slate-300">84,100 packs</strong>
                </div>
              </div>

              <div className="p-4 rounded-xl border border-slate-100 dark:border-slate-800 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-slate-900 dark:text-white text-xs">{isRtl ? "مستودع سبها الجنوبي" : "Sebha Hub"}</span>
                  <span className="px-2 py-0.5 rounded-full text-[9px] bg-amber-50 dark:bg-amber-950/40 text-amber-600 font-bold">{isRtl ? "انخفاض الأرصدة" : "Low Stock"}</span>
                </div>
                <div className="flex justify-between text-[11px] text-slate-500">
                  <span>{isRtl ? "المنتجات المسجلة:" : "Managed SKUs:"}</span>
                  <strong className="font-mono text-slate-800 dark:text-slate-300">8 SKUs</strong>
                </div>
                <div className="flex justify-between text-[11px] text-slate-500">
                  <span>{isRtl ? "إجمالي الوحدات:" : "Total stock units:"}</span>
                  <strong className="font-mono text-slate-800 dark:text-slate-300">24,200 packs</strong>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === "batches" && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-4 rounded-xl">
            <h3 className="text-xs font-bold text-slate-800 dark:text-white mb-1 flex items-center gap-1.5">
              <ShieldCheck size={16} className="text-indigo-600" />
              <span>{isRtl ? "سجل التشغيلات وضوابط الصرف بالأقدمية FIFO" : "FIFO Expiration & Batch Safeguards"}</span>
            </h3>
            <p className="text-[11px] text-slate-400 mb-4">{isRtl ? "ضمان موازنة جرد المستودعات تلقائياً ليصرف المندوبون التشغيلات الأقدم في الصلاحية تفادياً للتلف" : "Ensuring strict warehouse release sequence to guarantee optimal product remaining shelf life."}</p>

            <div className="space-y-3 text-xs">
              {batches.map((bch) => (
                <div 
                  key={bch.id} 
                  className="p-4 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50 space-y-2 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="space-y-1">
                    <span className="font-mono text-[9px] font-bold text-slate-400">{bch.id}</span>
                    <h4 className="font-bold text-slate-900 dark:text-white text-xs">
                      {isRtl ? bch.productNameAr : bch.productName}
                    </h4>
                    <p className="text-[11px] text-slate-400">{isRtl ? "تاريخ انتهاء الصلاحية:" : "Expiration Date:"} <strong className="font-mono text-slate-700 dark:text-slate-300">{bch.expirationDate}</strong></p>
                  </div>

                  <div className="flex items-center gap-3 justify-between sm:justify-end w-full sm:w-auto">
                    <div className="text-right">
                      <span className="text-[9px] text-slate-400 block uppercase font-bold">{isRtl ? "الرصيد المتوفر:" : "Available Stock:"}</span>
                      <strong className="font-mono text-indigo-600 dark:text-indigo-400 text-xs">{bch.stockLevel.toLocaleString()} {isRtl ? "عبوة" : "packs"}</strong>
                    </div>

                    <span className={`px-2.5 py-1 rounded-full text-[9px] font-bold ${
                      bch.status === "Optimal" 
                        ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600"
                        : bch.status === "Priority Dispatch"
                        ? "bg-blue-50 dark:bg-blue-950/30 text-blue-600"
                        : "bg-rose-50 dark:bg-rose-950/30 text-rose-600"
                    }`}>
                      {isRtl ? bch.statusAr : bch.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === "orders" && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-4 rounded-xl">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-xs font-bold text-slate-800 dark:text-white">
                {isRtl ? "عقود وأوامر التوريد التجاري النشطة" : "Active Commercial Purchase Orders (PO)"}
              </h3>
              <button 
                onClick={handleAddPO}
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold text-[10px] md:text-xs flex items-center gap-1 cursor-pointer"
              >
                <Plus size={14} />
                {isRtl ? "إصدار أمر توريد جديد" : "New Purchase Order"}
              </button>
            </div>
            <p className="text-[11px] text-slate-400 mb-4">{isRtl ? "تأمين مخزون الأدوية الإضافي والتخليص الجمركي للشحنات الواردة من مصانع الإنتاج الدولية" : "Tracing global factory logistics and seaport clearances for major product shipments."}</p>

            <div className="space-y-3 text-xs">
              {orders.map((po) => (
                <div 
                  key={po.id} 
                  className="p-4 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50 space-y-3"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="font-mono text-[9px] font-bold text-slate-400">{po.id} • {isRtl ? po.targetWarehouseAr : po.targetWarehouse}</span>
                      <h4 className="font-bold text-slate-900 dark:text-white mt-0.5">
                        {isRtl ? po.supplierAr : po.supplier}
                      </h4>
                    </div>

                    <span className={`px-2 py-0.5 rounded-md text-[9px] font-bold ${
                      po.status === "Completed"
                        ? "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600"
                        : po.status === "In Transit"
                        ? "bg-indigo-100 dark:bg-indigo-950/40 text-indigo-600"
                        : "bg-amber-100 dark:bg-amber-950/40 text-amber-600"
                    }`}>
                      {isRtl ? po.statusAr : po.status}
                    </span>
                  </div>

                  <div className="flex justify-between items-center text-[10px] text-slate-400 font-medium">
                    <span>{isRtl ? "قيمة عقد التوريد:" : "Purchase Order Value:"} <strong className="font-mono text-slate-800 dark:text-slate-100 text-xs">${po.amount.toLocaleString()}</strong></span>
                    <span className="flex items-center gap-1">
                      <Truck size={13} className="text-indigo-600" />
                      <span>{po.status === "Completed" ? (isRtl ? "تم تفريغ الشحنة" : "Cargo Stocked") : (isRtl ? "قيد الشحن" : "In Transit")}</span>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === "bulk" && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-4 rounded-xl">
            <h3 className="text-xs font-bold text-slate-850 dark:text-white mb-1">
              {isRtl ? "التحديثات الجماعية للمخزون والتوزيع" : "Bulk Stock & Allocation Updates"}
            </h3>
            <p className="text-[11px] text-slate-400 mb-4">
              {isRtl ? "مركز التحديثات الجماعية لتعديل رصيد المخزون المركزي وتحديث كوتة عينات المندوبين عبر ملفات Excel/CSV" : "Enterprise engine supporting CSV/Excel uploads for instant central inventory adjustment and distributor assignments."}
            </p>

            {/* Drag & Drop Area */}
            <div 
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-xl p-8 text-center transition-all ${
                dragActive ? "border-indigo-500 bg-indigo-50/20 dark:bg-indigo-950/20" : "border-slate-200 dark:border-slate-800"
              }`}
            >
              <div className="flex flex-col items-center justify-center space-y-3">
                <div className="w-12 h-12 bg-indigo-50 dark:bg-indigo-950 rounded-full flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                  <Upload size={24} />
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    {isRtl ? "اسحب وأفلت ورقة عمل Excel/CSV هنا" : "Drag & drop Excel/CSV worksheet here"}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    {isRtl ? "أو انقر لتصفح الملفات من جهازك" : "or click to browse local files"}
                  </p>
                </div>
                <label className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xxs font-bold rounded-lg transition-colors cursor-pointer">
                  {isRtl ? "تصفح الملفات" : "Browse Files"}
                  <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleFileSelect} />
                </label>
              </div>
            </div>

            {uploadSuccess && (
              <div className="mt-4 p-3 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900 rounded-xl text-xxs font-bold flex items-center gap-2">
                <Check size={14} />
                <span>
                  {isRtl ? `تمت معالجة الملف "${uploadedFile}" بنجاح وتحديث السجلات!` : `Processed file "${uploadedFile}" successfully and updated stock logs!`}
                </span>
              </div>
            )}

            <div className="mt-6 flex flex-wrap gap-3">
              <a 
                href="#download-template"
                onClick={(e) => { e.preventDefault(); alert("Template downloaded in simulation."); }}
                className="flex items-center gap-1.5 text-xxs font-bold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
              >
                <Download size={14} />
                {isRtl ? "تحميل نموذج جرد المستودعات (XLSX)" : "Download Stock Inventory Template (XLSX)"}
              </a>
              <span className="text-slate-200 dark:text-slate-800">|</span>
              <a 
                href="#download-template-alloc"
                onClick={(e) => { e.preventDefault(); alert("Template downloaded in simulation."); }}
                className="flex items-center gap-1.5 text-xxs font-bold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
              >
                <Download size={14} />
                {isRtl ? "تحميل نموذج عينات المندوبين (CSV)" : "Download Rep Allocation Template (CSV)"}
              </a>
            </div>
          </div>

          {/* Audit trail */}
          <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-4 rounded-xl">
            <h3 className="text-xs font-bold text-slate-850 dark:text-white mb-3">
              {isRtl ? "سجل عمليات التحديث الجماعية السابقة" : "Recent Bulk Executions Ledger"}
            </h3>

            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xxs">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 uppercase font-mono">
                    <th className="py-2 font-bold">{isRtl ? "رمز التعديل" : "Upload ID"}</th>
                    <th className="py-2 font-bold">{isRtl ? "اسم ملف المزامنة" : "Filename"}</th>
                    <th className="py-2 font-bold">{isRtl ? "المسؤول" : "Executing Admin"}</th>
                    <th className="py-2 font-bold">{isRtl ? "عدد السجلات" : "Records"}</th>
                    <th className="py-2 font-bold">{isRtl ? "التاريخ" : "Date"}</th>
                    <th className="py-2 font-bold">{isRtl ? "حالة التنفيذ" : "Status"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {bulkHistory.map((history) => (
                    <tr key={history.id} className="text-slate-600 dark:text-slate-300">
                      <td className="py-3 font-mono font-bold text-slate-400">{history.id}</td>
                      <td className="py-3 font-medium flex items-center gap-1 text-slate-800 dark:text-white">
                        <FileSpreadsheet size={13} className="text-emerald-600" />
                        <span>{history.filename}</span>
                      </td>
                      <td className="py-3">{history.user}</td>
                      <td className="py-3 font-mono">{history.count}</td>
                      <td className="py-3 font-mono">{history.date}</td>
                      <td className="py-3">
                        <span className="px-2 py-0.5 rounded-full text-[9px] bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 font-bold">
                          {isRtl ? "ناجح" : history.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile View */}
            <div className="block md:hidden divide-y divide-slate-100 dark:divide-slate-800">
              {bulkHistory.map((history) => (
                <div key={history.id} className={`py-3 space-y-2 text-[11px] ${isRtl ? "text-right" : "text-left"}`}>
                  <div className={`flex justify-between items-center ${isRtl ? "flex-row-reverse" : "flex-row"}`}>
                    <span className="font-mono text-slate-400 font-bold">{history.id}</span>
                    <span className="px-2 py-0.5 rounded-full text-[9px] bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 font-bold">
                      {isRtl ? "ناجح" : history.status}
                    </span>
                  </div>
                  <div className={`flex items-center gap-1 text-slate-800 dark:text-white font-medium ${isRtl ? "justify-end text-right" : ""}`}>
                    <FileSpreadsheet size={13} className="text-emerald-600 shrink-0" />
                    <span className="truncate">{history.filename}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-[10px] text-slate-400">
                    <div>
                      <span className="block font-bold uppercase text-[8px] text-slate-400">{isRtl ? "المسؤول" : "User"}</span>
                      <span className="text-slate-600 dark:text-slate-300 font-medium truncate block">{history.user}</span>
                    </div>
                    <div>
                      <span className="block font-bold uppercase text-[8px] text-slate-400">{isRtl ? "السجلات" : "Records"}</span>
                      <span className="font-mono font-bold text-slate-700 dark:text-slate-200">{history.count}</span>
                    </div>
                    <div>
                      <span className="block font-bold uppercase text-[8px] text-slate-400">{isRtl ? "التاريخ" : "Date"}</span>
                      <span className="font-mono text-slate-600 dark:text-slate-300">{history.date}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === "warehouse" && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-4 rounded-xl">
            <h3 className="text-xs font-bold text-slate-850 dark:text-white mb-1">
              {isRtl ? "العمليات التشغيلية والتحضير للتسليم" : "Warehouse Dispatches & Picking Operations"}
            </h3>
            <p className="text-[11px] text-slate-400 mb-4">
              {isRtl ? "متابعة مسار شحن البضائع وتجهيز الطلبيات للصيدليات المعتمدة، وإسنادها لشركات التوصيل والمندوبين" : "Dispatch workflow authorizing stock releases, picking slip formulation, and distributor handover tracking."}
            </p>

            <div className="space-y-3 text-xs">
              {dispatches.map((disp) => (
                <div 
                  key={disp.id} 
                  className="p-4 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50 space-y-3"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <span className="font-mono text-[9px] font-bold text-slate-400">{disp.id}</span>
                      <h4 className="font-bold text-slate-900 dark:text-white mt-0.5">
                        {isRtl ? disp.destAr : disp.destination}
                      </h4>
                    </div>

                    <span className={`px-2.5 py-1 rounded-full text-[9px] font-bold self-start sm:self-auto ${
                      disp.status === "Completed"
                        ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600"
                        : disp.status === "Loaded & En Route"
                        ? "bg-blue-50 dark:bg-blue-950/30 text-blue-600"
                        : "bg-amber-50 dark:bg-amber-950/30 text-amber-600"
                    }`}>
                      {isRtl ? disp.statusAr : disp.status}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-slate-100 dark:border-slate-800 text-[10px] text-slate-500">
                    <div>
                      <span className="text-slate-400 block uppercase font-bold text-[8px]">{isRtl ? "المندوب المسؤول:" : "Assigned Courier:"}</span>
                      <strong className="text-slate-700 dark:text-slate-300 font-medium">{disp.courier}</strong>
                    </div>
                    <div>
                      <span className="text-slate-400 block uppercase font-bold text-[8px]">{isRtl ? "حجم ووزن الشحنة:" : "Package Weight:"}</span>
                      <strong className="text-slate-700 dark:text-slate-300 font-mono">{disp.weight}</strong>
                    </div>
                    <div>
                      <span className="text-slate-400 block uppercase font-bold text-[8px]">{isRtl ? "الرمز الجغرافي:" : "Sector Code:"}</span>
                      <strong className="text-slate-700 dark:text-slate-300 font-mono">GEO-TRIP-32</strong>
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-1">
                    <button 
                      onClick={() => alert(`Picking slip for ${disp.id} printed.`)}
                      className="px-2.5 py-1 bg-white hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-md font-bold text-[9px] cursor-pointer"
                    >
                      {isRtl ? "طباعة قسيمة التحضير" : "Print Picking Slip"}
                    </button>
                    {disp.status !== "Completed" && (
                      <button 
                        onClick={() => {
                          setDispatches(prev => prev.map(d => d.id === disp.id ? { ...d, status: "Completed", statusAr: "تم التسليم بنجاح" } : d));
                        }}
                        className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md font-bold text-[9px] cursor-pointer"
                      >
                        {isRtl ? "تأكيد التوصيل" : "Mark Delivered"}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === "reports" && (
        <div className="space-y-6 animate-fade-in">
          
          {/* Quick Metrics Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-slate-900 p-4 border border-slate-100 dark:border-slate-800 rounded-xl">
              <span className="text-[10px] text-slate-400 block font-bold uppercase">{isRtl ? "القيمة المالية للمخزون" : "Total Stock Valuation"}</span>
              <span className="text-xl font-bold text-slate-850 dark:text-white font-mono">$485,000</span>
            </div>
            <div className="bg-white dark:bg-slate-900 p-4 border border-slate-100 dark:border-slate-800 rounded-xl">
              <span className="text-[10px] text-slate-400 block font-bold uppercase">{isRtl ? "مستودعات نشطة" : "Active Depots Managed"}</span>
              <span className="text-xl font-bold text-slate-850 dark:text-white font-mono">3</span>
            </div>
            <div className="bg-white dark:bg-slate-900 p-4 border border-slate-100 dark:border-slate-800 rounded-xl">
              <span className="text-[10px] text-slate-400 block font-bold uppercase">{isRtl ? "معدل دوران المخزون" : "Inventory Turn Ratio"}</span>
              <span className="text-xl font-bold text-slate-850 dark:text-white font-mono">4.2x</span>
            </div>
            <div className="bg-white dark:bg-slate-900 p-4 border border-slate-100 dark:border-slate-800 rounded-xl">
              <span className="text-[10px] text-slate-400 block font-bold uppercase">{isRtl ? "خطر قرب انتهاء الصلاحية" : "Expiry Buffer Status"}</span>
              <span className="text-xl font-bold text-emerald-500 font-mono">98.2%</span>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            
            {/* Left Column: Warehouse stock values chart */}
            <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-5 rounded-2xl shadow-xxs space-y-4">
              <div>
                <h3 className="text-xs font-bold text-slate-850 dark:text-white uppercase">{isRtl ? "توزيع القيمة المالية للمخزون حسب الصنف" : "Warehouse Stocks Financial Value by SKU"}</h3>
                <p className="text-[10px] text-slate-400">{isRtl ? "التقييم المالي الإجمالي للأرصدة الفعلية المتواجدة بالمخازن الإقليمية" : "Asset valuation based on current SKU warehouse balances."}</p>
              </div>

              <div className="h-64 w-full text-xs">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={[
                    { name: "CardioMax 10mg", value: 142000 },
                    { name: "KidVits Chewable", value: 98500 },
                    { name: "OrthoFlex Gel", value: 120000 },
                    { name: "AcneCare Lotion", value: 64500 },
                    { name: "GastroShield 20mg", value: 60000 }
                  ]}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="name" stroke="#94a3b8" fontSize={9} />
                    <YAxis stroke="#94a3b8" fontSize={9} />
                    <Tooltip formatter={(v) => [`$${v.toLocaleString()}`, "Valuation"]} />
                    <Bar dataKey="value" name={isRtl ? "القيمة ($)" : "Value ($)"} fill="#6366f1" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Right Column: Expiration Forecast */}
            <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-5 rounded-2xl shadow-xxs space-y-4 flex flex-col justify-between">
              <div>
                <h3 className="text-xs font-bold text-slate-850 dark:text-white uppercase">{isRtl ? "التحليل الاستباقي لانتهاء الصلاحية" : "Safety Expiry Forecast & Buffer"}</h3>
                <p className="text-[10px] text-slate-400">{isRtl ? "تنبؤ الصلاحية بالأشهر وخطط توزيع الكميات الأولى بالأولى (FEFO)" : "Proactive tracking of expiring items based on First-Expired-First-Out."}</p>
              </div>

              <div className="space-y-3">
                <div className="p-3 bg-rose-50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/40 rounded-xl text-xs flex gap-2 text-rose-800 dark:text-rose-400">
                  <AlertTriangle size={15} className="shrink-0 mt-0.5" />
                  <div>
                    <strong className="font-bold">{isRtl ? "تشغيلات تالفة أو قاربت الانتهاء:" : "Urgent Batches Expirations:"}</strong>
                    <span className="block mt-0.5 text-[10.5px]">{isRtl ? "تشغيلة BCH-ORTH-0422 تنتهي في أكتوبر ٢٠٢٦. يلزم توزيعها فوراً." : "OrthoFlex batch BCH-ORTH-0422 expires in under 4 months."}</span>
                  </div>
                </div>

                <div className="p-3 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/40 rounded-xl text-xs flex gap-2 text-emerald-800 dark:text-emerald-400">
                  <CheckCircle2 size={15} className="shrink-0 mt-0.5 text-emerald-500" />
                  <div>
                    <strong className="font-bold">{isRtl ? "حالة صلاحية كاردو ماكس ممتازة:" : "CardioMax Expiry Safe:"}</strong>
                    <span className="block mt-0.5 text-[10.5px]">{isRtl ? "تشغيلات كاردو ماكس تنتهي عام ٢٠٢٨، في مستوى التوزيع الأمثل." : "New batch expiration is set to April 2028, with optimal buffer."}</span>
                  </div>
                </div>
              </div>

              <span className="text-[9px] text-slate-400 text-right block italic">{isRtl ? "نظام الجرد محدث باستمرار" : "Audit loop fully validated"}</span>
            </div>

          </div>

        </div>
      )}

    </div>
  );
}
