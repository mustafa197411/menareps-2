import React, { useState, useEffect } from "react";
import { 
  Stethoscope, 
  Pill, 
  Database, 
  FileText, 
  Search, 
  Plus, 
  MapPin, 
  Sparkles,
  ChevronRight,
  ChevronLeft,
  TrendingUp,
  Tag,
  FileSpreadsheet,
  Check,
  X,
  Trash2,
  Edit3,
  Layers,
  Globe,
  AlertCircle
} from "lucide-react";
import { Role, User, Physician, Pharmacy, Product, KeyMessage, ProductPromotionGroup } from "../types";
import { motion, AnimatePresence } from "motion/react";
import { TemplateSchemas } from "../lib/schemaEngine";
import TemplateRegistryManager from "./TemplateRegistryManager";
import { saveProductPromotionGroup, deleteProductPromotionGroup, normalizeGroupName, runPromotionGroupsSeedingAndMigration, DiagnosticMigrationReport } from "../lib/productPromotionGroupsService";

interface MasterDataProps {
  currentUser: User;
  physicians: Physician[];
  pharmacies: Pharmacy[];
  products: Product[];
  keyMessages: KeyMessage[];
  productPromotionGroups?: ProductPromotionGroup[];
  lang: "en" | "ar";
  initialCatalog?: "physicians" | "pharmacies" | "products" | "messages" | "schemas" | "promotionGroups";
}

