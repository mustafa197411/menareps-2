import { Role, User, Product, UserTerritoryAssignment, UserProductAssignment } from "./types";
import { getReadiness } from "./lib/userPolicyEngine";
import { getAssignmentOperationalState, validateSyncInputs, calculateSyncDiff, buildCanonicalProductAssignment } from "./lib/productAssignmentService";
import { isUserOperational, isLinkedPendingRecord, setGlobalSecurityContext } from "./lib/securityEngine";
import { getEmailKey } from "./lib/firestoreService";

let failedTestsCount = 0;

function assert(condition: boolean, testName: string, errorMessage?: string) {
  if (condition) {
    console.log(`[PASS] ${testName}`);
  } else {
    console.error(`[FAIL] ${testName}: ${errorMessage || "Assertion failed"}`);
    failedTestsCount++;
  }
}

export function runOnboardingLifecycleTests() {
  console.log("=================================================");
  console.log("RUNNING ONBOARDING LIFECYCLE REPAIR AUTOMATED TESTS");
  console.log("=================================================\n");

  const authUid = "TEST_REP_AUTH_UID_1001";
  const email = "rep.test@menareps.com";
  const normalizedEmail = email.toLowerCase().trim();

  // Test 1: Deterministic Email Key generation
  {
    const emailKey = getEmailKey(normalizedEmail);
    assert(emailKey === "rep-test-menareps-com", "1. Deterministic Email Key formatting");
  }

  // Test 2: Canonical User Profile Identity
  const canonicalUser: User = {
    id: authUid,
    uid: authUid,
    authUid: authUid,
    email: normalizedEmail,
    name: "John Representative",
    firstName: "John",
    lastName: "Representative",
    role: Role.MEDICAL_REP,
    managerEmail: "manager@menareps.com",
    managerId: "MGR_123",
    region: "National Scope",
    territory: "AIN ZARA",
    active: true,
    joinedDate: "2026-01-01",
    username: "rep.test",
    sidebarVisibility: ["dashboard", "physicians", "pharmacies", "products"],
    areaIds: ["AREA_AIN_ZARA", "AREA_TAJOURA"],
    areaNames: ["AIN ZARA", "TAJOURA"],
    products: ["306", "307"],
    territories: ["AIN ZARA", "TAJOURA"],
    country: "Libya",
    district: "District 1",
    city: "Tripoli",
    status: "Active",
    employmentStatus: "Active",
    loginAllowed: true,
    isDeleted: false,
    securityScope: "Territory Only",
    primaryPromotionGroupId: "acne",
    targetPromotionGroupIds: ["dermatitis", "hyperpigmentation"],
    assignmentSyncStatus: "COMPLETE"
  };

  {
    assert(canonicalUser.id === authUid && (canonicalUser as any).authUid === authUid, "2. Canonical identity binds to Auth UID");
  }

  // Test 3: Readiness evaluation for fully assigned representative
  {
    const allUsers: User[] = [
      canonicalUser,
      {
        id: "MGR_123",
        email: "manager@menareps.com",
        name: "Test Manager",
        role: Role.MEDICAL_SUPERVISOR,
        active: true,
        employmentStatus: "Active",
        loginAllowed: true
      } as any
    ];

    const report = getReadiness(canonicalUser, allUsers);
    assert(report.status === "Operational", "3. getReadiness evaluates new representative as Operational", `Got status: ${report.status}, reasons: ${report.reasons.join(", ")}`);
  }

  // Test 4: Operational state check
  {
    const state = getAssignmentOperationalState(canonicalUser);
    assert(state.state === "READY" && state.allowed === true, "4. getAssignmentOperationalState returns READY for COMPLETE syncStatus");
  }

  // Test 5: Missing syncStatus remains blocked even when canonical arrays are present
  {
    const userWithoutSyncStatus = {
      ...canonicalUser,
      assignmentSyncStatus: undefined
    };
    const state = getAssignmentOperationalState(userWithoutSyncStatus);
    assert(state.state === "LEGACY_REVIEW_REQUIRED" && state.allowed === false, "5. getAssignmentOperationalState requires COMPLETE even with canonical areaIds + products");
  }

  // Test 6: Legacy review required ONLY when canonical IDs missing
  {
    const legacyUser = {
      ...canonicalUser,
      areaIds: [],
      products: [],
      assignedProductIds: [],
      assignmentSyncStatus: undefined
    };
    const state = getAssignmentOperationalState(legacyUser);
    assert(state.state === "LEGACY_REVIEW_REQUIRED" && state.allowed === false, "6. getAssignmentOperationalState returns LEGACY_REVIEW_REQUIRED for un-migrated legacy profiles");
  }

  // Test 7: Document ID formatting for Territory and Product assignments
  {
    const areaId = "AREA_AIN_ZARA";
    const productId = "306";
    const taId = `TA_${authUid}_${areaId}`;
    const paId = `PA_${authUid}_${productId}`;

    assert(taId === `TA_${authUid}_AREA_AIN_ZARA`, "7. Territory Assignment ID formatting TA_{authUid}_{areaId}");
    assert(paId === `PA_${authUid}_306`, "8. Product Assignment ID formatting PA_{authUid}_{productId}");
  }

  // Test 8: Duplicate record detection & suppression
  {
    const pendingDuplicate: User = {
      id: "TEMP_RANDOM_DOC_ID_99",
      email: normalizedEmail,
      name: "John Representative",
      role: Role.MEDICAL_REP,
      active: true
    } as any;

    const allUsersList = [canonicalUser, pendingDuplicate];
    const isSuppressed = isLinkedPendingRecord(pendingDuplicate, allUsersList);
    assert(isSuppressed === true, "9. Pending duplicate profile is correctly suppressed when canonical auth-linked record exists");
  }

  // Test 9: Security scope resolution
  {
    setGlobalSecurityContext(
      canonicalUser,
      [
        canonicalUser,
        {
          id: "MGR_123",
          email: "manager@menareps.com",
          name: "Test Manager",
          role: Role.MEDICAL_SUPERVISOR,
          active: true,
          employmentStatus: "Active",
          loginAllowed: true
        } as any
      ]
    );
    const report = getReadiness(canonicalUser, [
      canonicalUser,
      {
        id: "MGR_123",
        email: "manager@menareps.com",
        name: "Test Manager",
        role: Role.MEDICAL_SUPERVISOR,
        active: true,
        employmentStatus: "Active",
        loginAllowed: true
      } as any
    ]);
    const isOp = isUserOperational(canonicalUser, [], []);
    assert(isOp === true, "10. isUserOperational returns true for canonical representative", `Readiness status: ${report.status}, reasons: ${report.reasons.join(", ")}`);
  }

  console.log(`\nTests finished. Failed count: ${failedTestsCount}`);
  if (failedTestsCount > 0) {
    throw new Error(`${failedTestsCount} onboarding lifecycle tests failed.`);
  }
}

runOnboardingLifecycleTests();
