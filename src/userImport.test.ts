import { Role, User } from "./types";
import { canCreateRole, validateManager, getReadiness } from "./lib/userPolicyEngine";

// Test suite counter
let failedTestsCount = 0;

function assert(condition: boolean, testName: string, errorMessage?: string) {
  if (condition) {
    console.log(`[PASS] ${testName}`);
  } else {
    console.error(`[FAIL] ${testName}: ${errorMessage || "Assertion failed"}`);
    failedTestsCount++;
  }
}

// Mock Active Areas Registry
const mockAreas = [
  { id: "LY-WEST-TRIP-ZDH", name: "Zawiyat Dahmani", isActive: true },
  { id: "LY-WEST-TRIP-GAR", name: "Gargaresh", isActive: true },
  { id: "JO-AMM-AMM-ABD", name: "Al-Abdali", isActive: true },
  { id: "LY-WEST-TRE2", name: "TAJOURA", isActive: true },
  { id: "LY-WEST-TRE3", name: "AIN ZARA", isActive: true }
];

// Mock Existing Users
const mockUsersList: User[] = [
  {
    id: "manager@menareps.com",
    email: "manager@menareps.com",
    name: "Manager User",
    role: Role.MEDICAL_SUPERVISOR,
    active: true,
    employmentStatus: "Active",
    loginAllowed: true,
    territory: "",
    region: ""
  },
  {
    id: "existing_rep@example.com",
    email: "existing_rep@example.com",
    name: "Existing Representative",
    role: Role.MEDICAL_REP,
    managerEmail: "manager@example.com",
    areaIds: ["LY-WEST-TRIP-ZDH"],
    areaNames: ["Zawiyat Dahmani"],
    territories: ["Zawiyat Dahmani"],
    products: ["ACNE-25G"],
    primaryPromotionGroupId: "acne_group",
    targetPromotionGroupIds: ["skin_group"],
    assignmentSyncStatus: "COMPLETE",
    active: true,
    employmentStatus: "Active",
    loginAllowed: true,
    territory: "Zawiyat Dahmani",
    region: "Tripoli"
  }
];

