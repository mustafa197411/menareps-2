import { Role, User } from "./types";
import { getReadiness, validateManager } from "./lib/userPolicyEngine";
import { removeUndefinedRecursively, sanitizeAndAuditPayload, getUndefinedPaths } from "./utils/importNormalization";

function runWP71ATests() {
  console.log("=== STARTING WP7.1A FOCUSED UNIT TESTS ===");

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, message: string) {
    if (condition) {
      console.log(`[PASS] ${message}`);
      passed++;
    } else {
      console.error(`[FAIL] ${message}`);
      failed++;
    }
  }

  // TEST 1: Payload Sanitization removes undefined keys (e.g. primaryPromotionGroupId: undefined)
  const rawFinanceUserPayload = {
    id: "B1LhUXI54pSAa0zC4iVaHTxzHnO2",
    email: "fo@esand.local",
    role: Role.FINANCE,
    name: "Finance Officer",
    active: true,
    primaryPromotionGroupId: undefined,
    targetPromotionGroupIds: undefined,
    products: [],
    country: "Libya",
    securityScope: "National"
  };

  const undefinedPathsBefore = getUndefinedPaths(rawFinanceUserPayload);
  assert(undefinedPathsBefore.includes("primaryPromotionGroupId"), "getUndefinedPaths detects undefined primaryPromotionGroupId");

  const sanitized = removeUndefinedRecursively(rawFinanceUserPayload);
  assert(sanitized.primaryPromotionGroupId === undefined, "Sanitized object property is omitted");
  assert(!Object.prototype.hasOwnProperty.call(sanitized, "primaryPromotionGroupId"), "Sanitized object has no primaryPromotionGroupId property");
  assert(getUndefinedPaths(sanitized).length === 0, "No undefined paths remain after sanitization");

  // TEST 2: sanitizeAndAuditPayload execution
  const auditedPayload = sanitizeAndAuditPayload("users", "B1LhUXI54pSAa0zC4iVaHTxzHnO2", rawFinanceUserPayload);
  assert(!Object.prototype.hasOwnProperty.call(auditedPayload, "primaryPromotionGroupId"), "sanitizeAndAuditPayload strips undefined keys");

  // TEST 3: Readiness check for Finance Officer without primaryPromotionGroupId
  const mockFinanceManager: User = {
    id: "mgr-1",
    email: "fm@esand.local",
    name: "Finance Manager",
    role: Role.FINANCE_MANAGER,
    active: true,
    country: "Libya"
  };

  const financeUser: Partial<User> = {
    id: "B1LhUXI54pSAa0zC4iVaHTxzHnO2",
    email: "fo@esand.local",
    role: Role.FINANCE,
    active: true,
    employmentStatus: "Active",
    loginAllowed: true,
    managerId: "mgr-1",
    country: "Libya",
    securityScope: "National"
  };

  const readiness = getReadiness(financeUser, [mockFinanceManager]);
  assert(readiness.status === "Operational", `Finance Officer readiness status is Operational (Got: ${readiness.status}, Reasons: ${readiness.reasons.join(", ")})`);

  // TEST 4: Manager validation for Finance Officer
  const mgrVal = validateManager(financeUser, [mockFinanceManager]);
  assert(mgrVal.isValid === true, "Manager validation succeeds for Finance Officer reporting to Finance Manager");

  // TEST 5: Order Operations Officer readiness check
  const mockOpsManager: User = {
    id: "mgr-2",
    email: "wm@esand.local",
    name: "Warehouse Manager",
    role: Role.WAREHOUSE_MANAGER,
    active: true,
    country: "Libya"
  };

  const orderOpsUser: Partial<User> = {
    id: "MbE6J5DfRpkZ39M16UeO",
    email: "ooo@esand.local",
    role: Role.ORDER_OPS_OFFICER,
    active: true,
    employmentStatus: "Active",
    loginAllowed: true,
    managerId: "mgr-2",
    country: "Libya",
    securityScope: "National"
  };

  const oooReadiness = getReadiness(orderOpsUser, [mockOpsManager]);
  assert(oooReadiness.status === "Operational", `Order Operations Officer readiness is Operational (Got: ${oooReadiness.status})`);

  console.log(`\n=== TEST SUMMARY: ${passed} PASSED, ${failed} FAILED ===`);
  if (failed > 0) {
    process.exit(1);
  }
}

runWP71ATests();
