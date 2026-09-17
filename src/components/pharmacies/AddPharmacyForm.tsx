import React, { useState, useEffect, useMemo } from "react";
import { 
  PlusCircle, 
  MapPin, 
  Check, 
  AlertCircle,
  Sparkles,
  Building,
  DollarSign,
  ArrowLeft,
  Info
} from "lucide-react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { resolveGeographyTuple } from "../../utils/importNormalization";

interface AddPharmacyFormProps {
  lang: "en" | "ar";
  currentUser?: any;
  onNavigate?: (target: string) => void;
  onAddPharmacy?: (pharmacy: any) => void;
}

export default function AddPharmacyForm({ lang, currentUser, onNavigate, onAddPharmacy }: AddPharmacyFormProps) {
  const isRtl = lang === "ar";

  // Form states
  const [name, setName] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [type, setType] = useState("Retail");
  const [salesPotential, setSalesPotential] = useState("Medium");
  const [contact, setContact] = useState("");
  const [outstandingBalance, setOutstandingBalance] = useState("0");
  const [address, setAddress] = useState("");

  // Dynamic Geographies state from Firestore
  const [countriesList, setCountriesList] = useState<any[]>([]);
  const [districtsList, setDistrictsList] = useState<any[]>([]);
  const [citiesList, setCitiesList] = useState<any[]>([]);
  const [areasList, setAreasList] = useState<any[]>([]);
  const [loadingGeo, setLoadingGeo] = useState(false);

  // Selected geography IDs
  const [selectedCountryId, setSelectedCountryId] = useState("");
  const [selectedDistrictId, setSelectedDistrictId] = useState("");
  const [selectedCityId, setSelectedCityId] = useState("");
  const [selectedAreaId, setSelectedAreaId] = useState("");

  // UI States
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  const types = [
    "Retail",
    "Chain Pharmacy",
    "Wholesale",
    "Hospital Pharmacy",
    "Polyclinic Pharmacy"
  ];

  // Load Geographic Catalogs
  useEffect(() => {
    async function loadGeography() {
      setLoadingGeo(true);
      try {
        const [countriesSnap, districtsSnap, citiesSnap, areasSnap] = await Promise.all([
          getDocs(collection(db, "countries")),
          getDocs(collection(db, "districts")),
          getDocs(collection(db, "cities")),
          getDocs(collection(db, "areas"))
        ]);

        const loadedCountries = countriesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const loadedDistricts = districtsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const loadedCities = citiesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const loadedAreas = areasSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        setCountriesList(loadedCountries);
        setDistrictsList(loadedDistricts);
        setCitiesList(loadedCities);
        setAreasList(loadedAreas);

        // Auto-select if there is exactly one country
        if (loadedCountries.length === 1) {
          setSelectedCountryId(loadedCountries[0].id);
        }
      } catch (err) {
        console.error("Error loading geography:", err);
      } finally {
        setLoadingGeo(false);
      }
    }
    loadGeography();
  }, []);

  // Filter lists based on selection
  const filteredDistricts = useMemo(() => {
    if (!selectedCountryId) return [];
    return districtsList.filter(d => d.countryId === selectedCountryId);
  }, [districtsList, selectedCountryId]);

  const filteredCities = useMemo(() => {
    if (!selectedDistrictId) return [];
    return citiesList.filter(c => c.districtId === selectedDistrictId);
  }, [citiesList, selectedDistrictId]);

  const filteredAreas = useMemo(() => {
    if (!selectedCityId) return [];
    return areasList.filter(a => a.cityId === selectedCityId);
  }, [areasList, selectedCityId]);

  const selectedAreaObj = useMemo(() => {
    return areasList.find(a => a.id === selectedAreaId);
  }, [areasList, selectedAreaId]);

  // Derived region
  const derivedRegion = useMemo(() => {
    if (!selectedAreaObj) return "";
    const distName = selectedAreaObj.districtName || "";
    const normalized = distName.toLowerCase().trim();
    if (normalized.includes("west")) return "West";
    if (normalized.includes("east")) return "East";
    if (normalized.includes("south")) return "South";
    return distName || "West";
  }, [selectedAreaObj]);

  const getRegionDisplayLabel = (regionVal: string, isRtl: boolean) => {
    if (regionVal === "West") {
      return isRtl ? "المنطقة الغربية (طرابلس)" : "West Region (Tripoli)";
    }
    if (regionVal === "East") {
      return isRtl ? "المنطقة الشرقية (بنغازي)" : "East Region (Benghazi)";
    }
    if (regionVal === "South") {
      return isRtl ? "المنطقة الجنوبية (سبها)" : "South Region (Sabha)";
    }
    return regionVal;
  };

  const handleCountryChange = (id: string) => {
    setSelectedCountryId(id);
    setSelectedDistrictId("");
    setSelectedCityId("");
    setSelectedAreaId("");
  };

  const handleDistrictChange = (id: string) => {
    setSelectedDistrictId(id);
    setSelectedCityId("");
    setSelectedAreaId("");
  };

  const handleCityChange = (id: string) => {
    setSelectedCityId(id);
    setSelectedAreaId("");
  };

  const handleAreaChange = (id: string) => {
    setSelectedAreaId(id);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!name.trim() || !selectedCountryId || !selectedDistrictId || !selectedCityId || !selectedAreaId || !address.trim()) {
      setError(isRtl ? "يرجى ملء جميع الحقول الإلزامية واختيار النطاق الجغرافي بالكامل." : "Please fill in all mandatory fields and select the complete geographic hierarchy.");
      return;
    }

    setIsSubmitting(true);

    const selectedAreaObj = areasList.find(a => a.id === selectedAreaId);
    const selectedCityObj = citiesList.find(c => c.id === selectedCityId);
    const selectedDistrictObj = districtsList.find(d => d.id === selectedDistrictId);
    const selectedCountryObj = countriesList.find(c => c.id === selectedCountryId);

    const countryName = selectedCountryObj?.name || "";
    const districtName = selectedDistrictObj?.name || "";
    const cityName = selectedCityObj?.name || "";
    const areaName = selectedAreaObj?.name || "";

    const geography = resolveGeographyTuple(countryName, districtName, cityName, areaName, {
      countries: countriesList,
      districts: districtsList,
      cities: citiesList,
      areas: areasList,
    });
    if (!geography.isValid) {
      setError(geography.error || (isRtl ? "النطاق الجغرافي المحدد غير صالح." : "The selected geography hierarchy is not valid."));
      setIsSubmitting(false);
      return;
    }

    setTimeout(() => {
      const newPharmId = `PHR-${Math.floor(100 + Math.random() * 900)}`;
      const newPharmacy = {
        id: newPharmId,
        name,
        nameAr: nameAr || name,
        type,
        salesPotential,
        region: derivedRegion || "West",
        
        country: geography.countryName,
        countryId: geography.countryId,
        district: geography.districtName,
        districtId: geography.districtId,
        city: geography.cityName,
        cityId: geography.cityId,
        area: geography.areaName,
        areaId: geography.areaId,
        territory: geography.areaName, // Same as area name for backward compatibility

        address,
        contact: contact || "-",
        outstandingBalance: parseFloat(outstandingBalance) || 0,
        latitude: null,
        longitude: null,
        gpsVerificationStatus: "UNVERIFIED",
        gpsSource: undefined,
        gpsVerified: false,
        gpsVerifiedAt: undefined,
        gpsVerifiedByUid: undefined,
        lastVisitDate: "-",
        isTestData: false,
        importedAt: new Date().toISOString(),
        importedBy: currentUser?.email || "user"
      };

      console.log("[PHARMACY_MASTER_GPS_FORM_JSON]", JSON.stringify({
        pharmacyId: newPharmId,
        latitudeRequired: false,
        longitudeRequired: false,
        emptySaveSupported: true,
        clearExistingSupported: true,
        defaultCoordinatesUsed: false,
        savedLatitude: null,
        savedLongitude: null,
        verificationStatus: "UNVERIFIED"
      }));

      if (onAddPharmacy) {
        onAddPharmacy(newPharmacy);
      }

      setIsSubmitting(false);
      setSuccess(true);
      
      // Reset form
      setName("");
      setNameAr("");
      setSelectedCountryId(countriesList.length === 1 ? countriesList[0].id : "");
      setSelectedDistrictId("");
      setSelectedCityId("");
      setSelectedAreaId("");
      setAddress("");
      setContact("");
      setOutstandingBalance("0");
    }, 1200);
  };

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      {/* Header and Back navigation */}
      <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <button 
            onClick={() => onNavigate && onNavigate("pharmacies-list")}
            className="p-2 rounded-xl border border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer text-slate-500"
          >
            <ArrowLeft size={16} className={isRtl ? "rotate-180" : ""} />
          </button>
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">
              {isRtl ? "تسجيل صيدلية جديدة" : "Onboard New Retail Pharmacy Outlet"}
            </h2>
            <p className="text-xxs text-slate-400">
              {isRtl ? "إضافة صيدلية أو منفذ بيع لشبكة التوزيع، وتعيين منسقي المبيعات والأرصدة المالية" : "Add retail pharmacy chains, wholesale depots, and initial AR outstanding balances."}
            </p>
          </div>
        </div>

        <button 
          onClick={() => onNavigate && onNavigate("pharmacies-list")}
          className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
        >
          {isRtl ? "عرض قائمة الصيدليات" : "View Outlets List"}
        </button>
      </div>

      {success ? (
        <div className="bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 p-8 rounded-2xl text-center space-y-4 animate-fade-in">
          <div className="mx-auto h-12 w-12 rounded-full bg-emerald-100 dark:bg-emerald-950/80 flex items-center justify-center text-emerald-600">
            <Check size={24} />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              {isRtl ? "تم تسجيل الصيدلية بنجاح!" : "Pharmacy Registered Successfully!"}
            </h3>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              {isRtl 
                ? "تمت إضافة الصيدلية بنجاح إلى شبكة التوزيع والبيع، وبإمكان مندوبي المبيعات الآن جدولة زيارات البيع والجرد وتسجيل الطلبيات المباشرة."
                : "The retail outlet profile has been securely integrated. Representatives can now schedule visits, record shelf stocks, and log collection events."
              }
            </p>
          </div>
          <div className="flex justify-center gap-3 pt-4">
            <button
              onClick={() => setSuccess(false)}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer"
            >
              {isRtl ? "إضافة صيدلية أخرى" : "Add Another Outlet"}
            </button>
            <button
              onClick={() => onNavigate && onNavigate("pharmacies-list")}
              className="px-4 py-2 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 text-slate-600 text-xs font-bold rounded-xl transition-colors cursor-pointer"
            >
              {isRtl ? "الذهاب للقائمة" : "Go to Directory"}
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl p-6 shadow-xxs space-y-6">
          {error && (
            <div className="p-3 bg-rose-50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/40 text-rose-600 dark:text-rose-400 text-xs rounded-xl flex items-center gap-2">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          {/* Core Info */}
          <div className="space-y-4">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Building size={13} className="text-indigo-500" />
              {isRtl ? "المعلومات التجارية للكيان" : "Outlet Identity Parameters"}
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xxs font-semibold text-slate-500 dark:text-slate-400">
                  {isRtl ? "اسم الصيدلية *" : "Pharmacy Name *"}
                </label>
                <input 
                  type="text" 
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Al Dhahra Grand Pharmacy"
                  className="w-full text-xs p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-transparent focus:ring-1 focus:ring-indigo-500 text-slate-900 dark:text-white"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-xxs font-semibold text-slate-500 dark:text-slate-400">
                  {isRtl ? "الاسم باللغة العربية" : "Arabic Name"}
                </label>
                <input 
                  type="text" 
                  value={nameAr}
                  onChange={(e) => setNameAr(e.target.value)}
                  placeholder="مثال: صيدلية الظهرة الكبرى"
                  className="w-full text-xs p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-transparent focus:ring-1 focus:ring-indigo-500 text-slate-900 dark:text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xxs font-semibold text-slate-500 dark:text-slate-400">
                  {isRtl ? "نوع الكيان التجاري *" : "Type *"}
                </label>
                <select 
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  className="w-full text-xs p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-transparent focus:ring-1 focus:ring-indigo-500 text-slate-800 dark:text-white dark:bg-slate-900"
                >
                  {types.map((t) => (
                    <option key={t} value={t} className="dark:bg-slate-900">{t}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xxs font-semibold text-slate-500 dark:text-slate-400">
                  {isRtl ? "إمكانيات المبيعات" : "Sales Potential"}
                </label>
                <select 
                  value={salesPotential}
                  onChange={(e) => setSalesPotential(e.target.value)}
                  className="w-full text-xs p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-transparent focus:ring-1 focus:ring-indigo-500 text-slate-800 dark:text-white dark:bg-slate-900"
                >
                  <option value="High" className="dark:bg-slate-900">High</option>
                  <option value="Medium" className="dark:bg-slate-900">Medium</option>
                  <option value="Low" className="dark:bg-slate-900">Low</option>
                </select>
              </div>
            </div>
          </div>

          {/* Geographic Hierarchy (Country, District, City, Area) */}
          <div className="border-t border-slate-100 dark:border-slate-800/50 pt-4 space-y-4">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <MapPin size={13} className="text-indigo-500" />
              {isRtl ? "التسلسل الجغرافي للنطاق" : "Geographic Hierarchy Parameters"}
            </h3>

            {loadingGeo && (
              <p className="text-xxs text-slate-400 animate-pulse">
                {isRtl ? "جاري تحميل البيانات الجغرافية المعتمدة..." : "Loading canonical geographic reference data..."}
              </p>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xxs font-semibold text-slate-500 dark:text-slate-400">
                  {isRtl ? "البلد *" : "Country *"}
                </label>
                <select
                  value={selectedCountryId}
                  onChange={(e) => handleCountryChange(e.target.value)}
                  className="w-full text-xs p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-transparent focus:ring-1 focus:ring-indigo-500 text-slate-800 dark:text-white dark:bg-slate-900"
                  required
                >
                  <option value="" className="dark:bg-slate-900">{isRtl ? "اختر البلد" : "Select Country"}</option>
                  {countriesList.map((c) => (
                    <option key={c.id} value={c.id} className="dark:bg-slate-900">{c.name}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xxs font-semibold text-slate-500 dark:text-slate-400">
                  {isRtl ? "المحافظة/المنطقة الإدارية *" : "District *"}
                </label>
                <select
                  value={selectedDistrictId}
                  onChange={(e) => handleDistrictChange(e.target.value)}
                  className="w-full text-xs p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-transparent focus:ring-1 focus:ring-indigo-500 text-slate-800 dark:text-white dark:bg-slate-900"
                  disabled={!selectedCountryId}
                  required
                >
                  <option value="" className="dark:bg-slate-900">{isRtl ? "اختر المحافظة" : "Select District"}</option>
                  {filteredDistricts.map((d) => (
                    <option key={d.id} value={d.id} className="dark:bg-slate-900">{d.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xxs font-semibold text-slate-500 dark:text-slate-400">
                  {isRtl ? "المدينة *" : "City *"}
                </label>
                <select
                  value={selectedCityId}
                  onChange={(e) => handleCityChange(e.target.value)}
                  className="w-full text-xs p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-transparent focus:ring-1 focus:ring-indigo-500 text-slate-800 dark:text-white dark:bg-slate-900"
                  disabled={!selectedDistrictId}
                  required
                >
                  <option value="" className="dark:bg-slate-900">{isRtl ? "اختر المدينة" : "Select City"}</option>
                  {filteredCities.map((c) => (
                    <option key={c.id} value={c.id} className="dark:bg-slate-900">{c.name}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xxs font-semibold text-slate-500 dark:text-slate-400">
                  {isRtl ? "المنطقة/المربع الجغرافي *" : "Area *"}
                </label>
                <select
                  value={selectedAreaId}
                  onChange={(e) => handleAreaChange(e.target.value)}
                  className="w-full text-xs p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-transparent focus:ring-1 focus:ring-indigo-500 text-slate-800 dark:text-white dark:bg-slate-900"
                  disabled={!selectedCityId}
                  required
                >
                  <option value="" className="dark:bg-slate-900">{isRtl ? "اختر المنطقة" : "Select Area"}</option>
                  {filteredAreas.map((a) => (
                    <option key={a.id} value={a.id} className="dark:bg-slate-900">{a.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Operational Region (Read Only) */}
          <div className="border-t border-slate-100 dark:border-slate-800/50 pt-4 space-y-2">
            <label className="text-xxs font-semibold text-slate-500 dark:text-slate-400 block">
              {isRtl ? "الإقليم الجغرافي العملياتي (للقراءة فقط)" : "Operational Region"}
            </label>
            <div className="w-full text-xs p-3 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 text-slate-600 dark:text-slate-300 font-medium">
              {derivedRegion ? (
                <span>{getRegionDisplayLabel(derivedRegion, isRtl)}</span>
              ) : (
                <span className="text-slate-400 italic">
                  {isRtl ? "سيتم اشتقاق الإقليم تلقائياً من المنطقة" : "Automatically derived from Area. Example: West Region (Tripoli)"}
                </span>
              )}
            </div>
            <p className="text-[10px] text-slate-400">
              {isRtl ? "يتم اشتقاقه تلقائياً استناداً إلى المنطقة المختارة أعلاه." : "This field is read-only and automatically calculated based on the selected Area hierarchy."}
            </p>
          </div>

          {/* Financials & Contacts */}
          <div className="border-t border-slate-100 dark:border-slate-800/50 pt-4 space-y-4">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <DollarSign size={13} className="text-indigo-500" />
              {isRtl ? "البيانات المالية وجهات الاتصال" : "Financial & Contact Metrics"}
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xxs font-semibold text-slate-500 dark:text-slate-400">
                  {isRtl ? "الرصيد المالي المستحق الأولي (عملة السوق) *" : "Initial AR Outstanding Balance *"}
                </label>
                <input 
                  type="number" 
                  value={outstandingBalance}
                  onChange={(e) => setOutstandingBalance(e.target.value)}
                  placeholder="0.00"
                  className="w-full text-xs p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-transparent focus:ring-1 focus:ring-indigo-500 font-mono text-slate-900 dark:text-white"
                  min="0"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-xxs font-semibold text-slate-500 dark:text-slate-400">
                  {isRtl ? "رقم هاتف الصيدلية أو الصيدلي" : "Contact Phone Number"}
                </label>
                <input 
                  type="text" 
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  placeholder="e.g. +218 91 123 4567"
                  className="w-full text-xs p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-transparent focus:ring-1 focus:ring-indigo-500 font-mono text-slate-900 dark:text-white"
                />
              </div>
            </div>
          </div>

          {/* Location & GPS */}
          <div className="border-t border-slate-100 dark:border-slate-800/50 pt-4 space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <MapPin size={13} className="text-indigo-500" />
                {isRtl ? "العنوان بالتفصيل وإحداثيات الموقع" : "Physical Address & Geotag Verification"}
              </h3>
            </div>

            <div className="space-y-1">
              <label className="text-xxs font-semibold text-slate-500 dark:text-slate-400">
                {isRtl ? "العنوان التفصيلي *" : "Street / Landmark Address *"}
              </label>
              <input 
                type="text" 
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="e.g. Al-Dhahra Street, Beside central post office"
                className="w-full text-xs p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-transparent focus:ring-1 focus:ring-indigo-500 text-slate-900 dark:text-white"
                required
              />
            </div>

            <div className="p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/50 rounded-xl text-xs text-blue-700 dark:text-blue-300 flex items-start gap-2">
              <Info className="w-4 h-4 shrink-0 mt-0.5 text-blue-500" />
              <span>
                {isRtl
                  ? "لم يتم التحقق من الموقع بعد. ستحدد أول زيارة ميدانية الموقع الجغرافي المعتمد للعميل."
                  : "Location not yet verified. The first field visit will establish the customer’s global GPS location."}
              </span>
            </div>
          </div>

          {/* Form Actions */}
          <div className="pt-4 border-t border-slate-50 dark:border-slate-800/50 flex justify-end gap-3">
            <button
              type="button"
              onClick={() => onNavigate && onNavigate("pharmacies-list")}
              className="px-4 py-2 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
            >
              {isRtl ? "إلغاء" : "Cancel"}
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition-all cursor-pointer shadow-md inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <div className="h-3 w-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>{isRtl ? "جاري التسجيل..." : "Registering..."}</span>
                </>
              ) : (
                <>
                  <PlusCircle size={15} />
                  <span>{isRtl ? "إتمام التسجيل" : "Onboard Pharmacy"}</span>
                </>
              )}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
