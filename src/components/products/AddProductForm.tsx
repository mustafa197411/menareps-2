import React, { useState, useEffect } from "react";
import { motion } from "motion/react";
import { 
  PlusCircle, 
  Check, 
  AlertCircle,
  ArrowLeft,
  Package,
  Layers,
  Save,
  Tag,
  Building
} from "lucide-react";
import { Product, ProductPromotionGroup } from "../../types";
import { auth } from "../../lib/firebase";

interface AddProductFormProps {
  lang: "en" | "ar";
  productPromotionGroups?: ProductPromotionGroup[];
  onNavigate?: (target: string) => void;
  onAddProduct?: (product: Product) => void | Promise<any> | any;
  onUpdateProduct?: (product: Product) => void | Promise<any> | any;
  editingProduct?: Product;
  products?: Product[];
  isModal?: boolean;
  onCancel?: () => void;
}

export default function AddProductForm({ 
  lang, 
  productPromotionGroups = [], 
  onNavigate, 
  onAddProduct,
  onUpdateProduct,
  editingProduct,
  products = [],
  isModal = false,
  onCancel
}: AddProductFormProps) {
  const isRtl = lang === "ar";

  // Form states
  const [code, setCode] = useState(""); // SKU Code
  const [name, setName] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [productFamily, setProductFamily] = useState("");
  const [therapeuticArea, setTherapeuticArea] = useState("Vascular & Cardiology");
  const [productType, setProductType] = useState("Tablet");
  const [price, setPrice] = useState("25.00");
  const [stock, setStock] = useState("500");
  const [description, setDescription] = useState("");
  const [manufacturer, setManufacturer] = useState("PELLA DERMA");
  const [productImageUrl, setProductImageUrl] = useState("");
  const [isActive, setIsActive] = useState(true);

  // Sample Configuration States
  const [isSampleable, setIsSampleable] = useState("No");
  const [isSample, setIsSample] = useState("No");
  const [parentProductSku, setParentProductSku] = useState("");
  const [monthlyRepSampleLimit, setMonthlyRepSampleLimit] = useState("");
  const [monthlyPhysicianSampleLimit, setMonthlyPhysicianSampleLimit] = useState("");
  const [strength, setStrength] = useState("");
  const [packageSize, setPackageSize] = useState("");

  // UI States
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [isPendingSync, setIsPendingSync] = useState(false);
  const [error, setError] = useState("");

  const therapeuticAreas = [
    "Vascular & Cardiology",
    "Pediatrics & Nutrition",
    "Dermatology & Cosmeceuticals",
    "Internal Medicine",
    "Oncology & Immunology",
    "Neurology & Psychiatry"
  ];

  const productTypeOptions = [
    "Tablet",
    "Capsule",
    "Cream",
    "Gel",
    "Ointment",
    "Syrup",
    "Suspension",
    "Injection",
    "Spray",
    "Inhaler",
    "Drops",
    "Sachet",
    "Soap",
    "Solution",
    "Lotion"
  ];

  // Restrict Parent Product SKU list
  const filteredParentProducts = React.useMemo(() => {
    return products.filter((p) => {
      // Only show products that are active
      if (p.isActive === false) return false;
      // Only show products that are not sample SKUs themselves
      if (p.isSample === "Yes") return false;
      // Exclude the current product being edited
      if (editingProduct && p.id === editingProduct.id) return false;
      // Must have sku or code
      if (!p.sku && !p.code) return false;
      return true;
    });
  }, [products, editingProduct]);

  // Load editing product or reset
  useEffect(() => {
    if (editingProduct) {
      setCode(editingProduct.sku || editingProduct.code || "");
      setName(editingProduct.name || "");
      setNameAr(editingProduct.nameAr || "");
      setSelectedGroupId(editingProduct.promotionGroupId || "");
      setProductFamily(editingProduct.productFamily || "");
      setTherapeuticArea(editingProduct.therapeuticArea || "Vascular & Cardiology");
      setProductType(editingProduct.productType || "Tablet");
      setPrice((editingProduct.price || 0).toString());
      setStock((editingProduct.stockQuantity !== undefined ? editingProduct.stockQuantity : (editingProduct.stock || 0)).toString());
      setIsSampleable(editingProduct.isSampleable || (editingProduct.canGenerateSamples === true ? "Yes" : "No"));
      setMonthlyRepSampleLimit((editingProduct.monthlyRepSampleLimit || "").toString());
      setMonthlyPhysicianSampleLimit((editingProduct.monthlyPhysicianSampleLimit || "").toString());
      setIsSample(editingProduct.isSample || (editingProduct.isSampleSku === true ? "Yes" : "No"));
      setParentProductSku(editingProduct.parentProductSku || "");
      setStrength(editingProduct.strength || "");
      setPackageSize(editingProduct.packageSize || "");
      setDescription(editingProduct.description || "");
      setManufacturer(editingProduct.manufacturer || "PELLA DERMA");
      setIsActive(editingProduct.isActive !== false);
      const firstImage = editingProduct.productImages && editingProduct.productImages.length > 0 ? editingProduct.productImages[0] : "";
      setProductImageUrl(firstImage);
    } else {
      setCode("");
      setName("");
      setNameAr("");
      setSelectedGroupId("");
      setProductFamily("");
      setTherapeuticArea("Vascular & Cardiology");
      setProductType("Tablet");
      setPrice("25.00");
      setStock("500");
      setIsSampleable("No");
      setMonthlyRepSampleLimit("");
      setMonthlyPhysicianSampleLimit("");
      setIsSample("No");
      setParentProductSku("");
      setStrength("");
      setPackageSize("");
      setDescription("");
      setManufacturer("PELLA DERMA");
      setIsActive(true);
      setProductImageUrl("");
    }
  }, [editingProduct]);

  // Enforce synchronizations on change
  const handleIsSampleableChange = (val: string) => {
    setIsSampleable(val);
    if (val === "Yes") {
      setIsSample("No");
    }
  };

  const handleIsSampleChange = (val: string) => {
    setIsSample(val);
    if (val === "Yes") {
      setIsSampleable("No");
    }
  };

  // Handle submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const trimmedCode = code.trim();
    const trimmedName = name.trim();
    const trimmedNameAr = nameAr.trim();
    const trimmedManufacturer = manufacturer.trim();
    const trimmedProductType = productType.trim();

    // 1. Missing SKU Check
    if (!trimmedCode) {
      setError(isRtl ? "رمز المستحضر (SKU) مطلوب." : "Product SKU is required.");
      return;
    }

    // 2. Duplicate SKU Check
    const isDuplicate = products.some(
      p => p.id !== editingProduct?.id && 
      (p.sku?.toLowerCase() === trimmedCode.toLowerCase() || p.code?.toLowerCase() === trimmedCode.toLowerCase())
    );
    if (isDuplicate) {
      setError(
        isRtl 
          ? "رمز المستحضر (SKU) مكرر: هذا الرمز مسجل لمنتج آخر بالفعل." 
          : `Duplicate SKU: A product with SKU "${trimmedCode}" already exists.`
      );
      return;
    }

    // 3. Missing Name Check
    if (!trimmedName) {
      setError(isRtl ? "اسم المنتج مطلوب." : "Product Name is required.");
      return;
    }

    // 4. Missing Product Promotion Group Check
    if (!selectedGroupId) {
      setError(isRtl ? "يرجى تحديد المجموعة الترويجية للمنتج." : "Product Promotion Group is required.");
      return;
    }

    // 5. Inactive Promotion Group Check
    const pg = productPromotionGroups.find(g => g.id === selectedGroupId);
    if (pg && pg.isActive === false) {
      setError(
        isRtl 
          ? "المجموعة الترويجية المحددة غير نشطة. لا يمكن ربط أصناف جديدة بها." 
          : "The selected Product Promotion Group is inactive. New products cannot be assigned to it."
      );
      return;
    }

    // 6. Invalid Price Check
    const priceNum = parseFloat(price);
    if (isNaN(priceNum) || priceNum <= 0) {
      setError(isRtl ? "يرجى إدخال سعر صحيح أكبر من الصفر." : "Please enter a valid unit price greater than zero.");
      return;
    }

    // 7. Invalid Stock Level Check
    const stockNum = parseInt(stock);
    if (isNaN(stockNum) || stockNum < 0) {
      setError(isRtl ? "يرجى إدخال كمية مخزون صحيحة." : "Please enter a valid stock level.");
      return;
    }

    // 8. Sample Limits check and normalization
    const isSampleFlowActive = isSample === "Yes" || isSampleable === "Yes";
    let repLimitNum: number | undefined = undefined;
    let physLimitNum: number | undefined = undefined;

    if (isSampleFlowActive) {
      const repVal = monthlyRepSampleLimit ? parseInt(monthlyRepSampleLimit) : 0;
      const physVal = monthlyPhysicianSampleLimit ? parseInt(monthlyPhysicianSampleLimit) : 0;
      if (isNaN(repVal) || repVal < 0 || isNaN(physVal) || physVal < 0) {
        setError(isRtl ? "حدود العينات يجب أن تكون أرقاماً موجبة." : "Monthly sample limits must be positive numbers.");
        return;
      }
      repLimitNum = repVal;
      physLimitNum = physVal;
    }

    // 9. Missing Parent Product SKU when Is Sample = Yes
    if (isSample === "Yes") {
      if (!parentProductSku.trim()) {
        setError(isRtl ? "يجب اختيار رمز المستحضر الأب عندما يكون المنتج عينة." : "Parent Product SKU is required when Is Sample is set to Yes.");
        return;
      }
      // 10. Self-referencing Parent Product SKU Check
      if (parentProductSku.trim().toLowerCase() === trimmedCode.toLowerCase()) {
        setError(isRtl ? "لا يمكن للمنتج العينة الإشارة لنفسه كمستحضر أب." : "Self-referencing parent product SKU is not allowed.");
        return;
      }
      // 11. Reference another Sample SKU Check
      const parentProd = products.find(p => p.sku === parentProductSku || p.code === parentProductSku || p.id === parentProductSku);
      if (parentProd && (parentProd.isSample === "Yes" || parentProd.isSampleSku === true)) {
        setError(isRtl ? "لا يمكن لمنتج العينة الإشارة لمنتج عينة آخر كمستحضر أب." : "A Sample SKU cannot reference another Sample SKU as its parent.");
        return;
      }
    }

    setIsSubmitting(true);

    try {
      const finalGroupName = pg ? pg.name : "";
      const savedProductId = editingProduct?.id || `PROD-${Math.floor(1000 + Math.random() * 9000)}`;

      const isSampleSku = isSample === "Yes";
      const canGenerateSamples = !isSampleSku && isSampleable === "Yes";

      const parentProd = isSampleSku ? products.find(p => p.sku === parentProductSku || p.code === parentProductSku || p.id === parentProductSku) : null;
      const finalParentProductId = isSampleSku ? (parentProd ? parentProd.id : (editingProduct?.parentProductId || "")) : undefined;
      const finalParentProductName = isSampleSku ? (parentProd ? parentProd.name : (editingProduct?.parentProductName || "")) : undefined;

      const newProduct: Product = {
        id: savedProductId,
        sku: trimmedCode,
        code: trimmedCode,
        name: trimmedName,
        nameAr: trimmedNameAr || undefined,
        brand: finalGroupName, // backward compatibility mapping
        promotionGroupId: selectedGroupId,
        promotionGroupName: finalGroupName,
        productFamily: productFamily.trim() || undefined,
        therapeuticArea,
        productType: trimmedProductType,
        price: priceNum,
        stock: stockNum,
        stockQuantity: stockNum,
        isSampleable: isSampleSku ? "No" : isSampleable,
        canGenerateSamples,
        monthlyRepSampleLimit: repLimitNum,
        monthlyPhysicianSampleLimit: physLimitNum,
        isSample,
        isSampleSku,
        parentProductId: finalParentProductId,
        parentProductName: finalParentProductName,
        parentProductSku: isSampleSku ? parentProductSku.trim() : undefined,
        strength: strength.trim() || undefined,
        packageSize: packageSize.trim() || undefined,
        description: description.trim() || undefined,
        manufacturer: trimmedManufacturer,
        productImages: productImageUrl.trim() ? [productImageUrl.trim()] : [],
        isActive
      };

      let result: any = null;

      if (editingProduct) {
        if (onUpdateProduct) {
          result = await onUpdateProduct(newProduct);
        }
      } else {
        if (onAddProduct) {
          result = await onAddProduct(newProduct);
        }
      }

      const isOfflineMode = result?.mode === "local";
      setIsPendingSync(isOfflineMode);
      setSuccess(true);
      setError("");
      setIsSubmitting(false);

      // Reset form if not modal
      if (!isModal) {
        setCode("");
        setName("");
        setNameAr("");
        setSelectedGroupId("");
        setProductFamily("");
        setDescription("");
        setPrice("25.00");
        setStock("500");
        setIsSampleable("No");
        setMonthlyRepSampleLimit("");
        setMonthlyPhysicianSampleLimit("");
        setIsSample("No");
        setParentProductSku("");
        setStrength("");
        setPackageSize("");
        setProductImageUrl("");
      }
    } catch (err: any) {
      console.error("[AddProductForm] Submit failed:", err);
      // Keep form open, display friendly error, do not clear entered data, log audit/collection details
      setError(err?.message || "Failed to save product.");
      setIsSubmitting(false);
    }
  };

  const activePromotionGroups = productPromotionGroups.filter(g => g.isActive !== false);

  if (success && !isModal) {
    return (
      <div className="p-6 max-w-3xl mx-auto space-y-6" dir={isRtl ? "rtl" : "ltr"}>
        <div className={`border p-8 rounded-2xl text-center space-y-4 animate-fade-in ${
          isPendingSync 
            ? "bg-amber-50/50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800" 
            : "bg-emerald-50/50 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-800"
        }`}>
          <div className={`mx-auto h-12 w-12 rounded-full flex items-center justify-center ${
            isPendingSync 
              ? "bg-amber-100 dark:bg-amber-950/80 text-amber-600" 
              : "bg-emerald-100 dark:bg-emerald-950/80 text-emerald-600"
          }`}>
            <Check size={24} />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              {isPendingSync 
                ? (isRtl ? "تم حفظ المستحضر محلياً!" : "Product Saved Locally!")
                : editingProduct 
                ? (isRtl ? "تم تحديث المستحضر بنجاح!" : "Product SKU Updated Successfully!")
                : (isRtl ? "تم تسجيل المستحضر بنجاح!" : "Product SKU Onboarded Successfully!")}
            </h3>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              {isPendingSync 
                ? (isRtl ? "تم حفظ المستحضر محلياً وهو قيد المزامنة السحابية المؤجلة." : "The product was saved locally in secure queue and is pending cloud synchronization.")
                : (isRtl ? "تم حفظ البيانات وتحديث قائمة المستحضرات المعتمدة." : "The SKU configurations have been successfully validated and synced.")}
            </p>
          </div>
          <div className="flex justify-center gap-3 pt-4">
            <button
              onClick={() => {
                setSuccess(false);
                if (onCancel) onCancel();
              }}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer"
            >
              {isRtl ? "إضافة مستحضر آخر" : "Onboard Another SKU"}
            </button>
            <button
              onClick={() => onNavigate && onNavigate("products-list")}
              className="px-4 py-2 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 text-slate-600 dark:text-slate-300 text-xs font-bold rounded-xl transition-colors cursor-pointer"
            >
              {isRtl ? "العودة للمحفظة" : "Return to Portfolio"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={isModal ? "w-full" : "p-6 max-w-3xl mx-auto space-y-6"} dir={isRtl ? "rtl" : "ltr"}>
      {/* Header (Page only) */}
      {!isModal && (
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <button 
              onClick={() => onNavigate && onNavigate("products-list")}
              className="p-2 rounded-xl border border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer text-slate-500"
            >
              <ArrowLeft size={16} className={isRtl ? "rotate-180" : ""} />
            </button>
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                {editingProduct 
                  ? (isRtl ? "تعديل بيانات المستحضر" : "Modify Product Master SKU")
                  : (isRtl ? "تسجيل مستحضر جديد" : "Onboard New Product Master SKU")}
              </h2>
              <p className="text-xxs text-slate-400">
                {isRtl 
                  ? "تسجيل كود SKU وتعيينه للمجموعة الترويجية المعتمدة" 
                  : "Register canonical product SKU details and associate with active Promotion Group."}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Main Form */}
      <form onSubmit={handleSubmit} className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl p-6 shadow-xxs space-y-5 text-xs">
        
        {error && (
          <div className="p-3 bg-rose-50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/40 text-rose-600 dark:text-rose-400 text-xs rounded-xl flex items-center gap-2 font-semibold">
            <AlertCircle size={16} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Promotion Group Controlled Check warning */}
        {activePromotionGroups.length === 0 && (
          <div className="p-3.5 bg-amber-50 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-900/30 text-amber-700 dark:text-amber-400 text-xs rounded-xl flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <AlertCircle size={16} />
              <span className="font-bold">
                {isRtl 
                  ? "تنبيه: لا توجد مجموعات ترويج نشطة حالياً." 
                  : "Warning: No active Product Promotion Groups exist in the system."}
              </span>
            </div>
            <p className="text-[10px] leading-relaxed">
              {isRtl
                ? "يجب على المسؤول أو مدير المنتج إنشاء مجموعة ترويج واحدة نشطة على الأقل في شاشة البيانات الأساسية قبل إنشاء المنتجات."
                : "An administrator or product manager must configure at least one active Product Promotion Group in Master Data before onboarding new products."}
            </p>
            {onNavigate && (
              <button
                type="button"
                onClick={() => onNavigate("master-data")}
                className="self-start text-[10px] font-bold text-indigo-600 dark:text-indigo-400 underline hover:text-indigo-800 cursor-pointer"
              >
                {isRtl ? "الانتقال لإدارة المجموعات الترويجية" : "Go to Promotion Group Management"}
              </button>
            )}
          </div>
        )}

        {/* Brand & Formulation Specifications */}
        <div className="space-y-4">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 border-b border-slate-50 dark:border-slate-800 pb-1.5">
            <Package size={13} className="text-blue-500" />
            {isRtl ? "الهوية التجارية والعلمية للمنتج" : "Identity & Formulation Specs"}
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-extrabold text-slate-500 block uppercase">
                {isRtl ? "رمز المستحضر (Product SKU) *" : "Product SKU (Code) *"}
              </label>
              <input 
                type="text" 
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="e.g. SKU-PHOTO-50"
                className="w-full text-xs p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-white focus:ring-1 focus:ring-indigo-500 font-mono font-bold"
                required
                disabled={!!editingProduct}
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-extrabold text-slate-500 block uppercase">
                {isRtl ? "المجموعة الترويجية للمنتج *" : "Product Promotion Group *"}
              </label>
              <select 
                value={selectedGroupId}
                onChange={(e) => setSelectedGroupId(e.target.value)}
                className="w-full text-xs p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-white focus:ring-1 focus:ring-indigo-500 font-bold cursor-pointer"
                required
              >
                <option value="">{isRtl ? "اختر مجموعة ترويج..." : "Select Product Promotion Group..."}</option>
                {activePromotionGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} {g.nameAr ? `(${g.nameAr})` : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-extrabold text-slate-500 block uppercase">
                {isRtl ? "اسم المنتج بالإنجليزية *" : "Product Name (English) *"}
              </label>
              <input 
                type="text" 
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Photoblock Gel SPF 50"
                className="w-full text-xs p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-white focus:ring-1 focus:ring-indigo-500 font-semibold"
                required
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-extrabold text-slate-500 block uppercase">
                {isRtl ? "اسم المنتج بالعربية" : "Arabic Product Name (Optional)"}
              </label>
              <input 
                type="text" 
                value={nameAr}
                onChange={(e) => setNameAr(e.target.value)}
                placeholder="مثال: فوتوبلوك جل حماية 50"
                className="w-full text-xs p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-white focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-extrabold text-slate-500 block uppercase">
                {isRtl ? "عائلة المنتج" : "Product Family (Optional)"}
              </label>
              <input 
                type="text" 
                value={productFamily}
                onChange={(e) => setProductFamily(e.target.value)}
                placeholder="e.g. Photoblock, Aquax"
                className="w-full text-xs p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-white focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-extrabold text-slate-500 block uppercase">
                {isRtl ? "نوع المنتج *" : "Product Type *"}
              </label>
              <select 
                value={productType}
                onChange={(e) => setProductType(e.target.value)}
                className="w-full text-xs p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-white focus:ring-1 focus:ring-indigo-500 cursor-pointer"
                required
              >
                {productTypeOptions.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-extrabold text-slate-500 block uppercase">
                {isRtl ? "القسم والمجال العلاجي *" : "Therapeutic Area *"}
              </label>
              <select 
                value={therapeuticArea}
                onChange={(e) => setTherapeuticArea(e.target.value)}
                className="w-full text-xs p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-white focus:ring-1 focus:ring-indigo-500 cursor-pointer"
                required
              >
                {therapeuticAreas.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Logistics, Pricing & Coding */}
        <div className="space-y-4 pt-4 border-t border-slate-100 dark:border-slate-800">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 border-b border-slate-50 dark:border-slate-800 pb-1.5">
            <Layers size={13} className="text-blue-500" />
            {isRtl ? "اللوجستيات، التسعير والترميز" : "Logistics, Price Matrix & Coding"}
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-extrabold text-slate-500 block uppercase">
                {isRtl ? "سعر التوزيع للوحدة (عملة السوق) *" : "Price Per Unit (market currency) *"}
              </label>
              <input 
                type="number" 
                step="0.01"
                min="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0.00"
                className="w-full text-xs p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-white focus:ring-1 focus:ring-indigo-500 font-mono font-bold"
                required
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-extrabold text-slate-500 block uppercase">
                {isRtl ? "كمية المخزون الافتتاحية (التوافق) *" : "Initial Stock Level (Comp) *"}
              </label>
              <input 
                type="number" 
                min="0"
                value={stock}
                onChange={(e) => setStock(e.target.value)}
                placeholder="e.g. 500"
                className="w-full text-xs p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-white focus:ring-1 focus:ring-indigo-500 font-mono font-bold"
                required
              />
            </div>

            <div className="space-y-1 flex flex-col justify-center items-start pt-4">
              <label className="relative inline-flex items-center cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-slate-200 dark:bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-green-500"></div>
                <span className="ml-3 mr-3 text-xs font-bold text-slate-700 dark:text-slate-300">
                  {isRtl ? "نشط" : "Active"}
                </span>
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-extrabold text-slate-500 block uppercase">
                {isRtl ? "الشركة المصنعة *" : "Manufacturer / Supplier *"}
              </label>
              <input 
                type="text" 
                value={manufacturer}
                onChange={(e) => setManufacturer(e.target.value)}
                placeholder="e.g. PELLA DERMA"
                className="w-full text-xs p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-white focus:ring-1 focus:ring-indigo-500 font-semibold"
                required
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-extrabold text-slate-500 block uppercase">
                {isRtl ? "رابط صورة المنتج" : "Product Image URL (Optional)"}
              </label>
              <input 
                type="text" 
                value={productImageUrl}
                onChange={(e) => setProductImageUrl(e.target.value)}
                placeholder="https://example.com/image.jpg"
                className="w-full text-xs p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-white focus:ring-1 focus:ring-indigo-500 font-mono text-[10px]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-extrabold text-slate-500 block uppercase">
                {isRtl ? "التركيز (مثال: 50 ملغ)" : "Strength (e.g. 50mg)"}
              </label>
              <input 
                type="text" 
                value={strength}
                onChange={(e) => setStrength(e.target.value)}
                placeholder="e.g. 50mg, 100ml"
                className="w-full text-xs p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-white focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-extrabold text-slate-500 block uppercase">
                {isRtl ? "حجم العبوة (مثال: 30 قرص)" : "Package Size (e.g. 30 Tablets)"}
              </label>
              <input 
                type="text" 
                value={packageSize}
                onChange={(e) => setPackageSize(e.target.value)}
                placeholder="e.g. 30 Tablets, Pack of 2"
                className="w-full text-xs p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-white focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-extrabold text-slate-500 block uppercase">
              {isRtl ? "الوصف العلمي والملاحظات" : "Formulation Scientific Notes"}
            </label>
            <textarea 
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Clinical indications, storage notes..."
              rows={2}
              className="w-full text-xs p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-white focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        </div>

        {/* Sample Configurations */}
        <div className="space-y-4 pt-4 border-t border-slate-100 dark:border-slate-800">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 border-b border-slate-50 dark:border-slate-800 pb-1.5">
            <Tag size={13} className="text-blue-500" />
            {isRtl ? "إعدادات العينات الطبية والترويجية" : "Sample & Physician Detailing Settings"}
          </h3>

          {filteredParentProducts.length === 0 && (
            <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 p-3.5 rounded-xl flex items-start gap-2.5 text-xs text-amber-800 dark:text-amber-300">
              <AlertCircle size={16} className="text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">{isRtl ? "لا توجد مستحضرات تجارية نشطة متاحة" : "No active commercial parent products available"}</p>
                <p className="mt-0.5 text-slate-500 dark:text-slate-400">
                  {isRtl 
                    ? "يجب تسجيل مستحضر تجاري نشط واحد على الأقل أولاً لتتمكن من إنشاء مستحضر عينة مرتبط به." 
                    : "You must register at least one active commercial product first before you can create sample SKUs."}
                </p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-extrabold text-slate-500 block uppercase">
                {isRtl ? "يمكن توزيع عينات منه؟" : "Can Generate Samples?"}
              </label>
              <select 
                value={isSampleable}
                onChange={(e) => handleIsSampleableChange(e.target.value)}
                className="w-full text-xs p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-white focus:ring-1 focus:ring-indigo-500 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={isSample === "Yes"}
              >
                <option value="No">{isRtl ? "لا" : "No"}</option>
                <option value="Yes">{isRtl ? "نعم" : "Yes"}</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-extrabold text-slate-500 block uppercase">
                {isRtl ? "هل هذا المنتج عينة؟" : "Is Sample SKU?"}
              </label>
              <select 
                value={isSample}
                onChange={(e) => handleIsSampleChange(e.target.value)}
                className="w-full text-xs p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-white focus:ring-1 focus:ring-indigo-500 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={isSampleable === "Yes" || (isSample !== "Yes" && filteredParentProducts.length === 0)}
              >
                <option value="No">{isRtl ? "لا (مستحضر تجاري)" : "No (Commercial SKU)"}</option>
                <option value="Yes">{isRtl ? "نعم (مستحضر عينة)" : "Yes (Sample SKU)"}</option>
              </select>
            </div>
          </div>

          {isSample === "Yes" && (
            <div className="space-y-1 animate-fade-in">
              <label className="text-[10px] font-extrabold text-slate-500 block uppercase">
                {isRtl ? "المستحضر التجاري الأب (للعينات) *" : "Parent Product SKU (for Samples) *"}
              </label>
              <select 
                value={parentProductSku}
                onChange={(e) => setParentProductSku(e.target.value)}
                className="w-full text-xs p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-white focus:ring-1 focus:ring-indigo-500 cursor-pointer"
                required
              >
                <option value="">{isRtl ? "اختر المستحضر الأب..." : "Select Parent Product..."}</option>
                {parentProductSku && !filteredParentProducts.some(p => (p.sku || p.code || p.id) === parentProductSku) && (
                  <option value={parentProductSku}>
                    {editingProduct?.parentProductName || parentProductSku} ({parentProductSku})
                  </option>
                )}
                {filteredParentProducts.map((p) => (
                  <option key={p.id} value={p.sku || p.code || p.id}>
                    {p.name} ({p.sku || p.code || p.id})
                  </option>
                ))}
              </select>
            </div>
          )}

          {(isSample === "Yes" || isSampleable === "Yes") && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-fade-in">
              <div className="space-y-1">
                <label className="text-[10px] font-extrabold text-slate-500 block uppercase">
                  {isRtl ? "حد توزيع عينات المندوب شهرياً *" : "Monthly Rep Sample Limit *"}
                </label>
                <input 
                  type="number" 
                  min="0"
                  value={monthlyRepSampleLimit}
                  onChange={(e) => setMonthlyRepSampleLimit(e.target.value)}
                  placeholder="e.g. 50"
                  className="w-full text-xs p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-white focus:ring-1 focus:ring-indigo-500 font-mono font-bold"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-extrabold text-slate-500 block uppercase">
                  {isRtl ? "حد توزيع عينات الطبيب شهرياً *" : "Monthly Physician Sample Limit *"}
                </label>
                <input 
                  type="number" 
                  min="0"
                  value={monthlyPhysicianSampleLimit}
                  onChange={(e) => setMonthlyPhysicianSampleLimit(e.target.value)}
                  placeholder="e.g. 10"
                  className="w-full text-xs p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-white focus:ring-1 focus:ring-indigo-500 font-mono font-bold"
                  required
                />
              </div>
            </div>
          )}
        </div>

        {/* Form Actions */}
        <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-3">
          <button
            type="button"
            onClick={() => {
              if (onCancel) {
                onCancel();
              } else if (onNavigate) {
                onNavigate("products-list");
              }
            }}
            className="px-4.5 py-2 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 font-semibold rounded-xl hover:bg-slate-50 cursor-pointer"
          >
            {isRtl ? "إلغاء" : "Cancel"}
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-all cursor-pointer shadow-md inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            {isSubmitting ? (
              <>
                <div className="h-3 w-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>{isRtl ? "جاري الحفظ..." : "Saving..."}</span>
              </>
            ) : (
              <>
                {editingProduct ? <Save size={15} /> : <PlusCircle size={15} />}
                <span>
                  {editingProduct 
                    ? (isRtl ? "حفظ التغييرات" : "Save Changes") 
                    : (isRtl ? "تسجيل المستحضر" : "Register Product SKU")}
                </span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
