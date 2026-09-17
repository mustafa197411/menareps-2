import React, { useState, useEffect } from "react";
import { 
  Database, 
  Plus, 
  Search, 
  SlidersHorizontal, 
  Clock, 
  GitBranch, 
  FileCheck, 
  ShieldCheck, 
  HelpCircle, 
  ArrowRight, 
  Trash2, 
  Check, 
  X, 
  AlertTriangle,
  Download,
  Upload,
  Layers,
  ChevronRight,
  Info
} from "lucide-react";
import { Role, User } from "../types";
import { motion } from "motion/react";
import { 
  Template, 
  TemplateField, 
  TemplateHistory, 
  getTemplates, 
  saveTemplate, 
  logTemplateHistory, 
  getTemplateHistory,
  deployNewTemplateVersionTransactional,
  rollbackTemplateVersionTransactional
} from "../lib/templateRegistry";
import { syncLiveTemplatesToSchemas } from "../lib/schemaEngine";

interface TemplateRegistryManagerProps {
  currentUser: User;
  lang: "en" | "ar";
  onRefreshGlobalData?: () => void;
}

export default function TemplateRegistryManager({
  currentUser,
  lang,
  onRefreshGlobalData
}: TemplateRegistryManagerProps) {
  const isRtl = lang === "ar";
  const isAdmin = currentUser.role === Role.SUPER_ADMIN || currentUser.role === Role.ADMIN;

  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"fields" | "versions" | "compare">("fields");

  // Version history & Comparison state
  const [versionHistory, setVersionHistory] = useState<TemplateHistory[]>([]);
  const [compareVersionA, setCompareVersionA] = useState("");
  const [compareVersionB, setCompareVersionB] = useState("");

  // Edit / Form states
  const [isEditingTemplateMeta, setIsEditingTemplateMeta] = useState(false);
  const [metaForm, setMetaForm] = useState({
    templateName: "",
    templateCode: "",
    description: "",
    category: "MASTER DATA" as any,
    ownerRole: "Super Admin"
  });

  // Fields editor state
  const [editingFieldIdx, setEditingFieldIdx] = useState<number | null>(null);
  const [fieldForm, setFieldForm] = useState<TemplateField>({
    fieldName: "",
    displayName: "",
    columnOrder: 1,
    dataType: "string",
    required: false,
    unique: false,
    searchable: true,
    filterable: true,
    sortable: true,
    editable: true,
    visibleInList: true,
    visibleInForm: true,
    visibleInImport: true,
    visibleInExport: true,
    visibleInReports: true,
    visibleInDashboard: true,
    options: []
  });
  const [newOptionVal, setNewOptionVal] = useState("");

  // New Version State
  const [isCreatingNewVersion, setIsCreatingNewVersion] = useState(false);
  const [newVersionForm, setNewVersionForm] = useState({
    versionNumber: "",
    changelog: ""
  });

  // Success / Alert Messages
  const [alert, setAlert] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  // Initialize
  useEffect(() => {
    loadRegistryData();
  }, []);

  const loadRegistryData = async () => {
    setLoading(true);
    const list = await getTemplates();
    setTemplates(list);
    syncLiveTemplatesToSchemas(list);
    setLoading(false);
  };

  useEffect(() => {
    if (selectedTemplate) {
      loadHistory(selectedTemplate.templateId);
    }
  }, [selectedTemplate]);

  const loadHistory = async (tid: string) => {
    const hist = await getTemplateHistory(tid);
    setVersionHistory(hist);
    if (hist.length > 0) {
      setCompareVersionA(hist[0].version);
      setCompareVersionB(hist[1]?.version || hist[0].version);
    }
  };

  const triggerAlert = (type: "success" | "error", msg: string) => {
    setAlert({ type, msg });
    setTimeout(() => setAlert(null), 4000);
  };

  // Helper translations
  const t = {
    en: {
      title: "Enterprise Template Registry",
      subtitle: "Configure dynamic worksheets, field definition validations, and compliance schemas",
      search: "Search templates...",
      category: "Category",
      all: "All Categories",
      code: "Code",
      version: "Version",
      status: "Status",
      owner: "Owner Role",
      fieldsCount: "Fields Defined",
      readOnlyWarning: "You are viewing in Read-Only mode. Only Administrators can update enterprise schemas.",
      fieldsTab: "Field definitions",
      versionsTab: "Version Control History",
      compareTab: "Compare Schema Changes",
      newField: "Add Field Schema",
      editField: "Edit Field Definition",
      saveField: "Save Field",
      deleteField: "Delete Field",
      fieldName: "Field Identifier",
      displayName: "Excel Column Header",
      columnOrder: "Column Order Index",
      dataType: "Data Type",
      required: "Required Value",
      unique: "Unique Constraint",
      enumOpts: "Enum Selectable Options",
      addOpt: "Add Option",
      saveTemplate: "Publish Active Template Configuration",
      newVersion: "Deploy New Schema Version",
      versionLabel: "New Version Number (e.g. 1.1.0)",
      changelogLabel: "Changelog and Modifications Summary",
      commitVersion: "Deploy Version",
      compareA: "Baseline Version (A)",
      compareB: "Comparison Target (B)",
      active: "Active",
      archived: "Archived",
      draft: "Draft",
      createTemplateBtn: "Create New Template Structure",
      templateId: "Template System ID",
      templateName: "Template Name",
      moduleName: "CRM Module Name",
      description: "Business Purpose & Context"
    },
    ar: {
      title: "سجل قوالب إكسل المؤسسية",
      subtitle: "تكوين أوراق العمل الديناميكية، التحقق من الحقول الفردية، وتحديد مخططات المطابقة والامتثال",
      search: "البحث في القوالب السارية...",
      category: "التصنيف",
      all: "جميع التصنيفات",
      code: "رمز القالب",
      version: "الإصدار",
      status: "الحالة",
      owner: "الدور الوظيفي المالك",
      fieldsCount: "الحقول المعرفة",
      readOnlyWarning: "أنت تتصفح القوالب بصلاحية العرض فقط. تعديل المخططات متاح لمدراء النظام الفيدراليين فقط.",
      fieldsTab: "محددات وتفاصيل الحقول",
      versionsTab: "إدارة وإصدار النسخ التاريخية",
      compareTab: "مقارنة الفروقات بين النسخ",
      newField: "إضافة حقل جديد للمخطط",
      editField: "تعديل محددات الحقل",
      saveField: "حفظ الحقل",
      deleteField: "حذف الحقل",
      fieldName: "معرف الحقل التقني",
      displayName: "رأس عمود Excel (الظاهر للعميل)",
      columnOrder: "ترتيب العمود في ورقة العمل",
      dataType: "نوع البيانات",
      required: "قيمة إلزامية",
      unique: "قيد عدم التكرار",
      enumOpts: "الخيارات المتاحة للقوائم المنسدلة",
      addOpt: "إضافة خيار",
      saveTemplate: "نشر وتطبيق إعدادات القالب الحالية",
      newVersion: "نشر إصدار جديد من المخطط",
      versionLabel: "رقم الإصدار الجديد (مثال: 1.1.0)",
      changelogLabel: "ملخص مبررات التعديل وسجل التغييرات",
      commitVersion: "اعتماد ونشر الإصدار",
      compareA: "النسخة المرجعية (A)",
      compareB: "نسخة المقارنة المستهدفة (B)",
      active: "نشط ومعتمد",
      archived: "مؤرشف",
      draft: "مسودة",
      createTemplateBtn: "إنشاء قالب إكسل جديد",
      templateId: "معرف القالب البرمجي",
      templateName: "اسم قالب العمل المعتمد",
      moduleName: "اسم الوحدة البرمجية للـ CRM",
      description: "وصف الغرض التشغيلي وسياق العمل"
    }
  }[lang];

  // Save Meta Data updates
  const handleSaveTemplateMeta = async () => {
    if (!selectedTemplate) return;
    const updated = {
      ...selectedTemplate,
      templateName: metaForm.templateName,
      templateCode: metaForm.templateCode,
      description: metaForm.description,
      category: metaForm.category,
      ownerRole: metaForm.ownerRole,
      updatedAt: new Date().toISOString(),
      updatedBy: currentUser.name
    };
    setSelectedTemplate(updated);
    setIsEditingTemplateMeta(false);
    
    // Save to global list
    const updatedTemplates = templates.map(t => t.templateId === updated.templateId ? updated : t);
    setTemplates(updatedTemplates);
    await saveTemplate(updated);
    syncLiveTemplatesToSchemas(updatedTemplates);
    triggerAlert("success", "Template general settings synchronized successfully.");
  };

  // Create new completely custom template structures
  const handleCreateNewTemplate = async () => {
    const newId = `custom_${Date.now()}`;
    const newTpl: Template = {
      templateId: newId,
      templateCode: "TPL-CST",
      templateName: "Custom Data Template",
      moduleName: "Custom Module",
      category: "COMMERCIAL",
      version: "1.0.0",
      status: "Active",
      active: true,
      description: "Custom user-defined dataset template matching organizational master spreadsheets.",
      ownerRole: currentUser.role,
      createdAt: new Date().toISOString(),
      createdBy: currentUser.name,
      updatedAt: new Date().toISOString(),
      updatedBy: currentUser.name,
      fields: [
        { fieldName: "recordId", displayName: "Record ID", columnOrder: 1, dataType: "string", required: true, unique: true, searchable: true, filterable: true, sortable: true, editable: true, visibleInList: true, visibleInForm: true, visibleInImport: true, visibleInExport: true, visibleInReports: true, visibleInDashboard: true }
      ]
    };

    const updatedList = [...templates, newTpl];
    setTemplates(updatedList);
    setSelectedTemplate(newTpl);
    await saveTemplate(newTpl);
    syncLiveTemplatesToSchemas(updatedList);
    triggerAlert("success", "Custom Template successfully registered into the Enterprise Registry.");
  };

  // Add field or Edit Field submit
  const handleFieldFormSubmit = () => {
    if (!selectedTemplate) return;
    let updatedFields = [...selectedTemplate.fields];

    if (editingFieldIdx !== null) {
      // Edit mode
      updatedFields[editingFieldIdx] = { ...fieldForm };
    } else {
      // Create mode
      if (updatedFields.some(f => f.fieldName.toLowerCase() === fieldForm.fieldName.toLowerCase())) {
        triggerAlert("error", "A field with this tech identifier already exists.");
        return;
      }
      updatedFields.push({ ...fieldForm });
    }

    // Sort fields by order
    updatedFields.sort((a, b) => a.columnOrder - b.columnOrder);

    const updatedTpl = {
      ...selectedTemplate,
      fields: updatedFields,
      updatedAt: new Date().toISOString(),
      updatedBy: currentUser.name
    };

    setSelectedTemplate(updatedTpl);
    setEditingFieldIdx(null);
    setFieldForm({
      fieldName: "",
      displayName: "",
      columnOrder: updatedFields.length + 1,
      dataType: "string",
      required: false,
      unique: false,
      searchable: true,
      filterable: true,
      sortable: true,
      editable: true,
      visibleInList: true,
      visibleInForm: true,
      visibleInImport: true,
      visibleInExport: true,
      visibleInReports: true,
      visibleInDashboard: true,
      options: []
    });

    const updatedTemplates = templates.map(t => t.templateId === updatedTpl.templateId ? updatedTpl : t);
    setTemplates(updatedTemplates);
    saveTemplate(updatedTpl);
    syncLiveTemplatesToSchemas(updatedTemplates);
    triggerAlert("success", "Field definitions list updated successfully.");
  };

  const handleDeleteField = (idx: number) => {
    if (!selectedTemplate) return;
    const filtered = selectedTemplate.fields.filter((_, i) => i !== idx);
    const updatedTpl = {
      ...selectedTemplate,
      fields: filtered,
      updatedAt: new Date().toISOString(),
      updatedBy: currentUser.name
    };
    setSelectedTemplate(updatedTpl);
    const updatedTemplates = templates.map(t => t.templateId === updatedTpl.templateId ? updatedTpl : t);
    setTemplates(updatedTemplates);
    saveTemplate(updatedTpl);
    syncLiveTemplatesToSchemas(updatedTemplates);
    triggerAlert("success", "Field removed successfully.");
  };

  const handleCreateNewVersionSubmit = async () => {
    if (!selectedTemplate || !newVersionForm.versionNumber) return;

    try {
      const updatedTpl = await deployNewTemplateVersionTransactional(
        selectedTemplate.templateId,
        newVersionForm.versionNumber,
        newVersionForm.changelog || "Schema fields alignment.",
        currentUser.name,
        currentUser.id,
        currentUser.role
      );

      setSelectedTemplate(updatedTpl);
      setIsCreatingNewVersion(false);
      setNewVersionForm({ versionNumber: "", changelog: "" });

      const updatedTemplates = templates.map(t => t.templateId === updatedTpl.templateId ? updatedTpl : t);
      setTemplates(updatedTemplates);
      syncLiveTemplatesToSchemas(updatedTemplates);
      await loadHistory(selectedTemplate.templateId);

      triggerAlert("success", `New schema version ${updatedTpl.version} active and deployed to system.`);
    } catch (err: any) {
      console.error(err);
      triggerAlert("error", err.message || "Failed to deploy new template version due to conflict.");
    }
  };

  const handleRollbackToHistoricVersion = async (hist: TemplateHistory) => {
    if (!selectedTemplate) return;
    
    try {
      const updatedTpl = await rollbackTemplateVersionTransactional(
        selectedTemplate.templateId,
        hist,
        currentUser.name,
        currentUser.id,
        currentUser.role
      );

      setSelectedTemplate(updatedTpl);
      const updatedTemplates = templates.map(t => t.templateId === updatedTpl.templateId ? updatedTpl : t);
      setTemplates(updatedTemplates);
      syncLiveTemplatesToSchemas(updatedTemplates);
      await loadHistory(selectedTemplate.templateId);

      triggerAlert("success", `Successfully rolled back to version ${hist.version}.`);
    } catch (err: any) {
      console.error(err);
      triggerAlert("error", err.message || "Failed to rollback template version.");
    }
  };

  // Filter and search templates
  const filteredTemplates = templates.filter(t => {
    const matchesCat = categoryFilter === "All" || t.category === categoryFilter;
    const matchesSearch = t.templateName.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          t.templateCode.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          t.moduleName.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCat && matchesSearch;
  });

  // Calculate comparison highlights
  const getComparisonDiff = () => {
    const histA = versionHistory.find(h => h.version === compareVersionA)?.fields || selectedTemplate?.fields || [];
    const histB = versionHistory.find(h => h.version === compareVersionB)?.fields || [];

    const allKeys = Array.from(new Set([
      ...histA.map(f => f.fieldName),
      ...histB.map(f => f.fieldName)
    ]));

    return allKeys.map(key => {
      const fieldA = histA.find(f => f.fieldName === key);
      const fieldB = histB.find(f => f.fieldName === key);

      let status: "Unchanged" | "Added" | "Modified" | "Removed" = "Unchanged";
      let details = "";

      if (fieldA && !fieldB) {
        status = "Removed";
        details = `Field was deleted in version ${compareVersionB}`;
      } else if (!fieldA && fieldB) {
        status = "Added";
        details = `Field was created in version ${compareVersionB}`;
      } else if (fieldA && fieldB) {
        const changedProps = [];
        if (fieldA.displayName !== fieldB.displayName) changedProps.push("Label");
        if (fieldA.dataType !== fieldB.dataType) changedProps.push("Type");
        if (fieldA.required !== fieldB.required) changedProps.push("Required status");
        if (fieldA.unique !== fieldB.unique) changedProps.push("Uniqueness");

        if (changedProps.length > 0) {
          status = "Modified";
          details = `Changed: ${changedProps.join(", ")}`;
        }
      }

      return {
        key,
        fieldA,
        fieldB,
        status,
        details
      };
    });
  };

  return (
    <div className="space-y-6" id="template-registry-manager" dir={isRtl ? "rtl" : "ltr"}>
      
      {/* Upper Title Header */}
      <div className="border-b border-slate-100 dark:border-slate-800 pb-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4" id="tpl-manager-header">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
            <Layers className="text-blue-600 shrink-0" size={24} />
            {t.title}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {t.subtitle}
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={handleCreateNewTemplate}
            className="px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-xs font-bold rounded-lg shadow-sm hover:from-blue-700 hover:to-indigo-700 transition-all flex items-center gap-1.5 cursor-pointer"
            id="btn-create-template"
          >
            <Plus size={14} />
            {t.createTemplateBtn}
          </button>
        )}
      </div>

      {/* Security alert / Read-only warning */}
      {!isAdmin && (
        <div className="p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900 text-xxs font-semibold text-amber-700 dark:text-amber-400 rounded-lg flex items-center gap-2" id="readonly-warning-banner">
          <Info size={14} />
          <span>{t.readOnlyWarning}</span>
        </div>
      )}

      {/* Alert Banner */}
      {alert && (
        <div className={`p-4 rounded-lg text-xs font-bold flex items-center gap-2 ${alert.type === "success" ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900" : "bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400 border border-rose-100 dark:border-rose-900"}`} id="registry-alert-banner">
          <Check size={16} />
          <span>{alert.msg}</span>
        </div>
      )}

      {/* Top filter section */}
      <div className="flex flex-col md:flex-row gap-3 bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-100 dark:border-slate-800 shadow-3xs" id="tpl-filters-panel">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 text-slate-400 dark:text-slate-500" size={16} />
          <input
            type="text"
            placeholder={t.search}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-xs bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-hidden focus:border-blue-500 text-slate-800 dark:text-slate-100"
            id="tpl-search-input"
          />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <SlidersHorizontal size={14} className="text-slate-400" />
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-hidden text-slate-700 dark:text-slate-300"
            id="tpl-category-select"
          >
            <option value="All">{t.all}</option>
            <option value="MASTER DATA">MASTER DATA</option>
            <option value="COMMERCIAL">COMMERCIAL</option>
            <option value="FIELD FORCE">FIELD FORCE</option>
            <option value="LOGISTICS">LOGISTICS</option>
            <option value="FINANCIAL">FINANCIAL</option>
            <option value="REPORTING">REPORTING</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6" id="registry-layout-grid">
        
        {/* Sidebar Templates List */}
        <div className="lg:col-span-1 space-y-3 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-4 max-h-[600px] overflow-y-auto" id="templates-list-sidebar">
          <h2 className="text-xxs font-mono text-slate-400 uppercase tracking-wider mb-2 font-bold">
            Registered Templates ({filteredTemplates.length})
          </h2>
          {loading ? (
            <div className="py-10 text-center text-xs text-slate-400">Loading templates registry...</div>
          ) : filteredTemplates.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-400">No template matches found.</div>
          ) : (
            <div className="space-y-1.5" id="tpl-list-group">
              {filteredTemplates.map((tpl) => {
                const isSelected = selectedTemplate?.templateId === tpl.templateId;
                return (
                  <button
                    key={tpl.templateId}
                    onClick={() => {
                      setSelectedTemplate(tpl);
                      setEditingFieldIdx(null);
                      setIsEditingTemplateMeta(false);
                      setIsCreatingNewVersion(false);
                      setMetaForm({
                        templateName: tpl.templateName,
                        templateCode: tpl.templateCode,
                        description: tpl.description,
                        category: tpl.category,
                        ownerRole: tpl.ownerRole
                      });
                    }}
                    className={`w-full text-left p-3 rounded-lg border text-xs transition-all flex flex-col gap-1.5 ${isSelected ? "border-blue-600 bg-blue-50/10" : "border-slate-100 dark:border-slate-800 hover:bg-slate-50/40"}`}
                    id={`tpl-select-btn-${tpl.templateId}`}
                  >
                    <div className="flex justify-between items-start w-full">
                      <span className="font-bold text-slate-800 dark:text-slate-100">{tpl.templateName}</span>
                      <span className="px-1.5 py-0.2 bg-slate-100 dark:bg-slate-800 text-[10px] font-mono text-slate-500 rounded uppercase">
                        {tpl.templateCode}
                      </span>
                    </div>
                    <p className="text-xxs text-slate-400 truncate max-w-xs">{tpl.description}</p>
                    <div className="flex justify-between items-center text-[10px] text-slate-400 mt-1 font-mono">
                      <span>Ver: {tpl.version}</span>
                      <span className="bg-blue-50 dark:bg-blue-950/40 text-blue-500 px-1 py-0.2 rounded font-bold uppercase">{tpl.category}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Detailed Workspace Editor */}
        <div className="lg:col-span-3 space-y-6" id="template-editor-panel">
          {selectedTemplate ? (
            <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-5 space-y-6" id="tpl-workspace-box">
              
              {/* Template Meta Information Section */}
              <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 p-4 rounded-xl space-y-3" id="selected-tpl-meta-info">
                {isEditingTemplateMeta ? (
                  <div className="space-y-3 text-xs" id="meta-editor-form">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xxs font-mono uppercase text-slate-400 mb-1">{t.templateName}</label>
                        <input
                          type="text"
                          value={metaForm.templateName}
                          onChange={(e) => setMetaForm({ ...metaForm, templateName: e.target.value })}
                          className="w-full px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded"
                        />
                      </div>
                      <div>
                        <label className="block text-xxs font-mono uppercase text-slate-400 mb-1">{t.code}</label>
                        <input
                          type="text"
                          value={metaForm.templateCode}
                          onChange={(e) => setMetaForm({ ...metaForm, templateCode: e.target.value })}
                          className="w-full px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xxs font-mono uppercase text-slate-400 mb-1">{t.description}</label>
                      <textarea
                        value={metaForm.description}
                        onChange={(e) => setMetaForm({ ...metaForm, description: e.target.value })}
                        className="w-full px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded h-16 resize-none"
                      />
                    </div>
                    <div className="flex justify-end gap-2 pt-1">
                      <button
                        onClick={() => setIsEditingTemplateMeta(false)}
                        className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded hover:bg-slate-200"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSaveTemplateMeta}
                        className="px-4 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 font-bold"
                      >
                        Save Info
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2" id="meta-viewer-pane">
                    <div className="flex justify-between items-start">
                      <div>
                        <span className="text-[10px] font-bold text-blue-500 uppercase font-mono bg-blue-50 dark:bg-blue-950/40 px-2 py-0.5 rounded border border-blue-100 dark:border-blue-900/60">
                          {selectedTemplate.category}
                        </span>
                        <h2 className="text-base font-bold text-slate-900 dark:text-white mt-2">{selectedTemplate.templateName}</h2>
                      </div>
                      {isAdmin && (
                        <button
                          onClick={() => setIsEditingTemplateMeta(true)}
                          className="text-xs text-blue-600 hover:underline font-semibold cursor-pointer"
                        >
                          Configure general meta
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 leading-relaxed dark:text-slate-400">{selectedTemplate.description}</p>
                    <div className="flex flex-wrap gap-x-6 gap-y-1.5 text-xxs font-mono text-slate-400 pt-1.5 border-t border-slate-150 dark:border-slate-800">
                      <span>{t.code}: <strong className="text-slate-700 dark:text-slate-200">{selectedTemplate.templateCode}</strong></span>
                      <span>{t.version}: <strong className="text-slate-700 dark:text-slate-200">{selectedTemplate.version}</strong></span>
                      <span>{t.owner}: <strong className="text-slate-700 dark:text-slate-200">{selectedTemplate.ownerRole}</strong></span>
                      <span>{t.fieldsCount}: <strong className="text-slate-700 dark:text-slate-200">{selectedTemplate.fields.length}</strong></span>
                    </div>
                  </div>
                )}
              </div>

              {/* Sub tabs configuration / History */}
              <div className="border-b border-slate-100 dark:border-slate-800" id="tabs-bar">
                <div className="flex gap-4">
                  <button
                    onClick={() => setActiveTab("fields")}
                    className={`pb-3 text-xs font-bold transition-colors border-b-2 relative ${activeTab === "fields" ? "border-blue-600 text-blue-600" : "border-transparent text-slate-400 hover:text-slate-600"}`}
                  >
                    {t.fieldsTab}
                  </button>
                  <button
                    onClick={() => setActiveTab("versions")}
                    className={`pb-3 text-xs font-bold transition-colors border-b-2 relative ${activeTab === "versions" ? "border-blue-600 text-blue-600" : "border-transparent text-slate-400 hover:text-slate-600"}`}
                  >
                    {t.versionsTab} ({versionHistory.length})
                  </button>
                  <button
                    onClick={() => setActiveTab("compare")}
                    className={`pb-3 text-xs font-bold transition-colors border-b-2 relative ${activeTab === "compare" ? "border-blue-600 text-blue-600" : "border-transparent text-slate-400 hover:text-slate-600"}`}
                  >
                    {t.compareTab}
                  </button>
                </div>
              </div>

              {activeTab === "fields" && (
                <div className="space-y-5" id="tab-fields-content">
                  
                  {/* Dynamic Field Definition Form (Only visible if Admin or editing) */}
                  {isAdmin && (
                    <div className="bg-slate-50 dark:bg-slate-800/20 border border-slate-150 dark:border-slate-800/80 p-4 rounded-xl space-y-4" id="field-editor-box">
                      <h3 className="text-xs font-bold text-slate-800 dark:text-white uppercase font-mono tracking-wider">
                        {editingFieldIdx !== null ? t.editField : t.newField}
                      </h3>
                      
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs" id="field-form-inputs">
                        <div>
                          <label className="block text-xxs font-semibold uppercase text-slate-400 mb-1">{t.fieldName}</label>
                          <input
                            type="text"
                            placeholder="e.g. therapeuticArea"
                            value={fieldForm.fieldName}
                            disabled={editingFieldIdx !== null}
                            onChange={(e) => setFieldForm({ ...fieldForm, fieldName: e.target.value })}
                            className="w-full px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded disabled:opacity-50"
                          />
                        </div>
                        <div>
                          <label className="block text-xxs font-semibold uppercase text-slate-400 mb-1">{t.displayName}</label>
                          <input
                            type="text"
                            placeholder="e.g. Therapeutic Area"
                            value={fieldForm.displayName}
                            onChange={(e) => setFieldForm({ ...fieldForm, displayName: e.target.value })}
                            className="w-full px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded"
                          />
                        </div>
                        <div>
                          <label className="block text-xxs font-semibold uppercase text-slate-400 mb-1">{t.dataType}</label>
                          <select
                            value={fieldForm.dataType}
                            onChange={(e) => setFieldForm({ ...fieldForm, dataType: e.target.value as any })}
                            className="w-full px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded"
                          >
                            <option value="string">String (text)</option>
                            <option value="number">Number (numeric)</option>
                            <option value="boolean">Boolean (yes/no)</option>
                            <option value="enum">Enum (selectable list)</option>
                            <option value="date">Date</option>
                            <option value="array">Array</option>
                          </select>
                        </div>
                      </div>

                      {fieldForm.dataType === "enum" && (
                        <div className="p-3 bg-purple-50/50 dark:bg-purple-950/15 border border-purple-100 dark:border-purple-900 text-xs rounded-lg space-y-2" id="enum-options-panel">
                          <label className="block text-xxs font-bold text-purple-700 dark:text-purple-400 uppercase tracking-wider">{t.enumOpts}</label>
                          <div className="flex flex-wrap gap-1.5" id="options-chips-list">
                            {fieldForm.options?.map((opt, oIdx) => (
                              <span key={oIdx} className="px-2 py-0.5 bg-white dark:bg-slate-800 border border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300 rounded font-mono text-xxs flex items-center gap-1">
                                {opt}
                                <button
                                  type="button"
                                  onClick={() => setFieldForm({
                                    ...fieldForm,
                                    options: fieldForm.options?.filter((_, i) => i !== oIdx)
                                  })}
                                  className="hover:text-red-500 font-extrabold"
                                >
                                  ×
                                </button>
                              </span>
                            ))}
                          </div>
                          <div className="flex gap-2 max-w-sm">
                            <input
                              type="text"
                              placeholder="Add a custom option..."
                              value={newOptionVal}
                              onChange={(e) => setNewOptionVal(e.target.value)}
                              className="px-2 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-xs flex-1"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                if (!newOptionVal.trim()) return;
                                setFieldForm({
                                  ...fieldForm,
                                  options: [...(fieldForm.options || []), newOptionVal.trim()]
                                });
                                setNewOptionVal("");
                              }}
                              className="px-3 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded text-xs font-bold"
                            >
                              {t.addOpt}
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3 pt-2 text-xxs" id="checkbox-toggles-grid">
                        <label className="flex items-center gap-1.5 font-semibold text-slate-600 dark:text-slate-300">
                          <input type="checkbox" checked={fieldForm.required} onChange={(e) => setFieldForm({ ...fieldForm, required: e.target.checked })} />
                          Required
                        </label>
                        <label className="flex items-center gap-1.5 font-semibold text-slate-600 dark:text-slate-300">
                          <input type="checkbox" checked={fieldForm.unique} onChange={(e) => setFieldForm({ ...fieldForm, unique: e.target.checked })} />
                          Unique
                        </label>
                        <label className="flex items-center gap-1.5 font-semibold text-slate-600 dark:text-slate-300">
                          <input type="checkbox" checked={fieldForm.searchable} onChange={(e) => setFieldForm({ ...fieldForm, searchable: e.target.checked })} />
                          Searchable
                        </label>
                        <label className="flex items-center gap-1.5 font-semibold text-slate-600 dark:text-slate-300">
                          <input type="checkbox" checked={fieldForm.filterable} onChange={(e) => setFieldForm({ ...fieldForm, filterable: e.target.checked })} />
                          Filterable
                        </label>
                        <label className="flex items-center gap-1.5 font-semibold text-slate-600 dark:text-slate-300">
                          <input type="checkbox" checked={fieldForm.visibleInImport} onChange={(e) => setFieldForm({ ...fieldForm, visibleInImport: e.target.checked })} />
                          Importable
                        </label>
                        <label className="flex items-center gap-1.5 font-semibold text-slate-600 dark:text-slate-300">
                          <input type="checkbox" checked={fieldForm.visibleInExport} onChange={(e) => setFieldForm({ ...fieldForm, visibleInExport: e.target.checked })} />
                          Exportable
                        </label>
                      </div>

                      <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                        {editingFieldIdx !== null && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingFieldIdx(null);
                              setFieldForm({
                                fieldName: "",
                                displayName: "",
                                columnOrder: selectedTemplate.fields.length + 1,
                                dataType: "string",
                                required: false,
                                unique: false,
                                searchable: true,
                                filterable: true,
                                sortable: true,
                                editable: true,
                                visibleInList: true,
                                visibleInForm: true,
                                visibleInImport: true,
                                visibleInExport: true,
                                visibleInReports: true,
                                visibleInDashboard: true,
                                options: []
                              });
                            }}
                            className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded"
                          >
                            Cancel Edit
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={handleFieldFormSubmit}
                          className="px-5 py-1.5 bg-blue-600 text-white rounded font-bold hover:bg-blue-700 flex items-center gap-1"
                        >
                          <Check size={14} />
                          {t.saveField}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* List of current fields definitions */}
                  <div className="border border-slate-100 dark:border-slate-800 rounded-xl overflow-x-auto shadow-3xs" id="active-fields-list-table">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-slate-50 dark:bg-slate-800 border-b border-slate-150 text-slate-400 font-mono text-xxs uppercase tracking-wider">
                          <th className="p-3">Order</th>
                          <th className="p-3">Header (Display)</th>
                          <th className="p-3">Database Field</th>
                          <th className="p-3">Type</th>
                          <th className="p-3 text-center">Required</th>
                          <th className="p-3 text-center">Unique</th>
                          {isAdmin && <th className="p-3 text-right">Actions</th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-150 text-slate-700 dark:text-slate-300">
                        {selectedTemplate.fields.map((field, idx) => (
                          <tr key={idx} className="hover:bg-slate-50/20">
                            <td className="p-3 font-mono text-slate-400">{field.columnOrder}</td>
                            <td className="p-3 font-bold text-slate-900 dark:text-white">{field.displayName}</td>
                            <td className="p-3 font-mono text-xxs text-blue-600 dark:text-blue-400">{field.fieldName}</td>
                            <td className="p-3">
                              <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-[10px] rounded-full uppercase tracking-wider font-mono font-bold text-slate-500">
                                {field.dataType}
                              </span>
                            </td>
                            <td className="p-3 text-center">
                              {field.required ? <span className="inline-block px-1.5 py-0.2 bg-rose-50 text-rose-600 text-3xs font-extrabold rounded">YES</span> : <span className="text-slate-300">-</span>}
                            </td>
                            <td className="p-3 text-center">
                              {field.unique ? <span className="inline-block px-1.5 py-0.2 bg-amber-50 text-amber-600 text-3xs font-extrabold rounded">UNIQUE</span> : <span className="text-slate-300">-</span>}
                            </td>
                            {isAdmin && (
                              <td className="p-3 text-right">
                                <div className="flex justify-end gap-2">
                                  <button
                                    onClick={() => {
                                      setEditingFieldIdx(idx);
                                      setFieldForm({ ...field });
                                    }}
                                    className="text-xs text-blue-600 hover:underline font-semibold"
                                  >
                                    Edit
                                  </button>
                                  {selectedTemplate.fields.length > 1 && (
                                    <button
                                      onClick={() => handleDeleteField(idx)}
                                      className="text-xs text-rose-600 hover:underline font-semibold"
                                    >
                                      Remove
                                    </button>
                                  )}
                                </div>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                </div>
              )}

              {activeTab === "versions" && (
                <div className="space-y-5 animate-fade-in" id="tab-versions-content">
                  
                  {/* Create new version form (Deploy/Publish Version) */}
                  {isAdmin && !isCreatingNewVersion && (
                    <button
                      onClick={() => setIsCreatingNewVersion(true)}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg shadow-xs flex items-center gap-1.5 cursor-pointer"
                      id="btn-trigger-new-version"
                    >
                      <GitBranch size={14} />
                      {t.newVersion}
                    </button>
                  )}

                  {isCreatingNewVersion && (
                    <div className="p-4 bg-slate-50 dark:bg-slate-800/40 border border-slate-150 rounded-xl space-y-3 max-w-lg text-xs" id="new-version-form-panel">
                      <h4 className="font-bold text-slate-800 dark:text-white uppercase font-mono">{t.newVersion}</h4>
                      <div className="space-y-2">
                        <div>
                          <label className="block text-xxs font-bold uppercase text-slate-400 mb-1">{t.versionLabel}</label>
                          <input
                            type="text"
                            placeholder="e.g. 1.1.0"
                            value={newVersionForm.versionNumber}
                            onChange={(e) => setNewVersionForm({ ...newVersionForm, versionNumber: e.target.value })}
                            className="w-full px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-xxs font-bold uppercase text-slate-400 mb-1">{t.changelogLabel}</label>
                          <textarea
                            placeholder="e.g. Added monthly safety target constraints columns."
                            value={newVersionForm.changelog}
                            onChange={(e) => setNewVersionForm({ ...newVersionForm, changelog: e.target.value })}
                            className="w-full px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded h-20 resize-none"
                          />
                        </div>
                      </div>
                      <div className="flex justify-end gap-2 pt-1">
                        <button
                          onClick={() => setIsCreatingNewVersion(false)}
                          className="px-3 py-1.5 bg-slate-200 text-slate-700 rounded"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleCreateNewVersionSubmit}
                          className="px-4 py-1.5 bg-blue-600 text-white rounded font-bold hover:bg-blue-700"
                        >
                          {t.commitVersion}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Versions history timeline */}
                  <div className="space-y-4" id="version-timeline-list">
                    <div className="relative border-l border-slate-100 dark:border-slate-800 ml-3.5 pl-6 space-y-6">
                      
                      {/* Active active version */}
                      <div className="relative">
                        <span className="absolute -left-9 top-1.5 w-6 h-6 rounded-full bg-blue-600 border-4 border-white dark:border-slate-900 flex items-center justify-center">
                          <CheckCircleIcon size={10} className="text-white" />
                        </span>
                        <div className="bg-blue-50/20 dark:bg-blue-950/10 border border-blue-100 dark:border-blue-950/60 rounded-xl p-4 text-xs space-y-1">
                          <div className="flex justify-between items-center">
                            <span className="font-bold text-blue-700 dark:text-blue-400 font-mono">Version {selectedTemplate.version} (Active)</span>
                            <span className="text-xxs text-slate-400 font-mono">Last edited: {new Date(selectedTemplate.updatedAt).toLocaleDateString()}</span>
                          </div>
                          <p className="text-slate-600 dark:text-slate-300 text-xxs pt-1">Current dynamic live version. All imported worksheets validate against this version structure.</p>
                        </div>
                      </div>

                      {/* Historic versions archived */}
                      {versionHistory.map((hist, hIdx) => (
                        <div className="relative" key={hist.id}>
                          <span className="absolute -left-9 top-1.5 w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-800 border-4 border-white dark:border-slate-900 flex items-center justify-center">
                            <Clock size={10} className="text-slate-500" />
                          </span>
                          <div className="bg-slate-50/40 dark:bg-slate-800/20 border border-slate-100 dark:border-slate-850 rounded-xl p-4 text-xs space-y-2">
                            <div className="flex justify-between items-center">
                              <span className="font-bold text-slate-700 dark:text-slate-300 font-mono">Version {hist.version} (Archived)</span>
                              <span className="text-xxs text-slate-400 font-mono">{new Date(hist.updatedAt).toLocaleDateString()}</span>
                            </div>
                            <p className="text-slate-600 dark:text-slate-400 text-xxs leading-normal font-mono bg-white dark:bg-slate-900/60 p-2 rounded border border-slate-100 dark:border-slate-800">
                              Changelog: {hist.changeLog}
                            </p>
                            <div className="flex justify-between items-center text-xxs pt-1">
                              <span className="text-slate-400">Archived by: {hist.updatedBy} ({hist.fields.length} defined fields)</span>
                              {isAdmin && (
                                <button
                                  onClick={() => handleRollbackToHistoricVersion(hist)}
                                  className="text-blue-600 font-bold hover:underline"
                                >
                                  Rollback to this version
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}

                    </div>
                  </div>

                </div>
              )}

              {activeTab === "compare" && (
                <div className="space-y-4 animate-fade-in" id="tab-compare-content">
                  <div className="flex flex-col sm:flex-row gap-4 bg-slate-50 dark:bg-slate-800/40 p-4 rounded-xl border border-slate-100" id="compare-selection-header">
                    <div className="flex-1 text-xs">
                      <label className="block text-xxs font-mono uppercase text-slate-400 mb-1">{t.compareA}</label>
                      <select
                        value={compareVersionA}
                        onChange={(e) => setCompareVersionA(e.target.value)}
                        className="w-full px-2 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded font-mono"
                      >
                        <option value="current">Current Active ({selectedTemplate.version})</option>
                        {versionHistory.map(h => (
                          <option key={h.id} value={h.version}>Version {h.version} (Archived)</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center justify-center shrink-0 self-end py-2">
                      <ArrowRight size={14} className="text-slate-400" />
                    </div>
                    <div className="flex-1 text-xs">
                      <label className="block text-xxs font-mono uppercase text-slate-400 mb-1">{t.compareB}</label>
                      <select
                        value={compareVersionB}
                        onChange={(e) => setCompareVersionB(e.target.value)}
                        className="w-full px-2 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded font-mono"
                      >
                        <option value="current">Current Active ({selectedTemplate.version})</option>
                        {versionHistory.map(h => (
                          <option key={h.id} value={h.version}>Version {h.version} (Archived)</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Schema Difference Comparison Table */}
                  <div className="border border-slate-100 dark:border-slate-800 rounded-xl overflow-hidden shadow-3xs" id="diff-compare-table">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="bg-slate-50 dark:bg-slate-800 border-b border-slate-150 text-slate-400 font-mono text-xxs uppercase tracking-wider">
                          <th className="p-3">Field Key</th>
                          <th className="p-3">Baseline Header</th>
                          <th className="p-3">Target Header</th>
                          <th className="p-3">Status Diff</th>
                          <th className="p-3">Details / Modifications</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-150 text-slate-700 dark:text-slate-300">
                        {getComparisonDiff().map((diff) => (
                          <tr key={diff.key} className="hover:bg-slate-50/20">
                            <td className="p-3 font-mono font-bold text-xxs">{diff.key}</td>
                            <td className="p-3 font-mono text-xxs text-slate-500">{diff.fieldA?.displayName || <span className="text-slate-300 font-normal">Not present</span>}</td>
                            <td className="p-3 font-mono text-xxs text-slate-500">{diff.fieldB?.displayName || <span className="text-slate-300 font-normal">Not present</span>}</td>
                            <td className="p-3">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                diff.status === "Added" ? "bg-emerald-50 text-emerald-600" :
                                diff.status === "Removed" ? "bg-rose-50 text-rose-600" :
                                diff.status === "Modified" ? "bg-amber-50 text-amber-600" :
                                "bg-slate-100 text-slate-400"
                              }`}>
                                {diff.status}
                              </span>
                            </td>
                            <td className="p-3 text-xxs text-slate-400 font-mono">{diff.details || "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                </div>
              )}

            </div>
          ) : (
            <div className="bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-800 rounded-xl p-10 text-center flex flex-col justify-center items-center min-h-[400px] text-slate-400" id="no-tpl-selected-state">
              <Database size={48} className="text-slate-300 mb-3" />
              <h3 className="font-bold text-slate-800 dark:text-slate-200">Select a template from the Registry</h3>
              <p className="text-xs text-slate-500 mt-1 max-w-sm">Choose any Master Data, Commercial, Field Force, or Financial template to edit its dynamic fields, deploy version history, or check baseline schemas.</p>
            </div>
          )}
        </div>

      </div>

    </div>
  );
}

// Inline replacement component to avoid compile issues
function CheckCircleIcon({ size, className }: { size: number; className?: string }) {
  return (
    <span className={className}>
      <Check size={size} />
    </span>
  );
}
