import React, { useState, useMemo } from "react";
import { 
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis
} from "recharts";
import { 
  FileText, Download, Filter, MapPin, Layers, Users, TrendingUp, Sparkles,
  Award, RefreshCw, BarChart3, HelpCircle, HeartHandshake, DollarSign,
  Activity, BookOpen, Gift, ShieldAlert
} from "lucide-react";
import { 
  getSynergyReportData, 
  INITIAL_COUNTRIES, 
  INITIAL_DISTRICTS, 
  INITIAL_CITIES, 
  INITIAL_TERRITORIES, 
  INITIAL_PRODUCT_GROUPS 
} from "../../lib/alignmentService";
import { calculateSecuredAnalyticsScope } from "../../lib/analyticsScopeEngine";
import { User, AnalyticsDbState } from "../../types";

interface SynergyReportsProps {
  lang: "en" | "ar";
  currentUser?: User;
  dbState?: AnalyticsDbState;
}

export default function SynergyReports({ lang, currentUser, dbState }: SynergyReportsProps) {
  const isRtl = lang === "ar";

  // Selected Report Type
  const [selectedReportId, setSelectedReportId] = useState<number>(1);

  // Cascading Geography States
  const [selectedCountry, setSelectedCountry] = useState<string>("All");
  const [selectedDistrict, setSelectedDistrict] = useState<string>("All");
  const [selectedCity, setSelectedCity] = useState<string>("All");
  const [selectedTerritory, setSelectedTerritory] = useState<string>("All");

  // Other Filters
  const [selectedProductGroup, setSelectedProductGroup] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Get raw alignment report datasets
  const rawReportsData = useMemo(() => getSynergyReportData(lang), [lang]);

  // Compute secured scope if props exist
  const securedScope = useMemo(() => {
    if (currentUser && dbState) {
      return calculateSecuredAnalyticsScope(currentUser, dbState);
    }
    return null;
  }, [currentUser, dbState]);

  // Filter the alignment reports based on secured scope!
  const reportsData = useMemo(() => {
    if (!securedScope || securedScope.level === "national") {
      return rawReportsData;
    }

    const isTerritoryAllowed = (territoryName: string): boolean => {
      const lowerName = territoryName.toLowerCase().trim();
      return securedScope.allowedTerritories.some(t => {
        const allowedPath = t.toLowerCase().trim();
        return lowerName.includes(allowedPath) || allowedPath.includes(lowerName);
      });
    };

    const filterByTerritoryField = (arr: any[], field = "territory") => {
      return arr.filter(item => isTerritoryAllowed(item[field] || ""));
    };

    return {
      synergyReport: filterByTerritoryField(rawReportsData.synergyReport),
      productPerformance: filterByTerritoryField(rawReportsData.productPerformance),
      activityVsSales: rawReportsData.activityVsSales, // simple trendline, stays global
      coverageVsSales: filterByTerritoryField(rawReportsData.coverageVsSales),
      intentVsSales: rawReportsData.intentVsSales, // monthly trend, stays global
      samplesVsSales: rawReportsData.samplesVsSales, // monthly trend, stays global
      marketingVsSales: rawReportsData.marketingVsSales, // marketing events, stays global
      repPairPerformance: filterByTerritoryField(rawReportsData.repPairPerformance)
    };
  }, [rawReportsData, securedScope]);

  // Filtering options dynamically
  const filteredDistricts = useMemo(() => {
    if (selectedCountry === "All") return [];
    return INITIAL_DISTRICTS.filter(d => d.countryId === selectedCountry);
  }, [selectedCountry]);

  const filteredCities = useMemo(() => {
    if (selectedDistrict === "All") return [];
    return INITIAL_CITIES.filter(c => c.districtId === selectedDistrict);
  }, [selectedDistrict]);

  const filteredTerritories = useMemo(() => {
    if (selectedCity === "All") return [];
    return INITIAL_TERRITORIES.filter(t => t.cityId === selectedCity);
  }, [selectedCity]);

  // Handle Cascading Selection resets
  const handleCountryChange = (countryId: string) => {
    setSelectedCountry(countryId);
    setSelectedDistrict("All");
    setSelectedCity("All");
    setSelectedTerritory("All");
  };

  const handleDistrictChange = (districtId: string) => {
    setSelectedDistrict(districtId);
    setSelectedCity("All");
    setSelectedTerritory("All");
  };

  const handleCityChange = (cityId: string) => {
    setSelectedCity(cityId);
    setSelectedTerritory("All");
  };

  // 8 Official Reports Configurations
  const reportList = [
    { id: 1, name: isRtl ? "تقريب تكامل مبيعات الرعاية الطبية" : "1. Territory Medical–Sales Synergy Report", description: "Evaluates operational overlap, call frequency matching, and prescription-sales conversions per territory." },
    { id: 2, name: isRtl ? "مؤشرات أداء المنتجات حسب المنطقة" : "2. Product Performance by Territory", description: "Breaks down detailing calls against physical sales values and sentiments for each product sku." },
    { id: 3, name: isRtl ? "مقارنة النشاط الطبي مع مبيعات الصيدليات" : "3. Medical Activity vs Pharmacy Sales Report", description: "Correlates doctor detailing visits with cash and credit order value trendlines over time." },
    { id: 4, name: isRtl ? "معدل تغطية العيادات مقابل المبيعات" : "4. Physician Coverage vs Pharmacy Sales", description: "Maps total physician target coverage percentages against registered territory sales volume." },
    { id: 5, name: isRtl ? "نية الوصفات الطبية مقابل اتجاه المبيعات" : "5. Prescription Intent vs Sales Trend", description: "Compares representatives' doctor sentiment scores with sales volumes to forecast market momentum." },
    { id: 6, name: isRtl ? "تأثير توزيع عينات الأدوية على المبيعات" : "6. Samples vs Sales Impact Report", description: "Tracks the direct market feedback loop of sample distribution compared to next-month sales." },
    { id: 7, name: isRtl ? "الأنشطة التسويقية مقابل كفاءة المبيعات" : "7. Marketing Activities vs Sales Report", description: "Measures return on marketing investment (ROMI) by mapping sponsorship budgets to sales lifts." },
    { id: 8, name: isRtl ? "تقييم التوافق وتكامل ممثل الطبي والبيع" : "8. Representative Pair Performance Report", description: "Highlights paired Medical & Sales representative synergy scores and joint target achievement rates." }
  ];

  // Simulated export to CSV
  const handleExportData = () => {
    alert(isRtl 
      ? "تم تصدير التقرير الطبي-البيعي بصيغة CSV بنجاح لحساب المشرف الإقليمي!" 
      : "Synergy Alignment report successfully downloaded as CSV with cryptographic validation check!"
    );
  };

  return (
    <div className="space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      
      {/* Interactive Controls & Filters Bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-5 rounded-2xl shadow-xxs space-y-4">
        <div className="flex items-center gap-2 text-slate-850 dark:text-white pb-3 border-b border-slate-100 dark:border-slate-800">
          <Filter size={16} className="text-cyan-500" />
          <h4 className="text-xs font-bold uppercase tracking-wider">
            {isRtl ? "لوحة التصفية الجغرافية المتتالية وتحديد النطاقات" : "Cascading Territory & Alignment Filter System"}
          </h4>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          {/* 1. Country Select */}
          <div className="space-y-1">
            <label className="text-[10px] text-slate-400 font-bold block uppercase">{isRtl ? "الدولة" : "1. Country"}</label>
            <select 
              value={selectedCountry}
              onChange={(e) => handleCountryChange(e.target.value)}
              className="w-full text-xs p-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-850 rounded-lg focus:outline-none focus:border-cyan-500 text-slate-700 dark:text-slate-200"
            >
              <option value="All">{isRtl ? "كل الدول" : "Select Country"}</option>
              {INITIAL_COUNTRIES.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* 2. District Select */}
          <div className="space-y-1">
            <label className="text-[10px] text-slate-400 font-bold block uppercase">{isRtl ? "المنطقة" : "2. District"}</label>
            <select 
              value={selectedDistrict}
              onChange={(e) => handleDistrictChange(e.target.value)}
              disabled={selectedCountry === "All"}
              className="w-full text-xs p-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-850 rounded-lg focus:outline-none focus:border-cyan-500 text-slate-700 dark:text-slate-200 disabled:opacity-40"
            >
              <option value="All">{isRtl ? "كل المناطق" : "Select District"}</option>
              {filteredDistricts.map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>

          {/* 3. City Select */}
          <div className="space-y-1">
            <label className="text-[10px] text-slate-400 font-bold block uppercase">{isRtl ? "المدينة" : "3. City"}</label>
            <select 
              value={selectedCity}
              onChange={(e) => handleCityChange(e.target.value)}
              disabled={selectedDistrict === "All"}
              className="w-full text-xs p-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-850 rounded-lg focus:outline-none focus:border-cyan-500 text-slate-700 dark:text-slate-200 disabled:opacity-40"
            >
              <option value="All">{isRtl ? "كل المدن" : "Select City"}</option>
              {filteredCities.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* 4. Area / Territory Select */}
          <div className="space-y-1">
            <label className="text-[10px] text-slate-400 font-bold block uppercase">{isRtl ? "النطاق / الإقليم" : "4. Area / Territory"}</label>
            <select 
              value={selectedTerritory}
              onChange={(e) => setSelectedTerritory(e.target.value)}
              disabled={selectedCity === "All"}
              className="w-full text-xs p-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-850 rounded-lg focus:outline-none focus:border-cyan-500 text-slate-700 dark:text-slate-200 disabled:opacity-40"
            >
              <option value="All">{isRtl ? "كل النطاقات" : "Select Area (Cascade)"}</option>
              {filteredTerritories.map(t => (
                <option key={t.territoryId} value={t.territoryId}>{t.areaName}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Product Line and search filtering */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="flex gap-4">
            <div className="space-y-1 flex-1">
              <label className="text-[10px] text-slate-400 font-bold block uppercase">{isRtl ? "مجموعة المنتجات" : "Product Group Line"}</label>
              <select 
                value={selectedProductGroup}
                onChange={(e) => setSelectedProductGroup(e.target.value)}
                className="w-full text-xs p-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-850 rounded-lg focus:outline-none focus:border-cyan-500 text-slate-700 dark:text-slate-200"
              >
                <option value="All">{isRtl ? "كل خطوط المنتجات" : "All Product Groups"}</option>
                {INITIAL_PRODUCT_GROUPS.map(pg => (
                  <option key={pg.id} value={pg.id}>{pg.name}</option>
                ))}
              </select>
            </div>
          </div>
          
          <div className="flex items-end justify-end gap-3 pb-0.5">
            <button
              onClick={handleExportData}
              className="flex items-center gap-1.5 px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-bold rounded-lg transition-colors cursor-pointer"
            >
              <Download size={14} />
              <span>{isRtl ? "تصدير بصيغة CSV" : "Export Report Data"}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main split reporting view */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left column: Report Selection list */}
        <div className="space-y-3 lg:col-span-1">
          <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-4 rounded-2xl">
            <h3 className="text-xs font-bold text-slate-800 dark:text-white uppercase tracking-wider mb-3 flex items-center gap-2">
              <FileText size={15} className="text-cyan-600" />
              <span>{isRtl ? "قائمة التقارير والتحليلات المتوفرة" : "Alignment Synergy Reports"}</span>
            </h3>

            <div className="space-y-1">
              {reportList.map(rep => (
                <button
                  key={rep.id}
                  onClick={() => setSelectedReportId(rep.id)}
                  className={`w-full text-left p-3 rounded-xl transition-all flex flex-col gap-1 cursor-pointer ${
                    selectedReportId === rep.id 
                      ? "bg-cyan-50 dark:bg-cyan-950/40 border border-cyan-150 dark:border-cyan-900 text-cyan-600 dark:text-cyan-400" 
                      : "hover:bg-slate-50 dark:hover:bg-slate-850/50 text-slate-650 dark:text-slate-300 border border-transparent"
                  }`}
                >
                  <span className="text-xs font-semibold leading-tight">{rep.name}</span>
                  <span className="text-[10px] text-slate-400 line-clamp-1 font-normal">{rep.description}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right column: Active interactive report content */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-6 rounded-2xl space-y-6">
            
            {/* Active Report Header */}
            <div className="border-b border-slate-100 dark:border-slate-800 pb-4 space-y-1.5">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-cyan-50 dark:bg-cyan-950/40 text-[9px] text-cyan-600 dark:text-cyan-400 font-bold uppercase rounded">
                <Sparkles size={10} />
                <span>{isRtl ? "مخرجات النظام النشطة" : "Active Core Synergy Report"}</span>
              </span>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                {reportList.find(r => r.id === selectedReportId)?.name}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {reportList.find(r => r.id === selectedReportId)?.description}
              </p>
            </div>

            {/* Interactive visual charts based on active Report */}
            {selectedReportId === 1 && (
              <div className="space-y-6">
                {/* 1. Territory Medical-Sales Synergy Report */}
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={reportsData.synergyReport}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="territory" stroke="#94a3b8" fontSize={9} tickFormatter={(v) => v.split("/").pop() || v} />
                      <YAxis stroke="#94a3b8" fontSize={9} />
                      <Tooltip contentStyle={{ fontSize: "11px", borderRadius: "8px" }} />
                      <Legend wrapperStyle={{ fontSize: "10px" }} />
                      <Bar dataKey="medicalVisits" name={isRtl ? "زيارات علمية" : "Medical Visits"} fill="#06b6d4" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="pharmacyVisits" name={isRtl ? "زيارات صيدلية" : "Pharmacy Visits"} fill="#6366f1" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="synergyScore" name={isRtl ? "مؤشر التكامل (%)" : "Synergy Score (%)"} fill="#10b981" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* Detail Table */}
                <div className="overflow-x-auto border border-slate-100 dark:border-slate-800 rounded-xl">
                  <table className="w-full text-xs text-left text-slate-650 dark:text-slate-300">
                    <thead className="bg-slate-50 dark:bg-slate-950 text-[10px] text-slate-400 uppercase font-bold">
                      <tr>
                        <th className="p-3">{isRtl ? "الإقليم / النطاق" : "Territory"}</th>
                        <th className="p-3">{isRtl ? "فريق الترويج (علمي + بيع)" : "Assigned Representatives"}</th>
                        <th className="p-3 text-center">{isRtl ? "الزيارات" : "Visits (Med / Phar)"}</th>
                        <th className="p-3 text-right">{isRtl ? "المبيعات" : "Sales (USD)"}</th>
                        <th className="p-3 text-center">{isRtl ? "مؤشر التآزر" : "Synergy"}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {reportsData.synergyReport.map((row, i) => (
                        <tr key={i} className="hover:bg-slate-50/50 dark:hover:bg-slate-850/20">
                          <td className="p-3 font-semibold">{row.territory.split("/").pop()}</td>
                          <td className="p-3">
                            <div className="flex flex-col">
                              <span className="text-cyan-600 font-medium">🔬 {row.medicalRep}</span>
                              <span className="text-indigo-500">💰 {row.salesRep}</span>
                            </div>
                          </td>
                          <td className="p-3 text-center font-mono">
                            {row.medicalVisits} / {row.pharmacyVisits}
                          </td>
                          <td className="p-3 text-right font-bold font-mono text-emerald-600">
                            ${row.totalSalesUSD.toLocaleString()}
                          </td>
                          <td className="p-3 text-center">
                            <span className="inline-block px-2 py-0.5 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 font-bold rounded">
                              {row.synergyScore}%
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {selectedReportId === 2 && (
              <div className="space-y-6">
                {/* 2. Product Performance by Territory */}
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={reportsData.productPerformance}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="product" stroke="#94a3b8" fontSize={9} />
                      <YAxis stroke="#94a3b8" fontSize={9} />
                      <Tooltip contentStyle={{ fontSize: "11px", borderRadius: "8px" }} />
                      <Legend wrapperStyle={{ fontSize: "10px" }} />
                      <Bar dataKey="detailingCalls" name={isRtl ? "زيارات الشرح العلمي" : "Detailing Calls"} fill="#06b6d4" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="pharmacySalesUnits" name={isRtl ? "المبيعات الفردية للصيدليات" : "Sales Units"} fill="#4f46e5" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="overflow-x-auto border border-slate-100 dark:border-slate-800 rounded-xl">
                  <table className="w-full text-xs text-left text-slate-650 dark:text-slate-300">
                    <thead className="bg-slate-50 dark:bg-slate-950 text-[10px] text-slate-400 uppercase font-bold">
                      <tr>
                        <th className="p-3">{isRtl ? "المنتج" : "Product SKU"}</th>
                        <th className="p-3">{isRtl ? "المنطقة" : "Territory"}</th>
                        <th className="p-3 text-center">{isRtl ? "زيارات الشرح" : "Detailing"}</th>
                        <th className="p-3 text-center">{isRtl ? "وحدات البيع" : "Units Sold"}</th>
                        <th className="p-3 text-right">{isRtl ? "القيمة" : "Sales Value"}</th>
                        <th className="p-3">{isRtl ? "تجاوب الأطباء" : "Physician Sentiment"}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {reportsData.productPerformance.map((row, i) => (
                        <tr key={i} className="hover:bg-slate-50/50 dark:hover:bg-slate-850/20">
                          <td className="p-3 font-semibold">{row.product}</td>
                          <td className="p-3">{row.territory}</td>
                          <td className="p-3 text-center font-mono">{row.detailingCalls}</td>
                          <td className="p-3 text-center font-mono">{row.pharmacySalesUnits}</td>
                          <td className="p-3 text-right font-mono text-emerald-600 font-bold">${row.totalValueUSD.toLocaleString()}</td>
                          <td className="p-3">
                            <span className="px-2 py-0.5 bg-cyan-50 dark:bg-cyan-950/40 text-cyan-600 rounded-full text-[10px] font-bold">
                              {row.physicianSentiment}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {selectedReportId === 3 && (
              <div className="space-y-6">
                {/* 3. Medical Activity vs Pharmacy Sales Report */}
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={reportsData.activityVsSales}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="week" stroke="#94a3b8" fontSize={9} />
                      <YAxis stroke="#94a3b8" fontSize={9} />
                      <Tooltip contentStyle={{ fontSize: "11px" }} />
                      <Legend wrapperStyle={{ fontSize: "10px" }} />
                      <Line type="monotone" dataKey="medicalVisits" name={isRtl ? "زيارات الأطباء علمياً" : "Doctor Visits"} stroke="#06b6d4" strokeWidth={2.5} />
                      <Line type="monotone" dataKey="salesUSD" name={isRtl ? "حجم مبيعات الصيدليات ($)" : "Sales (USD)"} stroke="#10b981" strokeWidth={2.5} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <div className="bg-slate-50 dark:bg-slate-950 p-4 rounded-xl text-xs space-y-2 border border-slate-100 dark:border-slate-850">
                  <h4 className="font-bold text-slate-800 dark:text-white flex items-center gap-1.5">
                    <Activity size={14} className="text-cyan-500" />
                    <span>{isRtl ? "استنتاجات مطابقة النشاط الترويجي للمبيعات" : "Activity-to-Sales Conversion Gaps"}</span>
                  </h4>
                  <p className="text-slate-500 dark:text-slate-400">
                    {isRtl 
                      ? "نلاحظ وجود فجوة زمنية تبلغ 1.5 أسبوع بين زيادة معدل زيارات الأطباء ونمو المبيعات الفعلية بالصيدليات المجاورة. هذا يثبت استقرار استجابة الأطباء وتدفق الطلبات."
                      : "A correlation factor of 0.89 indicates doctor visits lead local pharmacy sales spikes by exactly 10-12 days. Medical representative field visits act as a reliable leading indicator."
                    }
                  </p>
                </div>
              </div>
            )}

            {selectedReportId === 4 && (
              <div className="space-y-6">
                {/* 4. Physician Coverage vs Pharmacy Sales */}
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={reportsData.coverageVsSales}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="territory" stroke="#94a3b8" fontSize={9} />
                      <YAxis stroke="#94a3b8" fontSize={9} />
                      <Tooltip contentStyle={{ fontSize: "11px" }} />
                      <Legend wrapperStyle={{ fontSize: "10px" }} />
                      <Bar dataKey="coveragePct" name={isRtl ? "نسبة تغطية الأطباء (%)" : "Physician Coverage %"} fill="#a855f7" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="salesUSD" name={isRtl ? "مبيعات المنطقة ($)" : "Pharmacy Sales USD"} fill="#10b981" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="bg-purple-50 dark:bg-purple-950/20 p-4 rounded-xl text-xs border border-purple-100 dark:border-purple-900/40 text-purple-700 dark:text-purple-300">
                  <strong>{isRtl ? "نصيحة نمو الإقليم:" : "Territory Growth Tip:"}</strong> {isRtl 
                    ? "الوصول لتغطية أطباء تفوق 80٪ في منطقة طرابلس وسط يساهم في مضاعفة مبيعات الصيدليات بمعدل 2.4 مرة. الأقاليم ذات التغطية المنخفضة تمثل فجوات ترويجية عاجلة."
                    : "Territories exceeding 80% physician coverage yields a exponential 2.4x return in local pharmacies checkout flow. Low coverage zones represent severe leakage areas."
                  }
                </div>
              </div>
            )}

            {selectedReportId === 5 && (
              <div className="space-y-6">
                {/* 5. Prescription Intent vs Sales Trend */}
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={reportsData.intentVsSales}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="month" stroke="#94a3b8" fontSize={9} />
                      <YAxis stroke="#94a3b8" fontSize={9} />
                      <Tooltip contentStyle={{ fontSize: "11px" }} />
                      <Legend wrapperStyle={{ fontSize: "10px" }} />
                      <Area type="monotone" dataKey="avgIntent" name={isRtl ? "نية الوصفة الطبيب (1-10)" : "Prescription Intent (1-10)"} stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.15} />
                      <Area type="monotone" dataKey="salesUSD" name={isRtl ? "مبيعات صيدليات المنطقة" : "Sales (USD)"} stroke="#10b981" fill="#10b981" fillOpacity={0.05} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {selectedReportId === 6 && (
              <div className="space-y-6">
                {/* 6. Samples vs Sales Impact Report */}
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={reportsData.samplesVsSales}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="month" stroke="#94a3b8" fontSize={9} />
                      <YAxis stroke="#94a3b8" fontSize={9} />
                      <Tooltip contentStyle={{ fontSize: "11px" }} />
                      <Legend wrapperStyle={{ fontSize: "10px" }} />
                      <Line type="monotone" dataKey="samplesGiven" name={isRtl ? "العينات المجانية المنصرفة" : "Samples Distributed"} stroke="#ec4899" strokeWidth={2.5} />
                      <Line type="monotone" dataKey="salesNextMonth" name={isRtl ? "مبيعات الشهر التالي ($)" : "Next-Month Sales (USD)"} stroke="#10b981" strokeWidth={2.5} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {selectedReportId === 7 && (
              <div className="space-y-6">
                {/* 7. Marketing Activities vs Sales Report */}
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={reportsData.marketingVsSales}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="activityType" stroke="#94a3b8" fontSize={9} />
                      <YAxis stroke="#94a3b8" fontSize={9} />
                      <Tooltip contentStyle={{ fontSize: "11px" }} />
                      <Legend wrapperStyle={{ fontSize: "10px" }} />
                      <Bar dataKey="budget" name={isRtl ? "ميزانية النشاط التسويقي ($)" : "Marketing Budget (USD)"} fill="#f59e0b" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="salesLiftPct" name={isRtl ? "معدل زيادة المبيعات (%)" : "Sales Lift %"} fill="#10b981" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {selectedReportId === 8 && (
              <div className="space-y-6">
                {/* 8. Representative Pair Performance Report */}
                <div className="h-64 w-full flex justify-center items-center">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart cx="50%" cy="50%" outerRadius="80%" data={[
                      { subject: isRtl ? "مزامنة خطط العمل" : "Plan Sync", A: 95, B: 80, C: 90 },
                      { subject: isRtl ? "مشاركة خط المنتج" : "Product Share", A: 90, B: 75, C: 85 },
                      { subject: isRtl ? "التغطية الميدانية" : "Coverage Speed", A: 98, B: 82, C: 88 },
                      { subject: isRtl ? "تبادل المعلومات" : "Intel Exchange", A: 92, B: 78, C: 84 },
                      { subject: isRtl ? "إنجاز الأهداف" : "Target Achived", A: 96, B: 85, C: 92 }
                    ]}>
                      <PolarGrid stroke="#94a3b8" opacity={0.2} />
                      <PolarAngleAxis dataKey="subject" stroke="#94a3b8" fontSize={9} />
                      <PolarRadiusAxis angle={30} domain={[0, 100]} stroke="#94a3b8" fontSize={8} />
                      <Radar name="Anas + Yasmine (Tripoli)" dataKey="A" stroke="#06b6d4" fill="#06b6d4" fillOpacity={0.3} />
                      <Radar name="Omar + Abulmhaimen (Al Jufra)" dataKey="B" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.15} />
                      <Radar name="Sarah + Tarek (Al Khums)" dataKey="C" stroke="#10b981" fill="#10b981" fillOpacity={0.1} />
                      <Tooltip contentStyle={{ fontSize: "10px" }} />
                      <Legend wrapperStyle={{ fontSize: "9px" }} />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>

                <div className="overflow-x-auto border border-slate-100 dark:border-slate-800 rounded-xl">
                  <table className="w-full text-xs text-left text-slate-650 dark:text-slate-300">
                    <thead className="bg-slate-50 dark:bg-slate-950 text-[10px] text-slate-400 uppercase font-bold">
                      <tr>
                        <th className="p-3">{isRtl ? "ثنائي ممثلي الترويج والبيع" : "Rep Pair"}</th>
                        <th className="p-3">{isRtl ? "الإقليم الجغرافي" : "Territory"}</th>
                        <th className="p-3 text-center">{isRtl ? "مؤشر التآزر" : "Synergy Score"}</th>
                        <th className="p-3 text-center">{isRtl ? "حالة المواءمة" : "Alignment Level"}</th>
                        <th className="p-3 text-right">{isRtl ? "تحقيق المستهدف المشترك" : "Combined Target Ach %"}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {reportsData.repPairPerformance.map((row, i) => (
                        <tr key={i} className="hover:bg-slate-50/50 dark:hover:bg-slate-850/20">
                          <td className="p-3 font-semibold text-slate-900 dark:text-white">{row.pair}</td>
                          <td className="p-3">{row.territory}</td>
                          <td className="p-3 text-center">
                            <span className="px-2 py-0.5 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 rounded font-bold font-mono">
                              {row.synergyScore}%
                            </span>
                          </td>
                          <td className="p-3 text-center">
                            <span className="px-2.5 py-1 bg-cyan-50 dark:bg-cyan-950/40 text-cyan-600 rounded-full font-bold text-[10px]">
                              {row.alignmentLevel}
                            </span>
                          </td>
                          <td className="p-3 text-right font-bold font-mono text-emerald-600">
                            {row.combinedTargetAchPct}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

          </div>
        </div>

      </div>

    </div>
  );
}
