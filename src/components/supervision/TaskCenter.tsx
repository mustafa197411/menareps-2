import React, { useState, useMemo } from "react";
import { 
  CheckSquare, 
  Plus, 
  Search, 
  Filter, 
  Calendar, 
  Clock, 
  AlertTriangle, 
  User, 
  ArrowRight,
  List,
  Kanban,
  CheckCircle2,
  Trash2,
  Tag,
  X
} from "lucide-react";
import { motion } from "motion/react";

interface TaskCenterProps {
  lang: "en" | "ar";
}

interface DirectiveTask {
  id: string;
  assignedRep: string;
  title: string;
  titleAr?: string;
  description: string;
  descriptionAr?: string;
  dueDate: string;
  priority: "High" | "Medium" | "Low";
  status: "Pending Rep Execution" | "In Progress" | "Completed & Confirmed" | "Overdue";
}

const INITIAL_TASKS: DirectiveTask[] = [
  {
    id: "DIR-2026-501",
    assignedRep: "Omar Al-Mokhtar",
    title: "Re-verify Dr. Ahmed's clinic location details",
    titleAr: "إعادة التحقق من موقع عيادة الدكتور أحمد بدقة",
    description: "Please check and verify clinic coordinates. Dr. Ahmed has moved to the eastern wing of the medical complex.",
    descriptionAr: "يرجى التحقق من الإحداثيات الجغرافية وتحديثها حيث انتقل الدكتور إلى الجناح الشرقي الجديد.",
    dueDate: "2026-06-28",
    priority: "Medium",
    status: "Pending Rep Execution"
  },
  {
    id: "DIR-2026-502",
    assignedRep: "Sarah Al-Sharif",
    title: "Detail CardioMax 20mg to Dr. Salem Al-Hadi",
    titleAr: "تقديم وتفصيل دواء كارديوماكس 20 ملغ للدكتور سالم الهادي",
    description: "Provide the latest clinical study samples of CardioMax 20mg and confirm clinical feedback survey.",
    descriptionAr: "توفير أحدث العينات الطبية والدراسة السريرية لكارديوماكس وتعبئة استطلاع الرأي معه.",
    dueDate: "2026-06-25",
    priority: "High",
    status: "Completed & Confirmed"
  },
  {
    id: "DIR-2026-503",
    assignedRep: "Tarek Abu-Zeid",
    title: "Collect outstanding invoice from Al-Razi Pharmacy",
    titleAr: "تحصيل الفاتورة المستحقة من صيدلية الرازي",
    description: "Collect the old balance of $1,250 from Al-Razi pharmacy and register receipt in the sales log.",
    descriptionAr: "تحصيل الرصيد المستحق بقيمة 1250 دولار من صيدلية الرازي وتسجيل الإيصال رسمياً.",
    dueDate: "2026-06-29",
    priority: "High",
    status: "In Progress"
  },
  {
    id: "DIR-2026-504",
    assignedRep: "Khalid Mansour",
    title: "Distribute pediatric samples to Tripoli Polyclinic",
    titleAr: "توزيع عينات أدوية الأطفال على مستوصف طرابلس",
    description: "Distribute KidVits and Pediatone samples based on the weekly allocation ledger.",
    descriptionAr: "توزيع حصص عينات فيتامينات الأطفال ومكملات النمو بناء على المخطط العام للأسبوع.",
    dueDate: "2026-06-20",
    priority: "Low",
    status: "Overdue"
  }
];