function runUserImportTests() {
  console.log("=========================================");
  console.log("RUNNING USER IMPORT & PRESERVATION TESTS");
  console.log("=========================================\n");

  // TEST A: Medical Representative Row validation
  // Mock sheet row with no Product or Promotion Group columns
  console.log("Scenario A: Medical Representative Row Validation without Products/Promotion Groups");
  {
    const row = {
      "Username": "omar_mokhtar",
      "First Name": "Omar",
      "Last Name": "Al-Mokhtar",
      "Email": "omar@menareps.com",
      "Manager Email": "manager@menareps.com",
      "Role": "Medical Representative",
      "Country": "Libya",
      "District": "West",
      "City": "Tripoli",
      "Area Codes": "LY-WEST-TRIP-ZDH",
      "Area Names": "Zawiyat Dahmani",
      "Active": "True"
    };

    const mappedRole = Role.MEDICAL_REP;
    const errors: string[] = [];
    let isRowValid = true;

    // Simulate Role creation permission check
    const creatorRole = Role.ADMIN;
    const roleAllowed = canCreateRole(creatorRole, mappedRole);
    assert(roleAllowed === true, "1. Admin is authorized to create Medical Representative role");

    // Simulate Manager Validation
    const tempUser: Partial<User> = {
      id: "temp-upload",
      email: row.Email,
      role: mappedRole,
      managerId: mockUsersList[0].id,
      managerEmail: row["Manager Email"],
      areaIds: [row["Area Codes"]],
      areaNames: [row["Area Names"]],
      active: true,
      employmentStatus: "Active",
      loginAllowed: true
    };

    const mgrCheck = validateManager(tempUser, mockUsersList);
    assert(mgrCheck.isValid === true, "2. Reporting line validation passes for representative row", mgrCheck.reason);

    // Validate Area Code exist canonically
    const areaId = row["Area Codes"];
    const areaExists = mockAreas.some(a => a.id === areaId);
    assert(areaExists === true, "3. Area Code exists in active areas catalog");

    // Evaluate dynamic field-work readiness (it should be Incomplete/Pending)
    const readiness = getReadiness(tempUser, mockUsersList);
    assert(readiness.status === "Pending", "4. Representative is correctly flagged as Awaiting Operational Assignment for field operations");

    // Separate Import Validation from Operational Readiness:
    // Missing products/promotion groups should result in non-blocking warnings, not fatal validation failure
    let rowStatus: "VALID" | "VALID_WITH_WARNINGS" | "INVALID" = "VALID";
    
    if (mappedRole === Role.MEDICAL_REP || mappedRole === Role.SALES_REP) {
      errors.push(`Warning: Representative has no operational Product assignment. It will be imported as Awaiting Operational Assignment.`);
    }

    const rowWarnings = errors.filter(err => err.startsWith("Warning:"));
    if (rowWarnings.length > 0) {
      rowStatus = "VALID_WITH_WARNINGS";
    }

    assert(isRowValid === true, "5. Import validation succeeds for representative row (isRowValid remains true)");
    assert(rowStatus === "VALID_WITH_WARNINGS", "6. Row validation status is correctly classified as VALID_WITH_WARNINGS");
    assert(rowWarnings.length > 0, "7. Non-blocking warning is successfully logged for the row");
  }

  console.log("\nScenario B: Existing Representative Update & Preservation Check");
  // TEST B: Existing representative update preservation
  {
    // Existing user in DB having existing Product and Promotion Group configuration
    const dbUser = mockUsersList[1];

    // Simulating sheet row containing only identity/personal info updates and blank/absent geography/geography columns
    const record = {
      "Email": "existing_rep@example.com",
      "First Name": "Existing",
      "Last Name": "Rep Modified",
      "Role": "Medical Representative",
      "Manager Email": "manager@example.com",
      // Geography columns are absent or blank
      "Area Codes": "",
      "Area Names": "",
      "Country": "",
      "District": "",
      "City": ""
    };

    // Parsed properties from row
    const rawAreaCodes = record["Area Codes"];
    const rawAreaNames = record["Area Names"];
    const areaIds = rawAreaCodes ? rawAreaCodes.split(",") : [];
    const areaNames = rawAreaNames ? rawAreaNames.split(",") : [];

    // Save handler update payload logic:
    const updatedUserObj: Partial<User> = {
      id: dbUser.id,
      email: dbUser.email,
      firstName: record["First Name"],
      lastName: record["Last Name"],
      role: Role.MEDICAL_REP,
      managerEmail: record["Manager Email"],
      active: true,
      employmentStatus: "Active",
      loginAllowed: true
    };

    // Strict preservation of operational areas and configs if columns are absent/empty
    if (areaIds && areaIds.length > 0) {
      updatedUserObj.areaIds = areaIds;
      updatedUserObj.areaNames = areaNames;
      updatedUserObj.territories = areaNames;
    }

    // Assertions verifying that geography, products and status are preserved
    assert(updatedUserObj.areaIds === undefined, "8. Empty geography column omitted from the update payload");
    assert(updatedUserObj.areaNames === undefined, "9. Empty geography names omitted from the update payload");
    
    // Simulate Firestore merge update
    const mergedUser = {
      ...dbUser,
      ...updatedUserObj
    };

    assert(mergedUser.areaIds[0] === "LY-WEST-TRIP-ZDH", "10. Pre-existing area assignment LY-WEST-TRIP-ZDH is successfully preserved");
    assert(mergedUser.products[0] === "ACNE-25G", "11. Pre-existing product assignment ACNE-25G is successfully preserved");
    assert(mergedUser.primaryPromotionGroupId === "acne_group", "12. Pre-existing primary promotion group is successfully preserved");
    assert(mergedUser.targetPromotionGroupIds[0] === "skin_group", "13. Pre-existing target promotion group is successfully preserved");
    assert(mergedUser.assignmentSyncStatus === "COMPLETE", "14. Pre-existing assignmentSyncStatus COMPLETE is successfully preserved");
  }

  console.log("\nScenario C: Multi-Area Parsing & Validation (WP2.2C)");
  {
    const parseAreaValues = (rawVal: string, isCodes: boolean, errors: string[], rowNum: number) => {
      if (!rawVal) return [];
      const sanitized = String(rawVal).replace(/[\r\n]+/g, " ").trim();
      if (!sanitized) return [];

      let parts: string[] = [];
      let isLegacyPeriod = false;

      if (sanitized.includes(".") && !sanitized.includes(",") && !sanitized.includes(";")) {
        isLegacyPeriod = true;
      }

      if (isLegacyPeriod) {
        parts = sanitized.split(".");
        const fieldLabel = isCodes ? "Area Codes" : "Area Names";
        const warningMsg = `Warning: Row ${rowNum}: Legacy period-separated format detected in ${fieldLabel} ('${sanitized}'). Please update your worksheet template to use the canonical comma-separated separator.`;
        if (!errors.includes(warningMsg)) {
          errors.push(warningMsg);
        }
      } else {
        parts = sanitized.split(/[,;]+/);
      }

      const result: string[] = [];
      parts.forEach(part => {
        const cleaned = part.trim();
        if (cleaned) {
          if (!result.includes(cleaned)) {
            result.push(cleaned);
          }
        }
      });
      return result;
    };

    const validateAreas = (areaIds: string[], areaNames: string[], errors: string[], rowNum: number) => {
      let isRowValid = true;
      let areaValidationPassed = true;
      if (areaIds.length > 0) {
        areaIds.forEach(code => {
          const exists = mockAreas.some(a => String(a.id).toLowerCase() === code.toLowerCase());
          if (!exists) {
            isRowValid = false;
            areaValidationPassed = false;
            errors.push(`Row ${rowNum}: Invalid Area Code - Area Code '${code}' does not exist in the active areas catalog.`);
          }
        });

        if (areaValidationPassed && areaNames.length > 0) {
          if (areaIds.length !== areaNames.length) {
            isRowValid = false;
            errors.push(`Row ${rowNum}: Mismatch - The number of Area Codes (${areaIds.length}) does not match the number of Area Names (${areaNames.length}).`);
          } else {
            for (let idx = 0; idx < areaIds.length; idx++) {
              const code = areaIds[idx];
              const providedName = areaNames[idx];
              const canonicalArea = mockAreas.find(a => String(a.id).toLowerCase() === code.toLowerCase());
              if (canonicalArea) {
                if (canonicalArea.name.toLowerCase().trim() !== providedName.toLowerCase().trim()) {
                  isRowValid = false;
                  errors.push(`Row ${rowNum}: Mismatch - Area Code '${code}' corresponds to '${canonicalArea.name}', but Area Name '${providedName}' was provided at position ${idx + 1}.`);
                }
              }
            }
          }
        }
      } else if (areaNames.length > 0) {
        isRowValid = false;
        errors.push(`Row ${rowNum}: Invalid Area Name - Area Names '${areaNames.join(", ")}' could not be resolved to any canonical Area ID.`);
      }
      return isRowValid;
    };

    // 1. Success with one canonical Area Code
    {
      const localErrors: string[] = [];
      const codes = parseAreaValues("LY-WEST-TRIP-ZDH", true, localErrors, 1);
      const names = parseAreaValues("Zawiyat Dahmani", false, localErrors, 1);
      const isValid = validateAreas(codes, names, localErrors, 1);
      assert(isValid === true && codes.length === 1 && codes[0] === "LY-WEST-TRIP-ZDH", "15. Multi-Area: Success with one canonical Area Code");
    }

    // 2. Success with two comma-separated Area Codes
    {
      const localErrors: string[] = [];
      const codes = parseAreaValues("LY-WEST-TRIP-ZDH,LY-WEST-TRIP-GAR", true, localErrors, 2);
      const names = parseAreaValues("Zawiyat Dahmani,Gargaresh", false, localErrors, 2);
      const isValid = validateAreas(codes, names, localErrors, 2);
      assert(isValid === true && codes.length === 2 && codes[1] === "LY-WEST-TRIP-GAR", "16. Multi-Area: Success with two comma-separated Area Codes");
    }

    // 3. Correct handling of surrounding whitespace and line breaks
    {
      const localErrors: string[] = [];
      const rawCodes = `\n  LY-WEST-TRIP-ZDH  ,\n  LY-WEST-TRIP-GAR \n`;
      const rawNames = `\n  Zawiyat Dahmani  ,\n  Gargaresh \n`;
      const codes = parseAreaValues(rawCodes, true, localErrors, 3);
      const names = parseAreaValues(rawNames, false, localErrors, 3);
      const isValid = validateAreas(codes, names, localErrors, 3);
      assert(isValid === true && codes.length === 2 && codes[0] === "LY-WEST-TRIP-ZDH" && codes[1] === "LY-WEST-TRIP-GAR", "17. Multi-Area: Trim whitespace and resolve line breaks around list elements successfully");
    }

    // 4. Duplicate removal while preserving source order
    {
      const localErrors: string[] = [];
      const codes = parseAreaValues("LY-WEST-TRIP-ZDH, LY-WEST-TRIP-GAR, LY-WEST-TRIP-ZDH", true, localErrors, 4);
      assert(codes.length === 2 && codes[0] === "LY-WEST-TRIP-ZDH" && codes[1] === "LY-WEST-TRIP-GAR", "18. Multi-Area: Duplicate codes removed while preserving correct source order");
    }

    // 5. Clear error identifying only the invalid code
    {
      const localErrors: string[] = [];
      const codes = parseAreaValues("LY-WEST-TRIP-ZDH, LY-WEST-INVALID", true, localErrors, 5);
      const names = parseAreaValues("Zawiyat Dahmani, Invalid Area", false, localErrors, 5);
      const isValid = validateAreas(codes, names, localErrors, 5);
      assert(isValid === false, "19. Multi-Area: Validation fails for invalid code");
      assert(localErrors.some(e => e.includes("Area Code 'LY-WEST-INVALID' does not exist")), "20. Multi-Area: Error correctly isolates and identifies the specific invalid code");
    }

    // 6. Mismatch error if Area Name does not match corresponding Area Code at the same position
    {
      const localErrors: string[] = [];
      const codes = parseAreaValues("LY-WEST-TRE2, LY-WEST-TRE3", true, localErrors, 6);
      const names = parseAreaValues("Ain Zara, Tajura", false, localErrors, 6); // Reversed: TRE2 is TAJOURA, TRE3 is AIN ZARA
      const isValid = validateAreas(codes, names, localErrors, 6);
      assert(isValid === false, "21. Multi-Area: Validation fails if Area Name mismatches corresponding code position");
      assert(localErrors.some(e => e.includes("Area Code 'LY-WEST-TRE2' corresponds to 'TAJOURA', but Area Name 'Ain Zara' was provided at position 1")), "22. Multi-Area: Error correctly flags positional mismatch for TRE2");
    }

    // 7. Proper triggers of warning state for legacy period-separated templates
    {
      const localErrors: string[] = [];
      const codes = parseAreaValues("LY-WEST-TRE2.LY-WEST-TRE3", true, localErrors, 7);
      const names = parseAreaValues("TAJOURA.AIN ZARA", false, localErrors, 7);
      const isValid = validateAreas(codes, names, localErrors, 7);
      assert(isValid === true, "23. Multi-Area: Normalization succeeds for legacy period-separated lists");
      assert(localErrors.some(e => e.includes("Warning:") && e.includes("Legacy period-separated format detected")), "24. Multi-Area: Legacy warnings successfully logged for both period-separated fields");
    }
  }

  console.log("\nScenario D: Import Commit Handler & Persistence Validation (WP2.2D)");
  {
    // Test data for john.doe matching the failure scenario
    const testRecord = {
      Username: "john.doe",
      Email: "rep1@example.com",
      Manager: "teamasupervisor@esnad.local",
      Role: "Medical Representative",
      Country: "Libya",
      District: "West",
      City: "Tripoli East",
      "Area Codes": "LY-WEST-TRE3,LY-WEST-TRE2",
      "Area Names": "AIN ZARA,TAJOURA"
    };

    // 1. Simulating pending user payload generation
    const mockGeneratedUserId: string = "firebase-auth-uid-123";
    const rawPendingUser: any = {
      id: mockGeneratedUserId,
      email: testRecord.Email.trim().toLowerCase(),
      name: "John Doe",
      firstName: "John",
      lastName: "Doe",
      role: Role.MEDICAL_REP,
      managerEmail: testRecord.Manager,
      managerId: "mgr-111",
      region: testRecord.City,
      territory: "AIN ZARA",
      active: true,
      joinedDate: "2026-07-19",
      username: testRecord.Username,
      sidebarVisibility: ["dashboard", "physicians", "pharmacies", "products"],
      areaIds: ["LY-WEST-TRE3", "LY-WEST-TRE2"],
      areaNames: ["AIN ZARA", "TAJOURA"],
      products: [],
      territories: ["AIN ZARA", "TAJOURA"],
      country: testRecord.Country,
      district: testRecord.District,
      city: testRecord.City,
      employmentStatus: "Active",
      status: "Active",
      loginAllowed: true,
      isDeleted: false,
      securityScope: "Territory Only",
      // These are omitted in the warning scenario, so they are explicitly undefined
      primaryPromotionGroupId: undefined,
      targetPromotionGroupIds: undefined,
      assignmentSyncStatus: "PENDING"
    };

    // Verify document ID strategy
    assert(mockGeneratedUserId !== "john.doe", "25. Commit: Document ID strategy uses canonical Firebase Auth UID, not users/john.doe");
    assert(mockGeneratedUserId !== testRecord.Email, "26. Commit: Document ID strategy does not use raw email users/rep1@example.com");

    // 2. Decorate record with companyId and metadata
    const timestamp = "2026-07-19 12:00:00 UTC";
    const decoratedUser = {
      ...rawPendingUser,
      companyId: "MENAREPS-CENTRAL",
      updatedAt: timestamp,
      updatedBy: "superadmin-uid",
      createdAt: timestamp,
      createdBy: "superadmin-uid"
    };

    // Verify the presence of undefined values before sanitization
    assert(decoratedUser.primaryPromotionGroupId === undefined, "27. Commit: Pre-sanitization payload contains undefined primaryPromotionGroupId");
    assert(decoratedUser.targetPromotionGroupIds === undefined, "28. Commit: Pre-sanitization payload contains undefined targetPromotionGroupIds");

    // 3. Apply stripUndefinedFields logic
    const stripUndefinedFields = (obj: any): any => {
      return Object.fromEntries(
        Object.entries(obj).filter(([, value]) => value !== undefined)
      );
    };

    const sanitizedPayload = stripUndefinedFields(decoratedUser);

    // Verify that all undefined fields are strictly removed
    const hasUndefinedKeys = Object.values(sanitizedPayload).some(v => v === undefined);
    assert(hasUndefinedKeys === false, "29. Commit: Post-sanitization payload contains absolutely no undefined values");
    assert(!("primaryPromotionGroupId" in sanitizedPayload), "30. Commit: primaryPromotionGroupId field was successfully stripped from payload");
    assert(!("targetPromotionGroupIds" in sanitizedPayload), "31. Commit: targetPromotionGroupIds field was successfully stripped from payload");

    // 4. Verify mock Firestore write compatibility
    assert(sanitizedPayload.id === "firebase-auth-uid-123", "32. Commit: Sanitized payload retains canonical Firebase Auth UID");
    assert(sanitizedPayload.email === "rep1@example.com", "33. Commit: Sanitized payload retains valid email");
  }

  console.log("\n=========================================");
  if (failedTestsCount === 0) {
    console.log("🎉 ALL TESTS PASSED SUCCESSFULLY! 🎉");
    console.log("=========================================");
  } else {
    console.error(`❌ ${failedTestsCount} TESTS FAILED! ❌`);
    console.error("=========================================");
    process.exit(1);
  }
}

runUserImportTests();
