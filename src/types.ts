/**
 * MENAREPS CRM TypeScript Models & Enums
 */

export enum Role {
  SUPER_ADMIN = "Super Admin",
  ADMIN = "Admin",
  GENERAL_MANAGER = "General Manager",
  REGIONAL_MANAGER = "Regional Manager",
  COUNTRY_MANAGER = "Country Manager",
  AREA_SALES_MANAGER = "Area Sales Manager",
  MEDICAL_SUPERVISOR = "Medical Supervisor",
  SALES_SUPERVISOR = "Sales Supervisor",
  MEDICAL_REP = "Medical Representative",
  SALES_REP = "Sales Representative",
  FINANCE_MANAGER = "Finance Manager",
  FINANCE = "Finance Officer",
  WAREHOUSE_INVENTORY = "Warehouse / Inventory",
  INVENTORY_OFFICER = "Inventory Officer",
  WAREHOUSE_MANAGER = "Warehouse Manager",
  MARKETING = "Marketing",
  MARKETING_OFFICER = "Marketing Officer",
  PRODUCT_MANAGER = "Product Manager",
  DELIVERY_OFFICER = "Delivery Officer",
  ORDER_OPS_OFFICER = "Order Operations Officer",
  SALES_MARKETING_MANAGER = "Sales & Marketing Manager",
  MARKETING_MANAGER = "Marketing Manager",
  MEDICAL_MANAGER = "Medical Manager",
  SALES_MANAGER = "Sales Manager",
  TREASURY_OFFICER = "Treasury Officer",
  STORE_MANAGER = "Store Manager",
  SYSTEM_ADMINISTRATOR = "System Administrator"
}

export const CANONICAL_USER_ROLES: Role[] = [
  Role.SUPER_ADMIN,
  Role.ADMIN,
  Role.GENERAL_MANAGER,
  Role.REGIONAL_MANAGER,
  Role.COUNTRY_MANAGER,
  Role.SALES_MARKETING_MANAGER,
  Role.SALES_MANAGER,
  Role.AREA_SALES_MANAGER,
  Role.SALES_SUPERVISOR,
  Role.SALES_REP,
  Role.MARKETING_MANAGER,
  Role.PRODUCT_MANAGER,
  Role.MARKETING_OFFICER,
  Role.MEDICAL_MANAGER,
  Role.MEDICAL_SUPERVISOR,
  Role.MEDICAL_REP,
  Role.FINANCE_MANAGER,
  Role.FINANCE,
  Role.TREASURY_OFFICER,
  Role.WAREHOUSE_MANAGER,
  Role.INVENTORY_OFFICER,
  Role.STORE_MANAGER,
  Role.DELIVERY_OFFICER,
  Role.ORDER_OPS_OFFICER
];

export function normalizeRole(roleStr: string | null | undefined): Role | string {
  if (!roleStr) return "";
  const trimmed = roleStr.trim();
  const lower = trimmed.toLowerCase().replace(/[\s_\-]/g, "");

  if (lower === "salesrepresentative" || lower === "salesrep" || lower === "sales") {
    return Role.SALES_REP;
  }
  if (lower === "medicalrepresentative" || lower === "medicalrep" || lower === "medrep") {
    return Role.MEDICAL_REP;
  }
  if (lower === "superadmin" || lower === "super_admin") {
    return Role.SUPER_ADMIN;
  }
  if (lower === "admin") {
    return Role.ADMIN;
  }
  if (lower === "generalmanager" || lower === "gm") {
    return Role.GENERAL_MANAGER;
  }
  if (lower === "financeofficer" || lower === "finance") {
    return Role.FINANCE;
  }
  if (lower === "financemanager") {
    return Role.FINANCE_MANAGER;
  }
  if (lower === "storemanager" || lower === "store_manager" || lower === "store" || lower === "warehousemanager" || lower === "warehouse_manager") {
    if (lower.includes("warehouse")) return Role.WAREHOUSE_MANAGER;
    return Role.STORE_MANAGER;
  }
  if (lower === "inventoryofficer" || lower === "inventory") {
    return Role.INVENTORY_OFFICER;
  }
  if (lower === "orderopsofficer" || lower === "orderoperations" || lower === "orderoperationsofficer" || lower === "operations") {
    return Role.ORDER_OPS_OFFICER;
  }
  if (lower === "deliveryofficer" || lower === "delivery") {
    return Role.DELIVERY_OFFICER;
  }
  if (lower === "salessupervisor" || lower === "supervisor") {
    return Role.SALES_SUPERVISOR;
  }
  if (lower === "medicalsupervisor") {
    return Role.MEDICAL_SUPERVISOR;
  }
  if (lower === "areasalesmanager" || lower === "area") {
    return Role.AREA_SALES_MANAGER;
  }
  if (lower === "countrymanager" || lower === "country") {
    return Role.COUNTRY_MANAGER;
  }
  if (lower === "regionalmanager" || lower === "region") {
    return Role.REGIONAL_MANAGER;
  }
  if (lower === "productmanager" || lower === "product") {
    return Role.PRODUCT_MANAGER;
  }
  if (lower === "treasuryofficer") {
    return Role.TREASURY_OFFICER;
  }
  if (lower === "systemadministrator" || lower === "sysadmin") {
    return Role.SYSTEM_ADMINISTRATOR;
  }

  // Exact enum value match check
  for (const r of Object.values(Role)) {
    if (r === trimmed || r.toLowerCase().replace(/[\s_\-]/g, "") === lower) return r;
  }

  return trimmed;
}

export interface Permissions {
  /** Restriction on canonical Collections.reverse authority; never grants baseline access. */
  reverse?: boolean;
  view: boolean;
  create: boolean;
  edit: boolean;
  delete: boolean;
  approve: boolean;
  export: boolean;
  import: boolean;
  assign: boolean;
  reassign: boolean;
  viewTeamData: boolean;
  viewNationalData: boolean;
  viewFinancialData: boolean;
  /** Additive module capabilities loaded from rolePermissions/{role}. */
  sampleCapabilities?: Partial<Record<SampleCapability, boolean>>;
  resourceCapabilities?: { manage?: boolean };
  marketingRequestCapabilities?: {
    supervisorApprove?: boolean;
    supervisorReject?: boolean;
    finalApprove?: boolean;
    finalReject?: boolean;
    execute?: boolean;
  };
  /** Server-authoritative Offer administration capabilities. */
  offerCapabilities?: Partial<Record<import("./features/offers/types").OfferCapability, boolean>>;
}

