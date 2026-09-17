import { Role, User, Pharmacy, Product, UserTerritoryAssignment, UserProductAssignment } from "../../../types";
import type { ProductAvailability } from "./productAvailability";
import type { OfferDraftIntent } from "../services/canonicalOfferVisit";

export type PharmacyVisitStatus = 
  | "NEW"
  | "DRAFT"
  | "CHECKED_IN"
  | "IN_PROGRESS"
  | "REVIEW_READY"
  | "COMPLETING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "EXPIRED";

export type PharmacyVisitStep = 1 | 2 | 3 | 4 | 5 | 6;

export type PharmacyVisitEntrySource = 
  | "PHARMACY_LIST"
  | "PHARMACY_PROFILE"
  | "SALES_PLANNER"
  | "DIRECT_MENU"
  | "DIRECT_URL";

export interface PharmacyVisitGps {
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  accuracyMeters?: number | null;
  timestamp: string | null;
  capturedAt?: string | null;
  source: "device" | "simulation_demo" | null;
  spoofCheckStatus?: "Passed" | "Suspicious" | "Bypassed (Demo)" | null;
  pharmacyLatitude?: number | null;
  pharmacyLongitude?: number | null;
  warningType?: string;
  captureAccepted?: boolean;
  status: 
    | "NOT_ACQUIRED"
    | "NOT_REQUESTED"
    | "REQUESTING"
    | "ACQUIRING"
    | "VERIFIED"
    | "PERMISSION_DENIED"
    | "POSITION_UNAVAILABLE"
    | "TIMEOUT"
    | "INVALID_PHARMACY_COORDINATES"
    | "ERROR";
  errorCode?: string | null;
  errorMessage?: string | null;
  failureReason?: string | null;
}

export function createInitialGpsState(): PharmacyVisitGps {
  return {
    status: "NOT_ACQUIRED",
    latitude: null,
    longitude: null,
    accuracy: null,
    accuracyMeters: null,
    timestamp: null,
    capturedAt: null,
    source: null,
    errorCode: null,
    errorMessage: null
  };
}

export function normalizeDraftGps(draft: PharmacyVisitDraft): PharmacyVisitDraft {
  if (!draft || !draft.gps) {
    return {
      ...draft,
      gps: createInitialGpsState()
    };
  }

  const gps = draft.gps;

  // Check legacy/demo/uncaptured flags
  const isDemoSource = gps.source === "simulation_demo" || gps.source === ("SIMULATION_DEMO" as any) || gps.source === ("simulation" as any);
  const isDefaultDemoCoords = (gps.latitude === 32.8872 || gps.latitude === 32.88720) && (gps.longitude === 13.1913 || gps.longitude === 13.19130);
  const isMissingTimestamp = !gps.timestamp && !gps.capturedAt;
  const isNotAcquiredStatus = gps.status === "NOT_ACQUIRED" || !gps.status;

  if (isDemoSource || isDefaultDemoCoords || isMissingTimestamp || isNotAcquiredStatus) {
    return {
      ...draft,
      gps: createInitialGpsState()
    };
  }

  return draft;
}

export interface PharmacyVisitPurpose {
  code: string;
  labelEn: string;
  labelAr: string;
  allowsOrder?: boolean;
  requiresGps?: boolean;
}

export interface PharmacyVisitEntryContext {
  pharmacyId?: string;
  plannerId?: string;
  draftId?: string;
  entrySource: PharmacyVisitEntrySource;
}

export interface PharmacyVisitDraft {
  schemaVersion: "2.0";
  draftId: string;
  repUid: string;
  companyId: string;
  countryId: string;
  currencyCode?: string;
  currencySymbol?: string;
  areaId: string;
  pharmacyId?: string;
  pharmacySnapshot?: {
    id: string;
    nameEn: string;
    nameAr?: string;
    type: string;
    areaId: string;
    countryId?: string;
    marketId?: string;
    currencyCode?: string;
    address?: string;
    outstandingBalance?: number;
  };
  plannerId?: string;
  entrySource: PharmacyVisitEntrySource;
  status: PharmacyVisitStatus;
  currentStep: PharmacyVisitStep;
  visitPurpose?: PharmacyVisitPurpose;
  primaryVisitPurposeCode?: string;
  additionalVisitPurposeCodes?: string[];
  additionalVisitPurposes?: PharmacyVisitPurpose[];
  gps?: PharmacyVisitGps;
  order?: PharmacyVisitOrder;
  offers?: PharmacyVisitOffersState;
  /** Phase 4 persists selection intent only; definitions and preview totals are reloaded. */
  offerIntent?: OfferDraftIntent[];
  payment?: PharmacyVisitPaymentState;
  stock?: PharmacyVisitStockState;
  createdAt: string;
  updatedAt: string;
  deviceSessionId: string;
  localRevision: number;
  cloudRevision?: number;
  completedVisitId?: string;
  completedDisplayNumber?: string;
  completedOrderId?: string;
  completedOrderDisplayNumber?: string;
  completedAt?: string;
}

