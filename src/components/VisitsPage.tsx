import React, { useState, useMemo, useEffect } from "react";
import { getVisitBusinessNumber } from "../utils/visitNumberUtils";
import { resolvePharmacyGpsVerificationStatus, getAuthorizedUserIds } from "../features/pharmacyVisit/utils/gpsVerificationResolver";
import { 
  Search, 
  Filter, 
  Calendar, 
  Download, 
  Eye, 
  CheckCircle2, 
  Clock, 
  XCircle, 
  AlertCircle, 
  MapPin, 
  User, 
  Building, 
  Stethoscope, 
  Tag, 
  ChevronLeft, 
  ChevronRight, 
  RefreshCw, 
  FileText, 
  X, 
  ShieldAlert, 
  DollarSign, 
  Package,
  CheckCircle,
  ThumbsUp,
  MessageSquare,
  Award,
  Database
} from "lucide-react";
import { 
  User as UserType, 
  Role, 
  PharmacyVisit, 
  PhysicianVisit, 
  Pharmacy, 
  Physician,
  Product
} from "../types";
import { resolveCanonicalVisitProductName } from "../lib/canonicalVisitDisplay";
import type { PhysicianVisitReadState } from "../lib/physicianVisitReadClient";
import type { PharmacyVisitReadState } from "../lib/pharmacyVisitReadClient";
import { formatCurrencyForIdentity, resolveMarketForIdentity, type MarketBusinessSettings } from "../lib/marketSettings";
import { 
  INITIAL_COUNTRIES, 
  INITIAL_DISTRICTS, 
  INITIAL_CITIES, 
  INITIAL_TERRITORIES 
} from "../lib/alignmentService";

interface VisitsPageProps {
  lang: "en" | "ar";
  currentUser: UserType;
  setActiveView: (view: string) => void;
  users?: UserType[];
  pharmacies?: Pharmacy[];
  physicians?: Physician[];
  pharmacyVisits?: PharmacyVisit[];
  physicianVisits?: PhysicianVisit[];
  physicianVisitReadState?: PhysicianVisitReadState;
  pharmacyVisitReadState?: PharmacyVisitReadState;
  products?: Product[];
  setSelectedPharmacy?: (pharmacy: Pharmacy) => void;
  setSelectedPhysician?: (physician: Physician) => void;
  onViewVisitSummary?: (visit: PhysicianVisit) => void;
  initialTab?: "pharmacy" | "physician";
}

// Normalized Visit Status
export type NormalizedStatus = "COMPLETED" | "IN_PROGRESS" | "CANCELLED" | "DRAFT" | "FAILED";

export function normalizeVisitStatus(statusStr: string | undefined): NormalizedStatus {
  if (!statusStr) return "COMPLETED";
  const upper = statusStr.trim().toUpperCase();
  if (upper === "COMPLETED" || upper === "COMPLETE" || upper === "CHECKED_OUT" || upper === "DONE") {
    return "COMPLETED";
  }
  if (upper === "IN_PROGRESS" || upper === "CHECKED_IN" || upper === "ACTIVE" || upper === "STARTED") {
    return "IN_PROGRESS";
  }
  if (upper === "CANCELLED" || upper === "CANCELED" || upper === "ABORTED" || upper === "REJECTED") {
    return "CANCELLED";
  }
  if (upper === "DRAFT" || upper === "SAVED") {
    return "DRAFT";
  }
  if (upper === "FAILED") {
    return "FAILED";
  }
  return "COMPLETED";
}

export function resolvePharmacyVisitMarketIdentity(visit:any,markets:readonly MarketBusinessSettings[]){
  const identity=visit?.resolvedMarketIdentity;
  if(!identity||typeof identity.marketId!=="string"||typeof identity.countryId!=="string")return null;
  const market=resolveMarketForIdentity(markets,identity);
  return market&&market.marketId===identity.marketId&&market.countryId===identity.countryId?identity:null;
}

export function formatPharmacyVisitCurrency(amount:number,visit:any,markets:readonly MarketBusinessSettings[]){
  const identity=resolvePharmacyVisitMarketIdentity(visit,markets);
  return identity?formatCurrencyForIdentity(amount,identity,markets):"UNCONFIGURED";
}

// Helpers for Role-based Tab Access
export function resolveDisplayLabel(val: any, lang: "en" | "ar" = "en"): string {
  if (val === null || val === undefined) return "—";
  if (typeof val === "boolean") {
    return lang === "ar" ? (val ? "نعم" : "لا") : (val ? "Yes" : "No");
  }
  if (typeof val === "string" || typeof val === "number") {
    if (typeof val === "number" && !isFinite(val)) return "—";
    return String(val);
  }
  if (Array.isArray(val)) {
    if (val.length === 0) return "—";
    return val.map((item) => resolveDisplayLabel(item, lang)).filter((s) => s !== "—" && s !== "").join(", ") || "—";
  }
  if (typeof val === "object") {
    if ("labelEn" in val || "labelAr" in val || "code" in val) {
      if (lang === "ar") {
        if (val.labelAr) return String(val.labelAr);
        if (val.labelEn) return String(val.labelEn);
        if (val.code) return String(val.code);
      } else {
        if (val.labelEn) return String(val.labelEn);
        if (val.code) return String(val.code);
        if (val.labelAr) return String(val.labelAr);
      }
    }

    if ("name" in val || "nameEn" in val || "nameAr" in val) {
      if (lang === "ar") {
        if (val.nameAr) return String(val.nameAr);
        if (val.nameEn) return String(val.nameEn);
        if (val.name) return String(val.name);
      } else {
        if (val.nameEn) return String(val.nameEn);
        if (val.name) return String(val.name);
        if (val.nameAr) return String(val.nameAr);
      }
    }

    if ("title" in val || "titleEn" in val || "titleAr" in val) {
      if (lang === "ar") {
        if (val.titleAr) return String(val.titleAr);
        if (val.titleEn) return String(val.titleEn);
        if (val.title) return String(val.title);
      } else {
        if (val.titleEn) return String(val.titleEn);
        if (val.title) return String(val.title);
        if (val.titleAr) return String(val.titleAr);
      }
    }

    if ("en" in val || "ar" in val) {
      if (lang === "ar") {
        if (val.ar) return String(val.ar);
        if (val.en) return String(val.en);
      } else {
        if (val.en) return String(val.en);
        if (val.ar) return String(val.ar);
      }
    }

    if ("textEn" in val || "textAr" in val || "text" in val) {
      if (lang === "ar") {
        if (val.textAr) return String(val.textAr);
        if (val.textEn) return String(val.textEn);
        if (val.text) return String(val.text);
      } else {
        if (val.textEn) return String(val.textEn);
        if (val.text) return String(val.text);
        if (val.textAr) return String(val.textAr);
      }
    }

    if ("label" in val || "value" in val) {
      if (val.label) return String(val.label);
      if (val.value) return String(val.value);
    }

    if ("descEn" in val || "descAr" in val || "description" in val) {
      if (lang === "ar") {
        if (val.descAr) return String(val.descAr);
        if (val.descEn) return String(val.descEn);
        if (val.description) return String(val.description);
      } else {
        if (val.descEn) return String(val.descEn);
        if (val.description) return String(val.description);
        if (val.descAr) return String(val.descAr);
      }
    }

    const firstStr = Object.values(val).find((v) => typeof v === "string" && v.trim().length > 0);
    if (firstStr) return String(firstStr);

    console.warn("[VISITS_STRUCTURED_LABEL_UNSUPPORTED]", JSON.stringify(val));
    return "—";
  }
  return "—";
}

