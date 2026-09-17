import React, { useState, useEffect, useRef } from "react";
import { 
  Search, 
  Plus, 
  Stethoscope, 
  MapPin, 
  Sparkles, 
  Filter, 
  Check, 
  X,
  PlusCircle,
  Eye,
  Calendar,
  MoreHorizontal,
  Download,
  Grid,
  List,
  Star,
  User,
  Beaker,
  Box,
  Users,
  Tag,
  Pencil,
  Activity,
  Ban,
  Trash2,
  AlertTriangle,
  ArrowUpRight
} from "lucide-react";
import { Physician, User as UserType, Role, Country, District, City, Area, PhysicianSpecialty } from "../types";
import { useSpecialties, initializeSpecialtyRegistry } from "../utils/specialtyService";
import PhysicianSpecialtySelector from "./PhysicianSpecialtySelector";
import { mapRecordForExport, TemplateSchemas } from "../lib/schemaEngine";
import { applySecurityScope, getCurrentUserScope, getGlobalUserTerritoryAssignments, getGlobalUserProductAssignments, isUserOperational } from "../lib/securityEngine";
import { resolveRecordGeography } from "../utils/importNormalization";
import Pagination from "./Pagination";
import MobileCardList from "./MobileCardList";
import TruncatedText from "./TruncatedText";
import NoDataState from "./NoDataState";
import { collection, onSnapshot, doc, setDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import {
  getCanonicalPhysicianProductSelection,
  persistPhysicianBeforeSuccess,
  resolvePhysicianOperationalAssignment,
  toggleCanonicalProductSelection
} from "../lib/physicianAlignmentUi";
import { deriveEligibleProducts } from "../lib/productAssignmentService";
import {
  resolveCanonicalPhysicianAlignedProducts,
  resolveCanonicalVisitProductName
} from "../lib/canonicalVisitDisplay";
import type { ScopedPhysicianVisitSummary } from "../lib/physicianVisitHistoryClient";
import SupervisorVisitHistory from "./supervision/SupervisorVisitHistory";

interface PhysicianListProps {
  currentUser: UserType;
  physicians: Physician[];
  onAddPhysician: (physician: Physician) => Promise<void>;
  onUpdatePhysician?: (physician: Physician) => Promise<void>;
  onDeletePhysician?: (id: string) => void;
  lang: "en" | "ar";
  users?: UserType[];
  products?: any[];
  productPromotionGroups?: any[];
  userTerritoryAssignments?: any[];
  userProductAssignments?: any[];
  physicianVisits?: any[];
  physicianVisitSummaries?: Map<string, ScopedPhysicianVisitSummary>;
  physicianVisitSummaryStatus?: "IDLE" | "LOADING" | "READY" | "ERROR";
  loadScopedPhysicianHistory?: (physicianId: string, subjectUid?: string) => Promise<ScopedPhysicianVisitSummary>;
  onViewVisitSummary?: (visit: any) => void;
  isOperational?: boolean;
  operationalReport?: { status: string; reasons: string[] };
}

// Structured mock data representing the exact Libyan physicians shown in screenshots
const SCREENSHOT_PHYSICIANS: Physician[] = [
  {
    id: "PHY-001",
    name: "Dr. Jamila Allafy",
    nameAr: "جميلة اللافي",
    specialty: "GP-DERMA",
    classification: "B",
    region: "East",
    territory: "Sabha Sabha East Zone",
    latitude: 27.0377,
    longitude: 14.4278,
    lastVisitDate: "6/18/2026",
    address: "CENTRE FEZZAN AL-TIBBI"
  },
  {
    id: "PHY-002",
    name: "Dr. ABDUL BARI AL MANIFI",
    nameAr: "عبد الباري المنفي",
    specialty: "DERMA - GP",
    classification: "A",
    region: "East",
    territory: "Venecia Benghazi West zone",
    latitude: 32.1158,
    longitude: 20.0739,
    lastVisitDate: "5/2/2026",
    address: "H2O CLINIC / AL-MAA AL-SHAFI"
  },
  {
    id: "PHY-003",
    name: "Dr. ABDUL HAMID AL ARFI",
    nameAr: "عبد الحميد العرفي",
    specialty: "DERMA - GP",
    classification: "A",
    region: "East",
    territory: "Hay Al-Dolar Benghazi East zone",
    latitude: 32.1145,
    longitude: 20.0811,
    lastVisitDate: "5/14/2026",
    address: "AL-HARAM NEW MEDICAL CLINIC"
  },
  {
    id: "PHY-004",
    name: "Dr. ABDUL HAMID AL SENUSSI",
    nameAr: "عبد الحميد السنوسي",
    specialty: "DERMA - GP",
    classification: "B",
    region: "East",
    territory: "Hay Al-Dolar Benghazi East zone",
    latitude: 32.1129,
    longitude: 20.0850,
    lastVisitDate: "6/25/2026",
    address: "ALTAREK HOSPITAL"
  },
  {
    id: "PHY-005",
    name: "Dr. ABDUL SAMI AL ZAWI",
    nameAr: "عبد السميع الزاوي",
    specialty: "DERMA - GP",
    classification: "A",
    region: "East",
    territory: "Venecia Benghazi West zone",
    latitude: 32.1190,
    longitude: 20.0760,
    lastVisitDate: "6/23/2026",
    address: "LIBYAN INTERNATIONAL HOSPITAL"
  },
  {
    id: "PHY-006",
    name: "Dr. AREEJ AL SENUSSI",
    nameAr: "أريج السنوسي",
    specialty: "DERMA - GP",
    classification: "B",
    region: "East",
    territory: "Benghazi West Zone",
    latitude: 32.1220,
    longitude: 20.0780,
    lastVisitDate: "6/21/2026",
    address: "BENGHAZI MEDICAL CENTER"
  }
];

export default function PhysicianList({
  currentUser,
  physicians = [],
  onAddPhysician,
  onUpdatePhysician,
  onDeletePhysician,
  lang,
  users = [],
  products = [],
  productPromotionGroups = [],
  userTerritoryAssignments = [],
  userProductAssignments = [],
  physicianVisits = [],
  physicianVisitSummaries = new Map(),
  physicianVisitSummaryStatus = "IDLE",
  loadScopedPhysicianHistory,
  onViewVisitSummary,
  isOperational,
  operationalReport
}: PhysicianListProps) {
  const createMutationKeyRef = useRef(crypto.randomUUID());
  const isRtl = lang === "ar";
  const [searchTerm, setSearchTerm] = useState("");
  const [isListView, setIsListView] = useState(true); // Default to table/list view as in screenshot
  const [isFiltersDrawerOpen, setIsFiltersDrawerOpen] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  
  // Track action dropdown state, deactivation and deletion locally
  const [activeDropdownId, setActiveDropdownId] = useState<string | null>(null);
  const [deactivatedPhysicianIds, setDeactivatedPhysicianIds] = useState<string[]>([]);
  const [deletedPhysicianIds, setDeletedPhysicianIds] = useState<string[]>([]);
  
  // Selected physician for detailed overview modal
  const [selectedPhysician, setSelectedPhysician] = useState<Physician | null>(null);
  const [modalActiveTab, setModalActiveTab] = useState<"overview" | "visits" | "samples" | "products" | "supervisor">("overview");
  const [selectedVisitSummary, setSelectedVisitSummary] = useState<ScopedPhysicianVisitSummary | null>(null);
  const [selectedVisitHistoryStatus, setSelectedVisitHistoryStatus] = useState<"IDLE" | "LOADING" | "READY" | "ERROR">("IDLE");

  const selectedVisits = React.useMemo(() => {
    return selectedVisitSummary?.visits || [];
  }, [selectedVisitSummary]);

  useEffect(() => {
    setSelectedVisitSummary(null);
    setSelectedVisitHistoryStatus(selectedPhysician ? "LOADING" : "IDLE");
    if (!selectedPhysician || !loadScopedPhysicianHistory) return;
    let cancelled = false;
    void loadScopedPhysicianHistory(selectedPhysician.id)
      .then((summary) => {
        if (cancelled) return;
        setSelectedVisitSummary(summary);
        setSelectedVisitHistoryStatus("READY");
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("[PhysicianList] Scoped physician history failed:", error);
        setSelectedVisitHistoryStatus("ERROR");
      });
    return () => { cancelled = true; };
  }, [loadScopedPhysicianHistory, selectedPhysician]);

  const scopedLastVisitLabel = (physicianId: string): string => {
    if (physicianVisitSummaryStatus !== "READY") return physicianVisitSummaryStatus === "ERROR" ? "Unavailable" : "Loading…";
    return physicianVisitSummaries.get(physicianId)?.lastVisit?.visitDate || "Never";
  };

  const [editingPhysician, setEditingPhysician] = useState<Physician | null>(null);

  // Form states for adding/editing physician
  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [specialty, setSpecialty] = useState("DERMA - GP");
  const { specialties: specialtiesList, loading: isSpecialtiesLoading, status: specialtiesStatus, errorMessage: specialtiesErrorMessage } = useSpecialties();
  const [showAddSpecialtyInline, setShowAddSpecialtyInline] = useState(false);
  const [newSpecialtyNameEn, setNewSpecialtyNameEn] = useState("");
  const [newSpecialtyNameAr, setNewSpecialtyNameAr] = useState("");
  const [specialtySearchQuery, setSpecialtySearchQuery] = useState("");
  const [isSpecialtyDropdownOpen, setIsSpecialtyDropdownOpen] = useState(false);
  const [classification, setClassification] = useState<"A" | "B" | "C">("B");
  const [region, setRegion] = useState("East");
  const [territory, setTerritory] = useState("");
  const [address, setAddress] = useState("");
  const [lat, setLat] = useState("32.11");
  const [lng, setLng] = useState("20.07");
  const [formError, setFormError] = useState("");
  const [isSavingPhysician, setIsSavingPhysician] = useState(false);

  // New schema fields:
  const [country, setCountry] = useState("Libya");
  const [district, setDistrict] = useState("Benghazi");
  const [city, setCity] = useState("Benghazi");
  const [area, setArea] = useState("");
  const [countryId, setCountryId] = useState("");
  const [countryName, setCountryName] = useState("");
  const [districtId, setDistrictId] = useState("");
  const [districtName, setDistrictName] = useState("");
  const [cityId, setCityId] = useState("");
  const [cityName, setCityName] = useState("");
  const [areaId, setAreaId] = useState("");
  const [areaName, setAreaName] = useState("");

  const canRegisterSpecialty = React.useMemo(() => {
    if (!currentUser) return false;
    const r = currentUser.role;
    return (
      r === Role.SUPER_ADMIN ||
      r === Role.ADMIN ||
      r === Role.MEDICAL_MANAGER ||
      r === Role.PRODUCT_MANAGER
    );
  }, [currentUser]);

  const filteredSpecialtiesForForm = React.useMemo(() => {
    if (!specialtySearchQuery) return specialtiesList;
    const lower = specialtySearchQuery.toLowerCase();
    return specialtiesList.filter(s => 
      s.name.toLowerCase().includes(lower) || 
      (s.nameAr && s.nameAr.toLowerCase().includes(lower))
    );
  }, [specialtiesList, specialtySearchQuery]);

  const handleAddNewSpecialty = async () => {
    const cleanEn = newSpecialtyNameEn.trim();
    const cleanAr = newSpecialtyNameAr.trim();
    if (!cleanEn) return;

    const upperName = cleanEn.toUpperCase();
    const upperAr = cleanAr.toUpperCase();
    
    // Check duplication (prevent case difference or duplicate alias)
    const exists = specialtiesList.some(s => 
      s.normalizedName === upperName || 
      s.name.toUpperCase() === upperName ||
      (s.aliases && s.aliases.some(a => a.toUpperCase() === upperName)) ||
      (s.nameAr && s.nameAr.toUpperCase() === upperAr) ||
      (cleanAr && s.nameAr && s.nameAr.trim().toUpperCase() === upperAr)
    );
    if (exists) {
      alert("Specialty already exists in the register!");
      return;
    }

    const safeSlug = cleanEn.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/(^_+|_+$)/g, "");
    const newId = "spec_" + (safeSlug || Date.now().toString());
    const newSpec: PhysicianSpecialty = {
      id: newId,
      name: cleanEn,
      nameAr: cleanAr || undefined,
      normalizedName: upperName,
      aliases: [upperName],
      isActive: true,
      createdAt: new Date().toISOString(),
      createdBy: currentUser?.id || "system",
      source: "manual"
    } as any;

    try {
      await setDoc(doc(db, "physicianSpecialties", newId), newSpec);
      // Automatically select it
      setSpecialty(cleanEn);
      // Reset inputs
      setNewSpecialtyNameEn("");
      setNewSpecialtyNameAr("");
      setShowAddSpecialtyInline(false);
    } catch (e) {
      console.error("Failed to add specialty:", e);
      alert("Failed to add specialty");
    }
  };

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

    const unsubPromotionGroups = onSnapshot(collection(db, "productPromotionGroups"), (snap) => {
      const docs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setPromotionGroups(docs.filter((d: any) => d.isActive !== false));
    }, (err) => {
      console.error(err);
      setPromotionGroups([]);
    });

    return () => {
      unsubCountries();
      unsubDistricts();
      unsubCities();
      unsubAreas();
      unsubPromotionGroups();
    };
  }, []);

  const [segment, setSegment] = useState("B");
  const [keyOpinionLeader, setKeyOpinionLeader] = useState<"Yes" | "No">("No");
  const [targetFrequency, setTargetFrequency] = useState(4);
  const [clinic, setClinic] = useState("");
  const [sector, setSector] = useState<"Private" | "Public" | "NGO" | "Military">("Private");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [assignedRepId, setAssignedRepId] = useState("");
  const [assignedSupervisorId, setAssignedSupervisorId] = useState("");
  const [assignedManagerId, setAssignedManagerId] = useState("");
  const [alignedProductIds, setAlignedProductIds] = useState<string[]>([]);
  const [primaryBrand, setPrimaryBrand] = useState("");
  const [targetBrands, setTargetBrands] = useState<string[]>([]);
  const [promotionGroups, setPromotionGroups] = useState<any[]>([]);

  const selectedPrimaryPromotionGroupId = React.useMemo(
    () => primaryBrand || "",
    [primaryBrand]
  );
  const selectedTargetPromotionGroupIds = React.useMemo(
    () => targetBrands.filter(Boolean),
    [targetBrands]
  );
  const physicianEligibleProducts = React.useMemo(() => deriveEligibleProducts({
    products: products || [],
    primaryPromotionGroupId: selectedPrimaryPromotionGroupId || null,
    targetPromotionGroupIds: selectedTargetPromotionGroupIds
  }), [products, selectedPrimaryPromotionGroupId, selectedTargetPromotionGroupIds]);
  const assignmentResolution = React.useMemo(() => resolvePhysicianOperationalAssignment({
    areaId,
    alignedProductIds,
    requestedRepId: assignedRepId || undefined,
    users,
    userTerritoryAssignments,
    userProductAssignments
  }), [areaId, alignedProductIds, assignedRepId, users, userTerritoryAssignments, userProductAssignments]);

  React.useEffect(() => {
    const resolvedRepId = assignmentResolution.assignedRepId || "";
    const resolvedSupervisorId = assignmentResolution.assignedSupervisorId || "";
    const resolvedManagerId = assignmentResolution.assignedManagerId || "";
    if (assignedRepId !== resolvedRepId) setAssignedRepId(resolvedRepId);
    if (assignedSupervisorId !== resolvedSupervisorId) setAssignedSupervisorId(resolvedSupervisorId);
    if (assignedManagerId !== resolvedManagerId) setAssignedManagerId(resolvedManagerId);
  }, [assignmentResolution, assignedRepId, assignedSupervisorId, assignedManagerId]);

  const getFullGeoPath = (phys: Physician) => {
    const resolved = resolveRecordGeography(phys, areasList);
    return `${resolved.countryName} > ${resolved.districtName} > ${resolved.cityName} > ${resolved.areaName}`;
  };

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(6);

  // Merge default list with screenshot list to guarantee the screenshots look exactly correct
  const displayPhysicians = React.useMemo(() => {
    const enableMockData = import.meta.env.DEV && import.meta.env.VITE_ENABLE_MOCK_DATA === "true";
    const combined = enableMockData ? [...SCREENSHOT_PHYSICIANS] : [];
    // Add custom added ones that aren't already there
    (physicians || []).forEach(p => {
      if (!combined.some(c => c.id === p.id || c.name.toLowerCase() === p.name.toLowerCase())) {
        combined.push(p);
      }
    });
    // Filter out deleted IDs
    const finalRecords = combined.filter(p => !deletedPhysicianIds.includes(p.id));

    return finalRecords;
  }, [physicians, deletedPhysicianIds]);

  // Handle Search & Filter state
  const [selectedTerritoryFilter, setSelectedTerritoryFilter] = useState("All");
  const [selectedCityFilter, setSelectedCityFilter] = useState("All");
  const [selectedAreaFilter, setSelectedAreaFilter] = useState("All");
  const [selectedRepFilter, setSelectedRepFilter] = useState("All");
  const [selectedSpecialtyFilter, setSelectedSpecialtyFilter] = useState("All");
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState("All");
  const [selectedSectorFilter, setSelectedSectorFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState<"Active" | "Inactive" | "All">("Active");

  // Reset pagination when search term or filters change
  React.useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedTerritoryFilter, selectedCityFilter, selectedAreaFilter, selectedRepFilter, selectedSpecialtyFilter, selectedCategoryFilter, selectedSectorFilter, statusFilter]);

  // Filtered list
  const filteredPhysicians = displayPhysicians.filter(phys => {
    const sTerm = searchTerm.toLowerCase().trim();
    const matchesSearch = !sTerm ||
                          phys.name.toLowerCase().includes(sTerm) || 
                          (phys.nameAr && phys.nameAr.toLowerCase().includes(sTerm)) ||
                          phys.id.toLowerCase().includes(sTerm) ||
                          phys.specialty.toLowerCase().includes(sTerm) ||
                          (phys.area && phys.area.toLowerCase().includes(sTerm)) ||
                          phys.territory.toLowerCase().includes(sTerm) ||
                          phys.address.toLowerCase().includes(sTerm);
    
    const matchesCategory = selectedCategoryFilter === "All" || phys.classification === selectedCategoryFilter;
    const matchesSpecialty = selectedSpecialtyFilter === "All" || phys.specialty.includes(selectedSpecialtyFilter);
    const matchesTerritory = selectedTerritoryFilter === "All" || phys.territory.toLowerCase().includes(selectedTerritoryFilter.toLowerCase());

    const isDeactivated = deactivatedPhysicianIds.includes(phys.id);
    const matchesStatus = statusFilter === "All" || 
                          (statusFilter === "Active" && !isDeactivated) || 
                          (statusFilter === "Inactive" && isDeactivated);

    return matchesSearch && matchesCategory && matchesSpecialty && matchesTerritory && matchesStatus;
  });

  // Diagnostic logging for Physician Display Pipeline
  React.useEffect(() => {
    const inputPhysicianIds = physicians ? physicians.map(p => p.id) : [];
    const eligibilityPassedIds = displayPhysicians.map(p => p.id);
    const eligibilityRejectedIds = inputPhysicianIds.filter(id => !eligibilityPassedIds.includes(id));
    const finalDisplayedIds = filteredPhysicians.map(p => p.id);

    console.info(
      "[PHYSICIAN_PROP_FINAL_COMPONENT_JSON]",
      JSON.stringify({
        componentName: "PhysicianList",
        receivedPhysicianCount: Array.isArray(physicians) ? physicians.length : 0,
        receivedPhysicianIds: inputPhysicianIds,
        displayPhysicianCount: displayPhysicians.length,
        filteredPhysicianCount: filteredPhysicians.length,
        finalDisplayedIds
      })
    );

    console.info(
      "[MEDREP_PHYSICIAN_DISPLAY_PIPELINE_JSON]",
      JSON.stringify({
        inputPhysicianIds,
        eligibilityPassedIds,
        eligibilityRejectedIds,
        activeFilterValue: statusFilter,
        searchFilterValue: searchTerm,
        finalDisplayedIds
      })
    );
  }, [physicians, displayPhysicians, filteredPhysicians, statusFilter, searchTerm]);

  const totalPages = Math.ceil(filteredPhysicians.length / itemsPerPage);
  const paginatedPhysicians = filteredPhysicians.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const handleOpenDetail = (phys: Physician) => {
    setSelectedPhysician(phys);
    setModalActiveTab("overview");
  };

  const startAddPhysician = () => {
    setEditingPhysician(null);
    setNameEn("");
    setNameAr("");
    setSpecialty("DERMA - GP");
    setClassification("B");
    setRegion("East");
    setTerritory("");
    setAddress("");
    setLat("32.11");
    setLng("20.07");
    
    setSegment("B");
    setKeyOpinionLeader("No");
    setCountry("Libya");
    setDistrict("Benghazi");
    setCity("Benghazi");
    setArea("");
    setCountryId("");
    setCountryName("");
    setDistrictId("");
    setDistrictName("");
    setCityId("");
    setCityName("");
    setAreaId("");
    setAreaName("");
    setClinic("");
    setSector("Private");
    setPhone("");
    setEmail("");
    setAssignedRepId("");
    setAssignedSupervisorId("");
    setAssignedManagerId("");
    setAlignedProductIds([]);
    setPrimaryBrand("");
    setTargetBrands([]);
    setTargetFrequency(4);
    
    setFormError("");
    setIsAddModalOpen(true);
  };

  const startEditPhysician = (phys: Physician) => {
    setEditingPhysician(phys);
    setNameEn(phys.name || "");
    setNameAr(phys.nameAr || "");
    setSpecialty(phys.specialty || "DERMA - GP");
    setClassification(phys.classification || "B");
    setRegion(phys.region || "East");
    setTerritory(phys.territory || "");
    setAddress(phys.address || "");
    setLat(String(phys.latitude || "32.11"));
    setLng(String(phys.longitude || "20.07"));
    
    setSegment(phys.segment || "B");
    setKeyOpinionLeader((phys.keyOpinionLeader as "Yes" | "No") || "No");
    const resolved = resolveRecordGeography(phys, areasList);

    setCountry(resolved.countryName);
    setCountryId(resolved.countryId);
    setCountryName(resolved.countryName);

    setDistrict(resolved.districtName);
    setDistrictId(resolved.districtId);
    setDistrictName(resolved.districtName);

    setCity(resolved.cityName);
    setCityId(resolved.cityId);
    setCityName(resolved.cityName);

    setArea(resolved.areaName);
    setAreaId(resolved.areaId);
    setAreaName(resolved.areaName);
    setTerritory(resolved.areaName);

    setClinic(phys.clinic || "");
    setSector((phys.sector as "Private" | "Public" | "NGO" | "Military") || "Private");
    setPhone(phys.phone || "");
    setEmail(phys.email || "");
    setTargetFrequency(phys.targetFrequency || 4);
    setAssignedRepId(phys.assignedRepId || "");
    setAssignedSupervisorId(phys.assignedSupervisorId || "");
    setAssignedManagerId(phys.assignedManagerId || "");
    setAlignedProductIds(getCanonicalPhysicianProductSelection(phys));
    setPrimaryBrand(
      phys.primaryPromotionGroupId ||
      promotionGroups.find(group => group.name === phys.primaryBrand)?.id ||
      ""
    );
    setTargetBrands(
      (phys.targetPromotionGroupIds || []).length > 0
        ? (phys.targetPromotionGroupIds || [])
        : (phys.targetBrands || [])
            .map(name => promotionGroups.find(group => group.name === name)?.id)
            .filter((id): id is string => Boolean(id))
    );
    
    setFormError("");
    setIsAddModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");

    if (!nameEn.trim() || !specialty.trim() || !countryId || !districtId || !cityId || !areaId || !address.trim()) {
      setFormError("Please fill in all required fields (including choosing Country, District, City, and Area).");
      return;
    }
    if (!selectedPrimaryPromotionGroupId) {
      setFormError("Primary Promotion Group is required before a physician can be used for detailing.");
      return;
    }

    const safeCountryName = (countryName || "").trim();
    const safeDistrictName = (districtName || "").trim();
    const safeCityName = (cityName || "").trim();
    const safeAreaName = (areaName || "").trim() || "";
    if (!safeCountryName || !safeDistrictName || !safeCityName || !safeAreaName) { setFormError("Canonical Country, District, City, and Area names are required."); return; }

    const fullGeoPath = `${safeCountryName} / ${safeDistrictName} / ${safeCityName} / ${safeAreaName}`;

    const matchedSpec = specialtiesList.find(s => s.name === specialty.trim() || s.id === specialty.trim());

    const payload: Physician = {
      id: editingPhysician ? editingPhysician.id : `PHY-${Math.floor(100 + Math.random() * 900)}`,
      name: nameEn.trim(),
      nameAr: nameAr.trim() ? nameAr.trim() : undefined,
      specialty: matchedSpec ? matchedSpec.name : specialty.trim(),
      specialtyId: matchedSpec ? matchedSpec.id : undefined,
      specialtyName: matchedSpec ? matchedSpec.name : undefined,
      classification,
      region: safeDistrictName, // District maps to region
      territory: fullGeoPath, // Full geography path represents territory
      address: address.trim(),
      latitude: editingPhysician ? (editingPhysician.latitude ?? null) : null,
      longitude: editingPhysician ? (editingPhysician.longitude ?? null) : null,
      gpsVerified: editingPhysician ? (editingPhysician.gpsVerified ?? false) : false,
      gpsVerificationStatus: editingPhysician ? (editingPhysician.gpsVerificationStatus ?? "UNVERIFIED") : "UNVERIFIED",
      gpsVerifiedAt: editingPhysician ? (editingPhysician.gpsVerifiedAt ?? null) : null,
      gpsVerifiedBy: editingPhysician ? (editingPhysician.gpsVerifiedBy ?? null) : null,
      firstVerifiedVisitId: editingPhysician ? (editingPhysician.firstVerifiedVisitId ?? null) : null,
      lastVisitDate: editingPhysician ? editingPhysician.lastVisitDate : undefined,
      lastVisitStatus: editingPhysician ? editingPhysician.lastVisitStatus : undefined,
      
      // Template fields:
      country: safeCountryName,
      district: safeDistrictName,
      city: safeCityName,
      area: safeAreaName,
      countryId,
      countryName: safeCountryName,
      districtId,
      districtName: safeDistrictName,
      cityId,
      cityName: safeCityName,
      areaId,
      areaName: safeAreaName,
      segment,
      keyOpinionLeader,
      targetFrequency: Number(targetFrequency) || 4,
      clinic: clinic ? clinic.trim() : undefined,
      sector,
      phone: phone ? phone.trim() : undefined,
      email: email ? email.trim() : undefined,
      assignedRepId: assignmentResolution.assignedRepId,
      assignedSupervisorId: assignmentResolution.assignedSupervisorId,
      assignedManagerId: assignmentResolution.assignedManagerId,
      representativeResolutionStatus: assignmentResolution.representativeStatus,
      supervisorResolutionStatus: assignmentResolution.supervisorStatus,
      managerResolutionStatus: assignmentResolution.managerStatus,
      alignedProductIds,
      primaryPromotionGroupId: selectedPrimaryPromotionGroupId || undefined,
      targetPromotionGroupIds: selectedTargetPromotionGroupIds.length > 0 ? selectedTargetPromotionGroupIds : undefined,
    };
    if (!editingPhysician) (payload as any).creationIdempotencyKey = createMutationKeyRef.current;

    setIsSavingPhysician(true);
    try {
      const persist = editingPhysician && onUpdatePhysician ? onUpdatePhysician : onAddPhysician;
      await persistPhysicianBeforeSuccess(payload, persist, () => {
        setNameEn("");
        setNameAr("");
        setTerritory("");
        setAddress("");
        setIsAddModalOpen(false);
        setEditingPhysician(null);
        createMutationKeyRef.current = crypto.randomUUID();
      });
    } catch (error: any) {
      setFormError(error?.message || "The physician could not be saved. Your changes have been preserved.");
    } finally {
      setIsSavingPhysician(false);
    }
  };

  return (
    <div className="space-y-6 text-slate-800 dark:text-slate-100" id="physicians-hub-module">
      
      {/* Top Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4" id="physicians-hub-header">
        <div>
          <h2 className="text-2xl font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
            <Stethoscope className="text-blue-500" size={26} />
            <span>Physicians</span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mt-0.5">
            {filteredPhysicians.length} of {displayPhysicians.length} physicians
          </p>
        </div>
        <div className="flex items-center gap-3 self-start sm:self-auto">
          <button 
            className="flex items-center gap-2 px-3.5 py-2 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900 text-xs font-semibold text-slate-700 dark:text-slate-300 rounded-lg shadow-xs transition-colors cursor-pointer"
            onClick={() => {
              import("xlsx").then((XLSX) => {
                const headers = TemplateSchemas.physicians.filter(f => f.exportable).map(f => f.label);
                
                const data = [headers];
                
                filteredPhysicians.forEach(phys => {
                  const exportedObj = mapRecordForExport(phys, "physicians");
                  const row = headers.map(header => exportedObj[header] || "");
                  data.push(row);
                });
                
                const worksheet = XLSX.utils.aoa_to_sheet(data);
                const workbook = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(workbook, worksheet, "Physicians");
                
                XLSX.writeFile(workbook, `physicians_export_${new Date().toISOString().split("T")[0]}.xlsx`);
              });
            }}
          >
            <Download size={15} className="text-slate-500" />
            <span>Export Filtered</span>
          </button>
          <button
            onClick={startAddPhysician}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-lg shadow-md transition-all cursor-pointer"
            id="btn-add-physician-trigger"
          >
            <Plus size={16} />
            <span>Add Physician</span>
          </button>
        </div>
      </div>

      {/* Specialties Status Alert / Admin Seeding Action */}
      {specialtiesStatus === "permission-denied" && (
        <div className="flex items-start gap-3 p-4 bg-red-50 dark:bg-red-950/20 border border-red-100 dark:border-red-900/40 rounded-xl" id="specialties-status-error">
          <AlertTriangle className="text-red-500 shrink-0 mt-0.5" size={18} />
          <div className="space-y-1">
            <h4 className="text-xs font-bold text-red-800 dark:text-red-400">
              Firestore Access Error (Permission Denied)
            </h4>
            <p className="text-xxs text-red-600/80 dark:text-red-400/70 font-medium">
              Firestore security rules restrict reading the specialty registry. Please check database permissions.
            </p>
            <p className="text-[10px] text-red-500 font-mono">
              {"[API] GET /collection/physicianSpecialties/ -> PERMISSION_DENIED"}
            </p>
          </div>
        </div>
      )}



      {/* Filter and View Layout Controllers row */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 bg-white dark:bg-slate-950 p-3 rounded-xl border border-slate-200/60 dark:border-slate-800/80 shadow-xs">
        
        {/* Search */}
        <div className="relative flex-1" id="search-physicians-input-wrapper">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            type="text"
            placeholder="Search physicians..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-slate-50/50 dark:bg-slate-900/40 text-slate-800 dark:text-white focus:outline-none focus:border-blue-500 placeholder-slate-400"
          />
        </div>

        <div className="flex items-center gap-3 justify-between md:justify-end shrink-0">
          
          {/* Status Select */}
          <select 
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="px-3.5 py-1.5 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-300 focus:outline-none focus:border-blue-500 cursor-pointer"
          >
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
            <option value="All">All</option>
          </select>

          {/* Grid/List Layout toggle controls */}
          <div className="flex items-center border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden bg-slate-50 dark:bg-slate-900">
            <button
              onClick={() => setIsListView(false)}
              className={`p-1.5 transition-colors cursor-pointer ${!isListView ? "bg-white dark:bg-slate-800 text-blue-600 shadow-xs" : "text-slate-400 hover:text-slate-600"}`}
              title="Grid Layout"
            >
              <Grid size={15} />
            </button>
            <button
              onClick={() => setIsListView(true)}
              className={`p-1.5 transition-colors cursor-pointer ${isListView ? "bg-white dark:bg-slate-800 text-blue-600 shadow-xs" : "text-slate-400 hover:text-slate-600"}`}
              title="List Table Layout"
            >
              <List size={15} />
            </button>
          </div>

        </div>

      </div>

      {/* Filters Toggle Button as seen in Screenshot 1 */}
      <div className="flex" id="filters-toggle-row">
        <button
          onClick={() => setIsFiltersDrawerOpen(true)}
          className="flex items-center gap-2 px-4 py-2 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-850 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer shadow-xs transition-colors"
        >
          <Filter size={14} className="text-slate-500" />
          <span>Filters</span>
        </button>
      </div>

      {/* Active Filter Badges */}
      {(selectedTerritoryFilter !== "All" || selectedCategoryFilter !== "All" || selectedSpecialtyFilter !== "All") && (
        <div className="flex flex-wrap items-center gap-2 text-xxs font-semibold text-slate-500">
          <span>Active filters:</span>
          {selectedTerritoryFilter !== "All" && (
            <span className="flex items-center gap-1 bg-blue-50 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900/55 px-2.5 py-1 rounded-full text-blue-600 dark:text-blue-400">
              Zone: {selectedTerritoryFilter}
              <X size={10} className="cursor-pointer" onClick={() => setSelectedTerritoryFilter("All")} />
            </span>
          )}
          {selectedCategoryFilter !== "All" && (
            <span className="flex items-center gap-1 bg-blue-50 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900/55 px-2.5 py-1 rounded-full text-blue-600 dark:text-blue-400">
              Category: {selectedCategoryFilter}
              <X size={10} className="cursor-pointer" onClick={() => setSelectedCategoryFilter("All")} />
            </span>
          )}
          {selectedSpecialtyFilter !== "All" && (
            <span className="flex items-center gap-1 bg-blue-50 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900/55 px-2.5 py-1 rounded-full text-blue-600 dark:text-blue-400">
              Specialty: {selectedSpecialtyFilter}
              <X size={10} className="cursor-pointer" onClick={() => setSelectedSpecialtyFilter("All")} />
            </span>
          )}
          <button 
            onClick={() => {
              setSelectedTerritoryFilter("All");
              setSelectedCityFilter("All");
              setSelectedAreaFilter("All");
              setSelectedRepFilter("All");
              setSelectedSpecialtyFilter("All");
              setSelectedCategoryFilter("All");
              setSelectedSectorFilter("All");
            }}
            className="text-blue-600 dark:text-blue-400 hover:underline"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Main Physicians Display */}
      {filteredPhysicians.length > 0 ? (
        <div className="space-y-4">
          {/* Mobile Card List (Visible on mobile, hidden on desktop/tablet) */}
          <MobileCardList
            data={filteredPhysicians}
            keyExtractor={(phys: Physician) => phys.id}
            lang={lang}
            itemsPerPage={5}
            itemName={{ en: "physicians", ar: "طبيب" }}
            onAction={() => setIsAddModalOpen(true)}
            actionLabel={lang === "ar" ? "أضف طبيباً جديداً" : "Add New Physician"}
            renderItem={(phys: Physician, index: number) => {
              const isStarred = index % 5 === 1 || index % 5 === 2 || index % 5 === 4;
              const initials = phys.name.split(" ").filter(Boolean).map(w => w[0]).join("").substring(0, 2).toUpperCase();
              return (
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold text-[10px] tracking-tight shrink-0">
                        {initials}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h4 className="font-bold text-slate-900 dark:text-white text-xs flex items-center gap-1 min-w-0">
                          <TruncatedText text={phys.name} className="font-bold text-slate-900 dark:text-white text-xs" />
                          {isStarred && <Star size={11} className="fill-amber-400 text-amber-400 shrink-0" />}
                        </h4>
                        <TruncatedText text={phys.address} className="text-[10px] text-slate-400 dark:text-slate-500 block" />
                      </div>
                    </div>

                    <span className={`inline-block px-1.5 py-0.5 text-[9px] font-black rounded font-mono shrink-0 ${
                      phys.classification === "A" 
                        ? "bg-blue-600 text-white" 
                        : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
                    }`}>
                      Class {phys.classification}
                    </span>
                  </div>

                  <div className="flex justify-between items-center text-[10px] text-slate-500 dark:text-slate-400 gap-2">
                    <TruncatedText 
                      text={phys.specialty} 
                      className="bg-slate-50 dark:bg-slate-900 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide max-w-[140px]" 
                    />
                    <span className="text-[9px] font-mono text-slate-400">
                      Last Visit: <strong className="text-slate-600 dark:text-slate-300">{scopedLastVisitLabel(phys.id)}</strong>
                    </span>
                  </div>

                  {/* Actions optimized for thumb-tapping */}
                  <div className="flex items-center justify-between gap-1 pt-2.5 border-t border-slate-100 dark:border-slate-800/60 text-xxs">
                    <div className="flex items-center gap-1 text-[10px] text-slate-400 min-w-0 max-w-[200px]" title={getFullGeoPath(phys)}>
                      <MapPin size={10} className="shrink-0 text-blue-500" />
                      <TruncatedText text={getFullGeoPath(phys)} className="text-[10px] text-slate-500 font-medium" />
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => handleOpenDetail(phys)}
                        className="px-2.5 py-1 bg-slate-50 hover:bg-slate-100 dark:bg-slate-900 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 rounded font-semibold transition-all border border-slate-200/40 dark:border-slate-800 cursor-pointer"
                      >
                        Details
                      </button>
                      <button
                        onClick={() => alert(`Schedule field visit with ${phys.name}`)}
                        className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/30 dark:hover:bg-blue-900/50 text-blue-600 dark:text-blue-400 rounded font-bold transition-all cursor-pointer"
                      >
                        Visit
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`Are you sure you want to delete ${phys.name}?`)) {
                            if (onDeletePhysician) {
                              onDeletePhysician(phys.id);
                            } else {
                              setDeletedPhysicianIds(prev => [...prev, phys.id]);
                            }
                          }
                        }}
                        className="p-1 text-slate-300 hover:text-red-500 transition-colors cursor-pointer"
                        title="Delete"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            }}
          />

          {/* Desktop/Tablet View - Hidden on Mobile */}
          <div className="hidden md:block space-y-4">
            {isListView ? (
            <div className="space-y-4" id="physicians-list-table-wrapper">
              {/* Desktop View layout matching Screenshot 1 exactly */}
              <div className="bg-white dark:bg-slate-950 border border-slate-200/70 dark:border-slate-800/80 rounded-xl overflow-hidden shadow-xs" id="physicians-list-table-container">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-slate-900/70 border-b border-slate-200/60 dark:border-slate-800/80 text-slate-500 font-bold">
                        <th className="py-3 px-4 w-10">
                          <input 
                            type="checkbox" 
                            className="rounded border-slate-300 dark:border-slate-700 text-blue-600 focus:ring-blue-500" 
                            readOnly
                          />
                        </th>
                        <th className="py-3 px-4 font-bold text-slate-600 dark:text-slate-300">Name</th>
                        <th className="py-3 px-4 font-bold text-slate-600 dark:text-slate-300">Specialty</th>
                        <th className="py-3 px-4 font-bold text-slate-600 dark:text-slate-300">Clinic</th>
                        <th className="py-3 px-4 font-bold text-slate-600 dark:text-slate-300">Geographic Path (Territory)</th>
                        <th className="py-3 px-4 font-bold text-slate-600 dark:text-slate-300 text-center">Category</th>
                        <th className="py-3 px-4 font-bold text-slate-600 dark:text-slate-300">Last Visit</th>
                        <th className="py-3 px-4 font-bold text-slate-600 dark:text-slate-300 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                      {paginatedPhysicians.map((phys, index) => {
                        // Star rating mockup based on the screenshot (some doctors have stars!)
                        const isStarred = index === 1 || index === 2 || index === 4;
                        return (
                          <tr 
                            key={phys.id} 
                            className="hover:bg-slate-50/50 dark:hover:bg-slate-900/20 transition-colors"
                            id={`row-physician-${phys.id}`}
                          >
                            <td className="py-3.5 px-4">
                              <input 
                                type="checkbox" 
                                className="rounded border-slate-300 dark:border-slate-700 text-blue-600 focus:ring-blue-500" 
                                readOnly
                              />
                            </td>
                            <td className="py-3.5 px-4 font-medium text-slate-900 dark:text-white">
                              <div className="flex items-center gap-2">
                                <span>{phys.name} {phys.nameAr && <span className="text-slate-400 dark:text-slate-500 font-sans text-xs"> {phys.nameAr}</span>}</span>
                                {isStarred && <Star size={13} className="fill-amber-400 text-amber-400 shrink-0" />}
                                {phys.isTestData && (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-400 border border-rose-200 dark:border-rose-900/40">
                                    UAT
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-3.5 px-4">
                              <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-slate-50 dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800/80 rounded-md text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider font-mono">
                                <Stethoscope size={10} className="text-slate-400" />
                                {phys.specialty}
                              </span>
                            </td>
                            <td className="py-3.5 px-4 text-slate-600 dark:text-slate-300 font-medium">
                              {phys.address}
                            </td>
                            <td className="py-3.5 px-4 text-slate-500 dark:text-slate-400" title={getFullGeoPath(phys)}>
                              <div className="flex items-center gap-1.5">
                                <MapPin size={12} className="text-blue-500 shrink-0" />
                                <span className="font-semibold text-slate-700 dark:text-slate-300 truncate max-w-[220px]">
                                  {getFullGeoPath(phys)}
                                </span>
                              </div>
                            </td>
                            <td className="py-3.5 px-4 text-center">
                              <span className={`inline-flex items-center justify-center w-6 h-6 rounded-md text-xs font-black font-mono ${
                                phys.classification === "A" 
                                  ? "bg-blue-600 text-white" 
                                  : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                              }`}>
                                {phys.classification}
                              </span>
                            </td>
                            <td className="py-3.5 px-4 font-mono text-slate-600 dark:text-slate-300 font-semibold">
                              {scopedLastVisitLabel(phys.id)}
                            </td>
                            <td className="py-3.5 px-4 text-right relative">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  onClick={() => handleOpenDetail(phys)}
                                  className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-md transition-colors cursor-pointer"
                                  title="View Profile Details"
                                >
                                  <Eye size={14} />
                                </button>
                                <button
                                  onClick={() => alert(`Schedule field visit with ${phys.name}`)}
                                  className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-md transition-colors cursor-pointer"
                                  title="Schedule Visit"
                                >
                                  <Calendar size={14} />
                                </button>
                                <div className="relative">
                                  <button
                                    onClick={() => setActiveDropdownId(activeDropdownId === phys.id ? null : phys.id)}
                                    className={`p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md transition-colors cursor-pointer ${
                                      activeDropdownId === phys.id ? "bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white" : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                                    }`}
                                  >
                                    <MoreHorizontal size={14} />
                                  </button>
                                  
                                  {activeDropdownId === phys.id && (
                                    <>
                                      <div 
                                        className="fixed inset-0 z-40" 
                                        onClick={() => setActiveDropdownId(null)}
                                      />
                                      <div className="absolute right-0 mt-1 w-36 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-lg py-1 z-50 text-left animate-fade-in">
                                        <button
                                          onClick={() => {
                                            setActiveDropdownId(null);
                                            startEditPhysician(phys);
                                          }}
                                          className="w-full px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-2 cursor-pointer transition-colors"
                                        >
                                          <Pencil size={12} className="text-slate-400" />
                                          <span>Edit</span>
                                        </button>
                                        <button
                                          onClick={() => {
                                            setActiveDropdownId(null);
                                            const isDeactivated = deactivatedPhysicianIds.includes(phys.id);
                                            if (isDeactivated) {
                                              setDeactivatedPhysicianIds(prev => prev.filter(id => id !== phys.id));
                                              alert(`Activated ${phys.name}`);
                                            } else {
                                              setDeactivatedPhysicianIds(prev => [...prev, phys.id]);
                                              alert(`Deactivated ${phys.name}`);
                                            }
                                          }}
                                          className="w-full px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-2 cursor-pointer transition-colors"
                                        >
                                          <Ban size={12} className="text-slate-400" />
                                          <span>{deactivatedPhysicianIds.includes(phys.id) ? "Activate" : "Deactivate"}</span>
                                        </button>
                                        <div className="border-t border-slate-100 dark:border-slate-800 my-1"></div>
                                        <button
                                          onClick={() => {
                                            setActiveDropdownId(null);
                                            if (confirm(`Are you sure you want to delete ${phys.name}?`)) {
                                              if (onDeletePhysician) {
                                                onDeletePhysician(phys.id);
                                              } else {
                                                setDeletedPhysicianIds(prev => [...prev, phys.id]);
                                              }
                                            }
                                          }}
                                          className="w-full px-3 py-2 text-xs font-bold text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 flex items-center gap-2 cursor-pointer transition-colors"
                                        >
                                          <Trash2 size={12} />
                                          <span>Delete</span>
                                        </button>
                                      </div>
                                    </>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
            /* Grid View layout utilizing paginated list */
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" id="physicians-grid-container">
              {paginatedPhysicians.map((phys, index) => {
                const isStarred = index === 1 || index === 2 || index === 4;
                return (
                  <div 
                    key={phys.id} 
                    className="bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800/80 rounded-xl p-5 shadow-xs flex flex-col justify-between hover:border-blue-500/50 transition-colors relative"
                    id={`physician-card-${phys.id}`}
                  >
                    <div className="space-y-3">
                      
                      <div className="flex justify-between items-start gap-2">
                        <div className="flex flex-col min-w-0">
                          <h3 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-1.5 truncate">
                            <span>{phys.name}</span>
                            {isStarred && <Star size={12} className="fill-amber-400 text-amber-400 shrink-0" />}
                            {phys.isTestData && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-400 border border-rose-200 dark:border-rose-900/40">
                                UAT
                              </span>
                            )}
                          </h3>
                          {phys.nameAr && (
                            <p className="text-xxs font-medium text-slate-400 dark:text-slate-500">
                              {phys.nameAr}
                            </p>
                          )}
                        </div>
                        <span className={`text-[10px] px-2 py-0.5 rounded font-black font-mono shadow-xs shrink-0 ${
                          phys.classification === "A" 
                            ? "bg-blue-600 text-white" 
                            : "bg-slate-100 dark:bg-slate-800 text-slate-500"
                        }`}>
                          Class {phys.classification}
                        </span>
                      </div>

                      <div className="border-t border-slate-100 dark:border-slate-800/80 my-2"></div>

                      <div className="space-y-1.5 text-xxs text-slate-600 dark:text-slate-400 font-sans">
                        <p className="flex items-center gap-1.5">
                          <span className="font-semibold text-slate-400 w-16 shrink-0">Specialty:</span>
                          <span className="text-slate-800 dark:text-slate-200 truncate">{phys.specialty}</span>
                        </p>
                        <p className="flex items-center gap-1.5" title={getFullGeoPath(phys)}>
                          <span className="font-semibold text-slate-400 w-16 shrink-0">Geography:</span>
                          <span className="text-slate-800 dark:text-slate-200 font-medium truncate">{getFullGeoPath(phys)}</span>
                        </p>
                        <p className="flex items-start gap-1.5">
                          <span className="font-semibold text-slate-400 w-16 shrink-0 mt-0.5">Address:</span>
                          <span className="text-slate-800 dark:text-slate-200 truncate-2-lines leading-normal">{phys.address}</span>
                        </p>
                      </div>

                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex justify-between items-center text-xxs">
                      <button
                        onClick={() => handleOpenDetail(phys)}
                        className="text-blue-600 dark:text-blue-400 hover:underline font-bold"
                      >
                        View Profile Details
                      </button>
                      <span className="font-mono px-2 py-0.5 rounded font-bold bg-slate-100 dark:bg-slate-800 text-slate-500 shrink-0">
                        {scopedLastVisitLabel(phys.id)}
                      </span>
                    </div>

                  </div>
                );
              })}
            </div>
            )}

            {/* Pagination Controls */}
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              totalItems={filteredPhysicians.length}
              itemsPerPage={itemsPerPage}
              onPageChange={setCurrentPage}
              onItemsPerPageChange={setItemsPerPage}
              lang={lang}
              itemNameEn="physicians"
              itemNameAr="طبيب"
            />
          </div>
        </div>
      ) : (
        <NoDataState
          title={lang === "ar" ? "لم يتم العثور على أطباء" : "No Physicians Found"}
          description={lang === "ar" 
            ? "لم نجد أي أطباء يطابقون معايير البحث الحالية. يمكنك البدء بإضافة طبيب جديد إلى النظام." 
            : "No physicians found matching your current filters. Get started by creating a new physician."
          }
          onAction={() => setIsAddModalOpen(true)}
          actionLabel={lang === "ar" ? "أضف طبيباً جديداً" : "Add New Physician"}
          icon={Stethoscope}
          lang={lang}
        />
      )}

      {/* FILTER DRAWER / SIDEBAR (Matches Screenshot 7 exactly!) */}
      {isFiltersDrawerOpen && (
        <div className="fixed inset-0 z-50 overflow-hidden" id="filters-drawer-overlay">
          {/* Backdrop blur overlay */}
          <div 
            className="absolute inset-0 bg-slate-950/40 backdrop-blur-xs transition-opacity" 
            onClick={() => setIsFiltersDrawerOpen(false)}
          />
          
          <div className="absolute inset-y-0 right-0 max-w-full flex" id="filters-drawer-content">
            <div className="w-screen max-w-sm bg-white dark:bg-slate-950 border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col justify-between h-full animate-slide-in">
              
              {/* Drawer Header */}
              <div className="p-5 border-b border-slate-100 dark:border-slate-900 flex justify-between items-center bg-white dark:bg-slate-950">
                <div className="flex items-center gap-2">
                  <Filter size={16} className="text-blue-600" />
                  <h3 className="font-bold text-sm text-slate-900 dark:text-white">Filters</h3>
                </div>
                <button 
                  onClick={() => setIsFiltersDrawerOpen(false)}
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-full hover:bg-slate-100 dark:hover:bg-slate-900 transition-colors cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Drawer Body - Dropdowns */}
              <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs font-sans">
                
                {/* 1. All Territories Dropdown */}
                <div className="space-y-1.5">
                  <label className="font-bold text-slate-500 dark:text-slate-400 block">All Territories</label>
                  <select
                    value={selectedTerritoryFilter}
                    onChange={(e) => setSelectedTerritoryFilter(e.target.value)}
                    className="w-full px-3.5 py-2.5 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-lg text-slate-700 dark:text-slate-300 focus:outline-none focus:border-blue-500 cursor-pointer"
                  >
                    <option value="All">All Territories</option>
                    <option value="Sabha">Sabha Sabha East Zone</option>
                    <option value="Venecia">Venecia Benghazi West zone</option>
                    <option value="Hay Al-Dolar">Hay Al-Dolar Benghazi East zone</option>
                    <option value="Amman">Amman-West</option>
                    <option value="Tripoli">Tripoli-Central</option>
                    <option value="Baghdad">Baghdad-Karada</option>
                    <option value="Riyadh">Riyadh-East</option>
                  </select>
                </div>

                {/* 2. All Cities Dropdown */}
                <div className="space-y-1.5">
                  <label className="font-bold text-slate-500 dark:text-slate-400 block">All Cities</label>
                  <select
                    value={selectedCityFilter}
                    onChange={(e) => setSelectedCityFilter(e.target.value)}
                    className="w-full px-3.5 py-2.5 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-lg text-slate-700 dark:text-slate-300 focus:outline-none focus:border-blue-500 cursor-pointer"
                  >
                    <option value="All">All Cities</option>
                    <option value="Sabha">Sabha</option>
                    <option value="Benghazi">Benghazi</option>
                    <option value="Amman">Amman</option>
                    <option value="Tripoli">Tripoli</option>
                    <option value="Baghdad">Baghdad</option>
                    <option value="Riyadh">Riyadh</option>
                  </select>
                </div>

                {/* 3. All Areas Dropdown */}
                <div className="space-y-1.5">
                  <label className="font-bold text-slate-500 dark:text-slate-400 block">All Areas</label>
                  <select
                    value={selectedAreaFilter}
                    onChange={(e) => setSelectedAreaFilter(e.target.value)}
                    className="w-full px-3.5 py-2.5 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-lg text-slate-700 dark:text-slate-300 focus:outline-none focus:border-blue-500 cursor-pointer"
                  >
                    <option value="All">All Areas</option>
                    <option value="East">East Zone</option>
                    <option value="West">West Zone</option>
                    <option value="Central">Central Zone</option>
                  </select>
                </div>

                {/* 4. All Medical Reps Dropdown */}
                <div className="space-y-1.5">
                  <label className="font-bold text-slate-500 dark:text-slate-400 block">All Medical Reps</label>
                  <select
                    value={selectedRepFilter}
                    onChange={(e) => setSelectedRepFilter(e.target.value)}
                    className="w-full px-3.5 py-2.5 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-lg text-slate-700 dark:text-slate-300 focus:outline-none focus:border-blue-500 cursor-pointer"
                  >
                    <option value="All">All Medical Reps</option>
                    <option value="AliM">AliM Beitlalmal</option>
                    <option value="Omar">Omar Al-Fares</option>
                    <option value="Rania">Rania Haddad</option>
                  </select>
                </div>

                {/* 5. All Specialties Dropdown */}
                <div className="space-y-1.5">
                  <label className="font-bold text-slate-500 dark:text-slate-400 block">All Specialties</label>
                  <select
                    value={selectedSpecialtyFilter}
                    onChange={(e) => setSelectedSpecialtyFilter(e.target.value)}
                    className="w-full px-3.5 py-2.5 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-lg text-slate-700 dark:text-slate-300 focus:outline-none focus:border-blue-500 cursor-pointer"
                  >
                    <option value="All">All Specialties</option>
                    {specialtiesList.map(s => (
                      <option key={s.id} value={s.name}>
                        {s.name} {s.nameAr ? `(${s.nameAr})` : ""}
                      </option>
                    ))}
                    {/* Fallbacks for legacy/mock compatibility */}
                    <option value="DERMA">GP-DERMA / DERMA - GP</option>
                    <option value="Cardiologist">Cardiologist</option>
                    <option value="Pediatrician">Pediatrician</option>
                    <option value="Gynecologist">Gynecologist</option>
                  </select>
                </div>

                {/* 6. All Categories Dropdown */}
                <div className="space-y-1.5">
                  <label className="font-bold text-slate-500 dark:text-slate-400 block">All Categories</label>
                  <select
                    value={selectedCategoryFilter}
                    onChange={(e) => setSelectedCategoryFilter(e.target.value)}
                    className="w-full px-3.5 py-2.5 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-lg text-slate-700 dark:text-slate-300 focus:outline-none focus:border-blue-500 cursor-pointer"
                  >
                    <option value="All">All Categories</option>
                    <option value="A">Category A</option>
                    <option value="B">Category B</option>
                    <option value="C">Category C</option>
                  </select>
                </div>

                {/* 7. All Sectors Dropdown */}
                <div className="space-y-1.5">
                  <label className="font-bold text-slate-500 dark:text-slate-400 block">All Sectors</label>
                  <select
                    value={selectedSectorFilter}
                    onChange={(e) => setSelectedSectorFilter(e.target.value)}
                    className="w-full px-3.5 py-2.5 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-lg text-slate-700 dark:text-slate-300 focus:outline-none focus:border-blue-500 cursor-pointer"
                  >
                    <option value="All">All Sectors</option>
                    <option value="Private">Private Clinics</option>
                    <option value="Public">Public Hospitals</option>
                    <option value="Polyclinic">Polyclinics</option>
                  </select>
                </div>

                {/* 8. Status Selector Toggle matching Screenshot 7 */}
                <div className="space-y-2 pt-2">
                  <label className="font-bold text-slate-500 dark:text-slate-400 block">Status</label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setStatusFilter("Active")}
                      className={`flex-1 py-1.5 rounded-md font-semibold text-center border transition-all cursor-pointer ${
                        statusFilter === "Active"
                          ? "bg-blue-600 border-blue-600 text-white shadow-xs"
                          : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300"
                      }`}
                    >
                      Active
                    </button>
                    <button
                      type="button"
                      onClick={() => setStatusFilter("Inactive")}
                      className={`flex-1 py-1.5 rounded-md font-semibold text-center border transition-all cursor-pointer ${
                        statusFilter === "Inactive"
                          ? "bg-blue-600 border-blue-600 text-white shadow-xs"
                          : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300"
                      }`}
                    >
                      Inactive
                    </button>
                    <button
                      type="button"
                      onClick={() => setStatusFilter("All")}
                      className={`flex-1 py-1.5 rounded-md font-semibold text-center border transition-all cursor-pointer ${
                        statusFilter === "All"
                          ? "bg-blue-600 border-blue-600 text-white shadow-xs"
                          : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300"
                      }`}
                    >
                      All
                    </button>
                  </div>
                </div>

              </div>

              {/* Drawer Footer Actions */}
              <div className="p-4 border-t border-slate-150 dark:border-slate-900 bg-slate-50 dark:bg-slate-950 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedTerritoryFilter("All");
                    setSelectedCityFilter("All");
                    setSelectedAreaFilter("All");
                    setSelectedRepFilter("All");
                    setSelectedSpecialtyFilter("All");
                    setSelectedCategoryFilter("All");
                    setSelectedSectorFilter("All");
                    setStatusFilter("Active");
                    setIsFiltersDrawerOpen(false);
                  }}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 font-bold rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  <X size={14} />
                  <span>Reset</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsFiltersDrawerOpen(false)}
                  className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-md transition-all cursor-pointer"
                >
                  <span>Apply Filters</span>
                </button>
              </div>

            </div>
          </div>
        </div>
      )}

      {/* VIEW DETAILS MODAL (Matches Screenshot 2, 3, 4, 5, 6 exactly!) */}
      {selectedPhysician && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs overflow-y-auto" id="physician-details-modal">
          <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-850 rounded-xl w-full max-w-4xl shadow-2xl relative animate-scale-up flex flex-col my-8">
            
            {/* Close button at top right */}
            <button 
              onClick={() => setSelectedPhysician(null)}
              className="absolute right-5 top-5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-full hover:bg-slate-150 dark:hover:bg-slate-900 transition-colors cursor-pointer z-10"
            >
              <X size={20} />
            </button>

            {/* Modal Header containing Avatar & main details */}
            <div className="p-6 pb-4 bg-white dark:bg-slate-900 rounded-t-xl border-b border-slate-100 dark:border-slate-800 flex items-center gap-4">
              {/* Circular Avatar */}
              <div className="w-14 h-14 rounded-full bg-blue-50 dark:bg-blue-950/60 border border-blue-200/60 dark:border-blue-900/40 text-blue-600 dark:text-blue-400 font-bold text-xl flex items-center justify-center font-mono">
                {selectedPhysician.name.split(" ").filter(Boolean).map(n => n[0] === "D" && n[1] === "r" ? "" : n[0]).join("").substring(0, 2).toUpperCase() || "DR"}
              </div>
              
              <div className="space-y-1 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-extrabold text-base text-slate-900 dark:text-white leading-tight">
                    {selectedPhysician.name} {selectedPhysician.nameAr && <span className="text-slate-500 font-sans"> {selectedPhysician.nameAr}</span>}
                  </h3>
                  <span className="px-2.5 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-500 text-[10px] font-black uppercase rounded tracking-wide">
                    Category {selectedPhysician.classification}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-y-1 gap-x-3 text-[11px] text-slate-500 font-medium">
                  <p className="flex items-center gap-1">
                    <Stethoscope size={13} className="text-slate-400" />
                    <span>{selectedPhysician.specialty}</span>
                  </p>
                  <p className="flex items-center gap-1">
                    <MapPin size={13} className="text-slate-400" />
                    <span>{selectedPhysician.territory}</span>
                  </p>
                </div>
              </div>
            </div>

            {/* Modal Tabs Bar */}
            <div className="px-6 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-850 flex overflow-x-auto gap-1">
              <button
                onClick={() => setModalActiveTab("overview")}
                className={`flex items-center gap-2 py-3 px-4 text-xs font-bold border-b-2 transition-all cursor-pointer whitespace-nowrap ${
                  modalActiveTab === "overview"
                    ? "border-blue-600 text-blue-600 dark:text-blue-400 font-extrabold"
                    : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-200"
                }`}
              >
                <Activity size={14} />
                <span>Overview</span>
              </button>
              
              <button
                onClick={() => setModalActiveTab("visits")}
                className={`flex items-center gap-2 py-3 px-4 text-xs font-bold border-b-2 transition-all cursor-pointer whitespace-nowrap ${
                  modalActiveTab === "visits"
                    ? "border-blue-600 text-blue-600 dark:text-blue-400 font-extrabold"
                    : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-200"
                }`}
              >
                <Calendar size={14} />
                <span>Visits</span>
              </button>

              <button
                onClick={() => setModalActiveTab("samples")}
                className={`flex items-center gap-2 py-3 px-4 text-xs font-bold border-b-2 transition-all cursor-pointer whitespace-nowrap ${
                  modalActiveTab === "samples"
                    ? "border-blue-600 text-blue-600 dark:text-blue-400 font-extrabold"
                    : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-200"
                }`}
              >
                <Beaker size={14} />
                <span>Samples</span>
              </button>

              <button
                onClick={() => setModalActiveTab("products")}
                className={`flex items-center gap-2 py-3 px-4 text-xs font-bold border-b-2 transition-all cursor-pointer whitespace-nowrap ${
                  modalActiveTab === "products"
                    ? "border-blue-600 text-blue-600 dark:text-blue-400 font-extrabold"
                    : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-200"
                }`}
              >
                <Box size={14} />
                <span>Products</span>
              </button>

              <button
                onClick={() => setModalActiveTab("supervisor")}
                className={`flex items-center gap-2 py-3 px-4 text-xs font-bold border-b-2 transition-all cursor-pointer whitespace-nowrap ${
                  modalActiveTab === "supervisor"
                    ? "border-blue-600 text-blue-600 dark:text-blue-400 font-extrabold"
                    : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-200"
                }`}
              >
                <Users size={14} />
                <span>Supervisor Visits</span>
              </button>
            </div>

            {/* Modal Scrollable Content Panel */}
            <div className="p-6 overflow-y-auto max-h-[480px] flex-1 text-slate-800 dark:text-slate-100">
              
              {/* TAB 1: OVERVIEW */}
              {modalActiveTab === "overview" && (
                <div className="space-y-4 font-sans text-xs">
                  
                  {(() => {
                    const primaryBrand = selectedPhysician.primaryBrand;
                    if (!primaryBrand) return null;
                    const hasActiveProducts = (products || []).some(p => 
                      p.isActive !== false && 
                      (p.brand?.toLowerCase() === primaryBrand.toLowerCase() || 
                       p.promotionGroupName?.toLowerCase() === primaryBrand.toLowerCase() ||
                       p.promotionGroupId === promotionGroups.find(g => g.name === primaryBrand)?.id)
                    );
                    if (!hasActiveProducts) {
                      return (
                        <div className="bg-rose-50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/40 text-rose-700 dark:text-rose-400 p-4 rounded-xl flex items-start gap-3">
                          <AlertTriangle size={18} className="shrink-0 text-rose-500 mt-0.5 animate-bounce" />
                          <div>
                            <p className="font-extrabold text-xs">Primary Promotion Group has No Active Products</p>
                            <p className="text-[11px] text-rose-600 dark:text-rose-300 font-medium mt-1">
                              Warning: This physician cannot be detailed yet because there are no active products assigned to their Primary Promotion Group ({primaryBrand}) in the database. Complete the product catalog setup to resolve this.
                            </p>
                          </div>
                        </div>
                      );
                    }
                    return null;
                  })()}
                  
                  {/* Two columns: Contact Info & Visit Summary */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    
                    {/* Contact Information Card */}
                    <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200/50 dark:border-slate-800/80 relative shadow-xs">
                      <button 
                        onClick={() => {
                          setSelectedPhysician(null);
                          startEditPhysician(selectedPhysician);
                        }}
                        className="absolute right-4 top-4 text-slate-400 hover:text-slate-600 cursor-pointer"
                        title="Edit Physician"
                      >
                        <Pencil size={13} />
                      </button>
                      <h4 className="font-extrabold text-xs text-slate-800 dark:text-white flex items-center gap-2 mb-3">
                        <User size={14} className="text-blue-500" />
                        <span>Contact Information</span>
                      </h4>
                      <div className="space-y-2">
                        <div>
                          <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Clinic Address:</span>
                          <p className="text-slate-700 dark:text-slate-200 font-semibold leading-normal">
                            {selectedPhysician.address || "No Address Provided"}
                          </p>
                        </div>
                        {selectedPhysician.phone && (
                          <div>
                            <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Phone:</span>
                            <p className="text-slate-700 dark:text-slate-200 font-semibold leading-normal font-mono">
                              {selectedPhysician.phone}
                            </p>
                          </div>
                        )}
                        {selectedPhysician.email && (
                          <div>
                            <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Email:</span>
                            <p className="text-slate-700 dark:text-slate-200 font-semibold leading-normal font-mono">
                              {selectedPhysician.email}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Visit Summary Card */}
                    <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200/50 dark:border-slate-800/80 relative shadow-xs">
                      <button 
                        onClick={() => {
                          setSelectedPhysician(null);
                          startEditPhysician(selectedPhysician);
                        }}
                        className="absolute right-4 top-4 text-slate-400 hover:text-slate-600 cursor-pointer"
                        title="Edit Physician"
                      >
                        <Pencil size={13} />
                      </button>
                      <h4 className="font-extrabold text-xs text-slate-800 dark:text-white flex items-center gap-2 mb-3">
                        <Calendar size={14} className="text-blue-500" />
                        <span>Visit Summary</span>
                      </h4>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Total Visits</span>
                          <p className="text-3xl font-black text-blue-600 dark:text-blue-400 mt-1">
                            {selectedVisitHistoryStatus === "READY" ? selectedVisitSummary?.totalCompletedVisits || 0 : "—"}
                          </p>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Target Frequency</span>
                          <p className="text-xs font-bold text-slate-700 dark:text-slate-300 mt-2.5">
                            {selectedPhysician.targetFrequency || 4} / month
                          </p>
                        </div>
                      </div>
                      <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/60 space-y-2">
                        <div className="flex justify-between items-center text-xxs font-semibold text-slate-500">
                          <span>Monthly Frequency Compliance:</span>
                          <span className="text-blue-600 dark:text-blue-400 font-bold font-mono">
                            {selectedVisitHistoryStatus === "READY" ? Math.min(100, Math.round(((selectedVisitSummary?.currentMonthCompletedVisits || 0) / (selectedPhysician.targetFrequency || 4)) * 100)) : 0}%
                          </span>
                        </div>
                        <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
                          <div 
                            className="bg-blue-600 h-1.5 rounded-full transition-all duration-500" 
                            style={{ width: `${selectedVisitHistoryStatus === "READY" ? Math.min(100, Math.round(((selectedVisitSummary?.currentMonthCompletedVisits || 0) / (selectedPhysician.targetFrequency || 4)) * 100)) : 0}%` }}
                          />
                        </div>
                      </div>
                      <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800/60 flex items-center gap-2 text-xxs font-medium text-slate-500">
                        <Calendar size={12} className="text-slate-400" />
                        <span>Last Visit:</span>
                        <span className="font-mono text-slate-700 dark:text-slate-300 font-bold">
                          {selectedVisitHistoryStatus === "READY" ? selectedVisitSummary?.lastVisit?.visitDate || "Never Visited" : selectedVisitHistoryStatus === "ERROR" ? "Unavailable" : "Loading…"}
                        </span>
                      </div>
                    </div>

                  </div>

                  {/* Location Card with Breadcrumbs */}
                  <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200/50 dark:border-slate-800/80 relative shadow-xs">
                    <button 
                      onClick={() => {
                        setSelectedPhysician(null);
                        startEditPhysician(selectedPhysician);
                      }}
                      className="absolute right-4 top-4 text-slate-400 hover:text-slate-600 cursor-pointer"
                      title="Edit Physician"
                    >
                      <Pencil size={13} />
                    </button>
                    <h4 className="font-extrabold text-xs text-slate-800 dark:text-white flex items-center gap-2 mb-3">
                      <MapPin size={14} className="text-blue-500" />
                      <span>Geographic Hierarchy Path</span>
                    </h4>
                    {(() => {
                      const resGeo = resolveRecordGeography(selectedPhysician, areasList);
                      return (
                        <div className="flex flex-wrap items-center gap-2 text-xxs font-semibold mb-3">
                          <span className="bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-lg text-slate-700 dark:text-slate-300">
                            {resGeo.countryName}
                          </span>
                          <span className="text-slate-400">/</span>
                          <span className="bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-lg text-slate-700 dark:text-slate-300">
                            {resGeo.districtName}
                          </span>
                          <span className="text-slate-400">/</span>
                          <span className="bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-lg text-slate-700 dark:text-slate-300">
                            {resGeo.cityName}
                          </span>
                          <span className="text-slate-400">/</span>
                          <span className="bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-lg text-slate-700 dark:text-slate-300">
                            {resGeo.areaName}
                          </span>
                        </div>
                      );
                    })()}
                    {selectedPhysician.latitude && selectedPhysician.longitude ? (
                      <div className="flex items-center gap-2 text-xxs bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 px-3 py-2 rounded-lg border border-emerald-200/50 dark:border-emerald-900/40">
                        <span className="font-bold">GPS Verified:</span>
                        <span className="font-mono font-bold">({Number(selectedPhysician.latitude).toFixed(4)}, {Number(selectedPhysician.longitude).toFixed(4)})</span>
                        <span className="text-emerald-400">|</span>
                        <span>Locked Compliance OK</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-xxs bg-amber-50 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400 px-3 py-2 rounded-lg border border-amber-200/50 dark:border-amber-900/40">
                        <span className="font-bold">GPS:</span>
                        <span>No coordinates verified yet. Onboarding verification required.</span>
                      </div>
                    )}
                  </div>

                  {/* Brand & Team Assignments Card */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200/50 dark:border-slate-800/80 shadow-xs">
                      <h4 className="font-extrabold text-xs text-slate-800 dark:text-white flex items-center gap-2 mb-3">
                        <Tag size={14} className="text-blue-500" />
                        <span>Product Alignment & Promotion Groups</span>
                      </h4>
                      <div className="space-y-2">
                        {selectedPhysician.primaryBrand && (
                          <div>
                            <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Primary Promotion Group:</span>
                            <p className="text-slate-800 dark:text-slate-200 font-extrabold text-xxs mt-0.5">
                              {selectedPhysician.primaryBrand}
                            </p>
                          </div>
                        )}
                        {selectedPhysician.targetBrands && selectedPhysician.targetBrands.length > 0 && (
                          <div>
                            <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Target Promotion Groups:</span>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {selectedPhysician.targetBrands.map((b, idx) => (
                                <span key={idx} className="bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 border border-indigo-150 dark:border-indigo-900/40 px-2 py-0.5 rounded text-xxs font-bold">
                                  {b}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        <div>
                          <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Aligned Products ({selectedPhysician.alignedProductIds?.length || 0}):</span>
                          {selectedPhysician.alignedProductIds && selectedPhysician.alignedProductIds.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5 mt-1">
                              {selectedPhysician.alignedProductIds.map((prodId, idx) => {
                                const prodObj = products.find(p => p.id === prodId || p.name === prodId);
                                const displayName = prodObj ? prodObj.name : prodId;
                                return (
                                  <span key={idx} className="bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-150 dark:border-blue-900/40 px-2.5 py-1 rounded-lg text-xxs font-bold">
                                    {displayName}
                                  </span>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="text-slate-500 text-xxs italic mt-0.5">No products assigned</p>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200/50 dark:border-slate-800/80 shadow-xs">
                      <h4 className="font-extrabold text-xs text-slate-800 dark:text-white flex items-center gap-2 mb-3">
                        <Users size={14} className="text-blue-500" />
                        <span>Team Assignments</span>
                      </h4>
                      <div className="grid grid-cols-1 gap-2 text-xxs font-semibold">
                        <div>
                          <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block">Assigned Medical Rep:</span>
                          <span className="text-slate-700 dark:text-slate-300 font-bold block mt-0.5">
                            {users.find(u => u.id === selectedPhysician.assignedRepId)?.name || selectedPhysician.assignedRepId || "Unassigned"}
                          </span>
                        </div>
                        {selectedPhysician.assignedSupervisorId && (
                          <div>
                            <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block">Field Supervisor:</span>
                            <span className="text-slate-700 dark:text-slate-300 font-bold block mt-0.5">
                              {users.find(u => u.id === selectedPhysician.assignedSupervisorId)?.name || selectedPhysician.assignedSupervisorId || "Unassigned"}
                            </span>
                          </div>
                        )}
                        {selectedPhysician.assignedManagerId && (
                          <div>
                            <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block">District Manager:</span>
                            <span className="text-slate-700 dark:text-slate-300 font-bold block mt-0.5">
                              {users.find(u => u.id === selectedPhysician.assignedManagerId)?.name || selectedPhysician.assignedManagerId || "Unassigned"}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                </div>
              )}

              {/* TAB 2: VISITS HISTORY */}
              {modalActiveTab === "visits" && (
                <div className="space-y-4 font-sans text-xs">
                  <h4 className="font-extrabold text-xs text-slate-800 dark:text-white mb-2">Visit Detailing Logs</h4>
                  
                  {selectedVisits.length > 0 ? (
                    <div className="space-y-3">
                      {selectedVisits.map((visit, index) => (
                        <div key={index} className="bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800/80 p-5 rounded-xl shadow-xs space-y-3 relative">
                          <div className="absolute right-4 top-4 flex gap-2">
                            {visit.gpsVerified ? (
                              <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-extrabold rounded text-[10px] border border-emerald-500/20">
                                GPS Verified
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 bg-rose-500/10 text-rose-600 dark:text-rose-400 font-extrabold rounded text-[10px] border border-rose-500/20">
                                GPS Unverified
                              </span>
                            )}
                            <span className="px-2.5 py-0.5 bg-blue-600 text-white font-extrabold rounded text-[10px] uppercase shadow-xs">
                              {visit.status || "completed"}
                            </span>
                          </div>
                          
                          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 text-slate-500 font-semibold text-xxs">
                            <div className="flex items-center gap-1.5">
                              <Calendar size={13} className="text-slate-400" />
                              <span className="font-mono text-slate-800 dark:text-slate-300 font-bold">
                                {visit.visitDate} {visit.visitTime ? `at ${visit.visitTime}` : ""}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <User size={13} className="text-slate-400" />
                              <span className="text-slate-800 dark:text-slate-300 font-bold">
                                {visit.repName || users.find(u => u.id === visit.repId)?.name || visit.repId}
                              </span>
                            </div>
                          </div>

                          {/* Detailing Products and Reactions */}
                          {visit.detailing && visit.detailing.length > 0 && (
                            <div className="border-t border-b border-slate-100 dark:border-slate-800 py-3 space-y-2">
                              <span className="text-[10px] text-slate-400 uppercase font-black tracking-wider block">Product Detailing & Reaction Tracking:</span>
                              <div className="grid grid-cols-1 gap-2">
                                {visit.detailing.map((det: any, dIdx: number) => {
                                  const rxColor = det.reaction === "Positive" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20" :
                                                  det.reaction === "Neutral" ? "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20" :
                                                  det.reaction === "Skeptical" ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20" :
                                                  "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20";
                                  return (
                                    <div key={dIdx} className="bg-slate-50 dark:bg-slate-950 p-2.5 rounded-lg border border-slate-100 dark:border-slate-850 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                      <div>
                                        <p className="font-extrabold text-slate-800 dark:text-white text-xxs">
                                          {resolveCanonicalVisitProductName(det, products)}
                                        </p>
                                        {det.keyMessageDiscussed && (
                                          <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 italic">
                                            Message: "{det.keyMessageDiscussed}"
                                          </p>
                                        )}
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${rxColor}`}>
                                          Reaction: {det.reaction || "Positive"}
                                        </span>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {/* Prescription Intent Rating */}
                          {visit.prescriptionIntent !== undefined && (
                            <div className="flex items-center gap-2 bg-blue-50/40 dark:bg-blue-950/20 p-2 rounded-lg border border-blue-100/50 dark:border-blue-900/40">
                              <span className="text-[10px] text-blue-600 dark:text-blue-400 uppercase font-black tracking-wider">Prescription Intent:</span>
                              <div className="flex items-center gap-1">
                                <span className="font-mono text-slate-800 dark:text-slate-200 font-extrabold">{visit.prescriptionIntent}/10</span>
                                <div className="flex text-amber-400 ml-1">
                                  {Array.from({ length: 5 }).map((_, i) => (
                                    <Star 
                                      key={i} 
                                      size={11} 
                                      className={i < Math.round(visit.prescriptionIntent / 2) ? "fill-amber-400" : "text-slate-300 dark:text-slate-700"} 
                                    />
                                  ))}
                                </div>
                              </div>
                            </div>
                          )}

                          {visit.generalNotes && (
                            <div className="mt-2 text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-950 p-3 rounded-lg border border-slate-100 dark:border-slate-850">
                              <span className="text-[10px] text-slate-400 uppercase font-black tracking-wider block mb-1">Visit Notes:</span>
                              <p className="text-xs leading-relaxed" dir={visit.generalNotes.match(/[\u0600-\u06FF]/) ? "rtl" : "ltr"}>
                                {visit.generalNotes}
                              </p>
                            </div>
                          )}

                          <div className="pt-2 mt-2 border-t border-slate-100 dark:border-slate-800 flex justify-between items-center text-xxs">
                            <span className="text-slate-400 font-mono">Doc ID: {visit.id}</span>
                            <a
                              href={`#summary-${visit.id}`}
                              onClick={(e) => {
                                e.preventDefault();
                                if (onViewVisitSummary) {
                                  onViewVisitSummary(visit);
                                } else {
                                  alert(
                                    `--- VISIT SUMMARY REPORT [${visit.id}] ---\n\n` +
                                    `Date: ${visit.visitDate}\n` +
                                    `Physician: Dr. ${visit.physicianName}\n` +
                                    `Representative: ${visit.repName || "Medical Representative"}\n` +
                                    `Duration: ${Math.floor(visit.durationSeconds / 60)}m ${visit.durationSeconds % 60}s\n` +
                                    `Detailing:\n` +
                                    `${visit.detailing?.map(d => ` - Brand/Product: ${resolveCanonicalVisitProductName(d, products)} (Reaction: ${d.reaction || "Positive"})\n   Notes: ${d.notes || "None"}`).join("\n") || "None"}\n` +
                                    `Samples Disbursed:\n` +
                                    `${visit.samples?.map(s => ` - ${s.productName}: ${s.quantity} units`).join("\n") || "None"}\n\n` +
                                    `Prescription Intent Rating: ${visit.prescriptionIntent || 5}/10\n` +
                                    `GPS Verification: ${visit.gpsVerified ? "Verified (Physically Present)" : "Unverified"}\n` +
                                    `General Notes: ${visit.generalNotes || "None"}`
                                  );
                                }
                              }}
                              className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center gap-1 cursor-pointer"
                            >
                              <span>View Complete Visit Summary Report</span>
                              <ArrowUpRight size={12} className="inline-block" />
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-12 text-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
                      <Calendar className="mx-auto text-slate-400 mb-2" size={32} />
                      <h5 className="font-bold text-slate-700 dark:text-white">
                        {selectedVisitHistoryStatus === "LOADING" ? "Loading visit history…" : selectedVisitHistoryStatus === "ERROR" ? "Visit history unavailable." : "No own visit history."}
                      </h5>
                      <p className="text-xxs text-slate-400 mt-1">Only visits authorized by the current operational scope display here.</p>
                    </div>
                  )}

                </div>
              )}

              {/* TAB 3: SAMPLES */}
              {modalActiveTab === "samples" && (
                <div className="space-y-4 font-sans text-xs">
                  <h4 className="font-extrabold text-xs text-slate-800 dark:text-white mb-2">Sample Distributions</h4>
                  
                  {(() => {
                    const sampleDistributions = selectedVisits.flatMap(v => 
                      (v.samples || []).map((s: any) => ({
                        ...s,
                        visitDate: v.visitDate,
                        repName: v.repName || users.find(u => u.id === v.repId)?.name || v.repId
                      }))
                    );

                    if (sampleDistributions.length > 0) {
                      return (
                        <div className="space-y-2">
                          {sampleDistributions.map((sample: any, idx: number) => (
                            <div key={idx} className="bg-white dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800/80 p-4 rounded-xl flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <div className="p-2.5 bg-blue-50 dark:bg-blue-950/60 text-blue-600 rounded-lg">
                                  <Beaker size={18} />
                                </div>
                                <div>
                                  <p className="font-bold text-slate-800 dark:text-white">
                                    {products.find(p => p.id === sample.productId || p.name === sample.productId)?.name || sample.productId}
                                    {sample.sampleSkuName ? ` · ${sample.sampleSkuName}` : ""}
                                  </p>
                                  <p className="text-xxs text-slate-400">Distributed by {sample.repName}</p>
                                </div>
                              </div>
                              <div className="text-right font-mono">
                                <span className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold rounded-lg text-xxs">
                                  Qty: {sample.quantity || sample.qty || 1}
                                </span>
                                <p className="text-[10px] text-slate-400 mt-1">{sample.visitDate}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    }

                    // Default Jamila Allafy mock fallback
                    if (selectedPhysician.id === "PHY-002") {
                      return (
                        <div className="bg-white dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800/80 p-4 rounded-xl flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="p-2.5 bg-blue-50 dark:bg-blue-950/60 text-blue-600 rounded-lg">
                              <Beaker size={18} />
                            </div>
                            <div>
                              <p className="font-bold text-slate-800 dark:text-white">ADACLINE GEL 30G</p>
                              <p className="text-xxs text-slate-400">Distributed by AliM Beitlalmal</p>
                            </div>
                          </div>
                          <div className="text-right font-mono">
                            <span className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold rounded-lg text-xxs">
                              Qty: 2
                            </span>
                            <p className="text-[10px] text-slate-400 mt-1">5/2/2026</p>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div className="p-12 text-center bg-white dark:bg-slate-900 border border-slate-200/50 dark:border-slate-850 rounded-xl" id="samples-empty-card">
                        <h5 className="text-slate-500 font-medium text-xs">No samples distributed to this physician.</h5>
                      </div>
                    );
                  })()}

                </div>
              )}

              {/* TAB 4: PRODUCTS */}
              {modalActiveTab === "products" && (
                <div className="space-y-6 font-sans text-xs">
                  {/* Part 1: Product Alignment / Targeting Scope */}
                  <div>
                    <h4 className="font-extrabold text-xs text-slate-800 dark:text-white mb-1 flex items-center gap-2">
                      <span className="w-1.5 h-3 bg-blue-500 rounded-full"></span>
                      {isRtl ? "الأدوية والمستحضرات المستهدفة والمعتمدة" : "Aligned & Targeted Products Scope"}
                    </h4>
                    <p className="text-[10px] text-slate-400 mb-3">
                      {isRtl 
                        ? "المستحضرات المرتبطة بالطبيب ديناميكياً بناءً على تخصص ومجموعات الترويج الأساسية والفرعية." 
                        : "Products mapped to this physician based on Specialty, Primary Brand, and Target Promotion Groups."}
                    </p>
                    {(() => {
                      const alignedProds = resolveCanonicalPhysicianAlignedProducts(selectedPhysician, products);

                      if (alignedProds.length === 0) {
                        return (
                          <div className="p-4 bg-slate-50 dark:bg-slate-900/40 rounded-xl text-center text-slate-400 italic">
                            {isRtl ? "لا توجد مستحضرات معتمدة حالياً لهذه المجموعة الترويجية." : "No aligned products currently found in the target promotion groups."}
                          </div>
                        );
                      }

                      return (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {alignedProds.map((prod, idx) => {
                            const isPrimary = Boolean(
                              selectedPhysician.primaryPromotionGroupId &&
                              prod.promotionGroupId === selectedPhysician.primaryPromotionGroupId
                            );
                            return (
                              <div key={idx} className="bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800/80 p-3.5 rounded-xl shadow-xs flex items-center justify-between">
                                <div className="flex items-center gap-2.5">
                                  <div className="p-1.5 bg-blue-50 dark:bg-blue-950/60 text-blue-600 rounded-lg">
                                    <Box size={14} />
                                  </div>
                                  <div>
                                    <p className="font-bold text-slate-900 dark:text-white text-xxs">{prod.name}</p>
                                    <p className="text-[9px] text-slate-400 uppercase font-mono mt-0.5">{prod.brand || "ALIGNED"}</p>
                                  </div>
                                </div>
                                <span className={`px-2 py-0.5 text-[9px] font-bold rounded-md ${isPrimary ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600' : 'bg-blue-50 dark:bg-blue-950/40 text-blue-600'}`}>
                                  {isPrimary ? (isRtl ? "أساسي" : "Primary") : (isRtl ? "مستهدف" : "Target")}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>

                  {/* Part 2: Actual Discussion & Detailing History */}
                  <div>
                    <h4 className="font-extrabold text-xs text-slate-800 dark:text-white mb-1 flex items-center gap-2">
                      <span className="w-1.5 h-3 bg-purple-500 rounded-full"></span>
                      {isRtl ? "سجل المناقشات والدعاية الفعلية" : "Actual Detailing & Discussion History"}
                    </h4>
                    <p className="text-[10px] text-slate-400 mb-3">
                      {isRtl 
                        ? "قائمة المستحضرات التي تمت مناقشتها وتغطيتها فعلياً مع الطبيب في الزيارات السابقة المعتمدة." 
                        : "Products actually detailed and presented during completed visits, trackable by detailing count."}
                    </p>
                    {(() => {
                      const discussedProductsMap = new Map<string, { count: number; lastDate: string }>();
                      selectedVisits.forEach(v => {
                        if (v.detailing) {
                          v.detailing.forEach((d: any) => {
                            const existing = discussedProductsMap.get(d.productId);
                            if (!existing) {
                              discussedProductsMap.set(d.productId, { count: 1, lastDate: v.visitDate });
                            } else {
                              discussedProductsMap.set(d.productId, {
                                count: existing.count + 1,
                                lastDate: v.visitDate > existing.lastDate ? v.visitDate : existing.lastDate
                              });
                            }
                          });
                        }
                      });

                      if (discussedProductsMap.size === 0) {
                        return (
                          <div className="p-4 bg-slate-50 dark:bg-slate-900/40 rounded-xl text-center text-slate-400 italic">
                            {isRtl ? "لم يتم مناقشة أي مستحضر حتى الآن." : "No actual detailing discussion has been recorded yet for this physician."}
                          </div>
                        );
                      }

                      return (
                        <div className="space-y-3">
                          {Array.from(discussedProductsMap.entries()).map(([prodId, info], idx) => {
                            const prodObj = products.find(p => p.id === prodId || p.name === prodId);
                            const displayName = resolveCanonicalVisitProductName({ productId: prodId }, products);
                            const lineCategory = prodObj?.promotionGroupName || prodObj?.brand || "PROMOTION GROUP";
                            return (
                              <div key={idx} className="bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800/80 p-4 rounded-xl shadow-xs flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                  <div className="p-2 bg-purple-50 dark:bg-purple-950/60 text-purple-600 rounded-lg">
                                    <Box size={16} />
                                  </div>
                                  <div>
                                    <p className="font-extrabold text-slate-900 dark:text-white">{displayName}</p>
                                    <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider font-mono mt-0.5">{lineCategory}</p>
                                  </div>
                                </div>

                                <div className="flex items-center gap-3 font-semibold text-xxs">
                                  <span className="px-2.5 py-1 bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 rounded-lg">
                                    {isRtl ? "تمت المناقشة:" : "Discussed:"} {info.count}x
                                  </span>
                                  <span className="text-slate-400 font-mono text-xxs">
                                    {isRtl ? "آخر تاريخ:" : "Last:"} {info.lastDate}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}

              {/* TAB 5: SUPERVISOR VISITS */}
              {modalActiveTab === "supervisor" && (
                <div className="space-y-4 font-sans text-xs">
                  <h4 className="font-extrabold text-xs text-slate-800 dark:text-white mb-2">Supervisor Accompaniment & Dual Audits</h4>
                  <SupervisorVisitHistory customerType="PHYSICIAN" customerId={selectedPhysician.id} supervisorRole={Role.MEDICAL_SUPERVISOR} users={users} lang={lang} />
                </div>
              )}

            </div>

            {/* Modal Bottom Footer */}
            <div className="p-4 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-850 flex justify-end rounded-b-xl">
              <button
                type="button"
                onClick={() => setSelectedPhysician(null)}
                className="px-5 py-2 border border-slate-200 dark:border-slate-850 text-slate-700 dark:text-slate-300 font-bold text-xs rounded-lg hover:bg-slate-50 dark:hover:bg-slate-850 transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Register / Onboard New Physician Modal Popup */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs" id="add-physician-modal">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-2xl p-6 space-y-4 shadow-xl relative animate-fade-in">
            
            <div className="flex justify-between items-center pb-2 border-b border-slate-100 dark:border-slate-800" id="modal-header">
              <h3 className="font-extrabold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                <PlusCircle className="text-blue-500" size={18} />
                <span>{editingPhysician ? "Edit Physician Master" : "Register / Onboard New Physician"}</span>
              </h3>
              <button 
                onClick={() => {
                  setIsAddModalOpen(false);
                  setEditingPhysician(null);
                }}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {formError && (
              <div className="p-3 bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 rounded-lg text-xxs font-medium" id="form-error-panel">
                {formError}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4 text-xs" id="add-physician-form">
              
              <div className="max-h-[460px] overflow-y-auto pr-2 space-y-4">
                {/* Section 1: Basic Information */}
                <div>
                  <h4 className="font-bold text-xxs uppercase tracking-wider text-blue-600 dark:text-blue-400 mb-2">1. Master Profile & Basic Info</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="font-bold text-slate-500 block">Name (English) *</label>
                      <input
                        type="text"
                        required
                        value={nameEn}
                        onChange={(e) => setNameEn(e.target.value)}
                        placeholder="Dr. John Doe"
                        className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="font-bold text-slate-500 block">Name (Arabic - Optional)</label>
                      <input
                        type="text"
                        value={nameAr}
                        onChange={(e) => setNameAr(e.target.value)}
                        placeholder="د. جون دو"
                        className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none focus:border-blue-500 text-right font-sans"
                        dir="rtl"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
                    <div className="space-y-1 relative">
                      <label className="font-bold text-slate-500 block">Specialty *</label>
                      <PhysicianSpecialtySelector
                        value={specialty}
                        valueType="name"
                        onChange={(val) => setSpecialty(val as string)}
                        lang={lang}
                        currentUser={currentUser}
                        allowRegistration={true}
                        required={true}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="font-bold text-slate-500 block">Classification Segment *</label>
                      <select
                        value={classification}
                        onChange={(e) => {
                          const val = e.target.value as "A" | "B" | "C";
                          setClassification(val);
                          setSegment(val);
                        }}
                        className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none focus:border-blue-500 cursor-pointer"
                      >
                        <option value="A">Class A (High Priority)</option>
                        <option value="B">Class B (Medium Priority)</option>
                        <option value="C">Class C (Low Priority)</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="font-bold text-slate-500 block">Key Opinion Leader (KOL) *</label>
                      <select
                        value={keyOpinionLeader}
                        onChange={(e) => setKeyOpinionLeader(e.target.value as any)}
                        className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none focus:border-blue-500 cursor-pointer"
                      >
                        <option value="No">No</option>
                        <option value="Yes">Yes (Key Leader)</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Section 2: Geographic Hierarchy */}
                <div>
                  <h4 className="font-bold text-xxs uppercase tracking-wider text-blue-600 dark:text-blue-400 mb-2">2. Geographic Hierarchy Path</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                    <div className="space-y-1">
                      <label className="font-bold text-slate-500 block">Country *</label>
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
                        className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none focus:border-blue-500 cursor-pointer text-xs"
                      >
                        <option value="">-- Select Country --</option>
                        {countriesList.map(c => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="font-bold text-slate-500 block">District *</label>
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
                        className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none focus:border-blue-500 cursor-pointer disabled:opacity-50 text-xs"
                      >
                        <option value="">-- Select District --</option>
                        {districtsList.filter(d => d.countryId === countryId).map(d => (
                          <option key={d.id} value={d.id}>{d.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="font-bold text-slate-500 block">City *</label>
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
                        className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none focus:border-blue-500 cursor-pointer disabled:opacity-50 text-xs"
                      >
                        <option value="">-- Select City --</option>
                        {citiesList.filter(c => c.districtId === districtId).map(c => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="font-bold text-slate-500 block">Area *</label>
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
                        className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none focus:border-blue-500 cursor-pointer disabled:opacity-50 text-xs"
                      >
                        <option value="">-- Select Area --</option>
                        {areasList.filter(a => a.cityId === cityId).map(a => (
                          <option key={a.id} value={a.id}>{a.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                    <div className="space-y-1">
                      <label className="font-bold text-slate-500 block">Clinic/Hospital Name</label>
                      <input
                        type="text"
                        value={clinic}
                        onChange={(e) => setClinic(e.target.value)}
                        placeholder="e.g. Benghazi Clinic"
                        className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="font-bold text-slate-500 block">Sector *</label>
                      <select
                        value={sector}
                        onChange={(e) => setSector(e.target.value as any)}
                        className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none focus:border-blue-500 cursor-pointer"
                      >
                        <option value="Private">Private</option>
                        <option value="Public">Public</option>
                        <option value="NGO">NGO</option>
                        <option value="Military">Military</option>
                      </select>
                    </div>
                  </div>

                  <div className="space-y-1 mt-3">
                    <label className="font-bold text-slate-500 block">Detailed Clinic Address *</label>
                    <textarea
                      required
                      rows={2}
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      placeholder="Medical Building, Suite 12, Main Street"
                      className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none focus:border-blue-500 resize-none"
                    />
                  </div>
                </div>

                {/* Section 3: Contact & Planning */}
                <div>
                  <h4 className="font-bold text-xxs uppercase tracking-wider text-blue-600 dark:text-blue-400 mb-2">3. Contact & Visit Planning</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <label className="font-bold text-slate-500 block">Phone Number</label>
                      <input
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="+218..."
                        className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none focus:border-blue-500 font-mono"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="font-bold text-slate-500 block">Email Address</label>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="doctor@example.com"
                        className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none focus:border-blue-500 font-mono"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="font-bold text-slate-500 block">Visit Target Frequency / Month *</label>
                      <input
                        type="number"
                        min={1}
                        max={16}
                        required
                        value={targetFrequency}
                        onChange={(e) => setTargetFrequency(Number(e.target.value) || 4)}
                        className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none focus:border-blue-500 font-mono"
                      />
                    </div>
                  </div>
                </div>

                {/* Section 4: Team Assignment */}
                <div>
                  <h4 className="font-bold text-xxs uppercase tracking-wider text-blue-600 dark:text-blue-400 mb-2">4. Team & Territory Assignments</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <label className="font-bold text-slate-500 block">Assigned Medical Rep</label>
                      <select
                        value={assignedRepId}
                        onChange={(e) => setAssignedRepId(e.target.value)}
                        disabled={assignmentResolution.eligibleRepresentativeIds.length <= 1}
                        className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none focus:border-blue-500 cursor-pointer"
                      >
                        <option value="">-- Unassigned --</option>
                        {users.filter(u => assignmentResolution.eligibleRepresentativeIds.includes(u.id)).map(u => (
                          <option key={u.id} value={u.id}>{u.name} ({u.territory || u.region || "No Territory"})</option>
                        ))}
                      </select>
                      <p className="text-[10px] font-bold text-blue-600 dark:text-blue-400">
                        {assignmentResolution.representativeStatus}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <label className="font-bold text-slate-500 block">Assigned Supervisor</label>
                      <select
                        value={assignedSupervisorId}
                        disabled
                        className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none focus:border-blue-500 cursor-pointer"
                      >
                        <option value="">-- Unassigned --</option>
                        {assignedSupervisorId && <option value={assignedSupervisorId}>{users.find(u => u.id === assignedSupervisorId)?.name || assignedSupervisorId}</option>}
                      </select>
                      {assignmentResolution.supervisorStatus === "SUPERVISOR_NOT_RESOLVED" && (
                        <p className="text-[10px] font-bold text-amber-600 dark:text-amber-400">SUPERVISOR_NOT_RESOLVED</p>
                      )}
                    </div>
                    <div className="space-y-1">
                      <label className="font-bold text-slate-500 block">Assigned Manager</label>
                      <select
                        value={assignedManagerId}
                        disabled
                        className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none focus:border-blue-500 cursor-pointer"
                      >
                        <option value="">-- Unassigned --</option>
                        {assignedManagerId && <option value={assignedManagerId}>{users.find(u => u.id === assignedManagerId)?.name || assignedManagerId}</option>}
                      </select>
                      {assignmentResolution.managerStatus === "MANAGER_NOT_RESOLVED" && (
                        <p className="text-[10px] font-bold text-amber-600 dark:text-amber-400">MANAGER_NOT_RESOLVED</p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Section 5: Product Alignment */}
                <div>
                  <h4 className="font-bold text-xxs uppercase tracking-wider text-blue-600 dark:text-blue-400 mb-2">5. Product Detailing Alignment</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <label className="font-bold text-slate-500 block">Primary Promotion Group Focus</label>
                        <select
                          value={primaryBrand}
                          onChange={(e) => {
                            const val = e.target.value;
                            setPrimaryBrand(val);
                            setTargetBrands(prev => prev.filter(name => name !== val));
                          }}
                          className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none focus:border-blue-500 cursor-pointer text-xs"
                        >
                          <option value="">Select Primary Promotion Group...</option>
                          {promotionGroups.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.name} {g.nameAr ? `(${g.nameAr})` : ""}
                            </option>
                          ))}
                        </select>
                        {(() => {
                          if (!primaryBrand) return null;
                          const hasActiveProducts = (products || []).some(p => 
                            p.isActive !== false && p.promotionGroupId === primaryBrand
                          );
                          if (!hasActiveProducts) {
                            return (
                              <p className="text-[10px] text-amber-600 dark:text-amber-400 font-semibold mt-1 animate-pulse">
                                Warning: Selected Primary Promotion Group has no active products. Complete product catalog setup before assigning representatives.
                              </p>
                            );
                          }
                          return null;
                        })()}
                      </div>

                      <div className="space-y-1">
                        <label className="font-bold text-slate-500 block">Target Promotion Groups</label>
                        <div className="border border-slate-200 dark:border-slate-800 rounded-lg p-2.5 max-h-32 overflow-y-auto space-y-1.5 bg-slate-50 dark:bg-slate-950 text-xs">
                          {promotionGroups.filter(g => g.id !== primaryBrand).length === 0 ? (
                             <p className="text-xxs text-slate-400 italic">No other promotion groups configured.</p>
                          ) : (
                            promotionGroups.filter(g => g.id !== primaryBrand).map(g => {
                              const isChecked = targetBrands.includes(g.id);
                              return (
                                <label key={g.id} className="flex items-center gap-2 cursor-pointer font-medium text-slate-700 dark:text-slate-300">
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={() => {
                                      if (isChecked) {
                                        setTargetBrands(prev => prev.filter(id => id !== g.id));
                                      } else {
                                        setTargetBrands(prev => [...prev, g.id]);
                                      }
                                    }}
                                    className="rounded border-slate-300 dark:border-slate-700 text-blue-600 focus:ring-blue-500"
                                  />
                                  <span>{g.name} {g.nameAr ? `(${g.nameAr})` : ""}</span>
                                </label>
                              );
                            })
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="font-bold text-slate-500 block">Aligned Products ({alignedProductIds.length} selected)</label>
                      <div className="border border-slate-200 dark:border-slate-800 rounded-lg p-2.5 max-h-[224px] overflow-y-auto space-y-1.5 bg-slate-50 dark:bg-slate-950">
                        {physicianEligibleProducts.length === 0 ? (
                          <p className="text-xxs text-slate-400 italic">No active products are eligible for the selected Promotion Groups.</p>
                        ) : (
                          physicianEligibleProducts.map(p => {
                            const isChecked = alignedProductIds.includes(p.id);
                            return (
                              <label key={p.id} className="flex items-center gap-2 cursor-pointer font-medium text-slate-700 dark:text-slate-300">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => {
                                    setAlignedProductIds(prev => toggleCanonicalProductSelection(prev, p.id));
                                  }}
                                  className="rounded border-slate-300 dark:border-slate-700 text-blue-600 focus:ring-blue-500"
                                />
                                <span>{p.name} {p.brand && `(${p.brand})`}</span>
                              </label>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Section 6: GPS Coordinates */}
                <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded-lg border border-slate-100 dark:border-slate-800/60 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-xxs text-slate-500 uppercase tracking-wide">Coordinates Verification</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${editingPhysician?.gpsVerified ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-400' : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-400'}`}>
                      {editingPhysician?.gpsVerified ? 'VERIFIED' : 'UNVERIFIED'}
                    </span>
                  </div>
                  {editingPhysician?.gpsVerified ? (
                    <div className="text-xs font-mono text-slate-600 dark:text-slate-300">
                      Lat: {editingPhysician.latitude}, Lng: {editingPhysician.longitude}
                    </div>
                  ) : (
                    <div className="text-xs text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/30 p-2.5 rounded-md border border-blue-200 dark:border-blue-900/50">
                      Location not yet verified. The first field visit will establish the customer’s global GPS location.
                    </div>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setIsAddModalOpen(false);
                    setEditingPhysician(null);
                  }}
                  className="px-4 py-2 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 font-bold rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingPhysician}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-md transition-all cursor-pointer"
                >
                  {isSavingPhysician ? "Saving..." : editingPhysician ? "Save Changes" : "Register Physician"}
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

    </div>
  );
}