export type SampleCapability =
  | "VIEW_SAMPLE_MANAGEMENT"
  | "VIEW_SAMPLE_REPORTS"
  | "CREATE_SAMPLE_SKU"
  | "EDIT_SAMPLE_SKU"
  | "DEACTIVATE_SAMPLE_SKU"
  | "VIEW_SAMPLE_INVENTORY"
  | "RECEIVE_SAMPLE_STOCK"
  | "ADJUST_SAMPLE_STOCK"
  | "CREATE_SAMPLE_REQUEST"
  | "VIEW_OWN_SAMPLE_REQUESTS"
  | "VIEW_TEAM_SAMPLE_REQUESTS"
  | "APPROVE_SAMPLE_REQUEST"
  | "REJECT_SAMPLE_REQUEST"
  | "ALLOCATE_SAMPLE_STOCK"
  | "VIEW_OWN_SAMPLE_BALANCE"
  | "VIEW_TEAM_SAMPLE_BALANCE"
  | "DISTRIBUTE_SAMPLE"
  | "VIEW_PHYSICIAN_SAMPLE_HISTORY"
  | "EXPORT_SAMPLE_REPORTS";

export type SampleDataScope = "NONE" | "OWN" | "TEAM" | "ORG";

export type Language = "en" | "ar";
export type Theme = "light" | "dark";

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  territory: string;
  region: string; // e.g., Tripoli, Amman, Baghdad, Riyadh
  active: boolean;
  territories?: string[];
  products?: string[];
  joinedDate?: string;
  username?: string;
  password?: string;
  sidebarVisibility?: string[];
  
  // Template specific fields
  firstName?: string;
  lastName?: string;
  managerId?: string;
  managerEmail?: string;

  // New fields for Prompt 7
  country?: string;
  assignedCountries?: string[];
  district?: string;
  city?: string;
  employmentStatus?: "Active" | "Inactive" | "On Leave" | "Suspended" | string;
  accountStatus?: "ACTIVE" | "INACTIVE" | string;
  securityScope?: "Global" | "National" | "Regional" | "Territory Only" | "Subordinates Only" | string;
  loginAllowed?: boolean;
  lastLogin?: string;
  authenticated?: boolean;
  hasAuthenticated?: boolean;
  areaIds?: string[];
  areaNames?: string[];
  isDeleted?: boolean;
  status?: string;
  authLinked?: boolean;
  uid?: string;
  firstLoginAt?: string;
  primaryPromotionGroupId?: string;
  targetPromotionGroupIds?: string[];
  
  // Assignment Synchronization State
  assignmentSyncStatus?: "PENDING" | "IN_PROGRESS" | "COMPLETE" | "FAILED";
  assignmentSyncRunId?: string;
  assignmentSyncStartedAt?: string;
  assignmentSyncCompletedAt?: string;
  assignmentSyncErrorCode?: string;
  assignmentSyncErrorMessage?: string;
  assignmentSyncExpectedOperations?: number;
  assignmentSyncCompletedOperations?: number;
}

export interface Physician {
  id: string;
  name: string;
  nameAr?: string;
  specialty: string;
  specialtyId?: string;
  specialtyName?: string;
  classification: "A" | "B" | "C"; // Class/segment badge
  territory: string;
  region: string;
  latitude?: number | null;
  longitude?: number | null;
  gpsVerified?: boolean;
  gpsVerificationStatus?: string;
  gpsVerifiedAt?: string;
  gpsVerifiedBy?: string;
  gpsVerifiedByUid?: string;
  gpsVerifiedVisitId?: string;
  firstVerifiedVisitId?: string | null;
  gpsVerificationSource?: string;
  // Global physician-master summary metadata. Representative-owned history must
  // be derived from physicianVisits.repId through the scoped backend read.
  lastVisitDate?: string;
  lastVisitStatus?: "Completed" | "Pending" | "Cancelled";
  plannedVisitDate?: string;
  address: string;
  primaryBrand?: string;
  targetBrands?: string[];

  // Promotion Group fields
  primaryPromotionGroupId?: string;
  primaryPromotionGroupName?: string;
  targetPromotionGroupIds?: string[];
  targetPromotionGroupNames?: string[];

  // Template specific fields
  country?: string;
  district?: string;
  city?: string;
  area?: string;
  segment?: string; // segment "A", "B", "C"
  keyOpinionLeader?: "Yes" | "No" | string;
  targetFrequency?: number;
  clinic?: string;
  sector?: string;
  phone?: string;
  email?: string;
  assignedRepId?: string;
  assignedRepName?: string;
  assignedSupervisorId?: string;
  assignedSupervisorName?: string;
  assignedManagerId?: string;
  assignedManagerName?: string;
  assignedProducts?: string[];
  alignedProductIds?: string[];
  representativeResolutionStatus?: "AUTO_ASSIGNED" | "MANUAL_ASSIGNMENT_REQUIRED" | "NO_ELIGIBLE_MEDICAL_REP";
  supervisorResolutionStatus?: "RESOLVED" | "SUPERVISOR_NOT_RESOLVED";
  managerResolutionStatus?: "RESOLVED" | "MANAGER_NOT_RESOLVED";
  prescriptionIntent?: number;
  physicianReaction?: string;
  scientificInterests?: string[];
  visitTimeline?: any[];
  countryId?: string;
  countryName?: string;
  districtId?: string;
  districtName?: string;
  cityId?: string;
  cityName?: string;
  areaId?: string;
  areaName?: string;
  isTestData?: boolean;
  importBatchId?: string;
  importedAt?: string;
  importedBy?: string;
  sourceTemplateCode?: string;
  source?: string;
}

export interface Pharmacy {
  id: string;
  name: string;
  nameAr?: string;
  territory: string;
  region: string;
  latitude?: number | null;
  longitude?: number | null;
  gpsVerified?: boolean;
  gpsVerificationStatus?: string;
  gpsVerifiedAt?: string;
  gpsVerifiedByUid?: string;
  gpsVerifiedVisitId?: string;
  gpsSource?: string;
  reverificationRequested?: boolean;
  outstandingBalance: number;
  lastVisitDate?: string;
  address: string;
  type?: string;
  contact?: string;
  nextVisitDate?: string;

  // Template specific fields
  country?: string;
  district?: string;
  city?: string;
  area?: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  paymentInDays?: number;
  assignedRepId?: string;
  assignedRepName?: string;
  assignedSupervisorId?: string;
  assignedSupervisorName?: string;
  salesPotential?: string;
  competitorInformation?: string;
  active?: boolean;
  status?: string;
  visitTimeline?: any[];
  countryId?: string;
  countryName?: string;
  districtId?: string;
  districtName?: string;
  cityId?: string;
  cityName?: string;
  areaId?: string;
  areaName?: string;
  isTestData?: boolean;
  importBatchId?: string;
  importedAt?: string;
  importedBy?: string;
  sourceTemplateCode?: string;
  source?: string;
  isDeleted?: boolean;
  licenseNumber?: string;
  creditLimit?: number;
  companyId?: string;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
  updatedBy?: string;
}

