import { uatEnvironment } from "./constants";

Object.assign(process.env, uatEnvironment("wp98-commercial-fixture-contract-secret-000000000000000000000000"));
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
delete process.env.FIREBASE_TOKEN;
const { assertProductionIsolation } = await import("./preflight");
const { seedEmulatorState } = await import("./seed");
const { getFirebaseAdminServices } = await import("../../../server/firebaseAdmin");
const { isRuntimeOrderWorkflowTemplate } = await import("../../../src/features/orders/orderWorkflowTemplate");
assertProductionIsolation();
await seedEmulatorState();
const { db } = getFirebaseAdminServices();
const [profile, territory, primaryGroup, template, pharmacy, product, assignment, operationsProfile, operationsCountry] = await Promise.all([
  db.collection("users").doc("uat-sales-rep-west-a").get(),
  db.collection("userTerritoryAssignments").doc("TA_uat-sales-rep-west-a_WEST-A1").get(),
  db.collection("productPromotionGroups").doc("PG-A").get(),
  db.collection("orderWorkflowTemplates").doc("ENTERPRISE_V1").get(),
  db.collection("pharmacies").doc("PHARM-COMM-A").get(),
  db.collection("products").doc("P-A").get(),
  db.collection("userProductAssignments").doc("PA_uat-sales-rep-west-a_P-A").get(),
  db.collection("users").doc("uat-order-operations-officer").get(),
  db.collection("countries").doc("LY").get(),
]);
const profileData = profile.data();
const territoryData = territory.data();
const primaryGroupData = primaryGroup.data();
const productData = product.data();
const assignmentData = assignment.data();
const pharmacyData = pharmacy.data();
const operationsProfileData = operationsProfile.data();
if (
  !profile.exists
  || profileData?.active !== true
  || profileData?.status !== "Active"
  || profileData?.employmentStatus !== "Active"
  || profileData?.loginAllowed !== true
  || profileData?.isDeleted !== false
  || profileData?.primaryPromotionGroupId !== "PG-A"
  || !territory.exists
  || territoryData?.userId !== "uat-sales-rep-west-a"
  || territoryData?.areaId !== "WEST-A1"
  || territoryData?.active !== true
  || territoryData?.status !== "Active"
  || !primaryGroup.exists
  || primaryGroupData?.active !== true
  || !product.exists
  || productData?.active !== true
  || productData?.promotionGroupId !== profileData.primaryPromotionGroupId
  || productData?.price !== 7
  || !assignment.exists
  || assignmentData?.userId !== profileData.uid
  || assignmentData?.productId !== product.id
  || assignmentData?.productGroupId !== productData.promotionGroupId
  || assignmentData?.active !== true
  || assignmentData?.status !== "Active"
  || !pharmacy.exists
  || pharmacyData?.active !== true
  || pharmacyData?.areaId !== territoryData.areaId
  || pharmacyData?.assignedRepId !== profileData.uid
  || typeof pharmacyData?.id !== "string"
  || pharmacyData.id.trim() === ""
  || typeof pharmacyData?.name !== "string"
  || pharmacyData.name.trim() === ""
  || typeof pharmacyData?.territory !== "string"
  || pharmacyData.territory.trim() === ""
  || typeof pharmacyData?.region !== "string"
  || pharmacyData.region.trim() === ""
  || typeof pharmacyData?.address !== "string"
  || pharmacyData.address.trim() === ""
  || !template.exists
  || !isRuntimeOrderWorkflowTemplate(template.data())
  || !operationsProfile.exists
  || operationsProfileData?.active !== true
  || operationsProfileData?.role !== "Order Operations Officer"
  || operationsProfileData?.securityScope !== "National"
  || operationsProfileData?.country !== "LY"
  || operationsProfileData?.countryId !== "LY"
  || !operationsCountry.exists
  || operationsCountry.data()?.active !== true
) throw new Error("WP98_COMMERCIAL_FIXTURE_CONTRACT_FAILED");
console.log("WP98_COMMERCIAL_FIXTURE_CONTRACT=PASS");
