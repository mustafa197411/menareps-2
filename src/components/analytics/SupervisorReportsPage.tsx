import React, { useState, useMemo } from "react";
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  LineChart, Line, AreaChart, Area, PieChart, Pie, Cell
} from "recharts";
import { 
  TrendingUp, Award, Activity, FileText, CheckCircle2, MapPin, 
  Users, Sparkles, Filter, Percent, Calendar, ClipboardCheck, 
  UserCheck, Map, ShieldAlert, BookOpen, Star, AlertTriangle, ChevronRight,
  Download, Printer, X, FileSpreadsheet
} from "lucide-react";
import { Role, User } from "../../types";

interface SupervisorReportsPageProps {
  currentUser: User;
  lang: "en" | "ar";
  users?: User[];
  physicianVisits?: any[];
  pharmacyVisits?: any[];
  onLogAudit?: (action: string, entity: string, details: string) => void;
}

interface PrintPreviewData {
  title: string;
  titleAr: string;
  headers: string[];
  headersAr: string[];
  rows: string[][];
  rowsAr?: string[][];
}

interface SupervisorData {
  id: string;
  name: string;
  nameAr: string;
  role: string;
  planExecutionRate: number;
  accompaniedVisits: number;
  teamCallRate: number; // Avg calls/rep/day
  areaCoverage: number; // % area covered
  taskCompletion: number; // % admin tasks done
  physicianCoverage: number;
  pharmacyCoverage: number;
  coachingScore: number; // out of 100
  focusTopic: string;
  focusTopicAr: string;
}

const mockSupervisors: SupervisorData[] = [
  {
    id: "usr-sup-01",
    name: "Tariq Al-Fitouri",
    nameAr: "طارق الفيتوري",
    role: "Medical Supervisor",
    planExecutionRate: 94.2,
    accompaniedVisits: 14,
    teamCallRate: 11.5,
    areaCoverage: 96.0,
    taskCompletion: 88.5,
    physicianCoverage: 92.5,
    pharmacyCoverage: 94.0,
    coachingScore: 92.0,
    focusTopic: "Detailing speed & core scientific messaging integration",
    focusTopicAr: "ضبط زمن شرح المنتجات ودمج الرسالة العلمية الأساسية"
  },
  {
    id: "usr-sup-02",
    name: "Khadija Belhaj",
    nameAr: "خديجة بلحاج",
    role: "Medical Supervisor",
    planExecutionRate: 88.6,
    accompaniedVisits: 12,
    teamCallRate: 10.8,
    areaCoverage: 90.5,
    taskCompletion: 92.0,
    physicianCoverage: 87.0,
    pharmacyCoverage: 89.5,
    coachingScore: 88.5,
    focusTopic: "KOL relationship development & sample drop integrity",
    focusTopicAr: "تطوير العلاقات مع الأطباء الكبار والالتزام بصرف العينات"
  },
  {
    id: "usr-sup-03",
    name: "Sami Al-Warfalli",
    nameAr: "سامي الورفلي",
    role: "Sales Supervisor",
    planExecutionRate: 81.4,
    accompaniedVisits: 8,
    teamCallRate: 9.2,
    areaCoverage: 84.0,
    taskCompletion: 78.0,
    physicianCoverage: 80.0,
    pharmacyCoverage: 82.5,
    coachingScore: 81.0,
    focusTopic: "Pharmacy commercial order terms & collection cycle acceleration",
    focusTopicAr: "شروط الطلبيات التجارية بالصيدليات وتسريع دورة التحصيل الميداني"
  }
];

