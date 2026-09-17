/**
 * WP-FI-1.1 Enterprise Financial Intelligence & Collections - Resolvers & Calculation Engines
 * All calculations are DATA COLLECTION & ANALYTICS ONLY. They must never control Order workflow or block Orders.
 */

import { 
  PaymentTermCode, 
  CreditStatus, 
  CustomerLedgerEntry, 
  FinancialAnalyticsSummary,
  AgeingBreakdown,
  CreditStatusResolution 
} from "./arTypes";
import { requireFinancialIdentity } from "../../lib/financialIdentity";
import type { MarketBusinessSettings } from "../../lib/marketSettings";

/**
 * Returns default term days for standard payment term codes
 */
export function getPaymentTermDays(code: PaymentTermCode | null | undefined, customDays?: number | null): number {
  if (!code) return 0;
  switch (code) {
    case "CASH":
      return 0;
    case "NET_7":
      return 7;
    case "NET_15":
      return 15;
    case "NET_30":
      return 30;
    case "NET_45":
      return 45;
    case "NET_60":
      return 60;
    case "NET_90":
      return 90;
    case "CUSTOM":
      return Math.max(0, customDays || 0);
    default:
      return 0;
  }
}

/**
 * Generates a stable, unique customer account number for a pharmacy
 */
export function generateCustomerAccountNumber(pharmacy: any, markets?: readonly MarketBusinessSettings[]): string {
  if (pharmacy?.customerAccountNumber) {
    return pharmacy.customerAccountNumber;
  }
  const codeCandidate = pharmacy?.code || pharmacy?.licenseNumber || pharmacy?.pharmacyCode || pharmacy?.id || "000000";
  const sanitized = String(codeCandidate).replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  const tail = sanitized.slice(-6).padStart(6, "0");
  const identity = requireFinancialIdentity([pharmacy], markets);
  const marketCode = identity.marketId.split("-").find(part => /^[A-Z]{3}$/.test(part)) || identity.currencyCode;
  return `CUS-${marketCode}-${tail}`;
}

/**
 * Calculates due date based on posting date and payment terms
 */
export function calculateDueDate(
  postingDateStr: string,
  paymentTermCode: PaymentTermCode | null | undefined,
  customTermDays?: number | null
): string {
  const termDays = getPaymentTermDays(paymentTermCode, customTermDays);
  const postingDate = new Date(postingDateStr);
  const validDate = isNaN(postingDate.getTime()) ? new Date() : postingDate;

  const dueDate = new Date(validDate);
  dueDate.setDate(dueDate.getDate() + termDays);

  return dueDate.toISOString().split("T")[0]; // Returns YYYY-MM-DD
}

/**
 * Computes Ageing Breakdown, Outstanding Balance, Overdue Balance, Collection Rate, and Payment Performance
 */
