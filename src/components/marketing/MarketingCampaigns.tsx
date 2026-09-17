import React, { useState, useEffect, useMemo } from "react";
import { 
  Sparkles, 
  Megaphone, 
  Users, 
  Calendar, 
  ChevronRight, 
  FileText, 
  Target, 
  Compass, 
  HeartHandshake,
  Plus,
  X,
  AlertCircle
} from "lucide-react";
import { collection, onSnapshot, doc, setDoc } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { decorateRecord } from "../../lib/firebaseSync";
import { AuditLog } from "../../types";
import { saveAuditLogRecord } from "../../lib/firestoreService";
import { canExerciseProductMarketingAuthority } from "../../lib/productMarketingAuthority";
import { mutateScopedContent } from "../../lib/scopedContentMutationClient";

interface MarketingCampaignsProps {
  currentUser: any;
  lang: "en" | "ar";
}

interface Campaign {
  id: string;
  name: string;
  nameAr: string;
  brand: string;
  therapeuticArea: string;
  therapeuticAreaAr: string;
  startDate: string;
  endDate: string;
  status: "Active" | "Upcoming" | "Completed";
  targetPhysicians: number;
  completedPhysicians: number;
  materialsCount: number;
  digitalMessageTheme: string;
  digitalMessageThemeAr: string;
}

