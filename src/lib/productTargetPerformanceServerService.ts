import { getFirebaseAdminServices } from "../../server/firebaseAdmin";
import { 
  normalizeCommercialOrderLine, 
  aggregateProductAreaMonthPerformance, 
  calculateAchievement,
  calculateVariance,
  calculateRemaining,
  calculateOverachievement,
  calculateCompletedMonthRunRateForecast,
  NormalizationException
} from "./productTargetPerformanceService";
import { NormalizedSalesActual, ProductAreaMonthlyPerformance } from "../types";

/**
 * Rebuilds the authoritative actual sales and performance aggregates idempotently.
 * Supports restricted country-scoped rebuilds to enforce secure boundaries.
 */
export async function rebuildPerformanceData(year = 2026, countryId?: string): Promise<{
  success: boolean;
  ordersProcessed: number;
  rowsNormalized: number;
  performanceRecordsCreated: number;
  exceptions: NormalizationException[];
}> {
  const { db } = getFirebaseAdminServices();
  console.info(`[Performance Rebuild] Starting rebuild for year: ${year}${countryId ? `, countryId: ${countryId}` : " (Global)"}...`);

  // --- Idempotent Cleanup Phase ---
  let oldActualsQuery = db.collection("normalizedSalesActuals").where("year", "==", year);
  if (countryId) {
    oldActualsQuery = oldActualsQuery.where("countryId", "==", countryId);
  }
  const oldActuals = await oldActualsQuery.get();
  
  const deleteBatch = db.batch();
  oldActuals.forEach(doc => {
    deleteBatch.delete(doc.ref);
  });
  
  const oldExceptions = await db.collection("salesPerformanceExceptions").get();
  oldExceptions.forEach(doc => {
    const data = doc.data();
    const matchesYear = data.year === year || (data.timestamp && new Date(data.timestamp).getFullYear() === year);
    const matchesCountry = !countryId || data.countryId === countryId;
    if (matchesYear && matchesCountry) {
      deleteBatch.delete(doc.ref);
    }
  });

  let oldPerfQuery = db.collection("productAreaMonthlyPerformance").where("year", "==", year);
  if (countryId) {
    oldPerfQuery = oldPerfQuery.where("countryId", "==", countryId);
  }
  const oldPerf = await oldPerfQuery.get();
  oldPerf.forEach(doc => {
    deleteBatch.delete(doc.ref);
  });

  await deleteBatch.commit();
  console.info(`[Performance Rebuild] Completed clean up of stale data for year ${year}`);

  // 1. Fetch Pharmacies for master geographic alignment
  let pharmaciesQuery: any = db.collection("pharmacies");
  if (countryId) {
    pharmaciesQuery = pharmaciesQuery.where("countryId", "==", countryId);
  }
  const pharmaciesSnap = await pharmaciesQuery.get();
  const pharmacyMap = new Map<string, any>();
  pharmaciesSnap.forEach((doc: any) => {
    pharmacyMap.set(doc.id, { id: doc.id, ...doc.data() });
  });
  console.info(`[Performance Rebuild] Loaded ${pharmacyMap.size} pharmacies for mapping.`);

  // 1b. Fetch Products for master names
  const productsSnap = await db.collection("products").get();
  const productMap = new Map<string, any>();
  productsSnap.forEach((doc: any) => {
    productMap.set(doc.id, { id: doc.id, ...doc.data() });
  });
  console.info(`[Performance Rebuild] Loaded ${productMap.size} products for names.`);

  // 2. Fetch Orders
  const ordersSnap = await db.collection("orders").get();
  const orders: any[] = [];
  ordersSnap.forEach((doc: any) => {
    orders.push({ id: doc.id, ...doc.data() });
  });
  console.info(`[Performance Rebuild] Loaded ${orders.length} orders from Firestore.`);

  // Filter orders matching the specified year and country boundary
  const targetYearOrders = orders.filter(o => {
    const dateStr = o.date || o.createdAt;
    if (!dateStr) return false;
    const d = new Date(dateStr);
    const matchesYear = d.getFullYear() === year;

    if (countryId) {
      const pharm = pharmacyMap.get(o.pharmacyId);
      const matchesCountry = o.countryId === countryId || pharm?.countryId === countryId || pharm?.country === countryId;
      return matchesYear && matchesCountry;
    }
    return matchesYear;
  });
  console.info(`[Performance Rebuild] Filtered ${targetYearOrders.length} orders for year ${year}.`);

  const normalizedRecords: NormalizedSalesActual[] = [];
  const exceptions: NormalizationException[] = [];

  // 3. Normalize Order Lines
  for (const order of targetYearOrders) {
    const items = order.items || [];
    const pharmacy = pharmacyMap.get(order.pharmacyId);

    items.forEach((item: any, idx: number) => {
      const { record, exception } = normalizeCommercialOrderLine(order, item, idx, pharmacy);
      normalizedRecords.push(record);
      if (exception) {
        exceptions.push(exception);
      }
    });
  }

  console.info(`[Performance Rebuild] Generated ${normalizedRecords.length} normalized actuals, ${exceptions.length} exception events.`);

  // 4. Fetch Calculated Product Targets for Year
  let targetsQuery = db.collection("calculatedProductTargets")
    .where("year", "==", year)
    .where("active", "==", true);
  
  if (countryId) {
    targetsQuery = targetsQuery.where("countryId", "==", countryId);
  }
  
  const targetsSnap = await targetsQuery.get();
  const calculatedTargets: any[] = [];
  targetsSnap.forEach((doc: any) => {
    calculatedTargets.push({ calculatedTargetId: doc.id, ...doc.data() });
  });
  console.info(`[Performance Rebuild] Loaded ${calculatedTargets.length} calculated targets for aggregation.`);

  // 5. Aggregate performance monthly per product and area
  const performanceRecords: ProductAreaMonthlyPerformance[] = [];

  for (const target of calculatedTargets) {
    const perf = aggregateProductAreaMonthPerformance(
      target.planId,
      target.countryId || target.marketId || "",
      target.productId,
      target.areaId,
      target.year,
      target.quarter,
      target.month,
      target.targetUnits,
      target.targetValue,
      normalizedRecords,
      target.version || 1,
      target.currencyCode || ""
    );
    performanceRecords.push(perf);

    // Dynamic currency mismatch exceptions logging
    if (perf.valueAchievementStatus === "CURRENCY_MISMATCH") {
      const mismatchedActuals = normalizedRecords.filter(act => 
        act.productId === target.productId && 
        act.areaIdSnapshot === target.areaId && 
        act.year === target.year && 
        act.month === target.month && 
        act.active &&
        act.transactionStatus === "Delivered" &&
        act.currencyCode !== target.currencyCode
      );

      for (const act of mismatchedActuals) {
        const pharmName = pharmacyMap.get(act.pharmacyId)?.name || "Unknown Pharmacy";
        const prodName = productMap.get(act.productId)?.name || "Unknown Product";

        exceptions.push({
          orderId: act.sourceDocumentId,
          pharmacyId: act.pharmacyId,
          pharmacyName: pharmName,
          productId: act.productId,
          productName: prodName,
          issueType: "ORDER_CURRENCY_MISMATCH",
          details: `Order currency '${act.currencyCode}' mismatches target currency '${target.currencyCode || "UNRESOLVED"}'. Value excluded from achievement.`,
          timestamp: new Date().toISOString(),
          countryId: target.countryId || act.countryId,
          areaId: target.areaId,
          year: target.year
        });
      }
    }
  }

  // Commit everything to Firestore
  const saveBatch = db.batch();
  for (const act of normalizedRecords) {
    const ref = db.collection("normalizedSalesActuals").doc(act.salesActualId);
    saveBatch.set(ref, act, { merge: true });
  }

  for (const exc of exceptions) {
    const ref = db.collection("salesPerformanceExceptions").doc(`${exc.orderId}::${exc.productId || "unknown"}`);
    saveBatch.set(ref, exc, { merge: true });
  }

  for (const perf of performanceRecords) {
    const ref = db.collection("productAreaMonthlyPerformance").doc(perf.performanceId);
    saveBatch.set(ref, perf, { merge: true });
  }
  
  await saveBatch.commit();
  console.info(`[Performance Rebuild] Committed normalized actuals, monthly performance and exceptions.`);

  return {
    success: true,
    ordersProcessed: targetYearOrders.length,
    rowsNormalized: normalizedRecords.length,
    performanceRecordsCreated: performanceRecords.length,
    exceptions
  };
}

