import { NormalizedSalesActual, ProductAreaMonthlyPerformance } from "../types";

// ==========================================================
// 1. PURE PERFORMANCE AND VARIANCE FORMULAS
// ==========================================================

/**
 * Calculates net commercial units.
 * Formula: Delivered Units - Returned Units
 */
export function calculateNetCommercialUnits(deliveredUnits: number, returnedUnits: number): number {
  return Math.max(0, deliveredUnits - returnedUnits);
}

/**
 * Calculates net sales value.
 * Formula: Gross Value - Discount Value - Return Value
 */
export function calculateNetSalesValue(grossValue: number, discountValue: number, returnValue: number): number {
  return Math.round((grossValue - discountValue - returnValue) * 100) / 100;
}

/**
 * Calculates achievement percentage.
 * Formula: (Actual / Target) * 100
 */
export function calculateAchievement(actual: number, target: number): number {
  if (target <= 0) return 0;
  return Math.round((actual / target) * 1000) / 10; // 1 decimal place precision
}

/**
 * Calculates variance.
 * Formula: Actual - Target
 */
export function calculateVariance(actual: number, target: number): number {
  return Math.round((actual - target) * 100) / 100;
}

/**
 * Calculates remaining target.
 * Formula: Target - Actual (or 0 if overachieved)
 */
export function calculateRemaining(actual: number, target: number): number {
  const diff = target - actual;
  return diff > 0 ? Math.round(diff * 100) / 100 : 0;
}

/**
 * Calculates overachievement.
 * Formula: Actual - Target (or 0 if not overachieved)
 */
export function calculateOverachievement(actual: number, target: number): number {
  const diff = actual - target;
  return diff > 0 ? Math.round(diff * 100) / 100 : 0;
}

/**
 * Calculates run-rate forecast based on YTD actuals and elapsed months.
 * Formula: YTD Actual + (Average Monthly Actual * Remaining Months)
 */
export function calculateRunRateForecast(
  ytdActual: number,
  elapsedMonths: number,
  remainingMonths: number
): number {
  if (elapsedMonths <= 0) return 0;
  const avgMonthly = ytdActual / elapsedMonths;
  const projected = ytdActual + (avgMonthly * remainingMonths);
  return Math.round(projected * 100) / 100;
}

// ==========================================================
// 2. COMMERCIAL ORDER NORMALIZATION ENGINE
// ==========================================================

export interface NormalizationException {
  orderId: string;
  pharmacyId: string;
  pharmacyName: string;
  productId?: string;
  productName?: string;
  issueType: "MISSING_GEOGRAPHY" | "CURRENCY_INCOMPATIBLE" | "MISSING_PRODUCT" | "ORDER_AREA_HISTORICAL_SNAPSHOT_MISSING" | "ORDER_CURRENCY_MISMATCH" | "OTHER";
  details: string;
  timestamp: string;
  countryId?: string;
  areaId?: string;
  year?: number;
}

/**
 * Calculates COMPLETED_MONTH_RUN_RATE forecast.
 * Formula: Forecast Year-End Units/Value = Actual through completed months / completed months * 12
 * 
 * Target Year cases:
 * - If year > currentYear: Forecast = null (Not Available)
 * - If year < currentYear: Forecast = final Actual (the complete year YTD actual)
 * - If year === currentYear:
 *   - completedMonths = currentMonth - 1
 *   - If completedMonths === 0: Forecast = null (Not Available)
 *   - Otherwise: actuals_thru_completed_months / completedMonths * 12
 */
export function calculateCompletedMonthRunRateForecast(
  targetYear: number,
  currentYear: number,
  currentMonth: number,
  monthlyActuals: { month: number; actual: number }[]
): {
  forecastedValue: number | null;
  completedMonths: number;
  partialMonthIncluded: boolean;
  forecastMethod: string;
} {
  const forecastMethod = "COMPLETED_MONTH_RUN_RATE";
  const partialMonthIncluded = false;

  if (targetYear > currentYear) {
    return {
      forecastedValue: null,
      completedMonths: 0,
      partialMonthIncluded,
      forecastMethod
    };
  }

  if (targetYear < currentYear) {
    // Closed historical year: Forecast = final Actual
    const finalActual = monthlyActuals.reduce((sum, item) => sum + item.actual, 0);
    return {
      forecastedValue: Math.round(finalActual * 100) / 100,
      completedMonths: 12,
      partialMonthIncluded,
      forecastMethod
    };
  }

  // targetYear === currentYear
  const completedMonths = currentMonth - 1;
  if (completedMonths <= 0) {
    return {
      forecastedValue: null,
      completedMonths: 0,
      partialMonthIncluded,
      forecastMethod
    };
  }

  const completedActualsSum = monthlyActuals
    .filter(item => item.month <= completedMonths)
    .reduce((sum, item) => sum + item.actual, 0);

  const forecastedValue = (completedActualsSum / completedMonths) * 12;
  return {
    forecastedValue: Math.round(forecastedValue * 100) / 100,
    completedMonths,
    partialMonthIncluded,
    forecastMethod
  };
}