export function toRenderableText(
  fieldName: string,
  value: any,
  lang: "en" | "ar" = "en",
  recordId: string = "",
  componentSection: string = ""
): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") {
    return lang === "ar" ? (value ? "نعم" : "لا") : (value ? "Yes" : "No");
  }
  if (typeof value === "string" || typeof value === "number") {
    if (typeof value === "number" && !isFinite(value)) return "—";
    return String(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "—";
    return (
      value
        .map((item) => toRenderableText(fieldName, item, lang, recordId, componentSection))
        .filter((s) => s !== "—" && s !== "")
        .join(", ") || "—"
    );
  }
  if (typeof value === "object") {
    const keys = Object.keys(value);
    const resolvedText = resolveDisplayLabel(value, lang);
    console.warn(
      "[VISITS_RAW_OBJECT_RENDER_JSON]",
      JSON.stringify({
        fieldName,
        recordId,
        keys,
        componentSection,
        resolvedText
      })
    );
    return resolvedText;
  }
  return "—";
}

export function safeToLocaleString(val: number | undefined | null): string {
  if (val === null || val === undefined || isNaN(Number(val))) return "0";
  return Number(val).toLocaleString();
}

export function canUserAccessPharmacyTab(user: UserType): boolean {
  if (!user || !user.role) return false;
  const role = user.role;
  // Super Admin, Admins, General Managers, Sales Roles, and Cross/Operations Roles
  if (
    role === Role.SUPER_ADMIN ||
    role === Role.ADMIN ||
    role === Role.SYSTEM_ADMINISTRATOR ||
    role === Role.GENERAL_MANAGER ||
    role === Role.SALES_REP ||
    role === Role.SALES_SUPERVISOR ||
    role === Role.AREA_SALES_MANAGER ||
    role === Role.REGIONAL_MANAGER ||
    role === Role.COUNTRY_MANAGER ||
    role === Role.SALES_MARKETING_MANAGER ||
    role === Role.SALES_MANAGER ||
    role === Role.FINANCE ||
    role === Role.FINANCE_MANAGER ||
    role === Role.PRODUCT_MANAGER ||
    role === Role.ORDER_OPS_OFFICER
  ) {
    return true;
  }
  return false;
}

export function canUserAccessPhysicianTab(user: UserType): boolean {
  if (!user || !user.role) return false;
  const role = user.role;
  // Super Admin, Admins, General Managers, Medical Roles, Marketing, and Cross/Operations Roles
  if (
    role === Role.SUPER_ADMIN ||
    role === Role.ADMIN ||
    role === Role.SYSTEM_ADMINISTRATOR ||
    role === Role.GENERAL_MANAGER ||
    role === Role.MEDICAL_REP ||
    role === Role.MEDICAL_SUPERVISOR ||
    role === Role.MEDICAL_MANAGER ||
    role === Role.REGIONAL_MANAGER ||
    role === Role.COUNTRY_MANAGER ||
    role === Role.SALES_MARKETING_MANAGER ||
    role === Role.AREA_SALES_MANAGER ||
    role === Role.FINANCE ||
    role === Role.FINANCE_MANAGER ||
    role === Role.PRODUCT_MANAGER ||
    role === Role.MARKETING_MANAGER ||
    role === Role.MARKETING_OFFICER ||
    role === Role.MARKETING
  ) {
    return true;
  }
  return false;
}

