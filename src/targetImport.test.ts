import { validateImportBatch, commitImportBatch, rollbackImportBatch } from "./lib/targetImportService";
import { 
  createProductTargetPlanId, 
  createProductAnnualTargetId, 
  createProductAreaPotentialId, 
  createProductQuarterlyDistributionId 
} from "./lib/productTargetIdService";
import { TargetStatus } from "./types";
import { mapImportedRowToSchema } from "./lib/schemaEngine";

// ==========================================================
// MOCK FIRESTORE DB IMPLEMENTATION
// ==========================================================

class MockDocRef {
  constructor(private collection: MockCollection, private id: string) {}

  get() {
    const exists = this.collection.docs[this.id] !== undefined;
    const dataVal = this.collection.docs[this.id];
    return Promise.resolve({
      exists,
      id: this.id,
      data: () => dataVal
    });
  }

  set(data: any) {
    this.collection.docs[this.id] = JSON.parse(JSON.stringify(data));
    return Promise.resolve();
  }

  update(data: any) {
    if (!this.collection.docs[this.id]) {
      this.collection.docs[this.id] = {};
    }
    this.collection.docs[this.id] = {
      ...this.collection.docs[this.id],
      ...JSON.parse(JSON.stringify(data))
    };
    return Promise.resolve();
  }

  delete() {
    delete this.collection.docs[this.id];
    return Promise.resolve();
  }
}

class MockCollection {
  public docs: Record<string, any> = {};
  constructor(public name: string) {}

  doc(id: string) {
    return new MockDocRef(this, id);
  }

  get() {
    const docList = Object.entries(this.docs).map(([id, data]) => ({
      id,
      data: () => data
    }));
    return Promise.resolve({
      forEach: (cb: any) => docList.forEach(cb),
      size: docList.length,
      docs: docList
    });
  }
}

class MockDb {
  public collections: Record<string, MockCollection> = {};

  collection(name: string) {
    if (!this.collections[name]) {
      this.collections[name] = new MockCollection(name);
    }
    return this.collections[name];
  }

  batch() {
    const ops: any[] = [];
    return {
      set: (ref: any, data: any) => {
        ops.push({ action: "set", ref, data });
      },
      delete: (ref: any) => {
        ops.push({ action: "delete", ref });
      },
      commit: async () => {
        for (const op of ops) {
          if (op.action === "set") {
            await op.ref.set(op.data);
          } else if (op.action === "delete") {
            await op.ref.delete();
          }
        }
        return Promise.resolve();
      }
    };
  }
}

// ==========================================================
// TEST RUNNER INFRASTRUCTURE
// ==========================================================

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

