import assert from "node:assert/strict";
import { 
  Role, 
  normalizeRole, 
  User, 
  Pharmacy, 
  Product, 
  UserTerritoryAssignment, 
  UserProductAssignment 
} from "./types";
import { 
  applySecurityScope, 
  isUserOperational, 
  setGlobalSecurityContext
} from "./lib/securityEngine";
import { getReadiness } from "./lib/userPolicyEngine";
import { filterBySecurity } from "./lib/alignmentService";

console.log("=========================================================");
console.log("RUNNING AUTOMATED TEST SUITE FOR WP5.2F.2 UAT");
console.log("=========================================================");

// 1. Identity Verification
const salesSupervisor: User = {
  id: "sales-sup-1",
  uid: "sales-sup-1",
  email: "salessup@esnad.local",
  name: "Sales Supervisor 1",
  role: Role.SALES_SUPERVISOR,
  active: true,
  employmentStatus: "Active",
  loginAllowed: true,
  areaIds: ["LY-WEST-TRE2"],
  areaNames: ["TAJOURA"],
  country: "Libya",
  region: "West",
  district: "West",
  city: "TRIPOLI EAST",
  territory: "TAJOURA"
};

const salesRep: User = {
  id: "cQt7jjLOaHPgBmGCWzdjZm3pojo2",
  uid: "cQt7jjLOaHPgBmGCWzdjZm3pojo2",
  email: "test-user1@esnad.local",
  name: "Sales Representative 1",
  role: Role.SALES_REP,
  active: true,
  employmentStatus: "Active",
  loginAllowed: true,
  areaIds: ["LY-WEST-TRE2"],
  areaNames: ["TAJOURA"],
  country: "Libya",
  region: "West",
  district: "West",
  city: "TRIPOLI EAST",
  territory: "TAJOURA",
  managerId: "sales-sup-1",
  primaryPromotionGroupId: "PG-WEST-1",
  products: ["PROD-2609"]
};

const medicalRep: User = {
  id: "TXiVgAk78XSViCB5uSSmuuxfY9n2",
  uid: "TXiVgAk78XSViCB5uSSmuuxfY9n2",
  email: "medtajura@esnad.local",
  name: "MED TAJURA",
  role: Role.MEDICAL_REP,
  active: true,
  employmentStatus: "Active",
  loginAllowed: true,
  areaIds: ["LY-WEST-TRE2"],
  areaNames: ["TAJOURA"],
  country: "Libya",
  region: "West",
  district: "West",
  city: "TRIPOLI EAST",
  territory: "TAJOURA"
};

const superAdmin: User = {
  id: "d4bmu9CnB1eOInT3cT3t9xdAFmh2",
  uid: "d4bmu9CnB1eOInT3cT3t9xdAFmh2",
  email: "test-admin-99@menareps.com",
  name: "Super Admin",
  role: Role.SUPER_ADMIN,
  active: true,
  employmentStatus: "Active",
  loginAllowed: true,
  country: "Libya",
  region: "West",
  district: "West",
  city: "TRIPOLI EAST",
  territory: "TAJOURA"
};

// Verify normalizeRole
assert.equal(normalizeRole(salesRep.role), Role.SALES_REP, "Sales Rep role must normalize to Role.SALES_REP");
assert.equal(normalizeRole(medicalRep.role), Role.MEDICAL_REP, "Med Rep role must normalize to Role.MEDICAL_REP");
assert.equal(normalizeRole(superAdmin.role), Role.SUPER_ADMIN, "Admin role must normalize to Role.SUPER_ADMIN");
console.log("✓ Step 1: User Identity & Role Normalization Passed");

// 2. Territory & Product Assignments
const territoryAssignments: UserTerritoryAssignment[] = [
  {
    assignmentId: "TA_cQt7jjLOaHPgBmGCWzdjZm3pojo2_LY-WEST-TRE2",
    userId: "cQt7jjLOaHPgBmGCWzdjZm3pojo2",
    areaId: "LY-WEST-TRE2",
    territoryId: "LY-WEST-TRE2",
    territoryName: "TAJOURA",
    status: "Active",
    createdAt: "2026-07-22T00:00:00Z"
  } as any
];

