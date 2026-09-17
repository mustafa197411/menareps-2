import React, { useEffect, useState, useMemo } from "react";
import { Product, User, UserProductAssignment } from "../../../types";
import {
  PharmacyVisitDraft,
  PharmacyOrderLine,
  PharmacyOrderInputSource,
  AiOrderParsedLine,
  OrderImageAttachment,
  OrderImageExtractionResult,
  ProductResolutionCandidate
} from "../types/domain";
import { getEligibleProductsForRep } from "../services/pharmacyProductEligibility";
import { parseQuickAddInput } from "../services/quickAddParser";
import { processOrderImageAttachment, validateImageFile } from "../services/orderImageAdapter";
import { validateStep2OrderDraft } from "../validation/validateStep2";
import { readPharmacyProductAvailability } from "../../../lib/pharmacyProductAvailabilityClient";
import type { ProductAvailability } from "../types/productAvailability";
import { unresolvedAvailability } from "../types/productAvailability";
import {
  Search,
  Plus,
  Minus,
  Trash2,
  Sparkles,
  Camera,
  Upload,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  XCircle,
  FileText,
  ArrowRight,
  ArrowLeft,
  RefreshCw,
  ShoppingBag,
  Info,
  Check
} from "lucide-react";

interface Step2OrderItemsProps {
  currentUser: User;
  draft: PharmacyVisitDraft;
  products: Product[];
  userProductAssignments: UserProductAssignment[];
  onAddOrderLine: (line: PharmacyOrderLine) => void;
  onSetProductAvailability: (availability: ProductAvailability[]) => void;
  onUpdateLineQuantity: (lineId: string, quantity: number) => void;
  onRemoveOrderLine: (lineId: string) => void;
  onSetAiParseResult: (result: any) => void;
  onConfirmAiLine: (lineId: string, confirmedLine: PharmacyOrderLine) => void;
  onSetImageAttachment: (attachment: OrderImageAttachment) => void;
  onSetExtractionResult: (result: OrderImageExtractionResult) => void;
  onClearOrder: () => void;
  onProceedToStep3: () => void;
  onBackToStep1: () => void;
  lang: "en" | "ar";
}

