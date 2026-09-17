import {
  TargetStatus,
  ProductTargetPlan,
  ProductAnnualTarget,
  ProductAreaPotential,
  ProductQuarterlyDistribution,
  CalculatedProductTarget,
  TargetCalculationRun
} from "../types";

export interface ValidationError {
  code: string;
  field?: string;
  message: string;
}

export interface ValidationOutcome {
  valid: boolean;
  errors: ValidationError[];
}

// Internal Helper Validators
function isInteger(value: any): boolean {
  return typeof value === "number" && isFinite(value) && Number.isInteger(value);
}

function isPositiveInteger(value: any): boolean {
  return isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: any): boolean {
  return isInteger(value) && value >= 0;
}

function isFiniteNumber(value: any): boolean {
  return typeof value === "number" && isFinite(value);
}

function isNonEmptyString(value: any): boolean {
  return typeof value === "string" && value.trim() !== "";
}

function isBoolean(value: any): boolean {
  return typeof value === "boolean";
}

function isValidStatus(status: any): boolean {
  return Object.values(TargetStatus).includes(status);
}

/**
 * Validates ProductTargetPlan shape.
 */
export function validateProductTargetPlanShape(plan: any): ValidationOutcome {
  const errors: ValidationError[] = [];

  if (!plan) {
    return { valid: false, errors: [{ code: "MISSING_PLAN", message: "Plan object is null or undefined" }] };
  }

  if (!isNonEmptyString(plan.planId)) {
    errors.push({ code: "INVALID_PLAN_ID", field: "planId", message: "planId must be a non-empty string" });
  }

  if (!isNonEmptyString(plan.countryId)) {
    errors.push({ code: "INVALID_COUNTRY_ID", field: "countryId", message: "countryId must be a non-empty string" });
  }

  if (!isInteger(plan.year)) {
    errors.push({ code: "INVALID_YEAR", field: "year", message: "year must be an integer" });
  } else if (plan.year <= 0) {
    errors.push({ code: "INVALID_YEAR_VALUE", field: "year", message: "year must be a positive integer" });
  }

  if (!/^[A-Z]{3}$/.test(plan.currencyCode || "")) {
    errors.push({ code: "INVALID_CURRENCY", field: "currencyCode", message: "currencyCode must be a canonical ISO currency code" });
  }

  if (plan.monthlyDistributionMethod !== "EQUAL_WITHIN_QUARTER") {
    errors.push({ code: "INVALID_DISTRIBUTION_METHOD", field: "monthlyDistributionMethod", message: "monthlyDistributionMethod must be 'EQUAL_WITHIN_QUARTER'" });
  }

  if (!isValidStatus(plan.status)) {
    errors.push({ code: "INVALID_STATUS", field: "status", message: "status must be one of the frozen TargetStatus values" });
  }

  if (!isPositiveInteger(plan.version)) {
    errors.push({ code: "INVALID_VERSION", field: "version", message: "version must be a positive integer" });
  }

  if (!isBoolean(plan.active)) {
    errors.push({ code: "INVALID_ACTIVE", field: "active", message: "active must be a boolean" });
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validates ProductAnnualTarget shape.
 */
export function validateProductAnnualTargetShape(target: any): ValidationOutcome {
  const errors: ValidationError[] = [];

  if (!target) {
    return { valid: false, errors: [{ code: "MISSING_TARGET", message: "Target object is null or undefined" }] };
  }

  if (!isNonEmptyString(target.targetId)) {
    errors.push({ code: "INVALID_TARGET_ID", field: "targetId", message: "targetId must be a non-empty string" });
  }

  if (!isNonEmptyString(target.planId)) {
    errors.push({ code: "INVALID_PLAN_ID", field: "planId", message: "planId must be a non-empty string" });
  }

  if (!isNonEmptyString(target.countryId)) {
    errors.push({ code: "INVALID_COUNTRY_ID", field: "countryId", message: "countryId must be a non-empty string" });
  }

  if (!isNonEmptyString(target.productId)) {
    errors.push({ code: "INVALID_PRODUCT_ID", field: "productId", message: "productId must be a non-empty string" });
  }

  if (!isInteger(target.year)) {
    errors.push({ code: "INVALID_YEAR", field: "year", message: "year must be an integer" });
  } else if (target.year <= 0) {
    errors.push({ code: "INVALID_YEAR_VALUE", field: "year", message: "year must be a positive integer" });
  }

  if (!isFiniteNumber(target.annualTargetUnits)) {
    errors.push({ code: "INVALID_ANNUAL_TARGET_UNITS", field: "annualTargetUnits", message: "annualTargetUnits must be a valid finite number" });
  } else if (target.annualTargetUnits <= 0) {
    errors.push({ code: "INVALID_ANNUAL_TARGET_UNITS_VALUE", field: "annualTargetUnits", message: "annualTargetUnits must be greater than zero" });
  }

  if (!/^[A-Z]{3}$/.test(target.currencyCode || "")) {
    errors.push({ code: "INVALID_CURRENCY", field: "currencyCode", message: "currencyCode must be a canonical ISO currency code" });
  }

  if (!isValidStatus(target.status)) {
    errors.push({ code: "INVALID_STATUS", field: "status", message: "status must be one of the frozen TargetStatus values" });
  }

  if (!isPositiveInteger(target.version)) {
    errors.push({ code: "INVALID_VERSION", field: "version", message: "version must be a positive integer" });
  }

  if (!isBoolean(target.active)) {
    errors.push({ code: "INVALID_ACTIVE", field: "active", message: "active must be a boolean" });
  }

  // Price validation (optional only for Draft status)
  if (target.status !== TargetStatus.DRAFT) {
    if (target.unitPriceSnapshot === undefined || target.unitPriceSnapshot === null) {
      errors.push({ code: "MISSING_UNIT_PRICE", field: "unitPriceSnapshot", message: "unitPriceSnapshot is required for non-draft targets" });
    } else if (!isFiniteNumber(target.unitPriceSnapshot) || target.unitPriceSnapshot < 0) {
      errors.push({ code: "INVALID_UNIT_PRICE", field: "unitPriceSnapshot", message: "unitPriceSnapshot must be a non-negative finite number" });
    }

    if (target.annualTargetValue === undefined || target.annualTargetValue === null) {
      errors.push({ code: "MISSING_ANNUAL_TARGET_VALUE", field: "annualTargetValue", message: "annualTargetValue is required for non-draft targets" });
    } else if (!isFiniteNumber(target.annualTargetValue) || target.annualTargetValue < 0) {
      errors.push({ code: "INVALID_ANNUAL_TARGET_VALUE", field: "annualTargetValue", message: "annualTargetValue must be a non-negative finite number" });
    }
  } else {
    // Even in drafts, if price is provided, it must be valid
    if (target.unitPriceSnapshot !== undefined && target.unitPriceSnapshot !== null) {
      if (!isFiniteNumber(target.unitPriceSnapshot) || target.unitPriceSnapshot < 0) {
        errors.push({ code: "INVALID_UNIT_PRICE", field: "unitPriceSnapshot", message: "unitPriceSnapshot must be a non-negative finite number" });
      }
    }
    if (target.annualTargetValue !== undefined && target.annualTargetValue !== null) {
      if (!isFiniteNumber(target.annualTargetValue) || target.annualTargetValue < 0) {
        errors.push({ code: "INVALID_ANNUAL_TARGET_VALUE", field: "annualTargetValue", message: "annualTargetValue must be a non-negative finite number" });
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validates ProductAreaPotential shape.
 */
export function validateProductAreaPotentialShape(potential: any): ValidationOutcome {
  const errors: ValidationError[] = [];

  if (!potential) {
    return { valid: false, errors: [{ code: "MISSING_POTENTIAL", message: "Potential object is null or undefined" }] };
  }

  if (!isNonEmptyString(potential.areaPotentialId)) {
    errors.push({ code: "INVALID_POTENTIAL_ID", field: "areaPotentialId", message: "areaPotentialId must be a non-empty string" });
  }

  if (!isNonEmptyString(potential.planId)) {
    errors.push({ code: "INVALID_PLAN_ID", field: "planId", message: "planId must be a non-empty string" });
  }

  if (!isNonEmptyString(potential.annualTargetId)) {
    errors.push({ code: "INVALID_ANNUAL_TARGET_ID", field: "annualTargetId", message: "annualTargetId must be a non-empty string" });
  }

  if (!isNonEmptyString(potential.countryId)) {
    errors.push({ code: "INVALID_COUNTRY_ID", field: "countryId", message: "countryId must be a non-empty string" });
  }

  if (!isNonEmptyString(potential.productId)) {
    errors.push({ code: "INVALID_PRODUCT_ID", field: "productId", message: "productId must be a non-empty string" });
  }

  if (!isInteger(potential.year)) {
    errors.push({ code: "INVALID_YEAR", field: "year", message: "year must be an integer" });
  } else if (potential.year <= 0) {
    errors.push({ code: "INVALID_YEAR_VALUE", field: "year", message: "year must be a positive integer" });
  }

  if (!isNonEmptyString(potential.areaId)) {
    errors.push({ code: "INVALID_AREA_ID", field: "areaId", message: "areaId must be a non-empty string" });
  }

  if (!isFiniteNumber(potential.potentialPercentage)) {
    errors.push({ code: "INVALID_POTENTIAL_PERCENTAGE", field: "potentialPercentage", message: "potentialPercentage must be a valid finite number" });
  } else if (potential.potentialPercentage < 0 || potential.potentialPercentage > 100) {
    errors.push({ code: "INVALID_POTENTIAL_PERCENTAGE_RANGE", field: "potentialPercentage", message: "potentialPercentage must be between 0 and 100 inclusive" });
  }

  if (!isValidStatus(potential.status)) {
    errors.push({ code: "INVALID_STATUS", field: "status", message: "status must be one of the frozen TargetStatus values" });
  }

  if (!isPositiveInteger(potential.version)) {
    errors.push({ code: "INVALID_VERSION", field: "version", message: "version must be a positive integer" });
  }

  if (!isBoolean(potential.active)) {
    errors.push({ code: "INVALID_ACTIVE", field: "active", message: "active must be a boolean" });
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validates ProductQuarterlyDistribution shape.
 */
export function validateProductQuarterlyDistributionShape(dist: any): ValidationOutcome {
  const errors: ValidationError[] = [];

  if (!dist) {
    return { valid: false, errors: [{ code: "MISSING_DISTRIBUTION", message: "Distribution object is null or undefined" }] };
  }

  if (!isNonEmptyString(dist.quarterlyDistributionId)) {
    errors.push({ code: "INVALID_DISTRIBUTION_ID", field: "quarterlyDistributionId", message: "quarterlyDistributionId must be a non-empty string" });
  }

  if (!isNonEmptyString(dist.planId)) {
    errors.push({ code: "INVALID_PLAN_ID", field: "planId", message: "planId must be a non-empty string" });
  }

  if (!isNonEmptyString(dist.annualTargetId)) {
    errors.push({ code: "INVALID_ANNUAL_TARGET_ID", field: "annualTargetId", message: "annualTargetId must be a non-empty string" });
  }

  if (!isNonEmptyString(dist.countryId)) {
    errors.push({ code: "INVALID_COUNTRY_ID", field: "countryId", message: "countryId must be a non-empty string" });
  }

  if (!isNonEmptyString(dist.productId)) {
    errors.push({ code: "INVALID_PRODUCT_ID", field: "productId", message: "productId must be a non-empty string" });
  }

  if (!isInteger(dist.year)) {
    errors.push({ code: "INVALID_YEAR", field: "year", message: "year must be an integer" });
  } else if (dist.year <= 0) {
    errors.push({ code: "INVALID_YEAR_VALUE", field: "year", message: "year must be a positive integer" });
  }

  const quarters = ["q1Percentage", "q2Percentage", "q3Percentage", "q4Percentage"];
  quarters.forEach((q) => {
    const val = dist[q];
    if (!isFiniteNumber(val)) {
      errors.push({ code: `INVALID_${q.toUpperCase()}`, field: q, message: `${q} must be a valid finite number` });
    } else if (val < 0 || val > 100) {
      errors.push({ code: `INVALID_${q.toUpperCase()}_RANGE`, field: q, message: `${q} must be between 0 and 100 inclusive` });
    }
  });

  if (!isValidStatus(dist.status)) {
    errors.push({ code: "INVALID_STATUS", field: "status", message: "status must be one of the frozen TargetStatus values" });
  }

  if (!isPositiveInteger(dist.version)) {
    errors.push({ code: "INVALID_VERSION", field: "version", message: "version must be a positive integer" });
  }

  if (!isBoolean(dist.active)) {
    errors.push({ code: "INVALID_ACTIVE", field: "active", message: "active must be a boolean" });
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validates CalculatedProductTarget shape.
 */
export function validateCalculatedProductTargetShape(target: any): ValidationOutcome {
  const errors: ValidationError[] = [];

  if (!target) {
    return { valid: false, errors: [{ code: "MISSING_CALCULATED_TARGET", message: "Calculated target object is null or undefined" }] };
  }

  if (!isNonEmptyString(target.calculatedTargetId)) {
    errors.push({ code: "INVALID_CALCULATED_TARGET_ID", field: "calculatedTargetId", message: "calculatedTargetId must be a non-empty string" });
  }

  if (!isNonEmptyString(target.planId)) {
    errors.push({ code: "INVALID_PLAN_ID", field: "planId", message: "planId must be a non-empty string" });
  }

  if (!isNonEmptyString(target.annualTargetId)) {
    errors.push({ code: "INVALID_ANNUAL_TARGET_ID", field: "annualTargetId", message: "annualTargetId must be a non-empty string" });
  }

  if (!isNonEmptyString(target.areaPotentialId)) {
    errors.push({ code: "INVALID_AREA_POTENTIAL_ID", field: "areaPotentialId", message: "areaPotentialId must be a non-empty string" });
  }

  if (!isNonEmptyString(target.quarterlyDistributionId)) {
    errors.push({ code: "INVALID_QUARTERLY_DISTRIBUTION_ID", field: "quarterlyDistributionId", message: "quarterlyDistributionId must be a non-empty string" });
  }

  if (!isNonEmptyString(target.countryId)) {
    errors.push({ code: "INVALID_COUNTRY_ID", field: "countryId", message: "countryId must be a non-empty string" });
  }

  if (!isNonEmptyString(target.productId)) {
    errors.push({ code: "INVALID_PRODUCT_ID", field: "productId", message: "productId must be a non-empty string" });
  }

  if (!isNonEmptyString(target.areaId)) {
    errors.push({ code: "INVALID_AREA_ID", field: "areaId", message: "areaId must be a non-empty string" });
  }

  if (!isInteger(target.year)) {
    errors.push({ code: "INVALID_YEAR", field: "year", message: "year must be an integer" });
  } else if (target.year <= 0) {
    errors.push({ code: "INVALID_YEAR_VALUE", field: "year", message: "year must be a positive integer" });
  }

  if (target.quarter !== 1 && target.quarter !== 2 && target.quarter !== 3 && target.quarter !== 4) {
    errors.push({ code: "INVALID_QUARTER", field: "quarter", message: "quarter must be 1, 2, 3, or 4" });
  }

  if (!isInteger(target.month) || target.month < 1 || target.month > 12) {
    errors.push({ code: "INVALID_MONTH", field: "month", message: "month must be an integer between 1 and 12" });
  }

  if (!isNonNegativeInteger(target.targetUnits)) {
    errors.push({ code: "INVALID_TARGET_UNITS", field: "targetUnits", message: "targetUnits must be a non-negative integer" });
  }

  if (!isFiniteNumber(target.targetValue) || target.targetValue < 0) {
    errors.push({ code: "INVALID_TARGET_VALUE", field: "targetValue", message: "targetValue must be a non-negative finite number" });
  }

  if (!isFiniteNumber(target.unitPriceSnapshot) || target.unitPriceSnapshot < 0) {
    errors.push({ code: "INVALID_UNIT_PRICE", field: "unitPriceSnapshot", message: "unitPriceSnapshot must be a non-negative finite number" });
  }

  if (!isNonEmptyString(target.currencyCode)) {
    errors.push({ code: "INVALID_CURRENCY", field: "currencyCode", message: "currencyCode must be a non-empty string" });
  }

  if (!isValidStatus(target.status)) {
    errors.push({ code: "INVALID_STATUS", field: "status", message: "status must be one of the frozen TargetStatus values" });
  }

  if (!isPositiveInteger(target.version)) {
    errors.push({ code: "INVALID_VERSION", field: "version", message: "version must be a positive integer" });
  }

  if (!isPositiveInteger(target.calculationVersion)) {
    errors.push({ code: "INVALID_CALCULATION_VERSION", field: "calculationVersion", message: "calculationVersion must be a positive integer" });
  }

  if (!isNonEmptyString(target.calculationInputHash)) {
    errors.push({ code: "INVALID_INPUT_HASH", field: "calculationInputHash", message: "calculationInputHash must be a non-empty string" });
  }

  if (!isBoolean(target.active)) {
    errors.push({ code: "INVALID_ACTIVE", field: "active", message: "active must be a boolean" });
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validates TargetCalculationRun shape.
 */
export function validateTargetCalculationRunShape(run: any): ValidationOutcome {
  const errors: ValidationError[] = [];

  if (!run) {
    return { valid: false, errors: [{ code: "MISSING_RUN", message: "Run object is null or undefined" }] };
  }

  if (!isNonEmptyString(run.runId)) {
    errors.push({ code: "INVALID_RUN_ID", field: "runId", message: "runId must be a non-empty string" });
  }

  if (!isNonEmptyString(run.planId)) {
    errors.push({ code: "INVALID_PLAN_ID", field: "planId", message: "planId must be a non-empty string" });
  }

  if (!isNonEmptyString(run.countryId)) {
    errors.push({ code: "INVALID_COUNTRY_ID", field: "countryId", message: "countryId must be a non-empty string" });
  }

  if (!isInteger(run.year)) {
    errors.push({ code: "INVALID_YEAR", field: "year", message: "year must be an integer" });
  } else if (run.year <= 0) {
    errors.push({ code: "INVALID_YEAR_VALUE", field: "year", message: "year must be a positive integer" });
  }

  if (!isNonEmptyString(run.requestedBy)) {
    errors.push({ code: "INVALID_REQUESTED_BY", field: "requestedBy", message: "requestedBy must be a non-empty string" });
  }

  if (!isNonEmptyString(run.requestedAt)) {
    errors.push({ code: "INVALID_REQUESTED_AT", field: "requestedAt", message: "requestedAt must be a non-empty string" });
  }

  const allowedRunStatuses = ["PENDING", "IN_PROGRESS", "COMPLETE", "PARTIAL", "FAILED"];
  if (!allowedRunStatuses.includes(run.status)) {
    errors.push({ code: "INVALID_STATUS", field: "status", message: "status must be PENDING, IN_PROGRESS, COMPLETE, PARTIAL, or FAILED" });
  }

  const countFields = ["productsRequested", "productsSucceeded", "productsFailed", "targetsCreated", "targetsUpdated"];
  countFields.forEach((f) => {
    const val = run[f];
    if (!isNonNegativeInteger(val)) {
      errors.push({ code: `INVALID_${f.toUpperCase()}`, field: f, message: `${f} must be a non-negative integer` });
    }
  });

  if (!isBoolean(run.active)) {
    errors.push({ code: "INVALID_ACTIVE", field: "active", message: "active must be a boolean" });
  }

  return { valid: errors.length === 0, errors };
}
