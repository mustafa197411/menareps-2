import React, { useCallback, useEffect, useMemo, useState, useRef, useLayoutEffect } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronDown, ChevronRight, Gift, Info, RefreshCw, Sparkles, Tag, X } from "lucide-react";
import type { CanonicalOfferDefinition } from "../../offers/types";
import { calculateOffers } from "../../offers/offerCalculation";
import type { MarketBusinessSettings } from "../../../lib/marketSettings";
import { formatMarketCurrency } from "../../../lib/marketSettings";
import type { PharmacyVisitDraft } from "../types/domain";
import { fetchLivePharmacyOffers, PharmacyOfferReadError } from "../services/offerService";
import { buildOfferDraftIntent, evaluateVisitOffer, offerInputFingerprint, validateOfferProceed, type OfferVisitReadiness } from "../services/canonicalOfferVisit";
import { validateStep3 } from "../validation/validateStep3";

interface Props { onReadinessChange?: (ready: boolean) => void; draft: PharmacyVisitDraft; dispatch: React.Dispatch<any>; market: MarketBusinessSettings | null; marketStatus: "LOADING" | "RESOLVED" | "CONFIGURATION_ERROR"; lang?: "en" | "ar" }
const labels: Record<CanonicalOfferDefinition["type"], string> = { PRODUCT_PERCENTAGE: "Product Percentage Discount", INVOICE_PERCENTAGE: "Total Invoice Percentage Discount", BUY_X_GET_Y: "Buy X Get Y", TIER_BONUS: "Tier Bonus" };