export const Step2OrderItems: React.FC<Step2OrderItemsProps> = ({
  currentUser,
  draft,
  products = [],
  userProductAssignments = [],
  onAddOrderLine,
  onSetProductAvailability,
  onUpdateLineQuantity,
  onRemoveOrderLine,
  onSetAiParseResult,
  onConfirmAiLine,
  onSetImageAttachment,
  onSetExtractionResult,
  onClearOrder,
  onProceedToStep3,
  onBackToStep1,
  lang
}) => {
  const isRtl = lang === "ar";

  // 1. Compute Authorized Eligible Products for Rep
  const eligibilityReport = useMemo(() => {
    return getEligibleProductsForRep(currentUser.id, userProductAssignments, products);
  }, [currentUser.id, userProductAssignments, products]);

  const eligibleProducts = eligibilityReport.eligibleProducts;

  // Active sub-tab mode: "MANUAL" | "AI_QUICK_ADD" | "IMAGE_CAPTURE"
  const [activeTab, setActiveTab] = useState<PharmacyOrderInputSource>("MANUAL");

  // Manual Selection Local State
  const [searchQuery, setSearchQuery] = useState("");
  const [availabilityByProduct, setAvailabilityByProduct] = useState<Map<string, ProductAvailability>>(new Map());
  const [availabilityLoading, setAvailabilityLoading] = useState(false);

  // AI Quick Add Local State
  const [quickAddText, setQuickAddText] = useState("");
  const [isParsingText, setIsParsingText] = useState(false);
  const [aiParsedLines, setAiParsedLines] = useState<AiOrderParsedLine[]>([]);

  // Image Intake Local State
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [isExtractingImage, setIsExtractingImage] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [imageExtractionResult, setImageExtractionResultLocal] = useState<OrderImageExtractionResult | null>(null);

  // Validation state
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  // Existing order lines in draft
  const currentOrderLines = draft.order?.lines || [];
  const currentSubtotal = draft.order?.subtotalPreview || 0;
  const currency = draft.order?.currency || draft.currencyCode || "";

  useEffect(() => {
    let live = true;
    const ids = eligibleProducts.map(product => product.id);
    if (!ids.length) { setAvailabilityByProduct(new Map()); return; }
    setAvailabilityLoading(true);
    readPharmacyProductAvailability(draft.pharmacyId || "", ids).then(results => {
      if (live) { setAvailabilityByProduct(new Map(results.map(result => [result.productId, result]))); onSetProductAvailability(results); }
    }).finally(() => { if (live) setAvailabilityLoading(false); });
    return () => { live = false; };
  }, [draft.pharmacyId, eligibleProducts]);

  const availabilityFor = (productId: string) => availabilityByProduct.get(productId)
    || unresolvedAvailability(productId, availabilityLoading ? "AVAILABILITY_LOADING" : "AVAILABILITY_NOT_RESOLVED", "UNRESOLVED_CONTEXT");

  // Manual Search Filter
  const filteredProducts = useMemo(() => {
    if (!searchQuery.trim()) return eligibleProducts;
    const q = searchQuery.toLowerCase().trim();
    return eligibleProducts.filter((p) => {
      const code = (p.code || p.sku || p.id || "").toLowerCase();
      const nameEn = (p.name || "").toLowerCase();
      const nameAr = (p.nameAr || "").toLowerCase();
      const brand = (p.brand || "").toLowerCase();
      const group = (p.promotionGroupName || "").toLowerCase();
      return (
        code.includes(q) ||
        nameEn.includes(q) ||
        nameAr.includes(q) ||
        brand.includes(q) ||
        group.includes(q)
      );
    });
  }, [eligibleProducts, searchQuery]);

  // Handlers for Manual Adding
  const handleManualAddProduct = (product: Product) => {
    if (!availabilityFor(product.id).canOrder) return;
    const lineId = `line_${product.id}_${Date.now()}`;
    const unitPrice = product.price;
    if (typeof unitPrice !== "number" || !Number.isFinite(unitPrice) || unitPrice < 0) { setValidationErrors(["Product price is unavailable. Refresh the order."]); return; }
    const newLine: PharmacyOrderLine = {
      id: lineId,
      canonicalProductId: product.id,
      canonicalSkuId: product.sku || product.code || product.id,
      productCode: product.code || product.sku || product.id,
      productNameSnapshot: product.name,
      productArabicNameSnapshot: product.nameAr,
      packStrengthSnapshot: product.packageSize || product.strength,
      quantity: 1,
      unitPricePreview: unitPrice,
      lineTotalPreview: unitPrice,
      currency,
      inputSource: "MANUAL",
      userConfirmed: true,
      userCorrected: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    onAddOrderLine(newLine);
  };

  // Handlers for AI Quick Add Parsing
  const handleRunQuickAddParse = () => {
    if (!quickAddText.trim()) return;
    setIsParsingText(true);
    setTimeout(() => {
      const result = parseQuickAddInput(quickAddText, eligibleProducts, products);
      setAiParsedLines(result.parsedLines);
      onSetAiParseResult(result);
      setIsParsingText(false);
    }, 250);
  };

  const handleConfirmAiLineToOrder = (parsedLine: AiOrderParsedLine, candidate?: ProductResolutionCandidate) => {
    const targetProdId = candidate?.productId || parsedLine.proposedProductId;
    if (!targetProdId) return;

    const matchedProduct = eligibleProducts.find((p) => p.id === targetProdId) || products.find((p) => p.id === targetProdId);
    if (!matchedProduct || !availabilityFor(matchedProduct.id).canOrder) return;

    const unitPrice = matchedProduct.price;
    if (typeof unitPrice !== "number" || !Number.isFinite(unitPrice) || unitPrice < 0) { setValidationErrors(["Product price is unavailable. Refresh the order."]); return; }
    const qty = parsedLine.detectedQuantity > 0 ? parsedLine.detectedQuantity : 1;

    const confirmedLine: PharmacyOrderLine = {
      id: `line_ai_${matchedProduct.id}_${Date.now()}`,
      canonicalProductId: matchedProduct.id,
      canonicalSkuId: matchedProduct.sku || matchedProduct.code || matchedProduct.id,
      productCode: matchedProduct.code || matchedProduct.sku || matchedProduct.id,
      productNameSnapshot: matchedProduct.name,
      productArabicNameSnapshot: matchedProduct.nameAr,
      packStrengthSnapshot: matchedProduct.packageSize || matchedProduct.strength,
      quantity: qty,
      unitPricePreview: unitPrice,
      lineTotalPreview: unitPrice * qty,
      currency,
      inputSource: "AI_TEXT",
      originalRawInput: parsedLine.originalText,
      confidence: parsedLine.confidence,
      userConfirmed: true,
      userCorrected: parsedLine.status !== "MATCHED",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    onConfirmAiLine(parsedLine.id, confirmedLine);

    // Update local AI review table line status
    setAiParsedLines((prev) =>
      prev.map((l) => (l.id === parsedLine.id ? { ...l, userAction: "CONFIRMED", status: "MATCHED" } : l))
    );
  };

  const handleConfirmAllValidAiLines = () => {
    aiParsedLines.forEach((l) => {
      if (l.userAction !== "CONFIRMED" && l.proposedProductId && availabilityFor(l.proposedProductId).canOrder && (l.status === "MATCHED" || l.status === "NEEDS_CONFIRMATION")) {
        handleConfirmAiLineToOrder(l);
      }
    });
  };

  // Handlers for Image Intake
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const val = validateImageFile(file);
    if (!val.valid) {
      setUploadError(val.error || "Invalid file.");
      return;
    }

    setUploadError(null);
    setImageFile(file);
    const objectUrl = URL.createObjectURL(file);
    setImagePreviewUrl(objectUrl);
  };

  const handleRunImageExtraction = async () => {
    if (!imageFile) return;

    setIsExtractingImage(true);
    const attachment: OrderImageAttachment = {
      id: `img_${Date.now()}`,
      name: imageFile.name,
      sizeBytes: imageFile.size,
      mimeType: imageFile.type,
      uploadedAt: new Date().toISOString()
    };

    onSetImageAttachment(attachment);

    const extraction = await processOrderImageAttachment({
      attachment,
      imageFile,
      eligibleProducts,
      allCatalogProducts: products
    });

    setIsExtractingImage(false);
    setImageExtractionResultLocal(extraction);
    onSetExtractionResult(extraction);
    setAiParsedLines(extraction.extractedLines);
  };

  // Step 2 Proceed Guard
  const handleAttemptProceed = () => {
    const valResult = validateStep2OrderDraft(draft);
    if (!valResult.isValid) {
      setValidationErrors(valResult.errors);
      return;
    }
    setValidationErrors([]);
    onProceedToStep3();
  };

  return (
    <div className="space-y-6">
      {/* Step Header & Info Banner */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded font-mono text-[10px] font-bold bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800">
              STEP 2 / 6
            </span>
            <span className="px-2 py-0.5 rounded font-mono text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
              ELIGIBLE PRODUCTS: {eligibleProducts.length}
            </span>
          </div>
          <h3 className="text-lg font-bold text-slate-900 dark:text-white mt-1">
            {isRtl ? "الخطوة 2: تحديد أصناف الطلبية" : "Step 2: Commercial Order Items Entry"}
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {isRtl
              ? "اختر المنتجات يدوياً، أو استخدم إضافة الذكاء الاصطناعي السريعة، أو ارفع صورة الطلبية الورقية."
              : "Select products manually, use AI quick add parsing, or capture handwritten/printed order slips."}
          </p>
        </div>

        {/* Input Mode Selector Tabs */}
        <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700">
          <button
            type="button"
            onClick={() => setActiveTab("MANUAL")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
              activeTab === "MANUAL"
                ? "bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
            }`}
          >
            <Search className="w-3.5 h-3.5" />
            <span>{isRtl ? "اختيار يدوي" : "Manual Selection"}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("AI_TEXT")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
              activeTab === "AI_TEXT"
                ? "bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            <span>{isRtl ? "إضافة سريعة بالذكاء الاصطناعي" : "AI Quick Add"}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("IMAGE")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
              activeTab === "IMAGE"
                ? "bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
            }`}
          >
            <Camera className="w-3.5 h-3.5 text-blue-500" />
            <span>{isRtl ? "مسح صورة الطلبية" : "Order Image"}</span>
          </button>
        </div>
      </div>

      {/* Non-blocking Representative Notice (WP6.4 Section 2) */}
      {eligibilityReport.excluded.length > 0 && (
        <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded-xl text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2">
          <Info className="w-4 h-4 shrink-0 text-amber-500" />
          <span>
            {isRtl
              ? "بعض المنتجات المخصصة غير متاحة حالياً. يرجى الاتصال بالمسؤول."
              : "Some assigned Products are currently unavailable. Please contact your administrator."}
          </span>
        </div>
      )}

      {/* Main Mode Panels */}
      {activeTab === "MANUAL" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4 min-w-0">
          <h4 className="text-sm font-bold text-slate-900 dark:text-white">{isRtl ? "المنتجات المتاحة" : "Available Products"}</h4>
          {/* Search Box */}
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={
                isRtl
                  ? "ابحث بكود المنتج، اسم المنتج بالعربية/الإنجليزية، العلامة التجارية..."
                  : "Search by Product Code, English/Arabic Name, Brand, SKU..."
              }
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* Product Grid / Table */}
          {filteredProducts.length === 0 ? (
            <div className="text-center py-8 text-slate-500 text-xs">
              {isRtl ? "لا توجد منتجات مخصصة مطابقة للبحث." : "No assigned eligible products matched your search."}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-96 overflow-y-auto pr-1">
              {filteredProducts.map((p) => {
                const existingInOrder = currentOrderLines.find((l) => l.canonicalProductId === p.id);
                const unitPrice = typeof p.price === "number" && Number.isFinite(p.price) && p.price >= 0 ? p.price : null;
                const code = p.code || p.sku || p.id;
                const pack = p.packageSize || p.strength || "Standard";
                const availability = availabilityFor(p.id);

                return (
                  <div
                    key={p.id}
                    className="p-3.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl flex flex-col justify-between gap-3 hover:border-indigo-300 transition-all"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded">
                          {code}
                        </span>
                        <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 font-mono">
                          {unitPrice === null ? "Price unavailable" : unitPrice.toFixed(2)} {currency}
                        </span>
                      </div>
                      <h4 className="text-xs font-bold text-slate-900 dark:text-white line-clamp-1">{p.name}</h4>
                      {p.nameAr && <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1">{p.nameAr}</p>}
                      <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400 pt-1">
                        <span>Pack: {pack}</span>
                        <span>Group: {p.promotionGroupName || p.brand || "General"}</span>
                      </div>
                      <div className={`text-[10px] font-bold ${availability.availabilityState === "AVAILABLE" ? "text-emerald-600" : availability.availabilityState === "OUT_OF_STOCK" ? "text-red-600" : "text-amber-600"}`}>
                        {availability.availabilityState === "AVAILABLE" ? (isRtl ? "متاح" : "Available") : availability.availabilityState === "OUT_OF_STOCK" ? (isRtl ? "نفد المخزون" : "Out of stock") : (isRtl ? "تعذر التحقق من التوفر" : "Availability unavailable")}
                        {availability.showNumericStock && availability.actualAvailableQty !== undefined ? ` (${availability.actualAvailableQty})` : ""}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleManualAddProduct(p)}
                      disabled={!availability.canOrder || unitPrice === null}
                      className="w-full py-1.5 px-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all shadow-2xs"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>
                        {!availability.canOrder ? (availability.availabilityState === "OUT_OF_STOCK" ? (isRtl ? "نفد المخزون" : "Out of stock") : (isRtl ? "غير متاح" : "Unavailable")) : existingInOrder
                          ? isRtl
                            ? `إضافة صنف آخر (${existingInOrder.quantity} بالطلب)`
                            : `Add Another (+1, Currently ${existingInOrder.quantity})`
                          : isRtl
                          ? "إضافة للطلب"
                          : "Add to Order"}
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4 min-w-0">
          <div className="flex items-center justify-between"><h4 className="text-sm font-bold text-slate-900 dark:text-white">{isRtl ? "أصناف الطلب" : "Order Items"}</h4><span className="text-[11px] font-mono text-indigo-600">{currentOrderLines.length}</span></div>
          <div className="max-h-96 overflow-y-auto space-y-2 pr-1">
            {currentOrderLines.length === 0 ? <div className="py-10 text-center text-xs text-slate-400 border border-dashed border-slate-200 dark:border-slate-700 rounded-xl">{isRtl ? "لم يتم اختيار منتجات" : "No products selected"}</div> : currentOrderLines.map(line => (
              <div key={line.id} className="p-3 border border-slate-200 dark:border-slate-700 rounded-xl flex items-center justify-between gap-3">
                <div className="min-w-0"><div className="text-xs font-bold text-slate-900 dark:text-white truncate">{line.productNameSnapshot}</div><div className="text-[10px] text-slate-400 font-mono">{line.productCode}</div></div>
                <input aria-label={`Quantity for ${line.productNameSnapshot}`} type="number" min={1} value={line.quantity} onChange={e => onUpdateLineQuantity(line.id, Number.parseInt(e.target.value, 10) || 1)} className="w-16 p-1.5 text-center text-xs font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg" />
                <button type="button" aria-label={`Remove ${line.productNameSnapshot}`} onClick={() => onRemoveOrderLine(line.id)} className="text-slate-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
        </div>
        </div>
      )}

      {/* AI Quick Add Panel */}
      {activeTab === "AI_TEXT" && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="space-y-1">
            <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-500" />
              {isRtl ? "إدخال سريع بالنص (AI Quick Add)" : "AI Order Text Quick Add"}
            </h4>
            <p className="text-xs text-slate-500">
              {isRtl
                ? "أدخل النص بأي من الصيغ المدعومة مثل: 70-20 أو Cornex Gel 20gm x12 أو 70-20, 83-10"
                : "Enter freeform order text using shorthand formats like: 70-20, Cornex Gel 20gm x12, 20 Cornex Gel, 70-20, 83-10"}
            </p>
          </div>

          <textarea
            rows={4}
            value={quickAddText}
            onChange={(e) => setQuickAddText(e.target.value)}
            placeholder={`70-20\nCornex Gel 20gm x12\nCardioMax 10mg x30\n20 Cornex Gel\n70-20, 83-10`}
            className="w-full p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
          />

          <div className="flex items-center justify-between">
            <span className="text-[11px] text-slate-400">
              Supported separators: spaces, slashes, dashes, colons, x, qty, semicolons, commas
            </span>
            <button
              type="button"
              onClick={handleRunQuickAddParse}
              disabled={isParsingText || !quickAddText.trim()}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-2 transition-all shadow-xs"
            >
              {isParsingText ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              <span>{isRtl ? "معالجة وتحليل النص" : "Parse Order Text"}</span>
            </button>
          </div>

          {/* AI Review Table */}
          {aiParsedLines.length > 0 && (
            <div className="space-y-3 pt-3 border-t border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-between">
                <h5 className="text-xs font-bold text-slate-900 dark:text-white">
                  {isRtl ? "جدول مراجعة الذكاء الاصطناعي" : "AI Quick Add Review Table"}
                </h5>
                <button
                  type="button"
                  onClick={handleConfirmAllValidAiLines}
                  className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold rounded-lg transition-all"
                >
                  {isRtl ? "تأكيد جميع الأصناف الصالحة" : "Confirm All Valid Lines"}
                </button>
              </div>

              <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl">
                <table className="w-full text-left text-xs text-slate-700 dark:text-slate-300">
                  <thead className="bg-slate-50 dark:bg-slate-800/80 text-[11px] uppercase font-mono border-b border-slate-200 dark:border-slate-700">
                    <tr>
                      <th className="p-2.5">Original Input</th>
                      <th className="p-2.5">Status</th>
                      <th className="p-2.5">Proposed Product</th>
                      <th className="p-2.5">Pack</th>
                      <th className="p-2.5">Qty</th>
                      <th className="p-2.5">Confidence</th>
                      <th className="p-2.5 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {aiParsedLines.map((line) => {
                      const isConfirmed = line.userAction === "CONFIRMED";

                      return (
                        <tr key={line.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                          <td className="p-2.5 font-mono text-[11px] font-bold">{line.originalText}</td>
                          <td className="p-2.5">
                            <span
                              className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold ${
                                line.status === "MATCHED"
                                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                  : line.status === "NEEDS_CONFIRMATION"
                                  ? "bg-amber-50 text-amber-700 border border-amber-200"
                                  : line.status === "AMBIGUOUS"
                                  ? "bg-purple-50 text-purple-700 border border-purple-200"
                                  : "bg-red-50 text-red-700 border border-red-200"
                              }`}
                            >
                              {line.status}
                            </span>
                          </td>
                          <td className="p-2.5 font-semibold">
                            {line.proposedProductName ? (
                              <span>
                                {line.proposedProductName} ({line.proposedProductCode})
                              </span>
                            ) : (
                              <span className="text-red-500 italic">Unresolved</span>
                            )}
                          </td>
                          <td className="p-2.5 text-[11px]">{line.proposedPack || line.detectedPack || "-"}</td>
                          <td className="p-2.5 font-mono font-bold">{line.detectedQuantity}</td>
                          <td className="p-2.5 font-mono text-[11px]">
                            {Math.round(line.confidence * 100)}%
                          </td>
                          <td className="p-2.5 text-right">
                            {isConfirmed ? (
                              <span className="text-emerald-600 dark:text-emerald-400 font-bold text-[11px] flex items-center justify-end gap-1">
                                <Check className="w-3.5 h-3.5" /> Added
                              </span>
                            ) : line.proposedProductId ? (
                              <button
                                type="button"
                                onClick={() => handleConfirmAiLineToOrder(line)}
                                className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-[11px] font-bold"
                              >
                                Confirm & Add
                              </button>
                            ) : (
                              <span className="text-slate-400 text-[11px]">Cannot Add</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Image Capture Panel */}
      {activeTab === "IMAGE" && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="space-y-1">
            <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Camera className="w-4 h-4 text-blue-500" />
              {isRtl ? "مسح واستخراج صورة الطلبية الورقية" : "Order Image OCR & Capture"}
            </h4>
            <p className="text-xs text-slate-500">
              {isRtl
                ? "ارفع صورة الطلبية المطبوعة أو المكتوبة بخط اليد. سيتم تحليل وقراءة الأصناف وتأكيدها."
                : "Upload a printed or handwritten order slip image (JPG, PNG, PDF up to 10MB)."}
            </p>
          </div>

          {/* Upload Dropzone */}
          <div className="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-2xl p-6 text-center space-y-3">
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              onChange={handleFileSelect}
              className="hidden"
              id="order-image-input"
            />
            <label htmlFor="order-image-input" className="cursor-pointer inline-flex flex-col items-center gap-2">
              <Upload className="w-8 h-8 text-indigo-500" />
              <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400">
                {isRtl ? "اضغط لاختيار صورة الطلبية" : "Click to select or capture Order Image"}
              </span>
            </label>

            {uploadError && <p className="text-xs text-red-500 font-semibold">{uploadError}</p>}

            {imageFile && (
              <div className="text-xs text-slate-600 dark:text-slate-300 font-mono bg-slate-50 dark:bg-slate-800 p-2 rounded-lg inline-block">
                Selected: {imageFile.name} ({(imageFile.size / 1024).toFixed(1)} KB)
              </div>
            )}
          </div>

          {imagePreviewUrl && (
            <div className="flex items-center gap-4">
              <img
                src={imagePreviewUrl}
                alt="Order preview"
                className="w-32 h-32 object-cover rounded-xl border border-slate-200 dark:border-slate-700"
              />
              <button
                type="button"
                onClick={handleRunImageExtraction}
                disabled={isExtractingImage}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-2 transition-all shadow-xs"
              >
                {isExtractingImage ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
                <span>{isRtl ? "استخراج الأصناف من الصورة" : "Extract Items from Image"}</span>
              </button>
            </div>
          )}

          {/* Extraction Review Table */}
          {imageExtractionResult && (
            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-white">
                <span>Extraction Type:</span>
                <span className="px-2 py-0.5 bg-blue-50 text-blue-700 font-mono text-[10px] rounded border border-blue-200">
                  {imageExtractionResult.extractionType}
                </span>
                <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 font-mono text-[10px] rounded border border-emerald-200">
                  STATUS: {imageExtractionResult.status}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Active Order Lines & Subtotal Summary Panel */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShoppingBag className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            <h4 className="text-base font-bold text-slate-900 dark:text-white">
              {isRtl ? "جدول الأصناف المؤكدة للطلب" : "Confirmed Order Items"}
            </h4>
            <span className="px-2 py-0.5 rounded-full text-[11px] font-bold font-mono bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
              {currentOrderLines.length} {isRtl ? "أصناف" : "lines"}
            </span>
          </div>

          {currentOrderLines.length > 0 && (
            <button
              type="button"
              onClick={onClearOrder}
              className="text-xs text-red-600 dark:text-red-400 hover:underline flex items-center gap-1 font-semibold"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{isRtl ? "تفريغ السلة" : "Clear Order"}</span>
            </button>
          )}
        </div>

        {currentOrderLines.length === 0 ? (
          <div className="text-center py-6 text-slate-400 text-xs border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
            {isRtl
              ? "لم يتم إضافة أي صنف بعد. اختر منتجات من الخيارات أعلاه."
              : "No order items added yet. Select products manually or use AI quick add."}
          </div>
        ) : (
          <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl">
            <table className="w-full text-left text-xs text-slate-700 dark:text-slate-300">
              <thead className="bg-slate-50 dark:bg-slate-800/80 text-[11px] uppercase font-mono border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="p-3">Product / Code</th>
                  <th className="p-3">Pack</th>
                  <th className="p-3">Unit Price</th>
                  <th className="p-3 text-center">Quantity</th>
                  <th className="p-3 text-right">Line Total</th>
                  <th className="p-3 text-center">Source</th>
                  <th className="p-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {currentOrderLines.map((line) => {
                  const lineTotal = line.lineTotalPreview ?? (line.unitPricePreview * line.quantity);

                  return (
                    <tr key={line.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                      <td className="p-3 font-semibold text-slate-900 dark:text-white">
                        <div>{line.productNameSnapshot}</div>
                        <div className="text-[10px] font-mono text-slate-400">{line.productCode}</div>
                      </td>
                      <td className="p-3 text-[11px]">{line.packStrengthSnapshot || "Standard"}</td>
                      <td className="p-3 font-mono text-[11px]">
                        {line.unitPricePreview.toFixed(2)} {line.currency}
                      </td>
                      <td className="p-3 text-center">
                        <div className="inline-flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
                          <button
                            type="button"
                            onClick={() => onUpdateLineQuantity(line.id, line.quantity - 1)}
                            className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded text-slate-600 dark:text-slate-300"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <input
                            type="number"
                            min={1}
                            value={line.quantity}
                            onChange={(e) => onUpdateLineQuantity(line.id, parseInt(e.target.value, 10) || 1)}
                            className="w-12 text-center bg-transparent font-bold font-mono text-xs focus:outline-hidden"
                          />
                          <button
                            type="button"
                            onClick={() => onUpdateLineQuantity(line.id, line.quantity + 1)}
                            className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded text-slate-600 dark:text-slate-300"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                      </td>
                      <td className="p-3 font-mono font-bold text-right text-indigo-600 dark:text-indigo-400">
                        {lineTotal.toFixed(2)} {line.currency}
                      </td>
                      <td className="p-3 text-center">
                        <span className="px-1.5 py-0.5 rounded font-mono text-[9px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                          {line.inputSource}
                        </span>
                      </td>
                      <td className="p-3 text-right">
                        <button
                          type="button"
                          onClick={() => onRemoveOrderLine(line.id)}
                          className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg transition-all"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Total & Navigation Footer */}
        <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onBackToStep1}
              className="px-4 py-2 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-semibold flex items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>{isRtl ? "الرجوع للخطوة 1" : "Back to Step 1"}</span>
            </button>
          </div>

          <div className="flex items-center gap-6">
            <div className="text-right">
              <span className="text-xs text-slate-500 dark:text-slate-400">{isRtl ? "إجمالي الطلبية: " : "Order Subtotal: "}</span>
              <span className="text-lg font-black text-slate-900 dark:text-white font-mono ml-2">
                {currentSubtotal.toFixed(2)} {currency}
              </span>
            </div>

            <button
              type="button"
              onClick={handleAttemptProceed}
              className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-sm transition-all"
            >
              <span>{isRtl ? "الانتقال للخطوة 3 (عروض وخصومات)" : "Proceed to Step 3 (Offers)"}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Validation Errors Box */}
        {validationErrors.length > 0 && (
          <div className="p-3.5 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 rounded-xl space-y-1 text-xs text-red-700 dark:text-red-300">
            <p className="font-bold flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 text-red-500" />
              <span>{isRtl ? "يرجى تصحيح الأخطاء التالية لمتابعة الخطوة 3:" : "Please resolve errors to proceed:"}</span>
            </p>
            <ul className="list-disc pl-5 space-y-0.5 text-[11px]">
              {validationErrors.map((err, idx) => (
                <li key={idx}>{err}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};
