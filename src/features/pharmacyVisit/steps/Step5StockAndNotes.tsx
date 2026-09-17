import React, { useState, useMemo } from "react";
import { User, Product, UserProductAssignment } from "../../../types";
import {
  PharmacyVisitDraft,
  PharmacyStockRequestLine,
  PharmacyStockPriority,
  PharmacyStockRequestReason,
  PharmacyCompetitorBrandObservation,
  PharmacyCompetitorPriceObservation,
  PharmacyCompetitorPromotionObservation,
  PharmacyCustomerPainPoint,
  PharmacyFollowUp
} from "../types/domain";
import { PharmacyVisitAction } from "../state/pharmacyVisitReducer";
import { getEligibleStockProductsForRep } from "../services/pharmacyProductEligibility";
import { calculateShortageCandidates, generateDeterministicShortageLineId } from "../services/shortageEligibilityEngine";
import { validateStep5 } from "../validation/validateStep5";
import { formatCurrency, getCurrencyInfo } from "../utils/currency";
import {
  Package,
  TrendingUp,
  MessageSquare,
  Calendar,
  Plus,
  Trash2,
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Paperclip,
  Tag,
  CheckCircle2,
  Clock,
  UserCheck,
  Building2,
  ShieldAlert,
  Upload,
  Info
} from "lucide-react";

export function parsePositivePackQuantity(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const quantity = Number(value);
  return Number.isSafeInteger(quantity) ? quantity : null;
}

interface Step5StockAndNotesProps {
  draft: PharmacyVisitDraft;
  dispatch: React.Dispatch<PharmacyVisitAction>;
  currentUser: User;
  products?: Product[];
  userProductAssignments?: UserProductAssignment[];
  onBack: () => void;
  onNext: () => void;
  lang?: "en" | "ar";
}