export const Step3ApplyOffers: React.FC<Props> = ({ draft, dispatch, market, marketStatus, onReadinessChange, lang = "en" }) => {
  const isAr = lang === "ar", lines = draft.order?.lines || [];
  const [offers, setOffers] = useState<CanonicalOfferDefinition[]>([]);
  const [state, setState] = useState<OfferVisitReadiness>("NOT_READY");
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>(() => (draft.offerIntent || []).filter(item => item.selected).map(item => item.offerId));
  const [confirmed, setConfirmed] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [bundleCandidate, setBundleCandidate] = useState<string | null>(null);
  const [unavailableOfferCount, setUnavailableOfferCount] = useState(0);
  const [selectedCombinationAvailable, setSelectedCombinationAvailable] = useState(true);
  const marketReady = marketStatus === "RESOLVED" && market && draft.pharmacyId && draft.pharmacySnapshot?.countryId && draft.areaId && lines.length > 0 && lines.every(line => line.canonicalProductId);
  const calculationBase = useMemo(() => market ? ({ currencyCode: market.currencyCode, decimalPlaces: market.decimalPlaces, roundingMode: "DECIMAL_HALF_UP" as const, paidLines: lines.map(line => ({ lineId: line.id, productId: line.canonicalProductId, unitPrice: line.unitPricePreview, quantity: line.quantity, productName: line.productNameSnapshot, sku: line.productCode })) }) : null, [market, lines]);
  const selectedOffers = offers.filter(offer => selected.includes(offer.id));
  const fingerprint = calculationBase ? offerInputFingerprint({ ...calculationBase, selectedOffers }) : "";

  const requestKey = JSON.stringify([draft.pharmacyId, draft.areaId, lines, selected, market, marketStatus]);
  const currentRequestKey = useRef(requestKey);
  currentRequestKey.current = requestKey;
  const generation = useRef(0);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    const attempt = ++generation.current;
    setLoadedKey(null); setConfirmed({}); setSelectedCombinationAvailable(false);
    onReadinessChange?.(false);
    if (marketStatus === "CONFIGURATION_ERROR" || (marketStatus === "RESOLVED" && !market)) { setState("CONFIGURATION_ERROR"); return; }
    if (!marketReady) { setState("NOT_READY"); return; }
    setState("LOADING"); setError(null);
    try {
      const productIds: string[] = Array.from(new Set<string>(lines.map(line => String(line.canonicalProductId)))).sort();
      const result = await fetchLivePharmacyOffers({ pharmacyId: draft.pharmacyId!, productIds, paidLines: lines.map(line => ({ lineId: line.id, productId: line.canonicalProductId, quantity: line.quantity })), selectedOfferIds: selected });
      if (attempt !== generation.current || currentRequestKey.current !== requestKey) return;
      setLoadedKey(requestKey);
      setSelected(previous => previous.every(id => result.offers.some(offer => offer.id === id)) ? previous : previous.filter(id => result.offers.some(offer => offer.id === id)));
      setOffers(result.offers); setUnavailableOfferCount(result.unavailableOfferIds.length); setSelectedCombinationAvailable(result.selectedCombinationAvailable); setConfirmed({});
      setState(result.offers.length ? "READY_WITH_OFFERS" : "READY_EMPTY");
    } catch (cause) {
      if (attempt !== generation.current || currentRequestKey.current !== requestKey) return;
      setOffers([]); setUnavailableOfferCount(0);
      const code = cause instanceof PharmacyOfferReadError ? cause.code : "OFFER_NETWORK_ERROR";
      setError(code); setState(code.includes("PERMISSION") || code.includes("AUTHENTICATION") ? "PERMISSION_DENIED" : code.includes("CONFIGURATION") ? "CONFIGURATION_ERROR" : "NETWORK_ERROR");
    }
  }, [requestKey, onReadinessChange]);
  useEffect(() => { void load(); return () => { generation.current++; }; }, [load]);

  const calculation = calculationBase ? calculateOffers({ ...calculationBase, selectedOffers }) : null;
  const evaluations = useMemo(() => new Map(offers.map(offer => [offer.id, calculationBase ? evaluateVisitOffer(offer, calculationBase) : null])), [offers, calculationBase]);
  const discoveryReady = loadedKey === requestKey && (state === "READY_WITH_OFFERS" || state === "READY_EMPTY");
  const intent = selectedOffers.map(offer => buildOfferDraftIntent(offer, fingerprint, discoveryReady ? confirmed[offer.id] : undefined, discoveryReady && confirmed[offer.id] === fingerprint ? new Date().toISOString() : undefined));
  useEffect(() => { dispatch({ type: "SET_OFFER_INTENT", payload: intent }); }, [JSON.stringify(intent.map(({ confirmedAt, ...item }) => item))]);

  const readyToProceed = discoveryReady && selectedCombinationAvailable && selected.every(id => offers.some(offer => offer.id === id)) && validateOfferProceed(intent, fingerprint, calculation).valid && calculation?.success === true && calculation.conflicts.length === 0;
  useLayoutEffect(() => { onReadinessChange?.(readyToProceed); }, [readyToProceed, onReadinessChange]);

  const toggle = (id: string) => { setSelected(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]); setConfirmed(current => { const next = { ...current }; delete next[id]; return next; }); setBundleCandidate(null); };
  const confirm = (id: string) => { if (discoveryReady && selectedCombinationAvailable) setConfirmed(current => ({ ...current, [id]: fingerprint })); };
  const removeBundle = (id: string) => {
    if (bundleCandidate !== id) { setBundleCandidate(id); return; }
    const preview = evaluations.get(id)?.result;
    if (!preview?.success || preview.freeLines.length === 0) { setBundleCandidate(null); return; }
    const triggerPaidLineIds = Array.from(new Set(preview.freeLines.flatMap(line => line.triggerPaidLineIds)));
    if (triggerPaidLineIds.length === 0) { setBundleCandidate(null); return; }
    dispatch({ type: "REMOVE_PROMOTIONAL_BUNDLE", payload: { offerId: id, triggerPaidLineIds } });
    setSelected(current => current.filter(value => value !== id));
    setConfirmed({});
    setBundleCandidate(null);
  };
  const money = (value: number) => market ? formatMarketCurrency(value, market) : "—";
  const proceed = () => {
    if (!readyToProceed) { setError("Offer discovery and confirmation must complete before proceeding."); return; }
    const stepValidation = validateStep3({ ...draft, offers: undefined });
    const offerValidation = validateOfferProceed(intent, fingerprint, calculation);
    const errors = [...stepValidation.errors, ...offerValidation.errors];
    if (errors.length) setError(errors.join(" | ")); else dispatch({ type: "COMPLETE_STEP_3" });
  };

  if (state === "NOT_READY" || state === "LOADING" || (loadedKey !== requestKey && (state === "READY_EMPTY" || state === "READY_WITH_OFFERS"))) return <div className="p-8 text-center bg-white rounded-xl border border-slate-200 my-6"><Sparkles className={`w-8 h-8 text-sky-500 mx-auto mb-3 ${state === "LOADING" ? "animate-spin" : ""}`} /><h3 className="font-semibold">{state === "LOADING" ? "Evaluating Commercial Offers..." : "Offers will load when pharmacy, products and market currency are ready."}</h3></div>;
  if (["PERMISSION_DENIED", "CONFIGURATION_ERROR", "NETWORK_ERROR"].includes(state)) return <div className="p-6 bg-white rounded-xl border border-amber-300 my-6"><div className="flex gap-2 text-amber-900"><AlertTriangle className="w-5 h-5"/><b>{state.replaceAll("_", " ")}</b></div><p className="text-sm mt-2">{error || "Required Offer configuration is unavailable."}</p>{state === "NETWORK_ERROR" && <button onClick={() => void load()} className="mt-4 px-4 py-2 bg-slate-900 text-white rounded-lg flex gap-2"><RefreshCw className="w-4 h-4"/>Retry</button>}</div>;

  const successful = calculation?.success ? calculation : null;
  return <div className="space-y-6 my-4 min-w-0" dir={isAr ? "rtl" : "ltr"}>
    <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4"><div><span className="px-2 py-1 text-xs rounded-full bg-emerald-100 text-emerald-800">Step 3 of 6</span><h2 className="text-xl font-bold mt-2 flex gap-2"><Tag className="w-5 h-5 text-emerald-600"/>Apply Commercial Offers</h2><p className="text-xs text-slate-500 mt-1">Preview — recalculated at completion</p></div><div className="bg-slate-50 p-3 rounded-lg border text-right"><span className="text-xs text-slate-500 block">Order Gross Subtotal</span><b>{money(draft.order?.subtotalPreview || 0)}</b></div></div>
    {error && <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 text-sm text-amber-900">{error}</div>}
    {unavailableOfferCount > 0 && <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 text-sm text-amber-900">Offer currently unavailable: the complete promotional reward quantity is not in stock.</div>}
    {!selectedCombinationAvailable && <div className="bg-rose-50 border border-rose-300 rounded-lg p-3 text-sm text-rose-900">The selected Offer combination requires more physical stock than is currently available. Change the selection before confirming.</div>}
    {successful && successful.conflicts.length > 0 && <div className="bg-rose-50 border border-rose-300 rounded-xl p-4"><b>Offer conflict</b>{successful.conflicts.map(conflict => <p className="text-xs mt-2" key={`${conflict.offerId}:${conflict.conflictingOfferId}`}>{conflict.offerId} conflicts with {conflict.conflictingOfferId}. Deterministic priority selects {successful.appliedOffers.some(item => item.offerId === conflict.offerId) ? conflict.offerId : conflict.conflictingOfferId}; review your selection explicitly.</p>)}</div>}
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 min-w-0"><div className="lg:col-span-2 bg-white p-5 rounded-xl border space-y-4 min-w-0"><h3 className="font-bold">Eligible Promotional Offers <span className="text-xs bg-emerald-100 px-2 py-1 rounded-full">{offers.length}</span></h3>
      {state === "READY_EMPTY" ? <div className="p-8 text-center bg-slate-50 rounded-lg border border-dashed">No eligible Offers. You can continue without an Offer.</div> : <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{offers.map(offer => { const chosen = selected.includes(offer.id), isConfirmed = confirmed[offer.id] === fingerprint, evaluation = evaluations.get(offer.id), preview = evaluation?.result.success ? evaluation.result : null; return <article key={offer.id} className={`p-4 rounded-xl border min-w-0 ${chosen ? "bg-emerald-50 border-emerald-300" : "bg-white border-slate-200"}`}><span className="text-[10px] font-bold bg-sky-100 text-sky-800 rounded px-2 py-1">{labels[offer.type]}</span><h4 className="text-sm font-bold mt-2 break-words">{isAr && offer.nameAr ? offer.nameAr : offer.name}</h4><p className="text-xs text-slate-500">{offer.code}</p><div className="mt-3 text-xs bg-slate-100 rounded p-2">Eligible products: {preview?.paidLines.filter(line => line.appliedOfferIds.includes(offer.id)).map(line => line.productId).join(", ") || "Not applicable"}<br/>Gross eligible value: {money(preview?.appliedOffers[0]?.grossEligibleBase || 0)}<br/>Discount: {money(preview?.appliedOffers[0]?.discountAmount || 0)} · Free: {preview?.appliedOffers[0]?.freeQuantity || 0}</div><button onClick={() => setExpanded(expanded === offer.id ? null : offer.id)} className="mt-2 text-xs flex gap-1">Details <ChevronDown className="w-3 h-3"/></button>{expanded === offer.id && <div className="text-xs mt-2 overflow-x-auto">{preview?.appliedOffers[0]?.appliedTierBreakdown?.map((tier, index) => <div key={index}>Tier {tier.tierThreshold}→{tier.tierReward} × {tier.repetitions}</div>) || "Calculated with the shared MENAREPS Offers engine."}</div>}
        {!chosen ? <button onClick={() => toggle(offer.id)} className="w-full mt-3 py-2 bg-emerald-600 text-white rounded-lg text-xs font-semibold">Select for Preview</button> : <div className="mt-3 space-y-2">{isConfirmed ? <span className="text-xs font-semibold text-emerald-700 flex gap-1"><CheckCircle2 className="w-4 h-4"/>Confirmed</span> : <><p className="text-xs text-amber-700">Reconfirmation required before continuing with this Offer.</p><button onClick={() => confirm(offer.id)} className="w-full py-2 bg-emerald-600 text-white rounded-lg text-xs font-semibold">Confirm Offer</button></>}<button onClick={() => toggle(offer.id)} className="w-full py-1 text-rose-700 text-xs"><X className="inline w-3 h-3"/> Remove Offer (paid lines retained)</button>{preview?.freeLines.length ? <button onClick={() => removeBundle(offer.id)} className="w-full py-1 text-rose-800 text-xs"><Gift className="inline w-3 h-3"/> {bundleCandidate === offer.id ? "Confirm removal of paid and free promotional bundle" : "Remove Promotional Bundle…"}</button> : null}</div>}</article>; })}</div>}
    </div><aside className="bg-slate-900 text-white p-5 rounded-xl h-fit min-w-0"><h3 className="font-bold">Offer Preview</h3><div className="text-xs space-y-2 mt-4"><p>Product discounts <b className="float-right">{money(successful?.productDiscountTotal || 0)}</b></p><p>Invoice discounts <b className="float-right">{money(successful?.invoiceDiscountTotal || 0)}</b></p><p>Free quantity <b className="float-right">{successful?.freeLines.reduce((sum, line) => sum + line.quantity, 0) || 0}</b></p><p className="text-lg border-t border-slate-700 pt-3">Net subtotal <b className="float-right text-emerald-400">{money(successful?.netSubtotal ?? draft.order?.subtotalPreview ?? 0)}</b></p></div><div className="mt-4 bg-slate-800 p-3 rounded text-[11px] text-slate-300 flex gap-2"><Info className="w-4 h-4 shrink-0"/>Preview — recalculated at completion. No preview total is authoritative.</div></aside></div>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><button onClick={() => dispatch({ type: "SET_STEP", payload: 2 })} className="py-3 bg-slate-100 rounded-xl flex justify-center gap-2"><ArrowLeft className="w-4 h-4"/>Back to Products</button><button onClick={proceed} className="py-3 bg-emerald-600 text-white rounded-xl flex justify-center gap-2">Proceed to Payment <ChevronRight className="w-4 h-4"/></button></div>
  </div>;
};
