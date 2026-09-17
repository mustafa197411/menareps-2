import React, { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../lib/firebase";
import { getVisitBusinessNumber } from "../utils/visitNumberUtils";
import { 
  X, 
  MapPin, 
  Calendar, 
  User, 
  Tag, 
  BookOpen, 
  FileText, 
  Package, 
  Smile, 
  Award, 
  Clock, 
  AlertCircle,
  Database,
  ArrowRight
} from "lucide-react";
import { KeyMessage, PhysicianVisit, Product } from "../types";
import { resolveCanonicalVisitProductName, resolveDetailingKeyMessages } from "../lib/canonicalVisitDisplay";
import { resolveFinancialIdentity } from "../lib/financialIdentity";
import { formatCurrencyForIdentity } from "../lib/marketSettings";

interface VisitSummaryModalProps {
  visit: PhysicianVisit | null;
  onClose: () => void;
  lang: "en" | "ar";
  products?: Product[];
  keyMessages?: KeyMessage[];
}

export default function VisitSummaryModal({ visit, onClose, lang, products = [], keyMessages = [] }: VisitSummaryModalProps) {
  const [requestLifecycle, setRequestLifecycle] = useState<Record<string, any>>({});
  useEffect(() => {
    const ids = (visit?.additionalSampleRequests || []).map(item => item.requestId).filter((id): id is string => Boolean(id));
    if (!ids.length) { setRequestLifecycle({}); return; }
    return () => undefined;
  }, [visit?.id]);
  useEffect(() => {
    const ids = (visit?.additionalSampleRequests || []).map(item => item.requestId).filter((id): id is string => Boolean(id));
    const unsubscribers = ids.map(id => onSnapshot(doc(db, "sampleRequests", id), snapshot => { if (snapshot.exists()) setRequestLifecycle(current => ({ ...current, [id]: { id, ...snapshot.data() } })); }));
    return () => unsubscribers.forEach(unsubscribe => unsubscribe());
  }, [visit?.id]);
  if (!visit) return null;

  const isRtl = lang === "ar";
  const visitIdentity = resolveFinancialIdentity([visit as any]);
  const visitMoney = (amount: number) => { try { return visitIdentity ? formatCurrencyForIdentity(amount, { marketId: visitIdentity.marketId }) : (isRtl ? "إعدادات السوق مطلوبة" : "Market configuration required"); } catch { return isRtl ? "إعدادات السوق مطلوبة" : "Market configuration required"; } };

  // Translate labels
  const t = {
    en: {
      title: "Visit Summary Report",
      generalInfo: "General Information",
      physician: "Physician",
      rep: "Representative",
      date: "Date & Time",
      duration: "Duration",
      gpsInfo: "GPS & Location Verification",
      coordinates: "Coordinates",
      accuracy: "Accuracy Status",
      spoofCheck: "Spoof / Mock Check",
      detailingGroup: "Promotion Groups Detailed",
      primaryPromo: "Primary Promotion Group",
      targetPromo: "Target Promotion Groups",
      productsDetailed: "Products Detailed & Discussion History",
      reaction: "Reaction",
      intent: "Prescription Intent",
      notes: "Product Notes",
      keyMessages: "Presented Key Messages",
      resources: "Presented Resources",
      disbursedSamples: "Disbursed Samples",
      requestedSamples: "Additional Sample Requests",
      marketingRequests: "Marketing & Sponsorship Requests",
      followUp: "Follow-Up Planning",
      overallNotes: "Overall Visit Notes",
      syncStatus: "Sync & System Metadata",
      close: "Close Report"
    },
    ar: {
      title: "تقرير ملخص الزيارة",
      generalInfo: "معلومات عامة",
      physician: "الطبيب",
      rep: "المندوب",
      date: "التاريخ والوقت",
      duration: "المدة",
      gpsInfo: "التحقق من الموقع الجغرافي (GPS)",
      coordinates: "الإحداثيات",
      accuracy: "حالة الدقة",
      spoofCheck: "فحص تزييف الموقع",
      detailingGroup: "مجموعات الترويج المفصلة",
      primaryPromo: "مجموعة الترويج الرئيسية",
      targetPromo: "مجموعات الترويج المستهدفة",
      productsDetailed: "تفاصيل المنتجات وتاريخ النقاش",
      reaction: "رد فعل الطبيب",
      intent: "نية وصف المنتج",
      notes: "ملاحظات المنتج",
      keyMessages: "الرسائل الترويجية المعروضة",
      resources: "المصادر والمطويات المقدمة",
      disbursedSamples: "العينات الموزعة",
      requestedSamples: "طلبات العينات الإضافية",
      marketingRequests: "طلبات التسويق والرعاية",
      followUp: "تخطيط المتابعة",
      overallNotes: "ملاحظات الزيارة العامة",
      syncStatus: "حالة المزامنة والبيانات الوصفية",
      close: "إغلاق التقرير"
    }
  }[lang];

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}m ${s}s`;
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto" id="visit-summary-modal-overlay">
      <div 
        className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-4xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden"
        id="visit-summary-modal-card"
        dir={isRtl ? "rtl" : "ltr"}
      >
        {/* Header */}
        <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-900/40">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-50 dark:bg-indigo-950 p-2 rounded-xl text-indigo-600 dark:text-indigo-400">
              <FileText size={20} />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">{t.title}</h2>
              <p className="text-xs text-indigo-600 dark:text-indigo-400 font-mono font-bold mt-0.5">
                {isRtl ? "رقم الزيارة: " : "Visit No: "} {getVisitBusinessNumber(visit, undefined, "MV")}
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 rounded-lg border border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 transition-all cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-xs text-slate-700 dark:text-slate-300 font-sans">
          
          {/* Quick Grid: General Info & GPS Verification */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* General Info */}
            <div className="bg-slate-50/50 dark:bg-slate-900/20 border border-slate-100 dark:border-slate-900 p-4 rounded-xl space-y-3">
              <h3 className="text-xxs font-extrabold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 border-b border-slate-100 dark:border-slate-900 pb-2">
                <User size={12} className="text-indigo-500" />
                <span>{t.generalInfo}</span>
              </h3>
              <div className="grid grid-cols-2 gap-y-2.5 text-xxs sm:text-xs">
                <div>
                  <p className="text-[10px] text-slate-400 font-bold">{t.physician}</p>
                  <p className="font-bold text-slate-800 dark:text-white">Dr. {visit.physicianName}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-400 font-bold">{t.rep}</p>
                  <p className="font-bold text-slate-800 dark:text-white">
                    {visit.repName} <span className="text-[9px] text-slate-400 font-mono">({visit.representativeRole || "Medical Rep"})</span>
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-400 font-bold">{t.date}</p>
                  <p className="font-bold text-slate-800 dark:text-white font-mono">
                    {visit.visitDate} {visit.completedAtLibya ? `(${visit.completedAtLibya})` : ""}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-400 font-bold">{t.duration}</p>
                  <p className="font-bold text-slate-800 dark:text-white font-mono">
                    {formatDuration(visit.durationSeconds)}
                  </p>
                </div>
              </div>
            </div>

            {/* GPS Info */}
            <div className="bg-slate-50/50 dark:bg-slate-900/20 border border-slate-100 dark:border-slate-900 p-4 rounded-xl space-y-3">
              <h3 className="text-xxs font-extrabold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 border-b border-slate-100 dark:border-slate-900 pb-2">
                <MapPin size={12} className="text-indigo-500" />
                <span>{t.gpsInfo}</span>
              </h3>
              <div className="grid grid-cols-2 gap-y-2.5 text-xxs sm:text-xs">
                <div>
                  <p className="text-[10px] text-slate-400 font-bold">{t.coordinates}</p>
                  {visit.latitude && visit.longitude ? (
                    <p className="font-mono text-slate-800 dark:text-white font-bold">
                      {visit.latitude.toFixed(6)}, {visit.longitude.toFixed(6)}
                    </p>
                  ) : (
                    <p className="text-rose-500 italic">No GPS coordinates captured</p>
                  )}
                </div>
                <div>
                  <p className="text-[10px] text-slate-400 font-bold">{t.accuracy}</p>
                  {visit.gpsAccuracy ? (
                    <span className={`inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold ${visit.gpsAccuracy <= 100 ? "bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 border border-emerald-100/50" : "bg-rose-50 dark:bg-rose-950/20 text-rose-600 dark:text-rose-400 border border-rose-100/50"}`}>
                      {visit.gpsAccuracy.toFixed(1)} meters
                    </span>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </div>
                <div>
                  <p className="text-[10px] text-slate-400 font-bold">GPS Verification</p>
                  <span className={`inline-flex px-2 py-0.5 rounded text-[9px] font-extrabold ${
                    visit.gpsVerified || visit.gpsVerificationStatus === "FIRST_VISIT_CAPTURED" || visit.gpsVerificationStatus === "VERIFIED_PREVIOUSLY" || visit.gpsVerificationStatus === "REVERIFIED"
                      ? "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20" 
                      : "bg-slate-500/10 text-slate-500 border border-slate-500/20"
                  }`}>
                    {visit.gpsVerificationStatus === "FIRST_VISIT_CAPTURED"
                      ? "GPS Verified"
                      : visit.gpsVerificationStatus === "VERIFIED_PREVIOUSLY"
                      ? "Verified Previously"
                      : visit.gpsVerificationStatus === "REVERIFIED"
                      ? "Reverified"
                      : visit.gpsVerified
                      ? "GPS Verified"
                      : "Unverified"}
                  </span>
                </div>
                <div>
                  <p className="text-[10px] text-slate-400 font-bold">{t.spoofCheck}</p>
                  <span className={`inline-flex px-2 py-0.5 rounded text-[9px] font-extrabold ${visit.gpsSpoofCheckStatus === "Passed" ? "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20" : "bg-amber-500/10 text-amber-600 border border-amber-500/20"}`}>
                    {visit.gpsSpoofCheckStatus || "Passed"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Promotion Group details */}
          <div className="bg-slate-50/30 dark:bg-slate-900/10 border border-slate-100 dark:border-slate-900 p-4 rounded-xl space-y-2">
            <h3 className="text-xxs font-extrabold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 pb-1 border-b border-slate-100 dark:border-slate-900">
              <Tag size={12} className="text-indigo-500" />
              <span>{t.detailingGroup}</span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <p className="text-[10px] text-slate-400 font-bold">{t.primaryPromo}</p>
                <p className="font-bold text-slate-800 dark:text-white">
                  {visit.primaryPromotionGroup || "—"}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-slate-400 font-bold">{t.targetPromo}</p>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {visit.targetPromotionGroups && visit.targetPromotionGroups.length > 0 ? (
                    visit.targetPromotionGroups.map(g => (
                      <span key={g} className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded text-[9.5px] font-semibold text-slate-600 dark:text-slate-300 border border-slate-200/50 dark:border-slate-700/50">
                        {g}
                      </span>
                    ))
                  ) : (
                    <span className="text-slate-400 text-xxs">No target groups detailed</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Products Detailed Panel */}
          <div className="space-y-3">
            <h3 className="text-xxs font-extrabold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 pb-1 border-b border-slate-100 dark:border-slate-800">
              <Award size={12} className="text-indigo-500" />
              <span>{t.productsDetailed}</span>
            </h3>

            <div className="space-y-3">
              {visit.detailing && visit.detailing.length > 0 ? (
                visit.detailing.map((det, idx) => {
                  const resolvedKeyMessages = resolveDetailingKeyMessages(det, keyMessages, lang);
                  const rxColor = det.reaction === "Positive" ? "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20" :
                                  det.reaction === "Neutral" ? "bg-slate-500/10 text-slate-600 border border-slate-500/20" :
                                  det.reaction === "Skeptical" ? "bg-amber-500/10 text-amber-600 border border-amber-500/20" :
                                  "bg-rose-500/10 text-rose-600 border border-rose-500/20";

                  const intentColor = det.prescriptionIntent === "High" ? "bg-indigo-500/10 text-indigo-600 border border-indigo-500/20" :
                                      det.prescriptionIntent === "Low" ? "bg-amber-500/10 text-amber-600 border border-amber-500/20" :
                                      "bg-slate-500/10 text-slate-600 border border-slate-500/20";

                  return (
                    <div key={idx} className="bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-800 p-4 rounded-xl shadow-xs space-y-3">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xxs px-2 py-0.5 bg-indigo-500 text-white font-extrabold rounded-md uppercase">
                            Product #{idx + 1}
                          </span>
                          <h4 className="font-bold text-sm text-slate-900 dark:text-white">
                            {resolveCanonicalVisitProductName(det, products)}
                          </h4>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <span className={`px-2 py-0.5 rounded text-[9.5px] font-bold border ${rxColor}`}>
                            {t.reaction}: {det.reaction}
                          </span>
                          {det.prescriptionIntent && (
                            <span className={`px-2 py-0.5 rounded text-[9.5px] font-bold border ${intentColor}`}>
                              {t.intent}: {det.prescriptionIntent}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Notes specific to product */}
                      {det.notes && (
                        <div className="p-2.5 bg-slate-50 dark:bg-slate-950 rounded-lg border border-slate-100 dark:border-slate-900 text-xxs sm:text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                          <span className="font-bold block text-[9px] text-slate-400 uppercase tracking-wider mb-1">{t.notes}:</span>
                          {det.notes}
                        </div>
                      )}

                      {/* Presented Messages and Resources lists */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 pt-2 border-t border-slate-50 dark:border-slate-850">
                        {/* Messages */}
                        <div className="space-y-1.5">
                          <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                            <Tag size={10} className="text-indigo-500" />
                            <span>{t.keyMessages}</span>
                          </p>
                          {resolvedKeyMessages.length > 0 ? (
                            <div className="space-y-1">
                              {resolvedKeyMessages.map((msg, mIdx) => (
                                <div key={mIdx} className="bg-indigo-50/20 dark:bg-indigo-950/10 p-2 rounded border border-indigo-100/40 dark:border-indigo-900/30 font-semibold text-xxs text-indigo-700 dark:text-indigo-300">
                                  <span className="font-mono">{msg.id}</span>
                                  {msg.text !== msg.id && <span>: {msg.text}</span>}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-slate-400 text-[10px] italic">No Key Messages discussed during detailing</p>
                          )}
                        </div>

                        {/* Resources */}
                        <div className="space-y-1.5">
                          <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                            <BookOpen size={10} className="text-indigo-500" />
                            <span>{t.resources}</span>
                          </p>
                          {det.presentedResources && det.presentedResources.length > 0 ? (
                            <div className="space-y-1">
                              {det.presentedResources.map((res, rIdx) => (
                                <div key={rIdx} className="bg-slate-50 dark:bg-slate-950 p-2 rounded border border-slate-100 dark:border-slate-900 flex justify-between items-center text-[10px]">
                                  <span className="font-bold text-slate-850 dark:text-white">{res}</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-slate-400 text-[10px] italic">No visual aids or study brochures presented</p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="text-slate-400 italic">No detailing logged for products</p>
              )}
            </div>
          </div>

          {/* Core Outcomes: Samples, Requests, Marketing */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-2">
            {/* Samples distributed and requests */}
            <div className="space-y-4">
              {/* Distributed */}
              <div className="bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-800 p-4 rounded-xl space-y-2.5">
                <h4 className="text-xxs font-extrabold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 pb-1 border-b border-slate-50 dark:border-slate-850">
                  <Package size={12} className="text-indigo-500" />
                  <span>{t.disbursedSamples}</span>
                </h4>
                {visit.samples && visit.samples.length > 0 ? (
                  <div className="space-y-1.5">
                    {visit.samples.map((s, idx) => (
                      <div key={idx} className="flex justify-between items-center bg-slate-50 dark:bg-slate-950 p-2 rounded border border-slate-100 dark:border-slate-850 text-xxs">
                        <span className="font-bold text-slate-800 dark:text-white">{s.productName}{s.sampleSkuName ? ` · ${s.sampleSkuName}` : ""}{s.allocationConsumptions?.length ? <small className="block text-slate-500">{s.allocationConsumptions.map(item => `${item.batchNumber} · ${item.expiryDate}`).join(", ")}</small> : null}</span>
                        <span className="font-mono bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 font-extrabold px-2 py-0.5 rounded border border-blue-100/50">
                          {s.quantity} units
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-slate-400 text-xxs italic">No samples distributed during visit</p>
                )}
              </div>

              {/* Sample Requests */}
              <div className="bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-800 p-4 rounded-xl space-y-2.5">
                <h4 className="text-xxs font-extrabold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 pb-1 border-b border-slate-50 dark:border-slate-850">
                  <Clock size={12} className="text-indigo-500" />
                  <span>{t.requestedSamples}</span>
                </h4>
                {visit.additionalSampleRequests && visit.additionalSampleRequests.length > 0 ? (
                  <div className="space-y-2">
                    {visit.additionalSampleRequests.map((req, idx) => { const lifecycle = req.requestId ? requestLifecycle[req.requestId] : undefined; return (
                      <div key={idx} className="bg-slate-50 dark:bg-slate-950 p-2.5 rounded border border-slate-100 dark:border-slate-850 text-xxs space-y-1">
                        <div className="flex justify-between items-center">
                          <span className="font-bold text-slate-800 dark:text-white">{req.sampleVariantName || lifecycle?.sampleSkuName || req.productName}<small className="block font-normal text-slate-500">{req.productName}</small></span>
                          <span className="font-mono bg-amber-50 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded font-black">
                            Qty: {req.quantityNeeded}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-450 flex items-center gap-2">
                          <span>Deliver by: <strong className="font-mono text-slate-700 dark:text-slate-300">{req.expectedDeliveryDate}</strong></span>
                        </div>
                        {req.reason && (
                          <p className="text-[10px] text-slate-500 italic mt-1 border-t border-slate-100 dark:border-slate-900 pt-1">Reason: "{req.reason}"</p>
                        )}
                        <div className="text-[10px] font-bold text-indigo-600">{lifecycle?.status || req.status || "HISTORICAL"}{req.requestId ? ` · ${req.requestId}` : ""}{lifecycle?.approvedQuantity !== undefined ? ` · Approved ${lifecycle.approvedQuantity}` : ""}{lifecycle?.allocatedQuantity !== undefined ? ` · Allocated ${lifecycle.allocatedQuantity}` : ""}</div>
                      </div>
                    )})}
                  </div>
                ) : (
                  <p className="text-slate-400 text-xxs italic">No additional sample requests recorded</p>
                )}
              </div>
            </div>

            {/* Marketing Requests & Follow Up */}
            <div className="space-y-4">
              {/* Marketing requests */}
              <div className="bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-800 p-4 rounded-xl space-y-2.5">
                <h4 className="text-xxs font-extrabold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 pb-1 border-b border-slate-50 dark:border-slate-850">
                  <Award size={12} className="text-indigo-500" />
                  <span>{t.marketingRequests}</span>
                </h4>
                {(visit.marketingRequests?.length || visit.marketingRequest) ? (
                  <div className="space-y-2">
                    {(visit.marketingRequests?.length ? visit.marketingRequests : [visit.marketingRequest]).filter(Boolean).map((request: any, index: number) => (
                      <div key={request.id || `legacy-marketing-request-${index}`} className="bg-slate-50 dark:bg-slate-950 p-2.5 rounded border border-slate-100 dark:border-slate-850 text-xxs space-y-1.5">
                        <div className="flex justify-between items-center">
                          <span className="font-extrabold text-slate-800 dark:text-white">{request.requestType}</span>
                          <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${request.urgency === "High" ? "bg-rose-50 text-rose-600 border border-rose-100" : "bg-slate-50 text-slate-600"}`}>{request.urgency} Urgency</span>
                        </div>
                        {request.status && <p className="text-[9px] font-bold text-blue-600">{request.status}</p>}
                        {request.executionNote && <p className="text-[10px] text-emerald-700 dark:text-emerald-400">{request.executionNote}</p>}
                        <div className="grid grid-cols-2 gap-2 text-[10px] border-b border-slate-100 dark:border-slate-900 pb-1.5">
                          <div><span className="text-slate-400 block font-bold">Planned Event Date:</span><span className="font-mono font-bold text-slate-800 dark:text-slate-300">{request.plannedDate || "—"}</span></div>
                          <div><span className="text-slate-400 block font-bold">{isRtl ? "الميزانية التقديرية:" : "Estimated Budget:"}</span><span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">{visitMoney(request.estimatedBudget)}</span></div>
                        </div>
                        {request.description && <p className="text-[10px] text-slate-500 leading-relaxed italic">"{request.description}"</p>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-slate-400 text-xxs italic">No marketing activities requested</p>
                )}
              </div>

              {/* Follow Up */}
              <div className="bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-800 p-4 rounded-xl space-y-2.5">
                <h4 className="text-xxs font-extrabold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 pb-1 border-b border-slate-50 dark:border-slate-850">
                  <Calendar size={12} className="text-indigo-500" />
                  <span>{t.followUp}</span>
                </h4>
                {visit.followUpRequired && visit.followUpDate ? (
                  <div className="bg-slate-50 dark:bg-slate-950 p-2.5 rounded border border-slate-100 dark:border-slate-850 text-xxs space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-400 font-bold">Scheduled Follow-up:</span>
                      <span className="font-mono font-extrabold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/30 px-2 py-0.5 rounded border border-indigo-100 dark:border-indigo-900/30">
                        {visit.followUpDate}
                      </span>
                    </div>
                    {visit.followUpNotes && (
                      <p className="text-[10px] text-slate-600 dark:text-slate-400 leading-relaxed italic border-t border-slate-100 dark:border-slate-900 pt-1">
                        Objective: "{visit.followUpNotes}"
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-slate-400 text-xxs italic">No follow-up planned</p>
                )}
              </div>
            </div>
          </div>

          {/* Overall Notes */}
          {visit.generalNotes && (
            <div className="bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-800 p-4 rounded-xl space-y-2">
              <h3 className="text-xxs font-extrabold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 pb-1 border-b border-slate-50 dark:border-slate-850">
                <FileText size={12} className="text-indigo-500" />
                <span>{t.overallNotes}</span>
              </h3>
              <p className="text-xs text-slate-800 dark:text-slate-200 leading-relaxed" dir={visit.generalNotes.match(/[\u0600-\u06FF]/) ? "rtl" : "ltr"}>
                {visit.generalNotes}
              </p>
            </div>
          )}

          {/* System & Sync Metadata */}
          <div className="bg-slate-50/50 dark:bg-slate-900/10 border border-slate-100 dark:border-slate-900 p-4 rounded-xl space-y-2">
            <h3 className="text-xxs font-extrabold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 pb-1 border-b border-slate-100 dark:border-slate-900">
              <Database size={11} className="text-indigo-500" />
              <span>{t.syncStatus}</span>
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-[10px] font-mono text-slate-500">
              <div>
                <span>Database Sync:</span>
                <span className="font-extrabold block text-emerald-600 dark:text-emerald-400">● Synced to Cloud</span>
              </div>
              <div>
                <span>Created At:</span>
                <span className="block text-slate-700 dark:text-slate-300">{visit.createdAt || "—"}</span>
              </div>
              <div>
                <span>Last Updated:</span>
                <span className="block text-slate-700 dark:text-slate-300">{visit.updatedAt || visit.createdAt || "—"}</span>
              </div>
              <div>
                <span>Operator:</span>
                <span className="block text-slate-700 dark:text-slate-300">{visit.updatedBy || visit.repId || "—"}</span>
              </div>
            </div>
          </div>

        </div>

        {/* Footer actions */}
        <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/30 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold rounded-xl text-xs transition-colors cursor-pointer shadow-md shadow-indigo-600/10"
          >
            {t.close}
          </button>
        </div>
      </div>
    </div>
  );
}
