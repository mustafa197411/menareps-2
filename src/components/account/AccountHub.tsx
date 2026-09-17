import React, { useState } from "react";
import { Role, normalizeRole } from "../../types";
import { 
  BookOpen, 
  Settings, 
  Globe, 
  MapPin, 
  Smartphone, 
  ShieldAlert, 
  HelpCircle, 
  CheckCircle, 
  User, 
  Lock, 
  FileCheck, 
  Search, 
  BookOpenCheck
} from "lucide-react";
import { isGPSDemoMode, setGPSDemoMode } from "../../lib/gpsHardening";

interface AccountHubProps {
  currentUser: any;
  lang: "en" | "ar";
  initialTab?: "manual" | "settings";
}

export default function AccountHub({ currentUser, lang, initialTab = "manual" }: AccountHubProps) {
  const isRtl = lang === "ar";
  const normalizedRole = normalizeRole(currentUser?.role);
  const isSalesRep = normalizedRole === Role.SALES_REP;

  const [activeTab, setActiveTab] = useState<"manual" | "settings">(initialTab);
  const [manualSearch, setManualSearch] = useState("");
  const [successToast, setSuccessToast] = useState("");

  // Settings states
  const [notifEnabled, setNotifEnabled] = useState(true);
  const [offlineSyncEnabled, setOfflineSyncEnabled] = useState(true);
  const [gpsDemoMode, setGpsDemoModeState] = useState(isGPSDemoMode);
  const [securityToken, setSecurityToken] = useState("MENA-REP-SECURE-99X2");

  // User manual topics
  const manualTopics = [
    {
      id: "MAN-01",
      title: isSalesRep ? "Commercial Field Activity & Territory Sync" : "Field Visit Detailing Instructions",
      titleAr: isSalesRep ? "إرشادات الأنشطة الميدانية ومزامنة الإقليم التجاري" : "تعليمات وإرشادات زيارات الأطباء التفصيلية",
      desc: isSalesRep 
        ? "Access your assigned territory pharmacies, schedule commercial visits, and verify GPS location coordinates prior to logging customer orders."
        : "Open the Physicians Hub, choose your target doctor, and click 'Detail Visit'. Select the featured brands and map any clinical objections to the approved Key Claims.",
      descAr: isSalesRep
        ? "افتح قائمة الصيدليات التابعة لإقليمك التجاري، وقم بجدولة الزيارات الميدانية، والتحقق من التوثيق الجغرافي قبل إدخال طلبات العملاء."
        : "افتح منصة الأطباء، اختر الطبيب المستهدف، ثم انقر على 'زيارة تفصيلية'. اختر الأصناف الطبية المعروضة وقم بمطابقة أي اعتراضات علمية مع الحجج المقبولة والمعتمدة."
    },
    {
      id: "MAN-02",
      title: "Sales Order Workflow Procedures",
      titleAr: "إجراءات إدخال وصرف طلبيات الصيدليات",
      desc: "Go to the Pharmacy List, check the customer outstanding balances and commercial credit limit. Create a sales order with precise discounts, and submit for real-time stock deduction.",
      descAr: "انتقل إلى قائمة الصيدليات، وتحقق من الأرصدة المستحقة وحدود الائتمان التجاري. قم بإنشاء طلب مبيعات بخصومات دقيقة، ثم اعتمده ليتم خصم المخزون فوراً من المستودعات."
    },
    {
      id: "MAN-03",
      title: "GPS Verification Guidelines",
      titleAr: "سياسة التحقق التوثيقي الجغرافي",
      desc: "First field visit acquires live physical coordinates to establish permanent GPS verification. Once verified, subsequent visits proceed immediately without GPS checks.",
      descAr: "الزيارة الميدانية الأولى تقوم بتسجيل الإحداثيات الميدانية لتوثيق الموقع الجغرافي بشكل دائم. فور التوثيق، تتيح الزيارات اللاحقة المتابعة الفورية دون فحص الموقع."
    },
    {
      id: "MAN-04",
      title: "Spreadsheet Data Imports & Rollback",
      titleAr: "استيراد ملفات المزامنة واستعادة البيانات",
      desc: "Admins can import user lists, products, and physicians using CSV/Excel templates. If a data collision occurs, use the 'Rollback' button in the Import History to restore the previous roster state.",
      descAr: "يمكن للمسؤولين استيراد قوائم المندوبين، المنتجات، والأطباء باستخدام نماذج CSV/Excel المعتمدة. في حال حدوث تداخل أو خطأ في البيانات، انقر على زر 'استعادة الحالة السابقة' لاسترجاع البيانات السليمة."
    }
  ];

  const filteredTopics = manualTopics.filter(t => {
    const term = manualSearch.toLowerCase();
    return (
      t.title.toLowerCase().includes(term) ||
      t.titleAr.includes(manualSearch) ||
      t.desc.toLowerCase().includes(term) ||
      t.descAr.includes(manualSearch)
    );
  });

  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    setSuccessToast(isRtl ? "تم حفظ التفضيلات والخصوصية بنجاح!" : "Account and security settings saved successfully!");
    setTimeout(() => setSuccessToast(""), 3000);
  };

  return (
    <div className="p-4 md:p-6 max-w-full overflow-x-hidden space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-850 flex items-center justify-center text-slate-700 dark:text-slate-300 shrink-0">
              <BookOpenCheck size={22} />
            </div>
            <div>
              <h2 className="text-lg md:text-xl font-bold text-slate-900 dark:text-white">
                {isRtl ? "الملف الشخصي ومركز المساعدة" : "Help Desk & Representative Account"}
              </h2>
              <p className="text-[11px] md:text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {isRtl ? "كتيب المساعدة السريع الموضح للعمليات الميدانية وتعديل إعدادات وتفضيلات الحساب" : "Instruction documentation guiding field reps, paired with custom workspace configurations."}
              </p>
            </div>
          </div>
        </div>

        {/* Tab selection */}
        <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg text-xs font-bold self-start lg:self-auto">
          <button 
            onClick={() => setActiveTab("manual")}
            className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${activeTab === "manual" ? "bg-white dark:bg-slate-900 text-slate-850 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
          >
            {isRtl ? "دليل المندوب الميداني" : "Field Manual"}
          </button>
          <button 
            onClick={() => setActiveTab("settings")}
            className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${activeTab === "settings" ? "bg-white dark:bg-slate-900 text-slate-850 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
          >
            {isRtl ? "تفضيلات الحساب" : "Preferences"}
          </button>
        </div>
      </div>

      {successToast && (
        <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900 rounded-xl text-xs font-semibold flex items-center gap-2">
          <CheckCircle size={16} />
          <span>{successToast}</span>
        </div>
      )}

      {activeTab === "manual" && (
        <div className="space-y-6">
          {/* Manual Search */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-4 rounded-xl">
            <div>
              <h3 className="text-xs font-bold text-slate-800 dark:text-white">
                {isRtl ? "دليل استخدام منصة MENAREPS" : "Interactive Knowledge Base & FAQs"}
              </h3>
              <p className="text-[10px] text-slate-400 mt-0.5">{isRtl ? "ابحث في الإجراءات والخطوات التشغيلية لضمان الامتثال الطبي" : "Search detailed modules covering medical detailings, GPS verification, and deliveries."}</p>
            </div>

            <div className="relative w-full sm:w-64">
              <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
              <input 
                type="text" 
                value={manualSearch}
                onChange={(e) => setManualSearch(e.target.value)}
                placeholder={isRtl ? "بحث في كتيب المساعدة..." : "Search user manual..."}
                className="w-full pl-8 pr-3 py-1.5 border border-slate-200 dark:border-slate-800 rounded-lg text-xxs bg-transparent text-slate-800 dark:text-white"
              />
            </div>
          </div>

          {/* Topics Accordion/Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredTopics.map((topic) => (
              <div 
                key={topic.id}
                className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-5 rounded-xl space-y-2 text-xs"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[9px] font-bold text-slate-400">{topic.id}</span>
                  <h4 className="font-bold text-slate-900 dark:text-white text-xs">
                    {isRtl ? topic.titleAr : topic.title}
                  </h4>
                </div>
                <p className="text-slate-500 leading-relaxed text-[11px]">
                  {isRtl ? topic.descAr : topic.desc}
                </p>
              </div>
            ))}

            {filteredTopics.length === 0 && (
              <div className="col-span-2 text-center text-slate-400 py-6">
                {isRtl ? "لا توجد نتائج مطابقة لبحثك" : "No training modules found matching your search."}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === "settings" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-5 space-y-6">
            
            <div>
              <h3 className="text-sm font-semibold text-slate-800 dark:text-white flex items-center gap-2">
                <User size={16} className="text-indigo-500" />
                {isRtl
                  ? "معلومات وتفضيلات ملفك الشخصي"
                  : isSalesRep
                  ? "Sales Representative Profile Identity & Prefs"
                  : normalizedRole === Role.MEDICAL_REP
                  ? "MedRep Profile Identity & Prefs"
                  : `${currentUser?.role || "Representative"} Profile Identity & Prefs`}
              </h3>
              <p className="text-xxs text-slate-400 mt-0.5">
                {isRtl
                  ? "تعديل تفضيلات لغة النظام، الخصوصية ومستوى المزامنة"
                  : isSalesRep
                  ? "Configure commercial territory synchronization, pharmacy scheduling, and operational preferences."
                  : "Configure individual synchronization intervals and regional metrics."}
              </p>
            </div>

            <form onSubmit={handleSaveSettings} className="space-y-6 text-xs text-slate-700 dark:text-slate-300">
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <span className="text-slate-400 block uppercase font-mono text-[8px] font-bold mb-1">{isRtl ? "الاسم التشغيلي الكامل:" : "Full Representative Name:"}</span>
                  <strong className="text-slate-800 dark:text-white font-medium text-xs block p-2 bg-slate-50/80 dark:bg-slate-950/40 border border-slate-100 dark:border-slate-850 rounded-lg">{currentUser?.name || "Omar Al-Mokhtar"}</strong>
                </div>

                <div>
                  <span className="text-slate-400 block uppercase font-mono text-[8px] font-bold mb-1">{isRtl ? "المسمى الوظيفي والدور:" : "Role Classification:"}</span>
                  <strong className="text-indigo-600 dark:text-indigo-400 font-bold text-xs block p-2 bg-slate-50/80 dark:bg-slate-950/40 border border-slate-100 dark:border-slate-850 rounded-lg">{currentUser?.role || "Medical Representative"}</strong>
                </div>
              </div>

              {/* Toggles */}
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 border border-slate-100 dark:border-slate-800 rounded-xl bg-slate-50/20">
                  <div>
                    <span className="font-bold text-slate-850 dark:text-white block">
                      {isRtl 
                        ? "تفعيل إشعارات الزيارات والمواعيد" 
                        : isSalesRep 
                        ? "Enable Push Schedules & Pharmacy Reminders" 
                        : "Enable Push Schedules & Reminders"}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      {isRtl 
                        ? "إرسال تذكير تلقائي على جهازك قبل موعد زيارة الصيدلية أو الطبيب بـ ١٥ دقيقة" 
                        : isSalesRep 
                        ? "Send automatic alert notifications 15 minutes before scheduled pharmacy field visits." 
                        : "Send automatic alert notifications 15 minutes before physician appointments."}
                    </span>
                  </div>
                  <input 
                    type="checkbox" 
                    checked={notifEnabled} 
                    onChange={(e) => setNotifEnabled(e.target.checked)}
                    className="w-4 h-4 text-indigo-600 bg-slate-100 border-slate-300 rounded accent-indigo-600 cursor-pointer" 
                  />
                </div>

                <div className="flex items-center justify-between p-3 border border-slate-100 dark:border-slate-800 rounded-xl bg-slate-50/20">
                  <div>
                    <span className="font-bold text-slate-850 dark:text-white block">{isRtl ? "تمكين محاكاة الموقع (وضع التجربة)" : "Enable GPS Simulation (Demo Fallback)"}</span>
                    <span className="text-[10px] text-slate-400">{isRtl ? "يسمح باستخدام إحداثيات افتراضية إذا لم تتوفر إشارة GPS أو تم رفض إذن تحديد الموقع بالمتصفح" : "Allow mock fallback coordinates if native GPS is denied, timed out, or unavailable in local testing."}</span>
                  </div>
                  <input 
                    type="checkbox" 
                    checked={gpsDemoMode} 
                    onChange={(e) => {
                      setGpsDemoModeState(e.target.checked);
                      setGPSDemoMode(e.target.checked);
                    }}
                    className="w-4 h-4 text-indigo-600 bg-slate-100 border-slate-300 rounded accent-indigo-600 cursor-pointer" 
                  />
                </div>

                <div className="flex items-center justify-between p-3 border border-slate-100 dark:border-slate-800 rounded-xl bg-slate-50/20">
                  <div>
                    <span className="font-bold text-slate-850 dark:text-white block">{isRtl ? "تمكين المزامنة والعمل بدون إنترنت" : "Offline Storage and Geocache Sync"}</span>
                    <span className="text-[10px] text-slate-400">{isRtl ? "السماح بحفظ بيانات التفاصيل والطلبات في ذاكرة المتصفح وصرفها لاحقاً عند الاتصال" : "Store check-ins locally when network bandwidth is weak and sync dynamically."}</span>
                  </div>
                  <input 
                    type="checkbox" 
                    checked={offlineSyncEnabled} 
                    onChange={(e) => setOfflineSyncEnabled(e.target.checked)}
                    className="w-4 h-4 text-indigo-600 bg-slate-100 border-slate-300 rounded accent-indigo-600 cursor-pointer" 
                  />
                </div>
              </div>

              {/* Security block */}
              <div className="space-y-2">
                <label className="block text-xxs font-mono text-slate-400 uppercase font-bold">{isRtl ? "رمز التوثيق الأمني للمزامنة:" : "Secure Device Authorization Token:"}</label>
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    value={securityToken}
                    onChange={(e) => setSecurityToken(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-transparent text-slate-800 dark:text-white font-mono text-xs"
                    required
                  />
                  <button 
                    type="button"
                    onClick={() => {
                      setSecurityToken(`MENA-REP-SECURE-${Math.floor(1000 + Math.random() * 9000)}`);
                      alert(isRtl ? "تم توليد رمز أمان جديد للجهاز!" : "Generated new secure hardware key!");
                    }}
                    className="px-3 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold rounded-lg text-xxs cursor-pointer shrink-0"
                  >
                    {isRtl ? "توليد مفتاح جديد" : "Regen Token"}
                  </button>
                </div>
              </div>

              <button 
                type="submit"
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg cursor-pointer text-xxs"
              >
                {isRtl ? "تطبيق وتحديث التفضيلات" : "Apply Preferences"}
              </button>
            </form>
          </div>

          {/* Sidebar compliance alerts */}
          <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-5 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-800 dark:text-white flex items-center gap-2">
                <ShieldAlert size={16} className="text-amber-500" />
                {isRtl ? "إشعارات جدار الامتثال الأمني" : "Security Compliance Feed"}
              </h3>
              <p className="text-xxs text-slate-400 mt-0.5">{isRtl ? "تفويضات الجهاز وسجلات التوثيق والمزامنة الأخيرة" : "Live indicators verifying device health and sync status."}</p>
            </div>

            <div className="space-y-3 text-[11px] text-slate-500 leading-relaxed">
              <div className="p-3 bg-slate-50 dark:bg-slate-950/50 rounded-xl space-y-1">
                <span className="font-bold text-slate-800 dark:text-white block">{isRtl ? "ترخيص التحقق الجغرافي GPS" : "GPS Authorization State"}</span>
                <span className="text-emerald-600 font-bold">✓ {isRtl ? "مرخص ومفعل" : "Granted / High Precision Enabled"}</span>
              </div>

              <div className="p-3 bg-slate-50 dark:bg-slate-950/50 rounded-xl space-y-1">
                <span className="font-bold text-slate-800 dark:text-white block">{isRtl ? "آخر مزامنة لقاعدة البيانات" : "Last Database Sync Time"}</span>
                <span className="font-mono text-slate-700 dark:text-slate-300">2026-06-27 14:36 UTC</span>
              </div>

              <div className="p-3 bg-amber-50/40 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900 rounded-xl flex items-start gap-2 text-[10px] text-amber-800 dark:text-amber-400">
                <Lock size={14} className="mt-0.5 shrink-0" />
                <span>Device session will lock and require validation if inactive for more than 20 minutes. Keep your GPS log active.</span>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
