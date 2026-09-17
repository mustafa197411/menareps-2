import React, { useState, useMemo } from "react";
import { getVisitBusinessNumber } from "../utils/visitNumberUtils";
import { 
  MapPin, 
  Search, 
  Filter, 
  Calendar, 
  Store, 
  User as UserIcon, 
  Download, 
  RefreshCw, 
  CheckCircle2, 
  X,
  Map as MapIcon,
  Compass,
  FileSpreadsheet,
  ShieldCheck,
  Building2
} from "lucide-react";
import { User, PharmacyVisit, Pharmacy } from "../types";
import { INITIAL_AREAS } from "../lib/alignmentService";
import { 
  resolvePharmacyGpsVerificationStatus, 
  getAuthorizedUserIds, 
  getAuthorizedAreaIds,
  isValidGpsCoordinate,
  VisitGpsVerificationStatus
} from "../features/pharmacyVisit/utils/gpsVerificationResolver";

export interface GPSVerificationRecord {
  id: string;
  pharmacyId: string;
  pharmacyName: string;
  pharmacyNameAr?: string;
  areaId: string;
  geographicPath: string;
  verificationDate: string;
  verifiedByUid: string;
  verifiedByName: string;
  lat: number;
  lng: number;
  accuracyMeters: number | null;
  status: VisitGpsVerificationStatus;
  visitId: string | null;
  visitDisplayNumber: string | null;
  source: string | null;
}

export function toSafeDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof (value as any)?.toDate === "function") {
    const d = (value as any).toDate();
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
  }
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function formatVerificationDate(rawDate: unknown): string {
  if (!rawDate) return "—";
  if (typeof rawDate === "string") {
    return rawDate.includes("T") ? rawDate.split("T")[0] : rawDate;
  }
  const safeDate = toSafeDate(rawDate);
  if (safeDate) {
    return safeDate.toISOString().split("T")[0];
  }
  return "—";
}

function formatGeographicPath(entity: any): string {
  if (entity?.fullPath || entity?.geographicPath) {
    return entity.fullPath || entity.geographicPath;
  }
  const country = entity?.countryName || entity?.countryId || entity?.country || "";
  const district = entity?.districtName || entity?.district || entity?.districtId || "";
  const city = entity?.cityName || entity?.city || entity?.cityId || "";
  const area = entity?.areaName || entity?.area || entity?.territory || entity?.areaId || "";

  const parts = [country, district, city, area].filter(p => p && p !== "—" && p !== "Unknown" && p !== "Undefined");
  if (parts.length > 0) {
    return parts.join(" / ");
  }
  return "Geography Repair Required";
}

interface GPSVerifiedPharmaciesProps {
  lang: "en" | "ar";
  currentUser?: User;
  users?: User[];
  pharmacyVisits?: PharmacyVisit[];
  pharmacies?: Pharmacy[];
}

