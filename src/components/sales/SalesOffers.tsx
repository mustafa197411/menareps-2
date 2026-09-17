import { formatCanonicalProductPrice, type ActorMarketContext } from "../../lib/operationalScopeClient";
import React, { useEffect, useRef, useState } from "react";
import { Calendar, ChevronDown, Edit3, Package, Plus, RefreshCw, Search, Tag, Trash2, X } from "lucide-react";
import type { OfferCapability } from "../../features/offers/types";
import { createAdminOfferDraft, getAdminOfferProducts, getAdminOfferRepresentatives, listAdminOffers, mutateAdminOffer, OfferAdminClientError, type OfferAdminReadRecord, type OfferProductOption, type OfferRepresentativeOption } from "../../lib/offerAdminClient";
import {
  OFFER_TYPES, canonicalDraftFromForm, defaultOfferForm, hydrateOfferForm, isLegacyOffer,
  offerSummary, offerTypeLabel, resetIncompatibleFields, serializeOfferForm, setRewardMode, validateOfferForm,
  type OfferAdminRecord, type OfferAdminType, type OfferFormState,
} from "./offerAdminModel";

interface SalesOffersProps { lang: "en" | "ar" }
type UiProduct = OfferProductOption;

const typeLabels: Record<OfferAdminType, { en: string; ar: string }> = {
  PRODUCT_PERCENTAGE: { en: "Product Percentage Discount", ar: "خصم مئوي على المنتجات" },
  INVOICE_PERCENTAGE: { en: "Total Invoice Percentage Discount", ar: "خصم مئوي على إجمالي الفاتورة" },
  BUY_X_GET_Y: { en: "Buy X Get Y", ar: "اشترِ X واحصل على Y" },
  TIER_BONUS: { en: "Tier Bonus", ar: "مكافأة الشرائح" },
};

const capabilityNames = ["offers.view", "offers.create", "offers.editDraft", "offers.submit", "offers.approve", "offers.activate", "offers.pause", "offers.cancel", "offers.viewAudit", "offers.applyDuringVisit"] as const;
const emptyCapabilities = Object.fromEntries(capabilityNames.map(capability => [capability, false])) as Record<OfferCapability, boolean>;

function adminRecord(record: OfferAdminReadRecord): OfferAdminRecord {
  if (record.kind === "LEGACY") return { id: record.offer.id, name: record.offer.name, description: "Read-only historical offer", type: record.offer.legacyTypeLabel, startDate: "—", endDate: "—" };
  const offer = record.offer, reward = "reward" in offer.benefit ? offer.benefit.reward : undefined;
  return {
    id: offer.id, name: offer.name, description: offer.description || "", type: offer.type, productScope: offer.productScope.mode,
    productIds: offer.productScope.productIds, percentage: "percentage" in offer.benefit ? offer.benefit.percentage : undefined,
    buyQuantity: "buyQuantity" in offer.benefit ? offer.benefit.buyQuantity : undefined,
    getQuantity: "freeQuantity" in offer.benefit ? offer.benefit.freeQuantity : undefined,
    tiers: "tiers" in offer.benefit ? offer.benefit.tiers : undefined, rewardMode: reward?.mode,
    rewardProductId: reward?.mode === "SELECTED_PRODUCT" ? reward.rewardProductId : undefined,
    aggregationMode: "aggregationMode" in offer.benefit ? offer.benefit.aggregationMode : undefined,
    tierApplicationMode: offer.type === "TIER_BONUS" ? offer.benefit.applicationMode : undefined,
    startDate: offer.eligibility.startAt.slice(0, 10), endDate: offer.eligibility.endAt.slice(0, 10), isActive: offer.lifecycleStatus === "ACTIVE",
    lifecycleStatus: offer.lifecycleStatus, revision: offer.revision, canonical: offer,
  };
}

function FieldError({ children }: { children?: string }) {
  return children ? <p role="alert" className="mt-1 text-xs font-medium text-rose-600">{children}</p> : null;
}