export interface PharmacyVisitDraftConflict {
  localDraft: PharmacyVisitDraft;
  remoteDraft?: PharmacyVisitDraft;
  type: "DEVICE_LOCAL_EXISTS" | "CLOUD_REVISION_MISMATCH";
}

export interface PharmacyVisitValidationResult {
  isValid: boolean;
  errors: Array<{
    field: string;
    messageEn: string;
    messageAr: string;
  }>;
}

export type PharmacyOrderInputSource = "MANUAL" | "AI_TEXT" | "IMAGE";

export interface PharmacyOrderLine {
  id: string;
  canonicalProductId: string;
  canonicalSkuId?: string;
  productCode: string;
  productNameSnapshot: string;
  productArabicNameSnapshot?: string;
  packStrengthSnapshot?: string;
  quantity: number;
  unitPricePreview: number;
  lineTotalPreview: number;
  currency: string;
  inputSource: PharmacyOrderInputSource;
  originalRawInput?: string;
  confidence?: number;
  userConfirmed: boolean;
  userCorrected: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProductResolutionCandidate {
  productId: string;
  skuId?: string;
  code: string;
  nameEn: string;
  nameAr?: string;
  pack?: string;
  strength?: string;
  unitPrice: number;
  matchType: "EXACT_CODE" | "EXACT_SKU" | "EXACT_NAME" | "FUZZY_NAME" | "ALIAS";
  score: number;
}

export interface AiOrderParsedLine {
  id: string;
  originalText: string;
  detectedCode?: string;
  detectedName?: string;
  detectedPack?: string;
  detectedQuantity: number;
  proposedProductId?: string;
  proposedSkuId?: string;
  proposedProductCode?: string;
  proposedProductName?: string;
  proposedPack?: string;
  unitPrice?: number;
  confidence: number;
  status: 
    | "MATCHED" 
    | "NEEDS_CONFIRMATION" 
    | "AMBIGUOUS" 
    | "UNRESOLVED" 
    | "REJECTED_UNASSIGNED" 
    | "REJECTED_INACTIVE" 
    | "REJECTED_UNAVAILABLE";
  candidates?: ProductResolutionCandidate[];
  userAction?: "CONFIRMED" | "EDITED" | "REJECTED";
  rejectionReason?: string;
}

export interface AiOrderParseResult {
  rawInput: string;
  parsedLines: AiOrderParsedLine[];
  overallConfidence: number;
  parsedAt: string;
}

export interface OrderImageAttachment {
  id: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
  storagePath?: string;
  previewUrl?: string;
  uploadedAt: string;
}

export interface OrderImageExtractionResult {
  attachmentId: string;
  status: "SUCCESS" | "PARTIAL" | "AMBIGUOUS" | "ERROR" | "TIMEOUT";
  rawTextExtracted?: string;
  extractedLines: AiOrderParsedLine[];
  extractionType: "PRINTED" | "HANDWRITTEN" | "MIXED";
  extractedAt: string;
  errorMessage?: string;
}

export interface OrderLineValidationResult {
  isValid: boolean;
  errors: string[];
}

export interface PharmacyVisitOrder {
  lines: PharmacyOrderLine[];
  productAvailability?: ProductAvailability[];
  inputSource?: PharmacyOrderInputSource;
  imageAttachments?: OrderImageAttachment[];
  extractionResults?: OrderImageExtractionResult[];
  lastParseResult?: AiOrderParseResult;
  subtotalPreview: number;
  currency: string;
  updatedAt: string;
}

// -------------------------------------------------------------
// WP6.1E: OFFER & DISCOUNT DOMAIN MODELS
// -------------------------------------------------------------

export type PharmacyOfferType = 
  | "PERCENTAGE_DISCOUNT"
  | "FIXED_DISCOUNT"
  | "BUY_X_GET_Y"
  | "BONUS_QUANTITY"
  | "FREE_PRODUCT"
  | "ORDER_VALUE_DISCOUNT"
  | "TIERED_DISCOUNT";

export interface PharmacyOfferEligibilityRule {
  minQuantity?: number;
  minOrderValue?: number;
  productId?: string;
  productCode?: string;
  skuId?: string;
  promotionGroupId?: string;
  countryId?: string;
  areaId?: string;
  pharmacyId?: string;
  pharmacyType?: string;
}

export interface PharmacyOffer {
  id: string;
  code: string;
  name: string;
  nameAr?: string;
  description?: string;
  productId?: string;
  productCode?: string;
  type: PharmacyOfferType;
  value: string | number;
  percentage?: number;
  fixedAmount?: number;
  buyQuantity?: number;
  getQuantity?: number;
  freeProductId?: string;
  freeProductCode?: string;
  freeProductName?: string;
  bonusQuantity?: number;
  rules?: PharmacyOfferEligibilityRule;
  startDate: string;
  endDate: string;
  isActive: boolean;
  isExclusive?: boolean;
  priority?: number;
  autoApply?: boolean;
  requiresConfirmation?: boolean;
  companyId?: string;
}

export type OfferIneligibilityReason = 
  | "OUTSIDE_DATE_RANGE"
  | "PRODUCT_NOT_ELIGIBLE"
  | "SKU_NOT_ELIGIBLE"
  | "PROMOTION_GROUP_NOT_ELIGIBLE"
  | "QUANTITY_THRESHOLD_NOT_MET"
  | "ORDER_VALUE_THRESHOLD_NOT_MET"
  | "PHARMACY_NOT_ELIGIBLE"
  | "AREA_NOT_ELIGIBLE"
  | "COUNTRY_NOT_ELIGIBLE"
  | "EXCLUSIVE_OFFER_CONFLICT"
  | "OFFER_INACTIVE"
  | "OFFER_DELETED"
  | "OFFER_LIMIT_EXHAUSTED";

export interface PharmacyOfferEligibilityResult {
  offer: PharmacyOffer;
  isEligible: boolean;
  rejectionReason?: OfferIneligibilityReason;
  missingQuantityToThreshold?: number;
  missingValueToThreshold?: number;
  previewDiscountAmount?: number;
  previewBonusQuantity?: number;
  previewBonusProductName?: string;
  appliedLines?: string[]; // Line IDs matching the offer
}

export interface OfferDiscountLine {
  offerId: string;
  offerCode: string;
  offerName: string;
  targetLineId?: string;
  targetProductId?: string;
  discountType: PharmacyOfferType;
  discountAmount: number;
  currency: string;
}

export interface OfferBonusLine {
  id: string;
  offerId: string;
  offerCode: string;
  offerName: string;
  productId: string;
  productCode?: string;
  productName: string;
  bonusQuantity: number;
  unitPricePreview: 0; // Bonus item price is always 0
  currency: string;
}

export interface OfferConflict {
  offerIdA: string;
  offerNameA: string;
  offerIdB: string;
  offerNameB: string;
  conflictReason: "EXCLUSIVE_OFFER_OVERLAP" | "SAME_PRODUCT_EXCLUSIVITY";
  resolvedOfferId?: string;
}

export interface AppliedOfferSnapshot {
  offerId: string;
  offerCode: string;
  offerNameSnapshot: string;
  version: string;
  type: PharmacyOfferType;
  discountAmountPreview: number;
  bonusLinesPreview: OfferBonusLine[];
  currency: string;
  isAutoApplied: boolean;
  isUserConfirmed: boolean;
  backendRevalidationRequired: true;
  appliedAt: string;
}

export interface OfferCalculationResult {
  grossSubtotal: number;
  totalDiscountAmount: number;
  netTotal: number;
  currency: string;
  discountLines: OfferDiscountLine[];
  bonusLines: OfferBonusLine[];
  calculationTimestamp: string;
}

export interface PharmacyVisitOffersState {
  eligibleOffers: PharmacyOfferEligibilityResult[];
  ineligibleOffers: PharmacyOfferEligibilityResult[];
  appliedOffers: AppliedOfferSnapshot[];
  conflicts: OfferConflict[];
  calculation: OfferCalculationResult;
  lastEvaluatedAt: string;
  isStale?: boolean;
}

export interface Step3ValidationResult {
  isValid: boolean;
  errors: string[];
}

export type PharmacyPaymentMethod = "CASH" | "CHEQUE" | "BANK_TRANSFER" | "OTHER";
export type PharmacyFinancialSourceStatus = "LIVE" | "PARTIAL" | "UNAVAILABLE";

export interface PharmacyAgingBucket {
  bucketLabel: "Current" | "1-30 Days" | "31-60 Days" | "61-90 Days" | "90+ Days";
  amount: number;
}

export interface PharmacyFinancialContext {
  pharmacyId: string;
  currency: string;
  outstandingBalanceBefore: number;
  currentVisitGrossTotal: number;
  currentVisitDiscountTotal: number;
  currentVisitNetTotal: number;
  openReceivableTotal: number | null;
  creditLimit: number | null;
  availableCredit: number | null;
  paymentTermDays: number | null;
  overdueAmount: number | null;
  agingBuckets: PharmacyAgingBucket[] | null;
  source: string;
  sourceStatus: PharmacyFinancialSourceStatus;
  mockFallbackUsed: false;
  backendRevalidationRequired: true;
}

export interface PharmacyPaymentEvidence {
  attachmentId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  previewUrl?: string;
  uploadStatus: "PENDING" | "UPLOADING" | "SUCCESS" | "ERROR";
  storageRef?: string;
  createdAt: string;
}

export interface PharmacyPaymentEntry {
  paymentId: string;
  method: PharmacyPaymentMethod;
  amount: number;
  currency: string;
  notes?: string;
  chequeNumber?: string;
  chequeDate?: string;
  issuingBank?: string;
  bankReferenceNumber?: string;
  transferDate?: string;
  otherMethodDescription?: string;
  evidences: PharmacyPaymentEvidence[];
  enteredAt: string;
  enteredBy: string;
  userConfirmed: boolean;
  source: "DRAFT";
  backendRevalidationRequired: true;
}

export interface PharmacyBalancePreview {
  outstandingBalanceBefore: number;
  currentVisitNetTotal: number;
  paymentAmount: number;
  projectedBalanceAfter: number;
  currency: string;
  formula: string;
  isOverpayment: boolean;
  overpaymentAmount?: number;
  backendRevalidationRequired: true;
}

export interface PharmacyVisitPaymentState {
  financialContext?: PharmacyFinancialContext;
  paymentEntry?: PharmacyPaymentEntry;
  balancePreview?: PharmacyBalancePreview;
  lastEvaluatedAt?: string;
  isStale?: boolean;
}

export interface Step4ValidationResult {
  isValid: boolean;
  errors: string[];
}

// -------------------------------------------------------------
// WP6.1G: STOCK REQUESTS, OBSERVATIONS, COMPETITIVE INTELLIGENCE, CRM NOTES & FOLLOW-UP DOMAIN MODELS
// -------------------------------------------------------------

export type PharmacyStockLevel = 
  | "OVERSTOCKED" 
  | "ADEQUATE" 
  | "LOW" 
  | "OUT_OF_STOCK" 
  | "NOT_CHECKED";

export type PharmacyStockPriority = 
  | "NORMAL" 
  | "URGENT" 
  | "ROUTINE" 
  | "IMPORTANT" 
  | "CRITICAL";

export type PharmacyStockRequestReason = 
  | "SHELF_OUT_OF_STOCK" 
  | "LOW_STOCK" 
  | "EXPECTED_DEMAND" 
  | "PROMOTION_SUPPORT" 
  | "NEW_PRODUCT_LAUNCH" 
  | "CUSTOMER_REQUEST" 
  | "BUFFER_STOCK" 
  | "OTHER";

export type PharmacyRelationshipQuality = 
  | "EXCELLENT" 
  | "GOOD" 
  | "NEUTRAL" 
  | "NEEDS_ATTENTION" 
  | "AT_RISK" 
  | "NOT_ASSESSED";

export interface PharmacyStockRequestLine {
  draftLineId: string;
  canonicalProductId: string;
  canonicalSkuId?: string;
  productCode: string;
  productNameSnapshot: string;
  productArabicNameSnapshot?: string;
  packSnapshot?: string;
  observedQuantity?: number;
  targetQuantity?: number;
  requestedQuantity: number;
  approvedOrderQty?: number;
  warehouseAvailableQty?: number | null;
  unfulfilledQty?: number;
  source?: "AUTO_ORDER_SHORTAGE" | "REP_OBSERVED_DEMAND" | "CONFIRMED_ZERO_STOCK" | string;
  status?: "PENDING_INVENTORY_VALIDATION" | "CONFIRMED_SHORTAGE" | "FULFILLED" | string;
  stockLevel?: PharmacyStockLevel;
  priority: PharmacyStockPriority;
  reason: PharmacyStockRequestReason;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  userConfirmed: boolean;
  backendRevalidationRequired: true;
}

export interface PharmacyStockObservation {
  scope: "PHARMACY" | "PRODUCT" | "BOTH";
  overallStockLevel: PharmacyStockLevel;
  notes?: string;
}

export interface PharmacyCompetitorBrandObservation {
  id: string;
  brandName: string;
  companyName?: string;
  categoryOrProduct?: string;
  notes?: string;
}

export interface PharmacyCompetitorPriceObservation {
  id: string;
  brandOrProduct: string;
  observedPrice: number;
  currency: string;
  pack?: string;
  observedDate: string;
  priceSource?: string;
  notes?: string;
}

export interface PharmacyCompetitorPromotionObservation {
  id: string;
  brandOrProduct: string;
  description: string;
  discountPercent?: number;
  bonusDescription?: string;
  displaySupport?: string;
  validityNotes?: string;
  notes?: string;
}

export interface PharmacyShelfSpaceObservation {
  menarepsSharePercent?: number;
  competitorSharePercent?: number;
  placementQuality?: "PRIME" | "EYE_LEVEL" | "LOWER_SHELF" | "POOR";
  visibilityNotes?: string;
  notes?: string;
}

export interface PharmacyMarketTrendObservation {
  demandChange?: "INCREASING" | "STABLE" | "DECREASING";
  customerPreferenceNotes?: string;
  availabilityTrend?: string;
  priceSensitivity?: "HIGH" | "MEDIUM" | "LOW";
  newCompetitorActivity?: string;
  narrativeNotes?: string;
}

export interface PharmacyCompetitiveIntelligence {
  competitorBrands?: PharmacyCompetitorBrandObservation[];
  competitorPricing?: PharmacyCompetitorPriceObservation[];
  competitorPromotions?: PharmacyCompetitorPromotionObservation[];
  shelfSpace?: PharmacyShelfSpaceObservation;
  marketTrends?: PharmacyMarketTrendObservation;
  lastUpdated?: string;
}

export interface PharmacyDecisionMakerInsight {
  id: string;
  contactName?: string;
  role?: string;
  influenceLevel?: "HIGH" | "MEDIUM" | "LOW";
  preferredCommunication?: string;
  interests?: string;
  objections?: string;
  notes?: string;
}

export interface PharmacyCustomerPainPoint {
  id: string;
  category: "PRODUCT_AVAILABILITY" | "PRICE" | "PAYMENT_TERMS" | "DELIVERY_DELAY" | "STOCK_EXPIRY" | "LOW_DEMAND" | "COMPETITIVE_PRESSURE" | "PRODUCT_KNOWLEDGE" | "MARKETING_SUPPORT" | "OTHER";
  description: string;
  severity?: "HIGH" | "MEDIUM" | "LOW";
}

export interface PharmacyNextAction {
  id: string;
  actionType: string;
  description: string;
  ownerRole?: string;
  proposedOwnerUid?: string;
  dueDate?: string;
  priority?: "HIGH" | "MEDIUM" | "LOW";
  notes?: string;
  taskPersistencePending: true;
}

export interface PharmacyCrmNotes {
  relationshipQuality?: PharmacyRelationshipQuality;
  decisionMakerInsights?: PharmacyDecisionMakerInsight[];
  customerPainPoints?: PharmacyCustomerPainPoint[];
  nextActions?: PharmacyNextAction[];
  generalNotes?: string;
}

export interface PharmacyFollowUp {
  required: boolean;
  followUpDate?: string;
  purpose?: string;
  ownerUid?: string;
  ownerRole?: string;
  priority?: "NORMAL" | "URGENT";
  notes?: string;
  taskPersistencePending: true;
}

export interface PharmacyVisitStockState {
  noStockRequestRequired: boolean;
  requestLines: PharmacyStockRequestLine[];
  stockObservation?: PharmacyStockObservation;
  competitiveIntelligence?: PharmacyCompetitiveIntelligence;
  crmNotes?: PharmacyCrmNotes;
  followUp?: PharmacyFollowUp;
  lastEvaluatedAt?: string;
  isStale?: boolean;
}

export interface Step5ValidationResult {
  isValid: boolean;
  errors: string[];
}

export interface Step6ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}
