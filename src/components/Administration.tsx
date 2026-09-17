import React, { useState, useEffect, useMemo } from "react";
import { 
  Shield, 
  Check, 
  AlertCircle, 
  Lock, 
  Settings, 
  Users, 
  Eye, 
  Edit3, 
  Trash2, 
  FileCheck, 
  ArrowRightLeft,
  DollarSign,
  MapPin,
  Globe,
  Coins,
  GitBranch,
  Search,
  ClipboardList,
  Layers,
  Plus
} from "lucide-react";
import { Role, Permissions, Country, District, City, Area, CANONICAL_USER_ROLES, Physician, Pharmacy } from "../types";
import { rbacMatrixApplicability } from "../lib/canonicalPermissionApplicability";
import { motion } from "motion/react";
import { collection, onSnapshot, doc, setDoc, deleteDoc, writeBatch } from "firebase/firestore";
import { db, auth, firestoreDatabaseId } from "../lib/firebase";
import { classifyPhysicianGeography, removeUndefinedRecursively } from "../utils/importNormalization";
import GeographyRepairCenter from "./GeographyRepairCenter";
import GeographyConsolidationCenter from "./GeographyConsolidationCenter";
import { auditProductAssignments } from "../lib/productAssignmentAudit";
import { validateMarketSettings, type BusinessCalendarException, type MarketBusinessSettings } from "../lib/marketSettings";
import { ENTERPRISE_WORKFLOW_TEMPLATE, isOrderWorkflowTemplate } from "../features/orders/orderWorkflowTemplate";
import { createConfigurationAuditEvent } from "../lib/configurationAudit";
import { areasForCity, citiesForDistrict, districtsForCountry, marketDraftForCountry, marketSettingsForPersistence, marketSettingsValidationMessages, supportedIanaTimezones, unconfiguredMarketDraft, WORKING_DAY_OPTIONS } from "../lib/regionalSettingsAdmin";

interface AdministrationProps {
  lang: "en" | "ar";
  permissionsMatrix: Record<Role, Permissions>;
  onUpdatePermissions: (matrix: Record<Role, Permissions>) => void;
  onLogAudit: (action: string, entity: string, details: string) => void;
  initialTab?: "rbac" | "geography" | "localization" | "order-workflow" | "product-audits" | "diagnostics";
  currentUser?: any;
  physicians?: Physician[];
  pharmacies?: Pharmacy[];
}

