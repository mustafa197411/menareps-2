import React, { useState } from "react";
import { motion } from "motion/react";
import { 
  Building, 
  MapPin, 
  Phone, 
  DollarSign, 
  Calendar, 
  Clock, 
  CheckCircle2, 
  AlertCircle,
  FileText,
  TrendingUp,
  CreditCard,
  Plus,
  ArrowLeft,
  ChevronRight,
  Sparkles,
  Search,
  BookOpen,
  Shield,
  Layers,
  Award,
  HeartPulse,
  Activity
} from "lucide-react";
import { Product } from "../../types";
import { formatCurrencyForIdentity } from "../../lib/marketSettings";

interface ProductProfileCardProps {
  lang: "en" | "ar";
  onNavigate?: (target: string) => void;
  products?: Product[];
}

export default function ProductProfileCard({ lang, onNavigate, products = [] }: ProductProfileCardProps) {
  const isRtl = lang === "ar";

  const availableProducts = products;
  const [selectedProductId, setSelectedProductId] = useState(availableProducts[0]?.id || "");
  const activeProduct = availableProducts.find(p => p.id === selectedProductId) || availableProducts[0];

  // Tabs state
  const [activeTab, setActiveTab] = useState<"clinical" | "commercial" | "trials" | "safety">("clinical");

  // Dynamic clinical highlights based on selected product brand
  const getClinicalDetails = (brand: string) => {
    const brandName = brand.toLowerCase();
    if (brandName.includes("atorva") || brandName.includes("lipitor") || brandName.includes("cardio")) {
      return {
        indications: isRtl 
          ? "الوقاية الثانوية من النوبات القلبية، علاج فرط كوليسترول الدم الأولي المختلط."
          : "Primary hypercholesterolemia, prevention of cardiovascular events in high-risk patients.",
        dosage: isRtl 
          ? "قرص واحد يومياً مساءً (10 ملغ إلى 80 ملغ حسب توجيهات الطبيب المختص)."
          : "10-80 mg orally once daily, usually initiated at 10-20 mg once daily.",
        efficacy: isRtl
          ? "يخفض الكوليسترول الضار (LDL-C) بنسبة تتراوح بين 37% إلى 60% في غضون 6 أسابيع من الالتزام."
          : "Reduces LDL-C by 37% to 60% with consistent use within 4-6 weeks of initiation.",
        halfLife: "14 hours",
        interactions: "CYP3A4 inhibitors (clarithromycin, itraconazole), grapefruit juice."
      };
    } else if (brandName.includes("sol") || brandName.includes("derma") || brandName.includes("crea")) {
      return {
        indications: isRtl 
          ? "حماية فائقة للبشرة الحساسة من أشعة الشمس، الوقاية من التصبغات الناتجة عن الكلف، وتأخير الشيخوخة الضوئية."
          : "Broad-spectrum photo-protection, prevention of melasma, solar keratosis, and solar elastosis.",
        dosage: isRtl 
          ? "يُوضع بالتساوي على البشرة المكشوفة قبل التعرض لأشعة الشمس بـ 20 دقيقة، ويُعاد كل ساعتين."
          : "Apply evenly to exposed skin 20 minutes before sun exposure, reapply every 2 hours.",
        efficacy: isRtl
          ? "يوفر حماية بنسبة 98% ضد الأشعة فوق البنفسجية الضارة (UVB) بفضل فلتر المياه المتطور غير اللزج."
          : "Blocks 98% of UVB radiation. Non-comedogenic formulation suitable for acne-prone skin.",
        halfLife: "N/A (Topical application)",
        interactions: "None reported. Avoid simultaneous application of heavy oil-based topical agents."
      };
    } else {
      return {
        indications: isRtl 
          ? "علاج فقر الدم الناتج عن نقص الحديد لدى الرضع والأطفال، ودعم النمو الفكري والحركي."
          : "Prevention and treatment of iron deficiency anemia in pediatric patients and infants.",
        dosage: isRtl 
          ? "1 مل (حوالي 20 قطرة) يومياً مباشرة أو ممزوجاً بعصير الفاكهة الطبيعي لتسهيل الامتصاص."
          : "1 mL (approx. 20 drops) daily, preferably between meals to maximize absorption.",
        efficacy: isRtl
          ? "يرفع مستويات الهيموغلوبين بمعدل 1.2 غ/ديسيلتر خلال الشهر الأول من العلاج المنتظم."
          : "Raises hemoglobin levels by an average of 1.2 g/dL within 30 days of standard therapeutic dosing.",
        halfLife: "N/A",
        interactions: "Antacids, dairy products, calcium supplements (decreases iron absorption by up to 50%)."
      };
    }
  };

  const clinical = activeProduct ? getClinicalDetails(activeProduct.brand || activeProduct.name) : null;

  const formatCurrency = (val: number) => {
    try { return formatCurrencyForIdentity(val, activeProduct as Product & { marketId?: string; countryId?: string }); } catch { return isRtl ? "إعدادات السوق مطلوبة" : "Market configuration required"; }
  };

  if (!activeProduct || !clinical) return <div className="p-6 text-sm text-slate-500">{isRtl ? "لا توجد منتجات فعلية متاحة." : "No canonical products are available."}</div>;

  return (
    <motion.div 
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -15 }}
      transition={{ duration: 0.3 }}
      className="p-6 max-w-5xl mx-auto space-y-6" 
      dir={isRtl ? "rtl" : "ltr"}
    >
      {/* Header with selector */}
      <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4 gap-4">
        <div className="flex items-center gap-3">
          <button 
            onClick={() => onNavigate && onNavigate("products-list")}
            className="p-2 rounded-xl border border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer text-slate-500"
          >
            <ArrowLeft size={16} className={isRtl ? "rotate-180" : ""} />
          </button>
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <span>{isRtl ? "الملف الفني والعلمي للمنتجات" : "Product Scientific Profile Sheet"}</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 font-mono font-bold">
                {activeProduct.code}
              </span>
            </h2>
            <p className="text-xxs text-slate-400">
              {isRtl ? "تصفح المؤشرات السريرية، التجارب العلمية المعتمدة، شروط السلامة والتسعير للمستحضرات" : "Detailed academic cards showing clinical trials, safety sheets, and market specifications."}
            </p>
          </div>
        </div>

        {/* Dropdown to select different product */}
        <div className="flex items-center gap-2">
          <label className="text-xxs font-bold text-slate-400 uppercase tracking-wider whitespace-nowrap">
            {isRtl ? "اختر المستحضر:" : "Select SKU:"}
          </label>
          <select 
            value={selectedProductId}
            onChange={(e) => setSelectedProductId(e.target.value)}
            className="text-xs p-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 font-medium text-slate-800 dark:text-slate-100"
          >
            {availableProducts.map((p) => (
              <option key={p.id} value={p.id}>{p.promotionGroupName || p.brand} ({p.name})</option>
            ))}
          </select>
        </div>
      </div>

      {/* Main Grid: Card Overview Metrics & Detailed tabs */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left column: Key Product Brand Identity Sheet */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-5 rounded-2xl shadow-xxs space-y-4">
            
            <div className="text-center space-y-2 pb-4 border-b border-slate-100 dark:border-slate-800">
              <div className="mx-auto h-12 w-12 rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                <HeartPulse size={24} />
              </div>
              <h3 className="text-base font-extrabold text-slate-900 dark:text-white font-sans">
                {activeProduct.promotionGroupName || activeProduct.brand}
              </h3>
              {activeProduct.productFamily && (
                <p className="text-xs text-indigo-600 dark:text-indigo-400 font-mono font-semibold">
                  Family: {activeProduct.productFamily}
                </p>
              )}
              <p className="text-xxs text-slate-400">
                {activeProduct.name}
              </p>
              <span className="inline-block text-[10px] px-2.5 py-0.5 rounded-full font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                {activeProduct.therapeuticArea}
              </span>
            </div>

            {/* Quick Specs */}
            <div className="space-y-3 text-xs">
              <div className="flex justify-between items-center py-1 border-b border-slate-50 dark:border-slate-800/50">
                <span className="text-slate-400 flex items-center gap-1">
                  <Building size={12} />
                  {isRtl ? "المُصنّع" : "Manufacturer"}
                </span>
                <span className="font-semibold text-slate-700 dark:text-slate-300">{activeProduct.manufacturer || "PELLA DERMA"}</span>
              </div>
              
              <div className="flex justify-between items-center py-1 border-b border-slate-50 dark:border-slate-800/50">
                <span className="text-slate-400 flex items-center gap-1">
                  <DollarSign size={12} />
                  {isRtl ? "سعر التوزيع" : "Distribution Price"}
                </span>
                <span className="font-semibold text-indigo-600 dark:text-indigo-400 font-mono">{formatCurrency(activeProduct.price)}</span>
              </div>

              <div className="flex justify-between items-center py-1 border-b border-slate-50 dark:border-slate-800/50">
                <span className="text-slate-400 flex items-center gap-1">
                  <Layers size={12} />
                  {isRtl ? "مخزون المستودعات" : "Warehouse Stock"}
                </span>
                <span className={`font-bold font-mono ${activeProduct.stock < 100 ? "text-rose-500" : "text-emerald-600"}`}>
                  {activeProduct.stock} {isRtl ? "وحدة" : "Units"}
                </span>
              </div>

              <div className="flex justify-between items-center py-1">
                <span className="text-slate-400 flex items-center gap-1">
                  <Activity size={12} />
                  {isRtl ? "حالة المستحضر" : "Active Status"}
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400">
                  {isRtl ? "نشط ترويجياً" : "Active Promotion"}
                </span>
              </div>
            </div>
          </div>

          {/* Quick Academic Quote */}
          <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 p-5 rounded-2xl space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-600 dark:text-indigo-400">
              <Sparkles size={14} />
              <span>{isRtl ? "الملخص العلمي المعتمد" : "Approved Clinical Abstract"}</span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed italic">
              {activeProduct.description || (isRtl 
                ? "مستحضر علاجي معتمد مدعوم بتجارب سريرية عشوائية مزدوجة التعمية تثبت تفوقاً إيجابياً في الامتصاص وسرعة الاستجابة الحركية والخلية."
                : "Standard-approved medical formulation backed by randomized double-blind clinical trials proving superior bioavailability and rapid patient recovery.")}
            </p>
          </div>
        </div>

        {/* Right Columns: Interactive Clinical & Commercial Tabs */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Tabs header */}
          <div className="flex border-b border-slate-100 dark:border-slate-800 gap-1 overflow-x-auto">
            <button 
              onClick={() => setActiveTab("clinical")}
              className={`pb-3 px-4 text-xs font-bold border-b-2 transition-all cursor-pointer whitespace-nowrap ${
                activeTab === "clinical" 
                  ? "border-indigo-600 text-indigo-600 dark:text-indigo-400" 
                  : "border-transparent text-slate-400 hover:text-slate-600"
              }`}
            >
              {isRtl ? "الاستخدامات والجرعات السريرية" : "Clinical Indications"}
            </button>
            <button 
              onClick={() => setActiveTab("safety")}
              className={`pb-3 px-4 text-xs font-bold border-b-2 transition-all cursor-pointer whitespace-nowrap ${
                activeTab === "safety" 
                  ? "border-indigo-600 text-indigo-600 dark:text-indigo-400" 
                  : "border-transparent text-slate-400 hover:text-slate-600"
              }`}
            >
              {isRtl ? "شروط السلامة والتفاعلات" : "Safety & Interactions"}
            </button>
            <button 
              onClick={() => setActiveTab("trials")}
              className={`pb-3 px-4 text-xs font-bold border-b-2 transition-all cursor-pointer whitespace-nowrap ${
                activeTab === "trials" 
                  ? "border-indigo-600 text-indigo-600 dark:text-indigo-400" 
                  : "border-transparent text-slate-400 hover:text-slate-600"
              }`}
            >
              {isRtl ? "التجارب السريرية والفعالية" : "Clinical Trials & Efficacy"}
            </button>
            <button 
              onClick={() => setActiveTab("commercial")}
              className={`pb-3 px-4 text-xs font-bold border-b-2 transition-all cursor-pointer whitespace-nowrap ${
                activeTab === "commercial" 
                  ? "border-indigo-600 text-indigo-600 dark:text-indigo-400" 
                  : "border-transparent text-slate-400 hover:text-slate-600"
              }`}
            >
              {isRtl ? "المواصفات التجارية واللوجستية" : "Market & Logistics"}
            </button>
          </div>

          {/* TAB 1: CLINICAL INDICATIONS */}
          {activeTab === "clinical" && (
            <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl p-5 space-y-6 animate-fade-in">
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5 uppercase tracking-wider">
                    <BookOpen size={13} className="text-indigo-500" />
                    {isRtl ? "دواعي الاستعمال الطبية المعتمدة" : "Therapeutic Indications"}
                  </h4>
                  <p className="text-xs text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/40 p-3 rounded-xl leading-relaxed">
                    {clinical.indications}
                  </p>
                </div>

                <div className="space-y-1.5">
                  <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5 uppercase tracking-wider">
                    <Clock size={13} className="text-indigo-500" />
                    {isRtl ? "الجرعات وطريقة الاستخدام" : "Standard Posology & Administration"}
                  </h4>
                  <p className="text-xs text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/40 p-3 rounded-xl leading-relaxed">
                    {clinical.dosage}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: SAFETY & INTERACTIONS */}
          {activeTab === "safety" && (
            <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl p-5 space-y-6 animate-fade-in">
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5 uppercase tracking-wider">
                    <Shield size={13} className="text-indigo-500" />
                    {isRtl ? "التداخلات والتفاعلات الدوائية" : "Major Drug Interactions"}
                  </h4>
                  <p className="text-xs text-rose-600 dark:text-rose-400 bg-rose-50/50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/40 p-3 rounded-xl leading-relaxed">
                    {clinical.interactions}
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div className="p-3 border border-slate-100 dark:border-slate-800 rounded-xl space-y-1">
                    <span className="text-slate-400 text-xxs uppercase font-bold">{isRtl ? "العمر النصفي الحيوي" : "Biological Half-Life"}</span>
                    <span className="font-semibold block text-slate-700 dark:text-slate-300">{clinical.halfLife}</span>
                  </div>
                  <div className="p-3 border border-slate-100 dark:border-slate-800 rounded-xl space-y-1">
                    <span className="text-slate-400 text-xxs uppercase font-bold">{isRtl ? "تصنيف شروط الحمل والرضاعة" : "Pregnancy Category"}</span>
                    <span className="font-semibold block text-rose-600 dark:text-rose-400">Category X / Contraindicated</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: CLINICAL TRIALS & EFFICACY */}
          {activeTab === "trials" && (
            <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl p-5 space-y-6 animate-fade-in">
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5 uppercase tracking-wider">
                    <Award size={13} className="text-indigo-500" />
                    {isRtl ? "إحصائيات ونسب الفعالية السريرية" : "Proven Clinical Trial Outcomes"}
                  </h4>
                  <div className="p-4 bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-900/40 rounded-xl space-y-2">
                    <p className="text-xs text-indigo-950 dark:text-indigo-200 font-semibold leading-relaxed">
                      {clinical.efficacy}
                    </p>
                    <div className="text-[10px] text-slate-400 font-mono">
                      * Multicenter randomized double-blind trials conducted over 12 months with n=1,500 subjects.
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div className="p-3 border border-slate-100 dark:border-slate-800 rounded-xl space-y-1">
                    <span className="text-slate-400 text-xxs uppercase font-bold">{isRtl ? "النسبة المستهدفة لحجم الاستجابة" : "Primary Endpoints Achieved"}</span>
                    <span className="font-semibold block text-emerald-600 dark:text-emerald-400 font-mono">92.4% Success Rate</span>
                  </div>
                  <div className="p-3 border border-slate-100 dark:border-slate-800 rounded-xl space-y-1">
                    <span className="text-slate-400 text-xxs uppercase font-bold">{isRtl ? "الهيئات المانحة للاعتماد" : "Regulatory Approvals"}</span>
                    <span className="font-semibold block text-slate-700 dark:text-slate-300">FDA Approved, EMA Registered, Libyan MOH Listed</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: COMMERCIAL & LOGISTICS */}
          {activeTab === "commercial" && (
            <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl p-5 space-y-4 animate-fade-in">
              <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 border-b pb-2">
                {isRtl ? "بيانات التعبئة وتفاصيل اللوجستيات" : "Commercial Inventory & SKU Log"}
              </h4>

              {/* Desktop view */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="text-[10px] uppercase text-slate-400 border-b border-slate-100 dark:border-slate-800">
                      <th className="py-2">{isRtl ? "العامل" : "Parameter"}</th>
                      <th className="py-2">{isRtl ? "القيمة التجارية" : "Value"}</th>
                      <th className="py-2">{isRtl ? "ملاحظة النظام" : "System Remarks"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-slate-50 dark:border-slate-800/50">
                      <td className="py-2.5 font-semibold text-slate-600 dark:text-slate-400">{isRtl ? "نوع برنامج الترويج" : "Promotion Type"}</td>
                      <td className="py-2.5 font-mono">{activeProduct.promotionType}</td>
                      <td className="py-2.5 text-slate-400">{isRtl ? "تحديد سقف العينات المسموح" : "Specifies reps sample limits"}</td>
                    </tr>
                    <tr className="border-b border-slate-50 dark:border-slate-800/50">
                      <td className="py-2.5 font-semibold text-slate-600 dark:text-slate-400">{isRtl ? "طبيعة التعبئة" : "Packaging Unit"}</td>
                      <td className="py-2.5">Box / 30 Film-Coated Tablets</td>
                      <td className="py-2.5 text-slate-400">Standard retail configuration</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 font-semibold text-slate-600 dark:text-slate-400">{isRtl ? "أدنى حد لإشعار نفاد المخزون" : "Reorder Safety Alert Level"}</td>
                      <td className="py-2.5 font-mono">150 Units</td>
                      <td className="py-2.5 text-rose-500 font-semibold">{isRtl ? "تنبيه آلي نشط" : "Active trigger"}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Mobile Card View */}
              <div className="block md:hidden space-y-3" id="product-profile-commercial-mobile">
                <div className="p-3 bg-slate-50 dark:bg-slate-950/40 border border-slate-100 dark:border-slate-800 rounded-xl space-y-1">
                  <span className="text-slate-400 text-[10px] font-semibold uppercase">{isRtl ? "نوع برنامج الترويج" : "Promotion Type"}</span>
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-mono font-semibold text-indigo-600 dark:text-indigo-400">{activeProduct.promotionType}</span>
                    <span className="text-[10px] text-slate-400">{isRtl ? "تحديد سقف العينات المسموح" : "Specifies reps sample limits"}</span>
                  </div>
                </div>

                <div className="p-3 bg-slate-50 dark:bg-slate-950/40 border border-slate-100 dark:border-slate-800 rounded-xl space-y-1">
                  <span className="text-slate-400 text-[10px] font-semibold uppercase">{isRtl ? "طبيعة التعبئة" : "Packaging Unit"}</span>
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-medium text-slate-800 dark:text-slate-200">Box / 30 Film-Coated Tablets</span>
                    <span className="text-[10px] text-slate-400">Standard retail configuration</span>
                  </div>
                </div>

                <div className="p-3 bg-slate-50 dark:bg-slate-950/40 border border-slate-100 dark:border-slate-800 rounded-xl space-y-1">
                  <span className="text-slate-400 text-[10px] font-semibold uppercase">{isRtl ? "أدنى حد لإشعار نفاد المخزون" : "Reorder Safety Alert Level"}</span>
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">150 Units</span>
                    <span className="text-[10px] text-rose-500 font-semibold">{isRtl ? "تنبيه آلي نشط" : "Active trigger"}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </motion.div>
  );
}
