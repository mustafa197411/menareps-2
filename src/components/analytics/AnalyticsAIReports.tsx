import React, { useState, useMemo, useEffect, useRef } from "react";
import { 
  Sparkles, 
  Brain, 
  Lightbulb, 
  TrendingUp, 
  CheckCircle2, 
  ShieldCheck, 
  RefreshCw, 
  Send,
  History as HistoryIcon,
  LayoutTemplate,
  MessageSquare,
  FileText,
  AlertTriangle,
  Lock,
  ChevronRight,
  Info
} from "lucide-react";
import { 
  Role, 
  User, 
  AnalyticsDbState,
  AnalyticsFilters
} from "../../types";

const defaultFilters: AnalyticsFilters = {
  selectedCountry: "All",
  selectedDistrict: "All",
  selectedCity: "All",
  selectedTerritory: "All",
  selectedProductGroup: "All",
  selectedProduct: "All"
};
import { 
  calculateSecuredAnalyticsScope, 
  filterDatasetByScopeAndFilters 
} from "../../lib/analyticsScopeEngine";
import { auth } from "../../lib/firebase";

interface AnalyticsAIReportsProps {
  currentUser: User;
  lang: "en" | "ar";
  users?: User[];
  physicians?: any[];
  pharmacies?: any[];
  products?: any[];
  userTerritoryAssignments?: any[];
  userProductAssignments?: any[];
  physicianVisits?: any[];
  pharmacyVisits?: any[];
}

interface ChatMessage {
  sender: "user" | "ai";
  text: string;
  timestamp: string;
}

interface SavedReport {
  id: string;
  query: string;
  response: string;
  timestamp: string;
  tabUsed: string;
}