export default function Administration({
  lang,
  permissionsMatrix,
  onUpdatePermissions,
  onLogAudit,
  initialTab = "rbac",
  currentUser,
  physicians: propPhysicians = [],
  pharmacies: propPharmacies = []
}: AdministrationProps) {
  const isRtl = lang === "ar";
  const [activeTab, setActiveTab] = useState<"rbac" | "geography" | "localization" | "order-workflow" | "product-audits" | "diagnostics">(initialTab as any);
  const [selectedRole, setSelectedRole] = useState<Role>(Role.MEDICAL_REP);
  const [successMsg, setSuccessMsg] = useState("");

  // Master Geography lists from Firestore with fallback to INITIAL arrays
  const [countries, setCountries] = useState<Country[]>([]);
  const [districts, setDistricts] = useState<District[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);

  // References check master lists & states
  const [physicians] = useState<any[]>(propPhysicians);
  const [pharmacies] = useState<any[]>(propPharmacies);
  const [territories, setTerritories] = useState<any[]>([]);
  const [usersList, setUsersList] = useState<any[]>([]);
  const [territoryAssignments, setTerritoryAssignments] = useState<any[]>([]);
  const [physicianVisitsList, setPhysicianVisitsList] = useState<any[]>([]);
  const [pharmacyVisitsList, setPharmacyVisitsList] = useState<any[]>([]);
  const [ordersList, setOrdersList] = useState<any[]>([]);
  const [productsList, setProductsList] = useState<any[]>([]);
  const [productAssignmentsList, setProductAssignmentsList] = useState<any[]>([]);
  const [promotionGroupsList, setPromotionGroupsList] = useState<any[]>([]);
  const [marketSettings, setMarketSettings] = useState<MarketBusinessSettings[]>([]);
  const [calendarExceptions, setCalendarExceptions] = useState<BusinessCalendarException[]>([]);
  const [selectedMarketId, setSelectedMarketId] = useState("");
  const [marketDraft, setMarketDraft] = useState<MarketBusinessSettings>(() => unconfiguredMarketDraft());
  const [marketValidationMessages, setMarketValidationMessages] = useState<string[]>([]);
  const timezoneOptions = useMemo(() => supportedIanaTimezones(), []);
  const [holidayDraft, setHolidayDraft] = useState({ date: "", nameEn: "", nameAr: "", type: "PUBLIC" as BusinessCalendarException["type"], regionId: "" });

  // UAT Deletion and Reference modal states
  const [viewRefArea, setViewRefArea] = useState<Area | null>(null);
  const [showCleanupModal, setShowCleanupModal] = useState(false);
  const [selectedUatIds, setSelectedUatIds] = useState<string[]>([]);
  const [cleanupReport, setCleanupReport] = useState<any | null>(null);

  const isAdminUser = currentUser?.role === Role.ADMIN || currentUser?.role === Role.SUPER_ADMIN || currentUser?.role === "Admin" || currentUser?.role === "Super Admin";

  useEffect(() => {
    const unsubTerritories = onSnapshot(collection(db, "territories"), (snap) => {
      setTerritories(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, err => console.error(err));

    const unsubUsers = onSnapshot(collection(db, "users"), (snap) => {
      setUsersList(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, err => console.error(err));

    const unsubAssignments = onSnapshot(collection(db, "userTerritoryAssignments"), (snap) => {
      setTerritoryAssignments(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, err => console.error(err));

    const unsubProducts = onSnapshot(collection(db, "products"), (snap) => {
      setProductsList(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, err => console.error(err));

    const unsubProductAssignments = onSnapshot(collection(db, "userProductAssignments"), (snap) => {
      setProductAssignmentsList(snap.docs.map(doc => ({ assignmentId: doc.id, ...doc.data() })));
    }, err => console.error(err));

    const unsubPromotionGroups = onSnapshot(collection(db, "productPromotionGroups"), (snap) => {
      setPromotionGroupsList(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, err => console.error(err));

    const unsubMarketSettings = onSnapshot(collection(db, "marketSettings"), (snap) => {
      const records = snap.docs.map(doc => ({ marketId: doc.id, ...doc.data() } as MarketBusinessSettings));
      setMarketSettings(records);
    }, err => console.error(err));
    const unsubCalendar = onSnapshot(collection(db, "businessCalendarExceptions"), snap => setCalendarExceptions(snap.docs.map(item => ({ id: item.id, ...item.data() } as BusinessCalendarException))), err => console.error(err));
    const unsubWorkflow = onSnapshot(doc(db, "orderWorkflowTemplates", ENTERPRISE_WORKFLOW_TEMPLATE.templateId), snapshot => { const candidate = snapshot.exists() ? snapshot.data() : null; if (isOrderWorkflowTemplate(candidate)) setWorkflowRule(value => ({ ...value, ...(candidate.policy || {}) })); }, err => console.error("[ORDER_WORKFLOW_TEMPLATE_READ_ERROR]", err));

    return () => {
      unsubTerritories();
      unsubUsers();
      unsubAssignments();
      unsubProducts();
      unsubProductAssignments();
      unsubPromotionGroups();
      unsubMarketSettings();
      unsubCalendar();
      unsubWorkflow();
    };
  }, []);

  useEffect(() => {
    const selectedCountry = countries.find((country) => country.id === selectedMarketId);
    if (!selectedCountry) return;
    setMarketDraft(marketDraftForCountry(selectedCountry, marketSettings));
    setMarketValidationMessages([]);
  }, [countries, marketSettings, selectedMarketId]);
  const saveMarketSettings = async () => {
    const normalizedDraft = marketSettingsForPersistence(marketDraft);
    const validationMessages = marketSettingsValidationMessages(normalizedDraft);
    if (!isAdminUser || validateMarketSettings(normalizedDraft).length || validationMessages.length) {
      setMarketValidationMessages(validationMessages.length ? validationMessages : [isRtl ? "إعدادات السوق غير صالحة" : "Market settings are invalid."]);
      return;
    }
    const actorUid = currentUser?.uid || currentUser?.id || auth.currentUser?.uid; if (!actorUid) return;
    const before = marketSettings.find(item => item.marketId === normalizedDraft.marketId) || null; const now = new Date().toISOString(); const after = { ...normalizedDraft, updatedBy: actorUid, updatedAt: now, createdBy: normalizedDraft.createdBy || actorUid, createdAt: normalizedDraft.createdAt || now };
    const audit = createConfigurationAuditEvent({ domain: "MARKET", entityId: after.marketId, action: before ? "UPDATE" : "CREATE", actorUid, actorRole: currentUser.role, occurredAt: now, before, after }); const batch = writeBatch(db); batch.set(doc(db, "marketSettings", after.marketId), after); batch.set(doc(db, "configurationAudit", audit.eventId), audit); await batch.commit(); setMarketValidationMessages([]); showToast(isRtl ? "تم حفظ إعدادات السوق" : "Market settings saved");
  };

  const saveCalendarException = async () => {
    const market = marketSettings.find(item => item.countryId === selectedMarketId); const actorUid = currentUser?.uid || currentUser?.id || auth.currentUser?.uid;
    if (!isAdminUser || !market || !actorUid || !/^\d{4}-\d{2}-\d{2}$/.test(holidayDraft.date) || !holidayDraft.nameEn.trim() || !holidayDraft.nameAr.trim()) return;
    const now = new Date().toISOString(); const id = `${market.marketId}:${holidayDraft.date}:${holidayDraft.type}:${holidayDraft.regionId || "ALL"}`; const record: BusinessCalendarException = { id, marketId: market.marketId, countryId: market.countryId, date: holidayDraft.date, nameEn: holidayDraft.nameEn.trim(), nameAr: holidayDraft.nameAr.trim(), type: holidayDraft.type, active: true, ...(holidayDraft.regionId.trim() ? { regionId: holidayDraft.regionId.trim() } : {}), createdBy: actorUid, createdAt: now, updatedBy: actorUid, updatedAt: now };
    const audit = createConfigurationAuditEvent({ domain: "BUSINESS_CALENDAR", entityId: id, action: "CREATE", actorUid, actorRole: currentUser.role, occurredAt: now, before: null, after: record as unknown as Record<string, unknown> }); const batch = writeBatch(db); batch.set(doc(db, "businessCalendarExceptions", id), record); batch.set(doc(db, "configurationAudit", audit.eventId), audit); await batch.commit(); setHolidayDraft({ date: "", nameEn: "", nameAr: "", type: "PUBLIC", regionId: "" }); showToast(isRtl ? "تم حفظ يوم التقويم" : "Calendar exception saved");
  };

  // Sub-tab within Geography tab
  const [geoTab, setGeoTab] = useState<"countries" | "districts" | "cities" | "areas" | "repair" | "consolidation">("areas");

  // General Geography CRUD Form state
  const [editGeoId, setEditGeoId] = useState<string | null>(null);
  const [geoCountryId, setGeoCountryId] = useState("");
  const [geoCountryName, setGeoCountryName] = useState("");
  const [geoCountryCode, setGeoCountryCode] = useState("");

  const [geoDistrictId, setGeoDistrictId] = useState("");
  const [geoDistrictName, setGeoDistrictName] = useState("");

  const [geoCityId, setGeoCityId] = useState("");
  const [geoCityName, setGeoCityName] = useState("");

  const [geoAreaName, setGeoAreaName] = useState("");

  useEffect(() => {
    const unsubCountries = onSnapshot(collection(db, "countries"), (snap) => {
      const docs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Country));
      setCountries(docs);
    }, (err) => {
      console.error(err);
      setCountries([]);
    });

    const unsubDistricts = onSnapshot(collection(db, "districts"), (snap) => {
      const docs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as District));
      setDistricts(docs);
    }, (err) => {
      console.error(err);
      setDistricts([]);
    });

    const unsubCities = onSnapshot(collection(db, "cities"), (snap) => {
      const docs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as City));
      setCities(docs);
    }, (err) => {
      console.error(err);
      setCities([]);
    });

    const unsubAreas = onSnapshot(collection(db, "areas"), (snap) => {
      const docs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Area));
      setAreas(docs);
    }, (err) => {
      console.error(err);
      setAreas([]);
    });

    return () => {
      unsubCountries();
      unsubDistricts();
      unsubCities();
      unsubAreas();
    };
  }, []);

  // Workflows states
  const [lockTimer, setLockTimer] = useState("20");
  const [requiredDetail, setRequiredDetail] = useState("1");

  // Order workflow settings state
  const [workflowRule, setWorkflowRule] = useState(() => ({
      autoApprovalThreshold: "DEPRECATED_RETIRED",
      creditCheckEnabled: true,
      stockReservationHours: "24",
      allowDraftOrders: true,
      allowStageConsolidation: true,
      requireRejectComment: true,
      requireReturnComment: true,
      requireCancelReason: true
    }));

  const assignmentAudit = useMemo(() => auditProductAssignments({
    users: usersList,
    assignments: productAssignmentsList,
    products: productsList,
    promotionGroups: promotionGroupsList,
    territoryAssignments,
  }), [usersList, productAssignmentsList, productsList, promotionGroupsList, territoryAssignments]);
  const auditAssignments = assignmentAudit.rows.map(row => ({
    code: row.assignmentId,
    repName: row.userName,
    productName: row.productName,
    promotionGroup: row.productGroupName,
    territory: row.geography || "NO_ACTIVE_GEOGRAPHY",
    status: row.codes.join(", "),
    valid: row.valid,
  }));

  // Firebase Runtime Diagnostic States
  const [idTokenData, setIdTokenData] = useState<any>(null);
  const [backendDiagnostic, setBackendDiagnostic] = useState<any>(null);
  const [probeResults, setProbeResults] = useState<any[]>([]);
  const [isRunningProbes, setIsRunningProbes] = useState(false);
  const [comparisonResult, setComparisonResult] = useState<{ projectMatch: string; dbMatch: string }>({ projectMatch: "UNKNOWN", dbMatch: "UNKNOWN" });

  const runFirebaseDiagnostics = async () => {
    setIsRunningProbes(true);
    const results: any[] = [];
    const currentAuthUser = auth.currentUser;

    if (!currentAuthUser) {
      setIsRunningProbes(false);
      return;
    }

    try {
      const token = await currentAuthUser.getIdToken(true);
      if (token) {
        try {
          const base64Url = token.split('.')[1];
          const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
          const payload = JSON.parse(window.atob(base64));
          setIdTokenData({
            aud: payload.aud,
            iss: payload.iss,
            auth_time: payload.auth_time,
            exp: payload.exp
          });
        } catch (jwtErr) {
          console.warn("Could not parse JWT token payload safely", jwtErr);
        }

        // Fetch backend diagnostics
        try {
          const res = await fetch("/api/admin/firebase-diagnostic", {
            headers: {
              "Authorization": `Bearer ${token}`,
              "Content-Type": "application/json"
            }
          });
          if (res.ok) {
            const data = await res.json();
            setBackendDiagnostic(data);
          } else {
            setBackendDiagnostic({ error: `HTTP ${res.status}: ${res.statusText}` });
          }
        } catch (apiErr: any) {
          setBackendDiagnostic({ error: apiErr.message || "Failed to reach backend diagnostic API" });
        }
      }
    } catch (tokenErr) {
      console.warn("Could not retrieve ID Token", tokenErr);
    }

    // Run safe read-only probes
    const collectionsToProbe = [
      { name: `users/${currentAuthUser.uid}`, type: "document", path: `users/${currentAuthUser.uid}` },
      { name: "systemStatus/connectivityProbe", type: "document", path: "systemStatus/connectivityProbe" },
      { name: "products", type: "collection", path: "products" },
      { name: "physicians", type: "collection", path: "physicians" },
      { name: "pharmacies", type: "collection", path: "pharmacies" },
      { name: "physicianSpecialties", type: "collection", path: "physicianSpecialties" },
      { name: "importHistory", type: "collection", path: "importHistory" }
    ];

    for (const item of collectionsToProbe) {
      try {
        if (item.type === "document") {
          const { getDoc } = await import("firebase/firestore");
          const parts = item.path.split("/");
          const colName = parts[0];
          const docId = parts.slice(1).join("/");
          const snap = await getDoc(doc(db, colName, docId));
          results.push({
            path: item.path,
            success: true,
            exists: snap.exists(),
            info: snap.exists() ? "Document exists" : "Document does not exist",
            count: snap.exists() ? 1 : 0,
            errorCode: "",
            errorMessage: "",
            databaseId: firestoreDatabaseId
          });
        } else {
          const { getDocs, collection, query, limit } = await import("firebase/firestore");
          const q = query(collection(db, item.path), limit(1));
          const snap = await getDocs(q);
          results.push({
            path: item.path,
            success: true,
            exists: !snap.empty,
            info: `Successfully fetched ${snap.size} sample records`,
            count: snap.size,
            errorCode: "",
            errorMessage: "",
            databaseId: firestoreDatabaseId
          });
        }
      } catch (err: any) {
        results.push({
          path: item.path,
          success: false,
          exists: false,
          info: "Failed to read collection/document",
          count: 0,
          errorCode: err.code || "unknown_error",
          errorMessage: err.message || "Missing or insufficient permissions",
          databaseId: firestoreDatabaseId
        });
      }
    }

    setProbeResults(results);

    const EXPECTED_PROJ = "menareps-crm-production-5046c";
    const EXPECTED_DB = "(default)";

    const actualProj = auth.app.options.projectId || "";
    const actualDb = firestoreDatabaseId || "";

    const projMatch = actualProj === EXPECTED_PROJ ? "MATCH" : (actualProj ? "MISMATCH" : "UNKNOWN");
    const dbMatch = actualDb === EXPECTED_DB ? "MATCH" : (actualDb ? "MISMATCH" : "UNKNOWN");

    setComparisonResult({ projectMatch: projMatch, dbMatch: dbMatch });
    setIsRunningProbes(false);

    // Log the structured block
    console.info("=== MENAREPS FIREBASE RUNTIME DIAGNOSTIC ===");
    console.info(`projectId: ${actualProj}`);
    console.info(`authDomain: ${auth.app.options.authDomain || ""}`);
    console.info(`appId: ${auth.app.options.appId || ""}`);
    console.info(`authUid: ${currentAuthUser.uid}`);
    console.info(`authEmail: ${currentAuthUser.email || ""}`);
    console.info(`firestoreDatabaseId: ${actualDb}`);
    console.info(`backendProjectId: ${EXPECTED_PROJ}`);
    console.info(`backendDatabaseId: ${EXPECTED_DB}`);
    console.info(`serviceAccountProjectId: ${actualProj}`);
    console.info(`cloudRunRegion: europe-west1`);
    console.info("probeResults:", results);
    console.info("=== END DIAGNOSTIC ===");
  };

  useEffect(() => {
    if (activeTab === "diagnostics") {
      runFirebaseDiagnostics();
    }
  }, [activeTab]);

  // Localization labels
  const t = {
    en: {
      adminTitle: "Administration & Workflow Controls",
      adminSubtitle: "Configure enterprise security matrices, operational roles, and detailing parameters",
      matrixTitle: "Role-Based Access Control (RBAC) Matrix",
      matrixDesc: `Manage permission flags mapped across all ${CANONICAL_USER_ROLES.length} canonical enterprise roles`,
      roleSelect: "Select Role to Configure",
      saveMatrix: "Apply Matrix Configuration",
      successAlert: "RBAC Matrix updated successfully. Change logged in security audit ledger.",
      workflowsTitle: "Operational Field Detailing Workflows",
      workflowsDesc: "Tune visit configurations, detailing requirements, and field timers",
      lockTimer: "Maximum Visit Detailing Lock Timer (minutes)",
      requiredDetail: "Minimum product detailing logs required per physician call",
      permName: "Permission Attribute",
      allowed: "Allowed Status",
      geofenceTitle: "Customer GPS Verification Audit",
      geofenceDesc: "Read-only global compliance audit for physician and pharmacy GPS location records",
      localTitle: "Regional Localization & Taxes",
      localDesc: "Configuring regional currency symbols, localized date formats, and VAT thresholds for specific trade zones",
      orderWorkTitle: "Order Workflow & Approval Rules",
      orderWorkDesc: "Defining automated approval gateways, credit limit alert configurations, and stock reservation priority rules",
      auditTitle: "Product Role Assignment Audit",
      auditDesc: "Tracking which medical representative is allocated to detail specific brands in their assigned micro-territory",
      saveLocal: "Save Localization Options",
      saveWorkflow: "Apply Order Workflow Rules",
      auditedAlloc: "Audited Allocations",
      correctAlloc: "Correct Allocations",
      mappingAnom: "Mapping Anomalies"
    },
    ar: {
      adminTitle: "لوحة التحكم بالإدارة وصلاحيات العمل",
      adminSubtitle: "تكوين مصفوفة الحماية والخصوصية، والأدوار التشغيلية، ومحددات العمل الميداني",
      matrixTitle: "مصفوفة التحكم بالصلاحيات القائمة على الأدوار (RBAC)",
      matrixDesc: `إدارة تفويضات ومستويات الوصول الموزعة على ${CANONICAL_USER_ROLES.length} دوراً وظيفياً معتمداً لمؤسستك`,
      roleSelect: "اختر الدور الوظيفي للتعديل",
      saveMatrix: "تطبيق وحفظ التعديلات",
      successAlert: "تم تحديث مصفوفة الصلاحيات بنجاح. تم تدوين الحركة في سجل التدقيق الأمني.",
      workflowsTitle: "إعدادات تدفقات العمل الميداني والزيارات",
      workflowsDesc: "ضبط إعدادات الزيارات، والحد الأدنى للتفصيل، ومؤقتات العمل الميداني",
      lockTimer: "الحد الأقصى لمؤقت الزيارة الميدانية (بالدقائق)",
      requiredDetail: "الحد الأدنى لعدد المنتجات المطلوب تفصيلها في كل زيارة طبيب",
      permName: "الخاصية الصلاحية",
      allowed: "حالة التفويض",
      geofenceTitle: "تدقيق التوثيق الجغرافي للعملاء",
      geofenceDesc: "تدقيق أمني شامل للاطلاع فقط لسجلات الموقع الجغرافي للأطباء والصيدليات",
      localTitle: "الإعدادات الإقليمية والمحلية",
      localDesc: "ضبط اللغات المعتمدة، العملات المحلية، ومحددات ضريبة المبيعات للأقاليم المختلفة",
      orderWorkTitle: "إعدادات سير العمل للطلبات",
      orderWorkDesc: "بناء مسار موافقات المبيعات التلقائية، تفعيل إنذارات الجدارة الائتمانية وقواعد التخصيص",
      auditTitle: "تدقيق تعيين المنتجات للأدوار",
      auditDesc: "سجلات تدقيق تعيين المنتجات الدوائية للمندوبين، والتحقق من كفاءة التوزيع والترويج",
      addFence: "إضافة مضلع جغرافي جديد",
      saveFence: "حفظ إعدادات التحقق الجغرافي",
      saveLocal: "حفظ الخيارات الإقليمية",
      saveWorkflow: "تطبيق قواعد تدفق الطلبات",
      auditedAlloc: "التعيينات المراقبة",
      correctAlloc: "صحة التعيينات للأدوار",
      mappingAnom: "مشاكل تعارض الروابط"
    }
  }[lang];

  // List of all permission keys to map over
  const permissionKeys: { key: Parameters<typeof rbacMatrixApplicability>[1]; label: string; icon: any }[] = [
    { key: "view", label: "View Directory & Records (عرض الملفات والبيانات)", icon: Eye },
    { key: "create", label: "Create Records (إضافة سجلات جديدة)", icon: Edit3 },
    { key: "edit", label: "Edit/Modify Records (تعديل وتحديث البيانات)", icon: Edit3 },
    { key: "delete", label: "Delete Records (حذف السجلات نهائياً)", icon: Trash2 },
    { key: "approve", label: "Approve Orders & Requests (الموافقة والاعتماد)", icon: FileCheck },
    { key: "export", label: "Export Excel/CSV Data (تصدير الملفات والبيانات)", icon: Shield },
    { key: "import", label: "Import Spreadsheet Templates (استيراد أوراق العمل)", icon: Shield },
    { key: "assign", label: "Assign Territory Tasks (تعيين المهام الميدانية)", icon: ArrowRightLeft },
    { key: "reassign", label: "Reassign Territory Tasks (إعادة تعيين وتدوير المهام)", icon: ArrowRightLeft },
    { key: "viewTeamData", label: "View Team Performance Data (مشاهدة بيانات الفريق)", icon: Users },
    { key: "viewNationalData", label: "View National Market Data (مشاهدة البيانات الوطنية)", icon: Users },
    { key: "viewFinancialData", label: "View Financial Targets & Gaps (مشاهدة البيانات المالية)", icon: DollarSign }
  ];

  const handleTogglePermission = (key: keyof Permissions) => {
    const updatedMatrix = { ...permissionsMatrix };
    const rolePerms = { ...updatedMatrix[selectedRole] };
    rolePerms[key] = !rolePerms[key];
    updatedMatrix[selectedRole] = rolePerms;
    onUpdatePermissions(updatedMatrix);
  };

  const handleToggleGovernedCapability = (capability: "resourceManage" | "marketingExecute") => {
    const updatedMatrix = { ...permissionsMatrix };
    const rolePerms = { ...updatedMatrix[selectedRole] };
    if (capability === "resourceManage") {
      rolePerms.resourceCapabilities = {
        ...rolePerms.resourceCapabilities,
        manage: rolePerms.resourceCapabilities?.manage !== true,
      };
    } else {
      rolePerms.marketingRequestCapabilities = {
        ...rolePerms.marketingRequestCapabilities,
        execute: rolePerms.marketingRequestCapabilities?.execute !== true,
      };
    }
    updatedMatrix[selectedRole] = rolePerms;
    onUpdatePermissions(updatedMatrix);
  };

  const handleSaveConfig = () => {
    onLogAudit(
      "Update",
      "Permissions",
      `Modified permission matrix attributes for role '${selectedRole}'.`
    );
    showToast(t.successAlert);
  };

  const showToast = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(""), 4000);
  };

  const getAreaReferenceSummary = (area: Area) => {
    const areaIdLower = area.id.toLowerCase().trim();
    const areaNameLower = area.name.toLowerCase().trim();
    const areaCodeLower = (area.code || "").toLowerCase().trim();

    // 1. Physicians referencing this Area
    const refPhysicians = physicians.filter(p => {
      const pArea = (p.area || p.territory || "").toLowerCase().trim();
      return pArea === areaNameLower || pArea === areaIdLower || pArea === areaCodeLower || p.areaId === area.id;
    });

    // 2. Pharmacies referencing this Area
    const refPharmacies = pharmacies.filter(p => {
      const pArea = (p.area || p.territory || "").toLowerCase().trim();
      return pArea === areaNameLower || pArea === areaIdLower || pArea === areaCodeLower || p.areaId === area.id;
    });

    // 3. Territories referencing this Area
    const refTerritories = territories.filter(t => {
      const tAreas = Array.isArray(t.areas) ? t.areas : [];
      return tAreas.some((a: string) => {
        const aLower = a.toLowerCase().trim();
        return aLower === areaNameLower || aLower === areaIdLower || aLower === areaCodeLower;
      });
    });

    // 4. Users referencing this Area
    const refUsers = usersList.filter(u => {
      const uAreaIds = Array.isArray(u.areaIds) ? u.areaIds : [];
      const uAreaNames = Array.isArray(u.areaNames) ? u.areaNames : [];
      const uTerritories = Array.isArray(u.territories) ? u.territories : [];
      const uTerritory = typeof u.territory === "string" ? u.territory : "";
      
      const hasId = uAreaIds.some((id: string) => id.toLowerCase().trim() === areaIdLower);
      const hasName = uAreaNames.some((name: string) => name.toLowerCase().trim() === areaNameLower) ||
                      uTerritories.some((name: string) => name.toLowerCase().trim() === areaNameLower) ||
                      uTerritory.toLowerCase().trim() === areaNameLower;
      return hasId || hasName;
    });

    // 5. User Territory Assignments referencing this Area
    const refAssignments = territoryAssignments.filter(a => {
      const tId = (a.territoryId || "").toLowerCase().trim();
      const tName = (a.territoryName || "").toLowerCase().trim();
      return tId === areaIdLower || tId === areaCodeLower || tName === areaNameLower;
    });

    // 6. Visits referencing this Area (via Physicians/Pharmacies belonging to this Area)
    const refPhysicianIds = new Set(refPhysicians.map(p => p.id));
    const refPharmacyIds = new Set(refPharmacies.map(p => p.id));

    const refVisits = [
      ...physicianVisitsList.filter(v => refPhysicianIds.has(v.physicianId)),
      ...pharmacyVisitsList.filter(v => refPharmacyIds.has(v.pharmacyId))
    ];

    // 7. Orders referencing this Area (via Pharmacies belonging to this Area)
    const refOrders = ordersList.filter(o => refPharmacyIds.has(o.pharmacyId));

    const totalReferences = refPhysicians.length +
                            refPharmacies.length +
                            refTerritories.length +
                            refUsers.length +
                            refAssignments.length +
                            refVisits.length +
                            refOrders.length;

    return {
      physicians: refPhysicians,
      pharmacies: refPharmacies,
      territories: refTerritories,
      users: refUsers,
      assignments: refAssignments,
      visits: refVisits,
      orders: refOrders,
      totalReferences
    };
  };

  const handleToggleAreaActive = async (area: Area) => {
    try {
      const newActive = area.active === false ? true : false;
      await setDoc(doc(db, "areas", area.id), {
        ...area,
        active: newActive
      }, { merge: true });
      onLogAudit("Update", "areas", `Toggled Area active status: ${area.id} to ${newActive}`);
      showToast(isRtl ? "تم تحديث حالة النشاط بنجاح" : `Area successfully ${newActive ? "activated" : "deactivated"}!`);
    } catch (err: any) {
      console.error(err);
      alert("Error: " + err.message);
    }
  };

  const handleGeoDelete = async (id: string, collectionName: string) => {
    if (collectionName === "areas") {
      const area = areas.find(a => a.id === id);
      if (!area) return;

      if (!isAdminUser) {
        alert(isRtl ? "خطأ: مسموح فقط لمدراء النظام بحذف النطاقات الجغرافية." : "Error: Only Administrators can delete Area master records.");
        return;
      }

      alert(isRtl
        ? "تم إيقاف الحذف المباشر: يتطلب إثبات المراجع خدمة تشخيص خلفية مخولة. استخدم إلغاء التفعيل."
        : "Hard delete is disabled: reference proof requires an authorized backend diagnostic. Deactivate the Area instead.");
      return;

      const summary = getAreaReferenceSummary(area);
      if (summary.totalReferences > 0) {
        alert(isRtl 
          ? `لا يمكن الحذف: هذا الحي مرتبط بـ ${summary.totalReferences} سجلات (أطباء: ${summary.physicians.length}، صيدليات: ${summary.pharmacies.length}، أقاليم: ${summary.territories.length}، مستخدمين: ${summary.users.length}، تعيينات: ${summary.assignments.length}، زيارات: ${summary.visits.length}). يرجى إلغاء تفعيل الحي بدلاً من حذفه.`
          : `Cannot delete: This Area is referenced by ${summary.totalReferences} active records (Physicians: ${summary.physicians.length}, Pharmacies: ${summary.pharmacies.length}, Territories: ${summary.territories.length}, Users: ${summary.users.length}, Assignments: ${summary.assignments.length}, Visits: ${summary.visits.length}). Please deactivate it instead.`
        );
        return;
      }

      if (area.isTestData !== true) {
        alert(isRtl
          ? "لا يمكن الحذف: هذا النطاق الجغرافي محمي كجزء من بيانات الإنتاج الأساسية. يمكن فقط إلغاء تفعيله."
          : "Cannot delete: This Area is protected as official production master data. You can deactivate it instead to preserve history."
        );
        return;
      }

      const confirmation = window.confirm(
        isRtl
          ? `هل أنت متأكد من حذف نطاق UAT الاختباري "${area.name}" بشكل نهائي؟ لا يمكن التراجع عن هذه العملية.`
          : `Are you sure you want to permanently delete the UAT Test Area "${area.name}"? This action cannot be undone.`
      );
      if (!confirmation) return;

      try {
        await deleteDoc(doc(db, "areas", id));
        onLogAudit("Delete", "areas", `Hard-deleted UAT Area record ID: ${id} (${area.name})`);
        showToast(isRtl ? "تم حذف نطاق UAT بنجاح" : "UAT test area deleted successfully!");
      } catch (err: any) {
        console.error(err);
        alert("Error: " + err.message);
      }
      return;
    }

    const confirmation = window.confirm(
      isRtl 
        ? `هل أنت متأكد من حذف هذا السجل من قاعدة البيانات؟` 
        : `Are you sure you want to delete this master record?`
    );
    if (!confirmation) return;

    try {
      await deleteDoc(doc(db, collectionName, id));
      onLogAudit("Delete", collectionName, `Removed master node ID: ${id} from ${collectionName}`);
      showToast(isRtl ? "تم الحذف بنجاح" : "Master record deleted successfully!");
    } catch (err: any) {
      console.error(err);
      alert("Error: " + err.message);
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-full overflow-x-hidden space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      
      {/* Title Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-5">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
            {t.adminTitle}
          </h1>
          <p className="text-xs md:text-sm text-slate-500 dark:text-slate-400 mt-1">
            {t.adminSubtitle}
          </p>
        </div>

        {/* Tab selection */}
        <div className="flex flex-wrap gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg text-[10px] md:text-xs font-bold max-w-full">
          <button 
            onClick={() => setActiveTab("rbac")}
            className={`px-2.5 py-1.5 rounded-md transition-all cursor-pointer ${activeTab === "rbac" ? "bg-white dark:bg-slate-900 text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
          >
            {isRtl ? "مصفوفة الصلاحيات" : "RBAC Matrix"}
          </button>
          <button 
            onClick={() => setActiveTab("geography")}
            className={`px-2.5 py-1.5 rounded-md transition-all cursor-pointer ${activeTab === "geography" ? "bg-white dark:bg-slate-900 text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
          >
            {isRtl ? "إدارة النطاقات الجغرافية" : "Location Management"}
          </button>
          <button 
            onClick={() => setActiveTab("localization")}
            className={`px-2.5 py-1.5 rounded-md transition-all cursor-pointer ${activeTab === "localization" ? "bg-white dark:bg-slate-900 text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
          >
            {isRtl ? "الإعدادات الإقليمية" : "Regional Localization"}
          </button>
          <button 
            onClick={() => setActiveTab("order-workflow")}
            className={`px-2.5 py-1.5 rounded-md transition-all cursor-pointer ${activeTab === "order-workflow" ? "bg-white dark:bg-slate-900 text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
          >
            {isRtl ? "سير عمل الطلبيات" : "Order Workflow"}
          </button>
          <button 
            onClick={() => setActiveTab("product-audits")}
            className={`px-2.5 py-1.5 rounded-md transition-all cursor-pointer ${activeTab === "product-audits" ? "bg-white dark:bg-slate-900 text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
          >
            {isRtl ? "تدقيق التعيينات" : "Product Audits"}
          </button>
          {currentUser?.role === "Super Admin" && (
            <button 
              onClick={() => setActiveTab("diagnostics")}
              className={`px-2.5 py-1.5 rounded-md transition-all cursor-pointer ${activeTab === "diagnostics" ? "bg-white dark:bg-slate-900 text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
            >
              {isRtl ? "فحص الـ Firebase" : "Firebase Diagnostic"}
            </button>
          )}
        </div>
      </div>

      {successMsg && (
        <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900 rounded-xl text-xs font-semibold flex items-center gap-2">
          <Check size={16} />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Conditional layouts based on activeTab */}
      {activeTab === "rbac" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-5 space-y-6">
            <div>
              <h3 className="text-sm font-semibold text-slate-800 dark:text-white flex items-center gap-2">
                <Shield size={16} className="text-blue-500" />
                {t.matrixTitle}
              </h3>
              <p className="text-xxs text-slate-400 mt-0.5">{t.matrixDesc}</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-1">
                <label className="block text-xxs font-mono text-slate-400 uppercase mb-1.5">{t.roleSelect}</label>
                <select
                  value={selectedRole}
                  onChange={(e) => setSelectedRole(e.target.value as Role)}
                  className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-transparent text-slate-800 dark:text-white"
                >
                  {CANONICAL_USER_ROLES.map((role) => (
                    <option key={role} value={role}>{role}</option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-2 p-3 bg-blue-50/40 dark:bg-blue-950/20 border border-blue-100/50 dark:border-blue-900/20 rounded-lg flex items-start gap-2.5 text-xxs text-slate-500">
                <Lock size={14} className="text-blue-500 mt-0.5" />
                <span>Editing permissions changes access controls dynamically across all logged-in representatives. Logged actions are permanently recorded to audit log ledgers for GM and Admin review.</span>
              </div>
            </div>

            {/* Interactive Checkbox list */}
            <div className="border border-slate-100 dark:border-slate-800 rounded-xl overflow-hidden">
              <div className="bg-slate-50 dark:bg-slate-800 px-4 py-2.5 text-xxs font-mono uppercase tracking-wider text-slate-400 flex justify-between">
                <span>{t.permName}</span>
                <span>{t.allowed}</span>
              </div>

              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {permissionKeys.map(({ key, label, icon: Icon }) => {
                  const isAllowed = permissionsMatrix[selectedRole]?.[key] || false;
                  const applicability = rbacMatrixApplicability(selectedRole, key);
                  return (
                    <div key={key} className="px-4 py-3 flex justify-between items-center text-xs">
                      <span className="flex items-center gap-2 font-medium text-slate-700 dark:text-slate-300">
                        <Icon size={14} className="text-slate-400" />
                        {label} <small className="text-slate-400">{applicability === "DENIED" ? "Locked — not applicable" : "Conditional — canonical domain authority required"}</small>
                      </span>
                      <input
                        type="checkbox"
                        checked={isAllowed}
                        disabled={applicability === "DENIED"}
                        onChange={() => handleTogglePermission(key as keyof Permissions)}
                        className="w-4 h-4 text-blue-600 bg-slate-100 border-slate-300 rounded accent-blue-600 cursor-pointer"
                      />
                    </div>
                  );
                })}
                {[
                  { id: "resourceManage", label: "Manage Academic Resources (إدارة الموارد الأكاديمية)", checked: permissionsMatrix[selectedRole]?.resourceCapabilities?.manage === true },
                  { id: "marketingExecute", label: "Confirm Marketing Request Execution (تأكيد تنفيذ طلبات التسويق)", checked: permissionsMatrix[selectedRole]?.marketingRequestCapabilities?.execute === true },
                ].map(capability => (
                  (() => { const applicability = rbacMatrixApplicability(selectedRole, capability.id as "resourceManage" | "marketingExecute"); return (
                  <div key={capability.id} className="px-4 py-3 flex justify-between items-center text-xs">
                    <span className="flex items-center gap-2 font-medium text-slate-700 dark:text-slate-300">
                      <Shield size={14} className="text-slate-400" />
                      {capability.label} <small className="text-slate-400">{applicability === "DENIED" ? "Locked — canonically denied" : applicability === "CONDITIONAL" ? "Conditional — scope/policy required" : "Applicable"}</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={applicability !== "DENIED" && capability.checked}
                      disabled={applicability === "DENIED"}
                      onChange={() => handleToggleGovernedCapability(capability.id as "resourceManage" | "marketingExecute")}
                      className="w-4 h-4 text-blue-600 bg-slate-100 border-slate-300 rounded accent-blue-600 cursor-pointer"
                    />
                  </div>
                  ); })()
                ))}
              </div>
            </div>

            <button
              onClick={handleSaveConfig}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg shadow-sm transition-colors cursor-pointer"
            >
              {t.saveMatrix}
            </button>
          </div>

          {/* Side settings panel for detailing thresholds */}
          <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-5 space-y-6">
            <div>
              <h3 className="text-sm font-semibold text-slate-800 dark:text-white flex items-center gap-2">
                <Settings size={16} className="text-slate-400" />
                {t.workflowsTitle}
              </h3>
              <p className="text-xxs text-slate-400 mt-0.5">{t.workflowsDesc}</p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xxs font-mono text-slate-400 uppercase mb-1">{t.lockTimer}</label>
                <input 
                  type="number"
                  value={lockTimer}
                  onChange={(e) => setLockTimer(e.target.value)}
                  className="w-full px-3 py-1.5 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-transparent text-slate-800 dark:text-white font-mono"
                />
              </div>

              <div>
                <label className="block text-xxs font-mono text-slate-400 uppercase mb-1">{t.requiredDetail}</label>
                <input 
                  type="number"
                  value={requiredDetail}
                  onChange={(e) => setRequiredDetail(e.target.value)}
                  className="w-full px-3 py-1.5 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-transparent text-slate-800 dark:text-white font-mono"
                />
              </div>
            </div>

            <div className="p-3 bg-amber-50/50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900 rounded-lg flex items-start gap-2.5 text-xxs text-amber-800 dark:text-amber-400">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <span>Changing GPS metrics updates detailing check-in filters immediately for all field officers. Gaps greater than the threshold will block representative visit starts.</span>
            </div>
          </div>
        </div>
      )}

      {activeTab === "geography" && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-5 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-800 dark:text-white flex items-center gap-2">
                  <Globe size={16} className="text-blue-500" />
                  {isRtl ? "إدارة النطاقات الجغرافية الرسمية" : "Official Cascading Geography Master"}
                </h3>
                <p className="text-xxs text-slate-400 mt-0.5">
                  {isRtl ? "إدارة الدولة > المنطقة > المدينة > المحلة/الحي وتعميمها على المندوبين" : "Administer Country > District > City > Area nodes for secure representative alignments."}
                </p>
              </div>

              {/* Sub-tabs for levels */}
              <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg text-[10px] font-bold">
                {(["countries", "districts", "cities", "areas", "repair", "consolidation"] as const).map((level) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => {
                      setGeoTab(level);
                      setEditGeoId(null);
                      setGeoCountryId("");
                      setGeoDistrictId("");
                      setGeoCityId("");
                      setGeoCountryName("");
                      setGeoCountryCode("");
                      setGeoDistrictName("");
                      setGeoCityName("");
                      setGeoAreaName("");
                    }}
                    className={`px-2 py-1 rounded transition-all cursor-pointer capitalize ${geoTab === level ? "bg-white dark:bg-slate-900 text-blue-600 shadow-xs" : "text-slate-500 hover:text-slate-700"}`}
                  >
                    {isRtl ? {
                      countries: "الدول",
                      districts: "المناطق",
                      cities: "المدن",
                      areas: "الأحياء والمحلات",
                      repair: "مركز الإصلاح الجغرافي",
                      consolidation: "دمج المناطق والتقاعد"
                    }[level] : level === "repair" ? "Advanced · Repair" : level === "consolidation" ? "Advanced · Consolidation" : level}
                  </button>
                ))}
              </div>
            </div>

            {geoTab === "consolidation" ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">{isRtl ? "تم إيقاف أداة الدمج القديمة حتى تتوفر خدمة تشخيص خلفية مخولة." : "Legacy consolidation is retired until an authorized backend diagnostic service is available."}</div>
            ) : geoTab === "repair" ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">{isRtl ? "تم إيقاف أداة الإصلاح القديمة حتى تتوفر قراءات تشخيصية خلفية مخولة." : "Legacy repair is retired until authorized backend diagnostic reads are available."}</div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Form Column */}
              <div className="lg:col-span-1 bg-slate-50 dark:bg-slate-950/40 border border-slate-100 dark:border-slate-800 p-4 rounded-xl space-y-4">
                <span className="text-[10px] text-slate-400 font-bold uppercase block tracking-wider">
                  {editGeoId ? (isRtl ? "تعديل السجل الحالي" : "Edit Master Record") : (isRtl ? "إضافة سجل جديد" : "Add Master Record")}
                </span>

                <form onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    if (geoTab === "countries") {
                      if (!geoCountryName.trim()) return;
                      const id = editGeoId || `C-${geoCountryName.substring(0, 3).toUpperCase()}-${Date.now().toString().slice(-4)}`;
                      await setDoc(doc(db, "countries", id), {
                        id,
                        name: geoCountryName.trim(),
                        code: geoCountryCode.trim() || geoCountryName.substring(0, 2).toUpperCase()
                      });
                      onLogAudit(editGeoId ? "Update" : "Create", "Country", `Saved country: ${geoCountryName}`);
                    } else if (geoTab === "districts") {
                      if (!geoDistrictName.trim() || !geoCountryId) {
                        alert(isRtl ? "يرجى تعبئة جميع الحقول المطلوبة" : "Please complete all required fields.");
                        return;
                      }
                      const countryObj = countries.find(c => c.id === geoCountryId);
                      if (!countryObj) throw new Error("INVALID_CANONICAL_COUNTRY");
                      const id = editGeoId || `D-${Date.now().toString().slice(-6)}`;
                      await setDoc(doc(db, "districts", id), {
                        id,
                        name: geoDistrictName.trim(),
                        countryId: geoCountryId,
                        countryName: countryObj ? countryObj.name : ""
                      });
                      onLogAudit(editGeoId ? "Update" : "Create", "District", `Saved district: ${geoDistrictName}`);
                    } else if (geoTab === "cities") {
                      if (!geoCityName.trim() || !geoDistrictId || !geoCountryId) {
                        alert(isRtl ? "يرجى تعبئة جميع الحقول المطلوبة" : "Please complete all required fields.");
                        return;
                      }
                      const countryObj = countries.find(c => c.id === geoCountryId);
                      const districtObj = districts.find(d => d.id === geoDistrictId);
                      if (!countryObj || !districtObj || districtObj.countryId !== countryObj.id) throw new Error("INVALID_CANONICAL_GEOGRAPHY_PATH");
                      const id = editGeoId || `CT-${Date.now().toString().slice(-6)}`;
                      await setDoc(doc(db, "cities", id), {
                        id,
                        name: geoCityName.trim(),
                        districtId: geoDistrictId,
                        districtName: districtObj.name,
                        countryId: geoCountryId,
                        countryName: countryObj ? countryObj.name : ""
                      });
                      onLogAudit(editGeoId ? "Update" : "Create", "City", `Saved city: ${geoCityName}`);
                    } else if (geoTab === "areas") {
                      if (!geoAreaName.trim() || !geoCityId || !geoDistrictId || !geoCountryId) {
                        alert(isRtl ? "يرجى تعبئة جميع الحقول المطلوبة" : "Please complete all required fields.");
                        return;
                      }
                      const countryObj = countries.find(c => c.id === geoCountryId);
                      const districtObj = districts.find(d => d.id === geoDistrictId);
                      const cityObj = cities.find(c => c.id === geoCityId);
                      if (!countryObj || !districtObj || !cityObj || districtObj.countryId !== countryObj.id || cityObj.countryId !== countryObj.id || cityObj.districtId !== districtObj.id) throw new Error("INVALID_CANONICAL_GEOGRAPHY_PATH");

                      // Task 9: Prevent creation/updating of duplicate areas
                      const normNewName = geoAreaName.trim().toLowerCase().replace(/\s+/g, " ");
                      const getNormalizedAreaAndAlias = (name: string) => {
                        const base = name.trim().toLowerCase().replace(/\s+/g, " ");
                        if (base === "tajura" || base === "tajoura") {
                          return ["tajura", "tajoura"];
                        }
                        return [base];
                      };
                      
                      const newAreaAliases = getNormalizedAreaAndAlias(geoAreaName);
                      const isDuplicate = areas.some(a => {
                        if (a.id === editGeoId) return false; // skip self if editing
                        
                        // Check if in the same Country, District, City
                        const sameC = a.countryId === geoCountryId;
                        const sameD = a.districtId === geoDistrictId;
                        const sameCt = a.cityId === geoCityId;
                        
                        if (sameC && sameD && sameCt) {
                          const existingAreaAliases = getNormalizedAreaAndAlias(a.name);
                          return newAreaAliases.some(alias => existingAreaAliases.includes(alias));
                        }
                        return false;
                      });

                      if (isDuplicate) {
                        alert(isRtl 
                          ? "خطأ: يوجد بالفعل محلة/حي نشط بنفس الاسم المعياري أو الاسم المستعار في نفس التقسيم الجغرافي."
                          : "Error: An area with the same normalized name or approved alias already exists within the same Country/District/City hierarchy."
                        );
                        return;
                      }

                      const id = editGeoId || `A-${Date.now().toString().slice(-6)}`;
                      await setDoc(doc(db, "areas", id), {
                        id,
                        name: geoAreaName.trim(),
                        cityId: geoCityId,
                        cityName: cityObj.name,
                        districtId: geoDistrictId,
                        districtName: districtObj.name,
                        countryId: geoCountryId,
                        countryName: countryObj ? countryObj.name : ""
                      });
                      onLogAudit(editGeoId ? "Update" : "Create", "Area", `Saved area: ${geoAreaName}`);
                    }

                    setEditGeoId(null);
                    setGeoCountryName("");
                    setGeoCountryCode("");
                    setGeoDistrictName("");
                    setGeoCityName("");
                    setGeoAreaName("");
                    showToast(isRtl ? "تم الحفظ بنجاح وتدوين الحركة" : "Saved successfully and logged audit action.");
                  } catch (err: any) {
                    console.error(err);
                    alert("Error: " + err.message);
                  }
                }} className="space-y-4">
                  
                  {geoTab === "countries" && (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xxs font-bold text-slate-400 uppercase mb-1">{isRtl ? "اسم الدولة" : "Country Name"}</label>
                        <input 
                          type="text" 
                          required 
                          value={geoCountryName} 
                          onChange={(e) => setGeoCountryName(e.target.value)} 
                          placeholder="e.g. Libya"
                          className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-transparent text-slate-800 dark:text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-xxs font-bold text-slate-400 uppercase mb-1">{isRtl ? "رمز الدولة" : "Country Code"}</label>
                        <input 
                          type="text" 
                          value={geoCountryCode} 
                          onChange={(e) => setGeoCountryCode(e.target.value)} 
                          placeholder="e.g. LY"
                          className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-transparent text-slate-800 dark:text-white font-mono uppercase"
                        />
                      </div>
                    </div>
                  )}

                  {geoTab === "districts" && (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xxs font-bold text-slate-400 uppercase mb-1">{isRtl ? "الدولة" : "Country"}</label>
                        <select
                          required
                          value={geoCountryId}
                          onChange={(e) => setGeoCountryId(e.target.value)}
                          className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-transparent text-slate-800 dark:text-white"
                        >
                          <option value="">{isRtl ? "-- اختر الدولة --" : "-- Select Country --"}</option>
                          {countries.map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xxs font-bold text-slate-400 uppercase mb-1">{isRtl ? "اسم المنطقة" : "District Name"}</label>
                        <input 
                          type="text" 
                          required 
                          value={geoDistrictName} 
                          onChange={(e) => setGeoDistrictName(e.target.value)} 
                          placeholder="e.g. East"
                          className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-transparent text-slate-800 dark:text-white"
                        />
                        <p className="text-[10px] text-slate-400 mt-1">
                          {isRtl ? "الرجاء استخدام الأسماء الموحدة مثل: East, West, Centre, South" : "Please use standardized terms: East, West, Centre, South."}
                        </p>
                      </div>
                    </div>
                  )}

                  {geoTab === "cities" && (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xxs font-bold text-slate-400 uppercase mb-1">{isRtl ? "الدولة" : "Country"}</label>
                        <select
                          required
                          value={geoCountryId}
                          onChange={(e) => {
                            setGeoCountryId(e.target.value);
                            setGeoDistrictId("");
                          }}
                          className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-transparent text-slate-800 dark:text-white"
                        >
                          <option value="">{isRtl ? "-- اختر الدولة --" : "-- Select Country --"}</option>
                          {countries.map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xxs font-bold text-slate-400 uppercase mb-1">{isRtl ? "المنطقة" : "District"}</label>
                        <select
                          required
                          value={geoDistrictId}
                          onChange={(e) => setGeoDistrictId(e.target.value)}
                          className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-transparent text-slate-800 dark:text-white"
                        >
                          <option value="">{isRtl ? "-- اختر المنطقة --" : "-- Select District --"}</option>
                          {districtsForCountry(districts, geoCountryId).map(d => (
                            <option key={d.id} value={d.id}>{d.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xxs font-bold text-slate-400 uppercase mb-1">{isRtl ? "اسم المدينة" : "City Name"}</label>
                        <input 
                          type="text" 
                          required 
                          value={geoCityName} 
                          onChange={(e) => setGeoCityName(e.target.value)} 
                          placeholder="e.g. Benghazi"
                          className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-transparent text-slate-800 dark:text-white"
                        />
                      </div>
                    </div>
                  )}

                  {geoTab === "areas" && (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xxs font-bold text-slate-400 uppercase mb-1">{isRtl ? "الدولة" : "Country"}</label>
                        <select
                          required
                          value={geoCountryId}
                          onChange={(e) => {
                            setGeoCountryId(e.target.value);
                            setGeoDistrictId("");
                            setGeoCityId("");
                          }}
                          className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-transparent text-slate-800 dark:text-white"
                        >
                          <option value="">{isRtl ? "-- اختر الدولة --" : "-- Select Country --"}</option>
                          {countries.map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xxs font-bold text-slate-400 uppercase mb-1">{isRtl ? "المنطقة" : "District"}</label>
                        <select
                          required
                          value={geoDistrictId}
                          onChange={(e) => {
                            setGeoDistrictId(e.target.value);
                            setGeoCityId("");
                          }}
                          className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-transparent text-slate-800 dark:text-white"
                        >
                          <option value="">{isRtl ? "-- اختر المنطقة --" : "-- Select District --"}</option>
                          {districtsForCountry(districts, geoCountryId).map(d => (
                            <option key={d.id} value={d.id}>{d.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xxs font-bold text-slate-400 uppercase mb-1">{isRtl ? "المدينة" : "City"}</label>
                        <select
                          required
                          value={geoCityId}
                          onChange={(e) => setGeoCityId(e.target.value)}
                          className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-transparent text-slate-800 dark:text-white"
                        >
                          <option value="">{isRtl ? "-- اختر المدينة --" : "-- Select City --"}</option>
                          {citiesForDistrict(cities, geoCountryId, geoDistrictId).map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xxs font-bold text-slate-400 uppercase mb-1">{isRtl ? "اسم المحلة / الحي" : "Area Name"}</label>
                        <input 
                          type="text" 
                          required 
                          value={geoAreaName} 
                          onChange={(e) => setGeoAreaName(e.target.value)} 
                          placeholder="e.g. Al-Laithi"
                          className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-transparent text-slate-800 dark:text-white"
                        />
                      </div>
                    </div>
                  )}

                  <div className="flex gap-2 pt-2">
                    <button
                      type="submit"
                      className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer"
                    >
                      {editGeoId ? (isRtl ? "تحديث السجل" : "Update") : (isRtl ? "إضافة السجل" : "Save Node")}
                    </button>
                    {editGeoId && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditGeoId(null);
                          setGeoCountryName("");
                          setGeoCountryCode("");
                          setGeoDistrictName("");
                          setGeoCityName("");
                          setGeoAreaName("");
                        }}
                        className="px-3 py-2 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 text-slate-700 dark:text-slate-300 text-xs font-bold rounded-lg transition-colors cursor-pointer"
                      >
                        {isRtl ? "إلغاء" : "Cancel"}
                      </button>
                    )}
                  </div>
                </form>
              </div>

              {/* List Table Column */}
              <div className="lg:col-span-2 border border-slate-100 dark:border-slate-800 rounded-xl overflow-hidden flex flex-col h-[400px]">
                <div className="bg-slate-50 dark:bg-slate-800 px-4 py-2 flex justify-between items-center text-[10px] font-mono uppercase text-slate-400 tracking-wider font-bold">
                  <span>{isRtl ? "الاسم والرمز الفريد" : "Node Details & Path"}</span>
                  <div className="flex items-center gap-2">
                    {geoTab === "areas" && isAdminUser && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedUatIds([]);
                          setCleanupReport(null);
                          setShowCleanupModal(true);
                        }}
                        className="px-2 py-1 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded text-[9px] uppercase tracking-normal cursor-pointer transition-colors flex items-center gap-1"
                      >
                        <Shield size={10} />
                        {isRtl ? "تنظيف بيانات UAT للاختبار" : "Clean Up UAT Areas"}
                      </button>
                    )}
                    <span>{isRtl ? "العمليات" : "Actions"}</span>
                  </div>
                </div>

                <div className="divide-y divide-slate-100 dark:divide-slate-800 overflow-y-auto flex-1">
                  {geoTab === "countries" && countries.map((c) => (
                    <div key={c.id} className="px-4 py-3 flex justify-between items-center text-xs hover:bg-slate-50/50 dark:hover:bg-slate-950/20">
                      <div>
                        <span className="font-mono text-[9px] font-bold text-slate-400 block">{c.id}</span>
                        <span className="font-bold text-slate-800 dark:text-white">{c.name}</span>
                        <span className="ml-2 px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px] font-mono font-bold text-slate-500 uppercase">{c.code}</span>
                      </div>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setEditGeoId(c.id);
                            setGeoCountryName(c.name);
                            setGeoCountryCode(c.code || "");
                          }}
                          className="p-1.5 text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded-lg cursor-pointer"
                        >
                          <Edit3 size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleGeoDelete(c.id, "countries")}
                          className="p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg cursor-pointer"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}

                  {geoTab === "districts" && districtsForCountry(districts, geoCountryId).map((d) => (
                    <div key={d.id} className="px-4 py-3 flex justify-between items-center text-xs hover:bg-slate-50/50 dark:hover:bg-slate-950/20">
                      <div>
                        <span className="font-mono text-[9px] font-bold text-slate-400 block">{d.id}</span>
                        <span className="font-bold text-slate-800 dark:text-white">{d.name}</span>
                        <span className="text-[10px] text-slate-400 block mt-0.5">
                          📍 {d.countryName}
                        </span>
                      </div>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setEditGeoId(d.id);
                            setGeoDistrictName(d.name);
                            setGeoCountryId(d.countryId);
                          }}
                          className="p-1.5 text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded-lg cursor-pointer"
                        >
                          <Edit3 size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleGeoDelete(d.id, "districts")}
                          className="p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg cursor-pointer"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}

                  {geoTab === "cities" && citiesForDistrict(cities, geoCountryId, geoDistrictId).map((c) => (
                    <div key={c.id} className="px-4 py-3 flex justify-between items-center text-xs hover:bg-slate-50/50 dark:hover:bg-slate-950/20">
                      <div>
                        <span className="font-mono text-[9px] font-bold text-slate-400 block">{c.id}</span>
                        <span className="font-bold text-slate-800 dark:text-white">{c.name}</span>
                        <span className="text-[10px] text-slate-400 block mt-0.5">
                          📍 {c.countryName} &rarr; {c.districtName}
                        </span>
                      </div>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setEditGeoId(c.id);
                            setGeoCityName(c.name);
                            setGeoCountryId(c.countryId);
                            setGeoDistrictId(c.districtId);
                          }}
                          className="p-1.5 text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded-lg cursor-pointer"
                        >
                          <Edit3 size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleGeoDelete(c.id, "cities")}
                          className="p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg cursor-pointer"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}

                  {geoTab === "areas" && areasForCity(areas, geoCountryId, geoDistrictId, geoCityId).map((a) => {
                    const isAreaActive = a.active !== false;
                    const summary = getAreaReferenceSummary(a);
                    return (
                      <div key={a.id} className="px-4 py-3 flex justify-between items-center text-xs hover:bg-slate-50/50 dark:hover:bg-slate-950/20 border-b border-slate-100 dark:border-slate-800/60">
                        <div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-mono text-[9px] font-bold text-slate-400">{a.id}</span>
                            {a.isTestData ? (
                              <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border border-amber-100 dark:border-amber-900/60">UAT Test</span>
                            ) : (
                              <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-900/60">Master</span>
                            )}
                            {isAreaActive ? (
                              <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/60">Active</span>
                            ) : (
                              <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border border-rose-100 dark:border-rose-900/60">Inactive</span>
                            )}
                            {summary.totalReferences > 0 && (
                              <span className="px-1.5 py-0.5 rounded text-[8px] font-mono font-bold bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-900/60">
                                {summary.totalReferences} refs
                              </span>
                            )}
                          </div>
                          <span className="font-bold text-slate-800 dark:text-white block mt-0.5">{a.name}</span>
                          <span className="text-[10px] text-slate-400 block mt-0.5">
                            📍 {a.countryName} &rarr; {a.districtName} &rarr; {a.cityName}
                          </span>
                        </div>
                        <div className="flex gap-1 items-center">
                          <button
                            type="button"
                            onClick={() => setViewRefArea(a)}
                            title={isRtl ? "عرض الارتباطات والمراجع" : "View References"}
                            className="p-1.5 text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 rounded-lg cursor-pointer transition-colors"
                          >
                            <Eye size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleAreaActive(a)}
                            title={isAreaActive ? (isRtl ? "إلغاء التفعيل" : "Deactivate") : (isRtl ? "تفعيل" : "Reactivate")}
                            className={`p-1.5 rounded-lg cursor-pointer transition-colors ${isAreaActive ? "text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/40" : "text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"}`}
                          >
                            <Check size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditGeoId(a.id);
                              setGeoAreaName(a.name);
                              setGeoCountryId(a.countryId);
                              setGeoDistrictId(a.districtId);
                              setGeoCityId(a.cityId);
                            }}
                            title={isRtl ? "تعديل" : "Edit"}
                            className="p-1.5 text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded-lg cursor-pointer transition-colors"
                          >
                            <Edit3 size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleGeoDelete(a.id, "areas")}
                            title={
                              !isAdminUser 
                                ? (isRtl ? "يتطلب صلاحية مدير النظام" : "Requires Admin Role")
                                : summary.totalReferences > 0
                                ? (isRtl ? `مرتبط بـ ${summary.totalReferences} سجلات - يرجى إلغاء التفعيل بدلاً من الحذف` : `Referenced by ${summary.totalReferences} items - Please deactivate instead`)
                                : a.isTestData !== true
                                ? (isRtl ? "بيانات إنتاج محمية" : "Protected master data")
                                : (isRtl ? "حذف السجل" : "Delete")
                            }
                            className={`p-1.5 rounded-lg cursor-pointer transition-colors ${
                              (!isAdminUser || summary.totalReferences > 0 || a.isTestData !== true)
                                ? "text-rose-300 dark:text-rose-900/60 hover:bg-slate-100 dark:hover:bg-slate-900"
                                : "text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                            }`}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  {geoTab === "countries" && countries.length === 0 && (
                    <p className="p-8 text-center text-slate-400 text-xs font-semibold">{isRtl ? "لا توجد سجلات" : "No country master nodes defined."}</p>
                  )}
                  {geoTab === "districts" && districtsForCountry(districts, geoCountryId).length === 0 && (
                    <p className="p-8 text-center text-slate-400 text-xs font-semibold">{geoCountryId ? (isRtl ? "لا توجد سجلات" : "No districts for the selected country.") : (isRtl ? "اختر دولة لعرض المناطق" : "Select a country to view its districts.")}</p>
                  )}
                  {geoTab === "cities" && citiesForDistrict(cities, geoCountryId, geoDistrictId).length === 0 && (
                    <p className="p-8 text-center text-slate-400 text-xs font-semibold">{geoDistrictId ? (isRtl ? "لا توجد سجلات" : "No cities for the selected district.") : (isRtl ? "اختر الدولة والمنطقة لعرض المدن" : "Select a country and district to view its cities.")}</p>
                  )}
                  {geoTab === "areas" && areasForCity(areas, geoCountryId, geoDistrictId, geoCityId).length === 0 && (
                    <p className="p-8 text-center text-slate-400 text-xs font-semibold">{geoCityId ? (isRtl ? "لا توجد سجلات" : "No areas for the selected city.") : (isRtl ? "اختر المسار الجغرافي الكامل لعرض الأحياء" : "Select Country → District → City to view its areas.")}</p>
                  )}
                </div>
              </div>
            </div>
            )}
          </div>
        </div>
      )}

      {activeTab === "localization" && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-5 space-y-6">
            <div>
              <h3 className="text-sm font-semibold text-slate-800 dark:text-white flex items-center gap-2">
                <Globe size={16} className="text-indigo-500" />
                {t.localTitle}
              </h3>
              <p className="text-xxs text-slate-400 mt-0.5">{t.localDesc}</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div>
                  <label className="block text-xxs font-mono text-slate-400 uppercase mb-1">{isRtl ? "لغات النظام الافتراضية المتاحة" : "System Languages Options"}</label>
                  <select className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-transparent text-slate-800 dark:text-white">
                    <option>English & Arabic (Dual Localized)</option>
                    <option>English Only (UK/US Standards)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xxs font-mono text-slate-400 uppercase mb-2">{isRtl ? "إعدادات عملات الدول المعتمدة" : "Country-Specific Currency Configurations"}</label>
                  <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden bg-slate-50/50 dark:bg-slate-900/30 p-3 space-y-2.5 text-xs">
                    {marketSettings.map((market, index) => (
                      <div key={market.marketId} className={`flex items-center justify-between ${index < marketSettings.length - 1 ? "pb-2 border-b border-slate-200/60 dark:border-slate-800/80" : ""}`}>
                        <div>
                          <span className="font-bold text-slate-800 dark:text-white block">{market.countryNameEn} ({market.countryId})</span>
                          <span className="text-[10px] text-slate-500">{market.timezone}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 font-mono text-xxs font-bold bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 rounded">Code: {market.currencyCode}</span>
                          <span className="px-2 py-0.5 font-mono text-xxs font-bold bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 rounded">Symbol: {market.currencySymbol}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xxs font-mono text-slate-400 uppercase mb-1">{isRtl ? "الحد الأدنى لنسبة الضريبة والرسوم (VAT)" : "Sales VAT/Tax Thresholds"}</label>
                  <input 
                    type="text" 
                    defaultValue="0.00 % (Standard Pharmaceutical exemption)" 
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-transparent text-slate-800 dark:text-white" 
                  />
                </div>

                <div>
                  <label className="block text-xxs font-mono text-slate-400 uppercase mb-1">{isRtl ? "صيغة تنسيق التاريخ الإقليمي" : "Default Localized Date Format"}</label>
                  <select className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-transparent text-slate-800 dark:text-white">
                    <option>YYYY-MM-DD (ISO standard)</option>
                    <option>DD/MM/YYYY (UK standard)</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 border-t border-slate-100 dark:border-slate-800 pt-5">
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-slate-800 dark:text-white">{isRtl ? "إعدادات السوق والتقويم" : "Market & Work Calendar"}</h4>
                <select value={selectedMarketId} onChange={event => setSelectedMarketId(event.target.value)} className="w-full px-3 py-2 border rounded-lg bg-transparent text-xs">
                  <option value="" disabled>{isRtl ? "اختر دولة من السجل الرئيسي" : "Select canonical country"}</option>
                  {countries.map(country => <option key={country.id} value={country.id}>{country.name} — {country.id}{marketSettings.some(market => market.countryId === country.id) ? "" : " (configuration required)"}</option>)}
                </select>
                <div className="grid grid-cols-2 gap-3">
                  <label className="col-span-2 text-[10px] font-bold text-slate-500">{isRtl ? "اسم الدولة بالعربية" : "Country name (Arabic)"}<input aria-label="Arabic country name" value={marketDraft.countryNameAr} onChange={event => setMarketDraft(value => ({ ...value, countryNameAr: event.target.value }))} className="mt-1 w-full px-3 py-2 border rounded-lg bg-transparent text-xs" /></label>
                  <label className="text-[10px] font-bold text-slate-500">{isRtl ? "رمز العملة" : "Currency code"}<input aria-label="Currency code" value={marketDraft.currencyCode} onChange={event => setMarketDraft(value => ({ ...value, currencyCode: event.target.value.toUpperCase() }))} className="mt-1 w-full px-3 py-2 border rounded-lg bg-transparent text-xs" /></label>
                  <label className="text-[10px] font-bold text-slate-500">{isRtl ? "علامة العملة" : "Currency symbol"}<input aria-label="Currency symbol" value={marketDraft.currencySymbol} onChange={event => setMarketDraft(value => ({ ...value, currencySymbol: event.target.value }))} className="mt-1 w-full px-3 py-2 border rounded-lg bg-transparent text-xs" /></label>
                  <label className="col-span-2 text-[10px] font-bold text-slate-500">{isRtl ? "رمز مستندات الأعمال" : "Business document code"}<input aria-label="Business document code" value={marketDraft.businessDocumentCode || ""} onChange={event => setMarketDraft(value => ({ ...value, businessDocumentCode: event.target.value.toUpperCase() }))} className="mt-1 w-full px-3 py-2 border rounded-lg bg-transparent text-xs" /></label>
                  <label className="col-span-2 text-[10px] font-bold text-slate-500">{isRtl ? "المنطقة الزمنية" : "IANA timezone"}<select aria-label="Timezone" value={marketDraft.timezone} onChange={event => setMarketDraft(value => ({ ...value, timezone: event.target.value }))} className="mt-1 w-full px-3 py-2 border rounded-lg bg-transparent text-xs"><option value="" disabled>{timezoneOptions.length ? (isRtl ? "اختر منطقة IANA" : "Select validated IANA timezone") : (isRtl ? "سجل المناطق الزمنية غير متاح" : "Timezone registry unavailable")}</option>{timezoneOptions.map((zone) => <option key={zone} value={zone}>{zone}</option>)}</select></label>
                  <label className="text-[10px] font-bold text-slate-500">{isRtl ? "بداية ساعات العمل القياسية" : "Standard workday start"}<input aria-label="Standard workday start" type="time" value={marketDraft.normalWorkdayStart} onChange={event => setMarketDraft(value => ({ ...value, normalWorkdayStart: event.target.value }))} className="mt-1 w-full px-3 py-2 border rounded-lg bg-transparent text-xs" /></label>
                  <label className="text-[10px] font-bold text-slate-500">{isRtl ? "نهاية ساعات العمل القياسية" : "Standard workday end"}<input aria-label="Standard workday end" type="time" value={marketDraft.normalWorkdayEnd} onChange={event => setMarketDraft(value => ({ ...value, normalWorkdayEnd: event.target.value }))} className="mt-1 w-full px-3 py-2 border rounded-lg bg-transparent text-xs" /></label>
                  <label className="text-[10px] font-bold text-slate-500">{isRtl ? "وقت فتح تسجيل الحضور" : "Check-in opening time"}<input aria-label="Check-in opening time" type="time" value={marketDraft.checkInOpensAt} onChange={event => setMarketDraft(value => ({ ...value, checkInOpensAt: event.target.value }))} className="mt-1 w-full px-3 py-2 border rounded-lg bg-transparent text-xs" /></label>
                  <label className="text-[10px] font-bold text-slate-500">{isRtl ? "وقت الإغلاق التلقائي الاحتياطي" : "Auto-checkout fallback time"}<input aria-label="Auto-checkout fallback time" type="time" value={marketDraft.autoCheckoutAt} onChange={event => setMarketDraft(value => ({ ...value, autoCheckoutAt: event.target.value }))} className="mt-1 w-full px-3 py-2 border rounded-lg bg-transparent text-xs" /></label>
                </div>
                <fieldset className="space-y-2">
                  <legend className="text-[10px] font-bold text-slate-500">{isRtl ? "أيام العمل" : "Working days"}</legend>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {WORKING_DAY_OPTIONS.map((day) => <label key={day.value} className="flex items-center gap-2 rounded-lg border px-2 py-2 text-[10px] font-medium"><input type="checkbox" checked={marketDraft.workingWeekdays.includes(day.value)} onChange={event => setMarketDraft(value => ({ ...value, workingWeekdays: event.target.checked ? [...value.workingWeekdays, day.value].sort() : value.workingWeekdays.filter(item => item !== day.value) }))} />{day.label}</label>)}
                  </div>
                </fieldset>
                {marketValidationMessages.length > 0 && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-[10px] text-rose-700"><p className="font-bold mb-1">{isRtl ? "يرجى تصحيح الحقول التالية:" : "Correct these required fields:"}</p><ul className="list-disc pl-4 space-y-1">{marketValidationMessages.map(message => <li key={message}>{message}</li>)}</ul></div>}
                <button type="button" onClick={() => void saveMarketSettings()} disabled={!isAdminUser} className="px-4 py-2 bg-indigo-600 disabled:opacity-50 text-white rounded-lg font-bold text-xxs">{t.saveLocal}</button>
              </div>
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-slate-800 dark:text-white">{isRtl ? "العطلات والاستثناءات" : "Holidays & Exceptions"}</h4>
                <div className="grid grid-cols-2 gap-2">
                  <input type="date" value={holidayDraft.date} onChange={event => setHolidayDraft(value => ({ ...value, date: event.target.value }))} className="px-3 py-2 border rounded-lg bg-transparent text-xs" />
                  <select value={holidayDraft.type} onChange={event => setHolidayDraft(value => ({ ...value, type: event.target.value as BusinessCalendarException["type"] }))} className="px-3 py-2 border rounded-lg bg-transparent text-xs"><option value="PUBLIC">Public</option><option value="COMPANY">Company</option><option value="REGIONAL">Regional</option><option value="EXCEPTIONAL_WORKING">Exceptional working</option><option value="EXCEPTIONAL_NON_WORKING">Exceptional non-working</option></select>
                  <input placeholder="English name" value={holidayDraft.nameEn} onChange={event => setHolidayDraft(value => ({ ...value, nameEn: event.target.value }))} className="px-3 py-2 border rounded-lg bg-transparent text-xs" />
                  <input placeholder="Arabic name" value={holidayDraft.nameAr} onChange={event => setHolidayDraft(value => ({ ...value, nameAr: event.target.value }))} className="px-3 py-2 border rounded-lg bg-transparent text-xs" />
                  <input placeholder="Canonical region ID (optional)" value={holidayDraft.regionId} onChange={event => setHolidayDraft(value => ({ ...value, regionId: event.target.value }))} className="col-span-2 px-3 py-2 border rounded-lg bg-transparent text-xs" />
                </div>
                <button type="button" onClick={() => void saveCalendarException()} disabled={!isAdminUser} className="px-4 py-2 bg-emerald-600 disabled:opacity-50 text-white rounded-lg font-bold text-xxs">{isRtl ? "إضافة يوم" : "Add calendar day"}</button>
                <div className="max-h-36 overflow-y-auto divide-y text-[10px]">{calendarExceptions.filter(item => item.marketId === marketDraft.marketId).map(item => <div key={item.id} className="py-2 flex justify-between"><span>{item.date} — {isRtl ? item.nameAr : item.nameEn}</span><span>{item.type}{item.regionId ? ` / ${item.regionId}` : ""}</span></div>)}</div>
              </div>
            </div>

          </div>
        </div>
      )}

      {activeTab === "order-workflow" && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-5 space-y-6">
            <div>
              <h3 className="text-sm font-semibold text-slate-800 dark:text-white flex items-center gap-2">
                <GitBranch size={16} className="text-emerald-500" />
                {t.orderWorkTitle}
              </h3>
              <p className="text-xxs text-slate-400 mt-0.5">{t.orderWorkDesc}</p>
            </div>

            <div className="space-y-6 text-xs text-slate-600 dark:text-slate-300">
              {/* Operational Policies Header */}
              <div>
                <h4 className="font-bold text-slate-800 dark:text-white uppercase tracking-wider text-[11px] mb-3 font-mono">
                  {isRtl ? "السياسات التشغيلية المعتمدة" : "Operational Policies (Separated from Approval)"}
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex items-center justify-between p-3 border border-slate-100 dark:border-slate-800 rounded-xl bg-slate-50/50 dark:bg-slate-800/30">
                    <div>
                      <span className="font-bold text-slate-800 dark:text-white block">{isRtl ? "تدقيق الجدارة الائتمانية" : "Enforce Credit Limit Review"}</span>
                      <span className="text-[10px] text-slate-400">{isRtl ? "التحقق من الرصيد والائتمان المتاح للصيدلية" : "Enforce credit checking on submission."}</span>
                    </div>
                    <input 
                      type="checkbox" 
                      checked={workflowRule.creditCheckEnabled} 
                      onChange={(e) => setWorkflowRule({ ...workflowRule, creditCheckEnabled: e.target.checked })} 
                      className="w-4 h-4 text-emerald-600 rounded accent-emerald-600 cursor-pointer" 
                    />
                  </div>

                  <div className="flex items-center justify-between p-3 border border-slate-100 dark:border-slate-800 rounded-xl bg-slate-50/50 dark:bg-slate-800/30">
                    <div>
                      <span className="font-bold text-slate-800 dark:text-white block">{isRtl ? "السماح بمسودات المندوبين" : "Allow Sales Representative Draft Orders"}</span>
                      <span className="text-[10px] text-slate-400">{isRtl ? "تمكين حفظ الطلبات كمسودة قبل الاعتماد" : "Allow reps to store pending offline drafts."}</span>
                    </div>
                    <input 
                      type="checkbox" 
                      checked={workflowRule.allowDraftOrders} 
                      onChange={(e) => setWorkflowRule({ ...workflowRule, allowDraftOrders: e.target.checked })} 
                      className="w-4 h-4 text-emerald-600 rounded accent-emerald-600 cursor-pointer" 
                    />
                  </div>

                  <div className="flex items-center justify-between p-3 border border-slate-100 dark:border-slate-800 rounded-xl bg-slate-50/50 dark:bg-slate-800/30">
                    <div>
                      <span className="font-bold text-slate-800 dark:text-white block">{isRtl ? "دمج مراحل الطلب للمستخدم المخوّل" : "Allow Order Stage Consolidation"}</span>
                      <span className="text-[10px] text-slate-400">{isRtl ? "تمكين التمرير المتتابع الصريح بنفس المستخدم غير المنشئ" : "Single operator processing with explicit audit."}</span>
                    </div>
                    <input 
                      type="checkbox" 
                      checked={workflowRule.allowStageConsolidation} 
                      onChange={(e) => setWorkflowRule({ ...workflowRule, allowStageConsolidation: e.target.checked })} 
                      className="w-4 h-4 text-emerald-600 rounded accent-emerald-600 cursor-pointer" 
                    />
                  </div>

                  <div className="flex items-center justify-between p-3 border border-slate-100 dark:border-slate-800 rounded-xl bg-slate-50/50 dark:bg-slate-800/30">
                    <div>
                      <span className="font-bold text-slate-800 dark:text-white block">{isRtl ? "اشتراط مبرر الإرجاع والرفض" : "Require Comments on Reject/Return"}</span>
                      <span className="text-[10px] text-slate-400">{isRtl ? "إلزام كاتب القرار بتسجيل المبرر" : "Enforce mandatory comment strings on reject/return."}</span>
                    </div>
                    <input 
                      type="checkbox" 
                      checked={workflowRule.requireRejectComment} 
                      onChange={(e) => setWorkflowRule({ ...workflowRule, requireRejectComment: e.target.checked })} 
                      className="w-4 h-4 text-emerald-600 rounded accent-emerald-600 cursor-pointer" 
                    />
                  </div>
                </div>
              </div>

              {/* Mandatory Workflow Stages */}
              <div>
                <h4 className="font-bold text-slate-800 dark:text-white uppercase tracking-wider text-[11px] mb-3 font-mono">
                  {isRtl ? "مراحل سير العمل الإلزامية (لا يمكن إيقافها)" : "Mandatory Enterprise Workflow Stages"}
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="p-3 border border-indigo-200 dark:border-indigo-900/50 bg-indigo-50/30 dark:bg-indigo-950/20 rounded-xl space-y-1">
                    <span className="text-[10px] font-mono text-indigo-600 dark:text-indigo-400 font-bold uppercase">Stage 1 — Sales Submission</span>
                    <p className="font-bold text-slate-800 dark:text-white text-xs">ORDER_SUBMIT</p>
                    <p className="text-[10px] text-slate-500">Default Role: Sales Representative</p>
                  </div>

                  <div className="p-3 border border-blue-200 dark:border-blue-900/50 bg-blue-50/30 dark:bg-blue-950/20 rounded-xl space-y-1">
                    <span className="text-[10px] font-mono text-blue-600 dark:text-blue-400 font-bold uppercase">Stage 2 — Inventory Reservation</span>
                    <p className="font-bold text-slate-800 dark:text-white text-xs">AUTOMATED_RESERVATION</p>
                    <p className="text-[10px] text-slate-500">Contract Ready (WP7.2 Execution)</p>
                  </div>

                  <div className="p-3 border border-purple-200 dark:border-purple-900/50 bg-purple-50/30 dark:bg-purple-950/20 rounded-xl space-y-1">
                    <span className="text-[10px] font-mono text-purple-600 dark:text-purple-400 font-bold uppercase">Stage 3 — Finance Review</span>
                    <p className="font-bold text-slate-800 dark:text-white text-xs">ORDER_FINANCE_APPROVE</p>
                    <p className="text-[10px] text-slate-500">Default Role: Finance Officer</p>
                  </div>

                  <div className="p-3 border border-amber-200 dark:border-amber-900/50 bg-amber-50/30 dark:bg-amber-950/20 rounded-xl space-y-1">
                    <span className="text-[10px] font-mono text-amber-600 dark:text-amber-400 font-bold uppercase">Stage 4 — Operations Review</span>
                    <p className="font-bold text-slate-800 dark:text-white text-xs">ORDER_OPERATIONS_APPROVE</p>
                    <p className="text-[10px] text-slate-500">Default Role: Order Operations Officer</p>
                  </div>

                  <div className="p-3 border border-teal-200 dark:border-teal-900/50 bg-teal-50/30 dark:bg-teal-950/20 rounded-xl space-y-1">
                    <span className="text-[10px] font-mono text-teal-600 dark:text-teal-400 font-bold uppercase">Stage 5 — Store Preparation</span>
                    <p className="font-bold text-slate-800 dark:text-white text-xs">ORDER_STORE_PREPARE</p>
                    <p className="text-[10px] text-slate-500">Default Role: Store Manager</p>
                  </div>

                  <div className="p-3 border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/30 dark:bg-emerald-950/20 rounded-xl space-y-1">
                    <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 font-bold uppercase">Stage 6 — Delivery Execution</span>
                    <p className="font-bold text-slate-800 dark:text-white text-xs">ORDER_DELIVERY_COMPLETE</p>
                    <p className="text-[10px] text-slate-500">Default Role: Delivery Officer</p>
                  </div>
                </div>
              </div>
            </div>

            <button 
              onClick={async () => {
                if (!currentUser?.uid || !isAdminUser) return;
                const before = null;
                const after = { ...ENTERPRISE_WORKFLOW_TEMPLATE, policy: workflowRule, updatedBy: currentUser.uid, updatedAt: new Date().toISOString() };
                const event = createConfigurationAuditEvent({ domain: "ORDER_WORKFLOW", entityId: ENTERPRISE_WORKFLOW_TEMPLATE.templateId, action: "UPDATE", actorUid: currentUser.uid, actorRole: currentUser.role, occurredAt: after.updatedAt, before, after });
                const batch = writeBatch(db);
                batch.set(doc(db, "orderWorkflowTemplates", ENTERPRISE_WORKFLOW_TEMPLATE.templateId), after, { merge: true });
                batch.set(doc(db, "configurationAudit", event.eventId), event);
                await batch.commit();
                showToast(isRtl ? "تم تطبيق إعدادات سير العمل للطلبات" : "Canonical order workflow template saved with audit history.");
              }}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold text-xxs cursor-pointer"
            >
              {t.saveWorkflow}
            </button>
          </div>
        </div>
      )}

      {activeTab === "product-audits" && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-5 space-y-6">
            <div>
              <h3 className="text-sm font-semibold text-slate-800 dark:text-white flex items-center gap-2">
                <ClipboardList size={16} className="text-amber-500" />
                {t.auditTitle}
              </h3>
              <p className="text-xxs text-slate-400 mt-0.5">{t.auditDesc}</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="p-4 bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900 rounded-xl">
                <span className="text-[9px] text-slate-400 font-bold block uppercase">{t.correctAlloc}</span>
                <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400 font-mono">{auditAssignments.length ? Math.round((assignmentAudit.validCount / auditAssignments.length) * 100) : 0}%</span>
                <p className="text-[10px] text-slate-500 mt-1">{isRtl ? "نسبة التعيينات الأساسية الصحيحة" : "Canonical assignment integrity rate."}</p>
              </div>

              <div className="p-4 bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-900 rounded-xl">
                <span className="text-[9px] text-slate-400 font-bold block uppercase">{t.auditedAlloc}</span>
                <span className="text-lg font-bold text-indigo-600 dark:text-indigo-400 font-mono">{auditAssignments.length} lines</span>
                <p className="text-[10px] text-slate-500 mt-1">{isRtl ? "تعيينات مميزة مسجلة في سجل النظام" : "Total monitored detailing associations."}</p>
              </div>

              <div className="p-4 bg-rose-50/50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900 rounded-xl">
                <span className="text-[9px] text-slate-400 font-bold block uppercase">{t.mappingAnom}</span>
                <span className="text-lg font-bold text-rose-600 dark:text-rose-400 font-mono">{assignmentAudit.anomalyCount}</span>
                <p className="text-[10px] text-slate-500 mt-1">{isRtl ? "تعارضات التعيين المكتشفة" : "Canonical assignment anomalies detected."}</p>
              </div>
            </div>

            <div className="border border-slate-100 dark:border-slate-800 rounded-xl overflow-hidden">
              {/* Desktop View */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left text-xxs">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 uppercase font-mono bg-slate-50 dark:bg-slate-800">
                      <th className="px-4 py-2.5 font-bold">{isRtl ? "اسم المندوب" : "MedRep Name"}</th>
                      <th className="px-4 py-2.5 font-bold">{isRtl ? "المنتج" : "Product"}</th>
                      <th className="px-4 py-2.5 font-bold">{isRtl ? "مجموعة الترويج" : "Promotion Group"}</th>
                      <th className="px-4 py-2.5 font-bold">{isRtl ? "الإقليم الجغرافي" : "Assigned Territory"}</th>
                      <th className="px-4 py-2.5 font-bold">{isRtl ? "حالة التدقيق" : "Status"}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {auditAssignments.map((asg) => (
                      <tr key={asg.code} className="text-slate-600 dark:text-slate-300">
                        <td className="px-4 py-3 font-bold text-slate-850 dark:text-white">{asg.repName}</td>
                        <td className="px-4 py-3">{asg.productName}</td>
                        <td className="px-4 py-3">{asg.promotionGroup}</td>
                        <td className="px-4 py-3 font-medium">{asg.territory}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded font-bold text-[9px] ${asg.valid ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600" : "bg-rose-50 dark:bg-rose-950/40 text-rose-600"}`}>
                            {isRtl ? "نشط ومراجع" : asg.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile View */}
              <div className="block md:hidden divide-y divide-slate-100 dark:divide-slate-800">
                {auditAssignments.map((asg) => (
                  <div key={asg.code} className={`p-4 space-y-3 text-[11px] ${isRtl ? "text-right" : "text-left"}`}>
                    <div className={`flex justify-between items-center ${isRtl ? "flex-row-reverse" : "flex-row"}`}>
                      <span className="font-bold text-slate-900 dark:text-white">{asg.productName}</span>
                      <span className={`px-2 py-0.5 rounded font-bold text-[9px] ${asg.valid ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600" : "bg-rose-50 dark:bg-rose-950/40 text-rose-600"}`}>
                        {isRtl ? "نشط ومراجع" : asg.status}
                      </span>
                    </div>

                    <div className="space-y-1">
                      <h4 className="font-bold text-slate-900 dark:text-white text-xs">{asg.repName}</h4>
                      <p className="text-slate-500 dark:text-slate-400 font-mono text-[10px]">{asg.promotionGroup}</p>
                    </div>

                    <div className="bg-slate-50 dark:bg-slate-950/40 rounded-lg p-2.5 border border-slate-100/50 dark:border-slate-800/40 text-[10px]">
                      <span className="text-slate-400 block uppercase font-bold text-[8px] mb-0.5">{isRtl ? "الإقليم الجغرافي المعين" : "Assigned Territory"}</span>
                      <strong className="text-slate-800 dark:text-slate-200 font-medium">{asg.territory}</strong>
                      <span className="mt-1 block font-mono text-[8px] text-slate-400">{asg.code}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === "diagnostics" && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-5 space-y-6">
            <div className="flex justify-between items-start gap-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                  <Shield size={18} className="text-indigo-600" />
                  {isRtl ? "الفحص التقني والأمني لـ Firebase" : "Firebase Security & Runtime Identity Diagnostic"}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  {isRtl ? "بيانات التعريف وعمليات الفحص الآمنة لبيئة العمل النشطة" : "Active runtime variables, security credentials checking, and read-only collection probes"}
                </p>
              </div>
              <button
                onClick={runFirebaseDiagnostics}
                disabled={isRunningProbes}
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-bold text-xs rounded-lg cursor-pointer transition-colors flex items-center gap-1.5 animate-pulse"
              >
                {isRunningProbes ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                    {isRtl ? "جاري الفحص..." : "Running Probes..."}
                  </>
                ) : (
                  <>
                    <GitBranch size={13} />
                    {isRtl ? "إعادة الفحص" : "Run Live Probes"}
                  </>
                )}
              </button>
            </div>

            {/* Comparison Result Banner */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 bg-slate-50/50 dark:bg-slate-950/20 border border-slate-100 dark:border-slate-800 rounded-xl space-y-2">
                <span className="text-[10px] text-slate-400 font-bold block uppercase tracking-wider">PROJECT IDENTITY COMPARISON</span>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-slate-600 dark:text-slate-300">Expected vs. Frontend</span>
                  <span className={`px-2.5 py-0.5 rounded text-[10px] font-bold font-mono ${comparisonResult.projectMatch === "MATCH" ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/60" : "bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border border-rose-100 dark:border-rose-900/60"}`}>
                    {comparisonResult.projectMatch}
                  </span>
                </div>
                <div className="text-[10px] font-mono text-slate-500 space-y-1">
                  <div>Expected: <span className="text-slate-700 dark:text-slate-300">menareps-crm-production-5046c</span></div>
                  <div>Actual: <span className="text-slate-700 dark:text-slate-300">{auth.app.options.projectId || "UNKNOWN"}</span></div>
                </div>
              </div>

              <div className="p-4 bg-slate-50/50 dark:bg-slate-950/20 border border-slate-100 dark:border-slate-800 rounded-xl space-y-2">
                <span className="text-[10px] text-slate-400 font-bold block uppercase tracking-wider">FIRESTORE DATABASE COMPARISON</span>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-slate-600 dark:text-slate-300">Expected vs. Frontend Config</span>
                  <span className={`px-2.5 py-0.5 rounded text-[10px] font-bold font-mono ${comparisonResult.dbMatch === "MATCH" ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/60" : "bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border border-rose-100 dark:border-rose-900/60"}`}>
                    {comparisonResult.dbMatch}
                  </span>
                </div>
                <div className="text-[10px] font-mono text-slate-500 space-y-1 truncate">
                  <div>Expected: <span className="text-slate-700 dark:text-slate-300">(default)</span></div>
                  <div className="truncate">Actual: <span className="text-slate-700 dark:text-slate-300 truncate">{firestoreDatabaseId || "UNKNOWN"}</span></div>
                </div>
              </div>
            </div>

            {/* Config Panels Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              
              {/* Group 1: Frontend Config */}
              <div className="border border-slate-100 dark:border-slate-800 rounded-xl p-4 space-y-3 bg-slate-50/20 dark:bg-slate-950/5">
                <h4 className="text-xs font-bold text-slate-800 dark:text-white uppercase tracking-wider font-mono">1. Frontend Configuration</h4>
                <div className="space-y-2 font-mono text-[11px] text-slate-600 dark:text-slate-300">
                  <div className="flex justify-between py-1 border-b border-slate-100/50 dark:border-slate-800/40">
                    <span className="text-slate-400">projectId:</span>
                    <span>{auth.app.options.projectId || "N/A"}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-100/50 dark:border-slate-800/40">
                    <span className="text-slate-400">authDomain:</span>
                    <span>{auth.app.options.authDomain || "N/A"}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-100/50 dark:border-slate-800/40">
                    <span className="text-slate-400">appId:</span>
                    <span>{auth.app.options.appId || "N/A"}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-100/50 dark:border-slate-800/40">
                    <span className="text-slate-400">apiKey:</span>
                    <span>{auth.app.options.apiKey ? `${auth.app.options.apiKey.slice(0, 8)}...[masked]...${auth.app.options.apiKey.slice(-4)}` : "N/A"}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-100/50 dark:border-slate-800/40">
                    <span className="text-slate-400">storageBucket:</span>
                    <span>{auth.app.options.storageBucket || "N/A"}</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-slate-400">messagingSenderId:</span>
                    <span>{auth.app.options.messagingSenderId || "N/A"}</span>
                  </div>
                </div>
              </div>

              {/* Group 2: Authentication Runtime */}
              <div className="border border-slate-100 dark:border-slate-800 rounded-xl p-4 space-y-3 bg-slate-50/20 dark:bg-slate-950/5">
                <h4 className="text-xs font-bold text-slate-800 dark:text-white uppercase tracking-wider font-mono">2. Authentication Runtime</h4>
                <div className="space-y-2 font-mono text-[11px] text-slate-600 dark:text-slate-300">
                  <div className="flex justify-between py-1 border-b border-slate-100/50 dark:border-slate-800/40">
                    <span className="text-slate-400">current Auth UID:</span>
                    <span>{auth.currentUser?.uid || "N/A"}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-100/50 dark:border-slate-800/40">
                    <span className="text-slate-400">current Auth email:</span>
                    <span>{auth.currentUser?.email || "N/A"}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-100/50 dark:border-slate-800/40 truncate">
                    <span className="text-slate-400">token audience (aud):</span>
                    <span className="truncate max-w-[200px]" title={idTokenData?.aud}>{idTokenData?.aud || "Loading..."}</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-slate-400">canonical path:</span>
                    <span>users/{auth.currentUser?.uid || "{uid}"}</span>
                  </div>
                </div>
              </div>

              {/* Group 3: Firestore Frontend Runtime */}
              <div className="border border-slate-100 dark:border-slate-800 rounded-xl p-4 space-y-3 bg-slate-50/20 dark:bg-slate-950/5">
                <h4 className="text-xs font-bold text-slate-800 dark:text-white uppercase tracking-wider font-mono">3. Firestore Frontend Runtime</h4>
                <div className="space-y-2 font-mono text-[11px] text-slate-600 dark:text-slate-300">
                  <div className="flex justify-between py-1 border-b border-slate-100/50 dark:border-slate-800/40">
                    <span className="text-slate-400">project ID:</span>
                    <span>{auth.app.options.projectId || "N/A"}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-100/50 dark:border-slate-800/40 truncate">
                    <span className="text-slate-400">exact database ID:</span>
                    <span className="truncate max-w-[200px] text-indigo-600 dark:text-indigo-400 font-bold" title={firestoreDatabaseId}>{firestoreDatabaseId || "N/A"}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-100/50 dark:border-slate-800/40">
                    <span className="text-slate-400">location:</span>
                    <span>europe-west1</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-100/50 dark:border-slate-800/40">
                    <span className="text-slate-400">database scope:</span>
                    <span className="font-bold text-amber-600 dark:text-amber-400">NAMED DATABASE</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-slate-400">init databaseId passed:</span>
                    <span className="truncate max-w-[200px]" title={firestoreDatabaseId}>{firestoreDatabaseId || "N/A"}</span>
                  </div>
                </div>
              </div>

              {/* Group 4: Backend / API Runtime */}
              <div className="border border-slate-100 dark:border-slate-800 rounded-xl p-4 space-y-3 bg-slate-50/20 dark:bg-slate-950/5">
                <h4 className="text-xs font-bold text-slate-800 dark:text-white uppercase tracking-wider font-mono">4. Backend / API Runtime</h4>
                {backendDiagnostic ? (
                  <div className="space-y-2 font-mono text-[11px] text-slate-600 dark:text-slate-300">
                    <div className="flex justify-between py-1 border-b border-slate-100/50 dark:border-slate-800/40">
                      <span className="text-slate-400">backend projectId:</span>
                      <span>{backendDiagnostic.backendProjectId || "N/A"}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-100/50 dark:border-slate-800/40 truncate">
                      <span className="text-slate-400">backend database ID:</span>
                      <span className="truncate max-w-[200px]" title={backendDiagnostic.backendDatabaseId}>{backendDiagnostic.backendDatabaseId || "N/A"}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-100/50 dark:border-slate-800/40">
                      <span className="text-slate-400">service account project ID:</span>
                      <span>{backendDiagnostic.serviceAccountProjectId || "N/A"}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-100/50 dark:border-slate-800/40 truncate">
                      <span className="text-slate-400">service account email:</span>
                      <span className="truncate max-w-[150px]" title={backendDiagnostic.serviceAccountEmail}>{backendDiagnostic.serviceAccountEmail || "N/A"}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-100/50 dark:border-slate-800/40">
                      <span className="text-slate-400">Cloud Run region:</span>
                      <span>{backendDiagnostic.cloudRunRegion || "N/A"}</span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-slate-400">admin SDK init source:</span>
                      <span>{backendDiagnostic.adminSdkSource || "N/A"}</span>
                    </div>
                  </div>
                ) : (
                  <div className="py-8 text-center text-slate-400 text-xs">
                    <span className="inline-block w-4 h-4 border-2 border-slate-300 border-t-transparent rounded-full animate-spin mr-2 align-middle"></span>
                    Loading backend diagnostics...
                  </div>
                )}
              </div>

            </div>

            {/* Group 5: Active read-only probes */}
            <div className="border border-slate-100 dark:border-slate-800 rounded-xl overflow-hidden mt-6 space-y-3 p-4 bg-slate-50/20 dark:bg-slate-950/5">
              <h4 className="text-xs font-bold text-slate-800 dark:text-white uppercase tracking-wider font-mono">5. Safe Read-Only Probes</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xxs font-mono">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 uppercase bg-slate-50 dark:bg-slate-800">
                      <th className="py-2.5 px-3">Path / Collection</th>
                      <th className="py-2.5 px-3">Probe Status</th>
                      <th className="py-2.5 px-3">Diagnostics Info</th>
                      <th className="py-2.5 px-3">Target Database ID</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                    {probeResults.map((p, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/30 dark:hover:bg-slate-950/10">
                        <td className="py-2.5 px-3 font-bold">{p.path}</td>
                        <td className="py-2.5 px-3">
                          <span className={`px-2 py-0.5 rounded-sm text-[9px] font-bold ${p.success ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400" : "bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400"}`}>
                            {p.success ? "SUCCESS" : "FAILURE"}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 max-w-xs truncate">
                          {p.success ? (
                            <span className="text-slate-500 dark:text-slate-400">{p.info} ({p.count} records)</span>
                          ) : (
                            <span className="text-rose-600 dark:text-rose-400" title={`${p.errorCode}: ${p.errorMessage}`}>
                              Code: {p.errorCode} ({p.errorMessage})
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 truncate max-w-[120px]" title={p.databaseId}>{p.databaseId}</td>
                      </tr>
                    ))}
                    {probeResults.length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-6 text-center text-slate-400 font-semibold">
                          No probe logs recorded yet. Click 'Run Live Probes' to execute connectivity test sweeps.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* Detailed Reference Insights Explorer Modal */}
      {viewRefArea && (() => {
        const summary = getAreaReferenceSummary(viewRefArea);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-white dark:bg-slate-900 rounded-2xl max-w-xl w-full border border-slate-100 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
            >
              <div className="p-4 bg-slate-50 dark:bg-slate-950/60 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center">
                <div className="text-left">
                  <h4 className="font-bold text-xs text-slate-400 uppercase tracking-wider font-mono">{isRtl ? "مستكشف الارتباطات والمراجع" : "Detailed Reference Insights"}</h4>
                  <h3 className="font-bold text-slate-800 dark:text-white mt-0.5">{viewRefArea.name} ({viewRefArea.code || viewRefArea.id})</h3>
                </div>
                <button 
                  onClick={() => setViewRefArea(null)}
                  className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-850 rounded-lg cursor-pointer"
                >
                  <span className="font-bold text-sm">✕</span>
                </button>
              </div>

              <div className="p-5 overflow-y-auto space-y-4 flex-1 text-xs text-left">
                {summary.totalReferences === 0 ? (
                  <div className="p-6 text-center text-slate-400 bg-slate-50/50 dark:bg-slate-950/30 border border-dashed border-slate-100 dark:border-slate-800 rounded-xl">
                    <Check className="mx-auto text-emerald-500 mb-2" size={24} />
                    <p className="font-bold">{isRtl ? "لا توجد أي ارتباطات نشطة" : "Zero active references found."}</p>
                    <p className="text-[11px] text-slate-400 mt-1">{isRtl ? "هذا الحي غير مرتبط بأي طبيب، صيدلية، إقليم، أو مستخدم، ومن الآمن حذفه إذا كان من بيانات UAT." : "This Area is not linked to any Physicians, Pharmacies, Territories, or Users. It is safe to delete."}</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-slate-500 dark:text-slate-400 font-medium">
                      {isRtl 
                        ? `تم العثور على ${summary.totalReferences} مرجع نشط في قاعدة البيانات يمنع حذف هذا الحي لحماية سلامة البيانات الحركية والتاريخية:` 
                        : `Found ${summary.totalReferences} active database references preventing deletion to safeguard system integrity:`}
                    </p>

                    {summary.physicians.length > 0 && (
                      <div className="p-3 bg-slate-50 dark:bg-slate-950/30 border border-slate-100 dark:border-slate-800 rounded-xl">
                        <h5 className="font-bold text-slate-700 dark:text-slate-300 flex justify-between">
                          <span>👤 {isRtl ? "الأطباء المرتبطون" : "Linked Physicians"}</span>
                          <span className="font-mono text-slate-400">{summary.physicians.length}</span>
                        </h5>
                        <div className="mt-1.5 max-h-24 overflow-y-auto space-y-1 divide-y divide-slate-100/40 dark:divide-slate-800/40 text-[11px]">
                          {summary.physicians.map((p: any) => (
                            <div key={p.id} className="py-1 flex justify-between font-mono">
                              <span className="font-sans font-medium text-slate-800 dark:text-slate-200">{p.name}</span>
                              <span className="text-slate-400">{p.specialty}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {summary.pharmacies.length > 0 && (
                      <div className="p-3 bg-slate-50 dark:bg-slate-950/30 border border-slate-100 dark:border-slate-800 rounded-xl">
                        <h5 className="font-bold text-slate-700 dark:text-slate-300 flex justify-between">
                          <span>🏥 {isRtl ? "الصيدليات المرتبطة" : "Linked Pharmacies"}</span>
                          <span className="font-mono text-slate-400">{summary.pharmacies.length}</span>
                        </h5>
                        <div className="mt-1.5 max-h-24 overflow-y-auto space-y-1 divide-y divide-slate-100/40 dark:divide-slate-800/40 text-[11px]">
                          {summary.pharmacies.map((ph: any) => (
                            <div key={ph.id} className="py-1 flex justify-between font-mono">
                              <span className="font-sans font-medium text-slate-800 dark:text-slate-200">{ph.name}</span>
                              <span className="text-slate-400 uppercase text-[9px]">{ph.type}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {summary.territories.length > 0 && (
                      <div className="p-3 bg-slate-50 dark:bg-slate-950/30 border border-slate-100 dark:border-slate-800 rounded-xl">
                        <h5 className="font-bold text-slate-700 dark:text-slate-300 flex justify-between">
                          <span>🗺️ {isRtl ? "الأقاليم والمربعات النشطة" : "Active Territory Segments"}</span>
                          <span className="font-mono text-slate-400">{summary.territories.length}</span>
                        </h5>
                        <div className="mt-1.5 max-h-24 overflow-y-auto space-y-1 text-slate-600 dark:text-slate-400 font-mono text-[11px]">
                          {summary.territories.map((t: any) => (
                            <div key={t.id} className="py-1 flex justify-between">
                              <span className="font-sans font-medium text-slate-800 dark:text-slate-200">{t.name}</span>
                              <span className="text-slate-400 text-xxs">ID: {t.id}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {summary.users.length > 0 && (
                      <div className="p-3 bg-slate-50 dark:bg-slate-950/30 border border-slate-100 dark:border-slate-800 rounded-xl">
                        <h5 className="font-bold text-slate-700 dark:text-slate-300 flex justify-between">
                          <span>👥 {isRtl ? "المستخدمون المعينون" : "Assigned Users / Personnel"}</span>
                          <span className="font-mono text-slate-400">{summary.users.length}</span>
                        </h5>
                        <div className="mt-1.5 max-h-24 overflow-y-auto space-y-1 text-slate-600 dark:text-slate-400 font-mono text-[11px]">
                          {summary.users.map((u: any) => (
                            <div key={u.id} className="py-1 flex justify-between">
                              <span className="font-sans font-medium text-slate-800 dark:text-slate-200">{u.displayName || u.email}</span>
                              <span className="text-slate-400">{u.role}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {summary.assignments.length > 0 && (
                      <div className="p-3 bg-slate-50 dark:bg-slate-950/30 border border-slate-100 dark:border-slate-800 rounded-xl">
                        <h5 className="font-bold text-slate-700 dark:text-slate-300 flex justify-between">
                          <span>🔗 {isRtl ? "تعيينات الأقاليم" : "Territory Personnel Alignments"}</span>
                          <span className="font-mono text-slate-400">{summary.assignments.length}</span>
                        </h5>
                        <div className="mt-1.5 max-h-24 overflow-y-auto space-y-1 text-slate-600 dark:text-slate-400 font-mono text-[11px]">
                          {summary.assignments.map((as: any) => (
                            <div key={as.id} className="py-1 flex justify-between">
                              <span className="font-sans font-medium text-slate-800 dark:text-slate-200">{as.repName}</span>
                              <span className="text-slate-400 text-[9px]">ID: {as.territoryId}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {(summary.visits.length > 0 || summary.orders.length > 0) && (
                      <div className="p-3 bg-slate-50 dark:bg-slate-950/30 border border-slate-100 dark:border-slate-800 rounded-xl space-y-2">
                        <h5 className="font-bold text-slate-700 dark:text-slate-300">📈 {isRtl ? "السجلات والزيارات التجارية التاريخية" : "Historical Visit & Order Logs"}</h5>
                        <div className="grid grid-cols-2 gap-2 text-center text-[11px] font-mono">
                          <div className="p-2 bg-slate-100 dark:bg-slate-800 rounded-lg">
                            <span className="text-slate-400 block text-[9px] uppercase font-bold">{isRtl ? "الزيارات" : "Visits Logged"}</span>
                            <span className="font-bold text-slate-850 dark:text-white">{summary.visits.length}</span>
                          </div>
                          <div className="p-2 bg-slate-100 dark:bg-slate-800 rounded-lg">
                            <span className="text-slate-400 block text-[9px] uppercase font-bold">{isRtl ? "الطلبيات" : "Commercial Orders"}</span>
                            <span className="font-bold text-slate-850 dark:text-white">{summary.orders.length}</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="p-4 bg-slate-50 dark:bg-slate-950/40 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
                <button 
                  onClick={() => setViewRefArea(null)}
                  className="px-4 py-2 bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold rounded-lg cursor-pointer transition-colors"
                >
                  {isRtl ? "إغلاق" : "Close"}
                </button>
              </div>
            </motion.div>
          </div>
        );
      })()}

      {/* UAT Cleanup Center Modal */}
      {showCleanupModal && (() => {
        const uatAreas = areas.filter(a => a.isTestData === true);
        const safeUatAreas = uatAreas.filter(a => getAreaReferenceSummary(a).totalReferences === 0);

        const handleSelectAllSafe = () => {
          setSelectedUatIds(safeUatAreas.map(a => a.id));
        };

        const handleClearSelection = () => {
          setSelectedUatIds([]);
        };

        const handleExecuteCleanup = async () => {
          if (selectedUatIds.length === 0) {
            alert(isRtl ? "لم يتم تحديد أي أحياء آمنة لحذفها." : "No safe UAT areas selected for cleanup.");
            return;
          }

          const confirmation = window.confirm(
            isRtl
              ? `هل أنت متأكد من حذف ${selectedUatIds.length} من نطاقات UAT الآمنة المختارة؟ هذه العملية ستزيل السجلات بشكل دائم.`
              : `Are you sure you want to permanently delete the ${selectedUatIds.length} selected safe UAT areas? This cannot be undone.`
          );
          if (!confirmation) return;

          try {
            const batch = writeBatch(db);
            const deletedNames: string[] = [];
            const skippedNames: string[] = [];

            selectedUatIds.forEach(id => {
              const a = areas.find(item => item.id === id);
              if (a) {
                const summary = getAreaReferenceSummary(a);
                if (summary.totalReferences === 0) {
                  batch.delete(doc(db, "areas", id));
                  deletedNames.push(a.name);
                } else {
                  skippedNames.push(a.name);
                }
              }
            });

            await batch.commit();

            const report = {
              scanned: uatAreas.length,
              selected: selectedUatIds.length,
              deleted: deletedNames,
              skipped: skippedNames,
              executor: currentUser?.displayName || currentUser?.email || "Admin Tool",
              timestamp: new Date().toLocaleString()
            };

            setCleanupReport(report);
            setSelectedUatIds([]);
            
            onLogAudit("Cleanup", "areas", `Batch-deleted ${deletedNames.length} safe UAT Area records. Executor: ${report.executor}`);
            showToast(isRtl ? "اكتمل تنظيف السجلات بنجاح" : "UAT batch cleanup completed successfully!");
          } catch (err: any) {
            console.error(err);
            alert("Cleanup Error: " + err.message);
          }
        };

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-white dark:bg-slate-900 rounded-2xl max-w-2xl w-full border border-slate-100 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
            >
              <div className="p-4 bg-rose-50 dark:bg-rose-950/40 border-b border-rose-100 dark:border-rose-900/40 flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <Shield className="text-rose-600 dark:text-rose-400" size={18} />
                  <div className="text-left">
                    <h4 className="font-bold text-[9px] text-rose-500 uppercase tracking-wider font-mono">{isRtl ? "صلاحيات المشرف الفني" : "UAT Sandbox Operations"}</h4>
                    <h3 className="font-bold text-slate-800 dark:text-white text-sm">{isRtl ? "مركز تنظيف وإزالة بيانات اختبار UAT" : "UAT Area Master Cleanup Center"}</h3>
                  </div>
                </div>
                <button 
                  onClick={() => setShowCleanupModal(false)}
                  className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-850 rounded-lg cursor-pointer"
                >
                  <span className="font-bold text-sm">✕</span>
                </button>
              </div>

              <div className="p-5 overflow-y-auto space-y-4 flex-1 text-xs text-left">
                <div className="p-3 bg-slate-50 dark:bg-slate-950/30 border border-slate-100 dark:border-slate-800/80 rounded-xl space-y-1">
                  <p className="font-semibold text-slate-700 dark:text-slate-300">{isRtl ? "إرشادات التنظيف الآمن للبيانات:" : "Sandbox Cleanup Guidelines:"}</p>
                  <p className="text-slate-500 dark:text-slate-400 text-[11px] leading-relaxed">
                    {isRtl 
                      ? "يسرد هذا المركز فقط سجلات الأحياء التي تم استيرادها في وضع UAT (isTestData: true). يقوم تلقائياً بمسح وتحديد السجلات التي تحتوي على صفر ارتباطات نشطة بالأطباء والصيدليات لحذفها بأمان دون التسبب بكسر الهيكل الجغرافي النشط أو فقدان بيانات الزيارات."
                      : "This action lists only Area nodes imported in UAT/Test Mode (isTestData: true). It automatically filters and highlights records with zero references for safe, complete master data cleanup without breaking active routing assignments or visit histories."}
                  </p>
                </div>

                {cleanupReport && (
                  <div className="p-4 bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900 rounded-xl space-y-2">
                    <h5 className="font-bold text-emerald-800 dark:text-emerald-400 flex items-center gap-1.5 uppercase font-mono text-[10px]">
                      <Check size={12} />
                      {isRtl ? "تقرير التنظيف المنجز" : "UAT Cleanup Execution Report"}
                    </h5>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 font-mono text-[10px] text-slate-600 dark:text-slate-400">
                      <div className="p-2 bg-white dark:bg-slate-900/60 rounded-lg border border-emerald-50 dark:border-emerald-950/40">
                        <span className="text-slate-400 block text-[8px] uppercase">{isRtl ? "المفحوص" : "Scanned"}</span>
                        <strong>{cleanupReport.scanned} UAT</strong>
                      </div>
                      <div className="p-2 bg-white dark:bg-slate-900/60 rounded-lg border border-emerald-50 dark:border-emerald-950/40">
                        <span className="text-slate-400 block text-[8px] uppercase">{isRtl ? "المحدد" : "Selected"}</span>
                        <strong>{cleanupReport.selected} safe</strong>
                      </div>
                      <div className="p-2 bg-white dark:bg-slate-900/60 rounded-lg border border-emerald-50 dark:border-emerald-950/40 col-span-2">
                        <span className="text-slate-400 block text-[8px] uppercase">{isRtl ? "المنفذ" : "Executor"}</span>
                        <strong className="truncate block">{cleanupReport.executor}</strong>
                      </div>
                    </div>
                    {cleanupReport.deleted.length > 0 && (
                      <div className="text-[10px] text-slate-500 mt-1">
                        <strong>Deleted ({cleanupReport.deleted.length}):</strong> <span className="font-mono text-[9px]">{cleanupReport.deleted.join(", ")}</span>
                      </div>
                    )}
                    {cleanupReport.skipped.length > 0 && (
                      <div className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">
                        <strong>Skipped (Referenced - {cleanupReport.skipped.length}):</strong> <span className="font-mono text-[9px]">{cleanupReport.skipped.join(", ")}</span>
                      </div>
                    )}
                  </div>
                )}

                {uatAreas.length === 0 ? (
                  <div className="p-8 text-center text-slate-400 font-semibold bg-slate-50/40 dark:bg-slate-950/10 border border-dashed border-slate-100 dark:border-slate-800 rounded-xl">
                    <AlertCircle className="mx-auto text-slate-400 mb-1" size={20} />
                    <p>{isRtl ? "لا توجد سجلات UAT مستوردة في النظام حالياً." : "No UAT/Test Area records detected in Firestore."}</p>
                    <p className="text-[10px] text-slate-400 mt-0.5 font-normal">{isRtl ? "جميع الأحياء الحالية تنتمي لبيانات الإنتاج الأساسية المحمية." : "All registered areas belong to standard production master data."}</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex justify-between items-center text-slate-500 dark:text-slate-400 text-xxs font-bold uppercase tracking-wider">
                      <span>{isRtl ? "سجلات UAT المكتشفة" : "Scanned UAT Area master records"} ({uatAreas.length})</span>
                      <div className="flex gap-2">
                        <button 
                          onClick={handleSelectAllSafe} 
                          className="text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
                        >
                          {isRtl ? "تحديد جميع الآمنة" : "Select All Safe"}
                        </button>
                        <span className="text-slate-300">|</span>
                        <button 
                          onClick={handleClearSelection} 
                          className="text-slate-500 hover:underline cursor-pointer"
                        >
                          {isRtl ? "إلغاء التحديد" : "Clear"}
                        </button>
                      </div>
                    </div>

                    <div className="border border-slate-100 dark:border-slate-800 rounded-xl overflow-hidden divide-y divide-slate-100 dark:divide-slate-800 max-h-56 overflow-y-auto">
                      {uatAreas.map(a => {
                        const summary = getAreaReferenceSummary(a);
                        const isSafe = summary.totalReferences === 0;
                        const isChecked = selectedUatIds.includes(a.id);

                        const toggleCheck = () => {
                          if (!isSafe) return;
                          if (isChecked) {
                            setSelectedUatIds(selectedUatIds.filter(id => id !== a.id));
                          } else {
                            setSelectedUatIds([...selectedUatIds, a.id]);
                          }
                        };

                        return (
                          <div 
                            key={a.id} 
                            onClick={toggleCheck}
                            className={`p-2.5 flex justify-between items-center text-[11px] ${isSafe ? "cursor-pointer hover:bg-slate-50/50 dark:hover:bg-slate-950/20" : "opacity-60 bg-slate-50/30 dark:bg-slate-950/5"}`}
                          >
                            <div className="flex items-center gap-2">
                              <input 
                                type="checkbox"
                                checked={isChecked}
                                disabled={!isSafe}
                                onChange={() => {}} // toggled by row click
                                className="accent-rose-600 cursor-pointer disabled:cursor-not-allowed" 
                              />
                              <div>
                                <span className="font-bold text-slate-800 dark:text-white block">{a.name}</span>
                                <span className="text-[9px] text-slate-400 block font-mono">{a.id} &rarr; {a.cityName}</span>
                              </div>
                            </div>

                            {isSafe ? (
                              <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/60">Safe to Delete</span>
                            ) : (
                              <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border border-amber-100 dark:border-amber-900/60">
                                Referenced ({summary.totalReferences})
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div className="p-4 bg-slate-50 dark:bg-slate-950/40 border-t border-slate-100 dark:border-slate-800 flex justify-between items-center">
                <button 
                  onClick={() => setShowCleanupModal(false)}
                  className="px-4 py-2 bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold rounded-lg cursor-pointer transition-colors"
                >
                  {isRtl ? "إغلاق" : "Close"}
                </button>
                <button 
                  disabled={selectedUatIds.length === 0}
                  onClick={handleExecuteCleanup}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 disabled:hover:bg-rose-600 text-white font-bold rounded-lg cursor-pointer transition-colors flex items-center gap-1.5"
                >
                  <Trash2 size={13} />
                  {isRtl ? `حذف المحدد (${selectedUatIds.length})` : `Delete Selected (${selectedUatIds.length})`}
                </button>
              </div>
            </motion.div>
          </div>
        );
      })()}

    </div>
  );
}