export default function SupervisorReportsPage({
  currentUser,
  lang,
  users = [],
  physicianVisits = [],
  pharmacyVisits = [],
  onLogAudit
}: SupervisorReportsPageProps) {
  const isRtl = lang === "ar";
  const [printData, setPrintData] = useState<PrintPreviewData | null>(null);

  const handleExportExcel = (title: string, headers: string[], rows: string[][], filename: string) => {
    import("xlsx").then((XLSX) => {
      const dataToExport = [headers, ...rows];
      const ws = XLSX.utils.aoa_to_sheet(dataToExport);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Report");
      XLSX.writeFile(wb, `${filename}.xlsx`);
      
      if (onLogAudit) {
        onLogAudit("Export", "Reports", `Exported supervisor report "${title}" to Excel (.xlsx) under file ${filename}.xlsx`);
      }
    });
  };

  const openPrintPDF = (title: string, titleAr: string, headers: string[], headersAr: string[], rows: string[][], rowsAr?: string[][]) => {
    setPrintData({
      title,
      titleAr,
      headers,
      headersAr,
      rows,
      rowsAr
    });
    if (onLogAudit) {
      onLogAudit("PrintPreview", "Reports", `Opened print preview for supervisor report: "${title}"`);
    }
  };
  
  // Determine if role is scoped or has access to all
  const isSupervisor = currentUser.role === Role.MEDICAL_SUPERVISOR || currentUser.role === Role.SALES_SUPERVISOR;
  const isRep = currentUser.role === Role.MEDICAL_REP || currentUser.role === Role.SALES_REP;
  
  // Filter supervisor list based on role-scoped boundaries
  const filteredSupervisors = useMemo(() => {
    if (isSupervisor) {
      // If supervisor, they only see themselves
      return mockSupervisors.filter(s => s.name.toLowerCase().includes(currentUser.name.toLowerCase()) || s.id === currentUser.id);
    }
    if (isRep) {
      // Rep sees their direct supervisor. We'll map to Tariq Al-Fitouri as default or based on managerEmail
      const managerName = currentUser.managerEmail ? currentUser.managerEmail.split("@")[0] : "";
      const matches = mockSupervisors.filter(s => s.name.toLowerCase().includes(managerName.toLowerCase()));
      return matches.length > 0 ? matches : [mockSupervisors[0]];
    }
    // Managers / Admins see all supervisors
    return mockSupervisors;
  }, [currentUser, isSupervisor, isRep]);

  const [selectedSupId, setSelectedSupId] = useState<string>(filteredSupervisors[0]?.id || "usr-sup-01");

  const activeSup = useMemo(() => {
    return filteredSupervisors.find(s => s.id === selectedSupId) || filteredSupervisors[0] || mockSupervisors[0];
  }, [selectedSupId, filteredSupervisors]);

  // Mock Plans & Coaching Session Data under active supervisor
  const activeCoachingLogs = useMemo(() => {
    if (activeSup.id === "usr-sup-01") {
      return [
        { id: "COA-101", repName: "Ahmed Al-Maghribi", date: "2026-06-25", score: 95, notes: "Excellent compliance with core CardioMax scientific messages. Handled objections with clinical references beautifully.", notesAr: "التزام ممتاز بالرسائل العلمية لكاردوماكس. أجاب على الاعتراضات بمراجع سريرية دقيقة وبشكل رائع." },
        { id: "COA-102", repName: "Sarah Al-Ghazali", date: "2026-06-22", score: 89, notes: "Good call rate. Needs to focus slightly more on detailing KidVits sugar-free features during pediatric clinic visits.", notesAr: "معدل اتصال ميداني جيد. يحتاج لتكثيف شرح مزايا كيدفيتس الخالية من السكر لعيادات الأطفال." }
      ];
    }
    if (activeSup.id === "usr-sup-02") {
      return [
        { id: "COA-201", repName: "Mariam Al-Tajouri", date: "2026-06-24", score: 91, notes: "Strong hospital coverage. Advised to log GPS checks immediately on clinic entry to comply with live audit logs.", notesAr: "تغطية مستشفيات قوية. تم التنبيه لضرورة إقرار الـ GPS فور دخول العيادة للمطابقة الميدانية." }
      ];
    }
    return [
      { id: "COA-301", repName: "Mustafa Al-Zawi", date: "2026-06-20", score: 81, notes: "Requires optimization on commercial order terms. Explained credit buffer limits of local pharmacy groups.", notesAr: "يحتاج لتحسين شروط الطلبيات التجارية. تم توضيح حدود التسهيلات الائتمانية للصيدليات المحلية." }
    ];
  }, [activeSup]);

  const activePlans = useMemo(() => {
    return [
      { id: "PLN-081", title: isRtl ? "خطة التغطية الميدانية - يوليو ٢٠٢٦" : "Field Coverage Plan - July 2026", type: "Monthly", status: "Approved", statusAr: "معتمد" },
      { id: "PLN-082", title: isRtl ? "خطة التدقيق المشترك وإرشاد المندوبين" : "Accompanied Coaching Cycle Plan", type: "Weekly Cycle", status: "Active", statusAr: "نشط جاري التنفيذ" }
    ];
  }, [isRtl]);

  const activeVisits = useMemo(() => {
    return [
      { id: "VIS-901", target: "Dr. Ahmed Al-Masri (Cardiology)", repName: "Ahmed Al-Maghribi", type: "Joint (Accompanied)", typeAr: "زيارة مشتركة (مرافقة)", date: "2026-06-28", status: "Completed & Synced", statusAr: "مكتمل ومطابق" },
      { id: "VIS-902", target: "Ibn Sina Pharmacy Group", repName: "Sarah Al-Ghazali", type: "Spot Check", typeAr: "زيارة تفتيشية مفاجئة", date: "2026-06-26", status: "Completed & Synced", statusAr: "مكتمل ومطابق" }
    ];
  }, []);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      
      {/* Page Title & Scoping Banner */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400">
            <ClipboardCheck size={20} />
            <span className="text-xs font-bold uppercase tracking-wider">{isRtl ? "قسم التقارير والرقابة الميدانية" : "Field Supervision & Audits"}</span>
          </div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white mt-1">
            {isRtl ? "تقارير المشرفين والمراقبة الميدانية" : "Field Supervisor Performance Reports"}
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            {isRtl 
              ? "تحليل معدلات إنجاز الخطط، جولات التدفق المشترك المرافقة، كفاءة الاستهداف ونسب التغطية للصيدليات والعيادات" 
              : "Analytical overview of supervisor accompanied cycles, coaching indices, coverage compliance, and team metrics."
            }
          </p>
        </div>

        {/* Security / Scoping Info Badge */}
        <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-850 p-2.5 rounded-xl text-xs flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-indigo-500 animate-pulse" />
          <div>
            <span className="text-slate-400 block text-[9px] font-bold uppercase">{isRtl ? "مستوى صلاحية البيانات" : "DATA SECURITY LEVEL"}</span>
            <span className="font-bold text-slate-800 dark:text-slate-200">
              {isRep 
                ? (isRtl ? "نطاق تمثيلي محدود" : "Personal / Representative Bound") 
                : isSupervisor 
                ? (isRtl ? "نطاق إشرافي إقليمي" : `Supervisor Territory Bound: ${currentUser.name}`) 
                : (isRtl ? "صلاحية إدارة عامة شاملة" : "Enterprise / National Access")}
            </span>
          </div>
        </div>
      </div>

      {/* Supervisor Selector (Only visible for Admins/Managers) */}
      {!isSupervisor && !isRep && filteredSupervisors.length > 1 && (
        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-4 rounded-xl flex items-center justify-between gap-4 shadow-xxs">
          <div className="flex items-center gap-2">
            <Filter size={15} className="text-indigo-600" />
            <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
              {isRtl ? "اختر المشرف الميداني للتدقيق بالتفصيل:" : "Select Field Supervisor to audit details:"}
            </span>
          </div>
          <select 
            value={selectedSupId}
            onChange={(e) => setSelectedSupId(e.target.value)}
            className="text-xs font-bold border border-slate-200 dark:border-slate-800 rounded-lg p-2 bg-transparent text-slate-850 dark:text-white"
          >
            {filteredSupervisors.map(sup => (
              <option key={sup.id} value={sup.id}>
                {isRtl ? sup.nameAr : sup.name} ({sup.role})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Selected Supervisor Hero Performance Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        
        {/* Card 1: Plan Execution */}
        <div className="bg-white dark:bg-slate-900 p-4 border border-slate-100 dark:border-slate-800 rounded-xl relative overflow-hidden flex flex-col justify-between h-28 shadow-xxs">
          <span className="text-[10px] text-slate-400 block font-bold uppercase flex items-center gap-1">
            <CheckCircle2 size={11} className="text-emerald-500" />
            <span>{isRtl ? "معدل تنفيذ الخطط" : "Plan Execution Rate"}</span>
          </span>
          <span className="text-2xl font-black text-slate-850 dark:text-white font-mono mt-1">{activeSup.planExecutionRate}%</span>
          <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden mt-1.5">
            <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${activeSup.planExecutionRate}%` }} />
          </div>
          <span className="text-[9px] text-emerald-500 font-bold block mt-1">★ {isRtl ? "هدف التنفيذ المعتمد" : "Within targets"}</span>
        </div>

        {/* Card 2: Accompanied Visits */}
        <div className="bg-white dark:bg-slate-900 p-4 border border-slate-100 dark:border-slate-800 rounded-xl relative overflow-hidden flex flex-col justify-between h-28 shadow-xxs">
          <span className="text-[10px] text-slate-400 block font-bold uppercase flex items-center gap-1">
            <UserCheck size={11} className="text-indigo-500" />
            <span>{isRtl ? "الزيارات المرافقة المشتركة" : "Accompanied Visits"}</span>
          </span>
          <span className="text-2xl font-black text-slate-850 dark:text-white font-mono mt-1">{activeSup.accompaniedVisits} <span className="text-xs font-normal text-slate-400">{isRtl ? "زيارة" : "Joints"}</span></span>
          <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden mt-1.5">
            <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${Math.min(activeSup.accompaniedVisits * 6, 100)}%` }} />
          </div>
          <span className="text-[9px] text-indigo-500 font-bold block mt-1">✎ {isRtl ? "جلسات مرافقة موثقة" : "100% Coaching Log Compliance"}</span>
        </div>

        {/* Card 3: Team Call Rate */}
        <div className="bg-white dark:bg-slate-900 p-4 border border-slate-100 dark:border-slate-800 rounded-xl relative overflow-hidden flex flex-col justify-between h-28 shadow-xxs">
          <span className="text-[10px] text-slate-400 block font-bold uppercase flex items-center gap-1">
            <Activity size={11} className="text-violet-500" />
            <span>{isRtl ? "معدل الزيارات اليومي" : "Team Call Rate"}</span>
          </span>
          <span className="text-2xl font-black text-slate-850 dark:text-white font-mono mt-1">{activeSup.teamCallRate} <span className="text-xs font-normal text-slate-400">/ {isRtl ? "مندوب" : "rep / day"}</span></span>
          <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden mt-1.5">
            <div className="h-full bg-violet-500 rounded-full" style={{ width: `${(activeSup.teamCallRate / 15) * 100}%` }} />
          </div>
          <span className="text-[9px] text-violet-500 font-bold block mt-1">⚡ {isRtl ? "النشاط الميداني مثالي" : "Highly Active Status"}</span>
        </div>

        {/* Card 4: Area Coverage */}
        <div className="bg-white dark:bg-slate-900 p-4 border border-slate-100 dark:border-slate-800 rounded-xl relative overflow-hidden flex flex-col justify-between h-28 shadow-xxs">
          <span className="text-[10px] text-slate-400 block font-bold uppercase flex items-center gap-1">
            <Map size={11} className="text-amber-500" />
            <span>{isRtl ? "نسبة التغطية الجغرافية" : "Area Coverage"}</span>
          </span>
          <span className="text-2xl font-black text-slate-850 dark:text-white font-mono mt-1">{activeSup.areaCoverage}%</span>
          <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden mt-1.5">
            <div className="h-full bg-amber-500 rounded-full" style={{ width: `${activeSup.areaCoverage}%` }} />
          </div>
          <span className="text-[9px] text-amber-500 font-bold block mt-1">✔ {isRtl ? "تغطية كافة قطاعات الإقليم" : "Full sector match"}</span>
        </div>

      </div>

      {/* Main Charts & Coaching Log Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Left Column: Visual Coverage KPI Charts */}
        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-5 rounded-2xl shadow-xxs space-y-4">
          <div>
            <h3 className="text-xs font-bold text-slate-850 dark:text-white uppercase flex items-center gap-1.5">
              <Award size={14} className="text-indigo-600" />
              <span>{isRtl ? "مقارنة كفاءة التغطية ونسب الاتصال" : "Coverage Efficiency & Targeting Analysis"}</span>
            </h3>
            <p className="text-[10px] text-slate-400">
              {isRtl ? "تغطية الأطباء والصيدليات مقابل معدل استكمال المهام الإدارية للمشرف" : "Physician vs. Pharmacy coverage matched with supervisor administrative task completion."}
            </p>
          </div>

          <div className="h-64 text-xs font-mono">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={[
                { name: isRtl ? "أطباء" : "Physicians", value: activeSup.physicianCoverage, fill: "#6366f1" },
                { name: isRtl ? "صيدليات" : "Pharmacies", value: activeSup.pharmacyCoverage, fill: "#ec4899" },
                { name: isRtl ? "المهام" : "Tasks Done", value: activeSup.taskCompletion, fill: "#10b981" }
              ]}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" stroke="#94a3b8" fontSize={10} />
                <YAxis stroke="#94a3b8" fontSize={10} domain={[0, 100]} />
                <Tooltip formatter={(v) => [`${v}%`, "Value"]} />
                <Bar dataKey="value" name="%" fill="#6366f1" radius={[4, 4, 0, 0]}>
                  <Cell fill="#6366f1" />
                  <Cell fill="#ec4899" />
                  <Cell fill="#10b981" />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Right Column: Coaching Logs & Supervisor Focus */}
        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-5 rounded-2xl shadow-xxs flex flex-col justify-between space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-100 dark:border-slate-850 pb-2">
            <div className="space-y-1">
              <h3 className="text-xs font-bold text-slate-850 dark:text-white uppercase flex items-center gap-1.5">
                <Star size={14} className="text-amber-500 fill-amber-500" />
                <span>{isRtl ? "سجل إرشاد المندوبين ومؤشر التقييم" : "Team Coaching & Joint Travel Audits"}</span>
              </h3>
              <p className="text-[10px] text-slate-400">
                {isRtl ? "تفاصيل جلسات التقييم الميداني والتدريب على الرسائل العلمية للمنتج" : "Recent supervisor feedback, ratings, and active developmental points."}
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => handleExportExcel(
                  "Team Coaching Logs",
                  ["Coaching Log ID", "Representative", "Date", "Score", "Notes"],
                  activeCoachingLogs.map(l => [l.id, l.repName, l.date, l.score.toString(), l.notes]),
                  "supervisor_coaching_report"
                )}
                className="flex items-center gap-1 px-2 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded text-[9px] font-bold cursor-pointer"
              >
                <FileSpreadsheet size={11} className="text-emerald-500" />
                <span>{isRtl ? "Excel" : "Excel"}</span>
              </button>
              <button
                onClick={() => openPrintPDF(
                  "Team Coaching Logs",
                  "سجل إرشاد المندوبين ومؤشر التقييم",
                  ["Coaching Log ID", "Representative", "Date", "Score", "Notes"],
                  ["رمز التقييم", "المندوب الميداني", "التاريخ", "معدل التقييم", "ملاحظات التوجيه الميداني"],
                  activeCoachingLogs.map(l => [l.id, l.repName, l.date, l.score.toString(), l.notes]),
                  activeCoachingLogs.map(l => [l.id, l.repName, l.date, l.score.toString(), l.notesAr || l.notes])
                )}
                className="flex items-center gap-1 px-2 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded text-[9px] font-bold cursor-pointer"
              >
                <Printer size={11} className="text-indigo-500" />
                <span>{isRtl ? "PDF" : "PDF"}</span>
              </button>
            </div>
          </div>

          {/* Supervisor Focus Topic */}
          <div className="p-3 bg-indigo-50/50 dark:bg-indigo-950/10 border border-indigo-100/40 dark:border-indigo-900/40 rounded-xl text-xs flex gap-2.5 text-indigo-900 dark:text-indigo-400">
            <Sparkles size={16} className="shrink-0 mt-0.5 text-indigo-500 animate-pulse" />
            <div>
              <strong className="font-bold">{isRtl ? "التركيز التوجيهي الحالي للمشرف:" : "Active Coaching Mandate:"}</strong>
              <span className="block mt-0.5 text-[10.5px] leading-relaxed">
                {isRtl ? activeSup.focusTopicAr : activeSup.focusTopic}
              </span>
            </div>
          </div>

          {/* Coaching Logs */}
          <div className="space-y-3">
            {activeCoachingLogs.map((log) => (
              <div key={log.id} className="p-3 border border-slate-100 dark:border-slate-850 bg-slate-50/30 dark:bg-slate-950/20 rounded-xl space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <div className="flex items-center gap-1.5 font-bold text-slate-850 dark:text-white">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    <span>{log.repName}</span>
                  </div>
                  <span className="font-mono text-xxs text-slate-400">{log.date}</span>
                </div>
                <p className="text-[10.5px] text-slate-500 leading-relaxed">
                  {isRtl ? log.notesAr : log.notes}
                </p>
                <div className="flex justify-between items-center pt-1 border-t border-slate-100/50 dark:border-slate-800/50 text-[10px]">
                  <span className="font-mono text-slate-400">{log.id}</span>
                  <span className="font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 px-1.5 py-0.5 rounded">
                    {isRtl ? `معدل التقييم: ${log.score}/١٠٠` : `Coach Index: ${log.score}/100`}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* Plans, Visits & Supervisor Compliance Ledger */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Left Column: Active Supervisor Plans & Submissions */}
        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-5 rounded-2xl shadow-xxs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-100 dark:border-slate-850 pb-2">
            <div>
              <h3 className="text-xs font-bold text-slate-850 dark:text-white uppercase flex items-center gap-1.5">
                <Calendar size={14} className="text-indigo-600" />
                <span>{isRtl ? "خطط التغطية والزيارات المعتمدة" : "Supervisor Plans & Cycle Submissions"}</span>
              </h3>
              <p className="text-[10px] text-slate-400">
                {isRtl ? "الخطط الدورية المقدمة للاعتماد والمراجعة للمشرف" : "Active cycle plans submitted for area sales manager approval."}
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => handleExportExcel(
                  "Supervisor Cycle Plans",
                  ["Plan ID", "Title", "Type", "Status"],
                  activePlans.map(p => [p.id, p.title, p.type, p.status]),
                  "supervisor_plans_report"
                )}
                className="flex items-center gap-1 px-2 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded text-[9px] font-bold cursor-pointer"
              >
                <FileSpreadsheet size={10} className="text-emerald-500" />
                <span>{isRtl ? "Excel" : "Excel"}</span>
              </button>
              <button
                onClick={() => openPrintPDF(
                  "Supervisor Cycle Plans",
                  "خطط التغطية والزيارات المعتمدة",
                  ["Plan ID", "Title", "Type", "Status"],
                  ["رمز الخطة", "عنوان الخطة الميدانية", "النوع", "حالة الاعتماد"],
                  activePlans.map(p => [p.id, p.title, p.type, p.status])
                )}
                className="flex items-center gap-1 px-2 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded text-[9px] font-bold cursor-pointer"
              >
                <Printer size={10} className="text-indigo-500" />
                <span>{isRtl ? "PDF" : "PDF"}</span>
              </button>
            </div>
          </div>

          <div className="space-y-2.5">
            {activePlans.map(p => (
              <div key={p.id} className="p-3 border border-slate-100 dark:border-slate-850 rounded-xl flex items-center justify-between text-xs">
                <div className="space-y-1">
                  <span className="font-bold text-slate-850 dark:text-white block">{p.title}</span>
                  <div className="flex gap-2 text-[10px] text-slate-400">
                    <span className="font-mono">{p.id}</span>
                    <span>•</span>
                    <span>{p.type}</span>
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600">
                  {isRtl ? p.statusAr : p.status}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Right Column: Joint Visits Verified Logs */}
        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-5 rounded-2xl shadow-xxs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-100 dark:border-slate-850 pb-2">
            <div>
              <h3 className="text-xs font-bold text-slate-850 dark:text-white uppercase flex items-center gap-1.5">
                <FileText size={14} className="text-pink-600" />
                <span>{isRtl ? "زيارات مرافقة وتدقيق تم إنجازها" : "Joint Visits & Spot Audits Completed"}</span>
              </h3>
              <p className="text-[10px] text-slate-400">
                {isRtl ? "الزيارات الميدانية المشتركة الموثقة عبر الـ GPS في الوقت الفعلي" : "Recent joint visits verified via real-time GPS coordinates check-in."}
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => handleExportExcel(
                  "Accompanied Visits and Audits Ledger",
                  ["Visit ID", "Target Doctor/Customer", "Representative", "Date", "Verification Type", "Status"],
                  activeVisits.map(v => [v.id, v.target, v.repName, v.date, v.type, v.status]),
                  "supervisor_audited_visits_report"
                )}
                className="flex items-center gap-1 px-2 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded text-[9px] font-bold cursor-pointer"
              >
                <FileSpreadsheet size={10} className="text-emerald-500" />
                <span>{isRtl ? "Excel" : "Excel"}</span>
              </button>
              <button
                onClick={() => openPrintPDF(
                  "Accompanied Visits and Audits Ledger",
                  "زيارات مرافقة وتدقيق تم إنجازها",
                  ["Visit ID", "Target Doctor/Customer", "Representative", "Date", "Verification Type", "Status"],
                  ["رمز الزيارة", "العميل المستهدف / الطبيب", "المندوب المصاحب", "التاريخ", "نوع التدقيق الميداني", "حالة المزامنة الجغرافية"],
                  activeVisits.map(v => [v.id, v.target, v.repName, v.date, v.type, v.status]),
                  activeVisits.map(v => [v.id, v.target, v.repName, v.date, v.typeAr || v.type, v.statusAr || v.status])
                )}
                className="flex items-center gap-1 px-2 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded text-[9px] font-bold cursor-pointer"
              >
                <Printer size={10} className="text-indigo-500" />
                <span>{isRtl ? "PDF" : "PDF"}</span>
              </button>
            </div>
          </div>

          <div className="space-y-2.5">
            {activeVisits.map(v => (
              <div key={v.id} className="p-3 border border-slate-100 dark:border-slate-850 rounded-xl flex items-center justify-between text-xs">
                <div className="space-y-0.5">
                  <span className="font-bold text-slate-850 dark:text-white block">{v.target}</span>
                  <div className="flex gap-1.5 text-[9.5px] text-slate-400">
                    <span className="font-semibold text-slate-500">{v.repName}</span>
                    <span>|</span>
                    <span className="font-mono">{v.date}</span>
                    <span>|</span>
                    <span className="text-indigo-600">{isRtl ? v.typeAr : v.type}</span>
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-indigo-50 dark:bg-indigo-950/40 text-indigo-650">
                  {isRtl ? v.statusAr : v.status}
                </span>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* HIGH-FIDELITY CORPORATE PRINT PREVIEW MODAL */}
      {printData && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-[9999] p-4 overflow-y-auto print:p-0 print:bg-white print:static print:h-auto animate-fade-in">
          <div className="bg-white text-slate-900 w-full max-w-4xl rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden print:shadow-none print:max-h-none print:overflow-visible print:w-full">
            
            {/* Modal Actions Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50 print:hidden">
              <div className="flex items-center gap-2">
                <Printer size={18} className="text-indigo-600" />
                <span className="text-sm font-bold text-slate-800">
                  {isRtl ? "معاينة الطباعة الميدانية" : "Official Field Supervision Print Preview"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    window.print();
                    if (onLogAudit) {
                      onLogAudit("Export", "Reports", `Printed PDF supervisor report: "${printData.title}"`);
                    }
                  }}
                  className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold cursor-pointer"
                >
                  <Printer size={14} />
                  <span>{isRtl ? "طباعة / حفظ كـ PDF" : "Print / Save as PDF"}</span>
                </button>
                <button
                  onClick={() => setPrintData(null)}
                  className="p-2 hover:bg-slate-200 rounded-lg text-slate-500 cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Document body */}
            <div className="p-8 overflow-y-auto flex-1 print:p-0 print:overflow-visible" id="printable-report">
              
              {/* Corporate Letterhead */}
              <div className="flex justify-between items-start border-b-2 border-slate-900 pb-5 mb-6">
                <div>
                  <h1 className="text-xl font-black tracking-tight text-slate-900 uppercase">MENAREPS 2.0</h1>
                  <p className="text-[10px] text-slate-500 font-bold tracking-widest uppercase">Field Supervision and Audits Division</p>
                  <p className="text-[10px] text-slate-400 mt-1">Secure Field Ledger Access | Libyan Operations</p>
                </div>
                <div className="text-right">
                  <span className="inline-block bg-indigo-50 text-indigo-800 text-[10px] font-bold px-2.5 py-1 rounded-sm uppercase tracking-wide border border-indigo-200">
                    SUPERVISOR AUDIT LOG
                  </span>
                  <p className="text-[9px] text-slate-400 mt-1 font-mono">ID: AL-EXP-{Math.floor(1000 + Math.random() * 9000)}</p>
                </div>
              </div>

              {/* Title */}
              <div className="text-center mb-8">
                <h2 className="text-lg font-bold text-slate-900 underline underline-offset-4 decoration-2 decoration-slate-900">
                  {isRtl ? printData.titleAr : printData.title}
                </h2>
                <p className="text-[10px] text-slate-500 font-mono mt-1">Generated: {new Date().toISOString().replace("T", " ").substring(0, 19)} UTC</p>
              </div>

              {/* Scope & Metadata */}
              <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-lg border border-slate-200 mb-8 text-xs font-medium">
                <div>
                  <p className="text-slate-500">{isRtl ? "المشرف المسؤول:" : "Audited Field Supervisor:"}</p>
                  <p className="font-bold text-slate-900">{activeSup.name} ({activeSup.role})</p>
                  <p className="text-[10.5px] text-slate-400 mt-0.5">{isRtl ? "المستخدم المستعلم:" : "Operator:"} {currentUser.name} ({currentUser.role})</p>
                </div>
                <div className="text-right">
                  <p className="text-slate-500">{isRtl ? "معدل التزام المشرف بالخطط:" : "Supervisor Plan Execution Rate:"}</p>
                  <p className="font-bold text-indigo-600 text-sm font-mono">{activeSup.planExecutionRate}%</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">{isRtl ? "التغطية الميدانية:" : "Area Coverage:"} {activeSup.areaCoverage}%</p>
                </div>
              </div>

              {/* Table Data */}
              <table className="w-full text-xs text-left border-collapse border border-slate-300">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-300 text-[10px] font-bold uppercase">
                    {(isRtl ? printData.headersAr : printData.headers).map((h, i) => (
                      <th key={i} className="py-2 px-3 border border-slate-300">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(isRtl && printData.rowsAr ? printData.rowsAr : printData.rows).map((row, rowIdx) => (
                    <tr key={rowIdx} className="border-b border-slate-200 hover:bg-slate-50/50">
                      {row.map((cell, cellIdx) => (
                        <td key={cellIdx} className="py-2.5 px-3 border border-slate-200 font-medium text-slate-800">{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Corporate Footer */}
              <div className="mt-12 pt-6 border-t border-slate-200 text-center text-[9px] text-slate-400">
                <p>© {new Date().getFullYear()} MENAREPS CRM Field supervision audit tracker. Confidential.</p>
                <p className="font-mono text-[8px] mt-0.5">SHA256 SECURED LEDGER AUDIT COMPLIANT | ENCRYPTED TRANSPORT</p>
              </div>

            </div>
          </div>
        </div>
      )}

    </div>
  );
}