const productAssignments: UserProductAssignment[] = [
  {
    assignmentId: "PA_cQt7jjLOaHPgBmGCWzdjZm3pojo2_PROD-2609",
    userId: "cQt7jjLOaHPgBmGCWzdjZm3pojo2",
    productId: "PROD-2609",
    status: "Active",
    createdAt: "2026-07-22T00:00:00Z"
  } as any
];

// Products for testing
const testProducts: Product[] = [
  {
    id: "PROD-2609",
    name: "HYPRPIGMENTATION GEL 30G",
    code: "PROD-2609",
    sku: "PROD-2609",
    brand: "DermaCare",
    status: "Active"
  } as any,
  {
    id: "PROD-9999",
    name: "UNASSIGNED PRODUCT",
    code: "PROD-9999",
    sku: "PROD-9999",
    brand: "GenericBrand",
    status: "Active"
  } as any
];

// Set security context
setGlobalSecurityContext(salesRep, [salesRep, salesSupervisor, medicalRep, superAdmin], territoryAssignments, productAssignments, testProducts);

// Operational check
const report = getReadiness(salesRep, [salesRep, salesSupervisor, medicalRep, superAdmin]);
console.log("Readiness Report:", JSON.stringify(report, null, 2));

const isOp = isUserOperational(salesRep, territoryAssignments, productAssignments);
assert.equal(isOp, true, "Sales Rep must resolve as operational");
console.log("✓ Step 2: User Operational Readiness Passed");

// 3. Pharmacy Matrix Test Cases
const testPharmacies: (Pharmacy & { isDeleted?: boolean })[] = [
  // A. Active Pharmacy in TAJOURA with assignedRepId = test-user1 UID
  {
    id: "PHAR-A",
    name: "Tajoura Central Pharmacy A",
    territory: "TAJOURA",
    areaId: "LY-WEST-TRE2",
    area: "TAJOURA",
    city: "TRIPOLI EAST",
    district: "West",
    region: "West",
    country: "Libya",
    latitude: 32.8870,
    longitude: 13.1910,
    outstandingBalance: 500,
    address: "Tajoura Main St",
    active: true,
    assignedRepId: "cQt7jjLOaHPgBmGCWzdjZm3pojo2"
  },
  // B. Active Pharmacy in TAJOURA with blank assignedRepId
  {
    id: "PHAR-B",
    name: "Tajoura Community Pharmacy B",
    territory: "TAJOURA",
    areaId: "LY-WEST-TRE2",
    area: "TAJOURA",
    city: "TRIPOLI EAST",
    district: "West",
    region: "West",
    country: "Libya",
    latitude: 32.8880,
    longitude: 13.1920,
    outstandingBalance: 0,
    address: "Tajoura Coastal Rd",
    active: true,
    assignedRepId: ""
  },
  // C. Active Pharmacy in TAJOURA assigned to another Sales Representative
  {
    id: "PHAR-C",
    name: "Tajoura Al-Amal Pharmacy C",
    territory: "TAJOURA",
    areaId: "LY-WEST-TRE2",
    area: "TAJOURA",
    city: "TRIPOLI EAST",
    district: "West",
    region: "West",
    country: "Libya",
    latitude: 32.8890,
    longitude: 13.1930,
    outstandingBalance: 1200,
    address: "Tajoura Market Sq",
    active: true,
    assignedRepId: "other-sales-rep-uid-123"
  },
  // D. Active Pharmacy outside TAJOURA
  {
    id: "PHAR-D",
    name: "Janzur Care Pharmacy D",
    territory: "JANZUR",
    areaId: "LY-WEST-JNZ1",
    area: "JANZUR",
    city: "TRIPOLI WEST",
    district: "West",
    region: "West",
    country: "Libya",
    latitude: 32.8200,
    longitude: 13.0100,
    outstandingBalance: 0,
    address: "Janzur Highway",
    active: true,
    assignedRepId: "cQt7jjLOaHPgBmGCWzdjZm3pojo2" // Assigned but out of area!
  },
  // E. Pharmacy in TAJOURA with isDeleted = true
  {
    id: "PHAR-E",
    name: "Tajoura Deleted Pharmacy E",
    territory: "TAJOURA",
    areaId: "LY-WEST-TRE2",
    area: "TAJOURA",
    city: "TRIPOLI EAST",
    district: "West",
    region: "West",
    country: "Libya",
    latitude: 32.8875,
    longitude: 13.1915,
    outstandingBalance: 0,
    address: "Tajoura Old St",
    active: true,
    isDeleted: true,
    assignedRepId: "cQt7jjLOaHPgBmGCWzdjZm3pojo2"
  },
  // F. Pharmacy in TAJOURA with active = false
  {
    id: "PHAR-F",
    name: "Tajoura Inactive Pharmacy F",
    territory: "TAJOURA",
    areaId: "LY-WEST-TRE2",
    area: "TAJOURA",
    city: "TRIPOLI EAST",
    district: "West",
    region: "West",
    country: "Libya",
    latitude: 32.8878,
    longitude: 13.1918,
    outstandingBalance: 0,
    address: "Tajoura Closed Alley",
    active: false,
    status: "Inactive",
    assignedRepId: "cQt7jjLOaHPgBmGCWzdjZm3pojo2"
  }
];

