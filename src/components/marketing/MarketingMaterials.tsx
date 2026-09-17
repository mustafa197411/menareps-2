import React, { useState, useEffect, useMemo } from "react";
import { motion } from "motion/react";
import { 
  Plus, 
  Search, 
  Sliders, 
  Layers, 
  BookOpen, 
  HelpCircle, 
  Package, 
  Download, 
  Clock, 
  CheckCircle2, 
  X,
  FileText,
  Bookmark,
  AlertCircle
} from "lucide-react";
import { collection, onSnapshot, doc, setDoc, getDoc } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { decorateRecord } from "../../lib/firebaseSync";
import { triggerMarketingRequestAlert } from "../../lib/notificationService";
import { AuditLog } from "../../types";
import { saveAuditLogRecord } from "../../lib/firestoreService";
import { canExerciseProductMarketingAuthority } from "../../lib/productMarketingAuthority";

interface MarketingMaterialsProps {
  currentUser: any;
  lang: "en" | "ar";
}

interface MaterialRequest {
  id: string;
  materialName: string;
  materialNameAr: string;
  category: "Brochure" | "Desk Accessory" | "Patient Guide" | "Gift Item";
  categoryAr: string;
  quantity: number;
  requestedDate: string;
  status: "Pending" | "Dispatched" | "Declined";
  purpose: string;
  purposeAr: string;
}

