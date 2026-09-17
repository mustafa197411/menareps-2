import { formatCanonicalProductPrice } from "../lib/operationalScopeClient";
import React, { useState, useMemo, useEffect, useRef } from "react";
import { 
  Search, 
  Plus, 
  X, 
  Eye, 
  Edit2, 
  Trash2, 
  MoreHorizontal, 
  Check, 
  SlidersHorizontal,
  TrendingUp,
  History,
  Calendar,
  Package,
  AlertTriangle,
  Info,
  Download,
  Save,
  PenSquare,
  Target,
  Sparkles,
  Globe
} from "lucide-react";
import { Product, User, ProductPromotionGroup, ProductPromotionProfile, KeyMessage } from "../types";
import { hasPermission } from "../lib/userPolicyEngine";
import { mapRecordForExport, TemplateSchemas } from "../lib/schemaEngine";
import { applySecurityScope, getCurrentUserScope } from "../lib/securityEngine";
import { discoverProductResources } from "../lib/resourceReadClient";
import { runProductDetailResourceDownload } from "../lib/productDetailResourceDownload";
import Pagination from "./Pagination";
import MobileCardList from "./MobileCardList";
import TruncatedText from "./TruncatedText";
import NoDataState from "./NoDataState";
import AddProductForm from "./products/AddProductForm";
import { resolveFinancialIdentity } from "../lib/financialIdentity";
import { formatCurrencyForIdentity } from "../lib/marketSettings";
import { useOperationalScopeSession } from "../contexts/OperationalScopeSessionContext";
import {
  authorizeProductListProducts,
  filterProductListForPresentation,
} from "../lib/productListVisibility";
import {
  getProductMarketRelationships,
  saveProductMarketCatalog,
  type ProductMarketRelationshipOption,
  type ProductMarketCatalogResponse,
} from "../lib/productMarketCatalogClient";

interface ProductListProps {
  currentUser: User;
  products: Product[];
  productPromotionGroups?: ProductPromotionGroup[];
  onAddProduct: (product: Product) => void;
  onUpdateProduct?: (product: Product) => void;
  onDeleteProduct?: (prodId: string) => void;
  lang: "en" | "ar";
  keyMessages?: KeyMessage[];
}

