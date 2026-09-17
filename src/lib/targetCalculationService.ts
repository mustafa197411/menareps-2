import crypto from "crypto";
import { getFirebaseAdminServices } from "../../server/firebaseAdmin";
import { 
  TargetStatus, 
  ProductTargetPlan, 
  ProductAnnualTarget, 
  ProductAreaPotential, 
  ProductQuarterlyDistribution, 
  CalculatedProductTarget, 
  TargetCalculationRun 
} from "../types";
import { createCalculatedProductTargetId, createTargetCalculationRunId } from "./productTargetIdService";

// Percentage tolerance constants
export const TOLERANCE_MIN = 99.99;
export const TOLERANCE_MAX = 100.01;

// ==========================================================
// 1. PURE VALIDATION AND CALCULATION FUNCTIONS
// ==========================================================

/**
 * Checks that the sum of area potentials is within 99.99% and 100.01%.
 */
export function validateAreaPotentialTotal(potentials: number[]): boolean {
  if (potentials.length === 0) return false;
  const sum = potentials.reduce((acc, val) => acc + val, 0);
  return sum >= TOLERANCE_MIN && sum <= TOLERANCE_MAX;
}

/**
 * Checks that the sum of quarterly distribution percentages is within 99.99% and 100.01%.
 */
export function validateQuarterlyDistributionTotal(
  q1: number,
  q2: number,
  q3: number,
  q4: number
): boolean {
  const sum = q1 + q2 + q3 + q4;
  return sum >= TOLERANCE_MIN && sum <= TOLERANCE_MAX;
}

/**
 * Calculates value based on target units and unit price.
 */
export function calculateAnnualTargetValue(
  annualTargetUnits: number,
  unitPriceSnapshot: number
): number {
  return Math.round(annualTargetUnits * unitPriceSnapshot * 100) / 100;
}

/**
 * Multiplies annual target units by potential percentage / 100 (high-precision decimal).
 */
export function calculateAreaAnnualDecimalUnits(
  annualTargetUnits: number,
  potentialPercentage: number
): number {
  return annualTargetUnits * (potentialPercentage / 100);
}

/**
 * Multiplies area annual units by quarterly percentage / 100.
 */
export function calculateQuarterAreaDecimalUnits(
  areaAnnualUnits: number,
  qPercentage: number
): number {
  return areaAnnualUnits * (qPercentage / 100);
}

/**
 * Divides quarter area units by 3 (high-precision decimal).
 */
export function calculateMonthlyTargetDecimals(quarterAreaUnits: number): number {
  return quarterAreaUnits / 3;
}

// ==========================================================
// 2. DETERMINISTIC LARGEST-REMAINDER ROUNDING RECONCILIATION
// ==========================================================

/**
 * Reconciles the country's annual target units across multiple areas based on potential percentages.
 * Guarantees that the sum of reconciled integer annual targets across all areas is exactly equal to annualTargetUnits.
 */
export function reconcileAreaAnnualUnits(
  annualTargetUnits: number,
  potentials: { areaId: string; percentage: number }[]
): { [areaId: string]: number } {
  const result: { [areaId: string]: number } = {};
  if (potentials.length === 0) return result;

  // Calculate theoretical decimal targets
  const theoreticals = potentials.map(p => ({
    areaId: p.areaId,
    value: annualTargetUnits * (p.percentage / 100)
  }));

  // Initial floor distribution
  const floors = theoreticals.map(t => ({
    areaId: t.areaId,
    floor: Math.floor(t.value),
    remainder: t.value - Math.floor(t.value)
  }));

  const distributedSum = floors.reduce((sum, f) => sum + f.floor, 0);
  const remaining = annualTargetUnits - distributedSum;

  // Initialize results with floors
  for (const f of floors) {
    result[f.areaId] = f.floor;
  }

  if (remaining > 0) {
    // Sort by remainder descending, then deterministically by areaId ascending to break ties
    const sorted = [...floors].sort((a, b) => {
      if (Math.abs(a.remainder - b.remainder) > 1e-9) {
        return b.remainder - a.remainder;
      }
      return a.areaId.localeCompare(b.areaId);
    });

    // Distribute remaining units 1-by-1
    for (let i = 0; i < remaining; i++) {
      const targetArea = sorted[i % sorted.length].areaId;
      result[targetArea] += 1;
    }
  }

  return result;
}

/**
 * Reconciles an area's annual target units across 12 months using quarterly percentages
 * and EQUAL_WITHIN_QUARTER method.
 * Guarantees that the sum of monthly integer targets over 12 months equals areaAnnualUnits exactly.
 */
