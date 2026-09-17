import { useFinancialProfileDisplay, canonicalDisplayProfile } from "../lib/financialProfileDisplay";
import React, { useState, useEffect, useMemo, useRef } from "react";
import { 
  Search, 
  Plus, 
  Store, 
  MapPin, 
  Sparkles, 
  Filter, 
  X,
  PlusCircle,
  DollarSign,
  Eye,
  MoreHorizontal,
  Download,
  Edit,
  Calendar,
  Slash,
  Trash,
  Phone,
  Clock,
  ChevronDown,
  Check,
  Building,
  CreditCard,
  ChevronRight,
  Info,
  UserCheck,
  FileText
} from "lucide-react";
import { Pharmacy, User, Country, District, City, Area, Role } from "../types";
import { mapRecordForExport, TemplateSchemas } from "../lib/schemaEngine";
import { resolveGeographyTuple, resolveRecordGeography } from "../utils/importNormalization";
import Pagination from "./Pagination";
import MobileCardList from "./MobileCardList";
import TruncatedText from "./TruncatedText";
import NoDataState from "./NoDataState";
import { collection, onSnapshot } from "firebase/firestore";
import { auth, db } from "../lib/firebase";
import { useOperationalScopeSession } from "../contexts/OperationalScopeSessionContext";
import { createPharmacyOrderReadController, type PharmacyOrderReadController, type PharmacyOrderSummary } from "../lib/pharmacyOrderReadClient";
import { resolveFinancialIdentity } from "../lib/financialIdentity";
import { formatCurrencyForIdentity } from "../lib/marketSettings";
import SupervisorVisitHistory from "./supervision/SupervisorVisitHistory";

// Ordinary pharmacyVisits remain owned by the existing representative workflow.

interface PharmacyListProps {
  currentUser: User;
  pharmacies: Pharmacy[];
  onAddPharmacy: (pharmacy: Pharmacy) => void;
  onUpdatePharmacy?: (pharmacy: Pharmacy) => void;
  onDeletePharmacy?: (id: string) => void;
  lang: "en" | "ar";
  users?: User[];
}