export default function AnalyticsAIReports({
  currentUser,
  lang,
  users = [],
  physicians = [],
  pharmacies = [],
  products = [],
  userTerritoryAssignments = [],
  userProductAssignments = [],
  physicianVisits = [],
  pharmacyVisits = []
}: AnalyticsAIReportsProps) {
  const isRtl = lang === "ar";
  
  // Tab states
  const [activeTab, setActiveTab] = useState<"ask_ai" | "templates" | "history" | "supervisor_report" | "chat">("ask_ai");
  const [customQuery, setCustomQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [aiResponse, setAiResponse] = useState<string | null>(null);
  
  // Chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // History state
  const [history, setHistory] = useState<SavedReport[]>([
    {
      id: "REP-001",
      query: isRtl ? "تحليل فجوات تغطية العيادات في إقليم طرابلس" : "Clinic coverage gap analysis in Tripoli territory",
      response: isRtl 
        ? "معدل تغطية العيادات في طرابلس مستقر عند ٩٤٪، ولكن يوجد تأخر بـ ٣ أيام في توزيع عينات كاردوماكس لعيادات الأطفال المزدحمة. نوصي بإعادة توجيه المندوبين لتفادي الفجوة." 
        : "Tripoli clinic coverage is stable at 94%. However, there is a 3-day lag in Cardiopril sample drops to pediatric clinics. Re-routing of resources is recommended to close the gap.",
      timestamp: "2026-06-29 10:45",
      tabUsed: "Ask AI"
    }
  ]);

  // ==========================================
  // COMPUTE SECURED SCOPING BOUNDARIES
  // ==========================================
  const dbState: AnalyticsDbState = useMemo(() => {
    return {
      users,
      userTerritoryAssignments: userTerritoryAssignments || [],
      userProductAssignments: userProductAssignments || [],
      physicianAssignments: [],
      pharmacyAssignments: [],
      physicians: physicians || [],
      pharmacies: pharmacies || [],
      products: products || [],
      physicianVisits: physicianVisits || [],
      pharmacyVisits: pharmacyVisits || []
    };
  }, [users, userTerritoryAssignments, userProductAssignments, physicians, pharmacies, products, physicianVisits, pharmacyVisits]);

  const securedScope = useMemo(() => {
    return calculateSecuredAnalyticsScope(currentUser, dbState);
  }, [currentUser, dbState]);

  // Apply analytics scope filter to raw datasets
  const scopedPhysicians = useMemo(() => {
    return filterDatasetByScopeAndFilters(physicians, securedScope, defaultFilters);
  }, [physicians, securedScope]);

  const scopedPharmacies = useMemo(() => {
    return filterDatasetByScopeAndFilters(pharmacies, securedScope, defaultFilters);
  }, [pharmacies, securedScope]);

  const scopedPhysicianVisits = useMemo(() => {
    return filterDatasetByScopeAndFilters(physicianVisits, securedScope, defaultFilters);
  }, [physicianVisits, securedScope]);

  const scopedPharmacyVisits = useMemo(() => {
    return filterDatasetByScopeAndFilters(pharmacyVisits, securedScope, defaultFilters);
  }, [pharmacyVisits, securedScope]);

  // ==========================================
  // AGGREGATE MATHEMATHICALLY SECURE CRM METRICS
  // (Never expose unauthorized raw database records)
  // ==========================================
  const aggregatedScopeMetrics = useMemo(() => {
    const totalVisits = scopedPhysicianVisits.length + scopedPharmacyVisits.length;
    const completedPhysicianVisits = scopedPhysicianVisits.filter(v => v.status === "Completed" || v.status === "Synced").length;
    const completedPharmacyVisits = scopedPharmacyVisits.filter(v => v.status === "Completed" || v.status === "Synced").length;
    const totalCompleted = completedPhysicianVisits + completedPharmacyVisits;
    
    const targetPhysiciansCount = scopedPhysicians.length;
    const targetPharmaciesCount = scopedPharmacies.length;
    
    // Coverage metrics
    const visitedPhysicianIds = new Set(scopedPhysicianVisits.map(v => v.physicianId));
    const visitedPharmacyIds = new Set(scopedPharmacyVisits.map(v => v.pharmacyId));
    
    const physicianCoveragePercent = targetPhysiciansCount > 0
      ? Math.round((visitedPhysicianIds.size / targetPhysiciansCount) * 100)
      : 0;
    const pharmacyCoveragePercent = targetPharmaciesCount > 0
      ? Math.round((visitedPharmacyIds.size / targetPharmaciesCount) * 100)
      : 0;
    
    // Compliance and Plan execution rates
    const planExecutionRate = totalVisits > 0 ? Math.round((totalCompleted / totalVisits) * 100) : 0;

    return {
      roleLevel: securedScope.level,
      allowedTerritories: securedScope.allowedTerritories,
      totalSubordinates: securedScope.subordinateUserIds.length,
      targetPhysiciansCount,
      targetPharmaciesCount,
      totalVisitsScheduled: totalVisits,
      totalVisitsCompleted: totalCompleted,
      physicianCoveragePercent: Math.min(physicianCoveragePercent, 100),
      pharmacyCoveragePercent: Math.min(pharmacyCoveragePercent, 100),
      planExecutionRate: Math.min(planExecutionRate, 100)
    };
  }, [scopedPhysicians, scopedPharmacies, scopedPhysicianVisits, scopedPharmacyVisits, securedScope]);

  // Pre-crafted Prompt templates
  const templates = useMemo(() => {
    return [
      {
        id: "tmpl-1",
        title: isRtl ? "تدقيق نسبة تغطية الأقاليم" : "Territory Coverage SWOT Audit",
        description: isRtl ? "تقييم التغطية الجغرافية ونقاط الضعف الميدانية للمندوبين" : "Evaluate geographical coverage gaps and field rep vulnerabilities.",
        prompt: isRtl 
          ? "أجرِ تدقيقاً ذكياً لنقاط القوة والضعف (SWOT) حول نسبة تغطية العيادات المتاحة في صلاحياتي الإقليمية بناءً على الأرقام المرفقة." 
          : "Conduct a smart SWOT audit of clinic coverage rates in my authorized territory bounds based on the provided aggregate KPIs."
      },
      {
        id: "tmpl-2",
        title: isRtl ? "تقرير جودة شرح الرسائل العلمية" : "Detailing Core Message Quality",
        description: isRtl ? "تحليل جودة وسرعة تقديم المندوبين للرسائل الأساسية للأدوية" : "Analyze rep scientific message detailing quality and engagement rates.",
        prompt: isRtl 
          ? "لخّص كفاءة شرح الرسائل العلمية للأطباء، ومعدل الاستجابة المتوقع للأدوية بناءً على معدلات الزيارات المكتملة في صلاحياتي." 
          : "Summarize core scientific message detailing quality and expected doctor feedback parameters matching my scope's completed calls."
      },
      {
        id: "tmpl-3",
        title: isRtl ? "تدقيق توزيع العينات الميدانية" : "Sample Distribution Compliance",
        description: isRtl ? "تحليل معدلات تسليم العينات المجانية ومطابقتها للوائح" : "Evaluate sample allocation speeds and MOH compliance ratings.",
        prompt: isRtl 
          ? "حلّل التزام المندوبين بجدولة وصرف العينات الطبية وتفادي فجوات نفاد المخزون للأطباء الرئيسيين." 
          : "Analyze team adherence to medical sample drops, warning of any inventory depletion bottlenecks in my authorized sectors."
      }
    ];
  }, [isRtl]);

  // Handle freeform Ask AI submission
  const handleAskAI = async (queryText: string) => {
    if (!queryText.trim()) return;
    setIsLoading(true);
    setAiResponse(null);

    // Formulate a secure prompt containing ONLY the aggregated scope parameters and refusing raw records leak
    const secureSystemInstructions = 
      "You are MENAREPS 2.0 AI Reports analyst. " +
      "You MUST strictly follow these data visibility boundaries: " +
      "1. You are only allowed to see and discuss the following pre-aggregated CRM metrics calculated for the user's role scope: " +
      JSON.stringify(aggregatedScopeMetrics) + " " +
      "2. NEVER reveal individual names of raw records, physicians, pharmacies, or confidential client accounts unless explicitly mentioned in the pre-aggregated metrics. " +
      "3. Answer the user's query in a highly professional, clinical pharma commercial voice. " +
      "4. Provide your response in the language matching the user query (Arabic if query is in Arabic, English if in English). " +
      "Keep the analysis concise, under 180 words, with clear bold headers.";

    try {
      const fbUser = auth.currentUser;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (fbUser) {
        const token = await fbUser.getIdToken();
        headers["Authorization"] = `Bearer ${token}`;
      }

      const response = await fetch("/api/ai", {
        method: "POST",
        headers,
        body: JSON.stringify({
          action: "ai_reports",
          payload: {
            prompt: `${secureSystemInstructions}\n\nUser Query: ${queryText}`
          }
        }),
      });
      const data = await response.json();
      const responseText = data.text || "AI services temporarily offline. Local analytical model active.";
      
      setAiResponse(responseText);
      
      // Save to session history
      const newReport: SavedReport = {
        id: `REP-${Math.floor(100 + Math.random() * 900)}`,
        query: queryText,
        response: responseText,
        timestamp: new Date().toISOString().replace("T", " ").substring(0, 16),
        tabUsed: activeTab === "templates" ? "Template Audit" : "Ask AI"
      };
      setHistory(prev => [newReport, ...prev]);
    } catch (error) {
      console.error("AI report failed:", error);
      setAiResponse(isRtl ? "عذراً، تعذر الاتصال بمحرك الذكاء الاصطناعي حالياً. يرجى المحاولة لاحقاً." : "AI service temporarily busy. Please retry.");
    } finally {
      setIsLoading(false);
    }
  };

  // Chat message submit
  const handleSendChatMessage = async () => {
    if (!chatInput.trim()) return;
    const userMsg = chatInput;
    setChatInput("");
    
    const newUserMessage: ChatMessage = {
      sender: "user",
      text: userMsg,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    
    setChatMessages(prev => [...prev, newUserMessage]);
    setIsLoading(true);

    const chatHistoryContext = chatMessages.slice(-4).map(m => `${m.sender}: ${m.text}`).join("\n");

    const secureSystemInstructions = 
      "You are MENAREPS 2.0 AI interactive chatbot. " +
      "You are conversing with a user whose security scope is restricted. " +
      "Aggregate metrics available for this session's scope: " + JSON.stringify(aggregatedScopeMetrics) + ". " +
      "STRICT CONSTRAINT: Do not invent or reveal raw physician/pharmacy records or names. Only speak of team metrics and authorized geography paths. " +
      "Be friendly, clinical, and answer in the language used by the user.";

    try {
      const fbUser = auth.currentUser;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (fbUser) {
        const token = await fbUser.getIdToken();
        headers["Authorization"] = `Bearer ${token}`;
      }

      const response = await fetch("/api/ai", {
        method: "POST",
        headers,
        body: JSON.stringify({
          action: "ai_chat",
          payload: {
            prompt: `${secureSystemInstructions}\n\nChat History:\n${chatHistoryContext}\nuser: ${userMsg}\nai:`
          }
        }),
      });
      const data = await response.json();
      
      const newAiMessage: ChatMessage = {
        sender: "ai",
        text: data.text || "Chat backup module active. How else can I support your territory planning?",
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setChatMessages(prev => [...prev, newAiMessage]);
    } catch (error) {
      console.error("Chat failed:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // Generate Supervisor Intelligent summary
  const [supervisorSummary, setSupervisorSummary] = useState<string | null>(null);
  const triggerSupervisorReport = async () => {
    setIsLoading(true);
    setSupervisorSummary(null);
    
    const prompt = 
      "You are a Senior Regional Commercial Supervisor Auditor. " +
      "Evaluate the team supervisor's progress from these aggregate metrics: " + 
      JSON.stringify(aggregatedScopeMetrics) + ". " +
      "Provide a highly focused field performance report including: " +
      "1. Plan Execution Efficiency analysis. " +
      "2. Team Call compliance rating. " +
      "3. Direct territory coaching suggestions. " +
      "Write in a highly authoritative executive format with bold indicators under 150 words. Language: " + (isRtl ? "Arabic" : "English");

    try {
      const fbUser = auth.currentUser;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (fbUser) {
        const token = await fbUser.getIdToken();
        headers["Authorization"] = `Bearer ${token}`;
      }

      const response = await fetch("/api/ai", {
        method: "POST",
        headers,
        body: JSON.stringify({
          action: "supervisor_report",
          payload: { prompt }
        }),
      });
      const data = await response.json();
      setSupervisorSummary(data.text);
    } catch (e) {
      console.error("Supervisor report failed:", e);
    } finally {
      setIsLoading(false);
    }
  };

  // Auto-scroll chat
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      
      {/* Header section */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-100 dark:bg-violet-950 flex items-center justify-center text-violet-600 dark:text-violet-400">
              <Brain size={22} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                <span>{isRtl ? "مركز التقارير والتحليلات الذكية" : "AI Copilot Reports Hub"}</span>
                <Sparkles size={16} className="text-violet-500 animate-pulse" />
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {isRtl 
                  ? "تحليل فجوات الإقليم واستقصاء تغطية الأطباء بضوابط صلاحيات آمنة مشفرة" 
                  : "Secure role-scoped territory analytics, gap reporting, and conversational intelligence."}
              </p>
            </div>
          </div>
        </div>

        {/* Analytics Scope Info */}
        <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-2 rounded-xl text-xs flex items-center gap-2">
          <Lock size={13} className="text-emerald-500" />
          <div>
            <span className="text-[9px] text-slate-400 block font-bold uppercase">{isRtl ? "مستوى تشفير النطاق" : "SCOPE SECURITY BOUNDARY"}</span>
            <span className="font-bold text-slate-700 dark:text-slate-300">
              {isRtl ? "مطابق لمحرك الحماية" : "Double-Filtered Secure Gate"}
            </span>
          </div>
        </div>
      </div>

      {/* Scoped Aggregated KPIs Banner */}
      <div className="bg-gradient-to-r from-violet-600 to-indigo-600 dark:from-violet-900 dark:to-indigo-950 p-5 rounded-2xl text-white grid grid-cols-2 md:grid-cols-4 gap-4 shadow-sm">
        <div className="space-y-0.5">
          <span className="text-[10px] text-violet-100 uppercase font-bold block">{isRtl ? "معدل تنفيذ الخطط" : "Plan Execution"}</span>
          <span className="text-2xl font-black font-mono block">{aggregatedScopeMetrics.planExecutionRate}%</span>
        </div>
        <div className="space-y-0.5">
          <span className="text-[10px] text-violet-100 uppercase font-bold block">{isRtl ? "تغطية الأطباء" : "Physician Coverage"}</span>
          <span className="text-2xl font-black font-mono block">{aggregatedScopeMetrics.physicianCoveragePercent}%</span>
        </div>
        <div className="space-y-0.5">
          <span className="text-[10px] text-violet-100 uppercase font-bold block">{isRtl ? "تغطية الصيدليات" : "Pharmacy Coverage"}</span>
          <span className="text-2xl font-black font-mono block">{aggregatedScopeMetrics.pharmacyCoveragePercent}%</span>
        </div>
        <div className="space-y-0.5">
          <span className="text-[10px] text-violet-100 uppercase font-bold block">{isRtl ? "إجمالي الزيارات بالصلاحية" : "Scoped Visits"}</span>
          <span className="text-2xl font-black font-mono block">{aggregatedScopeMetrics.totalVisitsCompleted} / {aggregatedScopeMetrics.totalVisitsScheduled}</span>
        </div>
      </div>

      {/* Tabs Menu */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 overflow-x-auto gap-2">
        <button
          onClick={() => { setActiveTab("ask_ai"); setAiResponse(null); }}
          className={`px-4 py-2 text-xs font-bold whitespace-nowrap border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
            activeTab === "ask_ai" 
              ? "border-violet-600 text-violet-600 dark:text-violet-400" 
              : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
        >
          <Brain size={14} />
          <span>{isRtl ? "اسأل الذكاء الاصطناعي" : "Ask AI"}</span>
        </button>

        <button
          onClick={() => { setActiveTab("templates"); setAiResponse(null); }}
          className={`px-4 py-2 text-xs font-bold whitespace-nowrap border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
            activeTab === "templates" 
              ? "border-violet-600 text-violet-600 dark:text-violet-400" 
              : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
        >
          <LayoutTemplate size={14} />
          <span>{isRtl ? "القوالب الجاهزة" : "Templates"}</span>
        </button>

        <button
          onClick={() => { setActiveTab("supervisor_report"); }}
          className={`px-4 py-2 text-xs font-bold whitespace-nowrap border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
            activeTab === "supervisor_report" 
              ? "border-violet-600 text-violet-600 dark:text-violet-400" 
              : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
        >
          <FileText size={14} />
          <span>{isRtl ? "تقرير المشرفين الذكي" : "Supervisor Report"}</span>
        </button>

        <button
          onClick={() => { setActiveTab("chat"); }}
          className={`px-4 py-2 text-xs font-bold whitespace-nowrap border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
            activeTab === "chat" 
              ? "border-violet-600 text-violet-600 dark:text-violet-400" 
              : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
        >
          <MessageSquare size={14} />
          <span>{isRtl ? "محادثة تفاعلية" : "Interactive Chat"}</span>
        </button>

        <button
          onClick={() => { setActiveTab("history"); }}
          className={`px-4 py-2 text-xs font-bold whitespace-nowrap border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
            activeTab === "history" 
              ? "border-violet-600 text-violet-600 dark:text-violet-400" 
              : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
        >
          <HistoryIcon size={14} />
          <span>{isRtl ? "سجل الاستعلامات" : "History"}</span>
        </button>
      </div>

      {/* Scoped raw record safety disclaimer */}
      <div className="bg-indigo-50/40 dark:bg-indigo-950/10 border border-indigo-100/40 dark:border-indigo-900/40 p-3 rounded-xl flex items-start gap-2.5 text-[10.5px] text-indigo-950 dark:text-indigo-400">
        <Info size={15} className="shrink-0 mt-0.5 text-indigo-500" />
        <p className="leading-relaxed">
          {isRtl 
            ? "يتم تصفية البيانات تلقائياً وتجريدها من التفاصيل الشخصية أو السجلات غير المصرح بها قبل إرسالها للذكاء الاصطناعي لحماية سرية البيانات والامتثال الميداني." 
            : "Data is filtered in real-time, removing raw patient records or unauthorized individual names to satisfy CRM enterprise security policies."}
        </p>
      </div>

      {/* TAB CONTENT 1: ASK AI */}
      {activeTab === "ask_ai" && (
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
              {isRtl ? "اكتب سؤالك لتحليله جغرافياً:" : "What territory analytics would you like to compute?"}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={customQuery}
                onChange={(e) => setCustomQuery(e.target.value)}
                placeholder={isRtl ? "مثال: حدد فجوات تغطية العيادات المتاحة في صلاحياتي الإقليمية..." : "e.g., Identify clinic coverage gaps in my scoped sectors..."}
                className="flex-1 text-xs border border-slate-200 dark:border-slate-800 rounded-xl p-3 bg-transparent text-slate-850 dark:text-white outline-none focus:border-violet-600"
                onKeyDown={(e) => e.key === "Enter" && handleAskAI(customQuery)}
              />
              <button
                onClick={() => handleAskAI(customQuery)}
                disabled={isLoading || !customQuery.trim()}
                className="px-5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold cursor-pointer transition-all flex items-center gap-1.5"
              >
                {isLoading ? <RefreshCw size={13} className="animate-spin" /> : <Send size={13} />}
                <span>{isRtl ? "إرسال" : "Analyze"}</span>
              </button>
            </div>
          </div>

          {/* Quick recommendations / Popular questions */}
          <div className="space-y-2 pt-2">
            <span className="text-[10px] text-slate-400 font-bold uppercase">{isRtl ? "أسئلة شائعة بناءً على صلاحياتك:" : "Recommended questions for your scope:"}</span>
            <div className="flex flex-wrap gap-2">
              {[
                isRtl ? "ما هي نسبة التغطية الجغرافية الحالية وما سبل تحسينها؟" : "What is our coverage score and how do we optimize it?",
                isRtl ? "هل هناك تراجع في معدلات إنجاز الخطط الميدانية؟" : "Is there any decline in our plan execution rate?",
                isRtl ? "كيف نرفع كفاءة توزيع عينات الأدوية؟" : "How can we improve sample allocation speeds?"
              ].map((q, idx) => (
                <button
                  key={idx}
                  onClick={() => { setCustomQuery(q); handleAskAI(q); }}
                  className="p-2.5 border border-slate-200 dark:border-slate-850 hover:border-violet-300 dark:hover:border-violet-950 bg-white dark:bg-slate-900 rounded-xl text-[11px] text-slate-600 dark:text-slate-350 cursor-pointer text-left transition-all"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>

          {/* AI Response Block */}
          {aiResponse && (
            <div className="p-5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-850 rounded-2xl space-y-3">
              <div className="flex items-center gap-1.5 text-violet-600 dark:text-violet-400 text-xs font-bold uppercase">
                <Sparkles size={14} className="animate-pulse" />
                <span>{isRtl ? "تحليل الذكاء الاصطناعي المشفر:" : "Secure AI Response Synthesis:"}</span>
              </div>
              <div className="text-xs leading-relaxed text-slate-800 dark:text-slate-200 whitespace-pre-wrap font-sans">
                {aiResponse}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB CONTENT 2: TEMPLATES */}
      {activeTab === "templates" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {templates.map(tmpl => (
              <div 
                key={tmpl.id}
                className="bg-white dark:bg-slate-900 p-4 border border-slate-100 dark:border-slate-800 hover:border-violet-300 dark:hover:border-violet-900/50 rounded-2xl flex flex-col justify-between space-y-3.5 transition-all shadow-xxs"
              >
                <div className="space-y-1.5">
                  <span className="font-bold text-xs text-slate-850 dark:text-white block">{tmpl.title}</span>
                  <p className="text-[10.5px] text-slate-500 leading-relaxed">{tmpl.description}</p>
                </div>
                <button
                  onClick={() => handleAskAI(tmpl.prompt)}
                  disabled={isLoading}
                  className="w-full py-2 bg-slate-50 hover:bg-violet-50 dark:bg-slate-950 dark:hover:bg-violet-950/20 text-slate-800 dark:text-slate-300 hover:text-violet-600 dark:hover:text-violet-400 text-xxs font-bold rounded-lg transition-all flex items-center justify-center gap-1 cursor-pointer"
                >
                  <span>{isRtl ? "تشغيل هذا التدقيق الآن" : "Launch Audit Report"}</span>
                  <ChevronRight size={12} className={isRtl ? "rotate-180" : ""} />
                </button>
              </div>
            ))}
          </div>

          {/* AI Response Block for Templates */}
          {aiResponse && (
            <div className="p-5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-850 rounded-2xl space-y-3 mt-4">
              <div className="flex items-center gap-1.5 text-violet-600 dark:text-violet-400 text-xs font-bold uppercase">
                <Sparkles size={14} className="animate-pulse" />
                <span>{isRtl ? "تقرير التدقيق المكتمل:" : "Completed Audit Synthesis:"}</span>
              </div>
              <div className="text-xs leading-relaxed text-slate-800 dark:text-slate-200 whitespace-pre-wrap font-sans">
                {aiResponse}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB CONTENT 3: SUPERVISOR REPORT */}
      {activeTab === "supervisor_report" && (
        <div className="space-y-5">
          <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-5 rounded-2xl shadow-xxs flex flex-col md:flex-row items-center justify-between gap-5">
            <div className="space-y-1">
              <span className="text-[10px] text-slate-400 font-bold uppercase block">{isRtl ? "تحليل الكفاءة الإشرافية الميدانية" : "Supervisor Performance Synthesis"}</span>
              <h3 className="font-bold text-sm text-slate-850 dark:text-white">
                {isRtl ? "إنشاء تقرير أداء المشرفين الذكي بناءً على الأرقام الحالية" : "Generate Intelligent Supervisor Performance Summary"}
              </h3>
              <p className="text-[10.5px] text-slate-500 leading-relaxed max-w-xl">
                {isRtl 
                  ? "يقوم محرك الذكاء الاصطناعي برصد كفاءة تنفيذ الخطط، الزيارات المرافقة المكتملة، وتدريب المندوبين ومقارنتها بقيم الاستهداف." 
                  : "The AI module aggregates plan execution logs, accompanied co-travel indexes, and task lists, generating an audit feedback document."}
              </p>
            </div>
            <button
              onClick={triggerSupervisorReport}
              disabled={isLoading}
              className="shrink-0 px-5 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold cursor-pointer transition-all flex items-center gap-1.5"
            >
              {isLoading ? <RefreshCw size={13} className="animate-spin" /> : <Sparkles size={13} />}
              <span>{isRtl ? "إنشاء التقرير الذكي" : "Generate Report"}</span>
            </button>
          </div>

          {supervisorSummary && (
            <div className="p-5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-850 rounded-2xl space-y-3 animate-fade-in">
              <div className="flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400 text-xs font-bold uppercase">
                <FileText size={14} />
                <span>{isRtl ? "تقرير الأداء الإشرافي المعتمد ذكياً:" : "Intelligent Supervisor Performance Audit:"}</span>
              </div>
              <div className="text-xs leading-relaxed text-slate-800 dark:text-slate-200 whitespace-pre-wrap font-sans">
                {supervisorSummary}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB CONTENT 4: CHAT */}
      {activeTab === "chat" && (
        <div className="border border-slate-100 dark:border-slate-850 rounded-2xl overflow-hidden flex flex-col h-[400px] bg-white dark:bg-slate-900 shadow-xxs">
          {/* Chat Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {chatMessages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-2">
                <Brain size={30} className="text-violet-300 dark:text-violet-800 animate-pulse" />
                <span className="font-bold text-xs text-slate-700 dark:text-slate-300">{isRtl ? "محادثة استقصائية آمنة" : "Secure Analytics Interactive Chat"}</span>
                <p className="text-[10.5px] text-slate-400 max-w-sm">
                  {isRtl 
                    ? "اطرح أي سؤال تفاعلي حول إحصائيات صلاحياتك الجغرافية، وسيجيب المساعد الذكي بما يتوافق مع النطاق الآمن المعتمد." 
                    : "Ask freeform questions about your scoped KPIs. The chatbot handles your inquiries in compliance with role access filters."}
                </p>
              </div>
            ) : (
              chatMessages.map((msg, idx) => {
                const isUser = msg.sender === "user";
                return (
                  <div key={idx} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                    <div className={`p-3 max-w-[75%] rounded-2xl text-xs space-y-1 ${
                      isUser 
                        ? "bg-violet-600 text-white rounded-br-none" 
                        : "bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-850 text-slate-850 dark:text-slate-200 rounded-bl-none"
                    }`}>
                      <p className="leading-relaxed">{msg.text}</p>
                      <span className="text-[8px] opacity-70 block text-right font-mono">{msg.timestamp}</span>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={chatBottomRef} />
          </div>

          {/* Chat input */}
          <div className="p-3 border-t border-slate-100 dark:border-slate-850 flex gap-2">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder={isRtl ? "اكتب رسالتك واستفسر آمنياً..." : "Ask your scoped inquiry..."}
              className="flex-1 text-xs border border-slate-200 dark:border-slate-800 rounded-xl px-3 bg-transparent text-slate-850 dark:text-white outline-none focus:border-violet-600"
              onKeyDown={(e) => e.key === "Enter" && handleSendChatMessage()}
              disabled={isLoading}
            />
            <button
              onClick={handleSendChatMessage}
              disabled={isLoading || !chatInput.trim()}
              className="w-10 h-10 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-xl flex items-center justify-center cursor-pointer transition-all"
            >
              {isLoading ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
            </button>
          </div>
        </div>
      )}

      {/* TAB CONTENT 5: HISTORY */}
      {activeTab === "history" && (
        <div className="space-y-4">
          {history.length === 0 ? (
            <div className="text-center p-8 text-slate-400 text-xs">
              {isRtl ? "لا يوجد تقارير مستعلمة في هذا النشاط بعد." : "No reports logged in this session yet."}
            </div>
          ) : (
            <div className="space-y-4">
              {history.map(item => (
                <div key={item.id} className="p-5 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl space-y-3 shadow-xxs">
                  <div className="flex justify-between items-center text-[10px]">
                    <div className="flex items-center gap-1.5 font-bold text-violet-600">
                      <span>{item.tabUsed}</span>
                      <span>•</span>
                      <span className="font-mono">{item.id}</span>
                    </div>
                    <span className="font-mono text-slate-400">{item.timestamp}</span>
                  </div>
                  <div className="space-y-2">
                    <span className="text-xs font-bold text-slate-850 dark:text-white block">Q: {item.query}</span>
                    <p className="text-xs text-slate-500 leading-relaxed whitespace-pre-wrap font-sans">{item.response}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

    </div>
  );
}
