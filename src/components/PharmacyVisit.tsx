import React, { useState, useMemo, useEffect } from "react";
import { 
  Check, 
  MapPin, 
  Search, 
  ShoppingCart, 
  DollarSign, 
  Warehouse, 
  FileText, 
  Plus, 
  Trash, 
  Percent, 
  Calendar,
  Compass,
  MapPinCheck,
  ChevronRight,
  ChevronLeft,
  AlertCircle,
  Clock,
  Briefcase,
  Layers,
  ChevronDown,
  ChevronUp,
  Tag,
  Gift,
  FileCheck2,
  TrendingUp,
  MessageSquare,
  Sparkles,
  RefreshCw,
  ThumbsUp,
  Layers2,
  BookmarkCheck,
  AlertTriangle,
  Store,
  UserCheck,
  X
} from "lucide-react";
import { 
  Role, 
  User, 
  Pharmacy, 
  Product, 
  PharmacyVisit as PharmacyVisitType, 
  OrderItem,
  UserTerritoryAssignment,
  UserProductAssignment
} from "../types";
import { fetchAiInsight } from "../utils/aiService";
import { motion, AnimatePresence } from "motion/react";
import { filterBySecurity } from "../lib/alignmentService";
import { acquireHardenedGPS, GPSRecord } from "../lib/gpsHardening";

interface PharmacyVisitProps {
  currentUser: User;
  pharmacies: Pharmacy[];
  products: Product[];
  lang: "en" | "ar";
  onCompletePharmacyVisit: (visit: PharmacyVisitType) => void;
  onNavigate?: (view: string) => void;
  userTerritoryAssignments?: UserTerritoryAssignment[];
  userProductAssignments?: UserProductAssignment[];
}

