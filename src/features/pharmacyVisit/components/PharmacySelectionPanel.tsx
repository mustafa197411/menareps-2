import React, { useState, useMemo } from "react";
import { Pharmacy, User } from "../../../types";
import { Search, Store, Calendar, MapPin, CheckCircle, ShieldCheck, Tag } from "lucide-react";

interface PharmacySelectionPanelProps {
  currentUser: User;
  authorizedPharmacies: Pharmacy[];
  selectedPharmacyId?: string;
  onSelectPharmacy: (pharmacy: Pharmacy) => void;
  lang: "en" | "ar";
}

export const PharmacySelectionPanel: React.FC<PharmacySelectionPanelProps> = ({
  currentUser,
  authorizedPharmacies,
  selectedPharmacyId,
  onSelectPharmacy,
  lang
}) => {
  const isRtl = lang === "ar";
  const [activeTab, setActiveTab] = useState<"PLAN" | "ALL">("ALL");
  const [searchTerm, setSearchTerm] = useState("");

  const filteredPharmacies = useMemo(() => {
    if (!searchTerm.trim()) return authorizedPharmacies;
    const term = searchTerm.toLowerCase().trim();
    return authorizedPharmacies.filter(
      (p) =>
        ((p as any).nameEn || p.name)?.toLowerCase().includes(term) ||
        p.nameAr?.includes(term) ||
        p.address?.toLowerCase().includes(term) ||
        p.areaName?.toLowerCase().includes(term) ||
        p.id.toLowerCase().includes(term)
    );
  }, [authorizedPharmacies, searchTerm]);

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <Store className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            {isRtl ? "اختيار الصيدلية المعتمدة" : "Select Authorized Pharmacy"}
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {isRtl
              ? "تعرض فقط الصيدليات المعتمدة ضمن منطقتك الجغرافية المخصصة"
              : "Showing authorized active pharmacies in your assigned geographic area"}
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-lg self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setActiveTab("ALL")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              activeTab === "ALL"
                ? "bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 shadow-xs"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
            }`}
          >
            {isRtl ? "جميع الصيدليات" : "All Pharmacies"} ({authorizedPharmacies.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("PLAN")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 ${
              activeTab === "PLAN"
                ? "bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 shadow-xs"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
            }`}
          >
            <Calendar className="w-3.5 h-3.5" />
            {isRtl ? "خطة اليوم" : "Today's Plan"}
          </button>
        </div>
      </div>

      {/* Search Input */}
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder={
            isRtl
              ? "ابحث باسم الصيدلية، باللغة العربية أو الإنجليزية، أو اسم المنطقة..."
              : "Search by pharmacy name (EN/AR), area, code, or address..."
          }
          className="w-full pl-9 pr-4 py-2 text-xs bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-slate-100 placeholder-slate-400"
        />
      </div>

      {/* Content Grid */}
      {activeTab === "PLAN" ? (
        <div className="p-6 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50/50 dark:bg-slate-800/30">
          <Calendar className="w-8 h-8 text-slate-400 mx-auto mb-2" />
          <p className="text-xs text-slate-600 dark:text-slate-400">
            {isRtl
              ? "لا توجد زيارات صيدليات صريحة في خطة المبيعات لليوم."
              : "No specific planned pharmacy visits scheduled for today in Sales Planner."}
          </p>
          <button
            type="button"
            onClick={() => setActiveTab("ALL")}
            className="mt-3 text-xs font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 underline"
          >
            {isRtl ? "الانتقال لقائمة الصيدليات" : "Browse all authorized pharmacies"}
          </button>
        </div>
      ) : filteredPharmacies.length === 0 ? (
        <div className="p-6 text-center border border-slate-200 dark:border-slate-800 rounded-xl">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {isRtl ? "لم يتم العثور على صيدليات طابقت بحثك." : "No authorized pharmacies match your search query."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-80 overflow-y-auto pr-1">
          {filteredPharmacies.map((pharmacy) => {
            const isSelected = selectedPharmacyId === pharmacy.id;
            return (
              <div
                key={pharmacy.id}
                onClick={() => onSelectPharmacy(pharmacy)}
                className={`cursor-pointer p-3.5 rounded-xl border transition-all relative ${
                  isSelected
                    ? "border-indigo-600 dark:border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/30 ring-1 ring-indigo-500"
                    : "border-slate-200 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-800/20 hover:border-indigo-300 dark:hover:border-indigo-700"
                }`}
              >
                {isSelected && (
                  <CheckCircle className="w-4 h-4 text-indigo-600 dark:text-indigo-400 absolute top-3 right-3" />
                )}
                <div className="pr-6 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-xs text-slate-900 dark:text-white">
                      {(pharmacy as any).nameEn || pharmacy.name}
                    </span>
                    {pharmacy.nameAr && (
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">
                        ({pharmacy.nameAr})
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                    <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                    <span className="truncate">
                      {pharmacy.territory || [pharmacy.country, pharmacy.district, pharmacy.city, pharmacy.area || pharmacy.areaName].filter(Boolean).join(" / ") || "Territory Area"}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                      <Tag className="w-2.5 h-2.5 mr-1" />
                      {pharmacy.type || "Retail"}
                    </span>
                    <span className="inline-flex items-center text-[10px] font-mono text-slate-400">
                      {pharmacy.id}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
