import React, { useState, useEffect } from "react";
import { 
  FileSpreadsheet, 
  Download, 
  Upload, 
  Search, 
  SlidersHorizontal, 
  ShieldCheck, 
  AlertCircle, 
  Clock, 
  Layers, 
  Eye, 
  Lock, 
  ExternalLink,
  CheckCircle,
  HelpCircle,
  BookOpen,
  Plus,
  Compass,
  FileText
} from "lucide-react";
import { Role, User, Permissions } from "../types";
import { motion } from "motion/react";
import { 
  Template, 
  TemplateField, 
  getTemplates 
} from "../lib/templateRegistry";
import TemplateRegistryManager from "./TemplateRegistryManager";
import * as XLSX from "xlsx";

interface TemplateCatalogProps {
  currentUser: User;
  lang: "en" | "ar";
  permissionsMatrix: Record<Role, Permissions>;
  setActiveView: (view: string) => void;
}

export default function TemplateCatalog({
  currentUser,
  lang,
  permissionsMatrix,
  setActiveView
}: TemplateCatalogProps) {
  const isRtl = lang === "ar";
  const isAdmin = currentUser.role === Role.SUPER_ADMIN || currentUser.role === Role.ADMIN;
  const userPermissions = permissionsMatrix[currentUser.role];
  const canDownload = userPermissions?.import || userPermissions?.export || isAdmin;

  // States
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"catalog" | "management" | "gap-analysis">("catalog");
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("All");
  const [selectedTemplateForPreview, setSelectedTemplateForPreview] = useState<Template | null>(null);
  const [alert, setAlert] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  // Load registry data
  useEffect(() => {
    async function load() {
      setLoading(true);
      const list = await getTemplates();
      setTemplates(list);
      setLoading(false);
    }
    load();
  }, []);

  const triggerAlert = (type: "success" | "error", msg: string) => {
    setAlert({ type, msg });
    setTimeout(() => setAlert(null), 4000);
  };

  // Pre-determined localized text
  const t = {
    en: {
      title: "Enterprise Template Catalog",
      subtitle: "Browse, download, and launch CRM import modules with verified official schemas",
      searchPlaceholder: "Search templates by name, code, or module...",
      filterCategory: "Filter Category",
      allCategories: "All Categories",
      version: "Version",
      module: "Module",
      category: "Category",
      lastUpdated: "Last Updated",
      status: "Status",
      fieldsCount: "Fields",
      downloadTemplate: "Download Excel Schema",
      launchImport: "Launch Import Center",
      detailsPreview: "Schema Fields Alignment",
      missingReportTitle: "Missing Master Templates Gap Analysis",
      missingReportSubtitle: "Official MENAREPS 2.0 blueprint components not registered in local tenant database",
      templateName: "Template Name",
      expectedModule: "Expected Module",
      reasonMissing: "Reason Missing",
      recommendedAction: "Recommended Action",
      authRequired: "Import/Export permissions required to download templates.",
      adminTab: "Schema & Version Registry",
      catalogTab: "Catalog & Downloads",
      gapTab: "Missing Templates Report",
      noResults: "No templates matched your filters.",
      lockedMsg: "Downloads Locked",
      lockedDesc: "Normal operators require official Import/Export roles assigned to extract spreadsheet templates.",
      importSuccessRoute: "Redirecting to Import Central with pre-selected context..."
    },
    ar: {
      title: "كتالوج القوالب المؤسسي",
      subtitle: "تصفح وتحميل وتشغيل وحدات الاستيراد بـ CRM مع مخططات معتمدة ومطابقة",
      searchPlaceholder: "البحث في القوالب بالاسم، الرمز، أو اسم الوحدة...",
      filterCategory: "تصنيف المخطط",
      allCategories: "جميع التصنيفات",
      version: "الإصدار",
      module: "الوحدة المستهدفة",
      category: "التصنيف الرئيسي",
      lastUpdated: "آخر تحديث",
      status: "الحالة",
      fieldsCount: "عدد الأعمدة",
      downloadTemplate: "تحميل قالب Excel",
      launchImport: "تشغيل مركز الاستيراد",
      detailsPreview: "معاينة أعمدة ومطابقة المخطط",
      missingReportTitle: "تقرير الفجوات للقوالب غير المسجلة",
      missingReportSubtitle: "عناصر ومكونات معيار MENAREPS 2.0 غير المعرفة في قاعدة بيانات المستأجر الحالية",
      templateName: "اسم القالب المقترح",
      expectedModule: "الوحدة المتوقعة",
      reasonMissing: "سبب عدم التواجد",
      recommendedAction: "الإجراء الموصى به",
      authRequired: "تتطلب صلاحيات الاستيراد والتصدير لتحميل هذا القالب.",
      adminTab: "إدارة وتسجيل المخططات",
      catalogTab: "كتالوج القوالب والتحميل",
      gapTab: "تقرير القوالب المفقودة",
      noResults: "لا توجد قوالب تطابق معايير التصفية والبحث.",
      lockedMsg: "تحميل القوالب مقفل",
      lockedDesc: "تتطلب عملية استخراج القوالب تفعيل صلاحيات الاستيراد والتصدير على حسابك التشغيلي.",
      importSuccessRoute: "جاري الانتقال لمركز الاستيراد وتطبيق سياق القالب المختار..."
    }
  }[lang];

  // Discovered / Registered Templates List
  const filteredTemplates = templates.filter(tpl => {
    const matchesCat = categoryFilter === "All" || tpl.category === categoryFilter;
    const matchesSearch = 
      tpl.templateName.toLowerCase().includes(searchQuery.toLowerCase()) || 
      tpl.templateCode.toLowerCase().includes(searchQuery.toLowerCase()) || 
      tpl.moduleName.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCat && matchesSearch;
  });

  // Comprehensive Gap Analysis Missing Templates List (official blueprint templates that DO NOT exist)
  const missingTemplatesList = [
    // Master Data
    { name: "Territories Template", module: "Territory & Team", reason: "Spatial boundary hierarchy handled dynamically in geographic assignments", action: "Super Admin should configure custom spreadsheet mappings in Registry if bulk import is required." },
    { name: "Countries Template", module: "Territory & Team", reason: "Standard system geographic nodes are pre-loaded", action: "Register brand-new Custom Template matching Country schema in the Registry tab." },
    { name: "Districts Template", module: "Territory & Team", reason: "Standard system geographic nodes are pre-loaded", action: "Register brand-new Custom Template matching District schema in the Registry tab." },
    { name: "Cities Template", module: "Territory & Team", reason: "Standard system geographic nodes are pre-loaded", action: "Register brand-new Custom Template matching City schema in the Registry tab." },
    { name: "Brands Template", module: "Products", reason: "Brands database derived dynamically from registered product SKUs", action: "Admin can register specific Brands mapping spreadsheet if dynamic taxonomy override is required." },
    { name: "Product Groups Template", module: "Products", reason: "Product grouping tags handled within core products master sheet columns", action: "Register dynamic Product Groups custom template as needed." },
    { name: "Therapeutic Areas Template", module: "Products", reason: "Therapeutic divisions map to static product lines list", action: "Maintain and configure via Product Master sheet columns directly." },
    { name: "Resource Center Template", module: "Products", reason: "Brochures and marketing materials managed via direct cloud storage attachments", action: "None. Avoid spreadsheet bulk import for static PDF files." },
    
    // Commercial
    { name: "Product Targets Template", module: "Targets", reason: "Core sales quotas and physician-directed sample targets defined in Targets Hub", action: "Design spreadsheet schema matching dynamic Targets Hub database and map to Registry." },
    { name: "Annual Targets Template", module: "Targets", reason: "Quotas configured directly inside annual corporate dashboards", action: "Define annual targets spreadsheet and upload custom schema in Registry." },
    { name: "Monthly Targets Template", module: "Targets", reason: "Quotas configured directly inside monthly corporate dashboards", action: "Define monthly targets spreadsheet and upload custom schema in Registry." },
    { name: "Territory Targets Template", module: "Targets", reason: "Quotas configured directly inside supervisor territory planning panels", action: "Map territory targets spreadsheet to custom template in Registry." },
    { name: "Customer Stock Template", module: "Sales & Orders", reason: "Tracked inside active CRM Pharmacy stock audit visits", action: "Establish Custom Stock template and upload structure in Registry for batch audits." },
    { name: "Product Updates Template", module: "Products", reason: "Incremental modifications completed directly in core CRM Product profiles", action: "None. Avoid spreadsheet imports for individual product profile changes." },
    { name: "Price Updates Template", module: "Products", reason: "Dynamic price lists managed in commercial workflow settings", action: "Create a Custom Price Update schema to support bulk product pricing updates." },
    { name: "Offers Template", module: "Sales & Orders", reason: "Bulk deal rules and promotional packages built in Offers workflow", action: "Register Custom Template matching commercial offers schema if needed." },

    // Medical
    { name: "Sample Requests Template", module: "Samples", reason: "Individual representative quota requests handled in live workflow logs", action: "Design spreadsheet schema matching medical supervisor approvals list." },
    { name: "Sample Inventory Template", module: "Samples", reason: "Central depot stock adjustments handled by Warehouse logs", action: "Establish sample inventory template matching depot database columns." },
    { name: "Marketing Activities Template", module: "Marketing", reason: "Events and symposium calendars logged directly inside Marketing module", action: "Map campaign marketing Excel columns and register under Marketing Category." },
    { name: "Marketing Requests Template", module: "Marketing", reason: "Ad-hoc budget requests handled via live multi-stage approval workflow", action: "Create a custom schema to represent historical marketing activity logs if bulk import is required." },
    { name: "Physician Updates Template", module: "Field Operations", reason: "Profile edits captured on-the-go with location validation checks", action: "None. Avoid spreadsheet imports for incremental profile updates." },
    { name: "Pharmacy Updates Template", module: "Pharmacies", reason: "Profile edits captured on-the-go with location validation checks", action: "None. Avoid spreadsheet imports for incremental profile updates." },

    // Logistics
    { name: "Stock Requests Template", module: "Sales & Orders", reason: "Representative stock requests created live inside sales CRM planner", action: "Establish custom stock request template for batch logistics." },
    { name: "Delivery Imports Template", module: "Operations", reason: "Logistics dispatches and waybills generated dynamically from active customer orders", action: "Map warehouse shipping spreadsheet and register as a custom Logistics template." },

    // Finance
    { name: "Receipts Template", module: "Finance", reason: "Payments tracked inside active payment ledger books", action: "Establish receipts spreadsheet schema in Registry if bulk ingestion is required." },
    { name: "Payments Template", module: "Finance", reason: "Payments tracked inside active payment ledger books", action: "Establish payments spreadsheet schema in Registry if bulk ingestion is required." },
    { name: "Credit Limits Template", module: "Finance", reason: "Adjustments managed within individual client account profiles", action: "Design dynamic credit limits spreadsheet mapping to Registry." },

    // Reporting
    { name: "Historical Sales Template", module: "Analytics", reason: "Populated by core relational transactional tables", action: "Register historical sales schema in Registry for importing legacy data." },
    { name: "Historical Orders Template", module: "Analytics", reason: "Populated by core relational transactional tables", action: "Register historical orders schema in Registry for importing legacy data." },
    { name: "Historical Visits Template", module: "Analytics", reason: "Populated by core relational transactional tables", action: "Register historical visits schema in Registry for importing legacy data." },
    { name: "Dashboard Imports Template", module: "Analytics", reason: "Pre-rendered KPI widgets are system-defined", action: "None. Avoid spreadsheet upload for layout and widgets definitions." },
    { name: "KPI Imports Template", module: "Analytics", reason: "Pre-rendered KPI widgets are system-defined", action: "None. Avoid spreadsheet upload for layout and widgets definitions." }
  ];

  // Dynamic Excel Schema Download Handler
  const handleDownload = (tpl: Template) => {
    if (!canDownload) {
      triggerAlert("error", t.lockedDesc);
      return;
    }

    try {
      // Sort fields by their columnOrder
      const sortedFields = [...tpl.fields].sort((a, b) => (a.columnOrder || 0) - (b.columnOrder || 0));
      const headers = sortedFields.map(f => f.displayName);
      
      // Validation hints row (to guide user on types & constraints)
      const validationRow = sortedFields.map(f => {
        const reqText = f.required ? "Required" : "Optional";
        const typeText = f.dataType.toUpperCase();
        const uniqueText = f.unique ? ", Unique" : "";
        const ruleText = f.validationRule ? `, Rule: ${f.validationRule}` : "";
        const optsText = (f.dataType === "enum" && f.options && f.options.length > 0) ? `, Options: [${f.options.join("/")}]` : "";
        return `(${typeText}, ${reqText}${uniqueText}${ruleText}${optsText})`;
      });

      // Sample mock data row matching properties
      const sampleRow = sortedFields.map(f => {
        if (f.defaultValue !== undefined) return f.defaultValue;
        if (f.dataType === "number") return 100;
        if (f.dataType === "boolean") return "TRUE";
        if (f.dataType === "date") return "2026-07-01";
        if (f.dataType === "enum" && f.options && f.options.length > 0) return f.options[0];
        if (f.fieldName === "email" || f.fieldName.endsWith("Email")) return "operator@example.com";
        return `Sample ${f.displayName}`;
      });

      const data = [
        headers,
        validationRow,
        sampleRow
      ];

      // Build worksheet and save workbook
      const ws = XLSX.utils.aoa_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, tpl.templateName.substring(0, 30));
      
      const fileName = `${tpl.templateId}_official_v${tpl.version}.xlsx`;
      XLSX.writeFile(wb, fileName);
      
      triggerAlert("success", `Spreadsheet template '${fileName}' generated and downloaded successfully.`);
    } catch (err: any) {
      console.error(err);
      triggerAlert("error", "Failed to generate Excel template. Please check configuration.");
    }
  };

  // Launch CRM Import Handler
  const handleLaunchImport = (tpl: Template) => {
    // Map templateId to Import central expected modules
    const importMapping: Record<string, "Users" | "Physicians" | "Pharmacies" | "Products" | "Key Messages"> = {
      "users": "Users",
      "products": "Products",
      "physicians": "Physicians",
      "pharmacies": "Pharmacies",
      "keymessages": "Key Messages"
    };

    const targetModule = importMapping[tpl.templateId];
    if (targetModule) {
      localStorage.setItem("menareps_preselected_import_module", targetModule);
      triggerAlert("success", t.importSuccessRoute);
      setTimeout(() => {
        setActiveView("admin-data-import");
      }, 1500);
    } else {
      triggerAlert("error", isRtl 
        ? `عذراً، الوحدة (${tpl.moduleName}) لا تدعم الاستيراد المباشر عبر هذا المركز حالياً.` 
        : `Import handler for module '${tpl.moduleName}' is managed within its specific operations console.`);
    }
  };

  return (
    <div className="space-y-6" id="template-catalog-root" dir={isRtl ? "rtl" : "ltr"}>
      
      {/* Title & Stats Banner */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between border-b border-slate-200 dark:border-slate-800 pb-5" id="catalog-title-banner">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
            <FileSpreadsheet className="text-blue-600 dark:text-blue-400" size={26} />
            {t.title}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {t.subtitle}
          </p>
        </div>
        
        {/* Simple Badge Indicators */}
        <div className="flex items-center gap-3 mt-4 md:mt-0" id="catalog-header-badges">
          <div className="bg-blue-50 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900/60 rounded-xl px-4 py-2 text-center">
            <span className="block text-xxs text-slate-400 uppercase font-mono">{isRtl ? "القوالب المسجلة" : "Registered"}</span>
            <span className="text-sm font-bold text-blue-600 dark:text-blue-400 font-mono">{templates.length}</span>
          </div>
          <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-100 dark:border-amber-900/60 rounded-xl px-4 py-2 text-center">
            <span className="block text-xxs text-slate-400 uppercase font-mono">{isRtl ? "المستندات المفقودة" : "Gaps Discovered"}</span>
            <span className="text-sm font-bold text-amber-600 dark:text-amber-400 font-mono">{missingTemplatesList.length}</span>
          </div>
        </div>
      </div>

      {/* Tabs Controller */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 overflow-x-auto scrollbar-none" id="catalog-navigation-tabs">
        <button
          onClick={() => setActiveTab("catalog")}
          className={`flex items-center gap-2 px-5 py-3 text-xs font-bold border-b-2 transition-all shrink-0 cursor-pointer ${
            activeTab === "catalog" 
              ? "border-blue-600 text-blue-600 dark:text-blue-400 font-extrabold" 
              : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
          id="tab-btn-catalog"
        >
          <Compass size={14} />
          {t.catalogTab}
        </button>

        <button
          onClick={() => setActiveTab("gap-analysis")}
          className={`flex items-center gap-2 px-5 py-3 text-xs font-bold border-b-2 transition-all shrink-0 cursor-pointer ${
            activeTab === "gap-analysis" 
              ? "border-blue-600 text-blue-600 dark:text-blue-400 font-extrabold" 
              : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
          id="tab-btn-gap"
        >
          <FileText size={14} />
          {t.gapTab}
        </button>

        {isAdmin && (
          <button
            onClick={() => setActiveTab("management")}
            className={`flex items-center gap-2 px-5 py-3 text-xs font-bold border-b-2 transition-all shrink-0 cursor-pointer ${
              activeTab === "management" 
                ? "border-blue-600 text-blue-600 dark:text-blue-400 font-extrabold" 
                : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
            }`}
            id="tab-btn-management"
          >
            <ShieldCheck size={14} />
            {t.adminTab}
          </button>
        )}
      </div>

      {/* Alert Notifications */}
      {alert && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className={`p-3.5 rounded-xl border flex items-center gap-2.5 text-xs font-medium font-sans ${
            alert.type === "success" 
              ? "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-100 dark:border-emerald-900/60 text-emerald-800 dark:text-emerald-400" 
              : "bg-red-50 dark:bg-red-950/20 border-red-100 dark:border-red-900/60 text-red-800 dark:text-red-400"
          }`}
          id="catalog-notification-banner"
        >
          {alert.type === "success" ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
          <span>{alert.msg}</span>
        </motion.div>
      )}

      {/* RENDER TAB 1: CATALOG LISTING */}
      {activeTab === "catalog" && (
        <div className="space-y-6" id="catalog-tab-view">
          
          {/* Security Alert if not allowed to download */}
          {!canDownload && (
            <div className="p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 rounded-xl flex gap-3" id="catalog-lockout-banner">
              <Lock className="text-amber-600 dark:text-amber-400 shrink-0" size={18} />
              <div>
                <strong className="text-xs font-bold text-amber-800 dark:text-amber-400 block">{t.lockedMsg}</strong>
                <p className="text-[11px] text-amber-700 dark:text-amber-500 mt-0.5 leading-relaxed">{t.lockedDesc}</p>
              </div>
            </div>
          )}

          {/* Search and Filters Bar */}
          <div className="flex flex-col sm:flex-row gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 p-3 rounded-xl shadow-xs" id="catalog-filter-bar">
            {/* Search Input */}
            <div className="relative flex-1">
              <Search className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" size={14} />
              <input
                type="text"
                placeholder={t.searchPlaceholder}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full text-xs pl-9 pr-4 py-2 border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                id="catalog-search-input"
              />
            </div>
            
            {/* Category Filter */}
            <div className="flex items-center gap-2">
              <SlidersHorizontal size={14} className="text-slate-400" />
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="text-xs border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 rounded-lg px-3 py-2 focus:outline-none"
                id="catalog-category-select"
              >
                <option value="All">{t.allCategories}</option>
                <option value="MASTER DATA">MASTER DATA</option>
                <option value="COMMERCIAL">COMMERCIAL</option>
                <option value="FIELD FORCE">FIELD FORCE</option>
                <option value="LOGISTICS">LOGISTICS</option>
                <option value="FINANCIAL">FINANCIAL</option>
                <option value="REPORTING">REPORTING</option>
              </select>
            </div>
          </div>

          {/* Templates Cards Grid */}
          {filteredTemplates.length === 0 ? (
            <div className="text-center py-12 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl bg-white dark:bg-slate-900/20" id="catalog-empty">
              <AlertCircle className="mx-auto text-slate-300 dark:text-slate-600 mb-2" size={32} />
              <p className="text-xs text-slate-500 dark:text-slate-400 font-sans">{t.noResults}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5" id="catalog-cards-grid">
              {filteredTemplates.map((tpl) => {
                const isCustom = tpl.templateId.startsWith("custom_");
                return (
                  <div 
                    key={tpl.templateId} 
                    className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-850 rounded-2xl p-5 shadow-xs flex flex-col justify-between hover:shadow-md hover:border-slate-300 dark:hover:border-slate-800 transition-all duration-200 group relative overflow-hidden"
                    id={`tpl-card-${tpl.templateId}`}
                  >
                    {/* Top Section */}
                    <div>
                      {/* Badge category */}
                      <div className="flex items-center justify-between gap-2 mb-3">
                        <span className="text-[9px] font-mono font-bold bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 px-2 py-0.5 rounded-md uppercase">
                          {tpl.category}
                        </span>
                        
                        {/* Status Badge */}
                        <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded-md ${
                          tpl.status === "Active" 
                            ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400" 
                            : tpl.status === "Archived"
                            ? "bg-slate-100 dark:bg-slate-800 text-slate-400"
                            : "bg-blue-50 dark:bg-blue-950/20 text-blue-500"
                        }`}>
                          {tpl.status === "Active" ? (isRtl ? "نشط" : "Active") : tpl.status === "Archived" ? (isRtl ? "مؤرشف" : "Archived") : (isRtl ? "مسودة" : "Draft")}
                        </span>
                      </div>

                      {/* Code and Name */}
                      <div className="space-y-1">
                        <span className="text-[10px] font-mono text-blue-600 dark:text-blue-400 font-bold block">
                          {tpl.templateCode}
                        </span>
                        <h3 className="text-sm font-bold text-slate-800 dark:text-white font-sans tracking-tight group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                          {tpl.templateName}
                        </h3>
                      </div>

                      {/* Description */}
                      <p className="text-xxs text-slate-500 dark:text-slate-400 font-sans mt-2.5 leading-relaxed line-clamp-3">
                        {tpl.description || (isRtl ? "لا يوجد وصف محدد لهذا المخطط." : "No description mapped for this schema.")}
                      </p>

                      {/* Metadata Table */}
                      <div className="border-t border-slate-100 dark:border-slate-800/80 pt-3 mt-4 space-y-1.5 text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                        <div className="flex justify-between">
                          <span>{t.module}:</span>
                          <span className="font-sans font-semibold text-slate-700 dark:text-slate-300">{tpl.moduleName}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>{t.version}:</span>
                          <span className="font-bold text-slate-800 dark:text-slate-200">{tpl.version}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>{t.lastUpdated}:</span>
                          <span>{tpl.updatedAt ? tpl.updatedAt.split("T")[0] : "2026-07-01"}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>{t.fieldsCount}:</span>
                          <span className="font-bold text-slate-700 dark:text-slate-300">{(tpl.fields || []).length}</span>
                        </div>
                      </div>
                    </div>

                    {/* Bottom Action Area */}
                    <div className="border-t border-slate-100 dark:border-slate-800/80 pt-4 mt-5 space-y-2">
                      
                      {/* Preview Fields Option */}
                      <button
                        onClick={() => setSelectedTemplateForPreview(tpl)}
                        className="w-full py-1.5 rounded-lg border border-slate-150 dark:border-slate-800 text-slate-600 dark:text-slate-300 text-xxs font-bold hover:bg-slate-50 dark:hover:bg-slate-950 flex items-center justify-center gap-1.5 cursor-pointer"
                        id={`btn-preview-${tpl.templateId}`}
                      >
                        <Eye size={12} />
                        {t.detailsPreview}
                      </button>

                      {/* Download & Launch Import Rows */}
                      <div className="flex gap-2">
                        {/* Download button */}
                        <button
                          onClick={() => handleDownload(tpl)}
                          disabled={!canDownload}
                          className={`flex-1 py-2 text-xxs font-bold rounded-lg border flex items-center justify-center gap-1.5 transition-all ${
                            canDownload 
                              ? "bg-blue-50 border-blue-100 text-blue-600 hover:bg-blue-100 dark:bg-blue-950/20 dark:border-blue-900/60 dark:text-blue-400 dark:hover:bg-blue-950/50 cursor-pointer" 
                              : "bg-slate-50 dark:bg-slate-950 border-slate-100 dark:border-slate-850 text-slate-400 dark:text-slate-600 cursor-not-allowed"
                          }`}
                          title={!canDownload ? t.authRequired : ""}
                          id={`btn-download-${tpl.templateId}`}
                        >
                          {canDownload ? <Download size={12} /> : <Lock size={11} />}
                          {t.downloadTemplate.split(" ")[0]}
                        </button>

                        {/* Import Button */}
                        <button
                          onClick={() => handleLaunchImport(tpl)}
                          className="flex-1 py-2 bg-slate-900 dark:bg-slate-800 hover:bg-black dark:hover:bg-slate-750 text-white text-xxs font-bold rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer border border-transparent"
                          id={`btn-import-${tpl.templateId}`}
                        >
                          <Upload size={12} />
                          {t.launchImport.split(" ")[0]}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* PREVIEW SCHEMA MODAL DIALOG */}
          {selectedTemplateForPreview && (
            <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4" id="schema-preview-modal-overlay">
              <motion.div 
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-2xl overflow-hidden shadow-xl"
                id="schema-preview-modal-box"
              >
                {/* Header */}
                <div className="border-b border-slate-100 dark:border-slate-800 p-5 flex items-center justify-between" id="preview-modal-header">
                  <div>
                    <span className="text-xxs font-mono text-blue-500 font-bold uppercase">{selectedTemplateForPreview.templateCode} v{selectedTemplateForPreview.version}</span>
                    <h3 className="text-base font-bold text-slate-900 dark:text-white font-sans">{selectedTemplateForPreview.templateName}</h3>
                  </div>
                  <button
                    onClick={() => setSelectedTemplateForPreview(null)}
                    className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-950 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
                    id="btn-close-modal"
                  >
                    &times;
                  </button>
                </div>

                {/* Content Table */}
                <div className="p-5 max-h-[400px] overflow-y-auto scrollbar-thin" id="preview-modal-table-container">
                  <table className="w-full text-left text-xxs font-mono" dir="ltr">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-400">
                        <th className="py-2.5 font-bold uppercase">{isRtl ? "اسم العمود بالملف" : "Excel Column"}</th>
                        <th className="py-2.5 font-bold uppercase">{isRtl ? "نوع البيانات" : "Type"}</th>
                        <th className="py-2.5 font-bold uppercase">{isRtl ? "إلزامي" : "Required"}</th>
                        <th className="py-2.5 font-bold uppercase">{isRtl ? "تفاصيل إضافية" : "Constraints / Rules"}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-slate-700 dark:text-slate-300">
                      {[...selectedTemplateForPreview.fields].sort((a,b) => (a.columnOrder - b.columnOrder)).map((f, i) => (
                        <tr key={i} className="hover:bg-slate-50/50 dark:hover:bg-slate-950/20">
                          <td className="py-3 font-sans font-bold text-slate-800 dark:text-white">{f.displayName}</td>
                          <td className="py-3 font-bold text-blue-600 dark:text-blue-400">{f.dataType.toUpperCase()}</td>
                          <td className="py-3">
                            <span className={`px-2 py-0.5 rounded-md font-bold text-[9px] ${
                              f.required 
                                ? "bg-red-50 dark:bg-red-950/20 text-red-600 dark:text-red-400" 
                                : "bg-slate-100 dark:bg-slate-800 text-slate-400"
                            }`}>
                              {f.required ? (isRtl ? "نعم" : "YES") : (isRtl ? "لا" : "NO")}
                            </span>
                          </td>
                          <td className="py-3 max-w-[200px] truncate" title={f.options?.join(", ")}>
                            {f.unique && <span className="inline-block mr-2 text-amber-600 dark:text-amber-400 font-bold text-[9px] uppercase">[Unique]</span>}
                            {f.validationRule && <span className="inline-block mr-2 text-slate-400 font-sans italic text-[9px]">{f.validationRule}</span>}
                            {f.options && f.options.length > 0 && (
                              <span className="text-slate-400">Options: {f.options.slice(0, 3).join("/")}{f.options.length > 3 ? "..." : ""}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Footer buttons */}
                <div className="border-t border-slate-100 dark:border-slate-800 p-4 bg-slate-50 dark:bg-slate-950 flex justify-end gap-2" id="preview-modal-footer">
                  <button
                    onClick={() => {
                      const tpl = selectedTemplateForPreview;
                      setSelectedTemplateForPreview(null);
                      handleDownload(tpl);
                    }}
                    disabled={!canDownload}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-xxs font-bold rounded-lg flex items-center gap-1 cursor-pointer"
                    id="btn-modal-download"
                  >
                    <Download size={12} />
                    {t.downloadTemplate}
                  </button>
                  <button
                    onClick={() => {
                      const tpl = selectedTemplateForPreview;
                      setSelectedTemplateForPreview(null);
                      handleLaunchImport(tpl);
                    }}
                    className="px-4 py-2 bg-slate-900 hover:bg-black dark:bg-slate-800 dark:hover:bg-slate-700 text-white text-xxs font-bold rounded-lg flex items-center gap-1 cursor-pointer"
                    id="btn-modal-import"
                  >
                    <Upload size={12} />
                    {t.launchImport}
                  </button>
                </div>
              </motion.div>
            </div>
          )}

        </div>
      )}

      {/* RENDER TAB 2: REGISTRY SCHEMA MANAGEMENT (Admin only) */}
      {activeTab === "management" && isAdmin && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-850 p-6 rounded-2xl shadow-xs" id="management-tab-view">
          <TemplateRegistryManager 
            currentUser={currentUser}
            lang={lang}
            onRefreshGlobalData={async () => {
              const list = await getTemplates();
              setTemplates(list);
            }}
          />
        </div>
      )}

      {/* RENDER TAB 3: GAP ANALYSIS REPORT */}
      {activeTab === "gap-analysis" && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-850 rounded-2xl p-6 shadow-xs space-y-6" id="gap-analysis-tab-view">
          
          {/* Section Header */}
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <AlertCircle className="text-amber-500" size={18} />
              {t.missingReportTitle}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
              {t.missingReportSubtitle}
            </p>
          </div>

          {/* Gap Analysis Listing Table */}
          <div className="overflow-x-auto border border-slate-150 dark:border-slate-800 rounded-xl" id="gap-analysis-table-wrapper">
            <table className="w-full text-left border-collapse" dir={isRtl ? "rtl" : "ltr"}>
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-950 border-b border-slate-150 dark:border-slate-800 text-[10px] text-slate-400 font-mono">
                  <th className="px-5 py-3.5 font-bold uppercase">{t.templateName}</th>
                  <th className="px-5 py-3.5 font-bold uppercase">{t.expectedModule}</th>
                  <th className="px-5 py-3.5 font-bold uppercase">{t.reasonMissing}</th>
                  <th className="px-5 py-3.5 font-bold uppercase">{t.recommendedAction}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xxs text-slate-600 dark:text-slate-300 font-sans">
                {missingTemplatesList.map((item, index) => (
                  <tr key={index} className="hover:bg-slate-50/40 dark:hover:bg-slate-950/10">
                    <td className="px-5 py-3.5 font-bold text-slate-800 dark:text-white font-mono">{item.name}</td>
                    <td className="px-5 py-3.5">
                      <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono font-bold text-[9px] text-slate-500 dark:text-slate-400">
                        {item.module}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 leading-relaxed">{isRtl ? "يتم التعامل مع السجلات برمجياً وتفاعلياً داخل سياق الـ CRM اليومي والميداني، بدلاً من الاعتماد على استيراد ملفات الإكسل." : item.reason}</td>
                    <td className="px-5 py-3.5 text-slate-500 dark:text-slate-400 leading-relaxed font-mono">
                      {isRtl ? "تعديل المخطط المعرف وإدراج الحقول يدوياً من علامة تبويب إدارة المخططات." : item.action}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Advisory warning */}
          <div className="p-4 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl flex gap-3" id="gap-analysis-advisory">
            <HelpCircle className="text-blue-500 shrink-0" size={18} />
            <p className="text-xxs text-slate-500 dark:text-slate-400 leading-relaxed">
              <strong>{isRtl ? "سياق الإغلاق والمطابقة" : "Compliance Advisory"}:</strong> {isRtl 
                ? "قوالب العمل المفقودة هي قوالب تشغيلية يتم التعامل مع حركاتها بشكل فوري وقواعد متكاملة تمنع الإغراق بالملفات العشوائية. إذا رغبت في تفعيل الاستيراد لأي فئة مفقودة، يمكنك ببساطة الضغط على 'إنشاء قالب جديد' في تبويب المخططات وتحديد الأعمدة المطلوبة."
                : "The missing operational templates correspond to workflows managed interactively via standard database logic. If bulk ingestion is required for legacy data migrations, admins can manually initialize and map custom templates under the Registry Management tab to bridge the gap."}
            </p>
          </div>

        </div>
      )}

    </div>
  );
}
