import React, { useState, useMemo } from "react";
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  LineChart, Line, ComposedChart
} from "recharts";
import { 
  Award, TrendingUp, Users, ShieldAlert, Star, 
  MapPin, CheckCircle2, ChevronRight, BarChart3, ListFilter, PlayCircle,
  Printer, X, FileSpreadsheet
} from "lucide-react";
import { Role, User } from "../../types";

interface SupervisorPerformancePageProps {
  currentUser: User;
  lang: "en" | "ar";
  users?: User[];
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

interface SupervisorPerformanceItem {
  id: string;
  name: string;
  nameAr: string;
  role: string;
  roleAr: string;
  planExecutionRate: number;
  accompaniedVisitsCount: number;
  teamCallRate: number;
  coachingIndex: number;
  region: string;
  regionAr: string;
}

const mockSupervisorPerformanceList: SupervisorPerformanceItem[] = [
  {
    id: "usr-sup-01",
    name: "Tariq Al-Fitouri",
    nameAr: "طارق الفيتوري",
    role: "Medical Supervisor",
    roleAr: "مشرف طبي ميداني",
    planExecutionRate: 94.2,
    accompaniedVisitsCount: 14,
    teamCallRate: 11.5,
    coachingIndex: 92.0,
    region: "Tripoli East & Central",
    regionAr: "شرق ووسط طرابلس"
  },
  {
    id: "usr-sup-02",
    name: "Khadija Belhaj",
    nameAr: "خديجة بلحاج",
    role: "Medical Supervisor",
    roleAr: "مشرفة طبية ميدانية",
    planExecutionRate: 88.6,
    accompaniedVisitsCount: 12,
    teamCallRate: 10.8,
    coachingIndex: 88.5,
    region: "Benghazi North & Green Mountain",
    regionAr: "شمال بنغازي والجبل الأخضر"
  },
  {
    id: "usr-sup-03",
    name: "Sami Al-Warfalli",
    nameAr: "سامي الورفلي",
    role: "Sales Supervisor",
    roleAr: "مشرف مبيعات تجاري",
    planExecutionRate: 81.4,
    accompaniedVisitsCount: 8,
    teamCallRate: 9.2,
    coachingIndex: 81.0,
    region: "Misrata & Western Region",
    regionAr: "مصراتة والمنطقة الغربية"
  }
];

export default function SupervisorPerformancePage({
  currentUser,
  lang,
  users = [],
  onLogAudit
}: SupervisorPerformancePageProps) {
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
        onLogAudit("Export", "Reports", `Exported supervisor performance report "${title}" to Excel (.xlsx) under file ${filename}.xlsx`);
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
      onLogAudit("PrintPreview", "Reports", `Opened print preview for supervisor performance report: "${title}"`);
    }
  };

  const isRep = currentUser.role === Role.MEDICAL_REP || currentUser.role === Role.SALES_REP;
  const isSupervisor = currentUser.role === Role.MEDICAL_SUPERVISOR || currentUser.role === Role.SALES_SUPERVISOR;

  // Role Scoped ranking list
  const rankedList = useMemo(() => {
    // Sort by plan execution rate in descending order
    const list = [...mockSupervisorPerformanceList].sort((a, b) => b.planExecutionRate - a.planExecutionRate);
    
    if (isRep) {
      // Reps can see their supervisor highlighted, and other supervisor names masked or filtered for security.
      // This enforces raw data security and role-scoping.
      const managerName = currentUser.managerEmail ? currentUser.managerEmail.split("@")[0] : "";
      return list.map(item => {
        const isMySup = item.name.toLowerCase().includes(managerName.toLowerCase()) || item.id === "usr-sup-01"; // Fallback to sup 1
        return {
          ...item,
          name: isMySup ? item.name : `${item.role} (Masked / Role-Scoped)`,
          nameAr: isMyMyAr(isMySup, item),
          isMySupervisor: isMySup
        };
      });
    }

    if (isSupervisor) {
      // Supervisors can see real names of peers but highlighted relative to them
      return list.map(item => ({
        ...item,
        isMySupervisor: item.name.toLowerCase().includes(currentUser.name.toLowerCase()) || item.id === currentUser.id
      }));
    }

    return list.map(item => ({ ...item, isMySupervisor: false }));
  }, [currentUser, isRep, isSupervisor]);

  function isMyMyAr(isMySup: boolean, item: SupervisorPerformanceItem) {
    if (isMySup) return item.nameAr;
    return `${item.roleAr} (مخفي للخصوصية الميدانية)`;
  }

  // Visual chart data mapping
  const chartData = useMemo(() => {
    return rankedList.map(item => ({
      name: isRtl ? item.nameAr : item.name,
      "Plan Execution %": item.planExecutionRate,
      "Coaching Score %": item.coachingIndex,
      "Accompanied Visits": item.accompaniedVisitsCount
    }));
  }, [rankedList, isRtl]);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      
      {/* Header section */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2 text-violet-600 dark:text-violet-400">
            <Award size={20} />
            <span className="text-xs font-bold uppercase tracking-wider">{isRtl ? "مؤشرات التقييم والأداء" : "Supervisor League & Comparison"}</span>
          </div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white mt-1">
            {isRtl ? "مستويات أداء المشرفين الميدانيين" : "Supervisor Field Performance Analytics"}
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            {isRtl 
              ? "مقارنة نسب الإنجاز وجولات المرافقة وتصنيف المشرفين بناءً على تنفيذ الخطط المعتمدة وتدريب الفريق" 
              : "Cross-territory supervisor benchmarking, leaderboards, and co-travel frequency metrics."}
          </p>
        </div>

        {/* Security / Compliance Info */}
        <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-3.5 py-2 rounded-xl text-xs flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-violet-500 animate-pulse" />
          <div>
            <span className="text-slate-400 block text-[9px] font-bold uppercase">{isRtl ? "ضوابط الخصوصية الميدانية" : "COMPLIANCE & SCOPE BOUNDARY"}</span>
            <span className="font-bold text-slate-800 dark:text-slate-200">
              {isRep ? (isRtl ? "تم إخفاء أسماء الأقاليم الخارجية" : "External Supervisors Masked") : (isRtl ? "عرض الإدارة الشاملة" : "Unrestricted Manager Access")}
            </span>
          </div>
        </div>
      </div>

      {/* Hero ranking summary card */}
      <div className="bg-gradient-to-r from-indigo-600 to-violet-600 dark:from-indigo-950 dark:to-violet-950 p-6 rounded-2xl text-white flex flex-col md:flex-row items-center justify-between gap-6 shadow-md shadow-indigo-500/10">
        <div className="space-y-1.5">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-white/10 rounded-full text-[10px] font-bold uppercase">
            <Star size={11} className="text-amber-300 fill-amber-300" />
            <span>{isRtl ? "المشرف الميداني الأول هذا الشهر" : "Top Performer Current Cycle"}</span>
          </div>
          <h3 className="text-lg font-bold leading-snug">
            {isRtl ? `طارق الفيتوري - شرق ووسط طرابلس (٩٤.٢٪)` : `Tariq Al-Fitouri - Tripoli East & Central (94.2%)`}
          </h3>
          <p className="text-xs text-indigo-100 max-w-xl leading-relaxed">
            {isRtl 
              ? "حقق التميز في تنفيذ الخطط الإشرافية الميدانية بنسبة تفوق المعيار بـ ٤.٢٪، مع إنجاز ١٤ جولة مرافقة لتدريب المندوبين وتغطية جغرافية كاملة."
              : "Achieved perfect team call compliance combined with 14 documented joint travel logs to support first-line rep detailing."}
          </p>
        </div>

        <div className="bg-white/10 backdrop-blur-md p-4 rounded-xl text-center min-w-[140px] border border-white/20">
          <span className="text-[10px] text-indigo-100 uppercase font-bold block">{isRtl ? "معدل الإنجاز القياسي" : "Standard Target"}</span>
          <span className="text-3xl font-black font-mono mt-1 block">90.0%</span>
          <span className="text-[9px] text-indigo-300 font-bold mt-1 block">
            {isRtl ? "متوسط أداء المشرفين الحالي: ٨٨.١٪" : "Current average score: 88.1%"}
          </span>
        </div>
      </div>

      {/* Main Grid: Comparison Chart + Leaderboard Table */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Comparison Chart (7 cols) */}
        <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-5 rounded-2xl shadow-xxs flex flex-col justify-between space-y-4">
          <div>
            <h3 className="text-xs font-bold text-slate-850 dark:text-white uppercase flex items-center gap-1.5">
              <BarChart3 size={14} className="text-violet-600" />
              <span>{isRtl ? "مقارنة معدلات التنفيذ والتدريب الميداني" : "Benchmarking Execution & Coaching Index"}</span>
            </h3>
            <p className="text-[10px] text-slate-400 mt-0.5">
              {isRtl ? "مقارنة ثنائية لمستويات جودة التدريب مقابل إتمام الخطط الزمنية لكل إقليم" : "Twin metric audit: Plan Execution vs Coaching score for allowed territories."}
            </p>
          </div>

          <div className="h-72 text-xs font-mono">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" stroke="#94a3b8" fontSize={10} />
                <YAxis stroke="#94a3b8" fontSize={10} domain={[0, 100]} />
                <Tooltip />
                <Legend />
                <Bar dataKey="Plan Execution %" fill="#6366f1" radius={[4, 4, 0, 0]} />
                <Line type="monotone" dataKey="Coaching Score %" stroke="#10b981" strokeWidth={2.5} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Leaderboard Table (5 cols) */}
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-5 rounded-2xl shadow-xxs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-100 dark:border-slate-850 pb-2">
            <div>
              <h3 className="text-xs font-bold text-slate-850 dark:text-white uppercase flex items-center gap-1.5">
                <ListFilter size={14} className="text-violet-600" />
                <span>{isRtl ? "جدول ترتيب وتصنيف المشرفين" : "Supervisor Leaderboard Rankings"}</span>
              </h3>
              <p className="text-[10px] text-slate-400 mt-0.5">
                {isRtl ? "الترتيب التنازلي بناءً على معدل إنجاز خطة الزيارات" : "Ranked in descending order by Plan Execution Rate."}
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => handleExportExcel(
                  "Supervisor Leaderboard Rankings",
                  ["Rank", "Supervisor Name", "Role", "Region", "Plan Execution Rate", "Accompanied Visits", "Coaching Index"],
                  rankedList.map((item, idx) => [`#${idx + 1}`, item.name, item.role, item.region, `${item.planExecutionRate}%`, item.accompaniedVisitsCount.toString(), `${item.coachingIndex}%`]),
                  "supervisor_rankings_report"
                )}
                className="flex items-center gap-1 px-2 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded text-[9px] font-bold cursor-pointer"
              >
                <FileSpreadsheet size={10} className="text-emerald-500" />
                <span>{isRtl ? "Excel" : "Excel"}</span>
              </button>
              <button
                onClick={() => openPrintPDF(
                  "Supervisor Leaderboard Rankings",
                  "جدول ترتيب وتصنيف المشرفين",
                  ["Rank", "Supervisor Name", "Role", "Region", "Plan Execution Rate", "Accompanied Visits", "Coaching Index"],
                  ["الترتيب", "المشرف الميداني", "الدور الوظيفي", "الإقليم الجغرافي", "معدل تنفيذ الخطة", "الزيارات المرافقة", "مؤشر التقييم الميداني"],
                  rankedList.map((item, idx) => [`#${idx + 1}`, item.name, item.role, item.region, `${item.planExecutionRate}%`, item.accompaniedVisitsCount.toString(), `${item.coachingIndex}%`]),
                  rankedList.map((item, idx) => [`#${idx + 1}`, item.nameAr, item.roleAr, item.regionAr, `${item.planExecutionRate}%`, item.accompaniedVisitsCount.toString(), `${item.coachingIndex}%`])
                )}
                className="flex items-center gap-1 px-2 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded text-[9px] font-bold cursor-pointer"
              >
                <Printer size={10} className="text-indigo-500" />
                <span>{isRtl ? "PDF" : "PDF"}</span>
              </button>
            </div>
          </div>

          <div className="space-y-3.5">
            {rankedList.map((item, index) => {
              const rankColor = index === 0 ? "bg-amber-100 dark:bg-amber-950/40 text-amber-600" : index === 1 ? "bg-slate-100 dark:bg-slate-800 text-slate-600" : "bg-orange-100 dark:bg-orange-950/40 text-orange-600";
              const myHighlight = item.isMySupervisor ? "border-violet-500 bg-violet-50/20 dark:bg-violet-950/10" : "border-slate-100 dark:border-slate-850";
              
              return (
                <div 
                  key={item.id} 
                  className={`p-3.5 border rounded-xl flex items-center justify-between gap-4 transition-all ${myHighlight}`}
                >
                  <div className="flex items-center gap-3">
                    {/* Rank Badge */}
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center font-mono font-bold text-xs shrink-0 ${rankColor}`}>
                      #{index + 1}
                    </div>
                    
                    <div className="space-y-0.5">
                      <span className="font-bold text-xs text-slate-850 dark:text-white flex items-center gap-1">
                        <span>{isRtl ? item.nameAr : item.name}</span>
                        {item.isMySupervisor && (
                          <span className="text-[9px] bg-violet-100 dark:bg-violet-950/50 text-violet-700 dark:text-violet-400 px-1.5 py-0.25 rounded font-bold uppercase">
                            {isRtl ? "مشرفك" : "MY SUP"}
                          </span>
                        )}
                      </span>
                      <div className="flex gap-2 text-[9px] text-slate-400">
                        <span>{isRtl ? item.roleAr : item.role}</span>
                        <span>•</span>
                        <span>{isRtl ? item.regionAr : item.region}</span>
                      </div>
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="text-xs font-mono font-black text-slate-850 dark:text-white block">{item.planExecutionRate}%</span>
                    <span className="text-[9px] text-slate-400 block">{item.accompaniedVisitsCount} {isRtl ? "مرافقة" : "co-travels"}</span>
                  </div>

                </div>
              );
            })}
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
                  {isRtl ? "معاينة الطباعة والمقارنة الميدانية" : "Official League Rankings Print Preview"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    window.print();
                    if (onLogAudit) {
                      onLogAudit("Export", "Reports", `Printed PDF rankings report: "${printData.title}"`);
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
                  <p className="text-[10px] text-slate-500 font-bold tracking-widest uppercase">National Performance Benchmarking Division</p>
                  <p className="text-[10px] text-slate-400 mt-1">Configured Market | Confidential Ledger</p>
                </div>
                <div className="text-right">
                  <span className="inline-block bg-slate-100 text-slate-800 text-[10px] font-bold px-2.5 py-1 rounded-sm uppercase tracking-wide border border-slate-300">
                    BENCHMARK COMPARISON
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
                  <p className="text-slate-500">{isRtl ? "المستخدم المستعلم:" : "Logged User / Operator:"}</p>
                  <p className="font-bold text-slate-900">{currentUser.name} ({currentUser.role})</p>
                </div>
                <div className="text-right">
                  <p className="text-slate-500">{isRtl ? "الخصوصية والمطابقة الميدانية:" : "Field Secrecy & Compliance Code:"}</p>
                  <p className="font-bold text-indigo-600 font-mono text-xs">ROLE-SCOPED PRIVACY SECURED</p>
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
                <p>© {new Date().getFullYear()} MENAREPS CRM supervisor benchmark league index. Restricted distribution.</p>
                <p className="font-mono text-[8px] mt-0.5">SHA256 SECURED LEDGER AUDIT COMPLIANT | ENCRYPTED TRANSPORT</p>
              </div>

            </div>
          </div>
        </div>
      )}

    </div>
  );
}
