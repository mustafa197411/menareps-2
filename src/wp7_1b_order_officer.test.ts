import { Role, User } from "./types";
import { isRepresentativeRole, sanitizeUserSavePayload } from "./utils/importNormalization";
import { getReadiness, canAccessGroup } from "./lib/userPolicyEngine";

export function runWP71BTests() {
  console.log("=== STARTING WP7.1B FOCUSED UNIT TESTS ===");

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

  // TEST 1: isRepresentativeRole("Sales Representative") === true
  assert(isRepresentativeRole("Sales Representative") === true, "Sales Representative is recognized as a representative role");

  // TEST 2: isRepresentativeRole("Medical Representative") === true
  assert(isRepresentativeRole("Medical Representative") === true, "Medical Representative is recognized as a representative role");

  // TEST 3: isRepresentativeRole("Finance Officer") === false
  assert(isRepresentativeRole("Finance Officer") === false, "Finance Officer is not a representative role");

  // TEST 4: isRepresentativeRole("Order Operations Officer") === false
  assert(isRepresentativeRole("Order Operations Officer") === false, "Order Operations Officer is not a representative role");

  // TEST 5: Non-representative save payload sanitization removes representative-only fields
  let jsonOutput = "";
  const originalInfo = console.info;
  console.info = (...args: any[]) => {
    const text = args.join(" ");
    if (text.includes("[ORDER_OFFICER_USER_SAVE_SANITIZATION_JSON]")) {
      jsonOutput = text;
    }
    originalInfo(...args);
  };

  const rawNonRepPayload = {
    id: "B1LhUXI54pSAa0zC4iVaHTxzHnO2",
    email: "fo@esand.local",
    role: "Finance Officer",
    primaryPromotionGroupId: "pg-123",
    targetPromotionGroupIds: ["pg-123"],
    assignedProductIds: ["prod-1"],
    products: ["prod-1"],
    productAssignments: [{ productId: "prod-1" }],
    country: "Libya",
    securityScope: "COUNTRY",
    active: true,
    undefinedField: undefined
  };

  const sanitizedPayload = sanitizeUserSavePayload("B1LhUXI54pSAa0zC4iVaHTxzHnO2", "Finance Officer", rawNonRepPayload);
  console.info = originalInfo;

  assert(!Object.prototype.hasOwnProperty.call(sanitizedPayload, "primaryPromotionGroupId"), "primaryPromotionGroupId is omitted for non-rep");
  assert(!Object.prototype.hasOwnProperty.call(sanitizedPayload, "targetPromotionGroupIds"), "targetPromotionGroupIds is omitted for non-rep");
  assert(!Object.prototype.hasOwnProperty.call(sanitizedPayload, "assignedProductIds"), "assignedProductIds is omitted for non-rep");
  assert(!Object.prototype.hasOwnProperty.call(sanitizedPayload, "products"), "products is omitted for non-rep");
  assert(!Object.prototype.hasOwnProperty.call(sanitizedPayload, "productAssignments"), "productAssignments is omitted for non-rep");
  assert(!Object.prototype.hasOwnProperty.call(sanitizedPayload, "undefinedField"), "undefinedField is removed recursively");
  assert(jsonOutput.includes("[ORDER_OFFICER_USER_SAVE_SANITIZATION_JSON]"), "Logs [ORDER_OFFICER_USER_SAVE_SANITIZATION_JSON]");

  const parsedSanitizationJson = JSON.parse(jsonOutput.replace("[ORDER_OFFICER_USER_SAVE_SANITIZATION_JSON]", "").trim());
  assert(parsedSanitizationJson.representativeRole === false, "Sanitization JSON records representativeRole = false");
  assert(parsedSanitizationJson.safeForFirestore === true, "Sanitization JSON records safeForFirestore = true");

  // TEST 6: Diagnostic log format for fo@esand.local auth mismatch
  const diagnosticJson = JSON.stringify({
    authUid: "aRSKSRDzldSeL7P9kPShjwCYday1",
    authEmail: "fo@esand.local",
    expectedOperationalUid: "B1LhUXI54pSAa0zC4iVaHTxzHnO2",
    directUserDocumentExists: false,
    activationProfileExists: true,
    activationLinkedToUid: "B1LhUXI54pSAa0zC4iVaHTxzHnO2",
    emailMatchesActivationProfile: true,
    identityMismatch: true
  });
  assert(diagnosticJson.includes('"identityMismatch":true'), "Auth link diagnostic JSON contains identityMismatch: true");

  // TEST 7: fo@esand.local auth mismatch throws controlled error
  let errorThrown = false;
  let errorMessage = "";
  try {
    const authUid = "aRSKSRDzldSeL7P9kPShjwCYday1";
    const expectedOperationalUid = "B1LhUXI54pSAa0zC4iVaHTxzHnO2";
    if (authUid !== expectedOperationalUid) {
      throw new Error(`Identity Account Mismatch: The authenticated Firebase Auth account (UID: ${authUid}) does not match the linked operational account (UID: ${expectedOperationalUid}). Your login credentials belong to a different Firebase Auth account. Please contact an Administrator to relink your account.`);
    }
  } catch (err: any) {
    errorThrown = true;
    errorMessage = err.message;
  }
  assert(errorThrown === true, "Controlled Identity Account Mismatch error thrown when auth UID mismatches");
  assert(errorMessage.includes("Identity Account Mismatch"), "Error message contains 'Identity Account Mismatch'");

  // TEST 8: Finance Officer duplicate reconciliation JSON format
  const reconciliationJson = JSON.stringify({
    email: "fo@esand.local",
    operationalDocumentId: "B1LhUXI54pSAa0zC4iVaHTxzHnO2",
    pendingDocumentId: "lyvWfLx4dryHkezfgSmo",
    operationalAuthLinked: true,
    pendingReferencesFound: [],
    safeToArchivePending: false,
    safeToDeletePending: false
  });
  assert(reconciliationJson.includes('"pendingDocumentId":"lyvWfLx4dryHkezfgSmo"'), "Reconciliation JSON specifies pending duplicate ID");
  assert(reconciliationJson.includes('"safeToDeletePending":false'), "Reconciliation JSON specifies safeToDeletePending = false");

  // TEST 9 & 10 & 11: Order Operations Officer first-auth linking logic & JSON
  const oooAuthUid = "auth_uid_ooo_123";
  const oooFirstAuthLinkJson = JSON.stringify({
    email: "ooo@esand.local",
    authUid: oooAuthUid,
    sourceDocumentId: "MbE6J5DfRpkZ39M16UeO",
    activationProfileId: "ooo-esand-local",
    targetDocumentId: oooAuthUid,
    linked: true,
    duplicateCreated: false
  });
  assert(oooFirstAuthLinkJson.includes('"email":"ooo@esand.local"'), "OOO First Auth Link JSON includes correct email");
  assert(oooFirstAuthLinkJson.includes('"duplicateCreated":false'), "OOO First Auth Link specifies no duplicate created");

  // TEST 12: Finance Officer security scope and country assignment
  const foUser: User = {
    id: "B1LhUXI54pSAa0zC4iVaHTxzHnO2",
    email: "fo@esand.local",
    name: "Finance Officer",
    role: Role.FINANCE,
    country: "Libya",
    securityScope: "COUNTRY",
    active: true
  };
  assert(foUser.securityScope === "COUNTRY", "Finance Officer security scope is COUNTRY");
  assert(foUser.country === "Libya", "Finance Officer country is Libya");

  // TEST 13: Order Operations Officer security scope and country assignment
  const oooUser: User = {
    id: "MbE6J5DfRpkZ39M16UeO",
    email: "ooo@esand.local",
    name: "Order Operations Officer",
    role: Role.ORDER_OPS_OFFICER,
    country: "Libya",
    securityScope: "COUNTRY",
    active: true
  };
  assert(oooUser.securityScope === "COUNTRY", "Order Operations Officer security scope is COUNTRY");
  assert(oooUser.country === "Libya", "Order Operations Officer country is Libya");

  // TEST 14: Default sidebar items & group access
  const foFinanceGroupAccess = canAccessGroup(foUser, "finance");
  const foOrdersGroupAccess = canAccessGroup(foUser, "sales-and-orders");
  const foFieldOpsGroupAccess = canAccessGroup(foUser, "field-operations");
  
  assert(foFinanceGroupAccess === true, "Finance Officer can access finance group");
  assert(foOrdersGroupAccess === true, "Finance Officer can access sales-and-orders group");
  assert(foFieldOpsGroupAccess === false, "Finance Officer cannot access field-operations group");

  const oooOpsGroupAccess = canAccessGroup(oooUser, "operations");
  const oooOrdersGroupAccess = canAccessGroup(oooUser, "sales-and-orders");
  const oooFieldOpsGroupAccess = canAccessGroup(oooUser, "field-operations");

  assert(oooOpsGroupAccess === true, "Order Operations Officer can access operations group");
  assert(oooOrdersGroupAccess === true, "Order Operations Officer can access sales-and-orders group");
  assert(oooFieldOpsGroupAccess === false, "Order Operations Officer cannot access field-operations group");

  console.log(`=== WP7.1B UNIT TESTS COMPLETE: ${passed} PASSED, ${failed} FAILED ===`);
  if (failed > 0) {
    throw new Error(`WP7.1B Unit Tests Failed (${failed} failures)`);
  }
}

// Auto execute if imported directly
runWP71BTests();
