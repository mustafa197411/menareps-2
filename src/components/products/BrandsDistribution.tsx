import React, { useState } from "react";
import { motion } from "motion/react";
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from "recharts";
import { 
  Layers, 
  Globe, 
  TrendingUp, 
  Search, 
  ArrowLeft,
  Briefcase,
  SlidersHorizontal,
  ChevronRight,
  Info
} from "lucide-react";

interface BrandsDistributionProps {
  lang: "en" | "ar";
  onNavigate?: (target: string) => void;
}

export default function BrandsDistribution({ lang, onNavigate }: BrandsDistributionProps) {
  const isRtl = lang === "ar";

  // Brand items mock dataset
  const brandsData = [
    { name: "Atorva", productsCount: 5, activeMolecules: "Atorvastatin Calcium", regionShare: { West: 45, East: 35, South: 20 }, revenueLYD: 184500, therapeuticArea: "Vascular & Cardiology" },
    { name: "DermaSol", productsCount: 4, activeMolecules: "Hyaluronic + Titanium Dioxide", regionShare: { West: 50, East: 40, South: 10 }, revenueLYD: 214000, therapeuticArea: "Dermatology & Cosmeceuticals" },
    { name: "FerroKids", productsCount: 3, activeMolecules: "Carbonyl Iron Drops", regionShare: { West: 30, East: 50, South: 20 }, revenueLYD: 94200, therapeuticArea: "Pediatrics & Nutrition" },
    { name: "Amlodine", productsCount: 3, activeMolecules: "Amlodipine Besylate", regionShare: { West: 40, East: 40, South: 20 }, revenueLYD: 112000, therapeuticArea: "Vascular & Cardiology" },
    { name: "GastroShield", productsCount: 2, activeMolecules: "Esomeprazole Magnesium", regionShare: { West: 60, East: 25, South: 15 }, revenueLYD: 75000, therapeuticArea: "Internal Medicine" }
  ];

  const [selectedBrand, setSelectedBrand] = useState<string | null>(null);
  const [regionFilter, setRegionFilter] = useState<"All" | "West" | "East" | "South">("All");
  if (true) return <div className="p-6 text-sm text-slate-500" dir={isRtl ? "rtl" : "ltr"}>{isRtl ? "تم إيقاف تقرير الإيرادات التجريبي. استخدم تحليلات المنتجات الفعلية." : "This fictional revenue report is retired. Use canonical Product Analytics."}</div>;

  const colors = ["#4f46e5", "#06b6d4", "#10b981", "#f59e0b", "#ec4899"];

  // Prepare chart data: Volume of products per therapeutic area or revenue per brand
  const chartData = brandsData.map(b => ({
    name: b.name,
    "Revenue (LYD)": b.revenueLYD,
    "SKUs": b.productsCount,
    West: b.regionShare.West,
    East: b.regionShare.East,
    South: b.regionShare.South
  }));

  // Pie chart data
  const pieData = brandsData.map((b, idx) => ({
    name: b.name,
    value: b.revenueLYD,
    color: colors[idx % colors.length]
  }));

  const activeDetails = selectedBrand ? brandsData.find(b => b.name === selectedBrand) : brandsData[0];

  const formatCurrency = (val: number) => {
    return val.toLocaleString(lang === "ar" ? "ar-LY" : "en-US", {
      style: "currency",
      currency: "LYD",
      maximumFractionDigits: 0
    });
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -15 }}
      transition={{ duration: 0.3 }}
      className="p-6 max-w-5xl mx-auto space-y-6" 
      dir={isRtl ? "rtl" : "ltr"}
    >
      {/* Header section */}
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
              {isRtl ? "المجموعات الترويجية وتوزيع المحفظة" : "Active Promotion Groups Portfolio & Regional Distribution"}
            </h2>
            <p className="text-xxs text-slate-400">
              {isRtl ? "تفصيل المجموعات الترويجية للمؤسسة، ونسب التوزيع الجغرافي والإقليمي للإيرادات وصيغ الترويج" : "Regional volume matrices, active molecules allocation, and relative group revenues."}
            </p>
          </div>
        </div>

        <button 
          onClick={() => onNavigate && onNavigate("products-therapeutic-areas")}
          className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
        >
          {isRtl ? "عرض المجالات العلاجية" : "Therapeutic Areas Matrix"}
        </button>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-4 rounded-2xl flex items-center gap-4">
          <div className="p-3 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400">
            <Briefcase size={20} />
          </div>
          <div>
            <span className="text-xxs text-slate-400 block uppercase font-bold tracking-wider">
              {isRtl ? "إجمالي المجموعات الترويجية المسجلة" : "Total Promotion Groups"}
            </span>
            <span className="text-base font-bold text-slate-800 dark:text-slate-100 font-mono">
              {brandsData.length} {isRtl ? "مجموعة ترويجية" : "Registered Groups"}
            </span>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-4 rounded-2xl flex items-center gap-4">
          <div className="p-3 rounded-xl bg-cyan-50 dark:bg-cyan-950/40 text-cyan-600 dark:text-cyan-400">
            <Layers size={20} />
          </div>
          <div>
            <span className="text-xxs text-slate-400 block uppercase font-bold tracking-wider">
              {isRtl ? "المستحضرات الفعالة الكلية" : "Active Molecular Compounds"}
            </span>
            <span className="text-base font-bold text-slate-800 dark:text-slate-100 font-mono">
              17 {isRtl ? "مادة علمية" : "SKU Formulations"}
            </span>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-4 rounded-2xl flex items-center gap-4">
          <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400">
            <TrendingUp size={20} />
          </div>
          <div>
            <span className="text-xxs text-slate-400 block uppercase font-bold tracking-wider">
              {isRtl ? "العوائد الكلية للمحفظة" : "Est. Portfolio Revenue"}
            </span>
            <span className="text-base font-bold text-emerald-600 dark:text-emerald-400 font-mono">
              {formatCurrency(679700)}
            </span>
          </div>
        </div>
      </div>

      {/* Recharts Visualizations Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Charts Side */}
        <div className="lg:col-span-2 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl p-5 space-y-6 shadow-xxs">
          <div className="flex justify-between items-center border-b border-slate-50 dark:border-slate-800 pb-3">
            <h3 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
              {isRtl ? "عوائد المبيعات الكلية لكل مجموعة ترويجية (بالدينار الليبي)" : "Commercial Promotion Group Value (LYD) & SKU Counts"}
            </h3>
            <span className="text-[10px] text-slate-400 font-semibold">{isRtl ? "إحصائيات العام الجاري" : "Current FY Statistics"}</span>
          </div>

          {/* Bar Chart */}
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} tickLine={false} />
                <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} />
                <Tooltip 
                  contentStyle={{ backgroundColor: "#1e293b", borderRadius: "12px", border: "none", color: "#fff", fontSize: "11px" }}
                />
                <Legend wrapperStyle={{ fontSize: "11px" }} />
                <Bar dataKey="Revenue (LYD)" fill="#4f46e5" radius={[4, 4, 0, 0]} />
                <Bar dataKey="SKUs" fill="#06b6d4" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Share Side */}
        <div className="lg:col-span-1 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl p-5 space-y-6 shadow-xxs flex flex-col justify-between">
          <div>
            <h3 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider border-b border-slate-50 dark:border-slate-800 pb-3">
              {isRtl ? "النسبة النسبية من العوائد" : "Relative Portfolio Revenue Share"}
            </h3>

            {/* Micro Pie Chart */}
            <div className="h-44 w-full flex items-center justify-center pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={70}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: "10px" }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Legend Table */}
          <div className="space-y-1.5 pt-2 border-t border-slate-50 dark:border-slate-800">
            {pieData.map((d, idx) => (
              <div key={d.name} className="flex justify-between items-center text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: d.color }} />
                  <span className="font-semibold text-slate-700 dark:text-slate-300">{d.name}</span>
                </div>
                <span className="font-mono text-slate-400">
                  {((d.value / 679700) * 100).toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* Regional Matrix Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl p-5 shadow-xxs space-y-4">
        <div className="flex justify-between items-center border-b border-slate-50 dark:border-slate-800 pb-3">
          <h3 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
            {isRtl ? "مصفوفة التوزيع والمبيعات الإقليمية الجغرافية" : "Geographic & Regional Volume Distribution Matrix"}
          </h3>
          <span className="text-[10px] text-slate-400 font-semibold">{isRtl ? "* النسب المئوية للمبيعات الإقليمية" : "* Regional Sales Percentages"}</span>
        </div>

        {/* Desktop View Table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="text-[10px] uppercase text-slate-400 border-b border-slate-100 dark:border-slate-800">
                <th className="py-2">{isRtl ? "اسم المجموعة الترويجية" : "Promotion Group Name"}</th>
                <th className="py-2">{isRtl ? "المجال العلاجي" : "Therapeutic Area"}</th>
                <th className="py-2 font-mono text-center">{isRtl ? "المنطقة الغربية (طرابلس)" : "West (Tripoli)"}</th>
                <th className="py-2 font-mono text-center">{isRtl ? "المنطقة الشرقية (بنغازي)" : "East (Benghazi)"}</th>
                <th className="py-2 font-mono text-center">{isRtl ? "المنطقة الجنوبية (سبها)" : "South (Sabha)"}</th>
                <th className="py-2 font-mono text-right">{isRtl ? "إجمالي العوائد السنوية" : "Est. Group Revenue"}</th>
              </tr>
            </thead>
            <tbody>
              {brandsData.map((b) => (
                <tr 
                  key={b.name} 
                  onClick={() => setSelectedBrand(b.name)}
                  className="border-b border-slate-50 dark:border-slate-800/50 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 cursor-pointer"
                >
                  <td className="py-3 font-bold text-indigo-600 dark:text-indigo-400">{b.name}</td>
                  <td className="py-3 text-slate-600 dark:text-slate-400">{b.therapeuticArea}</td>
                  <td className="py-3 text-center">
                    <span className="px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/20 text-indigo-600 font-semibold font-mono">
                      {b.regionShare.West}%
                    </span>
                  </td>
                  <td className="py-3 text-center">
                    <span className="px-2 py-0.5 rounded bg-cyan-50 dark:bg-cyan-950/20 text-cyan-600 font-semibold font-mono">
                      {b.regionShare.East}%
                    </span>
                  </td>
                  <td className="py-3 text-center">
                    <span className="px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 font-semibold font-mono">
                      {b.regionShare.South}%
                    </span>
                  </td>
                  <td className="py-3 text-right font-bold font-mono text-slate-800 dark:text-slate-200">
                    {formatCurrency(b.revenueLYD)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile-Friendly Card View */}
        <div className="block md:hidden space-y-4" id="brands-distribution-mobile-cards">
          {brandsData.map((b) => (
            <div
              key={b.name}
              onClick={() => setSelectedBrand(b.name)}
              className="p-4 bg-slate-50/50 dark:bg-slate-950/30 border border-slate-100/60 dark:border-slate-800/60 rounded-xl space-y-3 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors"
            >
              <div className={`flex justify-between items-start gap-2 ${isRtl ? "flex-row-reverse" : ""}`}>
                <div>
                  <h4 className="font-bold text-sm text-indigo-600 dark:text-indigo-400">{b.name}</h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{b.therapeuticArea}</p>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-slate-400 block font-semibold uppercase tracking-wider mb-0.5">
                    {isRtl ? "العوائد" : "Revenue"}
                  </span>
                  <span className="font-bold font-mono text-xs text-slate-800 dark:text-slate-200">
                    {formatCurrency(b.revenueLYD)}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center text-[10px] font-mono pt-2 border-t border-slate-100/50 dark:border-slate-850/50">
                <div>
                  <span className="text-[9px] text-slate-400 block font-sans font-semibold mb-1">
                    {isRtl ? "الغربية" : "West"}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/20 text-indigo-600 font-bold">
                    {b.regionShare.West}%
                  </span>
                </div>
                <div>
                  <span className="text-[9px] text-slate-400 block font-sans font-semibold mb-1">
                    {isRtl ? "الشرقية" : "East"}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-cyan-50 dark:bg-cyan-950/20 text-cyan-600 font-bold">
                    {b.regionShare.East}%
                  </span>
                </div>
                <div>
                  <span className="text-[9px] text-slate-400 block font-sans font-semibold mb-1">
                    {isRtl ? "الجنوبية" : "South"}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 font-bold">
                    {b.regionShare.South}%
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
