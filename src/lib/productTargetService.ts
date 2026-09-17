import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  query, 
  where, 
  CollectionReference, 
  DocumentReference,
  DocumentSnapshot,
  Query
} from "firebase/firestore";
import { db, firestoreDatabaseId } from "./firebase";
import { 
  ProductTargetPlan, 
  ProductAnnualTarget, 
  ProductAreaPotential, 
  ProductQuarterlyDistribution, 
  CalculatedProductTarget, 
  TargetCalculationRun 
} from "../types";

/**
 * Canonically registered collection names for Product Sales Target.
 * Replaces string literals throughout the codebase to ensure consistency.
 */
export const PRODUCT_TARGET_COLLECTIONS = {
  plans: "productTargetPlans",
  annualTargets: "productAnnualTargets",
  areaPotentials: "productAreaPotentials",
  quarterlyDistributions: "productQuarterlyDistributions",
  calculatedTargets: "calculatedProductTargets",
  calculationRuns: "targetCalculationRuns"
};

/**
 * Ensures we are explicitly using the approved named database.
 */
export function getNamedDatabaseId(): string {
  if (!firestoreDatabaseId) {
    throw new Error("Firestore database ID is not initialized in firebase.ts");
  }
  return firestoreDatabaseId;
}

// ==========================================================
// CANONICAL COLLECTION REFERENCE HELPERS
// ==========================================================

export function getProductTargetPlanCollection(): CollectionReference<ProductTargetPlan> {
  return collection(db, PRODUCT_TARGET_COLLECTIONS.plans) as CollectionReference<ProductTargetPlan>;
}

export function getProductAnnualTargetCollection(): CollectionReference<ProductAnnualTarget> {
  return collection(db, PRODUCT_TARGET_COLLECTIONS.annualTargets) as CollectionReference<ProductAnnualTarget>;
}

export function getProductAreaPotentialCollection(): CollectionReference<ProductAreaPotential> {
  return collection(db, PRODUCT_TARGET_COLLECTIONS.areaPotentials) as CollectionReference<ProductAreaPotential>;
}

export function getProductQuarterlyDistributionCollection(): CollectionReference<ProductQuarterlyDistribution> {
  return collection(db, PRODUCT_TARGET_COLLECTIONS.quarterlyDistributions) as CollectionReference<ProductQuarterlyDistribution>;
}

export function getCalculatedProductTargetCollection(): CollectionReference<CalculatedProductTarget> {
  return collection(db, PRODUCT_TARGET_COLLECTIONS.calculatedTargets) as CollectionReference<CalculatedProductTarget>;
}

export function getTargetCalculationRunCollection(): CollectionReference<TargetCalculationRun> {
  return collection(db, PRODUCT_TARGET_COLLECTIONS.calculationRuns) as CollectionReference<TargetCalculationRun>;
}

// ==========================================================
// CANONICAL DOCUMENT REFERENCE HELPERS
// ==========================================================

export function getProductTargetPlanDocRef(planId: string): DocumentReference<ProductTargetPlan> {
  return doc(db, PRODUCT_TARGET_COLLECTIONS.plans, planId) as DocumentReference<ProductTargetPlan>;
}

export function getProductAnnualTargetDocRef(targetId: string): DocumentReference<ProductAnnualTarget> {
  return doc(db, PRODUCT_TARGET_COLLECTIONS.annualTargets, targetId) as DocumentReference<ProductAnnualTarget>;
}

export function getProductAreaPotentialDocRef(potentialId: string): DocumentReference<ProductAreaPotential> {
  return doc(db, PRODUCT_TARGET_COLLECTIONS.areaPotentials, potentialId) as DocumentReference<ProductAreaPotential>;
}

export function getProductQuarterlyDistributionDocRef(distId: string): DocumentReference<ProductQuarterlyDistribution> {
  return doc(db, PRODUCT_TARGET_COLLECTIONS.quarterlyDistributions, distId) as DocumentReference<ProductQuarterlyDistribution>;
}

export function getCalculatedProductTargetDocRef(targetId: string): DocumentReference<CalculatedProductTarget> {
  return doc(db, PRODUCT_TARGET_COLLECTIONS.calculatedTargets, targetId) as DocumentReference<CalculatedProductTarget>;
}

export function getTargetCalculationRunDocRef(runId: string): DocumentReference<TargetCalculationRun> {
  return doc(db, PRODUCT_TARGET_COLLECTIONS.calculationRuns, runId) as DocumentReference<TargetCalculationRun>;
}

// ==========================================================
// SAFE READ-ONE READ-ONLY FOUNDATION FOR VERIFICATION
// ==========================================================

export async function readProductTargetPlan(planId: string): Promise<ProductTargetPlan | null> {
  const docRef = getProductTargetPlanDocRef(planId);
  const snap = await getDoc(docRef);
  return snap.exists() ? snap.data() : null;
}

