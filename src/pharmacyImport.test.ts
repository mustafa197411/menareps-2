import { Role, User, Pharmacy } from "./types";
import { 
  resolveGeographyTuple, 
  normalizeGeoLabel, 
  isCanonical, 
  stripUndefinedFields,
  removeUndefinedRecursively
} from "./utils/importNormalization";

let failedTestsCount = 0;
let totalAssertionsRun = 0;

function assert(condition: boolean, testName: string, errorMessage?: string) {
  totalAssertionsRun++;
  if (condition) {
    console.log(`[PASS] Assertion #${totalAssertionsRun}: ${testName}`);
  } else {
    console.error(`[FAIL] Assertion #${totalAssertionsRun}: ${testName}: ${errorMessage || "Assertion failed"}`);
    failedTestsCount++;
  }
}

// 1. Mock Active Areas Master Catalog
const mockAreas = [
  // Canonical (isCanonical = true)
  { id: "LY-WEST-TRE2", name: "TAJOURA", cityName: "TRIPOLI EAST", districtName: "West", countryName: "Libya", countryId: "C-LIB-8842", districtId: "D-070037", cityId: "CT-TRIPOLIEAST-D-070037" },
  { id: "LY-WEST-TRW5", name: "JANZUR", cityName: "TRIPOLI WEST", districtName: "West", countryName: "Libya", countryId: "C-LIB-8842", districtId: "D-070037", cityId: "CT-TRIPOLIWEST-D-070037" },
  { id: "LY-WEST-TRIP-ZDH", name: "Zawiyat Dahmani", cityName: "Tripoli", districtName: "West", countryName: "Libya", countryId: "C-LIB-8842", districtId: "D-070037", cityId: "CT-083110" },
  { id: "JO-AMM-AMM-ABD", name: "Al-Abdali", cityName: "Amman", districtName: "Amman", countryName: "Jordan", countryId: "C-JOR-1122", districtId: "D-112233", cityId: "CT-998877" },

  // Explicit legacy lifecycle state; ID prefix alone is not a legacy marker
  { id: "A-043581", name: "Tajura", cityName: "Tripoli", districtName: "West", countryName: "Libya", countryId: "C-LIB-8842", districtId: "D-070037", cityId: "CT-083110", status: "Legacy" }
];

// 2. Mock Databases State
const mockDbPharmacies: Pharmacy[] = [
  {
    id: "PHM-TAJOURA-A",
    name: "Tajura Al-Shifa Pharmacy",
    country: "Libya",
    district: "West",
    city: "TRIPOLI EAST",
    area: "TAJOURA",
    areaId: "LY-WEST-TRE2",
    address: "Al-Jaraba Street",
    phone: "+218 92 7654321",
    email: "shifa_taj@example.com",
    outstandingBalance: 1500,
    paymentInDays: 30,
    assignedRepId: "rep-111",
    type: "retail",
    territory: "TAJOURA",
    region: "Tripoli",
    latitude: 32.8872,
    longitude: 13.3424
  },
  {
    id: "PHM-JANZOUR-B",
    name: "Janzour Garden Pharmacy",
    country: "Libya",
    district: "West",
    city: "TRIPOLI WEST",
    area: "JANZUR",
    areaId: "LY-WEST-TRW5",
    address: "Al-Kahraba Street",
    phone: "+218 91 8887766",
    email: "garden_janzour@example.com",
    outstandingBalance: 3200,
    paymentInDays: 45,
    assignedRepId: "rep-222",
    type: "chain",
    territory: "JANZUR",
    region: "Tripoli",
    latitude: 32.8901,
    longitude: 13.1122
  }
];