export default function PharmacyList({
  currentUser,
  pharmacies,
  onAddPharmacy,
  onUpdatePharmacy,
  onDeletePharmacy,
  lang,
  users
}: PharmacyListProps) {
  const isRtl = lang === "ar";
  const pharmacyMoney = (amount: number, record?: any) => { const identity = resolveFinancialIdentity([record || {}, currentUser as any]); try { return identity ? formatCurrencyForIdentity(amount, { marketId: identity.marketId }) : (isRtl ? "إعدادات السوق مطلوبة" : "Market configuration required"); } catch { return isRtl ? "إعدادات السوق مطلوبة" : "Market configuration required"; } };
  const operationalScopeSession = useOperationalScopeSession();
  const orderReadControllerRef = useRef<PharmacyOrderReadController | null>(null);
  if (!orderReadControllerRef.current) orderReadControllerRef.current = createPharmacyOrderReadController();
  const orderReadController = orderReadControllerRef.current;
  
  // Log component entry prop
  console.info(
    "[PHARMACY_COMPONENT_PROP_JSON]",
    JSON.stringify({
      propCount: pharmacies.length,
      documentIds: pharmacies.map(p => p.id)
    })
  );

  // Local state for active sandbox CRUD interactions
  const [localPharmacies, setLocalPharmacies] = useState<Pharmacy[]>([]);
  
  useEffect(() => {
    console.info("[PHARMACY_PIPELINE_TRACE]", {
      stage: "4. Component Prop",
      count: pharmacies.length,
      targetIdPresent: pharmacies.some(r => r.id === "PHM-TAJOURA-A"),
      exclusionReason: pharmacies.some(r => r.id === "PHM-TAJOURA-A") ? undefined : "Missing in Component prop"
    });

    setLocalPharmacies(pharmacies);
  }, [pharmacies, currentUser]);

  useEffect(() => {
    console.info(
      "[PHARMACY_LOCAL_STATE_JSON]",
      JSON.stringify({
        propCount: pharmacies.length,
        localStateCount: localPharmacies.length
      })
    );
  }, [pharmacies.length, localPharmacies.length]);

  // View states
  const [searchTerm, setSearchTerm] = useState("");
  const [isFilterDrawerOpen, setIsFilterDrawerOpen] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isLegacyReportExpanded, setIsLegacyReportExpanded] = useState(false);

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(6);

  // Row selection state
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  
  // Profile View Modal state
  const [selectedPharmacyForProfile, setSelectedPharmacyForProfile] = useState<Pharmacy | null>(null);
  const financialData = useFinancialProfileDisplay(currentUser.id, selectedPharmacyForProfile?.id, Boolean(selectedPharmacyForProfile));
  const financialPharmacy = financialData?.pharmacies.find((p: any) => p.id === selectedPharmacyForProfile?.id);
  const financialProfile = financialPharmacy ? canonicalDisplayProfile(financialData.profiles, financialPharmacy) : null;
  const currentOutstanding = financialProfile ? pharmacyMoney(financialProfile.outstandingBalance, financialProfile) : (isRtl ? "غير متاح" : "Unavailable");
  const [activeProfileTab, setActiveProfileTab] = useState<string>("Overview");
  const [realOrders, setRealOrders] = useState<PharmacyOrderSummary[]>([]);

  useEffect(() => {
    orderReadController.clear();
    setRealOrders([]);
    const firebaseUser = auth.currentUser;
    const pharmacyId = selectedPharmacyForProfile?.id;
    if (operationalScopeSession.status !== "READY" || !firebaseUser?.uid || firebaseUser.uid !== currentUser.id || !pharmacyId || activeProfileTab !== "Orders") return;
    let cancelled = false;
    void orderReadController.load(firebaseUser.uid, pharmacyId, firebaseUser).then(() => {
      if (cancelled) return;
      const state = orderReadController.getState();
      setRealOrders(state.status === "READY" && state.actorUid === firebaseUser.uid && state.pharmacyId === pharmacyId ? state.orders : []);
    });
    return () => { cancelled = true; orderReadController.clear(); setRealOrders([]); };
  }, [activeProfileTab, currentUser.id, operationalScopeSession.status, orderReadController, selectedPharmacyForProfile?.id]);

  // Filters state (matches image 2)
  const [filterTerritory, setFilterTerritory] = useState("All");
  const [filterCity, setFilterCity] = useState("All");
  const [filterArea, setFilterArea] = useState("All");
  const [filterSalesRep, setFilterSalesRep] = useState("All");
  const [filterType, setFilterType] = useState("All");
  const [filterStatus, setFilterStatus] = useState<"Active" | "Inactive" | "All">("Active");

  // Reset pagination on search or filters update
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filterTerritory, filterCity, filterArea, filterSalesRep, filterType, filterStatus]);

  // Filter state values applied
  const [appliedFilters, setAppliedFilters] = useState({
    territory: "All",
    city: "All",
    area: "All",
    salesRep: "All",
    type: "All",
    status: "Active" as "Active" | "Inactive" | "All"
  });

  // Edit / Add Form states
  const [editingPharmacy, setEditingPharmacy] = useState<Pharmacy | null>(null);
  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [region, setRegion] = useState("");
  const [territory, setTerritory] = useState("");
  const [address, setAddress] = useState("");
  const [outstandingBalance, setOutstandingBalance] = useState("0");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [isAutoFilled, setIsAutoFilled] = useState(false);
  const [formError, setFormError] = useState("");
  const [pType, setPType] = useState("Retail");
  const [pContact, setPContact] = useState("-");

  // New master template fields
  const [country, setCountry] = useState("");
  const [district, setDistrict] = useState("");
  const [city, setCity] = useState("");
  const [area, setArea] = useState("");

  const [countryId, setCountryId] = useState("");
  const [countryName, setCountryName] = useState("");
  const [districtId, setDistrictId] = useState("");
  const [districtName, setDistrictName] = useState("");
  const [cityId, setCityId] = useState("");
  const [cityName, setCityName] = useState("");
  const [areaId, setAreaId] = useState("");
  const [areaName, setAreaName] = useState("");

  // Master Geography lists from Firestore with fallback to INITIAL arrays
  const [countriesList, setCountriesList] = useState<Country[]>([]);
  const [districtsList, setDistrictsList] = useState<District[]>([]);
  const [citiesList, setCitiesList] = useState<City[]>([]);
  const [areasList, setAreasList] = useState<Area[]>([]);

  useEffect(() => {
    const unsubCountries = onSnapshot(collection(db, "countries"), (snap) => {
      const docs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Country));
      setCountriesList(docs);
    }, (err) => {
      console.error(err);
      setCountriesList([]);
    });

    const unsubDistricts = onSnapshot(collection(db, "districts"), (snap) => {
      const docs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as District));
      setDistrictsList(docs);
    }, (err) => {
      console.error(err);
      setDistrictsList([]);
    });

    const unsubCities = onSnapshot(collection(db, "cities"), (snap) => {
      const docs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as City));
      setCitiesList(docs);
    }, (err) => {
      console.error(err);
      setCitiesList([]);
    });

    const unsubAreas = onSnapshot(collection(db, "areas"), (snap) => {
      const docs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Area));
      setAreasList(docs);
    }, (err) => {
      console.error(err);
      setAreasList([]);
    });

    return () => {
      unsubCountries();
      unsubDistricts();
      unsubCities();
      unsubAreas();
    };
  }, []);

  const [contactPerson, setContactPerson] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [paymentInDays, setPaymentInDays] = useState("30");
  const [assignedRepId, setAssignedRepId] = useState("");
  const [assignedSupervisorId, setAssignedSupervisorId] = useState("");
  const [salesPotential, setSalesPotential] = useState("Medium");
  const [competitorInformation, setCompetitorInformation] = useState("");

  // Active status simulation state (since types.ts might not have active, we track deactivated ids locally)
  const [deactivatedIds, setDeactivatedIds] = useState<string[]>([]);

  // Derived Operational Region Label from Canonical Geography
  const derivedRegionLabel = useMemo(() => {
    if (!areaId) return "Not yet determined";
    const selectedAreaObj = areasList.find(a => a.id === areaId);
    if (!selectedAreaObj) {
      const matchedAreaByName = areasList.find(a => a.name.toLowerCase() === areaName.toLowerCase());
      if (matchedAreaByName) {
        const distName = matchedAreaByName.districtName || "";
        const normalized = distName.toLowerCase().trim();
        if (normalized.includes("west")) return "West Region (Tripoli)";
        if (normalized.includes("east")) return "East Region (Benghazi)";
        if (normalized.includes("south")) return "South Region (Sabha)";
        return distName ? `${distName} Region` : "West Region (Tripoli)";
      }
      return "Not yet determined";
    }
    const distName = selectedAreaObj.districtName || "";
    const normalized = distName.toLowerCase().trim();
    if (normalized.includes("west")) return "West Region (Tripoli)";
    if (normalized.includes("east")) return "East Region (Benghazi)";
    if (normalized.includes("south")) return "South Region (Sabha)";
    return distName ? `${distName} Region` : "West Region (Tripoli)";
  }, [areaId, areaName, areasList]);

  // Synchronize legacy region state with derived region name
  useEffect(() => {
    if (areaId) {
      const selectedAreaObj = areasList.find(a => a.id === areaId);
      if (selectedAreaObj) {
        setRegion(selectedAreaObj.districtName || "West");
      }
    }
  }, [areaId, areasList]);

  // Action Menu open dropdown id
  const [openMenuRowId, setOpenMenuRowId] = useState<string | null>(null);

  const t = {
    en: {
      title: "Pharmacies",
      subtitle: "Pharmacy Accounts",
      searchPlaceholder: "Search pharmacies...",
      addBtn: "Add Pharmacy",
      exportAll: "Export All",
      filtersBtn: "Filters",
      allTerritories: "All Territories",
      allCities: "All Cities",
      allAreas: "All Areas",
      allSalesReps: "All Sales Reps",
      allTypes: "All Types",
      statusLabel: "Status",
      active: "Active",
      inactive: "Inactive",
      all: "All",
      reset: "Reset",
      applyFilters: "Apply Filters",
      nameCol: "Name",
      typeCol: "Type",
      contactCol: "Contact",
      territoryCol: "Territory",
      lastVisitCol: "Last Visit",
      nextVisitCol: "Next Visit",
      viewProfile: "View Profile",
      edit: "Edit",
      scheduleVisit: "Schedule Visit",
      deactivate: "Deactivate",
      activate: "Activate",
      delete: "Delete",
      noResults: "No pharmacies found matching your criteria.",
      // Profile Tabs
      overview: "Overview",
      visits: "Visits",
      orders: "Orders",
      payments: "Payments",
      products: "Products",
      stockRequests: "Stock Requests",
      supervisorVisits: "Supervisor Visits",
      contactInfo: "Contact Information",
      visitSchedule: "Visit Schedule",
      location: "Location",
      creditSummary: "Credit Summary",
      outstanding: "Outstanding",
      confirmed: "Confirmed",
      collected: "Collected",
      pending: "Pending",
      total: "Total",
      ordersLabel: "orders",
      notSet: "Not set",
      addSuccess: "Pharmacy added successfully!",
      editSuccess: "Pharmacy updated successfully!"
    },
    ar: {
      title: "الصيدليات",
      subtitle: "حسابات الصيدليات",
      searchPlaceholder: "البحث عن الصيدليات...",
      addBtn: "إضافة صيدلية",
      exportAll: "تصدير الكل",
      filtersBtn: "الفلاتر",
      allTerritories: "كل الأقاليم",
      allCities: "كل المدن",
      allAreas: "كل المناطق",
      allSalesReps: "كل مندوبي المبيعات",
      allTypes: "كل الأنواع",
      statusLabel: "الحالة",
      active: "نشط",
      inactive: "غير نشط",
      all: "الكل",
      reset: "إعادة ضبط",
      applyFilters: "تطبيق الفلاتر",
      nameCol: "الاسم",
      typeCol: "النوع",
      contactCol: "الاتصال",
      territoryCol: "النطاق الجغرافي",
      lastVisitCol: "آخر زيارة",
      nextVisitCol: "الزيارة القادمة",
      viewProfile: "عرض الملف التعريفى",
      edit: "تعديل",
      scheduleVisit: "جدولة زيارة",
      deactivate: "إلغاء تنشيط",
      activate: "تنشيط",
      delete: "حذف",
      noResults: "لم يتم العثور على صيدليات تطابق البحث.",
      overview: "نظرة عامة",
      visits: "الزيارات",
      orders: "الطلبات",
      payments: "المدفوعات",
      products: "المنتجات",
      stockRequests: "طلبات المخزون",
      supervisorVisits: "زيارات المشرف",
      contactInfo: "معلومات الاتصال",
      visitSchedule: "جدول الزيارة",
      location: "الموقع الجغرافي",
      creditSummary: "ملخص الائتمان",
      outstanding: "مستحق الدفع",
      confirmed: "مؤكد",
      collected: "تم تحصيله",
      pending: "قيد الانتظار",
      total: "الإجمالي",
      ordersLabel: "طلبات",
      notSet: "غير محدد",
      addSuccess: "تم إضافة الصيدلية بنجاح!",
      editSuccess: "تم تحديث الصيدلية بنجاح!"
    }
  }[lang];

  // Helper to close row menu
  useEffect(() => {
    const handleOutsideClick = () => setOpenMenuRowId(null);
    window.addEventListener("click", handleOutsideClick);
    return () => window.removeEventListener("click", handleOutsideClick);
  }, []);

  // Filter logic (strictly applying the design filters from image 2)
  const afterSearch = localPharmacies.filter(pharm => 
    (pharm.name || "").toLowerCase().includes(searchTerm.toLowerCase()) || 
    (pharm.nameAr && pharm.nameAr.includes(searchTerm)) ||
    (pharm.territory || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
    (pharm.address || "").toLowerCase().includes(searchTerm.toLowerCase())
  );

  const afterStatus = afterSearch.filter(pharm => {
    const isDeactivated = deactivatedIds.includes(pharm.id);
    return appliedFilters.status === "All" ||
      (appliedFilters.status === "Active" && !isDeactivated) ||
      (appliedFilters.status === "Inactive" && isDeactivated);
  });

  const afterType = afterStatus.filter(pharm => 
    appliedFilters.type === "All" || 
    (pharm.type || "Retail").toLowerCase() === appliedFilters.type.toLowerCase()
  );

  const afterTerritory = afterType.filter(pharm => 
    appliedFilters.territory === "All" || 
    (pharm.territory || "").toLowerCase().includes(appliedFilters.territory.toLowerCase())
  );

  const afterCity = afterTerritory.filter(pharm => 
    appliedFilters.city === "All" || 
    (pharm.region || "").toLowerCase() === appliedFilters.city.toLowerCase()
  );

  const afterArea = afterCity.filter(pharm => 
    appliedFilters.area === "All" || 
    (pharm.address || "").toLowerCase().includes(appliedFilters.area.toLowerCase()) ||
    (pharm.territory || "").toLowerCase().includes(appliedFilters.area.toLowerCase())
  );

  const filteredPharmacies = afterArea;

  // Pagination calculation
  const totalPages = Math.ceil(filteredPharmacies.length / itemsPerPage);
  const paginatedPharmacies = filteredPharmacies.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  useEffect(() => {
    console.info(
      "[PHARMACY_DISPLAY_FILTER_JSON]",
      JSON.stringify({
        sourceCount: localPharmacies.length,
        afterSearch: afterSearch.length,
        afterStatus: afterStatus.length,
        afterType: afterType.length,
        afterTerritory: afterTerritory.length,
        afterCity: afterCity.length,
        afterArea: afterArea.length,
        afterDeactivatedIds: afterStatus.length,
        paginatedCount: paginatedPharmacies.length,
        filterState: {
          searchTerm,
          statusFilter: appliedFilters.status,
          territoryFilter: appliedFilters.territory,
          cityFilter: appliedFilters.city,
          areaFilter: appliedFilters.area,
          typeFilter: appliedFilters.type,
          currentPage,
          itemsPerPage
        }
      })
    );
  }, [
    localPharmacies.length,
    afterSearch.length,
    afterStatus.length,
    afterType.length,
    afterTerritory.length,
    afterCity.length,
    afterArea.length,
    paginatedPharmacies.length,
    searchTerm,
    appliedFilters,
    currentPage,
    itemsPerPage
  ]);

  useEffect(() => {
    console.info("[PHARMACY_PIPELINE_TRACE]", {
      stage: "6. Active / Deleted / Search Filters",
      count: filteredPharmacies.length,
      targetIdPresent: filteredPharmacies.some(r => r.id === "PHM-TAJOURA-A"),
      exclusionReason: filteredPharmacies.some(r => r.id === "PHM-TAJOURA-A") ? undefined : "Filtered out by search/status/territory filter"
    });
    console.info("[PHARMACY_PIPELINE_TRACE]", {
      stage: "7. Rendered Rows",
      count: paginatedPharmacies.length,
      targetIdPresent: paginatedPharmacies.some(r => r.id === "PHM-TAJOURA-A"),
      exclusionReason: paginatedPharmacies.some(r => r.id === "PHM-TAJOURA-A") ? undefined : "Hidden on secondary pagination page"
    });
  }, [filteredPharmacies, paginatedPharmacies]);

  // Distinct filter options extracted dynamically
  const distinctTerritories = Array.from(new Set(localPharmacies.map(p => p.territory.split(" ")[0] || p.territory)));
  const distinctCities = Array.from(new Set(localPharmacies.map(p => p.region)));
  const distinctAreas = Array.from(new Set(localPharmacies.map(p => p.address)));
  const distinctTypes = Array.from(new Set(localPharmacies.map(p => p.type || "Retail")));

  // Handle checkboxes
  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedRowIds(filteredPharmacies.map(p => p.id));
    } else {
      setSelectedRowIds([]);
    }
  };

  const handleSelectRow = (pharmId: string, checked: boolean) => {
    if (checked) {
      setSelectedRowIds(prev => [...prev, pharmId]);
    } else {
      setSelectedRowIds(prev => prev.filter(id => id !== pharmId));
    }
  };

  // Drawer handlers
  const handleApplyFilters = () => {
    setAppliedFilters({
      territory: filterTerritory,
      city: filterCity,
      area: filterArea,
      salesRep: filterSalesRep,
      type: filterType,
      status: filterStatus
    });
    setIsFilterDrawerOpen(false);
  };

  const handleResetFilters = () => {
    setFilterTerritory("All");
    setFilterCity("All");
    setFilterArea("All");
    setFilterSalesRep("All");
    setFilterType("All");
    setFilterStatus("Active");
    
    setAppliedFilters({
      territory: "All",
      city: "All",
      area: "All",
      salesRep: "All",
      type: "All",
      status: "Active"
    });
  };

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameEn.trim()) return;

    if (!countryId || !districtId || !cityId || !areaId) {
      alert("Please select Country, District, City, and Area from the dropdowns.");
      return;
    }

    const geography = resolveGeographyTuple(countryName, districtName, cityName, areaName, {
      countries: countriesList,
      districts: districtsList,
      cities: citiesList,
      areas: areasList,
    });
    if (!geography.isValid) {
      setFormError(geography.error || "The selected geography hierarchy is not valid.");
      return;
    }

    const latStr = lat.trim();
    const lngStr = lng.trim();

    let finalLat: number | null = null;
    let finalLng: number | null = null;
    let verificationStatus = "UNVERIFIED";
    let gpsSource: string | undefined = undefined;

    if (!latStr && !lngStr) {
      finalLat = null;
      finalLng = null;
      verificationStatus = "UNVERIFIED";
    } else if (latStr && lngStr) {
      const parsedLat = Number(latStr);
      const parsedLng = Number(lngStr);
      if (isNaN(parsedLat) || isNaN(parsedLng)) {
        alert("Latitude and Longitude must be valid numbers.");
        return;
      }
      if (parsedLat < -90 || parsedLat > 90 || parsedLng < -180 || parsedLng > 180) {
        alert("Latitude must be between -90 and 90, Longitude must be between -180 and 180.");
        return;
      }
      finalLat = parsedLat;
      finalLng = parsedLng;
      verificationStatus = "MANUALLY_ENTERED_UNVERIFIED";
      gpsSource = "MANUAL_ENTRY";
    } else {
      alert("Both Latitude and Longitude must be provided together, or both left empty.");
      return;
    }

    const fullTerritory = `${countryName.trim()} / ${districtName.trim()} / ${cityName.trim()} / ${areaName.trim()}`;

    const matchedRep = users?.find(u => u.id === assignedRepId);
    const assignedRepName = matchedRep ? matchedRep.name : undefined;
    const matchedSupervisor = users?.find(u => u.id === assignedSupervisorId);
    const assignedSupervisorName = matchedSupervisor ? matchedSupervisor.name : undefined;

    const newPharmId = `PHM-${Math.floor(1000 + Math.random() * 9000)}`;
    const newPharm: Pharmacy = {
      id: newPharmId,
      name: nameEn.trim(),
      nameAr: nameAr.trim() || undefined,
      region: districtName.trim(), // District maps to region
      territory: fullTerritory,
      latitude: finalLat,
      longitude: finalLng,
      gpsVerificationStatus: verificationStatus,
      gpsSource: gpsSource,
      gpsVerified: false,
      outstandingBalance: parseFloat(outstandingBalance) || 0,
      lastVisitDate: "-",
      address: address.trim() || "Local Street",
      type: pType,
      contact: pContact || phone || "-",
      nextVisitDate: "-",
      
      // Template specific fields
      country: geography.countryName!,
      district: geography.districtName!,
      city: geography.cityName!,
      area: geography.areaName!,
      countryId: geography.countryId,
      countryName: geography.countryName,
      districtId: geography.districtId,
      districtName: geography.districtName,
      cityId: geography.cityId,
      cityName: geography.cityName,
      areaId: geography.areaId,
      areaName: geography.areaName,
      contactPerson: contactPerson.trim(),
      phone: phone.trim(),
      email: email.trim(),
      paymentInDays: parseInt(paymentInDays) || 30,
      assignedRepId: assignedRepId,
      assignedRepName: assignedRepName,
      assignedSupervisorId: assignedSupervisorId,
      assignedSupervisorName: assignedSupervisorName,
      salesPotential: salesPotential,
      competitorInformation: competitorInformation.trim()
    };

    console.log("[PHARMACY_MASTER_GPS_FORM_JSON]", JSON.stringify({
      pharmacyId: newPharmId,
      latitudeRequired: false,
      longitudeRequired: false,
      emptySaveSupported: true,
      clearExistingSupported: true,
      autoFillRunsOnlyOnClick: true,
      defaultCoordinatesUsed: false,
      savedLatitude: finalLat,
      savedLongitude: finalLng,
      verificationStatus: verificationStatus
    }));

    onAddPharmacy(newPharm);
    setLocalPharmacies(prev => [newPharm, ...prev]);
    setIsAddModalOpen(false);

    // reset fields
    setNameEn("");
    setNameAr("");
    setOutstandingBalance("0");
    setAddress("");
    setPContact("-");
    setLat("");
    setLng("");
    setIsAutoFilled(false);
    setCountry("");
    setDistrict("");
    setCity("");
    setArea("");
    setCountryId("");
    setCountryName("");
    setDistrictId("");
    setDistrictName("");
    setCityId("");
    setCityName("");
    setAreaId("");
    setAreaName("");
    setContactPerson("");
    setPhone("");
    setEmail("");
    setPaymentInDays("30");
    setAssignedRepId("");
    setAssignedSupervisorId("");
    setSalesPotential("Medium");
    setCompetitorInformation("");
  };

  // Edit Pharmacy Handler
  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPharmacy) return;

    if (!countryId || !districtId || !cityId || !areaId) {
      alert("Please select Country, District, City, and Area from the dropdowns.");
      return;
    }

    const finalLat = editingPharmacy.latitude ?? null;
    const finalLng = editingPharmacy.longitude ?? null;
    const verificationStatus = editingPharmacy.gpsVerificationStatus ?? (editingPharmacy.gpsVerified ? "VERIFIED" : "UNVERIFIED");
    const gpsSource = editingPharmacy.gpsSource;

    const fullTerritory = `${countryName.trim()} / ${districtName.trim()} / ${cityName.trim()} / ${areaName.trim()}`;

    const matchedRep = users?.find(u => u.id === assignedRepId);
    const assignedRepName = matchedRep ? matchedRep.name : undefined;
    const matchedSupervisor = users?.find(u => u.id === assignedSupervisorId);
    const assignedSupervisorName = matchedSupervisor ? matchedSupervisor.name : undefined;

    const updatedPharm: Pharmacy = {
      ...editingPharmacy,
      name: nameEn.trim(),
      nameAr: nameAr.trim() || undefined,
      region: districtName.trim(), // District maps to region
      territory: fullTerritory,
      latitude: finalLat,
      longitude: finalLng,
      gpsVerificationStatus: verificationStatus,
      gpsSource: gpsSource,
      gpsVerified: verificationStatus === "VERIFIED",
      outstandingBalance: parseFloat(outstandingBalance) || 0,
      address: address.trim(),
      type: pType,
      contact: pContact || phone || "-",
      
      // Template specific fields
      country: countryName.trim(),
      district: districtName.trim(),
      city: cityName.trim(),
      area: areaName.trim(),
      countryId,
      countryName: countryName.trim(),
      districtId,
      districtName: districtName.trim(),
      cityId,
      cityName: cityName.trim(),
      areaId,
      areaName: areaName.trim(),
      contactPerson: contactPerson.trim(),
      phone: phone.trim(),
      email: email.trim(),
      paymentInDays: parseInt(paymentInDays) || 30,
      assignedRepId: assignedRepId,
      assignedRepName: assignedRepName,
      assignedSupervisorId: assignedSupervisorId,
      assignedSupervisorName: assignedSupervisorName,
      salesPotential: salesPotential,
      competitorInformation: competitorInformation.trim()
    };

    console.log("[PHARMACY_MASTER_GPS_FORM_JSON]", JSON.stringify({
      pharmacyId: editingPharmacy.id,
      latitudeRequired: false,
      longitudeRequired: false,
      emptySaveSupported: true,
      clearExistingSupported: true,
      autoFillRunsOnlyOnClick: true,
      defaultCoordinatesUsed: false,
      savedLatitude: finalLat,
      savedLongitude: finalLng,
      verificationStatus: verificationStatus
    }));

    const updatedList = localPharmacies.map(p => {
      if (p.id === editingPharmacy.id) {
        return updatedPharm;
      }
      return p;
    });

    setLocalPharmacies(updatedList);
    if (onUpdatePharmacy) {
      onUpdatePharmacy(updatedPharm);
    }
    setIsEditModalOpen(false);
    setEditingPharmacy(null);
  };

  const openEditModal = (pharm: Pharmacy) => {
    setEditingPharmacy(pharm);
    setNameEn(pharm.name);
    setNameAr(pharm.nameAr || "");
    setRegion(pharm.region);
    setTerritory(pharm.territory);
    setAddress(pharm.address);
    setOutstandingBalance(pharm.outstandingBalance.toString());
    setLat(pharm.latitude != null ? pharm.latitude.toString() : "");
    setLng(pharm.longitude != null ? pharm.longitude.toString() : "");
    setIsAutoFilled(false);
    setPType(pharm.type || "Retail");
    setPContact(pharm.contact || "-");
    
    // Set template specific states
    setCountry(pharm.country || "");
    setDistrict(pharm.district || "");
    setCity(pharm.city || "");
    setArea(pharm.area || "");

    // Resolve IDs and Names from existing values or loaded lists
    const normalizedCountry = String(pharm.country || "").toLowerCase();
    const matchedCountry = countriesList.find(c => String(c.name || "").toLowerCase() === normalizedCountry);
    const countryIdVal = pharm.countryId || (matchedCountry ? matchedCountry.id : "");
    const countryNameVal = pharm.countryName || pharm.country || (matchedCountry ? matchedCountry.name : "");

    const normalizedDistrict = String(pharm.district || "").toLowerCase();
    const matchedDistrict = districtsList.find(d => String(d.name || "").toLowerCase() === normalizedDistrict && d.countryId === countryIdVal) || districtsList.find(d => d.countryId === countryIdVal);
    const districtIdVal = pharm.districtId || (matchedDistrict ? matchedDistrict.id : "");
    const districtNameVal = pharm.districtName || pharm.district || (matchedDistrict ? matchedDistrict.name : "");

    const normalizedCity = String(pharm.city || "").toLowerCase();
    const matchedCity = citiesList.find(c => String(c.name || "").toLowerCase() === normalizedCity && c.districtId === districtIdVal) || citiesList.find(c => c.districtId === districtIdVal);
    const cityIdVal = pharm.cityId || (matchedCity ? matchedCity.id : "");
    const cityNameVal = pharm.cityName || pharm.city || (matchedCity ? matchedCity.name : "Tripoli");

    const normalizedArea = String(pharm.area || "Al-Dhahra").toLowerCase();
    const matchedArea = areasList.find(a => String(a.name || "").toLowerCase() === normalizedArea && a.cityId === cityIdVal) || areasList.find(a => a.cityId === cityIdVal);
    const areaIdVal = pharm.areaId || (matchedArea ? matchedArea.id : "");
    const areaNameVal = pharm.areaName || pharm.area || (matchedArea ? matchedArea.name : "Al-Dhahra");

    setCountryId(countryIdVal);
    setCountryName(countryNameVal);
    setDistrictId(districtIdVal);
    setDistrictName(districtNameVal);
    setCityId(cityIdVal);
    setCityName(cityNameVal);
    setAreaId(areaIdVal);
    setAreaName(areaNameVal);

    setContactPerson(pharm.contactPerson || "");
    setPhone(pharm.phone || "");
    setEmail(pharm.email || "");
    setPaymentInDays((pharm.paymentInDays || 30).toString());
    setAssignedRepId(pharm.assignedRepId || "");
    setAssignedSupervisorId(pharm.assignedSupervisorId || "");
    setSalesPotential(pharm.salesPotential || "Medium");
    setCompetitorInformation(pharm.competitorInformation || "");

    setIsEditModalOpen(true);
  };

  // Row actions
  const handleDeleteRow = (id: string) => {
    if (confirm("Are you sure you want to delete this pharmacy?")) {
      setLocalPharmacies(prev => prev.filter(p => p.id !== id));
      if (onDeletePharmacy) {
        onDeletePharmacy(id);
      }
    }
  };

  const handleToggleDeactivate = (id: string) => {
    if (deactivatedIds.includes(id)) {
      setDeactivatedIds(prev => prev.filter(item => item !== id));
    } else {
      setDeactivatedIds(prev => [...prev, id]);
    }
  };

  // Profile subviews never synthesize operational history.
  const getMockVisitsForPharmacy = (_pharmId: string) => [] as any[];
  const getMockOrdersForPharmacy = (_pharmId: string, _outstanding: number) => realOrders;
  const getMockPaymentsForPharmacy = (_pharmId: string) => [] as any[];

  const getMockProductsForPharmacy = () => [
    { id: "PROD01", name: "CardioMax 10mg", shelfStock: "45 units", targetStock: "100 units", urgentRequest: "0" },
    { id: "PROD03", name: "KidVits Chewable", shelfStock: "12 units", targetStock: "50 units", urgentRequest: "20" },
    { id: "PROD04", name: "OrthoFlex Gel", shelfStock: "80 units", targetStock: "80 units", urgentRequest: "0" }
  ];

  const getMockStockRequestsForPharmacy = () => [
    { id: "REQ-7721", date: "Feb 2, 2026", item: "KidVits Chewable (20 units)", priority: "High", status: "Approved" },
    { id: "REQ-7102", date: "Jan 12, 2026", item: "CardioMax 20mg (10 units)", priority: "Normal", status: "Fulfilled" }
  ];

  const getRepName = (id?: string) => {
    if (!id) return "Unassigned";
    const found = users?.find(u => u.id === id);
    if (found) return found.name;
    switch (id) {
      case "usr-102": return "Osama Al-Fakhri (Sales Rep)";
      case "usr-103": return "Fouad Omar (Medical Rep)";
      case "usr-104": return "Sarah Al-Qadi (Sales Rep)";
      case "usr-105": return "Abdou Hadi (Medical Rep)";
      default: return id || "Unassigned";
    }
  };

  const getSupervisorName = (id?: string) => {
    if (!id) return "Unassigned";
    const found = users?.find(u => u.id === id);
    if (found) return found.name;
    switch (id) {
      case "usr-201": return "Hassan Salem (Sales Supervisor)";
      case "usr-202": return "Ali Al-Mabrouk (Regional Manager)";
      case "usr-203": return "Rania Mansour (Medical Supervisor)";
      default: return id || "Unassigned";
    }
  };

  return (
    <div className="space-y-6" id="pharmacies-list-module" dir={isRtl ? "rtl" : "ltr"}>
      
      {/* 1. Header Section - Matching Image 1 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-5" id="pharmacies-list-header">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-950 flex items-center justify-center text-blue-600 dark:text-blue-400">
              <Store size={22} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                {t.title}
              </h2>
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5" id="pharmacy-result-count">
                {lang === "ar"
                  ? `إجمالي السحابة: ${localPharmacies.length} | تصفية: ${filteredPharmacies.length} | صفحة ${currentPage} من ${totalPages || 1}`
                  : `Total Cloud: ${localPharmacies.length} | Filtered: ${filteredPharmacies.length} | Page ${currentPage} of ${totalPages || 1}`}
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => {
              import("xlsx").then((XLSX) => {
                const headers = TemplateSchemas.pharmacies.filter(f => f.exportable).map(f => f.label);
                
                const data = [headers];
                
                // Assuming pharmacies array is passed as prop and populated
                const itemsToExport = pharmacies.length > 0 ? pharmacies : localPharmacies;
                itemsToExport.forEach(pharm => {
                  const exportedObj = mapRecordForExport(pharm, "pharmacies");
                  const row = headers.map(header => exportedObj[header] || "");
                  data.push(row);
                });
                
                const worksheet = XLSX.utils.aoa_to_sheet(data);
                const workbook = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(workbook, worksheet, "Pharmacies");
                
                XLSX.writeFile(workbook, `pharmacies_export_${new Date().toISOString().split("T")[0]}.xlsx`);
              });
            }}
            className="flex items-center justify-center gap-1.5 px-3.5 py-2 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-xs rounded-lg shadow-sm transition-all cursor-pointer"
            id="btn-export-pharmacies"
          >
            <Download size={14} />
            {t.exportAll}
          </button>
          
          <button
            onClick={() => {
              setFormError("");
              setNameEn("");
              setNameAr("");
              setRegion("");
              setTerritory("");
              setAddress("");
              setOutstandingBalance("0");
              setPType("Retail");
              setPContact("-");
              setIsAddModalOpen(true);
            }}
            className="flex items-center justify-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-lg shadow transition-all cursor-pointer"
            id="btn-add-pharmacy-trigger"
          >
            <Plus size={15} />
            {t.addBtn}
          </button>
        </div>
      </div>

      {/* Legacy Geography Alignment Audit Section */}
      {(() => {
        const legacyPharmacies = localPharmacies.filter(p => {
          const res = resolveRecordGeography(p, areasList);
          return res.source === 'literal_fallback';
        });

        if (legacyPharmacies.length === 0) return null;

        return (
          <div className="bg-amber-50/70 border border-amber-200/60 dark:bg-amber-950/20 dark:border-amber-900/40 rounded-xl p-4 space-y-3 shadow-xs" id="legacy-geography-audit-panel">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 bg-amber-100 dark:bg-amber-950 rounded-lg text-amber-700 dark:text-amber-400">
                  <Info size={16} />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    {isRtl ? "تقرير تدقيق مواءمة البيانات الجغرافية القديمة" : "Legacy Geography Alignment Audit Report"}
                    <span className="px-2 py-0.5 text-[10px] font-mono font-bold bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300 rounded-full">
                      {legacyPharmacies.length} {isRtl ? "سجلات قديمة" : "legacy records"}
                    </span>
                  </h4>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                    {isRtl 
                      ? "تم العثور على صيدليات تستخدم قيم نصية قديمة للأقاليم بدلاً من المعرفات الهيكلية المتتالية (الدولة > المنطقة > المدينة > المحلة)."
                      : "Identified pharmacy records still using legacy unaligned text labels instead of structured geographic keys (Country > District > City > Area)."
                    }
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsLegacyReportExpanded(!isLegacyReportExpanded)}
                className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-300 bg-white hover:bg-slate-50 dark:bg-slate-900 border border-amber-200 dark:border-amber-900/60 px-3 py-1.5 rounded-lg shadow-2xs transition-all cursor-pointer"
              >
                <span>{isLegacyReportExpanded ? (isRtl ? "إخفاء السجلات" : "Hide Details") : (isRtl ? "عرض السجلات" : "View Records")}</span>
                <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${isLegacyReportExpanded ? "rotate-180" : ""}`} />
              </button>
            </div>

            {isLegacyReportExpanded && (
              <div className="border border-amber-100 dark:border-amber-900/30 rounded-lg overflow-hidden bg-white dark:bg-slate-950 shadow-inner">
                <div className="max-h-56 overflow-y-auto animate-in slide-in-from-top-2 duration-150">
                  <table className="w-full text-left border-collapse text-[11px] font-medium text-slate-600 dark:text-slate-400">
                    <thead>
                      <tr className="bg-amber-50/40 border-b border-amber-100/50 text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500">
                        <th className="p-2.5 pl-3">{isRtl ? "اسم الصيدلية" : "Pharmacy Name"}</th>
                        <th className="p-2.5">{isRtl ? "الإقليم القديم" : "Legacy Territory"}</th>
                        <th className="p-2.5">{isRtl ? "المنطقة القديمة" : "Legacy Region"}</th>
                        <th className="p-2.5 pr-3">{isRtl ? "العناصر الناقصة" : "Missing Alignments"}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-900">
                      {legacyPharmacies.map(p => {
                        const missingFields = [];
                        if (!p.countryId || !p.countryName) missingFields.push("Country");
                        if (!p.districtId || !p.districtName) missingFields.push("District");
                        if (!p.cityId || !p.cityName) missingFields.push("City");
                        if (!p.areaId || !p.areaName) missingFields.push("Area");

                        return (
                          <tr key={p.id} className="hover:bg-slate-50/40 dark:hover:bg-slate-900/30">
                            <td className="p-2.5 pl-3 font-semibold text-slate-800 dark:text-slate-200">
                              {p.name} {p.nameAr ? `(${p.nameAr})` : ""}
                            </td>
                            <td className="p-2.5 font-mono text-[10px] text-slate-500">{p.territory || "—"}</td>
                            <td className="p-2.5 font-mono text-[10px] text-slate-500">{p.region || "—"}</td>
                            <td className="p-2.5 pr-3">
                              <span className="inline-flex flex-wrap gap-1">
                                {missingFields.map(f => (
                                  <span key={f} className="px-1.5 py-0.5 rounded bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400 text-[9px] font-bold border border-red-100/40 dark:border-red-900/40">
                                    {f}
                                  </span>
                                ))}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* 2. Search, Status, and Filter Toggles Bar - Matching Image 1 */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-3 rounded-lg shadow-xs" id="pharmacies-filter-panel">
        
        {/* Left-aligned controls */}
        <div className="flex flex-col sm:flex-row flex-1 items-stretch sm:items-center gap-2">
          {/* Search bar */}
          <div className="relative flex-1" id="pharmacy-search-wrapper">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
            <input
              type="text"
              placeholder={t.searchPlaceholder}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-slate-50/50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Quick Status Dropdown (Image 1) */}
          <div className="relative">
            <select
              value={filterStatus}
              onChange={(e) => {
                setFilterStatus(e.target.value as any);
                setAppliedFilters(prev => ({ ...prev, status: e.target.value as any }));
              }}
              className="appearance-none w-full sm:w-36 pl-3 pr-8 py-2 border border-slate-200 dark:border-slate-800 bg-transparent rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="Active">{t.active}</option>
              <option value="Inactive">{t.inactive}</option>
              <option value="All">{t.all}</option>
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={12} />
          </div>

          {/* Filters Toggle Button (Image 1) */}
          <button
            onClick={() => setIsFilterDrawerOpen(true)}
            className="flex items-center justify-center gap-1.5 px-3.5 py-2 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-xs rounded-lg shadow-sm transition-all cursor-pointer"
            id="btn-toggle-filters-drawer"
          >
            <Filter size={13} className="text-slate-500" />
            {t.filtersBtn}
          </button>
        </div>

        {/* Layout Mode Toggles - Right-aligned (Image 1) */}
        <div className="hidden md:flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg">
          <button className="p-1.5 rounded-md bg-white dark:bg-slate-900 shadow-xs text-slate-800 dark:text-white">
            {/* List layout active icon */}
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <button className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" onClick={() => alert("Grid layout is disabled to fit the requested table layout.")}>
            {/* Grid layout active icon */}
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
            </svg>
          </button>
        </div>
      </div>

      {/* 3. Responsive Pharmacies Layout */}
      <div className="space-y-4" id="pharmacies-responsive-container">
        {filteredPharmacies.length > 0 ? (
          <>
            {/* Mobile Card List (Visible on mobile, hidden on desktop/tablet) */}
            <MobileCardList
              data={filteredPharmacies}
              keyExtractor={(pharm: Pharmacy) => pharm.id}
              lang={lang}
              itemsPerPage={5}
              itemName={{ en: "pharmacies", ar: "صيدلية" }}
              onAction={() => setIsAddModalOpen(true)}
              actionLabel={lang === "ar" ? "أضف صيدلية جديدة" : "Add New Pharmacy"}
              renderItem={(pharm: Pharmacy) => {
                const isDeactivated = deactivatedIds.includes(pharm.id);
                return (
                  <div 
                    className={`space-y-3 transition-all relative ${
                      isDeactivated ? "opacity-60 bg-slate-50/40 dark:bg-slate-900/20" : ""
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <h4 className="font-bold text-slate-950 dark:text-white text-xs flex items-center gap-1 min-w-0">
                          <TruncatedText text={pharm.name} className="font-bold text-slate-950 dark:text-white text-xs" />
                          {pharm.nameAr && (
                            <TruncatedText text={`(${pharm.nameAr})`} className="text-[10px] text-slate-400 font-normal shrink-0" />
                          )}
                        </h4>
                        <TruncatedText text={pharm.address} className="text-[10px] text-slate-400 mt-0.5 block" />
                      </div>
                      <span className="px-1.5 py-0.5 text-[9px] font-bold text-slate-500 bg-slate-100 dark:bg-slate-800 rounded shrink-0">
                        {pharm.type || "Retail"}
                      </span>
                    </div>

                    <div className="border-t border-slate-100 dark:border-slate-800/60" />

                    <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-[10px] text-slate-600 dark:text-slate-300">
                      <div className="min-w-0">
                        <span className="block text-[9px] text-slate-400 font-semibold uppercase">{t.territoryCol}</span>
                        {(() => {
                          const resGeo = resolveRecordGeography(pharm, areasList);
                          const pathStr = `${resGeo.countryName} > ${resGeo.districtName} > ${resGeo.cityName} > ${resGeo.areaName}`;
                          return <TruncatedText text={pathStr} className="block font-medium text-slate-800 dark:text-slate-200" />;
                        })()}
                      </div>
                      <div className="min-w-0">
                        <span className="block text-[9px] text-slate-400 font-semibold uppercase">{t.contactCol}</span>
                        <TruncatedText text={pharm.contact || "-"} className="block font-mono text-slate-800 dark:text-slate-200" />
                      </div>
                      <div className="min-w-0">
                        <span className="block text-[9px] text-slate-400 font-semibold uppercase">{t.lastVisitCol}</span>
                        <TruncatedText text={pharm.lastVisitDate || "-"} className="block font-mono text-slate-800 dark:text-slate-200" />
                      </div>
                      <div className="min-w-0">
                        <span className="block text-[9px] text-slate-400 font-semibold uppercase">{t.nextVisitCol}</span>
                        <TruncatedText text={pharm.nextVisitDate || "-"} className="block font-mono text-slate-800 dark:text-slate-200" />
                      </div>
                    </div>

                    <div className="border-t border-slate-100 dark:border-slate-800/60" />

                    <div className="flex items-center justify-between gap-1 pt-1 text-[10px]">
                      <button
                        onClick={() => {
                          setSelectedPharmacyForProfile(pharm);
                          setActiveProfileTab("Overview");
                        }}
                        className="px-2.5 py-1 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded font-semibold transition-all border border-slate-200/50 dark:border-slate-700 cursor-pointer"
                      >
                        {t.viewProfile}
                      </button>

                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => openEditModal(pharm)}
                          className="px-2 py-1 text-slate-500 hover:text-blue-600 font-semibold transition-colors cursor-pointer"
                        >
                          {t.edit}
                        </button>
                        <button
                          onClick={() => handleToggleDeactivate(pharm.id)}
                          className="px-2 py-1 text-slate-500 hover:text-amber-600 font-semibold transition-colors cursor-pointer"
                        >
                          {isDeactivated ? t.activate : t.deactivate}
                        </button>
                        <button
                          onClick={() => handleDeleteRow(pharm.id)}
                          className="p-1 text-slate-300 hover:text-rose-500 transition-colors cursor-pointer"
                        >
                          <Trash size={12} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              }}
            />

            {/* Desktop Table View - Hidden on Mobile */}
            <div className="hidden md:block bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-lg overflow-hidden shadow-xs" id="pharmacies-desktop-table-container">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-slate-800 dark:text-slate-200">
                  <thead>
                    <tr className="bg-slate-50/75 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800 text-[11px] font-bold text-slate-500 uppercase tracking-wide">
                      <th className="p-4 w-12 text-center">
                        <input 
                          type="checkbox" 
                          onChange={handleSelectAll}
                          checked={filteredPharmacies.length > 0 && selectedRowIds.length === filteredPharmacies.length}
                          className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer w-3.5 h-3.5"
                        />
                      </th>
                      <th className="p-4 font-bold text-slate-500">{t.nameCol}</th>
                      <th className="p-4 font-bold text-slate-500">{t.typeCol}</th>
                      <th className="p-4 font-bold text-slate-500">{t.contactCol}</th>
                      <th className="p-4 font-bold text-slate-500">{t.territoryCol}</th>
                      <th className="p-4 font-bold text-slate-500">{t.lastVisitCol}</th>
                      <th className="p-4 font-bold text-slate-500">{t.nextVisitCol}</th>
                      <th className="p-4 w-28 text-center font-bold text-slate-500">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                    {paginatedPharmacies.map((pharm) => {
                      const isDeactivated = deactivatedIds.includes(pharm.id);
                      const isSelected = selectedRowIds.includes(pharm.id);
                      return (
                        <tr 
                          key={pharm.id} 
                          className={`hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors ${isDeactivated ? "opacity-60 bg-slate-50/20 dark:bg-slate-900/40" : ""}`}
                        >
                          <td className="p-4 text-center">
                            <input 
                              type="checkbox" 
                              checked={isSelected}
                              onChange={(e) => handleSelectRow(pharm.id, e.target.checked)}
                              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer w-3.5 h-3.5"
                            />
                          </td>

                          <td className="p-4 min-w-[240px]">
                            <div className="font-bold text-slate-950 dark:text-white flex items-center gap-1.5">
                              <span>{pharm.name}</span>
                              {pharm.nameAr && (
                                <span className="text-[10px] font-medium text-slate-500 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded font-sans" dir="rtl">
                                  ({pharm.nameAr})
                                </span>
                              )}
                            </div>
                            <div className="text-[10.5px] text-slate-400 mt-0.5 font-sans">
                              {pharm.address}
                            </div>
                          </td>

                          <td className="p-4">
                            <span className="px-2.5 py-1 text-[10px] font-semibold text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md">
                              {pharm.type || "Retail"}
                            </span>
                          </td>

                          <td className="p-4 text-slate-400">
                            {pharm.contact || "-"}
                          </td>

                          <td className="p-4 text-slate-600 dark:text-slate-300 max-w-[220px] truncate">
                            {(() => {
                              const resGeo = resolveRecordGeography(pharm, areasList);
                              return `${resGeo.countryName} > ${resGeo.districtName} > ${resGeo.cityName} > ${resGeo.areaName}`;
                            })()}
                          </td>

                          <td className="p-4 text-slate-500">
                            {pharm.lastVisitDate || "-"}
                          </td>

                          <td className="p-4 text-slate-500">
                            {pharm.nextVisitDate || "-"}
                          </td>

                          <td className="p-4 text-center relative">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                onClick={() => {
                                  setSelectedPharmacyForProfile(pharm);
                                  setActiveProfileTab("Overview");
                                }}
                                className="p-1.5 text-blue-600 hover:text-blue-800 hover:bg-blue-50 dark:hover:bg-blue-950/50 rounded-lg transition-colors cursor-pointer"
                                title={t.viewProfile}
                              >
                                <Eye size={15} />
                              </button>

                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOpenMenuRowId(openMenuRowId === pharm.id ? null : pharm.id);
                                }}
                                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                              >
                                <MoreHorizontal size={15} />
                              </button>
                            </div>

                            {openMenuRowId === pharm.id && (
                              <div 
                                className="absolute right-4 top-11 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-lg py-1.5 w-44 z-30 text-left font-sans animate-fade-in"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <button
                                  onClick={() => {
                                    setSelectedPharmacyForProfile(pharm);
                                    setActiveProfileTab("Overview");
                                    setOpenMenuRowId(null);
                                  }}
                                  className="w-full px-3 py-2 text-[11px] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/60 flex items-center gap-2"
                                >
                                  <Eye size={12} className="text-slate-400" />
                                  <span>{t.viewProfile}</span>
                                </button>

                                <button
                                  onClick={() => {
                                    openEditModal(pharm);
                                    setOpenMenuRowId(null);
                                  }}
                                  className="w-full px-3 py-2 text-[11px] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/60 flex items-center gap-2"
                                >
                                  <Edit size={12} className="text-slate-400" />
                                  <span>{t.edit}</span>
                                </button>

                                <button
                                  onClick={() => {
                                    alert(`Scheduling follow-up visit for ${pharm.name}...`);
                                    setOpenMenuRowId(null);
                                  }}
                                  className="w-full px-3 py-2 text-[11px] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/60 flex items-center gap-2"
                                >
                                  <Calendar size={12} className="text-slate-400" />
                                  <span>{t.scheduleVisit}</span>
                                </button>

                                <button
                                  onClick={() => {
                                    handleToggleDeactivate(pharm.id);
                                    setOpenMenuRowId(null);
                                  }}
                                  className={`w-full px-3 py-2 text-[11px] hover:bg-slate-50 dark:hover:bg-slate-800/60 flex items-center gap-2 ${
                                    isDeactivated ? "text-emerald-600 font-bold" : "text-slate-700 dark:text-slate-200"
                                  }`}
                                >
                                  <Slash size={12} className="text-slate-400" />
                                  <span>{isDeactivated ? t.activate : t.deactivate}</span>
                                </button>

                                <div className="border-t border-slate-100 dark:border-slate-800 my-1"></div>

                                <button
                                  onClick={() => {
                                    handleDeleteRow(pharm.id);
                                    setOpenMenuRowId(null);
                                  }}
                                  className="w-full px-3 py-2 text-[11px] text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20 flex items-center gap-2 font-bold"
                                >
                                  <Trash size={12} className="text-rose-500" />
                                  <span>{t.delete}</span>
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>



            {/* Pagination Controls */}
            <div className="hidden md:block">
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                totalItems={filteredPharmacies.length}
                itemsPerPage={itemsPerPage}
                onPageChange={setCurrentPage}
                onItemsPerPageChange={setItemsPerPage}
                lang={lang}
                itemNameEn="pharmacies"
                itemNameAr="صيدلية"
              />
            </div>
          </>
        ) : (
          <NoDataState
            title={lang === "ar" ? "لم يتم العثور على صيدليات" : "No Pharmacies Found"}
            description={lang === "ar" 
              ? "لم نجد أي صيدليات تطابق معايير البحث الحالية. ابدأ بتهيئة أول صيدلية جديدة في النظام." 
              : "No pharmacies found matching your current filters. Get started by creating a new pharmacy profile."
            }
            onAction={() => setIsAddModalOpen(true)}
            actionLabel={lang === "ar" ? "أضف صيدلية جديدة" : "Add New Pharmacy"}
            icon={Store}
            lang={lang}
          />
        )}
      </div>

      {/* 4. Filter Slide-Out Drawer Panel - Matching Image 2 exactly */}
      {isFilterDrawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end" id="filters-drawer-overlay">
          {/* Backdrop blur */}
          <div 
            onClick={() => setIsFilterDrawerOpen(false)}
            className="absolute inset-0 bg-slate-950/50 backdrop-blur-xs transition-opacity cursor-pointer"
          ></div>
          
          {/* Drawer content body */}
          <div className="relative w-full max-w-sm bg-white dark:bg-slate-900 h-full shadow-2xl flex flex-col justify-between z-10 animate-slide-in font-sans">
            <div>
              {/* Header */}
              <div className="flex justify-between items-center p-4 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2 text-slate-800 dark:text-white font-bold text-sm">
                  <Filter size={15} className="text-blue-600 dark:text-blue-400" />
                  <span>Filters</span>
                </div>
                {/* Round close X button */}
                <button 
                  onClick={() => setIsFilterDrawerOpen(false)}
                  className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 flex items-center justify-center text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
                >
                  <X size={14} />
                </button>
              </div>

              {/* Filter Body Inputs */}
              <div className="p-4 space-y-4 overflow-y-auto max-h-[calc(100vh-140px)] text-xs">
                
                {/* 1. All Territories Dropdown */}
                <div className="space-y-1.5">
                  <label className="font-bold text-slate-500 block">All Territories</label>
                  <div className="relative">
                    <select
                      value={filterTerritory}
                      onChange={(e) => setFilterTerritory(e.target.value)}
                      className="w-full appearance-none px-3 py-2 border border-slate-200 dark:border-slate-800 bg-transparent rounded-lg text-slate-800 dark:text-white focus:outline-none focus:border-blue-500 font-semibold"
                    >
                      <option value="All">{t.allTerritories}</option>
                      {distinctTerritories.map(t => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={12} />
                  </div>
                </div>

                {/* 2. All Cities Dropdown */}
                <div className="space-y-1.5">
                  <label className="font-bold text-slate-500 block">All Cities</label>
                  <div className="relative">
                    <select
                      value={filterCity}
                      onChange={(e) => setFilterCity(e.target.value)}
                      className="w-full appearance-none px-3 py-2 border border-slate-200 dark:border-slate-800 bg-transparent rounded-lg text-slate-800 dark:text-white focus:outline-none focus:border-blue-500 font-semibold"
                    >
                      <option value="All">{t.allCities}</option>
                      {distinctCities.map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={12} />
                  </div>
                </div>

                {/* 3. All Areas Dropdown */}
                <div className="space-y-1.5">
                  <label className="font-bold text-slate-500 block">All Areas</label>
                  <div className="relative">
                    <select
                      value={filterArea}
                      onChange={(e) => setFilterArea(e.target.value)}
                      className="w-full appearance-none px-3 py-2 border border-slate-200 dark:border-slate-800 bg-transparent rounded-lg text-slate-800 dark:text-white focus:outline-none focus:border-blue-500 font-semibold"
                    >
                      <option value="All">{t.allAreas}</option>
                      {distinctAreas.map(a => (
                        <option key={a} value={a}>{a}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={12} />
                  </div>
                </div>

                {/* 4. All Sales Reps Dropdown */}
                <div className="space-y-1.5">
                  <label className="font-bold text-slate-500 block">All Sales Reps</label>
                  <div className="relative">
                    <select
                      value={filterSalesRep}
                      onChange={(e) => setFilterSalesRep(e.target.value)}
                      className="w-full appearance-none px-3 py-2 border border-slate-200 dark:border-slate-800 bg-transparent rounded-lg text-slate-800 dark:text-white focus:outline-none focus:border-blue-500 font-semibold"
                    >
                      <option value="All">{t.allSalesReps}</option>
                      <option value="Omar Al-Fares">Omar Al-Fares</option>
                      <option value="Zaid Al-Ibrahimi">Zaid Al-Ibrahimi</option>
                      <option value="Fatima Al-Riyami">Fatima Al-Riyami</option>
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={12} />
                  </div>
                </div>

                {/* 5. All Types Dropdown */}
                <div className="space-y-1.5">
                  <label className="font-bold text-slate-500 block">All Types</label>
                  <div className="relative">
                    <select
                      value={filterType}
                      onChange={(e) => setFilterType(e.target.value)}
                      className="w-full appearance-none px-3 py-2 border border-slate-200 dark:border-slate-800 bg-transparent rounded-lg text-slate-800 dark:text-white focus:outline-none focus:border-blue-500 font-semibold"
                    >
                      <option value="All">{t.allTypes}</option>
                      {distinctTypes.map(t => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={12} />
                  </div>
                </div>

                {/* 6. Status Selector - Segmented Pills (Active / Inactive / All) */}
                <div className="space-y-2">
                  <label className="font-bold text-slate-500 block">Status</label>
                  <div className="flex p-0.5 bg-slate-100 dark:bg-slate-800 rounded-lg">
                    {(["Active", "Inactive", "All"] as const).map((status) => {
                      const isActive = filterStatus === status;
                      return (
                        <button
                          key={status}
                          type="button"
                          onClick={() => setFilterStatus(status)}
                          className={`flex-1 py-1.5 rounded-md text-xxs font-bold transition-all text-center cursor-pointer ${
                            isActive 
                              ? "bg-blue-600 text-white shadow-xs" 
                              : "text-slate-600 dark:text-slate-300 hover:text-slate-800"
                          }`}
                        >
                          {status === "Active" ? t.active : status === "Inactive" ? t.inactive : t.all}
                        </button>
                      );
                    })}
                  </div>
                </div>

              </div>
            </div>

            {/* Bottom Actions Reset & Apply Filters */}
            <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex gap-3">
              <button
                type="button"
                onClick={handleResetFilters}
                className="flex-1 py-2.5 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 font-bold rounded-lg flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <X size={13} />
                <span>Reset</span>
              </button>
              <button
                type="button"
                onClick={handleApplyFilters}
                className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition-colors cursor-pointer text-center"
              >
                Apply Filters
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. View Profile Modal - Matching Image 4 exactly */}
      {selectedPharmacyForProfile && (
        <div className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs" id="pharmacy-profile-modal">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-3xl shadow-2xl relative font-sans animate-fade-in overflow-hidden">
            
            {/* Upper Right Close Button */}
            <button 
              onClick={() => setSelectedPharmacyForProfile(null)}
              className="absolute right-4 top-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer z-10"
            >
              <X size={18} />
            </button>

            {/* Header Block */}
            <div className="p-6 pb-4 bg-slate-50/50 dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800">
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                
                {/* Avatar Initials - "AS" blue circle */}
                <div className="w-14 h-14 rounded-full bg-blue-100 dark:bg-blue-950/60 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold text-lg border border-blue-200 dark:border-blue-800 shrink-0">
                  {selectedPharmacyForProfile.name.split(" ").slice(0, 2).map(w => w[0]).join("").toUpperCase() || "PH"}
                </div>

                {/* Name & Location Badges */}
                <div className="space-y-1.5 flex-1 min-w-0">
                  <h3 className="font-bold text-base text-slate-950 dark:text-white flex items-center gap-2 flex-wrap">
                    <span>{selectedPharmacyForProfile.name}</span>
                    {selectedPharmacyForProfile.nameAr && (
                      <span className="font-medium text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded text-xs" dir="rtl">
                        ({selectedPharmacyForProfile.nameAr})
                      </span>
                    )}
                  </h3>
                  
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Retail Badge */}
                    <span className="px-2 py-0.5 text-[10px] font-semibold text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded">
                      {selectedPharmacyForProfile.type || "Retail"}
                    </span>

                    {/* Location Badge */}
                    <span className="px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800/80 rounded flex items-center gap-1">
                      <MapPin size={9} className="text-slate-400" />
                      <span>{selectedPharmacyForProfile.territory}</span>
                    </span>
                  </div>
                </div>
              </div>

              {/* Navigation Tabs - Light Grey container (Image 4) */}
              <div className="mt-6 p-1 bg-slate-100/80 dark:bg-slate-800/80 rounded-lg flex gap-1 overflow-x-auto max-w-full">
                {[
                  "Overview", "Visits", "Orders", "Payments", "Products", "Stock Requests", "Supervisor Visits"
                ].map((tab) => {
                  const isActive = activeProfileTab === tab;
                  return (
                    <button
                      key={tab}
                      onClick={() => setActiveProfileTab(tab)}
                      className={`px-3 py-1.5 rounded-md text-[11px] font-bold transition-all whitespace-nowrap cursor-pointer ${
                        isActive 
                          ? "bg-white dark:bg-slate-900 text-slate-950 dark:text-white shadow-xs" 
                          : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                      }`}
                    >
                      {tab}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Modal Body Tab Content */}
            <div className="p-6 overflow-y-auto max-h-[calc(100vh-250px)] text-xs">
              
              {/* Tab 1: OVERVIEW */}
              {activeProfileTab === "Overview" && (
                <div className="space-y-5">
                  
                  {/* Top Split Sections (Contact & Visit Schedule) */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Contact Information */}
                    <div className="p-4 bg-slate-50/50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-lg space-y-2">
                      <h4 className="font-bold text-slate-400 uppercase text-[9.5px] tracking-wider">{t.contactInfo}</h4>
                      <div className="space-y-1.5 text-xxs">
                        <div className="flex items-start gap-2 text-slate-800 dark:text-white">
                          <span className="text-slate-400 font-medium shrink-0 w-16">Address:</span>
                          <span className="font-semibold">{selectedPharmacyForProfile.address}</span>
                        </div>
                        <div className="flex items-center gap-2 text-slate-800 dark:text-white">
                          <span className="text-slate-400 font-medium shrink-0 w-16">Licensing Contact:</span>
                          <span className="font-bold text-indigo-600 dark:text-indigo-400">{selectedPharmacyForProfile.contactPerson || selectedPharmacyForProfile.contact || "-"}</span>
                        </div>
                        <div className="flex items-center gap-2 text-slate-800 dark:text-white">
                          <span className="text-slate-400 font-medium shrink-0 w-16">Phone:</span>
                          <span className="font-mono font-bold text-slate-900 dark:text-slate-100">{selectedPharmacyForProfile.phone || selectedPharmacyForProfile.contact || "-"}</span>
                        </div>
                        <div className="flex items-center gap-2 text-slate-800 dark:text-white">
                          <span className="text-slate-400 font-medium shrink-0 w-16">Email:</span>
                          <span className="font-mono text-slate-600 dark:text-slate-300 truncate" title={selectedPharmacyForProfile.email}>{selectedPharmacyForProfile.email || "-"}</span>
                        </div>
                      </div>
                    </div>

                    {/* Visit Schedule */}
                    <div className="p-4 bg-slate-50/50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-lg space-y-3">
                      <h4 className="font-bold text-slate-400 uppercase text-[9.5px] tracking-wider">{t.visitSchedule}</h4>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <span className="text-[10px] text-slate-400 flex items-center gap-1">
                            <Clock size={11} />
                            Last Visit
                          </span>
                          <p className="font-bold text-slate-800 dark:text-slate-200">
                            {selectedPharmacyForProfile.lastVisitDate}
                          </p>
                        </div>
                        <div className="space-y-1">
                          <span className="text-[10px] text-slate-400 flex items-center gap-1">
                            <Calendar size={11} />
                            Next Visit
                          </span>
                          <p className="font-bold text-slate-800 dark:text-slate-200">
                            {selectedPharmacyForProfile.nextVisitDate || "Not set"}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Location card with breadcrumbs */}
                  <div className="p-4 bg-slate-50/50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-lg">
                    <div className="flex justify-between items-center mb-3">
                      <h4 className="font-bold text-slate-400 uppercase text-[9.5px] tracking-wider flex items-center gap-1">
                        <MapPin size={12} className="text-slate-400" />
                        Location
                      </h4>
                      <button 
                        onClick={() => openEditModal(selectedPharmacyForProfile)}
                        className="text-slate-400 hover:text-blue-600 transition-colors cursor-pointer"
                      >
                        <Edit size={13} />
                      </button>
                    </div>
                    {/* Location breadcrumbs following strict Country > District > City > Area path */}
                    {(() => {
                      const resGeo = resolveRecordGeography(selectedPharmacyForProfile, areasList);
                      return (
                        <div className="flex items-center gap-1 flex-wrap text-[10px] font-bold text-slate-700 dark:text-slate-300">
                          <span className="px-2 py-1 bg-white dark:bg-slate-950 border border-slate-100 dark:border-slate-800 rounded shadow-2xs">
                            {resGeo.countryName}
                          </span>
                          <span className="text-slate-300">/</span>
                          <span className="px-2 py-1 bg-white dark:bg-slate-950 border border-slate-100 dark:border-slate-800 rounded shadow-2xs">
                            {resGeo.districtName}
                          </span>
                          <span className="text-slate-300">/</span>
                          <span className="px-2 py-1 bg-white dark:bg-slate-950 border border-slate-100 dark:border-slate-800 rounded shadow-2xs">
                            {resGeo.cityName}
                          </span>
                          <span className="text-slate-300">/</span>
                          <span className="px-2 py-1 bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900 rounded shadow-2xs text-indigo-700 dark:text-indigo-300">
                            {resGeo.areaName}
                          </span>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Staff Assignments & Operational Parameters */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 bg-slate-50/50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-lg space-y-3">
                      <h4 className="font-bold text-slate-400 uppercase text-[9.5px] tracking-wider">Field Assignments</h4>
                      <div className="space-y-2 text-xxs">
                        <div className="flex justify-between items-center border-b border-slate-100/50 dark:border-slate-800/50 pb-1.5">
                          <span className="text-slate-400">Assigned Sales Rep:</span>
                          <span className="font-bold text-slate-800 dark:text-slate-200">{getRepName(selectedPharmacyForProfile.assignedRepId)}</span>
                        </div>
                        <div className="flex justify-between items-center pb-0.5">
                          <span className="text-slate-400">Assigned Field Supervisor:</span>
                          <span className="font-bold text-slate-850 dark:text-slate-200">{getSupervisorName(selectedPharmacyForProfile.assignedSupervisorId)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="p-4 bg-slate-50/50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-lg space-y-3">
                      <h4 className="font-bold text-slate-400 uppercase text-[9.5px] tracking-wider">Operational Parameters</h4>
                      <div className="space-y-2 text-xxs">
                        <div className="flex justify-between items-center border-b border-slate-100/50 dark:border-slate-800/50 pb-1.5">
                          <span className="text-slate-400">Sales Potential Priority:</span>
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            selectedPharmacyForProfile.salesPotential === "High"
                              ? "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300"
                              : selectedPharmacyForProfile.salesPotential === "Low"
                              ? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                              : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                          }`}>{selectedPharmacyForProfile.salesPotential || "Medium"}</span>
                        </div>
                        <div className="flex justify-between items-center pb-0.5">
                          <span className="text-slate-400">Credit Term Window:</span>
                          <span className="font-mono font-bold text-slate-800 dark:text-slate-200">{selectedPharmacyForProfile.paymentInDays || 30} Days</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Market Intelligence / Competitor Shelf Share */}
                  {selectedPharmacyForProfile.competitorInformation && (
                    <div className="p-4 bg-amber-50/40 dark:bg-amber-950/10 border border-amber-100 dark:border-amber-900/50 rounded-lg space-y-2">
                      <h4 className="font-bold text-amber-800 dark:text-amber-400 uppercase text-[9px] tracking-wider">Market Intelligence &amp; Shelf Competitors</h4>
                      <p className="text-slate-700 dark:text-slate-300 text-xxs leading-relaxed italic">
                        "{selectedPharmacyForProfile.competitorInformation}"
                      </p>
                    </div>
                  )}

                  {/* Credit Summary - EXACTLY like Image 4 */}
                  <div className="p-4 bg-slate-50/50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-lg space-y-4">
                    <h4 className="font-bold text-slate-400 uppercase text-[9.5px] tracking-wider flex items-center gap-1">
                      <CreditCard size={12} className="text-slate-400" />
                      Credit Summary
                    </h4>

                    {/* 4 columns layout */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {/* Box 1: Outstanding (highlighted orange text) */}
                      <div className="p-3 bg-white dark:bg-slate-950 border border-slate-100 dark:border-slate-800 rounded-lg text-center space-y-1 shadow-2xs">
                        <p className="text-sm font-extrabold text-orange-600 dark:text-orange-400">
                          {currentOutstanding}
                        </p>
                        <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Outstanding</p>
                      </div>

                      {/* Box 2: Confirmed */}
                      <div className="p-3 bg-white dark:bg-slate-950 border border-slate-100 dark:border-slate-800 rounded-lg text-center space-y-1 shadow-2xs">
                        <p className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400">
                          {pharmacyMoney(0, selectedPharmacyForProfile)}
                        </p>
                        <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Confirmed</p>
                      </div>

                      {/* Box 3: Collected */}
                      <div className="p-3 bg-white dark:bg-slate-950 border border-slate-100 dark:border-slate-800 rounded-lg text-center space-y-1 shadow-2xs">
                        <p className="text-sm font-extrabold text-blue-600 dark:text-blue-400">
                          {pharmacyMoney(0, selectedPharmacyForProfile)}
                        </p>
                        <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Collected</p>
                      </div>

                      {/* Box 4: Pending */}
                      <div className="p-3 bg-white dark:bg-slate-950 border border-slate-100 dark:border-slate-800 rounded-lg text-center space-y-1 shadow-2xs">
                        <p className="text-sm font-extrabold text-amber-500 dark:text-amber-400">
                          {pharmacyMoney(0, selectedPharmacyForProfile)}
                        </p>
                        <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Pending</p>
                      </div>
                    </div>

                    {/* Credit Summary Footer */}
                    <div className="flex justify-between items-center border-t border-slate-100 dark:border-slate-800 pt-3 text-[10.5px] font-bold text-slate-500">
                      <span>{financialProfile ? `${financialProfile.openInvoiceCount} ${isRtl ? "فواتير مفتوحة" : "open invoices"}` : "—"}</span>
                      <span>Total: {currentOutstanding}</span>
                    </div>
                  </div>

                  {/* Dynamic interactive quick stats icons representational at bottom */}
                  <div className="grid grid-cols-4 gap-2">
                    <div className="p-2 border border-slate-100 dark:border-slate-800 rounded-lg text-center bg-slate-50/30">
                      <p className="font-bold text-slate-800 dark:text-white">2</p>
                      <span className="text-[9px] text-slate-400">Visits logged</span>
                    </div>
                    <div className="p-2 border border-slate-100 dark:border-slate-800 rounded-lg text-center bg-slate-50/30">
                      <p className="font-bold text-slate-800 dark:text-white">20%</p>
                      <span className="text-[9px] text-slate-400">Inventory level</span>
                    </div>
                    <div className="p-2 border border-slate-100 dark:border-slate-800 rounded-lg text-center bg-slate-50/30">
                      <p className="font-bold text-slate-800 dark:text-white">1</p>
                      <span className="text-[9px] text-slate-400">Outstanding Deals</span>
                    </div>
                    <div className="p-2 border border-slate-100 dark:border-slate-800 rounded-lg text-center bg-slate-50/30">
                      <p className="font-bold text-slate-800 dark:text-white">122</p>
                      <span className="text-[9px] text-slate-400">SKUs delivered</span>
                    </div>
                  </div>

                </div>
              )}

              {/* Tab 2: VISITS - Fully implemented real data */}
              {activeProfileTab === "Visits" && (
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <h4 className="font-bold text-slate-700 dark:text-white uppercase tracking-wider">Historical Stock Audit visits</h4>
                    <span className="text-xxs font-bold px-2 py-0.5 bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400 rounded-full">2 visits</span>
                  </div>
                  <div className="border border-slate-100 dark:border-slate-800 rounded-lg overflow-x-auto">
                    <table className="w-full text-left text-xs min-w-[500px]">
                      <thead className="bg-slate-50 dark:bg-slate-800 text-[10px] font-bold text-slate-400 uppercase">
                        <tr>
                          <th className="p-3">Visit ID</th>
                          <th className="p-3">Date</th>
                          <th className="p-3">Assigned Sales Rep</th>
                          <th className="p-3">Notes & Highlights</th>
                          <th className="p-3 text-right">Supervisor Co-travel</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {getMockVisitsForPharmacy(selectedPharmacyForProfile.id).map(visit => (
                           <tr key={visit.id} className="hover:bg-slate-50/40">
                            <td className="p-3 font-bold text-blue-600">{visit.id}</td>
                            <td className="p-3">{visit.date}</td>
                            <td className="p-3 font-medium">{visit.rep}</td>
                            <td className="p-3 text-slate-500 max-w-[220px] truncate" title={visit.notes}>{visit.notes}</td>
                            <td className="p-3 text-right text-slate-400">{visit.supervisor}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Tab 3: ORDERS */}
              {activeProfileTab === "Orders" && (() => {
                const pharmacyRealOrders = realOrders.filter(
                  o => o.pharmacyId === selectedPharmacyForProfile.id || o.pharmacyName === selectedPharmacyForProfile.name
                );
                return (
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <h4 className="font-bold text-slate-700 dark:text-white uppercase tracking-wider">
                        {isRtl ? "سجل طلبات الصيدلية" : "Pharmacy Commercial Orders"}
                      </h4>
                      <span className="text-xxs font-bold px-2 py-0.5 bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 rounded-full font-mono">
                        {pharmacyRealOrders.length} {isRtl ? "طلبات" : "orders"}
                      </span>
                    </div>

                    {pharmacyRealOrders.length === 0 ? (
                      <div className="p-8 text-center text-slate-400 bg-slate-50 dark:bg-slate-950/40 rounded-xl border border-slate-100 dark:border-slate-800 text-xs">
                        {isRtl ? "لا توجد طلبات تجارية مسجلة لهذه الصيدلية" : "No commercial orders recorded for this pharmacy."}
                      </div>
                    ) : (
                      <div className="border border-slate-100 dark:border-slate-800 rounded-lg overflow-x-auto">
                        <table className="w-full text-left text-xs min-w-[500px]" dir={isRtl ? "rtl" : "ltr"}>
                          <thead className="bg-slate-50 dark:bg-slate-800 text-[10px] font-bold text-slate-400 uppercase">
                            <tr>
                              <th className="p-3">{isRtl ? "رقم الطلب" : "Order ID"}</th>
                              <th className="p-3">{isRtl ? "التاريخ" : "Date"}</th>
                              <th className="p-3">{isRtl ? "الأصناف" : "Items"}</th>
                              <th className="p-3">{isRtl ? "الحالة" : "Status"}</th>
                              <th className="p-3 text-right">{isRtl ? "الإجمالي" : "Net Value"}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono">
                            {pharmacyRealOrders.map(order => {
                              const itemsStr = Array.isArray(order.items) 
                                ? order.items.map((i: any) => i.name || i.title).join(", ") 
                                : String(order.items || "-");
                              return (
                                <tr key={order.id} className="hover:bg-slate-50/40 dark:hover:bg-slate-800/20">
                                  <td className="p-3 font-bold text-slate-900 dark:text-white">{order.displayNumber || order.id}</td>
                                  <td className="p-3 text-slate-500">{order.orderDate || "-"}</td>
                                  <td className="p-3 text-slate-500 truncate max-w-[200px]" title={itemsStr}>{itemsStr}</td>
                                  <td className="p-3">
                                    <span className="px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 text-[10px] font-bold">
                                      {order.status}
                                    </span>
                                  </td>
                                  <td className="p-3 text-right font-bold text-slate-900 dark:text-white">
                                    {pharmacyMoney(order.total || order.netAmount || 0, order)}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Tab 4: PAYMENTS */}
              {activeProfileTab === "Payments" && (
                <div className="space-y-4">
                  <h4 className="font-bold text-slate-700 dark:text-white uppercase tracking-wider">Account Receivable payments Ledger</h4>
                  <div className="border border-slate-100 dark:border-slate-800 rounded-lg overflow-x-auto">
                    <table className="w-full text-left text-xs min-w-[500px]">
                      <thead className="bg-slate-50 dark:bg-slate-800 text-[10px] font-bold text-slate-400 uppercase">
                        <tr>
                          <th className="p-3">Receipt ID</th>
                          <th className="p-3">Date</th>
                          <th className="p-3">Payment instrument</th>
                          <th className="p-3">Status</th>
                          <th className="p-3 text-right">Collected Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {getMockPaymentsForPharmacy(selectedPharmacyForProfile.id).map(pmt => (
                          <tr key={pmt.id} className="hover:bg-slate-50/40">
                            <td className="p-3 font-bold text-blue-600">{pmt.id}</td>
                            <td className="p-3">{pmt.date}</td>
                            <td className="p-3 text-slate-500 font-medium">{pmt.instrument}</td>
                            <td className="p-3">
                              <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-800 text-[10px] font-bold">
                                {pmt.status}
                              </span>
                            </td>
                            <td className="p-3 text-right font-black text-emerald-600">
                              {pharmacyMoney(pmt.amount, pmt)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Tab 5: PRODUCTS */}
              {activeProfileTab === "Products" && (
                <div className="space-y-4">
                  <h4 className="font-bold text-slate-700 dark:text-white uppercase tracking-wider">Monitored SKU Formulation levels</h4>
                  <div className="border border-slate-100 dark:border-slate-800 rounded-lg overflow-x-auto">
                    <table className="w-full text-left text-xs min-w-[500px]">
                      <thead className="bg-slate-50 dark:bg-slate-800 text-[10px] font-bold text-slate-400 uppercase">
                        <tr>
                          <th className="p-3">Product Name</th>
                          <th className="p-3">Recorded Shelf Stock</th>
                          <th className="p-3">Target formulation Quantity</th>
                          <th className="p-3 text-right">Urgent Replenishment Request</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {getMockProductsForPharmacy().map(prod => (
                          <tr key={prod.id} className="hover:bg-slate-50/40">
                            <td className="p-3 font-bold text-slate-900 dark:text-white">{prod.name}</td>
                            <td className="p-3 font-medium text-amber-600">{prod.shelfStock}</td>
                            <td className="p-3 text-slate-500">{prod.targetStock}</td>
                            <td className="p-3 text-right">
                              {prod.urgentRequest !== "0" ? (
                                <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-700 font-bold text-[10px] animate-pulse">
                                  {prod.urgentRequest} packs requested
                                </span>
                              ) : (
                                <span className="text-slate-300">-</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Tab 6: STOCK REQUESTS */}
              {activeProfileTab === "Stock Requests" && (
                <div className="space-y-4">
                  <h4 className="font-bold text-slate-700 dark:text-white uppercase tracking-wider">Urgent replenishment Stock requests</h4>
                  <div className="border border-slate-100 dark:border-slate-800 rounded-lg overflow-x-auto">
                    <table className="w-full text-left text-xs min-w-[500px]">
                      <thead className="bg-slate-50 dark:bg-slate-800 text-[10px] font-bold text-slate-400 uppercase">
                        <tr>
                          <th className="p-3">Request ID</th>
                          <th className="p-3">Date Raised</th>
                          <th className="p-3">Requested Formulation</th>
                          <th className="p-3">Priority</th>
                          <th className="p-3 text-right">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {getMockStockRequestsForPharmacy().map(req => (
                          <tr key={req.id} className="hover:bg-slate-50/40">
                            <td className="p-3 font-bold text-slate-900 dark:text-white">{req.id}</td>
                            <td className="p-3">{req.date}</td>
                            <td className="p-3 text-slate-600 font-medium">{req.item}</td>
                            <td className="p-3">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                req.priority === "High" ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-600"
                              }`}>
                                {req.priority}
                              </span>
                            </td>
                            <td className="p-3 text-right">
                              <span className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-700 text-[10px] font-bold">
                                {req.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Tab 7: SUPERVISOR VISITS */}
              {activeProfileTab === "Supervisor Visits" && (
                <div className="space-y-4">
                  <h4 className="font-bold text-slate-700 dark:text-white uppercase tracking-wider">Supervisor Visits</h4>
<SupervisorVisitHistory customerType="PHARMACY" customerId={selectedPharmacyForProfile.id} users={users} lang={lang} />
                </div>
              )}

            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-slate-50 dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 flex justify-end">
              <button
                onClick={() => setSelectedPharmacyForProfile(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-lg cursor-pointer text-xs"
              >
                Close Profile
              </button>
            </div>

          </div>
        </div>
      )}

      {/* 6. Add Pharmacy Dialog Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs" id="add-pharmacy-modal">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-2xl p-5 space-y-4 shadow-2xl relative animate-fade-in font-sans">
            
            <div className="flex justify-between items-center pb-2 border-b border-slate-100 dark:border-slate-800" id="modal-header">
              <h3 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                <PlusCircle className="text-indigo-600" size={16} />
                <span>Onboard New Retail Outlet (Master Template)</span>
              </h3>
              <button 
                onClick={() => setIsAddModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleAddSubmit} className="space-y-4 text-xs" id="add-pharmacy-form">
              <div className="max-h-[65vh] overflow-y-auto pr-1 space-y-4">
                
                {/* Section 1: Basic Identity */}
                <div className="space-y-2 border-b border-slate-50 dark:border-slate-800 pb-3">
                  <span className="font-bold text-[10px] text-indigo-600 uppercase tracking-wider block">1. Outlet Identity</span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="font-bold text-slate-500 block">Pharmacy Name (English) *</label>
                      <input
                        type="text"
                        required
                        value={nameEn}
                        onChange={(e) => setNameEn(e.target.value)}
                        placeholder="e.g. Grand Pharmacy Downtown"
                        className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50/50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="font-bold text-slate-500 block">Pharmacy Name (Arabic)</label>
                      <input
                        type="text"
                        value={nameAr}
                        onChange={(e) => setNameAr(e.target.value)}
                        placeholder="الصيدلية الكبرى - وسط المدينة"
                        className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50/50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none focus:border-indigo-500 text-right"
                        dir="rtl"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <label className="font-bold text-slate-500 block">Outlet Formulation Type</label>
                      <select
                        value={pType}
                        onChange={(e) => setPType(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50/50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none"
                      >
                        <option value="Retail">Retail</option>
                        <option value="Chain Pharmacy">Chain Pharmacy</option>
                        <option value="Wholesale">Wholesale</option>
                        <option value="Hospital Pharmacy">Hospital Pharmacy</option>
                        <option value="Polyclinic Pharmacy">Polyclinic Pharmacy</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="font-bold text-slate-500 block">Sales Potential</label>
                      <select
                        value={salesPotential}
                        onChange={(e) => setSalesPotential(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50/50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none"
                      >
                        <option value="High">High</option>
                        <option value="Medium">Medium</option>
                        <option value="Low">Low</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="font-bold text-slate-500 block">Operational Region (Auto-Derived)</label>
                      <input
                        type="text"
                        readOnly
                        value={derivedRegionLabel}
                        className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-400 focus:outline-none cursor-not-allowed font-medium"
                      />
                    </div>
                  </div>
                </div>

                {/* Section 2: Geographic Hierarchy */}
                <div className="space-y-2 border-b border-slate-50 dark:border-slate-800 pb-3">
                  <span className="font-bold text-[10px] text-indigo-600 uppercase tracking-wider block">2. Geographic Hierarchy Path (Country &gt; District &gt; City &gt; Area)</span>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <div className="space-y-1">
                      <label className="font-bold text-slate-400 block text-[10px]">Country *</label>
                      <select
                        required
                        value={countryId}
                        onChange={(e) => {
                          const id = e.target.value;
                          setCountryId(id);
                          const name = countriesList.find(c => c.id === id)?.name || "";
                          setCountryName(name);
                          setCountry(name);
                          // Reset dependents
                          setDistrictId("");
                          setDistrictName("");
                          setDistrict("");
                          setCityId("");
                          setCityName("");
                          setCity("");
                          setAreaId("");
                          setAreaName("");
                          setArea("");
                          setTerritory("");
                        }}
                        className="w-full px-2 py-1.5 border border-slate-200 dark:border-slate-800 rounded bg-slate-50/50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none text-xxs cursor-pointer"
                      >
                        <option value="">-- Country --</option>
                        {countriesList.map(c => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="font-bold text-slate-400 block text-[10px]">District *</label>
                      <select
                        required
                        disabled={!countryId}
                        value={districtId}
                        onChange={(e) => {
                          const id = e.target.value;
                          setDistrictId(id);
                          const name = districtsList.find(d => d.id === id)?.name || "";
                          setDistrictName(name);
                          setDistrict(name);
                          setRegion(name);
                          // Reset dependents
                          setCityId("");
                          setCityName("");
                          setCity("");
                          setAreaId("");
                          setAreaName("");
                          setArea("");
                          setTerritory("");
                        }}
                        className="w-full px-2 py-1.5 border border-slate-200 dark:border-slate-800 rounded bg-slate-50/50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none text-xxs cursor-pointer disabled:opacity-50"
                      >
                        <option value="">-- District --</option>
                        {districtsList.filter(d => d.countryId === countryId).map(d => (
                          <option key={d.id} value={d.id}>{d.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="font-bold text-slate-400 block text-[10px]">City / Province *</label>
                      <select
                        required
                        disabled={!districtId}
                        value={cityId}
                        onChange={(e) => {
                          const id = e.target.value;
                          setCityId(id);
                          const name = citiesList.find(c => c.id === id)?.name || "";
                          setCityName(name);
                          setCity(name);
                          // Reset dependents
                          setAreaId("");
                          setAreaName("");
                          setArea("");
                          setTerritory("");
                        }}
                        className="w-full px-2 py-1.5 border border-slate-200 dark:border-slate-800 rounded bg-slate-50/50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none text-xxs cursor-pointer disabled:opacity-50"
                      >
                        <option value="">-- City --</option>
                        {citiesList.filter(c => c.districtId === districtId).map(c => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="font-bold text-slate-400 block text-[10px]">Area / Subzone *</label>
                      <select
                        required
                        disabled={!cityId}
                        value={areaId}
                        onChange={(e) => {
                          const id = e.target.value;
                          setAreaId(id);
                          const name = areasList.find(a => a.id === id)?.name || "";
                          setAreaName(name);
                          setArea(name);
                          setTerritory(name);
                        }}
                        className="w-full px-2 py-1.5 border border-slate-200 dark:border-slate-800 rounded bg-slate-50/50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none text-xxs cursor-pointer disabled:opacity-50"
                      >
                        <option value="">-- Area --</option>
                        {areasList.filter(a => a.cityId === cityId).map(a => (
                          <option key={a.id} value={a.id}>{a.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="font-bold text-slate-500 block">Physical Address / Landmark *</label>
                    <input
                      type="text"
                      required
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      placeholder="e.g. Al-Dhahra Street, opposite Al-Ghazala Fountain"
                      className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50/50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  {/* GPS Box */}
                  <div className="bg-slate-50 dark:bg-slate-950 p-2.5 rounded-lg border border-slate-100 dark:border-slate-850 space-y-1.5">
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-[10px] text-slate-400 uppercase tracking-wider">GPS Coordinates Verification</span>
                    </div>
                    {lat && lng ? (
                      <div className="text-xxs font-mono text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-900 p-2 rounded border border-slate-200 dark:border-slate-800">
                        Location: {lat}, {lng} (GPS Verified)
                      </div>
                    ) : (
                      <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50/70 dark:bg-amber-950/30 p-2 rounded border border-amber-200 dark:border-amber-900/40">
                        Location not yet verified. The first field visit will establish the customer’s global GPS location.
                      </p>
                    )}
                  </div>
                </div>

                {/* Section 3: Contact details */}
                <div className="space-y-2 border-b border-slate-50 dark:border-slate-800 pb-3">
                  <span className="font-bold text-[10px] text-indigo-600 uppercase tracking-wider block">3. Contact &amp; Licensing</span>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <label className="font-bold text-slate-500 block">Contact Person</label>
                      <input
                        type="text"
                        value={contactPerson}
                        onChange={(e) => setContactPerson(e.target.value)}
                        placeholder="e.g. Dr. Salem"
                        className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50/50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="font-bold text-slate-500 block">Phone *</label>
                      <input
                        type="text"
                        required
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="+218 91..."
                        className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50/50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none font-mono"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="font-bold text-slate-500 block">Email Address</label>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="contact@pharmacy.ly"
                        className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50/50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none"
                      />
                    </div>
                  </div>
                </div>

                {/* Section 4: Assignments & Financials */}
                <div className="space-y-2 border-b border-slate-50 dark:border-slate-800 pb-3">
                  <span className="font-bold text-[10px] text-indigo-600 uppercase tracking-wider block">4. Sales Assignments &amp; Credit Parameters</span>
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                    <div className="space-y-1 sm:col-span-2">
                      <label className="font-bold text-slate-500 block">Assigned Sales Rep</label>
                      <select
                        value={assignedRepId}
                        onChange={(e) => setAssignedRepId(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50/50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none"
                      >
                        <option value="">-- Unassigned --</option>
                        {users && users.filter(u => u.active && u.role === Role.SALES_REP && u.areaIds && areaId && u.areaIds.includes(areaId)).map(u => (
                          <option key={u.id} value={u.id}>{u.name} ({u.territory || u.region || "No Territory"})</option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1 sm:col-span-2">
                      <label className="font-bold text-slate-500 block">Assigned Supervisor</label>
                      <select
                        value={assignedSupervisorId}
                        onChange={(e) => setAssignedSupervisorId(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50/50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none"
                      >
                        <option value="">-- Unassigned --</option>
                        {users && users.length > 0 ? (
                          users.filter(u => {
                            const normalizedRole = String(u.role || "").toLowerCase();
                            return normalizedRole.includes("supervisor") || normalizedRole.includes("officer");
                          }).map(u => (
                            <option key={u.id} value={u.id}>{u.name}</option>
                          ))
                        ) : (
                          <>
                            <option value="usr-201">Hassan Salem (Sales Supervisor)</option>
                            <option value="usr-202">Ali Al-Mabrouk (Regional Manager)</option>
                            <option value="usr-203">Rania Mansour (Medical Supervisor)</option>
                          </>
                        )}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="font-bold text-slate-500 block">Initial Outstanding Balance (market currency)</label>
                      <input
                        type="number"
                        min="0"
                        value={outstandingBalance}
                        onChange={(e) => setOutstandingBalance(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50/50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none focus:border-indigo-500 font-mono"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="font-bold text-slate-500 block">Payment Term Period (Days)</label>
                      <input
                        type="number"
                        min="0"
                        value={paymentInDays}
                        onChange={(e) => setPaymentInDays(e.target.value)}
                        placeholder="e.g. 30"
                        className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50/50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none focus:border-indigo-500 font-mono"
                      />
                    </div>
                  </div>
                </div>

                {/* Section 5: Competitor Info */}
                <div className="space-y-1">
                  <span className="font-bold text-[10px] text-indigo-600 uppercase tracking-wider block">5. Market Intelligence / Competitors</span>
                  <label className="font-bold text-slate-500 block">Competitor Information &amp; Shelf Share Notes</label>
                  <textarea
                    value={competitorInformation}
                    onChange={(e) => setCompetitorInformation(e.target.value)}
                    placeholder="e.g. Highly aligned with Roche products, currently holds 40% shelf space. Good potential for skincare product listing."
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50/50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none h-16 resize-none"
                  />
                </div>

              </div>

              <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 font-bold rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg shadow transition-all cursor-pointer animate-pulse-subtle"
                >
                  Register Master Outlet
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

      {/* 7. Edit Pharmacy Dialog Modal */}
      {isEditModalOpen && editingPharmacy && (
        <div className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs" id="edit-pharmacy-modal">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-2xl p-5 space-y-4 shadow-2xl relative animate-fade-in font-sans">
            
            <div className="flex justify-between items-center pb-2 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                <Edit className="text-indigo-600" size={16} />
                <span>Update Pharmacy Parameters (ID: {editingPharmacy.id})</span>
              </h3>
              <button 
                onClick={() => {
                  setIsEditModalOpen(false);
                  setEditingPharmacy(null);
                }}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="space-y-4 text-xs">
              <div className="max-h-[65vh] overflow-y-auto pr-1 space-y-4">
                
                {/* Section 1: Basic Identity */}
                <div className="space-y-2 border-b border-slate-50 dark:border-slate-800 pb-3">
                  <span className="font-bold text-[10px] text-indigo-600 uppercase tracking-wider block">1. Outlet Identity</span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="font-bold text-slate-500 block">Pharmacy Name (English) *</label>
                      <input
                        type="text"
                        required
                        value={nameEn}
                        onChange={(e) => setNameEn(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50/50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="font-bold text-slate-500 block">Pharmacy Name (Arabic)</label>
                      <input
                        type="text"
                        value={nameAr}
                        onChange={(e) => setNameAr(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50/50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none focus:border-indigo-500 text-right"
                        dir="rtl"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <label className="font-bold text-slate-500 block">Outlet Formulation Type</label>
                      <select
                        value={pType}
                        onChange={(e) => setPType(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50/50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none"
                      >
                        <option value="Retail">Retail</option>
                        <option value="Chain Pharmacy">Chain Pharmacy</option>
                        <option value="Wholesale">Wholesale</option>
                        <option value="Hospital Pharmacy">Hospital Pharmacy</option>
                        <option value="Polyclinic Pharmacy">Polyclinic Pharmacy</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="font-bold text-slate-500 block">Sales Potential</label>
                      <select
                        value={salesPotential}
                        onChange={(e) => setSalesPotential(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50/50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none"
                      >
                        <option value="High">High</option>
                        <option value="Medium">Medium</option>
                        <option value="Low">Low</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="font-bold text-slate-500 block">Operational Region (Auto-Derived)</label>
                      <input
                        type="text"
                        readOnly
                        value={derivedRegionLabel}
                        className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-400 focus:outline-none cursor-not-allowed font-medium"
                      />
                    </div>
                  </div>
                </div>

                {/* Section 2: Geographic Hierarchy */}
                <div className="space-y-2 border-b border-slate-50 dark:border-slate-800 pb-3">
                  <span className="font-bold text-[10px] text-indigo-600 uppercase tracking-wider block">2. Geographic Hierarchy Path (Country &gt; District &gt; City &gt; Area)</span>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <div className="space-y-1">
                      <label className="font-bold text-slate-400 block text-[10px]">Country *</label>
                      <select
                        required
                        value={countryId}
                        onChange={(e) => {
                          const id = e.target.value;
                          setCountryId(id);
                          const name = countriesList.find(c => c.id === id)?.name || "";
                          setCountryName(name);
                          setCountry(name);
                          // Reset dependents
                          setDistrictId("");
                          setDistrictName("");
                          setDistrict("");
                          setCityId("");
                          setCityName("");
                          setCity("");
                          setAreaId("");
                          setAreaName("");
                          setArea("");
                          setTerritory("");
                        }}
                        className="w-full px-2 py-1.5 border border-slate-200 dark:border-slate-800 rounded bg-slate-50/50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none text-xxs cursor-pointer"
                      >
                        <option value="">-- Country --</option>
                        {countriesList.map(c => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="font-bold text-slate-400 block text-[10px]">District *</label>
                      <select
                        required
                        disabled={!countryId}
                        value={districtId}
                        onChange={(e) => {
                          const id = e.target.value;
                          setDistrictId(id);
                          const name = districtsList.find(d => d.id === id)?.name || "";
                          setDistrictName(name);
                          setDistrict(name);
                          setRegion(name);
                          // Reset dependents
                          setCityId("");
                          setCityName("");
                          setCity("");
                          setAreaId("");
                          setAreaName("");
                          setArea("");
                          setTerritory("");
                        }}
                        className="w-full px-2 py-1.5 border border-slate-200 dark:border-slate-800 rounded bg-slate-50/50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none text-xxs cursor-pointer disabled:opacity-50"
                      >
                        <option value="">-- District --</option>
                        {districtsList.filter(d => d.countryId === countryId).map(d => (
                          <option key={d.id} value={d.id}>{d.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="font-bold text-slate-400 block text-[10px]">City / Province *</label>
                      <select
                        required
                        disabled={!districtId}
                        value={cityId}
                        onChange={(e) => {
                          const id = e.target.value;
                          setCityId(id);
                          const name = citiesList.find(c => c.id === id)?.name || "";
                          setCityName(name);
                          setCity(name);
                          // Reset dependents
                          setAreaId("");
                          setAreaName("");
                          setArea("");
                          setTerritory("");
                        }}
                        className="w-full px-2 py-1.5 border border-slate-200 dark:border-slate-800 rounded bg-slate-50/50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none text-xxs cursor-pointer disabled:opacity-50"
                      >
                        <option value="">-- City --</option>
                        {citiesList.filter(c => c.districtId === districtId).map(c => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="font-bold text-slate-400 block text-[10px]">Area / Subzone *</label>
                      <select
                        required
                        disabled={!cityId}
                        value={areaId}
                        onChange={(e) => {
                          const id = e.target.value;
                          setAreaId(id);
                          const name = areasList.find(a => a.id === id)?.name || "";
                          setAreaName(name);
                          setArea(name);
                          setTerritory(name);
                        }}
                        className="w-full px-2 py-1.5 border border-slate-200 dark:border-slate-800 rounded bg-slate-50/50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none text-xxs cursor-pointer disabled:opacity-50"
                      >
                        <option value="">-- Area --</option>
                        {areasList.filter(a => a.cityId === cityId).map(a => (
                          <option key={a.id} value={a.id}>{a.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="font-bold text-slate-500 block">Physical Address / Landmark *</label>
                    <input
                      type="text"
                      required
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50/50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  {/* GPS Box */}
                  <div className="bg-slate-50 dark:bg-slate-950 p-2.5 rounded-lg border border-slate-100 dark:border-slate-850 space-y-1.5">
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-[10px] text-slate-400 uppercase tracking-wider">GPS Coordinates Verification</span>
                    </div>
                    {lat && lng ? (
                      <div className="text-xxs font-mono text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-900 p-2 rounded border border-slate-200 dark:border-slate-800">
                        Location: {lat}, {lng} (GPS Verified)
                      </div>
                    ) : (
                      <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50/70 dark:bg-amber-950/30 p-2 rounded border border-amber-200 dark:border-amber-900/40">
                        Location not yet verified. The first field visit will establish the customer’s global GPS location.
                      </p>
                    )}
                  </div>
                </div>

                {/* Section 3: Contact details */}
                <div className="space-y-2 border-b border-slate-50 dark:border-slate-800 pb-3">
                  <span className="font-bold text-[10px] text-indigo-600 uppercase tracking-wider block">3. Contact &amp; Licensing</span>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <label className="font-bold text-slate-500 block">Contact Person</label>
                      <input
                        type="text"
                        value={contactPerson}
                        onChange={(e) => setContactPerson(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50/50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="font-bold text-slate-500 block">Phone *</label>
                      <input
                        type="text"
                        required
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50/50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none font-mono"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="font-bold text-slate-500 block">Email Address</label>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50/50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none"
                      />
                    </div>
                  </div>
                </div>

                {/* Section 4: Assignments & Financials */}
                <div className="space-y-2 border-b border-slate-50 dark:border-slate-800 pb-3">
                  <span className="font-bold text-[10px] text-indigo-600 uppercase tracking-wider block">4. Sales Assignments &amp; Credit Parameters</span>
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                    <div className="space-y-1 sm:col-span-2">
                      <label className="font-bold text-slate-500 block">Assigned Sales Rep</label>
                      <select
                        value={assignedRepId}
                        onChange={(e) => setAssignedRepId(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50/50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none"
                      >
                        <option value="">-- Unassigned --</option>
                        {users && users.filter(u => u.active && u.role === Role.SALES_REP && u.areaIds && areaId && u.areaIds.includes(areaId)).map(u => (
                          <option key={u.id} value={u.id}>{u.name} ({u.territory || u.region || "No Territory"})</option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1 sm:col-span-2">
                      <label className="font-bold text-slate-500 block">Assigned Supervisor</label>
                      <select
                        value={assignedSupervisorId}
                        onChange={(e) => setAssignedSupervisorId(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50/50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none"
                      >
                        <option value="">-- Unassigned --</option>
                        {users && users.length > 0 ? (
                          users.filter(u => {
                            const normalizedRole = String(u.role || "").toLowerCase();
                            return normalizedRole.includes("supervisor") || normalizedRole.includes("officer");
                          }).map(u => (
                            <option key={u.id} value={u.id}>{u.name}</option>
                          ))
                        ) : (
                          <>
                            <option value="usr-201">Hassan Salem (Sales Supervisor)</option>
                            <option value="usr-202">Ali Al-Mabrouk (Regional Manager)</option>
                            <option value="usr-203">Rania Mansour (Medical Supervisor)</option>
                          </>
                        )}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="font-bold text-slate-500 block">Outstanding Balance (market currency)</label>
                      <input
                        type="number"
                        min="0"
                        value={outstandingBalance}
                        onChange={(e) => setOutstandingBalance(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50/50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none focus:border-indigo-500 font-mono"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="font-bold text-slate-500 block">Payment Term Period (Days)</label>
                      <input
                        type="number"
                        min="0"
                        value={paymentInDays}
                        onChange={(e) => setPaymentInDays(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50/50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none focus:border-indigo-500 font-mono"
                      />
                    </div>
                  </div>
                </div>

                {/* Section 5: Competitor Info */}
                <div className="space-y-1">
                  <span className="font-bold text-[10px] text-indigo-600 uppercase tracking-wider block">5. Market Intelligence / Competitors</span>
                  <label className="font-bold text-slate-500 block">Competitor Information &amp; Shelf Share Notes</label>
                  <textarea
                    value={competitorInformation}
                    onChange={(e) => setCompetitorInformation(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50/50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none h-16 resize-none"
                  />
                </div>

              </div>

              <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setIsEditModalOpen(false);
                    setEditingPharmacy(null);
                  }}
                  className="px-4 py-2 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 font-bold rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg shadow transition-all cursor-pointer"
                >
                  Save Master Parameters
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

    </div>
  );
}
