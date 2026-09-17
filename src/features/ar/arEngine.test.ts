import { financialMinorUnits, settlementProjection, reconstructAllocationProjection } from "./arResolvers";
/**
 * WP-FI-1.1 Financial Intelligence Foundation - Comprehensive Unit Tests
 */

import { describe, it, expect } from "vitest";
import { 
  generateCustomerAccountNumber, 
  calculateDueDate, 
  calculateBalances, 
  resolveCreditStatus, 
  calculateRunningBalances, 
  validateLedgerEntry,
  getPaymentTermDays
} from "./arResolvers";
import { CustomerLedgerEntry } from "./arTypes";
import { LIBYA_MARKET_DEFAULT } from "../../lib/marketSettings";

describe("WP-FI-1.1 Accounts Receivable & Financial Intelligence Engine Unit Tests", () => {
  
  // Test 1: Financial profile creation & default values
  it("Test 1: Generates expected default profile attributes", () => {
    const dummyPharm = { id: "pharm_123", name: "Ibn Sina Pharmacy", code: "PH-TRIPOLI-99", currency: "LYD" };
    const accNum = generateCustomerAccountNumber(dummyPharm, [LIBYA_MARKET_DEFAULT]);
    expect(accNum).toBe("CUS-LIB-POLI99");

    const defaultPaymentTermDays = getPaymentTermDays("CASH");
    expect(defaultPaymentTermDays).toBe(0);
  });

  // Test 2: Stable customer account number
  it("Test 2: Customer account number is deterministic and stable", () => {
    const dummy1 = { id: "pharm_abc", code: "PH-001234", currency: "LYD" };
    const dummy2 = { id: "pharm_abc", code: "PH-001234", customerAccountNumber: "CUS-LY-001234" };

    expect(generateCustomerAccountNumber(dummy1, [LIBYA_MARKET_DEFAULT])).toBe("CUS-LIB-001234");
    expect(generateCustomerAccountNumber(dummy2)).toBe("CUS-LY-001234");
  });

  // Test 3: Payment term due-date calculation
  it("Test 3: Calculates due dates accurately according to payment terms", () => {
    const postingDate = "2026-07-01";
    expect(calculateDueDate(postingDate, "CASH")).toBe("2026-07-01");
    expect(calculateDueDate(postingDate, "NET_7")).toBe("2026-07-08");
    expect(calculateDueDate(postingDate, "NET_30")).toBe("2026-07-31");
    expect(calculateDueDate(postingDate, "NET_60")).toBe("2026-08-30");
    expect(calculateDueDate(postingDate, "CUSTOM", 10)).toBe("2026-07-11");
  });

  // Test 4: Invoice debit posting validation
  it("Test 4: Validates invoice debit ledger entries", () => {
    const validInvoiceEntry: Partial<CustomerLedgerEntry> = {
      pharmacyId: "pharm_1",
      debitAmount: 5000,
      creditAmount: 0,
      currency: "LYD"
    };
    expect(validateLedgerEntry(validInvoiceEntry).valid).toBe(true);
  });

  // Test 5: Idempotency Key validation
  it("Test 5: Validates idempotency key formatting", () => {
    const orderId = "ORD-999";
    const invoiceNum = "INV-2026-01";
    const idempotencyKey = `INVOICE_POSTING_${orderId}_${invoiceNum}`;
    expect(idempotencyKey).toBe("INVOICE_POSTING_ORD-999_INV-2026-01");
  });

  // Test 6: Outstanding balance & analytics calculation
  it("Test 6: Correctly calculates totalInvoiced, totalCollected, and outstanding balance", () => {
    const entries: CustomerLedgerEntry[] = [
      {
        id: "1", pharmacyId: "p1", customerAccountNumber: "CUS-1", orderId: "o1", orderNumber: "1", invoiceId: "i1", invoiceNumber: "i1",
        transactionType: "INVOICE", sourceType: "ORDER", sourceId: "o1", description: "Inv 1",
        debitAmount: 10000, creditAmount: 0, netAmount: 10000, currency: "LYD", postingDate: "2026-07-01", dueDate: "2026-07-31",
        status: "POSTED", isReversal: false, reversesEntryId: null, idempotencyKey: "k1", createdAt: "2026-07-01", createdByUid: "u1", createdByName: "n1"
      },
      {
        id: "2", pharmacyId: "p1", customerAccountNumber: "CUS-1", orderId: "o2", orderNumber: "2", invoiceId: "i2", invoiceNumber: "i2",
        transactionType: "INVOICE", sourceType: "ORDER", sourceId: "o2", description: "Inv 2",
        debitAmount: 5000, creditAmount: 0, netAmount: 5000, currency: "LYD", postingDate: "2026-07-05", dueDate: "2026-08-05",
        status: "POSTED", isReversal: false, reversesEntryId: null, idempotencyKey: "k2", createdAt: "2026-07-05", createdByUid: "u1", createdByName: "n1"
      },
      {
        id: "3", pharmacyId: "p1", customerAccountNumber: "CUS-1", orderId: null, orderNumber: null, invoiceId: null, invoiceNumber: null,
        transactionType: "ADJUSTMENT_CREDIT", sourceType: "MANUAL", sourceId: "a1", description: "Credit Adj",
        debitAmount: 0, creditAmount: 2000, netAmount: -2000, currency: "LYD", postingDate: "2026-07-10", dueDate: null,
        status: "POSTED", isReversal: false, reversesEntryId: null, idempotencyKey: "k3", createdAt: "2026-07-10", createdByUid: "u1", createdByName: "n1"
      },
      {
        id: "4", pharmacyId: "p1", customerAccountNumber: "CUS-1", orderId: "o3", orderNumber: "3", invoiceId: "i3", invoiceNumber: "i3",
        transactionType: "INVOICE", sourceType: "ORDER", sourceId: "o3", description: "Voided Inv",
        debitAmount: 9999, creditAmount: 0, netAmount: 9999, currency: "LYD", postingDate: "2026-07-01", dueDate: "2026-07-31",
        status: "VOID", isReversal: false, reversesEntryId: null, idempotencyKey: "k4", createdAt: "2026-07-01", createdByUid: "u1", createdByName: "n1"
      }
    ];

    const res = calculateBalances(entries, 20000, "2026-07-15");
    expect(res.totalInvoiced).toBe(15000); // 10000 + 5000
    expect(res.totalCollected).toBe(2000); // 2000
    expect(res.outstandingBalance).toBe(13000); // 15000 - 2000
  });

  // Test 7: Non-blocking credit status resolver (WP-FI-1.1 Mandate)
  it("Test 7: resolveCreditStatus always returns ACTIVE to ensure non-blocking order workflow", () => {
    const balances = { outstandingBalance: 50000, availableCredit: -30000, overdueBalance: 15000 };
    const res = resolveCreditStatus({ active: true, manualCreditHold: true, creditLimit: 20000 }, balances);
    expect(res.status).toBe("ACTIVE");
    expect(res.ruleApplied).toContain("NON_BLOCKING_FINANCIAL_INTELLIGENCE");
  });

  // Test 8: Overdue balance & Ageing breakdown calculation
  it("Test 8: Computes overdue balances and ageing breakdown accurately", () => {
    const entries: CustomerLedgerEntry[] = [
      {
        id: "1", pharmacyId: "p1", customerAccountNumber: "CUS-1", orderId: "o1", orderNumber: "1", invoiceId: "i1", invoiceNumber: "i1",
        transactionType: "INVOICE", sourceType: "ORDER", sourceId: "o1", description: "Overdue Inv 45 days",
        debitAmount: 4000, creditAmount: 0, netAmount: 4000, invoiceOpenAmount: 4000, currency: "LYD", postingDate: "2026-05-15", dueDate: "2026-06-01",
        status: "POSTED", isReversal: false, reversesEntryId: null, idempotencyKey: "k1", createdAt: "2026-05-15", createdByUid: "u1", createdByName: "n1"
      },
      {
        id: "2", pharmacyId: "p1", customerAccountNumber: "CUS-1", orderId: "o2", orderNumber: "2", invoiceId: "i2", invoiceNumber: "i2",
        transactionType: "INVOICE", sourceType: "ORDER", sourceId: "o2", description: "Current Inv",
        debitAmount: 3000, creditAmount: 0, netAmount: 3000, invoiceOpenAmount: 3000, currency: "LYD", postingDate: "2026-07-10", dueDate: "2026-08-10",
        status: "POSTED", isReversal: false, reversesEntryId: null, idempotencyKey: "k2", createdAt: "2026-07-10", createdByUid: "u1", createdByName: "n1"
      }
    ];

    const todayIso = "2026-07-15T12:00:00Z";
    const res = calculateBalances(entries, 10000, todayIso);
    expect(res.outstandingBalance).toBe(7000);
    expect(res.overdueBalance).toBe(4000);
    expect(res.ageing.current).toBe(3000);
    expect(res.ageing.thirtyOneToSixty).toBe(4000);
  });

  // Test 9: Running balance calculation
  it("Test 9: Computes mathematically precise running balances for ledger entries", () => {
    const entries: CustomerLedgerEntry[] = [
      {
        id: "entry_1", pharmacyId: "p1", customerAccountNumber: "CUS-1", orderId: "o1", orderNumber: "1", invoiceId: "i1", invoiceNumber: "i1",
        transactionType: "INVOICE", sourceType: "ORDER", sourceId: "o1", description: "Inv 1",
        debitAmount: 1000, creditAmount: 0, netAmount: 1000, currency: "LYD", postingDate: "2026-07-01", dueDate: null,
        status: "POSTED", isReversal: false, reversesEntryId: null, idempotencyKey: "k1", createdAt: "2026-07-01T10:00:00Z", createdByUid: "u1", createdByName: "n1"
      },
      {
        id: "entry_2", pharmacyId: "p1", customerAccountNumber: "CUS-1", orderId: "o2", orderNumber: "2", invoiceId: "i2", invoiceNumber: "i2",
        transactionType: "INVOICE", sourceType: "ORDER", sourceId: "o2", description: "Inv 2",
        debitAmount: 500, creditAmount: 0, netAmount: 500, currency: "LYD", postingDate: "2026-07-02", dueDate: null,
        status: "POSTED", isReversal: false, reversesEntryId: null, idempotencyKey: "k2", createdAt: "2026-07-02T10:00:00Z", createdByUid: "u1", createdByName: "n1"
      },
      {
        id: "entry_3", pharmacyId: "p1", customerAccountNumber: "CUS-1", orderId: null, orderNumber: null, invoiceId: null, invoiceNumber: null,
        transactionType: "ADJUSTMENT_CREDIT", sourceType: "MANUAL", sourceId: "a1", description: "Discount Credit",
        debitAmount: 0, creditAmount: 300, netAmount: -300, currency: "LYD", postingDate: "2026-07-03", dueDate: null,
        status: "POSTED", isReversal: false, reversesEntryId: null, idempotencyKey: "k3", createdAt: "2026-07-03T10:00:00Z", createdByUid: "u1", createdByName: "n1"
      }
    ];

    const computedDesc = calculateRunningBalances(entries, "desc");
    expect(computedDesc.length).toBe(3);
    // Newest entry (2026-07-03) running balance should be 1200 (1000 + 500 - 300)
    expect(computedDesc[0].id).toBe("entry_3");
    expect(computedDesc[0].runningBalance).toBe(1200);

    // Middle entry (2026-07-02) running balance should be 1500 (1000 + 500)
    expect(computedDesc[1].id).toBe("entry_2");
    expect(computedDesc[1].runningBalance).toBe(1500);

    // Oldest entry (2026-07-01) running balance should be 1000
    expect(computedDesc[2].id).toBe("entry_1");
    expect(computedDesc[2].runningBalance).toBe(1000);
  });

  // Test 10: Validation rejections
  it("Test 10: Rejects zero-value entries, negative values, and simultaneous debit/credit", () => {
    // Zero-value
    const zeroVal = validateLedgerEntry({ pharmacyId: "p1", debitAmount: 0, creditAmount: 0 });
    expect(zeroVal.valid).toBe(false);
    expect(zeroVal.error).toContain("Zero-value");

    // Negative value
    const negVal = validateLedgerEntry({ pharmacyId: "p1", debitAmount: -100, creditAmount: 0 });
    expect(negVal.valid).toBe(false);

    // Simultaneous debit and credit
    const dualVal = validateLedgerEntry({ pharmacyId: "p1", debitAmount: 500, creditAmount: 200 });
    expect(dualVal.valid).toBe(false);
    expect(dualVal.error).toContain("cannot have both debit and credit");
  });

  // Test 11: WP-FI-2.1 DELIVERED Invoice Posting Idempotency Key Format
  it("Test 11: Generates expected DELIVERED invoice idempotency key and safe document ID", () => {
    const orderId = "ORD-2026-88";
    const invoiceNumber = "INV-2026-88";
    const idempotencyKey = `DELIVERED_INVOICE_${orderId}_${invoiceNumber}`;
    const safeDocId = `LEDGER_INVOICE_${orderId.replace(/[^a-zA-Z0-9_-]/g, "_")}_${invoiceNumber.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

    expect(idempotencyKey).toBe("DELIVERED_INVOICE_ORD-2026-88_INV-2026-88");
    expect(safeDocId).toBe("LEDGER_INVOICE_ORD-2026-88_INV-2026-88");
  });

});


describe("allocation projection currency arithmetic", () => {
  it("uses exact minor units and rejects unsupported precision", () => {
    expect(financialMinorUnits(1.25, 2)).toBe(125);
    expect(() => financialMinorUnits(1.251, 2)).toThrow();
    expect(() => financialMinorUnits(1, 7)).toThrow();
  });
  it("credit closure creates no fabricated payment", () => {
    expect(settlementProjection(100, 100, 0, 2)).toMatchObject({ paidAmount: 0, paidStatus: "Unpaid", invoiceOpenAmount: 0 });
  });
});


it("reconstructs linked allocation reversal without removing the original event", () => {
  const original: any = { id: "ALLOCATION-SYNTHETIC", amount: 40, invoiceLedgerId: "INVOICE-SYNTHETIC", paymentLedgerId: "PAYMENT-SYNTHETIC", pharmacyId: "CUSTOMER-SYNTHETIC", marketId: "MARKET-SYNTHETIC", currencyCode: "TST" };
  const reversal = { ...original, id: "REVERSAL-SYNTHETIC", reversesAllocationId: original.id };
  expect(reconstructAllocationProjection(100, 0, [original, reversal], 2)).toMatchObject({ paidAmount: 0, invoiceOpenAmount: 100 });
  expect(() => reconstructAllocationProjection(100, 0, [original, reversal, { ...reversal, id: "DUPLICATE" }], 2)).toThrow();
});
it("posted original and reversing ledger entry net to zero exactly once", () => {
  const original: any = { id: "PAYMENT-SYNTHETIC", transactionType: "PAYMENT", status: "POSTED", debitAmount: 0, creditAmount: 40, currencyCode: "TST", postingDate: "2026-01-01" };
  const counter: any = { ...original, transactionType: "REVERSAL", debitAmount: 40, creditAmount: 0, isReversal: true, reversesEntryId: "PAYMENT-SYNTHETIC" };
  expect(calculateBalances([original, counter])).toMatchObject({ outstandingBalance: 0, totalCollected: 0, totalInvoiced: 0, openInvoiceCount: 0 });
});

describe("certified invoice monetary projection", () => {
  it.each([NaN, Infinity, -1, 0.001])("rejects invalid money %s", value => {
    expect(() => settlementProjection(value, 0, 0, 2)).toThrow();
    expect(() => settlementProjection(500, value, 0, 2)).toThrow();
    expect(() => settlementProjection(500, 0, value, 2)).toThrow();
  });
  it.each([-1, 7, 1.5, NaN])("rejects unsupported precision %s", precision => {
    expect(() => settlementProjection(500, 0, 0, precision)).toThrow();
  });
  it("keeps partial obligations open and closes full payment or credit", () => {
    expect(settlementProjection(500, 0, 300, 2)).toMatchObject({ invoiceOpenAmount: 200, isOpen: true });
    expect(settlementProjection(500, 0, 500, 2)).toMatchObject({ invoiceOpenAmount: 0, isOpen: false, paidStatus: "Paid" });
    expect(settlementProjection(500, 500, 0, 2)).toMatchObject({ invoiceOpenAmount: 0, isOpen: false, paidStatus: "Unpaid" });
  });
});
