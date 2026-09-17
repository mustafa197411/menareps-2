/**
 * Deterministic document ID generator service for MENAREPS 2.0 Product Sales Targets.
 * Translates canonical variables into safe, collision-free Firestore document IDs.
 */

/**
 * Encodes a value to be safe for inclusion in a Firestore document ID.
 * Uses encodeURIComponent to preserve characters and case while escaping unsafe Firestore path characters.
 */
export function encodeTargetIdPart(value: string | number | boolean): string {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error("Target ID part cannot be undefined, null, or empty");
  }
  return encodeURIComponent(String(value));
}

/**
 * Creates a deterministic document ID for a ProductTargetPlan.
 * Pattern: PTP_{countryId}_{year}_V{version}
 */
export function createProductTargetPlanId(countryId: string, year: number, version: number): string {
  if (!countryId || typeof countryId !== "string" || countryId.trim() === "") {
    throw new Error("countryId is required and must be a non-empty string");
  }
  if (typeof year !== "number" || isNaN(year) || !Number.isInteger(year) || year <= 0) {
    throw new Error("year is required and must be a positive integer");
  }
  if (typeof version !== "number" || isNaN(version) || !Number.isInteger(version) || version <= 0) {
    throw new Error("version is required and must be a positive integer");
  }
  const id = `PTP::${encodeTargetIdPart(countryId)}::${year}::V${version}`;
  if (id.length > 1024) {
    throw new Error("Generated ProductTargetPlan ID exceeds Firestore limit of 1024 characters");
  }
  return id;
}

/**
 * Creates a deterministic document ID for a ProductAnnualTarget.
 * Pattern: PAT::{planId}::{productId}
 */
export function createProductAnnualTargetId(planId: string, productId: string): string {
  if (!planId || typeof planId !== "string" || planId.trim() === "") {
    throw new Error("planId is required and must be a non-empty string");
  }
  if (!productId || typeof productId !== "string" || productId.trim() === "") {
    throw new Error("productId is required and must be a non-empty string");
  }
  const id = `PAT::${encodeTargetIdPart(planId)}::${encodeTargetIdPart(productId)}`;
  if (id.length > 1024) {
    throw new Error("Generated ProductAnnualTarget ID exceeds Firestore limit of 1024 characters");
  }
  return id;
}

/**
 * Creates a deterministic document ID for a ProductAreaPotential.
 * Pattern: PAP::{annualTargetId}::{areaId}
 */
export function createProductAreaPotentialId(annualTargetId: string, areaId: string): string {
  if (!annualTargetId || typeof annualTargetId !== "string" || annualTargetId.trim() === "") {
    throw new Error("annualTargetId is required and must be a non-empty string");
  }
  if (!areaId || typeof areaId !== "string" || areaId.trim() === "") {
    throw new Error("areaId is required and must be a non-empty string");
  }
  const id = `PAP::${encodeTargetIdPart(annualTargetId)}::${encodeTargetIdPart(areaId)}`;
  if (id.length > 1024) {
    throw new Error("Generated ProductAreaPotential ID exceeds Firestore limit of 1024 characters");
  }
  return id;
}

/**
 * Creates a deterministic document ID for a ProductQuarterlyDistribution.
 * Pattern: PQD::{annualTargetId}
 */
export function createProductQuarterlyDistributionId(annualTargetId: string): string {
  if (!annualTargetId || typeof annualTargetId !== "string" || annualTargetId.trim() === "") {
    throw new Error("annualTargetId is required and must be a non-empty string");
  }
  const id = `PQD::${encodeTargetIdPart(annualTargetId)}`;
  if (id.length > 1024) {
    throw new Error("Generated ProductQuarterlyDistribution ID exceeds Firestore limit of 1024 characters");
  }
  return id;
}

/**
 * Creates a deterministic document ID for a CalculatedProductTarget.
 * Pattern: CPT::{planId}::{productId}::{areaId}::{month}::V{version}
 */
export function createCalculatedProductTargetId(
  planId: string,
  productId: string,
  areaId: string,
  month: number,
  version: number
): string {
  if (!planId || typeof planId !== "string" || planId.trim() === "") {
    throw new Error("planId is required and must be a non-empty string");
  }
  if (!productId || typeof productId !== "string" || productId.trim() === "") {
    throw new Error("productId is required and must be a non-empty string");
  }
  if (!areaId || typeof areaId !== "string" || areaId.trim() === "") {
    throw new Error("areaId is required and must be a non-empty string");
  }
  if (typeof month !== "number" || isNaN(month) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("month is required and must be an integer between 1 and 12");
  }
  if (typeof version !== "number" || isNaN(version) || !Number.isInteger(version) || version <= 0) {
    throw new Error("version is required and must be a positive integer");
  }
  const id = `CPT::${encodeTargetIdPart(planId)}::${encodeTargetIdPart(productId)}::${encodeTargetIdPart(areaId)}::${month}::V${version}`;
  if (id.length > 1024) {
    throw new Error("Generated CalculatedProductTarget ID exceeds Firestore limit of 1024 characters");
  }
  return id;
}

/**
 * Creates a deterministic document ID for a TargetCalculationRun.
 * Pattern: TCR::{planId}::{runId}
 */
export function createTargetCalculationRunId(planId: string, runId: string): string {
  if (!planId || typeof planId !== "string" || planId.trim() === "") {
    throw new Error("planId is required and must be a non-empty string");
  }
  if (!runId || typeof runId !== "string" || runId.trim() === "") {
    throw new Error("runId is required and must be a non-empty string");
  }
  const id = `TCR::${encodeTargetIdPart(planId)}::${encodeTargetIdPart(runId)}`;
  if (id.length > 1024) {
    throw new Error("Generated TargetCalculationRun ID exceeds Firestore limit of 1024 characters");
  }
  return id;
}
