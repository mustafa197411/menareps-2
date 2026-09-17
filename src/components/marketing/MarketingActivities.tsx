import React, { useState, useEffect, useMemo } from "react";
import { motion } from "motion/react";
import { 
  Plus, 
  Search, 
  Calendar, 
  MapPin, 
  Users, 
  DollarSign, 
  Tag, 
  Bookmark, 
  Check, 
  X,
  FileSpreadsheet,
  Clock,
  Sparkles,
  Info,
  AlertCircle
} from "lucide-react";
import { collection, onSnapshot, doc, setDoc, deleteDoc } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { decorateRecord } from "../../lib/firebaseSync";
import { AuditLog } from "../../types";
import { saveAuditLogRecord } from "../../lib/firestoreService";
import { mutateScopedContent } from "../../lib/scopedContentMutationClient";

interface MarketingActivitiesProps {
  currentUser: any;
  lang: "en" | "ar";
}

interface Activity {
  id: string;
  name: string;
  nameAr: string;
  type: "Roundtable" | "Symposium" | "Awareness Campaign" | "Workshop";
  typeAr: string;
  brand: string;
  date: string;
  location: string;
  locationAr: string;
  expectedDoctors: number;
  budget: number;
  status: "Planned" | "Approved" | "Completed" | "Cancelled";
}

