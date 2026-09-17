import React, { useState, useRef, useEffect } from "react";
import { 
  Upload, 
  CheckCircle, 
  AlertTriangle, 
  FileSpreadsheet, 
  Trash, 
  RotateCcw, 
  Clock, 
  ChevronRight, 
  Plus, 
  Download 
} from "lucide-react";
import { Role, User, ImportHistory, CANONICAL_USER_ROLES, PharmacyDuplicateResult } from "../types";

export function classifyPharmacyDuplicate(record: any, dbRecords: any[]): PharmacyDuplicateResult {
  const recId = record["Pharmacy ID"] || record["ID"] || record.id;
  const email = String(record["Email"] || record.email || "").trim().toLowerCase();
  const rawPhone = String(record["Phone"] || record.phone || "").replace(/\D/g, "");
  const name = String(record["Pharmacy Name"] || record.name || "").trim().toLowerCase();
  const city = String(record["City"] || record.city || "").trim().toLowerCase();
  const area = String(record["Area"] || record.area || record.territory || "").trim().toLowerCase();

  // 1. Canonical ID check
  if (recId) {
    const matches = dbRecords.filter(r => String(r.id || "").trim() === String(recId).trim());
    if (matches.length === 1) {
      return {
        type: matches[0].isDeleted ? "SOFT_DELETED_DUPLICATE" : "ACTIVE_DUPLICATE",
        matchedDoc: matches[0],
        matchingKey: "canonical ID"
      };
    } else if (matches.length > 1) {
      return { type: "AMBIGUOUS_DUPLICATE", matchedDocs: matches, matchingKey: "canonical ID" };
    }
  }

  // 2. Normalized Email check
  if (email) {
    const matches = dbRecords.filter(r => String(r.email || r.Email || "").trim().toLowerCase() === email);
    if (matches.length === 1) {
      return {
        type: matches[0].isDeleted ? "SOFT_DELETED_DUPLICATE" : "ACTIVE_DUPLICATE",
        matchedDoc: matches[0],
        matchingKey: "normalized email"
      };
    } else if (matches.length > 1) {
      return { type: "AMBIGUOUS_DUPLICATE", matchedDocs: matches, matchingKey: "normalized email" };
    }
  }

  // 3. Normalized Phone check
  if (rawPhone) {
    const matches = dbRecords.filter(r => String(r.phone || r.Phone || "").replace(/\D/g, "") === rawPhone);
    if (matches.length === 1) {
      return {
        type: matches[0].isDeleted ? "SOFT_DELETED_DUPLICATE" : "ACTIVE_DUPLICATE",
        matchedDoc: matches[0],
        matchingKey: "normalized phone"
      };
    } else if (matches.length > 1) {
      return { type: "AMBIGUOUS_DUPLICATE", matchedDocs: matches, matchingKey: "normalized phone" };
    }
  }

  // 4. Approved Business Identity Key check (name + city/area)
  if (name) {
    const matches = dbRecords.filter(r => {
      const pName = String(r.name || r["Pharmacy Name"] || "").trim().toLowerCase();
      const pCity = String(r.city || r.cityName || r.region || "").trim().toLowerCase();
      const pArea = String(r.area || r.areaName || r.territory || "").trim().toLowerCase();
      const nameMatch = pName === name;
      const geoMatch = (!city || !pCity || pCity === city) && (!area || !pArea || pArea === area);
      return nameMatch && geoMatch;
    });
    if (matches.length === 1) {
      return {
        type: matches[0].isDeleted ? "SOFT_DELETED_DUPLICATE" : "ACTIVE_DUPLICATE",
        matchedDoc: matches[0],
        matchingKey: "approved business identity key"
      };
    } else if (matches.length > 1) {
      return { type: "AMBIGUOUS_DUPLICATE", matchedDocs: matches, matchingKey: "approved business identity key" };
    }
  }

  return { type: "NO_DUPLICATE" };
}
import { canCreateRole, validateManager, getReadiness } from "../lib/userPolicyEngine";
import { motion } from "motion/react";
import { db } from "../lib/firebase";
import { collection, getDocs } from "firebase/firestore";
import * as XLSX from "xlsx";
import { TemplateSchemas, syncLiveTemplatesToSchemas } from "../lib/schemaEngine";
import { getTemplates } from "../lib/templateRegistry";
import { resolveCanonicalSpecialty, suggestSpecialty, APPROVED_31_SPECIALTIES } from "../utils/specialtyService";
import { resolveGeographyTuple } from "../utils/importNormalization";

interface ImportModuleProps {
  currentUser: User;
  lang: "en" | "ar";
  onImportSuccess: (
    module: "Users" | "Physicians" | "Pharmacies" | "Products" | "Key Messages" | "Area Import (Geographic Master)", 
    importedRecords: any[],
    importMode?: "UPSERT" | "CREATE_NEW_ONLY" | "UPDATE_EXISTING_ONLY"
  ) => Promise<{ success: boolean; error?: string }>;
  importHistory: ImportHistory[];
  onRollbackImport: (importId: string) => void;
}

