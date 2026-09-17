import React, { useState, useEffect } from "react";
import { 
  Search, 
  Plus, 
  Filter, 
  FileText, 
  ShieldAlert, 
  CheckCircle, 
  Download, 
  ArrowLeft,
  X,
  PlusCircle,
  Clock,
  User,
  Clipboard,
  SlidersHorizontal,
  FileCheck
} from "lucide-react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { auth, db } from "../../lib/firebase";
import { Physician, Product, SampleDistribution, SampleSku, UserTerritoryAssignment, UserProductAssignment, Permissions } from "../../types";
import { canExportSampleReports, getAuthorizedSampleUserIds, getSampleDataScope, hasSampleCapability } from "../../lib/sampleAuthorization";
import { distributeSample } from "../../lib/sampleDistributionClient";
import { fetchSampleVisitOptions, type SampleVisitOption } from "../../lib/sampleVisitOptionsClient";
import { subscribeToScopedSampleCollection } from "../../lib/sampleScopeClient";
import { downloadSampleXlsx } from "../../lib/sampleReportExportService";
import { filterAuthorizedSampleDistributions } from "../../lib/sampleDistributionReadPolicy";

interface SampleDisbursedLogProps {
  currentUser: any;
  users?: any[];
  products?: Product[];
  physicians?: Physician[];
  permissions?: Permissions;
  lang: "en" | "ar";
  onNavigate?: (target: string) => void;
}

interface DisbursedSample {
  id: string;
  repId: string;
  physicianName: string;
  physicianNameAr: string;
  clinicName: string;
  clinicNameAr: string;
  productName: string;
  productNameAr: string;
  batchNumber: string;
  quantity: number;
  date: string;
  repName: string;
  complianceChecked: boolean;
  notes: string;
  notesAr: string;
}