export function calculateBalances(
  ledgerEntries: CustomerLedgerEntry[],
  legacyCreditLimitOrToday: number | string = 0,
  todayIso: string = new Date().toISOString()
): FinancialAnalyticsSummary {
  // Disambiguate legacy argument calls if legacy code passed creditLimit as 2nd param
  let actualTodayIso = todayIso;
  if (typeof legacyCreditLimitOrToday === "string" && legacyCreditLimitOrToday.includes("-")) {
    actualTodayIso = legacyCreditLimitOrToday;
  }
  const todayTime = new Date(actualTodayIso).getTime();
  const todayDateStr = actualTodayIso.split("T")[0];

  let totalInvoiced = 0;
  let totalCollected = 0;
  let outstandingBalance = 0;
  let overdueBalance = 0;

  let openInvoiceCount = 0;
  let paidInvoiceCount = 0;
  let oldestOpenInvoiceDate: string | null = null;

  const ageing: AgeingBreakdown = {
    current: 0,
    oneToThirty: 0,
    thirtyOneToSixty: 0,
    sixtyOneToNinety: 0,
    overNinety: 0
  };

  const paymentDelays: number[] = [];

  // Filter only active posted entries
  const postedEntries = ledgerEntries.filter(entry => entry.status === "POSTED");

  for (const entry of postedEntries) {
    const debit = Number(entry.debitAmount || 0);
    const credit = Number(entry.creditAmount || 0);
    const entryNet = debit - credit;

    outstandingBalance += entryNet;

    // Linked counter-entries remain alongside originals. Do not count a
    // reversing payment debit as a new invoice, or an invoice credit as cash.
    if (entry.isReversal && entry.reversesEntryId) {
      const original = postedEntries.find(candidate => candidate.id === entry.reversesEntryId && !candidate.isReversal);
      if (!original) throw new Error("REVERSAL_ORIGINAL_REQUIRED");
      if (original.transactionType === "PAYMENT") totalCollected -= debit;
      else if (original.transactionType === "INVOICE") totalInvoiced -= credit;
      continue;
    }

    if (entry.transactionType === "INVOICE" || debit > 0) {
      totalInvoiced += debit;

      const openAmount = entry.invoiceOpenAmount !== undefined 
        ? Number(entry.invoiceOpenAmount) 
        : entryNet;

      if (openAmount > 0) {
        openInvoiceCount++;

        // Track oldest open invoice
        const invDate = entry.postingDate || entry.createdAt || "";
        if (invDate) {
          if (!oldestOpenInvoiceDate || invDate < oldestOpenInvoiceDate) {
            oldestOpenInvoiceDate = invDate;
          }
        }

        // Check overdue & Ageing Buckets using due date or posting date
        const dueDateStr = entry.dueDate ? entry.dueDate.split("T")[0] : invDate.split("T")[0];
        
        if (dueDateStr && dueDateStr < todayDateStr) {
          overdueBalance += openAmount;

          const dueTime = new Date(dueDateStr).getTime();
          const daysOverdue = Math.max(0, Math.floor((todayTime - dueTime) / (1000 * 60 * 60 * 24)));

          if (daysOverdue <= 0) {
            ageing.current += openAmount;
          } else if (daysOverdue <= 30) {
            ageing.oneToThirty += openAmount;
          } else if (daysOverdue <= 60) {
            ageing.thirtyOneToSixty += openAmount;
          } else if (daysOverdue <= 90) {
            ageing.sixtyOneToNinety += openAmount;
          } else {
            ageing.overNinety += openAmount;
          }
        } else {
          ageing.current += openAmount;
        }
      } else {
        paidInvoiceCount++;
      }
    }

    if (credit > 0 || entry.transactionType === "ADJUSTMENT_CREDIT") {
      totalCollected += credit;
    }
  }

  const collectionRate = totalInvoiced > 0 
    ? Math.min(100, Math.round((totalCollected / totalInvoiced) * 100)) 
    : 100;

  const averagePaymentDays = paymentDelays.length > 0 
    ? Math.round(paymentDelays.reduce((a, b) => a + b, 0) / paymentDelays.length)
    : null;

  return {
    totalInvoiced: Math.round(totalInvoiced * 100) / 100,
    totalCollected: Math.round(totalCollected * 100) / 100,
    outstandingBalance: Math.round(outstandingBalance * 100) / 100,
    overdueBalance: Math.round(overdueBalance * 100) / 100,
    openInvoiceCount,
    paidInvoiceCount,
    oldestOpenInvoiceDate,
    averagePaymentDays,
    collectionRate,
    ageing: {
      current: Math.round(ageing.current * 100) / 100,
      oneToThirty: Math.round(ageing.oneToThirty * 100) / 100,
      thirtyOneToSixty: Math.round(ageing.thirtyOneToSixty * 100) / 100,
      sixtyOneToNinety: Math.round(ageing.sixtyOneToNinety * 100) / 100,
      overNinety: Math.round(ageing.overNinety * 100) / 100
    },
    availableCredit: 0
  };
}

/**
 * DEPRECATED CREDIT STATUS RESOLVER (WP-FI-1.1 Alignment)
 * Preserved for backward compatibility. Financial data is for reporting only and NEVER blocks orders or sets credit holds.
 */
export function resolveCreditStatus(
  profile: { active?: boolean; manualCreditHold?: boolean; creditLimit?: number },
  balances: any
): CreditStatusResolution {
  if (profile.active === false) {
    return {
      status: "INACTIVE",
      ruleApplied: "Account is marked inactive"
    };
  }

  return {
    status: "ACTIVE",
    ruleApplied: "Rule [WP-FI-1.1] NON_BLOCKING_FINANCIAL_INTELLIGENCE: Financial data recorded for collection & intelligence analysis only. Credit limits and holds retired."
  };
}

/**
 * Calculates running balances for ledger entries chronologically
 */
