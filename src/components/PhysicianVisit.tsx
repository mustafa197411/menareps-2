import React, { useState, useEffect, useRef, useMemo } from "react";
import { 
  Check, 
  MapPin, 
  Search, 
  Sparkles, 
  Play, 
  Clock, 
  BookOpen, 
  Plus, 
  ArrowRight, 
  AlertCircle, 
  Package, 
  Smile, 
  Calendar, 
  Tag, 
  MapPinCheck,
  ChevronRight,
  ChevronLeft,
  Eye,
  X,
  Trash2,
  Star,
  Target,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  FileText,
  Send,
  ExternalLink,
  Download
} from "lucide-react";

function formatFileSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
import {
  openDetailingMaterialSession,
  DetailingMaterialUsageSession,
  CloseReason,
  VisitStage
} from "../lib/detailingUsageService";
import { 
  Role, 
  User, 
  Physician, 
  Product, 
  ProductPromotionGroup,
  KeyMessage, 
  PhysicianVisit as PhysicianVisitType,
  PhysicianVisitDetailing,
  CanonicalPrescriptionIntent,
  SampleQuantity,
  AdditionalSampleRequest,
  MarketingRequest,
  UserTerritoryAssignment,
  UserProductAssignment,
  PhysicianVisitCompletionResult
} from "../types";
import type { SampleSku } from "../types";
import { fetchAiInsight } from "../utils/aiService";
import { motion, AnimatePresence } from "motion/react";
import { isPhysicianEligibleForUser } from "../lib/securityEngine";
import {
  diagnoseRepresentativeProductAssignmentSync,
  resolvePhysicianVisitProducts
} from "../lib/productAssignmentService";
import {
  changeDetailingProductState,
  buildKeyMessagePersistenceFields,
  filterKeyMessagesForAuthorizedProducts,
  filterKeyMessagesForProduct,
  filterMaterialsForAuthorizedProducts,
  filterMaterialsForProduct,
  getEligibleProductsForDetailingBlock,
  evaluateDetailingKeyMessageCompletion,
  resolveDetailingEligibility,
  validateDetailingCompletion
} from "../lib/physicianVisitDetailingIntegrity";
import { acquireHardenedGPS, GPSRecord } from "../lib/gpsHardening";
import { establishCustomerLocation } from "../lib/gpsPolicyEngine";
import { collection, onSnapshot } from "firebase/firestore";
import { auth, db } from "../lib/firebase";
import { fetchSampleVisitOptions, type SampleVisitOption } from "../lib/sampleVisitOptionsClient";
import type { ScopedPhysicianVisitSummary } from "../lib/physicianVisitHistoryClient";
import { resolveResourceBinary } from "../lib/resourceBinaryResolver";
import { createPresentationReadyGate } from "../lib/resourcePresentationIntegrity";
import { createResourceVisitContext, discoverVisitResources, fetchActiveResourceHotspots, recordResourceHotspotInteraction } from "../lib/resourceReadClient";
import type { HotspotDefinition } from "../lib/detailingHotspotService";
import { ControlledResourcePage } from "./resources/ControlledResourcePage";

interface PhysicianVisitProps {
  currentUser: User;
  physicians: Physician[];
  products: Product[];
  productPromotionGroups?: ProductPromotionGroup[];
  keyMessages: KeyMessage[];
  lang: "en" | "ar";
  onCompleteVisit: (visit: PhysicianVisitType) => Promise<PhysicianVisitCompletionResult>;
  physicianVisits: PhysicianVisitType[];
  physicianVisitSummaries?: Map<string, ScopedPhysicianVisitSummary>;
  physicianVisitSummaryStatus?: "IDLE" | "LOADING" | "READY" | "ERROR";
  userTerritoryAssignments?: UserTerritoryAssignment[];
  userProductAssignments?: UserProductAssignment[];
  isOperational?: boolean;
  operationalReport?: { status: string; reasons: string[] };
  users?: User[];
}

interface DetailingFormBlock {
  id: string;
  brand: string;
  promotionGroupId: string;
  productId: string;
  selectedMessages: string[]; // key message IDs
  presentedKeyMessageIds: string[]; // legacy mirror of selectedMessages
  selectedMaterials: string[]; // opened/presented canonical material IDs
  reaction: "Positive" | "Neutral" | "Skeptical" | "Negative";
  prescriptionIntent: CanonicalPrescriptionIntent | "";
  notes: string;
  targetBrandsExpanded?: boolean;
  hasPresented?: boolean;
}

export interface SampleFormBlock {
  id: string;
  therapeuticArea: string;
  brand: string;
  productId: string;
  sampleSkuId: string;
  quantity: number;
}

export function buildVisitSamplePayload(
  sampleBlocks: SampleFormBlock[],
  products: Product[],
): SampleQuantity[] {
  return sampleBlocks
    .filter(block => block.productId !== "")
    .map(block => {
      const product = products.find(candidate => candidate.id === block.productId);
      return {
        productId: block.productId,
        sampleSkuId: block.sampleSkuId,
        productName: product?.name || "",
        brand: product?.brand || "",
        quantity: block.quantity,
      };
    });
}

interface MarketingRequestBlock {
  id: string;
  requestType: "Sponsorship" | "Round Table" | "Stand Alone" | "Symposium" | "Flyers" | "Other";
  urgency: "High" | "Medium" | "Low";
  estimatedBudget: number;
  plannedDate: string;
  description: string;
}

export type PhysicianVisitCompletionUiState =
  | { status: "IDLE" }
  | { status: "SAVING" }
  | { status: "ERROR"; message: string }
  | { status: "PENDING_SYNC"; queueItemId: string };

interface CompletionAttemptOptions {
  lock: { current: boolean };
  submit: () => Promise<PhysicianVisitCompletionResult>;
  setState: (state: PhysicianVisitCompletionUiState) => void;
  onCompleted: () => void;
}

export async function runPhysicianVisitCompletionAttempt({
  lock,
  submit,
  setState,
  onCompleted
}: CompletionAttemptOptions): Promise<PhysicianVisitCompletionResult | null> {
  if (lock.current) return null;
  lock.current = true;
  setState({ status: "SAVING" });

  try {
    const result = await submit();
    if (result.status === "PENDING_SYNC") {
      setState({ status: "PENDING_SYNC", queueItemId: result.queueItemId });
      return result;
    }

    onCompleted();
    setState({ status: "IDLE" });
    lock.current = false;
    return result;
  } catch (error: any) {
    setState({
      status: "ERROR",
      message: error?.message || "The visit could not be saved. Your entries have been preserved; please retry."
    });
    lock.current = false;
    throw error;
  }
}