export default function ImportModule({
  currentUser,
  lang,
  onImportSuccess,
  importHistory,
  onRollbackImport
}: ImportModuleProps) {
  const isRtl = lang === "ar";
  const fileInputRef = useRef<HTMLInputElement>(null);

  // States
  const [selectedModule, setSelectedModule] = useState<"Users" | "Physicians" | "Pharmacies" | "Products" | "Key Messages" | "Area Import (Geographic Master)">(() => {
    const preselected = localStorage.getItem("menareps_preselected_import_module");
    if (preselected) {
      localStorage.removeItem("menareps_preselected_import_module");
      return preselected as any;
    }
    return "Physicians";
  });
  const [dragActive, setDragActive] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState("");
  const [parsedRecords, setParsedRecords] = useState<any[]>([]);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [isSuccessfullyValidated, setIsSuccessfullyValidated] = useState(false);
  const [schemasSynced, setSchemasSynced] = useState(false);
  const [isUatMode, setIsUatMode] = useState(false);
  const [importMode, setImportMode] = useState<"UPSERT" | "CREATE_NEW_ONLY" | "UPDATE_EXISTING_ONLY">("UPSERT");

  // Sync templates registry with schema engine on mount
  useEffect(() => {
    async function loadAndSync() {
      const list = await getTemplates();
      syncLiveTemplatesToSchemas(list);
      setSchemasSynced(prev => !prev); // force local render-cycle update for dynamically updated keys
    }
    loadAndSync();
  }, []);

  // Localization labels
  const t = {
    en: {
      importTitle: "Enterprise Import Central",
      importSubtitle: "Upload field worksheets, validate schemas, and run rollbacks",
      moduleSelect: "Select Target Import Module",
      dragDrop: "Drag and drop your spreadsheet here, or",
      browse: "browse local files",
      supported: "Supports Excel (.xlsx, .xls) and Comma-Separated Values (.csv)",
      validationTitle: "Schema Validation Report",
      validationSuccess: "Structure Validated! No duplicate conflicts found.",
      saveImport: "Commit Sheet Records",
      rollback: "Rollback Import",
      fileName: "File Name",
      records: "Record Count",
      importedBy: "Imported By",
      status: "Status",
      history: "Transaction Import History",
      preview: "Records Preview",
      downloadTemplate: "Download Excel Template",
      errorHeader: "Invalid column headers. Expected: ",
      errorEmpty: "Missing required values at line ",
      repWarningAwaiting: "This representative has no operational Product assignment in the import file. The user will be imported successfully and must be completed later in User Management.",
      repWarningReadiness: "Representative will be imported as Awaiting Operational Assignment. Complete Area, Promotion Group, and Product configuration in User Management before field operations."
    },
    ar: {
      importTitle: "مركز الاستيراد المؤسسي",
      importSubtitle: "رفع أوراق العمل الميدانية، والتحقق من الهيكل، وإجراء التراجع",
      moduleSelect: "اختر وحدة الاستيراد المستهدفة",
      dragDrop: "اسحب وأفلت ورقة العمل هنا، أو",
      browse: "تصفح الملفات المحلية",
      supported: "يدعم ملفات إكسل (.xlsx, .xls) والقيم المفصولة بفواصل (.csv)",
      validationTitle: "تقرير التدقيق والتحقق من المخطط",
      validationSuccess: "تم التحقق من البنية! لا توجد تضاربات أو سجلات مكررة.",
      saveImport: "حفظ واعتماد السجلات المرفوعة",
      rollback: "تراجع عن الاستيراد",
      fileName: "اسم الملف",
      records: "عدد السجلات",
      importedBy: "بواسطة الموظف",
      status: "الحالة",
      history: "سجل حركات الاستيراد السابقة",
      preview: "معاينة السجلات قبل الحفظ",
      downloadTemplate: "تحميل قالب Excel فارغ",
      errorHeader: "رؤوس الأعمدة غير صالحة. الأعمدة المتوقعة: ",
      errorEmpty: "هناك قيم مطلوبة مفقودة في السطر ",
      repWarningAwaiting: "هذا الممثل ليس لديه أي تعيين منتجات تشغيلي في ملف الاستيراد. سيتم استيراد المستخدم بنجاح ويجب استكمال تهيئته لاحقاً في إدارة المستخدمين.",
      repWarningReadiness: "سيتم استيراد الممثل كـ 'بانتظار التعيين التشغيلي'. يجب استكمال تهيئة المنطقة، ومجموعة الترويج، والمنتجات في إدارة المستخدمين قبل بدء العمليات الميدانية."
    }
  }[lang];

  // Defined Schemas matching the official MENAREPS master templates
  const moduleSchemas = {
    "Users": {
      headers: TemplateSchemas.users.map(f => f.label),
      required: TemplateSchemas.users.filter(f => f.required).map(f => f.label),
      templateName: "users_import_template.csv",
      demoData: [
        {
          "Username": "john.doe",
          "First Name": "John",
          "Last Name": "Doe",
          "Email": "rep@example.com",
          "Manager Email": "manager@example.com",
          "Role": "Medical Representative",
          "Country": "Libya",
          "District": "Tripoli",
          "City": "Tripoli",
          "Area Codes": "LY-TRI-01, LY-TRI-02",
          "Area Names": "Tripoli-Central, Tripoli-West",
          "Active": "true"
        }
      ]
    },
    "Products": {
      headers: TemplateSchemas.products.map(f => f.label),
      required: TemplateSchemas.products.filter(f => f.required).map(f => f.label),
      templateName: "products_import_template.csv",
      demoData: [
        {
          "SKU": "PROD-001",
          "Product Name": "Panadol 500mg",
          "Arabic Product Name": "بنادول 500 ملغ",
          "Product Promotion Group": "GSK",
          "Product Family": "Panadol",
          "Therapeutic Area": "Pain Relief",
          "Product Type": "Tablet",
          "Manufacturer": "GlaxoSmithKline",
          "Price": "15.99",
          "Initial Stock": "500",
          "Strength": "500mg",
          "Package Size": "24 Tablets",
          "ATC Classification": "N02BE01",
          "Prescription Status": "OTC",
          "Marketing Status": "Active",
          "Parent Product SKU": "",
          "Sample SKU": "No",
          "Can Generate Samples": "Yes",
          "Monthly Rep Sample Limit": "50",
          "Monthly Physician Sample Limit": "10",
          "Product Image": "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=300",
          "Description": "Reliable fast pain relief and fever reduction",
          "Active": "true"
        }
      ]
    },
    "Physicians": {
      headers: TemplateSchemas.physicians.map(f => f.label),
      required: TemplateSchemas.physicians.filter(f => f.required).map(f => f.label),
      templateName: "physicians_import_template.csv",
      demoData: [
        {
          "Physician Name": "Dr. Ahmed Hassan",
          "Physician Name (Arabic)": "د. أحمد حسن",
          "Specialty": "Cardiology",
          "Segment": "A",
          "Key Opinion Leader": "Yes",
          "Primary Promotion Group": "GSK",
          "Target Promotion Groups": "Novartis; Roche",
          "Country": "Libya",
          "District": "Tripoli",
          "City": "Tripoli",
          "Area/Territory": "Zawiyat Dahmani",
          "Address": "Hospital Road",
          "Clinic/Hospital Name": "City Hospital",
          "Sector": "Private",
          "Phone": "+218 91 1234567",
          "Email": "dr@example.com",
          "Target Frequency (Visits/Month)": "4"
        }
      ]
    },
    "Pharmacies": {
      headers: TemplateSchemas.pharmacies.map(f => f.label),
      required: TemplateSchemas.pharmacies.filter(f => f.required).map(f => f.label),
      templateName: "pharmacies_import_template.csv",
      demoData: [
        {
          "Pharmacy Name": "Sample Pharmacy",
          "Type": "Retail",
          "Country": "Libya",
          "District": "West",
          "City": "Tripoli",
          "Area": "Central",
          "Address": "123 Main St",
          "Contact Person": "Ahmed",
          "Phone": "+218 91 1234567",
          "Email": "pharmacy@example.com",
          "Payment Term (Days)": "30"
        }
      ]
    },
    "Key Messages": {
      headers: TemplateSchemas.keyMessages.map(f => f.label),
      required: TemplateSchemas.keyMessages.filter(f => f.required).map(f => f.label),
      templateName: "messages_import_template.csv",
      demoData: [
        {
          "Product SKU": "PROD-001",
          "Key Focus": "Primary",
          "Message Content": "Clinically proven 50% faster relief with superior absorption",
          "Brand Name": "Panadol",
          "Therapeutic Area": "Pain Relief"
        }
      ]
    },
    "Area Import (Geographic Master)": {
      headers: ["Country", "District", "City", "Area", "Area Code", "Active"],
      required: ["Country", "District", "City", "Area", "Area Code"],
      templateName: "area_import_template.csv",
      demoData: [
        {
          "Country": "Libya",
          "District": "West",
          "City": "Tripoli",
          "Area": "Zawiyat Dahmani",
          "Area Code": "LY-WEST-TRIP-ZDH",
          "Active": "Yes"
        }
      ]
    }
  };

  // Helper function to parse CSV lines safely, keeping quotes and nested commas intact
  const parseCSVLine = (line: string): string[] => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  };

  // Drag and drop events
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
      handleFileProcess(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFileProcess(e.target.files[0]);
    }
  };

  // Process selected file, parsing schema headers and checking Firestore for duplicates
  const handleFileProcess = (file: File) => {
    setUploadedFileName(file.name);
    setValidationErrors([]);
    setParsedRecords([]);
    setIsSuccessfullyValidated(false);

    const schema = moduleSchemas[selectedModule];
    const reader = new FileReader();
    
    reader.onload = async (evt) => {
      try {
        const data = evt.target?.result;
        if (!data) return;

        // Parse file using xlsx
        const workbook = XLSX.read(data, { type: "array" });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        // Convert sheet to JSON array (array of arrays for easy header access)
        const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
        
        if (rows.length < 2) {
          setValidationErrors(["The uploaded file is empty or missing data rows."]);
          return;
        }

        // 1. Validate Column Headers (case insensitive and resilient)
        const headers = rows[0].map(h => String(h).trim());
        
        const missingHeaders = schema.headers.filter(sh => {
          return !headers.some(h => h.toLowerCase().replace(/\s+/g, "") === sh.toLowerCase().replace(/\s+/g, ""));
        });

        if (missingHeaders.length > 0) {
          setValidationErrors([
            `${t.errorHeader} [${schema.headers.join(", ")}]. Missing columns: [${missingHeaders.join(", ")}]`
          ]);
          return;
        }

        // Map file headers indices to schema fields
        const headerIndices: Record<string, number> = {};
        schema.headers.forEach(sh => {
          headerIndices[sh] = headers.findIndex(h => h.toLowerCase().replace(/\s+/g, "") === sh.toLowerCase().replace(/\s+/g, ""));
        });

        // 2. Load Firestore Data for Duplication & Cross-Referencing Lookups
        const dbCollectionName = selectedModule === "Key Messages" 
          ? "keyMessages" 
          : selectedModule === "Area Import (Geographic Master)"
            ? "areas"
            : selectedModule.toLowerCase();
        
        let currentDbRecords: any[] = [];
        let allUsers: any[] = [];
        let allProducts: any[] = [];
        let allPhysicians: any[] = [];
        let allPharmacies: any[] = [];
        let allSpecialties: any[] = [];
        let allPromotionGroups: any[] = [];
        let allCountries: any[] = [];
        let allDistricts: any[] = [];
        let allCities: any[] = [];
        let allAreas: any[] = [];

        try {
          const [snapTarget, snapUsers, snapProducts, snapPhysicians, snapPharmacies, snapSpecialties, snapGroups, snapCountries, snapDistricts, snapCities, snapAreas] = await Promise.all([
            getDocs(collection(db, dbCollectionName)),
            getDocs(collection(db, "users")),
            getDocs(collection(db, "products")),
            getDocs(collection(db, "physicians")),
            getDocs(collection(db, "pharmacies")),
            getDocs(collection(db, "physicianSpecialties")),
            getDocs(collection(db, "productPromotionGroups")),
            getDocs(collection(db, "countries")),
            getDocs(collection(db, "districts")),
            getDocs(collection(db, "cities")),
            getDocs(collection(db, "areas"))
          ]);

          snapTarget.forEach(d => currentDbRecords.push(d.data()));
          snapUsers.forEach(d => allUsers.push(d.data()));
          snapProducts.forEach(d => allProducts.push(d.data()));
          snapPhysicians.forEach(d => allPhysicians.push(d.data()));
          snapPharmacies.forEach(d => allPharmacies.push(d.data()));
          snapSpecialties.forEach(d => allSpecialties.push({ id: d.id, ...d.data() }));
          snapGroups.forEach(d => allPromotionGroups.push({ id: d.id, ...d.data() }));
          snapCountries.forEach(d => allCountries.push({ id: d.id, ...d.data() }));
          snapDistricts.forEach(d => allDistricts.push({ id: d.id, ...d.data() }));
          snapCities.forEach(d => allCities.push({ id: d.id, ...d.data() }));
          snapAreas.forEach(d => allAreas.push({ id: d.id, ...d.data() }));
        } catch (err) {
          console.error("Lookup & Duplication scanner failed to retrieve reference data:", err);
        }

        if (selectedModule === "Physicians") {
          const activeSpecialtiesCount = allSpecialties.filter(s => s.isActive !== false && !s.isDeleted).length;
          if (activeSpecialtiesCount === 0) {
            setValidationErrors(["Physician Specialty Registry could not be loaded. Import cannot continue safely."]);
            setIsSuccessfullyValidated(false);
            return;
          }
        }

        // 3. Parse Lines and Validate Data Types, Lookups, and Duplicates
        const records: any[] = [];
        const errors: string[] = [];

        // Detect unexpected/extra headers in the uploaded worksheet
        const unexpectedHeaders = headers.filter(h => {
          return !schema.headers.some(sh => sh.toLowerCase().replace(/\s+/g, "") === h.toLowerCase().replace(/\s+/g, ""));
        });

        if (unexpectedHeaders.length > 0) {
          errors.push(`Warning: Unexpected columns found in the worksheet: [${unexpectedHeaders.join(", ")}]. These columns will be ignored.`);
        }

        const mapRoleFriendly = (roleStr: string): string | null => {
          const norm = roleStr.toLowerCase().trim().replace(/[\s\-_&/]+/g, "");
          
          if (norm.includes("superadmin") || norm === "super_admin") return Role.SUPER_ADMIN;
          if (norm === "admin") return Role.ADMIN;
          if (norm.includes("systemadministrator") || norm === "system_administrator" || norm.includes("sysadmin")) return Role.ADMIN;
          
          if (norm.includes("generalmanager") || norm === "gm") return Role.GENERAL_MANAGER;
          if (norm.includes("regionalmanager")) return Role.REGIONAL_MANAGER;
          if (norm.includes("countrymanager")) return Role.COUNTRY_MANAGER;
          
          if (norm.includes("salesmarketingmanager") || norm.includes("salesandmarketingmanager")) return Role.SALES_MARKETING_MANAGER;
          if (norm.includes("financemanager")) return Role.FINANCE_MANAGER;
          if (norm.includes("marketingmanager")) return Role.MARKETING_MANAGER;
          if (norm.includes("medicalmanager")) return Role.MEDICAL_MANAGER;
          if (norm.includes("salesmanager")) return Role.SALES_MANAGER;
          if (norm.includes("productmanager")) return Role.PRODUCT_MANAGER;
          
          if (norm.includes("areasalesmanager") || norm.includes("areasales")) return Role.AREA_SALES_MANAGER;
          if (norm.includes("marketingofficer")) return Role.MARKETING_OFFICER;
          if (norm.includes("medicalsupervisor") || norm.includes("medsuper") || norm === "supervisor") return Role.MEDICAL_SUPERVISOR;
          if (norm.includes("salessupervisor") || norm.includes("salessuper")) return Role.SALES_SUPERVISOR;
          
          if (norm.includes("medicalrepresentative") || norm.includes("medicalrep") || norm === "rep" || norm === "medrep") return Role.MEDICAL_REP;
          if (norm.includes("salesrepresentative") || norm.includes("salesrep")) return Role.SALES_REP;
          
          if (norm.includes("treasury") || norm.includes("treasuryofficer")) return Role.TREASURY_OFFICER;
          if (norm.includes("finance") || norm.includes("financial")) return Role.FINANCE;
          
          if (norm.includes("inventoryofficer")) return Role.INVENTORY_OFFICER;
          if (norm.includes("warehousemanager") || norm.includes("warehouse") || norm.includes("inventory")) return Role.WAREHOUSE_MANAGER;
          if (norm.includes("storemanager") || norm === "store") return Role.STORE_MANAGER;
          if (norm.includes("deliveryofficer") || norm.includes("delivery")) return Role.DELIVERY_OFFICER;
          if (norm.includes("orderoperationsofficer") || norm.includes("orderops") || norm.includes("orderoperations")) return Role.ORDER_OPS_OFFICER;
          
          if (norm.includes("marketing")) return Role.MARKETING_OFFICER;
          if (norm.includes("manager")) return Role.COUNTRY_MANAGER;
          
          return null;
        };

        const schemaFields = TemplateSchemas[
          selectedModule === "Key Messages" 
            ? "keyMessages" 
            : selectedModule === "Area Import (Geographic Master)"
              ? "areas"
              : selectedModule.toLowerCase()
        ] || [];

        for (let i = 1; i < rows.length; i++) {
          // Skip empty rows
          if (rows[i].length === 0 || rows[i].every(cell => cell === "")) continue;

          const values = rows[i].map(v => String(v).trim());
          const record: Record<string, string> = {};
          let isRowValid = true;
          
          schema.headers.forEach(header => {
            const idx = headerIndices[header];
            record[header] = idx !== -1 && values[idx] !== undefined ? values[idx] : "";
          });

          if (selectedModule === "Physicians") {
            // 1. Specialty Validation
            if (record["Specialty"]) {
              const originalSpec = record["Specialty"];
              const cleanedUpper = originalSpec.trim().toUpperCase();
              const registry = allSpecialties.filter(s => s.isActive !== false && !s.isDeleted);

              // 1. Exact ID match
              let matchedSpec = registry.find(s => s.id.toLowerCase() === originalSpec.trim().toLowerCase());
              
              // 2. Case-insensitive name match or normalized name match
              if (!matchedSpec) {
                matchedSpec = registry.find(s => 
                  s.name?.trim().toUpperCase() === cleanedUpper ||
                  (s.normalizedName && s.normalizedName.toUpperCase() === cleanedUpper.replace(/[^A-Z0-9]/g, ""))
                );
              }

              if (!matchedSpec) {
                isRowValid = false;
                errors.push(`Row ${i + 1}: Unresolved Specialty - '${originalSpec}' does not exist in the active specialty registry.`);
              } else {
                record["Specialty"] = matchedSpec.name;
                record["Specialty ID"] = matchedSpec.id;
                record["Specialty Name"] = matchedSpec.name;
              }
            } else {
              isRowValid = false;
              errors.push(`Row ${i + 1}: Specialty field is empty or missing.`);
            }

            // 2. Primary Promotion Group Validation
            if (record["Primary Promotion Group"]) {
              const originalGroup = record["Primary Promotion Group"];
              const cleanedUpper = originalGroup.trim().toUpperCase();

              // 1. Exact ID match
              let matchedGroup = allPromotionGroups.find(g => g.id.toLowerCase() === originalGroup.trim().toLowerCase());

              // 2. Case-insensitive name match
              if (!matchedGroup) {
                matchedGroup = allPromotionGroups.find(g => 
                  g.name?.trim().toUpperCase() === cleanedUpper ||
                  (g.normalizedName && g.normalizedName.toUpperCase() === cleanedUpper.replace(/[^A-Z0-9]/g, ""))
                );
              }

              // 3. Pre-approved alias match
              if (!matchedGroup) {
                matchedGroup = allPromotionGroups.find(g => 
                  g.aliases?.some((alias: string) => alias.trim().toUpperCase() === cleanedUpper || alias.trim().toUpperCase().replace(/[^A-Z0-9]/g, "") === cleanedUpper.replace(/[^A-Z0-9]/g, ""))
                );
              }

              if (!matchedGroup) {
                isRowValid = false;
                errors.push(`Row ${i + 1}: Unresolved Primary Promotion Group - '${originalGroup}' is not a valid active group in the CRM database.`);
              } else {
                record["Primary Promotion Group"] = matchedGroup.name;
              }
            }

            // 3. Target Promotion Groups Validation
            if (record["Target Promotion Groups"]) {
              const originalTargets = record["Target Promotion Groups"];
              const targetNames = originalTargets.split(/[,;]+/).map(t => t.trim()).filter(Boolean);
              const resolvedTargets: string[] = [];
              const unresolvedTargets: string[] = [];

              targetNames.forEach(targetName => {
                const cleanedUpper = targetName.toUpperCase();
                
                // 1. Exact ID match
                let matchedGroup = allPromotionGroups.find(g => g.id.toLowerCase() === targetName.toLowerCase());

                // 2. Case-insensitive name match
                if (!matchedGroup) {
                  matchedGroup = allPromotionGroups.find(g => 
                    g.name?.trim().toUpperCase() === cleanedUpper ||
                    (g.normalizedName && g.normalizedName.toUpperCase() === cleanedUpper.replace(/[^A-Z0-9]/g, ""))
                  );
                }

                // 3. Pre-approved alias match
                if (!matchedGroup) {
                  matchedGroup = allPromotionGroups.find(g => 
                    g.aliases?.some((alias: string) => alias.trim().toUpperCase() === cleanedUpper || alias.trim().toUpperCase().replace(/[^A-Z0-9]/g, "") === cleanedUpper.replace(/[^A-Z0-9]/g, ""))
                  );
                }

                if (!matchedGroup) {
                  unresolvedTargets.push(targetName);
                } else {
                  resolvedTargets.push(matchedGroup.name);
                }
              });

              if (unresolvedTargets.length > 0) {
                isRowValid = false;
                errors.push(`Row ${i + 1}: Unresolved Target Promotion Groups - [${unresolvedTargets.join(", ")}] could not be matched to any active groups in the CRM database.`);
              } else {
                record["Target Promotion Groups"] = resolvedTargets.join("; ");
              }
            }
          }

          // 3.1. Required Fields check
          schema.required.forEach(reqField => {
            if (!record[reqField]) {
              isRowValid = false;
              errors.push(`Row ${i + 1}: Required field '${reqField}' must not be empty.`);
            }
          });

          // 3.2. Data Types and Enum validation
          schemaFields.forEach(field => {
            const val = record[field.label];
            if (val === "" && field.type === "boolean") {
              isRowValid = false;
              errors.push(`Row ${i + 1}: Field '${field.label}' cannot be empty or blank.`);
            } else if (val !== undefined && val !== "") {
              if (field.type === "number") {
                if (isNaN(Number(val))) {
                  isRowValid = false;
                  errors.push(`Row ${i + 1}: Field '${field.label}' expects a numeric value, but got '${val}'.`);
                } else if (Number(val) < 0) {
                  isRowValid = false;
                  errors.push(`Row ${i + 1}: Field '${field.label}' expects a non-negative number, but got '${val}'.`);
                }
              } else if (field.type === "enum" && field.options) {
                if (field.key === "role") {
                  const mapped = mapRoleFriendly(val);
                  if (!mapped) {
                    isRowValid = false;
                    errors.push(`Row ${i + 1}: Role '${val}' is not recognized as a valid MENAREPS role.`);
                  } else {
                    record[field.label] = mapped; // Standardize spelling
                  }
                } else {
                  const match = field.options.find(opt => opt.toLowerCase().trim() === val.toLowerCase().trim());
                  if (!match) {
                    isRowValid = false;
                    errors.push(`Row ${i + 1}: Field '${field.label}' value '${val}' is invalid. Options are: ${field.options.join(", ")}`);
                  } else {
                    record[field.label] = match; // Standardize spelling
                  }
                }
              } else if (field.type === "boolean") {
                const lower = val.toLowerCase().trim();
                if (lower === "true" || lower === "yes" || lower === "active" || lower === "1" || lower === "enabled") {
                  record[field.label] = "true";
                } else if (lower === "false" || lower === "no" || lower === "inactive" || lower === "0" || lower === "disabled") {
                  record[field.label] = "false";
                } else {
                  isRowValid = false;
                  errors.push(`Row ${i + 1}: Field '${field.label}' expects a boolean/status (Active/Inactive, Yes/No, True/False, 1/0, Enabled/Disabled), but got '${val}'.`);
                }
              }
            }
          });

          // 3.3. Lookups and Policy Engine validation
          if (selectedModule === "Users") {
            const mappedRole = record["Role"] as Role;
            const emailStr = record["Email"] || "";

            // Check actor authority to create this role
            if (!canCreateRole(currentUser.role, mappedRole)) {
              isRowValid = false;
              errors.push(`Row ${i + 1}: Role Creation Authorization failed. Actor '${currentUser.role}' is not authorized to create role '${mappedRole}'.`);
            }

            const mgrEmail = record["Manager Email"];
            const rawAreaCodes = record["Area Codes"] || "";
            const rawAreaNames = record["Area Names"] || record["Areas"] || "";
            const legacyTerritory = record["Territory"] || "";

            // Helper to parse comma/semicolon/period separated lists
            const parseAreaValues = (rawVal: string, isCodes: boolean) => {
              if (!rawVal) return [];
              const sanitized = String(rawVal).replace(/[\r\n]+/g, " ").trim();
              if (!sanitized) return [];

              let parts: string[] = [];
              let isLegacyPeriod = false;

              // Legacy period checking: contains dot, but no comma or semicolon
              if (sanitized.includes(".") && !sanitized.includes(",") && !sanitized.includes(";")) {
                isLegacyPeriod = true;
              }

              if (isLegacyPeriod) {
                parts = sanitized.split(".");
                const fieldLabel = isCodes ? "Area Codes" : "Area Names";
                const warningMsg = `Warning: Row ${i + 1}: Legacy period-separated format detected in ${fieldLabel} ('${sanitized}'). Please update your worksheet template to use the canonical comma-separated separator.`;
                if (!errors.includes(warningMsg)) {
                  errors.push(warningMsg);
                }
              } else {
                parts = sanitized.split(/[,;]+/);
              }

              const result: string[] = [];
              parts.forEach(part => {
                const cleaned = part.trim();
                if (cleaned) {
                  if (!result.includes(cleaned)) {
                    result.push(cleaned);
                  }
                }
              });
              return result;
            };

            const areaIds = parseAreaValues(rawAreaCodes, true);
            let areaNames = parseAreaValues(rawAreaNames, false);
            if (areaNames.length === 0 && legacyTerritory) {
              areaNames = parseAreaValues(legacyTerritory, false);
            }

            // Resolve Area Names to Area IDs if Area Codes are empty and Area Names are provided
            if (areaIds.length === 0 && areaNames.length > 0) {
              areaNames.forEach(name => {
                const geography = resolveGeographyTuple(
                  record["Country"] || "",
                  record["District"] || "",
                  record["City"] || "",
                  name,
                  { countries: allCountries, districts: allDistricts, cities: allCities, areas: allAreas },
                );
                if (geography.isValid && geography.areaId && !areaIds.includes(geography.areaId)) areaIds.push(geography.areaId);
              });
            }

            if (areaIds.length > 0) {
              record["Area Codes"] = areaIds.join(", ");
              record["Area Names"] = areaNames.join(", ");
            }

            // Virtual user base for hierarchy verification in same sheet
            const virtualUsers: User[] = [
              ...allUsers,
              ...records.map(r => ({
                id: r["Email"],
                email: r["Email"],
                name: `${r["First Name"]} ${r["Last Name"]}`.trim(),
                role: r["Role"] as Role,
                managerEmail: r["Manager Email"]
              } as User))
            ];

            const tempUser: Partial<User> = {
              id: "temp-upload",
              email: emailStr,
              role: mappedRole,
              managerEmail: mgrEmail && mgrEmail.toLowerCase().trim() !== "no manager" ? mgrEmail : "",
              areaIds,
              areaNames,
              active: true,
              employmentStatus: "Active",
              loginAllowed: true,
              isDeleted: false
            };

            const mgrCheck = validateManager(tempUser, virtualUsers);
            if (!mgrCheck.isValid) {
              isRowValid = false;
              errors.push(`Row ${i + 1}: Invalid Manager - ${mgrCheck.reason}`);
            }

            // Verify Area Codes exist canonically and names correspond at same position
            let areaValidationPassed = true;
            if (areaIds.length > 0) {
              // 1. Verify every Area Code exists canonically
              areaIds.forEach(code => {
                const exists = allAreas.some(a => String(a.id).toLowerCase() === code.toLowerCase());
                if (!exists) {
                  isRowValid = false;
                  areaValidationPassed = false;
                  errors.push(`Row ${i + 1}: Invalid Area Code - Area Code '${code}' does not exist in the active areas catalog.`);
                }
              });

              // 2. If codes exist, confirm names match at the same position
              if (areaValidationPassed && areaNames.length > 0) {
                if (areaIds.length !== areaNames.length) {
                  isRowValid = false;
                  errors.push(`Row ${i + 1}: Mismatch - The number of Area Codes (${areaIds.length}) does not match the number of Area Names (${areaNames.length}).`);
                } else {
                  for (let idx = 0; idx < areaIds.length; idx++) {
                    const code = areaIds[idx];
                    const providedName = areaNames[idx];
                    const canonicalArea = allAreas.find(a => String(a.id).toLowerCase() === code.toLowerCase());
                    if (canonicalArea) {
                      if (canonicalArea.name.toLowerCase().trim() !== providedName.toLowerCase().trim()) {
                        isRowValid = false;
                        errors.push(`Row ${i + 1}: Mismatch - Area Code '${code}' corresponds to '${canonicalArea.name}', but Area Name '${providedName}' was provided at position ${idx + 1}.`);
                      }
                    }
                  }
                }
              }
            } else if (areaNames.length > 0) {
              // If areaNames are specified but could not be mapped to any valid Area Code, that is ambiguous/invalid.
              isRowValid = false;
              errors.push(`Row ${i + 1}: Invalid Area Name - Area Names '${areaNames.join(", ")}' could not be resolved to any canonical Area ID.`);
            }

            // Warnings logic for field operational roles (Medical/Sales Reps)
            if (mappedRole === Role.MEDICAL_REP || mappedRole === Role.SALES_REP) {
              errors.push(`Warning: Row ${i + 1}: ${t.repWarningAwaiting}`);
              errors.push(`Warning: Row ${i + 1}: ${t.repWarningReadiness}`);
            }

            // Ignore optional legacy Products columns with warning
            if (record["Products"] || record["products"] || record["Product"]) {
              errors.push(`Warning: Row ${i + 1}: Legacy Products column found. This is ignored during import. Product assignment is completed later in User Management.`);
            }
          }

          if (selectedModule === "Key Messages") {
            const pSku = record["Product SKU"];
            if (pSku) {
              const skuExists = allProducts.some(p => String(p.sku || p.id || "").toLowerCase() === pSku.toLowerCase());
              if (!skuExists) {
                isRowValid = false;
                errors.push(`Row ${i + 1}: Lookup failed - Product SKU '${pSku}' does not exist in the active products catalog.`);
              }
            }
          }

          if (selectedModule === "Products") {
            const pSku = record["Parent Product SKU"];
            if (pSku) {
              const skuExists = allProducts.some(p => String(p.sku || p.id || "").toLowerCase() === pSku.toLowerCase());
              const inSheet = records.some(r => String(r["SKU"]).toLowerCase() === pSku.toLowerCase());
              if (!skuExists && !inSheet) {
                isRowValid = false;
                errors.push(`Row ${i + 1}: Lookup failed - Parent Product SKU '${pSku}' does not exist in the active products catalog.`);
              }
            }
          }

          if (selectedModule === "Physicians" || selectedModule === "Pharmacies") {
            const countryVal = record["Country"] || "";
            const districtVal = record["District"] || "";
            const cityVal = record["City"] || "";
            const areaVal = selectedModule === "Physicians" ? (record["Area/Territory"] || "") : (record["Area"] || "");

            const geoResult = resolveGeographyTuple(countryVal, districtVal, cityVal, areaVal, {
              countries: allCountries,
              districts: allDistricts,
              cities: allCities,
              areas: allAreas,
            });
            if (!geoResult.isValid) {
              isRowValid = false;
              errors.push(`Row ${i + 1}: ${geoResult.error}`);
            } else {
              record["Country ID"] = geoResult.countryId || "";
              record["Country"] = geoResult.countryName || "";
              record["District ID"] = geoResult.districtId || "";
              record["District"] = geoResult.districtName || "";
              record["City ID"] = geoResult.cityId || "";
              record["City"] = geoResult.cityName || "";
              record["Area ID"] = geoResult.areaId || "";
              record["Area"] = geoResult.areaName || "";
              if (selectedModule === "Physicians") {
                record["Area/Territory"] = geoResult.areaName || "";
              }
              record["Area Code"] = geoResult.areaCode || "";
            }

            const repId = record["Assigned Rep ID"];
            if (repId) {
              const repExists = allUsers.some(u => String(u.id || "").toLowerCase() === repId.toLowerCase() || String(u.email || "").toLowerCase() === repId.toLowerCase());
              if (!repExists) {
                isRowValid = false;
                errors.push(`Row ${i + 1}: Lookup failed - Assigned Rep ID '${repId}' is not found in the users list.`);
              }
            }
          }

          // 3.4. Duplicate checks within parsed sheet
          const isLocalDuplicate = records.some((r, rIdx) => {
            if (rIdx === i) return false;
            if (selectedModule === "Users") {
              return String(r["Email"]).toLowerCase() === String(record["Email"]).toLowerCase();
            } else if (selectedModule === "Products") {
              return String(r["SKU"]).toLowerCase() === String(record["SKU"]).toLowerCase();
            } else if (selectedModule === "Physicians" || selectedModule === "Pharmacies") {
              return (record["Email"] && String(r["Email"]).toLowerCase() === String(record["Email"]).toLowerCase()) ||
                     (record["Phone"] && String(r["Phone"]).replace(/\D/g, "") === String(record["Phone"]).replace(/\D/g, ""));
            } else if (selectedModule === "Key Messages") {
              return String(r["Message Content"]).toLowerCase() === String(record["Message Content"]).toLowerCase();
            } else if (selectedModule === "Area Import (Geographic Master)") {
              return String(r["Area Code"]).toLowerCase().trim() === String(record["Area Code"]).toLowerCase().trim();
            }
            return false;
          });

          if (isLocalDuplicate) {
            isRowValid = false;
            errors.push(`Row ${i + 1}: Duplication failed - Found duplicated record inside the uploaded sheet itself.`);
          }

          // 3.5. Selective Duplicate/Existence checking based on Import Operation Mode
          if (selectedModule === "Pharmacies") {
            const pharmDup = classifyPharmacyDuplicate(record, currentDbRecords);
            record._duplicateClassification = pharmDup.type;
            record._duplicateDetail = pharmDup as any;

            if (importMode === "CREATE_NEW_ONLY") {
              if (pharmDup.type === "ACTIVE_DUPLICATE") {
                isRowValid = false;
                errors.push(`Row ${i + 1}: Duplication failed (ACTIVE_DUPLICATE) - Active pharmacy record already exists in the database. Matched by ${pharmDup.matchingKey}. (CREATE_NEW_ONLY mode rejects existing records).`);
              } else if (pharmDup.type === "SOFT_DELETED_DUPLICATE") {
                isRowValid = false;
                errors.push(`Row ${i + 1}: Duplication failed (SOFT_DELETED_DUPLICATE) - Found existing soft-deleted pharmacy record matched by ${pharmDup.matchingKey}. Guidance: Use UPSERT with reactivation or restore the existing Pharmacy.`);
              } else if (pharmDup.type === "AMBIGUOUS_DUPLICATE") {
                isRowValid = false;
                errors.push(`Row ${i + 1}: Duplication failed (AMBIGUOUS_DUPLICATE) - Multiple matching records found in database by ${pharmDup.matchingKey}.`);
              }
            } else if (importMode === "UPDATE_EXISTING_ONLY") {
              if (pharmDup.type === "NO_DUPLICATE") {
                isRowValid = false;
                errors.push(`Row ${i + 1}: Update failed - Record does not exist in the database. (UPDATE_EXISTING_ONLY mode rejects new records).`);
              } else if (pharmDup.type === "SOFT_DELETED_DUPLICATE") {
                isRowValid = false;
                errors.push(`Row ${i + 1}: Update failed (SOFT_DELETED_DUPLICATE) - Target pharmacy is soft-deleted. Do not silently reactivate in UPDATE_EXISTING_ONLY unless explicit reactivateSoftDeleted option is enabled.`);
              } else if (pharmDup.type === "AMBIGUOUS_DUPLICATE") {
                isRowValid = false;
                errors.push(`Row ${i + 1}: Update failed (AMBIGUOUS_DUPLICATE) - Multiple matching records found in database.`);
              }
            } else if (importMode === "UPSERT") {
              if (pharmDup.type === "AMBIGUOUS_DUPLICATE") {
                isRowValid = false;
                errors.push(`Row ${i + 1}: Upsert failed (AMBIGUOUS_DUPLICATE) - Multiple matching records found in database by ${pharmDup.matchingKey}.`);
              }
            }
          } else {
            const isDbDuplicate = currentDbRecords.some(r => {
              if (selectedModule === "Users") {
                return String(r.email || r.Email || "").toLowerCase() === String(record["Email"]).toLowerCase();
              } else if (selectedModule === "Products") {
                const sheetSku = String(record["SKU"] || "").trim().toLowerCase();
                const dbSku = String(r.sku || r.SKU || r.id || "").trim().toLowerCase();
                return sheetSku && dbSku && sheetSku === dbSku;
              } else if (selectedModule === "Physicians") {
                return (record["Email"] && String(r.email || r.Email || "").toLowerCase() === String(record["Email"]).toLowerCase()) ||
                       (record["Phone"] && String(r.phone || r.Phone || "").replace(/\D/g, "") === String(record["Phone"]).replace(/\D/g, ""));
              } else if (selectedModule === "Key Messages") {
                return String(r.message || r.messageContent || "").toLowerCase() === String(record["Message Content"]).toLowerCase();
              } else if (selectedModule === "Area Import (Geographic Master)") {
                const sheetCode = String(record["Area Code"] || "").toLowerCase().trim();
                const dbCode = String(r.code || r.id || "").toLowerCase().trim();
                return sheetCode && dbCode && sheetCode === dbCode;
              }
              return false;
            });

            if (importMode === "CREATE_NEW_ONLY" && isDbDuplicate) {
              isRowValid = false;
              errors.push(`Row ${i + 1}: Duplication failed - Record already exists in the database. (CREATE_NEW_ONLY mode rejects existing records).`);
            } else if (importMode === "UPDATE_EXISTING_ONLY" && !isDbDuplicate) {
              isRowValid = false;
              errors.push(`Row ${i + 1}: Update failed - Record does not exist in the database. (UPDATE_EXISTING_ONLY mode rejects new records).`);
            }
          }

          const rowWarnings = errors.filter(err => err.includes(`Row ${i + 1}:`) && err.includes("Warning:"));
          let rowStatus: "VALID" | "VALID_WITH_WARNINGS" | "INVALID" = "VALID";
          if (rowWarnings.length > 0) {
            rowStatus = "VALID_WITH_WARNINGS";
          }

          if (isRowValid) {
            // Decorate metadata ONLY when UAT mode is explicitly enabled
            const enrichedRecord = {
              ...record,
              _rowStatus: rowStatus,
              isTestData: isUatMode,
              importBatchId: isUatMode ? `BATCH-UAT-${Date.now()}` : "",
              importedAt: isUatMode ? new Date().toISOString() : "",
              importedBy: isUatMode ? (currentUser.name || currentUser.email || "System Admin") : "",
              sourceTemplateCode: isUatMode ? selectedModule : "",
              source: isUatMode ? "Enterprise Import UAT" : "Standard Import"
            };
            records.push(enrichedRecord);
          }
        }

        // Only block if we have actual errors (not warnings)
        const hasBlockingErrors = errors.some(err => !err.includes("Warning:"));

        if (errors.length > 0) {
          setValidationErrors(errors);
        }

        if (hasBlockingErrors) {
          setParsedRecords([]);
          setIsSuccessfullyValidated(false);
        } else {
          setParsedRecords(records);
          setIsSuccessfullyValidated(true);
        }
      } catch (err) {
        setValidationErrors([`File reading failed: ${(err as Error).message}`]);
      }
    };

    // Read file as ArrayBuffer for xlsx
    reader.readAsArrayBuffer(file);
  };

  // Complete and commit records to core state
  const handleCommitImport = async () => {
    if (parsedRecords.length === 0) return;
    try {
      const result: any = await onImportSuccess(selectedModule, parsedRecords, importMode);
      
      // Honest validation: If zero persisted documents or result is explicitly unsuccessful / failed
      if (!result || !result.success || result.status === "FAILED" || (result.persistedDocumentIds && result.persistedDocumentIds.length === 0)) {
        const errorMsg = (result?.errors && result.errors.length > 0) 
          ? result.errors.join("; ") 
          : (result?.error || "Zero canonical documents were persisted.");
        alert(isRtl ? `فشل الاستيراد: ${errorMsg}` : `Import failed: ${errorMsg}`);
        return;
      }

      if (result.status === "PARTIAL") {
        const warnMsg = `Import completed partially. Created: ${result.createdCount || 0}, Updated: ${result.updatedCount || 0}, Failed/Skipped: ${(result.failedCount || 0) + (result.skippedCount || 0)}.`;
        alert(isRtl ? `تم الاستيراد جزئياً: ${warnMsg}` : warnMsg);
      }
      
      // Reset uploader ONLY when actual persistence is verified!
      setUploadedFileName("");
      setParsedRecords([]);
      setIsSuccessfullyValidated(false);
    } catch (err: any) {
      alert(isRtl ? `حدث خطأ غير متوقع أثناء استيراد البيانات: ${err.message}` : `Unexpected error occurred during import: ${err.message}`);
    }
  };

  // Helper to trigger dummy download of the selected module CSV template
  const handleDownloadTemplate = () => {
    const schema = moduleSchemas[selectedModule];
    const data = [
      schema.headers,
      ...schema.demoData.map(row => schema.headers.map(h => row[h] || ""))
    ];
    
    const worksheet = XLSX.utils.aoa_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Template");
    
    // Save as .xlsx
    const fileName = schema.templateName.replace(".csv", ".xlsx");
    XLSX.writeFile(workbook, fileName);
  };

  return (
    <div className="space-y-6" id="import-module-wrapper" dir={isRtl ? "rtl" : "ltr"}>
      
      {/* Title Header */}
      <div className="border-b border-slate-100 dark:border-slate-800 pb-5" id="import-header">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
          {t.importTitle}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          {t.importSubtitle}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6" id="import-layout-grid">
        
        {/* Main interactive import workspace */}
        <div className="lg:col-span-2 space-y-6" id="uploader-workspace">
          
          <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-5 space-y-4" id="import-module-selection">
            <div>
              <label className="block text-xxs font-mono text-slate-400 uppercase mb-2">{t.moduleSelect}</label>
              <div className="grid grid-cols-2 md:grid-cols-6 gap-2" id="module-tabs">
                {(["Physicians", "Pharmacies", "Products", "Key Messages", "Users", "Area Import (Geographic Master)"] as const).map((mod) => (
                  <button
                    key={mod}
                    onClick={() => {
                      setSelectedModule(mod);
                      setUploadedFileName("");
                      setParsedRecords([]);
                      setValidationErrors([]);
                      setIsSuccessfullyValidated(false);
                    }}
                    className={`px-3 py-2 text-xs font-semibold rounded-lg border transition-all ${selectedModule === mod ? "bg-blue-600 border-blue-600 text-white" : "border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 bg-transparent hover:bg-slate-50"}`}
                  >
                    {mod}
                  </button>
                ))}
              </div>
            </div>

            {/* Template Downloader */}
            <div className="flex justify-between items-center bg-slate-50 dark:bg-slate-800/40 p-3 rounded-lg border border-slate-100 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400" id="template-downloader-box">
              <span className="flex items-center gap-2">
                <FileSpreadsheet size={16} className="text-blue-500" />
                <span>MENAREPS official {selectedModule} template structure</span>
              </span>
              <button 
                onClick={handleDownloadTemplate}
                className="flex items-center gap-1 text-blue-600 dark:text-blue-400 font-bold hover:underline cursor-pointer"
                id="btn-download-template"
              >
                <Download size={14} />
                {t.downloadTemplate}
              </button>
            </div>

            {/* Admin-only UAT mode checkbox and Import Mode Selector */}
            {(currentUser.role === Role.ADMIN || currentUser.role === Role.SUPER_ADMIN) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex items-center gap-2 p-3.5 bg-rose-50/50 dark:bg-rose-950/10 border border-rose-100 dark:border-rose-900/60 rounded-lg text-xs" id="uat-mode-box">
                  <input
                    type="checkbox"
                    id="chk-uat-mode"
                    checked={isUatMode}
                    onChange={(e) => setIsUatMode(e.target.checked)}
                    className="w-4 h-4 text-rose-600 border-slate-300 rounded focus:ring-rose-500 cursor-pointer"
                  />
                  <div className="flex flex-col">
                    <label htmlFor="chk-uat-mode" className="font-bold text-rose-800 dark:text-rose-300 cursor-pointer">
                      {isRtl ? "تفعيل وضع استيراد UAT للاختبار" : "Enable UAT / Test Import Mode"}
                    </label>
                    <span className="text-xxs text-slate-500 dark:text-slate-400 mt-0.5">
                      {isRtl 
                        ? "سيتم تمييز جميع السجلات المستوردة كبيانات اختبار (isTestData: true) لتسهيل تنظيفها لاحقاً." 
                        : "All imported records will be marked as test data (isTestData: true) so they can be cleaned up easily."}
                    </span>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5 p-3.5 bg-slate-50 dark:bg-slate-800/25 border border-slate-200/60 dark:border-slate-800 rounded-lg text-xs" id="import-mode-box">
                  <label className="font-bold text-slate-700 dark:text-slate-300">
                    {isRtl ? "وضع تشغيل الاستيراد" : "Import Operation Mode"}
                  </label>
                  <select
                    value={importMode}
                    onChange={(e) => {
                      setImportMode(e.target.value as any);
                      // Clear previous validation if switching modes
                      setParsedRecords([]);
                      setValidationErrors([]);
                      setIsSuccessfullyValidated(false);
                    }}
                    className="w-full px-3 py-1.5 border border-slate-200 dark:border-slate-850 bg-white dark:bg-slate-900 rounded-lg text-xs text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-500 font-medium cursor-pointer"
                  >
                    <option value="UPSERT">UPSERT (Seamless update/overwrite)</option>
                    <option value="CREATE_NEW_ONLY">CREATE_NEW_ONLY (Reject if any records already exist)</option>
                    <option value="UPDATE_EXISTING_ONLY">UPDATE_EXISTING_ONLY (Reject if any records are new)</option>
                  </select>
                  <span className="text-xxs text-slate-400 mt-1 block">
                    {importMode === "UPSERT" && "Updates existing database records matching primary keys, and creates new ones."}
                    {importMode === "CREATE_NEW_ONLY" && "Strict mode: rejects the entire sheet if any record already exists in the CRM."}
                    {importMode === "UPDATE_EXISTING_ONLY" && "Strict mode: rejects the entire sheet if any record is brand new (only updates allowed)."}
                  </span>
                  <div className="mt-1.5 px-2 py-1 bg-amber-50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/40 text-[10px] text-amber-700 dark:text-amber-400 font-medium rounded flex items-center gap-1.5">
                    <AlertTriangle size={12} className="shrink-0 text-amber-500" />
                    <span>
                      {isRtl 
                        ? "الوضع الذري: أي صف غير صالح أو تكرار غير متطابق سيمنع حفظ ملف البيانات بالكامل." 
                        : "Atomic Mode: Any invalid row or duplicate mismatch will block the entire spreadsheet commit."}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {selectedModule === "Users" && (
              <div className="bg-blue-50/50 dark:bg-blue-950/10 border border-blue-100 dark:border-blue-900/60 p-3.5 rounded-lg space-y-2 text-xs" id="users-roles-hint">
                <p className="font-bold text-blue-800 dark:text-blue-300 flex items-center gap-1.5">
                  <CheckCircle size={14} />
                  {isRtl ? "الأدوار المعتمدة والمطابقة تلقائياً في النظام:" : "Accepted Roles & Auto-mapping in System:"}
                </p>
                <p className="text-xxs text-slate-500 dark:text-slate-400 leading-relaxed">
                  {isRtl 
                    ? "يمكنك استخدام الأسماء التالية للتحقق من المخطط وسيقوم النظام بمطابقتها بشكل مرن وتلقائي (غير حساسة لحالة الأحرف):" 
                    : "You can copy and paste any of these values directly into your CSV (the mapping is highly resilient and case-insensitive):"}
                </p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5 pt-1 text-xxs font-mono text-slate-700 dark:text-slate-300">
                  {CANONICAL_USER_ROLES.map((r) => (
                    <span key={r} className="bg-white dark:bg-slate-800 px-2 py-1 rounded border border-slate-100 dark:border-slate-800/50">
                      {r}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Drag & Drop Area */}
          <div 
            onDragEnter={handleDrag}
            onDragOver={handleDrag}
            onDragLeave={handleDrag}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`bg-white dark:bg-slate-900 border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all ${dragActive ? "border-blue-500 bg-blue-50/20" : "border-slate-200 dark:border-slate-800 hover:border-slate-300"}`}
            id="drag-drop-zone"
          >
            <input 
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFileChange}
              className="hidden"
            />
            <Upload size={36} className="mx-auto text-slate-300 mb-3" />
            <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              {uploadedFileName ? uploadedFileName : t.dragDrop} <span className="text-blue-600 dark:text-blue-400 hover:underline">{t.browse}</span>
            </p>
            <p className="text-xxs text-slate-400 mt-2">
              {t.supported}
            </p>
          </div>

          {/* Validation Logs */}
          {(validationErrors.length > 0 || isSuccessfullyValidated) && (
            <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-5 space-y-3" id="validation-logs-panel">
              <h4 className="text-xs font-bold text-slate-800 dark:text-white flex items-center gap-2">
                <AlertTriangle size={14} className={validationErrors.length > 0 ? "text-amber-500" : "text-emerald-500"} />
                {t.validationTitle}
              </h4>

              {validationErrors.length > 0 ? (
                <div className="p-3 bg-amber-50/50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900 rounded-lg max-h-40 overflow-y-auto space-y-1.5" id="validation-errors-list">
                  {validationErrors.map((err, idx) => (
                    <p key={idx} className="text-xxs font-mono text-amber-700 dark:text-amber-400">{err}</p>
                  ))}
                </div>
              ) : (
                <div className="p-3.5 bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900 rounded-lg text-xxs font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-2" id="validation-success-banner">
                  <CheckCircle size={14} />
                  <span>{t.validationSuccess} ({parsedRecords.length} lines parsed)</span>
                </div>
              )}

              {isSuccessfullyValidated && (
                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-between items-center" id="validation-actions">
                  <span className="text-xxs text-slate-400">Validated by: {currentUser.name} ({currentUser.role})</span>
                  <button
                    onClick={handleCommitImport}
                    className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg shadow-sm transition-colors cursor-pointer"
                    id="btn-commit-import"
                  >
                    {t.saveImport}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Preview grid */}
          {parsedRecords.length > 0 && (
            <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-5 space-y-3" id="import-preview-grid">
              <h3 className="text-sm font-semibold text-slate-800 dark:text-white">
                {t.preview} ({parsedRecords.length})
              </h3>
              <div className="border border-slate-100 dark:border-slate-800 rounded-xl overflow-x-auto" id="preview-table-container">
                <table className="w-full text-left text-xxs">
                  <thead className="bg-slate-50 dark:bg-slate-800 text-slate-400 font-mono uppercase tracking-wider">
                    <tr>
                      <th className="p-2 w-28">Import Status</th>
                      {moduleSchemas[selectedModule].headers.slice(0, 5).map(h => (
                        <th key={h} className="p-2">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                    {parsedRecords.slice(0, 5).map((row, rIdx) => {
                      const status = row._rowStatus || "VALID";
                      let badgeStyle = "bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/30";
                      if (status === "VALID_WITH_WARNINGS") {
                        badgeStyle = "bg-amber-50 text-amber-700 border-amber-100 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-900/30";
                      } else if (status === "INVALID") {
                        badgeStyle = "bg-rose-50 text-rose-700 border-rose-100 dark:bg-rose-950/20 dark:text-rose-400 dark:border-rose-900/30";
                      }

                      return (
                        <tr key={rIdx}>
                          <td className="p-2">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${badgeStyle}`}>
                              {status === "VALID_WITH_WARNINGS" ? "VALID WITH WARNINGS" : status}
                            </span>
                          </td>
                          {moduleSchemas[selectedModule].headers.slice(0, 5).map(h => (
                            <td key={h} className="p-2 max-w-xs truncate">{row[h]}</td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>

        {/* Import transaction history and active rollback triggers */}
        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-5 flex flex-col" id="import-history-sidebar">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
            <Clock size={16} className="text-slate-400" />
            {t.history}
          </h3>

          <div className="flex-1 space-y-4" id="history-items">
            {importHistory.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-6">No previous imports recorded in this session.</p>
            ) : (
              importHistory.map((hist) => (
                <div key={hist.id} className="p-3 border border-slate-100 dark:border-slate-800 rounded-lg space-y-2 text-xs" id={`history-item-${hist.id}`}>
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="font-bold text-slate-800 dark:text-white">{hist.module}</h4>
                      <p className="text-xxs text-slate-400 font-mono mt-0.5">{hist.fileName}</p>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-xxs font-mono ${hist.status === "Completed" ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600" : "bg-rose-50 dark:bg-rose-950/40 text-rose-600"}`}>
                      {hist.status}
                    </span>
                  </div>

                  <div className="text-xxs text-slate-400 space-y-1 font-mono">
                    <p>{t.records}: {hist.recordCount}</p>
                    {hist.createdCount !== undefined && <p>Created: {hist.createdCount}</p>}
                    {hist.updatedCount !== undefined && <p>Updated: {hist.updatedCount}</p>}
                    {hist.skippedCount !== undefined && <p>Skipped: {hist.skippedCount}</p>}
                    {hist.errorsCount !== undefined && <p>Errors: {hist.errorsCount}</p>}
                    {hist.durationMs !== undefined && <p>Duration: {hist.durationMs}ms</p>}
                    <p>{t.importedBy}: {hist.importedBy}</p>
                    <p>Time: {hist.importedAt}</p>
                  </div>

                  {hist.status === "Completed" && (
                    <button
                      onClick={() => onRollbackImport(hist.id)}
                      className="w-full mt-2 py-1 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/20 dark:hover:bg-rose-900/30 text-rose-600 dark:text-rose-400 text-xxs font-bold rounded flex items-center justify-center gap-1 transition-colors cursor-pointer"
                      id={`btn-rollback-${hist.id}`}
                    >
                      <RotateCcw size={12} />
                      {t.rollback}
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

      </div>

    </div>
  );
}