export default function ProductList({
  currentUser,
  products,
  productPromotionGroups = [],
  onAddProduct,
  onUpdateProduct,
  onDeleteProduct,
  lang,
  keyMessages = []
}: ProductListProps) {
  const isRtl = lang === "ar";
  const operationalScopeSession = useOperationalScopeSession();
  const hasCreateAccess = hasPermission(currentUser, "Products", "create");
  const hasConfigureMarketAccess = hasPermission(currentUser, "Products", "assign");
  const productMoney = (amount: number, _product: Product) => formatCanonicalProductPrice(amount, operationalScopeSession.scope?.marketContext);
  
  // Filter & Search states
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedPromotionType, setSelectedPromotionType] = useState("All");
  const [selectedBrand, setSelectedBrand] = useState("All");
  const [sortOrder, setSortOrder] = useState("Default");
  const [showInactive, setShowInactive] = useState(false);
  const [showUat, setShowUat] = useState(false);

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(6);

  // Reset pagination on search or filters update
  React.useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedPromotionType, selectedBrand, sortOrder, showInactive, showUat]);

  // Selection state
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [isMarketModalOpen, setIsMarketModalOpen] = useState(false);
  const [marketRelationships, setMarketRelationships] = useState<ProductMarketRelationshipOption[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [selectedMarketId, setSelectedMarketId] = useState("");
  const [marketDrafts, setMarketDrafts] = useState<Record<string, { unitPrice: string; active: boolean; saleable: boolean }>>({});
  const [marketStatus, setMarketStatus] = useState<ProductMarketCatalogResponse | null>(null);
  const [marketBusy, setMarketBusy] = useState(false);
  const [marketError, setMarketError] = useState("");

  // Modal / Dialogue States
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [formMode, setFormMode] = useState<"add" | "edit">("add");
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  // Secondary interactive feature modals
  const [selectedProductDetails, setSelectedProductDetails] = useState<Product | null>(null);
  const [adjustStockProduct, setAdjustStockProduct] = useState<Product | null>(null);
  const [schedulePriceProduct, setSchedulePriceProduct] = useState<Product | null>(null);
  const [viewPriceHistoryProduct, setViewPriceHistoryProduct] = useState<Product | null>(null);
  const [viewStockHistoryProduct, setViewStockHistoryProduct] = useState<Product | null>(null);

  // Promotion Profile details state
  const [detailsTab, setDetailsTab] = useState<"general" | "promotion" | "key-messages" | "resources">("general");
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [profileDraft, setProfileDraft] = useState<Partial<ProductPromotionProfile>>({});
  const [targetSpecsStr, setTargetSpecsStr] = useState("");
  const [targetPharmsStr, setTargetPharmsStr] = useState("");
  const [targetHospsStr, setTargetHospsStr] = useState("");

  const [academicResources, setAcademicResources] = useState<any[]>([]);
  const productResourceDownloadLocks = useRef(new Set<string>());
  const [downloadingResourceIds, setDownloadingResourceIds] = useState<Set<string>>(new Set());
  const [resourceDownloadErrors, setResourceDownloadErrors] = useState<Record<string, string>>({});

  const handleProductResourceDownload = async (resource: any) => {
    const resourceId = String(resource?.resourceId || resource?.id || "").trim();
    if (!resourceId || productResourceDownloadLocks.current.has(resourceId)) return;
    setDownloadingResourceIds(current => new Set(current).add(resourceId));
    setResourceDownloadErrors(current => { const next = { ...current }; delete next[resourceId]; return next; });
    try {
      await runProductDetailResourceDownload(resource, productResourceDownloadLocks.current);
    } catch (error) {
      console.warn("[ProductList] Authorized Resource download failed:", error);
      setResourceDownloadErrors(current => ({ ...current, [resourceId]: isRtl ? "تعذر تنزيل المورد. تحقق من صلاحية الوصول وحاول مرة أخرى." : "Unable to download this Resource. Check access and try again." }));
    } finally {
      setDownloadingResourceIds(current => { const next = new Set(current); next.delete(resourceId); return next; });
    }
  };

  // Product-specific field-ready discovery through the trusted backend.
  useEffect(() => {
    let cancelled = false;
    if (!selectedProductDetails?.id) { setAcademicResources([]); return () => { cancelled = true; }; }
    void discoverProductResources(selectedProductDetails.id).then(({ resources }) => {
      if (!cancelled) setAcademicResources(resources.map(resource => ({ ...resource, readContext: { purpose: "PRODUCT_DETAIL", productId: selectedProductDetails.id } })));
    }).catch(err => { if (!cancelled) { console.warn("[ProductList] Authorized Resource discovery failed:", err); setAcademicResources([]); } });
    return () => { cancelled = true; };
  }, [selectedProductDetails?.id]);

  React.useEffect(() => {
    if (selectedProductDetails) {
      setDetailsTab("general");
      setIsEditingProfile(false);
      setProfileDraft(selectedProductDetails.promotionProfile || {});
      
      const p = selectedProductDetails.promotionProfile || {};
      setTargetSpecsStr(Array.isArray(p.targetSpecialties) ? p.targetSpecialties.join(", ") : "");
      setTargetPharmsStr(Array.isArray(p.targetPharmacyTypes) ? p.targetPharmacyTypes.join(", ") : "");
      setTargetHospsStr(Array.isArray(p.targetHospitals) ? p.targetHospitals.join(", ") : "");
    }
  }, [selectedProductDetails]);



  // Dialogue specific inputs
  const [newStockInput, setNewStockInput] = useState("");
  const [scheduledPriceInput, setScheduledPriceInput] = useState("");
  const [scheduledPriceDate, setScheduledPriceDate] = useState("");

  // Inline menu overlay state
  const [activeDropdownId, setActiveDropdownId] = useState<string | null>(null);

  // Collect unique lists for filter select options
  const uniqueTherapeuticAreas = useMemo(() => {
    return [
      "Physician Direct promotion Program",
      "Patient engagements Program",
      "Patient/pharmacy/ physician engagements Program"
    ];
  }, []);

  // Canonical authorization is applied before all presentation filtering.
  const displayProducts = useMemo(() => {
    const legacyVisibleProducts = applySecurityScope(products as any[], getCurrentUserScope(currentUser)) as Product[];
    return authorizeProductListProducts({
      currentUser,
      products: legacyVisibleProducts,
      operationalScopeSession,
    });
  }, [products, currentUser, operationalScopeSession]);

  const uniqueBrands = useMemo(() => {
    return Array.from(new Set(displayProducts.map(p => p.promotionGroupName || p.brand))).filter(Boolean);
  }, [displayProducts]);

  // Handle clearing filters
  const handleClearFilters = () => {
    setSearchTerm("");
    setSelectedPromotionType("All");
    setSelectedBrand("All");
    setSortOrder("Default");
    setShowInactive(false);
    setShowUat(false);
  };

  // Main list processing
  const filteredAndSortedProducts = useMemo(() => {
    return filterProductListForPresentation(displayProducts, {
      searchTerm,
      selectedPromotionType,
      selectedBrand,
      sortOrder,
      showInactive,
      showUat,
    });
  }, [displayProducts, searchTerm, selectedPromotionType, selectedBrand, sortOrder, showInactive, showUat]);

  // Pagination calculation
  const totalPages = Math.ceil(filteredAndSortedProducts.length / itemsPerPage);
  const paginatedProducts = filteredAndSortedProducts.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  // Bulk actions toggle
  const handleToggleSelectAll = () => {
    if (selectedProductIds.length === filteredAndSortedProducts.length) {
      setSelectedProductIds([]);
    } else {
      setSelectedProductIds(filteredAndSortedProducts.map(p => p.id));
    }
  };

  const handleToggleSelectProduct = (id: string) => {
    if (selectedProductIds.includes(id)) {
      setSelectedProductIds(prev => prev.filter(item => item !== id));
    } else {
      setSelectedProductIds(prev => [...prev, id]);
    }
  };

  const selectedRelationship = marketRelationships.find(value => value.companyId === selectedCompanyId && value.marketId === selectedMarketId);
  const marketStatusByProduct = useMemo(() => new Map((marketStatus?.items || []).map(item => [item.productId, item])), [marketStatus]);

  const loadMarketState = (relationship: ProductMarketRelationshipOption) => {
      setMarketStatus({ companyId: relationship.companyId, marketId: relationship.marketId, countryId: "", currencyCode: relationship.currencyCode, items: relationship.configurations });
      setMarketDrafts(Object.fromEntries(relationship.configurations.map(item => [item.productId, {
        unitPrice: item.configured && item.unitPrice !== undefined ? String(item.unitPrice) : "",
        active: item.configured ? item.active === true : true,
        saleable: item.configured ? item.saleable === true : true,
      }])));
  };

  const openConfigureMarket = async () => {
    if (!hasConfigureMarketAccess || selectedProductIds.length === 0) return;
    setIsMarketModalOpen(true); setMarketBusy(true); setMarketError(""); setMarketStatus(null);
    try {
      const relationships = await getProductMarketRelationships(selectedProductIds);
      setMarketRelationships(relationships);
      const first = relationships[0];
      if (first) { setSelectedCompanyId(first.companyId); setSelectedMarketId(first.marketId); loadMarketState(first); }
    } catch (error) { setMarketError(error instanceof Error ? error.message : "PRODUCT_MARKET_READ_FAILED"); }
    finally { setMarketBusy(false); }
  };

  const saveMarketConfiguration = async () => {
    if (!selectedRelationship) return;
    const items = selectedProductIds.map(productId => {
      const identity = selectedRelationship.configurations.find(item => item.productId === productId && item.configured);
      return { productId, unitPrice: Number(marketDrafts[productId]?.unitPrice), active: marketDrafts[productId]?.active === true, saleable: marketDrafts[productId]?.saleable === true, ...(identity ? { catalogEntryId: identity.catalogEntryId, effectiveFrom: identity.effectiveFrom } : {}) };
    });
    if (items.some(item => marketDrafts[item.productId]?.unitPrice.trim() === "" || !Number.isFinite(item.unitPrice) || item.unitPrice < 0)) { setMarketError("PRODUCT_MARKET_INVALID_PRICE"); return; }
    if (!window.confirm(isRtl ? "هل تريد حفظ إعدادات السوق للمنتجات المحددة؟" : "Save market configuration for the selected products?")) return;
    setMarketBusy(true); setMarketError("");
    try { const response = await saveProductMarketCatalog(selectedCompanyId, selectedMarketId, items); setMarketStatus(response); setIsMarketModalOpen(false); }
    catch (error) { setMarketError(error instanceof Error ? error.message : "PRODUCT_MARKET_WRITE_FAILED"); }
    finally { setMarketBusy(false); }
  };

  // Open modals
  const handleOpenAddModal = () => {
    setFormMode("add");
    setEditingProduct(null);
    setIsFormModalOpen(true);
  };

  const handleOpenEditModal = (p: Product) => {
    setFormMode("edit");
    setEditingProduct(p);
    setIsFormModalOpen(true);
  };

  // Toggle active/inactive status
  const handleToggleProductStatus = (p: Product) => {
    if (onUpdateProduct) {
      onUpdateProduct({
        ...p,
        isActive: p.isActive === false ? true : false
      });
    }
  };

  // Delete product with confirm
  const handleDeleteProductClick = (id: string, name: string) => {
    const isConfirmed = window.confirm(`Are you sure you want to delete "${name}"?`);
    if (isConfirmed && onDeleteProduct) {
      onDeleteProduct(id);
    }
  };

  // Stock Adjustment Submit
  const handleSaveAdjustStock = (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustStockProduct || !onUpdateProduct) return;
    const newStock = parseInt(newStockInput);
    if (!isNaN(newStock) && newStock >= 0) {
      onUpdateProduct({
        ...adjustStockProduct,
        stock: newStock,
        stockQuantity: newStock
      });
      setAdjustStockProduct(null);
    }
  };

  // Future Price Scheduler Submit
  const handleSaveScheduledPrice = (e: React.FormEvent) => {
    e.preventDefault();
    if (!schedulePriceProduct || !onUpdateProduct) return;
    const newPrice = parseFloat(scheduledPriceInput);
    if (!isNaN(newPrice) && newPrice > 0) {
      if (!resolveFinancialIdentity([schedulePriceProduct as any, currentUser as any])) return;
      onUpdateProduct({
        ...schedulePriceProduct,
        price: newPrice,
        description: schedulePriceProduct.description || ""
      });
      setSchedulePriceProduct(null);
    }
  };

  // Show only the current canonical value until persisted price-audit events are available.
  const priceHistoryList = useMemo(() => {
    if (!viewPriceHistoryProduct) return [];
    return [{ date: "—", price: viewPriceHistoryProduct.price, remark: "Current persisted product price" }];
  }, [viewPriceHistoryProduct]);

  // Generate Mock Stock History Logs
  const stockHistoryList = useMemo(() => {
    if (!viewStockHistoryProduct) return [];
    return [
      { date: "2026-06-25", quantity: "+500 packs", source: "Inbound central logistics replenishment", current: viewStockHistoryProduct.stock },
      { date: "2026-06-23", quantity: "-20 packs", source: "Medical rep promotional sample distribution", current: viewStockHistoryProduct.stock + 20 },
      { date: "2026-06-20", quantity: "-150 packs", source: "Sales Order ORD-981 checkout", current: viewStockHistoryProduct.stock + 170 }
    ];
  }, [viewStockHistoryProduct]);

  return (
    <div className="space-y-6" id="product-catalog-root" dir={isRtl ? "rtl" : "ltr"}>
      
      {/* Title Header with Add Button & Export Button */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-5">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 dark:text-white leading-none">
            {isRtl ? "الأدوية والمستحضرات" : "Products"}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 font-medium">
            {isRtl ? "إدارة وتصنيف كتالوج المنتجات الصيدلانية" : "Manage product catalog"}
          </p>
        </div>
        <div className="flex items-center gap-3 self-start sm:self-auto">
          {hasConfigureMarketAccess && (
            <button disabled={selectedProductIds.length === 0} onClick={openConfigureMarket} className="flex items-center justify-center gap-2 px-3.5 py-2 border border-blue-200 dark:border-blue-900 text-blue-700 dark:text-blue-300 font-semibold text-xs rounded-lg disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer">
              <Globe size={14} /><span>{isRtl ? "إعداد السوق" : "Configure Market"}</span>
            </button>
          )}
          <button
            onClick={() => {
              import("xlsx").then((XLSX) => {
                const headers = TemplateSchemas.products.filter(f => f.exportable).map(f => f.label);
                
                const data = [headers];
                
                products.forEach(prod => {
                  const exportedObj = mapRecordForExport(prod, "products");
                  const row = headers.map(header => exportedObj[header] || "");
                  data.push(row);
                });
                
                const worksheet = XLSX.utils.aoa_to_sheet(data);
                const workbook = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(workbook, worksheet, "Products");
                
                XLSX.writeFile(workbook, `products_export_${new Date().toISOString().split("T")[0]}.xlsx`);
              });
            }}
            className="flex items-center justify-center gap-2 px-3.5 py-2 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold text-xs rounded-lg shadow-sm transition-all cursor-pointer"
          >
            <Download size={14} />
            <span>{isRtl ? "تصدير Excel" : "Export Excel"}</span>
          </button>
          {hasCreateAccess && (
            <button
              onClick={handleOpenAddModal}
              className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-lg shadow-sm transition-all cursor-pointer"
            >
              <Plus size={15} />
              <span>{isRtl ? "إضافة منتج جديد" : "Add Product"}</span>
            </button>
          )}
        </div>
      </div>

      {/* Screenshot Filter Layout */}
      <div className="bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-800 p-4 rounded-xl flex flex-wrap items-center gap-3.5 shadow-2xs">
        
        {/* Search by name, code, brand */}
        <div className="relative min-w-[240px] flex-1">
          <Search className={`absolute ${isRtl ? "right-3" : "left-3"} top-1/2 -translate-y-1/2 text-slate-400`} size={15} />
          <input
            type="text"
            placeholder={isRtl ? "البحث بالاسم، الرمز (SKU)، مجموعة الترويج أو عائلة المنتج..." : "Search by Product Name, SKU, Promotion Group or Product Family..."}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className={`w-full ${isRtl ? "pr-9 pl-4" : "pl-9 pr-4"} py-2 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-white dark:bg-slate-950 text-slate-800 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-blue-500`}
          />
        </div>

        {/* Promotion Types (Specialty Dropdown) */}
        <select
          value={selectedPromotionType}
          onChange={(e) => setSelectedPromotionType(e.target.value)}
          className="px-3 py-2 border border-slate-200 dark:border-slate-850 bg-white dark:bg-slate-950 rounded-lg text-xs text-slate-700 dark:text-slate-300 focus:outline-none focus:border-blue-500 font-semibold cursor-pointer"
        >
          <option value="All">{isRtl ? "جميع أنواع الترويج" : "All Promotion Types"}</option>
          {uniqueTherapeuticAreas.map(ta => (
            <option key={ta} value={ta}>{ta}</option>
          ))}
        </select>

        {/* Product Promotion Group Dropdown */}
        <select
          value={selectedBrand}
          onChange={(e) => setSelectedBrand(e.target.value)}
          className="px-3 py-2 border border-slate-200 dark:border-slate-850 bg-white dark:bg-slate-950 rounded-lg text-xs text-slate-700 dark:text-slate-300 focus:outline-none focus:border-blue-500 font-semibold cursor-pointer"
        >
          <option value="All">{isRtl ? "جميع مجموعات الترويج" : "All Promotion Groups"}</option>
          {uniqueBrands.map(b => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>

        {/* Sort/Ordering (Default) Dropdown */}
        <select
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value)}
          className="px-3 py-2 border border-slate-200 dark:border-slate-850 bg-white dark:bg-slate-950 rounded-lg text-xs text-slate-700 dark:text-slate-300 focus:outline-none focus:border-blue-500 font-semibold cursor-pointer"
        >
          <option value="Default">{isRtl ? "الترتيب الافتراضي" : "Default"}</option>
          <option value="price-asc">{isRtl ? "السعر: من الأقل للأعلى" : "Price: Low to High"}</option>
          <option value="price-desc">{isRtl ? "السعر: من الأعلى للأقل" : "Price: High to Low"}</option>
          <option value="stock-asc">{isRtl ? "المخزون: من الأقل للأعلى" : "Stock: Low to High"}</option>
          <option value="stock-desc">{isRtl ? "المخزون: من الأعلى للأقل" : "Stock: High to Low"}</option>
        </select>

        {/* Clear Filters Button */}
        {(searchTerm || selectedPromotionType !== "All" || selectedBrand !== "All" || sortOrder !== "Default" || showInactive || showUat) && (
          <button
            onClick={handleClearFilters}
            className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X size={14} />
            <span>{isRtl ? "إلغاء التصفية" : "Clear Filters"}</span>
          </button>
        )}

        {/* Show Inactive Filter */}
        <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-400 select-none cursor-pointer">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="rounded border-slate-300 dark:border-slate-700 text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
          />
          <span>{isRtl ? "إظهار غير النشط" : "Show inactive"}</span>
        </label>

        {/* Show UAT Products Filter */}
        <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-400 select-none cursor-pointer">
          <input
            type="checkbox"
            checked={showUat}
            onChange={(e) => setShowUat(e.target.checked)}
            className="rounded border-slate-300 dark:border-slate-700 text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
          />
          <span>{isRtl ? "إظهار منتجات UAT" : "Show UAT Products"}</span>
        </label>
      </div>

      {/* Main Grid / Table Content */}
      <div className="space-y-4" id="products-responsive-container">
        {filteredAndSortedProducts.length > 0 ? (
          <>
            {/* Mobile Card List (Visible on mobile, hidden on desktop/tablet) */}
            <MobileCardList
              data={filteredAndSortedProducts}
              keyExtractor={(p: Product) => p.id}
              lang={lang}
              itemsPerPage={5}
              itemName={{ en: "products", ar: "منتج" }}
              onAction={hasCreateAccess ? handleOpenAddModal : undefined}
              actionLabel={hasCreateAccess ? (lang === "ar" ? "إضافة منتج جديد" : "Add Product") : undefined}
              renderItem={(p: Product) => {
                const codeVal = p.sku || p.code || p.id.replace(/[A-Za-z]/g, "") || "306";
                const isSelected = selectedProductIds.includes(p.id);
                const isProductActive = p.isActive !== false;
                return (
                  <div 
                    className={`space-y-3 transition-all relative ${
                      !isProductActive ? "opacity-60 bg-slate-50/40 dark:bg-slate-900/20" : ""
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <h4 className="font-extrabold text-slate-950 dark:text-white text-xs uppercase leading-snug">
                          <TruncatedText text={p.name} className="font-extrabold text-slate-950 dark:text-white text-xs uppercase" />
                        </h4>
                        <div className="flex items-center gap-1.5 mt-1 text-[10px] text-slate-400 font-medium min-w-0">
                          <span className="font-mono tracking-wider bg-slate-50 dark:bg-slate-950 border border-slate-200/40 dark:border-slate-800 px-1 py-0.5 rounded text-[9px] shrink-0">
                            {codeVal}
                          </span>
                          <span className="shrink-0">•</span>
                          <TruncatedText text={p.promotionGroupName || p.brand} className="text-[10px] text-slate-400 font-medium" />
                        </div>
                      </div>
                      
                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        <span className="text-[11px] font-black text-blue-600 dark:text-blue-400 font-mono">
                          ${p.price.toFixed(2)}
                        </span>
                        <span className={`inline-block text-[9px] font-black px-1.5 py-0.5 rounded ${
                          (p.stockQuantity ?? p.stock) && (p.stockQuantity ?? p.stock) < 10 
                            ? "bg-amber-100 dark:bg-amber-950/40 text-amber-600" 
                            : "bg-slate-50 dark:bg-slate-800 text-slate-500"
                        }`}>
                          {(p.stockQuantity ?? p.stock) !== undefined ? `${(p.stockQuantity ?? p.stock)} Units` : "No Stock info"}
                        </span>
                      </div>
                    </div>

                    <div className="border-t border-slate-100 dark:border-slate-800/60" />

                    <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-[10px] text-slate-600 dark:text-slate-300">
                      <div className="min-w-0">
                        <span className="block text-[9px] text-slate-400 font-semibold uppercase">
                          {isRtl ? "الشركة المصنعة" : "Manufacturer"}
                        </span>
                        <TruncatedText text={p.manufacturer || "-"} className="block font-medium text-slate-800 dark:text-slate-200" />
                      </div>
                      <div className="min-w-0">
                        <span className="block text-[9px] text-slate-400 font-semibold uppercase">
                          {isRtl ? "النوع" : "Promo Type"}
                        </span>
                        <TruncatedText text={p.therapeuticArea || "-"} className="block font-semibold text-blue-500" />
                      </div>
                    </div>

                    <div className="border-t border-slate-100 dark:border-slate-800/60" />

                    <div className="flex items-center justify-between gap-1 pt-1 text-[10px]">
                      <button
                        onClick={() => {
                          setSelectedProductDetails(p);
                        }}
                        className="px-2.5 py-1 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded font-semibold transition-all border border-slate-200/50 dark:border-slate-700 cursor-pointer"
                      >
                        {isRtl ? "تفاصيل" : "Details"}
                      </button>

                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => {
                            if (onUpdateProduct) {
                              handleOpenEditModal(p);
                            } else {
                              alert("Update action not supported.");
                            }
                          }}
                          className="px-2 py-1 text-slate-500 hover:text-blue-600 font-semibold transition-colors cursor-pointer"
                        >
                          {isRtl ? "تعديل" : "Edit"}
                        </button>
                        <button
                          onClick={() => {
                            if (onDeleteProduct) {
                              if (confirm(isRtl ? `هل أنت متأكد من حذف المنتج ${p.name}؟` : `Are you sure you want to delete ${p.name}?`)) {
                                onDeleteProduct(p.id);
                              }
                            } else {
                              alert("Delete action not supported.");
                            }
                          }}
                          className="p-1 text-slate-300 hover:text-rose-500 transition-colors cursor-pointer"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              }}
            />

            {/* Desktop Table View - Hidden on Mobile */}
            <div className="hidden md:block bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-800 rounded-xl overflow-hidden shadow-2xs" id="products-desktop-table-container">
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 dark:bg-slate-950 text-[10.5px] uppercase font-bold text-slate-500 tracking-wider border-b border-slate-150 dark:border-slate-800">
                    <tr>
                      <th className="p-3.5 w-10 text-center">
                        <input
                          type="checkbox"
                          checked={filteredAndSortedProducts.length > 0 && selectedProductIds.length === filteredAndSortedProducts.length}
                          onChange={handleToggleSelectAll}
                          className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                        />
                      </th>
                      <th className="p-3.5 w-20">{isRtl ? "الرمز" : "CODE"}</th>
                      <th className="p-3.5 min-w-[200px]">{isRtl ? "المنتج" : "PRODUCT"}</th>
                      <th className="p-3.5">{isRtl ? "المجموعة الترويجية" : "PROMOTION GROUP"}</th>
                      <th className="p-3.5">{isRtl ? "الشركة المصنعة" : "MANUFACTURER"}</th>
                      <th className="p-3.5 text-right">{isRtl ? "السعر" : "PRICE"}</th>
                      <th className="p-3.5 text-center">{isRtl ? "المخزون" : "STOCK"}</th>
                      <th className="p-3.5 text-center">{isRtl ? "الحالة" : "STATUS"}</th>
                      <th className="p-3.5 w-32 text-center">{isRtl ? "الإجراءات" : "ACTIONS"}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                    {paginatedProducts.map((p) => {
                      const codeVal = p.sku || p.code || p.id.replace(/[A-Za-z]/g, "") || "306";
                      const isSelected = selectedProductIds.includes(p.id);
                      const isProductActive = p.isActive !== false;
                      
                      return (
                        <tr 
                          key={p.id} 
                          className={`hover:bg-slate-50/50 dark:hover:bg-slate-950/20 transition-colors ${!isProductActive ? "opacity-60 bg-slate-50/20 dark:bg-slate-950/5" : ""}`}
                        >
                          {/* Select Row Checkbox */}
                          <td className="p-3.5 text-center">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => handleToggleSelectProduct(p.id)}
                              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                            />
                          </td>

                          {/* Code */}
                          <td className="p-3.5 font-mono font-bold text-slate-500">
                            {codeVal}
                          </td>

                          {/* Product Name */}
                          <td className="p-3.5">
                            <div className="flex items-center gap-1.5 font-extrabold text-slate-900 dark:text-white uppercase leading-snug">
                              <span>{p.name}</span>
                              {p.isTestData && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-400 border border-rose-200 dark:border-rose-900/40">
                                  UAT
                                </span>
                              )}
                            </div>
                            {p.description && (
                              <div className="text-[10px] text-slate-400 mt-0.5 line-clamp-1 italic">
                                {p.description}
                              </div>
                            )}
                            {marketStatus?.companyId === selectedCompanyId && marketStatus?.marketId === selectedMarketId && (
                              <div className="text-[10px] font-semibold text-slate-500 mt-1">
                                {marketStatusByProduct.get(p.id)?.configured
                                  ? `${isRtl ? "تم الإعداد" : "Configured"} — ${marketStatusByProduct.get(p.id)!.unitPrice} ${marketStatus.currencyCode}`
                                  : (isRtl ? "غير مُعد" : "Not configured")}
                              </div>
                            )}
                          </td>

                          {/* Brand */}
                          <td className="p-3.5 font-semibold text-slate-600 dark:text-slate-400">
                            <div className="text-indigo-600 dark:text-indigo-400 font-bold">{p.promotionGroupName || p.brand}</div>
                            {p.productFamily && (
                              <div className="text-[10px] text-slate-400 font-mono italic">Family: {p.productFamily}</div>
                            )}
                          </td>

                          {/* Manufacturer */}
                          <td className="p-3.5 text-slate-500 font-medium">
                            {p.manufacturer || "PELLA DERMA"}
                          </td>

                          {/* Canonical market currency */}
                          <td className="p-3.5 text-right font-bold font-mono text-slate-800 dark:text-slate-200">
                            {productMoney(p.price, p)}
                          </td>

                          {/* Stock level */}
                          <td className="p-3.5 text-center font-bold font-mono text-slate-600 dark:text-slate-300">
                            {p.stockQuantity ?? p.stock}
                          </td>

                          {/* Status Pill */}
                          <td className="p-3.5 text-center">
                            {!isProductActive ? (
                              <span className="inline-block px-2 py-0.5 text-[9.5px] font-bold rounded-md uppercase tracking-wider bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                                {isRtl ? "غير نشط" : "Inactive"}
                              </span>
                            ) : (p.stockQuantity ?? p.stock) === 0 ? (
                              <span className="inline-block px-2 py-0.5 text-[9.5px] font-bold rounded-md uppercase tracking-wider bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400 border border-rose-100 dark:border-rose-900/40">
                                {isRtl ? "نفذ" : "Out of Stock"}
                              </span>
                            ) : (
                              <span className="inline-block px-2.5 py-0.5 text-[9.5px] font-extrabold rounded-md uppercase tracking-wider bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400 border border-blue-100 dark:border-blue-900/40">
                                {isRtl ? "متاح" : "In Stock"}
                              </span>
                            )}
                          </td>

                          {/* Actions panel matching screenshot rows */}
                          <td className="p-3.5">
                            <div className="flex items-center justify-center gap-2">
                              {/* Detailing view */}
                              <button
                                onClick={() => setSelectedProductDetails(p)}
                                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg cursor-pointer transition-colors"
                                title="View Details"
                              >
                                <Eye size={14} />
                              </button>

                              {/* Edit icon */}
                              <button
                                onClick={() => handleOpenEditModal(p)}
                                className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg cursor-pointer transition-colors"
                                title="Edit"
                              >
                                <Edit2 size={13} />
                              </button>

                              {/* Status Toggle link as seen in the screenshot */}
                              <button
                                onClick={() => handleToggleProductStatus(p)}
                                className={`text-[10px] font-bold px-1.5 py-0.5 rounded cursor-pointer transition-colors ${
                                  isProductActive 
                                    ? "text-slate-400 hover:text-rose-500 hover:bg-rose-50/50" 
                                    : "text-emerald-500 hover:text-emerald-600 hover:bg-emerald-50/50"
                                }`}
                              >
                                {isProductActive 
                                  ? (isRtl ? "تعطيل" : "Deactivate") 
                                  : (isRtl ? "تفعيل" : "Activate")}
                              </button>

                              {/* Trash icon */}
                              {onDeleteProduct && (
                                <button
                                  onClick={() => handleDeleteProductClick(p.id, p.name)}
                                  className="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg cursor-pointer transition-colors"
                                  title="Delete"
                                >
                                  <Trash2 size={13} />
                                </button>
                              )}

                              {/* Dropdown overlay panel triggers ("...") */}
                              <div className="relative">
                                <button
                                  onClick={() => setActiveDropdownId(activeDropdownId === p.id ? null : p.id)}
                                  className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg cursor-pointer transition-colors"
                                >
                                  <MoreHorizontal size={14} />
                                </button>

                                {activeDropdownId === p.id && (
                                  <>
                                    {/* Backdrop */}
                                    <div className="fixed inset-0 z-10" onClick={() => setActiveDropdownId(null)} />
                                    <div className={`absolute ${isRtl ? "left-0" : "right-0"} mt-1 w-44 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-850 rounded-lg shadow-md py-1.5 z-20 text-[11px] font-semibold animate-fade-in text-slate-700 dark:text-slate-300`}>
                                      <button
                                        onClick={() => {
                                          setAdjustStockProduct(p);
                                          setNewStockInput(p.stock.toString());
                                          setActiveDropdownId(null);
                                        }}
                                        className="w-full text-left px-3.5 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-2 cursor-pointer"
                                      >
                                        <Package size={13} className="text-slate-400" />
                                        <span>{isRtl ? "تعديل مستويات المخزون" : "Adjust stock"}</span>
                                      </button>
                                      <button
                                        onClick={() => {
                                          setSchedulePriceProduct(p);
                                          setScheduledPriceInput(p.price.toString());
                                          setScheduledPriceDate(new Date(Date.now() + 86400000 * 7).toISOString().split("T")[0]);
                                          setActiveDropdownId(null);
                                        }}
                                        className="w-full text-left px-3.5 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-2 cursor-pointer"
                                      >
                                        <Calendar size={13} className="text-slate-400" />
                                        <span>{isRtl ? "جدولة تغيير السعر" : "Schedule price change"}</span>
                                      </button>
                                      <button
                                        onClick={() => {
                                          setViewPriceHistoryProduct(p);
                                          setActiveDropdownId(null);
                                        }}
                                        className="w-full text-left px-3.5 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-2 cursor-pointer"
                                      >
                                        <TrendingUp size={13} className="text-slate-400" />
                                        <span>{isRtl ? "سجل الأسعار" : "Price history"}</span>
                                      </button>
                                      <button
                                        onClick={() => {
                                          setViewStockHistoryProduct(p);
                                          setActiveDropdownId(null);
                                        }}
                                        className="w-full text-left px-3.5 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-2 cursor-pointer"
                                      >
                                        <History size={13} className="text-slate-400" />
                                        <span>{isRtl ? "سجل المخزون" : "Stock history"}</span>
                                      </button>
                                    </div>
                                  </>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>



            {/* Pagination Controls */}
            <div className="hidden md:block">
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                totalItems={filteredAndSortedProducts.length}
                itemsPerPage={itemsPerPage}
                onPageChange={setCurrentPage}
                onItemsPerPageChange={setItemsPerPage}
                lang={lang}
                itemNameEn="products"
                itemNameAr="منتج"
              />
            </div>
          </>
        ) : (
          <NoDataState
            title={lang === "ar" ? "لم يتم العثور على أدوية أو منتجات" : "No Products Found"}
            description={lang === "ar" 
              ? "لم يتم العثور على أدوية مطابقة لمعايير البحث الحالية. يمكنك البدء بإضافة منتج جديد." 
              : "No products found matching your search filters. Get started by adding a new product to the catalog."
            }
            onAction={hasCreateAccess ? handleOpenAddModal : undefined}
            actionLabel={hasCreateAccess ? (lang === "ar" ? "إضافة منتج جديد" : "Add Product") : undefined}
            icon={Package}
            lang={lang}
          />
        )}
      </div>

      {/* Product Details Detailing Modal */}
      {selectedProductDetails && (() => {
        const hasEditAccess = hasPermission(currentUser, "Products", "edit");
        const profile = selectedProductDetails.promotionProfile;
        
        const isProfileEmpty = () => {
          if (!profile) return true;
          const businessKeys = [
            "positioning", "positioningArabic", "usp", "promotionObjectives", 
            "promotionPriority", "targetSpecialties", "targetPharmacyTypes", 
            "targetHospitals", "promotionNotes", "promotionNotesArabic", 
            "launchStatus", "promotionStatus"
          ];
          return !businessKeys.some(k => {
            const val = (profile as any)[k];
            if (Array.isArray(val)) return val.length > 0;
            return val !== undefined && val !== null && val !== "";
          });
        };

        return (
          <div className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-xs">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-2xl shadow-2xl relative animate-fade-in flex flex-col max-h-[90vh]">
              
              {/* Header */}
              <div className="flex justify-between items-center px-6 py-4 border-b border-slate-100 dark:border-slate-800 shrink-0">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <Package size={18} className="text-blue-500" />
                    <h3 className="font-extrabold text-base text-slate-900 dark:text-white uppercase tracking-tight">
                      {selectedProductDetails.name}
                    </h3>
                    {selectedProductDetails.nameAr && (
                      <span className="text-sm font-medium text-slate-500 dark:text-slate-400 font-sans" dir="rtl">
                        ({selectedProductDetails.nameAr})
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] font-mono text-slate-400">
                    SKU: {selectedProductDetails.sku || selectedProductDetails.code || selectedProductDetails.id} • Promotion Group: {selectedProductDetails.promotionGroupName || selectedProductDetails.brand}
                  </p>
                </div>
                <button 
                  onClick={() => {
                    setSelectedProductDetails(null);
                    setIsEditingProfile(false);
                  }} 
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer p-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-full transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Tabs Switcher */}
              <div className="flex border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/20 px-6 py-1.5 shrink-0 animate-fade-in">
                <button
                  onClick={() => {
                    if (!isEditingProfile) setDetailsTab("general");
                  }}
                  disabled={isEditingProfile}
                  className={`px-4 py-2 text-xs font-bold border-b-2 transition-all cursor-pointer ${
                    detailsTab === "general"
                      ? "border-blue-500 text-blue-600 dark:text-blue-400"
                      : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                  } ${isEditingProfile ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  {lang === "ar" ? "تفاصيل المنتج (عام)" : "General Info"}
                </button>
                <button
                  onClick={() => {
                    if (!isEditingProfile) setDetailsTab("promotion");
                  }}
                  disabled={isEditingProfile}
                  className={`px-4 py-2 text-xs font-bold border-b-2 transition-all cursor-pointer ${
                    detailsTab === "promotion"
                      ? "border-blue-500 text-blue-600 dark:text-blue-400"
                      : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                  } ${isEditingProfile ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  {lang === "ar" ? "الملف الترويجي" : "Promotion Profile"}
                </button>
                <button
                  onClick={() => {
                    if (!isEditingProfile) setDetailsTab("key-messages");
                  }}
                  disabled={isEditingProfile}
                  className={`px-4 py-2 text-xs font-bold border-b-2 transition-all cursor-pointer ${
                    detailsTab === "key-messages"
                      ? "border-blue-500 text-blue-600 dark:text-blue-400"
                      : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                  } ${isEditingProfile ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  {lang === "ar" ? "الرسائل الأساسية" : "Key Messages"}
                </button>
                <button
                  onClick={() => {
                    if (!isEditingProfile) setDetailsTab("resources");
                  }}
                  disabled={isEditingProfile}
                  className={`px-4 py-2 text-xs font-bold border-b-2 transition-all cursor-pointer ${
                    detailsTab === "resources"
                      ? "border-blue-500 text-blue-600 dark:text-blue-400"
                      : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                  } ${isEditingProfile ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  {lang === "ar" ? "المصادر والمطويات" : "Resources"}
                </button>
              </div>

              {/* Scrollable Content */}
              <div className="p-6 overflow-y-auto space-y-5 text-xs flex-1">
                {detailsTab === "general" && (
                  <div className="space-y-4 animate-fade-in">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <span className="text-[10px] text-slate-400 font-extrabold uppercase block tracking-wider mb-0.5">Product Name</span>
                        <span className="text-xs font-bold text-slate-800 dark:text-white uppercase">{selectedProductDetails.name}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 font-extrabold uppercase block tracking-wider mb-0.5">Arabic Name (الاسم بالكامل)</span>
                        <span className="text-xs font-bold text-slate-800 dark:text-white font-sans">{selectedProductDetails.nameAr || "—"}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 font-extrabold uppercase block tracking-wider mb-0.5">Product SKU / Code</span>
                        <span className="text-xs font-mono font-bold text-slate-800 dark:text-white">{selectedProductDetails.sku || selectedProductDetails.code || selectedProductDetails.id}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 font-extrabold uppercase block tracking-wider mb-0.5">Promotion Group</span>
                        <span className="text-xs font-bold text-slate-800 dark:text-white">{selectedProductDetails.promotionGroupName || selectedProductDetails.brand || "—"}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 font-extrabold uppercase block tracking-wider mb-0.5">Product Family</span>
                        <span className="text-xs font-bold text-slate-800 dark:text-white">{selectedProductDetails.productFamily || "—"}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 font-extrabold uppercase block tracking-wider mb-0.5">Manufacturer</span>
                        <span className="text-xs font-bold text-slate-800 dark:text-white">{selectedProductDetails.manufacturer || "PELLA DERMA"}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 font-extrabold uppercase block tracking-wider mb-0.5">Product Type</span>
                        <span className="text-xs font-bold text-slate-800 dark:text-white">{selectedProductDetails.productType || "—"}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 font-extrabold uppercase block tracking-wider mb-0.5">Therapeutic Area</span>
                        <span className="text-xs font-bold text-slate-800 dark:text-white">{selectedProductDetails.therapeuticArea}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 font-extrabold uppercase block tracking-wider mb-0.5">Strength / Specification</span>
                        <span className="text-xs font-bold text-slate-800 dark:text-white">{selectedProductDetails.strength || "—"}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 font-extrabold uppercase block tracking-wider mb-0.5">Package Size</span>
                        <span className="text-xs font-bold text-slate-800 dark:text-white">{selectedProductDetails.packageSize || "—"}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 font-extrabold uppercase block tracking-wider mb-0.5">Price Tier</span>
                        <span className="text-xs font-mono font-bold text-slate-900 dark:text-blue-400">{productMoney(selectedProductDetails.price, selectedProductDetails)}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 font-extrabold uppercase block tracking-wider mb-0.5">Catalog Status</span>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-extrabold w-max ${
                          selectedProductDetails.isActive !== false
                            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900"
                            : "bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-400 border border-rose-100 dark:border-rose-900"
                        }`}>
                          {selectedProductDetails.isActive !== false ? "Active Catalog" : "Inactive / Archived"}
                        </span>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                      <span className="text-[10px] text-slate-400 font-extrabold uppercase block tracking-wider mb-1">Active Formula & Ingredients</span>
                      <p className="text-slate-600 dark:text-slate-300 italic leading-relaxed bg-slate-50 dark:bg-slate-950 p-3 rounded-xl border border-slate-100 dark:border-slate-850">
                        {selectedProductDetails.description || "No molecular indicators or ingredients specified."}
                      </p>
                    </div>

                    {/* Sample Information Section */}
                    <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
                      <span className="text-[10px] text-slate-400 font-extrabold uppercase block tracking-wider">
                        {lang === "ar" ? "معلومات عينات المستحضر" : "Sample Information"}
                      </span>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 dark:bg-slate-950 p-4 rounded-xl border border-slate-100 dark:border-slate-850">
                        <div>
                          <span className="text-[10px] text-slate-400 font-extrabold uppercase block tracking-wider mb-0.5">Product Type</span>
                          <span className="text-xs font-bold text-slate-800 dark:text-white uppercase">
                            {selectedProductDetails.isSample === "Yes" || selectedProductDetails.isSampleSku ? (lang === "ar" ? "مستحضر عينة" : "Sample SKU") : (lang === "ar" ? "مستحضر تجاري" : "Commercial SKU")}
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-400 font-extrabold uppercase block tracking-wider mb-0.5">Can Generate Samples?</span>
                          <span className="text-xs font-bold text-slate-800 dark:text-white">
                            {selectedProductDetails.isSampleable || (selectedProductDetails.canGenerateSamples ? "Yes" : "No")}
                          </span>
                        </div>
                        {(selectedProductDetails.isSample === "Yes" || selectedProductDetails.isSampleSku) && (
                          <>
                            <div>
                              <span className="text-[10px] text-slate-400 font-extrabold uppercase block tracking-wider mb-0.5">Parent Product Name</span>
                              <span className="text-xs font-bold text-slate-800 dark:text-white">
                                {selectedProductDetails.parentProductName || "—"}
                              </span>
                            </div>
                            <div>
                              <span className="text-[10px] text-slate-400 font-extrabold uppercase block tracking-wider mb-0.5">Parent Product SKU</span>
                              <span className="text-xs font-mono font-bold text-slate-800 dark:text-white">
                                {selectedProductDetails.parentProductSku || "—"}
                              </span>
                            </div>
                          </>
                        )}
                        {(selectedProductDetails.isSample === "Yes" || selectedProductDetails.isSampleSku || selectedProductDetails.isSampleable === "Yes" || selectedProductDetails.canGenerateSamples) && (
                          <>
                            <div>
                              <span className="text-[10px] text-slate-400 font-extrabold uppercase block tracking-wider mb-0.5">Monthly Rep Sample Limit</span>
                              <span className="text-xs font-mono font-bold text-slate-800 dark:text-white">
                                {selectedProductDetails.monthlyRepSampleLimit !== undefined ? selectedProductDetails.monthlyRepSampleLimit : "—"}
                              </span>
                            </div>
                            <div>
                              <span className="text-[10px] text-slate-400 font-extrabold uppercase block tracking-wider mb-0.5">Monthly Physician Sample Limit</span>
                              <span className="text-xs font-mono font-bold text-slate-800 dark:text-white">
                                {selectedProductDetails.monthlyPhysicianSampleLimit !== undefined ? selectedProductDetails.monthlyPhysicianSampleLimit : "—"}
                              </span>
                            </div>
                          </>
                        )}
                      </div>
                    </div>

                    {selectedProductDetails.productImages && selectedProductDetails.productImages.length > 0 && (
                      <div className="pt-2">
                        <span className="text-[10px] text-slate-400 font-extrabold uppercase block tracking-wider mb-2">Product Master Images</span>
                        <div className="flex flex-wrap gap-3">
                          {selectedProductDetails.productImages.map((img, idx) => (
                            <img key={idx} src={img} alt="Product" className="w-20 h-20 object-cover rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs" referrerPolicy="no-referrer" />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {detailsTab === "promotion" && (
                  // Promotion Profile Tab Content
                  <div className="space-y-4 animate-fade-in">
                    {!isEditingProfile ? (
                      // View Mode
                      isProfileEmpty() ? (
                        // Empty State configuration
                        <div className="flex flex-col items-center justify-center text-center p-8 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl bg-slate-50/50 dark:bg-slate-950/10 space-y-4">
                          <div className="p-3 bg-slate-100 dark:bg-slate-800/80 rounded-full text-slate-400 dark:text-slate-500">
                            <Sparkles size={28} className="animate-pulse text-amber-500" />
                          </div>
                          <div className="space-y-1 max-w-md">
                            <h4 className="font-extrabold text-sm text-slate-800 dark:text-white">
                              {lang === "ar" ? "الملف الترويجي فارغ" : "Promotion Profile is Empty"}
                            </h4>
                            <p className="text-slate-500 dark:text-slate-400 leading-relaxed text-[11px]">
                              {lang === "ar" 
                                ? "لم يتم تكوين الملف الترويجي لهذا المنتج بعد. يمكن لمسؤولي التسويق أو مدراء المنتجات إثراء الملف بالتموضع السريري، الميزة التنافسية USP، والأهداف الترويجية." 
                                : "This product's promotion profile has not been configured yet. Marketing or Product managers can enrich this with clinical positioning, USP, and promotion target parameters."
                              }
                            </p>
                          </div>
                          {hasEditAccess && (
                            <button
                              onClick={() => setIsEditingProfile(true)}
                              className="inline-flex items-center gap-1.5 px-4.5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-extrabold rounded-lg transition-colors cursor-pointer shadow-xs"
                            >
                              <PenSquare size={14} />
                              <span>{lang === "ar" ? "إثراء الملف الترويجي" : "Enrich Promotion Profile"}</span>
                            </button>
                          )}
                        </div>
                      ) : (
                        // Render Profile Details
                        <div className="space-y-4">
                          <div className="flex justify-between items-center bg-blue-50/50 dark:bg-blue-950/20 px-4 py-2.5 rounded-xl border border-blue-100/40 dark:border-blue-900/40">
                            <span className="text-[10px] font-extrabold uppercase text-blue-700 dark:text-blue-400">Target Promotion Strategy</span>
                            {hasEditAccess && (
                              <button
                                onClick={() => setIsEditingProfile(true)}
                                className="inline-flex items-center gap-1 px-2 py-1 bg-white hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-750 text-blue-600 dark:text-blue-400 font-extrabold rounded-md shadow-xs border border-slate-200 dark:border-slate-700 cursor-pointer"
                              >
                                <PenSquare size={12} />
                                <span>{lang === "ar" ? "تعديل" : "Edit Profile"}</span>
                              </button>
                            )}
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                              <span className="text-[10px] text-slate-400 font-extrabold uppercase block tracking-wider mb-0.5">Promotion Priority</span>
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                                profile?.promotionPriority === "High"
                                  ? "bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-400 border border-rose-100 dark:border-rose-900"
                                  : profile?.promotionPriority === "Medium"
                                  ? "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400 border border-amber-100 dark:border-amber-900"
                                  : "bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400 border border-blue-100 dark:border-blue-900"
                              }`}>
                                {profile?.promotionPriority || "Medium"} Priority
                              </span>
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <span className="text-[10px] text-slate-400 font-extrabold uppercase block tracking-wider mb-0.5">Launch Status</span>
                                <span className="text-xs font-bold text-slate-800 dark:text-white">{profile?.launchStatus || "—"}</span>
                              </div>
                              <div>
                                <span className="text-[10px] text-slate-400 font-extrabold uppercase block tracking-wider mb-0.5">Promotion Status</span>
                                <span className="text-xs font-bold text-slate-800 dark:text-white">{profile?.promotionStatus || "—"}</span>
                              </div>
                            </div>
                          </div>

                          <div className="space-y-3.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                            <div>
                              <span className="text-[10px] text-slate-400 font-extrabold uppercase block tracking-wider mb-1">Clinical Positioning (تموضع المنتج)</span>
                              <div className="space-y-1.5 p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-850">
                                {profile?.positioning && (
                                  <p className="text-slate-700 dark:text-slate-300 leading-relaxed font-sans">{profile.positioning}</p>
                                )}
                                {profile?.positioningArabic && (
                                  <p className="text-slate-600 dark:text-slate-300 leading-relaxed font-sans text-right" dir="rtl">{profile.positioningArabic}</p>
                                )}
                                {!profile?.positioning && !profile?.positioningArabic && (
                                  <span className="text-slate-400 italic block">No clinical positioning defined.</span>
                                )}
                              </div>
                            </div>

                            <div>
                              <span className="text-[10px] text-slate-400 font-extrabold uppercase block tracking-wider mb-1">Unique Selling Proposition (USP)</span>
                              <div className="p-3 rounded-xl bg-amber-50/20 dark:bg-amber-950/10 border border-amber-100/40 dark:border-amber-900/30">
                                <p className="text-slate-700 dark:text-slate-300 leading-relaxed font-medium">
                                  {profile?.usp || "No USP defined."}
                                </p>
                              </div>
                            </div>

                            <div>
                              <span className="text-[10px] text-slate-400 font-extrabold uppercase block tracking-wider mb-1">Promotion Objectives</span>
                              <p className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-850 text-slate-700 dark:text-slate-300 leading-relaxed">
                                {profile?.promotionObjectives || "No explicit objectives specified."}
                              </p>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 pt-1">
                              <div>
                                <span className="text-[10px] text-slate-400 font-extrabold uppercase block tracking-wider mb-1.5">Target Specialties</span>
                                <div className="flex flex-wrap gap-1">
                                  {profile?.targetSpecialties && profile.targetSpecialties.length > 0 ? (
                                    profile.targetSpecialties.map((s, idx) => (
                                      <span key={idx} className="px-2 py-0.5 bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border border-blue-100/50 dark:border-blue-900/50 rounded text-[9px] font-bold">
                                        {s}
                                      </span>
                                    ))
                                  ) : (
                                    <span className="text-slate-400 italic text-[10px]">All Specialties</span>
                                  )}
                                </div>
                              </div>

                              <div>
                                <span className="text-[10px] text-slate-400 font-extrabold uppercase block tracking-wider mb-1.5">Target Pharmacies</span>
                                <div className="flex flex-wrap gap-1">
                                  {profile?.targetPharmacyTypes && profile.targetPharmacyTypes.length > 0 ? (
                                    profile.targetPharmacyTypes.map((pType, idx) => (
                                      <span key={idx} className="px-2 py-0.5 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-100/50 dark:border-emerald-900/50 rounded text-[9px] font-bold">
                                        {pType}
                                      </span>
                                    ))
                                  ) : (
                                    <span className="text-slate-400 italic text-[10px]">All Pharmacy Types</span>
                                  )}
                                </div>
                              </div>

                              <div>
                                <span className="text-[10px] text-slate-400 font-extrabold uppercase block tracking-wider mb-1.5">Target Hospitals</span>
                                <div className="flex flex-wrap gap-1">
                                  {profile?.targetHospitals && profile.targetHospitals.length > 0 ? (
                                    profile.targetHospitals.map((h, idx) => (
                                      <span key={idx} className="px-2 py-0.5 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300 border border-indigo-100/50 dark:border-indigo-900/50 rounded text-[9px] font-bold">
                                        {h}
                                      </span>
                                    ))
                                  ) : (
                                    <span className="text-slate-400 italic text-[10px]">All Hospitals</span>
                                  )}
                                </div>
                              </div>
                            </div>

                            <div>
                              <span className="text-[10px] text-slate-400 font-extrabold uppercase block tracking-wider mb-1">Promotion Notes (ملاحظات ترويجية)</span>
                              <div className="space-y-1.5 p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-850">
                                {profile?.promotionNotes && (
                                  <p className="text-slate-700 dark:text-slate-300 leading-relaxed font-sans">{profile.promotionNotes}</p>
                                )}
                                {profile?.promotionNotesArabic && (
                                  <p className="text-slate-600 dark:text-slate-300 leading-relaxed font-sans text-right" dir="rtl">{profile.promotionNotesArabic}</p>
                                )}
                                {!profile?.promotionNotes && !profile?.promotionNotesArabic && (
                                  <span className="text-slate-400 italic block">No promotion notes added.</span>
                                )}
                              </div>
                            </div>

                            {profile?.updatedAt && (
                              <div className="flex justify-end gap-2 text-[9px] text-slate-400 font-medium pt-2 border-t border-slate-100 dark:border-slate-800">
                                <span>Updated: {new Date(profile.updatedAt).toLocaleString()}</span>
                                <span>•</span>
                                <span>By User: {profile.updatedBy || "unknown"}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    ) : (
                      // Edit Mode Form Configuration
                      <div className="space-y-4">
                        <div className="bg-amber-500/10 text-amber-700 dark:text-amber-400 p-3 rounded-xl text-[10px] font-semibold border border-amber-500/20">
                          {lang === "ar"
                            ? "تنبيه: التعديلات في هذا التبويب مخصصة حصرياً لمعلومات الترويج السريري والتسويق للمنتج ولن تؤثر على البيانات الأساسية للمخزون أو الأسعار."
                            : "Enrichment Warning: Modifying fields in this tab is strictly designated for marketing, clinical positioning, and promotional parameters. Basic product master specifications will remain completely untouched."
                          }
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className="text-[10px] text-slate-400 font-extrabold uppercase block tracking-wider mb-1">Promotion Priority</label>
                            <select
                              value={profileDraft.promotionPriority || "Medium"}
                              onChange={(e) => setProfileDraft({ ...profileDraft, promotionPriority: e.target.value })}
                              className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-white font-semibold cursor-pointer outline-none focus:border-blue-500"
                            >
                              <option value="High">High</option>
                              <option value="Medium">Medium</option>
                              <option value="Low">Low</option>
                            </select>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="text-[10px] text-slate-400 font-extrabold uppercase block tracking-wider mb-1">Launch Status</label>
                              <select
                                value={profileDraft.launchStatus || "Pre-launch"}
                                onChange={(e) => setProfileDraft({ ...profileDraft, launchStatus: e.target.value })}
                                className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-white font-semibold cursor-pointer outline-none focus:border-blue-500"
                              >
                                <option value="Pre-launch">Pre-launch</option>
                                <option value="Launched">Launched</option>
                                <option value="Suspended">Suspended</option>
                              </select>
                            </div>
                            <div>
                              <label className="text-[10px] text-slate-400 font-extrabold uppercase block tracking-wider mb-1">Promotion Status</label>
                              <select
                                value={profileDraft.promotionStatus || "Active"}
                                onChange={(e) => setProfileDraft({ ...profileDraft, promotionStatus: e.target.value })}
                                className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-white font-semibold cursor-pointer outline-none focus:border-blue-500"
                              >
                                <option value="Active">Active</option>
                                <option value="Suspended">Suspended</option>
                                <option value="Planned">Planned</option>
                              </select>
                            </div>
                          </div>
                        </div>

                        <div className="space-y-3.5">
                          <div>
                            <label className="text-[10px] text-slate-400 font-extrabold uppercase block tracking-wider mb-1">Clinical Positioning (EN)</label>
                            <textarea
                              rows={2}
                              value={profileDraft.positioning || ""}
                              onChange={(e) => setProfileDraft({ ...profileDraft, positioning: e.target.value })}
                              placeholder="Describe therapeutic indications, patient group fit, and target clinical positioning..."
                              className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-white outline-none focus:border-blue-500 resize-none leading-relaxed font-sans"
                            />
                          </div>

                          <div>
                            <label className="text-[10px] text-slate-400 font-extrabold uppercase block tracking-wider mb-1 text-right block" dir="rtl">التموضع السريري والدوائي (AR)</label>
                            <textarea
                              rows={2}
                              value={profileDraft.positioningArabic || ""}
                              onChange={(e) => setProfileDraft({ ...profileDraft, positioningArabic: e.target.value })}
                              placeholder="اكتب التموضع السريري، الإرشادات الدوائية وفئات المرضى المستهدفة باللغة العربية..."
                              className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-white outline-none focus:border-blue-500 resize-none leading-relaxed font-sans text-right"
                              dir="rtl"
                            />
                          </div>

                          <div>
                            <label className="text-[10px] text-slate-400 font-extrabold uppercase block tracking-wider mb-1">Unique Selling Proposition (USP)</label>
                            <textarea
                              rows={2}
                              value={profileDraft.usp || ""}
                              onChange={(e) => setProfileDraft({ ...profileDraft, usp: e.target.value })}
                              placeholder="Enter key medical advantages over competitors, price-effectiveness ratios, or skin tolerance USPs..."
                              className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-white outline-none focus:border-blue-500 resize-none leading-relaxed font-sans"
                            />
                          </div>

                          <div>
                            <label className="text-[10px] text-slate-400 font-extrabold uppercase block tracking-wider mb-1">Promotion Objectives</label>
                            <textarea
                              rows={2}
                              value={profileDraft.promotionObjectives || ""}
                              onChange={(e) => setProfileDraft({ ...profileDraft, promotionObjectives: e.target.value })}
                              placeholder="Detail explicit marketing targets, message focuses, and scientific study distribution parameters..."
                              className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-white outline-none focus:border-blue-500 resize-none leading-relaxed font-sans"
                            />
                          </div>

                          <div className="space-y-3">
                            <div>
                              <label className="text-[10px] text-slate-400 font-extrabold uppercase block tracking-wider mb-1">Target Specialties</label>
                              <input
                                type="text"
                                value={targetSpecsStr}
                                onChange={(e) => setTargetSpecsStr(e.target.value)}
                                placeholder="e.g. Dermatology, Pediatrics, Plastic Surgery"
                                className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-white outline-none focus:border-blue-500 font-sans"
                              />
                              <span className="text-[9px] text-slate-400 block mt-0.5">Separate multiple specialties with commas.</span>
                            </div>

                            <div>
                              <label className="text-[10px] text-slate-400 font-extrabold uppercase block tracking-wider mb-1">Target Pharmacy Types</label>
                              <input
                                type="text"
                                value={targetPharmsStr}
                                onChange={(e) => setTargetPharmsStr(e.target.value)}
                                placeholder="e.g. Community Pharmacy, Clinical Group, Dermaceutics Retail"
                                className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-white outline-none focus:border-blue-500 font-sans"
                              />
                              <span className="text-[9px] text-slate-400 block mt-0.5">Separate with commas.</span>
                            </div>

                            <div>
                              <label className="text-[10px] text-slate-400 font-extrabold uppercase block tracking-wider mb-1">Target Hospitals</label>
                              <input
                                type="text"
                                value={targetHospsStr}
                                onChange={(e) => setTargetHospsStr(e.target.value)}
                                placeholder="e.g. Tripoli Medical Center, Pella Dermaclinic, Benghazi Public"
                                className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-white outline-none focus:border-blue-500 font-sans"
                              />
                              <span className="text-[9px] text-slate-400 block mt-0.5">Separate with commas.</span>
                            </div>
                          </div>

                          <div>
                            <label className="text-[10px] text-slate-400 font-extrabold uppercase block tracking-wider mb-1">Promotion Notes (EN)</label>
                            <textarea
                              rows={2}
                              value={profileDraft.promotionNotes || ""}
                              onChange={(e) => setProfileDraft({ ...profileDraft, promotionNotes: e.target.value })}
                              placeholder="Any internal operational notes, field messaging warnings, or regional guidelines..."
                              className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-white outline-none focus:border-blue-500 resize-none leading-relaxed font-sans"
                            />
                          </div>

                          <div>
                            <label className="text-[10px] text-slate-400 font-extrabold uppercase block tracking-wider mb-1 text-right block" dir="rtl">ملاحظات ترويجية إرشادية (AR)</label>
                            <textarea
                              rows={2}
                              value={profileDraft.promotionNotesArabic || ""}
                              onChange={(e) => setProfileDraft({ ...profileDraft, promotionNotesArabic: e.target.value })}
                              placeholder="ملاحظات إرشادية للمندوبين والمسوقين لتوجيه الرسالة الترويجية للعيادات والصيدليات..."
                              className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-white outline-none focus:border-blue-500 resize-none leading-relaxed font-sans text-right"
                              dir="rtl"
                            />
                          </div>
                        </div>

                        {/* Save / Cancel controls */}
                        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                          <button
                            type="button"
                            onClick={() => {
                              setIsEditingProfile(false);
                            }}
                            className="px-4.5 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 font-bold rounded-lg cursor-pointer transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (!onUpdateProduct) return;
                              const specs = targetSpecsStr.split(",").map(s => s.trim()).filter(Boolean);
                              const pharms = targetPharmsStr.split(",").map(s => s.trim()).filter(Boolean);
                              const hosps = targetHospsStr.split(",").map(s => s.trim()).filter(Boolean);
                              
                              const updatedProfile: ProductPromotionProfile = {
                                ...selectedProductDetails.promotionProfile,
                                ...profileDraft,
                                targetSpecialties: specs,
                                targetPharmacyTypes: pharms,
                                targetHospitals: hosps,
                                updatedAt: new Date().toISOString(),
                                updatedBy: currentUser.id || currentUser.email || "unknown"
                              };
                              
                              const updatedProduct: Product = {
                                ...selectedProductDetails,
                                promotionProfile: updatedProfile,
                                updatedAt: new Date().toISOString(),
                                updatedBy: currentUser.id || currentUser.email || "unknown"
                              };
                              
                              onUpdateProduct(updatedProduct);
                              setSelectedProductDetails(updatedProduct);
                              setIsEditingProfile(false);
                            }}
                            className="inline-flex items-center gap-1.5 px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold rounded-lg transition-colors cursor-pointer shadow-xs"
                          >
                            <Save size={14} />
                            <span>Save Changes</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {detailsTab === "key-messages" && (() => {
                  const productKeyMessages = (keyMessages || []).filter(msg => {
                    if ((msg as any).isDeleted) return false;
                    if (msg.productId) {
                      return msg.productId === selectedProductDetails.id;
                    }
                    if (msg.productSku && selectedProductDetails.sku) {
                      return msg.productSku.toLowerCase().trim() === selectedProductDetails.sku.toLowerCase().trim();
                    }
                    return false;
                  });

                  // Apply dynamic role-based filters
                  let filteredMsgs = [...productKeyMessages];
                  if (currentUser.role === "Medical Representative") {
                    filteredMsgs = filteredMsgs.filter(m => m.active !== false && m.isApproved === true);
                  } else if (currentUser.role === "Sales Representative") {
                    filteredMsgs = filteredMsgs.filter(m => m.active !== false && m.isApproved === true);
                  }

                  // Sort by detailingSequence
                  filteredMsgs.sort((a, b) => (a.detailingSequence || 0) - (b.detailingSequence || 0));

                  return (
                    <div className="space-y-4 animate-fade-in">
                      <div className="flex justify-between items-center bg-slate-50 dark:bg-slate-950 p-3 rounded-xl border border-slate-100 dark:border-slate-850">
                        <div className="space-y-0.5">
                          <span className="text-[10px] text-slate-400 font-extrabold uppercase block tracking-wider">Canonical Repository</span>
                          <h4 className="font-extrabold text-xs text-slate-800 dark:text-white uppercase flex items-center gap-1.5">
                            <Globe size={13} className="text-blue-500" />
                            {lang === "ar" ? "الرسائل الترويجية المعتمدة" : "Approved Key Messages"}
                            <span className="ml-1 bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded-full text-[10px] font-mono">
                              {filteredMsgs.length}
                            </span>
                          </h4>
                        </div>
                        <span className="text-[10px] text-slate-400 font-medium">
                          {lang === "ar" ? "تحديث تلقائي من المخزن الرئيسي" : "Live sync from repository"}
                        </span>
                      </div>

                      {filteredMsgs.length === 0 ? (
                        <div className="flex flex-col items-center justify-center text-center p-8 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl bg-slate-50/50 dark:bg-slate-950/10 space-y-3">
                          <div className="p-3 bg-slate-100 dark:bg-slate-800/80 rounded-full text-slate-400">
                            <AlertTriangle size={24} className="text-amber-500" />
                          </div>
                          <div className="space-y-1 max-w-md">
                            <h4 className="font-extrabold text-xs text-slate-800 dark:text-white">
                              {lang === "ar" ? "لا توجد رسائل ترويجية متوفرة" : "No Key Messages Available"}
                            </h4>
                            <p className="text-slate-500 dark:text-slate-400 text-[10px] leading-relaxed">
                              {lang === "ar"
                                ? "لم يتم العثور على رسائل أساسية معتمدة مرتبطة بهذا المنتج في المخزن الرئيسي."
                                : "No active or approved key messages for this product SKU / Brand were found in the canonical database."}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-3.5">
                          {filteredMsgs.map((msg, idx) => {
                            const getOrdinalSuffix = (num: number) => {
                              const j = num % 10, k = num % 100;
                              if (j === 1 && k !== 11) return `${num}st`;
                              if (j === 2 && k !== 12) return `${num}nd`;
                              if (j === 3 && k !== 13) return `${num}rd`;
                              return `${num}th`;
                            };
                            
                            const sequenceLabel = msg.detailingSequence 
                              ? getOrdinalSuffix(msg.detailingSequence) 
                              : `${idx + 1}st`;

                            return (
                              <div 
                                key={msg.id || idx} 
                                className="bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-850 rounded-xl p-4 space-y-3 shadow-xs hover:border-blue-200 dark:hover:border-blue-900 transition-all duration-200 relative group overflow-hidden"
                              >
                                <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-500 group-hover:w-1.5 transition-all" />

                                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-50 dark:border-slate-850 pb-2.5">
                                  <div className="flex items-center gap-2">
                                    <span className="flex items-center justify-center bg-blue-50 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900 text-blue-600 dark:text-blue-400 font-mono font-extrabold text-[10px] h-6 px-2 rounded-md">
                                      {sequenceLabel} Sequence
                                    </span>

                                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wider ${
                                      msg.keyFocus === "Primary"
                                        ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-900"
                                        : msg.keyFocus === "Secondary"
                                        ? "bg-violet-50 text-violet-700 dark:bg-violet-950/30 dark:text-violet-400 border border-violet-100 dark:border-violet-900"
                                        : "bg-slate-50 text-slate-700 dark:bg-slate-800 dark:text-slate-400 border border-slate-100 dark:border-slate-750"
                                    }`}>
                                      {msg.keyFocus || "General Focus"}
                                    </span>
                                  </div>

                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[10px] font-mono text-slate-400 font-bold bg-slate-50 dark:bg-slate-950 px-2 py-0.5 rounded border border-slate-100 dark:border-slate-850">
                                      ID: {msg.id}
                                    </span>
                                    {msg.isApproved ? (
                                      <span className="bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900 px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wider">
                                        {lang === "ar" ? "معتمد" : "Approved"}
                                      </span>
                                    ) : msg.active !== false ? (
                                      <span className="bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border border-amber-100 dark:border-amber-900 px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wider">
                                        {lang === "ar" ? "مسودة" : "Draft"}
                                      </span>
                                    ) : (
                                      <span className="bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400 border border-rose-100 dark:border-rose-900 px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wider">
                                        {lang === "ar" ? "غير نشط" : "Inactive"}
                                      </span>
                                    )}
                                  </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                                  <div className="space-y-1.5">
                                    <span className="text-[9px] text-slate-400 font-extrabold uppercase tracking-wider block">English Detailing Content</span>
                                    <p className="text-slate-700 dark:text-slate-350 leading-relaxed font-sans text-xs">
                                      {msg.message || msg.messageContent || "No English content drafted."}
                                    </p>
                                  </div>

                                  <div className="space-y-1.5 bg-slate-50/50 dark:bg-slate-950/10 p-3 rounded-xl border border-slate-50 dark:border-slate-900" dir="rtl">
                                    <span className="text-[9px] text-slate-400 font-extrabold uppercase tracking-wider block text-right">المحتوى الترويجي (عربي)</span>
                                    <p className="text-slate-800 dark:text-slate-200 leading-relaxed font-sans text-xs text-right">
                                      {msg.messageAr || (msg as any).messageContentAr || "لم يتم صياغة محتوى باللغة العربية."}
                                    </p>
                                  </div>
                                </div>

                                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-50 dark:border-slate-850 pt-2.5 text-[10px] text-slate-400 font-medium">
                                  <div className="flex items-center gap-3">
                                    <span>
                                      Owner: <strong className="text-slate-600 dark:text-slate-300 font-extrabold">{(msg as any).owner || (msg as any).createdBy || "System Owner"}</strong>
                                    </span>
                                    <span className="text-slate-200 dark:text-slate-800">•</span>
                                    <span>
                                      Updated: <strong className="text-slate-600 dark:text-slate-300 font-bold">{(msg as any).updatedAt ? new Date((msg as any).updatedAt).toLocaleDateString() : "Never"}</strong>
                                    </span>
                                  </div>

                                  {msg.scientificReferences && msg.scientificReferences.length > 0 && (
                                    <div className="flex items-center gap-1.5">
                                      <span className="font-extrabold text-[9px] uppercase tracking-wider text-slate-400">References:</span>
                                      <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-400 border border-slate-100 dark:border-slate-850 text-[9px]">
                                        {msg.scientificReferences.join(", ")}
                                      </span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {detailsTab === "resources" && (() => {
                  const productResources = academicResources || [];

                  // Filter by role/permissions:
                  // Medical Representative: View approved active resources.
                  // Sales Representative: View commercial resources only, if permitted.
                  let filteredRes = [...productResources];
                  if (currentUser.role === "Medical Representative") {
                    filteredRes = filteredRes.filter(r => r.status === "Approved" || r.isApproved === true || r.isApproved === undefined);
                  } else if (currentUser.role === "Sales Representative") {
                    const marketingCats = ["Brochure", "Visual Aid", "Video", "Brochures", "Visual Aids", "Detailing Kits"];
                    filteredRes = filteredRes.filter(r => (r.status === "Approved" || r.isApproved === true || r.isApproved === undefined) && marketingCats.includes(r.category));
                  }

                  return (
                    <div className="space-y-4 animate-fade-in">
                      <div className="flex justify-between items-center bg-slate-50 dark:bg-slate-950 p-3 rounded-xl border border-slate-100 dark:border-slate-850">
                        <div className="space-y-0.5">
                          <span className="text-[10px] text-slate-400 font-extrabold uppercase block tracking-wider">Linked Resources</span>
                          <h4 className="font-extrabold text-xs text-slate-800 dark:text-white uppercase flex items-center gap-1.5">
                            <Globe size={13} className="text-indigo-500" />
                            {lang === "ar" ? "المصادر والمطويات العلمية" : "Linked Product Resources"}
                            <span className="ml-1 bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 px-2 py-0.5 rounded-full text-[10px] font-mono">
                              {filteredRes.length}
                            </span>
                          </h4>
                        </div>
                        <span className="text-[10px] text-slate-400 font-medium">
                          {lang === "ar" ? "مزامنة تلقائية من مركز المعرفة" : "Live from Knowledge Hub"}
                        </span>
                      </div>

                      {filteredRes.length === 0 ? (
                        <div className="flex flex-col items-center justify-center text-center p-8 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl bg-slate-50/50 dark:bg-slate-950/10 space-y-3">
                          <div className="p-3 bg-slate-100 dark:bg-slate-800/80 rounded-full text-slate-400">
                            <Info size={24} className="text-indigo-500" />
                          </div>
                          <div className="space-y-1 max-w-md">
                            <h4 className="font-extrabold text-xs text-slate-800 dark:text-white">
                              {lang === "ar" ? "لا توجد مصادر متوفرة" : "No Resources Linked"}
                            </h4>
                            <p className="text-slate-500 dark:text-slate-400 text-[10px] leading-relaxed">
                              {lang === "ar"
                                ? "لم يتم ربط أي دراسات سريرية، مطويات أو ملفات ترويجية معتمدة لهذا المنتج."
                                : "No active, approved clinical studies, digital brochures or marketing materials are currently linked to this product."}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {filteredRes.map((res, idx) => (
                            <div 
                              key={res.id || idx}
                              className="bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-850 rounded-xl p-4 space-y-3 hover:border-indigo-200 dark:hover:border-indigo-900 transition-all duration-200 relative group overflow-hidden"
                            >
                              <div className="absolute left-0 top-0 bottom-0 w-1 bg-indigo-500 group-hover:w-1.5 transition-all" />

                              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-50 dark:border-slate-850 pb-2.5">
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] px-2 py-0.5 rounded-md font-extrabold bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-900">
                                    {res.category}
                                  </span>
                                  <span className="text-[10px] font-semibold text-slate-400">
                                    {res.type}
                                  </span>
                                </div>

                                <div className="flex items-center gap-1.5">
                                  <span className="text-[10px] font-mono text-slate-400 font-bold bg-slate-50 dark:bg-slate-950 px-2 py-0.5 rounded border border-slate-100 dark:border-slate-850">
                                    ID: {res.id}
                                  </span>
                                  {res.isApproved || res.status === "Approved" || res.status === undefined ? (
                                    <span className="bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900 px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wider">
                                      {lang === "ar" ? "معتمد" : "Approved"}
                                    </span>
                                  ) : res.status === "Draft" ? (
                                    <span className="bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border border-amber-100 dark:border-amber-900 px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wider">
                                      {lang === "ar" ? "مسودة" : "Draft"}
                                    </span>
                                  ) : (
                                    <span className="bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400 border border-rose-100 dark:border-rose-900 px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wider">
                                      {lang === "ar" ? "غير نشط" : "Inactive"}
                                    </span>
                                  )}
                                </div>
                              </div>

                              <div className="space-y-1">
                                <h4 className="font-extrabold text-xs text-slate-800 dark:text-white">
                                  {lang === "ar" ? res.titleAr : res.title}
                                </h4>
                                {res.titleAr && res.titleAr !== res.title && (
                                  <p className="text-[10px] text-slate-400" dir={isRtl ? "rtl" : "ltr"}>
                                    {isRtl ? res.title : res.titleAr}
                                  </p>
                                )}
                              </div>

                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] text-slate-400 bg-slate-50/50 dark:bg-slate-950/10 p-2.5 rounded-lg border border-slate-100 dark:border-slate-900 font-medium">
                                <div>
                                  <span className="block text-[8px] uppercase font-bold text-slate-450">Language</span>
                                  <span className="text-slate-600 dark:text-slate-300 font-semibold">{res.language || "English"}</span>
                                </div>
                                <div>
                                  <span className="block text-[8px] uppercase font-bold text-slate-450">Version</span>
                                  <span className="text-slate-600 dark:text-slate-300 font-semibold">v{res.version || "1.0"}</span>
                                </div>
                                <div>
                                  <span className="block text-[8px] uppercase font-bold text-slate-450">File Size</span>
                                  <span className="text-slate-650 dark:text-slate-300 font-semibold">{res.size || "1.5 MB"}</span>
                                </div>
                                <div>
                                  <span className="block text-[8px] uppercase font-bold text-slate-450">Updated</span>
                                  <span className="text-slate-650 dark:text-slate-300 font-semibold">{res.lastUpdated || res.updatedAt || "Never"}</span>
                                </div>
                              </div>

                              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-50 dark:border-slate-850 pt-2.5 text-[10px] text-slate-400 font-medium">
                                <div className="flex items-center gap-3">
                                  <span>
                                    Owner: <strong className="text-slate-600 dark:text-slate-300 font-extrabold">{res.createdBy || res.owner || "System Admin"}</strong>
                                  </span>
                                  {res.effectiveDate && (
                                    <>
                                      <span className="text-slate-200 dark:text-slate-800">•</span>
                                      <span>
                                        Effective: <strong className="text-slate-600 dark:text-slate-300 font-semibold">{res.effectiveDate}</strong>
                                      </span>
                                    </>
                                  )}
                                  {res.expiryDate && (
                                    <>
                                      <span className="text-slate-200 dark:text-slate-800">•</span>
                                      <span className="text-rose-600 dark:text-rose-450 font-semibold">
                                        Expires: {res.expiryDate}
                                      </span>
                                    </>
                                  )}
                                </div>

                                <div className="flex flex-col items-end gap-1.5">
                                  <button 
                                    type="button"
                                    onClick={() => void handleProductResourceDownload(res)}
                                    disabled={downloadingResourceIds.has(res.resourceId || res.id)}
                                    className="px-2.5 py-1.5 border border-indigo-100 dark:border-indigo-950 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 text-[10px] font-bold text-indigo-600 dark:text-indigo-400 rounded-lg inline-flex items-center gap-1 cursor-pointer transition-colors"
                                  >
                                    <Download size={11} />
                                    <span>{downloadingResourceIds.has(res.resourceId || res.id) ? (lang === "ar" ? "جارٍ التنزيل..." : "Downloading…") : (lang === "ar" ? "تحميل" : "Download")}</span>
                                  </button>
                                  {resourceDownloadErrors[res.resourceId || res.id] && <p role="alert" className="max-w-48 text-right text-[9px] font-semibold text-rose-600 dark:text-rose-400">{resourceDownloadErrors[res.resourceId || res.id]}</p>}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 flex justify-between items-center shrink-0">
                <div>
                  {detailsTab === "promotion" && profile?.updatedAt && (
                    <span className="text-[10px] text-slate-400 font-medium">
                      Last edited: {new Date(profile.updatedAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
                {!isEditingProfile && (
                  <button
                    onClick={() => {
                      setSelectedProductDetails(null);
                      setIsEditingProfile(false);
                    }}
                    className="px-4.5 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 font-bold rounded-lg cursor-pointer transition-colors"
                  >
                    Close
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Direct Stock Level Adjustment Dialog */}
      {adjustStockProduct && (
        <div className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-md p-5 space-y-4 shadow-xl relative animate-fade-in text-xs">
            <div className="flex justify-between items-center pb-2 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-extrabold text-sm text-slate-900 dark:text-white flex items-center gap-2 uppercase">
                <Package size={16} className="text-blue-500" />
                <span>Adjust Inventory Levels</span>
              </h3>
              <button onClick={() => setAdjustStockProduct(null)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveAdjustStock} className="space-y-4">
              <div>
                <span className="text-slate-500 font-bold block mb-1">Product:</span>
                <span className="text-xs font-extrabold text-slate-800 dark:text-slate-100 uppercase">{adjustStockProduct.name}</span>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-500 block">Direct Physical Stock (Units/Packs)</label>
                <input
                  type="number"
                  min="0"
                  required
                  value={newStockInput}
                  onChange={(e) => setNewStockInput(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none focus:border-blue-500 font-mono font-bold"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => setAdjustStockProduct(null)}
                  className="px-4 py-2 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 font-bold rounded-lg hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4.5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg cursor-pointer shadow-sm"
                >
                  Save Stock
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Future Price Scheduler Dialog */}
      {schedulePriceProduct && (
        <div className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-md p-5 space-y-4 shadow-xl relative animate-fade-in text-xs">
            <div className="flex justify-between items-center pb-2 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-extrabold text-sm text-slate-900 dark:text-white flex items-center gap-2 uppercase">
                <Calendar size={16} className="text-blue-500" />
                <span>Schedule Future Price Change</span>
              </h3>
              <button onClick={() => setSchedulePriceProduct(null)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveScheduledPrice} className="space-y-4">
              <div>
                <span className="text-slate-500 font-bold block mb-1">Product:</span>
                <span className="text-xs font-extrabold text-slate-800 dark:text-slate-100 uppercase">{schedulePriceProduct.name}</span>
                <span className="block text-[10px] text-slate-400 mt-0.5">Current price: {productMoney(schedulePriceProduct.price, schedulePriceProduct)}</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-bold text-slate-500 block">New Target Price</label>
                  <div className="relative">
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      required
                      value={scheduledPriceInput}
                      onChange={(e) => setScheduledPriceInput(e.target.value)}
                      className="w-full pl-10 pr-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none focus:border-blue-500 font-mono font-bold"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="font-bold text-slate-500 block">Effective Date</label>
                  <input
                    type="date"
                    required
                    value={scheduledPriceDate}
                    onChange={(e) => setScheduledPriceDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-white focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => setSchedulePriceProduct(null)}
                  className="px-4 py-2 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 font-bold rounded-lg hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4.5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg cursor-pointer shadow-sm"
                >
                  Schedule Price
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Historical Price Logs Timeline */}
      {viewPriceHistoryProduct && (
        <div className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-md p-5 space-y-4 shadow-xl relative animate-fade-in text-xs">
            <div className="flex justify-between items-center pb-2.5 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-extrabold text-sm text-slate-900 dark:text-white flex items-center gap-2 uppercase">
                <TrendingUp size={16} className="text-blue-500" />
                <span>Price Adjustment History Log</span>
              </h3>
              <button onClick={() => setViewPriceHistoryProduct(null)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <span className="text-slate-400 font-bold text-[10px] block uppercase">Product Spec</span>
                <span className="text-xs font-extrabold text-slate-800 dark:text-white uppercase">{viewPriceHistoryProduct.name}</span>
              </div>

              <div className="space-y-3 relative border-l border-slate-200 dark:border-slate-800 pl-4.5 ml-1.5 py-1">
                {priceHistoryList.map((log, index) => (
                  <div key={index} className="relative">
                    {/* Circle marker */}
                    <div className="absolute -left-[23px] top-1.5 w-2 h-2 rounded-full bg-blue-500 ring-4 ring-white dark:ring-slate-900" />
                    <div>
                      <span className="text-[10px] font-bold font-mono text-slate-400 block">{log.date}</span>
                      <span className="font-extrabold text-xs text-slate-900 dark:text-white font-mono">{productMoney(log.price, viewPriceHistoryProduct!)}</span>
                      <p className="text-[10px] text-slate-500 mt-0.5">{log.remark}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setViewPriceHistoryProduct(null)}
                className="px-4.5 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold rounded-lg cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Historical Stock Transaction Logs Timeline */}
      {viewStockHistoryProduct && (
        <div className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-md p-5 space-y-4 shadow-xl relative animate-fade-in text-xs">
            <div className="flex justify-between items-center pb-2.5 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-extrabold text-sm text-slate-900 dark:text-white flex items-center gap-2 uppercase">
                <History size={16} className="text-blue-500" />
                <span>Warehouse Inventory Ledger</span>
              </h3>
              <button onClick={() => setViewStockHistoryProduct(null)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <span className="text-slate-400 font-bold text-[10px] block uppercase">Product Spec</span>
                <span className="text-xs font-extrabold text-slate-800 dark:text-white uppercase">{viewStockHistoryProduct.name}</span>
              </div>

              <div className="space-y-4 relative border-l border-slate-200 dark:border-slate-800 pl-4.5 ml-1.5 py-1">
                {stockHistoryList.map((log, index) => (
                  <div key={index} className="relative">
                    {/* Circle marker */}
                    <div className={`absolute -left-[23px] top-1.5 w-2 h-2 rounded-full ring-4 ring-white dark:ring-slate-900 ${
                      log.quantity.startsWith("+") ? "bg-emerald-500" : "bg-rose-500"
                    }`} />
                    <div>
                      <span className="text-[10px] font-bold font-mono text-slate-400 block">{log.date}</span>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className={`font-extrabold text-xs font-mono ${
                          log.quantity.startsWith("+") ? "text-emerald-600" : "text-rose-600"
                        }`}>{log.quantity}</span>
                        <span className="text-[10.5px] text-slate-500">({log.source})</span>
                      </div>
                      <span className="block text-[9.5px] text-slate-400 font-mono mt-0.5">Ledger stock after change: {log.current} units</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setViewStockHistoryProduct(null)}
                className="px-4.5 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold rounded-lg cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {isMarketModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-2xl p-6 space-y-4 shadow-xl text-xs max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center pb-2.5 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-extrabold text-sm text-slate-900 dark:text-white flex items-center gap-2 uppercase"><Globe size={17} className="text-blue-500" />{isRtl ? "إعداد سوق المنتجات" : "Configure Product Market"}</h3>
              <button onClick={() => setIsMarketModalOpen(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer"><X size={18} /></button>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="space-y-1"><span className="font-bold text-slate-600 dark:text-slate-300">{isRtl ? "الشركة المشغلة" : "Operating Company"}</span>
                <select value={selectedCompanyId} onChange={event => { const companyId = event.target.value; const relationship = marketRelationships.find(value => value.companyId === companyId); setSelectedCompanyId(companyId); setSelectedMarketId(relationship?.marketId || ""); if (relationship) loadMarketState(relationship); }} className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-950">
                  {[...new Map(marketRelationships.map(value => [value.companyId, value.companyName])).entries()].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </select>
              </label>
              <label className="space-y-1"><span className="font-bold text-slate-600 dark:text-slate-300">{isRtl ? "السوق" : "Market"}</span>
                <select value={selectedMarketId} onChange={event => { const relationship = marketRelationships.find(value => value.companyId === selectedCompanyId && value.marketId === event.target.value); setSelectedMarketId(event.target.value); if (relationship) loadMarketState(relationship); }} className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-950">
                  {marketRelationships.filter(value => value.companyId === selectedCompanyId).map(value => <option key={value.companyMarketId} value={value.marketId}>{value.marketName} — {value.countryName}</option>)}
                </select>
              </label>
            </div>
            {selectedRelationship && <div className="text-[11px] font-bold text-blue-600 dark:text-blue-400">{isRtl ? "العملة" : "Currency"}: {selectedRelationship.currencyCode}</div>}
            {marketError && <div role="alert" className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 font-semibold">{marketError}</div>}
            <div className="space-y-2">
              {selectedProductIds.map(productId => {
                const product = products.find(value => value.id === productId);
                const draft = marketDrafts[productId] || { unitPrice: "", active: true, saleable: true };
                return <div key={productId} className="grid sm:grid-cols-[1fr_180px_auto_auto] gap-3 items-center p-3 border border-slate-100 dark:border-slate-800 rounded-lg">
                  <span className="font-bold text-slate-800 dark:text-white">{product?.name || productId}</span>
                  <label className="flex items-center gap-2"><input aria-label={`${product?.name || productId} unit price`} type="number" min="0" step="any" value={draft.unitPrice} onChange={event => setMarketDrafts(current => ({ ...current, [productId]: { ...draft, unitPrice: event.target.value } }))} className="min-w-0 w-full px-2 py-1.5 border border-slate-200 dark:border-slate-800 rounded bg-white dark:bg-slate-950" /><span className="font-mono font-bold">{selectedRelationship?.currencyCode}</span></label>
                  <label className="flex items-center gap-1.5 whitespace-nowrap"><input type="checkbox" checked={draft.active} onChange={event => setMarketDrafts(current => ({ ...current, [productId]: { ...draft, active: event.target.checked } }))} />{isRtl ? "نشط" : "Active in market"}</label>
                  <label className="flex items-center gap-1.5 whitespace-nowrap"><input type="checkbox" checked={draft.saleable} onChange={event => setMarketDrafts(current => ({ ...current, [productId]: { ...draft, saleable: event.target.checked } }))} />{isRtl ? "قابل للبيع" : "Saleable"}</label>
                </div>;
              })}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setIsMarketModalOpen(false)} className="px-4 py-2 bg-slate-100 dark:bg-slate-800 rounded-lg font-bold cursor-pointer">{isRtl ? "إلغاء" : "Cancel"}</button>
              <button disabled={marketBusy || !selectedRelationship} onClick={saveMarketConfiguration} className="px-4 py-2 bg-blue-600 text-white rounded-lg font-bold disabled:opacity-40 cursor-pointer"><Save size={14} className="inline mr-1" />{marketBusy ? (isRtl ? "جارٍ الحفظ…" : "Saving…") : (isRtl ? "حفظ" : "Save")}</button>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Product Multi-Mode Form Modal */}
      {isFormModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-2xl p-6 space-y-4 shadow-xl relative animate-fade-in text-xs max-h-[90vh] overflow-y-auto">
            
            <div className="flex justify-between items-center pb-2.5 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-extrabold text-sm text-slate-900 dark:text-white flex items-center gap-2 uppercase">
                {formMode === "add" ? (
                  <>
                    <Plus className="text-blue-500" size={18} />
                    <span>Onboard New Product SKU</span>
                  </>
                ) : (
                  <>
                    <Edit2 className="text-blue-500" size={15} />
                    <span>Update Product SKU Parameters</span>
                  </>
                )}
              </h3>
              <button onClick={() => setIsFormModalOpen(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X size={18} />
              </button>
            </div>

            <AddProductForm
              lang={lang}
              productPromotionGroups={productPromotionGroups}
              products={products}
              editingProduct={editingProduct || undefined}
              isModal={true}
              onCancel={() => setIsFormModalOpen(false)}
              onAddProduct={(p) => {
                onAddProduct(p);
                setIsFormModalOpen(false);
              }}
              onUpdateProduct={(p) => {
                if (onUpdateProduct) {
                  onUpdateProduct(p);
                }
                setIsFormModalOpen(false);
              }}
            />
          </div>
        </div>
      )}

    </div>
  );
}
