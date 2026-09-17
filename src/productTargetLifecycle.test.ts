import { 
  TargetStatus, 
  Role, 
  ProductTargetPlan, 
  ProductAnnualTarget, 
  ProductAreaPotential, 
  ProductQuarterlyDistribution, 
  CalculatedProductTarget 
} from "./types";

import { 
  submitPlan, 
  approvePlan, 
  rejectPlan, 
  activatePlan, 
  amendPlan, 
  closePlan, 
  cancelPlan 
} from "./lib/productTargetLifecycleService";

import { createProductAnnualTargetId } from "./lib/productTargetIdService";

// =========================================================================
// HIGH-FIDELITY IN-MEMORY MOCK FIRESTORE DATABASE
// =========================================================================
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
    const docRef = {
      id,
      path: key,
      exists: this.store.has(key),
      get: async () => {
        const data = this.store.get(key);
        return new MockDoc(this.store.has(key), data, docRef);
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
      ref: null as any
    };
    docRef.ref = docRef;
    return docRef;
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
              const id = key.substring(this.name.length + 1);
              const docRef = this.doc(id);
              docs.push({
                exists: true,
                ref: docRef,
                data: () => docVal
              });
            }
          }
        }
        return {
          empty: docs.length === 0,
          docs
        };
      }
    };
    return chain;
  }
}

class MockDb {
  public store = new Map<string, any>();
  private collections = new Map<string, MockCollection>();

  collection(name: string) {
    if (!this.collections.has(name)) {
      this.collections.set(name, new MockCollection(name, this.store));
    }
    return this.collections.get(name)!;
  }

  batch() {
    return {
      set: (ref: any, data: any) => {
        ref.set(data);
      },
      update: (ref: any, data: any) => {
        ref.update(data);
      },
      commit: async () => {}
    };
  }
}

// =========================================================================
// RUNTIME TEST RUNNER
// =========================================================================
let failedTestsCount = 0;
let totalAssertions = 0;

function assert(condition: boolean, testName: string, errorMessage?: string) {
  totalAssertions++;
  if (condition) {
    console.log(`[PASS] Case ${totalAssertions}: ${testName}`);
  } else {
    console.error(`[FAIL] Case ${totalAssertions}: ${testName} - ${errorMessage || "Assertion failed"}`);
    failedTestsCount++;
  }
}

