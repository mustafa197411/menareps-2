import { getFirebaseAdminServices } from "./firebaseAdmin";
import { executePharmacyOrderCreate } from "./pharmacyOrderCreateService";
import { ENTERPRISE_WORKFLOW_TEMPLATE } from "../src/features/orders/orderWorkflowTemplate";

const actorUid = "uat-sales-rep-west-a";
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const codeOf = (result: unknown) => (result as { code?: string }).code;
const { db } = getFirebaseAdminServices();
if (process.env.FIREBASE_PROJECT_ID !== "demo-menareps-uat" || process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8089") throw new Error("WP98_EMULATOR_ISOLATION_REQUIRED");
const records: Array<[string, string, Record<string, unknown>]> = [
  ["users", actorUid, { id: actorUid, role: "Sales Representative", active: true, status: "Active", employmentStatus: "Active", loginAllowed: true, isDeleted: false, managerId: "uat-sales-supervisor" }],
  ["users", "uat-sales-supervisor", { id: "uat-sales-supervisor", role: "Sales Supervisor", active: true, status: "Active", employmentStatus: "Active", loginAllowed: true, isDeleted: false }],
  ["rolePermissions", "Sales Representative", { role: "Sales Representative", active: true, view: true, create: true }],
  ["countries", "LY", { id: "LY", active: true }],
  ["districts", "WEST", { id: "WEST", countryId: "LY", active: true }],
  ["cities", "TRIPOLI", { id: "TRIPOLI", countryId: "LY", districtId: "WEST", active: true }],
  ["areas", "WEST-A1", { id: "WEST-A1", countryId: "LY", districtId: "WEST", cityId: "TRIPOLI", active: true }],
  ["areas", "WEST-A2", { id: "WEST-A2", countryId: "LY", districtId: "WEST", cityId: "TRIPOLI", active: true }],
  ["userTerritoryAssignments", "TA-REP-A", { assignmentId: "TA-REP-A", userId: actorUid, countryId: "LY", districtId: "WEST", cityId: "TRIPOLI", areaId: "WEST-A1", active: true, status: "Active" }],
  ["products", "P-A", { id: "P-A", name: "Synthetic Product A", promotionGroupId: "PG-A", price: 7, stockQuantity: 5, active: true }],
  ["products", "P-B", { id: "P-B", name: "Synthetic Product B", promotionGroupId: "PG-B", price: 11, stockQuantity: 5, active: true }],
  ["userProductAssignments", "PA-REP-A", { assignmentId: "PA-REP-A", userId: actorUid, productId: "P-A", productGroupId: "PG-A", active: true, status: "Active" }],
  ["pharmacies", "PHARM-COMM-A", { id: "PHARM-COMM-A", name: "Synthetic In-Scope Pharmacy", active: true, status: "Active", areaId: "WEST-A1" }],
  ["pharmacies", "PHARM-COMM-OUT", { id: "PHARM-COMM-OUT", name: "Synthetic Out-of-Scope Pharmacy", active: true, status: "Active", areaId: "WEST-A2" }],
  ["marketSettings", "LY", { marketId: "LY", countryId: "LY", countryNameEn: "Synthetic Market", countryNameAr: "Synthetic", active: true, businessDocumentCode: "UT", currencyCode: "TST", currencySymbol: "T", symbolPosition: "before", decimalPlaces: 2, numeralLocale: "en", timezone: "Africa/Tripoli", dateFormat: "YYYY-MM-DD", timeFormat: "24h", weekStartDay: 1, workingWeekdays: [1, 2, 3, 4, 5], normalWorkdayStart: "08:00", normalWorkdayEnd: "16:00", checkInOpensAt: "07:30", lateToleranceMinutes: 15, autoCheckoutAt: "18:00", maximumWorkdayMinutes: 600 }],
  ["orderWorkflowTemplates", "ENTERPRISE_V1", { ...ENTERPRISE_WORKFLOW_TEMPLATE, createdBy: "WP98_EMULATOR", updatedBy: "WP98_EMULATOR" }],
];
for (const [collection, id, data] of records) await db.collection(collection).doc(id).set(data);

async function visit(id: string, pharmacyId: string, productId = "P-A", quantity: unknown = 2) {
  await db.collection("pharmacyVisits").doc(id).set({ id, status: "COMPLETED", repId: actorUid, createdBy: actorUid, pharmacyId, areaId: pharmacyId === "PHARM-COMM-OUT" ? "WEST-A2" : "WEST-A1", displayNumber: `UT-PV-2030-${id.slice(-6).padStart(6, "0")}`, order: { lines: [{ canonicalProductId: productId, quantity, unitPricePreview: 999999 }] }, createdAt: "2030-01-01T00:00:00.000Z" });
}

await visit("VISIT-VALID-1", "PHARM-COMM-A");
const valid = await executePharmacyOrderCreate(actorUid, { visitId: "VISIT-VALID-1" });
assert(valid.success, `valid order failed: ${JSON.stringify(valid)}`);
const order = (await db.collection("orders").doc("ORD_VISIT-VALID-1").get()).data()!;
assert(order.total === 14 && order.items[0].price === 7, "Product master price was not authoritative");
assert(order.currencyCode === "TST" && order.marketId === "LY" && order.countryId === "LY", "market/currency were not canonical");
assert(order.status === "PENDING_FINANCE_REVIEW" && order.stage === "FINANCE_REVIEW", "initial workflow state was not canonical");

await visit("VISIT-OUT-1", "PHARM-COMM-OUT");
assert(codeOf(await executePharmacyOrderCreate(actorUid, { visitId: "VISIT-OUT-1" })) === "PHARMACY_OUTSIDE_AUTHORIZED_AREA", "out-of-scope pharmacy was not denied");
await visit("VISIT-PRODUCT-1", "PHARM-COMM-A", "P-B");
assert(codeOf(await executePharmacyOrderCreate(actorUid, { visitId: "VISIT-PRODUCT-1" })) === "ORDER_PRODUCT_NOT_AUTHORIZED", "unauthorized Product was not denied");
await visit("VISIT-LINE-1", "PHARM-COMM-A", "P-A", 1.5);
assert(codeOf(await executePharmacyOrderCreate(actorUid, { visitId: "VISIT-LINE-1" })) === "ORDER_LINE_INVALID", "malformed line was not denied");
await visit("VISIT-STOCK-1", "PHARM-COMM-A", "P-A", 6);
assert(codeOf(await executePharmacyOrderCreate(actorUid, { visitId: "VISIT-STOCK-1" })) === "ORDER_QUANTITY_EXCEEDS_AUTHORIZED_AVAILABILITY", "quantity above current Product stockQuantity was not denied");
await db.collection("pharmacies").doc("PHARM-COMM-A").update({ active: false });
await visit("VISIT-INACTIVE-1", "PHARM-COMM-A");
assert(codeOf(await executePharmacyOrderCreate(actorUid, { visitId: "VISIT-INACTIVE-1" })) === "PHARMACY_INACTIVE_OR_MISSING", "inactive pharmacy was not denied");
await db.collection("pharmacies").doc("PHARM-COMM-A").update({ active: true });
await db.collection("orderWorkflowTemplates").doc("ENTERPRISE_V1").delete();
await visit("VISIT-WORKFLOW-1", "PHARM-COMM-A");
assert(codeOf(await executePharmacyOrderCreate(actorUid, { visitId: "VISIT-WORKFLOW-1" })) === "ORDER_WORKFLOW_CONFIGURATION_REQUIRED", "missing workflow did not fail closed");

console.log("WP98_PHARMACY_ORDER_CREATE_EMULATOR=PASS");