export function reconcileMonthlyUnitsForArea(
  areaAnnualUnits: number,
  qPercentage: { q1: number; q2: number; q3: number; q4: number }
): number[] {
  const monthlyUnits = new Array(12).fill(0);
  if (areaAnnualUnits <= 0) return monthlyUnits;

  // Get quarterly percentages mapped to months
  const qPercentages = [
    qPercentage.q1, qPercentage.q1, qPercentage.q1, // Q1: Jan, Feb, Mar
    qPercentage.q2, qPercentage.q2, qPercentage.q2, // Q2: Apr, May, Jun
    qPercentage.q3, qPercentage.q3, qPercentage.q3, // Q3: Jul, Aug, Sep
    qPercentage.q4, qPercentage.q4, qPercentage.q4  // Q4: Oct, Nov, Dec
  ];

  // Each month gets 1/3 of its quarter's percentage of the annual target.
  const theoreticals = qPercentages.map((qp, idx) => ({
    month: idx + 1,
    value: areaAnnualUnits * (qp / 300)
  }));

  // Initial floor distribution
  const floors = theoreticals.map(t => ({
    month: t.month,
    floor: Math.floor(t.value),
    remainder: t.value - Math.floor(t.value)
  }));

  const distributedSum = floors.reduce((sum, f) => sum + f.floor, 0);
  const remaining = areaAnnualUnits - distributedSum;

  // Initialize with floors
  for (const f of floors) {
    monthlyUnits[f.month - 1] = f.floor;
  }

  if (remaining > 0) {
    // Sort by remainder descending, then deterministically by month ascending to break ties
    const sorted = [...floors].sort((a, b) => {
      if (Math.abs(a.remainder - b.remainder) > 1e-9) {
        return b.remainder - a.remainder;
      }
      return a.month - b.month;
    });

    // Distribute remaining units 1-by-1
    for (let i = 0; i < remaining; i++) {
      const targetMonthIdx = sorted[i % sorted.length].month - 1;
      monthlyUnits[targetMonthIdx] += 1;
    }
  }

  return monthlyUnits;
}

// ==========================================================
// 3. IDEMPOTENCY AND INPUT HASHING
// ==========================================================

/**
 * Computes a deterministic SHA256 of the calculation inputs for a specific calculated target
 * to enable idempotency checks and prevent redundant writes.
 */