// Test Sales Rep Pharmacy Visibility
const salesRepPharmacies = applySecurityScope(salesRep, testPharmacies, territoryAssignments, productAssignments);
const salesRepVisibleIds = new Set(salesRepPharmacies.map((p: any) => p.id));

assert.equal(salesRepVisibleIds.has("PHAR-A"), true, "Case A: Active Pharmacy in TAJOURA assigned to test-user1 must be VISIBLE");
assert.equal(salesRepVisibleIds.has("PHAR-B"), true, "Case B: Active Pharmacy in TAJOURA with blank assignedRepId must be VISIBLE");
assert.equal(salesRepVisibleIds.has("PHAR-C"), true, "Case C: Active Pharmacy in TAJOURA assigned to another Sales Rep must be VISIBLE (Area-based)");
assert.equal(salesRepVisibleIds.has("PHAR-D"), false, "Case D: Active Pharmacy outside TAJOURA must be HIDDEN (Area-scope Defense-in-Depth)");
assert.equal(salesRepVisibleIds.has("PHAR-E"), false, "Case E: Pharmacy in TAJOURA with isDeleted = true must be HIDDEN");
assert.equal(salesRepVisibleIds.has("PHAR-F"), false, "Case F: Pharmacy in TAJOURA with active = false must be HIDDEN");

console.log("✓ Step 3: Sales Representative Pharmacy List Visibility Matrix Passed (3 Visible, 3 Hidden)");

// 4. Medical Representative Regression Test
const medRepPharmacies = applySecurityScope(medicalRep, testPharmacies, territoryAssignments, productAssignments);
assert.equal(medRepPharmacies.length, 0, "Medical Representatives MUST NOT see any pharmacies");
console.log("✓ Step 4: Medical Representative Pharmacy Regression Passed (0 Pharmacies)");

// 5. Super Admin Regression Test
const adminPharmacies = applySecurityScope(superAdmin, testPharmacies, territoryAssignments, productAssignments);
assert.ok(adminPharmacies.length >= 4, "Super Admin MUST see all active non-deleted Pharmacies globally");
console.log("✓ Step 5: Super Admin Pharmacy Regression Passed (Global Access Verified)");

// 6. Product Visibility Test
const salesRepProducts = applySecurityScope(salesRep, testProducts, territoryAssignments, productAssignments);
assert.equal(salesRepProducts.length, 1, "Sales Rep should see exactly assigned product PROD-2609");
assert.equal(salesRepProducts[0].id, "PROD-2609", "Assigned product must be PROD-2609");
console.log("✓ Step 6: Product Assignment Scope Passed");

console.log("=========================================================");
console.log("ALL AUTOMATED UAT VERIFICATION TESTS PASSED SUCCESSFULLY!");
console.log("=========================================================");
