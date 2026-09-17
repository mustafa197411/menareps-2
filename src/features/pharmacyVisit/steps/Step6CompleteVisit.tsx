import React, { useState, useEffect } from "react";
import { getVisitBusinessNumber } from "../../../utils/visitNumberUtils";
import { User } from "../../../types";
import { PharmacyVisitDraft } from "../types/domain";
import { PharmacyVisitAction } from "../state/pharmacyVisitReducer";
import { PharmacyVisitDraftService } from "../services/pharmacyVisitDraftService";
import { formatCurrency, getCurrencyInfo } from "../utils/currency";
import { VISIT_COLLECTION_UNAVAILABLE_MESSAGE } from "../validation/validateStep4";
import { validateStep6 } from "../validation/validateStep6";
import { completePharmacyVisitV2 } from "../services/completePharmacyVisitV2";
import {
  CheckCircle2,
  Save,
  AlertTriangle,
  ArrowLeft,
  FileText,
  Building2,
  Receipt,
  Package,
  TrendingUp,
  MessageSquare,
  Calendar,
  MapPin,
  Paperclip,
  Store,
  Clock,
  ShieldCheck,
  UserCheck,
  Tag,
  Gift,
  DollarSign,
  AlertCircle,
  X,
  Sparkles,
  Camera
} from "lucide-react";

interface Step6CompleteVisitProps {
  draft: PharmacyVisitDraft;
  dispatch: React.Dispatch<PharmacyVisitAction>;
  currentUser: User;
  onBack: () => void;
  onNavigate?: (view: string, params?: any) => void;
  lang?: "en" | "ar";
}

