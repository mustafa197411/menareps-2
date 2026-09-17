import { assert } from "console";
import { 
  resolveEffectiveTargetVersion, 
  TargetVersionError 
} from "./productTargetService";
import { ProductTargetPlan, TargetStatus } from "../types";

console.log("=================================================================");
console.log("RUNNING PRODUCT SALES TARGET RESOLVER UNIT TESTS (WP4.1H.2)");
console.log("=================================================================");

let totalTests = 0;
let passedTests = 0;

function runTest(description: string, testFn: () => void) {
  totalTests++;
  try {
    testFn();
    passedTests++;
    console.log(`[PASS] ${description}`);
  } catch (err: any) {
    console.error(`[FAIL] ${description}`);
    console.error(err);
  }
}

// Helper to build a plan mock
function mockPlan(fields: Partial<ProductTargetPlan>): ProductTargetPlan {
  return {
    planId: fields.planId || "PTP::LY::2026::V1",
    countryId: fields.countryId || "Libya",
    year: fields.year || 2026,
    currencyCode: "USD",
    monthlyDistributionMethod: "EQUAL_WITHIN_QUARTER",
    status: fields.status || TargetStatus.ACTIVE,
    version: fields.version || 1,
    active: fields.active !== undefined ? fields.active : true,
    createdAt: new Date().toISOString(),
    createdBy: "admin@example.com",
    updatedAt: new Date().toISOString(),
    updatedBy: "admin@example.com",
    effectiveFrom: fields.effectiveFrom,
    effectiveTo: fields.effectiveTo
  };
}

// ---------------------------------------------------------
// 1. Valid Matching cases
// ---------------------------------------------------------
runTest("Case 1: Matches single ACTIVE plan with open upper bound (null effectiveTo)", () => {
  const versions = [
    mockPlan({ planId: "V1", effectiveFrom: "2026-01-01", status: TargetStatus.ACTIVE })
  ];
  const result = resolveEffectiveTargetVersion({ versions, eventDate: "2026-05-15" });
  if (result.planId !== "V1") throw new Error("Expected match to be V1");
});

runTest("Case 2: Matches appropriate active/superseded intervals in sequence", () => {
  const versions = [
    mockPlan({ planId: "V1", effectiveFrom: "2026-01-01", effectiveTo: "2026-07-01", status: TargetStatus.SUPERSEDED }),
    mockPlan({ planId: "V2", effectiveFrom: "2026-07-01", status: TargetStatus.ACTIVE })
  ];

  // June 30 matches V1
  const matchJune = resolveEffectiveTargetVersion({ versions, eventDate: "2026-06-30" });
  if (matchJune.planId !== "V1") throw new Error("June 30 should match V1");

  // July 1 matches V2
  const matchJuly = resolveEffectiveTargetVersion({ versions, eventDate: "2026-07-01" });
  if (matchJuly.planId !== "V2") throw new Error("July 1 should match V2");
});

// ---------------------------------------------------------
// 2. Exception/Error cases
// ---------------------------------------------------------
runTest("Case 3: Throws INVALID_EFFECTIVE_DATE on bad date string format", () => {
  const versions = [
    mockPlan({ planId: "V1", effectiveFrom: "2026-01-01", status: TargetStatus.ACTIVE })
  ];

  try {
    resolveEffectiveTargetVersion({ versions, eventDate: "2026/05/15" });
    throw new Error("Should have failed on bad format");
  } catch (err: any) {
    if (err.code !== "INVALID_EFFECTIVE_DATE") {
      throw new Error(`Expected INVALID_EFFECTIVE_DATE but got ${err.code}`);
    }
  }
});

runTest("Case 4: Throws TARGET_VERSION_NOT_EFFECTIVE if no active/superseded plans are provided", () => {
  const versions = [
    mockPlan({ planId: "V1", effectiveFrom: "2026-01-01", status: TargetStatus.DRAFT })
  ];

  try {
    resolveEffectiveTargetVersion({ versions, eventDate: "2026-05-15" });
    throw new Error("Should have failed since only DRAFT exists");
  } catch (err: any) {
    if (err.code !== "TARGET_VERSION_NOT_EFFECTIVE") {
      throw new Error(`Expected TARGET_VERSION_NOT_EFFECTIVE but got ${err.code}`);
    }
  }
});

runTest("Case 5: Throws TARGET_VERSION_OVERLAP on overlapping ranges", () => {
  const versions = [
    mockPlan({ planId: "V1", effectiveFrom: "2026-01-01", effectiveTo: "2026-08-01", status: TargetStatus.SUPERSEDED }),
    mockPlan({ planId: "V2", effectiveFrom: "2026-07-01", status: TargetStatus.ACTIVE })
  ];

  try {
    resolveEffectiveTargetVersion({ versions, eventDate: "2026-05-15" });
    throw new Error("Should have detected overlapping intervals");
  } catch (err: any) {
    if (err.code !== "TARGET_VERSION_OVERLAP") {
      throw new Error(`Expected TARGET_VERSION_OVERLAP but got ${err.code}`);
    }
  }
});

runTest("Case 6: Throws TARGET_VERSION_GAP when requested date is in year but has no coverage", () => {
  const versions = [
    mockPlan({ planId: "V1", effectiveFrom: "2026-01-01", effectiveTo: "2026-06-01", status: TargetStatus.SUPERSEDED })
  ];

  try {
    resolveEffectiveTargetVersion({ versions, eventDate: "2026-08-15" });
    throw new Error("Should have detected target version gap");
  } catch (err: any) {
    if (err.code !== "TARGET_VERSION_GAP") {
      throw new Error(`Expected TARGET_VERSION_GAP but got ${err.code}`);
    }
  }
});

runTest("Case 7: Throws TARGET_VERSION_NOT_EFFECTIVE if requesting a date outside target plans' year", () => {
  const versions = [
    mockPlan({ planId: "V1", effectiveFrom: "2026-01-01", status: TargetStatus.ACTIVE })
  ];

  try {
    resolveEffectiveTargetVersion({ versions, eventDate: "2027-02-10" });
    throw new Error("Should have failed on external year");
  } catch (err: any) {
    if (err.code !== "TARGET_VERSION_NOT_EFFECTIVE") {
      throw new Error(`Expected TARGET_VERSION_NOT_EFFECTIVE but got ${err.code}`);
    }
  }
});

console.log("\n=================================================================");
console.log(`RESOLVER TESTS COMPLETED. PASSED: ${passedTests} / ${totalTests}`);
if (passedTests === totalTests) {
  console.log("ALL TARGET RESOLVER UNIT TESTS PASSED SUCCESSFULLY! [PASS]");
} else {
  console.error("RESOLVER UNIT TEST FAILURE DETECTED!");
  process.exit(1);
}
console.log("=================================================================");