export default function VisitsPage({
  lang,
  currentUser,
  setActiveView,
  users = [],
  pharmacies = [],
  physicians = [],
  pharmacyVisits = [],
  physicianVisits = [],
  physicianVisitReadState,
  pharmacyVisitReadState,
  products = [],
  setSelectedPharmacy,
  setSelectedPhysician,
  onViewVisitSummary,
  initialTab
}: VisitsPageProps) {
  const marketSettings=pharmacyVisitReadState?.marketSettings||[];
  const visitMoney=(amount:number,visit:any)=>formatPharmacyVisitCurrency(amount,visit,marketSettings);
  const exportMarkets=useMemo(()=>Array.from(new Set((pharmacyVisits as any[]).map(visit=>{const identity=resolvePharmacyVisitMarketIdentity(visit,marketSettings);return identity?resolveMarketForIdentity(marketSettings,identity)?.currencyCode:null}).filter(Boolean))),[pharmacyVisits,marketSettings]);
  const isRtl = lang === "ar";

  // Check tab access rights
  const hasPharmacyAccess = canUserAccessPharmacyTab(currentUser);
  const hasPhysicianAccess = canUserAccessPhysicianTab(currentUser);

  // Determine initial active tab based on role and access
  const defaultTab = useMemo<"pharmacy" | "physician">(() => {
    if (initialTab && initialTab === "pharmacy" && hasPharmacyAccess) return "pharmacy";
    if (initialTab && initialTab === "physician" && hasPhysicianAccess) return "physician";

    const role = currentUser.role;
    if (role === Role.SALES_REP || role === Role.SALES_SUPERVISOR) {
      if (hasPharmacyAccess) return "pharmacy";
    }
    if (role === Role.MEDICAL_REP || role === Role.MEDICAL_SUPERVISOR) {
      if (hasPhysicianAccess) return "physician";
    }
    if (hasPharmacyAccess) return "pharmacy";
    if (hasPhysicianAccess) return "physician";
    return "pharmacy";
  }, [currentUser, hasPharmacyAccess, hasPhysicianAccess, initialTab]);

  const [activeTab, setActiveTab] = useState<"pharmacy" | "physician">(defaultTab);

  // Sync activeTab if access rights change
  useEffect(() => {
    if (activeTab === "pharmacy" && !hasPharmacyAccess && hasPhysicianAccess) {
      setActiveTab("physician");
    } else if (activeTab === "physician" && !hasPhysicianAccess && hasPharmacyAccess) {
      setActiveTab("pharmacy");
    }
  }, [activeTab, hasPharmacyAccess, hasPhysicianAccess]);

  // Search and Filtering States
  const [searchTerm, setSearchTerm] = useState("");
  const [dateRange, setDateRange] = useState<"all" | "today" | "this_week" | "last_30_days" | "custom">("all");
  const [customFromDate, setCustomFromDate] = useState("");
  const [customToDate, setCustomToDate] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | NormalizedStatus>("ALL");
  const [supervisorFilter, setSupervisorFilter] = useState("ALL");
  const [repFilter, setRepFilter] = useState("ALL");

  // Cascading Geography Filters
  const [countryFilter, setCountryFilter] = useState("ALL");
  const [districtFilter, setDistrictFilter] = useState("ALL");
  const [cityFilter, setCityFilter] = useState("ALL");
  const [areaFilter, setAreaFilter] = useState("ALL");

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Detail Modal State
  const [selectedVisitForModal, setSelectedVisitForModal] = useState<{
    visit: PharmacyVisit | PhysicianVisit;
    type: "pharmacy" | "physician";
  } | null>(null);

  const [profileNotFoundError, setProfileNotFoundError] = useState<string | null>(null);

  // Subordinate / Team Scope Resolution
  const teamSubordinateIds = useMemo(() => {
    const ids = new Set<string>();
    if (!currentUser || !currentUser.id) return ids;

    users.forEach((u) => {
      if (
        u.managerId === currentUser.id
      ) {
        ids.add(u.id);
        if (u.email) ids.add(u.email);
      }
    });
    return ids;
  }, [currentUser, users]);

  const userAssignedAreas = useMemo(() => {
    const areas = new Set<string>();
    if (currentUser.areaIds) {
      currentUser.areaIds.forEach((a) => areas.add(a));
    }
    if (currentUser.territories) {
      currentUser.territories.forEach((t) => areas.add(t));
    }
    return areas;
  }, [currentUser]);

  // 1. Process & Validate Pharmacy Visits
  const { validPharmacyVisits, invalidPharmacyRecordIds } = useMemo(() => {
    const valid: (PharmacyVisit & { normalizedStatus: NormalizedStatus })[] = [];
    const invalidIds: { id: string; reason: string }[] = [];

    pharmacyVisits.forEach((v: any, index) => {
      const recordId = v.id || `PHARMACY_VISIT_${index}`;
      const customerId = v.pharmacyId || v.pharmacySnapshot?.id || v.pharmacyName;
      const repId = v.repId || v.representativeId || v.createdBy || v.salesRepId;
      const dateVal = v.visitDate || v.date || v.createdAt;

      if (!v.id || !customerId || !repId || !dateVal) {
        invalidIds.push({
          id: recordId,
          reason: `Missing required field: ${!v.id ? "id " : ""}${!customerId ? "pharmacyId " : ""}${!repId ? "repId " : ""}${!dateVal ? "visitDate" : ""}`
        });
        return;
      }

      // Pharmacy visit READ authorization is enforced by the canonical backend.
      // Client logic below is presentation/record-shape handling only.
      valid.push({
        ...v,
        normalizedStatus: normalizeVisitStatus(v.status)
      });
    });

    return { validPharmacyVisits: valid, invalidPharmacyRecordIds: invalidIds };
  }, [pharmacyVisits, currentUser, teamSubordinateIds, userAssignedAreas]);

  // 2. Process & Validate Physician Visits
  const { validPhysicianVisits, invalidPhysicianRecordIds } = useMemo(() => {
    const valid: (PhysicianVisit & { normalizedStatus: NormalizedStatus })[] = [];
    const invalidIds: { id: string; reason: string }[] = [];

    physicianVisits.forEach((v: any, index) => {
      const recordId = v.id || `PHYSICIAN_VISIT_${index}`;
      const customerId = v.physicianId || v.physicianName;
      const repId = v.repId || v.representativeId || v.createdBy || v.medicalRepId;
      const dateVal = v.visitDate || v.date || v.createdAt;

      if (!v.id || !customerId || !repId || !dateVal) {
        invalidIds.push({
          id: recordId,
          reason: `Missing required field: ${!v.id ? "id " : ""}${!customerId ? "physicianId " : ""}${!repId ? "repId " : ""}${!dateVal ? "visitDate" : ""}`
        });
        return;
      }

      // Physician visit READ authorization is enforced by the canonical backend.
      // Client logic below is presentation/record-shape handling only.
      valid.push({
        ...v,
        normalizedStatus: normalizeVisitStatus(v.status)
      });
    });

    return { validPhysicianVisits: valid, invalidPhysicianRecordIds: invalidIds };
  }, [physicianVisits, currentUser, teamSubordinateIds, userAssignedAreas]);

  // Diagnostics JSON Output
  useEffect(() => {
    if (hasPharmacyAccess) {
      console.info(
        "[PHARMACY_VISITS_PAGE_PIPELINE_JSON]",
        JSON.stringify({
          authUid: currentUser.id,
          role: currentUser.role,
          resolvedAreaIds: Array.from(userAssignedAreas),
          rawSnapshotCount: pharmacyVisits.length,
          validMappedCount: validPharmacyVisits.length,
          invalidRecordCount: invalidPharmacyRecordIds.length,
          authorizedCount: validPharmacyVisits.length,
          errorCode: null
        })
      );
    }
    if (hasPhysicianAccess) {
      console.info(
        "[PHYSICIAN_VISITS_PAGE_PIPELINE_JSON]",
        JSON.stringify({
          authUid: currentUser.id,
          role: currentUser.role,
          resolvedAreaIds: Array.from(userAssignedAreas),
          rawSnapshotCount: physicianVisits.length,
          validMappedCount: validPhysicianVisits.length,
          invalidRecordCount: invalidPhysicianRecordIds.length,
          authorizedCount: validPhysicianVisits.length,
          errorCode: null
        })
      );
    }
    const allInvalid = [
      ...invalidPharmacyRecordIds.map((r) => ({ visitType: "Pharmacy", ...r })),
      ...invalidPhysicianRecordIds.map((r) => ({ visitType: "Physician", ...r }))
    ];
    if (allInvalid.length > 0) {
      console.warn(
        "[VISITS_INVALID_RECORDS_JSON]",
        JSON.stringify({
          totalInvalidCount: allInvalid.length,
          records: allInvalid
        })
      );
    }
  }, [
    currentUser,
    hasPharmacyAccess,
    hasPhysicianAccess,
    pharmacyVisits,
    physicianVisits,
    validPharmacyVisits,
    validPhysicianVisits,
    invalidPharmacyRecordIds,
    invalidPhysicianRecordIds,
    userAssignedAreas
  ]);

  // Filtering Logic Function
  const filterVisitsList = <T extends { normalizedStatus: NormalizedStatus; [key: string]: any }>(
    list: T[],
    isPharmacy: boolean
  ) => {
    return list.filter((v) => {
      // 1. Search Term Filter
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase().trim();
        const businessNo = getVisitBusinessNumber(v);
        const displayNoMatch = businessNo.toLowerCase().includes(query) || (v.displayNumber || "").toLowerCase().includes(query) || (v.visitNumber || "").toLowerCase().includes(query);
        const repMatch = resolveDisplayLabel(v.repName || v.createdBy || "", lang).toLowerCase().includes(query);
        const customerMatch = isPharmacy
          ? resolveDisplayLabel(v.pharmacyName || v.pharmacySnapshot?.nameEn || v.pharmacySnapshot?.nameAr || "", lang).toLowerCase().includes(query)
          : resolveDisplayLabel(v.physicianName || v.physicianSpecialty || v.specialty || "", lang).toLowerCase().includes(query);

        if (!displayNoMatch && !repMatch && !customerMatch) return false;
      }

      // 2. Status Filter
      if (statusFilter !== "ALL") {
        if (v.normalizedStatus !== statusFilter) return false;
      }

      // 3. Date Range Filter
      const visitDateStr = v.visitDate || v.date || v.createdAt;
      if (visitDateStr && dateRange !== "all") {
        const visitDateObj = new Date(visitDateStr);
        const now = new Date();

        if (dateRange === "today") {
          const todayStr = now.toISOString().substring(0, 10);
          if (!visitDateStr.startsWith(todayStr)) return false;
        } else if (dateRange === "this_week") {
          const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          if (visitDateObj < sevenDaysAgo) return false;
        } else if (dateRange === "last_30_days") {
          const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          if (visitDateObj < thirtyDaysAgo) return false;
        } else if (dateRange === "custom") {
          if (customFromDate) {
            const fromObj = new Date(customFromDate);
            if (visitDateObj < fromObj) return false;
          }
          if (customToDate) {
            const toObj = new Date(customToDate + "T23:59:59");
            if (visitDateObj > toObj) return false;
          }
        }
      }

      // 4. Supervisor Filter
      if (supervisorFilter !== "ALL") {
        const rep = users.find((u) => u.id === (v.repId || v.representativeId) || u.name === v.repName);
        if (!rep || rep.managerId !== supervisorFilter) {
          return false;
        }
      }

      // 5. Representative Filter
      if (repFilter !== "ALL") {
        const vRepId = v.repId || v.representativeId;
        const vRepName = v.repName || v.createdBy;
        if (vRepId !== repFilter && vRepName !== repFilter) return false;
      }

      // 6. Geographic Filters
      if (countryFilter !== "ALL") {
        if (v.countryId !== countryFilter && v.countryName !== countryFilter) return false;
      }
      if (districtFilter !== "ALL") {
        if (v.districtId !== districtFilter && v.districtName !== districtFilter) return false;
      }
      if (cityFilter !== "ALL") {
        if (v.cityId !== cityFilter && v.cityName !== cityFilter) return false;
      }
      if (areaFilter !== "ALL") {
        if (v.areaId !== areaFilter && v.areaName !== areaFilter) return false;
      }

      return true;
    });
  };

  // Filtered Lists
  const filteredPharmacyVisits = useMemo(() => {
    return filterVisitsList(validPharmacyVisits, true);
  }, [validPharmacyVisits, searchTerm, statusFilter, dateRange, customFromDate, customToDate, supervisorFilter, repFilter, countryFilter, districtFilter, cityFilter, areaFilter, users]);

  const filteredPhysicianVisits = useMemo(() => {
    return filterVisitsList(validPhysicianVisits, false);
  }, [validPhysicianVisits, searchTerm, statusFilter, dateRange, customFromDate, customToDate, supervisorFilter, repFilter, countryFilter, districtFilter, cityFilter, areaFilter, users]);

  // Active Filtered List based on Active Tab
  const currentFilteredList = activeTab === "pharmacy" ? filteredPharmacyVisits : filteredPhysicianVisits;

  // Reset pagination when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, searchTerm, statusFilter, dateRange, customFromDate, customToDate, supervisorFilter, repFilter, countryFilter, districtFilter, cityFilter, areaFilter]);

  // KPI Statistics
  const kpiStats = useMemo(() => {
    const list = currentFilteredList;
    const total = list.length;
    const completed = list.filter((v) => v.normalizedStatus === "COMPLETED").length;
    const inProgress = list.filter((v) => v.normalizedStatus === "IN_PROGRESS").length;
    const cancelled = list.filter((v) => v.normalizedStatus === "CANCELLED" || v.normalizedStatus === "FAILED").length;
    return { total, completed, inProgress, cancelled };
  }, [currentFilteredList]);

  // Paginated View
  const totalPages = Math.ceil(currentFilteredList.length / pageSize) || 1;
  const paginatedList = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return currentFilteredList.slice(start, start + pageSize);
  }, [currentFilteredList, currentPage, pageSize]);

  // Cascading Geography Dropdown Options
  const availableDistricts = useMemo(() => {
    if (countryFilter === "ALL") return INITIAL_DISTRICTS;
    return INITIAL_DISTRICTS.filter((d) => d.countryId === countryFilter || d.countryName === countryFilter);
  }, [countryFilter]);

  const availableCities = useMemo(() => {
    if (districtFilter === "ALL") {
      if (countryFilter === "ALL") return INITIAL_CITIES;
      return INITIAL_CITIES.filter((c) => c.countryId === countryFilter || c.countryName === countryFilter);
    }
    return INITIAL_CITIES.filter((c) => c.districtId === districtFilter || c.districtName === districtFilter);
  }, [countryFilter, districtFilter]);

  const availableAreas = useMemo(() => {
    if (cityFilter === "ALL") {
      if (districtFilter === "ALL") return INITIAL_TERRITORIES;
      return INITIAL_TERRITORIES.filter((t) => t.districtId === districtFilter || t.districtName === districtFilter);
    }
    return INITIAL_TERRITORIES.filter((t) => t.cityId === cityFilter || t.cityName === cityFilter);
  }, [districtFilter, cityFilter]);

  // Available Supervisors and Reps for Filters
  const availableSupervisors = useMemo(() => {
    return users.filter((u) => 
      u.role === Role.SALES_SUPERVISOR || 
      u.role === Role.MEDICAL_SUPERVISOR || 
      u.role === Role.AREA_SALES_MANAGER
    );
  }, [users]);

  const availableReps = useMemo(() => {
    return users.filter((u) => 
      u.role === Role.SALES_REP || 
      u.role === Role.MEDICAL_REP
    );
  }, [users]);

  // Export CSV Handler
  const handleExportCSV = () => {
    if (currentFilteredList.length === 0) return;

    let csvContent = "data:text/csv;charset=utf-8,";

    if (activeTab === "pharmacy") {
      const headers = [
        "Visit No.",
        "Date",
        "Pharmacy Name",
        "Representative",
        "Purpose",
        "Status",
        `Billed Amount (${exportMarkets.length===1?exportMarkets[0]:"UNCONFIGURED"})`,
        `Collected Amount (${exportMarkets.length===1?exportMarkets[0]:"UNCONFIGURED"})`,
        "GPS Verified"
      ];
      const rows = (currentFilteredList as PharmacyVisit[]).map((v, idx) => [
        getVisitBusinessNumber(v, idx, "PV"),
        v.visitDate || v.date || "",
        `"${resolveDisplayLabel(v.pharmacyName || (v as any).pharmacySnapshot?.nameEn || (v as any).pharmacySnapshot?.nameAr || "", lang).replace(/"/g, '""')}"`,
        `"${resolveDisplayLabel(v.repName || (v as any).createdBy || "", lang).replace(/"/g, '""')}"`,
        `"${resolveDisplayLabel(v.visitPurpose || "", lang).replace(/"/g, '""')}"`,
        resolveDisplayLabel((v as any).status || "COMPLETED", lang),
        visitMoney(Number((v as any).orderTotal ?? (v as any).netAmount ?? v.totalAmount ?? 0),v),
        visitMoney(Number((v as any).collectedAmount ?? v.paymentCollected ?? 0),v),
        v.gpsVerified ? "Yes" : "No"
      ]);
      csvContent += [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    } else {
      const headers = [
        "Visit No.",
        "Date",
        "Physician Name",
        "Specialty",
        "Representative",
        "Primary Group / Purpose",
        "Status",
        "Products Detailed",
        "Samples Disbursed",
        "Prescription Intent",
        "GPS Verified"
      ];
      const rows = (currentFilteredList as PhysicianVisit[]).map((v, idx) => [
        getVisitBusinessNumber(v, idx, "MV"),
        v.visitDate || v.date || "",
        `"${resolveDisplayLabel(v.physicianName || "", lang).replace(/"/g, '""')}"`,
        `"${resolveDisplayLabel((v as any).physicianSpecialty || (v as any).specialty || "", lang).replace(/"/g, '""')}"`,
        `"${resolveDisplayLabel(v.repName || (v as any).createdBy || "", lang).replace(/"/g, '""')}"`,
        `"${resolveDisplayLabel(v.primaryPromotionGroup || (v as any).visitPurpose || "", lang).replace(/"/g, '""')}"`,
        resolveDisplayLabel((v as any).status || "COMPLETED", lang),
        (v.detailing || []).length,
        (v.samples || []).reduce((acc, s) => acc + (s.quantity || 0), 0),
        `${v.prescriptionIntent || 0}/10`,
        v.gpsVerified ? "Yes" : "No"
      ]);
      csvContent += [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    }

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `${activeTab}_visits_ledger_${new Date().toISOString().substring(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Profile Navigation Helper
  const handleNavigateToCustomerProfile = (customerId: string, customerType: "pharmacy" | "physician") => {
    if (customerType === "pharmacy") {
      const matched = pharmacies.find((p) => p.id === customerId || p.name === customerId || p.nameAr === customerId);
      if (matched) {
        if (setSelectedPharmacy) setSelectedPharmacy(matched);
        setSelectedVisitForModal(null);
        setActiveView("pharmacies-profile");
      } else {
        setProfileNotFoundError(isRtl ? "سجل الصيدلية غير موجود في القائمة المعتمدة" : "Profile Record Not Found in canonical database.");
      }
    } else {
      const matched = physicians.find((p) => p.id === customerId || p.name === customerId || p.nameAr === customerId);
      if (matched) {
        if (setSelectedPhysician) setSelectedPhysician(matched);
        setSelectedVisitForModal(null);
        setActiveView("field-physician-profile");
      } else {
        setProfileNotFoundError(isRtl ? "سجل الطبيب غير موجود في القائمة المعتمدة" : "Profile Record Not Found in canonical database.");
      }
    }
  };

  // Check if current user has permission to view the current tab
  const isCurrentTabAllowed = activeTab === "pharmacy" ? hasPharmacyAccess : hasPhysicianAccess;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto" dir={isRtl ? "rtl" : "ltr"} id="visits-review-container">
      
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Calendar className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
            <h1 className="text-xl font-bold text-slate-900 dark:text-white" id="visits-page-title">
              {isRtl ? "سجل الزيارات" : "Visits"}
            </h1>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {isRtl 
              ? "مراجعة والتحقق من زيارات الصيدليات والأطباء المكتملة والميدانية" 
              : "Review and verify completed Pharmacy and Physician visits."}
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleExportCSV}
            disabled={currentFilteredList.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold shadow-xs disabled:opacity-40 cursor-pointer transition-all"
            id="export-visits-csv-btn"
          >
            <Download size={14} />
            <span>{isRtl ? "تصدير CSV" : "Export CSV"}</span>
          </button>
        </div>
      </div>

      {activeTab === "physician" && physicianVisitReadState?.status === "LOADING" && (
        <div id="physician-visits-loading" role="status" className="p-3 rounded-xl border border-indigo-200 bg-indigo-50 text-xs text-indigo-700">
          {isRtl ? "جارٍ تحميل سجلات زيارات الأطباء…" : "Loading physician visit records…"}
        </div>
      )}
      {activeTab === "physician" && ["ERROR", "DENIED"].includes(physicianVisitReadState?.status || "") && (
        <div id="physician-visits-read-error" role="alert" className="p-3 rounded-xl border border-rose-200 bg-rose-50 text-xs text-rose-700">
          {isRtl ? "تعذر تحميل سجلات زيارات الأطباء. لم يتم عرض نتيجة صفرية بديلة." : "Physician visit records could not be loaded. No zero-result fallback is being shown."}
          {physicianVisitReadState?.errorCode ? ` (${physicianVisitReadState.errorCode})` : ""}
        </div>
      )}

      {/* Role-Based Tab Switcher */}
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
        {hasPharmacyAccess && (
          <button
            onClick={() => setActiveTab("pharmacy")}
            className={`px-4 py-2.5 text-xs font-bold rounded-xl transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === "pharmacy"
                ? "bg-indigo-600 text-white shadow-sm"
                : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
            }`}
            id="tab-pharmacy-visits"
          >
            <Building size={16} />
            <span>{isRtl ? "زيارات الصيدليات" : "Pharmacy Visits"}</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] ${activeTab === "pharmacy" ? "bg-indigo-500 text-white" : "bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300"}`}>
              {validPharmacyVisits.length}
            </span>
          </button>
        )}

        {hasPhysicianAccess && (
          <button
            onClick={() => setActiveTab("physician")}
            className={`px-4 py-2.5 text-xs font-bold rounded-xl transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === "physician"
                ? "bg-indigo-600 text-white shadow-sm"
                : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
            }`}
            id="tab-physician-visits"
          >
            <Stethoscope size={16} />
            <span>{isRtl ? "زيارات الأطباء" : "Physician Visits"}</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] ${activeTab === "physician" ? "bg-indigo-500 text-white" : "bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300"}`}>
              {validPhysicianVisits.length}
            </span>
          </button>
        )}
      </div>

      {/* Permission Denied Banner if user tries to access unauthorized tab */}
      {!isCurrentTabAllowed ? (
        <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 rounded-2xl p-6 text-center space-y-3">
          <ShieldAlert className="h-10 w-10 text-amber-600 dark:text-amber-400 mx-auto" />
          <h3 className="text-sm font-bold text-amber-900 dark:text-amber-200">
            {isRtl ? "غير مصرح بالإطلاع" : "Permission Denied"}
          </h3>
          <p className="text-xs text-amber-700 dark:text-amber-300 max-w-md mx-auto">
            {isRtl
              ? "دورك الوظيفي الحالي لا يملك صلاحية عرض سجل هذه الزيارات."
              : "Your assigned role does not have authorization to view this visit ledger."}
          </p>
        </div>
      ) : (
        <>
          {/* KPI Summary Banner */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-xs">
              <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-1">
                <span className="text-xs font-semibold">{isRtl ? "إجمالي الزيارات" : "Total Visits"}</span>
                <Calendar size={16} className="text-indigo-500" />
              </div>
              <div className="text-xl font-extrabold text-slate-900 dark:text-white font-mono">
                {kpiStats.total}
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-xs">
              <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-1">
                <span className="text-xs font-semibold">{isRtl ? "مكتملة" : "Completed"}</span>
                <CheckCircle2 size={16} className="text-emerald-500" />
              </div>
              <div className="text-xl font-extrabold text-emerald-600 dark:text-emerald-400 font-mono">
                {kpiStats.completed}
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-xs">
              <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-1">
                <span className="text-xs font-semibold">{isRtl ? "قيد التنفيذ / دخول" : "In Progress"}</span>
                <Clock size={16} className="text-amber-500" />
              </div>
              <div className="text-xl font-extrabold text-amber-600 dark:text-amber-400 font-mono">
                {kpiStats.inProgress}
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-xs">
              <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-1">
                <span className="text-xs font-semibold">{isRtl ? "ملغاة" : "Cancelled"}</span>
                <XCircle size={16} className="text-rose-500" />
              </div>
              <div className="text-xl font-extrabold text-rose-600 dark:text-rose-400 font-mono">
                {kpiStats.cancelled}
              </div>
            </div>
          </div>

          {/* Filter Toolbar */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-xs space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
              {/* Search Bar */}
              <div className="relative col-span-1 sm:col-span-2">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder={
                    isRtl
                      ? activeTab === "pharmacy"
                        ? "البحث باسم الصيدلية، المندوب، رمز الزيارة..."
                        : "البحث باسم الطبيب، المندوب، التخصص..."
                      : activeTab === "pharmacy"
                      ? "Search pharmacy, rep, visit ID..."
                      : "Search doctor, rep, specialty..."
                  }
                  className="w-full text-xs pl-9 pr-4 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  id="visits-search-input"
                />
              </div>

              {/* Status Filter */}
              <div>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as any)}
                  className="w-full text-xs py-2 px-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  id="visits-status-filter"
                >
                  <option value="ALL">{isRtl ? "جميع الحالات" : "All Statuses"}</option>
                  <option value="COMPLETED">{isRtl ? "مكتملة" : "Completed"}</option>
                  <option value="IN_PROGRESS">{isRtl ? "قيد التنفيذ" : "In Progress"}</option>
                  <option value="CANCELLED">{isRtl ? "ملغاة" : "Cancelled"}</option>
                  <option value="DRAFT">{isRtl ? "مسودة" : "Draft"}</option>
                </select>
              </div>

              {/* Date Quick Filter */}
              <div>
                <select
                  value={dateRange}
                  onChange={(e) => setDateRange(e.target.value as any)}
                  className="w-full text-xs py-2 px-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  id="visits-date-filter"
                >
                  <option value="all">{isRtl ? "كافة التواريخ" : "All Time"}</option>
                  <option value="today">{isRtl ? "اليوم" : "Today"}</option>
                  <option value="this_week">{isRtl ? "هذا الأسبوع" : "This Week"}</option>
                  <option value="last_30_days">{isRtl ? "آخر 30 يوم" : "Last 30 Days"}</option>
                  <option value="custom">{isRtl ? "نطاق تاريخ مخصص" : "Custom Range"}</option>
                </select>
              </div>
            </div>

            {/* Custom Date Pickers if selected */}
            {dateRange === "custom" && (
              <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">{isRtl ? "من:" : "From:"}</span>
                  <input
                    type="date"
                    value={customFromDate}
                    onChange={(e) => setCustomFromDate(e.target.value)}
                    className="text-xs py-1.5 px-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">{isRtl ? "إلى:" : "To:"}</span>
                  <input
                    type="date"
                    value={customToDate}
                    onChange={(e) => setCustomToDate(e.target.value)}
                    className="text-xs py-1.5 px-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200"
                  />
                </div>
              </div>
            )}

            {/* Cascading Geography & Role Filters */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              {/* Country */}
              <select
                value={countryFilter}
                onChange={(e) => {
                  setCountryFilter(e.target.value);
                  setDistrictFilter("ALL");
                  setCityFilter("ALL");
                  setAreaFilter("ALL");
                }}
                className="text-[11px] py-1.5 px-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300"
              >
                <option value="ALL">{isRtl ? "الدولة: الكل" : "Country: All"}</option>
                {INITIAL_COUNTRIES.map((c) => (
                  <option key={c.id} value={c.id}>{toRenderableText("countryFilter", c.name || c, lang)}</option>
                ))}
              </select>

              {/* District */}
              <select
                value={districtFilter}
                onChange={(e) => {
                  setDistrictFilter(e.target.value);
                  setCityFilter("ALL");
                  setAreaFilter("ALL");
                }}
                className="text-[11px] py-1.5 px-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300"
              >
                <option value="ALL">{isRtl ? "المحافظة: الكل" : "District: All"}</option>
                {availableDistricts.map((d) => (
                  <option key={d.id} value={d.id}>{toRenderableText("districtFilter", d.name || d, lang)}</option>
                ))}
              </select>

              {/* City */}
              <select
                value={cityFilter}
                onChange={(e) => {
                  setCityFilter(e.target.value);
                  setAreaFilter("ALL");
                }}
                className="text-[11px] py-1.5 px-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300"
              >
                <option value="ALL">{isRtl ? "المدينة: الكل" : "City: All"}</option>
                {availableCities.map((c) => (
                  <option key={c.id} value={c.id}>{toRenderableText("cityFilter", c.name || c, lang)}</option>
                ))}
              </select>

              {/* Area */}
              <select
                value={areaFilter}
                onChange={(e) => setAreaFilter(e.target.value)}
                className="text-[11px] py-1.5 px-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300"
              >
                <option value="ALL">{isRtl ? "المنطقة: الكل" : "Area: All"}</option>
                {availableAreas.map((a) => (
                  <option key={a.territoryId} value={a.territoryId}>{toRenderableText("areaFilter", a.areaName || a.territoryName || a, lang)}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Profile Not Found Alert */}
          {profileNotFoundError && (
            <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl flex items-center justify-between text-rose-700 dark:text-rose-300 text-xs">
              <div className="flex items-center gap-2">
                <AlertCircle size={16} />
                <span>{profileNotFoundError}</span>
              </div>
              <button onClick={() => setProfileNotFoundError(null)} className="p-1 hover:opacity-75">
                <X size={14} />
              </button>
            </div>
          )}

          {/* Main List Container */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
            {currentFilteredList.length === 0 ? (
              <div className="p-12 text-center space-y-3">
                <Calendar className="h-10 w-10 text-slate-300 dark:text-slate-700 mx-auto" />
                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">
                  {isRtl ? "لا توجد زيارات مسجلة تطابق التصفية" : "No visits match the current filters"}
                </h3>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  {isRtl
                    ? "جرّب تغيير كلمات البحث أو إعادة ضبط الفلاتر الجغرافية وتواريخ العرض."
                    : "Try adjusting search terms or clearing status and geographic filters."}
                </p>
              </div>
            ) : (
              <>
                {/* Desktop Table View */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-slate-950/60 text-[11px] font-bold text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800 uppercase tracking-wider">
                        <th className="py-3 px-4">{isRtl ? "رقم الزيارة" : "Visit No."}</th>
                        <th className="py-3 px-4">{isRtl ? "التاريخ والوقت" : "Date & Time"}</th>
                        <th className="py-3 px-4">
                          {activeTab === "pharmacy" ? (isRtl ? "اسم الصيدلية" : "Pharmacy") : (isRtl ? "اسم الطبيب / التخصص" : "Physician / Specialty")}
                        </th>
                        <th className="py-3 px-4">{isRtl ? "المندوب" : "Representative"}</th>
                        <th className="py-3 px-4">{isRtl ? "الغرض / الفئة" : "Purpose"}</th>
                        <th className="py-3 px-4">{isRtl ? "الحالة" : "Status"}</th>
                        <th className="py-3 px-4">{isRtl ? "الموقع الجغرافي" : "GPS Status"}</th>
                        <th className="py-3 px-4 text-right">{isRtl ? "الإجراء" : "Action"}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                      {paginatedList.map((v: any, idx: number) => {
                        const status = v.normalizedStatus;
                        const dateStr = v.visitDate || v.date || (v.createdAt ? v.createdAt.substring(0, 10) : "");
                        const visitNo = getVisitBusinessNumber(v, (currentPage - 1) * pageSize + idx, activeTab === "pharmacy" ? "PV" : "MV");

                        return (
                          <tr key={v.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                            <td className="py-3.5 px-4 font-mono font-bold text-indigo-600 dark:text-indigo-400">
                              {toRenderableText("displayNumber", visitNo, lang, v.id, "Table")}
                            </td>
                            <td className="py-3.5 px-4 text-slate-600 dark:text-slate-300 font-mono">
                              {toRenderableText("visitDate", dateStr, lang, v.id, "Table")}
                            </td>
                            <td className="py-3.5 px-4 font-semibold text-slate-900 dark:text-white">
                              {activeTab === "pharmacy" ? (
                                <div>
                                  <button
                                    onClick={() => handleNavigateToCustomerProfile(v.pharmacyId, "pharmacy")}
                                    className="hover:underline text-indigo-600 dark:text-indigo-400 font-bold text-left cursor-pointer"
                                  >
                                    {toRenderableText("pharmacyName", v.pharmacyName || v.pharmacySnapshot?.nameEn || v.pharmacySnapshot?.nameAr || v.pharmacyId, lang, v.id, "Table")}
                                  </button>
                                </div>
                              ) : (
                                <div>
                                  <button
                                    onClick={() => handleNavigateToCustomerProfile(v.physicianId, "physician")}
                                    className="hover:underline text-indigo-600 dark:text-indigo-400 font-bold text-left cursor-pointer"
                                  >
                                    {toRenderableText("physicianName", v.physicianName || v.physicianId, lang, v.id, "Table")}
                                  </button>
                                  <div className="text-[10px] text-slate-400">
                                    {toRenderableText("physicianSpecialty", v.physicianSpecialty || v.specialty || "General Practice", lang, v.id, "Table")}
                                  </div>
                                </div>
                              )}
                            </td>
                            <td className="py-3.5 px-4 text-slate-700 dark:text-slate-300">
                              {toRenderableText("repName", v.repName || v.createdBy || "Sales Rep", lang, v.id, "Table")}
                            </td>
                            <td className="py-3.5 px-4 text-slate-600 dark:text-slate-400">
                              {toRenderableText(
                                "visitPurpose",
                                activeTab === "pharmacy"
                                  ? v.visitPurpose || "Order Intake"
                                  : v.primaryPromotionGroup || v.visitPurpose || "Scientific Detailing",
                                lang,
                                v.id,
                                "Table"
                              )}
                            </td>
                            <td className="py-3.5 px-4">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                status === "COMPLETED" 
                                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                                  : status === "IN_PROGRESS"
                                  ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                                  : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                              }`}>
                                {toRenderableText("status", status, lang, v.id, "Table")}
                              </span>
                            </td>
                            <td className="py-3.5 px-4">
                              {(() => {
                                if (activeTab !== "pharmacy") {
                                  return (
                                    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold ${
                                      v.gpsVerified ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400"
                                    }`}>
                                      <MapPin size={12} />
                                      {toRenderableText("gpsStatus", v.gpsVerified ? (isRtl ? "متحقق" : "GPS Verified") : (isRtl ? "غير موثق" : "Unverified"), lang, v.id, "Table")}
                                    </span>
                                  );
                                }

                                const targetPharm = (pharmacies || []).find((p) => p.id === v.pharmacyId);
                                const gpsRes = resolvePharmacyGpsVerificationStatus({ visit: v, pharmacy: targetPharm });

                                if (gpsRes.verified) {
                                  const labelText =
                                    gpsRes.status === "FIRST_VISIT_CAPTURED"
                                      ? (isRtl ? "متحقق" : "GPS Verified")
                                      : gpsRes.status === "VERIFIED_PREVIOUSLY"
                                      ? (isRtl ? "متحقق سابقاً" : "Verified Previously")
                                      : (isRtl ? "إعادة توثيق" : "Reverified");

                                  return (
                                    <span
                                      title={gpsRes.latitude && gpsRes.longitude ? `GPS: ${gpsRes.latitude.toFixed(4)}, ${gpsRes.longitude.toFixed(4)} (${gpsRes.accuracyMeters || '—'}m)` : undefined}
                                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                                    >
                                      <MapPin size={11} className="text-emerald-600" />
                                      {labelText}
                                    </span>
                                  );
                                }

                                return (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-400">
                                    <MapPin size={11} />
                                    {isRtl ? "غير موثق" : "Unverified"}
                                  </span>
                                );
                              })()}
                            </td>
                            <td className="py-3.5 px-4 text-right">
                              <button
                                onClick={() => {
                                  setSelectedVisitForModal({ visit: v, type: activeTab });
                                }}
                                className="inline-flex items-center gap-1 px-2.5 py-1 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900 rounded-lg text-xs font-bold transition-all cursor-pointer"
                              >
                                <Eye size={13} />
                                <span>{isRtl ? "التفاصيل" : "View"}</span>
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Mobile Card List View */}
                <div className="block md:hidden divide-y divide-slate-100 dark:divide-slate-800">
                  {paginatedList.map((v: any, idx: number) => {
                    const status = v.normalizedStatus;
                    const dateStr = v.visitDate || v.date || (v.createdAt ? v.createdAt.substring(0, 10) : "");
                    const visitNo = getVisitBusinessNumber(v, (currentPage - 1) * pageSize + idx, activeTab === "pharmacy" ? "PV" : "MV");

                    return (
                      <div key={v.id} className="p-4 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-xs font-bold text-indigo-600 dark:text-indigo-400">
                            {toRenderableText("displayNumber", visitNo, lang, v.id, "MobileCard")}
                          </span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            status === "COMPLETED" 
                              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                              : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                          }`}>
                            {toRenderableText("status", status, lang, v.id, "MobileCard")}
                          </span>
                        </div>

                        <div>
                          <button
                            onClick={() => handleNavigateToCustomerProfile(activeTab === "pharmacy" ? v.pharmacyId : v.physicianId, activeTab)}
                            className="font-bold text-sm text-slate-900 dark:text-white hover:underline text-left cursor-pointer"
                          >
                            {toRenderableText(
                              "customerName",
                              activeTab === "pharmacy"
                                ? v.pharmacyName || v.pharmacySnapshot?.nameEn || v.pharmacySnapshot?.nameAr || v.pharmacyId
                                : v.physicianName || v.physicianId,
                              lang,
                              v.id,
                              "MobileCard"
                            )}
                          </button>
                          <div className="text-xs text-slate-500">
                            {toRenderableText(
                              "purposeOrSpecialty",
                              activeTab === "pharmacy"
                                ? v.visitPurpose || "Order Intake"
                                : v.physicianSpecialty || v.specialty || "General Practice",
                              lang,
                              v.id,
                              "MobileCard"
                            )}
                          </div>
                        </div>

                        <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
                          <span>Rep: {toRenderableText("repName", v.repName || v.createdBy || "Sales Rep", lang, v.id, "MobileCard")}</span>
                          <span className="font-mono">{toRenderableText("visitDate", dateStr, lang, v.id, "MobileCard")}</span>
                        </div>

                        <div className="pt-2 flex justify-end">
                          <button
                            onClick={() => setSelectedVisitForModal({ visit: v, type: activeTab })}
                            className="inline-flex items-center gap-1 px-3 py-1.5 bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 rounded-lg text-xs font-bold cursor-pointer"
                          >
                            <Eye size={14} />
                            <span>{isRtl ? "تفاصيل الزيارة" : "View Details"}</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Pagination Controls */}
                <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
                  <div>
                    {isRtl
                      ? `عرض ${(currentPage - 1) * pageSize + 1} - ${Math.min(currentPage * pageSize, currentFilteredList.length)} من إجمالي ${currentFilteredList.length} زيارة`
                      : `Showing ${(currentPage - 1) * pageSize + 1} to ${Math.min(currentPage * pageSize, currentFilteredList.length)} of ${currentFilteredList.length} visits`}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                      {currentPage} / {totalPages}
                    </span>
                    <button
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* Unified Visit Details Modal */}
      {selectedVisitForModal && (
        <UnifiedVisitDetailsModal
          visitData={selectedVisitForModal.visit}
          visitType={selectedVisitForModal.type}
          lang={lang}
          products={products}
          pharmacies={pharmacies}
          markets={marketSettings}
          onClose={() => setSelectedVisitForModal(null)}
          onNavigateToProfile={handleNavigateToCustomerProfile}
        />
      )}
    </div>
  );
}

