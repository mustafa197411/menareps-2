/**
 * WP-FI-1.1 Enterprise Financial Intelligence & Collections - Types & Models
 * PAYMENTS AND CUSTOMER FINANCIAL DATA ARE FOR DATA COLLECTION, HISTORY, REPORTING, AND ANALYSIS ONLY.
 * THEY MUST NEVER CONTROL ORDER WORKFLOW OR BLOCK ORDERS.
 */

export type PaymentTermCode = 
  | "CASH" 
  | "NET_7" 
  | "NET_15" 
  | "NET_30" 
  | "NET_45" 
  | "NET_60" 
  | "NET_90" 
  | "CUSTOM";

/** @deprecated CreditStatus is preserved for legacy migration compatibility only. WP-FI-1.1 does not enforce credit limits or statuses. */
export type CreditStatus = 
  | "ACTIVE" 
  | "WARNING" 
  | "OVER_LIMIT" 
  | "OVERDUE" 
  | "HOLD" 
  | "INACTIVE";

export type LedgerTransactionType = 
  | "OPENING_BALANCE" 
  | "INVOICE" 
  | "ADJUSTMENT_DEBIT" 
  | "ADJUSTMENT_CREDIT" 
  | "REVERSAL"
  | "PAYMENT";

/** WP-FI-2.0 Payment Collection Types */
export type PaymentMethod = "Cash" | "Cheque" | "Bank Transfer" | "Other";

export type PaymentStatus = "Submitted" | "Verified" | "Rejected" | "Corrected";

export interface PaymentVerificationRecord {
  status: PaymentStatus;
  timestamp: string;
  actorUid: string;
  actorName: string;
  actorRole: string;
  notes?: string;
  reason?: string;
  changes?: Record<string, { old: any; new: any }>;
}

export interface CollectionVerificationRequest { collectionId: string; expectedRevision: number; }
export interface CollectionVerificationResponse { success: true; collectionId: string; alreadyCompleted: boolean; }

export interface PaymentCollection {
  revision?: number; // Canonical concurrency token; absent on historical records.
  paymentId: string;
  paymentNumber: string; // Sequential automatic e.g. PAY-2026-0001
  pharmacyId: string;
  pharmacyName: string;
  customerAccountNumber: string;
  representativeUid: string;
  representativeName: string;
  areaId: string;
  areaName?: string;
  cityId: string;
  cityName?: string;
  districtId?: string;
  countryId?: string;
  collectionDate: string; // YYYY-MM-DD
  amount: number;
  currency: string;
  currencyCode?: string;
  marketId?: string;
  paymentMethod: PaymentMethod;
  referenceNumber: string;
  notes: string;
  attachmentUrls: string[];

  // Source tracking fields
  sourceType?: string;
  sourceVisitId?: string;
  sourceOrderId?: string;
  idempotencyKey?: string;

  // Method-specific conditional fields
  receiptNumber?: string;
  chequeNumber?: string;
  chequeBankName?: string;
  chequeDate?: string;
  chequeImageUrl?: string;
  transferBankName?: string;
  transferReference?: string;
  transferProofUrl?: string;

  status: PaymentStatus;

  verificationHistory?: PaymentVerificationRecord[];
  verifiedAt?: string | null;
  verifiedByUid?: string | null;
  verifiedByName?: string | null;
  rejectionReason?: string | null;

  ledgerEntryId?: string | null;

  createdAt: string;
  createdByUid: string;
  updatedAt: string;
  updatedByUid: string;
}

export interface PaymentSummaryReport {
  totalCollected: number;
  totalPaymentsCount: number;
  byStatus: Record<PaymentStatus, number>;
  countByMethod: Record<PaymentMethod, number>;
  amountByMethod: Record<PaymentMethod, number>;
  byRepresentative: Record<string, { uid: string; name: string; totalAmount: number; count: number }>;
  byPharmacy: Record<string, { pharmacyId: string; name: string; totalAmount: number; count: number }>;
  byArea: Record<string, { areaId: string; name: string; totalAmount: number; count: number }>;
  byMonth: Record<string, { monthKey: string; totalAmount: number; count: number }>;
}

export interface AgeingBreakdown {
  current: number;       // 0 days overdue
  oneToThirty: number;    // 1-30 days overdue
  thirtyOneToSixty: number; // 31-60 days overdue
  sixtyOneToNinety: number; // 61-90 days overdue
  overNinety: number;    // >90 days overdue
}

export interface CustomerFinancialProfile {
  pharmacyId: string;
  pharmacyName: string;
  customerAccountNumber: string;
  currency: string;
  currencyCode?: string;
  marketId?: string;
  paymentTermCode: PaymentTermCode | null;
  paymentTermDays: number | null;
  openingBalance: number;
  outstandingBalance: number;
  overdueBalance: number;
  totalInvoiced: number;
  totalCollected: number;
  openInvoiceCount: number;
  paidInvoiceCount: number;
  oldestOpenInvoiceDate: string | null;
  averagePaymentDays: number | null;
  collectionRate: number | null;
  lastInvoiceDate: string | null;
  lastPaymentDate: string | null;
  lastLedgerActivityAt: string | null;
  financeNotes: string;
  active: boolean;
  createdAt: string;
  createdByUid: string;
  updatedAt: string;
  updatedByUid: string;

