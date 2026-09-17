import { 
  validateAreaPotentialTotal,
  validateQuarterlyDistributionTotal,
  calculateAnnualTargetValue,
  calculateAreaAnnualDecimalUnits,
  calculateQuarterAreaDecimalUnits,
  calculateMonthlyTargetDecimals,
  reconcileAreaAnnualUnits,
  reconcileMonthlyUnitsForArea,
  calculateInputHash,
  runTargetCalculation
} from "./lib/targetCalculationService";

import { 
  createProductTargetPlanId, 
  createProductAnnualTargetId,
  createProductAreaPotentialId,
  createProductQuarterlyDistributionId,
  createCalculatedProductTargetId,
  createTargetCalculationRunId
} from "./lib/productTargetIdService";

import { TargetStatus } from "./types";
import { getFirebaseAdminServices } from "../server/firebaseAdmin";

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
  console.log("MENAREPS 2.0 WP4.1D - TRUSTED PRODUCT SALES TARGET BACKEND SERVICES TESTS");
  console.log("=================================================================\n");

  // ==========================================================
  // 1. PURE VALIDATION AND CALCULATION UNIT TESTS
  // ==========================================================
  console.log(">>> Running Pure Validation & Calculation Unit Tests...");

  // 1.1 validateAreaPotentialTotal
  {
    assert(validateAreaPotentialTotal([50, 50]), "1.1.1. 50 + 50 is within tolerance");
    assert(validateAreaPotentialTotal([33.33, 33.33, 33.34]), "1.1.2. 33.33 + 33.33 + 33.34 (100.00) is within tolerance");
    assert(validateAreaPotentialTotal([33.33, 33.33, 33.33]), "1.1.3. 33.33 * 3 (99.99) is within tolerance");
    assert(validateAreaPotentialTotal([33.34, 33.34, 33.33]), "1.1.4. 33.34 * 2 + 33.33 (100.01) is within tolerance");
    assert(!validateAreaPotentialTotal([33.33, 33.33, 33.32]), "1.1.5. 99.98 is outside minimum tolerance");
    assert(!validateAreaPotentialTotal([33.34, 33.34, 33.34]), "1.1.6. 100.02 is outside maximum tolerance");
    assert(!validateAreaPotentialTotal([]), "1.1.7. Empty array is rejected");
  }

  // 1.2 validateQuarterlyDistributionTotal
  {
    assert(validateQuarterlyDistributionTotal(25, 25, 25, 25), "1.2.1. 25*4 is within tolerance");
    assert(validateQuarterlyDistributionTotal(24.99, 25.01, 25, 25), "1.2.2. Sum of 100 is within tolerance");
    assert(validateQuarterlyDistributionTotal(24.99, 25, 25, 25), "1.2.3. Sum of 99.99 is within tolerance");
    assert(!validateQuarterlyDistributionTotal(25, 25, 25, 24.98), "1.2.4. Sum of 99.98 is outside tolerance");
  }

  // 1.3 calculateAnnualTargetValue & snapshot helpers
  {
    const val1 = calculateAnnualTargetValue(1000, 15.55);
    assert(val1 === 15550, "1.3.1. Multiplication holds exactly");

    const val2 = calculateAnnualTargetValue(333, 10.33);
    assert(val2 === 3439.89, `1.3.2. Float rounding to 2 decimals holds: ${val2}`);

    const areaUnits = calculateAreaAnnualDecimalUnits(1000, 33.33);
    assert(areaUnits === 333.3, `1.3.3. Area annual decimal units matches: ${areaUnits}`);

    const quarterUnits = calculateQuarterAreaDecimalUnits(333.3, 25);
    assert(quarterUnits === 83.325, `1.3.4. Quarter decimal units matches: ${quarterUnits}`);

    const monthlyUnits = calculateMonthlyTargetDecimals(83.325);
    assert(Math.abs(monthlyUnits - 27.775) < 1e-9, `1.3.5. Monthly decimal units matches: ${monthlyUnits}`);
  }

  // ==========================================================
  // 2. DETERMINISTIC LARGEST-REMAINDER METHOD TESTS
  // ==========================================================
  console.log("\n>>> Running Deterministic Largest-Remainder Rounding Unit Tests...");

  // 2.1 Area Annual units reconciliation (alphabetic tie-breaking)
  {
    // 1000 units distributed among A=33.33%, B=33.33%, C=33.34%
    // A: 333.3 (Floor: 333, Rem: 0.3)
    // B: 333.3 (Floor: 333, Rem: 0.3)
    // C: 333.4 (Floor: 333, Rem: 0.4)
    // Sum of floors = 999. Remaining = 1.
    // Largest remainder is C (0.4). So C gets the remaining 1.
    // Result should be: A=333, B=333, C=334
    const potentials = [
      { areaId: "AREA_A", percentage: 33.33 },
      { areaId: "AREA_B", percentage: 33.33 },
      { areaId: "AREA_C", percentage: 33.34 }
    ];
    const reconciled = reconcileAreaAnnualUnits(1000, potentials);
    assert(reconciled["AREA_A"] === 333, "2.1.1. Area A gets 333 units");
    assert(reconciled["AREA_B"] === 333, "2.1.2. Area B gets 333 units");
    assert(reconciled["AREA_C"] === 334, "2.1.3. Area C gets 334 units");

    // Tie-breaking check:
    // 100 units, A=33.33%, B=33.33%, C=33.34% -> theoreticals: A=33.33, B=33.33, C=33.34
    // Floors: A=33, B=33, C=33. Sum of floors = 99. Remaining = 1.
    // Largest remainder is C (0.34), so C gets 34.
    // What if percentages are A=33.33%, B=33.33%, C=33.33% (Sum: 99.99%)?
    // Theoreticals: A=33.33, B=33.33, C=33.33
    // Floors: A=33, B=33, C=33. Sum of floors = 99. Remaining = 1.
    // Remainders: A=0.33, B=0.33, C=0.33. All equal!
    // Since we break ties alphabetically, "AREA_A" should get the remaining 1 unit.
    // Result should be: AREA_A=34, AREA_B=33, AREA_C=33.
    const equalPotentials = [
      { areaId: "AREA_C", percentage: 33.33 },
      { areaId: "AREA_B", percentage: 33.33 },
      { areaId: "AREA_A", percentage: 33.33 }
    ];
    const tiedReconciled = reconcileAreaAnnualUnits(100, equalPotentials);
    assert(tiedReconciled["AREA_A"] === 34, `2.1.4. Tied Area A gets priority (34 units): ${tiedReconciled["AREA_A"]}`);
    assert(tiedReconciled["AREA_B"] === 33, `2.1.5. Tied Area B gets floor (33 units)`);
    assert(tiedReconciled["AREA_C"] === 33, `2.1.6. Tied Area C gets floor (33 units)`);
  }

  // 2.2 Monthly distribution reconciliation (month index tie-breaking)
  {
    // Area total = 333 units. Equal quarterly split: Q1=25, Q2=25, Q3=25, Q4=25.
    // Theoretical monthly units = 333 * (25 / 300) = 27.75.
    // Floor = 27. Sum of floors = 324. Remaining = 9 units.
    // Remainders: all 12 months have 0.75.
    // We have 9 remaining units. First 9 months should get +1.
    // Months 1-9 should get 28 units. Months 10-12 should get 27.
    // Sum = 28 * 9 + 27 * 3 = 252 + 81 = 333 exactly.
    const monthly = reconcileMonthlyUnitsForArea(333, { q1: 25, q2: 25, q3: 25, q4: 25 });
    assert(monthly.length === 12, "2.2.1. Monthly array has exactly 12 elements");
    const sum = monthly.reduce((a, b) => a + b, 0);
    assert(sum === 333, `2.2.2. Reconciled sum equals total area units (333): ${sum}`);
    assert(monthly[0] === 28, `2.2.3. Month 1 gets 28 units: ${monthly[0]}`);
    assert(monthly[8] === 28, `2.2.4. Month 9 gets 28 units: ${monthly[8]}`);
    assert(monthly[9] === 27, `2.2.5. Month 10 gets 27 units: ${monthly[9]}`);
    assert(monthly[11] === 27, `2.2.6. Month 12 gets 27 units: ${monthly[11]}`);
  }

  // ==========================================================
  // 3. IDEMPOTENCY AND HASHING TESTS
  // ==========================================================
  console.log("\n>>> Running Idempotency and Hashing Tests...");
  {
    const inputs1 = {
      planId: "PTP::JO::2026::V1",
      productId: "PROD_A",
      areaId: "AREA_EAST",
      annualTargetUnits: 12000,
      unitPriceSnapshot: 15.0,
      potentialPercentage: 40.0,
      q1Percentage: 25.0,
      q2Percentage: 25.0,
      q3Percentage: 25.0,
      q4Percentage: 25.0
    };

    const hash1 = calculateInputHash(inputs1);
    const hash2 = calculateInputHash(inputs1);
    assert(hash1 === hash2, "3.1. Input hash is deterministic and identical for same inputs");

    const inputs2 = { ...inputs1, annualTargetUnits: 12001 };
    const hash3 = calculateInputHash(inputs2);
    assert(hash1 !== hash3, "3.2. Different inputs yield distinct hashes");
  }

  // ==========================================================
  // 4. INTEGRATION PERSISTENCE ORCHESTRATION TESTS (MOCK DB)
  // ==========================================================
  console.log("\n>>> Running Database Integration & Orchestration Pipeline Tests (In-Memory)...");

  // High-fidelity in-memory Mock Firestore implementation
  class MockDoc {
    constructor(public exists: boolean, private docData: any, public ref: any) {}
    data() {
      return this.docData;
    }
  }

  class MockCollection {
    constructor(private name: string, private store: Map<string, any>) {}

    doc(id: string) {
      const key = `${this.name}/${id}`;
      const ref = {
        delete: async () => {
          this.store.delete(key);
        }
      };
      return {
        exists: this.store.has(key),
        get: async () => {
          const data = this.store.get(key);
          return new MockDoc(this.store.has(key), data, ref);
        },
        set: async (data: any) => {
          this.store.set(key, JSON.parse(JSON.stringify(data)));
        },
        update: async (data: any) => {
          const existing = this.store.get(key) || {};
          this.store.set(key, { ...existing, ...JSON.parse(JSON.stringify(data)) });
        },
        delete: async () => {
          this.store.delete(key);
        },
        ref
      };
    }

    where(field: string, op: string, val: any) {
      const filters: { field: string; val: any }[] = [{ field, val }];
      const chain = {
        where: (nextField: string, nextOp: string, nextVal: any) => {
          filters.push({ field: nextField, val: nextVal });
          return chain;
        },
        get: async () => {
          const docs: any[] = [];
          for (const [key, docVal] of this.store.entries()) {
            if (key.startsWith(`${this.name}/`)) {
              let matches = true;
              for (const filter of filters) {
                if (docVal[filter.field] !== filter.val) {
                  matches = false;
                  break;
                }
              }
              if (matches) {
                docs.push({
                  exists: true,
                  ref: {
                    delete: async () => {
                      this.store.delete(key);
                    }
                  },
                  data: () => docVal
                });
              }
            }
          }
          return {
            docs,
            empty: docs.length === 0
          };
        }
      };
      return chain;
    }
  }

  class MockDb {
    public store = new Map<string, any>();
    collection(name: string) {
      return new MockCollection(name, this.store);
    }
    batch() {
      const ops: (() => Promise<void>)[] = [];
      return {
        set: (docRef: any, data: any) => {
          ops.push(async () => {
            await docRef.set(data);
          });
        },
        delete: (docRef: any) => {
          ops.push(async () => {
            await docRef.delete();
          });
        },
        commit: async () => {
          for (const op of ops) {
            await op();
          }
        }
      };
    }
  }

  const db = new MockDb();

  // We will build a temporary, completely isolated test Product Target Plan structure.
  const randSuffix = Math.floor(1000 + Math.random() * 9000);
  const testPlanId = `PTP::TEST::2026::V${randSuffix}`;
  const testProductId = `PROD::CALC_TEST::${randSuffix}`;
  const testAreaId1 = "AREA_AMMAN_W";
  const testAreaId2 = "AREA_AMMAN_E";

  const testPlanDoc = {
    planId: testPlanId,
    countryId: "TEST",
    year: 2026,
    currencyCode: "USD",
    monthlyDistributionMethod: "EQUAL_WITHIN_QUARTER",
    status: TargetStatus.DRAFT,
    version: 1,
    active: true,
    createdAt: new Date().toISOString(),
    createdBy: "TEST_RUNNER"
  };

  const testAnnualTargetId = createProductAnnualTargetId(testPlanId, testProductId);
  const testAnnualTargetDoc = {
    targetId: testAnnualTargetId,
    planId: testPlanId,
    countryId: "TEST",
    productId: testProductId,
    year: 2026,
    annualTargetUnits: 1000,
    unitPriceSnapshot: 12.5,
    currencyCode: "USD",
    status: TargetStatus.DRAFT,
    version: 1,
    active: true,
    productSkuSnapshot: "SKU-TEST-123",
    productNameSnapshot: "Calculated Test Product",
    createdAt: new Date().toISOString(),
    createdBy: "TEST_RUNNER"
  };

  const testPotentialId1 = createProductAreaPotentialId(testAnnualTargetId, testAreaId1);
  const testPotentialDoc1 = {
    areaPotentialId: testPotentialId1,
    planId: testPlanId,
    annualTargetId: testAnnualTargetId,
    countryId: "TEST",
    productId: testProductId,
    year: 2026,
    areaId: testAreaId1,
    potentialPercentage: 40.0, // 40%
    status: TargetStatus.DRAFT,
    version: 1,
    active: true,
    areaCodeSnapshot: "AMMAN_W",
    areaNameSnapshot: "Amman West",
    createdAt: new Date().toISOString(),
    createdBy: "TEST_RUNNER"
  };

  const testPotentialId2 = createProductAreaPotentialId(testAnnualTargetId, testAreaId2);
  const testPotentialDoc2 = {
    areaPotentialId: testPotentialId2,
    planId: testPlanId,
    annualTargetId: testAnnualTargetId,
    countryId: "TEST",
    productId: testProductId,
    year: 2026,
    areaId: testAreaId2,
    potentialPercentage: 60.0, // 60%
    status: TargetStatus.DRAFT,
    version: 1,
    active: true,
    areaCodeSnapshot: "AMMAN_E",
    areaNameSnapshot: "Amman East",
    createdAt: new Date().toISOString(),
    createdBy: "TEST_RUNNER"
  };

  const testDistributionId = createProductQuarterlyDistributionId(testAnnualTargetId);
  const testDistributionDoc = {
    quarterlyDistributionId: testDistributionId,
    planId: testPlanId,
    annualTargetId: testAnnualTargetId,
    countryId: "TEST",
    productId: testProductId,
    year: 2026,
    q1Percentage: 25.0,
    q2Percentage: 25.0,
    q3Percentage: 25.0,
    q4Percentage: 25.0,
    status: TargetStatus.DRAFT,
    version: 1,
    active: true,
    createdAt: new Date().toISOString(),
    createdBy: "TEST_RUNNER"
  };

  try {
    console.log(`Writing test fixtures for plan: ${testPlanId}...`);
    // Seed fixtures to Mock DB
    await db.collection("productTargetPlans").doc(testPlanId).set(testPlanDoc);
    await db.collection("productAnnualTargets").doc(testAnnualTargetId).set(testAnnualTargetDoc);
    await db.collection("productAreaPotentials").doc(testPotentialId1).set(testPotentialDoc1);
    await db.collection("productAreaPotentials").doc(testPotentialId2).set(testPotentialDoc2);
    await db.collection("productQuarterlyDistributions").doc(testDistributionId).set(testDistributionDoc);

    console.log("Fixtures seeded. Running target calculation orchestrator...");
    const runResult = await runTargetCalculation(testPlanId, "TEST_RUNNER", db);

    // Assert calculation run summary
    assert(runResult.status === "COMPLETE", `4.1. Calculation run completed with status: ${runResult.status}`);
    assert(runResult.productsRequested === 1, `4.2. Products requested was 1: ${runResult.productsRequested}`);
    assert(runResult.productsSucceeded === 1, `4.3. Products succeeded was 1: ${runResult.productsSucceeded}`);
    assert(runResult.productsFailed === 0, "4.4. Products failed was 0");
    assert(runResult.targetsCreated === 24, `4.5. 24 targets created (12 months * 2 areas): ${runResult.targetsCreated}`);
    assert(runResult.targetsUpdated === 0, "4.6. First run updates are 0");

    // Fetch and verify calculated targets
    console.log("Verifying calculated targets from Mock DB...");
    const targetsSnap = await db.collection("calculatedProductTargets")
      .where("planId", "==", testPlanId)
      .where("active", "==", true)
      .get();

    assert(targetsSnap.docs.length === 24, `4.7. Found exactly 24 active calculated targets: ${targetsSnap.docs.length}`);

    let totalUnitsSum = 0;
    let totalValueSum = 0;
    let area1UnitsSum = 0;
    let area2UnitsSum = 0;

    for (const doc of targetsSnap.docs) {
      const data = doc.data();
      totalUnitsSum += data.targetUnits;
      totalValueSum += data.targetValue;
      if (data.areaId === testAreaId1) area1UnitsSum += data.targetUnits;
      if (data.areaId === testAreaId2) area2UnitsSum += data.targetUnits;

      // Verify snapshots
      assert(data.productNameSnapshot === "Calculated Test Product", "4.8. Product name snapshot matches");
      assert(data.unitPriceSnapshot === 12.5, "4.9. Unit price snapshot matches");
    }

    assert(totalUnitsSum === 1000, `4.10. Total sum of monthly units across all areas is exactly equal to annualTargetUnits (1000): ${totalUnitsSum}`);
    assert(area1UnitsSum === 400, `4.11. Area 1 total sum is exactly 40% of 1000 (400): ${area1UnitsSum}`);
    assert(area2UnitsSum === 600, `4.12. Area 2 total sum is exactly 60% of 1000 (600): ${area2UnitsSum}`);
    assert(totalValueSum === 12500, `4.13. Total calculated value matches expected annual target value ($12,500): $${totalValueSum}`);

    // ==========================================================
    // 5. IDEMPOTENCY PERSISTENCE CHECKS
    // ==========================================================
    console.log("\n>>> Running Idempotency Persistence Checks (Rerun identical pipeline)...");
    const rerunResult = await runTargetCalculation(testPlanId, "TEST_RUNNER", db);

    assert(rerunResult.status === "COMPLETE", "5.1. Rerun completed successfully");
    assert(rerunResult.targetsCreated === 0, `5.2. Zero targets created during idempotent rerun: ${rerunResult.targetsCreated}`);
    assert(rerunResult.targetsUpdated === 0, `5.3. Zero targets updated during idempotent rerun: ${rerunResult.targetsUpdated}`);

    // Clean up test documents to leave the database perfectly clean
    console.log("\n>>> Cleaning up all seeded test documents...");
    await db.collection("productTargetPlans").doc(testPlanId).delete();
    await db.collection("productAnnualTargets").doc(testAnnualTargetId).delete();
    await db.collection("productAreaPotentials").doc(testPotentialId1).delete();
    await db.collection("productAreaPotentials").doc(testPotentialId2).delete();
    await db.collection("productQuarterlyDistributions").doc(testDistributionId).delete();
    
    // Clean up calculated targets
    const batch = db.batch();
    for (const doc of targetsSnap.docs) {
      batch.delete(doc.ref);
    }
    await batch.commit();

    // Clean up calculation run documents
    const runDocId1 = createTargetCalculationRunId(testPlanId, runResult.runId);
    const runDocId2 = createTargetCalculationRunId(testPlanId, rerunResult.runId);
    await db.collection("targetCalculationRuns").doc(runDocId1).delete();
    await db.collection("targetCalculationRuns").doc(runDocId2).delete();

    console.log("Seeded test files successfully cleaned up.");

  } catch (err: any) {
    assert(false, "Database Integration Pipeline Exception Thrown", err.message);
  }

  console.log("\n=================================================================");
  console.log(`TEST RUN COMPLETED. ASSERTIONS RUN: ${totalAssertions}`);
  if (failedTestsCount === 0) {
    console.log("ALL TESTS COMPLETED SUCCESSFULLY! [PASS]");
  } else {
    console.error(`SOME TESTS FAILED. FAILED COUNT: ${failedTestsCount} [FAIL]`);
    process.exit(1);
  }
  console.log("=================================================================");
}

runTests();