// ----------------------------------------------------------------------
// Unified Visit Details Modal Component
// ----------------------------------------------------------------------
interface UnifiedVisitDetailsModalProps {
  visitData: any;
  visitType: "pharmacy" | "physician";
  lang: "en" | "ar";
  products: Product[];
  pharmacies: Pharmacy[];
  markets: MarketBusinessSettings[];
  onClose: () => void;
  onNavigateToProfile: (id: string, type: "pharmacy" | "physician") => void;
}

function UnifiedVisitDetailsModal({
  visitData,
  visitType,
  lang,
  products,
  pharmacies,
  markets,
  onClose,
  onNavigateToProfile
}: UnifiedVisitDetailsModalProps) {
  const isRtl = lang === "ar";
  const v = visitData || {};
  const money = (amount: number) => formatPharmacyVisitCurrency(amount,v,markets);

  const customerId = visitType === "pharmacy" ? v.pharmacyId : v.physicianId;
  const customerName = resolveDisplayLabel(
    visitType === "pharmacy" 
      ? (v.pharmacyName || v.pharmacySnapshot?.nameEn || v.pharmacySnapshot?.nameAr || "Pharmacy")
      : (v.physicianName || "Physician"),
    lang
  );

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto" id="unified-visit-modal-overlay">
      <div 
        className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-3xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden"
        dir={isRtl ? "rtl" : "ltr"}
      >
        {/* Modal Header */}
        <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-900/40">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-50 dark:bg-indigo-950 p-2 rounded-xl text-indigo-600 dark:text-indigo-400">
              {visitType === "pharmacy" ? <Building size={20} /> : <Stethoscope size={20} />}
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                {isRtl ? "تفاصيل ملخص الزيارة" : "Visit Details Report"}
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-300 font-mono font-bold mt-0.5">
                {isRtl ? "رقم الزيارة: " : "Visit No: "}
                {toRenderableText("displayNumber", getVisitBusinessNumber(v, undefined, visitType === "pharmacy" ? "PV" : "MV"), lang, v.id, "ModalHeader")}
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 rounded-lg border border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 transition-all cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-6 overflow-y-auto space-y-6 text-xs text-slate-700 dark:text-slate-300">
          
          {/* General Overview Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 dark:bg-slate-900/40 p-4 rounded-xl border border-slate-100 dark:border-slate-800">
            <div>
              <p className="text-[10px] text-slate-400 uppercase font-bold">
                {visitType === "pharmacy" ? (isRtl ? "الصيدلية" : "Pharmacy") : (isRtl ? "الطبيب" : "Physician")}
              </p>
              <div className="flex items-center justify-between mt-1">
                <span className="font-bold text-slate-900 dark:text-white text-sm">{toRenderableText("customerName", customerName, lang, v.id, "ModalOverview")}</span>
                {customerId && (
                  <button
                    onClick={() => onNavigateToProfile(customerId, visitType)}
                    className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                  >
                    {isRtl ? "عرض الملف" : "View Profile"}
                  </button>
                )}
              </div>
            </div>

            <div>
              <p className="text-[10px] text-slate-400 uppercase font-bold">{isRtl ? "المندوب" : "Representative"}</p>
              <p className="font-bold text-slate-900 dark:text-white mt-1">{toRenderableText("repName", v.repName || v.createdBy || "Sales Rep", lang, v.id, "ModalOverview")}</p>
            </div>

            <div>
              <p className="text-[10px] text-slate-400 uppercase font-bold">{isRtl ? "تاريخ ووقت الزيارة" : "Date & Time"}</p>
              <p className="font-mono text-slate-800 dark:text-slate-200 mt-1">
                {toRenderableText("visitDate", v.visitDate || v.date || v.createdAt || "Not Recorded", lang, v.id, "ModalOverview")}
              </p>
            </div>

            <div>
              <p className="text-[10px] text-slate-400 uppercase font-bold">{isRtl ? "الغرض من الزيارة" : "Visit Purpose"}</p>
              <p className="font-semibold text-slate-800 dark:text-slate-200 mt-1">
                {toRenderableText("visitPurpose", visitType === "pharmacy" ? (v.visitPurpose || "Order Intake") : (v.primaryPromotionGroup || v.visitPurpose || "Scientific Detailing"), lang, v.id, "ModalOverview")}
              </p>
            </div>
          </div>

          {/* GPS Information */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
              <MapPin size={14} className="text-indigo-500" />
              <span>{isRtl ? "معلومات الموقع الجغرافي (GPS)" : "GPS Verification Details"}</span>
            </h4>
            <div className="p-3 bg-slate-50 dark:bg-slate-900/30 rounded-xl border border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div>
                <p className="text-[11px] font-semibold">
                  {v.gpsVerified ? (isRtl ? "تم التحقق من الموقع الإحداثي" : "Verified Location Check-in") : (isRtl ? "موقع غير متحقق" : "Unverified GPS Coordinates")}
                </p>
                {v.latitude && v.longitude && (
                  <p className="text-[10px] font-mono text-slate-400">
                    Lat: {toRenderableText("latitude", v.latitude, lang, v.id, "ModalGPS")}, Long: {toRenderableText("longitude", v.longitude, lang, v.id, "ModalGPS")}
                  </p>
                )}
              </div>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${v.gpsVerified ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600"}`}>
                {v.gpsVerified ? "VERIFIED" : "UNVERIFIED"}
              </span>
            </div>
          </div>

          {/* Pharmacy Specific Order & Collection */}
          {visitType === "pharmacy" && (
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                <DollarSign size={14} className="text-emerald-500" />
                <span>{isRtl ? "تفاصيل الطلبية والتحصيل" : "Order & Payment Collections"}</span>
              </h4>

              <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 dark:bg-slate-900/30 rounded-xl border border-slate-100 dark:border-slate-800">
                <div>
                  <p className="text-[10px] text-slate-400">{isRtl ? "إجمالي قيمة الطلبية" : "Billed Amount"}</p>
                  <p className="font-extrabold text-sm text-slate-900 dark:text-white font-mono">
                    {money(Number(v.orderTotal ?? v.netAmount ?? v.totalAmount ?? 0))}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-400">{isRtl ? "المبلغ المحصل" : "Collected Amount"}</p>
                  <p className="font-extrabold text-sm text-emerald-600 dark:text-emerald-400 font-mono">
                    {money(Number(v.collectedAmount ?? v.paymentCollected ?? 0))}
                  </p>
                </div>
              </div>

              {v.items && v.items.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] text-slate-400 font-bold">{isRtl ? "بنود الطلبية" : "Order Items"}</p>
                  <div className="border border-slate-100 dark:border-slate-800 rounded-xl overflow-hidden">
                    {(v.items || []).map((item: any, idx: number) => (
                      <div key={idx} className="p-2 flex justify-between border-b last:border-0 border-slate-100 dark:border-slate-800 text-[11px]">
                        <span>{toRenderableText("productName", item.productName || item.brandName || item.brand || "Product SKU", lang, v.id, "ModalOrderItems")}</span>
                        <span className="font-mono">Qty: {toRenderableText("quantity", item.quantity || 0, lang, v.id, "ModalOrderItems")}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Physician Specific Detailing & Samples */}
          {visitType === "physician" && (
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                <Package size={14} className="text-indigo-500" />
                <span>{isRtl ? "التفاصيل الطبية والعينات" : "Product Detailing & Samples"}</span>
              </h4>

              {v.detailing && v.detailing.length > 0 ? (
                <div className="space-y-1">
                  <p className="text-[10px] text-slate-400 font-bold">{isRtl ? "المنتجات المناقشة" : "Products Discussed"}</p>
                  <div className="space-y-1.5">
                    {(v.detailing || []).map((d: any, idx: number) => (
                      <div key={idx} className="p-2.5 bg-slate-50 dark:bg-slate-900/30 rounded-xl border border-slate-100 dark:border-slate-800 text-[11px]">
                        <div className="flex justify-between font-bold">
                          <span>{toRenderableText("productName", resolveCanonicalVisitProductName(d, products), lang, v.id, "ModalDetailing")}</span>
                          <span className="text-indigo-600">{toRenderableText("reaction", d.reaction || "Positive", lang, v.id, "ModalDetailing")}</span>
                        </div>
                        {d.notes && <p className="text-[10px] text-slate-500 mt-1">{toRenderableText("notes", d.notes, lang, v.id, "ModalDetailing")}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-slate-400 italic text-[11px]">{isRtl ? "لم يتم تسجيل مناقشة تفصيلية" : "No detailed product discussions recorded."}</p>
              )}

              {v.samples && v.samples.length > 0 && (
                <div className="space-y-1 pt-2">
                  <p className="text-[10px] text-slate-400 font-bold">{isRtl ? "العينات الطبية الموزعة" : "Samples Disbursed"}</p>
                  <div className="flex flex-wrap gap-2">
                    {(v.samples || []).map((s: any, idx: number) => (
                      <span key={idx} className="px-2.5 py-1 bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 rounded-lg text-[10px] font-semibold">
                        {toRenderableText("quantity", s.quantity || 0, lang, v.id, "ModalSamples")}x {toRenderableText("productName", s.productName || s.brand, lang, v.id, "ModalSamples")}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* CRM Remarks & Notes */}
          <div className="space-y-1 pt-2">
            <p className="text-[10px] text-slate-400 font-bold">{isRtl ? "الملاحظات العامة" : "Visit Notes & Remarks"}</p>
            <div className="p-3 bg-slate-50 dark:bg-slate-900/30 rounded-xl border border-slate-100 dark:border-slate-800 text-[11px] leading-relaxed">
              {toRenderableText("intelNotes", v.intelNotes || v.crmNotes || v.generalNotes || v.finalRemarks || (isRtl ? "لا توجد ملاحظات مسجلة" : "No notes recorded."), lang, v.id, "ModalNotes")}
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex justify-end bg-slate-50/50 dark:bg-slate-900/40">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:bg-slate-300 rounded-xl text-xs font-bold cursor-pointer transition-all"
          >
            {isRtl ? "إغلاق" : "Close"}
          </button>
        </div>
      </div>
    </div>
  );
}
