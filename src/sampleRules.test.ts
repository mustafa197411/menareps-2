import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, query, runTransaction, setDoc, updateDoc, where } from "firebase/firestore";

const env = await initializeTestEnvironment({
  projectId: "menareps-crm-production-5046c",
  firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8089 }
});
await env.clearFirestore();

await env.withSecurityRulesDisabled(async context => {
  const db = context.firestore();
  const users = [
    { id: "rep1", role: "Medical Representative", managerId: "sup1" },
    { id: "rep2", role: "Medical Representative", managerId: "sup2" },
    { id: "rep3", role: "Medical Representative", managerId: "outsideMgr" },
    { id: "deepRep", role: "Medical Representative", managerId: "rep1" },
    { id: "sup1", role: "Medical Supervisor", managerId: "mgr1" },
    { id: "sup2", role: "Medical Supervisor", managerId: "mgr1" },
    { id: "mgr1", role: "Medical Manager", managerId: "country1" },
    { id: "country1", role: "Country Manager" },
    { id: "outsideMgr", role: "Medical Manager" },
    { id: "product1", role: "Product Manager" },
    { id: "warehouse1", role: "Warehouse Manager" },
    { id: "inventory1", role: "Inventory Officer" },
    { id: "admin1", role: "Admin" },
    { id: "inactiveAdmin", role: "Admin", active: false },
    { id: "legacyAllowlistedAdmin", role: "Sales & Marketing Manager" },
    { id: "canonicalRoleOnlyAdmin", role: "Admin" },
    { id: "financeManager1", role: "Finance Manager" },
    { id: "storeManager1", role: "Store Manager" }
  ];
  for (const user of users) await setDoc(doc(db, `users/${user.id}`), { active: true, status: "Active", ...user });
  await setDoc(doc(db, "sampleCatalog/SKU-1"), { id: "SKU-1", productId: "PROD-1", active: true });
  await setDoc(doc(db, "sampleBatches/BATCH-1"), { id: "BATCH-1", sampleSkuId: "SKU-1", status: "AVAILABLE", expiryDate: "2027-01-01", availableQuantity: 10 });
  await setDoc(doc(db, "sampleBatches/BATCH-OTHER"), { id: "BATCH-OTHER", sampleSkuId: "SKU-1", status: "AVAILABLE", expiryDate: "2027-01-01", availableQuantity: 10 });
  await setDoc(doc(db, "sampleRequests/REQ-1"), {
    id: "REQ-1", requesterId: "rep1", repId: "rep1", sampleSkuId: "SKU-1", productId: "PROD-1",
    quantityRequested: 5, reason: "Need", source: "STANDALONE", urgent: false, status: "PENDING_APPROVAL", createdBy: "rep1"
  });
  await setDoc(doc(db, "sampleRequests/REQ-ALLOC"), {
    id: "REQ-ALLOC", requesterId: "rep1", repId: "rep1", sampleSkuId: "SKU-1", productId: "PROD-1",
    quantityRequested: 5, reason: "Approved by server", source: "STANDALONE", urgent: false,
    status: "AWAITING_ALLOCATION", approvedQuantity: 5, approvalId: "SERVER-APPROVAL", allocatedQuantity: 0, createdBy: "rep1"
  });
  await setDoc(doc(db, "sampleAllocations/ALLOC-1"), {
    id: "ALLOC-1", repId: "rep1", sampleSkuId: "SKU-1", productId: "PROD-1",
    quantityAllocated: 5, quantityDistributed: 0, quantityRemaining: 5, allocatedBy: "warehouse1", status: "ACTIVE", batchId: "BATCH-1"
  });
  await setDoc(doc(db, "sampleAllocations/ALLOC-2"), { id: "ALLOC-2", repId: "rep2", sampleSkuId: "SKU-1", productId: "PROD-1", quantityAllocated: 5, quantityDistributed: 0, quantityRemaining: 5, allocatedBy: "warehouse1", status: "ACTIVE", batchId: "BATCH-OTHER" });
  await setDoc(doc(db, "sampleAllocations/ALLOC-3"), { id: "ALLOC-3", repId: "rep3", sampleSkuId: "SKU-1", productId: "PROD-1", quantityAllocated: 5, quantityDistributed: 0, quantityRemaining: 5, allocatedBy: "warehouse1", status: "ACTIVE", batchId: "BATCH-OTHER" });
  await setDoc(doc(db, "sampleAllocations/ALLOC-DEEP"), { id: "ALLOC-DEEP", repId: "deepRep", sampleSkuId: "SKU-1", productId: "PROD-1", quantityAllocated: 5, quantityDistributed: 0, quantityRemaining: 5, allocatedBy: "warehouse1", status: "ACTIVE", batchId: "BATCH-OTHER" });
});