export default function MarketingActivities({ currentUser, lang }: MarketingActivitiesProps) {
  const isRtl = lang === "ar";
  
  const [activities, setActivities] = useState<Activity[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [formError, setFormError] = useState("");

  // Add Form fields
  const [name, setName] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [type, setType] = useState<"Roundtable" | "Symposium" | "Awareness Campaign" | "Workshop">("Roundtable");
  const [brand, setBrand] = useState("Atorva");
  const [date, setDate] = useState("2026-07-15");
  const [location, setLocation] = useState("");
  const [locationAr, setLocationAr] = useState("");
  const [doctorsCount, setDoctorsCount] = useState("");
  const [budgetVal, setBudgetVal] = useState("");

  const defaultResources: Activity[] = [];

  // 1. Listen for real-time marketing activities
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "marketingActivities"), (snapshot) => {
      const list: Activity[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        if (!data.isDeleted) {
          list.push({ id: doc.id, ...data } as Activity);
        }
      });
      setActivities(list);
    }, (err) => {
      console.warn("[MarketingActivities] Firestore subscription failed:", err);
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
      entityType: "MarketingActivity",
      entityName: "Marketing Activities",
      details
    };

    try {
      await saveAuditLogRecord(auditRecord);
    } catch (e) {
      console.error("Audit log failed:", e);
    }
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");

    if (!name.trim() || !location.trim() || !doctorsCount.trim() || !budgetVal.trim()) {
      setFormError(isRtl ? "يرجى ملء جميع الحقول الإلزامية." : "Please fill in all mandatory fields.");
      return;
    }

    const actId = `ACT-${Math.floor(100 + Math.random() * 899)}`;
    const payload = {
      id: actId,
      name,
      nameAr: nameAr || name,
      type,
      typeAr: type === "Roundtable" ? "حلقة نقاشية" : type === "Symposium" ? "ندوة علمية" : type === "Workshop" ? "ورشة عمل" : "حملة توعية",
      brand,
      date,
      location,
      locationAr: locationAr || location,
      expectedDoctors: parseInt(doctorsCount) || 10,
      budget: parseFloat(budgetVal) || 500,
      status: "Planned",
      isDeleted: false
    };

    const decorated = decorateRecord(payload, currentUser?.id || "system", "create");

    try {
      await mutateScopedContent({ domain: "ACTIVITY", operation: "UPSERT", id: actId, payload: decorated });
      setShowAddForm(false);
      await logAudit("Create", `Planned scientific event "${name}" on ${date} with budget $${budgetVal}`);
      
      // reset
      setName("");
      setNameAr("");
      setLocation("");
      setLocationAr("");
      setDoctorsCount("");
      setBudgetVal("");
    } catch (err) {
      console.error(err);
      setFormError(isRtl ? "حدث خطأ أثناء الاتصال بقاعدة البيانات." : "Firestore save error.");
    }
  };

  const filteredActivities = activities.filter(act => {
    const term = searchTerm.toLowerCase();
    return (
      act.name.toLowerCase().includes(term) ||
      (act.nameAr && act.nameAr.includes(searchTerm)) ||
      act.brand.toLowerCase().includes(term) ||
      act.location.toLowerCase().includes(term)
    );
  });

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-100 dark:bg-violet-950 flex items-center justify-center text-violet-600 dark:text-violet-400">
              <Calendar size={22} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                {isRtl ? "الأنشطة والندوات العلمية" : "Scientific Roundtables & Seminars"}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {isRtl ? "تخطيط وتنظيم الأنشطة الميدانية والحلقات النقاشية والندوات العلمية للأطباء المتخصصين" : "Plan medical symposiums, hospital workshops, and clinical roundtables."}
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={() => {
            setFormError("");
            setShowAddForm(!showAddForm);
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[10px] rounded-xl shadow-sm transition-colors cursor-pointer self-start sm:self-center"
        >
          {showAddForm ? <X size={12} /> : <Plus size={12} />}
          <span>{showAddForm ? (isRtl ? "إلغاء التخطيط" : "Cancel Plan") : (isRtl ? "تخطيط نشاط طبي" : "Plan Scientific Event")}</span>
        </button>
      </div>

      {/* Warning/Guide Box */}
      <div className="bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-4 rounded-2xl flex items-start gap-3 text-xs leading-relaxed text-slate-500">
        <Info size={16} className="text-indigo-600 shrink-0 mt-0.5" />
        <p>
          {isRtl 
            ? "تخضع جميع الأنشطة الطبية والندوات لقوانين مكافحة الرشوة الدولية والامتثال الدوائي. يجب تدوين عدد الأطباء المتوقع بدقة وموقع الانعقاد في مستشفى حكومي أو صالة علمية معتمدة."
            : "Compliance Directive: All hospital symposia and clinical roundtables must be conducted in institutional scientific settings. Budget requests must align strictly with approved guidelines per clinician attendee."
          }
        </p>
      </div>

      {/* Add Form collapsing block */}
      {showAddForm && (
        <motion.div 
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-5 rounded-2xl shadow-xs space-y-4"
        >
          <div className="border-b pb-2 flex items-center justify-between">
            <h3 className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1">
              <Sparkles size={14} className="text-violet-600" />
              {isRtl ? "تفاصيل النشاط الطبي الجديد" : "New Medical Activity Details"}
            </h3>
          </div>

          {formError && (
            <div className="p-3 bg-rose-50 dark:bg-rose-950/20 text-rose-600 rounded-xl text-xxs flex items-center gap-2">
              <AlertCircle size={14} />
              <span>{formError}</span>
            </div>
          )}

          <form onSubmit={handleAddSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">{isRtl ? "عنوان النشاط (EN) *" : "Activity Name (EN) *"}</label>
              <input 
                type="text" 
                value={name} 
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Lipids Reduction Cardiology Roundtable"
                className="w-full bg-slate-50 dark:bg-slate-800/40 rounded-xl p-2.5 border border-transparent focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">{isRtl ? "عنوان النشاط بالعربية" : "Activity Name (Arabic)"}</label>
              <input 
                type="text" 
                value={nameAr} 
                onChange={(e) => setNameAr(e.target.value)}
                dir="rtl"
                placeholder="حلقة نقاشية حول خفض الدهون والبروتين الدهني..."
                className="w-full bg-slate-50 dark:bg-slate-800/40 rounded-xl p-2.5 border border-transparent focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">{isRtl ? "البراند الطبي" : "Linked Brand"}</label>
              <select 
                value={brand} 
                onChange={(e) => setBrand(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-800/40 rounded-xl p-2.5 font-bold"
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
              <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">{isRtl ? "نوع الفعالية الطبية" : "Event Type"}</label>
              <select 
                value={type} 
                onChange={(e) => setType(e.target.value as any)}
                className="w-full bg-slate-50 dark:bg-slate-800/40 rounded-xl p-2.5 font-bold"
              >
                <option value="Roundtable">Roundtable Discussion</option>
                <option value="Symposium">Scientific Symposium</option>
                <option value="Workshop">Clinical Workshop</option>
                <option value="Awareness Campaign">Awareness Campaign</option>
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">{isRtl ? "تاريخ الفعالية" : "Event Date"}</label>
              <input 
                type="date" 
                value={date} 
                onChange={(e) => setDate(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-800/40 rounded-xl p-2.5 font-mono"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">{isRtl ? "الأطباء المتوقع حضورهم" : "Expected Clinician Attendees *"}</label>
              <input 
                type="number" 
                value={doctorsCount} 
                onChange={(e) => setDoctorsCount(e.target.value)}
                placeholder="e.g. 15"
                className="w-full bg-slate-50 dark:bg-slate-800/40 rounded-xl p-2.5 font-mono"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">{isRtl ? "الموقع بالإنجليزية *" : "Location (EN) *"}</label>
              <input 
                type="text" 
                value={location} 
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. Tripoli Medical Center Conference Room"
                className="w-full bg-slate-50 dark:bg-slate-800/40 rounded-xl p-2.5"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">{isRtl ? "الموقع بالعربية" : "Location (Arabic)"}</label>
              <input 
                type="text" 
                value={locationAr} 
                onChange={(e) => setLocationAr(e.target.value)}
                dir="rtl"
                placeholder="قاعة المؤتمرات بمركز طرابلس الطبي..."
                className="w-full bg-slate-50 dark:bg-slate-800/40 rounded-xl p-2.5"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">{isRtl ? "الميزانية المتوقعة (USD) *" : "Estimated Budget ($ USD) *"}</label>
              <input 
                type="number" 
                value={budgetVal} 
                onChange={(e) => setBudgetVal(e.target.value)}
                placeholder="e.g. 1200"
                className="w-full bg-slate-50 dark:bg-slate-800/40 rounded-xl p-2.5 font-mono"
              />
            </div>

            <div className="sm:col-span-2 flex justify-end gap-2 pt-3 border-t">
              <button 
                type="button" 
                onClick={() => setShowAddForm(false)}
                className="px-4 py-2 border rounded-xl text-slate-500 font-bold"
              >
                {isRtl ? "إلغاء" : "Cancel"}
              </button>
              <button 
                type="submit" 
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold"
              >
                {isRtl ? "حفظ وتخطيط الفعالية" : "Save and Plan Event"}
              </button>
            </div>
          </form>
        </motion.div>
      )}

      {/* Search Toolbar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-4 rounded-2xl flex items-center justify-between">
        <div className="relative w-full max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input 
            type="text" 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={isRtl ? "البحث بالاسم أو الموقع أو البراند..." : "Search event, brand, or clinic venue..."}
            className="w-full text-xs pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-transparent focus:border-indigo-500 bg-transparent"
          />
        </div>

        <span className="text-[10px] text-slate-400 font-mono">
          {filteredActivities.length} {isRtl ? "أنشطة مجدولة" : "events scheduled"}
        </span>
      </div>

      {/* Activities list */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {filteredActivities.map((act) => (
          <div 
            key={act.id}
            className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-5 rounded-2xl shadow-xxs flex flex-col justify-between space-y-4 hover:border-indigo-50 transition-colors"
          >
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-mono font-bold text-slate-400">
                  {act.id} • {act.brand}
                </span>

                <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                  act.status === "Approved"
                    ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400"
                    : act.status === "Completed"
                    ? "bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400"
                    : act.status === "Cancelled"
                    ? "bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400"
                    : "bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400"
                }`}>
                  {act.status === "Approved" ? (isRtl ? "معتمد" : "Approved") : act.status === "Completed" ? (isRtl ? "مكتمل" : "Completed") : act.status === "Cancelled" ? (isRtl ? "ملغي" : "Cancelled") : (isRtl ? "مخطط له" : "Planned")}
                </span>
              </div>

              <div>
                <span className="text-[9px] font-bold uppercase text-slate-400 tracking-wide block mb-0.5">
                  {isRtl ? act.typeAr : act.type}
                </span>
                <h4 className="text-xs font-bold text-slate-900 dark:text-white leading-snug">
                  {isRtl ? act.nameAr : act.name}
                </h4>
              </div>

              {/* Specs */}
              <div className="grid grid-cols-2 gap-2 text-xxs text-slate-500 font-mono pt-2 border-t border-slate-50 dark:border-slate-850">
                <div className="flex items-center gap-1.5">
                  <Calendar size={12} className="text-slate-400" />
                  <span>{act.date}</span>
                </div>

                <div className="flex items-center gap-1.5">
                  <Users size={12} className="text-slate-400" />
                  <span>{act.expectedDoctors} {isRtl ? "طبيب مستهدف" : "expected docs"}</span>
                </div>

                <div className="flex items-center gap-1.5 col-span-2">
                  <MapPin size={12} className="text-slate-400 shrink-0" />
                  <span className="truncate">{isRtl ? act.locationAr : act.location}</span>
                </div>
              </div>
            </div>

            {/* Budget Display footer */}
            <div className="pt-3 border-t border-slate-50 dark:border-slate-850 flex justify-between items-center text-xs">
              <span className="text-slate-400">{isRtl ? "ميزانية الرعاية الطبية:" : "Approved Event Budget:"}</span>
              <span className="font-extrabold text-indigo-600 dark:text-indigo-400 font-mono">
                ${act.budget.toLocaleString()}
              </span>
            </div>
          </div>
        ))}

        {filteredActivities.length === 0 && (
          <div className="col-span-full py-12 text-center text-xs text-slate-400 border border-dashed rounded-2xl">
            {activities.length === 0 ? (
              isRtl ? "لا توجد فعاليات أو حلقات نقاشية مسجلة حالياً." : "No scientific activities or roundtables are currently planned."
            ) : (
              isRtl ? "لم يتم العثور على أي فعاليات تطابق البحث." : "No activities match your current search criteria."
            )}
          </div>
        )}
      </div>
    </div>
  );
}
