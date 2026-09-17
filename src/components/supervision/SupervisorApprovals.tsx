import React, { useState } from "react";
import { 
  FileCheck, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  Search, 
  User, 
  SlidersHorizontal,
  Calendar,
  ShieldCheck,
  Check,
  X
} from "lucide-react";

interface SupervisorApprovalsProps {
  lang: "en" | "ar";
}

export default function SupervisorApprovals({ lang }: SupervisorApprovalsProps) {
  const isRtl = lang === "ar";
  
  const [requests, setRequests] = useState([
    { id: "APP-REQ-902", rep: "Omar Al-Mokhtar", type: "Special Joint Visit", typeAr: "زيارة مرافق مشرك خاصة", detail: "Joint medical detailing with Dr. Salem Al-Hadi outside typical zone boundaries.", date: "2026-06-26", urgency: "HIGH", status: "Pending" },
    { id: "APP-REQ-903", rep: "Sarah Al-Sharif", type: "Sample Buffer Adjustment", typeAr: "تعديل رصيد عينات الأدوية", detail: "Increase CardioMax 10mg rep allocation by 50 units for scientific symposia.", date: "2026-06-26", urgency: "MEDIUM", status: "Pending" },
    { id: "APP-REQ-904", rep: "Tarek Abu-Zeid", type: "Out-Of-Territory Call", typeAr: "زيارة خارج المنطقة المحددة", detail: "Request permission to log visit with Ibn Sina Pharmacy in West sector.", date: "2026-06-27", urgency: "LOW", status: "Pending" }
  ]);

  const [searchTerm, setSearchTerm] = useState("");
  const [toastMsg, setToastMsg] = useState("");

  const handleAction = (id: string, action: "Approved" | "Rejected") => {
    setRequests(prev => prev.map(req => {
      if (req.id === id) {
        return { ...req, status: action };
      }
      return req;
    }));

    const found = requests.find(r => r.id === id);
    const msg = isRtl 
      ? `تمت ${action === "Approved" ? "الموافقة على" : "رفض"} الطلب ${id} بنجاح!`
      : `Request ${id} has been successfully ${action}!`;
    
    setToastMsg(msg);
    setTimeout(() => setToastMsg(""), 3000);
  };

  const filteredRequests = requests.filter(req => {
    const term = searchTerm.toLowerCase();
    return (
      req.rep.toLowerCase().includes(term) ||
      req.type.toLowerCase().includes(term) ||
      req.typeAr.includes(searchTerm) ||
      req.id.toLowerCase().includes(term)
    );
  });

  const pendingCount = requests.filter(r => r.status === "Pending").length;
  const approvedCount = requests.filter(r => r.status === "Approved").length;
  const rejectedCount = requests.filter(r => r.status === "Rejected").length;

  return (
    <div className="p-4 md:p-6 max-w-full overflow-x-hidden space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      
      {/* Header */}
      <div className="border-b border-slate-100 dark:border-slate-800 pb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-950 flex items-center justify-center text-indigo-600 dark:text-indigo-400 shrink-0">
            <FileCheck size={22} />
          </div>
          <div>
            <h2 className="text-lg md:text-xl font-bold text-slate-900 dark:text-white">
              {isRtl ? "مركز اعتمادات وموافقات المشرفين" : "Manager & Supervisor Approvals Desk"}
            </h2>
            <p className="text-[11px] md:text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {isRtl ? "مراجعة واعتماد طلبات المندوبين المعلقة كزيارات الأطباء الاستثنائية وتعديلات عينات الأدوية" : "Review and manage pending representative requests, out-of-territory visits, or sample adjustments."}
            </p>
          </div>
        </div>
      </div>

      {toastMsg && (
        <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900 rounded-xl text-xs font-semibold flex items-center gap-2">
          <CheckCircle2 size={16} />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* KPI Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-4 rounded-xl">
          <span className="text-[9px] text-slate-400 font-bold block uppercase">{isRtl ? "الطلبات المعلقة للتدقيق" : "Pending Approval Requests"}</span>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-lg font-bold text-amber-600 dark:text-amber-400 font-mono">{pendingCount} requests</span>
            <span className="text-[10px] text-amber-500 font-bold">⚠️ {isRtl ? "قيد التدقيق" : "Review"}</span>
          </div>
          <p className="text-[10px] text-slate-400 mt-1">{isRtl ? "طلبات الزيارة وصرف عينات بانتظام بانتظار البت فيها" : "Representative out-of-bounds logs awaiting action."}</p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-4 rounded-xl">
          <span className="text-[9px] text-slate-400 font-bold block uppercase">{isRtl ? "الطلبات المعتمدة" : "Approved Requests"}</span>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400 font-mono">{approvedCount} requests</span>
            <span className="text-[10px] text-emerald-500 font-bold">✓ {isRtl ? "معتمد" : "Cleared"}</span>
          </div>
          <p className="text-[10px] text-slate-400 mt-1">{isRtl ? "الطلبيات والتعديلات التي تمت الموافقة عليها بالكامل" : "Total requests approved in the active session."}</p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-4 rounded-xl">
          <span className="text-[9px] text-slate-400 font-bold block uppercase">{isRtl ? "متوسط سرعة اتخاذ القرار" : "Mean Settlement Speed"}</span>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-lg font-bold text-slate-900 dark:text-white font-mono">2.4 hours</span>
            <span className="text-[10px] text-indigo-500 font-bold">↑ {isRtl ? "سريع" : "Optimal"}</span>
          </div>
          <p className="text-[10px] text-slate-400 mt-1">{isRtl ? "مؤشر سرعة استجابة الإدارة لطلبات الفريق الميدانية" : "Average response duration for pending field allocations."}</p>
        </div>
      </div>

      {/* Main Request Board */}
      <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-4 rounded-xl space-y-4">
        
        {/* Search */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800/80 pb-3">
          <h3 className="text-xs font-bold text-slate-850 dark:text-white">
            {isRtl ? "قائمة طلبات الموافقات المعلقة" : "Pending Operational Approvals Queue"}
          </h3>

          <div className="relative w-full sm:w-64">
            <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
            <input 
              type="text" 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={isRtl ? "بحث بواسطة اسم المندوب أو الرمز..." : "Search by rep name, type, ID..."}
              className="w-full pl-8 pr-3 py-1.5 border border-slate-200 dark:border-slate-800 rounded-lg text-xxs bg-transparent text-slate-800 dark:text-white"
            />
          </div>
        </div>

        {/* Requests Cards/Table */}
        <div className="space-y-3">
          {filteredRequests.map((req) => (
            <div 
              key={req.id}
              className="p-4 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50 space-y-3 text-xs"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <span className="font-mono text-[9px] font-bold text-slate-400 block">{req.id} • {req.date}</span>
                  <h4 className="font-bold text-slate-900 dark:text-white text-xs">
                    {isRtl ? req.typeAr : req.type}
                  </h4>
                </div>

                <div className="flex items-center gap-2 self-start sm:self-auto">
                  <span className={`px-2 py-0.5 rounded text-[8px] font-bold ${
                    req.urgency === "HIGH" 
                      ? "bg-rose-50 dark:bg-rose-950/30 text-rose-600"
                      : req.urgency === "MEDIUM"
                      ? "bg-amber-50 dark:bg-amber-950/30 text-amber-600"
                      : "bg-blue-50 dark:bg-blue-950/30 text-blue-600"
                  }`}>
                    {req.urgency}
                  </span>

                  <span className={`px-2 py-0.5 rounded text-[8px] font-bold ${
                    req.status === "Approved"
                      ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600"
                      : req.status === "Rejected"
                      ? "bg-rose-50 dark:bg-rose-950/30 text-rose-600"
                      : "bg-amber-50 dark:bg-amber-950/30 text-amber-600"
                  }`}>
                    {isRtl && req.status === "Pending" ? "معلق" : isRtl && req.status === "Approved" ? "تم قبولها" : isRtl && req.status === "Rejected" ? "تم رفضها" : req.status}
                  </span>
                </div>
              </div>

              <div className="space-y-1">
                <p className="text-[10px] text-slate-400">{isRtl ? "المندوب مقدم الطلب:" : "Initiating Rep:"} <strong className="text-slate-700 dark:text-slate-300">{req.rep}</strong></p>
                <p className="text-slate-600 dark:text-slate-450 text-[11px]">
                  {req.detail}
                </p>
              </div>

              {req.status === "Pending" && (
                <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <button 
                    onClick={() => handleAction(req.id, "Rejected")}
                    className="px-2.5 py-1 text-rose-600 hover:text-rose-700 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded font-bold text-[9px] cursor-pointer flex items-center gap-1"
                  >
                    <X size={12} />
                    {isRtl ? "رفض الطلب" : "Reject Request"}
                  </button>
                  <button 
                    onClick={() => handleAction(req.id, "Approved")}
                    className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-bold text-[9px] cursor-pointer flex items-center gap-1"
                  >
                    <Check size={12} />
                    {isRtl ? "اعتماد وقبول" : "Approve Request"}
                  </button>
                </div>
              )}
            </div>
          ))}

          {filteredRequests.length === 0 && (
            <div className="p-8 text-center text-slate-400">
              {isRtl ? "لا توجد طلبات معلقة تطابق البحث" : "No pending approval requests match your search criteria."}
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
