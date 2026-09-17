import React, { useState, useMemo } from "react";
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  LineChart, Line, ComposedChart, AreaChart, Area, PieChart, Pie, Cell
} from "recharts";
import { 
  TrendingUp, TrendingDown, Award, Activity, Package, BarChart3, 
  Target, AlertTriangle, CheckCircle, ChevronDown, Filter, HelpCircle, 
  MapPin, RefreshCw, Layers, Zap, MessageSquare, ShieldCheck, FileText, 
  ArrowRightLeft, Inbox, ClipboardList, RefreshCw as ReturnIcon
} from "lucide-react";
import { 
  Role, 
  User, 
  Product
} from "../../types";

interface SampleAnalyticsPageProps {
  currentUser: User;
  lang: "en" | "ar";
  users: User[];
  products: Product[];
}

export default function SampleAnalyticsPage({
  currentUser,
  lang,
  users = [],
  products = []
}: SampleAnalyticsPageProps) {
  const isRtl = lang === "ar";
  const [activeTab, setActiveTab] = useState<"overview" | "distribution" | "inventory" | "requests" | "returns" | "allocations" | "performance">("overview");

  // Hardcoded realistic records for clinical sample economics
  const mockInventory = useMemo(() => {
    return [
      { id: "SMP-CRD-01", name: "CardioMax 10mg Sample Box", therapeuticArea: "Cardiology", quantity: 1250, criticalLevel: 500, value: 3750, batch: "B-CARD-26" },
      { id: "SMP-KDV-02", name: "KidVits Chewable Sample Pack", therapeuticArea: "Pediatrics", quantity: 2400, criticalLevel: 800, value: 4800, batch: "B-KID-25" },
      { id: "SMP-ACN-03", name: "AcneCare Lotion Sample Box", therapeuticArea: "Dermatology", quantity: 350, criticalLevel: 600, value: 1050, batch: "B-ACN-27" }, // Critical!
      { id: "SMP-GST-04", name: "GastroShield 20mg Sample Box", therapeuticArea: "Gastroenterology", quantity: 1800, criticalLevel: 500, value: 5400, batch: "B-GAST-26" }
    ];
  }, []);

  const mockRequests = useMemo(() => {
    return [
      { id: "REQ-901", repName: "Mustafa Al-Zawi", productName: "CardioMax Samples", qty: 250, date: "2026-06-28", status: "Approved" },
      { id: "REQ-902", repName: "Ahmed Al-Siddiq", productName: "KidVits Samples", qty: 400, date: "2026-06-27", status: "Approved" },
      { id: "REQ-903", repName: "Sarah Al-Ghazali", productName: "AcneCare Samples", qty: 150, date: "2026-06-29", status: "Pending Approval" },
      { id: "REQ-904", repName: "Tarek Abu-Zeid", productName: "GastroShield Samples", qty: 200, date: "2026-06-25", status: "Completed" }
    ];
  }, []);

  const mockReturns = useMemo(() => {
    return [
      { id: "RET-101", repName: "Ahmed Al-Siddiq", productName: "CardioMax Samples", qty: 20, reason: "Expired batch return", date: "2026-06-22", status: "Received" },
      { id: "RET-102", repName: "Mustafa Al-Zawi", productName: "AcneCare Samples", qty: 15, reason: "Damaged outer packaging", date: "2026-06-20", status: "Pending Audit" }
    ];
  }, []);

  const mockAllocations = useMemo(() => {
    return [
      { territory: isRtl ? "طرابلس المركز" : "Tripoli Central", CardioMax: 500, KidVits: 800, AcneCare: 200, GastroShield: 400 },
      { territory: isRtl ? "بنغازي الشمالية" : "Benghazi North", CardioMax: 400, KidVits: 600, AcneCare: 150, GastroShield: 350 },
      { territory: isRtl ? "سبها الجنوبية" : "Sebha South", CardioMax: 150, KidVits: 300, AcneCare: 50, GastroShield: 150 },
      { territory: isRtl ? "الزاوية والغربية" : "Zawia & West", CardioMax: 300, KidVits: 500, AcneCare: 100, GastroShield: 250 }
    ];
  }, [isRtl]);

  const mockPerformance = useMemo(() => {
    return [
      { name: "Mustafa Al-Zawi", samplesDistributed: 410, prescriptionsGenerated: 98, efficacyRate: 24, role: "Sales Representative" },
      { name: "Ahmed Al-Siddiq", samplesDistributed: 620, prescriptionsGenerated: 145, efficacyRate: 23, role: "Medical Representative" },
      { name: "Sarah Al-Ghazali", samplesDistributed: 280, prescriptionsGenerated: 76, efficacyRate: 27, role: "Medical Representative" },
      { name: "Tarek Abu-Zeid", samplesDistributed: 310, prescriptionsGenerated: 62, efficacyRate: 20, role: "Medical Representative" }
    ];
  }, []);

  const sampleDistributionData = useMemo(() => {
    return [
      { name: "CardioMax 10mg", value: 450, color: "#6366f1" },
      { name: "KidVits Chewable", value: 680, color: "#10b981" },
      { name: "AcneCare Lotion", value: 180, color: "#f59e0b" },
      { name: "GastroShield 20mg", value: 310, color: "#ec4899" }
    ];
  }, []);

  // Compute stats
  const stats = useMemo(() => {
    const totalAllocated = 2500;
    const totalDistributed = 1620;
    const stockBalance = totalAllocated - totalDistributed;
    const utilizationRate = Math.round((totalDistributed / totalAllocated) * 100);

    return {
      totalAllocated,
      totalDistributed,
      stockBalance,
      utilizationRate
    };
  }, []);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      
      {/* HEADER SECTION */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-1.5 bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 rounded-lg">
              <Layers size={20} />
            </span>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white font-sans tracking-tight">
              {isRtl ? "اقتصاديات وتوزيع العينات الطبية والترويجية" : "Medical Sample Economics & Allocation Safeguards"}
            </h1>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-2xl mt-1">
            {isRtl 
              ? "تحليل معدلات استهلاك العينات الطبية المجانية للأطباء، ومراقبة رصيد المخزون المركزي وحالات الاسترجاع والطلب لكل مندوب." 
              : "Tracing professional sample distribution, verifying central vault inventories, processing returns, and assessing representative compliance."}
          </p>
        </div>

        {/* Security badge */}
        <div className="flex items-center gap-2 text-xxs bg-slate-50 dark:bg-slate-900 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800">
          <ShieldCheck size={12} className="text-indigo-500" />
          <span className="font-mono text-slate-600 dark:text-slate-400 uppercase font-bold">
            {isRtl ? "رقابة العينات: مفعلة" : "Sample Controls: Active"}
          </span>
        </div>
      </div>

      {/* DETAILED TABS BAR */}
      <div className="flex flex-wrap gap-1 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-xl text-xs font-bold max-w-full">
        <button
          onClick={() => setActiveTab("overview")}
          className={`flex items-center gap-1 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${activeTab === "overview" ? "bg-white dark:bg-slate-900 text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
        >
          <BarChart3 size={13} />
          <span>{isRtl ? "النظرة العامة" : "Overview"}</span>
        </button>
        <button
          onClick={() => setActiveTab("distribution")}
          className={`flex items-center gap-1 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${activeTab === "distribution" ? "bg-white dark:bg-slate-900 text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
        >
          <Activity size={13} />
          <span>{isRtl ? "التوزيع الفعلي" : "Distribution"}</span>
        </button>
        <button
          onClick={() => setActiveTab("inventory")}
          className={`flex items-center gap-1 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${activeTab === "inventory" ? "bg-white dark:bg-slate-900 text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
        >
          <Package size={13} />
          <span>{isRtl ? "المخزون المركزي" : "Inventory"}</span>
        </button>
        <button
          onClick={() => setActiveTab("requests")}
          className={`flex items-center gap-1 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${activeTab === "requests" ? "bg-white dark:bg-slate-900 text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
        >
          <Inbox size={13} />
          <span>{isRtl ? "طلبات المندوبين" : "Requests"}</span>
        </button>
        <button
          onClick={() => setActiveTab("returns")}
          className={`flex items-center gap-1 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${activeTab === "returns" ? "bg-white dark:bg-slate-900 text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
        >
          <ArrowRightLeft size={13} />
          <span>{isRtl ? "مرتجع العينات" : "Returns Log"}</span>
        </button>
        <button
          onClick={() => setActiveTab("allocations")}
          className={`flex items-center gap-1 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${activeTab === "allocations" ? "bg-white dark:bg-slate-900 text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
        >
          <MapPin size={13} />
          <span>{isRtl ? "مخصصات الأقاليم" : "Allocations"}</span>
        </button>
        <button
          onClick={() => setActiveTab("performance")}
          className={`flex items-center gap-1 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${activeTab === "performance" ? "bg-white dark:bg-slate-900 text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
        >
          <Award size={13} />
          <span>{isRtl ? "كفاءة الاستهلاك" : "Rep Efficacy"}</span>
        </button>
      </div>

      {/* OVERVIEW TAB */}
      {activeTab === "overview" && (
        <div className="space-y-6 animate-fade-in">
          {/* Quick Metrics Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-slate-900 p-4 border border-slate-100 dark:border-slate-850 rounded-xl">
              <span className="text-[10px] text-slate-400 block font-bold uppercase">{isRtl ? "المخصصات الإجمالية للعينات" : "Total Allocated Units"}</span>
              <span className="text-xl font-bold text-slate-850 dark:text-white font-mono">{stats.totalAllocated}</span>
            </div>
            <div className="bg-white dark:bg-slate-900 p-4 border border-slate-100 dark:border-slate-850 rounded-xl">
              <span className="text-[10px] text-slate-400 block font-bold uppercase">{isRtl ? "إجمالي المنصرف والمسلم" : "Total Distributed"}</span>
              <span className="text-xl font-bold text-slate-850 dark:text-white font-mono">{stats.totalDistributed}</span>
            </div>
            <div className="bg-white dark:bg-slate-900 p-4 border border-slate-100 dark:border-slate-850 rounded-xl">
              <span className="text-[10px] text-slate-400 block font-bold uppercase">{isRtl ? "المتبقي بالمستودع المركزي" : "Central Stock Balance"}</span>
              <span className="text-xl font-bold text-slate-850 dark:text-white font-mono">{stats.stockBalance}</span>
            </div>
            <div className="bg-white dark:bg-slate-900 p-4 border border-slate-100 dark:border-slate-850 rounded-xl">
              <span className="text-[10px] text-slate-400 block font-bold uppercase">{isRtl ? "معدل استهلاك المخصص" : "Utilization Percentage"}</span>
              <span className="text-xl font-bold text-indigo-600 font-mono">{stats.utilizationRate}%</span>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            
            {/* Left: Distribution Breakdown */}
            <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 p-5 rounded-2xl shadow-xxs space-y-4">
              <div>
                <h3 className="text-xs font-bold text-slate-850 dark:text-white uppercase">{isRtl ? "توزيع العينات الطبية بحسب الصنف" : "Sample Volume Distribution by SKU"}</h3>
                <p className="text-[10px] text-slate-400">{isRtl ? "النسبة المئوية لكل صنف دوائي من إجمالي العينات الطبية المجانية التي تسلم للأطباء" : "Relative proportion of distributed therapeutic items."}</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
                <div className="h-44 w-full text-xs">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={sampleDistributionData}
                        innerRadius={50}
                        outerRadius={70}
                        paddingAngle={3}
                        dataKey="value"
                      >
                        {sampleDistributionData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                <div className="space-y-2 text-xs">
                  {sampleDistributionData.map((s, idx) => (
                    <div key={idx} className="flex items-center justify-between border-b border-slate-50 dark:border-slate-850 pb-1.5 last:border-0">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                        <span className="text-slate-650 dark:text-slate-350">{s.name}</span>
                      </div>
                      <span className="font-bold font-mono text-slate-850 dark:text-white">{s.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right: Quick Action Alert Box */}
            <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 p-5 rounded-2xl shadow-xxs flex flex-col justify-between">
              <div>
                <h3 className="text-xs font-bold text-slate-850 dark:text-white uppercase flex items-center gap-1.5">
                  <AlertTriangle className="text-amber-500" size={14} />
                  <span>{isRtl ? "إشارات وتنبيهات أمان العينات" : "Sample Compliance Guardrails"}</span>
                </h3>
                <p className="text-[10px] text-slate-400 mt-1">{isRtl ? "رصد التشغيلات منتهية الصلاحية وحالات ندرة المخزون الوقائي" : "Automatic alerts tracking low inventory buffers and return audits."}</p>
              </div>

              <div className="space-y-2.5 my-4">
                <div className="p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/40 rounded-xl text-xs flex gap-2 text-amber-800 dark:text-amber-400">
                  <AlertTriangle size={15} className="shrink-0 mt-0.5" />
                  <div>
                    <strong className="font-bold">{isRtl ? "مخزون حرج لعينة AcneCare:" : "Critical AcneCare Stock:"}</strong>
                    <span className="block mt-0.5 text-[10.5px]">{isRtl ? "الرصيد المتبقي (٣٥٠ عينة) يقل عن مستوى الأمان للمربع الإقليمي." : "Remaining central supply drops below safe threshold (600 unit minimum)."}</span>
                  </div>
                </div>
                <div className="p-3 bg-indigo-50 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-900/40 rounded-xl text-xs flex gap-2 text-indigo-800 dark:text-indigo-350">
                  <CheckCircle size={15} className="shrink-0 mt-0.5 text-indigo-500" />
                  <div>
                    <strong className="font-bold">{isRtl ? "اكتمال جرد العينات المركزي:" : "Central Stock Audit Complete:"}</strong>
                    <span className="block mt-0.5 text-[10.5px]">{isRtl ? "تمت مطابقة كميات العينات بالأقدمية بنسبة ١٠٠٪ دون أي فروقات." : "Central vault matches FIFO batch records with 100% precision."}</span>
                  </div>
                </div>
              </div>

              <span className="text-[9px] text-slate-400 italic block text-right">{isRtl ? "آخر تحديث قبل ساعة واحدة" : "Last updated 1 hour ago"}</span>
            </div>

          </div>
        </div>
      )}

      {/* DISTRIBUTION TAB */}
      {activeTab === "distribution" && (
        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 p-5 rounded-2xl shadow-xxs space-y-4 animate-fade-in">
          <div>
            <h3 className="text-xs font-bold text-slate-850 dark:text-white uppercase">{isRtl ? "منحنى تسليم العينات الطبية" : "Physician Sample Distribution Stream"}</h3>
            <p className="text-[10px] text-slate-400">{isRtl ? "استعراض معدلات صرف العينات الطبية خلال زيارات العيادات" : "Real-time logging of sample drop metrics across physician visits."}</p>
          </div>

          <div className="h-64 w-full text-xs">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={sampleDistributionData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" stroke="#94a3b8" fontSize={9} />
                <YAxis stroke="#94a3b8" fontSize={9} />
                <Tooltip />
                <Bar dataKey="value" name={isRtl ? "الكمية الموزعة" : "Distributed Units"} fill="#6366f1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* INVENTORY TAB */}
      {activeTab === "inventory" && (
        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 p-5 rounded-2xl shadow-xxs space-y-4 animate-fade-in">
          <div>
            <h3 className="text-xs font-bold text-slate-850 dark:text-white uppercase">{isRtl ? "المخزون المركزي للعينات الطبية والمواد" : "Central Sample Vault Inventory Records"}</h3>
            <p className="text-[10px] text-slate-400">{isRtl ? "مراقبة كميات العينات في المستودع المعتمدة وصلاحية تشغيلاتها" : "FIFO monitoring of physical sample packages and critical safety bounds."}</p>
          </div>

          <div className="overflow-x-auto text-xs">
            <table className="w-full text-left" dir={isRtl ? "rtl" : "ltr"}>
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-400 font-bold uppercase text-[9px]">
                  <th className="py-2.5 px-3">{isRtl ? "رمز العينة" : "Sample SKU ID"}</th>
                  <th className="py-2.5 px-3">{isRtl ? "اسم العينة الدوائية" : "Sample Name"}</th>
                  <th className="py-2.5 px-3">{isRtl ? "المجموعة الطبية" : "Therapeutic Area"}</th>
                  <th className="py-2.5 px-3 font-mono">{isRtl ? "التشغيلة" : "Batch ID"}</th>
                  <th className="py-2.5 px-3 text-right">{isRtl ? "الرصيد المتبقي" : "Quantity Balance"}</th>
                  <th className="py-2.5 px-3 text-right">{isRtl ? "مستوى الأمان" : "Safety Threshold"}</th>
                </tr>
              </thead>
              <tbody>
                {mockInventory.map((item) => (
                  <tr key={item.id} className="border-b border-slate-100 dark:border-slate-850 hover:bg-slate-50/50 dark:hover:bg-slate-850/30">
                    <td className="py-3 px-3 font-mono text-slate-400 text-[10.5px]">{item.id}</td>
                    <td className="py-3 px-3 font-semibold text-slate-850 dark:text-white">{item.name}</td>
                    <td className="py-3 px-3 text-slate-450">{item.therapeuticArea}</td>
                    <td className="py-3 px-3 font-mono text-indigo-500 font-semibold">{item.batch}</td>
                    <td className="py-3 px-3 text-right font-mono font-bold">
                      <span className={item.quantity < item.criticalLevel ? "text-rose-500" : "text-slate-850 dark:text-white"}>
                        {item.quantity}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right font-mono text-slate-400">{item.criticalLevel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* REQUESTS TAB */}
      {activeTab === "requests" && (
        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 p-5 rounded-2xl shadow-xxs space-y-4 animate-fade-in">
          <div>
            <h3 className="text-xs font-bold text-slate-850 dark:text-white uppercase">{isRtl ? "طلبات مخصصات العينات الطبية للمندوبين" : "Representative Sample Allocation Requests"}</h3>
            <p className="text-[10px] text-slate-400">{isRtl ? "سجل طلبات المندوبين لخصم كميات إضافية وتوزيعها على عيادات الإقليم" : "Reviewing team allocation requests before physical dispatch."}</p>
          </div>

          <div className="overflow-x-auto text-xs">
            <table className="w-full text-left" dir={isRtl ? "rtl" : "ltr"}>
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-400 font-bold uppercase text-[9px]">
                  <th className="py-2.5 px-3">{isRtl ? "رقم الطلب" : "Request ID"}</th>
                  <th className="py-2.5 px-3">{isRtl ? "مندوب الدعاية" : "Representative Name"}</th>
                  <th className="py-2.5 px-3">{isRtl ? "اسم العينة المطلوبة" : "Requested Item"}</th>
                  <th className="py-2.5 px-3 font-mono">{isRtl ? "الكمية" : "Quantity"}</th>
                  <th className="py-2.5 px-3">{isRtl ? "تاريخ الطلب" : "Request Date"}</th>
                  <th className="py-2.5 px-3 text-center">{isRtl ? "الحالة" : "Approval Status"}</th>
                </tr>
              </thead>
              <tbody>
                {mockRequests.map((req) => (
                  <tr key={req.id} className="border-b border-slate-100 dark:border-slate-850 hover:bg-slate-50/50 dark:hover:bg-slate-850/30">
                    <td className="py-3 px-3 font-mono font-bold text-slate-400">{req.id}</td>
                    <td className="py-3 px-3 font-semibold text-slate-850 dark:text-white">{req.repName}</td>
                    <td className="py-3 px-3 text-slate-600 dark:text-slate-350">{req.productName}</td>
                    <td className="py-3 px-3 font-mono font-bold text-indigo-600">{req.qty}</td>
                    <td className="py-3 px-3 font-mono text-slate-400">{req.date}</td>
                    <td className="py-3 px-3 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${
                        req.status === "Approved" || req.status === "Completed"
                          ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600"
                          : "bg-amber-50 dark:bg-amber-950/40 text-amber-600"
                      }`}>
                        {req.status === "Approved" ? (isRtl ? "تمت الموافقة" : "Approved") : req.status === "Completed" ? (isRtl ? "تم التسليم" : "Dispatched") : (isRtl ? "قيد المراجعة" : "Pending Review")}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* RETURNS TAB */}
      {activeTab === "returns" && (
        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 p-5 rounded-2xl shadow-xxs space-y-4 animate-fade-in">
          <div>
            <h3 className="text-xs font-bold text-slate-850 dark:text-white uppercase">{isRtl ? "سجل استرجاع العينات منتهية الصلاحية" : "Medical Sample Returns & Damages Ledger"}</h3>
            <p className="text-[10px] text-slate-400">{isRtl ? "رصد مرتجعات العينات التالفة أو المنتهية الصلاحية لاستبعادها من النطاق المالي" : "Auditing damaged or expired batch returns from field staff."}</p>
          </div>

          <div className="overflow-x-auto text-xs">
            <table className="w-full text-left" dir={isRtl ? "rtl" : "ltr"}>
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-400 font-bold uppercase text-[9px]">
                  <th className="py-2.5 px-3">{isRtl ? "رقم المرتجع" : "Return ID"}</th>
                  <th className="py-2.5 px-3">{isRtl ? "بواسطة المندوب" : "Representative Name"}</th>
                  <th className="py-2.5 px-3">{isRtl ? "الصنف الدوائي" : "Returned Item"}</th>
                  <th className="py-2.5 px-3 font-mono">{isRtl ? "الكمية المسترجعة" : "Returned Qty"}</th>
                  <th className="py-2.5 px-3">{isRtl ? "سبب الاسترجاع" : "Reason / Defect Description"}</th>
                  <th className="py-2.5 px-3 text-center">{isRtl ? "الحالة" : "Verification Status"}</th>
                </tr>
              </thead>
              <tbody>
                {mockReturns.map((ret) => (
                  <tr key={ret.id} className="border-b border-slate-100 dark:border-slate-850 hover:bg-slate-50/50 dark:hover:bg-slate-850/30">
                    <td className="py-3 px-3 font-mono font-bold text-slate-400">{ret.id}</td>
                    <td className="py-3 px-3 font-semibold text-slate-850 dark:text-white">{ret.repName}</td>
                    <td className="py-3 px-3 text-slate-600 dark:text-slate-350">{ret.productName}</td>
                    <td className="py-3 px-3 font-mono font-bold text-rose-500">{ret.qty}</td>
                    <td className="py-3 px-3 text-slate-400 text-[11px] italic">{ret.reason}</td>
                    <td className="py-3 px-3 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${
                        ret.status === "Received"
                          ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600"
                          : "bg-amber-50 dark:bg-amber-950/40 text-amber-600"
                      }`}>
                        {ret.status === "Received" ? (isRtl ? "تم الاستلام" : "Verified & Received") : (isRtl ? "قيد المطابقة" : "Pending Verification")}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ALLOCATIONS TAB */}
      {activeTab === "allocations" && (
        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 p-5 rounded-2xl shadow-xxs space-y-4 animate-fade-in">
          <div>
            <h3 className="text-xs font-bold text-slate-850 dark:text-white uppercase">{isRtl ? "توزيع حصص العينات الإقليمية بالأرقام" : "Territory Sample Allocation Quota Matrix"}</h3>
            <p className="text-[10px] text-slate-400">{isRtl ? "رصد مخصصات كل منتج إقليمياً لتفادي استهلاك المخصص خارج المربعات المحددة" : "Ensuring samples are directed strictly to assigned target physician clusters."}</p>
          </div>

          <div className="h-64 w-full text-xs">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={mockAllocations}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="territory" stroke="#94a3b8" fontSize={9} />
                <YAxis stroke="#94a3b8" fontSize={9} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: "10px" }} />
                <Bar dataKey="CardioMax" name="CardioMax Samples" fill="#6366f1" radius={[2, 2, 0, 0]} />
                <Bar dataKey="KidVits" name="KidVits Samples" fill="#10b981" radius={[2, 2, 0, 0]} />
                <Bar dataKey="AcneCare" name="AcneCare Samples" fill="#f59e0b" radius={[2, 2, 0, 0]} />
                <Bar dataKey="GastroShield" name="GastroShield Samples" fill="#ec4899" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* PERFORMANCE TAB */}
      {activeTab === "performance" && (
        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-850 p-5 rounded-2xl shadow-xxs space-y-4 animate-fade-in">
          <div>
            <h3 className="text-xs font-bold text-slate-850 dark:text-white uppercase">{isRtl ? "كفاءة المندوبين ومطابقة الوصفات بالعينات" : "Representative Sample Efficacy Index"}</h3>
            <p className="text-[10px] text-slate-400">{isRtl ? "مقارنة حجم توزيع العينات الطبية المجانية بالوصفات الطبية المحققة" : "Analyzing how efficiently sample drops convert to prescription commitment."}</p>
          </div>

          <div className="overflow-x-auto text-xs">
            <table className="w-full text-left" dir={isRtl ? "rtl" : "ltr"}>
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-400 font-bold uppercase text-[9px]">
                  <th className="py-2.5 px-3">{isRtl ? "مندوب الدعاية" : "Representative Name"}</th>
                  <th className="py-2.5 px-3">{isRtl ? "الدور الوظيفي" : "Role"}</th>
                  <th className="py-2.5 px-3 font-mono">{isRtl ? "العينات الموزعة" : "Samples Deployed"}</th>
                  <th className="py-2.5 px-3 font-mono">{isRtl ? "الوصفات الناتجة" : "Prescriptions Tracked"}</th>
                  <th className="py-2.5 px-3 text-right">{isRtl ? "معدل العائد من الاستهلاك" : "Efficacy Conversion %"}</th>
                </tr>
              </thead>
              <tbody>
                {mockPerformance.map((rep, idx) => (
                  <tr key={idx} className="border-b border-slate-100 dark:border-slate-850 hover:bg-slate-50/50 dark:hover:bg-slate-850/30">
                    <td className="py-3 px-3 font-semibold text-slate-850 dark:text-white">{rep.name}</td>
                    <td className="py-3 px-3 text-slate-450 text-[10px]">{rep.role}</td>
                    <td className="py-3 px-3 font-mono font-bold text-slate-700 dark:text-slate-300">{rep.samplesDistributed}</td>
                    <td className="py-3 px-3 font-mono text-indigo-600 font-bold">{rep.prescriptionsGenerated}</td>
                    <td className="py-3 px-3 text-right font-mono font-bold">
                      <div className="flex items-center justify-end gap-2">
                        <span className="text-emerald-500">{rep.efficacyRate}%</span>
                        <div className="w-16 bg-slate-100 dark:bg-slate-800 h-1 rounded-full overflow-hidden">
                          <div className="bg-emerald-500 h-full rounded-full" style={{ width: `${rep.efficacyRate * 3}%` }} />
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </div>
  );
}