export function calculateInputHash(inputs: {
  planId: string;
  productId: string;
  areaId: string;
  annualTargetUnits: number;
  unitPriceSnapshot: number;
  potentialPercentage: number;
  q1Percentage: number;
  q2Percentage: number;
  q3Percentage: number;
  q4Percentage: number;
}): string {
  const payload = {
    planId: inputs.planId,
    productId: inputs.productId,
    areaId: inputs.areaId,
    annualTargetUnits: inputs.annualTargetUnits,
    unitPriceSnapshot: inputs.unitPriceSnapshot,
    potentialPercentage: inputs.potentialPercentage,
    q1Percentage: inputs.q1Percentage,
    q2Percentage: inputs.q2Percentage,
    q3Percentage: inputs.q3Percentage,
    q4Percentage: inputs.q4Percentage
  };
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

// ==========================================================
// 4. PERSISTENCE ORCHESTRATION PIPELINE
// ==========================================================

/**
 * Runs the deterministic target calculation run for all products in a given plan.
 * Implements a robust state machine: PENDING -> IN_PROGRESS -> COMPLETE / PARTIAL / FAILED.
 * Employs transaction-safe batching (max 400 writes per batch) and input hashing idempotency.
 */
export async function runTargetCalculation(
  planId: string,
  requestedBy: string,
  customDb?: any
): Promise<TargetCalculationRun> {
  const db = customDb || getFirebaseAdminServices().db;
  const runId = `RUN::${planId}::${Date.now()}::${Math.floor(1000 + Math.random() * 9000)}`;
  const runDocId = createTargetCalculationRunId(planId, runId);
  const now = new Date().toISOString();

  // 1. Initialize Run State Machine as PENDING
  const initialRun: TargetCalculationRun = {
    runId,
    planId,
    countryId: "UNKNOWN",
    year: 0,
    requestedBy,
    requestedAt: now,
    status: "PENDING",
    productsRequested: 0,
    productsSucceeded: 0,
    productsFailed: 0,
    targetsCreated: 0,
    targetsUpdated: 0,
    active: true,
    productIds: [],
    errors: [],
    startedAt: now
  };

  const runRef = db.collection("targetCalculationRuns").doc(runDocId);
  await runRef.set(initialRun);

  try {
    // 2. Fetch target plan details
    const planSnap = await db.collection("productTargetPlans").doc(planId).get();
    if (!planSnap.exists) {
      const errMsg = `Target plan '${planId}' was not found.`;
      await runRef.update({
        status: "FAILED",
        errors: [errMsg],
        completedAt: new Date().toISOString(),
        lastCompletedStage: "FETCH_PLAN_DETAILS"
      });
      throw new Error(errMsg);
    }

    const plan = planSnap.data() as ProductTargetPlan;
    
    // Transition to IN_PROGRESS
    await runRef.update({
      status: "IN_PROGRESS",
      countryId: plan.countryId,
      year: plan.year,
      lastCompletedStage: "FETCH_PLAN_DETAILS"
    });

    // Fetch active annual product targets for this plan
    const annualTargetsSnap = await db.collection("productAnnualTargets")
      .where("planId", "==", planId)
      .where("active", "==", true)
      .get();

    const annualTargets = annualTargetsSnap.docs.map(doc => doc.data() as ProductAnnualTarget);
    const productIds = annualTargets.map(t => t.productId);

    if (annualTargets.length === 0) {
      await runRef.update({
        status: "COMPLETE",
        productsRequested: 0,
        completedAt: new Date().toISOString(),
        lastCompletedStage: "PROCESS_PRODUCTS"
      });
      return {
        ...initialRun,
        countryId: plan.countryId,
        year: plan.year,
        status: "COMPLETE",
        completedAt: new Date().toISOString()
      };
    }

    await runRef.update({
      productsRequested: annualTargets.length,
      productIds
    });

    let productsSucceeded = 0;
    let productsFailed = 0;
    let targetsCreated = 0;
    let targetsUpdated = 0;
    const errorsList: string[] = [];
    const calculatedTargetsToWrite: CalculatedProductTarget[] = [];

    // 3. Process each product annual target
    for (const target of annualTargets) {
      try {
        const { productId, annualTargetUnits, targetId } = target;

        // Fetch area potentials for this product
        const potentialsSnap = await db.collection("productAreaPotentials")
          .where("planId", "==", planId)
          .where("productId", "==", productId)
          .where("active", "==", true)
          .get();

        const potentials = potentialsSnap.docs.map(doc => doc.data() as ProductAreaPotential);

        // Fetch quarterly distribution
        const distributionsSnap = await db.collection("productQuarterlyDistributions")
          .where("planId", "==", planId)
          .where("productId", "==", productId)
          .where("active", "==", true)
          .get();

        if (distributionsSnap.empty) {
          throw new Error(`Quarterly distribution missing for product ${productId}`);
        }
        if (potentials.length === 0) {
          throw new Error(`Area potentials missing for product ${productId}`);
        }

        const dist = distributionsSnap.docs[0].data() as ProductQuarterlyDistribution;

        // Validation 1: Area potentials total sum (99.99% - 100.01%)
        const potentialVals = potentials.map(p => p.potentialPercentage);
        if (!validateAreaPotentialTotal(potentialVals)) {
          throw new Error(`Area potentials for product ${productId} do not sum to 100% (Sum: ${potentialVals.reduce((a,b)=>a+b,0)}%)`);
        }

        // Validation 2: Quarterly distribution total sum (99.99% - 100.01%)
        if (!validateQuarterlyDistributionTotal(dist.q1Percentage, dist.q2Percentage, dist.q3Percentage, dist.q4Percentage)) {
          const sum = dist.q1Percentage + dist.q2Percentage + dist.q3Percentage + dist.q4Percentage;
          throw new Error(`Quarterly distribution for product ${productId} does not sum to 100% (Sum: ${sum}%)`);
        }

        const unitPrice = target.unitPriceSnapshot || 0;

        // Step 1: Reconcile annual units across areas
        const areaPotentialsInput = potentials.map(p => ({
          areaId: p.areaId,
          percentage: p.potentialPercentage
        }));
        const reconciledAreaAnnuals = reconcileAreaAnnualUnits(annualTargetUnits, areaPotentialsInput);

        // Step 2: Reconcile monthly targets for each area
        for (const potential of potentials) {
          const { areaId, areaPotentialId } = potential;
          const areaAnnualUnits = reconciledAreaAnnuals[areaId] || 0;

          const monthlyReconciledUnits = reconcileMonthlyUnitsForArea(areaAnnualUnits, {
            q1: dist.q1Percentage,
            q2: dist.q2Percentage,
            q3: dist.q3Percentage,
            q4: dist.q4Percentage
          });

          // Build CalculatedProductTarget for each of the 12 months
          for (let m = 1; m <= 12; m++) {
            const quarter = Math.ceil(m / 3) as 1 | 2 | 3 | 4;
            let qPercentage = dist.q1Percentage;
            if (quarter === 2) qPercentage = dist.q2Percentage;
            else if (quarter === 3) qPercentage = dist.q3Percentage;
            else if (quarter === 4) qPercentage = dist.q4Percentage;

            const targetUnits = monthlyReconciledUnits[m - 1];
            const targetValue = calculateAnnualTargetValue(targetUnits, unitPrice);

            const inputHash = calculateInputHash({
              planId,
              productId,
              areaId,
              annualTargetUnits,
              unitPriceSnapshot: unitPrice,
              potentialPercentage: potential.potentialPercentage,
              q1Percentage: dist.q1Percentage,
              q2Percentage: dist.q2Percentage,
              q3Percentage: dist.q3Percentage,
              q4Percentage: dist.q4Percentage
            });

            const calculatedTargetId = createCalculatedProductTargetId(
              planId,
              productId,
              areaId,
              m,
              plan.version
            );

            const calculatedTarget: CalculatedProductTarget = {
              calculatedTargetId,
              planId,
              annualTargetId: targetId,
              areaPotentialId,
              quarterlyDistributionId: dist.quarterlyDistributionId,
              countryId: plan.countryId,
              productId,
              areaId,
              year: plan.year,
              quarter,
              month: m,
              targetUnits,
              targetValue,
              unitPriceSnapshot: unitPrice,
              currencyCode: plan.currencyCode,
              status: plan.status,
              version: plan.version,
              calculationVersion: 1,
              calculationInputHash: inputHash,
              active: true,
              annualTargetUnitsSnapshot: annualTargetUnits,
              areaPotentialPercentageSnapshot: potential.potentialPercentage,
              quarterPercentageSnapshot: qPercentage,
              monthlyDistributionMethodSnapshot: "EQUAL_WITHIN_QUARTER",
              productSkuSnapshot: target.productSkuSnapshot,
              productNameSnapshot: target.productNameSnapshot,
              areaCodeSnapshot: potential.areaCodeSnapshot,
              areaNameSnapshot: potential.areaNameSnapshot,
              calculatedAt: now,
              calculatedBy: requestedBy
            };

            calculatedTargetsToWrite.push(calculatedTarget);
          }
        }

        productsSucceeded++;
      } catch (err: any) {
        productsFailed++;
        const errMsg = `Product ${target.productId} calculation failed: ${err.message}`;
        errorsList.push(errMsg);
        console.error(errMsg);
      }
    }

    // 4. Persistence optimization with batch writes (Max 400 writes per batch)
    const BATCH_LIMIT = 400;
    let batch = db.batch();
    let batchOpsCount = 0;

    for (const target of calculatedTargetsToWrite) {
      const docRef = db.collection("calculatedProductTargets").doc(target.calculatedTargetId);
      
      // Perform Idempotency Check by reading existing target first, or comparing with in-memory list
      // Since we want to support full idempotency and overwrite protection:
      const existingSnap = await docRef.get();
      if (existingSnap.exists) {
        const existingData = existingSnap.data() as CalculatedProductTarget;
        if (existingData.calculationInputHash === target.calculationInputHash && existingData.active === target.active) {
          // Input hash and active status match exactly. Skip write to save database ops.
          continue;
        }
        targetsUpdated++;
      } else {
        targetsCreated++;
      }

      batch.set(docRef, target);
      batchOpsCount++;

      if (batchOpsCount >= BATCH_LIMIT) {
        await batch.commit();
        batch = db.batch();
        batchOpsCount = 0;
      }
    }

    if (batchOpsCount > 0) {
      await batch.commit();
    }

    // 5. Finalize state machine transition
    let finalStatus: "COMPLETE" | "PARTIAL" | "FAILED" = "COMPLETE";
    if (productsFailed > 0) {
      finalStatus = productsSucceeded > 0 ? "PARTIAL" : "FAILED";
    }

    const completedRun: Partial<TargetCalculationRun> = {
      status: finalStatus,
      productsRequested: annualTargets.length,
      productIds,
      productsSucceeded,
      productsFailed,
      targetsCreated,
      targetsUpdated,
      errors: errorsList,
      completedAt: new Date().toISOString(),
      lastCompletedStage: "WRITE_CALCULATED_TARGETS"
    };

    await runRef.update(completedRun);

    return {
      ...initialRun,
      ...completedRun
    } as TargetCalculationRun;

  } catch (err: any) {
    console.error("Target calculation run critical pipeline failure:", err);
    const failedRun: Partial<TargetCalculationRun> = {
      status: "FAILED",
      errors: [err.message],
      completedAt: new Date().toISOString(),
      lastCompletedStage: "PIPELINE_ERROR"
    };
    await runRef.update(failedRun).catch(cErr => console.error("Failed to write failure run state:", cErr));
    throw err;
  }
}