/**
 * Normalizes a single commercial order line into a NormalizedSalesActual record.
 * Handles historical area snapshot priority, commercial quantity, and currency validations.
 */
export function normalizeCommercialOrderLine(
  order: any,
  item: any,
  itemIndex: number,
  pharmacy: any
): { record: NormalizedSalesActual; exception?: NormalizationException } {
  const salesActualId = `${order.id}::${itemIndex}`;
  const sourceType = "order";
  const sourceDocumentId = order.id;
  const sourceLineId = itemIndex.toString();
  
  const productId = item.productId || item.id;
  const productName = item.productName || item.name || "Unknown Product";
  const pharmacyId = order.pharmacyId;
  const pharmacyName = order.pharmacyName || pharmacy?.name || "Unknown Pharmacy";
  
  // Historical geographic snapshot logic
  let areaIdSnapshot = "";
  let attributionSource = "";
  let attributionConfidence = "low";
  let raiseFallbackException = false;

  if (order.areaIdSnapshot || order.areaId || order.area) {
    areaIdSnapshot = order.areaIdSnapshot || order.areaId || order.area;
    attributionSource = "order";
    attributionConfidence = "high";
  } else if (order.pharmacyAreaIdSnapshot || order.pharmacyAreaId || order.capturedAreaId) {
    areaIdSnapshot = order.pharmacyAreaIdSnapshot || order.pharmacyAreaId || order.capturedAreaId;
    attributionSource = "pharmacy_snapshot";
    attributionConfidence = "high";
  } else if (pharmacy?.areaId) {
    areaIdSnapshot = pharmacy.areaId;
    attributionSource = "pharmacy_fallback";
    attributionConfidence = "medium";
    raiseFallbackException = true;
  } else {
    attributionSource = "none";
    attributionConfidence = "low";
  }

  const areaCodeSnapshot = order.areaCodeSnapshot || order.areaCode || pharmacy?.areaCode || "";
  const areaNameSnapshot = order.areaNameSnapshot || order.areaName || pharmacy?.areaName || "";
  const countryId = order.marketId || order.countryId || pharmacy?.marketId || pharmacy?.countryId || pharmacy?.country || "";
  
  const transactionDate = order.date || order.createdAt || new Date().toISOString();
  
  // Safe date parsing
  const dateObj = new Date(transactionDate);
  const year = isNaN(dateObj.getFullYear()) ? 2026 : dateObj.getFullYear();
  const month = isNaN(dateObj.getMonth()) ? 1 : dateObj.getMonth() + 1;
  const quarter = Math.ceil(month / 3);

  // Commercial quantity and status logic
  const isDelivered = order.status === "Delivered";
  
  // Use custom deliveredQuantity/deliveredUnits or default to ordered quantity if order is Delivered
  const confirmedDeliveredUnits = isDelivered
    ? (item.deliveredQuantity !== undefined
        ? item.deliveredQuantity
        : item.deliveredUnits !== undefined
        ? item.deliveredUnits
        : item.quantity || 0)
    : 0;

  const freeUnits = item.freeUnits !== undefined ? item.freeUnits : item.bonusUnits !== undefined ? item.bonusUnits : 0;
  const returnedUnits = item.returnedQuantity !== undefined ? item.returnedQuantity : item.returnedUnits !== undefined ? item.returnedUnits : 0;
  
  const netCommercialUnits = calculateNetCommercialUnits(confirmedDeliveredUnits, returnedUnits);

  const price = item.price || 0;
  
  // Gross value calculation
  const grossValue = item.grossValue !== undefined ? item.grossValue : confirmedDeliveredUnits * price;
  
  // Discount value calculation
  const discountPercent = item.discount || 0;
  const discountValue = item.discountValue !== undefined
    ? item.discountValue
    : Math.round((confirmedDeliveredUnits * price * (discountPercent / 100)) * 100) / 100;
  
  // Return value calculation
  const returnValue = item.returnValue !== undefined ? item.returnValue : returnedUnits * price;
  
  // Net sales value calculation
  const netSalesValue = isDelivered ? calculateNetSalesValue(grossValue, discountValue, returnValue) : 0;

  const currencyCode = String(order.currencyCode || order.currency || pharmacy?.currencyCode || pharmacy?.currency || "").toUpperCase();
  
  let exception: NormalizationException | undefined;
  let active = true;

  // Currency incompatibility safety checks
  if (!/^[A-Z]{3}$/.test(currencyCode)) {
    active = false;
    exception = {
      orderId: order.id,
      pharmacyId,
      pharmacyName,
      productId,
      productName,
      issueType: "CURRENCY_INCOMPATIBLE",
      details: "Transaction has no valid canonical currency identity. Silent market fallback is forbidden.",
      timestamp: new Date().toISOString(),
      countryId,
      areaId: areaIdSnapshot,
      year
    };
  }

  // Missing geography gap checks
  if (!areaIdSnapshot) {
    exception = {
      orderId: order.id,
      pharmacyId,
      pharmacyName,
      productId,
      productName,
      issueType: "MISSING_GEOGRAPHY",
      details: `Pharmacy '${pharmacyName}' (${pharmacyId}) lacks a valid geographic Area ID snapshot mapping.`,
      timestamp: new Date().toISOString(),
      countryId,
      areaId: "",
      year
    };
  } else if (raiseFallbackException) {
    // Legacy fallback historical area snapshot missing
    exception = {
      orderId: order.id,
      pharmacyId,
      pharmacyName,
      productId,
      productName,
      issueType: "ORDER_AREA_HISTORICAL_SNAPSHOT_MISSING",
      details: `Historical area snapshot missing for order ${order.id}. Fallback to current pharmacy area '${areaIdSnapshot}' used.`,
      timestamp: new Date().toISOString(),
      countryId,
      areaId: areaIdSnapshot,
      year
    };
  }

  const record: NormalizedSalesActual = {
    salesActualId,
    sourceType,
    sourceDocumentId,
    sourceLineId,
    productId,
    pharmacyId,
    areaIdSnapshot,
    areaCodeSnapshot,
    areaNameSnapshot,
    attributionSource,
    attributionConfidence,
    attributedAt: new Date().toISOString(),
    countryId,
    transactionDate,
    year,
    quarter,
    month,
    orderedUnits: item.quantity || 0,
    deliveredUnits: confirmedDeliveredUnits,
    freeUnits,
    returnedUnits,
    netCommercialUnits,
    grossValue,
    discountValue,
    returnValue,
    netSalesValue,
    currencyCode,
    transactionStatus: order.status,
    processingVersion: 1,
    processedAt: new Date().toISOString(),
    active
  };

  return { record, exception };
}

