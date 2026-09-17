import React, { useState, useMemo, useCallback, useEffect } from "react";
import { 
  Calendar, 
  User, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  Plus, 
  Search, 
  Filter, 
  Briefcase, 
  Check, 
  X, 
  FileText,
  Bookmark
} from "lucide-react";
import { motion } from "motion/react";
import type { User as MenarepsUser } from "../../types";
import { auth } from "../../lib/firebase";
import { fetchScopedTeamActivity } from "../../lib/teamActivityReadClient";
import { mutateLeaveRequest } from "../../lib/leaveRequestClient";

interface LeaveApprovalsProps {
  lang: "en" | "ar";
  currentUser: MenarepsUser;
  users: MenarepsUser[];
}

interface LeaveRequest {
  id: string;
  userId: string;
  repName: string;
  category: "Annual" | "Sick" | "Personal" | "Unpaid" | "Work From Home";
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  reasonAr?: string;
  status: "Pending" | "Approved" | "Rejected";
  submittedDate: string;
}

const INITIAL_LEAVE_REQUESTS: LeaveRequest[] = [];

export default function LeaveApprovals({ lang, currentUser, users }: LeaveApprovalsProps) {
  const isRtl = lang === "ar";
  const [requests, setRequests] = useState<LeaveRequest[]>(INITIAL_LEAVE_REQUESTS);
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [isFormOpen, setIsFormOpen] = useState(false);
  
  // New Leave Form states
  const [newRepName, setNewRepName] = useState("");
  const [newCategory, setNewCategory] = useState<"Annual" | "Sick" | "Personal" | "Unpaid" | "Work From Home">("Annual");
  const [newStartDate, setNewStartDate] = useState("");
  const [newEndDate, setNewEndDate] = useState("");
  const [newReason, setNewReason] = useState("");
  const [newReasonAr, setNewReasonAr] = useState("");

  const [toast, setToast] = useState("");
  const [loadError, setLoadError] = useState("");

  const loadRequests = useCallback(async () => {
    try {
      if (!auth.currentUser) throw new Error("AUTH_REQUIRED");
      const today = new Date(); const from = new Date(today); from.setUTCFullYear(from.getUTCFullYear() - 1);
      const response = await fetchScopedTeamActivity(auth.currentUser, from.toISOString().slice(0, 10), today.toISOString().slice(0, 10));
      setRequests(response.leaveRequests.map(item => {
        const profile = users.find(user => (user.uid || user.id) === item.userId);
        const categoryMap: Record<string, LeaveRequest["category"]> = { ANNUAL: "Annual", SICK: "Sick", PERSONAL: "Personal", UNPAID: "Unpaid", WORK_FROM_HOME: "Work From Home" };
        return { id: item.id, userId: item.userId, repName: profile?.name || `${profile?.firstName || ""} ${profile?.lastName || ""}`.trim() || item.userId, category: categoryMap[item.category] || "Personal", startDate: item.startDate, endDate: item.endDate, days: Math.floor((Date.parse(`${item.endDate}T00:00:00Z`) - Date.parse(`${item.startDate}T00:00:00Z`)) / 86_400_000) + 1, reason: item.reason || "", status: item.status === "APPROVED" ? "Approved" : item.status === "REJECTED" ? "Rejected" : "Pending", submittedDate: item.createdAt?.slice(0, 10) || item.startDate };
      }));
      setLoadError("");
    } catch (error) { setRequests([]); setLoadError(error instanceof Error ? error.message : "Unable to load leave requests"); }
  }, [currentUser.id, currentUser.uid, users]);

  useEffect(() => { void loadRequests(); }, [loadRequests]);

  const dict = {
    en: {
      title: "Leave & Absence Management",
      subtitle: "Review leave submissions, personal day-off requests, and field absence approvals for medical representatives.",
      pendingRequests: "Pending Sign-offs",
      approvedRequests: "Cleared This Month",
      rejectedRequests: "Declined Submissions",
      activeToday: "Currently on Leave Today",
      searchPlaceholder: "Search representative name...",
      allCategories: "All Leave Categories",
      annual: "Annual Leave",
      sick: "Medical / Sick Leave",
      personal: "Personal Leave",
      workFromHome: "Work From Home",
      unpaid: "Unpaid Leave",
      allStatuses: "All Statuses",
      pending: "Pending Action",
      approved: "Approved",
      rejected: "Rejected",
      addRequest: "Log Request on Behalf",
      tableId: "Request ID",
      tableRep: "Representative",
      tableCategory: "Category",
      tableDuration: "Duration",
      tableReason: "Primary Reason",
      tableStatus: "Decision Status",
      tableActions: "Actions",
      approve: "Approve",
      reject: "Reject",
      approveSuccess: "Approved leave request for ",
      rejectSuccess: "Rejected leave request for ",
      addSuccess: "Logged leave request successfully on behalf of representative!",
      formTitle: "Log Leave on Behalf of Representative",
      formRepName: "MedRep / Staff Name",
      formStartDate: "Start Date",
      formEndDate: "End Date",
      formReasonEn: "Reason (English)",
      formReasonAr: "Reason (Arabic)",
      submit: "Submit and Save",
      cancel: "Cancel",
      noRecords: "No leave requests found.",
      daysCount: "days",
      totalDays: "Total Days",
      requestedOn: "Requested on"
    },
    ar: {
      title: "إدارة واعتمادات الإجازات والغياب",
      subtitle: "مراجعة واعتماد طلبات الإجازات السنوية والمرضية، والغياب الطارئ، وتنسيق الحضور للفريق الميداني.",
      pendingRequests: "طلبات قيد المراجعة والتدقيق",
      approvedRequests: "الطلبات المعتمدة هذا الشهر",
      rejectedRequests: "الطلبات المرفوضة",
      activeToday: "مندوبين في إجازة اليوم",
      searchPlaceholder: "ابحث عن اسم المندوب...",
      allCategories: "جميع أنواع الإجازات",
      annual: "إجازة سنوية",
      sick: "إجازة مرضية مبررة",
      personal: "إجازة شخصية",
      workFromHome: "العمل من المنزل",
      unpaid: "إجازة بدون راتب",
      allStatuses: "جميع الحالات",
      pending: "قيد المراجعة",
      approved: "معتمد ومسجل",
      rejected: "مرفوض",
      addRequest: "تسجيل إجازة نيابة عن مندوب",
      tableId: "رمز الطلب",
      tableRep: "اسم المندوب الميداني",
      tableCategory: "نوع الإجازة",
      tableDuration: "الفترة الزمنية",
      tableReason: "السبب والتبرير",
      tableStatus: "حالة الاعتماد",
      tableActions: "الإجراء والقرار",
      approve: "موافقة واعتماد",
      reject: "رفض الطلب",
      approveSuccess: "تمت الموافقة بنجاح على طلب الإجازة لـ ",
      rejectSuccess: "تم رفض طلب الإجازة لـ ",
      addSuccess: "تم تسجيل طلب الإجازة بنجاح نيابة عن المندوب الميداني!",
      formTitle: "تسجيل طلب إجازة نيابة عن مندوب",
      formRepName: "اسم المندوب الميداني",
      formStartDate: "تاريخ البدء",
      formEndDate: "تاريخ الانتهاء",
      formReasonEn: "السبب (باللغة الإنجليزية)",
      formReasonAr: "السبب (باللغة العربية)",
      submit: "حفظ وإرسال الطلب",
      cancel: "إلغاء الأمر",
      noRecords: "لا توجد طلبات إجازة تطابق خيارات البحث الحالية.",
      daysCount: "أيام",
      totalDays: "إجمالي الأيام",
      requestedOn: "تاريخ التقديم"
    }
  };

  const t = dict[lang];

  // Action: Approve
  const handleApprove = async (reqId: string, repName: string) => {
    if (!auth.currentUser) return;
    try { await mutateLeaveRequest(auth.currentUser, { action: "APPROVE", requestId: reqId }); await loadRequests(); showToast(`${t.approveSuccess}${repName}`); }
    catch (error) { setLoadError(error instanceof Error ? error.message : "Approval failed"); }
  };

  // Action: Reject
  const handleReject = async (reqId: string, repName: string) => {
    if (!auth.currentUser) return;
    try { await mutateLeaveRequest(auth.currentUser, { action: "REJECT", requestId: reqId }); await loadRequests(); showToast(`${t.rejectSuccess}${repName}`); }
    catch (error) { setLoadError(error instanceof Error ? error.message : "Rejection failed"); }
  };

  // Toast handler
  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 4000);
  };

  // Add new request logic
  const handleCreateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRepName || !newStartDate || !newEndDate) return;

    // Calculate difference in days
    const start = new Date(newStartDate);
    const end = new Date(newEndDate);
    const timeDiff = Math.abs(end.getTime() - start.getTime());
    const daysDiff = Math.ceil(timeDiff / (1000 * 60 * 60 * 24)) + 1;

    const profile = users.find(user => (user.name || `${user.firstName || ""} ${user.lastName || ""}`.trim()).toLocaleLowerCase() === newRepName.trim().toLocaleLowerCase());
    const userId = profile?.uid || profile?.id;
    if (!userId || !auth.currentUser) { setLoadError("Select an exact authorized user name"); return; }
    const categoryMap = { Annual: "ANNUAL", Sick: "SICK", Personal: "PERSONAL", Unpaid: "UNPAID", "Work From Home": "WORK_FROM_HOME" } as const;
    try { await mutateLeaveRequest(auth.currentUser, { action: "CREATE", userId, category: categoryMap[newCategory], startDate: newStartDate, endDate: newEndDate, reason: newReason || newReasonAr || "" }); await loadRequests(); }
    catch (error) { setLoadError(error instanceof Error ? error.message : "Unable to create leave request"); return; }
    setIsFormOpen(false);
    
    // Clear states
    setNewRepName("");
    setNewCategory("Annual");
    setNewStartDate("");
    setNewEndDate("");
    setNewReason("");
    setNewReasonAr("");

    showToast(t.addSuccess);
  };

  // Filter computation
  const filteredRequests = useMemo(() => {
    return requests.filter(r => {
      const matchesSearch = r.repName.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesCategory = categoryFilter === "all" || r.category.toLowerCase() === categoryFilter.toLowerCase();
      const matchesStatus = statusFilter === "all" || r.status.toLowerCase() === statusFilter.toLowerCase();
      return matchesSearch && matchesCategory && matchesStatus;
    });
  }, [requests, searchTerm, categoryFilter, statusFilter]);

  // Statistics summaries
  const countPending = requests.filter(r => r.status === "Pending").length;
  const countApproved = requests.filter(r => r.status === "Approved").length;
  const countRejected = requests.filter(r => r.status === "Rejected").length;

  return (
    <div className="space-y-6" id="leave-approvals-root">
      {loadError && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-700">{loadError}</div>}
      {/* Toast Notifier */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-emerald-600 dark:bg-emerald-500 text-white text-xs font-bold px-4 py-3 rounded-xl shadow-lg flex items-center gap-2 animate-fade-in">
          <CheckCircle2 size={16} />
          <span>{toast}</span>
        </div>
      )}

      {/* Header section */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="p-1.5 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 rounded-lg">
              <Calendar size={18} />
            </span>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">{t.title}</h1>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-2xl">{t.subtitle}</p>
        </div>
        <button
          onClick={() => setIsFormOpen(!isFormOpen)}
          className="flex items-center justify-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition-colors shadow-sm cursor-pointer"
        >
          <Plus size={14} />
          <span>{t.addRequest}</span>
        </button>
      </div>

      {/* Form Card (Collapsible) */}
      {isFormOpen && (
        <motion.div 
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-md space-y-4"
        >
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
            <h3 className="text-sm font-bold text-slate-800 dark:text-white flex items-center gap-2">
              <Plus size={16} className="text-blue-500" />
              {t.formTitle}
            </h3>
            <button 
              onClick={() => setIsFormOpen(false)} 
              className="p-1 text-slate-400 hover:text-slate-600 rounded cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>

          <form onSubmit={handleCreateRequest} className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="space-y-1">
              <label className="font-semibold text-slate-600 dark:text-slate-300">{t.formRepName}</label>
              <input
                type="text"
                required
                value={newRepName}
                onChange={e => setNewRepName(e.target.value)}
                placeholder="e.g. Sarah Al-Sharif"
                className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 dark:bg-slate-950 rounded-lg focus:outline-none focus:border-blue-500 text-slate-800 dark:text-slate-100"
              />
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-600 dark:text-slate-300">{t.tableCategory}</label>
              <select
                value={newCategory}
                onChange={e => setNewCategory(e.target.value as any)}
                className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 dark:bg-slate-950 rounded-lg focus:outline-none focus:border-blue-500 text-slate-800 dark:text-slate-100"
              >
                <option value="Annual">{t.annual}</option>
                <option value="Sick">{t.sick}</option>
                <option value="Personal">{t.personal}</option>
                <option value="Unpaid">{t.unpaid}</option>
                <option value="Work From Home">{t.workFromHome}</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-600 dark:text-slate-300">{t.formStartDate}</label>
              <input
                type="date"
                required
                value={newStartDate}
                onChange={e => setNewStartDate(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 dark:bg-slate-950 rounded-lg focus:outline-none focus:border-blue-500 text-slate-800 dark:text-slate-100"
              />
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-600 dark:text-slate-300">{t.formEndDate}</label>
              <input
                type="date"
                required
                value={newEndDate}
                onChange={e => setNewEndDate(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 dark:bg-slate-950 rounded-lg focus:outline-none focus:border-blue-500 text-slate-800 dark:text-slate-100"
              />
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-600 dark:text-slate-300">{t.formReasonEn}</label>
              <input
                type="text"
                value={newReason}
                onChange={e => setNewReason(e.target.value)}
                placeholder="Family travel or dental rest"
                className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 dark:bg-slate-950 rounded-lg focus:outline-none focus:border-blue-500 text-slate-800 dark:text-slate-100"
              />
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-600 dark:text-slate-300">{t.formReasonAr}</label>
              <input
                type="text"
                value={newReasonAr}
                onChange={e => setNewReasonAr(e.target.value)}
                placeholder="مثال: سفر عائلي طارئ أو مراجعة طبيب"
                className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 dark:bg-slate-950 rounded-lg focus:outline-none focus:border-blue-500 text-slate-800 dark:text-slate-100"
              />
            </div>

            <div className="md:col-span-2 flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsFormOpen(false)}
                className="px-4 py-2 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                {t.cancel}
              </button>
              <button
                type="submit"
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold shadow-sm cursor-pointer"
              >
                {t.submit}
              </button>
            </div>
          </form>
        </motion.div>
      )}

      {/* KPI Stats widgets */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-amber-50 dark:bg-amber-950/40 rounded-xl text-amber-600">
            <Clock size={20} />
          </div>
          <div>
            <p className="text-xxs text-slate-400 font-bold uppercase tracking-wider">{t.pendingRequests}</p>
            <h3 className="text-lg font-bold text-slate-800 dark:text-white mt-1">{countPending} {isRtl ? "طلبات" : "requests"}</h3>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 rounded-xl text-emerald-600">
            <CheckCircle2 size={20} />
          </div>
          <div>
            <p className="text-xxs text-slate-400 font-bold uppercase tracking-wider">{t.approvedRequests}</p>
            <h3 className="text-lg font-bold text-slate-800 dark:text-white mt-1">{countApproved} {isRtl ? "معتمد" : "Approved"}</h3>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-red-50 dark:bg-red-950/40 rounded-xl text-red-600">
            <XCircle size={20} />
          </div>
          <div>
            <p className="text-xxs text-slate-400 font-bold uppercase tracking-wider">{t.rejectedRequests}</p>
            <h3 className="text-lg font-bold text-slate-800 dark:text-white mt-1">{countRejected} {isRtl ? "مرفوض" : "Rejected"}</h3>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-blue-50 dark:bg-blue-950/40 rounded-xl text-blue-600">
            <Briefcase size={20} />
          </div>
          <div>
            <p className="text-xxs text-slate-400 font-bold uppercase tracking-wider">{t.activeToday}</p>
            <h3 className="text-lg font-bold text-slate-800 dark:text-white mt-1">1 {isRtl ? "مندوب" : "Rep"}</h3>
          </div>
        </div>
      </div>

      {/* Filters Toolbar */}
      <div className="flex flex-col md:flex-row items-center gap-3 bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm">
        <div className="relative flex-1 w-full">
          <Search size={15} className="absolute left-3 top-3 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={t.searchPlaceholder}
            className="w-full pl-9 pr-4 py-2 border border-slate-200 dark:border-slate-800 dark:bg-slate-950 rounded-lg text-xs text-slate-700 dark:text-slate-200 focus:outline-none focus:border-blue-500"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto shrink-0">
          <div className="flex items-center gap-1.5 flex-1 md:flex-initial">
            <Filter size={13} className="text-slate-400" />
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="px-3 py-2 border border-slate-200 dark:border-slate-800 dark:bg-slate-950 rounded-lg text-xs text-slate-700 dark:text-slate-200 focus:outline-none focus:border-blue-500"
            >
              <option value="all">{t.allCategories}</option>
              <option value="annual">{t.annual}</option>
              <option value="sick">{t.sick}</option>
              <option value="personal">{t.personal}</option>
              <option value="unpaid">{t.unpaid}</option>
              <option value="work from home">{t.workFromHome}</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5 flex-1 md:flex-initial">
            <Filter size={13} className="text-slate-400" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 border border-slate-200 dark:border-slate-800 dark:bg-slate-950 rounded-lg text-xs text-slate-700 dark:text-slate-200 focus:outline-none focus:border-blue-500"
            >
              <option value="all">{t.allStatuses}</option>
              <option value="pending">{t.pending}</option>
              <option value="approved">{t.approved}</option>
              <option value="rejected">{t.rejected}</option>
            </select>
          </div>
        </div>
      </div>

      {/* Main Leave requests table */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm overflow-hidden">
        {/* Desktop View */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-950 border-b border-slate-100 dark:border-slate-800">
                <th className="p-4 text-xxs font-bold text-slate-400 uppercase tracking-wider">{t.tableId}</th>
                <th className="p-4 text-xxs font-bold text-slate-400 uppercase tracking-wider">{t.tableRep}</th>
                <th className="p-4 text-xxs font-bold text-slate-400 uppercase tracking-wider">{t.tableCategory}</th>
                <th className="p-4 text-xxs font-bold text-slate-400 uppercase tracking-wider">{t.tableDuration}</th>
                <th className="p-4 text-xxs font-bold text-slate-400 uppercase tracking-wider">{t.tableReason}</th>
                <th className="p-4 text-xxs font-bold text-slate-400 uppercase tracking-wider">{t.tableStatus}</th>
                <th className="p-4 text-xxs font-bold text-slate-400 uppercase tracking-wider text-right">{t.tableActions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-800 text-xs">
              {filteredRequests.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-400">
                    {t.noRecords}
                  </td>
                </tr>
              ) : (
                filteredRequests.map((req) => (
                  <tr key={req.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-950/40 transition-colors">
                    <td className="p-4 font-mono font-bold text-slate-500">{req.id}</td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center font-bold text-slate-600 dark:text-slate-300 text-xxs">
                          {req.repName.charAt(0)}
                        </div>
                        <div>
                          <p className="font-bold text-slate-800 dark:text-white">{req.repName}</p>
                          <p className="text-[10px] text-slate-400">{t.requestedOn}: {req.submittedDate}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-4">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        req.category === "Annual" ? "bg-blue-50 dark:bg-blue-950/40 text-blue-600" :
                        req.category === "Sick" ? "bg-amber-50 dark:bg-amber-950/40 text-amber-600" :
                        req.category === "Personal" ? "bg-red-50 dark:bg-red-950/40 text-red-600" :
                        "bg-slate-100 dark:bg-slate-800 text-slate-600"
                      }`}>
                        {req.category === "Annual" ? t.annual :
                         req.category === "Sick" ? t.sick :
                         req.category === "Personal" ? t.personal : req.category === "Work From Home" ? t.workFromHome : t.unpaid}
                      </span>
                    </td>
                    <td className="p-4">
                      <div className="flex flex-col">
                        <span className="font-semibold text-slate-700 dark:text-slate-200">
                          {req.startDate} {isRtl ? "إلى" : "to"} {req.endDate}
                        </span>
                        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1 mt-0.5">
                          <Calendar size={10} />
                          {req.days} {t.daysCount}
                        </span>
                      </div>
                    </td>
                    <td className="p-4 max-w-xs truncate">
                      <p className="text-slate-600 dark:text-slate-300 font-medium" title={isRtl ? req.reasonAr : req.reason}>
                        {isRtl ? (req.reasonAr || req.reason) : req.reason}
                      </p>
                    </td>
                    <td className="p-4">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold ${
                        req.status === "Approved" ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600" :
                        req.status === "Rejected" ? "bg-red-50 dark:bg-red-950/30 text-red-600" :
                        "bg-amber-50 dark:bg-amber-950/30 text-amber-600 animate-pulse"
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${
                          req.status === "Approved" ? "bg-emerald-500" :
                          req.status === "Rejected" ? "bg-red-500" : "bg-amber-500"
                        }`} />
                        {req.status === "Approved" ? t.approved :
                         req.status === "Rejected" ? t.rejected : t.pending}
                      </span>
                    </td>
                    <td className="p-4 text-right">
                      {req.status === "Pending" ? (
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => handleReject(req.id, req.repName)}
                            className="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30 rounded cursor-pointer"
                            title={t.reject}
                          >
                            <X size={14} />
                          </button>
                          <button
                            onClick={() => handleApprove(req.id, req.repName)}
                            className="p-1 text-emerald-500 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 rounded cursor-pointer"
                            title={t.approve}
                          >
                            <Check size={14} />
                          </button>
                        </div>
                      ) : (
                        <span className="text-[10px] text-slate-400 italic">
                          {isRtl ? "تم البت بالطلب" : "Processed"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile View */}
        <div className="block md:hidden divide-y divide-slate-100 dark:divide-slate-800">
          {filteredRequests.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400">
              {t.noRecords}
            </div>
          ) : (
            filteredRequests.map((req) => (
              <div 
                key={req.id} 
                className={`p-4 space-y-3 text-xs ${isRtl ? "text-right" : "text-left"}`}
              >
                <div className={`flex justify-between items-start gap-2 ${isRtl ? "flex-row-reverse" : "flex-row"}`}>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono font-bold text-slate-400 shrink-0">{req.id}</span>
                    <div className="w-6 h-6 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center font-bold text-slate-600 dark:text-slate-300 text-xxs shrink-0">
                      {req.repName.charAt(0)}
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-900 dark:text-white text-xs">{req.repName}</h4>
                      <p className="text-[9px] text-slate-400">{t.requestedOn}: {req.submittedDate}</p>
                    </div>
                  </div>
                  <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
                    req.status === "Approved" ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600" :
                    req.status === "Rejected" ? "bg-red-50 dark:bg-red-950/30 text-red-600" :
                    "bg-amber-50 dark:bg-amber-950/30 text-amber-600 animate-pulse"
                  }`}>
                    <span className={`w-1 h-1 rounded-full ${
                      req.status === "Approved" ? "bg-emerald-500" :
                      req.status === "Rejected" ? "bg-red-500" : "bg-amber-500"
                    }`} />
                    {req.status === "Approved" ? t.approved :
                     req.status === "Rejected" ? t.rejected : t.pending}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 bg-slate-50 dark:bg-slate-950/40 rounded-lg p-2.5 border border-slate-100/50 dark:border-slate-800/40 text-[11px]">
                  <div>
                    <p className="text-slate-400 text-[9px] uppercase font-bold">{t.tableCategory}</p>
                    <span className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-bold mt-1 ${
                      req.category === "Annual" ? "bg-blue-50 dark:bg-blue-950/40 text-blue-600" :
                      req.category === "Sick" ? "bg-amber-50 dark:bg-amber-950/40 text-amber-600" :
                      req.category === "Personal" ? "bg-red-50 dark:bg-red-950/40 text-red-600" :
                      "bg-slate-100 dark:bg-slate-800 text-slate-600"
                    }`}>
                      {req.category === "Annual" ? t.annual :
                       req.category === "Sick" ? t.sick :
                       req.category === "Personal" ? t.personal : req.category === "Work From Home" ? t.workFromHome : t.unpaid}
                    </span>
                  </div>
                  <div>
                    <p className="text-slate-400 text-[9px] uppercase font-bold">{t.tableDuration}</p>
                    <p className="font-semibold text-slate-700 dark:text-slate-300 mt-1">
                      {req.startDate} {isRtl ? "إلى" : "to"} {req.endDate}
                    </p>
                    <p className="text-[9px] text-slate-400 font-bold uppercase flex items-center gap-0.5 mt-0.5">
                      <Calendar size={9} />
                      {req.days} {t.daysCount}
                    </p>
                  </div>
                </div>

                {/* Reason block */}
                <div className="bg-slate-50/50 dark:bg-slate-950/20 border border-slate-100 dark:border-slate-800/40 rounded p-2 text-[11px] text-slate-600 dark:text-slate-400">
                  <p className="text-[8px] uppercase font-bold text-slate-400 tracking-wide mb-0.5">{t.tableReason}</p>
                  <p>{isRtl ? (req.reasonAr || req.reason) : req.reason}</p>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <span className="text-slate-400 text-[10px]">{isRtl ? "تاريخ معالجة الطلب" : "Process Decision"}</span>
                  {req.status === "Pending" ? (
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => handleReject(req.id, req.repName)}
                        className="px-3 py-1.5 border border-red-200 dark:border-red-950/50 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-lg font-bold flex items-center gap-1 cursor-pointer bg-white dark:bg-slate-900"
                        title={t.reject}
                      >
                        <X size={12} />
                        <span>{t.reject}</span>
                      </button>
                      <button
                        onClick={() => handleApprove(req.id, req.repName)}
                        className="px-3 py-1.5 border border-emerald-200 dark:border-emerald-950/50 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 rounded-lg font-bold flex items-center gap-1 cursor-pointer bg-white dark:bg-slate-900"
                        title={t.approve}
                      >
                        <Check size={12} />
                        <span>{t.approve}</span>
                      </button>
                    </div>
                  ) : (
                    <span className="text-[10px] text-slate-400 italic">
                      {isRtl ? "تم البت بالطلب" : "Processed"}
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
