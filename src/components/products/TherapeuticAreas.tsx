import React, { useState } from "react";
import { motion } from "motion/react";
import { 
  Heart, 
  Baby, 
  Sparkles, 
  Briefcase, 
  UserCheck, 
  Layers, 
  FileText, 
  Plus, 
  ArrowLeft,
  ChevronRight,
  ShieldCheck,
  Stethoscope,
  ChevronDown
} from "lucide-react";

interface TherapeuticAreasProps {
  lang: "en" | "ar";
  onNavigate?: (target: string) => void;
}

export default function TherapeuticAreas({ lang, onNavigate }: TherapeuticAreasProps) {
  const isRtl = lang === "ar";

  // Therapeutic Specialty data
  const areasData = [
    {
      id: "TA-CARD",
      name: "Vascular & Cardiology",
      nameAr: "أمراض القلب والأوعية الدموية",
      icon: Heart,
      head: "Dr. Khaled Al-Fitouri",
      brands: ["Atorva", "Amlodine"],
      skusCount: 8,
      marketPriority: "Critical / High-Exposure",
      priorityColor: "text-rose-600 bg-rose-50 dark:bg-rose-950/20",
      description: "Comprehensive formulations targeting lipid optimization, arterial health, and hypertension management.",
      descriptionAr: "مستحضرات متكاملة لعلاج خلل دهون الدم والشرايين التاجية وضغط الدم المرتفع."
    },
    {
      id: "TA-DERM",
      name: "Dermatology & Cosmeceuticals",
      nameAr: "أمراض الجلدية والمستحضرات التجميلية",
      icon: Sparkles,
      head: "Dr. Laila Ben-Halim",
      brands: ["DermaSol", "Avene (Co-brand)"],
      skusCount: 6,
      marketPriority: "High Growth / Retail Focused",
      priorityColor: "text-indigo-600 bg-indigo-50 dark:bg-indigo-950/20",
      description: "Advanced photo-protection formulas, hydration serums, and barrier repairing solutions.",
      descriptionAr: "تركيبات متطورة للحماية من الضرر الضوئي الشمسي وسيرومات الترطيب العميق للجلد."
    },
    {
      id: "TA-PEDI",
      name: "Pediatrics & Nutrition",
      nameAr: "طب الأطفال والتغذية العلاجية",
      icon: Baby,
      head: "Dr. Osama Bel-Eid",
      brands: ["FerroKids", "NutriDrops"],
      skusCount: 4,
      marketPriority: "Medium Priority",
      priorityColor: "text-cyan-600 bg-cyan-50 dark:bg-cyan-950/20",
      description: "Oral iron drops, pediatric multivitamins, and neonatal growth optimization structures.",
      descriptionAr: "مكملات الحديد الفموية سهلة الامتصاص ومحفزات نمو الأطفال وحديثي الولادة."
    },
    {
      id: "TA-INTE",
      name: "Internal Medicine",
      nameAr: "الأمراض الباطنية والجهاز الهضمي",
      icon: Stethoscope,
      head: "Dr. Mustafa El-Gheryani",
      brands: ["GastroShield"],
      skusCount: 3,
      marketPriority: "High Volume / Bulk Contracts",
      priorityColor: "text-amber-600 bg-amber-50 dark:bg-amber-950/20",
      description: "Proton-pump inhibitors, antispasmodics, and diabetic management solutions.",
      descriptionAr: "مثبطات مضخة البروتون لعلاج قرحة المعدة ومضادات تشنجات القولون."
    }
  ];

  const [expandedArea, setExpandedArea] = useState<string | null>(null);

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
              {isRtl ? "مصفوفة الأقسام والمجالات العلاجية" : "Therapeutic Specialties Matrix"}
            </h2>
            <p className="text-xxs text-slate-400">
              {isRtl ? "تصنيف المحفظة الدوائية حسب الأقسام السريرية والأمراض وتعيين مشرفي الدعاية الطبية للمناطق" : "Clinical classifications segregating vascular, pediatric, internal medicine, and other drug families."}
            </p>
          </div>
        </div>

        <button 
          onClick={() => onNavigate && onNavigate("products-assignments")}
          className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
        >
          {isRtl ? "توزيع خطوط الأدوية" : "Field Product Assignments"}
        </button>
      </div>

      {/* Grid of specialties */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {areasData.map((area) => {
          const IconComponent = area.icon;
          const isExpanded = expandedArea === area.id;

          return (
            <div 
              key={area.id}
              className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-5 rounded-2xl shadow-xxs space-y-4 hover:border-indigo-100 dark:hover:border-indigo-950 transition-all"
            >
              <div className="flex justify-between items-start">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 rounded-xl">
                    <IconComponent size={20} />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-950 dark:text-white">
                      {isRtl ? area.nameAr : area.name}
                    </h3>
                    <span className="text-xxs font-mono text-slate-400">
                      ID Code: {area.id}
                    </span>
                  </div>
                </div>

                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${area.priorityColor}`}>
                  {area.marketPriority}
                </span>
              </div>

              <p className="text-xs text-slate-500 leading-relaxed">
                {isRtl ? area.descriptionAr : area.description}
              </p>

              {/* Details and Metrics */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs pt-3 border-t border-slate-50 dark:border-slate-800/60">
                <div>
                  <span className="text-[10px] text-slate-400 block uppercase font-bold">{isRtl ? "المنسق الطبي المسؤول" : "Medical Head"}</span>
                  <span className="font-semibold">{area.head}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block uppercase font-bold">{isRtl ? "عدد العلامات التجارية" : "SKU Brands Count"}</span>
                  <span className="font-semibold font-mono text-indigo-600 dark:text-indigo-400">{area.brands.length} Brands ({area.skusCount} SKUs)</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block uppercase font-bold">{isRtl ? "برنامج الترويج المعتمد" : "Target Audiences"}</span>
                  <span className="font-semibold block truncate">Cardiologists & GPs</span>
                </div>
              </div>

              {/* Collapsible area for assigned brands */}
              <div className="pt-2">
                <button 
                  onClick={() => setExpandedArea(isExpanded ? null : area.id)}
                  className="w-full flex justify-between items-center text-xxs font-bold text-slate-400 uppercase py-1.5 hover:text-slate-600 cursor-pointer"
                >
                  <span>{isRtl ? "عرض تفاصيل المواد الطبية والبراندات" : "View Active Molecules & Brands"}</span>
                  <ChevronDown size={14} className={`transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`} />
                </button>

                {isExpanded && (
                  <motion.div 
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    className="mt-2 space-y-2 bg-slate-50 dark:bg-slate-800/40 p-3 rounded-xl border border-slate-100 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400"
                  >
                    <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-1.5 mb-1.5 font-bold">
                      <span>{isRtl ? "المادة الفعالة للمستحضر" : "Active Branded Compounds"}</span>
                      <span>{isRtl ? "سلطة الموافقة" : "Academic Lead"}</span>
                    </div>
                    {area.brands.map((b) => (
                      <div key={b} className="flex justify-between items-center">
                        <span className="font-semibold text-indigo-600 dark:text-indigo-400">{b} formulations</span>
                        <span className="font-mono text-xxs bg-indigo-50 dark:bg-indigo-950/20 px-1.5 py-0.5 rounded text-indigo-700">MOH Certified</span>
                      </div>
                    ))}
                  </motion.div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
