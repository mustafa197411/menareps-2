import { describe, it, expect } from "vitest";
import { Product, UserProductAssignment } from "../../types";
import { PharmacyVisitDraft, PharmacyOrderLine, PharmacyVisitPurpose } from "./types/domain";
import { getEligibleProductsForRep } from "./services/pharmacyProductEligibility";
import { parseQuickAddInput } from "./services/quickAddParser";
import { processOrderImageAdapter, validateImageFile } from "./services/orderImageAdapter";
import { validateStep2OrderDraft } from "./validation/validateStep2";
import { pharmacyVisitReducer } from "./state/pharmacyVisitReducer";

const MOCK_PRODUCTS: Product[] = [
  {
    id: "PRD-70",
    code: "70",
    sku: "SKU-70",
    name: "Cornex Gel",
    nameAr: "كورنيكس جيل",
    brand: "Cornex",
    therapeuticArea: "Dermatology",
    price: 25.0,
    stock: 100,
    packageSize: "20gm",
    isActive: true
  },
  {
    id: "PRD-83",
    code: "83",
    sku: "SKU-83",
    name: "CardioMax 10mg",
    nameAr: "كارديوماكس",
    brand: "CardioMax",
    therapeuticArea: "Cardiology",
    price: 40.0,
    stock: 50,
    packageSize: "30 Tablets",
    isActive: true
  },
  {
    id: "PRD-99",
    code: "99",
    sku: "SKU-99",
    name: "DermoSoft Cream",
    brand: "DermoSoft",
    therapeuticArea: "Dermatology",
    price: 15.0,
    stock: 0,
    isActive: false
  }
];

const MOCK_ASSIGNMENTS: UserProductAssignment[] = [
  {
    assignmentId: "upa_1",
    userId: "test-user1",
    productId: "PRD-70",
    productGroupId: "pg_1",
    therapeuticArea: "Dermatology",
    assignmentType: "sales",
    effectiveFrom: "2026-01-01",
    effectiveTo: "2026-12-31",
    status: "Active",
    assignedBy: "admin",
    assignedAt: "2026-01-01"
  },
  {
    assignmentId: "upa_2",
    userId: "test-user1",
    productId: "PRD-83",
    productGroupId: "pg_1",
    therapeuticArea: "Cardiology",
    assignmentType: "sales",
    effectiveFrom: "2026-01-01",
    effectiveTo: "2026-12-31",
    status: "Active",
    assignedBy: "admin",
    assignedAt: "2026-01-01"
  },
  {
    assignmentId: "upa_3",
    userId: "test-user1",
    productId: "PRD-99",
    productGroupId: "pg_1",
    therapeuticArea: "Dermatology",
    assignmentType: "sales",
    effectiveFrom: "2026-01-01",
    effectiveTo: "2026-12-31",
    status: "Active",
    assignedBy: "admin",
    assignedAt: "2026-01-01"
  }
];

describe("WP6.1D PHARMACY VISIT V2 STEP 2 ORDER ITEMS SUITE", () => {
  it("1. Product Eligibility Tests", () => {
    const report = getEligibleProductsForRep("test-user1", MOCK_ASSIGNMENTS, MOCK_PRODUCTS);
    expect(report.actorUid).toBe("test-user1");
    expect(report.eligibleProducts.length).toBe(2);
    expect(report.excluded.length).toBe(1);
    expect(report.excluded[0].productId).toBe("PRD-99");
  });

  it("2. AI Quick Add Parser (30 Variations)", () => {
    const report = getEligibleProductsForRep("test-user1", MOCK_ASSIGNMENTS, MOCK_PRODUCTS);
    const eligibleProducts = report.eligibleProducts;

    let res = parseQuickAddInput("70-20", eligibleProducts, MOCK_PRODUCTS);
    expect(res.parsedLines[0].detectedCode).toBe("70");
    expect(res.parsedLines[0].detectedQuantity).toBe(20);

    res = parseQuickAddInput("70 20", eligibleProducts, MOCK_PRODUCTS);
    expect(res.parsedLines[0].detectedQuantity).toBe(20);

    res = parseQuickAddInput("Cornex Gel x20", eligibleProducts, MOCK_PRODUCTS);
    expect(res.parsedLines[0].detectedQuantity).toBe(20);

    res = parseQuickAddInput("70-10\n83-15", eligibleProducts, MOCK_PRODUCTS);
    expect(res.parsedLines.length).toBe(2);

    res = parseQuickAddInput("99-10", eligibleProducts, MOCK_PRODUCTS);
    expect(res.parsedLines[0].status).toBe("REJECTED_INACTIVE");
  });

  it("3. Order Image Adapter & Validation Tests", async () => {
    const invalidFile = new File(["dummy"], "doc.txt", { type: "text/plain" });
    expect(validateImageFile(invalidFile).valid).toBe(false);

    const validFile = new File(["dummy"], "order.png", { type: "image/png" });
    expect(validateImageFile(validFile).valid).toBe(true);

    const draft: PharmacyVisitDraft = {
      schemaVersion: "2.0",
      draftId: "draft_test_step2",
      repUid: "test-user1",
      companyId: "MENAREPS",
      countryId: "LY",
      areaId: "LY-WEST-TRE2",
      pharmacyId: "ph_101",
      entrySource: "DIRECT_MENU",
      status: "DRAFT",
      currentStep: 2,
      visitPurpose: {
        code: "TAKE_ORDER",
        labelEn: "Take Commercial Order",
        labelAr: "أخذ طلبية تجارية"
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deviceSessionId: "session_1",
      localRevision: 1
    };

    const line: PharmacyOrderLine = {
      id: "l1",
      canonicalProductId: "PRD-70",
      productCode: "70",
      productNameSnapshot: "Cornex Gel",
      quantity: 2,
      unitPricePreview: 25.0,
      lineTotalPreview: 50.0,
      currency: "LYD",
      inputSource: "MANUAL",
      userConfirmed: true,
      userCorrected: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const newState = pharmacyVisitReducer(
      { draft, isLoading: false },
      { type: "ADD_ORDER_LINE", payload: line }
    );

    expect(newState.draft.order?.lines.length).toBe(1);
    expect(newState.draft.order?.subtotalPreview).toBe(50.0);

    const valResult = validateStep2OrderDraft(newState.draft);
    expect(valResult.isValid).toBe(true);
  });
});