export default function MarketingCampaigns({ currentUser, lang }: MarketingCampaignsProps) {
  const isRtl = lang === "ar";
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // Form Fields
  const [formName, setFormName] = useState("");
  const [formNameAr, setFormNameAr] = useState("");
  const [formBrand, setFormBrand] = useState("Atorva");
  const [formTherapeuticArea, setFormTherapeuticArea] = useState("");
  const [formTherapeuticAreaAr, setFormTherapeuticAreaAr] = useState("");
  const [formStart, setFormStart] = useState("2026-07-01");
  const [formEnd, setFormEnd] = useState("2026-12-31");
  const [formStatus, setFormStatus] = useState<"Active" | "Upcoming" | "Completed">("Active");
  const [formTargetDocs, setFormTargetDocs] = useState("300");
  const [formTheme, setFormTheme] = useState("");
  const [formThemeAr, setFormThemeAr] = useState("");

  const canManage = useMemo(() => {
    return canExerciseProductMarketingAuthority("MANAGE_MARKETING_CONTENT", { user: currentUser });
  }, [currentUser]);

  // 1. Listen for real-time Campaigns
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "marketingCampaigns"), (snapshot) => {
      const list: Campaign[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        if (!data.isDeleted) {
          list.push({ id: doc.id, ...data } as Campaign);
        }
      });
      setCampaigns(list);
    }, (err) => {
      console.warn("[MarketingCampaigns] Firestore subscription failed:", err);
    });

    return () => unsub();
  }, []);

  // 2. Audit log helper
  const logAudit = async (action: string, details: string) => {
    const logId = `AL-${Math.floor(1000 + Math.random() * 9000)}`;
    const auditRecord: AuditLog = {
      id: logId,
      timestamp: new Date().toISOString().replace("T", " ").substring(0, 19) + " UTC",
      userId: currentUser?.id || "unknown",
      userName: currentUser?.name || "Anonymous",
      userRole: currentUser?.role,
      action,
      entityType: "MarketingCampaign",
      entityName: "Marketing Campaigns",
      details
    };

    try {
      await saveAuditLogRecord(auditRecord);
    } catch (e) {
      console.error("Audit log failed:", e);
    }
  };

  const handleCreateCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");

    if (!formName.trim() || !formTheme.trim()) {
      setErrorMsg(isRtl ? "يرجى تعبئة الحقول الإلزامية." : "Please fill in all mandatory fields.");
      return;
    }

    const campId = `CMP-2026-${Math.floor(10 + Math.random() * 89)}`;
    const payload = {
      id: campId,
      name: formName,
      nameAr: formNameAr || formName,
      brand: formBrand,
      therapeuticArea: formTherapeuticArea || "General Medicine",
      therapeuticAreaAr: formTherapeuticAreaAr || formTherapeuticArea || "الطب العام",
      startDate: formStart,
      endDate: formEnd,
      status: formStatus,
      targetPhysicians: parseInt(formTargetDocs) || 100,
      completedPhysicians: 0,
      materialsCount: 4,
      digitalMessageTheme: formTheme,
      digitalMessageThemeAr: formThemeAr || formTheme,
      isDeleted: false
    };

    const decorated = decorateRecord(payload, currentUser?.id || "system", "create");

    try {
      await mutateScopedContent({ domain: "CAMPAIGN", operation: "UPSERT", id: campId, payload: decorated });
      setShowModal(false);
      await logAudit("Create", `Launched new campaign "${formName}" for brand ${formBrand}`);
      // Reset form
      setFormName("");
      setFormNameAr("");
      setFormTheme("");
      setFormThemeAr("");
    } catch (err) {
      console.error(err);
      setErrorMsg(isRtl ? "فشل الحفظ في قاعدة البيانات." : "Failed to save the campaign to Firestore.");
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      
      {/* Header section */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-100 dark:bg-violet-950 flex items-center justify-center text-violet-600 dark:text-violet-400">
              <Megaphone size={22} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                {isRtl ? "الحملات التسويقية والترويجية" : "Corporate Marketing Campaigns"}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {isRtl ? "استعراض ومتابعة حملات الترويج المعتمدة على مستوى الشركة ومخرجات الرسائل العلمية الرقمية" : "Active clinical launch campaigns, target audiences, and messaging themes."}
              </p>
            </div>
          </div>
        </div>

        {canManage && (
          <button
            onClick={() => {
              setErrorMsg("");
              setShowModal(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[10px] rounded-xl shadow-sm transition-colors cursor-pointer self-start sm:self-center"
          >
            <Plus size={12} />
            <span>{isRtl ? "إطلاق حملة جديدة" : "Launch New Campaign"}</span>
          </button>
        )}
      </div>

      {/* Campaign Grid Layout */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {campaigns.map((camp) => {
          const progress = camp.targetPhysicians > 0 
            ? Math.round((camp.completedPhysicians / camp.targetPhysicians) * 100) 
            : 0;

          return (
            <div 
              key={camp.id} 
              className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl p-5 shadow-xxs flex flex-col justify-between space-y-4 hover:border-indigo-50 dark:hover:border-indigo-950 transition-colors"
            >
              <div className="space-y-3">
                
                {/* Status Badge & Code */}
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] font-bold text-slate-400">
                    {camp.id}
                  </span>
                  
                  <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                    camp.status === "Active" 
                      ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400"
                      : camp.status === "Upcoming"
                      ? "bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400"
                      : "bg-slate-100 dark:bg-slate-800 text-slate-600"
                  }`}>
                    {camp.status === "Active" ? (isRtl ? "نشطة" : "Active") : camp.status === "Upcoming" ? (isRtl ? "قادمة قريباً" : "Upcoming") : (isRtl ? "منتهية" : "Completed")}
                  </span>
                </div>

                {/* Campaign Name */}
                <div className="space-y-1">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white leading-snug">
                    {isRtl ? camp.nameAr : camp.name}
                  </h3>
                  <div className="flex items-center gap-1.5 text-xs text-violet-600 dark:text-violet-400 font-semibold">
                    <Target size={13} />
                    <span>{isRtl ? camp.therapeuticAreaAr : camp.therapeuticArea} ({camp.brand})</span>
                  </div>
                </div>

                {/* Digital Message Theme Box */}
                <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded-xl border border-slate-100 dark:border-slate-900/60 text-xxs leading-relaxed text-slate-600 dark:text-slate-400">
                  <span className="block font-bold text-slate-400 uppercase tracking-wide mb-1">
                    {isRtl ? "الرسالة العلمية والمحاور الرقمية" : "Core Detailing Message Theme"}
                  </span>
                  {isRtl ? camp.digitalMessageThemeAr : camp.digitalMessageTheme}
                </div>
              </div>

              {/* Progress & Target Details */}
              <div className="pt-3 border-t border-slate-50 dark:border-slate-850 space-y-2">
                <div className="flex justify-between items-center text-xxs text-slate-400 font-bold uppercase">
                  <span>{isRtl ? "تغطية الأطباء المستهدفة" : "Target Doctors Coverage"}</span>
                  <span className="font-mono text-slate-900 dark:text-white">{progress}%</span>
                </div>

                {/* Bar */}
                <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                  <div 
                    className="bg-violet-600 h-full rounded-full transition-all duration-500"
                    style={{ width: `${progress}%` }}
                  />
                </div>

                <div className="flex justify-between text-xxs text-slate-500 font-mono">
                  <span>{camp.startDate} {isRtl ? "إلى" : "to"} {camp.endDate}</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200">
                    {camp.completedPhysicians} / {camp.targetPhysicians} {isRtl ? "طبيب" : "docs"}
                  </span>
                </div>
              </div>
            </div>
          );
        })}

        {campaigns.length === 0 && (
          <div className="col-span-full py-12 text-center text-xs text-slate-400 border border-dashed rounded-2xl bg-slate-50/50 dark:bg-slate-900/30">
            {isRtl ? "لا توجد حملات تسويقية نشطة حالياً." : "No promotional or marketing campaigns are currently active."}
          </div>
        )}
      </div>

      {/* CREATE MODAL */}
      {showModal && (
        <div className="fixed inset-0 bg-slate-900/60 dark:bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-100 dark:border-slate-800 max-w-md w-full p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                {isRtl ? "إطلاق حملة تسويقية ترويجية جديدة" : "Launch New Marketing Campaign"}
              </h3>
              <button 
                onClick={() => setShowModal(false)}
                className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-400 transition-colors"
              >
                <X size={14} />
              </button>
            </div>

            {errorMsg && (
              <div className="p-3 bg-rose-50 dark:bg-rose-950/20 text-rose-600 rounded-xl text-xxs flex items-center gap-2">
                <AlertCircle size={14} />
                <span>{errorMsg}</span>
              </div>
            )}

            <form onSubmit={handleCreateCampaign} className="space-y-4 text-xs">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                  {isRtl ? "اسم الحملة بالإنجليزية *" : "Campaign Name (EN) *"}
                </label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. CardioMax Lipids Support Initiative 2026"
                  className="w-full bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                  {isRtl ? "اسم الحملة بالعربية" : "Campaign Name (Arabic)"}
                </label>
                <input
                  type="text"
                  value={formNameAr}
                  onChange={(e) => setFormNameAr(e.target.value)}
                  dir="rtl"
                  placeholder="أدخل اسم الحملة الترويجية..."
                  className="w-full bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                    {isRtl ? "البراند المرتبط" : "Linked Brand"}
                  </label>
                  <select
                    value={formBrand}
                    onChange={(e) => setFormBrand(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 font-bold"
                  >
                    <option value="Atorva">Atorva</option>
                    <option value="DermaSol">DermaSol</option>
                    <option value="FerroKids">FerroKids</option>
                    <option value="CardioMax">CardioMax</option>
                    <option value="KidVits">KidVits</option>
                    <option value="OrthoFlex">OrthoFlex</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                    {isRtl ? "الأطباء المستهدفين" : "Target Physicians"}
                  </label>
                  <input
                    type="number"
                    value={formTargetDocs}
                    onChange={(e) => setFormTargetDocs(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                    {isRtl ? "تاريخ البدء" : "Start Date"}
                  </label>
                  <input
                    type="date"
                    value={formStart}
                    onChange={(e) => setFormStart(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                    {isRtl ? "تاريخ الانتهاء" : "End Date"}
                  </label>
                  <input
                    type="date"
                    value={formEnd}
                    onChange={(e) => setFormEnd(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                    {isRtl ? "المجال العلاجي (EN)" : "Therapeutic Area (EN)"}
                  </label>
                  <input
                    type="text"
                    value={formTherapeuticArea}
                    onChange={(e) => setFormTherapeuticArea(e.target.value)}
                    placeholder="e.g. Cardiology"
                    className="w-full bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                    {isRtl ? "الوضع التشغيلي" : "Status"}
                  </label>
                  <select
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value as any)}
                    className="w-full bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 font-bold"
                  >
                    <option value="Active">Active</option>
                    <option value="Upcoming">Upcoming</option>
                    <option value="Completed">Completed</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                  {isRtl ? "الموضوع والرسالة الرقمية (EN) *" : "Message Theme (EN) *"}
                </label>
                <textarea
                  rows={2}
                  value={formTheme}
                  onChange={(e) => setFormTheme(e.target.value)}
                  placeholder="Core scientific message theme..."
                  className="w-full bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                  {isRtl ? "الموضوع والرسالة الرقمية (عربي)" : "Message Theme (Arabic)"}
                </label>
                <textarea
                  rows={2}
                  value={formThemeAr}
                  onChange={(e) => setFormThemeAr(e.target.value)}
                  dir="rtl"
                  placeholder="الموضوع العلمي والرسائل الترويجية الرقمية الشاملة..."
                  className="w-full bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5"
                />
              </div>

              <div className="flex gap-2 justify-end pt-3 border-t">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 border border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-xl font-bold text-slate-500 cursor-pointer"
                >
                  {isRtl ? "إلغاء" : "Cancel"}
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold shadow-sm cursor-pointer"
                >
                  {isRtl ? "إطلاق الحملة" : "Launch Campaign"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