  // Geographic scoping fields for ABAC / RBAC
  countryId?: string;
  regionId?: string;
  districtId?: string;
  cityId?: string;
  cityName?: string;
  areaId?: string;
  areaName?: string;
  country?: string;
  city?: string;
  area?: string;

  /** @deprecated Preserved for legacy Firestore backward compatibility only. Has zero operational effect on orders. */
  creditLimit?: number;
  /** @deprecated Preserved for legacy Firestore backward compatibility only. Has zero operational effect on orders. */
  creditStatus?: CreditStatus | string;
  /** @deprecated Preserved for legacy Firestore backward compatibility only. Has zero operational effect on orders. */
  manualCreditHold?: boolean;
  /** @deprecated Preserved for legacy Firestore backward compatibility only. Has zero operational effect on orders. */
  availableCredit?: number;
}

export interface CustomerLedgerEntry {
  id: string;
  pharmacyId: string;
  customerAccountNumber: string;
  orderId: string | null;
  orderNumber: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  paymentId?: string | null;
  transactionType: LedgerTransactionType;
  sourceType: string;
  sourceId: string;
  description: string;
  debitAmount: number;
  creditAmount: number;
  netAmount: number;
  currency: string;
  currencyCode?: string;
  marketId?: string;
  postingDate: string; // ISO date string YYYY-MM-DD or ISO timestamp
  dueDate: string | null; // ISO date string
  paymentTermCodeSnapshot?: PaymentTermCode;
  paymentTermDaysSnapshot?: number;
  invoiceOriginalAmount?: number;
  invoiceAppliedAmount?: number;
  invoiceOpenAmount?: number;
  status: "POSTED" | "VOID" | "REVERSED";
  isReversal: boolean;
  reversesEntryId: string | null;
  idempotencyKey: string;
  createdAt: string;
  createdByUid: string;
  createdByName: string;

  // Computed field for UI presentation
  runningBalance?: number;
}

export interface ArBootstrapReport {
  pharmaciesScanned: number;
  profilesCreated: number;
  profilesPreserved: number;
  profilesFailed: number;
  details?: string[];
}

export interface CreditStatusResolution {
  status: CreditStatus | string;
  ruleApplied: string;
}

export interface FinancialAnalyticsSummary {
  totalInvoiced: number;
  totalCollected: number;
  outstandingBalance: number;
  overdueBalance: number;
  openInvoiceCount: number;
  paidInvoiceCount: number;
  oldestOpenInvoiceDate: string | null;
  averagePaymentDays: number | null;
  collectionRate: number | null;
  ageing: AgeingBreakdown;
  availableCredit?: number; // legacy optional
}

/** Phase 1 contracts: trusted, unwired financial commands and immutable linkage. */
export interface SettlementIdentity { pharmacyId: string; marketId: string; currencyCode: string; decimalPlaces: number }
export interface CanonicalReceivable extends SettlementIdentity {
  id: string; orderId: string; postingTimestamp: string; dueDate?: string;
  status: "POSTED" | "VOID" | "REVERSED"; transactionType: "INVOICE";
  sourceType: "DELIVERED_ORDER"; originalAmount: number; creditedAmount: number; appliedAmount: number;
  revision: number;
}
export interface PaymentAllocationEvent extends SettlementIdentity {
  id: string; collectionId: string; paymentLedgerId: string; invoiceLedgerId: string; orderId: string;
  amount: number; sequence: number; operationId: string; actorUid: string; createdAt: string;
  reversesAllocationId?: string;
}
export interface SubmittedCollection extends SettlementIdentity {
  areaId: string; notes?: string;
  id: string; requestKey: string; payloadHash: string; actorUid: string; createdAt: string;
  amount: number; method: PaymentMethod; reference: string; evidence: string[]; collectionDate: string;
  sourceKey?: string; chequeBank?: string; chequeDate?: string; transferBank?: string; status: "Submitted"; revision: number;
}

// Persisted certification contract. Historical records are never defaulted into it.
export interface CertifiedInvoiceProjection extends SettlementIdentity {
  id: string; orderId: string; createdAt: string;
  projectionVersion: 1; revision: number;
  invoiceOriginalAmount: number; invoiceAppliedAmount: number;
  invoiceCreditedAmount: number; invoiceOpenAmount: number; isOpen: boolean;
  status: "POSTED"; transactionType: "INVOICE"; sourceType: "DELIVERED_ORDER";
}
export interface CustomerProjectionCertification {
  pharmacyId: string; marketId: string; currencyCode: string;
  projectionSource: "customerLedgerEntries"; projectionVersion: 1;
}
export interface CertificationEvidence {
  ledger: string[]; collections: string[]; payments: string[];
  visits: string[]; orders: string[]; legacyOrders: string[];
}

export interface CollectionReversalRequest { collectionId: string; expectedRevision: number; reason: string; }
export interface CollectionReversalRecord {
  collectionId: string; ledgerEntryId: string; originalLedgerEntryId: string;
  actorUid: string; createdAt: string; reason: string;
}
export interface CollectionReversalResponse {
  success: true; alreadyCompleted: boolean; reversal: CollectionReversalRecord;
}
export interface CollectionReversalStatus { success: true; reversal: CollectionReversalRecord | null; }