export const Step6CompleteVisit: React.FC<Step6CompleteVisitProps> = ({
  draft,
  dispatch,
  currentUser,
  onBack,
  onNavigate,
  lang = "en"
}) => {
  const isRtl = lang === "ar";
  const countryCode = draft.currencyCode || draft.order?.currency || draft.pharmacySnapshot?.currencyCode;
  const currencyInfo = getCurrencyInfo(countryCode);

  const [finalRemarks, setFinalRemarks] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [saveDraftMessage, setSaveDraftMessage] = useState<string | null>(null);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [completedVisitRef, setCompletedVisitRef] = useState<string | null>(null);
  const [completedDisplayNo, setCompletedDisplayNo] = useState<string | null>(null);
  const [completedOrderDisplayNo, setCompletedOrderDisplayNo] = useState<string | null>(null);
  const [completedAuthoritativeTotals, setCompletedAuthoritativeTotals] = useState<{ grossSubtotal: number; totalDiscount: number; netSubtotal: number; currencyCode: string } | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [validationWarnings, setValidationWarnings] = useState<string[]>([]);

  // Run initial validation check on mount to populate warnings
  useEffect(() => {
    const res = validateStep6(draft);
    setValidationWarnings(res.warnings);
  }, [draft]);

  // Financial Calculations
  const grossTotal = draft.order?.subtotalPreview ?? 0;
  const discountTotal = draft.offers?.calculation?.totalDiscountAmount ?? 0;
  const netTotal = draft.offers?.calculation?.netTotal ?? Math.max(0, grossTotal - discountTotal);

  const currentAmount = draft.payment?.paymentEntry?.amount ?? 0;
  const currentMethod = draft.payment?.paymentEntry?.method || "CASH";
  const collectionStatusText = "No collection submitted";

  // Aggregate All Attachments
  const orderAttachment = draft.order?.imageAttachment;
  const paymentEvidences = draft.payment?.paymentEntry?.evidences || [];
  const totalAttachmentsCount = (orderAttachment ? 1 : 0) + paymentEvidences.length;

  // Handle Save Draft
  const handleSaveDraft = async () => {
    try {
      await PharmacyVisitDraftService.saveDraft({
        ...draft,
        updatedAt: new Date().toISOString()
      });
      const timeStr = new Date().toLocaleTimeString();
      setSaveDraftMessage(`Draft saved locally at ${timeStr}`);
      setTimeout(() => setSaveDraftMessage(null), 4000);
    } catch (e) {
      console.error("[Step6CompleteVisit] Failed to save draft:", e);
      setSaveDraftMessage("Failed to save draft locally.");
    }
  };

  // Handle Cancel / Discard Visit
  const handleConfirmCancelVisit = async () => {
    try {
      await PharmacyVisitDraftService.deleteDraft(draft.draftId, draft.repUid);
    } catch (e) {
      console.error("Failed to delete draft:", e);
    }
    if (onNavigate) {
      onNavigate("pharmacies");
    } else {
      window.location.reload();
    }
  };

  // Handle Complete Visit Workflow
  const handleCompleteVisit = async () => {
    if (currentAmount !== 0) {
      setValidationErrors([VISIT_COLLECTION_UNAVAILABLE_MESSAGE]);
      return;
    }
    setIsSubmitting(true);
    setValidationErrors([]);

    const res = validateStep6(draft);
    setValidationWarnings(res.warnings);

    if (!res.isValid) {
      setValidationErrors(res.errors);
      setIsSubmitting(false);
      return;
    }

    try {
      const result = await completePharmacyVisitV2(draft, currentUser, finalRemarks);

      if (!result.success) {
        const errMsgs = result.errors && result.errors.length > 0 
          ? result.errors 
          : ["An error occurred completing the visit draft."];
        setValidationErrors([
          ...errMsgs.map(message => message === "PHARMACY_VISIT_OFFER_REWARD_STOCK_INSUFFICIENT" ? "The selected Offer is no longer available because the complete promotional reward quantity is not in stock." : message),
          errMsgs.some(message => message.startsWith("PHARMACY_VISIT_OFFER_"))
            ? "Offer validation changed. Return to Step 3, recalculate, and explicitly reconfirm before completing."
            : "Visit completion failed. Your draft has been saved and can be resumed. Do not discard the Visit automatically."
        ]);
        if (errMsgs.some(message => message.startsWith("PHARMACY_VISIT_OFFER_"))) {
          dispatch({ type: "SET_OFFER_INTENT", payload: (draft.offerIntent || []).map(intent => ({ ...intent, confirmed: false, confirmedAt: undefined })) });
          dispatch({ type: "SET_STEP", payload: 3 });
        }
        setIsSubmitting(false);
        return;
      }

      if (result.warnings) {
        setValidationWarnings(result.warnings);
      }

      // Diagnostic JSON output
      console.info(
        "[PHARMACY_VISIT_COMPLETED_JSON]",
        JSON.stringify({
          visitId: result.visitId,
          orderId: result.orderId,
          draftId: draft.draftId,
          pharmacyId: draft.pharmacyId,
          repUid: draft.repUid,
          orderTotal: result.authoritativeTotals?.netSubtotal ?? netTotal,
          gpsStatus: draft.gps?.status,
          finalRemarks: finalRemarks.trim() || undefined,
          alreadyCompleted: result.alreadyCompleted,
          completedAt: new Date().toISOString()
        })
      );

      setCompletedVisitRef(result.visitId);
      setCompletedDisplayNo(result.visitDisplayNumber || null);
      setCompletedOrderDisplayNo(result.orderDisplayNumber || null);
      setCompletedAuthoritativeTotals(result.authoritativeTotals || null);
    } catch (err) {
      console.error("[Step6CompleteVisit] Error completing visit:", err);
      setValidationErrors(["An unexpected error occurred while completing the visit."]);
    } finally {
      setIsSubmitting(false);
    }
  };

  // SUCCESS COMPLETION SCREEN
  if (completedVisitRef) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-md text-center max-w-2xl mx-auto space-y-6 my-6">
        <div className="w-16 h-16 bg-emerald-100 border border-emerald-200 rounded-full flex items-center justify-center mx-auto text-emerald-600">
          <CheckCircle2 className="w-10 h-10" />
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-center gap-2 font-mono text-xs font-bold">
            <span className="px-3.5 py-1.5 bg-emerald-50 text-emerald-800 rounded-lg border border-emerald-200 shadow-xs">
              Visit No. {completedDisplayNo || getVisitBusinessNumber(draft, undefined, "PV")}
            </span>
            {completedOrderDisplayNo && (
              <span className="px-3.5 py-1.5 bg-indigo-50 text-indigo-800 rounded-lg border border-indigo-200 shadow-xs">
                Order No. {completedOrderDisplayNo}
              </span>
            )}
          </div>
          <h2 className="text-2xl font-black text-slate-900">
            Pharmacy Visit Summary Complete
          </h2>
          <p className="text-sm text-slate-500 max-w-md mx-auto">
            The commercial visit draft has passed all validation checks and has been saved as completed.
          </p>
        </div>

        {/* Financial Highlights */}
        <div className="grid grid-cols-3 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs font-mono">
          <div>
            <span className="text-[10px] text-slate-500 uppercase block">Order Net</span>
            <span className="font-bold text-slate-900 text-sm">{formatCurrency(completedAuthoritativeTotals?.netSubtotal ?? netTotal, completedAuthoritativeTotals?.currencyCode || countryCode)}</span>
          </div>
          <div>
            <span className="text-[10px] text-slate-500 uppercase block">Collection</span>
            <span className="font-bold text-emerald-600 text-sm">Not submitted</span>
          </div>
          <div>
            <span className="text-[10px] text-slate-500 uppercase block">Settlement</span>
            <span className="font-bold text-indigo-600 text-sm">Not performed</span>
          </div>
        </div>

        <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => onNavigate ? onNavigate("pharmacies") : window.location.reload()}
            className="w-full sm:w-auto px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-sm transition-colors shadow-sm"
          >
            Return to Pharmacy List
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="w-full sm:w-auto px-5 py-2.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-semibold rounded-xl text-sm transition-colors"
          >
            Start New Visit
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      {/* Header Banner */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
              Step 6 of 6
            </span>
            <span className="text-xs text-slate-500 font-medium">Review & Production Completion</span>
          </div>
          <h2 className="text-xl font-bold text-slate-900 mt-1">
            Commercial Visit Completion Summary
          </h2>
          <p className="text-sm text-slate-500">
            Review the complete visit summary exactly as it will be saved. Verify all information before completing.
          </p>
        </div>

        {saveDraftMessage && (
          <div className="px-3 py-1.5 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold rounded-lg flex items-center gap-1.5 animate-fadeIn">
            <CheckCircle2 className="w-4 h-4" />
            {saveDraftMessage}
          </div>
        )}
      </div>

      {/* Validation Errors Banner */}
      {validationErrors.length > 0 && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl space-y-2 text-sm text-rose-800">
          <div className="flex items-center gap-2 font-bold text-rose-900">
            <AlertCircle className="w-4 h-4 text-rose-600" />
            Validation Errors Prevent Completion
          </div>
          <ul className="list-disc list-inside space-y-1 text-xs">
            {validationErrors.map((err, idx) => (
              <li key={idx}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Informational Warnings Banner */}
      {validationWarnings.length > 0 && (
        <div className="p-4 bg-amber-50/80 border border-amber-200 rounded-xl space-y-1.5 text-xs text-amber-900">
          <div className="flex items-center gap-2 font-bold text-amber-900">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            Visit Execution Notices ({validationWarnings.length})
          </div>
          <ul className="list-disc list-inside space-y-0.5 text-amber-800">
            {validationWarnings.map((warn, idx) => (
              <li key={idx}>{warn}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Grid of Complete Visit Summary Modules */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* Module 1: Representative & Pharmacy */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-3">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2 border-b border-slate-100 pb-2">
            <Store className="w-4 h-4 text-indigo-600" />
            Representative & Pharmacy Details
          </h3>
          <div className="space-y-2 text-xs text-slate-600">
            <div className="flex justify-between">
              <span className="text-slate-400">Sales Representative:</span>
              <span className="font-semibold text-slate-800">{currentUser.name} ({currentUser.id})</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Pharmacy Name:</span>
              <span className="font-bold text-indigo-900">{draft.pharmacySnapshot?.nameEn || draft.pharmacyId}</span>
            </div>
            {draft.pharmacySnapshot?.nameAr && (
              <div className="flex justify-between">
                <span className="text-slate-400">Arabic Name:</span>
                <span className="font-medium text-slate-800">{draft.pharmacySnapshot.nameAr}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-slate-400">Territory Area:</span>
              <span className="font-mono text-slate-700">{draft.areaId}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Visit Purpose:</span>
              <span className="font-semibold text-indigo-600">
                {draft.visitPurpose?.labelEn || draft.visitPurpose?.code || "General Commercial Visit"}
              </span>
            </div>
            <div className="flex justify-between pt-1 border-t border-slate-100">
              <span className="text-slate-400">Registered AR Balance:</span>
              <span className="font-mono font-bold text-rose-600">
                Not assessed here
              </span>
            </div>
          </div>
        </div>

        {/* Module 2: GPS Telemetry & Status */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-3">
          <h3 className="text-sm font-bold text-slate-900 flex items-center justify-between border-b border-slate-100 pb-2">
            <span className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-emerald-600" />
              GPS Verification Status
            </span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
              draft.gps?.status === "VERIFIED"
                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                : "bg-slate-100 text-slate-600 border-slate-200"
            }`}>
              {draft.gps?.status || "NOT_ACQUIRED"}
            </span>
          </h3>

          <div className="space-y-2 text-xs text-slate-600">
            <div className="flex justify-between">
              <span className="text-slate-400">Latitude / Longitude:</span>
              <span className="font-mono text-slate-800">
                {draft.gps?.latitude ? `${draft.gps.latitude.toFixed(5)}, ${draft.gps?.longitude?.toFixed(5)}` : "N/A"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Capture Source:</span>
              <span className="font-medium text-slate-700">{draft.gps?.source || "Device GPS"}</span>
            </div>
            <div className="flex justify-between pt-1 border-t border-slate-100">
              <span className="text-slate-400">Captured At:</span>
              <span className="font-mono text-slate-500">
                {draft.gps?.timestamp ? new Date(draft.gps.timestamp).toLocaleTimeString() : "N/A"}
              </span>
            </div>
          </div>
        </div>

        {/* Module 3: Order Summary & Applied Offers */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-3 md:col-span-2">
          <h3 className="text-sm font-bold text-slate-900 flex items-center justify-between border-b border-slate-100 pb-2">
            <span className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-indigo-600" />
              Order Items & Applied Commercial Offers
            </span>
            <span className="text-xs font-mono font-bold text-indigo-700">
              {draft.order?.lines.length || 0} Item(s)
            </span>
          </h3>

          {draft.order?.lines && draft.order.lines.length > 0 ? (
            <div className="space-y-4">
              {/* Order Lines Table */}
              <div className="overflow-x-auto border border-slate-200 rounded-xl">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 uppercase font-bold text-[10px] border-b border-slate-200">
                    <tr>
                      <th className="p-3">Product Name</th>
                      <th className="p-3">Pack</th>
                      <th className="p-3 text-center">Qty</th>
                      <th className="p-3 text-right">Unit Price</th>
                      <th className="p-3 text-right">Line Subtotal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {draft.order.lines.map((l) => (
                      <tr key={l.id} className="hover:bg-slate-50/50">
                        <td className="p-3 font-semibold text-slate-900">{l.productNameSnapshot}</td>
                        <td className="p-3 text-slate-500">{l.packSnapshot || "-"}</td>
                        <td className="p-3 text-center font-mono font-bold text-indigo-600">{l.quantity}</td>
                        <td className="p-3 text-right font-mono">{formatCurrency(l.unitPricePreview, countryCode)}</td>
                        <td className="p-3 text-right font-mono font-bold text-slate-900">
                          {formatCurrency(l.lineTotalPreview, countryCode)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Applied Offers / Bonus Items */}
              {draft.offers?.calculation && (
                <div className="p-3 bg-indigo-50/50 border border-indigo-100 rounded-xl space-y-2 text-xs">
                  <div className="flex items-center justify-between font-bold text-indigo-900">
                    <span className="flex items-center gap-1.5">
                      <Gift className="w-4 h-4 text-indigo-600" />
                      Commercial Campaign: {draft.offers.campaignNameSnapshot || "Standard Offers"}
                    </span>
                    <span className="text-emerald-700 font-mono">
                      Total Discount: -{formatCurrency(discountTotal, countryCode)}
                    </span>
                  </div>

                  {draft.offers.calculation.bonusLines && draft.offers.calculation.bonusLines.length > 0 && (
                    <div className="pt-2 border-t border-indigo-100 space-y-1 text-[11px]">
                      <span className="font-bold text-indigo-800 block">Free Bonus Items Granted:</span>
                      {draft.offers.calculation.bonusLines.map((b, idx) => (
                        <div key={idx} className="flex justify-between text-indigo-700 font-mono">
                          <span>• {b.productNameSnapshot}</span>
                          <span className="font-bold">+{b.bonusQuantity} Free</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Order Totals Bar */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between bg-slate-900 text-white p-4 rounded-xl gap-2 font-mono text-xs">
                <div>
                  <span className="text-slate-400 block">Gross Order Subtotal</span>
                  <span className="text-base font-bold">{formatCurrency(grossTotal, countryCode)}</span>
                </div>
                <div>
                  <span className="text-slate-400 block">Discount</span>
                  <span className="text-base font-bold text-emerald-400">-{formatCurrency(discountTotal, countryCode)}</span>
                </div>
                <div className="text-right border-t sm:border-t-0 sm:border-l border-slate-700 pt-2 sm:pt-0 sm:pl-4">
                  <span className="text-slate-300 block font-sans text-xs">Net Order Total</span>
                  <span className="text-xl font-extrabold text-white">{formatCurrency(netTotal, countryCode)}</span>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-400 italic p-3 border border-dashed border-slate-200 rounded-xl text-center">
              No order items requested for this visit (Relationship Visit / Stock Check Only).
            </p>
          )}
        </div>

        {/* Module 4: Saved Collection Details */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-3">
          <h3 className="text-sm font-bold text-slate-900 flex items-center justify-between border-b border-slate-100 pb-2">
            <span className="flex items-center gap-2">
              <Receipt className="w-4 h-4 text-emerald-600" />
              Saved Collection Details
            </span>
            <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700">
              {collectionStatusText}
            </span>
          </h3>

          <p role="status" className="text-sm text-indigo-700">
            {currentAmount !== 0 ? VISIT_COLLECTION_UNAVAILABLE_MESSAGE : "Visit completion does not create debt or settle payment. Collection recording is unavailable here."}
          </p>
          <div className="space-y-2 text-xs text-slate-600">
            <div className="flex justify-between">
              <span className="text-slate-400">Receivable Balance:</span>
              <span className="font-mono font-semibold text-rose-600">Not assessed here</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Current Visit Net Total:</span>
              <span className="font-mono font-semibold text-slate-900">{formatCurrency(netTotal, countryCode)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Saved Amount (Not Submitted):</span>
              <span className="font-mono font-bold text-emerald-600">{formatCurrency(currentAmount, countryCode)} ({currentMethod})</span>
            </div>

            {/* Method Details if Amount > 0 */}
            {currentAmount > 0 && (
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-1 text-[11px]">
                {currentMethod === "CHEQUE" && (
                  <>
                    <p>Cheque Number: <span className="font-mono font-bold">{draft.payment?.paymentEntry?.chequeNumber || "N/A"}</span></p>
                    <p>Cheque Date: <span className="font-mono">{draft.payment?.paymentEntry?.chequeDate || "N/A"}</span></p>
                    <p>Issuing Bank: <span>{draft.payment?.paymentEntry?.issuingBank || "N/A"}</span></p>
                  </>
                )}
                {currentMethod === "BANK_TRANSFER" && (
                  <>
                    <p>Transfer Ref #: <span className="font-mono font-bold">{draft.payment?.paymentEntry?.bankReferenceNumber || "N/A"}</span></p>
                    <p>Transfer Date: <span className="font-mono">{draft.payment?.paymentEntry?.transferDate || "N/A"}</span></p>
                  </>
                )}
                {currentMethod === "OTHER" && (
                  <p>Description: <span>{draft.payment?.paymentEntry?.otherMethodDescription || "N/A"}</span></p>
                )}
              </div>
            )}

            <div className="flex justify-between pt-2 border-t border-slate-100 font-bold text-sm text-slate-900">
              <span>Settlement:</span>
              <span className="font-mono text-indigo-700">Not performed</span>
            </div>
          </div>
        </div>

        {/* Module 5: Stock Requests, Intelligence & Tasks */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-3">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2 border-b border-slate-100 pb-2">
            <Package className="w-4 h-4 text-indigo-600" />
            Stock, Intelligence & Tasks
          </h3>

          <div className="space-y-3 text-xs">
            {/* Stock Lines */}
            <div>
              <span className="font-bold text-slate-800 block mb-1">Stock Replenishment Requests:</span>
              {draft.stock?.requestLines && draft.stock.requestLines.length > 0 ? (
                <div className="space-y-1">
                  {draft.stock.requestLines.map((s) => (
                    <div key={s.draftLineId} className="flex justify-between bg-slate-50 p-2 rounded border border-slate-200">
                      <span>{s.productNameSnapshot}</span>
                      <span className="font-mono font-bold text-indigo-600">Qty: {s.requestedQuantity} ({s.priority})</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-slate-400 italic">No stock replenishment requests logged.</p>
              )}
            </div>

            {/* Competitor Intelligence */}
            <div>
              <span className="font-bold text-slate-800 block mb-1">Competitive Intelligence:</span>
              {draft.stock?.competitiveIntelligence?.competitorBrands && draft.stock.competitiveIntelligence.competitorBrands.length > 0 ? (
                <div className="space-y-1">
                  {draft.stock.competitiveIntelligence.competitorBrands.map((c) => (
                    <div key={c.id} className="bg-slate-50 p-2 rounded border border-slate-200">
                      <span className="font-bold text-slate-900">{c.brandName}</span> ({c.companyName}) - Status: {c.categoryOrProduct}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-slate-400 italic">No competitor activity observations logged.</p>
              )}
            </div>

            {/* Follow-up Task */}
            <div className="pt-2 border-t border-slate-100">
              <span className="font-bold text-slate-800 block mb-0.5">Follow-up Task Scheduled:</span>
              {draft.stock?.followUp?.required ? (
                <div className="p-2 bg-emerald-50 border border-emerald-200 rounded text-emerald-900 font-medium">
                  Due: <span className="font-bold font-mono">{draft.stock.followUp.followUpDate}</span> ({draft.stock.followUp.priority})
                  {draft.stock.followUp.notes && <p className="text-[11px] text-emerald-700 mt-0.5">{draft.stock.followUp.notes}</p>}
                </div>
              ) : (
                <p className="text-slate-400 italic">No follow-up task scheduled.</p>
              )}
            </div>
          </div>
        </div>

        {/* Module 6: CRM Notes & Attachments */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-3 md:col-span-2">
          <h3 className="text-sm font-bold text-slate-900 flex items-center justify-between border-b border-slate-100 pb-2">
            <span className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-indigo-600" />
              CRM Visit Summary Notes & Attachments Proof
            </span>
            <span className="text-xs text-slate-500 font-medium">
              {totalAttachmentsCount} Attachment(s)
            </span>
          </h3>

          <div className="space-y-3 text-xs">
            {/* General Notes */}
            <div>
              <span className="font-bold text-slate-700 block mb-1">CRM Notes:</span>
              {draft.stock?.crmNotes?.generalNotes ? (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 leading-relaxed whitespace-pre-wrap">
                  {draft.stock.crmNotes.generalNotes}
                </div>
              ) : (
                <p className="text-slate-400 italic p-2 border border-dashed border-slate-200 rounded-lg">
                  No general CRM notes entered.
                </p>
              )}
            </div>

            {/* Attachments List */}
            {totalAttachmentsCount > 0 && (
              <div className="space-y-2 pt-2 border-t border-slate-100">
                <span className="font-bold text-slate-700 flex items-center gap-1">
                  <Paperclip className="w-3.5 h-3.5 text-indigo-600" />
                  Attached Files ({totalAttachmentsCount}):
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {orderAttachment && (
                    <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg flex items-center gap-2">
                      <Camera className="w-4 h-4 text-indigo-600 shrink-0" />
                      <div className="truncate">
                        <p className="font-bold text-slate-800 truncate">Order Note Photo</p>
                        <p className="text-[10px] text-slate-500">{orderAttachment.fileName}</p>
                      </div>
                    </div>
                  )}

                  {paymentEvidences.map((ev) => (
                    <div key={ev.attachmentId} className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg flex items-center gap-2">
                      <Receipt className="w-4 h-4 text-emerald-600 shrink-0" />
                      <div className="truncate">
                        <p className="font-bold text-slate-800 truncate">{ev.fileName}</p>
                        <p className="text-[10px] text-slate-500">{(ev.sizeBytes / 1024).toFixed(0)} KB</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

      </div>

      {/* Final Representative Remarks Textarea */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-2">
        <label className="block text-xs font-bold uppercase text-slate-700 flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
          Final Representative Remarks / Outcome Notes (Optional)
        </label>
        <textarea
          rows={3}
          value={finalRemarks}
          onChange={(e) => setFinalRemarks(e.target.value)}
          placeholder="Enter final remarks regarding pharmacy visit outcome or supervisor follow-up..."
          className="w-full p-3 text-xs border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      {/* Navigation & Action Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-slate-200">
        <button
          type="button"
          onClick={onBack}
          className="w-full sm:w-auto px-5 py-2.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-semibold rounded-lg text-sm transition-colors flex items-center justify-center gap-2 shadow-xs"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Step 5 (Stock & Notes)
        </button>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          <button
            type="button"
            onClick={handleSaveDraft}
            className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg text-xs transition-colors flex items-center gap-1.5 border border-slate-200"
          >
            <Save className="w-4 h-4 text-emerald-600" />
            Save Draft
          </button>

          <button
            type="button"
            onClick={() => setShowCancelModal(true)}
            className="px-4 py-2.5 bg-rose-50 hover:bg-rose-100 text-rose-700 font-semibold rounded-lg text-xs transition-colors border border-rose-200"
          >
            Discard Visit
          </button>

          <button
            type="button"
            disabled={isSubmitting}
            onClick={handleCompleteVisit}
            className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold rounded-lg text-sm transition-colors flex items-center justify-center gap-2 shadow-md hover:shadow-lg"
          >
            {isSubmitting ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                Validating Visit...
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                Complete Visit
              </>
            )}
          </button>
        </div>
      </div>

      {/* Cancel Confirmation Modal */}
      {showCancelModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-xl">
            <div className="flex items-center gap-3 text-rose-600 font-bold text-base border-b border-slate-100 pb-3">
              <AlertTriangle className="w-5 h-5" />
              Discard Pharmacy Visit Draft?
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Are you sure you want to discard this commercial visit draft? Unsaved changes, notes, and photos for this visit will be deleted.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowCancelModal(false)}
                className="px-4 py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg"
              >
                Keep Editing
              </button>
              <button
                type="button"
                onClick={handleConfirmCancelVisit}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-lg"
              >
                Yes, Discard Draft
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
