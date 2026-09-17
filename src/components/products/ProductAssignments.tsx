import React, { useState } from "react";
import { motion } from "motion/react";
import { 
  Briefcase, 
  Plus, 
  Trash2, 
  UserCheck, 
  Layers, 
  ShieldCheck, 
  ArrowLeft,
  Search,
  CheckCircle,
  AlertCircle,
  TrendingUp,
  Tag
} from "lucide-react";

interface ProductAssignmentsProps {
  lang: "en" | "ar";
  onNavigate?: (target: string) => void;
}

export default function ProductAssignments({ lang, onNavigate }: ProductAssignmentsProps) {
  const isRtl = lang === "ar";

  // Representative Lines / Teams
  const initialAssignments = [
    { id: "LINE-1", lineName: "Vascular & Cardiology Line", lineNameAr: "خط القلب والأوعية الدموية", supervisor: "Hassan Salem", region: "West", repsCount: 6, assignedBrands: ["Atorva", "Amlodine"] },
    { id: "LINE-2", lineName: "Dermaceutic Skin Care Line", lineNameAr: "خط الجلدية ومستحضرات التجميل", supervisor: "Laila Ben-Halim", region: "West", repsCount: 4, assignedBrands: ["DermaSol"] },
    { id: "LINE-3", lineName: "Pediatric Nutrition Line", lineNameAr: "خط الأطفال والتغذية العلاجية", supervisor: "Osama Bel-Eid", region: "East", repsCount: 5, assignedBrands: ["FerroKids"] },
    { id: "LINE-4", lineName: "Hospital & Oncology Specialty", lineNameAr: "خط المستشفيات والأورام التخصصي", supervisor: "Khaled Al-Fitouri", region: "West", repsCount: 3, assignedBrands: ["Atorva", "GastroShield"] }
  ];

  const [assignments, setAssignments] = useState(initialAssignments);
  const [searchTerm, setSearchTerm] = useState("");
  
  // Interactive State for Assigning new Brand
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [selectedLineId, setSelectedLineId] = useState("");
  const [brandToAssign, setBrandToAssign] = useState("Atorva");

  const availableBrands = ["Atorva", "DermaSol", "FerroKids", "Amlodine", "GastroShield"];

  const handleAssignBrand = () => {
    if (!selectedLineId) return;

    setAssignments(prev => prev.map(line => {
      if (line.id === selectedLineId) {
        // Prevent duplicate
        if (line.assignedBrands.includes(brandToAssign)) return line;
        return {
          ...line,
          assignedBrands: [...line.assignedBrands, brandToAssign]
        };
      }
      return line;
    }));

    setShowAssignModal(false);
  };

  const handleRemoveBrand = (lineId: string, brandName: string) => {
    setAssignments(prev => prev.map(line => {
      if (line.id === lineId) {
        return {
          ...line,
          assignedBrands: line.assignedBrands.filter(b => b !== brandName)
        };
      }
      return line;
    }));
  };

  const filteredLines = assignments.filter(line => 
    line.lineName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (line.lineNameAr && line.lineNameAr.includes(searchTerm)) ||
    line.supervisor.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <motion.div 
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -15 }}
      transition={{ duration: 0.3 }}
      className="p-6 max-w-5xl mx-auto space-y-6" 
      dir={isRtl ? "rtl" : "ltr"}
    >
      {/* Header and Back navigation */}
      <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <button 
            onClick={() => onNavigate && onNavigate("products-list")}
            className="p-2 rounded-xl border border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer text-slate-500"
          >
            <ArrowLeft size={16} className={isRtl ? "rotate-180" : ""} />
          </button>
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">
              {isRtl ? "توزيع خطوط الأدوية وتفويض الترويج" : "Field Product Assignments & Rep Lines"}
            </h2>
            <p className="text-xxs text-slate-400">
              {isRtl ? "إسناد وترخيص ترويج العلامات التجارية والمنتجات الدوائية لمجموعات المندوبين الطبيين" : "Allocate specific brand promotional directives to dedicated medical rep sales lines."}
            </p>
          </div>
        </div>

        <button 
          onClick={() => {
            setSelectedLineId(assignments[0].id);
            setShowAssignModal(true);
          }}
          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-xxs font-bold text-white rounded-lg flex items-center gap-1.5 cursor-pointer shadow-sm"
        >
          <Plus size={14} />
          <span>{isRtl ? "توزيع ترويج جديد" : "Assign Brand Promotion"}</span>
        </button>
      </div>

      {/* Assign Brand Modal / Box inside the page */}
      {showAssignModal && (
        <div className="bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-200 dark:border-indigo-900/60 p-5 rounded-2xl space-y-4">
          <h3 className="text-xs font-bold text-indigo-950 dark:text-indigo-200 uppercase tracking-wider flex items-center gap-1.5">
            <UserCheck size={14} />
            {isRtl ? "تخصيص وترخيص ترويج براند لخط ترويجي" : "Authorize New Brand Assignment"}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div className="space-y-1">
              <label className="text-xxs font-bold text-slate-500">{isRtl ? "اختر الخط الترويجي" : "Target Sales Line"}</label>
              <select 
                value={selectedLineId}
                onChange={(e) => setSelectedLineId(e.target.value)}
                className="w-full text-xs p-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
              >
                {assignments.map(line => (
                  <option key={line.id} value={line.id}>{isRtl ? line.lineNameAr : line.lineName}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xxs font-bold text-slate-500">{isRtl ? "اختر العلامة التجارية" : "Select Brand"}</label>
              <select 
                value={brandToAssign}
                onChange={(e) => setBrandToAssign(e.target.value)}
                className="w-full text-xs p-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
              >
                {availableBrands.map(brand => (
                  <option key={brand} value={brand}>{brand}</option>
                ))}
              </select>
            </div>

            <div className="flex gap-2">
              <button 
                onClick={handleAssignBrand}
                className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer"
              >
                {isRtl ? "إسناد وترخيص" : "Confirm Assignment"}
              </button>
              <button 
                onClick={() => setShowAssignModal(false)}
                className="py-2 px-3 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 text-slate-600 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
              >
                {isRtl ? "إلغاء" : "Cancel"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-4 rounded-2xl flex items-center justify-between">
        <div className="relative w-full md:w-72">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input 
            type="text" 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={isRtl ? "البحث بالخط الترويجي أو المشرف..." : "Search rep line or supervisor..."}
            className="w-full text-xs pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-transparent focus:border-indigo-500 bg-transparent"
          />
        </div>

        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
          {isRtl ? "دليل التخصيص والمشرفين" : "Line Authorization Registry"}
        </span>
      </div>

      {/* Main Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl p-4 md:p-5 shadow-xxs">
        {/* Desktop View */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="text-[10px] uppercase text-slate-400 border-b border-slate-100 dark:border-slate-800">
                <th className="py-3">{isRtl ? "رمز خط الدعاية" : "Line ID"}</th>
                <th className="py-3">{isRtl ? "الخط الترويجي" : "Field Rep Line"}</th>
                <th className="py-3">{isRtl ? "المشرف المسؤول" : "Supervisor"}</th>
                <th className="py-3 text-center">{isRtl ? "عدد المندوبين" : "Active Reps"}</th>
                <th className="py-3">{isRtl ? "العلامات التجارية المرخصة للترويج" : "Assigned Brand Promotions"}</th>
              </tr>
            </thead>
            <tbody>
              {filteredLines.map((line) => (
                <tr key={line.id} className="border-b border-slate-50 dark:border-slate-800/50 hover:bg-slate-50/40">
                  <td className="py-4 font-mono font-bold text-slate-400">{line.id}</td>
                  <td className="py-4">
                    <span className="font-bold text-slate-800 dark:text-slate-100 block">
                      {isRtl ? line.lineNameAr : line.lineName}
                    </span>
                    <span className="text-xxs text-slate-400 uppercase font-bold tracking-wider">
                      Region: {line.region}
                    </span>
                  </td>
                  <td className="py-4 font-semibold text-slate-600 dark:text-slate-300">
                    {line.supervisor}
                  </td>
                  <td className="py-4 text-center font-bold font-mono">
                    {line.repsCount}
                  </td>
                  <td className="py-4">
                    <div className="flex flex-wrap gap-1.5">
                      {line.assignedBrands.map((brand) => (
                        <span 
                          key={brand}
                          className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-bold bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-900/40"
                        >
                          <span>{brand}</span>
                          <button 
                            onClick={() => handleRemoveBrand(line.id, brand)}
                            className="text-indigo-400 hover:text-rose-600 cursor-pointer ml-1 text-[9px]"
                            title={isRtl ? "إلغاء الترخيص" : "Revoke promotion license"}
                          >
                            ×
                          </button>
                        </span>
                      ))}

                      {line.assignedBrands.length === 0 && (
                        <span className="text-xxs text-rose-500 font-semibold italic flex items-center gap-1">
                          <AlertCircle size={10} />
                          {isRtl ? "لم يتم تخصيص أي ماركة" : "No brands assigned!"}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile View */}
        <div className="block md:hidden divide-y divide-slate-100 dark:divide-slate-800">
          {filteredLines.map((line) => (
            <div key={line.id} className={`py-4.5 space-y-3.5 text-xs ${isRtl ? "text-right" : "text-left"}`}>
              <div className={`flex justify-between items-start ${isRtl ? "flex-row-reverse" : "flex-row"}`}>
                <div>
                  <h4 className="font-bold text-slate-900 dark:text-white text-sm">
                    {isRtl ? line.lineNameAr : line.lineName}
                  </h4>
                  <span className="text-[10px] text-slate-400 font-mono block mt-1">
                    {line.id} • Region: {line.region}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3.5 bg-slate-50 dark:bg-slate-950/40 rounded-xl p-3 border border-slate-100/50 dark:border-slate-800/40 text-[11px]">
                <div>
                  <span className="text-slate-400 uppercase font-bold text-[8px] block mb-0.5">{isRtl ? "المشرف المسؤول" : "Supervisor"}</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{line.supervisor}</span>
                </div>
                <div>
                  <span className="text-slate-400 uppercase font-bold text-[8px] block mb-0.5">{isRtl ? "عدد المندوبين" : "Active Reps"}</span>
                  <span className="font-mono font-bold text-slate-800 dark:text-slate-200">{line.repsCount}</span>
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="text-slate-400 uppercase font-bold text-[8px] block">{isRtl ? "العلامات التجارية المرخصة" : "Assigned Promotions"}</span>
                <div className="flex flex-wrap gap-1.5">
                  {line.assignedBrands.map((brand) => (
                    <span 
                      key={brand}
                      className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-bold bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-900/40"
                    >
                      <span>{brand}</span>
                      <button 
                        onClick={() => handleRemoveBrand(line.id, brand)}
                        className="text-indigo-400 hover:text-rose-600 cursor-pointer ml-1 text-[9px]"
                        title={isRtl ? "إلغاء الترخيص" : "Revoke promotion license"}
                      >
                        ×
                      </button>
                    </span>
                  ))}

                  {line.assignedBrands.length === 0 && (
                    <span className="text-xxs text-rose-500 font-semibold italic flex items-center gap-1">
                      <AlertCircle size={10} />
                      {isRtl ? "لم يتم تخصيص أي ماركة" : "No brands assigned!"}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