async function runLifecycleTestSuite() {
  console.log("=================================================================");
  console.log("MENAREPS 2.0 WP4.1H.1 - PRODUCT LIFECYCLE SECURITY AUDIT CERTIFICATION");
  console.log("=================================================================\n");

  const db = new MockDb();

  // Helper actors
  const adminActor = { id: "USR::ADMIN", email: "admin@menareps.com", role: Role.ADMIN, country: "Jordan" };
  const repActor = { id: "USR::REP", email: "rep@menareps.com", role: Role.MEDICAL_REP, country: "Jordan" };
  const managerActor = { id: "USR::MGR", email: "manager@menareps.com", role: Role.COUNTRY_MANAGER, country: "Jordan" };
  const managerIraqActor = { id: "USR::MGR_IQ", email: "manager_iq@menareps.com", role: Role.COUNTRY_MANAGER, country: "Iraq" };
  const superAdminActor = { id: "USR::SA", email: "sa@menareps.com", role: Role.SUPER_ADMIN, country: "Jordan" };

  // Helper seeding function
  const seedBasePlan = async (planId: string, status: TargetStatus, actorEmail: string = "manager@menareps.com", active: boolean = true, version: number = 1) => {
    const plan: ProductTargetPlan = {
      planId,
      countryId: "Jordan",
      year: 2026,
      currencyCode: "JOD",
      monthlyDistributionMethod: "EQUAL_WITHIN_QUARTER",
      status,
      version,
      active,
      createdAt: new Date().toISOString(),
      createdBy: actorEmail,
      updatedAt: new Date().toISOString(),
      updatedBy: actorEmail,
      submittedBy: status !== TargetStatus.DRAFT ? actorEmail : undefined,
      submittedAt: status !== TargetStatus.DRAFT ? new Date().toISOString() : undefined,
    };
    await db.collection("productTargetPlans").doc(planId).set(plan);
  };

  const seedSubEntities = async (planId: string) => {
    const annual: ProductAnnualTarget = {
      targetId: `PAT::${planId}::PROD001`,
      planId,
      countryId: "Jordan",
      productId: "PROD001",
      year: 2026,
      annualTargetUnits: 12000,
      currencyCode: "JOD",
      status: TargetStatus.DRAFT,
      version: 1,
      active: true,
      unitPriceSnapshot: 10,
      createdAt: new Date().toISOString(),
      createdBy: "manager@menareps.com",
      updatedAt: new Date().toISOString(),
      updatedBy: "manager@menareps.com"
    };
    await db.collection("productAnnualTargets").doc(annual.targetId).set(annual);

    const potential: ProductAreaPotential = {
      areaPotentialId: `PAP::${planId}::PROD001::AREA01`,
      planId,
      annualTargetId: annual.targetId,
      countryId: "Jordan",
      productId: "PROD001",
      year: 2026,
      areaId: "AREA01",
      potentialPercentage: 100,
      status: TargetStatus.DRAFT,
      version: 1,
      active: true,
      createdAt: new Date().toISOString(),
      createdBy: "manager@menareps.com",
      updatedAt: new Date().toISOString(),
      updatedBy: "manager@menareps.com"
    };
    await db.collection("productAreaPotentials").doc(potential.areaPotentialId).set(potential);

    const quarterly: ProductQuarterlyDistribution = {
      quarterlyDistributionId: `PQD::${planId}::PROD001`,
      planId,
      annualTargetId: annual.targetId,
      countryId: "Jordan",
      productId: "PROD001",
      year: 2026,
      q1Percentage: 25,
      q2Percentage: 25,
      q3Percentage: 25,
      q4Percentage: 25,
      status: TargetStatus.DRAFT,
      version: 1,
      active: true,
      createdAt: new Date().toISOString(),
      createdBy: "manager@menareps.com",
      updatedAt: new Date().toISOString(),
      updatedBy: "manager@menareps.com"
    };
    await db.collection("productQuarterlyDistributions").doc(quarterly.quarterlyDistributionId).set(quarterly);

    const calculated: CalculatedProductTarget = {
      calculatedTargetId: `CPT::${planId}::PROD001::AREA01::1`,
      planId,
      annualTargetId: annual.targetId,
      areaPotentialId: potential.areaPotentialId,
      quarterlyDistributionId: quarterly.quarterlyDistributionId,
      countryId: "Jordan",
      productId: "PROD001",
      areaId: "AREA01",
      year: 2026,
      quarter: 1,
      month: 1,
      targetUnits: 1000,
      targetValue: 10000,
      unitPriceSnapshot: 10,
      currencyCode: "JOD",
      status: TargetStatus.DRAFT,
      version: 1,
      calculationVersion: 1,
      calculationInputHash: "hash123",
      active: true,
      annualTargetUnitsSnapshot: 12000,
      areaPotentialPercentageSnapshot: 100,
      quarterPercentageSnapshot: 25,
      monthlyDistributionMethodSnapshot: "EQUAL_WITHIN_QUARTER",
      calculatedAt: new Date().toISOString(),
      calculatedBy: "manager@menareps.com"
    };
    await db.collection("calculatedProductTargets").doc(calculated.calculatedTargetId).set(calculated);
  };

  // -------------------------------------------------------------------------
  // SUBMIT PLAN TESTS (CASES 1-7)
  // -------------------------------------------------------------------------
  console.log(">>> Running Submit Transition Tests...");

  // Case 1: Successfully submit plan with valid sub-entities
  {
    await seedBasePlan("PTP::JO::2026::V1", TargetStatus.DRAFT);
    await seedSubEntities("PTP::JO::2026::V1");
    const submitted = await submitPlan(db, "PTP::JO::2026::V1", managerActor);
    assert(submitted.status === TargetStatus.SUBMITTED, "Case 1: Successfully submit plan and verify SUBMITTED status");
  }

  // Case 2: Reject submitting if plan lacks annual targets
  {
    await seedBasePlan("PTP::JO::2026::V2", TargetStatus.DRAFT);
    try {
      await submitPlan(db, "PTP::JO::2026::V2", managerActor);
      assert(false, "Case 2: Should reject submission of empty plan");
    } catch (err: any) {
      assert(err.message.includes("At least one annual product target is required"), "Case 2: Block empty plan submission successfully");
    }
  }

  // Case 3: Reject submitting if area potentials sum is not 100%
  {
    await seedBasePlan("PTP::JO::2026::V3", TargetStatus.DRAFT);
    await seedSubEntities("PTP::JO::2026::V3");
    // Poison potentials to sum to 90%
    const potRef = db.collection("productAreaPotentials").doc("PAP::PTP::JO::2026::V3::PROD001::AREA01");
    await potRef.update({ potentialPercentage: 90 });

    try {
      await submitPlan(db, "PTP::JO::2026::V3", managerActor);
      assert(false, "Case 3: Should reject submission if area potentials do not sum to 100%");
    } catch (err: any) {
      assert(err.message.includes("must sum to exactly 100%"), "Case 3: Block invalid potentials sum successfully");
    }
  }

  // Case 4: Reject submitting if quarterly distribution sum is not 100%
  {
    await seedBasePlan("PTP::JO::2026::V4", TargetStatus.DRAFT);
    await seedSubEntities("PTP::JO::2026::V4");
    // Poison quarterly to sum to 80%
    const qRef = db.collection("productQuarterlyDistributions").doc("PQD::PTP::JO::2026::V4::PROD001");
    await qRef.update({ q1Percentage: 5 });

    try {
      await submitPlan(db, "PTP::JO::2026::V4", managerActor);
      assert(false, "Case 4: Should reject submission if quarterly distribution does not sum to 100%");
    } catch (err: any) {
      assert(err.message.includes("must sum to exactly 100%"), "Case 4: Block invalid quarterly distribution sum successfully");
    }
  }

  // Case 5: Reject submitting if unit price snapshot is invalid or <= 0
  {
    await seedBasePlan("PTP::JO::2026::V5", TargetStatus.DRAFT);
    await seedSubEntities("PTP::JO::2026::V5");
    const targetRef = db.collection("productAnnualTargets").doc("PAT::PTP::JO::2026::V5::PROD001");
    await targetRef.update({ unitPriceSnapshot: -5 });

    try {
      await submitPlan(db, "PTP::JO::2026::V5", managerActor);
      assert(false, "Case 5: Should reject submission if unit price is invalid");
    } catch (err: any) {
      assert(err.message.includes("invalid or zero unit price snapshot"), "Case 5: Block invalid unit price snapshot successfully");
    }
  }

  // Case 6: Reject submitting if user lacks submission permission (Medical Representative)
  {
    await seedBasePlan("PTP::JO::2026::V6", TargetStatus.DRAFT);
    await seedSubEntities("PTP::JO::2026::V6");
    try {
      await submitPlan(db, "PTP::JO::2026::V6", repActor);
      assert(false, "Case 6: Should block representative from submitting targets");
    } catch (err: any) {
      assert(err.message.includes("does not have authority to submit plans"), "Case 6: Blocked rep submission permission successfully");
    }
  }

  // Case 7: Reject submitting if user country scope does not match plan countryId
  {
    await seedBasePlan("PTP::JO::2026::V7", TargetStatus.DRAFT);
    await seedSubEntities("PTP::JO::2026::V7");
    try {
      await submitPlan(db, "PTP::JO::2026::V7", managerIraqActor);
      assert(false, "Case 7: Should block manager from submitting for Jordan");
    } catch (err: any) {
      assert(err.message.includes("do not have country scope permission"), "Case 7: Blocked out-of-scope country submit successfully");
    }
  }

  // -------------------------------------------------------------------------
  // APPROVE PLAN TESTS (CASES 8-11)
  // -------------------------------------------------------------------------
  console.log("\n>>> Running Approve Transition Tests...");

  // Case 8: Successfully approve a plan by an authorized user
  {
    await seedBasePlan("PTP::JO::2026::V8", TargetStatus.SUBMITTED, "manager@menareps.com");
    await seedSubEntities("PTP::JO::2026::V8");
    const approved = await approvePlan(db, "PTP::JO::2026::V8", adminActor, "Approved plan");
    assert(approved.status === TargetStatus.APPROVED, "Case 8: Approved target plan status is correct");
  }

  // Case 9: Block approval if user does not have permission
  {
    await seedBasePlan("PTP::JO::2026::V9", TargetStatus.SUBMITTED, "manager@menareps.com");
    try {
      await approvePlan(db, "PTP::JO::2026::V9", repActor, "Approving");
      assert(false, "Case 9: Rep should fail to approve plan");
    } catch (err: any) {
      assert(err.message.includes("does not have authority to approve plans"), "Case 9: Non-authorized role blocked successfully");
    }
  }

  // Case 10: Enforce segregation of duties: Submitter cannot self-approve
  {
    await seedBasePlan("PTP::JO::2026::V10", TargetStatus.SUBMITTED, "manager@menareps.com");
    try {
      await approvePlan(db, "PTP::JO::2026::V10", managerActor, "Self-approving");
      assert(false, "Case 10: Submitter should fail to approve their own plan");
    } catch (err: any) {
      assert(err.message.includes("Segregation of duties check failed"), "Case 10: Prevented self-approval successfully");
    }
  }

  // Case 11: Allow self-approval override if actor is a Super Admin
  {
    await seedBasePlan("PTP::JO::2026::V11", TargetStatus.SUBMITTED, "sa@menareps.com");
    await seedSubEntities("PTP::JO::2026::V11");
    const approved = await approvePlan(db, "PTP::JO::2026::V11", superAdminActor, "SA self-approval override");
    assert(approved.status === TargetStatus.APPROVED, "Case 11: Super Admin bypasses segregation of duties checks successfully");
  }

  // -------------------------------------------------------------------------
  // REJECT PLAN TESTS (CASES 12-13)
  // -------------------------------------------------------------------------
  console.log("\n>>> Running Reject Transition Tests...");

  // Case 12: Block rejection if reason is empty
  {
    await seedBasePlan("PTP::JO::2026::V12", TargetStatus.SUBMITTED, "manager@menareps.com");
    try {
      await rejectPlan(db, "PTP::JO::2026::V12", adminActor, "");
      assert(false, "Case 12: Empty rejection reason must throw error");
    } catch (err: any) {
      assert(err.message.includes("Rejection reason/comment is required"), "Case 12: Mandatory rejection reason enforced successfully");
    }
  }

  // Case 13: Successfully reject a plan by an authorized user
  {
    await seedBasePlan("PTP::JO::2026::V13", TargetStatus.SUBMITTED, "manager@menareps.com");
    await seedSubEntities("PTP::JO::2026::V13");
    const rejected = await rejectPlan(db, "PTP::JO::2026::V13", adminActor, "No alignment details provided");
    assert(rejected.status === TargetStatus.REJECTED, "Case 13: Successfully reject target plan with logged reason");
  }

  // -------------------------------------------------------------------------
  // ACTIVATE PLAN TESTS (CASES 14-15)
  // -------------------------------------------------------------------------
  console.log("\n>>> Running Activate Transition and Deactivation Tests...");

  // Case 14: Successfully activate an APPROVED plan
  {
    await seedBasePlan("PTP::JO::2026::V14_APPROVED", TargetStatus.APPROVED, "manager@menareps.com");
    await seedSubEntities("PTP::JO::2026::V14_APPROVED");
    const activated = await activatePlan(db, "PTP::JO::2026::V14_APPROVED", adminActor, "2026-01-01");
    assert(activated.status === TargetStatus.ACTIVE, "Case 14: Successfully activated APPROVED plan");
  }

  // Case 15: Check that legacy active plans and sub-entities are superseded and deactivated atomically
  {
    // Seed V1 active plan
    await seedBasePlan("PTP::JO::2026::V15_OLD", TargetStatus.ACTIVE, "manager@menareps.com", true, 1);
    await seedSubEntities("PTP::JO::2026::V15_OLD");

    // Seed V2 approved plan
    await seedBasePlan("PTP::JO::2026::V15_NEW", TargetStatus.APPROVED, "manager@menareps.com", true, 2);
    await seedSubEntities("PTP::JO::2026::V15_NEW");

    // Activate V2 on 2026-06-01
    await activatePlan(db, "PTP::JO::2026::V15_NEW", adminActor, "2026-06-01");

    // Query old plan
    const oldPlanDoc = await db.collection("productTargetPlans").doc("PTP::JO::2026::V15_OLD").get();
    const oldPlan = oldPlanDoc.data();

    assert(oldPlan.status === TargetStatus.SUPERSEDED, "Case 15: Old plan status updated to SUPERSEDED");
    assert(oldPlan.active === false, "Case 15: Old plan 'active' is false");
    assert(oldPlan.effectiveTo === "2026-06-01", "Case 15: Old plan 'effectiveTo' set to new plan's 'effectiveFrom'");

    // Verify sub-entities deactivation
    const oldAnnualDoc = await db.collection("productAnnualTargets").doc("PAT::PTP::JO::2026::V15_OLD::PROD001").get();
    assert(oldAnnualDoc.data().status === TargetStatus.SUPERSEDED && oldAnnualDoc.data().active === false, "Case 15: Old annual target deactivated and status updated");

    const oldCalculatedDoc = await db.collection("calculatedProductTargets").doc("CPT::PTP::JO::2026::V15_OLD::PROD001::AREA01::1").get();
    assert(oldCalculatedDoc.data().status === TargetStatus.SUPERSEDED && oldCalculatedDoc.data().active === false, "Case 15: Old calculated target deactivated and status updated");
  }

  // -------------------------------------------------------------------------
  // AMEND PLAN TESTS (CASES 16-17)
  // -------------------------------------------------------------------------
  console.log("\n>>> Running Amend Transition Tests...");

  // Case 16: Block amendment if reason or effectiveFrom is missing
  {
    await seedBasePlan("PTP::JO::2026::V16_ACTIVE", TargetStatus.ACTIVE, "manager@menareps.com", true, 1);
    try {
      await amendPlan(db, "PTP::JO::2026::V16_ACTIVE", managerActor, "", "2026-06-01");
      assert(false, "Case 16: Empty amendment reason must fail");
    } catch (err: any) {
      assert(err.message.includes("reason is required"), "Case 16: Mandatory amendment reason enforced");
    }

    try {
      await amendPlan(db, "PTP::JO::2026::V16_ACTIVE", managerActor, "Revised Q3", "");
      assert(false, "Case 16: Empty effectiveFrom must fail");
    } catch (err: any) {
      assert(err.message.includes("Effective from date is required"), "Case 16: Mandatory effectiveFrom parameter enforced");
    }
  }

  // Case 17: Successfully amend plan, copying sub-entities with correct version and linked supersedes ID
  {
    await seedBasePlan("PTP::JO::2026::V17_ACTIVE", TargetStatus.ACTIVE, "manager@menareps.com", true, 1);
    await seedSubEntities("PTP::JO::2026::V17_ACTIVE");

    const amended = await amendPlan(db, "PTP::JO::2026::V17_ACTIVE", managerActor, "Revised Q3 Distribution", "2026-07-01");

    assert(amended.status === TargetStatus.DRAFT, "Case 17: Amended plan is in DRAFT status");
    assert(amended.version === 2, "Case 17: Amended plan version is correctly incremented (+1)");
    assert(amended.supersedesPlanId === "PTP::JO::2026::V17_ACTIVE", "Case 17: Amended plan correctly records supersedesPlanId");
    assert(amended.effectiveFrom === "2026-07-01", "Case 17: Amended plan has correct effectiveFrom date");

    // Verify sub-entities are copied with new parent reference, version, and status DRAFT
    const targetId = createProductAnnualTargetId(amended.planId, "PROD001");
    const copiedTargetDoc = await db.collection("productAnnualTargets").doc(targetId).get();
    assert(copiedTargetDoc.exists, "Case 17: Sub-entities copied successfully to amended plan draft");
    assert(copiedTargetDoc.data().status === TargetStatus.DRAFT && copiedTargetDoc.data().version === 2, "Case 17: Copied sub-entity is in DRAFT status with version 2");
  }

  // =========================================================================
  // TEST SUMMARY
  // =========================================================================
  console.log("\n=================================================================");
  console.log(`TEST LIFECYCLE COMPLETED. ASSERTIONS RUN: ${totalAssertions}`);
  if (failedTestsCount === 0) {
    console.log("ALL LIFECYCLE SECURITY TESTS PASSED SUCCESSFULLY! [PASS]");
  } else {
    console.error(`FAILED TESTS: ${failedTestsCount}`);
    process.exit(1);
  }
  console.log("=================================================================");
}

runLifecycleTestSuite().catch(err => {
  console.error("Test runner crashed with error:", err);
  process.exit(1);
});
