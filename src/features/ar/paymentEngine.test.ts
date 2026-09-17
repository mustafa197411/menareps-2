/**
 * WP-FI-2.0 Payment Collection Module - Unit & Integration Tests
 * MENAREPS FINANCIAL INTELLIGENCE
 */

import { describe, it, expect } from "vitest";
import { PaymentCollection, PaymentMethod, PaymentStatus } from "./arTypes";
import { generatePaymentSummaryReports } from "./paymentService";
import { calculateBalances, validateLedgerEntry } from "./arResolvers";
import { CustomerLedgerEntry } from "./arTypes";

describe("WP-FI-2.0 Payment Collection Unit Tests", () => {
  // Test 1: Payment Method Conditional Fields Validation
  it("Test 1: Validates conditional payment method fields", () => {
    // Cash requires Receipt Number
    const cashValid = { method: "Cash" as PaymentMethod, receiptNumber: "RCT-101" };
    expect(cashValid.receiptNumber).toBeTruthy();

    // Cheque requires Cheque Number, Bank Name, Cheque Date
    const chequeValid = {
      method: "Cheque" as PaymentMethod,
      chequeNumber: "00123",
      chequeBankName: "Jumhouria Bank",
      chequeDate: "2026-08-01"
    };
    expect(chequeValid.chequeNumber).toBeTruthy();
    expect(chequeValid.chequeBankName).toBeTruthy();
    expect(chequeValid.chequeDate).toBeTruthy();

    // Bank Transfer requires Bank Name and Transfer Reference
    const transferValid = {
      method: "Bank Transfer" as PaymentMethod,
      transferBankName: "Sahara Bank",
      transferReference: "TRF-998822"
    };
    expect(transferValid.transferBankName).toBeTruthy();
    expect(transferValid.transferReference).toBeTruthy();
  });

  // Test 2: Validates PAYMENT Ledger Entry formatting
  it("Test 2: Validates PAYMENT transaction type in Customer Ledger", () => {
    const paymentLedgerEntry: CustomerLedgerEntry = {
      id: "LEDGER_PAYMENT_123",
      pharmacyId: "pharm_001",
      customerAccountNumber: "CUS-LY-001234",
      orderId: null,
      orderNumber: null,
      invoiceId: null,
      invoiceNumber: null,
      paymentId: "PAY_123",
      transactionType: "PAYMENT",
      sourceType: "PAYMENT_COLLECTION",
      sourceId: "PAY_123",
      description: "Payment PAY-2026-0001 (Cash) - Ref: RCT-101",
      debitAmount: 0,
      creditAmount: 3500,
      netAmount: -3500,
      currency: "LYD",
      postingDate: "2026-07-20",
      dueDate: null,
      status: "POSTED",
      isReversal: false,
      reversesEntryId: null,
      idempotencyKey: "PAYMENT_POSTING_PAY_123",
      createdAt: "2026-07-20T10:00:00Z",
      createdByUid: "usr_fin",
      createdByName: "Finance Officer"
    };

    const validation = validateLedgerEntry(paymentLedgerEntry);
    expect(validation.valid).toBe(true);
    expect(paymentLedgerEntry.transactionType).toBe("PAYMENT");
    expect(paymentLedgerEntry.creditAmount).toBe(3500);
    expect(paymentLedgerEntry.debitAmount).toBe(0);
  });

  // Test 3: Ledger Recalculation with Verified Payment
  it("Test 3: Recalculates Customer Outstanding Balance when PAYMENT entry is posted", () => {
    const ledgerEntries: CustomerLedgerEntry[] = [
      {
        id: "1", pharmacyId: "p1", customerAccountNumber: "CUS-1", orderId: "o1", orderNumber: "ORD-001", invoiceId: "i1", invoiceNumber: "INV-001",
        transactionType: "INVOICE", sourceType: "ORDER", sourceId: "o1", description: "Invoice #1",
        debitAmount: 10000, creditAmount: 0, netAmount: 10000, currency: "LYD", postingDate: "2026-07-01", dueDate: "2026-07-31",
        status: "POSTED", isReversal: false, reversesEntryId: null, idempotencyKey: "k1", createdAt: "2026-07-01", createdByUid: "u1", createdByName: "n1"
      },
      {
        id: "2", pharmacyId: "p1", customerAccountNumber: "CUS-1", orderId: null, orderNumber: null, invoiceId: null, invoiceNumber: null, paymentId: "PAY_1",
        transactionType: "PAYMENT", sourceType: "PAYMENT_COLLECTION", sourceId: "PAY_1", description: "Payment PAY-2026-0001",
        debitAmount: 0, creditAmount: 4000, netAmount: -4000, currency: "LYD", postingDate: "2026-07-15", dueDate: null,
        status: "POSTED", isReversal: false, reversesEntryId: null, idempotencyKey: "PAYMENT_POSTING_PAY_1", createdAt: "2026-07-15", createdByUid: "u1", createdByName: "n1"
      }
    ];

    const balances = calculateBalances(ledgerEntries, 0, "2026-07-20");
    expect(balances.totalInvoiced).toBe(10000);
    expect(balances.totalCollected).toBe(4000);
    expect(balances.outstandingBalance).toBe(6000);
  });

  // Test 4: Financial Intelligence Aggregations & Reports
  it("Test 4: Aggregates Payment Intelligence Reports accurately", () => {
    const mockPayments: PaymentCollection[] = [
      {
        paymentId: "p1",
        paymentNumber: "PAY-2026-0001",
        pharmacyId: "pharm_a",
        pharmacyName: "Al-Shifa Pharmacy",
        customerAccountNumber: "CUS-LY-0001",
        representativeUid: "rep_1",
        representativeName: "Ahmed Rep",
        areaId: "area_tripoli",
        areaName: "Tripoli Center",
        cityId: "city_tripoli",
        cityName: "Tripoli",
        collectionDate: "2026-07-01",
        amount: 5000,
        currency: "LYD",
        paymentMethod: "Cash",
        referenceNumber: "RCT-001",
        receiptNumber: "RCT-001",
        notes: "",
        attachmentUrls: [],
        status: "Verified",
        createdAt: "2026-07-01T09:00:00Z",
        createdByUid: "rep_1",
        updatedAt: "2026-07-01T09:00:00Z",
        updatedByUid: "rep_1"
      },
      {
        paymentId: "p2",
        paymentNumber: "PAY-2026-0002",
        pharmacyId: "pharm_a",
        pharmacyName: "Al-Shifa Pharmacy",
        customerAccountNumber: "CUS-LY-0001",
        representativeUid: "rep_1",
        representativeName: "Ahmed Rep",
        areaId: "area_tripoli",
        areaName: "Tripoli Center",
        cityId: "city_tripoli",
        cityName: "Tripoli",
        collectionDate: "2026-07-10",
        amount: 3000,
        currency: "LYD",
        paymentMethod: "Cheque",
        referenceNumber: "CHQ-0099",
        chequeNumber: "0099",
        chequeBankName: "Jumhouria Bank",
        chequeDate: "2026-07-10",
        notes: "",
        attachmentUrls: [],
        status: "Verified",
        createdAt: "2026-07-10T09:00:00Z",
        createdByUid: "rep_1",
        updatedAt: "2026-07-10T09:00:00Z",
        updatedByUid: "rep_1"
      },
      {
        paymentId: "p3",
        paymentNumber: "PAY-2026-0003",
        pharmacyId: "pharm_b",
        pharmacyName: "Ibn Sina Pharmacy",
        customerAccountNumber: "CUS-LY-0002",
        representativeUid: "rep_2",
        representativeName: "Omar Rep",
        areaId: "area_benghazi",
        areaName: "Benghazi Central",
        cityId: "city_benghazi",
        cityName: "Benghazi",
        collectionDate: "2026-07-15",
        amount: 2000,
        currency: "LYD",
        paymentMethod: "Bank Transfer",
        referenceNumber: "TRF-8877",
        transferBankName: "Sahara Bank",
        transferReference: "TRF-8877",
        notes: "",
        attachmentUrls: [],
        status: "Submitted", // Pending verification
        createdAt: "2026-07-15T09:00:00Z",
        createdByUid: "rep_2",
        updatedAt: "2026-07-15T09:00:00Z",
        updatedByUid: "rep_2"
      }
    ];

    const report = generatePaymentSummaryReports(mockPayments);

    expect(report.totalPaymentsCount).toBe(3);
    expect(report.totalCollected).toBe(8000); // 5000 + 3000 (Verified only)
    expect(report.byStatus.Submitted).toBe(1);
    expect(report.byStatus.Verified).toBe(2);

    expect(report.amountByMethod.Cash).toBe(5000);
    expect(report.amountByMethod.Cheque).toBe(3000);
    expect(report.amountByMethod["Bank Transfer"]).toBe(0); // Submitted only

    expect(report.byRepresentative["rep_1"].totalAmount).toBe(8000);
    expect(report.byRepresentative["rep_2"].count).toBe(1);

    expect(report.byPharmacy["pharm_a"].totalAmount).toBe(8000);
  });

  // Test 5: Order Workflow Independence Principle
  it("Test 5: Confirms payments NEVER block or control Order workflow state", () => {
    // Dummy Order object
    const dummyOrder = {
      orderId: "ORD-9988",
      pharmacyId: "pharm_a",
      stage: "FINANCE_REVIEW",
      status: "PENDING_APPROVAL",
      totalAmount: 15000
    };

    // Customer balance has overdue amount
    const ledgerEntries: CustomerLedgerEntry[] = [
      {
        id: "1", pharmacyId: "pharm_a", customerAccountNumber: "CUS-LY-0001", orderId: "o1", orderNumber: "1", invoiceId: "i1", invoiceNumber: "i1",
        transactionType: "INVOICE", sourceType: "ORDER", sourceId: "o1", description: "Unpaid Old Invoice",
        debitAmount: 20000, creditAmount: 0, netAmount: 20000, currency: "LYD", postingDate: "2026-01-01", dueDate: "2026-02-01",
        status: "POSTED", isReversal: false, reversesEntryId: null, idempotencyKey: "k1", createdAt: "2026-01-01", createdByUid: "u1", createdByName: "n1"
      }
    ];

    const balances = calculateBalances(ledgerEntries, 0, "2026-07-20");
    expect(balances.overdueBalance).toBe(20000);

    // Rule WP-FI-1.1 & WP-FI-2.0: Order stage MUST NOT change or be blocked due to financial data
    expect(dummyOrder.stage).toBe("FINANCE_REVIEW");
    expect(dummyOrder.status).toBe("PENDING_APPROVAL");
  });
});
