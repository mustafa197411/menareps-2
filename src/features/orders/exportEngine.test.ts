import { 
  resolveAndValidateOrderForExport,
  exportCommercialInvoiceDocx,
  exportCommercialInvoicePdf,
  exportDeliveryNoteDocx,
  exportDeliveryNotePdf
} from "./exportEngine";

async function runTests() {
  console.log("=== RUNNING WP-EXPORT-1.0 UNIT TESTS ===");

  // Test 1: Incomplete Order - Missing Pharmacy
  const res1 = resolveAndValidateOrderForExport({ id: "ORD-1", items: [{ productName: "P1" }] });
  if (res1.valid) {
    throw new Error("Test 1 Failed: Should reject order with missing pharmacy");
  }
  console.log("✓ Test 1 Passed: Correctly rejects order missing pharmacy");

  // Test 2: Incomplete Order - Missing Products
  const res2 = resolveAndValidateOrderForExport({ id: "ORD-2", pharmacyName: "Pharma A", items: [] });
  if (res2.valid) {
    throw new Error("Test 2 Failed: Should reject order with missing items");
  }
  console.log("✓ Test 2 Passed: Correctly rejects order missing products");

  // Test 3: Valid Order Resolution
  const mockOrder = {
    id: "ORD-999",
    displayNumber: "999",
    pharmacyName: "Ibn Sina Pharmacy",
    pharmacyAddress: "Hai Al Andalus, Tripoli",
    pharmacyPhone: "+218 91 123 4567",
    salesRep: "Omar Rep",
    deliveryOfficerName: "Khaled Driver",
    createdAt: "2026-07-30T10:00:00Z",
    items: [
      { productName: "Amoxicillin 500mg", sku: "AMX-500", quantity: 10, unitPrice: 25.0, discount: 5 },
      { productName: "Paracetamol 500mg", sku: "PCM-500", quantity: 50, unitPrice: 5.0, discount: 0 }
    ],
    subtotal: 500,
    discountAmount: 12.5,
    total: 487.50
    ,currencyCode: "LYD"
  };

  const res3 = resolveAndValidateOrderForExport(mockOrder);
  if (!res3.valid || !res3.order) {
    throw new Error("Test 3 Failed: Valid order resolution failed");
  }

  if (res3.order.invoiceNumber !== "INV-999") {
    throw new Error(`Test 3 Failed: Expected invoiceNumber INV-999, got ${res3.order.invoiceNumber}`);
  }

  if (res3.order.deliveryNoteNumber !== "DN-999") {
    throw new Error(`Test 3 Failed: Expected deliveryNoteNumber DN-999, got ${res3.order.deliveryNoteNumber}`);
  }

  if (res3.order.englishDate !== "2026-07-30") {
    throw new Error(`Test 3 Failed: Expected englishDate 2026-07-30, got ${res3.order.englishDate}`);
  }

  if (res3.order.arabicDate !== "30/07/2026") {
    throw new Error(`Test 3 Failed: Expected arabicDate 30/07/2026, got ${res3.order.arabicDate}`);
  }

  if (res3.order.items.length !== 2) {
    throw new Error("Test 3 Failed: Items count mismatch");
  }

  console.log("✓ Test 3 Passed: Order resolved and formatted with proper numbers and dates");

  console.log("ALL WP-EXPORT-1.0 UNIT TESTS PASSED SUCCESSFULLY!");
}

runTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