export default function GPSVerifiedPharmacies({
  lang,
  currentUser,
  users = [],
  pharmacyVisits = [],
  pharmacies = []
}: GPSVerifiedPharmaciesProps) {
  const isRtl = lang === "ar";

  // Derive authorized user set & area set
  const authorizedUids = useMemo(() => {
    if (!currentUser) return [];
    return getAuthorizedUserIds(currentUser, users);
  }, [currentUser, users]);

  const authorizedAreaIds = useMemo(() => {
    if (!currentUser) return [];
    return getAuthorizedAreaIds(currentUser, users);
  }, [currentUser, users]);

  // Build canonical GPS Verified list from real Master Pharmacies and Completed Visits
  const activeGPSList = useMemo(() => {
    const list: GPSVerificationRecord[] = [];
    const seenPharmacyIds = new Set<string>();

    const userMap = new Map<string, User>();
    users.forEach(u => userMap.set(u.id, u));

    // 1. Process Master Pharmacies
    pharmacies.forEach((p, idx) => {
      const pAny = p as any;

      // Role & Area Access Check
      if (authorizedAreaIds.length > 0 && p.areaId) {
        if (!authorizedAreaIds.includes(p.areaId)) {
          return;
        }
      }

      // Find latest completed visit for this pharmacy if any
      const matchingVisit = pharmacyVisits.find(
        v => v.pharmacyId === p.id && ((v as any).status || "COMPLETED") === "COMPLETED"
      );

      const resolution = resolvePharmacyGpsVerificationStatus({
        visit: matchingVisit,
        pharmacy: p
      });

      if (resolution.verified && resolution.latitude && resolution.longitude) {
        seenPharmacyIds.add(p.id);

        const repUid = resolution.verifiedByUid || pAny.gpsVerifiedByUid || pAny.createdBy || "";
        const repUser = userMap.get(repUid);
        const repName = repUser?.name || pAny.gpsVerifiedByName || repUid || (isRtl ? "مستخدم محقق" : "Verified Representative");

        const geoPath = formatGeographicPath(p);

        list.push({
          id: `GPS-PHAR-${p.id}`,
          pharmacyId: p.id,
          pharmacyName: p.name || "Pharmacy",
          pharmacyNameAr: p.nameAr || p.name,
          areaId: p.areaId || "",
          geographicPath: geoPath,
          verificationDate: formatVerificationDate(resolution.capturedAt || pAny.gpsVerifiedAt),
          verifiedByUid: repUid,
          verifiedByName: repName,
          lat: resolution.latitude,
          lng: resolution.longitude,
          accuracyMeters: resolution.accuracyMeters,
          status: resolution.status,
          visitId: resolution.verifiedVisitId || matchingVisit?.id || null,
          visitDisplayNumber: getVisitBusinessNumber(matchingVisit, idx, "PV"),
          source: resolution.source
        });
      }
    });

    // 2. Process Completed Visits for pharmacies not already captured
    pharmacyVisits.forEach((v, idx) => {
      if (!v.pharmacyId || seenPharmacyIds.has(v.pharmacyId)) return;

      const repUid = v.repId || (v as any).repUid || (v as any).createdBy || "";
      if (authorizedUids.length > 0 && repUid && !authorizedUids.includes(repUid)) {
        return;
      }

      const resolution = resolvePharmacyGpsVerificationStatus({ visit: v });
      if (resolution.verified && resolution.latitude && resolution.longitude) {
        seenPharmacyIds.add(v.pharmacyId);

        const repUser = userMap.get(repUid);
        const repName = repUser?.name || v.repName || repUid || "Representative";

        const targetPharm = pharmacies.find(p => p.id === v.pharmacyId);
        const geoPath = formatGeographicPath(targetPharm || v);

        list.push({
          id: `GPS-VISIT-${v.id}`,
          pharmacyId: v.pharmacyId,
          pharmacyName: v.pharmacyName || (v as any).pharmacySnapshot?.nameEn || "Pharmacy",
          pharmacyNameAr: (v as any).pharmacySnapshot?.nameAr || v.pharmacyName,
          areaId: (v as any).areaId || targetPharm?.areaId || "",
          geographicPath: geoPath,
          verificationDate: formatVerificationDate(v.visitDate || (v as any).date),
          verifiedByUid: repUid,
          verifiedByName: repName,
          lat: resolution.latitude,
          lng: resolution.longitude,
          accuracyMeters: resolution.accuracyMeters,
          status: resolution.status,
          visitId: v.id,
          visitDisplayNumber: getVisitBusinessNumber(v, idx, "PV"),
          source: resolution.source
        });
      }
    });

    return list;
  }, [pharmacies, pharmacyVisits, users, authorizedUids, authorizedAreaIds, isRtl]);

  // Filter States
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedArea, setSelectedArea] = useState("ALL");
  const [selectedRepUid, setSelectedRepUid] = useState("ALL");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedRecord, setSelectedRecord] = useState<GPSVerificationRecord | null>(null);

  // Dynamic filter dropdown options
  const areaFilterOptions = useMemo(() => {
    const list: { id: string; name: string }[] = [];
    const seen = new Set<string>();

    INITIAL_AREAS.forEach(a => {
      if (authorizedAreaIds.length === 0 || authorizedAreaIds.includes(a.id)) {
        if (!seen.has(a.id)) {
          seen.add(a.id);
          list.push({ id: a.id, name: a.name });
        }
      }
    });

    activeGPSList.forEach(item => {
      if (item.areaId && !seen.has(item.areaId)) {
        seen.add(item.areaId);
        list.push({ id: item.areaId, name: item.areaId });
      }
    });

    return list;
  }, [authorizedAreaIds, activeGPSList]);

  const repFilterOptions = useMemo(() => {
    const list: { uid: string; name: string }[] = [];
    const seen = new Set<string>();

    users.forEach(u => {
      if (authorizedUids.length === 0 || authorizedUids.includes(u.id)) {
        if (!seen.has(u.id)) {
          seen.add(u.id);
          list.push({ uid: u.id, name: `${u.name} (${u.role})` });
        }
      }
    });

    activeGPSList.forEach(item => {
      if (item.verifiedByUid && !seen.has(item.verifiedByUid)) {
        seen.add(item.verifiedByUid);
        list.push({ uid: item.verifiedByUid, name: item.verifiedByName });
      }
    });

    return list;
  }, [users, authorizedUids, activeGPSList]);

  // Filtered List
  const filteredRecords = useMemo(() => {
    return activeGPSList.filter(item => {
      const matchesSearch = 
        item.pharmacyName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (item.pharmacyNameAr && item.pharmacyNameAr.includes(searchTerm)) ||
        item.verifiedByName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.geographicPath.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (item.visitDisplayNumber && item.visitDisplayNumber.toLowerCase().includes(searchTerm.toLowerCase()));

      const matchesArea = selectedArea === "ALL" || item.areaId === selectedArea || item.geographicPath.includes(selectedArea);
      const matchesRep = selectedRepUid === "ALL" || item.verifiedByUid === selectedRepUid;

      let matchesDate = true;
      if (startDate) {
        matchesDate = matchesDate && item.verificationDate >= startDate;
      }
      if (endDate) {
        matchesDate = matchesDate && item.verificationDate <= endDate;
      }

      return matchesSearch && matchesArea && matchesRep && matchesDate;
    });
  }, [activeGPSList, searchTerm, selectedArea, selectedRepUid, startDate, endDate]);

  const handleResetFilters = () => {
    setSearchTerm("");
    setSelectedArea("ALL");
    setSelectedRepUid("ALL");
    setStartDate("");
    setEndDate("");
  };

  const handleExportCSV = () => {
    const headers = [
      "Pharmacy Name",
      "Geographic Path",
      "Status",
      "Verified Date",
      "Verified By",
      "Latitude",
      "Longitude",
      "Accuracy (m)",
      "Visit Number"
    ];

    const rows = filteredRecords.map((r, idx) => [
      `"${r.pharmacyName.replace(/"/g, '""')}"`,
      `"${r.geographicPath.replace(/"/g, '""')}"`,
      r.status,
      r.verificationDate,
      `"${r.verifiedByName.replace(/"/g, '""')}"`,
      r.lat,
      r.lng,
      r.accuracyMeters != null ? r.accuracyMeters.toFixed(1) : "—",
      getVisitBusinessNumber(r.visitDisplayNumber || r.visitId, idx, "PV")
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `GPS_Verified_Pharmacies_${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="p-2 bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 rounded-xl">
              <ShieldCheck className="w-6 h-6" />
            </span>
            <h1 className="text-2xl font-black text-slate-900 dark:text-white">
              {isRtl ? "الصيدليات الموثقة جغرافياً (GPS)" : "GPS Verified Pharmacies"}
            </h1>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {isRtl 
              ? "سجل الصيدليات التي تم التقاط إحداثياتها وتوثيق إثبات الموقع الجغرافي لها من الزيارات الميدانية"
              : "Master record of pharmacies with verified GPS location evidence captured during live visits"}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleExportCSV}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs transition-colors shadow-xs cursor-pointer"
          >
            <Download size={14} />
            <span>{isRtl ? "تصدير CSV" : "Export CSV"}</span>
          </button>
        </div>
      </div>

      {/* Role-Scoped Filter Panel */}
      <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300">
            <Filter size={14} className="text-indigo-600" />
            <span>{isRtl ? "فلترة البحث المصرحة" : "Role-Scoped Verification Filters"}</span>
          </div>
          <button
            onClick={handleResetFilters}
            className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
          >
            {isRtl ? "إعادة ضبط" : "Reset Filters"}
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Search Term */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-600 dark:text-slate-400">
              {isRtl ? "البحث بالاسم / المسار" : "Search Pharmacy / Path"}
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-2.5 text-slate-400" size={14} />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={isRtl ? "ابحث باسم الصيدلية..." : "Search pharmacy name..."}
                className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          {/* Role-Scoped Area Filter */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-600 dark:text-slate-400">
              {isRtl ? "المنطقة المصرحة" : "Authorized Territory / Area"}
            </label>
            <select
              value={selectedArea}
              onChange={(e) => setSelectedArea(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="ALL">{isRtl ? "جميع المناطق المصرحة" : "All Authorized Areas"}</option>
              {areaFilterOptions.map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>

          {/* Role-Scoped Representative Filter */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-600 dark:text-slate-400">
              {isRtl ? "المندوب الموثق" : "Verifying Representative"}
            </label>
            <select
              value={selectedRepUid}
              onChange={(e) => setSelectedRepUid(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="ALL">{isRtl ? "جميع المندوبين المصرحين" : "All Authorized Reps"}</option>
              {repFilterOptions.map(r => (
                <option key={r.uid} value={r.uid}>{r.name}</option>
              ))}
            </select>
          </div>

          {/* Date Filter */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-600 dark:text-slate-400">
              {isRtl ? "تاريخ التوثيق" : "Verification Date"}
            </label>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-2 py-1.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl text-[11px] text-slate-900 dark:text-white font-medium"
              />
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-2 py-1.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl text-[11px] text-slate-900 dark:text-white font-medium"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Main Data Table */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-wider">
              {isRtl ? "قائمة التوثيقات المعتمدة" : "Verified GPS Records"}
            </span>
            <span className="px-2.5 py-0.5 bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 font-bold rounded-full text-xs">
              {filteredRecords.length}
            </span>
          </div>
        </div>

        {filteredRecords.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <div className="w-12 h-12 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mx-auto text-slate-400">
              <MapPin size={24} />
            </div>
            <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
              {isRtl ? "لا توجد صيدليات موثقة تطابق معايير البحث" : "No GPS verified pharmacies found matching criteria"}
            </p>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              {isRtl
                ? "يتم إدراج الصيدليات تلقائياً فور إكمال أول زيارة ميدانية بنجاح باستخدام التقاط GPS دقيق"
                : "Pharmacies will automatically appear here once verified during live representative field visits."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  <th className="py-3.5 px-4">{isRtl ? "الصيدلية" : "Pharmacy"}</th>
                  <th className="py-3.5 px-4">{isRtl ? "المسار الجغرافي" : "Geographic Path"}</th>
                  <th className="py-3.5 px-4">{isRtl ? "حالة التوثيق" : "GPS Status"}</th>
                  <th className="py-3.5 px-4">{isRtl ? "المندوب" : "Verified By"}</th>
                  <th className="py-3.5 px-4">{isRtl ? "التاريخ" : "Verified Date"}</th>
                  <th className="py-3.5 px-4">{isRtl ? "الإحداثيات والراحة" : "Coordinates / Accuracy"}</th>
                  <th className="py-3.5 px-4 text-right">{isRtl ? "الخيارات" : "Action"}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs font-medium text-slate-800 dark:text-slate-200">
                {filteredRecords.map(item => (
                  <tr key={item.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-slate-900 dark:text-white">
                        {item.pharmacyName}
                      </div>
                      {item.pharmacyNameAr && item.pharmacyNameAr !== item.pharmacyName && (
                        <div className="text-[11px] text-slate-500 font-arabic">
                          {item.pharmacyNameAr}
                        </div>
                      )}
                    </td>

                    <td className="py-3.5 px-4">
                      <span className="text-[11px] font-mono text-slate-600 dark:text-slate-400">
                        {item.geographicPath}
                      </span>
                    </td>

                    <td className="py-3.5 px-4">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        item.status === "FIRST_VISIT_CAPTURED"
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                          : item.status === "VERIFIED_PREVIOUSLY"
                          ? "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300"
                          : "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300"
                      }`}>
                        <CheckCircle2 size={11} />
                        {item.status === "FIRST_VISIT_CAPTURED"
                          ? (isRtl ? "توثيق الزيارة الأولى" : "First Visit Captured")
                          : item.status === "VERIFIED_PREVIOUSLY"
                          ? (isRtl ? "متحقق سابقاً" : "Verified Previously")
                          : (isRtl ? "إعادة توثيق" : "Reverified")}
                      </span>
                    </td>

                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-slate-800 dark:text-slate-200">
                        {item.verifiedByName}
                      </div>
                      {item.visitDisplayNumber && (
                        <div className="text-[10px] font-mono text-indigo-600 dark:text-indigo-400">
                          Visit: {item.visitDisplayNumber}
                        </div>
                      )}
                    </td>

                    <td className="py-3.5 px-4 text-slate-600 dark:text-slate-400 font-mono text-[11px]">
                      {item.verificationDate}
                    </td>

                    <td className="py-3.5 px-4">
                      <div className="font-mono text-[11px] text-slate-900 dark:text-white">
                        {item.lat.toFixed(4)}, {item.lng.toFixed(4)}
                      </div>
                      <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold">
                        Accuracy: {item.accuracyMeters != null ? `${item.accuracyMeters.toFixed(1)}m` : "High"}
                      </div>
                    </td>

                    <td className="py-3.5 px-4 text-right">
                      <button
                        onClick={() => setSelectedRecord(item)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 rounded-lg text-xs font-bold cursor-pointer"
                      >
                        <MapIcon size={12} />
                        <span>{isRtl ? "المعاينة" : "Inspect"}</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail Inspection Modal */}
      {selectedRecord && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <MapPin className="text-emerald-600" size={20} />
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                  {selectedRecord.pharmacyName}
                </h3>
              </div>
              <button
                onClick={() => setSelectedRecord(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-200 dark:border-slate-700 space-y-1">
                <div className="text-[10px] uppercase font-bold text-slate-500">Geographic Path</div>
                <div className="font-mono font-bold text-slate-900 dark:text-white">{selectedRecord.geographicPath}</div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-200 dark:border-slate-700 space-y-1">
                  <div className="text-[10px] uppercase font-bold text-slate-500">Coordinates</div>
                  <div className="font-mono font-bold text-indigo-600 dark:text-indigo-400">
                    {selectedRecord.lat}, {selectedRecord.lng}
                  </div>
                </div>

                <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-200 dark:border-slate-700 space-y-1">
                  <div className="text-[10px] uppercase font-bold text-slate-500">GPS Accuracy</div>
                  <div className="font-mono font-bold text-emerald-600">
                    {selectedRecord.accuracyMeters != null ? `${selectedRecord.accuracyMeters.toFixed(1)} meters` : "High Accuracy"}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-200 dark:border-slate-700 space-y-1">
                  <div className="text-[10px] uppercase font-bold text-slate-500">Verified Representative</div>
                  <div className="font-bold text-slate-900 dark:text-white">{selectedRecord.verifiedByName}</div>
                </div>

                <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-200 dark:border-slate-700 space-y-1">
                  <div className="text-[10px] uppercase font-bold text-slate-500">Visit Number</div>
                  <div className="font-mono font-bold text-slate-900 dark:text-white">
                    {getVisitBusinessNumber(selectedRecord.visitDisplayNumber || selectedRecord.visitId, undefined, "PV")}
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setSelectedRecord(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold rounded-xl text-xs transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