const db = (uid: string) => env.authenticatedContext(uid, {
  email: uid === "admin1" || uid === "legacyAllowlistedAdmin" ? "testadmin01@esnad.local" : `${uid}@test.local`
}).firestore();
const unauthenticatedDb = env.unauthenticatedContext().firestore();
let passed = 0;
async function test(name: string, operation: Promise<unknown>, allowed: boolean) {
  if (allowed) await assertSucceeds(operation); else await assertFails(operation);
  passed++;
  console.log(`[PASS] ${name}`);
}

await test("rep cannot bypass authoritative request endpoint", setDoc(doc(db("rep1"), "sampleRequests/REQ-OWN"), {
  id: "REQ-OWN", requesterId: "rep1", repId: "rep1", sampleSkuId: "SKU-1", productId: "PROD-1",
  quantityRequested: 2, reason: "Need", source: "STANDALONE", urgent: false, status: "PENDING_APPROVAL", createdBy: "rep1"
}), false);
await test("rep cannot impersonate requester", setDoc(doc(db("rep1"), "sampleRequests/REQ-OTHER"), {
  id: "REQ-OTHER", requesterId: "rep2", repId: "rep2", sampleSkuId: "SKU-1", productId: "PROD-1",
  quantityRequested: 2, reason: "Need", source: "STANDALONE", urgent: false, status: "PENDING_APPROVAL", createdBy: "rep2"
}), false);
await test("rep reads own request", getDoc(doc(db("rep1"), "sampleRequests/REQ-1")), true);
await test("rep queries own requests", getDocs(query(collection(db("rep1"), "sampleRequests"), where("repId", "==", "rep1"))), true);
await test("unrelated rep cannot read request", getDoc(doc(db("rep2"), "sampleRequests/REQ-1")), false);
await test("rep cannot query another rep's requests", getDocs(query(collection(db("rep2"), "sampleRequests"), where("repId", "==", "rep1"))), false);
await test("supervisor reads subordinate request", getDoc(doc(db("sup1"), "sampleRequests/REQ-1")), true);
await test("supervisor queries legitimate subordinate requests", getDocs(query(collection(db("sup1"), "sampleRequests"), where("repId", "==", "rep1"))), true);
await test("unrelated supervisor cannot read request", getDoc(doc(db("sup2"), "sampleRequests/REQ-1")), false);
await test("unrelated supervisor cannot query request", getDocs(query(collection(db("sup2"), "sampleRequests"), where("repId", "==", "rep1"))), false);
await test("unauthenticated actor cannot read request", getDoc(doc(unauthenticatedDb, "sampleRequests/REQ-1")), false);
await test("unauthenticated actor cannot query requests", getDocs(query(collection(unauthenticatedDb, "sampleRequests"), where("repId", "==", "rep1"))), false);
await test("rep cannot create approval", setDoc(doc(db("rep1"), "sampleApprovals/APP-REP"), {
  id: "APP-REP", requestId: "REQ-1", repId: "rep1", sampleSkuId: "SKU-1", productId: "PROD-1", quantityRequested: 5, approverId: "rep1", decision: "APPROVED", approvedQuantity: 5
}), false);
await test("rep cannot reject request", setDoc(doc(db("rep1"), "sampleApprovals/REJ-REP"), {
  id: "REJ-REP", requestId: "REQ-1", repId: "rep1", sampleSkuId: "SKU-1", productId: "PROD-1", quantityRequested: 5, approverId: "rep1", decision: "REJECTED", approvedQuantity: 0, rejectionReason: "Not authorized"
}), false);
await test("direct supervisor approval creation is denied in favor of server authority", setDoc(doc(db("sup1"), "sampleApprovals/APP-1"), {
  id: "APP-1", requestId: "REQ-1", repId: "rep1", sampleSkuId: "SKU-1", productId: "PROD-1", quantityRequested: 5, approverId: "sup1", decision: "APPROVED", approvedQuantity: 5
}), false);
await test("approval exceeding request is denied", setDoc(doc(db("sup1"), "sampleApprovals/APP-2"), {
  id: "APP-2", requestId: "REQ-1", repId: "rep1", sampleSkuId: "SKU-1", productId: "PROD-1", quantityRequested: 5, approverId: "sup1", decision: "APPROVED", approvedQuantity: 6
}), false);
await test("rejection without reason is denied", setDoc(doc(db("sup1"), "sampleApprovals/APP-3"), {
  id: "APP-3", requestId: "REQ-1", repId: "rep1", sampleSkuId: "SKU-1", productId: "PROD-1", quantityRequested: 5, approverId: "sup1", decision: "REJECTED", approvedQuantity: 0
}), false);
await test("direct supervisor request approval transition is denied", updateDoc(doc(db("sup1"), "sampleRequests/REQ-1"), { status: "AWAITING_ALLOCATION", approvedQuantity: 2, approvalId: "FORGED" }), false);
await test("direct supervisor request rejection transition is denied", updateDoc(doc(db("sup1"), "sampleRequests/REQ-1"), { status: "REJECTED", updatedBy: "sup1" }), false);
await test("rep cancels own pending request", updateDoc(doc(db("rep1"), "sampleRequests/REQ-1"), { status: "CANCELLED", cancelledBy: "rep1" }), true);
await test("browser allocation request transition is denied", updateDoc(doc(db("warehouse1"), "sampleRequests/REQ-ALLOC"), { status: "PARTIALLY_ALLOCATED", allocatedQuantity: 2 }), false);
await test("rep cannot create Sample SKU", setDoc(doc(db("rep1"), "sampleCatalog/SKU-REP"), { id: "SKU-REP", productId: "PROD-1" }), false);
await test("supervisor cannot create Sample SKU", setDoc(doc(db("sup1"), "sampleCatalog/SKU-SUP"), { id: "SKU-SUP", productId: "PROD-1" }), false);
await test("Product Manager cannot bypass authoritative Sample Variant endpoint", setDoc(doc(db("product1"), "sampleCatalog/SKU-PM"), { id: "SKU-PM", productId: "PROD-1" }), false);
await test("Admin browser creation is denied in favor of authoritative Sample Variant endpoint", setDoc(doc(db("admin1"), "sampleCatalog/SKU-ADMIN"), { id: "SKU-ADMIN", productId: "PROD-1" }), false);
await test("designated UAT Admin lists Sample inventory", getDocs(collection(db("admin1"), "sampleInventory")), true);
await test("inactive Admin profile is not elevated", setDoc(doc(db("inactiveAdmin"), "sampleCatalog/SKU-INACTIVE-ADMIN"), { id: "SKU-INACTIVE-ADMIN", productId: "PROD-1" }), false);
await test("legacy allowlisted email receives no elevation without canonical Admin role", setDoc(doc(db("legacyAllowlistedAdmin"), "products/PROD-LEGACY-ADMIN"), { id: "PROD-LEGACY-ADMIN" }), false);
await test("canonical active Admin role receives administrator authorization", setDoc(doc(db("canonicalRoleOnlyAdmin"), "products/PROD-CANONICAL-ONLY"), { id: "PROD-CANONICAL-ONLY" }), true);
await test("Product Manager receives no generic manager territory write", setDoc(doc(db("product1"), "territories/T-PRODUCT-MANAGER"), { id: "T-PRODUCT-MANAGER" }), false);
await test("Medical Manager receives no generic manager territory write", setDoc(doc(db("mgr1"), "territories/T-MEDICAL-MANAGER"), { id: "T-MEDICAL-MANAGER" }), false);
await test("Finance Manager receives no generic manager territory write", setDoc(doc(db("financeManager1"), "territories/T-FINANCE-MANAGER"), { id: "T-FINANCE-MANAGER" }), false);
await test("Store Manager receives no generic manager territory write", setDoc(doc(db("storeManager1"), "territories/T-STORE-MANAGER"), { id: "T-STORE-MANAGER" }), false);
await test("rep cannot create allocation", setDoc(doc(db("rep1"), "sampleAllocations/ALLOC-REP"), {
  id: "ALLOC-REP", repId: "rep1", sampleSkuId: "SKU-1", productId: "PROD-1", quantityAllocated: 2,
  quantityDistributed: 0, quantityRemaining: 2, allocatedBy: "rep1", status: "ACTIVE"
}), false);
await test("warehouse cannot bypass authoritative managerial allocation endpoint", setDoc(doc(db("warehouse1"), "sampleAllocations/ALLOC-WH"), {
  id: "ALLOC-WH", repId: "rep1", sampleSkuId: "SKU-1", productId: "PROD-1", quantityAllocated: 2,
  quantityDistributed: 0, quantityRemaining: 2, allocatedBy: "warehouse1", status: "ACTIVE"
}), false);
await test("rep cannot increase own allocation", updateDoc(doc(db("rep1"), "sampleAllocations/ALLOC-1"), { quantityAllocated: 50, quantityRemaining: 50 }), false);
await test("rep reads own allocation", getDoc(doc(db("rep1"), "sampleAllocations/ALLOC-1")), true);
await test("rep queries only own allocation", getDocs(query(collection(db("rep1"), "sampleAllocations"), where("repId", "==", "rep1"))), true);
await test("other rep cannot read allocation", getDoc(doc(db("rep2"), "sampleAllocations/ALLOC-1")), false);
await test("rep cannot query another representative allocation", getDocs(query(collection(db("rep1"), "sampleAllocations"), where("repId", "==", "rep2"))), false);
await test("rep cannot scan all allocations", getDocs(collection(db("rep1"), "sampleAllocations")), false);
await test("team manager queries authorized subordinate allocations", getDocs(query(collection(db("mgr1"), "sampleAllocations"), where("repId", "in", ["rep1", "rep2"]))), true);
await test("team manager cannot query outside hierarchy allocation", getDocs(query(collection(db("mgr1"), "sampleAllocations"), where("repId", "==", "rep3"))), false);
await test("team manager cannot traverse through a representative as a hierarchy manager", getDocs(query(collection(db("mgr1"), "sampleAllocations"), where("repId", "==", "deepRep"))), false);
await test("higher manager queries allocation through canonical descendant managers", getDocs(query(collection(db("country1"), "sampleAllocations"), where("repId", "==", "rep1"))), true);
await test("rep cannot get referenced batch directly", getDoc(doc(db("rep1"), "sampleBatches/BATCH-1")), false);
await test("rep cannot get unrelated batch", getDoc(doc(db("rep1"), "sampleBatches/BATCH-OTHER")), false);
await test("rep cannot list Sample batches", getDocs(collection(db("rep1"), "sampleBatches")), false);
await test("warehouse reads Sample batches", getDocs(collection(db("warehouse1"), "sampleBatches")), true);
await test("inventory officer reads Sample batches", getDocs(collection(db("inventory1"), "sampleBatches")), true);
await test("Product Manager cannot read physical Sample batches", getDocs(collection(db("product1"), "sampleBatches")), false);
await test("rep cannot create distribution without atomic allocation consumption", setDoc(doc(db("rep1"), "sampleDisbursedLogs/DIST-1"), {
  id: "DIST-1", repId: "rep1", createdBy: "rep1", sampleSkuId: "SKU-1", productId: "PROD-1", physicianId: "PHY-1", allocationId: "ALLOC-1", quantity: 1
}), false);
await test("rep cannot distribute for another rep", setDoc(doc(db("rep1"), "sampleDisbursedLogs/DIST-2"), {
  id: "DIST-2", repId: "rep2", createdBy: "rep1", sampleSkuId: "SKU-1", productId: "PROD-1", physicianId: "PHY-1", quantity: 1
}), false);
await test("warehouse browser receipt is denied in favor of authoritative endpoint", setDoc(doc(db("warehouse1"), "sampleInventory/INV-1"), { sampleSkuId: "SKU-1", availableQuantity: 10 }), false);
await test("rep cannot adjust inventory", setDoc(doc(db("rep1"), "sampleInventory/INV-REP"), { sampleSkuId: "SKU-1", availableQuantity: 10 }), false);