export default function SampleDisbursedLog({ currentUser, users = [], products = [], physicians = [], permissions, lang, onNavigate }: SampleDisbursedLogProps) {
  const isRtl = lang === "ar";
  
  const [logs, setLogs] = useState<DisbursedSample[]>([]);
  const [rawLogs, setRawLogs] = useState<DisbursedSample[]>([]);
  const [userTerritoryAssignments, setUserTerritoryAssignments] = useState<UserTerritoryAssignment[]>([]);
  const [userProductAssignments, setUserProductAssignments] = useState<UserProductAssignment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [sampleSkus, setSampleSkus] = useState<SampleSku[]>([]);
  const [visitOptions, setVisitOptions] = useState<SampleVisitOption[]>([]);

  useEffect(() => {
    setIsLoading(true);

    const scope = getSampleDataScope(currentUser, "VIEW_PHYSICIAN_SAMPLE_HISTORY", permissions);
    const authorizedIds = getAuthorizedSampleUserIds(currentUser, users, scope);
    const unsubLogs = subscribeToScopedSampleCollection(db, "sampleDisbursedLogs", scope, authorizedIds, (docs) => {
      const items: DisbursedSample[] = [];
      docs.forEach((doc) => {
        const data = doc.data();
        if (!data.isDeleted) {
          const physician = physicians.find(item => item.id === data.physicianId);
          items.push({ id: doc.id, ...data, physicianName: data.physicianName || physician?.name || data.physicianId || "—", physicianNameAr: data.physicianNameAr || physician?.nameAr || physician?.name || data.physicianId || "—", clinicName: data.clinicName || physician?.address || "—", clinicNameAr: data.clinicNameAr || physician?.address || "—", productName: data.productName || data.sampleSkuId || "—", productNameAr: data.productNameAr || data.sampleSkuId || "—", batchNumber: data.batchNumber || data.batchId || "—", date: data.date || data.distributedAt?.slice?.(0, 10) || "—", repName: data.repName || users.find(item => item.id === data.repId)?.name || data.repId || "—", complianceChecked: data.complianceChecked !== false, notes: data.notes || "", notesAr: data.notesAr || data.notes || "" } as DisbursedSample);
        }
      });
      setRawLogs(items);
    }, (err) => {
      console.warn("[SampleDisbursedLog] Firestore subscription failed:", err);
    });

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
    const unsubSkus = onSnapshot(collection(db, "sampleCatalog"), snap => setSampleSkus(snap.docs.map(item => ({ id: item.id, ...item.data() } as SampleSku)).filter(item => item.active && item.status === "ACTIVE")));
    return () => {
      unsubLogs();
      unsubTerrAss();
      unsubProdAss();
      unsubSkus();
    };
  }, [currentUser, users, physicians, permissions]);

  useEffect(() => {
    const secured = filterAuthorizedSampleDistributions({
      actor: currentUser,
      users,
      distributions: rawLogs as unknown as SampleDistribution[],
      productAssignments: userProductAssignments,
      permissions,
    }) as unknown as DisbursedSample[];
    setLogs(secured);
  }, [rawLogs, userProductAssignments, currentUser, users, permissions]);

  const [searchTerm, setSearchTerm] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [showComplianceWizard, setShowComplianceWizard] = useState(false);

  // Form Fields State
  const [qty, setQty] = useState("");
  const [notes, setNotes] = useState("");
  const [complianceChecked, setComplianceChecked] = useState(true);

  const [formError, setFormError] = useState("");
  const [physicianId, setPhysicianId] = useState("");
  const [sampleSkuId, setSampleSkuId] = useState("");

  useEffect(() => {
    if (!physicianId || !auth.currentUser) { setVisitOptions([]); return; }
    let cancelled = false;
    void fetchSampleVisitOptions(auth.currentUser, physicianId).then(options => { if (!cancelled) setVisitOptions(options); }).catch(() => { if (!cancelled) setVisitOptions([]); });
    return () => { cancelled = true; };
  }, [physicianId]);
  const usableSampleSkus = visitOptions.map(option => ({ sampleSku: sampleSkus.find(sku => sku.id === option.sampleSkuId), available: option.availableQuantity })).filter((item): item is { sampleSku: SampleSku; available: number } => Boolean(item.sampleSku));
  const selectedSku = sampleSkus.find(item => item.id === sampleSkuId);
  const eligibilityPreview = visitOptions.find(option => option.sampleSkuId === sampleSkuId);

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasSampleCapability(currentUser, "DISTRIBUTE_SAMPLE", permissions)) return;
    setFormError("");

    if (!physicianId || !sampleSkuId || !qty.trim()) {
      setFormError(isRtl ? "يرجى تعبئة الحقول الإلزامية." : "Please fill in all mandatory fields.");
      return;
    }

    const logId = `LOG-${Math.floor(100000 + Math.random() * 900000)}`;
    const disQty = parseInt(qty) || 1;

    const sampleSku = sampleSkus.find(item => item.id === sampleSkuId), physician = physicians.find(item => item.id === physicianId);
    if (!sampleSku || !physician) { setFormError(isRtl ? "العينة أو الطبيب غير صالح" : "Sample SKU or Physician is invalid."); return; }
    const option = visitOptions.find(item => item.sampleSkuId === sampleSku.id);
    if (!option || disQty > 3 || disQty > option.availableQuantity) { setFormError(isRtl ? "طلب العينة غير صالح أو يتجاوز الكمية المتاحة." : "Sample request is invalid or exceeds distributable allocation."); return; }

    try {
      if (!auth.currentUser) throw new Error("AUTHENTICATION_REQUIRED");
      await distributeSample(auth.currentUser, { id: logId, sampleSkuId: sampleSku.id, productId: sampleSku.productId, physicianId, quantity: disQty, notes: notes || undefined });

      setShowAddModal(false);

      // reset fields
      setQty("");
      setPhysicianId("");
      setSampleSkuId("");
      setNotes("");
    } catch (err: any) {
      console.error(err);
      setFormError(err.message || (isRtl ? "فشل حفظ السجل في قاعدة البيانات" : "Failed to record disbursement in database"));
    }
  };

  const filteredLogs = logs.filter(item => {
    const term = searchTerm.toLowerCase();
    return (
      item.physicianName.toLowerCase().includes(term) ||
      item.physicianNameAr.includes(searchTerm) ||
      item.clinicName.toLowerCase().includes(term) ||
      item.productName.toLowerCase().includes(term) ||
      item.batchNumber.toLowerCase().includes(term)
    );
  });

  const totalDisbursedQty = logs.reduce((sum, item) => sum + item.quantity, 0);
  const totalLogsCount = logs.length;
  const compliantLogsCount = logs.filter(i => i.complianceChecked).length;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      
      {/* Header section */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-950 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
              <FileCheck size={22} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                {isRtl ? "سجل عينات الأطباء الموزعة" : "Physician Disbursed Samples Log"}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {isRtl ? "مطابقة وتوثيق تسليم العينات المجانية للأطباء وفق متطلبات الرقابة الدوائية واللوائح الصحية" : "Compliance audits and logbooks tracking free medical sample distribution to clinics."}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowComplianceWizard(true)}
            className="flex items-center gap-1 px-3 py-1.5 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-xxs font-bold rounded-lg text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
          >
            <ShieldAlert size={14} className="text-amber-500 animate-pulse" />
            <span>{isRtl ? "شروط الامتثال والرقابة" : "MOH Compliance Audits"}</span>
          </button>

          <span className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600">{isRtl ? "عرض السجل فقط — التوزيع أثناء الزيارة" : "History only — distribute during Physician Visit"}</span>
        </div>
      </div>

      {/* Stats Cards Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-4 rounded-2xl flex items-center gap-4">
          <div className="p-3 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400">
            <Clipboard size={18} />
          </div>
          <div>
            <span className="text-[10px] text-slate-400 block uppercase font-bold">
              {isRtl ? "إجمالي عمليات الصرف" : "Disbursement Count"}
            </span>
            <span className="text-base font-bold text-slate-800 dark:text-slate-100 font-mono">
              {totalLogsCount} {isRtl ? "عملية" : "Logs"}
            </span>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-4 rounded-2xl flex items-center gap-4">
          <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400">
            <FileText size={18} />
          </div>
          <div>
            <span className="text-[10px] text-slate-400 block uppercase font-bold">
              {isRtl ? "إجمالي العلب الموزعة" : "Total Boxes Handed"}
            </span>
            <span className="text-base font-bold text-blue-600 dark:text-blue-400 font-mono">
              {totalDisbursedQty} {isRtl ? "علبة" : "Boxes"}
            </span>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-4 rounded-2xl flex items-center gap-4">
          <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400">
            <CheckCircle size={18} />
          </div>
          <div>
            <span className="text-[10px] text-slate-400 block uppercase font-bold">
              {isRtl ? "معدل مطابقة الامتثال" : "MOH Compliance Ratio"}
            </span>
            <span className="text-base font-bold text-emerald-600 dark:text-emerald-400 font-mono">
              {totalLogsCount > 0 ? Math.round((compliantLogsCount / totalLogsCount) * 100) : 100}%
            </span>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-3 rounded-xl shadow-xxs">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
          <input
            type="text"
            placeholder={isRtl ? "البحث باسم الطبيب، العيادة أو المستحضر..." : "Search physician, clinic, batch or product..."}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-slate-200 dark:border-slate-850 rounded-lg text-xs bg-slate-50/40 dark:bg-slate-950 focus:outline-none focus:border-indigo-500 text-slate-800 dark:text-white"
          />
        </div>
        
        {canExportSampleReports(currentUser, permissions) && <button
          onClick={() => {
            const exportRows = filteredLogs.map(item => ({ distributionId: item.id, date: item.date, representativeId: item.repId, representative: item.repName, physician: item.physicianName, sample: item.productName, batch: item.batchNumber, quantity: item.quantity, notes: item.notes }));
            downloadSampleXlsx({ name: "Distribution", columns: [{ key: "distributionId", header: "Distribution ID" }, { key: "date", header: "Date" }, { key: "representativeId", header: "Representative ID" }, { key: "representative", header: "Representative" }, { key: "physician", header: "Physician" }, { key: "sample", header: "Sample" }, { key: "batch", header: "Batch" }, { key: "quantity", header: "Quantity" }, { key: "notes", header: "Notes" }], rows: exportRows }, { generatedBy: currentUser.name, generatedAt: new Date().toISOString(), scope: getSampleDataScope(currentUser, "VIEW_PHYSICIAN_SAMPLE_HISTORY", permissions), filters: { search: searchTerm }, authorized: canExportSampleReports(currentUser, permissions) });
          }}
          className="flex items-center justify-center gap-1.5 px-3.5 py-2 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-xs rounded-lg transition-all cursor-pointer"
        >
          <Download size={13} />
          {isRtl ? "تصدير السجل" : "Export compliance logs"}
        </button>}
      </div>

      {/* Main compliance logs list */}
      <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xxs">
        {/* Desktop Table View */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse text-slate-850 dark:text-slate-200">
            <thead>
              <tr className="bg-slate-50/75 dark:bg-slate-800/40 border-b border-slate-100 dark:border-slate-800 text-[10.5px] font-bold text-slate-500 uppercase tracking-wide">
                <th className="p-4">{isRtl ? "رقم السجل" : "Log ID"}</th>
                <th className="p-4">{isRtl ? "الطبيب المستلم" : "Physician Name"}</th>
                <th className="p-4">{isRtl ? "المستحضر الدوائي" : "Product SKU"}</th>
                <th className="p-4 text-center">{isRtl ? "الكمية" : "Qty (Boxes)"}</th>
                <th className="p-4">{isRtl ? "رقم التشغيلة" : "Batch No."}</th>
                <th className="p-4">{isRtl ? "تاريخ التسليم" : "Date Issued"}</th>
                <th className="p-4">{isRtl ? "المندوب" : "MedRep Name"}</th>
                <th className="p-4 text-center">{isRtl ? "الامتثال" : "Compliance Status"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              {filteredLogs.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50/40 dark:hover:bg-slate-800/10 transition-colors">
                  <td className="p-4 font-mono font-bold text-indigo-600 dark:text-indigo-400">{item.id}</td>
                  <td className="p-4">
                    <div className="font-bold text-slate-900 dark:text-white">
                      {isRtl ? item.physicianNameAr : item.physicianName}
                    </div>
                    <div className="text-[10px] text-slate-400">{isRtl ? item.clinicNameAr : item.clinicName}</div>
                  </td>
                  <td className="p-4">
                    <span className="font-medium text-slate-800 dark:text-slate-200">
                      {isRtl ? item.productNameAr : item.productName}
                    </span>
                  </td>
                  <td className="p-4 text-center font-bold font-mono text-slate-800 dark:text-white">
                    {item.quantity}
                  </td>
                  <td className="p-4 font-mono text-slate-500">{item.batchNumber}</td>
                  <td className="p-4 font-mono text-slate-500">{item.date}</td>
                  <td className="p-4 text-slate-600 dark:text-slate-300 font-medium">{item.repName}</td>
                  <td className="p-4 text-center">
                    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-0.5 rounded-full ${
                      item.complianceChecked 
                        ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400"
                        : "bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400"
                    }`}>
                      <CheckCircle size={11} />
                      {item.complianceChecked ? (isRtl ? "مكتمل ومعتمد" : "Verified & Signed") : (isRtl ? "قيد التدقيق" : "Pending Signature")}
                    </span>
                  </td>
                </tr>
              ))}

              {filteredLogs.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-400">
                    {isRtl ? "لا توجد سجلات توزيع عينات مطابقة للبحث." : "No matching sample disbursement logs found."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile Cards View */}
        <div className="block md:hidden divide-y divide-slate-100 dark:divide-slate-800/60" id="sample-disbursed-mobile-list">
          {filteredLogs.map((item) => (
            <div key={item.id} className={`p-4 space-y-3 text-xs ${isRtl ? "text-right" : "text-left"}`}>
              <div className="flex justify-between items-start gap-2">
                <div>
                  <span className="text-[10px] font-mono font-bold text-indigo-600 dark:text-indigo-400 block">{item.id}</span>
                  <h4 className="font-bold text-slate-900 dark:text-white text-sm mt-0.5">
                    {isRtl ? item.physicianNameAr : item.physicianName}
                  </h4>
                  <p className="text-[10px] text-slate-400 mt-0.5">{isRtl ? item.clinicNameAr : item.clinicName}</p>
                </div>
                <span className={`inline-flex items-center gap-1 text-[9px] font-bold px-2.5 py-0.5 rounded-full shrink-0 ${
                  item.complianceChecked 
                    ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400"
                    : "bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400"
                }`}>
                  <CheckCircle size={10} />
                  {item.complianceChecked ? (isRtl ? "مكتمل" : "Verified") : (isRtl ? "قيد التدقيق" : "Pending")}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 bg-slate-50 dark:bg-slate-950/50 rounded-xl p-3 border border-slate-100/50 dark:border-slate-800/40 text-[11px]">
                <div>
                  <span className="text-slate-400 font-semibold uppercase text-[8px] block mb-0.5">{isRtl ? "المستحضر" : "Product SKU"}</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200">{isRtl ? item.productNameAr : item.productName}</span>
                </div>
                <div>
                  <span className="text-slate-400 font-semibold uppercase text-[8px] block mb-0.5">{isRtl ? "الكمية" : "Qty (Boxes)"}</span>
                  <span className="font-mono font-bold text-slate-800 dark:text-slate-200">{item.quantity}</span>
                </div>
                <div>
                  <span className="text-slate-400 font-semibold uppercase text-[8px] block mb-0.5">{isRtl ? "رقم التشغيلة" : "Batch No."}</span>
                  <span className="font-mono text-slate-600 dark:text-slate-400">{item.batchNumber}</span>
                </div>
                <div>
                  <span className="text-slate-400 font-semibold uppercase text-[8px] block mb-0.5">{isRtl ? "تاريخ التسليم" : "Date Issued"}</span>
                  <span className="font-mono text-slate-600 dark:text-slate-400">{item.date}</span>
                </div>
              </div>

              <div className="flex justify-between items-center pt-1 text-[11px]">
                <span className="text-slate-400">{isRtl ? "المندوب الموزّع" : "Logged by Rep"}</span>
                <span className="font-bold text-slate-800 dark:text-slate-200">{item.repName}</span>
              </div>
            </div>
          ))}

          {filteredLogs.length === 0 && (
            <div className="p-8 text-center text-slate-400">
              {isRtl ? "لا توجد سجلات توزيع عينات مطابقة للبحث." : "No matching sample disbursement logs found."}
            </div>
          )}
        </div>
      </div>

      {/* Compliance Information Modal / Box */}
      {showComplianceWizard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-950/50 backdrop-blur-xs cursor-pointer" onClick={() => setShowComplianceWizard(false)}></div>
          <div className="relative bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl animate-fade-in text-xs space-y-4">
            <div className="flex justify-between items-center border-b pb-3">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <ShieldAlert size={16} className="text-amber-500" />
                <span>{isRtl ? "متطلبات التوزيع الآمن لعينات الأدوية (وزارة الصحة)" : "MOH Sample Disbursing Compliance Guide"}</span>
              </h3>
              <button onClick={() => setShowComplianceWizard(false)} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
                <X size={16} />
              </button>
            </div>
            
            <div className="space-y-3 text-slate-600 dark:text-slate-300">
              <p className="leading-relaxed">
                {isRtl 
                  ? "تخضع عينات الأدوية المجانية لشروط دقيقة من وزارة الصحة والمؤسسة العامة للغذاء والدواء لضمان عدم تسريب المستحضرات طالماً أنها لا تباع:"
                  : "MOH standards declare rigorous rules concerning sample distribution and handovers within clinical zones:"
                }
              </p>
              
              <ul className="list-disc list-inside space-y-2 pl-2">
                <li>
                  <strong className="text-slate-800 dark:text-white font-semibold">
                    {isRtl ? "شعار 'عينة مجانية - ليست للبيع':" : "'Free Sample - Not For Sale' labels:"}
                  </strong>
                  {" "}{isRtl ? "يجب التأكد من طباعة ملصق وزارة الصحة بوضوح على غلاف التشغيلات." : "Visible distinct stickers printed over individual package layouts."}
                </li>
                <li>
                  <strong className="text-slate-800 dark:text-white font-semibold">
                    {isRtl ? "توقيع أو ختم الطبيب المستلم:" : "Stamps or digital verification signatures:"}
                  </strong>
                  {" "}{isRtl ? "توقيع أو ختم الطبيب الشخصي أو توقيع معتمد على ورقة الاستلام وتحديد رقم الـ Batch." : "Individual clinic stamps or registered recipient check-in tracking tags."}
                </li>
                <li>
                  <strong className="text-slate-800 dark:text-white font-semibold">
                    {isRtl ? "إدارة أرقام التشغيلات (Batches):" : "FIFO batch expiry checks:"}
                  </strong>
                  {" "}{isRtl ? "يجب مطابقة رقم الـ Batch بدقة لتتبع عمليات سحب الأدوية العاجلة في حالات الطوارئ." : "Logging batch numbers allows immediate recall routing in case of compliance warnings."}
                </li>
              </ul>
            </div>

            <div className="flex justify-end pt-3">
              <button 
                onClick={() => setShowComplianceWizard(false)}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-505 text-white text-xs font-bold rounded-xl"
              >
                {isRtl ? "فهمت" : "Acknowledge Regulations"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Disbursement Log Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-950/50 backdrop-blur-xs cursor-pointer" onClick={() => setShowAddModal(false)}></div>
          <form onSubmit={handleAddSubmit} className="relative bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl animate-fade-in text-xs space-y-4">
            <div className="flex justify-between items-center border-b pb-3">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                <PlusCircle size={16} className="text-indigo-600" />
                <span>{isRtl ? "تسجيل صرف عينة لطبيب" : "Log Sample Disbursement"}</span>
              </h3>
              <button type="button" onClick={() => setShowAddModal(false)} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
                <X size={16} />
              </button>
            </div>

            {formError && (
              <div className="p-2.5 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 text-rose-600 rounded-xl">
                {formError}
              </div>
            )}

            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-[10px] font-semibold text-slate-400">{isRtl ? "الطبيب المستلم" : "Physician"} *</label>
                <select required value={physicianId} onChange={e => setPhysicianId(e.target.value)} className="w-full text-xs p-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-transparent">
                  <option value="">{isRtl ? "اختر الطبيب" : "Select Physician"}</option>{physicians.map(item => <option key={item.id} value={item.id}>{item.name} ({item.id})</option>)}
                </select>
              </div>
              <div className="space-y-1">
                  <label className="text-[10px] font-semibold text-slate-400">{isRtl ? "صنف العينة *" : "Sample SKU *"}</label>
                  <select 
                    value={sampleSkuId}
                    onChange={e => setSampleSkuId(e.target.value)}
                    className="w-full text-xs p-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-transparent"
                  >
                    <option value="">{isRtl ? "اختر رصيداً متاحاً" : "Select available balance"}</option>
                    {usableSampleSkus.map(item => <option key={item.sampleSku.id} value={item.sampleSku.id}>{item.sampleSku.name} — {isRtl ? "المتاح" : "Available"}: {item.available}</option>)}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-semibold text-slate-400">{isRtl ? "رقم التشغيلة المستهدفة" : "Assigned Batch No."}</label>
                  <input 
                    type="text" 
                    value={visitOptions.find(item => item.sampleSkuId === sampleSkuId)?.batches.map(item => item.batchNumber).join(", ") || "FEFO"}
                    disabled
                    className="w-full text-xs p-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800 font-mono text-slate-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold text-slate-400">{isRtl ? "الكمية الموزعة (علب) *" : "Boxes Handed Out *"}</label>
                  <input 
                    type="number" 
                    value={qty} 
                    onChange={e => setQty(e.target.value)}
                    placeholder="1–3"
                    className="w-full text-xs p-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-transparent"
                    min="1"
                    max="3"
                    required
                  />
              </div>

              {eligibilityPreview && <div className="p-2.5 rounded-xl border text-[11px] bg-emerald-50 border-emerald-200 text-emerald-700">
                <strong>{isRtl ? "مخصص وقابل للتوزيع" : "Allocated and distributable"}</strong>
                <span className="block mt-1">{isRtl ? "المتاح" : "Available"}: {eligibilityPreview.availableQuantity}</span>
              </div>}

              <div className="space-y-1">
                <label className="text-[10px] font-semibold text-slate-400">{isRtl ? "ملاحظات وتفاصيل الاستخدام" : "Medical Detailing Notes"}</label>
                <textarea 
                  value={notes} 
                  onChange={e => setNotes(e.target.value)}
                  placeholder="e.g. Delivered package with dosage guides."
                  className="w-full text-xs p-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-transparent min-h-[50px]"
                />
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input 
                  type="checkbox" 
                  id="compliance-checkbox"
                  checked={complianceChecked}
                  onChange={e => setComplianceChecked(e.target.checked)}
                  className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4"
                />
                <label htmlFor="compliance-checkbox" className="text-xxs font-semibold text-slate-500 cursor-pointer">
                  {isRtl ? "أؤكد مطابقة التوزيع والتحقق من ختم وزارة الصحة والتوقيع الطبي الميداني." : "Confirm sample package bears original label stickers and recipient signed off."}
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-2.5 border-t pt-3">
              <button 
                type="button"
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 text-slate-500 text-xs font-semibold rounded-xl"
              >
                {isRtl ? "إلغاء" : "Cancel"}
              </button>
              <button 
                type="submit"
                disabled={Boolean(sampleSkuId) && !eligibilityPreview}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-300 text-white text-xs font-bold rounded-xl"
              >
                {isRtl ? "تأكيد وتسجيل" : "Onboard Log"}
              </button>
            </div>
          </form>
        </div>
      )}

    </div>
  );
}