// ==========================================================
// 3. TARGET PERFORMANCE AGGREGATION & FORECASTING PIPELINE
// ==========================================================

/**
 * Aggregates normalized sales actuals and calculates performance and remaining targets for a product-area-month.
 */
export function aggregateProductAreaMonthPerformance(
  planId: string,
  countryId: string,
  productId: string,
  areaId: string,
  year: number,
  quarter: number,
  month: number,
  targetUnits: number,
  targetValue: number,
  actuals: NormalizedSalesActual[],
  targetVersion = 1,
  currencyCode = ""
): ProductAreaMonthlyPerformance {
  if (!/^[A-Z]{3}$/.test(currencyCode)) throw new Error("TARGET_CURRENCY_REQUIRED");
  const performanceId = `${productId}::${areaId}::${year}::${month}::${targetVersion}`;

  // Filter actuals matching this specific product, area, year, and month
  const matchingActuals = actuals.filter(act => 
    act.productId === productId && 
    act.areaIdSnapshot === areaId && 
    act.year === year && 
    act.month === month && 
    act.active &&
    act.transactionStatus === "Delivered"
  );

  // Enforce Currency mismatch checks
  let hasCurrencyMismatch = false;
  const compatibleActuals = matchingActuals.filter(act => {
    if (act.currencyCode !== currencyCode) {
      hasCurrencyMismatch = true;
      return false; // Exclude from value sum
    }
    return true;
  });

  const actualUnits = matchingActuals.reduce((sum, act) => sum + act.netCommercialUnits, 0);
  const actualValue = compatibleActuals.reduce((sum, act) => sum + act.netSalesValue, 0);

  const valueAchievementStatus = hasCurrencyMismatch ? "CURRENCY_MISMATCH" : "OK";

  return {
    performanceId,
    planId,
    countryId,
    productId,
    areaId,
    year,
    quarter,
    month,
    targetVersion,
    targetUnits,
    targetValue,
    actualUnits,
    actualValue,
    achievementUnitsPercentage: calculateAchievement(actualUnits, targetUnits),
    achievementValuePercentage: hasCurrencyMismatch ? 0 : calculateAchievement(actualValue, targetValue),
    varianceUnits: calculateVariance(actualUnits, targetUnits),
    varianceValue: hasCurrencyMismatch ? -targetValue : calculateVariance(actualValue, targetValue),
    remainingUnits: calculateRemaining(actualUnits, targetUnits),
    remainingValue: hasCurrencyMismatch ? targetValue : calculateRemaining(actualValue, targetValue),
    overachievementUnits: calculateOverachievement(actualUnits, targetUnits),
    overachievementValue: hasCurrencyMismatch ? 0 : calculateOverachievement(actualValue, targetValue),
    currencyCode,
    dataCutoffDate: new Date().toISOString(),
    calculatedAt: new Date().toISOString(),
    calculationVersion: 1,
    active: true,
    valueAchievementStatus
  };
}