/**
 * Retrieves YTD aggregated performance summary for specific filters with standardized COMPLETED_MONTH_RUN_RATE forecasting.
 */
export async function getPerformanceSummary(filters: {
  year: number;
  productId?: string;
  areaId?: string;
  month?: number;
  areaIds?: string[]; // scoped user area IDs
}) {
  const { db } = getFirebaseAdminServices();

  // Load monthly performance aggregates
  let queryRef: any = db.collection("productAreaMonthlyPerformance")
    .where("year", "==", filters.year)
    .where("active", "==", true);

  if (filters.productId) {
    queryRef = queryRef.where("productId", "==", filters.productId);
  }
  if (filters.areaId) {
    queryRef = queryRef.where("areaId", "==", filters.areaId);
  }
  if (filters.month) {
    queryRef = queryRef.where("month", "==", filters.month);
  }

  const snap = await queryRef.get();
  let records: ProductAreaMonthlyPerformance[] = [];
  snap.forEach((doc: any) => {
    records.push(doc.data() as ProductAreaMonthlyPerformance);
  });

  // Filter scoped area access for representatives if areaIds is provided
  if (filters.areaIds && filters.areaIds.length > 0) {
    records = records.filter(r => filters.areaIds!.includes(r.areaId));
  }

  // Calculate Totals
  const targetUnitsSum = records.reduce((sum, r) => sum + r.targetUnits, 0);
  const targetValueSum = records.reduce((sum, r) => sum + r.targetValue, 0);
  const actualUnitsSum = records.reduce((sum, r) => sum + r.actualUnits, 0);
  const actualValueSum = records.reduce((sum, r) => sum + r.actualValue, 0);

  const varianceUnits = calculateVariance(actualUnitsSum, targetUnitsSum);
  const varianceValue = calculateVariance(actualValueSum, targetValueSum);
  const achievementUnitsPercentage = calculateAchievement(actualUnitsSum, targetUnitsSum);
  const achievementValuePercentage = calculateAchievement(actualValueSum, targetValueSum);

  const remainingUnits = calculateRemaining(actualUnitsSum, targetUnitsSum);
  const remainingValue = calculateRemaining(actualValueSum, targetValueSum);
  const overachievementUnits = calculateOverachievement(actualUnitsSum, targetUnitsSum);
  const overachievementValue = calculateOverachievement(actualValueSum, targetValueSum);

  // Check currency mismatch presence
  const hasCurrencyMismatch = records.some(r => r.valueAchievementStatus === "CURRENCY_MISMATCH");

  // Format monthly actuals and units for COMPLETED_MONTH_RUN_RATE forecast
  const monthlyActuals: { month: number; actual: number }[] = [];
  const monthlyUnits: { month: number; actual: number }[] = [];
  for (let m = 1; m <= 12; m++) {
    const monthRecords = records.filter(r => r.month === m);
    // Exclude mismatched currency values from baseline
    const compatibleMonthRecords = monthRecords.filter(r => r.valueAchievementStatus !== "CURRENCY_MISMATCH");
    const mValue = compatibleMonthRecords.reduce((sum, r) => sum + r.actualValue, 0);
    const mUnits = monthRecords.reduce((sum, r) => sum + r.actualUnits, 0);
    monthlyActuals.push({ month: m, actual: mValue });
    monthlyUnits.push({ month: m, actual: mUnits });
  }

  const systemDate = new Date();
  const currentYear = systemDate.getFullYear();
  const currentMonth = systemDate.getMonth() + 1;

  const valueForecast = calculateCompletedMonthRunRateForecast(
    filters.year,
    currentYear,
    currentMonth,
    monthlyActuals
  );

  const unitsForecast = calculateCompletedMonthRunRateForecast(
    filters.year,
    currentYear,
    currentMonth,
    monthlyUnits
  );

  const forecastedValue = hasCurrencyMismatch ? null : valueForecast.forecastedValue;
  const forecastedUnits = unitsForecast.forecastedValue;
  const forecastAchievementPercentage = !hasCurrencyMismatch && forecastedValue !== null && targetValueSum > 0
    ? calculateAchievement(forecastedValue, targetValueSum)
    : null;

  return {
    performanceRecords: records,
    summary: {
      targetUnits: targetUnitsSum,
      targetValue: targetValueSum,
      actualUnits: actualUnitsSum,
      actualValue: actualValueSum,
      varianceUnits,
      varianceValue: hasCurrencyMismatch ? "Currency Mismatch" : varianceValue,
      achievementUnitsPercentage,
      achievementValuePercentage: hasCurrencyMismatch ? "Currency Mismatch" : achievementValuePercentage,
      remainingUnits,
      remainingValue: hasCurrencyMismatch ? "Currency Mismatch" : remainingValue,
      overachievementUnits,
      overachievementValue: hasCurrencyMismatch ? "Currency Mismatch" : overachievementValue,
      forecastedValue: hasCurrencyMismatch ? "Currency Mismatch / Not Available" : forecastedValue,
      forecastedUnits,
      forecastAchievementPercentage: hasCurrencyMismatch ? "Currency Mismatch / Not Available" : forecastAchievementPercentage,
      valueAchievementStatus: hasCurrencyMismatch ? "CURRENCY_MISMATCH" : "OK",
      forecastMetadata: {
        forecastMethod: valueForecast.forecastMethod,
        dataCutoffDate: new Date().toISOString(),
        completedMonths: valueForecast.completedMonths,
        partialMonthIncluded: valueForecast.partialMonthIncluded,
        calculatedAt: new Date().toISOString(),
        currencyCode: records[0]?.currencyCode || "USD"
      }
    }
  };
}