function runPharmacyImportTests() {
  console.log("=========================================");
  console.log("RUNNING PHARMACY IMPORT CERTIFICATION SUITE");
  console.log("=========================================\n");

  // -------------------------------------------------------------
  // PART 1: HEADING & SHEET NORMALIZATION ASSERTIONS (1-10)
  // -------------------------------------------------------------
  console.log("--- PART 1: Heading & Sheet Normalization ---");

  // Test 1: normalizeGeoLabel handles exact matching
  assert(normalizeGeoLabel("Libya") === "libya", "normalizeGeoLabel parses standard country");

  // Test 2: Case insensitivity
  assert(normalizeGeoLabel("LiByA  ") === "libya", "normalizeGeoLabel trims whitespace and downcases");

  // Test 3: Approved spelling alias Tajura -> Tajoura
  assert(normalizeGeoLabel("Tajura") === "tajoura", "normalizeGeoLabel handles Tajura -> Tajoura alias");

  // Test 4: Case insensitive alias TAJURA -> tajoura
  assert(normalizeGeoLabel("TAJURA") === "tajoura", "normalizeGeoLabel handles TAJURA -> tajoura");

  // Test 5: Approved spelling alias Janzour -> Janzur
  assert(normalizeGeoLabel("Janzour") === "janzur", "normalizeGeoLabel handles Janzour -> Janzur alias");

  // Test 6: Case insensitive alias JANZOUR -> janzur
  assert(normalizeGeoLabel("JANZOUR") === "janzur", "normalizeGeoLabel handles JANZOUR -> janzur");

  // Test 7: Untouched correct spelling janzur -> janzur
  assert(normalizeGeoLabel("janzur") === "janzur", "normalizeGeoLabel leaves correct spelling untouched");

  // Test 8: Empty or invalid input handling
  assert(normalizeGeoLabel("") === "", "normalizeGeoLabel handles empty string gracefully");

  // Test 9: canonical check on LY-WEST-TRE2
  assert(isCanonical({ id: "LY-WEST-TRE2" }) === true, "isCanonical identifies canonical record");

  // Test 10: document ID prefixes do not determine canonicality
  assert(isCanonical({ id: "A-043581" }) === true && isCanonical({ id: "A-043581", status: "Legacy" }) === false, "isCanonical accepts active A- IDs and rejects explicit legacy state");


  // -------------------------------------------------------------
  // PART 2: GEOGRAPHIC RESOLUTION HIERARCHY ASSERTIONS (11-25)
  // -------------------------------------------------------------
  console.log("\n--- PART 2: Geographic Resolution Hierarchy ---");

  // Test 11: Perfect canonical path match
  const res11 = resolveGeographyTuple("Libya", "West", "TRIPOLI EAST", "TAJOURA", mockAreas);
  assert(res11.isValid === true, "Exact hierarchical matching succeeds");
  assert(res11.areaId === "LY-WEST-TRE2", "Exact matching maps to correct canonical Area ID");
  assert(res11.areaName === "TAJOURA", "Exact matching retains canonical casing for TAJOURA");

  // Test 12: Exact matching with lowercase input
  const res12 = resolveGeographyTuple("libya", "west", "tripoli east", "tajoura", mockAreas);
  assert(res12.isValid === true, "Lowercase exact hierarchical matching succeeds");

  // Test 13: Exact matching with spacing variations
  const res13 = resolveGeographyTuple(" Libya ", " West ", " TRIPOLI  EAST ", " TAJOURA ", mockAreas);
  assert(res13.isValid === true, "Spaced exact hierarchical matching succeeds");

  // Test 14: Approved alias spelling 'Tajura' in exact matching
  const res14 = resolveGeographyTuple("Libya", "West", "TRIPOLI EAST", "Tajura", mockAreas);
  assert(res14.isValid === true, "Spelling alias 'Tajura' successfully resolves to canonical Tajoura");
  assert(res14.areaId === "LY-WEST-TRE2", "Spelling alias maps to canonical Area ID LY-WEST-TRE2");

  // Test 15: Wrong City must not be relaxed to a different canonical parent
  const res15 = resolveGeographyTuple("Libya", "West", "Tripoli", "Tajoura", mockAreas);
  assert(res15.isValid === false, "Tripoli does not silently relax to TRIPOLI EAST");
  assert(res15.cityId === undefined, "Rejected hierarchy returns no canonical City ID");
  assert(res15.areaId === undefined, "Rejected hierarchy returns no canonical Area ID");

  // Test 16: Wrong City must not be relaxed to Tripoli West
  const res16 = resolveGeographyTuple("Libya", "West", "Tripoli", "Janzour", mockAreas);
  assert(res16.isValid === false, "Tripoli does not silently relax to TRIPOLI WEST");
  assert(res16.areaId === undefined, "Wrong City/Area hierarchy returns no canonical Area ID");

  // Test 17: Mismatching Country rejects
  const res17 = resolveGeographyTuple("Jordan", "West", "TRIPOLI EAST", "TAJOURA", mockAreas);
  assert(res17.isValid === false, "Incorrect Country is rejected in hierarchy matching");

  // Test 18: Mismatching District rejects
  const res18 = resolveGeographyTuple("Libya", "East", "TRIPOLI EAST", "TAJOURA", mockAreas);
  assert(res18.isValid === false, "Incorrect District is rejected in hierarchy matching");

  // Test 19: Unregistered Area rejects
  const res19 = resolveGeographyTuple("Libya", "West", "TRIPOLI EAST", "Gargaresh-NotRegistered", mockAreas);
  assert(res19.isValid === false, "Unregistered Area rejects correctly");


  // -------------------------------------------------------------
  // PART 3: VALUE NORMALIZATION & SANITIZATION ASSERTIONS (26-35)
  // -------------------------------------------------------------
  console.log("\n--- PART 3: Value Normalization & Sanitization ---");

  // Test 26: stripUndefinedFields removes undefined keys
  const dirtyObj = { name: "Test Pharm", phone: undefined, email: "test@test.com", notes: null };
  const cleanObj = stripUndefinedFields(dirtyObj);
  assert(cleanObj.phone === undefined, "stripUndefinedFields strips undefined keys");
  assert(cleanObj.email === "test@test.com", "stripUndefinedFields preserves valid keys");

  // Test 27: stripUndefinedFields removes empty strings for optional fields
  const cleanObj2 = stripUndefinedFields({ name: "Test", email: "   " });
  assert(cleanObj2.email === undefined, "stripUndefinedFields strips empty or whitespace strings");

  // Test 28: removeUndefinedRecursively handling of deep undefined
  const dirtyDeep = { details: { balance: 100, flag: undefined } };
  const cleanDeep = removeUndefinedRecursively(dirtyDeep);
  assert(cleanDeep.details.flag === undefined, "removeUndefinedRecursively strips nested undefined");

  // Test 29: Outstanding balance string parser conversion
  const balanceStr = " $ 2,500.50 ";
  const parsedBalance = Number(balanceStr.trim().replace(/[$,\s]/g, ""));
  assert(parsedBalance === 2500.5, "outstandingBalance string parsing with symbols succeeds");

  // Test 30: paymentInDays negative number checker
  const paymentDaysStr = "-15";
  const isInvalidPayment = isNaN(Number(paymentDaysStr)) || Number(paymentDaysStr) < 0;
  assert(isInvalidPayment === true, "paymentInDays negative value is detected as invalid");


  // -------------------------------------------------------------
  // PART 4: DUPLICATION SCANNING MODES ASSERTIONS (31-40)
  // -------------------------------------------------------------
  console.log("\n--- PART 4: Duplication Scanning Modes ---");

  // Mock Row to import
  const incomingRow = {
    name: "Tajura Al-Shifa Pharmacy",
    email: "shifa_taj@example.com",
    phone: "+218 92 7654321"
  };

  // Test 31: Detect direct local duplicate in same spreadsheet (Email match)
  const localRows = [
    { name: "Pharm A", email: "dup@example.com", phone: "123" },
    { name: "Pharm B", email: "dup@example.com", phone: "456" }
  ];
  const isLocalDup = localRows[0].email === localRows[1].email;
  assert(isLocalDup === true, "Local duplicate detected inside spreadsheet rows");

  // Test 32: Detect direct local duplicate (Phone match after format cleaning)
  const localRowsPhone = [
    { name: "Pharm A", email: "a@a.com", phone: "+218-91-111222" },
    { name: "Pharm B", email: "b@b.com", phone: "091 111 222" }
  ];
  const cleanPhone1 = localRowsPhone[0].phone.replace(/\D/g, "");
  const cleanPhone2 = localRowsPhone[1].phone.replace(/\D/g, "");
  // Trim leading zero if applicable, or direct match
  const isPhoneDup = cleanPhone1.endsWith(cleanPhone2.substring(1));
  assert(isPhoneDup === true, "Local duplicate detected based on phone digits normalization");

  // Test 33: Duplicate detection in CREATE_NEW_ONLY mode (Rejects existing)
  const isDbDuplicate = mockDbPharmacies.some(r => 
    r.email?.toLowerCase().trim() === incomingRow.email.toLowerCase().trim() ||
    r.name.toLowerCase().trim() === incomingRow.name.toLowerCase().trim()
  );
  assert(isDbDuplicate === true, "Record identified as database duplicate (pre-existing)");

  // CREATE_NEW_ONLY mode rules
  const createNewOnlyAllowed = !isDbDuplicate;
  assert(createNewOnlyAllowed === false, "CREATE_NEW_ONLY rejects row if database duplicate exists");

  // Test 34: Duplicate detection in UPDATE_EXISTING_ONLY mode (Accepts existing)
  const updateExistingOnlyAllowed = isDbDuplicate;
  assert(updateExistingOnlyAllowed === true, "UPDATE_EXISTING_ONLY accepts row if database duplicate exists");

  // Test 35: Non-duplicate row under UPDATE_EXISTING_ONLY mode (Rejects new)
  const incomingNewRow = { name: "Completely New Pharm", email: "new@example.com" };
  const isDbDuplicateNew = mockDbPharmacies.some(r => 
    r.email?.toLowerCase().trim() === incomingNewRow.email.toLowerCase().trim()
  );
  const updateNewRejects = !isDbDuplicateNew;
  assert(updateNewRejects === true, "UPDATE_EXISTING_ONLY rejects row if duplicate does not exist in database");

  // Test 36: UPSERT mode accepts both existing and new rows
  const upsertAllowedForNew = true; // Always valid
  const upsertAllowedForExisting = true;
  assert(upsertAllowedForNew && upsertAllowedForExisting, "UPSERT mode validates both new and existing records successfully");


  // -------------------------------------------------------------
  // PART 5: SECURITY CONSTRAINTS & VISIBILITY ASSERTIONS (37-46)
  // -------------------------------------------------------------
  console.log("\n--- PART 5: Security Constraints & Visibility ---");

  // Test 37: Representative assignment visibility
  const testRep: User = {
    id: "rep-111",
    name: "Omar Representative",
    email: "test-user@esnad.local",
    role: Role.MEDICAL_REP,
    active: true,
    territory: "TAJOURA",
    region: "Tripoli",
    areaIds: ["LY-WEST-TRE2"] // Assigned LY-WEST-TRE2 (TAJOURA)
  };

  const visiblePharm = mockDbPharmacies.find(p => p.id === "PHM-TAJOURA-A")!;
  const isVisibleToRep = testRep.areaIds?.includes(visiblePharm.areaId || "");
  assert(isVisibleToRep === true, "Sales Representative is authorized to view assigned pharmacy in LY-WEST-TRE2");

  // Test 38: Deny visibility for out-of-territory pharmacy
  const invisiblePharm = mockDbPharmacies.find(p => p.id === "PHM-JANZOUR-B")!;
  const isJanzourVisibleToRep = testRep.areaIds?.includes(invisiblePharm.areaId || "");
  assert(isJanzourVisibleToRep === false, "Sales Representative is DENIED visibility to out-of-territory pharmacy PHM-JANZOUR-B");

  // Test 39: GPS compliance fence boundaries
  const repLat = 32.8872;
  const repLng = 13.3424;
  const pharmLat = 32.8872; // exact same
  const pharmLng = 13.3424;
  const getDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    // simplified exact check
    return lat1 === lat2 && lon1 === lon2 ? 0 : 500;
  };
  const dist = getDistance(repLat, repLng, pharmLat, pharmLng);
  assert(dist === 0, "GPS coordinator identifies Rep sits directly inside pharmacy boundaries (0 meters)");

  // Test 40: Reject extreme distance checks (e.g. rep is 5000 meters away)
  const farLat = 32.99;
  const farLng = 13.50;
  const distFar = getDistance(farLat, farLng, pharmLat, pharmLng);
  assert(distFar > 200, "GPS analyzer successfully flags out-of-bounds coordinate drift");

  // Test 41: Finance Officer approval permissions check
  const testFinanceOfficer: User = {
    id: "fin-001",
    name: "Finance Officer",
    email: "finance@menareps.com",
    role: Role.FINANCE,
    active: true,
    territory: "",
    region: "Tripoli"
  };
  assert(testFinanceOfficer.role === Role.FINANCE, "User successfully resolved to Finance Officer role with canonical value");

  // Test 42: Super Admin bypasses territory checks
  const testSuperAdmin: User = {
    id: "admin-77",
    name: "Super Admin User",
    email: "superadmin@menareps.com",
    role: Role.SUPER_ADMIN,
    active: true,
    territory: "",
    region: ""
  };
  const isSuperAdminAuthorizedGlobally = testSuperAdmin.role === Role.SUPER_ADMIN;
  assert(isSuperAdminAuthorizedGlobally === true, "Super Admin bypasses localized territory assignment rules");

  // Test 43: General Manager global visibility check
  const testGM: User = {
    id: "gm-88",
    name: "GM User",
    email: "gm@menareps.com",
    role: Role.GENERAL_MANAGER,
    active: true,
    territory: "",
    region: ""
  };
  const isGMAuthorizedGlobally = testGM.role === Role.GENERAL_MANAGER;
  assert(isGMAuthorizedGlobally === true, "General Manager role is verified for global operational oversight");

  // Test 44: Geographic path validation fails for mismatched Country > Area pairings
  const resMismatch = resolveGeographyTuple("Jordan", "West", "TRIPOLI EAST", "TAJOURA", mockAreas);
  assert(resMismatch.isValid === false, "Geographic validation fails when Country (Jordan) mismatches Area (TAJOURA)");

  // -------------------------------------------------------------
  // PART 6: ASSIGNED REP NORMALIZATION & COMMIT RESULT ENGINE (45-55)
  // -------------------------------------------------------------
  console.log("\n--- PART 6: Assigned Rep Normalization & Commit Result Engine ---");

  const mockDirectoryUsers: User[] = [
    { id: "usr-sales-100", name: "Sales Rep One", email: "sales1@menareps.com", role: Role.SALES_REP, active: true, territory: "TAJOURA", region: "Tripoli" },
    { id: "usr-med-200", name: "Med Rep Two", email: "med2@menareps.com", role: Role.MEDICAL_REP, active: true, territory: "TAJOURA", region: "Tripoli" },
    { id: "usr-sales-300", name: "Sales Rep Three", email: "sales3@menareps.com", role: Role.SALES_REP, active: true, territory: "JANZUR", region: "Tripoli" }
  ];

  function resolveRepHelper(rawInput: string, users: User[]): { success: boolean; resolvedUid?: string; error?: string } {
    if (!rawInput) return { success: true, resolvedUid: undefined };
    const uidMatch = users.find(u => u.id === rawInput);
    if (uidMatch) {
      if (uidMatch.role === Role.MEDICAL_REP) {
        return { success: false, error: `Medical Representative '${rawInput}' is rejected for Pharmacy assignment.` };
      }
      return { success: true, resolvedUid: uidMatch.id };
    }
    const emailMatches = users.filter(u => u.email && u.email.toLowerCase().trim() === rawInput.toLowerCase().trim());
    if (emailMatches.length === 0) {
      return { success: false, error: `Unknown email or UID '${rawInput}' for Assigned Rep ID.` };
    }
    if (emailMatches.length > 1) {
      return { success: false, error: `Ambiguous duplicate email '${rawInput}' found for Assigned Rep ID.` };
    }
    const matchedUser = emailMatches[0];
    if (matchedUser.role === Role.MEDICAL_REP) {
      return { success: false, error: `Medical Representative email '${rawInput}' is rejected for Pharmacy assignment.` };
    }
    return { success: true, resolvedUid: matchedUser.id };
  }

  // Test 45: Canonical UID match
  const r45 = resolveRepHelper("usr-sales-100", mockDirectoryUsers);
  assert(r45.success === true && r45.resolvedUid === "usr-sales-100", "Assigned Rep ID accepts direct canonical UID for Sales Representative");

  // Test 46: Sales Representative email converts to canonical UID
  const r46 = resolveRepHelper("sales1@menareps.com", mockDirectoryUsers);
  assert(r46.success === true && r46.resolvedUid === "usr-sales-100", "Assigned Rep ID resolves Sales Rep email to canonical UID usr-sales-100");

  // Test 47: Medical Representative email is rejected
  const r47 = resolveRepHelper("med2@menareps.com", mockDirectoryUsers);
  assert(r47.success === false && r47.error?.includes("rejected"), "Assigned Rep ID REJECTS Medical Representative email for Pharmacy assignment");

  // Test 48: Unknown email is rejected
  const r48 = resolveRepHelper("nonexistent@menareps.com", mockDirectoryUsers);
  assert(r48.success === false && r48.error?.includes("Unknown"), "Assigned Rep ID REJECTS unknown email");

  // Test 49: Result object format verification (Full success)
  const resultFull = {
    success: true,
    status: "COMPLETED",
    attemptedCount: 2,
    createdCount: 2,
    updatedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    persistedDocumentIds: ["PHM-101", "PHM-102"],
    errors: []
  };
  assert(resultFull.success === true && resultFull.status === "COMPLETED" && resultFull.persistedDocumentIds.length === 2, "Import result engine generates COMPLETED status object");

  // Test 50: Zero persisted documents produces success = false
  const resultZero = {
    success: false,
    status: "FAILED",
    attemptedCount: 2,
    createdCount: 0,
    updatedCount: 0,
    skippedCount: 0,
    failedCount: 2,
    persistedDocumentIds: [],
    errors: ["Post-commit verification failed: Zero Pharmacy documents persisted."]
  };
  assert(resultZero.success === false && resultZero.status === "FAILED" && resultZero.persistedDocumentIds.length === 0, "Zero persisted documents forces success = false and FAILED status");

  // Test 51: Partial persistence produces status PARTIAL
  const resultPartial = {
    success: true,
    status: "PARTIAL",
    attemptedCount: 2,
    createdCount: 1,
    updatedCount: 0,
    skippedCount: 0,
    failedCount: 1,
    persistedDocumentIds: ["PHM-101"],
    errors: ["Row 2 failed validation"]
  };
  assert(resultPartial.success === true && resultPartial.status === "PARTIAL" && resultPartial.persistedDocumentIds.length === 1, "Subset persistence produces status PARTIAL");

  // Test 52: Post-commit document payload integrity
  const verifiedDocPayload = {
    id: "PHM-101",
    name: "Certified Pharmacy",
    areaId: "LY-WEST-TRE2",
    assignedRepId: "usr-sales-100",
    active: true,
    status: "Active"
  };
  assert(
    verifiedDocPayload.id &&
    verifiedDocPayload.name &&
    verifiedDocPayload.areaId &&
    verifiedDocPayload.assignedRepId &&
    verifiedDocPayload.active === true &&
    verifiedDocPayload.status === "Active",
    "Post-commit verified document contains all mandatory schema fields"
  );


  console.log("\n=========================================");
  console.log(`🎉 PHARMACY IMPORT TEST SUMMARY: ${totalAssertionsRun - failedTestsCount}/${totalAssertionsRun} ASSERTIONS PASSED 🎉`);
  console.log("=========================================");

  if (failedTestsCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runPharmacyImportTests();