export const SUPERVISOR_VISIT_PURPOSES = [
  "Joint Field Visit",
  "Service Quality Audit",
  "Stock & Formulary Check",
  "Coaching Session",
  "Key Account Negotiation",
] as const;

export type SupervisorVisitPurpose = typeof SUPERVISOR_VISIT_PURPOSES[number];
export type SupervisorVisitCustomerType = "PHYSICIAN" | "PHARMACY";
export type SupervisorVisitStatus = "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
export interface SupervisorIdentityPresentation {
  id: string;
  name: string;
  role: Role.MEDICAL_SUPERVISOR | Role.SALES_SUPERVISOR | null;
  roleLabel: string | null;
  resolved: boolean;
}
export interface SupervisorVisitLifecycleEvent {
  fromStatus: SupervisorVisitStatus;
  toStatus: SupervisorVisitStatus;
  action: "START" | "COMPLETE" | "CANCEL";
  actorUid: string;
  occurredAt: string;
}

export interface SupervisorVisit {
  id: string;
  supervisorId: string;
  supervisorRole: Role.MEDICAL_SUPERVISOR | Role.SALES_SUPERVISOR;
  customerType: SupervisorVisitCustomerType;
  customerId: string;
  countryId: string;
  districtId: string;
  cityId: string;
  areaId: string;
  accompaniedRepresentativeId: string | null;
  accompaniedRepresentativeRole: Role.MEDICAL_REP | Role.SALES_REP | null;
  purpose: SupervisorVisitPurpose;
  /** Legacy scheduled date retained for backward-compatible reads and queries. */
  visitDate: string;
  plannedDate?: string;
  plannedTime?: string;
  planningTimezone?: string;
  objectives: string;
  status: SupervisorVisitStatus;
  outcome: string;
  notes: string;
  hasCoaching: boolean;
  coachingAppraisalId: string | null;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  startedAt?: string;
  startedBy?: string;
  completedAt?: string;
  completedBy?: string;
  cancelledAt?: string;
  cancelledBy?: string;
  lifecycleHistory?: SupervisorVisitLifecycleEvent[];
}

