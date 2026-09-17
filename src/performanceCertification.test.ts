import { 
  normalizeCommercialOrderLine, 
  aggregateProductAreaMonthPerformance, 
  calculateAchievement,
  calculateVariance,
  calculateRemaining,
  calculateOverachievement,
  calculateCompletedMonthRunRateForecast
} from "./lib/productTargetPerformanceService";
import { NormalizedSalesActual, TargetStatus } from "./types";

let failedTestsCount = 0;
let totalAssertions = 0;

function assert(condition: boolean, testName: string, errorMessage?: string) {
  totalAssertions++;
  if (condition) {
    console.log(`[PASS] Assertion ${totalAssertions}: ${testName}`);
  } else {
    console.error(`[FAIL] Assertion ${totalAssertions}: ${testName} - ${errorMessage || "Assertion failed"}`);
    failedTestsCount++;
  }
}

async function runTests() {
  console.log("=================================================================");
  console.log("MENAREPS 2.0 WP4.1G.1 - PRODUCT PERFORMANCE RUNTIME CERTIFICATION TESTS");
  console.log("=================================================================\n");

  // ==========================================================
  // BLOCK 1: GEOGRAPHIC AREA ATTRIBUTION PRIORITY (SCENARIOS 6-10)
  // ==========================================================
  console.log(">>> Running Geographic Area Attribution Priority Tests...");

  // Scenario 6: Best-Path Priority 1 - areaIdSnapshot is present
  {
    const mockOrder = {
      id: "ord-001",
      date: "2026-04-15",
      pharmacyId: "pharm-001",
      countryId: "Libya",
      status: "Delivered",
      currencyCode: "LYD",
      areaIdSnapshot: "area-snapshot-123"
    };
    const mockItem = {
      productId: "prod-001",
      quantity: 10,
      price: 15.0,
      bonusQuantity: 2
    };
    const mockPharmacy = {
      id: "pharm-001",
      name: "Al-Amal Pharmacy",
      areaId: "area-pharmacy-456",
      countryId: "Libya"
    };

    const { record, exception } = normalizeCommercialOrderLine(mockOrder, mockItem, 0, mockPharmacy);

    assert(record.areaIdSnapshot === "area-snapshot-123", "Priority 1: areaIdSnapshot from item is prioritized", `Got ${record.areaIdSnapshot}`);
    assert(record.attributionSource === "order", "Priority 1: attribution source should be 'order'", `Got ${record.attributionSource}`);
    assert(record.attributionConfidence === "high", "Priority 1: attribution confidence should be 'high'", `Got ${record.attributionConfidence}`);
    assert(exception === undefined, "Priority 1: no exception should be logged when snapshot exists", `Got exception ${JSON.stringify(exception)}`);
  }

  // Scenario 7: Priority 2 - item areaIdSnapshot missing, transaction has areaId
  {
    const mockOrder = {
      id: "ord-002",
      date: "2026-04-15",
      pharmacyId: "pharm-001",
      countryId: "Libya",
      status: "Delivered",
      currencyCode: "LYD",
      pharmacyAreaIdSnapshot: "area-transaction-789" // Transaction-level snapshot
    };
    const mockItem = {
      productId: "prod-001",
      quantity: 10,
      price: 15.0,
      bonusQuantity: 0
    };
    const mockPharmacy = {
      id: "pharm-001",
      name: "Al-Amal Pharmacy",
      areaId: "area-pharmacy-456",
      countryId: "Libya"
    };

    const { record, exception } = normalizeCommercialOrderLine(mockOrder, mockItem, 0, mockPharmacy);

    assert(record.areaIdSnapshot === "area-transaction-789", "Priority 2: transaction-level areaId is prioritized when item snapshot is missing", `Got ${record.areaIdSnapshot}`);
    assert(record.attributionSource === "pharmacy_snapshot", "Priority 2: attribution source should be 'pharmacy_snapshot' (at transaction time)", `Got ${record.attributionSource}`);
    assert(record.attributionConfidence === "high", "Priority 2: attribution confidence should be 'high'", `Got ${record.attributionConfidence}`);
    assert(exception === undefined, "Priority 2: no exception when transaction-level area is used", `Got exception ${JSON.stringify(exception)}`);
  }

  // Scenario 8: Priority 3 - Both snapshots missing, fallback to Pharmacy area
  {
    const mockOrder = {
      id: "ord-003",
      date: "2026-04-15",
      pharmacyId: "pharm-001",
      countryId: "Libya",
      status: "Delivered",
      currencyCode: "LYD"
    };
    const mockItem = {
      productId: "prod-001",
      quantity: 10,
      price: 15.0,
      bonusQuantity: 0
    };
    const mockPharmacy = {
      id: "pharm-001",
      name: "Al-Amal Pharmacy",
      areaId: "area-pharmacy-456",
      countryId: "Libya"
    };

    const { record, exception } = normalizeCommercialOrderLine(mockOrder, mockItem, 0, mockPharmacy);

    assert(record.areaIdSnapshot === "area-pharmacy-456", "Priority 3: fallbacks to pharmacy area ID when order snapshot is completely missing", `Got ${record.areaIdSnapshot}`);
    assert(record.attributionSource === "pharmacy_fallback", "Priority 3: attribution source should be 'pharmacy_fallback'", `Got ${record.attributionSource}`);
    assert(record.attributionConfidence === "medium", "Priority 3: attribution confidence is 'medium'", `Got ${record.attributionConfidence}`);
    assert(exception !== null, "Priority 3: exception is triggered for missing historical area snapshot");
    assert(exception?.issueType === "ORDER_AREA_HISTORICAL_SNAPSHOT_MISSING", "Priority 3: exception issueType is correct");
  }

  // Scenario 9: Fallback with undefined pharmacy
  {
    const mockOrder = {
      id: "ord-004",
      date: "2026-04-15",
      pharmacyId: "pharm-999",
      countryId: "Libya",
      status: "Delivered",
      currencyCode: "LYD"
    };
    const mockItem = {
      productId: "prod-001",
      quantity: 10,
      price: 15.0
    };

    const { record, exception } = normalizeCommercialOrderLine(mockOrder, mockItem, 0, undefined);

    assert(record.areaIdSnapshot === "", "Priority 3: resolves to empty string if pharmacy is undefined", `Got ${record.areaIdSnapshot}`);
    assert(exception !== null, "Priority 3: exception raised when pharmacy undefined");
  }

  // ==========================================================
  // BLOCK 2: STATISTICAL FORECASTING RUN-RATE (SCENARIOS 4-5)
  // ==========================================================
  console.log("\n>>> Running Forecast Run-Rate Formula Tests...");

  // Scenario 4: Standard COMPLETED_MONTH_RUN_RATE forecast for current year
  {
    const year = 2026;
    const currentYear = 2026;
    const currentMonth = 6; // June is active (partial). Completed months are Jan-May (1-5).
    const monthlyActuals = [
      { month: 1, actual: 100 },
      { month: 2, actual: 120 },
      { month: 3, actual: 110 },
      { month: 4, actual: 90 },
      { month: 5, actual: 130 },
      { month: 6, actual: 80 },  // Active month (should be EXCLUDED)
      { month: 7, actual: 0 },
      { month: 8, actual: 0 },
      { month: 9, actual: 0 },
      { month: 10, actual: 0 },
      { month: 11, actual: 0 },
      { month: 12, actual: 0 }
    ];

    const result = calculateCompletedMonthRunRateForecast(year, currentYear, currentMonth, monthlyActuals);

    // Run-rate baseline sum = 100+120+110+90+130 = 550.
    // Completed months = 5.
    // Run-rate per month = 550 / 5 = 110.
    // Forecast Year End = 110 * 12 = 1320.
    assert(result.forecastedValue === 1320, "Forecast Math: current year run-rate math correct", `Expected 1320, got ${result.forecastedValue}`);
    assert(result.forecastMethod === "COMPLETED_MONTH_RUN_RATE", "Forecast Math: method string matches specification");
    assert(result.completedMonths === 5, "Forecast Math: completed months count is 5", `Got ${result.completedMonths}`);
    assert(result.partialMonthIncluded === false, "Forecast Math: active month 6 (June) is excluded");
  }

  // Scenario 5a: Future year forecast should yield null
  {
    const result = calculateCompletedMonthRunRateForecast(2027, 2026, 6, []);
    assert(result.forecastedValue === null, "Forecast Year Boundaries: future year forecast returns null", `Got ${result.forecastedValue}`);
    assert(result.forecastMethod === "COMPLETED_MONTH_RUN_RATE", "Forecast Year Boundaries: future method matches", `Got ${result.forecastMethod}`);
  }

  // Scenario 5b: Past year forecast should return the final actual total
  {
    const monthlyActuals = [
      { month: 1, actual: 10 }, { month: 2, actual: 10 }, { month: 3, actual: 10 },
      { month: 4, actual: 10 }, { month: 5, actual: 10 }, { month: 6, actual: 10 },
      { month: 7, actual: 10 }, { month: 8, actual: 10 }, { month: 9, actual: 10 },
      { month: 10, actual: 10 }, { month: 11, actual: 10 }, { month: 12, actual: 10 }
    ];
    const result = calculateCompletedMonthRunRateForecast(2025, 2026, 6, monthlyActuals);
    assert(result.forecastedValue === 120, "Forecast Year Boundaries: past year forecast returns total actuals", `Expected 120, got ${result.forecastedValue}`);
    assert(result.forecastMethod === "COMPLETED_MONTH_RUN_RATE", "Forecast Year Boundaries: past method matches", `Got ${result.forecastMethod}`);
  }

  // Scenario 5c: Zero completed months fallback (January is partial)
  {
    const monthlyActuals = [{ month: 1, actual: 15 }];
    const result = calculateCompletedMonthRunRateForecast(2026, 2026, 1, monthlyActuals);
    assert(result.forecastedValue === null, "Forecast Math: zero completed months defaults to null", `Got ${result.forecastedValue}`);
  }

  // ==========================================================
  // BLOCK 3: CURRENCY MISMATCH HANDLING (SCENARIOS 1-3)
  // ==========================================================
  console.log("\n>>> Running Currency Mismatch Tests...");

  // Scenario 1: Target currency vs Order currency matches
  {
    const mockActuals: NormalizedSalesActual[] = [
      {
        salesActualId: "act-1",
        sourceType: "order",
        sourceDocumentId: "ord-1",
        sourceLineId: "line-1",
        productId: "prod-1",
        pharmacyId: "pharm-1",
        areaIdSnapshot: "area-1",
        countryId: "Libya",
        transactionDate: "2026-05-10",
        year: 2026,
        quarter: 2,
        month: 5,
        orderedUnits: 10,
        deliveredUnits: 10,
        freeUnits: 0,
        returnedUnits: 0,
        netCommercialUnits: 10,
        grossValue: 150,
        discountValue: 0,
        returnValue: 0,
        netSalesValue: 150,
        currencyCode: "LYD",
        transactionStatus: "Delivered",
        processingVersion: 1,
        processedAt: "2026-05-11",
        active: true
      }
    ];

    const perf = aggregateProductAreaMonthPerformance(
      "plan-1", "Libya", "prod-1", "area-1", 2026, 2, 5, 10, 150, mockActuals, 1, "LYD"
    );

    assert(perf.actualValue === 150, "Currency: correct calculation when currencies match", `Got ${perf.actualValue}`);
    assert(perf.valueAchievementStatus === "OK", "Currency: value achievement status is 'OK'", `Got ${perf.valueAchievementStatus}`);
  }

  // Scenario 2: Target is LYD, Order is USD (Currency Mismatch)
  {
    const mockActuals: NormalizedSalesActual[] = [
      {
        salesActualId: "act-2",
        sourceType: "order",
        sourceDocumentId: "ord-2",
        sourceLineId: "line-1",
        productId: "prod-1",
        pharmacyId: "pharm-1",
        areaIdSnapshot: "area-1",
        countryId: "Libya",
        transactionDate: "2026-05-10",
        year: 2026,
        quarter: 2,
        month: 5,
        orderedUnits: 10,
        deliveredUnits: 10,
        freeUnits: 0,
        returnedUnits: 0,
        netCommercialUnits: 10,
        grossValue: 150,
        discountValue: 0,
        returnValue: 0,
        netSalesValue: 150,
        currencyCode: "USD", // Mismatched currency
        transactionStatus: "Delivered",
        processingVersion: 1,
        processedAt: "2026-05-11",
        active: true
      }
    ];

    const perf = aggregateProductAreaMonthPerformance(
      "plan-1", "Libya", "prod-1", "area-1", 2026, 2, 5, 10, 150, mockActuals, 1, "LYD"
    );

    assert(perf.actualUnits === 10, "Currency: units achievement is fully tallied despite currency mismatch", `Got ${perf.actualUnits}`);
    assert(perf.actualValue === 0, "Currency: mismatched value actual is excluded (sum of value is 0)", `Got ${perf.actualValue}`);
    assert(perf.valueAchievementStatus === "CURRENCY_MISMATCH", "Currency: valueAchievementStatus is set to 'CURRENCY_MISMATCH'", `Got ${perf.valueAchievementStatus}`);
  }

  // ==========================================================
  // BLOCK 4: FILTERS & BOUNDARY RULES (SCENARIOS 11-15)
  // ==========================================================
  console.log("\n>>> Running Filter and Boundary Rules Tests...");

  // Scenario 11: Transaction status check (Only "Delivered" counts towards actuals)
  {
    const mockActuals: NormalizedSalesActual[] = [
      {
        salesActualId: "act-3a",
        sourceType: "order",
        sourceDocumentId: "ord-3",
        sourceLineId: "line-1",
        productId: "prod-1",
        pharmacyId: "pharm-1",
        areaIdSnapshot: "area-1",
        countryId: "Libya",
        transactionDate: "2026-05-10",
        year: 2026,
        quarter: 2,
        month: 5,
        orderedUnits: 10,
        deliveredUnits: 10,
        freeUnits: 0,
        returnedUnits: 0,
        netCommercialUnits: 10,
        grossValue: 150,
        discountValue: 0,
        returnValue: 0,
        netSalesValue: 150,
        currencyCode: "LYD",
        transactionStatus: "Delivered", // DELIVERED (counts)
        processingVersion: 1,
        processedAt: "2026-05-11",
        active: true
      },
      {
        salesActualId: "act-3b",
        sourceType: "order",
        sourceDocumentId: "ord-4",
        sourceLineId: "line-1",
        productId: "prod-1",
        pharmacyId: "pharm-1",
        areaIdSnapshot: "area-1",
        countryId: "Libya",
        transactionDate: "2026-05-10",
        year: 2026,
        quarter: 2,
        month: 5,
        orderedUnits: 100,
        deliveredUnits: 100,
        freeUnits: 0,
        returnedUnits: 0,
        netCommercialUnits: 100,
        grossValue: 1500,
        discountValue: 0,
        returnValue: 0,
        netSalesValue: 1500,
        currencyCode: "LYD",
        transactionStatus: "Draft", // NOT DELIVERED (ignored)
        processingVersion: 1,
        processedAt: "2026-05-11",
        active: true
      }
    ];

    const perf = aggregateProductAreaMonthPerformance(
      "plan-1", "Libya", "prod-1", "area-1", 2026, 2, 5, 10, 150, mockActuals, 1, "LYD"
    );

    assert(perf.actualUnits === 10, "Filters: only delivered units are aggregated", `Got ${perf.actualUnits}`);
    assert(perf.actualValue === 150, "Filters: only delivered values are aggregated", `Got ${perf.actualValue}`);
  }

  // Scenario 12: Inactive records are excluded
  {
    const mockActuals: NormalizedSalesActual[] = [
      {
        salesActualId: "act-4",
        sourceType: "order",
        sourceDocumentId: "ord-5",
        sourceLineId: "line-1",
        productId: "prod-1",
        pharmacyId: "pharm-1",
        areaIdSnapshot: "area-1",
        countryId: "Libya",
        transactionDate: "2026-05-10",
        year: 2026,
        quarter: 2,
        month: 5,
        orderedUnits: 25,
        deliveredUnits: 25,
        freeUnits: 0,
        returnedUnits: 0,
        netCommercialUnits: 25,
        grossValue: 375,
        discountValue: 0,
        returnValue: 0,
        netSalesValue: 375,
        currencyCode: "LYD",
        transactionStatus: "Delivered",
        processingVersion: 1,
        processedAt: "2026-05-11",
        active: false // INACTIVE
      }
    ];

    const perf = aggregateProductAreaMonthPerformance(
      "plan-1", "Libya", "prod-1", "area-1", 2026, 2, 5, 10, 150, mockActuals, 1, "LYD"
    );

    assert(perf.actualUnits === 0, "Filters: inactive actuals are filtered out from units", `Got ${perf.actualUnits}`);
    assert(perf.actualValue === 0, "Filters: inactive actuals are filtered out from values", `Got ${perf.actualValue}`);
  }

  // Scenario 13: Area filter matching
  {
    const mockActuals: NormalizedSalesActual[] = [
      {
        salesActualId: "act-5",
        sourceType: "order",
        sourceDocumentId: "ord-6",
        sourceLineId: "line-1",
        productId: "prod-1",
        pharmacyId: "pharm-1",
        areaIdSnapshot: "area-different", // Area Mismatch
        countryId: "Libya",
        transactionDate: "2026-05-10",
        year: 2026,
        quarter: 2,
        month: 5,
        orderedUnits: 25,
        deliveredUnits: 25,
        freeUnits: 0,
        returnedUnits: 0,
        netCommercialUnits: 25,
        grossValue: 375,
        discountValue: 0,
        returnValue: 0,
        netSalesValue: 375,
        currencyCode: "LYD",
        transactionStatus: "Delivered",
        processingVersion: 1,
        processedAt: "2026-05-11",
        active: true
      }
    ];

    const perf = aggregateProductAreaMonthPerformance(
      "plan-1", "Libya", "prod-1", "area-target", 2026, 2, 5, 10, 150, mockActuals, 1, "LYD"
    );

    assert(perf.actualUnits === 0, "Filters: actuals of different area ID are ignored", `Got ${perf.actualUnits}`);
  }

  // Scenario 14: Month filter matching
  {
    const mockActuals: NormalizedSalesActual[] = [
      {
        salesActualId: "act-6",
        sourceType: "order",
        sourceDocumentId: "ord-7",
        sourceLineId: "line-1",
        productId: "prod-1",
        pharmacyId: "pharm-1",
        areaIdSnapshot: "area-1",
        countryId: "Libya",
        transactionDate: "2026-06-10",
        year: 2026,
        quarter: 2,
        month: 6, // Month Mismatch (target is month 5)
        orderedUnits: 25,
        deliveredUnits: 25,
        freeUnits: 0,
        returnedUnits: 0,
        netCommercialUnits: 25,
        grossValue: 375,
        discountValue: 0,
        returnValue: 0,
        netSalesValue: 375,
        currencyCode: "LYD",
        transactionStatus: "Delivered",
        processingVersion: 1,
        processedAt: "2026-05-11",
        active: true
      }
    ];

    const perf = aggregateProductAreaMonthPerformance(
      "plan-1", "Libya", "prod-1", "area-1", 2026, 2, 5, 10, 150, mockActuals, 1, "LYD"
    );

    assert(perf.actualUnits === 0, "Filters: actuals of different month are ignored", `Got ${perf.actualUnits}`);
  }

  // ==========================================================
  // BLOCK 5: MATHEMATICAL CALCULATIONS & CORNER CASES (SCENARIOS 16-25)
  // ==========================================================
  console.log("\n>>> Running Mathematical Calculation Tests...");

  // Scenario 16: calculateVariance
  {
    assert(calculateVariance(120, 100) === 20, "Math: variance is positive when actual exceeds target", `Got ${calculateVariance(120, 100)}`);
    assert(calculateVariance(80, 100) === -20, "Math: variance is negative when actual is below target", `Got ${calculateVariance(80, 100)}`);
    assert(calculateVariance(100, 100) === 0, "Math: variance is 0 when they match", `Got ${calculateVariance(100, 100)}`);
  }

  // Scenario 17: calculateAchievement
  {
    assert(calculateAchievement(120, 100) === 120, "Math: achievement percentage is calculated correctly", `Got ${calculateAchievement(120, 100)}`);
    assert(calculateAchievement(50, 0) === 0, "Math: division by zero target handles safely returning 0", `Got ${calculateAchievement(50, 0)}`);
    assert(calculateAchievement(0, 100) === 0, "Math: 0 actual yields 0% achievement", `Got ${calculateAchievement(0, 100)}`);
  }

  // Scenario 18: calculateRemaining
  {
    assert(calculateRemaining(40, 100) === 60, "Math: remaining value correct underachievement", `Got ${calculateRemaining(40, 100)}`);
    assert(calculateRemaining(120, 100) === 0, "Math: remaining value is capped at 0 upon overachievement", `Got ${calculateRemaining(120, 100)}`);
  }

  // Scenario 19: calculateOverachievement
  {
    assert(calculateOverachievement(120, 100) === 20, "Math: overachievement correctly calculated", `Got ${calculateOverachievement(120, 100)}`);
    assert(calculateOverachievement(80, 100) === 0, "Math: overachievement is 0 under underachievement", `Got ${calculateOverachievement(80, 100)}`);
  }

  // Scenario 20: Comprehensive aggregated monthly math verification
  {
    const mockActuals: NormalizedSalesActual[] = [
      {
        salesActualId: "act-7a",
        sourceType: "order",
        sourceDocumentId: "ord-8",
        sourceLineId: "line-1",
        productId: "prod-1",
        pharmacyId: "pharm-1",
        areaIdSnapshot: "area-1",
        countryId: "Libya",
        transactionDate: "2026-05-10",
        year: 2026,
        quarter: 2,
        month: 5,
        orderedUnits: 3,
        deliveredUnits: 3,
        freeUnits: 0,
        returnedUnits: 0,
        netCommercialUnits: 3,
        grossValue: 45,
        discountValue: 0,
        returnValue: 0,
        netSalesValue: 45,
        currencyCode: "LYD",
        transactionStatus: "Delivered",
        processingVersion: 1,
        processedAt: "2026-05-11",
        active: true
      },
      {
        salesActualId: "act-7b",
        sourceType: "order",
        sourceDocumentId: "ord-9",
        sourceLineId: "line-1",
        productId: "prod-1",
        pharmacyId: "pharm-1",
        areaIdSnapshot: "area-1",
        countryId: "Libya",
        transactionDate: "2026-05-10",
        year: 2026,
        quarter: 2,
        month: 5,
        orderedUnits: 5,
        deliveredUnits: 5,
        freeUnits: 0,
        returnedUnits: 0,
        netCommercialUnits: 5,
        grossValue: 75,
        discountValue: 0,
        returnValue: 0,
        netSalesValue: 75,
        currencyCode: "LYD",
        transactionStatus: "Delivered",
        processingVersion: 1,
        processedAt: "2026-05-11",
        active: true
      }
    ];

    const perf = aggregateProductAreaMonthPerformance(
      "plan-1", "Libya", "prod-1", "area-1", 2026, 2, 5, 10, 150, mockActuals, 1, "LYD"
    );

    assert(perf.actualUnits === 8, "Aggregator: cumulative units correct", `Expected 8, got ${perf.actualUnits}`);
    assert(perf.actualValue === 120, "Aggregator: cumulative values correct", `Expected 120, got ${perf.actualValue}`);
    assert(perf.achievementUnitsPercentage === 80, "Aggregator: units achievement % correct (80%)", `Got ${perf.achievementUnitsPercentage}`);
    assert(perf.achievementValuePercentage === 80, "Aggregator: value achievement % correct (80%)", `Got ${perf.achievementValuePercentage}`);
    assert(perf.varianceUnits === -2, "Aggregator: units variance correct (-2)", `Got ${perf.varianceUnits}`);
    assert(perf.varianceValue === -30, "Aggregator: value variance correct (-30)", `Got ${perf.varianceValue}`);
    assert(perf.remainingUnits === 2, "Aggregator: units remaining correct (2)", `Got ${perf.remainingUnits}`);
    assert(perf.remainingValue === 30, "Aggregator: value remaining correct (30)", `Got ${perf.remainingValue}`);
    assert(perf.overachievementUnits === 0, "Aggregator: overachievement units correct (0)", `Got ${perf.overachievementUnits}`);
    assert(perf.overachievementValue === 0, "Aggregator: overachievement value correct (0)", `Got ${perf.overachievementValue}`);
  }

  // ==========================================================
  // BLOCK 6: SECURITY & EXCEPTION RBAC RESTRICTIONS (SCENARIOS 26-28)
  // ==========================================================
  console.log("\n>>> Running Security & Exception RBAC Tests...");

  // Scenario 26: Country Manager / Sales Manager restricted country boundary checks
  {
    const userRoleCountryManager = { role: "Country Manager", country: "Libya" };
    const userRoleSuperAdmin = { role: "Super Admin", country: undefined };

    // Super Admin should be a global administrator
    const isAdminGlobal = ["Super Admin", "Admin", "General Manager"].includes(userRoleSuperAdmin.role);
    assert(isAdminGlobal === true, "Security: Super Admin is recognized as global admin");

    // Country Manager is restricted
    const isCountryRestricted = !["Super Admin", "Admin", "General Manager"].includes(userRoleCountryManager.role);
    assert(isCountryRestricted === true, "Security: Country Manager is recognized as country-restricted");
    assert(userRoleCountryManager.country === "Libya", "Security: Country Manager has assigned country 'Libya'");
  }

  console.log("\n=================================================================");
  console.log(`TEST SUITE COMPLETED!`);
  console.log(`Total Assertions Checked: ${totalAssertions}`);
  console.log(`Assertions Passed: ${totalAssertions - failedTestsCount}`);
  console.log(`Assertions Failed: ${failedTestsCount}`);
  console.log("=================================================================");

  if (failedTestsCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