const repTransactionDb = db("rep1");
await test("rep cannot bypass backend by atomically composing allocation, distribution, movement and usage writes", runTransaction(repTransactionDb, async tx => {
  const allocationRef = doc(repTransactionDb, "sampleAllocations/ALLOC-1");
  const allocation = (await tx.get(allocationRef)).data()!;
  tx.update(allocationRef, { ...allocation, quantityRemaining: 4, quantityDistributed: 1, updatedBy: "rep1" });
  tx.set(doc(repTransactionDb, "sampleDisbursedLogs/DIST-TX"), { id: "DIST-TX", repId: "rep1", createdBy: "rep1", sampleSkuId: "SKU-1", productId: "PROD-1", physicianId: "PHY-1", allocationId: "ALLOC-1", quantity: 1 });
  tx.set(doc(repTransactionDb, "sampleTransactions/MOVE-TX"), { id: "MOVE-TX", sampleSkuId: "SKU-1", type: "DISTRIBUTION", quantity: -1, sourceId: "DIST-TX", sourceType: "SAMPLE_DISTRIBUTION", actorId: "rep1", createdAt: "2026-08-09T00:00:00Z" });
  tx.set(doc(repTransactionDb, "physicianSampleUsage/PHY-1_PROD-1_2026-08"), { physicianId: "PHY-1", productId: "PROD-1", period: "2026-08", usedQuantity: 1, lastDistributionId: "DIST-TX", updatedBy: "rep1" });
}), false);