export default function PhysicianVisit({
  currentUser,
  physicians,
  products,
  productPromotionGroups = [],
  keyMessages,
  lang,
  onCompleteVisit,
  physicianVisits,
  physicianVisitSummaries = new Map(),
  physicianVisitSummaryStatus = "IDLE",
  userTerritoryAssignments = [],
  userProductAssignments = [],
  isOperational,
  operationalReport,
  users = []
}: PhysicianVisitProps) {
  const isRtl = lang === "ar";
  const [step, setStep] = useState(1);
  const [selectedPhysician, setSelectedPhysician] = useState<Physician | null>(null);

  const [academicResources, setAcademicResources] = useState<any[]>([]);

  const securedPhysicians = useMemo(() => {
    return (physicians || []).filter(phys => {
      const result = isPhysicianEligibleForUser({
        physician: phys,
        user: currentUser,
        userTerritoryAssignments,
        userProductAssignments,
        products,
        productPromotionGroups,
        allUsers: users,
        representativeOperational: isOperational
      });
      return result.eligible;
    });
  }, [
    physicians,
    currentUser,
    userTerritoryAssignments,
    userProductAssignments,
    products,
    productPromotionGroups,
    users,
    isOperational
  ]);

  const representativeActiveAssignedProducts = useMemo(() => {
    const activeAssignedIds = new Set(
      userProductAssignments
        .filter(assignment =>
          assignment.userId === currentUser.id &&
          assignment.status === "Active" &&
          assignment.active !== false
        )
        .map(assignment => assignment.productId)
    );
    return products.filter(product =>
      activeAssignedIds.has(product.id) &&
      product.isActive !== false &&
      (product as any).active !== false
    );
  }, [currentUser.id, products, userProductAssignments]);

  const physicianVisitProducts = useMemo(() => {
    if (!selectedPhysician) return [];
    return resolvePhysicianVisitProducts({
      physician: selectedPhysician,
      authorizedProducts: representativeActiveAssignedProducts
    });
  }, [selectedPhysician, representativeActiveAssignedProducts]);

  const authorizedVisitProductIds = useMemo(
    () => physicianVisitProducts.map(product => product.id),
    [physicianVisitProducts]
  );

  const securedKeyMessages = useMemo(() => {
    const authorizedMessages = filterKeyMessagesForAuthorizedProducts(keyMessages, authorizedVisitProductIds);

    return authorizedMessages.filter(msg => {
      if (msg.isApproved === false) return false;
      if ((msg as any).isDeleted) return false;

      // Enforce Physician Specialty Check
      if (selectedPhysician) {
        const specIds = msg.targetSpecialtyIds || [];
        const specNames = msg.targetSpecialtyNames || [];
        // If there's an explicit specialty restriction
        if (specIds.length > 0 || specNames.length > 0) {
          const physSpecialty = (selectedPhysician.specialty || "").trim().toUpperCase();
          if (!physSpecialty) return false; // Physician has no specialty, but message requires one

          // Check if matches specialty ID, or specialty name
          const matchId = specIds.some(id => id.trim().toUpperCase() === physSpecialty);
          const matchName = specNames.some(name => {
            const normalizedMsgSpec = name.trim().toUpperCase();
            if (normalizedMsgSpec === physSpecialty) return true;
            // Also check common equivalents (e.g. Cardiologist vs Cardiology, Pediatrician vs Pediatrics)
            if (normalizedMsgSpec.startsWith("CARDIO") && physSpecialty.startsWith("CARDIO")) return true;
            if (normalizedMsgSpec.startsWith("PEDIAT") && physSpecialty.startsWith("PEDIAT")) return true;
            if (normalizedMsgSpec.startsWith("DERMAT") && physSpecialty.startsWith("DERMAT")) return true;
            if (normalizedMsgSpec.startsWith("GYNEC") && physSpecialty.startsWith("GYNEC")) return true;
            if (normalizedMsgSpec.startsWith("OB-GYN") && physSpecialty.startsWith("OB-GYN")) return true;
            if (normalizedMsgSpec.startsWith("INTERNAL") && physSpecialty.startsWith("INTERNAL")) return true;
            return false;
          });

          if (!matchId && !matchName) return false;
        }
      }

      return true;
    });
  }, [authorizedVisitProductIds, keyMessages, selectedPhysician]);

  const authorizedVisitAcademicResources = useMemo(
    () => filterMaterialsForAuthorizedProducts(academicResources, authorizedVisitProductIds, physicianVisitProducts),
    [academicResources, authorizedVisitProductIds, physicianVisitProducts]
  );

  const representativeAssignmentDiagnostic = useMemo(() => {
    const activeUserProductAssignmentIds = userProductAssignments
      .filter(assignment =>
        assignment.userId === currentUser.id &&
        assignment.status === "Active" &&
        assignment.active !== false
      )
      .map(assignment => assignment.productId);
    return diagnoseRepresentativeProductAssignmentSync({
      userProfileProductIds: currentUser.products || [],
      activeUserProductAssignmentIds
    });
  }, [currentUser.id, currentUser.products, userProductAssignments]);

  useEffect(() => {
    if (!selectedPhysician) return;
    const relevantProductIds = new Set(selectedPhysician.alignedProductIds || []);
    products
      .filter(product => relevantProductIds.has(product.id))
      .forEach(product => console.info("[WP710J_E_PRODUCT_MASTER_TRACE_JSON]", JSON.stringify({
        productId: product.id,
        productName: product.name || null,
        sku: product.sku || null,
        promotionGroupId: product.promotionGroupId || null,
        active: product.isActive !== false && (product as any).active !== false
      })));
  }, [products, selectedPhysician]);

  useEffect(() => {
    console.info("[WP710J_E_REP_ASSIGNMENT_TRACE_JSON]", JSON.stringify({
      representativeUid: currentUser.id,
      userProfileProductIds: representativeAssignmentDiagnostic.userProfileProductIds,
      activeUserProductAssignmentIds: representativeAssignmentDiagnostic.activeUserProductAssignmentIds,
      primaryPromotionGroupId: currentUser.primaryPromotionGroupId || null,
      targetPromotionGroupIds: currentUser.targetPromotionGroupIds || [],
      assignmentSyncStatus: currentUser.assignmentSyncStatus || null,
      missingActiveAssignmentIds: representativeAssignmentDiagnostic.missingActiveAssignmentIds,
      activeAssignmentIdsMissingFromProfile: representativeAssignmentDiagnostic.activeAssignmentIdsMissingFromProfile,
      synchronized: representativeAssignmentDiagnostic.synchronized
    }));
  }, [currentUser, representativeAssignmentDiagnostic]);

  useEffect(() => {
    console.info("[WP710F_VISIT_AUTHORIZATION_JSON]", JSON.stringify({
      representativeUid: currentUser.id,
      physicianId: selectedPhysician?.id || null,
      physicianAlignedProductIds: selectedPhysician?.alignedProductIds || [],
      representativeActiveProductIds: representativeActiveAssignedProducts.map(product => product.id),
      allowedVisitProductIds: physicianVisitProducts.map(product => product.id)
    }));
  }, [currentUser.id, selectedPhysician, representativeActiveAssignedProducts, physicianVisitProducts]);

  // Canonical promotion-group IDs with display labels kept presentation-only.
  const assignedPromotionGroups = useMemo(() => {
    if (!selectedPhysician) return [];
    const groupIds = [
      selectedPhysician.primaryPromotionGroupId,
      ...(selectedPhysician.targetPromotionGroupIds || [])
    ].filter((id): id is string => Boolean(id));

    return Array.from(new Set(groupIds)).map(id => ({
      id,
      name: productPromotionGroups.find(group => group.id === id)?.name || id
    }));
  }, [selectedPhysician, productPromotionGroups]);

  // Authoritative all-time history summary; the general visit feed is intentionally bounded.
  const lastVisit = useMemo(() => {
    if (!selectedPhysician) return null;
    return physicianVisitSummaries.get(selectedPhysician.id)?.lastVisit || null;
  }, [selectedPhysician, physicianVisitSummaries]);

  const scopedLastVisitLabel = (physicianId: string): string => {
    if (physicianVisitSummaryStatus !== "READY") return physicianVisitSummaryStatus === "ERROR" ? "Unavailable" : "Loading…";
    return physicianVisitSummaries.get(physicianId)?.lastVisit?.visitDate || t.neverVisited;
  };

  // Step 1 States: Search & Plan
  const [draftVisitId, setDraftVisitId] = useState<string>("");
  const [resourceVisitContextId, setResourceVisitContextId] = useState("");
  const [resourceContextLoading, setResourceContextLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [completionState, setCompletionState] = useState<PhysicianVisitCompletionUiState>({ status: "IDLE" });
  const submissionLockRef = useRef(false);
  const visitStartedAtRef = useRef<string | null>(null);

  useEffect(() => {
    if (selectedPhysician && !draftVisitId) {
      setDraftVisitId(`DRAFT-VIS-${selectedPhysician.id}-${Date.now()}`);
    } else if (!selectedPhysician && draftVisitId) {
      setDraftVisitId("");
    }
  }, [selectedPhysician, draftVisitId]);

  const [searchTerm, setSearchTerm] = useState("");
  const [searchSpecialty, setSearchSpecialty] = useState("");
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsVerified, setGpsVerified] = useState(false);
  const [gpsCoords, setGpsCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsRecord, setGpsRecord] = useState<GPSRecord | null>(null);
  const [aiPlanSuggestion, setAiPlanSuggestion] = useState("");
  const [loadingAiPlan, setLoadingAiPlan] = useState(false);

  const selectPhysicianWithGpsCheck = (p: Physician) => {
    setSelectedPhysician(p);
    const isVerified = Boolean(
      p.gpsVerified === true ||
      p.gpsVerificationStatus === "VERIFIED"
    );
    if (isVerified) {
      setGpsVerified(true);
      setGpsCoords({ lat: Number(p.latitude), lng: Number(p.longitude) });
    } else {
      setGpsVerified(false);
      setGpsCoords(null);
    }
    handleGetAiAdvice(p);
  };

  // Timer States
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Step 2 States: Detailing Blocks Form
  const [detailingBlocks, setDetailingBlocks] = useState<DetailingFormBlock[]>([]);
  const [activeBrochure, setActiveBrochure] = useState<ActiveBrochureState | null>(null);

  // Step 3 States: Samples Given Blocks Form
  const [sampleBlocks, setSampleBlocks] = useState<SampleFormBlock[]>([]);
  const [sampleOptions, setSampleOptions] = useState<SampleVisitOption[]>([]);
  const [sampleOptionsError, setSampleOptionsError] = useState("");
  const [requestSampleSkus, setRequestSampleSkus] = useState<SampleSku[]>([]);

  useEffect(() => onSnapshot(collection(db, "sampleCatalog"), snapshot => setRequestSampleSkus(snapshot.docs.map(item => ({ id: item.id, ...item.data() } as SampleSku)).filter(item => item.active && item.status === "ACTIVE"))), []);

  useEffect(() => {
    if (!selectedPhysician?.id || !auth.currentUser) { setSampleOptions([]); setSampleOptionsError(""); return; }
    let cancelled = false;
    void fetchSampleVisitOptions(auth.currentUser, selectedPhysician.id).then(options => { if (!cancelled) { setSampleOptions(options); setSampleOptionsError(""); } }).catch(error => { if (!cancelled) { setSampleOptions([]); setSampleOptionsError(error instanceof Error ? error.message : "SAMPLE_OPTIONS_LOAD_FAILED"); } });
    return () => { cancelled = true; };
  }, [selectedPhysician?.id]);
  
  // Additional Sample Requests Accordion States
  const [isAdditionalSamplesOpen, setIsAdditionalSamplesOpen] = useState(false);
  const [addSampleReqName, setAddSampleReqName] = useState("");
  const [addSampleReqQty, setAddSampleReqQty] = useState(1);
  const [addSampleReqDate, setAddSampleReqDate] = useState("");
  const [addSampleReqReason, setAddSampleReqReason] = useState("");
  const [additionalRequests, setAdditionalRequests] = useState<AdditionalSampleRequest[]>([]);

  // Step 4 States: Outcomes
  const [generalNotes, setGeneralNotes] = useState("");
  const [additionalNotes, setAdditionalNotes] = useState("");
  
  // Marketing Requests Dynamic List
  const [marketingRequests, setMarketingRequests] = useState<MarketingRequestBlock[]>([]);

  // Follow Up States
  const [followUpRequired, setFollowUpRequired] = useState(false);
  const [followUpDate, setFollowUpDate] = useState("");
  const [followUpNotes, setFollowUpNotes] = useState("");

  // Localization labels
  const t = {
    en: {
      physicianVisit: "Physician Visit",
      startNewVisit: "Start a new physician visit",
      visitInProgress: "Visit in progress",
      selectPhysician: "Select Physician",
      detailing: "Detailing",
      samples: "Samples",
      outcomes: "Outcomes",
      plannedToday: "Today's Planned Visits",
      unplannedVisit: "Unplanned Visit",
      noPlannedToday: "No planned visits for today",
      aiSuggestions: "AI Suggestions",
      searchPhysicians: "Search Physicians",
      searchPlaceholder: "Search by name, specialty...",
      specialtyAll: "All Specialties",
      badgeClass: "Class",
      lastVisit: "Last Visit",
      neverVisited: "never visited",
      verifyGps: "Verify Field GPS Lock",
      gpsOk: "Location verified successfully!",
      gpsLoading: "Contacting orbit coordinates...",
      gpsLocked: "Location verified",
      startVisit: "Start Visit",
      aiPlanningTitle: "AI Suggestions",
      aiLoading: "Consulting database...",
      getAiAdvice: "Generate Dr. Advice",
      timer: "Visit Live Timer",
      primaryBrand: "Primary Brand",
      targetBrands: "Target Brands",
      selectProduct: "Products",
      keyPromoMessages: "Key Promotional Messages",
      brochureView: "Active Detailing Visual Aid",
      viewBrochure: "View Brochure",
      reaction: "Physician Reaction",
      notes: "Notes",
      addDetailing: "+ Add Product Detailing",
      nextSamples: "Next: Samples",
      sampleSelection: "Samples Given",
      qty: "Quantity",
      addSample: "+ Add Sample",
      extraSamplesTitle: "Request Additional Samples",
      extraSamplesSubtitle: "Don't have the samples you need? Request them here for manager approval.",
      sampleNeededName: "Sample",
      expectedDate: "Expected Delivery Date for Physician",
      reason: "Reason for Request",
      submitExtra: "Submit Request",
      nextOutcomes: "Next: Outcomes",
      visitOutcomes: "Visit Outcomes",
      prescriptionIntentLabel: "Prescription Intent",
      generalNotesLabel: "Visit Notes",
      marketingEventTitle: "Marketing Requests",
      marketingEventSubtitle: "Request promotional materials, congress invitations, or other marketing support for this physician.",
      addRequest: "+ Add Request",
      reqType: "Request Type",
      urgency: "Urgency",
      estBudget: "Estimated Budget",
      eventDate: "Planned Date",
      eventDesc: "Description",
      followUp: "Follow-up Required",
      completeVisit: "Complete Visit",
      addedDetailing: "Logged Detailing Products",
      addedSamples: "Allocated Samples",
      noDetailingAdded: "Please add and detail at least 1 product.",
      gpsFailure: "Please verify GPS location alignment before starting visit."
    },
    ar: {
      physicianVisit: "زيارة الطبيب",
      startNewVisit: "بدء زيارة طبيب جديدة",
      visitInProgress: "الزيارة قيد التنفيذ",
      selectPhysician: "اختيار الطبيب",
      detailing: "التفصيل",
      samples: "العينات",
      outcomes: "النتائج",
      plannedToday: "زيارات اليوم المخططة",
      unplannedVisit: "زيارة غير مخططة",
      noPlannedToday: "لا توجد زيارات مخططة اليوم",
      aiSuggestions: "اقتراحات الذكاء الاصطناعي",
      searchPhysicians: "البحث عن الأطباء",
      searchPlaceholder: "البحث بالاسم، التخصص...",
      specialtyAll: "جميع التخصصات",
      badgeClass: "الفئة",
      lastVisit: "آخر زيارة",
      neverVisited: "لم يزر بعد",
      verifyGps: "التحقق من إحداثيات GPS الميدانية",
      gpsOk: "تم التحقق من الموقع بنجاح!",
      gpsLoading: "جاري الاتصال بالأقمار الاصطناعية...",
      gpsLocked: "تم التحقق من الموقع الجغرافي",
      startVisit: "بدء الزيارة",
      aiPlanningTitle: "اقتراحات الذكاء الاصطناعي",
      aiLoading: "جاري استشارة قاعدة البيانات...",
      getAiAdvice: "توليد نصائح الطبيب",
      timer: "مؤقت الزيارة المباشر",
      primaryBrand: "العلامة التجارية الرئيسية",
      targetBrands: "العلامات المستهدفة",
      selectProduct: "المنتجات",
      keyPromoMessages: "الرسائل الترويجية الأساسية",
      brochureView: "المحتوى المرئي النشط للتفصيل",
      viewBrochure: "عرض الكتيب",
      reaction: "تفاعل الطبيب",
      notes: "الملاحظات",
      addDetailing: "+ إضافة تفصيل منتج",
      nextSamples: "التالي: العينات",
      sampleSelection: "العينات المقدمة",
      qty: "الكمية",
      addSample: "+ إضافة عينة",
      extraSamplesTitle: "طلب عينات إضافية",
      extraSamplesSubtitle: "ألا تملك العينات التي تحتاجها؟ اطلبها من هنا للحصول على موافقة المدير.",
      sampleNeededName: "العينة",
      expectedDate: "تاريخ التسليم المتوقع للطبيب",
      reason: "سبب الطلب",
      submitExtra: "تقديم الطلب",
      nextOutcomes: "التالي: المخرجات",
      visitOutcomes: "مخرجات الزيارة",
      prescriptionIntentLabel: "نية كتابة الوصفة",
      generalNotesLabel: "ملاحظات الزيارة",
      marketingEventTitle: "طلبات التسويق",
      marketingEventSubtitle: "اطلب المواد الترويجية، دعوات المؤتمرات، أو أي دعم تسويقي آخر لهذا الطبيب.",
      addRequest: "+ إضافة طلب",
      reqType: "نوع الطلب",
      urgency: "مستوى الاستعجال",
      estBudget: "الميزانية التقديرية",
      eventDate: "التاريخ المخطط",
      eventDesc: "الوصف",
      followUp: "متابعة مطلوبة",
      completeVisit: "إكمال الزيارة",
      addedDetailing: "المنتجات التي تم تفصيلها",
      addedSamples: "العينات المصروفة",
      noDetailingAdded: "يرجى إضافة وتفصيل منتج واحد على الأقل.",
      gpsFailure: "يرجى التحقق من إحداثيات الموقع الجغرافي GPS قبل بدء الزيارة."
    }
  }[lang];

  // Fetch GPS Coordinates using real Geolocation API via centralized GPS Policy Engine
  const handleVerifyGps = async () => {
    setGpsLoading(true);
    try {
      if (selectedPhysician) {
        const result = await establishCustomerLocation(selectedPhysician, currentUser, {
          accuracyMode: "WARNING_ONLY"
        });
        setGpsCoords({ lat: result.latitude, lng: result.longitude });
        if (result.rawGpsRecord) {
          setGpsRecord(result.rawGpsRecord);
        }
        setGpsVerified(true);
      } else {
        const record = await acquireHardenedGPS(currentUser, "Physician Visit");
        setGpsCoords({ lat: record.latitude, lng: record.longitude });
        setGpsRecord(record);
        setGpsVerified(true);
      }
    } catch (err: any) {
      alert(isRtl 
        ? `فشل تحديد موقعك الجغرافي: ${err.message || err}` 
        : `Failed to verify your GPS location: ${err.message || err}`);
    } finally {
      setGpsLoading(false);
    }
  };

  // Fetch Intelligent AI Advice for Detailing the selected physician
  const handleGetAiAdvice = async (physician: Physician) => {
    setLoadingAiPlan(true);
    try {
      const insight = await fetchAiInsight("nba", {
        physicianName: physician.name,
        specialty: physician.specialty,
        classification: physician.classification,
        region: physician.region,
        productIds: authorizedVisitProductIds,
        promotionGroupIds: [...new Set(physicianVisitProducts.map(product => product.promotionGroupId).filter(Boolean))]
      }, currentUser);
      setAiPlanSuggestion(insight);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingAiPlan(false);
    }
  };

  // Timer tick for Detailing Stopwatch
  useEffect(() => {
    if (isTimerRunning) {
      timerIntervalRef.current = setInterval(() => {
        setTimerSeconds(prev => prev + 1);
      }, 1000);
    } else {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    }
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, [isTimerRunning]);

  const handleStartVisit = async () => {
    if (!gpsVerified) {
      alert(t.gpsFailure);
      return;
    }
    if (!selectedPhysician) return;
    setResourceContextLoading(true);
    try {
      const visitDate = new Date().toISOString().slice(0, 10);
      const context = await createResourceVisitContext({ physicianId: selectedPhysician.id, visitDate });
      const discovery = await discoverVisitResources(context.contextId);
      setDraftVisitId(context.visitId);
      setResourceVisitContextId(context.contextId);
      setAcademicResources(Object.values(discovery.resourcesByProduct).flat().map(resource => ({ ...resource, readContext: { purpose: "PHYSICIAN_VISIT", contextId: context.contextId } })));
    } catch (error) {
      console.error("Trusted visit Resource context failed:", error);
      alert(isRtl ? "تعذر بدء سياق المواد المعتمد لهذه الزيارة." : "Unable to establish an authorized material context for this visit.");
      setResourceContextLoading(false);
      return;
    }
    setResourceContextLoading(false);
    setStep(2);
    visitStartedAtRef.current = new Date().toISOString();
    setTimerSeconds(0);
    setIsTimerRunning(true);

    // Initialize first detailing block
    const initialGroup = assignedPromotionGroups.find(group => group.id === selectedPhysician?.primaryPromotionGroupId);
    setDetailingBlocks([
      {
        id: `det-block-${Date.now()}`,
        brand: initialGroup?.name || "",
        promotionGroupId: initialGroup?.id || "",
        productId: "",
        sampleSkuId: "",
        selectedMessages: [],
        presentedKeyMessageIds: [],
        selectedMaterials: [],
        reaction: "Neutral",
        prescriptionIntent: "",
        notes: ""
      }
    ]);
  };

  // Log detailing for a product
  const handleAddDetailingBlock = () => {
    if (!selectedPhysician || detailingBlocks.some(block => !block.productId)) return;
    const remaining = getEligibleProductsForDetailingBlock({
      products,
      physicianAlignedProductIds: selectedPhysician.alignedProductIds || [],
      representativeActiveProductIds: representativeActiveAssignedProducts.map(product => product.id),
      primaryPromotionGroupId: selectedPhysician.primaryPromotionGroupId,
      targetPromotionGroupIds: selectedPhysician.targetPromotionGroupIds || [],
      selections: detailingBlocks,
      blockIndex: detailingBlocks.length
    });
    if (remaining.length === 0) return;
    setDetailingBlocks([
      ...detailingBlocks,
      {
        id: `det-block-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        brand: "",
        promotionGroupId: "",
        productId: "",
        selectedMessages: [],
        presentedKeyMessageIds: [],
        selectedMaterials: [],
        reaction: "Neutral",
        prescriptionIntent: "",
        notes: ""
      }
    ]);
  };

  const handleRemoveDetailingBlock = (id: string) => {
    setDetailingBlocks(currentBlocks => currentBlocks.filter(b => b.id !== id));
  };

  const handleUpdateDetailingBlock = (id: string, updates: Partial<DetailingFormBlock>) => {
    setDetailingBlocks(currentBlocks => currentBlocks.map(b => b.id === id ? { ...b, ...updates } : b));
  };

  const handleSelectDetailingGroup = (
    block: DetailingFormBlock,
    blockIndex: number,
    promotionGroupId: string,
    promotionGroupName: string
  ) => {
    console.info("[WP710J_GROUP_SELECTION_JSON]", JSON.stringify({
      visitId: draftVisitId,
      detailingBlockIndex: blockIndex,
      selectedPromotionGroupId: promotionGroupId || null,
      previousPromotionGroupId: block.promotionGroupId || null
    }));
    handleUpdateDetailingBlock(block.id, {
      brand: promotionGroupName,
      promotionGroupId,
      productId: "",
      selectedMessages: [],
      presentedKeyMessageIds: [],
      selectedMaterials: [],
      hasPresented: false
    });
  };

  const handleSelectDetailingProduct = (block: DetailingFormBlock, blockIndex: number, product: Product) => {
    const duplicateDetected = detailingBlocks.some((item, index) => index !== blockIndex && item.productId === product.id);
    const authorizationValid = physicianVisitProducts.some(item => item.id === product.id);
    const eligiblePrimaryExists = physicianVisitProducts.some(item => item.promotionGroupId === selectedPhysician?.primaryPromotionGroupId);
    const primaryFirstValid = blockIndex !== 0 || !eligiblePrimaryExists || product.promotionGroupId === selectedPhysician?.primaryPromotionGroupId;
    console.info("[WP710J_PRODUCT_SELECTION_JSON]", JSON.stringify({
      visitId: draftVisitId,
      detailingBlockIndex: blockIndex,
      selectedProductId: product.id,
      selectedProductPromotionGroupId: product.promotionGroupId || null,
      duplicateDetected,
      primaryFirstValid,
      authorizationValid
    }));
    if (!authorizationValid || duplicateDetected || !primaryFirstValid) return;
    const nextBlock = changeDetailingProductState(block, product.id);
    handleUpdateDetailingBlock(block.id, nextBlock);
  };

  const recordPresentedMaterial = (blockId: string, materialId: string) => {
    setDetailingBlocks(currentBlocks => currentBlocks.map(block => block.id === blockId ? {
      ...block,
      hasPresented: true,
      selectedMaterials: [...new Set([...block.selectedMaterials, materialId])]
    } : block));
  };

  useEffect(() => {
    if (!selectedPhysician) return;
    detailingBlocks.forEach((block, detailingBlockIndex) => {
      const eligible = getEligibleProductsForDetailingBlock({
        products,
        physicianAlignedProductIds: selectedPhysician.alignedProductIds || [],
        representativeActiveProductIds: representativeActiveAssignedProducts.map(product => product.id),
        primaryPromotionGroupId: selectedPhysician.primaryPromotionGroupId,
        targetPromotionGroupIds: selectedPhysician.targetPromotionGroupIds || [],
        selections: detailingBlocks,
        blockIndex: detailingBlockIndex
      });
      console.info("[WP710I_DETAILING_ELIGIBILITY_JSON]", JSON.stringify({
        visitId: draftVisitId,
        physicianId: selectedPhysician.id,
        representativeId: currentUser.id,
        physicianPrimaryPromotionGroupId: selectedPhysician.primaryPromotionGroupId || null,
        physicianTargetPromotionGroupIds: selectedPhysician.targetPromotionGroupIds || [],
        physicianAlignedProductIds: selectedPhysician.alignedProductIds || [],
        representativeActiveProductIds: representativeActiveAssignedProducts.map(product => product.id),
        allowedVisitProductIds: physicianVisitProducts.map(product => product.id),
        alreadySelectedProductIds: detailingBlocks.map(item => item.productId).filter(Boolean),
        eligibleProductIdsForBlock: eligible.map(product => product.id),
        detailingBlockIndex
      }));
      const availableKeyMessageIds = filterKeyMessagesForProduct(securedKeyMessages, block.productId).map(message => message.id);
      console.info("[WP710I_KEY_MESSAGES_JSON]", JSON.stringify({
        visitId: draftVisitId, productId: block.productId || null,
        availableKeyMessageIds, selectedKeyMessageIds: block.selectedMessages
      }));
      const selectedProduct = products.find(product => product.id === block.productId);
      const availableMaterialIds = filterMaterialsForProduct(authorizedVisitAcademicResources, { productId: block.productId, productPromotionGroupId: selectedProduct?.promotionGroupId, physicianSpecialtyId: selectedPhysician?.specialtyId })
        .map(resource => resource.resourceId || resource.id).filter(Boolean);
      console.info("[WP710I_DETAILING_MATERIALS_JSON]", JSON.stringify({
        visitId: draftVisitId, productId: block.productId || null,
        availableMaterialIds, selectedOrViewedMaterialIds: block.selectedMaterials
      }));
    });
  }, [authorizedVisitAcademicResources, currentUser.id, detailingBlocks, draftVisitId, physicianVisitProducts, products, representativeActiveAssignedProducts, securedKeyMessages, selectedPhysician]);

  // Sample allocation triggers
  const handleAddSampleBlock = () => {
    setSampleBlocks([
      ...sampleBlocks,
      {
        id: `sample-block-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        therapeuticArea: "All Areas",
        brand: "All Brands",
        productId: "",
        quantity: 1
      }
    ]);
  };

  const handleRemoveSampleBlock = (id: string) => {
    setSampleBlocks(sampleBlocks.filter(b => b.id !== id));
  };

  const handleUpdateSampleBlock = (id: string, updates: Partial<SampleFormBlock>) => {
    setSampleBlocks(sampleBlocks.map(b => b.id === id ? { ...b, ...updates } : b));
  };

  // Additional sample requests submitting
  const handleAddExtraSampleRequest = () => {
    if (!addSampleReqName || !addSampleReqQty || !addSampleReqDate) return;
    const sampleSku = requestSampleSkus.find(item => item.id === addSampleReqName);
    const product = physicianVisitProducts.find(item => item.id === sampleSku?.productId);
    if (!sampleSku || !product || !addSampleReqReason.trim()) return;
    const newReq: AdditionalSampleRequest = {
      intentKey: crypto.randomUUID(),
      sampleSkuId: sampleSku.id,
      productId: sampleSku.productId,
      sampleVariantName: sampleSku.name,
      productName: product.name,
      quantityNeeded: addSampleReqQty,
      expectedDeliveryDate: addSampleReqDate,
      reason: addSampleReqReason,
      urgent: false,
      status: "PENDING_APPROVAL"
    };
    setAdditionalRequests([...additionalRequests, newReq]);
    
    // Clear and close
    setAddSampleReqName("");
    setAddSampleReqQty(1);
    setAddSampleReqDate("");
    setAddSampleReqReason("");
    setIsAdditionalSamplesOpen(false);
  };

  // Marketing Requests handlers
  const handleAddMarketingRequest = () => {
    setMarketingRequests([
      ...marketingRequests,
      {
        id: `mr-block-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        requestType: "Sponsorship",
        urgency: "Medium",
        estimatedBudget: 0,
        plannedDate: "",
        description: ""
      }
    ]);
  };

  const handleRemoveMarketingRequest = (id: string) => {
    setMarketingRequests(marketingRequests.filter(b => b.id !== id));
  };

  const handleUpdateMarketingRequest = (id: string, updates: Partial<MarketingRequestBlock>) => {
    setMarketingRequests(marketingRequests.map(b => b.id === id ? { ...b, ...updates } : b));
  };

  // Proceed navigation helpers
  const handleNextToSamples = () => {
    const validBlocks = detailingBlocks.filter(b => b.productId !== "");
    if (validBlocks.length === 0) {
      alert(t.noDetailingAdded);
      return;
    }

    // Key messages are optional; normalize the legacy presentation mirror for diagnostics.
    validBlocks.forEach(block => {
      const detailingBlockIndex = detailingBlocks.findIndex(item => item.id === block.id);
      const availableKeyMessageIds = filterKeyMessagesForProduct(securedKeyMessages, block.productId)
        .map(message => message.id);
      const gate = evaluateDetailingKeyMessageCompletion({
        availableKeyMessageIds,
        selectedKeyMessageIds: block.selectedMessages,
        presentedKeyMessageIds: block.presentedKeyMessageIds
      });
      console.info("[WP710M_KEY_MESSAGE_GATE_JSON]", JSON.stringify({
        visitId: draftVisitId,
        physicianId: selectedPhysician?.id || null,
        productId: block.productId,
        detailingBlockIndex,
        availableKeyMessageIds,
        selectedKeyMessageIds: block.selectedMessages,
        presentedKeyMessageIds: gate.presentedKeyMessageIds,
        requiredKeyMessageIds: gate.requiredKeyMessageIds,
        hasPresented: gate.hasPresented,
        presentationComplete: gate.presentationComplete,
        gatePass: gate.gatePass,
        gateFailureReason: gate.gateFailureReason
      }));
    });
    setStep(3);
    // Initialize sample blocks if empty
    if (sampleBlocks.length === 0) {
      setSampleBlocks([
        {
          id: `sample-block-${Date.now()}`,
          therapeuticArea: "All Areas",
          brand: "All Brands",
          productId: "",
          sampleSkuId: "",
          quantity: 1
        }
      ]);
    }
  };

  const handleNextToOutcomes = () => {
    // 2. Enforce Sample Security check (Phase N) - alignment and allocated stock validation
    for (const block of sampleBlocks) {
      if (block.productId) {
        const product = physicianVisitProducts.find(p => p.id === block.productId);
        if (!product) {
          alert(
            lang === "ar"
              ? "لا يمكنك صرف عينات لمنتجات غير متوائمة مع نطاق عملك المعتمد."
              : "Security Violation: You cannot disburse samples for products you are not aligned with."
          );
          return;
        }

        const option = sampleOptions.find(item => item.sampleSkuId === block.sampleSkuId && item.productId === block.productId);
        if (!option) {
          alert(lang === "ar" ? "يرجى تحديد وحدة عينة مخصصة وصالحة." : "Select an explicitly allocated, distributable sample SKU.");
          return;
        }
        if (block.quantity <= 0 || block.quantity > 3) {
          alert(
            lang === "ar"
              ? "يرجى تحديد كمية عينات صالحة (أكبر من صفر)."
              : "Please enter a valid quantity of samples."
          );
          return;
        }

        if (block.quantity > option.availableQuantity) {
          alert(
            lang === "ar"
              ? `الكمية المطلوبة من ${product.name} (${block.quantity} وحدة) تتجاوز مخزون العينات المخصص والقابل للتوزيع (${option.availableQuantity} وحدة).`
              : `Insufficient allocated sample stock: ${block.quantity} requested, ${option.availableQuantity} distributable units available.`
          );
          return;
        }
      }
    }

    setStep(4);
  };

  // Complete Visit submission
  const handleCompleteVisit = async () => {
    const canonicalPhysicianAreaId = selectedPhysician?.areaId?.trim();
    if (!canonicalPhysicianAreaId) {
      alert(lang === "ar" ? "لا يمكن إكمال الزيارة: منطقة الطبيب الأساسية غير مكوّنة." : "Visit cannot be completed: the physician's canonical Area is not configured.");
      return;
    }
    if (detailingBlocks.some(block => !block.prescriptionIntent)) {
      alert(lang === "ar" ? "حدد نية وصف مستقلة لكل منتج تم تفصيله." : "Select an independent Prescription Intent for every detailed Product.");
      return;
    }
    const allowedVisitProductIds = physicianVisitProducts.map(product => product.id);
    const completionValidation = validateDetailingCompletion({
      selectedProductIds: detailingBlocks.map(block => block.productId),
      allowedVisitProductIds,
      products,
      primaryPromotionGroupId: selectedPhysician?.primaryPromotionGroupId
    });
    console.info("[WP710I_COMPLETION_PRODUCT_VALIDATION_JSON]", JSON.stringify({
      visitId: draftVisitId,
      ...completionValidation
    }));
    if (completionValidation.validationResult === "FAIL") {
      const reason = completionValidation.duplicateProductIds.length
        ? `Duplicate product detailing is not allowed: ${completionValidation.duplicateProductIds.join(", ")}`
        : completionValidation.unauthorizedProductIds.length
          ? `Security Violation: detailed Product IDs are outside this visit's canonical authorization: ${completionValidation.unauthorizedProductIds.join(", ")}`
          : "Product Detailing #1 must use an eligible product from the physician's Primary Promotion Group.";
      alert(reason);
      return;
    }
    if (completionValidation.primaryFirstValidation === "LEGACY_NO_PRIMARY_GROUP") {
      console.warn("[WP710I_PRIMARY_GROUP_COMPATIBILITY]", JSON.stringify({
        visitId: draftVisitId,
        physicianId: selectedPhysician?.id,
        reason: "LEGACY_NO_PRIMARY_PROMOTION_GROUP_ID"
      }));
    }

    const finalDetailings: PhysicianVisitDetailing[] = detailingBlocks
      .filter(b => b.productId !== "")
      .map(b => {
        const prod = physicianVisitProducts.find(p => p.id === b.productId);
        const keyMessageFields = buildKeyMessagePersistenceFields(
          filterKeyMessagesForProduct(securedKeyMessages, b.productId).map(message => message.id),
          b.selectedMessages
        );
        return {
          productId: b.productId,
          sampleSkuId: b.sampleSkuId,
          sampleSkuName: sampleOptions.find(option => option.sampleSkuId === b.sampleSkuId)?.name || "",
          brandName: prod?.brand || b.brand,
          reaction: b.reaction,
          notes: b.notes,
          productNotes: b.notes,
          ...keyMessageFields,
          presentedResources: b.selectedMaterials,
          materialIds: b.selectedMaterials,
          prescriptionIntent: b.prescriptionIntent as CanonicalPrescriptionIntent,
          detailingOrder: detailingBlocks.findIndex(block => block.id === b.id) + 1
        };
      });

    if (finalDetailings.length === 0) {
      alert(t.noDetailingAdded);
      return;
    }

    // Defensive canonical-ID validation against the physician/representative intersection.
    for (const d of finalDetailings) {
      const isAligned = allowedVisitProductIds.includes(d.productId);
      if (!isAligned) {
        alert(
          lang === "ar"
            ? `انتهاك أمني: لا يمكنك تقديم تفصيل لمنتج غير مخصص لك: ${d.brandName}`
            : `Security Violation: You cannot submit a detailing session for a brand/product you are not assigned to: ${d.brandName}`
        );
        return;
      }
    }

    // 3. Date Validation (Phase O) - prevent invalid past dates
    const todayStr = new Date().toISOString().split("T")[0];
    
    if (followUpRequired && followUpDate) {
      if (followUpDate < todayStr) {
        alert(
          lang === "ar"
            ? "تاريخ المتابعة لا يمكن أن يكون في الماضي."
            : "Follow-up Date cannot be in the past."
        );
        return;
      }
    }

    for (const req of marketingRequests) {
      if (!req.description.trim()) {
        alert(lang === "ar" ? "وصف طلب التسويق مطلوب." : "Marketing Request description is required.");
        return;
      }
      if (req.plannedDate && req.plannedDate < todayStr) {
        alert(
          lang === "ar"
            ? `تاريخ فعالية طلب التسويق لـ ${req.requestType} لا يمكن أن يكون في الماضي.`
            : `Marketing Request event date for ${req.requestType} cannot be in the past.`
        );
        return;
      }
    }

    if (submissionLockRef.current || isSubmitting || completionState.status === "PENDING_SYNC") return;
    setIsSubmitting(true);

    setIsTimerRunning(false);

    // Map sample blocks
    const finalSamples = buildVisitSamplePayload(sampleBlocks, physicianVisitProducts);

    const completedVisit: PhysicianVisitType = {
        id: draftVisitId || `VIS-${Math.floor(1000 + Math.random() * 9000)}`,
        resourceContextId: resourceVisitContextId,
        date: new Date().toISOString().split("T")[0],
        physicianId: selectedPhysician!.id,
        physicianName: selectedPhysician!.name,
        repId: currentUser.id,
        repName: currentUser.name,
        representativeId: currentUser.id,
        representativeName: currentUser.name,
        representativeRole: currentUser.role,
        supervisorId: selectedPhysician!.assignedSupervisorId,
        managerId: selectedPhysician!.assignedManagerId,
        areaId: canonicalPhysicianAreaId,
        status: "Completed",
        startedAt: visitStartedAtRef.current || undefined,
        completedAt: new Date().toISOString(),
        visitDate: new Date().toISOString().split("T")[0],
        durationSeconds: timerSeconds,
        detailing: finalDetailings,
        samples: finalSamples,
        samplesGiven: finalSamples,
        additionalSampleRequests: additionalRequests,
        sampleRequests: additionalRequests,
        generalNotes,
        additionalNotes,
        followUpRequired,
        ...(followUpRequired && followUpDate && followUpDate.trim() !== "" ? { followUpDate: followUpDate.trim() } : {}),
        ...(followUpRequired && followUpNotes && followUpNotes.trim() !== "" ? { followUpNotes: followUpNotes.trim() } : {}),
        gpsVerified: true,
        ...(gpsCoords?.lat !== undefined ? { latitude: gpsCoords.lat } : {}),
        ...(gpsCoords?.lng !== undefined ? { longitude: gpsCoords.lng } : {}),
        ...(gpsRecord?.accuracy !== undefined ? { gpsAccuracy: gpsRecord.accuracy } : {}),
        ...(gpsRecord?.timestamp !== undefined ? { gpsTimestamp: gpsRecord.timestamp } : {}),
        ...(gpsRecord?.source ? { gpsSource: gpsRecord.source } : {}),
        gpsSpoofCheckStatus: gpsRecord?.spoofCheckStatus || "Passed",
        createdAt: new Date().toISOString()
    };

    // Canonical request resources are created by the backend with stable IDs.
    if (marketingRequests.length > 0) {
      completedVisit.marketingRequests = marketingRequests.map(({ id: _id, ...request }) => request);
    }

    try {
      await runPhysicianVisitCompletionAttempt({
        lock: submissionLockRef,
        submit: () => onCompleteVisit(completedVisit),
        setState: setCompletionState,
        onCompleted: () => {
          // Reset only after confirmed cloud persistence.
          setDraftVisitId("");
          setResourceVisitContextId("");
          setAcademicResources([]);
          setStep(1);
          setSelectedPhysician(null);
          setGpsVerified(false);
          setDetailingBlocks([]);
          setSampleBlocks([]);
          setAdditionalRequests([]);
          setGeneralNotes("");
          setAdditionalNotes("");
          setMarketingRequests([]);
          setFollowUpRequired(false);
          setFollowUpDate("");
          setFollowUpNotes("");
        }
      });
    } catch {
      // The helper exposes a retryable inline error while preserving all form state.
    } finally {
      setIsSubmitting(false);
    }
  };

  // Format stopwatch output (MM:SS)
  const formatTime = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // Filter physician list based on searching terms
  const plannedPhysicians = securedPhysicians.filter(p => p.plannedVisitDate);
  const unplannedPhysicians = securedPhysicians.filter(p => {
    if (p.plannedVisitDate) return false;
    const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          (p.nameAr && p.nameAr.includes(searchTerm)) ||
                          p.specialty.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesSpecialty = searchSpecialty ? p.specialty === searchSpecialty : true;
    return matchesSearch && matchesSpecialty;
  });

  useEffect(() => {
    const inputPhysicianIds = (physicians || []).map(p => p.id);
    const eligiblePhysicianIds = securedPhysicians.map(p => p.id);
    const rejectedPhysicianIds = inputPhysicianIds.filter(id => !eligiblePhysicianIds.includes(id));

    const userAreaIds = currentUser?.areaIds || (userTerritoryAssignments || [])
      .filter(a => (a.status === 'Active' || (a as any).active !== false) && a.userId === currentUser?.id)
      .map(a => a.territoryId);

    const assignedProductIds = (currentUser?.products || []).concat(
      (userProductAssignments || [])
        .filter(p => (p.status === 'Active' || (p as any).active !== false) && p.userId === currentUser?.id)
        .map(p => p.productId)
    );

    const representativePromotionGroupIds = currentUser?.primaryPromotionGroupId ? [currentUser.primaryPromotionGroupId] : [];

    console.info(
      "[MEDREP_VISIT_PHYSICIAN_SELECTION_JSON]",
      JSON.stringify({
        inputPhysicianIds,
        eligiblePhysicianIds,
        rejectedPhysicianIds,
        currentUserId: currentUser?.id || "",
        appIsOperational: isOperational ?? false,
        userAreaIds,
        assignedProductIds,
        representativePromotionGroupIds,
        selectedPhysicianId: selectedPhysician?.id || null,
        finalSearchResultIds: unplannedPhysicians.map(p => p.id)
      })
    );
  }, [
    physicians,
    securedPhysicians,
    unplannedPhysicians,
    selectedPhysician,
    currentUser,
    isOperational,
    userTerritoryAssignments,
    userProductAssignments
  ]);

  const specialties = Array.from(new Set(securedPhysicians.map(p => p.specialty)));

  // Suggest first 3 unplanned physicians
  const suggestedPhysicians = useMemo(() => {
    return securedPhysicians.filter(p => !p.plannedVisitDate).slice(0, 3);
  }, [securedPhysicians]);

  // Unique lists for sample filtering
  const allTherapeuticAreas = useMemo(() => {
    return Array.from(new Set(physicianVisitProducts.map(p => p.therapeuticArea)));
  }, [physicianVisitProducts]);

  const allBrands = useMemo(() => {
    return Array.from(new Set(physicianVisitProducts.map(p => p.brand)));
  }, [physicianVisitProducts]);

  return (
    <div className="space-y-6 max-w-full overflow-hidden" id="physician-visit-wrapper" dir={isRtl ? "rtl" : "ltr"}>
      
      {/* HEADER SECTION EXACTLY AS ATTACHED */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-100 dark:border-slate-800 pb-5" id="physician-visit-page-header">
        <div className="flex items-center gap-3">
          <div className="bg-blue-50 dark:bg-blue-950/50 p-2.5 rounded-xl text-blue-600 dark:text-blue-400">
            <BookOpen size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white font-sans">{t.physicianVisit}</h1>
            <p className="text-xs text-slate-500 font-sans mt-0.5">
              {step === 1 ? t.startNewVisit : t.visitInProgress}
            </p>
          </div>
        </div>

        {/* Live Timer and classification banner for Step 2+ */}
        {step > 1 && (
          <div className="flex items-center gap-2" id="header-timer-badges">
            <div className="bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400 border border-blue-100/50 dark:border-blue-900/30 rounded-lg py-1 px-3 flex items-center gap-1.5 font-bold font-mono text-xs">
              <Clock size={14} className="animate-pulse text-blue-600" />
              <span>{formatTime(timerSeconds)}</span>
            </div>
            {selectedPhysician?.classification && (
              <span className="bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-100/50 dark:border-emerald-900/30 rounded-lg py-1 px-3 text-xs font-bold font-mono">
                {t.badgeClass} {selectedPhysician.classification}
              </span>
            )}
          </div>
        )}
      </div>

      {/* STEP TRACKER EXACTLY AS SCREENSHOTS */}
      <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-4 flex justify-between items-center" id="visit-step-tracker">
        <div className="flex-1 flex justify-center max-w-2xl mx-auto items-center" id="stepper-track">
          
          {/* Step 1 */}
          <div className="flex flex-col items-center relative z-10">
            <button 
              disabled={step < 1}
              onClick={() => setStep(1)}
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold font-mono border-2 transition-all cursor-pointer ${
                step > 1 
                  ? "bg-blue-600 border-blue-600 text-white" 
                  : step === 1 
                    ? "border-blue-600 bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 font-black" 
                    : "border-slate-200 dark:border-slate-800 text-slate-400"
              }`}
            >
              {step > 1 ? <Check size={12} className="stroke-[3]" /> : "1"}
            </button>
            <span className={`text-[10px] mt-1 font-bold ${step === 1 ? "text-blue-600 dark:text-blue-400" : "text-slate-400"}`}>
              {t.selectPhysician}
            </span>
          </div>

          <div className={`flex-1 h-0.5 max-w-[80px] -mt-5 mx-2 ${step > 1 ? "bg-blue-600" : "bg-slate-100 dark:bg-slate-800"}`} />

          {/* Step 2 */}
          <div className="flex flex-col items-center relative z-10">
            <button 
              disabled={step < 2}
              onClick={() => setStep(2)}
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold font-mono border-2 transition-all cursor-pointer ${
                step > 2 
                  ? "bg-blue-600 border-blue-600 text-white" 
                  : step === 2 
                    ? "border-blue-600 bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 font-black" 
                    : "border-slate-200 dark:border-slate-800 text-slate-400"
              }`}
            >
              {step > 2 ? <Check size={12} className="stroke-[3]" /> : "2"}
            </button>
            <span className={`text-[10px] mt-1 font-bold ${step === 2 ? "text-blue-600 dark:text-blue-400" : "text-slate-400"}`}>
              {t.detailing}
            </span>
          </div>

          <div className={`flex-1 h-0.5 max-w-[80px] -mt-5 mx-2 ${step > 2 ? "bg-blue-600" : "bg-slate-100 dark:bg-slate-800"}`} />

          {/* Step 3 */}
          <div className="flex flex-col items-center relative z-10">
            <button 
              disabled={step < 3}
              onClick={() => setStep(3)}
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold font-mono border-2 transition-all cursor-pointer ${
                step > 3 
                  ? "bg-blue-600 border-blue-600 text-white" 
                  : step === 3 
                    ? "border-blue-600 bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 font-black" 
                    : "border-slate-200 dark:border-slate-800 text-slate-400"
              }`}
            >
              {step > 3 ? <Check size={12} className="stroke-[3]" /> : "3"}
            </button>
            <span className={`text-[10px] mt-1 font-bold ${step === 3 ? "text-blue-600 dark:text-blue-400" : "text-slate-400"}`}>
              {t.samples}
            </span>
          </div>

          <div className={`flex-1 h-0.5 max-w-[80px] -mt-5 mx-2 ${step > 3 ? "bg-blue-600" : "bg-slate-100 dark:bg-slate-800"}`} />

          {/* Step 4 */}
          <div className="flex flex-col items-center relative z-10">
            <button 
              disabled={step < 4}
              onClick={() => setStep(4)}
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold font-mono border-2 transition-all cursor-pointer ${
                step === 4 
                  ? "border-blue-600 bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 font-black" 
                  : "border-slate-200 dark:border-slate-800 text-slate-400"
              }`}
            >
              "4"
            </button>
            <span className={`text-[10px] mt-1 font-bold ${step === 4 ? "text-blue-600 dark:text-blue-400" : "text-slate-400"}`}>
              {t.outcomes}
            </span>
          </div>

        </div>

        {/* Up-Down arrows visual element matching screenshots */}
        <div className="hidden sm:flex flex-col items-center gap-0.5 border border-slate-100 dark:border-slate-800 rounded p-1 text-slate-400" id="step-arrow-decor">
          <ChevronUp size={12} className="cursor-pointer hover:text-slate-600" />
          <ChevronDown size={12} className="cursor-pointer hover:text-slate-600" />
        </div>
      </div>

      {/* STEP 1: SELECT PHYSICIAN & VALIDATE GPS */}
      {step === 1 && (
        <div className="space-y-6" id="step-1-content">
          
          {/* Grid Layout: Planned vs Unplanned search */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6" id="visit-step1-layout">
            
            {/* Left Column: Today's Planned Visits */}
            <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-5 md:p-6 shadow-sm flex flex-col h-full" id="planned-visits-box">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2 border-b border-slate-50 dark:border-slate-850 pb-3">
                <Clock size={16} className="text-blue-500" />
                <span>{t.plannedToday}</span>
              </h3>

              {plannedPhysicians.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center py-12 text-center" id="no-planned-state">
                  <Calendar size={32} className="text-slate-300 mb-2" />
                  <p className="text-xs text-slate-400 font-medium">{t.noPlannedToday}</p>
                </div>
              ) : (
                <div className="space-y-3 overflow-y-auto max-h-[380px] pr-1" id="planned-physicians-list">
                  {plannedPhysicians.map((p) => (
                    <div 
                      key={p.id}
                      onClick={() => selectPhysicianWithGpsCheck(p)}
                      className={`p-3.5 border rounded-xl flex justify-between items-center cursor-pointer transition-all ${
                        selectedPhysician?.id === p.id 
                          ? "border-blue-500 bg-blue-50/30 dark:bg-blue-950/20 shadow-sm" 
                          : "border-slate-100 dark:border-slate-800 hover:bg-slate-50/50 dark:hover:bg-slate-850/40"
                      }`}
                    >
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-xs text-slate-800 dark:text-slate-200">
                            {lang === "ar" && p.nameAr ? p.nameAr : p.name}
                          </span>
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 font-bold font-mono">
                            {p.classification}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-400 mt-1 uppercase font-semibold">
                          {p.specialty} • {p.address}
                        </p>
                      </div>
                      <span className="text-[10px] font-mono text-slate-400 whitespace-nowrap bg-slate-50 dark:bg-slate-800/80 px-2 py-0.5 rounded">
                        {scopedLastVisitLabel(p.id)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Right Column: Unplanned Visit */}
            <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-5 md:p-6 shadow-sm space-y-5" id="unplanned-visits-box">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white pb-3 border-b border-slate-50 dark:border-slate-850 flex items-center gap-2">
                <Search size={16} className="text-blue-500" />
                <span>{t.unplannedVisit}</span>
              </h3>

              {/* AI Suggestions Row Sub-Section */}
              <div className="space-y-2" id="ai-suggestions-sub">
                <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                  <Sparkles size={11} className="text-indigo-500" />
                  <span>{t.aiSuggestions}</span>
                </h4>
                <div className="grid grid-cols-1 gap-2" id="ai-suggestions-list">
                  {suggestedPhysicians.map((p) => (
                    <div 
                      key={p.id}
                      onClick={() => selectPhysicianWithGpsCheck(p)}
                      className={`p-2.5 bg-slate-50/50 hover:bg-slate-50 dark:bg-slate-850/50 dark:hover:bg-slate-800 border rounded-lg flex justify-between items-center cursor-pointer transition-all ${
                        selectedPhysician?.id === p.id ? "border-blue-500 bg-blue-50/20" : "border-slate-100 dark:border-slate-800"
                      }`}
                    >
                      <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                        {lang === "ar" && p.nameAr ? p.nameAr : p.name}
                      </span>
                      <span className="text-[9px] text-slate-400 font-mono italic">
                        {scopedLastVisitLabel(p.id)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Search Physicians Sub-Section */}
              <div className="space-y-3 pt-2" id="search-physicians-sub">
                <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  {t.searchPhysicians}
                </h4>
                
                {/* Search Bar & Specialty Selector */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" id="search-filters">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={13} />
                    <input 
                      type="text"
                      placeholder={t.searchPlaceholder}
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full pl-8 pr-3 py-1.5 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-transparent text-slate-800 dark:text-white outline-none focus:border-blue-500"
                    />
                  </div>
                  <select
                    value={searchSpecialty}
                    onChange={(e) => setSearchSpecialty(e.target.value)}
                    className="px-2 py-1.5 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-transparent text-slate-800 dark:text-white outline-none focus:border-blue-500"
                  >
                    <option value="">{t.specialtyAll}</option>
                    {specialties.map(spec => (
                      <option key={spec} value={spec}>{spec}</option>
                    ))}
                  </select>
                </div>

                {/* Unplanned matches list */}
                <div className="space-y-2 overflow-y-auto max-h-[160px] pr-1" id="unplanned-physicians-list">
                  {unplannedPhysicians.map((p) => (
                    <div 
                      key={p.id}
                      onClick={() => selectPhysicianWithGpsCheck(p)}
                      className={`p-2.5 border rounded-lg flex justify-between items-center cursor-pointer transition-all ${
                        selectedPhysician?.id === p.id 
                          ? "border-blue-500 bg-blue-50/20" 
                          : "border-slate-100 dark:border-slate-800 hover:bg-slate-50/40 dark:hover:bg-slate-850/20"
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-xs text-slate-800 dark:text-slate-200 truncate">
                            {lang === "ar" && p.nameAr ? p.nameAr : p.name}
                          </span>
                          <span className={`text-[9px] px-1 rounded font-bold font-mono ${p.classification === 'A' ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600'}`}>
                            {p.classification}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-400 mt-0.5 truncate uppercase">
                          {p.specialty} - {p.address}
                        </p>
                      </div>
                      <span className="text-[9px] font-mono text-slate-400 whitespace-nowrap ml-2">
                        {scopedLastVisitLabel(p.id)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          </div>

          {/* Bottom Container: Selected Physician Panel with thick green top border */}
          <AnimatePresence mode="wait">
            {selectedPhysician && (
              <motion.div 
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 15 }}
                className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 border-t-4 border-t-emerald-500 rounded-xl p-5 md:p-6 shadow-md space-y-5"
                id="selected-physician-focus-card"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4" id="focus-card-meta">
                  <div className="flex gap-4">
                    {/* Stethoscope Green Circle Icon */}
                    <div className="bg-emerald-50 dark:bg-emerald-950/40 text-emerald-500 w-12 h-12 rounded-full flex items-center justify-center shrink-0">
                      <TrendingUp size={24} className="stroke-[2.5]" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
                          {lang === "ar" && selectedPhysician.nameAr ? selectedPhysician.nameAr : selectedPhysician.name}
                        </h3>
                        <span className="px-2 py-0.5 bg-emerald-50 text-emerald-600 border border-emerald-100 text-[10px] font-black rounded-full font-mono uppercase">
                          {t.badgeClass} {selectedPhysician.classification}
                        </span>
                        <span className="px-2 py-0.5 bg-amber-50 text-amber-600 border border-amber-100 text-[10px] font-black rounded-full font-mono uppercase">
                          {selectedPhysician.plannedVisitDate ? "Planned" : "Unplanned"}
                        </span>
                      </div>
                      
                      {/* Physician Metadata details rows */}
                      <p className="text-xs text-slate-500 mt-1 uppercase font-bold tracking-wide">
                        {selectedPhysician.specialty}
                      </p>
                      
                      <p className="text-xs text-slate-400 mt-1 flex items-center gap-1 font-semibold">
                        <MapPin size={12} className="text-slate-300" />
                        <span>{selectedPhysician.address}</span>
                      </p>

                      <p className="text-xs text-slate-400 mt-1 flex items-center gap-1 font-mono">
                        <Calendar size={12} className="text-slate-300" />
                        <span>{t.lastVisit}: {scopedLastVisitLabel(selectedPhysician.id)}</span>
                      </p>
                    </div>
                  </div>

                  {/* Right side Previous Visit Summary Card */}
                  <div className="w-full sm:max-w-xs bg-slate-50 dark:bg-slate-850 p-3.5 rounded-lg border border-slate-100 dark:border-slate-800 text-xs flex flex-col justify-between" id="previous-visit-summary-box">
                    <div className="flex items-center gap-1.5 mb-2 border-b border-slate-100 dark:border-slate-800 pb-1.5 justify-between">
                      <div className="flex items-center gap-1.5">
                        <FileText size={14} className="text-blue-500" />
                        <h4 className="font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide text-[10px]">
                          {isRtl ? "ملخص الزيارة السابقة" : "Previous Visit Summary"}
                        </h4>
                      </div>
                      <span className="text-[9px] text-slate-400 font-mono font-bold">LOGGED</span>
                    </div>

                    {lastVisit ? (
                      <div className="space-y-2 max-h-36 overflow-y-auto pr-1" id="previous-visit-details">
                        <div className="flex justify-between items-center text-[10px] text-slate-400 font-mono">
                          <span>{lastVisit.visitDate}</span>
                          {lastVisit.repName && (
                            <span>{isRtl ? "بواسطة: " : "By: "}{lastVisit.repName}</span>
                          )}
                        </div>

                        {lastVisit.prescriptionIntent !== undefined && (
                          <div className="flex justify-between items-center bg-blue-50/50 dark:bg-blue-950/20 px-2 py-1 rounded text-[10.5px]">
                            <span className="font-semibold text-slate-500">{isRtl ? "نية الوصفة:" : "Rx Intent:"}</span>
                            <span className="font-mono font-bold text-blue-600 dark:text-blue-400">{lastVisit.prescriptionIntent} / 10</span>
                          </div>
                        )}

                        {lastVisit.detailing && lastVisit.detailing.length > 0 && (
                          <div className="space-y-1">
                            <span className="text-[10px] text-slate-400 font-bold block uppercase tracking-wider">
                              {isRtl ? "المنتجات المستهدفة:" : "Detailed Brands:"}
                            </span>
                            <div className="flex flex-wrap gap-1">
                              {lastVisit.detailing.map((det: any, idx: number) => (
                                <span key={idx} className="text-[9.5px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-650 font-medium">
                                  {det.brandName} ({isRtl && det.reaction === "Positive" ? "إيجابي" : isRtl && det.reaction === "Neutral" ? "حيادي" : isRtl && det.reaction === "Skeptical" ? "متردد" : isRtl && det.reaction === "Negative" ? "سلبي" : det.reaction})
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {lastVisit.samples && lastVisit.samples.length > 0 && (
                          <div className="space-y-1">
                            <span className="text-[10px] text-slate-400 font-bold block uppercase tracking-wider">
                              {isRtl ? "العينات الموزعة:" : "Distributed Samples:"}
                            </span>
                            <div className="flex flex-wrap gap-1">
                              {lastVisit.samples.map((sm: any, idx: number) => (
                                <span key={idx} className="text-[9.5px] px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 font-medium">
                                  {sm.brand || sm.productName}{sm.sampleSkuName ? ` · ${sm.sampleSkuName}` : ""} (x{sm.quantity})
                                  {sm.allocationConsumptions?.length ? ` · ${sm.allocationConsumptions.map((item: any) => `${item.batchNumber} ${item.expiryDate}`).join(", ")}` : ""}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {lastVisit.generalNotes && (
                          <div className="bg-amber-50/40 dark:bg-amber-950/10 p-2 rounded border border-amber-100/50 dark:border-amber-900/10 text-[10px] text-slate-600 dark:text-slate-400 italic leading-normal">
                            {lastVisit.generalNotes}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-[10px] text-slate-400 italic py-4 text-center">
                        {isRtl ? "لا توجد زيارات سابقة مسجلة لهذا الطبيب." : "No previous visits logged for this physician."}
                      </div>
                    )}
                  </div>
                  </div>

                {/* GPS Verification Banner */}
                <div id="gps-action-banner">
                  {gpsVerified ? (
                    <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/40 text-emerald-700 dark:text-emerald-400 rounded-lg p-3 flex items-center justify-between text-xs" id="gps-success-banner">
                      <div className="flex items-center gap-2 font-semibold">
                        <MapPinCheck size={16} className="text-emerald-500" />
                        <span>
                          {isRtl
                            ? "تم إثبات الموقع الجغرافي للطبيب خلال الزيارة الميدانية الأولى."
                            : "GPS Verified. Location verified during the first field visit."}
                        </span>
                      </div>
                      <span className="text-[10px] font-mono opacity-80">{gpsCoords ? `${gpsCoords.lat.toFixed(4)}, ${gpsCoords.lng.toFixed(4)}` : ""}</span>
                    </div>
                  ) : (
                    <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 rounded-lg p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs" id="gps-prompt-banner">
                      <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300 font-medium">
                        <MapPin size={16} className="text-amber-500 animate-bounce shrink-0" />
                        <span>
                          {isRtl
                            ? "هذا الطبيب لم يتم التحقق من موقعه الجغرافي بعد. هذه الزيارة الأولى ستحدد الموقع الجغرافي الدائم للطبيب."
                            : "This customer has not yet been GPS verified. This first visit will establish the global customer location."}
                        </span>
                      </div>
                      <button
                        onClick={handleVerifyGps}
                        disabled={gpsLoading}
                        className="py-1.5 px-4 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 shrink-0"
                      >
                        <Clock size={12} className={gpsLoading ? "animate-spin" : ""} />
                        <span>{gpsLoading ? t.gpsLoading : (isRtl ? "تسجيل الموقع الأول" : "Acquire GPS Check-In")}</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Start Visit full-width button */}
                <button
                  onClick={handleStartVisit}
                  disabled={!gpsVerified || resourceContextLoading}
                  className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-100 disabled:text-slate-400 dark:disabled:bg-slate-850 dark:disabled:text-slate-600 text-white text-xs font-bold rounded-lg shadow flex items-center justify-center gap-2 transition-all cursor-pointer"
                  id="btn-start-visit"
                >
                  <Play size={14} className="fill-current" />
                  <span>{resourceContextLoading ? (isRtl ? "جارٍ تفويض المواد…" : "Authorizing materials…") : t.startVisit}</span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* STEP 2: PRODUCT DETAILING WORKFLOW */}
      {step === 2 && (
        <div className="space-y-6" id="step-2-content">
          
          {/* List of active detailing blocks */}
          <div className="space-y-6" id="detailing-blocks-list">
            {detailingBlocks.map((block, index) => {
              const eligibilityInput = {
                products,
                physicianAlignedProductIds: selectedPhysician?.alignedProductIds || [],
                representativeActiveProductIds: representativeActiveAssignedProducts.map(product => product.id),
                primaryPromotionGroupId: selectedPhysician?.primaryPromotionGroupId,
                targetPromotionGroupIds: selectedPhysician?.targetPromotionGroupIds || [],
                selections: detailingBlocks,
                blockIndex: index,
                selectedPromotionGroupId: block.promotionGroupId || undefined
              };
              const resolution = resolveDetailingEligibility(eligibilityInput);
              const eligibleProductsForBlock = getEligibleProductsForDetailingBlock(eligibilityInput);
              const availableProducts = eligibleProductsForBlock;
              const selectedProdObj = physicianVisitProducts.find(p => p.id === block.productId);
              const primaryGroup = assignedPromotionGroups.find(group => group.id === selectedPhysician?.primaryPromotionGroupId);
              const targetGroups = assignedPromotionGroups.filter(group =>
                (selectedPhysician?.targetPromotionGroupIds || []).includes(group.id)
              );
              const isFirstBlock = index === 0;

              const alignedProductIds = selectedPhysician?.alignedProductIds || [];
              const assignedProductIds = new Set(representativeActiveAssignedProducts.map(product => product.id));
              const productsById = new Map(products.map(product => [product.id, product]));
              const rejectionReasonsByProductId = Object.fromEntries(alignedProductIds.map(productId => {
                const product = productsById.get(productId);
                const reasons: string[] = [];
                if (!product) reasons.push("PRODUCT_NOT_IN_MASTER_LISTENER");
                else {
                  if (product.isActive === false || (product as any).active === false) reasons.push("PRODUCT_INACTIVE");
                  if (!assignedProductIds.has(productId)) reasons.push("REPRESENTATIVE_NOT_ACTIVELY_ASSIGNED");
                  if (product.promotionGroupId !== selectedPhysician?.primaryPromotionGroupId) reasons.push("NOT_IN_PRIMARY_PROMOTION_GROUP");
                }
                return [productId, reasons];
              }));

              console.info("[WP710J_E_PRIMARY_POOL_TRACE_JSON]", JSON.stringify({
                physicianId: selectedPhysician?.id || null,
                primaryPromotionGroupId: selectedPhysician?.primaryPromotionGroupId || null,
                physicianAlignedProductIds: alignedProductIds,
                representativeActiveProductIds: representativeActiveAssignedProducts.map(product => product.id),
                allowedVisitProductIds: resolution.allowedVisitProductIds,
                productsMatchingPrimaryGroup: products
                  .filter(product => product.promotionGroupId === selectedPhysician?.primaryPromotionGroupId)
                  .map(product => product.id),
                remainingPrimaryProductIds: resolution.remainingEligiblePrimaryProductIds,
                rejectionReasonsByProductId
              }));

              console.info("[WP710J_PRODUCT_POOL_JSON]", JSON.stringify({
                visitId: draftVisitId,
                detailingBlockIndex: index,
                selectedPromotionGroupId: block.promotionGroupId || null,
                alreadyDetailedProductIds: resolution.excludedAlreadySelectedProductIds,
                remainingPrimaryProductIds: resolution.remainingEligiblePrimaryProductIds,
                remainingTargetProductIds: resolution.remainingEligibleTargetProductIds,
                availableProductIds: resolution.availableProductIdsForBlock
              }));

              console.info("[WP710J_DETAILING_GROUP_RESOLUTION_JSON]", JSON.stringify({
                visitId: draftVisitId, detailingBlockIndex: index,
                selectedPromotionGroupId: block.promotionGroupId || null,
                selectedPromotionGroupName: block.brand || null,
                physicianPrimaryPromotionGroupId: selectedPhysician?.primaryPromotionGroupId || null,
                physicianTargetPromotionGroupIds: selectedPhysician?.targetPromotionGroupIds || [],
                allowedVisitProductIds: resolution.allowedVisitProductIds,
                productsInSelectedPromotionGroup: resolution.productsInSelectedPromotionGroup,
                eligibleProductIds: resolution.eligibleProductIds,
                excludedAlreadySelectedProductIds: resolution.excludedAlreadySelectedProductIds
              }));
              console.info("[WP710J_DETAILING_SEQUENCE_JSON]", JSON.stringify({
                visitId: draftVisitId, detailingBlockIndex: index, isFirstBlock,
                alreadySelectedProductIds: detailingBlocks.map(item => item.productId).filter(Boolean),
                remainingEligiblePrimaryProductIds: resolution.remainingEligiblePrimaryProductIds,
                remainingEligibleTargetProductIds: resolution.remainingEligibleTargetProductIds,
                availableProductIdsForBlock: resolution.availableProductIdsForBlock
              }));

              return (
                <div 
                  key={block.id} 
                  className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-5 md:p-6 shadow-sm relative space-y-6"
                  id={`detailing-block-${block.id}`}
                >
                  {/* Remove Button for Block */}
                  {!isFirstBlock && (
                    <button
                      onClick={() => handleRemoveDetailingBlock(block.id)}
                      className="absolute top-4 right-4 text-slate-400 hover:text-rose-500 p-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                      title="Remove product detailing"
                    >
                      <X size={16} />
                    </button>
                  )}

                  {/* Block Header */}
                  <div className="flex items-center gap-2 border-b border-slate-50 dark:border-slate-850 pb-3" id="det-block-title">
                    <div className="bg-blue-50 dark:bg-blue-950 p-1.5 rounded-lg text-blue-600">
                      <Tag size={14} />
                    </div>
                    <span className="text-xs font-bold text-slate-800 dark:text-white uppercase tracking-wider">
                      Product Detailing #{index + 1}
                    </span>
                  </div>

                  {/* Section: Select canonical Promotion Group */}
                  <div className="space-y-3" id="det-brand-picker">
                    <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                      <span>Promotion Group Selection</span>
                    </h4>

                    <div className="flex flex-col gap-3">
                      {/* Primary Brand Block */}
                      {primaryGroup && (
                        <div>
                          <p className="text-[10px] text-slate-400 flex items-center gap-1 mb-1.5 font-bold font-mono uppercase">
                            <Star size={10} className="text-amber-400 fill-amber-400" />
                            <span>{t.primaryBrand}</span>
                          </p>
                          <button
                            onClick={() => {
                              handleSelectDetailingGroup(block, index, primaryGroup.id, primaryGroup.name);
                            }}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-2 transition-all cursor-pointer ${
                              block.promotionGroupId === primaryGroup.id
                                ? "bg-blue-600 text-white shadow"
                                : "bg-slate-50 hover:bg-slate-100 dark:bg-slate-850 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-100 dark:border-slate-800"
                            }`}
                          >
                            <span>{primaryGroup.name}</span>
                            <span className={`text-[9px] px-1.5 py-0.5 rounded font-black ${
                              block.promotionGroupId === primaryGroup.id
                                ? "bg-white/20 text-white" 
                                : "bg-blue-50 text-blue-600"
                            }`}>Primary</span>
                          </button>
                        </div>
                      )}

                      {/* All remaining and Target Promotion Groups begin at block #2. */}
                      {!isFirstBlock && (
                        <button
                          onClick={() => handleSelectDetailingGroup(block, index, "", "")}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold self-start transition-all cursor-pointer ${
                            !block.promotionGroupId
                              ? "bg-blue-600 text-white shadow"
                              : "bg-slate-50 hover:bg-slate-100 dark:bg-slate-850 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-100 dark:border-slate-800"
                          }`}
                        >
                          All Remaining Promotion Groups
                        </button>
                      )}

                      {!isFirstBlock && targetGroups.length > 0 && (
                        <div className="border border-slate-100 dark:border-slate-800 rounded-lg p-3 bg-slate-50/40 dark:bg-slate-850/20">
                          <button
                            onClick={() => {
                              handleUpdateDetailingBlock(block.id, { 
                                targetBrandsExpanded: !block.targetBrandsExpanded 
                              });
                            }}
                            className="w-full flex justify-between items-center text-[10px] font-bold text-slate-400 uppercase tracking-wide cursor-pointer"
                          >
                            <span className="flex items-center gap-1">
                              <Target size={11} className="text-slate-400" />
                              <span>{t.targetBrands} ({targetGroups.length})</span>
                            </span>
                            <ChevronDown size={12} className={`transition-transform duration-200 ${block.targetBrandsExpanded ? "rotate-180" : ""}`} />
                          </button>

                          {block.targetBrandsExpanded && (
                            <div className="flex flex-wrap gap-2 mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                              {targetGroups.map(group => (
                                <button
                                  key={group.id}
                                  onClick={() => {
                                    handleSelectDetailingGroup(block, index, group.id, group.name);
                                  }}
                                  className={`px-2.5 py-1 rounded text-xs font-bold transition-all cursor-pointer ${
                                    block.promotionGroupId === group.id
                                      ? "bg-blue-600 text-white"
                                      : "bg-white hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800"
                                  }`}
                                >
                                  {group.name}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Section: Products Grid */}
                  <div className="space-y-3" id="det-products-picker">
                    <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                      <Package size={11} className="text-slate-400" />
                      <span>{t.selectProduct}</span>
                    </h4>

                    {availableProducts.length === 0 ? (
                      <p className="text-xs text-slate-400 italic">
                        {block.promotionGroupId
                          ? "No remaining eligible products for this Promotion Group."
                          : "No remaining eligible products for this visit."}
                      </p>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3" id="products-selection-grid">
                        {availableProducts.map(prod => {
                          const isSelected = block.productId === prod.id;
                          return (
                            <div
                              key={prod.id}
                              onClick={() => handleSelectDetailingProduct(block, index, prod)}
                              className={`p-3 border rounded-lg flex items-center gap-3 cursor-pointer transition-all ${
                                isSelected
                                  ? "bg-blue-600 border-blue-600 text-white shadow-md"
                                  : "border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-850"
                              }`}
                            >
                              <div className={`p-1.5 rounded ${isSelected ? "bg-white/20" : "bg-slate-100 dark:bg-slate-800"}`}>
                                <Package size={14} className={isSelected ? "text-white" : "text-slate-500"} />
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className={`text-xs font-bold truncate ${isSelected ? "text-white" : "text-slate-850 dark:text-white"}`}>
                                  {prod.name}
                                </p>
                                <p className={`text-[9px] font-semibold mt-0.5 uppercase ${isSelected ? "text-white/80" : "text-slate-400"}`}>
                                  {prod.therapeuticArea}
                                </p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Expanded block sections for selected product */}
                  {selectedProdObj && (
                    <div className="space-y-5 pt-3 border-t border-slate-50 dark:border-slate-850" id="det-expanded-sections">
                      
                      {/* Sub-Section: Key Messages list with checkbox circle pills */}
                      <div className="space-y-3" id="det-messages-list">
                        <div>
                          <h4 className="text-xs font-bold text-slate-800 dark:text-white">
                            {t.keyPromoMessages} for {selectedProdObj.name}
                          </h4>
                          <p className="text-[10px] text-slate-400">Select the messages you delivered to the physician</p>
                        </div>

                        <div className="space-y-2 max-h-48 overflow-y-auto pr-1" id="messages-pills">
                          {filterKeyMessagesForProduct(securedKeyMessages, block.productId)
                            .map((msg, index) => {
                              const isChecked = block.selectedMessages.includes(msg.id);
                              
                              // Categorize as Primary, Secondary, Tertiary
                              const badgeText = index === 0 ? "Primary" : index === 1 ? "Secondary" : "Tertiary";
                              const badgeClass = index === 0 
                                ? "bg-emerald-50 text-emerald-600 border-emerald-100" 
                                : index === 1 
                                  ? "bg-blue-50 text-blue-600 border-blue-100" 
                                  : "bg-purple-50 text-purple-600 border-purple-100";

                              return (
                                <div
                                  key={msg.id}
                                  onClick={() => {
                                    const nextMessages = isChecked
                                      ? block.selectedMessages.filter(id => id !== msg.id)
                                      : [...block.selectedMessages, msg.id];
                                    handleUpdateDetailingBlock(block.id, {
                                      selectedMessages: nextMessages,
                                      presentedKeyMessageIds: nextMessages,
                                      hasPresented: nextMessages.length > 0
                                    });
                                  }}
                                  className={`p-3 border rounded-lg flex items-start gap-3 cursor-pointer transition-all ${
                                    isChecked
                                      ? "border-blue-500 bg-blue-50/10 dark:bg-blue-950/10"
                                      : "border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-850"
                                  }`}
                                >
                                  {/* Custom circular checkbox */}
                                  <div className="shrink-0 mt-0.5">
                                    <div className={`w-4 h-4 rounded-full border flex items-center justify-center transition-all ${
                                      isChecked 
                                        ? "border-blue-600 bg-blue-600 text-white" 
                                        : "border-slate-300 dark:border-slate-700 bg-transparent"
                                    }`}>
                                      {isChecked && <Check size={10} className="stroke-[3]" />}
                                    </div>
                                  </div>

                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span className={`text-[9px] px-1.5 py-0.5 rounded border font-bold ${badgeClass}`}>
                                        {badgeText}
                                      </span>
                                    </div>
                                    <p className="text-xs text-slate-700 dark:text-slate-300 font-medium mt-1">
                                      {lang === "ar" && msg.messageAr ? msg.messageAr : msg.message}
                                    </p>
                                  </div>
                                </div>
                              );
                            })}
                        </div>
                        <p className="text-[9px] text-slate-400 font-semibold uppercase tracking-wider flex items-center gap-1 justify-end">
                          <span>Scroll to see all 3 messages</span>
                        </p>
                      </div>

                      {(() => {
                        const linkedRes = filterMaterialsForProduct(authorizedVisitAcademicResources, { productId: selectedProdObj.id, productPromotionGroupId: selectedProdObj.promotionGroupId, physicianSpecialtyId: selectedPhysician?.specialtyId });

                        let finalResList = [...linkedRes];
                        if (currentUser.role === "Medical Representative") {
                          finalResList = finalResList.filter(r => r.status === "Approved" || r.isApproved === true || r.approvalStatus === "PUBLISHED" || r.approvalStatus === "APPROVED");
                        } else if (currentUser.role === "Sales Representative") {
                          const marketingCats = ["BROCHURE", "VISUAL_AID", "VIDEO", "Brochure", "Visual Aid", "Video", "Brochures", "Visual Aids", "Detailing Kits"];
                          finalResList = finalResList.filter(r => (r.status === "Approved" || r.isApproved === true || r.approvalStatus === "PUBLISHED" || r.approvalStatus === "APPROVED") && marketingCats.includes(r.category));
                        }

                        const primaryRes = finalResList.length > 0 ? finalResList[0] : null;

                        return (
                          <>
                            {/* Sub-Section: Detailing Materials (Brochures) */}
                            <div className="space-y-3" id="det-materials">
                              <div>
                                <h4 className="text-xs font-bold text-slate-800 dark:text-white">
                                  Detailing Materials for {selectedProdObj.name}
                                </h4>
                                <p className="text-[10px] text-slate-400 font-sans">Select a brochure or resource to present</p>
                              </div>

                              {/* Brochure Card Row */}
                              {primaryRes ? (
                              <div className="flex flex-col sm:flex-row gap-3">
                                <div 
                                  onClick={() => {
                                    setActiveBrochure({
                                      detailingBlockId: block.id,
                                      brand: block.brand,
                                      productName: selectedProdObj.name,
                                      productId: selectedProdObj.id,
                                      promotionGroupId: selectedProdObj.promotionGroupId,
                                      materialId: primaryRes.resourceId || primaryRes.id,
                                      materialName: primaryRes.titleEn || primaryRes.title || primaryRes.fileName,
                                      mimeType: primaryRes?.mimeType,
                                      fileName: primaryRes?.fileName,
                                      originalFileName: primaryRes?.originalFileName,
                                      fileSizeBytes: primaryRes?.fileSizeBytes,
                                      fileExtension: primaryRes?.fileExtension
                                    });
                                  }}
                                  className="flex-1 p-3 border border-slate-200 dark:border-slate-800 rounded-lg flex items-center justify-between cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-850 transition-all bg-slate-50/20"
                                >
                                  <div className="flex items-center gap-3">
                                    <div className="bg-blue-50 dark:bg-blue-950 p-2 rounded text-blue-600">
                                      <FileText size={16} />
                                    </div>
                                    <div>
                                      <p className="text-xs font-bold text-slate-850 dark:text-white">
                                        {primaryRes.titleEn || primaryRes.title || primaryRes.fileName}
                                      </p>
                                      <p className="text-[9px] text-slate-400 font-mono">
                                        {`${primaryRes.category} • ${primaryRes.fileSizeBytes ? formatFileSize(primaryRes.fileSizeBytes) : "Official Material"}`}
                                      </p>
                                    </div>
                                  </div>
                                  <span className="text-[9px] px-2 py-0.5 border border-slate-200 dark:border-slate-850 rounded font-bold text-slate-500 uppercase bg-white dark:bg-slate-900">
                                    {(primaryRes.fileExtension || "PDF").toUpperCase()}
                                  </span>
                                </div>

                                {/* View Brochure Trigger Button */}
                                <button
                                  onClick={() => {
                                    setActiveBrochure({
                                      detailingBlockId: block.id,
                                      brand: block.brand,
                                      productName: selectedProdObj.name,
                                      productId: selectedProdObj.id,
                                      promotionGroupId: selectedProdObj.promotionGroupId,
                                      materialId: primaryRes.resourceId || primaryRes.id,
                                      materialName: primaryRes.titleEn || primaryRes.title || primaryRes.fileName,
                                      mimeType: primaryRes?.mimeType,
                                      fileName: primaryRes?.fileName,
                                      originalFileName: primaryRes?.originalFileName,
                                      fileSizeBytes: primaryRes?.fileSizeBytes,
                                      fileExtension: primaryRes?.fileExtension
                                    });
                                  }}
                                  className="py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg flex items-center justify-center gap-1.5 shadow-sm transition-colors cursor-pointer"
                                >
                                  <Eye size={13} />
                                  <span>{t.viewBrochure}</span>
                                </button>
                              </div>
                              ) : (
                                <p className="text-xs text-slate-400 italic">No active approved materials are linked to this Product ID.</p>
                              )}
                            </div>

                            {finalResList.length > 0 && (
                              <div className="space-y-2 pt-2 border-t border-slate-50 dark:border-slate-850">
                                <h4 className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider flex items-center gap-1">
                                  <BookOpen size={11} />
                                  <span>{lang === "ar" ? "المصادر والمطويات المعتمدة" : "Approved Linked Resources"} ({finalResList.length})</span>
                                </h4>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                  {finalResList.map((res, rIdx) => (
                                    <a 
                                      key={res.resourceId || res.id || rIdx}
                                      href="#"
                                      onClick={(e) => {
                                        e.preventDefault();
                                        setActiveBrochure({
                                          detailingBlockId: block.id,
                                          brand: block.brand,
                                          productName: `${selectedProdObj.name} (${res.category})`,
                                          productId: selectedProdObj.id,
                                          promotionGroupId: selectedProdObj.promotionGroupId,
                                          materialId: res.resourceId || res.id || `res-${selectedProdObj.id}-${rIdx}`,
                                          materialName: res.titleEn || res.title || res.fileName,
                                          mimeType: res.mimeType,
                                          fileName: res.fileName,
                                          originalFileName: res.originalFileName,
                                          fileSizeBytes: res.fileSizeBytes,
                                          fileExtension: res.fileExtension
                                        });
                                      }}
                                      className="p-2 border border-slate-100 dark:border-slate-800 rounded-lg hover:border-indigo-200 dark:hover:border-indigo-900 bg-indigo-50/10 dark:bg-indigo-950/5 flex justify-between items-center transition-all cursor-pointer"
                                    >
                                      <div className="min-w-0 pr-2 text-left">
                                        <p className="text-[10.5px] font-bold text-slate-800 dark:text-white truncate">
                                          {lang === "ar" ? res.titleAr || res.titleEn || res.title : res.titleEn || res.title}
                                        </p>
                                        <p className="text-[9px] text-slate-400">
                                          {res.category} • v{res.fileVersion || res.version || "1.0"} {res.fileSizeBytes ? `• ${formatFileSize(res.fileSizeBytes)}` : ""}
                                        </p>
                                      </div>
                                      <span className="text-[9px] font-bold text-indigo-600 dark:text-indigo-400 px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950 shrink-0">
                                        View
                                      </span>
                                    </a>
                                  ))}
                                </div>
                              </div>
                            )}
                          </>
                        );
                      })()}

                      {/* Sub-Section: Reaction & Notes */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" id="det-reaction-notes">
                        <div>
                          <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1.5">
                            {t.reaction}
                          </label>
                          <select
                            value={block.reaction}
                            onChange={(e) => handleUpdateDetailingBlock(block.id, { reaction: e.target.value as any })}
                            className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-transparent text-slate-800 dark:text-white outline-none focus:border-blue-500"
                          >
                            <option value="Positive">Positive (إيجابي)</option>
                            <option value="Neutral">Neutral (محايد)</option>
                            <option value="Skeptical">Skeptical (متشكك)</option>
                            <option value="Negative">Negative (سلبي)</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1.5">
                            {t.prescriptionIntentLabel}
                          </label>
                          <select
                            value={block.prescriptionIntent}
                            onChange={(e) => handleUpdateDetailingBlock(block.id, { prescriptionIntent: e.target.value as CanonicalPrescriptionIntent })}
                            className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-transparent text-slate-800 dark:text-white outline-none focus:border-blue-500"
                          >
                            <option value="" disabled>{isRtl ? "اختر نية الوصف" : "Select Prescription Intent"}</option>
                            <option value="Will Prescribe">Will Prescribe</option>
                            <option value="Considering">Considering</option>
                            <option value="Needs Info">Needs Info</option>
                            <option value="Not Interested">Not Interested</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1.5">
                            {t.notes}
                          </label>
                          <textarea
                            value={block.notes}
                            onChange={(e) => handleUpdateDetailingBlock(block.id, { notes: e.target.value })}
                            placeholder="Notes about this product discussion..."
                            rows={1}
                            className="w-full px-3 py-1.5 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-transparent text-slate-800 dark:text-white outline-none focus:border-blue-500 resize-none"
                          />
                        </div>
                      </div>

                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Add Detailing block trigger */}
          <button
            onClick={handleAddDetailingBlock}
            disabled={detailingBlocks.some(block => !block.productId) || !selectedPhysician || getEligibleProductsForDetailingBlock({
              products,
              physicianAlignedProductIds: selectedPhysician?.alignedProductIds || [],
              representativeActiveProductIds: representativeActiveAssignedProducts.map(product => product.id),
              primaryPromotionGroupId: selectedPhysician?.primaryPromotionGroupId,
              targetPromotionGroupIds: selectedPhysician?.targetPromotionGroupIds || [],
              selections: detailingBlocks,
              blockIndex: detailingBlocks.length
            }).length === 0}
            className="w-full py-3 bg-white dark:bg-slate-900 border border-dashed border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-850/60 rounded-xl text-xs font-bold text-slate-500 hover:text-slate-800 flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
          >
            <Plus size={14} />
            <span>{t.addDetailing}</span>
          </button>

          {/* Footer Navigation Buttons */}
          <div className="flex justify-between items-center pt-4" id="step2-navigation">
            <button
              onClick={() => setStep(1)}
              className="py-2 px-5 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-850 text-slate-600 dark:text-slate-300 text-xs font-bold rounded-lg transition-colors cursor-pointer"
            >
              Back
            </button>
            <button
              onClick={handleNextToSamples}
              className="py-2.5 px-6 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 shadow transition-colors cursor-pointer"
            >
              <span>{t.nextSamples}</span>
              <ArrowRight size={13} />
            </button>
          </div>

        </div>
      )}

      {/* STEP 3: SAMPLES DISBURSEMENT */}
      {step === 3 && (
        <div className="space-y-6" id="step-3-content">
          
          {/* Labeled Samples Given container */}
          <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-5 md:p-6 shadow-sm space-y-6" id="samples-given-panel">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white pb-3 border-b border-slate-50 dark:border-slate-850 flex items-center gap-2">
              <Package size={16} className="text-blue-500" />
              <span>{t.sampleSelection}</span>
            </h3>

            {/* List of sample disbursement blocks */}
            <div className="space-y-4" id="sample-blocks-list">
              {sampleBlocks.map((block, index) => {
                const isFirstBlock = index === 0;
                
                // Filter brand based on therapeutic area
                const filteredBrands = block.therapeuticArea === "All Areas"
                  ? allBrands
                  : Array.from(new Set(physicianVisitProducts.filter(p => p.therapeuticArea === block.therapeuticArea).map(p => p.brand)));

                // Filter products based on selected brand & therapeutic area
                const filteredProducts = physicianVisitProducts.filter(p => {
                  const matchArea = block.therapeuticArea === "All Areas" || p.therapeuticArea === block.therapeuticArea;
                  const matchBrand = block.brand === "All Brands" || p.brand === block.brand;
                  return matchArea && matchBrand;
                });

                return (
                  <div 
                    key={block.id} 
                    className="p-4 border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50/20 dark:bg-slate-850/10 relative space-y-4"
                    id={`sample-block-${block.id}`}
                  >
                    {/* Remove button */}
                    {!isFirstBlock && (
                      <button
                        onClick={() => handleRemoveSampleBlock(block.id)}
                        className="absolute top-3.5 right-3.5 text-slate-400 hover:text-rose-500 p-1 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                      >
                        <X size={14} />
                      </button>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 pt-2" id="sample-fields-grid">
                      
                      {/* Therapeutic Area Filter Dropdown */}
                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">
                          Therapeutic Area
                        </label>
                        <select
                          value={block.therapeuticArea}
                          onChange={(e) => {
                            handleUpdateSampleBlock(block.id, { 
                              therapeuticArea: e.target.value, 
                              brand: "All Brands", 
                              productId: "",
                              sampleSkuId: ""
                            });
                          }}
                          className="w-full px-3 py-1.5 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-transparent text-slate-800 dark:text-white outline-none"
                        >
                          <option value="All Areas">All Areas</option>
                          {allTherapeuticAreas.map(area => (
                            <option key={area} value={area}>{area}</option>
                          ))}
                        </select>
                      </div>

                      {/* Brand Filter Dropdown */}
                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">
                          {t.primaryBrand}
                        </label>
                        <select
                          value={block.brand}
                          onChange={(e) => {
                            handleUpdateSampleBlock(block.id, { 
                              brand: e.target.value, 
                              productId: "",
                              sampleSkuId: ""
                            });
                          }}
                          className="w-full px-3 py-1.5 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-transparent text-slate-800 dark:text-white outline-none"
                        >
                          <option value="All Brands">All Brands</option>
                          {filteredBrands.map(b => (
                            <option key={b} value={b}>{b}</option>
                          ))}
                        </select>
                      </div>

                      {/* Product Formulation Dropdown */}
                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">
                          Sample Product
                        </label>
                        <select
                          value={block.productId}
                          onChange={(e) => handleUpdateSampleBlock(block.id, { productId: e.target.value, sampleSkuId: "" })}
                          className="w-full px-3 py-1.5 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-transparent text-slate-800 dark:text-white outline-none"
                        >
                          <option value="">-- Select Product --</option>
                          {filteredProducts.map(p => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">Sample SKU</label>
                        <select value={block.sampleSkuId} onChange={(e) => handleUpdateSampleBlock(block.id, { sampleSkuId: e.target.value })} className="w-full px-3 py-1.5 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-transparent text-slate-800 dark:text-white outline-none">
                          <option value="">-- Select SKU --</option>
                          {sampleOptions.filter(option => option.productId === block.productId).map(option => <option key={option.sampleSkuId} value={option.sampleSkuId}>{option.name}{option.descriptor ? ` (${option.descriptor})` : ""} — {option.availableQuantity} available</option>)}
                        </select>
                        {block.sampleSkuId && <p className="mt-1 text-[10px] text-slate-500">{sampleOptions.find(option => option.sampleSkuId === block.sampleSkuId)?.batches.map(batch => `${batch.batchNumber} · ${batch.expiryDate}`).join("; ")}</p>}
                      </div>

                      {/* Quantity input */}
                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">
                          {t.qty}
                        </label>
                        <input
                          type="number"
                          min="1"
                          max="3"
                          value={block.quantity}
                          onChange={(e) => handleUpdateSampleBlock(block.id, { quantity: Number(e.target.value) })}
                          className="w-full px-3 py-1.5 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-transparent text-slate-800 dark:text-white outline-none"
                        />
                      </div>

                    </div>
                  </div>
                );
              })}
            </div>
            {sampleOptionsError && <p className="text-xs font-semibold text-rose-600">Samples unavailable: {sampleOptionsError}</p>}

            {/* Add Sample Trigger */}
            <button
              onClick={handleAddSampleBlock}
              className="px-4 py-2 bg-slate-50 hover:bg-slate-100 dark:bg-slate-850 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold rounded-lg flex items-center gap-1 cursor-pointer transition-colors"
            >
              <Plus size={13} />
              <span>{t.addSample}</span>
            </button>

          </div>

          {/* Request Additional Samples Accordion section */}
          <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
            <button
              onClick={() => setIsAdditionalSamplesOpen(!isAdditionalSamplesOpen)}
              className="w-full p-4 md:p-5 flex justify-between items-center font-bold text-slate-900 dark:text-white hover:bg-slate-50 dark:hover:bg-slate-850/50 transition-all cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <AlertCircle size={16} className="text-blue-500 animate-pulse" />
                <span className="text-sm font-bold">{t.extraSamplesTitle}</span>
              </div>
              <ChevronDown size={16} className={`text-slate-400 transition-transform duration-250 ${isAdditionalSamplesOpen ? "rotate-180" : ""}`} />
            </button>

            {isAdditionalSamplesOpen && (
              <div className="p-5 border-t border-slate-50 dark:border-slate-850 bg-slate-50/10 dark:bg-slate-900 space-y-4 animate-fade-in">
                <p className="text-xs text-slate-500 font-medium">
                  {t.extraSamplesSubtitle}
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4" id="request-fields-container">
                  {/* Sample selection dropdown */}
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">
                      {t.sampleNeededName}
                    </label>
                    <select
                      value={addSampleReqName}
                      onChange={(e) => setAddSampleReqName(e.target.value)}
                      className="w-full px-3 py-1.5 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-transparent text-slate-800 dark:text-white outline-none"
                    >
                      <option value="">-- Choose Sample --</option>
                      {requestSampleSkus.filter(sku => physicianVisitProducts.some(product => product.id === sku.productId)).map(sku => (
                        <option key={sku.id} value={sku.id}>{sku.name} · {physicianVisitProducts.find(product => product.id === sku.productId)?.name}</option>
                      ))}
                    </select>
                  </div>

                  {/* Quantity Needed */}
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">
                      Quantity Needed
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={addSampleReqQty}
                      onChange={(e) => setAddSampleReqQty(Number(e.target.value))}
                      className="w-full px-3 py-1.5 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-transparent text-slate-800 dark:text-white outline-none"
                    />
                  </div>

                  {/* Expected Delivery Date */}
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">
                      {t.expectedDate}
                    </label>
                    <input
                      type="date"
                      value={addSampleReqDate}
                      onChange={(e) => setAddSampleReqDate(e.target.value)}
                      className="w-full px-3 py-1.5 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-transparent text-slate-800 dark:text-white outline-none"
                    />
                  </div>

                  {/* Reason for Request textarea */}
                  <div className="sm:col-span-2 md:col-span-3">
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">
                      {t.reason}
                    </label>
                    <textarea
                      value={addSampleReqReason}
                      onChange={(e) => setAddSampleReqReason(e.target.value)}
                      placeholder="Explain why these extra institutional samples are needed..."
                      rows={2}
                      className="w-full px-3 py-1.5 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-transparent text-slate-800 dark:text-white outline-none resize-none focus:border-blue-500"
                    />
                  </div>
                </div>

                <button
                  onClick={handleAddExtraSampleRequest}
                  disabled={!addSampleReqName || !addSampleReqQty || !addSampleReqDate || !addSampleReqReason.trim()}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-55 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 shadow transition-colors cursor-pointer"
                >
                  <Send size={12} />
                  <span>{t.submitExtra}</span>
                </button>
              </div>
            )}
          </div>

          {/* Allocation Logs list if items were requested */}
          {additionalRequests.length > 0 && (
            <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-5" id="allocated-requests-log">
              <h4 className="text-xs font-bold text-slate-800 dark:text-white mb-3">Submitted Requests ({additionalRequests.length})</h4>
              <div className="space-y-2">
                {additionalRequests.map((req, i) => (
                  <div key={i} className="p-2.5 border border-slate-100 dark:border-slate-800 rounded-lg flex justify-between items-center text-xs">
                    <div>
                      <p className="font-bold text-slate-800 dark:text-white">{req.productName}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">Expected: {req.expectedDeliveryDate}</p>
                    </div>
                    <span className="text-[10px] font-mono bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 px-2 py-0.5 rounded border border-amber-100/50">
                      Pending Approval
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Footer Navigation Buttons */}
          <div className="flex justify-between items-center pt-4" id="step3-navigation">
            <button
              onClick={() => setStep(2)}
              className="py-2 px-5 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-850 text-slate-600 dark:text-slate-300 text-xs font-bold rounded-lg transition-colors cursor-pointer"
            >
              Back
            </button>
            <button
              onClick={handleNextToOutcomes}
              className="py-2.5 px-6 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 shadow transition-colors cursor-pointer"
            >
              <span>{t.nextOutcomes}</span>
              <ArrowRight size={13} />
            </button>
          </div>

        </div>
      )}

      {/* STEP 4: VISIT OUTCOMES */}
      {step === 4 && (
        <div className="space-y-6" id="step-4-content">
          
          <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-5 md:p-6 shadow-sm space-y-6" id="outcomes-panel">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white pb-3 border-b border-slate-50 dark:border-slate-850 flex items-center gap-2">
              <TrendingUp size={16} className="text-blue-500" />
              <span>{t.visitOutcomes}</span>
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5" id="outcomes-grid">
              
              {/* Visit Notes textarea */}
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1.5">
                  {t.generalNotesLabel}
                </label>
                <textarea
                  value={generalNotes}
                  onChange={(e) => setGeneralNotes(e.target.value)}
                  placeholder="Record your notes from this visit..."
                  rows={2}
                  className="w-full px-3 py-1.5 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-transparent text-slate-800 dark:text-white outline-none focus:border-blue-500 resize-none"
                />
              </div>

            </div>

            {/* Section: Marketing Requests dynamic list with Add Request button */}
            <div className="border-t border-slate-100 dark:border-slate-800 pt-5 space-y-4" id="outcomes-marketing">
              <div className="flex justify-between items-center" id="marketing-header-row">
                <div>
                  <h4 className="text-sm font-bold text-slate-850 dark:text-white">
                    {t.marketingEventTitle}
                  </h4>
                  <p className="text-[10px] text-slate-400">
                    {t.marketingEventSubtitle}
                  </p>
                </div>
                <button
                  onClick={handleAddMarketingRequest}
                  className="py-1 px-3 bg-slate-50 hover:bg-slate-100 dark:bg-slate-850 dark:hover:bg-slate-850 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800 rounded-lg text-xs font-bold transition-all flex items-center gap-1 cursor-pointer"
                >
                  <Plus size={12} />
                  <span>{t.addRequest}</span>
                </button>
              </div>

              {/* Marketing requests cards list */}
              <div className="space-y-4" id="mr-requests-container">
                {marketingRequests.map((req, i) => (
                  <div 
                    key={req.id} 
                    className="p-4 border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50/20 dark:bg-slate-850/10 relative space-y-4"
                    id={`mr-block-${req.id}`}
                  >
                    <button
                      onClick={() => handleRemoveMarketingRequest(req.id)}
                      className="absolute top-3.5 right-3.5 text-slate-400 hover:text-rose-500 p-1 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-850 cursor-pointer"
                    >
                      <X size={14} />
                    </button>

                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 pt-2" id="mr-fields-grid">
                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">
                          {t.reqType}
                        </label>
                        <select
                          value={req.requestType}
                          onChange={(e) => handleUpdateMarketingRequest(req.id, { requestType: e.target.value as any })}
                          className="w-full px-2.5 py-1.5 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-transparent text-slate-800 dark:text-white outline-none"
                        >
                          <option value="Sponsorship">Sponsorship (رعاية مؤتمر)</option>
                          <option value="Round Table">Round Table Discussion</option>
                          <option value="Stand Alone">Stand Alone Seminar</option>
                          <option value="Symposium">Specialized Symposium</option>
                          <option value="Flyers">Clinical Flyers / Rollups</option>
                          <option value="Other">Other</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">
                          {t.urgency}
                        </label>
                        <select
                          value={req.urgency}
                          onChange={(e) => handleUpdateMarketingRequest(req.id, { urgency: e.target.value as any })}
                          className="w-full px-2.5 py-1.5 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-transparent text-slate-800 dark:text-white outline-none"
                        >
                          <option value="High">High Urgency</option>
                          <option value="Medium">Medium Urgency</option>
                          <option value="Low">Low Urgency</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">
                          {t.estBudget} (USD)
                        </label>
                        <input
                          type="number"
                          placeholder="Amount in USD"
                          value={req.estimatedBudget || ""}
                          onChange={(e) => handleUpdateMarketingRequest(req.id, { estimatedBudget: Number(e.target.value) })}
                          className="w-full px-2.5 py-1.5 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-transparent text-slate-800 dark:text-white outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">
                          {t.eventDate}
                        </label>
                        <input
                          type="date"
                          value={req.plannedDate}
                          onChange={(e) => handleUpdateMarketingRequest(req.id, { plannedDate: e.target.value })}
                          className="w-full px-2.5 py-1.5 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-transparent text-slate-800 dark:text-white outline-none"
                        />
                      </div>

                      <div className="sm:col-span-2 md:col-span-4">
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">
                          {t.eventDesc}
                        </label>
                        <textarea
                          placeholder="Describe target audience and key messaging strategy..."
                          value={req.description}
                          onChange={(e) => handleUpdateMarketingRequest(req.id, { description: e.target.value })}
                          rows={2}
                          className="w-full px-2.5 py-1.5 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-transparent text-slate-800 dark:text-white outline-none resize-none focus:border-blue-500"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Checkcard: Follow-up Required */}
            <div className="border-t border-slate-100 dark:border-slate-800 pt-5 space-y-4" id="outcomes-follow-up">
              <div 
                onClick={() => setFollowUpRequired(!followUpRequired)}
                className={`p-4 border rounded-xl flex items-center justify-between cursor-pointer transition-all ${
                  followUpRequired 
                    ? "border-blue-500 bg-blue-50/10 dark:bg-blue-950/10 shadow-sm" 
                    : "border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-850"
                }`}
              >
                <div className="flex items-center gap-3 select-none">
                  <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${
                    followUpRequired ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 dark:border-slate-700 bg-transparent"
                  }`}>
                    {followUpRequired && <Check size={11} className="stroke-[3]" />}
                  </div>
                  <div>
                    <span className="text-xs font-bold text-slate-850 dark:text-white">{t.followUp}</span>
                    <p className="text-[10px] text-slate-400">Schedule follow-up detailing for a future date</p>
                  </div>
                </div>
                <Calendar size={16} className="text-slate-400" />
              </div>

              {/* Follow up expanded panel */}
              <AnimatePresence>
                {followUpRequired && (
                  <motion.div 
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden space-y-3"
                    id="followup-expanded-fields"
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 border border-slate-100 dark:border-slate-800 rounded-xl bg-slate-50/20" id="follow-up-fields-box">
                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">
                          Follow-up Date
                        </label>
                        <input
                          type="date"
                          value={followUpDate}
                          onChange={(e) => setFollowUpDate(e.target.value)}
                          className="w-full px-3 py-1.5 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-transparent text-slate-800 dark:text-white outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">
                          Detailing Objective
                        </label>
                        <input
                          type="text"
                          value={followUpNotes}
                          onChange={(e) => setFollowUpNotes(e.target.value)}
                          placeholder="Objectives for the next call..."
                          className="w-full px-3 py-1.5 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-transparent text-slate-800 dark:text-white outline-none focus:border-blue-500"
                        />
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* General notes or closing field */}
            <div className="border-t border-slate-100 dark:border-slate-800 pt-5">
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1.5">
                Any additional notes for this visit...
              </label>
              <textarea
                value={additionalNotes}
                onChange={(e) => setAdditionalNotes(e.target.value)}
                placeholder="Additional notes about products, samples or next steps..."
                rows={2}
                className="w-full px-3 py-1.5 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-transparent text-slate-800 dark:text-white outline-none focus:border-blue-500 resize-none"
              />
            </div>

          </div>

          {/* Footer Navigation Buttons */}
          <div className="flex justify-between items-center pt-4" id="step4-navigation">
            <button
              onClick={() => setStep(3)}
              className="py-2 px-5 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-850 text-slate-600 dark:text-slate-300 text-xs font-bold rounded-lg transition-colors cursor-pointer"
            >
              Back
            </button>
            <button
              onClick={handleCompleteVisit}
              disabled={isSubmitting || completionState.status === "PENDING_SYNC"}
              className="py-2.5 px-6 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed text-white text-xs font-bold rounded-lg flex items-center gap-1.5 shadow transition-colors cursor-pointer"
              id="btn-complete-physician-visit"
            >
              {isSubmitting ? <Clock size={14} className="animate-spin" /> : <Check size={14} />}
              <span>{isSubmitting ? (isRtl ? "جارٍ حفظ الزيارة..." : "Saving Visit...") : t.completeVisit}</span>
            </button>
          </div>

          {completionState.status === "ERROR" && (
            <div id="physician-visit-save-error" role="alert" className="p-3 rounded-lg border border-rose-200 bg-rose-50 dark:bg-rose-950/20 text-xs text-rose-700 dark:text-rose-300">
              <p className="font-bold">{isRtl ? "تعذر حفظ الزيارة" : "Visit was not saved"}</p>
              <p className="mt-1">{completionState.message}</p>
              <p className="mt-1 font-semibold">{isRtl ? "تم الاحتفاظ بجميع البيانات. حاول الإكمال مرة أخرى." : "All visit entries are preserved. Retry Complete Visit when ready."}</p>
            </div>
          )}

          {completionState.status === "PENDING_SYNC" && (
            <div id="physician-visit-pending-sync" role="status" className="p-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 text-xs text-amber-800 dark:text-amber-300">
              <p className="font-bold">{isRtl ? "الزيارة بانتظار المزامنة" : "Visit Pending Sync"}</p>
              <p className="mt-1">{isRtl ? "لم يتم تأكيد الحفظ السحابي بعد. تم الاحتفاظ بالنموذج وستقوم آلية المزامنة الحالية بإعادة المحاولة تلقائياً." : "Cloud completion has not been confirmed. The form is preserved and the existing offline engine will retry automatically."}</p>
              <p className="mt-1 font-mono text-[10px]">{completionState.queueItemId}</p>
            </div>
          )}

        </div>
      )}

      {/* OVERLAY MOCK BROCHURE MODAL WITH TRACKING */}
      <AnimatePresence>
        {activeBrochure && (
          <DetailingViewerModal
            activeBrochure={activeBrochure}
            selectedPhysician={selectedPhysician}
            visitId={draftVisitId}
            resourceContextId={resourceVisitContextId}
            visitStage={getVisitStageFromStep(step)}
            onReady={() => recordPresentedMaterial(activeBrochure.detailingBlockId, activeBrochure.materialId || `mat-${activeBrochure.productId || "unlinked-product"}`)}
            onClose={() => setActiveBrochure(null)}
          />
        )}
      </AnimatePresence>

    </div>
  );
}

function getVisitStageFromStep(stepNumber: number): VisitStage {
  switch (stepNumber) {
    case 1:
      return "VISIT_SETUP";
    case 2:
      return "PRODUCT_DETAILING";
    case 3:
      return "SAMPLES";
    case 4:
      return "VISIT_SUMMARY";
    default:
      return "PRODUCT_DETAILING";
  }
}

interface ActiveBrochureState {
  detailingBlockId: string;
  brand: string;
  productName: string;
  productId?: string;
  promotionGroupId?: string;
  materialId?: string;
  materialName?: string;
  mimeType?: string;
  fileName?: string;
  originalFileName?: string;
  fileSizeBytes?: number;
  fileExtension?: string;
}

interface DetailingViewerModalProps {
  activeBrochure: ActiveBrochureState;
  selectedPhysician: Physician | null;
  visitId: string;
  resourceContextId: string;
  visitStage: VisitStage;
  onReady: () => void;
  onClose: () => void;
}

function DetailingViewerModal({
  activeBrochure,
  selectedPhysician,
  visitId,
  resourceContextId,
  visitStage,
  onReady,
  onClose,
}: DetailingViewerModalProps) {
  const sessionRef = useRef<DetailingMaterialUsageSession | null>(null);
  const [sessionTime, setSessionTime] = useState(0);
  const [resolvedUrl, setResolvedUrl] = useState("");
  const [resolvedMimeType, setResolvedMimeType] = useState("");
  const [binaryLoading, setBinaryLoading] = useState(true);
  const [binaryError, setBinaryError] = useState("");
  const [hotspots, setHotspots] = useState<HotspotDefinition[]>([]);
  const [activeHotspot, setActiveHotspot] = useState<HotspotDefinition | null>(null);
  const [hotspotError, setHotspotError] = useState("");
  const onReadyRef = useRef(onReady);
  const presentationReadyRef = useRef<() => void>(() => {});

  useEffect(() => { onReadyRef.current = onReady; }, [onReady]);

  useEffect(() => {
    let cancelled = false;
    let cleanup = () => {};
    setResolvedUrl("");
    setResolvedMimeType("");
    setBinaryError("");
    setBinaryLoading(true);
    presentationReadyRef.current = () => {};
    void resolveResourceBinary({ ...activeBrochure, resourceId: activeBrochure.materialId, readContext: { purpose: "PHYSICIAN_VISIT", contextId: resourceContextId, productId: activeBrochure.productId || "" } }).then(resolved => {
      if (cancelled) {
        resolved.cleanup();
        return;
      }
      cleanup = resolved.cleanup;
      presentationReadyRef.current = createPresentationReadyGate(() => { if (!cancelled) onReadyRef.current(); });
      setResolvedUrl(resolved.url);
      setResolvedMimeType(resolved.mimeType);
      setBinaryLoading(false);
      void fetchActiveResourceHotspots(activeBrochure.materialId || "", { purpose: "PHYSICIAN_VISIT", contextId: resourceContextId, productId: activeBrochure.productId || "" }).then(result => { if (!cancelled) setHotspots(result.hotspots as HotspotDefinition[]); }).catch(() => { if (!cancelled) setHotspotError("Hotspots are temporarily unavailable."); });
    }).catch(error => {
      console.error("Physician Visit material retrieval failed:", error);
      if (!cancelled) {
        setBinaryError("Unable to load this approved material. Check your connection or access and try again.");
        setBinaryLoading(false);
      }
    });
    return () => {
      cancelled = true;
      presentationReadyRef.current = () => {};
      cleanup();
    };
  }, [activeBrochure.materialId, activeBrochure.productId, resourceContextId]);

  useEffect(() => {
    const timer = setInterval(() => {
      setSessionTime(t => t + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!resolvedUrl) return;
    let isMounted = true;

    const initSession = async () => {
      const session = await openDetailingMaterialSession({
        visitId: visitId || "",
        physicianId: selectedPhysician?.id || "",
        productId: activeBrochure.productId || "",
        promotionGroupId: activeBrochure.promotionGroupId,
        materialId: activeBrochure.materialId || `mat-${activeBrochure.productId || "unlinked-product"}`,
        materialName: activeBrochure.materialName || `${activeBrochure.productName} Material`,
        visitStage: visitStage || "PRODUCT_DETAILING",
        initialPage: 1,
        totalPages: 1,
      });
      if (isMounted) {
        sessionRef.current = session;
      } else {
        session?.closeSession({
          lastPageViewed: 1,
          totalPages: 1,
          closeReason: "COMPONENT_UNMOUNT",
        });
      }
    };

    initSession();

    const handleUnload = () => {
      sessionRef.current?.closeSession({
        lastPageViewed: 1,
        totalPages: 1,
        closeReason: "PAGE_HIDE",
      });
    };

    window.addEventListener("beforeunload", handleUnload);
    window.addEventListener("pagehide", handleUnload);

    return () => {
      isMounted = false;
      window.removeEventListener("beforeunload", handleUnload);
      window.removeEventListener("pagehide", handleUnload);
      sessionRef.current?.closeSession({
        lastPageViewed: 1,
        totalPages: 1,
        closeReason: "COMPONENT_UNMOUNT",
      });
    };
  }, [activeBrochure.materialId, activeBrochure.productId, resolvedUrl, visitStage]);

  const handleClose = async (reason: CloseReason) => {
    if (sessionRef.current) {
      await sessionRef.current.closeSession({
        lastPageViewed: 1,
        totalPages: 1,
        closeReason: reason,
      });
    }
    onClose();
  };
  const activateHotspot = (hotspot: HotspotDefinition) => {
    setActiveHotspot(hotspot); setHotspotError("");
    void recordResourceHotspotInteraction(activeBrochure.materialId || "", hotspot.hotspotId, { contextId: resourceContextId, productId: activeBrochure.productId || "", ...(sessionRef.current?.usageDocId && sessionRef.current.usageDocId !== "NOOP_SESSION" ? { usageSessionId: sessionRef.current.usageDocId } : {}) }).catch(() => setHotspotError("The message opened, but its interaction could not be recorded."));
  };

  const isPdf = resolvedMimeType === "application/pdf" || activeBrochure.mimeType === "application/pdf" ||
    (activeBrochure.fileName && activeBrochure.fileName.toLowerCase().endsWith(".pdf")) ||
    (activeBrochure.fileExtension && activeBrochure.fileExtension.toLowerCase() === "pdf");

  const isImage = resolvedMimeType.startsWith("image/") || activeBrochure.mimeType?.startsWith("image/") ||
    ["png", "jpg", "jpeg", "webp", "gif"].includes(activeBrochure.fileExtension?.toLowerCase() || "");

  const isVideo = resolvedMimeType.startsWith("video/") || activeBrochure.mimeType?.startsWith("video/") ||
    ["mp4", "webm", "ogg"].includes(activeBrochure.fileExtension?.toLowerCase() || "");

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 z-50 animate-fade-in" id="brochure-modal-overlay">
      <motion.div 
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        className="bg-slate-900 text-white max-w-6xl w-full rounded-2xl overflow-hidden shadow-2xl relative border border-slate-800 flex flex-col max-h-[92vh]"
        id="brochure-modal-card"
      >
        {/* Modal Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950 shrink-0">
          <div className="flex items-center gap-3 min-w-0 pr-4">
            <div className="bg-indigo-600/20 text-indigo-400 p-2 rounded-lg border border-indigo-500/30 shrink-0">
              <FileText size={18} />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-white truncate">
                {activeBrochure.materialName || activeBrochure.fileName || `${activeBrochure.productName} Detailing Material`}
              </h3>
              <p className="text-xxs text-slate-400 font-mono flex items-center gap-2 flex-wrap">
                <span>Product: {activeBrochure.productName}</span>
                {activeBrochure.fileName && <span>• File: {activeBrochure.fileName}</span>}
                {activeBrochure.fileSizeBytes ? <span>• Size: {formatFileSize(activeBrochure.fileSizeBytes)}</span> : null}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {resolvedUrl && (
              <a
                href={resolvedUrl}
                target="_blank"
                rel="noreferrer"
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-lg flex items-center gap-1.5 transition-colors"
              >
                <ExternalLink size={13} />
                <span className="hidden sm:inline">Open File</span>
              </a>
            )}
            <button
              onClick={() => handleClose("CLOSE_ICON")}
              className="text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 p-2 rounded-lg transition-colors cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Modal Main Grid */}
        <div className="grid grid-cols-1 md:grid-cols-12 flex-1 overflow-hidden" id="brochure-modal-grid">
          
          {/* Left Visual Aid Area */}
          <div className="md:col-span-8 bg-slate-950 p-4 flex flex-col justify-between relative overflow-hidden border-r border-slate-800 h-full min-h-[480px]" id="brochure-visual">
            {binaryLoading ? (
              <div className="flex h-full w-full items-center justify-center gap-2 text-sm font-semibold text-slate-300">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
                Loading approved material…
              </div>
            ) : binaryError ? (
              <div role="alert" className="flex h-full w-full items-center justify-center px-8 text-center text-sm font-semibold text-rose-300">{binaryError}</div>
            ) : resolvedUrl ? (
              <div className="w-full h-full flex flex-col justify-center items-center overflow-hidden">
                {isVideo ? (
                  <video 
                    src={resolvedUrl}
                    controls 
                    onCanPlay={() => presentationReadyRef.current()}
                    onError={() => setBinaryError("Unable to play this approved video.")}
                    className="max-h-[560px] max-w-full rounded-lg shadow-xl mx-auto" 
                  />
                ) : isPdf || isImage ? (
                  <ControlledResourcePage url={resolvedUrl} mimeType={resolvedMimeType || activeBrochure.mimeType || ""} alt={activeBrochure.fileName || activeBrochure.materialName || "Detailing material"} hotspots={hotspots} onHotspotActivate={activateHotspot} onPageChange={(page, total) => sessionRef.current?.updatePage(page, total)} onReady={() => presentationReadyRef.current()} />
                ) : (
                  <div className="max-w-md space-y-4 rounded-xl border border-slate-700 bg-slate-900 p-8 text-center">
                    <FileText size={36} className="mx-auto text-indigo-400" />
                    <div>
                      <h4 className="text-sm font-bold text-white">Browser preview is not available for this document format.</h4>
                      <p className="mt-2 text-xs leading-relaxed text-slate-400">The authenticated file can be securely downloaded and opened with a compatible application. Downloading it does not record a presentation.</p>
                    </div>
                    <a href={resolvedUrl} download={activeBrochure.originalFileName || activeBrochure.fileName || "resource-document"} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-700"><Download size={14} />Secure Download</a>
                  </div>
                )}
              </div>
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center space-y-4 my-auto">
                <div className="p-4 bg-amber-500/10 text-amber-400 rounded-2xl border border-amber-500/20">
                  <FileText size={40} />
                </div>
                <div className="max-w-md space-y-2">
                  <h4 className="text-base font-bold text-white">No Digital Document File Available</h4>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    There is currently no digital PDF or visual aid document linked to <span className="text-indigo-400 font-semibold">{activeBrochure.productName}</span> in Firebase Storage.
                  </p>
                  <p className="text-xxs text-slate-500 font-mono pt-1">
                    Please upload the official brochure document in the Resource Center to present it during physician detailing sessions.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Right Specifications & Session Panel */}
          <div className="md:col-span-4 bg-slate-900 p-6 flex flex-col justify-between h-full overflow-y-auto" id="brochure-specs">
            <div className="space-y-6">
              {activeHotspot && <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4"><p className="text-[10px] font-bold uppercase text-amber-300">Important message</p><p className="mt-1 text-sm font-bold text-white">{activeHotspot.hotspotName}</p>{activeHotspot.description && <p className="mt-1 text-xs text-slate-300">{activeHotspot.description}</p>}</div>}
              {hotspotError && <div role="alert" className="rounded bg-rose-950/50 p-2 text-xs text-rose-300">{hotspotError}</div>}
              
              {/* Session Live Timer Badge */}
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-1">
                <div className="flex items-center justify-between text-xxs font-mono text-slate-400 uppercase tracking-wider">
                  <span>Detailing Duration</span>
                  <span className="flex items-center gap-1 text-emerald-400 font-bold">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    Active
                  </span>
                </div>
                <p className="text-2xl font-black font-mono text-white tracking-tight">{formatTime(sessionTime)}</p>
                {selectedPhysician && (
                  <p className="text-xs text-slate-400 truncate pt-1">
                    Physician: <span className="font-bold text-slate-200">{selectedPhysician.name}</span>
                  </p>
                )}
              </div>

              {/* Specifications List */}
              <div className="space-y-4">
                <h4 className="text-xxs font-bold text-slate-400 uppercase tracking-wider font-mono">
                  Material Details
                </h4>
                
                <div className="space-y-3 text-xs" id="specs-list">
                  <div>
                    <p className="text-slate-500 text-[10px] uppercase font-bold font-mono">Target Product</p>
                    <p className="font-bold text-white mt-0.5">{activeBrochure.productName}</p>
                  </div>

                  <div>
                    <p className="text-slate-500 text-[10px] uppercase font-bold font-mono">Brand Family</p>
                    <p className="font-bold text-white mt-0.5">{activeBrochure.brand}</p>
                  </div>

                  {activeBrochure.promotionGroupId && (
                    <div>
                      <p className="text-slate-500 text-[10px] uppercase font-bold font-mono">Promotion Group ID</p>
                      <p className="font-bold text-blue-400 mt-0.5 font-mono text-[11px]">{activeBrochure.promotionGroupId}</p>
                    </div>
                  )}

                  {activeBrochure.fileName && (
                    <div>
                      <p className="text-slate-500 text-[10px] uppercase font-bold font-mono">File Name</p>
                      <p className="font-bold text-slate-200 mt-0.5 font-mono text-[11px] break-all">{activeBrochure.fileName}</p>
                    </div>
                  )}

                  <div>
                    <p className="text-slate-500 text-[10px] uppercase font-bold font-mono">Format & Size</p>
                    <p className="font-bold text-slate-300 mt-0.5 font-mono text-[11px]">
                      {(activeBrochure.fileExtension || "PDF").toUpperCase()} • {activeBrochure.fileSizeBytes ? formatFileSize(activeBrochure.fileSizeBytes) : "Attached"}
                    </p>
                  </div>
                </div>
              </div>

            </div>

            {/* Modal Actions */}
            <div className="pt-6 border-t border-slate-800 space-y-2 mt-6" id="brochure-actions">
              <button
                onClick={() => handleClose("DISMISS_BUTTON")}
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer shadow-md flex items-center justify-center gap-2"
              >
                <span>Complete Detailing Session</span>
              </button>
            </div>

          </div>

        </div>
      </motion.div>
    </div>
  );
}