export function calculateRunningBalances(
  entries: CustomerLedgerEntry[],
  sortOrder: "asc" | "desc" = "desc"
): CustomerLedgerEntry[] {
  const chronological = [...entries].sort((a, b) => {
    const dateA = a.postingDate || a.createdAt || "";
    const dateB = b.postingDate || b.createdAt || "";
    if (dateA !== dateB) return dateA.localeCompare(dateB);
    const createdA = a.createdAt || "";
    const createdB = b.createdAt || "";
    if (createdA !== createdB) return createdA.localeCompare(createdB);
    return (a.id || "").localeCompare(b.id || "");
  });

  let currentRunning = 0;
  const computed = chronological.map(entry => {
    if (entry.status === "POSTED") {
      const debit = Number(entry.debitAmount || 0);
      const credit = Number(entry.creditAmount || 0);
      currentRunning += (debit - credit);
    }
    return {
      ...entry,
      runningBalance: Math.round(currentRunning * 100) / 100
    };
  });

  if (sortOrder === "desc") {
    return computed.reverse();
  }

  return computed;
}

/**
 * Validates a ledger entry prior to posting
 */
export function validateLedgerEntry(entry: Partial<CustomerLedgerEntry>): { valid: boolean; error?: string } {
  if (!entry.pharmacyId) {
    return { valid: false, error: "Pharmacy ID is required for ledger entry." };
  }

  const debit = Number(entry.debitAmount || 0);
  const credit = Number(entry.creditAmount || 0);

  if (debit < 0 || credit < 0) {
    return { valid: false, error: "Debit and credit amounts must be greater than or equal to zero." };
  }

  if (debit > 0 && credit > 0) {
    return { valid: false, error: "A ledger entry cannot have both debit and credit amounts greater than zero." };
  }

  if (debit === 0 && credit === 0) {
    return { valid: false, error: "Zero-value ledger entries are prohibited." };
  }

  if (!entry.currency || !/^[A-Z]{3}$/.test(entry.currency)) {
    return { valid: false, error: "A canonical ISO currency code is required." };
  }

  return { valid: true };
}

/** Exact currency arithmetic for the new primitives; never round an invalid command. */
export function financialMinorUnits(amount: number, decimalPlaces: number): number {
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0 || !Number.isInteger(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > 6) throw new Error("INVALID_FINANCIAL_AMOUNT");
  const scaled = amount * 10 ** decimalPlaces;
  const rounded = Math.round(scaled);
  if (!Number.isSafeInteger(rounded) || Math.abs(scaled - rounded) > 1e-7) throw new Error("INVALID_FINANCIAL_PRECISION");
  return rounded;
}
export function settlementProjection(original: number, credited: number, applied: number, precision: number) {
  const obligation = financialMinorUnits(original, precision) - financialMinorUnits(credited, precision);
  const paid = financialMinorUnits(applied, precision);
  if (obligation < 0 || paid > obligation) throw new Error("SETTLEMENT_OVERALLOCATED");
  return { invoiceCreditedAmount: credited, isOpen: obligation > paid, invoiceAppliedAmount: applied, invoiceOpenAmount: (obligation - paid) / 10 ** precision,
    paidAmount: applied, paidStatus: paid === 0 ? "Unpaid" : paid === obligation ? "Paid" : "Partially Paid",
    financiallyClosed: obligation === paid };
}

/** Reconstruct from immutable positive allocation/link-reversal events, without removing originals. */
export function reconstructAllocationProjection(original: number, credited: number, events: readonly import("./arTypes").PaymentAllocationEvent[], precision: number) {
  const first = events[0];
  if (events.some(event => event.invoiceLedgerId !== first.invoiceLedgerId || event.orderId !== first.orderId || event.pharmacyId !== first.pharmacyId || event.marketId !== first.marketId || event.currencyCode !== first.currencyCode)) throw new Error("ALLOCATION_IDENTITY_MISMATCH");
  const originals = new Map(events.filter(event => !event.reversesAllocationId).map(event => [event.id, event]));
  const ids = new Set<string>(), reversed = new Set<string>();
  let applied = 0;
  for (const event of events) {
    if (ids.has(event.id)) throw new Error("DUPLICATE_ALLOCATION_EVENT");
    ids.add(event.id);
    const units = financialMinorUnits(event.amount, precision);
    if (units <= 0) throw new Error("INVALID_ALLOCATION_EVENT");
    if (event.reversesAllocationId) {
      const originalEvent = originals.get(event.reversesAllocationId);
      if (!originalEvent || reversed.has(originalEvent.id) || originalEvent.amount !== event.amount ||
        originalEvent.invoiceLedgerId !== event.invoiceLedgerId || originalEvent.paymentLedgerId !== event.paymentLedgerId ||
        originalEvent.pharmacyId !== event.pharmacyId || originalEvent.marketId !== event.marketId || originalEvent.currencyCode !== event.currencyCode) throw new Error("INVALID_ALLOCATION_REVERSAL");
      reversed.add(originalEvent.id); applied -= units;
    } else applied += units;
  }
  return settlementProjection(original, credited, applied / 10 ** precision, precision);
}