export async function readProductAnnualTarget(targetId: string): Promise<ProductAnnualTarget | null> {
  const docRef = getProductAnnualTargetDocRef(targetId);
  const snap = await getDoc(docRef);
  return snap.exists() ? snap.data() : null;
}

// ==========================================================
// SAFE PAYLOAD SANITIZATION HELPERS
// ==========================================================

/**
 * Strips fields containing undefined values from any payload to prevent Firestore write crashes.
 * Retains null values if they are explicitly part of the valid schema.
 */
export function stripUndefinedFields<T extends Record<string, any>>(obj: T): Partial<T> {
  const clean: Record<string, any> = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const val = obj[key];
      if (val !== undefined) {
        clean[key] = val;
      }
    }
  }
  return clean as Partial<T>;
}

// ==========================================================
// QUERY-BUILDER FOUNDATION
// ==========================================================

export function buildActivePlansQuery(countryId: string, year: number): Query<ProductTargetPlan> {
  const colRef = getProductTargetPlanCollection();
  return query(colRef, where("countryId", "==", countryId), where("year", "==", year), where("active", "==", true));
}

export function buildAnnualTargetsForPlanQuery(planId: string): Query<ProductAnnualTarget> {
  const colRef = getProductAnnualTargetCollection();
  return query(colRef, where("planId", "==", planId), where("active", "==", true));
}

export function buildCalculatedTargetsForRepQuery(areaId: string, year: number): Query<CalculatedProductTarget> {
  const colRef = getCalculatedProductTargetCollection();
  return query(colRef, where("areaId", "==", areaId), where("year", "==", year), where("active", "==", true));
}

// ==========================================================
// 4. EFFECTIVE VERSION RESOLUTION (WP4.1H.2)
// ==========================================================

export class TargetVersionError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "TargetVersionError";
  }
}

/**
 * Pure resolver that resolves the effective target version for an event date.
 * Enforces half-open interval: effectiveFrom <= eventDate < effectiveTo (exclusive).
 * Rejects overlaps, gaps, and ambiguity.
 */
export function resolveEffectiveTargetVersion(params: {
  versions: ProductTargetPlan[];
  eventDate: string;
}): ProductTargetPlan {
  const { versions, eventDate } = params;

  // 1. Validate eventDate
  if (!eventDate || typeof eventDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
    throw new TargetVersionError("INVALID_EFFECTIVE_DATE", `Invalid effective date format: "${eventDate}". Expected YYYY-MM-DD.`);
  }

  // Filter versions to ACTIVE or SUPERSEDED
  const activeOrSuperseded = versions.filter(v => v.status === "ACTIVE" || v.status === "SUPERSEDED");

  if (activeOrSuperseded.length === 0) {
    throw new TargetVersionError("TARGET_VERSION_NOT_EFFECTIVE", `No active or superseded target plans found for date ${eventDate}.`);
  }

  // 2. Reject overlapping intervals across all active/superseded plans in this list
  for (let i = 0; i < activeOrSuperseded.length; i++) {
    const vA = activeOrSuperseded[i];
    const startA = vA.effectiveFrom || `${vA.year}-01-01`;
    const endA = vA.effectiveTo || `${vA.year + 1}-01-01`;

    for (let j = i + 1; j < activeOrSuperseded.length; j++) {
      const vB = activeOrSuperseded[j];
      const startB = vB.effectiveFrom || `${vB.year}-01-01`;
      const endB = vB.effectiveTo || `${vB.year + 1}-01-01`;

      if (startA < endB && startB < endA) {
        throw new TargetVersionError(
          "TARGET_VERSION_OVERLAP",
          `Overlapping target plan intervals detected: ${vA.planId} [${startA}, ${endA}) and ${vB.planId} [${startB}, ${endB}).`
        );
      }
    }
  }

  // 3. Find exact matching version (half-open interval: start <= eventDate < end)
  const matches = activeOrSuperseded.filter(v => {
    const start = v.effectiveFrom || `${v.year}-01-01`;
    // If effectiveTo is not set, cap it at the end of the plan's calendar year (exclusive: next year's Jan 1)
    const end = v.effectiveTo || `${v.year + 1}-01-01`;

    const meetsStart = eventDate >= start;
    const meetsEnd = eventDate < end;
    return meetsStart && meetsEnd;
  });

  if (matches.length > 1) {
    throw new TargetVersionError("TARGET_VERSION_AMBIGUOUS", `Multiple matching target plan versions found for date ${eventDate}.`);
  }

  if (matches.length === 1) {
    return matches[0];
  }

  // 4. Reject gaps
  const firstPlan = activeOrSuperseded[0];
  const targetYearStr = firstPlan.year.toString();
  if (eventDate.startsWith(targetYearStr)) {
    throw new TargetVersionError("TARGET_VERSION_GAP", `A target version gap was detected for date ${eventDate} in year ${firstPlan.year}.`);
  }

  throw new TargetVersionError("TARGET_VERSION_NOT_EFFECTIVE", `No effective target plan found for date ${eventDate}.`);
}