async function runAllTests() {
  console.log("=================================================================");
  console.log("MENAREPS 2.0 WP4.1E - TARGET IMPORT TEMPLATE & ENGINE TESTS");
  console.log("=================================================================\n");

  const db = new MockDb();

  // Pre-seed catalog databases
  // 1. Seed Products
  const productsCol = db.collection("products");
  await productsCol.doc("PROD_TACRUS").set({ id: "PROD_TACRUS", sku: "SKU-TACRUS-101", name: "Tacrus Ointment" });
  await productsCol.doc("PROD_MOSTAL").set({ id: "PROD_MOSTAL", sku: "SKU-MOSTAL-002", name: "Mostal Kit" });

  // 2. Seed Areas
  const areasCol = db.collection("areas");
  await areasCol.doc("AREA_AMMAN_W").set({ id: "AREA_AMMAN_W", code: "AM-WEST-01", name: "Amman West" });
  await areasCol.doc("AREA_TRIPOLI").set({ id: "AREA_TRIPOLI", code: "TRIP-CENT-02", name: "Tripoli Centre" });

  // ==========================================================
  // SCENARIO 1: SHEETS MAPPING & ROW PARSING SCHEMA TESTS
  // ==========================================================
  console.log(">>> Running Scenario 1: Sheets Mapping & Row Parsing Schema Tests...");
  {
    // 1.1 Annual Product Target row mapping
    const rawAnnualRow = {
      "Product (ID or SKU)": "SKU-TACRUS-101",
      "Year": "2026",
      "Annual Target Units": "1500"
    };
    const mappedAnnual = mapImportedRowToSchema(rawAnnualRow, "annualproducttarget");
    assert(mappedAnnual.product === "SKU-TACRUS-101", "1.1.1. Product maps correctly");
    assert(mappedAnnual.year === 2026, "1.1.2. Year converts to number");
    assert(mappedAnnual.annualTargetUnits === 1500, "1.1.3. AnnualTargetUnits converts to number");

    // 1.2 Area Distribution row mapping
    const rawAreaRow = {
      "Product (ID or SKU)": "PROD_MOSTAL",
      "Area (ID or Code)": "AM-WEST-01",
      "Year": "2026",
      "Potential Percentage": "45.5"
    };
    const mappedArea = mapImportedRowToSchema(rawAreaRow, "productareadistribution");
    assert(mappedArea.product === "PROD_MOSTAL", "1.2.1. Product maps correctly");
    assert(mappedArea.area === "AM-WEST-01", "1.2.2. Area maps correctly");
    assert(mappedArea.year === 2026, "1.2.3. Year converts to number");
    assert(mappedArea.potentialPercentage === 45.5, "1.2.4. PotentialPercentage converts to number");

    // 1.3 Quarterly Distribution row mapping
    const rawQtrRow = {
      "Product (ID or SKU)": "SKU-TACRUS-101",
      "Year": "2026",
      "Q1 Percentage": "20",
      "Q2 Percentage": "30",
      "Q3 Percentage": "25",
      "Q4 Percentage": "25"
    };
    const mappedQtr = mapImportedRowToSchema(rawQtrRow, "productquarterlydistribution");
    assert(mappedQtr.product === "SKU-TACRUS-101", "1.3.1. Product maps correctly");
    assert(mappedQtr.year === 2026, "1.3.2. Year converts to number");
    assert(mappedQtr.q1Percentage === 20, "1.3.3. Q1 maps correctly");
    assert(mappedQtr.q2Percentage === 30, "1.3.4. Q2 maps correctly");
    assert(mappedQtr.q3Percentage === 25, "1.3.5. Q3 maps correctly");
    assert(mappedQtr.q4Percentage === 25, "1.3.6. Q4 maps correctly");
  }

  // ==========================================================
  // SCENARIO 2: CANONICAL LOOKUPS & ROW-LEVEL BOUNDS VALIDATIONS
  // ==========================================================
  console.log("\n>>> Running Scenario 2: Canonical Lookups & Row-Level Bounds Validations...");
  {
    // 2.1 Valid Annual Product Target Upload
    const validAnnualRows = [
      { "Product (ID or SKU)": "PROD_TACRUS", "Year": "2026", "Annual Target Units": "12000" }, // matches by ID
      { "Product (ID or SKU)": "SKU-MOSTAL-002", "Year": "2026", "Annual Target Units": "8500" }  // matches by SKU
    ];

    const result = await validateImportBatch(db, {
      templateType: "annualproducttarget",
      rows: validAnnualRows,
      fileName: "annual_targets.xlsx",
      countryId: "JO",
      year: 2026,
      importedBy: "admin@menareps.com"
    });

    assert(result.status === "PREVIEW_READY", "2.1.1. Status is PREVIEW_READY for valid rows");
    assert(result.totalRecords === 2, "2.1.2. Total records matches");
    assert(result.validRecordsCount === 2, "2.1.3. Valid count is 2");
    assert(result.errorRecordsCount === 0, "2.1.4. Error count is 0");
    assert(result.records[0].resolvedProductId === "PROD_TACRUS", "2.1.5. Canonical Product ID resolved via ID match");
    assert(result.records[1].resolvedProductId === "PROD_MOSTAL", "2.1.6. Canonical Product ID resolved via SKU match");

    // 2.2 Unresolved references & negative bounds checks
    const badAnnualRows = [
      { "Product (ID or SKU)": "NON-EXISTENT-PROD", "Year": "2026", "Annual Target Units": "100" }, // unresolved product
      { "Product (ID or SKU)": "PROD_TACRUS", "Year": "2026", "Annual Target Units": "-500" },      // negative units
      { "Product (ID or SKU)": "", "Year": "2026", "Annual Target Units": "2000" }                 // missing product
    ];

    const badResult = await validateImportBatch(db, {
      templateType: "annualproducttarget",
      rows: badAnnualRows,
      fileName: "bad_annual_targets.xlsx",
      countryId: "JO",
      year: 2026,
      importedBy: "admin@menareps.com"
    });

    assert(badResult.status === "FAILED", "2.2.1. Status is FAILED for bad rows");
    assert(badResult.validRecordsCount === 0, "2.2.2. Valid count is 0");
    assert(badResult.errorRecordsCount === 3, "2.2.3. Error count is 3");
    
    // Row 1 checks
    const r1 = badResult.records[0];
    assert(!r1.valid, "2.2.4. Row 1 is invalid");
    assert(r1.errors.some(e => e.code === "UNRESOLVED_PRODUCT"), "2.2.5. Row 1 has UNRESOLVED_PRODUCT error");

    // Row 2 checks
    const r2 = badResult.records[1];
    assert(!r2.valid, "2.2.6. Row 2 is invalid");
    assert(r2.errors.some(e => e.code === "INVALID_UNITS_RANGE"), "2.2.7. Row 2 has INVALID_UNITS_RANGE error");

    // Row 3 checks
    const r3 = badResult.records[2];
    assert(!r3.valid, "2.2.8. Row 3 is invalid");
    assert(r3.errors.some(e => e.code === "MISSING_PRODUCT"), "2.2.9. Row 3 has MISSING_PRODUCT error");
  }

  // ==========================================================
  // SCENARIO 3: GROUP-LEVEL VALIDATIONS (POTENTIAL SUMS & QTR SUMS)
  // ==========================================================
  console.log("\n>>> Running Scenario 3: Group-Level Validations...");
  {
    // 3.1 Valid Area Potential Sum (exactly 100%)
    const validAreaRows = [
      { "Product (ID or SKU)": "PROD_TACRUS", "Area (ID or Code)": "AREA_AMMAN_W", "Year": "2026", "Potential Percentage": "40.0" },
      { "Product (ID or SKU)": "PROD_TACRUS", "Area (ID or Code)": "AREA_TRIPOLI", "Year": "2026", "Potential Percentage": "60.0" }
    ];

    const result = await validateImportBatch(db, {
      templateType: "productareadistribution",
      rows: validAreaRows,
      fileName: "area_distribution.xlsx",
      countryId: "JO",
      year: 2026,
      importedBy: "admin@menareps.com"
    });

    assert(result.status === "PREVIEW_READY", "3.1.1. Valid potential sums of 100% are accepted");
    assert(result.validRecordsCount === 2, "3.1.2. Both area records are valid");

    // 3.2 Invalid Area Potential Sum (not 100%)
    const badAreaRows = [
      { "Product (ID or SKU)": "PROD_TACRUS", "Area (ID or Code)": "AREA_AMMAN_W", "Year": "2026", "Potential Percentage": "40.0" },
      { "Product (ID or SKU)": "PROD_TACRUS", "Area (ID or Code)": "AREA_TRIPOLI", "Year": "2026", "Potential Percentage": "55.5" } // Sums to 95.5%
    ];

    const badResult = await validateImportBatch(db, {
      templateType: "productareadistribution",
      rows: badAreaRows,
      fileName: "bad_area_distribution.xlsx",
      countryId: "JO",
      year: 2026,
      importedBy: "admin@menareps.com"
    });

    assert(badResult.status === "FAILED", "3.2.1. Invalid potential sums (95.5%) are rejected");
    assert(badResult.validRecordsCount === 0, "3.2.2. All group records marked invalid on sum failure");
    assert(badResult.records[0].errors.some(e => e.code === "GROUP_TOTAL_MISMATCH"), "3.2.3. Group mismatch error appended to Row 1");
    assert(badResult.records[1].errors.some(e => e.code === "GROUP_TOTAL_MISMATCH"), "3.2.4. Group mismatch error appended to Row 2");

    // 3.3 Valid Quarterly Distribution Sum (exactly 100%)
    const validQtrRows = [
      { "Product (ID or SKU)": "PROD_TACRUS", "Year": "2026", "Q1 Percentage": "25.0", "Q2 Percentage": "25.0", "Q3 Percentage": "25.0", "Q4 Percentage": "25.0" }
    ];

    const qResult = await validateImportBatch(db, {
      templateType: "productquarterlydistribution",
      rows: validQtrRows,
      fileName: "qtr.xlsx",
      countryId: "JO",
      year: 2026,
      importedBy: "admin@menareps.com"
    });
    assert(qResult.status === "PREVIEW_READY", "3.3.1. Valid quarterly sum is PREVIEW_READY");

    // 3.4 Invalid Quarterly Distribution Sum (not 100%)
    const badQtrRows = [
      { "Product (ID or SKU)": "PROD_TACRUS", "Year": "2026", "Q1 Percentage": "20.0", "Q2 Percentage": "30.0", "Q3 Percentage": "20.0", "Q4 Percentage": "20.0" } // Sums to 90%
    ];

    const badQResult = await validateImportBatch(db, {
      templateType: "productquarterlydistribution",
      rows: badQtrRows,
      fileName: "bad_qtr.xlsx",
      countryId: "JO",
      year: 2026,
      importedBy: "admin@menareps.com"
    });
    assert(badQResult.status === "FAILED", "3.4.1. Invalid quarterly sum is FAILED");
    assert(badQResult.records[0].errors.some(e => e.code === "QUARTERLY_TOTAL_MISMATCH"), "3.4.2. Quarterly sum mismatch caught");
  }

  // ==========================================================
  // SCENARIO 4: STAGED IMPORT HISTORY LIFECYCLE
  // ==========================================================
  console.log("\n>>> Running Scenario 4: Staged Import History Lifecycle...");
  {
    const rows = [
      { "Product (ID or SKU)": "PROD_TACRUS", "Year": "2026", "Annual Target Units": "1000" }
    ];

    const batch = await validateImportBatch(db, {
      templateType: "annualproducttarget",
      rows,
      fileName: "lifecycle_test.xlsx",
      countryId: "JO",
      year: 2026,
      importedBy: "manager@menareps.com"
    });

    const stagedDoc = await db.collection("targetImports").doc(batch.importId).get();
    assert(stagedDoc.exists, "4.1. History staging document created in firestore");
    const docData = stagedDoc.data();
    assert(docData.status === "PREVIEW_READY", "4.2. Staging document initial state is PREVIEW_READY");
    assert(docData.fileName === "lifecycle_test.xlsx", "4.3. FileName metadata saved correctly");
    assert(docData.countryId === "JO", "4.4. CountryId metadata saved correctly");
    assert(docData.importedBy === "manager@menareps.com", "4.5. ImportedBy metadata saved correctly");
  }

  // ==========================================================
  // SCENARIO 5: TRANSACTIONAL COMMIT OPERATIONS
  // ==========================================================
  console.log("\n>>> Running Scenario 5: Transactional Commit Operations...");
  {
    // Clean collections first
    db.collection("productAnnualTargets").docs = {};
    db.collection("productTargetPlans").docs = {};

    const rows = [
      { "Product (ID or SKU)": "PROD_TACRUS", "Year": "2026", "Annual Target Units": "15000" },
      { "Product (ID or SKU)": "PROD_MOSTAL", "Year": "2026", "Annual Target Units": "7500" }
    ];

    const batch = await validateImportBatch(db, {
      templateType: "annualproducttarget",
      rows,
      fileName: "commit_test.xlsx",
      countryId: "JO",
      year: 2026,
      importedBy: "manager@menareps.com"
    });

    assert(batch.status === "PREVIEW_READY", "5.1. Import batch set to PREVIEW_READY");

    const commitResult = await commitImportBatch(db, batch.importId, "manager@menareps.com");
    assert(commitResult.success, "5.2. Committing batch completes successfully");
    assert(commitResult.status === "COMPLETE", "5.3. Return status is COMPLETE");
    assert(commitResult.committedCount === 2, "5.4. Committed count matches valid count");

    // Check plan was auto-created
    const planId = createProductTargetPlanId("JO", 2026, 1);
    const planSnap = await db.collection("productTargetPlans").doc(planId).get();
    assert(planSnap.exists, "5.5. Product Target Plan was automatically created");
    assert(planSnap.data().status === TargetStatus.DRAFT, "5.6. Plan status initialized to DRAFT");

    // Check targets were created
    const t1Id = createProductAnnualTargetId(planId, "PROD_TACRUS");
    const t2Id = createProductAnnualTargetId(planId, "PROD_MOSTAL");

    const t1Snap = await db.collection("productAnnualTargets").doc(t1Id).get();
    const t2Snap = await db.collection("productAnnualTargets").doc(t2Id).get();

    assert(t1Snap.exists, "5.7. Target 1 created with deterministic ID");
    assert(t1Snap.data().annualTargetUnits === 15000, "5.8. Target 1 units set correctly");
    assert(t1Snap.data().productId === "PROD_TACRUS", "5.9. Target 1 productId set correctly");

    assert(t2Snap.exists, "5.10. Target 2 created with deterministic ID");
    assert(t2Snap.data().annualTargetUnits === 7500, "5.11. Target 2 units set correctly");

    // Check metadata backup for rollbacks
    const updatedImportSnap = await db.collection("targetImports").doc(batch.importId).get();
    const updatedBatch = updatedImportSnap.data();
    assert(updatedBatch.status === "COMPLETE", "5.12. Target import document status updated to COMPLETE");
    assert(updatedBatch.createdTargetIds.includes(t1Id), "5.13. CreatedTargetIds list tracked for clean rollbacks");
    assert(updatedBatch.createdTargetIds.includes(t2Id), "5.14. CreatedTargetIds list includes both targets");
  }

  // ==========================================================
  // SCENARIO 6: RESILIENT ROLLBACK OPERATIONS
  // ==========================================================
  console.log("\n>>> Running Scenario 6: Resilient Rollback Operations...");
  {
    // Clean collections and seed with a pre-existing target to test snapshot restoration
    db.collection("productAnnualTargets").docs = {};
    db.collection("productTargetPlans").docs = {};

    const planId = createProductTargetPlanId("JO", 2026, 1);
    const preExistingTargetId = createProductAnnualTargetId(planId, "PROD_TACRUS");
    
    // Seed pre-existing Tacrus target with original units = 5000
    await db.collection("productAnnualTargets").doc(preExistingTargetId).set({
      targetId: preExistingTargetId,
      planId,
      countryId: "JO",
      productId: "PROD_TACRUS",
      year: 2026,
      annualTargetUnits: 5000,
      currencyCode: "USD",
      status: TargetStatus.DRAFT,
      version: 1,
      active: true,
      createdAt: "original_time",
      createdBy: "original_user"
    });

    // Upload an import sheet that overwrites Tacrus target (units = 25000) and creates a new Mostal target (units = 9000)
    const rows = [
      { "Product (ID or SKU)": "PROD_TACRUS", "Year": "2026", "Annual Target Units": "25000" }, // overwrites
      { "Product (ID or SKU)": "PROD_MOSTAL", "Year": "2026", "Annual Target Units": "9000" }   // newly created
    ];

    const batch = await validateImportBatch(db, {
      templateType: "annualproducttarget",
      rows,
      fileName: "rollback_test.xlsx",
      countryId: "JO",
      year: 2026,
      importedBy: "manager@menareps.com"
    });

    const commitResult = await commitImportBatch(db, batch.importId, "manager@menareps.com");
    assert(commitResult.success, "6.1. Import batch committed successfully");

    // Double check state before rollback
    const t1SnapBefore = await db.collection("productAnnualTargets").doc(preExistingTargetId).get();
    const t2SnapBefore = await db.collection("productAnnualTargets").doc(createProductAnnualTargetId(planId, "PROD_MOSTAL")).get();
    assert(t1SnapBefore.data().annualTargetUnits === 25000, "6.2. Overwritten Tacrus target currently has updated units (25000)");
    assert(t2SnapBefore.exists, "6.3. Newly created Mostal target exists in database");

    // Perform rollback
    const rollbackResult = await rollbackImportBatch(db, batch.importId);
    assert(rollbackResult.success, "6.4. Rollback completes successfully");
    assert(rollbackResult.status === "ROLLED_BACK", "6.5. Return status is ROLLED_BACK");

    // Verify database state is restored 100%
    const t1SnapAfter = await db.collection("productAnnualTargets").doc(preExistingTargetId).get();
    const t2SnapAfter = await db.collection("productAnnualTargets").doc(createProductAnnualTargetId(planId, "PROD_MOSTAL")).get();

    assert(t1SnapAfter.exists, "6.6. Original Tacrus target was preserved (exists)");
    assert(t1SnapAfter.data().annualTargetUnits === 5000, "6.7. Original Tacrus target units restored to 5000");
    assert(t1SnapAfter.data().createdAt === "original_time", "6.8. Original created timestamp restored");
    assert(!t2SnapAfter.exists, "6.9. Newly created Mostal target was successfully deleted/rolled back");

    // Verify import record status
    const batchSnapAfter = await db.collection("targetImports").doc(batch.importId).get();
    assert(batchSnapAfter.data().status === "ROLLED_BACK", "6.10. Staged import record status updated to ROLLED_BACK");
  }

  console.log("\n=================================================================");
  console.log(`TEST SUITE COMPLETE. TOTAL ASSERTIONS: ${totalAssertions}`);
  if (failedTestsCount === 0) {
    console.log("SUCCESS: All tests passed with flying colors!");
  } else {
    console.error(`FAILURE: ${failedTestsCount} assertions failed.`);
    process.exit(1);
  }
}

runAllTests().catch(err => {
  console.error("Test runner crashed with error:", err);
  process.exit(1);
});
