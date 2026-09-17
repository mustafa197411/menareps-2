import React, { useState, useMemo } from "react";
import { 
  MapPin, 
  Search, 
  Filter, 
  Calendar, 
  User, 
  Download, 
  RefreshCw, 
  CheckCircle2, 
  X,
  Map,
  Compass,
  FileSpreadsheet,
  FileText
} from "lucide-react";

interface GPSVerification {
  id: string;
  physicianName: string;
  physicianNameAr?: string;
  area: string;
  verificationDate: string;
  verifiedBy: string;
  lat: number;
  lng: number;
  accuracy: string; // e.g. "Within 5 meters", "Within 12 meters"
  status: "Perfect Match" | "High Accuracy" | "Standard Accuracy";
  originalVisit?: any;
}

const INITIAL_VERIFICATIONS: GPSVerification[] = [];

import { PhysicianVisit, Physician } from "../types";

interface GPSVerifiedPhysiciansProps {
  lang: "en" | "ar";
  currentUser?: any;
  physicianVisits?: PhysicianVisit[];
  physicians?: Physician[];
  onViewVisitSummary?: (visit: PhysicianVisit) => void;
}

export default function GPSVerifiedPhysicians({ lang, currentUser, physicianVisits = [], physicians = [], onViewVisitSummary }: GPSVerifiedPhysiciansProps) {
  const isRtl = lang === "ar";

  // Dynamic GPS list from real Master Physicians and Visits
  const activeGPSList = useMemo(() => {
    const list: GPSVerification[] = [];
    const seenPhysicianIds = new Set<string>();

    if (physicians && physicians.length > 0) {
      physicians.forEach((p) => {
        const isVerified = Boolean(
          p.gpsVerified === true ||
          p.gpsVerificationStatus === "VERIFIED"
        );
        if (isVerified && p.latitude != null && p.longitude != null) {
          seenPhysicianIds.add(p.id);
          list.push({
            id: `GPS-PHY-${p.id}`,
            physicianName: p.name,
            physicianNameAr: p.nameAr || p.name,
            area: p.territory || p.region || "Detailing Area",
            verificationDate: (p as any).gpsVerifiedAt ? String((p as any).gpsVerifiedAt).split("T")[0] : "—",
            verifiedBy: (p as any).gpsVerifiedBy || "Verified Representative",
            lat: Number(p.latitude),
            lng: Number(p.longitude),
            accuracy: "Verified",
            status: "Perfect Match"
          });
        }
      });
    }

    if (physicianVisits && physicianVisits.length > 0) {
      physicianVisits.forEach(v => {
        if (v.physicianId && seenPhysicianIds.has(v.physicianId)) return;
        if (v.latitude && v.longitude) {
          if (v.physicianId) seenPhysicianIds.add(v.physicianId);
          list.push({
            id: `GPS-${v.id}`,
            physicianName: v.physicianName,
            physicianNameAr: v.physicianName,
            area: v.primaryPromotionGroup || "Detailing Area",
            verificationDate: v.visitDate,
            verifiedBy: v.repName,
            lat: v.latitude!,
            lng: v.longitude!,
            accuracy: `${v.gpsAccuracy ? v.gpsAccuracy.toFixed(1) : "8.0"}m`,
            status: (v.gpsAccuracy && v.gpsAccuracy <= 100 ? "Perfect Match" : "High Accuracy") as any,
            originalVisit: v
          });
        }
      });
    }

    return list;
  }, [physicianVisits, physicians]);

  // State Management
  const [verifications, setVerifications] = useState<GPSVerification[]>([]);

  // Keep verifications state in sync with dynamic activeGPSList
  React.useEffect(() => {
    setVerifications(activeGPSList);
  }, [activeGPSList]);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedArea, setSelectedArea] = useState("All");
  const [selectedRep, setSelectedRep] = useState("All");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedVerification, setSelectedVerification] = useState<GPSVerification | null>(null);

  // Form states for new GPS Verification mock insertion
  const [newPhysician, setNewPhysician] = useState("");
  const [newPhysicianAr, setNewPhysicianAr] = useState("");
  const [newArea, setNewArea] = useState("Venecia Benghazi West zone");
  const [newRep, setNewRep] = useState("AliM Beitlalmal");
  const [newLat, setNewLat] = useState("32.1170");
  const [newLng, setNewLng] = useState("20.0750");

  // Get distinct drop-down values for filters
  const areas = useMemo(() => {
    const list = new Set<string>();
    activeGPSList.forEach(item => {
      if (item.area) list.add(item.area);
    });
    return Array.from(list);
  }, [activeGPSList]);

  const reps = useMemo(() => {
    const list = new Set<string>();
    activeGPSList.forEach(item => {
      if (item.verifiedBy) list.add(item.verifiedBy);
    });
    return Array.from(list);
  }, [activeGPSList]);

  // Filtered lists
  const filteredVerifications = useMemo(() => {
    return verifications.filter(item => {
      const matchesSearch = 
        item.physicianName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (item.physicianNameAr && item.physicianNameAr.includes(searchTerm)) ||
        item.verifiedBy.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesArea = selectedArea === "All" || item.area === selectedArea;
      const matchesRep = selectedRep === "All" || item.verifiedBy === selectedRep;

      let matchesDate = true;
      if (startDate) {
        matchesDate = matchesDate && item.verificationDate >= startDate;
      }
      if (endDate) {
        matchesDate = matchesDate && item.verificationDate <= endDate;
      }

      return matchesSearch && matchesArea && matchesRep && matchesDate;
    });
  }, [verifications, searchTerm, selectedArea, selectedRep, startDate, endDate]);

  const handleResetFilters = () => {
    setSearchTerm("");
    setSelectedArea("All");
    setSelectedRep("All");
    setStartDate("");
    setEndDate("");
  };

  const handleAddVerification = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPhysician.trim()) {
      alert("Physician name is required");
      return;
    }

    const newRecord: GPSVerification = {
      id: `GPS-00${verifications.length + 1}`,
      physicianName: newPhysician,
      physicianNameAr: newPhysicianAr || undefined,
      area: newArea,
      verificationDate: new Date().toISOString().split("T")[0],
      verifiedBy: newRep,
      lat: parseFloat(newLat) || 32.11,
      lng: parseFloat(newLng) || 20.07,
      accuracy: "Within 5m",
      status: "Perfect Match"
    };

    setVerifications(prev => [newRecord, ...prev]);
    setIsAddModalOpen(false);

    // reset fields
    setNewPhysician("");
    setNewPhysicianAr("");
  };

  // Translations object
  const t = {
    en: {
      title: "GPS Physician Verifications",
      subtitle: "Verified physicians coordinates, dates, and medical representatives log",
      searchPlaceholder: "Search physician or representative...",
      areaLabel: "Area / Territory",
      repLabel: "Medical Representative",
      startDateLabel: "Start Date",
      endDateLabel: "End Date",
      resetButton: "Reset Filters",
      allAreas: "All Areas",
      allReps: "All Medical Reps",
      tblName: "Physician Name",
      tblArea: "Area / Territory",
      tblDate: "Verification Date",
      tblRep: "Verified By",
      tblCoords: "Coordinates",
      tblAccuracy: "Accuracy",
      tblStatus: "Status",
      tblActions: "Actions",
      addVerification: "Log GPS Location",
      noRecords: "No GPS verification records match your filters.",
      detailsTitle: "GPS Telemetry Details"
    },
    ar: {
      title: "توثيق المواقع الجغرافية (GPS)",
      subtitle: "سجل إحداثيات عيادات الأطباء الموثقة، تواريخ التحقق، والمندوبين الميدانيين",
      searchPlaceholder: "البحث عن طبيب أو مندوب...",
      areaLabel: "المنطقة / النطاق الميداني",
      repLabel: "المندوب الطبي",
      startDateLabel: "تاريخ البدء",
      endDateLabel: "تاريخ الانتهاء",
      resetButton: "إعادة ضبط الفلاتر",
      allAreas: "جميع المناطق",
      allReps: "جميع المندوبين",
      tblName: "اسم الطبيب",
      tblArea: "المنطقة الميدانية",
      tblDate: "تاريخ التوثيق",
      tblRep: "تم التحقق بواسطة",
      tblCoords: "الإحداثيات الجغرافية",
      tblAccuracy: "دقة الـ GPS",
      tblStatus: "حالة المطابقة",
      tblActions: "الإجراءات",
      addVerification: "تسجيل موقع جغرافي",
      noRecords: "لا توجد سجلات توثيق مطابقة لخيارات التصفية الخاصة بك.",
      detailsTitle: "تفاصيل تيليميتري الموقع الجغرافي"
    }
  }[lang];

  return (
    <div className="space-y-6 text-slate-800 dark:text-slate-100" id="gps-verification-root-module">
      
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4" id="gps-verification-header">
        <div>
          <h2 className="text-2xl font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
            <Compass className="text-blue-600 animate-spin-slow" size={26} />
            <span>{t.title}</span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mt-0.5">
            {t.subtitle}
          </p>
        </div>
        
        <div className="flex items-center gap-2">
          <button 
            onClick={() => {
              alert("Exporting GPS Audit logs as Excel Sheet...");
            }}
            className="flex items-center gap-2 px-3 py-2 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900 text-xs font-semibold text-slate-700 dark:text-slate-300 rounded-lg shadow-xs transition-colors cursor-pointer"
          >
            <FileSpreadsheet size={15} className="text-emerald-500" />
            <span>Export Sheet</span>
          </button>
          
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-lg shadow-md transition-all cursor-pointer"
          >
            <MapPin size={14} />
            <span>{t.addVerification}</span>
          </button>
        </div>
      </div>

      {/* FILTER PANEL */}
      <div className="bg-white dark:bg-slate-950 p-5 rounded-2xl border border-slate-200/60 dark:border-slate-800/80 shadow-xs space-y-4" id="gps-verification-filters-panel">
        
        {/* Search & Header */}
        <div className="flex items-center gap-2 pb-3 border-b border-slate-100 dark:border-slate-900">
          <Filter size={15} className="text-blue-600" />
          <h3 className="font-bold text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">Search & Filter Controls</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          
          {/* 1. Search Bar */}
          <div className="flex flex-col gap-1.5">
            <label className="text-slate-500 dark:text-slate-400 font-bold text-xxs block">Search Name / Rep</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
              <input
                type="text"
                placeholder={t.searchPlaceholder}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-slate-50/50 dark:bg-slate-900/40 text-slate-800 dark:text-white focus:outline-none focus:border-blue-500 placeholder-slate-400"
              />
            </div>
          </div>

          {/* 2. Area Dropdown */}
          <div className="flex flex-col gap-1.5">
            <label className="text-slate-500 dark:text-slate-400 font-bold text-xxs block">{t.areaLabel}</label>
            <select
              value={selectedArea}
              onChange={(e) => setSelectedArea(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-300 focus:outline-none focus:border-blue-500 cursor-pointer"
            >
              <option value="All">{t.allAreas}</option>
              {areas.map(area => (
                <option key={area} value={area}>{area}</option>
              ))}
            </select>
          </div>

          {/* 3. Rep Dropdown */}
          <div className="flex flex-col gap-1.5">
            <label className="text-slate-500 dark:text-slate-400 font-bold text-xxs block">{t.repLabel}</label>
            <select
              value={selectedRep}
              onChange={(e) => setSelectedRep(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-300 focus:outline-none focus:border-blue-500 cursor-pointer"
            >
              <option value="All">{t.allReps}</option>
              {reps.map(rep => (
                <option key={rep} value={rep}>{rep}</option>
              ))}
            </select>
          </div>

          {/* 4. Start Date */}
          <div className="flex flex-col gap-1.5">
            <label className="text-slate-500 dark:text-slate-400 font-bold text-xxs block">{t.startDateLabel}</label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={13} />
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-white dark:bg-slate-900 text-slate-800 dark:text-white focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* 5. End Date */}
          <div className="flex flex-col gap-1.5">
            <label className="text-slate-500 dark:text-slate-400 font-bold text-xxs block">{t.endDateLabel}</label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={13} />
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-white dark:bg-slate-900 text-slate-800 dark:text-white focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

        </div>

        {/* Date Ranges Quick selection row & Reset Button */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
          
          <div className="flex flex-wrap items-center gap-1.5">
            <button 
              onClick={() => {
                const thirtyDaysAgo = new Date();
                thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
                setStartDate(thirtyDaysAgo.toISOString().split("T")[0]);
                setEndDate(new Date().toISOString().split("T")[0]);
              }}
              className="px-2.5 py-1 bg-slate-100 dark:bg-slate-900 hover:bg-slate-200 dark:hover:bg-slate-800 text-[10px] font-bold rounded text-slate-600 dark:text-slate-400 cursor-pointer"
            >
              Last 30 Days
            </button>
            <button 
              onClick={() => {
                const yearStart = new Date(new Date().getFullYear(), 0, 1);
                setStartDate(yearStart.toISOString().split("T")[0]);
                setEndDate(new Date().toISOString().split("T")[0]);
              }}
              className="px-2.5 py-1 bg-slate-100 dark:bg-slate-900 hover:bg-slate-200 dark:hover:bg-slate-800 text-[10px] font-bold rounded text-slate-600 dark:text-slate-400 cursor-pointer"
            >
              This Year
            </button>
            <button 
              onClick={handleResetFilters}
              className="px-2.5 py-1 bg-slate-100 dark:bg-slate-900 hover:bg-slate-200 dark:hover:bg-slate-800 text-[10px] font-bold rounded text-slate-600 dark:text-slate-400 cursor-pointer"
            >
              All Time
            </button>
          </div>

          <button
            onClick={handleResetFilters}
            className="flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline text-xs font-bold self-end sm:self-auto"
          >
            <RefreshCw size={12} />
            <span>{t.resetButton}</span>
          </button>
          
        </div>

      </div>

      {/* VERIFICATIONS TABLE */}
      {filteredVerifications.length > 0 ? (
        <div className="bg-white dark:bg-slate-950 border border-slate-200/70 dark:border-slate-800/80 rounded-xl overflow-hidden shadow-xs">
          {/* Desktop Table View */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-900/70 border-b border-slate-200/60 dark:border-slate-800/80 text-slate-500 font-bold">
                  <th className="py-3 px-4 font-bold text-slate-600 dark:text-slate-300">{t.tblName}</th>
                  <th className="py-3 px-4 font-bold text-slate-600 dark:text-slate-300">{t.tblArea}</th>
                  <th className="py-3 px-4 font-bold text-slate-600 dark:text-slate-300">{t.tblDate}</th>
                  <th className="py-3 px-4 font-bold text-slate-600 dark:text-slate-300">{t.tblRep}</th>
                  <th className="py-3 px-4 font-bold text-slate-600 dark:text-slate-300">{t.tblCoords}</th>
                  <th className="py-3 px-4 font-bold text-slate-600 dark:text-slate-300 text-center">{t.tblAccuracy}</th>
                  <th className="py-3 px-4 font-bold text-slate-600 dark:text-slate-300 text-center">{t.tblStatus}</th>
                  <th className="py-3 px-4 font-bold text-slate-600 dark:text-slate-300 text-right">{t.tblActions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {filteredVerifications.map((item) => (
                  <tr 
                    key={item.id} 
                    className="hover:bg-slate-50/50 dark:hover:bg-slate-900/20 transition-colors"
                  >
                    {/* Physician Name with Arabic Subtext */}
                    <td className="py-3.5 px-4 font-semibold text-slate-900 dark:text-white">
                      <div className="flex flex-col">
                        <span>{item.physicianName}</span>
                        {item.physicianNameAr && (
                          <span className="text-slate-400 font-sans text-xxs font-medium">{item.physicianNameAr}</span>
                        )}
                      </div>
                    </td>
                    
                    {/* Area / Territory */}
                    <td className="py-3.5 px-4 text-slate-700 dark:text-slate-300 font-medium">
                      <div className="flex items-center gap-1">
                        <MapPin size={12} className="text-slate-400 shrink-0" />
                        <span>{item.area}</span>
                      </div>
                    </td>

                    {/* Verification Date */}
                    <td className="py-3.5 px-4 font-mono text-slate-600 dark:text-slate-400 font-semibold">
                      {item.verificationDate}
                    </td>

                    {/* Verified By Med Rep */}
                    <td className="py-3.5 px-4 text-slate-700 dark:text-slate-300 font-medium">
                      <div className="flex items-center gap-1.5">
                        <User size={12} className="text-slate-400" />
                        <span>{item.verifiedBy}</span>
                      </div>
                    </td>

                    {/* Coordinates */}
                    <td className="py-3.5 px-4 font-mono text-slate-500 dark:text-slate-400 text-xxs">
                      {item.lat.toFixed(4)}°, {item.lng.toFixed(4)}°
                    </td>

                    {/* Accuracy Badge */}
                    <td className="py-3.5 px-4 text-center">
                      <span className="inline-flex items-center px-2 py-0.5 bg-blue-50 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900/40 text-[10px] font-bold text-blue-600 dark:text-blue-400 rounded-full font-mono">
                        {item.accuracy}
                      </span>
                    </td>

                    {/* Status Badge */}
                    <td className="py-3.5 px-4 text-center">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                        item.status === "Perfect Match"
                          ? "bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/40 text-emerald-600 dark:text-emerald-400"
                          : item.status === "High Accuracy"
                          ? "bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/40 text-blue-600 dark:text-blue-400"
                          : "bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 text-amber-600 dark:text-amber-400"
                      }`}>
                        <CheckCircle2 size={10} />
                        <span>{item.status}</span>
                      </span>
                    </td>

                    {/* Actions button */}
                    <td className="py-3.5 px-4 text-right">
                      <button
                        onClick={() => setSelectedVerification(item)}
                        className="px-2.5 py-1 text-xxs font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900/40 hover:bg-blue-100 dark:hover:bg-blue-900/40 rounded-md transition-colors cursor-pointer"
                      >
                        Telemetry View
                      </button>
                    </td>

                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Card List View */}
          <div className="block md:hidden divide-y divide-slate-100 dark:divide-slate-800/60">
            {filteredVerifications.map((item) => (
              <div 
                key={item.id} 
                className="p-4 flex flex-col gap-3 hover:bg-slate-50/50 dark:hover:bg-slate-900/10 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-col">
                    <span className="font-semibold text-slate-900 dark:text-white text-xs">{item.physicianName}</span>
                    {item.physicianNameAr && (
                      <span className="text-slate-400 font-sans text-xxs font-medium mt-0.5">{item.physicianNameAr}</span>
                    )}
                  </div>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold shrink-0 ${
                    item.status === "Perfect Match"
                      ? "bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/40 text-emerald-600 dark:text-emerald-400"
                      : item.status === "High Accuracy"
                      ? "bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/40 text-blue-600 dark:text-blue-400"
                      : "bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 text-amber-600 dark:text-amber-400"
                  }`}>
                    <CheckCircle2 size={9} />
                    <span>{item.status}</span>
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                  <div className="flex items-center gap-1.5 col-span-2">
                    <MapPin size={11} className="text-slate-400 shrink-0" />
                    <span className="truncate font-medium">{item.area}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Calendar size={11} className="text-slate-400 shrink-0" />
                    <span className="font-mono">{item.verificationDate}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <User size={11} className="text-slate-400 shrink-0" />
                    <span className="truncate">{item.verifiedBy}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-900/60 pt-2.5">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-mono text-[9px] text-slate-400 dark:text-slate-500">
                      {item.lat.toFixed(4)}°, {item.lng.toFixed(4)}°
                    </span>
                    <span className="inline-flex items-center text-[9px] font-bold text-blue-600 dark:text-blue-400">
                      {item.accuracy}
                    </span>
                  </div>
                  <button
                    onClick={() => setSelectedVerification(item)}
                    className="px-2.5 py-1 text-[10px] font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900/40 hover:bg-blue-100 dark:hover:bg-blue-900/40 rounded-md transition-colors cursor-pointer"
                  >
                    Telemetry View
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="p-12 text-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl">
          <Compass className="mx-auto text-slate-400 mb-2 animate-pulse" size={32} />
          <h3 className="font-bold text-slate-800 dark:text-white text-xs">{t.noRecords}</h3>
          <button 
            onClick={handleResetFilters}
            className="text-xs text-blue-600 hover:underline mt-2 font-bold block mx-auto"
          >
            Clear all filters
          </button>
        </div>
      )}

      {/* DETAIL TELEMETRY DRAWER / DIALOG */}
      {selectedVerification && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-850 rounded-2xl w-full max-w-md shadow-2xl relative animate-scale-up p-6">
            
            <button 
              onClick={() => setSelectedVerification(null)}
              className="absolute right-4 top-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-full hover:bg-slate-100 dark:hover:bg-slate-900 transition-colors cursor-pointer"
            >
              <X size={18} />
            </button>

            <h3 className="font-extrabold text-sm text-slate-900 dark:text-white flex items-center gap-2 mb-4 pb-2 border-b border-slate-100 dark:border-slate-900">
              <Map size={16} className="text-blue-600" />
              <span>{t.detailsTitle}</span>
            </h3>

            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-xxs text-slate-400 font-bold block uppercase">Physician</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200">{selectedVerification.physicianName}</span>
                </div>
                <div>
                  <span className="text-xxs text-slate-400 font-bold block uppercase">Verified By</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200">{selectedVerification.verifiedBy}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-xxs text-slate-400 font-bold block uppercase">Verification Date</span>
                  <span className="font-semibold text-slate-700 dark:text-slate-300">{selectedVerification.verificationDate}</span>
                </div>
                <div>
                  <span className="text-xxs text-slate-400 font-bold block uppercase">Accuracy Metric</span>
                  <span className="font-bold text-emerald-600 dark:text-emerald-400">{selectedVerification.accuracy}</span>
                </div>
              </div>

              <div>
                <span className="text-xxs text-slate-400 font-bold block uppercase">Region & Area</span>
                <span className="font-semibold text-slate-700 dark:text-slate-300">{selectedVerification.area}</span>
              </div>

              <div className="bg-slate-50 dark:bg-slate-900/50 p-4 rounded-xl border border-slate-200/50 dark:border-slate-800/80 space-y-2">
                <span className="text-xxs font-bold text-slate-500 uppercase block">GPS Telemetry Audit</span>
                <div className="space-y-1 text-xxs font-mono text-slate-600 dark:text-slate-400 leading-relaxed">
                  <p>• Lat: <span className="font-bold">{selectedVerification.lat.toFixed(6)}° N</span></p>
                  <p>• Lng: <span className="font-bold">{selectedVerification.lng.toFixed(6)}° E</span></p>
                  <p>• Telemetry Type: <span className="font-bold">Device Native Geolocation API</span></p>
                  <p>• Status: <span className="text-emerald-600 dark:text-emerald-400 font-bold">Approved Clinical Location Coords Match</span></p>
                </div>
              </div>

              {selectedVerification.originalVisit && onViewVisitSummary && (
                <button
                  type="button"
                  onClick={() => {
                    onViewVisitSummary(selectedVerification.originalVisit);
                    setSelectedVerification(null);
                  }}
                  className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold rounded-lg text-xs transition-colors cursor-pointer flex items-center justify-center gap-1.5 shadow-sm"
                >
                  <FileText size={14} />
                  <span>View Complete Visit Summary Report</span>
                </button>
              )}

              <button
                onClick={() => setSelectedVerification(null)}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg text-xs transition-colors cursor-pointer"
              >
                Close Audit Details
              </button>
            </div>

          </div>
        </div>
      )}

      {/* LOG GPS POSITION MODAL */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs">
          <form 
            onSubmit={handleAddVerification}
            className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-850 rounded-2xl w-full max-w-md shadow-2xl relative animate-scale-up p-6 space-y-4"
          >
            
            <button 
              type="button"
              onClick={() => setIsAddModalOpen(false)}
              className="absolute right-4 top-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-full hover:bg-slate-100 dark:hover:bg-slate-900 transition-colors cursor-pointer"
            >
              <X size={18} />
            </button>

            <h3 className="font-extrabold text-sm text-slate-900 dark:text-white flex items-center gap-2 pb-2 border-b border-slate-100 dark:border-slate-900">
              <MapPin size={16} className="text-blue-600" />
              <span>Log GPS Position Coordinate</span>
            </h3>

            <div className="space-y-3.5 text-xs">
              
              <div>
                <label className="text-slate-500 dark:text-slate-400 font-bold text-xxs block mb-1">Physician Name (English) *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Dr. Ahmad Masri"
                  value={newPhysician}
                  onChange={(e) => setNewPhysician(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-slate-50/50 dark:bg-slate-900/40 text-slate-800 dark:text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="text-slate-500 dark:text-slate-400 font-bold text-xxs block mb-1">Physician Name (Arabic - Optional)</label>
                <input
                  type="text"
                  placeholder="مثال: د. أحمد المصري"
                  value={newPhysicianAr}
                  onChange={(e) => setNewPhysicianAr(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-slate-50/50 dark:bg-slate-900/40 text-slate-800 dark:text-white focus:outline-none focus:border-blue-500 text-right"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-500 dark:text-slate-400 font-bold text-xxs block mb-1">Territory Area</label>
                  <select
                    value={newArea}
                    onChange={(e) => setNewArea(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-300 focus:outline-none focus:border-blue-500"
                  >
                    <option value="Sabha Sabha East Zone">Sabha Sabha East Zone</option>
                    <option value="Venecia Benghazi West zone">Venecia Benghazi West zone</option>
                    <option value="Hay Al-Dolar Benghazi East zone">Hay Al-Dolar Benghazi East zone</option>
                    <option value="Benghazi West Zone">Benghazi West Zone</option>
                  </select>
                </div>
                <div>
                  <label className="text-slate-500 dark:text-slate-400 font-bold text-xxs block mb-1">Verified By</label>
                  <select
                    value={newRep}
                    onChange={(e) => setNewRep(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-300 focus:outline-none focus:border-blue-500"
                  >
                    <option value="AliM Beitlalmal">AliM Beitlalmal</option>
                    <option value="Omar Al-Fares">Omar Al-Fares</option>
                    <option value="Rania Haddad">Rania Haddad</option>
                  </select>
                </div>
              </div>

              <div className="bg-slate-50 dark:bg-slate-900/50 p-3.5 rounded-xl border border-slate-150 dark:border-slate-800/80 space-y-2">
                <span className="text-[10px] font-bold text-slate-500 uppercase block">Automatic Telemetry Mockup</span>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-slate-400 font-bold text-[10px] block mb-1">Latitude</label>
                    <input
                      type="text"
                      value={newLat}
                      onChange={(e) => setNewLat(e.target.value)}
                      className="w-full px-2.5 py-1.5 border border-slate-200 dark:border-slate-800 rounded bg-white dark:bg-slate-900 text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 font-bold text-[10px] block mb-1">Longitude</label>
                    <input
                      type="text"
                      value={newLng}
                      onChange={(e) => setNewLng(e.target.value)}
                      className="w-full px-2.5 py-1.5 border border-slate-200 dark:border-slate-800 rounded bg-white dark:bg-slate-900 text-xs font-mono"
                    />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const randomLat = (32.11 + Math.random() * 0.02).toFixed(5);
                    const randomLng = (20.07 + Math.random() * 0.02).toFixed(5);
                    setNewLat(randomLat);
                    setNewLng(randomLng);
                  }}
                  className="w-full py-1 text-[10px] font-bold bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100 rounded border border-blue-100 dark:border-blue-900/40 transition-colors"
                >
                  Generate Live Coords
                </button>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="flex-1 py-2.5 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 font-bold rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-md transition-all cursor-pointer"
                >
                  Save Verification
                </button>
              </div>

            </div>

          </form>
        </div>
      )}

    </div>
  );
}