export default function MarketingMaterials({ currentUser, lang }: MarketingMaterialsProps) {
  const isRtl = lang === "ar";
  
  const [requests, setRequests] = useState<MaterialRequest[]>([]);
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [activeTab, setActiveTab] = useState<"requests" | "settings">("requests");
  const [formError, setFormError] = useState("");

  // Form State
  const [matName, setMatName] = useState("");
  const [matNameAr, setMatNameAr] = useState("");
  const [category, setCategory] = useState<"Brochure" | "Desk Accessory" | "Patient Guide" | "Gift Item">("Brochure");
  const [qty, setQty] = useState("");
  const [purpose, setPurpose] = useState("");
  const [purposeAr, setPurposeAr] = useState("");

  // Settings State (Hospitality formula & promotional limit configs - Persisted in Cloud Firestore settings/marketing)
  const [promoCapPerDoc, setPromoCapPerDoc] = useState("150");
  const [yearlyTerritoryBudget, setYearlyTerritoryBudget] = useState("12000");
  const [saveSuccess, setSaveSuccess] = useState(false);

  const canManageSettings = useMemo(() => {
    return canExerciseProductMarketingAuthority("MANAGE_MARKETING_SETTINGS", { user: currentUser });
  }, [currentUser]);

  // 1. Listen for material requests
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "marketingMaterialRequests"), (snapshot) => {
      const list: MaterialRequest[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        if (!data.isDeleted) {
          list.push({ id: doc.id, ...data } as MaterialRequest);
        }
      });
      setRequests(list);
    }, (err) => {
      console.warn("[MarketingMaterials] Firestore subscription failed:", err);
    });

    return () => unsub();
  }, []);

  // 2. Fetch/Load persisting settings from Firestore settings/marketing
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const docRef = doc(db, "settings", "marketing");
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          if (data.promoCapPerDoc) setPromoCapPerDoc(String(data.promoCapPerDoc));
          if (data.yearlyTerritoryBudget) setYearlyTerritoryBudget(String(data.yearlyTerritoryBudget));
        } else {
          // Initialize default cloud settings document
          await setDoc(docRef, {
            promoCapPerDoc: 150,
            yearlyTerritoryBudget: 12000,
            updatedAt: new Date().toISOString()
          });
        }
      } catch (e) {
        console.error("Failed to load marketing settings from Cloud Firestore:", e);
      }
    };

    loadSettings();
  }, []);

  // 3. Audit log helper
  const logAudit = async (action: string, details: string) => {
    const logId = `AL-${Math.floor(1000 + Math.random() * 9000)}`;
    const auditRecord: AuditLog = {
      id: logId,
      timestamp: new Date().toISOString().replace("T", " ").substring(0, 19) + " UTC",
      userId: currentUser?.id || "unknown",
      userName: currentUser?.name || "Anonymous",
      userRole: currentUser?.role,
      action,
      entityType: "MarketingMaterial",
      entityName: "Marketing Materials",
      details
    };

    try {
      await saveAuditLogRecord(auditRecord);
    } catch (e) {
      console.error("Audit log failed:", e);
    }
  };

  const handleRequestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");

    if (!matName.trim() || !qty.trim() || !purpose.trim()) {
      setFormError(isRtl ? "يرجى تعبئة الحقول الإلزامية." : "Please fill in all mandatory fields.");
      return;
    }

    const reqId = `MAT-90${requests.length + 1 + Math.floor(Math.random() * 99)}`;
    const payload = {
      id: reqId,
      materialName: matName,
      materialNameAr: matNameAr || matName,
      category,
      categoryAr: category === "Brochure" ? "منشور علمي" : category === "Desk Accessory" ? "ملحقات مكتبية ترويجية" : "مجسم توضيحي",
      quantity: parseInt(qty) || 10,
      requestedDate: new Date().toISOString().split("T")[0],
      status: "Pending",
      purpose,
      purposeAr: purposeAr || purpose,
      isDeleted: false
    };

    const decorated = decorateRecord(payload, currentUser?.id || "system", "create");

    try {
      await setDoc(doc(db, "marketingMaterialRequests", reqId), decorated);
      
      // Trigger automated marketing request alert
      triggerMarketingRequestAlert(
        reqId,
        currentUser?.name || "Representative",
        matName,
        parseInt(qty) || 10,
        currentUser?.id || "system"
      ).catch(e => console.error("[Alert Engine] Marketing request alert failed:", e));

      setShowRequestForm(false);
      await logAudit("Create", `Requested promotional materials: ${qty} x "${matName}"`);
      
      // reset
      setMatName("");
      setMatNameAr("");
      setQty("");
      setPurpose("");
      setPurposeAr("");
    } catch (err) {
      console.error(err);
      setFormError(isRtl ? "حدث خطأ أثناء الحفظ بقاعدة البيانات." : "Failed to submit request.");
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveSuccess(false);

    try {
      const docRef = doc(db, "settings", "marketing");
      await setDoc(docRef, {
        promoCapPerDoc: parseFloat(promoCapPerDoc) || 150,
        yearlyTerritoryBudget: parseFloat(yearlyTerritoryBudget) || 12000,
        updatedAt: new Date().toISOString(),
        updatedBy: currentUser?.name || "Admin"
      }, { merge: true });

      await logAudit("Update Settings", `Updated marketing settings: promo cap per doc = $${promoCapPerDoc}, yearly territory budget = $${yearlyTerritoryBudget}`);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDispatch = async (id: string, name: string) => {
    try {
      await setDoc(doc(db, "marketingMaterialRequests", id), { status: "Dispatched" }, { merge: true });
      await logAudit("Dispatch", `Dispatched promotional material request ${id} ("${name}")`);
    } catch (e) {
      console.error(e);
    }
  };

  const handleDecline = async (id: string, name: string) => {
    try {
      await setDoc(doc(db, "marketingMaterialRequests", id), { status: "Declined" }, { merge: true });
      await logAudit("Decline", `Declined promotional material request ${id} ("${name}")`);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      
      {/* Header section */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-100 dark:bg-violet-950 flex items-center justify-center text-violet-600 dark:text-violet-400">
              <Package size={22} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                {isRtl ? "طلب ومتابعة المواد الترويجية" : "Promotional Materials & Requests"}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {isRtl ? "طلب الكتيبات العلمية، مجسمات الشرح الطبي، وتعيين ميزانيات الضيافة والأدوات الترويجية للأطباء" : "Request clinical brochures, demonstration items, and manage rep promotional budgets."}
              </p>
            </div>
          </div>
        </div>

        {/* Tab selection */}
        <div className="flex gap-1.5 bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg text-xxs font-bold">
          <button 
            onClick={() => setActiveTab("requests")}
            className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${activeTab === "requests" ? "bg-white dark:bg-slate-900 text-violet-600" : "text-slate-500"}`}
          >
            {isRtl ? "طلبات المواد" : "Material Requests"}
          </button>
          <button 
            onClick={() => setActiveTab("settings")}
            className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${activeTab === "settings" ? "bg-white dark:bg-slate-900 text-violet-600" : "text-slate-500"}`}
          >
            {isRtl ? "إعدادات الميزانية والامتثال" : "Compliance & Caps"}
          </button>
        </div>
      </div>

      {activeTab === "requests" ? (
        <div className="space-y-6">
          
          {/* Create Request CTA */}
          <div className="flex justify-between items-center bg-slate-50 dark:bg-slate-900 border p-4 rounded-2xl">
            <span className="text-xxs font-bold text-slate-500 uppercase">
              {isRtl ? "تقديم طلب مادة دعائية ترويجية" : "Submit promotional material replenishment"}
            </span>

            <button
              onClick={() => {
                setFormError("");
                setShowRequestForm(!showRequestForm);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[10px] rounded-xl shadow-xs cursor-pointer"
            >
              {showRequestForm ? <X size={12} /> : <Plus size={12} />}
              <span>{showRequestForm ? (isRtl ? "إلغاء الطلب" : "Cancel Request") : (isRtl ? "طلب مادة جديدة" : "New Material Request")}</span>
            </button>
          </div>

          {/* Form collapses */}
          {showRequestForm && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-5 rounded-2xl shadow-xs space-y-4"
            >
              <div className="border-b pb-2">
                <h3 className="text-xs font-bold text-slate-900 dark:text-white">
                  {isRtl ? "تفاصيل طلب المواد الترويجية والكتيبات" : "Promotional Material Dispatch Request Details"}
                </h3>
              </div>

              {formError && (
                <div className="p-3 bg-rose-50 dark:bg-rose-950/20 text-rose-600 rounded-xl text-xxs flex items-center gap-2">
                  <AlertCircle size={14} />
                  <span>{formError}</span>
                </div>
              )}

              <form onSubmit={handleRequestSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                    {isRtl ? "اسم المادة بالعربية" : "Material Description (Arabic)"}
                  </label>
                  <input 
                    type="text"
                    value={matNameAr}
                    onChange={(e) => setMatNameAr(e.target.value)}
                    dir="rtl"
                    placeholder="كتيب شرح كاردوماكس السريري..."
                    className="w-full bg-slate-50 dark:bg-slate-800/40 rounded-xl p-2.5"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                    {isRtl ? "اسم المادة بالإنجليزية *" : "Material Name (EN) *"}
                  </label>
                  <input 
                    type="text"
                    value={matName}
                    onChange={(e) => setMatName(e.target.value)}
                    placeholder="e.g. CardioMax Clinical Study Brochure V4"
                    className="w-full bg-slate-50 dark:bg-slate-800/40 rounded-xl p-2.5"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                    {isRtl ? "الفئة والنوع الترويجي" : "Category Type"}
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as any)}
                    className="w-full bg-slate-50 dark:bg-slate-800/40 rounded-xl p-2.5 font-bold"
                  >
                    <option value="Brochure">Brochure (منشور علمي)</option>
                    <option value="Desk Accessory">Clinic Accessory (ملحق مكتب طبي)</option>
                    <option value="Patient Guide">Patient Guide (دليل توعية المرضى)</option>
                    <option value="Gift Item">Anatomical Model (مجسم شرح وتوضيح)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                    {isRtl ? "الكمية المطلوبة *" : "Requested Quantity *"}
                  </label>
                  <input 
                    type="number"
                    value={qty}
                    onChange={(e) => setQty(e.target.value)}
                    placeholder="e.g. 50"
                    className="w-full bg-slate-50 dark:bg-slate-800/40 rounded-xl p-2.5 font-mono"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                    {isRtl ? "الهدف والتبرير الميداني للطلب *" : "Field Purpose & Justification *"}
                  </label>
                  <textarea 
                    rows={2}
                    value={purpose}
                    onChange={(e) => setPurpose(e.target.value)}
                    placeholder="Detail how these brochures or items will be utilized with key practitioners..."
                    className="w-full bg-slate-50 dark:bg-slate-800/40 rounded-xl p-2.5"
                  />
                </div>

                <div className="sm:col-span-2 flex justify-end gap-2 pt-3 border-t">
                  <button 
                    type="button"
                    onClick={() => setShowRequestForm(false)}
                    className="px-4 py-2 border rounded-xl font-bold text-slate-500"
                  >
                    {isRtl ? "إلغاء" : "Cancel"}
                  </button>
                  <button 
                    type="submit"
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold"
                  >
                    {isRtl ? "إرسال الطلب للمخازن" : "Send Dispatch Request"}
                  </button>
                </div>
              </form>
            </motion.div>
          )}

          {/* Queue List of requests */}
          <div className="space-y-4">
            {requests.map((req) => (
              <div 
                key={req.id}
                className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-4 rounded-2xl shadow-xxs flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="flex items-start gap-3">
                  <div className="p-2.5 bg-slate-50 dark:bg-slate-800 text-slate-500 rounded-xl mt-1 shrink-0">
                    <Package size={18} />
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[9px] font-mono font-bold text-slate-400">
                        {req.id} • {req.requestedDate}
                      </span>
                      <span className="text-[9px] px-2 py-0.5 font-bold bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 rounded-full">
                        {isRtl ? req.categoryAr : req.category}
                      </span>
                    </div>

                    <h4 className="text-xs font-bold text-slate-950 dark:text-white leading-snug">
                      {isRtl ? req.materialNameAr : req.materialName}
                    </h4>

                    <p className="text-xxs text-slate-500 leading-relaxed max-w-xl">
                      <strong>{isRtl ? "التبرير الميداني:" : "Justification:"} </strong>
                      {isRtl ? req.purposeAr : req.purpose}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3 sm:self-center self-end">
                  <div className="text-right">
                    <span className="text-[10px] text-slate-400 block">{isRtl ? "الكمية المطلوبة" : "Qty Requested"}</span>
                    <span className="font-extrabold text-xs text-slate-900 dark:text-white font-mono">{req.quantity} pcs</span>
                  </div>

                  <span className={`px-2.5 py-1 rounded-lg text-xxs font-bold ${
                    req.status === "Dispatched"
                      ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400"
                      : req.status === "Declined"
                      ? "bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400"
                      : "bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400"
                  }`}>
                    {req.status === "Dispatched" ? (isRtl ? "تم الشحن" : "Dispatched") : req.status === "Declined" ? (isRtl ? "مرفوض" : "Declined") : (isRtl ? "قيد المعالجة" : "Pending Dispatch")}
                  </span>

                  {req.status === "Pending" && canManageSettings && (
                    <div className="flex items-center gap-1 border-l pl-2 border-slate-100 dark:border-slate-800">
                      <button 
                        onClick={() => handleDecline(req.id, req.materialName)}
                        className="p-1 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20 rounded-md cursor-pointer"
                        title={isRtl ? "رفض" : "Decline"}
                      >
                        <X size={14} />
                      </button>
                      <button 
                        onClick={() => handleDispatch(req.id, req.materialName)}
                        className="p-1 text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 rounded-md cursor-pointer"
                        title={isRtl ? "شحن وصرف" : "Dispatch"}
                      >
                        <CheckCircle2 size={14} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {requests.length === 0 && (
              <div className="py-12 text-center text-xs text-slate-400 border border-dashed rounded-2xl bg-slate-50/50 dark:bg-slate-900/30">
                {isRtl ? "لا توجد طلبات لمواد ترويجية حالياً." : "No promotional material requests are currently registered."}
              </div>
            )}
          </div>

        </div>
      ) : (
        /* Settings Tab (Compliance and Caps) */
        <form onSubmit={handleSaveSettings} className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-6 rounded-2xl shadow-xxs space-y-5 text-xs">
          <div className="border-b pb-3">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              {isRtl ? "إعدادات ميزانية الضيافة وحدود الامتثال" : "Promotional Hospitality Caps & Budgets"}
            </h3>
            <p className="text-xxs text-slate-400 mt-1">
              {isRtl ? "تعديل القيود والحدود القصوى للهدايا الطبية وميزانيات الضيافة المسموحة للزيارة والمندوب" : "Persist local compliance limit parameters and maximum promotional caps per practitioner."}
            </p>
          </div>

          {saveSuccess && (
            <div className="p-3 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 rounded-xl text-xxs flex items-center gap-2">
              <CheckCircle2 size={14} />
              <span>{isRtl ? "تم حفظ التعديلات والمزامنة مع قاعدة البيانات السحابية بنجاح!" : "Marketing caps updated and synced with cloud database!"}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label className="block font-bold text-slate-500 uppercase text-[10px] mb-1.5">
                {isRtl ? "الحد الأقصى للضيافة لكل طبيب سنوياً (USD) *" : "Max Promotional Gift/Hospitality Cap per Clinician (Yearly USD) *"}
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold">$</span>
                <input 
                  type="number" 
                  value={promoCapPerDoc}
                  onChange={(e) => setFormError("") || setPromoCapPerDoc(e.target.value)}
                  disabled={!canManageSettings}
                  className="w-full bg-slate-50 dark:bg-slate-800/40 rounded-xl p-2.5 pl-8 font-mono border border-transparent focus:border-indigo-500 disabled:opacity-60"
                />
              </div>
            </div>

            <div>
              <label className="block font-bold text-slate-500 uppercase text-[10px] mb-1.5">
                {isRtl ? "ميزانية الأنشطة الطبية السنوية للمنطقة (USD) *" : "Annual Territory Marketing/Symposia Budget Cap (USD) *"}
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold">$</span>
                <input 
                  type="number" 
                  value={yearlyTerritoryBudget}
                  onChange={(e) => setFormError("") || setYearlyTerritoryBudget(e.target.value)}
                  disabled={!canManageSettings}
                  className="w-full bg-slate-50 dark:bg-slate-800/40 rounded-xl p-2.5 pl-8 font-mono border border-transparent focus:border-indigo-500 disabled:opacity-60"
                />
              </div>
            </div>
          </div>

          <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200/80 p-4 rounded-xl flex items-start gap-3 text-xxs text-amber-800 dark:text-amber-400">
            <HelpCircle size={16} className="text-amber-500 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <span className="font-bold block">{isRtl ? "إرشادات تدقيق الامتثال للضيافة الطبية:" : "Guideline Notice on Medical Hospitality Audits:"}</span>
              <p>
                {isRtl 
                  ? "تتحكم هذه الميزانيات الترويجية والحدود القصوى تلقائياً في حساب رعاية المندوبين لتبسيط موافقات تمويل الكليات الطبية."
                  : "These rules restrict clinical team representatives from exceeding predefined marketing parameters in any active fiscal year."
                }
              </p>
            </div>
          </div>

          {canManageSettings && (
            <div className="flex justify-end pt-3 border-t">
              <button 
                type="submit"
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-xs transition-colors cursor-pointer"
              >
                {isRtl ? "مزامنة وحفظ الإعدادات سحابياً" : "Save and Sync Cloud Settings"}
              </button>
            </div>
          )}
        </form>
      )}

    </div>
  );
}
