import React, { useState, useMemo } from "react";
import { 
  Stethoscope, 
  Search, 
  Plus, 
  Edit3, 
  Database, 
  AlertTriangle, 
  Sparkles, 
  Check, 
  X,
  User,
  Shield,
  Layers,
  Activity,
  Download,
  Upload,
  FileSpreadsheet
} from "lucide-react";
import { Role, User as CRMUser, Physician, PhysicianSpecialty } from "../types";
import { motion, AnimatePresence } from "motion/react";
import * as XLSX from "xlsx";
import { writeBatch, doc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { 
  useSpecialties, 
  registerNewSpecialty, 
  updateSpecialty, 
  setSpecialtyActiveStatus, 
  initializeSpecialtyRegistry,
  normalizeSpecialtyString
} from "../utils/specialtyService";

interface PhysicianSpecialtiesProps {
  currentUser: CRMUser;
  physicians: Physician[];
  lang: "en" | "ar";
}

export default function PhysicianSpecialties({
  currentUser,
  physicians,
  lang
}: PhysicianSpecialtiesProps) {
  const isRtl = lang === "ar";
  
  // Dynamic subscription to the specialty registry
  const { specialties: specialtiesList, status: specialtiesStatus, loading: isSpecialtiesLoading } = useSpecialties();

  // Search and Filter States
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<"Active" | "Inactive" | "All">("All");

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 8;

  // CRUD & Modal States
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSpecialty, setEditingSpecialty] = useState<PhysicianSpecialty | null>(null);
  const [formNameEn, setFormNameEn] = useState("");
  const [formNameAr, setFormNameAr] = useState("");
  const [formAliasInput, setFormAliasInput] = useState("");
  const [formAliases, setFormAliases] = useState<string[]>([]);
  const [formError, setFormError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);

  // Excel Import/Export States
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importMode, setImportMode] = useState<"add" | "update" | "both">("add");
  const [importPreviewRows, setImportPreviewRows] = useState<any[]>([]);
  const [isImportCommitting, setIsImportCommitting] = useState(false);
  const [importResult, setImportResult] = useState<any | null>(null);
  const [dragActive, setDragActive] = useState(false);

  // RBAC checks
  const canModify = useMemo(() => {
    return currentUser?.role === Role.SUPER_ADMIN || 
           currentUser?.role === Role.ADMIN || 
           currentUser?.role === Role.SYSTEM_ADMINISTRATOR ||
           currentUser?.role === Role.MEDICAL_MANAGER ||
           currentUser?.role === Role.PRODUCT_MANAGER;
  }, [currentUser]);

  // Bilingual UI Dictionary
  const t = useMemo(() => {
    return {
      en: {
        title: "Physician Specialties",
        description: "Configure canonical medical specialties, manage spelling aliases for Excel imports, and track physician assignment analytics.",
        searchPlaceholder: "Search specialties by name, translation, or alias...",
        statusFilter: "Status Filter",
        all: "All Specialties",
        active: "Active",
        inactive: "Inactive",
        createSpecialty: "Add New Specialty",
        editSpecialty: "Edit Specialty",
        initializeRegistry: "Initialize Canonical 31-Specialty Register",
        initializeSuccess: "Successfully initialized {count} canonical bilingual specialties!",
        initializeConfirm: "Are you sure you want to initialize the official 31-specialty bilingual register?",
        specialtyNameEn: "Specialty Name (English) *",
        specialtyNameAr: "Specialty Name (Arabic)",
        aliases: "Spelling Aliases (for smart Excel imports)",
        aliasPlaceholder: "Add spelling variation alias...",
        add: "Add Alias",
        save: "Save Specialty",
        cancel: "Cancel",
        noSpecialties: "No physician specialties found matching your search.",
        associatedPhysicians: "Associated Physicians",
        status: "Status",
        emptyRegistryAlert: "The physician specialty registry is currently empty. As an Administrator, you can bootstrap the 31 canonical medical specialties with a single click.",
        successSave: "Specialty saved successfully!",
        errorSave: "Failed to save specialty: ",
        activeBadge: "Active",
        inactiveBadge: "Inactive"
      },
      ar: {
        title: "تخصصات الأطباء",
        description: "تكوين التخصصات الطبية المعتمدة، وإدارة المرادفات وهجاءات الاستيراد الذكي من ملفات Excel، وتتبع ارتباطات الأطباء.",
        searchPlaceholder: "البحث عن التخصصات بالاسم، الترجمة، أو المرادفات...",
        statusFilter: "تصفية الحالة",
        all: "جميع التخصصات",
        active: "نشط فقط",
        inactive: "غير نشط فقط",
        createSpecialty: "إضافة تخصص جديد",
        editSpecialty: "تعديل التخصص الطبية",
        initializeRegistry: "تهيئة السجل المعتمد (31 تخصصاً)",
        initializeSuccess: "تم تهيئة {count} تخصصاً طبياً بنجاح!",
        initializeConfirm: "هل أنت متأكد من تهيئة السجل المعتمد المكون من 31 تخصصاً طبياً ثنائي اللغة؟",
        specialtyNameEn: "اسم التخصص (بالإنكليزية) *",
        specialtyNameAr: "اسم التخصص (بالعربية)",
        aliases: "مرادفات وهجاءات بديلة (لتسهيل استيراد Excel)",
        aliasPlaceholder: "أضف هجاء بديلاً...",
        add: "إضافة مرادف",
        save: "حفظ التخصص",
        cancel: "إلغاء",
        noSpecialties: "لم يتم العثور على أي تخصصات طبية تطابق البحث.",
        associatedPhysicians: "الأطباء المرتبطين",
        status: "الحالة",
        emptyRegistryAlert: "سجل تخصصات الأطباء فارغ حالياً. بصفتك مشرفاً، يمكنك تهيئة الـ 31 تخصصاً طبياً المعتمدين بنقرة واحدة.",
        successSave: "تم حفظ التخصص بنجاح!",
        errorSave: "فشل حفظ التخصص: ",
        activeBadge: "نشط",
        inactiveBadge: "غير نشط"
      }
    }[lang];
  }, [lang]);

  // Dynamic analytic count builder
  const specialtyAssignments = useMemo(() => {
    const counts: Record<string, number> = {};
    physicians.forEach((p) => {
      if (!p.specialty) return;
      const normalized = p.specialty.trim().toLowerCase();
      counts[normalized] = (counts[normalized] || 0) + 1;
    });
    return counts;
  }, [physicians]);

  // Helper to resolve associated count for a specialty document
  const getAssociatedCount = (spec: PhysicianSpecialty) => {
    let total = 0;
    
    // Match by exact name
    const nameKey = spec.name.trim().toLowerCase();
    total += specialtyAssignments[nameKey] || 0;
    
    // Match by Arabic name
    if (spec.nameAr) {
      const arKey = spec.nameAr.trim().toLowerCase();
      if (arKey !== nameKey) {
        total += specialtyAssignments[arKey] || 0;
      }
    }
    
    // Match by aliases
    if (spec.aliases) {
      spec.aliases.forEach((alias) => {
        const aliasKey = alias.trim().toLowerCase();
        if (aliasKey !== nameKey && (!spec.nameAr || aliasKey !== spec.nameAr.trim().toLowerCase())) {
          total += specialtyAssignments[aliasKey] || 0;
        }
      });
    }
    
    return total;
  };

  // Filter and search logic
  const filteredSpecialties = useMemo(() => {
    return specialtiesList.filter((spec) => {
      // 1. Status Filter
      if (statusFilter === "Active" && spec.isActive === false) return false;
      if (statusFilter === "Inactive" && spec.isActive !== false) return false;

      // 2. Search Term
      if (!searchTerm) return true;
      const term = searchTerm.toLowerCase().trim();
      return spec.name.toLowerCase().includes(term) ||
             (spec.nameAr && spec.nameAr.toLowerCase().includes(term)) ||
             (spec.normalizedName && spec.normalizedName.toLowerCase().includes(term)) ||
             (spec.aliases && spec.aliases.some(a => a.toLowerCase().includes(term)));
    });
  }, [specialtiesList, statusFilter, searchTerm]);

  // Pagination slices
  const totalItems = filteredSpecialties.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
  const paginatedSpecialties = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredSpecialties.slice(start, start + itemsPerPage);
  }, [filteredSpecialties, currentPage]);

  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  // Seeding action
  const handleInitializeRegistry = async () => {
    if (!window.confirm(t.initializeConfirm)) return;
    setIsInitializing(true);
    try {
      const res = await initializeSpecialtyRegistry(currentUser.id);
      if (res.success) {
        let msg = t.initializeSuccess.replace("{count}", String(res.count));
        if (res.skipped > 0) {
          msg += isRtl 
            ? `\nتم تخطي ${res.skipped} تخصصات موجودة مسبقاً.`
            : `\nSkipped ${res.skipped} existing specialties.`;
        }
        if (res.conflicts && res.conflicts.length > 0) {
          msg += isRtl 
            ? `\nتنبيه: تم العثور على ${res.conflicts.length} تضاربات:\n` + res.conflicts.join("\n")
            : `\nNotice: Found ${res.conflicts.length} conflicts:\n` + res.conflicts.join("\n");
        }
        alert(msg);
      } else {
        alert(t.errorSave + res.error);
      }
    } catch (err: any) {
      alert(t.errorSave + (err.message || String(err)));
    } finally {
      setIsInitializing(false);
    }
  };

  // Toggle active / inactive status (Safe Deactivation)
  const handleToggleActive = async (spec: PhysicianSpecialty) => {
    if (!canModify) return;
    const nextState = !spec.isActive;
    
    const count = getAssociatedCount(spec);
    if (!nextState && count > 0) {
      const confirmDeactivate = window.confirm(
        isRtl
          ? `⚠️ هذا التخصص مرتبط حالياً بـ (${count}) من الأطباء في الدليل. سيتم إبقاء التخصص على السجلات الحالية ولكن لن يمكن اختياره للأطباء الجدد أو الاستيراد. هل تريد الاستمرار؟`
          : `⚠️ This specialty is currently assigned to ${count} physician records. Deactivating it will preserve existing records but prevent selection for new physicians and imports. Proceed?`
      );
      if (!confirmDeactivate) return;
    }

    try {
      const res = await setSpecialtyActiveStatus(spec.id, nextState, currentUser.id);
      if (!res.success) {
        alert(t.errorSave + res.error);
      }
    } catch (err: any) {
      alert(t.errorSave + (err.message || String(err)));
    }
  };

  // Modal actions
  const openCreateModal = () => {
    setEditingSpecialty(null);
    setFormNameEn("");
    setFormNameAr("");
    setFormAliases([]);
    setFormAliasInput("");
    setFormError("");
    setIsModalOpen(true);
  };

  const openEditModal = (spec: PhysicianSpecialty) => {
    setEditingSpecialty(spec);
    setFormNameEn(spec.name);
    setFormNameAr(spec.nameAr || "");
    setFormAliases(spec.aliases || []);
    setFormAliasInput("");
    setFormError("");
    setIsModalOpen(true);
  };

  const handleAddAlias = () => {
    const val = formAliasInput.trim().toUpperCase();
    if (!val) return;
    if (formAliases.includes(val)) {
      setFormAliasInput("");
      return;
    }
    setFormAliases([...formAliases, val]);
    setFormAliasInput("");
  };

  const handleRemoveAlias = (alias: string) => {
    setFormAliases(formAliases.filter(a => a !== alias));
  };

  const handleSaveForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formNameEn.trim()) {
      setFormError(isRtl ? "الاسم بالإنكليزية مطلوب" : "English name is required");
      return;
    }

    setIsSubmitting(true);
    setFormError("");

    try {
      if (editingSpecialty) {
        const res = await updateSpecialty(
          editingSpecialty.id,
          formNameEn,
          formNameAr,
          formAliases,
          currentUser.id
        );
        if (res.success) {
          setIsModalOpen(false);
        } else {
          setFormError(res.error || "Save operation failed.");
        }
      } else {
        const res = await registerNewSpecialty(
          formNameEn,
          formNameAr,
          formAliases,
          currentUser.id
        );
        if (res.success) {
          setIsModalOpen(false);
        } else {
          setFormError(res.error || "Save operation failed.");
        }
      }
    } catch (err: any) {
      setFormError(err.message || "An error occurred.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // ----------------------------------------------------
  // Excel Template, Import & Export Core Functions
  // ----------------------------------------------------

  const downloadTemplate = () => {
    const wb = XLSX.utils.book_new();

    // Data Sheet
    const data = [
      {
        "English Name": "Clinical Genetics",
        "Arabic Name": "الوراثة السريرية",
        "Aliases": "Medical Genetics; Genetics",
        "Active": "TRUE"
      }
    ];
    
    const wsData = XLSX.utils.json_to_sheet(data, {
      header: ["English Name", "Arabic Name", "Aliases", "Active"]
    });
    XLSX.utils.book_append_sheet(wb, wsData, "Specialties");

    // Instructions Sheet
    const instructions = [
      ["Instructions for Physician Specialties Master Template"],
      [""],
      ["1. English Name: Required. Must be unique. e.g. 'Clinical Genetics'."],
      ["2. Arabic Name: Required for official records. e.g. 'الوراثة السريرية'."],
      ["3. Aliases: Optional. Semicolon-separated synonyms or alternate spellings. e.g. 'Medical Genetics; Genetics'."],
      ["4. Active: Required. Set to TRUE or FALSE."],
      ["5. Do not include or edit columns not listed in this template."],
      ["6. Select one of the import modes when uploading: Add New Only, Update Existing, or Add and Update."],
    ];
    const wsInstructions = XLSX.utils.aoa_to_sheet(instructions);
    XLSX.utils.book_append_sheet(wb, wsInstructions, "Instructions");

    XLSX.writeFile(wb, "Physician Specialties Master Template.xlsx");
  };

  const exportSpecialties = () => {
    const data = specialtiesList.map(spec => ({
      "English Name": spec.name,
      "Arabic Name": spec.nameAr || "",
      "Aliases": spec.aliases ? spec.aliases.join("; ") : "",
      "Active": spec.isActive !== false ? "TRUE" : "FALSE",
      "Assigned Physicians Count": getAssociatedCount(spec),
      "Created At": spec.createdAt || "",
      "Updated At": spec.updatedAt || ""
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data, {
      header: [
        "English Name",
        "Arabic Name",
        "Aliases",
        "Active",
        "Assigned Physicians Count",
        "Created At",
        "Updated At"
      ]
    });
    XLSX.utils.book_append_sheet(wb, ws, "Exported Specialties");
    XLSX.writeFile(wb, `Physician_Specialties_Export_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      parseFile(file);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    parseFile(file);
  };

  const parseFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const rawData = XLSX.utils.sheet_to_json<any>(ws);
        
        processImportData(rawData);
      } catch (err: any) {
        alert("Error reading Excel file: " + err.message);
      }
    };
    reader.readAsBinaryString(file);
  };

  const processImportData = (rows: any[]) => {
    const currentList = specialtiesList;
    
    const parsedRows = rows.map((row, index) => {
      const rowNum = index + 2; // header is row 1
      const rawNameEn = row["English Name"] || row["english name"] || row["EnglishName"] || "";
      const rawNameAr = row["Arabic Name"] || row["arabic name"] || row["ArabicName"] || "";
      const rawAliases = row["Aliases"] || row["aliases"] || "";
      const rawActive = row["Active"] || row["active"] || "";

      const nameEn = String(rawNameEn).trim();
      const nameAr = String(rawNameAr).trim();
      
      const cleanNameEn = nameEn.replace(/\s+/g, " ");
      const cleanNameAr = nameAr.replace(/\s+/g, " ");

      const normalizedNew = cleanNameEn.trim().toUpperCase().replace(/[\s_-]+/g, " ");

      // Validation check for missing English Name
      if (!cleanNameEn) {
        return {
          rowNum,
          nameEn: "",
          nameAr: cleanNameAr,
          aliases: [],
          isActive: false,
          action: "Error" as const,
          error: "Missing English Name."
        };
      }
      
      // Validation check for missing Arabic Name (since it is required for official records)
      if (!cleanNameAr) {
        return {
          rowNum,
          nameEn: cleanNameEn,
          nameAr: "",
          aliases: [],
          isActive: false,
          action: "Error" as const,
          error: "Missing Arabic Name which is required for official records."
        };
      }

      // Check for invalid Active values
      let activeVal = true;
      const strActive = String(rawActive).trim().toUpperCase();
      if (strActive === "TRUE" || strActive === "YES" || strActive === "1") {
        activeVal = true;
      } else if (strActive === "FALSE" || strActive === "NO" || strActive === "0") {
        activeVal = false;
      } else if (rawActive === undefined || rawActive === "") {
        activeVal = true; // default
      } else {
        return {
          rowNum,
          nameEn: cleanNameEn,
          nameAr: cleanNameAr,
          aliases: [],
          isActive: false,
          action: "Error" as const,
          error: `Active column must be TRUE or FALSE. Value was: "${rawActive}".`
        };
      }

      // Non-medical category filtering
      const nonMedicalKeywords = ["FINANCE", "HR", "ADMIN", "SALES", "IT", "MARKETING", "WAREHOUSE", "DELIVERY", "LOGISTICS", "ACCOUNTING", "RECEPTION"];
      const containsNonMedical = nonMedicalKeywords.some(keyword => normalizedNew.includes(keyword));
      if (containsNonMedical) {
        return {
          rowNum,
          nameEn: cleanNameEn,
          nameAr: cleanNameAr,
          aliases: [],
          isActive: activeVal,
          action: "Error" as const,
          error: `Rejected non-medical category specialty: "${cleanNameEn}".`
        };
      }

      // Semicolon-separated aliases parsing & validation
      let aliasesList: string[] = [];
      if (rawAliases) {
        aliasesList = String(rawAliases)
          .split(";")
          .map(a => a.trim().toUpperCase())
          .filter(Boolean);
      }

      // Validation for aliases separator check
      if (String(rawAliases).includes(",") && !String(rawAliases).includes(";")) {
        return {
          rowNum,
          nameEn: cleanNameEn,
          nameAr: cleanNameAr,
          aliases: [],
          isActive: activeVal,
          action: "Error" as const,
          error: "Invalid Aliases formatting: aliases must be separated by semicolons (;) instead of commas."
        };
      }

      // Check duplicate rows inside file itself
      const duplicateInFile = rows.some((r, idx) => {
        if (idx === index) return false;
        const otherEn = r["English Name"] || r["english name"] || r["EnglishName"] || "";
        return otherEn.trim().toUpperCase() === cleanNameEn.toUpperCase();
      });
      if (duplicateInFile) {
        return {
          rowNum,
          nameEn: cleanNameEn,
          nameAr: cleanNameAr,
          aliases: aliasesList,
          isActive: activeVal,
          action: "Error" as const,
          error: `Duplicate row in uploaded file for specialty "${cleanNameEn}".`
        };
      }

      // Find if specialty exists in Firestore by normalized English name
      const existingSpec = currentList.find(s => 
        s.normalizedName === normalizedNew || 
        s.name.trim().toUpperCase() === cleanNameEn.toUpperCase()
      );

      // Alias collisions: check if the name conflicts with an alias of another specialty in Firestore
      const nameConflictsWithOtherAlias = currentList.find(s => 
        s.normalizedName !== normalizedNew && s.aliases?.some(a => a.trim().toUpperCase() === normalizedNew)
      );
      if (nameConflictsWithOtherAlias) {
        return {
          rowNum,
          nameEn: cleanNameEn,
          nameAr: cleanNameAr,
          aliases: aliasesList,
          isActive: activeVal,
          action: "Error" as const,
          error: `Specialty name "${cleanNameEn}" conflicts with an existing alias assigned to "${nameConflictsWithOtherAlias.name}".`
        };
      }

      // Check if new aliases conflict with existing specialties or existing aliases
      for (const alias of aliasesList) {
        const normalizedAlias = alias.toUpperCase();
        const aliasConflictsWithName = currentList.find(s => s.normalizedName === normalizedAlias && s.normalizedName !== normalizedNew);
        if (aliasConflictsWithName) {
          return {
            rowNum,
            nameEn: cleanNameEn,
            nameAr: cleanNameAr,
            aliases: aliasesList,
            isActive: activeVal,
            action: "Error" as const,
            error: `Alias "${alias}" conflicts with the official name of specialty "${aliasConflictsWithName.name}".`
          };
        }

        const aliasConflictsWithAlias = currentList.find(s => 
          s.normalizedName !== normalizedNew && s.aliases?.some(a => a.trim().toUpperCase() === normalizedAlias)
        );
        if (aliasConflictsWithAlias) {
          return {
            rowNum,
            nameEn: cleanNameEn,
            nameAr: cleanNameAr,
            aliases: aliasesList,
            isActive: activeVal,
            action: "Error" as const,
            error: `Alias "${alias}" is already assigned to "${aliasConflictsWithAlias.name}".`
          };
        }
      }

      // Set action based on IMPORT MODE
      let finalAction: "Create" | "Update" | "Skip" | "Error" = "Create";
      let rowError: string | null = null;

      if (importMode === "add") {
        if (existingSpec) {
          finalAction = "Skip";
        } else {
          finalAction = "Create";
        }
      } else if (importMode === "update") {
        if (existingSpec) {
          finalAction = "Update";
        } else {
          finalAction = "Error";
          rowError = `Specialty "${cleanNameEn}" does not exist in the registry (Mode: Update Existing).`;
        }
      } else {
        if (existingSpec) {
          finalAction = "Update";
        } else {
          finalAction = "Create";
        }
      }

      return {
        rowNum,
        nameEn: cleanNameEn,
        nameAr: cleanNameAr,
        aliases: aliasesList,
        isActive: activeVal,
        action: finalAction,
        error: rowError,
        existingId: existingSpec?.id || null
      };
    });

    setImportPreviewRows(parsedRows);
  };

  const handleCommitImport = async () => {
    setIsImportCommitting(true);
    try {
      const batch = writeBatch(db);
      let created = 0;
      let updated = 0;
      let skipped = 0;
      let rejected = 0;
      const errors: string[] = [];

      const currentTimestamp = new Date().toISOString();

      for (const row of importPreviewRows) {
        if (row.action === "Error" || row.error) {
          rejected++;
          if (row.error) errors.push(`Row ${row.rowNum}: ${row.error}`);
          continue;
        }
        
        if (row.action === "Skip") {
          skipped++;
          continue;
        }

        if (row.action === "Create") {
          const safeSlug = row.nameEn.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-+|-+$)/g, "");
          const specId = safeSlug || `spec_${Date.now()}`;
          const docRef = doc(db, "physicianSpecialties", specId);

          const cleanAliases = Array.from(new Set(
            [row.nameEn.trim().toUpperCase().replace(/[\s_-]+/g, " "), row.nameEn.toUpperCase(), ...row.aliases]
          )).filter(Boolean);

          const data = {
            id: specId,
            name: row.nameEn,
            nameAr: row.nameAr,
            normalizedName: row.nameEn.trim().toUpperCase().replace(/[\s_-]+/g, " "),
            aliases: cleanAliases,
            isActive: row.isActive,
            createdAt: currentTimestamp,
            createdBy: currentUser.id,
            source: "Excel Import"
          };
          batch.set(docRef, data);
          created++;
        } else if (row.action === "Update" && row.existingId) {
          const docRef = doc(db, "physicianSpecialties", row.existingId);

          const cleanAliases = Array.from(new Set(
            [row.nameEn.trim().toUpperCase().replace(/[\s_-]+/g, " "), row.nameEn.toUpperCase(), ...row.aliases]
          )).filter(Boolean);

          const data = {
            name: row.nameEn,
            nameAr: row.nameAr,
            aliases: cleanAliases,
            isActive: row.isActive,
            updatedAt: currentTimestamp,
            updatedBy: currentUser.id,
            source: "Excel Import (Update)"
          };
          batch.set(docRef, data, { merge: true });
          updated++;
        }
      }

      if (created > 0 || updated > 0) {
        await batch.commit();
      }

      setImportResult({
        totalRows: importPreviewRows.length,
        created,
        updated,
        skipped,
        rejected,
        errors,
        executorUid: currentUser.id,
        commitTimestamp: currentTimestamp
      });

    } catch (err: any) {
      alert("Failed to commit database batch: " + err.message);
    } finally {
      setIsImportCommitting(false);
    }
  };

  return (
    <div className="space-y-6" id="physician-specialties-wrapper" dir={isRtl ? "rtl" : "ltr"}>
      
      {/* Header Panel */}
      <div className="p-6 bg-gradient-to-r from-blue-50 to-indigo-50/50 dark:from-slate-900 dark:to-slate-900/60 border border-slate-200/50 dark:border-slate-800/80 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-xxs">
        <div className="space-y-2 max-w-2xl">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-600 text-white rounded-xl shadow-sm">
              <Stethoscope size={20} />
            </div>
            <div>
              <h2 className="text-base font-black text-slate-800 dark:text-white flex items-center gap-2">
                {t.title}
                <span className="text-xxs px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 font-bold font-mono">
                  {specialtiesList.length} total
                </span>
              </h2>
              <p className="text-slate-500 dark:text-slate-400 text-xxs font-medium leading-relaxed">
                {t.description}
              </p>
            </div>
          </div>
        </div>
        
        {/* Actions row */}
        {canModify && (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {specialtiesStatus === "empty" && (
              <button
                onClick={handleInitializeRegistry}
                disabled={isInitializing}
                className="px-4 py-2.5 bg-amber-600 hover:bg-amber-700 disabled:bg-amber-400 text-white font-bold text-xxs rounded-xl shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <Sparkles size={14} className="animate-spin-slow" />
                <span>{isInitializing ? "Initializing..." : t.initializeRegistry}</span>
              </button>
            )}
            
            {/* Excel Actions */}
            <button
              type="button"
              onClick={downloadTemplate}
              className="px-3 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-xxs rounded-xl transition-all flex items-center gap-1.5 cursor-pointer border border-slate-200/50 dark:border-slate-700"
              title={isRtl ? "تحميل قالب إكسل فارغ" : "Download Blank Excel Template"}
            >
              <Download size={13} />
              <span>{isRtl ? "تحميل القالب" : "Template"}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setImportResult(null);
                setImportPreviewRows([]);
                setIsImportModalOpen(true);
              }}
              className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xxs rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-xxs"
              title={isRtl ? "استيراد تخصصات من ملف إكسل" : "Import specialties from Excel file"}
            >
              <Upload size={13} />
              <span>{isRtl ? "استيراد إكسل" : "Import Excel"}</span>
            </button>
            <button
              type="button"
              onClick={exportSpecialties}
              className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xxs rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-xxs"
              title={isRtl ? "تصدير القائمة الحالية إلى ملف إكسل" : "Export current list to Excel file"}
            >
              <FileSpreadsheet size={13} />
              <span>{isRtl ? "تصدير إكسل" : "Export Excel"}</span>
            </button>

            <button
              onClick={openCreateModal}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xxs rounded-xl shadow-sm hover:shadow-md transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <Plus size={14} />
              <span>{t.createSpecialty}</span>
            </button>
          </div>
        )}
      </div>

      {/* Empty State Banner (Only for admins if completely empty) */}
      {specialtiesStatus === "empty" && (
        <div className="flex items-start gap-4 p-5 bg-amber-50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/40 rounded-2xl shadow-xxs">
          <AlertTriangle className="text-amber-500 shrink-0 mt-0.5" size={20} />
          <div className="space-y-3">
            <h4 className="text-xs font-bold text-amber-800 dark:text-amber-400">
              {isRtl ? "سجل التخصصات الطبية فارغ تماماً" : "Physician Specialty Registry is Empty"}
            </h4>
            <p className="text-xxs text-amber-600/90 dark:text-amber-400/80 font-medium max-w-xl">
              {t.emptyRegistryAlert}
            </p>
            {canModify && (
              <button
                onClick={handleInitializeRegistry}
                disabled={isInitializing}
                className="px-3.5 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xxs rounded-lg shadow-2xs cursor-pointer transition-colors"
              >
                {t.initializeRegistry}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Controls: Search and Status Select */}
      {specialtiesStatus !== "empty" && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-slate-950 p-3 rounded-2xl border border-slate-200/60 dark:border-slate-800/80 shadow-xs">
          
          {/* Search bar */}
          <div className="relative flex-1">
            <Search className={`absolute ${isRtl ? "right-3.5" : "left-3.5"} top-1/2 -translate-y-1/2 text-slate-400`} size={15} />
            <input
              type="text"
              placeholder={t.searchPlaceholder}
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
              className={`w-full ${isRtl ? "pr-10 pl-4" : "pl-10 pr-4"} py-2 border border-slate-200 dark:border-slate-800 rounded-xl text-xs bg-slate-50/50 dark:bg-slate-900/40 text-slate-800 dark:text-white focus:outline-none focus:border-blue-500 placeholder-slate-400`}
            />
          </div>

          <div className="flex items-center gap-2 justify-end shrink-0">
            {/* Status Selector */}
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value as any); setCurrentPage(1); }}
              className="px-3 py-1.5 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300 focus:outline-none focus:border-blue-500 cursor-pointer"
            >
              <option value="All">{t.all}</option>
              <option value="Active">{t.active}</option>
              <option value="Inactive">{t.inactive}</option>
            </select>
          </div>
        </div>
      )}

      {/* Specialty Grid list */}
      {isSpecialtiesLoading ? (
        <div className="py-16 text-center text-xs font-mono text-slate-400">
          Loading specialties registry...
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {paginatedSpecialties.map((spec) => {
              const count = getAssociatedCount(spec);

              return (
                <div 
                  key={spec.id} 
                  className="p-5 bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800/80 rounded-2xl flex justify-between items-start text-xs relative overflow-hidden shadow-xxs hover:shadow-xs transition-shadow"
                >
                  <div className="space-y-2 flex-1 pr-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-sm text-slate-800 dark:text-white">
                        {spec.name}
                      </span>
                      {spec.nameAr && (
                        <span className="text-xxs font-bold text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-md" dir="rtl">
                          {spec.nameAr}
                        </span>
                      )}
                      
                      {/* Active Toggle badge */}
                      <button
                        type="button"
                        disabled={!canModify}
                        onClick={() => handleToggleActive(spec)}
                        className={`text-[9px] px-2 py-0.5 rounded-full font-mono font-bold transition-all border shadow-2xs ${
                          canModify ? "cursor-pointer hover:scale-102 hover:brightness-95 active:scale-98" : "cursor-not-allowed opacity-80"
                        } ${
                          spec.isActive !== false
                            ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border-emerald-200/50 dark:border-emerald-800/30"
                            : "bg-slate-50 dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-700"
                        }`}
                        title={canModify ? (spec.isActive !== false ? "Click to Deactivate" : "Click to Reactivate") : "Read-only"}
                      >
                        {spec.isActive !== false ? `● ${t.activeBadge}` : `○ ${t.inactiveBadge}`}
                      </button>
                    </div>

                    {/* Analytics Assignment Count */}
                    <div className="pt-0.5">
                      <span className="inline-flex items-center gap-1.5 text-[10px] bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400 font-medium px-2 py-0.5 rounded-md border border-slate-100 dark:border-slate-800/50 font-sans">
                        <Activity size={11} className="text-slate-400 shrink-0" />
                        <span>
                          {count === 1
                            ? `1 ${isRtl ? "طبيب مرتبط" : "Physician Associated"}`
                            : `${count} ${isRtl ? "طبيباً مرتبطاً" : "Physicians Associated"}`}
                        </span>
                      </span>
                    </div>

                    {/* Aliases mapping display */}
                    {spec.aliases && spec.aliases.length > 0 && (
                      <div className="pt-1.5 space-y-1">
                        <span className="text-[9px] text-slate-400 font-mono block uppercase tracking-wider">Aliases (import keys):</span>
                        <div className="flex flex-wrap gap-1">
                          {spec.aliases.map((alias, i) => (
                            <span key={i} className="text-[9px] bg-indigo-50/50 dark:bg-indigo-950/20 text-indigo-600/90 dark:text-indigo-400 font-mono px-2 py-0.5 rounded">
                              {alias}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* CRUD buttons (only for authorized roles) */}
                  {canModify && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => openEditModal(spec)}
                        className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg cursor-pointer transition-colors"
                        title={t.editSpecialty}
                      >
                        <Edit3 size={14} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            {filteredSpecialties.length === 0 && (
              <div className="col-span-full py-16 text-center text-slate-400 font-mono text-xs border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
                {t.noSpecialties}
              </div>
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-4 border-t border-slate-100 dark:border-slate-800/60" id="specialties-pagination">
              <span className="text-[10px] text-slate-400 font-mono">
                {isRtl 
                  ? `عرض ${Math.min((currentPage - 1) * itemsPerPage + 1, totalItems)}-${Math.min(currentPage * itemsPerPage, totalItems)} من أصل ${totalItems} سجل`
                  : `Showing ${Math.min((currentPage - 1) * itemsPerPage + 1, totalItems)}-${Math.min(currentPage * itemsPerPage, totalItems)} of ${totalItems}`}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="px-2.5 py-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 rounded-lg text-xxs font-bold hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
                >
                  {isRtl ? "السابق" : "Prev"}
                </button>
                <span className="text-xxs font-bold text-slate-700 dark:text-slate-300 px-2 font-mono">
                  {currentPage} / {totalPages}
                </span>
                <button
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className="px-2.5 py-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 rounded-lg text-xxs font-bold hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
                >
                  {isRtl ? "التالي" : "Next"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* CRUD Overlay Modal (for Add / Edit) */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs" id="specialty-crud-modal">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
            >
              {/* Modal Title */}
              <div className="px-5 py-4 bg-slate-50 dark:bg-slate-950/40 border-b border-slate-100 dark:border-slate-800/80 flex justify-between items-center shrink-0">
                <div className="flex items-center gap-2 text-slate-800 dark:text-white">
                  <Stethoscope className="text-blue-600" size={16} />
                  <span className="font-extrabold text-xs">
                    {editingSpecialty ? t.editSpecialty : t.createSpecialty}
                  </span>
                </div>
                <button 
                  onClick={() => setIsModalOpen(false)}
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-white transition-colors cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Form Content */}
              <form onSubmit={handleSaveForm} className="p-5 space-y-4 flex-1 overflow-y-auto">
                {formError && (
                  <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/40 text-rose-600 dark:text-rose-400 text-xxs font-semibold flex items-start gap-2 animate-pulse">
                    <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                    <span>{formError}</span>
                  </div>
                )}

                {/* English Name */}
                <div className="space-y-1">
                  <label className="text-xxs font-bold text-slate-500 dark:text-slate-400">
                    {t.specialtyNameEn}
                  </label>
                  <input
                    type="text"
                    value={formNameEn}
                    onChange={(e) => setFormNameEn(e.target.value)}
                    placeholder="e.g. Ophthalmology"
                    className="w-full text-xs p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-transparent text-slate-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                    disabled={isSubmitting}
                  />
                </div>

                {/* Arabic Name */}
                <div className="space-y-1">
                  <label className="text-xxs font-bold text-slate-500 dark:text-slate-400">
                    {t.specialtyNameAr}
                  </label>
                  <input
                    type="text"
                    value={formNameAr}
                    onChange={(e) => setFormNameAr(e.target.value)}
                    placeholder="مثال: طب العيون"
                    className="w-full text-xs p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-transparent text-slate-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500 text-right"
                    disabled={isSubmitting}
                  />
                </div>

                {/* Aliases section */}
                <div className="space-y-2 border-t border-slate-100 dark:border-slate-800/80 pt-3">
                  <label className="text-xxs font-bold text-slate-500 dark:text-slate-400 block">
                    {t.aliases}
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={formAliasInput}
                      onChange={(e) => setFormAliasInput(e.target.value)}
                      placeholder={t.aliasPlaceholder}
                      className="flex-1 text-xs p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-transparent text-slate-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                      disabled={isSubmitting}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddAlias();
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={handleAddAlias}
                      className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xxs font-bold rounded-xl transition-colors cursor-pointer"
                    >
                      {t.add}
                    </button>
                  </div>

                  {/* Registered aliases bubble list */}
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {formAliases.map((alias) => (
                      <span 
                        key={alias} 
                        className="inline-flex items-center gap-1 text-[9px] bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-mono px-2 py-0.5 rounded-md"
                      >
                        {alias}
                        <button
                          type="button"
                          onClick={() => handleRemoveAlias(alias)}
                          className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 focus:outline-none"
                        >
                          <X size={10} />
                        </button>
                      </span>
                    ))}
                    {formAliases.length === 0 && (
                      <span className="text-[10px] text-slate-400 italic">No spelling aliases registered.</span>
                    )}
                  </div>
                </div>

                {/* Submit Row */}
                <div className="flex justify-end gap-2 border-t border-slate-100 dark:border-slate-800/80 pt-4 shrink-0">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xxs font-bold rounded-xl cursor-pointer"
                    disabled={isSubmitting}
                  >
                    {t.cancel}
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-xxs font-bold rounded-xl shadow-xs cursor-pointer flex items-center gap-1.5"
                    disabled={isSubmitting}
                  >
                    {isSubmitting && <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                    <span>{t.save}</span>
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}

        {/* Excel Import Wizard Modal */}
        {isImportModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs" id="specialty-excel-import-modal">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-4xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
            >
              {/* Modal Header */}
              <div className="px-5 py-4 bg-slate-50 dark:bg-slate-950/40 border-b border-slate-100 dark:border-slate-800/80 flex justify-between items-center shrink-0">
                <div className="flex items-center gap-2 text-slate-800 dark:text-white">
                  <FileSpreadsheet className="text-emerald-600 animate-pulse" size={18} />
                  <span className="font-extrabold text-xs">
                    {isRtl ? "معالج استيراد التخصصات الطبية من إكسل" : "Physician Specialties Excel Import Wizard"}
                  </span>
                </div>
                <button 
                  onClick={() => setIsImportModalOpen(false)}
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-white transition-colors cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Modal Content */}
              <div className="p-6 space-y-5 flex-1 overflow-y-auto">
                
                {/* Mode Selector and Instructions */}
                {!importResult && (
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                    
                    {/* Mode selector Card */}
                    <div className="lg:col-span-7 bg-slate-50 dark:bg-slate-950/25 border border-slate-200/40 dark:border-slate-800/80 p-4 rounded-xl space-y-3">
                      <span className="text-xxs font-bold uppercase tracking-wider text-slate-400 block">
                        {isRtl ? "خطوة 1: اختر وضع الاستيراد" : "Step 1: Select Import Mode"}
                      </span>
                      <div className="space-y-2">
                        <label className="flex items-start gap-3 p-2.5 rounded-lg border border-slate-200/50 dark:border-slate-800 bg-white dark:bg-slate-900 cursor-pointer hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                          <input 
                            type="radio" 
                            name="importMode" 
                            value="add" 
                            checked={importMode === "add"}
                            onChange={(e) => {
                              setImportMode(e.target.value as any);
                              if (importPreviewRows.length > 0) {
                                // reprocess with new mode
                                setImportPreviewRows([]);
                              }
                            }}
                            className="mt-1"
                          />
                          <div>
                            <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block">
                              {isRtl ? "إضافة الجديد فقط (وضع افتراضي)" : "Add New Only (Default)"}
                            </span>
                            <span className="text-[10px] text-slate-500">
                              {isRtl ? "إنشاء تخصصات جديدة فقط. يتخطى تماماً أي تخصص موجود مسبقاً دون تغيير بياناته." : "Creates only specialties that do not already exist. Existing matches are skipped."}
                            </span>
                          </div>
                        </label>

                        <label className="flex items-start gap-3 p-2.5 rounded-lg border border-slate-200/50 dark:border-slate-800 bg-white dark:bg-slate-900 cursor-pointer hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                          <input 
                            type="radio" 
                            name="importMode" 
                            value="update" 
                            checked={importMode === "update"}
                            onChange={(e) => {
                              setImportMode(e.target.value as any);
                              if (importPreviewRows.length > 0) {
                                setImportPreviewRows([]);
                              }
                            }}
                            className="mt-1"
                          />
                          <div>
                            <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block">
                              {isRtl ? "تحديث التخصصات الحالية فقط" : "Update Existing"}
                            </span>
                            <span className="text-[10px] text-slate-500">
                              {isRtl ? "تعديل التخصصات الموجودة حالياً فقط بناءً على مطابقة الاسم بالإنكليزية. يتجاهل السطور الجديدة." : "Only updates rows that match an existing canonical specialty in Firestore. Does not create new records."}
                            </span>
                          </div>
                        </label>

                        <label className="flex items-start gap-3 p-2.5 rounded-lg border border-slate-200/50 dark:border-slate-800 bg-white dark:bg-slate-900 cursor-pointer hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                          <input 
                            type="radio" 
                            name="importMode" 
                            value="both" 
                            checked={importMode === "both"}
                            onChange={(e) => {
                              setImportMode(e.target.value as any);
                              if (importPreviewRows.length > 0) {
                                setImportPreviewRows([]);
                              }
                            }}
                            className="mt-1"
                          />
                          <div>
                            <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block">
                              {isRtl ? "إضافة الجديد وتحديث الحالي" : "Add and Update"}
                            </span>
                            <span className="text-[10px] text-slate-500">
                              {isRtl ? "دمج كامل للبيانات: ينشئ تخصصات جديدة ويعدل التخصصات المتطابقة في وقت واحد." : "Creates new records and simultaneously updates existing records with the new sheet's data."}
                            </span>
                          </div>
                        </label>
                      </div>
                    </div>

                    {/* Quick guidelines card */}
                    <div className="lg:col-span-5 bg-blue-50/50 dark:bg-slate-950/20 border border-blue-100/50 dark:border-slate-800 p-4 rounded-xl space-y-2.5">
                      <span className="text-xxs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 block">
                        {isRtl ? "متطلبات نموذج الاستيراد" : "Template Guidelines"}
                      </span>
                      <ul className="space-y-1.5 text-[10px] text-slate-600 dark:text-slate-400 list-disc list-inside font-medium leading-relaxed">
                        <li>{isRtl ? "يجب أن تكون أسماء الأعمدة مطابقة لقالب الاستيراد تماماً." : "Columns must match: English Name, Arabic Name, Aliases, Active."}</li>
                        <li>{isRtl ? "الاسم بالإنكليزية والاسم بالعربي مطلوبان لكل تخصص رسمي." : "English Name and Arabic Name are required for official records."}</li>
                        <li>{isRtl ? "تعدد المرادفات يكتب مفصولاً بفاصلة منقوطة (;)." : "Use semicolons (;) to separate multiple spelling aliases."}</li>
                        <li>{isRtl ? "عمود النشاط يقبل القيمة TRUE أو FALSE فقط." : "Active column accepts TRUE or FALSE values."}</li>
                      </ul>
                      <button
                        type="button"
                        onClick={downloadTemplate}
                        className="w-full mt-2 py-2 px-3 bg-white hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-[10px] font-bold text-slate-700 dark:text-slate-300 flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Download size={12} />
                        <span>{isRtl ? "تحميل نموذج Excel المعتمد" : "Download Official Excel Template"}</span>
                      </button>
                    </div>

                  </div>
                )}

                {/* Drag and Drop Area */}
                {!importResult && importPreviewRows.length === 0 && (
                  <div 
                    onDragEnter={handleDrag}
                    onDragOver={handleDrag}
                    onDragLeave={handleDrag}
                    onDrop={handleDrop}
                    className={`border-2 border-dashed rounded-2xl p-8 text-center flex flex-col items-center justify-center transition-all ${
                      dragActive 
                        ? "border-emerald-500 bg-emerald-50/30 dark:bg-emerald-950/10 scale-101" 
                        : "border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700"
                    }`}
                  >
                    <Upload size={32} className="text-slate-400 dark:text-slate-600 mb-3 animate-bounce" />
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-200 block mb-1">
                      {isRtl ? "اسحب وأسقط ملف الـ Excel هنا" : "Drag & drop your Excel file here"}
                    </span>
                    <span className="text-[10px] text-slate-500 block mb-3">
                      {isRtl ? "أو اضغط لتحديد الملف يدوياً من جهازك" : "or click to browse from device (supports .xlsx, .xls)"}
                    </span>
                    <label className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xxs font-bold rounded-xl cursor-pointer transition-colors border border-slate-200/50 dark:border-slate-700">
                      <span>{isRtl ? "اختر الملف" : "Choose File"}</span>
                      <input 
                        type="file" 
                        accept=".xlsx, .xls" 
                        className="hidden" 
                        onChange={handleFileChange}
                      />
                    </label>
                  </div>
                )}

                {/* Preview Grid & Status */}
                {!importResult && importPreviewRows.length > 0 && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <h4 className="text-xs font-bold text-slate-800 dark:text-white flex items-center gap-2">
                          <span>{isRtl ? "معاينة وتحليل أسطر ملف الاستيراد" : "Import File Data Verification"}</span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-mono">
                            {importPreviewRows.length} rows detected
                          </span>
                        </h4>
                        <p className="text-[10px] text-slate-500 font-medium">
                          {isRtl 
                            ? "يرجى مراجعة الجدول أدناه للتحقق من سلامة البيانات ووضع الإجراء (إنشاء، تعديل، تخطي) قبل التنفيذ النهائي."
                            : "Check rows below for schema validity, duplicate checks, and action tags before committing."}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => setImportPreviewRows([])}
                        className="text-xxs font-bold text-rose-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20 px-3 py-1.5 rounded-lg border border-rose-100 dark:border-rose-900/20 transition-colors cursor-pointer"
                      >
                        {isRtl ? "إلغاء الملف الحالي" : "Clear File"}
                      </button>
                    </div>

                    {/* Summary counters bar */}
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                      <div className="bg-slate-50 dark:bg-slate-950/30 p-2 border border-slate-200/40 dark:border-slate-800 rounded-lg text-center font-mono">
                        <span className="text-[9px] text-slate-400 block uppercase tracking-wider">Total</span>
                        <span className="text-sm font-bold text-slate-700 dark:text-slate-300">{importPreviewRows.length}</span>
                      </div>
                      <div className="bg-emerald-50/50 dark:bg-emerald-950/15 p-2 border border-emerald-200/40 dark:border-emerald-900/30 rounded-lg text-center font-mono">
                        <span className="text-[9px] text-emerald-500 block uppercase tracking-wider">Create</span>
                        <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                          {importPreviewRows.filter(r => r.action === "Create").length}
                        </span>
                      </div>
                      <div className="bg-blue-50/50 dark:bg-blue-950/15 p-2 border border-blue-200/40 dark:border-blue-900/30 rounded-lg text-center font-mono">
                        <span className="text-[9px] text-blue-500 block uppercase tracking-wider">Update</span>
                        <span className="text-sm font-bold text-blue-600 dark:text-blue-400">
                          {importPreviewRows.filter(r => r.action === "Update").length}
                        </span>
                      </div>
                      <div className="bg-slate-50 dark:bg-slate-950/30 p-2 border border-slate-200/40 dark:border-slate-800 rounded-lg text-center font-mono">
                        <span className="text-[9px] text-slate-400 block uppercase tracking-wider">Skip</span>
                        <span className="text-sm font-bold text-slate-500">
                          {importPreviewRows.filter(r => r.action === "Skip").length}
                        </span>
                      </div>
                      <div className="bg-rose-50/50 dark:bg-rose-950/15 p-2 border border-rose-200/40 dark:border-rose-900/30 rounded-lg text-center col-span-2 sm:col-span-1 font-mono">
                        <span className="text-[9px] text-rose-500 block uppercase tracking-wider">Rejected</span>
                        <span className={`text-sm font-bold ${importPreviewRows.filter(r => r.action === "Error").length > 0 ? "text-rose-600 dark:text-rose-400" : "text-slate-500"}`}>
                          {importPreviewRows.filter(r => r.action === "Error").length}
                        </span>
                      </div>
                    </div>

                    {/* Table View */}
                    <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-white dark:bg-slate-950 max-h-60 overflow-y-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 text-[10px] text-slate-500 uppercase tracking-wider font-bold">
                            <th className="px-3 py-2 text-center w-12 font-mono">Row</th>
                            <th className="px-3 py-2">English Name</th>
                            <th className="px-3 py-2">Arabic Name</th>
                            <th className="px-3 py-2">Aliases</th>
                            <th className="px-3 py-2 w-16 text-center">Active</th>
                            <th className="px-3 py-2 w-24">Action</th>
                            <th className="px-3 py-2">Details / Errors</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-[10px] font-medium text-slate-700 dark:text-slate-300">
                          {importPreviewRows.map((row, idx) => (
                            <tr key={idx} className={`hover:bg-slate-50/40 dark:hover:bg-slate-900/20 ${row.action === "Error" ? "bg-rose-50/10 dark:bg-rose-950/5" : ""}`}>
                              <td className="px-3 py-2 text-center font-mono text-slate-400">{row.rowNum}</td>
                              <td className="px-3 py-2 font-bold">{row.nameEn || <span className="italic text-rose-500 font-bold">Missing</span>}</td>
                              <td className="px-3 py-2 text-right font-bold" dir="rtl">{row.nameAr || <span className="italic text-slate-400">N/A</span>}</td>
                              <td className="px-3 py-2">
                                <div className="flex flex-wrap gap-0.5">
                                  {row.aliases?.map((a: string, i: number) => (
                                    <span key={i} className="text-[8px] bg-slate-100 dark:bg-slate-800 text-slate-600 px-1 py-0.2 rounded">
                                      {a}
                                    </span>
                                  ))}
                                  {(!row.aliases || row.aliases.length === 0) && <span className="text-slate-400">-</span>}
                                </div>
                              </td>
                              <td className="px-3 py-2 text-center font-mono">
                                <span className={row.isActive ? "text-emerald-500 font-bold" : "text-slate-400 font-semibold"}>
                                  {row.isActive ? "TRUE" : "FALSE"}
                                </span>
                              </td>
                              <td className="px-3 py-2">
                                {row.action === "Create" && (
                                  <span className="px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-400 font-bold text-[9px] uppercase tracking-wide">
                                    Create
                                  </span>
                                )}
                                {row.action === "Update" && (
                                  <span className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-400 font-bold text-[9px] uppercase tracking-wide">
                                    Update
                                  </span>
                                )}
                                {row.action === "Skip" && (
                                  <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 font-bold text-[9px] uppercase tracking-wide">
                                    Skip
                                  </span>
                                )}
                                {row.action === "Error" && (
                                  <span className="px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-950/40 text-rose-800 dark:text-rose-400 font-bold text-[9px] uppercase tracking-wide flex items-center gap-1">
                                    <AlertTriangle size={10} />
                                    Reject
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2">
                                {row.error ? (
                                  <span className="text-rose-600 dark:text-rose-400 font-bold font-sans">
                                    {row.error}
                                  </span>
                                ) : (
                                  <span className="text-emerald-600 font-semibold font-mono">✓ Ready</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Error Notice */}
                    {importPreviewRows.some(r => r.action === "Error") && (
                      <div className="p-3 bg-amber-50 dark:bg-amber-950/25 border border-amber-100 dark:border-amber-900/40 text-amber-800 dark:text-amber-400 rounded-xl text-xxs font-medium flex items-start gap-2">
                        <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                        <span>
                          {isRtl 
                            ? "تنبيه: يحتوي الملف المرفوع على بعض السطور التالفة أو التضاربات. سيتم استبعاد هذه السطور المرفوضة وتخطيها تلقائياً عند تنفيذ الاستيراد، بينما سيتم استيراد السطور السليمة بشكل طبيعي."
                            : "Notice: Your file contains rejected rows due to validation conflicts. Committing will skip these rows and process valid entries."}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* Import Done Audit Result */}
                {importResult && (
                  <div className="space-y-4">
                    <div className="p-5 bg-emerald-50 dark:bg-emerald-950/15 border border-emerald-100 dark:border-emerald-900/40 rounded-2xl flex items-start gap-4 shadow-xxs">
                      <div className="p-3 bg-emerald-500 text-white rounded-xl">
                        <Check size={20} />
                      </div>
                      <div className="space-y-2 flex-1">
                        <h4 className="text-xs font-bold text-emerald-800 dark:text-emerald-400 uppercase tracking-wider">
                          {isRtl ? "تمت عملية استيراد البيانات بنجاح" : "Excel Import Completed Successfully"}
                        </h4>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-2 border-t border-emerald-100/30 font-mono text-[10px]">
                          <div>
                            <span className="text-slate-400 block uppercase">Total Parsed Rows</span>
                            <span className="text-base font-extrabold text-slate-800 dark:text-slate-200">{importResult.totalRows}</span>
                          </div>
                          <div>
                            <span className="text-emerald-500 block uppercase">Created Records</span>
                            <span className="text-base font-extrabold text-emerald-600 dark:text-emerald-400">{importResult.created}</span>
                          </div>
                          <div>
                            <span className="text-blue-500 block uppercase">Updated Records</span>
                            <span className="text-base font-extrabold text-blue-600 dark:text-blue-400">{importResult.updated}</span>
                          </div>
                          <div>
                            <span className="text-slate-400 block uppercase">Skipped / Rejected</span>
                            <span className="text-base font-extrabold text-slate-500">{importResult.skipped + importResult.rejected}</span>
                          </div>
                        </div>

                        <div className="pt-3 border-t border-emerald-100/30 text-[9px] text-slate-500 space-y-1">
                          <div>
                            <span className="font-bold">Executor UID:</span> <span className="font-mono">{importResult.executorUid}</span>
                          </div>
                          <div>
                            <span className="font-bold">Commit Timestamp:</span> <span className="font-mono">{importResult.commitTimestamp}</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Output Errors list during commit if any */}
                    {importResult.errors && importResult.errors.length > 0 && (
                      <div className="space-y-2">
                        <span className="text-xxs font-bold uppercase tracking-wider text-rose-500 block">
                          {isRtl ? "تفاصيل الأخطاء والسطور المستبعدة" : "Excluded Rows Audit Log"}
                        </span>
                        <div className="p-4 bg-rose-50 dark:bg-rose-950/10 border border-rose-100 dark:border-rose-900/30 rounded-xl text-xxs font-mono text-rose-600 dark:text-rose-400 max-h-32 overflow-y-auto space-y-1">
                          {importResult.errors.map((err: string, i: number) => (
                            <div key={i} className="flex gap-2">
                              <span className="text-rose-400 select-none">▶</span>
                              <span>{err}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                  </div>
                )}

              </div>

              {/* Modal Footer */}
              <div className="px-5 py-4 bg-slate-50 dark:bg-slate-950/40 border-t border-slate-100 dark:border-slate-800/80 flex justify-end gap-2 shrink-0">
                {!importResult ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setIsImportModalOpen(false)}
                      className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xxs font-bold rounded-xl cursor-pointer"
                      disabled={isImportCommitting}
                    >
                      {t.cancel}
                    </button>
                    {importPreviewRows.length > 0 && (
                      <button
                        type="button"
                        onClick={handleCommitImport}
                        className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xxs font-bold rounded-xl shadow-xs cursor-pointer flex items-center gap-1.5"
                        disabled={isImportCommitting || importPreviewRows.every(r => r.action === "Skip" || r.action === "Error")}
                      >
                        {isImportCommitting && <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                        <span>
                          {isRtl ? "تأكيد واستيراد البيانات" : "Confirm and Commit Import"}
                        </span>
                      </button>
                    )}
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setIsImportModalOpen(false);
                      setImportResult(null);
                      setImportPreviewRows([]);
                    }}
                    className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-white text-xxs font-bold rounded-xl cursor-pointer"
                  >
                    {isRtl ? "إغلاق" : "Done"}
                  </button>
                )}
              </div>

            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