await test("rep cannot write canonical rolling usage lock", setDoc(doc(db("rep1"), "physicianSampleRollingUsage/PHY-1"), { physicianId: "PHY-1", updatedBy: "rep1" }), false);

await test("rep cannot forge physician usage larger than actual distribution", runTransaction(repTransactionDb, async tx => {
  const allocationRef = doc(repTransactionDb, "sampleAllocations/ALLOC-1"); const allocation = (await tx.get(allocationRef)).data()!;
  tx.update(allocationRef, { ...allocation, quantityRemaining: allocation.quantityRemaining - 1, quantityDistributed: allocation.quantityDistributed + 1, updatedBy: "rep1" });
  tx.set(doc(repTransactionDb, "sampleDisbursedLogs/DIST-FORGE"), { id: "DIST-FORGE", repId: "rep1", createdBy: "rep1", sampleSkuId: "SKU-1", productId: "PROD-1", physicianId: "PHY-2", allocationId: "ALLOC-1", quantity: 1 });
  tx.set(doc(repTransactionDb, "physicianSampleUsage/PHY-2_PROD-1_2026-08"), { physicianId: "PHY-2", productId: "PROD-1", period: "2026-08", usedQuantity: 9, lastDistributionId: "DIST-FORGE", updatedBy: "rep1" });
}), false);

console.log(`Samples rules tests passed: ${passed}`);
await env.cleanup();
