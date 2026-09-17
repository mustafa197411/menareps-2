import React, { useState, useMemo } from "react";
import { MapPin, Users, Search, Filter, Download, Stethoscope, Store, X, ChevronDown } from "lucide-react";
import { User, Physician, Pharmacy, UserTerritoryAssignment, Role, normalizeRole } from "../../types";

interface TerritoryItem {
  id: string;
  name: string;
  country: string;
  district: string; // East, Centre, West
  city: string; // Al Jufra, Al Khums, Tripoli, Gharyan
  area: string; // Hun, Waddan, Sokna, Al Jufra, Gharyan-Thani, Al Khums, Abu Salim, Tajoura, Jaraba
  physiciansCount: number;
  pharmaciesCount: number;
  assignedReps: string[];
}

interface MyTerritoryProps {
  lang: "en" | "ar";
  currentUser: User;
  physicians: Physician[];
  pharmacies: Pharmacy[];
  users: User[];
  userTerritoryAssignments: UserTerritoryAssignment[];
}

export default function MyTerritory({ 
  lang,
  currentUser,
  physicians,
  pharmacies,
  users,
  userTerritoryAssignments = []
}: MyTerritoryProps) {
  const isRtl = lang === "ar";

  // Dynamically resolve real territories from Firestore state
  const initialTerritories: TerritoryItem[] = useMemo(() => {
    const areaMap = new Map<string, TerritoryItem>();
    const normalizedRole = normalizeRole(currentUser?.role);
    const isSalesRep = normalizedRole === Role.SALES_REP;
    const isMedRep = normalizedRole === Role.MEDICAL_REP;

    // Helper to validate clean geography
    const isValidGeo = (country?: string, district?: string, city?: string, area?: string) => {
      if (!country || !district || !city || !area) return false;
      const combined = `${country}/${district}/${city}/${area}`.toLowerCase();
      return !combined.includes("undefined") && !combined.includes("null") && !combined.includes("n/a");
    };

    // 1. Scan from physicians (Skipped for Sales Representatives)
    if (!isSalesRep) {
      physicians.forEach((p) => {
        if (!isValidGeo(p.country, p.district, p.city, p.area)) return;
        
        const key = `${p.country}/${p.district}/${p.city}/${p.area}`.toLowerCase();
        if (!areaMap.has(key)) {
          areaMap.set(key, {
            id: `T-${key.replace(/[^a-z0-9]/g, "-").substring(0, 10)}-${areaMap.size + 1}`,
            name: `${p.area} (${p.city}, ${p.district})`,
            country: p.country!,
            district: p.district!,
            city: p.city!,
            area: p.area!,
            physiciansCount: 0,
            pharmaciesCount: 0,
            assignedReps: [],
          });
        }
        const item = areaMap.get(key)!;
        item.physiciansCount += 1;
        if (p.assignedRepName && !item.assignedReps.includes(p.assignedRepName)) {
          item.assignedReps.push(p.assignedRepName);
        }
      });
    }

    // 2. Scan from pharmacies (Skipped for Medical Representatives)
    if (!isMedRep) {
      pharmacies.forEach((p) => {
        if ((p as any).isDeleted || p.active === false || p.status === "Inactive") return;

        const pCountry = p.country;
        const pDistrict = p.district;
        const pCity = p.city;
        const pArea = p.area || p.territory;

        if (!isValidGeo(pCountry, pDistrict, pCity, pArea)) return;

        const key = `${pCountry}/${pDistrict}/${pCity}/${pArea}`.toLowerCase();
        if (!areaMap.has(key)) {
          areaMap.set(key, {
            id: `T-${key.replace(/[^a-z0-9]/g, "-").substring(0, 10)}-${areaMap.size + 1}`,
            name: `${pArea} (${pCity}, ${pDistrict})`,
            country: pCountry!,
            district: pDistrict!,
            city: pCity!,
            area: pArea!,
            physiciansCount: 0,
            pharmaciesCount: 0,
            assignedReps: [],
          });
        }
        const item = areaMap.get(key)!;
        item.pharmaciesCount += 1;
        if (p.assignedRepName && !item.assignedReps.includes(p.assignedRepName)) {
          item.assignedReps.push(p.assignedRepName);
        }
      });
    }

    // 3. Scan userTerritoryAssignments
    userTerritoryAssignments.forEach((assignment) => {
      if (assignment.status !== "Active") return;
      if ((isMedRep || isSalesRep) && assignment.userId !== currentUser.id) return;

      const userObj = users.find(u => u.id === assignment.userId);
      const repName = userObj ? `${userObj.firstName || ""} ${userObj.lastName || ""}`.trim() || userObj.name : "";

      if (assignment.territoryName && !assignment.territoryName.includes("undefined")) {
        const areaName = assignment.territoryName;
        const matchedPhys = physicians.find(p => p.areaId === assignment.territoryId);
        const matchedPhar = pharmacies.find(p => p.areaId === assignment.territoryId);
        const country = matchedPhys?.country || matchedPhar?.country || currentUser.country || "";
        const district = matchedPhys?.district || matchedPhar?.district || currentUser.district || "District";
        const city = matchedPhys?.city || matchedPhar?.city || currentUser.city || "City";
        const area = matchedPhys?.area || matchedPhar?.area || (areaName.includes("/") ? areaName.split("/").pop()?.trim() : areaName) || areaName;

        if (!isValidGeo(country, district, city, area)) return;

        const key = `${country}/${district}/${city}/${area}`.toLowerCase();
        if (!areaMap.has(key)) {
          areaMap.set(key, {
            id: assignment.territoryId || `TA-${areaMap.size + 1}`,
            name: `${area} (${city}, ${district})`,
            country: country!,
            district: district!,
            city: city!,
            area: area!,
            physiciansCount: 0,
            pharmaciesCount: 0,
            assignedReps: [],
          });
        }
        const item = areaMap.get(key)!;
        if (repName && !item.assignedReps.includes(repName)) {
          item.assignedReps.push(repName);
        }
      }
    });

    // 4. Scan explicit currentUser area assignments (areaNames, areaIds, territories)
    const userAreas = (currentUser?.areaIds || [])
      .filter((val, idx, self) => val && typeof val === "string" && self.indexOf(val) === idx);

    userAreas.forEach((areaRef) => {
      if (!areaRef || areaRef === "-" || areaRef.includes("undefined")) return;

      const matchedPhys = physicians.filter(p => p.areaId === areaRef);
      const matchedPhar = pharmacies.filter(p => p.areaId === areaRef);

      const country = matchedPhys[0]?.country || matchedPhar[0]?.country || currentUser.country || "";
      const district = matchedPhys[0]?.district || matchedPhar[0]?.district || currentUser.district || "District";
      const city = matchedPhys[0]?.city || matchedPhar[0]?.city || currentUser.city || "City";
      const area = matchedPhys[0]?.area || matchedPhar[0]?.area || areaRef;

      const key = `${country}/${district}/${city}/${area}`.toLowerCase();
      if (!areaMap.has(key)) {
        areaMap.set(key, {
          id: `U-${key.replace(/[^a-z0-9]/g, "-").substring(0, 10)}-${areaMap.size + 1}`,
          name: `${area} (${city}, ${district})`,
          country: country,
          district: district,
          city: city,
          area: area,
          physiciansCount: isSalesRep ? 0 : matchedPhys.length,
          pharmaciesCount: isMedRep ? 0 : matchedPhar.length,
          assignedReps: [currentUser.name || `${currentUser.firstName} ${currentUser.lastName}`.trim()],
        });
      } else {
        const item = areaMap.get(key)!;
        if (!isSalesRep && item.physiciansCount === 0) item.physiciansCount = matchedPhys.length;
        if (!isMedRep && item.pharmaciesCount === 0) item.pharmaciesCount = matchedPhar.length;
        const cName = currentUser.name || `${currentUser.firstName} ${currentUser.lastName}`.trim();
        if (cName && !item.assignedReps.includes(cName)) item.assignedReps.push(cName);
      }
    });

    return Array.from(areaMap.values());
  }, [physicians, pharmacies, userTerritoryAssignments, currentUser, users]);

  // Filters State
  const [districtFilter, setDistrictFilter] = useState<string>("All");
  const [cityFilter, setCityFilter] = useState<string>("All");
  const [areaFilter, setAreaFilter] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Get unique options dynamically
  const districtOptions = useMemo(() => {
    const districts = new Set(initialTerritories.map(t => t.district));
    return ["All", ...Array.from(districts)];
  }, [initialTerritories]);

  const cityOptions = useMemo(() => {
    const filtered = districtFilter === "All" 
      ? initialTerritories 
      : initialTerritories.filter(t => t.district === districtFilter);
    const cities = new Set(filtered.map(t => t.city));
    return ["All", ...Array.from(cities)];
  }, [districtFilter, initialTerritories]);

  const areaOptions = useMemo(() => {
    const filtered = initialTerritories.filter(t => {
      const matchDistrict = districtFilter === "All" || t.district === districtFilter;
      const matchCity = cityFilter === "All" || t.city === cityFilter;
      return matchDistrict && matchCity;
    });
    const areas = new Set(filtered.map(t => t.area));
    return ["All", ...Array.from(areas)];
  }, [districtFilter, cityFilter, initialTerritories]);

  // Filter territories
  const filteredTerritories = useMemo(() => {
    return initialTerritories.filter(t => {
      const matchesDistrict = districtFilter === "All" || t.district === districtFilter;
      const matchesCity = cityFilter === "All" || t.city === cityFilter;
      const matchesArea = areaFilter === "All" || t.area === areaFilter;
      const matchesSearch = searchQuery === "" || 
        t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.area.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.city.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.district.toLowerCase().includes(searchQuery.toLowerCase());

      return matchesDistrict && matchesCity && matchesArea && matchesSearch;
    });
  }, [districtFilter, cityFilter, areaFilter, searchQuery, initialTerritories]);

  // Aggregate Stats
  const stats = useMemo(() => {
    const totalTerritories = filteredTerritories.length;
    let totalPhysicians = 0;
    let totalPharmacies = 0;
    const uniqueReps = new Set<string>();

    filteredTerritories.forEach(t => {
      totalPhysicians += t.physiciansCount;
      totalPharmacies += t.pharmaciesCount;
      t.assignedReps.forEach(rep => uniqueReps.add(rep));
    });

    return {
      totalTerritories,
      totalPhysicians,
      totalPharmacies,
      totalReps: uniqueReps.size
    };
  }, [filteredTerritories]);

  const handleClearFilters = () => {
    setDistrictFilter("All");
    setCityFilter("All");
    setAreaFilter("All");
    setSearchQuery("");
  };

  return (
    <div className="space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900 flex items-center gap-2">
            <MapPin className="h-6 w-6 text-blue-600" />
            {isRtl ? "إقليمي الجغرافي المعين" : "My Territory"}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {isRtl ? "إدارة وتصفية نطاقات التغطية والمنشآت المخصصة لك" : "Manage your assigned areas and contacts"}
          </p>
        </div>
        <div>
          <button 
            onClick={() => alert(isRtl ? "جاري تصدير بيانات الإقليم كملف CSV..." : "Exporting territory data as CSV...")}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg shadow-sm hover:bg-gray-50 transition-colors"
          >
            <Download className="h-4 w-4" />
            {isRtl ? "تصدير" : "Export"}
          </button>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">
              {isRtl ? "الأقاليم والمناطق" : "Territories"}
            </p>
            <h3 className="text-2xl font-bold text-gray-950 mt-1">{stats.totalTerritories}</h3>
          </div>
          <div className="p-3 bg-blue-50 text-blue-600 rounded-lg">
            <MapPin className="h-6 w-6" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">
              {isRtl ? "الأطباء المستهدفين" : "Physicians"}
            </p>
            <h3 className="text-2xl font-bold text-gray-950 mt-1">
              {stats.totalPhysicians}
            </h3>
          </div>
          <div className="p-3 bg-emerald-50 text-emerald-600 rounded-lg">
            <Stethoscope className="h-6 w-6" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">
              {isRtl ? "الصيدليات المعتمدة" : "Pharmacies"}
            </p>
            <h3 className="text-2xl font-bold text-gray-950 mt-1">
              {stats.totalPharmacies}
            </h3>
          </div>
          <div className="p-3 bg-purple-50 text-purple-600 rounded-lg">
            <Store className="h-6 w-6" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">
              {isRtl ? "فريق العمل الميداني" : "Team Members"}
            </p>
            <h3 className="text-2xl font-bold text-gray-950 mt-1">
              {stats.totalReps}
            </h3>
          </div>
          <div className="p-3 bg-indigo-50 text-indigo-600 rounded-lg">
            <Users className="h-6 w-6" />
          </div>
        </div>
      </div>

      {/* Advanced Filter Panel */}
      <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-gray-100 pb-2">
          <span className="text-sm font-semibold text-gray-800 flex items-center gap-2">
            <Filter className="h-4 w-4 text-blue-600" />
            {isRtl ? "تصفية متقدمة للأقاليم" : "Filter Territories"}
          </span>
          {(districtFilter !== "All" || cityFilter !== "All" || areaFilter !== "All" || searchQuery !== "") && (
            <button 
              onClick={handleClearFilters}
              className="text-xs font-medium text-red-600 hover:underline flex items-center gap-1"
            >
              <X className="h-3 w-3" />
              {isRtl ? "إعادة تعيين" : "Reset Filters"}
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          {/* District Filter */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">
              {isRtl ? "المنطقة / المقاطعة (District)" : "District"}
            </label>
            <div className="relative">
              <select
                value={districtFilter}
                onChange={(e) => {
                  setDistrictFilter(e.target.value);
                  setCityFilter("All");
                  setAreaFilter("All");
                }}
                className="w-full text-sm pl-3 pr-10 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 appearance-none transition-all"
              >
                {districtOptions.map(opt => (
                  <option key={opt} value={opt}>
                    {opt === "All" ? (isRtl ? "كل المقاطعات" : "All Districts") : opt}
                  </option>
                ))}
              </select>
              <ChevronDown className={`absolute right-3 top-2.5 h-4 w-4 text-gray-400 pointer-events-none ${isRtl ? 'left-3 right-auto' : ''}`} />
            </div>
          </div>

          {/* City Filter */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">
              {isRtl ? "المدينة (City)" : "City"}
            </label>
            <div className="relative">
              <select
                value={cityFilter}
                onChange={(e) => {
                  setCityFilter(e.target.value);
                  setAreaFilter("All");
                }}
                className="w-full text-sm pl-3 pr-10 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 appearance-none transition-all"
              >
                {cityOptions.map(opt => (
                  <option key={opt} value={opt}>
                    {opt === "All" ? (isRtl ? "كل المدن" : "All Cities") : opt}
                  </option>
                ))}
              </select>
              <ChevronDown className={`absolute right-3 top-2.5 h-4 w-4 text-gray-400 pointer-events-none ${isRtl ? 'left-3 right-auto' : ''}`} />
            </div>
          </div>

          {/* Area Filter */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">
              {isRtl ? "المنطقة الفرعية (Area)" : "Area"}
            </label>
            <div className="relative">
              <select
                value={areaFilter}
                onChange={(e) => setAreaFilter(e.target.value)}
                className="w-full text-sm pl-3 pr-10 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 appearance-none transition-all"
              >
                {areaOptions.map(opt => (
                  <option key={opt} value={opt}>
                    {opt === "All" ? (isRtl ? "كل النطاقات الفرعية" : "All Areas") : opt}
                  </option>
                ))}
              </select>
              <ChevronDown className={`absolute right-3 top-2.5 h-4 w-4 text-gray-400 pointer-events-none ${isRtl ? 'left-3 right-auto' : ''}`} />
            </div>
          </div>

          {/* Search bar (Territory) */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">
              {isRtl ? "البحث عن إقليم" : "Search Territory Name"}
            </label>
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={isRtl ? "ابحث باسم الإقليم..." : "Search territories..."}
                className="w-full text-sm pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              />
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
            </div>
          </div>
        </div>
      </div>

      {/* Territories Section */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-gray-800">
          {isRtl ? "الأقاليم الجغرافية المعينة" : "Assigned Territories"}
        </h3>

        {filteredTerritories.length === 0 ? (
          <div className="bg-gray-50 border border-dashed border-gray-200 rounded-xl p-8 text-center text-gray-500">
            <MapPin className="h-10 w-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm font-medium">
              {isRtl ? "لا توجد أقاليم مطابقة لمعايير التصفية الحالية" : "No territories matches the current filter criteria."}
            </p>
            <button 
              onClick={handleClearFilters}
              className="mt-3 text-xs text-blue-600 font-semibold hover:underline"
            >
              {isRtl ? "مسح التصفية" : "Clear filters"}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredTerritories.map((t) => (
              <div 
                key={t.id}
                className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm hover:shadow-md hover:border-blue-100 transition-all flex flex-col justify-between space-y-4"
              >
                <div>
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="text-md font-semibold text-gray-900 leading-snug">{t.name}</h4>
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600 mt-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                        {`area: ${t.country} > ${t.district} > ${t.city} > ${t.area}`}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 mt-5">
                    <div className="flex items-center gap-2 text-gray-600">
                      <Stethoscope className="h-4 w-4 text-emerald-500" />
                      <div className="text-xs">
                        <span className="font-bold text-gray-950 block">{t.physiciansCount}</span>
                        {isRtl ? "الأطباء" : "Physicians"}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-gray-600">
                      <Store className="h-4 w-4 text-purple-500" />
                      <div className="text-xs">
                        <span className="font-bold text-gray-950 block">{t.pharmaciesCount}</span>
                        {isRtl ? "الصيدليات" : "Pharmacies"}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="border-t border-gray-50 pt-3 mt-2">
                  <span className="text-xs font-medium text-gray-400 block mb-1.5">
                    {isRtl ? "المندوبون المعينون:" : "Assigned Reps:"}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {t.assignedReps.map((rep, idx) => {
                      const initials = rep.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
                      return (
                        <div key={idx} className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50/50 border border-blue-100 text-blue-700 rounded-lg text-[11px] font-medium">
                          <span className="w-4 h-4 rounded-full bg-blue-100 text-[9px] text-blue-800 font-bold flex items-center justify-center">
                            {initials}
                          </span>
                          {rep}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
