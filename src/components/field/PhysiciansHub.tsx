import React from "react";
import { 
  Users, 
  UserPlus, 
  MapPin, 
  Calendar, 
  Award, 
  Activity, 
  Stethoscope, 
  ChevronRight, 
  ChevronLeft,
  ArrowUpRight,
  TrendingUp,
  Clock
} from "lucide-react";

interface PhysiciansHubProps {
  lang: "en" | "ar";
  onNavigate?: (target: string) => void;
}

export default function PhysiciansHub({ lang, onNavigate }: PhysiciansHubProps) {
  const isRtl = lang === "ar";

  React.useEffect(() => {
    console.info(
      "[PHYSICIAN_PROP_FINAL_COMPONENT_JSON]",
      JSON.stringify({
        componentName: "PhysiciansHub",
        receivedPhysicianCount: 0,
        receivedPhysicianIds: [],
        displayPhysicianCount: 0,
        filteredPhysicianCount: 0,
        finalDisplayedIds: []
      })
    );
  }, []);

  const stats = [
    { 
      label: isRtl ? "إجمالي الأطباء المسجلين" : "Total Registered Physicians", 
      value: "148", 
      sub: isRtl ? "+12 هذا الشهر" : "+12 this month", 
      icon: Users,
      color: "bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-400"
    },
    { 
      label: isRtl ? "أطباء التصنيف (A)" : "Class A Physicians", 
      value: "64", 
      sub: isRtl ? "مستهدف تكرار عالي" : "High frequency target", 
      icon: Award,
      color: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400"
    },
    { 
      label: isRtl ? "متوسط زيارات التغطية" : "Avg Visit Coverage", 
      value: "94.2%", 
      sub: isRtl ? "مستهدف ربع سنوي" : "Quarterly target met", 
      icon: Activity,
      color: "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400"
    },
    { 
      label: isRtl ? "مدة الزيارة المتوسطة" : "Avg Detail Duration", 
      value: "11.8m", 
      sub: isRtl ? "فعالية الرسالة الطبية" : "Detail message efficiency", 
      icon: Clock,
      color: "bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400"
    }
  ];

  const specialtyDistribution = [
    { specialty: isRtl ? "أخصائي جلدية" : "Dermatologist", count: 42, percentage: "28%" },
    { specialty: "GP - Derma Focus", count: 35, percentage: "24%" },
    { specialty: isRtl ? "طب أطفال" : "Pediatrician", count: 28, percentage: "19%" },
    { specialty: isRtl ? "قلب وأوعية دموية" : "Cardiologist", count: 23, percentage: "15%" },
    { specialty: isRtl ? "أخرى" : "Others", count: 20, percentage: "14%" }
  ];

  const recentInteractions = [
    { id: "PHY-002", name: isRtl ? "د. عبد الباري المنفي" : "Dr. Abdul Bari Al Manifi", date: "Today, 11:30 AM", type: isRtl ? "زيارة مبيعات" : "Sales Visit", status: "Completed" },
    { id: "PHY-004", name: isRtl ? "د. عبد الحميد السنوسي" : "Dr. Abdul Hamid Al Senussi", date: "Today, 09:15 AM", type: isRtl ? "مكالمة علمية" : "Scientific Detail", status: "Completed" },
    { id: "PHY-001", name: isRtl ? "د. جميلة اللافي" : "Dr. Jamila Allafy", date: "Yesterday", type: isRtl ? "تسليم عينات" : "Sample Disbursal", status: "Completed" },
    { id: "PHY-015", name: isRtl ? "د. عبد السلام الماجري" : "Dr. Abdul Salam Al Majri", date: "Yesterday", type: isRtl ? "مكالمة علمية" : "Scientific Detail", status: "Completed" }
  ];

  return (
    <div className="p-6 space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 p-6 rounded-2xl border border-slate-800 shadow-lg text-white">
        <div>
          <h2 className="text-xl md:text-2xl font-bold tracking-tight">
            {isRtl ? "لوحة الأطباء والزيارات الطبية" : "Physicians Hub & Operations"}
          </h2>
          <p className="text-slate-400 text-xs mt-1 max-w-xl">
            {isRtl 
              ? "الملف التعريفي الشامل للأطباء، ومستويات التغطية وتكرار الزيارات في مختلف مناطق ومدن ليبيا والشرق الأوسط."
              : "Comprehensive operational dashboard for physician demographic parameters, geographic classes, and contact rosters."
            }
          </p>
        </div>

        <div className="flex gap-2 w-full md:w-auto">
          <button 
            onClick={() => onNavigate && onNavigate("field-add-physician")}
            className="flex-1 md:flex-none inline-flex items-center justify-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs px-4 py-2.5 rounded-xl transition-all cursor-pointer shadow-md"
          >
            <UserPlus size={15} />
            <span>{isRtl ? "إضافة طبيب" : "Add Physician"}</span>
          </button>
        </div>
      </div>

      {/* Grid Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s, idx) => (
          <div key={idx} className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl p-4 shadow-xxs">
            <div className="flex justify-between items-start">
              <div className="space-y-1">
                <span className="text-xxs font-bold text-slate-400 uppercase tracking-wider block">{s.label}</span>
                <span className="text-2xl font-black text-slate-900 dark:text-white block font-mono">{s.value}</span>
              </div>
              <div className={`p-2.5 rounded-xl ${s.color}`}>
                <s.icon size={18} />
              </div>
            </div>
            <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-slate-50 dark:border-slate-800/50">
              <TrendingUp size={12} className="text-indigo-500" />
              <span className="text-xxs text-slate-400 font-semibold">{s.sub}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Main Sections */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Specialty and Distribution */}
        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl p-5 space-y-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              {isRtl ? "توزيع التخصصات الطبية" : "Specialty Breakdown"}
            </h3>
            <p className="text-xxs text-slate-400 mt-0.5">
              {isRtl ? "توزيع الأطباء حسب التخصص الرئيسي" : "Relative distribution of core physician categories"}
            </p>
          </div>

          <div className="space-y-3.5">
            {specialtyDistribution.map((spec, idx) => (
              <div key={idx} className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">{spec.specialty}</span>
                  <span className="font-mono text-slate-400 font-bold">{spec.count} ({spec.percentage})</span>
                </div>
                <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-indigo-600 rounded-full" 
                    style={{ width: spec.percentage }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Quick Directories & Navigation Map */}
        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl p-5 flex flex-col justify-between space-y-4">
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              {isRtl ? "الوصول السريع والخرائط" : "Quick Operations Directory"}
            </h3>
            <p className="text-xxs text-slate-400">
              {isRtl ? "الوصول المباشر إلى قاعدة البيانات والموقع الجغرافي" : "Direct access routes for location auditing"}
            </p>
          </div>

          <div className="space-y-2.5">
            <button 
              onClick={() => onNavigate && onNavigate("field-physician-list")}
              className="w-full flex items-center justify-between p-3 rounded-xl border border-slate-100 dark:border-slate-800/80 hover:bg-slate-50 dark:hover:bg-slate-800/50 hover:border-indigo-200 transition-all cursor-pointer text-left"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400">
                  <Stethoscope size={16} />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                    {isRtl ? "دليل الأطباء التفاعلي" : "Physicians Directory"}
                  </h4>
                  <p className="text-[10px] text-slate-400">
                    {isRtl ? "قائمة الأطباء، التصفية المتقدمة والتصدير" : "Interactive roster and segmentations"}
                  </p>
                </div>
              </div>
              {isRtl ? <ChevronLeft size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
            </button>

            <button 
              onClick={() => onNavigate && onNavigate("field-gps-verified")}
              className="w-full flex items-center justify-between p-3 rounded-xl border border-slate-100 dark:border-slate-800/80 hover:bg-slate-50 dark:hover:bg-slate-800/50 hover:border-indigo-200 transition-all cursor-pointer text-left"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400">
                  <MapPin size={16} />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                    {isRtl ? "التحقق الجغرافي GPS" : "GPS Location Verification"}
                  </h4>
                  <p className="text-[10px] text-slate-400">
                    {isRtl ? "زيارات العيادات المؤكدة جغرافياً من الميدان" : "Review physical coordinates audits"}
                  </p>
                </div>
              </div>
              {isRtl ? <ChevronLeft size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
            </button>

            <button 
              onClick={() => onNavigate && onNavigate("field-physician-visit-history")}
              className="w-full flex items-center justify-between p-3 rounded-xl border border-slate-100 dark:border-slate-800/80 hover:bg-slate-50 dark:hover:bg-slate-800/50 hover:border-indigo-200 transition-all cursor-pointer text-left"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400">
                  <Calendar size={16} />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                    {isRtl ? "أرشيف الزيارات الطبية" : "Visit Historic Ledger"}
                  </h4>
                  <p className="text-[10px] text-slate-400">
                    {isRtl ? "تاريخ زيارات الترويج وتفاصيل العينات" : "Detail archives & manager reviews"}
                  </p>
                </div>
              </div>
              {isRtl ? <ChevronLeft size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
            </button>
          </div>
        </div>

        {/* Recent Interaction Logs */}
        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                {isRtl ? "أحدث التفاعلات الميدانية" : "Recent Interactions"}
              </h3>
              <p className="text-xxs text-slate-400 mt-0.5">
                {isRtl ? "آخر التحديثات المستلمة من المندوبين" : "Live feedback from active representatives"}
              </p>
            </div>
            <ArrowUpRight size={16} className="text-slate-400" />
          </div>

          <div className="space-y-3">
            {recentInteractions.map((rec) => (
              <div key={rec.id} className="flex justify-between items-center p-2.5 rounded-xl bg-slate-50/50 dark:bg-slate-950/40 border border-slate-100/30">
                <div className="space-y-0.5">
                  <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">{rec.name}</h4>
                  <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                    <span>{rec.type}</span>
                    <span>•</span>
                    <span className="font-mono">{rec.date}</span>
                  </div>
                </div>
                <span className="inline-flex items-center rounded-md bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 text-[9px] font-bold px-1.5 py-0.5">
                  {rec.status}
                </span>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
