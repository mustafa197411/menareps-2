import { strict as assert } from "node:assert";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { executeStandaloneSampleDistribution } from "./sampleDistributionService";

const projectId = "demo-menareps-wp82";
if (process.env.GCLOUD_PROJECT !== projectId || process.env.FIREBASE_CONFIG?.includes("menareps-crm-production")) throw new Error("EMULATOR_PROJECT_ISOLATION_FAILED");
if (!process.env.FIRESTORE_EMULATOR_HOST?.startsWith("127.0.0.1:")) throw new Error("FIRESTORE_EMULATOR_LOOPBACK_REQUIRED");

const app = initializeApp({ projectId }, `wp82-concurrency-${Date.now()}`);
const db = getFirestore(app);
const writes: Array<[string, Record<string, unknown>]> = [
  ["users/REP-SYNTHETIC", { role: "Medical Representative", active: true, loginAllowed: true, isDeleted: false }],
  ["physicians/PHYSICIAN-SYNTHETIC", { active: true, classification: "A", areaId: "AREA-SYNTHETIC", primaryPromotionGroupId: "GROUP-SYNTHETIC" }],
  ["areas/AREA-SYNTHETIC", { active: true, countryId: "COUNTRY-SYNTHETIC", districtId: "DISTRICT-SYNTHETIC", cityId: "CITY-SYNTHETIC" }],
  ["marketSettings/MARKET-SYNTHETIC", { active: true, countryId: "COUNTRY-SYNTHETIC", timezone: "UTC" }],
  ["products/PRODUCT-SYNTHETIC", { active: true, promotionGroupId: "GROUP-SYNTHETIC", name: "Synthetic Product", brand: "Synthetic Brand" }],
  ["sampleCatalog/SKU-SYNTHETIC", { active: true, status: "ACTIVE", productId: "PRODUCT-SYNTHETIC", name: "Synthetic SKU", descriptor: "Synthetic Descriptor" }],
  ["userTerritoryAssignments/TERRITORY-SYNTHETIC", { userId: "REP-SYNTHETIC", areaId: "AREA-SYNTHETIC", status: "Active" }],
  ["userProductAssignments/PRODUCT-ASSIGNMENT-SYNTHETIC", { userId: "REP-SYNTHETIC", productId: "PRODUCT-SYNTHETIC", status: "Active" }],
  ["sampleBatches/BATCH-SYNTHETIC", { sampleSkuId: "SKU-SYNTHETIC", batchNumber: "LOT-SYNTHETIC", expiryDate: "2099-12-31", availableQuantity: 10, status: "AVAILABLE" }],
  ["sampleAllocations/ALLOCATION-SYNTHETIC", { repId: "REP-SYNTHETIC", sampleSkuId: "SKU-SYNTHETIC", productId: "PRODUCT-SYNTHETIC", batchId: "BATCH-SYNTHETIC", quantityAllocated: 2, quantityDistributed: 0, quantityRemaining: 2, allocatedAt: "2026-01-01T00:00:00.000Z", status: "ACTIVE" }],
  ["sampleDisbursedLogs/HISTORY-SYNTHETIC", { physicianId: "PHYSICIAN-SYNTHETIC", quantity: 39, distributionDate: new Date().toISOString().slice(0, 10), status: "DISTRIBUTED" }],
];
await Promise.all(writes.map(([path, data]) => db.doc(path).set(data)));

const request = (id: string) => ({ id, physicianId: "PHYSICIAN-SYNTHETIC", productId: "PRODUCT-SYNTHETIC", sampleSkuId: "SKU-SYNTHETIC", quantity: 1 });
const results = await Promise.allSettled([
  executeStandaloneSampleDistribution("REP-SYNTHETIC", request("DIST-SYNTHETIC-A"), db),
  executeStandaloneSampleDistribution("REP-SYNTHETIC", request("DIST-SYNTHETIC-B"), db),
]);
assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
assert.equal(results.filter(result => result.status === "rejected" && String(result.reason?.code) === "PHYSICIAN_ROLLING_SAMPLE_LIMIT_EXCEEDED").length, 1);
const allocation = (await db.doc("sampleAllocations/ALLOCATION-SYNTHETIC").get()).data();
assert.equal(allocation?.quantityRemaining, 1);
assert.equal(allocation?.quantityDistributed, 1);
const ledgers = await db.collection("sampleDisbursedLogs").where("physicianId", "==", "PHYSICIAN-SYNTHETIC").get();
assert.equal(ledgers.docs.filter(doc => doc.id.startsWith("DIST-SYNTHETIC-")).length, 1);
console.log("WP82 sample concurrency certification passed: 1/1");
await deleteApp(app);
