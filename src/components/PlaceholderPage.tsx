import React from "react";
import { Info, Sparkles, Layers, ArrowRight, ExternalLink } from "lucide-react";

interface Connection {
  label: string;
  target: string;
}

interface PlaceholderPageProps {
  title: string;
  description: string;
  category?: string;
  connections?: Connection[];
  dummyStats?: { label: string; value: string; color?: string }[];
  dummyTableHeaders?: string[];
  dummyTableRows?: string[][];
  lang?: "en" | "ar";
}

export default function PlaceholderPage({
  title,
  description,
  category = "MENAREPS CRM Module",
  connections = [],
  dummyStats = [],
  dummyTableHeaders = ["ID", "Name/Attribute", "Region", "Assigned Owner", "Status"],
  dummyTableRows = [
    ["REC-001", "Amman Regional Hospital Block A", "Jordan", "MedRep Omar", "Active / Compliance Approved"],
    ["REC-002", "Saudi Central Pediatric Clinic", "KSA - Riyadh", "MedRep Sarah", "Pending Sync"],
    ["REC-003", "Gulf Specialized Pharmacy Hub", "UAE - Dubai", "SalesRep Tarek", "On-Track"],
  ],
  lang = "en"
}: PlaceholderPageProps) {
  const isRtl = lang === "ar";

  return (
    <div className="space-y-6 animate-fade-in" dir={isRtl ? "rtl" : "ltr"}>
      {/* Header Info */}
      <div className="border-b border-slate-200 dark:border-slate-800 pb-5">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300">
            {category}
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border border-amber-200/50 dark:border-amber-900/30">
            <Sparkles size={10} />
            {isRtl ? "قريباً" : "Coming Soon"}
          </span>
        </div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
          {title}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-3xl">
          {description}
        </p>
      </div>

      {/* Connectivity & Future Integration Hub */}
      {connections.length > 0 && (
        <div className="bg-gradient-to-r from-blue-50/50 to-indigo-50/50 dark:from-slate-900 dark:to-slate-850 border border-blue-100/60 dark:border-slate-800 p-4 rounded-xl">
          <h3 className="text-xs font-bold text-blue-900 dark:text-blue-300 uppercase tracking-wider font-mono flex items-center gap-1.5 mb-2">
            <Layers size={14} />
            {isRtl ? "ارتباطات البيانات المخطط لها" : "Cross-Module Synced Integrations"}
          </h3>
          <p className="text-xs text-slate-600 dark:text-slate-400 mb-3 leading-relaxed">
            {isRtl
              ? "يتصل هذا الملف وظيفيًا بكيانات النظام الأخرى لتسهيل تدفق التقارير والمعلومات التلقائية:"
              : "This page will establish real-time relational bindings and trigger transactions across the following modules once fully configured:"}
          </p>
          <div className="flex flex-wrap gap-2.5">
            {connections.map((conn, idx) => (
              <div
                key={idx}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xs text-xs text-slate-700 dark:text-slate-300"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                <span className="font-semibold">{conn.label}</span>
                <ArrowRight size={12} className="text-slate-400 shrink-0" />
                <span className="text-xxs text-slate-400 font-mono italic">{conn.target}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Dummy Stats Section */}
      {dummyStats.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {dummyStats.map((stat, idx) => (
            <div
              key={idx}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-xl shadow-xs"
            >
              <p className="text-[10px] font-mono text-slate-400 dark:text-slate-500 uppercase tracking-wider font-semibold">
                {stat.label}
              </p>
              <h4 className={`text-xl font-bold mt-1 text-slate-900 dark:text-white ${stat.color || ""}`}>
                {stat.value}
              </h4>
            </div>
          ))}
        </div>
      )}

      {/* Sandbox Grid or Table View */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-xs">
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-900">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
            <span className="text-xs font-bold text-slate-700 dark:text-slate-300 font-mono uppercase">
              {isRtl ? "محاكي لوحة العمل الأمنية" : "Developer Sandbox Preview Grid"}
            </span>
          </div>
          <div className="text-[10px] text-slate-400 font-mono">
            STATUS: INTEGRATION_PENDING
          </div>
        </div>

        {/* Dummy Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/50 text-[10px] uppercase font-mono text-slate-400 tracking-wider">
              <tr>
                {dummyTableHeaders.map((hdr, idx) => (
                  <th key={idx} className="p-4">{hdr}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-600 dark:text-slate-300">
              {dummyTableRows.map((row, idx) => (
                <tr key={idx} className="hover:bg-slate-50/40 dark:hover:bg-slate-800/20">
                  {row.map((cell, cellIdx) => (
                    <td key={cellIdx} className="p-4 font-mono text-xxs">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="p-4 bg-slate-50/50 dark:bg-slate-900/40 border-t border-slate-100 dark:border-slate-800 text-xxs text-slate-400 flex items-center gap-2 font-mono">
          <Info size={14} className="text-blue-500 shrink-0" />
          <span>
            {isRtl
              ? "سيتم استبدال هذا الملف ببيانات التدفق والعمليات الحية بمجرد تشغيل قنوات الاتصال بالخادم وقاعدة البيانات."
              : "This spreadsheet template is a simulated container. Relational hooks will overlay dynamically on production rollout."}
          </span>
        </div>
      </div>
    </div>
  );
}