export default function PharmacyVisit({
  currentUser,
  pharmacies,
  products,
  lang,
  onCompletePharmacyVisit,
  onNavigate,
  userTerritoryAssignments = [],
  userProductAssignments = []
}: PharmacyVisitProps) {
  const isRtl = lang === "ar";
  
  // 6-step multi-step workflow state
  const [step, setStep] = useState(1);
  const totalSteps = 6;

  // Compute secured data elements based on CRM alignment permissions
  const securedPharmacies = useMemo(() => {
    return filterBySecurity(
      currentUser,
      pharmacies,
      "territory",
      "id",
      "assignedRepId",
      userTerritoryAssignments,
      userProductAssignments
    );
  }, [pharmacies, currentUser, userTerritoryAssignments, userProductAssignments]);

  const securedProducts = useMemo(() => {
    return filterBySecurity(
      currentUser,
      products,
      "territoryId",
      "id",
      "repId",
      userTerritoryAssignments,
      userProductAssignments
    );
  }, [products, currentUser, userTerritoryAssignments, userProductAssignments]);

  // Selected Pharmacy (defaults to first pharmacy for seamless visual layout preview)
  const defaultPharmacy = securedPharmacies[0] || {
    id: "PHM-01",
    name: "Al-Afiya Pharmacy",
    nameAr: "صيدلية العافية",
    region: "Tripoli",
    territory: "Tripoli Centre Zone",
    latitude: 32.8872,
    longitude: 13.1913,
    outstandingBalance: 5200,
    lastVisitDate: "2026-06-10",
    address: "Al-Jaraba Street, Tripoli",
    type: "Retail",
    contact: "+218 91-0000000"
  };

  const [selectedPharmacy, setSelectedPharmacy] = useState<Pharmacy | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsVerified, setGpsVerified] = useState(false);
  const [gpsCoords, setGpsCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsRecord, setGpsRecord] = useState<GPSRecord | null>(null);
  const [pharmacySearchQuery, setPharmacySearchQuery] = useState("");
  const [checkInTime, setCheckInTime] = useState<string>("");

  const activePharmacy = selectedPharmacy || defaultPharmacy;

  // Step 2: Order Items Layout State
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  
  useEffect(() => {
    if (securedProducts.length > 0 && orderItems.length === 0) {
      setOrderItems([
        {
          productId: securedProducts[0]?.id || "P01",
          productName: securedProducts[0]?.name || "CardioMax 10mg",
          quantity: 50,
          price: securedProducts[0]?.price || 45,
          discount: 0
        },
        ...(securedProducts[1] ? [{
          productId: securedProducts[1].id,
          productName: securedProducts[1].name,
          quantity: 20,
          price: securedProducts[1].price,
          discount: 0
        }] : [])
      ]);
    }
  }, [securedProducts]);

  const [selectedProduct, setSelectedProduct] = useState("");
  const [itemQty, setItemQty] = useState(15);
  const [productSearchQuery, setProductSearchQuery] = useState("");
  const [replenishNotification, setReplenishNotification] = useState<string | null>(null);

  // Step 3: Offers & Promotions Layout State
  const [globalDiscount, setGlobalDiscount] = useState(10); // default visual discount
  const [selectedOfferCode, setSelectedOfferCode] = useState("Q2-BONUS-10");

  const showVoucher1 = useMemo(() => {
    return securedProducts.some(p => p.brand?.toLowerCase().includes("cardio") || p.name?.toLowerCase().includes("cardio"));
  }, [securedProducts]);

  const showVoucher2 = useMemo(() => {
    return securedProducts.some(p => p.brand?.toLowerCase().includes("kid") || p.name?.toLowerCase().includes("kid"));
  }, [securedProducts]);

  const showVoucher3 = useMemo(() => {
    return securedProducts.some(p => p.brand?.toLowerCase().includes("ortho") || p.name?.toLowerCase().includes("ortho"));
  }, [securedProducts]);

  // Step 4: Payment Collections Layout State
  const [paymentMethod, setPaymentMethod] = useState<"Cash" | "Cheque" | "Credit">("Cash");
  const [amountCollected, setAmountCollected] = useState(0);

  // Step 5: Stock Request / Audit Layout State
  const [stockAuditLines, setStockAuditLines] = useState<{ productId: string; productName: string; shelfQty: number; requestQty: number; targetQty: number }[]>([]);

  useEffect(() => {
    if (securedProducts.length > 0 && stockAuditLines.length === 0) {
      setStockAuditLines(
        securedProducts.slice(0, 3).map((p, idx) => ({
          productId: p.id,
          productName: p.name,
          shelfQty: idx === 0 ? 12 : idx === 1 ? 3 : 45,
          targetQty: idx === 0 ? 100 : idx === 1 ? 50 : 80,
          requestQty: idx === 0 ? 50 : idx === 1 ? 20 : 0
        }))
      );
    }
  }, [securedProducts]);

  const [auditProduct, setAuditProduct] = useState("");
  const [auditShelfQty, setAuditShelfQty] = useState(5);
  const [urgentRequestQty, setUrgentRequestQty] = useState(10);

  // Step 6: Outcomes & Notes Layout State
  const [competitorIntel, setCompetitorIntel] = useState("Competitor launched 15% discount campaign on generic pediatric lines.");
  const [visitNotes, setVisitNotes] = useState("Pharmacist requested scientific brochures for the newly onboarded CardioMax formulas.");
  const [nextFollowUpDate, setNextFollowUpDate] = useState("2026-07-15");
  const [pharmacistCooperation, setPharmacistCooperation] = useState<"Excellent" | "Friendly" | "Busy" | "Skeptical">("Friendly");
  
  // Marketing checklists
  const [brochuresHanded, setBrochuresHanded] = useState(true);
  const [samplesLeft, setSamplesLeft] = useState(false);
  const [counterCardsLeft, setCounterCardsLeft] = useState(true);
  const [displayBoxLeft, setDisplayBoxLeft] = useState(false);

  // AI Detailing Advisor State
  const [loadingAi, setLoadingAi] = useState(false);
  const [aiInsightText, setAiInsightText] = useState("");

  // Live Visit Timer State and tracking
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let interval: NodeJS.Timeout | undefined;
    if (step > 1 || gpsVerified) {
      interval = setInterval(() => {
        setElapsedSeconds(prev => prev + 1);
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [step, gpsVerified]);

  // Filter pharmacies based on search query
  const filteredPharmacies = securedPharmacies.filter(p => 
    p.name.toLowerCase().includes(pharmacySearchQuery.toLowerCase()) ||
    (p.nameAr && p.nameAr.includes(pharmacySearchQuery)) ||
    p.territory.toLowerCase().includes(pharmacySearchQuery.toLowerCase())
  );

  const handleVerifyGps = async () => {
    setGpsLoading(true);
    const now = new Date();
    const formattedTime = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    try {
      const context = activePharmacy 
        ? `Pharmacy Visit: ${activePharmacy.name}` 
        : "Pharmacy Visit";
      const record = await acquireHardenedGPS(currentUser, context);
      setGpsCoords({ lat: record.latitude, lng: record.longitude });
      setGpsRecord(record);
      setGpsVerified(true);
      setCheckInTime(formattedTime);
    } catch (err: any) {
      alert(isRtl 
        ? `فشل تحديد موقعك الجغرافي: ${err.message || err}` 
        : `Failed to verify your GPS location: ${err.message || err}`);
    } finally {
      setGpsLoading(false);
    }
  };

  const handleAddProductToCart = (productId: string) => {
    const prod = securedProducts.find(p => p.id === productId);
    if (!prod) return;

    const existingIdx = orderItems.findIndex(i => i.productId === productId);
    if (existingIdx > -1) {
      const updated = [...orderItems];
      updated[existingIdx].quantity += 1;
      setOrderItems(updated);
    } else {
      const newItem: OrderItem = {
        productId: prod.id,
        productName: prod.name,
        quantity: 1,
        price: prod.price,
        discount: 0
      };
      setOrderItems([...orderItems, newItem]);
    }
  };

  const handleDecrementProductFromCart = (productId: string) => {
    const existingIdx = orderItems.findIndex(i => i.productId === productId);
    if (existingIdx > -1) {
      const updated = [...orderItems];
      if (updated[existingIdx].quantity > 1) {
        updated[existingIdx].quantity -= 1;
        setOrderItems(updated);
      } else {
        // If decrementing at 1, remove item entirely
        setOrderItems(orderItems.filter(i => i.productId !== productId));
      }
    }
  };

  const handleSetProductQuantityInCart = (productId: string, qty: number) => {
    if (qty <= 0) {
      setOrderItems(orderItems.filter(i => i.productId !== productId));
      return;
    }
    const existingIdx = orderItems.findIndex(i => i.productId === productId);
    if (existingIdx > -1) {
      const updated = [...orderItems];
      updated[existingIdx].quantity = qty;
      setOrderItems(updated);
    }
  };

  const handleAddOrderItem = () => {
    if (!selectedProduct) return;
    const prod = securedProducts.find(p => p.id === selectedProduct);
    if (!prod) return;

    const existingIdx = orderItems.findIndex(i => i.productId === selectedProduct);
    const newItem: OrderItem = {
      productId: selectedProduct,
      productName: prod.name,
      quantity: itemQty,
      price: prod.price,
      discount: 0
    };

    if (existingIdx > -1) {
      const updated = [...orderItems];
      updated[existingIdx].quantity += itemQty;
      setOrderItems(updated);
    } else {
      setOrderItems([...orderItems, newItem]);
    }

    setSelectedProduct("");
    setItemQty(15);
  };

  // Quick replenishment trigger from Step 5 directly back into the Step 2 Order List
  const handleTriggerReplenishment = (prodId: string, quantityToOrder: number) => {
    const prod = securedProducts.find(p => p.id === prodId);
    if (!prod) return;

    const existingIdx = orderItems.findIndex(i => i.productId === prodId);
    if (existingIdx > -1) {
      const updated = [...orderItems];
      updated[existingIdx].quantity += quantityToOrder;
      setOrderItems(updated);
    } else {
      const newItem: OrderItem = {
        productId: prodId,
        productName: prod.name,
        quantity: quantityToOrder,
        price: prod.price,
        discount: 0
      };
      setOrderItems([...orderItems, newItem]);
    }

    // Set interactive visual notification toast
    setReplenishNotification(`${isRtl ? "تمت إضافة" : "Added"} ${quantityToOrder}x ${prod.name} ${isRtl ? "بنجاح إلى سلة الطلبيات!" : "to the active Sales Order!"}`);
    setTimeout(() => setReplenishNotification(null), 3500);
  };

  const handleDeleteOrderItem = (productId: string) => {
    setOrderItems(orderItems.filter(i => i.productId !== productId));
  };

  const handleAddStockLine = () => {
    if (!auditProduct) return;
    const prod = securedProducts.find(p => p.id === auditProduct);
    if (!prod) return;

    const newLine = {
      productId: auditProduct,
      productName: prod.name,
      shelfQty: auditShelfQty,
      targetQty: 50,
      requestQty: urgentRequestQty
    };

    const existsIdx = stockAuditLines.findIndex(l => l.productId === auditProduct);
    if (existsIdx > -1) {
      const updated = [...stockAuditLines];
      updated[existsIdx] = newLine;
      setStockAuditLines(updated);
    } else {
      setStockAuditLines([...stockAuditLines, newLine]);
    }

    setAuditProduct("");
    setAuditShelfQty(5);
    setUrgentRequestQty(10);
  };

  // AI advisory generation based on current client telemetry and sales numbers
  const handleFetchAiAdvice = async () => {
    setLoadingAi(true);
    try {
      const payload = {
        physicianName: activePharmacy.name,
        specialty: `Retail Pharmacy - ${activePharmacy.type || "Independent"}`,
        classification: activePharmacy.region,
        region: activePharmacy.territory,
        brands: orderItems.map(item => item.productName),
        outstandingBalance: activePharmacy.outstandingBalance,
        netPayableValue: netPayable
      };
      const advice = await fetchAiInsight("nba", payload, currentUser);
      setAiInsightText(advice);
    } catch (e) {
      setAiInsightText("Provide customized retail support and suggest bulk tiering on kid wellness products.");
    } finally {
      setLoadingAi(false);
    }
  };

  // Calculations
  const grossTotal = orderItems.reduce((acc, item) => acc + (item.price * item.quantity), 0);
  const discountAmount = grossTotal * (globalDiscount / 100);
  const netPayable = Math.max(0, grossTotal - discountAmount);
  
  const currentOutstanding = activePharmacy.outstandingBalance;
  const simulatedOutstandingAfter = Math.max(0, currentOutstanding + netPayable - amountCollected);

  const selectedProductDetails = securedProducts.find(p => p.id === selectedProduct);
  const stockExceeded = selectedProductDetails && itemQty > selectedProductDetails.stock;

  const handleBookVisit = () => {
    if (nextFollowUpDate) {
      const todayStr = new Date().toISOString().split("T")[0];
      if (nextFollowUpDate < todayStr) {
        alert(
          isRtl
            ? "تاريخ المتابعة القادمة لا يمكن أن يكون في الماضي."
            : "The next follow-up date cannot be in the past."
        );
        return;
      }
    }

    if (isSubmitting) return;
    setIsSubmitting(true);

    try {
      const materials: string[] = [];
      if (brochuresHanded) materials.push("Scientific Brochures");
      if (samplesLeft) materials.push("Product Samples");
      if (counterCardsLeft) materials.push("Counter Cards");
      if (displayBoxLeft) materials.push("Shelf Display Boxes");

      const completedVisit: PharmacyVisitType = {
        id: `PV-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
        date: new Date().toISOString().split("T")[0],
        pharmacyId: activePharmacy.id,
        pharmacyName: activePharmacy.name,
        repId: currentUser.id,
        repName: currentUser.name,
        visitDate: new Date().toISOString().split("T")[0],
        gpsVerified: true,
        latitude: gpsCoords?.lat,
        longitude: gpsCoords?.lng,
        gpsAccuracy: gpsRecord?.accuracy,
        gpsTimestamp: gpsRecord?.timestamp,
        gpsSource: gpsRecord?.source,
        gpsSpoofCheckStatus: gpsRecord?.spoofCheckStatus || "Passed",
        visitPurpose: orderItems.length > 0 ? "Order Intake" : "Collection",
        items: orderItems.map(item => ({ ...item, discount: globalDiscount })),
        totalAmount: grossTotal,
        discountApplied: discountAmount,
        netAmount: netPayable,
        paymentMethod: amountCollected > 0 ? paymentMethod : undefined,
        paymentCollected: amountCollected > 0 ? amountCollected : undefined,
        outstandingBalanceAfter: simulatedOutstandingAfter,
        stockAudit: stockAuditLines.map(line => ({
          productId: line.productId,
          productName: line.productName,
          availableStock: securedProducts.find(p => p.id === line.productId)?.stock || 100,
          shelfQty: line.shelfQty
        })),
        stockRequests: stockAuditLines
          .filter(l => l.requestQty > 0)
          .map(l => ({
            productId: l.productId,
            productName: l.productName,
            requestQty: l.requestQty
          })),
        intelNotes: `Stock requests: ${stockAuditLines.filter(l => l.requestQty > 0).map(l => `${l.productName} (x${l.requestQty})`).join(", ") || "None"}. Intel: ${competitorIntel}. Materials left: ${materials.join(", ")}. Cooperation: ${pharmacistCooperation}. Notes: ${visitNotes}`,
        durationSeconds: elapsedSeconds,
        createdAt: new Date().toISOString()
      };

      onCompletePharmacyVisit(completedVisit);

      // Reset wizard
      setStep(1);
      setSelectedPharmacy(null);
      setGpsVerified(false);
      setCheckInTime("");
      setAiInsightText("");
      setElapsedSeconds(0);

      if (onNavigate) {
        onNavigate("pharmacies-visit-history");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Step Translation Keys
  const t = {
    en: {
      visitHeader: "Interactive Pharmacy Check-in & Detailing Loop",
      visitSub: "Multi-step structured medical sales and retail billing loop for field pharmacy calls",
      activePharmacy: "Active Pharmacy Client",
      selectPharmacy: "Select Pharmacy Route",
      orderIntake: "Sales Order",
      offersPromotions: "Promotions Deck",
      paymentCollection: "Payment & AR",
      stockAudit: "Stock Verification",
      outcomesNotes: "Verify & Sync",
      stepIndicator: "Workflow Step",
      outstandingBalance: "AR Balance",
      verifyGps: "Acquire GPS Satellite Alignment",
      gpsLocked: "Coordinates Authenticated",
      targetLoc: "Telemetry Diagnostics",
      nextBtn: "Next Step",
      prevBtn: "Previous",
      commitBtn: "Commit & Sync Visit",
      noRecords: "No matching retail accounts mapped to this route.",
      checkinTime: "Check-in Timestamp",
      accuracy: "GPS Accuracy Safe",
      distanceMessage: "Device is 8 meters away from target site",
      stockAvailable: "Database Stock Available",
      stockWarning: "Insufficient database stock! Requested quantity exceeds current available supply.",
      voucherHeading: "Available Campaign Voucher Schemes",
      voucherSub: "Click any coupon card to instantly apply the trade promotion deal.",
      quickFill: "Quick Settlement Presets",
      ledgerTitle: "Simulated Post-Visit Account Balance Ledger",
      replenishQuickBtn: "Direct Replenish",
      replenishTitle: "Stock Audit Matrix",
      auditPrompt: "Record current physical counts of formulas sitting on the store's retail shelf",
      cooperationTitle: "Pharmacist Engagement Level",
      materialsTitle: "Marketing & Clinical Materials Disbursed",
      aiAdvisorTitle: "AI Detailing Assist Copilot",
      aiAdvisorPrompt: "Consult Gemini-assisted recommendations customized for this retailer's sales profile and region"
    },
    ar: {
      visitHeader: "مسار زيارة الصيدلية الميدانية المتكامل",
      visitSub: "تدفق متكامل متعدد الخطوات للمبيعات الدوائية، الجرد، وتحصيل المقبوضات المالية",
      activePharmacy: "الصيدلية النشطة حالياً",
      selectPharmacy: "تحديد الصيدلية المستهدفة",
      orderIntake: "الطلبية والمبيعات",
      offersPromotions: "باقة العروض الترويجية",
      paymentCollection: "المقبوضات والذمم المالية",
      stockAudit: "جرد الرف والمخزون",
      outcomesNotes: "المخرجات والنتائج",
      stepIndicator: "خطوة العمل الميداني",
      outstandingBalance: "الرصيد المستحق",
      verifyGps: "تأكيد الموقع الجغرافي بالساتل GPS",
      gpsLocked: "تم تأكيد الإحداثيات والربط بنجاح",
      targetLoc: "تليميتري الموقع الجغرافي",
      nextBtn: "الخطوة التالية",
      prevBtn: "الخطوة السابقة",
      commitBtn: "حفظ ومزامنة الزيارة",
      noRecords: "لا يوجد صيدليات مطابقة لمسار البحث الحالي.",
      checkinTime: "توقيت تسجيل الدخول",
      accuracy: "دقة الموقع آمنة للغاية",
      distanceMessage: "المسافة الحالية عن الصيدلية: 8 أمتار",
      stockAvailable: "المخزون المتوفر في المستودع",
      stockWarning: "تنبيه! الكمية المطلوبة تتجاوز الرصيد المتوفر حالياً في المستودعات.",
      voucherHeading: "باقة عروض الترويج التجاري المتاحة",
      voucherSub: "انقر على أي بطاقة خصم لتطبيق العرض والنسبة الترويجية مباشرة.",
      quickFill: "خيارات التسوية المالية السريعة",
      ledgerTitle: "محاكاة دفتر حسابات الذمم بعد تدوين المعاملة",
      replenishQuickBtn: "إعادة تزويد فوري",
      replenishTitle: "لوحة جرد رفوف الصيدلية",
      auditPrompt: "تسجيل كميات الأدوية الفعلية المتواجدة على رفوف العرض بالصيدلية حالياً",
      cooperationTitle: "مستوى تفاعل واستجابة الصيدلاني",
      materialsTitle: "المواد التسويقية والبروشورات العلمية الموزعة",
      aiAdvisorTitle: "مساعد الذكاء الاصطناعي الذكي للزيارات",
      aiAdvisorPrompt: "توليد نصائح استراتيجية ومقترحات مخصصة بناءً على سجل مبيعات وحسابات الصيدلية"
    }
  }[lang];

  return (
    <div className="space-y-6 max-w-full overflow-hidden" id="pharmacy-visit-wizard-root" dir={isRtl ? "rtl" : "ltr"}>
      
      {/* 1. Header Section */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-100 dark:border-slate-800 pb-5" id="pharmacy-visit-page-header">
        <div className="flex items-center gap-3">
          <div className="bg-blue-50 dark:bg-blue-950/50 p-2.5 rounded-xl text-blue-600 dark:text-blue-400">
            <Warehouse size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">{t.visitHeader}</h1>
            <p className="text-xs text-slate-500 mt-0.5">{t.visitSub}</p>
          </div>
        </div>

        {/* Dynamic Badge for Active Client */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase font-bold text-slate-400 px-2 py-1 bg-slate-100 dark:bg-slate-800/80 rounded-md">
            {lang === "ar" ? "المندوب" : "Sales Rep"}: {currentUser.name}
          </span>
          <span className="text-[10px] uppercase font-bold text-amber-700 bg-amber-50 dark:bg-amber-950/40 border border-amber-100 dark:border-amber-900/30 px-2.5 py-1 rounded-md font-mono flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            {lang === "ar" ? "وقت الزيارة" : "Timer"}: {Math.floor(elapsedSeconds / 60)}:{(elapsedSeconds % 60).toString().padStart(2, '0')}
          </span>
          <span className="text-[10px] uppercase font-bold text-rose-600 bg-rose-50 dark:bg-rose-950/40 border border-rose-100 dark:border-rose-900/30 px-2.5 py-1 rounded-md font-mono">
            {lang === "ar" ? "الذمم الحالية" : "Active AR"}: ${activePharmacy.outstandingBalance.toLocaleString()}
          </span>
        </div>
      </div>

      {/* Floating Alert Toast for replenishment trigger */}
      <AnimatePresence>
        {replenishNotification && (
          <motion.div 
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="bg-emerald-600 text-white font-bold p-3.5 rounded-xl shadow-lg text-xs flex items-center justify-between gap-3 border border-emerald-500 max-w-md mx-auto"
            id="replenish-alert-toast"
          >
            <div className="flex items-center gap-2">
              <Check size={16} className="bg-white text-emerald-600 rounded-full p-0.5" />
              <span>{replenishNotification}</span>
            </div>
            <button 
              onClick={() => setReplenishNotification(null)}
              className="text-[10px] uppercase hover:underline opacity-80 cursor-pointer"
            >
              Dismiss
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 2. Enhanced Stepper Row indicating step completion */}
      <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-4 shadow-xs" id="pharmacy-visit-stepper">
        <div className="flex justify-between items-center max-w-5xl mx-auto overflow-x-auto gap-4 py-2" id="stepper-horizontal-track">
          
          {/* Step 1 Button */}
          <div className="flex flex-col items-center shrink-0">
            <button 
              onClick={() => setStep(1)}
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all cursor-pointer ${
                step > 1 ? "bg-blue-600 border-blue-600 text-white" : step === 1 ? "border-blue-600 bg-blue-50 dark:bg-blue-950 text-blue-600 font-extrabold" : "border-slate-200 text-slate-400"
              }`}
            >
              {gpsVerified ? <Check size={14} className="stroke-[3]" /> : "1"}
            </button>
            <span className={`text-[9.5px] mt-1 font-bold ${step === 1 ? "text-blue-600" : "text-slate-400"}`}>{t.selectPharmacy}</span>
          </div>

          <div className={`flex-1 min-w-[15px] h-0.5 ${step > 1 ? "bg-blue-600" : "bg-slate-100 dark:bg-slate-800"}`} />

          {/* Step 2 Button */}
          <div className="flex flex-col items-center shrink-0">
            <button 
              onClick={() => setStep(2)}
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all cursor-pointer ${
                step > 2 ? "bg-blue-600 border-blue-600 text-white" : step === 2 ? "border-blue-600 bg-blue-50 dark:bg-blue-950 text-blue-600 font-extrabold" : "border-slate-200 text-slate-400"
              }`}
            >
              {orderItems.length > 0 && step > 2 ? <Check size={14} className="stroke-[3]" /> : "2"}
            </button>
            <span className={`text-[9.5px] mt-1 font-bold ${step === 2 ? "text-blue-600" : "text-slate-400"}`}>{t.orderIntake}</span>
          </div>

          <div className={`flex-1 min-w-[15px] h-0.5 ${step > 2 ? "bg-blue-600" : "bg-slate-100 dark:bg-slate-800"}`} />

          {/* Step 3 Button */}
          <div className="flex flex-col items-center shrink-0">
            <button 
              onClick={() => setStep(3)}
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all cursor-pointer ${
                step > 3 ? "bg-blue-600 border-blue-600 text-white" : step === 3 ? "border-blue-600 bg-blue-50 dark:bg-blue-950 text-blue-600 font-extrabold" : "border-slate-200 text-slate-400"
              }`}
            >
              {selectedOfferCode && step > 3 ? <Check size={14} className="stroke-[3]" /> : "3"}
            </button>
            <span className={`text-[9.5px] mt-1 font-bold ${step === 3 ? "text-blue-600" : "text-slate-400"}`}>{t.offersPromotions}</span>
          </div>

          <div className={`flex-1 min-w-[15px] h-0.5 ${step > 3 ? "bg-blue-600" : "bg-slate-100 dark:bg-slate-800"}`} />

          {/* Step 4 Button */}
          <div className="flex flex-col items-center shrink-0">
            <button 
              onClick={() => setStep(4)}
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all cursor-pointer ${
                step > 4 ? "bg-blue-600 border-blue-600 text-white" : step === 4 ? "border-blue-600 bg-blue-50 dark:bg-blue-950 text-blue-600 font-extrabold" : "border-slate-200 text-slate-400"
              }`}
            >
              {amountCollected > 0 && step > 4 ? <Check size={14} className="stroke-[3]" /> : "4"}
            </button>
            <span className={`text-[9.5px] mt-1 font-bold ${step === 4 ? "text-blue-600" : "text-slate-400"}`}>{t.paymentCollection}</span>
          </div>

          <div className={`flex-1 min-w-[15px] h-0.5 ${step > 4 ? "bg-blue-600" : "bg-slate-100 dark:bg-slate-800"}`} />

          {/* Step 5 Button */}
          <div className="flex flex-col items-center shrink-0">
            <button 
              onClick={() => setStep(5)}
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all cursor-pointer ${
                step > 5 ? "bg-blue-600 border-blue-600 text-white" : step === 5 ? "border-blue-600 bg-blue-50 dark:bg-blue-950 text-blue-600 font-extrabold" : "border-slate-200 text-slate-400"
              }`}
            >
              {stockAuditLines.length > 0 && step > 5 ? <Check size={14} className="stroke-[3]" /> : "5"}
            </button>
            <span className={`text-[9.5px] mt-1 font-bold ${step === 5 ? "text-blue-600" : "text-slate-400"}`}>{t.stockAudit}</span>
          </div>

          <div className={`flex-1 min-w-[15px] h-0.5 ${step > 5 ? "bg-blue-600" : "bg-slate-100 dark:bg-slate-800"}`} />

          {/* Step 6 Button */}
          <div className="flex flex-col items-center shrink-0">
            <button 
              onClick={() => setStep(6)}
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all cursor-pointer ${
                step === 6 ? "border-blue-600 bg-blue-50 dark:bg-blue-950 text-blue-600 font-extrabold" : "border-slate-200 text-slate-400"
              }`}
            >
              {"6"}
            </button>
            <span className={`text-[9.5px] mt-1 font-bold ${step === 6 ? "text-blue-600" : "text-slate-400"}`}>{t.outcomesNotes}</span>
          </div>

        </div>
      </div>

      {/* 3. Main Work Area Panel */}
      <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-5 md:p-6 shadow-sm min-h-[380px]" id="pharmacy-wizard-work-area">
        
        {/* STEP 1: SELECT PHARMACY & GPS LOCATOR */}
        {step === 1 && (
          <div className="space-y-6 animate-fade-in" id="step-1-select-pharmacy">
            <div className="flex justify-between items-center border-b border-slate-50 dark:border-slate-800 pb-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5">
                <Store className="w-4 h-4 text-blue-500" />
                <span>{isRtl ? "خطوة ١: تحديد الصيدلية الحالية والتحقق من الموقع" : "Step 1: Check-in & Coordinate Lock"}</span>
              </h3>
              <span className="text-xxs font-mono text-slate-400 font-bold">Route Client Matching</span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* Left Column: Selector List */}
              <div className="lg:col-span-2 space-y-3.5">
                <div className="relative">
                  <Search className={`absolute ${isRtl ? "right-3" : "left-3"} top-1/2 -translate-y-1/2 text-slate-400`} size={15} />
                  <input
                    type="text"
                    placeholder={isRtl ? "البحث بالاسم أو النطاق الجغرافي للموزع..." : "Search pharmacy name, region, or territorial route..."}
                    value={pharmacySearchQuery}
                    onChange={(e) => setPharmacySearchQuery(e.target.value)}
                    className={`w-full ${isRtl ? "pr-9 pl-4" : "pl-9 pr-4"} py-2 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-slate-50/50 dark:bg-slate-950 text-slate-800 dark:text-white outline-none focus:border-blue-500`}
                  />
                </div>

                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {filteredPharmacies.length > 0 ? (
                    filteredPharmacies.map((pharm) => (
                      <div
                        key={pharm.id}
                        onClick={() => {
                          setSelectedPharmacy(pharm);
                          setGpsVerified(false);
                          setCheckInTime("");
                        }}
                        className={`p-3.5 border rounded-xl cursor-pointer transition-all flex justify-between items-center ${
                          activePharmacy.id === pharm.id 
                            ? "border-blue-500 bg-blue-50/20 dark:bg-blue-950/20 shadow-sm" 
                            : "border-slate-100 dark:border-slate-800 hover:bg-slate-50/50 dark:hover:bg-slate-850/20"
                        }`}
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-xs text-slate-800 dark:text-slate-100">
                              {lang === "ar" && pharm.nameAr ? pharm.nameAr : pharm.name}
                            </span>
                            <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[9px] font-bold text-slate-500">
                              {pharm.type || "Retail"}
                            </span>
                          </div>
                          <p className="text-[10.5px] text-slate-400 mt-1 uppercase font-semibold">
                            {pharm.region} • {pharm.territory}
                          </p>
                          <p className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1">
                            <MapPin size={10} className="text-slate-300" />
                            <span>{pharm.address}</span>
                          </p>
                        </div>
                        <div className="text-right">
                          <span className="text-[9px] font-mono text-slate-400 block uppercase">AR Balance</span>
                          <span className="text-xs font-bold text-rose-500 font-mono">${pharm.outstandingBalance.toLocaleString()}</span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="p-8 text-center text-slate-400 text-xs italic">
                      {t.noRecords}
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column: GPS Locking Panel with thick green top border */}
              <div className="lg:col-span-1 bg-white dark:bg-slate-950 p-5 rounded-xl border border-slate-200/60 dark:border-slate-800/85 border-t-4 border-t-emerald-500 shadow-sm space-y-4">
                <div className="flex items-center gap-2 border-b border-slate-50 dark:border-slate-900 pb-2">
                  <Compass className="text-emerald-500" size={16} />
                  <h4 className="text-xs font-extrabold text-slate-800 dark:text-white uppercase tracking-wide">{t.targetLoc}</h4>
                </div>

                <div className="space-y-3 text-xs">
                  <div className="p-3 bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-lg space-y-1.5 font-mono">
                    <span className="font-bold text-slate-800 dark:text-slate-200 block text-xs">
                      {lang === "ar" && activePharmacy.nameAr ? activePharmacy.nameAr : activePharmacy.name}
                    </span>
                    <p className="text-[10px] text-slate-400">Lat: {activePharmacy.latitude != null && activePharmacy.latitude !== 0 ? activePharmacy.latitude : "— (First Visit GPS Required)"}</p>
                    <p className="text-[10px] text-slate-400">Lng: {activePharmacy.longitude != null && activePharmacy.longitude !== 0 ? activePharmacy.longitude : "— (First Visit GPS Required)"}</p>
                    <p className="text-[10px] text-slate-400">Territory: {activePharmacy.territory}</p>
                  </div>

                  <div className="p-3 bg-blue-50/35 dark:bg-blue-950/20 rounded-lg text-[10.5px] text-blue-700 dark:text-blue-400 flex items-center gap-2 font-medium">
                    <MapPinCheck size={14} className="shrink-0" />
                    <span>{t.distanceMessage}</span>
                  </div>

                  {gpsVerified ? (
                    <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-150 dark:border-emerald-900/40 rounded-lg text-emerald-700 dark:text-emerald-400 flex flex-col gap-1" id="gps-success-card">
                      <div className="flex items-center gap-2 font-bold">
                        <MapPinCheck size={16} className="text-emerald-500 animate-pulse" />
                        <span>{t.gpsLocked}</span>
                      </div>
                      <div className="text-[9.5px] font-mono text-slate-400 mt-1 space-y-0.5">
                        <p>{t.checkinTime}: <span className="font-bold text-slate-700 dark:text-slate-200">{checkInTime}</span></p>
                        <p>{isRtl ? "دقة القياس:" : "Accuracy:"} <span className="font-bold text-slate-700 dark:text-slate-200">{gpsRecord?.accuracy ? gpsRecord.accuracy.toFixed(1) + "m" : "8.5m"}</span></p>
                        <p>{isRtl ? "تحديد بواسطة:" : "Source:"} <span className="font-bold text-slate-700 dark:text-slate-200">{gpsRecord?.source === "simulation_demo" ? (isRtl ? "محاكاة تجريبية" : "Simulation") : (isRtl ? "جهاز حقيقي" : "Native GPS")}</span></p>
                        {gpsCoords && <p>Coords: {gpsCoords.lat.toFixed(5)}, {gpsCoords.lng.toFixed(5)}</p>}
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={handleVerifyGps}
                      disabled={gpsLoading}
                      className="w-full py-2.5 bg-slate-950 hover:bg-slate-900 text-white text-xs font-bold rounded-lg flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <Compass size={14} className={gpsLoading ? "animate-spin text-blue-400" : "text-white"} />
                      <span>{gpsLoading ? (isRtl ? "جاري الاتصال بالأقمار الاصطناعية..." : "Contacting satellite telemetry...") : t.verifyGps}</span>
                    </button>
                  )}
                </div>
              </div>

            </div>
          </div>
        )}

        {/* STEP 2: CONSTRUCT SALES ORDER INTAKE */}
        {step === 2 && (
          <div className="space-y-5 animate-fade-in" id="step-2-order-intake">
            <div className="flex justify-between items-center border-b border-slate-50 dark:border-slate-800 pb-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5">
                <ShoppingCart className="w-4 h-4 text-blue-500" />
                <span>{isRtl ? "خطوة ٢: تسجيل الطلبيات الدوائية المباشرة" : "Step 2: Construct Sales Order Intake"}</span>
              </h3>
              <span className="text-xxs font-mono text-slate-400 font-bold uppercase">
                {isRtl ? "العميل النشط" : "Active Client"}: {lang === "ar" && activePharmacy.nameAr ? activePharmacy.nameAr : activePharmacy.name}
              </span>
            </div>

            {/* Product search input at top */}
            <div className="relative max-w-md">
              <Search className={`absolute ${isRtl ? "right-3.5" : "left-3.5"} top-1/2 -translate-y-1/2 text-slate-400`} size={15} />
              <input
                type="text"
                placeholder={isRtl ? "البحث عن المنتجات..." : "Search products..."}
                value={productSearchQuery}
                onChange={(e) => setProductSearchQuery(e.target.value)}
                className={`w-full ${isRtl ? "pr-10 pl-4" : "pl-10 pr-4"} py-2.5 border border-slate-200 dark:border-slate-800 rounded-xl text-xs bg-slate-50/50 dark:bg-slate-950 text-slate-800 dark:text-white outline-none focus:border-blue-500 shadow-2xs`}
              />
            </div>

            {/* Replenish Notification (from direct replenish clicks in Step 5 if triggered) */}
            {replenishNotification && (
              <div className="p-3 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-150 dark:border-emerald-900/40 text-emerald-700 dark:text-emerald-400 rounded-xl text-xs flex items-center gap-2 font-bold animate-fade-in" id="replenish-notification-step2">
                <Check size={16} />
                <span>{replenishNotification}</span>
              </div>
            )}

            {/* Two Column Layout: Left Column = Available Products, Right Column = Selected Order Cart */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              {/* Left Column: Available Products List */}
              <div className="lg:col-span-7 space-y-3">
                <div className="flex items-center gap-2 text-xs font-extrabold text-slate-600 dark:text-slate-300 pb-2 border-b border-slate-100 dark:border-slate-800">
                  <Warehouse className="w-4 h-4 text-slate-400" />
                  <span>{isRtl ? "المنتجات المتاحة" : "Available Products"}</span>
                </div>

                <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
                  {securedProducts.filter(p => 
                    p.name.toLowerCase().includes(productSearchQuery.toLowerCase()) ||
                    (p.brand && p.brand.toLowerCase().includes(productSearchQuery.toLowerCase())) ||
                    (p.therapeuticArea && p.therapeuticArea.toLowerCase().includes(productSearchQuery.toLowerCase())) ||
                    p.id.toLowerCase().includes(productSearchQuery.toLowerCase())
                  ).map((p) => {
                    const itemInCart = orderItems.find(item => item.productId === p.id);
                    return (
                      <div
                        key={p.id}
                        className="p-3.5 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800/80 rounded-xl flex items-center justify-between hover:shadow-xs hover:border-slate-200 dark:hover:border-slate-750 transition-all"
                      >
                        <div className="flex items-center gap-3">
                          {/* Accent left line like in screenshot */}
                          <div className="w-1 self-stretch min-h-[36px] rounded bg-emerald-500 shrink-0" />
                          <div>
                            <h4 className="font-bold text-xs text-slate-800 dark:text-slate-100">
                              [{p.id}] {p.name}
                            </h4>
                            <p className="text-[10.5px] text-slate-400 mt-0.5 font-semibold uppercase">
                              {p.therapeuticArea} | ${p.price.toFixed(2)}
                            </p>
                            <p className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1.5 font-mono">
                              <span>Stock: {p.stock}</span>
                              {itemInCart && (
                                <span className="text-blue-600 dark:text-blue-400 font-bold font-sans">
                                  {isRtl ? `(في الطلبية: ${itemInCart.quantity})` : `(in order: ${itemInCart.quantity})`}
                                </span>
                              )}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => handleAddProductToCart(p.id)}
                          className="p-1.5 rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer"
                        >
                          <Plus size={15} />
                        </button>
                      </div>
                    );
                  })}

                  {securedProducts.filter(p => 
                    p.name.toLowerCase().includes(productSearchQuery.toLowerCase()) ||
                    (p.brand && p.brand.toLowerCase().includes(productSearchQuery.toLowerCase())) ||
                    (p.therapeuticArea && p.therapeuticArea.toLowerCase().includes(productSearchQuery.toLowerCase())) ||
                    p.id.toLowerCase().includes(productSearchQuery.toLowerCase())
                  ).length === 0 && (
                    <div className="text-center py-10 text-slate-400 text-xs italic font-mono bg-slate-50/50 dark:bg-slate-900 rounded-xl border border-dashed border-slate-200 dark:border-slate-800">
                      {isRtl ? "لا توجد نتائج مطابقة لعملية البحث" : "No matching products found."}
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column: Selected Order Cart */}
              <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-4 shadow-2xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-2 text-xs font-extrabold text-slate-600 dark:text-slate-300 pb-2 border-b border-slate-100 dark:border-slate-800 mb-3">
                    <ShoppingCart className="w-4 h-4 text-blue-500" />
                    <span>
                      {isRtl ? `عناصر الطلبية (${orderItems.length})` : `Order Items (${orderItems.length})`}
                    </span>
                  </div>

                  <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
                    {orderItems.map((item) => (
                      <div
                        key={item.productId}
                        className="bg-slate-50/50 dark:bg-slate-950/30 border border-slate-150/40 dark:border-slate-800/60 p-3.5 rounded-xl relative flex flex-col gap-3"
                      >
                        {/* Remove button */}
                        <button
                          onClick={() => handleDeleteOrderItem(item.productId)}
                          className="absolute top-3 right-3 text-slate-400 hover:text-rose-500 cursor-pointer transition-colors"
                          aria-label="Remove item"
                        >
                          <X size={15} />
                        </button>

                        <div className="pr-6">
                          <h4 className="font-bold text-xs text-slate-800 dark:text-white leading-tight">
                            {item.productName}
                          </h4>
                          <p className="text-[10px] text-slate-400 font-semibold mt-0.5">
                            ${item.price.toFixed(2)} each
                          </p>
                        </div>

                        <div className="flex justify-between items-center mt-0.5">
                          {/* Quantity control capsule */}
                          <div className="flex items-center border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-lg overflow-hidden shadow-2xs">
                            <button
                              onClick={() => handleDecrementProductFromCart(item.productId)}
                              className="px-2.5 py-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-rose-500 transition-colors cursor-pointer text-xs font-bold select-none"
                            >
                              −
                            </button>
                            <input
                              type="number"
                              min="1"
                              value={item.quantity}
                              onChange={(e) => handleSetProductQuantityInCart(item.productId, parseInt(e.target.value) || 1)}
                              className="w-8 text-center text-xs font-bold font-mono bg-transparent outline-none border-none py-1 text-slate-800 dark:text-white [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            />
                            <button
                              onClick={() => handleAddProductToCart(item.productId)}
                              className="px-2.5 py-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-blue-500 transition-colors cursor-pointer text-xs font-bold select-none"
                            >
                              +
                            </button>
                          </div>

                          {/* Item Subtotal */}
                          <span className="font-extrabold text-xs text-slate-900 dark:text-white font-mono">
                            ${(item.price * item.quantity).toLocaleString()}
                          </span>
                        </div>
                      </div>
                    ))}

                    {orderItems.length === 0 && (
                      <div className="text-center py-12 text-slate-400 text-xs italic bg-slate-50/20 dark:bg-slate-950/10 rounded-xl border border-dashed border-slate-150 dark:border-slate-800">
                        {isRtl ? "لا توجد عناصر مضافة للطلبية." : "No active order lines."}
                      </div>
                    )}
                  </div>
                </div>

                {/* Subtotal Footer */}
                <div className="border-t border-slate-100 dark:border-slate-800 pt-3.5 mt-4 flex justify-between items-center">
                  <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                    {isRtl ? "المجموع الفرعي:" : "Subtotal:"}
                  </span>
                  <span className="font-extrabold text-sm text-slate-900 dark:text-white font-mono">
                    ${grossTotal.toLocaleString()}
                  </span>
                </div>
              </div>

            </div>
          </div>
        )}

        {/* STEP 3: OFFERS & PROMOTIONS (UPGRADED VOUCHER DECK) */}
        {step === 3 && (
          <div className="space-y-5 animate-fade-in" id="step-3-offers-promotions">
            <div className="flex justify-between items-center border-b border-slate-50 dark:border-slate-800 pb-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5">
                <Tag className="w-4 h-4 text-blue-500" />
                <span>{isRtl ? "خطوة ٣: تطبيق العروض والخصومات الإقليمية" : "Step 3: Map Active Trade Offers & Discounts"}</span>
              </h3>
              <span className="text-xxs font-mono text-slate-400 font-bold">Promotion Campaigns Mapped</span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* Left Column: Interactive Voucher Schemes Grid */}
              <div className="lg:col-span-2 space-y-4">
                <div>
                  <h4 className="text-xs font-bold text-slate-800 dark:text-white mb-1">{t.voucherHeading}</h4>
                  <p className="text-[11px] text-slate-400">{t.voucherSub}</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  
                  {/* Voucher Card 1 */}
                  {showVoucher1 && (
                    <div 
                      onClick={() => {
                        setSelectedOfferCode("Q2-BONUS-10");
                        setGlobalDiscount(10);
                      }}
                      className={`relative p-4 border rounded-xl cursor-pointer transition-all ${
                        selectedOfferCode === "Q2-BONUS-10"
                          ? "border-blue-500 bg-blue-50/25 dark:bg-blue-950/20 shadow-md ring-1 ring-blue-500"
                          : "border-slate-100 dark:border-slate-800 hover:bg-slate-50/50"
                      }`}
                    >
                      <div className="flex justify-between items-start">
                        <div className="bg-blue-100 dark:bg-blue-900/40 p-1.5 rounded-lg text-blue-600">
                          <Gift size={16} />
                        </div>
                        <span className="font-mono text-[11px] font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950 px-2 py-0.5 rounded-md">10% OFF</span>
                      </div>
                      <h5 className="font-bold text-xs mt-3 text-slate-800 dark:text-white">Q2 Retail Booster Scheme</h5>
                      <p className="text-[10px] text-slate-400 mt-1">Standard promo for independent pharmacies upon direct check-in.</p>
                      <span className="font-mono text-[9px] text-slate-500 uppercase tracking-widest block mt-2">Code: Q2-BONUS-10</span>
                    </div>
                  )}

                  {/* Voucher Card 2 */}
                  {showVoucher2 && (
                    <div 
                      onClick={() => {
                        setSelectedOfferCode("KSA-VOLUME-20");
                        setGlobalDiscount(20);
                      }}
                      className={`relative p-4 border rounded-xl cursor-pointer transition-all ${
                        selectedOfferCode === "KSA-VOLUME-20"
                          ? "border-blue-500 bg-blue-50/25 dark:bg-blue-950/20 shadow-md ring-1 ring-blue-500"
                          : "border-slate-100 dark:border-slate-800 hover:bg-slate-50/50"
                      }`}
                    >
                      <div className="flex justify-between items-start">
                        <div className="bg-emerald-100 dark:bg-emerald-900/40 p-1.5 rounded-lg text-emerald-600">
                          <TrendingUp size={16} />
                        </div>
                        <span className="font-mono text-[11px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950 px-2 py-0.5 rounded-md">20% OFF</span>
                      </div>
                      <h5 className="font-bold text-xs mt-3 text-slate-800 dark:text-white">Bulk Volume Supplier Deal</h5>
                      <p className="text-[10px] text-slate-400 mt-1">High-volume orders surpassing 100 total formulation packs.</p>
                      <span className="font-mono text-[9px] text-slate-500 uppercase tracking-widest block mt-2">Code: KSA-VOLUME-20</span>
                    </div>
                  )}

                  {/* Voucher Card 3 */}
                  {showVoucher3 && (
                    <div 
                      onClick={() => {
                        setSelectedOfferCode("FIRST-MED-5");
                        setGlobalDiscount(5);
                      }}
                      className={`relative p-4 border rounded-xl cursor-pointer transition-all ${
                        selectedOfferCode === "FIRST-MED-5"
                          ? "border-blue-500 bg-blue-50/25 dark:bg-blue-950/20 shadow-md ring-1 ring-blue-500"
                          : "border-slate-100 dark:border-slate-800 hover:bg-slate-50/50"
                      }`}
                    >
                      <div className="flex justify-between items-start">
                        <div className="bg-amber-100 dark:bg-amber-900/40 p-1.5 rounded-lg text-amber-600">
                          <BookmarkCheck size={16} />
                        </div>
                        <span className="font-mono text-[11px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950 px-2 py-0.5 rounded-md">5% OFF</span>
                      </div>
                      <h5 className="font-bold text-xs mt-3 text-slate-800 dark:text-white">Introductory Scheme</h5>
                      <p className="text-[10px] text-slate-400 mt-1">Special rate on initial detailing lines introduced on this run.</p>
                      <span className="font-mono text-[9px] text-slate-500 uppercase tracking-widest block mt-2">Code: FIRST-MED-5</span>
                    </div>
                  )}

                  {/* Custom manual slider option card */}
                  <div className="p-4 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl space-y-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase block">Manual Discount Override</span>
                    <input
                      type="range"
                      min="0"
                      max="40"
                      value={globalDiscount}
                      onChange={(e) => {
                        setGlobalDiscount(Number(e.target.value));
                        setSelectedOfferCode("MANUAL-OVERRIDE");
                      }}
                      className="w-full accent-blue-600 cursor-pointer"
                    />
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-500">Applied Discount:</span>
                      <span className="font-bold text-blue-600 font-mono">{globalDiscount}%</span>
                    </div>
                  </div>

                </div>
              </div>

              {/* Right Column: Order summary sheet */}
              <div className="p-5 bg-slate-900 text-white rounded-xl space-y-4 font-mono text-xs flex flex-col justify-between">
                <div>
                  <h4 className="text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-800 pb-2 mb-3 font-bold flex items-center gap-1.5">
                    <Gift size={12} className="text-blue-400" />
                    <span>Receipt Summary</span>
                  </h4>
                  
                  <div className="space-y-2.5">
                    <div className="flex justify-between text-slate-300">
                      <span>Gross Order Value:</span>
                      <span>${grossTotal.toLocaleString()}</span>
                    </div>
                    
                    <div className="flex justify-between text-rose-400 font-semibold">
                      <span>Discount (Scheme: {selectedOfferCode}):</span>
                      <span>-${discountAmount.toLocaleString()} ({globalDiscount}%)</span>
                    </div>

                    <div className="border-t border-slate-800 my-2 pt-2.5 flex justify-between text-emerald-400 font-bold text-sm">
                      <span>Net Balance Payable:</span>
                      <span>${netPayable.toLocaleString()}</span>
                    </div>
                  </div>
                </div>

                <div className="text-[9.5px] text-slate-500 border-t border-slate-800 pt-2.5 leading-normal">
                  Invoice generated under G-Suite Sales ledger protocol. Disbursed items will update the inventory holds immediately upon supervisor approval.
                </div>
              </div>

            </div>
          </div>
        )}

        {/* STEP 4: PAYMENT COLLECTION & AR SETTLEMENT (UPGRADED WITH QUICK PAY PRESETS) */}
        {step === 4 && (
          <div className="space-y-5 animate-fade-in" id="step-4-payment-collection">
            <div className="flex justify-between items-center border-b border-slate-50 dark:border-slate-800 pb-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5">
                <DollarSign className="w-4 h-4 text-blue-500" />
                <span>{isRtl ? "خطوة ٤: تسجيل الدفعات المالية والتحصيل" : "Step 4: Outstanding AR Payment Settlement"}</span>
              </h3>
              <span className="text-xxs font-mono text-slate-400 font-bold">Direct Account Settlement</span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              
              {/* Left Column: Settlement Instrument */}
              <div className="space-y-4 p-5 border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50/50 dark:bg-slate-850/10">
                <div>
                  <label className="block text-xxs font-bold text-slate-500 uppercase mb-1.5">Select Payment instrument</label>
                  <div className="relative">
                    <select
                      value={paymentMethod}
                      onChange={(e) => setPaymentMethod(e.target.value as any)}
                      className="appearance-none w-full px-3 py-2 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-300 focus:outline-none"
                    >
                      <option value="Cash">Cash (دفعة نقدية فورية)</option>
                      <option value="Cheque">Cheque Settlement (شيك بنكي مؤجل الدفع)</option>
                      <option value="Credit">Direct Bank Wire Transfer (تحويل مصرفي مباشر)</option>
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={12} />
                  </div>
                </div>

                <div>
                  <label className="block text-xxs font-bold text-slate-500 uppercase mb-1.5">Record Collected Amount (USD)</label>
                  <div className="relative">
                    <DollarSign size={14} className={`absolute ${isRtl ? "right-3" : "left-3"} top-1/2 -translate-y-1/2 text-slate-400`} />
                    <input
                      type="number"
                      min="0"
                      max={currentOutstanding + netPayable}
                      value={amountCollected}
                      onChange={(e) => setAmountCollected(Number(e.target.value))}
                      className={`w-full ${isRtl ? "pr-8 pl-3" : "pl-8 pr-3"} py-1.5 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-white dark:bg-slate-900 text-slate-800 dark:text-white font-mono font-bold`}
                    />
                  </div>
                </div>

                {/* Quick-Pay buttons deck */}
                <div className="space-y-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase block">{t.quickFill}</span>
                  <div className="flex flex-wrap gap-2">
                    <button 
                      onClick={() => setAmountCollected(Math.round(netPayable))}
                      className="px-2.5 py-1 text-xxs font-bold bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-850 rounded hover:bg-slate-50"
                    >
                      Pay New Order (${Math.round(netPayable)})
                    </button>
                    <button 
                      onClick={() => setAmountCollected(currentOutstanding + Math.round(netPayable))}
                      className="px-2.5 py-1 text-xxs font-bold bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400 border border-blue-100 rounded hover:bg-blue-100"
                    >
                      Settle Entire Balance (${currentOutstanding + Math.round(netPayable)})
                    </button>
                    <button 
                      onClick={() => setAmountCollected(prev => prev + 500)}
                      className="px-2.5 py-1 text-xxs font-bold bg-white dark:bg-slate-900 text-slate-700 border border-slate-200 rounded hover:bg-slate-50"
                    >
                      +$500
                    </button>
                    <button 
                      onClick={() => setAmountCollected(0)}
                      className="px-2.5 py-1 text-xxs font-bold bg-rose-50 text-rose-600 dark:bg-rose-950/40 border border-rose-100 rounded hover:bg-rose-100"
                    >
                      Clear / $0
                    </button>
                  </div>
                </div>
              </div>

              {/* Right Column: Ledger review */}
              <div className="p-5 bg-slate-50 dark:bg-slate-950 border border-slate-200/60 dark:border-slate-850/80 rounded-xl space-y-3.5 font-mono text-xs">
                <h4 className="text-[10px] uppercase tracking-wider text-slate-400 font-bold border-b border-slate-100 dark:border-slate-900 pb-2 flex items-center gap-1.5">
                  <FileCheck2 size={13} className="text-blue-500" />
                  <span>{t.ledgerTitle}</span>
                </h4>
                
                <div className="space-y-2.5 text-slate-600 dark:text-slate-300">
                  <div className="flex justify-between">
                    <span>Current Outstanding AR:</span>
                    <span className="text-rose-500 font-bold">${currentOutstanding.toLocaleString()}</span>
                  </div>

                  <div className="flex justify-between">
                    <span>+ Added Net New Order Value:</span>
                    <span>+${netPayable.toLocaleString()}</span>
                  </div>

                  <div className="flex justify-between text-emerald-600 dark:text-emerald-400 font-semibold">
                    <span>- Payment Collected Today:</span>
                    <span>-${amountCollected.toLocaleString()}</span>
                  </div>

                  <div className="flex justify-between border-t border-slate-200 dark:border-slate-800 pt-2.5 font-bold text-slate-900 dark:text-white text-sm">
                    <span>Future Outstanding Balance:</span>
                    <span className="text-blue-600 dark:text-blue-400">${simulatedOutstandingAfter.toLocaleString()}</span>
                  </div>
                </div>
              </div>

            </div>
          </div>
        )}

        {/* STEP 5: STOCK VERIFICATION (UPGRADED WITH REPLENISH QUICK-ACTION LINKAGE) */}
        {step === 5 && (
          <div className="space-y-5 animate-fade-in" id="step-5-stock-audit">
            <div className="flex justify-between items-center border-b border-slate-50 dark:border-slate-800 pb-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5">
                <Warehouse className="w-4 h-4 text-blue-500" />
                <span>{isRtl ? "خطوة ٥: جرد مخزون صيدلية الرف وطلبات الدعم" : "Step 5: Verify Shelf Stock & Draft Urgent Buffer Requests"}</span>
              </h3>
              <span className="text-xxs font-mono text-slate-400 font-bold">Fulfillment Analytics</span>
            </div>

            <div className="p-3 bg-slate-50 dark:bg-slate-950 rounded-lg text-xs text-slate-500">
              {t.auditPrompt}
            </div>

            {/* Audit inputs */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end p-4 bg-slate-50 dark:bg-slate-800/30 rounded-xl border border-slate-100 dark:border-slate-800">
              <div className="md:col-span-2">
                <label className="block text-xxs font-bold text-slate-500 uppercase mb-1">Verify SKU Formulation</label>
                <select
                  value={auditProduct}
                  onChange={(e) => setAuditProduct(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-white dark:bg-slate-900 text-slate-800 dark:text-white outline-none"
                >
                  <option value="">-- Choose Product SKU --</option>
                  {securedProducts.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xxs font-bold text-slate-500 uppercase mb-1">Shelf Stock (Qty)</label>
                <input
                  type="number"
                  min="0"
                  value={auditShelfQty}
                  onChange={(e) => setAuditShelfQty(Number(e.target.value))}
                  className="w-full px-3 py-1.5 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-white dark:bg-slate-900 text-slate-800 dark:text-white font-mono"
                />
              </div>

              <div>
                <label className="block text-xxs font-bold text-slate-500 uppercase mb-1">Urgent Request (Qty)</label>
                <input
                  type="number"
                  min="0"
                  value={urgentRequestQty}
                  onChange={(e) => setUrgentRequestQty(Number(e.target.value))}
                  className="w-full px-3 py-1.5 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-white dark:bg-slate-900 text-slate-800 dark:text-white font-mono"
                />
              </div>
            </div>

            <div className="flex justify-start">
              <button
                onClick={handleAddStockLine}
                disabled={!auditProduct}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Plus size={14} />
                <span>Register Audit Line</span>
              </button>
            </div>

            {/* Audit list display */}
            <div className="border border-slate-100 dark:border-slate-800 rounded-xl overflow-hidden shadow-xs">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 dark:bg-slate-800/50 text-[10px] uppercase font-bold text-slate-500 tracking-wider">
                  <tr>
                    <th className="p-3.5">Product Formulation</th>
                    <th className="p-3.5 text-center">Shelf Stock</th>
                    <th className="p-3.5 text-center">Target Stock</th>
                    <th className="p-3.5 text-center">Urgent Request</th>
                    <th className="p-3.5 text-center">Status</th>
                    <th className="p-3.5 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                  {stockAuditLines.map((line, idx) => {
                    const isLowStock = line.shelfQty <= 5;
                    return (
                      <tr key={idx} className="hover:bg-slate-50/30 dark:hover:bg-slate-850/10">
                        <td className="p-3.5 font-semibold text-slate-900 dark:text-white">{line.productName}</td>
                        <td className="p-3.5 text-center font-mono font-bold text-slate-600 dark:text-slate-400">{line.shelfQty} units</td>
                        <td className="p-3.5 text-center font-mono text-slate-400">{line.targetQty} units</td>
                        <td className="p-3.5 text-center font-mono font-bold text-blue-600 dark:text-blue-400">
                          {line.requestQty > 0 ? `+${line.requestQty} packs` : "None"}
                        </td>
                        <td className="p-3.5 text-center">
                          {isLowStock ? (
                            <span className="px-2.5 py-0.5 rounded bg-rose-50 dark:bg-rose-950/40 text-rose-600 text-[10px] font-bold uppercase tracking-wider font-sans">Low Stock</span>
                          ) : (
                            <span className="px-2.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 text-[10px] font-bold uppercase tracking-wider font-sans">Healthy</span>
                          )}
                        </td>
                        <td className="p-3.5 text-center">
                          <button
                            onClick={() => handleTriggerReplenishment(line.productId, 30)}
                            className="px-2 py-1 bg-blue-50 hover:bg-blue-100 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400 font-bold text-[10px] rounded border border-blue-100 dark:border-blue-900 transition-colors cursor-pointer"
                          >
                            {t.replenishQuickBtn} (+30)
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* STEP 6: OUTCOMES, NOTES & AI ADVISOR */}
        {step === 6 && (
          <div className="space-y-5 animate-fade-in" id="step-6-outcomes">
            <div className="flex justify-between items-center border-b border-slate-50 dark:border-slate-800 pb-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-blue-500" />
                <span>{isRtl ? "خطوة ٦: تدوين مخرجات وملاحظات الزيارة النهائية" : "Step 6: Register Detailing Outcomes & Notes"}</span>
              </h3>
              <span className="text-xxs font-mono text-slate-400 font-bold">Field Insights Synchronization</span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* Left Side: General Forms */}
              <div className="lg:col-span-2 space-y-4">
                
                {/* Pharmacist cooperation rating */}
                <div>
                  <label className="block text-xxs font-bold text-slate-500 uppercase mb-2">{t.cooperationTitle}</label>
                  <div className="grid grid-cols-4 gap-2">
                    {["Excellent", "Friendly", "Busy", "Skeptical"].map((rate) => (
                      <button
                        key={rate}
                        type="button"
                        onClick={() => setPharmacistCooperation(rate as any)}
                        className={`py-2 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${
                          pharmacistCooperation === rate
                            ? "bg-blue-600 border-blue-600 text-white"
                            : "bg-transparent border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50"
                        }`}
                      >
                        {rate}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Checklist of materials disbursed */}
                <div>
                  <label className="block text-xxs font-bold text-slate-500 uppercase mb-2">{t.materialsTitle}</label>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 p-2.5 bg-slate-50 dark:bg-slate-900 rounded-lg cursor-pointer">
                      <input 
                        type="checkbox" 
                        checked={brochuresHanded} 
                        onChange={(e) => setBrochuresHanded(e.target.checked)}
                        className="rounded accent-blue-600"
                      />
                      <span>Brochures</span>
                    </label>
                    <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 p-2.5 bg-slate-50 dark:bg-slate-900 rounded-lg cursor-pointer">
                      <input 
                        type="checkbox" 
                        checked={samplesLeft} 
                        onChange={(e) => setSamplesLeft(e.target.checked)}
                        className="rounded accent-blue-600"
                      />
                      <span>Samples</span>
                    </label>
                    <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 p-2.5 bg-slate-50 dark:bg-slate-900 rounded-lg cursor-pointer">
                      <input 
                        type="checkbox" 
                        checked={counterCardsLeft} 
                        onChange={(e) => setCounterCardsLeft(e.target.checked)}
                        className="rounded accent-blue-600"
                      />
                      <span>Counter Cards</span>
                    </label>
                    <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 p-2.5 bg-slate-50 dark:bg-slate-900 rounded-lg cursor-pointer">
                      <input 
                        type="checkbox" 
                        checked={displayBoxLeft} 
                        onChange={(e) => setDisplayBoxLeft(e.target.checked)}
                        className="rounded accent-blue-600"
                      />
                      <span>Display Stands</span>
                    </label>
                  </div>
                </div>

                <div>
                  <label className="block text-xxs font-bold text-slate-500 uppercase mb-1.5">Competitor Intelligence</label>
                  <textarea
                    value={competitorIntel}
                    onChange={(e) => setCompetitorIntel(e.target.value)}
                    placeholder="Record competitor footprints, promotions, pricing variations..."
                    rows={2}
                    className="w-full px-3.5 py-2 border border-slate-200 dark:border-slate-800 rounded-xl text-xs bg-transparent text-slate-800 dark:text-white outline-none resize-none font-sans"
                  />
                </div>

                <div>
                  <label className="block text-xxs font-bold text-slate-500 uppercase mb-1.5">Visit Summary Notes</label>
                  <textarea
                    value={visitNotes}
                    onChange={(e) => setVisitNotes(e.target.value)}
                    placeholder="Record summary notes, pharmacist special requests, medical support requested..."
                    rows={2}
                    className="w-full px-3.5 py-2 border border-slate-200 dark:border-slate-800 rounded-xl text-xs bg-transparent text-slate-800 dark:text-white outline-none resize-none font-sans"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xxs font-bold text-slate-500 uppercase mb-1.5">Scheduled Next Follow-up Date</label>
                    <div className="relative">
                      <Calendar className={`absolute ${isRtl ? "right-3" : "left-3"} top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none`} size={13} />
                      <input
                        type="date"
                        value={nextFollowUpDate}
                        onChange={(e) => setNextFollowUpDate(e.target.value)}
                        className={`w-full ${isRtl ? "pr-9 pl-3" : "pl-9 pr-3"} py-1.5 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-transparent text-slate-800 dark:text-white font-mono`}
                      />
                    </div>
                  </div>

                  <div className="p-4 bg-blue-50/25 dark:bg-blue-950/20 border border-blue-100/40 dark:border-blue-900/30 rounded-xl text-[10px] text-slate-500 leading-relaxed font-sans">
                    Booking this visit syncs the direct retail orders, recorded financial settlement, shelf stocks audit sheet, and follow-up schedules automatically across regional reporting databases.
                  </div>
                </div>

              </div>

              {/* Right Side: Gemini AI Copilot Card */}
              <div className="lg:col-span-1 bg-white dark:bg-slate-950 border border-slate-200/60 dark:border-slate-800/85 border-t-4 border-t-blue-500 rounded-xl p-5 shadow-sm space-y-4">
                <div className="flex items-center gap-2 border-b border-slate-50 dark:border-slate-900 pb-2">
                  <Sparkles className="text-blue-500" size={16} />
                  <h4 className="text-xs font-extrabold text-slate-800 dark:text-white uppercase tracking-wide">{t.aiAdvisorTitle}</h4>
                </div>

                <p className="text-[11px] text-slate-400">
                  {t.aiAdvisorPrompt}
                </p>

                <button
                  type="button"
                  onClick={handleFetchAiAdvice}
                  disabled={loadingAi}
                  className="w-full py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-lg flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw size={12} className={loadingAi ? "animate-spin" : ""} />
                  <span>{loadingAi ? "Analyzing retail variables..." : "Formulate Detailing Pitch"}</span>
                </button>

                {aiInsightText && (
                  <div className="p-3 bg-blue-50/30 dark:bg-blue-950/30 border border-blue-100/50 dark:border-blue-900/40 rounded-xl text-xs text-slate-700 dark:text-slate-300 leading-relaxed font-sans">
                    {aiInsightText}
                  </div>
                )}
              </div>

            </div>
          </div>
        )}

      </div>

      {/* 4. Wizard Bottom Control Actions Bar */}
      <div className="p-4 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 rounded-xl flex justify-between items-center" id="wizard-nav-controls">
        <button
          onClick={() => setStep(prev => Math.max(1, prev - 1))}
          disabled={step === 1}
          className="px-4 py-2 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold rounded-lg flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-40"
        >
          <ChevronLeft size={14} />
          <span>{t.prevBtn}</span>
        </button>

        {step < totalSteps ? (
          <button
            onClick={() => {
              if (step === 1 && !gpsVerified) {
                alert(isRtl ? "يرجى التحقق من موقع GPS وتأكيد الدخول قبل الانتقال للخطوة التالية!" : "Please verify GPS check-in first to authenticate coordinates!");
                return;
              }
              setStep(prev => Math.min(totalSteps, prev + 1));
            }}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg flex items-center gap-1 transition-colors cursor-pointer"
          >
            <span>{t.nextBtn}</span>
            <ChevronRight size={14} />
          </button>
        ) : (
          <button
            onClick={handleBookVisit}
            className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer"
            id="btn-complete-wizard-booking"
          >
            <Check size={14} />
            <span>{t.commitBtn}</span>
          </button>
        )}
      </div>

    </div>
  );
}