export const Step5StockAndNotes: React.FC<Step5StockAndNotesProps> = ({
  draft,
  dispatch,
  currentUser,
  products = [],
  userProductAssignments = [],
  onBack,
  onNext,
  lang = "en"
}) => {
  const isRtl = lang === "ar";
  const countryCode = draft.currencyCode || draft.order?.currency || draft.pharmacySnapshot?.currencyCode;
  const currencyInfo = getCurrencyInfo(countryCode);

  // Independent Collapsible State for each section
  const [expandedSections, setExpandedSections] = useState({
    stock: true,
    competitor: true,
    crmNotes: true,
    followUp: true
  });

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  // -------------------------------------------------------------
  // 1. Stock Requests State & Handlers (WP6.4 Shortage Engine)
  // -------------------------------------------------------------
  const stockProductReport = useMemo(() => {
    return getEligibleStockProductsForRep(currentUser.id, userProductAssignments, products);
  }, [currentUser.id, userProductAssignments, products]);

  const shortageCandidates = useMemo(() => {
    return calculateShortageCandidates(draft, products);
  }, [draft, products]);

  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [requestedQty, setRequestedQty] = useState<string>("1");
  const [priority, setPriority] = useState<PharmacyStockPriority>("NORMAL");
  const [reason, setReason] = useState<PharmacyStockRequestReason>("LOW_STOCK");
  const [lineNotes, setLineNotes] = useState<string>("");

  const currentStockState = draft.stock || { noStockRequestRequired: false, requestLines: [] };

  const selectedCandidate = useMemo(() => {
    return shortageCandidates.find((c) => c.productId === selectedProductId);
  }, [shortageCandidates, selectedProductId]);

  const handleSelectProduct = (productId: string) => {
    setSelectedProductId(productId);
    const cand = shortageCandidates.find((c) => c.productId === productId);
    if (cand) {
      setRequestedQty(cand.unfulfilledQty.toString());
    } else {
      setRequestedQty("1");
    }
  };

  const handleAddStockLine = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProductId) return;

    const candidate = shortageCandidates.find((c) => c.productId === selectedProductId);
    if (!candidate) return;

    const reqNum = parsePositivePackQuantity(requestedQty);
    if (reqNum == null) return;
    const confirmedZeroStock = candidate.source === "CONFIRMED_ZERO_STOCK";

    const newLine: PharmacyStockRequestLine = {
      draftLineId: generateDeterministicShortageLineId(draft.draftId, draft.order?.lines?.[0]?.id, candidate.productId),
      canonicalProductId: candidate.productId,
      productCode: candidate.productCode,
      productNameSnapshot: candidate.productName,
      productArabicNameSnapshot: candidate.productNameAr,
      requestedQuantity: reqNum,
      approvedOrderQty: confirmedZeroStock ? 0 : candidate.fulfilledQty,
      warehouseAvailableQty: confirmedZeroStock ? 0 : candidate.warehouseAvailableQty,
      unfulfilledQty: confirmedZeroStock ? reqNum : Math.max(reqNum - candidate.fulfilledQty, 0),
      source: candidate.source || "AUTO_ORDER_SHORTAGE",
      priority,
      reason,
      notes: lineNotes.trim() || undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      userConfirmed: true,
      backendRevalidationRequired: true
    };

    dispatch({ type: "ADD_STOCK_REQUEST_LINE", payload: newLine });

    // Reset
    setSelectedProductId("");
    setRequestedQty("1");
    setLineNotes("");
  };

  const handleRemoveStockLine = (draftLineId: string) => {
    dispatch({ type: "REMOVE_STOCK_REQUEST_LINE", payload: { draftLineId } });
  };

  // -------------------------------------------------------------
  // 2. Competitive Intelligence Form State
  // -------------------------------------------------------------
  const [compName, setCompName] = useState("");
  const [compBrand, setCompBrand] = useState("");
  const [compPrice, setCompPrice] = useState("");
  const [compAvailability, setCompAvailability] = useState("AVAILABLE");
  const [compPromotion, setCompPromotion] = useState("");
  const [compShelfVisibility, setCompShelfVisibility] = useState("EYE_LEVEL");
  const [compNotes, setCompNotes] = useState("");
  const [ciAttachment, setCiAttachment] = useState<{ fileName: string; previewUrl?: string } | null>(null);

  const ciState = draft.stock?.competitiveIntelligence || {};

  const handleAddCompetitorEntry = (e: React.FormEvent) => {
    e.preventDefault();
    if (!compName.trim() && !compBrand.trim()) return;

    const brandObs: PharmacyCompetitorBrandObservation = {
      id: `ci_b_${Date.now()}`,
      brandName: compBrand || compName,
      companyName: compName,
      categoryOrProduct: compAvailability,
      notes: compNotes
    };

    dispatch({ type: "ADD_COMPETITOR_BRAND", payload: brandObs });

    if (compPrice && !isNaN(parseFloat(compPrice))) {
      const priceObs: PharmacyCompetitorPriceObservation = {
        id: `ci_p_${Date.now()}`,
        brandOrProduct: compBrand || compName,
        observedPrice: parseFloat(compPrice),
        currency: currencyInfo.code,
        observedDate: new Date().toISOString().substring(0, 10),
        notes: compNotes
      };
      dispatch({ type: "ADD_COMPETITOR_PRICE", payload: priceObs });
    }

    if (compPromotion.trim()) {
      const promoObs: PharmacyCompetitorPromotionObservation = {
        id: `ci_promo_${Date.now()}`,
        brandOrProduct: compBrand || compName,
        description: compPromotion,
        notes: compNotes
      };
      dispatch({ type: "ADD_COMPETITOR_PROMOTION", payload: promoObs });
    }

    // Reset
    setCompName("");
    setCompBrand("");
    setCompPrice("");
    setCompPromotion("");
    setCompNotes("");
    setCiAttachment(null);
  };

  const handleCiFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setCiAttachment({
        fileName: file.name,
        previewUrl: file.type.startsWith("image/") ? (ev.target?.result as string) : undefined
      });
    };
    reader.readAsDataURL(file);
  };

  // -------------------------------------------------------------
  // 3. CRM Notes State
  // -------------------------------------------------------------
  const currentGeneralNotes = draft.stock?.crmNotes?.generalNotes || "";

  const handleNotesChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    if (text.length <= 1000) {
      dispatch({ type: "SET_GENERAL_NOTES", payload: text });
    }
  };

  const handleInsertTag = (tagText: string) => {
    const newText = currentGeneralNotes
      ? `${currentGeneralNotes} [#${tagText}]`
      : `[#${tagText}]`;
    if (newText.length <= 1000) {
      dispatch({ type: "SET_GENERAL_NOTES", payload: newText });
    }
  };

  // -------------------------------------------------------------
  // 4. Follow-up Tasks State
  // -------------------------------------------------------------
  const followUpState = draft.stock?.followUp || {
    required: false,
    taskPersistencePending: true
  };

  const handleToggleFollowUp = (req: boolean) => {
    if (!req) {
      dispatch({ type: "CLEAR_FOLLOW_UP" });
    } else {
      const tomorrow = new Date(Date.now() + 86400000).toISOString().substring(0, 10);
      const newFollowUp: PharmacyFollowUp = {
        required: true,
        followUpDate: tomorrow,
        priority: "NORMAL",
        ownerUid: currentUser.id,
        notes: "",
        taskPersistencePending: true
      };
      dispatch({ type: "SET_FOLLOW_UP", payload: newFollowUp });
    }
  };

  const handleFollowUpFieldChange = (field: keyof PharmacyFollowUp, val: any) => {
    const updated = {
      ...followUpState,
      required: true,
      [field]: val
    };
    dispatch({ type: "SET_FOLLOW_UP", payload: updated });
  };

  // Step 5 Proceed Handler
  const handleProceed = () => {
    const res = validateStep5(draft);
    if (!res.isValid) {
      alert(`Step 5 validation error:\n${res.errors.join("\n")}`);
      return;
    }
    dispatch({ type: "COMPLETE_STEP_5" });
    onNext();
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      {/* Step Header */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
              Step 5 of 6
            </span>
            <span className="text-xs text-slate-500 font-medium">Stock, Intelligence, CRM & Tasks</span>
          </div>
          <h2 className="text-xl font-bold text-slate-900 mt-1">
            Commercial Visit Execution & Intelligence
          </h2>
          <p className="text-sm text-slate-500">
            Expand and complete any relevant field sections. All sections are optional.
          </p>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* SECTION 1: ▼ Unfulfilled Product Demand / Stock Shortage */}
      {/* ========================================================================= */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <button
          type="button"
          onClick={() => toggleSection("stock")}
          className="w-full p-5 bg-slate-50/80 hover:bg-slate-100/80 transition-colors flex items-center justify-between text-left border-b border-slate-200"
        >
          <div className="flex items-center gap-3">
            <Package className="w-5 h-5 text-indigo-600 shrink-0" />
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-900">
                  {expandedSections.stock
                    ? isRtl ? "▼ الطلب غير الملبى للمنتجات / نقص المخزون" : "▼ Unfulfilled Product Demand / Stock Shortage"
                    : isRtl ? "► الطلب غير الملبى للمنتجات / نقص المخزون" : "► Unfulfilled Product Demand / Stock Shortage"}
                </h3>
                {currentStockState.requestLines.length > 0 && (
                  <span className="px-2 py-0.5 bg-indigo-100 text-indigo-800 text-[11px] font-bold rounded-md">
                    {currentStockState.requestLines.length} item(s) logged
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500">
                {isRtl
                  ? "تسجيل الطلب غير الملبى للمنتجات ونقص المخزون في الصيدلية مع حساب الكمية غير الملباة تلقائياً."
                  : "Record unfulfilled demand caused by warehouse stock shortage or allocation limits."}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-slate-500">
            <span className="text-xs font-medium">{expandedSections.stock ? "Collapse" : "Expand"}</span>
            {expandedSections.stock ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
          </div>
        </button>

        {expandedSections.stock && (
          <div className="p-6 space-y-6">
            {/* Non-blocking warehouse inventory notice (WP6.4 Section 4 & 6) */}
            <div className="p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 rounded-xl text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2">
              <Info className="w-4 h-4 text-amber-500 shrink-0" />
              <span>
                {isRtl
                  ? "مخزون المستودع غير متاح — احتساب العجز قيد مراجعة عمليات الطلبات."
                  : "Warehouse inventory unavailable — shortage calculation pending Order Operations review."}
              </span>
            </div>

            {/* Form to Add Stock Line */}
            <form onSubmit={handleAddStockLine} className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-4">
              <h4 className="text-xs font-bold uppercase text-slate-700 flex items-center gap-1.5">
                <Plus className="w-3.5 h-3.5 text-indigo-600" />
                Add Shortage / Demand Line
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">Select Shortage Product</label>
                  <select
                    value={selectedProductId}
                    onChange={(e) => handleSelectProduct(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                  >
                    {shortageCandidates.length === 0 ? (
                      <option value="" disabled>
                        {isRtl
                          ? "لا يوجد طلب غير ملبى للمنتجات لهذه الزيارة."
                          : "No unfulfilled Product demand for this Visit."}
                      </option>
                    ) : (
                      <>
                        <option value="">{isRtl ? "-- اختر منتج فيه عجز --" : "-- Select Shortage Product --"}</option>
                        {shortageCandidates.map((cand) => (
                          <option key={cand.productId} value={cand.productId}>
                            {cand.productName} ({isRtl ? "المطلوب: " : "Req: "} {cand.requestedQty}, {isRtl ? "المستلم: " : "Fulfilled: "} {cand.fulfilledQty}, {isRtl ? "العجز: " : "Unfulfilled: "} {cand.unfulfilledQty})
                          </option>
                        ))}
                      </>
                    )}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Requested Pack Quantity
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    inputMode="numeric"
                    value={requestedQty}
                    onChange={(e) => setRequestedQty(e.target.value)}
                    disabled={!selectedCandidate}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-100"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Priority</label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as PharmacyStockPriority)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="NORMAL">Normal</option>
                    <option value="URGENT">Urgent</option>
                    <option value="CRITICAL">Critical</option>
                  </select>
                </div>
              </div>

              {/* Selected Shortage Candidate Metrics Banner */}
              {selectedCandidate && (
                <div className="p-3 bg-indigo-50/80 border border-indigo-200 rounded-lg text-xs grid grid-cols-2 sm:grid-cols-5 gap-2 text-indigo-950">
                  <div>
                    <span className="text-indigo-600 font-semibold block">Requested Qty:</span>
                    <span className="font-bold">{selectedCandidate.requestedQty}</span>
                  </div>
                  <div>
                    <span className="text-indigo-600 font-semibold block">Qty in Order:</span>
                    <span className="font-bold">{selectedCandidate.fulfilledQty}</span>
                  </div>
                  <div>
                    <span className="text-indigo-600 font-semibold block">Warehouse Avail:</span>
                    <span className="font-bold">{selectedCandidate.warehouseAvailableQty ?? "N/A"}</span>
                  </div>
                  <div>
                    <span className="text-indigo-600 font-semibold block">Approved Allocation:</span>
                    <span className="font-bold">{selectedCandidate.approvedAllocationQty ?? "N/A"}</span>
                  </div>
                  <div>
                    <span className="text-indigo-600 font-semibold block">Unfulfilled Qty:</span>
                    <span className="font-bold text-amber-700">{selectedCandidate.unfulfilledQty}</span>
                  </div>
                </div>
              )}

              {shortageCandidates.length === 0 && (
                <div className="p-3 bg-slate-100 rounded-lg text-xs text-slate-600 flex items-center gap-2">
                  <Info className="w-4 h-4 text-slate-400 shrink-0" />
                  <span>
                    {isRtl
                      ? "لا يوجد طلب غير ملبى للمنتجات لهذه الزيارة."
                      : "No unfulfilled Product demand for this Visit."}
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                <input
                  type="text"
                  placeholder="Reason / notes (e.g., warehouse allocation cap, expected demand peak)..."
                  value={lineNotes}
                  onChange={(e) => setLineNotes(e.target.value)}
                  className="w-2/3 px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
                />
                <button
                  type="submit"
                  disabled={!selectedProductId}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Shortage Line
                </button>
              </div>
            </form>

            {/* List of Added Stock Lines */}
            {currentStockState.requestLines.length > 0 ? (
              <div className="space-y-2">
                <h4 className="text-xs font-bold uppercase text-slate-500">Unfulfilled Demand & Shortage Analysis</h4>
                <div className="border border-slate-200 rounded-xl overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse min-w-[700px]">
                    <thead className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-700 uppercase text-[10px]">
                      <tr>
                        <th className="p-2.5">Product</th>
                        <th className="p-2.5 text-center">Pharmacy Requested</th>
                        <th className="p-2.5 text-center">Qty in Order</th>
                        <th className="p-2.5 text-center">Warehouse Avail.</th>
                        <th className="p-2.5 text-center">Approved Alloc.</th>
                        <th className="p-2.5 text-center">Unfulfilled Qty</th>
                        <th className="p-2.5">Source</th>
                        <th className="p-2.5">Reason</th>
                        <th className="p-2.5">Priority</th>
                        <th className="p-2.5">Status</th>
                        <th className="p-2.5 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {currentStockState.requestLines.map((line) => {
                        const matchedOrderLine = draft.order?.lines.find(
                          (ol) => ol.canonicalProductId === line.canonicalProductId
                        );
                        const qtyInOrder = matchedOrderLine ? matchedOrderLine.quantity : 0;
                        const whAvail = line.warehouseAvailableQty != null ? line.warehouseAvailableQty : "N/A";
                        const approvedAlloc = line.approvedOrderQty ?? qtyInOrder;
                        const unfulfilled = line.unfulfilledQty ?? Math.max(0, line.requestedQuantity - approvedAlloc);
                        const sourceLabel = line.source || (qtyInOrder < line.requestedQuantity ? "AUTO_ORDER_SHORTAGE" : "REP_OBSERVED_DEMAND");
                        const statusLabel = line.status || "PENDING_INVENTORY_VALIDATION";

                        return (
                          <tr key={line.draftLineId} className="hover:bg-slate-50/50">
                            <td className="p-2.5 font-bold text-slate-900">{line.productNameSnapshot}</td>
                            <td className="p-2.5 text-center font-mono font-bold text-slate-800">{line.requestedQuantity}</td>
                            <td className="p-2.5 text-center font-mono text-indigo-600">{qtyInOrder}</td>
                            <td className="p-2.5 text-center font-mono text-slate-500">{whAvail}</td>
                            <td className="p-2.5 text-center font-mono text-emerald-600 font-bold">{approvedAlloc}</td>
                            <td className="p-2.5 text-center font-mono font-bold text-rose-600">{unfulfilled}</td>
                            <td className="p-2.5 font-mono text-[10px] text-slate-600">{sourceLabel}</td>
                            <td className="p-2.5 text-slate-500 truncate max-w-[120px]" title={line.notes || String(line.reason)}>
                              {line.notes || String(line.reason)}
                            </td>
                            <td className="p-2.5">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                line.priority === "URGENT" || line.priority === "CRITICAL"
                                  ? "bg-rose-100 text-rose-800"
                                  : "bg-slate-100 text-slate-700"
                              }`}>
                                {line.priority}
                              </span>
                            </td>
                            <td className="p-2.5">
                              <span className="px-2 py-0.5 bg-amber-50 text-amber-800 border border-amber-200 rounded text-[10px] font-medium">
                                {statusLabel}
                              </span>
                            </td>
                            <td className="p-2.5 text-right">
                              <button
                                type="button"
                                onClick={() => handleRemoveStockLine(line.draftLineId)}
                                className="p-1 text-slate-400 hover:text-rose-600 rounded transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-400 italic">No unfulfilled demand or stock shortage lines recorded yet.</p>
            )}
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* SECTION 2: ▼ Competitive Intelligence */}
      {/* ========================================================================= */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <button
          type="button"
          onClick={() => toggleSection("competitor")}
          className="w-full p-5 bg-slate-50/80 hover:bg-slate-100/80 transition-colors flex items-center justify-between text-left border-b border-slate-200"
        >
          <div className="flex items-center gap-3">
            <TrendingUp className="w-5 h-5 text-indigo-600 shrink-0" />
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-900">
                  {expandedSections.competitor ? "▼ Competitive Intelligence" : "► Competitive Intelligence"}
                </h3>
                {((ciState.competitorBrands?.length || 0) + (ciState.competitorPricing?.length || 0)) > 0 && (
                  <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[11px] font-bold rounded-md">
                    Logged
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500">
                Record competitor brand activity, pricing, availability, promotions, and shelf visibility.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-slate-500">
            <span className="text-xs font-medium">{expandedSections.competitor ? "Collapse" : "Expand"}</span>
            {expandedSections.competitor ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
          </div>
        </button>

        {expandedSections.competitor && (
          <div className="p-6 space-y-6">
            <form onSubmit={handleAddCompetitorEntry} className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-4">
              <h4 className="text-xs font-bold uppercase text-slate-700 flex items-center gap-1.5">
                <Plus className="w-3.5 h-3.5 text-indigo-600" />
                Record Competitor Observation
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Competitor / Company</label>
                  <input
                    type="text"
                    placeholder="e.g. Novartis / Pfizer"
                    value={compName}
                    onChange={(e) => setCompName(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">Brand Name</label>
                  <input
                    type="text"
                    placeholder="e.g. Augmentin / Voltaren"
                    value={compBrand}
                    onChange={(e) => setCompBrand(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">Observed Price ({currencyInfo.symbol})</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={compPrice}
                    onChange={(e) => setCompPrice(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">Availability</label>
                  <select
                    value={compAvailability}
                    onChange={(e) => setCompAvailability(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  >
                    <option value="AVAILABLE">In Stock & High Volume</option>
                    <option value="LIMITED">Limited Stock</option>
                    <option value="OUT_OF_STOCK">Out of Stock</option>
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">Promotion / Scheme</label>
                  <input
                    type="text"
                    placeholder="e.g. 10+2 Bonus offer"
                    value={compPromotion}
                    onChange={(e) => setCompPromotion(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">Shelf Visibility</label>
                  <select
                    value={compShelfVisibility}
                    onChange={(e) => setCompShelfVisibility(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  >
                    <option value="EYE_LEVEL">Prime Eye Level</option>
                    <option value="TOP_SHELF">Top Shelf</option>
                    <option value="LOWER_SHELF">Lower Shelf</option>
                    <option value="COUNTER_DISPLAY">Counter Stand Display</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Free Notes</label>
                  <input
                    type="text"
                    placeholder="Additional details regarding competitor strategy..."
                    value={compNotes}
                    onChange={(e) => setCompNotes(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                  />
                </div>

                <div className="flex items-center justify-between gap-2">
                  <label className="cursor-pointer px-3 py-2 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg text-xs font-medium text-slate-700 flex items-center gap-1.5">
                    <Upload className="w-3.5 h-3.5 text-indigo-600" />
                    {ciAttachment ? ciAttachment.fileName : "Photo Attachment"}
                    <input type="file" accept="image/*" onChange={handleCiFileUpload} className="hidden" />
                  </label>

                  <button
                    type="submit"
                    disabled={!compName.trim() && !compBrand.trim()}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Intelligence
                  </button>
                </div>
              </div>
            </form>

            {/* List of Competitive Intelligence Items */}
            {ciState.competitorBrands && ciState.competitorBrands.length > 0 ? (
              <div className="space-y-2">
                <h4 className="text-xs font-bold uppercase text-slate-500">Logged Competitor Activity</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {ciState.competitorBrands.map((b) => (
                    <div key={b.id} className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs space-y-1">
                      <p className="font-bold text-slate-900">{b.brandName} <span className="text-slate-500 font-normal">({b.companyName})</span></p>
                      <p className="text-[11px] text-slate-600">Status: {b.categoryOrProduct}</p>
                      {b.notes && <p className="text-[11px] text-slate-500 italic">{b.notes}</p>}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-400 italic">No competitor observations logged yet.</p>
            )}
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* SECTION 3: ▼ CRM Notes */}
      {/* ========================================================================= */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <button
          type="button"
          onClick={() => toggleSection("crmNotes")}
          className="w-full p-5 bg-slate-50/80 hover:bg-slate-100/80 transition-colors flex items-center justify-between text-left border-b border-slate-200"
        >
          <div className="flex items-center gap-3">
            <MessageSquare className="w-5 h-5 text-indigo-600 shrink-0" />
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-900">
                  {expandedSections.crmNotes ? "▼ CRM Notes" : "► CRM Notes"}
                </h3>
                {currentGeneralNotes && (
                  <span className="px-2 py-0.5 bg-indigo-100 text-indigo-800 text-[11px] font-bold rounded-md">
                    {currentGeneralNotes.length}/1000 chars
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500">
                Simple text editor for visit summary notes, customer requests, and product feedback.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-slate-500">
            <span className="text-xs font-medium">{expandedSections.crmNotes ? "Collapse" : "Expand"}</span>
            {expandedSections.crmNotes ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
          </div>
        </button>

        {expandedSections.crmNotes && (
          <div className="p-6 space-y-4">
            {/* Quick Mention Tags */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-slate-500 flex items-center gap-1">
                <Tag className="w-3.5 h-3.5 text-indigo-600" /> Mention / Tag:
              </span>
              {[
                "Product Inquiry",
                "Customer Request",
                "Stock Availability",
                "Pricing Feedback",
                "Competitor Pressure",
                "Delivery Timelines"
              ].map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => handleInsertTag(tag)}
                  className="px-2.5 py-1 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 text-slate-700 rounded-md text-xs font-medium transition-colors border border-slate-200"
                >
                  +#{tag}
                </button>
              ))}
            </div>

            {/* Editor Area */}
            <div className="space-y-1">
              <textarea
                rows={4}
                maxLength={1000}
                value={currentGeneralNotes}
                onChange={handleNotesChange}
                placeholder="Enter detailed visit feedback, pharmacist discussion points, or specific requests..."
                className="w-full p-3 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500"
              />
              <div className="flex justify-end text-[11px] text-slate-400 font-mono">
                {currentGeneralNotes.length} / 1000 characters
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* SECTION 4: ▼ Follow-up Tasks */}
      {/* ========================================================================= */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <button
          type="button"
          onClick={() => toggleSection("followUp")}
          className="w-full p-5 bg-slate-50/80 hover:bg-slate-100/80 transition-colors flex items-center justify-between text-left border-b border-slate-200"
        >
          <div className="flex items-center gap-3">
            <Calendar className="w-5 h-5 text-indigo-600 shrink-0" />
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-900">
                  {expandedSections.followUp ? "▼ Follow-up Tasks" : "► Follow-up Tasks"}
                </h3>
                {followUpState.required && (
                  <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[11px] font-bold rounded-md">
                    Scheduled: {followUpState.followUpDate}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500">
                Schedule a follow-up task or reminder for future action.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-slate-500">
            <span className="text-xs font-medium">{expandedSections.followUp ? "Collapse" : "Expand"}</span>
            {expandedSections.followUp ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
          </div>
        </button>

        {expandedSections.followUp && (
          <div className="p-6 space-y-4">
            <div className="flex items-center gap-3">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={followUpState.required}
                  onChange={(e) => handleToggleFollowUp(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
              </label>
              <span className="text-xs font-bold text-slate-900">Schedule Follow-up Task for this Pharmacy</span>
            </div>

            {followUpState.required && (
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-4 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Due Date</label>
                    <input
                      type="date"
                      value={followUpState.followUpDate || ""}
                      onChange={(e) => handleFollowUpFieldChange("followUpDate", e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                    />
                  </div>

                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Priority</label>
                    <select
                      value={followUpState.priority || "NORMAL"}
                      onChange={(e) => handleFollowUpFieldChange("priority", e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                    >
                      <option value="NORMAL">Normal</option>
                      <option value="URGENT">Urgent</option>
                    </select>
                  </div>

                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Assigned To</label>
                    <input
                      type="text"
                      disabled
                      value={`${currentUser.name} (Self)`}
                      className="w-full px-3 py-2 border border-slate-200 bg-slate-100 rounded-lg font-medium text-slate-600"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">Task Description / Purpose</label>
                  <input
                    type="text"
                    placeholder="Describe follow-up objective (e.g. deliver sample pack, collect cheque)..."
                    value={followUpState.notes || ""}
                    onChange={(e) => handleFollowUpFieldChange("notes", e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Navigation Buttons */}
      <div className="flex items-center justify-between pt-4 border-t border-slate-200">
        <button
          type="button"
          onClick={onBack}
          className="px-5 py-2.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-semibold rounded-lg text-sm transition-colors flex items-center gap-2 shadow-xs"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Step 4 (Payment)
        </button>

        <button
          type="button"
          onClick={handleProceed}
          className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg text-sm transition-colors flex items-center gap-2 shadow-md hover:shadow-lg"
        >
          Proceed to Step 6 (Complete Visit)
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
