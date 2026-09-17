import React, { useState } from "react";
import {
  CreditCard,
  Building2,
  FileText,
  Paperclip,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Upload,
  ShieldCheck,
  Receipt,
  DollarSign
} from "lucide-react";
import { User } from "../../../types";
import {
  PharmacyVisitDraft,
  PharmacyPaymentMethod,
  PharmacyPaymentEvidence
} from "../types/domain";
import { PharmacyVisitAction } from "../state/pharmacyVisitReducer";
import { validateStep4, VISIT_COLLECTION_UNAVAILABLE_MESSAGE } from "../validation/validateStep4";
import { formatCurrency, getCurrencyInfo } from "../utils/currency";

interface Step4PaymentProps {
  draft: PharmacyVisitDraft;
  dispatch: React.Dispatch<PharmacyVisitAction>;
  currentUser: User;
  onBack: () => void;
  onNext: () => void;
}

export const Step4Payment: React.FC<Step4PaymentProps> = ({
  draft,
  dispatch,
  currentUser,
  onBack,
  onNext
}) => {
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [showValidation, setShowValidation] = useState(false);
  
  // Collapsed by default according to WP6.1H specification
  const currentAmountOnDraft = draft.payment?.paymentEntry?.amount ?? 0;
  const [isPaymentExpanded, setIsPaymentExpanded] = useState(currentAmountOnDraft > 0);

  const paymentState = draft.payment;
  const paymentEntry = paymentState?.paymentEntry;

  const countryCode = draft.currencyCode || draft.order?.currency || draft.pharmacySnapshot?.currencyCode;
  const currencyInfo = getCurrencyInfo(countryCode);
  const currency = draft.currencyCode || currencyInfo.code;

  const grossTotal = draft.order?.subtotalPreview ?? 0;
  const discountTotal = draft.offers?.calculation?.totalDiscountAmount ?? 0;
  const netTotal = draft.offers?.calculation?.netTotal ?? (grossTotal - discountTotal);
  const currentMethod: PharmacyPaymentMethod = paymentEntry?.method || "CASH";
  const currentAmount = paymentEntry?.amount ?? 0;
  const collectionStatusBadge = { text: "Collection unavailable", bg: "bg-slate-100 text-slate-700 border-slate-300" };

  // Method switch handler
  const handleSelectMethod = (method: PharmacyPaymentMethod) => {
    dispatch({ type: "SET_PAYMENT_METHOD", payload: method });
  };

  // Explicit user action only; mounting/restoring a draft never changes its amount.
  const handleRemoveSavedAmount = () => {
    if (!window.confirm("Remove the saved amount from this draft? No collection will be submitted. Notes and evidence will remain.")) return;
    dispatch({ type: "SET_PAYMENT_AMOUNT", payload: { amount: 0, userUid: currentUser.id } });
  };

  // Field change handler
  const handleFieldChange = (field: string, value: string) => {
    dispatch({
      type: "SET_PAYMENT_FIELD",
      payload: { field, value }
    });
  };

  // File upload handler
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.size > 5 * 1024 * 1024) {
        alert(`File "${file.name}" exceeds 5MB limit.`);
        continue;
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        const previewUrl = event.target?.result as string;
        const evidence: PharmacyPaymentEvidence = {
          attachmentId: `ev_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          fileName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          previewUrl: file.type.startsWith("image/") ? previewUrl : undefined,
          uploadStatus: "SUCCESS",
          createdAt: new Date().toISOString()
        };
        dispatch({ type: "ADD_PAYMENT_EVIDENCE", payload: evidence });
      };
      reader.readAsDataURL(file);
    }
  };

  // Remove evidence handler
  const handleRemoveEvidence = (attachmentId: string) => {
    dispatch({ type: "REMOVE_PAYMENT_EVIDENCE", payload: { attachmentId } });
  };

  // Proceed handler
  const handleProceed = () => {
    setShowValidation(true);
    const res = validateStep4(draft);
    if (!res.isValid) {
      setValidationErrors(res.errors);
      return;
    }
    dispatch({ type: "COMPLETE_STEP_4" });
    onNext();
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      {/* Lightweight CRM Step Header */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
              Step 4 of 6
            </span>
            <span className="text-xs text-slate-500 font-medium">Visit Notes & Saved Collection Details</span>
          </div>
          <h2 className="text-xl font-bold text-slate-900 mt-1">
            Visit Commercial Summary
          </h2>
          <p className="text-sm text-slate-500">
            Review commercial activity and retain Visit notes. This step does not record collection or settle payment.
          </p>
        </div>

        <div className="flex items-center gap-2 bg-slate-50 px-3 py-2 rounded-lg border border-slate-200">
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
          <span className="text-xs text-slate-600 font-medium">
            CRM Documentation • No ERP Blocking
          </span>
        </div>
      </div>

      <div role="status" className="p-3 bg-indigo-50 border border-indigo-200 rounded-xl text-indigo-700 text-sm">
        {currentAmount !== 0 ? VISIT_COLLECTION_UNAVAILABLE_MESSAGE : "Collection recording is unavailable here. You can complete the operational Visit and retain notes. Orders become receivables only after successful Delivery; Finance verification settles payments."}
      </div>

      {/* Lightweight CRM Financial Summary Card */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b border-slate-100 pb-4 gap-2">
          <div className="flex items-center gap-2">
            <Receipt className="w-5 h-5 text-indigo-600" />
            <h3 className="text-base font-bold text-slate-900">
              Visit Commercial Summary
            </h3>
          </div>
          <span className={`px-3 py-1 rounded-full text-xs font-bold border ${collectionStatusBadge.bg}`}>
            {collectionStatusBadge.text}
          </span>
        </div>

        {/* 4 Summary Metrics Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* Metric 1: Current Visit Order Total */}
          <div className="p-4 rounded-xl bg-indigo-50/50 border border-indigo-100">
            <span className="text-xs font-medium text-indigo-900 block mb-1">
              Current Visit Order
            </span>
            <span className="text-lg font-extrabold font-mono text-indigo-700">
              {formatCurrency(netTotal, countryCode)}
            </span>
            {discountTotal > 0 && (
              <span className="text-[10px] text-emerald-600 block mt-0.5 font-medium">
                Discount: -{formatCurrency(discountTotal, countryCode)}
              </span>
            )}
          </div>

          {/* Metric 2: Outstanding Receivable Balance */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
            <span className="text-xs font-medium text-slate-600 block mb-1">
              Receivable Balance
            </span>
            <span className="text-lg font-extrabold font-mono text-rose-600">
              Not assessed here
            </span>
          </div>

          {/* Metric 3: Saved Amount (Not Submitted) */}
          <div className="p-4 rounded-xl bg-emerald-50/50 border border-emerald-100">
            <span className="text-xs font-medium text-emerald-900 block mb-1">
              Saved Amount (Not Submitted)
            </span>
            <span className="text-lg font-extrabold font-mono text-emerald-700">
              {formatCurrency(currentAmount, countryCode)}
            </span>
          </div>

          {/* Metric 4: Outstanding Settlement */}
          <div className="p-4 rounded-xl bg-slate-900 text-white border border-slate-800">
            <span className="text-xs font-medium text-slate-300 block mb-1">
              Settlement
            </span>
            <span className="text-lg font-extrabold font-mono text-white">
              Not performed
            </span>
          </div>
        </div>
      </div>

      {/* Collapsible Panel: ▼ Saved Collection Details & Notes */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Accordion Header */}
        <button
          type="button"
          onClick={() => setIsPaymentExpanded(!isPaymentExpanded)}
          className="w-full p-5 bg-slate-50/80 hover:bg-slate-100/80 transition-colors flex items-center justify-between text-left border-b border-slate-200"
        >
          <div className="flex items-center gap-3">
            <CreditCard className="w-5 h-5 text-indigo-600 shrink-0" />
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-slate-900">Saved Collection Details & Notes</span>
                {currentAmount > 0 && (
                  <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[11px] font-bold rounded-md">
                    {formatCurrency(currentAmount, countryCode)} ({currentMethod})
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500">
                Expand to review saved details and retain operational notes. Collection cannot be submitted here.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-slate-500">
            <span className="text-xs font-medium">{isPaymentExpanded ? "Hide" : "Expand"}</span>
            {isPaymentExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
          </div>
        </button>

        {/* Accordion Body */}
        {isPaymentExpanded && (
          <div className="p-6 space-y-6">
            {/* Payment Method Selector */}
            <div>
              <label className="block text-xs font-semibold uppercase text-slate-500 mb-2">
                Payment Method
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { id: "CASH", label: "Cash", icon: DollarSign, desc: "Cash payment" },
                  { id: "CHEQUE", label: "Cheque", icon: FileText, desc: "Bank cheque" },
                  { id: "BANK_TRANSFER", label: "Bank Transfer", icon: Building2, desc: "Wire / Transfer" },
                  { id: "OTHER", label: "Other", icon: Receipt, desc: "Other method" }
                ].map((m) => {
                  const Icon = m.icon;
                  const isSelected = currentMethod === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      disabled
                      onClick={() => handleSelectMethod(m.id as PharmacyPaymentMethod)}
                      className={`p-3 rounded-lg border text-left transition-all flex flex-col justify-between ${
                        isSelected
                          ? "border-indigo-600 bg-indigo-50/50 text-indigo-900 ring-1 ring-indigo-600"
                          : "border-slate-200 bg-white hover:border-slate-300 text-slate-700"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <Icon className={`w-4 h-4 ${isSelected ? "text-indigo-600" : "text-slate-400"}`} />
                        {isSelected && <CheckCircle2 className="w-4 h-4 text-indigo-600" />}
                      </div>
                      <span className="text-sm font-semibold block">{m.label}</span>
                      <span className="text-[11px] text-slate-500">{m.desc}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Payment Amount & Presets */}
            <div className="space-y-3">
              <label className="block text-xs font-semibold uppercase text-slate-500">
                Saved Amount — Not Submitted ({currency})
              </label>
              <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
                <div className="relative flex-1">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={currentAmount === 0 ? "" : currentAmount}
                    readOnly
                    aria-label="Saved collection amount"
                    placeholder="0.00"
                    className="w-full pl-4 pr-16 py-2.5 text-lg font-mono font-bold border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  />
                  <span className="absolute right-4 top-3 text-xs font-bold text-slate-400">
                    {currency}
                  </span>
                </div>

                {currentAmount !== 0 && (
                  <button type="button" onClick={handleRemoveSavedAmount}
                    className="px-3 py-2 text-xs font-semibold bg-rose-50 text-rose-700 rounded-lg border border-rose-200">
                    Remove saved amount explicitly
                  </button>
                )}
              </div>
            </div>

            {/* Method-Specific Fields */}
            {currentAmount > 0 && currentMethod === "CHEQUE" && (
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-4">
                <h4 className="text-xs font-bold uppercase text-slate-700 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-indigo-600" />
                  Cheque Details
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Cheque Number <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={paymentEntry?.chequeNumber || ""}
                      onChange={(e) => handleFieldChange("chequeNumber", e.target.value)}
                      placeholder="e.g. CHQ-984021"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Cheque Date <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="date"
                      value={paymentEntry?.chequeDate || ""}
                      onChange={(e) => handleFieldChange("chequeDate", e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Issuing Bank
                    </label>
                    <input
                      type="text"
                      value={paymentEntry?.issuingBank || ""}
                      onChange={(e) => handleFieldChange("issuingBank", e.target.value)}
                      placeholder="e.g. Sahara Bank / Arab Bank"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>
              </div>
            )}

            {currentAmount > 0 && currentMethod === "BANK_TRANSFER" && (
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-4">
                <h4 className="text-xs font-bold uppercase text-slate-700 flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5 text-indigo-600" />
                  Bank Transfer Details
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Reference Number <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={paymentEntry?.bankReferenceNumber || ""}
                      onChange={(e) => handleFieldChange("bankReferenceNumber", e.target.value)}
                      placeholder="e.g. TRX-7781029"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Transfer Date
                    </label>
                    <input
                      type="date"
                      value={paymentEntry?.transferDate || ""}
                      onChange={(e) => handleFieldChange("transferDate", e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>
              </div>
            )}

            {currentAmount > 0 && currentMethod === "OTHER" && (
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-4">
                <h4 className="text-xs font-bold uppercase text-slate-700 flex items-center gap-1.5">
                  <Receipt className="w-3.5 h-3.5 text-indigo-600" />
                  Other Method Description
                </h4>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Method Description <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={paymentEntry?.otherMethodDescription || ""}
                    onChange={(e) => handleFieldChange("otherMethodDescription", e.target.value)}
                    placeholder="Saved method description..."
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>
            )}

            {/* Reference Number & Notes */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-500 mb-1">
                  Reference Number (Optional)
                </label>
                <input
                  type="text"
                  value={paymentEntry?.bankReferenceNumber || paymentEntry?.chequeNumber || ""}
                  onChange={(e) => handleFieldChange("bankReferenceNumber", e.target.value)}
                  placeholder="Receipt / Ref #"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-slate-500 mb-1">
                  Payment Notes (Optional)
                </label>
                <input
                  type="text"
                  value={paymentEntry?.notes || ""}
                  onChange={(e) => handleFieldChange("notes", e.target.value)}
                  placeholder="Optional documentation notes..."
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            {/* Attachments Section */}
            <div className="space-y-3 pt-3 border-t border-slate-100">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                    <Paperclip className="w-4 h-4 text-indigo-600" />
                    Receipt Attachment Proof
                  </h4>
                  <p className="text-[11px] text-slate-500">
                    Upload image or PDF proof of payment.
                  </p>
                </div>

                <label className="cursor-pointer px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg text-xs font-semibold border border-indigo-200 transition-colors flex items-center gap-1.5">
                  <Upload className="w-3.5 h-3.5" />
                  Attach File
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    multiple
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
              </div>

              {paymentEntry?.evidences && paymentEntry.evidences.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {paymentEntry.evidences.map((ev) => (
                    <div
                      key={ev.attachmentId}
                      className="p-3 bg-slate-50 rounded-lg border border-slate-200 flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="flex items-center gap-2 overflow-hidden">
                        {ev.previewUrl ? (
                          <img
                            src={ev.previewUrl}
                            alt="Receipt preview"
                            className="w-9 h-9 rounded object-cover border border-slate-200 shrink-0"
                          />
                        ) : (
                          <FileText className="w-8 h-8 text-indigo-500 shrink-0" />
                        )}
                        <div className="truncate">
                          <p className="font-semibold text-slate-800 truncate">{ev.fileName}</p>
                          <p className="text-[10px] text-slate-500">
                            {(ev.sizeBytes / 1024).toFixed(0)} KB
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleRemoveEvidence(ev.attachmentId)}
                        className="p-1 text-slate-400 hover:text-rose-600 rounded transition-colors"
                        title="Remove attachment"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-3 border border-dashed border-slate-200 rounded-lg text-center text-xs text-slate-400">
                  No payment receipt attachments uploaded.
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Validation Banner if errors exist */}
      {showValidation && validationErrors.length > 0 && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl space-y-2 text-sm text-rose-800">
          <div className="flex items-center gap-2 font-bold text-rose-900">
            <AlertTriangle className="w-4 h-4 text-rose-600" />
            Step 4 Validation Notice
          </div>
          <ul className="list-disc list-inside space-y-1 text-xs">
            {validationErrors.map((err, idx) => (
              <li key={idx}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Action Navigation Bar */}
      <div className="flex items-center justify-between pt-4 border-t border-slate-200">
        <button
          type="button"
          onClick={onBack}
          className="px-5 py-2.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-semibold rounded-lg text-sm transition-colors flex items-center gap-2 shadow-xs"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Step 3 (Offers)
        </button>

        <button
          type="button"
          onClick={handleProceed}
          className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg text-sm transition-colors flex items-center gap-2 shadow-md hover:shadow-lg"
        >
          Proceed to Step 5 (Stock & Notes)
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