export type SupervisorAppraisalType = "MEDICAL" | "SALES";
export type SupervisorCoachingStatus = "DRAFT" | "PENDING_CONFIRMATION" | "REPRESENTATIVE_REVIEWED" | "SIGNED_OFF" | "VOID" | "COMPLETED";
export type SupervisorCoachingWorkflowPhase = "INITIAL_DRAFT" | "INITIAL_REPRESENTATIVE_REVIEW" | "SUPERVISOR_DISAGREEMENT_REVIEW" | "REVISION_DRAFT" | "FINAL_REPRESENTATIVE_REVIEW" | "SUPERVISOR_FINAL_REVIEW" | "FINALIZED" | "VOID";
export type SupervisorCoachingReviewDecision = "ACKNOWLEDGED" | "DISAGREE_REQUEST_REVIEW";
export type SupervisorCoachingFinalReviewDecision = "ACKNOWLEDGE_REVISED_APPRAISAL" | "MAINTAIN_DISAGREEMENT";
export type SupervisorCoachingDisagreementResolution = "KEEP_UNCHANGED" | "REVISE";
export interface SupervisorCoachingPreRevisionSnapshot {
  sections: Array<{ id: string; title: string; criteria: string[] }>;
  sectionWeights: Record<string, number>;
  scores: Record<string, number>;
  comments: Record<string, string>;
  sectionNotes: Record<string, string>;
  strengths: string;
  improvementAreas: string;
  actionPlan: string;
  recommendations: string;
  overallRating: number;
  originalSubmittedAt: string;
  originalSubmittedBy: string;
  sourceWorkflowVersion: number;
  createdAt: string;
  createdBy: string;
}
export interface SupervisorCoachingWorkflowEvent {
  fromStatus: SupervisorCoachingStatus | "NEW";
  toStatus: SupervisorCoachingStatus;
  action: "CREATE" | "SAVE_DRAFT" | "SUBMIT" | "REPRESENTATIVE_REVIEW" | "KEEP_UNCHANGED" | "OPEN_REVISION" | "SAVE_REVISION" | "SUBMIT_REVISION" | "FINAL_REPRESENTATIVE_REVIEW" | "SIGN_OFF" | "VOID";
  actorUid: string;
  actorRole: Role;
  occurredAt: string;
  fromPhase?: SupervisorCoachingWorkflowPhase;
  toPhase?: SupervisorCoachingWorkflowPhase;
  reviewDecision?: SupervisorCoachingReviewDecision | SupervisorCoachingFinalReviewDecision;
  revisionNumber?: number;
  previousWorkflowVersion?: number;
  workflowVersion?: number;
  supervisorRationale?: string;
}
export interface SupervisorCoachingAppraisal {
  id: string;
  supervisorVisitId: string;
  supervisorId: string;
  representativeId: string;
  representativeRole: Role.MEDICAL_REP | Role.SALES_REP;
  appraisalType: SupervisorAppraisalType;
  customerType: SupervisorVisitCustomerType;
  customerId: string;
  areaId: string;
  visitDate: string;
  sections: Array<{ id: string; title: string; criteria: string[] }>;
  sectionWeights?: Record<string, number>;
  scores: Record<string, number>;
  comments: Record<string, string>;
  sectionNotes?: Record<string, string>;
  strengths: string;
  improvementAreas: string;
  actionPlan: string;
  recommendations: string;
  overallRating: number;
  status: SupervisorCoachingStatus;
  workflowPhase?: SupervisorCoachingWorkflowPhase;
  workflowVersion?: number;
  revisionCount?: 0 | 1;
  submittedAt?: string;
  submittedBy?: string;
  representativeReviewDecision?: SupervisorCoachingReviewDecision;
  representativeComment?: string;
  representativeReviewedAt?: string;
  representativeReviewedBy?: string;
  supervisorDisagreementResolution?: SupervisorCoachingDisagreementResolution;
  supervisorDisagreementRationale?: string;
  supervisorDisagreementResolvedAt?: string;
  supervisorDisagreementResolvedBy?: string;
  revisionOpenedAt?: string;
  revisionOpenedBy?: string;
  revisionSubmittedAt?: string;
  revisionSubmittedBy?: string;
  finalRepresentativeReviewDecision?: SupervisorCoachingFinalReviewDecision;
  finalRepresentativeComment?: string;
  finalRepresentativeReviewedAt?: string;
  finalRepresentativeReviewedBy?: string;
  preRevisionSnapshot?: SupervisorCoachingPreRevisionSnapshot;
  signedOffAt?: string;
  signedOffBy?: string;
  voidedAt?: string;
  voidedBy?: string;
  voidReason?: string;
  workflowHistory?: SupervisorCoachingWorkflowEvent[];
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface ProductPromotionProfile {
  positioning?: string;
  positioningArabic?: string;
  usp?: string;
  promotionObjectives?: string;
  promotionPriority?: "High" | "Medium" | "Low" | string;
  targetSpecialties?: string[];
  targetPharmacyTypes?: string[];
  targetHospitals?: string[];
  promotionNotes?: string;
  promotionNotesArabic?: string;
  launchStatus?: string;
  promotionStatus?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface Product {
  id: string;
  name: string;
  nameAr?: string;
  brand: string;
  therapeuticArea: string;
  price: number;
  stock: number;
  description?: string;
  isActive?: boolean;
  manufacturer?: string;
  promotionType?: string;
  code?: string;

  // Promotion Group fields
  promotionGroupId?: string;
  promotionGroupName?: string;
  productFamily?: string;

  // Template specific fields
  sku?: string;
  productType?: string;
  stockQuantity?: number;
  isSampleable?: "Yes" | "No" | string;
  monthlyRepSampleLimit?: number;
  monthlyPhysicianSampleLimit?: number;
  isSample?: "Yes" | "No" | string;
  isSampleSku?: boolean;
  canGenerateSamples?: boolean;
  parentProductId?: string;
  parentProductName?: string;
  parentProductSku?: string;
  atcClassification?: string;
  marketingStatus?: string;
  packageSize?: string;
  strength?: string;
  prescriptionStatus?: "Prescription" | "OTC" | "Medical Device" | "Cosmetic" | "Dermocosmetic" | string;
  resourceCenterLinks?: string[];
  scientificMaterials?: string[];
  brochures?: string[];
  productImages?: string[];
  productImageUrl?: string;
  keyMessages?: string[];

  // Promotion Profile addition
  promotionProfile?: ProductPromotionProfile;
  isTestData?: boolean;
  importBatchId?: string;
  importedAt?: string;
  importedBy?: string;
  sourceTemplateCode?: string;
  source?: string;
}

export interface ProductPromotionGroup {
  id: string;
  name: string;
  nameAr?: string;
  normalizedName: string;
  description?: string;
  isActive: boolean;
  createdAt?: string;
  createdBy?: string;
  updatedAt?: string;
  updatedBy?: string;
  aliases?: string[];
}

export interface KeyMessage {
  id: string;
  brandId: string;
  brandName: string;
  message: string;
  messageAr?: string;
  therapeuticArea: string;

  // Ownership fields
  productId?: string;
  productName?: string;
  promotionGroupId?: string;
  promotionGroupName?: string;

  // Multiple specialties fields
  targetSpecialtyIds?: string[];
  targetSpecialtyNames?: string[];

  // Template specific fields
  productSku?: string;
  keyFocus?: "Primary" | "Secondary" | "Tertiary" | string;
  messageContent?: string;
  scientificReferences?: string[];
  detailingSequence?: number;
  physicianSpecialty?: string;
  resourceId?: string;
  campaignId?: string;
  isApproved?: boolean;
  active?: boolean;
  isTestData?: boolean;
  importBatchId?: string;
  importedAt?: string;
  importedBy?: string;
  sourceTemplateCode?: string;
  source?: string;
}

export interface PhysicianSpecialty {
  id: string;
  name: string;
  nameAr?: string;
  normalizedName: string; // uppercase for indexing/matching
  aliases?: string[];
  isActive: boolean;
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
  updatedBy?: string;
  source: "system" | "manual" | "import";
}

export interface PhysicianVisitDetailing {
  productId: string;
  brandName: string;
  reaction: "Positive" | "Neutral" | "Skeptical" | "Negative";
  notes: string;
  presentedKeyMessages?: string[];
  presentedResources?: string[];
  keyMessageIds?: string[];
  materialIds?: string[];
  productNotes?: string;
  prescriptionIntent?: CanonicalPrescriptionIntent | "High" | "Medium" | "Low" | number;
  detailingOrder?: number;
}

export type CanonicalPrescriptionIntent = "Will Prescribe" | "Considering" | "Needs Info" | "Not Interested";

export interface SampleQuantity {
  productId: string;
  sampleSkuId?: string;
  productName: string;
  brand: string;
  quantity: number;
  sampleSkuName?: string;
  sampleSkuDescriptor?: string;
  allocationConsumptions?: Array<{
    allocationId: string;
    batchId: string;
    batchNumber: string;
    expiryDate: string;
    quantity: number;
    requestId?: string | null;
    approvalId?: string | null;
  }>;
  requestId?: string;
  approvalId?: string;
  allocationIds?: string[];
  distributionId?: string;
  transactionId?: string;
}

export interface AdditionalSampleRequest {
  intentKey?: string;
  requestId?: string;
  sampleSkuId?: string;
  productId?: string;
  sampleVariantName?: string;
  productName: string;
  quantityNeeded: number;
  expectedDeliveryDate: string;
  reason: string;
  urgent?: boolean;
  status?: SampleRequestStatus;
  approvalId?: string;
  approvedQuantity?: number;
  allocatedQuantity?: number;
}

export interface MarketingRequest {
  requestType: "Sponsorship" | "Round Table" | "Stand Alone" | "Symposium" | "Flyers" | "Other";
  urgency: "High" | "Medium" | "Low";
  estimatedBudget: number;
  plannedDate: string;
  description: string;
}

export interface PhysicianVisit {
  id: string;
  displayNumber?: string;
  visitId?: string;
  resourceContextId?: string;
  date?: string;
  physicianId: string;
  physicianName: string;
  repId: string;
  repName: string;
  representativeId?: string;
  representativeName?: string;
  representativeRole?: string;
  supervisorId?: string;
  managerId?: string;
  areaId?: string;
  status?: string;
  startedAt?: string;
  completedAt?: string;
  completedAtLibya?: string;
  timezone?: string;
  visitDate: string;
  durationSeconds: number;
  detailing: PhysicianVisitDetailing[];
  samples: SampleQuantity[];
  additionalSampleRequests: AdditionalSampleRequest[];
  /** Legacy visit-level value retained only for historical read compatibility. */
  prescriptionIntent?: number;
  marketingRequest?: MarketingRequest;
  followUpRequired?: boolean;
  followUpDate?: string;
  followUpNotes?: string;
  generalNotes: string;
  additionalNotes?: string;
  gpsVerified: boolean;
  latitude?: number;
  longitude?: number;
  gpsAccuracy?: number;
  gpsTimestamp?: number;
  gpsSource?: string;
  gpsSpoofCheckStatus?: string;
  gpsVerificationStatus?: string;
  primaryPromotionGroup?: string;
  targetPromotionGroups?: string[];
  productsDetailed?: any[];
  samplesDistributed?: SampleQuantity[];
  samplesGiven?: SampleQuantity[];
  sampleRequests?: AdditionalSampleRequest[];
  marketingRequests?: any[];
  marketingRequestIds?: string[];
  followUpObjective?: string;
  overallVisitNotes?: string;
  isSynced?: boolean;
  syncStatus?: string;
  offlineSaved?: boolean;
  createdAt: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface OrderItem {
  productId: string;
  productName: string;
  quantity: number;
  price: number;
  discount: number; // percentage
}

export interface PharmacyVisit {
  id: string;
  displayNumber?: string;
  orderDisplayNumber?: string;
  date?: string;
  pharmacyId: string;
  pharmacyName: string;
  repId: string;
  repName: string;
  visitDate: string;
  gpsVerified: boolean;
  latitude?: number;
  longitude?: number;
  gpsAccuracy?: number;
  gpsTimestamp?: number;
  gpsSource?: string;
  gpsSpoofCheckStatus?: string;
  visitPurpose: "Order Intake" | "Collection" | "Stock Audit" | "Intel / Survey";
  items: OrderItem[];
  totalAmount: number;
  discountApplied: number;
  netAmount: number;
  paymentMethod?: "Cash" | "Cheque" | "Credit";
  paymentCollected?: number;
  outstandingBalanceAfter?: number;
  stockAudit: { productId: string; productName: string; availableStock: number; shelfQty: number }[];
  stockRequests?: { productId: string; productName: string; requestQty: number }[];
  intelNotes: string;
  durationSeconds?: number;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  userId: string;
  userName: string;
  userRole?: Role;
  action: string;
  entityType?: string;
  entityName?: string;
  entityId?: string;
  details: string;
  timestamp: string;
}

export interface ImportHistory {
  id: string;
  module: "Users" | "Physicians" | "Pharmacies" | "Products" | "Key Messages" | "Area Import (Geographic Master)";
  fileName: string;
  recordCount: number;
  importedBy: string;
  importedAt: string;
  status: string;
  recordsJson?: string; // Stored to support a rollback simulation
  recordsBackup?: any[];
  createdCount?: number;
  updatedCount?: number;
  reactivatedCount?: number;
  skippedCount?: number;
  failedCount?: number;
  errorsCount?: number;
  attemptedCount?: number;
  persistedDocumentIds?: string[];
  errors?: string[];
  durationMs?: number;
  rowResults?: Array<Record<string, any>>;
}

export type PharmacyDuplicateType = "NO_DUPLICATE" | "ACTIVE_DUPLICATE" | "SOFT_DELETED_DUPLICATE" | "AMBIGUOUS_DUPLICATE";

export interface PharmacyDuplicateResult {
  type: PharmacyDuplicateType;
  matchedDoc?: Pharmacy;
  matchedDocs?: Pharmacy[];
  matchingKey?: "canonical ID" | "normalized email" | "normalized phone" | "approved business identity key" | string;
}

/** @deprecated Legacy Samples UI document shape. Do not use for canonical writes. */
export interface LegacySampleAllocation {
  id: string;
  repId: string;
  repName: string;
  productId: string;
  productName: string;
  brand: string;
  allocatedQuantity: number;
  distributedQuantity: number;
  remainingQuantity: number;
  month: string;
  region: string;
}

/** @deprecated Legacy supplemental-quota approval document shape. */
export interface LegacySampleApproval {
  id: string;
  repId: string;
  repName: string;
  productId: string;
  productName: string;
  brand: string;
  requestedQuantity: number;
  originalAllocation: number;
  reason: string;
  status: "Pending" | "Approved" | "Rejected";
  submittedDate: string;
  actionBy?: string;
  actionDate?: string;
}

/** @deprecated Legacy warehouse refill request document shape. */
export interface LegacySampleRequest {
  id: string;
  repId: string;
  repName: string;
  productId: string;
  productName: string;
  brand: string;
  quantity: number;
  reason: string;
  status: "Pending" | "Approved" | "Rejected" | "Shipped" | "Delivered";
  requestedDate: string;
  urgent: boolean;
  physicianId?: string;
  physicianName?: string;
}

/** @deprecated Legacy aggregate warehouse inventory document shape. */
export interface LegacySampleInventory {
  id: string;
  productId: string;
  productName: string;
  brand: string;
  lotNumber: string;
  expiryDate: string;
  availableStock: number;
  coldChain: boolean;
  storageTemp: string;
  incomingPending: number;
}

export type SampleSkuStatus = "ACTIVE" | "INACTIVE";
export type SampleBatchStatus = "AVAILABLE" | "BLOCKED" | "EXPIRED" | "DEPLETED";
export type SampleRequestSource = "STANDALONE" | "PHYSICIAN_VISIT";
export type SampleRequestStatus =
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "REJECTED"
  | "AWAITING_ALLOCATION"
  | "PARTIALLY_ALLOCATED"
  | "ALLOCATED"
  | "CANCELLED";
export type SampleApprovalDecision = "APPROVED" | "REJECTED";
export type SampleAllocationStatus = "ACTIVE" | "DEPLETED" | "CANCELLED";
export type SampleInventoryMovementType =
  | "RECEIPT"
  | "ALLOCATION"
  | "DISTRIBUTION"
  | "RETURN"
  | "ADJUSTMENT"
  | "EXPIRY";
export type SampleInventoryMovementSourceType =
  | "SAMPLE_BATCH"
  | "SAMPLE_REQUEST"
  | "SAMPLE_APPROVAL"
  | "SAMPLE_ALLOCATION"
  | "SAMPLE_DISTRIBUTION"
  | "MANUAL_ADJUSTMENT";

export interface SampleSku {
  id: string;
  productId: string;
  name: string;
  descriptor: string;
  status: SampleSkuStatus;
  active: boolean;
  unitSize?: string;
  unitsPerPack?: number;
  coldChain?: boolean;
  manufacturer?: string;
  notes?: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface SampleBatch {
  id: string;
  sampleSkuId: string;
  batchNumber: string;
  expiryDate: string;
  receivedQuantity: number;
  availableQuantity: number;
  status: SampleBatchStatus;
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface SampleInventoryBalance {
  sampleSkuId: string;
  batchId?: string;
  totalReceived: number;
  availableQuantity: number;
  allocatedQuantity: number;
  expiredOrBlockedQuantity: number;
}

export interface SampleRequest {
  id: string;
  requesterId: string;
  repId: string;
  sampleSkuId: string;
  productId: string;
  quantityRequested: number;
  reason: string;
  expectedDeliveryDate?: string;
  requestedForPhysicianId?: string;
  requestedForPhysicianName?: string;
  repName?: string;
  sampleSkuName?: string;
  productName?: string;
  visitId?: string;
  source: SampleRequestSource;
  urgent: boolean;
  status: SampleRequestStatus;
  approvedQuantity?: number;
  approvalId?: string;
  allocatedQuantity?: number;
  cancelledAt?: string;
  cancelledBy?: string;
  cancellationReason?: string;
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface SampleApproval {
  id: string;
  requestId: string;
  approverId: string;
  decision: SampleApprovalDecision;
  approvedQuantity: number;
  repId?: string;
  sampleSkuId?: string;
  productId?: string;
  quantityRequested?: number;
  reason?: string;
  rejectionReason?: string;
  decidedAt: string;
  createdAt: string;
  createdBy: string;
}

export interface SampleAllocation {
  id: string;
  sampleSkuId: string;
  productId: string;
  repId: string;
  quantityAllocated: number;
  quantityDistributed: number;
  quantityRemaining: number;
  batchId?: string;
  inventoryMovementId?: string;
  requestId?: string;
  approvalId?: string;
  allocatedAt: string;
  allocatedBy: string;
  status: SampleAllocationStatus;
  reportingMonth: string;
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface RepresentativeSampleBalance {
  repId: string;
  sampleSkuId: string;
  productId: string;
  allocatedQuantity: number;
  distributedQuantity: number;
  availableQuantity: number;
}

export interface SampleDistribution {
  id: string;
  sampleSkuId: string;
  productId: string;
  repId: string;
  physicianId: string;
  quantity: number;
  allocationId: string;
  allocationIds?: string[];
  allocationConsumptions?: Array<{ allocationId: string; batchId?: string; quantity: number }>;
  visitId?: string;
  requestId?: string;
  batchId?: string;
  distributedAt: string;
  createdBy: string;
  notes?: string;
}

export interface SampleInventoryMovement {
  id: string;
  sampleSkuId: string;
  batchId?: string;
  type: SampleInventoryMovementType;
  quantity: number;
  sourceId: string;
  sourceType: SampleInventoryMovementSourceType;
  actorId: string;
  createdAt: string;
  notes?: string;
}

export interface Country {
  id: string;
  name: string;
  code?: string;
}

export interface District {
  id: string;
  name: string;
  countryId: string;
  countryName: string;
}

export interface City {
  id: string;
  name: string;
  districtId: string;
  districtName: string;
  countryId: string;
  countryName: string;
}

export interface Area {
  id: string;
  name: string;
  cityId: string;
  cityName: string;
  districtId: string;
  districtName: string;
  countryId: string;
  countryName: string;
  code?: string;
  active?: boolean;
  isTestData?: boolean;
  importBatchId?: string;
  importedAt?: string;
  importedBy?: string;
  sourceTemplateCode?: string;
  source?: string;
}

export interface Territory {
  territoryId: string;
  territoryName: string;
  areaName: string;
  areaIds?: string[];
  areaNames?: string[];
  cityId: string;
  cityName: string;
  districtId: string;
  districtName: string;
  countryId: string;
  countryName: string;
  status: "Active" | "Inactive";
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface UserTerritoryAssignment {
  assignmentId: string;
  userId: string;
  userRole: string;
  countryId: string;
  districtId: string;
  cityId: string;
  territoryId: string;
  territoryName: string;
  assignmentType: "medical" | "sales" | "manager";
  effectiveFrom: string;
  effectiveTo: string;
  status: "Active" | "Inactive";
  assignedBy: string;
  assignedAt: string;
}

export interface ProductGroup {
  id: string;
  name: string;
  description?: string;
}

export interface UserProductAssignment {
  assignmentId: string;
  userId: string;
  productId: string;
  productGroupId: string;
  therapeuticArea: string;
  assignmentType: "medical" | "sales" | "both";
  effectiveFrom: string;
  effectiveTo: string;
  status: "Active" | "Inactive";
  assignedBy: string;
  assignedAt: string;

  // Canonical snapshots and metadata fields
  active?: boolean;
  productSku?: string;
  productNameSnapshot?: string;
  productArabicNameSnapshot?: string;
  productGroupNameSnapshot?: string;
  therapeuticAreaId?: string;
  therapeuticAreaNameSnapshot?: string;
  assignmentSource?: string;
  updatedAt?: string | unknown;
  updatedBy?: string;
  deactivatedAt?: string | unknown;
  deactivatedBy?: string;
  deactivationReason?: string;
  schemaVersion?: number;
}

export interface PhysicianAssignment {
  assignmentId: string;
  physicianId: string;
  physicianName: string;
  repId: string;
  repName: string;
  territoryId: string;
  assignedAt: string;
  assignedBy: string;
}

export interface PharmacyAssignment {
  assignmentId: string;
  pharmacyId: string;
  pharmacyName: string;
  repId: string;
  repName: string;
  territoryId: string;
  assignedAt: string;
  assignedBy: string;
}

/**
 * Shared TypeScript types for MENAREPS 2.0 Analytics
 */

export interface AnalyticsFilters {
  selectedCountry: string;      // "All" or country ID (e.g. "C-LIB")
  selectedDistrict: string;     // "All" or district ID (e.g. "D-LIB-WST")
  selectedCity: string;         // "All" or city ID (e.g. "CT-TRI")
  selectedTerritory: string;    // "All" or territory ID/Path (e.g. "T-TRI-DWT")
  selectedProductGroup: string; // "All" or product group ID (e.g. "PG-CARDIO")
  selectedProduct: string;      // "All" or product ID/SKU (e.g. "PRD-001")
  startDate?: string;           // ISO date string
  endDate?: string;             // ISO date string
  searchQuery?: string;         // Search query for physicians/pharmacies/reps
}

export interface SecuredAnalyticsScope {
  userId: string;
  role: Role;
  level: "national" | "regional" | "personal";
  allowedCountries: string[];      // IDs of allowed countries
  allowedDistricts: string[];      // IDs of allowed districts
  allowedCities: string[];         // IDs of allowed cities
  allowedTerritories: string[];    // IDs or full path strings (lowercase) of allowed territories
  allowedProducts: string[];       // Product IDs/SKUs allowed
  allowedProductGroups: string[];  // Product group IDs allowed
  allowedPhysicians: string[];     // Physician IDs allowed
  allowedPharmacies: string[];     // Pharmacy IDs allowed
  subordinateUserIds: string[];    // User IDs of reporting hierarchy subordinates
}

export interface KpiCardData {
  id: string;
  title: string;
  value: string | number;
  change?: number;                // e.g. 5.4 for +5.4%
  changeType?: "increase" | "decrease" | "neutral";
  icon?: string;                  // Lucide icon identifier string
  description?: string;
}

export interface ChartDataPoint {
  label: string;                  // X-axis label (e.g. "Jan", "W1", "Tripoli")
  values: Record<string, number | string>; // Multiple series values e.g. { medicalVisits: 142, pharmacyVisits: 98 }
}

export interface ChartDataset {
  title: string;
  xAxisKey: string;
  points: ChartDataPoint[];
}

export interface PaginatedData<T> {
  data: T[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface AnalyticsExportRequest {
  reportId: string | number;
  reportName: string;
  filters: AnalyticsFilters;
  format: "csv" | "xlsx";
  userId: string;
  timestamp: string;
  securedScope: SecuredAnalyticsScope;
}

export interface AnalyticsDbState {
  users: User[];
  userTerritoryAssignments: UserTerritoryAssignment[];
  userProductAssignments: UserProductAssignment[];
  physicianAssignments: PhysicianAssignment[];
  pharmacyAssignments: PharmacyAssignment[];
  physicians: Physician[];
  pharmacies: Pharmacy[];
  products: Product[];
  physicianVisits: PhysicianVisit[];
  pharmacyVisits: PharmacyVisit[];
}

export type OrderStage = 
  | "DRAFT"
  | "SUBMISSION"
  | "INVENTORY_RESERVATION"
  | "FINANCE_REVIEW"
  | "OPERATIONS_REVIEW"
  | "STORE_PREPARATION"
  | "DISPATCH"
  | "DELIVERY"
  | "CLOSED";

export type OrderStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "RESERVATION_PENDING"
  | "INVENTORY_RESERVED"
  | "RESERVATION_FAILED"
  | "PARTIALLY_RESERVED"
  | "PENDING_FINANCE_REVIEW"
  | "FINANCE_APPROVED"
  | "FINANCE_REJECTED"
  | "RETURNED_TO_REP_BY_FINANCE"
  | "PENDING_OPERATIONS_REVIEW"
  | "OPERATIONS_APPROVED"
  | "OPERATIONS_REJECTED"
  | "RETURNED_TO_FINANCE"
  | "RETURNED_TO_REP_BY_OPERATIONS"
  | "PENDING_STORE_PREPARATION"
  | "STORE_PREPARING"
  | "READY_FOR_DISPATCH"
  | "STORE_REJECTED"
  | "ASSIGNED_FOR_DELIVERY"
  | "OUT_FOR_DELIVERY"
  | "PARTIALLY_DELIVERED"
  | "DELIVERED"
  | "DELIVERY_ATTEMPTED"
  | "DELIVERY_FAILED"
  | "CUSTOMER_REFUSED"
  | "RETURNED"
  | "RETURNED_TO_STORE"
  | "CANCELLED"
  | "EXPIRED"
  | "CLOSED";

export type OrderCapability =
  | "ORDER_CREATE"
  | "ORDER_SUBMIT"
  | "ORDER_VIEW_OWN"
  | "ORDER_VIEW_TEAM"
  | "ORDER_VIEW_SCOPED"
  | "ORDER_FINANCE_REVIEW"
  | "ORDER_FINANCE_APPROVE"
  | "ORDER_FINANCE_REJECT"
  | "ORDER_FINANCE_RETURN"
  | "ORDER_OPERATIONS_REVIEW"
  | "ORDER_OPERATIONS_APPROVE"
  | "ORDER_OPERATIONS_REJECT"
  | "ORDER_OPERATIONS_RETURN"
  | "ORDER_STORE_PREPARE"
  | "ORDER_STORE_READY"
  | "ORDER_DELIVERY_ASSIGN"
  | "ORDER_DELIVERY_EXECUTE"
  | "ORDER_DELIVERY_COMPLETE"
  | "ORDER_DELIVERY_RETURN"
  | "ORDER_DELIVERY_CANCEL"
  | "ORDER_ADMIN_OVERRIDE";

export interface OrderItemRecord {
  id: string;
  name: string;
  quantity: number;
  price: number;
  total: number;
}

export interface OrderRecord {
  id: string;
  displayNumber?: string;
  visitId?: string;
  visitDisplayNumber?: string;
  pharmacyId: string;
  pharmacyName: string;
  pharmacyNameSnapshot?: string;
  pharmacyAddress?: string;
  createdByUid?: string;
  createdByName?: string;
  salesRepUid?: string;
  createdBy?: string;
  salesRep: string;
  areaId?: string;
  countryId?: string;
  companyId?: string;
  stage?: OrderStage;
  status: OrderStatus | string;
  date: string;
  currencyCode?: string;
  subtotal?: number;
  discount?: number;
  netTotal?: number;
  total: number;
  paidStatus: "Paid" | "Unpaid" | string;
  paidAmount: number;
  items: OrderItemRecord[];
  notes?: string;
  submittedAt?: string;
  submittedByUid?: string;
  reservationStatus?: string;
  reservedAt?: string;
  financeReviewedAt?: string;
  financeReviewedByUid?: string;
  operationsReviewedAt?: string;
  operationsReviewedByUid?: string;
  storePreparedAt?: string;
  storePreparedByUid?: string;
  deliveryAssignedAt?: string;
  deliveryAssignedByUid?: string;
  deliveryOfficerUid?: string;
  deliveredAt?: string;
  deliveredByUid?: string;
  cancellationReason?: string;
  rejectionReason?: string;
  createdAt?: string;
  updatedAt?: string;
  version?: number;
  history?: any[];
}

export interface Notification {
  id: string;
  notificationId: string;
  userId?: string;
  role?: Role | string;
  category: "info" | "approval" | "planner" | "order" | "finance" | "sample" | "marketing" | "warehouse" | "delivery" | "stock" | "finance_alert" | string;
  priority: "low" | "medium" | "high";
  title: string;
  message: string;
  relatedModule?: string;
  relatedRecordId?: string;
  deepLink?: string;
  status: "unread" | "read";
  createdAt: string;
  expiresAt?: string;
  createdBy: string;
  auditLogId?: string;
}

// ==========================================================
// PRODUCT SALES TARGET TYPES (MENAREPS 2.0 WP4.1C)
// ==========================================================

export enum TargetStatus {
  DRAFT = "DRAFT",
  SUBMITTED = "SUBMITTED",
  APPROVED = "APPROVED",
  ACTIVE = "ACTIVE",
  REJECTED = "REJECTED",
  SUPERSEDED = "SUPERSEDED",
  CLOSED = "CLOSED",
  CANCELLED = "CANCELLED"
}

export interface ProductTargetPlan {
  planId: string;
  countryId: string;
  year: number;
  currencyCode: string;
  monthlyDistributionMethod: "EQUAL_WITHIN_QUARTER";
  status: TargetStatus;
  version: number;
  active: boolean;

  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;

  submittedAt?: string;
  submittedBy?: string;
  approvedAt?: string;
  approvedBy?: string;
  activatedAt?: string;
  activatedBy?: string;
  rejectedAt?: string;
  rejectedBy?: string;
  rejectionReason?: string;
  closedAt?: string;
  closedBy?: string;
  cancelledAt?: string;
  cancelledBy?: string;
  cancellationReason?: string;

  supersedesPlanId?: string;
  amendmentReason?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
}

export interface ProductAnnualTarget {
  targetId: string;
  planId: string;
  countryId: string;
  productId: string;
  year: number;
  annualTargetUnits: number;
  currencyCode: string;
  status: TargetStatus;
  version: number;
  active: boolean;

  productSkuSnapshot?: string;
  productNameSnapshot?: string;
  productArabicNameSnapshot?: string;
  promotionGroupIdSnapshot?: string;
  promotionGroupNameSnapshot?: string;

  unitPriceSnapshot?: number;
  annualTargetValue?: number;
  priceSource?: string;
  priceEffectiveDate?: string;
  priceCapturedAt?: string;
  priceCapturedBy?: string;

  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;

  submittedAt?: string;
  submittedBy?: string;
  approvedAt?: string;
  approvedBy?: string;
  activatedAt?: string;
  activatedBy?: string;
  supersedesTargetId?: string;
  amendmentReason?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
}

export interface ProductAreaPotential {
  areaPotentialId: string;
  planId: string;
  annualTargetId: string;
  countryId: string;
  productId: string;
  year: number;
  areaId: string;
  potentialPercentage: number;
  status: TargetStatus;
  version: number;
  active: boolean;

  countryCodeSnapshot?: string;
  countryNameSnapshot?: string;
  districtNameSnapshot?: string;
  cityNameSnapshot?: string;
  areaCodeSnapshot?: string;
  areaNameSnapshot?: string;
  areaArabicNameSnapshot?: string;

  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface ProductQuarterlyDistribution {
  quarterlyDistributionId: string;
  planId: string;
  annualTargetId: string;
  countryId: string;
  productId: string;
  year: number;
  q1Percentage: number;
  q2Percentage: number;
  q3Percentage: number;
  q4Percentage: number;
  status: TargetStatus;
  version: number;
  active: boolean;

  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface CalculatedProductTarget {
  calculatedTargetId: string;
  planId: string;
  annualTargetId: string;
  areaPotentialId: string;
  quarterlyDistributionId: string;
  countryId: string;
  productId: string;
  areaId: string;
  year: number;
  quarter: 1 | 2 | 3 | 4;
  month: number;
  targetUnits: number;
  targetValue: number;
  unitPriceSnapshot: number;
  currencyCode: string;
  status: TargetStatus;
  version: number;
  calculationVersion: number;
  calculationInputHash: string;
  active: boolean;

  annualTargetUnitsSnapshot: number;
  areaPotentialPercentageSnapshot: number;
  quarterPercentageSnapshot: number;
  monthlyDistributionMethodSnapshot: "EQUAL_WITHIN_QUARTER";

  productSkuSnapshot?: string;
  productNameSnapshot?: string;
  areaCodeSnapshot?: string;
  areaNameSnapshot?: string;

  calculatedAt: string;
  calculatedBy: string;
  approvedAt?: string;
  approvedBy?: string;
}

export interface TargetCalculationRun {
  runId: string;
  planId: string;
  countryId: string;
  year: number;
  requestedBy: string;
  requestedAt: string;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETE" | "PARTIAL" | "FAILED";
  productsRequested: number;
  productsSucceeded: number;
  productsFailed: number;
  targetsCreated: number;
  targetsUpdated: number;
  active: boolean;

  productIds?: string[];
  inputHash?: string;
  errors?: string[];
  startedAt?: string;
  completedAt?: string;
  lastCompletedStage?: string;
  retryOfRunId?: string;
}
export interface NormalizedSalesActual {
  salesActualId: string;
  sourceType: string;
  sourceDocumentId: string;
  sourceLineId: string;
  productId: string;
  pharmacyId: string;
  areaIdSnapshot: string;
  areaCodeSnapshot?: string;
  areaNameSnapshot?: string;
  attributionSource?: "order" | "pharmacy_snapshot" | "pharmacy_fallback" | string;
  attributionConfidence?: "high" | "medium" | "low" | string;
  attributedAt?: string;
  countryId: string;
  transactionDate: string;
  year: number;
  quarter: number;
  month: number;
  orderedUnits: number;
  deliveredUnits: number;
  freeUnits: number;
  returnedUnits: number;
  netCommercialUnits: number;
  grossValue: number;
  discountValue: number;
  returnValue: number;
  netSalesValue: number;
  currencyCode: string;
  transactionStatus: string;
  processingVersion: number;
  processedAt: string;
  active: boolean;
}

export interface ProductAreaMonthlyPerformance {
  performanceId: string;
  planId: string;
  countryId: string;
  productId: string;
  areaId: string;
  year: number;
  quarter: number;
  month: number;
  targetVersion: number;
  targetUnits: number;
  targetValue: number;
  actualUnits: number;
  actualValue: number;
  achievementUnitsPercentage: number;
  achievementValuePercentage: number;
  varianceUnits: number;
  varianceValue: number;
  remainingUnits: number;
  remainingValue: number;
  overachievementUnits: number;
  overachievementValue: number;
  currencyCode: string;
  dataCutoffDate: string;
  calculatedAt: string;
  calculationVersion: number;
  active: boolean;
  valueAchievementStatus?: "OK" | "CURRENCY_MISMATCH" | string;
}

export type OrderStageFilter = "ALL" | "SUBMISSION" | "FINANCE_REVIEW" | "OPERATIONS_REVIEW" | "STORE_PREPARATION" | "DISPATCH" | "CLOSED";

export type PhysicianVisitCompletionResult =
  | { status: "COMPLETED" }
  | { status: "PENDING_SYNC"; queueItemId: string };