export default function SalesOffers({ lang }: SalesOffersProps) {
  const rtl = lang === "ar";
  const [offers, setOffers] = useState<OfferAdminRecord[]>([]);
  const [capabilities, setCapabilities] = useState<Record<OfferCapability, boolean>>(emptyCapabilities);
  const [loading, setLoading] = useState(true);
  const [requestError, setRequestError] = useState("");
  const [marketContext, setMarketContext] = useState<ActorMarketContext>({ status: "UNRESOLVED" });
  const [eligibleProducts, setEligibleProducts] = useState<UiProduct[]>([]);
  const productRequest = useRef(0);
  const representativeRequest = useRef(0);
  const [productLoading, setProductLoading] = useState(false);
  const [productContinuation, setProductContinuation] = useState<string>();
  const [representatives, setRepresentatives] = useState<OfferRepresentativeOption[]>([]);
  const [repContinuation, setRepContinuation] = useState<string>();
  const [repLoading, setRepLoading] = useState(false);
  const [offerContinuation, setOfferContinuation] = useState<string>();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [form, setForm] = useState<OfferFormState | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [productQuery, setProductQuery] = useState("");
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [confirmAllProducts, setConfirmAllProducts] = useState(false);
  const load = async (continuation?: string) => {
    setLoading(true); setRequestError("");
    try {
      const response = await listAdminOffers({ continuation }); setCapabilities(response.capabilities); setOffers(response.offers.map(adminRecord)); setOfferContinuation(response.continuation);

    }
    catch (error) { setRequestError(error instanceof OfferAdminClientError ? error.code : "OFFER_READ_FAILED"); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const visibleOffers = offers.filter(offer => {
    const text = `${offer.name} ${offer.description} ${offerTypeLabel(offer.type)}`.toLowerCase();
    return text.includes(query.toLowerCase()) && (filter === "ALL" || offer.type === filter || (filter === "LEGACY" && isLegacyOffer(offer.type)));
  });
  const visibleProducts = eligibleProducts.filter(product => product.name.toLowerCase().includes(productQuery.toLowerCase()));
  const selectedProducts = form ? form.productIds.map(id => ({ id, name: eligibleProducts.find(product => product.id === id)?.name ?? id })) : [];

  const loadProducts = async (continuation?: string, offerId?: string) => {
    const request = ++productRequest.current;
    setProductLoading(true);
    try {
      const page = await getAdminOfferProducts(continuation, offerId);
      if (request !== productRequest.current) return;
      setEligibleProducts(current => continuation ? [...current, ...page.products] : page.products);
      setProductContinuation(page.continuation); setMarketContext(page.marketContext);
    } catch (error) {
      if (request === productRequest.current) setErrors(current => ({ ...current, productOptions: error instanceof OfferAdminClientError ? error.code : "OFFER_READ_FAILED" }));
    } finally { if (request === productRequest.current) setProductLoading(false); }
  };
  const loadRepresentatives = async (offerId?: string, continuationToken?: string) => {
    const request = ++representativeRequest.current;
    setRepLoading(true);
    try {
      const page = await getAdminOfferRepresentatives({ offerId, continuationToken });
      if (request !== representativeRequest.current) return;
      setRepresentatives(current => continuationToken ? [...current, ...page.representatives] : page.representatives);
      setRepContinuation(page.continuationToken);
    } catch (error) {
      if (request === representativeRequest.current) {
        setRepContinuation(undefined);
        setErrors(current => ({ ...current, representativeOptions: error instanceof OfferAdminClientError ? error.code : "OFFER_READ_FAILED" }));
      }
    } finally { if (request === representativeRequest.current) setRepLoading(false); }
  };
  const resetOptions = () => {
    ++productRequest.current; ++representativeRequest.current;
    setMarketContext({ status: "UNRESOLVED" }); setEligibleProducts([]); setProductContinuation(undefined); setProductLoading(false);
    setRepresentatives([]); setRepContinuation(undefined); setRepLoading(false);
    setErrors({}); setProductQuery(""); setProductPickerOpen(false);
  };
  const openCreate = () => { resetOptions(); setForm(defaultOfferForm()); void loadProducts(); };
  const openEdit = (offer: OfferAdminRecord) => {
    const result = hydrateOfferForm(offer); if (!result.editable) return;
    resetOptions(); setForm(result.form); void loadProducts(undefined, offer.id);
    if (result.form.audienceType === "SELECTED_SALES_REPRESENTATIVES") void loadRepresentatives(offer.id);
  };
  const closeForm = () => { resetOptions(); setForm(null); setConfirmAllProducts(false); };
  const update = <K extends keyof OfferFormState>(key: K, value: OfferFormState[K]) => setForm(current => current ? { ...current, [key]: value } : current);
  const setScope = (scope: OfferFormState["productScope"]) => {
    if (!form) return;
    if (scope === "ALL_PRODUCTS" && form.productIds.length) { setConfirmAllProducts(true); return; }
    setForm({ ...form, productScope: scope, productIds: scope === "ALL_PRODUCTS" ? [] : form.productIds });
  };
  const changeType = (type: OfferAdminType) => { if (form) setForm(resetIncompatibleFields(form, type)); setErrors({}); };
  const toggleProduct = (id: string) => {
    if (!form) return;
    const productIds = form.productIds.includes(id) ? form.productIds.filter(value => value !== id) : [...form.productIds, id];
    setForm({ ...form, productIds: [...new Set(productIds)] });
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (!form) return;
    const nextErrors = validateOfferForm(form); setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    try {
      if (form.id) await mutateAdminOffer({ action: "UPDATE_DRAFT", offerId: form.id, expectedRevision: offers.find(item => item.id === form.id)?.revision, definition: canonicalDraftFromForm(form) });
      else await createAdminOfferDraft(canonicalDraftFromForm(form));
      closeForm(); await load();
    } catch (error) { setRequestError(error instanceof OfferAdminClientError ? error.code : "OFFER_WRITE_FAILED"); }
  };
  const lifecycleAction = async (offer: OfferAdminRecord, action: LifecycleAction) => {
    if (!offer.revision || isLegacyOffer(offer.type)) return;
    let reason: string | undefined;
    if (action === "CANCEL") { reason = window.prompt(rtl ? "سبب الإلغاء" : "Cancellation reason")?.trim(); if (!reason) return; }
    try { await mutateAdminOffer({ action, offerId: offer.id, expectedRevision: offer.revision, ...(reason ? { reason } : {}) }); await load(); }
    catch (error) { setRequestError(error instanceof OfferAdminClientError && error.code === "OFFER_STALE_REVISION" ? "OFFER_STALE_REVISION_REFRESH" : error instanceof OfferAdminClientError ? error.code : "OFFER_WRITE_FAILED"); }
  };

  return <div dir={rtl ? "rtl" : "ltr"} className="offer-admin-page min-w-0 space-y-5 overflow-x-clip">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div><h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900 dark:text-white"><Tag className="h-6 w-6 text-indigo-600" />{rtl ? "العروض" : "Offers"}</h1><p className="mt-1 text-sm text-slate-500">{rtl ? "إدارة قواعد العروض ونطاق المنتجات" : "Administer offer rules and product scope"}</p></div>
      {capabilities["offers.create"] && <button onClick={openCreate} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"><Plus size={17} />{rtl ? "إضافة عرض" : "Add Offer"}</button>}
    </header>

    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Statistics for this page">
      {[[rtl ? "عروض هذه الصفحة" : "Offers on this page", offers.length], [rtl ? "نشطة في هذه الصفحة" : "Active on this page", offers.filter(o => o.isActive ?? o.status).length], [rtl ? "كل المنتجات في هذه الصفحة" : "All Products on this page", offers.filter(o => !(o.productIds?.length || o.productId)).length], [rtl ? "قديمة في هذه الصفحة" : "Legacy on this page", offers.filter(o => isLegacyOffer(o.type)).length]].map(([label, value]) => <div key={String(label)} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"><div className="text-2xl font-bold text-slate-900 dark:text-white">{value}</div><div className="text-xs text-slate-500">{label}</div></div>)}
    </section>

    {requestError && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"><span>{requestError === "OFFER_PERMISSION_DENIED" ? "You do not have permission to administer Offers." : requestError === "OFFER_STALE_REVISION_REFRESH" ? "This Offer changed. Refresh before trying again." : `Unable to complete the Offer request (${requestError}).`}</span><button type="button" onClick={() => void load()} className="flex items-center gap-2 rounded-lg border border-rose-300 px-3 py-2 font-semibold"><RefreshCw size={14}/>Retry</button></div>}
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row dark:border-slate-800">
        <label className="relative min-w-0 flex-1"><span className="sr-only">{rtl ? "بحث" : "Search this page"}</span><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><input value={query} onChange={e => setQuery(e.target.value)} placeholder={rtl ? "بحث في هذه الصفحة" : "Search this page"} className="min-h-10 w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-950" /></label>
        <label><span className="sr-only">{rtl ? "نوع العرض" : "Filter by offer type"}</span><select value={filter} onChange={e => setFilter(e.target.value)} className="min-h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm dark:border-slate-700 dark:bg-slate-950 sm:w-64"><option value="ALL">{rtl ? "كل الأنواع" : "All offer types"}</option>{OFFER_TYPES.map(type => <option key={type} value={type}>{typeLabels[type][lang]}</option>)}<option value="LEGACY">{rtl ? "عروض قديمة" : "Legacy offers"}</option></select></label>
      </div>
      {loading ? <div className="px-4 py-16 text-center text-sm text-slate-500">Loading Offers…</div> : !visibleOffers.length ? <div className="px-4 py-16 text-center"><Package className="mx-auto mb-3 text-slate-300" size={38} /><h2 className="font-semibold text-slate-800 dark:text-white">{rtl ? "لا توجد عروض" : "No offers found"}</h2><p className="mt-1 text-sm text-slate-500">{rtl ? "لا توجد نتائج في هذه الصفحة. تابع إلى الصفحة التالية إن توفرت." : "No matching Offers on this page. Continue to the next page when available."}</p></div> : <>
        <div className="hidden overflow-x-auto lg:block"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-950"><tr><th className="p-4">{rtl ? "العرض" : "Offer"}</th><th className="p-4">{rtl ? "النوع" : "Type"}</th><th className="p-4">{rtl ? "نطاق المنتج" : "Product scope"}</th><th className="p-4">{rtl ? "ملخص القاعدة" : "Rule summary"}</th><th className="p-4">{rtl ? "الصلاحية" : "Validity"}</th><th className="p-4">{rtl ? "الحالة" : "Status"}</th><th className="p-4">{rtl ? "الإجراءات" : "Actions"}</th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-800">{visibleOffers.map(offer => <OfferRow key={offer.id} offer={offer} rtl={rtl} capabilities={capabilities} onEdit={openEdit} onAction={lifecycleAction} />)}</tbody></table></div>
        <div className="space-y-3 p-3 lg:hidden">{visibleOffers.map(offer => <OfferCard key={offer.id} offer={offer} rtl={rtl} capabilities={capabilities} onEdit={openEdit} onAction={lifecycleAction} />)}</div>
      </>}
    </section>
    <div className="flex gap-3"><button disabled={loading} onClick={() => void load()}>First page</button>{offerContinuation && <button disabled={loading} onClick={() => void load(offerContinuation)}>Next page</button>}</div>

    {form && <div className="fixed inset-0 z-50 bg-slate-950/65 sm:p-4" role="presentation">
      <div role="dialog" aria-modal="true" aria-labelledby="offer-form-title" className="flex h-full w-full flex-col overflow-hidden bg-white dark:bg-slate-900 sm:mx-auto sm:max-h-[calc(100vh-2rem)] sm:max-w-4xl sm:rounded-2xl sm:border sm:border-slate-200 dark:sm:border-slate-800">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800 sm:px-6"><div><h2 id="offer-form-title" className="font-bold text-slate-900 dark:text-white">{form.id ? (rtl ? "تعديل العرض" : "Edit Offer") : (rtl ? "إضافة عرض" : "Add Offer")}</h2><p className="text-xs text-slate-500">{rtl ? "حقول واضحة ومراجعة قبل الحفظ" : "Complete each section and review before saving"}</p></div><button onClick={closeForm} aria-label="Close offer form" className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800"><X size={20} /></button></div>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain p-4 pb-28 sm:p-6 sm:pb-6">
            <FormSection number="1" title={rtl ? "المعلومات الأساسية" : "Basic Information"}><div className="grid gap-4 md:grid-cols-2"><Labeled label={rtl ? "رمز العرض" : "Offer code"} error={errors.code}><input value={form.code} onChange={e => update("code", e.target.value)} className="field" /></Labeled><Labeled label={rtl ? "اسم العرض" : "Offer name"} error={errors.name}><input value={form.name} onChange={e => update("name", e.target.value)} className="field" /></Labeled><Labeled label={rtl ? "الوصف" : "Description"}><textarea rows={2} value={form.description} onChange={e => update("description", e.target.value)} className="field resize-y" /></Labeled></div></FormSection>
            <FormSection number="2" title={rtl ? "نوع العرض" : "Offer Type"}><div className="grid gap-2 sm:grid-cols-2">{OFFER_TYPES.map(type => <label key={type} className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm ${form.type === type ? "border-indigo-500 bg-indigo-50 text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-200" : "border-slate-200 dark:border-slate-700"}`}><input type="radio" name="offerType" checked={form.type === type} onChange={() => changeType(type)} />{typeLabels[type][lang]}</label>)}</div></FormSection>
            <FormSection number="3" title={rtl ? "نطاق المنتج" : "Product Scope"}><div className="grid gap-2 sm:grid-cols-2"><ScopeRadio label={rtl ? "كل المنتجات" : "All Products"} checked={form.productScope === "ALL_PRODUCTS"} onChange={() => setScope("ALL_PRODUCTS")} /><ScopeRadio label={rtl ? "منتجات محددة" : "Selected Products"} checked={form.productScope === "SELECTED_PRODUCTS"} onChange={() => setScope("SELECTED_PRODUCTS")} /></div>{form.productScope === "SELECTED_PRODUCTS" && <div className="mt-4"><button type="button" onClick={() => setProductPickerOpen(value => !value)} className="field flex items-center justify-between text-left disabled:opacity-50"><span>{rtl ? "ابحث واختر المنتجات" : "Search and select products"}</span><ChevronDown size={17} /></button>{productPickerOpen && <div className="mt-2 max-w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-950"><label className="block p-2"><span className="sr-only">Search products</span><input autoFocus value={productQuery} onChange={e => setProductQuery(e.target.value)} placeholder={rtl ? "اسم المنتج" : "Product name"} className="field" /></label><div className="max-h-52 overflow-y-auto p-2">{visibleProducts.map(product => <label key={product.id} className="flex cursor-pointer items-center gap-3 rounded-lg p-2 hover:bg-slate-50 dark:hover:bg-slate-800"><input type="checkbox" checked={form.productIds.includes(product.id)} onChange={() => toggleProduct(product.id)} /><span className="block min-w-0 truncate text-sm font-medium">{product.name} · {formatCanonicalProductPrice(product.price, marketContext)}</span></label>)}</div>{productContinuation && <button type="button" disabled={productLoading} onClick={() => void loadProducts(productContinuation, form.id)}>More products</button>}</div>}<div className="mt-3 flex flex-wrap gap-2">{selectedProducts.map(product => <span key={product.id} className="inline-flex max-w-full items-center gap-2 rounded-full bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-200"><span className="truncate">{product.name}</span><button type="button" onClick={() => toggleProduct(product.id)} aria-label={`Remove ${product.name}`}><X size={14} /></button></span>)}</div><FieldError>{errors.products}</FieldError></div>}</FormSection>
            <div><FieldError>{errors.productOptions}</FieldError><button type="button" disabled={productLoading} onClick={() => void loadProducts()}>{rtl ? "تحديث المنتجات" : "Refresh products"}</button>{productContinuation && <button type="button" disabled={productLoading} onClick={() => void loadProducts(productContinuation, form.id)} className="mx-3">{rtl ? "المزيد من المنتجات" : "More products"}</button>}</div>
            <FormSection number="4" title={rtl ? "قواعد العرض" : "Offer Rules"}>{(form.type === "PRODUCT_PERCENTAGE" || form.type === "INVOICE_PERCENTAGE") && <Labeled label={form.type === "PRODUCT_PERCENTAGE" ? (rtl ? "نسبة الخصم" : "Percentage discount") : (rtl ? "نسبة خصم الفاتورة" : "Invoice discount percentage")} error={errors.percentage}><input type="number" min="0" max="100" step="any" value={form.percentage} onChange={e => update("percentage", e.target.value)} className="field" /></Labeled>}{form.type === "BUY_X_GET_Y" && <div className="grid gap-4 sm:grid-cols-2"><Labeled label={rtl ? "كمية الشراء" : "Buy quantity"} error={errors.buyQuantity}><input inputMode="numeric" value={form.buyQuantity} onChange={e => update("buyQuantity", e.target.value)} className="field" /></Labeled><Labeled label={rtl ? "الكمية المجانية" : "Free quantity"} error={errors.freeQuantity}><input inputMode="numeric" value={form.freeQuantity} onChange={e => update("freeQuantity", e.target.value)} className="field" /></Labeled></div>}{form.type === "TIER_BONUS" && <TierEditor form={form} setForm={setForm} errors={errors} rtl={rtl} />}{(form.type === "BUY_X_GET_Y" || form.type === "TIER_BONUS") && <RewardControls marketContext={marketContext} form={form} setForm={setForm} products={eligibleProducts} error={errors.rewardProductId} rtl={rtl} />}</FormSection>
            <FormSection number="5" title={rtl ? "الصلاحية والجمهور" : "Validity and audience"}>
              <div className="grid gap-4 sm:grid-cols-2"><Labeled label={rtl ? "تاريخ البدء" : "Start date"} error={errors.startDate}><input type="date" value={form.startDate} onChange={e => update("startDate", e.target.value)} className="field" /></Labeled><Labeled label={rtl ? "تاريخ الانتهاء" : "End date"} error={errors.endDate}><input type="date" value={form.endDate} onChange={e => update("endDate", e.target.value)} className="field" /></Labeled></div>
              <Labeled label="Who Can Use This Offer?" error={errors.audience}><select className="field" value={form.audienceType} onChange={event => { const audienceType = event.target.value as OfferFormState["audienceType"]; ++representativeRequest.current; setRepLoading(false); setForm({ ...form, audienceType, audienceUserIds: [] }); setRepresentatives([]); setRepContinuation(undefined); if (audienceType === "SELECTED_SALES_REPRESENTATIVES") void loadRepresentatives(form.id); }}>
                <option value="">Choose audience</option><option value="ALL_SALES_REPRESENTATIVES">All Sales Representatives</option><option value="MY_SALES_TEAM">My Sales Team</option><option value="SELECTED_SALES_REPRESENTATIVES">Selected Sales Representatives</option>
              </select></Labeled>
              {form.audienceType === "SELECTED_SALES_REPRESENTATIVES" && <div>
                <FieldError>{errors.representativeOptions}</FieldError>
                <div className="flex flex-wrap gap-2">{form.audienceUserIds.map(id => <button type="button" key={id} onClick={() => update("audienceUserIds", form.audienceUserIds.filter(value => value !== id))}>{representatives.find(user => user.id === id)?.name || id} ×</button>)}</div>
                {representatives.map(user => <label key={user.id} className="flex gap-2 p-2"><input type="checkbox" checked={form.audienceUserIds.includes(user.id)} onChange={() => update("audienceUserIds", form.audienceUserIds.includes(user.id) ? form.audienceUserIds.filter(id => id !== user.id) : [...form.audienceUserIds, user.id])} />{user.name}</label>)}
                {repLoading && <p>Loading representatives…</p>}
                <button type="button" disabled={repLoading} onClick={() => void loadRepresentatives(form.id)}>Refresh representatives</button>
                {repContinuation && <button type="button" disabled={repLoading} onClick={() => void loadRepresentatives(form.id, repContinuation)}>More representatives</button>}
              </div>}
            </FormSection>
            <FormSection number="6" title={rtl ? "الحالة" : "Status"}><p className="text-sm text-slate-500">{rtl ? "يتم إنشاء العرض كمسودة. تتم إدارة دورة الحياة من قائمة العروض." : "Offers are created as Draft. Lifecycle actions are managed from the Offers list."}</p></FormSection>
            <FormSection number="7" title={rtl ? "ملخص المراجعة" : "Review Summary"}><div className="rounded-xl bg-indigo-50 p-4 text-sm font-semibold text-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-100">{offerSummary(serializeOfferForm(form))}</div></FormSection>
          </div>
          <div className="sticky bottom-0 flex shrink-0 gap-3 border-t border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:justify-end"><button type="button" onClick={closeForm} className="min-h-11 flex-1 rounded-xl border border-slate-300 px-5 text-sm font-semibold sm:flex-none">{rtl ? "إلغاء" : "Cancel"}</button><button type="submit" className="min-h-11 flex-1 rounded-xl bg-indigo-600 px-5 text-sm font-semibold text-white sm:flex-none">{rtl ? "حفظ العرض" : "Save Offer"}</button></div>
        </form>
      </div>
    </div>}
    {confirmAllProducts && form && <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/60 p-4"><div role="alertdialog" aria-modal="true" className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl dark:bg-slate-900"><h2 className="font-bold">{rtl ? "مسح المنتجات المحددة؟" : "Clear selected products?"}</h2><p className="mt-2 text-sm text-slate-500">{rtl ? "سيؤدي التغيير إلى كل المنتجات إلى مسح اختيارات المنتجات الحالية." : "Switching to All Products clears the current product selections."}</p><div className="mt-5 flex gap-3"><button onClick={() => setConfirmAllProducts(false)} className="min-h-10 flex-1 rounded-xl border">{rtl ? "رجوع" : "Keep selections"}</button><button onClick={() => { setForm({ ...form, productScope: "ALL_PRODUCTS", productIds: [] }); setConfirmAllProducts(false); }} className="min-h-10 flex-1 rounded-xl bg-indigo-600 text-white">{rtl ? "مسح ومتابعة" : "Clear and continue"}</button></div></div></div>}
  </div>;
}

function Labeled({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) { return <label className="block min-w-0"><span className="mb-1.5 block text-xs font-bold text-slate-600 dark:text-slate-300">{label}</span>{children}<FieldError>{error}</FieldError></label>; }
function FormSection({ number, title, children }: { number: string; title: string; children: React.ReactNode }) { return <section className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800"><h3 className="mb-4 flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white"><span className="grid h-6 w-6 place-items-center rounded-full bg-indigo-100 text-xs text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">{number}</span>{title}</h3>{children}</section>; }
function ScopeRadio({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) { return <label className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm ${checked ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40" : "border-slate-200 dark:border-slate-700"}`}><input type="radio" name="productScope" checked={checked} onChange={onChange} />{label}</label>; }

function TierEditor({ form, setForm, errors, rtl }: { form: OfferFormState; setForm: React.Dispatch<React.SetStateAction<OfferFormState | null>>; errors: Record<string, string>; rtl: boolean }) {
  const updateTier = (index: number, key: "buyQuantity" | "freeQuantity", value: string) => setForm(current => current ? { ...current, tiers: current.tiers.map((tier, i) => i === index ? { ...tier, [key]: value } : tier) } : current);
  return <div className="space-y-3">{form.tiers.map((tier, index) => <div key={index} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700"><div className="mb-3 flex items-center justify-between"><h4 className="text-sm font-bold">{rtl ? `الشريحة ${index + 1}` : `Tier ${index + 1}`}</h4><button type="button" disabled={form.tiers.length === 1} onClick={() => setForm(current => current ? { ...current, tiers: current.tiers.filter((_, i) => i !== index) } : current)} aria-label={`Remove tier ${index + 1}`} className="rounded-lg p-2 text-rose-600 disabled:opacity-30"><Trash2 size={16} /></button></div><div className="grid gap-3 sm:grid-cols-2"><Labeled label={rtl ? "كمية الشراء" : "Buy quantity"}><input inputMode="numeric" value={tier.buyQuantity} onChange={e => updateTier(index, "buyQuantity", e.target.value)} className="field" /></Labeled><Labeled label={rtl ? "الكمية المجانية" : "Free quantity"}><input inputMode="numeric" value={tier.freeQuantity} onChange={e => updateTier(index, "freeQuantity", e.target.value)} className="field" /></Labeled></div><FieldError>{errors[`tier-${index}`]}</FieldError></div>)}<FieldError>{errors.tiers}</FieldError><button type="button" disabled={form.tiers.length >= 5} onClick={() => setForm(current => current ? { ...current, tiers: [...current.tiers, { buyQuantity: "", freeQuantity: "" }] } : current)} className="flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-indigo-400 text-sm font-semibold text-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"><Plus size={16} />{rtl ? "إضافة شريحة" : "Add Tier"} ({form.tiers.length}/5)</button></div>;
}

function RewardControls({ form, setForm, products, error, rtl, marketContext }: { marketContext: ActorMarketContext; form: OfferFormState; setForm: React.Dispatch<React.SetStateAction<OfferFormState | null>>; products: UiProduct[]; error?: string; rtl: boolean }) {
  const updateRewardMode = (mode: OfferFormState["rewardMode"]) => setForm(current => current ? setRewardMode(current, mode) : current);
  return <div className="mt-4 grid gap-4 sm:grid-cols-2"><Labeled label={rtl ? "نوع المنتج المجاني" : "Reward product mode"}><select value={form.rewardMode} onChange={event => updateRewardMode(event.target.value as OfferFormState["rewardMode"])} className="field"><option value="SAME_AS_TRIGGER">{rtl ? "نفس المنتج المؤهل" : "Same as trigger product"}</option><option value="SELECTED_PRODUCT">{rtl ? "منتج محدد" : "Selected product"}</option></select></Labeled>{form.rewardMode === "SELECTED_PRODUCT" && <Labeled label={rtl ? "المنتج المجاني" : "Reward product"} error={error}><select value={form.rewardProductId} onChange={event => setForm(current => current ? { ...current, rewardProductId: event.target.value } : current)} className="field"><option value="">{rtl ? "اختر منتجاً" : "Select product"}</option>{form.rewardProductId && !products.some(product => product.id === form.rewardProductId) && <option value={form.rewardProductId}>{form.rewardProductId}</option>}{products.map(product => <option key={product.id} value={product.id}>{product.name} · {formatCanonicalProductPrice(product.price, marketContext)}</option>)}</select></Labeled>}<Labeled label={rtl ? "تجميع الكمية" : "Quantity aggregation"}><select value={form.aggregationMode} onChange={event => setForm(current => current ? { ...current, aggregationMode: event.target.value as OfferFormState["aggregationMode"] } : current)} className="field"><option value="PER_PRODUCT">{rtl ? "لكل منتج" : "Per product"}</option><option value="ACROSS_ELIGIBLE_PRODUCTS">{rtl ? "عبر المنتجات المؤهلة" : "Across eligible products"}</option></select></Labeled></div>;
}

const scopeLabel = (offer: OfferAdminRecord) => { const count = offer.productIds?.length || (offer.productId ? 1 : 0); return count ? `${count} selected product${count === 1 ? "" : "s"}` : "All Products"; };
type LifecycleAction = "SUBMIT" | "RETURN_TO_DRAFT" | "APPROVE" | "ACTIVATE" | "PAUSE" | "REACTIVATE" | "CANCEL";
type OfferActionsProps = { offer: OfferAdminRecord; rtl: boolean; capabilities: Record<OfferCapability, boolean>; onEdit: (offer: OfferAdminRecord) => void; onAction: (offer: OfferAdminRecord, action: LifecycleAction) => void };
function OfferActions({ offer, rtl, capabilities, onEdit, onAction }: OfferActionsProps) {
  const legacy = isLegacyOffer(offer.type), status = offer.lifecycleStatus;
  if (legacy) return <span className="text-xs text-amber-700">{rtl ? "قديم للقراءة" : "Legacy · read only"}</span>;
  const actions: Array<[LifecycleAction, OfferCapability, string]> = [];
  if (status === "DRAFT") actions.push(["SUBMIT", "offers.submit", "Submit"]);
  if (status === "PENDING_APPROVAL") actions.push(["RETURN_TO_DRAFT", "offers.approve", "Return"]);
  if (status === "PENDING_APPROVAL") actions.push(["APPROVE", "offers.approve", "Approve"]);
  if (status === "SCHEDULED") actions.push(["ACTIVATE", "offers.activate", "Activate"]);
  if (status === "ACTIVE") actions.push(["PAUSE", "offers.pause", "Pause"]);
  if (status === "PAUSED") actions.push(["REACTIVATE", "offers.activate", "Reactivate"]);
  if (status === "ACTIVE" || status === "PAUSED" || status === "SCHEDULED") actions.push(["CANCEL", "offers.cancel", "Cancel"]);
  return <div className="flex flex-wrap gap-1">{status === "DRAFT" && capabilities["offers.editDraft"] && <button onClick={() => onEdit(offer)} aria-label={`Edit ${offer.name}`} className="rounded-lg border p-2 text-indigo-600"><Edit3 size={15}/></button>}{actions.filter(([, capability]) => capabilities[capability]).map(([action, , label]) => <button key={action} onClick={() => onAction(offer, action)} className="rounded-lg border px-2 py-1 text-xs font-semibold">{label}</button>)}</div>;
}
function OfferRow({ offer, rtl, capabilities, onEdit, onAction }: OfferActionsProps & { key?: React.Key }) { const legacy = isLegacyOffer(offer.type); return <tr><td className="p-4"><div className="font-semibold text-slate-900 dark:text-white">{offer.name}</div><div className="max-w-xs truncate text-xs text-slate-500">{offer.description}</div></td><td className="p-4"><span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">{offerTypeLabel(offer.type)}</span>{legacy && <span className="ml-1 text-[10px] text-amber-600">Legacy</span>}</td><td className="p-4">{scopeLabel(offer)}</td><td className="p-4">{offerSummary(offer)}</td><td className="p-4 text-xs"><Calendar className="mr-1 inline h-3 w-3" />{offer.startDate} – {offer.endDate}</td><td className="p-4"><span className={`rounded-full px-2 py-1 text-xs ${legacy ? "bg-amber-100 text-amber-700" : offer.lifecycleStatus === "ACTIVE" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{legacy ? "Legacy · read only" : offer.lifecycleStatus}</span></td><td className="p-4"><OfferActions offer={offer} rtl={rtl} capabilities={capabilities} onEdit={onEdit} onAction={onAction}/></td></tr>; }
function OfferCard({ offer, rtl, capabilities, onEdit, onAction }: OfferActionsProps & { key?: React.Key }) { const legacy = isLegacyOffer(offer.type); return <article className="min-w-0 rounded-xl border border-slate-200 p-4 dark:border-slate-700"><div className="flex min-w-0 items-start justify-between gap-3"><div className="min-w-0"><h2 className="truncate font-semibold">{offer.name}</h2><p className="mt-1 text-xs text-indigo-600">{offerTypeLabel(offer.type)}{legacy ? " · Legacy" : ""}</p></div><span className={`shrink-0 rounded-full px-2 py-1 text-[10px] ${legacy ? "bg-amber-100 text-amber-700" : offer.lifecycleStatus === "ACTIVE" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100"}`}>{legacy ? "Legacy · read only" : offer.lifecycleStatus}</span></div><dl className="mt-4 grid gap-3 text-xs"><div><dt className="text-slate-500">{rtl ? "نطاق المنتج" : "Product scope"}</dt><dd className="font-medium">{scopeLabel(offer)}</dd></div><div><dt className="text-slate-500">{rtl ? "الملخص" : "Summary"}</dt><dd className="break-words font-medium">{offerSummary(offer)}</dd></div><div><dt className="text-slate-500">{rtl ? "الصلاحية" : "Validity"}</dt><dd>{offer.startDate} – {offer.endDate}</dd></div></dl><div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800"><OfferActions offer={offer} rtl={rtl} capabilities={capabilities} onEdit={onEdit} onAction={onAction}/></div></article>; }