export default function TaskCenter({ lang }: TaskCenterProps) {
  const isRtl = lang === "ar";
  const [tasks, setTasks] = useState<DirectiveTask[]>(INITIAL_TASKS);
  const [viewMode, setViewMode] = useState<"list" | "kanban">("list");
  const [searchTerm, setSearchTerm] = useState("");
  const [repFilter, setRepFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [isFormOpen, setIsFormOpen] = useState(false);

  // Form states
  const [newTitle, setNewTitle] = useState("");
  const [newTitleAr, setNewTitleAr] = useState("");
  const [newRep, setNewRep] = useState("");
  const [newDueDate, setNewDueDate] = useState("");
  const [newPriority, setNewPriority] = useState<"High" | "Medium" | "Low">("Medium");
  const [newDescription, setNewDescription] = useState("");
  const [newDescriptionAr, setNewDescriptionAr] = useState("");

  const [toast, setToast] = useState("");

  const dict = {
    en: {
      title: "Supervisor Directives & Task Center",
      subtitle: "Issue specific operational directives, assign location verification tasks, and track real-time resolution from the field team.",
      issuedDirectives: "Directives Issued",
      pendingReps: "Pending Rep Execution",
      completedDirectives: "Completed & Confirmed",
      closeRatio: "Resolution Rate",
      searchPlaceholder: "Search directive title or task...",
      allReps: "All Assigned Representatives",
      allPriorities: "All Priorities",
      high: "High Priority",
      medium: "Medium Priority",
      low: "Low Priority",
      viewList: "List View",
      viewKanban: "Kanban Board",
      addDirective: "Issue New Directive",
      tableId: "Directive ID",
      tableTask: "Directive / Task",
      tableAssignee: "Assigned Rep",
      tableDueDate: "Due Date",
      tableStatus: "Status",
      tableActions: "Actions",
      completeBtn: "Sign-Off",
      deleteBtn: "Delete",
      formTitle: "Issue New Field Directive / Task",
      formTitleEn: "Directive Title (English)",
      formTitleAr: "Directive Title (Arabic)",
      formRep: "Assigned MedRep",
      formDueDate: "Target Due Date",
      formPriority: "Priority Level",
      formDescEn: "Description (English)",
      formDescAr: "Description (Arabic)",
      submit: "Issue Field Directive",
      cancel: "Cancel",
      noRecords: "No field directives found matching your criteria.",
      addSuccess: "Operational directive issued and broadcasted to representative successfully!",
      completeSuccess: "Field directive signed off and confirmed successfully!",
      deleteSuccess: "Directive deleted successfully from logs.",
      kanbanPending: "Pending Rep",
      kanbanInProgress: "In Progress",
      kanbanCompleted: "Completed",
      kanbanOverdue: "Overdue",
      overdueText: "Overdue",
      progressText: "In Progress",
      pendingText: "Pending",
      confirmedText: "Confirmed"
    },
    ar: {
      title: "مركز مهام وتوجيهات المشرفين",
      subtitle: "إصدار وإسناد التوجيهات الميدانية المباشرة والتحقق من المواقع لمندوبي الأدوية ومتابعة إغلاقها.",
      issuedDirectives: "التوجيهات والمهام الصادرة",
      pendingReps: "مهام قيد التنفيذ الميداني",
      completedDirectives: "المهام المغلقة والمعتمدة",
      closeRatio: "نسبة إغلاق المهام بنجاح",
      searchPlaceholder: "ابحث في التوجيهات والمهام...",
      allReps: "جميع المندوبين المكلفين",
      allPriorities: "جميع مستويات الأهمية",
      high: "أهمية قصوى",
      medium: "أهمية متوسطة",
      low: "أهمية منخفضة",
      viewList: "عرض كقائمة",
      viewKanban: "لوحة كانبان التفاعلية",
      addDirective: "إصدار توجيه ميداني جديد",
      tableId: "رمز التوجيه",
      tableTask: "التوجيه الميداني / المهمة",
      tableAssignee: "المندوب المكلف",
      tableDueDate: "تاريخ الاستحقاق",
      tableStatus: "حالة التنفيذ الحالية",
      tableActions: "الإجراء والتحقق",
      completeBtn: "اعتماد وإغلاق",
      deleteBtn: "حذف",
      formTitle: "إصدار توجيه أو مهمة ميدانية جديدة",
      formTitleEn: "عنوان التوجيه (باللغة الإنجليزية)",
      formTitleAr: "عنوان التوجيه (باللغة العربية)",
      formRep: "المندوب الميداني المكلف",
      formDueDate: "تاريخ الاستحقاق المستهدف",
      formPriority: "مستوى الأهمية",
      formDescEn: "التفاصيل (باللغة الإنجليزية)",
      formDescAr: "التفاصيل (باللغة العربية)",
      submit: "إصدار التوجيه للمندوب",
      cancel: "إلغاء الأمر",
      noRecords: "لا توجد توجيهات أو مهام تطابق شروط التصفية.",
      addSuccess: "تم إصدار التوجيه الميداني وإرساله بنجاح إلى هاتف المندوب المباشر!",
      completeSuccess: "تم اعتماد وتأكيد إتمام المهمة وإغلاق التوجيه بنجاح!",
      deleteSuccess: "تم حذف التوجيه الميداني بنجاح من السجلات.",
      kanbanPending: "قيد الانتظار",
      kanbanInProgress: "جاري العمل",
      kanbanCompleted: "مكتمل ومغلق",
      kanbanOverdue: "متأخر استحقاقاً",
      overdueText: "متأخر",
      progressText: "جاري التنفيذ",
      pendingText: "قيد الانتظار",
      confirmedText: "مؤكد ومكتمل"
    }
  };

  const t = dict[lang];

  // Toast Helper
  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 4000);
  };

  // Sign off action
  const handleCompleteTask = (id: string) => {
    setTasks(prev => prev.map(task => task.id === id ? { ...task, status: "Completed & Confirmed" } : task));
    showToast(t.completeSuccess);
  };

  // Delete action
  const handleDeleteTask = (id: string) => {
    setTasks(prev => prev.filter(task => task.id !== id));
    showToast(t.deleteSuccess);
  };

  // Create new task submit
  const handleCreateTaskSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle || !newRep || !newDueDate) return;

    const newTask: DirectiveTask = {
      id: `DIR-2026-${Math.floor(505 + Math.random() * 490)}`,
      assignedRep: newRep,
      title: newTitle,
      titleAr: newTitleAr || newTitle,
      dueDate: newDueDate,
      priority: newPriority,
      status: "Pending Rep Execution",
      description: newDescription || "No additional notes",
      descriptionAr: newDescriptionAr || "لا توجد تفاصيل إضافية"
    };

    setTasks(prev => [newTask, ...prev]);
    setIsFormOpen(false);

    // Reset inputs
    setNewTitle("");
    setNewTitleAr("");
    setNewRep("");
    setNewDueDate("");
    setNewPriority("Medium");
    setNewDescription("");
    setNewDescriptionAr("");

    showToast(t.addSuccess);
  };

  // Unique list of reps for filtering
  const uniqueReps = useMemo(() => {
    const reps = new Set<string>();
    tasks.forEach(task => reps.add(task.assignedRep));
    return Array.from(reps);
  }, [tasks]);

  // Filters logic
  const filteredTasks = useMemo(() => {
    return tasks.filter(task => {
      const titleMatch = isRtl ? (task.titleAr || task.title) : task.title;
      const matchesSearch = titleMatch.toLowerCase().includes(searchTerm.toLowerCase()) || 
                            task.assignedRep.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesRep = repFilter === "all" || task.assignedRep === repFilter;
      const matchesPriority = priorityFilter === "all" || task.priority === priorityFilter;
      return matchesSearch && matchesRep && matchesPriority;
    });
  }, [tasks, searchTerm, repFilter, priorityFilter, isRtl]);

  // Statistics calculation
  const totalIssued = tasks.length;
  const pendingRepCount = tasks.filter(task => task.status === "Pending Rep Execution" || task.status === "In Progress").length;
  const completedCount = tasks.filter(task => task.status === "Completed & Confirmed").length;
  const resolutionRate = totalIssued > 0 ? Math.round((completedCount / totalIssued) * 100) : 0;

  // Kanban groups helper
  const kanbanColumns = {
    pending: filteredTasks.filter(t => t.status === "Pending Rep Execution"),
    inProgress: filteredTasks.filter(t => t.status === "In Progress"),
    completed: filteredTasks.filter(t => t.status === "Completed & Confirmed"),
    overdue: filteredTasks.filter(t => t.status === "Overdue")
  };

  return (
    <div className="space-y-6" id="task-center-root">
      {/* Toast Alert popup */}
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
            <span className="p-1.5 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 rounded-lg">
              <CheckSquare size={18} />
            </span>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">{t.title}</h1>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-2xl">{t.subtitle}</p>
        </div>
        <div className="flex items-center gap-3 self-start md:self-auto">
          {/* View mode toggle */}
          <div className="flex items-center border border-slate-200 dark:border-slate-800 rounded-lg p-0.5 bg-slate-50 dark:bg-slate-950">
            <button
              onClick={() => setViewMode("list")}
              className={`p-1.5 rounded-md text-xs transition-colors cursor-pointer flex items-center gap-1 ${
                viewMode === "list" 
                  ? "bg-white dark:bg-slate-800 shadow text-blue-600 dark:text-blue-400 font-bold" 
                  : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              }`}
              title={t.viewList}
            >
              <List size={14} />
            </button>
            <button
              onClick={() => setViewMode("kanban")}
              className={`p-1.5 rounded-md text-xs transition-colors cursor-pointer flex items-center gap-1 ${
                viewMode === "kanban" 
                  ? "bg-white dark:bg-slate-800 shadow text-blue-600 dark:text-blue-400 font-bold" 
                  : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              }`}
              title={t.viewKanban}
            >
              <Kanban size={14} />
            </button>
          </div>

          <button
            onClick={() => setIsFormOpen(!isFormOpen)}
            className="flex items-center justify-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition-colors shadow-sm cursor-pointer"
          >
            <Plus size={14} />
            <span>{t.addDirective}</span>
          </button>
        </div>
      </div>

      {/* Issuing Directive Form (Collapsible) */}
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

          <form onSubmit={handleCreateTaskSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="space-y-1">
              <label className="font-semibold text-slate-600 dark:text-slate-300">{t.formTitleEn}</label>
              <input
                type="text"
                required
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                placeholder="e.g. Verify Dr. Salem clinic coordinates"
                className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 dark:bg-slate-950 rounded-lg focus:outline-none focus:border-blue-500 text-slate-800 dark:text-slate-100"
              />
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-600 dark:text-slate-300">{t.formTitleAr}</label>
              <input
                type="text"
                value={newTitleAr}
                onChange={e => setNewTitleAr(e.target.value)}
                placeholder="مثال: التحقق من إحداثيات عيادة الدكتور سالم"
                className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 dark:bg-slate-950 rounded-lg focus:outline-none focus:border-blue-500 text-slate-800 dark:text-slate-100"
              />
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-600 dark:text-slate-300">{t.formRep}</label>
              <input
                type="text"
                required
                value={newRep}
                onChange={e => setNewRep(e.target.value)}
                placeholder="e.g. Omar Al-Mokhtar"
                className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 dark:bg-slate-950 rounded-lg focus:outline-none focus:border-blue-500 text-slate-800 dark:text-slate-100"
              />
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-600 dark:text-slate-300">{t.formDueDate}</label>
              <input
                type="date"
                required
                value={newDueDate}
                onChange={e => setNewDueDate(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 dark:bg-slate-950 rounded-lg focus:outline-none focus:border-blue-500 text-slate-800 dark:text-slate-100"
              />
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-600 dark:text-slate-300">{t.formPriority}</label>
              <select
                value={newPriority}
                onChange={e => setNewPriority(e.target.value as any)}
                className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 dark:bg-slate-950 rounded-lg focus:outline-none focus:border-blue-500 text-slate-800 dark:text-slate-100"
              >
                <option value="High">{t.high}</option>
                <option value="Medium">{t.medium}</option>
                <option value="Low">{t.low}</option>
              </select>
            </div>

            <div className="md:col-span-2 space-y-1">
              <label className="font-semibold text-slate-600 dark:text-slate-300">{t.formDescEn}</label>
              <textarea
                value={newDescription}
                onChange={e => setNewDescription(e.target.value)}
                rows={2}
                placeholder="Write specific operational steps for the representative..."
                className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 dark:bg-slate-950 rounded-lg focus:outline-none focus:border-blue-500 text-slate-800 dark:text-slate-100"
              />
            </div>

            <div className="md:col-span-2 space-y-1">
              <label className="font-semibold text-slate-600 dark:text-slate-300">{t.formDescAr}</label>
              <textarea
                value={newDescriptionAr}
                onChange={e => setNewDescriptionAr(e.target.value)}
                rows={2}
                placeholder="تفاصيل التوجيه الميداني والخطوات المطلوبة للتنفيذ باللغة العربية..."
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

      {/* KPI Stats Board */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-blue-50 dark:bg-blue-950/40 rounded-xl text-blue-600">
            <CheckSquare size={20} />
          </div>
          <div>
            <p className="text-xxs text-slate-400 font-bold uppercase tracking-wider">{t.issuedDirectives}</p>
            <h3 className="text-lg font-bold text-slate-800 dark:text-white mt-1">{totalIssued} {isRtl ? "توجيهات" : "tasks"}</h3>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-amber-50 dark:bg-amber-950/40 rounded-xl text-amber-600">
            <Clock size={20} />
          </div>
          <div>
            <p className="text-xxs text-slate-400 font-bold uppercase tracking-wider">{t.pendingReps}</p>
            <h3 className="text-lg font-bold text-slate-800 dark:text-white mt-1">{pendingRepCount} {isRtl ? "مستمرة" : "pending"}</h3>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 rounded-xl text-emerald-600">
            <CheckCircle2 size={20} />
          </div>
          <div>
            <p className="text-xxs text-slate-400 font-bold uppercase tracking-wider">{t.completedDirectives}</p>
            <h3 className="text-lg font-bold text-slate-800 dark:text-white mt-1">{completedCount} {isRtl ? "مغلقة" : "cleared"}</h3>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-teal-50 dark:bg-teal-950/40 rounded-xl text-teal-600">
            <ArrowRight size={20} className={isRtl ? "rotate-180" : ""} />
          </div>
          <div>
            <p className="text-xxs text-slate-400 font-bold uppercase tracking-wider">{t.closeRatio}</p>
            <h3 className="text-lg font-bold text-slate-800 dark:text-white mt-1">{resolutionRate}%</h3>
          </div>
        </div>
      </div>

      {/* Filter toolbar */}
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
              value={repFilter}
              onChange={(e) => setRepFilter(e.target.value)}
              className="px-3 py-2 border border-slate-200 dark:border-slate-800 dark:bg-slate-950 rounded-lg text-xs text-slate-700 dark:text-slate-200 focus:outline-none focus:border-blue-500"
            >
              <option value="all">{t.allReps}</option>
              {uniqueReps.map(rep => (
                <option key={rep} value={rep}>{rep}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5 flex-1 md:flex-initial">
            <Filter size={13} className="text-slate-400" />
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
              className="px-3 py-2 border border-slate-200 dark:border-slate-800 dark:bg-slate-950 rounded-lg text-xs text-slate-700 dark:text-slate-200 focus:outline-none focus:border-blue-500"
            >
              <option value="all">{t.allPriorities}</option>
              <option value="High">{t.high}</option>
              <option value="Medium">{t.medium}</option>
              <option value="Low">{t.low}</option>
            </select>
          </div>
        </div>
      </div>

      {/* Main tasks list or kanban board container */}
      {viewMode === "list" ? (
        /* LIST/TABLE VIEW */
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm overflow-hidden animate-fade-in">
          {/* Desktop View */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-950 border-b border-slate-100 dark:border-slate-800">
                  <th className="p-4 text-xxs font-bold text-slate-400 uppercase tracking-wider">{t.tableId}</th>
                  <th className="p-4 text-xxs font-bold text-slate-400 uppercase tracking-wider">{t.tableTask}</th>
                  <th className="p-4 text-xxs font-bold text-slate-400 uppercase tracking-wider">{t.tableAssignee}</th>
                  <th className="p-4 text-xxs font-bold text-slate-400 uppercase tracking-wider">{t.tableDueDate}</th>
                  <th className="p-4 text-xxs font-bold text-slate-400 uppercase tracking-wider">{t.tableStatus}</th>
                  <th className="p-4 text-xxs font-bold text-slate-400 uppercase tracking-wider text-right">{t.tableActions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                {filteredTasks.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-400">
                      {t.noRecords}
                    </td>
                  </tr>
                ) : (
                  filteredTasks.map((task) => (
                    <tr key={task.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-950/40 transition-colors">
                      <td className="p-4 font-mono font-bold text-slate-500">{task.id}</td>
                      <td className="p-4">
                        <div className="max-w-md space-y-1">
                          <p className="font-bold text-slate-800 dark:text-white flex items-center gap-1.5">
                            <Tag size={12} className={
                              task.priority === "High" ? "text-red-500" :
                              task.priority === "Medium" ? "text-amber-500" : "text-blue-500"
                            } />
                            {isRtl ? (task.titleAr || task.title) : task.title}
                          </p>
                          <p className="text-[10px] text-slate-400 leading-relaxed">
                            {isRtl ? (task.descriptionAr || task.description) : task.description}
                          </p>
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-1.5">
                          <div className="w-5 h-5 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-[10px] font-bold text-slate-600 dark:text-slate-300">
                            {task.assignedRep.charAt(0)}
                          </div>
                          <span className="font-semibold text-slate-700 dark:text-slate-300">{task.assignedRep}</span>
                        </div>
                      </td>
                      <td className="p-4">
                        <span className="font-bold text-slate-600 dark:text-slate-400 font-mono">{task.dueDate}</span>
                      </td>
                      <td className="p-4">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                          task.status === "Completed & Confirmed" ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600" :
                          task.status === "In Progress" ? "bg-indigo-50 dark:bg-indigo-950/30 text-indigo-600" :
                          task.status === "Overdue" ? "bg-red-50 dark:bg-red-950/30 text-red-600 font-bold" :
                          "bg-amber-50 dark:bg-amber-950/30 text-amber-600"
                        }`}>
                          <span className={`w-1 h-1 rounded-full ${
                            task.status === "Completed & Confirmed" ? "bg-emerald-500" :
                            task.status === "In Progress" ? "bg-indigo-500" :
                            task.status === "Overdue" ? "bg-red-500" : "bg-amber-500"
                          }`} />
                          {task.status === "Completed & Confirmed" ? t.confirmedText :
                           task.status === "In Progress" ? t.progressText :
                           task.status === "Overdue" ? t.overdueText : t.pendingText}
                        </span>
                      </td>
                      <td className="p-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {task.status !== "Completed & Confirmed" && (
                            <button
                              onClick={() => handleCompleteTask(task.id)}
                              className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:hover:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 font-bold rounded text-[10px] transition-colors cursor-pointer"
                            >
                              {t.completeBtn}
                            </button>
                          )}
                          <button
                            onClick={() => handleDeleteTask(task.id)}
                            className="p-1 text-slate-400 hover:text-red-500 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                            title={t.deleteBtn}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile View */}
          <div className="block md:hidden divide-y divide-slate-100 dark:divide-slate-800">
            {filteredTasks.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400">
                {t.noRecords}
              </div>
            ) : (
              filteredTasks.map((task) => (
                <div 
                  key={task.id} 
                  className={`p-4 space-y-3 text-xs ${isRtl ? "text-right" : "text-left"}`}
                >
                  <div className={`flex justify-between items-start gap-2 ${isRtl ? "flex-row-reverse" : "flex-row"}`}>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-mono font-bold text-slate-400 shrink-0">{task.id}</span>
                      <h4 className="font-bold text-slate-900 dark:text-white text-xs flex items-center gap-1">
                        <Tag size={11} className={`shrink-0 ${
                          task.priority === "High" ? "text-red-500" :
                          task.priority === "Medium" ? "text-amber-500" : "text-blue-500"
                        }`} />
                        {isRtl ? (task.titleAr || task.title) : task.title}
                      </h4>
                    </div>

                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
                      task.status === "Completed & Confirmed" ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600" :
                      task.status === "In Progress" ? "bg-indigo-50 dark:bg-indigo-950/30 text-indigo-600" :
                      task.status === "Overdue" ? "bg-red-50 dark:bg-red-950/30 text-red-600 font-bold" :
                      "bg-amber-50 dark:bg-amber-950/30 text-amber-600"
                    }`}>
                      <span className={`w-1 h-1 rounded-full ${
                        task.status === "Completed & Confirmed" ? "bg-emerald-500" :
                        task.status === "In Progress" ? "bg-indigo-500" :
                        task.status === "Overdue" ? "bg-red-500" : "bg-amber-500"
                      }`} />
                      {task.status === "Completed & Confirmed" ? t.confirmedText :
                       task.status === "In Progress" ? t.progressText :
                       task.status === "Overdue" ? t.overdueText : t.pendingText}
                    </span>
                  </div>

                  {/* Description block */}
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-normal pl-4">
                    {isRtl ? (task.descriptionAr || task.description) : task.description}
                  </p>

                  <div className="grid grid-cols-2 gap-2 bg-slate-50 dark:bg-slate-950/40 rounded-lg p-2.5 border border-slate-100/50 dark:border-slate-800/40 text-[11px]">
                    <div>
                      <p className="text-slate-400 text-[9px] uppercase font-bold">{t.tableAssignee}</p>
                      <div className="flex items-center gap-1 mt-1">
                        <div className="w-5 h-5 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-[9px] font-bold text-slate-600 dark:text-slate-300">
                          {task.assignedRep.charAt(0)}
                        </div>
                        <span className="font-semibold text-slate-700 dark:text-slate-200">{task.assignedRep}</span>
                      </div>
                    </div>
                    <div>
                      <p className="text-slate-400 text-[9px] uppercase font-bold">{t.tableDueDate}</p>
                      <p className="font-bold text-slate-600 dark:text-slate-300 font-mono mt-1">{task.dueDate}</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <span className="text-slate-400 text-[10px]">{isRtl ? "تاريخ إتمام المهمة" : "Actions Available"}</span>
                    <div className="flex items-center gap-2">
                      {task.status !== "Completed & Confirmed" && (
                        <button
                          onClick={() => handleCompleteTask(task.id)}
                          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs transition-colors cursor-pointer shadow-xs"
                        >
                          {t.completeBtn}
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteTask(task.id)}
                        className="p-1.5 text-slate-500 hover:text-red-500 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 cursor-pointer"
                        title={t.deleteBtn}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      ) : (
        /* KANBAN BOARD VIEW */
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 animate-fade-in">
          {/* Column 1: Pending */}
          <div className="bg-slate-50/70 dark:bg-slate-900/40 p-4 rounded-xl border border-slate-100 dark:border-slate-800 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
              <span className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                {t.kanbanPending}
              </span>
              <span className="text-xxs font-bold font-mono text-slate-400 bg-slate-100 dark:bg-slate-950 px-1.5 py-0.5 rounded">
                {kanbanColumns.pending.length}
              </span>
            </div>
            <div className="space-y-3 overflow-y-auto max-h-[500px]">
              {kanbanColumns.pending.map(task => (
                <KanbanCard key={task.id} task={task} isRtl={isRtl} onComplete={handleCompleteTask} onDelete={handleDeleteTask} dict={t} />
              ))}
            </div>
          </div>

          {/* Column 2: In Progress */}
          <div className="bg-slate-50/70 dark:bg-slate-900/40 p-4 rounded-xl border border-slate-100 dark:border-slate-800 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
              <span className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                {t.kanbanInProgress}
              </span>
              <span className="text-xxs font-bold font-mono text-slate-400 bg-slate-100 dark:bg-slate-950 px-1.5 py-0.5 rounded">
                {kanbanColumns.inProgress.length}
              </span>
            </div>
            <div className="space-y-3 overflow-y-auto max-h-[500px]">
              {kanbanColumns.inProgress.map(task => (
                <KanbanCard key={task.id} task={task} isRtl={isRtl} onComplete={handleCompleteTask} onDelete={handleDeleteTask} dict={t} />
              ))}
            </div>
          </div>

          {/* Column 3: Completed */}
          <div className="bg-slate-50/70 dark:bg-slate-900/40 p-4 rounded-xl border border-slate-100 dark:border-slate-800 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
              <span className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                {t.kanbanCompleted}
              </span>
              <span className="text-xxs font-bold font-mono text-slate-400 bg-slate-100 dark:bg-slate-950 px-1.5 py-0.5 rounded">
                {kanbanColumns.completed.length}
              </span>
            </div>
            <div className="space-y-3 overflow-y-auto max-h-[500px]">
              {kanbanColumns.completed.map(task => (
                <KanbanCard key={task.id} task={task} isRtl={isRtl} onComplete={handleCompleteTask} onDelete={handleDeleteTask} dict={t} />
              ))}
            </div>
          </div>

          {/* Column 4: Overdue */}
          <div className="bg-slate-50/70 dark:bg-slate-900/40 p-4 rounded-xl border border-slate-100 dark:border-slate-800 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
              <span className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                {t.kanbanOverdue}
              </span>
              <span className="text-xxs font-bold font-mono text-slate-400 bg-slate-100 dark:bg-slate-950 px-1.5 py-0.5 rounded">
                {kanbanColumns.overdue.length}
              </span>
            </div>
            <div className="space-y-3 overflow-y-auto max-h-[500px]">
              {kanbanColumns.overdue.map(task => (
                <KanbanCard key={task.id} task={task} isRtl={isRtl} onComplete={handleCompleteTask} onDelete={handleDeleteTask} dict={t} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Subcomponent: KanbanCard
interface KanbanCardProps {
  key?: string | number;
  task: DirectiveTask;
  isRtl: boolean;
  onComplete: (id: string) => void;
  onDelete: (id: string) => void;
  dict: any;
}

function KanbanCard({ task, isRtl, onComplete, onDelete, dict }: KanbanCardProps) {
  return (
    <motion.div 
      layout
      className="bg-white dark:bg-slate-950 p-4 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm space-y-3 relative group"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-[9px] text-slate-400 font-bold bg-slate-50 dark:bg-slate-900 px-1.5 py-0.5 rounded border border-slate-100 dark:border-slate-800">
          {task.id}
        </span>
        <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase ${
          task.priority === "High" ? "bg-red-50 dark:bg-red-950/40 text-red-500" :
          task.priority === "Medium" ? "bg-amber-50 dark:bg-amber-950/40 text-amber-500" :
          "bg-blue-50 dark:bg-blue-950/40 text-blue-500"
        }`}>
          {task.priority === "High" ? dict.high : task.priority === "Medium" ? dict.medium : dict.low}
        </span>
      </div>

      <div className="space-y-1 text-xs">
        <h4 className="font-bold text-slate-800 dark:text-white leading-snug">
          {isRtl ? (task.titleAr || task.title) : task.title}
        </h4>
        <p className="text-[10px] text-slate-400 leading-normal line-clamp-2">
          {isRtl ? (task.descriptionAr || task.description) : task.description}
        </p>
      </div>

      <div className="flex items-center justify-between border-t border-slate-50 dark:border-slate-900 pt-2 text-[10px]">
        <div className="flex items-center gap-1 text-slate-500 dark:text-slate-400 font-semibold">
          <User size={11} className="text-slate-400" />
          <span>{task.assignedRep}</span>
        </div>
        <div className="flex items-center gap-1 text-slate-400 font-bold">
          <Calendar size={11} />
          <span>{task.dueDate}</span>
        </div>
      </div>

      {/* Hover action block */}
      <div className="absolute inset-0 bg-white/95 dark:bg-slate-950/95 rounded-lg flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-150 p-2">
        {task.status !== "Completed & Confirmed" && (
          <button
            onClick={() => onComplete(task.id)}
            className="px-3 py-1 bg-emerald-600 text-white text-[10px] font-bold rounded shadow hover:bg-emerald-700 transition-colors cursor-pointer"
          >
            {dict.completeBtn}
          </button>
        )}
        <button
          onClick={() => onDelete(task.id)}
          className="p-1.5 text-slate-500 hover:text-red-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors cursor-pointer"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </motion.div>
  );
}