export default function MasterData({
  currentUser,
  physicians,
  pharmacies,
  products,
  keyMessages,
  productPromotionGroups = [],
  lang,
  initialCatalog
}: MasterDataProps) {
  const isRtl = lang === "ar";
  const [activeCatalog, setActiveCatalog] = useState<"physicians" | "pharmacies" | "products" | "messages" | "schemas" | "promotionGroups">(
    initialCatalog || "physicians"
  );

  // Sync active catalog if initialCatalog changes
  useEffect(() => {
    if (initialCatalog) {
      setActiveCatalog(initialCatalog);
    }
  }, [initialCatalog]);
  const [selectedSchemaKey, setSelectedSchemaKey] = useState<"users" | "products" | "physicians" | "pharmacies" | "keyMessages">("physicians");
  const [searchTerm, setSearchTerm] = useState("");

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 6;

  // Modal and form states for managing product promotion groups
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<ProductPromotionGroup | null>(null);
  const [formName, setFormName] = useState("");
  const [formNameAr, setFormNameAr] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formIsActive, setFormIsActive] = useState(true);
  const [formAliasInput, setFormAliasInput] = useState("");
  const [formAliases, setFormAliases] = useState<string[]>([]);
  const [formError, setFormError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // States for manual seeding/migration action
  const [isMigrating, setIsMigrating] = useState(false);
  const [migrationReport, setMigrationReport] = useState<DiagnosticMigrationReport | null>(null);
  const [showMigrationReportModal, setShowMigrationReportModal] = useState(false);

  // Reset pagination on search or catalog tab change
  useEffect(() => {
    setCurrentPage(1);
  }, [activeCatalog, searchTerm]);

  // Localization labels
  const t = {
    en: {
      physicians: "Physician Directory",
      pharmacies: "Pharmacy Network",
      products: "Product Catalog",
      messages: "Key Messages",
      schemas: "Template Schemas",
      promotionGroups: "Promotion Groups",
      searchPlaceholder: "Search records...",
      class: "Class",
      outstanding: "Outstanding Balance",
      price: "Unit Price",
      stock: "Available Stock",
      region: "Region",
      specialty: "Specialty",
      address: "Address",
      lastVisit: "Last Detailing",
      prev: "Prev",
      next: "Next",
      pageOf: "Page {current} of {total}",
      showing: "Showing {start}-{end} of {total} records",
      schemaSelectorLabel: "Select Official Excel Worksheet",
      schemaTableColLabel: "Excel Column Header (Label)",
      schemaTableColKey: "Database Field Name (Key)",
      schemaTableColType: "Data Type",
      schemaTableColReq: "Required?",
      schemaTableColDetails: "Validation Rules / Options / Default",
      schemaTableColFilter: "Filterable?",
      schemaTableColExport: "Exportable?",
      schemaYes: "Yes",
      schemaNo: "No",
      createGroup: "Create Promotion Group",
      editGroup: "Edit Promotion Group",
      groupName: "Promotion Group Name (English) *",
      groupNameAr: "Promotion Group Name (Arabic)",
      description: "Description",
      status: "Status",
      aliases: "Spelling Aliases (for smart Excel imports)",
      aliasPlaceholder: "Add alias alternative spelling...",
      addAlias: "Add",
      save: "Save Group",
      cancel: "Cancel",
      noGroups: "No Product Promotion Groups found."
    },
    ar: {
      physicians: "دليل الأطباء الأخصائيين",
      pharmacies: "شبكة الصيدليات المعتمدة",
      products: "كتالوج المنتجات الدوائية",
      messages: "الرسائل الترويجية المعتمدة",
      schemas: "مخططات القوالب",
      promotionGroups: "مجموعات الترويج المنتجات",
      searchPlaceholder: "البحث في السجلات...",
      class: "الفئة",
      outstanding: "المستحقات غير المدفوعة",
      price: "سعر الوحدة",
      stock: "المخزون المتاح",
      region: "المنطقة",
      specialty: "التخصص",
      address: "العنوان",
      lastVisit: "آخر زيارة تفصيلية",
      prev: "السابق",
      next: "التالي",
      pageOf: "الصفحة {current} من {total}",
      showing: "عرض {start}-{end} من أصل {total} سجل",
      schemaSelectorLabel: "اختر ورقة عمل Excel الرسمية",
      schemaTableColLabel: "رأس عمود Excel (التسمية)",
      schemaTableColKey: "اسم حقل قاعدة البيانات (المفتاح)",
      schemaTableColType: "نوع البيانات",
      schemaTableColReq: "مطلوب؟",
      schemaTableColDetails: "قواعد التحقق / الخيارات / الافتراضي",
      schemaTableColFilter: "قابل للتصفية؟",
      schemaTableColExport: "قابل للتصدير؟",
      schemaYes: "نعم",
      schemaNo: "لا",
      createGroup: "إنشاء مجموعة ترويجية",
      editGroup: "تعديل المجموعة الترويجية",
      groupName: "اسم المجموعة (بالإنكليزية) *",
      groupNameAr: "اسم المجموعة (بالعربية)",
      description: "الوصف",
      status: "الحالة",
      aliases: "مرادفات وهجاءات بديلة (لتسهيل الاستيراد من إكسل)",
      aliasPlaceholder: "أضف هجاء بديل...",
      addAlias: "إضافة",
      save: "حفظ المجموعة",
      cancel: "إلغاء",
      noGroups: "لم يتم العثور على مجموعات ترويجية للمنتجات."
    }
  }[lang];

  // Pre-filter catalog items to calculate correct total pages
  const filteredPhysicians = physicians.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()) || p.specialty.toLowerCase().includes(searchTerm.toLowerCase()));
  const filteredPharmacies = pharmacies.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()));
  const filteredProducts = products.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()) || p.brand.toLowerCase().includes(searchTerm.toLowerCase()));
  const filteredMessages = keyMessages.filter(m => m.brandName.toLowerCase().includes(searchTerm.toLowerCase()) || m.message.toLowerCase().includes(searchTerm.toLowerCase()));
  
  // Promotion groups filter
  const filteredPromotionGroups = productPromotionGroups.filter(g => 
    g.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    (g.nameAr && g.nameAr.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (g.description && g.description.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  // Active items and total items calculation
  const getActiveData = () => {
    switch(activeCatalog) {
      case "physicians": return filteredPhysicians;
      case "pharmacies": return filteredPharmacies;
      case "products": return filteredProducts;
      case "messages": return filteredMessages;
      case "promotionGroups": return filteredPromotionGroups;
      case "schemas": return [];
    }
  };

  const activeFilteredList = getActiveData();
  const totalItems = activeFilteredList.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
  const startIdx = totalItems > 0 ? (currentPage - 1) * itemsPerPage + 1 : 0;
  const endIdx = Math.min(currentPage * itemsPerPage, totalItems);

  // Paginated slices for catalog views
  const paginatedPhysicians = filteredPhysicians.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const paginatedPharmacies = filteredPharmacies.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const paginatedProducts = filteredProducts.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const paginatedMessages = filteredMessages.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const paginatedPromotionGroups = filteredPromotionGroups.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  // Modal actions
  const openCreateModal = () => {
    setEditingGroup(null);
    setFormName("");
    setFormNameAr("");
    setFormDescription("");
    setFormIsActive(true);
    setFormAliases([]);
    setFormAliasInput("");
    setFormError("");
    setIsModalOpen(true);
  };

  const openEditModal = (group: ProductPromotionGroup) => {
    setEditingGroup(group);
    setFormName(group.name);
    setFormNameAr(group.nameAr || "");
    setFormDescription(group.description || "");
    setFormIsActive(group.isActive);
    setFormAliases(group.aliases || []);
    setFormAliasInput("");
    setFormError("");
    setIsModalOpen(true);
  };

  const handleAddAlias = () => {
    const val = formAliasInput.trim();
    if (!val) return;
    if (formAliases.includes(val)) {
      setFormAliasInput("");
      return;
    }
    setFormAliases([...formAliases, val]);
    setFormAliasInput("");
  };

  const handleRemoveAlias = (index: number) => {
    setFormAliases(formAliases.filter((_, idx) => idx !== index));
  };

  const handleSaveGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");

    if (!formName.trim()) {
      setFormError("Promotion group name is required.");
      return;
    }

    const normName = normalizeGroupName(formName);
    if (!normName) {
      setFormError("Name must contain alphanumeric characters.");
      return;
    }

    // Check uniqueness
    const isDuplicate = productPromotionGroups.some(g => 
      g.normalizedName === normName && (!editingGroup || editingGroup.id !== g.id)
    );
    if (isDuplicate) {
      setFormError("A promotion group with this name already exists.");
      return;
    }

    setIsSubmitting(true);
    try {
      const generatedId = editingGroup ? editingGroup.id : normName;
      const groupData: ProductPromotionGroup = {
        id: generatedId,
        name: formName.trim(),
        nameAr: formNameAr.trim() || undefined,
        normalizedName: normName,
        description: formDescription.trim() || undefined,
        isActive: formIsActive,
        aliases: formAliases.length > 0 ? formAliases : [formName.trim().toLowerCase()],
        createdAt: editingGroup?.createdAt,
        createdBy: editingGroup?.createdBy
      };

      await saveProductPromotionGroup(groupData, currentUser.id);
      setIsModalOpen(false);
    } catch (err: any) {
      setFormError(err?.message || "Failed to save promotion group.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleActive = async (group: ProductPromotionGroup) => {
    try {
      await saveProductPromotionGroup({ ...group, isActive: !group.isActive }, currentUser.id);
    } catch (err: any) {
      alert("Error toggling active status: " + (err?.message || err));
    }
  };

  const handleDeleteGroup = async (groupId: string) => {
    if (!window.confirm("Are you sure you want to delete this Product Promotion Group? This operation cannot be undone.")) {
      return;
    }
    try {
      await deleteProductPromotionGroup(groupId, currentUser.id);
    } catch (err: any) {
      alert("Error deleting group: " + (err?.message || err));
    }
  };

  const handleRunMigration = async () => {
    if (!window.confirm("Are you sure you want to run the Product Promotion Group seeding and legacy data migration utility? This will seed default promotion groups if the collection is empty and sync products/physicians fields. Existing custom mappings will not be destroyed.")) {
      return;
    }
    setIsMigrating(true);
    setMigrationReport(null);
    try {
      const report = await runPromotionGroupsSeedingAndMigration(currentUser.id);
      setMigrationReport(report);
      setShowMigrationReportModal(true);
    } catch (err: any) {
      alert("Migration failed: " + (err?.message || err));
    } finally {
      setIsMigrating(false);
    }
  };

  return (
    <div className="space-y-6" id="master-data-wrapper" dir={isRtl ? "rtl" : "ltr"}>
      
      {/* Tab Selectors */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 overflow-x-auto scrollbar-none" id="catalog-selector-tabs">
        <button
          onClick={() => { setActiveCatalog("physicians"); setSearchTerm(""); }}
          className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold border-b-2 transition-all shrink-0 ${activeCatalog === "physicians" ? "border-blue-600 text-blue-600 dark:text-blue-400 font-bold" : "border-transparent text-slate-500 hover:text-slate-800"}`}
        >
          <Stethoscope size={16} />
          {t.physicians}
        </button>
        <button
          onClick={() => { setActiveCatalog("pharmacies"); setSearchTerm(""); }}
          className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold border-b-2 transition-all shrink-0 ${activeCatalog === "pharmacies" ? "border-blue-600 text-blue-600 dark:text-blue-400 font-bold" : "border-transparent text-slate-500 hover:text-slate-800"}`}
        >
          <Pill size={16} />
          {t.pharmacies}
        </button>
        <button
          onClick={() => { setActiveCatalog("products"); setSearchTerm(""); }}
          className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold border-b-2 transition-all shrink-0 ${activeCatalog === "products" ? "border-blue-600 text-blue-600 dark:text-blue-400 font-bold" : "border-transparent text-slate-500 hover:text-slate-800"}`}
        >
          <Database size={16} />
          {t.products}
        </button>
        <button
          onClick={() => { setActiveCatalog("promotionGroups"); setSearchTerm(""); }}
          className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold border-b-2 transition-all shrink-0 ${activeCatalog === "promotionGroups" ? "border-blue-600 text-blue-600 dark:text-blue-400 font-bold" : "border-transparent text-slate-500 hover:text-slate-800"}`}
        >
          <Layers size={16} />
          {t.promotionGroups}
        </button>
        <button
          onClick={() => { setActiveCatalog("messages"); setSearchTerm(""); }}
          className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold border-b-2 transition-all shrink-0 ${activeCatalog === "messages" ? "border-blue-600 text-blue-600 dark:text-blue-400 font-bold" : "border-transparent text-slate-500 hover:text-slate-800"}`}
        >
          <FileText size={16} />
          {t.messages}
        </button>
        <button
          onClick={() => { setActiveCatalog("schemas"); setSearchTerm(""); }}
          className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold border-b-2 transition-all shrink-0 ${activeCatalog === "schemas" ? "border-blue-600 text-blue-600 dark:text-blue-400 font-bold" : "border-transparent text-slate-500 hover:text-slate-800"}`}
        >
          <FileSpreadsheet size={16} />
          {t.schemas}
        </button>
      </div>

      {/* Action Header & Global search */}
      {activeCatalog !== "schemas" && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4" id="master-search-bar-and-actions">
          <div className="relative max-w-md flex-1">
            <Search className={`absolute ${isRtl ? "right-3" : "left-3"} top-1/2 -translate-y-1/2 text-slate-400`} size={16} />
            <input
              type="text"
              placeholder={t.searchPlaceholder}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className={`w-full ${isRtl ? "pr-10 pl-4" : "pl-10 pr-4"} py-2.5 border border-slate-200 dark:border-slate-800 rounded-xl text-xs bg-white dark:bg-slate-900 text-slate-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500`}
            />
          </div>

          {activeCatalog === "promotionGroups" && (
            <div className="flex items-center gap-2">
              {(currentUser.role === "Super Admin" || currentUser.role === "Admin") && (
                <button
                  onClick={handleRunMigration}
                  disabled={isMigrating}
                  className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-400 text-white text-xs font-bold rounded-xl shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                  title="Run Seeding and Legacy Data Migration"
                >
                  <Sparkles size={15} />
                  <span>{isMigrating ? "Migrating..." : "Run Migration"}</span>
                </button>
              )}
              <button
                onClick={openCreateModal}
                className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Plus size={15} />
                <span>{t.createGroup}</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* RENDER ACTIVE DIRECTORY */}
      {activeCatalog === "physicians" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4" id="physicians-grid">
          {paginatedPhysicians.map((phys) => (
            <div key={phys.id} className="p-4 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl flex justify-between items-start text-xs relative overflow-hidden" id={`physician-card-${phys.id}`}>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm text-slate-800 dark:text-white">{isRtl && phys.nameAr ? phys.nameAr : phys.name}</span>
                  <span className="text-xxs px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 font-bold font-mono">
                    {t.class} {phys.classification}
                  </span>
                </div>
                <p className="text-xxs font-mono text-slate-400">{t.specialty}: {phys.specialty}</p>
                {phys.primaryPromotionGroupName && (
                  <p className="text-xxs font-mono text-indigo-600 dark:text-indigo-400 font-bold">
                    Primary PG: {phys.primaryPromotionGroupName}
                  </p>
                )}
                <p className="text-xxs text-slate-500">{t.address}: {phys.address}</p>
              </div>
              <div className="text-right flex flex-col items-end gap-1.5 shrink-0">
                <span className="text-xxs font-mono bg-slate-50 dark:bg-slate-800 text-slate-500 px-2 py-0.5 rounded">
                  {phys.region}
                </span>
                <p className="text-xxs text-slate-400 font-mono mt-1">{t.lastVisit}: {phys.lastVisitDate || "Never"}</p>
              </div>
            </div>
          ))}
          {paginatedPhysicians.length === 0 && (
            <div className="col-span-full py-12 text-center text-slate-400 font-mono text-xs">
              No physician records match the criteria.
            </div>
          )}
        </div>
      )}

      {activeCatalog === "pharmacies" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4" id="pharmacies-grid">
          {paginatedPharmacies.map((pharm) => (
            <div key={pharm.id} className="p-4 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl flex justify-between items-start text-xs relative overflow-hidden" id={`pharmacy-card-${pharm.id}`}>
              <div className="space-y-1.5">
                <span className="font-bold text-sm text-slate-800 dark:text-white">{isRtl && pharm.nameAr ? pharm.nameAr : pharm.name}</span>
                <p className="text-xxs text-slate-500">{t.address}: {pharm.address}</p>
                <span className="inline-block text-xxs font-mono bg-slate-50 dark:bg-slate-800 text-slate-500 px-2 py-0.5 rounded">
                  {pharm.region} • {pharm.territory}
                </span>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xxs font-mono text-slate-400 uppercase tracking-wide">{t.outstanding}</p>
                <p className="text-sm font-black text-rose-600 mt-1">${pharm.outstandingBalance.toLocaleString()}</p>
              </div>
            </div>
          ))}
          {paginatedPharmacies.length === 0 && (
            <div className="col-span-full py-12 text-center text-slate-400 font-mono text-xs">
              No pharmacy records match the criteria.
            </div>
          )}
        </div>
      )}

      {activeCatalog === "products" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4" id="products-grid">
          {paginatedProducts.map((prod) => (
            <div key={prod.id} className="p-4 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl flex justify-between items-start text-xs relative overflow-hidden" id={`product-card-${prod.id}`}>
              <div className="space-y-1.5 pr-2">
                <h4 className="font-bold text-sm text-slate-800 dark:text-white">{prod.name}</h4>
                <p className="text-xxs text-slate-400 font-mono">
                  Promotion Group: <span className="text-indigo-600 dark:text-indigo-400 font-bold">{prod.promotionGroupName || prod.brand}</span>
                </p>
                {prod.productFamily && (
                  <p className="text-xxs text-slate-500 font-mono">Family: {prod.productFamily}</p>
                )}
                <p className="text-xxs text-slate-400 font-mono">{prod.therapeuticArea}</p>
                <p className="text-xxs text-slate-500 max-w-sm">{prod.description}</p>
              </div>
              <div className="text-right flex flex-col items-end gap-1 font-mono shrink-0">
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200">${prod.price}</span>
                <span className={`text-xxs px-2 py-0.5 rounded ${prod.stock < 1000 ? "bg-rose-50 dark:bg-rose-950/40 text-rose-600" : "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600"}`}>
                  Stock: {prod.stock}
                </span>
              </div>
            </div>
          ))}
          {paginatedProducts.length === 0 && (
            <div className="col-span-full py-12 text-center text-slate-400 font-mono text-xs">
              No products found matching the criteria.
            </div>
          )}
        </div>
      )}

      {activeCatalog === "promotionGroups" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4" id="promotion-groups-grid">
          {paginatedPromotionGroups.map((group) => {
            const associatedProductsCount = products.filter(
              (p) => p.promotionGroupId === group.id
            ).length;

            return (
              <div key={group.id} className="p-4 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl flex justify-between items-start text-xs relative overflow-hidden shadow-xxs">
                <div className="space-y-1.5 flex-1 pr-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-sm text-slate-800 dark:text-white">
                      {group.name}
                    </span>
                    {group.nameAr && (
                      <span className="text-xxs text-slate-400 bg-slate-50 dark:bg-slate-800 px-1.5 py-0.5 rounded" dir="rtl">
                        {group.nameAr}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => handleToggleActive(group)}
                      className={`text-xxs px-2 py-0.5 rounded-full font-mono font-bold cursor-pointer transition-all border shadow-2xs hover:scale-102 hover:brightness-95 active:scale-98 ${
                        group.isActive
                          ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border-emerald-200/50 dark:border-emerald-800/30"
                          : "bg-slate-50 dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-700"
                      }`}
                      title={group.isActive ? "Click to Deactivate Group" : "Click to Activate Group"}
                    >
                      {group.isActive ? "● Active" : "○ Inactive"}
                    </button>
                  </div>

                  {group.description && (
                    <p className="text-xxs text-slate-500">{group.description}</p>
                  )}

                  {/* Associated Products Badge */}
                  <div className="pt-0.5">
                    <span className="inline-flex items-center gap-1 text-[10px] bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400 font-medium px-2 py-0.5 rounded-md border border-slate-100 dark:border-slate-800 font-sans">
                      <Database size={10} className="text-slate-400 shrink-0" />
                      {associatedProductsCount === 1
                        ? "1 Associated Product"
                        : `${associatedProductsCount} Associated Products`}
                    </span>
                  </div>
                  
                  {/* Aliases mapping display */}
                  {group.aliases && group.aliases.length > 0 && (
                    <div className="pt-1">
                      <span className="text-[10px] text-slate-400 font-mono block">Aliases:</span>
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {group.aliases.map((alias, i) => (
                          <span key={i} className="text-[9px] bg-indigo-50/50 dark:bg-indigo-950/20 text-indigo-600 dark:text-indigo-400 font-mono px-1.5 py-0.2 rounded">
                            {alias}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
  
                {/* CRUD controls */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => openEditModal(group)}
                    className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg cursor-pointer transition-colors"
                    title="Edit Group"
                  >
                    <Edit3 size={14} />
                  </button>
                  <button
                    onClick={() => handleDeleteGroup(group.id)}
                    className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg cursor-pointer transition-colors"
                    title="Delete Group"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
          {paginatedPromotionGroups.length === 0 && (
            <div className="col-span-full py-12 text-center text-slate-400 font-mono text-xs">
              {t.noGroups}
            </div>
          )}
        </div>
      )}

      {activeCatalog === "messages" && (
        <div className="space-y-3" id="messages-grid">
          {paginatedMessages.map((msg) => (
            <div key={msg.id} className="p-4 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl space-y-2 text-xs" id={`message-card-${msg.id}`}>
              <div className="flex justify-between items-center">
                <span className="px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 font-bold font-mono text-xxs">
                  {msg.brandName} • {msg.therapeuticArea}
                </span>
                <span className="text-xxs font-mono text-slate-400">ID: {msg.id}</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1 text-slate-700 dark:text-slate-300">
                <div className="md:border-r border-slate-100 dark:border-slate-800 md:pr-2">
                  <span className="text-xxs font-mono text-slate-400 block mb-1">ENGLISH</span>
                  <p className="leading-relaxed">{msg.message}</p>
                </div>
                <div className="pt-2 md:pt-0">
                  <span className="text-xxs font-mono text-slate-400 block mb-1">ARABIC (العربية)</span>
                  <p className="leading-relaxed" dir="rtl">{msg.messageAr || "غير متوفر"}</p>
                </div>
              </div>
            </div>
          ))}
          {paginatedMessages.length === 0 && (
            <div className="py-12 text-center text-slate-400 font-mono text-xs">
              No promotional messages found matching the criteria.
            </div>
          )}
        </div>
      )}

      {activeCatalog === "schemas" && (
        <TemplateRegistryManager 
          currentUser={currentUser} 
          lang={lang} 
        />
      )}

      {/* Pagination Controls */}
      {activeCatalog !== "schemas" && totalPages > 1 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-slate-250 dark:border-slate-800" id="masterdata-pagination">
          <p className="text-xxs text-slate-400 font-mono">
            {t.showing
              .replace("{start}", String(startIdx))
              .replace("{end}", String(endIdx))
              .replace("{total}", String(totalItems))}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
              disabled={currentPage === 1}
              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-500 disabled:opacity-40 transition-opacity hover:bg-slate-50 cursor-pointer text-xs flex items-center gap-1 px-3"
            >
              <ChevronLeft size={14} />
              {t.prev}
            </button>
            <span className="text-xxs font-mono font-bold text-slate-600 dark:text-slate-300">
              {t.pageOf
                .replace("{current}", String(currentPage))
                .replace("{total}", String(totalPages))}
            </span>
            <button
              onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
              disabled={currentPage === totalPages}
              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-500 disabled:opacity-40 transition-opacity hover:bg-slate-50 cursor-pointer text-xs flex items-center gap-1 px-3"
            >
              {t.next}
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Product Promotion Group Administration Form (Modal) */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/45 dark:bg-slate-950/70 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.2 }}
              className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 p-6 shadow-xl space-y-4"
              dir={isRtl ? "rtl" : "ltr"}
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Layers size={16} className="text-blue-500" />
                  <span>{editingGroup ? t.editGroup : t.createGroup}</span>
                </h3>
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Form content */}
              <form onSubmit={handleSaveGroup} className="space-y-4 text-xs">
                {formError && (
                  <div className="p-3 bg-rose-50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/40 text-rose-600 dark:text-rose-400 rounded-xl flex items-center gap-2">
                    <AlertCircle size={15} />
                    <span>{formError}</span>
                  </div>
                )}

                <div className="space-y-1">
                  <label className="text-xxs font-semibold text-slate-500">
                    {t.groupName}
                  </label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="e.g. Novartis"
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-transparent text-slate-800 dark:text-white"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xxs font-semibold text-slate-500">
                    {t.groupNameAr}
                  </label>
                  <input
                    type="text"
                    value={formNameAr}
                    onChange={(e) => setFormNameAr(e.target.value)}
                    placeholder="مثال: نوفارتس"
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-transparent text-slate-800 dark:text-white"
                    dir="rtl"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xxs font-semibold text-slate-500">
                    {t.description}
                  </label>
                  <textarea
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    placeholder="Cardiovascular and Metabolic therapies division..."
                    rows={2}
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-transparent text-slate-800 dark:text-white"
                  />
                </div>

                {/* Switch for Active / Inactive status */}
                <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-850 rounded-xl border border-slate-100 dark:border-slate-800">
                  <div>
                    <span className="font-bold text-slate-800 dark:text-slate-200 block">Active Status</span>
                    <span className="text-[10px] text-slate-400">Determines if this promotion group is visible in dropdowns</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setFormIsActive(!formIsActive)}
                    className={`w-10 h-6 flex items-center rounded-full p-0.5 transition-colors cursor-pointer ${formIsActive ? "bg-emerald-500 justify-end" : "bg-slate-300 dark:bg-slate-755 justify-start"}`}
                  >
                    <motion.div layout className="w-5 h-5 bg-white rounded-full shadow-md" />
                  </button>
                </div>

                {/* Aliases addition block */}
                <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <label className="text-xxs font-semibold text-slate-500 block">
                    {t.aliases}
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={formAliasInput}
                      onChange={(e) => setFormAliasInput(e.target.value)}
                      placeholder={t.aliasPlaceholder}
                      className="flex-1 p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-transparent text-slate-800 dark:text-white"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAddAlias();
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={handleAddAlias}
                      className="px-3 py-2 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-500 cursor-pointer text-xxs"
                    >
                      {t.addAlias}
                    </button>
                  </div>

                  {/* Render Alias badges */}
                  {formAliases.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1 max-h-24 overflow-y-auto">
                      {formAliases.map((alias, idx) => (
                        <span key={idx} className="inline-flex items-center gap-1 text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-2 py-0.5 rounded-lg">
                          <span>{alias}</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveAlias(idx)}
                            className="text-slate-400 hover:text-rose-500 cursor-pointer"
                          >
                            <X size={10} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-100 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="px-4 py-2 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    {t.cancel}
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-4 py-2 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-500 cursor-pointer disabled:opacity-50"
                  >
                    {isSubmitting ? "Saving..." : t.save}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Product Promotion Group Migration Report Modal */}
      <AnimatePresence>
        {showMigrationReportModal && migrationReport && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/45 dark:bg-slate-950/70 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.2 }}
              className="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 p-6 shadow-xl space-y-4 max-h-[85vh] overflow-y-auto"
              dir={isRtl ? "rtl" : "ltr"}
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Sparkles size={16} className="text-indigo-500" />
                  <span>Promotion Group Migration Report</span>
                </h3>
                <button
                  onClick={() => setShowMigrationReportModal(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Report Body */}
              <div className="space-y-4 text-xs">
                {/* Stats cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 rounded-xl space-y-1">
                    <span className="text-[10px] text-slate-400 font-mono block">Status</span>
                    <span className={`text-xs font-bold font-mono px-2 py-0.5 rounded inline-block ${
                      migrationReport.integrityStatus === "Healthy" 
                        ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600" 
                        : migrationReport.integrityStatus === "Mismatches Detected" 
                        ? "bg-amber-50 dark:bg-amber-950/40 text-amber-600" 
                        : "bg-rose-50 dark:bg-rose-950/40 text-rose-600"
                    }`}>
                      {migrationReport.integrityStatus}
                    </span>
                  </div>

                  <div className="p-3 bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 rounded-xl space-y-1">
                    <span className="text-[10px] text-slate-400 font-mono block">Collection Seeded?</span>
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      {migrationReport.isSeeded ? "Yes, Initialized" : "No, Already Populated"}
                    </span>
                  </div>

                  <div className="p-3 bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 rounded-xl space-y-1">
                    <span className="text-[10px] text-slate-400 font-mono block">Migrated Products</span>
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200 font-mono">
                      {migrationReport.migratedProductsCount}
                    </span>
                  </div>

                  <div className="p-3 bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 rounded-xl space-y-1">
                    <span className="text-[10px] text-slate-400 font-mono block">Migrated Physicians</span>
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200 font-mono">
                      {migrationReport.migratedPhysiciansCount}
                    </span>
                  </div>
                </div>

                {/* Audit meta info */}
                <div className="p-3 bg-slate-50 dark:bg-slate-800/30 rounded-xl border border-slate-100 dark:border-slate-800/80 space-y-1 text-[11px] font-mono text-slate-500">
                  <p>Run Timestamp: <span className="text-slate-700 dark:text-slate-300 font-bold">{migrationReport.timestamp}</span></p>
                  <p>Run By Operator ID: <span className="text-slate-700 dark:text-slate-300 font-bold">{migrationReport.runBy}</span></p>
                </div>

                {/* Created Groups */}
                {migrationReport.createdGroups && migrationReport.createdGroups.length > 0 && (
                  <div className="space-y-1.5">
                    <h4 className="font-bold text-slate-800 dark:text-slate-200">Seeded Promotion Groups ({migrationReport.createdGroups.length})</h4>
                    <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto p-1 border border-slate-100 dark:border-slate-800 rounded-lg">
                      {migrationReport.createdGroups.map((cg, i) => (
                        <span key={i} className="px-2 py-0.5 bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-100/30 text-indigo-600 dark:text-indigo-400 font-mono text-[10px] rounded">
                          {cg.name} ({cg.id})
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Fallbacks & Mappings Warnings */}
                {migrationReport.fallbackMappings && migrationReport.fallbackMappings.length > 0 && (
                  <div className="space-y-1.5">
                    <h4 className="font-bold text-amber-600 flex items-center gap-1">
                      <AlertCircle size={13} />
                      <span>Unresolved Brand Mapping Warnings ({migrationReport.fallbackMappings.length})</span>
                    </h4>
                    <div className="space-y-1 max-h-40 overflow-y-auto p-2 border border-slate-100 dark:border-slate-800 rounded-lg bg-slate-50/30 font-mono text-[10px] text-slate-600 dark:text-slate-400 leading-normal">
                      {migrationReport.fallbackMappings.map((fm, i) => (
                        <div key={i} className="py-0.5 border-b border-slate-100/50 dark:border-slate-800/50 last:border-0">
                          <span className="font-bold uppercase text-[9px] px-1 py-0.2 rounded bg-slate-100 dark:bg-slate-800 mr-1 inline-block">
                            {fm.type}
                          </span>
                          ID {fm.entityId}: {fm.message}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Errors */}
                {migrationReport.errors && migrationReport.errors.length > 0 && (
                  <div className="space-y-1.5">
                    <h4 className="font-bold text-rose-600">Errors Encountered</h4>
                    <div className="p-3 bg-rose-50/50 dark:bg-rose-950/10 border border-rose-100/30 text-rose-600 dark:text-rose-400 rounded-lg font-mono leading-relaxed">
                      {migrationReport.errors.map((err, i) => (
                        <p key={i}>{err}</p>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div className="flex items-center justify-end pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  onClick={() => setShowMigrationReportModal(false)}
                  className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-bold rounded-xl hover:bg-slate-200 transition-all cursor-pointer"
                >
                  Close Report
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
