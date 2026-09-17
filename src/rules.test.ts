import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, writeBatch, collection, query, where, getDocs } from "firebase/firestore";
import * as fs from "fs";

async function runRulesTests() {
  console.log("=====================================================================");
  console.log("STARTING REAL FIRESTORE RULES EMULATOR TESTS");
  console.log("=====================================================================");
  
  let testEnv;
  try {
    testEnv = await initializeTestEnvironment({
      projectId: "menareps-crm-production-5046c",
      firestore: {
        rules: fs.readFileSync("firestore.rules", "utf8"),
        host: "127.0.0.1",
        port: 8089
      }
    });
  } catch (err: any) {
    console.error("Failed to initialize test environment:", err);
    process.exit(1);
  }

  // Clear Firestore emulator data
  await testEnv.clearFirestore();

  let failedCount = 0;
  let testNum = 1;

  function assertTest(condition: boolean, description: string) {
    if (condition) {
      console.log(`[PASS] Rules Test ${testNum++}: ${description}`);
    } else {
      console.error(`[FAIL] Rules Test ${testNum++}: ${description}`);
      failedCount++;
    }
  }

  // Seed baseline data with security rules disabled
  console.log("Seeding baseline users and products catalog...");
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    
    // Admin user (matches shwayat.mustafa@gmail.com for Admin check)
    await setDoc(doc(db, "users/admin1"), {
      id: "admin1",
      name: "Admin User",
      email: "shwayat.mustafa@gmail.com",
      role: "Admin"
    });

    // Subordinate reporting hierarchy: rep1 -> sup1 -> mgr1
    await setDoc(doc(db, "users/rep1"), {
      id: "rep1",
      name: "Representative One",
      email: "rep1@example.com",
      role: "Medical Representative",
      managerId: "sup1",
      country: "Libya",
      areaIds: ["area123"]
    });

    await setDoc(doc(db, "users/sup1"), {
      id: "sup1",
      name: "Supervisor One",
      email: "sup1@example.com",
      role: "Medical Supervisor",
      managerId: "mgr1"
    });

    await setDoc(doc(db, "users/mgr1"), {
      id: "mgr1",
      name: "Manager One",
      email: "mgr1@example.com",
      role: "Regional Manager",
      managerId: ""
    });

    // Unrelated rep2
    await setDoc(doc(db, "users/rep2"), {
      id: "rep2",
      name: "Representative Two",
      email: "rep2@example.com",
      role: "Medical Representative",
      managerId: "sup2"
    });

    // Inactive manager
    await setDoc(doc(db, "users/inactive_mgr1"), {
      id: "inactive_mgr1",
      name: "Inactive Manager",
      email: "inactive_mgr1@example.com",
      role: "Country Manager",
      active: false,
      country: "Libya"
    });

    // NEW WP4.1H.4 TARGET PERSONAS
    await setDoc(doc(db, "users/sales_rep1"), {
      id: "sales_rep1",
      name: "Sales Rep 1",
      email: "salesrep1@example.com",
      role: "Sales Representative",
      active: true,
      country: "Libya",
      areaIds: ["area123"]
    });

    await setDoc(doc(db, "users/med_rep1"), {
      id: "med_rep1",
      name: "Med Rep 1",
      email: "medrep1@example.com",
      role: "Medical Representative",
      active: true,
      country: "Libya",
      areaIds: ["area123"]
    });

    await setDoc(doc(db, "users/sales_mgr1"), {
      id: "sales_mgr1",
      name: "Sales Manager 1",
      email: "salesmgr1@example.com",
      role: "Sales Manager",
      active: true,
      country: "Libya"
    });

    await setDoc(doc(db, "users/country_mgr1"), {
      id: "country_mgr1",
      name: "Country Manager 1",
      email: "countrymgr1@example.com",
      role: "Country Manager",
      active: true,
      country: "Libya"
    });

    await setDoc(doc(db, "users/super_admin1"), {
      id: "super_admin1",
      name: "Super Admin 1",
      email: "superadmin1@example.com",
      role: "Super Admin",
      active: true
    });

    // Products
    await setDoc(doc(db, "products/prod306"), {
      id: "prod306",
      name: "Acne Product 25G",
      brand: "acne",
      promotionGroupId: "acne",
      therapeuticArea: "Dermatology",
      isActive: true,
      sku: "ACNE-25G"
    });

    await setDoc(doc(db, "products/prod307"), {
      id: "prod307",
      name: "Inactive Gel",
      brand: "generic",
      promotionGroupId: "generic",
      therapeuticArea: "General Medicine",
      isActive: false,
      sku: "GEN-GEL"
    });
  });

  // Authenticated Contexts
  const rep1Context = testEnv.authenticatedContext("rep1", { email: "rep1@example.com" });
  const rep1Db = rep1Context.firestore();

  const rep2Context = testEnv.authenticatedContext("rep2", { email: "rep2@example.com" });
  const rep2Db = rep2Context.firestore();

  const sup1Context = testEnv.authenticatedContext("sup1", { email: "sup1@example.com" });
  const sup1Db = sup1Context.firestore();

  const mgr1Context = testEnv.authenticatedContext("mgr1", { email: "mgr1@example.com" });
  const mgr1Db = mgr1Context.firestore();

  const admin1Context = testEnv.authenticatedContext("admin1", { email: "shwayat.mustafa@gmail.com" });
  const adminDb = admin1Context.firestore();

  const salesRep1Context = testEnv.authenticatedContext("sales_rep1", { email: "salesrep1@example.com" });
  const salesRep1Db = salesRep1Context.firestore();

  const medRep1Context = testEnv.authenticatedContext("med_rep1", { email: "medrep1@example.com" });
  const medRep1Db = medRep1Context.firestore();

  const salesMgr1Context = testEnv.authenticatedContext("sales_mgr1", { email: "salesmgr1@example.com" });
  const salesMgr1Db = salesMgr1Context.firestore();

  const countryMgr1Context = testEnv.authenticatedContext("country_mgr1", { email: "countrymgr1@example.com" });
  const countryMgr1Db = countryMgr1Context.firestore();

  const inactiveMgr1Context = testEnv.authenticatedContext("inactive_mgr1", { email: "inactive_mgr1@example.com" });
  const inactiveMgr1Db = inactiveMgr1Context.firestore();

  const superAdmin1Context = testEnv.authenticatedContext("super_admin1", { email: "superadmin1@example.com" });
  const superAdmin1Db = superAdmin1Context.firestore();

  // Test 1: Representative reads own assignment
  try {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, "userProductAssignments/PA_rep1_prod306"), {
        assignmentId: "PA_rep1_prod306",
        userId: "rep1",
        productId: "prod306",
        productGroupId: "acne",
        therapeuticArea: "Dermatology",
        assignmentType: "both",
        status: "Active",
        active: true,
        assignedBy: "admin1",
        assignedAt: new Date().toISOString()
      });
    });

    await assertSucceeds(getDoc(doc(rep1Db, "userProductAssignments/PA_rep1_prod306")));
    assertTest(true, "Representative reads own assignment");
  } catch (err: any) {
    assertTest(false, "Representative reads own assignment - " + err.message);
  }

  // Test 2: Representative cannot read another user’s assignment
  try {
    await assertFails(getDoc(doc(rep1Db, "userProductAssignments/PA_rep2_prod306")));
    assertTest(true, "Representative cannot read another user's assignment");
  } catch (err: any) {
    assertTest(false, "Representative cannot read another user's assignment - " + err.message);
  }

  // Test 3: Representative cannot run an unrestricted list
  try {
    await assertFails(getDocs(collection(rep1Db, "userProductAssignments")));
    assertTest(true, "Representative cannot run an unrestricted list");
  } catch (err: any) {
    assertTest(false, "Representative cannot run an unrestricted list - " + err.message);
  }

  // Test 4: Representative cannot create an assignment
  try {
    await assertFails(setDoc(doc(rep1Db, "userProductAssignments/PA_rep1_new"), {
      assignmentId: "PA_rep1_new",
      userId: "rep1",
      productId: "prod306",
      productGroupId: "acne",
      therapeuticArea: "Dermatology",
      assignmentType: "both",
      status: "Active",
      active: true,
      assignedBy: "rep1",
      assignedAt: new Date().toISOString()
    }));
    assertTest(true, "Representative cannot create an assignment");
  } catch (err: any) {
    assertTest(false, "Representative cannot create an assignment - " + err.message);
  }

  // Test 5: Representative cannot update an assignment
  try {
    await assertFails(updateDoc(doc(rep1Db, "userProductAssignments/PA_rep1_prod306"), {
      status: "Inactive",
      active: false
    }));
    assertTest(true, "Representative cannot update an assignment");
  } catch (err: any) {
    assertTest(false, "Representative cannot update an assignment - " + err.message);
  }

  // Test 6: Representative cannot delete an assignment
  try {
    await assertFails(deleteDoc(doc(rep1Db, "userProductAssignments/PA_rep1_prod306")));
    assertTest(true, "Representative cannot delete an assignment");
  } catch (err: any) {
    assertTest(false, "Representative cannot delete an assignment - " + err.message);
  }

  // Test 7: Admin creates a valid canonical assignment
  try {
    await assertSucceeds(setDoc(doc(adminDb, "userProductAssignments/PA_rep1_prod306_admin"), {
      assignmentId: "PA_rep1_prod306_admin",
      userId: "rep1",
      productId: "prod306",
      productGroupId: "acne",
      therapeuticArea: "Dermatology",
      assignmentType: "both",
      status: "Active",
      active: true,
      assignedBy: "admin1",
      assignedAt: new Date().toISOString()
    }));
    assertTest(true, "Admin creates a valid canonical assignment");
  } catch (err: any) {
    assertTest(false, "Admin creates a valid canonical assignment - " + err.message);
  }

  // Test 8: Admin cannot create an assignment for a missing user
  try {
    await assertFails(setDoc(doc(adminDb, "userProductAssignments/PA_missingUser_prod306"), {
      assignmentId: "PA_missingUser_prod306",
      userId: "missingUser",
      productId: "prod306",
      productGroupId: "acne",
      therapeuticArea: "Dermatology",
      assignmentType: "both",
      status: "Active",
      active: true,
      assignedBy: "admin1",
      assignedAt: new Date().toISOString()
    }));
    assertTest(true, "Admin cannot create an assignment for a missing user");
  } catch (err: any) {
    assertTest(false, "Admin cannot create an assignment for a missing user - " + err.message);
  }

  // Test 9: Admin cannot create an assignment for a missing Product
  try {
    await assertFails(setDoc(doc(adminDb, "userProductAssignments/PA_rep1_missingProd"), {
      assignmentId: "PA_rep1_missingProd",
      userId: "rep1",
      productId: "missingProd",
      productGroupId: "acne",
      therapeuticArea: "Dermatology",
      assignmentType: "both",
      status: "Active",
      active: true,
      assignedBy: "admin1",
      assignedAt: new Date().toISOString()
    }));
    assertTest(true, "Admin cannot create an assignment for a missing Product");
  } catch (err: any) {
    assertTest(false, "Admin cannot create an assignment for a missing Product - " + err.message);
  }

  // Test 10: Product Name as productId is rejected
  try {
    await assertFails(setDoc(doc(adminDb, "userProductAssignments/PA_rep1_name_with_space"), {
      assignmentId: "PA_rep1_name_with_space",
      userId: "rep1",
      productId: "Acne Product 25G",
      productGroupId: "acne",
      therapeuticArea: "Dermatology",
      assignmentType: "both",
      status: "Active",
      active: true,
      assignedBy: "admin1",
      assignedAt: new Date().toISOString()
    }));
    assertTest(true, "Product Name as productId is rejected");
  } catch (err: any) {
    assertTest(false, "Product Name as productId is rejected - " + err.message);
  }

  // Test 11: Valid metadata update succeeds
  try {
    await assertSucceeds(updateDoc(doc(adminDb, "userProductAssignments/PA_rep1_prod306"), {
      status: "Inactive",
      active: false,
      updatedAt: new Date().toISOString(),
      updatedBy: "admin1",
      deactivatedAt: new Date().toISOString(),
      deactivatedBy: "admin1",
      deactivationReason: "REMOVED_FROM_USER_ASSIGNMENT"
    }));
    assertTest(true, "Valid metadata update succeeds");
  } catch (err: any) {
    assertTest(false, "Valid metadata update succeeds - " + err.message);
  }

  // Test 12: userId mutation is rejected
  try {
    await assertFails(updateDoc(doc(adminDb, "userProductAssignments/PA_rep1_prod306"), {
      userId: "rep2"
    }));
    assertTest(true, "userId mutation is rejected");
  } catch (err: any) {
    assertTest(false, "userId mutation is rejected - " + err.message);
  }

  // Test 13: productId mutation is rejected
  try {
    await assertFails(updateDoc(doc(adminDb, "userProductAssignments/PA_rep1_prod306"), {
      productId: "prod307"
    }));
    assertTest(true, "productId mutation is rejected");
  } catch (err: any) {
    assertTest(false, "productId mutation is rejected - " + err.message);
  }

  // Test 14: Soft deactivation succeeds
  try {
    await assertSucceeds(updateDoc(doc(adminDb, "userProductAssignments/PA_rep1_prod306"), {
      status: "Inactive",
      active: false,
      deactivatedAt: new Date().toISOString(),
      deactivatedBy: "admin1"
    }));
    assertTest(true, "Soft deactivation succeeds");
  } catch (err: any) {
    assertTest(false, "Soft deactivation succeeds - " + err.message);
  }

  // Test 15: Reactivation succeeds
  try {
    await assertSucceeds(updateDoc(doc(adminDb, "userProductAssignments/PA_rep1_prod306"), {
      status: "Active",
      active: true,
      updatedAt: new Date().toISOString(),
      updatedBy: "admin1"
    }));
    assertTest(true, "Reactivation succeeds");
  } catch (err: any) {
    assertTest(false, "Reactivation succeeds - " + err.message);
  }

  // Test 16: Unauthorized field injection is rejected
  try {
    await assertFails(updateDoc(doc(adminDb, "userProductAssignments/PA_rep1_prod306"), {
      unauthorizedField: "hacked_value"
    }));
    assertTest(true, "Unauthorized field injection is rejected");
  } catch (err: any) {
    assertTest(false, "Unauthorized field injection is rejected - " + err.message);
  }

  // Test 17: Direct Supervisor reads an approved subordinate
  try {
    await assertSucceeds(getDoc(doc(sup1Db, "userProductAssignments/PA_rep1_prod306")));
    assertTest(true, "Direct Supervisor reads an approved subordinate");
  } catch (err: any) {
    assertTest(false, "Direct Supervisor reads an approved subordinate - " + err.message);
  }

  // Test 18: Supervisor cannot read an unrelated Representative
  try {
    await assertFails(getDoc(doc(sup1Db, "userProductAssignments/PA_rep2_prod306")));
    assertTest(true, "Supervisor cannot read an unrelated Representative");
  } catch (err: any) {
    assertTest(false, "Supervisor cannot read an unrelated Representative - " + err.message);
  }

  // Test 19: Manager reads an approved second-level subordinate
  try {
    await assertSucceeds(getDoc(doc(mgr1Db, "userProductAssignments/PA_rep1_prod306")));
    assertTest(true, "Manager reads an approved second-level subordinate");
  } catch (err: any) {
    assertTest(false, "Manager reads an approved second-level subordinate - " + err.message);
  }

  // Test 20: Manager cannot read outside approved scope
  try {
    await assertFails(getDoc(doc(mgr1Db, "userProductAssignments/PA_rep2_prod306")));
    assertTest(true, "Manager cannot read outside approved scope");
  } catch (err: any) {
    assertTest(false, "Manager cannot read outside approved scope - " + err.message);
  }

  // Test 21: Inactive Manager is denied
  try {
    const inactiveMgrContext = testEnv.authenticatedContext("inactive_mgr1", { email: "inactive_mgr1@example.com" });
    const inactiveMgrDb = inactiveMgrContext.firestore();
    await assertFails(getDoc(doc(inactiveMgrDb, "userProductAssignments/PA_rep1_prod306")));
    assertTest(true, "Inactive Manager is denied");
  } catch (err: any) {
    assertTest(false, "Inactive Manager is denied - " + err.message);
  }

  // Test 22: Scoped Representative query succeeds
  try {
    const q = query(collection(rep1Db, "userProductAssignments"), where("userId", "==", "rep1"));
    await assertSucceeds(getDocs(q));
    assertTest(true, "Scoped Representative query succeeds");
  } catch (err: any) {
    assertTest(false, "Scoped Representative query succeeds - " + err.message);
  }

  // Test 23: Unscoped Representative query fails
  try {
    await assertFails(getDocs(collection(rep1Db, "userProductAssignments")));
    assertTest(true, "Unscoped Representative query fails");
  } catch (err: any) {
    assertTest(false, "Unscoped Representative query fails - " + err.message);
  }

  // Test 24: Realistic assignment synchronization batch succeeds
  try {
    const batch = writeBatch(adminDb);
    batch.set(doc(adminDb, "userProductAssignments/PA_rep1_prod306_b1"), {
      assignmentId: "PA_rep1_prod306_b1",
      userId: "rep1",
      productId: "prod306",
      productGroupId: "acne",
      therapeuticArea: "Dermatology",
      assignmentType: "both",
      status: "Active",
      active: true,
      assignedBy: "admin1",
      assignedAt: new Date().toISOString()
    });
    await assertSucceeds(batch.commit());
    assertTest(true, "Realistic assignment synchronization batch succeeds");
  } catch (err: any) {
    assertTest(false, "Realistic assignment synchronization batch succeeds - " + err.message);
  }

  // =========================================================================
  // TARGET SECURITY TESTS (WP4.1H.4)
  // =========================================================================
  console.log("\n=====================================================================");
  console.log("RUNNING TARGET LIFECYCLE & READ-SCOPE SECURITY TESTS...");
  console.log("=====================================================================");

  // Seed target documents
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    
    // 1. Raw target plans
    await setDoc(doc(db, "productTargetPlans/plan_libya"), {
      planId: "plan_libya",
      countryId: "Libya",
      year: 2026,
      currencyCode: "LYD",
      monthlyDistributionMethod: "EQUAL_WITHIN_QUARTER",
      status: "ACTIVE",
      version: 1,
      active: true,
      effectiveFrom: "2026-01-01"
    });

    await setDoc(doc(db, "productTargetPlans/plan_tunisia"), {
      planId: "plan_tunisia",
      countryId: "Tunisia",
      year: 2026,
      currencyCode: "TND",
      monthlyDistributionMethod: "EQUAL_WITHIN_QUARTER",
      status: "ACTIVE",
      version: 1,
      active: true,
      effectiveFrom: "2026-01-01"
    });

    // 2. Calculated targets
    await setDoc(doc(db, "calculatedProductTargets/calc_libya_area123"), {
      calculatedTargetId: "calc_libya_area123",
      planId: "plan_libya",
      countryId: "Libya",
      areaId: "area123",
      year: 2026,
      targetUnits: 1500,
      targetValue: 30000,
      active: true
    });

    await setDoc(doc(db, "calculatedProductTargets/calc_libya_area456"), {
      calculatedTargetId: "calc_libya_area456",
      planId: "plan_libya",
      countryId: "Libya",
      areaId: "area456",
      year: 2026,
      targetUnits: 1000,
      targetValue: 20000,
      active: true
    });

    await setDoc(doc(db, "calculatedProductTargets/calc_tunisia_area123"), {
      calculatedTargetId: "calc_tunisia_area123",
      planId: "plan_tunisia",
      countryId: "Tunisia",
      areaId: "area123",
      year: 2026,
      targetUnits: 1200,
      targetValue: 24000,
      active: true
    });

    // 3. Target calculation runs
    await setDoc(doc(db, "targetCalculationRuns/run_libya"), {
      runId: "run_libya",
      countryId: "Libya",
      year: 2026,
      status: "COMPLETED"
    });

    await setDoc(doc(db, "targetCalculationRuns/run_tunisia"), {
      runId: "run_tunisia",
      countryId: "Tunisia",
      year: 2026,
      status: "COMPLETED"
    });

    // 4. Target imports
    await setDoc(doc(db, "targetImports/import_libya"), {
      importId: "import_libya",
      countryId: "Libya",
      year: 2026,
      status: "COMPLETE"
    });

    await setDoc(doc(db, "targetImports/import_tunisia"), {
      importId: "import_tunisia",
      countryId: "Tunisia",
      year: 2026,
      status: "COMPLETE"
    });

    // 5. Audit logs
    await setDoc(doc(db, "auditLogs/audit_libya"), {
      logId: "audit_libya",
      countryId: "Libya",
      userId: "sales_mgr1",
      action: "REBUILT_TARGETS",
      timestamp: new Date().toISOString()
    });

    await setDoc(doc(db, "auditLogs/audit_tunisia"), {
      logId: "audit_tunisia",
      countryId: "Tunisia",
      userId: "tunisia_mgr1",
      action: "REBUILT_TARGETS",
      timestamp: new Date().toISOString()
    });
  });

  // Test 25: Sales Representative reads calculated targets within country/area (Libya/area123)
  try {
    await assertSucceeds(getDoc(doc(salesRep1Db, "calculatedProductTargets/calc_libya_area123")));
    assertTest(true, "Sales Representative reads calculated targets within country/area");
  } catch (err: any) {
    assertTest(false, "Sales Representative reads calculated targets within country/area - " + err.message);
  }

  // Test 26: Sales Representative reading mismatched country (Tunisia/area123)
  try {
    await assertFails(getDoc(doc(salesRep1Db, "calculatedProductTargets/calc_tunisia_area123")));
    assertTest(true, "Sales Representative reading mismatched country (deny)");
  } catch (err: any) {
    assertTest(false, "Sales Representative reading mismatched country (deny) - " + err.message);
  }

  // Test 27: Sales Representative reading mismatched area (Libya/area456)
  try {
    await assertFails(getDoc(doc(salesRep1Db, "calculatedProductTargets/calc_libya_area456")));
    assertTest(true, "Sales Representative reading mismatched area (deny)");
  } catch (err: any) {
    assertTest(false, "Sales Representative reading mismatched area (deny) - " + err.message);
  }

  // Test 28: Medical Representative reading calculated targets (deny)
  try {
    await assertFails(getDoc(doc(medRep1Db, "calculatedProductTargets/calc_libya_area123")));
    assertTest(true, "Medical Representative reading calculated targets (deny)");
  } catch (err: any) {
    assertTest(false, "Medical Representative reading calculated targets (deny) - " + err.message);
  }

  // Test 29: Sales Representative reads raw product target plans (Libya) -> deny
  try {
    await assertFails(getDoc(doc(salesRep1Db, "productTargetPlans/plan_libya")));
    assertTest(true, "Sales Representative reads raw product target plans (deny)");
  } catch (err: any) {
    assertTest(false, "Sales Representative reads raw product target plans (deny) - " + err.message);
  }

  // Test 30: Medical Representative reads raw product target plans (Libya) -> deny
  try {
    await assertFails(getDoc(doc(medRep1Db, "productTargetPlans/plan_libya")));
    assertTest(true, "Medical Representative reads raw product target plans (deny)");
  } catch (err: any) {
    assertTest(false, "Medical Representative reads raw product target plans (deny) - " + err.message);
  }

  // Test 31: Sales Manager (Libya) reads raw target plan in Libya -> allowed
  try {
    await assertSucceeds(getDoc(doc(salesMgr1Db, "productTargetPlans/plan_libya")));
    assertTest(true, "Sales Manager reads raw target plan in Libya");
  } catch (err: any) {
    assertTest(false, "Sales Manager reads raw target plan in Libya - " + err.message);
  }

  // Test 32: Sales Manager (Libya) reads raw target plan in Tunisia -> deny
  try {
    await assertFails(getDoc(doc(salesMgr1Db, "productTargetPlans/plan_tunisia")));
    assertTest(true, "Sales Manager reads raw target plan in Tunisia (deny)");
  } catch (err: any) {
    assertTest(false, "Sales Manager reads raw target plan in Tunisia (deny) - " + err.message);
  }

  // Test 33: Country Manager (Libya) reads raw target plan in Libya -> allowed
  try {
    await assertSucceeds(getDoc(doc(countryMgr1Db, "productTargetPlans/plan_libya")));
    assertTest(true, "Country Manager reads raw target plan in Libya");
  } catch (err: any) {
    assertTest(false, "Country Manager reads raw target plan in Libya - " + err.message);
  }

  // Test 34: Country Manager (Libya) reads raw target plan in Tunisia -> deny
  try {
    await assertFails(getDoc(doc(countryMgr1Db, "productTargetPlans/plan_tunisia")));
    assertTest(true, "Country Manager reads raw target plan in Tunisia (deny)");
  } catch (err: any) {
    assertTest(false, "Country Manager reads raw target plan in Tunisia (deny) - " + err.message);
  }

  // Test 35: Super Admin reads raw target plan in Libya -> allowed
  try {
    await assertSucceeds(getDoc(doc(superAdmin1Db, "productTargetPlans/plan_libya")));
    assertTest(true, "Super Admin reads raw target plan in Libya");
  } catch (err: any) {
    assertTest(false, "Super Admin reads raw target plan in Libya - " + err.message);
  }

  // Test 36: Super Admin reads raw target plan in Tunisia -> allowed
  try {
    await assertSucceeds(getDoc(doc(superAdmin1Db, "productTargetPlans/plan_tunisia")));
    assertTest(true, "Super Admin reads raw target plan in Tunisia");
  } catch (err: any) {
    assertTest(false, "Super Admin reads raw target plan in Tunisia - " + err.message);
  }

  // Test 37: Inactive Manager (Libya) reads raw target plan in Libya -> deny
  try {
    await assertFails(getDoc(doc(inactiveMgr1Db, "productTargetPlans/plan_libya")));
    assertTest(true, "Inactive Manager reads raw target plan in Libya (deny)");
  } catch (err: any) {
    assertTest(false, "Inactive Manager reads raw target plan in Libya (deny) - " + err.message);
  }

  // Test 38: Sales Manager (Libya) reads target calculation run in Libya -> allowed
  try {
    await assertSucceeds(getDoc(doc(salesMgr1Db, "targetCalculationRuns/run_libya")));
    assertTest(true, "Sales Manager reads target calculation run in Libya");
  } catch (err: any) {
    assertTest(false, "Sales Manager reads target calculation run in Libya - " + err.message);
  }

  // Test 39: Sales Manager (Libya) reads target calculation run in Tunisia -> deny
  try {
    await assertFails(getDoc(doc(salesMgr1Db, "targetCalculationRuns/run_tunisia")));
    assertTest(true, "Sales Manager reads target calculation run in Tunisia (deny)");
  } catch (err: any) {
    assertTest(false, "Sales Manager reads target calculation run in Tunisia (deny) - " + err.message);
  }

  // Test 40: Sales Rep reads target calculation run in Libya -> deny
  try {
    await assertFails(getDoc(doc(salesRep1Db, "targetCalculationRuns/run_libya")));
    assertTest(true, "Sales Representative reads target calculation run (deny)");
  } catch (err: any) {
    assertTest(false, "Sales Representative reads target calculation run (deny) - " + err.message);
  }

  // Test 41: Sales Manager (Libya) reads target imports in Libya -> allowed
  try {
    await assertSucceeds(getDoc(doc(salesMgr1Db, "targetImports/import_libya")));
    assertTest(true, "Sales Manager reads target imports in Libya");
  } catch (err: any) {
    assertTest(false, "Sales Manager reads target imports in Libya - " + err.message);
  }

  // Test 42: Sales Manager (Libya) reads target imports in Tunisia -> deny
  try {
    await assertFails(getDoc(doc(salesMgr1Db, "targetImports/import_tunisia")));
    assertTest(true, "Sales Manager reads target imports in Tunisia (deny)");
  } catch (err: any) {
    assertTest(false, "Sales Manager reads target imports in Tunisia (deny) - " + err.message);
  }

  // Test 43: Sales Manager (Libya) reads target-related audit logs in Libya -> allowed
  try {
    await assertSucceeds(getDoc(doc(salesMgr1Db, "auditLogs/audit_libya")));
    assertTest(true, "Sales Manager reads target audit logs in Libya");
  } catch (err: any) {
    assertTest(false, "Sales Manager reads target audit logs in Libya - " + err.message);
  }

  // Test 44: Sales Manager (Libya) reads target-related audit logs in Tunisia -> deny
  try {
    await assertFails(getDoc(doc(salesMgr1Db, "auditLogs/audit_tunisia")));
    assertTest(true, "Sales Manager reads target audit logs in Tunisia (deny)");
  } catch (err: any) {
    assertTest(false, "Sales Manager reads target audit logs in Tunisia (deny) - " + err.message);
  }

  // =========================================================================
  // BATCH LIMIT TESTS (Section 5)
  // =========================================================================
  console.log("\n=====================================================================");
  console.log("RUNNING BATCH LIMIT TESTS...");
  console.log("=====================================================================");

  const batchSizes = [1, 2, 5, 10, 20, 50, 100];
  const batchResults: Array<{ size: number; docsAccess: number; expected: string; actual: string; error?: string }> = [];

  for (const size of batchSizes) {
    // Generate unique products for the batch to force unique exists() checks
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      for (let k = 0; k < size; k++) {
        await setDoc(doc(db, `products/batch_prod_${k}`), {
          id: `batch_prod_${k}`,
          name: `Batch Prod ${k}`,
          brand: "generic",
          promotionGroupId: "generic",
          therapeuticArea: "General Medicine",
          isActive: true,
          sku: `SKU-${k}`
        });
      }
    });

    const batch = writeBatch(adminDb);
    for (let k = 0; k < size; k++) {
      batch.set(doc(adminDb, `userProductAssignments/PA_rep1_batch_${size}_prod_${k}`), {
        assignmentId: `PA_rep1_batch_${size}_prod_${k}`,
        userId: "rep1",
        productId: `batch_prod_${k}`,
        productGroupId: "generic",
        therapeuticArea: "General Medicine",
        assignmentType: "both",
        status: "Active",
        active: true,
        assignedBy: "admin1",
        assignedAt: new Date().toISOString()
      });
    }

    let success = false;
    let errMsg = "";
    try {
      await batch.commit();
      success = true;
    } catch (err: any) {
      success = false;
      errMsg = err.message || err.toString();
    }

    // Calculation of document access calls:
    // exists(users/rep1) -> 1
    // exists(products/batch_prod_k) -> size
    // Admin checks (users/admin1) -> 1
    const docAccessesEstimate = size + 2;

    // Firestore restricts batch writes to max 20 document-access calls total across all operations in the batch.
    // If size is small (e.g. 10), docAccessesEstimate is 12 <= 20, so it succeeds.
    // If size is larger (e.g. 20), docAccessesEstimate is 22 > 20, so it FAILS.
    const expectedStr = docAccessesEstimate <= 20 ? "SUCCESS" : "FAILURE (Access Limit > 20)";
    const actualStr = success ? "SUCCESS" : "FAILURE";

    batchResults.push({
      size,
      docsAccess: docAccessesEstimate,
      expected: expectedStr,
      actual: actualStr,
      error: success ? undefined : errMsg
    });

    console.log(`Batch Size: ${size} | Est. Doc Accesses: ${docAccessesEstimate} | Expected: ${expectedStr} | Actual: ${actualStr} | Error: ${errMsg || "None"}`);
  }

  // Print Summary Table
  console.log("\n=====================================================================");
  console.log("BATCH PERFORMANCE RESULTS MATRIX");
  console.log("=====================================================================");
  console.log("| Batch size | Rule document accesses | Expected | Actual | Error |");
  console.log("|---:|---:|---|---|---|");
  for (const r of batchResults) {
    console.log(`| ${r.size} | ${r.docsAccess} | ${r.expected} | ${r.actual} | ${r.error || "None"} |`);
  }

  // =========================================================================
  // PHASE 3C: SECURITY BOOTSTRAP UNIT TESTS
  // =========================================================================
  const unauthContext = testEnv.unauthenticatedContext();
  const unauthDb = unauthContext.firestore();

  const ownerContext = testEnv.authenticatedContext("ownerUid", { email: "shwayat.mustafa@gmail.com" });
  const ownerDb = ownerContext.firestore();

  // Test 3C-A: Unauthenticated get of former hardcoded UID document -> DENIED
  try {
    await assertFails(getDoc(doc(unauthDb, "users/GQynj6LObmfQPz6PbNR9poANfXv1")));
    assertTest(true, "3C-A: Unauthenticated get of former hardcoded UID document -> DENIED");
  } catch (err: any) {
    assertTest(false, "3C-A: Unauthenticated get of former hardcoded UID document -> DENIED - " + err.message);
  }

  // Test 3C-B: Unauthenticated create/update/delete of former hardcoded UID document -> DENIED
  try {
    await assertFails(setDoc(doc(unauthDb, "users/GQynj6LObmfQPz6PbNR9poANfXv1"), { name: "Hacker" }));
    await assertFails(updateDoc(doc(unauthDb, "users/GQynj6LObmfQPz6PbNR9poANfXv1"), { name: "Hacker" }));
    await assertFails(deleteDoc(doc(unauthDb, "users/GQynj6LObmfQPz6PbNR9poANfXv1")));
    assertTest(true, "3C-B: Unauthenticated write operations on former hardcoded UID document -> DENIED");
  } catch (err: any) {
    assertTest(false, "3C-B: Unauthenticated write operations on former hardcoded UID document -> DENIED - " + err.message);
  }

  // Test 3C-C: Authenticated normal user reading own profile -> ALLOWED
  try {
    await assertSucceeds(getDoc(doc(rep1Db, "users/rep1")));
    assertTest(true, "3C-C: Authenticated normal user reading own profile -> ALLOWED");
  } catch (err: any) {
    assertTest(false, "3C-C: Authenticated normal user reading own profile -> ALLOWED - " + err.message);
  }

  // Test 3C-D: Authenticated normal user reading another profile (unlinked) -> DENIED
  try {
    await assertFails(getDoc(doc(rep1Db, "users/rep2")));
    assertTest(true, "3C-D: Authenticated normal user reading unlinked profile -> DENIED");
  } catch (err: any) {
    assertTest(false, "3C-D: Authenticated normal user reading unlinked profile -> DENIED - " + err.message);
  }

  // Test 3C-E: Normal user self-assigning role "Super Admin" -> DENIED
  try {
    await assertFails(updateDoc(doc(rep1Db, "users/rep1"), { role: "Super Admin" }));
    assertTest(true, "3C-E: Normal user self-assigning role 'Super Admin' -> DENIED");
  } catch (err: any) {
    assertTest(false, "3C-E: Normal user self-assigning role 'Super Admin' -> DENIED - " + err.message);
  }

  // Test 3C-F: generic Super Admin profile grants canonical administrative read access
  try {
    await assertSucceeds(getDoc(doc(superAdmin1Db, "users/rep1")));
    assertTest(true, "3C-F: Canonical Super Admin profile administrative read -> ALLOWED");
  } catch (err: any) {
    assertTest(false, "3C-F: Canonical Super Admin profile administrative read -> ALLOWED - " + err.message);
  }

  // Test 3C-G: Global unknown collection access -> DENIED
  try {
    await assertFails(getDoc(doc(rep1Db, "unknownCollection/someDoc")));
    assertTest(true, "3C-G: Global unknown collection access -> DENIED");
  } catch (err: any) {
    assertTest(false, "3C-G: Global unknown collection access -> DENIED - " + err.message);
  }

  // =========================================================================
  // PHASE 3E: PRE-DEPLOYMENT PRIVILEGE-ESCALATION REPAIR UNIT TESTS
  // =========================================================================
  const newSelfUserContext = testEnv.authenticatedContext("newSelfUid", { email: "newself@example.com" });
  const newSelfDb = newSelfUserContext.firestore();

  // Test 3E-A: Normal authenticated user self-creates role "Super Admin" -> DENIED
  try {
    await assertFails(setDoc(doc(newSelfDb, "users/newSelfUid"), {
      id: "newSelfUid",
      email: "newself@example.com",
      name: "Attacker",
      role: "Super Admin"
    }));
    assertTest(true, "3E-A: Normal authenticated user self-creates role 'Super Admin' -> DENIED");
  } catch (err: any) {
    assertTest(false, "3E-A: Normal authenticated user self-creates role 'Super Admin' -> DENIED - " + err.message);
  }

  // Test 3E-B: Normal authenticated user self-creates role "Admin" -> DENIED
  try {
    await assertFails(setDoc(doc(newSelfDb, "users/newSelfUid"), {
      id: "newSelfUid",
      email: "newself@example.com",
      name: "Attacker",
      role: "Admin"
    }));
    assertTest(true, "3E-B: Normal authenticated user self-creates role 'Admin' -> DENIED");
  } catch (err: any) {
    assertTest(false, "3E-B: Normal authenticated user self-creates role 'Admin' -> DENIED - " + err.message);
  }

  // Test 3E-C: Normal authenticated user creates safe minimal profile -> ALLOWED
  try {
    await assertSucceeds(setDoc(doc(newSelfDb, "users/newSelfUid"), {
      id: "newSelfUid",
      email: "newself@example.com",
      name: "Safe Self User",
      displayName: "Safe Self User",
      createdAt: "2026-08-04T12:00:00Z"
    }));
    assertTest(true, "3E-C: Normal authenticated user creates safe minimal profile -> ALLOWED");
  } catch (err: any) {
    assertTest(false, "3E-C: Normal authenticated user creates safe minimal profile -> ALLOWED - " + err.message);
  }

  // Test 3E-D: Normal user changes their role after profile creation -> DENIED
  try {
    await assertFails(updateDoc(doc(newSelfDb, "users/newSelfUid"), {
      role: "Admin"
    }));
    assertTest(true, "3E-D: Normal user changes their role after profile creation -> DENIED");
  } catch (err: any) {
    assertTest(false, "3E-D: Normal user changes their role after profile creation -> DENIED - " + err.message);
  }

  // Test 3E-E: email identity alone cannot bootstrap a privileged profile.
  // Initial Super Admin provisioning must use the trusted Admin SDK/backend.
  try {
    await assertFails(setDoc(doc(ownerDb, "users/ownerUid"), {
      id: "ownerUid",
      email: "shwayat.mustafa@gmail.com",
      name: "Mustafa Shwayat",
      role: "Super Admin",
      active: true,
      status: "Active"
    }));
    assertTest(true, "3E-E: Email-only client bootstrap of Super Admin profile -> DENIED");
  } catch (err: any) {
    assertTest(false, "3E-E: Email-only client bootstrap of Super Admin profile -> DENIED - " + err.message);
  }

  // Test 3E-F: Normal authenticated user writes territories -> DENIED
  try {
    await assertFails(setDoc(doc(rep1Db, "territories/testTerritory"), { name: "Unauthorized Territory" }));
    assertTest(true, "3E-F: Normal authenticated user writes territories -> DENIED");
  } catch (err: any) {
    assertTest(false, "3E-F: Normal authenticated user writes territories -> DENIED - " + err.message);
  }

  // Test 3E-G: Normal authenticated user writes deliveryOfficerDirectory -> DENIED
  try {
    await assertFails(setDoc(doc(rep1Db, "deliveryOfficerDirectory/testOfficer"), { name: "Unauthorized Officer" }));
    assertTest(true, "3E-G: Normal authenticated user writes deliveryOfficerDirectory -> DENIED");
  } catch (err: any) {
    assertTest(false, "3E-G: Normal authenticated user writes deliveryOfficerDirectory -> DENIED - " + err.message);
  }

  // Test 3E-H: Unauthenticated users/{uid} access -> DENIED
  try {
    await assertFails(getDoc(doc(unauthDb, "users/newSelfUid")));
    await assertFails(setDoc(doc(unauthDb, "users/unauthUid"), { name: "Unauth" }));
    assertTest(true, "3E-H: Unauthenticated users/{uid} access -> DENIED");
  } catch (err: any) {
    assertTest(false, "3E-H: Unauthenticated users/{uid} access -> DENIED - " + err.message);
  }

  await testEnv.cleanup();
  
  if (failedCount > 0) {
    console.error(`\n[FAIL] Rules test run completed with ${failedCount} failures.`);
    process.exit(1);
  } else {
    console.log("\n[SUCCESS] All Firestore rules unit-testing cases completed perfectly!");
  }
}

runRulesTests();
